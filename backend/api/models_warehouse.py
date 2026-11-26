from django.db import models
from django.contrib.auth.models import User
from decimal import Decimal
import uuid
from .storage_r2 import guard_image_field
from .models_auth import *

class SizeDef(models.Model):
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    name = models.CharField(max_length=100, verbose_name="اسم الفئة")
    values = models.CharField(max_length=255, verbose_name="المقاسات")
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('size')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.name}: {self.values}"


class Supplier(models.Model):
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    name = models.CharField(max_length=200, verbose_name="اسم المورد")
    phone = models.CharField(max_length=50, blank=True, default='', verbose_name="رقم الهاتف")
    whatsapp_group_link = models.CharField(
        max_length=500,
        blank=True,
        default='',
        verbose_name="رابط جروب الواتساب (اختياري)",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('sup')
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


# ---------------------------------------------------------------------------
# الورش والمطابع الخارجية (External Workshops & Print Shops)
# كل ورشة يمكن أن تحمل تخصصاً واحداً أو أكثر؛ نستخدم JSONField بقائمة مفاتيح.
# ---------------------------------------------------------------------------
WORKSHOP_TYPE_CHOICES = [
    ('printing', 'مطبعة'),
    ('embroidery', 'تطريز'),
    ('sewing', 'ورشة مكن / خياطة'),
    ('finishing', 'ورشة تشطيب'),
    ('ironing', 'ورشة مكواة'),
    ('packaging', 'ورشة تعبئة وتغليف'),
]
WORKSHOP_TYPE_KEYS = [key for key, _label in WORKSHOP_TYPE_CHOICES]
WORKSHOP_TYPE_LABELS = dict(WORKSHOP_TYPE_CHOICES)


class Workshop(models.Model):
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    name = models.CharField(max_length=200, verbose_name="اسم الورشة / المطبعة")
    phone = models.CharField(max_length=50, blank=True, default='', verbose_name="رقم الهاتف")
    whatsapp_group_link = models.CharField(
        max_length=500,
        blank=True,
        default='',
        verbose_name="رابط جروب الواتساب (اختياري)",
    )
    workshop_type = models.JSONField(
        default=list,
        blank=True,
        verbose_name="تخصص الورشة (يمكن اختيار أكثر من تخصص)",
    )
    notes = models.TextField(blank=True, default='', verbose_name="ملاحظات")
    created_at = models.DateTimeField(auto_now_add=True)

    def normalized_types(self):
        """يرجع قائمة مفاتيح التخصصات الصحيحة فقط."""
        raw = self.workshop_type if isinstance(self.workshop_type, list) else []
        return [key for key in raw if key in WORKSHOP_TYPE_KEYS]

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('wrk')
        if isinstance(self.workshop_type, list):
            self.workshop_type = self.normalized_types()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Fabric(models.Model):
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    name = models.CharField(max_length=200, verbose_name="اسم القماش / الخامة")
    description = models.TextField(blank=True, null=True, default='', verbose_name="الوصف")
    unit = models.CharField(max_length=30, default='كيلو', verbose_name="الوحدة")
    supplier_id_ref = models.CharField(max_length=100, blank=True, null=True, verbose_name="معرف المورد")
    image = models.TextField(blank=True, null=True, verbose_name="صورة الخامة")
    is_deleted = models.BooleanField(default=False, db_index=True)

    # Legacy fields kept for compatibility
    color = models.CharField(max_length=100, blank=True, default='', verbose_name="اللون")
    roll_number = models.CharField(max_length=100, blank=True, null=True, verbose_name="رقم التوب")
    quantity_kg = models.FloatField(default=0.0, verbose_name="الوزن بالكيلو")
    supplier = models.CharField(max_length=200, blank=True, null=True, verbose_name="المورد")
    price_per_meter = models.DecimalField(max_digits=10, decimal_places=2, default=0.0, verbose_name="سعر المتر")
    notes = models.TextField(blank=True, null=True, verbose_name="ملاحظات")
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        guard_image_field(self, 'image', 'صورة الخامة')
        if not self.client_id:
            self.client_id = generate_client_id('fab')
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class FabricColor(models.Model):
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    fabric = models.ForeignKey(Fabric, on_delete=models.CASCADE, related_name="colors", verbose_name="الخامة")
    color_code = models.CharField(max_length=100, verbose_name="كود اللون")
    color_name = models.CharField(max_length=150, blank=True, default='', verbose_name="اسم اللون")
    hex_code = models.CharField(max_length=30, default='#64748b', verbose_name="درجة اللون")
    price_per_unit = models.FloatField(default=0.0, verbose_name="سعر الوحدة")
    quantity = models.FloatField(default=0.0, verbose_name="الكمية الفعلية")
    reserved_quantity = models.FloatField(default=0.0, verbose_name="الكمية المحجوزة")
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('col')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.fabric.name} - {self.color_code} ({self.color_name})"


