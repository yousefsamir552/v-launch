import os
from datetime import date, timedelta
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from django.utils.dateparse import parse_date
from .models import (
    SystemSetting, GlobalSettings, Role, UserProfile, SizeDef, Supplier, Workshop,
    Fabric, FabricColor, FabricTransaction,
    AccessoryType, Accessory, AccessoryTransaction,
    ModelItem, ModelRequirement, ModelAccessory, ModelTimeline,
    CuttingRecord, QCRecord, PrintDispatch,
    SewingDispatch, AppNotification, InternalMessage, AuditLog,
    COMPOSITION_TO_PARTS, DEFAULT_GARMENT_COMPOSITION,
    PackagingRequirement, FinishingRecord, AssemblyStageRecord,
    PackagingMaterialRule, PackagingMaterialSizeRule, PackagingMaterialTransaction,
    PACKAGING_MATERIAL_LABELS, PACKAGING_MATERIAL_EMOJI,
    PACKAGING_STEP_ORDER, PACKAGING_STEP_LABELS, ASSEMBLY_STAGE_LABELS,
    PART_STAGE_ORDER, PART_STAGE_LABELS, PART_STAGE_TO_STATUS,
)
from .serializers import resolve_by_id


# ---------------------------------------------------------------------------
# Garment part helpers (تيشرت / بنطلون / جاكيت / قطعة واحدة)
# 'shirt' is the canonical key for تيشرت (legacy code already uses it).
# ---------------------------------------------------------------------------
PART_ORDER = ['shirt', 'pants', 'jacket', 'single']
PART_LABELS = {
    'shirt': 'تيشرت',
    'pants': 'بنطلون',
    'jacket': 'جاكيت',
    'single': 'قطعة واحدة',
}
PART_ALIASES = {
    'tshirt': 'shirt', 't-shirt': 'shirt', 'tee': 'shirt', 'shirt': 'shirt',
    'قميص': 'shirt', 'تيشرت': 'shirt', 'تيشيرت': 'shirt', 'تي شيرت': 'shirt',
    'pants': 'pants', 'pant': 'pants', 'trouser': 'pants', 'trousers': 'pants',
    'بنطلون': 'pants', 'بنطال': 'pants',
    'jacket': 'jacket', 'جاكيت': 'jacket', 'معطف': 'jacket',
    'single': 'single', 'كامل': 'single', 'قطعة واحدة': 'single', 'قطعه واحده': 'single',
}
REAL_PARTS = ('shirt', 'pants', 'jacket')
QC_STAGE_RANK = {'before_print': 1, 'after_print': 2, 'after_sewing': 3}

# المراحل التي تُعتبر "بعد المكن": عندها يُعتمد عدد الفحص النهائي (QC after sewing)
# في حساب الأطقم التامة بدلاً من عدد القص فقط.
FINISHED_PART_STAGES = (
    'qc_after_sewing', 'finishing', 'ironing', 'packaging', 'dest', 'completed',
)
FINISHED_STATUSES = {
    'العد بعد المكن',
    'في التشطيب',
    'في المكواة',
    'في التعبئة والتغليف',
    'جاهز للدَست',
    'مخزن الإنتاج التام',
    'مكتمل الإنتاج',
}



from .services_pipeline import *
from .services_pipeline import _stage_index, _model_reached_finished_stage

_SCHEMA_ENSURED = False


