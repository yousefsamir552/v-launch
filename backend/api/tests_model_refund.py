"""اختبارات استرداد خامات وإكسسوارات الموديلات المحذوفة إلى المخزن.

تتحقق من:
- إعادة رصيد القماش والإكسسوار المنصرف فعلياً عند حذف الموديل.
- أن الاسترداد Idempotent (تشغيله مرتين لا يضاعف الرصيد).
- احترام المرتجعات السابقة (deduct - add) وعدم استرداد العيوب (defect).
- تجاهل حركات الموديلات الأخرى التي تشترك في نفس اللون/الإكسسوار.
- تصفير حالة صرف إكسسوارات الموديل بعد الاسترداد.
- صلاحية نقطة النهاية الجماعية (sudo / manage_permissions فقط).
"""
from django.test import TestCase
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import JSONParser
from rest_framework.request import Request as DRFRequest
from rest_framework.test import APIClient, APIRequestFactory

from .models import (
    Role, UserProfile, Fabric, FabricColor, Accessory,
    FabricTransaction, AccessoryTransaction,
    ModelItem, ModelAccessory, RANK_LEVEL_THREE,
)
from .services_pipeline import refund_model_consumed_inventory
from .views_models import ModelItemViewSet


def make_user(username, role=None, is_sudo=False, rank=RANK_LEVEL_THREE):
    user = UserProfile(
        username=username, real_name=username, role=role,
        rank_level=rank, is_sudo=is_sudo,
    )
    user.auth_token = f'token-{username}'
    user.set_password('x')
    user.save()
    return user


