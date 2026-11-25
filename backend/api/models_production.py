from django.db import models
from django.contrib.auth.models import User
import uuid
from .storage_r2 import guard_image_field
from .models_auth import *
from .models_warehouse import *

class ModelItem(models.Model):
    STATUS_CHOICES = [
        ('مرحلة التصميم', 'مرحلة التصميم'),
        ('تصميم', 'تصميم'),
        ('في القص', 'في القص'),
        ('جاري القص', 'جاري القص'),
        ('العد قبل الطباعة', 'العد قبل الطباعة'),
        ('فرز قبل الطباعة', 'فرز قبل الطباعة'),
        ('فرز وكنترول', 'فرز وكنترول (قبل الطباعة)'),
        ('جاهز للطباعة / التجميع', 'جاهز للطباعة / التجميع'),
        ('جاهز للمطبعة', 'جاهز للمطبعة'),
        ('مرسل للمطبعة', 'مرسل للمطبعة'),
        ('في المطبعة', 'في المطبعة'),
        ('العد بعد الطباعة', 'العد بعد الطباعة'),
        ('في قسم المكن', 'في قسم المكن (الخياطة)'),
        ('العد بعد المكن', 'العد بعد المكن (الفحص النهائي)'),
        ('في التشطيب', 'في التشطيب'),
        ('في المكواة', 'في المكواة'),
        ('في التعبئة والتغليف', 'في التعبئة والتغليف'),
        ('جاهز للدَست', 'جاهز للدَست'),
        ('مخزن الإنتاج التام', 'مخزن الإنتاج التام'),
        ('مكتمل الإنتاج', 'مكتمل الإنتاج (مخزن الإنتاج)'),
    ]

    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    model_code = models.CharField(max_length=100, unique=True, verbose_name="كود الموديل")
    model_type = models.CharField(max_length=100, blank=True, null=True, verbose_name="نوع الموديل")
    status = models.CharField(max_length=50, choices=STATUS_CHOICES, default='مرحلة التصميم', db_index=True, verbose_name="الحالة")
    size_category_id = models.CharField(max_length=100, blank=True, null=True, verbose_name="فئة المقاسات")
    main_marker_url = models.CharField(max_length=255, blank=True, default='', verbose_name="الماركر الأساسي")
    print_marker_url = models.CharField(max_length=255, blank=True, default='', verbose_name="ماركر الطباعة")

    target_cut_quantity = models.IntegerField(default=0, verbose_name="العدد المستهدف للقص")
    total_cut_pieces = models.IntegerField(default=0, verbose_name="العدد المقصوص فعلياً")

    # --- Per-part tracking (تيشرت / بنطلون / جاكيت / قطعة واحدة) ---
    # Explicit list of garment parts this model is composed of, e.g. ["shirt", "pants"].
    # Left empty for legacy rows: services.get_model_parts() infers a safe default.
    garment_parts = models.JSONField(default=list, blank=True, verbose_name="قطع الموديل")
    # Model-level garment composition selected by the user; drives which parts appear.
    garment_composition = models.CharField(
        max_length=30,
        choices=GARMENT_COMPOSITION_CHOICES,
        default=DEFAULT_GARMENT_COMPOSITION,
        blank=True,
        verbose_name="تكوين قطع الموديل",
    )
    # Independent stage per garment part, e.g. {"shirt": "ironing", "pants": "finishing"}.
    # This is the single source of truth for the assembly / packaging section.
    part_stages = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="مراحل القطع المستقلة",
    )
    # Total cut pieces per part (aggregated from CuttingRecord.part_type)
    cut_shirt_pieces = models.IntegerField(default=0, blank=True, verbose_name="المقصوص تيشرت")
    cut_pants_pieces = models.IntegerField(default=0, blank=True, verbose_name="المقصوص بنطلون")
    cut_jacket_pieces = models.IntegerField(default=0, blank=True, verbose_name="المقصوص جاكيت")
    # Latest good counted quantity per part (aggregated from QCRecord.part_type)
    qc_shirt_pieces = models.IntegerField(default=0, blank=True, verbose_name="السليم تيشرت")
    qc_pants_pieces = models.IntegerField(default=0, blank=True, verbose_name="السليم بنطلون")
    qc_jacket_pieces = models.IntegerField(default=0, blank=True, verbose_name="السليم جاكيت")

    # Stage Counts
    count_before_print = models.IntegerField(default=0, blank=True, null=True, verbose_name="العد قبل الطباعة")
    count_after_print = models.IntegerField(default=0, blank=True, null=True, verbose_name="العد بعد الطباعة")
    count_after_sewing = models.IntegerField(default=0, blank=True, null=True, verbose_name="العد بعد المكن")

    cutter_name = models.CharField(max_length=150, blank=True, null=True, verbose_name="المقصدار")
    spreader_name = models.CharField(max_length=150, blank=True, null=True, verbose_name="الفراش")

    # Printing info
    print_house = models.CharField(max_length=150, blank=True, null=True, verbose_name="المطبعة")
    print_expected_date = models.DateField(blank=True, null=True, verbose_name="تاريخ الاستلام المتوقع من المطبعة")
    print_cost_per_piece = models.DecimalField(max_digits=10, decimal_places=2, default=0.0, verbose_name="تكلفة الطباعة للقطعة")

    # Sewing workshop info
    sewing_workshop = models.CharField(max_length=150, blank=True, null=True, verbose_name="اسم ورشة المكن / الخياطة")
    sewing_expected_date = models.DateField(blank=True, null=True, verbose_name="تاريخ الاستلام المتوقع من ورشة المكن")
    sewing_pieces_count = models.IntegerField(default=0, verbose_name="عدد القطع بورشة المكن")

    # Split Sewing independent tracking for Shirt & Pants
    sewing_shirt_workshop = models.CharField(max_length=150, blank=True, null=True, verbose_name="ورشة مكن التيشرت")
    sewing_shirt_expected_date = models.DateField(blank=True, null=True, verbose_name="تاريخ استلام التيشرت")
    sewing_shirt_status = models.CharField(max_length=50, default="ready", verbose_name="حالة خياطة التيشرت")
    sewing_shirt_pieces = models.IntegerField(default=0, verbose_name="عدد قطع التيشرت")

    sewing_pants_workshop = models.CharField(max_length=150, blank=True, null=True, verbose_name="ورشة مكن البنطلون")
    sewing_pants_expected_date = models.DateField(blank=True, null=True, verbose_name="تاريخ استلام البنطلون")
    sewing_pants_status = models.CharField(max_length=50, default="ready", verbose_name="حالة خياطة البنطلون")
    sewing_pants_pieces = models.IntegerField(default=0, verbose_name="عدد قطع البنطلون")

    # Design & Operating Notes
    design_notes = models.TextField(blank=True, null=True, default='', verbose_name="ملاحظات قسم التصميم")
    notes_shirt = models.TextField(blank=True, null=True, default='', verbose_name="ملاحظات تشغيل التيشرت")
    notes_pants = models.TextField(blank=True, null=True, default='', verbose_name="ملاحظات تشغيل البنطلون")
    notes_jacket = models.TextField(blank=True, null=True, default='', verbose_name="ملاحظات تشغيل الجاكيت")

    colored_at = models.CharField(max_length=100, blank=True, null=True, verbose_name="تاريخ التلوين")
    cut_at = models.CharField(max_length=100, blank=True, null=True, verbose_name="تاريخ القص")

    image = models.TextField(blank=True, null=True, verbose_name="صورة الموديل (رابط أو Base64)")
    is_deleted = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        guard_image_field(self, 'image', 'صورة الموديل')
        if not self.client_id:
            self.client_id = generate_client_id('mod')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.model_code} - {self.status}"


