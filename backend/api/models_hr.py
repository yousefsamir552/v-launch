from django.db import models
from django.contrib.auth.models import User
from decimal import Decimal
import uuid
from .storage_r2 import guard_image_field
from .models_auth import *
from .models_warehouse import *
from .models_production import *

def generate_employee_code() -> str:
    """Default employee/biotime ID generated when the user leaves it empty."""
    return f"EMP-{uuid.uuid4().hex[:6].upper()}"


HR_LOAN_KIND_CHOICES = [
    ('standard', 'سلفة عادية'),
    ('installment', 'قسط سلفة'),
    ('carryover_debt', 'مديونية مرحّلة'),
]
HR_LOAN_KIND_LABELS = dict(HR_LOAN_KIND_CHOICES)

HR_BONUS_CATEGORY_CHOICES = [
    ('attendance', 'حافز انتظام'),
    ('quality', 'مكافأة جودة'),
    ('other', 'أخرى'),
]
HR_BONUS_CATEGORY_LABELS = dict(HR_BONUS_CATEGORY_CHOICES)

HR_BONUS_VALUE_TYPE_CHOICES = [
    ('fixed', 'مبلغ ثابت'),
    ('percent', 'نسبة من المرتب'),
]
HR_BONUS_VALUE_TYPE_LABELS = dict(HR_BONUS_VALUE_TYPE_CHOICES)


class HRBonusPlan(models.Model):
    """نظام مكافأة دورية ديناميكي (حافز انتظام / جودة / أخرى) يمكن إلحاق الموظفين به."""
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    name = models.CharField(max_length=200, verbose_name="اسم نظام المكافأة")
    category = models.CharField(
        max_length=30,
        choices=HR_BONUS_CATEGORY_CHOICES,
        default='attendance',
        verbose_name="الفئة / السبب",
    )
    value_type = models.CharField(
        max_length=20,
        choices=HR_BONUS_VALUE_TYPE_CHOICES,
        default='fixed',
        verbose_name="نوع القيمة",
    )
    value = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        verbose_name="القيمة (جنيه أو نسبة %)",
    )
    requires_full_month = models.BooleanField(
        default=True,
        verbose_name="يشترط اكتمال الشهر (لا يُصرف للتعيين/الترك في منتصف الشهر)",
    )
    affected_by_absence = models.BooleanField(default=True, verbose_name="تتأثر بالغياب")
    absence_deduction_percent = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('100.00'),
        verbose_name="نسبة الخصم لكل يوم غياب (%)",
    )
    affected_by_late = models.BooleanField(default=True, verbose_name="تتأثر بالتأخير")
    late_deduction_percent = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('100.00'),
        verbose_name="نسبة الخصم لكل مرة تأخير مخصومة (%)",
    )
    is_active = models.BooleanField(default=True, verbose_name="نشط")
    notes = models.TextField(blank=True, default='', verbose_name="ملاحظات")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name', 'id']
        verbose_name = "نظام مكافأة دورية"
        verbose_name_plural = "أنظمة المكافآت الدورية"

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('hr-bplan')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.name} ({self.get_category_display()})"


class HRJobTitle(models.Model):
    """وظيفة داخل المصنع مع قسمها / مكان عملها."""
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    title = models.CharField(max_length=200, verbose_name="اسم الوظيفة")
    department = models.CharField(
        max_length=50,
        choices=HR_DEPARTMENT_CHOICES,
        default='sewing',
        verbose_name="القسم / مكان العمل",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['department', 'title', 'id']

    @property
    def department_label(self) -> str:
        return HR_DEPARTMENT_LABELS.get(self.department, self.department)

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('hr-job')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.title} ({self.department_label})"


