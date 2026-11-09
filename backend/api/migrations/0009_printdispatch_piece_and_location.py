from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0008_garment_composition'),
    ]

    operations = [
        # جزء الطباعة: نوع القطعة المرسلة ومكان/تفاصيل الطباعة
        # (مطابقةً لموديل الخياطة SewingDispatch الذي يملك piece_type/piece_label مسبقاً).
        migrations.AddField(
            model_name='printdispatch',
            name='piece_type',
            field=models.CharField(
                choices=[
                    ('shirt', 'تيشرت'),
                    ('pants', 'بنطلون'),
                    ('jacket', 'جاكيت'),
                    ('single', 'قطعة واحدة / كامل'),
                ],
                default='shirt',
                max_length=20,
                verbose_name='نوع القطعة',
            ),
        ),
        migrations.AddField(
            model_name='printdispatch',
            name='piece_label',
            field=models.CharField(blank=True, max_length=50, null=True, verbose_name='مسمى القطعة'),
        ),
        migrations.AddField(
            model_name='printdispatch',
            name='print_location',
            field=models.CharField(blank=True, default='', max_length=200, verbose_name='مكان الطباعة (صدر / ظهر / كم / تطريز)'),
        ),
        migrations.AddField(
            model_name='printdispatch',
            name='print_details',
            field=models.TextField(blank=True, null=True, verbose_name='تفاصيل الطباعة'),
        ),
    ]
