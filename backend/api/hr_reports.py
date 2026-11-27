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
    absence_extra_penalty_days,
    effective_absence_decision,
    eligible_week_dates,
    is_attended_record,
    is_excused_unpaid_record,
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


def _round_half_up(value, places=2) -> float:
    """تقريب مالي مطابق لـ Math.round في الواجهة (ROUND_HALF_UP)."""
    try:
        dec = Decimal(str(float(value or 0.0)))
        if not dec.is_finite():
            return 0.0
        quant = Decimal('1').scaleb(-places)
        return float(dec.quantize(quant, rounding=ROUND_HALF_UP))
    except Exception:
        return round(float(value or 0.0), places)


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


def _weekly_off_deduction_for_date(records_by_date, off_date, hire_date=None, termination_date=None):
    """نسبة خصم يوم الإجازة الأسبوعية وفق الغياب بدون عذر في الأيام الستة السابقة ضمن فترة التوظيف."""
    raw_week_dates = [off_date - timedelta(days=offset) for offset in range(6, 0, -1)]
    week_dates = eligible_week_dates(raw_week_dates, hire_date=hire_date, termination_date=termination_date)
    if not week_dates or not any(day in records_by_date for day in week_dates):
        return 0.0
    absent_count = 0
    for day in week_dates:
        record = records_by_date.get(day)
        if is_unexcused_absence_record(record):
            absent_count += 1
    return _weekly_off_ratio(absent_count)


