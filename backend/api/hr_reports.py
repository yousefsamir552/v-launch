"""
تجميع تقارير وتحليلات الموارد البشرية بالكامل داخل الباك إند.

كل الأرقام تُحسب هنا (وليس في المتصفح) لتقليل استهلاك النطاق الترددي،
ولضمان تطابق 100% مع منطق شاشة "المرتبات" في الواجهة:
    * أجر اليوم = المرتب ÷ 30، وأجر الساعة = أجر اليوم ÷ 8.
    * خصم التأخير/الانصراف المبكر يُقرأ من calculated_deduction_* (مع fallback
      لشرائح قواعد الحضور عند عدم تخزينه).
    * استحقاق الشهر (attendedDays + paidSundayDays، وحد أقصى 30 يوماً).
    * الجزاءات اليدوية والسُلف حسب تاريخ الشهر.
    * الصافي = الأجر المكتسب + الإضافي − (خصم الحضور + الجزاءات + السُلف).

الرؤية مقيّدة برتبة المستخدم الحالي (rank_level) مع استبعاد حساب Sudo نهائياً.
"""

import calendar
from collections import defaultdict
from datetime import date, timedelta

from rest_framework import viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from .models import (
    HREmployee,
    HRAttendanceRecord,
    HRPenalty,
    HRLoan,
    HRAttendanceSettings,
    RANK_SUDO,
)
from .permissions import IsAuthenticatedProfile
from .hr_attendance_io import DEFAULT_WEEKLY_OFF_WEEKDAY, weekly_off_weekday
from .views import (
    is_sudo_profile,
    rank_scoped_queryset,
    resolve_request_user_profile,
)


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
    """حضور فعلي: حاضر / إجازة بعذر / لها بصمة حضور."""
    if record is None:
        return False
    if record.status == 'present':
        return True
    if record.status == 'leave' and record.is_excused:
        return True
    return bool(record.check_in)


def _weekly_off_ratio(absent_count):
    if absent_count >= 5:
        return 1.0
    if absent_count == 4:
        return 2.0 / 3.0
    if absent_count == 3:
        return 0.5
    if absent_count == 2:
        return 1.0 / 3.0
    return 0.0


def _weekly_off_deduction_for_date(records_by_date, off_date):
    """نسبة خصم يوم الإجازة الأسبوعية وفق غياب الأيام الستة السابقة له."""
    week_dates = [off_date - timedelta(days=offset) for offset in range(6, 0, -1)]
    if not any(day in records_by_date for day in week_dates):
        return 0.0
    absent_count = 0
    for day in week_dates:
        record = records_by_date.get(day)
        if record is None or (not record.is_excused and not record.check_in):
            absent_count += 1
    return _weekly_off_ratio(absent_count)


def _compute_month_accrual(records_by_date, month_key, up_to_iso,
                           weekly_off_index=DEFAULT_WEEKLY_OFF_WEEKDAY):
    """استحقاق الشهر على أساس الحضور الفعلي + أيام الإجازة الأسبوعية المدفوعة (حد 30 يوماً)."""
    y, m = (int(part) for part in month_key.split('-'))
    last_day = calendar.monthrange(y, m)[1]
    attended_days = 0.0
    workdays_in_scope = 0
    paid_weekly_off_days = 0.0

    for day in range(1, last_day + 1):
        cursor = date(y, m, day)
        record = records_by_date.get(cursor)
        has_check_in = bool(record and record.check_in)
        if up_to_iso and cursor > up_to_iso and not has_check_in:
            continue
        # يوم الإجازة الأسبوعية المدفوعة (يأتي من إعدادات الحضور، والأحد افتراضياً).
        if cursor.weekday() == weekly_off_index:
            if has_check_in:
                workdays_in_scope += 1
                attended_days += 1
                continue
            week_dates = [cursor - timedelta(days=offset) for offset in range(6, 0, -1)]
            if any(day_key in records_by_date for day_key in week_dates):
                paid_weekly_off_days += max(0.0, 1.0 - _weekly_off_deduction_for_date(records_by_date, cursor))
            continue
        workdays_in_scope += 1
        if record and _is_attended(record):
            attended_days += 1

    earned_days = attended_days + paid_weekly_off_days
    month_last = date(y, m, last_day)
    month_complete = up_to_iso is None or up_to_iso >= month_last
    if month_complete and workdays_in_scope > 0 and attended_days >= workdays_in_scope:
        earned_days = 30.0
    earned_days = min(30.0, earned_days)

    return {
        'attended_days': round(attended_days, 2),
        'paid_sunday_days': round(paid_weekly_off_days, 2),
        'earned_days': round(earned_days, 2),
    }


