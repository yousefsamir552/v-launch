from rest_framework import serializers
from .models import (
    SystemSetting, GlobalSettings, Role, UserProfile, SizeDef, Supplier,
    Fabric, FabricColor, FabricTransaction,
    AccessoryType, Accessory, AccessoryTransaction,
    ModelItem, ModelRequirement, ModelAccessory, ModelTimeline,
    CuttingRecord, CuttingSpreadLayer, QCRecord, PrintDispatch,
    SewingDispatch, AppNotification, InternalMessage, AuditLog
)


def resolve_by_id(model_cls, val):
    if val is None or val == '':
        return None
    s_val = str(val).strip()
    obj = model_cls.objects.filter(client_id=s_val).first()
    if obj:
        return obj
    if s_val.isdigit():
        return model_cls.objects.filter(pk=int(s_val)).first()
    return None


def get_ext_id(obj) -> str:
    if not obj:
        return ''
    return obj.client_id or str(obj.id)


class GlobalSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = GlobalSettings
        fields = '__all__'

    def to_representation(self, instance):
        return {
            'id': str(instance.id),
            'site_name': instance.site_name or 'نظام إدارة المصنع',
            'logo': instance.logo or '🏭',
            'footer_title': instance.footer_title or '🏭 نظام إدارة المصنع المتكامل - مصانع الملابس الجاهزة (ERP v2.0)',
            'copyright_text': instance.copyright_text or f'تم التطوير لدعم دورة الإنتاج الشاملة والصلاحيات المتقدمة © {instance.updated_at.year if instance.updated_at else 2026}',
            'whatsapp_supplier_template': instance.whatsapp_supplier_template or '',
            'default_sewing_instructions': instance.default_sewing_instructions or '',
            'internal_message_templates': instance.internal_message_templates if isinstance(instance.internal_message_templates, list) else [],
            'favorite_accessory_ids': (
                SystemSetting.objects.filter(key='favorite_accessory_ids').first().value.get('ids', [])
                if SystemSetting.objects.filter(key='favorite_accessory_ids').exists()
                and isinstance(SystemSetting.objects.filter(key='favorite_accessory_ids').first().value, dict)
                else []
            ),
            'updated_by': instance.updated_by or '',
            'updated_at': instance.updated_at.isoformat() if instance.updated_at else '',
        }


class RoleSerializer(serializers.ModelSerializer):
    permissions = serializers.JSONField(required=False)
    users_count = serializers.SerializerMethodField()

    class Meta:
        model = Role
        fields = '__all__'

    def get_users_count(self, obj):
        return obj.users.exclude(username__iexact='sudo').exclude(is_sudo=True).count()

    def to_representation(self, instance):
        return {
            'id': get_ext_id(instance),
            'name': instance.name,
            'description': instance.description or '',
            'permissions': instance.get_permissions_dict(),
            'users_count': self.get_users_count(instance),
            'created_at': instance.created_at.isoformat() if instance.created_at else '',
        }


class UserProfileSerializer(serializers.ModelSerializer):
    role_details = RoleSerializer(source='role', read_only=True)

    class Meta:
        model = UserProfile
        fields = '__all__'
        extra_kwargs = {
            'password_hash': {'write_only': True},
            'auth_token': {'write_only': True},
        }

    def to_representation(self, instance):
        role_name = instance.role.name if instance.role else (instance.role_title or 'موظف تشغيل')
        role_ext_id = get_ext_id(instance.role) if instance.role else None
        return {
            'id': get_ext_id(instance),
            'username': instance.username,
            'real_name': instance.real_name,
            'phone': instance.phone or '',
            'role': role_name,
            'role_id': role_ext_id,
            'is_sudo': bool(instance.is_sudo or instance.username.lower() == 'sudo'),
            'permissions': instance.custom_permissions or {},
            'is_active': bool(instance.is_active),
            'last_active': instance.last_active.isoformat() if instance.last_active else None,
            'last_seen': instance.last_seen.isoformat() if instance.last_seen else None,
        }


class SizeDefSerializer(serializers.ModelSerializer):
    class Meta:
        model = SizeDef
        fields = '__all__'

    def to_representation(self, instance):
        return {
            'id': get_ext_id(instance),
            'name': instance.name,
            'values': instance.values,
        }


