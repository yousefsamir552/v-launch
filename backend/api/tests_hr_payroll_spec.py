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
    HRBonusPlan,
    HRDirectBonus,
    HREmployee,
    HRJobTitle,
    HRLoan,
    HRPayrollSnapshot,
    HRPenalty,
    RANK_LEVEL_ONE,
    RANK_LEVEL_TWO,
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

        # 3 حضور + 3 غياب بعذر (excused_unpaid) => يدخل الآن في خصم الأحد (نصف يوم 0.50 وفق بندي 10 و12)
        recs_3_excused = {week[i]: _Rec() for i in range(3)}
        for i in range(3, 6):
            recs_3_excused[week[i]] = _Rec(
                status='absent', check_in=None, check_out=None,
                is_excused=True, absence_decision='excused_unpaid',
            )
        res_excused = sunday_deduction_for_week(recs_3_excused, week)
        self.assertEqual(res_excused['sunday_deduction_days'], 0.5)

        # بينما الإجازة المدفوعة على حساب الشركة (paid_company) لا تدخل في خصم الأحد (0.0)
        recs_3_paid = {week[i]: _Rec() for i in range(3)}
        for i in range(3, 6):
            recs_3_paid[week[i]] = _Rec(
                status='leave', check_in=None, check_out=None,
                is_excused=True, absence_decision='paid_company',
            )
        res_paid = sunday_deduction_for_week(recs_3_paid, week)
        self.assertEqual(res_paid['sunday_deduction_days'], 0.0)

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
        self.assertEqual(calc['exact_net_pay'], 5933.33)
        self.assertEqual(calc['net_pay'], 5935.0)

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
        # الغياب المعلّق بدون قرار يظهر ضمن المعلّق وليس ضمن المعتمد (بند 9 و18)
        self.assertEqual(stats_before.data['approved_deduction_days'], 0.0)
        self.assertEqual(stats_before.data['pending_deduction_days'], 1.0)

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


