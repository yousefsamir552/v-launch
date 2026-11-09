from django.test import TestCase
from rest_framework.test import APIRequestFactory

from .models import (
    Role, UserProfile, HRJobTitle, HREmployee,
    RANK_SUDO, RANK_LEVEL_ONE, RANK_LEVEL_TWO, RANK_LEVEL_THREE,
)
from .serializers import UserProfileSerializer, HREmployeeSerializer
from .views import UserProfileViewSet, RoleViewSet, HREmployeeViewSet


def make_user(username, rank, role=None):
    user = UserProfile(username=username, real_name=username, rank_level=rank, role=role)
    user.set_password('x')
    user.save()
    return user


class RankVisibilityTests(TestCase):
    def setUp(self):
        self.r1 = Role.objects.create(name='R1', rank_level=RANK_LEVEL_ONE)
        self.r2 = Role.objects.create(name='R2', rank_level=RANK_LEVEL_TWO)
        self.r3 = Role.objects.create(name='R3', rank_level=RANK_LEVEL_THREE)

        self.u1 = make_user('rank1', RANK_LEVEL_ONE, self.r1)
        self.u1b = make_user('rank1b', RANK_LEVEL_ONE, self.r1)
        self.u2 = make_user('rank2', RANK_LEVEL_TWO, self.r2)
        self.u2b = make_user('rank2b', RANK_LEVEL_TWO, self.r2)
        self.u3 = make_user('rank3', RANK_LEVEL_THREE, self.r3)
        self.u3b = make_user('rank3b', RANK_LEVEL_THREE, self.r3)

        job = HRJobTitle.objects.create(title='خياط', department='sewing')
        self.e1 = HREmployee.objects.create(name='emp1', job=job, monthly_salary=100, rank_level=RANK_LEVEL_ONE)
        self.e2 = HREmployee.objects.create(name='emp2', job=job, monthly_salary=100, rank_level=RANK_LEVEL_TWO)
        self.e3 = HREmployee.objects.create(name='emp3', job=job, monthly_salary=100, rank_level=RANK_LEVEL_THREE)

        self.factory = APIRequestFactory()

    def _request(self, viewer):
        request = self.factory.get('/')
        request.user_profile = viewer
        return request

    def _visible_usernames(self, viewer):
        view = UserProfileViewSet()
        view.request = self._request(viewer)
        view.kwargs = {}
        return set(view.get_queryset().values_list('username', flat=True))

    def _visible_roles(self, viewer):
        view = RoleViewSet()
        view.request = self._request(viewer)
        view.kwargs = {}
        return set(view.get_queryset().values_list('name', flat=True))

    def _visible_employees(self, viewer):
        view = HREmployeeViewSet()
        view.request = self._request(viewer)
        view.kwargs = {}
        return set(view.get_queryset().values_list('name', flat=True))

    def test_rank_one_sees_only_lower_ranks_plus_self(self):
        visible = self._visible_usernames(self.u1)
        self.assertIn('rank1', visible)
        self.assertNotIn('rank1b', visible)  # peers hidden
        self.assertIn('rank2', visible)
        self.assertIn('rank3', visible)
        self.assertEqual(self._visible_roles(self.u1), {'R2', 'R3'})
        self.assertEqual(self._visible_employees(self.u1), {'emp2', 'emp3'})

    def test_rank_two_sees_only_rank_three_plus_self(self):
        visible = self._visible_usernames(self.u2)
        self.assertIn('rank2', visible)
        self.assertNotIn('rank2b', visible)
        self.assertNotIn('rank1', visible)
        self.assertIn('rank3', visible)
        self.assertEqual(self._visible_roles(self.u2), {'R3'})
        self.assertEqual(self._visible_employees(self.u2), {'emp3'})

    def test_rank_three_sees_peers_only(self):
        visible = self._visible_usernames(self.u3)
        self.assertIn('rank3', visible)
        self.assertIn('rank3b', visible)
        self.assertNotIn('rank2', visible)
        self.assertNotIn('rank1', visible)
        self.assertEqual(self._visible_roles(self.u3), {'R3'})
        self.assertEqual(self._visible_employees(self.u3), {'emp3'})

    def test_serializer_hides_rank_label_from_rank_three(self):
        context = {'request': self._request(self.u3)}
        data = UserProfileSerializer(self.u3b, context=context).data
        self.assertNotIn('rank_label', data)

        context1 = {'request': self._request(self.u1)}
        data1 = UserProfileSerializer(self.u2, context=context1).data
        self.assertIn('rank_label', data1)
        self.assertEqual(data1['rank_level'], RANK_LEVEL_TWO)

        emp_data = HREmployeeSerializer(self.e2, context=context1).data
        self.assertEqual(emp_data['rank_level'], RANK_LEVEL_TWO)

    def test_rank_zero_reserved_for_sudo(self):
        self.u3.rank_level = RANK_SUDO
        self.u3.save()
        self.u3.refresh_from_db()
        self.assertEqual(self.u3.rank_level, RANK_LEVEL_THREE)

        role = Role.objects.create(name='zero', rank_level=RANK_SUDO)
        role.refresh_from_db()
        self.assertEqual(role.rank_level, RANK_LEVEL_THREE)

        employee = HREmployee.objects.create(
            name='emp0', job=self.e1.job, monthly_salary=100, rank_level=RANK_SUDO
        )
        employee.refresh_from_db()
        self.assertEqual(employee.rank_level, RANK_LEVEL_THREE)

    def test_grant_guard_for_rank_two_is_forced_to_three(self):
        self.u2.custom_permissions = {'manage_permissions': True}
        self.u2.save()
        view = RoleViewSet()
        view.request = self._request(self.u2)
        view.format_kwarg = None
        view.request.data = {'name': 'new role', 'rank_level': RANK_LEVEL_ONE}
        response = view.create(view.request)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Role.objects.get(name='new role').rank_level, RANK_LEVEL_THREE)

    def test_rank_one_cannot_grant_rank_one(self):
        view = RoleViewSet()
        view.request = self._request(self.u1)
        view.format_kwarg = None
        view.request.data = {'name': 'forbidden role', 'rank_level': RANK_LEVEL_ONE}
        response = view.create(view.request)
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Role.objects.filter(name='forbidden role').exists())

    def test_state_endpoint_is_rank_scoped(self):
        from .views import StateViewSet

        request = self.factory.get('/', HTTP_X_USER_USERNAME='rank2')
        response = StateViewSet().list(request)
        self.assertEqual(response.status_code, 200)

        usernames = {user['username'] for user in response.data['users']}
        self.assertIn('rank2', usernames)  # self is always visible
        self.assertIn('rank3', usernames)
        self.assertNotIn('rank2b', usernames)  # peers hidden
        self.assertNotIn('rank1', usernames)

        role_names = {role['name'] for role in response.data['roles']}
        self.assertIn('R3', role_names)
        self.assertNotIn('R2', role_names)
        self.assertNotIn('R1', role_names)

    def test_state_endpoint_hides_rank_label_from_rank_three(self):
        from .views import StateViewSet

        request = self.factory.get('/', HTTP_X_USER_USERNAME='rank3')
        response = StateViewSet().list(request)
        rank3_payload = next(u for u in response.data['users'] if u['username'] == 'rank3b')
        self.assertNotIn('rank_label', rank3_payload)

    def test_state_endpoint_rank_zero_reserved_for_sudo(self):
        from .views import StateViewSet

        request = self.factory.get('/', HTTP_X_USER_USERNAME='sudo')
        response = StateViewSet().list(request)
        # sudo sees every rank, but never its own emergency account in the list.
        usernames = {user['username'] for user in response.data['users']}
        self.assertNotIn('sudo', usernames)
        self.assertIn('rank1', usernames)
        self.assertIn('rank2', usernames)
        self.assertIn('rank3', usernames)