class ModelRequirement(models.Model):
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    model = models.ForeignKey(ModelItem, on_delete=models.CASCADE, related_name="requirements", verbose_name="الموديل")
    color = models.ForeignKey(FabricColor, on_delete=models.CASCADE, related_name="requirements", verbose_name="اللون")
    part_name = models.CharField(max_length=150, verbose_name="اسم القطعة / الجزء")
    planned_quantity = models.FloatField(default=0.0, verbose_name="الكمية المخططة")
    # سعر الوحدة التاريخي وقت ربط المتطلب بالموديل (لحساب التكلفة الفعلية لاحقاً).
    unit_price_snapshot = models.DecimalField(max_digits=12, decimal_places=2, default=0.0, verbose_name="سعر الوحدة وقت العملية")

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('req')
        super().save(*args, **kwargs)


class ModelAccessory(models.Model):
    TARGET_TYPES = [
        ('shirt', 'تيشرت'),
        ('pants', 'بنطلون'),
        ('jacket', 'جاكيت'),
        ('single', 'قطعة واحدة'),
    ]
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    model = models.ForeignKey(ModelItem, on_delete=models.CASCADE, related_name="accessories")
    accessory_id_ref = models.CharField(max_length=100, blank=True, null=True, verbose_name="معرف الإكسسوار بالمخزن")
    accessory_code = models.CharField(max_length=100, blank=True, null=True, verbose_name="كود الإكسسوار")
    accessory_name = models.CharField(max_length=200, verbose_name="اسم الإكسسوار")
    target_type = models.CharField(max_length=20, choices=TARGET_TYPES, default='shirt', verbose_name="القسم المستهدف")
    piece_consumption = models.FloatField(default=1.0, verbose_name="استهلاك القطعة الواحدة")
    planned_quantity = models.FloatField(default=0.0, verbose_name="الكمية المخططة")
    unit = models.CharField(max_length=50, default="قطعة", verbose_name="الوحدة")
    image = models.TextField(blank=True, null=True, verbose_name="صورة الإكسسوار")
    # سعر الوحدة التاريخي وقت الصرف للموديل (لحساب التكلفة الفعلية لاحقاً).
    unit_price_snapshot = models.DecimalField(max_digits=12, decimal_places=2, default=0.0, verbose_name="سعر الوحدة وقت العملية")
    # دورة صرف الإكسسوار: يبقى محجوزاً حتى يؤكّد أمين مخزن الإكسسوارات الصرف الفعلي.
    is_issued = models.BooleanField(default=False, verbose_name="تم صرف الإكسسوار فعلياً")
    issued_quantity = models.FloatField(default=0.0, verbose_name="الكمية المصروفة فعلياً")
    issued_to = models.CharField(max_length=150, blank=True, default='', verbose_name="اسم المستلم")
    issued_at = models.CharField(max_length=100, blank=True, default='', verbose_name="تاريخ ووقت الصرف")
    issued_by = models.CharField(max_length=150, blank=True, default='', verbose_name="أمين المخزن المنفذ للصرف")

    def save(self, *args, **kwargs):
        guard_image_field(self, 'image', 'صورة الإكسسوار')
        if not self.client_id:
            self.client_id = generate_client_id('macc')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.accessory_name} ({self.get_target_type_display()}) for {self.model.model_code}"


class ModelTimeline(models.Model):
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    model = models.ForeignKey(ModelItem, on_delete=models.CASCADE, related_name="timeline")
    stage = models.CharField(max_length=100, verbose_name="المرحلة")
    title = models.CharField(max_length=200, blank=True, null=True, verbose_name="العنوان")
    timestamp = models.DateTimeField(auto_now_add=True, verbose_name="التاريخ والوقت")
    timestamp_str = models.CharField(max_length=100, blank=True, null=True, verbose_name="التوقيت النصي")
    notes = models.TextField(blank=True, null=True, verbose_name="تفاصيل وملاحظات")
    user = models.CharField(max_length=150, blank=True, null=True, verbose_name="المستخدم المسؤول")
    details = models.JSONField(default=dict, blank=True, verbose_name="بيانات المرحلة التفصيلية وقت الحدث")

    class Meta:
        ordering = ['-timestamp', '-id']

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('tl')
        super().save(*args, **kwargs)


