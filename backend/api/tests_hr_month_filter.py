"""اختبارات الفلترة الشهرية لسجلات البصمة والجزاءات والسُلف.

الهدف: التأكد من أن تمرير ``month`` يقلّل حجم البيانات المُرسلة من قاعدة
Neon، مع الإبقاء على السلوك القديم (كل السجلات) عند عدم تمريره حتى لا تتأثر
الاستدعاءات العامة مثل تصدير Excel الشامل.
"""
from datetime import date

from django.test import TestCase
from rest_framework.test import APIClient

from .models import (
    HRAttendanceRecord, HREmployee, HRJobTitle, HRLoan, HRPenalty,
    RANK_LEVEL_ONE, RANK_LEVEL_THREE, UserProfile,
)


class HRMonthFilterBase(TestCase):
    def setUp(self):
        self.user = UserProfile(
            username='sudo', real_name='sudo', is_sudo=True, rank_level=RANK_LEVEL_ONE,
        )
        self.user.auth_token = 'token-sudo'
        self.user.set_password('x')
        self.user.save()

        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION='Bearer token-sudo')

        self.job = HRJobTitle.objects.create(title='خياط', department='sewing')
        self.employee = HREmployee.objects.create(
            name='موظف أول', job=self.job, monthly_salary=3000, rank_level=RANK_LEVEL_THREE,
        )
        self.other_employee = HREmployee.objects.create(
            name='موظف ثانٍ', job=self.job, monthly_salary=3000, rank_level=RANK_LEVEL_THREE,
        )

    @staticmethod
    def dates_from(response):
        return sorted(item['date'] for item in response.json())


class HRAttendanceMonthFilterTests(HRMonthFilterBase):
    def setUp(self):
        super().setUp()
        # 2026-11-01 يوم أحد، لذا نافذة الأسبوع السابق تبدأ 2026-10-26.
        for employee, day in (
            (self.employee, date(2026, 10, 25)),  # خارج نافذة الأسبوع السابق
            (self.employee, date(2026, 10, 26)),  # أول يوم في النافذة السابقة
            (self.employee, date(2026, 11, 1)),
            (self.employee, date(2026, 11, 15)),
            (self.employee, date(2026, 12, 1)),  # الشهر التالي
            (self.other_employee, date(2026, 11, 2)),
        ):
            HRAttendanceRecord.objects.create(employee=employee, date=day, status='present')

    def test_without_month_returns_all_records(self):
        response = self.client.get('/api/hr-attendance-records/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 6)

    def test_month_returns_only_that_month(self):
        response = self.client.get('/api/hr-attendance-records/', {'month': '2026-11'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self.dates_from(response),
            ['2026-11-01', '2026-11-02', '2026-11-15'],
        )

    def test_include_prev_week_extends_window_six_days(self):
        response = self.client.get(
            '/api/hr-attendance-records/',
            {'month': '2026-11', 'include_prev_week': '1'},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self.dates_from(response),
            ['2026-10-26', '2026-11-01', '2026-11-02', '2026-11-15'],
        )

    def test_employee_id_filters_within_month(self):
        response = self.client.get(
            '/api/hr-attendance-records/',
            {'month': '2026-11', 'employee_id': self.employee.client_id},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.dates_from(response), ['2026-11-01', '2026-11-15'])

    def test_unknown_employee_id_returns_empty_list(self):
        response = self.client.get(
            '/api/hr-attendance-records/',
            {'month': '2026-11', 'employee_id': 'emp-missing'},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])


class HRPenaltyAndLoanMonthFilterTests(HRMonthFilterBase):
    def setUp(self):
        super().setUp()
        for employee, day in (
            (self.employee, date(2026, 10, 15)),
            (self.employee, date(2026, 11, 3)),
            (self.employee, date(2026, 12, 3)),
            (self.other_employee, date(2026, 11, 4)),
        ):
            HRPenalty.objects.create(employee=employee, date=day, penalty_type='days', value=1)
            HRLoan.objects.create(employee=employee, date=day, amount=100)

    def test_penalties_without_month_returns_all(self):
        response = self.client.get('/api/hr-penalties/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 4)

    def test_penalties_month_filters_records(self):
        response = self.client.get('/api/hr-penalties/', {'month': '2026-11'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.dates_from(response), ['2026-11-03', '2026-11-04'])

    def test_penalties_invalid_month_format_is_ignored(self):
        response = self.client.get('/api/hr-penalties/', {'month': 'nov-2026'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 4)

    def test_loans_without_month_returns_all(self):
        response = self.client.get('/api/hr-loans/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 4)

    def test_loans_month_filters_records(self):
        response = self.client.get('/api/hr-loans/', {'month': '2026-12'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.dates_from(response), ['2026-12-03'])
