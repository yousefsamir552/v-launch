"""
اختبارات شاملة لقواعد المصنع الرسمية النهائية للموارد البشرية والمرتبات (HR & Payroll Official Spec).

تغطي:
1. موظف منتظم في شهور 30 و31 و28 يوماً (حضور كامل = 30 يوماً، غياب بعذر = 29 يوماً، غياب بدون عذر = 28 يوماً،
   إجازة على حساب الشركة = 30 يوماً).
2. موظف جديد عُيّن يوم 15 أبريل وحضر 100% حتى يوم 30 (يأخذ أيامه الفعلية + إجازاته الأسبوعية المستحقة بدون أي خصم من 1–14).
3. موظف ترك العمل قبل نهاية الشهر (termination_date).
4. شرائح خصم يوم الإجازة الأسبوعية الخمس (0/1 -> 0، 2 -> 1/3، 3 -> 1/2، 4 -> 2/3، 5/6 -> 1) + عدم دخول excused_unpaid في الخصم.
5. البصمة الناقصة (check_out فقط) تُحسب حضوراً مؤقتاً وحالتها pending_review.
6. التصفير اليدوي للتأخير (manual_deduction=True, 0) يُحترم نهائياً ولا يُعاد خصمه.
7. أجر الساعة = salary / 30 / 9 (ساعات الشيفت الرسمية 08:30–17:30).
8. الإضافي لا يُصرف لسجل غير حاضر (absent) وعبور الشهور + تنظيف الأحد الشبح.
"""
import calendar
from datetime import date, time
from decimal import Decimal

from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from .hr_attendance_io import (
    compute_attendance,
    is_attended_record,
    reapply_employee_month,
    sunday_deduction_for_week,
    weekly_off_ratio_for_absences,
    working_hours_per_day,
)
from .hr_reports import _compute_month_accrual, _payroll_for_employee_month
from .models import (
    HRAttendanceRecord,
    HRAttendanceSettings,
    HREmployee,
    HRJobTitle,
    HRPenalty,
    RANK_LEVEL_ONE,
    Role,
    UserProfile,
)


def _make_hr_client():
    role = Role.objects.create(
        name='مدير HR',
        rank_level=RANK_LEVEL_ONE,
    )
    user = UserProfile.objects.create(
        username='hr_spec_tester',
        real_name='مدير الموارد البشرية',
        role=role,
        rank_level=RANK_LEVEL_ONE,
        is_active=True,
        auth_token='tok-hr-spec-tester',
        custom_permissions={
            'can_manage_hr': True,
            'hr_payroll': True,
            'hr_employees': True,
            'hr_attendance': True,
        },
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION='Bearer tok-hr-spec-tester')
    return client, user


