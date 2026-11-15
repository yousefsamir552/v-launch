"""اختبارات يوم الإجازة الأسبوعية الديناميكي في حضور ومرتبات الموارد البشرية."""
from datetime import date

from django.test import SimpleTestCase

from .hr_attendance_io import (
    DEFAULT_WEEKLY_OFF_WEEKDAY,
    weekly_off_weekday,
)
from .hr_reports import _compute_month_accrual


class WeeklyOffWeekdayTests(SimpleTestCase):
    """تحويل قيمة الإعدادات إلى رقم date.weekday() (الإثنين=0 ... الأحد=6)."""

    class _Settings:
        def __init__(self, weekly_off_day):
            self.weekly_off_day = weekly_off_day

    def test_maps_english_day_keys(self):
        self.assertEqual(weekly_off_weekday(self._Settings('Monday')), 0)
        self.assertEqual(weekly_off_weekday(self._Settings('Friday')), 4)
        self.assertEqual(weekly_off_weekday(self._Settings('Saturday')), 5)
        self.assertEqual(weekly_off_weekday(self._Settings('Sunday')), 6)

    def test_maps_arabic_day_names(self):
        self.assertEqual(weekly_off_weekday(self._Settings('الجمعة')), 4)
        self.assertEqual(weekly_off_weekday(self._Settings('الاحد')), 6)

    def test_falls_back_to_sunday(self):
        self.assertEqual(weekly_off_weekday(self._Settings('')), DEFAULT_WEEKLY_OFF_WEEKDAY)
        self.assertEqual(weekly_off_weekday(self._Settings('nonsense')), DEFAULT_WEEKLY_OFF_WEEKDAY)
        self.assertEqual(weekly_off_weekday(None), DEFAULT_WEEKLY_OFF_WEEKDAY)


class MonthAccrualWeeklyOffTests(SimpleTestCase):
    """استحقاق الشهر يتبع يوم الإجازة الأسبوعية المحدد في الإعدادات."""

    class _Record:
        def __init__(self, status='present', check_in='08:30', is_excused=False):
            self.status = status
            self.check_in = check_in
            self.is_excused = is_excused

    def _records(self, days):
        return {day: self._Record() for day in days}

    def test_friday_off_counts_all_workdays_before_it(self):
        # نوفمبر 2026 يبدأ يوم الأحد؛ أول جمعة فيه هي 6 نوفمبر.
        # حتى 5 نوفمبر لا يوجد أي يوم إجازة، فكل الأيام الخمسة عمل فعلي.
        records = self._records([date(2026, 11, day) for day in range(1, 6)])
        accrual = _compute_month_accrual(records, '2026-11', date(2026, 11, 5), weekly_off_index=4)
        self.assertEqual(accrual['attended_days'], 5)
        self.assertEqual(accrual['paid_sunday_days'], 0)
        self.assertEqual(accrual['earned_days'], 5)

    def test_sunday_off_skips_first_day_of_november(self):
        # مع اعتماد الأحد إجازة أسبوعية لا توجد بصمة في 1 نوفمبر (إجازة)،
        # ولا توجد بيانات للأسبوع السابق فيُحتسب المستحق 4 أيام فقط حتى 5 نوفمبر.
        records = self._records([date(2026, 11, day) for day in range(2, 6)])
        accrual = _compute_month_accrual(records, '2026-11', date(2026, 11, 5), weekly_off_index=6)
        self.assertEqual(accrual['attended_days'], 4)
        self.assertEqual(accrual['paid_sunday_days'], 0)
        self.assertEqual(accrual['earned_days'], 4)

    def test_worked_weekly_off_day_counts_as_workday(self):
        # الجمعة 6 نوفمبر بها بصمة حضور → يوم عمل عادي مستحق.
        days = [date(2026, 11, day) for day in range(1, 7)]
        records = self._records(days)
        accrual = _compute_month_accrual(records, '2026-11', date(2026, 11, 6), weekly_off_index=4)
        self.assertEqual(accrual['attended_days'], 6)
        self.assertEqual(accrual['paid_sunday_days'], 0)
        self.assertEqual(accrual['earned_days'], 6)