def ensure_schema_columns():
    """
    Self-healing schema check: ensures newly added columns and tables for Cutting Spreads
    exist in the database even if a migration file was not uploaded or not yet applied on Render.

    Runs at most once per worker process (see ``_SCHEMA_ENSURED``) instead of on every
    request, which was a significant per-request overhead.
    """
    global _SCHEMA_ENSURED
    if _SCHEMA_ENSURED:
        return
    from django.db import connection
    try:
        with connection.cursor() as cursor:
            table_names = connection.introspection.table_names(cursor)
            if 'api_modelitem' in table_names:
                cols = [col.name for col in connection.introspection.get_table_description(cursor, 'api_modelitem')]
                if 'spreader_name' not in cols:
                    cursor.execute('ALTER TABLE api_modelitem ADD COLUMN spreader_name varchar(150) NULL;')
                if 'garment_parts' not in cols:
                    if connection.vendor == 'postgresql':
                        cursor.execute("ALTER TABLE api_modelitem ADD COLUMN garment_parts jsonb NOT NULL DEFAULT '[]'::jsonb;")
                    else:
                        cursor.execute("ALTER TABLE api_modelitem ADD COLUMN garment_parts text NOT NULL DEFAULT '[]';")
                if 'garment_composition' not in cols:
                    cursor.execute("ALTER TABLE api_modelitem ADD COLUMN garment_composition varchar(30) NOT NULL DEFAULT 'two_pieces';")
                for part_col in ('cut_shirt_pieces', 'cut_pants_pieces', 'cut_jacket_pieces',
                                 'qc_shirt_pieces', 'qc_pants_pieces', 'qc_jacket_pieces'):
                    if part_col not in cols:
                        cursor.execute(f'ALTER TABLE api_modelitem ADD COLUMN {part_col} integer NOT NULL DEFAULT 0;')
                # ملاحظات تشغيل القطعة الثالثة (الجاكيت) — ترقية آمنة لقواعد البيانات القائمة.
                if 'notes_jacket' not in cols:
                    cursor.execute("ALTER TABLE api_modelitem ADD COLUMN notes_jacket text NOT NULL DEFAULT '';")

            if 'api_cuttingrecord' in table_names:
                cols = [col.name for col in connection.introspection.get_table_description(cursor, 'api_cuttingrecord')]
                if 'spread_number' not in cols:
                    cursor.execute('ALTER TABLE api_cuttingrecord ADD COLUMN spread_number integer NOT NULL DEFAULT 1;')
                if 'spreader_name' not in cols:
                    cursor.execute("ALTER TABLE api_cuttingrecord ADD COLUMN spreader_name varchar(150) NOT NULL DEFAULT '';")
                if 'pieces_per_layer' not in cols:
                    cursor.execute('ALTER TABLE api_cuttingrecord ADD COLUMN pieces_per_layer integer NOT NULL DEFAULT 0;')
                if 'part_type' not in cols:
                    cursor.execute("ALTER TABLE api_cuttingrecord ADD COLUMN part_type varchar(20) NOT NULL DEFAULT 'shirt';")
                # فرشات "القصة / الجزء الفرعي" — ترقية آمنة لقواعد البيانات القائمة.
                if 'is_sub_cut' not in cols:
                    cursor.execute('ALTER TABLE api_cuttingrecord ADD COLUMN is_sub_cut boolean NOT NULL DEFAULT false;')
                if 'sub_cut_label' not in cols:
                    cursor.execute("ALTER TABLE api_cuttingrecord ADD COLUMN sub_cut_label varchar(150) NOT NULL DEFAULT '';")

            if 'api_qcrecord' in table_names:
                cols = [col.name for col in connection.introspection.get_table_description(cursor, 'api_qcrecord')]
                if 'part_type' not in cols:
                    cursor.execute("ALTER TABLE api_qcrecord ADD COLUMN part_type varchar(20) NOT NULL DEFAULT 'shirt';")

            # Photography sample quantities + dynamic packaging-material icon.
            if 'api_packagingrequirement' in table_names:
                cols = [col.name for col in connection.introspection.get_table_description(cursor, 'api_packagingrequirement')]
                if 'photography_sent_qty' not in cols:
                    cursor.execute('ALTER TABLE api_packagingrequirement ADD COLUMN photography_sent_qty integer NOT NULL DEFAULT 0;')
                if 'photography_received_qty' not in cols:
                    cursor.execute('ALTER TABLE api_packagingrequirement ADD COLUMN photography_received_qty integer NOT NULL DEFAULT 0;')

            if 'api_packagingmaterialrule' in table_names:
                cols = [col.name for col in connection.introspection.get_table_description(cursor, 'api_packagingmaterialrule')]
                if 'icon' not in cols:
                    cursor.execute("ALTER TABLE api_packagingmaterialrule ADD COLUMN icon varchar(20) NOT NULL DEFAULT '';")

            # ------------------------------------------------------------------
            # Independent per-department prices/costs (ترحيل ذاتي آمن للإنتاج).
            # ------------------------------------------------------------------
            if 'api_role' in table_names:
                cols = [col.name for col in connection.introspection.get_table_description(cursor, 'api_role')]
                # Rename the legacy printing-costs booleans to the canonical prices names.
                for legacy_col, new_col in (
                    ('can_view_printing_costs', 'can_view_printing_prices'),
                    ('can_edit_printing_costs', 'can_edit_printing_prices'),
                ):
                    if legacy_col in cols and new_col not in cols:
                        cursor.execute(f'ALTER TABLE api_role RENAME COLUMN {legacy_col} TO {new_col};')
                        cols = [col.name for col in connection.introspection.get_table_description(cursor, 'api_role')]
                for price_col in (
                    'can_view_printing_prices', 'can_edit_printing_prices',
                    'can_view_sewing_prices', 'can_edit_sewing_prices',
                    'can_view_assembly_prices', 'can_edit_assembly_prices',
                    'can_purchase_requests',
                ):
                    if price_col not in cols:
                        cursor.execute(f'ALTER TABLE api_role ADD COLUMN {price_col} boolean NOT NULL DEFAULT false;')

            for partial_receipt_table in ('api_sewingdispatch', 'api_printdispatch'):
                if partial_receipt_table not in table_names:
                    continue
                cols = [col.name for col in connection.introspection.get_table_description(cursor, partial_receipt_table)]
                if 'received_pieces' not in cols:
                    cursor.execute(
                        f'ALTER TABLE {partial_receipt_table} ADD COLUMN received_pieces integer NOT NULL DEFAULT 0;'
                    )
                if 'receive_history' not in cols:
                    if connection.vendor == 'postgresql':
                        cursor.execute(
                            f"ALTER TABLE {partial_receipt_table} ADD COLUMN receive_history jsonb NOT NULL DEFAULT '[]'::jsonb;"
                        )
                    else:
                        cursor.execute(
                            f"ALTER TABLE {partial_receipt_table} ADD COLUMN receive_history text NOT NULL DEFAULT '[]';"
                        )

            for cost_table in ('api_sewingdispatch', 'api_finishingrecord', 'api_assemblystagerecord'):
                if cost_table not in table_names:
                    continue
                cols = [col.name for col in connection.introspection.get_table_description(cursor, cost_table)]
                if 'cost_per_piece' not in cols:
                    cursor.execute(f'ALTER TABLE {cost_table} ADD COLUMN cost_per_piece numeric(12,2) NOT NULL DEFAULT 0;')
                if 'total_cost' not in cols:
                    cursor.execute(f'ALTER TABLE {cost_table} ADD COLUMN total_cost numeric(14,2) NOT NULL DEFAULT 0;')

            for price_table in ('api_packagingmaterialsizerule', 'api_packagingmaterialtransaction'):
                if price_table not in table_names:
                    continue
                cols = [col.name for col in connection.introspection.get_table_description(cursor, price_table)]
                if 'price_per_unit' not in cols:
                    cursor.execute(f'ALTER TABLE {price_table} ADD COLUMN price_per_unit numeric(12,2) NOT NULL DEFAULT 0;')

            # ------------------------------------------------------------------
            # Historical unit-price snapshots + optional supplier/workshop links
            # (foundation for the future accounting section / قسم الحسابات).
            # ------------------------------------------------------------------
            for snapshot_table in (
                'api_fabrictransaction', 'api_accessorytransaction',
                'api_modelrequirement', 'api_modelaccessory',
            ):
                if snapshot_table not in table_names:
                    continue
                cols = [col.name for col in connection.introspection.get_table_description(cursor, snapshot_table)]
                if 'unit_price_snapshot' not in cols:
                    cursor.execute(
                        f'ALTER TABLE {snapshot_table} ADD COLUMN unit_price_snapshot numeric(12,2) NOT NULL DEFAULT 0;'
                    )

            # معرف المورد FK اختياري على حركات المخزن (الموردون موجودون مسبقاً في api_supplier).
            fk_id_type = 'bigint' if connection.vendor == 'postgresql' else 'integer'
            if 'api_supplier' in table_names:
                for supplier_table in ('api_fabrictransaction', 'api_accessorytransaction'):
                    if supplier_table not in table_names:
                        continue
                    cols = [col.name for col in connection.introspection.get_table_description(cursor, supplier_table)]
                    if 'supplier_id' not in cols:
                        cursor.execute(
                            f'ALTER TABLE {supplier_table} ADD COLUMN supplier_id {fk_id_type} NULL '
                            'REFERENCES api_supplier(id) ON DELETE SET NULL;'
                        )

            # معرف الورشة FK اختياري على إرساليات المطابع/المكن وسجلات التشطيب والأسمبلي.
            if 'api_workshop' in table_names:
                for workshop_table in (
                    'api_printdispatch', 'api_sewingdispatch',
                    'api_finishingrecord', 'api_assemblystagerecord',
                ):
                    if workshop_table not in table_names:
                        continue
                    cols = [col.name for col in connection.introspection.get_table_description(cursor, workshop_table)]
                    if 'workshop_id' not in cols:
                        cursor.execute(
                            f'ALTER TABLE {workshop_table} ADD COLUMN workshop_id {fk_id_type} NULL '
                            'REFERENCES api_workshop(id) ON DELETE SET NULL;'
                        )


            # ------------------------------------------------------------------
            # دورة صرف الإكسسوار: حقول تتبع الصرف الفعلي من مخزن الإكسسوارات
            # (ترحيل ذاتي آمن لقواعد البيانات القائمة على Render).
            # ------------------------------------------------------------------
            if 'api_modelaccessory' in table_names:
                cols = [col.name for col in connection.introspection.get_table_description(cursor, 'api_modelaccessory')]
                if 'is_issued' not in cols:
                    cursor.execute('ALTER TABLE api_modelaccessory ADD COLUMN is_issued boolean NOT NULL DEFAULT false;')
                if 'issued_quantity' not in cols:
                    if connection.vendor == 'postgresql':
                        cursor.execute('ALTER TABLE api_modelaccessory ADD COLUMN issued_quantity double precision NOT NULL DEFAULT 0.0;')
                    else:
                        cursor.execute('ALTER TABLE api_modelaccessory ADD COLUMN issued_quantity real NOT NULL DEFAULT 0.0;')
                if 'issued_to' not in cols:
                    cursor.execute("ALTER TABLE api_modelaccessory ADD COLUMN issued_to varchar(150) NOT NULL DEFAULT '';")
                if 'issued_at' not in cols:
                    cursor.execute("ALTER TABLE api_modelaccessory ADD COLUMN issued_at varchar(100) NOT NULL DEFAULT '';")
                if 'issued_by' not in cols:
                    cursor.execute("ALTER TABLE api_modelaccessory ADD COLUMN issued_by varchar(150) NOT NULL DEFAULT '';")


            if 'api_cuttingspreadlayer' not in table_names:
                if connection.vendor == 'postgresql':
                    cursor.execute('''
                        CREATE TABLE IF NOT EXISTS api_cuttingspreadlayer (
                            id bigserial PRIMARY KEY,
                            client_id varchar(100) NULL,
                            color_name varchar(150) NOT NULL,
                            layers_count integer NOT NULL DEFAULT 0,
                            layer_weight double precision NOT NULL DEFAULT 0.0,
                            pieces_count integer NOT NULL DEFAULT 0,
                            shade_degree varchar(100) NOT NULL DEFAULT '',
                            notes text NOT NULL DEFAULT '',
                            spread_id bigint NOT NULL REFERENCES api_cuttingrecord(id) ON DELETE CASCADE
                        );
                    ''')
                else:
                    cursor.execute('''
                        CREATE TABLE IF NOT EXISTS api_cuttingspreadlayer (
                            id integer PRIMARY KEY AUTOINCREMENT,
                            client_id varchar(100) NULL,
                            color_name varchar(150) NOT NULL,
                            layers_count integer NOT NULL DEFAULT 0,
                            layer_weight real NOT NULL DEFAULT 0.0,
                            pieces_count integer NOT NULL DEFAULT 0,
                            shade_degree varchar(100) NOT NULL DEFAULT '',
                            notes text NOT NULL DEFAULT '',
                            spread_id bigint NOT NULL REFERENCES api_cuttingrecord(id) ON DELETE CASCADE
                        );
                    ''')

            # Strict hierarchical ranks: self-heal the rank_level columns.
            for rank_table in ('api_role', 'api_userprofile', 'api_hremployee'):
                if rank_table not in table_names:
                    continue
                cols = [col.name for col in connection.introspection.get_table_description(cursor, rank_table)]
                if 'rank_level' not in cols:
                    cursor.execute(
                        f'ALTER TABLE {rank_table} ADD COLUMN rank_level integer NOT NULL DEFAULT 3;'
                    )
                    if rank_table == 'api_userprofile':
                        cursor.execute(
                            "UPDATE api_userprofile SET rank_level = 0 "
                            "WHERE is_sudo = true OR LOWER(username) = 'sudo';"
                        )
        # Only mark as done after a fully successful pass so transient failures retry.
        _SCHEMA_ENSURED = True
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Packaging & Operating Materials MRP (خامات التشغيل والأمبالاج)
# ---------------------------------------------------------------------------
PACKAGING_MATERIAL_SEED = [
    ('bags', 'أكياس البلاستيك', 'قطعة'),
    ('cartons', 'الكرتون', 'قطعة'),
    ('hangers', 'الشماعات', 'قطعة'),
    ('newborn_bags', 'أكياس حديثي الولادة', 'قطعة'),
    ('dozen_bags', 'أكياس الدست', 'دستة'),
]


