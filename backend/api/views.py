from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import models, transaction
from django.http import Http404
from django.utils import timezone
from django.utils.dateparse import parse_date
from datetime import date, timedelta
import secrets

from .models import (
    SystemSetting, GlobalSettings, Role, UserProfile, SizeDef, Supplier,
    Fabric, FabricColor, FabricTransaction,
    AccessoryType, Accessory, AccessoryTransaction,
    ModelItem, ModelRequirement, ModelAccessory, ModelTimeline,
    CuttingRecord, CuttingSpreadLayer, QCRecord, PrintDispatch,
    SewingDispatch, AppNotification, InternalMessage, AuditLog,
    COMPOSITION_TO_PARTS, DEFAULT_GARMENT_COMPOSITION,
    PART_TYPE_CHOICES, PART_TYPE_KEYS,
    PackagingRequirement, FinishingRecord, AssemblyStageRecord,
    PACKAGING_STEP_ORDER, ASSEMBLY_STAGE_KEYS,
)
from .serializers import (
    resolve_by_id, get_ext_id,
    GlobalSettingsSerializer, RoleSerializer, UserProfileSerializer, SizeDefSerializer, SupplierSerializer,
    FabricSerializer, FabricColorSerializer, FabricTransactionSerializer,
    AccessoryTypeSerializer, AccessorySerializer, AccessoryTransactionSerializer,
    ModelItemSerializer, ModelRequirementSerializer, ModelAccessorySerializer,
    ModelTimelineSerializer, CuttingRecordSerializer, CuttingSpreadLayerSerializer, QCRecordSerializer,
    PrintDispatchSerializer, SewingDispatchSerializer,
    AppNotificationSerializer, InternalMessageSerializer, AuditLogSerializer,
    PackagingRequirementSerializer, FinishingRecordSerializer, AssemblyStageRecordSerializer
)
from .services import (
    ensure_initial_seed,
    sync_reserved_quantities,
    get_accessory_deficits,
    generate_smart_delivery_notifications,
    generate_assembly_delivery_notifications,
    dispatch_model_to_sewing_service,
    receive_model_from_sewing_service,
    get_or_create_packaging_requirement,
    packaging_requirement_summary,
    set_packaging_step_service,
    start_finishing_service,
    receive_finishing_service,
    start_assembly_stage_service,
    receive_assembly_stage_service,
    normalize_part_key,
    recompute_model_part_totals,
)
from .reports import get_production_report


def resolve_request_user_profile(request):
    """
    Resolves the authenticated UserProfile from Bearer token, X-Auth-Token, or X-User-Username.
    """
    auth_header = request.headers.get('Authorization', '')
    token = ''
    if auth_header.startswith('Bearer '):
        token = auth_header[7:].strip()
    if not token:
        token = request.headers.get('X-Auth-Token', '').strip()

    if token:
        profile = UserProfile.objects.select_related('role').filter(auth_token=token, is_active=True).first()
        if profile:
            return profile

    username = request.headers.get('X-User-Username', '').strip()
    if username:
        return UserProfile.objects.select_related('role').filter(username__iexact=username, is_active=True).first()
    return None


class BasePermViewSet(viewsets.ModelViewSet):
    """
    Base ViewSet supporting lookup by client_id or database pk, and attaching user_profile to request.
    """
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        ensure_initial_seed()
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


class AuthViewSet(viewsets.ViewSet):
    """
    Real backend authentication: login, session verification (me), and logout.
    """
    @action(detail=False, methods=['post'])
    def login(self, request):
        ensure_initial_seed()
        username = (request.data.get('username') or '').strip()
        password = request.data.get('password') or ''

        if not username or not password:
            return Response(
                {'detail': 'يرجى إدخال اسم المستخدم وكلمة المرور'},
                status=status.HTTP_400_BAD_REQUEST
            )

        user = UserProfile.objects.select_related('role').filter(username__iexact=username).first()
        if not user:
            return Response(
                {'detail': 'اسم المستخدم أو كلمة المرور غير صحيحة'},
                status=status.HTTP_401_UNAUTHORIZED
            )

        if not user.is_active and not (user.is_sudo or user.username.lower() == 'sudo'):
            return Response(
                {'detail': 'هذا الحساب موقوف حالياً، يرجى مراجعة إدارة المصنع'},
                status=status.HTTP_403_FORBIDDEN
            )

        if not user.check_password(password):
            return Response(
                {'detail': 'كلمة المرور غير صحيحة'},
                status=status.HTTP_401_UNAUTHORIZED
            )

        if not user.auth_token:
            user.auth_token = secrets.token_hex(32)
        user.last_active = timezone.now()
        user.last_seen = timezone.now()
        user.save(update_fields=['auth_token', 'last_active', 'last_seen'])

        # Do not log sudo emergency account into public audit logs so regular users never know of its existence
        if not user.is_sudo and user.username.lower() != 'sudo':
            AuditLog.objects.create(
                user_id_ref=get_ext_id(user),
                user_name=user.real_name or user.username,
                action='تسجيل دخول',
                details=f"تسجيل دخول ناجح للمستخدم @{user.username}",
                ip_address=request.META.get('REMOTE_ADDR', '127.0.0.1'),
                timestamp=timezone.now().strftime('%Y-%m-%d %H:%M')
            )

        return Response({
            'token': user.auth_token,
            'user': UserProfileSerializer(user).data
        })

    @action(detail=False, methods=['get'])
    def me(self, request):
        ensure_initial_seed()
        user = resolve_request_user_profile(request)
        if not user or (not user.is_active and not user.is_sudo and user.username.lower() != 'sudo'):
            return Response(
                {'detail': 'الجلسة غير صالحة أو تم إيقاف الحساب'},
                status=status.HTTP_401_UNAUTHORIZED
            )
        user.last_active = timezone.now()
        user.last_seen = timezone.now()
        user.save(update_fields=['last_active', 'last_seen'])
        return Response({
            'user': UserProfileSerializer(user).data
        })

    @action(detail=False, methods=['get', 'post'])
    def heartbeat(self, request):
        """Lightweight ONLINE heartbeat + live online users list."""
        user = resolve_request_user_profile(request)
        if user:
            UserProfile.objects.filter(pk=user.pk).update(last_seen=timezone.now())
        visible_users = UserProfile.objects.select_related('role').exclude(
            username__iexact='sudo'
        ).exclude(is_sudo=True)
        online_since = timezone.now() - timedelta(minutes=5)
        online_users = visible_users.filter(last_seen__gte=online_since)
        return Response({
            'onlineUsers': UserProfileSerializer(online_users, many=True).data
        })

    @action(detail=False, methods=['post'])
    def logout(self, request):
        user = resolve_request_user_profile(request)
        if user and not user.is_sudo and user.username.lower() != 'sudo':
            AuditLog.objects.create(
                user_id_ref=get_ext_id(user),
                user_name=user.real_name or user.username,
                action='تسجيل خروج',
                details=f"تسجيل خروج للمستخدم @{user.username}",
                ip_address=request.META.get('REMOTE_ADDR', '127.0.0.1'),
                timestamp=timezone.now().strftime('%Y-%m-%d %H:%M')
            )
        return Response({'status': 'logged_out'})


class StateViewSet(viewsets.ViewSet):
    """
    Returns the complete, live ERP database state in a single atomic request.
    Note: Sudo account is strictly excluded from users list and audit logs (Task 2).
    """
    def list(self, request):
        ensure_initial_seed()
        sync_reserved_quantities()
        req_ctx = {'request': request}

        # Heartbeat: keep the current user's ONLINE marker fresh on every state sync.
        current_profile = resolve_request_user_profile(request)
        if current_profile:
            UserProfile.objects.filter(pk=current_profile.pk).update(last_seen=timezone.now())

        visible_users = UserProfile.objects.select_related('role').exclude(username__iexact='sudo').exclude(is_sudo=True)
        online_since = timezone.now() - timedelta(minutes=5)
        online_users = visible_users.filter(last_seen__gte=online_since)
        visible_logs = AuditLog.objects.exclude(user_id_ref='user-sudo').exclude(user_name__icontains='sudo')[:200]
        visible_messages = InternalMessage.objects.select_related('sender', 'receiver').exclude(
            sender__username__iexact='sudo'
        ).exclude(receiver__username__iexact='sudo')

        return Response({
            'globalSettings': GlobalSettingsSerializer(GlobalSettings.get_solo()).data,
            'roles': RoleSerializer(Role.objects.all(), many=True, context=req_ctx).data,
            'users': UserProfileSerializer(visible_users, many=True, context=req_ctx).data,
            'onlineUsers': UserProfileSerializer(online_users, many=True, context=req_ctx).data,
            'sizeDefs': SizeDefSerializer(SizeDef.objects.all(), many=True).data,
            'suppliers': SupplierSerializer(Supplier.objects.all(), many=True).data,
            'fabrics': FabricSerializer(Fabric.objects.filter(is_deleted=False), many=True, context=req_ctx).data,
            'fabricColors': FabricColorSerializer(FabricColor.objects.select_related('fabric').all(), many=True, context=req_ctx).data,
            'fabricTransactions': FabricTransactionSerializer(FabricTransaction.objects.select_related('color', 'fabric').all()[:300], many=True).data,
            'accessoryTypes': AccessoryTypeSerializer(AccessoryType.objects.all(), many=True).data,
            'accessoryItems': AccessorySerializer(Accessory.objects.all(), many=True, context=req_ctx).data,
            'accessoryTransactions': AccessoryTransactionSerializer(AccessoryTransaction.objects.select_related('accessory').all()[:300], many=True).data,
            'models': ModelItemSerializer(ModelItem.objects.filter(is_deleted=False).prefetch_related('timeline', 'accessories'), many=True, context=req_ctx).data,
            'requirements': ModelRequirementSerializer(ModelRequirement.objects.select_related('model', 'color').all(), many=True).data,
            'accessories': ModelAccessorySerializer(ModelAccessory.objects.select_related('model').all(), many=True).data,
            'cuttingRecords': CuttingRecordSerializer(CuttingRecord.objects.select_related('model').prefetch_related('color_layers').all(), many=True).data,
            'qcRecords': QCRecordSerializer(QCRecord.objects.select_related('model').all(), many=True).data,
            'printDispatches': PrintDispatchSerializer(PrintDispatch.objects.select_related('model').all(), many=True, context=req_ctx).data,
            'sewingDispatches': SewingDispatchSerializer(SewingDispatch.objects.select_related('model').all(), many=True, context=req_ctx).data,
            'packagingRequirements': PackagingRequirementSerializer(PackagingRequirement.objects.select_related('model').all(), many=True).data,
            'finishingRecords': FinishingRecordSerializer(FinishingRecord.objects.select_related('model').all(), many=True).data,
            'assemblyStageRecords': AssemblyStageRecordSerializer(AssemblyStageRecord.objects.select_related('model').all(), many=True).data,
            'internalMessages': InternalMessageSerializer(visible_messages, many=True).data,
            'auditLogs': AuditLogSerializer(visible_logs, many=True).data,
        })