def _compute_month_accrual(records_by_date, month_key, up_to_iso,
                           weekly_off_index=DEFAULT_WEEKLY_OFF_WEEKDAY,
                           weekly_off_work_multiplier=1.0,
                           hire_date=None,
                           termination_date=None):
    """
    استحقاق الشهر وفق قواعد المصنع الرسمية النهائية:
    - النطاق الفعلي للموظف = [max(month_start, hire_date), min(month_end, termination_date)].
      أي يوم خارج هذا النطاق يُتجاهل تماماً (لا غياب ولا إجازة أسبوعية ولا خصم أحد).
    1) الموظف المنتظم طوال الشهر (لا تعيين ولا ترك داخل الشهر) في شهر مكتمل:
       base_earned = max(0, 30 - total_unpaid_absence_days - sunday_deduction_days)
       أياً كان عدد أيام الشهر (28 / 29 / 30 / 31).
    2) المعيَّن في منتصف الشهر (hire_date > month_start) أو التارك قبل نهاية الشهر (termination_date < month_end)
       أو منتصف الشهر المفتوح (month_complete = False):
       base_earned = min(30, attended_regular_days + paid_weekly_off_days).
    3) العمل يوم الإجازة الأسبوعية يُضاف فوق سقف الـ 30 يوماً بمعامل weekly_off_work_multiplier.
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

    if effective_start > effective_end:
        return {
            'attended_days': 0.0,
            'paid_sunday_days': 0.0,
            'worked_weekly_off_days': 0.0,
            'weekly_off_extra_days': 0.0,
            'sunday_deduction_days': 0.0,
            'unexcused_absence_days': 0.0,
            'excused_unpaid_absence_days': 0.0,
            'is_partial_month': is_partial_month,
            'earned_days': 0.0,
            '_earned_days_raw': 0.0,
        }

    attended_regular_days = 0.0
    worked_weekly_off_days = 0.0
    workdays_in_scope = 0
    paid_weekly_off_days = 0.0
    unexcused_absence_days = 0.0
    excused_unpaid_absence_days = 0.0
    sunday_deduction_days = 0.0
    try:
        mult = max(0.0, float(weekly_off_work_multiplier))
    except (TypeError, ValueError):
        mult = 1.0

    month_complete = up_to_iso is None or up_to_iso >= month_last

    for day in range(1, last_day + 1):
        cursor = date(y, m, day)
        if cursor < effective_start or cursor > effective_end:
            continue
        record = records_by_date.get(cursor)
        has_check_in = bool(record and record.check_in)
        has_any_punch = bool(record and (record.check_in or record.check_out))
        if up_to_iso and cursor > up_to_iso and not has_any_punch:
            continue

        if cursor.weekday() == weekly_off_index:
            raw_week_dates = [cursor - timedelta(days=offset) for offset in range(6, 0, -1)]
            scoped_week = eligible_week_dates(
                raw_week_dates, hire_date=hire_date, termination_date=termination_date
            )
            if scoped_week and any(day_key in records_by_date for day_key in scoped_week):
                ded = _weekly_off_deduction_for_date(
                    records_by_date, cursor, hire_date=hire_date, termination_date=termination_date
                )
                sunday_deduction_days += ded
                paid_weekly_off_days += max(0.0, 1.0 - ded)
            elif month_complete and not is_partial_month:
                # أسبوع كامل بلا أي حضور لموظف منتظم في شهر مكتمل => خصم يوم الإجازة كاملاً.
                sunday_deduction_days += 1.0
            if has_check_in:
                worked_weekly_off_days += 1.0
            continue

        workdays_in_scope += 1
        if record and _is_attended(record):
            attended_regular_days += 1.0
        elif record and is_excused_unpaid_record(record):
            excused_unpaid_absence_days += 1.0
        else:
            unexcused_absence_days += 1.0

    attended_days = attended_regular_days + worked_weekly_off_days
    weekly_off_extra_days = worked_weekly_off_days * mult
    total_unpaid_absence_days = unexcused_absence_days + excused_unpaid_absence_days

    if attended_regular_days == 0 and worked_weekly_off_days == 0:
        # بدون أي حضور فعلي خلال الشهر نفسه: الاستحقاق = 0 (يمنع المرتب الوهمي للمستقيلين والشهور المستقبلية).
        paid_weekly_off_days = 0.0
        sunday_deduction_days = 0.0
        earned_days_raw = 0.0
    elif month_complete and not is_partial_month:
        # الموظف المنتظم طوال الشهر: نحاسب بالشهر (30 يوماً) ونخصم أيام الغياب وخصم الإجازة الأسبوعية.
        base_earned = max(0.0, 30.0 - total_unpaid_absence_days - sunday_deduction_days)
        earned_days_raw = base_earned + weekly_off_extra_days
    else:
        # المعيَّن أو التارك في منتصف الشهر (أو الشهر المفتوح قبل نهايته): نحاسب بالأيام الفعلية.
        base_earned = min(30.0, attended_regular_days + paid_weekly_off_days)
        earned_days_raw = base_earned + weekly_off_extra_days

    return {
        'attended_days': _round_half_up(attended_days, 2),
        'paid_sunday_days': _round_half_up(paid_weekly_off_days, 2),
        'worked_weekly_off_days': _round_half_up(worked_weekly_off_days, 2),
        'weekly_off_extra_days': _round_half_up(weekly_off_extra_days, 2),
        'sunday_deduction_days': _round_half_up(sunday_deduction_days, 2),
        'unexcused_absence_days': _round_half_up(unexcused_absence_days, 2),
        'excused_unpaid_absence_days': _round_half_up(excused_unpaid_absence_days, 2),
        'is_partial_month': is_partial_month,
        'earned_days': _round_half_up(earned_days_raw, 2),
        '_earned_days_raw': earned_days_raw,
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


# ---------------------------------------------------------------------------
# Helpers — monthly payroll row (mirror of PayrollPanel)
# ---------------------------------------------------------------------------
def _payroll_for_employee_month(employee, employee_records, records_by_date,
                                penalties, loans, month_key, settings, up_to_iso,
                                weekly_off_index=DEFAULT_WEEKLY_OFF_WEEKDAY):
    salary = float(employee.monthly_salary or 0)
    day_rate = salary / 30.0
    shift_hours = working_hours_per_day(settings)
    hour_rate = day_rate / shift_hours
    official_start = getattr(settings, 'official_start_time', None) if settings else None
    official_end = getattr(settings, 'official_end_time', None) if settings else None
    rules = getattr(settings, 'rules_json', None) if settings else None
    raw_mult = getattr(settings, 'weekly_off_work_multiplier', None) if settings else None
    try:
        weekly_off_mult = 1.0 if raw_mult is None else max(0.0, float(raw_mult))
    except (TypeError, ValueError):
        weekly_off_mult = 1.0

    hire_date = getattr(employee, 'hire_date', None)
    termination_date = getattr(employee, 'termination_date', None)
    extra_absence_days_default = absence_extra_penalty_days(rules)

    attendance_days = 0.0
    attendance_hours = 0.0
    overtime_days = 0.0
    overtime_hours = 0.0

    for record in employee_records:
        if not str(record.date).startswith(month_key):
            continue
        if hire_date and record.date < hire_date:
            continue
        if termination_date and record.date > termination_date:
            continue
        # يوم الإجازة الأسبوعية بدون بصمة حضور = إجازة مدفوعة (لا إضافي/خصم عليه).
        if record.date.weekday() == weekly_off_index and not record.check_in:
            continue

        # 1) سجل غير حاضر (غياب بدون عذر أو غياب بعذر): لا يُصرف له إضافي.
        if not _is_attended(record):
            if is_excused_unpaid_record(record):
                # غياب بعذر (خصم اليوم فقط داخل earned_days دون جزاء إضافي).
                continue
            # غياب بدون عذر (أو بدون قرار بعد): يُضاف يوم جزاء إضافي (أو القيمة المحددة) فوق يوم الغياب.
            if record.review_status == 'rejected':
                continue
            if getattr(record, 'manual_deduction', False):
                attendance_days += float(record.calculated_deduction_days or 0)
                attendance_hours += float(record.calculated_deduction_hours or 0)
            else:
                stored_d = float(record.calculated_deduction_days or 0)
                stored_h = float(record.calculated_deduction_hours or 0)
                if stored_d > 0 or stored_h > 0:
                    attendance_days += stored_d
                    attendance_hours += stored_h
                else:
                    attendance_days += extra_absence_days_default
            continue

        # 2) الإضافي يُحسب لأيام الحضور الفعلية فقط (بعد التأكد من _is_attended)،
        #    ويستمر احتسابه حتى عند رفض خصم التأخير.
        overtime_days += float(record.overtime_days or 0)
        overtime_hours += float(record.overtime_hours or 0)

        # الإجازة المدفوعة على حساب الشركة أو اليوم المعذور لا يُخصم عليه تأخير.
        if record.status in ('absent', 'leave') and effective_absence_decision(record) == 'paid_company':
            continue
        if record.is_excused:
            continue
        # الخصومات المرفوضة (rejected) أو بانتظار المراجعة (pending_review) لا تُخصم من الصافي.
        if record.review_status in ('rejected', 'pending_review'):
            continue

        ded_days = float(record.calculated_deduction_days or 0)
        ded_hours = float(record.calculated_deduction_hours or 0)
        # احترام التصفير اليدوي (manual_deduction=True): لا نُشغّل الـ Fallback الديناميكي أبداً.
        if (
            ded_days == 0
            and ded_hours == 0
            and not getattr(record, 'manual_deduction', False)
            and getattr(employee, 'rule_application_mode', 'auto') != 'manual_review'
        ):
            late = _late_minutes(record.check_in, official_start, official_end)
            rule = _match_late_rule(rules, late)
            rule_value = float(rule.get('deduction_value') or 0) if rule else 0.0
            if rule and rule_value > 0 and rule.get('apply_mode') != 'manual_review':
                if rule.get('deduction_type') == 'days':
                    ded_days = rule_value
                else:
                    ded_hours = rule_value
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
    )
    earned_base = accrual.get('_earned_days_raw', accrual['earned_days']) * day_rate

    penalty_days = 0.0
    penalty_hours = 0.0
    for penalty in penalties:
        if not str(penalty.date).startswith(month_key):
            continue
        value = float(penalty.value or 0)
        if penalty.penalty_type == 'days':
            penalty_days += value
        else:
            penalty_hours += value

    loan_amount = sum(
        float(loan.amount or 0)
        for loan in loans
        if str(loan.date).startswith(month_key)
    )

    attendance_deduction = attendance_days * day_rate + attendance_hours * hour_rate
    penalty_deduction = penalty_days * day_rate + penalty_hours * hour_rate
    overtime_pay = overtime_days * day_rate + overtime_hours * hour_rate
    total_deduction = attendance_deduction + penalty_deduction + loan_amount

    return {
        'base_salary': _round_half_up(salary, 2),
        'attended_days': accrual['attended_days'],
        'paid_sunday_days': accrual['paid_sunday_days'],
        'worked_weekly_off_days': accrual['worked_weekly_off_days'],
        'weekly_off_extra_days': accrual['weekly_off_extra_days'],
        'sunday_deduction_days': accrual['sunday_deduction_days'],
        'earned_days': accrual['earned_days'],
        'earned_base': _round_half_up(earned_base, 2),
        'overtime_days': _round_half_up(overtime_days, 2),
        'overtime_hours': _round_half_up(overtime_hours, 2),
        'overtime_pay': _round_half_up(overtime_pay, 2),
        'attendance_days': _round_half_up(attendance_days, 2),
        'attendance_hours': _round_half_up(attendance_hours, 2),
        'penalty_days': _round_half_up(penalty_days, 2),
        'penalty_hours': _round_half_up(penalty_hours, 2),
        'loan_amount': _round_half_up(loan_amount, 2),
        'attendance_deduction': _round_half_up(attendance_deduction, 2),
        'penalty_deduction': _round_half_up(penalty_deduction, 2),
        'deductions': _round_half_up(attendance_deduction + penalty_deduction, 2),
        'total_deduction': _round_half_up(total_deduction, 2),
        'net_pay': _round_half_up(earned_base + overtime_pay - total_deduction, 2),
    }


def _sum_rows(rows):
    return {
        'earned': sum(row['earned_base'] for row in rows),
        'overtime': sum(row['overtime_pay'] for row in rows),
        'loans': sum(row['loan_amount'] for row in rows),
        'deductions': sum(row['deductions'] for row in rows),
        # إجمالي النقد المطلوب دفعه: لا نطرح أرصدة سالبة لعامل من مستحقات زملائه.
        'net': sum(max(0.0, float(row['net_pay'] or 0)) for row in rows),
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
                HREmployee.objects.select_related('job').exclude(rank_level=RANK_SUDO),
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

        available_years = self._available_years(year, today, attendance_qs, penalty_qs, loan_qs)

        window_records = list(attendance_qs.filter(date__gte=record_start, date__lte=record_end))
        window_penalties = list(penalty_qs.filter(date__gte=record_start, date__lte=record_end))
        window_loans = list(loan_qs.filter(date__gte=loans_start, date__lte=loans_end))

        records_by_employee = defaultdict(list)
        for record in window_records:
            records_by_employee[record.employee_id].append(record)
        penalties_by_employee = defaultdict(list)
        for penalty in window_penalties:
            penalties_by_employee[penalty.employee_id].append(penalty)
        loans_by_employee = defaultdict(list)
        for loan in window_loans:
            loans_by_employee[loan.employee_id].append(loan)

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
                    'loan_amount': float(row.get('loan_deduction', row.get('loan_amount')) or 0),
                    'attendance_deduction': float(row.get('attendance_deduction') or 0),
                    'penalty_deduction': float(row.get('penalty_deduction') or 0),
                    'deductions': float(row.get('attendance_deduction') or 0) + float(row.get('penalty_deduction') or 0),
                    'net_pay': float(row.get('net_pay') or 0),
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