class HREmployee(models.Model):
    """ملف الموظف وربطه بجهاز البصمة ZKTeco عبر employee_code."""
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    employee_code = models.CharField(
        max_length=50, unique=True, blank=True, db_index=True,
        verbose_name="كود الموظف / ID البصمة",
    )
    name = models.CharField(max_length=200, verbose_name="اسم الموظف")
    job = models.ForeignKey(
        HRJobTitle, on_delete=models.PROTECT, related_name='employees',
        verbose_name="الوظيفة",
    )
    monthly_salary = models.FloatField(default=0.0, verbose_name="المرتب الشهري")
    rule_application_mode = models.CharField(
        max_length=20, choices=HR_RULE_APPLICATION_CHOICES, default='auto',
        verbose_name="طريقة تطبيق قواعد التأخير/الخصم",
    )
    national_id = models.CharField(max_length=50, blank=True, null=True, verbose_name="الرقم القومي")
    birth_date = models.DateField(blank=True, null=True, verbose_name="تاريخ الميلاد")
    hire_date = models.DateField(blank=True, null=True, verbose_name="تاريخ التعيين / بداية العمل")
    termination_date = models.DateField(blank=True, null=True, verbose_name="تاريخ ترك العمل (اختياري)")
    shift_start_time = models.TimeField(blank=True, null=True, verbose_name="بداية وردية الموظف (اختياري)")
    shift_end_time = models.TimeField(blank=True, null=True, verbose_name="نهاية وردية الموظف (اختياري)")
    late_grace_minutes = models.IntegerField(blank=True, null=True, verbose_name="رصيد السماح المخصص للتأخير (دقائق)")
    late_grace_period_months = models.IntegerField(blank=True, null=True, verbose_name="دورية رصيد السماح المخصصة (شهور)")
    recurring_bonus_plans = models.ManyToManyField(
        'HRBonusPlan',
        blank=True,
        related_name='employees',
        verbose_name="أنظمة المكافآت الدورية",
    )
    phone = models.CharField(max_length=50, blank=True, null=True, verbose_name="الهاتف")
    photo = models.TextField(blank=True, null=True, verbose_name="صورة الموظف (Base64 أو URL)")
    notes = models.TextField(blank=True, null=True, verbose_name="ملاحظات")
    is_active = models.BooleanField(default=True, verbose_name="نشط")
    rank_level = models.IntegerField(
        default=DEFAULT_RANK_LEVEL,
        choices=RANK_LEVEL_CHOICES,
        db_index=True,
        verbose_name="الرتبة الهرمية",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name', 'id']

    @property
    def department(self) -> str:
        return self.job.department if self.job else ''

    @property
    def department_label(self) -> str:
        return HR_DEPARTMENT_LABELS.get(self.department, self.department)

    def save(self, *args, **kwargs):
        guard_image_field(self, 'photo', 'صورة الموظف')
        if not self.client_id:
            self.client_id = generate_client_id('hr-emp')
        # الرتبة 0 (Sudo) محصورة حصرياً في حساب الطوارئ ولا تُمنح لأي موظف.
        if self.rank_level == RANK_SUDO or self.rank_level not in RANK_LEVEL_KEYS:
            self.rank_level = DEFAULT_RANK_LEVEL
        if not self.employee_code:
            code = generate_employee_code()
            while HREmployee.objects.filter(employee_code=code).exists():
                code = generate_employee_code()
            self.employee_code = code
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.employee_code} - {self.name}"