class CuttingRecord(models.Model):
    """
    Cutting Spread / Lay (فرشة قص):
    Records a complete spread with:
    - spreader_name: اسم الشخص الذي قام بالفرش (الفراش)
    - cutter_name: اسم المقصدار / القاصص للفرشة بالكامل
    - color_layers (related CuttingSpreadLayer): الألوان وعدد الراقات داخل هذه الفرشة
    """
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    model = models.ForeignKey(ModelItem, on_delete=models.CASCADE, related_name="cutting_records", verbose_name="الموديل")
    spread_number = models.IntegerField(default=1, verbose_name="رقم الفرشة")
    part_type = models.CharField(max_length=20, choices=PART_TYPE_CHOICES, default='shirt', verbose_name="نوع القطعة")
    # فرشة "قصة / جزء فرعي" (مثل قصة الأورنج أو الكم): تُستهلك قماشها وتُحسب أوزانها،
    # لكنها لا تُجمع على عدد القطع المقصوصة للقطعة الأساسية.
    is_sub_cut = models.BooleanField(default=False, verbose_name="قصة / جزء فرعي (لا تُجمع على عدد القطع)")
    sub_cut_label = models.CharField(max_length=150, blank=True, default='', verbose_name="اسم القصة / الجزء الفرعي")
    spreader_name = models.CharField(max_length=150, blank=True, default='', verbose_name="اسم الفَرّاش (من قام بالفرش)")
    cutter_name = models.CharField(max_length=150, verbose_name="اسم المقصدار / القاصص")
    fabric_color = models.CharField(max_length=255, blank=True, default='', verbose_name="ملخص ألوان الفرشة")
    pieces_per_layer = models.IntegerField(default=0, verbose_name="عدد القطع في الراق")
    pieces_count = models.IntegerField(default=0, verbose_name="عدد القطع المقصوصة (الراقات × قطع الراق)")
    layers_count = models.IntegerField(default=0, verbose_name="إجمالي عدد الراقات بالفرشة")
    layer_weight = models.FloatField(default=0.0, verbose_name="إجمالي وزن الراق (كجم)")
    shade_degree = models.CharField(max_length=100, blank=True, null=True, default='', verbose_name="درجة الصبغة")
    notes = models.TextField(blank=True, null=True, default='', verbose_name="ملاحظات الفرشة والقص")
    created_at_str = models.CharField(max_length=100, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('cut')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"فرشة #{self.spread_number} - {self.model.model_code} (فرش: {self.spreader_name} | قص: {self.cutter_name})"


class CuttingSpreadLayer(models.Model):
    """
    Individual color and layers entry inside a Cutting Spread (CuttingRecord).
    For example: 50 layers Red, 40 layers Green inside the same spread.
    """
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    spread = models.ForeignKey(CuttingRecord, on_delete=models.CASCADE, related_name="color_layers", verbose_name="الفرشة")
    color_name = models.CharField(max_length=150, verbose_name="اللون / القطعة")
    layers_count = models.IntegerField(default=0, verbose_name="عدد الراقات")
    layer_weight = models.FloatField(default=0.0, blank=True, verbose_name="الوزن (كجم)")
    pieces_count = models.IntegerField(default=0, blank=True, verbose_name="القطع الناتجة")
    shade_degree = models.CharField(max_length=100, blank=True, default='', verbose_name="درجة الصبغة")
    notes = models.TextField(blank=True, default='', verbose_name="ملاحظات اللون")

    class Meta:
        ordering = ['id']

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('lay')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.color_name}: {self.layers_count} راق"


class QCRecord(models.Model):
    """
    Quality Control & Sorting Record per (Model + Stage + Color + Size) Matrix cell.
    Stores counted_pieces (good_qty) and defect_pieces (defect_qty) for each intersection
    of Color and Size across all three stages: before_print, after_print, after_sewing.
    """
    STAGE_TYPES = [
        ('before_print', 'العد قبل الطباعة'),
        ('after_print', 'العد بعد الطباعة'),
        ('after_sewing', 'العد بعد المكن'),
    ]
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    model = models.ForeignKey(ModelItem, on_delete=models.CASCADE, related_name="qc_records")
    stage = models.CharField(max_length=30, choices=STAGE_TYPES, default='before_print', verbose_name="مرحلة العد والفرز")
    part_type = models.CharField(max_length=20, choices=PART_TYPE_CHOICES, default='shirt', verbose_name="نوع القطعة")
    color_name = models.CharField(max_length=150, blank=True, default='', verbose_name="اللون")
    size = models.CharField(max_length=50, blank=True, default='', verbose_name="المقاس")
    pieces_cut = models.IntegerField(default=0, verbose_name="القطع المقصوصة")
    counted_pieces = models.IntegerField(default=0, verbose_name="العدد الفعلي السليم")
    defect_pieces = models.IntegerField(default=0, verbose_name="عدد الهوالك والعيوب")
    notes = models.TextField(blank=True, null=True, verbose_name="ملاحظات الجودة")
    checked_by = models.CharField(max_length=150, verbose_name="مسؤول الفرز")
    created_at_str = models.CharField(max_length=100, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']
        constraints = [
            models.UniqueConstraint(
                fields=['model', 'stage', 'part_type', 'color_name', 'size'],
                name='uniq_qc_record_cell',
            ),
        ]

    def save(self, *args, **kwargs):
        if self.color_name is None:
            self.color_name = ''
        if self.size is None:
            self.size = ''
        if not self.client_id:
            self.client_id = generate_client_id('qc')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.model.model_code} [{self.stage}] - {self.color_name} / {self.size} (سليم: {self.counted_pieces}, تالف: {self.defect_pieces})"


class PrintDispatch(models.Model):
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    model = models.ForeignKey(ModelItem, on_delete=models.CASCADE, related_name="dispatches")
    print_house = models.CharField(max_length=200, verbose_name="اسم المطبعة")
    # الربط الاختياري بسجل الورشة المسجل (يُبقى الاسم النصي أعلاه كما هو للتوافقية).
    workshop = models.ForeignKey(Workshop, on_delete=models.SET_NULL, null=True, blank=True, related_name="+", verbose_name="الورشة المسجلة")
    # نوع القطعة المرسلة للمطبعة (تيشرت / بنطلون / جاكيت / قطعة واحدة) لمطابقة تقسيم الموديل
    piece_type = models.CharField(max_length=20, choices=PART_TYPE_CHOICES, default='shirt', verbose_name="نوع القطعة")
    piece_label = models.CharField(max_length=50, blank=True, null=True, verbose_name="مسمى القطعة")
    pieces_count = models.IntegerField(default=0, verbose_name="عدد القطع المرسلة")
    # الاستلام الجزئي على دفعات: الكمية المستلمة فعلياً وسجل كل دفعة.
    received_pieces = models.IntegerField(default=0, verbose_name="عدد القطع المستلمة فعلياً")
    receive_history = models.JSONField(default=list, blank=True, verbose_name="سجل دفعات الاستلام")
    print_type = models.CharField(max_length=100, default="سلك سكرين مائي", verbose_name="نوع الطباعة")
    print_location = models.CharField(max_length=200, blank=True, default='', verbose_name="مكان الطباعة (صدر / ظهر / كم / تطريز)")
    print_details = models.TextField(blank=True, null=True, verbose_name="تفاصيل الطباعة")
    cost_per_piece = models.DecimalField(max_digits=10, decimal_places=2, default=0.0, verbose_name="سعر الطباعة للقطعة")
    dispatch_date = models.DateField(auto_now_add=True, verbose_name="تاريخ الإرسال")
    dispatched_at_str = models.CharField(max_length=100, blank=True, null=True)
    expected_delivery_date = models.DateField(blank=True, null=True, verbose_name="تاريخ الاستلام المتوقع")
    status = models.CharField(max_length=50, default="مرسل للمطبعة", verbose_name="الحالة")
    received_date = models.DateField(blank=True, null=True, verbose_name="تاريخ الاستلام")
    received_at_str = models.CharField(max_length=100, blank=True, null=True)
    notes = models.TextField(blank=True, null=True, verbose_name="ملاحظات التشغيل")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']

    @property
    def is_overdue(self):
        if self.status not in ('تم الاستلام', 'تم الاستلام بالمصنع') and self.expected_delivery_date:
            return self.expected_delivery_date < date.today()
        return False

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('disp')
        super().save(*args, **kwargs)


