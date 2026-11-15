"""اختبارات الاستلام الجزئي على دفعات لتشغيلات الخياطة والمطابع.

تغطي:
* خدمة استلام تشغيلة الخياطة على دفعات: تراكم ``received_pieces`` + سجل الدفعات
  + حالة «استلام جزئي» حتى اكتمال الكمية.
* رفض استلام دفعة جديدة بعد اكتمال الكمية.
* نقطة ``update_status`` لتشغيلة المطابع: الاستلام الجزئي ثم الاستلام الكامل
  مع فتح مرحلة «العد بعد الطباعة» وفتح «العد بعد المكن» للخياطة.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from .models import (
    ModelItem,
    PrintDispatch,
    Role,
    SewingDispatch,
    UserProfile,
    RANK_LEVEL_THREE,
)
from .services import get_part_stages, receive_model_from_sewing_service


def make_role(name, **perms):
    return Role.objects.create(name=name, permissions_json=perms, rank_level=RANK_LEVEL_THREE)


def make_user(username, role):
    user = UserProfile(username=username, real_name=username, role=role, rank_level=RANK_LEVEL_THREE)
    user.auth_token = f'token-{username}'
    user.set_password('x')
    user.save()
    return user


class SewingPartialReceiptTests(TestCase):
    def setUp(self):
        self.model = ModelItem.objects.create(
            model_code='M-PARTIAL-SEW',
            target_cut_quantity=100,
            garment_composition='two_pieces',
            garment_parts=['shirt', 'pants'],
        )
        self.dispatch = SewingDispatch.objects.create(
            model=self.model,
            piece_type='shirt',
            workshop_name='ورشة الأمل',
            pieces_count=100,
            expected_delivery_date=timezone.now().date(),
        )

    def test_partial_then_complete_receipt_accumulates_history(self):
        first = receive_model_from_sewing_service(
            self.dispatch.pk, user_name='مراقب الجودة', notes='الدفعة الأولى', received_qty=40,
        )
        first.refresh_from_db()
        self.assertEqual(first.received_pieces, 40)
        self.assertEqual(first.status, 'استلام جزئي')
        self.assertEqual(len(first.receive_history), 1)
        self.assertEqual(first.receive_history[0]['qty'], 40)
        self.assertEqual(first.receive_history[0]['total_received'], 40)
        # الدفعة الجزئية تفتح الفرز فوراً لعد ما تم استلامه.
        self.model.refresh_from_db()
        self.assertEqual(get_part_stages(self.model)['shirt'], 'qc_after_sewing')
        # القطعة الأخرى لم تتأثر بالاستلام الجزئي.
        self.assertEqual(get_part_stages(self.model)['pants'], 'cutting')

        second = receive_model_from_sewing_service(
            self.dispatch.pk, user_name='مراقب الجودة', received_qty=60,
        )
        second.refresh_from_db()
        self.assertEqual(second.received_pieces, 100)
        self.assertEqual(second.status, 'تم الاستلام')
        self.assertEqual(len(second.receive_history), 2)
        self.assertEqual(second.receive_history[1]['total_received'], 100)

    def test_receiving_more_than_remaining_is_clamped(self):
        receive_model_from_sewing_service(self.dispatch.pk, received_qty=30)
        dispatch = receive_model_from_sewing_service(self.dispatch.pk, received_qty=500)
        dispatch.refresh_from_db()
        self.assertEqual(dispatch.received_pieces, 100)
        self.assertEqual(dispatch.status, 'تم الاستلام')
        self.assertEqual(dispatch.receive_history[-1]['qty'], 70)

    def test_receiving_after_completion_raises(self):
        receive_model_from_sewing_service(self.dispatch.pk, received_qty=100)
        with self.assertRaises(ValueError):
            receive_model_from_sewing_service(self.dispatch.pk, received_qty=10)


class PrintPartialReceiptApiTests(TestCase):
    def setUp(self):
        self.role = make_role(
            'printing-partial', printing_view=True, printing_edit=True,
        )
        self.user = make_user('printing-partial', self.role)
        self.model = ModelItem.objects.create(
            model_code='M-PARTIAL-PRINT',
            target_cut_quantity=200,
            garment_composition='two_pieces',
            garment_parts=['shirt', 'pants'],
        )
        self.dispatch = PrintDispatch.objects.create(
            model=self.model,
            print_house='مطبعة النور',
            piece_type='shirt',
            pieces_count=200,
            status='مرسل للمطبعة',
            expected_delivery_date=timezone.now().date(),
        )
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.user.auth_token}')

    def _receive(self, qty):
        return self.client.post(
            f'/api/dispatches/{self.dispatch.pk}/update_status/',
            {'status': 'تم الاستلام بالمصنع', 'received_qty': qty, 'user_name': 'مسؤول المطابع'},
            format='json',
        )

    def test_update_status_supports_partial_batches(self):
        first = self._receive(50)
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.dispatch.refresh_from_db()
        self.assertEqual(self.dispatch.received_pieces, 50)
        self.assertEqual(self.dispatch.status, 'استلام جزئي')
        self.assertEqual(len(self.dispatch.receive_history), 1)
        self.assertEqual(first.data.get('remaining_pieces'), 150)
        self.model.refresh_from_db()
        self.assertEqual(get_part_stages(self.model)['shirt'], 'qc_after_print')

        second = self._receive(150)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.dispatch.refresh_from_db()
        self.assertEqual(self.dispatch.received_pieces, 200)
        self.assertEqual(self.dispatch.status, 'تم الاستلام بالمصنع')
        self.assertEqual(second.data.get('remaining_pieces'), 0)
        self.assertEqual(len(self.dispatch.receive_history), 2)

    def test_partial_receipt_keeps_sibling_part_out_of_printing_stage(self):
        self._receive(20)
        self.model.refresh_from_db()
        stages = get_part_stages(self.model)
        self.assertEqual(stages['shirt'], 'qc_after_print')
        self.assertEqual(stages['pants'], 'cutting')

    def test_full_receipt_without_qty_receives_all_remaining(self):
        self._receive(80)
        response = self._receive(None)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.dispatch.refresh_from_db()
        self.assertEqual(self.dispatch.received_pieces, 200)
        self.assertEqual(self.dispatch.status, 'تم الاستلام بالمصنع')
        self.assertEqual(self.dispatch.receive_history[-1]['qty'], 120)