class FabricTransaction(models.Model):
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    color = models.ForeignKey(FabricColor, on_delete=models.CASCADE, related_name="transactions", verbose_name="اللون")
    fabric = models.ForeignKey(Fabric, on_delete=models.CASCADE, related_name="transactions", verbose_name="الخامة")
    model = models.ForeignKey(
        'api.ModelItem',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='fabric_transactions',
        verbose_name="الموديل",
    )
    model_code_ref = models.CharField(max_length=150, blank=True, default='', verbose_name="المرجع / كود الموديل")
    notes = models.TextField(blank=True, default='', verbose_name="ملاحظات")
    operation = models.CharField(max_length=20, default='deduct', verbose_name="نوع العملية")
    amount = models.FloatField(default=0.0, verbose_name="الكمية")
    # سعر الوحدة التاريخي وقت الحركة: يثبّت تكلفة الموديلات القديمة حتى لو تغير سعر المخزن.
    unit_price_snapshot = models.DecimalField(max_digits=12, decimal_places=2, default=0.0, verbose_name="سعر الوحدة وقت العملية")
    supplier = models.ForeignKey(Supplier, on_delete=models.SET_NULL, null=True, blank=True, related_name="+", verbose_name="المورد")
    timestamp = models.CharField(max_length=100, blank=True, default='', verbose_name="التوقيت")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('tr')
        super().save(*args, **kwargs)


class AccessoryType(models.Model):
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    name = models.CharField(max_length=150, verbose_name="اسم التصنيف")
    icon = models.CharField(max_length=50, blank=True, default='Sparkles', verbose_name="الأيقونة")
    description = models.TextField(blank=True, default='', verbose_name="الوصف")
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('type')
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Accessory(models.Model):
    USAGE_TYPES = [
        ('stock', 'رصيد مستمر (Stock)'),
        ('custom_model', 'استخدام واحد لموديل معين'),
        ('carryover', 'رصيد سابق / مرحّل (من موسم سابق)'),
    ]

    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    type_id_ref = models.CharField(max_length=100, blank=True, default='type-1', verbose_name="معرف التصنيف")
    type_name = models.CharField(max_length=150, blank=True, default='عام', verbose_name="اسم التصنيف")
    code = models.CharField(max_length=100, blank=True, default='', verbose_name="كود الصنف")
    name = models.CharField(max_length=200, verbose_name="اسم الصنف")
    image = models.TextField(blank=True, null=True, verbose_name="صورة الصنف")
    usage_type = models.CharField(max_length=20, choices=USAGE_TYPES, default='stock', verbose_name="نوع الاستخدام")
    custom_model_code = models.CharField(max_length=100, blank=True, null=True, verbose_name="كود الموديل المخصص له")
    unit = models.CharField(max_length=50, default="قطعة", verbose_name="وحدة القياس")
    current_stock = models.DecimalField(max_digits=12, decimal_places=3, default=Decimal('0'), verbose_name="الرصيد الفعلي الحالي")
    reserved_quantity = models.FloatField(default=0.0, verbose_name="الكمية المحجوزة")
    min_threshold = models.DecimalField(max_digits=12, decimal_places=3, default=Decimal('10'), verbose_name="الحد الأدنى للتنبيه")

    # For custom_model usage type
    target_quantity = models.DecimalField(max_digits=12, decimal_places=3, default=Decimal('0'), verbose_name="الكمية المطلوبة / المستهدفة")
    delivered_quantity = models.DecimalField(max_digits=12, decimal_places=3, default=Decimal('0'), verbose_name="الكمية التي تم توريدها")
    withdrawn_for_model = models.BooleanField(default=False, verbose_name="تم سحبه واكتماله بالكامل للموديل")

    price_per_unit = models.DecimalField(max_digits=10, decimal_places=2, default=0.0, verbose_name="سعر الوحدة")
    supplier_id_ref = models.CharField(max_length=100, blank=True, null=True, verbose_name="معرف المورد")
    supplier = models.CharField(max_length=200, blank=True, null=True, verbose_name="المورد")
    created_at_str = models.CharField(max_length=50, blank=True, null=True, verbose_name="تاريخ الإضافة")
    notes = models.TextField(blank=True, null=True)

    @property
    def deficit_quantity(self):
        # بضاعة "الرصيد السابق / المرحّل" تُصفّى فقط ولا تُحسب ضمن النواقص أبداً.
        if self.usage_type == 'carryover':
            return 0
        if self.usage_type == 'custom_model':
            if self.withdrawn_for_model:
                return 0
            target = Decimal(str(self.target_quantity or 0))
            delivered = Decimal(str(self.delivered_quantity or 0))
            return float(round(max(Decimal('0'), target - delivered), 3))
        # حد تنبيه صفر (أو أقل) يعني أن التنبيهات معطّلة لهذا الصنف.
        threshold = Decimal(str(self.min_threshold or 0))
        if threshold <= 0:
            return 0
        stock = Decimal(str(self.current_stock or 0))
        reserved = Decimal(str(self.reserved_quantity or 0))
        available = max(Decimal('0'), stock - reserved)
        if available >= threshold:
            return 0
        return float(round(threshold - available, 3))

    def save(self, *args, **kwargs):
        guard_image_field(self, 'image', 'صورة الصنف')
        if not self.client_id:
            self.client_id = generate_client_id('acc')
        if not self.created_at_str:
            self.created_at_str = date.today().isoformat()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.name} ({self.get_usage_type_display()})"


