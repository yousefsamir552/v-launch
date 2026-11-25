from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from rest_framework.exceptions import PermissionDenied, ValidationError as DRFValidationError
from django.core.exceptions import ImproperlyConfigured, ValidationError
from django.db import models, transaction
from django.db.models import Q
from django.http import Http404, HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_time
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
import re
import secrets
import urllib.parse

from .models import (
    SystemSetting, GlobalSettings, Role, UserProfile, SizeDef, Supplier, Workshop,
    WORKSHOP_TYPE_KEYS,
    Fabric, FabricColor, FabricTransaction,
    AccessoryType, Accessory, AccessoryTransaction,
    ModelItem, ModelRequirement, ModelAccessory, ModelTimeline,
    CuttingRecord, CuttingSpreadLayer, QCRecord, PrintDispatch,
    SewingDispatch, AppNotification, InternalMessage, AuditLog,
    COMPOSITION_TO_PARTS, DEFAULT_GARMENT_COMPOSITION,
    PART_TYPE_CHOICES, PART_TYPE_KEYS,
    PackagingRequirement, FinishingRecord, AssemblyStageRecord,
    WorkshopEvaluation, WORKSHOP_EVALUATION_STAGE_KEYS,
    PackagingMaterialRule, PackagingMaterialSizeRule, PackagingMaterialTransaction,
    PACKAGING_STEP_ORDER, ASSEMBLY_STAGE_KEYS,
    PACKAGING_MATERIAL_LABELS,
    PACKAGING_MATERIAL_UNIT_KEYS, PACKAGING_MATERIAL_RULE_MODE_KEYS,
    HRJobTitle, HREmployee, HRAttendanceSettings,
    HRAttendanceRecord, HRPenalty, HRLoan, HRPayrollSnapshot,
    HR_DEPARTMENT_LABELS, WEEK_DAY_LABELS, HR_ATTENDANCE_STATUS_CHOICES,
    HR_REVIEW_STATUS_CHOICES, HR_PENALTY_TYPE_CHOICES,
    RANK_SUDO, RANK_LEVEL_ONE, RANK_LEVEL_TWO, RANK_LEVEL_THREE,
    DEFAULT_RANK_LEVEL, RANK_LEVEL_KEYS, HR_PERM_KEYS, SALARY_PERMISSION_KEYS,
    coerce_rank_level, visible_rank_levels, grantable_rank_levels,
    can_manage_rank, rank_visibility_label,
)
from .serializers import (
    resolve_by_id, get_ext_id,
    GlobalSettingsSerializer, RoleSerializer, UserProfileSerializer, SizeDefSerializer, SupplierSerializer,
    WorkshopSerializer,
    FabricSerializer, FabricColorSerializer, FabricTransactionSerializer,
    AccessoryTypeSerializer, AccessorySerializer, AccessoryTransactionSerializer,
    ModelItemSerializer, ModelRequirementSerializer, ModelAccessorySerializer,
    ModelTimelineSerializer, CuttingRecordSerializer, CuttingSpreadLayerSerializer, QCRecordSerializer,
    PrintDispatchSerializer, SewingDispatchSerializer,
    AppNotificationSerializer, InternalMessageSerializer, AuditLogSerializer,
    PackagingRequirementSerializer, FinishingRecordSerializer, AssemblyStageRecordSerializer,
    WorkshopEvaluationSerializer,
    PackagingMaterialRuleSerializer, PackagingMaterialSizeRuleSerializer,
    PackagingMaterialTransactionSerializer,
    HRJobTitleSerializer, HREmployeeSerializer, HRAttendanceSettingsSerializer,
    HRAttendanceRecordSerializer, HRPenaltySerializer, HRLoanSerializer,
    HRPayrollSnapshotSerializer,
)
from .services import (
    ensure_initial_seed,
    ensure_packaging_material_categories,
    apply_packaging_material_transaction,
    sync_reserved_quantities,
    get_accessory_deficits,
    generate_smart_delivery_notifications,
    generate_assembly_delivery_notifications,
    filter_notifications_by_permission,
    dispatch_model_to_sewing_service,
    receive_model_from_sewing_service,
    get_or_create_packaging_requirement,
    packaging_requirement_summary,
    set_packaging_step_service,
    start_finishing_service,
    receive_finishing_service,
    start_assembly_stage_service,
    receive_assembly_stage_service,
    PackagingStockShortageError,
    start_ironing_service,
    receive_ironing_service,
    packaging_readiness,
    part_stages_payload,
    normalize_part_key,
    recompute_model_part_totals,
    advance_parts_to_stage,
    derive_pipeline_status,
    seed_part_stages_from_status,
    get_part_stages,
    set_all_part_stages,
)
from .reports import (
    get_production_report,
    get_models_report,
    get_production_departments_report,
    get_quality_shortage_report,
    get_model_stage_waterfall,
    get_workshop_evaluations_report,
    get_department_targets,
    save_department_targets,
)
from .permissions import (
    CanManageCatalog,
    CanManageHR,
    HasDynamicSectionPermission,
    IsAuthenticatedProfile,
)
from .audit_utils import (
    ACTION_TYPE_LABELS,
    AuditedModelViewSetMixin,
    build_field_changes,
    is_sudo_account,
    log_action,
    set_audit_meta,
    snapshot_instance,
)
from .throttles import LoginRateThrottle, ProfileRateThrottle, SyncRateThrottle
from .storage_r2 import normalize_image_field, upload_image_file
from .hr_attendance_io import (
    build_template_csv,
    compute_attendance,
    compute_overtime,
    month_bounds,
    parse_attendance_sheet,
    reapply_employee_month,
    weekly_off_weekday,
    working_hours_per_day,
)