class SewingDispatch(models.Model):
    PIECE_CHOICES = [
        ('shirt', 'تيشرت'),
        ('pants', 'بنطلون'),
        ('jacket', 'جاكيت'),
        ('single', 'قطعة واحدة / كامل'),
    ]
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    model = models.ForeignKey(ModelItem, on_delete=models.CASCADE, related_name="sewing_dispatches")
    piece_type = models.CharField(max_length=20, choices=PIECE_CHOICES, default='shirt', verbose_name="نوع القطعة")
    piece_label = models.CharField(max_length=50, blank=True, null=True, verbose_name="مسمى القطعة")
    workshop_name = models.CharField(max_length=200, verbose_name="اسم ورشة المكن / الخياطة")
    # الربط الاختياري بسجل الورشة المسجل (يُبقى الاسم النصي أعلاه كما هو للتوافقية).
    workshop = models.ForeignKey(Workshop, on_delete=models.SET_NULL, null=True, blank=True, related_name="+", verbose_name="الورشة المسجلة")
    pieces_count = models.IntegerField(default=0, verbose_name="القطع المسلمة للورشة")
    # الاستلام الجزئي على دفعات: الكمية المستلمة فعلياً وسجل كل دفعة.
    received_pieces = models.IntegerField(default=0, verbose_name="عدد القطع المستلمة فعلياً")
    receive_history = models.JSONField(default=list, blank=True, verbose_name="سجل دفعات الاستلام")
    dispatched_date = models.DateField(auto_now_add=True, verbose_name="تاريخ الخروج للورشة")
    dispatched_at_str = models.CharField(max_length=100, blank=True, null=True)
    expected_delivery_date = models.DateField(verbose_name="تاريخ الاستلام المتوقع")
    status = models.CharField(max_length=50, default="في ورشة المكن", verbose_name="الحالة")
    received_date = models.DateField(blank=True, null=True, verbose_name="تاريخ الاستلام الفعلي")
    received_at_str = models.CharField(max_length=100, blank=True, null=True)
    notes = models.TextField(blank=True, null=True, verbose_name="ملاحظات التشغيل")
    # سعر تشغيل القطعة في ورشة المكن (بيانات مالية محمية بصلاحية مستقلة).
    cost_per_piece = models.DecimalField(
        max_digits=12, decimal_places=2, default=0.0, verbose_name="سعر تشغيل القطعة"
    )
    total_cost = models.DecimalField(
        max_digits=14, decimal_places=2, default=0.0, verbose_name="إجمالي تكلفة التشغيل"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']

    @property
    def is_overdue(self):
        if self.status != 'تم الاستلام' and self.expected_delivery_date:
            return self.expected_delivery_date < date.today()
        return False

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('sew-disp')
        super().save(*args, **kwargs)

    def __str__(self):
        label = self.piece_label or self.get_piece_type_display()
        return f"خياطة {self.model.model_code} [{label}] - ورشة {self.workshop_name}"


class AppNotification(models.Model):
    URGENCY_CHOICES = [
        ('critical', 'حرج'),
        ('overdue', 'متأخر عن موعد الاستلام'),
        ('today', 'موعد الاستلام اليوم'),
        ('tomorrow', 'موعد الاستلام غداً'),
    ]
    STAGE_CHOICES = [
        ('printing', 'المطابع والتطريز'),
        ('sewing', 'ورش المكن والخياطة'),
        ('finishing', 'قسم التشطيب'),
        ('ironing', 'قسم المكواة'),
        ('packaging', 'قسم التعبئة والتغليف'),
        ('dest', 'قسم الدَست'),
        ('materials', 'خامات التشغيل'),
    ]

    user = models.ForeignKey(
        UserProfile, on_delete=models.CASCADE, null=True, blank=True,
        related_name="app_notifications", verbose_name="المستخدم",
    )
    notification_key = models.CharField(
        max_length=255, blank=True, default='', db_index=True, verbose_name="مفتاح التنبيه",
    )
    title = models.CharField(max_length=255, blank=True, default='', verbose_name="عنوان التنبيه")
    message = models.TextField(blank=True, default='', verbose_name="نص الإشعار")
    urgency = models.CharField(max_length=20, choices=URGENCY_CHOICES, default='today', verbose_name="مستوى الأهمية")
    stage = models.CharField(max_length=20, choices=STAGE_CHOICES, default='printing', verbose_name="المرحلة")
    model = models.ForeignKey(ModelItem, on_delete=models.CASCADE, null=True, blank=True, related_name="notifications")
    target_name = models.CharField(max_length=200, blank=True, default='', verbose_name="اسم الجهة (المطبعة أو الورشة)")
    expected_date = models.DateField(blank=True, null=True, verbose_name="تاريخ الاستلام المتوقع")
    is_read = models.BooleanField(default=False, verbose_name="تمت القراءة")
    snoozed_until = models.DateTimeField(blank=True, null=True, verbose_name="مؤجل حتى")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-urgency', 'expected_date']
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'notification_key'],
                condition=models.Q(user__isnull=False) & ~models.Q(notification_key=''),
                name='uniq_app_notification_user_key',
            ),
        ]

    def __str__(self):
        code = self.model.model_code if self.model else self.notification_key
        return f"[{self.urgency}] {self.title or self.notification_key} - {code}"