def _minutes_from_time(value):
    if value is None:
        return None
    try:
        return value.hour * 60 + value.minute
    except AttributeError:
        return None


def _late_minutes(check_in, official_start):
    ci = _minutes_from_time(check_in)
    start = _minutes_from_time(official_start)
    if ci is None or start is None:
        return 0.0
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
    hour_rate = day_rate / 8.0
    official_start = getattr(settings, 'official_start_time', None) if settings else None
    rules = getattr(settings, 'rules_json', None) if settings else None

    attendance_days = 0.0
    attendance_hours = 0.0
    overtime_days = 0.0
    overtime_hours = 0.0

    for record in employee_records:
        if not str(record.date).startswith(month_key):
            continue
        if record.review_status == 'rejected':
            continue
        # يوم الإجازة الأسبوعية بدون بصمة حضور = إجازة مدفوعة (لا إضافي/خصم عليه).
        if record.date.weekday() == weekly_off_index and not record.check_in:
            continue

        overtime_days += float(record.overtime_days or 0)
        overtime_hours += float(record.overtime_hours or 0)

        # الغياب غير محسوب أصلاً في الأيام المستحقة، فلا يُخصم مرتين.
        if not _is_attended(record):
            continue
        if record.is_excused:
            continue

        ded_days = float(record.calculated_deduction_days or 0)
        ded_hours = float(record.calculated_deduction_hours or 0)
        if ded_days == 0 and ded_hours == 0:
            late = _late_minutes(record.check_in, official_start)
            rule = _match_late_rule(rules, late)
            rule_value = float(rule.get('deduction_value') or 0) if rule else 0.0
            if rule and rule_value > 0:
                if rule.get('deduction_type') == 'days':
                    ded_days = rule_value
                else:
                    ded_hours = rule_value
        attendance_days += ded_days
        attendance_hours += ded_hours

    accrual = _compute_month_accrual(records_by_date, month_key, up_to_iso, weekly_off_index)
    earned_base = accrual['earned_days'] * day_rate

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
        'earned_base': earned_base,
        'overtime_pay': overtime_pay,
        'loan_amount': loan_amount,
        'attendance_deduction': attendance_deduction,
        'penalty_deduction': penalty_deduction,
        'deductions': attendance_deduction + penalty_deduction,
        'net_pay': earned_base + overtime_pay - total_deduction,
    }


def _sum_rows(rows):
    return {
        'earned': sum(row['earned_base'] for row in rows),
        'overtime': sum(row['overtime_pay'] for row in rows),
        'loans': sum(row['loan_amount'] for row in rows),
        'deductions': sum(row['deductions'] for row in rows),
        'net': sum(row['net_pay'] for row in rows),
    }


