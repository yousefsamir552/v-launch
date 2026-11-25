"""اختبارات صلاحيات «جاهزية الموديلات» الست المستقلة:
- readiness_print / readiness_sewing / readiness_finishing /
  readiness_ironing / readiness_packaging / readiness_dest
- الاستقلالية التامة لكل مرحلة عبر الدور أو custom_permissions.
- التحقق من فئة CanAccessModelReadiness وتجاوز sudo.
- التحقق من delegatable_permissions وقواعد الرتب الهرمية.
- تصفية /api/state/ بحيث يحصل حامل أي صلاحية جاهزية على بيانات الموديلات التشغيلية
  مع استمرار إخفاء الأسعار المالية والأقسام غير المخوّل بها.
- تسجيل إجراءات الطباعة والتصدير والإجراءات السريعة في AuditLog.
"""
from types import SimpleNamespace

from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient, APIRequestFactory

from .models import (
    AuditLog,
    Fabric,
    ModelItem,
    PrintDispatch,
    PurchaseRequest,
    READINESS_PERM_KEYS,
    Role,
    UserProfile,
    RANK_LEVEL_ONE,
    RANK_LEVEL_THREE,
    RANK_SUDO,
)
from .permissions import CanAccessModelReadiness, READINESS_STAGE_PERM_MAP


def _make_role(name, perms=None, delegatable=None, rank=RANK_LEVEL_THREE):
    return Role.objects.create(
        name=name,
        permissions_json=perms or {},
        delegatable_permissions=delegatable or [],
        rank_level=rank,
    )


def _make_user(username, role=None, custom_perms=None, delegatable=None, rank=RANK_LEVEL_THREE, is_sudo=False):
    user = UserProfile(
        username=username,
        real_name=f"موظف {username}",
        role=role,
        custom_permissions=custom_perms or {},
        delegatable_permissions=delegatable or [],
        rank_level=RANK_SUDO if is_sudo else rank,
        is_sudo=is_sudo,
    )
    user.auth_token = f"tok-r-{username}"
    user.set_password('pass123')
    user.save()
    return user


class ModelReadinessPermissionsTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.empty_role = _make_role('empty-role')
        self.sudo_user = _make_user('sudo', is_sudo=True)
        self.plain_user = _make_user('plain', role=self.empty_role)
        self.model = ModelItem.objects.create(model_code='M-RD-1', model_type='بناتي', target_cut_quantity=80)
        self.dispatch = PrintDispatch.objects.create(
            model=self.model, print_house='مطبعة السلام', pieces_count=80, cost_per_piece=4.5
        )
        self.fabric = Fabric.objects.create(name='سنجل ليكرا')
        self.pr = PurchaseRequest.objects.create(item_name='زرار ذهبي', quantity=50)

    def _client(self, user):
        client = APIClient()
        if user is not None:
            client.credentials(HTTP_AUTHORIZATION=f'Bearer {user.auth_token}')
        return client

    def test_all_six_readiness_keys_default_false_and_are_strictly_independent(self):
        self.assertEqual(len(READINESS_PERM_KEYS), 6)
        defaults = self.empty_role.get_permissions_dict()
        for key in READINESS_PERM_KEYS:
            self.assertIn(key, defaults)
            self.assertFalse(defaults[key])

        perm_checker = CanAccessModelReadiness()
        for stage, expected_key in READINESS_STAGE_PERM_MAP.items():
            role = _make_role(f'role-{stage}', perms={expected_key: True})
            user = _make_user(f'u-{stage}', role=role)

            for check_stage, check_key in READINESS_STAGE_PERM_MAP.items():
                req = self.factory.get('/', HTTP_AUTHORIZATION=f'Bearer {user.auth_token}')
                view = SimpleNamespace(required_readiness_stage=check_stage)
                allowed = perm_checker.has_permission(req, view)
                if check_key == expected_key:
                    self.assertTrue(allowed, f"{expected_key} should allow stage {check_stage}")
                else:
                    self.assertFalse(allowed, f"{expected_key} must NOT allow stage {check_stage}")

            # Sudo bypasses all stages
            sudo_req = self.factory.get('/', HTTP_AUTHORIZATION=f'Bearer {self.sudo_user.auth_token}')
            self.assertTrue(
                perm_checker.has_permission(sudo_req, SimpleNamespace(required_readiness_stage=stage))
            )

    def test_custom_permissions_override_and_state_visibility_without_price_leak(self):
        # User with NO readiness permissions sees empty models in /state/
        res_plain = self._client(self.plain_user).get('/api/state/')
        self.assertEqual(res_plain.status_code, status.HTTP_200_OK)
        self.assertEqual(res_plain.data['models'], [])

        # User with ONLY readiness_print via custom_permissions sees models & dispatches,
        # but prices stay None and unrelated sections stay empty.
        readiness_user = _make_user(
            'ready_print_only',
            role=self.empty_role,
            custom_perms={'readiness_print': True},
        )
        res = self._client(readiness_user).get('/api/state/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res.data['models']), 1)
        self.assertEqual(len(res.data['printDispatches']), 1)
        self.assertIsNone(res.data['printDispatches'][0]['cost_per_piece'])
        self.assertEqual(res.data['fabrics'], [])
        self.assertEqual(res.data['purchaseRequests'], [])

    def test_delegatable_permissions_and_audit_logging_for_readiness(self):
        mgr_no_del = _make_user(
            'rmgr1',
            role=_make_role(
                'rmgr1-role',
                perms={'manage_permissions': True, 'readiness_print': True},
                delegatable=['readiness_print'],
                rank=RANK_LEVEL_ONE,
            ),
            rank=RANK_LEVEL_ONE,
        )
        client = self._client(mgr_no_del)

        # Trying to delegate readiness_dest (not in delegatable) -> 403
        denied = client.post(
            '/api/roles/',
            {
                'name': 'دور جاهزية مرفوض',
                'rank_level': RANK_LEVEL_THREE,
                'permissions': {'readiness_dest': True},
            },
            format='json',
        )
        self.assertEqual(denied.status_code, status.HTTP_403_FORBIDDEN)

        # Delegating readiness_print (in delegatable) to lower rank -> 201
        ok = client.post(
            '/api/roles/',
            {
                'name': 'مشرف جاهزية المطابع',
                'rank_level': RANK_LEVEL_THREE,
                'permissions': {'readiness_print': True},
            },
            format='json',
        )
        self.assertEqual(ok.status_code, status.HTTP_201_CREATED)
        self.assertTrue(ok.data['permissions']['readiness_print'])
        self.assertFalse(ok.data['permissions']['readiness_sewing'])

        # Client action AuditLog recording (print / export / quick jump from readiness)
        audit_res = client.post(
            '/api/audit-logs/client-action/',
            {
                'section': 'جاهزية الموديلات',
                'action_type': 'export',
                'target_name': 'جاهزية الموديلات — المطابع',
                'details': 'تصدير شيت جاهزية الموديلات لمرحلة المطابع',
            },
            format='json',
        )
        self.assertEqual(audit_res.status_code, status.HTTP_201_CREATED)
        self.assertTrue(
            AuditLog.objects.filter(section='جاهزية الموديلات', action_type='export').exists()
        )