class InternalMessage(models.Model):
    """
    Internal direct messaging system between system users.
    Controlled by can_send_messages permission.
    """
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    sender = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name="sent_messages", verbose_name="المرسل")
    receiver = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name="received_messages", verbose_name="المستلم")
    content = models.TextField(verbose_name="نص الرسالة")
    is_read = models.BooleanField(default=False, verbose_name="مقروءة")
    created_at_str = models.CharField(max_length=100, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="تاريخ ووقت الإرسال")

    class Meta:
        ordering = ['created_at', 'id']

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('msg')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"من {self.sender.real_name} إلى {self.receiver.real_name}: {self.content[:30]}"


class AuditLog(models.Model):
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    user_id_ref = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="معرف المستخدم")
    user_name = models.CharField(max_length=200, db_index=True, verbose_name="اسم المستخدم")
    user_full_name = models.CharField(max_length=200, blank=True, default='', verbose_name="الاسم الكامل للمستخدم")
    section = models.CharField(max_length=120, blank=True, default='', db_index=True, verbose_name="القسم")
    action_type = models.CharField(max_length=40, blank=True, default='', db_index=True, verbose_name="نوع الإجراء")
    action = models.CharField(max_length=150, verbose_name="الإجراء")
    target_name = models.CharField(max_length=255, blank=True, default='', verbose_name="العنصر المتأثر")
    details = models.TextField(verbose_name="التفاصيل")
    changes = models.JSONField(default=list, blank=True, verbose_name="التغييرات التفصيلية")
    ip_address = models.CharField(max_length=60, default='127.0.0.1', verbose_name="عنوان IP")
    timestamp = models.CharField(max_length=100, blank=True, default='', verbose_name="التاريخ والوقت")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [
            models.Index(fields=['section', 'action_type'], name='audit_section_action_idx'),
            models.Index(fields=['timestamp'], name='audit_timestamp_idx'),
        ]

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('log')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"[{self.action}] {self.user_name}: {self.details[:40]}"


# ---------------------------------------------------------------------------
# Assembly & Packaging (الأسمبلي والأمبالاج)
# ---------------------------------------------------------------------------
# Post-sewing life cycle (no piece counts required):
#   packaging requirements (photo + printed cards) → finishing → ironing
#   → packaging → dest (final packing/labeling), then production warehouse.
# ---------------------------------------------------------------------------

PACKAGING_STEP_CHOICES = [
    ('sent_to_photo', 'إرسال عينة للتصوير'),
    ('received_from_photo', 'استلام الصور من المصور'),
    ('sent_to_print_cards', 'إرسال الصور للمطبعة'),
    ('received_printed_cards', 'استلام الورق المطبوع من المطبعة'),
]

PACKAGING_STEP_ORDER = [key for key, _label in PACKAGING_STEP_CHOICES]

PACKAGING_STEP_LABELS = dict(PACKAGING_STEP_CHOICES)

ASSEMBLY_STAGE_CHOICES = [
    ('ironing', 'قسم المكواة'),
    ('packaging', 'قسم التعبئة والتغليف'),
    ('dest', 'قسم الدَست'),
]

ASSEMBLY_STAGE_KEYS = [key for key, _label in ASSEMBLY_STAGE_CHOICES]

ASSEMBLY_STAGE_LABELS = dict(ASSEMBLY_STAGE_CHOICES)


class PackagingRequirement(models.Model):
    """
    متطلبات الأمبالاج (الأكياس/الكروت) لموديل واحد:
    إرسال عينة للتصوير → استلام الصور → إرسال الصور للمطبعة → استلام الورق المطبوع.
    على مستوى الموديل بالكامل (لا يوجد تقسيم حسب القطع ولا أعداد قطع).
    """
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    model = models.OneToOneField(
        ModelItem, on_delete=models.CASCADE, related_name='packaging_requirement', verbose_name="الموديل"
    )
    sent_to_photo_date = models.DateField(blank=True, null=True, verbose_name="تاريخ إرسال العينة للتصوير")
    received_from_photo_date = models.DateField(blank=True, null=True, verbose_name="تاريخ استلام الصور من المصور")
    sent_to_print_cards_date = models.DateField(blank=True, null=True, verbose_name="تاريخ إرسال الصور للمطبعة")
    received_printed_cards_date = models.DateField(blank=True, null=True, verbose_name="تاريخ استلام الورق المطبوع")
    photography_sent_qty = models.IntegerField(default=0, verbose_name="عدد قطع العينة المرسلة للتصوير")
    photography_received_qty = models.IntegerField(default=0, verbose_name="عدد قطع العينة المستلمة من التصوير")
    notes = models.TextField(blank=True, null=True, verbose_name="ملاحظات الأمبالاج")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at', '-id']

    @property
    def missing_steps(self) -> list:
        """Arabic labels of the packaging steps that are still missing, in order."""
        missing = []
        for key in PACKAGING_STEP_ORDER:
            if not getattr(self, f"{key}_date", None):
                missing.append(PACKAGING_STEP_LABELS[key])
        return missing

    @property
    def is_complete(self) -> bool:
        return len(self.missing_steps) == 0

    @property
    def photography_outstanding_qty(self) -> int:
        """القطع التي ما زالت في التصوير (مرسلة ولم تُستلم) - خصم مؤقت."""
        return max(0, int(self.photography_sent_qty or 0) - int(self.photography_received_qty or 0))

    @property
    def photography_shortage(self) -> int:
        """
        عجز في قطع العينة: يُحتسب فقط بعد استلام الصور من المصور ومع ذلك
        ما زالت هناك قطع مرسلة ولم تُستلم (لم تُرجع للخط الإنتاجي).
        """
        if not self.received_from_photo_date:
            return 0
        return self.photography_outstanding_qty

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('pack-req')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"متطلبات أمبالاج {self.model.model_code} - {'مكتملة' if self.is_complete else 'غير مكتملة'}"


