# Generated for Phase 1: independent per-part stage tracking
# (shirt / pants / jacket) in the assembly & packaging section.

from django.db import migrations, models


PART_STAGES_ORDER = [
    'cutting',
    'qc_before_print',
    'printing',
    'qc_after_print',
    'sewing',
    'qc_after_sewing',
    'finishing',
    'ironing',
    'packaging',
    'dest',
    'completed',
]

STATUS_TO_STAGE = {
    'في التشطيب': 'finishing',
    'في المكواة': 'ironing',
    'في التعبئة والتغليف': 'packaging',
    'جاهز للدَست': 'dest',
    'مخزن الإنتاج التام': 'completed',
    'مكتمل الإنتاج': 'completed',
}

COMPOSITION_TO_PARTS = {
    'tshirt_only': ['shirt'],
    'pants_only': ['pants'],
    'two_pieces': ['shirt', 'pants'],
    'three_pieces': ['shirt', 'pants', 'jacket'],
}


def initialize_part_stages(apps, schema_editor):
    """Seeds ModelItem.part_stages for the models that already reached assembly."""
    ModelItem = apps.get_model('api', 'ModelItem')
    FinishingRecord = apps.get_model('api', 'FinishingRecord')
    AssemblyStageRecord = apps.get_model('api', 'AssemblyStageRecord')

    for model in ModelItem.objects.all().iterator():
        parts = [p for p in (model.garment_parts or []) if p in ('shirt', 'pants', 'jacket')]
        if not parts:
            parts = COMPOSITION_TO_PARTS.get(
                model.garment_composition or 'two_pieces', ['shirt', 'pants']
            )
        # Deduplicate while preserving the canonical order.
        parts = list(dict.fromkeys(parts))

        base = STATUS_TO_STAGE.get(model.status, 'cutting')
        implied = {part: [] for part in parts}

        def imply(part_key, stage):
            if part_key in implied:
                implied[part_key].append(stage)

        for record in FinishingRecord.objects.filter(model=model):
            imply(
                record.part_type or 'shirt',
                'ironing' if record.actual_exit_date else 'finishing',
            )

        # Legacy rows have part_type='' until this migration, so they cannot pin a part.
        for record in AssemblyStageRecord.objects.filter(
            model=model, stage='ironing'
        ).exclude(part_type=''):
            imply(record.part_type, 'packaging' if record.actual_exit_date else 'ironing')

        packaging_done = AssemblyStageRecord.objects.filter(
            model=model, stage='packaging', actual_exit_date__isnull=False
        ).exists()
        dest_done = AssemblyStageRecord.objects.filter(
            model=model, stage='dest', actual_exit_date__isnull=False
        ).exists()

        stages = {}
        for part in parts:
            candidates = list(implied.get(part) or [])
            if packaging_done:
                candidates.append('dest')
            if dest_done:
                candidates.append('completed')
            stages[part] = (
                max(candidates, key=PART_STAGES_ORDER.index) if candidates else base
            )

        ModelItem.objects.filter(pk=model.pk).update(part_stages=stages)


def unset_part_stages(apps, schema_editor):
    ModelItem = apps.get_model('api', 'ModelItem')
    ModelItem.objects.update(part_stages={})


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0014_alter_cuttingrecord_options_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='modelitem',
            name='part_stages',
            field=models.JSONField(blank=True, default=dict, verbose_name='مراحل القطع المستقلة'),
        ),
        migrations.AddField(
            model_name='finishingrecord',
            name='vendor_name',
            field=models.CharField(
                blank=True, default='', max_length=150, verbose_name='الجهة / ورشة التشطيب'
            ),
        ),
        migrations.AddField(
            model_name='assemblystagerecord',
            name='part_type',
            field=models.CharField(
                blank=True, default='', max_length=20, verbose_name='نوع القطعة (للمكواة)'
            ),
        ),
        migrations.AddField(
            model_name='assemblystagerecord',
            name='vendor_name',
            field=models.CharField(
                blank=True, default='', max_length=150, verbose_name='الجهة / الورشة'
            ),
        ),
        migrations.AlterUniqueTogether(
            name='assemblystagerecord',
            unique_together={('model', 'stage', 'part_type')},
        ),
        migrations.RunPython(initialize_part_stages, unset_part_stages),
    ]
