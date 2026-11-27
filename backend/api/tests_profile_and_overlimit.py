from django.test import TestCase
from rest_framework.test import APIClient

from .models import ModelItem, PrintDispatch, Role, UserProfile


class ProfileAndPrintOverLimitTests(TestCase):
    def setUp(self):
        self.role = Role.objects.create(
            name='مشرف إنتاج',
            permissions_json={
                'printing_view': True,
                'printing_edit': True,
                'qc_view': True,
                'qc_edit': True,
            },
        )
        self.user = UserProfile(
            username='emp_profile',
            real_name='أحمد محمد',
            phone='01011111111',
            role=self.role,
            role_title=self.role.name,
            auth_token='tok-emp-profile-123',
            is_active=True,
        )
        self.user.set_password('oldpass123')
        self.user.save()

        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION='Bearer tok-emp-profile-123')

    def test_update_profile_allows_safe_fields_and_password_change(self):
        res = self.client.post(
            '/api/auth/update_profile/',
            {
                'real_name': 'أحمد علي',
                'phone': '01099999999',
                'avatar': 'https://cdn.example.com/avatars/emp.jpg',
                'current_password': 'oldpass123',
                'new_password': 'newpass456',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['user']['real_name'], 'أحمد علي')
        self.assertEqual(res.data['user']['phone'], '01099999999')
        self.assertEqual(res.data['user']['avatar'], 'https://cdn.example.com/avatars/emp.jpg')

        self.user.refresh_from_db()
        self.assertEqual(self.user.real_name, 'أحمد علي')
        self.assertEqual(self.user.phone, '01099999999')
        self.assertEqual(self.user.avatar, 'https://cdn.example.com/avatars/emp.jpg')
        self.assertTrue(self.user.check_password('newpass456'))
        self.assertFalse(self.user.check_password('oldpass123'))

    def test_update_profile_rejects_wrong_current_password(self):
        res = self.client.post(
            '/api/auth/update_profile/',
            {
                'current_password': 'wrong',
                'new_password': 'newpass456',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('oldpass123'))

    def test_update_profile_blocks_privilege_escalation_fields(self):
        for forbidden_payload in (
            {'is_sudo': True},
            {'rank_level': 0},
            {'role': 'مدير عام المصنع'},
            {'permissions': {'manage_permissions': True}},
            {'is_active': False},
        ):
            res = self.client.post('/api/auth/update_profile/', forbidden_payload, format='json')
            self.assertEqual(res.status_code, 403, f'Expected 403 for {forbidden_payload}')
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_sudo)
        self.assertTrue(self.user.is_active)

    def test_update_profile_requires_authentication(self):
        anon = APIClient()
        res = anon.post('/api/auth/update_profile/', {'real_name': 'Hacker'}, format='json')
        self.assertEqual(res.status_code, 403)

    def test_print_dispatch_over_limit_rejected_by_default_and_allowed_with_flag(self):
        model = ModelItem.objects.create(
            model_code='M-OVER-1',
            status='في المطابع',
            garment_composition='two_pieces',
            garment_parts=['shirt', 'pants'],
            part_stages={'shirt': 'printing', 'pants': 'cutting'},
            total_cut_pieces=100,
            cut_shirt_pieces=100,
            cut_pants_pieces=100,
        )

        # Without allow_over_limit -> rejected (400)
        res_denied = self.client.post(
            '/api/dispatches/',
            {
                'model_id': str(model.id),
                'shop_name': 'مطبعة النور',
                'pieces_count': 120,
                'piece_type': 'shirt',
            },
            format='json',
        )
        self.assertEqual(res_denied.status_code, 400)
        self.assertEqual(PrintDispatch.objects.filter(model=model).count(), 0)

        # With allow_over_limit=True -> accepted (201)
        res_allowed = self.client.post(
            '/api/dispatches/',
            {
                'model_id': str(model.id),
                'shop_name': 'مطبعة النور',
                'pieces_count': 120,
                'piece_type': 'shirt',
                'allow_over_limit': True,
            },
            format='json',
        )
        self.assertEqual(res_allowed.status_code, 201)
        self.assertEqual(PrintDispatch.objects.filter(model=model, pieces_count=120).count(), 1)
