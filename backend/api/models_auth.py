from django.db import models
from django.contrib.auth.hashers import make_password, check_password as django_check_password
from datetime import date, timedelta
import uuid

from .storage_r2 import guard_image_field


def generate_client_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


# ---------------------------------------------------------------------------
# Strict Hierarchical Ranks (الرتب الهرمية الصارمة والمخفية)
#   0 = Sudo (السيادة المطلقة) — محصورة حصرياً في حساب sudo.
#   1 = الإدارة العليا.
#   2 = الإدارة المتوسطة / الإشرافية.
#   3 = المستوى العام (الافتراضي).
#
# القاعدة الذهبية (Strict Less-Than Visibility):
#   كل رتبة ترى/تتحكم فقط في الرتب الأقل منها (الرقم الأكبر)،
#   ولا ترى نفس رتبتها ولا ما هو أعلى منها. الرتبة 3 (قاع الهرم) ترى
#   أقرانها فقط مع إخفاء تام لمفهوم الرتب عنها.
# ---------------------------------------------------------------------------
RANK_SUDO = 0
RANK_LEVEL_ONE = 1
RANK_LEVEL_TWO = 2
RANK_LEVEL_THREE = 3
DEFAULT_RANK_LEVEL = RANK_LEVEL_THREE

RANK_LEVEL_CHOICES = [
    (RANK_SUDO, 'السيادة المطلقة (Sudo)'),
    (RANK_LEVEL_ONE, 'المستوى الأول - إدارة عليا'),
    (RANK_LEVEL_TWO, 'المستوى الثاني - إشرافي'),
    (RANK_LEVEL_THREE, 'المستوى الثالث - عام'),
]
RANK_LEVEL_KEYS = [RANK_SUDO, RANK_LEVEL_ONE, RANK_LEVEL_TWO, RANK_LEVEL_THREE]

# مفاتيح صلاحيات الموارد البشرية المستقلة.
HR_PERM_KEYS = (
    'hr_jobs',
    'hr_employees',
    'hr_attendance',
    'hr_rules',
    'hr_loans',
    'hr_penalties',
    'hr_payroll',
    'hr_reports',
)


def coerce_rank_level(value, default: int = DEFAULT_RANK_LEVEL) -> int:
    """إرجاع رتبة صحيحة ضمن 0/1/2/3 أو القيمة الافتراضية."""
    try:
        rank = int(value)
    except (TypeError, ValueError):
        return default
    return rank if rank in RANK_LEVEL_KEYS else default


def visible_rank_levels(viewer_rank) -> set:
    """الرتب المسموح للناظر برؤيتها/التحكم فيها وفق قاعدة Strict Less-Than."""
    viewer_rank = coerce_rank_level(viewer_rank)
    if viewer_rank == RANK_SUDO:
        return {RANK_SUDO, RANK_LEVEL_ONE, RANK_LEVEL_TWO, RANK_LEVEL_THREE}
    if viewer_rank == RANK_LEVEL_THREE:
        # قاع الهرم: يرى أقرانه فقط دون إدراك لوجود نظام رتب.
        return {RANK_LEVEL_THREE}
    return {rank for rank in (RANK_LEVEL_TWO, RANK_LEVEL_THREE) if rank > viewer_rank}


def grantable_rank_levels(viewer_rank) -> list:
    """الرتب المسموح للناظر بمنحها لمستخدم/دور/موظف عند الإنشاء أو التعديل."""
    viewer_rank = coerce_rank_level(viewer_rank)
    if viewer_rank == RANK_SUDO:
        return [RANK_LEVEL_ONE, RANK_LEVEL_TWO, RANK_LEVEL_THREE]
    if viewer_rank == RANK_LEVEL_ONE:
        return [RANK_LEVEL_TWO, RANK_LEVEL_THREE]
    return [RANK_LEVEL_THREE]


def can_manage_rank(viewer_rank, target_rank) -> bool:
    """هل يملك الناظر صلاحية التحكم (عرض/تعديل/حذف) في هدف بهذه الرتبة؟"""
    return coerce_rank_level(target_rank) in visible_rank_levels(viewer_rank)