def _department_breakdown(employees, employee_month_rows, month_keys):
    """تجميع تكلفة العمالة حسب القسم خلال الشهور المطلوبة."""
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
        per_month = employee_month_rows.get(employee.id, {})
        for month_key in month_keys:
            row = per_month.get(month_key)
            if row:
                group['rows'].append(row)

    result = []
    for group in groups.values():
        agg = _sum_rows(group['rows'])
        result.append({
            'department': group['department'],
            'label': group['label'],
            'workers': group['workers'],
            'earned': round(agg['earned'], 2),
            'overtime': round(agg['overtime'], 2),
            'loans': round(agg['loans'], 2),
            'deductions': round(agg['deductions'], 2),
            'net': round(agg['net'], 2),
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

        today = date.today()
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
        # نافذة السُلف: السنة المختارة + آخر ~3 شهور + نطاق التقارير.
        loans_start = min(year_start, range_start, today - timedelta(days=92))
        loans_end = max(year_end, range_end)

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
            if month_key == default_month:
                return today - timedelta(days=1)
            return None

        employee_rows = {}
        for employee in employees:
            employee_records = records_by_employee.get(employee.id, [])
            records_by_date = {}
            for record in employee_records:
                if record.review_status == 'rejected':
                    continue
                records_by_date[record.date] = record
            per_month = {}
            for month_key in needed_months:
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
            active_workers=active_workers,
            window_records=window_records,
            window_loans=window_loans,
            available_years=available_years,
            weekly_off_index=weekly_off_index,
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
                       weekly_off_index=DEFAULT_WEEKLY_OFF_WEEKDAY):
        # --- التقرير السنوي + تفصيل الأقسام لكل شهر ---
        months_payload = []
        monthly_departments = {}
        annual_totals = {'net': 0.0, 'loans': 0.0, 'overtime': 0.0, 'deductions': 0.0}

        for month_key in year_months:
            rows = [employee_rows[employee.id][month_key] for employee in employees]
            agg = _sum_rows(rows)
            months_payload.append({
                'month': month_key,
                'label': _month_label(month_key),
                'active_workers': active_workers,
                'earned_salary': round(agg['earned'], 2),
                'overtime_bonus': round(agg['overtime'], 2),
                'loans': round(agg['loans'], 2),
                'deductions': round(agg['deductions'], 2),
                'net_paid': round(agg['net'], 2),
            })
            annual_totals['net'] += agg['net']
            annual_totals['loans'] += agg['loans']
            annual_totals['overtime'] += agg['overtime']
            annual_totals['deductions'] += agg['deductions']
            monthly_departments[month_key] = _department_breakdown(
                employees, employee_rows, [month_key]
            )

        annual_kpis = {
            'net_salary_total': round(annual_totals['net'], 2),
            'loans_total': round(annual_totals['loans'], 2),
            'overtime_bonus_total': round(annual_totals['overtime'], 2),
            'deductions_total': round(annual_totals['deductions'], 2),
            'avg_monthly_labor_cost': round(annual_totals['net'] / 12.0, 2),
            'active_workers': active_workers,
        }

        # --- مقارنة الشهور داخل النطاق ---
        comparison = []
        previous_net = None
        for month_key in range_months:
            rows = [employee_rows[employee.id][month_key] for employee in employees]
            agg = _sum_rows(rows)
            change_pct = None
            if previous_net is not None and previous_net != 0:
                change_pct = round((agg['net'] - previous_net) / abs(previous_net) * 100.0, 1)
            comparison.append({
                'month': month_key,
                'label': _month_label(month_key),
                'net': round(agg['net'], 2),
                'loans': round(agg['loans'], 2),
                'deductions': round(agg['deductions'], 2),
                'overtime': round(agg['overtime'], 2),
                'net_change_pct': change_pct,
            })
            previous_net = agg['net']

        department_breakdown = _department_breakdown(employees, employee_rows, range_months)

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
                    employees, window_records, range_start, range_end
                ),
            },
            'loans_by_day': loans_by_day,
            'loans_summary': cls._build_loans_summary(
                loans_by_day, today, year, weekly_off_index
            ),
        }

    @staticmethod
    def _build_discipline(employees, window_records, range_start, range_end):
        """أكثر العمال التزاماً / أكثرهم غياباً وتأخيراً / أكثر قسم غياباً."""
        employees_by_id = {employee.id: employee for employee in employees}
        stats = {}

        for record in window_records:
            if record.employee_id not in employees_by_id:
                continue
            if record.review_status == 'rejected':
                continue
            if not (range_start <= record.date <= range_end):
                continue
            entry = stats.setdefault(record.employee_id, {
                'present': 0, 'absent': 0, 'late': 0.0,
            })
            if _is_attended(record):
                entry['present'] += 1
            if record.status == 'absent' or (
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
