"""اختبارات الميزات الجديدة:
1) نظام تقييم الورش (WorkshopEvaluation) وتقرير التقييم المجمّع.
2) الخصم التلقائي لخامات التعبئة والتغليف وبوابة التحقق من الرصيد (Stock Gate) ومنع الخصم المزدوج.
3) مرحلة الدَست: العدد المتوقع مقابل المنفذ فعلياً وحساب العجز تلقائياً.
4) تقرير الموديلات: عرض جميع مراحل الإنتاج الـ 12 بالترتيب الكامل.
"""
from datetime import date, timedelta
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from .models import (
    AssemblyStageRecord,
    AuditLog,
    FinishingRecord,
    ModelItem,
    PackagingMaterialRule,
    PackagingMaterialSizeRule,
    PackagingMaterialTransaction,
    PackagingRequirement,
    PrintDispatch,
    QCRecord,
    Role,
    SewingDispatch,
    SizeDef,
    UserProfile,
    Workshop,
    WorkshopEvaluation,
    RANK_LEVEL_ONE,
)
from .reports import get_model_stage_waterfall, get_models_report


def _make_admin_client(username='feature-admin'):
    role = Role.objects.create(
        name=f'role-{username}',
        permissions_json={
            'design_view': True, 'design_edit': True,
            'printing_view': True, 'printing_edit': True,
            'sewing_view': True, 'sewing_edit': True,
            'assembly_packaging_view': True, 'assembly_packaging_edit': True,
            'reports_view': True, 'reports_edit': True,
            'view_audit_logs': True,
        },
        rank_level=RANK_LEVEL_ONE,
    )
    user = UserProfile(
        username=username,
        real_name='مدير اختبارات',
        role=role,
        rank_level=RANK_LEVEL_ONE,
    )
    user.auth_token = f'tok-{username}'
    user.set_password('secret')
    user.save()
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {user.auth_token}')
    return client, user


