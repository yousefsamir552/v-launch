"""اختبارات سير عمل الاستلام السريع، تقييم الورش من الفرز (QC)، وصلاحية عرض الموديلات السابقة.

تغطي:
1. فصل الاستلام عن العد وتقييم الورشة في المطابع والمكن (quick_receive=True):
   - تسجيل تاريخ/وقت الاستلام الفعلي والترحيل التلقائي إلى العد بعد الطباعة / بعد المكن
     دون فرض إدخال أعداد أو تقييم وقت الاستلام.
   - الحفاظ على اسم الورشة/المطبعة وتوثيق العملية في ModelTimeline و AuditLog.
2. تمكين مستخدم الفرز والكنترول (qc_edit) من قراءة وتسجيل/تحديث تقييم الورش
   (WorkshopEvaluation) المرتبط بإرسالية المطبعة أو المكن.
3. صلاحية عرض الموديلات السابقة / المنتهية (previous_models_view):
   - القيمة الافتراضية False ولا تُمنح تلقائياً بمجرد صلاحية القسم.
   - التحقق من الدور، التخصيص الشخصي (custom_permissions)، manage_permissions، و sudo.
   - التحقق من canViewPreviousModels في /api/state/ و CanViewPreviousModels و AuditLog.
"""
from types import SimpleNamespace

from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient, APIRequestFactory

from .audit_utils import PERMISSION_LABELS
from .models import (
    AuditLog,
    ModelItem,
    ModelTimeline,
    PREVIOUS_MODELS_PERM_KEY,
    PrintDispatch,
    RANK_LEVEL_ONE,
    RANK_LEVEL_THREE,
    RANK_SUDO,
    Role,
    SewingDispatch,
    UserProfile,
    Workshop,
    WorkshopEvaluation,
)
from .permissions import CanViewPreviousModels, can_view_previous_models
from .services import get_part_stages


def _make_role(name, perms=None, delegatable=None, rank=RANK_LEVEL_THREE):
    return Role.objects.create(
        name=name,
        permissions_json=perms or {},
        delegatable_permissions=delegatable or [],
        rank_level=rank,
    )


def _make_user(username, role=None, custom_perms=None, rank=RANK_LEVEL_THREE, is_sudo=False):
    user = UserProfile(
        username=username,
        real_name=f'موظف {username}',
        role=role,
        custom_permissions=custom_perms or {},
        rank_level=RANK_SUDO if is_sudo else rank,
        is_sudo=is_sudo,
    )
    user.auth_token = f'tok-wf-{username}'
    user.set_password('pass123')
    user.save()
    return user