class RefundModelInventoryServiceTests(TestCase):
    def setUp(self):
        self.model = ModelItem.objects.create(model_code='M-REF-1')
        self.fabric = Fabric.objects.create(name='قطن')
        # الرصيد الحالي يمثّل ما تبقّى بعد خصم 10 وحدات (صرف فعلي).
        self.color = FabricColor.objects.create(
            fabric=self.fabric, color_code='BLK', price_per_unit=12.5, quantity=90,
        )
        self.accessory = Accessory.objects.create(
            name='زرار', code='BTN-1', price_per_unit=1.5, current_stock=80,
        )
        FabricTransaction.objects.create(
            color=self.color, fabric=self.fabric, model_code_ref='M-REF-1',
            operation='deduct', amount=10,
        )
        AccessoryTransaction.objects.create(
            accessory=self.accessory, model_code_ref='M-REF-1',
            operation='deduct', amount=20,
        )
        self.model_accessory = ModelAccessory.objects.create(
            model=self.model,
            accessory_id_ref=str(self.accessory.id),
            accessory_name='زرار',
            planned_quantity=20,
            is_issued=True,
            issued_quantity=20,
            issued_to='المكن',
            issued_at='2026-01-01 10:00',
            issued_by='أمين المخزن',
        )

    def test_refund_restores_fabric_and_accessory_balances(self):
        summary = refund_model_consumed_inventory(self.model, 'tester')
        self.color.refresh_from_db()
        self.accessory.refresh_from_db()
        self.assertEqual(self.color.quantity, 100.0)
        self.assertEqual(self.accessory.current_stock, 100)
        self.assertEqual(summary['fabric_total_quantity'], 10.0)
        self.assertEqual(summary['accessories_total_quantity'], 20.0)
        self.assertEqual(summary['fabric_colors_count'], 1)
        self.assertEqual(summary['accessories_count'], 1)
        self.assertTrue(
            FabricTransaction.objects.filter(
                color=self.color, model_code_ref='M-REF-1', operation='add', amount=10,
            ).exists()
        )
        self.assertTrue(
            AccessoryTransaction.objects.filter(
                accessory=self.accessory, model_code_ref='M-REF-1', operation='add', amount=20,
            ).exists()
        )
        # تصفير حالة الصرف الفعلي للإكسسوار.
        self.model_accessory.refresh_from_db()
        self.assertFalse(self.model_accessory.is_issued)
        self.assertEqual(self.model_accessory.issued_quantity, 0)
        self.assertEqual(self.model_accessory.issued_to, '')

    def test_refund_is_idempotent(self):
        first = refund_model_consumed_inventory(self.model)
        self.assertEqual(first['fabric_total_quantity'], 10.0)
        second = refund_model_consumed_inventory(self.model)
        self.assertEqual(second['fabric_total_quantity'], 0.0)
        self.assertEqual(second['accessories_total_quantity'], 0.0)
        self.color.refresh_from_db()
        self.accessory.refresh_from_db()
        self.assertEqual(self.color.quantity, 100.0)
        self.assertEqual(self.accessory.current_stock, 100)

    def test_previous_return_reduces_refundable_net(self):
        # إرجاع سابق 4 وحدات قماش أُضيفت للرصيد فعلاً.
        FabricTransaction.objects.create(
            color=self.color, fabric=self.fabric, model_code_ref='M-REF-1',
            operation='add', amount=4,
        )
        self.color.quantity = 94
        self.color.save(update_fields=['quantity'])
        summary = refund_model_consumed_inventory(self.model)
        self.color.refresh_from_db()
        self.assertEqual(summary['fabric_total_quantity'], 6.0)
        self.assertEqual(self.color.quantity, 100.0)

    def test_defect_quantity_is_not_refunded(self):
        FabricTransaction.objects.create(
            color=self.color, fabric=self.fabric, model_code_ref='M-REF-1',
            operation='defect', amount=3,
        )
        summary = refund_model_consumed_inventory(self.model)
        self.color.refresh_from_db()
        # الصافي السليم = deduct 10 - add 0 - defect 3 = 7 (العيوب لا تُعاد أبداً للرصيد السليم).
        self.assertEqual(summary['fabric_total_quantity'], 7.0)
        self.assertEqual(self.color.quantity, 97.0)

    def test_refund_ignores_transactions_of_other_models(self):
        ModelItem.objects.create(model_code='M-OTHER')
        FabricTransaction.objects.create(
            color=self.color, fabric=self.fabric, model_code_ref='M-OTHER',
            operation='deduct', amount=50,
        )
        summary = refund_model_consumed_inventory(self.model)
        self.color.refresh_from_db()
        self.assertEqual(summary['fabric_total_quantity'], 10.0)
        self.assertEqual(self.color.quantity, 100.0)


class RefundDeletedInventoryActionTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.sudo = make_user('sudo', is_sudo=True, rank=0)
        self.role = Role.objects.create(
            name='design', permissions_json={'design_view': True, 'design_edit': True},
            rank_level=RANK_LEVEL_THREE,
        )
        self.designer = make_user('designer', role=self.role)
        self.deleted_model = ModelItem.objects.create(model_code='M-DEL-1', is_deleted=True)
        self.fabric = Fabric.objects.create(name='قطن')
        self.color = FabricColor.objects.create(
            fabric=self.fabric, color_code='WHT', price_per_unit=10, quantity=95,
        )
        FabricTransaction.objects.create(
            color=self.color, fabric=self.fabric, model_code_ref='M-DEL-1',
            operation='deduct', amount=5,
        )

    def _post_action(self, viewer):
        wsgi_request = self.factory.post('/', data={}, format='json')
        request = DRFRequest(wsgi_request, parsers=[JSONParser()])
        request.user_profile = viewer
        view = ModelItemViewSet()
        view.action = 'refund_deleted_inventory'
        return view.refund_deleted_inventory(request)

    def test_sudo_can_refund_deleted_models(self):
        response = self._post_action(self.sudo)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['total_models_refunded'], 1)
        self.assertEqual(response.data['total_fabric_quantity'], 5.0)
        self.color.refresh_from_db()
        self.assertEqual(self.color.quantity, 100.0)

    def test_repeated_bulk_refund_is_idempotent(self):
        self._post_action(self.sudo)
        response = self._post_action(self.sudo)
        self.assertEqual(response.data['total_models_refunded'], 0)
        self.color.refresh_from_db()
        self.assertEqual(self.color.quantity, 100.0)

    def test_designer_without_manage_permissions_is_forbidden(self):
        with self.assertRaises(PermissionDenied):
            self._post_action(self.designer)
        self.color.refresh_from_db()
        self.assertEqual(self.color.quantity, 95.0)