class FinishingRecord(models.Model):
    """
    قسم التشطيب (Finishing) — يسجل دخول وخروج كل قطعة من قطع الموديل
    (تيشرت / بنطلون / جاكيت) بدون أعداد قطع، بنفس نمط SewingDispatch.
    """
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    model = models.ForeignKey(
        ModelItem, on_delete=models.CASCADE, related_name='finishing_records', verbose_name="الموديل"
    )
    part_type = models.CharField(max_length=20, choices=PART_TYPE_CHOICES, default='shirt', verbose_name="نوع القطعة")
    piece_label = models.CharField(max_length=50, blank=True, null=True, verbose_name="مسمى القطعة")
    vendor_name = models.CharField(max_length=150, blank=True, default='', verbose_name="الجهة / ورشة التشطيب")
    # الربط الاختياري بسجل الورشة المسجل (يُبقى الاسم النصي أعلاه كما هو للتوافقية).
    workshop = models.ForeignKey(Workshop, on_delete=models.SET_NULL, null=True, blank=True, related_name="+", verbose_name="الورشة المسجلة")
    entry_date = models.DateField(blank=True, null=True, verbose_name="تاريخ دخول التشطيب")
    expected_exit_date = models.DateField(blank=True, null=True, verbose_name="تاريخ الخروج المتوقع")
    actual_exit_date = models.DateField(blank=True, null=True, verbose_name="تاريخ الاستلام الفعلي")
    notes = models.TextField(blank=True, null=True, verbose_name="ملاحظات التشطيب")
    # سعر تشطيب القطعة (بيانات مالية محمية بصلاحية مستقلة).
    cost_per_piece = models.DecimalField(
        max_digits=12, decimal_places=2, default=0.0, verbose_name="سعر تشطيب القطعة"
    )
    total_cost = models.DecimalField(
        max_digits=14, decimal_places=2, default=0.0, verbose_name="إجمالي تكلفة التشطيب"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at', '-id']
        unique_together = ('model', 'part_type')

    @property
    def is_received(self) -> bool:
        return bool(self.actual_exit_date)

    @property
    def is_overdue(self) -> bool:
        if not self.actual_exit_date and self.expected_exit_date:
            return self.expected_exit_date < date.today()
        return False

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('finish')
        if not self.piece_label:
            self.piece_label = dict(PART_TYPE_CHOICES).get(self.part_type, '')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"تشطيب {self.model.model_code} [{self.piece_label or self.part_type}]"



class AssemblyStageRecord(models.Model):
    """
    مراحل الأسمبلي والتعبئة على مستوى الموديل بالكامل:
    المكواة (ironing) → التعبئة والتغليف (packaging) → الدَست (dest).
    كل مرحلة لها تاريخ دخول وتاريخ خروج متوقع وتاريخ خروج فعلي + ملاحظات.
    """
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    model = models.ForeignKey(
        ModelItem, on_delete=models.CASCADE, related_name='assembly_stage_records', verbose_name="الموديل"
    )
    stage = models.CharField(max_length=20, choices=ASSEMBLY_STAGE_CHOICES, verbose_name="المرحلة")
    # For the ironing stage the record is per garment part (shirt / pants / jacket).
    # Packaging and dest stay model-level, so part_type is left as ''.
    part_type = models.CharField(max_length=20, blank=True, default='', verbose_name="نوع القطعة (للمكواة)")
    vendor_name = models.CharField(max_length=150, blank=True, default='', verbose_name="الجهة / الورشة")
    # الربط الاختياري بسجل الورشة المسجل (يُبقى الاسم النصي أعلاه كما هو للتوافقية).
    workshop = models.ForeignKey(Workshop, on_delete=models.SET_NULL, null=True, blank=True, related_name="+", verbose_name="الورشة المسجلة")
    entry_date = models.DateField(blank=True, null=True, verbose_name="تاريخ الدخول")
    expected_exit_date = models.DateField(blank=True, null=True, verbose_name="تاريخ الخروج المتوقع")
    actual_exit_date = models.DateField(blank=True, null=True, verbose_name="تاريخ الخروج الفعلي")
    notes = models.TextField(blank=True, null=True, verbose_name="ملاحظات المرحلة")
    # سعر المرحلة/القطعة (بيانات مالية محمية بصلاحية مستقلة).
    cost_per_piece = models.DecimalField(
        max_digits=12, decimal_places=2, default=0.0, verbose_name="سعر القطعة في المرحلة"
    )
    total_cost = models.DecimalField(
        max_digits=14, decimal_places=2, default=0.0, verbose_name="إجمالي تكلفة المرحلة"
    )
    # تتبع الخصم التلقائي لخامات التعبئة والتغليف (لمنع الخصم المزدوج عند التعديل).
    materials_deducted = models.BooleanField(
        default=False, verbose_name="تم خصم خامات التغليف تلقائياً"
    )
    materials_deducted_details = models.JSONField(
        default=list, blank=True, verbose_name="تفاصيل خامات التغليف المخصومة"
    )
    # مرحلة الدَست: العدد المتوقع للموديل مقابل المنفذ فعلياً وحساب العجز تلقائياً.
    expected_pieces = models.IntegerField(
        default=0, verbose_name="العدد الفعلي المتوقع للموديل"
    )
    completed_pieces = models.IntegerField(
        blank=True, null=True, verbose_name="العدد المنفذ فعلياً"
    )
    shortage_pieces = models.IntegerField(
        default=0, verbose_name="العجز"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at', '-id']
        unique_together = ('model', 'stage', 'part_type')

    @property
    def stage_label(self) -> str:
        label = ASSEMBLY_STAGE_LABELS.get(self.stage, self.stage)
        if self.stage == 'ironing' and self.part_type:
            return f"{label} - {dict(PART_TYPE_CHOICES).get(self.part_type, self.part_type)}"
        return label

    @property
    def is_completed(self) -> bool:
        return bool(self.actual_exit_date)

    @property
    def is_overdue(self) -> bool:
        if not self.actual_exit_date and self.expected_exit_date:
            return self.expected_exit_date < date.today()
        return False

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('asm-stage')
        if self.stage == 'dest' and self.completed_pieces is not None:
            self.shortage_pieces = max(0, int(self.expected_pieces or 0) - int(self.completed_pieces))
        elif self.stage != 'dest':
            self.shortage_pieces = 0
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.stage_label} - {self.model.model_code}"


WORKSHOP_EVALUATION_STAGE_CHOICES = [
    ('printing', 'مطابع وتطريز'),
    ('sewing', 'مكن وخياطة'),
    ('finishing', 'تشطيب'),
]
WORKSHOP_EVALUATION_STAGE_KEYS = [key for key, _label in WORKSHOP_EVALUATION_STAGE_CHOICES]
WORKSHOP_EVALUATION_STAGE_LABELS = dict(WORKSHOP_EVALUATION_STAGE_CHOICES)


class WorkshopEvaluation(models.Model):
    """
    تقييم أداء الورش والمطابع (1–5 نجوم) على ثلاثة معايير:
    ميعاد التسليم، جودة الشغل، وجودة التشطيب، مع ربطه بالموديل والورشة والإرسالية.
    """
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    workshop = models.ForeignKey(
        Workshop, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='evaluations', verbose_name="الورشة المسجلة"
    )
    workshop_name = models.CharField(max_length=200, db_index=True, verbose_name="اسم الورشة / المطبعة")
    stage = models.CharField(
        max_length=20, choices=WORKSHOP_EVALUATION_STAGE_CHOICES, default='sewing',
        db_index=True, verbose_name="فئة الورشة"
    )
    model = models.ForeignKey(
        ModelItem, on_delete=models.CASCADE, related_name='workshop_evaluations', verbose_name="الموديل"
    )
    print_dispatch = models.ForeignKey(
        PrintDispatch, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='evaluations', verbose_name="إرسالية المطبعة"
    )
    sewing_dispatch = models.ForeignKey(
        SewingDispatch, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='evaluations', verbose_name="إرسالية المكن"
    )
    finishing_record = models.ForeignKey(
        FinishingRecord, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='evaluations', verbose_name="سجل التشطيب"
    )
    delivery_timeliness = models.PositiveSmallIntegerField(default=5, verbose_name="ميعاد التسليم")
    work_quality = models.PositiveSmallIntegerField(default=5, verbose_name="جودة الشغل")
    finishing_quality = models.PositiveSmallIntegerField(default=5, verbose_name="جودة التشطيب")
    notes = models.TextField(blank=True, default='', verbose_name="ملاحظات التقييم")
    evaluated_by = models.CharField(max_length=150, blank=True, default='', verbose_name="المُقيِّم")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at', '-id']
        verbose_name = "تقييم ورشة"
        verbose_name_plural = "تقييمات الورش"

    @property
    def overall_score(self) -> float:
        return round(
            (int(self.delivery_timeliness or 0) + int(self.work_quality or 0) + int(self.finishing_quality or 0)) / 3.0,
            2,
        )

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('weval')
        self.delivery_timeliness = max(1, min(5, int(self.delivery_timeliness or 5)))
        self.work_quality = max(1, min(5, int(self.work_quality or 5)))
        self.finishing_quality = max(1, min(5, int(self.finishing_quality or 5)))
        super().save(*args, **kwargs)

    def __str__(self):
        return f"تقييم {self.workshop_name} ({self.model.model_code}) - {self.overall_score}/5"


# ---------------------------------------------------------------------------
# Packaging & Operating Materials MRP (خامات التشغيل والأمبالاج)
# فئات ديناميكية: يمكن إضافة أي فئة جديدة أو حذفها من الواجهة.
# الخمس فئات التالية تُزرع كبيانات أولية افتراضية فقط، ولكل فئة قاعدة استهلاك
# لكل قطعة ومقاسات ومورد وحد تنبيه ورصيد.
# ---------------------------------------------------------------------------
PACKAGING_MATERIAL_CHOICES = [
    ('bags', 'أكياس البلاستيك'),
    ('cartons', 'الكرتون'),
    ('hangers', 'الشماعات'),
    ('newborn_bags', 'أكياس حديثي الولادة'),
    ('dozen_bags', 'أكياس الدست'),
]

PACKAGING_MATERIAL_KEYS = [key for key, _label in PACKAGING_MATERIAL_CHOICES]

PACKAGING_MATERIAL_LABELS = dict(PACKAGING_MATERIAL_CHOICES)

PACKAGING_MATERIAL_EMOJI = {
    'bags': '🛍️',
    'cartons': '📦',
    'hangers': '🧷',
    'newborn_bags': '👶',
    'dozen_bags': '🎁',
}

# وحدات القياس المتاحة لخامات التشغيل.
PACKAGING_MATERIAL_UNIT_CHOICES = [
    ('قطعة', 'قطعة'),
    ('كيلو', 'كيلو'),
    ('دستة', 'دستة'),
    ('متر', 'متر'),
]

PACKAGING_MATERIAL_UNIT_KEYS = [key for key, _label in PACKAGING_MATERIAL_UNIT_CHOICES]

# نمط القاعدة: ثابتة (صف واحد يطبق على كل المقاسات) أو متغيرة حسب كل مقاس.
PACKAGING_MATERIAL_RULE_MODE_CHOICES = [
    ('fixed', 'ثابتة لكل المقاسات المختارة'),
    ('variable', 'متغيرة حسب المقاس'),
]

PACKAGING_MATERIAL_RULE_MODE_KEYS = [key for key, _label in PACKAGING_MATERIAL_RULE_MODE_CHOICES]

# أنواع حركة مخزون خامات التشغيل.
PACKAGING_MATERIAL_TRANSACTION_CHOICES = [
    ('add', 'وارد جديد'),
    ('deduct', 'منصرف'),
    ('adjust', 'تعديل الرصيد'),
]


class PackagingMaterialRule(models.Model):
    """
    قاعدة خامة تشغيل واحدة (أكياس / كرتون / شماعات / ...).
    توجد خمس قواعد ثابتة تُزرع تلقائياً، ويُحفظ فيها الوحدة وفئات المقاسات ونمط القاعدة.
    تفاصيل كل مقاس تُحفظ في PackagingMaterialSizeRule.
    """
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    material_key = models.CharField(
        max_length=60, unique=True, verbose_name="نوع الخامة"
    )
    name = models.CharField(max_length=200, blank=True, default='', verbose_name="اسم الخامة")
    icon = models.CharField(max_length=20, blank=True, default='', verbose_name="أيقونة الخامة")
    unit = models.CharField(
        max_length=30, choices=PACKAGING_MATERIAL_UNIT_CHOICES, default='قطعة', verbose_name="وحدة القياس"
    )
    rule_mode = models.CharField(
        max_length=20, choices=PACKAGING_MATERIAL_RULE_MODE_CHOICES, default='fixed', verbose_name="نمط القاعدة"
    )
    applicable_size_groups = models.JSONField(default=list, blank=True, verbose_name="فئات المقاسات المستهدفة")
    is_active = models.BooleanField(default=True, verbose_name="مفعّلة")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['id']
        verbose_name = "قاعدة خامة تشغيل"
        verbose_name_plural = "قواعد خامات التشغيل"

    @property
    def label(self) -> str:
        return self.name or PACKAGING_MATERIAL_LABELS.get(self.material_key, self.material_key)

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('pack-mat')
        if not self.name:
            self.name = PACKAGING_MATERIAL_LABELS.get(self.material_key, self.material_key)
        if not self.icon:
            self.icon = PACKAGING_MATERIAL_EMOJI.get(self.material_key, '📦')
        super().save(*args, **kwargs)

    def __str__(self):
        return self.label


class PackagingMaterialSizeRule(models.Model):
    """
    تفاصيل خامة التشغيل لمقاس/فئة مقاس محددة:
    معدل الاستهلاك لكل قطعة + المقاسات والمواصفات + المورد + حد التنبيه + الرصيد الحالي.
    """
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    rule = models.ForeignKey(
        PackagingMaterialRule, on_delete=models.CASCADE, related_name='size_rules', verbose_name="الخامة"
    )
    size_group_id = models.CharField(
        max_length=100, blank=True, default='', db_index=True, verbose_name="معرف فئة المقاس"
    )
    size_group_name = models.CharField(max_length=150, blank=True, default='', verbose_name="فئة المقاس")
    consumption_per_piece = models.FloatField(default=0.0, verbose_name="معدل الاستهلاك لكل قطعة")
    # سعر الوحدة لخامة التشغيل (بيانات مالية محمية بصلاحية مستقلة).
    price_per_unit = models.DecimalField(
        max_digits=12, decimal_places=2, default=0.0, verbose_name="سعر الوحدة"
    )
    dimensions_spec = models.CharField(
        max_length=255, blank=True, default='', verbose_name="المقاسات والمواصفات"
    )
    supplier = models.ForeignKey(
        Supplier, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='packaging_material_sizes', verbose_name="المورد"
    )
    min_alert_threshold = models.FloatField(default=0.0, verbose_name="حد التنبيه الأدنى")
    current_stock = models.FloatField(default=0.0, verbose_name="الرصيد الحالي")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['id']
        unique_together = ('rule', 'size_group_id')
        verbose_name = "تفاصيل خامة تشغيل حسب المقاس"
        verbose_name_plural = "تفاصيل خامات التشغيل حسب المقاس"

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('pack-mat-size')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.rule.label} - {self.size_group_name or 'كل المقاسات'}"


