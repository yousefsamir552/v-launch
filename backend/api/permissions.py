from rest_framework import permissions
from .models import UserProfile, HR_PERM_KEYS


def resolve_profile_from_request(request):
    """
    Resolve the authenticated UserProfile from a Bearer token or X-Auth-Token.

    X-User-Username is intentionally NOT trusted here: it is client-controlled and
    using it as an identity source allowed full impersonation (including sudo).
    """
    profile = getattr(request, 'user_profile', None)
    if profile is not None:
        return profile

    token = ''
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        token = auth_header[7:].strip()
    if not token:
        token = request.headers.get('X-Auth-Token', '').strip()
    if not token:
        return None

    return UserProfile.objects.select_related('role').filter(
        auth_token=token, is_active=True
    ).first()


class IsAuthenticatedProfile(permissions.BasePermission):
    """Requires a valid session token (Bearer / X-Auth-Token). Fails closed."""
    message = 'مطلوب تسجيل الدخول للوصول إلى هذه البيانات.'

    def has_permission(self, request, view):
        profile = resolve_profile_from_request(request)
        if profile is None:
            return False
        request.user_profile = profile
        return True

# ---------------------------------------------------------------------------
# Per-tab HR permissions.
# A viewset declares ``required_hr_section = '<key>'`` to demand one specific
# HR permission. Viewsets without it accept ANY of the HR permissions.
# The legacy master permission 'can_manage_hr' (and 'manage_permissions')
# still grants every HR tab for backward compatibility.
# ---------------------------------------------------------------------------
HR_SECTION_PERM_MAP = {
    'jobs': 'hr_jobs',
    'employees': 'hr_employees',
    'attendance': 'hr_attendance',
    'rules': 'hr_rules',
    'loans': 'hr_loans',
    'penalties': 'hr_penalties',
    'payroll': 'hr_payroll',
}

class HasDynamicSectionPermission(permissions.BasePermission):
    """
    Enforces section access dynamically based on UserProfile and assigned Role.
    Sudo bypasses all checks.
    """
    section_perm_map = {
        'fabric': 'fabric_warehouse_view',
        'accessories': 'accessories_warehouse_view',
        'production_wh': 'production_warehouse_view',
        'design': 'design_view',
        'cutting': 'cutting_view',
        'printing': 'printing_view',
        'qc': 'qc_view',
        'sewing': 'sewing_view',
        'assembly_packaging': 'assembly_packaging_view',
        'tracking': 'models_tracking_view',
    }

    def has_permission(self, request, view):
        profile = resolve_profile_from_request(request)
        if profile is None:
            return False
        request.user_profile = profile

        if profile.is_sudo or profile.username.lower() == 'sudo':
            return True

        required_section = getattr(view, 'required_section', None)
        if not required_section:
            return True

        # Both reads and writes require the matching section permission. All
        # cross-section data the UI needs is delivered by /state/ (which applies
        # its own per-section filtering), so a section endpoint must never leak
        # its data to users who cannot open that section.
        perm_field = self.section_perm_map.get(required_section, required_section)
        # صلاحية التعديل تمنح قراءة القسم أيضاً (نفس منطق الواجهة).
        return profile.has_perm(perm_field) or profile.has_perm(
            perm_field.replace('_view', '_edit')
        )


class CanManageCatalog(permissions.BasePermission):
    """
    Shared catalog data (sizes / suppliers / workshops).

    Reads are available to every authenticated user because several screens
    (packaging, warehouses, sewing, print orders) display these lists. Writes
    require the management permission declared by the view in
    ``required_manage_perm`` (or the master 'manage_permissions' permission).
    """

    message = 'ليس لديك صلاحية تعديل بيانات الإعدادات الأساسية.'

    def has_permission(self, request, view):
        profile = resolve_profile_from_request(request)
        if profile is None:
            return False
        request.user_profile = profile

        if profile.is_sudo or profile.username.lower() == 'sudo':
            return True
        if request.method in permissions.SAFE_METHODS:
            return True

        manage_perm = getattr(view, 'required_manage_perm', None)
        if not manage_perm:
            return False
        return profile.has_perm(manage_perm) or profile.has_perm('manage_permissions')


class CanViewFabricPrices(permissions.BasePermission):
    def has_permission(self, request, view):
        profile = resolve_profile_from_request(request)
        if not profile:
            return False
        request.user_profile = profile
        return profile.has_perm('can_view_fabric_prices')


class CanViewAccessoryPrices(permissions.BasePermission):
    def has_permission(self, request, view):
        profile = resolve_profile_from_request(request)
        if not profile:
            return False
        request.user_profile = profile
        return profile.has_perm('can_view_accessory_prices')


class CanViewPrintingCosts(permissions.BasePermission):
    def has_permission(self, request, view):
        profile = resolve_profile_from_request(request)
        if not profile:
            return False
        request.user_profile = profile
        return profile.has_perm('can_view_printing_costs')


class CanSendWhatsApp(permissions.BasePermission):
    def has_permission(self, request, view):
        profile = resolve_profile_from_request(request)
        if not profile:
            return False
        request.user_profile = profile
        return profile.has_perm('can_send_whatsapp')


class CanManageHR(permissions.BasePermission):
    """
    Enforces access to the Human Resources (HR) section.

    * If the view declares ``required_hr_section`` (jobs/employees/attendance/
      rules/loans/penalties/payroll), only that specific permission is accepted.
    * Otherwise ANY of the seven granular HR permissions is accepted.
    * The legacy master permissions 'can_manage_hr' and 'manage_permissions'
      grant every HR tab.

    Sudo users bypass the check (handled by has_perm). The profile is resolved
    from a Bearer token / X-Auth-Token only (never from X-User-Username).
    """

    def has_permission(self, request, view):
        profile = getattr(request, 'user_profile', None)
        if profile is None:
            profile = self._resolve_profile(request)
        if profile is None:
            # Fail closed: never grant HR access to an unauthenticated caller.
            return False

        if profile.is_sudo or profile.username.lower() == 'sudo':
            return True

        # Legacy master permissions grant every HR tab.
        if profile.has_perm('can_manage_hr') or profile.has_perm('manage_permissions'):
            return True

        required_section = getattr(view, 'required_hr_section', None)
        if required_section:
            perm_key = HR_SECTION_PERM_MAP.get(required_section, required_section)
            if profile.has_perm(perm_key):
                return True
            # قراءة البيانات المساندة (وظائف/موظفين/إعدادات) متاحة لأي تبويب HR
            # حتى تعمل شاشات السلف/الجزاءات/المرتبات بشكل صحيح.
            if request.method in permissions.SAFE_METHODS and any(
                profile.has_perm(key) for key in HR_PERM_KEYS
            ):
                return True
            return False

        return any(profile.has_perm(perm_key) for perm_key in HR_PERM_KEYS)

    @staticmethod
    def _resolve_profile(request):
        # Token-only resolution (X-User-Username is never trusted).
        return resolve_profile_from_request(request)