def parse_time_value(val):
    """Convert 'HH:MM' / 'HH:MM:SS' or time objects to datetime.time (None when invalid)."""
    if not val:
        return None
    if hasattr(val, 'strftime'):
        return val
    try:
        return parse_time(str(val).strip())
    except (TypeError, ValueError):
        return None


def resolve_request_user_profile(request):
    """
    Resolves the authenticated UserProfile from a Bearer token or X-Auth-Token.
    X-User-Username is intentionally ignored: it is client-controlled and trusting
    it allowed full identity impersonation (including the sudo account).
    """
    profile = getattr(request, 'user_profile', None)
    if profile is not None:
        return profile
    auth_header = request.headers.get('Authorization', '')
    token = ''
    if auth_header.startswith('Bearer '):
        token = auth_header[7:].strip()
    if not token:
        token = request.headers.get('X-Auth-Token', '').strip()
    if not token:
        return None
    return UserProfile.objects.select_related('role', 'created_by').filter(
        auth_token=token, is_active=True
    ).first()


def clean_image_value(value, folder, field_label='الصورة'):
    """Uploads an embedded Base64 image to R2 and returns its public URL.

    Raises a DRF 400 when the value is invalid or R2 is not configured, so a
    Base64 payload can never be persisted in PostgreSQL.
    """
    try:
        return normalize_image_field(value, folder, field_label)
    except ValidationError as exc:
        detail = ' '.join(exc.messages) if hasattr(exc, 'messages') else str(exc)
        raise DRFValidationError({'detail': detail})


# ---------------------------------------------------------------------------
# Strict hierarchical rank helpers (see models.py for the rank constants).
# ---------------------------------------------------------------------------
def get_viewer_profile(request):
    return getattr(request, 'user_profile', None)


def is_sudo_profile(profile) -> bool:
    return bool(profile and (profile.is_sudo or profile.username.lower() == 'sudo'))


def get_viewer_rank(request) -> int:
    """رتبة المستخدم الحالي (0 = sudo فقط لحساب الطوارئ)."""
    profile = get_viewer_profile(request)
    if profile is None:
        # No authenticated identity: give the LOWEST privilege, never sudo.
        return RANK_LEVEL_THREE
    if is_sudo_profile(profile):
        return RANK_SUDO
    return coerce_rank_level(profile.rank_level)


