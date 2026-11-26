"""اختبارات التحقق النهائي من إصلاحات التدقيق الشامل قبل الإطلاق."""
from datetime import date, time, timedelta
from decimal import Decimal

from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from .hr_attendance_io import sunday_deduction_for_week
from .hr_reports import _compute_month_accrual, _weekly_off_ratio
from .models import (
    Accessory,
    AccessoryTransaction,
    AssemblyStageRecord,
    AuditLog,
    CuttingRecord,
    Fabric,
    FabricColor,
    FabricTransaction,
    FinishingRecord,
    HRAttendanceRecord,
    HRAttendanceSettings,
    HREmployee,
    HRJobTitle,
    HRPayrollSnapshot,
    ModelAccessory,
    ModelItem,
    ModelRequirement,
    ModelTimeline,
    PackagingMaterialRule,
    PackagingMaterialSizeRule,
    PackagingMaterialTransaction,
    PrintDispatch,
    Role,
    SewingDispatch,
    Supplier,
    UserProfile,
    RANK_LEVEL_ONE,
    RANK_LEVEL_TWO,
    RANK_LEVEL_THREE,
)
from .services_pipeline import refund_model_consumed_inventory
from .services_schema_seed import (
    apply_packaging_material_transaction,
    generate_assembly_delivery_notifications,
)
from .services_stages import (
    receive_assembly_stage_service,
    receive_finishing_service,
    receive_ironing_service,
)


