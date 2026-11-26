"""اختبارات التحقق النهائية لإصلاحات ما قبل الإطلاق (الأمان، المخازن، التعديل بعد القص، المرتبات، الإنتاج)."""
from datetime import date, time
from decimal import Decimal
import json

from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from .hr_attendance_io import (
    compute_overtime,
    parse_attendance_sheet,
    reapply_employee_month,
)
from .hr_reports import (
    _compute_month_accrual,
    _is_attended,
    _payroll_for_employee_month,
)
from .models import (
    Accessory,
    AccessoryType,
    AssemblyStageRecord,
    AuditLog,
    Fabric,
    FabricColor,
    FabricTransaction,
    FinishingRecord,
    HRAttendanceRecord,
    HRAttendanceSettings,
    HREmployee,
    HRJobTitle,
    HRLoan,
    HRPayrollSnapshot,
    HRPenalty,
    ModelAccessory,
    ModelItem,
    ModelRequirement,
    ModelTimeline,
    PackagingMaterialRule,
    PackagingMaterialSizeRule,
    PackagingMaterialTransaction,
    PurchaseRequest,
    Role,
    UserProfile,
    RANK_LEVEL_ONE,
    RANK_LEVEL_TWO,
    RANK_LEVEL_THREE,
)
from .serializers import AuditLogSerializer
from .services_pipeline import refund_model_consumed_inventory, sync_reserved_quantities
from .services_schema_seed import (
    apply_packaging_material_transaction,
    resolve_cost_values,
)


def _make_user(username, token, *, is_sudo=False, rank_level=RANK_LEVEL_THREE, perms=None):
    role = Role.objects.create(
        name=f'role-{username}',
        rank_level=rank_level,
    )
    user = UserProfile.objects.create(
        username=username,
        real_name=username,
        role=role,
        rank_level=rank_level,
        is_sudo=is_sudo,
        is_active=True,
        auth_token=token,
        custom_permissions=perms or {},
    )
    return user


