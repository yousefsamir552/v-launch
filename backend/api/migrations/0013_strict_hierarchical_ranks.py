from django.db import migrations, models


RANK_CHOICES = [
    (0, 'السيادة المطلقة (Sudo)'),
    (1, 'المستوى الأول - إدارة عليا'),
    (2, 'المستوى الثاني - إشرافي'),
    (3, 'المستوى الثالث - عام'),
]


def backfill_rank_levels(apps, schema_editor):
    """Backfill strict hierarchical ranks.

    * The immutable sudo emergency account becomes rank 0 (absolute).
    * Everyone and everything else starts at rank 3 (least privilege), so no
      existing account gains visibility over another after the upgrade.
    """
    UserProfile = apps.get_model('api', 'UserProfile')
    Role = apps.get_model('api', 'Role')
    HREmployee = apps.get_model('api', 'HREmployee')

    # Rank 0 is reserved exclusively for the sudo account.
    UserProfile.objects.update(rank_level=3)
    Role.objects.update(rank_level=3)
    HREmployee.objects.update(rank_level=3)

    UserProfile.objects.filter(
        models.Q(is_sudo=True) | models.Q(username__iexact='sudo')
    ).update(rank_level=0)


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0012_can_manage_hr_permission'),
    ]

    operations = [
        migrations.AddField(
            model_name='role',
            name='rank_level',
            field=models.IntegerField(
                choices=RANK_CHOICES,
                db_index=True,
                default=3,
                verbose_name='الرتبة الهرمية',
            ),
        ),
        migrations.AddField(
            model_name='userprofile',
            name='rank_level',
            field=models.IntegerField(
                choices=RANK_CHOICES,
                db_index=True,
                default=3,
                verbose_name='الرتبة الهرمية',
            ),
        ),
        migrations.AddField(
            model_name='hremployee',
            name='rank_level',
            field=models.IntegerField(
                choices=RANK_CHOICES,
                db_index=True,
                default=3,
                verbose_name='الرتبة الهرمية',
            ),
        ),
        migrations.RunPython(backfill_rank_levels, migrations.RunPython.noop),
    ]