class PackagingMaterialTransaction(models.Model):
    """سجل حركة مخزون خامة تشغيل (وارد / منصرف / تعديل رصيد)."""
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    size_rule = models.ForeignKey(
        PackagingMaterialSizeRule, on_delete=models.CASCADE, related_name='transactions', verbose_name="صف الخامة"
    )
    operation = models.CharField(
        max_length=20, choices=PACKAGING_MATERIAL_TRANSACTION_CHOICES, default='add', verbose_name="نوع الحركة"
    )
    amount = models.FloatField(default=0.0, verbose_name="الكمية")
    # سعر الوحدة وقت الحركة (بيانات مالية محمية بصلاحية مستقلة).
    price_per_unit = models.DecimalField(
        max_digits=12, decimal_places=2, default=0.0, verbose_name="سعر الوحدة"
    )
    model_code_ref = models.CharField(
        max_length=150, blank=True, default='', db_index=True, verbose_name="كود الموديل"
    )
    notes = models.TextField(blank=True, default='', verbose_name="ملاحظات")
    timestamp = models.CharField(max_length=100, blank=True, default='', verbose_name="وقت الحركة")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']
        verbose_name = "حركة خامة تشغيل"
        verbose_name_plural = "حركات خامات التشغيل"

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('pack-mat-txn')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.size_rule} - {self.get_operation_display()} {self.amount}"


