"""اختبارات تعديل البيانات الأساسية للموديل من قسم التصميم.

تغطي:
* تعديل النوع وفئة المقاسات وتكوين القطع والعدد المستهدف وملاحظات التصميم.
* إعادة تسمية كود الموديل ومزامنة حركات مخزن القماش والإكسسوار.
* رفض كود فارغ أو مكرر لموديل نشط.
"""
from rest_framework import status
from rest_framework.test import APIClient
from django.test import TestCase

from .models import (
    Role, UserProfile, ModelItem, Fabric, FabricColor, FabricTransaction,
    Accessory, AccessoryTransaction, RANK_LEVEL_THREE,
)


def make_role(name, **perms):
    return Role.objects.create(name=name, permissions_json=perms, rank_level=RANK_LEVEL_THREE)


def make_user(username, role):
    user = UserProfile(username=username, real_name=username, role=role, rank_level=RANK_LEVEL_THREE)
    user.auth_token = f'token-{username}'
    user.set_password('x')
    user.save()
    return user


class ModelBasicInfoUpdateTests(TestCase):
    def setUp(self):
        self.role = make_role(
            'design-edit', design_view=True, design_edit=True, can_add_design_notes=True,
        )
        self.user = make_user('designer-basic', self.role)
        self.model = ModelItem.objects.create(
            model_code='OLD-100',
            target_cut_quantity=500,
            model_type='أولادي',
            garment_composition='three_pieces',
            garment_parts=['shirt', 'pants', 'jacket'],
        )
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.user.auth_token}')

    def test_update_basic_info_fields(self):
        response = self.client.patch(
            f'/api/models/{self.model.pk}/',
            {
                'model_type': 'بناتي',
                'size_category_id': 'size-1',
                'garment_composition': 'two_pieces',
                'target_cut_quantity': 750,
                'design_notes': 'ملاحظات تصميم جديدة',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.model.refresh_from_db()
        self.assertEqual(self.model.model_type, 'بناتي')
        self.assertEqual(self.model.size_category_id, 'size-1')
        self.assertEqual(self.model.garment_composition, 'two_pieces')
        self.assertEqual(self.model.garment_parts, ['shirt', 'pants'])
        self.assertEqual(self.model.target_cut_quantity, 750)
        self.assertEqual(self.model.design_notes, 'ملاحظات تصميم جديدة')

    def test_rename_model_code_syncs_warehouse_transactions(self):
        fabric = Fabric.objects.create(name='قطن')
        color = FabricColor.objects.create(fabric=fabric, color_code='C1')
        fabric_tr = FabricTransaction.objects.create(
            color=color, fabric=fabric, model_code_ref='OLD-100', amount=10,
        )
        accessory = Accessory.objects.create(name='سوستة')
        accessory_tr = AccessoryTransaction.objects.create(
            accessory=accessory, model_code_ref='OLD-100', amount=5,
        )

        response = self.client.patch(
            f'/api/models/{self.model.pk}/',
            {'model_code': ' new-200 '},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.model.refresh_from_db()
        fabric_tr.refresh_from_db()
        accessory_tr.refresh_from_db()
        self.assertEqual(self.model.model_code, 'NEW-200')
        self.assertEqual(fabric_tr.model_code_ref, 'NEW-200')
        self.assertEqual(accessory_tr.model_code_ref, 'NEW-200')

    def test_reject_duplicate_active_model_code(self):
        ModelItem.objects.create(model_code='USED-300')

        response = self.client.patch(
            f'/api/models/{self.model.pk}/',
            {'model_code': 'used-300'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.model.refresh_from_db()
        self.assertEqual(self.model.model_code, 'OLD-100')

    def test_reject_empty_model_code(self):
        response = self.client.patch(
            f'/api/models/{self.model.pk}/',
            {'model_code': '   '},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.model.refresh_from_db()
        self.assertEqual(self.model.model_code, 'OLD-100')
