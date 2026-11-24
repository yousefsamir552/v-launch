"""اختبارات تقوية الصلاحيات: إخفاء الحقول المالية، تقييد /state/، منع IDOR
في المراسلات، فرض قسم كل إجراء على الموديلات، تدوير رمز الجلسة عند الخروج،
وحماية مرتب الموظفين.
"""
from datetime import date

from django.http import Http404
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import JSONParser
from rest_framework.request import Request as DRFRequest
from rest_framework.test import APIClient, APIRequestFactory

from .models import (
    Role, UserProfile, Fabric, FabricColor, Accessory,
    FabricTransaction, AccessoryTransaction, Workshop, Supplier,
    ModelItem, ModelTimeline, ModelRequirement, ModelAccessory,
    PrintDispatch, InternalMessage,
    SewingDispatch, FinishingRecord, AssemblyStageRecord,
    PackagingMaterialRule, PackagingMaterialSizeRule,
    HRJobTitle, HREmployee, AuditLog,
    RANK_LEVEL_ONE, RANK_LEVEL_THREE,
)
from .serializers import (
    FabricColorSerializer, AccessorySerializer, PrintDispatchSerializer,
    SewingDispatchSerializer, FinishingRecordSerializer, AssemblyStageRecordSerializer,
    FabricTransactionSerializer, AccessoryTransactionSerializer,
    PackagingMaterialSizeRuleSerializer, PackagingMaterialRuleSerializer,
    ModelItemSerializer, HREmployeeSerializer,
)
from .services import dispatch_model_to_sewing_service
from .services_pipeline import sync_reserved_quantities
from .hr_reports import HRReportsViewSet
from .views import (
    AuthViewSet, StateViewSet, InternalMessageViewSet, ModelItemViewSet,
    FabricColorViewSet, AccessoryViewSet, resolve_supplier_link,
    HREmployeeViewSet,
)


def make_role(name, **perms):
    return Role.objects.create(name=name, permissions_json=perms, rank_level=RANK_LEVEL_THREE)


def make_user(username, role=None, rank=RANK_LEVEL_THREE):
    user = UserProfile(username=username, real_name=username, role=role, rank_level=rank)
    user.auth_token = f'token-{username}'
    user.set_password('x')
    user.save()
    return user


