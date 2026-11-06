"""
WSGI config for core project.

It exposes the WSGI callable as a module-level variable named ``application``.
"""

import os
from django.core.wsgi import get_wsgi_application
from django.core.management import call_command

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')

application = get_wsgi_application()

# تطبيق تحديثات الجداول تلقائياً عند تشغيل الخادم على الاستضافة (Render وغيرها)
try:
    call_command('migrate', interactive=False, verbosity=1)
except Exception as exc:
    print(f"Auto-migrate notice: {exc}")
