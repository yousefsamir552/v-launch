from django.db import migrations


def fix_rule_units(apps, schema_editor):
    HRAttendanceSettings = apps.get_model('api', 'HRAttendanceSettings')
    for settings in HRAttendanceSettings.objects.all():
        rules = settings.rules_json
        if not isinstance(rules, list):
            continue
        changed = False
        fixed = []
        for rule in rules:
            if not isinstance(rule, dict):
                fixed.append(rule)
                continue
            item = dict(rule)
            violation = item.get('violation_type')
            if violation in ('late_arrival', 'early_departure') and item.get('deduction_type') == 'hours':
                # تصحيح الوحدة إلى أيام (كان الافتراضي يُحسب بالساعات بالخطأ).
                item['deduction_type'] = 'days'
                try:
                    value = float(item.get('deduction_value') or 0)
                except (TypeError, ValueError):
                    value = 0.0
                # القيم الافتراضية القديمة (0.25 / 0.5 ساعة) تعني ربع يوم.
                item['deduction_value'] = 0.25 if value in (0.25, 0.5) else value
                changed = True
            fixed.append(item)
        if changed:
            settings.rules_json = fixed
            settings.save(update_fields=['rules_json'])


def reverse(apps, schema_editor):
    # لا رجوع: تحويل الوحدات للأيام هو الصحيح.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0017_hrattendancerecord_overtime_days_and_more'),
    ]

    operations = [
        migrations.RunPython(fix_rule_units, reverse),
    ]
