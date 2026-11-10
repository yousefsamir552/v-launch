"""
Django settings for core project.
"""

from pathlib import Path
import os
import dj_database_url
from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

# قراءة المتغيرات البيئية من .env
load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Security-critical settings — provided via environment variables in production.
# ---------------------------------------------------------------------------
DATABASE_URL = os.environ.get('DATABASE_URL', '').strip()
IS_PRODUCTION = (
    bool(DATABASE_URL)
    or bool(os.environ.get('RENDER'))
    or bool(os.environ.get('VERCEL'))
    or os.environ.get('ENVIRONMENT', '').strip().lower() in ('production', 'prod')
)

_debug_env = os.environ.get('DEBUG')
if _debug_env is None:
    # Local sqlite development defaults to DEBUG=True; a remote DB (Render/Neon)
    # defaults to DEBUG=False so a forgotten env var can never leak debug pages.
    DEBUG = not IS_PRODUCTION
else:
    DEBUG = _debug_env.strip().lower() in ('1', 'true', 'yes', 'on')

SECRET_KEY = os.environ.get('SECRET_KEY', '').strip()
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = 'django-insecure-dev-only-key-do-not-use-in-production'
    else:
        raise ImproperlyConfigured(
            'SECRET_KEY environment variable is required when DEBUG is off.'
        )

# Never use '*' as a fallback: list the real hosts via ALLOWED_HOSTS.
_default_hosts = 'localhost,127.0.0.1,[::1],.onrender.com'
ALLOWED_HOSTS = [
    h.strip()
    for h in os.environ.get('ALLOWED_HOSTS', _default_hosts).split(',')
    if h.strip()
]

# Application definition
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    # 1. مكتبة الـ CORS المضافة
    'corsheaders',

    # تطبيقات الـ REST والـ API
    'rest_framework',
    'api.apps.ApiConfig',
]

# 2. CorsMiddleware يجب أن يكون في أعلى قائمة الـ MIDDLEWARE
MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'core.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'core.wsgi.application'

# Database Setup
DATABASES = {
    'default': dj_database_url.config(
        default=DATABASE_URL or f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=int(os.environ.get('DB_CONN_MAX_AGE', '600')),
        conn_health_checks=True,
    )
}

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [],
    # Fail closed: every endpoint requires a valid session token unless it
    # explicitly opts out (e.g. AuthViewSet.login).
    'DEFAULT_PERMISSION_CLASSES': [
        'api.permissions.IsAuthenticatedProfile',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'login': os.environ.get('THROTTLE_LOGIN_RATE', '5/min'),
        'sync': os.environ.get('THROTTLE_SYNC_RATE', '120/min'),
        'user': os.environ.get('THROTTLE_USER_RATE', '240/min'),
    },
}

# Enable Django's standard password strength validators.
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
     'OPTIONS': {'min_length': 6}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'ar'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# 3. إعدادات السماح للفرونت إند بالتواصل مع الباك إند
# CORS مقيّد بقائمة Origins صريحة (لا يوجد Allow-All مع Credentials).
_debug_cors = (
    'http://localhost:3000,http://127.0.0.1:3000,'
    'http://localhost:5173,http://127.0.0.1:5173'
)
CORS_ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get('CORS_ALLOWED_ORIGINS', _debug_cors if DEBUG else '').split(',')
    if o.strip()
]
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = list(CORS_ALLOWED_ORIGINS)
CORS_ALLOW_HEADERS = [
    'accept',
    'accept-encoding',
    'authorization',
    'content-type',
    'dnt',
    'origin',
    'user-agent',
    'x-csrftoken',
    'x-requested-with',
    'x-user-username',
    'x-current-user',
    'x-auth-token',
]

# ---------------------------------------------------------------------------
# Upload limits (protects memory against oversized / malformed uploads).
# ---------------------------------------------------------------------------
DATA_UPLOAD_MAX_MEMORY_SIZE = int(
    os.environ.get('DATA_UPLOAD_MAX_MEMORY_SIZE', str(10 * 1024 * 1024))
)
FILE_UPLOAD_MAX_MEMORY_SIZE = int(
    os.environ.get('FILE_UPLOAD_MAX_MEMORY_SIZE', str(10 * 1024 * 1024))
)

# ---------------------------------------------------------------------------
# Production transport / browser security headers.
# Render terminates TLS at its edge, so SECURE_SSL_REDIRECT is opt-in via env.
# ---------------------------------------------------------------------------
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SECURE_SSL_REDIRECT = os.environ.get(
    'SECURE_SSL_REDIRECT', 'False'
).strip().lower() in ('1', 'true', 'yes', 'on')
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_HSTS_SECONDS = 0 if DEBUG else int(os.environ.get('SECURE_HSTS_SECONDS', '31536000'))
SECURE_HSTS_INCLUDE_SUBDOMAINS = not DEBUG
SECURE_HSTS_PRELOAD = not DEBUG
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_BROWSER_XSS_FILTER = True
X_FRAME_OPTIONS = 'DENY'