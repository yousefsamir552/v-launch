# Generated manually to track the actual accessory issue cycle
# (صرف وتسليم الإكسسوارات من مخزن الإكسسوارات).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0033_cuttingrecord_sub_cut'),
    ]

    operations = [
        migrations.AddField(
            model_name='modelaccessory',
            name='is_issued',
            field=models.BooleanField(
                default=False,
                verbose_name='تم صرف الإكسسوار فعلياً',
            ),
        ),
        migrations.AddField(
            model_name='modelaccessory',
            name='issued_quantity',
            field=models.FloatField(
                default=0.0,
                verbose_name='الكمية المصروفة فعلياً',
            ),
        ),
        migrations.AddField(
            model_name='modelaccessory',
            name='issued_to',
            field=models.CharField(
                blank=True,
                default='',
                max_length=150,
                verbose_name='اسم المستلم',
            ),
        ),
        migrations.AddField(
            model_name='modelaccessory',
            name='issued_at',
            field=models.CharField(
                blank=True,
                default='',
                max_length=100,
                verbose_name='تاريخ ووقت الصرف',
            ),
        ),
        migrations.AddField(
            model_name='modelaccessory',
            name='issued_by',
            field=models.CharField(
                blank=True,
                default='',
                max_length=150,
                verbose_name='أمين المخزن المنفذ للصرف',
            ),
        ),
    ]
