from .views_common import *
from .views_common import _truthy_permission_keys, _accessory_price_snapshot

class NotificationViewSet(viewsets.ViewSet):
    """
    Smart In-App Notifications for Expected Delivery Dates (Printing & Sewing
    + التشطيب/المكواة/التعبئة/الدست) مع حفظ حالة القراءة والتأجيل لكل مستخدم في قاعدة البيانات.

    التنبيهات مقيّدة بالصلاحيات: المستخدم لا يستلم إلا تنبيهات الأقسام التي يملك
    صلاحية عرضها (وحساب sudo يرى كل شيء) — بنفس منطق جرس التنبيهات في الواجهة.
    """
    permission_classes = [IsAuthenticatedProfile]

    def _user_notification_states(self, profile):
        if profile is None:
            return {'readIds': [], 'snoozed': {}}
        now_dt = timezone.now()
        read_ids = []
        snoozed = {}
        for row in AppNotification.objects.filter(user=profile).exclude(notification_key=''):
            if row.is_read:
                read_ids.append(row.notification_key)
            if row.snoozed_until and row.snoozed_until > now_dt:
                snoozed[row.notification_key] = row.snoozed_until.isoformat()
        return {'readIds': read_ids, 'snoozed': snoozed}

    def list(self, request):
        ensure_initial_seed()
        profile = resolve_request_user_profile(request)
        notifs = generate_smart_delivery_notifications()
        notifs.extend(generate_assembly_delivery_notifications())
        notifs = filter_notifications_by_permission(notifs, profile)
        urgency_weights = {'overdue': 0, 'today': 1, 'tomorrow': 2}
        notifs.sort(key=lambda n: urgency_weights.get(n.get('urgency'), 3))
        states = self._user_notification_states(profile)
        return Response({
            'notifications': notifs,
            'total_count': len(notifs),
            'overdue_count': sum(1 for n in notifs if n['urgency'] == 'overdue'),
            'today_count': sum(1 for n in notifs if n['urgency'] == 'today'),
            'tomorrow_count': sum(1 for n in notifs if n['urgency'] == 'tomorrow'),
            'states': states,
        })

    @action(detail=False, methods=['get'])
    def preferences(self, request):
        profile = resolve_request_user_profile(request)
        return Response(self._user_notification_states(profile))

    @action(detail=False, methods=['post'], url_path='mark-read')
    def mark_read(self, request):
        profile = resolve_request_user_profile(request)
        if not profile:
            return Response({'detail': 'مطلوب تسجيل الدخول'}, status=status.HTTP_401_UNAUTHORIZED)
        key = str(request.data.get('notification_key') or request.data.get('id') or '').strip()
        if not key:
            return Response({'detail': 'مفتاح التنبيه مطلوب'}, status=status.HTTP_400_BAD_REQUEST)
        stage = str(request.data.get('stage') or 'printing').strip()
        if stage not in dict(AppNotification.STAGE_CHOICES):
            stage = 'printing'
        urgency = str(request.data.get('urgency') or 'today').strip()
        if urgency not in dict(AppNotification.URGENCY_CHOICES):
            urgency = 'today'
        AppNotification.objects.update_or_create(
            user=profile,
            notification_key=key[:255],
            defaults={
                'is_read': True,
                'title': str(request.data.get('title') or '')[:255],
                'message': str(request.data.get('message') or ''),
                'stage': stage,
                'urgency': urgency,
                'target_name': str(request.data.get('target_name') or '')[:200],
            },
        )
        notif_title = str(request.data.get('title') or key)[:120]
        log_action(
            request,
            section='التنبيهات',
            action_type='update',
            target_name=notif_title,
            details=f"علّم التنبيه كمقروء: {notif_title}",
            user=profile,
        )
        return Response(self._user_notification_states(profile))

    @action(detail=False, methods=['post'])
    def snooze(self, request):
        profile = resolve_request_user_profile(request)
        if not profile:
            return Response({'detail': 'مطلوب تسجيل الدخول'}, status=status.HTTP_401_UNAUTHORIZED)
        key = str(request.data.get('notification_key') or request.data.get('id') or '').strip()
        if not key:
            return Response({'detail': 'مفتاح التنبيه مطلوب'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            hours = float(request.data.get('hours') or 4)
        except (TypeError, ValueError):
            hours = 4.0
        hours = max(0.25, min(hours, 24 * 30))
        until = timezone.now() + timedelta(hours=hours)
        AppNotification.objects.update_or_create(
            user=profile,
            notification_key=key[:255],
            defaults={
                'snoozed_until': until,
            },
        )
        log_action(
            request,
            section='التنبيهات',
            action_type='update',
            target_name=key[:120],
            details=f"أجّل التنبيه ({key[:80]}) لمدة {hours:g} ساعة",
            user=profile,
        )
        return Response(self._user_notification_states(profile))

    @action(detail=False, methods=['post'], url_path='clear-snoozed')
    def clear_snoozed(self, request):
        profile = resolve_request_user_profile(request)
        if not profile:
            return Response({'detail': 'مطلوب تسجيل الدخول'}, status=status.HTTP_401_UNAUTHORIZED)
        AppNotification.objects.filter(user=profile).update(snoozed_until=None)
        log_action(
            request,
            section='التنبيهات',
            action_type='update',
            target_name='التنبيهات المؤجلة',
            details='استعاد جميع التنبيهات المؤجلة',
            user=profile,
        )
        return Response(self._user_notification_states(profile))


class InternalMessageViewSet(BasePermViewSet):
    queryset = InternalMessage.objects.select_related('sender', 'receiver').exclude(
        sender__username__iexact='sudo'
    ).exclude(receiver__username__iexact='sudo')
    serializer_class = InternalMessageSerializer
    # لا حاجة لتعديل/حذف الرسائل من الواجهة؛ القراءة والإرسال وتعليم "مقروءة" فقط.
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        """كل مستخدم يرى رسائله فقط (مرسلة أو مستلمة) — إلا sudo فيرى الكل."""
        qs = super().get_queryset()
        profile = getattr(self.request, 'user_profile', None)
        if is_sudo_account(profile):
            return qs
        if profile is None:
            return qs.none()
        return qs.filter(Q(sender=profile) | Q(receiver=profile))

    def create(self, request, *args, **kwargs):
        data = request.data
        sender = getattr(request, 'user_profile', None)
        if not sender:
            return Response({'detail': 'مطلوب تسجيل الدخول'}, status=status.HTTP_401_UNAUTHORIZED)
        if not sender.has_perm('send_internal_messages'):
            return Response(
                {'detail': 'ليس لديك صلاحية إرسال الرسائل والمراسلات الداخلية'},
                status=status.HTTP_403_FORBIDDEN,
            )

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
        # قاعدة الخصوصية: تسجيل البيانات الوصفية فقط (المرسل والمستلم) دون محتوى الرسالة الخاصة نهائياً.
        sender_label = sender.real_name or sender.username
        receiver_label = receiver.real_name or receiver.username
        set_audit_meta(
            request,
            section='المراسلات الداخلية',
            action_type='create',
            target_name=f"من {sender_label} إلى {receiver_label}",
            details=f"أرسل رسالة داخلية من {sender_label} إلى {receiver_label}",
            changes=[
                {'field': 'sender', 'label': 'المرسل', 'old': '—', 'new': sender_label},
                {'field': 'receiver', 'label': 'المستلم', 'old': '—', 'new': receiver_label},
            ],
        )
        return Response(InternalMessageSerializer(msg).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        msg = self.get_object()
        profile = getattr(request, 'user_profile', None)
        if not is_sudo_account(profile) and (profile is None or msg.receiver_id != profile.pk):
            # منع IDOR: لا يعلّم الرسالة كمقروءة إلا مستلمها.
            return Response(
                {'detail': 'لا يمكنك تعديل حالة قراءة رسالة ليست لك'},
                status=status.HTTP_403_FORBIDDEN,
            )
        was_read = bool(msg.is_read)
        msg.is_read = True
        msg.save()
        # قاعدة الخصوصية: تسجيل حالة القراءة والمرسل/المستلم فقط دون نص الرسالة.
        sender_label = (msg.sender.real_name or msg.sender.username) if msg.sender else 'مستخدم'
        receiver_label = (msg.receiver.real_name or msg.receiver.username) if msg.receiver else 'مستخدم'
        set_audit_meta(
            request,
            section='المراسلات الداخلية',
            action_type='update',
            target_name=f"رسالة من {sender_label} إلى {receiver_label}",
            details=f"علّم رسالة داخلية من {sender_label} إلى {receiver_label} كمقروءة",
            changes=[
                {'field': 'is_read', 'label': 'حالة القراءة', 'old': 'مقروءة' if was_read else 'غير مقروءة', 'new': 'مقروءة'},
            ],
        )
        return Response(InternalMessageSerializer(msg).data)


class AuditLogPagination(PageNumberPagination):
    """ترقيم صفحات سجل المراقبة (افتراضي 50، بحد أقصى 200)."""
    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 200


class AuditLogViewSet(BasePermViewSet):
    """
    سجل المراقبة الشامل: فلاتر قابلة للتركيب (تاريخ/ساعة/مستخدم/قسم/نوع/آي بي/بحث)
    مع ترقيم صفحات، وبيانات فلاتر ديناميكية، ونقطة تسجيل إجراءات العميل (تصدير/طباعة)،
    مع استبعاد حساب sudo دائماً.
    """
    queryset = AuditLog.objects.exclude(user_id_ref='user-sudo').exclude(user_name__icontains='sudo')
    serializer_class = AuditLogSerializer
    pagination_class = AuditLogPagination
    audit_enabled = False
    # القراءة + نقطة client-action فقط (تُمنع عمليات التعديل والحذف نهائياً).
    http_method_names = ['get', 'post', 'head', 'options']

    def initial(self, request, *args, **kwargs):
        """
        - نقطة ``client_action`` متاحة لأي مستخدم مسجّل الدخول لتسجيل عمليات التصدير والطباعة.
        - عرض سجل المراقبة والفلاتر محصور بمن يملك view_audit_logs أو manage_permissions (أو sudo).
        """
        super().initial(request, *args, **kwargs)
        profile = getattr(request, 'user_profile', None)
        if getattr(self, 'action', None) == 'client_action':
            if profile is None:
                raise PermissionDenied('مطلوب تسجيل الدخول')
            return
        if is_sudo_account(profile):
            return
        if not (
            profile is not None
            and (profile.has_perm('view_audit_logs') or profile.has_perm('manage_permissions'))
        ):
            raise PermissionDenied('ليس لديك صلاحية عرض سجل المراقبة')

    def _base_queryset(self):
        return AuditLog.objects.exclude(user_id_ref='user-sudo').exclude(user_name__icontains='sudo')

    def _parse_hour(self, name):
        raw = (self.request.query_params.get(name) or '').strip()
        if raw == '':
            return None
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return None
        return value if 0 <= value <= 23 else None

    def get_queryset(self):
        qs = self._base_queryset()
        params = self.request.query_params

        date_val = (params.get('date') or '').strip()
        if date_val:
            parsed = parse_date(date_val)
            if parsed:
                qs = qs.filter(Q(timestamp__startswith=date_val) | Q(created_at__date=parsed))
            else:
                qs = qs.filter(timestamp__startswith=date_val)

        date_from = (params.get('date_from') or params.get('from') or '').strip()
        date_to = (params.get('date_to') or params.get('to') or '').strip()
        if date_from:
            parsed_from = parse_date(date_from)
            if parsed_from:
                qs = qs.filter(Q(timestamp__gte=date_from) | Q(created_at__date__gte=parsed_from))
            else:
                qs = qs.filter(timestamp__gte=date_from)
        if date_to:
            parsed_to = parse_date(date_to)
            if parsed_to:
                qs = qs.filter(
                    Q(timestamp__lte=f"{date_to} 23:59:59") | Q(created_at__date__lte=parsed_to)
                )
            else:
                qs = qs.filter(timestamp__lte=f"{date_to} 23:59:59")

        hour_from = self._parse_hour('hour_from')
        hour_to = self._parse_hour('hour_to')
        if hour_from is not None:
            qs = qs.filter(created_at__hour__gte=hour_from)
        if hour_to is not None:
            qs = qs.filter(created_at__hour__lte=hour_to)

        user = (params.get('user') or params.get('userId') or params.get('user_id') or '').strip()
        if user:
            qs = qs.filter(
                Q(user_id_ref=user)
                | Q(user_name__icontains=user)
                | Q(user_full_name__icontains=user)
            )

        section = (params.get('section') or '').strip()
        if section:
            qs = qs.filter(section=section)

        action_type = (params.get('action_type') or params.get('actionType') or '').strip()
        if action_type:
            qs = qs.filter(action_type=action_type)

        ip_address = (
            params.get('ip_address') or params.get('ipAddress') or params.get('ip') or ''
        ).strip()
        if ip_address:
            qs = qs.filter(ip_address__icontains=ip_address)

        search = (params.get('search') or params.get('q') or '').strip()
        if search:
            qs = qs.filter(
                Q(details__icontains=search)
                | Q(target_name__icontains=search)
                | Q(user_name__icontains=search)
                | Q(user_full_name__icontains=search)
                | Q(ip_address__icontains=search)
                | Q(section__icontains=search)
                | Q(action__icontains=search)
            )

        return qs.order_by('-created_at', '-id')



    @action(detail=False, methods=['get'])
    def filters(self, request):
        """بيانات الفلاتر الديناميكية (المستخدمون/الأقسام/الأنواع/عناوين IP)."""
        base = self._base_queryset()
        users_rows = list(
            base.exclude(user_name='')
            .values('user_id_ref', 'user_name', 'user_full_name')
            .distinct()
            .order_by('user_full_name', 'user_name')
        )
        users = []
        seen = set()
        for row in users_rows:
            uid = row.get('user_id_ref') or ''
            name = row.get('user_full_name') or row.get('user_name') or ''
            key = uid or name
            if not name or key in seen:
                continue
            seen.add(key)
            users.append({
                'id': uid,
                'name': name,
                'username': row.get('user_name') or '',
            })

        sections = list(
            base.exclude(section='').values_list('section', flat=True).distinct().order_by('section')
        )
        action_types = list(
            base.exclude(action_type='')
            .values_list('action_type', flat=True)
            .distinct()
            .order_by('action_type')
        )
        ip_addresses = list(
            base.exclude(ip_address='')
            .values_list('ip_address', flat=True)
            .distinct()
            .order_by('ip_address')
        )
        return Response({
            'users': users,
            'sections': sections,
            'actionTypes': [
                {'key': key, 'label': ACTION_TYPE_LABELS.get(key, key)}
                for key in action_types
            ],
            'ipAddresses': ip_addresses,
        })

    @action(detail=False, methods=['post'], url_path='client-action')
    def client_action(self, request):
        """
        تسجيل إجراءات المتصفح الدائمة (تصدير ملفات Excel/CSV/ZIP، طباعة أوراق وأذونات رسمية)
        مباشرة في قاعدة البيانات ``AuditLog`` حتى لا تختفي بعد تحديث الصفحة.
        """
        data = request.data if isinstance(request.data, dict) else {}
        profile = resolve_request_user_profile(request)
        if profile is None:
            return Response({'detail': 'مطلوب تسجيل الدخول'}, status=status.HTTP_401_UNAUTHORIZED)
        if is_sudo_account(profile):
            return Response({'status': 'ignored_for_sudo'}, status=status.HTTP_200_OK)

        raw_type = str(data.get('action_type') or data.get('actionType') or 'custom').strip().lower()
        allowed_client_types = {'export', 'print', 'custom'}
        action_type = raw_type if raw_type in allowed_client_types else 'custom'

        section = str(data.get('section') or 'عام').strip()[:100] or 'عام'
        target_name = str(data.get('target_name') or data.get('targetName') or '').strip()[:255]
        details = str(data.get('details') or '').strip()[:1500]
        if not details:
            return Response({'detail': 'وصف الإجراء مطلوب'}, status=status.HTTP_400_BAD_REQUEST)

        log = log_action(
            request,
            section=section,
            action_type=action_type,
            target_name=target_name,
            details=details,
            changes=[],
            user=profile,
        )
        if log is None:
            return Response({'status': 'ignored_for_sudo'}, status=status.HTTP_200_OK)

        custom_action = str(data.get('action') or '').strip()[:150]
        if custom_action:
            log.action = custom_action
            log.save(update_fields=['action'])

        return Response(AuditLogSerializer(log, context={'request': request}).data, status=status.HTTP_201_CREATED)

    def create(self, request, *args, **kwargs):
        """منع الإنشاء المباشر على المسار الرئيسي؛ استخدم client-action لإجراءات المتصفح."""
        return Response(
            {'detail': 'استخدم المسار /api/audit-logs/client-action/ لتسجيل إجراءات التصدير والطباعة.'},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )



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

    # ------------------------------------------------------------------
    # Reports & Statistics v2 — ثلاث تبويبات (الموديلات / الإنتاج / العجز)
    # كل النتائج مجمّعة على السيرفر ولا تتضمن أي أسعار أو تكاليف.
    # ------------------------------------------------------------------
    def _reports_guard(self, request, require_edit=False):
        ensure_initial_seed()
        profile = resolve_request_user_profile(request)
        if profile is None or getattr(profile, 'is_sudo', False):
            return profile, None
        can_view = profile.has_perm('can_reports') or profile.has_perm('reports_view')
        if not can_view:
            return profile, Response(
                {'error': 'ليس لديك صلاحية الاطلاع على التقارير والإحصائيات. يرجى مراجعة إدارة النظام.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        if require_edit:
            can_edit = profile.has_perm('reports_edit')
            if not can_edit:
                return profile, Response(
                    {'error': 'ليس لديك صلاحية تعديل تارجتات الأقسام.'},
                    status=status.HTTP_403_FORBIDDEN,
                )
        return profile, None

    @action(detail=False, methods=['get'], url_path='models')
    def models_report(self, request):
        _profile, denied = self._reports_guard(request)
        if denied:
            return denied
        data = get_models_report(
            metric=request.query_params.get('metric', 'models'),
            date_from=request.query_params.get('date_from'),
            date_to=request.query_params.get('date_to'),
            composition=request.query_params.get('composition'),
            model_type=request.query_params.get('model_type'),
            stage=request.query_params.get('stage'),
        )
        return Response(data)

    @action(detail=False, methods=['get'], url_path='production')
    def production_report(self, request):
        _profile, denied = self._reports_guard(request)
        if denied:
            return denied
        data = get_production_departments_report(
            period=request.query_params.get('period', 'today'),
            date_from=request.query_params.get('date_from'),
            date_to=request.query_params.get('date_to'),
        )
        return Response(data)

    @action(detail=False, methods=['get'], url_path='quality')
    def quality_report(self, request):
        _profile, denied = self._reports_guard(request)
        if denied:
            return denied
        data = get_quality_shortage_report(
            search=request.query_params.get('search'),
            sort=request.query_params.get('sort', 'shortage'),
            date_from=request.query_params.get('date_from'),
            date_to=request.query_params.get('date_to'),
        )
        return Response(data)

    @action(detail=False, methods=['get'], url_path='quality/stages')
    def quality_stages(self, request):
        _profile, denied = self._reports_guard(request)
        if denied:
            return denied
        try:
            model_id = int(request.query_params.get('model_id'))
        except (TypeError, ValueError):
            return Response(
                {'error': 'معرّف الموديل مطلوب.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        data = get_model_stage_waterfall(model_id)
        if data is None:
            return Response({'error': 'الموديل غير موجود.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(data)

    @action(detail=False, methods=['get', 'post'], url_path='targets')
    def targets(self, request):
        if request.method.lower() == 'post':
            profile, denied = self._reports_guard(request, require_edit=True)
            if denied:
                return denied
            payload = request.data if isinstance(request.data, dict) else {}
            inner = payload.get('targets') if isinstance(payload.get('targets'), dict) else payload
            before_targets = get_department_targets()
            targets = save_department_targets(inner)
            dept_names = {
                'cutting': 'القص',
                'printing': 'المطابع',
                'qc': 'العد والجودة',
                'sewing': 'المكن',
                'finishing': 'التشطيب',
                'ironing': 'المكواة',
                'packaging': 'التعبئة والتغليف',
            }
            target_changes = []
            for dept_key, new_vals in (targets or {}).items():
                old_vals = (before_targets or {}).get(dept_key) or {}
                if old_vals != new_vals:
                    label = dept_names.get(dept_key, dept_key)
                    target_changes.append({
                        'field': f'target_{dept_key}',
                        'label': f'تارجت قسم {label}',
                        'old': f"يومي: {old_vals.get('daily', 0)} / شهري: {old_vals.get('monthly', 0)}",
                        'new': f"يومي: {new_vals.get('daily', 0)} / شهري: {new_vals.get('monthly', 0)}",
                    })
            log_action(
                request,
                section='التقارير',
                action_type='settings',
                target_name='تارجتات الأقسام',
                details='تحديث التارجت اليومي / الشهري لأقسام الإنتاج',
                changes=target_changes,
                user=profile,
            )
            return Response({'targets': targets, 'can_edit': True})

        profile, denied = self._reports_guard(request)
        if denied:
            return denied
        can_edit = (
            profile is None
            or getattr(profile, 'is_sudo', False)
            or profile.has_perm('reports_edit')
        )
        return Response({
            'targets': get_department_targets(),
            'can_edit': bool(can_edit),
        })


# ---------------------------------------------------------------------------
# Human Resources (HR) - الموارد البشرية
# ---------------------------------------------------------------------------


FACTORY_RESET_SECTIONS = {
    'production': 'الموديلات وخط الإنتاج بالكامل (يشمل مخزن الإنتاج التام)',
    'fabric': 'مخزن القماش (الأصناف والألوان وحركات الوارد/الصادر)',
    'accessories': 'مخزن الإكسسوارات (التصنيفات والأصناف والحركات)',
    'packaging_materials': 'خامات التشغيل والتعبئة (الفئات والمقاسات والحركات)',
    'suppliers_workshops': 'الموردون والورش',
    'hr': 'بيانات الموارد البشرية (الوظائف والموظفين والحضور والجزاءات والسُلف)',
    'users_roles': 'حسابات المستخدمين والأدوار والصلاحيات (مع الإبقاء على sudo فقط)',
    'audit_logs': 'سجل التدقيق والرسائل الداخلية',
}


def _count_and_delete(queryset, label, summary):
    """يعُدّ السجلات ثم يحذفها دفعة واحدة ويسجّل العدد في الملخّص."""
    total = queryset.count()
    if total:
        queryset.delete()
    summary[label] = summary.get(label, 0) + total
    return total


class FactoryResetViewSet(viewsets.ViewSet):
    """
    تصفير انتقائي لبيانات المصنع. العملية محمية بحساب sudo فقط وتُنفَّذ داخل
    ``transaction.atomic()`` بترتيب آمن يتفادى قيود ``PROTECT`` في PostgreSQL
    (HRJobTitle هو الحقل الوحيد المحمي عبر HREmployee.job).
    """

    def list(self, request):
        """يعيد تعريف الأقسام المتاحة للتصفير (للاستخدام في الواجهة)."""
        return Response({
            'sections': [
                {'key': key, 'label': label}
                for key, label in FACTORY_RESET_SECTIONS.items()
            ]
        })

    def create(self, request):
        profile = getattr(request, 'user_profile', None) or resolve_request_user_profile(request)
        if not is_sudo_profile(profile):
            return Response(
                {'detail': 'هذه العملية مخصصة لحساب sudo فقط ولا يمكن تنفيذها من أي حساب آخر.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        raw_sections = request.data.get('sections')
        if not isinstance(raw_sections, list):
            return Response(
                {'detail': 'يجب إرسال قائمة الأقسام المطلوب تصفيرها.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        selected = {str(item).strip() for item in raw_sections if str(item).strip()}
        unknown = selected - set(FACTORY_RESET_SECTIONS.keys())
        if unknown:
            return Response(
                {'detail': f'أقسام غير معروفة: {", ".join(sorted(unknown))}'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not selected:
            return Response(
                {'detail': 'لم يتم تحديد أي قسم للتصفير.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        confirmation = str(request.data.get('confirmation') or '').strip()
        if confirmation != 'تأكيد':
            return Response(
                {'detail': 'كلمة التأكيد غير صحيحة. اكتب «تأكيد» للمتابعة.'},
                status=status.HTTP_400_BAD_REQUEST,
            )


        summary = {}
        notes = []

        with transaction.atomic():
            # 1) الرسائل الداخلية أولاً لأنها مرتبطة بالمستخدمين بـ CASCADE.
            if selected & {'users_roles', 'audit_logs'}:
                _count_and_delete(InternalMessage.objects.all(), 'الرسائل الداخلية', summary)

            # 2) الموارد البشرية: الحضور/الجزاءات/السُلف ← الموظفين ← الوظائف (PROTECT).
            if 'hr' in selected:
                _count_and_delete(HRPayrollSnapshot.objects.all(), 'كشوف الرواتب المعتمدة', summary)
                _count_and_delete(HRAttendanceRecord.objects.all(), 'سجلات الحضور', summary)
                _count_and_delete(HRPenalty.objects.all(), 'الجزاءات', summary)
                _count_and_delete(HRLoan.objects.all(), 'السُلف', summary)
                _count_and_delete(HREmployee.objects.all(), 'الموظفين', summary)
                _count_and_delete(HRJobTitle.objects.all(), 'الوظائف', summary)
                _count_and_delete(HRAttendanceSettings.objects.all(), 'إعدادات الحضور', summary)

            # 3) خامات التشغيل: الحركات ← المقاسات ← الفئات.
            if 'packaging_materials' in selected:
                _count_and_delete(PackagingMaterialTransaction.objects.all(), 'حركات خامات التشغيل', summary)
                _count_and_delete(PackagingMaterialSizeRule.objects.all(), 'مقاسات خامات التشغيل', summary)
                _count_and_delete(PackagingMaterialRule.objects.all(), 'فئات خامات التشغيل', summary)

            # 4) خط الإنتاج بالكامل (الأبناء قبل الآباء).
            if 'production' in selected:
                _count_and_delete(AppNotification.objects.all(), 'التنبيهات', summary)
                _count_and_delete(CuttingSpreadLayer.objects.all(), 'طبقات القص', summary)
                _count_and_delete(CuttingRecord.objects.all(), 'سجلات القص', summary)
                _count_and_delete(QCRecord.objects.all(), 'سجلات الفرز والجودة', summary)
                _count_and_delete(PrintDispatch.objects.all(), 'أوامر المطابع', summary)
                _count_and_delete(SewingDispatch.objects.all(), 'أوامر المكن', summary)
                _count_and_delete(FinishingRecord.objects.all(), 'سجلات التشطيب', summary)
                _count_and_delete(AssemblyStageRecord.objects.all(), 'سجلات الأسمبلي', summary)
                _count_and_delete(PackagingRequirement.objects.all(), 'متطلبات التعبئة', summary)
                _count_and_delete(ModelRequirement.objects.all(), 'متطلبات الموديلات', summary)
                _count_and_delete(ModelAccessory.objects.all(), 'إكسسوارات الموديلات', summary)
                _count_and_delete(ModelTimeline.objects.all(), 'سجل مراحل الموديلات', summary)
                _count_and_delete(ModelItem.objects.all(), 'الموديلات', summary)

            # 5) مخزن القماش.
            if 'fabric' in selected:
                if 'production' not in selected:
                    notes.append(
                        'حذف ألوان القماش يزيل تلقائياً متطلبات الألوان المرتبطة بالموديلات (CASCADE).'
                    )
                _count_and_delete(FabricTransaction.objects.all(), 'حركات القماش', summary)
                _count_and_delete(FabricColor.objects.all(), 'ألوان القماش', summary)
                _count_and_delete(Fabric.objects.all(), 'أصناف القماش', summary)

            # 6) مخزن الإكسسوارات.
            if 'accessories' in selected:
                _count_and_delete(AccessoryTransaction.objects.all(), 'حركات الإكسسوارات', summary)
                _count_and_delete(Accessory.objects.all(), 'أصناف الإكسسوارات', summary)
                _count_and_delete(AccessoryType.objects.all(), 'تصنيفات الإكسسوارات', summary)

            # 7) الموردون والورش.
            if 'suppliers_workshops' in selected:
                _count_and_delete(Supplier.objects.all(), 'الموردون', summary)
                _count_and_delete(Workshop.objects.all(), 'الورش', summary)


            # 8) الحسابات والأدوار — مع الإبقاء الإجباري على حساب sudo.
            if 'users_roles' in selected:
                keep_sudo_filter = Q(username__iexact='sudo') | Q(is_sudo=True)
                _count_and_delete(
                    UserProfile.objects.exclude(keep_sudo_filter),
                    'حسابات المستخدمين',
                    summary,
                )
                _count_and_delete(Role.objects.all(), 'الأدوار الوظيفية', summary)
                notes.append('تم الإبقاء على حساب sudo فقط، وأي حساب أو دور وظيفي آخر تم حذفه.')

            # 9) سجل التدقيق (بعد كل شيء).
            if 'audit_logs' in selected:
                _count_and_delete(AuditLog.objects.all(), 'سجلات التدقيق', summary)

        # سجل تدقيق دائم لعملية التصفير نفسها (حتى لو مُسح السجل القديم).
        summary_parts = [f'{label}: {count}' for label, count in summary.items() if count]
        forwarded_for = (request.META.get('HTTP_X_FORWARDED_FOR', '') or '').split(',')[0].strip()
        try:
            AuditLog.objects.create(
                user_id_ref=str(getattr(profile, 'client_id', '') or getattr(profile, 'id', '') or ''),
                user_name='sudo',
                user_full_name=str(getattr(profile, 'real_name', '') or 'sudo'),
                section='سجل المراقبة',
                action_type='custom',
                action='تصفير بيانات المصنع (Factory Reset)',
                target_name='Factory Reset',
                details='تصفير انتقائي للأقسام: ' + ('، '.join(summary_parts) or 'لا يوجد'),
                changes=[],
                ip_address=forwarded_for or request.META.get('REMOTE_ADDR', '127.0.0.1'),
                timestamp=timezone.now().strftime('%Y-%m-%d %H:%M:%S'),
            )
        except Exception:
            # لا نُفشل العملية بسبب تعذّر كتابة سجل التدقيق.
            pass

        return Response({
            'status': 'success',
            'summary': summary,
            'total': sum(summary.values()),
            'sections': sorted(selected),
            'notes': notes,
        })


# ---------------------------------------------------------------------------
# Dynamic PWA Web App Manifest (GET /api/manifest.webmanifest)
# ---------------------------------------------------------------------------
def _infer_icon_mime_type(url: str) -> str:
    """استنتاج نوع الصورة (MIME type) من امتداد رابط الشعار."""
    try:
        path = urllib.parse.urlparse(url).path.lower()
    except Exception:
        path = str(url or '').lower()
    if path.endswith('.webp'):
        return 'image/webp'
    if path.endswith('.jpg') or path.endswith('.jpeg'):
        return 'image/jpeg'
    if path.endswith('.svg'):
        return 'image/svg+xml'
    return 'image/png'


def _is_valid_manifest_logo_url(value: str) -> bool:
    """هل قيمة الشعار رابط صورة صالح (http/https أو مسار صورة محلي) وليس رمزاً تعبيرياً؟"""
    raw = str(value or '').strip()
    if not raw or raw.startswith('data:'):
        return False
    if raw.startswith('/'):
        return len(raw) > 1
    try:
        parsed = urllib.parse.urlparse(raw)
        return parsed.scheme in ('http', 'https') and bool(parsed.netloc)
    except Exception:
        return False


def pwa_manifest_view(request):
    """
    نقطة عامة (بدون مصادقة) تعيد ملف ``manifest.webmanifest`` ديناميكياً
    باسم المصنع وشعاره من ``GlobalSettings`` مع أيقونات احتياطية ثابتة.
    """
    import json

    site_name = 'Factory ERP'
    logo_val = ''
    try:
        obj = GlobalSettings.get_solo()
        candidate_name = str(getattr(obj, 'site_name', '') or '').strip()
        if candidate_name:
            site_name = candidate_name
        logo_val = str(
            getattr(obj, 'logo_url', '') or getattr(obj, 'logo', '') or ''
        ).strip()
    except Exception:
        pass

    short_name = site_name[:24].strip() if len(site_name) > 24 else site_name
    if _is_valid_manifest_logo_url(logo_val):
        mime_type = _infer_icon_mime_type(logo_val)
        icons = [
            {
                'src': logo_val,
                'sizes': '192x192',
                'type': mime_type,
                'purpose': 'any maskable',
            },
            {
                'src': logo_val,
                'sizes': '512x512',
                'type': mime_type,
                'purpose': 'any maskable',
            },
        ]
    else:
        icons = [
            {
                'src': '/icons/icon-192.png',
                'sizes': '192x192',
                'type': 'image/png',
                'purpose': 'any maskable',
            },
            {
                'src': '/icons/icon-512.png',
                'sizes': '512x512',
                'type': 'image/png',
                'purpose': 'any maskable',
            },
        ]

    manifest = {
        'id': '/',
        'name': site_name,
        'short_name': short_name,
        'description': f'{site_name} — نظام إدارة مصانع الملابس الجاهزة المتكامل',
        'start_url': '/',
        'scope': '/',
        'display': 'standalone',
        'orientation': 'any',
        'dir': 'rtl',
        'lang': 'ar',
        'theme_color': '#0f172a',
        'background_color': '#f8f9fa',
        'icons': icons,
    }

    response = HttpResponse(
        json.dumps(manifest, ensure_ascii=False),
        content_type='application/manifest+json; charset=utf-8',
    )
    response['Cache-Control'] = 'no-cache, max-age=0'
    return response