class GlobalSettingsViewSet(viewsets.ViewSet):
    """
    API endpoint for reading and updating Global Site Settings (Task 3).
    Enforces fine-grained permissions:
    - edit_header_settings: for site_name, logo, footer_title, copyright_text
    - edit_message_templates: for whatsapp_supplier_template, default_sewing_instructions, internal_message_templates
    """
    def list(self, request):
        ensure_initial_seed()
        obj = GlobalSettings.get_solo()
        return Response(GlobalSettingsSerializer(obj).data)

    def create(self, request):
        return self._update_settings(request)

    @action(detail=False, methods=['post', 'put', 'patch'])
    def update_settings(self, request):
        return self._update_settings(request)

    def _update_settings(self, request):
        ensure_initial_seed()
        profile = resolve_request_user_profile(request)
        obj = GlobalSettings.get_solo()
        data = request.data

        can_edit_header = True
        can_edit_messages = True
        if profile and not (profile.is_sudo or profile.username.lower() == 'sudo'):
            can_edit_header = profile.has_perm('edit_header_settings') or profile.has_perm('manage_permissions')
            can_edit_messages = profile.has_perm('edit_message_templates') or profile.has_perm('manage_permissions')
            if not can_edit_header and not can_edit_messages:
                return Response(
                    {'detail': 'ليس لديك صلاحية تعديل الإعدادات العامة للموقع'},
                    status=status.HTTP_403_FORBIDDEN
                )

        if can_edit_header:
            if 'site_name' in data and data['site_name'] is not None:
                obj.site_name = str(data['site_name']).strip() or 'نظام إدارة المصنع'
            if 'logo' in data and data['logo'] is not None:
                obj.logo = str(data['logo']).strip() or '🏭'
            if 'footer_title' in data and data['footer_title'] is not None:
                obj.footer_title = str(data['footer_title']).strip()
            if 'copyright_text' in data and data['copyright_text'] is not None:
                obj.copyright_text = str(data['copyright_text']).strip()

        if can_edit_messages:
            if 'whatsapp_supplier_template' in data and data['whatsapp_supplier_template'] is not None:
                obj.whatsapp_supplier_template = str(data['whatsapp_supplier_template'])
            if 'default_sewing_instructions' in data and data['default_sewing_instructions'] is not None:
                obj.default_sewing_instructions = str(data['default_sewing_instructions'])
            if 'internal_message_templates' in data and isinstance(data['internal_message_templates'], list):
                obj.internal_message_templates = data['internal_message_templates']

        if 'favorite_accessory_ids' in data and isinstance(data['favorite_accessory_ids'], list):
            SystemSetting.objects.update_or_create(
                key='favorite_accessory_ids',
                defaults={'value': {'ids': data['favorite_accessory_ids']}}
            )

        if profile and not (profile.is_sudo or profile.username.lower() == 'sudo'):
            obj.updated_by = profile.real_name or profile.username
        elif 'updated_by' in data and data['updated_by']:
            obj.updated_by = str(data['updated_by'])

        obj.save()
        return Response(GlobalSettingsSerializer(obj).data)


