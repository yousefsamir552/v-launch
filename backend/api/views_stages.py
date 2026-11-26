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
        try:
            if isinstance(raw_layers, list) and len(raw_layers) > 0:
                for item in raw_layers:
                    if not isinstance(item, dict):
                        continue
                    c_name = (item.get('color_name') or item.get('colorName') or '').strip()
                    raw_lc = item.get('layers_count') if 'layers_count' in item else item.get('layersCount')
                    raw_lw = item.get('layer_weight') if 'layer_weight' in item else item.get('layerWeight')
                    raw_lp = item.get('pieces_count') if 'pieces_count' in item else item.get('piecesCount')
                    l_count = int(parse_finite_float(raw_lc, 'عدد الراقات', default=0.0, minimum=0.0))
                    l_weight = parse_finite_float(raw_lw, 'وزن الراق', default=0.0, minimum=0.0)
                    l_pieces = int(parse_finite_float(raw_lp, 'عدد القطع', default=0.0, minimum=0.0))
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

            if parsed_layers:
                layers = total_layers_from_items
            else:
                raw_layers_count = data.get('layers_count') if 'layers_count' in data else data.get('layersCount')
                layers = int(parse_finite_float(raw_layers_count, 'عدد الراقات', default=0.0, minimum=0.0))
            raw_ppl = data.get('pieces_per_layer') if 'pieces_per_layer' in data else data.get('piecesPerLayer')
            pieces_per_layer = int(parse_finite_float(raw_ppl, 'عدد القطع في الراق', default=0.0, minimum=0.0))
            weight = parse_finite_float(
                data.get('layer_weight') if 'layer_weight' in data else data.get('layerWeight'),
                'وزن الطبقة',
                default=0.0,
                minimum=0.0,
            )

            # Automatically calculate cut pieces = layers * pieces_per_layer (fallback to pieces_count if legacy)
            if pieces_per_layer > 0 and layers > 0:
                pieces = layers * pieces_per_layer
            else:
                raw_pc = data.get('pieces_count') if 'pieces_count' in data else data.get('piecesCount')
                pieces = int(parse_finite_float(raw_pc, 'عدد القطع', default=0.0, minimum=0.0))
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

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

        req_client_id = data.get('id') or data.get('client_id') or data.get('request_id')
        with transaction.atomic():
            # اقفل سجل الموديل أولاً ثم احسب رقم الفرشة، حتى لا تحصل فرشتان
            # متزامنتان على نفس الرقم (Race Condition). نستخدم أكبر رقم موجود + 1
            # (وليس عدد السجلات) حتى لا يتكرر رقم فرشة بعد حذف إحدى الفرشات.
            model = ModelItem.objects.select_for_update().get(pk=model.pk)
            if req_client_id:
                existing_rec = CuttingRecord.objects.filter(client_id=str(req_client_id)).first()
                if existing_rec:
                    return Response(
                        CuttingRecordSerializer(existing_rec, context={'request': request}).data,
                        status=status.HTTP_200_OK,
                    )
            last_spread_num = (
                CuttingRecord.objects.filter(model=model)
                .order_by('-spread_number')
                .values_list('spread_number', flat=True)
                .first()
            ) or 0
            # توليد رقم الفرشة تلقائياً على الباك إند داخل قفل الموديل لمنع أي تكرار أو تعارض.
            spread_num = int(last_spread_num) + 1
            rec = CuttingRecord.objects.create(
                client_id=req_client_id,
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
                    layer_weight=item['layer_weight'] if item['layer_weight'] > 0 else weight,
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
        data = request.data if isinstance(request.data, dict) else {}
        model = resolve_by_id(ModelItem, data.get('model_id') or data.get('modelId'))
        if not model:
            return Response({'detail': 'الموديل غير موجود'}, status=status.HTTP_400_BAD_REQUEST)

        stage = str(data.get('stage') or 'before_print').strip() or 'before_print'
        raw_notes = str(data.get('defect_notes') or data.get('defectNotes') or data.get('notes') or '').strip()

        profile = getattr(request, 'user_profile', None)
        can_write_notes = True
        if profile:
            if stage == 'before_print' and not profile.has_perm('can_add_qc_before_print_notes'):
                can_write_notes = False
            elif stage in ('after_print', 'after_sewing') and not profile.has_perm('can_add_qc_after_print_notes'):
                can_write_notes = False
        if not can_write_notes:
            raw_notes = ''

        raw_good = data.get('good_qty')
        if raw_good is None or raw_good == '':
            raw_good = data.get('goodQty')
        if raw_good is None or raw_good == '':
            raw_good = data.get('counted_pieces')
        raw_defect = data.get('defect_qty')
        if raw_defect is None or raw_defect == '':
            raw_defect = data.get('defectQty')
        if raw_defect is None or raw_defect == '':
            raw_defect = data.get('defect_pieces')

        try:
            good_qty = parse_qc_nonneg_int(raw_good, 'عدد القطع السليمة', default=0)
            defect_qty = parse_qc_nonneg_int(raw_defect, 'عدد القطع التالفة', default=0)
            pieces_cut_ref = parse_qc_nonneg_int(
                data.get('pieces_cut'),
                'عدد القطع المقصوصة',
                default=int(model.total_cut_pieces or 0),
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        inspector = str(data.get('inspector_name') or 'مراقب الجودة').strip() or 'مراقب الجودة'
        now_str = str(data.get('created_at') or timezone.now().strftime('%Y-%m-%d %H:%M')).strip()
        color_name = str(data.get('color_name') or data.get('colorName') or '').strip()
        size_val = str(data.get('size') or '').strip()
        model_default_part = (get_model_parts(model) or ['shirt'])[0]
        part_type = normalize_part_key(data.get('part_type') or data.get('partType') or model_default_part)

        try:
            with transaction.atomic():
                model = ModelItem.objects.select_for_update().get(pk=model.pk)
                prev_stages = dict(model.part_stages) if isinstance(model.part_stages, dict) else {}
                validate_qc_stage_progression(model, stage, [part_type])

                rec = upsert_qc_record(
                    model,
                    stage=stage,
                    part_type=part_type,
                    color_name=color_name,
                    size=size_val,
                    pieces_cut=pieces_cut_ref,
                    good_qty=good_qty,
                    defect_qty=defect_qty,
                    notes=raw_notes,
                    can_write_notes=can_write_notes,
                    checked_by=inspector,
                    created_at_str=now_str,
                    client_id=data.get('id') or data.get('client_id'),
                )

                model._skip_timeline_signal = True
                if (model.part_stages or {}) != prev_stages:
                    model.save(update_fields=['part_stages', 'updated_at'])
                recompute_model_part_totals(model)
        except (ValueError, ValidationError, IntegrityError) as exc:
            return Response(
                {'detail': format_validation_error(exc, 'تعذر حفظ سجل الفرز')},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(QCRecordSerializer(rec).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'])
    def save_matrix(self, request):
        """
        Bulk save/upsert QC matrix records (Color x Size) for a given model and stage.
        """
        data = request.data if isinstance(request.data, dict) else {}
        model = resolve_by_id(ModelItem, data.get('model_id') or data.get('modelId'))
        if not model:
            return Response({'detail': 'الموديل غير موجود'}, status=status.HTTP_400_BAD_REQUEST)

        stage = str(data.get('stage') or 'before_print').strip() or 'before_print'
        entries = data.get('matrix_entries')
        if entries is None:
            entries = data.get('matrixEntries')
        if entries is None:
            entries = []
        if not isinstance(entries, list):
            return Response(
                {'detail': 'صيغة بيانات مصفوفة الفرز غير صالحة'},
                status=status.HTTP_400_BAD_REQUEST,
            )
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

        inspector = str(data.get('inspector_name') or data.get('user_name') or 'مراقب الجودة').strip() or 'مراقب الجودة'
        now_str = str(data.get('created_at') or timezone.now().strftime('%Y-%m-%d %H:%M')).strip()
        pieces_cut_ref = int(model.total_cut_pieces or model.target_cut_quantity or 0)

        model_default_part = (get_model_parts(model) or ['shirt'])[0]
        default_part_type = normalize_part_key(data.get('part_type') or data.get('partType') or model_default_part)

        parsed_entries = []
        try:
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                c_name = str(entry.get('color_name') or entry.get('colorName') or '').strip()
                sz = str(entry.get('size') or '').strip()
                if not c_name and not sz:
                    continue
                entry_part = normalize_part_key(
                    entry.get('part_type') or entry.get('partType') or default_part_type
                )
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
                    str(entry.get('notes') or entry.get('defect_notes') or raw_notes or '').strip()
                    if can_write_notes else ''
                )
                parsed_entries.append({
                    'part_type': entry_part,
                    'color_name': c_name,
                    'size': sz,
                    'good_qty': g_qty,
                    'defect_qty': d_qty,
                    'notes': cell_notes,
                    'client_id': entry.get('id') or entry.get('client_id'),
                })
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        touched_parts = sorted({item['part_type'] for item in parsed_entries}) or [default_part_type]

        saved_by_id = {}
        try:
            with transaction.atomic():
                model = ModelItem.objects.select_for_update().get(pk=model.pk)
                prev_stages = dict(model.part_stages) if isinstance(model.part_stages, dict) else {}
                validate_qc_stage_progression(model, stage, touched_parts)

                for item in parsed_entries:
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
                        checked_by=inspector,
                        created_at_str=now_str,
                        client_id=item['client_id'],
                    )
                    saved_by_id[rec.pk] = rec

                # Recompute per-part + aggregate stage counts from the records
                model._skip_timeline_signal = True
                if (model.part_stages or {}) != prev_stages:
                    model.save(update_fields=['part_stages', 'updated_at'])
                recompute_model_part_totals(model)
        except (ValueError, ValidationError, IntegrityError) as exc:
            return Response(
                {'detail': format_validation_error(exc, 'تعذر حفظ مصفوفة الجودة')},
                status=status.HTTP_400_BAD_REQUEST,
            )

        saved_list = list(saved_by_id.values())
        stage_label = {
            'before_print': 'قبل الطباعة',
            'after_print': 'بعد الطباعة',
            'after_sewing': 'بعد المكن',
        }.get(stage, stage)
        total_good = sum(int(r.counted_pieces or 0) for r in saved_list)
        total_def = sum(int(r.defect_pieces or 0) for r in saved_list)
        set_audit_meta(
            request,
            action_type='update',
            target_name=model.model_code,
            details=f"حفظ مصفوفة الجودة ({stage_label}) للموديل {model.model_code}: {len(saved_list)} خلية (سليم: {total_good}، تالف: {total_def})",
            changes=[
                {'field': 'stage', 'label': 'المرحلة', 'old': '—', 'new': stage_label},
                {'field': 'counted_pieces', 'label': 'إجمالي السليم', 'old': '—', 'new': str(total_good)},
                {'field': 'defect_pieces', 'label': 'إجمالي التالف', 'old': '—', 'new': str(total_def)},
            ],
        )

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
        try:
            pieces = int(parse_finite_float(
                data.get('pieces_count') if 'pieces_count' in data else data.get('piecesCount'),
                'عدد القطع المرسلة',
                default=0,
                minimum=1,
            ))
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        print_type = (data.get('print_type') or data.get('printType') or 'سلك سكرين مائي').strip()
        piece_type = (data.get('piece_type') or data.get('pieceType') or 'shirt').strip() or 'shirt'
        if piece_type not in PART_TYPE_KEYS:
            piece_type = 'shirt'
        piece_label = (data.get('piece_label') or data.get('pieceLabel') or '').strip() or dict(PART_TYPE_CHOICES).get(piece_type, '')
        print_location = (data.get('print_location') or data.get('printLocation') or '').strip()
        print_details = (data.get('print_details') or data.get('printDetails') or '').strip()
        cost = 0.0
        if can_edit_cost:
            try:
                raw_cost = data.get('cost_per_piece') if 'cost_per_piece' in data else data.get('costPerPiece')
                cost = parse_finite_float(raw_cost, 'سعر الطباعة للقطعة', default=0.0, minimum=0.0)
            except ValueError as exc:
                return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        exp_date = data.get('expected_delivery_date') or data.get('expectedDeliveryDate') or None
        if exp_date and not isinstance(exp_date, date):
            exp_date = parse_date(str(exp_date)[:10])
        notes = (data.get('notes') or '').strip() if can_printing_notes else ''
        now_str = data.get('dispatched_at') or timezone.now().strftime('%Y-%m-%d %H:%M')
        user_name = data.get('user_name') or 'مسؤول المطابع'
        req_client_id = data.get('id') or data.get('client_id') or data.get('request_id')

        with transaction.atomic():
            model = ModelItem.objects.select_for_update().get(pk=model.pk)
            if req_client_id:
                existing_disp = PrintDispatch.objects.filter(client_id=str(req_client_id)).first()
                if existing_disp:
                    return Response(
                        PrintDispatchSerializer(existing_disp, context={'request': request}).data,
                        status=status.HTTP_200_OK,
                    )
            if (model.status or '').strip() in ('مرحلة التصميم', 'تصميم'):
                return Response(
                    {'detail': 'لا يمكن إرسال الموديل للمطبعة وهو لا يزال في مرحلة التصميم؛ يجب صرف القماش والقص أولاً.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            part_cut = 0
            if piece_type in ('shirt', 'pants', 'jacket'):
                part_cut = int(getattr(model, f'cut_{piece_type}_pieces', 0) or 0)
            if part_cut <= 0:
                part_cut = int(model.total_cut_pieces or 0)
            if part_cut <= 0:
                return Response(
                    {'detail': 'لا يمكن إرسال الموديل للمطبعة قبل تسجيل كميات القص الفعلية.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if pieces > part_cut:
                return Response(
                    {'detail': f'عدد القطع المرسلة للمطبعة ({pieces}) يتجاوز الكمية المقصوصة ({part_cut}).'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            disp = PrintDispatch.objects.create(
                client_id=req_client_id,
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
        set_audit_meta(
            request,
            section='المطابع والتطريز',
            action_type='create',
            target_name=f"{model.model_code} - {shop_name}",
            details=f"إرسال {pieces} قطعة ({piece_label}) للموديل {model.model_code} إلى مطبعة {shop_name}",
        )
        return Response(PrintDispatchSerializer(disp, context={'request': request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def update_status(self, request, pk=None):
        disp_obj = self.get_object()
        data = request.data
        new_status = data.get('status') or 'تم الاستلام بالمصنع'
        user_name = data.get('user_name') or 'مسؤول المطابع'
        now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
        clean_notes = (data.get('notes') or '').strip()

        received_qty_raw = data.get('received_qty')
        if received_qty_raw is None:
            received_qty_raw = data.get('receivedQty')
        quick_receive = parse_bool_flag(
            data.get('quick_receive') if 'quick_receive' in data else data.get('quickReceive'),
            default=False,
        )
        has_qty_input = received_qty_raw not in (None, '')
        is_receiving = (
            quick_receive
            or new_status in ('تم الاستلام', 'تم الاستلام بالمصنع')
            or has_qty_input
        )

        with transaction.atomic():
            disp = PrintDispatch.objects.select_for_update().select_related('model').get(pk=disp_obj.pk)
            m = ModelItem.objects.select_for_update().get(pk=disp.model_id)

            total_pieces = int(disp.pieces_count or 0)
            already_received = int(disp.received_pieces or 0)
            remaining_before = max(0, total_pieces - already_received)

            if is_receiving:
                if quick_receive:
                    if disp.status in ('تم الاستلام', 'تم الاستلام بالمصنع') and remaining_before <= 0:
                        return Response(
                            {'detail': 'تم استلام هذه التشغيلة مسبقاً'},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    batch_qty = remaining_before
                else:
                    if remaining_before <= 0:
                        return Response(
                            {'detail': 'تم استلام كامل كمية هذه التشغيلة مسبقاً'},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    if not has_qty_input:
                        return Response(
                            {'detail': 'يجب تحديد عدد القطع المستلمة صراحةً (أكبر من صفر)'},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    try:
                        requested_qty = int(received_qty_raw)
                    except (TypeError, ValueError):
                        return Response(
                            {'detail': 'عدد القطع المستلمة يجب أن يكون رقماً صحيحاً موجباً'},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    if requested_qty <= 0:
                        return Response(
                            {'detail': 'عدد القطع المستلمة يجب أن يكون أكبر من صفر'},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    if requested_qty > remaining_before:
                        return Response(
                            {
                                'detail': f'لا يمكن استلام ({requested_qty}) قطعة — المتبقي عند المطبعة ({remaining_before}) قطعة فقط'
                            },
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    batch_qty = requested_qty

                disp.received_pieces = already_received + batch_qty
                history = list(disp.receive_history) if isinstance(disp.receive_history, list) else []
                history_entry = {
                    'date': now_str,
                    'qty': batch_qty,
                    'total_received': disp.received_pieces,
                    'user': user_name,
                    'notes': clean_notes,
                }
                if quick_receive:
                    history_entry['quick_receive'] = True
                history.append(history_entry)
                disp.receive_history = history
                disp.received_date = date.today()
                disp.received_at_str = now_str
                if clean_notes:
                    from .services_stages import _append_receive_note
                    disp.notes = _append_receive_note(disp.notes, clean_notes)
                is_complete = quick_receive or (disp.received_pieces >= total_pieces)
                disp.status = 'تم الاستلام بالمصنع' if is_complete else 'استلام جزئي'
            else:
                batch_qty = 0
                is_complete = False
                disp.status = new_status
            disp.save()

            if is_receiving:
                # لا نُرقّي القطعة إلى «العد بعد الطباعة» إلا عند اكتمال استلام كامل الكمية
                # وعدم وجود إرساليات مطابع أخرى معلقة لنفس القطعة.
                other_pending_same_part = PrintDispatch.objects.filter(
                    model=m,
                    piece_type=disp.piece_type or 'shirt',
                ).exclude(pk=disp.pk).exclude(
                    status__in=('تم الاستلام', 'تم الاستلام بالمصنع')
                ).exists()
                if is_complete and not other_pending_same_part:
                    advance_parts_to_stage(m, 'qc_after_print', [disp.piece_type or 'shirt'])
                    derive_pipeline_status(m)
                    m._skip_timeline_signal = True
                    m.save()
                label = disp.piece_label or dict(PART_TYPE_CHOICES).get(disp.piece_type or 'shirt', disp.piece_type or '')
                tl_notes = (
                    (
                        f"تم تسجيل استلام [{label}] من مطبعة {disp.print_house} بتاريخ {now_str} "
                        f"(بانتظار العد الفعلي وتقييم المطبعة في الفرز بعد الطباعة)"
                        + (f" | ملاحظات: {clean_notes}" if clean_notes else '')
                    )
                    if quick_receive
                    else (
                        f"استلام دفعة ({batch_qty} قطعة) [{label}] — إجمالي المستلم {disp.received_pieces} من {total_pieces} "
                        f"من {disp.print_house}"
                        + (" وتوجيه الموديل تلقائياً للعد بعد الطباعة" if is_complete else "")
                        + (f" | ملاحظات: {clean_notes}" if clean_notes else '')
                    )
                )
                ModelTimeline.objects.create(
                    model=m,
                    stage='العد بعد الطباعة' if is_complete else 'المطابع والتطريز',
                    title='استلام الموديل من المطبعة' if is_complete else 'استلام جزئي من المطبعة',
                    notes=tl_notes,
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
                        'quick_receive': quick_receive,
                        'status': disp.status,
                        'worker_notes': clean_notes,
                        'operator_name': user_name,
                    }
                )
        set_audit_meta(
            request,
            section='المطابع والتطريز',
            action_type='status_change',
            target_name=f"{m.model_code} - {disp.print_house}",
            details=(
                f"تسجيل استلام [{disp.piece_label or disp.piece_type}] لموديل {m.model_code} "
                f"من {disp.print_house} بتاريخ {now_str}"
                if quick_receive
                else f"تحديث حالة إرسالية المطبعة ({disp.print_house}) لموديل {m.model_code} إلى {disp.status}"
            ),
        )
        return Response(PrintDispatchSerializer(disp, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def receive(self, request, pk=None):
        if hasattr(request.data, '_mutable'):
            request.data._mutable = True
        if isinstance(request.data, dict):
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

        with transaction.atomic():
            model = ModelItem.objects.select_for_update().get(pk=model.pk)
            if model.status in ('مرحلة التصميم', 'تصميم'):
                return Response(
                    {'detail': 'لا يمكن تخطي المطابع لموديل لا يزال في مرحلة التصميم'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
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
        set_audit_meta(
            request,
            action_type='status_change',
            target_name=f'{model.model_code} - {label}',
            details=f"تخطى مرحلة المطابع للقطعة [{label}] بالموديل {model.model_code} وحوّلها لقسم المكن",
            changes=[
                {'field': 'stage', 'label': f'مرحلة القطعة ({label})', 'old': 'المطابع', 'new': 'قسم المكن'},
            ],
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
        quick_receive = parse_bool_flag(
            request.data.get('quick_receive')
            if 'quick_receive' in request.data
            else request.data.get('quickReceive'),
            default=False,
        )
        try:
            disp = receive_model_from_sewing_service(
                get_ext_id(disp_obj),
                user,
                notes=notes,
                received_qty=received_qty,
                quick_receive=quick_receive,
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        set_audit_meta(
            request,
            section='المكن',
            action_type='status_change',
            target_name=f"{disp.model.model_code} - {disp.workshop_name}",
            details=(
                f"تسجيل استلام [{disp.piece_label or disp.piece_type}] لموديل {disp.model.model_code} "
                f"من ورشة {disp.workshop_name} بتاريخ {disp.received_at_str or ''}"
                if quick_receive
                else f"استلام إرسالية مكن لموديل {disp.model.model_code} من ورشة {disp.workshop_name} ({disp.status})"
            ),
        )
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
            num = float(value)
            if not math.isfinite(num):
                return default
            return max(0.0, num)
        except (TypeError, ValueError):
            return default

    def _apply_size_rows(self, rule, rows, can_edit_prices=False):
        """Upserts the size-level rows of a rule and drops the removed ones safely."""
        keep_ids = []
        now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
        for row in rows:
            if not isinstance(row, dict):
                continue
            size_group_id = str(row.get('size_group_id') or '').strip()
            size_row = rule.size_rules.select_for_update().filter(size_group_id=size_group_id).first()
            is_new = size_row is None
            old_stock = round(float(size_row.current_stock or 0), 3) if size_row is not None else 0.0
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
                size_row.price_per_unit = self._as_float(row.get('price_per_unit'))
            stock_changed = False
            if row.get('current_stock') is not None:
                incoming_stock = round(self._as_float(row.get('current_stock')), 3)
                if is_new or abs(incoming_stock - old_stock) > 1e-6:
                    size_row.current_stock = incoming_stock
                    stock_changed = not is_new
            size_row.save()
            if stock_changed:
                PackagingMaterialTransaction.objects.create(
                    size_rule=size_row,
                    operation='adjust',
                    amount=float(size_row.current_stock or 0),
                    price_per_unit=float(size_row.price_per_unit or 0),
                    notes=f'تعديل رصيد مباشر من إعدادات القاعدة (من {old_stock:g} إلى {float(size_row.current_stock or 0):g})',
                    timestamp=now_str,
                )
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
        with transaction.atomic():
            if instance is not None:
                rule = PackagingMaterialRule.objects.select_for_update().get(pk=instance.pk)
            else:
                material_key = str(data.get('material_key') or '').strip()[:60]
                if not material_key:
                    # New category added from the UI without a key → generate a stable one.
                    material_key = f"custom-{secrets.token_hex(5)}"
                rule = PackagingMaterialRule.objects.select_for_update().filter(material_key=material_key).first()
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
        if rule.size_rules.filter(current_stock__gt=0).exists():
            return Response(
                {'detail': f'لا يمكن حذف خامة التشغيل ({label}) لوجود رصيد فعلي بالمخزن. قم بتصفير الرصيد أولاً.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if PackagingMaterialTransaction.objects.filter(size_rule__rule=rule).exists():
            return Response(
                {'detail': f'لا يمكن حذف خامة التشغيل ({label}) لوجود سجل حركات تاريخية مرتبط بها حفاظاً على دقة التقارير.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if rule.size_rules.filter(consumption_per_piece__gt=0).exists():
            return Response(
                {'detail': f'لا يمكن حذف خامة التشغيل ({label}) لوجود قواعد استهلاك نشطة مرتبطة بها.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
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
        req_client_id = data.get('id') or data.get('client_id') or data.get('request_id')
        model_code_ref = str(data.get('modelCodeRef') or data.get('model_code_ref') or '').strip()
        linked_model = resolve_by_id(ModelItem, data.get('model_id') or data.get('modelId'))
        if linked_model is None and model_code_ref:
            linked_model = ModelItem.objects.filter(model_code__iexact=model_code_ref, is_deleted=False).first()
        old_stock = float(size_rule.current_stock or 0)
        try:
            txn = apply_packaging_material_transaction(
                size_rule, operation, data.get('amount'), data.get('notes') or '',
                data.get('timestamp') or '', price_per_unit=price_per_unit,
                client_id=req_client_id, model=linked_model, model_code_ref=model_code_ref,
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if getattr(txn, '_idempotent_hit', False):
            return Response({
                'sizeRule': PackagingMaterialSizeRuleSerializer(
                    size_rule, context={'request': request}
                ).data,
                'transaction': PackagingMaterialTransactionSerializer(
                    txn, context={'request': request}
                ).data,
            }, status=status.HTTP_200_OK)
        new_stock = float(size_rule.current_stock or 0)
        op_label = {'add': 'وارد (إضافة)', 'deduct': 'منصرف (خصم)', 'adjust': 'تعديل رصيد'}.get(operation, operation)
        set_audit_meta(
            request,
            action_type='transaction',
            target_name=str(size_rule),
            details=f"سجّل حركة خامات تشغيل ({op_label}) بكمية {data.get('amount')} على {size_rule}",
            changes=[
                {'field': 'operation', 'label': 'نوع الحركة', 'old': '—', 'new': op_label},
                {'field': 'current_stock', 'label': 'الرصيد', 'old': f'{old_stock:g}', 'new': f'{new_stock:g}'},
            ],
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
    queryset = PackagingMaterialTransaction.objects.select_related('size_rule', 'model').all()
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
        req_client_id = data.get('id') or data.get('client_id') or data.get('request_id')
        model_code_ref = str(data.get('modelCodeRef') or data.get('model_code_ref') or '').strip()
        linked_model = resolve_by_id(ModelItem, data.get('model_id') or data.get('modelId'))
        if linked_model is None and model_code_ref:
            linked_model = ModelItem.objects.filter(model_code__iexact=model_code_ref, is_deleted=False).first()
        old_stock = float(size_rule.current_stock or 0)
        try:
            txn = apply_packaging_material_transaction(
                size_rule, operation, data.get('amount'), data.get('notes') or '',
                data.get('timestamp') or '', price_per_unit=price_per_unit,
                client_id=req_client_id, model=linked_model, model_code_ref=model_code_ref,
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if getattr(txn, '_idempotent_hit', False):
            return Response({
                'sizeRule': PackagingMaterialSizeRuleSerializer(
                    size_rule, context={'request': request}
                ).data,
                'transaction': PackagingMaterialTransactionSerializer(
                    txn, context={'request': request}
                ).data,
            }, status=status.HTTP_200_OK)
        new_stock = float(size_rule.current_stock or 0)
        op_label = {'add': 'وارد (إضافة)', 'deduct': 'منصرف (خصم)', 'adjust': 'تعديل رصيد'}.get(operation, operation)
        set_audit_meta(
            request,
            action_type='transaction',
            target_name=str(size_rule),
            details=f"سجّل حركة خامات تشغيل ({op_label}) بكمية {data.get('amount')} على {size_rule}",
            changes=[
                {'field': 'operation', 'label': 'نوع الحركة', 'old': '—', 'new': op_label},
                {'field': 'current_stock', 'label': 'الرصيد', 'old': f'{old_stock:g}', 'new': f'{new_stock:g}'},
            ],
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


class WorkshopEvaluationViewSet(BasePermViewSet):
    """
    إدارة تقييمات الورش والمطابع (1–5 نجوم: ميعاد التسليم، جودة الشغل، جودة التشطيب).
    يدعم التقييم عند استلام إرسالية المطبعة أو المكن أو التشطيب أو من زر التقييم المباشر،
    ويحدث التقييم تلقائياً إن كان مسجلاً لنفس الإرسالية.
    """
    queryset = WorkshopEvaluation.objects.select_related(
        'workshop', 'model', 'print_dispatch', 'sewing_dispatch', 'finishing_record'
    ).filter(model__is_deleted=False)
    serializer_class = WorkshopEvaluationSerializer

    READ_PERMS = (
        'qc_view', 'qc_edit',
        'printing_view', 'printing_edit',
        'sewing_view', 'sewing_edit',
        'assembly_packaging_view', 'assembly_packaging_edit',
        'reports_view', 'reports_edit', 'can_reports',
        'models_tracking_view', 'models_tracking_edit',
    )
    WRITE_PERMS = (
        'qc_edit', 'printing_edit', 'sewing_edit', 'assembly_packaging_edit',
        'reports_edit', 'manage_permissions',
    )

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        profile = getattr(request, 'user_profile', None)
        if is_sudo_account(profile):
            return
        if profile is None:
            raise PermissionDenied('مطلوب تسجيل الدخول')
        if request.method in permissions.SAFE_METHODS:
            if not any(profile.has_perm(p) for p in self.READ_PERMS):
                raise PermissionDenied('ليس لديك صلاحية عرض تقييمات الورش')
        else:
            if not any(profile.has_perm(p) for p in self.WRITE_PERMS):
                raise PermissionDenied('ليس لديك صلاحية تسجيل أو تعديل تقييمات الورش')

    def _parse_rating(self, data, *keys, default=5):
        raw = None
        for k in keys:
            if k in data and data.get(k) not in (None, ''):
                raw = data.get(k)
                break
        if raw is None:
            return default
        try:
            val = int(round(float(raw)))
        except (TypeError, ValueError):
            raise ValueError('التقييم يجب أن يكون رقماً صحيحاً بين 1 و 5')
        if val < 1 or val > 5:
            raise ValueError('التقييم يجب أن يكون بين 1 و 5 نجوم')
        return val

    def create(self, request, *args, **kwargs):
        data = request.data or {}
        profile = getattr(request, 'user_profile', None)

        print_dispatch = resolve_by_id(
            PrintDispatch, data.get('print_dispatch_id') or data.get('printDispatchId')
        )
        sewing_dispatch = resolve_by_id(
            SewingDispatch, data.get('sewing_dispatch_id') or data.get('sewingDispatchId')
        )
        finishing_record = resolve_by_id(
            FinishingRecord, data.get('finishing_record_id') or data.get('finishingRecordId')
        )

        model = resolve_by_id(ModelItem, data.get('model_id') or data.get('modelId'))
        if not model:
            if print_dispatch:
                model = print_dispatch.model
            elif sewing_dispatch:
                model = sewing_dispatch.model
            elif finishing_record:
                model = finishing_record.model
        if not model:
            return Response({'detail': 'الموديل مطلوب لتسجيل التقييم'}, status=status.HTTP_400_BAD_REQUEST)

        stage = str(data.get('stage') or '').strip().lower()
        if not stage:
            if print_dispatch:
                stage = 'printing'
            elif finishing_record:
                stage = 'finishing'
            else:
                stage = 'sewing'
        if stage not in WORKSHOP_EVALUATION_STAGE_KEYS:
            return Response(
                {'detail': 'فئة التقييم غير صحيحة (المتاح: printing / sewing / finishing)'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        workshop_name = str(
            data.get('workshop_name')
            or data.get('workshopName')
            or (print_dispatch.print_house if print_dispatch else '')
            or (sewing_dispatch.workshop_name if sewing_dispatch else '')
            or (finishing_record.vendor_name if finishing_record else '')
            or ''
        ).strip()
        workshop = resolve_workshop_link(data, workshop_name)
        if not workshop:
            if print_dispatch and print_dispatch.workshop_id:
                workshop = print_dispatch.workshop
            elif sewing_dispatch and sewing_dispatch.workshop_id:
                workshop = sewing_dispatch.workshop
            elif finishing_record and finishing_record.workshop_id:
                workshop = finishing_record.workshop
        if not workshop_name and workshop:
            workshop_name = workshop.name
        if not workshop_name:
            return Response({'detail': 'اسم الورشة أو المطبعة مطلوب'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            delivery_timeliness = self._parse_rating(data, 'delivery_timeliness', 'deliveryTimeliness')
            work_quality = self._parse_rating(data, 'work_quality', 'workQuality')
            finishing_quality = self._parse_rating(data, 'finishing_quality', 'finishingQuality')
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        notes = str(data.get('notes') or '').strip()
        evaluated_by = (
            str(data.get('evaluated_by') or data.get('evaluatedBy') or '').strip()
            or (profile.real_name if profile and not is_sudo_account(profile) else '')
            or 'مسؤول التشغيل'
        )

        # Upsert عند التقييم لنفس الإرسالية حتى لا تتكرر التقييمات.
        existing = None
        if print_dispatch:
            existing = WorkshopEvaluation.objects.filter(print_dispatch=print_dispatch).first()
        elif sewing_dispatch:
            existing = WorkshopEvaluation.objects.filter(sewing_dispatch=sewing_dispatch).first()
        elif finishing_record:
            existing = WorkshopEvaluation.objects.filter(finishing_record=finishing_record).first()

        if existing:
            existing.workshop = workshop
            existing.workshop_name = workshop_name
            existing.stage = stage
            existing.delivery_timeliness = delivery_timeliness
            existing.work_quality = work_quality
            existing.finishing_quality = finishing_quality
            existing.notes = notes
            existing.evaluated_by = evaluated_by
            existing.save()
            obj = existing
            http_status = status.HTTP_200_OK
        else:
            obj = WorkshopEvaluation.objects.create(
                client_id=data.get('id') or data.get('client_id'),
                workshop=workshop,
                workshop_name=workshop_name,
                stage=stage,
                model=model,
                print_dispatch=print_dispatch,
                sewing_dispatch=sewing_dispatch,
                finishing_record=finishing_record,
                delivery_timeliness=delivery_timeliness,
                work_quality=work_quality,
                finishing_quality=finishing_quality,
                notes=notes,
                evaluated_by=evaluated_by,
            )
            http_status = status.HTTP_201_CREATED

        set_audit_meta(
            request,
            section='تقييم الورش',
            action_type='update' if existing else 'create',
            target_name=f"{workshop_name} ({model.model_code})",
            details=(
                f"تقييم ورشة {workshop_name} لموديل {model.model_code}: "
                f"التسليم {delivery_timeliness}/5، الجودة {work_quality}/5، التشطيب {finishing_quality}/5 "
                f"(المتوسط {obj.overall_score}/5)"
            ),
            changes=[
                {'field': 'delivery_timeliness', 'label': 'ميعاد التسليم', 'old': '—', 'new': f'{delivery_timeliness}/5'},
                {'field': 'work_quality', 'label': 'جودة الشغل', 'old': '—', 'new': f'{work_quality}/5'},
                {'field': 'finishing_quality', 'label': 'جودة التشطيب', 'old': '—', 'new': f'{finishing_quality}/5'},
            ],
        )
        return Response(WorkshopEvaluationSerializer(obj, context={'request': request}).data, status=http_status)

    def update(self, request, *args, **kwargs):
        obj = self.get_object()
        data = request.data or {}
        try:
            if 'delivery_timeliness' in data or 'deliveryTimeliness' in data:
                obj.delivery_timeliness = self._parse_rating(
                    data, 'delivery_timeliness', 'deliveryTimeliness', default=obj.delivery_timeliness
                )
            if 'work_quality' in data or 'workQuality' in data:
                obj.work_quality = self._parse_rating(
                    data, 'work_quality', 'workQuality', default=obj.work_quality
                )
            if 'finishing_quality' in data or 'finishingQuality' in data:
                obj.finishing_quality = self._parse_rating(
                    data, 'finishing_quality', 'finishingQuality', default=obj.finishing_quality
                )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if 'notes' in data:
            obj.notes = str(data.get('notes') or '').strip()
        obj.save()
        return Response(WorkshopEvaluationSerializer(obj, context={'request': request}).data)