def rank_visibility_label(viewer_rank, target_rank) -> str:
    """تسمية الرتبة نسبياً حسب رتبة الناظر لإخفاء الهرم الأعلى.

    الرتبة 3 لا يظهر لها أي مسمى (نظام الرتب مخفي بالكامل).
    """
    viewer_rank = coerce_rank_level(viewer_rank)
    target_rank = coerce_rank_level(target_rank)
    if viewer_rank == RANK_SUDO:
        return dict(RANK_LEVEL_CHOICES).get(target_rank, '')
    if viewer_rank == RANK_LEVEL_ONE:
        if target_rank == RANK_LEVEL_ONE:
            return 'المستوى الأعلى / إدارة عليا'
        return {
            RANK_LEVEL_TWO: 'مستوى إشرافي/متقدم',
            RANK_LEVEL_THREE: 'مستوى عام',
        }.get(target_rank, '')
    if viewer_rank == RANK_LEVEL_TWO:
        if target_rank == RANK_LEVEL_TWO:
            return 'مستوى إداري متقدم'
        return {RANK_LEVEL_THREE: 'المستوى العام'}.get(target_rank, '')
    # الرتبة 3: إخفاء كامل لمفهوم الرتب.
    return ''


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
    # تارجتات الأقسام المستخدمة في تقرير الإنتاج والسرعة.
    # الشكل: {"cutting": {"daily": 1200, "monthly": 26000}, "printing": {...}, ...}
    department_targets = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="تارجتات الأقسام (يومي / شهري)"
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

    def save(self, *args, **kwargs):
        # الصور تُخزَّن على R2 كروابط فقط (لا Base64 داخل قاعدة البيانات).
        guard_image_field(self, 'logo', 'شعار الموقع')
        super().save(*args, **kwargs)

    def __str__(self):
        return self.site_name


# مفاتيح صلاحية "الأسمبلي والأمبالاج" المعتمدة: المفتاح الحالي + البدائل القديمة/الفرعية.
# تُستخدم لتوحيد أي دور محفوظ بمفتاح قديم (assembly / packaging) أو بصلاحية فرعية
# حتى لا تختفي الشاشة عن الحسابات المحفوظة مسبقاً.
ASSEMBLY_ACCESS_KEYS = (
    'assembly_packaging',
    'assembly',
    'packaging',
    'finishing',
    'ironing',
    'dest',
    'materials',
)


def normalize_assembly_permissions(perms: dict) -> dict:
    """Fold legacy/alternate assembly permission keys into the canonical key."""
    if not isinstance(perms, dict):
        return perms
    view = bool(perms.get('assembly_packaging_view'))
    edit = bool(perms.get('assembly_packaging_edit'))
    for key in ASSEMBLY_ACCESS_KEYS:
        view = view or bool(perms.get('{}_view'.format(key)))
        edit = edit or bool(perms.get('{}_edit'.format(key)))
    perms['assembly_packaging_view'] = bool(view or edit)
    perms['assembly_packaging_edit'] = bool(edit)
    return perms


# ---------------------------------------------------------------------------
# ترحيل صلاحيات المطابع القديمة (تكاليف) إلى الاسم المعتمد (أسعار) مع الحفاظ
# على توافقية البيانات المحفوظة في permissions_json / custom_permissions.
# ---------------------------------------------------------------------------
FINANCIAL_PERMISSION_ALIASES = {
    'view_printing_costs': 'view_printing_prices',
    'edit_printing_costs': 'edit_printing_prices',
    'can_view_printing_costs': 'view_printing_prices',
    'can_edit_printing_costs': 'edit_printing_prices',
}

FINANCIAL_PERMISSION_REVERSE = {
    'view_printing_prices': ('view_printing_costs',),
    'edit_printing_prices': ('edit_printing_costs',),
}


def canonical_permission_key(perm_name):
    """Return the canonical (new) name for a legacy printing-costs permission."""
    if not isinstance(perm_name, str):
        return perm_name
    return FINANCIAL_PERMISSION_ALIASES.get(perm_name, perm_name)