class AccessoryTransaction(models.Model):
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    accessory = models.ForeignKey(Accessory, on_delete=models.CASCADE, related_name="transactions", verbose_name="الإكسسوار")
    accessory_code = models.CharField(max_length=100, blank=True, default='', verbose_name="كود الصنف")
    accessory_name = models.CharField(max_length=200, blank=True, default='', verbose_name="اسم الصنف")
    operation = models.CharField(max_length=20, default='deduct', verbose_name="نوع العملية")
    amount = models.FloatField(default=0.0, verbose_name="الكمية")
    model = models.ForeignKey(
        'api.ModelItem',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='accessory_transactions',
        verbose_name="الموديل",
    )
    model_code_ref = models.CharField(max_length=150, blank=True, default='', verbose_name="كود الموديل")
    notes = models.TextField(blank=True, default='', verbose_name="ملاحظات")
    # سعر الوحدة التاريخي وقت الحركة: يثبّت تكلفة الموديلات القديمة حتى لو تغير سعر المخزن.
    unit_price_snapshot = models.DecimalField(max_digits=12, decimal_places=2, default=0.0, verbose_name="سعر الوحدة وقت العملية")
    supplier = models.ForeignKey(Supplier, on_delete=models.SET_NULL, null=True, blank=True, related_name="+", verbose_name="المورد")
    timestamp = models.CharField(max_length=100, blank=True, default='', verbose_name="التوقيت")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('acc-tr')
        super().save(*args, **kwargs)


PURCHASE_REQUEST_CATEGORY_CHOICES = [
    ('إكسسوارات', 'إكسسوارات'),
    ('قماش', 'قماش'),
    ('خامات تغليف', 'خامات تغليف'),
    ('أخرى', 'أخرى'),
]
PURCHASE_REQUEST_CATEGORY_KEYS = [key for key, _label in PURCHASE_REQUEST_CATEGORY_CHOICES]

PURCHASE_REQUEST_STATUS_CHOICES = [
    ('pending', 'قيد الانتظار'),
    ('purchased', 'تم الشراء'),
]


class PurchaseRequest(models.Model):
    """طلبات الشراء المستقلة (Procurement / Purchase Requests) — بدون الحاجة لإنشاء صنف إكسسوار مسبقاً."""
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    item_name = models.CharField(max_length=255, verbose_name="اسم الصنف")
    # صورة اختيارية: إن لم تُرفع تبقى فارغة تماماً ولا يُستخدم أي بديل عشوائي.
    image = models.TextField(blank=True, null=True, default='', verbose_name="صورة الصنف")
    quantity = models.DecimalField(max_digits=12, decimal_places=3, default=Decimal('1'), verbose_name="الكمية")
    unit = models.CharField(max_length=50, default='قطعة', verbose_name="الوحدة")
    model = models.ForeignKey(
        'api.ModelItem',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_requests',
        verbose_name="الموديل المطلوب له",
    )
    model_code_text = models.CharField(max_length=150, blank=True, default='', verbose_name="كود الموديل (نص اختياري)")
    category = models.CharField(
        max_length=50,
        choices=PURCHASE_REQUEST_CATEGORY_CHOICES,
        blank=True,
        default='إكسسوارات',
        verbose_name="التصنيف",
    )
    notes = models.TextField(blank=True, default='', verbose_name="ملاحظات")
    status = models.CharField(
        max_length=20,
        choices=PURCHASE_REQUEST_STATUS_CHOICES,
        default='pending',
        db_index=True,
        verbose_name="الحالة",
    )

    # حقول ما بعد الشراء (تُملأ فقط عند التعليم كـ «تم الشراء»)
    purchased_price = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name="سعر الشراء",
    )
    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_requests',
        verbose_name="المورد",
    )
    supplier_name = models.CharField(max_length=200, blank=True, default='', verbose_name="اسم المورد")
    purchase_notes = models.TextField(blank=True, default='', verbose_name="ملاحظات الشراء")
    purchased_at = models.DateTimeField(null=True, blank=True, verbose_name="تاريخ الشراء")
    purchased_by = models.CharField(max_length=200, blank=True, default='', verbose_name="تم الشراء بواسطة")

    created_by = models.CharField(max_length=200, blank=True, default='', verbose_name="أنشأه")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at', '-id']

    def save(self, *args, **kwargs):
        if self.image:
            guard_image_field(self, 'image', 'صورة طلب الشراء')
        else:
            self.image = ''
        if not self.client_id:
            self.client_id = generate_client_id('pr')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.item_name} ({self.quantity} {self.unit})"


