from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0004_cutting_spreads_and_qc_matrix'),
    ]

    operations = [
        migrations.AddField(
            model_name='cuttingrecord',
            name='pieces_per_layer',
            field=models.IntegerField(default=0, verbose_name='عدد القطع في الراق'),
        ),
        migrations.AlterField(
            model_name='cuttingrecord',
            name='pieces_count',
            field=models.IntegerField(default=0, verbose_name='عدد القطع المقصوصة (الراقات × قطع الراق)'),
        ),
        migrations.AlterField(
            model_name='cuttingrecord',
            name='layer_weight',
            field=models.FloatField(default=0.0, verbose_name='إجمالي وزن الراق (كجم)'),
        ),
    ]