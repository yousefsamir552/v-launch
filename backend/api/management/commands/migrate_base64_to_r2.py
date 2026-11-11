"""Moves legacy Base64 images out of PostgreSQL and into Cloudflare R2.

Usage::

    python manage.py migrate_base64_to_r2 --dry-run
    python manage.py migrate_base64_to_r2
    python manage.py migrate_base64_to_r2 --only ModelItem
    python manage.py migrate_base64_to_r2 --only ModelItem.image

Every row whose image field still contains a Base64 payload is uploaded to R2
and updated in place with the resulting public URL. Rows that already contain
a URL (or an emoji logo) are skipped, so the command is safe to re-run.
"""

from django.core.management.base import BaseCommand

from api import models
from api.storage_r2 import is_embedded_image, r2_is_configured, upload_embedded_image

TARGETS = (
    ('GlobalSettings', 'logo', 'settings', 'شعار الموقع'),
    ('Fabric', 'image', 'fabrics', 'صورة الخامة'),
    ('Accessory', 'image', 'accessories', 'صورة الصنف'),
    ('ModelItem', 'image', 'models', 'صورة الموديل'),
    ('ModelAccessory', 'image', 'model-accessories', 'صورة الإكسسوار'),
    ('HREmployee', 'photo', 'hr', 'صورة الموظف'),
)


def human_size(num_bytes):
    size = float(num_bytes)
    for unit in ('B', 'KB', 'MB', 'GB'):
        if size < 1024 or unit == 'GB':
            return '{:.1f} {}'.format(size, unit)
        size /= 1024.0
    return '{:.1f} GB'.format(size)


class Command(BaseCommand):
    help = 'يرفع الصور القديمة المخزنة كـ Base64 إلى Cloudflare R2 ويستبدلها بروابط عامة.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='اعرض الصور التي سيتم نقلها وحجمها دون رفع أي شيء.',
        )
        parser.add_argument(
            '--batch-size',
            type=int,
            default=50,
            help='حجم دفعة القراءة من قاعدة البيانات (افتراضي 50).',
        )
        parser.add_argument(
            '--only',
            default='',
            help='قصر النقل على نموذج أو حقل واحد، مثل ModelItem أو ModelItem.image.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        batch_size = max(1, options['batch_size'])
        only = (options['only'] or '').strip()

        if not dry_run and not r2_is_configured():
            self.stderr.write(self.style.ERROR(
                'تخزين R2 غير مهيأ. اضبط R2_ACCOUNT_ID و R2_ACCESS_KEY_ID و '
                'R2_SECRET_ACCESS_KEY و R2_BUCKET_NAME و R2_PUBLIC_BASE_URL أولاً.'
            ))
            return

        targets = [
            target for target in TARGETS
            if not only
            or only == target[0]
            or only == '{}.{}'.format(target[0], target[1])
        ]
        if not targets:
            self.stderr.write(self.style.ERROR('لا يوجد حقل مطابق للخيار --only.'))
            return

        total_candidates = 0
        total_migrated = 0
        total_failed = 0
        total_bytes = 0

        for model_name, field, folder, label in targets:
            model = getattr(models, model_name)
            queryset = (
                model.objects
                .exclude(**{'{}__isnull'.format(field): True})
                .exclude(**{field: ''})
            )

            candidates = 0
            migrated = 0
            failed = 0
            embedded_bytes = 0

            for obj in queryset.iterator(chunk_size=batch_size):
                value = getattr(obj, field, '')
                if not is_embedded_image(value):
                    continue

                candidates += 1
                embedded_bytes += len(value)

                if dry_run:
                    continue

                try:
                    url = upload_embedded_image(value, folder)
                except Exception as exc:  # noqa: BLE001 - report and continue
                    failed += 1
                    self.stderr.write(self.style.WARNING(
                        '[{}.{}] #{} {}: {}'.format(model_name, field, obj.pk, label, exc)
                    ))
                    continue

                # Bulk update deliberately bypasses save()/signals: we only swap
                # the legacy Base64 payload for the new public URL.
                model.objects.filter(pk=obj.pk).update(**{field: url})
                migrated += 1
                if migrated % batch_size == 0:
                    self.stdout.write('  ... تم نقل {} صورة'.format(migrated))

            total_candidates += candidates
            total_migrated += migrated
            total_failed += failed
            total_bytes += embedded_bytes

            if dry_run:
                self.stdout.write(self.style.WARNING(
                    '[dry-run] {}.{}: {} صورة Base64 ({})'.format(
                        model_name, field, candidates, human_size(embedded_bytes)
                    )
                ))
            else:
                self.stdout.write(
                    '{}.{}: {} صورة Base64 ({}) — تم نقل {} وفشل {}'.format(
                        model_name, field, candidates, human_size(embedded_bytes),
                        migrated, failed,
                    )
                )

        summary = 'الإجمالي: {} صورة Base64 ({})'.format(
            total_candidates, human_size(total_bytes)
        )
        if dry_run:
            self.stdout.write(self.style.SUCCESS('{} — لم يتم رفع أي شيء (dry-run).'.format(summary)))
        else:
            self.stdout.write(self.style.SUCCESS(
                '{} — تم نقل {} وفشل {}.'.format(summary, total_migrated, total_failed)
            ))
