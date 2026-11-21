# Generated manually to sync Accessory.usage_type choices (carryover option).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0031_partial_receipts'),
    ]

    operations = [
        migrations.AlterField(
            model_name='accessory',
            name='usage_type',
            field=models.CharField(
                choices=[
                    ('stock', 'رصيد مستمر (Stock)'),
                    ('custom_model', 'استخدام واحد لموديل معين'),
                    ('carryover', 'رصيد سابق / مرحّل (من موسم سابق)'),
                ],
                default='stock',
                max_length=20,
                verbose_name='نوع الاستخدام',
            ),
        ),
    ]
