from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    """
    Assembly & Packaging section (الأسمبلي والأمبالاج):
    - Role permission flag + new model statuses.
    - PackagingRequirement / FinishingRecord / AssemblyStageRecord.
    """

    dependencies = [
        ('api', '0009_printdispatch_piece_and_location'),
    ]

    operations = [
        migrations.AddField(
            model_name='role',
            name='can_assembly_packaging',
            field=models.BooleanField(default=False, verbose_name='الأسمبلي والأمبالاج'),
        ),
        migrations.AlterField(
            model_name='appnotification',
            name='stage',
            field=models.CharField(
                choices=[
                    ('printing', 'المطابع والتطريز'),
                    ('sewing', 'ورش المكن والخياطة'),
                    ('finishing', 'قسم التشطيب'),
                    ('ironing', 'قسم المكواة'),
                    ('packaging', 'قسم التعبئة والتغليف'),
                ],
                max_length=20,
                verbose_name='المرحلة',
            ),
        ),
        migrations.AlterField(
            model_name='modelitem',
            name='status',
            field=models.CharField(
                choices=[
                    ('مرحلة التصميم', 'مرحلة التصميم'),
                    ('تصميم', 'تصميم'),
                    ('في القص', 'في القص'),
                    ('جاري القص', 'جاري القص'),
                    ('العد قبل الطباعة', 'العد قبل الطباعة'),
                    ('فرز قبل الطباعة', 'فرز قبل الطباعة'),
                    ('فرز وكنترول', 'فرز وكنترول (قبل الطباعة)'),
                    ('جاهز للطباعة / التجميع', 'جاهز للطباعة / التجميع'),
                    ('جاهز للمطبعة', 'جاهز للمطبعة'),
                    ('مرسل للمطبعة', 'مرسل للمطبعة'),
                    ('في المطبعة', 'في المطبعة'),
                    ('العد بعد الطباعة', 'العد بعد الطباعة'),
                    ('في قسم المكن', 'في قسم المكن (الخياطة)'),
                    ('العد بعد المكن', 'العد بعد المكن (الفحص النهائي)'),
                    ('في التشطيب', 'في التشطيب'),
                    ('في المكواة', 'في المكواة'),
                    ('في التعبئة والتغليف', 'في التعبئة والتغليف'),
                    ('جاهز للدَست', 'جاهز للدَست'),
                    ('مخزن الإنتاج التام', 'مخزن الإنتاج التام'),
                    ('مكتمل الإنتاج', 'مكتمل الإنتاج (مخزن الإنتاج)'),
                ],
                default='مرحلة التصميم',
                max_length=50,
                verbose_name='الحالة',
            ),
        ),
        migrations.CreateModel(
            name='PackagingRequirement',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('client_id', models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='المعرف')),
                ('sent_to_photo_date', models.DateField(blank=True, null=True, verbose_name='تاريخ إرسال العينة للتصوير')),
                ('received_from_photo_date', models.DateField(blank=True, null=True, verbose_name='تاريخ استلام الصور من المصور')),
                ('sent_to_print_cards_date', models.DateField(blank=True, null=True, verbose_name='تاريخ إرسال الصور للمطبعة')),
                ('received_printed_cards_date', models.DateField(blank=True, null=True, verbose_name='تاريخ استلام الورق المطبوع')),
                ('notes', models.TextField(blank=True, null=True, verbose_name='ملاحظات الأمبالاج')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('model', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='packaging_requirement', to='api.modelitem', verbose_name='الموديل')),
            ],
            options={
                'ordering': ['-updated_at', '-id'],
            },
        ),
        migrations.CreateModel(
            name='FinishingRecord',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('client_id', models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='المعرف')),
                ('part_type', models.CharField(choices=[('shirt', 'تيشرت'), ('pants', 'بنطلون'), ('jacket', 'جاكيت'), ('single', 'قطعة واحدة / كامل')], default='shirt', max_length=20, verbose_name='نوع القطعة')),
                ('piece_label', models.CharField(blank=True, max_length=50, null=True, verbose_name='مسمى القطعة')),
                ('entry_date', models.DateField(blank=True, null=True, verbose_name='تاريخ دخول التشطيب')),
                ('expected_exit_date', models.DateField(blank=True, null=True, verbose_name='تاريخ الخروج المتوقع')),
                ('actual_exit_date', models.DateField(blank=True, null=True, verbose_name='تاريخ الاستلام الفعلي')),
                ('notes', models.TextField(blank=True, null=True, verbose_name='ملاحظات التشطيب')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('model', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='finishing_records', to='api.modelitem', verbose_name='الموديل')),
            ],
            options={
                'ordering': ['-created_at', '-id'],
                'unique_together': {('model', 'part_type')},
            },
        ),
        migrations.CreateModel(
            name='AssemblyStageRecord',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('client_id', models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='المعرف')),
                ('stage', models.CharField(choices=[('ironing', 'قسم المكواة'), ('packaging', 'قسم التعبئة والتغليف'), ('dest', 'قسم الدَست')], max_length=20, verbose_name='المرحلة')),
                ('entry_date', models.DateField(blank=True, null=True, verbose_name='تاريخ الدخول')),
                ('expected_exit_date', models.DateField(blank=True, null=True, verbose_name='تاريخ الخروج المتوقع')),
                ('actual_exit_date', models.DateField(blank=True, null=True, verbose_name='تاريخ الخروج الفعلي')),
                ('notes', models.TextField(blank=True, null=True, verbose_name='ملاحظات المرحلة')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('model', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='assembly_stage_records', to='api.modelitem', verbose_name='الموديل')),
            ],
            options={
                'ordering': ['-created_at', '-id'],
                'unique_together': {('model', 'stage')},
            },
        ),
    ]
