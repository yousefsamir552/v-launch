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
        profile = getattr(request, 'user_profile', None)
        can_edit_price = is_sudo_account(profile) or (
            profile is not None and (
                profile.has_perm('edit_fabric_prices') or profile.has_perm('manage_permissions')
            )
        )
        price_per_unit = 0.0
        if can_edit_price:
            price_per_unit = max(0.0, float(data.get('pricePerUnit') or 0))
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
                price_per_unit=price_per_unit,
                quantity=max(0.0, qty),
                reserved_quantity=0.0,
            )

        return Response({
            'fabric': FabricSerializer(fab).data,
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
            if 'price_per_unit' in data and can_edit_price:
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
            response_data = FabricColorSerializer(col, context={'request': request}).data
        return Response(response_data)

    @action(detail=False, methods=['post'])
    def record_transaction(self, request):
        data = request.data
        color_id = data.get('colorId') or data.get('color_id')
        target = resolve_by_id(FabricColor, color_id)
        if not target:
            return Response({'detail': 'اللون غير موجود'}, status=status.HTTP_404_NOT_FOUND)

        op = data.get('operation', 'deduct')
        amount = float(data.get('amount') or 0)
        if amount <= 0:
            return Response({'detail': 'الكمية يجب أن تكون أكبر من صفر'}, status=status.HTTP_400_BAD_REQUEST)

        # Lock the row: two concurrent deductions must never spend the same stock twice.
        with transaction.atomic():
            col = FabricColor.objects.select_for_update().select_related('fabric').get(pk=target.pk)
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
        return Response(payload)


class FabricTransactionViewSet(BasePermViewSet):
    permission_classes = [HasDynamicSectionPermission]
    required_section = 'fabric'
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
        qty = int(float(data.get('quantity', data.get('current_stock', 0)) or 0))
        min_thresh = int(float(data.get('min_threshold', 10) or 0))
        target_qty = int(float(data.get('target_quantity', min_thresh) or 0))
        delivered_qty = int(float(data.get('delivered_quantity', qty) or 0))
        profile = getattr(request, 'user_profile', None)
        can_edit_price = is_sudo_account(profile) or (
            profile is not None and (
                profile.has_perm('edit_accessory_prices') or profile.has_perm('manage_permissions')
            )
        )
        price = max(0.0, float(data.get('price_per_unit') or 0)) if can_edit_price else 0.0

        acc = Accessory.objects.create(
            client_id=data.get('id') or data.get('client_id'),
            type_id_ref=data.get('type_id') or 'type-1',
            type_name=data.get('type_name') or 'عام',
            code=(data.get('code') or '').strip().upper(),
            name=(data.get('name') or '').strip(),
            image=clean_image_value(data.get('image') or '', 'accessories', 'صورة الصنف'),
            unit=data.get('unit') or 'قطعة',
            current_stock=max(0, qty),
            reserved_quantity=float(data.get('reserved_quantity') or 0),
            price_per_unit=price,
            supplier_id_ref=data.get('supplier_id') or '',
            min_threshold=max(0, min_thresh),
            usage_type=usage_type,
            custom_model_code=data.get('custom_model_code') or '',
            target_quantity=target_qty,
            delivered_quantity=delivered_qty,
            withdrawn_for_model=bool(data.get('withdrawn_for_model', False)),
            created_at_str=data.get('created_at') or date.today().isoformat(),
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
            for field in ['name', 'code', 'unit', 'usage_type', 'custom_model_code', 'type_name']:
                if field in data:
                    setattr(acc, field, data[field])
            if new_image is not None:
                acc.image = new_image
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
            if 'price_per_unit' in data and can_edit_price:
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
            response_data = AccessorySerializer(acc, context={'request': request}).data
        return Response(response_data)

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

        # Lock the row: concurrent deductions must not oversell the same stock.
        with transaction.atomic():
            acc = Accessory.objects.select_for_update().get(pk=acc.pk)
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


class AccessoryTransactionViewSet(BasePermViewSet):
    permission_classes = [HasDynamicSectionPermission]
    required_section = 'accessories'
    queryset = AccessoryTransaction.objects.select_related('accessory').all()
    serializer_class = AccessoryTransactionSerializer


