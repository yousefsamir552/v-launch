"""Tests for the Cloudflare R2 image pipeline (api/storage_r2.py).

No real network calls: the boto3 client is mocked, so these tests run in CI
without R2 credentials.
"""

import base64
import io
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from .models import Fabric, UserProfile
from .storage_r2 import (
    is_embedded_image,
    normalize_image_field,
    process_image,
    reset_client,
)

TWO_MEGABYTES = 2 * 1024 * 1024

R2_TEST_SETTINGS = {
    'R2_ACCOUNT_ID': 'test-account',
    'R2_ACCESS_KEY_ID': 'test-key',
    'R2_SECRET_ACCESS_KEY': 'test-secret',
    'R2_BUCKET_NAME': 'test-bucket',
    'R2_PUBLIC_BASE_URL': 'https://cdn.example.com',
    'R2_ENDPOINT_URL': 'https://test-account.r2.cloudflarestorage.com',
    'R2_REGION': 'auto',
    'R2_IMAGE_MAX_UPLOAD_BYTES': 10 * 1024 * 1024,
    'R2_IMAGE_TARGET_BYTES': TWO_MEGABYTES,
    'R2_IMAGE_MAX_DIMENSION': 3200,
}


def make_jpeg(width, height, quality=95):
    image = Image.new('RGB', (width, height), (120, 30, 200))
    pixels = image.load()
    for y in range(0, height, 3):
        for x in range(0, width, 3):
            pixels[x, y] = ((x * 7) % 256, (y * 11) % 256, ((x + y) * 3) % 256)
    buffer = io.BytesIO()
    image.save(buffer, format='JPEG', quality=quality)
    return buffer.getvalue()


def make_data_url(width=64, height=64):
    raw = make_jpeg(width, height)
    return 'data:image/jpeg;base64,' + base64.b64encode(raw).decode()


class ImageProcessingTests(TestCase):
    def test_small_image_is_passed_through_untouched(self):
        raw = make_jpeg(200, 200)
        data, content_type, extension = process_image(raw)
        self.assertEqual(data, raw)
        self.assertEqual((content_type, extension), ('image/jpeg', 'jpg'))

    def test_large_image_is_compressed_under_two_megabytes(self):
        raw = make_jpeg(3000, 3000, quality=98)
        self.assertGreater(len(raw), TWO_MEGABYTES)
        data, content_type, _extension = process_image(raw)
        self.assertLessEqual(len(data), TWO_MEGABYTES)
        self.assertEqual(content_type, 'image/jpeg')

    def test_rejects_non_image_bytes(self):
        with self.assertRaises(ValidationError):
            process_image(b'this is definitely not an image')

    def test_embedded_image_detection(self):
        data_url = make_data_url()
        raw_base64 = data_url.split(';base64,', 1)[1]
        self.assertTrue(is_embedded_image(data_url))
        self.assertTrue(is_embedded_image(raw_base64))
        self.assertFalse(is_embedded_image('https://cdn.example.com/a.jpg'))
        self.assertFalse(is_embedded_image('نظام إدارة المصنع المتكامل'))
        self.assertFalse(is_embedded_image('M-101'))


@override_settings(**R2_TEST_SETTINGS)
class NormalizeImageFieldTests(TestCase):
    def tearDown(self):
        reset_client()
        super().tearDown()

    def test_url_passes_through(self):
        value = 'https://cdn.example.com/models/a.jpg'
        self.assertEqual(normalize_image_field(value, 'models'), value)

    def test_emoji_and_empty_values_pass_through(self):
        self.assertEqual(normalize_image_field('🏭', 'settings'), '🏭')
        self.assertEqual(normalize_image_field('', 'models'), '')
        self.assertEqual(normalize_image_field(None, 'models'), '')

    def test_base64_is_uploaded_and_replaced_by_public_url(self):
        with patch('api.storage_r2.get_client') as get_client:
            url = normalize_image_field(make_data_url(), 'models')

        self.assertTrue(url.startswith('https://cdn.example.com/models/'))
        self.assertTrue(url.endswith('.jpg'))

        client = get_client.return_value
        client.put_object.assert_called_once()
        kwargs = client.put_object.call_args.kwargs
        self.assertEqual(kwargs['Bucket'], 'test-bucket')
        self.assertEqual(kwargs['ContentType'], 'image/jpeg')
        self.assertIn('immutable', kwargs['CacheControl'])

    def test_model_guard_rejects_new_base64(self):
        with self.assertRaises(ValidationError):
            Fabric.objects.create(name='guard-test', image=make_data_url())

    def test_model_guard_allows_stored_urls(self):
        fabric = Fabric.objects.create(
            name='url-test', image='https://cdn.example.com/fabrics/f.jpg'
        )
        self.assertEqual(fabric.image, 'https://cdn.example.com/fabrics/f.jpg')


@override_settings(**R2_TEST_SETTINGS)
class ImageUploadEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = UserProfile.objects.create(
            username='uploader',
            real_name='Uploader',
            auth_token='token-uploader',
            is_active=True,
        )

    def tearDown(self):
        reset_client()
        super().tearDown()

    def _uploaded_file(self, raw=None):
        return SimpleUploadedFile(
            'photo.jpg', raw or make_jpeg(64, 64), content_type='image/jpeg'
        )

    def test_requires_authentication(self):
        anonymous = APIClient()
        response = anonymous.post(
            '/api/upload-image/', {'file': self._uploaded_file()}, format='multipart'
        )
        self.assertIn(response.status_code, (401, 403))

    def test_missing_file_returns_400(self):
        self.client.credentials(HTTP_AUTHORIZATION='Bearer token-uploader')
        response = self.client.post('/api/upload-image/', {}, format='multipart')
        self.assertEqual(response.status_code, 400)
        self.assertIn('detail', response.json())

    def test_invalid_image_returns_400(self):
        self.client.credentials(HTTP_AUTHORIZATION='Bearer token-uploader')
        response = self.client.post(
            '/api/upload-image/',
            {'file': SimpleUploadedFile('x.txt', b'not an image', content_type='text/plain')},
            format='multipart',
        )
        self.assertEqual(response.status_code, 400)

    def test_upload_returns_public_url(self):
        self.client.credentials(HTTP_AUTHORIZATION='Bearer token-uploader')
        with patch('api.storage_r2.get_client') as get_client:
            response = self.client.post(
                '/api/upload-image/',
                {'file': self._uploaded_file(), 'folder': 'models'},
                format='multipart',
            )

        self.assertEqual(response.status_code, 201, response.content)
        payload = response.json()
        self.assertTrue(payload['url'].startswith('https://cdn.example.com/models/'))
        self.assertEqual(payload['content_type'], 'image/jpeg')
        self.assertGreater(payload['size'], 0)
        get_client.return_value.put_object.assert_called_once()

    def test_unconfigured_storage_fails_closed(self):
        self.client.credentials(HTTP_AUTHORIZATION='Bearer token-uploader')
        with override_settings(R2_ACCESS_KEY_ID=''):
            response = self.client.post(
                '/api/upload-image/', {'file': self._uploaded_file()}, format='multipart'
            )
        self.assertEqual(response.status_code, 503)
