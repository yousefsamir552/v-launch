from .views_common import *
from .views_common import _truthy_permission_keys, _accessory_price_snapshot

import logging

logger = logging.getLogger(__name__)

class AuthViewSet(viewsets.ViewSet):
    """
    Real backend authentication: login, session verification (me), and logout.
    """
    permission_classes = [AllowAny]

    @action(detail=False, methods=['post'], throttle_classes=[LoginRateThrottle])
    def login(self, request):
        ensure_initial_seed()
        username = (request.data.get('username') or '').strip()
        password = request.data.get('password') or ''

        if not username or not password:
            return Response(
                {'detail': 'يرجى إدخال اسم المستخدم وكلمة المرور'},
                status=status.HTTP_400_BAD_REQUEST
            )

        user = UserProfile.objects.select_related('role', 'created_by').filter(username__iexact=username).first()
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
        if not is_sudo_account(user):
            log_action(
                request,
                section='تسجيل الدخول والخروج',
                action_type='login',
                target_name=user.real_name or user.username,
                details=f"تسجيل دخول ناجح للمستخدم @{user.username}",
                user=user,
            )

        request.user_profile = user
        return Response({
            'token': user.auth_token,
            'user': UserProfileSerializer(user, context={'request': request}).data
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
        request.user_profile = user
        user.last_active = timezone.now()
        user.last_seen = timezone.now()
        user.save(update_fields=['last_active', 'last_seen'])
        return Response({
            'user': UserProfileSerializer(user, context={'request': request}).data
        })

    @action(detail=False, methods=['get', 'post'])
    def heartbeat(self, request):
        """Lightweight ONLINE heartbeat + live online users list."""
        user = resolve_request_user_profile(request)
        if not user:
            return Response(
                {'detail': 'الجلسة غير صالحة أو منتهية'},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        request.user_profile = user
        UserProfile.objects.filter(pk=user.pk).update(last_seen=timezone.now())
        visible_users = UserProfile.objects.select_related('role', 'created_by').exclude(
            username__iexact='sudo'
        ).exclude(is_sudo=True)
        visible_users = rank_scoped_queryset(visible_users, request)
        if user and not is_sudo_profile(user):
            visible_users = (visible_users | UserProfile.objects.filter(pk=user.pk)).distinct()
        online_since = timezone.now() - timedelta(minutes=5)
        online_users = visible_users.filter(last_seen__gte=online_since)
        return Response({
            'onlineUsers': UserProfileSerializer(
                online_users, many=True, context={'request': request}
            ).data
        })

    @action(detail=False, methods=['post'])
    def logout(self, request):
        user = resolve_request_user_profile(request)
        if user and not is_sudo_account(user):
            log_action(
                request,
                section='تسجيل الدخول والخروج',
                action_type='logout',
                target_name=user.real_name or user.username,
                details=f"تسجيل خروج للمستخدم @{user.username}",
                user=user,
            )
        if user:
            # إبطال الرمز ومسح last_seen فعلياً حتى يخرج المستخدم من قائمة المتصلين فوراً.
            UserProfile.objects.filter(pk=user.pk).update(auth_token=None, last_seen=None)
        return Response({'status': 'logged_out'})


# ---------------------------------------------------------------------------
# /state/ per-section filtering
# The single sync endpoint used to return every table to every authenticated
# user. Each business section is now gated: users only receive the lists their
# role can open in the UI, and forbidden lists are returned as empty arrays so
# the frontend keeps its shape (no crash on `undefined.map`).
# ---------------------------------------------------------------------------
STATE_SECTION_KEYS = {
    'models': ('design', 'cutting', 'printing', 'qc', 'sewing', 'assembly_packaging', 'tracking', 'reports', 'production_wh', 'accessories', 'purchase_requests', 'readiness'),
    'requirements': ('design', 'cutting', 'printing', 'qc', 'sewing', 'assembly_packaging', 'tracking', 'reports', 'production_wh', 'readiness'),
    'accessories': ('design', 'cutting', 'printing', 'qc', 'sewing', 'assembly_packaging', 'tracking', 'reports', 'production_wh', 'accessories', 'readiness'),
    'cuttingRecords': ('cutting', 'printing', 'qc', 'sewing', 'assembly_packaging', 'tracking', 'reports', 'production_wh', 'readiness'),
    'qcRecords': ('cutting', 'printing', 'qc', 'sewing', 'assembly_packaging', 'tracking', 'reports', 'production_wh', 'readiness'),
    'printDispatches': ('cutting', 'printing', 'qc', 'sewing', 'assembly_packaging', 'tracking', 'reports', 'production_wh', 'readiness'),
    'sewingDispatches': ('printing', 'qc', 'sewing', 'assembly_packaging', 'tracking', 'reports', 'production_wh', 'readiness'),
    'packagingRequirements': ('assembly_packaging', 'tracking', 'reports', 'production_wh', 'readiness'),
    'finishingRecords': ('assembly_packaging', 'tracking', 'reports', 'production_wh', 'readiness'),
    'assemblyStageRecords': ('assembly_packaging', 'tracking', 'reports', 'production_wh', 'readiness'),
    'workshopEvaluations': ('qc', 'printing', 'sewing', 'assembly_packaging', 'tracking', 'reports'),
    'packagingMaterialRules': ('assembly_packaging', 'production_wh', 'reports'),
    'packagingMaterialTransactions': ('assembly_packaging', 'production_wh', 'reports'),
    'fabrics': ('fabric', 'design', 'cutting', 'qc', 'assembly_packaging', 'tracking', 'reports', 'production_wh'),
    'fabricColors': ('fabric', 'design', 'cutting', 'qc', 'assembly_packaging', 'tracking', 'reports', 'production_wh'),
    'fabricTransactions': ('fabric', 'design', 'cutting', 'tracking', 'reports', 'production_wh'),
    'accessoryTypes': ('accessories', 'purchase_requests', 'design', 'cutting', 'sewing', 'assembly_packaging', 'tracking', 'reports', 'production_wh'),
    'accessoryItems': ('accessories', 'purchase_requests', 'design', 'cutting', 'sewing', 'assembly_packaging', 'tracking', 'reports', 'production_wh'),
    'accessoryTransactions': ('accessories', 'design', 'sewing', 'assembly_packaging', 'tracking', 'reports', 'production_wh'),
    'purchaseRequests': ('purchase_requests',),
}


def visible_sections_for(profile):
    """
    Returns the set of section keys the profile may read, or ``None`` when the
    viewer is unrestricted (sudo).
    """
    if profile is None:
        return set()
    if is_sudo_profile(profile) or (profile.username or '').lower() == 'sudo':
        return None
    allowed = {
        section
        for section, perm_field in HasDynamicSectionPermission.section_perm_map.items()
        if profile.has_perm(perm_field)
        or profile.has_perm(perm_field.replace('_view', '_edit'))
    }
    if profile.has_perm('reports_view') or profile.has_perm('can_reports'):
        allowed.add('reports')
    if any(profile.has_perm(key) for key in READINESS_PERM_KEYS):
        allowed.add('readiness')
    return allowed


def filter_state_by_sections(payload, allowed_sections):
    """Empties every gated list the viewer's sections do not cover."""
    if allowed_sections is None:
        return payload
    for key, sections in STATE_SECTION_KEYS.items():
        if key in payload and not (allowed_sections & set(sections)):
            payload[key] = []
    return payload


class StateViewSet(viewsets.ViewSet):
    """
    Returns the complete, live ERP database state in a single atomic request.
    Note: Sudo account is strictly excluded from users list and audit logs (Task 2).
    """
    permission_classes = [IsAuthenticatedProfile]
    throttle_classes = [SyncRateThrottle]

    def list(self, request):
        ensure_initial_seed()
        ensure_packaging_material_categories()
        # لا نستدعي sync_reserved_quantities() هنا: يتم استدعاؤه عند كل تعديل فعلي
        # في خطة التصميم أو صرف القماش، واستدعاؤه في كل قراءة للحالة يفرض فحصاً
        # وكتابة على كامل جداول الألوان والإكسسوارات مع كل تحديث للصفحة.
        req_ctx = {'request': request}

        # Heartbeat: keep the current user's ONLINE marker fresh on every state sync.
        current_profile = resolve_request_user_profile(request)
        if current_profile:
            # Attach the resolved profile so rank scoping/serializers see the viewer.
            request.user_profile = current_profile
            UserProfile.objects.filter(pk=current_profile.pk).update(last_seen=timezone.now())

        visible_users = UserProfile.objects.select_related('role', 'created_by').exclude(username__iexact='sudo').exclude(is_sudo=True)
        viewer_rank = get_viewer_rank(request)
        visible_ranks = visible_rank_levels(viewer_rank)
        if current_profile is not None and not is_sudo_profile(current_profile):
            # الرتب المرئية + الحساب الشخصي دائماً.
            visible_users = (
                visible_users.filter(rank_level__in=visible_ranks)
                | visible_users.filter(pk=current_profile.pk)
            ).distinct()
        visible_roles = Role.objects.exclude(rank_level=RANK_SUDO).filter(rank_level__in=visible_ranks)
        if current_profile is not None and not is_sudo_profile(current_profile) and current_profile.role_id:
            # نُدرج دور المستخدم نفسه حتى تعمل وراثة الصلاحيات و delegatable_permissions لرتبتَي 1 و 2.
            visible_roles = (
                visible_roles | Role.objects.filter(pk=current_profile.role_id)
            ).distinct()
        online_since = timezone.now() - timedelta(minutes=5)
        online_users = visible_users.filter(last_seen__gte=online_since)
        visible_logs = AuditLog.objects.exclude(user_id_ref='user-sudo').exclude(user_name__icontains='sudo')[:200]
        can_view_logs = bool(
            current_profile is not None
            and (
                is_sudo_profile(current_profile)
                or current_profile.has_perm('view_audit_logs')
                or current_profile.has_perm('manage_permissions')
            )
        )
        if not can_view_logs:
            visible_logs = AuditLog.objects.none()
        visible_messages = InternalMessage.objects.select_related('sender', 'receiver').exclude(
            sender__username__iexact='sudo'
        ).exclude(receiver__username__iexact='sudo')
        if current_profile is None:
            visible_messages = InternalMessage.objects.none()
        elif not (is_sudo_profile(current_profile) or (current_profile.username or '').lower() == 'sudo'):
            # كل مستخدم يرى محادثاته فقط (المرسل أو المستلم) — لا تُسرَّب محادثات الآخرين.
            visible_messages = visible_messages.filter(
                Q(sender=current_profile) | Q(receiver=current_profile)
            )

        # حالة التنبيهات المحفوظة للمستخدم الحالي في قاعدة البيانات (AppNotification)
        notif_read_ids = []
        notif_snoozed = {}
        if current_profile is not None:
            now_dt = timezone.now()
            user_notifs = AppNotification.objects.filter(
                user=current_profile
            ).exclude(notification_key='')
            for row in user_notifs:
                if row.is_read:
                    notif_read_ids.append(row.notification_key)
                if row.snoozed_until and row.snoozed_until > now_dt:
                    notif_snoozed[row.notification_key] = row.snoozed_until.isoformat()

        # احتساب الكميات المحجوزة الحية من قاعدة البيانات (لضمان دقة المحجوز حتى لمستخدمي المخازن بدون صلاحية التصميم)
        from django.db.models import Sum as _Sum
        live_fabric_reserved = {
            row['color_id']: round(float(row['total'] or 0), 2)
            for row in ModelRequirement.objects.filter(
                model__is_deleted=False,
                model__status__in=('مرحلة التصميم', 'تصميم'),
            ).values('color_id').annotate(total=_Sum('planned_quantity'))
        }
        live_acc_reserved = {}
        for row in (
            ModelAccessory.objects.filter(
                model__is_deleted=False,
                is_issued=False,
            )
            .exclude(accessory_id_ref__isnull=True)
            .exclude(accessory_id_ref='')
            .values('accessory_id_ref')
            .annotate(total=_Sum('planned_quantity'))
        ):
            ref = str(row['accessory_id_ref'] or '').strip()
            if ref:
                live_acc_reserved[ref] = round(float(row['total'] or 0), 3)

        fabric_colors_qs = list(FabricColor.objects.select_related('fabric').all())
        for col in fabric_colors_qs:
            col.reserved_quantity = live_fabric_reserved.get(col.pk, 0.0)

        accessory_items_qs = list(Accessory.objects.all())
        for acc in accessory_items_qs:
            ext_key = get_ext_id(acc)
            pk_key = str(acc.pk)
            reserved_val = live_acc_reserved.get(ext_key, 0.0)
            if ext_key != pk_key:
                reserved_val = round(reserved_val + live_acc_reserved.get(pk_key, 0.0), 3)
            acc.reserved_quantity = reserved_val

        payload = {
            'globalSettings': GlobalSettingsSerializer(GlobalSettings.get_solo()).data,
            'notificationStates': {
                'readIds': notif_read_ids,
                'snoozed': notif_snoozed,
            },
            'roles': RoleSerializer(visible_roles, many=True, context=req_ctx).data,
            'users': UserProfileSerializer(visible_users, many=True, context=req_ctx).data,
            'onlineUsers': UserProfileSerializer(online_users, many=True, context=req_ctx).data,
            'sizeDefs': SizeDefSerializer(SizeDef.objects.all(), many=True).data,
            'suppliers': SupplierSerializer(Supplier.objects.all(), many=True).data,
            'workshops': WorkshopSerializer(Workshop.objects.all(), many=True).data,
            'fabrics': FabricSerializer(Fabric.objects.filter(is_deleted=False), many=True, context=req_ctx).data,
            'fabricColors': FabricColorSerializer(fabric_colors_qs, many=True, context=req_ctx).data,
            'fabricTransactions': FabricTransactionSerializer(FabricTransaction.objects.select_related('color', 'fabric', 'model').all()[:300], many=True, context=req_ctx).data,
            'accessoryTypes': AccessoryTypeSerializer(AccessoryType.objects.all(), many=True).data,
            'accessoryItems': AccessorySerializer(accessory_items_qs, many=True, context=req_ctx).data,
            'accessoryTransactions': AccessoryTransactionSerializer(AccessoryTransaction.objects.select_related('accessory', 'model').all()[:300], many=True, context=req_ctx).data,
            'purchaseRequests': PurchaseRequestSerializer(
                PurchaseRequest.objects.select_related('model', 'supplier').all(),
                many=True, context=req_ctx
            ).data,
            'models': ModelItemSerializer(
                ModelItem.objects.filter(is_deleted=False).prefetch_related(
                    'timeline', 'accessories', 'requirements', 'requirements__color'
                ),
                many=True, context=req_ctx
            ).data,
            'requirements': ModelRequirementSerializer(ModelRequirement.objects.select_related('model', 'color').filter(model__is_deleted=False), many=True, context=req_ctx).data,
            'accessories': ModelAccessorySerializer(ModelAccessory.objects.select_related('model').filter(model__is_deleted=False), many=True, context=req_ctx).data,
            'cuttingRecords': CuttingRecordSerializer(CuttingRecord.objects.select_related('model').prefetch_related('color_layers').filter(model__is_deleted=False), many=True).data,
            'qcRecords': QCRecordSerializer(QCRecord.objects.select_related('model').filter(model__is_deleted=False), many=True).data,
            'printDispatches': PrintDispatchSerializer(PrintDispatch.objects.select_related('model').filter(model__is_deleted=False), many=True, context=req_ctx).data,
            'sewingDispatches': SewingDispatchSerializer(SewingDispatch.objects.select_related('model').filter(model__is_deleted=False), many=True, context=req_ctx).data,
            'packagingRequirements': PackagingRequirementSerializer(PackagingRequirement.objects.select_related('model').filter(model__is_deleted=False), many=True).data,
            'finishingRecords': FinishingRecordSerializer(FinishingRecord.objects.select_related('model').filter(model__is_deleted=False), many=True, context=req_ctx).data,
            'assemblyStageRecords': AssemblyStageRecordSerializer(AssemblyStageRecord.objects.select_related('model').filter(model__is_deleted=False), many=True, context=req_ctx).data,
            'workshopEvaluations': WorkshopEvaluationSerializer(
                WorkshopEvaluation.objects.select_related(
                    'workshop', 'model', 'print_dispatch', 'sewing_dispatch', 'finishing_record'
                ).filter(model__is_deleted=False),
                many=True, context=req_ctx
            ).data,
            'packagingMaterialRules': PackagingMaterialRuleSerializer(
                PackagingMaterialRule.objects.prefetch_related(
                    'size_rules', 'size_rules__rule', 'size_rules__supplier',
                    'size_rules__transactions'
                ).all(),
                many=True, context=req_ctx
            ).data,
            'packagingMaterialTransactions': PackagingMaterialTransactionSerializer(
                PackagingMaterialTransaction.objects.select_related('size_rule').all()[:300],
                many=True, context=req_ctx
            ).data,
            'internalMessages': InternalMessageSerializer(visible_messages, many=True).data,
            'auditLogs': AuditLogSerializer(visible_logs, many=True, context=req_ctx).data,
            'canViewPreviousModels': can_view_previous_models(current_profile),
        }
        # كل قسم لا يملك المستخدم صلاحية عرضه يُعاد كقائمة فارغة (نفس الشكل، بلا بيانات).
        return Response(filter_state_by_sections(payload, visible_sections_for(current_profile)))


class ImageUploadViewSet(viewsets.ViewSet):
    """رفع صورة إلى Cloudflare R2 وإرجاع الرابط العام فقط لتخزينه في قاعدة البيانات."""

    permission_classes = [IsAuthenticatedProfile]
    throttle_classes = [ProfileRateThrottle]

    def create(self, request):
        uploaded = request.FILES.get('file')
        if uploaded is None:
            return Response(
                {'detail': 'لم يتم إرسال ملف الصورة.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        folder = request.data.get('folder') or 'general'
        try:
            result = upload_image_file(uploaded, folder)
        except ValidationError as exc:
            detail = ' '.join(exc.messages) if hasattr(exc, 'messages') else str(exc)
            return Response({'detail': detail}, status=status.HTTP_400_BAD_REQUEST)
        except ImproperlyConfigured:
            return Response(
                {
                    'detail': (
                        'تخزين الصور السحابي (R2) غير مهيأ. '
                        'يرجى ضبط بيانات R2 في متغيرات البيئة.'
                    )
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except Exception:  # noqa: BLE001 - أي خطأ غير متوقع يعود بترويسات CORS صحيحة
            logger.exception('Unexpected failure while uploading image %s', uploaded.name)
            return Response(
                {'detail': 'حدث خطأ داخلي غير متوقع أثناء رفع الصورة. يرجى المحاولة مرة أخرى.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        log_action(
            request,
            section='الملفات والصور',
            action_type='upload',
            target_name=uploaded.name,
            details=f"رفع صورة إلى مجلد {folder}: {uploaded.name}",
        )
        return Response(result, status=status.HTTP_201_CREATED)


class GlobalSettingsViewSet(viewsets.ViewSet):
    """
    API endpoint for reading and updating Global Site Settings (Task 3).
    Enforces fine-grained permissions:
    - edit_header_settings: for site_name, logo, footer_title, copyright_text
    - edit_message_templates: for whatsapp_supplier_template, default_sewing_instructions, internal_message_templates
    """
    permission_classes = [IsAuthenticatedProfile]

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
        before = snapshot_instance(obj)
        data = request.data

        can_edit_header = True
        can_edit_messages = True
        can_edit_fabric_threshold = True
        if profile and not (profile.is_sudo or profile.username.lower() == 'sudo'):
            can_edit_header = profile.has_perm('edit_header_settings') or profile.has_perm('manage_permissions')
            can_edit_messages = profile.has_perm('edit_message_templates') or profile.has_perm('manage_permissions')
            can_edit_fabric_threshold = (
                can_edit_header
                or profile.has_perm('fabric_warehouse_edit')
            )
            only_threshold = set(data.keys()).issubset({'fabric_alert_threshold'})
            if only_threshold:
                if not can_edit_fabric_threshold:
                    return Response(
                        {'detail': 'ليس لديك صلاحية تعديل حد التنبيه لقسم القماش'},
                        status=status.HTTP_403_FORBIDDEN
                    )
            elif not can_edit_header and not can_edit_messages:
                return Response(
                    {'detail': 'ليس لديك صلاحية تعديل الإعدادات العامة للموقع'},
                    status=status.HTTP_403_FORBIDDEN
                )

        if 'fabric_alert_threshold' in data and data['fabric_alert_threshold'] is not None and can_edit_fabric_threshold:
            threshold_val = max(Decimal('0'), to_decimal(data['fabric_alert_threshold'], Decimal('25'), places=2))
            obj.fabric_alert_threshold = threshold_val

        if can_edit_header:
            if 'site_name' in data and data['site_name'] is not None:
                obj.site_name = str(data['site_name']).strip() or 'نظام إدارة المصنع'
            if 'logo' in data and data['logo'] is not None:
                raw_logo = str(data['logo']).strip()
                obj.logo = clean_image_value(raw_logo, 'settings', 'شعار الموقع') or '🏭'
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

        extra_changes = []
        if 'favorite_accessory_ids' in data and isinstance(data['favorite_accessory_ids'], list):
            prev_fav = SystemSetting.objects.filter(key='favorite_accessory_ids').first()
            old_fav_ids = (prev_fav.value or {}).get('ids', []) if prev_fav and isinstance(prev_fav.value, dict) else []
            new_fav_ids = data['favorite_accessory_ids']
            SystemSetting.objects.update_or_create(
                key='favorite_accessory_ids',
                defaults={'value': {'ids': new_fav_ids}}
            )
            if old_fav_ids != new_fav_ids:
                extra_changes.append({
                    'field': 'favorite_accessory_ids',
                    'label': 'الإكسسوارات المفضلة السريعة',
                    'old': f'{len(old_fav_ids)} صنف',
                    'new': f'{len(new_fav_ids)} صنف',
                })

        # مجموعات الإكسسوارات الجاهزة (تُخزَّن كإعداد نظام بلا Migrations جديدة).
        if 'accessory_groups' in data and isinstance(data['accessory_groups'], list):
            prev_grp = SystemSetting.objects.filter(key='accessory_groups').first()
            old_groups = (prev_grp.value or {}).get('groups', []) if prev_grp and isinstance(prev_grp.value, dict) else []
            new_groups = data['accessory_groups']
            SystemSetting.objects.update_or_create(
                key='accessory_groups',
                defaults={'value': {'groups': new_groups}}
            )
            if old_groups != new_groups:
                extra_changes.append({
                    'field': 'accessory_groups',
                    'label': 'مجموعات الإكسسوارات الجاهزة',
                    'old': f'{len(old_groups)} مجموعة',
                    'new': f'{len(new_groups)} مجموعة',
                })

        if profile and not (profile.is_sudo or profile.username.lower() == 'sudo'):
            obj.updated_by = profile.real_name or profile.username
        elif 'updated_by' in data and data['updated_by']:
            obj.updated_by = str(data['updated_by'])

        obj.save()
        changes = build_field_changes(before, snapshot_instance(obj), model=GlobalSettings) + extra_changes
        log_action(
            request,
            section='الإعدادات',
            action_type='settings',
            target_name='الإعدادات العامة للموقع',
            details='حدّث إعدادات الموقع العامة والأدوات وقوالب الرسائل',
            changes=changes,
            user=profile,
        )
        return Response(GlobalSettingsSerializer(obj).data)


class RoleViewSet(BasePermViewSet):
    queryset = Role.objects.all()
    serializer_class = RoleSerializer

    def get_queryset(self):
        """الرتب المرئية فقط: sudo يرى الكل، 1 يرى {2,3}، 2 يرى {3}، 3 يرى {3}."""
        return rank_scoped_queryset(
            Role.objects.exclude(rank_level=RANK_SUDO), self.request
        )

    def _check_manage_permissions(self, request):
        profile = getattr(request, 'user_profile', None)
        if not profile:
            return Response({'detail': 'مطلوب تسجيل الدخول'}, status=status.HTTP_401_UNAUTHORIZED)
        if not profile.has_perm('manage_permissions'):
            return Response({'detail': 'ليس لديك صلاحية إدارة الصلاحيات والأدوار'}, status=status.HTTP_403_FORBIDDEN)
        return None

    def create(self, request, *args, **kwargs):
        denied = self._check_manage_permissions(request)
        if denied:
            return denied

        data = request.data
        name = (data.get('name') or '').strip()
        if not name:
            return Response({'detail': 'اسم الدور مطلوب'}, status=status.HTTP_400_BAD_REQUEST)
        rank, rank_error = resolve_rank_for_grant(request, data.get('rank_level'))
        if rank_error:
            return rank_error
        permissions = data.get('permissions') or {}
        if not isinstance(permissions, dict):
            permissions = {}
        denied = validate_permission_delegation(request, permissions)
        if denied:
            return denied
        delegatable, delegatable_error = sanitize_delegatable_list(
            request, data.get('delegatable_permissions'), permissions
        )
        if delegatable_error:
            return delegatable_error
        role = Role(
            client_id=data.get('id') or data.get('client_id'),
            name=name,
            description=data.get('description') or '',
            permissions_json=permissions,
            delegatable_permissions=delegatable,
            rank_level=rank,
        )
        role.save()
        return Response(
            RoleSerializer(role, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        denied = self._check_manage_permissions(request)
        if denied:
            return denied

        role = self.get_object()
        if not can_manage_target(request, role.rank_level):
            return Response({'detail': 'لا تملك صلاحية تعديل دور بهذه الرتبة'}, status=status.HTTP_403_FORBIDDEN)

        data = request.data
        if 'name' in data and data['name']:
            role.name = data['name'].strip()
        if 'description' in data:
            role.description = data['description'] or ''
        if 'permissions' in data and isinstance(data['permissions'], dict):
            denied = validate_permission_delegation(
                request, data['permissions'], baseline=role.get_permissions_dict()
            )
            if denied:
                return denied
            role.sync_booleans_from_permissions(data['permissions'])
        if 'delegatable_permissions' in data:
            delegatable, delegatable_error = sanitize_delegatable_list(
                request,
                data.get('delegatable_permissions'),
                role.get_permissions_dict(),
                baseline=role.delegatable_permissions,
            )
            if delegatable_error:
                return delegatable_error
            role.delegatable_permissions = delegatable
        elif 'permissions' in data and isinstance(data['permissions'], dict):
            # تنظيف تلقائي: لا يبقى في قائمة التفويض ما لم يعد الدور يملكه فعلاً.
            granted = _truthy_permission_keys(role.get_permissions_dict())
            role.delegatable_permissions = [
                key for key in (role.delegatable_permissions or []) if str(key) in granted
            ]
        if data.get('rank_level') not in (None, ''):
            new_rank, rank_error = resolve_rank_for_grant(request, data.get('rank_level'))
            if rank_error:
                return rank_error
            role.rank_level = new_rank
        role.save()
        # Update cached role_title on non-sudo users assigned to this role
        UserProfile.objects.filter(role=role).exclude(username__iexact='sudo').exclude(is_sudo=True).update(role_title=role.name)
        return Response(RoleSerializer(role, context={'request': request}).data)

    def destroy(self, request, *args, **kwargs):
        denied = self._check_manage_permissions(request)
        if denied:
            return denied

        role = self.get_object()
        if not can_manage_target(request, role.rank_level):
            return Response({'detail': 'لا تملك صلاحية حذف دور بهذه الرتبة'}, status=status.HTTP_403_FORBIDDEN)
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
    queryset = UserProfile.objects.select_related('role', 'created_by').exclude(username__iexact='sudo').exclude(is_sudo=True)
    serializer_class = UserProfileSerializer

    def get_queryset(self):
        """يقيّد المستخدمين الظاهرين بالرتب المسموحة + الحساب الشخصي دائماً."""
        base = UserProfile.objects.select_related('role', 'created_by').exclude(
            username__iexact='sudo'
        ).exclude(is_sudo=True)
        profile = get_viewer_profile(self.request)
        if profile is None or is_sudo_profile(profile):
            return base
        viewer_rank = coerce_rank_level(profile.rank_level)
        visible = base.filter(rank_level__in=visible_rank_levels(viewer_rank))
        # كل رتبة ترى حسابها الشخصي بغض النظر عن قواعد الرؤية.
        return (visible | base.filter(pk=profile.pk)).distinct()

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
        if not profile:
            return Response({'detail': 'مطلوب تسجيل الدخول'}, status=status.HTTP_401_UNAUTHORIZED)
        if not (profile.has_perm('manage_users') or profile.has_perm('manage_permissions')):
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

        if role_obj is not None and not can_manage_target(request, role_obj.rank_level):
            return Response(
                {'detail': 'لا تملك صلاحية تعيين دور بهذه الرتبة'},
                status=status.HTTP_403_FORBIDDEN,
            )

        preferred_rank = data.get('rank_level')
        if preferred_rank in (None, '') and role_obj is not None:
            preferred_rank = role_obj.rank_level
        rank, rank_error = resolve_rank_for_grant(request, preferred_rank)
        if rank_error:
            return rank_error

        custom_permissions = data.get('permissions') or data.get('custom_permissions') or {}
        if not isinstance(custom_permissions, dict):
            custom_permissions = {}
        denied = validate_permission_delegation(request, custom_permissions)
        if denied:
            return denied
        # تعيين دور يمنح صلاحياته الفعلية: يجب أن تكون كلها ضمن صلاحيات التفويض للمدير الحالي.
        if role_obj is not None:
            denied = validate_permission_delegation(
                request, None, extra_permissions=role_obj.get_permissions_dict()
            )
            if denied:
                return denied
            # الدور قد يورّث حق تفويض صلاحيات أخرى؛ لا يجوز منحه إن لم يملكه المدير.
            denied = validate_permission_delegation(
                request,
                {str(key): True for key in (role_obj.delegatable_permissions or [])},
            )
            if denied:
                return denied

        creator = get_viewer_profile(request)
        granted_keys = _truthy_permission_keys(custom_permissions)
        if role_obj is not None:
            granted_keys |= _truthy_permission_keys(role_obj.get_permissions_dict())
        delegatable, delegatable_error = sanitize_delegatable_list(
            request, data.get('delegatable_permissions'), {key: True for key in granted_keys}
        )
        if delegatable_error:
            return delegatable_error

        # تخزين الفروقات فقط عن الدور في custom_permissions حتى تسري التعديلات المستقبلية على الدور.
        if role_obj is not None and custom_permissions:
            role_base = role_obj.get_permissions_dict()
            custom_permissions = {
                k: bool(v)
                for k, v in custom_permissions.items()
                if bool(v) != bool(role_base.get(k, False))
            }

        user = UserProfile(
            client_id=data.get('id') or data.get('client_id'),
            username=username,
            real_name=real_name,
            phone=data.get('phone') or '',
            role=role_obj,
            role_title=role_obj.name if role_obj else (data.get('role') or 'موظف تشغيل'),
            is_sudo=False,  # Sudo is strictly reserved for the immutable emergency account
            is_active=data.get('is_active', True),
            custom_permissions=custom_permissions,
            delegatable_permissions=delegatable,
            created_by=creator,
            created_by_name=((creator.real_name or creator.username) if creator else ''),
            rank_level=rank,
        )
        user.set_password(password)
        user.save()
        return Response(
            UserProfileSerializer(user, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

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

        viewer = get_viewer_profile(request)
        is_self = bool(viewer and viewer.pk == user.pk)
        # تعديل حساب شخص آخر يتطلب صلاحية إدارة المستخدمين أو الصلاحيات.
        if not is_self and not (
            viewer
            and (viewer.has_perm('manage_users') or viewer.has_perm('manage_permissions'))
        ):
            return Response(
                {'detail': 'ليس لديك صلاحية تعديل حسابات المستخدمين'},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not is_self and not can_manage_target(request, user.rank_level):
            return Response(
                {'detail': 'لا تملك صلاحية تعديل مستخدم بهذه الرتبة'},
                status=status.HTTP_403_FORBIDDEN,
            )

        data = request.data

        # منع تصعيد الذات: لا يعدّل المستخدم صلاحياته أو دوره أو قائمة تفويضه بنفسه.
        self_privilege_fields = {
            'permissions', 'custom_permissions', 'delegatable_permissions', 'role', 'role_id',
        }
        if is_self and any(field in data for field in self_privilege_fields):
            return Response(
                {'detail': 'لا يمكنك تعديل صلاحياتك أو دورك أو صلاحيات التفويض الخاصة بحسابك بنفسك'},
                status=status.HTTP_403_FORBIDDEN,
            )

        if 'real_name' in data and data['real_name']:
            user.real_name = data['real_name'].strip()
        if 'phone' in data:
            user.phone = data['phone'] or ''
        if 'is_active' in data:
            next_active = parse_bool_flag(data['is_active'], default=True)
            if is_self and not next_active:
                return Response(
                    {'detail': 'لا يمكنك تعطيل حسابك الشخصي بنفسك.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            user.is_active = next_active
            if not user.is_active:
                user.auth_token = None
                user.last_seen = None

        incoming_permissions = None
        if 'permissions' in data and isinstance(data['permissions'], dict):
            incoming_permissions = data['permissions']
        elif 'custom_permissions' in data and isinstance(data['custom_permissions'], dict):
            incoming_permissions = data['custom_permissions']
        if incoming_permissions is not None:
            # المقارنة تكون مع الصلاحيات الفعلية الحالية (تخصيص + دور) لا التخصيص فقط،
            # حتى لا يُرفض مجرد تعديل كلمة المرور أو الاسم لحساب يحمل دوراً بصلاحيات.
            denied = validate_permission_delegation(
                request, incoming_permissions, baseline=effective_permission_keys(user)
            )
            if denied:
                return denied

        role_changed = False
        if 'role_id' in data or 'role' in data:
            role_obj = resolve_by_id(Role, data.get('role_id'))
            if not role_obj and data.get('role'):
                role_obj = Role.objects.filter(name=data.get('role')).first()
            if role_obj and role_obj.id != user.role_id:
                if not can_manage_target(request, role_obj.rank_level):
                    return Response(
                        {'detail': 'لا تملك صلاحية تعيين دور بهذه الرتبة'},
                        status=status.HTTP_403_FORBIDDEN,
                    )
                # الدور يمنح صلاحياته الفعلية: يجب أن تكون كلها قابلة للتفويض للمدير الحالي.
                denied = validate_permission_delegation(
                    request, None, extra_permissions=role_obj.get_permissions_dict()
                )
                if denied:
                    return denied
                # الدور قد يورّث حق تفويض صلاحيات أخرى؛ لا يجوز منحه إن لم يملكه المدير.
                denied = validate_permission_delegation(
                    request,
                    {str(key): True for key in (role_obj.delegatable_permissions or [])},
                )
                if denied:
                    return denied
                role_changed = True
            if role_obj:
                user.role = role_obj
                user.role_title = role_obj.name
            elif data.get('role'):
                user.role_title = data.get('role')

        if incoming_permissions is not None:
            if user.role is not None:
                role_base = user.role.get_permissions_dict()
                user.custom_permissions = {
                    k: bool(v)
                    for k, v in incoming_permissions.items()
                    if bool(v) != bool(role_base.get(k, False))
                }
            else:
                user.custom_permissions = incoming_permissions

        if 'delegatable_permissions' in data:
            granted = effective_permission_keys(user)
            delegatable, delegatable_error = sanitize_delegatable_list(
                request,
                data.get('delegatable_permissions'),
                {key: True for key in granted},
                baseline=user.delegatable_permissions,
            )
            if delegatable_error:
                return delegatable_error
            user.delegatable_permissions = delegatable
        elif incoming_permissions is not None or role_changed:
            # تنظيف تلقائي: لا يبقى في قائمة التفويض ما لم يعد الحساب يملكه فعلاً.
            granted = effective_permission_keys(user)
            user.delegatable_permissions = [
                key for key in (user.delegatable_permissions or []) if str(key) in granted
            ]

        # تغيير الرتبة: لا يرفع المستخدم رتبته ولا يعدّل رتبة نفسه.
        if not is_self and data.get('rank_level') not in (None, ''):
            new_rank, rank_error = resolve_rank_for_grant(request, data.get('rank_level'))
            if rank_error:
                return rank_error
            user.rank_level = new_rank

        new_password = data.get('password')
        if new_password:
            user.set_password(new_password)
            # عند تغيير كلمة مرور مستخدم آخر تُبطَل جلساته الحالية فوراً.
            if not is_self:
                user.auth_token = None

        user.save()
        return Response(UserProfileSerializer(user, context={'request': request}).data)

    def destroy(self, request, *args, **kwargs):
        viewer = get_viewer_profile(request)
        if not viewer or not (
            viewer.has_perm('manage_users') or viewer.has_perm('manage_permissions')
        ):
            return Response(
                {'detail': 'ليس لديك صلاحية إدارة حسابات المستخدمين'},
                status=status.HTTP_403_FORBIDDEN,
            )
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
        if viewer and viewer.pk == user.pk:
            return Response(
                {'detail': 'لا يمكنك تنفيذ هذا الإجراء على حسابك الشخصي'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not can_manage_target(request, user.rank_level):
            return Response(
                {'detail': 'لا تملك صلاحية حذف مستخدم بهذه الرتبة'},
                status=status.HTTP_403_FORBIDDEN,
            )
        cascade = bool(request.data.get('cascade'))
        deleted_children_names = []
        if cascade:
            for descendant in collect_created_descendants(user, request):
                deleted_children_names.append(descendant.real_name or descendant.username)
                descendant.auth_token = None
                descendant.delete()
        deleted_children_count = len(deleted_children_names)
        target_label = user.real_name or user.username
        user.delete()
        if deleted_children_count > 0:
            set_audit_meta(
                request,
                target_name=target_label,
                details=f"حذف حساب الموظف: {target_label} مع {deleted_children_count} حساب تابع ({'، '.join(deleted_children_names[:5])})",
                extra_changes=[{
                    'field': 'cascade_deleted_users',
                    'label': 'الحسابات التابعة المحذوفة',
                    'old': '، '.join(deleted_children_names),
                    'new': 'تم الحذف',
                }],
            )
        return Response({
            'status': 'deleted',
            'cascade': cascade,
            'deleted_children_count': deleted_children_count,
        })

    @action(detail=True, methods=['post'])
    def toggle_active(self, request, pk=None):
        viewer = get_viewer_profile(request)
        if not viewer or not (
            viewer.has_perm('manage_users') or viewer.has_perm('manage_permissions')
        ):
            return Response(
                {'detail': 'ليس لديك صلاحية إدارة حسابات المستخدمين'},
                status=status.HTTP_403_FORBIDDEN,
            )
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
        if viewer and viewer.pk == user.pk:
            return Response(
                {'detail': 'لا يمكنك تنفيذ هذا الإجراء على حسابك الشخصي'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.is_active = not user.is_active
        if not user.is_active:
            user.auth_token = None
            user.last_seen = None
        user.save()
        cascade = bool(request.data.get('cascade'))
        affected_user_ids = []
        affected_names = []
        if cascade:
            for descendant in collect_created_descendants(user, request):
                descendant.is_active = user.is_active
                if not descendant.is_active:
                    descendant.auth_token = None
                    descendant.last_seen = None
                descendant.save(update_fields=['is_active', 'auth_token', 'last_seen'])
                affected_user_ids.append(get_ext_id(descendant))
                affected_names.append(descendant.real_name or descendant.username)
        status_phrase = 'فعّل حساب' if user.is_active else 'أوقف حساب'
        target_label = user.real_name or user.username
        cascade_suffix = f" مع {len(affected_names)} حساب تابع" if affected_names else ''
        set_audit_meta(
            request,
            target_name=target_label,
            details=f"{status_phrase} الموظف: {target_label}{cascade_suffix}",
            extra_changes=([{
                'field': 'cascade_affected_users',
                'label': 'الحسابات التابعة المتأثرة',
                'old': 'موقوف' if user.is_active else 'نشط',
                'new': f"{'نشط' if user.is_active else 'موقوف'} ({'، '.join(affected_names[:5])})",
            }] if affected_names else None),
        )
        payload = UserProfileSerializer(user, context={'request': request}).data
        payload['cascade'] = cascade
        payload['affected_user_ids'] = affected_user_ids
        return Response(payload)


