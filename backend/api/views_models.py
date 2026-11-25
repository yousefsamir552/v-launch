from .views_common import *
from .views_common import _truthy_permission_keys, _accessory_price_snapshot
from .services_pipeline import refund_model_consumed_inventory

class ModelItemViewSet(BasePermViewSet):
    queryset = ModelItem.objects.filter(is_deleted=False).prefetch_related(
        'timeline', 'accessories', 'requirements', 'requirements__color'
    )
    serializer_class = ModelItemSerializer

    # أقسام يُسمح لها بقراءة الموديلات (كل قسم تشغيلي يعرض الموديلات في واجهته).
    MODEL_READ_SECTIONS = (
        'design', 'cutting', 'printing', 'qc', 'sewing',
        'assembly_packaging', 'tracking', 'production_wh',
    )
    # كل @action مرتبط بالقسم الذي ينفّذه فعلياً في الواجهة.
    MODEL_ACTION_SECTIONS = {
        'update_plan': 'design',
        'issue_fabric_to_cutting': 'design',
        'return_fabric_to_warehouse': 'cutting',
        'finish_cutting': 'cutting',
        'record_qc_count': 'qc',
        'finish_qc_approval': 'qc',
        'finish_qc_to_production': 'qc',
        'dispatch_to_sewing': 'sewing',
        'finish_sewing': 'sewing',
        'receive_from_print': 'printing',
        'packaging_requirement': 'assembly_packaging',
        'set_packaging_step': 'assembly_packaging',
        'start_finishing': 'assembly_packaging',
        'receive_finishing': 'assembly_packaging',
        'start_ironing': 'assembly_packaging',
        'receive_ironing': 'assembly_packaging',
        'start_assembly_stage': 'assembly_packaging',
        'receive_assembly_stage': 'assembly_packaging',
        'part_stages': 'assembly_packaging',
        'create': 'design',
        'destroy': 'design',
    }
    MODEL_WRITE_PERMS = (
        'design_edit', 'cutting_edit', 'printing_edit', 'qc_edit',
        'sewing_edit', 'assembly_packaging_edit',
    )

    def _section_allowed(self, profile, section, require_edit: bool = False) -> bool:
        perm_field = HasDynamicSectionPermission.section_perm_map.get(section)
        if not perm_field:
            return False
        edit_field = perm_field.replace('_view', '_edit')
        if require_edit:
            return profile.has_perm(edit_field)
        return profile.has_perm(perm_field) or profile.has_perm(edit_field)

    def initial(self, request, *args, **kwargs):
        """يمنع الوصول الكامل للموديلات لمن لا يملك أي قسم تشغيلي، ويمنع تنفيذ
        إجراءات قسم آخر (مثلاً: مندوب المكن لا يستطيع إنشاء موديل أو حذفه)."""
        super().initial(request, *args, **kwargs)
        profile = getattr(request, 'user_profile', None)
        if is_sudo_account(profile):
            return
        if profile is None:
            raise PermissionDenied('مطلوب تسجيل الدخول')

        if request.method in permissions.SAFE_METHODS:
            if not any(self._section_allowed(profile, s) for s in self.MODEL_READ_SECTIONS):
                raise PermissionDenied('ليس لديك صلاحية عرض الموديلات')
            return

        action_name = getattr(self, 'action', None)
        # إرجاع فائض القماش للمخزن متاح لقسم القص أو لمخزن القماش (تعديل).
        if action_name == 'return_fabric_to_warehouse' and profile.has_perm('fabric_warehouse_edit'):
            return
        # صرف وتسليم إكسسوارات الموديل محصور في صلاحية تعديل مخزن الإكسسوارات فقط.
        if action_name == 'issue_accessories' and profile.has_perm('accessories_warehouse_edit'):
            return
        if action_name == 'issue_accessories':
            raise PermissionDenied('صرف الإكسسوارات مخصص لصلاحية مخزن الإكسسوارات فقط')
        # فحص واسترداد أرصدة الموديلات المحذوفة متاح لحساب sudo أو مدير النظام.
        if action_name == 'refund_deleted_inventory' and profile.has_perm('manage_permissions'):
            return
        section = self.MODEL_ACTION_SECTIONS.get(action_name)
        if section:
            require_edit = request.method not in permissions.SAFE_METHODS
            if not self._section_allowed(profile, section, require_edit=require_edit):
                raise PermissionDenied('ليس لديك صلاحية تنفيذ هذا الإجراء في هذا القسم')
            return

        # update / add_timeline / أي إجراء غير مصنّف: يتطلب صلاحية تعديل تشغيلية عامة.
        if not any(profile.has_perm(perm) for perm in self.MODEL_WRITE_PERMS):
            raise PermissionDenied('ليس لديك صلاحية تعديل الموديلات')

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
        notes_jacket = (data.get('notes_jacket') or data.get('notesJacket') or '') if can_design_notes else ''
        user_name = data.get('user_name') or (profile.real_name if profile else 'مسؤول التصميم')

        model = ModelItem(
            client_id=data.get('id') or data.get('client_id'),
            model_code=clean_code,
            model_type=data.get('model_type') or data.get('modelType') or 'أولادي',
            size_category_id=data.get('size_category_id') or data.get('sizeCategoryId') or '',
            image=clean_image_value(
                data.get('image') or data.get('imageUrl')
                or 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500&auto=format&fit=crop&q=60',
                'models',
                'صورة الموديل',
            ),
            status=data.get('status') or 'مرحلة التصميم',
            target_cut_quantity=target_qty,
            design_notes=design_notes,
            notes_shirt=notes_shirt,
            notes_pants=notes_pants,
            notes_jacket=notes_jacket,
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
                'notes_jacket': notes_jacket,
                'operator_name': user_name,
                'worker_notes': design_notes or notes_shirt or notes_pants or notes_jacket,
            }
        )
        return Response(ModelItemSerializer(model, context={'request': request}).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        model = self.get_object()
        data = request.data
        profile = getattr(request, 'user_profile', None)
        is_sudo = is_sudo_account(profile)
        can_design = is_sudo or (profile is not None and profile.has_perm('design_edit'))
        can_design_notes = is_sudo or (profile is not None and profile.has_perm('can_add_design_notes'))
        can_cut = is_sudo or (profile is not None and profile.has_perm('cutting_edit'))

        # التعديل المباشر مخصص لبيانات التصميم فقط؛ باقي المراحل تُحدَّث عبر
        # إجراءات القسم المخصصة (finish_cutting / record_qc_count / ...).
        allowed_fields = set()
        if can_design:
            allowed_fields.update({
                'model_type', 'size_category_id', 'main_marker_url', 'print_marker_url',
                'target_cut_quantity', 'image', 'garment_composition', 'garmentComposition',
                'model_code', 'modelCode',
            })
        if can_design_notes:
            allowed_fields.update({'design_notes', 'notes_shirt', 'notes_pants', 'notes_jacket', 'target_cut_quantity'})
        if can_cut:
            allowed_fields.add('actual_cut_count')

        if not allowed_fields:
            raise PermissionDenied('ليس لديك صلاحية تعديل بيانات الموديل')

        forbidden = [key for key in data.keys() if key not in allowed_fields]
        if forbidden:
            raise PermissionDenied(
                'لا يمكن تعديل الحقول التالية من هذه الشاشة: ' + ', '.join(sorted(forbidden))
            )

        # تعديل كود الموديل: تنظيفه، منع التكرار مع الموديلات النشطة، ومزامنة
        # حركات المخزن المرتبطة بالكود القديم حتى لا تفقد ارتباطها بالموديل.
        if 'model_code' in data or 'modelCode' in data:
            clean_code = str(data.get('model_code') or data.get('modelCode') or '').strip().upper()
            if not clean_code:
                return Response(
                    {'detail': 'كود الموديل مطلوب ولا يمكن أن يكون فارغاً'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if len(clean_code) > 100:
                return Response(
                    {'detail': 'كود الموديل يجب ألا يتجاوز 100 حرف'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if ModelItem.objects.filter(
                model_code__iexact=clean_code, is_deleted=False
            ).exclude(pk=model.pk).exists():
                return Response(
                    {'detail': 'كود الموديل مستخدم بالفعل لموديل آخر!'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # تعارض محتمل مع موديل محذوف مؤقتاً يحمل نفس الكود (unique constraint):
            # يُحذف نهائياً تماماً كما يفعل إنشاء الموديل، لتفادي خطأ حفظ غير واضح.
            soft_deleted_collision = ModelItem.objects.filter(
                model_code__iexact=clean_code, is_deleted=True
            ).exclude(pk=model.pk).first()
            if soft_deleted_collision:
                soft_deleted_collision.delete()
            if clean_code != model.model_code:
                old_code = model.model_code
                FabricTransaction.objects.filter(model_code_ref__iexact=old_code).update(
                    model_code_ref=clean_code
                )
                AccessoryTransaction.objects.filter(model_code_ref__iexact=old_code).update(
                    model_code_ref=clean_code
                )
                model.model_code = clean_code

        for field in [
            'model_type', 'size_category_id', 'main_marker_url', 'print_marker_url',
            'target_cut_quantity',
        ]:
            if field in data:
                setattr(model, field, data[field])

        if 'image' in data:
            model.image = clean_image_value(data.get('image') or '', 'models', 'صورة الموديل')

        for note_field in ['design_notes', 'notes_shirt', 'notes_pants', 'notes_jacket']:
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
        """حذف الموديل (حذف منطقي) مع حارس تأكيد لما بعد القص واسترداد ما صُرف فعلياً."""
        model = self.get_object()
        profile = getattr(request, 'user_profile', None)
        data = getattr(request, 'data', {}) or {}
        has_entered_cutting = (
            (model.status not in ('مرحلة التصميم', 'تصميم'))
            or model.cutting_records.exists()
        )
        confirm_override = (
            str(request.query_params.get('confirm_post_cutting') or '').strip().lower() in ('1', 'true', 'yes')
            or bool(data.get('confirm_post_cutting'))
            or bool(data.get('force'))
        )
        if has_entered_cutting and not confirm_override:
            return Response(
                {
                    'detail': (
                        f'تحذير: الموديل ({model.model_code}) دخل أو تجاوز مرحلة القص بالفعل '
                        f'(الحالة الحالية: {model.status}). يتطلب حذفه تأكيداً صريحاً.'
                    ),
                    'requires_post_cutting_confirmation': True,
                    'model_status': model.status,
                },
                status=status.HTTP_409_CONFLICT,
            )
        user_name = (
            (data.get('user_name') or '').strip()
            or (getattr(profile, 'real_name', '') if profile else '')
            or 'مسؤول التصميم'
        )
        with transaction.atomic():
            if not model.is_deleted:
                model.is_deleted = True
                model._skip_timeline_signal = True
                model.save()
                refund_summary = refund_model_consumed_inventory(model, user_name)
            else:
                refund_summary = {
                    'model_code': model.model_code,
                    'fabric_colors_count': 0,
                    'fabric_total_quantity': 0,
                    'fabric_details': [],
                    'accessories_count': 0,
                    'accessories_total_quantity': 0,
                    'accessory_details': [],
                }
            sync_reserved_quantities()
        return Response({'status': 'deleted', 'refund_summary': refund_summary})

    @action(detail=False, methods=['post'])
    def refund_deleted_inventory(self, request):
        """فحص واسترداد أرصدة الموديلات المحذوفة سابقاً دفعة واحدة (sudo / manage_permissions).

        العملية آمنة تماماً وقابلة للتكرار: لكل موديل محذوف يُحسب الصافي المنصرف
        فعلياً (deduct - add) لكل لون قماش وكل إكسسوار، ولا يُضاف للمخزن إلا ما
        لم يُعَد مسبقاً. تُرجع تقريراً مفصلاً بالكميات التي عادت لكل موديل.
        """
        profile = getattr(request, 'user_profile', None)
        if not is_sudo_account(profile) and (
            profile is None or not profile.has_perm('manage_permissions')
        ):
            raise PermissionDenied('هذا الإجراء متاح لحساب sudo أو مدير النظام فقط')

        data = request.data or {}
        user_name = (
            (data.get('user_name') or '').strip()
            or (getattr(profile, 'real_name', '') if profile else '')
            or 'مدير النظام'
        )

        refunded_models = []
        with transaction.atomic():
            deleted_models = list(
                ModelItem.objects.filter(is_deleted=True).order_by('model_code')
            )
            for model in deleted_models:
                summary = refund_model_consumed_inventory(model, user_name)
                if not (summary['fabric_colors_count'] or summary['accessories_count']):
                    continue
                refunded_models.append({
                    'model_id': get_ext_id(model),
                    'model_code': summary['model_code'],
                    'fabric_colors_count': summary['fabric_colors_count'],
                    'fabric_total_quantity': summary['fabric_total_quantity'],
                    'fabric_details': summary['fabric_details'],
                    'accessories_count': summary['accessories_count'],
                    'accessories_total_quantity': summary['accessories_total_quantity'],
                    'accessory_details': summary['accessory_details'],
                })
            sync_reserved_quantities()

        total_fab_qty = round(sum(m['fabric_total_quantity'] for m in refunded_models), 2)
        total_acc_qty = round(sum(m['accessories_total_quantity'] for m in refunded_models), 2)
        set_audit_meta(
            request,
            section='الإعدادات',
            action_type='transaction',
            target_name='الموديلات المحذوفة',
            details=(
                f"فحص واسترداد أرصدة الموديلات المحذوفة: تم استرداد {len(refunded_models)} موديل "
                f"(قماش: {total_fab_qty:g}، إكسسوارات: {total_acc_qty:g})"
            ),
            changes=[
                {'field': 'refunded_models', 'label': 'الموديلات المستردة', 'old': '0', 'new': str(len(refunded_models))},
                {'field': 'fabric_quantity', 'label': 'كمية القماش المستردة', 'old': '0', 'new': f'{total_fab_qty:g}'},
                {'field': 'accessories_quantity', 'label': 'كمية الإكسسوارات المستردة', 'old': '0', 'new': f'{total_acc_qty:g}'},
            ],
        )

        return Response({
            'status': 'ok',
            'total_deleted_models': len(deleted_models),
            'total_models_refunded': len(refunded_models),
            'total_fabric_quantity': total_fab_qty,
            'total_accessories_quantity': total_acc_qty,
            'refunded_models': refunded_models,
        })

    @action(detail=True, methods=['post'])
    def update_plan(self, request, pk=None):
        model = self.get_object()
        data = request.data
        profile = getattr(request, 'user_profile', None)
        can_design_notes = True if not profile else profile.has_perm('can_add_design_notes')

        req_quantities = data.get('reqQuantities') or {}
        acc_quantities = data.get('accQuantities') or {}

        plan_changes = []
        with transaction.atomic():
            for req_id, qty in req_quantities.items():
                req_obj = resolve_by_id(ModelRequirement, req_id)
                if req_obj and req_obj.model_id == model.id:
                    old_q = float(req_obj.planned_quantity or 0)
                    new_q = max(0.0, float(qty or 0))
                    if old_q != new_q:
                        req_obj.planned_quantity = new_q
                        req_obj.save()
                        plan_changes.append({
                            'field': f'req_{req_obj.pk}',
                            'label': f'كمية قماش ({req_obj.part_name or "متطلب"})',
                            'old': f'{old_q:g}',
                            'new': f'{new_q:g}',
                        })

            for acc_id, qty in acc_quantities.items():
                acc_obj = resolve_by_id(ModelAccessory, acc_id)
                if acc_obj and acc_obj.model_id == model.id and not acc_obj.is_issued:
                    old_q = float(acc_obj.planned_quantity or 0)
                    new_q = max(0.0, float(qty or 0))
                    if old_q != new_q:
                        acc_obj.planned_quantity = new_q
                        acc_obj.save()
                        plan_changes.append({
                            'field': f'acc_{acc_obj.pk}',
                            'label': f'كمية إكسسوار ({acc_obj.accessory_name or acc_obj.accessory_code})',
                            'old': f'{old_q:g}',
                            'new': f'{new_q:g}',
                        })

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
                if 'notesJacket' in data:
                    model.notes_jacket = data['notesJacket'] or ''
                if 'notes_jacket' in data:
                    model.notes_jacket = data['notes_jacket'] or ''
            if 'targetCutQuantity' in data and data['targetCutQuantity'] is not None:
                model.target_cut_quantity = int(data['targetCutQuantity'])

            model._skip_timeline_signal = True
            model.save()

            # Sync reserved_quantity (deducted from Available for Design only, NOT from actual total stock)
            sync_reserved_quantities()

        if plan_changes:
            set_audit_meta(request, extra_changes=plan_changes)

        return Response(ModelItemSerializer(model, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def issue_fabric_to_cutting(self, request, pk=None):
        target_model = self.get_object()
        now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
        user_name = request.data.get('user_name') or 'مسؤول التصميم'

        issued_fabrics = []
        pending_accessories = []

        with transaction.atomic():
            # قفل سجل الموديل داخل المعاملة لمنع أي صرف مزدوج متزامن.
            model = ModelItem.objects.select_for_update().get(pk=target_model.pk)
            if model.status not in ('مرحلة التصميم', 'تصميم'):
                return Response(
                    {
                        'error': 'تم صرف خامات هذا الموديل وتحويله لقسم القص مسبقاً ولا يمكن إعادة صرفه أو نقله مرة أخرى.'
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

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
                if acc_obj and acc_obj.model_id == model.id and not acc_obj.is_issued:
                    acc_obj.planned_quantity = max(0.0, float(qty or 0))
                    acc_obj.save()

            reqs = list(model.requirements.select_related('color', 'color__fabric').all())
            needed_by_color = {}
            for req in reqs:
                if float(req.planned_quantity or 0) > 0 and req.color_id:
                    needed_by_color[req.color_id] = round(
                        needed_by_color.get(req.color_id, 0.0) + float(req.planned_quantity or 0),
                        2,
                    )

            # قفل كل ألوان القماش المطلوبة والتحقق من كفاية الرصيد قبل خصم أي لون.
            locked_colors = {}
            shortages = []
            for color_pk in sorted(needed_by_color.keys()):
                col = FabricColor.objects.select_for_update().select_related('fabric').get(pk=color_pk)
                locked_colors[color_pk] = col
                need = needed_by_color[color_pk]
                avail = round(float(col.quantity or 0), 2)
                if avail + 1e-6 < need:
                    shortages.append(
                        f"{col.fabric.name} ({col.color_code}): المتوفر {avail:g} والمطلوب {need:g}"
                    )
            if shortages:
                return Response(
                    {
                        'error': 'رصيد مخزن القماش لا يكفي لصرف خامات الموديل: ' + ' | '.join(shortages),
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            for req in reqs:
                if float(req.planned_quantity or 0) > 0 and req.color_id in locked_colors:
                    col = locked_colors[req.color_id]
                    col.quantity = max(0.0, round(float(col.quantity or 0) - float(req.planned_quantity), 2))
                    col.reserved_quantity = max(0.0, round(float(col.reserved_quantity or 0) - float(req.planned_quantity), 2))
                    col.save()
                    if not req.unit_price_snapshot:
                        # التقاط السعر التاريخي للمتطلب إن لم يُلتقط وقت الربط.
                        req.unit_price_snapshot = col.price_per_unit or 0
                        req.save(update_fields=['unit_price_snapshot'])
                    FabricTransaction.objects.create(
                        color=col,
                        fabric=col.fabric,
                        model_code_ref=model.model_code,
                        notes=f"صرف خامات للقص - قطعة: {req.part_name}",
                        operation='deduct',
                        amount=req.planned_quantity,
                        timestamp=now_str,
                        # سعر الوحدة التاريخي وقت الصرف (يُستخدم في قسم الحسابات لاحقاً).
                        unit_price_snapshot=col.price_per_unit or 0,
                        # ربط المورد تلقائياً من بطاقة الخامة المسجل عليها المورد.
                        supplier=resolve_supplier_link(
                            None,
                            getattr(col.fabric, 'supplier_id_ref', None),
                            getattr(col.fabric, 'supplier', None),
                        ),
                    )
                    issued_fabrics.append({
                        'part_name': req.part_name,
                        'fabric_name': col.fabric.name,
                        'color_code': col.color_code,
                        'planned_quantity': req.planned_quantity,
                        'unit': col.fabric.unit,
                    })

            # الإكسسوارات لا تُخصم من الرصيد الفعلي هنا؛ تبقى محجوزة (reserved) حتى
            # يؤكّد أمين مخزن الإكسسوارات الصرف الفعلي من شاشة «أذونات صرف الموديلات».
            # نسجّل فقط قائمة معلوماتية بما هو بانتظار الصرف في التايم لاين.
            # استعلام جديد يتجاوز كاش الـ prefetch حتى تعكس الكميات آخر تعديل من التصميم.
            for m_acc in ModelAccessory.objects.filter(model=model).order_by('id'):
                pending_accessories.append({
                    'accessory_name': m_acc.accessory_name,
                    'target_type': m_acc.target_type,
                    'planned_quantity': float(m_acc.planned_quantity or 0),
                    'unit': m_acc.unit,
                })

            model.status = 'في القص'
            model.cut_at = timezone.now().isoformat()
            # مزامنة مراحل كل القطع مع الحالة العامة حتى لا يظهر الموديل في قسم آخر.
            set_all_part_stages(model, 'cutting', save=False)
            model._skip_timeline_signal = True
            model.save()

            # Re-sync reserved quantities after moving model to 'في القص'
            sync_reserved_quantities()

            combined_notes = f"تم صرف الأقمشة للعدد المستهدف {model.target_cut_quantity} قطعة"
            if model.design_notes:
                combined_notes += f" | ملاحظات التصميم: {model.design_notes}"
            combined_notes += " | الإكسسوارات تبقى محجوزة حتى يتم صرفها من مخزن الإكسسوارات"

            ModelTimeline.objects.create(
                model=model,
                stage='في القص',
                title='صرف القماش والتحويل لقسم القص',
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
                    'pending_accessories': pending_accessories,
                    'operator_name': user_name,
                    'worker_notes': model.design_notes or model.notes_shirt or model.notes_pants,
                }
            )

        return Response(ModelItemSerializer(model, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def issue_accessories(self, request, pk=None):
        """صرف وتسليم إكسسوارات الموديل فعلياً من مخزن الإكسسوارات.

        - يخصم الكمية نهائياً من الرصيد الفعلي ``Accessory.current_stock``.
        - يحرّر الحجز تلقائياً (is_issued = True ثم ``sync_reserved_quantities``).
        - يسجّل حركة خصم ``AccessoryTransaction`` + اسم المستلم + المنفّذ.
        - يدعم اختيارياً ``accessory_ids`` و ``quantities`` (إذا تغيّرت الكمية حسب العدد الفعلي).
        """
        model = self.get_object()
        profile = getattr(request, 'user_profile', None)
        data = request.data or {}

        issued_to = (data.get('issued_to') or data.get('issuedTo') or '').strip()
        notes = (data.get('notes') or '').strip()
        profile_name = ''
        if profile and not is_sudo_account(profile):
            profile_name = (getattr(profile, 'real_name', '') or '').strip()
        user_name = (
            (data.get('user_name') or '').strip()
            or profile_name
            or 'أمين مخزن الإكسسوارات'
        )
        now_str = timezone.now().strftime('%Y-%m-%d %H:%M')

        accessory_ids = data.get('accessory_ids') or data.get('accessoryIds') or []
        if isinstance(accessory_ids, str):
            accessory_ids = [accessory_ids]
        target_keys = {str(x).strip() for x in accessory_ids if str(x).strip()}

        raw_quantities = data.get('quantities') or data.get('accQuantities') or {}
        if not isinstance(raw_quantities, dict):
            raw_quantities = {}
        quantities = {str(k).strip(): v for k, v in raw_quantities.items()}

        target_label_map = {
            'jacket': 'جاكيت',
            'pants': 'بنطلون',
            'single': 'قطعة واحدة',
            'shirt': 'تيشرت',
        }

        issued_list = []

        with transaction.atomic():
            pending_qs = (
                ModelAccessory.objects.select_for_update()
                .filter(model=model, is_issued=False)
                .exclude(accessory_id_ref__isnull=True)
                .exclude(accessory_id_ref='')
            )
            pending = list(pending_qs)
            if target_keys:
                pending = [
                    m_acc for m_acc in pending
                    if str(m_acc.id) in target_keys or str(get_ext_id(m_acc)) in target_keys
                ]

            if not pending:
                return Response(
                    {'error': 'لا توجد إكسسوارات بانتظار الصرف لهذا الموديل.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # تجميع الكميات المطلوبة لكل إكسسوار لضمان كفاية الرصيد قبل أي خصم.
            resolved = []
            required_by_acc = {}
            for m_acc in pending:
                acc_item = resolve_by_id(Accessory, m_acc.accessory_id_ref)
                if not acc_item:
                    continue
                qty = quantities.get(str(m_acc.id))
                if qty is None:
                    qty = quantities.get(str(get_ext_id(m_acc)))
                try:
                    qty = float(qty) if qty is not None else float(m_acc.planned_quantity or 0)
                except (TypeError, ValueError):
                    qty = float(m_acc.planned_quantity or 0)
                qty = round(max(0.0, qty), 2)
                if qty <= 0:
                    continue
                resolved.append((m_acc, acc_item, qty))
                required_by_acc[acc_item.pk] = round(
                    required_by_acc.get(acc_item.pk, 0.0) + qty, 2
                )

            if not resolved:
                return Response(
                    {'error': 'الكميات المطلوبة للصرف صفرية؛ لا يوجد ما يتم صرفه.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # قفل أصناف المخزن والتحقق من كفاية الرصيد داخل نفس المعاملة.
            locked_items = {}
            shortages = []
            for acc_pk, need in required_by_acc.items():
                item = Accessory.objects.select_for_update().get(pk=acc_pk)
                locked_items[acc_pk] = item
                available = float(item.current_stock or 0)
                if available < need:
                    shortages.append(f"{item.name}: المتاح {available:g} والمطلوب {need:g}")
            if shortages:
                return Response(
                    {
                        'error': 'الرصيد الفعلي غير كافٍ لصرف بعض الإكسسوارات: '
                                 + ' | '.join(shortages)
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            for m_acc, acc_item, qty in resolved:
                item = locked_items[acc_item.pk]
                item.current_stock = max(
                    Decimal('0'),
                    to_decimal(item.current_stock, Decimal('0')) - to_decimal(qty, Decimal('0')),
                )
                item.save(update_fields=['current_stock'])

                if not m_acc.unit_price_snapshot:
                    m_acc.unit_price_snapshot = item.price_per_unit or 0

                label = target_label_map.get(m_acc.target_type, 'تيشرت')
                txn_notes = f"صرف إكسسوار للتسليم ({label}) - موديل: {model.model_code}"
                if issued_to:
                    txn_notes += f" | المستلم: {issued_to}"
                if notes:
                    txn_notes += f" | ملاحظات: {notes}"
                AccessoryTransaction.objects.create(
                    accessory=item,
                    accessory_code=item.code,
                    accessory_name=item.name,
                    operation='deduct',
                    amount=qty,
                    model_code_ref=model.model_code,
                    notes=txn_notes,
                    timestamp=now_str,
                    unit_price_snapshot=item.price_per_unit or 0,
                    supplier=resolve_supplier_link(
                        None,
                        getattr(item, 'supplier_id_ref', None),
                        getattr(item, 'supplier', None),
                    ),
                )

                m_acc.is_issued = True
                m_acc.issued_quantity = qty
                m_acc.issued_to = issued_to
                m_acc.issued_at = now_str
                m_acc.issued_by = user_name
                m_acc.save(update_fields=[
                    'is_issued', 'issued_quantity', 'issued_to', 'issued_at',
                    'issued_by', 'unit_price_snapshot',
                ])

                issued_list.append({
                    'accessory_id': get_ext_id(item),
                    'accessory_code': item.code,
                    'accessory_name': item.name,
                    'target_type': m_acc.target_type,
                    'issued_quantity': qty,
                    'unit': m_acc.unit,
                })

            # تحرير الحجز: يُعاد احتساب reserved_quantity من البنود غير المصروفة فقط.
            sync_reserved_quantities()

            notes_parts = [
                f"تم صرف {len(issued_list)} صنف إكسسوار للموديل {model.model_code}"
            ]
            if issued_to:
                notes_parts.append(f"المستلم: {issued_to}")
            notes_parts.append(f"المنفّذ: {user_name}")
            if notes:
                notes_parts.append(notes)
            combined_notes = ' | '.join(notes_parts)

            ModelTimeline.objects.create(
                model=model,
                stage=model.status or 'في القص',
                title='صرف وتسليم الإكسسوارات من مخزن الإكسسوارات',
                notes=combined_notes,
                user=user_name,
                timestamp_str=now_str,
                details={
                    'phase_type': 'accessory_issue',
                    'issued_to': issued_to,
                    'issued_by': user_name,
                    'issued_accessories': issued_list,
                    'notes': notes,
                },
            )

        # مسح كاش الـ prefetch حتى يعكس الرد أحدث حالة صرف للإكسسوارات.
        model._prefetched_objects_cache = {}
        set_audit_meta(
            request,
            section='مخزن الإكسسوارات',
            action_type='transaction',
            target_name=model.model_code,
            details=(
                f"صرف وتسليم {len(issued_list)} صنف إكسسوار للموديل {model.model_code}"
                + (f" — المستلم: {issued_to}" if issued_to else "")
            ),
            changes=[
                {
                    'field': f"issue_acc_{item['accessory_id']}",
                    'label': f"{item['accessory_name']} ({item['accessory_code']})",
                    'old': 'محجوز',
                    'new': f"تم صرف {item['issued_quantity']:g} {item['unit']}",
                }
                for item in issued_list
            ],
        )
        return Response({
            'message': 'تم صرف وتسليم الإكسسوارات وتحديث رصيد المخزن بنجاح.',
            'model': ModelItemSerializer(model, context={'request': request}).data,
            'issued_accessories': issued_list,
        })

    @action(detail=True, methods=['post'])
    def return_fabric_to_warehouse(self, request, pk=None):
        """إرجاع فائض قماش غير مستخدم من قسم القص إلى مخزن القماش."""
        model = self.get_object()
        if model.status in ('مرحلة التصميم', 'تصميم'):
            return Response(
                {'error': 'لا يمكن إرجاع قماش لموديل ما زال في مرحلة التصميم ولم يُصرف له قماش للقص بعد.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        requirement_id = (
            request.data.get('requirement_id')
            or request.data.get('requirementId')
            or request.data.get('req_id')
        )
        if not requirement_id:
            return Response(
                {'error': 'يجب تحديد متطلب القماش المراد إرجاع فائضه'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            quantity = round(float(request.data.get('quantity') or 0), 2)
        except (TypeError, ValueError):
            quantity = 0.0
        try:
            defect_quantity = round(
                float(
                    request.data.get('defect_quantity')
                    or request.data.get('defectQuantity')
                    or request.data.get('defects_quantity')
                    or request.data.get('defects')
                    or 0
                ),
                2,
            )
        except (TypeError, ValueError):
            defect_quantity = 0.0
        if quantity < 0 or defect_quantity < 0:
            return Response(
                {'error': 'كمية الإرجاع وكمية العيوب لا يمكن أن تكون سالبة'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if quantity <= 0 and defect_quantity <= 0:
            return Response(
                {'error': 'يجب إدخال كمية إرجاع أو كمية عيوب أكبر من صفر'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        total_settled = round(quantity + defect_quantity, 2)

        profile = getattr(request, 'user_profile', None)
        notes = str(request.data.get('notes') or '').strip()
        # ملاحظات القص تُحفظ فقط لمن يملك صلاحية كتابتها؛ حركة المخزن تُسجل دائماً.
        if notes and profile is not None and not profile.has_perm('can_add_cutting_notes'):
            notes = ''
        user_name = request.data.get('user_name') or (
            getattr(profile, 'real_name', '') if profile else ''
        ) or 'مسؤول القص'
        now_str = timezone.now().strftime('%Y-%m-%d %H:%M')

        with transaction.atomic():
            req = resolve_by_id(ModelRequirement, requirement_id)
            if req is None or req.model_id != model.id:
                return Response(
                    {'error': 'متطلب القماش غير موجود أو لا يتبع هذا الموديل'},
                    status=status.HTTP_404_NOT_FOUND,
                )
            req = (
                ModelRequirement.objects.select_for_update()
                .select_related('color', 'color__fabric')
                .get(pk=req.pk)
            )
            planned = round(max(0.0, float(req.planned_quantity or 0.0)), 2)
            if planned <= 0:
                return Response(
                    {'error': 'لا توجد كمية مخططة متبقية لهذا المتطلب لإرجاع فائض منها'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if total_settled > planned + 0.000001:
                return Response(
                    {
                        'error': (
                            f'إجمالي المرتجع والعيوب ({total_settled:g}) '
                            f'أكبر من الكمية المتبقية بالموديل ({planned:g})'
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not req.color_id:
                return Response(
                    {'error': 'متطلب القماش غير مرتبط بلون/صنف مخزني'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            col = (
                FabricColor.objects.select_for_update()
                .select_related('fabric')
                .get(pk=req.color_id)
            )
            new_planned = round(max(0.0, planned - total_settled), 2)
            req.planned_quantity = new_planned
            req.save(update_fields=['planned_quantity'])

            # الكمية السليمة فقط تعود للرصيد الفعلي؛ العيوب تُسجل كهدر ولا تُضاف للمخزن.
            col.quantity = round(float(col.quantity or 0.0) + quantity, 2)
            col.save(update_fields=['quantity'])

            # الحفاظ على حجوزات التصميم متوافقة مع الكميات المخططة بعد الإرجاع.
            sync_reserved_quantities()

            fabric = col.fabric
            fabric_name = fabric.name if fabric else ''
            unit = fabric.unit if fabric else ''
            color_code = col.color_code or ''
            color_name = col.color_name or ''

            txn = None
            if quantity > 0:
                txn_note = f"إرجاع فائض قماش من القص - قطعة: {req.part_name}"
                if notes:
                    txn_note += f" | ملاحظات: {notes}"
                txn = FabricTransaction.objects.create(
                    color=col,
                    fabric=col.fabric,
                    operation='add',
                    amount=quantity,
                    unit_price_snapshot=float(
                        req.unit_price_snapshot
                        or getattr(col, 'price_per_unit', 0)
                        or 0
                    ),
                    notes=txn_note,
                    model_code_ref=model.model_code or '',
                    timestamp=now_str,
                    supplier=resolve_supplier_link(
                        None,
                        getattr(col.fabric, 'supplier_id_ref', None),
                        getattr(col.fabric, 'supplier', None),
                    ),
                )

            # العيوب تُسجل كحركة مستقلة (لا تُضاف للرصيد) لتظهر في الجرد والتقارير.
            defect_txn = None
            if defect_quantity > 0:
                defect_note = (
                    f"عيب قماش / نسيج - قطعة: {req.part_name} "
                    f"(لم يُعد للمخزن لوجود عيوب)"
                )
                if notes:
                    defect_note += f" | ملاحظات: {notes}"
                defect_txn = FabricTransaction.objects.create(
                    color=col,
                    fabric=col.fabric,
                    operation='defect',
                    amount=defect_quantity,
                    unit_price_snapshot=float(
                        req.unit_price_snapshot
                        or getattr(col, 'price_per_unit', 0)
                        or 0
                    ),
                    notes=defect_note,
                    model_code_ref=model.model_code or '',
                    timestamp=now_str,
                    supplier=None,
                )

            tl_notes = (
                f"إرجاع {quantity:g} {unit} من لون {color_code or color_name} "
                f"({req.part_name}) إلى مخزن القماش | المتبقي بالموديل: {new_planned:g} {unit}"
            )
            if defect_quantity > 0:
                tl_notes += f" | عيوب قماش مسجلة: {defect_quantity:g} {unit}"
            if notes:
                tl_notes += f" | ملاحظات: {notes}"
            ModelTimeline.objects.create(
                model=model,
                stage='القص',
                title='إرجاع فائض قماش إلى المخزن',
                notes=tl_notes,
                user=user_name,
                timestamp_str=now_str,
                details={
                    'phase_type': 'cutting_fabric_return',
                    'requirement_id': get_ext_id(req),
                    'color_id': get_ext_id(col),
                    'fabric_name': fabric_name,
                    'color_code': color_code,
                    'color_name': color_name,
                    'part_name': req.part_name,
                    'unit': unit,
                    'returned_quantity': quantity,
                    'defect_quantity': defect_quantity,
                    'remaining_planned_quantity': new_planned,
                    'warehouse_quantity_after': round(float(col.quantity or 0.0), 2),
                    'operator_name': user_name,
                    'worker_notes': notes,
                },
            )

        # إظهار الحركة الجديدة داخل التايملاين المُعاد في نفس الاستجابة.
        if hasattr(model, '_prefetched_objects_cache'):
            model._prefetched_objects_cache = {}

        if defect_quantity > 0:
            message = (
                f'تم إرجاع {quantity:g} {unit} من فائض القص إلى مخزن القماش '
                f'وتسجيل {defect_quantity:g} {unit} عيوب قماش'
            )
        else:
            message = f'تم إرجاع {quantity:g} {unit} من فائض القص إلى مخزن القماش'
        ret_changes = [
            {
                'field': 'planned_quantity',
                'label': f'المتبقي بالموديل ({color_code or color_name})',
                'old': f'{planned:g} {unit}',
                'new': f'{new_planned:g} {unit}',
            },
        ]
        if quantity > 0:
            old_wh_qty = round(float(col.quantity or 0.0) - quantity, 2)
            ret_changes.append({
                'field': 'warehouse_quantity',
                'label': f'رصيد المخزن ({color_code or color_name})',
                'old': f'{old_wh_qty:g} {unit}',
                'new': f'{float(col.quantity or 0.0):g} {unit}',
            })
        if defect_quantity > 0:
            ret_changes.append({
                'field': 'defect_quantity',
                'label': 'عيوب قماش مسجلة',
                'old': '0',
                'new': f'{defect_quantity:g} {unit}',
            })
        set_audit_meta(
            request,
            action_type='transaction',
            target_name=f'{model.model_code} - {color_code or color_name}',
            details=f"{message} — الموديل {model.model_code} ({req.part_name})",
            changes=ret_changes,
        )
        return Response({
            'message': message,
            'model': ModelItemSerializer(model, context={'request': request}).data,
            'requirement': ModelRequirementSerializer(req, context={'request': request}).data,
            'color': FabricColorSerializer(col, context={'request': request}).data,
            'transaction': (
                FabricTransactionSerializer(txn, context={'request': request}).data
                if txn else None
            ),
            'defect_transaction': (
                FabricTransactionSerializer(defect_txn, context={'request': request}).data
                if defect_txn else None
            ),
        })

    @action(detail=True, methods=['post'])
    def finish_cutting(self, request, pk=None):
        model = self.get_object()
        now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
        user_name = request.data.get('user_name') or 'مسؤول القص'
        notes = (request.data.get('notes') or '').strip()

        # Optional per-part granularity: a single part key, a list of parts, or
        # nothing (finish cutting for every part of the model).
        requested_parts = request.data.get('parts') or request.data.get('part_types')
        if isinstance(requested_parts, str):
            requested_parts = [requested_parts]
        single_part = request.data.get('part_type') or request.data.get('partType')
        if single_part and not requested_parts:
            requested_parts = [single_part]

        seed_part_stages_from_status(model)
        current_stages = get_part_stages(model)
        target_keys = (
            [normalize_part_key(p) for p in requested_parts]
            if requested_parts
            else list(current_stages.keys())
        )
        target_keys = [key for key in target_keys if key in current_stages]
        # فقط القطع التي ما زالت فعلياً في قسم القص يمكن ترحيلها.
        cutting_keys = [key for key in target_keys if current_stages.get(key) == 'cutting']
        if not cutting_keys:
            return Response(
                {'error': 'تم إنهاء قص هذه القطع وتحويلها للمرحلة التالية مسبقاً ولا يمكن إعادة تحويلها.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # منع ترحيل أي قطعة بـ 0 قطع مقصوصة عند وجود فرشات مسجلة على الموديل.
        if model.cutting_records.exists():
            zero_parts = []
            for key in cutting_keys:
                part_cut_total = (
                    model.cutting_records.filter(part_type=key, is_sub_cut=False)
                    .aggregate(total=models.Sum('pieces_count'))['total']
                    or 0
                )
                if int(part_cut_total) <= 0:
                    zero_parts.append(dict(PART_TYPE_CHOICES).get(key, key))
            if zero_parts:
                return Response(
                    {
                        'error': (
                            f"لا يمكن إنهاء قص ({' / '.join(zero_parts)}) لأن عدد القطع المقصوصة يساوي صفر."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        moved_parts = list(cutting_keys)
        advance_parts_to_stage(model, 'qc_before_print', cutting_keys)
        parts_label = ' / '.join(
            dict(PART_TYPE_CHOICES).get(key, key) for key in moved_parts
        )
        derive_pipeline_status(model)
        model._skip_timeline_signal = True
        model.save()

        spreads_qs = model.cutting_records.prefetch_related('color_layers').all()
        cut_records = CuttingRecordSerializer(spreads_qs, many=True).data
        total_layers = sum(int(r.get('layers_count') or 0) for r in cut_records)

        tl_notes = f"إجمالي الفرشات: {len(cut_records)} | إجمالي القطع المقصوصة: {model.total_cut_pieces or 0} قطعة | إجمالي الراقات: {total_layers} | القطع المحولة: {parts_label}"
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
                'parts_moved': moved_parts or 'all',
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
        can_edit_cost = can_edit_department_prices(profile, 'edit_sewing_prices')

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

        # حقول السعر: تُتجاهل تماماً على الإنشاء لغير المصرح لهم، ويُرفض التعديل الصريح بـ 403.
        has_cost_payload = any(
            key in request.data for key in ('cost_per_piece', 'costPerPiece', 'total_cost', 'totalCost')
        )
        if has_cost_payload and not can_edit_cost:
            raise PermissionDenied('ليس لديك صلاحية تعديل أسعار ورش المكن والخياطة')
        cost_per_piece = 0.0
        total_cost = None
        if can_edit_cost:
            cost_per_piece = request.data.get('cost_per_piece')
            if cost_per_piece in (None, ''):
                cost_per_piece = request.data.get('costPerPiece') or 0
            total_cost = request.data.get('total_cost')
            if total_cost in (None, ''):
                total_cost = request.data.get('totalCost')

        if not workshop_name or not expected_date or pieces_count <= 0:
            return Response(
                {'error': 'اسم الورشة وتاريخ الاستلام المتوقع والقطع المسلمة مطلوبة'},
                status=status.HTTP_400_BAD_REQUEST
            )

        disp = dispatch_model_to_sewing_service(
            get_ext_id(model), workshop_name, pieces_count, expected_date, notes, user, piece_type,
            piece_label, client_id=client_id, cost_per_piece=cost_per_piece, total_cost=total_cost,
            workshop=resolve_workshop_link(request.data, workshop_name),
        )
        log_price_change(
            request, 'قسم المكن والخياطة',
            f'{model.model_code} - {disp.workshop_name}',
            'سعر تشغيل القطعة', disp.cost_per_piece,
        )
        return Response(SewingDispatchSerializer(disp, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def record_qc_count(self, request, pk=None):
        model = self.get_object()
        data = request.data if isinstance(request.data, dict) else {}
        stage = str(data.get('stage') or 'before_print').strip() or 'before_print'
        raw_notes = str(data.get('notes') or data.get('defectNotes') or '').strip()

        profile = getattr(request, 'user_profile', None)
        can_write_notes = True
        if profile:
            if stage == 'before_print' and not profile.has_perm('can_add_qc_before_print_notes'):
                can_write_notes = False
            elif stage in ('after_print', 'after_sewing') and not profile.has_perm('can_add_qc_after_print_notes'):
                can_write_notes = False
        if not can_write_notes:
            raw_notes = ''

        notes = raw_notes
        advance_raw = data.get('advanceStage')
        if advance_raw is None:
            advance_raw = data.get('advance_stage', True)
        advance_stage = parse_bool_flag(advance_raw, default=True)
        user = str(data.get('user') or data.get('user_name') or 'مراقب الجودة').strip() or 'مراقب الجودة'
        now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
        pieces_cut_ref = int(model.total_cut_pieces or model.target_cut_quantity or 0)
        model_default_part = (get_model_parts(model) or ['shirt'])[0]
        default_part_type = normalize_part_key(data.get('part_type') or data.get('partType') or model_default_part)

        matrix_entries = data.get('matrix_entries')
        if matrix_entries is None:
            matrix_entries = data.get('matrixEntries')
        if matrix_entries is not None and not isinstance(matrix_entries, list):
            return Response(
                {'detail': 'صيغة بيانات مصفوفة الفرز غير صالحة'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        parsed_matrix = []
        fallback_payload = None
        try:
            if isinstance(matrix_entries, list) and len(matrix_entries) > 0:
                for entry in matrix_entries:
                    if not isinstance(entry, dict):
                        continue
                    c_name = str(entry.get('color_name') or entry.get('colorName') or '').strip()
                    sz = str(entry.get('size') or '').strip()
                    if not c_name and not sz:
                        continue
                    raw_good = entry.get('good_qty')
                    if raw_good is None or raw_good == '':
                        raw_good = entry.get('goodQty')
                    if raw_good is None or raw_good == '':
                        raw_good = entry.get('counted_pieces')
                    raw_defect = entry.get('defect_qty')
                    if raw_defect is None or raw_defect == '':
                        raw_defect = entry.get('defectQty')
                    if raw_defect is None or raw_defect == '':
                        raw_defect = entry.get('defect_pieces')
                    g_qty = parse_qc_nonneg_int(raw_good, f'الكمية السليمة ({c_name or sz})', default=0)
                    d_qty = parse_qc_nonneg_int(raw_defect, f'الكمية التالفة ({c_name or sz})', default=0)
                    cell_notes = (
                        str(entry.get('notes') or entry.get('defect_notes') or notes or '').strip()
                        if can_write_notes else ''
                    )
                    entry_part = normalize_part_key(
                        entry.get('part_type') or entry.get('partType') or default_part_type
                    )
                    parsed_matrix.append({
                        'part_type': entry_part,
                        'color_name': c_name,
                        'size': sz,
                        'good_qty': g_qty,
                        'defect_qty': d_qty,
                        'notes': cell_notes,
                        'client_id': entry.get('id') or entry.get('client_id'),
                    })
            else:
                raw_counted = data.get('counted_pieces')
                if raw_counted is None or raw_counted == '':
                    raw_counted = data.get('piecesCounted')
                if raw_counted is None or raw_counted == '':
                    raw_counted = data.get('counted')
                raw_defects = data.get('defect_pieces')
                if raw_defects is None or raw_defects == '':
                    raw_defects = data.get('defectQty')
                counted_val = parse_qc_nonneg_int(raw_counted, 'عدد القطع السليمة', default=0)
                defects_val = parse_qc_nonneg_int(raw_defects, 'عدد القطع التالفة', default=0)
                c_name = str(data.get('color_name') or data.get('colorName') or model.model_type or 'الأساسي').strip()
                sz = str(data.get('size') or '').strip()
                fallback_payload = {
                    'part_type': default_part_type,
                    'color_name': c_name,
                    'size': sz,
                    'good_qty': counted_val,
                    'defect_qty': defects_val,
                    'notes': notes,
                    'client_id': data.get('qc_id'),
                }
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        touched_parts = (
            sorted({item['part_type'] for item in parsed_matrix})
            if parsed_matrix
            else [default_part_type]
        )

        saved_by_id = {}
        try:
            with transaction.atomic():
                model = ModelItem.objects.select_for_update().get(pk=model.pk)
                # Legacy models keep working: seed per-part stages before validation.
                seed_part_stages_from_status(model)
                validate_qc_stage_progression(model, stage, touched_parts)

                if parsed_matrix:
                    for item in parsed_matrix:
                        rec = upsert_qc_record(
                            model,
                            stage=stage,
                            part_type=item['part_type'],
                            color_name=item['color_name'],
                            size=item['size'],
                            pieces_cut=pieces_cut_ref,
                            good_qty=item['good_qty'],
                            defect_qty=item['defect_qty'],
                            notes=item['notes'],
                            can_write_notes=can_write_notes,
                            checked_by=user,
                            created_at_str=now_str,
                            client_id=item['client_id'],
                        )
                        saved_by_id[rec.pk] = rec

                    stage_qs = QCRecord.objects.filter(model=model, stage=stage)
                    counted = sum(int(r.counted_pieces or 0) for r in stage_qs)
                    defects = sum(int(r.defect_pieces or 0) for r in stage_qs)
                elif fallback_payload is not None:
                    qc_rec = upsert_qc_record(
                        model,
                        stage=stage,
                        part_type=fallback_payload['part_type'],
                        color_name=fallback_payload['color_name'],
                        size=fallback_payload['size'],
                        pieces_cut=pieces_cut_ref,
                        good_qty=fallback_payload['good_qty'],
                        defect_qty=fallback_payload['defect_qty'],
                        notes=fallback_payload['notes'],
                        can_write_notes=can_write_notes,
                        checked_by=user,
                        created_at_str=now_str,
                        client_id=fallback_payload['client_id'],
                    )
                    saved_by_id[qc_rec.pk] = qc_rec
                    counted = fallback_payload['good_qty']
                    defects = fallback_payload['defect_qty']
                else:
                    stage_qs = QCRecord.objects.filter(model=model, stage=stage)
                    counted = sum(int(r.counted_pieces or 0) for r in stage_qs)
                    defects = sum(int(r.defect_pieces or 0) for r in stage_qs)

                saved_records = list(saved_by_id.values())

                matrix_snapshot = [
                    {
                        'part_type': r.part_type or 'shirt',
                        'color_name': r.color_name,
                        'size': r.size,
                        'good_qty': int(r.counted_pieces or 0),
                        'defect_qty': int(r.defect_pieces or 0),
                    }
                    for r in saved_records
                ]

                qc_details = {
                    'phase_type': f'qc_{stage}',
                    'record_id': get_ext_id(saved_records[0]) if saved_records else '',
                    'qc_stage': stage,
                    'pieces_cut': pieces_cut_ref,
                    'counted_pieces': int(counted),
                    'defect_pieces': int(defects),
                    'deficit': pieces_cut_ref - int(counted),
                    'matrix_entries': matrix_snapshot,
                    'inspector_name': user,
                    'operator_name': user,
                    'worker_notes': notes,
                }

                # Each QC stage advances only the part(s) actually counted. The coarse
                # model status is then derived from the least advanced part.
                advanced_parts = sorted({r.part_type for r in saved_records if r.part_type}) or [default_part_type]
                if advance_stage:
                    next_stage = {
                        'before_print': 'printing',
                        'after_print': 'sewing',
                        'after_sewing': 'finishing',
                    }.get(stage)
                    if next_stage:
                        for part in advanced_parts:
                            advance_parts_to_stage(model, next_stage, [part])
                        derive_pipeline_status(model)

                if stage == 'before_print':
                    model.count_before_print = counted
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
                    tl_text = f"مصفوفة الفحص النهائي بعد المكن — إجمالي السليم: {counted} قطعة | إجمالي التالف: {defects} {'-> تحويل لقسم التشطيب' if advance_stage else ''}"
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
                model.save(update_fields=[
                    'status', 'part_stages',
                    'count_before_print', 'count_after_print', 'count_after_sewing',
                    'updated_at',
                ])
                recompute_model_part_totals(model)
        except (ValueError, ValidationError, IntegrityError) as exc:
            return Response(
                {'detail': format_validation_error(exc, 'تعذر تسجيل واعتماد بيانات الفرز')},
                status=status.HTTP_400_BAD_REQUEST,
            )

        stage_label = QC_STAGE_ARABIC_LABELS.get(stage, stage)
        set_audit_meta(
            request,
            section='العد والجودة',
            action_type='status_change' if advance_stage else 'update',
            target_name=model.model_code,
            details=(
                f"اعتماد وترحيل ({stage_label}) للموديل {model.model_code}: سليم {counted}، تالف {defects}"
                if advance_stage
                else f"تسجيل ({stage_label}) للموديل {model.model_code}: سليم {counted}، تالف {defects}"
            ),
            changes=[
                {'field': 'stage', 'label': 'المرحلة', 'old': '—', 'new': stage_label},
                {'field': 'counted_pieces', 'label': 'إجمالي السليم', 'old': '—', 'new': str(counted)},
                {'field': 'defect_pieces', 'label': 'إجمالي التالف', 'old': '—', 'new': str(defects)},
            ],
        )

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
        data = request.data if isinstance(request.data, dict) else {}
        now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
        user_name = str(data.get('user_name') or data.get('user') or 'مراقب الجودة').strip() or 'مراقب الجودة'
        try:
            with transaction.atomic():
                model = ModelItem.objects.select_for_update().get(pk=model.pk)
                validate_qc_stage_progression(model, 'before_print', get_model_parts(model))
                advance_parts_to_stage(model, 'printing')
                derive_pipeline_status(model)
                model._skip_timeline_signal = True
                model.save(update_fields=['status', 'part_stages', 'updated_at'])
                ModelTimeline.objects.create(
                    model=model,
                    stage='المطابع والتطريز',
                    title='الاعتماد وجاهزية الإرسال للمطابع',
                    notes='تم اعتماد نتائج الفرز وأصبح الموديل جاهزاً للتسليم للمطابع',
                    user=user_name,
                    timestamp_str=now_str,
                    details={
                        'phase_type': 'qc_approved',
                        'count_before_print': int(model.count_before_print or model.total_cut_pieces or 0),
                        'operator_name': user_name,
                    }
                )
        except (ValueError, ValidationError, IntegrityError) as exc:
            return Response(
                {'detail': format_validation_error(exc, 'تعذر اعتماد نتائج الفرز')},
                status=status.HTTP_400_BAD_REQUEST,
            )
        set_audit_meta(
            request,
            section='العد والجودة',
            action_type='status_change',
            target_name=model.model_code,
            details=f"اعتماد الفرز وجاهزية الإرسال للمطابع للموديل {model.model_code}",
        )
        return Response(ModelItemSerializer(model, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def finish_sewing(self, request, pk=None):
        model = self.get_object()
        now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
        notes = request.data.get('notes') or ''
        user_name = request.data.get('user') or request.data.get('user_name') or 'مسؤول قسم المكن'
        advance_parts_to_stage(model, 'qc_after_sewing')
        derive_pipeline_status(model)
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
        data = request.data if isinstance(request.data, dict) else {}
        now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
        notes = str(data.get('notes') or '').strip()
        user_name = str(data.get('user_name') or data.get('user') or 'مراقب الجودة').strip() or 'مراقب الجودة'
        try:
            with transaction.atomic():
                model = ModelItem.objects.select_for_update().get(pk=model.pk)
                validate_qc_stage_progression(model, 'after_sewing', get_model_parts(model))
                set_all_part_stages(model, 'completed', save=False)
                model.status = 'مخزن الإنتاج التام'
                model._skip_timeline_signal = True
                model.save(update_fields=['status', 'part_stages', 'updated_at'])
                ModelTimeline.objects.create(
                    model=model,
                    stage='مخزن الإنتاج التام',
                    title='الاعتماد النهائي ودخول مخزن الإنتاج التام',
                    notes=f"تم الفحص النهائي بنجاح ودخول البضاعة الجاهزة إلى مخزن الإنتاج. {notes}".strip(),
                    user=user_name,
                    timestamp_str=now_str,
                    details={
                        'phase_type': 'production_warehouse',
                        'count_after_sewing': int(model.count_after_sewing or 0),
                        'operator_name': user_name,
                        'worker_notes': notes,
                    }
                )
        except (ValueError, ValidationError, IntegrityError) as exc:
            return Response(
                {'detail': format_validation_error(exc, 'تعذر اعتماد التحويل لمخزن الإنتاج التام')},
                status=status.HTTP_400_BAD_REQUEST,
            )
        set_audit_meta(
            request,
            section='العد والجودة',
            action_type='status_change',
            target_name=model.model_code,
            details=f"الاعتماد النهائي ودخول مخزن الإنتاج التام للموديل {model.model_code}",
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
        return Response(
            ModelTimelineSerializer(tl, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

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
        sent_qty = data.get('sent_qty') if data.get('sent_qty') is not None else data.get('sentQty')
        received_qty = data.get('received_qty') if data.get('received_qty') is not None else data.get('receivedQty')
        try:
            requirement = set_packaging_step_service(
                model, step, step_date=step_date, notes=notes, user_name=user_name,
                sent_qty=sent_qty, received_qty=received_qty,
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        step_labels = {
            'photo_sent': 'إرسال للتصوير',
            'photo_received': 'استلام من التصوير',
            'cards_sent': 'إرسال الكروت للطباعة',
            'cards_received': 'استلام الكروت',
        }
        step_label = step_labels.get(step, step)
        step_changes = [{'field': step, 'label': step_label, 'old': '—', 'new': str(step_date or 'تم التحديث')}]
        if sent_qty is not None:
            step_changes.append({'field': 'sent_qty', 'label': 'الكمية المرسلة', 'old': '—', 'new': str(sent_qty)})
        if received_qty is not None:
            step_changes.append({'field': 'received_qty', 'label': 'الكمية المستلمة', 'old': '—', 'new': str(received_qty)})
        set_audit_meta(
            request,
            section='الأسمبلي والأمبالاج',
            action_type='status_change',
            target_name=model.model_code,
            details=f"حدّث خطوة الأمبالاج ({step_label}) للموديل: {model.model_code}",
            changes=step_changes,
        )
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
        profile = getattr(request, 'user_profile', None)
        finishing_cost, finishing_total = read_department_cost_payload(
            request, profile, 'edit_assembly_prices', 'أسعار التشطيب'
        )
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
                vendor_name=data.get('vendor_name') or data.get('vendorName') or '',
                user_name=data.get('user_name') or data.get('user') or 'مسؤول التشطيب',
                cost_per_piece=finishing_cost,
                total_cost=finishing_total,
                workshop=resolve_workshop_link(
                    data, data.get('vendor_name') or data.get('vendorName') or ''
                ),
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        model.refresh_from_db()
        log_price_change(
            request, 'الأسمبلي والأمبالاج', model.model_code,
            'سعر التشطيب للقطعة', finishing_cost,
        )
        return Response({
            'model': ModelItemSerializer(model, context={'request': request}).data,
            'finishingRecords': FinishingRecordSerializer(records, many=True, context={'request': request}).data,
            'partStages': part_stages_payload(model),
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def receive_finishing(self, request, pk=None):
        """Receives one part from finishing; only that part moves to ironing."""
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
            'finishingRecord': FinishingRecordSerializer(record, context={'request': request}).data,
            'finishingRecords': FinishingRecordSerializer(
                FinishingRecord.objects.filter(model=model).order_by('part_type'), many=True,
                context={'request': request}
            ).data,
            'partStages': part_stages_payload(model),
            'packagingReadiness': packaging_readiness(model),
        })

    @action(detail=True, methods=['post'])
    def start_ironing(self, request, pk=None):
        """Starts (or updates) the ironing stage for one or more garment parts."""
        model = self.get_object()
        data = request.data or {}
        profile = getattr(request, 'user_profile', None)
        ironing_cost, ironing_total = read_department_cost_payload(
            request, profile, 'edit_assembly_prices', 'أسعار المكواة'
        )
        parts = data.get('parts')
        if isinstance(parts, str):
            parts = [parts]
        if not isinstance(parts, list):
            parts = None
        try:
            records = start_ironing_service(
                model,
                part_type=data.get('part_type') or data.get('partType'),
                parts=parts,
                entry_date=data.get('entry_date') or data.get('entryDate'),
                expected_exit_date=data.get('expected_exit_date') or data.get('expectedExitDate'),
                notes=data.get('notes') or '',
                vendor_name=data.get('vendor_name') or data.get('vendorName') or '',
                user_name=data.get('user_name') or data.get('user') or 'مسؤول المكواة',
                cost_per_piece=ironing_cost,
                total_cost=ironing_total,
                workshop=resolve_workshop_link(
                    data, data.get('vendor_name') or data.get('vendorName') or ''
                ),
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        model.refresh_from_db()
        log_price_change(
            request, 'الأسمبلي والأمبالاج', model.model_code,
            'سعر المكواة للقطعة', ironing_cost,
        )
        return Response({
            'model': ModelItemSerializer(model, context={'request': request}).data,
            'assemblyStageRecords': AssemblyStageRecordSerializer(
                records, many=True, context={'request': request}
            ).data,
            'partStages': part_stages_payload(model),
            'packagingReadiness': packaging_readiness(model),
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def receive_ironing(self, request, pk=None):
        """Receives one part from ironing; that part then moves to packaging."""
        model = self.get_object()
        data = request.data or {}
        record_id = data.get('record_id') or data.get('recordId')
        if not record_id:
            return Response({'detail': 'معرف سجل المكواة مطلوب'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            record = receive_ironing_service(
                record_id,
                actual_exit_date=data.get('actual_exit_date') or data.get('actualExitDate'),
                notes=data.get('notes') or '',
                user_name=data.get('user_name') or data.get('user') or 'مسؤول المكواة',
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        model.refresh_from_db()
        return Response({
            'model': ModelItemSerializer(model, context={'request': request}).data,
            'assemblyStageRecord': AssemblyStageRecordSerializer(
                record, context={'request': request}
            ).data,
            'assemblyStageRecords': AssemblyStageRecordSerializer(
                AssemblyStageRecord.objects.filter(model=model).order_by('stage', 'part_type'),
                many=True, context={'request': request}
            ).data,
            'partStages': part_stages_payload(model),
            'packagingReadiness': packaging_readiness(model),
        })



    @action(detail=True, methods=['post'])
    def start_assembly_stage(self, request, pk=None):
        """Starts one assembly stage: ironing / packaging / dest."""
        model = self.get_object()
        data = request.data or {}
        profile = getattr(request, 'user_profile', None)
        assembly_cost, assembly_total = read_department_cost_payload(
            request, profile, 'edit_assembly_prices', 'أسعار الأسمبلي والأمبالاج'
        )
        stage = str(data.get('stage') or '').strip()
        if stage not in ASSEMBLY_STAGE_KEYS:
            return Response(
                {'detail': 'مرحلة الأسمبلي غير معروفة (المتاح: ironing / packaging / dest)'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        completed_pieces = data.get('completed_pieces')
        if completed_pieces is None:
            completed_pieces = data.get('completedPieces')
        expected_pieces = data.get('expected_pieces')
        if expected_pieces is None:
            expected_pieces = data.get('expectedPieces')
        try:
            record = start_assembly_stage_service(
                model,
                stage,
                entry_date=data.get('entry_date') or data.get('entryDate'),
                expected_exit_date=data.get('expected_exit_date') or data.get('expectedExitDate'),
                notes=data.get('notes') or '',
                vendor_name=data.get('vendor_name') or data.get('vendorName') or '',
                part_type=data.get('part_type') or data.get('partType'),
                user_name=data.get('user_name') or data.get('user') or 'مسؤول الأسمبلي',
                cost_per_piece=assembly_cost,
                total_cost=assembly_total,
                workshop=resolve_workshop_link(
                    data, data.get('vendor_name') or data.get('vendorName') or ''
                ),
                completed_pieces=completed_pieces,
                expected_pieces=expected_pieces,
            )
        except PackagingStockShortageError as exc:
            return Response(
                {
                    'detail': str(exc),
                    'error': str(exc),
                    'code': 'packaging_material_shortage',
                    'shortages': exc.shortages,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        model.refresh_from_db()
        log_price_change(
            request, 'الأسمبلي والأمبالاج', model.model_code,
            f'سعر مرحلة {stage}', assembly_cost,
        )
        deducted_now = getattr(record, '_deducted_now', None) or []
        if stage == 'packaging' and deducted_now:
            deduct_changes = [
                {
                    'field': f"pack_mat_{item['size_rule_id']}",
                    'label': f"{item['material_name']} ({item['size_group_name']})",
                    'old': f"{item['old_stock']:g} {item['unit']}",
                    'new': f"{item['new_stock']:g} {item['unit']} (خصم {item['amount']:g})",
                }
                for item in deducted_now
            ]
            set_audit_meta(
                request,
                section='الأسمبلي والأمبالاج',
                action_type='transaction',
                target_name=model.model_code,
                details=(
                    f"دخول الموديل {model.model_code} لمرحلة التعبئة والتغليف مع خصم تلقائي لـ "
                    f"{len(deducted_now)} خامة تغليف"
                ),
                changes=deduct_changes,
            )
        elif stage == 'dest' and record.completed_pieces is not None:
            set_audit_meta(
                request,
                section='الأسمبلي والأمبالاج',
                action_type='status_change',
                target_name=model.model_code,
                details=(
                    f"تحديث مرحلة الدَست للموديل {model.model_code} — "
                    f"المتوقع: {record.expected_pieces}، المنفذ: {record.completed_pieces}، العجز: {record.shortage_pieces}"
                ),
                changes=[
                    {'field': 'expected_pieces', 'label': 'العدد المتوقع', 'old': '—', 'new': str(record.expected_pieces)},
                    {'field': 'completed_pieces', 'label': 'العدد المنفذ فعلياً', 'old': '—', 'new': str(record.completed_pieces)},
                    {'field': 'shortage_pieces', 'label': 'العجز', 'old': '—', 'new': str(record.shortage_pieces)},
                ],
            )
        return Response({
            'model': ModelItemSerializer(model, context={'request': request}).data,
            'assemblyStageRecord': AssemblyStageRecordSerializer(
                record, context={'request': request}
            ).data,
            'partStages': part_stages_payload(model),
            'readiness': packaging_requirement_summary(model),
            'packagingReadiness': packaging_readiness(model),
            'deductedMaterials': deducted_now,
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def receive_assembly_stage(self, request, pk=None):
        """Completes one assembly stage record and moves the model to the next stage."""
        model = self.get_object()
        data = request.data or {}
        record_id = data.get('record_id') or data.get('recordId')
        if not record_id:
            return Response({'detail': 'معرف سجل المرحلة مطلوب'}, status=status.HTTP_400_BAD_REQUEST)
        completed_pieces = data.get('completed_pieces')
        if completed_pieces is None:
            completed_pieces = data.get('completedPieces')
        try:
            record = receive_assembly_stage_service(
                record_id,
                actual_exit_date=data.get('actual_exit_date') or data.get('actualExitDate'),
                notes=data.get('notes') or '',
                user_name=data.get('user_name') or data.get('user') or 'مسؤول الأسمبلي',
                completed_pieces=completed_pieces,
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        model.refresh_from_db()
        if record.stage == 'dest':
            set_audit_meta(
                request,
                section='الأسمبلي والأمبالاج',
                action_type='status_change',
                target_name=model.model_code,
                details=(
                    f"استلام الموديل {model.model_code} من الدَست — "
                    f"المتوقع: {record.expected_pieces}، المنفذ فعلياً: {record.completed_pieces}، العجز: {record.shortage_pieces}"
                ),
                changes=[
                    {'field': 'expected_pieces', 'label': 'العدد المتوقع', 'old': '—', 'new': str(record.expected_pieces)},
                    {'field': 'completed_pieces', 'label': 'العدد المنفذ فعلياً', 'old': '—', 'new': str(record.completed_pieces)},
                    {'field': 'shortage_pieces', 'label': 'العجز', 'old': '—', 'new': str(record.shortage_pieces)},
                ],
            )
        return Response({
            'model': ModelItemSerializer(model, context={'request': request}).data,
            'assemblyStageRecord': AssemblyStageRecordSerializer(
                record, context={'request': request}
            ).data,
            'assemblyStageRecords': AssemblyStageRecordSerializer(
                AssemblyStageRecord.objects.filter(model=model).order_by('stage', 'part_type'),
                many=True, context={'request': request}
            ).data,
            'partStages': part_stages_payload(model),
            'packagingReadiness': packaging_readiness(model),
        })

    @action(detail=True, methods=['get'])
    def part_stages(self, request, pk=None):
        """Returns the independent stage of every garment part of the model."""
        model = self.get_object()
        return Response({
            'model_id': get_ext_id(model),
            'model_code': model.model_code,
            'model_status': model.status,
            'partStages': part_stages_payload(model),
            'packagingReadiness': packaging_readiness(model),
        })


class ModelRequirementViewSet(BasePermViewSet):
    permission_classes = [HasDynamicSectionPermission]
    required_section = 'design'
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
            # التقاط سعر الوحدة الحالي للون وقت ربط المتطلب بالموديل.
            unit_price_snapshot=color.price_per_unit or 0,
        )
        sync_reserved_quantities()
        return Response(ModelRequirementSerializer(req, context={'request': request}).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        req = self.get_object()
        data = request.data
        if 'color_id' in data or 'colorId' in data:
            color = resolve_by_id(FabricColor, data.get('color_id') or data.get('colorId'))
            if color:
                req.color = color
                req.unit_price_snapshot = color.price_per_unit or 0
        if 'part_name' in data or 'partName' in data:
            req.part_name = (data.get('part_name') or data.get('partName') or req.part_name).strip()
        if 'planned_quantity' in data or 'plannedQuantity' in data:
            req.planned_quantity = max(0.0, float(data.get('planned_quantity') or data.get('plannedQuantity') or 0))
        req.save()
        sync_reserved_quantities()
        return Response(ModelRequirementSerializer(req, context={'request': request}).data)

    def destroy(self, request, *args, **kwargs):
        req = self.get_object()
        req.delete()
        sync_reserved_quantities()
        return Response({'status': 'deleted'})


class ModelAccessoryViewSet(BasePermViewSet):
    permission_classes = [HasDynamicSectionPermission]
    required_section = 'design'
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
            image=clean_image_value(data.get('image') or '', 'model-accessories', 'صورة الإكسسوار'),
            # التقاط سعر الوحدة الحالي للإكسسوار وقت الربط بالموديل.
            unit_price_snapshot=_accessory_price_snapshot(data.get('accessory_id')),
        )
        sync_reserved_quantities()
        return Response(ModelAccessorySerializer(m_acc, context={'request': request}).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        m_acc = self.get_object()
        if m_acc.is_issued:
            return Response(
                {'detail': 'لا يمكن تعديل إكسسوار تم صرفه فعلياً من مخزن الإكسسوارات'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        data = request.data
        if 'accessory_id' in data:
            m_acc.accessory_id_ref = data.get('accessory_id') or None
            m_acc.unit_price_snapshot = _accessory_price_snapshot(m_acc.accessory_id_ref)
        if 'planned_quantity' in data:
            m_acc.planned_quantity = max(0.0, float(data.get('planned_quantity') or 0))
        if 'piece_consumption' in data:
            m_acc.piece_consumption = max(0.0, float(data.get('piece_consumption') or 1))
        if 'target_type' in data:
            m_acc.target_type = data.get('target_type') or 'shirt'
        if 'image' in data:
            m_acc.image = clean_image_value(
                data.get('image') or '', 'model-accessories', 'صورة الإكسسوار'
            )
        m_acc.save()
        sync_reserved_quantities()
        return Response(ModelAccessorySerializer(m_acc, context={'request': request}).data)

    def destroy(self, request, *args, **kwargs):
        m_acc = self.get_object()
        if m_acc.is_issued:
            return Response(
                {'detail': 'لا يمكن حذف إكسسوار تم صرفه فعلياً من مخزن الإكسسوارات'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        m_acc.delete()
        sync_reserved_quantities()
        return Response({'status': 'deleted'})