class HRPayrollOfficialSpecTests(TestCase):
    def setUp(self):
        self.job = HRJobTitle.objects.create(title='خياط', department='sewing')
        self.settings = HRAttendanceSettings.objects.create(
            official_start_time=time(8, 30),
            official_end_time=time(17, 30),
            weekly_off_day='Sunday',
            month_calculation_days=30,
            weekly_off_work_multiplier=Decimal('1.00'),
            rules_json=[
                {
                    'id': 'late-10',
                    'violation_type': 'late_arrival',
                    'label': 'تأخير حتى 10 دقائق',
                    'from_minutes': 0,
                    'to_minutes': 10,
                    'deduction_type': 'days',
                    'deduction_value': 0.25,
                    'apply_mode': 'auto',
                },
                {
                    'id': 'absence-2d',
                    'violation_type': 'absence',
                    'label': 'غياب بدون عذر (خصم يومين)',
                    'from_minutes': 0,
                    'to_minutes': 0,
                    'deduction_type': 'days',
                    'deduction_value': 2,
                    'apply_mode': 'manual_review',
                },
            ],
            overtime_rules=[
                {
                    'id': 'ot-1',
                    'label': 'إضافي مسائي',
                    'from_time': '18:30',
                    'to_time': '21:00',
                    'reward_type': 'hours',
                    'reward_value': 2,
                }
            ],
        )
        self.emp = HREmployee.objects.create(
            name='محمد علي',
            employee_code='EMP-SPEC-01',
            job=self.job,
            monthly_salary=6000.0,
            rule_application_mode='auto',
        )

    def _seed_full_month_present(self, emp, year, month, overrides=None):
        """إنشاء سجلات حضور كاملة لكل أيام العمل (غير الأحد) في الشهر + آخر 6 أيام من الشهر السابق."""
        overrides = overrides or {}
        records = []
        # آخر 6 أيام من الشهر السابق لاحتساب أول أحد
        prev_year = year - 1 if month == 1 else year
        prev_month = 12 if month == 1 else month - 1
        prev_last = calendar.monthrange(prev_year, prev_month)[1]
        for d in range(prev_last - 5, prev_last + 1):
            cur = date(prev_year, prev_month, d)
            if cur.weekday() != 6:
                records.append(
                    HRAttendanceRecord.objects.create(
                        employee=emp,
                        date=cur,
                        check_in=time(8, 30),
                        check_out=time(17, 30),
                        status='present',
                    )
                )

        last_day = calendar.monthrange(year, month)[1]
        for d in range(1, last_day + 1):
            cur = date(year, month, d)
            if cur.weekday() == 6:
                continue
            ov = overrides.get(cur)
            if ov == 'skip':
                continue
            kwargs = {
                'employee': emp,
                'date': cur,
                'check_in': time(8, 30),
                'check_out': time(17, 30),
                'status': 'present',
            }
            if isinstance(ov, dict):
                kwargs.update(ov)
            records.append(HRAttendanceRecord.objects.create(**kwargs))
        return records

    # ------------------------------------------------------------------
    # 1. موظف منتظم في شهور 30 و31 و28 يوماً + خيارات الغياب الثلاثة
    # ------------------------------------------------------------------
    def test_regular_employee_months_30_31_28_and_three_absence_decisions(self):
        # نختبر شهور: أبريل 2026 (30 يوماً)، يناير 2026 (31 يوماً)، فبراير 2026 (28 يوماً)
        for year, month, sample_workday in (
            (2026, 4, date(2026, 4, 15)),   # 30 يوماً
            (2026, 1, date(2026, 1, 15)),   # 31 يوماً
            (2026, 2, date(2026, 2, 16)),   # 28 يوماً
        ):
            month_key = f'{year:04d}-{month:02d}'

            # أ) حضور كامل = 30 يوماً (6000 ج.م)
            HRAttendanceRecord.objects.filter(employee=self.emp).delete()
            recs = self._seed_full_month_present(self.emp, year, month)
            calc = _payroll_for_employee_month(
                self.emp, recs, {r.date: r for r in recs}, [], [], month_key, self.settings, None, 6
            )
            self.assertEqual(calc['earned_days'], 30.0, f'Full attendance failed for {month_key}')
            self.assertEqual(calc['net_pay'], 6000.0, f'Full net_pay failed for {month_key}')

            # ب) غياب يوم واحد بعذر (excused_unpaid) = 29 يوماً (5800 ج.م)
            HRAttendanceRecord.objects.filter(employee=self.emp).delete()
            recs = self._seed_full_month_present(
                self.emp,
                year,
                month,
                overrides={
                    sample_workday: {
                        'check_in': None,
                        'check_out': None,
                        'status': 'absent',
                        'is_excused': True,
                        'absence_decision': 'excused_unpaid',
                        'review_status': 'approved',
                    }
                },
            )
            calc = _payroll_for_employee_month(
                self.emp, recs, {r.date: r for r in recs}, [], [], month_key, self.settings, None, 6
            )
            self.assertEqual(calc['earned_days'], 29.0, f'Excused unpaid earned_days failed for {month_key}')
            self.assertEqual(calc['attendance_deduction'], 0.0)
            self.assertEqual(calc['net_pay'], 5800.0, f'Excused unpaid net_pay failed for {month_key}')

            # ج) غياب يوم واحد بدون عذر (unexcused) = خصم يومين -> صافي يعادل 28 يوماً (5600 ج.م)
            HRAttendanceRecord.objects.filter(employee=self.emp).delete()
            recs = self._seed_full_month_present(
                self.emp,
                year,
                month,
                overrides={
                    sample_workday: {
                        'check_in': None,
                        'check_out': None,
                        'status': 'absent',
                        'is_excused': False,
                        'absence_decision': 'unexcused',
                        'calculated_deduction_days': 1.0,
                        'review_status': 'approved',
                    }
                },
            )
            calc = _payroll_for_employee_month(
                self.emp, recs, {r.date: r for r in recs}, [], [], month_key, self.settings, None, 6
            )
            self.assertEqual(calc['earned_days'], 29.0)
            self.assertEqual(calc['attendance_days'], 1.0)
            self.assertEqual(calc['attendance_deduction'], 200.0)
            self.assertEqual(calc['net_pay'], 5600.0, f'Unexcused absence net_pay failed for {month_key}')

            # د) استثناء / إجازة على حساب الشركة (paid_company) = 30 يوماً (6000 ج.م)
            HRAttendanceRecord.objects.filter(employee=self.emp).delete()
            recs = self._seed_full_month_present(
                self.emp,
                year,
                month,
                overrides={
                    sample_workday: {
                        'check_in': None,
                        'check_out': None,
                        'status': 'absent',
                        'is_excused': True,
                        'absence_decision': 'paid_company',
                        'review_status': 'approved',
                    }
                },
            )
            calc = _payroll_for_employee_month(
                self.emp, recs, {r.date: r for r in recs}, [], [], month_key, self.settings, None, 6
            )
            self.assertEqual(calc['earned_days'], 30.0)
            self.assertEqual(calc['net_pay'], 6000.0)

    # ------------------------------------------------------------------
    # 2. التعيين في منتصف الشهر (15 أبريل) + الترك قبل نهاية الشهر
    # ------------------------------------------------------------------
    def test_mid_month_hire_april_15_gets_exact_days_and_full_sundays(self):
        # أبريل 2026: أيام الأحد = 5, 12, 19, 26.
        # بدأ يوم 15 أبريل (الأربعاء) وحضر كل أيام العمل من 15 إلى 30 (14 يوم عمل + أحدين 19 و26 = 16 يوماً).
        new_emp = HREmployee.objects.create(
            name='سالم الجديد',
            employee_code='EMP-SPEC-NEW',
            job=self.job,
            monthly_salary=6000.0,
            hire_date=date(2026, 4, 15),
        )
        recs = []
        for d in range(15, 31):
            cur = date(2026, 4, d)
            if cur.weekday() == 6:
                continue
            recs.append(
                HRAttendanceRecord.objects.create(
                    employee=new_emp,
                    date=cur,
                    check_in=time(8, 30),
                    check_out=time(17, 30),
                    status='present',
                )
            )

        calc = _payroll_for_employee_month(
            new_emp, recs, {r.date: r for r in recs}, [], [], '2026-04', self.settings, None, 6
        )
        # 14 يوم عمل + 2 يوم أحد مدفوعين بالكامل (بدون خصم 1/3 من الأحد 19!) = 16 يوم = 3,200 ج.م
        self.assertEqual(calc['attended_days'], 14.0)
        self.assertEqual(calc['paid_sunday_days'], 2.0)
        self.assertEqual(calc['sunday_deduction_days'], 0.0)
        self.assertEqual(calc['earned_days'], 16.0)
        self.assertEqual(calc['net_pay'], 3200.0)

    def test_mid_month_termination_gets_actual_days_only(self):
        # ترك العمل يوم 14 أبريل 2026 (حضر كل أيام العمل من 1 إلى 14: 12 يوم عمل + أحدين 5 و12 = 14 يوماً).
        leaving_emp = HREmployee.objects.create(
            name='كريم المستقيل',
            employee_code='EMP-SPEC-LEFT',
            job=self.job,
            monthly_salary=6000.0,
            termination_date=date(2026, 4, 14),
        )
        recs = []
        # أسبوع مارس الأخير لحساب الأحد 5 أبريل
        for d in range(30, 32):
            recs.append(
                HRAttendanceRecord.objects.create(
                    employee=leaving_emp,
                    date=date(2026, 3, d),
                    check_in=time(8, 30),
                    check_out=time(17, 30),
                    status='present',
                )
            )
        for d in range(1, 15):
            cur = date(2026, 4, d)
            if cur.weekday() == 6:
                continue
            recs.append(
                HRAttendanceRecord.objects.create(
                    employee=leaving_emp,
                    date=cur,
                    check_in=time(8, 30),
                    check_out=time(17, 30),
                    status='present',
                )
            )
        calc = _payroll_for_employee_month(
            leaving_emp, recs, {r.date: r for r in recs}, [], [], '2026-04', self.settings, None, 6
        )
        self.assertEqual(calc['attended_days'], 12.0)
        self.assertEqual(calc['paid_sunday_days'], 2.0)
        self.assertEqual(calc['sunday_deduction_days'], 0.0)
        self.assertEqual(calc['earned_days'], 14.0)
        self.assertEqual(calc['net_pay'], 2800.0)

    # ------------------------------------------------------------------
    # 3. شرائح خصم الأحد الخمس + عدم دخول excused_unpaid في خصم الأحد
    # ------------------------------------------------------------------
    def test_five_weekly_off_tiers_and_excused_unpaid_excluded(self):
        self.assertEqual(weekly_off_ratio_for_absences(0), 0.0)
        self.assertEqual(weekly_off_ratio_for_absences(1), 0.0)
        self.assertAlmostEqual(weekly_off_ratio_for_absences(2), 1.0 / 3.0, places=5)
        self.assertAlmostEqual(weekly_off_ratio_for_absences(3), 0.5, places=5)
        self.assertAlmostEqual(weekly_off_ratio_for_absences(4), 2.0 / 3.0, places=5)
        self.assertEqual(weekly_off_ratio_for_absences(5), 1.0)
        self.assertEqual(weekly_off_ratio_for_absences(6), 1.0)

        # أسبوع الإثنين 6 أبريل .. السبت 11 أبريل 2026
        week = [date(2026, 4, d) for d in range(6, 12)]

        class _Rec:
            def __init__(self, status='present', check_in=time(8, 30), check_out=time(17, 30),
                         is_excused=False, absence_decision=''):
                self.status = status
                self.check_in = check_in
                self.check_out = check_out
                self.is_excused = is_excused
                self.absence_decision = absence_decision

        # 3 حضور + 3 غياب بدون عذر => خصم نصف يوم (0.50)
        recs_3_unexcused = {week[i]: _Rec() for i in range(3)}
        res3 = sunday_deduction_for_week(recs_3_unexcused, week)
        self.assertEqual(res3['sunday_deduction_days'], 0.5)
        self.assertIn('نصف يوم الإجازة', res3['sunday_deduction_note'])

        # 3 حضور + 3 غياب بعذر (excused_unpaid) => 0 خصم على الأحد!
        recs_3_excused = {week[i]: _Rec() for i in range(3)}
        for i in range(3, 6):
            recs_3_excused[week[i]] = _Rec(
                status='absent', check_in=None, check_out=None,
                is_excused=True, absence_decision='excused_unpaid',
            )
        res_excused = sunday_deduction_for_week(recs_3_excused, week)
        self.assertEqual(res_excused['sunday_deduction_days'], 0.0)

    # ------------------------------------------------------------------
    # 4. البصمة الناقصة (check_out فقط) تُحسب حضوراً مؤقتاً pending_review
    # ------------------------------------------------------------------
    def test_missing_punch_checkout_only_is_temporary_attended_and_pending_review(self):
        computed = compute_attendance(
            self.settings, self.emp, date(2026, 4, 15), None, time(17, 30), ''
        )
        self.assertEqual(computed['status'], 'missing_punch')
        self.assertEqual(computed['review_status'], 'pending_review')

        rec = HRAttendanceRecord.objects.create(
            employee=self.emp,
            date=date(2026, 4, 15),
            check_in=None,
            check_out=time(17, 30),
            status='missing_punch',
            review_status='pending_review',
        )
        self.assertTrue(is_attended_record(rec))

        # في منتصف الشهر (يوم 15 مع بصمة انصراف فقط) يُحسب اليوم كحضور مؤقت (1 يوم)
        accrual = _compute_month_accrual(
            {rec.date: rec}, '2026-04', date(2026, 4, 15), weekly_off_index=6
        )
        self.assertEqual(accrual['attended_days'], 1.0)
        self.assertEqual(accrual['earned_days'], 1.0)

    # ------------------------------------------------------------------
    # 5. التصفير اليدوي للتأخير (manual_deduction=True, 0) يُحترم نهائياً
    # ------------------------------------------------------------------
    def test_manual_zero_deduction_is_respected_and_not_overridden(self):
        client, _ = _make_hr_client()
        # إنشاء سجل تأخير 10 دقائق مع تصفير الخصم يدوياً (manual_deduction=True, 0)
        res = client.post(
            '/api/hr-attendance-records/',
            {
                'employee_id': self.emp.client_id or str(self.emp.id),
                'date': '2026-04-15',
                'check_in': '08:40',
                'check_out': '17:30',
                'status': 'present',
                'calculated_deduction_days': 0,
                'calculated_deduction_hours': 0,
                'manual_deduction': True,
                'review_status': 'auto_applied',
            },
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertTrue(res.data['manual_deduction'])
        self.assertEqual(res.data['calculated_deduction_days'], 0.0)

        rec = HRAttendanceRecord.objects.get(employee=self.emp, date=date(2026, 4, 15))
        calc = _payroll_for_employee_month(
            self.emp, [rec], {rec.date: rec}, [], [], '2026-04', self.settings, date(2026, 4, 15), 6
        )
        # لا يُشغَّل الـ Fallback الديناميكي -> الخصم = 0.0 ج.م
        self.assertEqual(calc['attendance_days'], 0.0)
        self.assertEqual(calc['attendance_deduction'], 0.0)

    # ------------------------------------------------------------------
    # 6. أجر الساعة = salary / 30 / 9 (ساعات الشيفت 08:30–17:30)
    # ------------------------------------------------------------------
    def test_hourly_rate_uses_shift_hours_9_not_8(self):
        self.assertEqual(working_hours_per_day(self.settings), 9.0)
        recs = self._seed_full_month_present(self.emp, 2026, 4)
        # جزاء يدوي 3 ساعات: 3 × (6000 / 30 / 9) = 3 × (200 / 9) = 66.67 ج.م (وليس 75 ج.م!)
        pen = HRPenalty.objects.create(
            employee=self.emp,
            date=date(2026, 4, 10),
            penalty_type='hours',
            value=3.0,
            reason='اختبار ساعة الشيفت',
        )
        calc = _payroll_for_employee_month(
            self.emp, recs, {r.date: r for r in recs}, [pen], [], '2026-04', self.settings, None, 6
        )
        self.assertEqual(calc['penalty_deduction'], 66.67)
        self.assertEqual(calc['net_pay'], 5933.33)

    # ------------------------------------------------------------------
    # 7. الإضافي لا يُصرف لغير الحاضر + حذف سجل الأحد الشبح + عبور الشهور
    # ------------------------------------------------------------------
    def test_no_overtime_on_absent_and_ghost_sunday_cleanup_and_cross_month(self):
        # غياب مع overtime مخزّن بالخطأ -> لا يُصرف له أي إضافي
        absent_rec = HRAttendanceRecord.objects.create(
            employee=self.emp,
            date=date(2026, 4, 15),
            status='absent',
            absence_decision='excused_unpaid',
            is_excused=True,
            overtime_hours=2.0,
            review_status='approved',
        )
        calc = _payroll_for_employee_month(
            self.emp, [absent_rec], {absent_rec.date: absent_rec}, [], [], '2026-04', self.settings, date(2026, 4, 15), 6
        )
        self.assertEqual(calc['overtime_pay'], 0.0)

        # حذف سجل الأحد الشبح عند حذف كل سجلات الأسبوع
        HRAttendanceRecord.objects.filter(employee=self.emp).delete()
        mon = HRAttendanceRecord.objects.create(
            employee=self.emp,
            date=date(2026, 4, 6),
            check_in=time(8, 30),
            check_out=time(17, 30),
            status='present',
        )
        reapply_employee_month(self.settings, self.emp, date(2026, 4, 1), date(2026, 4, 30))
        self.assertTrue(
            HRAttendanceRecord.objects.filter(employee=self.emp, date=date(2026, 4, 12)).exists()
        )
        # حذف السجل الوحيد في الأسبوع -> يجب حذف الأحد الشبح تلقائياً
        mon.delete()
        reapply_employee_month(self.settings, self.emp, date(2026, 4, 1), date(2026, 4, 30))
        self.assertFalse(
            HRAttendanceRecord.objects.filter(employee=self.emp, date=date(2026, 4, 12)).exists()
        )

        # عبور الشهور: إضافة سجل في 30 مارس 2026 عبر API يُحدّث أول أحد في أبريل (5 أبريل 2026)
        client, _ = _make_hr_client()
        for d in (30, 31):
            HRAttendanceRecord.objects.create(
                employee=self.emp, date=date(2026, 3, d),
                check_in=time(8, 30), check_out=time(17, 30), status='present',
            )
        for d in (1, 2, 3):
            HRAttendanceRecord.objects.create(
                employee=self.emp, date=date(2026, 4, d),
                check_in=time(8, 30), check_out=time(17, 30), status='present',
            )
        reapply_employee_month(self.settings, self.emp, date(2026, 4, 1), date(2026, 4, 30))
        sun_apr5 = HRAttendanceRecord.objects.get(employee=self.emp, date=date(2026, 4, 5))
        self.assertEqual(sun_apr5.sunday_deduction_days, 0.0)  # غياب 1 يوم (السبت 4 أبريل) => 0 خصم

        # حذف يوم 31 مارس عبر API -> يصبح الغياب 2 يوم (31 مارس + 4 أبريل) -> يجب تحديث 5 أبريل تلقائياً إلى 0.33!
        mar31 = HRAttendanceRecord.objects.get(employee=self.emp, date=date(2026, 3, 31))
        del_res = client.delete(f'/api/hr-attendance-records/{mar31.client_id or mar31.id}/')
        self.assertEqual(del_res.status_code, status.HTTP_204_NO_CONTENT)
        sun_apr5.refresh_from_db()
        self.assertAlmostEqual(sun_apr5.sunday_deduction_days, 0.33, places=2)

    # ------------------------------------------------------------------
    # 8. اختبار API لقرار الغياب الثلاثي + تواريخ التعيين والترك + إحصاءات needs_decision
    # ------------------------------------------------------------------
    def test_api_absence_decisions_and_employee_hire_termination_and_stats(self):
        client, _ = _make_hr_client()
        # إنشاء موظف بتاريخ تعيين وترك
        emp_res = client.post(
            '/api/hr-employees/',
            {
                'name': 'حسام الجديد',
                'job_id': self.job.client_id or str(self.job.id),
                'monthly_salary': 6000,
                'hire_date': '2026-04-15',
                'termination_date': '2026-04-28',
            },
            format='json',
        )
        self.assertEqual(emp_res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(emp_res.data['hire_date'], '2026-04-15')
        self.assertEqual(emp_res.data['termination_date'], '2026-04-28')

        # رفض تاريخ ترك قبل تاريخ التعيين
        bad_emp = client.post(
            '/api/hr-employees/',
            {
                'name': 'موظف خطأ',
                'job_id': self.job.client_id or str(self.job.id),
                'monthly_salary': 6000,
                'hire_date': '2026-04-20',
                'termination_date': '2026-04-10',
            },
            format='json',
        )
        self.assertEqual(bad_emp.status_code, status.HTTP_400_BAD_REQUEST)

        # إنشاء سجل غياب بدون قرار -> يظهر في needs_decision ويكون خصمه الافتراضي 1 يوم إضافي
        abs_res = client.post(
            '/api/hr-attendance-records/',
            {
                'employee_id': emp_res.data['id'],
                'date': '2026-04-16',
                'status': 'absent',
            },
            format='json',
        )
        self.assertEqual(abs_res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(abs_res.data['absence_decision'], '')
        self.assertEqual(abs_res.data['calculated_deduction_days'], 1.0)

        stats_before = client.get('/api/hr-attendance-records/stats/?month=2026-04')
        self.assertEqual(stats_before.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(stats_before.data['needs_decision'], 1)
        self.assertEqual(stats_before.data['approved_deduction_days'], 1.0)

        # تغيير قرار الغياب إلى "بعذر (خصم اليوم فقط)" -> يُصفّر الجزاء الإضافي ويختفي من needs_decision
        upd_res = client.patch(
            f"/api/hr-attendance-records/{abs_res.data['id']}/",
            {'absence_decision': 'excused_unpaid'},
            format='json',
        )
        self.assertEqual(upd_res.status_code, status.HTTP_200_OK)
        self.assertEqual(upd_res.data['absence_decision'], 'excused_unpaid')
        self.assertEqual(upd_res.data['calculated_deduction_days'], 0.0)
        self.assertEqual(upd_res.data['review_status'], 'approved')

        stats_after = client.get('/api/hr-attendance-records/stats/?month=2026-04')
        self.assertEqual(stats_after.data['needs_decision'], 0)
        self.assertEqual(stats_after.data['approved_deduction_days'], 0.0)