# ---------------------------------------------------------------------------
# Human Resources (HR) - الموارد البشرية
# ---------------------------------------------------------------------------

# أقسام المصنع الثابتة (11 قسماً) المستخدمة في الوظائف والموظفين.
HR_DEPARTMENT_CHOICES = [
    ('design', 'التصميم'),
    ('cutting', 'القص'),
    ('fabric_warehouse', 'مخزن القماش'),
    ('accessories_warehouse', 'مخزن الإكسسوارات'),
    ('sorting_control', 'الفرز والكنترول'),
    ('sewing', 'المكن والخياطة'),
    ('finishing', 'التشطيب'),
    ('ironing', 'المكواة'),
    ('packaging', 'التعبئة والتغليف'),
    ('administration', 'الإداريين'),
    ('crow', 'العمال (Crew)'),
    ('accounting', 'المحاسبين (Accounting)'),
]

HR_DEPARTMENT_KEYS = [key for key, _label in HR_DEPARTMENT_CHOICES]
HR_DEPARTMENT_LABELS = dict(HR_DEPARTMENT_CHOICES)

# أيام الأسبوع (يوم الإجازة الأسبوعية المدفوعة الأجر).
WEEK_DAY_CHOICES = [
    ('Saturday', 'السبت'),
    ('Sunday', 'الأحد'),
    ('Monday', 'الإثنين'),
    ('Tuesday', 'الثلاثاء'),
    ('Wednesday', 'الأربعاء'),
    ('Thursday', 'الخميس'),
    ('Friday', 'الجمعة'),
]

WEEK_DAY_LABELS = dict(WEEK_DAY_CHOICES)
DEFAULT_WEEKLY_OFF_DAY = 'Sunday'

# طريقة تطبيق قواعد التأخير/الخصم على الموظف.
HR_RULE_APPLICATION_CHOICES = [
    ('auto', 'تطبيق القواعد تلقائياً'),
    ('manual_review', 'مراجعة يدوية أولاً في الحضور والانصراف'),
]

# حالات سجل الحضور اليومي.
HR_ATTENDANCE_STATUS_CHOICES = [
    ('present', 'حاضر'),
    ('absent', 'غائب'),
    ('leave', 'إجازة'),
    ('missing_punch', 'بصمة ناقصة'),
]

HR_ATTENDANCE_STATUS_LABELS = dict(HR_ATTENDANCE_STATUS_CHOICES)

# حالة مراجعة الخصومات المحتسبة من الحضور.
HR_REVIEW_STATUS_CHOICES = [
    ('auto_applied', 'مطبق تلقائياً'),
    ('pending_review', 'بانتظار المراجعة'),
    ('approved', 'تم الاعتماد'),
    ('rejected', 'مرفوض'),
]

HR_REVIEW_STATUS_LABELS = dict(HR_REVIEW_STATUS_CHOICES)

# نوع الجزاء اليدوي (أيام أو ساعات).
HR_PENALTY_TYPE_CHOICES = [
    ('days', 'أيام'),
    ('hours', 'ساعات'),
]


