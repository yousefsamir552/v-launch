"""اختبارات إرجاع فائض القماش من قسم القص إلى مخزن القماش."""
from django.test import TestCase
from rest_framework import status
from rest_framework.parsers import JSONParser
from rest_framework.request import Request as DRFRequest
from rest_framework.test import APIRequestFactory

from .models import (
    Fabric,
    FabricColor,
    FabricTransaction,
    ModelItem,
    ModelRequirement,
    ModelTimeline,
    Role,
    UserProfile,
    RANK_LEVEL_THREE,
)
from .views import ModelItemViewSet


def make_role(name, **perms):
    return Role.objects.create(
        name=name, permissions_json=perms, rank_level=RANK_LEVEL_THREE
    )


def make_user(username, role):
    user = UserProfile(
        username=username, real_name=username, role=role, rank_level=RANK_LEVEL_THREE
    )
    user.auth_token = f'token-{username}'
    user.set_password('x')
    user.save()
    return user


class ReturnFabricBase(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        role = make_role('cutting-return', cutting_view=True, cutting_edit=True)
        self.user = make_user('cutting-return-user', role)
        notes_role = make_role(
            'cutting-return-notes',
            cutting_view=True,
            cutting_edit=True,
            can_add_cutting_notes=True,
        )
        self.notes_user = make_user('cutting-return-notes-user', notes_role)

        self.fabric = Fabric.objects.create(name='قطن', unit='متر')
        self.color = FabricColor.objects.create(
            fabric=self.fabric,
            color_code='BLK',
            color_name='أسود',
            quantity=5,
        )
        self.model = ModelItem.objects.create(
            model_code='RET-CUT-1', status='في القص'
        )
        self.req = ModelRequirement.objects.create(
            model=self.model,
            color=self.color,
            part_name='تيشرت',
            planned_quantity=10,
            unit_price_snapshot=20,
        )

    def _call(self, data=None, user=None):
        self.model.refresh_from_db()
        wsgi_request = self.factory.post('/', data=data or {}, format='json')
        request = DRFRequest(wsgi_request, parsers=[JSONParser()])
        request.user_profile = user or self.user
        view = ModelItemViewSet()
        view.format_kwarg = None
        view.request = request
        view.kwargs = {'pk': str(self.model.pk)}
        return view.return_fabric_to_warehouse(request, pk=str(self.model.pk))

    def assert_nothing_moved(self):
        self.req.refresh_from_db()
        self.color.refresh_from_db()
        self.assertEqual(self.req.planned_quantity, 10)
        self.assertEqual(self.color.quantity, 5)
        self.assertFalse(FabricTransaction.objects.exists())
        self.assertFalse(
            ModelTimeline.objects.filter(title='إرجاع فائض قماش إلى المخزن').exists()
        )


class ReturnFabricSuccessTests(ReturnFabricBase):
    def test_return_surplus_moves_quantity_to_warehouse(self):
        response = self._call(
            {
                'requirement_id': str(self.req.pk),
                'quantity': 4,
                'user_name': 'عامل القص',
            }
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.req.refresh_from_db()
        self.color.refresh_from_db()
        self.assertEqual(self.req.planned_quantity, 6)
        self.assertEqual(self.color.quantity, 9)
        self.assertEqual(response.data['requirement']['planned_quantity'], 6)

        txn = FabricTransaction.objects.get()
        self.assertEqual(txn.operation, 'add')
        self.assertEqual(txn.amount, 4)
        self.assertEqual(txn.color_id, self.color.pk)
        self.assertEqual(txn.fabric_id, self.fabric.pk)
        self.assertEqual(txn.model_code_ref, 'RET-CUT-1')

        timeline = ModelTimeline.objects.get(title='إرجاع فائض قماش إلى المخزن')
        self.assertEqual(timeline.details['returned_quantity'], 4)
        self.assertEqual(timeline.details['remaining_planned_quantity'], 6)

    def test_notes_dropped_without_cutting_notes_permission(self):
        response = self._call(
            {
                'requirement_id': str(self.req.pk),
                'quantity': 1,
                'notes': 'متبقي من الرول',
            }
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        timeline = ModelTimeline.objects.get(title='إرجاع فائض قماش إلى المخزن')
        self.assertEqual(timeline.details['worker_notes'], '')

    def test_notes_kept_with_cutting_notes_permission(self):
        response = self._call(
            {
                'requirement_id': str(self.req.pk),
                'quantity': 1,
                'notes': 'متبقي من الرول',
            },
            user=self.notes_user,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        timeline = ModelTimeline.objects.get(title='إرجاع فائض قماش إلى المخزن')
        self.assertEqual(timeline.details['worker_notes'], 'متبقي من الرول')


class ReturnFabricValidationTests(ReturnFabricBase):
    def test_quantity_above_remaining_plan_is_rejected(self):
        response = self._call({'requirement_id': str(self.req.pk), 'quantity': 11})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('أكبر من الكمية المتبقية', response.data['error'])
        self.assert_nothing_moved()

    def test_zero_quantity_is_rejected(self):
        response = self._call({'requirement_id': str(self.req.pk), 'quantity': 0})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assert_nothing_moved()

    def test_missing_requirement_id_is_rejected(self):
        response = self._call({'quantity': 1})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assert_nothing_moved()

    def test_requirement_of_another_model_is_rejected(self):
        other_model = ModelItem.objects.create(model_code='RET-CUT-2', status='في القص')
        other_req = ModelRequirement.objects.create(
            model=other_model,
            color=self.color,
            part_name='بنطلون',
            planned_quantity=3,
        )
        response = self._call({'requirement_id': str(other_req.pk), 'quantity': 1})
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assert_nothing_moved()

    def test_zero_planned_quantity_is_rejected(self):
        self.req.planned_quantity = 0
        self.req.save(update_fields=['planned_quantity'])
        response = self._call({'requirement_id': str(self.req.pk), 'quantity': 1})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('لا توجد كمية مخططة', response.data['error'])
        self.color.refresh_from_db()
        self.assertEqual(self.color.quantity, 5)
        self.assertFalse(FabricTransaction.objects.exists())
