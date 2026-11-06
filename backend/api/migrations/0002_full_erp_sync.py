from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='SystemSetting',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('key', models.CharField(max_length=100, unique=True, verbose_name='المفتاح')),
                ('value', models.JSONField(blank=True, default=dict, verbose_name='القيمة')),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.CreateModel(
            name='SizeDef',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('client_id', models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='المعرف')),
                ('name', models.CharField(max_length=100, verbose_name='اسم الفئة')),
                ('values', models.CharField(max_length=255, verbose_name='المقاسات')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
        ),
        migrations.CreateModel(
            name='Supplier',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('client_id', models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='المعرف')),
                ('name', models.CharField(max_length=200, verbose_name='اسم المورد')),
                ('phone', models.CharField(blank=True, default='', max_length=50, verbose_name='رقم الهاتف')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
        ),
        migrations.CreateModel(
            name='AccessoryType',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('client_id', models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='المعرف')),
                ('name', models.CharField(max_length=150, verbose_name='اسم التصنيف')),
                ('icon', models.CharField(blank=True, default='Sparkles', max_length=50, verbose_name='الأيقونة')),
                ('description', models.TextField(blank=True, default='', verbose_name='الوصف')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
        ),
        migrations.CreateModel(
            name='AuditLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('client_id', models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='المعرف')),
                ('user_id_ref', models.CharField(blank=True, max_length=100, null=True, verbose_name='معرف المستخدم')),
                ('user_name', models.CharField(max_length=200, verbose_name='اسم المستخدم')),
                ('action', models.CharField(max_length=150, verbose_name='الإجراء')),
                ('details', models.TextField(verbose_name='التفاصيل')),
                ('ip_address', models.CharField(default='127.0.0.1', max_length=60, verbose_name='عنوان IP')),
                ('timestamp', models.CharField(blank=True, default='', max_length=100, verbose_name='التاريخ والوقت')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'ordering': ['-created_at', '-id'],
            },
        ),
        # Role additions
        migrations.AddField(
            model_name='role',
            name='client_id',
            field=models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='المعرف'),
        ),
        migrations.AddField(
            model_name='role',
            name='permissions_json',
            field=models.JSONField(blank=True, default=dict, verbose_name='صلاحيات العرض والتعديل التفصيلية'),
        ),
        # UserProfile additions
        migrations.AddField(
            model_name='userprofile',
            name='client_id',
            field=models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='المعرف'),
        ),
        migrations.AddField(
            model_name='userprofile',
            name='password_hash',
            field=models.CharField(blank=True, default='', max_length=255, verbose_name='كلمة المرور المشفرة'),
        ),
        migrations.AddField(
            model_name='userprofile',
            name='phone',
            field=models.CharField(blank=True, max_length=50, null=True, verbose_name='رقم الهاتف'),
        ),
        migrations.AddField(
            model_name='userprofile',
            name='role_title',
            field=models.CharField(blank=True, max_length=150, null=True, verbose_name='مسمى الدور الوظيفي'),
        ),
        migrations.AddField(
            model_name='userprofile',
            name='last_active',
            field=models.DateTimeField(blank=True, null=True, verbose_name='آخر ظهور'),
        ),
        migrations.AddField(
            model_name='userprofile',
            name='auth_token',
            field=models.CharField(blank=True, db_index=True, max_length=128, null=True, verbose_name='رمز الجلسة'),
        ),
        # Fabric additions
        migrations.AddField(
            model_name='fabric',
            name='client_id',
            field=models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='المعرف'),
        ),
        migrations.AddField(
            model_name='fabric',
            name='description',
            field=models.TextField(blank=True, default='', null=True, verbose_name='الوصف'),
        ),
        migrations.AddField(
            model_name='fabric',
            name='unit',
            field=models.CharField(default='كيلو', max_length=30, verbose_name='الوحدة'),
        ),
        migrations.AddField(
            model_name='fabric',
            name='supplier_id_ref',
            field=models.CharField(blank=True, max_length=100, null=True, verbose_name='معرف المورد'),
        ),
        migrations.AddField(
            model_name='fabric',
            name='image',
            field=models.TextField(blank=True, null=True, verbose_name='صورة الخامة'),
        ),
        migrations.AddField(
            model_name='fabric',
            name='is_deleted',
            field=models.BooleanField(default=False),
        ),
        migrations.AlterField(
            model_name='fabric',
            name='color',
            field=models.CharField(blank=True, default='', max_length=100, verbose_name='اللون'),
        ),
        migrations.CreateModel(
            name='FabricColor',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('client_id', models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='المعرف')),
                ('color_code', models.CharField(max_length=100, verbose_name='كود اللون')),
                ('color_name', models.CharField(blank=True, default='', max_length=150, verbose_name='اسم اللون')),
                ('hex_code', models.CharField(default='#64748b', max_length=30, verbose_name='درجة اللون')),
                ('price_per_unit', models.FloatField(default=0.0, verbose_name='سعر الوحدة')),
                ('quantity', models.FloatField(default=0.0, verbose_name='الكمية الفعلية')),
                ('reserved_quantity', models.FloatField(default=0.0, verbose_name='الكمية المحجوزة')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('fabric', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='colors', to='api.fabric', verbose_name='الخامة')),
            ],
        ),
        migrations.CreateModel(
            name='FabricTransaction',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('client_id', models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='المعرف')),
                ('model_code_ref', models.CharField(blank=True, default='', max_length=150, verbose_name='المرجع / كود الموديل')),
                ('notes', models.TextField(blank=True, default='', verbose_name='ملاحظات')),
                ('operation', models.CharField(default='deduct', max_length=20, verbose_name='نوع العملية')),
                ('amount', models.FloatField(default=0.0, verbose_name='الكمية')),
                ('timestamp', models.CharField(blank=True, default='', max_length=100, verbose_name='التوقيت')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('color', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='transactions', to='api.fabriccolor', verbose_name='اللون')),
                ('fabric', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='transactions', to='api.fabric', verbose_name='الخامة')),
            ],
            options={
                'ordering': ['-created_at', '-id'],
            },
        ),
        # Accessory additions
        migrations.AddField(
            model_name='accessory',
            name='client_id',
            field=models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='المعرف'),
        ),
        migrations.AddField(
            model_name='accessory',
            name='type_id_ref',
            field=models.CharField(blank=True, default='type-1', max_length=100, verbose_name='معرف التصنيف'),
        ),
        migrations.AddField(
            model_name='accessory',
            name='type_name',
            field=models.CharField(blank=True, default='عام', max_length=150, verbose_name='اسم التصنيف'),
        ),
        migrations.AddField(
            model_name='accessory',
            name='code',
            field=models.CharField(blank=True, default='', max_length=100, verbose_name='كود الصنف'),
        ),
        migrations.AddField(
            model_name='accessory',
            name='image',
            field=models.TextField(blank=True, null=True, verbose_name='صورة الصنف'),
        ),
        migrations.AddField(
            model_name='accessory',
            name='reserved_quantity',
            field=models.FloatField(default=0.0, verbose_name='الكمية المحجوزة'),
        ),
        migrations.AddField(
            model_name='accessory',
            name='supplier_id_ref',
            field=models.CharField(blank=True, max_length=100, null=True, verbose_name='معرف المورد'),
        ),
        migrations.AddField(
            model_name='accessory',
            name='created_at_str',
            field=models.CharField(blank=True, max_length=50, null=True, verbose_name='تاريخ الإضافة'),
        ),
        migrations.CreateModel(
            name='AccessoryTransaction',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('client_id', models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='المعرف')),
                ('accessory_code', models.CharField(blank=True, default='', max_length=100, verbose_name='كود الصنف')),
                ('accessory_name', models.CharField(blank=True, default='', max_length=200, verbose_name='اسم الصنف')),
                ('operation', models.CharField(default='deduct', max_length=20, verbose_name='نوع العملية')),
                ('amount', models.FloatField(default=0.0, verbose_name='الكمية')),
                ('model_code_ref', models.CharField(blank=True, default='', max_length=150, verbose_name='كود الموديل')),
                ('notes', models.TextField(blank=True, default='', verbose_name='ملاحظات')),
                ('timestamp', models.CharField(blank=True, default='', max_length=100, verbose_name='التوقيت')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('accessory', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='transactions', to='api.accessory', verbose_name='الإكسسوار')),
            ],
            options={
                'ordering': ['-created_at', '-id'],
            },
        ),
        # ModelItem additions
        migrations.AddField(
            model_name='modelitem',
            name='client_id',
            field=models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='المعرف'),
        ),
        migrations.AddField(
            model_name='modelitem',
            name='size_category_id',
            field=models.CharField(blank=True, max_length=100, null=True, verbose_name='فئة المقاسات'),
        ),
        migrations.AddField(
            model_name='modelitem',
            name='main_marker_url',
            field=models.CharField(blank=True, default='', max_length=255, verbose_name='الماركر الأساسي'),
        ),
        migrations.AddField(
            model_name='modelitem',
            name='print_marker_url',
            field=models.CharField(blank=True, default='', max_length=255, verbose_name='ماركر الطباعة'),
        ),
        migrations.AddField(
            model_name='modelitem',
            name='colored_at',
            field=models.CharField(blank=True, max_length=100, null=True, verbose_name='تاريخ التلوين'),
        ),
        migrations.AddField(
            model_name='modelitem',
            name='cut_at',
            field=models.CharField(blank=True, max_length=100, null=True, verbose_name='تاريخ القص'),
        ),
        migrations.CreateModel(
            name='ModelRequirement',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('client_id', models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='المعرف')),
                ('part_name', models.CharField(max_length=150, verbose_name='اسم القطعة / الجزء')),
                ('planned_quantity', models.FloatField(default=0.0, verbose_name='الكمية المخططة')),
                ('color', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='requirements', to='api.fabriccolor', verbose_name='اللون')),
                ('model', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='requirements', to='api.modelitem', verbose_name='الموديل')),
            ],
        ),
        # ModelAccessory additions
        migrations.AddField(
            model_name='modelaccessory',
            name='client_id',
            field=models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='المعرف'),
        ),
        migrations.AddField(
            model_name='modelaccessory',
            name='accessory_id_ref',
            field=models.CharField(blank=True, max_length=100, null=True, verbose_name='معرف الإكسسوار بالمخزن'),
        ),
        migrations.AddField(
            model_name='modelaccessory',
            name='accessory_code',
            field=models.CharField(blank=True, max_length=100, null=True, verbose_name='كود الإكسسوار'),
        ),
        migrations.AddField(
            model_name='modelaccessory',
            name='planned_quantity',
            field=models.FloatField(default=0.0, verbose_name='الكمية المخططة'),
        ),
        migrations.AddField(
            model_name='modelaccessory',
            name='image',
            field=models.TextField(blank=True, null=True, verbose_name='صورة الإكسسوار'),
        ),
        # ModelTimeline additions
        migrations.AddField(
            model_name='modeltimeline',
            name='client_id',
            field=models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='المعرف'),
        ),
        migrations.AddField(
            model_name='modeltimeline',
            name='title',
            field=models.CharField(blank=True, max_length=200, null=True, verbose_name='العنوان'),
        ),
        migrations.AddField(
            model_name='modeltimeline',
            name='timestamp_str',
            field=models.CharField(blank=True, max_length=100, null=True, verbose_name='التوقيت النصي'),
        ),
        # CuttingRecord additions
        migrations.AddField(
            model_name='cuttingrecord',
            name='client_id',
            field=models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='المعرف'),
        ),
        migrations.AddField(
            model_name='cuttingrecord',
            name='layer_weight',
            field=models.FloatField(default=0.0, verbose_name='وزن الراق'),
        ),
        migrations.AddField(
            model_name='cuttingrecord',
            name='shade_degree',
            field=models.CharField(blank=True, default='', max_length=100, null=True, verbose_name='درجة الصبغة'),
        ),
        migrations.AddField(
            model_name='cuttingrecord',
            name='created_at_str',
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
        # QCRecord additions
        migrations.AddField(
            model_name='qcrecord',
            name='client_id',
            field=models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='المعرف'),
        ),
        migrations.AddField(
            model_name='qcrecord',
            name='color_name',
            field=models.CharField(blank=True, default='', max_length=150, null=True, verbose_name='اللون'),
        ),
        migrations.AddField(
            model_name='qcrecord',
            name='size',
            field=models.CharField(blank=True, default='', max_length=50, null=True, verbose_name='المقاس'),
        ),
        migrations.AddField(
            model_name='qcrecord',
            name='pieces_cut',
            field=models.IntegerField(default=0, verbose_name='القطع المقصوصة'),
        ),
        migrations.AddField(
            model_name='qcrecord',
            name='created_at_str',
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
        # PrintDispatch additions
        migrations.AddField(
            model_name='printdispatch',
            name='client_id',
            field=models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='المعرف'),
        ),
        migrations.AddField(
            model_name='printdispatch',
            name='dispatched_at_str',
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
        migrations.AddField(
            model_name='printdispatch',
            name='received_at_str',
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
        migrations.AlterField(
            model_name='printdispatch',
            name='expected_delivery_date',
            field=models.DateField(blank=True, null=True, verbose_name='تاريخ الاستلام المتوقع'),
        ),
        # SewingDispatch additions
        migrations.AddField(
            model_name='sewingdispatch',
            name='client_id',
            field=models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='المعرف'),
        ),
        migrations.AddField(
            model_name='sewingdispatch',
            name='dispatched_at_str',
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
        migrations.AddField(
            model_name='sewingdispatch',
            name='received_at_str',
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
        # InternalMessage additions
        migrations.AddField(
            model_name='internalmessage',
            name='client_id',
            field=models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='المعرف'),
        ),
        migrations.AddField(
            model_name='internalmessage',
            name='created_at_str',
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
    ]