def rank_scoped_queryset(queryset, request, field='rank_level'):
    """يقيد الـ queryset بالرتب المرئية للناظر فقط (Strict Less-Than)."""
    return queryset.filter(**{f'{field}__in': visible_rank_levels(get_viewer_rank(request))})


def resolve_rank_for_grant(request, requested=None, default=DEFAULT_RANK_LEVEL):
    """يعيد (rank, error_response).

    رتبتا 2 و3 مُجبرتان على منح الرتبة 3 فقط، بينما sudo/1 يمنحان الرتب
    المسموحة لهما وفق ``grantable_rank_levels``.
    """
    viewer_rank = get_viewer_rank(request)
    if viewer_rank in (RANK_LEVEL_TWO, RANK_LEVEL_THREE):
        return RANK_LEVEL_THREE, None
    allowed = grantable_rank_levels(viewer_rank)
    rank = coerce_rank_level(requested, default=default)
    if rank not in allowed:
        return None, Response(
            {
                'detail': 'لا تملك صلاحية منح هذه الرتبة.',
                'allowed_rank_levels': allowed,
            },
            status=status.HTTP_403_FORBIDDEN,
        )
    return rank, None


def can_manage_target(request, target_rank) -> bool:
    return can_manage_rank(get_viewer_rank(request), target_rank)


def can_edit_employee_salary(request) -> bool:
    """المرتب الشهري لا يُقرأ ولا يُعدَّل إلا بصلاحية الرواتب (أو تصريح عام).

    مطابقة لواجهة canAccessHRSection('payroll') في الفرونت إند:
    sudo أو hr_payroll أو can_manage_hr أو manage_permissions.
    """
    profile = get_viewer_profile(request)
    if profile is None:
        return False
    if is_sudo_profile(profile):
        return True
    return any(profile.has_perm(key) for key in SALARY_PERMISSION_KEYS)


# ---------------------------------------------------------------------------
# Privilege delegation (تفويض الصلاحيات ومنع تصعيد الصلاحيات)
# ---------------------------------------------------------------------------
DELEGATION_DENIED_MESSAGE = 'غير مسموح لك بمنح صلاحيات لا تملك حق تفويضها وتوريثها'


def _truthy_permission_keys(permissions_dict) -> set:
    """مفاتيح الصلاحيات المفعّلة فعلاً داخل قاموس صلاحيات أو قائمة مفاتيح.

    - ``dict``: يتجاهل القيم False/الفارغة.
    - ``list/tuple/set``: يُعد كل عنصر مفتاحاً مفعّلاً (يُستخدم كخط أساس).
    """
    if isinstance(permissions_dict, (list, tuple, set)):
        return {str(key) for key in permissions_dict if key}
    keys = set()
    if not isinstance(permissions_dict, dict):
        return keys
    for key, value in permissions_dict.items():
        if isinstance(value, str):
            if value.strip().lower() in ('view', 'edit', 'true', '1', 'yes'):
                keys.add(str(key))
        elif bool(value):
            keys.add(str(key))
    return keys


def get_allowed_delegatable_keys(profile):
    """الصلاحيات القابلة للتفويض للمدير الحالي (``None`` = sudo، أي كل شيء)."""
    if profile is None:
        return set()
    if is_sudo_profile(profile):
        return None
    allowed = profile.get_effective_delegatable_permissions()
    return set(allowed or ())


def validate_permission_delegation(request, permissions_dict, baseline=None, extra_permissions=None):
    """يمنع منح أي صلاحية لا يملك المدير الحالي حق تفويضها.

    - ``baseline``: الصلاحيات الحالية للهدف؛ المفاتيح التي كانت مفعّلة أصلاً لا
      تُعد منحاً جديداً (لئلا يُمنع مجرد تعديل اسم الدور مثلاً).
    - ``extra_permissions``: صلاحيات إضافية مكتسبة (مثل دور جديد يُعيَّن) تُفحص كلها.

    يُرجع ``Response`` بخطأ 403 عند المخالفة، أو ``None`` عند النجاح.
    """
    allowed = get_allowed_delegatable_keys(get_viewer_profile(request))
    if allowed is None:
        return None
    requested = _truthy_permission_keys(permissions_dict)
    if baseline is not None:
        requested -= _truthy_permission_keys(baseline)
    if extra_permissions:
        requested |= _truthy_permission_keys(extra_permissions)
    forbidden = requested - allowed
    if forbidden:
        return Response(
            {
                'detail': DELEGATION_DENIED_MESSAGE,
                'forbidden_permissions': sorted(forbidden),
            },
            status=status.HTTP_403_FORBIDDEN,
        )
    return None


