from django.db import models
from django.contrib.auth.hashers import make_password, check_password as django_check_password
from datetime import date, timedelta
import uuid


def generate_client_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


class SystemSetting(models.Model):
    """
    Stores system-wide flags (such as initial_seed_v1) so initial demo data
    is seeded only once and deleted accounts/records are never recreated.
    """
    key = models.CharField(max_length=100, unique=True, verbose_name="المفتاح")
    value = models.JSONField(default=dict, blank=True, verbose_name="القيمة")
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.key


class GlobalSettings(models.Model):
    """
    Stores dynamic global site settings (Header site name, Logo, Footer copyright,
    ready-made WhatsApp/Internal message templates, and default sewing print instructions).
    """
    site_name = models.CharField(
        max_length=200,
        default="نظام إدارة المصنع",
        verbose_name="اسم الموقع (في الهيدر)"
    )
    logo = models.TextField(
        blank=True,
        default="🏭",
        verbose_name="شعار الموقع (رابط صورة أو Base64 أو رمز)"
    )
    footer_title = models.CharField(
        max_length=255,
        default="🏭 نظام إدارة المصنع المتكامل - مصانع الملابس الجاهزة (ERP v2.0)",
        verbose_name="عنوان الفوتر"
    )
    copyright_text = models.CharField(
        max_length=255,
        default="تم التطوير لدعم دورة الإنتاج الشاملة والصلاحيات المتقدمة © 2026",
        verbose_name="جملة حقوق الملكية (في الفوتر)"
    )
    whatsapp_supplier_template = models.TextField(
        default=(
            "السلام عليكم ورحمة الله، مطلوب طلبية توريد عاجلة لمصنعنا:\n"
            "- الصنف / الخامة: {item_name}\n"
            "- الكود / اللون: {code}\n"
            "- الكمية المطلوبة: {quantity} {unit}\n"
            "- الرصيد الحالي بالمخزن: {available} {unit}\n"
            "برجاء التأكيد وتحديد موعد الشحن. شكراً لكم."
        ),
        verbose_name="نص رسالة الواتساب الجاهزة للموردين"
    )
    default_sewing_instructions = models.TextField(
        default=(
            "تم التأكد من أعداد الإكسسوارات ومطابقتها للمواصفات الفنية وعينة الاعتماد قبل التسليم للورشة.\n"
            "يرجى الالتزام التام بمقاسات القص والتشطيب النظيف وموعد الاستلام المتوقع."
        ),
        verbose_name="التعليمات والملاحظات الافتراضية في طباعة المكن"
    )
    internal_message_templates = models.JSONField(
        default=list,
        blank=True,
        verbose_name="نصوص الرسائل الداخلية الجاهزة"
    )
    updated_by = models.CharField(
        max_length=150,
        blank=True,
        default="",
        verbose_name="آخر تعديل بواسطة"
    )
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def get_solo(cls):
        obj = cls.objects.first()
        if not obj:
            obj = cls.objects.create(
                internal_message_templates=[
                    "يرجى سرعة مراجعة واعتماد الموديل المحول لقسمكم.",
                    "تم الانتهاء من المرحلة الحالية وجارٍ تسليم القطع للقسم التالي.",
                    "تنبيه: يوجد نقص في بعض المستلزمات، يرجى المراجعة العاجلة."
                ]
            )
        return obj

    def __str__(self):
        return self.site_name


