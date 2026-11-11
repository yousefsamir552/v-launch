from django.db import migrations, models


# مفاتيح "الأسمبلي والأمبالاج" المعتمدة (المفتاح الحالي + البدائل القديمة/الفرعية).
# نسخة محلية داخل الترحيل حتى يظل مستقلاً عن أي تغييرات لاحقة في models.py.
ASSEMBLY_ACCESS_KEYS = (
    'assembly_packaging',
    'assembly',
    'packaging',
    'finishing',
    'ironing',
    'dest',
    'materials',
)


def backfill_assembly_permissions(apps, schema_editor):
    """Ensure roles saved before the key unification keep their assembly access."""
    Role = apps.get_model('api', 'Role')
    for role in Role.objects.all().iterator():
        perms = role.permissions_json if isinstance(role.permissions_json, dict) else {}
        view = bool(perms.get('assembly_packaging_view'))
        edit = bool(perms.get('assembly_packaging_edit'))
        for key in ASSEMBLY_ACCESS_KEYS:
            view = view or bool(perms.get('{}_view'.format(key)))
            edit = edit or bool(perms.get('{}_edit'.format(key)))
        # الأدوار الإدارية الكاملة (manage_permissions) تظل قادرة على دخول القسم بعد توحيد المفتاح.
        if perms.get('manage_permissions'):
            view = True
            edit = True
        if view or edit:
            perms['assembly_packaging_view'] = True
            perms['assembly_packaging_edit'] = edit
            role.permissions_json = perms
            role.can_assembly_packaging = True
            role.save(update_fields=['permissions_json', 'can_assembly_packaging'])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0021_workshop_supplier_whatsapp_group_link'),
    ]

    operations = [
        migrations.AlterField(
            model_name='hrjobtitle',
            name='department',
            field=models.CharField(choices=[('design', 'التصميم'), ('cutting', 'القص'), ('fabric_warehouse', 'مخزن القماش'), ('accessories_warehouse', 'مخزن الإكسسوارات'), ('sorting_control', 'الفرز والكنترول'), ('sewing', 'المكن والخياطة'), ('finishing', 'التشطيب'), ('ironing', 'المكواة'), ('packaging', 'التعبئة والتغليف'), ('administration', 'الإداريين'), ('crow', 'العمال (Crew)'), ('accounting', 'المحاسبين (Accounting)')], default='sewing', max_length=50, verbose_name='القسم / مكان العمل'),
        ),
        migrations.RunPython(backfill_assembly_permissions, noop_reverse),
    ]