class HRAttendanceSettings(models.Model):
    """إعدادات عامة (Singleton) للحضور والانصراف وقواعد التأخير."""
    official_start_time = models.TimeField(default='08:00', verbose_name="موعد الحضور الرسمي")
    official_end_time = models.TimeField(default='17:00', verbose_name="موعد الانصراف الرسمي")
    weekly_off_day = models.CharField(
        max_length=20, choices=WEEK_DAY_CHOICES, default=DEFAULT_WEEKLY_OFF_DAY,
        verbose_name="يوم الإجازة الأسبوعية المدفوعة",
    )
    month_calculation_days = models.IntegerField(default=30, verbose_name="عدد أيام الشهر الحسابية")
    weekly_off_work_multiplier = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('1.00'),
        verbose_name="معامل أجر العمل يوم الإجازة الأسبوعية",
    )
    weekly_off_partial_hour_multiplier = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('1.00'),
        verbose_name="معامل ساعات العمل الجزئي يوم الإجازة الأسبوعية",
    )
    overtime_regular_multiplier = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('1.00'),
        verbose_name="معامل الإضافي في الأيام العادية",
    )
    overtime_night_multiplier = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('1.00'),
        verbose_name="معامل الإضافي الليلي",
    )
    overtime_holiday_multiplier = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('2.00'),
        verbose_name="معامل العمل في الإجازات الرسمية",
    )
    monthly_late_grace_minutes = models.IntegerField(
        default=0,
        verbose_name="رصيد السماح الافتراضي للتأخير (دقائق)",
    )
    monthly_late_grace_period_months = models.IntegerField(
        default=1,
        verbose_name="دورية رصيد السماح الافتراضية (شهور)",
    )
    rules_json = models.JSONField(default=list, blank=True, verbose_name="قواعد التأخير والانصراف والغياب")
    overtime_rules = models.JSONField(default=list, blank=True, verbose_name="قواعد ومواعيد العمل الإضافي")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "إعدادات الحضور والانصراف"
        verbose_name_plural = "إعدادات الحضور والانصراف"

    @classmethod
    def get_solo(cls):
        obj = cls.objects.first()
        if not obj:
            obj = cls.objects.create(
                month_calculation_days=30,
                weekly_off_day=DEFAULT_WEEKLY_OFF_DAY,
                rules_json=[
                    {
                        'id': 'hr-rule-late-10',
                        'violation_type': 'late_arrival',
                        'label': 'تأخير حتى 10 دقائق',
                        'from_minutes': 0,
                        'to_minutes': 10,
                        'until_time': '',
                        'deduction_type': 'days',
                        'deduction_value': 0.25,
                        'apply_mode': 'auto',
                        'uses_monthly_grace': False,
                    },
                    {
                        'id': 'hr-rule-early-leave',
                        'violation_type': 'early_departure',
                        'label': 'انصراف مبكر حتى 30 دقيقة',
                        'from_minutes': 0,
                        'to_minutes': 30,
                        'until_time': '',
                        'deduction_type': 'days',
                        'deduction_value': 0.25,
                        'apply_mode': 'manual_review',
                    },
                    {
                        'id': 'hr-rule-absence',
                        'violation_type': 'absence',
                        'label': 'غياب يوم بدون عذر (خصم يومين)',
                        'from_minutes': 0,
                        'to_minutes': 0,
                        'until_time': '',
                        'deduction_type': 'days',
                        'deduction_value': 2,
                        'apply_mode': 'manual_review',
                    },
                ],
            )
        return obj

    @property
    def weekly_off_day_label(self) -> str:
        return WEEK_DAY_LABELS.get(self.weekly_off_day, self.weekly_off_day)

    @property
    def working_hours_per_day(self) -> float:
        """حساب ساعات العمل اليومية ديناميكياً من موعد الحضور والانصراف الرسمي."""
        from django.utils.dateparse import parse_time as _parse_time

        start = self.official_start_time
        end = self.official_end_time
        if isinstance(start, str):
            start = _parse_time(start)
        if isinstance(end, str):
            end = _parse_time(end)
        if not start or not end:
            return 9.0
        start_mins = start.hour * 60 + start.minute
        end_mins = end.hour * 60 + end.minute
        diff = end_mins - start_mins
        if diff <= 0:
            diff += 24 * 60
        hours = round(diff / 60.0, 4)
        return hours if hours > 0 else 9.0

    def save(self, *args, **kwargs):
        # عدد أيام الشهر الحسابية ثابت دائماً = 30 يوماً
        self.month_calculation_days = 30
        for field_name, default_val in (
            ('weekly_off_work_multiplier', Decimal('1.00')),
            ('weekly_off_partial_hour_multiplier', Decimal('1.00')),
            ('overtime_regular_multiplier', Decimal('1.00')),
            ('overtime_night_multiplier', Decimal('1.00')),
            ('overtime_holiday_multiplier', Decimal('2.00')),
        ):
            try:
                mult = Decimal(str(getattr(self, field_name)))
                if mult < 0:
                    mult = default_val
                setattr(self, field_name, mult)
            except Exception:
                setattr(self, field_name, default_val)
        try:
            self.monthly_late_grace_minutes = max(0, int(self.monthly_late_grace_minutes or 0))
        except Exception:
            self.monthly_late_grace_minutes = 0
        try:
            self.monthly_late_grace_period_months = max(1, int(self.monthly_late_grace_period_months or 1))
        except Exception:
            self.monthly_late_grace_period_months = 1
        super().save(*args, **kwargs)

    def __str__(self):
        return "إعدادات الحضور والانصراف"