def ensure_packaging_material_categories():
    """
    Seeds the five default packaging-material categories **only once**.

    Earlier deployments re-created the fixed categories on every state sync, which made
    them impossible to delete. A ``SystemSetting`` flag now marks the initial seed, so
    categories deleted from the UI are never recreated (same idea as ``initial_seed_v1``).
    """
    seeded = SystemSetting.objects.filter(key='packaging_material_seed_v1').exists()
    if not seeded:
        for key, name, unit in PACKAGING_MATERIAL_SEED:
            rule, created = PackagingMaterialRule.objects.get_or_create(
                material_key=key,
                defaults={
                    'name': name or PACKAGING_MATERIAL_LABELS.get(key, key),
                    'unit': unit,
                    'icon': PACKAGING_MATERIAL_EMOJI.get(key, '📦'),
                },
            )
            if not created and not rule.icon:
                rule.icon = PACKAGING_MATERIAL_EMOJI.get(key, '📦')
                rule.save(update_fields=['icon'])
        SystemSetting.objects.create(
            key='packaging_material_seed_v1', value={'seeded': True}
        )

    # Backfill icons for rows created before the icon column existed (never re-creates
    # categories deleted from the UI, so deletions remain permanent).
    for rule in PackagingMaterialRule.objects.filter(icon=''):
        rule.icon = PACKAGING_MATERIAL_EMOJI.get(rule.material_key, '📦')
        rule.save(update_fields=['icon'])


