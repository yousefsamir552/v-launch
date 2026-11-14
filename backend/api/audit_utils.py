"""
محرك التدقيق المركزي للمصنع (Enterprise Audit Engine).

يوفر:
- ثوابت الأقسام وأنواع الإجراءات وأسماء الصلاحيات بالعربية.
- استخراج IP الحقيقي خلف بروكسي Render (X-Forwarded-For).
- بناء فروقات الحقول (old ➡️ new) بشكل مقروء وآمن (بدون كلمات المرور).
- ``log_action`` لتسجيل أي إجراء يدوياً.
- ``AuditedModelViewSetMixin`` لتسجيل تلقائي لكل عمليات الإضافة/التعديل/الحذف
  وكل إجراءات ``@action`` غير القارئة، دون التأثير على استجابة الـ API.
"""
import functools
import json

from django.apps import apps
from django.utils import timezone

from .models import AuditLog


# ---------------------------------------------------------------------------
# الثوابت العربية
# ---------------------------------------------------------------------------
ACTION_TYPE_LABELS = {
    'create': 'إضافة',
    'update': 'تعديل',
    'delete': 'حذف',
    'status_change': 'تغيير حالة',
    'transaction': 'حركة مخزون',
    'settings': 'تعديل إعدادات',
    'import': 'استيراد بيانات',
    'permission': 'تعديل صلاحيات',
    'login': 'تسجيل دخول',
    'logout': 'تسجيل خروج',
    'upload': 'رفع ملف',
    'custom': 'إجراء',
}

# اسم القسم العربي لكل موديل (يُستخدم تلقائياً في الـ ViewSets)
SECTION_BY_MODEL = {
    'UserProfile': 'الموظفين والصلاحيات',
    'Role': 'الموظفين والصلاحيات',
    'SizeDef': 'الإعدادات',
    'Supplier': 'الموردين',
    'Workshop': 'الورش',
    'Fabric': 'مخزن القماش',
    'FabricColor': 'مخزن القماش',
    'FabricTransaction': 'مخزن القماش',
    'AccessoryType': 'مخزن الإكسسوارات',
    'Accessory': 'مخزن الإكسسوارات',
    'AccessoryTransaction': 'مخزن الإكسسوارات',
    'ModelItem': 'التصميم',
    'ModelRequirement': 'التصميم',
    'ModelAccessory': 'التصميم',
    'ModelTimeline': 'التصميم',
    'CuttingRecord': 'القص',
    'CuttingSpreadLayer': 'القص',
    'QCRecord': 'العد والجودة',
    'PrintDispatch': 'المطابع',
    'SewingDispatch': 'المكن',
    'PackagingRequirement': 'الأسمبلي والأمبالاج',
    'FinishingRecord': 'الأسمبلي والأمبالاج',
    'AssemblyStageRecord': 'الأسمبلي والأمبالاج',
    'PackagingMaterialRule': 'خامات التشغيل',
    'PackagingMaterialSizeRule': 'خامات التشغيل',
    'PackagingMaterialTransaction': 'خامات التشغيل',
    'InternalMessage': 'المراسلات الداخلية',
    'AppNotification': 'التنبيهات',
    'AuditLog': 'سجل المراقبة',
    'HRJobTitle': 'الموارد البشرية',
    'HREmployee': 'الموارد البشرية',
    'HRAttendanceRecord': 'الموارد البشرية',
    'HRPenalty': 'الموارد البشرية',
    'HRLoan': 'الموارد البشرية',
}

