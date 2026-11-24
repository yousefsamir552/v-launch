import json
from django.test import TestCase
from rest_framework.test import APIClient

from .models import (
    AuditLog,
    GlobalSettings,
    Role,
    UserProfile,
    Fabric,
    FabricColor,
    Accessory,
    InternalMessage,
    HRJobTitle,
    HREmployee,
)


class AuditLoggingAndPwaManifestTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.role = Role.objects.create(
            name='مدير تشغيل',
            rank_level=1,
            permissions_json={
                'fabric_warehouse_view': True,
                'fabric_warehouse_edit': True,
                'accessories_warehouse_view': True,
                'accessories_warehouse_edit': True,
                'send_internal_messages': True,
                'can_manage_hr': True,
                'hr_payroll': True,
                'reports_view': True,
                'reports_edit': True,
                'manage_users': True,
                'manage_permissions': True,
                'view_audit_logs': True,
                'edit_header_settings': True,
                'view_global_settings': True,
            },
            delegatable_permissions=['fabric_warehouse_view', 'design_view'],
        )
        self.manager = UserProfile.objects.create(
            username='audit_mgr',
            real_name='مدير الاختبار',
            role=self.role,
            role_title=self.role.name,
            rank_level=1,
            auth_token='tok-audit-mgr',
            is_active=True,
        )
        self.manager.set_password('123456')
        self.manager.save()

        self.worker_role = Role.objects.create(
            name='موظف مبيعات',
            rank_level=3,
            permissions_json={
                'design_view': True,
                'send_internal_messages': True,
            },
        )
        self.worker = UserProfile.objects.create(
            username='audit_worker',
            real_name='موظف الاختبار',
            role=self.worker_role,
            role_title=self.worker_role.name,
            rank_level=3,
            auth_token='tok-audit-worker',
            is_active=True,
        )
        self.worker.set_password('123456')
        self.worker.save()

    def _auth(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

    def test_client_action_persists_export_and_print_for_regular_user(self):
        """أي مستخدم مسجل الدخول (حتى بدون view_audit_logs) يسجل التصدير والطباعة في AuditLog."""
        self._auth(self.worker.auth_token)
        res = self.client.post(
            '/api/audit-logs/client-action/',
            {
                'section': 'التصميم',
                'action_type': 'export',
                'target_name': 'قائمة الموديلات',
                'details': 'تصدير قائمة الموديلات إلى إكسيل',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        log = AuditLog.objects.filter(action_type='export', section='التصميم').first()
        self.assertIsNotNone(log)
        self.assertEqual(log.user_full_name, 'موظف الاختبار')
        self.assertIn('تصدير قائمة الموديلات', log.details)

        res_print = self.client.post(
            '/api/audit-logs/client-action/',
            {
                'section': 'القص',
                'action_type': 'print',
                'target_name': 'M-101',
                'details': 'طباعة أمر قص للموديل M-101',
            },
            format='json',
        )
        self.assertEqual(res_print.status_code, 201)
        self.assertTrue(AuditLog.objects.filter(action_type='print', target_name='M-101').exists())

        # مستخدم عادي لا يزال ممنوعاً من قراءة سجل المراقبة نفسه.
        list_res = self.client.get('/api/audit-logs/')
        self.assertEqual(list_res.status_code, 403)

    def test_internal_message_privacy_never_logs_body(self):
        """قاعدة الخصوصية: لا يُسجَّل نص الرسالة الداخلية في سجل المراقبة أبداً."""
        self._auth(self.manager.auth_token)
        secret_body = 'سر خاص جداً لا يجب ظهوره في سجل التدقيق 998877'
        res = self.client.post(
            '/api/internal-messages/',
            {
                'receiver_id': self.worker.client_id,
                'content': secret_body,
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        msg_log = AuditLog.objects.filter(section='المراسلات الداخلية').order_by('-id').first()
        self.assertIsNotNone(msg_log)
        self.assertIn('مدير الاختبار', msg_log.details)
        self.assertIn('موظف الاختبار', msg_log.details)
        self.assertNotIn(secret_body, msg_log.details)
        self.assertNotIn(secret_body, msg_log.target_name)
        self.assertNotIn(secret_body, json.dumps(msg_log.changes, ensure_ascii=False))

        # تعليم الرسالة كمقروءة أيضاً لا يسرّب نص الرسالة.
        msg_id = res.data['id']
        self._auth(self.worker.auth_token)
        read_res = self.client.post(f'/api/internal-messages/{msg_id}/mark_read/', format='json')
        self.assertEqual(read_res.status_code, 200)
        read_log = AuditLog.objects.filter(section='المراسلات الداخلية').order_by('-id').first()
        self.assertIsNotNone(read_log)
        self.assertNotIn(secret_body, read_log.details)
        self.assertNotIn(secret_body, json.dumps(read_log.changes, ensure_ascii=False))

    def test_fabric_and_accessory_transactions_log_before_after(self):
        self._auth(self.manager.auth_token)
        fab = Fabric.objects.create(name='قطن ميلتون', unit='كيلو')
        col = FabricColor.objects.create(fabric=fab, color_code='BLK', color_name='أسود', quantity=50)

        res = self.client.post(
            '/api/fabric-colors/record_transaction/',
            {'colorId': col.client_id, 'operation': 'deduct', 'amount': 12.5, 'notes': 'صرف اختبار'},
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        log = AuditLog.objects.filter(section='مخزن القماش', action_type='transaction').order_by('-id').first()
        self.assertIsNotNone(log)
        self.assertIn('منصرف', log.details)
        qty_change = next((c for c in log.changes if c.get('field') == 'quantity'), None)
        self.assertIsNotNone(qty_change)
        self.assertEqual(qty_change['old'], '50')
        self.assertEqual(qty_change['new'], '37.5')

        acc = Accessory.objects.create(code='BTN-1', name='زرار أبيض', unit='قطعة', current_stock=100)
        res_acc = self.client.post(
            '/api/accessories/record_transaction/',
            {'accessoryId': acc.client_id, 'operation': 'add', 'amount': 25, 'notes': 'توريد جديد'},
            format='json',
        )
        self.assertEqual(res_acc.status_code, 200)
        acc_log = AuditLog.objects.filter(section='مخزن الإكسسوارات', action_type='transaction').order_by('-id').first()
        self.assertIsNotNone(acc_log)
        self.assertIn('وارد', acc_log.details)
        acc_change = next((c for c in acc_log.changes if c.get('field') == 'current_stock'), None)
        self.assertIsNotNone(acc_change)
        self.assertEqual(acc_change['old'], '100')
        self.assertEqual(acc_change['new'], '125')

    def test_payroll_lock_unlock_and_notifications_and_targets_logged(self):
        self._auth(self.manager.auth_token)
        job = HRJobTitle.objects.create(title='خياط', department='sewing')
        HREmployee.objects.create(name='عامل 1', job=job, monthly_salary=6000, rank_level=3)

        lock_res = self.client.post('/api/hr-payroll-snapshots/lock/', {'month': '2026-10'}, format='json')
        self.assertEqual(lock_res.status_code, 201)
        lock_log = AuditLog.objects.filter(section='الموارد البشرية', details__contains='2026-10').order_by('-id').first()
        self.assertIsNotNone(lock_log)
        self.assertIn('اعتمد وأغلق', lock_log.details)

        unlock_res = self.client.post('/api/hr-payroll-snapshots/unlock/', {'month': '2026-10'}, format='json')
        self.assertEqual(unlock_res.status_code, 200)
        unlock_log = AuditLog.objects.filter(section='الموارد البشرية', details__contains='أعاد فتح').order_by('-id').first()
        self.assertIsNotNone(unlock_log)

        notif_res = self.client.post(
            '/api/notifications/snooze/',
            {'notification_key': 'notif-1', 'hours': 4},
            format='json',
        )
        self.assertEqual(notif_res.status_code, 200)
        self.assertTrue(AuditLog.objects.filter(section='التنبيهات', details__contains='أجّل التنبيه').exists())

        targets_res = self.client.post(
            '/api/reports/targets/',
            {'targets': {'cutting': {'daily': 1500, 'monthly': 30000}}},
            format='json',
        )
        self.assertEqual(targets_res.status_code, 200)
        target_log = AuditLog.objects.filter(section='التقارير', target_name='تارجتات الأقسام').order_by('-id').first()
        self.assertIsNotNone(target_log)
        self.assertTrue(len(target_log.changes) >= 1)

    def test_pwa_manifest_dynamic_name_and_logo_with_fallback(self):
        """نقطة /api/manifest.webmanifest عامة وتستخدم اسم المصنع وشعاره ديناميكياً."""
        # بدون أي توكن مصادقة
        self.client.credentials()
        settings_obj = GlobalSettings.get_solo()
        settings_obj.site_name = 'مصنع النور للملابس'
        settings_obj.logo = '🏭'
        settings_obj.save()

        res = self.client.get('/api/manifest.webmanifest')
        self.assertEqual(res.status_code, 200)
        self.assertIn('application/manifest+json', res['Content-Type'])
        data = json.loads(res.content.decode('utf-8'))
        self.assertEqual(data['name'], 'مصنع النور للملابس')
        self.assertEqual(data['dir'], 'rtl')
        self.assertEqual(data['lang'], 'ar')
        self.assertEqual(data['display'], 'standalone')
        self.assertEqual(data['start_url'], '/')
        self.assertEqual(data['icons'][0]['src'], '/icons/icon-192.png')
        self.assertEqual(data['icons'][1]['src'], '/icons/icon-512.png')

        # عند رفع شعار رابط صورة حقيقي (مثل Cloudflare R2)
        settings_obj.logo = 'https://cdn.example.com/settings/factory-logo.png'
        settings_obj.save()
        res2 = self.client.get('/api/manifest.webmanifest')
        self.assertEqual(res2.status_code, 200)
        data2 = json.loads(res2.content.decode('utf-8'))
        self.assertEqual(data2['icons'][0]['src'], 'https://cdn.example.com/settings/factory-logo.png')
        self.assertEqual(data2['icons'][0]['sizes'], '192x192')
        self.assertEqual(data2['icons'][1]['src'], 'https://cdn.example.com/settings/factory-logo.png')
        self.assertEqual(data2['icons'][1]['sizes'], '512x512')
        self.assertEqual(data2['icons'][0]['purpose'], 'any maskable')