def resolve_cost_values(cost_per_piece, total_cost=None, pieces_count=None):
    """
    يحسم (سعر القطعة، الإجمالي) من مدخلات الواجهة بأمان.

    * ``cost_per_piece`` سالب أو غير رقمي → 0.
    * عند وجود ``cost_per_piece > 0`` و ``pieces_count > 0`` يُحسب الإجمالي دائماً
      على الباك إند (السعر × عدد القطع مقرباً لمنزلتين) ولا يسمح لـ ``0`` من الواجهة بتصفيره.
    * إن لم يوجد سعر للقطعة ولكن مُرِّر ``total_cost > 0`` صريحاً يُستخدم كما هو.
    """
    try:
        cost = max(0.0, float(cost_per_piece or 0))
    except (TypeError, ValueError):
        cost = 0.0
    try:
        count = max(0.0, float(pieces_count or 0))
    except (TypeError, ValueError):
        count = 0.0
    explicit_total = None
    if total_cost not in (None, ''):
        try:
            parsed_total = max(0.0, float(total_cost or 0))
            if parsed_total > 0:
                explicit_total = parsed_total
        except (TypeError, ValueError):
            explicit_total = None

    if cost > 0:
        total = round(cost * count, 2) if count > 0 else (
            round(explicit_total, 2) if explicit_total is not None else round(cost, 2)
        )
    elif explicit_total is not None:
        total = round(explicit_total, 2)
    else:
        total = 0.0
    return round(cost, 2), round(total, 2)


def apply_packaging_material_transaction(size_rule, operation, amount, notes='', timestamp='',
                                         price_per_unit=0.0):
    """
    Applies an add / deduct / adjust movement to a packaging-material size row
    and records it in the ledger. Returns the created transaction.
    """
    try:
        amount = float(amount or 0)
    except (TypeError, ValueError):
        amount = 0.0
    if amount < 0:
        amount = abs(amount)
    try:
        unit_price = max(0.0, float(price_per_unit or 0))
    except (TypeError, ValueError):
        unit_price = 0.0

    with transaction.atomic():
        # اقفل صف الرصيد لمنع تضارب الأرصدة عند الصرف المتزامن، واقرأ أحدث قيمة
        # من قاعدة البيانات بدلاً من الاعتماد على نسخة قديمة في الذاكرة.
        locked_rule = PackagingMaterialSizeRule.objects.select_for_update().get(pk=size_rule.pk)
        current = float(locked_rule.current_stock or 0)
        if operation == 'add':
            new_stock = current + amount
        elif operation == 'deduct':
            new_stock = max(0.0, current - amount)
        else:
            operation = 'adjust'
            new_stock = max(0.0, amount)

        locked_rule.current_stock = new_stock
        locked_rule.save(update_fields=['current_stock', 'updated_at'])
        txn = PackagingMaterialTransaction.objects.create(
            size_rule=locked_rule,
            operation=operation,
            amount=amount,
            price_per_unit=unit_price,
            notes=notes or '',
            timestamp=timestamp or '',
        )

    # حدّث النسخة التي يملكها المستدعي حتى تعكسها استجابة الـ API مباشرة.
    size_rule.current_stock = locked_rule.current_stock
    size_rule.updated_at = locked_rule.updated_at
    return txn


