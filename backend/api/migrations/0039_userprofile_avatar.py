# Generated manually for UserProfile.avatar

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0038_transaction_model_fk'),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='avatar',
            field=models.TextField(blank=True, default='', verbose_name='الصورة الشخصية'),
        ),
    ]