def sanitize_delegatable_list(request, raw_keys, granted_permissions, baseline=None):
    """يتحقق من قائمة التفويض المطلوبة ويرجع ``(sanitized_list, error_response)``.

    - كل مفتاح جديد يطلبه المدير يجب أن يكون ضمن صلاحياته القابلة للتفويض (وإلا 403).
    - مفاتيح ``baseline`` (المحفوظة مسبقاً) تُقبل كما هي حتى لو منحها مدير أعلى،
      لئلا يمحوها تعديل يقوم به مدير أقل صلاحية.
    - المفاتيح التي لا يملكها الهدف فعلياً تُستبعد تلقائياً.
    """
    if not isinstance(raw_keys, (list, tuple, set)):
        return [], None
    allowed = get_allowed_delegatable_keys(get_viewer_profile(request))
    baseline_keys = set()
    if isinstance(baseline, (list, tuple, set)):
        baseline_keys = {str(key) for key in baseline if key}
    granted = _truthy_permission_keys(granted_permissions)
    result = []
    forbidden = []
    seen = set()
    for key in raw_keys:
        key = str(key)
        if not key or key in seen:
            continue
        seen.add(key)
        if allowed is not None and key not in allowed and key not in baseline_keys:
            forbidden.append(key)
            continue
        if key not in granted:
            continue
        result.append(key)
    if forbidden:
        return [], Response(
            {
                'detail': DELEGATION_DENIED_MESSAGE,
                'forbidden_permissions': sorted(forbidden),
            },
            status=status.HTTP_403_FORBIDDEN,
        )
    return result, None


def effective_permission_keys(profile) -> set:
    """كل الصلاحيات المفعّلة الفعلية للحساب (تخصيص + دور)."""
    if profile is None:
        return set()
    keys = _truthy_permission_keys(getattr(profile, 'custom_permissions', None))
    role = getattr(profile, 'role', None)
    if role is not None:
        keys |= _truthy_permission_keys(role.get_permissions_dict())
    return keys


def collect_created_descendants(user, request=None):
    """كل الحسابات التي أنشأها هذا المستخدم (شجرة متكررة عبر ``created_by``)."""
    descendants = []
    seen = {user.pk}
    frontier = [user.pk]
    while frontier:
        children = list(
            UserProfile.objects.filter(created_by_id__in=frontier)
            .exclude(pk__in=seen)
            .exclude(username__iexact='sudo')
            .exclude(is_sudo=True)
        )
        if not children:
            break
        if request is not None:
            children = [c for c in children if can_manage_target(request, c.rank_level)]
        if not children:
            break
        descendants.extend(children)
        seen.update(child.pk for child in children)
        frontier = [child.pk for child in children]
    return descendants



def hidden_employee_error(request, employee):
    """يرجع استجابة 404 إذا كان الموظف خارج نطاق رؤية الناظر، وإلا None."""
    if employee is not None and not can_manage_target(request, employee.rank_level):
        return Response({'detail': 'الموظف غير موجود'}, status=status.HTTP_404_NOT_FOUND)
    return None


def can_edit_department_prices(profile, perm_key: str) -> bool:
    """
    هل يحق للناظر تعديل/إدخال الأسعار المالية لقسم معيّن؟

    * بلا ملف مستخدم (نداءات داخلية/إدارة) → مسموح (توافقية مع الخدمات القديمة).
    * sudo أو صلاحية ``manage_permissions`` → مسموح.
    * غير ذلك: يشترط امتلاك صلاحية التعديل المستقلة للقسم
      (view_/edit_fabric_prices, edit_printing_prices, edit_sewing_prices,
       edit_assembly_prices, edit_accessory_prices).
    """
    if profile is None:
        return True
    if is_sudo_account(profile):
        return True
    return bool(profile.has_perm(perm_key) or profile.has_perm('manage_permissions'))