def backfill_issued_accessories_once():
    """ترحيل لمرة واحدة: تعلّم إكسسوارات الموديلات القديمة التي صُرفت فعلياً قبل إضافة
    حقل ``is_issued`` كـ«مصروفة» حتى لا يُعاد حجزها أو خصمها مرة أخرى.

    الشرط الوحيد: وجود حركة خصم فعلية (``AccessoryTransaction`` operation='deduct') لنفس
    الموديل ونفس الإكسسوار. هذا يجعل الترحيل آمناً للتكرار ولا يمس موديلات دورة الصرف
    الجديدة (لأنها تُعلَّم مباشرة عند تأكيد الصرف من مخزن الإكسسوارات).
    """
    if SystemSetting.objects.filter(key='accessory_issue_backfill_v1').exists():
        return
    try:
        pending = (
            ModelAccessory.objects.select_related('model')
            .filter(is_issued=False, model__is_deleted=False)
            .exclude(model__status__in=('مرحلة التصميم', 'تصميم'))
            .exclude(accessory_id_ref__isnull=True)
            .exclude(accessory_id_ref='')
        )
        for m_acc in pending:
            model_code = (m_acc.model.model_code or '').strip()
            if not model_code:
                continue
            acc_item = resolve_by_id(Accessory, m_acc.accessory_id_ref)
            if not acc_item:
                continue
            already_deducted = AccessoryTransaction.objects.filter(
                accessory=acc_item,
                operation='deduct',
                model_code_ref__iexact=model_code,
            ).exists()
            if not already_deducted:
                continue
            m_acc.is_issued = True
            m_acc.issued_quantity = float(m_acc.planned_quantity or 0)
            m_acc.save(update_fields=['is_issued', 'issued_quantity'])
    except Exception:
        # فشل الترحيل لا يجب أن يمنع تشغيل النظام؛ يُعاد المحاولة في الإقلاع التالي.
        return
    SystemSetting.objects.create(key='accessory_issue_backfill_v1', value={'seeded': True})


def ensure_initial_seed():
    """
    Ensures the Sudo emergency superuser account, GlobalSettings, and initial roles/catalog exist.
    Once seeded, SystemSetting('initial_seed_v1') is stored so any user/account
    or model deletions performed by the admin are permanently respected across all browsers.
    Always guarantees that the 'sudo' emergency account exists and is immutable.
    """
    ensure_schema_columns()
    # Ensure GlobalSettings singleton exists
    GlobalSettings.get_solo()
    # ترحيل لمرة واحدة لإكسسوارات الموديلات القديمة التي صُرفت قبل إضافة حقل is_issued.
    backfill_issued_accessories_once()

    # 1. Always ensure Sudo role & Sudo emergency account exist so admin is never locked out
    sudo_role = Role.objects.filter(client_id='role-1').first() or Role.objects.filter(name='مدير عام المصنع').first()
    if not sudo_role:
        sudo_role_data = DEFAULT_ROLES_SEED[0]
        sudo_role = Role(
            client_id=sudo_role_data['client_id'],
            name=sudo_role_data['name'],
            description=sudo_role_data['description'],
            permissions_json=sudo_role_data['permissions'],
        )
        sudo_role.save()

    sudo_user = UserProfile.objects.filter(username__iexact='sudo').first()
    sudo_initial_password = os.environ.get('SUDO_INITIAL_PASSWORD', '').strip()
    if not sudo_user:
        sudo_user = UserProfile(
            client_id='user-sudo',
            username='sudo',
            real_name='حساب الطوارئ المطلق (Sudo)',
            phone='01000000000',
            role=sudo_role,
            role_title='حساب طوارئ مطلق',
            is_sudo=True,
            is_active=True,
            custom_permissions={},
            last_active=timezone.now(),
        )
        # لا تُخزَّن كلمة مرور ثابتة داخل الكود: تُقرأ من متغير البيئة
        # SUDO_INITIAL_PASSWORD، وإن لم يُضبط يبقى الحساب بلا كلمة مرور (لا يمكن
        # تسجيل الدخول به) حتى يضبطها المسؤول عبر متغير البيئة ثم إعادة التشغيل.
        if sudo_initial_password:
            sudo_user.set_password(sudo_initial_password)
        sudo_user.save()
    else:
        changed = False
        if not sudo_user.password_hash and sudo_initial_password:
            sudo_user.set_password(sudo_initial_password)
            changed = True
        if not sudo_user.is_sudo or not sudo_user.is_active or sudo_user.client_id != 'user-sudo':
            sudo_user.is_sudo = True
            sudo_user.is_active = True
            sudo_user.client_id = 'user-sudo'
            changed = True
        if changed:
            sudo_user.save()

    # Check if one-time seed has already run
    if SystemSetting.objects.filter(key='initial_seed_v1').exists():
        return

    # Seed default roles if missing
    for r_data in DEFAULT_ROLES_SEED:
        if not Role.objects.filter(name=r_data['name']).exists():
            role_obj = Role(
                client_id=r_data['client_id'],
                name=r_data['name'],
                description=r_data['description'],
                permissions_json=r_data['permissions'],
            )
            role_obj.save()

    # Seed default size definitions if empty
    if not SizeDef.objects.exists():
        for cid, name, vals in [
            ('size-1', 'بيبي', '1, 2, 3'),
            ('size-2', 'أطفال / وسط', '4, 6, 8, 10, 12'),
            ('size-3', 'شبابي', '14, 16, 18'),
            ('size-4', 'رجالي', 'S, M, L, XL, 2XL, 3XL'),
        ]:
            SizeDef.objects.create(client_id=cid, name=name, values=vals)

    # Seed default suppliers if empty
    if not Supplier.objects.exists():
        for cid, name, phone in [
            ('sup-1', 'شركة النسيج الحديث للمحلة', '01002345678'),
            ('sup-2', 'مؤسسة الأهرام للغزول والصباغة', '01129876543'),
            ('sup-3', 'مستودع إكسسوارات الفهد', '01234567890'),
        ]:
            Supplier.objects.create(client_id=cid, name=name, phone=phone)

    # Seed default accessory types if empty
    if not AccessoryType.objects.exists():
        for cid, name, icon, desc in [
            ('type-1', 'بادج', 'Shield', 'بادجات تطريز وسيليكون وليزر للأكمام والصدور والجيوب'),
            ('type-2', 'لعبة', 'Sparkles', 'ألعاب ملابس أطفال وميداليات وحليات قماشية'),
            ('type-3', 'ورد', 'Flower2', 'ورود شيفون وستان وفيونكات للأطواق والفساتين'),
            ('type-4', 'دانتيل وتطريز', 'Feather', 'شرايط دانتيل قطني وجبير وتطريزات جاهزة'),
            ('type-5', 'تيكت وعلامات', 'Tag', 'تيكت رقبة قطني منسوج وكروت مقاس وعناية'),
            ('type-6', 'سوست ومستلزمات', 'Minimize2', 'سوست عظم ومعدن وجرارات وإكسسوارات سحاب'),
        ]:
            AccessoryType.objects.create(client_id=cid, name=name, icon=icon, description=desc)

    if not AuditLog.objects.exists():
        AuditLog.objects.create(
            client_id='log-1',
            user_id_ref='system',
            user_name='إدارة النظام',
            action='تهيئة النظام',
            details='تشغيل نظام إدارة المصنع وربط قاعدة البيانات المركزية بنجاح',
            ip_address='127.0.0.1',
            timestamp=timezone.now().strftime('%Y-%m-%d %H:%M'),
        )

    SystemSetting.objects.create(key='initial_seed_v1', value={'seeded': True})