# اسم العنصر العربي المستخدم في صياغة التفاصيل
NOUN_BY_MODEL = {
    'UserProfile': 'حساب موظف',
    'Role': 'دور وظيفي',
    'SizeDef': 'فئة مقاسات',
    'Supplier': 'مورد',
    'Workshop': 'ورشة',
    'Fabric': 'قماش',
    'FabricColor': 'لون قماش',
    'FabricTransaction': 'حركة قماش',
    'AccessoryType': 'تصنيف إكسسوار',
    'Accessory': 'صنف إكسسوار',
    'AccessoryTransaction': 'حركة إكسسوار',
    'ModelItem': 'موديل',
    'ModelRequirement': 'متطلب موديل',
    'ModelAccessory': 'إكسسوار موديل',
    'ModelTimeline': 'ملاحظة زمنية',
    'CuttingRecord': 'سجل قص',
    'QCRecord': 'سجل جودة',
    'PrintDispatch': 'إرسالية مطبعة',
    'SewingDispatch': 'إرسالية مكن',
    'PackagingRequirement': 'متطلبات أمبالاج',
    'FinishingRecord': 'سجل تشطيب',
    'AssemblyStageRecord': 'مرحلة أسمبلي',
    'PackagingMaterialRule': 'قاعدة خامات تشغيل',
    'PackagingMaterialTransaction': 'حركة خامات تشغيل',
    'InternalMessage': 'رسالة داخلية',
    'AuditLog': 'سجل تدقيق',
    'HRJobTitle': 'وظيفة',
    'HREmployee': 'موظف',
    'HRAttendanceRecord': 'سجل حضور',
    'HRPenalty': 'جزاء',
    'HRLoan': 'سلفة',
}

# اسم الدالة (action method) -> (نوع الإجراء، صيغة عربية للتفاصيل)
ACTION_METHOD_LABELS = {
    'add_fabric_or_color': ('create', 'أضاف قماش/لون جديد'),
    'record_transaction': ('transaction', 'سجّل حركة مخزون'),
    'mark_withdrawn': ('status_change', 'علّم الصنف كمسحوب للموديل'),
    'update_plan': ('update', 'حدّث خطة وخامات الموديل'),
    'issue_fabric_to_cutting': ('status_change', 'صرف خامات الموديل إلى القص'),
    'finish_cutting': ('status_change', 'أنهى القص'),
    'dispatch_to_sewing': ('status_change', 'حوّل الموديل إلى المكن'),
    'record_qc_count': ('update', 'سجّل عد الجودة'),
    'finish_qc_approval': ('status_change', 'اعتمد عد الجودة'),
    'finish_sewing': ('status_change', 'أنهى المكن'),
    'finish_qc_to_production': ('status_change', 'حوّل إلى التشطيب/الإنتاج التام'),
    'receive_from_print': ('status_change', 'استلم الموديل من المطابع'),
    'add_timeline': ('create', 'أضاف ملاحظة زمنية للموديل'),
    'set_packaging_step': ('status_change', 'حدّث خطوة الأمبالاج'),
    'start_finishing': ('status_change', 'بدأ مرحلة التشطيب'),
    'receive_finishing': ('status_change', 'استلم مرحلة التشطيب'),
    'start_ironing': ('status_change', 'بدأ مرحلة المكواة'),
    'receive_ironing': ('status_change', 'استلم مرحلة المكواة'),
    'start_assembly_stage': ('status_change', 'بدأ مرحلة أسمبلي'),
    'receive_assembly_stage': ('status_change', 'استلم مرحلة أسمبلي'),
    'save_matrix': ('update', 'حفظ مصفوفة الجودة'),
    'update_status': ('status_change', 'حدّث حالة الإرسالية'),
    'receive': ('status_change', 'استلم الإرسالية'),
    'skip_print': ('status_change', 'تجاوز مرحلة الطباعة'),
    'mark_read': ('update', 'علّم الرسالة كمقروءة'),
    'update_settings': ('settings', 'حدّث الإعدادات'),
    'upload_sheet': ('import', 'رفع شيت حضور الموظفين'),
    'reapply_rules': ('settings', 'أعاد تطبيق قواعد الحضور'),
    'toggle_active': ('status_change', 'غيّر حالة تفعيل الحساب'),
    'login': ('login', 'سجّل الدخول'),
    'logout': ('logout', 'سجّل الخروج'),
}