class HRPayrollGoldenCasesTests(TestCase):
    """
    الاختبارات الذهبية المعتمدة (الحالات 1 إلى 14) من وثيقة محاسب المصنع المعتمدة
    (PAYROLL_ACCOUNTANT_WORKSHEET_COMPLETED.md) — كل حالة في اختبار مستقل بدقة القرش وبالتقريب لـ 5 جنيهات.
    """

    def setUp(self):
        self.job = HRJobTitle.objects.create(title='عامل إنتاج', department='sewing')
        self.settings = HRAttendanceSettings.objects.create(
            official_start_time=time(8, 0),
            official_end_time=time(17, 0),
            weekly_off_day='Sunday',
            month_calculation_days=30,
            weekly_off_work_multiplier=Decimal('1.00'),
            weekly_off_partial_hour_multiplier=Decimal('1.50'),
            overtime_regular_multiplier=Decimal('1.00'),
            overtime_night_multiplier=Decimal('1.00'),
            overtime_holiday_multiplier=Decimal('2.00'),
            monthly_late_grace_minutes=60,
            monthly_late_grace_period_months=1,
            rules_json=[
                {
                    'id': 'late-grace-15',
                    'violation_type': 'late_arrival',
                    'label': 'تأخير حتى 15 دقيقة (ضمن رصيد السماح)',
                    'from_minutes': 1,
                    'to_minutes': 15,
                    'deduction_type': 'days',
                    'deduction_value': 0.25,
                    'apply_mode': 'auto',
                    'uses_monthly_grace': True,
                },
                {
                    'id': 'late-non-grace-30',
                    'violation_type': 'late_arrival',
                    'label': 'تأخير من 30 إلى 60 دقيقة (خارج السماح)',
                    'from_minutes': 30,
                    'to_minutes': 60,
                    'deduction_type': 'days',
                    'deduction_value': 0.25,
                    'apply_mode': 'auto',
                    'uses_monthly_grace': False,
                },
                {
                    'id': 'early-30',
                    'violation_type': 'early_departure',
                    'label': 'انصراف مبكر حتى 30 دقيقة',
                    'from_minutes': 1,
                    'to_minutes': 30,
                    'deduction_type': 'days',
                    'deduction_value': 0.25,
                    'apply_mode': 'manual_review',
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
                    'id': 'ot-rel-1',
                    'label': 'إضافي ساعة بعد نهاية الوردية',
                    'offset_from_minutes': 60,
                    'offset_to_minutes': 119,
                    'reward_type': 'hours',
                    'reward_value': 1,
                },
            ],
        )

    def _make_emp(self, name, salary, code, **kwargs):
        return HREmployee.objects.create(
            name=name,
            employee_code=code,
            job=self.job,
            monthly_salary=float(salary),
            rule_application_mode='auto',
            **kwargs,
        )

    def _seed_month(self, emp, year, month, overrides=None, include_prev_week=True, start_day=1, end_day=None):
        overrides = overrides or {}
        records = []
        if include_prev_week and start_day == 1:
            prev_year = year - 1 if month == 1 else year
            prev_month = 12 if month == 1 else month - 1
            prev_last = calendar.monthrange(prev_year, prev_month)[1]
            for d in range(prev_last - 5, prev_last + 1):
                cur = date(prev_year, prev_month, d)
                if cur.weekday() != 6:
                    records.append(
                        HRAttendanceRecord.objects.create(
                            employee=emp, date=cur,
                            check_in=time(8, 0), check_out=time(17, 0),
                            status='present', review_status='auto_applied',
                        )
                    )

        last_day = end_day or calendar.monthrange(year, month)[1]
        for d in range(start_day, last_day + 1):
            cur = date(year, month, d)
            ov = overrides.get(cur)
            if cur.weekday() == 6 and not isinstance(ov, dict):
                continue
            if ov == 'skip':
                continue
            kwargs = {
                'employee': emp,
                'date': cur,
                'check_in': time(8, 0),
                'check_out': time(17, 0),
                'status': 'present',
                'review_status': 'auto_applied',
            }
            if isinstance(ov, dict):
                kwargs.update(ov)
            records.append(HRAttendanceRecord.objects.create(**kwargs))
        return records

    def _calc(self, emp, recs, month_key, penalties=None, loans=None, direct_bonuses=None, bonus_plans=None):
        return _payroll_for_employee_month(
            emp,
            recs,
            {r.date: r for r in recs},
            penalties or [],
            loans or [],
            month_key,
            self.settings,
            None,
            6,
            direct_bonuses=direct_bonuses,
            bonus_plans=bonus_plans,
        )

    # ------------------------------------------------------------------
    # الحالة الذهبية (1): موظف منتظم بالكامل طوال الشهر (أبريل 2026)
    # ------------------------------------------------------------------
    def test_golden_case_01_full_regular_month_with_loan(self):
        emp = self._make_emp('حالة 1', 6000, 'G-01')
        recs = self._seed_month(emp, 2026, 4)
        loan = HRLoan.objects.create(employee=emp, date=date(2026, 4, 10), amount=1000.0)
        calc = self._calc(emp, recs, '2026-04', loans=[loan])
        self.assertEqual(calc['day_rate'], 200.0)
        self.assertEqual(calc['hour_rate'], 22.22)
        self.assertEqual(calc['earned_base'], 6000.0)
        self.assertEqual(calc['total_deduction'], 1000.0)
        self.assertEqual(calc['exact_net_pay'], 5000.0)
        self.assertEqual(calc['net_pay'], 5000.0)

    # ------------------------------------------------------------------
    # الحالة الذهبية (2): غياب بدون عذر (2) + غياب بعذر (1) في نفس الأسبوع (مايو 31 يوماً)
    # ------------------------------------------------------------------
    def test_golden_case_02_unexcused_plus_excused_same_week_sunday_half(self):
        emp = self._make_emp('حالة 2', 5400, 'G-02')
        # مايو 2026: الأسبوع الإثنين 4 .. السبت 9 يسبق الأحد 10 مايو.
        recs = self._seed_month(emp, 2026, 5, overrides={
            date(2026, 5, 4): {
                'check_in': None, 'check_out': None, 'status': 'absent',
                'is_excused': False, 'absence_decision': 'unexcused',
                'calculated_deduction_days': 1.0, 'review_status': 'approved',
            },
            date(2026, 5, 5): {
                'check_in': None, 'check_out': None, 'status': 'absent',
                'is_excused': False, 'absence_decision': 'unexcused',
                'calculated_deduction_days': 1.0, 'review_status': 'approved',
            },
            date(2026, 5, 6): {
                'check_in': None, 'check_out': None, 'status': 'absent',
                'is_excused': True, 'absence_decision': 'excused_unpaid',
                'calculated_deduction_days': 0.0, 'review_status': 'approved',
            },
        })
        calc = self._calc(emp, recs, '2026-05')
        self.assertEqual(calc['day_rate'], 180.0)
        self.assertEqual(calc['hour_rate'], 20.0)
        self.assertEqual(calc['sunday_deduction_days'], 0.5)
        self.assertEqual(calc['sunday_deduction'], 90.0)
        self.assertEqual(calc['exact_net_pay'], 4410.0)
        self.assertEqual(calc['net_pay'], 4410.0)

    # ------------------------------------------------------------------
    # الحالة الذهبية (3): موظف تم تعيينه في منتصف الشهر (16 مايو 2026)
    # ------------------------------------------------------------------
    def test_golden_case_03_mid_month_hire_may_16(self):
        emp = self._make_emp('حالة 3', 5400, 'G-03', hire_date=date(2026, 5, 16))
        recs = self._seed_month(emp, 2026, 5, include_prev_week=False, start_day=16)
        calc = self._calc(emp, recs, '2026-05')
        self.assertEqual(calc['attended_days'], 13.0)
        self.assertEqual(calc['paid_sunday_days'], 3.0)
        self.assertEqual(calc['earned_days'], 16.0)
        self.assertEqual(calc['earned_base'], 2880.0)
        self.assertEqual(calc['net_pay'], 2880.0)

    # ------------------------------------------------------------------
    # الحالة الذهبية (4): ترك العمل في منتصف الشهر + غياب بعذر (منع الخصم المزدوج)
    # ------------------------------------------------------------------
    def test_golden_case_04_mid_month_termination_no_double_deduction(self):
        emp = self._make_emp('حالة 4', 5400, 'G-04', termination_date=date(2026, 4, 15))
        recs = self._seed_month(emp, 2026, 4, end_day=15, overrides={
            date(2026, 4, 14): {
                'check_in': None, 'check_out': None, 'status': 'absent',
                'is_excused': True, 'absence_decision': 'excused_unpaid',
                'calculated_deduction_days': 0.0, 'review_status': 'approved',
            },
        })
        loan = HRLoan.objects.create(employee=emp, date=date(2026, 4, 10), amount=400.0)
        calc = self._calc(emp, recs, '2026-04', loans=[loan])
        self.assertEqual(calc['attended_days'], 12.0)
        self.assertEqual(calc['paid_sunday_days'], 2.0)
        self.assertEqual(calc['earned_days'], 14.0)
        self.assertEqual(calc['earned_base'], 2520.0)
        self.assertEqual(calc['attendance_deduction'], 0.0)
        self.assertEqual(calc['net_pay'], 2120.0)

    # ------------------------------------------------------------------
    # الحالة الذهبية (5): تأخير داخل السماح + خارج السماح + انصراف مبكر + 5 ساعات إضافي
    # ------------------------------------------------------------------
    def test_golden_case_05_grace_vs_non_grace_late_early_and_overtime(self):
        emp = self._make_emp('حالة 5', 5400, 'G-05')
        recs = self._seed_month(emp, 2026, 4, overrides={
            # 3 مرات × 10 دقائق على شريحة السماح = 30 <= 60 => 0 خصم
            date(2026, 4, 6): {'check_in': time(8, 10), 'late_minutes': 10, 'calculated_deduction_days': 0.25},
            date(2026, 4, 7): {'check_in': time(8, 10), 'late_minutes': 10, 'calculated_deduction_days': 0.25},
            date(2026, 4, 8): {'check_in': time(8, 10), 'late_minutes': 10, 'calculated_deduction_days': 0.25},
            # مرة × 35 دقيقة على شريحة خارج السماح => خصم فوري ربع يوم (45.00)
            date(2026, 4, 9): {'check_in': time(8, 35), 'late_minutes': 35, 'calculated_deduction_days': 0.25},
            # انصراف مبكر 20 دقيقة معتمد => خصم ربع يوم (45.00)
            date(2026, 4, 13): {
                'check_out': time(16, 40), 'early_minutes': 20,
                'calculated_deduction_days': 0.25, 'review_status': 'approved',
            },
            # 5 ساعات إضافي في أيام عادية (معامل × 1 => +100.00)
            date(2026, 4, 14): {'overtime_hours': 2.0},
            date(2026, 4, 15): {'overtime_hours': 3.0},
        })
        calc = self._calc(emp, recs, '2026-04')
        self.assertEqual(calc['grace_used_minutes'], 30.0)
        self.assertFalse(calc['grace_exceeded'])
        self.assertEqual(calc['overtime_pay'], 100.0)
        self.assertEqual(calc['attendance_deduction'], 90.0)
        self.assertEqual(calc['net_pay'], 5410.0)

    # ------------------------------------------------------------------
    # الحالة الذهبية (6): قسط سلفة شهري (1800 / 3) + جزاء 1 يوم + حافز انتظام 300
    # ------------------------------------------------------------------
    def test_golden_case_06_installment_loan_penalty_and_recurring_bonus(self):
        client, _ = _make_hr_client()
        emp = self._make_emp('حالة 6', 5400, 'G-06')
        recs = self._seed_month(emp, 2026, 4)

        # إنشاء سلفة 1800 مقسّطة على 3 شهور عبر الـ API
        loan_res = client.post(
            '/api/hr-loans/',
            {
                'employee_id': emp.client_id or str(emp.id),
                'date': '2026-04-05',
                'amount': 1800,
                'installments_count': 3,
                'notes': 'سلفة زواج',
            },
            format='json',
        )
        self.assertEqual(loan_res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(loan_res.data['installments']), 3)
        self.assertEqual([i['amount'] for i in loan_res.data['installments']], [600.0, 600.0, 600.0])

        pen = HRPenalty.objects.create(
            employee=emp, date=date(2026, 4, 10), penalty_type='days', value=1.0, reason='جزاء يوم'
        )
        plan = HRBonusPlan.objects.create(
            name='حافز انتظام شهري',
            category='attendance',
            value_type='fixed',
            value=Decimal('300.00'),
            requires_full_month=True,
            affected_by_absence=True,
            absence_deduction_percent=Decimal('100.00'),
            affected_by_late=True,
            late_deduction_percent=Decimal('100.00'),
        )
        emp.recurring_bonus_plans.add(plan)

        loans = list(HRLoan.objects.filter(employee=emp))
        calc = self._calc(emp, recs, '2026-04', penalties=[pen], loans=loans)
        self.assertEqual(calc['loan_amount'], 600.0)
        self.assertEqual(calc['penalty_deduction'], 180.0)
        self.assertEqual(calc['recurring_bonus_pay'], 300.0)
        self.assertEqual(calc['bonus_pay'], 300.0)
        self.assertEqual(calc['net_pay'], 4920.0)

    # ------------------------------------------------------------------
    # الحالة الذهبية (7): بصمة ناقصة معلّقة عند قفل الشهر + إجازة مدفوعة على حساب الشركة
    # ------------------------------------------------------------------
    def test_golden_case_07_pending_missing_punch_and_paid_company_leave(self):
        emp = self._make_emp('حالة 7', 5400, 'G-07')
        recs = self._seed_month(emp, 2026, 4, overrides={
            date(2026, 4, 8): {
                'check_in': None, 'check_out': None, 'status': 'leave',
                'is_excused': True, 'absence_decision': 'paid_company',
                'review_status': 'approved',
            },
            date(2026, 4, 15): {
                'check_in': time(8, 0), 'check_out': None,
                'status': 'missing_punch', 'review_status': 'pending_review',
            },
        })
        calc = self._calc(emp, recs, '2026-04')
        self.assertEqual(calc['earned_days'], 30.0)
        self.assertEqual(calc['total_deduction'], 0.0)
        self.assertEqual(calc['net_pay'], 5400.0)

    # ------------------------------------------------------------------
    # الحالة الذهبية (8): شهر 28 يوماً (فبراير) + عمل جزئي 5 ساعات يوم الأحد + 2 غياب بعذر
    # ------------------------------------------------------------------
    def test_golden_case_08_feb_28_partial_sunday_and_two_excused_absences(self):
        emp = self._make_emp('حالة 8', 5400, 'G-08')
        # فبراير 2026: الإثنين 9 .. السبت 14 يسبق الأحد 15 فبراير.
        recs = self._seed_month(emp, 2026, 2, overrides={
            date(2026, 2, 9): {
                'check_in': None, 'check_out': None, 'status': 'absent',
                'is_excused': True, 'absence_decision': 'excused_unpaid',
                'review_status': 'approved',
            },
            date(2026, 2, 10): {
                'check_in': None, 'check_out': None, 'status': 'absent',
                'is_excused': True, 'absence_decision': 'excused_unpaid',
                'review_status': 'approved',
            },
            # عمل 5 ساعات جزئية يوم الأحد 22 فبراير بدون تأخير (08:00 إلى 13:00) بمعامل × 1.5
            date(2026, 2, 22): {
                'check_in': time(8, 0), 'check_out': time(13, 0),
                'status': 'present', 'review_status': 'auto_applied',
            },
        })
        calc = self._calc(emp, recs, '2026-02')
        self.assertEqual(calc['weekly_off_partial_hours'], 5.0)
        self.assertEqual(calc['weekly_off_extra_pay'], 150.0)
        self.assertEqual(calc['sunday_deduction'], 60.0)
        self.assertEqual(calc['exact_net_pay'], 5130.0)
        self.assertEqual(calc['net_pay'], 5130.0)

    # ------------------------------------------------------------------
    # الحالة الذهبية (9): رصيد سالب (-280.00) يترحّل لمايو + الكاش = 0.00 + تقسيط المديونية
    # ------------------------------------------------------------------
    def test_golden_case_09_negative_balance_carryover_cash_zero_and_split(self):
        client, _ = _make_hr_client()
        emp = self._make_emp('حالة 9', 2700, 'G-09')
        emp_pos = self._make_emp('زميل موجب', 3000, 'G-09-POS')
        # 4 أيام غياب بدون عذر في نفس الأسبوع (6..9 أبريل -> ثلثي أحد 12 أبريل = 60)
        self._seed_month(emp, 2026, 4, overrides={
            date(2026, 4, d): {
                'check_in': None, 'check_out': None, 'status': 'absent',
                'is_excused': False, 'absence_decision': 'unexcused',
                'calculated_deduction_days': 1.0, 'review_status': 'approved',
            }
            for d in (6, 7, 8, 9)
        })
        self._seed_month(emp_pos, 2026, 4)
        HRLoan.objects.create(employee=emp, date=date(2026, 4, 15), amount=2200.0)

        lock_res = client.post('/api/hr-payroll-snapshots/lock/', {'month': '2026-04'}, format='json')
        self.assertEqual(lock_res.status_code, status.HTTP_201_CREATED)
        snap = lock_res.data['snapshot']
        row_neg = next(r for r in snap['rows'] if r['employee_code'] == 'G-09')
        self.assertEqual(row_neg['exact_net_pay'], -280.0)
        self.assertEqual(row_neg['net_pay'], -280.0)
        self.assertEqual(row_neg['payable_cash'], 0.0)
        self.assertEqual(row_neg['carryover_debt_next'], 280.0)
        # إجمالي الكاش للمصنع لا ينقص بسبب الرصيد السالب (3000 فقط وليس 2720)
        self.assertEqual(snap['totals']['payable_cash'], 3000.0)
        self.assertEqual(snap['totals']['net_pay'], 3000.0)

        # التحقق من إنشاء المديونية المرحّلة تلقائياً في مايو 2026 بدقة القرش
        debt = HRLoan.objects.get(employee=emp, loan_kind='carryover_debt', source_month='2026-04')
        self.assertEqual(debt.date, date(2026, 5, 1))
        self.assertEqual(debt.amount, 280.0)

        # تقسيط المديونية على شهرين (مايو ويونيو) عبر المشرف
        split_res = client.post(
            f'/api/hr-loans/{debt.client_id or debt.id}/split-installments/',
            {'installments_count': 2},
            format='json',
        )
        self.assertEqual(split_res.status_code, status.HTTP_200_OK)
        self.assertEqual([i['amount'] for i in split_res.data['installments']], [140.0, 140.0])

    # ------------------------------------------------------------------
    # الحالة الذهبية (10): تجاوز رصيد السماح (75 > 60) بأثر رجعي + تقريب 2587.50 -> 2590.00
    # ------------------------------------------------------------------
    def test_golden_case_10_exceed_grace_retroactive_and_round_half_up_5(self):
        emp = self._make_emp('حالة 10', 2700, 'G-10')
        recs = self._seed_month(emp, 2026, 4, overrides={
            date(2026, 4, d): {
                'check_in': time(8, 15), 'late_minutes': 15,
                'calculated_deduction_days': 0.0, 'review_status': 'auto_applied',
            }
            for d in (6, 7, 8, 9, 11)
        })
        calc = self._calc(emp, recs, '2026-04')
        self.assertEqual(calc['grace_used_minutes'], 75.0)
        self.assertTrue(calc['grace_exceeded'])
        self.assertEqual(calc['attendance_deduction'], 112.5)
        self.assertEqual(calc['exact_net_pay'], 2587.5)
        self.assertEqual(calc['rounded_net_pay'], 2590.0)
        self.assertEqual(calc['net_pay'], 2590.0)

    # ------------------------------------------------------------------
    # الحالة الذهبية (11): تعيين 16 مايو + غياب بدون عذر + غياب معلّق + عدم استحقاق المكافأة الدورية
    # ------------------------------------------------------------------
    def test_golden_case_11_mid_month_hire_unexcused_pending_and_no_attendance_bonus(self):
        emp = self._make_emp('حالة 11', 5400, 'G-11', hire_date=date(2026, 5, 16))
        plan = HRBonusPlan.objects.create(
            name='حافز انتظام',
            category='attendance',
            value_type='fixed',
            value=Decimal('300.00'),
            requires_full_month=True,
        )
        emp.recurring_bonus_plans.add(plan)

        recs = self._seed_month(emp, 2026, 5, include_prev_week=False, start_day=16, overrides={
            date(2026, 5, 20): {
                'check_in': None, 'check_out': None, 'status': 'absent',
                'is_excused': False, 'absence_decision': 'unexcused',
                'calculated_deduction_days': 1.0, 'review_status': 'approved',
            },
            date(2026, 5, 21): {
                'check_in': None, 'check_out': None, 'status': 'absent',
                'is_excused': False, 'absence_decision': '',
                'calculated_deduction_days': 1.0, 'review_status': 'pending_review',
            },
        })
        calc = self._calc(emp, recs, '2026-05')
        self.assertEqual(calc['bonus_pay'], 0.0)
        self.assertEqual(calc['attendance_deduction'], 180.0)
        self.assertEqual(calc['sunday_deduction'], 60.0)
        self.assertEqual(calc['exact_net_pay'], 2280.0)
        self.assertEqual(calc['net_pay'], 2280.0)

    # ------------------------------------------------------------------
    # الحالة الذهبية (12): عمل جزئي الأحد مع تأخير + رصيد سماح مخصص (30 د) + تصفير مشرف
    # ------------------------------------------------------------------
    def test_golden_case_12_partial_sunday_late_separation_custom_grace_and_manual_zero(self):
        # شريحة 1-20 دقيقة مفعّلة على السماح (ربع يوم)
        self.settings.rules_json = [
            {
                'id': 'late-grace-20',
                'violation_type': 'late_arrival',
                'label': 'تأخير حتى 20 دقيقة (سماح)',
                'from_minutes': 1,
                'to_minutes': 20,
                'deduction_type': 'days',
                'deduction_value': 0.25,
                'apply_mode': 'auto',
                'uses_monthly_grace': True,
            },
        ]
        self.settings.save()
        emp = self._make_emp('حالة 12', 5400, 'G-12', late_grace_minutes=30)
        recs = self._seed_month(emp, 2026, 4, overrides={
            # 6 أبريل: تأخير 15 دقيقة صفّره المشرف يدوياً (0.00 مالياً لكن يستهلك 15 دقيقة من السماح)
            date(2026, 4, 6): {
                'check_in': time(8, 15), 'late_minutes': 15,
                'manual_deduction': True, 'calculated_deduction_days': 0.0,
                'review_status': 'auto_applied',
            },
            # أحد 12 أبريل: حضر 08:20 وانصرف 14:20 = 6 ساعات فعلية (× 1.5 = +180) + تأخير 20 دقيقة
            date(2026, 4, 12): {
                'check_in': time(8, 20), 'check_out': time(14, 20),
                'status': 'present', 'late_minutes': 20,
                'calculated_deduction_days': 0.25, 'review_status': 'auto_applied',
            },
        })
        calc = self._calc(emp, recs, '2026-04')
        self.assertEqual(calc['grace_limit_minutes'], 30)
        self.assertEqual(calc['grace_used_minutes'], 35.0)
        self.assertTrue(calc['grace_exceeded'])
        self.assertEqual(calc['weekly_off_partial_hours'], 6.0)
        self.assertEqual(calc['weekly_off_extra_pay'], 180.0)
        self.assertEqual(calc['attendance_deduction'], 45.0)
        self.assertEqual(calc['exact_net_pay'], 5535.0)
        self.assertEqual(calc['net_pay'], 5535.0)

    # ------------------------------------------------------------------
    # الحالة الذهبية (13): اختبار تقريب المنتصف ROUND_HALF_UP (2582.50 -> 2585.00)
    # ------------------------------------------------------------------
    def test_golden_case_13_midpoint_round_half_up_not_bankers_rounding(self):
        emp = self._make_emp('حالة 13', 2700, 'G-13')
        recs = self._seed_month(emp, 2026, 4, overrides={
            # تأخير 35 دقيقة خارج السماح => ربع يوم = 22.50
            date(2026, 4, 6): {'check_in': time(8, 35), 'late_minutes': 35, 'calculated_deduction_days': 0.25},
        })
        loan = HRLoan.objects.create(employee=emp, date=date(2026, 4, 10), amount=95.0)
        calc = self._calc(emp, recs, '2026-04', loans=[loan])
        self.assertEqual(calc['total_deduction'], 117.5)
        self.assertEqual(calc['exact_net_pay'], 2582.5)
        self.assertEqual(calc['rounded_net_pay'], 2585.0)
        self.assertEqual(calc['net_pay'], 2585.0)

    # ------------------------------------------------------------------
    # الحالة الذهبية (14): إعادة فتح شهر مغلق وتحديث المديونية المرحّلة (Idempotency) + حماية الشهر التالي + مهلة 30 يوماً
    # ------------------------------------------------------------------
    def test_golden_case_14_reopen_idempotent_carryover_and_30_day_supervisor_rule(self):
        from django.utils import timezone
        from datetime import timedelta

        # مشرف موارد بشرية (can_manage_hr بدون manage_permissions)
        sup_role = Role.objects.create(name='مشرف HR', rank_level=RANK_LEVEL_ONE)
        UserProfile.objects.create(
            username='hr_sup_14', real_name='مشرف HR', role=sup_role,
            rank_level=RANK_LEVEL_ONE, is_active=True, auth_token='tok-hr-sup-14',
            custom_permissions={'can_manage_hr': True, 'hr_payroll': True, 'hr_attendance': True},
        )
        sup_client = APIClient()
        sup_client.credentials(HTTP_AUTHORIZATION='Bearer tok-hr-sup-14')

        admin_role = Role.objects.create(name='إدارة عليا 14', rank_level=RANK_LEVEL_ONE)
        UserProfile.objects.create(
            username='top_admin_14', real_name='إدارة عليا', role=admin_role,
            rank_level=RANK_LEVEL_ONE, is_active=True, auth_token='tok-top-admin-14',
            custom_permissions={'can_manage_hr': True, 'hr_payroll': True, 'manage_permissions': True},
        )
        admin_client = APIClient()
        admin_client.credentials(HTTP_AUTHORIZATION='Bearer tok-top-admin-14')

        emp = self._make_emp('حالة 14', 2700, 'G-14')
        self._seed_month(emp, 2026, 4, overrides={
            date(2026, 4, d): {
                'check_in': None, 'check_out': None, 'status': 'absent',
                'is_excused': False, 'absence_decision': 'unexcused',
                'calculated_deduction_days': 1.0, 'review_status': 'approved',
            }
            for d in (6, 7, 8, 9)
        })
        HRLoan.objects.create(employee=emp, date=date(2026, 4, 15), amount=2200.0)

        # 1) إغلاق أبريل 2026 -> ترحيل مديونية 280.00 لمايو 2026
        r1 = sup_client.post('/api/hr-payroll-snapshots/lock/', {'month': '2026-04'}, format='json')
        self.assertEqual(r1.status_code, status.HTTP_201_CREATED)
        debts_before = HRLoan.objects.filter(employee=emp, loan_kind='carryover_debt', source_month='2026-04')
        self.assertEqual(debts_before.count(), 1)
        self.assertEqual(debts_before.first().amount, 280.0)

        # 2) المشرف يعيد فتح أبريل خلال مهلة الـ 30 يوماً (ومايو مفتوح) -> مسموح
        u1 = sup_client.post('/api/hr-payroll-snapshots/unlock/', {'month': '2026-04'}, format='json')
        self.assertEqual(u1.status_code, status.HTTP_200_OK)

        # 3) تحويل يوم 9 أبريل من غياب بدون عذر إلى غياب بعذر، ثم إعادة إغلاق أبريل
        rec_apr9 = HRAttendanceRecord.objects.get(employee=emp, date=date(2026, 4, 9))
        p_res = sup_client.patch(
            f'/api/hr-attendance-records/{rec_apr9.client_id or rec_apr9.id}/',
            {'absence_decision': 'excused_unpaid'},
            format='json',
        )
        self.assertEqual(p_res.status_code, status.HTTP_200_OK)

        r2 = sup_client.post('/api/hr-payroll-snapshots/lock/', {'month': '2026-04'}, format='json')
        self.assertEqual(r2.status_code, status.HTTP_201_CREATED)
        row_updated = next(r for r in r2.data['snapshot']['rows'] if r['employee_code'] == 'G-14')
        self.assertEqual(row_updated['exact_net_pay'], -190.0)

        # التحقق من Idempotency: سجل واحد فقط في مايو بقيمة 190.00 (تم التحديث وليس التكرار!)
        debts_after = HRLoan.objects.filter(employee=emp, loan_kind='carryover_debt', source_month='2026-04')
        self.assertEqual(debts_after.count(), 1)
        self.assertEqual(debts_after.first().amount, 190.0)

        # 4) إغلاق مايو 2026 -> يُمنع إعادة فتح أبريل حتى يُفتح مايو أولاً
        self._seed_month(emp, 2026, 5, include_prev_week=False)
        r_may = sup_client.post('/api/hr-payroll-snapshots/lock/', {'month': '2026-05'}, format='json')
        self.assertEqual(r_may.status_code, status.HTTP_201_CREATED)
        u_blocked = admin_client.post('/api/hr-payroll-snapshots/unlock/', {'month': '2026-04'}, format='json')
        self.assertEqual(u_blocked.status_code, status.HTTP_400_BAD_REQUEST)

        # فتح مايو أولاً
        self.assertEqual(
            admin_client.post('/api/hr-payroll-snapshots/unlock/', {'month': '2026-05'}, format='json').status_code,
            status.HTTP_200_OK,
        )

        # 5) بعد مرور أكثر من 30 يوماً على إغلاق أبريل: يُمنع المشرف (403) ويُسمح للإدارة العليا (200)
        snap_apr = HRPayrollSnapshot.objects.get(month='2026-04')
        HRPayrollSnapshot.objects.filter(pk=snap_apr.pk).update(
            locked_at=timezone.now() - timedelta(days=31)
        )
        u_sup_expired = sup_client.post('/api/hr-payroll-snapshots/unlock/', {'month': '2026-04'}, format='json')
        self.assertEqual(u_sup_expired.status_code, status.HTTP_403_FORBIDDEN)
        u_admin_ok = admin_client.post('/api/hr-payroll-snapshots/unlock/', {'month': '2026-04'}, format='json')
        self.assertEqual(u_admin_ok.status_code, status.HTTP_200_OK)

    # ------------------------------------------------------------------
    # اختبار إضافي: المكافآت الفورية + المكافأة الدورية بنسبة من المرتب + Preview Single Source of Truth
    # ------------------------------------------------------------------
    def test_direct_bonus_percentage_plan_and_preview_endpoint(self):
        client, _ = _make_hr_client()
        emp = self._make_emp('مكافآت ومعاينة', 5400, 'G-15')
        self._seed_month(emp, 2026, 4)

        # مكافأة دورية 10% من المرتب (540 جنيه) + مكافأة فورية 125 جنيه
        plan_res = client.post(
            '/api/hr-bonus-plans/',
            {
                'name': 'مكافأة جودة 10%',
                'category': 'quality',
                'value_type': 'percent',
                'value': 10,
                'requires_full_month': False,
                'affected_by_absence': False,
                'affected_by_late': False,
            },
            format='json',
        )
        self.assertEqual(plan_res.status_code, status.HTTP_201_CREATED)
        emp_upd = client.patch(
            f'/api/hr-employees/{emp.client_id or emp.id}/',
            {'recurring_bonus_plan_ids': [plan_res.data['id']]},
            format='json',
        )
        self.assertEqual(emp_upd.status_code, status.HTTP_200_OK)

        direct_res = client.post(
            '/api/hr-direct-bonuses/',
            {
                'employee_id': emp.client_id or str(emp.id),
                'date': '2026-04-20',
                'amount': 125,
                'reason': 'مكافأة تشجيعية',
            },
            format='json',
        )
        self.assertEqual(direct_res.status_code, status.HTTP_201_CREATED)

        preview_res = client.get('/api/hr-payroll-snapshots/preview/?month=2026-04')
        self.assertEqual(preview_res.status_code, status.HTTP_200_OK)
        row = next(r for r in preview_res.data['rows'] if r['employee_code'] == 'G-15')
        self.assertEqual(row['recurring_bonus_pay'], 540.0)
        self.assertEqual(row['direct_bonus_pay'], 125.0)
        self.assertEqual(row['bonus_pay'], 665.0)
        self.assertEqual(row['net_pay'], 6065.0)