def get_accessory_deficits():
    """
    Computes stock deficits and model-specific deficits separately.
    """
    accessories = Accessory.objects.all()
    stock_deficits = []
    model_deficits = []

    for item in accessories:
        ext_id = item.client_id or str(item.id)
        # بضاعة الرصيد السابق / المرحّل لا تدخل قائمة النواقص أو التنبيهات أبداً.
        if item.usage_type == 'carryover':
            continue
        if item.usage_type == 'custom_model':
            if item.withdrawn_for_model:
                continue
            deficit = round(max(0.0, float(item.target_quantity or 0) - float(item.delivered_quantity or 0)), 3)
            if deficit > 0:
                model_deficits.append({
                    'id': ext_id,
                    'code': item.code or item.custom_model_code or 'خاص',
                    'name': item.name,
                    'usage_type': 'custom_model',
                    'custom_model_code': item.custom_model_code,
                    'current_stock': float(item.current_stock or 0),
                    'delivered_quantity': float(item.delivered_quantity or 0),
                    'target_quantity': float(item.target_quantity or 0),
                    'deficit': deficit,
                    'unit': item.unit,
                    'supplier': item.supplier
                })
        else:
            # حد تنبيه صفر (أو أقل) يعني أن التنبيهات معطّلة لهذا الصنف.
            min_thr = float(item.min_threshold or 0)
            cur_stk = float(item.current_stock or 0)
            reserved = float(item.reserved_quantity or 0)
            available = round(max(0.0, cur_stk - reserved), 3)
            if min_thr <= 0:
                continue
            if available < min_thr:
                deficit = round(max(0.0, min_thr - available), 3)
                stock_deficits.append({
                    'id': ext_id,
                    'code': item.code or f"ACC-{item.id}",
                    'name': item.name,
                    'usage_type': 'stock',
                    'current_stock': cur_stk,
                    'available': available,
                    'min_threshold': min_thr,
                    'deficit': deficit,
                    'unit': item.unit,
                    'supplier': item.supplier
                })

    return {
        'stock_deficits': stock_deficits,
        'model_deficits': model_deficits,
        'total_count': len(stock_deficits) + len(model_deficits)
    }


# ---------------------------------------------------------------------------
# In-App notifications: ربط كل مرحلة بمفتاح القسم المطلوب لعرض التنبيه.
# نفس الخريطة موجودة في الواجهة (AppContext.NOTIFICATION_STAGE_PERMISSION) حتى
# يظل السلوك متطابقاً بين الباك إند والشاشات.
# ---------------------------------------------------------------------------
NOTIFICATION_STAGE_PERMISSION = {
    'printing': 'printing',
    'sewing': 'sewing',
    'finishing': 'assembly_packaging',
    'ironing': 'assembly_packaging',
    'packaging': 'assembly_packaging',
    'dest': 'assembly_packaging',
    'materials': 'assembly_packaging',
}


def attach_notification_permission_keys(notifications):
    """Adds ``permission_key`` to every notification so clients can scope them by section."""
    for notification in notifications:
        if not notification.get('permission_key'):
            notification['permission_key'] = NOTIFICATION_STAGE_PERMISSION.get(
                notification.get('stage'), ''
            )
    return notifications


