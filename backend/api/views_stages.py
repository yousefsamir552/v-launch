from .views_common import *
from .views_common import _truthy_permission_keys, _accessory_price_snapshot

class CuttingRecordViewSet(BasePermViewSet):
    permission_classes = [HasDynamicSectionPermission]
    required_section = 'cutting'
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
        # فرشة "قصة / جزء فرعي": تُستهلك قماشها وتُحسب أوزانها فقط ولا تُجمع على عدد القطع.
        is_sub_cut = bool(data.get('is_sub_cut') if 'is_sub_cut' in data else data.get('isSubCut', False))
        sub_cut_label = (data.get('sub_cut_label') or data.get('subCutLabel') or '').strip()[:150]
        if is_sub_cut and not sub_cut_label:
            sub_cut_label = 'قصة ' + {'shirt': 'تيشرت', 'pants': 'بنطلون', 'jacket': 'جاكيت', 'single': 'قطعة'}.get(part_type, 'فرعية')

        with transaction.atomic():
            # اقفل سجل الموديل أولاً ثم احسب رقم الفرشة، حتى لا تحصل فرشتان
            # متزامنتان على نفس الرقم (Race Condition). نستخدم أكبر رقم موجود + 1
            # (وليس عدد السجلات) حتى لا يتكرر رقم فرشة بعد حذف إحدى الفرشات.
            model = ModelItem.objects.select_for_update().get(pk=model.pk)
            last_spread_num = (
                CuttingRecord.objects.filter(model=model)
                .order_by('-spread_number')
                .values_list('spread_number', flat=True)
                .first()
            ) or 0
            # توليد رقم الفرشة تلقائياً على الباك إند داخل قفل الموديل لمنع أي تكرار أو تعارض.
            spread_num = int(last_spread_num) + 1
            rec = CuttingRecord.objects.create(
                client_id=data.get('id') or data.get('client_id'),
                model=model,
                spread_number=spread_num,
                part_type=part_type,
                is_sub_cut=is_sub_cut,
                sub_cut_label=sub_cut_label,
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
            if is_sub_cut:
                prefix = f"🧩 قصة / جزء فرعي: {sub_cut_label or 'بدون اسم'} | تُحسب قماشاً ووزناً فقط ولا تُجمع على عدد القطع | "
                tl_notes = prefix + tl_notes
            if shade:
                tl_notes += f" | درجة الصبغة: {shade}"
            if notes:
                tl_notes += f" | ملاحظات: {notes}"

            tl_title = (
                f"تسجيل قصة فرعية #{spread_num} ({sub_cut_label or 'بدون اسم'}) — {pieces} قطعة (لا تُجمع على العدد)"
                if is_sub_cut
                else f"تسجيل فرشة قص #{spread_num} ({pieces} قطعة)"
            )
            ModelTimeline.objects.create(
                model=model,
                stage='في القص',
                title=tl_title,
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
                    'is_sub_cut': is_sub_cut,
                    'sub_cut_label': sub_cut_label,
                    'total_cut_pieces_so_far': model.total_cut_pieces,
                    'shade_degree': shade,
                    'worker_notes': notes,
                    'operator_name': cutter or spreader,
                }
            )

        rec_refreshed = CuttingRecord.objects.select_related('model').prefetch_related('color_layers').get(pk=rec.pk)
        return Response(CuttingRecordSerializer(rec_refreshed).data, status=status.HTTP_201_CREATED)

    # --- تعديل / حذف الفرشة (يشمل تحويلها بين "قطعة أساسية" و"قصة فرعية") ---
    def update(self, request, *args, **kwargs):
        return self._update_record(request)

    def partial_update(self, request, *args, **kwargs):
        return self._update_record(request)

    def _update_record(self, request):
        rec = self.get_object()
        data = request.data or {}

        def has(*keys):
            return any(key in data for key in keys)

        def val(*keys):
            for key in keys:
                if key in data:
                    return data.get(key)
            return None

        def to_int(value, default=0, minimum=0):
            try:
                return max(minimum, int(value if value is not None else default))
            except (TypeError, ValueError):
                return default

        def to_float(value, default=0.0, minimum=0.0):
            try:
                return max(minimum, float(value if value is not None else default))
            except (TypeError, ValueError):
                return default

        profile = getattr(request, 'user_profile', None)
        can_cutting_notes = True if not profile else profile.has_perm('can_add_cutting_notes')

        with transaction.atomic():
            # نقفل سجل الفرشة والموديل معاً حتى لا تتصادم عمليات التعديل/الحذف
            # المتزامنة مع إعادة حساب مجاميع القص.
            rec = CuttingRecord.objects.select_for_update().select_related('model').get(pk=rec.pk)
            model = ModelItem.objects.select_for_update().get(pk=rec.model_id)
            rec.model = model

            if has('part_type', 'partType'):
                rec.part_type = normalize_part_key(val('part_type', 'partType') or 'shirt')
            if has('spread_number', 'spreadNumber'):
                rec.spread_number = to_int(
                    val('spread_number', 'spreadNumber'), default=1, minimum=1
                )
            if has('spreader_name', 'spreaderName'):
                rec.spreader_name = str(val('spreader_name', 'spreaderName') or '').strip()[:150]
            if has('cutter_name', 'cutterName'):
                rec.cutter_name = str(val('cutter_name', 'cutterName') or '').strip()[:150]
            if has('pieces_per_layer', 'piecesPerLayer'):
                rec.pieces_per_layer = to_int(
                    val('pieces_per_layer', 'piecesPerLayer'), default=0, minimum=0
                )
            if has('layer_weight', 'layerWeight'):
                rec.layer_weight = to_float(
                    val('layer_weight', 'layerWeight'), default=0.0, minimum=0.0
                )
            if has('shade_degree', 'shadeDegree'):
                rec.shade_degree = str(val('shade_degree', 'shadeDegree') or '').strip()[:100]
            if has('notes') and can_cutting_notes:
                rec.notes = str(data.get('notes') or '').strip()
            if has('is_sub_cut', 'isSubCut'):
                raw_sub_cut = val('is_sub_cut', 'isSubCut')
                if isinstance(raw_sub_cut, str):
                    rec.is_sub_cut = raw_sub_cut.strip().lower() in ('1', 'true', 'yes', 'on')
                else:
                    rec.is_sub_cut = bool(raw_sub_cut)
            if has('sub_cut_label', 'subCutLabel'):
                rec.sub_cut_label = str(val('sub_cut_label', 'subCutLabel') or '').strip()[:150]

            # استبدال ألوان/راقات الفرشة بالكامل عند إرسال قائمة color_layers.
            raw_layers = data.get('color_layers') if 'color_layers' in data else data.get('colorLayers')
            if isinstance(raw_layers, list):
                parsed_layers = []
                for item in raw_layers:
                    if not isinstance(item, dict):
                        continue
                    c_name = str(item.get('color_name') or item.get('colorName') or '').strip()
                    l_count = to_int(
                        item.get('layers_count')
                        if 'layers_count' in item
                        else item.get('layersCount'),
                        default=0,
                        minimum=0,
                    )
                    if c_name and l_count > 0:
                        parsed_layers.append({
                            'id': item.get('id') or item.get('client_id'),
                            'color_name': c_name,
                            'layers_count': l_count,
                            'shade_degree': str(
                                item.get('shade_degree') or item.get('shadeDegree') or ''
                            ).strip(),
                            'notes': str(item.get('notes') or '').strip(),
                        })

                rec.color_layers.all().delete()
                for item in parsed_layers:
                    item_pcs = (
                        item['layers_count'] * rec.pieces_per_layer
                        if rec.pieces_per_layer > 0
                        else 0
                    )
                    CuttingSpreadLayer.objects.create(
                        client_id=item.get('id'),
                        spread=rec,
                        color_name=item['color_name'],
                        layers_count=item['layers_count'],
                        layer_weight=rec.layer_weight,
                        pieces_count=item_pcs,
                        shade_degree=item['shade_degree'],
                        notes=item['notes'],
                    )

                rec.layers_count = sum(item['layers_count'] for item in parsed_layers)
                rec.fabric_color = ' + '.join(
                    f"{item['color_name']} ({item['layers_count']} راق)"
                    for item in parsed_layers
                )[:255]
            else:
                if has('fabric_color', 'color_name', 'colorName'):
                    rec.fabric_color = str(
                        val('fabric_color', 'color_name', 'colorName') or ''
                    ).strip()[:255]
                if has('layers_count', 'layersCount'):
                    rec.layers_count = to_int(
                        val('layers_count', 'layersCount'), default=0, minimum=0
                    )

            # إعادة حساب القطع المقصوصة تلقائياً = عدد الراقات × القطع في الراق.
            if rec.pieces_per_layer > 0 and rec.layers_count > 0:
                rec.pieces_count = rec.layers_count * rec.pieces_per_layer
            elif has('pieces_count', 'piecesCount'):
                rec.pieces_count = to_int(
                    val('pieces_count', 'piecesCount'), default=0, minimum=0
                )

            if rec.is_sub_cut and not rec.sub_cut_label:
                rec.sub_cut_label = 'قصة ' + {
                    'shirt': 'تيشرت', 'pants': 'بنطلون', 'jacket': 'جاكيت', 'single': 'قطعة',
                }.get(rec.part_type, 'فرعية')

            rec.save()

            # مزامنة اسم المقصدار/الفَرّاش على بطاقة الموديل.
            if rec.cutter_name:
                model.cutter_name = rec.cutter_name
            if rec.spreader_name:
                model.spreader_name = rec.spreader_name
            model._skip_timeline_signal = True
            model.save()
            recompute_model_part_totals(model)

        rec = CuttingRecord.objects.select_related('model').prefetch_related('color_layers').get(pk=rec.pk)
        return Response(CuttingRecordSerializer(rec, context={'request': request}).data, status=status.HTTP_200_OK)

    def destroy(self, request, *args, **kwargs):
        rec = self.get_object()
        model_id = rec.model_id
        spread_number = rec.spread_number
        with transaction.atomic():
            model = ModelItem.objects.select_for_update().get(pk=model_id)
            rec.delete()
            model._skip_timeline_signal = True
            recompute_model_part_totals(model)
        return Response(
            {'detail': f'تم حذف فرشة القص #{spread_number} وإعادة حساب أعداد القطع'},
            status=status.HTTP_200_OK,
        )


