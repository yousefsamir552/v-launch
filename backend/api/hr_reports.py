"""
تجميع تقارير وتحليلات الموارد البشرية بالكامل داخل الباك إند.

كل الأرقام تُحسب هنا (وليس في المتصفح) لتقليل استهلاك النطاق الترددي،
ولضمان تطابق 100% مع منطق شاشة "المرتبات" في الواجهة:
    * أجر اليوم = المرتب ÷ 30، وأجر الساعة = أجر اليوم ÷ ساعات الشيفت الرسمية (9 ساعات افتراضياً).
    * خصم التأخير/الانصراف المبكر يُقرأ من calculated_deduction_* (مع احترام manual_deduction،
      وfallback لشرائح قواعد الحضور عند عدم تخزينه وعدم وجود خصم يدوي).
    * الغياب بدون عذر يخصم يومين (1 يوم غياب + 1 يوم جزاء إضافي بحد أدنى)، والغياب بعذر يخصم اليوم فقط،
      والإجازة على حساب الشركة مدفوعة 100%.
    * استحقاق الشهر للموظف المنتظم = 30 − (الغياب + خصم الإجازة الأسبوعية) + عمل الإجازة الأسبوعية،
      وللمعيَّن أو التارك في منتصف الشهر = أيام حضوره الفعلية + الإجازات الأسبوعية داخل نطاق عمله.
    * الجزاءات اليدوية والسُلف حسب تاريخ الشهر.
    * الصافي = الأجر المكتسب + الإضافي − (خصم الحضور والغياب الإضافي + الجزاءات + السُلف).

الرؤية مقيّدة برتبة المستخدم الحالي (rank_level) مع استبعاد حساب Sudo نهائياً.
"""

import calendar
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

from django.utils import timezone
from rest_framework import viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from .models import (
    HREmployee,
    HRAttendanceRecord,
    HRPenalty,
    HRLoan,
    HRBonusPlan,
    HRDirectBonus,
    HRAttendanceSettings,
    HRPayrollSnapshot,
    RANK_SUDO,
    DEFAULT_RANK_LEVEL,
    coerce_rank_level,
    visible_rank_levels,
)
from .permissions import IsAuthenticatedProfile
from .hr_attendance_io import (
    DEFAULT_WEEKLY_OFF_WEEKDAY,
    _match_rule,
    absence_extra_penalty_days,
    compute_worked_hours,
    effective_absence_decision,
    eligible_week_dates,
    employee_shift_times,
    is_absence_for_weekly_off,
    is_attended_record,
    is_excused_unpaid_record,
    is_pending_absence_record,
    is_unexcused_absence_record,
    weekly_off_ratio_for_absences,
    weekly_off_weekday,
    working_hours_per_day,
)
from .views import (
    get_viewer_rank,
    is_sudo_profile,
    rank_scoped_queryset,
    resolve_request_user_profile,
)


def _D(value, default='0') -> Decimal:
    """تحويل آمن ودقيق إلى Decimal (بدون انزياح ثنائي للـ float)."""
    if value is None or value == '':
        return Decimal(default)
    if isinstance(value, Decimal):
        return value if value.is_finite() else Decimal(default)
    try:
        dec = Decimal(str(value))
        return dec if dec.is_finite() else Decimal(default)
    except Exception:
        return Decimal(default)


def _q2(value) -> Decimal:
    """تقريب مالي دقيق لأقرب قرش (رقمين عشريين) بقاعدة ROUND_HALF_UP."""
    return _D(value).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def _round_half_up(value, places=2) -> float:
    """تقريب مالي بقاعدة ROUND_HALF_UP (تجنب تقريب بايثون Banker's Rounding)."""
    try:
        dec = _D(value)
        quant = Decimal('1').scaleb(-places)
        return float(dec.quantize(quant, rounding=ROUND_HALF_UP))
    except Exception:
        return round(float(value or 0.0), places)


def _round_nearest_5(value) -> Decimal:
    """
    تقريب صافي المرتب النهائي الموجب فقط عند الصرف لأقرب 5 جنيهات بقاعدة ROUND_HALF_UP:
      2582.50 -> 2585.00
      2587.50 -> 2590.00
    أما الرصيد السالب أو الصفر فيبقى بقيمته الدقيقة بالقرش بدون تقريب.
    """
    dec = _q2(value)
    if dec <= Decimal('0.00'):
        return dec
    return ((dec / Decimal('5')).quantize(Decimal('1'), rounding=ROUND_HALF_UP)) * Decimal('5')


def _weekly_off_ratio_dec(absent_count: int) -> Decimal:
    if absent_count >= 5:
        return Decimal('1')
    if absent_count == 4:
        return Decimal('2') / Decimal('3')
    if absent_count == 3:
        return Decimal('0.5')
    if absent_count == 2:
        return Decimal('1') / Decimal('3')
    return Decimal('0')


MONTH_LABELS_AR = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
]


# ---------------------------------------------------------------------------
# Helpers — calendar / months
# ---------------------------------------------------------------------------
def _parse_month(value, default):
    """يُرجع مفتاح شهر بصيغة YYYY-MM أو القيمة الافتراضية عند الخطأ."""
    if not value:
        return default
    parts = str(value).split('-')
    if len(parts) != 2:
        return default
    try:
        y, m = int(parts[0]), int(parts[1])
    except (TypeError, ValueError):
        return default
    if not (2000 <= y <= 2100 and 1 <= m <= 12):
        return default
    return f'{y:04d}-{m:02d}'


def _month_start(key):
    y, m = (int(part) for part in key.split('-'))
    return date(y, m, 1)


def _month_end(key):
    y, m = (int(part) for part in key.split('-'))
    return date(y, m, calendar.monthrange(y, m)[1])


def _month_label(key):
    _, m = (int(part) for part in key.split('-'))
    return MONTH_LABELS_AR[m - 1] if 1 <= m <= 12 else key


def _iter_month_keys(start_key, end_key):
    """كل مفاتيح الشهور من start إلى end شاملة."""
    y, m = (int(part) for part in start_key.split('-'))
    ey, em = (int(part) for part in end_key.split('-'))
    keys = []
    guard = 0
    while (y, m) <= (ey, em) and guard < 240:
        keys.append(f'{y:04d}-{m:02d}')
        m += 1
        if m > 12:
            m = 1
            y += 1
        guard += 1
    return keys


def _ext_id(obj):
    if not obj:
        return ''
    return obj.client_id or str(obj.id)


# ---------------------------------------------------------------------------
# Helpers — attendance rules (mirror of the frontend payroll logic)
# ---------------------------------------------------------------------------
def _is_attended(record):
    """حضور فعلي/مؤقت: حاضر / بصمة واحدة على الأقل (check_in أو check_out) / إجازة على حساب الشركة."""
    return is_attended_record(record)


def _weekly_off_ratio(absent_count):
    """نسبة خصم يوم الإجازة الأسبوعية (5 شرائح: 0/1->0, 2->1/3, 3->1/2, 4->2/3, 5+->1)."""
    return weekly_off_ratio_for_absences(absent_count)


def _weekly_off_deduction_for_date_dec(records_by_date, off_date, hire_date=None, termination_date=None) -> Decimal:
    """نسبة خصم يوم الإجازة الأسبوعية (Decimal دقيق) وفق إجمالي أيام الغياب في الأيام الستة السابقة ضمن فترة التوظيف."""
    raw_week_dates = [off_date - timedelta(days=offset) for offset in range(6, 0, -1)]
    week_dates = eligible_week_dates(raw_week_dates, hire_date=hire_date, termination_date=termination_date)
    if not week_dates or not any(day in records_by_date for day in week_dates):
        return Decimal('0')
    absent_count = 0
    for day in week_dates:
        record = records_by_date.get(day)
        if is_absence_for_weekly_off(record):
            absent_count += 1
    return _weekly_off_ratio_dec(absent_count)


