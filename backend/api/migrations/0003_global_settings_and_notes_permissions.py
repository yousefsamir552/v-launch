from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0002_full_erp_sync'),
    ]

    operations = [
        migrations.CreateModel(
            name='GlobalSettings',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('site_name', models.CharField(default='نظام إدارة المصنع', max_length=200, verbose_name='اسم الموقع (في الهيدر)')),
                ('logo', models.TextField(blank=True, default='🏭', verbose_name='شعار الموقع (رابط صورة أو Base64 أو رمز)')),
                ('footer_title', models.CharField(default='🏭 نظام إدارة المصنع المتكامل - مصانع الملابس الجاهزة (ERP v2.0)', max_length=255, verbose_name='عنوان الفوتر')),
                ('copyright_text', models.CharField(default='تم التطوير لدعم دورة الإنتاج الشاملة والصلاحيات المتقدمة © 2026', max_length=255, verbose_name='جملة حقوق الملكية (في الفوتر)')),
                ('whatsapp_supplier_template', models.TextField(default='السلام عليكم ورحمة الله، مطلوب طلبية توريد عاجلة لمصنعنا:\n- الصنف / الخامة: {item_name}\n- الكود / اللون: {code}\n- الكمية المطلوبة: {quantity} {unit}\n- الرصيد الحالي بالمخزن: {available} {unit}\nبرجاء التأكيد وتحديد موعد الشحن. شكراً لكم.', verbose_name='نص رسالة الواتساب الجاهزة للموردين')),
                ('default_sewing_instructions', models.TextField(default='تم التأكد من أعداد الإكسسوارات ومطابقتها للمواصفات الفنية وعينة الاعتماد قبل التسليم للورشة.\nيرجى الالتزام التام بمقاسات القص والتشطيب النظيف وموعد الاستلام المتوقع.', verbose_name='التعليمات والملاحظات الافتراضية في طباعة المكن')),
                ('internal_message_templates', models.JSONField(blank=True, default=list, verbose_name='نصوص الرسائل الداخلية الجاهزة')),
                ('updated_by', models.CharField(blank=True, default='', max_length=150, verbose_name='آخر تعديل بواسطة')),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.AddField(
            model_name='modelitem',
            name='design_notes',
            field=models.TextField(blank=True, default='', null=True, verbose_name='ملاحظات قسم التصميم'),
        ),
        migrations.AddField(
            model_name='modeltimeline',
            name='details',
            field=models.JSONField(blank=True, default=dict, verbose_name='بيانات المرحلة التفصيلية وقت الحدث'),
        ),
        migrations.AlterField(
            model_name='cuttingrecord',
            name='notes',
            field=models.TextField(blank=True, default='', null=True, verbose_name='ملاحظات القص'),
        ),
    ]