class QCRecordViewSet(BasePermViewSet):
    permission_classes = [HasDynamicSectionPermission]
    required_section = 'qc'
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
    permission_classes = [HasDynamicSectionPermission]
    required_section = 'printing'
    queryset = PrintDispatch.objects.select_related('model').all()
    serializer_class = PrintDispatchSerializer
    # التعديل يتم فقط عبر الإجراءات المخصصة (update_status/receive/skip_print).
    http_method_names = ['get', 'post', 'head', 'options']

    def create(self, request, *args, **kwargs):
        data = request.data
        model = resolve_by_id(ModelItem, data.get('model_id') or data.get('modelId'))
        if not model:
            return Response({'detail': 'الموديل غير موجود'}, status=status.HTTP_400_BAD_REQUEST)

        profile = getattr(request, 'user_profile', None)
        can_printing_notes = True if not profile else (profile.has_perm('can_add_printing_notes') or profile.has_perm('can_add_qc_before_print_notes'))
        can_edit_cost = can_edit_department_prices(profile, 'edit_printing_prices')
        if (
            any(key in data for key in ('cost_per_piece', 'costPerPiece', 'total_cost', 'totalCost'))
            and not can_edit_cost
        ):
            raise PermissionDenied('ليس لديك صلاحية تعديل أسعار المطابع')

        shop_name = (data.get('shop_name') or data.get('shopName') or data.get('print_house') or '').strip()
        pieces = max(0, int(data.get('pieces_count') or data.get('piecesCount') or 0))
        print_type = (data.get('print_type') or data.get('printType') or 'سلك سكرين مائي').strip()
        piece_type = (data.get('piece_type') or data.get('pieceType') or 'shirt').strip() or 'shirt'
        if piece_type not in PART_TYPE_KEYS:
            piece_type = 'shirt'
        piece_label = (data.get('piece_label') or data.get('pieceLabel') or '').strip() or dict(PART_TYPE_CHOICES).get(piece_type, '')
        print_location = (data.get('print_location') or data.get('printLocation') or '').strip()
        print_details = (data.get('print_details') or data.get('printDetails') or '').strip()
        cost = max(0.0, float(data.get('cost_per_piece') or data.get('costPerPiece') or 0)) if can_edit_cost else 0.0
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
            workshop=resolve_workshop_link(data, shop_name),
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

        # Only this part is at the printing stage; the coarse status follows it.
        advance_parts_to_stage(model, 'printing', [piece_type])
        derive_pipeline_status(model)
        model.print_house = shop_name
        if can_edit_cost:
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
        data = request.data
        new_status = data.get('status') or 'تم الاستلام بالمصنع'
        user_name = data.get('user_name') or 'مسؤول المطابع'
        now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
        clean_notes = (data.get('notes') or '').strip()

        received_qty_raw = data.get('received_qty')
        if received_qty_raw is None:
            received_qty_raw = data.get('receivedQty')
        try:
            requested_qty = int(received_qty_raw) if received_qty_raw not in (None, '') else 0
        except (TypeError, ValueError):
            requested_qty = 0

        total_pieces = int(disp.pieces_count or 0)
        already_received = int(disp.received_pieces or 0)
        remaining_before = max(0, total_pieces - already_received)
        is_receiving = (
            new_status in ('تم الاستلام', 'تم الاستلام بالمصنع')
            or requested_qty > 0
        )

        if is_receiving:
            if requested_qty > 0:
                if remaining_before == 0:
                    return Response(
                        {'detail': 'تم استلام كامل كمية هذه التشغيلة مسبقاً'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                batch_qty = min(remaining_before, requested_qty)
            else:
                batch_qty = remaining_before or total_pieces

            disp.received_pieces = already_received + batch_qty
            history = disp.receive_history if isinstance(disp.receive_history, list) else []
            history.append({
                'date': now_str,
                'qty': batch_qty,
                'total_received': disp.received_pieces,
                'user': user_name,
                'notes': clean_notes,
            })
            disp.receive_history = history
            disp.received_date = date.today()
            disp.received_at_str = now_str
            if clean_notes:
                disp.notes = f"{disp.notes} | استلام: {clean_notes}".strip(' |')
            if disp.received_pieces >= total_pieces:
                disp.status = 'تم الاستلام بالمصنع'
            else:
                disp.status = 'استلام جزئي'
        else:
            batch_qty = 0
            disp.status = new_status
        disp.save()

        if is_receiving:
            m = disp.model
            # Only the returned part moves to "عد بعد الطباعة"; sibling parts stay put.
            # Partial batches also open the counting stage so each delivered batch is
            # counted as soon as it arrives.
            advance_parts_to_stage(m, 'qc_after_print', [disp.piece_type or 'shirt'])
            derive_pipeline_status(m)
            m._skip_timeline_signal = True
            m.save()
            label = disp.piece_label or dict(PART_TYPE_CHOICES).get(disp.piece_type or 'shirt', disp.piece_type or '')
            ModelTimeline.objects.create(
                model=m,
                stage='العد بعد الطباعة',
                title='استلام الموديل من المطبعة',
                notes=(
                    f"استلام دفعة ({batch_qty} قطعة) [{label}] — إجمالي المستلم {disp.received_pieces} من {total_pieces} "
                    f"من {disp.print_house} وتوجيه الموديل تلقائياً للعد بعد الطباعة"
                    + (f" | ملاحظات: {clean_notes}" if clean_notes else '')
                ),
                user=user_name,
                timestamp_str=now_str,
                details={
                    'phase_type': 'printing_received',
                    'record_id': get_ext_id(disp),
                    'shop_name': disp.print_house,
                    'piece_type': disp.piece_type or 'shirt',
                    'piece_label': label,
                    'print_type': disp.print_type,
                    'print_location': disp.print_location or '',
                    'pieces_count': disp.pieces_count,
                    'batch_qty': batch_qty,
                    'received_pieces': disp.received_pieces,
                    'remaining_pieces': max(0, total_pieces - disp.received_pieces),
                    'received_at': now_str,
                    'status': disp.status,
                    'worker_notes': clean_notes or (disp.notes or ''),
                    'operator_name': user_name,
                }
            )
        return Response(PrintDispatchSerializer(disp, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def receive(self, request, pk=None):
        request.data['status'] = 'تم الاستلام بالمصنع'
        return self.update_status(request, pk=pk)

    @action(detail=False, methods=['post'], url_path='skip_print')
    def skip_print(self, request):
        """Skips the printing stage for a single part and sends it to sewing."""
        model = resolve_by_id(ModelItem, request.data.get('model_id') or request.data.get('modelId'))
        if not model:
            return Response({'detail': 'الموديل غير موجود'}, status=status.HTTP_400_BAD_REQUEST)

        piece_type = normalize_part_key(
            request.data.get('piece_type') or request.data.get('pieceType') or 'shirt'
        )
        user_name = request.data.get('user_name') or 'مسؤول المطابع'
        now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
        label = dict(PART_TYPE_CHOICES).get(piece_type, piece_type)

        advance_parts_to_stage(model, 'sewing', [piece_type])
        derive_pipeline_status(model)
        model._skip_timeline_signal = True
        model.save()

        ModelTimeline.objects.create(
            model=model,
            stage='المطابع والتطريز',
            title=f'تخطي المطابع للقطعة [{label}]',
            notes=f'تم تخطي مرحلة المطابع والتطريز للقطعة [{label}] وتحويلها مباشرة إلى قسم المكن',
            user=user_name,
            timestamp_str=now_str,
            details={
                'phase_type': 'printing_skipped',
                'piece_type': piece_type,
                'piece_label': label,
                'operator_name': user_name,
            }
        )
        return Response(ModelItemSerializer(model, context={'request': request}).data)


class SewingDispatchViewSet(BasePermViewSet):
    permission_classes = [HasDynamicSectionPermission]
    required_section = 'sewing'
    queryset = SewingDispatch.objects.select_related('model').all()
    serializer_class = SewingDispatchSerializer
    # الإنشاء يتم عبر إجراء الموديل dispatch_to_sewing، والتعديل عبر receive فقط.
    http_method_names = ['get', 'post', 'head', 'options']

    def create(self, request, *args, **kwargs):
        """يمنع إنشاء إرسالية مكن مباشرة (تتجاوز حماية الأسعار) — استخدم إجراء الموديل."""
        return Response(
            {'detail': 'أنشئ إرسالية المكن من خلال الموديل (dispatch_to_sewing) لضمان حماية الأسعار.'},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    def update(self, request, *args, **kwargs):
        return Response(
            {'detail': 'تعديل إرسالية المكن متاح عبر إجراءات الاستلام فقط.'},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    @action(detail=True, methods=['post'])
    def receive(self, request, pk=None):
        disp_obj = self.get_object()
        user = request.data.get('user') or request.data.get('user_name') or 'مراقب الجودة'
        notes = request.data.get('notes') or ''
        received_qty = request.data.get('received_qty')
        if received_qty is None:
            received_qty = request.data.get('receivedQty')
        try:
            disp = receive_model_from_sewing_service(
                get_ext_id(disp_obj), user, notes=notes, received_qty=received_qty
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(SewingDispatchSerializer(disp, context={'request': request}).data)


class PackagingMaterialRuleViewSet(BasePermViewSet):
    """
    قواعد خامات التشغيل والأمبالاج (فئات ديناميكية قابلة للإضافة والحذف).
    الحفظ يستقبل تفاصيل كل مقاس داخل نفس الطلب عبر الحقل size_rules.
    """
    permission_classes = [HasDynamicSectionPermission]
    required_section = 'assembly_packaging'
    queryset = PackagingMaterialRule.objects.prefetch_related(
        'size_rules', 'size_rules__rule', 'size_rules__supplier',
        'size_rules__transactions'
    ).all()
    serializer_class = PackagingMaterialRuleSerializer

    def _as_float(self, value, default=0.0):
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    def _apply_size_rows(self, rule, rows, can_edit_prices=False):
        """Upserts the size-level rows of a rule and drops the removed ones."""
        keep_ids = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            size_group_id = str(row.get('size_group_id') or '').strip()
            size_row = rule.size_rules.filter(size_group_id=size_group_id).first()
            if size_row is None:
                size_row = PackagingMaterialSizeRule(rule=rule, size_group_id=size_group_id)
            size_row.size_group_name = row.get('size_group_name') or size_row.size_group_name or ''
            size_row.consumption_per_piece = self._as_float(row.get('consumption_per_piece'))
            size_row.dimensions_spec = row.get('dimensions_spec') or ''
            supplier_val = row.get('supplier_id') or row.get('supplier')
            size_row.supplier = resolve_by_id(Supplier, supplier_val) if supplier_val else None
            size_row.min_alert_threshold = self._as_float(row.get('min_alert_threshold'))
            # سعر الوحدة يُكتب فقط لمن يملك صلاحية تعديل أسعار الأسمبلي/الخامات.
            if can_edit_prices and row.get('price_per_unit') is not None:
                size_row.price_per_unit = max(0.0, self._as_float(row.get('price_per_unit')))
            if row.get('current_stock') is not None:
                size_row.current_stock = self._as_float(row.get('current_stock'))
            size_row.save()
            keep_ids.append(size_row.pk)
        # Never drop rows that still hold stock or a movement history; only prune empties.
        rule.size_rules.exclude(pk__in=keep_ids).filter(
            current_stock=0, transactions__isnull=True
        ).delete()


    def _save_rule(self, request, instance=None):
        data = request.data
        profile = getattr(request, 'user_profile', None)
        can_edit_prices = can_edit_department_prices(profile, 'edit_assembly_prices')
        rows = data.get('size_rules')
        if isinstance(rows, list):
            for row in rows:
                if isinstance(row, dict) and row.get('price_per_unit') not in (None, '') and not can_edit_prices:
                    raise PermissionDenied('ليس لديك صلاحية تعديل أسعار خامات التشغيل')
        if instance is not None:
            rule = instance
        else:
            material_key = str(data.get('material_key') or '').strip()[:60]
            if not material_key:
                # New category added from the UI without a key → generate a stable one.
                material_key = f"custom-{secrets.token_hex(5)}"
            rule = PackagingMaterialRule.objects.filter(material_key=material_key).first()
            if rule is None:
                rule = PackagingMaterialRule(material_key=material_key)
        rule.name = (
            str(data.get('name') or '').strip()
            or rule.name
            or PACKAGING_MATERIAL_LABELS.get(rule.material_key, rule.material_key)
        )
        icon = data.get('icon')
        if icon is not None:
            rule.icon = str(icon).strip()[:20]
        unit = data.get('unit')
        if unit in PACKAGING_MATERIAL_UNIT_KEYS:
            rule.unit = unit
        rule_mode = data.get('rule_mode')
        if rule_mode in PACKAGING_MATERIAL_RULE_MODE_KEYS:
            rule.rule_mode = rule_mode
        groups = data.get('applicable_size_groups')
        if isinstance(groups, list):
            rule.applicable_size_groups = [str(group) for group in groups]
        if 'is_active' in data:
            rule.is_active = bool(data.get('is_active'))
        rule.save()

        rows = data.get('size_rules')
        if isinstance(rows, list):
            self._apply_size_rows(rule, rows, can_edit_prices=can_edit_prices)
            if can_edit_prices:
                prices = [
                    self._as_float(row.get('price_per_unit'))
                    for row in rows if isinstance(row, dict)
                ]
                if prices:
                    log_price_change(
                        request, 'خامات التشغيل', rule.label,
                        'سعر وحدة الخامة', max(prices),
                    )

        return Response(
            PackagingMaterialRuleSerializer(rule, context={'request': request}).data,
            status=status.HTTP_200_OK
        )

    def create(self, request, *args, **kwargs):
        return self._save_rule(request)

    def update(self, request, *args, **kwargs):
        return self._save_rule(request, self.get_object())

    def destroy(self, request, *args, **kwargs):
        rule = self.get_object()
        label = rule.label
        rule.delete()
        return Response(
            {'detail': f'تم حذف خامة التشغيل ({label}) بنجاح'},
            status=status.HTTP_200_OK
        )

    @action(detail=True, methods=['post'])
    def record_transaction(self, request, pk=None):
        rule = self.get_object()
        data = request.data
        size_rule = resolve_by_id(
            PackagingMaterialSizeRule, data.get('size_rule_id') or data.get('size_rule')
        )
        if not size_rule or size_rule.rule_id != rule.pk:
            return Response({'detail': 'صف خامة التشغيل غير موجود'}, status=status.HTTP_400_BAD_REQUEST)
        operation = data.get('operation') or 'add'
        if operation not in ('add', 'deduct', 'adjust'):
            return Response({'detail': 'نوع الحركة غير صحيح'}, status=status.HTTP_400_BAD_REQUEST)
        price_per_unit, _total = read_department_cost_payload(
            request, getattr(request, 'user_profile', None),
            'edit_assembly_prices', 'أسعار خامات التشغيل',
        )
        txn = apply_packaging_material_transaction(
            size_rule, operation, data.get('amount'), data.get('notes') or '',
            data.get('timestamp') or '', price_per_unit=price_per_unit,
        )
        log_price_change(
            request, 'خامات التشغيل', str(size_rule),
            'سعر وحدة الخامة', price_per_unit,
        )
        return Response({
            'sizeRule': PackagingMaterialSizeRuleSerializer(
                size_rule, context={'request': request}
            ).data,
            'transaction': PackagingMaterialTransactionSerializer(
                txn, context={'request': request}
            ).data,
        }, status=status.HTTP_201_CREATED)


class PackagingMaterialTransactionViewSet(BasePermViewSet):
    """سجل حركات مخزون خامات التشغيل (وارد / منصرف / تعديل رصيد)."""
    permission_classes = [HasDynamicSectionPermission]
    required_section = 'assembly_packaging'
    queryset = PackagingMaterialTransaction.objects.select_related('size_rule').all()
    serializer_class = PackagingMaterialTransactionSerializer
    # الحركات تُسجَّل فقط؛ لا تعديل/حذف لسجلات المخزون التاريخية.
    http_method_names = ['get', 'post', 'head', 'options']

    def create(self, request, *args, **kwargs):
        data = request.data
        size_rule = resolve_by_id(
            PackagingMaterialSizeRule, data.get('size_rule_id') or data.get('size_rule')
        )
        if not size_rule:
            return Response({'detail': 'صف خامة التشغيل غير موجود'}, status=status.HTTP_400_BAD_REQUEST)
        operation = data.get('operation') or 'add'
        if operation not in ('add', 'deduct', 'adjust'):
            return Response({'detail': 'نوع الحركة غير صحيح'}, status=status.HTTP_400_BAD_REQUEST)
        price_per_unit, _total = read_department_cost_payload(
            request, getattr(request, 'user_profile', None),
            'edit_assembly_prices', 'أسعار خامات التشغيل',
        )
        txn = apply_packaging_material_transaction(
            size_rule, operation, data.get('amount'), data.get('notes') or '',
            data.get('timestamp') or '', price_per_unit=price_per_unit,
        )
        log_price_change(
            request, 'خامات التشغيل', str(size_rule),
            'سعر وحدة الخامة', price_per_unit,
        )
        return Response({
            'sizeRule': PackagingMaterialSizeRuleSerializer(
                size_rule, context={'request': request}
            ).data,
            'transaction': PackagingMaterialTransactionSerializer(
                txn, context={'request': request}
            ).data,
        }, status=status.HTTP_201_CREATED)


