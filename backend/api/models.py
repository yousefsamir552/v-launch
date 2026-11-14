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

# مفاتيح صلاحيات الموارد البشرية السبعة المستقلة.
HR_PERM_KEYS = (
    'hr_jobs',
    'hr_employees',
    'hr_attendance',
    'hr_rules',
    'hr_loans',
    'hr_penalties',
    'hr_payroll',
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
        return normalize_assembly_permissions(base)

    def sync_booleans_from_permissions(self, perms: dict):
        if not isinstance(perms, dict):
            return
        merged = self.get_permissions_dict()
        merged.update(perms)
        merged = normalize_assembly_permissions(merged)
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
        self.can_view_printing_costs = bool(merged.get('view_printing_costs'))
        self.can_edit_printing_costs = bool(merged.get('edit_printing_costs'))
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
        if isinstance(self.custom_permissions, dict) and perm_name in self.custom_permissions:
            val = self.custom_permissions[perm_name]
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
    # نوع القطعة المرسلة للمطبعة (تيشرت / بنطلون / جاكيت / قطعة واحدة) لمطابقة تقسيم الموديل
    piece_type = models.CharField(max_length=20, choices=PART_TYPE_CHOICES, default='shirt', verbose_name="نوع القطعة")
    piece_label = models.CharField(max_length=50, blank=True, null=True, verbose_name="مسمى القطعة")
    pieces_count = models.IntegerField(default=0, verbose_name="عدد القطع المرسلة")
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
        ('finishing', 'قسم التشطيب'),
        ('ironing', 'قسم المكواة'),
        ('packaging', 'قسم التعبئة والتغليف'),
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
    entry_date = models.DateField(blank=True, null=True, verbose_name="تاريخ دخول التشطيب")
    expected_exit_date = models.DateField(blank=True, null=True, verbose_name="تاريخ الخروج المتوقع")
    actual_exit_date = models.DateField(blank=True, null=True, verbose_name="تاريخ الاستلام الفعلي")
    notes = models.TextField(blank=True, null=True, verbose_name="ملاحظات التشطيب")
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
    entry_date = models.DateField(blank=True, null=True, verbose_name="تاريخ الدخول")
    expected_exit_date = models.DateField(blank=True, null=True, verbose_name="تاريخ الخروج المتوقع")
    actual_exit_date = models.DateField(blank=True, null=True, verbose_name="تاريخ الخروج الفعلي")
    notes = models.TextField(blank=True, null=True, verbose_name="ملاحظات المرحلة")
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
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.stage_label} - {self.model.model_code}"


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


def generate_employee_code() -> str:
    """Default employee/biotime ID generated when the user leaves it empty."""
    return f"EMP-{uuid.uuid4().hex[:6].upper()}"


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
    official_start_time = models.TimeField(default='08:30', verbose_name="موعد الحضور الرسمي")
    official_end_time = models.TimeField(default='17:30', verbose_name="موعد الانصراف الرسمي")
    weekly_off_day = models.CharField(
        max_length=20, choices=WEEK_DAY_CHOICES, default=DEFAULT_WEEKLY_OFF_DAY,
        verbose_name="يوم الإجازة الأسبوعية المدفوعة",
    )
    month_calculation_days = models.IntegerField(default=30, verbose_name="عدد أيام الشهر الحسابية")
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
                        'label': 'غياب يوم كامل',
                        'from_minutes': 0,
                        'to_minutes': 0,
                        'until_time': '',
                        'deduction_type': 'days',
                        'deduction_value': 1,
                        'apply_mode': 'manual_review',
                    },
                ],
            )
        return obj

    @property
    def weekly_off_day_label(self) -> str:
        return WEEK_DAY_LABELS.get(self.weekly_off_day, self.weekly_off_day)

    def save(self, *args, **kwargs):
        # عدد أيام الشهر الحسابية ثابت دائماً = 30 يوماً
        self.month_calculation_days = 30
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
    excuse_note = models.TextField(blank=True, null=True, verbose_name="ملاحظة العذر")
    calculated_deduction_days = models.FloatField(default=0.0, verbose_name="الخصم المحتسب (أيام)")
    calculated_deduction_hours = models.FloatField(default=0.0, verbose_name="الخصم المحتسب (ساعات)")
    late_minutes = models.FloatField(default=0.0, verbose_name="دقائق التأخير (محتسبة)")
    early_minutes = models.FloatField(default=0.0, verbose_name="دقائق الانصراف المبكر (محتسبة)")
    overtime_days = models.FloatField(default=0.0, verbose_name="العمل الإضافي (أيام)")
    overtime_hours = models.FloatField(default=0.0, verbose_name="العمل الإضافي (ساعات)")
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
    """سلفة مالية على الموظف تُخصم من المرتبات."""
    client_id = models.CharField(max_length=100, blank=True, null=True, db_index=True, verbose_name="المعرف")
    employee = models.ForeignKey(
        HREmployee, on_delete=models.CASCADE, related_name='loans',
        verbose_name="الموظف",
    )
    date = models.DateField(default=date.today, db_index=True, verbose_name="التاريخ")
    amount = models.FloatField(default=0.0, verbose_name="مبلغ السلفة")
    notes = models.TextField(blank=True, default='', verbose_name="ملاحظات")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-date', '-id']

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = generate_client_id('hr-loan')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.employee} - {self.amount}"