def log_price_change(request, section: str, target_name: str, label: str, new_value, old_value=0):
    """
    تسجيل تدقيق صريح لتغيير سعر/تكلفة قسم (لأن السجلات المالية تُنشأ عبر خدمات
    خارج لقطة الموديل، فلا يلتقطها التدقيق التلقائي).

    يتجاهل القيم الصفرية/Sudo بحسب سلوك ``log_action`` المركزي.
    """
    try:
        new_num = float(new_value or 0)
    except (TypeError, ValueError):
        new_num = 0.0
    if new_num <= 0:
        return
    try:
        old_num = float(old_value or 0)
    except (TypeError, ValueError):
        old_num = 0.0
    log_action(
        request,
        section=section,
        action_type='update',
        target_name=str(target_name or ''),
        details=f"{label}: {old_num:g} → {new_num:g}",
        changes=[{
            'field': 'price',
            'label': label,
            'old': old_num,
            'new': new_num,
        }],
    )


def can_view_department_prices(profile, *perm_keys: str) -> bool:
    """نظير ``can_edit_department_prices`` لصلاحيات العرض."""
    if profile is None:
        return True
    if is_sudo_account(profile):
        return True
    return any(profile.has_perm(key) for key in perm_keys)


def read_department_cost_payload(request, profile, perm_key: str, perm_label: str):
    """
    يقرأ سعر القطعة والإجمالي من جسم الطلب مع فرض الحماية على الكتابة.

    * أي محاولة صريحة لإرسال حقل سعر بدون صلاحية تعديل القسم → 403.
    * غير المصرح لهم ولا يرسلون أسعاراً → (0.0, None) ولا تُكتب أي قيمة.
    """
    data = getattr(request, 'data', {}) or {}
    price_keys = (
        'cost_per_piece', 'costPerPiece', 'total_cost', 'totalCost',
        'price_per_unit', 'pricePerUnit',
    )
    can_edit = can_edit_department_prices(profile, perm_key)
    if any(key in data for key in price_keys) and not can_edit:
        raise PermissionDenied(f'ليس لديك صلاحية تعديل {perm_label}')
    if not can_edit:
        return 0.0, None
    cost = data.get('cost_per_piece')
    if cost in (None, ''):
        cost = data.get('costPerPiece') or data.get('price_per_unit') or data.get('pricePerUnit') or 0
    total = data.get('total_cost')
    if total in (None, ''):
        total = data.get('totalCost')
    return cost, total


def _accessory_price_snapshot(accessory_ref):
    """سعر وحدة الإكسسوار الحالي من كتالوج الإكسسوارات (صفر إن لم يوجد)."""
    accessory = resolve_by_id(Accessory, accessory_ref)
    return (accessory.price_per_unit or 0) if accessory else 0


def resolve_workshop_link(data, name=None):
    """
    يحدد سجل الورشة المسجلة لربطه بحركات المطابع/الورش.

    * ``workshop_id`` / ``workshopId`` من الطلب له الأولوية (client_id أو pk).
    * وإلا البحث بالاسم النصي (``name__iexact``) بدون أي تعديل على الاسم النصي المحفوظ.
    * عدم العثور على ورشة مسجلة ليس خطأً: يبقى الحقل NULL وتظل التوافقية كاملة.
    """
    data = data or {}
    raw_id = data.get('workshop_id') or data.get('workshopId')
    if raw_id:
        workshop = resolve_by_id(Workshop, raw_id)
        if workshop:
            return workshop
    clean_name = (name or '').strip()
    if clean_name:
        return Workshop.objects.filter(name__iexact=clean_name).first()
    return None


