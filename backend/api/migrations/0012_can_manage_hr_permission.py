from django.db import migrations


def grant_can_manage_hr(apps, schema_editor):
    """
    Backfills the new 'can_manage_hr' permission for installations that were
    seeded before the HR permission existed.

    Any role (or user-level override) that already had full administrative
    rights ('manage_permissions') is granted HR access so that existing
    factory managers are not locked out of the HR section.
    """
    Role = apps.get_model('api', 'Role')
    UserProfile = apps.get_model('api', 'UserProfile')

    for role in Role.objects.all():
        perms = role.permissions_json if isinstance(role.permissions_json, dict) else {}
        if not perms.get('manage_permissions') or perms.get('can_manage_hr'):
            continue
        perms = {**perms, 'can_manage_hr': True}
        role.permissions_json = perms
        role.save(update_fields=['permissions_json'])

    for profile in UserProfile.objects.all():
        custom = profile.custom_permissions if isinstance(profile.custom_permissions, dict) else {}
        if not custom.get('manage_permissions') or custom.get('can_manage_hr'):
            continue
        profile.custom_permissions = {**custom, 'can_manage_hr': True}
        profile.save(update_fields=['custom_permissions'])


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0011_hrattendancesettings_hremployee_hrjobtitle_and_more'),
    ]

    operations = [
        migrations.RunPython(grant_can_manage_hr, migrations.RunPython.noop),
    ]