class HRAttendanceRecord(models.Model):
    """سجل الحضور والانصراف اليومي القادم من جهاز البصمة ZKTeco."""
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    employee = models.ForeignKey(
        HREmployee, on_delete=models.CASCADE, related_name='attendance_records',
        verbose_name="الموظف",
    )
    date = models.DateField(default=date.today, db_index=True, verbose_name="التاريخ")
    check_in = models.TimeField(blank=True, null=True, verbose_name="بصمة الحضور")
    check_out = models.TimeField(blank=True, null=True, verbose_name="بصمة الانصراف")
    status = models.CharField(
        max_length=20, choices=HR_ATTENDANCE_STATUS_CHOICES, default='present',
        verbose_name="الحالة",
    )
    is_excused = models.BooleanField(default=False, verbose_name="بعذر")
    absence_decision = models.CharField(
        max_length=20,
        choices=HR_ABSENCE_DECISION_CHOICES,
        default='',
        blank=True,
        verbose_name="قرار الغياب",
    )
    excuse_note = models.TextField(blank=True, null=True, verbose_name="ملاحظة العذر")
    manual_deduction = models.BooleanField(default=False, verbose_name="خصم يدوي")
    calculated_deduction_days = models.FloatField(default=0.0, verbose_name="الخصم المحتسب (أيام)")
    calculated_deduction_hours = models.FloatField(default=0.0, verbose_name="الخصم المحتسب (ساعات)")
    late_minutes = models.FloatField(default=0.0, verbose_name="دقائق التأخير (محتسبة)")
    early_minutes = models.FloatField(default=0.0, verbose_name="دقائق الانصراف المبكر (محتسبة)")
    overtime_days = models.FloatField(default=0.0, verbose_name="العمل الإضافي (أيام)")
    overtime_hours = models.FloatField(default=0.0, verbose_name="العمل الإضافي (ساعات)")
    weekly_off_worked_hours = models.FloatField(
        blank=True, null=True, verbose_name="ساعات العمل الفعلية يوم الإجازة"
    )
    weekly_off_hour_multiplier_override = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        blank=True,
        null=True,
        verbose_name="معامل ساعات يوم الإجازة المخصص",
    )
    sunday_deduction_days = models.FloatField(default=0.0, verbose_name="خصم يوم الإجازة (أيام)")
    sunday_deduction_note = models.TextField(blank=True, default='', verbose_name="سبب خصم يوم الإجازة")
    review_status = models.CharField(
        max_length=20, choices=HR_REVIEW_STATUS_CHOICES, default='auto_applied',
        verbose_name="حالة المراجعة",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-date', '-id']
        constraints = [
            models.UniqueConstraint(
                fields=['employee', 'date'],
                name='uniq_hr_attendance_employee_date',
            ),
        ]

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('hr-att')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.employee} - {self.date}"


class HRPenalty(models.Model):
    """جزاء يدوي على الموظف (بالأيام أو الساعات)."""
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    employee = models.ForeignKey(
        HREmployee, on_delete=models.CASCADE, related_name='penalties',
        verbose_name="الموظف",
    )
    date = models.DateField(default=date.today, db_index=True, verbose_name="التاريخ")
    penalty_type = models.CharField(
        max_length=10, choices=HR_PENALTY_TYPE_CHOICES, default='days',
        verbose_name="نوع الجزاء",
    )
    value = models.FloatField(default=0.0, verbose_name="القيمة (أيام أو ساعات)")
    reason = models.TextField(blank=True, default='', verbose_name="السبب / الوصف")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-date', '-id']

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('hr-pen')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.employee} - {self.penalty_type} {self.value}"