class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = '__all__'

    def to_representation(self, instance):
        return {
            'id': get_ext_id(instance),
            'name': instance.name,
            'phone': instance.phone or '',
        }


class FabricSerializer(serializers.ModelSerializer):
    class Meta:
        model = Fabric
        fields = '__all__'

    def to_representation(self, instance):
        return {
            'id': get_ext_id(instance),
            'name': instance.name,
            'description': instance.description or '',
            'unit': instance.unit or 'كيلو',
            'supplier_id': instance.supplier_id_ref or '',
            'image': instance.image or '',
            'is_deleted': bool(instance.is_deleted),
        }


class FabricColorSerializer(serializers.ModelSerializer):
    class Meta:
        model = FabricColor
        fields = '__all__'

    def to_representation(self, instance):
        price = float(instance.price_per_unit or 0)
        return {
            'id': get_ext_id(instance),
            'fabric_id': get_ext_id(instance.fabric),
            'color_code': instance.color_code,
            'color_name': instance.color_name or '',
            'hex_code': instance.hex_code or '#64748b',
            'price_per_unit': price,
            'quantity': float(instance.quantity or 0),
            'reserved_quantity': float(instance.reserved_quantity or 0),
        }


class FabricTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = FabricTransaction
        fields = '__all__'

    def to_representation(self, instance):
        return {
            'id': get_ext_id(instance),
            'color_id': get_ext_id(instance.color),
            'fabric_id': get_ext_id(instance.fabric),
            'model_code_ref': instance.model_code_ref or '',
            'notes': instance.notes or '',
            'operation': instance.operation,
            'amount': float(instance.amount or 0),
            'timestamp': instance.timestamp or (instance.created_at.strftime('%Y-%m-%d %H:%M') if instance.created_at else ''),
        }


class AccessoryTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccessoryType
        fields = '__all__'

    def to_representation(self, instance):
        return {
            'id': get_ext_id(instance),
            'name': instance.name,
            'icon': instance.icon or 'Sparkles',
            'description': instance.description or '',
        }


class AccessorySerializer(serializers.ModelSerializer):
    deficit_quantity = serializers.ReadOnlyField()

    class Meta:
        model = Accessory
        fields = '__all__'

    def to_representation(self, instance):
        return {
            'id': get_ext_id(instance),
            'type_id': instance.type_id_ref or 'type-1',
            'type_name': instance.type_name or 'عام',
            'code': instance.code or f"ACC-{instance.id}",
            'name': instance.name,
            'image': instance.image or 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=500&auto=format&fit=crop&q=60',
            'unit': instance.unit or 'قطعة',
            'quantity': float(instance.current_stock or 0),
            'reserved_quantity': float(instance.reserved_quantity or 0),
            'price_per_unit': float(instance.price_per_unit or 0),
            'supplier_id': instance.supplier_id_ref or '',
            'min_threshold': int(instance.min_threshold or 0),
            'created_at': instance.created_at_str or '',
            'usage_type': instance.usage_type or 'stock',
            'custom_model_code': instance.custom_model_code or '',
            'target_quantity': int(instance.target_quantity or 0),
            'delivered_quantity': int(instance.delivered_quantity or 0),
            'withdrawn_for_model': bool(instance.withdrawn_for_model),
            'deficit_quantity': instance.deficit_quantity,
        }


class AccessoryTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccessoryTransaction
        fields = '__all__'

    def to_representation(self, instance):
        return {
            'id': get_ext_id(instance),
            'accessory_id': get_ext_id(instance.accessory),
            'accessory_code': instance.accessory_code or instance.accessory.code,
            'accessory_name': instance.accessory_name or instance.accessory.name,
            'operation': instance.operation,
            'amount': float(instance.amount or 0),
            'model_code_ref': instance.model_code_ref or '',
            'notes': instance.notes or '',
            'timestamp': instance.timestamp or (instance.created_at.strftime('%Y-%m-%d %H:%M') if instance.created_at else ''),
        }


class ModelRequirementSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModelRequirement
        fields = '__all__'

    def to_representation(self, instance):
        return {
            'id': get_ext_id(instance),
            'model_id': get_ext_id(instance.model),
            'color_id': get_ext_id(instance.color),
            'part_name': instance.part_name,
            'planned_quantity': float(instance.planned_quantity or 0),
        }


class ModelAccessorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ModelAccessory
        fields = '__all__'

    def to_representation(self, instance):
        return {
            'id': get_ext_id(instance),
            'model_id': get_ext_id(instance.model),
            'target_type': instance.target_type or 'shirt',
            'piece_consumption': float(instance.piece_consumption or 1),
            'planned_quantity': float(instance.planned_quantity or 0),
            'accessory_id': instance.accessory_id_ref or None,
            'accessory_code': instance.accessory_code or '',
            'accessory_name': instance.accessory_name,
            'unit': instance.unit or 'قطعة',
            'image': instance.image or '',
        }


class ModelTimelineSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModelTimeline
        fields = '__all__'

    def to_representation(self, instance):
        ts = instance.timestamp_str or (instance.timestamp.strftime('%Y-%m-%d %H:%M') if instance.timestamp else '')
        return {
            'id': get_ext_id(instance),
            'stage': instance.stage,
            'title': instance.title or instance.stage,
            'description': instance.notes or '',
            'notes': instance.notes or '',
            'user_name': instance.user or 'النظام',
            'user': instance.user or 'النظام',
            'timestamp': ts,
            'details': instance.details if isinstance(instance.details, dict) else {},
        }


class CuttingSpreadLayerSerializer(serializers.ModelSerializer):
    class Meta:
        model = CuttingSpreadLayer
        fields = '__all__'

    def to_representation(self, instance):
        return {
            'id': get_ext_id(instance),
            'spread_id': get_ext_id(instance.spread),
            'color_name': instance.color_name,
            'colorName': instance.color_name,
            'layers_count': int(instance.layers_count or 0),
            'layersCount': int(instance.layers_count or 0),
            'layer_weight': float(instance.layer_weight or 0),
            'layerWeight': float(instance.layer_weight or 0),
            'pieces_count': int(instance.pieces_count or 0),
            'piecesCount': int(instance.pieces_count or 0),
            'shade_degree': instance.shade_degree or '',
            'shadeDegree': instance.shade_degree or '',
            'notes': instance.notes or '',
        }


class CuttingRecordSerializer(serializers.ModelSerializer):
    color_layers = CuttingSpreadLayerSerializer(many=True, read_only=True)

    class Meta:
        model = CuttingRecord
        fields = '__all__'

    def to_representation(self, instance):
        ts = instance.created_at_str or (instance.created_at.strftime('%Y-%m-%d %H:%M') if instance.created_at else '')
        layers_qs = list(instance.color_layers.all())
        layers_data = CuttingSpreadLayerSerializer(layers_qs, many=True).data

        # Build human-readable summary of colors & layers in this spread
        if layers_data:
            colors_summary = ' + '.join(
                f"{item['color_name']} ({item['layers_count']} راق)"
                for item in layers_data
            )
            total_layers = sum(int(item['layers_count'] or 0) for item in layers_data)
        else:
            colors_summary = instance.fabric_color or ''
            total_layers = int(instance.layers_count or 0)

        return {
            'id': get_ext_id(instance),
            'model_id': get_ext_id(instance.model),
            'spread_number': int(instance.spread_number or 1),
            'spreadNumber': int(instance.spread_number or 1),
            'part_type': instance.part_type or 'shirt',
            'partType': instance.part_type or 'shirt',
            'spreader_name': instance.spreader_name or '',
            'spreaderName': instance.spreader_name or '',
            'cutter_name': instance.cutter_name or '',
            'spreader_name': instance.spreader_name or '',
            'cutterName': instance.cutter_name or '',
            'color_name': colors_summary or instance.fabric_color or '',
            'colorName': colors_summary or instance.fabric_color or '',
            'color_layers': layers_data,
            'colorLayers': layers_data,
            'layers_count': total_layers,
            'layersCount': total_layers,
            'pieces_per_layer': int(instance.pieces_per_layer or 0),
            'piecesPerLayer': int(instance.pieces_per_layer or 0),
            'layer_weight': float(instance.layer_weight or 0),
            'layerWeight': float(instance.layer_weight or 0),
            'pieces_count': int(instance.pieces_count or (total_layers * int(instance.pieces_per_layer or 0))),
            'piecesCount': int(instance.pieces_count or (total_layers * int(instance.pieces_per_layer or 0))),
            'shade_degree': instance.shade_degree or '',
            'shadeDegree': instance.shade_degree or '',
            'notes': instance.notes or '',
            'created_at': ts,
        }


class QCRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = QCRecord
        fields = '__all__'

    def to_representation(self, instance):
        ts = instance.created_at_str or (instance.created_at.strftime('%Y-%m-%d %H:%M') if instance.created_at else '')
        return {
            'id': get_ext_id(instance),
            'model_id': get_ext_id(instance.model),
            'stage': instance.stage,
            'part_type': instance.part_type or 'shirt',
            'partType': instance.part_type or 'shirt',
            'color_name': instance.color_name or '',
            'size': instance.size or '',
            'pieces_cut': int(instance.pieces_cut or 0),
            'good_qty': int(instance.counted_pieces or 0),
            'defect_qty': int(instance.defect_pieces or 0),
            'defect_notes': instance.notes or '',
            'counted_pieces': int(instance.counted_pieces or 0),
            'defect_pieces': int(instance.defect_pieces or 0),
            'notes': instance.notes or '',
            'inspector_name': instance.checked_by or 'مراقب الجودة',
            'created_at': ts,
        }


class PrintDispatchSerializer(serializers.ModelSerializer):
    is_overdue = serializers.ReadOnlyField()

    class Meta:
        model = PrintDispatch
        fields = '__all__'

    def to_representation(self, instance):
        cost = float(instance.cost_per_piece or 0)
        pcs = int(instance.pieces_count or 0)
        disp_at = instance.dispatched_at_str or (instance.dispatch_date.isoformat() if instance.dispatch_date else '')
        rec_at = instance.received_at_str or (instance.received_date.isoformat() if instance.received_date else None)
        return {
            'id': get_ext_id(instance),
            'model_id': get_ext_id(instance.model),
            'shop_name': instance.print_house,
            'dispatched_at': disp_at,
            'expected_delivery_date': instance.expected_delivery_date.isoformat() if instance.expected_delivery_date else '',
            'pieces_count': pcs,
            'print_type': instance.print_type or 'سلك سكرين مائي',
            'cost_per_piece': cost,
            'total_cost': round(cost * pcs, 2),
            'notes': instance.notes or '',
            'status': instance.status,
            'received_at': rec_at,
            'is_overdue': instance.is_overdue,
        }


class SewingDispatchSerializer(serializers.ModelSerializer):
    is_overdue = serializers.ReadOnlyField()

    class Meta:
        model = SewingDispatch
        fields = '__all__'

    def to_representation(self, instance):
        disp_at = instance.dispatched_at_str or (instance.dispatched_date.isoformat() if instance.dispatched_date else '')
        rec_at = instance.received_at_str or (instance.received_date.isoformat() if instance.received_date else None)
        return {
            'id': get_ext_id(instance),
            'model_id': get_ext_id(instance.model),
            'workshop_name': instance.workshop_name,
            'pieces_count': int(instance.pieces_count or 0),
            'dispatched_at': disp_at,
            'expected_delivery_date': instance.expected_delivery_date.isoformat() if instance.expected_delivery_date else '',
            'status': instance.status,
            'piece_type': instance.piece_type or 'shirt',
            'piece_label': instance.piece_label or ('تيشرت' if instance.piece_type == 'shirt' else 'بنطلون'),
            'received_at': rec_at,
            'notes': instance.notes or '',
            'is_overdue': instance.is_overdue,
        }


class AppNotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = AppNotification
        fields = '__all__'