def filter_notifications_by_permission(notifications, profile=None):
    """
    Keeps only the notifications of sections the user may view.

    ``profile=None`` (طلب بدون توكن معروف) يحافظ على السلوك القديم فيرجع القائمة
    كاملة، وحساب sudo يرى كل التنبيهات دائماً.
    """
    notifications = list(notifications)
    if profile is None:
        return notifications
    if getattr(profile, 'is_sudo', False) or str(getattr(profile, 'username', '')).lower() == 'sudo':
        return notifications
    allowed = []
    for notification in notifications:
        permission_key = notification.get('permission_key')
        if not permission_key or profile.has_perm('{}_view'.format(permission_key)):
            allowed.append(notification)
    return allowed


def generate_smart_delivery_notifications():
    """
    Computes delivery date notifications for PrintDispatches and SewingDispatches:
    - 1 day before: Tomorrow notification
    - On date: Today notification
    - Past date without receipt: Overdue (stays active until received)
    """
    today = date.today()
    tomorrow = today + timedelta(days=1)
    notifications = []

    # 1. Print Dispatches
    active_prints = PrintDispatch.objects.exclude(status__in=['تم الاستلام', 'تم الاستلام بالمصنع']).select_related('model')
    for disp in active_prints:
        if not disp.expected_delivery_date:
            continue
        exp = disp.expected_delivery_date
        code = disp.model.model_code
        m_ext_id = disp.model.client_id or str(disp.model_id)
        d_ext_id = disp.client_id or str(disp.id)
        if exp < today:
            days = (today - exp).days
            notifications.append({
                'id': f"notif-print-{d_ext_id}-{exp.isoformat()}",
                'title': f'🚨 تأخر استلام من المطبعة ({code})',
                'urgency': 'overdue',
                'stage': 'printing',
                'model_code': code,
                'model_id': m_ext_id,
                'source_name': disp.print_house,
                'target_name': disp.print_house,
                'expected_date': exp.isoformat(),
                'days_diff': -days,
                'message': f"تخطى موعد استلام الموديل {code} من مطبعة {disp.print_house} بمقدار {days} يوم، ولم يتم تسجيل الاستلام بعد!"
            })
        elif exp == today:
            notifications.append({
                'id': f"notif-print-{d_ext_id}-{exp.isoformat()}",
                'title': f'⏰ موعد استلام اليوم ({code})',
                'urgency': 'today',
                'stage': 'printing',
                'model_code': code,
                'model_id': m_ext_id,
                'source_name': disp.print_house,
                'target_name': disp.print_house,
                'expected_date': exp.isoformat(),
                'days_diff': 0,
                'message': f"اليوم هو موعد استلام تشغيلة الموديل {code} من مطبعة {disp.print_house} ({disp.pieces_count} قطعة)."
            })
        elif exp == tomorrow:
            notifications.append({
                'id': f"notif-print-{d_ext_id}-{exp.isoformat()}",
                'title': f'📅 موعد استلام غداً ({code})',
                'urgency': 'tomorrow',
                'stage': 'printing',
                'model_code': code,
                'model_id': m_ext_id,
                'source_name': disp.print_house,
                'target_name': disp.print_house,
                'expected_date': exp.isoformat(),
                'days_diff': 1,
                'message': f"غداً موعد استلام الموديل {code} من مطبعة {disp.print_house}."
            })

    # 2. Sewing Dispatches
    active_sewing = SewingDispatch.objects.exclude(status='تم الاستلام').select_related('model')
    for disp in active_sewing:
        if not disp.expected_delivery_date:
            continue
        exp = disp.expected_delivery_date
        code = disp.model.model_code
        m_ext_id = disp.model.client_id or str(disp.model_id)
        d_ext_id = disp.client_id or str(disp.id)
        piece_suffix = f" [{disp.piece_label or PART_LABELS.get(disp.piece_type, 'قطعة')}]"

        if exp < today:
            days = (today - exp).days
            notifications.append({
                'id': f"notif-sew-{d_ext_id}-{exp.isoformat()}",
                'title': f"🚨 تأخر استلام من ورشة المكن{piece_suffix} ({code})",
                'urgency': 'overdue',
                'stage': 'sewing',
                'model_code': code,
                'model_id': m_ext_id,
                'source_name': disp.workshop_name,
                'target_name': disp.workshop_name,
                'expected_date': exp.isoformat(),
                'days_diff': -days,
                'message': f"تخطى موعد استلام {code}{piece_suffix} من ورشة {disp.workshop_name} بمقدار {days} يوم، ولم يتم تسجيل الاستلام بعد!"
            })
        elif exp == today:
            notifications.append({
                'id': f"notif-sew-{d_ext_id}-{exp.isoformat()}",
                'title': f"⏰ موعد استلام اليوم{piece_suffix} ({code})",
                'urgency': 'today',
                'stage': 'sewing',
                'model_code': code,
                'model_id': m_ext_id,
                'source_name': disp.workshop_name,
                'target_name': disp.workshop_name,
                'expected_date': exp.isoformat(),
                'days_diff': 0,
                'message': f"اليوم هو موعد استلام تشغيلة الموديل {code}{piece_suffix} من ورشة المكن ({disp.workshop_name}) - عدد {disp.pieces_count} قطعة."
            })
        elif exp == tomorrow:
            notifications.append({
                'id': f"notif-sew-{d_ext_id}-{exp.isoformat()}",
                'title': f"📅 موعد استلام غداً{piece_suffix} ({code})",
                'urgency': 'tomorrow',
                'stage': 'sewing',
                'model_code': code,
                'model_id': m_ext_id,
                'source_name': disp.workshop_name,
                'target_name': disp.workshop_name,
                'expected_date': exp.isoformat(),
                'days_diff': 1,
                'message': f"غداً موعد استلام الموديل {code}{piece_suffix} من ورشة الخياطة ({disp.workshop_name})."
            })

    urgency_weights = {'overdue': 0, 'today': 1, 'tomorrow': 2}
    notifications.sort(key=lambda n: urgency_weights.get(n['urgency'], 3))
    return attach_notification_permission_keys(notifications)