# Unified garment part keys used across cutting, QC and sewing.
# NOTE: 'shirt' is the canonical key for تيشرت (legacy code already uses it).
PART_TYPE_CHOICES = [
    ('shirt', 'تيشرت'),
    ('pants', 'بنطلون'),
    ('jacket', 'جاكيت'),
    ('single', 'قطعة واحدة / كامل'),
]

PART_TYPE_KEYS = [key for key, _label in PART_TYPE_CHOICES]

# Garment composition for a model: which parts the model is made of.
# Drives which parts (تيشرت / بنطلون / جاكيت) appear in Design, Cutting and QC.
GARMENT_COMPOSITION_CHOICES = [
    ('tshirt_only', 'تيشيرت فقط'),
    ('pants_only', 'بنطلون فقط'),
    ('two_pieces', 'قطعتان (تيشيرت + بنطلون)'),
    ('three_pieces', 'ثلاث قطع (تيشيرت + بنطلون + جاكيت)'),
]

GARMENT_COMPOSITION_KEYS = [key for key, _label in GARMENT_COMPOSITION_CHOICES]

DEFAULT_GARMENT_COMPOSITION = 'two_pieces'

# Central mapping: composition key -> ordered list of garment part keys.
COMPOSITION_TO_PARTS = {
    'tshirt_only': ['shirt'],
    'pants_only': ['pants'],
    'two_pieces': ['shirt', 'pants'],
    'three_pieces': ['shirt', 'pants', 'jacket'],
}

# ---------------------------------------------------------------------------
# Per-part production stages.
# Every garment part (تيشرت / بنطلون / جاكيت) moves independently through these
# stages. ModelItem.part_stages is the single source of truth for that:
#   {'shirt': 'ironing', 'pants': 'finishing'}
# The legacy ModelItem.status field remains as a coarse label derived from the
# *least advanced* part, so old screens keep working without blocking anything.
# ---------------------------------------------------------------------------
PART_STAGE_ORDER = [
    'cutting',
    'qc_before_print',
    'printing',
    'qc_after_print',
    'sewing',
    'qc_after_sewing',
    'finishing',
    'ironing',
    'packaging',
    'dest',
    'completed',
]

PART_STAGE_CHOICES = [
    ('cutting', 'القص'),
    ('qc_before_print', 'العد قبل الطباعة'),
    ('printing', 'المطابع'),
    ('qc_after_print', 'العد بعد الطباعة'),
    ('sewing', 'المكن'),
    ('qc_after_sewing', 'العد بعد المكن'),
    ('finishing', 'التشطيب'),
    ('ironing', 'المكواة'),
    ('packaging', 'التعبئة والتغليف'),
    ('dest', 'الدَست'),
    ('completed', 'مخزن الإنتاج التام'),
]

PART_STAGE_LABELS = dict(PART_STAGE_CHOICES)

# Coarse ModelItem.status per stage (used to keep legacy screens/filters alive).
PART_STAGE_TO_STATUS = {
    'cutting': 'في القص',
    'qc_before_print': 'العد قبل الطباعة',
    'printing': 'جاهز للطباعة / التجميع',
    'qc_after_print': 'العد بعد الطباعة',
    'sewing': 'في قسم المكن',
    'qc_after_sewing': 'العد بعد المكن',
    'finishing': 'في التشطيب',
    'ironing': 'في المكواة',
    'packaging': 'في التعبئة والتغليف',
    'dest': 'جاهز للدَست',
    'completed': 'مخزن الإنتاج التام',
}