class HRLoan(models.Model):
    """سلفة مالية أو قسط سلفة أو مديونية مرحّلة تُخصم من المرتبات."""
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    employee = models.ForeignKey(
        HREmployee, on_delete=models.CASCADE, related_name='loans',
        verbose_name="الموظف",
    )
    date = models.DateField(default=date.today, db_index=True, verbose_name="التاريخ")
    amount = models.FloatField(default=0.0, verbose_name="مبلغ السلفة / القسط")
    loan_kind = models.CharField(
        max_length=20,
        choices=HR_LOAN_KIND_CHOICES,
        default='standard',
        db_index=True,
        verbose_name="نوع السلفة / المديونية",
    )
    parent_loan = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        blank=True,
        null=True,
        related_name='installments',
        verbose_name="السلفة الأصلية",
    )
    total_amount = models.FloatField(blank=True, null=True, verbose_name="إجمالي السلفة قبل التقسيط")
    installments_count = models.IntegerField(default=1, verbose_name="عدد الأقساط")
    installment_number = models.IntegerField(default=1, verbose_name="رقم القسط")
    source_month = models.CharField(
        max_length=7,
        blank=True,
        default='',
        db_index=True,
        verbose_name="الشهر المصدر للمديونية المرحّلة",
    )
    notes = models.TextField(blank=True, default='', verbose_name="ملاحظات")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-date', '-id']

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('hr-loan')
        if self.total_amount is None:
            self.total_amount = self.amount
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.employee} - {self.amount} ({self.get_loan_kind_display()})"


class HRDirectBonus(models.Model):
    """مكافأة فورية / مباشرة تُصرف لموظف في شهر محدد."""
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    employee = models.ForeignKey(
        HREmployee, on_delete=models.CASCADE, related_name='direct_bonuses',
        verbose_name="الموظف",
    )
    date = models.DateField(default=date.today, db_index=True, verbose_name="التاريخ")
    amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal('0.00'),
        verbose_name="مبلغ المكافأة",
    )
    reason = models.TextField(blank=True, default='', verbose_name="السبب / البيان")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-date', '-id']
        verbose_name = "مكافأة فورية"
        verbose_name_plural = "المكافآت الفورية"

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('hr-bonus')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.employee} - {self.amount}"


class HRPayrollSnapshot(models.Model):
    """
    لقطة شهرية مجمّدة لكشف المرتبات عند «اعتماد وإغلاق الشهر».
    تحفظ رواتب الموظفين وقواعد الحضور وصافي المرتب بشكل دائم حتى لا تتأثر
    بأي تعديل مستقبلي على الرواتب أو القواعد أو تعطيل الموظفين.
    """
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    month = models.CharField(max_length=7, unique=True, db_index=True, verbose_name="الشهر (YYYY-MM)")
    is_locked = models.BooleanField(default=True, verbose_name="الشهر معتمد ومغلق")
    locked_at = models.DateTimeField(auto_now_add=True, verbose_name="تاريخ الاعتماد والإغلاق")
    locked_by = models.CharField(max_length=200, blank=True, default='', verbose_name="تم الاعتماد بواسطة")
    settings_snapshot = models.JSONField(default=dict, blank=True, verbose_name="لقطة إعدادات الحضور والرواتب")
    rows_json = models.JSONField(default=list, blank=True, verbose_name="تفاصيل كشف الرواتب المجمد")
    totals_json = models.JSONField(default=dict, blank=True, verbose_name="إجماليات الشهر المجمد")
    notes = models.TextField(blank=True, default='', verbose_name="ملاحظات الإغلاق")

    class Meta:
        ordering = ['-month', '-id']
        verbose_name = "اعتماد وإغلاق كشف رواتب شهري"
        verbose_name_plural = "كشوف الرواتب المعتمدة والمغلقة"

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('hr-pay')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"كشف رواتب {self.month} ({'مغلق' if self.is_locked else 'مفتوح'})"