class ModelItemSerializer(serializers.ModelSerializer):
    accessories = ModelAccessorySerializer(many=True, read_only=True)
    timeline = ModelTimelineSerializer(many=True, read_only=True)

    class Meta:
        model = ModelItem
        fields = '__all__'

    def to_representation(self, instance):
        from .services import model_part_summary
        parts_info = model_part_summary(instance)
        return {
            'id': get_ext_id(instance),
            'model_code': instance.model_code,
            'image': instance.image or 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500&auto=format&fit=crop&q=60',
            'model_type': instance.model_type or 'أولادي',
            'status': instance.status,
            'size_category_id': instance.size_category_id or '',
            'main_marker_url': instance.main_marker_url or '',
            'print_marker_url': instance.print_marker_url or '',
            'target_cut_quantity': int(instance.target_cut_quantity or 0),
            'actual_cut_count': int(instance.total_cut_pieces or 0),
            'total_cut_pieces': int(instance.total_cut_pieces or 0),
            'garment_parts': instance.garment_parts or [],
            'garment_composition': instance.garment_composition or 'two_pieces',
            'parts': parts_info['parts'],
            'cut_summary': parts_info['cut_summary'],
            'qc_summary': parts_info['qc_summary'],
            'sewing_available': parts_info['sewing_available'],
            'completed_sets': parts_info['completed_sets'],
            'cut_shirt_pieces': int(instance.cut_shirt_pieces or 0),
            'cut_pants_pieces': int(instance.cut_pants_pieces or 0),
            'cut_jacket_pieces': int(instance.cut_jacket_pieces or 0),
            'qc_shirt_pieces': int(instance.qc_shirt_pieces or 0),
            'qc_pants_pieces': int(instance.qc_pants_pieces or 0),
            'qc_jacket_pieces': int(instance.qc_jacket_pieces or 0),
            'cutter_name': instance.cutter_name or '',
            'count_before_print': instance.count_before_print,
            'count_after_print': instance.count_after_print,
            'count_after_sewing': instance.count_after_sewing,
            'print_house_name': instance.print_house or '',
            'print_house': instance.print_house or '',
            'print_cost': float(instance.print_cost_per_piece or 0),
            'print_expected_date': instance.print_expected_date.isoformat() if instance.print_expected_date else None,
            'sewing_workshop': instance.sewing_workshop or '',
            'sewing_expected_date': instance.sewing_expected_date.isoformat() if instance.sewing_expected_date else None,
            'sewing_pieces_count': int(instance.sewing_pieces_count or 0),
            'sewing_shirt_workshop': instance.sewing_shirt_workshop or '',
            'sewing_shirt_expected_date': instance.sewing_shirt_expected_date.isoformat() if instance.sewing_shirt_expected_date else None,
            'sewing_shirt_status': instance.sewing_shirt_status or 'ready',
            'sewing_shirt_pieces': int(instance.sewing_shirt_pieces or 0),
            'sewing_pants_workshop': instance.sewing_pants_workshop or '',
            'sewing_pants_expected_date': instance.sewing_pants_expected_date.isoformat() if instance.sewing_pants_expected_date else None,
            'sewing_pants_status': instance.sewing_pants_status or 'ready',
            'sewing_pants_pieces': int(instance.sewing_pants_pieces or 0),
            'design_notes': instance.design_notes or '',
            'notes_shirt': instance.notes_shirt or '',
            'notes_pants': instance.notes_pants or '',
            'colored_at': instance.colored_at or None,
            'cut_at': instance.cut_at or None,
            'created_at': instance.created_at.isoformat() if instance.created_at else '',
            'is_deleted': bool(instance.is_deleted),
            'timeline': ModelTimelineSerializer(instance.timeline.all(), many=True).data,
            'accessories': ModelAccessorySerializer(instance.accessories.all(), many=True).data,
        }


class InternalMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = InternalMessage
        fields = '__all__'

    def to_representation(self, instance):
        ts = instance.created_at_str or (instance.created_at.strftime('%H:%M') if instance.created_at else '')
        return {
            'id': get_ext_id(instance),
            'sender_id': get_ext_id(instance.sender),
            'sender_name': instance.sender.real_name,
            'receiver_id': get_ext_id(instance.receiver),
            'receiver_name': instance.receiver.real_name,
            'content': instance.content,
            'created_at': ts,
            'is_read': bool(instance.is_read),
        }


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = '__all__'

    def to_representation(self, instance):
        ts = instance.timestamp or (instance.created_at.strftime('%Y-%m-%d %H:%M') if instance.created_at else '')
        return {
            'id': get_ext_id(instance),
            'userId': instance.user_id_ref or '',
            'userName': instance.user_name,
            'action': instance.action,
            'details': instance.details,
            'ip_address': instance.ip_address or '127.0.0.1',
            'timestamp': ts,
        }