# ---------------------------------------------------------------------------
# Assembly & Packaging (الأسمبلي والأمبالاج)
# ---------------------------------------------------------------------------

def _notification_urgency(exp, today, tomorrow):
    """Returns (urgency, days_diff) for an expected date, or (None, 0) when out of range."""
    if not exp:
        return None, 0
    if exp < today:
        return 'overdue', -(today - exp).days
    if exp == today:
        return 'today', 0
    if exp == tomorrow:
        return 'tomorrow', 1
    return None, 0


def _notifications_for_assembly_stage(stage_key, label, records, today, tomorrow):
    """Builds delivery notifications for AssemblyStageRecord rows of a single stage."""
    out = []
    for rec in records:
        urgency, days_diff = _notification_urgency(rec.expected_exit_date, today, tomorrow)
        if not urgency:
            continue
        exp = rec.expected_exit_date
        code = rec.model.model_code
        m_ext_id = rec.model.client_id or str(rec.model_id)
        r_ext_id = rec.client_id or str(rec.id)
        # For ironing this includes the garment part (e.g. «قسم المكواة - تيشرت»).
        stage_label = rec.stage_label or label
        prefix = {'overdue': '🚨', 'today': '⏰', 'tomorrow': '📅'}[urgency]
        if urgency == 'overdue':
            msg = (
                f"تخطى موعد خروج الموديل {code} من {stage_label} بمقدار {abs(days_diff)} يوم، "
                f"ولم يتم تسجيل الاستلام بعد!"
            )
        elif urgency == 'today':
            msg = f"اليوم هو موعد استلام الموديل {code} من {stage_label}."
        else:
            msg = f"غداً موعد استلام الموديل {code} من {stage_label}."
        out.append({
            'id': f"notif-asm-{stage_key}-{r_ext_id}-{exp.isoformat()}",
            'title': f"{prefix} {'تأخر استلام' if urgency == 'overdue' else ('موعد استلام اليوم' if urgency == 'today' else 'موعد استلام غداً')} ({code})",
            'urgency': urgency,
            'stage': stage_key,
            'model_code': code,
            'model_id': m_ext_id,
            'source_name': stage_label,
            'target_name': stage_label,
            'expected_date': exp.isoformat(),
            'days_diff': days_diff,
            'message': msg,
        })
    return out


def generate_assembly_delivery_notifications():
    """
    Delivery date notifications for the post-sewing life cycle:
    finishing (per part) + ironing / packaging / dest stages.
    """
    today = date.today()
    tomorrow = today + timedelta(days=1)
    notifications = []

    active_finishing = FinishingRecord.objects.filter(actual_exit_date__isnull=True).select_related('model')
    for rec in active_finishing:
        urgency, days_diff = _notification_urgency(rec.expected_exit_date, today, tomorrow)
        if not urgency:
            continue
        exp = rec.expected_exit_date
        code = rec.model.model_code
        m_ext_id = rec.model.client_id or str(rec.model_id)
        r_ext_id = rec.client_id or str(rec.id)
        label = rec.piece_label or ('تيشرت' if rec.part_type == 'shirt' else 'بنطلون')
        prefix = {'overdue': '🚨', 'today': '⏰', 'tomorrow': '📅'}[urgency]
        if urgency == 'overdue':
            msg = (
                f"تخطى موعد خروج [{label}] موديل {code} من التشطيب بمقدار {abs(days_diff)} يوم، "
                f"ولم يتم تسجيل الاستلام بعد!"
            )
            title = f"🚨 تأخر استلام من التشطيب [{label}] ({code})"
        elif urgency == 'today':
            msg = f"اليوم هو موعد استلام [{label}] موديل {code} من التشطيب."
            title = f"⏰ موعد استلام اليوم [{label}] ({code})"
        else:
            msg = f"غداً موعد استلام [{label}] موديل {code} من التشطيب."
            title = f"📅 موعد استلام غداً [{label}] ({code})"
        notifications.append({
            'id': f"notif-finish-{r_ext_id}-{exp.isoformat()}",
            'title': title,
            'urgency': urgency,
            'stage': 'finishing',
            'model_code': code,
            'model_id': m_ext_id,
            'source_name': 'قسم التشطيب',
            'target_name': 'قسم التشطيب',
            'expected_date': exp.isoformat(),
            'days_diff': days_diff,
            'message': msg,
        })

    for stage_key in ('ironing', 'packaging', 'dest'):
        records = AssemblyStageRecord.objects.filter(
            stage=stage_key, actual_exit_date__isnull=True
        ).select_related('model')
        notifications.extend(
            _notifications_for_assembly_stage(
                stage_key, ASSEMBLY_STAGE_LABELS.get(stage_key, stage_key), records, today, tomorrow
            )
        )

    urgency_weights = {'overdue': 0, 'today': 1, 'tomorrow': 2}
    notifications.sort(key=lambda n: urgency_weights.get(n['urgency'], 3))
    return attach_notification_permission_keys(notifications)