class Role(models.Model):
    """
    Dynamic Role model - completely customizable without hardcoded limitations.
    Any permission (including managing permissions, global settings, and section notes)
    can be granted to any role or user.
    """
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    name = models.CharField(max_length=100, unique=True, verbose_name="اسم الدور")
    description = models.TextField(blank=True, null=True, verbose_name="الوصف")
    permissions_json = models.JSONField(default=dict, blank=True, verbose_name="صلاحيات العرض والتعديل التفصيلية")

    # Section Permissions
    can_fabric_warehouse = models.BooleanField(default=False, verbose_name="مخزن القماش")
    can_accessories_warehouse = models.BooleanField(default=False, verbose_name="مخزن الإكسسوارات")
    can_production_warehouse = models.BooleanField(default=False, verbose_name="مخزن الإنتاج")
    can_design = models.BooleanField(default=False, verbose_name="التصميم")
    can_cutting = models.BooleanField(default=False, verbose_name="القص")
    can_printing = models.BooleanField(default=False, verbose_name="المطابع والتطريز")
    can_qc = models.BooleanField(default=False, verbose_name="الفرز والكنترول")
    can_sewing = models.BooleanField(default=False, verbose_name="قسم المكن")
    can_models_tracking = models.BooleanField(default=False, verbose_name="حركة وتفاصيل الموديلات")
    can_reports = models.BooleanField(default=False, verbose_name="التقارير والإحصائيات")

    # Financial Permissions
    can_view_fabric_prices = models.BooleanField(default=False, verbose_name="رؤية أسعار القماش")
    can_edit_fabric_prices = models.BooleanField(default=False, verbose_name="تعديل أسعار القماش")
    can_view_accessory_prices = models.BooleanField(default=False, verbose_name="رؤية أسعار الإكسسوارات")
    can_edit_accessory_prices = models.BooleanField(default=False, verbose_name="تعديل أسعار الإكسسوارات")
    can_view_printing_costs = models.BooleanField(default=False, verbose_name="رؤية تكاليف المطابع")
    can_edit_printing_costs = models.BooleanField(default=False, verbose_name="تعديل تكاليف المطابع")

    # Sensitive & Communication Permissions
    can_send_whatsapp = models.BooleanField(default=False, verbose_name="إرسال طلبات النواقص عبر الواتساب")
    can_send_messages = models.BooleanField(default=False, verbose_name="إرسال الرسائل والمراسلات الداخلية")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def get_permissions_dict(self) -> dict:
        base = {
            'fabric_warehouse_view': bool(self.can_fabric_warehouse),
            'fabric_warehouse_edit': bool(self.can_fabric_warehouse),
            'accessories_warehouse_view': bool(self.can_accessories_warehouse),
            'accessories_warehouse_edit': bool(self.can_accessories_warehouse),
            'production_warehouse_view': bool(self.can_production_warehouse),
            'production_warehouse_edit': bool(self.can_production_warehouse),
            'design_view': bool(self.can_design),
            'design_edit': bool(self.can_design),
            'cutting_view': bool(self.can_cutting),
            'cutting_edit': bool(self.can_cutting),
            'qc_view': bool(self.can_qc),
            'qc_edit': bool(self.can_qc),
            'printing_view': bool(self.can_printing),
            'printing_edit': bool(self.can_printing),
            'sewing_view': bool(self.can_sewing),
            'sewing_edit': bool(self.can_sewing),
            'models_tracking_view': bool(self.can_models_tracking),
            'models_tracking_edit': bool(self.can_models_tracking),
            'reports_view': bool(self.can_reports),
            'reports_edit': bool(self.can_reports),
            'view_fabric_prices': bool(self.can_view_fabric_prices),
            'edit_fabric_prices': bool(self.can_edit_fabric_prices),
            'view_accessory_prices': bool(self.can_view_accessory_prices),
            'edit_accessory_prices': bool(self.can_edit_accessory_prices),
            'view_printing_costs': bool(self.can_view_printing_costs),
            'edit_printing_costs': bool(self.can_edit_printing_costs),
            'send_whatsapp_requests': bool(self.can_send_whatsapp),
            'send_internal_messages': bool(self.can_send_messages),
            # Dynamic administrative permissions (Task 2)
            'manage_permissions': False,
            'manage_users': False,
            'manage_suppliers': False,
            'manage_sizes': False,
            'view_audit_logs': False,
            # Global site settings permissions (Task 3)
            'view_global_settings': False,
            'edit_header_settings': False,
            'edit_message_templates': False,
            # Department notes permissions (Task 4)
            'can_add_design_notes': False,
            'can_add_cutting_notes': False,
            'can_add_qc_before_print_notes': False,
            'can_add_qc_after_print_notes': False,
            'can_add_sewing_notes': False,
            'can_add_printing_notes': False,
        }
        if isinstance(self.permissions_json, dict) and self.permissions_json:
            base.update(self.permissions_json)
        return base

    def sync_booleans_from_permissions(self, perms: dict):
        if not isinstance(perms, dict):
            return
        merged = self.get_permissions_dict()
        merged.update(perms)
        self.permissions_json = merged
        self.can_fabric_warehouse = bool(merged.get('fabric_warehouse_view') or merged.get('fabric_warehouse_edit'))
        self.can_accessories_warehouse = bool(merged.get('accessories_warehouse_view') or merged.get('accessories_warehouse_edit'))
        self.can_production_warehouse = bool(merged.get('production_warehouse_view') or merged.get('production_warehouse_edit'))
        self.can_design = bool(merged.get('design_view') or merged.get('design_edit'))
        self.can_cutting = bool(merged.get('cutting_view') or merged.get('cutting_edit'))
        self.can_qc = bool(merged.get('qc_view') or merged.get('qc_edit'))
        self.can_printing = bool(merged.get('printing_view') or merged.get('printing_edit'))
        self.can_sewing = bool(merged.get('sewing_view') or merged.get('sewing_edit'))
        self.can_models_tracking = bool(merged.get('models_tracking_view') or merged.get('models_tracking_edit'))
        self.can_reports = bool(merged.get('reports_view') or merged.get('reports_edit'))
        self.can_view_fabric_prices = bool(merged.get('view_fabric_prices'))
        self.can_edit_fabric_prices = bool(merged.get('edit_fabric_prices'))
        self.can_view_accessory_prices = bool(merged.get('view_accessory_prices'))
        self.can_edit_accessory_prices = bool(merged.get('edit_accessory_prices'))
        self.can_view_printing_costs = bool(merged.get('view_printing_costs'))
        self.can_edit_printing_costs = bool(merged.get('edit_printing_costs'))
        self.can_send_whatsapp = bool(merged.get('send_whatsapp_requests'))
        self.can_send_messages = bool(merged.get('send_internal_messages'))

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('role')
        if isinstance(self.permissions_json, dict) and self.permissions_json:
            self.sync_booleans_from_permissions(self.permissions_json)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class UserProfile(models.Model):
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    username = models.CharField(max_length=150, unique=True, verbose_name="اسم المستخدم")
    password_hash = models.CharField(max_length=255, default='', blank=True, verbose_name="كلمة المرور المشفرة")
    real_name = models.CharField(max_length=200, verbose_name="الاسم الحقيقي")
    phone = models.CharField(max_length=50, blank=True, null=True, verbose_name="رقم الهاتف")
    role = models.ForeignKey(Role, on_delete=models.SET_NULL, null=True, blank=True, related_name="users")
    role_title = models.CharField(max_length=150, blank=True, null=True, verbose_name="مسمى الدور الوظيفي")
    is_sudo = models.BooleanField(default=False, verbose_name="حساب الطوارئ المطلق Sudo")
    is_active = models.BooleanField(default=True, verbose_name="نشط")
    custom_permissions = models.JSONField(default=dict, blank=True, verbose_name="تخصيص صلاحيات إضافية")
    last_active = models.DateTimeField(blank=True, null=True, verbose_name="آخر ظهور")
    last_seen = models.DateTimeField(blank=True, null=True, verbose_name="آخر تواجد (Online)")
    auth_token = models.CharField(max_length=128, blank=True, null=True, db_index=True, verbose_name="رمز الجلسة")

    def set_password(self, raw_password: str):
        if raw_password:
            self.password_hash = make_password(raw_password)

    def check_password(self, raw_password: str) -> bool:
        if not raw_password:
            return False
        if not self.password_hash:
            return False
        # Support both hashed passwords and legacy plain-text passwords
        if self.password_hash.startswith('pbkdf2_') or self.password_hash.startswith('argon2') or self.password_hash.startswith('bcrypt'):
            return django_check_password(raw_password, self.password_hash)
        if self.password_hash == raw_password:
            self.set_password(raw_password)
            self.save(update_fields=['password_hash'])
            return True
        return False

    def has_perm(self, perm_name: str) -> bool:
        if self.is_sudo or self.username.lower() == 'sudo':
            return True
        if isinstance(self.custom_permissions, dict) and perm_name in self.custom_permissions:
            val = self.custom_permissions[perm_name]
            if isinstance(val, str):
                return val in ('view', 'edit', 'true', 'True')
            return bool(val)
        if self.role:
            role_perms = self.role.get_permissions_dict()
            if perm_name in role_perms:
                return bool(role_perms[perm_name])
            # Map legacy can_* names to new permission keys
            legacy_map = {
                'can_fabric_warehouse': 'fabric_warehouse_view',
                'can_accessories_warehouse': 'accessories_warehouse_view',
                'can_production_warehouse': 'production_warehouse_view',
                'can_design': 'design_view',
                'can_cutting': 'cutting_view',
                'can_printing': 'printing_view',
                'can_qc': 'qc_view',
                'can_sewing': 'sewing_view',
                'can_models_tracking': 'models_tracking_view',
                'can_reports': 'reports_view',
                'can_view_fabric_prices': 'view_fabric_prices',
                'can_edit_fabric_prices': 'edit_fabric_prices',
                'can_view_accessory_prices': 'view_accessory_prices',
                'can_edit_accessory_prices': 'edit_accessory_prices',
                'can_view_printing_costs': 'view_printing_costs',
                'can_edit_printing_costs': 'edit_printing_costs',
                'can_send_whatsapp': 'send_whatsapp_requests',
                'can_send_messages': 'send_internal_messages',
            }
            mapped = legacy_map.get(perm_name)
            if mapped and mapped in role_perms:
                return bool(role_perms[mapped])
            if hasattr(self.role, perm_name):
                return bool(getattr(self.role, perm_name))
        return False

    def save(self, *args, **kwargs):
        if self.username.lower() == 'sudo':
            self.client_id = 'user-sudo'
            self.is_sudo = True
            self.is_active = True
        elif not self.client_id:
            self.client_id = generate_client_id('user')
        if self.role and not self.role_title:
            self.role_title = self.role.name
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.real_name} ({self.username})"


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
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('sup')
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
    is_deleted = models.BooleanField(default=False)

    # Legacy fields kept for compatibility
    color = models.CharField(max_length=100, blank=True, default='', verbose_name="اللون")
    roll_number = models.CharField(max_length=100, blank=True, null=True, verbose_name="رقم التوب")
    quantity_kg = models.FloatField(default=0.0, verbose_name="الوزن بالكيلو")
    supplier = models.CharField(max_length=200, blank=True, null=True, verbose_name="المورد")
    price_per_meter = models.DecimalField(max_digits=10, decimal_places=2, default=0.0, verbose_name="سعر المتر")
    notes = models.TextField(blank=True, null=True, verbose_name="ملاحظات")
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
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
    model_code_ref = models.CharField(max_length=150, blank=True, default='', verbose_name="المرجع / كود الموديل")
    notes = models.TextField(blank=True, default='', verbose_name="ملاحظات")
    operation = models.CharField(max_length=20, default='deduct', verbose_name="نوع العملية")
    amount = models.FloatField(default=0.0, verbose_name="الكمية")
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
    current_stock = models.IntegerField(default=0, verbose_name="الرصيد الفعلي الحالي")
    reserved_quantity = models.FloatField(default=0.0, verbose_name="الكمية المحجوزة")
    min_threshold = models.IntegerField(default=10, verbose_name="الحد الأدنى للتنبيه")

    # For custom_model usage type
    target_quantity = models.IntegerField(default=0, verbose_name="الكمية المطلوبة / المستهدفة")
    delivered_quantity = models.IntegerField(default=0, verbose_name="الكمية التي تم توريدها")
    withdrawn_for_model = models.BooleanField(default=False, verbose_name="تم سحبه واكتماله بالكامل للموديل")

    price_per_unit = models.DecimalField(max_digits=10, decimal_places=2, default=0.0, verbose_name="سعر الوحدة")
    supplier_id_ref = models.CharField(max_length=100, blank=True, null=True, verbose_name="معرف المورد")
    supplier = models.CharField(max_length=200, blank=True, null=True, verbose_name="المورد")
    created_at_str = models.CharField(max_length=50, blank=True, null=True, verbose_name="تاريخ الإضافة")
    notes = models.TextField(blank=True, null=True)

    @property
    def deficit_quantity(self):
        if self.usage_type == 'custom_model':
            if self.withdrawn_for_model:
                return 0
            return max(0, self.target_quantity - self.delivered_quantity)
        return max(0, self.min_threshold - self.current_stock)

    def save(self, *args, **kwargs):
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
    model_code_ref = models.CharField(max_length=150, blank=True, default='', verbose_name="كود الموديل")
    notes = models.TextField(blank=True, default='', verbose_name="ملاحظات")
    timestamp = models.CharField(max_length=100, blank=True, default='', verbose_name="التوقيت")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('acc-tr')
        super().save(*args, **kwargs)


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
        ('مخزن الإنتاج التام', 'مخزن الإنتاج التام'),
        ('مكتمل الإنتاج', 'مكتمل الإنتاج (مخزن الإنتاج)'),
    ]

    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    model_code = models.CharField(max_length=100, unique=True, verbose_name="كود الموديل")
    model_type = models.CharField(max_length=100, blank=True, null=True, verbose_name="نوع الموديل")
    status = models.CharField(max_length=50, choices=STATUS_CHOICES, default='مرحلة التصميم', verbose_name="الحالة")
    size_category_id = models.CharField(max_length=100, blank=True, null=True, verbose_name="فئة المقاسات")
    main_marker_url = models.CharField(max_length=255, blank=True, default='', verbose_name="الماركر الأساسي")
    print_marker_url = models.CharField(max_length=255, blank=True, default='', verbose_name="ماركر الطباعة")

    target_cut_quantity = models.IntegerField(default=0, verbose_name="العدد المستهدف للقص")
    total_cut_pieces = models.IntegerField(default=0, verbose_name="العدد المقصوص فعلياً")

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

    colored_at = models.CharField(max_length=100, blank=True, null=True, verbose_name="تاريخ التلوين")
    cut_at = models.CharField(max_length=100, blank=True, null=True, verbose_name="تاريخ القص")

    image = models.TextField(blank=True, null=True, verbose_name="صورة الموديل (رابط أو Base64)")
    is_deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
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

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('req')
        super().save(*args, **kwargs)