def _weekly_off_deduction_for_date(records_by_date, off_date, hire_date=None, termination_date=None):
    """نسبة خصم يوم الإجازة الأسبوعية وفق إجمالي أيام الغياب (بدون عذر + بعذر + معلّق) في الأيام الستة السابقة."""
    return float(_weekly_off_deduction_for_date_dec(records_by_date, off_date, hire_date=hire_date, termination_date=termination_date))


def _compute_month_accrual(records_by_date, month_key, up_to_iso,
                           weekly_off_index=DEFAULT_WEEKLY_OFF_WEEKDAY,
                           weekly_off_work_multiplier=1.0,
                           hire_date=None,
                           termination_date=None,
                           weekly_off_partial_hour_multiplier=1.0,
                           shift_hours=9.0,
                           official_start=None,
                           official_end=None):
    """
    استحقاق الشهر وفق قواعد المصنع الرسمية النهائية المعتمدة (باستخدام Decimal):
    - النطاق الفعلي للموظف = [max(month_start, hire_date), min(month_end, termination_date)].
      أي يوم خارج هذا النطاق يُتجاهل تماماً (لا غياب ولا إجازة أسبوعية ولا خصم أحد).
    1) الموظف المنتظم طوال الشهر (لا تعيين ولا ترك داخل الشهر) في شهر مكتمل:
       base_earned = max(0, 30 - total_unpaid_absence_days - sunday_deduction_days)
       أياً كان عدد أيام الشهر (28 / 29 / 30 / 31).
    2) المعيَّن في منتصف الشهر (hire_date > month_start) أو التارك قبل نهاية الشهر (termination_date < month_end)
       أو منتصف الشهر المفتوح (month_complete = False):
       base_earned = min(30, attended_regular_days + paid_weekly_off_days).
    3) العمل يوم الإجازة الأسبوعية يُضاف فوق سقف الـ 30 يوماً:
       - يوم كامل: أجر يوم × weekly_off_work_multiplier.
       - ساعات جزئية (< ساعات الوردية): ساعات العمل الفعلية × أجر الساعة × معامل ساعات الأحد.
    """
    y, m = (int(part) for part in month_key.split('-'))
    last_day = calendar.monthrange(y, m)[1]
    month_first = date(y, m, 1)
    month_last = date(y, m, last_day)

    effective_start = max(month_first, hire_date) if hire_date else month_first
    effective_end = min(month_last, termination_date) if termination_date else month_last
    is_partial_month = bool(
        (hire_date and hire_date > month_first)
        or (termination_date and termination_date < month_last)
    )
    month_complete = up_to_iso is None or up_to_iso >= month_last

    if effective_start > effective_end:
        return {
            'attended_days': 0.0,
            'paid_sunday_days': 0.0,
            'worked_weekly_off_days': 0.0,
            'weekly_off_extra_days': 0.0,
            'weekly_off_partial_hours': 0.0,
            'sunday_deduction_days': 0.0,
            'unexcused_absence_days': 0.0,
            'excused_unpaid_absence_days': 0.0,
            'is_partial_month': is_partial_month,
            'month_complete': month_complete,
            'earned_days': 0.0,
            '_earned_days_raw': 0.0,
            '_base_earned_days_dec': Decimal('0'),
            '_weekly_off_full_weighted_days_dec': Decimal('0'),
            '_weekly_off_partial_weighted_hours_dec': Decimal('0'),
            '_sunday_deduction_days_dec': Decimal('0'),
            '_total_unpaid_absence_days_dec': Decimal('0'),
        }

    attended_regular_days = Decimal('0')
    worked_weekly_off_days = Decimal('0')
    weekly_off_full_weighted_days = Decimal('0')
    weekly_off_partial_hours = Decimal('0')
    weekly_off_partial_weighted_hours = Decimal('0')
    paid_weekly_off_days = Decimal('0')
    unexcused_absence_days = Decimal('0')
    excused_unpaid_absence_days = Decimal('0')
    sunday_deduction_days = Decimal('0')

    mult_dec = max(Decimal('0'), _D(weekly_off_work_multiplier, '1'))
    partial_mult_default = max(Decimal('0'), _D(weekly_off_partial_hour_multiplier, '1'))
    shift_h_dec = _D(shift_hours, '9')
    if shift_h_dec <= Decimal('0'):
        shift_h_dec = Decimal('9')

    for day in range(1, last_day + 1):
        cursor = date(y, m, day)
        if cursor < effective_start or cursor > effective_end:
            continue
        record = records_by_date.get(cursor)
        rec_in = getattr(record, 'check_in', None) if record else None
        rec_out = getattr(record, 'check_out', None) if record else None
        explicit_off_hours = getattr(record, 'weekly_off_worked_hours', None) if record else None
        has_check_in = bool(rec_in) or bool(explicit_off_hours and float(explicit_off_hours) > 0)
        has_any_punch = bool(rec_in or rec_out or (explicit_off_hours and float(explicit_off_hours) > 0))
        if up_to_iso and cursor > up_to_iso and not has_any_punch:
            continue

        if cursor.weekday() == weekly_off_index:
            raw_week_dates = [cursor - timedelta(days=offset) for offset in range(6, 0, -1)]
            scoped_week = eligible_week_dates(
                raw_week_dates, hire_date=hire_date, termination_date=termination_date
            )
            if scoped_week and any(day_key in records_by_date for day_key in scoped_week):
                ded_dec = _weekly_off_deduction_for_date_dec(
                    records_by_date, cursor, hire_date=hire_date, termination_date=termination_date
                )
                sunday_deduction_days += ded_dec
                paid_weekly_off_days += max(Decimal('0'), Decimal('1') - ded_dec)
            elif month_complete and not is_partial_month:
                # أسبوع كامل بلا أي حضور لموظف منتظم في شهر مكتمل => خصم يوم الإجازة كاملاً.
                sunday_deduction_days += Decimal('1')

            if has_check_in:
                worked_weekly_off_days += Decimal('1')
                if explicit_off_hours is not None and float(explicit_off_hours) > 0:
                    worked_h = _D(explicit_off_hours)
                elif rec_in and rec_out:
                    worked_h_val = compute_worked_hours(rec_in, rec_out, official_start, official_end)
                    worked_h = _D(worked_h_val) if worked_h_val is not None else None
                else:
                    worked_h = None

                override_mult = getattr(record, 'weekly_off_hour_multiplier_override', None)
                if worked_h is not None and worked_h > Decimal('0') and worked_h < shift_h_dec:
                    part_mult = max(Decimal('0'), _D(override_mult)) if override_mult is not None else partial_mult_default
                    weekly_off_partial_hours += worked_h
                    weekly_off_partial_weighted_hours += worked_h * part_mult
                elif override_mult is not None and worked_h is not None and worked_h > Decimal('0'):
                    part_mult = max(Decimal('0'), _D(override_mult))
                    weekly_off_partial_hours += worked_h
                    weekly_off_partial_weighted_hours += worked_h * part_mult
                else:
                    weekly_off_full_weighted_days += Decimal('1') * mult_dec
            continue

        if record and _is_attended(record):
            attended_regular_days += Decimal('1')
        elif record and is_excused_unpaid_record(record):
            excused_unpaid_absence_days += Decimal('1')
        else:
            unexcused_absence_days += Decimal('1')

    attended_days = attended_regular_days + worked_weekly_off_days
    weekly_off_extra_days_dec = weekly_off_full_weighted_days + (weekly_off_partial_weighted_hours / shift_h_dec)
    total_unpaid_absence_days = unexcused_absence_days + excused_unpaid_absence_days

    if attended_regular_days == 0 and worked_weekly_off_days == 0:
        # بدون أي حضور فعلي (ولا إجازة مدفوعة على حساب الشركة) خلال الشهر: الاستحقاق = 0.
        paid_weekly_off_days = Decimal('0')
        sunday_deduction_days = Decimal('0')
        base_earned_days = Decimal('0')
        earned_days_raw_dec = Decimal('0')
    elif month_complete and not is_partial_month:
        # الموظف المنتظم طوال الشهر: نحاسب بالشهر (30 يوماً) ونخصم أيام الغياب وخصم الإجازة الأسبوعية.
        base_earned_days = max(Decimal('0'), Decimal('30') - total_unpaid_absence_days - sunday_deduction_days)
        earned_days_raw_dec = base_earned_days + weekly_off_extra_days_dec
    else:
        # المعيَّن أو التارك في منتصف الشهر (أو الشهر المفتوح قبل نهايته): نحاسب بالأيام الفعلية.
        base_earned_days = min(Decimal('30'), attended_regular_days + paid_weekly_off_days)
        earned_days_raw_dec = base_earned_days + weekly_off_extra_days_dec

    return {
        'attended_days': _round_half_up(attended_days, 2),
        'paid_sunday_days': _round_half_up(paid_weekly_off_days, 2),
        'worked_weekly_off_days': _round_half_up(worked_weekly_off_days, 2),
        'weekly_off_extra_days': _round_half_up(weekly_off_extra_days_dec, 2),
        'weekly_off_partial_hours': _round_half_up(weekly_off_partial_hours, 2),
        'sunday_deduction_days': _round_half_up(sunday_deduction_days, 2),
        'unexcused_absence_days': _round_half_up(unexcused_absence_days, 2),
        'excused_unpaid_absence_days': _round_half_up(excused_unpaid_absence_days, 2),
        'is_partial_month': is_partial_month,
        'month_complete': month_complete,
        'earned_days': _round_half_up(earned_days_raw_dec, 2),
        '_earned_days_raw': float(earned_days_raw_dec),
        '_base_earned_days_dec': base_earned_days,
        '_weekly_off_full_weighted_days_dec': weekly_off_full_weighted_days,
        '_weekly_off_partial_weighted_hours_dec': weekly_off_partial_weighted_hours,
        '_sunday_deduction_days_dec': sunday_deduction_days,
        '_total_unpaid_absence_days_dec': total_unpaid_absence_days,
    }