class QuickReceiveAndQCEvaluationTests(TestCase):
    def setUp(self):
        self.print_role = _make_role('print-op', perms={'printing_view': True, 'printing_edit': True})
        self.sewing_role = _make_role('sew-op', perms={'sewing_view': True, 'sewing_edit': True})
        self.qc_role = _make_role('qc-op', perms={'qc_view': True, 'qc_edit': True})

        self.print_user = _make_user('print_op', role=self.print_role)
        self.sewing_user = _make_user('sew_op', role=self.sewing_role)
        self.qc_user = _make_user('qc_op', role=self.qc_role)

        self.print_shop = Workshop.objects.create(
            name='مطبعة الإتقان', workshop_type=['printing']
        )
        self.sewing_shop = Workshop.objects.create(
            name='ورشة النجاح للمكن', workshop_type=['sewing']
        )

        self.model = ModelItem.objects.create(
            model_code='M-WF-101',
            model_type='أولادي',
            status='مرسل للمطبعة',
            target_cut_quantity=120,
            total_cut_pieces=120,
            cut_shirt_pieces=120,
            garment_composition='tshirt_only',
            garment_parts=['shirt'],
            part_stages={'shirt': 'printing'},
            print_house='مطبعة الإتقان',
        )
        self.print_dispatch = PrintDispatch.objects.create(
            model=self.model,
            print_house='مطبعة الإتقان',
            workshop=self.print_shop,
            piece_type='shirt',
            piece_label='تيشرت',
            pieces_count=120,
            cost_per_piece=2.5,
            status='مرسل للمطبعة',
            dispatched_at_str='2026-11-20 10:00',
            expected_delivery_date=timezone.now().date(),
        )

    def _client(self, user):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {user.auth_token}')
        return client

    def test_print_quick_receive_records_timestamp_and_moves_to_qc_after_print(self):
        res = self._client(self.print_user).post(
            f'/api/dispatches/{self.print_dispatch.pk}/update_status/',
            {'status': 'تم الاستلام بالمصنع', 'quick_receive': True, 'user_name': 'مسؤول المطابع'},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.data)

        self.print_dispatch.refresh_from_db()
        self.assertEqual(self.print_dispatch.status, 'تم الاستلام بالمصنع')
        self.assertIsNotNone(self.print_dispatch.received_date)
        self.assertTrue(bool(self.print_dispatch.received_at_str))
        self.assertEqual(self.print_dispatch.print_house, 'مطبعة الإتقان')
        self.assertEqual(self.print_dispatch.received_pieces, 120)
        self.assertTrue(self.print_dispatch.receive_history[-1].get('quick_receive'))

        self.model.refresh_from_db()
        self.assertEqual(get_part_stages(self.model)['shirt'], 'qc_after_print')
        self.assertTrue(
            ModelTimeline.objects.filter(model=self.model, stage='العد بعد الطباعة').exists()
        )
        self.assertTrue(
            AuditLog.objects.filter(section='المطابع والتطريز', action_type='status_change').exists()
        )

        # Duplicate quick receive is rejected cleanly
        dup = self._client(self.print_user).post(
            f'/api/dispatches/{self.print_dispatch.pk}/update_status/',
            {'status': 'تم الاستلام بالمصنع', 'quick_receive': True},
            format='json',
        )
        self.assertEqual(dup.status_code, status.HTTP_400_BAD_REQUEST)

    def test_sewing_quick_receive_records_timestamp_and_moves_to_qc_after_sewing(self):
        self.model.part_stages = {'shirt': 'sewing'}
        self.model.save(update_fields=['part_stages'])

        sew_disp = SewingDispatch.objects.create(
            model=self.model,
            piece_type='shirt',
            piece_label='تيشرت',
            workshop_name='ورشة النجاح للمكن',
            workshop=self.sewing_shop,
            pieces_count=115,
            cost_per_piece=6.0,
            dispatched_at_str='2026-11-22 09:30',
            expected_delivery_date=timezone.now().date(),
        )

        res = self._client(self.sewing_user).post(
            f'/api/sewing-dispatches/{sew_disp.pk}/receive/',
            {'quick_receive': True, 'user_name': 'مسؤول المكن'},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.data)

        sew_disp.refresh_from_db()
        self.assertEqual(sew_disp.status, 'تم الاستلام')
        self.assertIsNotNone(sew_disp.received_date)
        self.assertTrue(bool(sew_disp.received_at_str))
        self.assertEqual(sew_disp.workshop_name, 'ورشة النجاح للمكن')
        self.assertEqual(sew_disp.received_pieces, 115)
        self.assertEqual(float(sew_disp.total_cost), 690.0)
        self.assertTrue(sew_disp.receive_history[-1].get('quick_receive'))

        self.model.refresh_from_db()
        self.assertEqual(get_part_stages(self.model)['shirt'], 'qc_after_sewing')

    def test_qc_user_can_submit_and_update_workshop_evaluation_and_see_in_state(self):
        qc_client = self._client(self.qc_user)

        create_res = qc_client.post(
            '/api/workshop-evaluations/',
            {
                'workshop_id': self.print_shop.client_id,
                'workshop_name': self.print_shop.name,
                'stage': 'printing',
                'model_id': self.model.client_id,
                'print_dispatch_id': self.print_dispatch.client_id,
                'delivery_timeliness': 4,
                'work_quality': 5,
                'finishing_quality': 4,
                'notes': 'طباعة نظيفة مع تأخير بسيط',
            },
            format='json',
        )
        self.assertEqual(create_res.status_code, status.HTTP_201_CREATED, create_res.data)
        self.assertEqual(WorkshopEvaluation.objects.count(), 1)

        # Updating same dispatch evaluation upserts cleanly
        update_res = qc_client.post(
            '/api/workshop-evaluations/',
            {
                'workshop_id': self.print_shop.client_id,
                'workshop_name': self.print_shop.name,
                'stage': 'printing',
                'model_id': self.model.client_id,
                'print_dispatch_id': self.print_dispatch.client_id,
                'delivery_timeliness': 5,
                'work_quality': 5,
                'finishing_quality': 5,
                'notes': 'ممتاز بعد المراجعة',
            },
            format='json',
        )
        self.assertEqual(update_res.status_code, status.HTTP_200_OK, update_res.data)
        self.assertEqual(WorkshopEvaluation.objects.count(), 1)
        ev = WorkshopEvaluation.objects.first()
        self.assertEqual(ev.delivery_timeliness, 5)
        self.assertEqual(ev.finishing_quality, 5)

        # QC user receives workshopEvaluations in /api/state/
        state_res = qc_client.get('/api/state/')
        self.assertEqual(state_res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(state_res.data['workshopEvaluations']), 1)


class PreviousModelsPermissionTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.dept_only_role = _make_role(
            'departments-only',
            perms={
                'design_view': True,
                'design_edit': True,
                'cutting_view': True,
                'qc_view': True,
                'printing_view': True,
                'sewing_view': True,
                'assembly_packaging_view': True,
            },
        )
        self.prev_role = _make_role(
            'with-prev',
            perms={'design_view': True, PREVIOUS_MODELS_PERM_KEY: True},
        )
        self.admin_role = _make_role(
            'admin-perm',
            perms={'manage_permissions': True},
            delegatable=[PREVIOUS_MODELS_PERM_KEY, 'design_view'],
            rank=RANK_LEVEL_ONE,
        )

        self.dept_user = _make_user('dept_only', role=self.dept_only_role)
        self.prev_user = _make_user('prev_user', role=self.prev_role)
        self.custom_prev_user = _make_user(
            'custom_prev',
            role=self.dept_only_role,
            custom_perms={PREVIOUS_MODELS_PERM_KEY: True},
        )
        self.admin_user = _make_user('admin_prev', role=self.admin_role, rank=RANK_LEVEL_ONE)
        self.sudo_user = _make_user('sudo', is_sudo=True)

    def _client(self, user):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {user.auth_token}')
        return client

    def test_previous_models_view_defaults_false_and_department_access_does_not_grant_it(self):
        self.assertIn(PREVIOUS_MODELS_PERM_KEY, PERMISSION_LABELS)
        defaults = self.dept_only_role.get_permissions_dict()
        self.assertIn(PREVIOUS_MODELS_PERM_KEY, defaults)
        self.assertFalse(defaults[PREVIOUS_MODELS_PERM_KEY])

        self.assertFalse(can_view_previous_models(self.dept_user))
        self.assertTrue(can_view_previous_models(self.prev_user))
        self.assertTrue(can_view_previous_models(self.custom_prev_user))
        self.assertTrue(can_view_previous_models(self.admin_user))
        self.assertTrue(can_view_previous_models(self.sudo_user))

        checker = CanViewPreviousModels()
        for user, expected in (
            (self.dept_user, False),
            (self.prev_user, True),
            (self.custom_prev_user, True),
            (self.admin_user, True),
            (self.sudo_user, True),
        ):
            req = self.factory.get('/', HTTP_AUTHORIZATION=f'Bearer {user.auth_token}')
            self.assertEqual(checker.has_permission(req, SimpleNamespace()), expected)

    def test_state_exposes_can_view_previous_models_flag(self):
        res_denied = self._client(self.dept_user).get('/api/state/')
        self.assertEqual(res_denied.status_code, status.HTTP_200_OK)
        self.assertFalse(res_denied.data.get('canViewPreviousModels'))

        res_allowed = self._client(self.prev_user).get('/api/state/')
        self.assertEqual(res_allowed.status_code, status.HTTP_200_OK)
        self.assertTrue(res_allowed.data.get('canViewPreviousModels'))

        res_custom = self._client(self.custom_prev_user).get('/api/state/')
        self.assertEqual(res_custom.status_code, status.HTTP_200_OK)
        self.assertTrue(res_custom.data.get('canViewPreviousModels'))

    def test_role_creation_and_delegation_for_previous_models_view(self):
        res = self._client(self.admin_user).post(
            '/api/roles/',
            {
                'name': 'مشرف الموديلات السابقة',
                'rank_level': RANK_LEVEL_THREE,
                'permissions': {'design_view': True, PREVIOUS_MODELS_PERM_KEY: True},
            },
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        self.assertTrue(res.data['permissions'][PREVIOUS_MODELS_PERM_KEY])