def _make_auth_client(username, token, rank_level=RANK_LEVEL_ONE, perms=None):
    role = Role.objects.create(
        name=f'role-{username}',
        rank_level=rank_level,
    )
    user = UserProfile.objects.create(
        username=username,
        real_name=username,
        role=role,
        rank_level=rank_level,
        is_active=True,
        auth_token=token,
        custom_permissions=perms or {},
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
    return client, user


class HRWeeklyOffAndPayrollSecurityTests(TestCase):
    class _Rec:
        def __init__(self, status='present', check_in=time(8, 30), is_excused=False):
            self.status = status
            self.check_in = check_in
            self.is_excused = is_excused

    def test_weekly_off_deduction_tiers(self):
        # 0 أو 1 -> 0 | 2 أو 3 -> 1/3 | 4 -> 2/3 | 5+ -> 1
        self.assertEqual(_weekly_off_ratio(0), 0.0)
        self.assertEqual(_weekly_off_ratio(1), 0.0)
        self.assertAlmostEqual(_weekly_off_ratio(2), 1.0 / 3.0, places=5)
        self.assertAlmostEqual(_weekly_off_ratio(3), 1.0 / 3.0, places=5)
        self.assertAlmostEqual(_weekly_off_ratio(4), 2.0 / 3.0, places=5)
        self.assertEqual(_weekly_off_ratio(5), 1.0)
        self.assertEqual(_weekly_off_ratio(6), 1.0)

        # مطابقة sunday_deduction_for_week في hr_attendance_io
        week = [date(2026, 11, d) for d in range(2, 8)]  # Mon..Sat before Sun Nov 8
        # 3 أيام حضور + 3 أيام غياب -> خصم 1/3 (0.33)
        recs_3_abs = {week[i]: self._Rec() for i in range(3)}
        res3 = sunday_deduction_for_week(recs_3_abs, week)
        self.assertAlmostEqual(res3['sunday_deduction_days'], 0.33, places=2)
        # 2 حضور + 4 غياب -> خصم 2/3 (0.67)
        recs_4_abs = {week[i]: self._Rec() for i in range(2)}
        res4 = sunday_deduction_for_week(recs_4_abs, week)
        self.assertAlmostEqual(res4['sunday_deduction_days'], 0.67, places=2)
        # 1 حضور + 5 غياب -> خصم يوم كامل (1.0)
        recs_5_abs = {week[0]: self._Rec()}
        res5 = sunday_deduction_for_week(recs_5_abs, week)
        self.assertEqual(res5['sunday_deduction_days'], 1.0)

    def test_worked_weekly_off_consistent_mid_month_and_end_of_month(self):
        # نوفمبر 2026 (30 يوماً): يبدأ بالأحد 1 نوفمبر؛ أيام الأحد = 1, 8, 15, 22, 29.
        # نُجهز سجلات حضور لأسبوع أكتوبر الأخير + كل أيام العمل في نوفمبر + عمل يوم الأحد 8 نوفمبر.
        records = {}
        for d in range(26, 32):
            records[date(2026, 10, d)] = self._Rec()
        for d in range(1, 31):
            cur = date(2026, 11, d)
            if cur.weekday() != 6:  # Mon..Sat
                records[cur] = self._Rec()
        # عمل يوم الأحد 8 نوفمبر
        records[date(2026, 11, 8)] = self._Rec()

        for mult in (1.0, 1.5, 2.0):
            # يوم 29 نوفمبر (قبل حضور يوم 30 نوفمبر — ناقص يوم عمل واحد)
            records_mid = {k: v for k, v in records.items() if k <= date(2026, 11, 29)}
            mid = _compute_month_accrual(
                records_mid, '2026-11', date(2026, 11, 29),
                weekly_off_index=6, weekly_off_work_multiplier=mult,
            )
            # نهاية الشهر (بعد حضور يوم 30 نوفمبر)
            full = _compute_month_accrual(
                records, '2026-11', None,
                weekly_off_index=6, weekly_off_work_multiplier=mult,
            )
            self.assertAlmostEqual(full['earned_days'], 30.0 + mult, places=2)
            # الفارق بين يوم 29 ويوم 30 هو يوم عمل واحد بالضبط (لا قفزة مفاجئة).
            self.assertAlmostEqual(full['earned_days'] - mid['earned_days'], 1.0, places=2)

    def test_absent_all_week_but_worked_sunday_forfeits_paid_sunday(self):
        # غاب 5 أيام في الأسبوع (3..7 نوفمبر) وحضر الإثنين 2 + عمل الأحد 8 نوفمبر (مضاعف 1.0).
        records = {
            date(2026, 11, 2): self._Rec(),
            date(2026, 11, 8): self._Rec(),
        }
        mid = _compute_month_accrual(
            records, '2026-11', date(2026, 11, 8),
            weekly_off_index=6, weekly_off_work_multiplier=1.0,
        )
        # يستحق 1 يوم عادي + 0 إجازة مدفوعة (خصم 1.0 لغياب 5 أيام) + 1.0 عمل الأحد = 2.0 فقط.
        self.assertEqual(mid['sunday_deduction_days'], 1.0)
        self.assertEqual(mid['paid_sunday_days'], 0.0)
        self.assertEqual(mid['earned_days'], 2.0)

    def test_payroll_unlock_permission_and_audit_log_privacy(self):
        job = HRJobTitle.objects.create(title='إداري', department='administration')
        HREmployee.objects.create(name='مدير عام', job=job, monthly_salary=20000, rank_level=RANK_LEVEL_ONE)
        HREmployee.objects.create(name='موظف', job=job, monthly_salary=4000, rank_level=RANK_LEVEL_THREE)
        HRAttendanceSettings.objects.create(official_start_time=time(8, 30), official_end_time=time(17, 30))

        hr_client, _ = _make_auth_client(
            'hr_only', 'tok-hr-only', rank_level=RANK_LEVEL_TWO, perms={'hr_payroll': True}
        )
        mgr_client, _ = _make_auth_client(
            'mgr_perm', 'tok-mgr-perm', rank_level=RANK_LEVEL_ONE,
            perms={'hr_payroll': True, 'manage_permissions': True},
        )

        # إغلاق كشف الشهر لا يكتب إجمالي المبالغ في AuditLog
        res_lock = mgr_client.post('/api/hr-payroll-snapshots/lock/', {'month': '2026-10'}, format='json')
        self.assertEqual(res_lock.status_code, status.HTTP_201_CREATED)
        lock_log = AuditLog.objects.filter(target_name__contains='2026-10').first()
        self.assertIsNotNone(lock_log)
        self.assertNotIn('20000', lock_log.details)
        self.assertNotIn('24000', lock_log.details)
        self.assertFalse(any(c.get('field') == 'net_pay' for c in (lock_log.changes or [])))

        # مستخدم hr_payroll فقط بدون manage_permissions يُمنع من فك الإغلاق (403)
        res_unlock_denied = hr_client.post('/api/hr-payroll-snapshots/unlock/', {'month': '2026-10'}, format='json')
        self.assertEqual(res_unlock_denied.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(HRPayrollSnapshot.objects.filter(month='2026-10', is_locked=True).exists())

        # مستخدم manage_permissions يستطيع فك الإغلاق بنجاح
        res_unlock_ok = mgr_client.post('/api/hr-payroll-snapshots/unlock/', {'month': '2026-10'}, format='json')
        self.assertEqual(res_unlock_ok.status_code, status.HTTP_200_OK)
        self.assertFalse(HRPayrollSnapshot.objects.filter(month='2026-10').exists())


class InventorySafetyModelFkAndIdempotencyTests(TestCase):
    def setUp(self):
        self.client, self.user = _make_auth_client(
            'admin_all',
            'tok-admin-all',
            rank_level=RANK_LEVEL_ONE,
            perms={
                'manage_permissions': True,
                'design_view': True, 'design_edit': True,
                'fabric_warehouse_view': True, 'fabric_warehouse_edit': True,
                'accessories_warehouse_view': True, 'accessories_warehouse_edit': True,
                'cutting_view': True, 'cutting_edit': True,
                'printing_view': True, 'printing_edit': True,
                'sewing_view': True, 'sewing_edit': True,
                'assembly_packaging_view': True, 'assembly_packaging_edit': True,
            },
        )
        self.supplier = Supplier.objects.create(name='مورد النيل')
        self.fabric = Fabric.objects.create(
            name='قطن مصري', unit='كيلو', supplier_id_ref=self.supplier.client_id, supplier='مورد النيل'
        )
        self.color = FabricColor.objects.create(
            fabric=self.fabric, color_code='WHT', color_name='أبيض', quantity=100.0, reserved_quantity=0.0
        )
        self.accessory = Accessory.objects.create(
            name='سوستة', code='ZIP-1', current_stock=Decimal('100.000'), reserved_quantity=0.0
        )

    def test_direct_stock_edit_cannot_violate_reserved_quantity(self):
        m = ModelItem.objects.create(model_code='RES-1', status='مرحلة التصميم')
        ModelRequirement.objects.create(model=m, color=self.color, part_name='تيشرت', planned_quantity=40.0)
        ModelAccessory.objects.create(
            model=m, accessory_id_ref=self.accessory.client_id, accessory_name='سوستة',
            planned_quantity=30.0, is_issued=False,
        )

        # تنزيل رصيد القماش تحت المحجوز (40) مرفوض بـ 400
        res_fab = self.client.put(f'/api/fabric-colors/{self.color.pk}/', {'quantity': 20}, format='json')
        self.assertEqual(res_fab.status_code, status.HTTP_400_BAD_REQUEST)
        self.color.refresh_from_db()
        self.assertEqual(self.color.quantity, 100.0)

        # تعديل الرصيد لـ 40 (مساوٍ للمحجوز) مسموح
        res_fab_ok = self.client.put(f'/api/fabric-colors/{self.color.pk}/', {'quantity': 40}, format='json')
        self.assertEqual(res_fab_ok.status_code, status.HTTP_200_OK)

        # تنزيل رصيد الإكسسوار تحت المحجوز (30) مرفوض بـ 400
        res_acc = self.client.put(f'/api/accessories/{self.accessory.pk}/', {'quantity': 10}, format='json')
        self.assertEqual(res_acc.status_code, status.HTTP_400_BAD_REQUEST)
        self.accessory.refresh_from_db()
        self.assertEqual(float(self.accessory.current_stock), 100.0)

    def test_post_cutting_fabric_adjustment_preserves_fabric_supplier(self):
        m = ModelItem.objects.create(model_code='SUP-1', status='في القص')
        req = ModelRequirement.objects.create(model=m, color=self.color, part_name='تيشرت', planned_quantity=10.0)
        res = self.client.put(
            f'/api/model-requirements/{req.pk}/',
            {'planned_quantity': 15.0},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        txn = FabricTransaction.objects.filter(model=m, operation='deduct').first()
        self.assertIsNotNone(txn)
        self.assertEqual(txn.supplier_id, self.supplier.pk)

    def test_reusing_soft_deleted_model_code_isolates_transactions(self):
        m1 = ModelItem.objects.create(model_code='REUSE-1', status='في القص')
        FabricTransaction.objects.create(
            color=self.color, fabric=self.fabric, model=m1,
            model_code_ref='REUSE-1', operation='deduct', amount=25.0,
        )
        m1.is_deleted = True
        m1.save(update_fields=['is_deleted'])

        # إنشاء موديل جديد بنفس الكود يؤرشف القديم ولا يورث حركاته
        res_create = self.client.post('/api/models/', {'model_code': 'REUSE-1', 'target_cut_quantity': 50}, format='json')
        self.assertEqual(res_create.status_code, status.HTTP_201_CREATED)
        m1.refresh_from_db()
        m2 = ModelItem.objects.get(model_code='REUSE-1', is_deleted=False)
        self.assertNotEqual(m1.pk, m2.pk)
        self.assertIn('__DEL_', m1.model_code)

        # استرداد m2 لا يعيد خامات m1 أبداً!
        refund_m2 = refund_model_consumed_inventory(m2, user_name='tester')
        self.assertEqual(refund_m2['fabric_total_quantity'], 0)

        # بينما استرداد m1 لا يزال يجد حركاته ويعيد 25 كيلو للمخزن
        refund_m1 = refund_model_consumed_inventory(m1, user_name='tester')
        self.assertEqual(refund_m1['fabric_total_quantity'], 25.0)

        # وتكرار كود موديل نشط يظل ممنوعاً بـ 400
        res_dup = self.client.post('/api/models/', {'model_code': 'REUSE-1'}, format='json')
        self.assertEqual(res_dup.status_code, status.HTTP_400_BAD_REQUEST)

    def test_packaging_material_safe_delete_and_txn_idempotency(self):
        rule = PackagingMaterialRule.objects.create(material_key='bag-safe', name='كيس محمي', unit='قطعة')
        sr = PackagingMaterialSizeRule.objects.create(
            rule=rule, size_group_id='s1', consumption_per_piece=1.0, current_stock=20.0
        )
        # ممنوع الحذف لوجود رصيد
        res_del1 = self.client.delete(f'/api/packaging-material-rules/{rule.pk}/')
        self.assertEqual(res_del1.status_code, status.HTTP_400_BAD_REQUEST)

        # منع تكرار الحركة عبر client_id
        payload = {'size_rule_id': sr.pk, 'operation': 'deduct', 'amount': 5, 'client_id': 'pm-idem-1'}
        r1 = self.client.post('/api/packaging-material-transactions/', payload, format='json')
        r2 = self.client.post('/api/packaging-material-transactions/', payload, format='json')
        self.assertEqual(r1.status_code, status.HTTP_201_CREATED)
        self.assertEqual(r2.status_code, status.HTTP_200_OK)
        sr.refresh_from_db()
        self.assertAlmostEqual(sr.current_stock, 15.0, places=2)
        self.assertEqual(PackagingMaterialTransaction.objects.filter(client_id='pm-idem-1').count(), 1)

        # حتى لو صفّرنا الرصيد، ممنوع الحذف لوجود حركات تاريخية
        sr.current_stock = 0.0
        sr.save()
        res_del2 = self.client.delete(f'/api/packaging-material-rules/{rule.pk}/')
        self.assertEqual(res_del2.status_code, status.HTTP_400_BAD_REQUEST)

        # قاعدة فارغة بلا رصيد ولا استهلاك ولا حركات يمكن حذفها
        empty_rule = PackagingMaterialRule.objects.create(material_key='empty-rule', name='فارغة', unit='قطعة')
        res_del_ok = self.client.delete(f'/api/packaging-material-rules/{empty_rule.pk}/')
        self.assertEqual(res_del_ok.status_code, status.HTTP_200_OK)

    def test_pipeline_guards_on_print_and_sewing_dispatch_and_idempotency(self):
        design_model = ModelItem.objects.create(model_code='PIPE-DES', status='مرحلة التصميم')
        # ممنوع إرسال موديل في التصميم للمطبعة أو المكن
        res_p = self.client.post('/api/dispatches/', {
            'model_id': design_model.pk, 'shop_name': 'مطبعة أ', 'pieces_count': 10, 'piece_type': 'shirt'
        }, format='json')
        self.assertEqual(res_p.status_code, status.HTTP_400_BAD_REQUEST)
        res_s = self.client.post(f'/api/models/{design_model.pk}/dispatch_to_sewing/', {
            'workshop_name': 'ورشة أ', 'pieces_count': 10, 'expected_delivery_date': date.today().isoformat(),
        }, format='json')
        self.assertEqual(res_s.status_code, status.HTTP_400_BAD_REQUEST)

        # موديل مقصوص (50 تيشرت): رفض تجاوز الكمية المقصوصة + توحيد رد إعادة المحاولة
        cut_model = ModelItem.objects.create(
            model_code='PIPE-CUT', status='في القص', total_cut_pieces=50, cut_shirt_pieces=50
        )
        res_over_print = self.client.post('/api/dispatches/', {
            'model_id': cut_model.pk, 'shop_name': 'مطبعة أ', 'pieces_count': 80, 'piece_type': 'shirt'
        }, format='json')
        self.assertEqual(res_over_print.status_code, status.HTTP_400_BAD_REQUEST)

        res_over_sew = self.client.post(f'/api/models/{cut_model.pk}/dispatch_to_sewing/', {
            'workshop_name': 'ورشة أ', 'pieces_count': 60,
            'expected_delivery_date': date.today().isoformat(), 'piece_type': 'shirt',
        }, format='json')
        self.assertEqual(res_over_sew.status_code, status.HTTP_400_BAD_REQUEST)

        sew_payload = {
            'client_id': 'sew-idem-1',
            'workshop_name': 'ورشة أ',
            'pieces_count': 30,
            'expected_delivery_date': date.today().isoformat(),
            'piece_type': 'shirt',
        }
        r_sew1 = self.client.post(f'/api/models/{cut_model.pk}/dispatch_to_sewing/', sew_payload, format='json')
        r_sew2 = self.client.post(f'/api/models/{cut_model.pk}/dispatch_to_sewing/', sew_payload, format='json')
        self.assertEqual(r_sew1.status_code, status.HTTP_200_OK)
        self.assertEqual(r_sew2.status_code, status.HTTP_200_OK)
        self.assertEqual(r_sew1.data['id'], r_sew2.data['id'])
        self.assertEqual(SewingDispatch.objects.filter(client_id='sew-idem-1').count(), 1)

        # تكرار تسجيل فرشة قص بنفس client_id لا ينشئ فرشة مكررة
        cut_payload = {
            'client_id': 'cut-idem-1',
            'model_id': cut_model.pk,
            'part_type': 'shirt',
            'spreader_name': 'فراش',
            'cutter_name': 'مقصدار',
            'layers_count': 10,
            'pieces_per_layer': 5,
            'layer_weight': 2.5,
        }
        rc1 = self.client.post('/api/cutting-records/', cut_payload, format='json')
        rc2 = self.client.post('/api/cutting-records/', cut_payload, format='json')
        self.assertEqual(rc1.status_code, status.HTTP_201_CREATED)
        self.assertEqual(rc2.status_code, status.HTTP_200_OK)
        self.assertEqual(CuttingRecord.objects.filter(client_id='cut-idem-1').count(), 1)

    def test_receive_finishing_ironing_assembly_idempotent_and_deleted_excluded_from_notifs(self):
        m = ModelItem.objects.create(model_code='ASM-IDEM', status='في التشطيب', total_cut_pieces=20)
        fin = FinishingRecord.objects.create(
            model=m, part_type='shirt', entry_date=date.today() - timedelta(days=3),
            expected_exit_date=date.today() - timedelta(days=1),
        )
        receive_finishing_service(fin.pk, actual_exit_date=date.today())
        tl_after_1 = ModelTimeline.objects.filter(model=m, title__contains='استلام').count()
        receive_finishing_service(fin.pk, actual_exit_date=date.today() + timedelta(days=1))
        tl_after_2 = ModelTimeline.objects.filter(model=m, title__contains='استلام').count()
        self.assertEqual(tl_after_1, tl_after_2)

        iron = AssemblyStageRecord.objects.create(
            model=m, stage='ironing', part_type='shirt', entry_date=date.today()
        )
        receive_ironing_service(iron.pk, actual_exit_date=date.today())
        tl_i1 = ModelTimeline.objects.filter(model=m, stage='قسم المكواة').count()
        receive_ironing_service(iron.pk, actual_exit_date=date.today())
        tl_i2 = ModelTimeline.objects.filter(model=m, stage='قسم المكواة').count()
        self.assertEqual(tl_i1, tl_i2)

        dest = AssemblyStageRecord.objects.create(
            model=m, stage='dest', entry_date=date.today(), expected_pieces=20
        )
        receive_assembly_stage_service(dest.pk, actual_exit_date=date.today(), completed_pieces=20)
        tl_d1 = ModelTimeline.objects.filter(model=m, title__contains='الدَست').count()
        receive_assembly_stage_service(dest.pk, actual_exit_date=date.today(), completed_pieces=15)
        tl_d2 = ModelTimeline.objects.filter(model=m, title__contains='الدَست').count()
        self.assertEqual(tl_d1, tl_d2)

        # الموديلات المحذوفة لا تُنتج تنبيهات تأخير أسمبلي/تشطيب
        del_model = ModelItem.objects.create(model_code='DEL-NOTIF', is_deleted=True, status='في التشطيب')
        FinishingRecord.objects.create(
            model=del_model, part_type='shirt',
            entry_date=date.today() - timedelta(days=5),
            expected_exit_date=date.today() - timedelta(days=2),
        )
        AssemblyStageRecord.objects.create(
            model=del_model, stage='packaging',
            entry_date=date.today() - timedelta(days=5),
            expected_exit_date=date.today() - timedelta(days=2),
        )
        notifs = generate_assembly_delivery_notifications()
        self.assertFalse(any(n['model_code'] == 'DEL-NOTIF' for n in notifs))

    def test_refund_deleted_inventory_reports_packaging_only_models(self):
        rule = PackagingMaterialRule.objects.create(material_key='carton-ref', name='كرتون', unit='قطعة')
        sr = PackagingMaterialSizeRule.objects.create(rule=rule, size_group_id='', current_stock=10.0)
        del_m = ModelItem.objects.create(model_code='PACK-ONLY-DEL', is_deleted=True, status='في التعبئة والتغليف')
        PackagingMaterialTransaction.objects.create(
            size_rule=sr, operation='deduct', amount=12.0, model=del_m, model_code_ref='PACK-ONLY-DEL'
        )
        res = self.client.post('/api/models/refund_deleted_inventory/', {}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['total_models_refunded'], 1)
        self.assertAlmostEqual(res.data['total_packaging_quantity'], 12.0, places=2)
        sr.refresh_from_db()
        self.assertAlmostEqual(sr.current_stock, 22.0, places=2)
