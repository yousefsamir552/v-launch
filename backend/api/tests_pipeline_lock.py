"""اختبارات قفل المراحل: منع إعادة ترحيل موديل/قطعة غادرت مرحلتها بالفعل،

ومنع ظهور الموديل في قسمين في نفس الوقت عندما تتقدم كل قطعه من مرحلة القص
بينما الحالة العامة ما زالت "في القص".
"""
from django.test import TestCase
from rest_framework import status
from rest_framework.parsers import JSONParser
from rest_framework.request import Request as DRFRequest
from rest_framework.test import APIRequestFactory

from .models import ModelItem, Role, UserProfile, RANK_LEVEL_THREE
from .services import ensure_part_stages
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


class PipelineLockTestBase(TestCase):
    """ينفّذ إجراءات ModelItemViewSet مباشرةً (بدون طبقة الصلاحيات) كما في

    اختبارات الصلاحيات القائمة، مع تمرير user_profile لسجلات التدقيق.
    """

    def setUp(self):
        self.factory = APIRequestFactory()
        role = make_role('pipeline-lock', design_view=True, design_edit=True,
                         cutting_view=True, cutting_edit=True)
        self.user = make_user('pipeline-lock-user', role)

    def _request(self, data=None):
        wsgi_request = self.factory.post('/', data=data or {}, format='json')
        request = DRFRequest(wsgi_request, parsers=[JSONParser()])
        request.user_profile = self.user
        return request

    def _call(self, action, model, data=None):
        model.refresh_from_db()
        view = ModelItemViewSet()
        view.format_kwarg = None
        request = self._request(data)
        view.request = request
        view.kwargs = {'pk': str(model.pk)}
        return getattr(view, action)(request, pk=str(model.pk))


class IssueFabricLockTests(PipelineLockTestBase):
    def test_issue_fabric_rejected_after_leaving_design(self):
        model = ModelItem.objects.create(
            model_code='LOCK-ISSUE-1',
            status='في القص',
            garment_composition='two_pieces',
            part_stages={'shirt': 'cutting', 'pants': 'cutting'},
        )
        response = self._call('issue_fabric_to_cutting', model, {'user_name': 'x'})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('مسبقاً', response.data['error'])
        model.refresh_from_db()
        self.assertEqual(model.status, 'في القص')

    def test_issue_fabric_allowed_while_in_design_and_seeds_cutting_stages(self):
        model = ModelItem.objects.create(
            model_code='LOCK-ISSUE-2',
            status='مرحلة التصميم',
            garment_composition='two_pieces',
        )
        response = self._call('issue_fabric_to_cutting', model, {'user_name': 'x'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        model.refresh_from_db()
        self.assertEqual(model.status, 'في القص')
        self.assertEqual(model.part_stages, {'shirt': 'cutting', 'pants': 'cutting'})


class FinishCuttingLockTests(PipelineLockTestBase):
    def setUp(self):
        super().setUp()
        self.model = ModelItem.objects.create(
            model_code='LOCK-CUT-1',
            status='في القص',
            garment_composition='two_pieces',
            part_stages={'shirt': 'cutting', 'pants': 'cutting'},
        )

    def test_finishing_the_same_part_twice_is_rejected(self):
        response = self._call('finish_cutting', self.model, {'parts': ['shirt']})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.model.refresh_from_db()
        self.assertEqual(self.model.part_stages['shirt'], 'qc_before_print')
        self.assertEqual(self.model.part_stages['pants'], 'cutting')
        # الموديل ما زال في القص لأن البنطلون لم يُقص بعد.
        self.assertEqual(self.model.status, 'في القص')

        response = self._call('finish_cutting', self.model, {'parts': ['shirt']})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.model.refresh_from_db()
        self.assertEqual(self.model.part_stages['shirt'], 'qc_before_print')

    def test_finish_all_only_moves_parts_still_in_cutting(self):
        self._call('finish_cutting', self.model, {'parts': ['shirt']})
        response = self._call('finish_cutting', self.model, {})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.model.refresh_from_db()
        self.assertEqual(
            self.model.part_stages,
            {'shirt': 'qc_before_print', 'pants': 'qc_before_print'},
        )
        self.assertEqual(self.model.status, 'العد قبل الطباعة')

        # كل القطع غادرت القص: أي محاولة جديدة تُرفض.
        response = self._call('finish_cutting', self.model, {})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_part_outside_model_composition_is_rejected_without_touching_stages(self):
        model = ModelItem.objects.create(
            model_code='LOCK-CUT-2',
            status='في القص',
            garment_composition='tshirt_only',
            part_stages={'shirt': 'cutting'},
        )
        response = self._call('finish_cutting', model, {'parts': ['pants']})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        model.refresh_from_db()
        self.assertNotIn('pants', model.part_stages)
        self.assertEqual(model.part_stages['shirt'], 'cutting')


class EnsurePartStagesStatusSyncTests(TestCase):
    def test_status_leaves_cutting_when_every_part_has_advanced(self):
        model = ModelItem.objects.create(
            model_code='LOCK-SYNC-1',
            status='في القص',
            garment_composition='two_pieces',
            part_stages={'shirt': 'qc_before_print', 'pants': 'qc_before_print'},
        )
        ensure_part_stages(model)
        model.refresh_from_db()
        self.assertEqual(model.status, 'العد قبل الطباعة')

    def test_status_stays_in_cutting_while_any_part_is_still_cutting(self):
        model = ModelItem.objects.create(
            model_code='LOCK-SYNC-2',
            status='في القص',
            garment_composition='two_pieces',
            part_stages={'shirt': 'qc_before_print', 'pants': 'cutting'},
        )
        ensure_part_stages(model)
        model.refresh_from_db()
        self.assertEqual(model.status, 'في القص')
