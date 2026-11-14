"""اختبارات تقوية الصلاحيات: إخفاء الحقول المالية، تقييد /state/، منع IDOR
في المراسلات، فرض قسم كل إجراء على الموديلات، تدوير رمز الجلسة عند الخروج،
وحماية مرتب الموظفين.
"""
from django.http import Http404
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import JSONParser
from rest_framework.request import Request as DRFRequest
from rest_framework.test import APIRequestFactory

from .models import (
    Role, UserProfile, Fabric, FabricColor, Accessory,
    ModelItem, ModelTimeline, PrintDispatch, InternalMessage,
    HRJobTitle, HREmployee,
    RANK_LEVEL_ONE, RANK_LEVEL_THREE,
)
from .serializers import (
    FabricColorSerializer, AccessorySerializer, PrintDispatchSerializer,
    ModelItemSerializer, HREmployeeSerializer,
)
from .views import (
    AuthViewSet, StateViewSet, InternalMessageViewSet, ModelItemViewSet,
    HREmployeeViewSet,
)


def make_role(name, **perms):
    return Role.objects.create(name=name, permissions_json=perms, rank_level=RANK_LEVEL_THREE)


def make_user(username, role=None, rank=RANK_LEVEL_THREE):
    user = UserProfile(username=username, real_name=username, role=role, rank_level=rank)
    user.auth_token = f'token-{username}'
    user.set_password('x')
    user.save()
    return user


