"""Cloudflare R2 object storage helpers for images.

Why this module exists
----------------------
Images used to be stored as Base64 blobs inside PostgreSQL ``TextField``
columns. Every ``/state/`` sync then re-downloaded several megabytes of image
data per client, exhausting the database bandwidth quota.

Images are now written to a Cloudflare R2 bucket (S3-compatible) and only the
short public URL is persisted in PostgreSQL. This module owns:

* decoding a legacy Base64 payload (``data:image/...;base64,`` or a raw blob),
* processing it in memory with Pillow (``<=2MB`` images are stored untouched),
* uploading the bytes to R2 with an immutable cache header,
* normalising a field value on write (Base64 -> URL, URLs pass through),
* a ``save()`` guard so a Base64 payload can never be persisted by mistake.

The columns themselves are still ``TextField`` on purpose: this keeps the
migration zero-risk (no schema change, no downtime) while the content becomes
URL-only.
"""

import base64
import binascii
import io
import logging
import re
import uuid

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured, ValidationError
from django.utils import timezone

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Defaults (overridable through Django settings / environment variables)
# ---------------------------------------------------------------------------
DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024
DEFAULT_TARGET_BYTES = 2 * 1024 * 1024
DEFAULT_MAX_DIMENSION = 3200

JPEG_QUALITIES = (92, 88, 85)
WEBP_QUALITIES = (90, 85)
MIN_RESIZE_EDGE = 320

CACHE_CONTROL = 'public, max-age=31536000, immutable'

DATA_URL_RE = re.compile(r'^data:(image/[a-zA-Z0-9.+-]+);base64,', re.IGNORECASE)
FOLDER_RE = re.compile(r'^[a-z0-9][a-z0-9_-]{0,39}$')

# Base64 prefixes of the image formats browsers can render. Matching on the
# magic bytes encoded in Base64 avoids treating long plain text as an image.
EMBEDDED_PREFIXES = (
    '/9j/',          # JPEG
    'iVBORw0KGgo',   # PNG
    'R0lGOD',        # GIF87a / GIF89a
    'UklGR',         # WEBP (RIFF)
    'Qk',            # BMP
    'SUkq',          # TIFF (little-endian)
    'TU0A',          # TIFF (big-endian)
)

# Formats we can hand back to the browser untouched when they are small enough.
PASSTHROUGH_FORMATS = {
    'JPEG': ('image/jpeg', 'jpg'),
    'PNG': ('image/png', 'png'),
    'WEBP': ('image/webp', 'webp'),
    'GIF': ('image/gif', 'gif'),
}

_client = None


# ---------------------------------------------------------------------------
# Settings helpers
# ---------------------------------------------------------------------------
def _setting(name, default):
    return getattr(settings, name, default)


def max_upload_bytes():
    return int(_setting('R2_IMAGE_MAX_UPLOAD_BYTES', DEFAULT_MAX_UPLOAD_BYTES))


def target_bytes():
    return int(_setting('R2_IMAGE_TARGET_BYTES', DEFAULT_TARGET_BYTES))


def max_dimension():
    return int(_setting('R2_IMAGE_MAX_DIMENSION', DEFAULT_MAX_DIMENSION))


def r2_is_configured():
    """True when every credential needed for an upload is present."""
    required = (
        'R2_ACCOUNT_ID',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'R2_BUCKET_NAME',
        'R2_PUBLIC_BASE_URL',
    )
    for name in required:
        if not (_setting(name, '') or '').strip():
            return False
    return True


def public_base_url():
    base = (_setting('R2_PUBLIC_BASE_URL', '') or '').strip().rstrip('/')
    if not base:
        raise ImproperlyConfigured(
            'R2_PUBLIC_BASE_URL غير مضبوط. أضف رابط الوصول العام للـ Bucket في متغيرات البيئة.'
        )
    return base


def r2_endpoint_url():
    explicit = (_setting('R2_ENDPOINT_URL', '') or '').strip()
    if explicit:
        return explicit.rstrip('/')
    account_id = (_setting('R2_ACCOUNT_ID', '') or '').strip()
    if not account_id:
        raise ImproperlyConfigured('R2_ACCOUNT_ID غير مضبوط.')
    return 'https://{}.r2.cloudflarestorage.com'.format(account_id)