PERMISSION_LABELS = {
    'fabric_warehouse_view': 'عرض مخزن القماش',
    'fabric_warehouse_edit': 'تعديل مخزن القماش',
    'accessories_warehouse_view': 'عرض مخزن الإكسسوارات',
    'accessories_warehouse_edit': 'تعديل مخزن الإكسسوارات',
    'production_warehouse_view': 'عرض مخزن الإنتاج',
    'production_warehouse_edit': 'تعديل مخزن الإنتاج',
    'design_view': 'عرض التصميم',
    'design_edit': 'تعديل التصميم',
    'cutting_view': 'عرض القص',
    'cutting_edit': 'تعديل القص',
    'qc_view': 'عرض الفرز والكنترول',
    'qc_edit': 'تعديل الفرز والكنترول',
    'printing_view': 'عرض المطابع والتطريز',
    'printing_edit': 'تعديل المطابع والتطريز',
    'sewing_view': 'عرض قسم المكن',
    'sewing_edit': 'تعديل قسم المكن',
    'assembly_packaging_view': 'عرض الأسمبلي والأمبالاج',
    'assembly_packaging_edit': 'تعديل الأسمبلي والأمبالاج',
    'models_tracking_view': 'عرض حركة الموديلات',
    'models_tracking_edit': 'تعديل حركة الموديلات',
    'reports_view': 'عرض التقارير',
    'reports_edit': 'تعديل التقارير',
    'view_fabric_prices': 'رؤية أسعار القماش',
    'edit_fabric_prices': 'تعديل أسعار القماش',
    'view_accessory_prices': 'رؤية أسعار الإكسسوارات',
    'edit_accessory_prices': 'تعديل أسعار الإكسسوارات',
    'view_printing_costs': 'رؤية تكاليف المطابع',
    'edit_printing_costs': 'تعديل تكاليف المطابع',
    'send_whatsapp_requests': 'إرسال طلبات الواتساب',
    'send_internal_messages': 'إرسال المراسلات الداخلية',
    'manage_permissions': 'إدارة الصلاحيات',
    'manage_users': 'إدارة المستخدمين',
    'manage_suppliers': 'إدارة الموردين',
    'manage_sizes': 'إدارة المقاسات',
    'view_audit_logs': 'عرض سجل المراقبة',
    'can_manage_hr': 'إدارة الموارد البشرية',
    'hr_jobs': 'الوظائف',
    'hr_employees': 'الموظفين',
    'hr_attendance': 'الحضور والانصراف',
    'hr_rules': 'قواعد الحضور',
    'hr_loans': 'السلف',
    'hr_penalties': 'الجزاءات',
    'hr_payroll': 'المرتبات',
    'view_global_settings': 'عرض الإعدادات العامة',
    'edit_header_settings': 'تعديل إعدادات الموقع',
    'edit_message_templates': 'تعديل قوالب الرسائل',
    'can_add_design_notes': 'إضافة ملاحظات التصميم',
    'can_add_cutting_notes': 'إضافة ملاحظات القص',
    'can_add_qc_before_print_notes': 'إضافة ملاحظات العد قبل الطباعة',
    'can_add_qc_after_print_notes': 'إضافة ملاحظات العد بعد الطباعة',
    'can_add_sewing_notes': 'إضافة ملاحظات المكن',
    'can_add_printing_notes': 'إضافة ملاحظات المطابع',
    'can_reports': 'التقارير',
    'can_settings': 'الإعدادات',
}

FIELD_LABELS = {
    'role': 'الدور الوظيفي',
    'created_by': 'أنشأه',
    'created_by_name': 'اسم من أنشأ الحساب',
    'username': 'اسم المستخدم',
    'real_name': 'الاسم الحقيقي',
    'password_hash': 'كلمة المرور',
    'is_active': 'حالة الحساب',
    'rank_level': 'الرتبة الهرمية',
    'custom_permissions': 'الصلاحيات المخصصة',
    'permissions_json': 'الصلاحيات التفصيلية',
    'delegatable_permissions': 'الصلاحيات القابلة للتفويض',
    'model': 'الموديل',
    'color': 'اللون',
    'fabric': 'القماش',
    'accessory': 'الإكسسوار',
    'employee': 'الموظف',
    'job': 'الوظيفة',
    'supplier': 'المورد',
    'workshop': 'الورشة',
    'size_rule': 'قاعدة المقاس',
    'phone': 'رقم الهاتف',
    'notes': 'ملاحظات',
    'details': 'التفاصيل',
    'status': 'الحالة',
    'target_name': 'العنصر',
}

SENSITIVE_FIELDS = {'password', 'password_hash', 'auth_token', 'token'}

SYSTEM_FIELDS = {
    'id', 'pk', 'client_id', 'created_at', 'updated_at', 'updated_by',
    'last_seen', 'last_active', 'auth_token',
}

PERMISSION_FIELDS = {'permissions_json', 'custom_permissions', 'delegatable_permissions'}