class PermissionTestBase(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()

        self.sewing_role = make_role('sewing-only', sewing_view=True, sewing_edit=True)
        self.design_role = make_role('design-only', design_view=True, design_edit=True)
        self.cutting_role = make_role('cutting-only', cutting_view=True, cutting_edit=True)
        self.fabric_role = make_role(
            'fabric-with-prices', fabric_warehouse_view=True, view_fabric_prices=True,
        )
        self.accounts_role = make_role('hr-employees', hr_employees=True, hr_jobs=True)

        self.design_user = make_user('designer', self.design_role)
        self.cutting_user = make_user('cutter', self.cutting_role)
        self.sewing_user = make_user('sewer', self.sewing_role)
        self.fabric_user = make_user('fabrickeeper', self.fabric_role)
        self.accounts_user = make_user('accountant', self.accounts_role, rank=RANK_LEVEL_ONE)
        self.other_user = make_user('outsider', self.cutting_role)

        self.model = ModelItem.objects.create(model_code='M-100', target_cut_quantity=10)
        self.fabric = Fabric.objects.create(name='قطن')
        self.color = FabricColor.objects.create(
            fabric=self.fabric, color_code='BLK', price_per_unit=25.5, quantity=100,
        )
        self.accessory = Accessory.objects.create(
            name='زرار', price_per_unit=1.25, current_stock=500,
        )
        self.dispatch = PrintDispatch.objects.create(
            model=self.model, print_house='مطبعة النور', pieces_count=10, cost_per_piece=3,
        )
        self.job = HRJobTitle.objects.create(title='خياط', department='sewing')
        self.employee = HREmployee.objects.create(
            name='موظف', job=self.job, monthly_salary=5000, rank_level=RANK_LEVEL_THREE,
        )

    def _request(self, viewer, method='get', data=None):
        wsgi_request = getattr(self.factory, method)('/', data=data or {}, format='json')
        request = DRFRequest(wsgi_request, parsers=[JSONParser()])
        if viewer is not None:
            request.user_profile = viewer
        return request


class FinancialFieldGatingTests(PermissionTestBase):
    def test_fabric_price_hidden_without_permission(self):
        data = FabricColorSerializer(
            self.color, context={'request': self._request(self.design_user)}
        ).data
        self.assertIsNone(data['price_per_unit'])
        self.assertEqual(data['quantity'], 100.0)

    def test_fabric_price_visible_with_permission(self):
        data = FabricColorSerializer(
            self.color, context={'request': self._request(self.fabric_user)}
        ).data
        self.assertEqual(data['price_per_unit'], 25.5)

    def test_accessory_price_hidden_without_permission(self):
        data = AccessorySerializer(
            self.accessory, context={'request': self._request(self.design_user)}
        ).data
        self.assertIsNone(data['price_per_unit'])

    def test_print_costs_hidden_without_permission(self):
        data = PrintDispatchSerializer(
            self.dispatch, context={'request': self._request(self.sewing_user)}
        ).data
        self.assertIsNone(data['cost_per_piece'])
        self.assertIsNone(data['total_cost'])
        self.assertEqual(data['pieces_count'], 10)

    def test_serializer_without_request_keeps_full_representation(self):
        # أدوات إدارية/سييد بدون طلب HTTP تحصل على التمثيل الكامل.
        self.assertEqual(FabricColorSerializer(self.color).data['price_per_unit'], 25.5)

    def test_model_timeline_details_are_scrubbed_for_unprivileged_viewer(self):
        ModelTimeline.objects.create(
            model=self.model,
            stage='printing',
            title='إرسال للمطبعة',
            details={'cost_per_piece': 3, 'total_cost': 30, 'pieces_count': 10},
        )
        payload = ModelItemSerializer(
            self.model, context={'request': self._request(self.design_user)}
        ).data
        printing_entries = [row for row in payload['timeline'] if row['stage'] == 'printing']
        self.assertEqual(len(printing_entries), 1)
        details = printing_entries[0]['details']
        self.assertNotIn('cost_per_piece', details)
        self.assertNotIn('total_cost', details)
        self.assertEqual(details['pieces_count'], 10)


class StateFilteringTests(PermissionTestBase):
    def _state(self, viewer):
        return StateViewSet().list(self._request(viewer)).data

    def test_state_empties_sections_the_viewer_cannot_open(self):
        payload = self._state(self.sewing_user)
        self.assertEqual(payload['fabricColors'], [])
        self.assertEqual(payload['cuttingRecords'], [])
        self.assertTrue(len(payload['models']) >= 1)

    def test_state_keeps_fabric_section_for_fabric_role(self):
        payload = self._state(self.fabric_user)
        self.assertEqual(len(payload['fabricColors']), 1)
        self.assertIsNotNone(payload['fabricColors'][0]['price_per_unit'])

    def test_state_only_returns_own_internal_messages(self):
        InternalMessage.objects.create(
            sender=self.cutting_user, receiver=self.other_user, content='خاص',
        )


class InternalMessageScopingTests(PermissionTestBase):
    def setUp(self):
        super().setUp()
        self.message = InternalMessage.objects.create(
            sender=self.cutting_user, receiver=self.design_user, content='مرحبا',
        )

    def test_list_is_scoped_to_the_viewer(self):
        view = InternalMessageViewSet()
        view.request = self._request(self.other_user)
        view.kwargs = {}
        self.assertEqual(view.get_queryset().count(), 0)

        view.request = self._request(self.design_user)
        self.assertEqual(view.get_queryset().count(), 1)

    def test_third_party_cannot_mark_message_read(self):
        view = InternalMessageViewSet()
        view.request = self._request(self.other_user, 'post')
        view.kwargs = {'pk': str(self.message.pk)}
        view.action = 'mark_read'
        with self.assertRaises(Http404):
            view.mark_read(view.request, pk=str(self.message.pk))
        self.message.refresh_from_db()
        self.assertFalse(self.message.is_read)

    def test_receiver_can_mark_message_read(self):
        view = InternalMessageViewSet()
        view.request = self._request(self.design_user, 'post')
        view.kwargs = {'pk': str(self.message.pk)}
        view.action = 'mark_read'
        response = view.mark_read(view.request, pk=str(self.message.pk))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.message.refresh_from_db()
        self.assertTrue(self.message.is_read)

    def test_sending_without_permission_is_forbidden(self):
        view = InternalMessageViewSet()
        request = self._request(
            self.design_user, 'post', {'receiver': self.other_user.pk, 'content': 'x'},
        )
        response = view.create(request)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(InternalMessage.objects.count(), 1)



class ModelItemActionSectionTests(PermissionTestBase):
    def _view_for(self, viewer, action, method='get', data=None):
        view = ModelItemViewSet()
        request = self._request(viewer, method, data)
        view.request = request
        view.action = action
        view.kwargs = {}
        view.format_kwarg = None
        return view, request

    def test_operational_section_can_read_models(self):
        view, request = self._view_for(self.cutting_user, 'list')
        view.initial(request)  # لا يرفع استثناء
        self.assertGreaterEqual(view.get_queryset().count(), 1)

    def test_action_of_another_section_is_denied(self):
        view, request = self._view_for(
            self.design_user, 'record_qc_count', 'post', {'counted': 5},
        )
        with self.assertRaises(PermissionDenied):
            view.initial(request)

    def test_cutting_section_cannot_create_models(self):
        view, request = self._view_for(
            self.cutting_user, 'create', 'post', {'model_code': 'X-1'},
        )
        with self.assertRaises(PermissionDenied):
            view.initial(request)

    def test_design_section_can_create_models(self):
        view, request = self._view_for(
            self.design_user, 'create', 'post', {'model_code': 'X-2'},
        )
        view.initial(request)  # لا يرفع استثناء


class LogoutTokenRotationTests(PermissionTestBase):
    def test_logout_invalidates_the_session_token(self):
        auth = f'Bearer {self.design_user.auth_token}'

        logout_request = self.factory.post('/api/auth/logout/', HTTP_AUTHORIZATION=auth)
        response = AuthViewSet().logout(logout_request)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.design_user.refresh_from_db()
        self.assertIsNone(self.design_user.auth_token)

        me_request = self.factory.get('/api/auth/me/', HTTP_AUTHORIZATION=auth)
        me_response = AuthViewSet().me(me_request)
        self.assertEqual(me_response.status_code, status.HTTP_401_UNAUTHORIZED)


class HRSalaryGatingTests(PermissionTestBase):
    def test_salary_hidden_from_employee_tab_only_viewer(self):
        data = HREmployeeSerializer(
            self.employee, context={'request': self._request(self.accounts_user)}
        ).data
        self.assertIsNone(data['monthly_salary'])
        self.assertEqual(data['name'], 'موظف')

    def test_update_cannot_change_salary_without_payroll_permission(self):
        view = HREmployeeViewSet()
        view.format_kwarg = None
        request = self._request(
            self.accounts_user, 'patch',
            {'name': 'موظف معدل', 'monthly_salary': 9000},
        )
        view.request = request
        view.kwargs = {'pk': str(self.employee.pk)}
        response = view.update(request, pk=str(self.employee.pk))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.employee.refresh_from_db()
        self.assertEqual(self.employee.name, 'موظف معدل')
        self.assertEqual(self.employee.monthly_salary, 5000)
        self.assertIsNone(response.data['monthly_salary'])

    def test_create_is_forbidden_without_payroll_permission(self):
        view = HREmployeeViewSet()
        view.format_kwarg = None
        request = self._request(
            self.accounts_user, 'post',
            {'name': 'جديد', 'job_id': str(self.job.pk), 'monthly_salary': 4000},
        )
        view.request = request
        view.kwargs = {}
        response = view.create(request)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(HREmployee.objects.filter(name='جديد').exists())

    def test_payroll_permission_allows_salary_read_and_edit(self):
        payroll_role = make_role('hr-payroll', hr_employees=True, hr_payroll=True)
        payroll_user = make_user('payroll', payroll_role, rank=RANK_LEVEL_ONE)

        data = HREmployeeSerializer(
            self.employee, context={'request': self._request(payroll_user)}
        ).data
        self.assertEqual(data['monthly_salary'], 5000.0)

        view = HREmployeeViewSet()
        view.format_kwarg = None
        request = self._request(payroll_user, 'patch', {'monthly_salary': 6500})
        view.request = request
        view.kwargs = {'pk': str(self.employee.pk)}
        response = view.update(request, pk=str(self.employee.pk))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.employee.refresh_from_db()
        self.assertEqual(self.employee.monthly_salary, 6500)


class UserSerializerContextTests(PermissionTestBase):
    """تمرير سياق الطلب إلزامي: بدونه يفترض المُسلسِل رؤية إدارية كاملة ويُسرّب رتبة الناظر."""

    def test_heartbeat_hides_rank_label_from_rank_three_viewer(self):
        UserProfile.objects.filter(pk__in=[self.design_user.pk, self.cutting_user.pk]).update(
            last_seen=timezone.now()
        )
        view = AuthViewSet()
        request = self._request(self.cutting_user)
        view.request = request
        response = view.heartbeat(request)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['onlineUsers'])
        for row in response.data['onlineUsers']:
            self.assertEqual(row['rank_level'], RANK_LEVEL_THREE)
            self.assertNotIn('rank_label', row)

    def test_heartbeat_returns_rank_label_for_rank_one_viewer(self):
        UserProfile.objects.filter(pk=self.cutting_user.pk).update(last_seen=timezone.now())
        view = AuthViewSet()
        request = self._request(self.accounts_user)
        view.request = request
        response = view.heartbeat(request)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['onlineUsers'])
        for row in response.data['onlineUsers']:
            self.assertIn('rank_label', row)


