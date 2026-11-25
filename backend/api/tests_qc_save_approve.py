"""اختبارات انحدار شاملة لحفظ واعتماد الفرز والكنترول (QC):
- منع خطأ HTTP 500 في save_matrix و record_qc_count و QCRecord.create
  و finish_qc_approval و finish_qc_to_production.
- احترام قيد التفرد uniq_qc_record_cell عند إعادة الحفظ أو تكرار الخلايا
  أو الاستدعاء بدون مصفوفة أو بخلايا فارغة اللون والمقاس.
- التعامل الآمن مع المدخلات غير الصالحة بإرجاع HTTP 400 برسالة عربية واضحة.
- التحقق من ترحيل المراحل وتسجيل سجل التدقيق AuditLog بدون أي استثناءات.
"""
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from .models import (
    AuditLog,
    ModelItem,
    ModelTimeline,
    QCRecord,
    RANK_LEVEL_TWO,
    Role,
    UserProfile,
)


class QCSaveAndApproveRegressionTests(TestCase):
    def setUp(self):
        self.qc_role = Role.objects.create(
            name='دور الفرز والكنترول',
            permissions_json={
                'qc_view': True,
                'qc_edit': True,
                'can_add_qc_before_print_notes': True,
                'can_add_qc_after_print_notes': True,
            },
            rank_level=RANK_LEVEL_TWO,
        )
        self.qc_user = UserProfile(
            username='qc_inspector_1',
            real_name='مراقب جودة تجريبي',
            role=self.qc_role,
            rank_level=RANK_LEVEL_TWO,
        )
        self.qc_user.auth_token = 'tok-qc-regression-1'
        self.qc_user.set_password('pass123')
        self.qc_user.save()

        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.qc_user.auth_token}')

        self.model_630 = ModelItem.objects.create(
            model_code='630',
            model_type='ولادي',
            status='العد قبل الطباعة',
            garment_composition='two_pieces',
            garment_parts=['shirt', 'pants'],
            target_cut_quantity=100,
            total_cut_pieces=100,
            cut_shirt_pieces=100,
            cut_pants_pieces=100,
        )

    def test_save_matrix_create_update_and_duplicate_cells(self):
        """حفظ مصفوفة قبل الطباعة لموديل 630 وتحديثها وتكرار خلايا داخل نفس الطلب دون 500."""
        payload = {
            'model_id': self.model_630.client_id,
            'stage': 'before_print',
            'part_type': 'shirt',
            'notes': 'فحص أولي',
            'matrix_entries': [
                {'part_type': 'shirt', 'color_name': 'أسود', 'size': '4', 'good_qty': 25, 'defect_qty': 1},
                {'part_type': 'shirt', 'color_name': 'أبيض', 'size': '6', 'good_qty': '30', 'defect_qty': ''},
                # خلية مكررة بنفس اللون والمقاس داخل نفس الطلب — يجب تحديثها لا رمي IntegrityError
                {'part_type': 'shirt', 'color_name': 'أسود', 'size': '4', 'good_qty': '28.0', 'defect_qty': '2'},
            ],
        }
        res1 = self.client.post('/api/qc-records/save_matrix/', payload, format='json')
        self.assertEqual(res1.status_code, status.HTTP_200_OK, res1.data)
        self.assertEqual(QCRecord.objects.filter(model=self.model_630, stage='before_print').count(), 2)
        black_rec = QCRecord.objects.get(
            model=self.model_630, stage='before_print', part_type='shirt', color_name='أسود', size='4'
        )
        self.assertEqual(black_rec.counted_pieces, 28)
        self.assertEqual(black_rec.defect_pieces, 2)

        # إعادة الحفظ لتحديث الخلايا الموجودة
        payload['matrix_entries'] = [
            {'part_type': 'shirt', 'color_name': 'أسود', 'size': '4', 'good_qty': 40, 'defect_qty': 0},
            {'part_type': 'shirt', 'color_name': 'أبيض', 'size': '6', 'good_qty': 35, 'defect_qty': 3},
        ]
        res2 = self.client.post('/api/qc-records/save_matrix/', payload, format='json')
        self.assertEqual(res2.status_code, status.HTTP_200_OK, res2.data)
        self.assertEqual(QCRecord.objects.filter(model=self.model_630, stage='before_print').count(), 2)
        self.model_630.refresh_from_db()
        self.assertEqual(self.model_630.count_before_print, 75)
        self.assertTrue(
            AuditLog.objects.filter(target_name='630', section='العد والجودة').exists()
        )

    def test_record_qc_count_approve_and_advance_stage(self):
        """تسجيل واعتماد مصفوفة الفرز وترحيل القطع ثم الحالة العامة للموديل 630 بنجاح."""
        # حفظ مسبق ثم اعتماد وتعديل نفس الخلايا وترحيل التيشرت للمطبعة
        QCRecord.objects.create(
            model=self.model_630,
            stage='before_print',
            part_type='shirt',
            color_name='كحلي',
            size='8',
            counted_pieces=20,
            defect_pieces=0,
        )

        res_shirt = self.client.post(
            f'/api/models/{self.model_630.client_id}/record_qc_count/',
            {
                'stage': 'before_print',
                'partType': 'shirt',
                'advanceStage': True,
                'defectNotes': 'اعتماد التيشرت',
                'matrixEntries': [
                    {'part_type': 'shirt', 'color_name': 'كحلي', 'size': '8', 'good_qty': 48, 'defect_qty': 2},
                    {'part_type': 'shirt', 'color_name': 'أحمر', 'size': '10', 'good_qty': 50, 'defect_qty': 0},
                ],
            },
            format='json',
        )
        self.assertEqual(res_shirt.status_code, status.HTTP_200_OK, res_shirt.data)
        self.model_630.refresh_from_db()
        self.assertEqual(self.model_630.part_stages.get('shirt'), 'printing')
        self.assertEqual(self.model_630.part_stages.get('pants'), 'qc_before_print')
        self.assertEqual(self.model_630.count_before_print, 98)

        # اعتماد البنطلون أيضاً -> ينتقل الموديل ككل لمرحلة المطابع
        res_pants = self.client.post(
            f'/api/models/{self.model_630.client_id}/record_qc_count/',
            {
                'stage': 'before_print',
                'partType': 'pants',
                'advanceStage': True,
                'matrixEntries': [
                    {'part_type': 'pants', 'color_name': 'كحلي', 'size': '8', 'good_qty': 96, 'defect_qty': 4},
                ],
            },
            format='json',
        )
        self.assertEqual(res_pants.status_code, status.HTTP_200_OK, res_pants.data)
        self.model_630.refresh_from_db()
        self.assertEqual(self.model_630.part_stages.get('pants'), 'printing')
        self.assertEqual(self.model_630.status, 'جاهز للطباعة / التجميع')
        self.assertTrue(
            ModelTimeline.objects.filter(model=self.model_630, stage='العد قبل الطباعة').exists()
        )
        self.assertTrue(
            AuditLog.objects.filter(target_name='630', action_type='status_change').exists()
        )

    def test_record_qc_count_non_matrix_repeat_does_not_raise_integrity_error(self):
        """إعادة استدعاء record_qc_count بدون matrix_entries يحدث السجل ولا يرمي IntegrityError (500)."""
        url = f'/api/models/{self.model_630.client_id}/record_qc_count/'
        body = {
            'stage': 'before_print',
            'part_type': 'shirt',
            'counted_pieces': 45,
            'defect_pieces': 3,
            'color_name': 'كحلي',
            'size': '',
            'advanceStage': False,
        }
        r1 = self.client.post(url, body, format='json')
        self.assertEqual(r1.status_code, status.HTTP_200_OK, r1.data)

        body['counted_pieces'] = 47
        body['defect_pieces'] = 1
        r2 = self.client.post(url, body, format='json')
        self.assertEqual(r2.status_code, status.HTTP_200_OK, r2.data)
        self.assertEqual(
            QCRecord.objects.filter(
                model=self.model_630, stage='before_print', part_type='shirt', color_name='كحلي', size=''
            ).count(),
            1,
        )
        rec = QCRecord.objects.get(
            model=self.model_630, stage='before_print', part_type='shirt', color_name='كحلي', size=''
        )
        self.assertEqual(rec.counted_pieces, 47)
        self.assertEqual(rec.defect_pieces, 1)

    def test_qc_record_create_empty_color_and_size_upserts_safely(self):
        """POST /api/qc-records/ مرتين بلون ومقاس فارغين لا يرمي IntegrityError (500)."""
        r1 = self.client.post(
            '/api/qc-records/',
            {
                'model_id': self.model_630.client_id,
                'stage': 'before_print',
                'part_type': 'shirt',
                'color_name': '',
                'size': '',
                'good_qty': 10,
                'defect_qty': 1,
            },
            format='json',
        )
        self.assertEqual(r1.status_code, status.HTTP_201_CREATED, r1.data)

        r2 = self.client.post(
            '/api/qc-records/',
            {
                'model_id': self.model_630.client_id,
                'stage': 'before_print',
                'part_type': 'shirt',
                'color_name': '',
                'size': '',
                'good_qty': 22,
                'defect_qty': 0,
            },
            format='json',
        )
        self.assertEqual(r2.status_code, status.HTTP_201_CREATED, r2.data)
        self.assertEqual(
            QCRecord.objects.filter(model=self.model_630, stage='before_print', part_type='shirt').count(),
            1,
        )
        self.assertEqual(r2.data['good_qty'], 22)

    def test_finish_qc_approval_and_finish_qc_to_production(self):
        """finish_qc_approval و finish_qc_to_production يعملان بدون NameError أو 500."""
        res_app = self.client.post(
            f'/api/models/{self.model_630.client_id}/finish_qc_approval/',
            {'user_name': 'مراقب جودة تجريبي'},
            format='json',
        )
        self.assertEqual(res_app.status_code, status.HTTP_200_OK, res_app.data)
        self.model_630.refresh_from_db()
        self.assertEqual(self.model_630.status, 'جاهز للطباعة / التجميع')

        # نقل الموديل إلى العد بعد المكن ثم اختباره في finish_qc_to_production
        self.model_630.status = 'العد بعد المكن'
        self.model_630.part_stages = {'shirt': 'qc_after_sewing', 'pants': 'qc_after_sewing'}
        self.model_630.save(update_fields=['status', 'part_stages'])

        res_prod = self.client.post(
            f'/api/models/{self.model_630.client_id}/finish_qc_to_production/',
            {'user_name': 'مراقب جودة تجريبي', 'notes': 'سليم بالكامل'},
            format='json',
        )
        self.assertEqual(res_prod.status_code, status.HTTP_200_OK, res_prod.data)
        self.model_630.refresh_from_db()
        self.assertEqual(self.model_630.status, 'مخزن الإنتاج التام')
        self.assertEqual(self.model_630.part_stages, {'shirt': 'completed', 'pants': 'completed'})

    def test_single_piece_model_omitting_part_type_succeeds(self):
        """موديل قطعة واحدة (single_piece) يعمل حتى عند عدم إرسال part_type في الطلب."""
        single_model = ModelItem.objects.create(
            model_code='631',
            model_type='بناتي',
            status='العد قبل الطباعة',
            garment_composition='single_piece',
            garment_parts=['single'],
            total_cut_pieces=60,
        )
        res = self.client.post(
            f'/api/models/{single_model.client_id}/record_qc_count/',
            {
                'stage': 'before_print',
                'matrixEntries': [
                    {'color_name': 'وردي', 'size': '6', 'good_qty': 58, 'defect_qty': 2},
                ],
                'advanceStage': True,
            },
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.data)
        single_model.refresh_from_db()
        self.assertEqual(single_model.part_stages.get('single'), 'printing')

    def test_invalid_inputs_return_400_never_500(self):
        """المدخلات غير الصالحة ترجع HTTP 400 برسالة عربية واضحة بدلاً من HTTP 500."""
        # 1. كمية غير رقمية
        r_bad_qty = self.client.post(
            '/api/qc-records/save_matrix/',
            {
                'model_id': self.model_630.client_id,
                'stage': 'before_print',
                'matrix_entries': [
                    {'color_name': 'أسود', 'size': '4', 'good_qty': 'abc', 'defect_qty': 0},
                ],
            },
            format='json',
        )
        self.assertEqual(r_bad_qty.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('detail', r_bad_qty.data)

        # 2. مرحلة غير معروفة
        r_bad_stage = self.client.post(
            f'/api/models/{self.model_630.client_id}/record_qc_count/',
            {'stage': 'invalid_stage', 'counted_pieces': 10},
            format='json',
        )
        self.assertEqual(r_bad_stage.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('detail', r_bad_stage.data)

        # 3. محاولة قفز مرحلة (موديل ما زال في القص)
        cutting_model = ModelItem.objects.create(
            model_code='632',
            model_type='ولادي',
            status='في القص',
            garment_composition='two_pieces',
            garment_parts=['shirt', 'pants'],
        )
        r_skip = self.client.post(
            f'/api/models/{cutting_model.client_id}/record_qc_count/',
            {
                'stage': 'before_print',
                'part_type': 'shirt',
                'counted_pieces': 10,
            },
            format='json',
        )
        self.assertEqual(r_skip.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('detail', r_skip.data)

        # 4. matrix_entries ليست قائمة
        r_bad_matrix = self.client.post(
            '/api/qc-records/save_matrix/',
            {
                'model_id': self.model_630.client_id,
                'stage': 'before_print',
                'matrix_entries': 'not-a-list',
            },
            format='json',
        )
        self.assertEqual(r_bad_matrix.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('detail', r_bad_matrix.data)
