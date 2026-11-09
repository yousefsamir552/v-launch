from rest_framework import permissions
from .models import UserProfile, HR_PERM_KEYS

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
        'fabric': 'can_fabric_warehouse',
        'accessories': 'can_accessories_warehouse',
        'production_wh': 'can_production_warehouse',
        'design': 'can_design',
        'cutting': 'can_cutting',
        'printing': 'can_printing',
        'qc': 'can_qc',
        'sewing': 'can_sewing',
        'assembly_packaging': 'can_assembly_packaging',
        'tracking': 'can_models_tracking',
    }

    def has_permission(self, request, view):
        username = request.headers.get('X-User-Username') or getattr(request.user, 'username', 'sudo')
        try:
            profile = UserProfile.objects.select_related('role').get(username=username)
        except UserProfile.DoesNotExist:
            return True

        if profile.is_sudo:
            return True

        required_section = getattr(view, 'required_section', None)
        if not required_section:
            return True

        perm_field = self.section_perm_map.get(required_section, required_section)
        return profile.has_perm(perm_field)


class CanViewFabricPrices(permissions.BasePermission):
    def has_permission(self, request, view):
        profile = getattr(request, 'user_profile', None)
        if not profile:
            return True
        return profile.has_perm('can_view_fabric_prices')


class CanViewAccessoryPrices(permissions.BasePermission):
    def has_permission(self, request, view):
        profile = getattr(request, 'user_profile', None)
        if not profile:
            return True
        return profile.has_perm('can_view_accessory_prices')


class CanViewPrintingCosts(permissions.BasePermission):
    def has_permission(self, request, view):
        profile = getattr(request, 'user_profile', None)
        if not profile:
            return True
        return profile.has_perm('can_view_printing_costs')


class CanSendWhatsApp(permissions.BasePermission):
    def has_permission(self, request, view):
        profile = getattr(request, 'user_profile', None)
        if not profile:
            return True
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
    from Bearer token / X-Auth-Token / X-User-Username, mirroring
    resolve_request_user_profile in views.py.
    """

    def has_permission(self, request, view):
        profile = getattr(request, 'user_profile', None)
        if profile is None:
            profile = self._resolve_profile(request)
        if profile is None:
            # No identifiable user (e.g. internal/CLI calls): stay consistent
            # with the rest of the permission classes and allow through.
            return True

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
            # حتى تعمل شاشات السلف/الجزاءات/مسير المرتبات بشكل صحيح.
            if request.method in permissions.SAFE_METHODS and any(
                profile.has_perm(key) for key in HR_PERM_KEYS
            ):
                return True
            return False

        return any(profile.has_perm(perm_key) for perm_key in HR_PERM_KEYS)

    @staticmethod
    def _resolve_profile(request):
        auth_header = request.headers.get('Authorization', '')
        token = ''
        if auth_header.startswith('Bearer '):
            token = auth_header[7:].strip()
        if not token:
            token = request.headers.get('X-Auth-Token', '').strip()

        if token:
            profile = UserProfile.objects.select_related('role').filter(
                auth_token=token, is_active=True
            ).first()
            if profile:
                return profile

        username = request.headers.get('X-User-Username', '').strip()
        if username:
            return UserProfile.objects.select_related('role').filter(
                username__iexact=username, is_active=True
            ).first()
        return None
