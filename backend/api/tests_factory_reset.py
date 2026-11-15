"""اختبارات تصفير بيانات المصنع الانتقائي (Factory Reset).

تتحقق من:
- منع أي حساب غير sudo من تنفيذ العملية (403).
- رفض التأكيد غير الصحيح (400).
- حذف القسم المحدد فقط دون المساس ببقية البيانات.
- الإبقاء الإجباري على حساب sudo عند تصفير المستخدمين والأدوار.
- احترام ترتيب الحذف الآمن مع قيد PROTECT في HRJobTitle.
"""
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIRequestFactory

from .models import (
    Role, UserProfile, Fabric, FabricColor, Accessory,
    HRJobTitle, HREmployee, AuditLog,
    RANK_LEVEL_THREE,
)
from .views import FactoryResetViewSet


def make_user(username, is_sudo=False, rank=RANK_LEVEL_THREE):
    user = UserProfile(
        username=username,
        real_name=username,
        rank_level=rank,
        is_sudo=is_sudo,
    )
    user.auth_token = f'token-{username}'
    user.set_password('x')
    user.save()
    return user


class FactoryResetTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.sudo = make_user('sudo', is_sudo=True, rank=0)
        self.role = Role.objects.create(name='موظف تشغيل', permissions_json={}, rank_level=RANK_LEVEL_THREE)
        self.normal = make_user('normal')
        self.normal.role = self.role
        self.normal.save()

        self.fabric = Fabric.objects.create(name='قطن')
        self.color = FabricColor.objects.create(
            fabric=self.fabric, color_code='BLK', quantity=100,
        )
        self.accessory = Accessory.objects.create(name='زرار', current_stock=50)
        self.job = HRJobTitle.objects.create(title='خياط', department='sewing')
        self.employee = HREmployee.objects.create(
            name='موظف', job=self.job, monthly_salary=5000, rank_level=RANK_LEVEL_THREE,
        )

    def _post(self, username, payload):
        request = self.factory.post(
            '/api/factory-reset/',
            payload,
            format='json',
            HTTP_AUTHORIZATION=f'Bearer token-{username}',
        )
        view = FactoryResetViewSet.as_view({'post': 'create'})
        return view(request)

    def test_non_sudo_is_forbidden(self):
        response = self._post('normal', {'sections': ['fabric'], 'confirmation': 'تأكيد'})
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(Fabric.objects.filter(pk=self.fabric.pk).exists())

    def test_wrong_confirmation_is_rejected(self):
        response = self._post('sudo', {'sections': ['fabric'], 'confirmation': 'نعم'})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(Fabric.objects.filter(pk=self.fabric.pk).exists())

    def test_reset_fabric_deletes_only_fabric(self):
        response = self._post('sudo', {'sections': ['fabric'], 'confirmation': 'تأكيد'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(Fabric.objects.exists())
        self.assertFalse(FabricColor.objects.exists())
        # بيانات أخرى لم تُمس.
        self.assertTrue(Accessory.objects.filter(pk=self.accessory.pk).exists())
        self.assertTrue(HREmployee.objects.filter(pk=self.employee.pk).exists())
        self.assertEqual(response.data['summary'].get('أصناف القماش'), 1)

    def test_reset_users_keeps_sudo_and_deletes_roles(self):
        response = self._post('sudo', {'sections': ['users_roles'], 'confirmation': 'تأكيد'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(UserProfile.objects.filter(username='sudo').exists())
        self.assertFalse(UserProfile.objects.filter(username='normal').exists())
        self.assertFalse(Role.objects.exists())
        self.assertEqual(response.data['summary'].get('حسابات المستخدمين'), 1)

    def test_reset_hr_respects_protect_order(self):
        response = self._post('sudo', {'sections': ['hr'], 'confirmation': 'تأكيد'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(HREmployee.objects.exists())
        self.assertFalse(HRJobTitle.objects.exists())

    def test_reset_writes_audit_entry(self):
        self._post('sudo', {'sections': ['accessories'], 'confirmation': 'تأكيد'})
        self.assertTrue(
            AuditLog.objects.filter(action='تصفير بيانات المصنع (Factory Reset)').exists()
        )