def resolve_supplier_link(data=None, fallback_id_ref=None, fallback_name=None):
    """يربط الحركة بسجل Supplier عبر المعرّف الممرر أو معرّف/اسم المورد المسجل على الخامة أو الإكسسوار."""
    if isinstance(data, dict):
        explicit_id = data.get('supplier_id') or data.get('supplierId')
        if explicit_id:
            found = resolve_by_id(Supplier, explicit_id)
            if found:
                return found
    if fallback_id_ref:
        found = resolve_by_id(Supplier, fallback_id_ref)
        if found:
            return found
    clean_name = str(fallback_name or '').strip()
    if clean_name:
        return Supplier.objects.filter(name__iexact=clean_name).first()
    return None


class BasePermViewSet(AuditedModelViewSetMixin, viewsets.ModelViewSet):
    """
    Base ViewSet supporting lookup by client_id or database pk, and attaching user_profile to request.
    Every business endpoint requires a valid session token (fails closed).
    Inherits AuditedModelViewSetMixin: every create/update/destroy (and every non-GET
    @action) is written to the enterprise audit log automatically.
    """
    permission_classes = [IsAuthenticatedProfile]

    def get_audit_section(self):
        """
        يفضّل القسم المرسل من الواجهة عبر ترويسة X-Audit-Section حتى يظهر
        تعديل الموديل المنتهي في القسم الذي جرت منه العملية (تصميم/قص/مطابع/...).
        """
        try:
            header_section = (self.request.headers.get('X-Audit-Section') or '').strip()
            # الواجهة ترسل القسم مُرمَّزاً بـ encodeURIComponent لتجنّب رفض fetch
            # للأحرف العربية داخل الترويسات، لذا نفك الترميز قبل حفظه في سجل التدقيق.
            header_section = urllib.parse.unquote(header_section)
        except Exception:
            header_section = ''
        return header_section or super().get_audit_section()

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        # Schema/seed self-healing used to run on EVERY request (expensive). It now
        # runs only on login / state-sync / global-settings, where it is required.
        request.user_profile = resolve_request_user_profile(request)

    def get_object(self):
        queryset = self.filter_queryset(self.get_queryset())
        lookup_url_kwarg = self.lookup_url_kwarg or self.lookup_field
        lookup_val = self.kwargs.get(lookup_url_kwarg)
        if lookup_val is None:
            raise Http404

        s_val = str(lookup_val).strip()
        if hasattr(queryset.model, 'client_id'):
            obj = queryset.filter(client_id=s_val).first()
            if obj:
                self.check_object_permissions(self.request, obj)
                return obj

        if s_val.isdigit():
            obj = queryset.filter(pk=int(s_val)).first()
            if obj:
                self.check_object_permissions(self.request, obj)
                return obj

        raise Http404

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context


class BaseReadOnlyPermViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Read-only ViewSet for immutable ledgers (FabricTransaction, AccessoryTransaction).
    Enforces authentication, client_id/pk lookup, and serializer request context.
    """
    permission_classes = [IsAuthenticatedProfile]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        request.user_profile = resolve_request_user_profile(request)

    def get_object(self):
        queryset = self.filter_queryset(self.get_queryset())
        lookup_url_kwarg = self.lookup_url_kwarg or self.lookup_field
        lookup_val = self.kwargs.get(lookup_url_kwarg)
        if lookup_val is None:
            raise Http404

        s_val = str(lookup_val).strip()
        if hasattr(queryset.model, 'client_id'):
            obj = queryset.filter(client_id=s_val).first()
            if obj:
                self.check_object_permissions(self.request, obj)
                return obj

        if s_val.isdigit():
            obj = queryset.filter(pk=int(s_val)).first()
            if obj:
                self.check_object_permissions(self.request, obj)
                return obj

        raise Http404

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context


def to_decimal(value, default=Decimal('0'), places=3) -> Decimal:
    """Convert numeric input to a quantized Decimal safely."""
    if value in (None, ''):
        return default
    try:
        dec = Decimal(str(value).strip())
    except (InvalidOperation, ValueError, TypeError):
        return default
    if not dec.is_finite():
        return default
    quant = Decimal('1').scaleb(-places)
    return dec.quantize(quant)