def _minutes_from_time(value):
    if value is None:
        return None
    try:
        return value.hour * 60 + value.minute
    except AttributeError:
        return None


def _late_minutes(check_in, official_start, official_end=None):
    ci = _minutes_from_time(check_in)
    start = _minutes_from_time(official_start)
    if ci is None or start is None:
        return 0.0
    end = _minutes_from_time(official_end)
    if end is not None and end <= start:
        # وردية ليلية تعبر منتصف الليل: البصمة بعد منتصف الليل تُحسب متأخرة عن بداية الوردية المسائية.
        if ci <= end:
            ci += 1440
    diff = ci - start
    return float(round(diff)) if diff > 0 else 0.0


def _match_late_rule(rules, late_minutes):
    """مطابقة دقائق التأخير مع شرائح قواعد الحضور (نفس منطق الواجهة)."""
    if not rules or late_minutes <= 0:
        return None
    candidates = [
        rule for rule in rules
        if isinstance(rule, dict) and rule.get('violation_type') == 'late_arrival'
    ]
    if not candidates:
        return None

    def _from(rule):
        try:
            return float(rule.get('from_minutes') or 0)
        except (TypeError, ValueError):
            return 0.0

    def _to(rule):
        raw = rule.get('to_minutes')
        if raw is None or raw == '':
            return None
        try:
            return float(raw)
        except (TypeError, ValueError):
            return None

    best = None
    best_from = float('-inf')
    for rule in candidates:
        from_value = _from(rule)
        to_value = _to(rule)
        if late_minutes < from_value:
            continue
        if to_value is not None and late_minutes > to_value:
            continue
        if from_value > best_from:
            best = rule
            best_from = from_value
    if best is not None:
        return best

    min_from = min((_from(rule) for rule in candidates), default=float('inf'))
    if min_from != float('inf') and late_minutes >= min_from:
        lower_tiers = [
            rule for rule in candidates
            if _to(rule) is not None and _to(rule) < late_minutes
        ]
        higher_tiers = [
            rule for rule in candidates
            if _from(rule) > late_minutes
        ]
        if lower_tiers and higher_tiers:
            return max(lower_tiers, key=lambda rule: (_to(rule), _from(rule)))

        def sort_key(rule):
            to_value = _to(rule)
            return (to_value if to_value is not None else float('inf'), _from(rule))
        return max(candidates, key=sort_key)
    return None


def _early_minutes(check_out, official_start, official_end, check_in=None):
    co = _minutes_from_time(check_out)
    start = _minutes_from_time(official_start)
    end = _minutes_from_time(official_end)
    if co is None or start is None or end is None:
        return 0.0
    is_overnight = end <= start
    eff_end = end + 1440 if is_overnight else end
    eff_out = co
    if is_overnight and eff_out <= start:
        eff_out += 1440
    elif not is_overnight:
        ci = _minutes_from_time(check_in)
        if ci is not None and eff_out < ci:
            eff_out += 1440
    diff = eff_end - eff_out
    return float(round(diff)) if diff > 0 else 0.0


def _rule_deduction_pair(rule):
    """إرجاع (days_dec, hours_dec) من قاعدة خصم واحدة."""
    if not rule:
        return Decimal('0'), Decimal('0')
    val = _D(rule.get('deduction_value'), '0')
    if val <= Decimal('0'):
        return Decimal('0'), Decimal('0')
    if rule.get('deduction_type') == 'days':
        return val, Decimal('0')
    return Decimal('0'), val


