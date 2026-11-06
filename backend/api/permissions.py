from rest_framework import permissions
from .models import UserProfile

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
