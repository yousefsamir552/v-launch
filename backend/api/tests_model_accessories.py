"""اختبارات دعم القطعة الثالثة (الجاكيت) والقطعة الواحدة (single).

تغطي:
* حفظ ملاحظات الجاكيت والعدد المستهدف وكميات الإكسسوارات عبر ``update_plan``.
* قبول أنواع الإكسسوار ``jacket`` و ``single`` في نقطة إضافة إكسسوارات الموديل.
* إعادة ملاحظات الجاكيت ضمن بيانات الموديل الراجعة من الباك إند.
"""
from rest_framework import status
from rest_framework.test import APIClient
from django.test import TestCase

from .models import (
    Role, UserProfile, ModelItem, ModelAccessory,
    RANK_LEVEL_THREE,
)


def make_role(name, **perms):
    return Role.objects.create(name=name, permissions_json=perms, rank_level=RANK_LEVEL_THREE)


def make_user(username, role):
    user = UserProfile(username=username, real_name=username, role=role, rank_level=RANK_LEVEL_THREE)
    user.auth_token = f'token-{username}'
    user.set_password('x')
    user.save()
    return user


class JacketAndSingleAccessorySupportTests(TestCase):
    def setUp(self):
        self.role = make_role(
            'design-notes', design_view=True, design_edit=True, can_add_design_notes=True,
        )
        self.user = make_user('designer-jacket', self.role)
        self.model = ModelItem.objects.create(
            model_code='M-JACKET-1',
            target_cut_quantity=500,
            garment_composition='three_pieces',
            garment_parts=['shirt', 'pants', 'jacket'],
        )
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.user.auth_token}')

    def test_update_plan_persists_jacket_notes_target_and_accessory_quantities(self):
        accessory = ModelAccessory.objects.create(
            model=self.model,
            accessory_name='سوستة',
            target_type='jacket',
            piece_consumption=2,
            planned_quantity=1000,
        )

        response = self.client.post(
            f'/api/models/{self.model.pk}/update_plan/',
            {
                'notesJacket': 'بطانة الجاكيت لون أسود',
                'targetCutQuantity': 600,
                'accQuantities': {str(accessory.pk): 1200},
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.model.refresh_from_db()
        accessory.refresh_from_db()
        self.assertEqual(self.model.notes_jacket, 'بطانة الجاكيت لون أسود')
        self.assertEqual(self.model.target_cut_quantity, 600)
        self.assertEqual(accessory.planned_quantity, 1200)
        self.assertEqual(response.data.get('notes_jacket'), 'بطانة الجاكيت لون أسود')

    def test_create_model_persists_jacket_notes_for_clone(self):
        response = self.client.post(
            '/api/models/',
            {
                'id': 'model-clone-test',
                'model_code': 'M-JACKET-CLONE',
                'target_cut_quantity': 700,
                'garment_composition': 'three_pieces',
                'design_notes': 'ملاحظات عامة',
                'notes_shirt': 'ملاحظات التيشرت',
                'notes_pants': 'ملاحظات البنطلون',
                'notes_jacket': 'ملاحظات الجاكيت',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        created = ModelItem.objects.get(model_code='M-JACKET-CLONE')
        self.assertEqual(created.notes_jacket, 'ملاحظات الجاكيت')
        self.assertEqual(created.garment_parts, ['shirt', 'pants', 'jacket'])
        self.assertEqual(response.data.get('notes_jacket'), 'ملاحظات الجاكيت')

    def test_model_accessory_accepts_jacket_and_single_target_types(self):
        cases = [
            ('سوستة جاكيت', 'jacket'),
            ('تيكيت قطعة واحدة', 'single'),
        ]
        for index, (name, target_type) in enumerate(cases):
            response = self.client.post(
                '/api/model-accessories/',
                {
                    'id': f'macc-test-{index}',
                    'model_id': self.model.pk,
                    'accessory_name': name,
                    'target_type': target_type,
                    'piece_consumption': 1,
                    'planned_quantity': 500,
                    'unit': 'قطعة',
                },
                format='json',
            )
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)
            self.assertEqual(response.data.get('target_type'), target_type)

        self.assertTrue(
            ModelAccessory.objects.filter(model=self.model, target_type='jacket').exists()
        )
        self.assertTrue(
            ModelAccessory.objects.filter(model=self.model, target_type='single').exists()
        )
