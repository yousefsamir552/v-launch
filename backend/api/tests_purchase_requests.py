"""اختبارات وحدة طلبات الشراء (Purchase Requests / Procurement):
- CRUD كامل بدون الحاجة لإنشاء صنف إكسسوار مسبقاً، مع التأكد من عدم إضافة صورة عشوائية عند غياب الصورة.
- إجراء mark_purchased لتوثيق سعر الشراء والمورد وتاريخ الشراء ومنفذ الشراء.
- صلاحيات purchase_requests_view و purchase_requests_edit عبر الأدوار و custom_permissions
  و delegatable_permissions وفحوصات الرتب و sudo، وتقييد /state/.
- تسجيل كامل في سجل التدقيق (AuditLog) بالعربية لكل عملية (إضافة، تعديل، شراء، حذف).
"""
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from .models import (
    AuditLog,
    ModelItem,
    PurchaseRequest,
    Role,
    Supplier,
    UserProfile,
    RANK_LEVEL_ONE,
    RANK_LEVEL_THREE,
    RANK_SUDO,
)


def _create_role(name, perms=None, delegatable=None, rank=RANK_LEVEL_THREE):
    return Role.objects.create(
        name=name,
        permissions_json=perms or {},
        delegatable_permissions=delegatable or [],
        rank_level=rank,
    )


def _create_user(username, role=None, custom_perms=None, delegatable=None, rank=RANK_LEVEL_THREE, is_sudo=False):
    user = UserProfile(
        username=username,
        real_name=f"مستخدم {username}",
        role=role,
        custom_permissions=custom_perms or {},
        delegatable_permissions=delegatable or [],
        rank_level=RANK_SUDO if is_sudo else rank,
        is_sudo=is_sudo,
    )
    user.auth_token = f"tok-{username}"
    user.set_password('secret123')
    user.save()
    return user


