from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0007_part_tracking'),
    ]

    operations = [
        # Model-level garment composition (تيشيرت فقط / بنطلون فقط / قطعتان / ثلاث قطع)
        # Drives which parts appear in Design, Cutting and QC.
        migrations.AddField(
            model_name='modelitem',
            name='garment_composition',
            field=models.CharField(
                blank=True,
                choices=[
                    ('tshirt_only', 'تيشيرت فقط'),
                    ('pants_only', 'بنطلون فقط'),
                    ('two_pieces', 'قطعتان (تيشيرت + بنطلون)'),
                    ('three_pieces', 'ثلاث قطع (تيشيرت + بنطلون + جاكيت)'),
                ],
                default='two_pieces',
                max_length=30,
                verbose_name='تكوين قطع الموديل',
            ),
        ),
    ]