def get_client():
    """Returns a cached boto3 client for R2 (lazy import keeps startup light)."""
    global _client
    if _client is not None:
        return _client

    if not r2_is_configured():
        raise ImproperlyConfigured(
            'تخزين الصور السحابي (Cloudflare R2) غير مهيأ. '
            'يرجى ضبط R2_ACCOUNT_ID و R2_ACCESS_KEY_ID و R2_SECRET_ACCESS_KEY '
            'و R2_BUCKET_NAME و R2_PUBLIC_BASE_URL.'
        )

    try:
        import boto3
        from botocore.config import Config
    except ImportError as exc:  # pragma: no cover - dependency is in requirements.txt
        raise ImproperlyConfigured(
            'مكتبة boto3 مطلوبة لرفع الصور إلى Cloudflare R2. أضفها إلى requirements.txt.'
        ) from exc

    _client = boto3.client(
        's3',
        endpoint_url=r2_endpoint_url(),
        aws_access_key_id=(_setting('R2_ACCESS_KEY_ID', '') or '').strip(),
        aws_secret_access_key=(_setting('R2_SECRET_ACCESS_KEY', '') or '').strip(),
        region_name=(_setting('R2_REGION', 'auto') or 'auto').strip() or 'auto',
        config=Config(
            signature_version='s3v4',
            retries={'max_attempts': 3, 'mode': 'standard'},
            connect_timeout=10,
            read_timeout=60,
            max_pool_connections=10,
        ),
    )
    return _client


def reset_client():
    """Drops the cached client (used by tests after overriding settings)."""
    global _client
    _client = None


# ---------------------------------------------------------------------------
# Detection / decoding of legacy Base64 values
# ---------------------------------------------------------------------------
def is_embedded_image(value):
    """True when ``value`` looks like a Base64 image payload (not a URL)."""
    if not isinstance(value, str):
        return False
    text = value.strip()
    if len(text) < 100:
        return False
    if DATA_URL_RE.match(text) or ';base64,' in text[:200].lower():
        return True
    compact = ''.join(text.split())
    return len(compact) >= 100 and compact.startswith(EMBEDDED_PREFIXES)