# ---------------------------------------------------------------------------
# أدوات مساعدة عامة
# ---------------------------------------------------------------------------
def get_client_ip(request):
    """يعيد IP الحقيقي للعميل (خلف بروكسي Render) مع تجاهل القيم الفارغة."""
    if request is None:
        return '127.0.0.1'
    try:
        forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
        if forwarded:
            first = str(forwarded).split(',')[0].strip()
            if first:
                return first
        return request.META.get('REMOTE_ADDR') or '127.0.0.1'
    except Exception:
        return '127.0.0.1'


def is_sudo_account(profile) -> bool:
    if not profile:
        return False
    try:
        return bool(
            getattr(profile, 'is_sudo', False)
            or str(getattr(profile, 'username', '') or '').lower() == 'sudo'
        )
    except Exception:
        return False


def resolve_profile_for_audit(request):
    """يحل هوية المستخدم من الطلب (حتى لو لم يُضِفها الـ ViewSet إلى request)."""
    if request is None:
        return None
    profile = getattr(request, 'user_profile', None)
    if profile is not None:
        return profile
    try:
        auth_header = request.headers.get('Authorization', '') or ''
        token = auth_header[7:].strip() if auth_header.startswith('Bearer ') else ''
        if not token:
            token = (request.headers.get('X-Auth-Token', '') or '').strip()
        if not token:
            return None
        from .models import UserProfile
        return UserProfile.objects.filter(auth_token=token, is_active=True).first()
    except Exception:
        return None


def _ext_id(obj) -> str:
    if obj is None:
        return ''
    client_id = getattr(obj, 'client_id', None)
    if client_id:
        return str(client_id)
    pk = getattr(obj, 'pk', None)
    return str(pk) if pk is not None else ''


def get_display_name(obj) -> str:
    """اسم مقروء لأي كائن (يُستخدم في الأهداف وفروقات العلاقات)."""
    if obj is None:
        return ''
    for attr in (
        'real_name', 'name', 'title', 'model_code', 'color_name',
        'color_code', 'code', 'label', 'employee_code', 'username',
    ):
        try:
            value = getattr(obj, attr, None)
        except Exception:
            value = None
        if value:
            return str(value)
    model = getattr(obj, 'model', None)
    if model is not None:
        code = getattr(model, 'model_code', None)
        if code:
            extra = (
                getattr(obj, 'piece_label', None)
                or getattr(obj, 'part_type', None)
                or getattr(obj, 'piece_type', None)
            )
            return f"{code} - {extra}" if extra else str(code)
    employee = getattr(obj, 'employee', None)
    if employee is not None and employee is not obj:
        return get_display_name(employee)
    try:
        return str(obj)
    except Exception:
        return ''