class PermissionTestBase(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()

        self.sewing_role = make_role('sewing-only', sewing_view=True, sewing_edit=True)
        self.design_role = make_role('design-only', design_view=True, design_edit=True)
        self.cutting_role = make_role('cutting-only', cutting_view=True, cutting_edit=True)
        self.fabric_role = make_role(
            'fabric-with-prices', fabric_warehouse_view=True, view_fabric_prices=True,
        )
        self.accounts_role = make_role('hr-employees', hr_employees=True, hr_jobs=True)

        self.design_user = make_user('designer', self.design_role)
        self.cutting_user = make_user('cutter', self.cutting_role)
        self.sewing_user = make_user('sewer', self.sewing_role)
        self.fabric_user = make_user('fabrickeeper', self.fabric_role)
        self.accounts_user = make_user('accountant', self.accounts_role, rank=RANK_LEVEL_ONE)
        self.other_user = make_user('outsider', self.cutting_role)

        self.model = ModelItem.objects.create(model_code='M-100', target_cut_quantity=10)
        self.fabric = Fabric.objects.create(name='قطن')
        self.color = FabricColor.objects.create(
            fabric=self.fabric, color_code='BLK', price_per_unit=25.5, quantity=100,
        )
        self.accessory = Accessory.objects.create(
            name='زرار', price_per_unit=1.25, current_stock=500,
        )
        self.dispatch = PrintDispatch.objects.create(
            model=self.model, print_house='مطبعة النور', pieces_count=10, cost_per_piece=3,
        )
        self.job = HRJobTitle.objects.create(title='خياط', department='sewing')
        self.employee = HREmployee.objects.create(
            name='موظف', job=self.job, monthly_salary=5000, rank_level=RANK_LEVEL_THREE,
        )

    def _request(self, viewer, method='get', data=None):
        wsgi_request = getattr(self.factory, method)('/', data=data or {}, format='json')
        request = DRFRequest(wsgi_request, parsers=[JSONParser()])
        if viewer is not None:
            request.user_profile = viewer
        return request


class FinancialFieldGatingTests(PermissionTestBase):
    def test_fabric_price_hidden_without_permission(self):
        data = FabricColorSerializer(
            self.color, context={'request': self._request(self.design_user)}
        ).data
        self.assertIsNone(data['price_per_unit'])
        self.assertEqual(data['quantity'], 100.0)

    def test_fabric_price_visible_with_permission(self):
        data = FabricColorSerializer(
            self.color, context={'request': self._request(self.fabric_user)}
        ).data
        self.assertEqual(data['price_per_unit'], 25.5)

    def test_accessory_price_hidden_without_permission(self):
        data = AccessorySerializer(
            self.accessory, context={'request': self._request(self.design_user)}
        ).data
        self.assertIsNone(data['price_per_unit'])

    def test_print_costs_hidden_without_permission(self):
        data = PrintDispatchSerializer(
            self.dispatch, context={'request': self._request(self.sewing_user)}
        ).data
        self.assertIsNone(data['cost_per_piece'])
        self.assertIsNone(data['total_cost'])
        self.assertEqual(data['pieces_count'], 10)

    def test_serializer_without_request_keeps_full_representation(self):
        # أدوات إدارية/سييد بدون طلب HTTP تحصل على التمثيل الكامل.
        self.assertEqual(FabricColorSerializer(self.color).data['price_per_unit'], 25.5)

    def test_model_timeline_details_are_scrubbed_for_unprivileged_viewer(self):
        ModelTimeline.objects.create(
            model=self.model,
            stage='printing',
            title='إرسال للمطبعة',
            details={'cost_per_piece': 3, 'total_cost': 30, 'pieces_count': 10},
        )
        payload = ModelItemSerializer(
            self.model, context={'request': self._request(self.design_user)}
        ).data
        printing_entries = [row for row in payload['timeline'] if row['stage'] == 'printing']
        self.assertEqual(len(printing_entries), 1)
        details = printing_entries[0]['details']
        self.assertNotIn('cost_per_piece', details)
        self.assertNotIn('total_cost', details)
        self.assertEqual(details['pieces_count'], 10)

    def test_fabric_transaction_snapshot_hidden_without_permission(self):
        txn = FabricTransaction.objects.create(
            color=self.color, fabric=self.fabric, operation='deduct', amount=5,
            unit_price_snapshot=25.5,
        )
        hidden = FabricTransactionSerializer(
            txn, context={'request': self._request(self.design_user)}
        ).data
        self.assertIsNone(hidden['unit_price_snapshot'])
        visible = FabricTransactionSerializer(
            txn, context={'request': self._request(self.fabric_user)}
        ).data
        self.assertEqual(visible['unit_price_snapshot'], 25.5)

    def test_accessory_transaction_snapshot_hidden_without_permission(self):
        role = make_role('accessories-prices', accessories_view=True, view_accessory_prices=True)
        viewer = make_user('accessorykeeper', role)
        txn = AccessoryTransaction.objects.create(
            accessory=self.accessory,
            accessory_code=self.accessory.code,
            accessory_name=self.accessory.name,
            operation='deduct',
            amount=2,
            unit_price_snapshot=1.25,
        )
        hidden = AccessoryTransactionSerializer(
            txn, context={'request': self._request(self.design_user)}
        ).data
        self.assertIsNone(hidden['unit_price_snapshot'])
        visible = AccessoryTransactionSerializer(
            txn, context={'request': self._request(viewer)}
        ).data
        self.assertEqual(visible['unit_price_snapshot'], 1.25)

    def test_workshop_link_exposed_on_dispatch_without_changing_text_name(self):
        workshop = Workshop.objects.create(name='مطبعة النور')
        self.dispatch.workshop = workshop
        self.dispatch.save(update_fields=['workshop'])
        data = PrintDispatchSerializer(
            self.dispatch, context={'request': self._request(self.sewing_user)}
        ).data
        self.assertEqual(data['shop_name'], 'مطبعة النور')
        self.assertEqual(data['workshop_id'], workshop.client_id or str(workshop.id))


class WorkshopLinkServiceTests(PermissionTestBase):
    """الربط التلقائي للورشة المسجلة من الاسم النصي بدون كسر السجلات القديمة."""

    def test_sewing_dispatch_links_registered_workshop_by_name(self):
        workshop = Workshop.objects.create(name='ورشة الأمل')
        dispatch = dispatch_model_to_sewing_service(
            self.model.id, 'ورشة الأمل', 5, timezone.now().date().isoformat(),
        )
        self.assertEqual(dispatch.workshop_id, workshop.id)
        self.assertEqual(dispatch.workshop_name, 'ورشة الأمل')

    def test_sewing_dispatch_keeps_null_workshop_when_name_is_unknown(self):
        dispatch = dispatch_model_to_sewing_service(
            self.model.id, 'ورشة غير مسجلة', 5, timezone.now().date().isoformat(),
        )
        self.assertIsNone(dispatch.workshop_id)
        self.assertEqual(dispatch.workshop_name, 'ورشة غير مسجلة')


class SupplierLinkAutoFallbackTests(PermissionTestBase):
    """التقاط المورد تلقائياً من بطاقة الخامة/الإكسسوار في حركات المخزن وصرف القص."""

    def setUp(self):
        super().setUp()
        self.supplier = Supplier.objects.create(name='مورد الأقمشة الذهبي')
        self.fabric.supplier_id_ref = self.supplier.client_id
        self.fabric.save(update_fields=['supplier_id_ref'])
        self.accessory.supplier_id_ref = self.supplier.client_id
        self.accessory.save(update_fields=['supplier_id_ref'])

    def _post_request(self, data):
        return self._request(self.fabric_user, method='post', data=data)

    def _call_action(self, view, action_name, request, **kwargs):
        view.format_kwarg = None
        view.request = request
        view.kwargs = kwargs
        return getattr(view, action_name)(request, **kwargs)

    def test_resolve_supplier_link_prefers_explicit_id(self):
        other = Supplier.objects.create(name='مورد بديل')
        found = resolve_supplier_link(
            {'supplier_id': other.client_id},
            self.fabric.supplier_id_ref,
            self.fabric.supplier,
        )
        self.assertEqual(found.id, other.id)

    def test_resolve_supplier_link_falls_back_to_registered_name(self):
        legacy_fabric = Fabric.objects.create(name='كتان', supplier='مورد الأقمشة الذهبي')
        found = resolve_supplier_link(
            None, legacy_fabric.supplier_id_ref, legacy_fabric.supplier,
        )
        self.assertEqual(found.id, self.supplier.id)

    def test_fabric_record_transaction_falls_back_to_fabric_supplier(self):
        request = self._post_request({
            'colorId': self.color.client_id,
            'operation': 'add',
            'amount': 5,
        })
        response = self._call_action(FabricColorViewSet(), 'record_transaction', request)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        tr = FabricTransaction.objects.latest('id')
        self.assertEqual(tr.supplier_id, self.supplier.id)
        self.assertEqual(float(tr.unit_price_snapshot), 25.5)

    def test_accessory_record_transaction_falls_back_to_accessory_supplier(self):
        request = self._post_request({
            'accessoryId': self.accessory.client_id,
            'operation': 'add',
            'amount': 3,
        })
        response = self._call_action(AccessoryViewSet(), 'record_transaction', request)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        tr = AccessoryTransaction.objects.latest('id')
        self.assertEqual(tr.supplier_id, self.supplier.id)
        self.assertEqual(float(tr.unit_price_snapshot), 1.25)

    def test_issue_fabric_to_cutting_links_supplier_and_price_snapshot(self):
        ModelRequirement.objects.create(
            model=self.model, color=self.color, part_name='تيشرت', planned_quantity=2,
        )
        ModelAccessory.objects.create(
            model=self.model,
            accessory_id_ref=self.accessory.client_id,
            accessory_name=self.accessory.name,
            target_type='shirt',
            planned_quantity=3,
        )
        self.model.refresh_from_db()

        request = self._post_request({'user_name': 'مسؤول التصميم'})
        response = self._call_action(
            ModelItemViewSet(), 'issue_fabric_to_cutting', request,
            pk=str(self.model.pk),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        fabric_tr = FabricTransaction.objects.filter(
            model_code_ref=self.model.model_code,
        ).latest('id')
        self.assertEqual(fabric_tr.supplier_id, self.supplier.id)
        self.assertEqual(float(fabric_tr.unit_price_snapshot), 25.5)

        # دورة الإكسسوار الجديدة: صرف القماش للقص لا يخصم الإكسسوار من الرصيد الفعلي.
        self.assertFalse(
            AccessoryTransaction.objects.filter(
                model_code_ref=self.model.model_code,
            ).exists()
        )
        self.accessory.refresh_from_db()
        self.assertEqual(self.accessory.current_stock, 500)

        self.model.refresh_from_db()
        self.assertEqual(self.model.status, 'في القص')

    def test_issue_accessories_deducts_stock_and_links_supplier_and_price(self):
        model_accessory = ModelAccessory.objects.create(
            model=self.model,
            accessory_id_ref=self.accessory.client_id,
            accessory_name=self.accessory.name,
            target_type='shirt',
            planned_quantity=3,
        )

        request = self._post_request({
            'user_name': 'أمين المخزن',
            'issued_to': 'مسؤول المكن',
            'quantities': {model_accessory.client_id: 3},
        })
        response = self._call_action(
            ModelItemViewSet(), 'issue_accessories', request,
            pk=str(self.model.pk),
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        acc_tr = AccessoryTransaction.objects.filter(
            model_code_ref=self.model.model_code,
        ).latest('id')
        self.assertEqual(acc_tr.supplier_id, self.supplier.id)
        self.assertEqual(float(acc_tr.unit_price_snapshot), 1.25)
        self.assertEqual(float(acc_tr.amount), 3)

        self.accessory.refresh_from_db()
        self.assertEqual(self.accessory.current_stock, 497)

        model_accessory.refresh_from_db()
        self.assertTrue(model_accessory.is_issued)
        self.assertEqual(model_accessory.issued_quantity, 3)
        self.assertEqual(model_accessory.issued_to, 'مسؤول المكن')
        self.assertEqual(model_accessory.issued_by, 'أمين المخزن')

    def test_issue_accessories_rejects_insufficient_stock_without_changes(self):
        model_accessory = ModelAccessory.objects.create(
            model=self.model,
            accessory_id_ref=self.accessory.client_id,
            accessory_name=self.accessory.name,
            target_type='shirt',
            planned_quantity=600,
        )

        request = self._post_request({'user_name': 'أمين المخزن'})
        response = self._call_action(
            ModelItemViewSet(), 'issue_accessories', request,
            pk=str(self.model.pk),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        self.accessory.refresh_from_db()
        self.assertEqual(self.accessory.current_stock, 500)
        model_accessory.refresh_from_db()
        self.assertFalse(model_accessory.is_issued)
        self.assertFalse(
            AccessoryTransaction.objects.filter(
                model_code_ref=self.model.model_code,
            ).exists()
        )


class DepartmentPriceIsolationTests(PermissionTestBase):
    """كل قسم له صلاحية سعر مستقلة: العرض يُخفى والكتابة تُرفض بدون صلاحية القسم."""

    def setUp(self):
        super().setUp()
        self.sewing_dispatch = SewingDispatch.objects.create(
            model=self.model, workshop_name='ورشة النور', pieces_count=10,
            received_pieces=10,
            expected_delivery_date=timezone.now().date(), cost_per_piece=4, total_cost=40,
        )
        self.finishing = FinishingRecord.objects.create(
            model=self.model, part_type='shirt', cost_per_piece=2, total_cost=20,
        )
        self.assembly = AssemblyStageRecord.objects.create(
            model=self.model, stage='packaging', part_type='',
            cost_per_piece=1.5, total_cost=15,
        )
        self.material_rule = PackagingMaterialRule.objects.create(
            material_key='bags', name='أكياس', unit='قطعة',
        )
        self.size_rule = PackagingMaterialSizeRule.objects.create(
            rule=self.material_rule, size_group_id='g1', size_group_name='كبير',
            consumption_per_piece=1, price_per_unit=0.75, current_stock=100,
        )

    def test_sewing_price_hidden_without_permission(self):
        data = SewingDispatchSerializer(
            self.sewing_dispatch, context={'request': self._request(self.sewing_user)}
        ).data
        self.assertIsNone(data['cost_per_piece'])
        self.assertIsNone(data['total_cost'])
        self.assertEqual(data['pieces_count'], 10)

    def test_sewing_price_visible_with_sewing_permission(self):
        role = make_role('sewing-prices', sewing_view=True, view_sewing_prices=True)
        user = make_user('sewing-prices-user', role)
        data = SewingDispatchSerializer(
            self.sewing_dispatch, context={'request': self._request(user)}
        ).data
        self.assertEqual(data['cost_per_piece'], 4.0)
        self.assertEqual(data['total_cost'], 40.0)

    def test_finishing_and_assembly_prices_hidden_without_permission(self):
        ctx = {'request': self._request(self.sewing_user)}
        finishing = FinishingRecordSerializer(self.finishing, context=ctx).data
        assembly = AssemblyStageRecordSerializer(self.assembly, context=ctx).data
        self.assertIsNone(finishing['cost_per_piece'])
        self.assertIsNone(finishing['total_cost'])
        self.assertIsNone(assembly['cost_per_piece'])
        self.assertIsNone(assembly['total_cost'])

    def test_assembly_prices_visible_with_assembly_permission(self):
        role = make_role('assembly-prices', assembly_packaging_view=True, view_assembly_prices=True)
        user = make_user('assembly-prices-user', role)
        ctx = {'request': self._request(user)}
        finishing = FinishingRecordSerializer(self.finishing, context=ctx).data
        assembly = AssemblyStageRecordSerializer(self.assembly, context=ctx).data
        self.assertEqual(finishing['cost_per_piece'], 2.0)
        self.assertEqual(assembly['total_cost'], 15.0)

    def test_packaging_material_price_hidden_without_permission(self):
        ctx = {'request': self._request(self.sewing_user)}
        size_rule = PackagingMaterialSizeRuleSerializer(self.size_rule, context=ctx).data
        rule = PackagingMaterialRuleSerializer(self.material_rule, context=ctx).data
        self.assertIsNone(size_rule['price_per_unit'])
        self.assertIsNone(size_rule['total_stock_value'])
        self.assertIsNone(rule['size_rules'][0]['price_per_unit'])

    def test_packaging_material_price_visible_with_assembly_permission(self):
        role = make_role('materials-prices', assembly_packaging_view=True, view_assembly_prices=True)
        user = make_user('materials-prices-user', role)
        size_rule = PackagingMaterialSizeRuleSerializer(
            self.size_rule, context={'request': self._request(user)}
        ).data
        self.assertEqual(size_rule['price_per_unit'], 0.75)
        self.assertEqual(size_rule['total_stock_value'], 75.0)

    def test_sewing_cost_write_requires_sewing_edit_permission(self):
        view = ModelItemViewSet()
        view.format_kwarg = None
        request = self._request(
            self.sewing_user, 'post',
            {
                'workshop_name': 'ورشة جديدة', 'pieces_count': 5,
                'expected_delivery_date': timezone.now().date().isoformat(),
                'piece_type': 'shirt', 'cost_per_piece': 7,
            },
        )
        view.request = request
        view.kwargs = {'pk': str(self.model.pk)}
        with self.assertRaises(PermissionDenied):
            view.dispatch_to_sewing(request, pk=str(self.model.pk))
        self.assertFalse(SewingDispatch.objects.filter(workshop_name='ورشة جديدة').exists())

    def test_finishing_cost_write_requires_assembly_edit_permission(self):
        view = ModelItemViewSet()
        view.format_kwarg = None
        request = self._request(
            self.sewing_user, 'post',
            {'parts': ['shirt'], 'cost_per_piece': 3},
        )
        view.request = request
        view.kwargs = {'pk': str(self.model.pk)}
        with self.assertRaises(PermissionDenied):
            view.start_finishing(request, pk=str(self.model.pk))

    def test_sewing_cost_write_allowed_with_sewing_edit_permission(self):
        role = make_role(
            'sewing-editor', sewing_view=True, sewing_edit=True, edit_sewing_prices=True,
        )
        user = make_user('sewing-editor-user', role)
        view = ModelItemViewSet()
        view.format_kwarg = None
        request = self._request(
            user, 'post',
            {
                'workshop_name': 'ورشة جديدة', 'pieces_count': 5,
                'expected_delivery_date': timezone.now().date().isoformat(),
                'piece_type': 'shirt', 'cost_per_piece': 7,
            },
        )
        view.request = request
        view.kwargs = {'pk': str(self.model.pk)}
        response = view.dispatch_to_sewing(request, pk=str(self.model.pk))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        saved = SewingDispatch.objects.get(workshop_name='ورشة جديدة')
        self.assertEqual(float(saved.cost_per_piece), 7.0)
        # قبل الاستلام الفعلي تكون التكلفة الإجمالية 0 (تُحسب على القطع المستلمة فقط).
        self.assertEqual(float(saved.total_cost), 0.0)
        # التدقيق المالي: يُسجَّل تغيير سعر المكن صريحاً في سجل المراقبة.
        audit = AuditLog.objects.filter(details__contains='سعر تشغيل القطعة').first()
        self.assertIsNotNone(audit)
        self.assertEqual(float(audit.changes[0]['new']), 7.0)

    def test_timeline_scrubs_costs_per_department(self):
        ModelTimeline.objects.create(
            model=self.model, stage='قسم المكن والخياطة', title='إرسال للخياطة',
            details={'phase_type': 'sewing_dispatch', 'cost_per_piece': 4, 'pieces_count': 10},
        )
        ModelTimeline.objects.create(
            model=self.model, stage='قسم التشطيب', title='دخول التشطيب',
            details={'phase_type': 'finishing_start', 'cost_per_piece': 2, 'parts': ['shirt']},
        )
        payload = ModelItemSerializer(
            self.model, context={'request': self._request(self.sewing_user)}
        ).data
        for row in payload['timeline']:
            self.assertNotIn('cost_per_piece', row['details'])
            self.assertNotIn('total_cost', row['details'])


class StateFilteringTests(PermissionTestBase):
    def _state(self, viewer):
        return StateViewSet().list(self._request(viewer)).data

    def test_state_empties_sections_the_viewer_cannot_open(self):
        payload = self._state(self.sewing_user)
        self.assertEqual(payload['fabricColors'], [])
        self.assertEqual(payload['cuttingRecords'], [])
        self.assertTrue(len(payload['models']) >= 1)

    def test_state_keeps_fabric_section_for_fabric_role(self):
        payload = self._state(self.fabric_user)
        self.assertEqual(len(payload['fabricColors']), 1)
        self.assertIsNotNone(payload['fabricColors'][0]['price_per_unit'])

    def test_state_only_returns_own_internal_messages(self):
        InternalMessage.objects.create(
            sender=self.cutting_user, receiver=self.other_user, content='خاص',
        )


class InternalMessageScopingTests(PermissionTestBase):
    def setUp(self):
        super().setUp()
        self.message = InternalMessage.objects.create(
            sender=self.cutting_user, receiver=self.design_user, content='مرحبا',
        )

    def test_list_is_scoped_to_the_viewer(self):
        view = InternalMessageViewSet()
        view.request = self._request(self.other_user)
        view.kwargs = {}
        self.assertEqual(view.get_queryset().count(), 0)

        view.request = self._request(self.design_user)
        self.assertEqual(view.get_queryset().count(), 1)

    def test_third_party_cannot_mark_message_read(self):
        view = InternalMessageViewSet()
        view.request = self._request(self.other_user, 'post')
        view.kwargs = {'pk': str(self.message.pk)}
        view.action = 'mark_read'
        with self.assertRaises(Http404):
            view.mark_read(view.request, pk=str(self.message.pk))
        self.message.refresh_from_db()
        self.assertFalse(self.message.is_read)

    def test_receiver_can_mark_message_read(self):
        view = InternalMessageViewSet()
        view.request = self._request(self.design_user, 'post')
        view.kwargs = {'pk': str(self.message.pk)}
        view.action = 'mark_read'
        response = view.mark_read(view.request, pk=str(self.message.pk))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.message.refresh_from_db()
        self.assertTrue(self.message.is_read)

    def test_sending_without_permission_is_forbidden(self):
        view = InternalMessageViewSet()
        request = self._request(
            self.design_user, 'post', {'receiver': self.other_user.pk, 'content': 'x'},
        )
        response = view.create(request)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(InternalMessage.objects.count(), 1)



class ModelItemActionSectionTests(PermissionTestBase):
    def _view_for(self, viewer, action, method='get', data=None):
        view = ModelItemViewSet()
        request = self._request(viewer, method, data)
        view.request = request
        view.action = action
        view.kwargs = {}
        view.format_kwarg = None
        return view, request

    def test_operational_section_can_read_models(self):
        view, request = self._view_for(self.cutting_user, 'list')
        view.initial(request)  # لا يرفع استثناء
        self.assertGreaterEqual(view.get_queryset().count(), 1)

    def test_action_of_another_section_is_denied(self):
        view, request = self._view_for(
            self.design_user, 'record_qc_count', 'post', {'counted': 5},
        )
        with self.assertRaises(PermissionDenied):
            view.initial(request)

    def test_cutting_section_cannot_create_models(self):
        view, request = self._view_for(
            self.cutting_user, 'create', 'post', {'model_code': 'X-1'},
        )
        with self.assertRaises(PermissionDenied):
            view.initial(request)

    def test_design_section_can_create_models(self):
        view, request = self._view_for(
            self.design_user, 'create', 'post', {'model_code': 'X-2'},
        )
        view.initial(request)  # لا يرفع استثناء


class LogoutTokenRotationTests(PermissionTestBase):
    def test_logout_invalidates_the_session_token(self):
        auth = f'Bearer {self.design_user.auth_token}'

        logout_request = self.factory.post('/api/auth/logout/', HTTP_AUTHORIZATION=auth)
        response = AuthViewSet().logout(logout_request)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.design_user.refresh_from_db()
        self.assertIsNone(self.design_user.auth_token)

        me_request = self.factory.get('/api/auth/me/', HTTP_AUTHORIZATION=auth)
        me_response = AuthViewSet().me(me_request)
        self.assertEqual(me_response.status_code, status.HTTP_401_UNAUTHORIZED)


class HRSalaryGatingTests(PermissionTestBase):
    def test_salary_hidden_from_employee_tab_only_viewer(self):
        data = HREmployeeSerializer(
            self.employee, context={'request': self._request(self.accounts_user)}
        ).data
        self.assertIsNone(data['monthly_salary'])
        self.assertEqual(data['name'], 'موظف')

    def test_update_cannot_change_salary_without_payroll_permission(self):
        view = HREmployeeViewSet()
        view.format_kwarg = None
        request = self._request(
            self.accounts_user, 'patch',
            {'name': 'موظف معدل', 'monthly_salary': 9000},
        )
        view.request = request
        view.kwargs = {'pk': str(self.employee.pk)}
        response = view.update(request, pk=str(self.employee.pk))
        # إرسال مرتب بدون صلاحية يُرفض صراحةً (403) ولا يُحدَّث أي حقل جزئياً.
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.employee.refresh_from_db()
        self.assertEqual(self.employee.name, 'موظف')
        self.assertEqual(self.employee.monthly_salary, 5000)

    def test_update_other_fields_without_salary_still_allowed(self):
        # تعديل بيانات غير مالية لا يتطلب صلاحية الرواتب (لا يُرسل حقل المرتب).
        view = HREmployeeViewSet()
        view.format_kwarg = None
        request = self._request(self.accounts_user, 'patch', {'name': 'اسم جديد'})
        view.request = request
        view.kwargs = {'pk': str(self.employee.pk)}
        response = view.update(request, pk=str(self.employee.pk))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.employee.refresh_from_db()
        self.assertEqual(self.employee.name, 'اسم جديد')
        self.assertEqual(self.employee.monthly_salary, 5000)
        # المرتب يبقى محجوباً في الاستجابة لأنه لا يملك صلاحية الرواتب.
        self.assertIsNone(response.data['monthly_salary'])

    def test_create_is_forbidden_without_payroll_permission(self):
        view = HREmployeeViewSet()
        view.format_kwarg = None
        request = self._request(
            self.accounts_user, 'post',
            {'name': 'جديد', 'job_id': str(self.job.pk), 'monthly_salary': 4000},
        )
        view.request = request
        view.kwargs = {}
        response = view.create(request)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(HREmployee.objects.filter(name='جديد').exists())

    def test_payroll_permission_allows_salary_read_and_edit(self):
        payroll_role = make_role('hr-payroll', hr_employees=True, hr_payroll=True)
        payroll_user = make_user('payroll', payroll_role, rank=RANK_LEVEL_ONE)

        data = HREmployeeSerializer(
            self.employee, context={'request': self._request(payroll_user)}
        ).data
        self.assertEqual(data['monthly_salary'], 5000.0)

        view = HREmployeeViewSet()
        view.format_kwarg = None
        request = self._request(payroll_user, 'patch', {'monthly_salary': 6500})
        view.request = request
        view.kwargs = {'pk': str(self.employee.pk)}
        response = view.update(request, pk=str(self.employee.pk))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.employee.refresh_from_db()
        self.assertEqual(self.employee.monthly_salary, 6500)

    def test_can_manage_hr_allows_salary_read_and_edit(self):
        hr_manager_role = make_role('hr-manager', hr_employees=True, can_manage_hr=True)
        hr_manager = make_user('hr-manager', hr_manager_role, rank=RANK_LEVEL_ONE)

        data = HREmployeeSerializer(
            self.employee, context={'request': self._request(hr_manager)}
        ).data
        self.assertEqual(data['monthly_salary'], 5000.0)

        view = HREmployeeViewSet()
        view.format_kwarg = None
        request = self._request(hr_manager, 'patch', {'monthly_salary': 7200})
        view.request = request
        view.kwargs = {'pk': str(self.employee.pk)}
        response = view.update(request, pk=str(self.employee.pk))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.employee.refresh_from_db()
        self.assertEqual(self.employee.monthly_salary, 7200)
        self.assertEqual(response.data['monthly_salary'], 7200.0)

    def test_manage_permissions_allows_salary_read_and_edit(self):
        admin_role = make_role('perms-admin', hr_employees=True, manage_permissions=True)
        admin = make_user('perms-admin', admin_role, rank=RANK_LEVEL_ONE)

        data = HREmployeeSerializer(
            self.employee, context={'request': self._request(admin)}
        ).data
        self.assertEqual(data['monthly_salary'], 5000.0)

        view = HREmployeeViewSet()
        view.format_kwarg = None
        request = self._request(admin, 'patch', {'monthly_salary': 8100})
        view.request = request
        view.kwargs = {'pk': str(self.employee.pk)}
        response = view.update(request, pk=str(self.employee.pk))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.employee.refresh_from_db()
        self.assertEqual(self.employee.monthly_salary, 8100)


class UserSerializerContextTests(PermissionTestBase):
    """تمرير سياق الطلب إلزامي: بدونه يفترض المُسلسِل رؤية إدارية كاملة ويُسرّب رتبة الناظر."""

    def test_heartbeat_hides_rank_label_from_rank_three_viewer(self):
        UserProfile.objects.filter(pk__in=[self.design_user.pk, self.cutting_user.pk]).update(
            last_seen=timezone.now()
        )
        view = AuthViewSet()
        request = self._request(self.cutting_user)
        view.request = request
        response = view.heartbeat(request)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['onlineUsers'])
        for row in response.data['onlineUsers']:
            self.assertEqual(row['rank_level'], RANK_LEVEL_THREE)
            self.assertNotIn('rank_label', row)

    def test_heartbeat_returns_rank_label_for_rank_one_viewer(self):
        UserProfile.objects.filter(pk=self.cutting_user.pk).update(last_seen=timezone.now())
        view = AuthViewSet()
        request = self._request(self.accounts_user)
        view.request = request
        response = view.heartbeat(request)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['onlineUsers'])
        for row in response.data['onlineUsers']:
            self.assertIn('rank_label', row)


class FabricSectionViewOnlyPermissionTests(PermissionTestBase):
    """صلاحية (view) وحدها تسمح بقراءة قسم المخزن وتمنع الإضافة/التعديل.

    فصل ``_view`` عن ``_edit`` يمنع أي مستخدم يملك "رؤية فقط" من الكتابة في
    ``FabricViewSet`` (POST / PUT / PATCH / DELETE).
    """

    def setUp(self):
        super().setUp()
        view_only_role = make_role(
            'fabric-view-only', fabric_warehouse_view=True, fabric_warehouse_edit=False,
        )
        self.view_only_user = make_user('fabric-viewer', view_only_role)
        self.client = APIClient()
        self.client.credentials(
            HTTP_AUTHORIZATION=f'Bearer {self.view_only_user.auth_token}'
        )

    def test_view_only_can_read_fabric_section(self):
        response = self.client.get('/api/fabrics/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            len(response.data), Fabric.objects.filter(is_deleted=False).count()
        )

    def test_view_only_cannot_create_fabric(self):
        response = self.client.post(
            '/api/fabrics/', {'name': 'قماش غير مصرح'}, format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(Fabric.objects.filter(name='قماش غير مصرح').exists())

    def test_view_only_cannot_update_fabric(self):
        response = self.client.put(
            f'/api/fabrics/{self.fabric.pk}/',
            {'name': 'تعديل غير مصرح'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.fabric.refresh_from_db()
        self.assertEqual(self.fabric.name, 'قطن')

    def test_edit_permission_can_create_fabric(self):
        editor_role = make_role(
            'fabric-editor', fabric_warehouse_view=True, fabric_warehouse_edit=True,
        )
        editor = make_user('fabric-editor', editor_role)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {editor.auth_token}')
        response = client.post('/api/fabrics/', {'name': 'قماش مصرح'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(Fabric.objects.filter(name='قماش مصرح').exists())



class HRLoansPenaltiesReadIsolationTests(PermissionTestBase):
    """قراءة السلف/الجزاءات محصورة على تبويباتها + المرتبات/التقارير.

    ``required_hr_section`` يأتي بصيغة 'loans'/'penalties' بينما مفاتيح الصلاحيات
    'hr_loans'/'hr_penalties'؛ يضمن هذا الاختبار أن القيود مُطبّقة فعلياً وليست
    كوداً ميتاً (أي أن مستخدم تبويب الموظفين لا يقرأ السلف/الجزاءات).
    """

    def setUp(self):
        super().setUp()
        self.client = APIClient()

    def _get_as(self, user, path):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {user.auth_token}')
        return self.client.get(path)

    def test_employees_only_viewer_cannot_read_loans_or_penalties(self):
        self.assertEqual(
            self._get_as(self.accounts_user, '/api/hr-loans/').status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self._get_as(self.accounts_user, '/api/hr-penalties/').status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_payroll_viewer_can_read_loans_and_penalties(self):
        user = make_user('payroll-reader', make_role('payroll-sections', hr_payroll=True))
        self.assertEqual(
            self._get_as(user, '/api/hr-loans/').status_code, status.HTTP_200_OK,
        )
        self.assertEqual(
            self._get_as(user, '/api/hr-penalties/').status_code, status.HTTP_200_OK,
        )

    def test_reports_viewer_can_read_loans_and_penalties(self):
        user = make_user('reports-reader', make_role('reports-sections', hr_reports=True))
        self.assertEqual(
            self._get_as(user, '/api/hr-loans/').status_code, status.HTTP_200_OK,
        )
        self.assertEqual(
            self._get_as(user, '/api/hr-penalties/').status_code, status.HTTP_200_OK,
        )

    def test_loans_viewer_can_read_penalties(self):
        # قراءة الجزاءات مسموحة أيضاً لتبويب السلف (خصم مشترك في المرتب).
        user = make_user('loans-reader', make_role('loans-only', hr_loans=True))
        self.assertEqual(
            self._get_as(user, '/api/hr-loans/').status_code, status.HTTP_200_OK,
        )
        self.assertEqual(
            self._get_as(user, '/api/hr-penalties/').status_code, status.HTTP_200_OK,
        )

    def test_attendance_only_viewer_cannot_read_loans_or_penalties(self):
        user = make_user('attendance-reader', make_role('attendance-only', hr_attendance=True))
        self.assertEqual(
            self._get_as(user, '/api/hr-loans/').status_code, status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self._get_as(user, '/api/hr-penalties/').status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_penalties_viewer_cannot_read_loans(self):
        user = make_user('penalties-reader', make_role('penalties-only', hr_penalties=True))
        self.assertEqual(
            self._get_as(user, '/api/hr-penalties/').status_code, status.HTTP_200_OK,
        )
        self.assertEqual(
            self._get_as(user, '/api/hr-loans/').status_code, status.HTTP_403_FORBIDDEN,
        )


class HRReportsSalaryMaskingTests(PermissionTestBase):
    """من يملك hr_reports فقط لا يرى أي رقم رواتب في تقرير HR."""

    MONTH_KEY = '2026-01'

    def _payload(self, can_view_salaries):
        row = {
            'earned_base': 5000.0,
            'overtime_pay': 100.0,
            'loan_amount': 50.0,
            'deductions': 20.0,
            'net_pay': 5030.0,
        }
        return HRReportsViewSet._build_payload(
            year=2026,
            today=date(2026, 1, 15),
            year_months=[self.MONTH_KEY],
            range_months=[self.MONTH_KEY],
            range_from_key=self.MONTH_KEY,
            range_to_key=self.MONTH_KEY,
            range_start=date(2026, 1, 1),
            range_end=date(2026, 1, 31),
            employees=[self.employee],
            employee_rows={self.employee.id: {self.MONTH_KEY: row}},
            active_workers=1,
            window_records=[],
            window_loans=[],
            available_years=[2026],
            can_view_salaries=can_view_salaries,
        )

    def test_reports_only_viewer_gets_zeroed_salary_fields(self):
        payload = self._payload(can_view_salaries=False)
        month_row = payload['annual']['months'][0]
        self.assertEqual(month_row['earned_salary'], 0.0)
        self.assertEqual(month_row['net_paid'], 0.0)
        self.assertEqual(payload['annual']['kpis']['net_salary_total'], 0.0)
        self.assertEqual(payload['annual']['kpis']['avg_monthly_labor_cost'], 0.0)
        self.assertEqual(payload['range']['comparison'][0]['net'], 0.0)
        self.assertIsNone(payload['range']['comparison'][0]['net_change_pct'])
        for dept_row in payload['range']['department_breakdown']:
            self.assertEqual(dept_row['earned'], 0.0)
            self.assertEqual(dept_row['net'], 0.0)
            self.assertEqual(dept_row['percent'], 0.0)
        for dept_rows in payload['annual']['monthly_departments'].values():
            for dept_row in dept_rows:
                self.assertEqual(dept_row['earned'], 0.0)
                self.assertEqual(dept_row['net'], 0.0)

    def test_payroll_viewer_keeps_salary_fields(self):
        payload = self._payload(can_view_salaries=True)
        month_row = payload['annual']['months'][0]
        self.assertEqual(month_row['earned_salary'], 5000.0)
        self.assertEqual(month_row['net_paid'], 5030.0)
        self.assertEqual(payload['annual']['kpis']['net_salary_total'], 5030.0)
        dept_row = payload['range']['department_breakdown'][0]
        self.assertEqual(dept_row['earned'], 5000.0)
        self.assertEqual(dept_row['net'], 5030.0)





class AccessoryReservationLifecycleTests(PermissionTestBase):
    """الإكسسوار يبقى محجوزاً بعد صرف القماش للقص حتى الصرف الفعلي من مخزن الإكسسوارات."""

    def setUp(self):
        super().setUp()
        self.model_accessory = ModelAccessory.objects.create(
            model=self.model,
            accessory_id_ref=self.accessory.client_id,
            accessory_name=self.accessory.name,
            target_type='shirt',
            planned_quantity=4,
        )
        sync_reserved_quantities()

    def _call_model_action(self, action_name, data):
        request = self._request(self.fabric_user, method='post', data=data)
        view = ModelItemViewSet()
        view.format_kwarg = None
        view.request = request
        view.kwargs = {'pk': str(self.model.pk)}
        return getattr(view, action_name)(request, pk=str(self.model.pk))

    def test_accessory_stays_reserved_after_fabric_issue(self):
        self.accessory.refresh_from_db()
        self.assertEqual(float(self.accessory.reserved_quantity), 4)

        response = self._call_model_action(
            'issue_fabric_to_cutting', {'user_name': 'مسؤول التصميم'},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.accessory.refresh_from_db()
        # لا يزال محجوزاً: لم يتم صرفه فعلياً من مخزن الإكسسوارات بعد.
        self.assertEqual(float(self.accessory.reserved_quantity), 4)
        self.assertEqual(self.accessory.current_stock, 500)

    def test_accessory_reservation_released_after_actual_issue(self):
        self._call_model_action('issue_fabric_to_cutting', {'user_name': 'مسؤول التصميم'})

        response = self._call_model_action(
            'issue_accessories',
            {
                'user_name': 'أمين المخزن',
                'issued_to': 'مشرف المكن',
                'quantities': {self.model_accessory.client_id: 4},
            },
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.accessory.refresh_from_db()
        self.assertEqual(float(self.accessory.reserved_quantity), 0)
        self.assertEqual(self.accessory.current_stock, 496)

        self.model_accessory.refresh_from_db()
        self.assertTrue(self.model_accessory.is_issued)
        self.assertEqual(self.model_accessory.issued_quantity, 4)