class WorkshopEvaluationTests(TestCase):
    def setUp(self):
        self.client, self.user = _make_admin_client('eval-admin')
        self.print_shop = Workshop.objects.create(name='مطبعة النيل', workshop_type=['printing'])
        self.sew_shop = Workshop.objects.create(name='ورشة الصفا', workshop_type=['sewing'])
        self.model = ModelItem.objects.create(
            model_code='EVAL-100',
            model_type='ولادي',
            status='في التشطيب',
            garment_composition='two_pieces',
            garment_parts=['shirt', 'pants'],
            total_cut_pieces=100,
        )
        today = date.today()
        # إرسالية مطبعة استُلمت في الموعد
        self.print_disp = PrintDispatch.objects.create(
            model=self.model,
            print_house='مطبعة النيل',
            workshop=self.print_shop,
            piece_type='shirt',
            pieces_count=100,
            received_pieces=100,
            expected_delivery_date=today,
            received_date=today,
            status='تم الاستلام بالمصنع',
        )
        # إرسالية مكن استُلمت متأخرة يومين
        self.sew_disp = SewingDispatch.objects.create(
            model=self.model,
            workshop_name='ورشة الصفا',
            workshop=self.sew_shop,
            piece_type='shirt',
            pieces_count=100,
            received_pieces=100,
            expected_delivery_date=today - timedelta(days=2),
            received_date=today,
            status='تم الاستلام',
        )
        # سجل تشطيب استُلم في الموعد
        self.fin_rec = FinishingRecord.objects.create(
            model=self.model,
            part_type='shirt',
            vendor_name='ورشة الصفا',
            workshop=self.sew_shop,
            entry_date=today - timedelta(days=1),
            expected_exit_date=today,
            actual_exit_date=today,
        )
        # سجلات جودة لحساب نسبة العيوب
        QCRecord.objects.create(
            model=self.model, stage='after_print', part_type='shirt',
            color_name='أبيض', size='M', counted_pieces=95, defect_pieces=5, checked_by='فاحص',
        )
        QCRecord.objects.create(
            model=self.model, stage='after_sewing', part_type='shirt',
            color_name='أبيض', size='M', counted_pieces=90, defect_pieces=10, checked_by='فاحص',
        )

    def test_create_upsert_and_validate_workshop_evaluation(self):
        # تقييم خارج النطاق 1..5 يُرفض بـ 400
        bad = self.client.post('/api/workshop-evaluations/', {
            'model_id': self.model.client_id,
            'sewing_dispatch_id': self.sew_disp.client_id,
            'delivery_timeliness': 6,
            'work_quality': 4,
            'finishing_quality': 4,
        }, format='json')
        self.assertEqual(bad.status_code, status.HTTP_400_BAD_REQUEST)

        # إنشاء تقييم إرسالية المكن
        res = self.client.post('/api/workshop-evaluations/', {
            'model_id': self.model.client_id,
            'sewing_dispatch_id': self.sew_disp.client_id,
            'stage': 'sewing',
            'delivery_timeliness': 3,
            'work_quality': 4,
            'finishing_quality': 5,
            'notes': 'جودة ممتازة مع تأخير بسيط',
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['workshop_name'], 'ورشة الصفا')
        self.assertEqual(res.data['overall_score'], 4.0)
        self.assertTrue(AuditLog.objects.filter(section='تقييم الورش').exists())

        # إعادة إرسال لنفس الإرسالية يُحدث السجل بدل التكرار (Upsert)
        res2 = self.client.post('/api/workshop-evaluations/', {
            'model_id': self.model.client_id,
            'sewing_dispatch_id': self.sew_disp.client_id,
            'stage': 'sewing',
            'delivery_timeliness': 4,
            'work_quality': 5,
            'finishing_quality': 5,
        }, format='json')
        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        self.assertEqual(WorkshopEvaluation.objects.filter(sewing_dispatch=self.sew_disp).count(), 1)
        self.assertEqual(res2.data['delivery_timeliness'], 4)

    def test_aggregated_workshop_evaluations_report(self):
        WorkshopEvaluation.objects.create(
            workshop=self.print_shop,
            workshop_name='مطبعة النيل',
            stage='printing',
            model=self.model,
            print_dispatch=self.print_disp,
            delivery_timeliness=5,
            work_quality=5,
            finishing_quality=4,
            evaluated_by='أحمد',
        )
        WorkshopEvaluation.objects.create(
            workshop=self.sew_shop,
            workshop_name='ورشة الصفا',
            stage='sewing',
            model=self.model,
            sewing_dispatch=self.sew_disp,
            delivery_timeliness=3,
            work_quality=4,
            finishing_quality=4,
            evaluated_by='أحمد',
        )
        WorkshopEvaluation.objects.create(
            workshop=self.sew_shop,
            workshop_name='ورشة الصفا',
            stage='finishing',
            model=self.model,
            finishing_record=self.fin_rec,
            delivery_timeliness=5,
            work_quality=5,
            finishing_quality=5,
            evaluated_by='أحمد',
        )

        res = self.client.get('/api/reports/workshop-evaluations/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        rows = res.data['workshops']
        self.assertEqual(len(rows), 3)

        by_key = {(r['workshop_name'], r['category']): r for r in rows}
        nile = by_key[('مطبعة النيل', 'printing')]
        self.assertEqual(nile['total_dispatches'], 1)
        self.assertEqual(nile['on_time_percent'], 100.0)
        self.assertEqual(nile['defect_percent'], 5.0)
        self.assertEqual(nile['avg_delivery'], 5.0)

        safa_sew = by_key[('ورشة الصفا', 'sewing')]
        self.assertEqual(safa_sew['on_time_percent'], 0.0)
        self.assertEqual(safa_sew['defect_percent'], 10.0)

        # فلتر الفئة
        res_print = self.client.get('/api/reports/workshop-evaluations/?category=printing')
        self.assertEqual(len(res_print.data['workshops']), 1)
        self.assertEqual(res_print.data['workshops'][0]['workshop_name'], 'مطبعة النيل')


class PackagingStockGateAndAutoDeductionTests(TestCase):
    def setUp(self):
        self.client, self.user = _make_admin_client('pack-gate-admin')
        self.size_def = SizeDef.objects.create(name='أطفال 2-6', values='2,4,6')
        self.model = ModelItem.objects.create(
            model_code='PKG-GATE-1',
            model_type='ولادي',
            size_category_id=self.size_def.client_id,
            status='في التعبئة والتغليف',
            garment_composition='two_pieces',
            garment_parts=['shirt', 'pants'],
            part_stages={'shirt': 'packaging', 'pants': 'packaging'},
            cut_shirt_pieces=50,
            cut_pants_pieces=50,
            qc_shirt_pieces=50,
            qc_pants_pieces=50,
            total_cut_pieces=50,
        )
        # خامتان مفعّلتان: أكياس (1 كيس/طقم → مطلوب 50) + كرتون (0.1 كرتونة/طقم → مطلوب 5)
        self.bags_rule = PackagingMaterialRule.objects.create(
            material_key='test_bags', name='أكياس بلاستيك', unit='قطعة',
            rule_mode='variable', applicable_size_groups=[self.size_def.client_id], is_active=True,
        )
        self.bags_sr = PackagingMaterialSizeRule.objects.create(
            rule=self.bags_rule,
            size_group_id=self.size_def.client_id,
            size_group_name=self.size_def.name,
            consumption_per_piece=1.0,
            current_stock=30.0,  # غير كافٍ (المطلوب 50، العجز 20)
        )
        self.carton_rule = PackagingMaterialRule.objects.create(
            material_key='test_cartons', name='كرتون', unit='قطعة',
            rule_mode='fixed', applicable_size_groups=[], is_active=True,
        )
        self.carton_sr = PackagingMaterialSizeRule.objects.create(
            rule=self.carton_rule,
            size_group_id='',
            size_group_name='كل المقاسات',
            consumption_per_piece=0.1,
            current_stock=20.0,  # كافٍ (المطلوب 5)
        )

    def test_stock_gate_blocks_entry_on_shortage_without_partial_deduction(self):
        res = self.client.post(
            f'/api/models/{self.model.client_id}/start_assembly_stage/',
            {'stage': 'packaging', 'vendor_name': 'ورشة تغليف'},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data.get('code'), 'packaging_material_shortage')
        self.assertEqual(len(res.data.get('shortages') or []), 1)
        self.assertEqual(res.data['shortages'][0]['required'], 50.0)
        self.assertEqual(res.data['shortages'][0]['available'], 30.0)
        self.assertEqual(res.data['shortages'][0]['shortage'], 20.0)

        # لم يُنشأ سجل مرحلة ولم يُخصم أي رصيد (ولا حتى الكرتون المتوفر).
        self.assertFalse(AssemblyStageRecord.objects.filter(model=self.model, stage='packaging').exists())
        self.bags_sr.refresh_from_db()
        self.carton_sr.refresh_from_db()
        self.assertEqual(self.bags_sr.current_stock, 30.0)
        self.assertEqual(self.carton_sr.current_stock, 20.0)
        self.assertEqual(PackagingMaterialTransaction.objects.count(), 0)

    def test_auto_deduction_succeeds_and_prevents_double_deduction(self):
        self.bags_sr.current_stock = 80.0
        self.bags_sr.save(update_fields=['current_stock'])

        res = self.client.post(
            f'/api/models/{self.model.client_id}/start_assembly_stage/',
            {'stage': 'packaging', 'vendor_name': 'ورشة تغليف'},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertTrue(res.data['assemblyStageRecord']['materials_deducted'])

        self.bags_sr.refresh_from_db()
        self.carton_sr.refresh_from_db()
        self.assertEqual(self.bags_sr.current_stock, 30.0)   # 80 - 50
        self.assertEqual(self.carton_sr.current_stock, 15.0)  # 20 - 5

        txns = PackagingMaterialTransaction.objects.filter(model_code_ref='PKG-GATE-1', operation='deduct')
        self.assertEqual(txns.count(), 2)
        self.assertTrue(AuditLog.objects.filter(target_name='PKG-GATE-1', action_type='transaction').exists())

        # تحديث لاحق لنفس مرحلة التعبئة لا يعيد الخصم أبداً (materials_deducted=True)
        res_update = self.client.post(
            f'/api/models/{self.model.client_id}/start_assembly_stage/',
            {'stage': 'packaging', 'vendor_name': 'ورشة تغليف 2', 'notes': 'تعديل موعد'},
            format='json',
        )
        self.assertEqual(res_update.status_code, status.HTTP_201_CREATED)
        self.bags_sr.refresh_from_db()
        self.carton_sr.refresh_from_db()
        self.assertEqual(self.bags_sr.current_stock, 30.0)
        self.assertEqual(self.carton_sr.current_stock, 15.0)
        self.assertEqual(
            PackagingMaterialTransaction.objects.filter(model_code_ref='PKG-GATE-1').count(), 2
        )


class DestShortageAndAllStagesReportTests(TestCase):
    def setUp(self):
        self.client, self.user = _make_admin_client('dest-admin')
        self.model = ModelItem.objects.create(
            model_code='DEST-200',
            model_type='بناتي',
            status='جاهز للدَست',
            garment_composition='two_pieces',
            garment_parts=['shirt', 'pants'],
            part_stages={'shirt': 'dest', 'pants': 'dest'},
            cut_shirt_pieces=120,
            cut_pants_pieces=120,
            qc_shirt_pieces=115,
            qc_pants_pieces=118,
            total_cut_pieces=120,
        )
        today = date.today()
        PackagingRequirement.objects.create(
            model=self.model,
            sent_to_photo_date=today,
            received_from_photo_date=today,
            sent_to_print_cards_date=today,
            received_printed_cards_date=today,
        )

    def test_dest_expected_vs_completed_and_automatic_shortage(self):
        # المتوقع الفعلي = min(115, 118) = 115 طقم
        start_res = self.client.post(
            f'/api/models/{self.model.client_id}/start_assembly_stage/',
            {'stage': 'dest', 'vendor_name': 'ورشة الدست', 'completed_pieces': 108},
            format='json',
        )
        self.assertEqual(start_res.status_code, status.HTTP_201_CREATED)
        rec = start_res.data['assemblyStageRecord']
        self.assertEqual(rec['expected_pieces'], 115)
        self.assertEqual(rec['completed_pieces'], 108)
        self.assertEqual(rec['shortage_pieces'], 7)

        # عند الاستلام النهائي بتحديث المنفذ إلى 110 → العجز يصبح 5
        recv_res = self.client.post(
            f'/api/models/{self.model.client_id}/receive_assembly_stage/',
            {'record_id': rec['id'], 'completed_pieces': 110},
            format='json',
        )
        self.assertEqual(recv_res.status_code, status.HTTP_200_OK)
        saved = recv_res.data['assemblyStageRecord']
        self.assertEqual(saved['expected_pieces'], 115)
        self.assertEqual(saved['completed_pieces'], 110)
        self.assertEqual(saved['shortage_pieces'], 5)

        # ينعكس العجز في تقرير الـ Waterfall
        wf = get_model_stage_waterfall(self.model.id)
        self.assertEqual(wf['summary']['dest_shortage'], 5)
        dest_stage = next(s for s in wf['model_stages'] if s['key'] == 'dest')
        self.assertEqual(dest_stage['in_qty'], 115)
        self.assertEqual(dest_stage['out_qty'], 110)
        self.assertEqual(dest_stage['loss'], 5)

    def test_models_report_lists_all_12_stages_in_order_including_zeros(self):
        # موديل محذوف لا يُحسب
        ModelItem.objects.create(
            model_code='DELETED-M', status='في القص', is_deleted=True
        )
        report = get_models_report()
        stages = report['stage_breakdown']
        self.assertEqual(len(stages), 12)
        expected_keys = [
            'design', 'cutting', 'qc_before_print', 'printing',
            'qc_after_print', 'sewing', 'qc_after_sewing',
            'finishing', 'ironing', 'packaging', 'dest', 'completed',
        ]
        self.assertEqual([s['key'] for s in stages], expected_keys)
        by_key = {s['key']: s['models_count'] for s in stages}
        self.assertEqual(by_key['dest'], 1)
        self.assertEqual(by_key['cutting'], 0)
        self.assertEqual(by_key['design'], 0)
