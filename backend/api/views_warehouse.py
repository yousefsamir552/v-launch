from .views_common import *
from .views_common import _truthy_permission_keys, _accessory_price_snapshot

class SizeDefViewSet(BasePermViewSet):
    queryset = SizeDef.objects.all()
    serializer_class = SizeDefSerializer
    permission_classes = [CanManageCatalog]
    required_manage_perm = 'manage_sizes'

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
    permission_classes = [CanManageCatalog]
    required_manage_perm = 'manage_suppliers'

    def create(self, request, *args, **kwargs):
        data = request.data
        obj = Supplier.objects.create(
            client_id=data.get('id') or data.get('client_id'),
            name=(data.get('name') or '').strip(),
            phone=(data.get('phone') or '').strip(),
            whatsapp_group_link=(data.get('whatsapp_group_link') or '').strip(),
        )
        return Response(SupplierSerializer(obj).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        obj = self.get_object()
        data = request.data
        if 'name' in data and data['name']:
            obj.name = str(data['name']).strip()
        if 'phone' in data:
            obj.phone = str(data['phone'] or '').strip()
        if 'whatsapp_group_link' in data:
            obj.whatsapp_group_link = str(data['whatsapp_group_link'] or '').strip()
        obj.save()
        return Response(SupplierSerializer(obj).data)


def normalize_workshop_types(value):
    """يقبل قائمة أو نصاً مفرداً ويرجع قائمة مفاتيح تخصصات صحيحة فقط."""
    if value is None:
        return []
    raw = value if isinstance(value, (list, tuple)) else [value]
    cleaned = []
    for item in raw:
        key = str(item or '').strip()
        if key in WORKSHOP_TYPE_KEYS and key not in cleaned:
            cleaned.append(key)
    return cleaned


class WorkshopViewSet(BasePermViewSet):
    queryset = Workshop.objects.all()
    serializer_class = WorkshopSerializer
    permission_classes = [CanManageCatalog]
    required_manage_perm = 'manage_suppliers'

    def create(self, request, *args, **kwargs):
        data = request.data
        obj = Workshop.objects.create(
            client_id=data.get('id') or data.get('client_id'),
            name=(data.get('name') or '').strip(),
            phone=(data.get('phone') or '').strip(),
            whatsapp_group_link=(data.get('whatsapp_group_link') or '').strip(),
            workshop_type=normalize_workshop_types(data.get('workshop_type')),
            notes=(data.get('notes') or '').strip(),
        )
        return Response(WorkshopSerializer(obj).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        obj = self.get_object()
        data = request.data
        if 'name' in data and data['name']:
            obj.name = str(data['name']).strip()
        if 'phone' in data:
            obj.phone = str(data['phone'] or '').strip()
        if 'whatsapp_group_link' in data:
            obj.whatsapp_group_link = str(data['whatsapp_group_link'] or '').strip()
        if 'workshop_type' in data:
            obj.workshop_type = normalize_workshop_types(data['workshop_type'])
        if 'notes' in data:
            obj.notes = str(data['notes'] or '').strip()
        obj.save()
        return Response(WorkshopSerializer(obj).data)


class FabricViewSet(BasePermViewSet):
    permission_classes = [HasDynamicSectionPermission]
    required_section = 'fabric'
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
            image=clean_image_value(data.get('image') or '', 'fabrics', 'صورة الخامة'),
        )
        return Response(FabricSerializer(fab, context={'request': request}).data, status=status.HTTP_201_CREATED)

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
        try:
            qty = float(data.get('quantity') or 0)
        except (TypeError, ValueError):
            return Response({'detail': 'الكمية غير صحيحة'}, status=status.HTTP_400_BAD_REQUEST)
        if qty < 0:
            return Response({'detail': 'الكمية لا يمكن أن تكون سالبة'}, status=status.HTTP_400_BAD_REQUEST)
        profile = getattr(request, 'user_profile', None)
        can_edit_price = is_sudo_account(profile) or (
            profile is not None and (
                profile.has_perm('edit_fabric_prices') or profile.has_perm('manage_permissions')
            )
        )
        price_per_unit = 0.0
        if can_edit_price and data.get('pricePerUnit') not in (None, ''):
            price_per_unit = max(0.0, float(data.get('pricePerUnit') or 0))

        now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
        with transaction.atomic():
            existing_color = (
                FabricColor.objects.select_for_update()
                .filter(fabric=fab, color_code__iexact=clean_code)
                .first()
            )
            was_existing = existing_color is not None
            old_qty = round(float(existing_color.quantity or 0), 2) if existing_color else 0.0
            if existing_color:
                existing_color.quantity = round(float(existing_color.quantity or 0) + qty, 2)
                if can_edit_price and data.get('pricePerUnit') not in (None, ''):
                    existing_color.price_per_unit = price_per_unit
                existing_color.save()
                color_obj = existing_color
                txn_notes = 'إضافة رصيد وارد للون موجود بالمخزن'
            else:
                color_obj = FabricColor.objects.create(
                    client_id=data.get('colorClientId'),
                    fabric=fab,
                    color_code=clean_code,
                    color_name=data.get('colorName') or '',
                    hex_code=data.get('hexCode') or '#64748b',
                    price_per_unit=price_per_unit,
                    quantity=round(max(0.0, qty), 2),
                    reserved_quantity=0.0,
                )
                txn_notes = 'رصيد افتتاحي عند إضافة اللون للمخزن'

            if qty > 0:
                FabricTransaction.objects.create(
                    color=color_obj,
                    fabric=fab,
                    model_code_ref='',
                    notes=txn_notes,
                    operation='add',
                    amount=round(qty, 2),
                    timestamp=now_str,
                    unit_price_snapshot=color_obj.price_per_unit or 0,
                    supplier=resolve_supplier_link(
                        data,
                        getattr(fab, 'supplier_id_ref', None),
                        getattr(fab, 'supplier', None),
                    ),
                )

        color_label = f"{fab.name} - {color_obj.color_code}" + (f" ({color_obj.color_name})" if color_obj.color_name else "")
        audit_changes = [
            {
                'field': 'quantity',
                'label': f'الرصيد ({fab.unit})',
                'old': f'{old_qty:g}',
                'new': f'{float(color_obj.quantity or 0):g}',
            }
        ]
        if can_edit_price and data.get('pricePerUnit') not in (None, ''):
            audit_changes.append({
                'field': 'price_per_unit',
                'label': 'سعر الوحدة',
                'old': '—',
                'new': f'{price_per_unit:g}',
            })
        set_audit_meta(
            request,
            action_type='transaction' if was_existing else 'create',
            target_name=color_label,
            details=(
                f"أضاف رصيد وارد (+{qty:g} {fab.unit}) للون موجود: {color_label}"
                if was_existing
                else f"أضاف قماش/لون جديد: {color_label} (رصيد افتتاحي {qty:g} {fab.unit})"
            ),
            changes=audit_changes,
        )

        return Response({
            'fabric': FabricSerializer(fab, context={'request': request}).data,
            'color': FabricColorSerializer(color_obj, context={'request': request}).data,
        })


class FabricColorViewSet(BasePermViewSet):
    permission_classes = [HasDynamicSectionPermission]
    required_section = 'fabric'
    queryset = FabricColor.objects.select_related('fabric').all()
    serializer_class = FabricColorSerializer

    def update(self, request, *args, **kwargs):
        target = self.get_object()
        data = request.data
        profile = getattr(request, 'user_profile', None)
        can_edit_price = is_sudo_account(profile) or (
            profile is not None and (
                profile.has_perm('edit_fabric_prices') or profile.has_perm('manage_permissions')
            )
        )
        if 'price_per_unit' in data and not can_edit_price:
            raise PermissionDenied('ليس لديك صلاحية تعديل أسعار الخامات')
        # Lock the row so two concurrent stock adjustments cannot overwrite each other.
        with transaction.atomic():
            col = FabricColor.objects.select_for_update().select_related('fabric').get(pk=target.pk)
            old_qty = round(float(col.quantity or 0), 2)
            if 'price_per_unit' in data and can_edit_price and data['price_per_unit'] not in (None, ''):
                col.price_per_unit = max(0.0, float(data['price_per_unit'] or 0))
            if 'quantity' in data:
                try:
                    new_qty = float(data['quantity'] if data['quantity'] not in (None, '') else 0)
                except (TypeError, ValueError):
                    return Response({'detail': 'الكمية غير صحيحة'}, status=status.HTTP_400_BAD_REQUEST)
                if new_qty < 0:
                    return Response({'detail': 'الكمية لا يمكن أن تكون سالبة'}, status=status.HTTP_400_BAD_REQUEST)
                col.quantity = round(new_qty, 2)
            if 'reserved_quantity' in data:
                col.reserved_quantity = max(0.0, float(data['reserved_quantity'] or 0))
            if 'color_code' in data and str(data['color_code']).strip():
                col.color_code = str(data['color_code']).strip()
            if 'color_name' in data:
                col.color_name = data['color_name']
            if 'hex_code' in data:
                col.hex_code = data['hex_code']
            col.save()
            diff = round(float(col.quantity or 0) - old_qty, 2)
            if 'quantity' in data and abs(diff) > 0:
                FabricTransaction.objects.create(
                    color=col,
                    fabric=col.fabric,
                    model_code_ref='',
                    notes='تعديل رصيد مباشر من مخزن القماش',
                    operation='add' if diff > 0 else 'deduct',
                    amount=abs(diff),
                    timestamp=timezone.now().strftime('%Y-%m-%d %H:%M'),
                    unit_price_snapshot=col.price_per_unit or 0,
                    supplier=resolve_supplier_link(
                        data,
                        getattr(col.fabric, 'supplier_id_ref', None),
                        getattr(col.fabric, 'supplier', None),
                    ),
                )
            response_data = FabricColorSerializer(col, context={'request': request}).data
        return Response(response_data)

    @action(detail=False, methods=['post'])
    def record_transaction(self, request):
        data = request.data
        color_id = data.get('colorId') or data.get('color_id')
        target = resolve_by_id(FabricColor, color_id)
        if not target:
            return Response({'detail': 'اللون غير موجود'}, status=status.HTTP_404_NOT_FOUND)

        op = str(data.get('operation') or '').strip()
        if op not in ('add', 'deduct'):
            return Response({'detail': 'نوع العملية غير صالح؛ المسموح add أو deduct فقط'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            amount = float(data.get('amount') or 0)
        except (TypeError, ValueError):
            return Response({'detail': 'الكمية غير صحيحة'}, status=status.HTTP_400_BAD_REQUEST)
        if amount <= 0:
            return Response({'detail': 'الكمية يجب أن تكون أكبر من صفر'}, status=status.HTTP_400_BAD_REQUEST)

        # Lock the row: two concurrent deductions must never spend the same stock twice
        # nor eat into stock reserved for models in Design.
        with transaction.atomic():
            col = FabricColor.objects.select_for_update().select_related('fabric').get(pk=target.pk)
            old_qty = round(float(col.quantity or 0), 2)
            if op == 'deduct':
                live_reserved = float(
                    ModelRequirement.objects.filter(
                        color=col,
                        model__is_deleted=False,
                        model__status__in=('مرحلة التصميم', 'تصميم'),
                    ).aggregate(total=models.Sum('planned_quantity'))['total'] or 0
                )
                reserved = max(float(col.reserved_quantity or 0), live_reserved)
                available = round(max(0.0, float(col.quantity or 0) - reserved), 2)
                if float(col.quantity or 0) < amount:
                    return Response({'detail': 'الكمية الموجودة بالمخزن لا تكفي للصرف'}, status=status.HTTP_400_BAD_REQUEST)
                if amount > available + 1e-6:
                    return Response(
                        {'detail': f'الكمية المتاحة للصرف ({available:g}) لا تكفي؛ يوجد ({reserved:g}) محجوزة لموديلات في مرحلة التصميم'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            if op == 'add':
                col.quantity = round(float(col.quantity or 0) + amount, 2)
            else:
                col.quantity = max(0.0, round(float(col.quantity or 0) - amount, 2))
            col.save()
            new_qty = round(float(col.quantity or 0), 2)

            tr = FabricTransaction.objects.create(
                client_id=data.get('id') or data.get('client_id'),
                color=col,
                fabric=col.fabric,
                model_code_ref=data.get('modelCodeRef') or '',
                notes=data.get('notes') or '',
                operation=op,
                amount=amount,
                timestamp=data.get('timestamp') or timezone.now().strftime('%Y-%m-%d %H:%M'),
                # سعر الوحدة التاريخي وقت الحركة + ربط المورد تلقائياً من الخامة عند عدم تمريره.
                unit_price_snapshot=col.price_per_unit or 0,
                supplier=resolve_supplier_link(
                    data,
                    getattr(col.fabric, 'supplier_id_ref', None),
                    getattr(col.fabric, 'supplier', None),
                ),
            )
            payload = {
                'color': FabricColorSerializer(col, context={'request': request}).data,
                'transaction': FabricTransactionSerializer(tr, context={'request': request}).data,
            }
        unit_label = getattr(col.fabric, 'unit', 'كيلو') or 'كيلو'
        fabric_name = getattr(col.fabric, 'name', '') or ''
        color_label = f"{fabric_name} - {col.color_code}" + (f" ({col.color_name})" if col.color_name else "")
        op_verb = 'وارد (إضافة رصيد)' if op == 'add' else 'منصرف (خصم رصيد)'
        sign = '+' if op == 'add' else '-'
        note_suffix = f" | {tr.notes}" if tr.notes else ''
        set_audit_meta(
            request,
            action_type='transaction',
            target_name=color_label,
            details=f"{op_verb} {sign}{amount:g} {unit_label} على {color_label}{note_suffix}",
            changes=[
                {'field': 'operation', 'label': 'نوع الحركة', 'old': '—', 'new': op_verb},
                {'field': 'amount', 'label': f'الكمية ({unit_label})', 'old': '—', 'new': f'{sign}{amount:g}'},
                {'field': 'quantity', 'label': f'الرصيد ({unit_label})', 'old': f'{old_qty:g}', 'new': f'{new_qty:g}'},
            ],
        )
        return Response(payload)


class CanReadFabricLedger(permissions.BasePermission):
    """قراءة سجل حركات القماش الكامل (بدون اقتطاع 300 صف) لمخزن القماش والتقارير وحركة الموديلات."""
    def has_permission(self, request, view):
        profile = getattr(request, 'user_profile', None) or resolve_request_user_profile(request)
        if profile is None:
            return False
        request.user_profile = profile
        if is_sudo_profile(profile):
            return True
        if request.method not in permissions.SAFE_METHODS:
            return False
        return any(
            profile.has_perm(k)
            for k in (
                'fabric_warehouse_view', 'fabric_warehouse_edit',
                'reports_view', 'reports_edit', 'can_reports',
                'models_tracking_view', 'models_tracking_edit',
            )
        )


class FabricTransactionViewSet(BaseReadOnlyPermViewSet):
    permission_classes = [CanReadFabricLedger]
    queryset = FabricTransaction.objects.select_related('color', 'fabric').all()
    serializer_class = FabricTransactionSerializer


class AccessoryTypeViewSet(BasePermViewSet):
    permission_classes = [HasDynamicSectionPermission]
    required_section = 'accessories'
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
    permission_classes = [HasDynamicSectionPermission]
    required_section = 'accessories'
    queryset = Accessory.objects.all()
    serializer_class = AccessorySerializer

    def create(self, request, *args, **kwargs):
        data = request.data
        usage_type = data.get('usage_type') or 'stock'
        raw_qty = to_decimal(data.get('quantity', data.get('current_stock', 0)), Decimal('0'))
        if raw_qty < 0:
            return Response({'detail': 'الكمية لا يمكن أن تكون سالبة'}, status=status.HTTP_400_BAD_REQUEST)
        qty = raw_qty
        min_thresh = max(Decimal('0'), to_decimal(data.get('min_threshold', 10), Decimal('10')))
        target_qty = max(Decimal('0'), to_decimal(data.get('target_quantity', min_thresh), min_thresh))
        delivered_qty = max(Decimal('0'), to_decimal(data.get('delivered_quantity', qty), qty))
        # "الرصيد السابق / المرحّل" بضاعة قديمة تُصفّى فقط:
        # لا حد تنبيه، ولا شروط custom_model (الكمية المستهدفة/الموردة بلا معنى).
        if usage_type == 'carryover':
            min_thresh = Decimal('0')
            target_qty = Decimal('0')
            delivered_qty = Decimal('0')
        profile = getattr(request, 'user_profile', None)
        can_edit_price = is_sudo_account(profile) or (
            profile is not None and (
                profile.has_perm('edit_accessory_prices') or profile.has_perm('manage_permissions')
            )
        )
        price = (
            max(0.0, float(data.get('price_per_unit') or 0))
            if (can_edit_price and data.get('price_per_unit') not in (None, ''))
            else 0.0
        )

        with transaction.atomic():
            acc = Accessory.objects.create(
                client_id=data.get('id') or data.get('client_id'),
                type_id_ref=data.get('type_id') or 'type-1',
                type_name=data.get('type_name') or 'عام',
                code=(data.get('code') or '').strip().upper(),
                name=(data.get('name') or '').strip(),
                image=clean_image_value(data.get('image') or '', 'accessories', 'صورة الصنف'),
                unit=data.get('unit') or 'قطعة',
                current_stock=qty,
                reserved_quantity=float(data.get('reserved_quantity') or 0),
                price_per_unit=price,
                supplier_id_ref=data.get('supplier_id') or '',
                min_threshold=min_thresh,
                usage_type=usage_type,
                custom_model_code='' if usage_type == 'carryover' else (data.get('custom_model_code') or ''),
                target_quantity=target_qty,
                delivered_quantity=delivered_qty,
                withdrawn_for_model=False if usage_type == 'carryover' else bool(data.get('withdrawn_for_model', False)),
                notes=data.get('notes') or '',
                created_at_str=data.get('created_at') or date.today().isoformat(),
            )
            if qty > 0:
                AccessoryTransaction.objects.create(
                    accessory=acc,
                    accessory_code=acc.code,
                    accessory_name=acc.name,
                    operation='add',
                    amount=float(qty),
                    model_code_ref=acc.custom_model_code or '',
                    notes='رصيد افتتاحي عند إضافة الصنف للمخزن',
                    timestamp=timezone.now().strftime('%Y-%m-%d %H:%M'),
                    unit_price_snapshot=acc.price_per_unit or 0,
                    supplier=resolve_supplier_link(
                        data,
                        getattr(acc, 'supplier_id_ref', None),
                        getattr(acc, 'supplier', None),
                    ),
                )
        return Response(
            AccessorySerializer(acc, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        target = self.get_object()
        data = request.data
        profile = getattr(request, 'user_profile', None)
        can_edit_price = is_sudo_account(profile) or (
            profile is not None and (
                profile.has_perm('edit_accessory_prices') or profile.has_perm('manage_permissions')
            )
        )
        if 'price_per_unit' in data and not can_edit_price:
            raise PermissionDenied('ليس لديك صلاحية تعديل أسعار الإكسسوارات')
        # ارفع الصورة (إن وُجدت) قبل فتح المعاملة حتى لا نمسك قفل الصف أثناء الشبكة.
        new_image = None
        if 'image' in data:
            new_image = clean_image_value(data.get('image') or '', 'accessories', 'صورة الصنف')
        # Lock the row so concurrent stock adjustments are serialised.
        with transaction.atomic():
            acc = Accessory.objects.select_for_update().get(pk=target.pk)
            old_stock = to_decimal(acc.current_stock, Decimal('0'))
            for field in ['name', 'code', 'unit', 'usage_type', 'custom_model_code', 'type_name']:
                if field in data:
                    setattr(acc, field, data[field])
            if new_image is not None:
                acc.image = new_image
            if 'type_id' in data:
                acc.type_id_ref = data['type_id']
            if 'supplier_id' in data:
                acc.supplier_id_ref = data['supplier_id']
            stock_updated = False
            if 'quantity' in data:
                new_stk = to_decimal(data['quantity'], Decimal('0'))
                if new_stk < 0:
                    return Response({'detail': 'الكمية لا يمكن أن تكون سالبة'}, status=status.HTTP_400_BAD_REQUEST)
                acc.current_stock = new_stk
                stock_updated = True
            elif 'current_stock' in data:
                new_stk = to_decimal(data['current_stock'], Decimal('0'))
                if new_stk < 0:
                    return Response({'detail': 'الكمية لا يمكن أن تكون سالبة'}, status=status.HTTP_400_BAD_REQUEST)
                acc.current_stock = new_stk
                stock_updated = True
            if 'reserved_quantity' in data:
                acc.reserved_quantity = max(0.0, float(data['reserved_quantity'] or 0))
            if 'price_per_unit' in data and can_edit_price and data['price_per_unit'] not in (None, ''):
                acc.price_per_unit = max(0.0, float(data['price_per_unit'] or 0))
            if 'min_threshold' in data:
                acc.min_threshold = max(Decimal('0'), to_decimal(data['min_threshold'], Decimal('0')))
            if 'target_quantity' in data:
                acc.target_quantity = max(Decimal('0'), to_decimal(data['target_quantity'], Decimal('0')))
            if 'delivered_quantity' in data:
                acc.delivered_quantity = max(Decimal('0'), to_decimal(data['delivered_quantity'], Decimal('0')))
            if 'withdrawn_for_model' in data:
                acc.withdrawn_for_model = bool(data['withdrawn_for_model'])
            if 'notes' in data:
                acc.notes = data['notes'] or ''
            # تطبيع "الرصيد السابق / المرحّل": لا حد تنبيه ولا بيانات موديل مخصص.
            if acc.usage_type == 'carryover':
                acc.min_threshold = Decimal('0')
                acc.custom_model_code = ''
                acc.target_quantity = Decimal('0')
                acc.delivered_quantity = Decimal('0')
                acc.withdrawn_for_model = False
            acc.save()
            diff = acc.current_stock - old_stock
            if stock_updated and diff != 0:
                AccessoryTransaction.objects.create(
                    accessory=acc,
                    accessory_code=acc.code,
                    accessory_name=acc.name,
                    operation='add' if diff > 0 else 'deduct',
                    amount=float(abs(diff)),
                    model_code_ref=acc.custom_model_code or '',
                    notes='تعديل رصيد مباشر من مخزن الإكسسوارات',
                    timestamp=timezone.now().strftime('%Y-%m-%d %H:%M'),
                    unit_price_snapshot=acc.price_per_unit or 0,
                    supplier=resolve_supplier_link(
                        data,
                        getattr(acc, 'supplier_id_ref', None),
                        getattr(acc, 'supplier', None),
                    ),
                )
            response_data = AccessorySerializer(acc, context={'request': request}).data
        return Response(response_data)

    @action(detail=False, methods=['post'])
    def record_transaction(self, request):
        data = request.data
        acc_id = data.get('accessoryId') or data.get('accessory_id')
        acc = resolve_by_id(Accessory, acc_id)
        if not acc:
            return Response({'detail': 'الصنف غير موجود'}, status=status.HTTP_404_NOT_FOUND)

        op = str(data.get('operation') or '').strip()
        if op not in ('add', 'deduct'):
            return Response({'detail': 'نوع العملية غير صالح؛ المسموح add أو deduct فقط'}, status=status.HTTP_400_BAD_REQUEST)
        amount_dec = to_decimal(data.get('amount'), Decimal('0'))
        amount = float(amount_dec)
        if amount_dec <= 0:
            return Response({'detail': 'الكمية يجب أن تكون أكبر من صفر'}, status=status.HTTP_400_BAD_REQUEST)

        # Lock the row: concurrent deductions must not oversell the same stock.
        with transaction.atomic():
            acc = Accessory.objects.select_for_update().get(pk=acc.pk)
            current_dec = to_decimal(acc.current_stock, Decimal('0'))
            old_stock_num = float(current_dec)
            if op == 'deduct' and current_dec < amount_dec:
                return Response({'detail': 'الرصيد المتاح لا يكفي للصرف'}, status=status.HTTP_400_BAD_REQUEST)

            if op == 'add':
                acc.current_stock = current_dec + amount_dec
                if acc.usage_type == 'custom_model':
                    acc.delivered_quantity = to_decimal(acc.delivered_quantity, Decimal('0')) + amount_dec
            else:
                acc.current_stock = max(Decimal('0'), current_dec - amount_dec)
            acc.save()
            new_stock_num = float(acc.current_stock)

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
                # سعر الوحدة التاريخي وقت الحركة + ربط المورد تلقائياً من الإكسسوار عند عدم تمريره.
                unit_price_snapshot=getattr(acc, 'price_per_unit', 0) or 0,
                supplier=resolve_supplier_link(
                    data,
                    getattr(acc, 'supplier_id_ref', None),
                    getattr(acc, 'supplier', None),
                ),
            )
            payload = {
                'accessory': AccessorySerializer(acc, context={'request': request}).data,
                'transaction': AccessoryTransactionSerializer(tr, context={'request': request}).data,
            }
        acc_label = f"{acc.name} ({acc.code})" if acc.code else acc.name
        unit_label = acc.unit or 'قطعة'
        op_verb = 'وارد (إضافة رصيد)' if op == 'add' else 'منصرف (خصم رصيد)'
        sign = '+' if op == 'add' else '-'
        note_suffix = f" | {tr.notes}" if tr.notes else ''
        set_audit_meta(
            request,
            action_type='transaction',
            target_name=acc_label,
            details=f"{op_verb} {sign}{amount:g} {unit_label} على الإكسسوار {acc_label}{note_suffix}",
            changes=[
                {'field': 'operation', 'label': 'نوع الحركة', 'old': '—', 'new': op_verb},
                {'field': 'amount', 'label': f'الكمية ({unit_label})', 'old': '—', 'new': f'{sign}{amount:g}'},
                {'field': 'current_stock', 'label': f'الرصيد ({unit_label})', 'old': f'{old_stock_num:g}', 'new': f'{new_stock_num:g}'},
            ],
        )
        return Response(payload)

    @action(detail=False, methods=['get'])
    def alerts(self, request):
        result = get_accessory_deficits()
        return Response(result)

    @action(detail=True, methods=['post'])
    def mark_withdrawn(self, request, pk=None):
        accessory = self.get_object()
        accessory.withdrawn_for_model = True
        accessory.save()
        return Response(AccessorySerializer(accessory, context={'request': request}).data)


class CanReadAccessoryLedger(permissions.BasePermission):
    """قراءة سجل حركات الإكسسوارات الكامل لمخزن الإكسسوارات والتقارير وحركة الموديلات."""
    def has_permission(self, request, view):
        profile = getattr(request, 'user_profile', None) or resolve_request_user_profile(request)
        if profile is None:
            return False
        request.user_profile = profile
        if is_sudo_profile(profile):
            return True
        if request.method not in permissions.SAFE_METHODS:
            return False
        return any(
            profile.has_perm(k)
            for k in (
                'accessories_warehouse_view', 'accessories_warehouse_edit',
                'reports_view', 'reports_edit', 'can_reports',
                'models_tracking_view', 'models_tracking_edit',
            )
        )


class AccessoryTransactionViewSet(BaseReadOnlyPermViewSet):
    permission_classes = [CanReadAccessoryLedger]
    queryset = AccessoryTransaction.objects.select_related('accessory').all()
    serializer_class = AccessoryTransactionSerializer