class ModelAccessory(models.Model):
    TARGET_TYPES = [
        ('shirt', 'تيشرت'),
        ('pants', 'بنطلون'),
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

    def save(self, *args, **kwargs):
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
    color_name = models.CharField(max_length=150, blank=True, null=True, default='', verbose_name="اللون")
    size = models.CharField(max_length=50, blank=True, null=True, default='', verbose_name="المقاس")
    pieces_cut = models.IntegerField(default=0, verbose_name="القطع المقصوصة")
    counted_pieces = models.IntegerField(default=0, verbose_name="العدد الفعلي السليم")
    defect_pieces = models.IntegerField(default=0, verbose_name="عدد الهوالك والعيوب")
    notes = models.TextField(blank=True, null=True, verbose_name="ملاحظات الجودة")
    checked_by = models.CharField(max_length=150, verbose_name="مسؤول الفرز")
    created_at_str = models.CharField(max_length=100, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('qc')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.model.model_code} [{self.stage}] - {self.color_name} / {self.size} (سليم: {self.counted_pieces}, تالف: {self.defect_pieces})"


class PrintDispatch(models.Model):
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    model = models.ForeignKey(ModelItem, on_delete=models.CASCADE, related_name="dispatches")
    print_house = models.CharField(max_length=200, verbose_name="اسم المطبعة")
    pieces_count = models.IntegerField(default=0, verbose_name="عدد القطع المرسلة")
    print_type = models.CharField(max_length=100, default="سلك سكرين مائي", verbose_name="نوع الطباعة")
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
    ]
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    model = models.ForeignKey(ModelItem, on_delete=models.CASCADE, related_name="sewing_dispatches")
    piece_type = models.CharField(max_length=20, choices=PIECE_CHOICES, default='shirt', verbose_name="نوع القطعة")
    piece_label = models.CharField(max_length=50, blank=True, null=True, verbose_name="مسمى القطعة")
    workshop_name = models.CharField(max_length=200, verbose_name="اسم ورشة المكن / الخياطة")
    pieces_count = models.IntegerField(default=0, verbose_name="القطع المسلمة للورشة")
    dispatched_date = models.DateField(auto_now_add=True, verbose_name="تاريخ الخروج للورشة")
    dispatched_at_str = models.CharField(max_length=100, blank=True, null=True)
    expected_delivery_date = models.DateField(verbose_name="تاريخ الاستلام المتوقع")
    status = models.CharField(max_length=50, default="في ورشة المكن", verbose_name="الحالة")
    received_date = models.DateField(blank=True, null=True, verbose_name="تاريخ الاستلام الفعلي")
    received_at_str = models.CharField(max_length=100, blank=True, null=True)
    notes = models.TextField(blank=True, null=True, verbose_name="ملاحظات التشغيل")
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
        ('overdue', 'متأخر عن موعد الاستلام'),
        ('today', 'موعد الاستلام اليوم'),
        ('tomorrow', 'موعد الاستلام غداً'),
    ]
    STAGE_CHOICES = [
        ('printing', 'المطابع والتطريز'),
        ('sewing', 'ورش المكن والخياطة'),
    ]

    title = models.CharField(max_length=255, verbose_name="عنوان التنبيه")
    message = models.TextField(verbose_name="نص الإشعار")
    urgency = models.CharField(max_length=20, choices=URGENCY_CHOICES, verbose_name="مستوى الأهمية")
    stage = models.CharField(max_length=20, choices=STAGE_CHOICES, verbose_name="المرحلة")
    model = models.ForeignKey(ModelItem, on_delete=models.CASCADE, related_name="notifications")
    target_name = models.CharField(max_length=200, verbose_name="اسم الجهة (المطبعة أو الورشة)")
    expected_date = models.DateField(verbose_name="تاريخ الاستلام المتوقع")
    is_read = models.BooleanField(default=False, verbose_name="تمت القراءة")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-urgency', 'expected_date']

    def __str__(self):
        return f"[{self.urgency}] {self.title} - {self.model.model_code}"


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
    user_id_ref = models.CharField(max_length=100, blank=True, null=True, verbose_name="معرف المستخدم")
    user_name = models.CharField(max_length=200, verbose_name="اسم المستخدم")
    action = models.CharField(max_length=150, verbose_name="الإجراء")
    details = models.TextField(verbose_name="التفاصيل")
    ip_address = models.CharField(max_length=60, default='127.0.0.1', verbose_name="عنوان IP")
    timestamp = models.CharField(max_length=100, blank=True, default='', verbose_name="التاريخ والوقت")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('log')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"[{self.action}] {self.user_name}: {self.details[:40]}"