# Generated manually to add sub-cut (قصة / جزء فرعي) flags to CuttingRecord.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0032_accessory_usage_type_carryover'),
    ]

    operations = [
        migrations.AddField(
            model_name='cuttingrecord',
            name='is_sub_cut',
            field=models.BooleanField(
                default=False,
                verbose_name='قصة / جزء فرعي (لا تُجمع على عدد القطع)',
            ),
        ),
        migrations.AddField(
            model_name='cuttingrecord',
            name='sub_cut_label',
            field=models.CharField(
                blank=True,
                default='',
                max_length=150,
                verbose_name='اسم القصة / الجزء الفرعي',
            ),
        ),
    ]