def decode_embedded_image(value):
    """Decodes a data URL or a raw Base64 payload into raw image bytes."""
    text = (value or '').strip()
    match = DATA_URL_RE.match(text)
    if match:
        payload = text[match.end():]
    elif ';base64,' in text[:200].lower():
        payload = text[text.lower().index(';base64,') + len(';base64,'):]
    else:
        payload = text

    compact = ''.join(payload.split())
    if not compact:
        raise ValidationError('محتوى الصورة (Base64) فارغ.')
    try:
        data = base64.b64decode(compact, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise ValidationError('تعذر فك ترميز الصورة (Base64) المرفوعة.') from exc
    if not data:
        raise ValidationError('محتوى الصورة (Base64) فارغ.')
    return data


# ---------------------------------------------------------------------------
# Image processing (Pillow)
# ---------------------------------------------------------------------------
def _pillow():
    try:
        from PIL import Image, ImageOps
    except ImportError as exc:  # pragma: no cover - dependency is in requirements.txt
        raise ImproperlyConfigured(
            'مكتبة Pillow مطلوبة لمعالجة الصور قبل رفعها. أضفها إلى requirements.txt.'
        ) from exc
    return Image, ImageOps


def _encode(image, fmt, **params):
    buffer = io.BytesIO()
    image.save(buffer, format=fmt, **params)
    return buffer.getvalue()


def _has_alpha(image):
    if image.mode in ('RGBA', 'LA'):
        return True
    return image.mode == 'P' and 'transparency' in getattr(image, 'info', {})


def _compress_jpeg(image, target):
    """Progressive JPEG quality ladder (92 -> 88 -> 85), then 15% downscales."""
    Image, _ = _pillow()
    work = image.convert('RGB')
    while True:
        for quality in JPEG_QUALITIES:
            data = _encode(work, 'JPEG', quality=quality, optimize=True, progressive=True)
            if len(data) <= target:
                return data, 'image/jpeg', 'jpg'
        width, height = work.size
        if min(width, height) <= MIN_RESIZE_EDGE:
            data = _encode(work, 'JPEG', quality=JPEG_QUALITIES[-1], optimize=True, progressive=True)
            return data, 'image/jpeg', 'jpg'
        work = work.resize(
            (max(1, int(width * 0.85)), max(1, int(height * 0.85))),
            Image.LANCZOS,
        )


def _compress_alpha(image, target):
    """Lossless PNG first; WebP (alpha-safe) only when the PNG is too large."""
    Image, _ = _pillow()
    work = image if image.mode == 'RGBA' else image.convert('RGBA')

    data = _encode(work, 'PNG', optimize=True)
    if len(data) <= target:
        return data, 'image/png', 'png'

    for quality in WEBP_QUALITIES:
        data = _encode(work, 'WEBP', quality=quality, method=6)
        if len(data) <= target:
            return data, 'image/webp', 'webp'

    while min(work.size) > MIN_RESIZE_EDGE:
        width, height = work.size
        work = work.resize(
            (max(1, int(width * 0.85)), max(1, int(height * 0.85))),
            Image.LANCZOS,
        )
        data = _encode(work, 'WEBP', quality=85, method=6)
        if len(data) <= target:
            return data, 'image/webp', 'webp'

    data = _encode(work, 'WEBP', quality=80, method=6)
    return data, 'image/webp', 'webp'


def process_image(raw_bytes):
    """Validates and compresses an image, returning ``(bytes, content_type, ext)``.

    Files already at or below 2MB (and within the max dimension) are uploaded
    exactly as-is. Larger files are re-encoded with Pillow until they fit the
    2MB budget.
    """
    if not raw_bytes:
        raise ValidationError('ملف الصورة فارغ.')
    if len(raw_bytes) > max_upload_bytes():
        limit_mb = max_upload_bytes() / (1024 * 1024)
        raise ValidationError(
            'حجم الصورة أكبر من الحد المسموح ({:.0f} ميجابايت).'.format(limit_mb)
        )

    Image, ImageOps = _pillow()
    try:
        with Image.open(io.BytesIO(raw_bytes)) as probe:
            probe.load()
            fmt = (probe.format or '').upper()
            width, height = probe.size
            alpha = _has_alpha(probe)
    except Exception as exc:
        logger.info('Rejected unreadable image upload: %s', exc)
        raise ValidationError(
            'تعذر قراءة ملف الصورة. يرجى رفع صورة بصيغة JPG أو PNG أو WEBP.'
        ) from exc

    target = target_bytes()
    boundary = max_dimension()
    needs_resize = max(width, height) > boundary

    if len(raw_bytes) <= target and not needs_resize and fmt in PASSTHROUGH_FORMATS:
        content_type, extension = PASSTHROUGH_FORMATS[fmt]
        return raw_bytes, content_type, extension

    try:
        with Image.open(io.BytesIO(raw_bytes)) as image:
            image.load()
            work = ImageOps.exif_transpose(image) or image
            if max(work.size) > boundary:
                work.thumbnail((boundary, boundary), Image.LANCZOS)
            if _has_alpha(work) or alpha:
                return _compress_alpha(work, target)
            return _compress_jpeg(work, target)
    except ValidationError:
        raise
    except Exception as exc:
        logger.warning('Failed to process uploaded image: %s', exc)
        raise ValidationError('تعذر معالجة الصورة المرفوعة. يرجى تجربة صورة أخرى.') from exc


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------
def sanitize_folder(folder):
    value = (folder or 'general').strip().lower()
    if not FOLDER_RE.match(value):
        return 'general'
    return value


def build_object_key(folder, extension):
    now = timezone.now()
    return '{folder}/{year:04d}/{month:02d}/{name}.{ext}'.format(
        folder=sanitize_folder(folder),
        year=now.year,
        month=now.month,
        name=uuid.uuid4().hex,
        ext=(extension or 'jpg').lower().lstrip('.'),
    )


def public_url_for_key(key):
    return '{}/{}'.format(public_base_url(), key.lstrip('/'))


def upload_bytes(raw_bytes, content_type, extension, folder='general'):
    """Puts processed bytes into R2 and returns ``{url, key, size, content_type}``."""
    key = build_object_key(folder, extension)
    client = get_client()
    bucket = (_setting('R2_BUCKET_NAME', '') or '').strip()
    if not bucket:
        raise ImproperlyConfigured('R2_BUCKET_NAME غير مضبوط.')

    try:
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=raw_bytes,
            ContentType=content_type,
            CacheControl=CACHE_CONTROL,
        )
    except Exception as exc:
        logger.exception('Failed to upload image to R2 (key=%s)', key)
        raise ValidationError(
            'تعذر رفع الصورة إلى التخزين السحابي. يرجى المحاولة مرة أخرى.'
        ) from exc

    return {
        'url': public_url_for_key(key),
        'key': key,
        'size': len(raw_bytes),
        'content_type': content_type,
    }


