from django.test import TestCase
from rest_framework.test import APIClient

from .models import (
    DEFAULT_UI_PREFERENCES,
    Role,
    UserProfile,
    normalize_ui_preferences,
)


class NavigationPreferencesAndPermissionTests(TestCase):
    def setUp(self):
        self.basic_role = Role.objects.create(
            name='موظف عادي',
            permissions_json={
                'design_view': True,
            },
        )
        self.custom_nav_role = Role.objects.create(
            name='مدير تنقل مخصص',
            permissions_json={
                'design_view': True,
                'customize_navigation': True,
            },
        )
        self.basic_user = UserProfile(
            username='basic_nav_user',
            real_name='موظف تنقل عادي',
            role=self.basic_role,
            role_title=self.basic_role.name,
            auth_token='tok-basic-nav-111',
            is_active=True,
        )
        self.basic_user.set_password('pass1234')
        self.basic_user.save()

        self.privileged_user = UserProfile(
            username='custom_nav_user',
            real_name='مشرف تنقل مخصص',
            role=self.custom_nav_role,
            role_title=self.custom_nav_role.name,
            auth_token='tok-custom-nav-222',
            is_active=True,
        )
        self.privileged_user.set_password('pass1234')
        self.privileged_user.save()

        self.sudo_user = UserProfile(
            username='sudo',
            real_name='حساب الطوارئ',
            role=self.basic_role,
            is_sudo=True,
            is_active=True,
            auth_token='tok-sudo-nav-999',
        )
        self.sudo_user.set_password('sudopass123')
        self.sudo_user.save()

    def _client_for(self, token):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        return client

    def test_customize_navigation_defaults_false_and_sudo_always_has_it(self):
        self.assertIn('customize_navigation', self.basic_role.get_permissions_dict())
        self.assertFalse(self.basic_role.get_permissions_dict()['customize_navigation'])
        self.assertFalse(self.basic_user.has_perm('customize_navigation'))
        self.assertTrue(self.privileged_user.has_perm('customize_navigation'))
        self.assertTrue(self.sudo_user.has_perm('customize_navigation'))

    def test_default_ui_preferences_returned_in_me_endpoint(self):
        client = self._client_for(self.basic_user.auth_token)
        res = client.get('/api/auth/me/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['user']['ui_preferences'], DEFAULT_UI_PREFERENCES)

    def test_any_authenticated_user_can_toggle_sidebar_collapsed(self):
        client = self._client_for(self.basic_user.auth_token)
        res = client.post(
            '/api/auth/update_profile/',
            {'ui_preferences': {'sidebar_collapsed': True}},
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['user']['ui_preferences']['sidebar_collapsed'])
        self.assertEqual(res.data['user']['ui_preferences']['nav_mode'], 'sidebar')
        self.assertTrue(res.data['user']['ui_preferences']['accordion_mode'])
        self.assertIsNone(res.data['user']['ui_preferences']['cards_layout'])

        self.basic_user.refresh_from_db()
        self.assertTrue(normalize_ui_preferences(self.basic_user.ui_preferences)['sidebar_collapsed'])

        # Re-expanding also works
        res2 = client.post(
            '/api/auth/update_profile/',
            {'ui_preferences': {'sidebar_collapsed': False}},
            format='json',
        )
        self.assertEqual(res2.status_code, 200)
        self.assertFalse(res2.data['user']['ui_preferences']['sidebar_collapsed'])

    def test_user_without_customize_navigation_rejected_403_for_restricted_ui_prefs(self):
        client = self._client_for(self.basic_user.auth_token)
        restricted_payloads = (
            {'ui_preferences': {'nav_mode': 'cards'}},
            {'ui_preferences': {'accordion_mode': False}},
            {
                'ui_preferences': {
                    'cards_layout': {
                        'version': 1,
                        'groups': [{'id': 'g1', 'title': 'يومي', 'items': []}],
                    }
                }
            },
            {'ui_preferences': {'sidebar_collapsed': True, 'nav_mode': 'cards'}},
        )
        for payload in restricted_payloads:
            res = client.post('/api/auth/update_profile/', payload, format='json')
            self.assertEqual(res.status_code, 403, f'Expected 403 for {payload}')

        self.basic_user.refresh_from_db()
        self.assertEqual(normalize_ui_preferences(self.basic_user.ui_preferences), DEFAULT_UI_PREFERENCES)

    def test_user_with_customize_navigation_can_update_all_ui_preferences(self):
        client = self._client_for(self.privileged_user.auth_token)
        sample_layout = {
            'version': 1,
            'groups': [
                {
                    'id': 'grp-daily',
                    'title': 'شغلي اليومي',
                    'items': [
                        {'kind': 'card', 'id': 'card-dashboard', 'tabId': 'dashboard'},
                        {'kind': 'spacer', 'id': 'spacer-1'},
                        {'kind': 'card', 'id': 'card-design', 'tabId': 'design'},
                        {'kind': 'divider', 'id': 'divider-1', 'label': 'المخازن'},
                    ],
                }
            ],
        }
        res = client.post(
            '/api/auth/update_profile/',
            {
                'ui_preferences': {
                    'nav_mode': 'cards',
                    'sidebar_collapsed': True,
                    'accordion_mode': False,
                    'cards_layout': sample_layout,
                }
            },
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        prefs = res.data['user']['ui_preferences']
        self.assertEqual(prefs['nav_mode'], 'cards')
        self.assertTrue(prefs['sidebar_collapsed'])
        self.assertFalse(prefs['accordion_mode'])
        self.assertEqual(prefs['cards_layout'], sample_layout)

        # Verify persistence across /api/auth/me/
        me_res = client.get('/api/auth/me/')
        self.assertEqual(me_res.status_code, 200)
        self.assertEqual(me_res.data['user']['ui_preferences'], prefs)

        # Reset cards_layout to None
        reset_res = client.post(
            '/api/auth/update_profile/',
            {'ui_preferences': {'cards_layout': None}},
            format='json',
        )
        self.assertEqual(reset_res.status_code, 200)
        self.assertIsNone(reset_res.data['user']['ui_preferences']['cards_layout'])
        self.assertEqual(reset_res.data['user']['ui_preferences']['nav_mode'], 'cards')

    def test_user_with_custom_permission_override_can_customize_navigation(self):
        self.basic_user.custom_permissions = {'customize_navigation': True}
        self.basic_user.save(update_fields=['custom_permissions'])
        client = self._client_for(self.basic_user.auth_token)
        res = client.post(
            '/api/auth/update_profile/',
            {'ui_preferences': {'nav_mode': 'cards', 'accordion_mode': False}},
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['user']['ui_preferences']['nav_mode'], 'cards')
        self.assertFalse(res.data['user']['ui_preferences']['accordion_mode'])

    def test_sudo_can_always_customize_navigation(self):
        client = self._client_for(self.sudo_user.auth_token)
        res = client.post(
            '/api/auth/update_profile/',
            {'ui_preferences': {'nav_mode': 'cards', 'accordion_mode': False}},
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['user']['ui_preferences']['nav_mode'], 'cards')

    def test_validation_rejects_invalid_ui_preferences_payloads(self):
        client = self._client_for(self.privileged_user.auth_token)
        res_bad_root = client.post(
            '/api/auth/update_profile/',
            {'ui_preferences': 'invalid'},
            format='json',
        )
        self.assertEqual(res_bad_root.status_code, 400)

        res_bad_mode = client.post(
            '/api/auth/update_profile/',
            {'ui_preferences': {'nav_mode': 'top_bar'}},
            format='json',
        )
        self.assertEqual(res_bad_mode.status_code, 400)

        res_bad_layout = client.post(
            '/api/auth/update_profile/',
            {'ui_preferences': {'cards_layout': ['not', 'a', 'dict']}},
            format='json',
        )
        self.assertEqual(res_bad_layout.status_code, 400)

    def test_role_creation_and_delegation_for_customize_navigation(self):
        sudo_client = self._client_for(self.sudo_user.auth_token)
        res = sudo_client.post(
            '/api/roles/',
            {
                'name': 'دور مخصص للتنقل',
                'description': 'يمكنه تخصيص الواجهة والتنقل وتفويضها',
                'permissions': {'customize_navigation': True},
                'delegatable_permissions': ['customize_navigation'],
                'rank_level': 2,
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        self.assertTrue(res.data['permissions']['customize_navigation'])
        self.assertIn('customize_navigation', res.data['delegatable_permissions'])