# ---------------------------------------------------------------------------
# محرك فروقات الحقول (Field-level diff engine)
# ---------------------------------------------------------------------------
def _jsonable(value):
    """تحويل أي قيمة إلى نوع قابل للمقارنة/التخزين في JSON."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if hasattr(value, 'isoformat'):
        try:
            return value.isoformat()
        except Exception:
            return str(value)
    return str(value)


def _normalize_compare(value):
    if isinstance(value, (dict, list, tuple, set)):
        return json.dumps(_jsonable(value), ensure_ascii=False, sort_keys=True, default=str)
    return _jsonable(value)


def snapshot_instance(instance) -> dict:
    """لقطة من كل حقول الكائن الفعلية (بدون الحقول التقنية/الرموز)."""
    if instance is None:
        return {}
    data = {}
    for field in instance._meta.concrete_fields:
        name = field.name
        if name in SYSTEM_FIELDS:
            continue
        try:
            value = getattr(instance, field.attname if field.is_relation else name)
        except Exception:
            continue
        data[name] = value
    return data


def _truthy_keys(value) -> set:
    if isinstance(value, dict):
        return {str(k) for k, v in value.items() if v}
    if isinstance(value, (list, tuple, set)):
        return {str(v) for v in value if v}
    return set()


def _permission_labels(keys) -> list:
    return [PERMISSION_LABELS.get(str(k), str(k)) for k in keys]


def _resolve_related(field, value):
    try:
        related_model = field.related_model
        if related_model is None:
            return None
        text = str(value).strip()
        if text.isdigit():
            return related_model.objects.filter(pk=int(text)).first()
        if hasattr(related_model, 'client_id'):
            return related_model.objects.filter(client_id=text).first()
    except Exception:
        return None
    return None


def _field_label(model, key) -> str:
    if key in FIELD_LABELS:
        return FIELD_LABELS[key]
    if model is not None:
        try:
            return str(model._meta.get_field(key).verbose_name)
        except Exception:
            pass
    return key


def _format_value(model, key, value) -> str:
    """صياغة عربية مقروءة لقيمة الحقل داخل الفرق."""
    field = None
    if model is not None:
        try:
            field = model._meta.get_field(key)
        except Exception:
            field = None

    if value is None or value == '':
        return '—'
    if isinstance(value, bool):
        if key == 'is_active':
            return 'نشط' if value else 'موقوف'
        return 'نعم' if value else 'لا'
    if field is not None and field.is_relation:
        related = _resolve_related(field, value)
        if related is not None:
            return get_display_name(related)
        return str(value)
    if isinstance(value, (int, float)):
        if isinstance(value, float):
            return f"{value:g}"
        return str(value)
    if isinstance(value, dict):
        if key in PERMISSION_FIELDS:
            keys = sorted(_truthy_keys(value))
            labels = _permission_labels(keys)
            return '، '.join(labels) if labels else '—'
        text = json.dumps(_jsonable(value), ensure_ascii=False, default=str)
        return text[:500] + ('…' if len(text) > 500 else '')
    if isinstance(value, (list, tuple, set)):
        items = list(value)
        if not items:
            return '—'
        if all(isinstance(v, str) for v in items):
            return '، '.join(_permission_labels(items))
        if key in ('rules_json', 'overtime_rules', 'internal_message_templates'):
            return f"{len(items)} عنصر/عناصر"
        text = json.dumps(_jsonable(items), ensure_ascii=False, default=str)
        return text[:500] + ('…' if len(text) > 500 else '')
    if field is not None and getattr(field, 'choices', None):
        try:
            mapping = dict(field.choices)
            if value in mapping:
                return str(mapping[value])
        except Exception:
            pass
    if hasattr(value, 'year') and hasattr(value, 'hour') and hasattr(value, 'strftime'):
        return value.strftime('%Y-%m-%d %H:%M')
    if hasattr(value, 'year') and hasattr(value, 'strftime'):
        return value.strftime('%Y-%m-%d')
    if hasattr(value, 'hour') and hasattr(value, 'minute') and hasattr(value, 'strftime'):
        return value.strftime('%H:%M')
    text = str(value)
    text = text.strip()
    if not text:
        return '—'
    return text[:500] + ('…' if len(text) > 500 else '')


def build_field_changes(before: dict, after: dict, model=None, max_items=None) -> list:
    """يبني قائمة تغييرات [{field, label, old, new}] جاهزة للعرض في الواجهة."""
    before = before or {}
    after = after or {}
    keys = list(before.keys()) + [k for k in after.keys() if k not in before]

    permission_changed = any(
        _normalize_compare(before.get(field)) != _normalize_compare(after.get(field))
        for field in PERMISSION_FIELDS
        if field in before or field in after
    )
    role_changed = (
        'role' in before and 'role' in after
        and _normalize_compare(before.get('role')) != _normalize_compare(after.get('role'))
    )

    changes = []
    for key in keys:
        if key in SYSTEM_FIELDS:
            continue
        old_value = before.get(key)
        new_value = after.get(key)
        if _normalize_compare(old_value) == _normalize_compare(new_value):
            continue
        # حقول can_* مشتقة تلقائياً من permissions_json فلا نكررها.
        if permission_changed and key.startswith('can_'):
            continue
        # role_title مشتق من role فلا نكرر تغييره.
        if key == 'role_title' and role_changed:
            continue

        label = _field_label(model, key)

        if key in SENSITIVE_FIELDS:
            changes.append({
                'field': key,
                'label': label,
                'old': '—',
                'new': 'تم تغيير كلمة المرور',
            })
            continue

        if key in PERMISSION_FIELDS:
            added = sorted(_truthy_keys(new_value) - _truthy_keys(old_value))
            removed = sorted(_truthy_keys(old_value) - _truthy_keys(new_value))
            if not added and not removed:
                continue
            old_text = ('أُزيلت: ' + '، '.join(_permission_labels(removed))) if removed else '—'
            new_text = ('أُضيفت: ' + '، '.join(_permission_labels(added))) if added else '—'
            changes.append({
                'field': key,
                'label': label,
                'old': old_text,
                'new': new_text,
            })
            continue

        old_text = _format_value(model, key, old_value)
        new_text = _format_value(model, key, new_value)
        if old_text == '—' and new_text == '—':
            continue

        changes.append({
            'field': key,
            'label': label,
            'old': old_text,
            'new': new_text,
        })

    if max_items is not None and len(changes) > max_items:
        changes = changes[:max_items]
    return changes


# ---------------------------------------------------------------------------
# استخراج الهدف من الـ payload / الـ response
# ---------------------------------------------------------------------------
def _resolve_related_name(model_name: str, value) -> str:
    try:
        model = apps.get_model('api', model_name)
        if model is None:
            return ''
        text = str(value).strip()
        obj = None
        if text.isdigit():
            obj = model.objects.filter(pk=int(text)).first()
        if obj is None and hasattr(model, 'client_id'):
            obj = model.objects.filter(client_id=text).first()
        return get_display_name(obj) if obj is not None else ''
    except Exception:
        return ''


def _target_from_payload(data) -> str:
    if not isinstance(data, dict):
        return ''
    for key in (
        'real_name', 'name', 'title', 'model_code', 'modelCode',
        'username', 'employee_name', 'code', 'color_code', 'colorCode',
    ):
        value = data.get(key)
        if value:
            return str(value)
    for key in (
        'accessoryName', 'accessory_name', 'colorName', 'color_name',
        'modelName', 'model_name', 'employeeName', 'employee_name',
        'workshopName', 'workshop_name', 'supplierName', 'supplier_name',
    ):
        value = data.get(key)
        if value:
            return str(value)
    id_lookup = (
        ('accessoryId', 'Accessory'), ('accessory_id', 'Accessory'), ('accessory', 'Accessory'),
        ('fabricColorId', 'FabricColor'), ('colorId', 'FabricColor'), ('color', 'FabricColor'),
        ('modelId', 'ModelItem'), ('model_id', 'ModelItem'), ('model', 'ModelItem'),
        ('employeeId', 'HREmployee'), ('employee_id', 'HREmployee'), ('employee', 'HREmployee'),
        ('workshopId', 'Workshop'), ('workshop_id', 'Workshop'), ('workshop', 'Workshop'),
        ('supplierId', 'Supplier'), ('supplier_id', 'Supplier'), ('supplier', 'Supplier'),
    )
    for key, model_name in id_lookup:
        value = data.get(key)
        if value:
            resolved = _resolve_related_name(model_name, value)
            if resolved:
                return resolved
    return ''


def _find_id_for_model(data, model_name: str, depth: int = 0) -> str:
    if data is None or depth > 3:
        return ''
    if isinstance(data, dict):
        for key, value in data.items():
            if str(key).lower() == model_name.lower() and isinstance(value, dict):
                found = value.get('id') or value.get('client_id')
                if found:
                    return str(found)
        top = data.get('id') or data.get('client_id')
        if top:
            return str(top)
        for value in data.values():
            found = _find_id_for_model(value, model_name, depth + 1)
            if found:
                return found
    elif isinstance(data, list):
        for item in data:
            found = _find_id_for_model(item, model_name, depth + 1)
            if found:
                return found
    return ''


def _resolve_created_object(view, request, response):
    instance = getattr(view, '_audit_created_instance', None)
    if instance is not None and getattr(instance, 'pk', None):
        return instance
    try:
        queryset = view.get_queryset()
        model = queryset.model
    except Exception:
        return None
    data = getattr(response, 'data', None)
    ext_id = _find_id_for_model(data, model.__name__)
    if not ext_id and hasattr(request, 'data'):
        ext_id = str(request.data.get('id') or request.data.get('client_id') or '')
    if not ext_id:
        return None
    ext_id = str(ext_id).strip()
    if not ext_id:
        return None
    try:
        obj = queryset.filter(client_id=ext_id).first()
        if obj is not None:
            return obj
        if ext_id.isdigit():
            return queryset.filter(pk=int(ext_id)).first()
    except Exception:
        return None
    return None


def _refresh_instance(instance):
    if instance is None or getattr(instance, 'pk', None) is None:
        return None
    try:
        return instance.__class__.objects.filter(pk=instance.pk).first()
    except Exception:
        return None


def _safe_get_object(view):
    try:
        return view.get_object()
    except Exception:
        return None


# ---------------------------------------------------------------------------
# تسجيل الإجراء
# ---------------------------------------------------------------------------
def log_action(
    request,
    *,
    section: str,
    action_type: str,
    target_name: str = '',
    details: str = '',
    changes=None,
    user=None,
):
    """تسجيل إجراء في سجل المراقبة. لا يكسر أي طلب حتى لو فشل التسجيل."""
    try:
        profile = user if user is not None else resolve_profile_for_audit(request)
        if is_sudo_account(profile):
            return None

        user_name = ''
        user_full_name = ''
        if profile is not None:
            user_full_name = str(getattr(profile, 'real_name', '') or '').strip()
            user_name = user_full_name or str(getattr(profile, 'username', '') or '').strip()
        if not user_name:
            user_name = 'مستخدم'

        changes_list = _jsonable(changes) if isinstance(changes, list) else []

        return AuditLog.objects.create(
            user_id_ref=_ext_id(profile),
            user_name=user_name,
            user_full_name=user_full_name,
            section=str(section or ''),
            action_type=str(action_type or ''),
            action=ACTION_TYPE_LABELS.get(action_type, str(action_type or 'إجراء')),
            target_name=str(target_name or '')[:255],
            details=str(details or ''),
            changes=changes_list,
            ip_address=get_client_ip(request),
            timestamp=timezone.now().strftime('%Y-%m-%d %H:%M:%S'),
        )
    except Exception:
        return None





# ---------------------------------------------------------------------------
# Mixin: تدقيق تلقائي لكل الـ ViewSets
# ---------------------------------------------------------------------------
def _wrap_audit_callable(method_name, fn):
    @functools.wraps(fn)
    def wrapper(self, request, *args, **kwargs):
        return self._audit_execute(
            method_name,
            lambda: fn(self, request, *args, **kwargs),
            request,
        )

    wrapper._audit_wrapped = True
    return wrapper


class AuditedModelViewSetMixin:
    """يضيف تسجيلاً تلقائياً لكل عمليات CRUD وكل إجراءات @action غير القارئة."""

    audit_section = ''
    audit_noun = ''
    audit_enabled = True

    def perform_create(self, serializer):
        super().perform_create(serializer)
        self._audit_created_instance = getattr(serializer, 'instance', None)

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        if getattr(cls, 'audit_enabled', True) is False:
            return
        for name in ('create', 'update', 'partial_update', 'destroy'):
            fn = cls.__dict__.get(name)
            if fn is None or getattr(fn, '_audit_wrapped', False):
                continue
            setattr(cls, name, _wrap_audit_callable(name, fn))
        for name, fn in list(cls.__dict__.items()):
            if not callable(fn) or not hasattr(fn, 'mapping'):
                continue
            if getattr(fn, '_audit_wrapped', False):
                continue
            setattr(cls, name, _wrap_audit_callable(name, fn))

    # ---- Base CRUD wrappers (تُستخدم عندما لا يعرّف الـ ViewSet نسخته) ----
    def create(self, request, *args, **kwargs):
        return self._audit_execute(
            'create',
            lambda: super(AuditedModelViewSetMixin, self).create(request, *args, **kwargs),
            request,
        )

    def update(self, request, *args, **kwargs):
        return self._audit_execute(
            'update',
            lambda: super(AuditedModelViewSetMixin, self).update(request, *args, **kwargs),
            request,
        )

    def partial_update(self, request, *args, **kwargs):
        return self._audit_execute(
            'update',
            lambda: super(AuditedModelViewSetMixin, self).partial_update(request, *args, **kwargs),
            request,
        )

    def destroy(self, request, *args, **kwargs):
        return self._audit_execute(
            'destroy',
            lambda: super(AuditedModelViewSetMixin, self).destroy(request, *args, **kwargs),
            request,
        )

    # ---- Helpers ----
    def _audit_model(self):
        model = getattr(getattr(self, 'queryset', None), 'model', None)
        if model is None:
            try:
                model = self.get_queryset().model
            except Exception:
                model = None
        return model

    def get_audit_section(self):
        if self.audit_section:
            return self.audit_section
        model = self._audit_model()
        return SECTION_BY_MODEL.get(getattr(model, '__name__', ''), 'عام')

    def get_audit_noun(self):
        if self.audit_noun:
            return self.audit_noun
        model = self._audit_model()
        return NOUN_BY_MODEL.get(getattr(model, '__name__', ''), 'عنصر')

    def get_audit_target_name(self, instance):
        return get_display_name(instance)


    # ---- Execution / logging ----
    def _audit_execute(self, method_name, call, request):
        if not getattr(self, 'audit_enabled', True):
            return call()
        http_method = str(getattr(request, 'method', 'GET') or 'GET').upper()
        if http_method in ('GET', 'HEAD', 'OPTIONS'):
            return call()
        if getattr(request, '_audit_depth', 0) > 0:
            return call()

        before_obj = _safe_get_object(self)
        before_snapshot = snapshot_instance(before_obj) if before_obj is not None else {}
        target_before = self.get_audit_target_name(before_obj) if before_obj is not None else ''

        request._audit_depth = 1
        try:
            response = call()
        finally:
            request._audit_depth = 0

        try:
            status_code = int(getattr(response, 'status_code', 200) or 200)
        except Exception:
            status_code = 200
        if status_code >= 400:
            return response

        try:
            self._write_audit_entry(
                method_name, request, response, before_obj, before_snapshot, target_before,
            )
        except Exception:
            pass
        return response

    def _write_audit_entry(self, method_name, request, response, before_obj, before_snapshot, target_before):
        section = self.get_audit_section()
        noun = self.get_audit_noun()
        http_method = str(getattr(request, 'method', 'POST') or 'POST').upper()
        action_type = 'update'
        changes = []
        target = target_before

        is_create = method_name == 'create'
        is_update = method_name in ('update', 'partial_update')
        is_destroy = method_name == 'destroy'

        if is_create:
            action_type = 'create'
            after_obj = _resolve_created_object(self, request, response)
            if after_obj is not None:
                target = self.get_audit_target_name(after_obj) or target
                changes = build_field_changes(
                    {}, snapshot_instance(after_obj), model=after_obj.__class__, max_items=12,
                )
            if not target:
                target = _target_from_payload(getattr(request, 'data', None))
            details = f"أضاف {noun} جديد: {target}" if target else f"أضاف {noun} جديد"
        elif is_destroy:
            action_type = 'delete'
            model = before_obj.__class__ if before_obj is not None else None
            changes = build_field_changes(before_snapshot, {}, model=model)
            details = f"حذف {noun}: {target}" if target else f"حذف {noun}"
        elif is_update:
            action_type = 'update'
            after_obj = _refresh_instance(before_obj)
            if after_obj is not None:
                target = self.get_audit_target_name(after_obj) or target
                changes = build_field_changes(
                    before_snapshot, snapshot_instance(after_obj), model=after_obj.__class__,
                )
            if not target:
                target = _target_from_payload(getattr(request, 'data', None))
            details = f"عدّل بيانات {noun}: {target}" if target else f"عدّل بيانات {noun}"
        else:
            info = ACTION_METHOD_LABELS.get(method_name)
            if info:
                action_type, phrase = info
            else:
                action_type = {
                    'POST': 'create', 'PUT': 'update', 'PATCH': 'update', 'DELETE': 'delete',
                }.get(http_method, 'update')
                phrase = f"نفّذ إجراء ({method_name})"
            after_obj = _refresh_instance(before_obj)
            if after_obj is not None:
                target = self.get_audit_target_name(after_obj) or target
                changes = build_field_changes(
                    before_snapshot, snapshot_instance(after_obj), model=after_obj.__class__,
                )
            if not target:
                target = _target_from_payload(getattr(request, 'data', None))
            if not target:
                target = _target_from_payload(getattr(response, 'data', None))
            details = f"{phrase}: {target}" if target else phrase

        log_action(
            request,
            section=section,
            action_type=action_type,
            target_name=target,
            details=details,
            changes=changes,
        )