class DestroyRefundsInventoryEndpointTests(TestCase):
    """اختبار مسار الحذف الفعلي ``DELETE /api/models/{id}/`` يسترد الأرصدة."""

    def setUp(self):
        self.client = APIClient()
        self.sudo = make_user('sudo', is_sudo=True, rank=0)
        self.model = ModelItem.objects.create(model_code='M-DESTROY-1')
        self.fabric = Fabric.objects.create(name='كتان')
        # الأرصدة الحالية بعد خصم الصرف الفعلي (30 قماش / 10 إكسسوار).
        self.color = FabricColor.objects.create(
            fabric=self.fabric, color_code='NVY', price_per_unit=8, quantity=70,
        )
        self.accessory = Accessory.objects.create(
            name='سحاب', code='ZIP-1', current_stock=40,
        )
        FabricTransaction.objects.create(
            color=self.color, fabric=self.fabric, model_code_ref='M-DESTROY-1',
            operation='deduct', amount=30,
        )
        AccessoryTransaction.objects.create(
            accessory=self.accessory, model_code_ref='M-DESTROY-1',
            operation='deduct', amount=10,
        )

    def test_delete_endpoint_refunds_and_returns_summary(self):
        response = self.client.delete(
            f'/api/models/{self.model.id}/',
            HTTP_AUTHORIZATION='Bearer token-sudo',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], 'deleted')
        self.assertEqual(response.data['refund_summary']['fabric_total_quantity'], 30.0)
        self.assertEqual(
            response.data['refund_summary']['accessories_total_quantity'], 10.0
        )
        self.model.refresh_from_db()
        self.assertTrue(self.model.is_deleted)
        self.color.refresh_from_db()
        self.accessory.refresh_from_db()
        self.assertEqual(self.color.quantity, 100.0)
        self.assertEqual(self.accessory.current_stock, 50)


class RefundDeletedInventoryPermissionEndpointTests(TestCase):
    """تتحقق من بوابة الصلاحية على المسار الحقيقي ``/api/models/refund_deleted_inventory/``."""

    URL = '/api/models/refund_deleted_inventory/'

    def setUp(self):
        self.client = APIClient()
        self.sudo = make_user('sudo', is_sudo=True, rank=0)
        self.manager_role = Role.objects.create(
            name='manager', permissions_json={'manage_permissions': True},
            rank_level=RANK_LEVEL_THREE,
        )
        self.manager = make_user('manager', role=self.manager_role)
        self.designer_role = Role.objects.create(
            name='design', permissions_json={'design_view': True, 'design_edit': True},
            rank_level=RANK_LEVEL_THREE,
        )
        self.designer = make_user('designer', role=self.designer_role)
        ModelItem.objects.create(model_code='M-DEL-PERM', is_deleted=True)

    def _post(self, token=None):
        headers = {'HTTP_AUTHORIZATION': f'Bearer {token}'} if token else {}
        return self.client.post(self.URL, {}, format='json', **headers)

    def test_sudo_passes_gate(self):
        self.assertEqual(self._post('token-sudo').status_code, 200)

    def test_manage_permissions_manager_passes_gate(self):
        self.assertEqual(self._post('token-manager').status_code, 200)

    def test_design_only_user_is_denied(self):
        self.assertEqual(self._post('token-designer').status_code, 403)

    def test_anonymous_is_rejected(self):
        self.assertEqual(self._post(None).status_code, 403)