def upload_image_file(uploaded_file, folder='general'):
    """Processes and uploads a Django ``UploadedFile``."""
    if uploaded_file is None:
        raise ValidationError('لم يتم إرسال ملف الصورة.')
    size = getattr(uploaded_file, 'size', None)
    if size and size > max_upload_bytes():
        limit_mb = max_upload_bytes() / (1024 * 1024)
        raise ValidationError(
            'حجم الصورة أكبر من الحد المسموح ({:.0f} ميجابايت).'.format(limit_mb)
        )
    raw = uploaded_file.read()
    processed, content_type, extension = process_image(raw)
    return upload_bytes(processed, content_type, extension, folder)


def upload_embedded_image(value, folder='general'):
    """Decodes a legacy Base64 value, processes it and uploads it to R2."""
    raw = decode_embedded_image(value)
    processed, content_type, extension = process_image(raw)
    return upload_bytes(processed, content_type, extension, folder)


# ---------------------------------------------------------------------------
# Write-path normalisation + fail-closed guard
# ---------------------------------------------------------------------------
def normalize_image_field(value, folder='general', field_label='الصورة'):
    """Normalises an image field to a URL before it is written to the database.

    * ``None`` / empty  -> ``''``
    * public URL / path -> returned unchanged (legacy emoji logos too)
    * Base64 payload    -> uploaded to R2, the public URL is returned
    """
    if value is None:
        return ''
    if not isinstance(value, str):
        raise ValidationError('{}: قيمة غير صالحة.'.format(field_label))

    text = value.strip()
    if not text:
        return ''

    if is_embedded_image(text):
        if not r2_is_configured():
            raise ValidationError(
                '{}: تخزين الصور السحابي (R2) غير مهيأ حالياً، ولا يمكن حفظ صورة بصيغة Base64. '
                'يرجى ضبط بيانات R2 في متغيرات البيئة أولاً.'.format(field_label)
            )
        return upload_embedded_image(text, folder)['url']

    if len(text) > 2048 and not text.lower().startswith(('http://', 'https://', '/')):
        raise ValidationError(
            '{}: القيمة طويلة جداً وغير صالحة. يرجى رفع الصورة ثم حفظ رابطها.'.format(field_label)
        )
    return text


def guard_image_field(instance, field_name, field_label='الصورة'):
    """Model ``save()`` guard: refuses to persist a *new* Base64 payload.

    Legacy rows that already contain Base64 are allowed to be re-saved untouched
    (so unrelated edits keep working) until ``migrate_base64_to_r2`` moves them;
    only a changed/embedded value is rejected.
    """
    value = getattr(instance, field_name, '')
    if not is_embedded_image(value):
        return

    if instance.pk:
        try:
            previous = (
                type(instance)._default_manager
                .filter(pk=instance.pk)
                .values_list(field_name, flat=True)
                .first()
            )
        except Exception:  # pragma: no cover - defensive, never break a save
            previous = None
        if previous == value:
            return

    raise ValidationError({
        field_name: (
            '{} يجب أن تكون رابطاً مباشراً بعد رفعها على التخزين السحابي، '
            'ولا يجوز حفظها كـ Base64 في قاعدة البيانات.'.format(field_label)
        )
    })
