from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0005_cuttingrecord_pieces_per_layer'),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='last_seen',
            field=models.DateTimeField(blank=True, null=True, verbose_name='آخر تواجد (Online)'),
        ),
    ]