class RoleViewSet(BasePermViewSet):
    queryset = Role.objects.all()
    serializer_class = RoleSerializer

    def create(self, request, *args, **kwargs):
        profile = getattr(request, 'user_profile', None)
        if profile and not profile.has_perm('manage_permissions'):
            return Response({'detail': 'ليس لديك صلاحية إدارة الصلاحيات والأدوار'}, status=status.HTTP_403_FORBIDDEN)

        data = request.data
        name = (data.get('name') or '').strip()
        if not name:
            return Response({'detail': 'اسم الدور مطلوب'}, status=status.HTTP_400_BAD_REQUEST)
        role = Role(
            client_id=data.get('id') or data.get('client_id'),
            name=name,
            description=data.get('description') or '',
            permissions_json=data.get('permissions') or {},
        )
        role.save()
        return Response(RoleSerializer(role).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        profile = getattr(request, 'user_profile', None)
        if profile and not profile.has_perm('manage_permissions'):
            return Response({'detail': 'ليس لديك صلاحية إدارة الصلاحيات والأدوار'}, status=status.HTTP_403_FORBIDDEN)

        role = self.get_object()
        data = request.data
        if 'name' in data and data['name']:
            role.name = data['name'].strip()
        if 'description' in data:
            role.description = data['description'] or ''
        if 'permissions' in data and isinstance(data['permissions'], dict):
            role.sync_booleans_from_permissions(data['permissions'])
        role.save()
        # Update cached role_title on non-sudo users assigned to this role
        UserProfile.objects.filter(role=role).exclude(username__iexact='sudo').exclude(is_sudo=True).update(role_title=role.name)
        return Response(RoleSerializer(role).data)

    def destroy(self, request, *args, **kwargs):
        profile = getattr(request, 'user_profile', None)
        if profile and not profile.has_perm('manage_permissions'):
            return Response({'detail': 'ليس لديك صلاحية إدارة الصلاحيات والأدوار'}, status=status.HTTP_403_FORBIDDEN)

        role = self.get_object()
        non_sudo_users = role.users.exclude(username__iexact='sudo').exclude(is_sudo=True)
        if non_sudo_users.exists():
            return Response(
                {'detail': f'لا يمكن حذف هذا الدور لوجود {non_sudo_users.count()} موظف مرتبط به حالياً.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        role.delete()
        return Response({'status': 'deleted'})


class UserProfileViewSet(BasePermViewSet):
    """
    User accounts API.
    Strictly hides the 'sudo' emergency account from all list/retrieve responses
    and blocks any attempt to modify, disable, or delete 'sudo' (Task 2).
    """
    queryset = UserProfile.objects.select_related('role').exclude(username__iexact='sudo').exclude(is_sudo=True)
    serializer_class = UserProfileSerializer

    def _is_targeting_sudo(self, pk_or_id) -> bool:
        if not pk_or_id:
            return False
        s_val = str(pk_or_id).strip().lower()
        if s_val in ('sudo', 'user-sudo'):
            return True
        target = resolve_by_id(UserProfile, pk_or_id)
        if target and (target.is_sudo or target.username.lower() == 'sudo'):
            return True
        return False

    def create(self, request, *args, **kwargs):
        profile = getattr(request, 'user_profile', None)
        if profile and not (profile.has_perm('manage_users') or profile.has_perm('manage_permissions')):
            return Response({'detail': 'ليس لديك صلاحية إضافة أو إدارة المستخدمين'}, status=status.HTTP_403_FORBIDDEN)

        data = request.data
        username = (data.get('username') or '').strip()
        real_name = (data.get('real_name') or username).strip()
        password = data.get('password') or ''

        if not username:
            return Response({'detail': 'اسم المستخدم مطلوب'}, status=status.HTTP_400_BAD_REQUEST)
        if username.lower() == 'sudo':
            return Response({'detail': 'اسم المستخدم هذا محجوز للنظام ولا يمكن استخدامه'}, status=status.HTTP_400_BAD_REQUEST)
        if UserProfile.objects.filter(username__iexact=username).exists():
            return Response({'detail': 'اسم المستخدم مسجل بالفعل'}, status=status.HTTP_400_BAD_REQUEST)

        role_obj = resolve_by_id(Role, data.get('role_id'))
        if not role_obj and data.get('role'):
            role_obj = Role.objects.filter(name=data.get('role')).first()

        user = UserProfile(
            client_id=data.get('id') or data.get('client_id'),
            username=username,
            real_name=real_name,
            phone=data.get('phone') or '',
            role=role_obj,
            role_title=role_obj.name if role_obj else (data.get('role') or 'موظف تشغيل'),
            is_sudo=False,  # Sudo is strictly reserved for the immutable emergency account
            is_active=data.get('is_active', True),
            custom_permissions=data.get('permissions') or data.get('custom_permissions') or {},
        )
        user.set_password(password or '123')
        user.save()
        return Response(UserProfileSerializer(user).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        lookup_val = self.kwargs.get(self.lookup_url_kwarg or self.lookup_field)
        if self._is_targeting_sudo(lookup_val):
            return Response(
                {'detail': 'حساب الطوارئ المطلق غير قابل للتعديل أو سحب الصلاحيات نهائياً'},
                status=status.HTTP_403_FORBIDDEN
            )

        user = self.get_object()
        if user.is_sudo or user.username.lower() == 'sudo':
            return Response(
                {'detail': 'حساب الطوارئ المطلق غير قابل للتعديل أو سحب الصلاحيات نهائياً'},
                status=status.HTTP_403_FORBIDDEN
            )

        data = request.data
        if 'real_name' in data and data['real_name']:
            user.real_name = data['real_name'].strip()
        if 'phone' in data:
            user.phone = data['phone'] or ''
        if 'is_active' in data:
            user.is_active = bool(data['is_active'])
            if not user.is_active:
                user.auth_token = None
        if 'permissions' in data and isinstance(data['permissions'], dict):
            user.custom_permissions = data['permissions']
        elif 'custom_permissions' in data and isinstance(data['custom_permissions'], dict):
            user.custom_permissions = data['custom_permissions']

        if 'role_id' in data or 'role' in data:
            role_obj = resolve_by_id(Role, data.get('role_id'))
            if not role_obj and data.get('role'):
                role_obj = Role.objects.filter(name=data.get('role')).first()
            if role_obj:
                user.role = role_obj
                user.role_title = role_obj.name
            elif data.get('role'):
                user.role_title = data.get('role')

        new_password = data.get('password')
        if new_password:
            user.set_password(new_password)

        user.save()
        return Response(UserProfileSerializer(user).data)

    def destroy(self, request, *args, **kwargs):
        lookup_val = self.kwargs.get(self.lookup_url_kwarg or self.lookup_field)
        if self._is_targeting_sudo(lookup_val):
            return Response(
                {'detail': 'لا يمكن حذف حساب الطوارئ المطلق'},
                status=status.HTTP_403_FORBIDDEN
            )
        user = self.get_object()
        if user.username.lower() == 'sudo' or user.is_sudo:
            return Response(
                {'detail': 'لا يمكن حذف حساب الطوارئ المطلق'},
                status=status.HTTP_403_FORBIDDEN
            )
        user.delete()
        return Response({'status': 'deleted'})

    @action(detail=True, methods=['post'])
    def toggle_active(self, request, pk=None):
        if self._is_targeting_sudo(pk):
            return Response(
                {'detail': 'لا يمكن تعطيل حساب الطوارئ المطلق'},
                status=status.HTTP_403_FORBIDDEN
            )
        user = self.get_object()
        if user.username.lower() == 'sudo' or user.is_sudo:
            return Response(
                {'detail': 'لا يمكن تعطيل حساب الطوارئ المطلق'},
                status=status.HTTP_403_FORBIDDEN
            )
        user.is_active = not user.is_active
        if not user.is_active:
            user.auth_token = None
        user.save()
        return Response(UserProfileSerializer(user).data)


class SizeDefViewSet(BasePermViewSet):
    queryset = SizeDef.objects.all()
    serializer_class = SizeDefSerializer

    def create(self, request, *args, **kwargs):
        data = request.data
        obj = SizeDef.objects.create(
            client_id=data.get('id') or data.get('client_id'),
            name=(data.get('name') or '').strip(),
            values=(data.get('values') or '').strip(),
        )
        return Response(SizeDefSerializer(obj).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        obj = self.get_object()
        data = request.data
        if 'name' in data and data['name']:
            obj.name = str(data['name']).strip()
        if 'values' in data and data['values'] is not None:
            obj.values = str(data['values']).strip()
        obj.save()
        return Response(SizeDefSerializer(obj).data)


class SupplierViewSet(BasePermViewSet):
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer

    def create(self, request, *args, **kwargs):
        data = request.data
        obj = Supplier.objects.create(
            client_id=data.get('id') or data.get('client_id'),
            name=(data.get('name') or '').strip(),
            phone=(data.get('phone') or '').strip(),
        )
        return Response(SupplierSerializer(obj).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        obj = self.get_object()
        data = request.data
        if 'name' in data and data['name']:
            obj.name = str(data['name']).strip()
        if 'phone' in data:
            obj.phone = str(data['phone'] or '').strip()
        obj.save()
        return Response(SupplierSerializer(obj).data)


class FabricViewSet(BasePermViewSet):
    queryset = Fabric.objects.filter(is_deleted=False)
    serializer_class = FabricSerializer

    def create(self, request, *args, **kwargs):
        data = request.data
        fab = Fabric.objects.create(
            client_id=data.get('id') or data.get('client_id'),
            name=(data.get('name') or '').strip(),
            description=data.get('description') or '',
            unit=data.get('unit') or 'كيلو',
            supplier_id_ref=data.get('supplier_id') or '',
            image=data.get('image') or '',
        )
        return Response(FabricSerializer(fab).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'])
    def add_fabric_or_color(self, request):
        data = request.data
        fabric_id = data.get('fabricId') or data.get('fabric_id')
        new_fabric_name = (data.get('newFabricName') or '').strip()
        fab = resolve_by_id(Fabric, fabric_id) if fabric_id else None

        if not fab and new_fabric_name:
            fab = Fabric.objects.create(
                client_id=data.get('newFabricClientId'),
                name=new_fabric_name,
                description='',
                unit=data.get('unit') or 'كيلو',
                supplier_id_ref=data.get('supplierId') or '',
            )

        if not fab:
            return Response({'detail': 'يجب اختيار خامة أو كتابة اسم خامة جديدة'}, status=status.HTTP_400_BAD_REQUEST)

        clean_code = (data.get('colorCode') or data.get('color_code') or '').strip().upper()
        qty = float(data.get('quantity') or 0)
        existing_color = FabricColor.objects.filter(fabric=fab, color_code__iexact=clean_code).first()

        if existing_color:
            existing_color.quantity = round(float(existing_color.quantity or 0) + qty, 2)
            existing_color.save()
            color_obj = existing_color
        else:
            color_obj = FabricColor.objects.create(
                client_id=data.get('colorClientId'),
                fabric=fab,
                color_code=clean_code,
                color_name=data.get('colorName') or '',
                hex_code=data.get('hexCode') or '#64748b',
                price_per_unit=float(data.get('pricePerUnit') or 0),
                quantity=max(0.0, qty),
                reserved_quantity=0.0,
            )

        return Response({
            'fabric': FabricSerializer(fab).data,
            'color': FabricColorSerializer(color_obj).data,
        })


class FabricColorViewSet(BasePermViewSet):
    queryset = FabricColor.objects.select_related('fabric').all()
    serializer_class = FabricColorSerializer

    def update(self, request, *args, **kwargs):
        col = self.get_object()
        data = request.data
        if 'price_per_unit' in data:
            col.price_per_unit = max(0.0, float(data['price_per_unit'] or 0))
        if 'quantity' in data:
            col.quantity = max(0.0, float(data['quantity'] or 0))
        if 'reserved_quantity' in data:
            col.reserved_quantity = max(0.0, float(data['reserved_quantity'] or 0))
        if 'color_name' in data:
            col.color_name = data['color_name']
        if 'hex_code' in data:
            col.hex_code = data['hex_code']
        col.save()
        return Response(FabricColorSerializer(col).data)

    @action(detail=False, methods=['post'])
    def record_transaction(self, request):
        data = request.data
        color_id = data.get('colorId') or data.get('color_id')
        col = resolve_by_id(FabricColor, color_id)
        if not col:
            return Response({'detail': 'اللون غير موجود'}, status=status.HTTP_404_NOT_FOUND)

        op = data.get('operation', 'deduct')
        amount = float(data.get('amount') or 0)
        if amount <= 0:
            return Response({'detail': 'الكمية يجب أن تكون أكبر من صفر'}, status=status.HTTP_400_BAD_REQUEST)
        if op == 'deduct' and col.quantity < amount:
            return Response({'detail': 'الكمية الموجودة بالمخزن لا تكفي للصرف'}, status=status.HTTP_400_BAD_REQUEST)

        if op == 'add':
            col.quantity = round(float(col.quantity or 0) + amount, 2)
        else:
            col.quantity = max(0.0, round(float(col.quantity or 0) - amount, 2))
        col.save()

        tr = FabricTransaction.objects.create(
            client_id=data.get('id') or data.get('client_id'),
            color=col,
            fabric=col.fabric,
            model_code_ref=data.get('modelCodeRef') or '',
            notes=data.get('notes') or '',
            operation=op,
            amount=amount,
            timestamp=data.get('timestamp') or timezone.now().strftime('%Y-%m-%d %H:%M'),
        )
        return Response({
            'color': FabricColorSerializer(col).data,
            'transaction': FabricTransactionSerializer(tr).data,
        })


class FabricTransactionViewSet(BasePermViewSet):
    queryset = FabricTransaction.objects.select_related('color', 'fabric').all()
    serializer_class = FabricTransactionSerializer


class AccessoryTypeViewSet(BasePermViewSet):
    queryset = AccessoryType.objects.all()
    serializer_class = AccessoryTypeSerializer

    def create(self, request, *args, **kwargs):
        data = request.data
        name = (data.get('name') or '').strip()
        existing = AccessoryType.objects.filter(name__iexact=name).first()
        if existing:
            return Response(AccessoryTypeSerializer(existing).data)
        obj = AccessoryType.objects.create(
            client_id=data.get('id') or data.get('client_id'),
            name=name,
            icon=data.get('icon') or 'Sparkles',
            description=data.get('description') or '',
        )
        return Response(AccessoryTypeSerializer(obj).data, status=status.HTTP_201_CREATED)


class AccessoryViewSet(BasePermViewSet):
    queryset = Accessory.objects.all()
    serializer_class = AccessorySerializer

    def create(self, request, *args, **kwargs):
        data = request.data
        usage_type = data.get('usage_type') or 'stock'
        qty = int(float(data.get('quantity', data.get('current_stock', 0)) or 0))
        min_thresh = int(float(data.get('min_threshold', 10) or 0))
        target_qty = int(float(data.get('target_quantity', min_thresh) or 0))
        delivered_qty = int(float(data.get('delivered_quantity', qty) or 0))

        acc = Accessory.objects.create(
            client_id=data.get('id') or data.get('client_id'),
            type_id_ref=data.get('type_id') or 'type-1',
            type_name=data.get('type_name') or 'عام',
            code=(data.get('code') or '').strip().upper(),
            name=(data.get('name') or '').strip(),
            image=data.get('image') or '',
            unit=data.get('unit') or 'قطعة',
            current_stock=max(0, qty),
            reserved_quantity=float(data.get('reserved_quantity') or 0),
            price_per_unit=max(0.0, float(data.get('price_per_unit') or 0)),
            supplier_id_ref=data.get('supplier_id') or '',
            min_threshold=max(0, min_thresh),
            usage_type=usage_type,
            custom_model_code=data.get('custom_model_code') or '',
            target_quantity=target_qty,
            delivered_quantity=delivered_qty,
            withdrawn_for_model=bool(data.get('withdrawn_for_model', False)),
            created_at_str=data.get('created_at') or date.today().isoformat(),
        )
        return Response(AccessorySerializer(acc).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        acc = self.get_object()
        data = request.data
        for field in ['name', 'code', 'image', 'unit', 'usage_type', 'custom_model_code', 'type_name']:
            if field in data:
                setattr(acc, field, data[field])
        if 'type_id' in data:
            acc.type_id_ref = data['type_id']
        if 'supplier_id' in data:
            acc.supplier_id_ref = data['supplier_id']
        if 'quantity' in data:
            acc.current_stock = max(0, int(float(data['quantity'] or 0)))
        elif 'current_stock' in data:
            acc.current_stock = max(0, int(float(data['current_stock'] or 0)))
        if 'reserved_quantity' in data:
            acc.reserved_quantity = max(0.0, float(data['reserved_quantity'] or 0))
        if 'price_per_unit' in data:
            acc.price_per_unit = max(0.0, float(data['price_per_unit'] or 0))
        if 'min_threshold' in data:
            acc.min_threshold = max(0, int(float(data['min_threshold'] or 0)))
        if 'target_quantity' in data:
            acc.target_quantity = max(0, int(float(data['target_quantity'] or 0)))
        if 'delivered_quantity' in data:
            acc.delivered_quantity = max(0, int(float(data['delivered_quantity'] or 0)))
        if 'withdrawn_for_model' in data:
            acc.withdrawn_for_model = bool(data['withdrawn_for_model'])
        acc.save()
        return Response(AccessorySerializer(acc).data)

    @action(detail=False, methods=['post'])
    def record_transaction(self, request):
        data = request.data
        acc_id = data.get('accessoryId') or data.get('accessory_id')
        acc = resolve_by_id(Accessory, acc_id)
        if not acc:
            return Response({'detail': 'الصنف غير موجود'}, status=status.HTTP_404_NOT_FOUND)

        op = data.get('operation', 'deduct')
        amount = float(data.get('amount') or 0)
        if amount <= 0:
            return Response({'detail': 'الكمية يجب أن تكون أكبر من صفر'}, status=status.HTTP_400_BAD_REQUEST)
        if op == 'deduct' and acc.current_stock < amount:
            return Response({'detail': 'الرصيد المتاح لا يكفي للصرف'}, status=status.HTTP_400_BAD_REQUEST)

        if op == 'add':
            acc.current_stock = int(round(float(acc.current_stock or 0) + amount))
            if acc.usage_type == 'custom_model':
                acc.delivered_quantity = int(round(float(acc.delivered_quantity or 0) + amount))
        else:
            acc.current_stock = max(0, int(round(float(acc.current_stock or 0) - amount)))
        acc.save()

        tr = AccessoryTransaction.objects.create(
            client_id=data.get('id') or data.get('client_id'),
            accessory=acc,
            accessory_code=acc.code,
            accessory_name=acc.name,
            operation=op,
            amount=amount,
            model_code_ref=data.get('modelCodeRef') or '',
            notes=data.get('notes') or '',
            timestamp=data.get('timestamp') or timezone.now().strftime('%Y-%m-%d %H:%M'),
        )
        return Response({
            'accessory': AccessorySerializer(acc).data,
            'transaction': AccessoryTransactionSerializer(tr).data,
        })

    @action(detail=False, methods=['get'])
    def alerts(self, request):
        result = get_accessory_deficits()
        return Response(result)

    @action(detail=True, methods=['post'])
    def mark_withdrawn(self, request, pk=None):
        accessory = self.get_object()
        accessory.withdrawn_for_model = True
        accessory.save()
        return Response(AccessorySerializer(accessory).data)


class AccessoryTransactionViewSet(BasePermViewSet):
    queryset = AccessoryTransaction.objects.select_related('accessory').all()
    serializer_class = AccessoryTransactionSerializer


class ModelItemViewSet(BasePermViewSet):
    queryset = ModelItem.objects.filter(is_deleted=False).prefetch_related('timeline', 'accessories')
    serializer_class = ModelItemSerializer

    def create(self, request, *args, **kwargs):
        data = request.data
        clean_code = (data.get('model_code') or data.get('modelCode') or '').strip().upper()
        if not clean_code:
            return Response({'detail': 'كود الموديل مطلوب'}, status=status.HTTP_400_BAD_REQUEST)

        existing = ModelItem.objects.filter(model_code__iexact=clean_code).first()
        if existing and not existing.is_deleted:
            return Response({'detail': 'كود الموديل مستخدم بالفعل!'}, status=status.HTTP_400_BAD_REQUEST)
        elif existing and existing.is_deleted:
            existing.delete()

        profile = getattr(request, 'user_profile', None)
        can_design_notes = True if not profile else profile.has_perm('can_add_design_notes')

        target_qty = int(data.get('target_cut_quantity') or data.get('targetCutQuantity') or 100)
        garment_composition = data.get('garment_composition') or data.get('garmentComposition') or DEFAULT_GARMENT_COMPOSITION
        if garment_composition not in COMPOSITION_TO_PARTS:
            garment_composition = DEFAULT_GARMENT_COMPOSITION
        garment_parts = list(COMPOSITION_TO_PARTS[garment_composition])
        design_notes = (data.get('design_notes') or data.get('designNotes') or '') if can_design_notes else ''
        notes_shirt = (data.get('notes_shirt') or data.get('notesShirt') or '') if can_design_notes else ''
        notes_pants = (data.get('notes_pants') or data.get('notesPants') or '') if can_design_notes else ''
        user_name = data.get('user_name') or (profile.real_name if profile else 'مسؤول التصميم')

        model = ModelItem(
            client_id=data.get('id') or data.get('client_id'),
            model_code=clean_code,
            model_type=data.get('model_type') or data.get('modelType') or 'أولادي',
            size_category_id=data.get('size_category_id') or data.get('sizeCategoryId') or '',
            image=data.get('image') or data.get('imageUrl') or 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500&auto=format&fit=crop&q=60',
            status=data.get('status') or 'مرحلة التصميم',
            target_cut_quantity=target_qty,
            design_notes=design_notes,
            notes_shirt=notes_shirt,
            notes_pants=notes_pants,
            garment_composition=garment_composition,
            garment_parts=garment_parts,
        )
        model._skip_timeline_signal = True
        model.save()

        tl_notes = f"تم إنشاء الموديل بالعدد المستهدف للقص: {target_qty} قطعة"
        if design_notes:
            tl_notes += f" | ملاحظات التصميم: {design_notes}"

        ModelTimeline.objects.create(
            model=model,
            stage='مرحلة التصميم',
            title='إنشاء الموديل الجديد',
            notes=tl_notes,
            user=user_name,
            timestamp_str=timezone.now().strftime('%Y-%m-%d %H:%M'),
            details={
                'phase_type': 'design',
                'model_code': clean_code,
                'model_type': model.model_type,
                'target_cut_quantity': target_qty,
                'design_notes': design_notes,
                'notes_shirt': notes_shirt,
                'notes_pants': notes_pants,
                'operator_name': user_name,
                'worker_notes': design_notes or notes_shirt or notes_pants,
            }
        )
        return Response(ModelItemSerializer(model, context={'request': request}).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        model = self.get_object()
        data = request.data
        profile = getattr(request, 'user_profile', None)
        can_design_notes = True if not profile else profile.has_perm('can_add_design_notes')

        for field in [
            'model_type', 'status', 'size_category_id', 'main_marker_url', 'print_marker_url',
            'target_cut_quantity', 'total_cut_pieces', 'cutter_name', 'spreader_name',
            'count_before_print', 'count_after_print', 'count_after_sewing',
            'print_house', 'image', 'is_deleted', 'colored_at', 'cut_at', 'garment_parts'
        ]:
            if field in data:
                setattr(model, field, data[field])

        if can_design_notes:
            for note_field in ['design_notes', 'notes_shirt', 'notes_pants']:
                if note_field in data:
                    setattr(model, note_field, data[note_field])

        composition_value = data.get('garment_composition', data.get('garmentComposition'))
        if composition_value in COMPOSITION_TO_PARTS:
            model.garment_composition = composition_value
            model.garment_parts = list(COMPOSITION_TO_PARTS[composition_value])

        if 'actual_cut_count' in data:
            model.total_cut_pieces = int(data['actual_cut_count'] or 0)
        model._skip_timeline_signal = True
        model.save()
        if 'garment_parts' in data or 'garment_composition' in data or 'garmentComposition' in data:
            recompute_model_part_totals(model)
        sync_reserved_quantities()
        return Response(ModelItemSerializer(model, context={'request': request}).data)

    def destroy(self, request, *args, **kwargs):
        model = self.get_object()
        model.is_deleted = True
        model._skip_timeline_signal = True
        model.save()
        sync_reserved_quantities()
        return Response({'status': 'deleted'})

    @action(detail=True, methods=['post'])
    def update_plan(self, request, pk=None):
        model = self.get_object()
        data = request.data
        profile = getattr(request, 'user_profile', None)
        can_design_notes = True if not profile else profile.has_perm('can_add_design_notes')

        req_quantities = data.get('reqQuantities') or {}
        acc_quantities = data.get('accQuantities') or {}

        with transaction.atomic():
            for req_id, qty in req_quantities.items():
                req_obj = resolve_by_id(ModelRequirement, req_id)
                if req_obj and req_obj.model_id == model.id:
                    req_obj.planned_quantity = max(0.0, float(qty or 0))
                    req_obj.save()

            for acc_id, qty in acc_quantities.items():
                acc_obj = resolve_by_id(ModelAccessory, acc_id)
                if acc_obj and acc_obj.model_id == model.id:
                    acc_obj.planned_quantity = max(0.0, float(qty or 0))
                    acc_obj.save()

            if 'mainMarkerUrl' in data:
                model.main_marker_url = data['mainMarkerUrl'] or ''
            if 'printMarkerUrl' in data:
                model.print_marker_url = data['printMarkerUrl'] or ''
            if can_design_notes:
                if 'designNotes' in data:
                    model.design_notes = data['designNotes'] or ''
                if 'notesShirt' in data:
                    model.notes_shirt = data['notesShirt'] or ''
                if 'notesPants' in data:
                    model.notes_pants = data['notesPants'] or ''
            if 'targetCutQuantity' in data and data['targetCutQuantity'] is not None:
                model.target_cut_quantity = int(data['targetCutQuantity'])

            model._skip_timeline_signal = True
            model.save()

            # Sync reserved_quantity (deducted from Available for Design only, NOT from actual total stock)
            sync_reserved_quantities()

        return Response(ModelItemSerializer(model, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def issue_fabric_to_cutting(self, request, pk=None):
        model = self.get_object()
        now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
        user_name = request.data.get('user_name') or 'مسؤول التصميم'

        issued_fabrics = []
        issued_accessories = []

        with transaction.atomic():
            # Optional: if reqQuantities or accQuantities were sent in the same payload, apply them first
            req_quantities = request.data.get('reqQuantities') or {}
            acc_quantities = request.data.get('accQuantities') or {}
            for req_id, qty in req_quantities.items():
                req_obj = resolve_by_id(ModelRequirement, req_id)
                if req_obj and req_obj.model_id == model.id:
                    req_obj.planned_quantity = max(0.0, float(qty or 0))
                    req_obj.save()
            for acc_id, qty in acc_quantities.items():
                acc_obj = resolve_by_id(ModelAccessory, acc_id)
                if acc_obj and acc_obj.model_id == model.id:
                    acc_obj.planned_quantity = max(0.0, float(qty or 0))
                    acc_obj.save()

            for req in model.requirements.select_related('color', 'color__fabric').all():
                if req.planned_quantity > 0:
                    col = req.color
                    col.quantity = max(0.0, round(float(col.quantity or 0) - float(req.planned_quantity), 2))
                    col.reserved_quantity = max(0.0, round(float(col.reserved_quantity or 0) - float(req.planned_quantity), 2))
                    col.save()
                    FabricTransaction.objects.create(
                        color=col,
                        fabric=col.fabric,
                        model_code_ref=model.model_code,
                        notes=f"صرف خامات للقص - قطعة: {req.part_name}",
                        operation='deduct',
                        amount=req.planned_quantity,
                        timestamp=now_str,
                    )
                    issued_fabrics.append({
                        'part_name': req.part_name,
                        'fabric_name': col.fabric.name,
                        'color_code': col.color_code,
                        'planned_quantity': req.planned_quantity,
                        'unit': col.fabric.unit,
                    })

            for m_acc in model.accessories.all():
                planned_qty = float(m_acc.planned_quantity or 0)
                if m_acc.accessory_id_ref and planned_qty > 0:
                    acc_item = resolve_by_id(Accessory, m_acc.accessory_id_ref)
                    if acc_item:
                        acc_item.current_stock = max(0, int(round(float(acc_item.current_stock or 0) - planned_qty)))
                        acc_item.reserved_quantity = max(0.0, round(float(acc_item.reserved_quantity or 0) - planned_qty, 2))
                        acc_item.save()
                        AccessoryTransaction.objects.create(
                            accessory=acc_item,
                            accessory_code=acc_item.code,
                            accessory_name=acc_item.name,
                            operation='deduct',
                            amount=planned_qty,
                            model_code_ref=model.model_code,
                            notes=f"صرف إكسسوار للتشغيل والقص ({'بنطلون' if m_acc.target_type == 'pants' else 'تيشرت'}) - موديل: {model.model_code}",
                            timestamp=now_str,
                        )
                issued_accessories.append({
                    'accessory_name': m_acc.accessory_name,
                    'target_type': m_acc.target_type,
                    'planned_quantity': planned_qty,
                    'unit': m_acc.unit,
                })

            model.status = 'في القص'
            model.cut_at = timezone.now().isoformat()
            model._skip_timeline_signal = True
            model.save()

            # Re-sync reserved quantities after moving model to 'في القص'
            sync_reserved_quantities()

            combined_notes = f"تم صرف الأقمشة والإكسسوارات للعدد المستهدف {model.target_cut_quantity} قطعة"
            if model.design_notes:
                combined_notes += f" | ملاحظات التصميم: {model.design_notes}"

            ModelTimeline.objects.create(
                model=model,
                stage='في القص',
                title='صرف الخامات والتحويل لقسم القص',
                notes=combined_notes,
                user=user_name,
                timestamp_str=now_str,
                details={
                    'phase_type': 'design_to_cutting',
                    'target_cut_quantity': model.target_cut_quantity,
                    'main_marker_url': model.main_marker_url,
                    'print_marker_url': model.print_marker_url,
                    'design_notes': model.design_notes or '',
                    'notes_shirt': model.notes_shirt or '',
                    'notes_pants': model.notes_pants or '',
                    'issued_fabrics': issued_fabrics,
                    'issued_accessories': issued_accessories,
                    'operator_name': user_name,
                    'worker_notes': model.design_notes or model.notes_shirt or model.notes_pants,
                }
            )

        return Response(ModelItemSerializer(model, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def finish_cutting(self, request, pk=None):
        model = self.get_object()
        now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
        user_name = request.data.get('user_name') or 'مسؤول القص'
        notes = (request.data.get('notes') or '').strip()
        model.status = 'العد قبل الطباعة'
        model._skip_timeline_signal = True
        model.save()

        spreads_qs = model.cutting_records.prefetch_related('color_layers').all()
        cut_records = CuttingRecordSerializer(spreads_qs, many=True).data
        total_layers = sum(int(r.get('layers_count') or 0) for r in cut_records)

        tl_notes = f"إجمالي الفرشات: {len(cut_records)} | إجمالي القطع المقصوصة: {model.total_cut_pieces or 0} قطعة | إجمالي الراقات: {total_layers}"
        if notes:
            tl_notes += f" | ملاحظات: {notes}"

        ModelTimeline.objects.create(
            model=model,
            stage='العد قبل الطباعة',
            title='إنهاء القص والتحويل للعد قبل الطباعة',
            notes=tl_notes,
            user=user_name,
            timestamp_str=now_str,
            details={
                'phase_type': 'cutting_finished',
                'total_cut_pieces': model.total_cut_pieces or 0,
                'target_cut_quantity': model.target_cut_quantity or 0,
                'total_layers': total_layers,
                'spreads_count': len(cut_records),
                'cutter_name': model.cutter_name or user_name,
                'spreader_name': model.spreader_name or '',
                'cutting_records': cut_records,
                'operator_name': user_name,
                'worker_notes': notes,
            }
        )
        return Response(ModelItemSerializer(model, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def dispatch_to_sewing(self, request, pk=None):
        model = self.get_object()
        profile = getattr(request, 'user_profile', None)
        can_sewing_notes = True if not profile else profile.has_perm('can_add_sewing_notes')

        workshop_name = request.data.get('workshop_name') or request.data.get('workshopName')
        pieces_count = int(request.data.get('pieces_count') or request.data.get('piecesCount') or 0)
        expected_date = request.data.get('expected_delivery_date') or request.data.get('expectedDeliveryDate')
        if expected_date and not isinstance(expected_date, date):
            expected_date = parse_date(str(expected_date)[:10])
        notes = (request.data.get('notes', '') or '') if can_sewing_notes else ''
        user = request.data.get('user') or request.data.get('user_name') or 'مدير الإنتاج'
        piece_type = request.data.get('piece_type') or request.data.get('pieceType') or 'shirt'
        piece_label = request.data.get('piece_label') or request.data.get('pieceLabel')
        client_id = request.data.get('id') or request.data.get('client_id')

        if not workshop_name or not expected_date or pieces_count <= 0:
            return Response(
                {'error': 'اسم الورشة وتاريخ الاستلام المتوقع والقطع المسلمة مطلوبة'},
                status=status.HTTP_400_BAD_REQUEST
            )

        disp = dispatch_model_to_sewing_service(
            get_ext_id(model), workshop_name, pieces_count, expected_date, notes, user, piece_type, piece_label, client_id=client_id
        )
        return Response(SewingDispatchSerializer(disp).data)

    @action(detail=True, methods=['post'])
    def record_qc_count(self, request, pk=None):
        model = self.get_object()
        stage = request.data.get('stage') or 'before_print'
        raw_notes = (request.data.get('notes') or request.data.get('defectNotes') or '').strip()

        profile = getattr(request, 'user_profile', None)
        if profile:
            if stage == 'before_print' and not profile.has_perm('can_add_qc_before_print_notes'):
                raw_notes = ''
            elif stage in ('after_print', 'after_sewing') and not profile.has_perm('can_add_qc_after_print_notes'):
                raw_notes = ''

        notes = raw_notes
        advance_stage = request.data.get('advanceStage', True)
        user = request.data.get('user') or request.data.get('user_name') or 'مراقب الجودة'
        now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
        pieces_cut_ref = model.total_cut_pieces or model.target_cut_quantity or 0
        default_part_type = normalize_part_key(request.data.get('part_type') or request.data.get('partType') or 'shirt')

        matrix_entries = request.data.get('matrix_entries') or request.data.get('matrixEntries')
        saved_records = []

        with transaction.atomic():
            if isinstance(matrix_entries, list) and len(matrix_entries) > 0:
                # Upsert each (color_name, size) cell for this model and stage
                for entry in matrix_entries:
                    c_name = (entry.get('color_name') or entry.get('colorName') or '').strip()
                    sz = (entry.get('size') or '').strip()
                    if not c_name and not sz:
                        continue
                    g_qty = max(0, int(entry.get('good_qty') if entry.get('good_qty') is not None else (entry.get('goodQty') or entry.get('counted_pieces') or 0)))
                    d_qty = max(0, int(entry.get('defect_qty') if entry.get('defect_qty') is not None else (entry.get('defectQty') or entry.get('defect_pieces') or 0)))
                    cell_notes = (entry.get('notes') or entry.get('defect_notes') or notes or '').strip()
                    entry_part = normalize_part_key(
                        entry.get('part_type') or entry.get('partType') or default_part_type
                    )

                    existing_rec = QCRecord.objects.filter(
                        model=model,
                        stage=stage,
                        part_type=entry_part,
                        color_name=c_name,
                        size=sz
                    ).first()

                    if existing_rec:
                        existing_rec.pieces_cut = pieces_cut_ref
                        existing_rec.counted_pieces = g_qty
                        existing_rec.defect_pieces = d_qty
                        existing_rec.notes = cell_notes
                        existing_rec.checked_by = user
                        existing_rec.created_at_str = now_str
                        existing_rec.save()
                        saved_records.append(existing_rec)
                    else:
                        new_rec = QCRecord.objects.create(
                            client_id=entry.get('id') or entry.get('client_id'),
                            model=model,
                            stage=stage,
                            part_type=entry_part,
                            color_name=c_name,
                            size=sz,
                            pieces_cut=pieces_cut_ref,
                            counted_pieces=g_qty,
                            defect_pieces=d_qty,
                            notes=cell_notes,
                            checked_by=user,
                            created_at_str=now_str,
                        )
                        saved_records.append(new_rec)

                # Calculate total counted & defects across all matrix cells in this stage for the model
                stage_qs = QCRecord.objects.filter(model=model, stage=stage)
                counted = sum(int(r.counted_pieces or 0) for r in stage_qs)
                defects = sum(int(r.defect_pieces or 0) for r in stage_qs)
            else:
                counted = int(request.data.get('counted_pieces') or request.data.get('piecesCounted') or 0)
                defects = int(request.data.get('defect_pieces') or request.data.get('defectQty') or 0)
                c_name = (request.data.get('color_name') or request.data.get('colorName') or model.model_type or 'الأساسي').strip()
                sz = (request.data.get('size') or '').strip()
                qc_rec = QCRecord.objects.create(
                    client_id=request.data.get('qc_id'),
                    model=model,
                    stage=stage,
                    part_type=default_part_type,
                    color_name=c_name,
                    size=sz,
                    pieces_cut=pieces_cut_ref,
                    counted_pieces=counted,
                    defect_pieces=defects,
                    notes=notes,
                    checked_by=user,
                    created_at_str=now_str,
                )
                saved_records.append(qc_rec)

            matrix_snapshot = [
                {
                    'part_type': r.part_type or 'shirt',
                    'color_name': r.color_name,
                    'size': r.size,
                    'good_qty': r.counted_pieces,
                    'defect_qty': r.defect_pieces,
                }
                for r in saved_records
            ]

            qc_details = {
                'phase_type': f'qc_{stage}',
                'record_id': get_ext_id(saved_records[0]) if saved_records else '',
                'qc_stage': stage,
                'pieces_cut': pieces_cut_ref,
                'counted_pieces': counted,
                'defect_pieces': defects,
                'deficit': pieces_cut_ref - counted,
                'matrix_entries': matrix_snapshot,
                'inspector_name': user,
                'operator_name': user,
                'worker_notes': notes,
            }

            if stage == 'before_print':
                model.count_before_print = counted
                if advance_stage:
                    model.status = 'جاهز للطباعة / التجميع'
                tl_text = f"مصفوفة الفرز قبل الطباعة — إجمالي السليم: {counted} | إجمالي التالف: {defects} {'-> تحويل للمطابع والتطريز' if advance_stage else ''}"
                if notes:
                    tl_text += f" | ملاحظات: {notes}"
                ModelTimeline.objects.create(
                    model=model,
                    stage="العد قبل الطباعة",
                    title="إتمام العد والفرز قبل الطباعة (جدول الألوان والمقاسات)",
                    notes=tl_text,
                    user=user,
                    timestamp_str=now_str,
                    details=qc_details,
                )
            elif stage == 'after_print':
                model.count_after_print = counted
                if advance_stage:
                    model.status = 'في قسم المكن'
                tl_text = f"مصفوفة الفرز بعد الطباعة — إجمالي السليم: {counted} قطعة | إجمالي التالف: {defects} {'-> تحويل لقسم المكن' if advance_stage else ''}"
                if notes:
                    tl_text += f" | ملاحظات: {notes}"
                ModelTimeline.objects.create(
                    model=model,
                    stage="العد بعد الطباعة",
                    title="إتمام العد والفرز بعد الطباعة (جدول الألوان والمقاسات)",
                    notes=tl_text,
                    user=user,
                    timestamp_str=now_str,
                    details=qc_details,
                )
            elif stage == 'after_sewing':
                model.count_after_sewing = counted
                if advance_stage:
                    model.status = 'مخزن الإنتاج التام'
                tl_text = f"مصفوفة الفحص النهائي بعد المكن — إجمالي السليم: {counted} قطعة | إجمالي التالف: {defects} {'-> تحويل لمخزن الإنتاج التام' if advance_stage else ''}"
                if notes:
                    tl_text += f" | ملاحظات: {notes}"
                ModelTimeline.objects.create(
                    model=model,
                    stage="العد بعد المكن",
                    title="إتمام العد النهائي بعد المكن (جدول الألوان والمقاسات)",
                    notes=tl_text,
                    user=user,
                    timestamp_str=now_str,
                    details=qc_details,
                )

            model._skip_timeline_signal = True
            model.save()
            recompute_model_part_totals(model)

        # Only return the parts touched by this request so the client never duplicates
        # records belonging to the other garment parts.
        affected_parts = {r.part_type for r in saved_records if r.part_type} or {default_part_type}
        all_model_qc = QCRecord.objects.filter(
            model=model, stage=stage, part_type__in=affected_parts
        )
        return Response({
            'model': ModelItemSerializer(model, context={'request': request}).data,
            'qcRecord': QCRecordSerializer(saved_records[0]).data if saved_records else None,
            'qcRecords': QCRecordSerializer(all_model_qc, many=True).data,
        })

    @action(detail=True, methods=['post'])
    def finish_qc_approval(self, request, pk=None):
        model = self.get_object()
        now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
        user_name = request.data.get('user_name') or 'مراقب الجودة'
        model.status = 'جاهز للطباعة / التجميع'
        model._skip_timeline_signal = True
        model.save()
        ModelTimeline.objects.create(
            model=model,
            stage='المطابع والتطريز',
            title='الاعتماد وجاهزية الإرسال للمطابع',
            notes='تم اعتماد نتائج الفرز وأصبح الموديل جاهزاً للتسليم للمطابع',
            user=user_name,
            timestamp_str=now_str,
            details={
                'phase_type': 'qc_approved',
                'count_before_print': model.count_before_print or model.total_cut_pieces or 0,
                'operator_name': user_name,
            }
        )
        return Response(ModelItemSerializer(model, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def finish_sewing(self, request, pk=None):
        model = self.get_object()
        now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
        notes = request.data.get('notes') or ''
        user_name = request.data.get('user') or request.data.get('user_name') or 'مسؤول قسم المكن'
        model.status = 'العد بعد المكن'
        model._skip_timeline_signal = True
        model.save()
        ModelTimeline.objects.create(
            model=model,
            stage="العد بعد المكن",
            title="إتمام مرحلة الخياطة والمكن",
            notes=f"تم إنهاء الخياطة وتوجيه الموديل للعد النهائي بعد المكن. {notes}",
            user=user_name,
            timestamp_str=now_str,
            details={
                'phase_type': 'sewing_finished',
                'sewing_workshop': model.sewing_workshop or '',
                'sewing_pieces_count': model.sewing_pieces_count or 0,
                'operator_name': user_name,
                'worker_notes': notes,
            }
        )
        return Response(ModelItemSerializer(model, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def finish_qc_to_production(self, request, pk=None):
        model = self.get_object()
        now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
        notes = request.data.get('notes') or ''
        user_name = request.data.get('user_name') or 'مراقب الجودة'
        model.status = 'مخزن الإنتاج التام'
        model._skip_timeline_signal = True
        model.save()
        ModelTimeline.objects.create(
            model=model,
            stage='مخزن الإنتاج التام',
            title='الاعتماد النهائي ودخول مخزن الإنتاج التام',
            notes=f"تم الفحص النهائي بنجاح ودخول البضاعة الجاهزة إلى مخزن الإنتاج. {notes}",
            user=user_name,
            timestamp_str=now_str,
            details={
                'phase_type': 'production_warehouse',
                'count_after_sewing': model.count_after_sewing or 0,
                'operator_name': user_name,
                'worker_notes': notes,
            }
        )
        return Response(ModelItemSerializer(model, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def receive_from_print(self, request, pk=None):
        model = self.get_object()
        now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
        user_name = request.data.get('user') or 'أمين المخزن'
        model.status = 'العد بعد الطباعة'
        model._skip_timeline_signal = True
        model.save()
        ModelTimeline.objects.create(
            model=model,
            stage="استلام من المطبعة",
            title="استلام الموديل من المطبعة",
            notes=f"تم استلام الموديل من مطبعة {model.print_house} وتوجيهه للعد بعد الطباعة",
            user=user_name,
            timestamp_str=now_str,
            details={
                'phase_type': 'printing_receive',
                'print_house': model.print_house or '',
                'operator_name': user_name,
            }
        )
        return Response(ModelItemSerializer(model, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def add_timeline(self, request, pk=None):
        model = self.get_object()
        data = request.data
        tl = ModelTimeline.objects.create(
            client_id=data.get('id'),
            model=model,
            stage=data.get('stage') or model.status,
            title=data.get('title') or data.get('stage') or '',
            notes=data.get('description') or data.get('notes') or '',
            user=data.get('user_name') or data.get('user') or 'النظام',
            timestamp_str=data.get('timestamp') or timezone.now().strftime('%Y-%m-%d %H:%M'),
            details=data.get('details') if isinstance(data.get('details'), dict) else {},
        )
        return Response(ModelTimelineSerializer(tl).data, status=status.HTTP_201_CREATED)

    # ------------------------------------------------------------------
    # Assembly & Packaging (الأسمبلي والأمبالاج)
    # ------------------------------------------------------------------

    @action(detail=True, methods=['get'])
    def packaging_requirement(self, request, pk=None):
        """Returns (creating lazily) the packaging requirement record of the model."""
        model = self.get_object()
        requirement = get_or_create_packaging_requirement(model)
        return Response({
            'packagingRequirement': PackagingRequirementSerializer(requirement).data,
            'readiness': packaging_requirement_summary(model),
        })

    @action(detail=True, methods=['post'])
    def set_packaging_step(self, request, pk=None):
        """Sets one of the four packaging requirement dates (photo / cards)."""
        model = self.get_object()
        data = request.data or {}
        step = str(data.get('step') or '').strip()
        step_date = data.get('date') or data.get('step_date') or data.get('stepDate')
        notes = data.get('notes') or ''
        user_name = data.get('user_name') or data.get('user') or 'مسؤول الأمبالاج'
        try:
            requirement = set_packaging_step_service(
                model, step, step_date=step_date, notes=notes, user_name=user_name
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({
            'model': ModelItemSerializer(model, context={'request': request}).data,
            'packagingRequirement': PackagingRequirementSerializer(requirement).data,
            'readiness': packaging_requirement_summary(model),
        })

    @action(detail=True, methods=['post'])
    def start_finishing(self, request, pk=None):
        """Starts the finishing stage for the requested model parts."""
        model = self.get_object()
        data = request.data or {}
        parts = data.get('parts')
        if isinstance(parts, str):
            parts = [parts]
        if not isinstance(parts, list):
            parts = None
        try:
            records = start_finishing_service(
                model,
                parts=parts,
                entry_date=data.get('entry_date') or data.get('entryDate'),
                expected_exit_date=data.get('expected_exit_date') or data.get('expectedExitDate'),
                notes=data.get('notes') or '',
                user_name=data.get('user_name') or data.get('user') or 'مسؤول التشطيب',
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({
            'model': ModelItemSerializer(model, context={'request': request}).data,
            'finishingRecords': FinishingRecordSerializer(records, many=True).data,
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def receive_finishing(self, request, pk=None):
        """Receives one part from finishing; promotes the model when all parts are in."""
        model = self.get_object()
        data = request.data or {}
        record_id = data.get('record_id') or data.get('recordId')
        if not record_id:
            return Response({'detail': 'معرف سجل التشطيب مطلوب'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            record = receive_finishing_service(
                record_id,
                actual_exit_date=data.get('actual_exit_date') or data.get('actualExitDate'),
                notes=data.get('notes') or '',
                user_name=data.get('user_name') or data.get('user') or 'مسؤول التشطيب',
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        model.refresh_from_db()
        return Response({
            'model': ModelItemSerializer(model, context={'request': request}).data,
            'finishingRecord': FinishingRecordSerializer(record).data,
            'finishingRecords': FinishingRecordSerializer(
                FinishingRecord.objects.filter(model=model).order_by('part_type'), many=True
            ).data,
        })

    @action(detail=True, methods=['post'])
    def start_assembly_stage(self, request, pk=None):
        """Starts one assembly stage: ironing / packaging / dest."""
        model = self.get_object()
        data = request.data or {}
        stage = str(data.get('stage') or '').strip()
        if stage not in ASSEMBLY_STAGE_KEYS:
            return Response(
                {'detail': 'مرحلة الأسمبلي غير معروفة (المتاح: ironing / packaging / dest)'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            record = start_assembly_stage_service(
                model,
                stage,
                entry_date=data.get('entry_date') or data.get('entryDate'),
                expected_exit_date=data.get('expected_exit_date') or data.get('expectedExitDate'),
                notes=data.get('notes') or '',
                user_name=data.get('user_name') or data.get('user') or 'مسؤول الأسمبلي',
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({
            'model': ModelItemSerializer(model, context={'request': request}).data,
            'assemblyStageRecord': AssemblyStageRecordSerializer(record).data,
            'readiness': packaging_requirement_summary(model),
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def receive_assembly_stage(self, request, pk=None):
        """Completes one assembly stage record and moves the model to the next stage."""
        model = self.get_object()
        data = request.data or {}
        record_id = data.get('record_id') or data.get('recordId')
        if not record_id:
            return Response({'detail': 'معرف سجل المرحلة مطلوب'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            record = receive_assembly_stage_service(
                record_id,
                actual_exit_date=data.get('actual_exit_date') or data.get('actualExitDate'),
                notes=data.get('notes') or '',
                user_name=data.get('user_name') or data.get('user') or 'مسؤول الأسمبلي',
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        model.refresh_from_db()
        return Response({
            'model': ModelItemSerializer(model, context={'request': request}).data,
            'assemblyStageRecord': AssemblyStageRecordSerializer(record).data,
            'assemblyStageRecords': AssemblyStageRecordSerializer(
                AssemblyStageRecord.objects.filter(model=model).order_by('stage'), many=True
            ).data,
        })


class ModelRequirementViewSet(BasePermViewSet):
    queryset = ModelRequirement.objects.select_related('model', 'color').all()
    serializer_class = ModelRequirementSerializer

    def create(self, request, *args, **kwargs):
        data = request.data
        model = resolve_by_id(ModelItem, data.get('model_id') or data.get('modelId'))
        color = resolve_by_id(FabricColor, data.get('color_id') or data.get('colorId'))
        if not model or not color:
            return Response({'detail': 'الموديل أو اللون غير موجود'}, status=status.HTTP_400_BAD_REQUEST)
        req = ModelRequirement.objects.create(
            client_id=data.get('id') or data.get('client_id'),
            model=model,
            color=color,
            part_name=(data.get('part_name') or data.get('partName') or '').strip(),
            planned_quantity=max(0.0, float(data.get('planned_quantity') or data.get('plannedQuantity') or 0)),
        )
        sync_reserved_quantities()
        return Response(ModelRequirementSerializer(req).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        req = self.get_object()
        data = request.data
        if 'part_name' in data or 'partName' in data:
            req.part_name = (data.get('part_name') or data.get('partName') or req.part_name).strip()
        if 'planned_quantity' in data or 'plannedQuantity' in data:
            req.planned_quantity = max(0.0, float(data.get('planned_quantity') or data.get('plannedQuantity') or 0))
        req.save()
        sync_reserved_quantities()
        return Response(ModelRequirementSerializer(req).data)

    def destroy(self, request, *args, **kwargs):
        req = self.get_object()
        req.delete()
        sync_reserved_quantities()
        return Response({'status': 'deleted'})


class ModelAccessoryViewSet(BasePermViewSet):
    queryset = ModelAccessory.objects.select_related('model').all()
    serializer_class = ModelAccessorySerializer

    def create(self, request, *args, **kwargs):
        data = request.data
        model = resolve_by_id(ModelItem, data.get('model_id') or data.get('modelId'))
        if not model:
            return Response({'detail': 'الموديل غير موجود'}, status=status.HTTP_400_BAD_REQUEST)
        m_acc = ModelAccessory.objects.create(
            client_id=data.get('id') or data.get('client_id'),
            model=model,
            accessory_id_ref=data.get('accessory_id') or None,
            accessory_code=data.get('accessory_code') or '',
            accessory_name=(data.get('accessory_name') or data.get('name') or '').strip(),
            target_type=data.get('target_type') or 'shirt',
            piece_consumption=float(data.get('piece_consumption') or 1),
            planned_quantity=max(0.0, float(data.get('planned_quantity') or 0)),
            unit=data.get('unit') or 'قطعة',
            image=data.get('image') or '',
        )
        sync_reserved_quantities()
        return Response(ModelAccessorySerializer(m_acc).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        m_acc = self.get_object()
        data = request.data
        if 'planned_quantity' in data:
            m_acc.planned_quantity = max(0.0, float(data.get('planned_quantity') or 0))
        if 'piece_consumption' in data:
            m_acc.piece_consumption = max(0.0, float(data.get('piece_consumption') or 1))
        if 'target_type' in data:
            m_acc.target_type = data.get('target_type') or 'shirt'
        m_acc.save()
        sync_reserved_quantities()
        return Response(ModelAccessorySerializer(m_acc).data)

    def destroy(self, request, *args, **kwargs):
        m_acc = self.get_object()
        m_acc.delete()
        sync_reserved_quantities()
        return Response({'status': 'deleted'})


class CuttingRecordViewSet(BasePermViewSet):
    queryset = CuttingRecord.objects.select_related('model').prefetch_related('color_layers').all()
    serializer_class = CuttingRecordSerializer

    def create(self, request, *args, **kwargs):
        data = request.data
        model = resolve_by_id(ModelItem, data.get('model_id') or data.get('modelId'))
        if not model:
            return Response({'detail': 'الموديل غير موجود'}, status=status.HTTP_400_BAD_REQUEST)

        profile = getattr(request, 'user_profile', None)
        can_cutting_notes = True if not profile else profile.has_perm('can_add_cutting_notes')

        spreader = (data.get('spreader_name') or data.get('spreaderName') or '').strip()
        cutter = (data.get('cutter_name') or data.get('cutterName') or '').strip()
        raw_layers = data.get('color_layers') or data.get('colorLayers') or []

        # Calculate spread number automatically if not passed
        existing_spreads_count = CuttingRecord.objects.filter(model=model).count()
        spread_num = int(data.get('spread_number') or data.get('spreadNumber') or (existing_spreads_count + 1))

        # Aggregate layers and build color summary from color_layers
        parsed_layers = []
        if isinstance(raw_layers, list) and len(raw_layers) > 0:
            for item in raw_layers:
                c_name = (item.get('color_name') or item.get('colorName') or '').strip()
                l_count = max(0, int(item.get('layers_count') or item.get('layersCount') or 0))
                l_weight = max(0.0, float(item.get('layer_weight') or item.get('layerWeight') or 0))
                l_pieces = max(0, int(item.get('pieces_count') or item.get('piecesCount') or 0))
                l_shade = (item.get('shade_degree') or item.get('shadeDegree') or '').strip()
                l_notes = (item.get('notes') or '').strip()
                if c_name and l_count > 0:
                    parsed_layers.append({
                        'id': item.get('id') or item.get('client_id'),
                        'color_name': c_name,
                        'layers_count': l_count,
                        'layer_weight': l_weight,
                        'pieces_count': l_pieces,
                        'shade_degree': l_shade,
                        'notes': l_notes,
                    })

        total_layers_from_items = sum(item['layers_count'] for item in parsed_layers)

        layers = max(0, int(data.get('layers_count') or data.get('layersCount') or total_layers_from_items or 0))
        pieces_per_layer = max(0, int(data.get('pieces_per_layer') or data.get('piecesPerLayer') or 0))
        weight = max(0.0, float(data.get('layer_weight') or data.get('layerWeight') or 0))

        # Automatically calculate cut pieces = layers * pieces_per_layer (fallback to pieces_count if legacy)
        if pieces_per_layer > 0 and layers > 0:
            pieces = layers * pieces_per_layer
        else:
            pieces = max(0, int(data.get('pieces_count') or data.get('piecesCount') or 0))

        if parsed_layers:
            color_name = ' + '.join(f"{item['color_name']} ({item['layers_count']} راق)" for item in parsed_layers)
        else:
            color_name = (data.get('color_name') or data.get('colorName') or data.get('fabric_color') or '').strip()

        shade = (data.get('shade_degree') or data.get('shadeDegree') or '').strip()
        notes = (data.get('notes') or '').strip() if can_cutting_notes else ''
        now_str = data.get('created_at') or timezone.now().strftime('%Y-%m-%d %H:%M')
        part_type = normalize_part_key(data.get('part_type') or data.get('partType') or 'shirt')

        with transaction.atomic():
            rec = CuttingRecord.objects.create(
                client_id=data.get('id') or data.get('client_id'),
                model=model,
                spread_number=spread_num,
                part_type=part_type,
                spreader_name=spreader,
                cutter_name=cutter,
                fabric_color=color_name,
                layers_count=layers,
                pieces_per_layer=pieces_per_layer,
                layer_weight=weight,
                pieces_count=pieces,
                shade_degree=shade,
                notes=notes,
                created_at_str=now_str,
            )

            for item in parsed_layers:
                item_pcs = item['layers_count'] * pieces_per_layer if pieces_per_layer > 0 else item['pieces_count']
                CuttingSpreadLayer.objects.create(
                    client_id=item.get('id'),
                    spread=rec,
                    color_name=item['color_name'],
                    layers_count=item['layers_count'],
                    layer_weight=weight,
                    pieces_count=item_pcs,
                    shade_degree=item['shade_degree'],
                    notes=item['notes'],
                )

            if cutter:
                model.cutter_name = cutter
            if spreader:
                model.spreader_name = spreader
            model._skip_timeline_signal = True
            model.save()
            # Recompute per-part totals from the records (never blindly sum parts together)
            recompute_model_part_totals(model)

            tl_notes = f"فرشة رقم #{spread_num} | الفَرّاش: {spreader or '-'} | المقصدار: {cutter or '-'} | الألوان والراقات: {color_name} | إجمالي الراقات: {layers} | عدد القطع في الراق: {pieces_per_layer} | إجمالي وزن الراق: {weight} كجم | القطع المقصوصة: {pieces}"
            if shade:
                tl_notes += f" | درجة الصبغة: {shade}"
            if notes:
                tl_notes += f" | ملاحظات: {notes}"

            ModelTimeline.objects.create(
                model=model,
                stage='في القص',
                title=f"تسجيل فرشة قص #{spread_num} ({pieces} قطعة)",
                notes=tl_notes,
                user=cutter or spreader or 'مسؤول القص',
                timestamp_str=now_str,
                details={
                    'phase_type': 'cutting',
                    'record_id': get_ext_id(rec),
                    'spread_number': spread_num,
                    'spreader_name': spreader,
                    'cutter_name': cutter,
                    'color_name': color_name,
                    'color_layers': parsed_layers,
                    'layers_count': layers,
                    'pieces_per_layer': pieces_per_layer,
                    'layer_weight': weight,
                    'pieces_count': pieces,
                    'total_cut_pieces_so_far': model.total_cut_pieces,
                    'shade_degree': shade,
                    'worker_notes': notes,
                    'operator_name': cutter or spreader,
                }
            )

        rec_refreshed = CuttingRecord.objects.select_related('model').prefetch_related('color_layers').get(pk=rec.pk)
        return Response(CuttingRecordSerializer(rec_refreshed).data, status=status.HTTP_201_CREATED)


class QCRecordViewSet(BasePermViewSet):
    queryset = QCRecord.objects.select_related('model').all()
    serializer_class = QCRecordSerializer

    def create(self, request, *args, **kwargs):
        data = request.data
        model = resolve_by_id(ModelItem, data.get('model_id') or data.get('modelId'))
        if not model:
            return Response({'detail': 'الموديل غير موجود'}, status=status.HTTP_400_BAD_REQUEST)

        stage = data.get('stage') or 'before_print'
        raw_notes = (data.get('defect_notes') or data.get('defectNotes') or data.get('notes') or '').strip()

        profile = getattr(request, 'user_profile', None)
        if profile:
            if stage == 'before_print' and not profile.has_perm('can_add_qc_before_print_notes'):
                raw_notes = ''
            elif stage in ('after_print', 'after_sewing') and not profile.has_perm('can_add_qc_after_print_notes'):
                raw_notes = ''

        good_qty = max(0, int(data.get('good_qty') if data.get('good_qty') is not None else (data.get('goodQty') or data.get('counted_pieces') or 0)))
        defect_qty = max(0, int(data.get('defect_qty') if data.get('defect_qty') is not None else (data.get('defectQty') or data.get('defect_pieces') or 0)))
        inspector = data.get('inspector_name') or 'مراقب الجودة'
        now_str = data.get('created_at') or timezone.now().strftime('%Y-%m-%d %H:%M')
        color_name = (data.get('color_name') or data.get('colorName') or '').strip()
        size_val = (data.get('size') or '').strip()
        part_type = normalize_part_key(data.get('part_type') or data.get('partType') or 'shirt')
        pieces_cut_ref = int(data.get('pieces_cut') or model.total_cut_pieces or 0)

        with transaction.atomic():
            # Upsert if same model + part + stage + color_name + size exists
            existing = None
            if color_name or size_val:
                existing = QCRecord.objects.filter(
                    model=model,
                    stage=stage,
                    part_type=part_type,
                    color_name=color_name,
                    size=size_val
                ).first()

            if existing:
                existing.pieces_cut = pieces_cut_ref
                existing.counted_pieces = good_qty
                existing.defect_pieces = defect_qty
                existing.notes = raw_notes
                existing.checked_by = inspector
                existing.created_at_str = now_str
                existing.save()
                rec = existing
            else:
                rec = QCRecord.objects.create(
                    client_id=data.get('id') or data.get('client_id'),
                    model=model,
                    stage=stage,
                    part_type=part_type,
                    color_name=color_name,
                    size=size_val,
                    pieces_cut=pieces_cut_ref,
                    counted_pieces=good_qty,
                    defect_pieces=defect_qty,
                    notes=raw_notes,
                    checked_by=inspector,
                    created_at_str=now_str,
                )

            # Recompute per-part + aggregate stage counts from the records
            model._skip_timeline_signal = True
            model.save()
            recompute_model_part_totals(model)

        return Response(QCRecordSerializer(rec).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'])
    def save_matrix(self, request):
        """
        Bulk save/upsert QC matrix records (Color x Size) for a given model and stage.
        """
        data = request.data
        model = resolve_by_id(ModelItem, data.get('model_id') or data.get('modelId'))
        if not model:
            return Response({'detail': 'الموديل غير موجود'}, status=status.HTTP_400_BAD_REQUEST)

        stage = data.get('stage') or 'before_print'
        entries = data.get('matrix_entries') or data.get('matrixEntries') or []
        raw_notes = (data.get('notes') or data.get('defectNotes') or '').strip()

        profile = getattr(request, 'user_profile', None)
        if profile:
            if stage == 'before_print' and not profile.has_perm('can_add_qc_before_print_notes'):
                raw_notes = ''
            elif stage in ('after_print', 'after_sewing') and not profile.has_perm('can_add_qc_after_print_notes'):
                raw_notes = ''

        inspector = data.get('inspector_name') or data.get('user_name') or 'مراقب الجودة'
        now_str = data.get('created_at') or timezone.now().strftime('%Y-%m-%d %H:%M')
        pieces_cut_ref = int(model.total_cut_pieces or model.target_cut_quantity or 0)

        default_part_type = normalize_part_key(data.get('part_type') or data.get('partType') or 'shirt')

        saved_list = []
        with transaction.atomic():
            for entry in entries:
                c_name = (entry.get('color_name') or entry.get('colorName') or '').strip()
                sz = (entry.get('size') or '').strip()
                if not c_name and not sz:
                    continue
                entry_part = normalize_part_key(
                    entry.get('part_type') or entry.get('partType') or default_part_type
                )
                g_qty = max(0, int(entry.get('good_qty') if entry.get('good_qty') is not None else (entry.get('goodQty') or entry.get('counted_pieces') or 0)))
                d_qty = max(0, int(entry.get('defect_qty') if entry.get('defect_qty') is not None else (entry.get('defectQty') or entry.get('defect_pieces') or 0)))
                cell_notes = (entry.get('notes') or entry.get('defect_notes') or raw_notes or '').strip()

                existing = QCRecord.objects.filter(
                    model=model,
                    stage=stage,
                    part_type=entry_part,
                    color_name=c_name,
                    size=sz
                ).first()

                if existing:
                    existing.pieces_cut = pieces_cut_ref
                    existing.counted_pieces = g_qty
                    existing.defect_pieces = d_qty
                    existing.notes = cell_notes
                    existing.checked_by = inspector
                    existing.created_at_str = now_str
                    existing.save()
                    saved_list.append(existing)
                else:
                    new_rec = QCRecord.objects.create(
                        client_id=entry.get('id') or entry.get('client_id'),
                        model=model,
                        stage=stage,
                        part_type=entry_part,
                        color_name=c_name,
                        size=sz,
                        pieces_cut=pieces_cut_ref,
                        counted_pieces=g_qty,
                        defect_pieces=d_qty,
                        notes=cell_notes,
                        checked_by=inspector,
                        created_at_str=now_str,
                    )
                    saved_list.append(new_rec)

            # Recompute per-part + aggregate stage counts from the records
            model._skip_timeline_signal = True
            model.save()
            recompute_model_part_totals(model)

        return Response({
            'model': ModelItemSerializer(model, context={'request': request}).data,
            'qcRecords': QCRecordSerializer(saved_list, many=True).data,
        })


class PrintDispatchViewSet(BasePermViewSet):
    queryset = PrintDispatch.objects.select_related('model').all()
    serializer_class = PrintDispatchSerializer

    def create(self, request, *args, **kwargs):
        data = request.data
        model = resolve_by_id(ModelItem, data.get('model_id') or data.get('modelId'))
        if not model:
            return Response({'detail': 'الموديل غير موجود'}, status=status.HTTP_400_BAD_REQUEST)

        profile = getattr(request, 'user_profile', None)
        can_printing_notes = True if not profile else (profile.has_perm('can_add_printing_notes') or profile.has_perm('can_add_qc_before_print_notes'))

        shop_name = (data.get('shop_name') or data.get('shopName') or data.get('print_house') or '').strip()
        pieces = max(0, int(data.get('pieces_count') or data.get('piecesCount') or 0))
        print_type = (data.get('print_type') or data.get('printType') or 'سلك سكرين مائي').strip()
        piece_type = (data.get('piece_type') or data.get('pieceType') or 'shirt').strip() or 'shirt'
        if piece_type not in PART_TYPE_KEYS:
            piece_type = 'shirt'
        piece_label = (data.get('piece_label') or data.get('pieceLabel') or '').strip() or dict(PART_TYPE_CHOICES).get(piece_type, '')
        print_location = (data.get('print_location') or data.get('printLocation') or '').strip()
        print_details = (data.get('print_details') or data.get('printDetails') or '').strip()
        cost = float(data.get('cost_per_piece') or data.get('costPerPiece') or 0)
        exp_date = data.get('expected_delivery_date') or data.get('expectedDeliveryDate') or None
        if exp_date and not isinstance(exp_date, date):
            exp_date = parse_date(str(exp_date)[:10])
        notes = (data.get('notes') or '').strip() if can_printing_notes else ''
        now_str = data.get('dispatched_at') or timezone.now().strftime('%Y-%m-%d %H:%M')
        user_name = data.get('user_name') or 'مسؤول المطابع'

        disp = PrintDispatch.objects.create(
            client_id=data.get('id') or data.get('client_id'),
            model=model,
            print_house=shop_name,
            piece_type=piece_type,
            piece_label=piece_label,
            pieces_count=pieces,
            print_type=print_type,
            print_location=print_location,
            print_details=print_details or None,
            cost_per_piece=cost,
            expected_delivery_date=exp_date if exp_date else None,
            dispatched_at_str=now_str,
            status='مرسل للمطبعة',
            notes=notes,
        )

        model.status = 'مرسل للمطبعة'
        model.print_house = shop_name
        model.print_cost_per_piece = cost
        if exp_date:
            model.print_expected_date = exp_date
        model._skip_timeline_signal = True
        model.save()

        tl_notes = f"تم إرسال {pieces} قطعة ({piece_label}) للتشغيل ({print_type}){f' - موعد الاستلام المتوقع: {exp_date}' if exp_date else ''}"
        if print_location:
            tl_notes += f" | مكان الطباعة: {print_location}"
        if notes:
            tl_notes += f" | ملاحظات: {notes}"

        ModelTimeline.objects.create(
            model=model,
            stage='المطابع والتطريز',
            title=f"إرسال للمطبعة: {shop_name}",
            notes=tl_notes,
            user=user_name,
            timestamp_str=now_str,
            details={
                'phase_type': 'printing_dispatch',
                'record_id': get_ext_id(disp),
                'shop_name': shop_name,
                'piece_type': piece_type,
                'piece_label': piece_label,
                'print_type': print_type,
                'print_location': print_location,
                'print_details': print_details,
                'pieces_count': pieces,
                'cost_per_piece': cost,
                'expected_delivery_date': str(exp_date or ''),
                'dispatched_at': now_str,
                'status': 'مرسل للمطبعة',
                'worker_notes': notes,
                'operator_name': user_name,
            }
        )
        return Response(PrintDispatchSerializer(disp, context={'request': request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def update_status(self, request, pk=None):
        disp = self.get_object()
        new_status = request.data.get('status') or 'تم الاستلام بالمصنع'
        user_name = request.data.get('user_name') or 'مسؤول المطابع'
        now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
        disp.status = new_status
        if new_status in ('تم الاستلام', 'تم الاستلام بالمصنع'):
            disp.received_date = date.today()
            disp.received_at_str = now_str
        disp.save()

        if new_status in ('تم الاستلام', 'تم الاستلام بالمصنع'):
            m = disp.model
            m.status = 'العد بعد الطباعة'
            m._skip_timeline_signal = True
            m.save()
            ModelTimeline.objects.create(
                model=m,
                stage='العد بعد الطباعة',
                title='استلام الموديل من المطبعة',
                notes=f"تم استلام الشحنة ({disp.pieces_count} قطعة) من {disp.print_house} وتوجيه الموديل تلقائياً للعد بعد الطباعة",
                user=user_name,
                timestamp_str=now_str,
                details={
                    'phase_type': 'printing_received',
                    'record_id': get_ext_id(disp),
                    'shop_name': disp.print_house,
                    'piece_type': disp.piece_type or 'shirt',
                    'piece_label': disp.piece_label or '',
                    'print_type': disp.print_type,
                    'print_location': disp.print_location or '',
                    'pieces_count': disp.pieces_count,
                    'received_at': now_str,
                    'status': new_status,
                    'worker_notes': disp.notes or '',
                    'operator_name': user_name,
                }
            )
        return Response(PrintDispatchSerializer(disp, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def receive(self, request, pk=None):
        request.data['status'] = 'تم الاستلام بالمصنع'
        return self.update_status(request, pk=pk)


class SewingDispatchViewSet(BasePermViewSet):
    queryset = SewingDispatch.objects.select_related('model').all()
    serializer_class = SewingDispatchSerializer

    @action(detail=True, methods=['post'])
    def receive(self, request, pk=None):
        disp_obj = self.get_object()
        user = request.data.get('user') or request.data.get('user_name') or 'مراقب الجودة'
        notes = request.data.get('notes') or ''
        disp = receive_model_from_sewing_service(get_ext_id(disp_obj), user, notes=notes)
        return Response(SewingDispatchSerializer(disp, context={'request': request}).data)


class NotificationViewSet(viewsets.ViewSet):
    """
    Smart In-App Notifications for Expected Delivery Dates (Printing & Sewing).
    """
    def list(self, request):
        ensure_initial_seed()
        notifs = generate_smart_delivery_notifications()
        notifs.extend(generate_assembly_delivery_notifications())
        urgency_weights = {'overdue': 0, 'today': 1, 'tomorrow': 2}
        notifs.sort(key=lambda n: urgency_weights.get(n.get('urgency'), 3))
        return Response({
            'notifications': notifs,
            'total_count': len(notifs),
            'overdue_count': sum(1 for n in notifs if n['urgency'] == 'overdue'),
            'today_count': sum(1 for n in notifs if n['urgency'] == 'today'),
            'tomorrow_count': sum(1 for n in notifs if n['urgency'] == 'tomorrow')
        })


class InternalMessageViewSet(BasePermViewSet):
    queryset = InternalMessage.objects.select_related('sender', 'receiver').exclude(
        sender__username__iexact='sudo'
    ).exclude(receiver__username__iexact='sudo')
    serializer_class = InternalMessageSerializer

    def create(self, request, *args, **kwargs):
        data = request.data
        sender = getattr(request, 'user_profile', None)
        if not sender:
            sender = resolve_by_id(UserProfile, data.get('sender_id') or data.get('sender'))
        if not sender:
            sender = UserProfile.objects.filter(username='sudo').first()

        receiver_key = data.get('receiver_id') or data.get('receiver')
        receiver = resolve_by_id(UserProfile, receiver_key)
        if not receiver and receiver_key:
            receiver = UserProfile.objects.filter(username__iexact=str(receiver_key)).first()

        content = (data.get('content') or '').strip()
        if not receiver or not content:
            return Response({'error': 'يجب تحديد المستلم وكتابة نص الرسالة'}, status=status.HTTP_400_BAD_REQUEST)

        msg = InternalMessage.objects.create(
            client_id=data.get('id') or data.get('client_id'),
            sender=sender,
            receiver=receiver,
            content=content,
            created_at_str=data.get('created_at') or timezone.now().strftime('%H:%M'),
        )
        return Response(InternalMessageSerializer(msg).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        msg = self.get_object()
        msg.is_read = True
        msg.save()
        return Response(InternalMessageSerializer(msg).data)


class AuditLogViewSet(BasePermViewSet):
    queryset = AuditLog.objects.exclude(user_id_ref='user-sudo').exclude(user_name__icontains='sudo')
    serializer_class = AuditLogSerializer

    def create(self, request, *args, **kwargs):
        data = request.data
        profile = getattr(request, 'user_profile', None)
        if profile and (profile.is_sudo or profile.username.lower() == 'sudo'):
            # Sudo actions remain invisible in audit logs so ordinary users never know sudo exists
            return Response({'status': 'ignored_for_sudo'}, status=status.HTTP_200_OK)

        user_id_ref = data.get('userId') or ''
        user_name = data.get('userName') or 'مستخدم'
        if str(user_id_ref).lower() == 'user-sudo' or 'sudo' in str(user_name).lower():
            return Response({'status': 'ignored_for_sudo'}, status=status.HTTP_200_OK)

        log = AuditLog.objects.create(
            client_id=data.get('id') or data.get('client_id'),
            user_id_ref=user_id_ref,
            user_name=user_name,
            action=data.get('action') or 'إجراء',
            details=data.get('details') or '',
            ip_address=request.META.get('REMOTE_ADDR', '127.0.0.1'),
            timestamp=data.get('timestamp') or timezone.now().strftime('%Y-%m-%d %H:%M'),
        )
        return Response(AuditLogSerializer(log).data, status=status.HTTP_201_CREATED)


class ReportsViewSet(viewsets.ViewSet):
    """
    Production Analytics & Aggregation Reports (Cutting, Printing, QC, Sewing).
    """
    def list(self, request):
        ensure_initial_seed()
        user_profile = resolve_request_user_profile(request)

        if user_profile and not user_profile.is_sudo:
            if not user_profile.has_perm('can_reports') and not user_profile.has_perm('reports_view'):
                return Response(
                    {'error': 'ليس لديك صلاحية الاطلاع على التقارير والإحصائيات. يرجى مراجعة إدارة النظام.'},
                    status=status.HTTP_403_FORBIDDEN
                )

        section = request.query_params.get('section', 'cutting')
        period = request.query_params.get('period', 'daily')
        date_from = request.query_params.get('date_from')
        date_to = request.query_params.get('date_to')

        report_data = get_production_report(
            section=section,
            period=period,
            date_from=date_from,
            date_to=date_to
        )
        return Response(report_data)