class PostCuttingFabricAdjustmentTests(TestCase):
    """تعديل كمية قماش لموديل تجاوز مرحلة التصميم يعدّل رصيد المخزن ويسجّل حركة و AuditLog."""

    def setUp(self):
        self.client = APIClient()
        self.planner = _make_user(
            'planner1',
            'tok-planner-1',
            rank_level=RANK_LEVEL_ONE,
            perms={
                'design_view': True,
                'design_edit': True,
                'cutting_view': True,
                'cutting_edit': True,
                'fabric_warehouse_view': True,
                'fabric_warehouse_edit': True,
            },
        )
        self.client.credentials(HTTP_AUTHORIZATION='Bearer tok-planner-1')

        self.fabric = Fabric.objects.create(name='قطن سنجل', unit='كيلو')
        self.color = FabricColor.objects.create(
            fabric=self.fabric,
            color_code='BLK-01',
            color_name='أسود',
            quantity=100.0,
            reserved_quantity=0.0,
            price_per_unit=200.0,
        )
        self.model = ModelItem.objects.create(
            model_code='M-POST-1',
            status='مرحلة التصميم',
            target_cut_quantity=100,
        )
        self.req = ModelRequirement.objects.create(
            model=self.model,
            color=self.color,
            part_name='تيشرت',
            planned_quantity=50.0,
        )
        # صرف 50 كيلو للقص (المخزن ينخفض من 100 إلى 50)
        res = self.client.post(f'/api/models/{self.model.id}/issue_fabric_to_cutting/', {}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.color.refresh_from_db()
        self.model.refresh_from_db()
        self.assertAlmostEqual(float(self.color.quantity), 50.0, places=2)
        self.assertEqual(self.model.status, 'في القص')

    def test_post_cutting_increase_and_decrease_reconcile_warehouse_and_audit(self):
        # 1) المشرف اكتشف إن القص سحب 100 كيلو بدل 50 -> زيادة 50 كيلو
        res_inc = self.client.post(
            f'/api/models/{self.model.id}/update_plan/',
            {'reqQuantities': {str(self.req.id): 100}},
            format='json',
        )
        self.assertEqual(res_inc.status_code, status.HTTP_200_OK)
        self.color.refresh_from_db()
        self.req.refresh_from_db()
        self.assertAlmostEqual(float(self.req.planned_quantity), 100.0, places=2)
        self.assertAlmostEqual(float(self.color.quantity), 0.0, places=2)

        deduct_txns = FabricTransaction.objects.filter(
            color=self.color, model_code_ref='M-POST-1', operation='deduct'
        )
        self.assertEqual(deduct_txns.count(), 2)  # 50 صرف أصلي + 50 فرق تعديل
        self.assertAlmostEqual(sum(float(t.amount) for t in deduct_txns), 100.0, places=2)
        self.assertTrue(
            ModelTimeline.objects.filter(
                model=self.model, title__icontains='تعديل كمية قماش بعد القص'
            ).exists()
        )
        self.assertTrue(
            AuditLog.objects.filter(target_name='M-POST-1', section='مخزن القماش').exists()
        )

        # 2) محاولة زيادة فوق الرصيد الفعلي (المخزن = 0) -> رفض 400 (يمنع التضخيم الوهمي)
        res_over = self.client.post(
            f'/api/models/{self.model.id}/update_plan/',
            {'reqQuantities': {str(self.req.id): 150}},
            format='json',
        )
        self.assertEqual(res_over.status_code, status.HTTP_400_BAD_REQUEST)
        self.color.refresh_from_db()
        self.req.refresh_from_db()
        self.assertAlmostEqual(float(self.req.planned_quantity), 100.0, places=2)
        self.assertAlmostEqual(float(self.color.quantity), 0.0, places=2)

        # 3) تقليل الكمية عبر ModelRequirementViewSet من 100 -> 80 -> إرجاع 20 للمخزن
        res_dec = self.client.patch(
            f'/api/model-requirements/{self.req.id}/',
            {'planned_quantity': 80},
            format='json',
        )
        self.assertEqual(res_dec.status_code, status.HTTP_200_OK)
        self.color.refresh_from_db()
        self.req.refresh_from_db()
        self.assertAlmostEqual(float(self.req.planned_quantity), 80.0, places=2)
        self.assertAlmostEqual(float(self.color.quantity), 20.0, places=2)
        add_txn = FabricTransaction.objects.filter(
            color=self.color, model_code_ref='M-POST-1', operation='add'
        ).last()
        self.assertIsNotNone(add_txn)
        self.assertAlmostEqual(float(add_txn.amount), 20.0, places=2)

    def test_post_cutting_create_and_delete_requirement_syncs_stock(self):
        # إضافة بند جديد بـ 15 كيلو بعد القص -> المخزن 50 -> 35
        res_add = self.client.post(
            '/api/model-requirements/',
            {
                'model_id': self.model.id,
                'color_id': self.color.id,
                'part_name': 'بنطلون',
                'planned_quantity': 15,
            },
            format='json',
        )
        self.assertEqual(res_add.status_code, status.HTTP_201_CREATED)
        self.color.refresh_from_db()
        self.assertAlmostEqual(float(self.color.quantity), 35.0, places=2)

        # حذف البند الجديد -> إرجاع 15 كيلو للمخزن (35 -> 50)
        new_req_id = res_add.data['id']
        res_del = self.client.delete(f'/api/model-requirements/{new_req_id}/')
        self.assertEqual(res_del.status_code, status.HTTP_200_OK)
        self.color.refresh_from_db()
        self.assertAlmostEqual(float(self.color.quantity), 50.0, places=2)


class WarehouseSecurityAndIntegrityTests(TestCase):
    """اختبارات حماية الأرصدة المحجوزة، منع الحذف المدمر، التطابق المزدوج، الصلاحيات، و IDOR."""

    def setUp(self):
        self.client = APIClient()
        self.sudo = _make_user('sudo', 'tok-sudo', is_sudo=True, rank_level=0)
        self.mgr = _make_user(
            'mgr1',
            'tok-mgr-1',
            rank_level=RANK_LEVEL_ONE,
            perms={
                'fabric_warehouse_view': True,
                'fabric_warehouse_edit': True,
                'accessories_warehouse_view': True,
                'accessories_warehouse_edit': True,
                'assembly_packaging_view': True,
                'assembly_packaging_edit': True,
                'send_internal_messages': True,
            },
        )
        self.viewer = _make_user(
            'viewer1',
            'tok-viewer-1',
            rank_level=RANK_LEVEL_THREE,
            perms={'fabric_warehouse_view': True, 'send_internal_messages': True},
        )

    def test_reserved_accessory_cannot_be_manually_deducted(self):
        self.client.credentials(HTTP_AUTHORIZATION='Bearer tok-mgr-1')
        AccessoryType.objects.create(name='سوست')
        acc = Accessory.objects.create(
            code='ZIP-1', name='سوستة 20 سم', current_stock=Decimal('100.000'), reserved_quantity=0
        )
        model = ModelItem.objects.create(model_code='M-ACC-1', status='مرحلة التصميم')
        ModelAccessory.objects.create(
            model=model,
            accessory_id_ref=str(acc.id),
            accessory_code='ZIP-1',
            accessory_name='سوستة 20 سم',
            planned_quantity=80,
            is_issued=False,
        )
        sync_reserved_quantities()
        # محاولة خصم 30 بينما المتاح غير المحجوز 20 فقط -> 400
        res = self.client.post(
            '/api/accessories/record_transaction/',
            {'accessoryId': acc.id, 'operation': 'deduct', 'amount': 30},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        # خصم 20 مسموح
        res_ok = self.client.post(
            '/api/accessories/record_transaction/',
            {'id': 'acc-txn-idem-1', 'accessoryId': acc.id, 'operation': 'deduct', 'amount': 20},
            format='json',
        )
        self.assertEqual(res_ok.status_code, status.HTTP_200_OK)
        # تكرار نفس client_id لا يخصم مرتين (Idempotency)
        res_dup = self.client.post(
            '/api/accessories/record_transaction/',
            {'id': 'acc-txn-idem-1', 'accessoryId': acc.id, 'operation': 'deduct', 'amount': 20},
            format='json',
        )
        self.assertEqual(res_dup.status_code, status.HTTP_200_OK)
        acc.refresh_from_db()
        self.assertEqual(acc.current_stock, Decimal('80.000'))

    def test_hard_delete_protected_and_nan_rejected(self):
        self.client.credentials(HTTP_AUTHORIZATION='Bearer tok-mgr-1')
        fab = Fabric.objects.create(name='ليكرا', unit='كيلو')
        col = FabricColor.objects.create(fabric=fab, color_code='RED', color_name='أحمر', quantity=50)
        # NaN rejected
        res_nan = self.client.post(
            '/api/fabric-colors/record_transaction/',
            {'colorId': col.id, 'operation': 'add', 'amount': 'NaN'},
            format='json',
        )
        self.assertEqual(res_nan.status_code, status.HTTP_400_BAD_REQUEST)

        # حركة صالحة مع client_id
        res_add = self.client.post(
            '/api/fabric-colors/record_transaction/',
            {'id': 'fab-txn-1', 'colorId': col.id, 'operation': 'add', 'amount': 10},
            format='json',
        )
        self.assertEqual(res_add.status_code, status.HTTP_200_OK)
        # تكرار نفس client_id
        res_dup = self.client.post(
            '/api/fabric-colors/record_transaction/',
            {'id': 'fab-txn-1', 'colorId': col.id, 'operation': 'add', 'amount': 10},
            format='json',
        )
        self.assertEqual(res_dup.status_code, status.HTTP_200_OK)
        col.refresh_from_db()
        self.assertAlmostEqual(float(col.quantity), 60.0, places=2)

        # منع حذف لون له سجل حركات
        res_del_col = self.client.delete(f'/api/fabric-colors/{col.id}/')
        self.assertEqual(res_del_col.status_code, status.HTTP_400_BAD_REQUEST)

    def test_permissions_self_deactivate_sudo_dm_and_factory_reset(self):
        # مشاهد فقط لا يعدّل حد تنبيه القماش
        self.client.credentials(HTTP_AUTHORIZATION='Bearer tok-viewer-1')
        res_thr = self.client.post(
            '/api/global-settings/update_settings/',
            {'fabric_alert_threshold': 99},
            format='json',
        )
        self.assertEqual(res_thr.status_code, status.HTTP_403_FORBIDDEN)

        # لا يمكن للمستخدم تعطيل حسابه الشخصي
        res_self = self.client.patch(
            f'/api/users/{self.viewer.id}/',
            {'is_active': False},
            format='json',
        )
        self.assertEqual(res_self.status_code, status.HTTP_400_BAD_REQUEST)

        # غير sudo لا يستطيع مراسلة sudo
        res_dm = self.client.post(
            '/api/internal-messages/',
            {'receiver_id': self.sudo.id, 'content': 'hello'},
            format='json',
        )
        self.assertEqual(res_dm.status_code, status.HTTP_400_BAD_REQUEST)

        # غير sudo لا يستطيع قراءة قائمة أقسام FactoryReset
        res_fr_list = self.client.get('/api/factory-reset/')
        self.assertEqual(res_fr_list.status_code, status.HTTP_403_FORBIDDEN)

        # sudo يستطيع تصفير طلبات الشراء
        PurchaseRequest.objects.create(item_name='زراير خاصة', quantity=Decimal('50.000'))
        self.client.credentials(HTTP_AUTHORIZATION='Bearer tok-sudo')
        res_fr = self.client.post(
            '/api/factory-reset/',
            {'sections': ['purchase_requests'], 'confirmation': 'تأكيد'},
            format='json',
        )
        self.assertEqual(res_fr.status_code, status.HTTP_200_OK)
        self.assertEqual(PurchaseRequest.objects.count(), 0)

    def test_cross_model_idor_rejected_and_audit_masks_net_pay(self):
        self.client.credentials(HTTP_AUTHORIZATION='Bearer tok-mgr-1')
        m1 = ModelItem.objects.create(model_code='M-A', status='في التشطيب')
        m2 = ModelItem.objects.create(model_code='M-B', status='في التشطيب')
        fin = FinishingRecord.objects.create(model=m2, part_type='shirt', entry_date=date.today())
        res_idor = self.client.post(
            f'/api/models/{m1.id}/receive_finishing/',
            {'record_id': fin.id},
            format='json',
        )
        self.assertEqual(res_idor.status_code, status.HTTP_404_NOT_FOUND)

        # إخفاء net_pay و purchased_price في AuditLog لغير المصرح لهم
        log_entry = AuditLog.objects.create(
            user_name='mgr1',
            section='الموارد البشرية',
            action='إغلاق رواتب',
            details='إجمالي الصافي: 15000 ج.م',
            changes=[{'field': 'net_pay', 'label': 'صافي الرواتب', 'old': '—', 'new': '15000'}],
        )
        fake_req = type('Req', (), {'user_profile': self.viewer})()
        data = AuditLogSerializer(log_entry, context={'request': fake_req}).data
        self.assertEqual(data['changes'][0]['new'], '🔒 محجوب')
        self.assertNotIn('15000', data['details'])


class HRAndProductionMathFixesTests(TestCase):
    """اختبارات إصلاحات معادلات المرتبات والحضور والتكاليف وخامات التشغيل."""

    def test_hr_accrual_no_phantom_salary_and_excused_absence(self):
        class _Rec:
            def __init__(self, status='present', check_in=time(8, 30), is_excused=False):
                self.status = status
                self.check_in = check_in
                self.is_excused = is_excused

        # غياب بعذر يُعد حضوراً
        self.assertTrue(_is_attended(_Rec(status='absent', check_in=None, is_excused=True)))

        # موظف استقال في أكتوبر: له بصمات آخر أسبوع أكتوبر ولا بصمات في نوفمبر -> 0 أيام مستحقة في نوفمبر!
        oct_tail = {date(2026, 10, d): _Rec() for d in range(26, 32)}
        accrual_nov = _compute_month_accrual(oct_tail, '2026-11', None, weekly_off_index=6)
        self.assertEqual(accrual_nov['earned_days'], 0.0)
        self.assertEqual(accrual_nov['paid_sunday_days'], 0.0)

        # معامل عمل الإجازة الأسبوعية = 0.0 لا يُحوّل إلى 1.0
        job = HRJobTitle.objects.create(title='عامل قص', department='cutting')
        emp = HREmployee.objects.create(name='أحمد', job=job, monthly_salary=3000)
        settings = HRAttendanceSettings.objects.create(
            official_start_time=time(8, 30),
            official_end_time=time(17, 30),
            weekly_off_day='Sunday',
            weekly_off_work_multiplier=Decimal('0.00'),
        )
        # حضر 1 نوفمبر 2026 (أحد) فقط مع مضاعف = 0
        rec = HRAttendanceRecord.objects.create(
            employee=emp, date=date(2026, 11, 1), check_in=time(8, 30), check_out=time(17, 30), status='present'
        )
        calc = _payroll_for_employee_month(
            emp, [rec], {rec.date: rec}, [], [], '2026-11', settings, date(2026, 11, 2), weekly_off_index=6
        )
        self.assertEqual(calc['weekly_off_extra_days'], 0.0)

    def test_overtime_above_highest_rule_and_three_punches_merge(self):
        settings = HRAttendanceSettings.objects.create(
            official_start_time=time(8, 30),
            official_end_time=time(17, 30),
            overtime_rules=[
                {'from_time': '18:00', 'to_time': '20:00', 'reward_type': 'hours', 'reward_value': 2},
                {'from_time': '20:01', 'to_time': '22:00', 'reward_type': 'hours', 'reward_value': 4},
            ],
        )
        # انصراف 23:00 يتجاوز أعلى شريحة (22:00) -> يأخذ الشريحة الأعلى (4 ساعات) وليس 0
        ot = compute_overtime(settings, time(23, 0), time(8, 30))
        self.assertEqual(ot['overtime_hours'], 4.0)

        # دمج 3 بصمات في نفس اليوم -> (أقدم وقت, أحدث وقت)
        csv_content = (
            'كود الموظف,الاسم,التاريخ,الحضور,الانصراف\n'
            '101,محمد,2026-11-02,08:15,12:00\n'
            '101,محمد,2026-11-02,13:00,18:30\n'
        ).encode('utf-8')
        parsed = parse_attendance_sheet('test.csv', csv_content)
        self.assertEqual(len(parsed['rows']), 1)
        self.assertEqual(parsed['rows'][0]['check_in'], time(8, 15))
        self.assertEqual(parsed['rows'][0]['check_out'], time(18, 30))

    def test_auto_weekly_off_is_excused_and_payroll_snapshot_rank_scoped(self):
        job = HRJobTitle.objects.create(title='مشرف', department='sewing')
        emp_r1 = HREmployee.objects.create(name='مدير', job=job, monthly_salary=9000, rank_level=RANK_LEVEL_ONE)
        emp_r3 = HREmployee.objects.create(name='عامل', job=job, monthly_salary=3000, rank_level=RANK_LEVEL_THREE)
        settings = HRAttendanceSettings.objects.create(
            official_start_time=time(8, 30),
            official_end_time=time(17, 30),
            weekly_off_day='Sunday',
        )
        HRAttendanceRecord.objects.create(
            employee=emp_r3, date=date(2026, 11, 2), check_in=time(8, 30), check_out=time(17, 30), status='present'
        )
        reapply_employee_month(settings, emp_r3, date(2026, 11, 1), date(2026, 11, 30))
        auto_sunday = HRAttendanceRecord.objects.filter(employee=emp_r3, date=date(2026, 11, 8)).first()
        self.assertIsNotNone(auto_sunday)
        self.assertTrue(auto_sunday.is_excused)

        # لقطة الرواتب محمية بالرتبة في list/retrieve وممنوع POST المباشر
        HRPayrollSnapshot.objects.create(
            month='2026-10',
            is_locked=True,
            rows_json=[
                {'employee_id': str(emp_r1.id), 'rank_level': RANK_LEVEL_ONE, 'net_pay': 9000},
                {'employee_id': str(emp_r3.id), 'rank_level': RANK_LEVEL_THREE, 'net_pay': 3000},
            ],
            totals_json={'net_pay': 12000},
        )
        rank2_user = _make_user(
            'hr_r2', 'tok-hr-r2', rank_level=RANK_LEVEL_TWO, perms={'hr_payroll': True}
        )
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION='Bearer tok-hr-r2')
        res_list = client.get('/api/hr-payroll-snapshots/')
        self.assertEqual(res_list.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res_list.data[0]['rows']), 1)
        self.assertEqual(res_list.data[0]['rows'][0]['rank_level'], RANK_LEVEL_THREE)

        res_post = client.post('/api/hr-payroll-snapshots/', {'month': '2026-09'}, format='json')
        self.assertEqual(res_post.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_cost_zero_count_packaging_stock_guard_and_refund(self):
        # تكلفة 0 قطعة = 0 وليس سعر القطعة
        unit, total = resolve_cost_values(15.0, None, pieces_count=0)
        self.assertEqual(unit, 15.0)
        self.assertEqual(total, 0.0)

        # خصم خامات تشغيل أكبر من الرصيد يُرفض بـ ValueError؛ وتعديل الرصيد لصفر مسموح
        rule = PackagingMaterialRule.objects.create(material_key='bag-test', name='كيس', unit='قطعة')
        sr = PackagingMaterialSizeRule.objects.create(rule=rule, size_group_id='', current_stock=10.0)
        with self.assertRaises(ValueError):
            apply_packaging_material_transaction(sr, 'deduct', 25.0)
        apply_packaging_material_transaction(sr, 'adjust', 0.0)
        sr.refresh_from_db()
        self.assertEqual(float(sr.current_stock), 0.0)

        # استرداد خامات التغليف عند حذف الموديل
        sr.current_stock = 50.0
        sr.save()
        model = ModelItem.objects.create(model_code='M-PACK-REF', status='في التعبئة والتغليف')
        rec = AssemblyStageRecord.objects.create(model=model, stage='packaging', materials_deducted=True)
        PackagingMaterialTransaction.objects.create(
            size_rule=sr, operation='deduct', amount=20.0, model_code_ref='M-PACK-REF'
        )
        summary = refund_model_consumed_inventory(model, user_name='tester')
        sr.refresh_from_db()
        rec.refresh_from_db()
        self.assertAlmostEqual(float(sr.current_stock), 70.0, places=2)
        self.assertFalse(rec.materials_deducted)
        self.assertEqual(summary['packaging_total_quantity'], 20.0)
        # استدعاء ثانٍ لا يكرر الاسترداد (Idempotent)
        summary2 = refund_model_consumed_inventory(model, user_name='tester')
        self.assertEqual(summary2['packaging_total_quantity'], 0)