# ---------------------------------------------------------------------------
# Helpers — monthly payroll row (Single Source of Truth in Python / Decimal)
# ---------------------------------------------------------------------------
def _payroll_for_employee_month(employee, employee_records, records_by_date,
                                penalties, loans, month_key, settings, up_to_iso,
                                weekly_off_index=DEFAULT_WEEKLY_OFF_WEEKDAY,
                                direct_bonuses=None, bonus_plans=None):
    salary_dec = _D(getattr(employee, 'monthly_salary', 0), '0')
    day_rate_exact = salary_dec / Decimal('30')
    day_rate = _q2(day_rate_exact)
    shift_hours_val = working_hours_per_day(settings, employee)
    shift_hours_dec = _D(shift_hours_val, '9')
    if shift_hours_dec <= Decimal('0'):
        shift_hours_dec = Decimal('9')
    hour_rate_exact = day_rate_exact / shift_hours_dec
    hour_rate = _q2(hour_rate_exact)

    official_start, official_end = employee_shift_times(settings, employee)
    rules = getattr(settings, 'rules_json', None) if settings else None
    weekly_off_mult = max(
        Decimal('0'),
        _D(getattr(settings, 'weekly_off_work_multiplier', None), '1') if settings else Decimal('1'),
    )
    weekly_off_partial_mult = max(
        Decimal('0'),
        _D(getattr(settings, 'weekly_off_partial_hour_multiplier', None), '1') if settings else Decimal('1'),
    )
    overtime_regular_mult = max(
        Decimal('0'),
        _D(getattr(settings, 'overtime_regular_multiplier', None), '1') if settings else Decimal('1'),
    )

    hire_date = getattr(employee, 'hire_date', None)
    termination_date = getattr(employee, 'termination_date', None)
    extra_absence_days_default = _D(absence_extra_penalty_days(rules), '1')

    # إعدادات رصيد السماح الديناميكي (تخصيص الموظف يتفوق على الإعداد العام).
    emp_grace_min = getattr(employee, 'late_grace_minutes', None)
    if emp_grace_min is not None:
        grace_limit = max(0, int(emp_grace_min))
    else:
        grace_limit = max(0, int(getattr(settings, 'monthly_late_grace_minutes', 0) or 0)) if settings else 0

    emp_grace_period = getattr(employee, 'late_grace_period_months', None)
    if emp_grace_period is not None:
        grace_period_months = max(1, int(emp_grace_period))
    else:
        grace_period_months = max(1, int(getattr(settings, 'monthly_late_grace_period_months', 1) or 1)) if settings else 1

    month_start = _month_start(month_key)
    month_end = _month_end(month_key)
    y_num, m_num = month_start.year, month_start.month
    period_start_m = ((m_num - 1) // grace_period_months) * grace_period_months + 1
    grace_window_start = date(y_num, period_start_m, 1)

    # تجميع السجلات ضمن نافذة السماح (للدوريات متعددة الشهور نجلب الشهور السابقة في نفس الدورة عند الحاجة).
    grace_records = list(employee_records)
    if grace_period_months > 1 and grace_window_start < month_start and getattr(employee, 'pk', None):
        existing_dates = {getattr(r, 'date', None) for r in grace_records}
        extra_recs = HRAttendanceRecord.objects.filter(
            employee=employee,
            date__gte=grace_window_start,
            date__lt=month_start,
        )
        for er in extra_recs:
            if er.date not in existing_dates:
                grace_records.append(er)

    # ------------------------------------------------------------------
    # المرحلة 1: احتساب دقائق التأخير المستهلكة من رصيد السماح خلال الفترة
    # (يشمل التأخير المُصفَّر يدوياً من المشرف وفق قاعدة 14 وحالة 12).
    # ------------------------------------------------------------------
    grace_used_minutes = Decimal('0')
    for record in grace_records:
        rec_date = getattr(record, 'date', None)
        if not rec_date or rec_date < grace_window_start or rec_date > month_end:
            continue
        if hire_date and rec_date < hire_date:
            continue
        if termination_date and rec_date > termination_date:
            continue
        if rec_date.weekday() == weekly_off_index and not getattr(record, 'check_in', None):
            continue
        if not _is_attended(record):
            continue
        if record.status in ('absent', 'leave') and effective_absence_decision(record) == 'paid_company':
            continue
        if getattr(record, 'is_excused', False):
            continue
        if getattr(record, 'review_status', '') == 'rejected' and not getattr(record, 'manual_deduction', False):
            continue

        stored_late = float(getattr(record, 'late_minutes', 0) or 0)
        late_m = stored_late if stored_late > 0 else _late_minutes(record.check_in, official_start, official_end)
        if late_m > 0:
            l_rule = _match_late_rule(rules, late_m)
            if l_rule and bool(l_rule.get('uses_monthly_grace')):
                grace_used_minutes += _D(late_m)

    grace_exceeded = (grace_limit > 0) and (grace_used_minutes > _D(grace_limit))

    # ------------------------------------------------------------------
    # المرحلة 2: احتساب خصومات الحضور والغياب الإضافي والأوفرتايم للشهر
    # ------------------------------------------------------------------
    attendance_days = Decimal('0')
    attendance_hours = Decimal('0')
    overtime_days = Decimal('0')
    overtime_hours = Decimal('0')
    penalized_late_count = 0

    for record in employee_records:
        if not str(record.date).startswith(month_key):
            continue
        if hire_date and record.date < hire_date:
            continue
        if termination_date and record.date > termination_date:
            continue
        # يوم الإجازة الأسبوعية بدون بصمة حضور = إجازة مدفوعة (لا إضافي/خصم عليه).
        if record.date.weekday() == weekly_off_index and not getattr(record, 'check_in', None):
            continue

        # 1) سجل غير حاضر (غياب بدون عذر / بعذر / معلّق): لا يُصرف له إضافي.
        if not _is_attended(record):
            if is_excused_unpaid_record(record):
                # غياب بعذر: لا جزاء إضافي (فقط يوم الغياب نفسه داخل earned_days).
                continue
            if record.review_status == 'rejected':
                continue
            # الغياب المعلّق بدون قرار مسؤول عند قفل الشهر يُحسم لصالح العامل (0 جزاء إضافي).
            if is_pending_absence_record(record) and not getattr(record, 'manual_deduction', False):
                continue
            if getattr(record, 'manual_deduction', False):
                attendance_days += _D(record.calculated_deduction_days, '0')
                attendance_hours += _D(record.calculated_deduction_hours, '0')
            else:
                stored_d = _D(record.calculated_deduction_days, '0')
                stored_h = _D(record.calculated_deduction_hours, '0')
                if stored_d > 0 or stored_h > 0:
                    attendance_days += stored_d
                    attendance_hours += stored_h
                else:
                    attendance_days += extra_absence_days_default
            continue

        # 2) الإضافي يُحسب لأيام الحضور الفعلية فقط ومنفصلاً تماماً عن التأخير.
        overtime_days += _D(getattr(record, 'overtime_days', 0), '0')
        overtime_hours += _D(getattr(record, 'overtime_hours', 0), '0')

        # الإجازة المدفوعة على حساب الشركة أو اليوم المعذور لا يُخصم عليه تأخير.
        if record.status in ('absent', 'leave') and effective_absence_decision(record) == 'paid_company':
            continue
        if getattr(record, 'is_excused', False):
            continue
        # الحالات المعلّقة (بصمة ناقصة / تأخير معلّق / انصراف مبكر معلّق) أو المرفوضة = 0 خصم لصالح العامل.
        if record.review_status in ('rejected', 'pending_review'):
            continue

        # احترام القرار اليدوي للمشرف (بما فيه التصفير اليدوي = 0.00).
        if getattr(record, 'manual_deduction', False):
            m_days = _D(record.calculated_deduction_days, '0')
            m_hours = _D(record.calculated_deduction_hours, '0')
            attendance_days += m_days
            attendance_hours += m_hours
            if m_days > 0 or m_hours > 0:
                penalized_late_count += 1
            continue

        stored_late = float(getattr(record, 'late_minutes', 0) or 0)
        late_m = stored_late if stored_late > 0 else _late_minutes(record.check_in, official_start, official_end)
        stored_early = float(getattr(record, 'early_minutes', 0) or 0)
        early_m = stored_early if stored_early > 0 else _early_minutes(record.check_out, official_start, official_end, record.check_in)

        late_rule = _match_late_rule(rules, late_m) if late_m > 0 else None
        early_rule = _match_rule(rules, 'early_departure', early_m) if early_m > 0 else None

        is_grace_managed = bool(late_rule and late_rule.get('uses_monthly_grace') and grace_limit > 0)
        if is_grace_managed:
            ded_days = Decimal('0')
            ded_hours = Decimal('0')
            # إذا تجاوز رصيد السماح تُخصم كل المرات بأثر رجعي؛ وإلا = 0.00.
            if grace_exceeded:
                if (
                    record.review_status == 'approved'
                    or (
                        getattr(employee, 'rule_application_mode', 'auto') != 'manual_review'
                        and late_rule.get('apply_mode') != 'manual_review'
                    )
                ):
                    ld, lh = _rule_deduction_pair(late_rule)
                    ded_days += ld
                    ded_hours += lh
                    if ld > 0 or lh > 0:
                        penalized_late_count += 1
            # الانصراف المبكر في نفس اليوم يُحسب بشكل مستقل عن رصيد سماح التأخير.
            if early_rule and (
                record.review_status == 'approved'
                or (
                    getattr(employee, 'rule_application_mode', 'auto') != 'manual_review'
                    and early_rule.get('apply_mode') != 'manual_review'
                )
            ):
                ed, eh = _rule_deduction_pair(early_rule)
                ded_days += ed
                ded_hours += eh
            attendance_days += ded_days
            attendance_hours += ded_hours
            continue

        # الحالات غير المرتبطة برصيد السماح (تأخير خارج السماح / انصراف مبكر / بدون رصيد سماح).
        ded_days = _D(record.calculated_deduction_days, '0')
        ded_hours = _D(record.calculated_deduction_hours, '0')
        if ded_days == 0 and ded_hours == 0:
            if late_rule and (
                record.review_status == 'approved'
                or (
                    getattr(employee, 'rule_application_mode', 'auto') != 'manual_review'
                    and late_rule.get('apply_mode') != 'manual_review'
                )
            ):
                ld, lh = _rule_deduction_pair(late_rule)
                ded_days += ld
                ded_hours += lh
            if early_rule and (
                record.review_status == 'approved'
                or (
                    getattr(employee, 'rule_application_mode', 'auto') != 'manual_review'
                    and early_rule.get('apply_mode') != 'manual_review'
                )
            ):
                ed, eh = _rule_deduction_pair(early_rule)
                ded_days += ed
                ded_hours += eh
        if (ded_days > 0 or ded_hours > 0) and late_m > 0:
            penalized_late_count += 1
        attendance_days += ded_days
        attendance_hours += ded_hours

    accrual = _compute_month_accrual(
        records_by_date,
        month_key,
        up_to_iso,
        weekly_off_index,
        weekly_off_work_multiplier=weekly_off_mult,
        hire_date=hire_date,
        termination_date=termination_date,
        weekly_off_partial_hour_multiplier=weekly_off_partial_mult,
        shift_hours=shift_hours_dec,
        official_start=official_start,
        official_end=official_end,
    )
    base_earned_pay = _q2(accrual['_base_earned_days_dec'] * day_rate_exact)
    weekly_off_extra_pay = _q2(
        accrual['_weekly_off_full_weighted_days_dec'] * day_rate_exact
        + accrual['_weekly_off_partial_weighted_hours_dec'] * hour_rate_exact
    )
    earned_base = _q2(base_earned_pay + weekly_off_extra_pay)
    sunday_deduction_money = _q2(accrual['_sunday_deduction_days_dec'] * day_rate_exact)

    # الجزاءات اليدوية
    penalty_days = Decimal('0')
    penalty_hours = Decimal('0')
    for penalty in penalties:
        if not str(penalty.date).startswith(month_key):
            continue
        value = _D(penalty.value, '0')
        if penalty.penalty_type == 'days':
            penalty_days += value
        else:
            penalty_hours += value

    # السُلف والأقساط والمديونية المرحّلة
    regular_loan_amount = Decimal('0')
    carryover_debt_amount = Decimal('0')
    for loan in loans:
        if not str(loan.date).startswith(month_key):
            continue
        amt = _D(loan.amount, '0')
        if getattr(loan, 'loan_kind', 'standard') == 'carryover_debt':
            carryover_debt_amount += amt
        else:
            regular_loan_amount += amt
    regular_loan_amount = _q2(regular_loan_amount)
    carryover_debt_amount = _q2(carryover_debt_amount)
    loan_amount = _q2(regular_loan_amount + carryover_debt_amount)

    # المكافآت الفورية والدورية (بند 21)
    if direct_bonuses is None:
        if getattr(employee, 'pk', None):
            direct_bonuses = list(
                HRDirectBonus.objects.filter(
                    employee=employee, date__gte=month_start, date__lte=month_end
                )
            )
        else:
            direct_bonuses = []
    if bonus_plans is None:
        if getattr(employee, 'pk', None) and hasattr(employee, 'recurring_bonus_plans'):
            bonus_plans = list(employee.recurring_bonus_plans.filter(is_active=True))
        else:
            bonus_plans = []

    direct_bonus_pay = Decimal('0')
    bonus_breakdown = []
    for db_item in direct_bonuses:
        if not str(db_item.date).startswith(month_key):
            continue
        amt = _q2(db_item.amount)
        if amt > 0:
            direct_bonus_pay += amt
            bonus_breakdown.append({
                'kind': 'direct',
                'label': db_item.reason or 'مكافأة فورية',
                'amount': float(amt),
            })
    direct_bonus_pay = _q2(direct_bonus_pay)

    recurring_bonus_pay = Decimal('0')
    total_absences_for_bonus = accrual['_total_unpaid_absence_days_dec']
    for plan in bonus_plans:
        if not getattr(plan, 'is_active', True):
            continue
        if getattr(plan, 'value_type', 'fixed') == 'percent':
            plan_base = _q2(salary_dec * _D(plan.value, '0') / Decimal('100'))
        else:
            plan_base = _q2(plan.value)

        requires_full = bool(getattr(plan, 'requires_full_month', True)) or getattr(plan, 'category', '') == 'attendance'
        if requires_full and (
            accrual['is_partial_month']
            or not accrual['month_complete']
            or accrual['attended_days'] <= 0
        ):
            earned_plan = Decimal('0.00')
            note = 'غير مستحقة لعدم اكتمال الشهر'
        else:
            reduction_pct = Decimal('0')
            if getattr(plan, 'affected_by_absence', True) and total_absences_for_bonus > 0:
                reduction_pct += total_absences_for_bonus * _D(getattr(plan, 'absence_deduction_percent', 100), '100')
            if getattr(plan, 'affected_by_late', True) and penalized_late_count > 0:
                reduction_pct += Decimal(penalized_late_count) * _D(getattr(plan, 'late_deduction_percent', 100), '100')
            reduction_pct = min(Decimal('100'), max(Decimal('0'), reduction_pct))
            earned_plan = _q2(plan_base * (Decimal('100') - reduction_pct) / Decimal('100'))
            note = f'خصم {float(reduction_pct):g}%' if reduction_pct > 0 else 'كاملة'

        recurring_bonus_pay += earned_plan
        bonus_breakdown.append({
            'kind': 'recurring',
            'plan_id': _ext_id(plan) if hasattr(plan, 'id') else '',
            'label': plan.name,
            'category': getattr(plan, 'category', 'attendance'),
            'base_amount': float(plan_base),
            'amount': float(earned_plan),
            'note': note,
        })
    recurring_bonus_pay = _q2(recurring_bonus_pay)
    bonus_pay = _q2(direct_bonus_pay + recurring_bonus_pay)

    attendance_deduction = _q2(attendance_days * day_rate_exact + attendance_hours * hour_rate_exact)
    penalty_deduction = _q2(penalty_days * day_rate_exact + penalty_hours * hour_rate_exact)
    overtime_pay = _q2((overtime_days * day_rate_exact + overtime_hours * hour_rate_exact) * overtime_regular_mult)
    total_deduction = _q2(attendance_deduction + penalty_deduction + loan_amount)

    exact_net_pay = _q2(earned_base + overtime_pay + bonus_pay - total_deduction)
    rounded_net_pay = _round_nearest_5(exact_net_pay)
    payable_cash = rounded_net_pay if rounded_net_pay > Decimal('0.00') else Decimal('0.00')
    carryover_debt_next = abs(exact_net_pay) if exact_net_pay < Decimal('0.00') else Decimal('0.00')

    return {
        'base_salary': float(_q2(salary_dec)),
        'day_rate': float(day_rate),
        'hour_rate': float(hour_rate),
        'shift_hours': float(shift_hours_dec),
        'attended_days': accrual['attended_days'],
        'paid_sunday_days': accrual['paid_sunday_days'],
        'worked_weekly_off_days': accrual['worked_weekly_off_days'],
        'weekly_off_extra_days': accrual['weekly_off_extra_days'],
        'weekly_off_partial_hours': accrual['weekly_off_partial_hours'],
        'weekly_off_extra_pay': float(weekly_off_extra_pay),
        'sunday_deduction_days': accrual['sunday_deduction_days'],
        'sunday_deduction': float(sunday_deduction_money),
        'earned_days': accrual['earned_days'],
        'earned_base': float(earned_base),
        'overtime_days': _round_half_up(overtime_days, 2),
        'overtime_hours': _round_half_up(overtime_hours, 2),
        'overtime_pay': float(overtime_pay),
        'direct_bonus_pay': float(direct_bonus_pay),
        'recurring_bonus_pay': float(recurring_bonus_pay),
        'bonus_pay': float(bonus_pay),
        'bonus_breakdown': bonus_breakdown,
        'attendance_days': _round_half_up(attendance_days, 2),
        'attendance_hours': _round_half_up(attendance_hours, 2),
        'penalty_days': _round_half_up(penalty_days, 2),
        'penalty_hours': _round_half_up(penalty_hours, 2),
        'regular_loan_amount': float(regular_loan_amount),
        'carryover_debt_amount': float(carryover_debt_amount),
        'loan_amount': float(loan_amount),
        'attendance_deduction': float(attendance_deduction),
        'penalty_deduction': float(penalty_deduction),
        'deductions': float(_q2(attendance_deduction + penalty_deduction)),
        'total_deduction': float(total_deduction),
        'exact_net_pay': float(exact_net_pay),
        'rounded_net_pay': float(rounded_net_pay),
        'net_pay': float(rounded_net_pay),
        'payable_cash': float(payable_cash),
        'carryover_debt_next': float(carryover_debt_next),
        'grace_used_minutes': _round_half_up(grace_used_minutes, 2),
        'grace_limit_minutes': grace_limit,
        'grace_exceeded': grace_exceeded,
    }


def _sum_rows(rows):
    return {
        'earned': sum(float(row.get('earned_base') or 0) for row in rows),
        'overtime': sum(float(row.get('overtime_pay') or 0) + float(row.get('bonus_pay') or 0) for row in rows),
        'loans': sum(float(row.get('loan_amount') or 0) for row in rows),
        'deductions': sum(float(row.get('deductions') or 0) for row in rows),
        # إجمالي النقد المطلوب دفعه: مجموع الصفوف الموجبة المقرّبة فقط (الرصيد السالب = 0.00 في الكاش).
        'net': sum(max(0.0, float(row.get('payable_cash', row.get('net_pay')) or 0)) for row in rows),
    }


def _department_breakdown(employees, employee_month_rows, month_keys, snapshot_rows_by_month=None):
    """تجميع تكلفة العمالة حسب القسم خلال الشهور المطلوبة (مع احترام اللقطات المجمّدة للموظفين المحذوفين)."""
    groups = {}
    for employee in employees:
        department = employee.department or 'other'
        group = groups.setdefault(department, {
            'department': department,
            'label': employee.department_label or department or '—',
            'workers': 0,
            'rows': [],
        })
        if employee.is_active:
            group['workers'] += 1

    snapshot_rows_by_month = snapshot_rows_by_month or {}
    for month_key in month_keys:
        if month_key in snapshot_rows_by_month:
            for snap_row in snapshot_rows_by_month[month_key].values():
                department = snap_row.get('department') or 'other'
                label = snap_row.get('department_label') or department or '—'
                group = groups.setdefault(department, {
                    'department': department,
                    'label': label,
                    'workers': 0,
                    'rows': [],
                })
                group['rows'].append(snap_row)
            continue
        for employee in employees:
            row = employee_month_rows.get(employee.id, {}).get(month_key)
            if row:
                department = employee.department or 'other'
                groups[department]['rows'].append(row)

    result = []
    for group in groups.values():
        agg = _sum_rows(group['rows'])
        result.append({
            'department': group['department'],
            'label': group['label'],
            'workers': group['workers'],
            'earned': _round_half_up(agg['earned'], 2),
            'overtime': _round_half_up(agg['overtime'], 2),
            'loans': _round_half_up(agg['loans'], 2),
            'deductions': _round_half_up(agg['deductions'], 2),
            'net': _round_half_up(agg['net'], 2),
        })

    total_net = sum(item['net'] for item in result)
    for item in result:
        item['percent'] = round((item['net'] / total_net) * 100.0, 1) if total_net else 0.0
    result.sort(key=lambda item: item['net'], reverse=True)
    return result


# ---------------------------------------------------------------------------
# ViewSet
# ---------------------------------------------------------------------------
class HRReportsViewSet(viewsets.ViewSet):
    """
    تقرير تجميعي واحد لكل شاشة "التقارير والتحليلات".

    الصلاحية: sudo أو hr_reports أو hr_payroll (والمفتاحان العامان
    can_manage_hr / manage_permissions). الرؤية مقيّدة برتبة المستخدم.
    """

    permission_classes = [IsAuthenticatedProfile]

    def list(self, request):
        profile = resolve_request_user_profile(request)
        if profile is None:
            raise PermissionDenied('مطلوب تسجيل الدخول للوصول إلى التقارير.')
        if not (
            is_sudo_profile(profile)
            or profile.has_perm('hr_reports')
            or profile.has_perm('hr_payroll')
            or profile.has_perm('can_manage_hr')
            or profile.has_perm('manage_permissions')
        ):
            raise PermissionDenied('لا تملك صلاحية عرض تقارير وتحليلات الموارد البشرية.')

        today = timezone.localdate()
        try:
            year = int(request.query_params.get('year') or today.year)
        except (TypeError, ValueError):
            year = today.year
        year = max(2000, min(2100, year))

        default_month = f'{today.year:04d}-{today.month:02d}'
        range_from_key = _parse_month(request.query_params.get('from'), default_month)
        range_to_key = _parse_month(request.query_params.get('to'), default_month)
        if range_from_key > range_to_key:
            range_from_key, range_to_key = range_to_key, range_from_key

        year_months = _iter_month_keys(f'{year:04d}-01', f'{year:04d}-12')
        range_months = _iter_month_keys(range_from_key, range_to_key)
        needed_months = sorted(set(year_months) | set(range_months))

        range_start = _month_start(range_from_key)
        range_end = _month_end(range_to_key)
        year_start = date(year, 1, 1)
        year_end = date(year, 12, 31)

        # نافذة الحضور: كل شهور التقارير مع 6 أيام إضافية لاحتساب أول أحد.
        record_start = min(year_start, range_start) - timedelta(days=6)
        record_end = max(year_end, range_end)
        # نافذة السُلف: السنة المختارة + آخر ~3 شهور + نطاق التقارير + اليوم الحالي.
        loans_start = min(year_start, range_start, today - timedelta(days=92))
        loans_end = max(year_end, range_end, today)

        employees = list(
            rank_scoped_queryset(
                HREmployee.objects.select_related('job')
                .prefetch_related('recurring_bonus_plans')
                .exclude(rank_level=RANK_SUDO),
                request,
                field='rank_level',
            ).order_by('name')
        )

        attendance_qs = rank_scoped_queryset(
            HRAttendanceRecord.objects.exclude(employee__rank_level=RANK_SUDO)
            .select_related('employee'),
            request,
            field='employee__rank_level',
        )
        penalty_qs = rank_scoped_queryset(
            HRPenalty.objects.exclude(employee__rank_level=RANK_SUDO).select_related('employee'),
            request,
            field='employee__rank_level',
        )
        loan_qs = rank_scoped_queryset(
            HRLoan.objects.exclude(employee__rank_level=RANK_SUDO)
            .select_related('employee', 'employee__job'),
            request,
            field='employee__rank_level',
        )
        direct_bonus_qs = rank_scoped_queryset(
            HRDirectBonus.objects.exclude(employee__rank_level=RANK_SUDO).select_related('employee'),
            request,
            field='employee__rank_level',
        )

        available_years = self._available_years(year, today, attendance_qs, penalty_qs, loan_qs)

        window_records = list(attendance_qs.filter(date__gte=record_start, date__lte=record_end))
        window_penalties = list(penalty_qs.filter(date__gte=record_start, date__lte=record_end))
        window_loans = list(loan_qs.filter(date__gte=loans_start, date__lte=loans_end))
        window_bonuses = list(direct_bonus_qs.filter(date__gte=record_start, date__lte=record_end))

        records_by_employee = defaultdict(list)
        for record in window_records:
            records_by_employee[record.employee_id].append(record)
        penalties_by_employee = defaultdict(list)
        for penalty in window_penalties:
            penalties_by_employee[penalty.employee_id].append(penalty)
        loans_by_employee = defaultdict(list)
        for loan in window_loans:
            loans_by_employee[loan.employee_id].append(loan)
        bonuses_by_employee = defaultdict(list)
        for bonus in window_bonuses:
            bonuses_by_employee[bonus.employee_id].append(bonus)

        settings = HRAttendanceSettings.objects.first()
        weekly_off_index = weekly_off_weekday(settings)

        def up_to_for(month_key):
            if month_key == default_month and today < _month_end(month_key):
                return today - timedelta(days=1)
            return None

        # جلب الكشوف المعتمدة والمغلقة للشهور المطلوبة لاستخدام الأرقام المجمّدة (مع احترام الرتبة).
        allowed_ranks = visible_rank_levels(get_viewer_rank(request))
        locked_snapshots = {
            snap.month: snap
            for snap in HRPayrollSnapshot.objects.filter(month__in=needed_months, is_locked=True)
        }
        snapshot_rows_by_month = {}
        for snap_month, snap in locked_snapshots.items():
            by_emp = {}
            for idx, row in enumerate(snap.rows_json or []):
                row_rank = coerce_rank_level(row.get('rank_level'), DEFAULT_RANK_LEVEL)
                if row_rank not in allowed_ranks:
                    continue
                emp_key = str(row.get('employee_id') or f'snap-{idx}')
                by_emp[emp_key] = {
                    'earned_base': float(row.get('earned_base') or 0),
                    'overtime_pay': float(row.get('overtime_pay') or 0),
                    'bonus_pay': float(row.get('bonus_pay') or 0),
                    'loan_amount': float(row.get('loan_deduction', row.get('loan_amount')) or 0),
                    'attendance_deduction': float(row.get('attendance_deduction') or 0),
                    'penalty_deduction': float(row.get('penalty_deduction') or 0),
                    'deductions': float(row.get('attendance_deduction') or 0) + float(row.get('penalty_deduction') or 0),
                    'net_pay': float(row.get('net_pay') or 0),
                    'payable_cash': float(row.get('payable_cash', max(0.0, float(row.get('net_pay') or 0))) or 0),
                    'department': row.get('department') or 'other',
                    'department_label': row.get('department_label') or row.get('department') or '—',
                }
            snapshot_rows_by_month[snap_month] = by_emp

        employee_rows = {}
        for employee in employees:
            employee_records = records_by_employee.get(employee.id, [])
            records_by_date = {}
            for record in employee_records:
                # لا نستبعد السجل عند رفض الخصم (rejected): رفض الخصم يلغي الغرامة فقط ولا يلغي الحضور.
                records_by_date[record.date] = record
            emp_ext_id = _ext_id(employee)
            per_month = {}
            for month_key in needed_months:
                if month_key in snapshot_rows_by_month:
                    snap_row = snapshot_rows_by_month[month_key].get(emp_ext_id)
                    if snap_row is not None:
                        per_month[month_key] = snap_row
                    else:
                        per_month[month_key] = {
                            'earned_base': 0.0, 'overtime_pay': 0.0, 'loan_amount': 0.0,
                            'attendance_deduction': 0.0, 'penalty_deduction': 0.0,
                            'deductions': 0.0, 'net_pay': 0.0,
                        }
                    continue
                # للشهر المفتوح: الموظف غير النشط بدون أي سجلات حضور/سلف/جزاءات لا يُدرج.
                if not employee.is_active:
                    has_activity = (
                        any(str(r.date).startswith(month_key) for r in employee_records)
                        or any(str(p.date).startswith(month_key) for p in penalties_by_employee.get(employee.id, []))
                        or any(str(l.date).startswith(month_key) for l in loans_by_employee.get(employee.id, []))
                    )
                    if not has_activity:
                        per_month[month_key] = {
                            'earned_base': 0.0, 'overtime_pay': 0.0, 'loan_amount': 0.0,
                            'attendance_deduction': 0.0, 'penalty_deduction': 0.0,
                            'deductions': 0.0, 'net_pay': 0.0,
                        }
                        continue
                emp_plans = [p for p in employee.recurring_bonus_plans.all() if p.is_active]
                per_month[month_key] = _payroll_for_employee_month(
                    employee,
                    employee_records,
                    records_by_date,
                    penalties_by_employee.get(employee.id, []),
                    loans_by_employee.get(employee.id, []),
                    month_key,
                    settings,
                    up_to_for(month_key),
                    weekly_off_index,
                    direct_bonuses=bonuses_by_employee.get(employee.id, []),
                    bonus_plans=emp_plans,
                )
            employee_rows[employee.id] = per_month

        active_workers = sum(1 for employee in employees if employee.is_active)

        return Response(self._build_payload(
            year=year,
            today=today,
            year_months=year_months,
            range_months=range_months,
            range_from_key=range_from_key,
            range_to_key=range_to_key,
            range_start=range_start,
            range_end=range_end,
            employees=employees,
            employee_rows=employee_rows,
            snapshot_rows_by_month=snapshot_rows_by_month,
            active_workers=active_workers,
            window_records=window_records,
            window_loans=window_loans,
            available_years=available_years,
            weekly_off_index=weekly_off_index,
            can_view_salaries=(
                is_sudo_profile(profile)
                or profile.has_perm('hr_payroll')
                or profile.has_perm('can_manage_hr')
                or profile.has_perm('manage_permissions')
            ),
        ))

    # ------------------------------------------------------------------
    # Static builders
    # ------------------------------------------------------------------
    @staticmethod
    def _available_years(year, today, attendance_qs, penalty_qs, loan_qs):
        years = {today.year, year}
        for queryset in (attendance_qs, penalty_qs, loan_qs):
            try:
                for value in queryset.dates('date', 'year'):
                    years.add(value.year)
            except Exception:
                continue
        return sorted((value for value in years if 2000 <= value <= 2100), reverse=True)

    @classmethod
    def _build_payload(cls, *, year, today, year_months, range_months,
                       range_from_key, range_to_key, range_start, range_end,
                       employees, employee_rows, active_workers,
                       window_records, window_loans, available_years,
                       snapshot_rows_by_month=None,
                       weekly_off_index=DEFAULT_WEEKLY_OFF_WEEKDAY,
                       can_view_salaries=True):
        snapshot_rows_by_month = snapshot_rows_by_month or {}
        # --- التقرير السنوي + تفصيل الأقسام لكل شهر ---
        months_payload = []
        monthly_departments = {}
        annual_totals = {'net': 0.0, 'loans': 0.0, 'overtime': 0.0, 'deductions': 0.0}

        def _rows_for_month(m_key):
            if m_key in snapshot_rows_by_month:
                return list(snapshot_rows_by_month[m_key].values())
            return [employee_rows[employee.id][m_key] for employee in employees]

        for month_key in year_months:
            rows = _rows_for_month(month_key)
            agg = _sum_rows(rows)
            months_payload.append({
                'month': month_key,
                'label': _month_label(month_key),
                'active_workers': len(rows) if month_key in snapshot_rows_by_month else active_workers,
                'earned_salary': _round_half_up(agg['earned'], 2),
                'overtime_bonus': _round_half_up(agg['overtime'], 2),
                'loans': _round_half_up(agg['loans'], 2),
                'deductions': _round_half_up(agg['deductions'], 2),
                'net_paid': _round_half_up(agg['net'], 2),
            })
            annual_totals['net'] += agg['net']
            annual_totals['loans'] += agg['loans']
            annual_totals['overtime'] += agg['overtime']
            annual_totals['deductions'] += agg['deductions']
            monthly_departments[month_key] = _department_breakdown(
                employees, employee_rows, [month_key], snapshot_rows_by_month=snapshot_rows_by_month
            )

        elapsed_months = max(1, today.month) if year == today.year else 12
        annual_kpis = {
            'net_salary_total': _round_half_up(annual_totals['net'], 2),
            'loans_total': _round_half_up(annual_totals['loans'], 2),
            'overtime_bonus_total': _round_half_up(annual_totals['overtime'], 2),
            'deductions_total': _round_half_up(annual_totals['deductions'], 2),
            'avg_monthly_labor_cost': _round_half_up(annual_totals['net'] / float(elapsed_months), 2),
            'active_workers': active_workers,
        }

        # --- مقارنة الشهور داخل النطاق ---
        comparison = []
        previous_net = None
        for month_key in range_months:
            rows = _rows_for_month(month_key)
            agg = _sum_rows(rows)
            change_pct = None
            if previous_net is not None and previous_net != 0:
                change_pct = round((agg['net'] - previous_net) / abs(previous_net) * 100.0, 1)
            comparison.append({
                'month': month_key,
                'label': _month_label(month_key),
                'net': _round_half_up(agg['net'], 2),
                'loans': _round_half_up(agg['loans'], 2),
                'deductions': _round_half_up(agg['deductions'], 2),
                'overtime': _round_half_up(agg['overtime'], 2),
                'net_change_pct': change_pct,
            })
            previous_net = agg['net']

        department_breakdown = _department_breakdown(
            employees, employee_rows, range_months, snapshot_rows_by_month=snapshot_rows_by_month
        )

        # --- خريطة حرارة السُلف ---
        loans_by_day = {}
        for loan in window_loans:
            key = loan.date.isoformat()
            bucket = loans_by_day.setdefault(key, {
                'date': key, 'total': 0.0, 'count': 0, 'items': [],
            })
            amount = float(loan.amount or 0)
            bucket['total'] += amount
            bucket['count'] += 1
            employee = loan.employee
            bucket['items'].append({
                'id': _ext_id(loan),
                'employee_id': _ext_id(employee),
                'employee_code': employee.employee_code if employee else '',
                'employee_name': employee.name if employee else '',
                'department': employee.department if employee else '',
                'department_label': employee.department_label if employee else '',
                'amount': round(amount, 2),
                'notes': loan.notes or '',
            })
        for bucket in loans_by_day.values():
            bucket['total'] = round(bucket['total'], 2)
            bucket['items'].sort(key=lambda item: item['employee_name'])

        if not can_view_salaries:
            for m_row in months_payload:
                m_row['earned_salary'] = 0.0
                m_row['overtime_bonus'] = 0.0
                m_row['deductions'] = 0.0
                m_row['net_paid'] = 0.0
            annual_kpis['net_salary_total'] = 0.0
            annual_kpis['overtime_bonus_total'] = 0.0
            annual_kpis['deductions_total'] = 0.0
            annual_kpis['avg_monthly_labor_cost'] = 0.0
            for c_row in comparison:
                c_row['net'] = 0.0
                c_row['overtime'] = 0.0
                c_row['deductions'] = 0.0
                c_row['net_change_pct'] = None

            # صفوف الأقسام تُرجع المفاتيح earned/overtime/loans/deductions/net/percent
            # (ولا يوجد مفتاح اسمه net_salary)، لذا نُصفّر حقول الرواتب الفعلية كلها
            # وإلا بقيت تكلفة العمالة مكشوفة لمن لا يملك صلاحية الرواتب.
            def _scrub_department_rows(rows):
                for d_row in rows:
                    for field in ('earned', 'overtime', 'loans', 'deductions', 'net', 'percent'):
                        if field in d_row:
                            d_row[field] = 0.0

            _scrub_department_rows(department_breakdown)
            for m_depts in monthly_departments.values():
                _scrub_department_rows(m_depts)

        return {
            'available_years': available_years,
            'year': year,
            'active_workers': active_workers,
            'range_from': range_from_key,
            'range_to': range_to_key,
            'annual': {
                'kpis': annual_kpis,
                'months': months_payload,
                'monthly_departments': monthly_departments,
            },
            'range': {
                'from': range_from_key,
                'to': range_to_key,
                'comparison': comparison,
                'department_breakdown': department_breakdown,
                'discipline': cls._build_discipline(
                    employees, window_records, range_start, range_end, weekly_off_index=weekly_off_index
                ),
            },
            'loans_by_day': loans_by_day,
            'loans_summary': cls._build_loans_summary(
                loans_by_day, today, year, weekly_off_index
            ),
        }

    @staticmethod
    def _build_discipline(employees, window_records, range_start, range_end,
                          weekly_off_index=DEFAULT_WEEKLY_OFF_WEEKDAY):
        """أكثر العمال التزاماً / أكثرهم غياباً وتأخيراً / أكثر قسم غياباً."""
        employees_by_id = {employee.id: employee for employee in employees}
        stats = {}

        for record in window_records:
            if record.employee_id not in employees_by_id:
                continue
            if not (range_start <= record.date <= range_end):
                continue
            # يوم الإجازة الأسبوعية الرسمي بدون بصمة لا يُعدّ غياباً ولا يُحسب ضمن أيام الالتزام.
            if record.date.weekday() == weekly_off_index and not record.check_in:
                continue
            entry = stats.setdefault(record.employee_id, {
                'present': 0, 'absent': 0, 'late': 0.0,
            })
            if _is_attended(record):
                entry['present'] += 1
            if (record.status == 'absent' and not record.is_excused) or (
                record.status == 'leave' and not record.is_excused
            ):
                entry['absent'] += 1
            entry['late'] += float(record.late_minutes or 0)

        def payload(employee, entry):
            return {
                'employee_id': _ext_id(employee),
                'employee_code': employee.employee_code or '',
                'name': employee.name,
                'department': employee.department or '',
                'department_label': employee.department_label or '',
                'present_days': entry['present'],
                'absent_days': entry['absent'],
                'late_minutes': round(entry['late'], 1),
            }

        committed = [
            (employees_by_id[employee_id], entry)
            for employee_id, entry in stats.items()
            if entry['present'] > 0
        ]
        committed.sort(key=lambda pair: (-pair[1]['present'], pair[1]['late'], pair[1]['absent']))

        absent_list = [
            (employees_by_id[employee_id], entry)
            for employee_id, entry in stats.items()
            if entry['absent'] > 0 or entry['late'] > 0
        ]
        absent_list.sort(key=lambda pair: (-pair[1]['absent'], -pair[1]['late']))

        department_stats = {}
        for employee_id, entry in stats.items():
            employee = employees_by_id[employee_id]
            department = employee.department or 'other'
            group = department_stats.setdefault(department, {
                'label': employee.department_label or department,
                'absent': 0,
                'late': 0.0,
            })
            group['absent'] += entry['absent']
            group['late'] += entry['late']

        worst_department = None
        for department, group in department_stats.items():
            if group['absent'] <= 0:
                continue
            candidate = {
                'department': department,
                'label': group['label'],
                'absent_count': group['absent'],
                'late_minutes': round(group['late'], 1),
            }
            if worst_department is None or (
                candidate['absent_count'], candidate['late_minutes']
            ) > (
                worst_department['absent_count'], worst_department['late_minutes']
            ):
                worst_department = candidate

        return {
            'most_committed': [payload(emp, entry) for emp, entry in committed[:5]],
            'most_absent': [payload(emp, entry) for emp, entry in absent_list[:5]],
            'worst_department': worst_department,
        }

    @staticmethod
    def _build_loans_summary(loans_by_day, today, year,
                             weekly_off_index=DEFAULT_WEEKLY_OFF_WEEKDAY):
        """إجمالي الأسبوع / إجمالي الشهر الحالي / أعلى يوم صرف خلال السنة."""
        def sum_range(start, end):
            total = 0.0
            count = 0
            cursor = start
            while cursor <= end:
                bucket = loans_by_day.get(cursor.isoformat())
                if bucket:
                    total += bucket['total']
                    count += bucket['count']
                cursor += timedelta(days=1)
            return round(total, 2), count

        # الأسبوع يبدأ من يوم الإجازة الأسبوعية المحدد في الإعدادات
        # (date.weekday: الإثنين=0 ... الأحد=6).
        week_start = today - timedelta(days=(today.weekday() - weekly_off_index) % 7)
        week_end = week_start + timedelta(days=6)
        month_start = date(today.year, today.month, 1)
        month_end = date(
            today.year, today.month, calendar.monthrange(today.year, today.month)[1]
        )

        week_total, week_count = sum_range(week_start, week_end)
        month_total, month_count = sum_range(month_start, month_end)

        top_day = None
        for key, bucket in loans_by_day.items():
            try:
                cursor = date.fromisoformat(key)
            except ValueError:
                continue
            if cursor.year != year:
                continue
            if top_day is None or bucket['total'] > top_day['total']:
                top_day = {
                    'date': key,
                    'total': bucket['total'],
                    'count': bucket['count'],
                }

        return {
            'week_total': week_total,
            'week_count': week_count,
            'week_from': week_start.isoformat(),
            'week_to': week_end.isoformat(),
            'month_total': month_total,
            'month_count': month_count,
            'month_key': f'{today.year:04d}-{today.month:02d}',
            'top_day': top_day,
        }
