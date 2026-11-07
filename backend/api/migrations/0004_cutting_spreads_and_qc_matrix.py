from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0003_global_settings_and_notes_permissions'),
    ]

    operations = [
        migrations.AddField(
            model_name='modelitem',
            name='spreader_name',
            field=models.CharField(blank=True, max_length=150, null=True, verbose_name='الفراش'),
        ),
        migrations.AddField(
            model_name='cuttingrecord',
            name='spread_number',
            field=models.IntegerField(default=1, verbose_name='رقم الفرشة'),
        ),
        migrations.AddField(
            model_name='cuttingrecord',
            name='spreader_name',
            field=models.CharField(blank=True, default='', max_length=150, verbose_name='اسم الفَرّاش (من قام بالفرش)'),
        ),
        migrations.AlterField(
            model_name='cuttingrecord',
            name='fabric_color',
            field=models.CharField(blank=True, default='', max_length=255, verbose_name='ملخص ألوان الفرشة'),
        ),
        migrations.AlterField(
            model_name='cuttingrecord',
            name='cutter_name',
            field=models.CharField(max_length=150, verbose_name='اسم المقصدار / القاصص'),
        ),
        migrations.AlterField(
            model_name='cuttingrecord',
            name='pieces_count',
            field=models.IntegerField(default=0, verbose_name='إجمالي القطع المنتجة بالفرشة'),
        ),
        migrations.AlterField(
            model_name='cuttingrecord',
            name='layers_count',
            field=models.IntegerField(default=0, verbose_name='إجمالي عدد الراقات بالفرشة'),
        ),
        migrations.AlterField(
            model_name='cuttingrecord',
            name='layer_weight',
            field=models.FloatField(default=0.0, verbose_name='إجمالي وزن الفرشة (كجم)'),
        ),
        migrations.AlterField(
            model_name='cuttingrecord',
            name='notes',
            field=models.TextField(blank=True, default='', null=True, verbose_name='ملاحظات الفرشة والقص'),
        ),
        migrations.CreateModel(
            name='CuttingSpreadLayer',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('client_id', models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='المعرف')),
                ('color_name', models.CharField(max_length=150, verbose_name='اللون / القطعة')),
                ('layers_count', models.IntegerField(default=0, verbose_name='عدد الراقات')),
                ('layer_weight', models.FloatField(blank=True, default=0.0, verbose_name='الوزن (كجم)')),
                ('pieces_count', models.IntegerField(blank=True, default=0, verbose_name='القطع الناتجة')),
                ('shade_degree', models.CharField(blank=True, default='', max_length=100, verbose_name='درجة الصبغة')),
                ('notes', models.TextField(blank=True, default='', verbose_name='ملاحظات اللون')),
                ('spread', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='color_layers', to='api.cuttingrecord', verbose_name='الفرشة')),
            ],
            options={
                'ordering': ['id'],
            },
        ),
    ]