class PurchaseRequestTests(TestCase):
    def setUp(self):
        self.no_perm_role = _create_role('no-pr', perms={'design_view': True})
        self.view_only_role = _create_role('pr-viewer', perms={'purchase_requests_view': True})
        self.editor_role = _create_role(
            'pr-editor',
            perms={'purchase_requests_view': True, 'purchase_requests_edit': True},
        )
        self.manager_no_delegate_role = _create_role(
            'mgr-no-del',
            perms={'manage_permissions': True, 'manage_users': True, 'purchase_requests_view': True},
            delegatable=['design_view'],
            rank=RANK_LEVEL_ONE,
        )
        self.manager_can_delegate_role = _create_role(
            'mgr-can-del',
            perms={
                'manage_permissions': True,
                'manage_users': True,
                'purchase_requests_view': True,
                'purchase_requests_edit': True,
            },
            delegatable=['purchase_requests_view', 'purchase_requests_edit'],
            rank=RANK_LEVEL_ONE,
        )

        self.sudo_user = _create_user('sudo', is_sudo=True)
        self.no_perm_user = _create_user('outsider', role=self.no_perm_role)
        self.viewer_user = _create_user('viewer', role=self.view_only_role)
        self.editor_user = _create_user('buyer', role=self.editor_role)
        self.custom_editor_user = _create_user(
            'custom_buyer',
            role=self.no_perm_role,
            custom_perms={'purchase_requests_view': True, 'purchase_requests_edit': True},
        )
        self.mgr_no_del = _create_user('mgr1', role=self.manager_no_delegate_role, rank=RANK_LEVEL_ONE)
        self.mgr_can_del = _create_user('mgr2', role=self.manager_can_delegate_role, rank=RANK_LEVEL_ONE)

        self.model = ModelItem.objects.create(model_code='M-505', target_cut_quantity=100)
        self.supplier = Supplier.objects.create(name='مورد الأمل للإكسسوار', phone='01001234567')

    def _client(self, user):
        client = APIClient()
        if user is not None:
            client.credentials(HTTP_AUTHORIZATION=f'Bearer {user.auth_token}')
        return client

    def test_crud_and_empty_image_never_uses_placeholder(self):
        client = self._client(self.editor_user)

        # Create standalone purchase request with NO image and NO Accessory created
        res = client.post(
            '/api/purchase-requests/',
            {
                'item_name': 'سوستة معدن 20 سم',
                'quantity': '150.5',
                'unit': 'قطعة',
                'model_id': self.model.client_id,
                'category': 'إكسسوارات',
                'notes': 'مطلوب قبل يوم الخميس',
            },
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        data = res.data
        self.assertEqual(data['item_name'], 'سوستة معدن 20 سم')
        self.assertEqual(data['image'], '')
        self.assertNotIn('unsplash', data['image'].lower())
        self.assertEqual(data['quantity'], 150.5)
        self.assertEqual(data['unit'], 'قطعة')
        self.assertEqual(data['model_code'], 'M-505')
        self.assertEqual(data['status'], 'pending')
        self.assertIsNone(data['purchased_price'])
        self.assertEqual(data['created_by'], self.editor_user.real_name)

        pr_id = data['id']

        # Update
        upd = client.put(
            f'/api/purchase-requests/{pr_id}/',
            {
                'item_name': 'سوستة معدن 22 سم',
                'quantity': '200',
                'model_code_text': 'M-999-DRAFT',
                'model_id': '',
            },
            format='json',
        )
        self.assertEqual(upd.status_code, status.HTTP_200_OK)
        self.assertEqual(upd.data['item_name'], 'سوستة معدن 22 سم')
        self.assertEqual(upd.data['quantity'], 200.0)
        self.assertEqual(upd.data['model_code'], 'M-999-DRAFT')
        self.assertEqual(upd.data['image'], '')

        # Audit logs recorded for create & update
        create_log = AuditLog.objects.filter(section='طلبات الشراء', action_type='create').first()
        self.assertIsNotNone(create_log)
        self.assertIn('سوستة معدن 20 سم', create_log.details)

        update_log = AuditLog.objects.filter(section='طلبات الشراء', action_type='update').first()
        self.assertIsNotNone(update_log)
        self.assertIn('سوستة معدن 22 سم', update_log.details)

        # Delete
        dele = client.delete(f'/api/purchase-requests/{pr_id}/')
        self.assertEqual(dele.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(PurchaseRequest.objects.filter(client_id=pr_id).exists())

        delete_log = AuditLog.objects.filter(section='طلبات الشراء', action_type='delete').first()
        self.assertIsNotNone(delete_log)
        self.assertIn('سوستة معدن 22 سم', delete_log.details)

    def test_mark_purchased_validation_and_audit_log(self):
        client = self._client(self.editor_user)
        pr = PurchaseRequest.objects.create(
            item_name='زرار خشب طبيعي',
            quantity=500,
            unit='قطعة',
            category='إكسسوارات',
            model_code_text='M-777',
            created_by=self.editor_user.real_name,
        )

        # Missing price -> 400
        bad = client.post(f'/api/purchase-requests/{pr.client_id}/mark_purchased/', {}, format='json')
        self.assertEqual(bad.status_code, status.HTTP_400_BAD_REQUEST)

        # Negative price -> 400
        neg = client.post(
            f'/api/purchase-requests/{pr.client_id}/mark_purchased/',
            {'purchased_price': -10},
            format='json',
        )
        self.assertEqual(neg.status_code, status.HTTP_400_BAD_REQUEST)

        # Valid mark_purchased
        ok = client.post(
            f'/api/purchase-requests/{pr.client_id}/mark_purchased/',
            {
                'purchased_price': '1250.75',
                'supplier_id': self.supplier.client_id,
                'purchase_notes': 'تسليم فوري للمخزن',
            },
            format='json',
        )
        self.assertEqual(ok.status_code, status.HTTP_200_OK)
        self.assertEqual(ok.data['status'], 'purchased')
        self.assertEqual(ok.data['purchased_price'], 1250.75)
        self.assertEqual(ok.data['supplier_id'], self.supplier.client_id)
        self.assertEqual(ok.data['supplier_name'], 'مورد الأمل للإكسسوار')
        self.assertEqual(ok.data['purchase_notes'], 'تسليم فوري للمخزن')
        self.assertEqual(ok.data['purchased_by'], self.editor_user.real_name)
        self.assertTrue(bool(ok.data['purchased_at']))

        # AuditLog includes price & supplier
        log = AuditLog.objects.filter(section='طلبات الشراء', action_type='status_change').first()
        self.assertIsNotNone(log)
        self.assertIn('1250.75', log.details)
        self.assertIn('مورد الأمل للإكسسوار', log.details)

        # Double mark_purchased -> 400
        again = client.post(
            f'/api/purchase-requests/{pr.client_id}/mark_purchased/',
            {'purchased_price': '100'},
            format='json',
        )
        self.assertEqual(again.status_code, status.HTTP_400_BAD_REQUEST)

    def test_permissions_and_state_filtering(self):
        pr = PurchaseRequest.objects.create(item_name='تيكت مقاس', quantity=1000, unit='قطعة')

        # Unauthenticated -> 403
        anon = self._client(None)
        self.assertEqual(anon.get('/api/purchase-requests/').status_code, status.HTTP_403_FORBIDDEN)

        # User without permission -> 403 on endpoint & empty list in /state/
        outsider = self._client(self.no_perm_user)
        self.assertEqual(outsider.get('/api/purchase-requests/').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(
            outsider.post('/api/purchase-requests/', {'item_name': 'x', 'quantity': 1}, format='json').status_code,
            status.HTTP_403_FORBIDDEN,
        )
        state_out = outsider.get('/api/state/')
        self.assertEqual(state_out.status_code, status.HTTP_200_OK)
        self.assertEqual(state_out.data['purchaseRequests'], [])

        # View-only user -> 200 on GET and visible in /state/, 403 on write & mark_purchased
        viewer = self._client(self.viewer_user)
        self.assertEqual(viewer.get('/api/purchase-requests/').status_code, status.HTTP_200_OK)
        self.assertEqual(
            viewer.post('/api/purchase-requests/', {'item_name': 'x', 'quantity': 1}, format='json').status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            viewer.post(
                f'/api/purchase-requests/{pr.client_id}/mark_purchased/',
                {'purchased_price': 50},
                format='json',
            ).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        state_view = viewer.get('/api/state/')
        self.assertEqual(len(state_view.data['purchaseRequests']), 1)

        # Custom permissions override grants edit access
        custom_client = self._client(self.custom_editor_user)
        res = custom_client.post(
            '/api/purchase-requests/',
            {'item_name': 'خيط أوفر أبيض', 'quantity': 20, 'unit': 'بكرة'},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

        # Sudo always succeeds
        sudo_client = self._client(self.sudo_user)
        res_sudo = sudo_client.get('/api/purchase-requests/')
        self.assertEqual(res_sudo.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(res_sudo.data), 2)

    def test_delegatable_permissions_and_rank_checks_for_purchase_requests(self):
        # Manager without purchase_requests in delegatable_permissions cannot grant it
        c_denied = self._client(self.mgr_no_del)
        res_denied = c_denied.post(
            '/api/roles/',
            {
                'name': 'دور مشتريات مرفوض',
                'rank_level': RANK_LEVEL_THREE,
                'permissions': {'purchase_requests_view': True, 'purchase_requests_edit': True},
            },
            format='json',
        )
        self.assertEqual(res_denied.status_code, status.HTTP_403_FORBIDDEN)

        # Manager with purchase_requests in delegatable_permissions can grant it to lower rank
        c_ok = self._client(self.mgr_can_del)
        res_ok = c_ok.post(
            '/api/roles/',
            {
                'name': 'مسؤول مشتريات',
                'rank_level': RANK_LEVEL_THREE,
                'permissions': {'purchase_requests_view': True, 'purchase_requests_edit': True},
            },
            format='json',
        )
        self.assertEqual(res_ok.status_code, status.HTTP_201_CREATED)
        self.assertTrue(res_ok.data['permissions']['purchase_requests_view'])
        self.assertTrue(res_ok.data['permissions']['purchase_requests_edit'])

        # Rank check: Rank 1 manager cannot grant Rank 1 role
        res_rank_denied = c_ok.post(
            '/api/roles/',
            {
                'name': 'دور نفس الرتبة',
                'rank_level': RANK_LEVEL_ONE,
                'permissions': {'purchase_requests_view': True},
            },
            format='json',
        )
        self.assertEqual(res_rank_denied.status_code, status.HTTP_403_FORBIDDEN)