def normalize_financial_permissions(perms: dict) -> dict:
    """Fold legacy ``*_printing_costs`` keys into the canonical ``*_printing_prices``."""
    if not isinstance(perms, dict):
        return perms
    for legacy, canonical in FINANCIAL_PERMISSION_ALIASES.items():
        if legacy in perms and canonical not in perms:
            perms[canonical] = perms[legacy]
    return perms


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
    # الصلاحيات التي يحق لحاملي هذا الدور تفويضها/منحها للغير (فارغة = كل الصلاحيات شخصية فقط).
    delegatable_permissions = models.JSONField(
        default=list,
        blank=True,
        verbose_name="الصلاحيات القابلة للتفويض",
    )
    rank_level = models.IntegerField(
        default=DEFAULT_RANK_LEVEL,
        choices=RANK_LEVEL_CHOICES,
        db_index=True,
        verbose_name="الرتبة الهرمية",
    )

    # Section Permissions
    can_fabric_warehouse = models.BooleanField(default=False, verbose_name="مخزن القماش")
    can_accessories_warehouse = models.BooleanField(default=False, verbose_name="مخزن الإكسسوارات")
    can_production_warehouse = models.BooleanField(default=False, verbose_name="مخزن الإنتاج")
    can_design = models.BooleanField(default=False, verbose_name="التصميم")
    can_cutting = models.BooleanField(default=False, verbose_name="القص")
    can_printing = models.BooleanField(default=False, verbose_name="المطابع والتطريز")
    can_qc = models.BooleanField(default=False, verbose_name="الفرز والكنترول")
    can_sewing = models.BooleanField(default=False, verbose_name="قسم المكن")
    can_assembly_packaging = models.BooleanField(default=False, verbose_name="الأسمبلي والأمبالاج")
    can_models_tracking = models.BooleanField(default=False, verbose_name="حركة وتفاصيل الموديلات")
    can_reports = models.BooleanField(default=False, verbose_name="التقارير والإحصائيات")

    # Financial Permissions
    can_view_fabric_prices = models.BooleanField(default=False, verbose_name="رؤية أسعار القماش")
    can_edit_fabric_prices = models.BooleanField(default=False, verbose_name="تعديل أسعار القماش")
    can_view_accessory_prices = models.BooleanField(default=False, verbose_name="رؤية أسعار الإكسسوارات")
    can_edit_accessory_prices = models.BooleanField(default=False, verbose_name="تعديل أسعار الإكسسوارات")
    can_view_printing_prices = models.BooleanField(default=False, verbose_name="رؤية أسعار المطابع")
    can_edit_printing_prices = models.BooleanField(default=False, verbose_name="تعديل أسعار المطابع")
    can_view_sewing_prices = models.BooleanField(default=False, verbose_name="رؤية أسعار المكن والخياطة")
    can_edit_sewing_prices = models.BooleanField(default=False, verbose_name="تعديل أسعار المكن والخياطة")
    can_view_assembly_prices = models.BooleanField(default=False, verbose_name="رؤية أسعار الأسمبلي والأمبالاج وخامات التشغيل")
    can_edit_assembly_prices = models.BooleanField(default=False, verbose_name="تعديل أسعار الأسمبلي والأمبالاج وخامات التشغيل")

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
            'assembly_packaging_view': bool(self.can_assembly_packaging),
            'assembly_packaging_edit': bool(self.can_assembly_packaging),
            'models_tracking_view': bool(self.can_models_tracking),
            'models_tracking_edit': bool(self.can_models_tracking),
            'reports_view': bool(self.can_reports),
            'reports_edit': bool(self.can_reports),
            'view_fabric_prices': bool(self.can_view_fabric_prices),
            'edit_fabric_prices': bool(self.can_edit_fabric_prices),
            'view_accessory_prices': bool(self.can_view_accessory_prices),
            'edit_accessory_prices': bool(self.can_edit_accessory_prices),
            'view_printing_prices': bool(self.can_view_printing_prices),
            'edit_printing_prices': bool(self.can_edit_printing_prices),
            'view_sewing_prices': bool(self.can_view_sewing_prices),
            'edit_sewing_prices': bool(self.can_edit_sewing_prices),
            'view_assembly_prices': bool(self.can_view_assembly_prices),
            'edit_assembly_prices': bool(self.can_edit_assembly_prices),
            'send_whatsapp_requests': bool(self.can_send_whatsapp),
            'send_internal_messages': bool(self.can_send_messages),
            # Dynamic administrative permissions (Task 2)
            'manage_permissions': False,
            'manage_users': False,
            'manage_suppliers': False,
            'manage_sizes': False,
            'view_audit_logs': False,
            # Human Resources section permission (master fallback)
            'can_manage_hr': False,
            # Granular per-tab HR permissions
            'hr_jobs': False,
            'hr_employees': False,
            'hr_attendance': False,
            'hr_rules': False,
            'hr_loans': False,
            'hr_penalties': False,
            'hr_payroll': False,
            'hr_reports': False,
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
        return normalize_financial_permissions(normalize_assembly_permissions(base))

    def sync_booleans_from_permissions(self, perms: dict):
        if not isinstance(perms, dict):
            return
        merged = self.get_permissions_dict()
        merged.update(perms)
        merged = normalize_financial_permissions(normalize_assembly_permissions(merged))
        self.permissions_json = merged
        self.can_fabric_warehouse = bool(merged.get('fabric_warehouse_view') or merged.get('fabric_warehouse_edit'))
        self.can_accessories_warehouse = bool(merged.get('accessories_warehouse_view') or merged.get('accessories_warehouse_edit'))
        self.can_production_warehouse = bool(merged.get('production_warehouse_view') or merged.get('production_warehouse_edit'))
        self.can_design = bool(merged.get('design_view') or merged.get('design_edit'))
        self.can_cutting = bool(merged.get('cutting_view') or merged.get('cutting_edit'))
        self.can_qc = bool(merged.get('qc_view') or merged.get('qc_edit'))
        self.can_printing = bool(merged.get('printing_view') or merged.get('printing_edit'))
        self.can_sewing = bool(merged.get('sewing_view') or merged.get('sewing_edit'))
        self.can_assembly_packaging = bool(merged.get('assembly_packaging_view') or merged.get('assembly_packaging_edit'))
        self.can_models_tracking = bool(merged.get('models_tracking_view') or merged.get('models_tracking_edit'))
        self.can_reports = bool(merged.get('reports_view') or merged.get('reports_edit'))
        self.can_view_fabric_prices = bool(merged.get('view_fabric_prices'))
        self.can_edit_fabric_prices = bool(merged.get('edit_fabric_prices'))
        self.can_view_accessory_prices = bool(merged.get('view_accessory_prices'))
        self.can_edit_accessory_prices = bool(merged.get('edit_accessory_prices'))
        self.can_view_printing_prices = bool(merged.get('view_printing_prices'))
        self.can_edit_printing_prices = bool(merged.get('edit_printing_prices'))
        self.can_view_sewing_prices = bool(merged.get('view_sewing_prices'))
        self.can_edit_sewing_prices = bool(merged.get('edit_sewing_prices'))
        self.can_view_assembly_prices = bool(merged.get('view_assembly_prices'))
        self.can_edit_assembly_prices = bool(merged.get('edit_assembly_prices'))
        self.can_send_whatsapp = bool(merged.get('send_whatsapp_requests'))
        self.can_send_messages = bool(merged.get('send_internal_messages'))

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('role')
        # الرتبة 0 (Sudo) محصورة حصرياً في حساب sudo ولا تُمنح لأي دور.
        if self.rank_level == RANK_SUDO or self.rank_level not in RANK_LEVEL_KEYS:
            self.rank_level = DEFAULT_RANK_LEVEL
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
    rank_level = models.IntegerField(
        default=DEFAULT_RANK_LEVEL,
        choices=RANK_LEVEL_CHOICES,
        db_index=True,
        verbose_name="الرتبة الهرمية",
    )
    is_active = models.BooleanField(default=True, verbose_name="نشط")
    custom_permissions = models.JSONField(default=dict, blank=True, verbose_name="تخصيص صلاحيات إضافية")
    # الصلاحيات التي يحق لهذا المستخدم منحها/توريثها لغيره (فارغة = كل صلاحياته شخصية فقط).
    delegatable_permissions = models.JSONField(
        default=list,
        blank=True,
        verbose_name="الصلاحيات القابلة للتفويض (يمكن منحها للغير)",
    )
    # تتبع من أنشأ الحساب (لمنع الهروب من العقوبة عند إيقاف المدير).
    created_by = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_users',
        verbose_name="أنشأه",
    )
    created_by_name = models.CharField(
        max_length=200,
        blank=True,
        null=True,
        verbose_name="اسم من أنشأ الحساب",
    )
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
        # ترحيل أسماء صلاحيات المطابع القديمة (تكاليف → أسعار).
        perm_name = canonical_permission_key(perm_name)
        legacy_aliases = FINANCIAL_PERMISSION_REVERSE.get(perm_name, ())
        if isinstance(self.custom_permissions, dict):
            for key in (perm_name,) + tuple(legacy_aliases):
                if key in self.custom_permissions:
                    val = self.custom_permissions[key]
                    if isinstance(val, str):
                        return val in ('view', 'edit', 'true', 'True')
                    return bool(val)
        # "الأسمبلي والأمبالاج": اقبل أيضاً المفاتيح القديمة/الفرعية المخزنة في تخصيص المستخدم
        # (assembly / packaging / finishing / ironing / dest / materials) حتى لا تتعطل الحسابات المحفوظة.
        if perm_name in ('assembly_packaging_view', 'assembly_packaging_edit') and isinstance(self.custom_permissions, dict):
            want_edit = perm_name.endswith('_edit')
            suffix = 'edit' if want_edit else 'view'
            for key in ASSEMBLY_ACCESS_KEYS:
                suffixed = self.custom_permissions.get('{}_{}'.format(key, suffix))
                bare = self.custom_permissions.get(key)
                for val, from_bare in ((suffixed, False), (bare, True)):
                    if isinstance(val, str):
                        if want_edit and val == 'edit':
                            return True
                        if not want_edit and val in ('view', 'edit', 'true', 'True'):
                            return True
                    elif bool(val):
                        if not want_edit or not from_bare:
                            return True
        # Master HR permission (legacy/manage_permissions) grants every HR sub-tab permission.
        if perm_name in HR_PERM_KEYS and isinstance(self.custom_permissions, dict):
            if (self.custom_permissions.get('can_manage_hr')
                    or self.custom_permissions.get('manage_permissions')):
                return True
        if self.role:
            role_perms = self.role.get_permissions_dict()
            # Master HR permission grants every HR sub-tab permission.
            if perm_name in HR_PERM_KEYS and (
                role_perms.get('can_manage_hr') or role_perms.get('manage_permissions')
            ):
                return True
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
                'can_assembly_packaging': 'assembly_packaging_view',
                'can_models_tracking': 'models_tracking_view',
                'can_reports': 'reports_view',
                'can_view_fabric_prices': 'view_fabric_prices',
                'can_edit_fabric_prices': 'edit_fabric_prices',
                'can_view_accessory_prices': 'view_accessory_prices',
                'can_edit_accessory_prices': 'edit_accessory_prices',
                'can_view_printing_costs': 'view_printing_prices',
                'can_edit_printing_costs': 'edit_printing_prices',
                'can_view_printing_prices': 'view_printing_prices',
                'can_edit_printing_prices': 'edit_printing_prices',
                'can_view_sewing_prices': 'view_sewing_prices',
                'can_edit_sewing_prices': 'edit_sewing_prices',
                'can_view_assembly_prices': 'view_assembly_prices',
                'can_edit_assembly_prices': 'edit_assembly_prices',
                'can_send_whatsapp': 'send_whatsapp_requests',
                'can_send_messages': 'send_internal_messages',
            }
            mapped = legacy_map.get(perm_name)
            if mapped and mapped in role_perms:
                return bool(role_perms[mapped])
            if hasattr(self.role, perm_name):
                return bool(getattr(self.role, perm_name))
        return False

    def is_sudo_account(self) -> bool:
        return bool(self.is_sudo or (self.username or '').lower() == 'sudo')

    def get_effective_delegatable_permissions(self):
        """الصلاحيات التي يحق لهذا المستخدم منحها/توريثها للغير.

        - حساب sudo: يرجع ``None`` بمعنى "كل الصلاحيات مسموحة".
        - غير ذلك: اتحاد صلاحيات التفويض الشخصية + صلاحيات تفويض الدور المرتبط.
        """
        if self.is_sudo_account():
            return None
        keys = set()
        if isinstance(self.delegatable_permissions, (list, tuple, set)):
            keys.update(str(k) for k in self.delegatable_permissions if k)
        role = getattr(self, 'role', None)
        if role is not None and isinstance(getattr(role, 'delegatable_permissions', None), (list, tuple, set)):
            keys.update(str(k) for k in role.delegatable_permissions if k)
        return keys

    def can_delegate_perm(self, perm_name: str) -> bool:
        allowed = self.get_effective_delegatable_permissions()
        if allowed is None:
            return True
        return str(perm_name) in allowed

    def save(self, *args, **kwargs):
        if self.username.lower() == 'sudo':
            self.client_id = 'user-sudo'
            self.is_sudo = True
            self.is_active = True
        elif not self.client_id:
            self.client_id = generate_client_id('user')
        # الرتبة 0 (Sudo) محصورة حصرياً في حساب الطوارئ المطلق.
        if self.is_sudo or self.username.lower() == 'sudo':
            self.rank_level = RANK_SUDO
        elif self.rank_level == RANK_SUDO or self.rank_level not in RANK_LEVEL_KEYS:
            self.rank_level = DEFAULT_RANK_LEVEL
        if self.role and not self.role_title:
            self.role_title = self.role.name
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.real_name} ({self.username})"


