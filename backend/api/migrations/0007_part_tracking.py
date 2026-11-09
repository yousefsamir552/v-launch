from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0006_userprofile_last_seen'),
    ]

    operations = [
        # --- ModelItem: per-part (تيشرت / بنطلون / جاكيت) tracking ---
        migrations.AddField(
            model_name='modelitem',
            name='garment_parts',
            field=models.JSONField(blank=True, default=list, verbose_name='قطع الموديل'),
        ),
        migrations.AddField(
            model_name='modelitem',
            name='cut_shirt_pieces',
            field=models.IntegerField(blank=True, default=0, verbose_name='المقصوص تيشرت'),
        ),
        migrations.AddField(
            model_name='modelitem',
            name='cut_pants_pieces',
            field=models.IntegerField(blank=True, default=0, verbose_name='المقصوص بنطلون'),
        ),
        migrations.AddField(
            model_name='modelitem',
            name='cut_jacket_pieces',
            field=models.IntegerField(blank=True, default=0, verbose_name='المقصوص جاكيت'),
        ),
        migrations.AddField(
            model_name='modelitem',
            name='qc_shirt_pieces',
            field=models.IntegerField(blank=True, default=0, verbose_name='السليم تيشرت'),
        ),
        migrations.AddField(
            model_name='modelitem',
            name='qc_pants_pieces',
            field=models.IntegerField(blank=True, default=0, verbose_name='السليم بنطلون'),
        ),
        migrations.AddField(
            model_name='modelitem',
            name='qc_jacket_pieces',
            field=models.IntegerField(blank=True, default=0, verbose_name='السليم جاكيت'),
        ),
        # --- CuttingRecord: which garment part this spread belongs to ---
        migrations.AddField(
            model_name='cuttingrecord',
            name='part_type',
            field=models.CharField(
                choices=[('shirt', 'تيشرت'), ('pants', 'بنطلون'), ('jacket', 'جاكيت'), ('single', 'قطعة واحدة / كامل')],
                default='shirt',
                max_length=20,
                verbose_name='نوع القطعة',
            ),
        ),
        # --- QCRecord: which garment part this matrix cell belongs to ---
        migrations.AddField(
            model_name='qcrecord',
            name='part_type',
            field=models.CharField(
                choices=[('shirt', 'تيشرت'), ('pants', 'بنطلون'), ('jacket', 'جاكيت'), ('single', 'قطعة واحدة / كامل')],
                default='shirt',
                max_length=20,
                verbose_name='نوع القطعة',
            ),
        ),
        # --- SewingDispatch: allow jacket / single piece types ---
        migrations.AlterField(
            model_name='sewingdispatch',
            name='piece_type',
            field=models.CharField(
                choices=[('shirt', 'تيشرت'), ('pants', 'بنطلون'), ('jacket', 'جاكيت'), ('single', 'قطعة واحدة / كامل')],
                default='shirt',
                max_length=20,
                verbose_name='نوع القطعة',
            ),
        ),
    ]
