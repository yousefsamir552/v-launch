from datetime import date, timedelta
from django.db.models import Sum
from django.utils import timezone
from django.utils.dateparse import parse_date
from .models import (
    SystemSetting, GlobalSettings, Role, UserProfile, SizeDef, Supplier,
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


def normalize_part_key(value):
    """Normalizes any free-text / alias part label into one of PART_ORDER keys."""
    if value is None:
        return 'shirt'
    raw = str(value).strip().lower()
    if not raw:
        return 'shirt'
    if raw in PART_ORDER:
        return raw
    if raw in PART_ALIASES:
        return PART_ALIASES[raw]
    for alias, key in PART_ALIASES.items():
        if alias and alias in raw:
            return key
    return 'shirt'


def get_model_parts(model):
    """Returns the ordered list of garment part keys for a model.

    Priority:
      1. Explicit ModelItem.garment_parts list.
      2. ModelItem.garment_composition mapping (user-chosen composition).
      3. Inferred from the model requirement labels (part_name).
      4. Safe legacy default: ['shirt', 'pants'] (preserves old two-piece behaviour).
    """
    explicit = getattr(model, 'garment_parts', None) or []
    normalized = []
    if isinstance(explicit, (list, tuple)):
        for item in explicit:
            key = normalize_part_key(item)
            if key not in normalized:
                normalized.append(key)
    if normalized:
        return sorted(normalized, key=lambda k: PART_ORDER.index(k) if k in PART_ORDER else 99)

    composition = getattr(model, 'garment_composition', None) or DEFAULT_GARMENT_COMPOSITION
    mapped = COMPOSITION_TO_PARTS.get(composition)
    if mapped:
        normalized = []
        for item in mapped:
            key = normalize_part_key(item)
            if key not in normalized:
                normalized.append(key)
        if normalized:
            return sorted(normalized, key=lambda k: PART_ORDER.index(k) if k in PART_ORDER else 99)

    inferred = []
    try:
        for req in model.requirements.all():
            key = normalize_part_key(getattr(req, 'part_name', ''))
            if key not in inferred:
                inferred.append(key)
    except Exception:
        inferred = []

    if not inferred:
        inferred = ['shirt', 'pants']
    return sorted(inferred, key=lambda k: PART_ORDER.index(k) if k in PART_ORDER else 99)


def recompute_model_part_totals(model):
    """Recomputes per-part cut/QC totals and legacy aggregate fields from the records.

    The cutting and QC records are the single source of truth; every summary is derived
    so that parts are never silently summed together (the previous bug).
    """
    parts = get_model_parts(model)
    part_keys = set(parts) | set(REAL_PARTS)

    cut_by_part = {key: 0 for key in part_keys}
    total_cut_all = 0
    for rec in CuttingRecord.objects.filter(model=model):
        key = normalize_part_key(getattr(rec, 'part_type', '') or 'shirt')
        qty = int(rec.pieces_count or 0)
        cut_by_part[key] = cut_by_part.get(key, 0) + qty
        total_cut_all += qty

    qc_records = list(QCRecord.objects.filter(model=model))
    best_stage = {}
    for rec in qc_records:
        key = normalize_part_key(getattr(rec, 'part_type', '') or 'shirt')
        rank = QC_STAGE_RANK.get(rec.stage, 0)
        if key not in best_stage or rank > best_stage[key]:
            best_stage[key] = rank

    qc_by_part = {key: 0 for key in part_keys}
    aggregate_by_stage = {'before_print': 0, 'after_print': 0, 'after_sewing': 0}
    for rec in qc_records:
        key = normalize_part_key(getattr(rec, 'part_type', '') or 'shirt')
        qty = int(rec.counted_pieces or 0)
        aggregate_by_stage[rec.stage] = aggregate_by_stage.get(rec.stage, 0) + qty
        if best_stage.get(key) == QC_STAGE_RANK.get(rec.stage, 0):
            qc_by_part[key] = qc_by_part.get(key, 0) + qty

    model.cut_shirt_pieces = cut_by_part.get('shirt', 0)
    model.cut_pants_pieces = cut_by_part.get('pants', 0)
    model.cut_jacket_pieces = cut_by_part.get('jacket', 0)
    model.qc_shirt_pieces = qc_by_part.get('shirt', 0)
    model.qc_pants_pieces = qc_by_part.get('pants', 0)
    model.qc_jacket_pieces = qc_by_part.get('jacket', 0)

    is_legacy = not (getattr(model, 'garment_parts', None) or [])
    active_cut = [cut_by_part.get(k, 0) for k in parts if k in REAL_PARTS]
    if is_legacy:
        # Safe legacy behaviour: keep the old aggregate (sum) so old data is never lost.
        model.total_cut_pieces = total_cut_all
    elif 'single' in parts:
        # Single-piece models have no per-part columns: use their own total.
        model.total_cut_pieces = cut_by_part.get('single', 0) or total_cut_all
    elif active_cut:
        # Completed sets = the smaller of the active parts (never a misleading sum).
        model.total_cut_pieces = min(active_cut) if len(active_cut) > 1 else active_cut[0]
    else:
        model.total_cut_pieces = 0

    # Legacy aggregate good counts (sum across parts) kept for backward-compatible views.
    model.count_before_print = aggregate_by_stage.get('before_print', 0)
    model.count_after_print = aggregate_by_stage.get('after_print', 0)
    model.count_after_sewing = aggregate_by_stage.get('after_sewing', 0)

    model.save(update_fields=[
        'cut_shirt_pieces', 'cut_pants_pieces', 'cut_jacket_pieces',
        'qc_shirt_pieces', 'qc_pants_pieces', 'qc_jacket_pieces',
        'total_cut_pieces', 'count_before_print', 'count_after_print', 'count_after_sewing',
    ])
    return model


def model_part_summary(model):
    """Returns the per-part representation exposed to the frontend."""
    parts = get_model_parts(model)
    cut_map = {
        'shirt': int(getattr(model, 'cut_shirt_pieces', 0) or 0),
        'pants': int(getattr(model, 'cut_pants_pieces', 0) or 0),
        'jacket': int(getattr(model, 'cut_jacket_pieces', 0) or 0),
    }
    qc_map = {
        'shirt': int(getattr(model, 'qc_shirt_pieces', 0) or 0),
        'pants': int(getattr(model, 'qc_pants_pieces', 0) or 0),
        'jacket': int(getattr(model, 'qc_jacket_pieces', 0) or 0),
    }
    cut_summary = {k: cut_map.get(k, 0) for k in parts}
    qc_summary = {k: qc_map.get(k, 0) for k in parts}
    # Available for sewing: latest good QC count per part, else its actual cut count.
    sewing_available = {k: (qc_map.get(k, 0) or cut_map.get(k, 0)) for k in parts}
    aggregate_good = int(getattr(model, 'count_after_print', 0) or 0)
    if 'single' in parts:
        # A single-piece model uses the legacy aggregate count.
        single_qty = aggregate_good or int(model.total_cut_pieces or 0)
        sewing_available['single'] = single_qty
        cut_summary['single'] = int(model.total_cut_pieces or 0)
        qc_summary['single'] = aggregate_good
    # الأطقم المكتملة = عدد القطع المتاح من أقل قطعة (min) وليس مجموع القطع.
    if 'single' in parts:
        completed_sets = int(model.total_cut_pieces or 0)
    else:
        completed_sets = min((int(cut_map.get(part, 0) or 0) for part in parts), default=0)
    return {
        'parts': parts,
        'cut_summary': cut_summary,
        'qc_summary': qc_summary,
        'sewing_available': sewing_available,
        'completed_sets': completed_sets,
    }


# ---------------------------------------------------------------------------
# Per-part stage tracking (each part moves independently through the pipeline)
# ---------------------------------------------------------------------------
# Only the assembly-section stages are mirrored onto the coarse ModelItem.status,
# so the earlier cutting / QC / printing / sewing pipeline keeps its own logic.
POST_SEWING_STAGES = ('finishing', 'ironing', 'packaging', 'dest', 'completed')

PACKAGING_READY_STAGES = ('packaging', 'dest', 'completed')


def _stage_index(stage):
    try:
        return PART_STAGE_ORDER.index(stage)
    except ValueError:
        return -1


def get_part_stages(model):
    """Returns a normalized {part: stage} dict for the model's garment parts."""
    raw = getattr(model, 'part_stages', None) or {}
    if not isinstance(raw, dict):
        raw = {}
    parts = get_model_parts(model)
    stages = {}
    for part in parts:
        stage = raw.get(part)
        stages[part] = stage if stage in PART_STAGE_ORDER else 'cutting'
    return stages


# Full coarse-status -> part-stage map used to seed legacy models.
# Older models were created before per-part tracking existed; before a pipeline
# action touches them, every part is seeded to the stage implied by the current
# status so the touched part can advance without regressing the model label.
STATUS_TO_PART_STAGE = {
    'مرحلة التصميم': 'cutting',
    'تصميم': 'cutting',
    'في القص': 'cutting',
    'جاري القص': 'cutting',
    'العد قبل الطباعة': 'qc_before_print',
    'فرز قبل الطباعة': 'qc_before_print',
    'فرز وكنترول': 'qc_before_print',
    'فرز وكنترول (قبل الطباعة)': 'qc_before_print',
    'جاهز للطباعة / التجميع': 'printing',
    'جاهز للمطبعة': 'printing',
    'مرسل للمطبعة': 'printing',
    'في المطبعة': 'printing',
    'العد بعد الطباعة': 'qc_after_print',
    'في قسم المكن': 'sewing',
    'في قسم المكن (الخياطة)': 'sewing',
    'العد بعد المكن': 'qc_after_sewing',
    'العد بعد المكن (الفحص النهائي)': 'qc_after_sewing',
    'في التشطيب': 'finishing',
    'في المكواة': 'ironing',
    'في التعبئة والتغليف': 'packaging',
    'جاهز للدَست': 'dest',
    'مخزن الإنتاج التام': 'completed',
    'مكتمل الإنتاج': 'completed',
    'مكتمل الإنتاج (مخزن الإنتاج)': 'completed',
}


def seed_part_stages_from_status(model):
    """Seeds part_stages from the coarse status for legacy models.

    Returns the normalized stages. When part_stages already holds data it is
    left untouched, so this is safe to call before every pipeline action.
    """
    raw = getattr(model, 'part_stages', None)
    if isinstance(raw, dict) and raw:
        return get_part_stages(model)
    stage = STATUS_TO_PART_STAGE.get(getattr(model, 'status', '') or '', 'cutting')
    return set_all_part_stages(model, stage, save=False)


def derive_pipeline_status(model, save=False):
    """Derives the coarse ModelItem.status from the *least advanced* part.

    Unlike ``sync_model_status_from_part_stages`` (assembly only), this covers
    the full pipeline (cutting → printing → sewing → finishing), so each part
    advances the model label only as far as the slowest part has reached.
    """
    raw = getattr(model, 'part_stages', None)
    if not isinstance(raw, dict) or not raw:
        return model.status
    stages = get_part_stages(model)
    if not stages:
        return model.status
    min_stage = min(stages.values(), key=_stage_index)
    new_status = PART_STAGE_TO_STATUS.get(min_stage)
    if new_status and model.status != new_status:
        model.status = new_status
        if save:
            model._skip_timeline_signal = True
            model.save(update_fields=['status', 'updated_at'])
    return model.status


def advance_parts_to_stage(model, stage, parts=None):
    """Moves the given (or all) parts forward to ``stage``.

    Parts already at/after the target stage are left untouched, so a bulk action
    can never push a more advanced part back.
    """
    if stage not in PART_STAGE_ORDER:
        raise ValueError('مرحلة القطعة غير معروفة')
    seed_part_stages_from_status(model)
    stages = get_part_stages(model)
    target_index = _stage_index(stage)
    keys = [normalize_part_key(p) for p in parts] if parts else list(stages.keys())
    for part in keys:
        if _stage_index(stages.get(part, 'cutting')) < target_index:
            stages[part] = stage
    model.part_stages = stages
    return stages


def set_part_stage(model, part, stage, save=True):
    """Sets the stage of a single garment part (keeps other parts untouched)."""
    part = normalize_part_key(part)
    if stage not in PART_STAGE_ORDER:
        raise ValueError('مرحلة القطعة غير معروفة')
    seed_part_stages_from_status(model)
    stages = get_part_stages(model)
    stages[part] = stage
    model.part_stages = stages
    if save:
        model._skip_timeline_signal = True
        model.save(update_fields=['part_stages', 'updated_at'])
    return stages


def set_all_part_stages(model, stage, save=True):
    """Sets the same stage for every garment part of the model."""
    if stage not in PART_STAGE_ORDER:
        raise ValueError('مرحلة القطعة غير معروفة')
    stages = {part: stage for part in get_model_parts(model)}
    model.part_stages = stages
    if save:
        model._skip_timeline_signal = True
        model.save(update_fields=['part_stages', 'updated_at'])
    return stages


def sync_model_status_from_part_stages(model, save=True):
    """Derives the coarse ModelItem.status from the *least advanced* part.

    The model as a whole has not left a stage until every one of its parts has
    left it, so the minimum stage index is the correct collective stage.
    """
    stages = get_part_stages(model)
    if not stages:
        return model.status
    min_stage = min(stages.values(), key=_stage_index)
    if min_stage not in POST_SEWING_STAGES:
        return model.status
    new_status = PART_STAGE_TO_STATUS.get(min_stage)
    if new_status and model.status != new_status:
        model.status = new_status
        if save:
            model._skip_timeline_signal = True
            model.save(update_fields=['status', 'updated_at'])
    return model.status


def ensure_part_stages(model):
    """Seeds / repairs ModelItem.part_stages from records and the legacy status.

    The highest known stage per part wins: records can promote a part, but a
    stale record can never push an already-advanced part back. An open finishing
    record pins the part to finishing even when the coarse model status is ahead.
    """
    if not model:
        return {}

    raw = getattr(model, 'part_stages', None) or {}
    if not isinstance(raw, dict):
        raw = {}
    parts = get_model_parts(model)

    status_stage = {
        # Pre-assembly pipeline positions (kept so a model opening the assembly
        # screen is never seeded back to cutting).
        'مرحلة التصميم': 'cutting',
        'تصميم': 'cutting',
        'في القص': 'cutting',
        'جاري القص': 'cutting',
        'العد قبل الطباعة': 'qc_before_print',
        'فرز قبل الطباعة': 'qc_before_print',
        'فرز وكنترول': 'qc_before_print',
        'فرز وكنترول (قبل الطباعة)': 'qc_before_print',
        'جاهز للطباعة / التجميع': 'printing',
        'جاهز للمطبعة': 'printing',
        'مرسل للمطبعة': 'printing',
        'في المطبعة': 'printing',
        'العد بعد الطباعة': 'qc_after_print',
        'في قسم المكن': 'sewing',
        'في قسم المكن (الخياطة)': 'sewing',
        # Assembly treats a post-sewing model as ready for finishing.
        'العد بعد المكن': 'finishing',
        'العد بعد المكن (الفحص النهائي)': 'finishing',
        'في التشطيب': 'finishing',
        'في المكواة': 'ironing',
        'في التعبئة والتغليف': 'packaging',
        'جاهز للدَست': 'dest',
        'مخزن الإنتاج التام': 'completed',
        'مكتمل الإنتاج': 'completed',
    }.get(getattr(model, 'status', ''), 'cutting')

    implied = {part: [] for part in parts}

    def imply(part_key, stage):
        key = normalize_part_key(part_key)
        if key in implied:
            implied[key].append(stage)

    # Finishing records: open → finishing, received → ironing.
    for rec in FinishingRecord.objects.filter(model=model):
        imply(rec.part_type, 'ironing' if rec.actual_exit_date else 'finishing')

    # Per-part ironing records: open → ironing, completed → packaging.
    for rec in AssemblyStageRecord.objects.filter(model=model, stage='ironing').exclude(part_type=''):
        imply(rec.part_type, 'packaging' if rec.actual_exit_date else 'ironing')

    # Model-level packaging / dest records promote every part.
    packaging_done = AssemblyStageRecord.objects.filter(
        model=model, stage='packaging', actual_exit_date__isnull=False
    ).exists()
    dest_done = AssemblyStageRecord.objects.filter(
        model=model, stage='dest', actual_exit_date__isnull=False
    ).exists()

    stages = {}
    for part in parts:
        candidates = []
        explicit = raw.get(part)
        if explicit in PART_STAGE_ORDER:
            candidates.append(explicit)
        candidates.extend(implied.get(part) or [])
        if packaging_done:
            candidates.append('dest')
        if dest_done:
            candidates.append('completed')
        # Highest stage wins → records can promote a part but never push it back.
        stages[part] = max(candidates, key=_stage_index) if candidates else status_stage

    if (model.part_stages or {}) != stages:
        model.part_stages = stages
        model._skip_timeline_signal = True
        model.save(update_fields=['part_stages', 'updated_at'])
    return stages



def packaging_readiness(model):
    """Readiness summary for the packaging stage.

    Packaging is a single model-level card that can only be completed once every
    garment part reached the packaging stage (or beyond). Parts still in
    finishing / ironing block it and are reported in ``waiting_parts``.
    """
    ensure_part_stages(model)
    stages = get_part_stages(model)

    ready_parts = []
    waiting_parts = []
    parts_detail = {}
    for part, stage in stages.items():
        label = PART_LABELS.get(part, part)
        detail = {
            'part': part,
            'label': label,
            'stage': stage,
            'stage_label': PART_STAGE_LABELS.get(stage, stage),
        }
        parts_detail[part] = {
            'stage': stage,
            'stage_label': PART_STAGE_LABELS.get(stage, stage),
            'ready_for_packaging': stage in PACKAGING_READY_STAGES,
        }
        if stage in PACKAGING_READY_STAGES:
            ready_parts.append(detail)
        else:
            waiting_parts.append(detail)

    return {
        'all_ready': len(waiting_parts) == 0,
        'has_arrived': len(ready_parts) > 0,
        'ready_parts': ready_parts,
        'waiting_parts': waiting_parts,
        'parts': parts_detail,
    }


def part_stages_payload(model):
    """Public read helper: normalized per-part stages with Arabic labels."""
    ensure_part_stages(model)
    stages = get_part_stages(model)
    return {
        part: {
            'stage': stage,
            'stage_label': PART_STAGE_LABELS.get(stage, stage),
            'ready_for_packaging': stage in PACKAGING_READY_STAGES,
        }
        for part, stage in stages.items()
    }



DEFAULT_ROLES_SEED = [
    {
        'client_id': 'role-1',
        'name': 'مدير عام المصنع',
        'description': 'صلاحيات كاملة للمتابعة والإشراف على كافة أقسام المصنع والمخازن والماليات والإعدادات',
        'permissions': {
            'fabric_warehouse_view': True, 'fabric_warehouse_edit': True,
            'accessories_warehouse_view': True, 'accessories_warehouse_edit': True,
            'production_warehouse_view': True, 'production_warehouse_edit': True,
            'design_view': True, 'design_edit': True,
            'cutting_view': True, 'cutting_edit': True,
            'qc_view': True, 'qc_edit': True,
            'printing_view': True, 'printing_edit': True,
            'sewing_view': True, 'sewing_edit': True,
            'assembly_packaging_view': True, 'assembly_packaging_edit': True,
            'models_tracking_view': True, 'models_tracking_edit': True,
            'reports_view': True, 'reports_edit': True,
            'view_fabric_prices': True, 'edit_fabric_prices': True,
            'view_accessory_prices': True, 'edit_accessory_prices': True,
            'view_printing_costs': True, 'edit_printing_costs': True,
            'send_whatsapp_requests': True, 'send_internal_messages': True,
            'manage_permissions': True, 'manage_users': True,
            'manage_suppliers': True, 'manage_sizes': True,
            'view_audit_logs': True, 'can_manage_hr': True,
            'view_global_settings': True, 'edit_header_settings': True, 'edit_message_templates': True,
            'can_add_design_notes': True, 'can_add_cutting_notes': True,
            'can_add_qc_before_print_notes': True, 'can_add_qc_after_print_notes': True,
            'can_add_sewing_notes': True, 'can_add_printing_notes': True,
        }
    },
    {
        'client_id': 'role-2',
        'name': 'مدير الإكسسوارات والمستلزمات',
        'description': 'إدارة مخزن الإكسسوارات وإضافة الأصناف والصرف ومتابعة حد التنبيه وإعادة الطلب',
        'permissions': {
            'fabric_warehouse_view': False, 'fabric_warehouse_edit': False,
            'accessories_warehouse_view': True, 'accessories_warehouse_edit': True,
            'production_warehouse_view': False, 'production_warehouse_edit': False,
            'design_view': True, 'design_edit': False,
            'cutting_view': False, 'cutting_edit': False,
            'qc_view': False, 'qc_edit': False,
            'printing_view': False, 'printing_edit': False,
            'sewing_view': False, 'sewing_edit': False,
            'models_tracking_view': True, 'models_tracking_edit': False,
            'reports_view': True, 'reports_edit': False,
            'view_fabric_prices': False, 'edit_fabric_prices': False,
            'view_accessory_prices': True, 'edit_accessory_prices': True,
            'view_printing_costs': False, 'edit_printing_costs': False,
            'send_whatsapp_requests': True, 'send_internal_messages': True,
            'manage_suppliers': True,
        }
    },
    {
        'client_id': 'role-3',
        'name': 'مسؤول مخزن الأقمشة',
        'description': 'إدارة أصناف وألوان الأقمشة وحركات الإضافة والصرف وتسجيل الأسعار',
        'permissions': {
            'fabric_warehouse_view': True, 'fabric_warehouse_edit': True,
            'accessories_warehouse_view': False, 'accessories_warehouse_edit': False,
            'production_warehouse_view': False, 'production_warehouse_edit': False,
            'design_view': True, 'design_edit': False,
            'cutting_view': False, 'cutting_edit': False,
            'qc_view': False, 'qc_edit': False,
            'printing_view': False, 'printing_edit': False,
            'sewing_view': False, 'sewing_edit': False,
            'models_tracking_view': True, 'models_tracking_edit': False,
            'reports_view': True, 'reports_edit': False,
            'view_fabric_prices': True, 'edit_fabric_prices': True,
            'view_accessory_prices': False, 'edit_accessory_prices': False,
            'view_printing_costs': False, 'edit_printing_costs': False,
            'send_whatsapp_requests': True, 'send_internal_messages': False,
            'manage_suppliers': True,
        }
    },
    {
        'client_id': 'role-4',
        'name': 'مسؤول قسم التصميم',
        'description': 'إضافة الموديلات الجديدة وتلوينها وسحب الخامات والإكسسوارات وإعداد الباترون والماركر',
        'permissions': {
            'fabric_warehouse_view': True, 'fabric_warehouse_edit': False,
            'accessories_warehouse_view': True, 'accessories_warehouse_edit': False,
            'production_warehouse_view': False, 'production_warehouse_edit': False,
            'design_view': True, 'design_edit': True,
            'cutting_view': False, 'cutting_edit': False,
            'qc_view': False, 'qc_edit': False,
            'printing_view': False, 'printing_edit': False,
            'sewing_view': False, 'sewing_edit': False,
            'models_tracking_view': True, 'models_tracking_edit': False,
            'reports_view': False, 'reports_edit': False,
            'view_fabric_prices': False, 'edit_fabric_prices': False,
            'view_accessory_prices': False, 'edit_accessory_prices': False,
            'view_printing_costs': False, 'edit_printing_costs': False,
            'send_whatsapp_requests': False, 'send_internal_messages': True,
            'can_add_design_notes': True,
            'manage_sizes': True,
        }
    },
    {
        'client_id': 'role-5',
        'name': 'مسؤول قسم القص',
        'description': 'استلام الموديلات وتسجيل بيانات الفرش والراقات وعدد القطع المنفذة',
        'permissions': {
            'fabric_warehouse_view': False, 'fabric_warehouse_edit': False,
            'accessories_warehouse_view': False, 'accessories_warehouse_edit': False,
            'production_warehouse_view': False, 'production_warehouse_edit': False,
            'design_view': True, 'design_edit': False,
            'cutting_view': True, 'cutting_edit': True,
            'qc_view': False, 'qc_edit': False,
            'printing_view': False, 'printing_edit': False,
            'sewing_view': False, 'sewing_edit': False,
            'models_tracking_view': True, 'models_tracking_edit': False,
            'reports_view': False, 'reports_edit': False,
            'view_fabric_prices': False, 'edit_fabric_prices': False,
            'view_accessory_prices': False, 'edit_accessory_prices': False,
            'view_printing_costs': False, 'edit_printing_costs': False,
            'send_whatsapp_requests': False, 'send_internal_messages': False,
            'can_add_cutting_notes': True,
        }
    },
    {
        'client_id': 'role-6',
        'name': 'مراقب الجودة والفرز',
        'description': 'فحص وتدقيق القطع عبر مراحل العد قبل الطباعة، بعد الطباعة، وبعد المكن',
        'permissions': {
            'fabric_warehouse_view': False, 'fabric_warehouse_edit': False,
            'accessories_warehouse_view': False, 'accessories_warehouse_edit': False,
            'production_warehouse_view': False, 'production_warehouse_edit': False,
            'design_view': False, 'design_edit': False,
            'cutting_view': True, 'cutting_edit': False,
            'qc_view': True, 'qc_edit': True,
            'printing_view': True, 'printing_edit': False,
            'sewing_view': True, 'sewing_edit': False,
            'models_tracking_view': True, 'models_tracking_edit': False,
            'reports_view': True, 'reports_edit': False,
            'view_fabric_prices': False, 'edit_fabric_prices': False,
            'view_accessory_prices': False, 'edit_accessory_prices': False,
            'view_printing_costs': False, 'edit_printing_costs': False,
            'send_whatsapp_requests': False, 'send_internal_messages': False,
            'can_add_qc_before_print_notes': True,
            'can_add_qc_after_print_notes': True,
        }
    },
    {
        'client_id': 'role-7',
        'name': 'مسؤول المطابع والتطريز',
        'description': 'إرسال واستلام تشغيلات المطابع والتطريز وتتبع حالات التسليم',
        'permissions': {
            'fabric_warehouse_view': False, 'fabric_warehouse_edit': False,
            'accessories_warehouse_view': False, 'accessories_warehouse_edit': False,
            'production_warehouse_view': False, 'production_warehouse_edit': False,
            'design_view': False, 'design_edit': False,
            'cutting_view': False, 'cutting_edit': False,
            'qc_view': True, 'qc_edit': False,
            'printing_view': True, 'printing_edit': True,
            'sewing_view': False, 'sewing_edit': False,
            'models_tracking_view': True, 'models_tracking_edit': False,
            'reports_view': True, 'reports_edit': False,
            'view_fabric_prices': False, 'edit_fabric_prices': False,
            'view_accessory_prices': False, 'edit_accessory_prices': False,
            'view_printing_costs': True, 'edit_printing_costs': True,
            'send_whatsapp_requests': False, 'send_internal_messages': True,
            'can_add_printing_notes': True,
        }
    },
    {
        'client_id': 'role-8',
        'name': 'مسؤول قسم المكن والخياطة',
        'description': 'متابعة خطوط المكن واستلام الموديلات بعد عد الطباعة وإتمام الخياطة',
        'permissions': {
            'fabric_warehouse_view': False, 'fabric_warehouse_edit': False,
            'accessories_warehouse_view': True, 'accessories_warehouse_edit': False,
            'production_warehouse_view': False, 'production_warehouse_edit': False,
            'design_view': True, 'design_edit': False,
            'cutting_view': False, 'cutting_edit': False,
            'qc_view': True, 'qc_edit': False,
            'printing_view': False, 'printing_edit': False,
            'sewing_view': True, 'sewing_edit': True,
            'models_tracking_view': True, 'models_tracking_edit': False,
            'reports_view': True, 'reports_edit': False,
            'view_fabric_prices': False, 'edit_fabric_prices': False,
            'view_accessory_prices': False, 'edit_accessory_prices': False,
            'view_printing_costs': False, 'edit_printing_costs': False,
            'send_whatsapp_requests': False, 'send_internal_messages': True,
            'can_add_sewing_notes': True,
        }
    }
]


DESIGN_STAGES = ('مرحلة التصميم', 'تصميم')


def sync_reserved_quantities():
    """
    Synchronizes `reserved_quantity` across all FabricColor and Accessory items:
    - When a model is in the Design stage ('مرحلة التصميم' or 'تصميم') and not deleted,
      any fabric/accessory quantities assigned to it are reserved (deducted from
      'Available for Design' only, NOT from actual total stock `quantity`).
    - Once the model's fabric is issued to Cutting (`issue_fabric_to_cutting`),
      the model moves out of Design stage, its planned quantities are deducted from
      actual total stock (`quantity` / `current_stock`), and its reservation is released.
    """
    # 1. Sync FabricColor reserved_quantity
    design_reqs = (
        ModelRequirement.objects.filter(
            model__is_deleted=False,
            model__status__in=DESIGN_STAGES
        )
        .values('color_id')
        .annotate(total_reserved=Sum('planned_quantity'))
    )
    reserved_by_color_id = {
        row['color_id']: round(max(0.0, float(row['total_reserved'] or 0.0)), 2)
        for row in design_reqs
    }

    for col in FabricColor.objects.all():
        expected_res = reserved_by_color_id.get(col.id, 0.0)
        if round(float(col.reserved_quantity or 0.0), 2) != expected_res:
            col.reserved_quantity = expected_res
            col.save(update_fields=['reserved_quantity'])

    # 2. Sync Accessory reserved_quantity
    design_accs = (
        ModelAccessory.objects.filter(
            model__is_deleted=False,
            model__status__in=DESIGN_STAGES
        )
        .exclude(accessory_id_ref__isnull=True)
        .exclude(accessory_id_ref='')
    )
    reserved_by_acc_ref = {}
    for m_acc in design_accs:
        ref = str(m_acc.accessory_id_ref).strip()
        reserved_by_acc_ref[ref] = round(
            reserved_by_acc_ref.get(ref, 0.0) + max(0.0, float(m_acc.planned_quantity or 0.0)),
            2
        )

    for acc in Accessory.objects.all():
        ext_id = acc.client_id or str(acc.id)
        expected_acc_res = reserved_by_acc_ref.get(ext_id, 0.0)
        if str(acc.id) in reserved_by_acc_ref and ext_id != str(acc.id):
            expected_acc_res = round(expected_acc_res + reserved_by_acc_ref[str(acc.id)], 2)
        if round(float(acc.reserved_quantity or 0.0), 2) != expected_acc_res:
            acc.reserved_quantity = expected_acc_res
            acc.save(update_fields=['reserved_quantity'])


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


def apply_packaging_material_transaction(size_rule, operation, amount, notes='', timestamp=''):
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

    current = float(size_rule.current_stock or 0)
    if operation == 'add':
        new_stock = current + amount
    elif operation == 'deduct':
        new_stock = max(0.0, current - amount)
    else:
        operation = 'adjust'
        new_stock = max(0.0, amount)

    size_rule.current_stock = new_stock
    size_rule.save(update_fields=['current_stock', 'updated_at'])
    return PackagingMaterialTransaction.objects.create(
        size_rule=size_rule,
        operation=operation,
        amount=amount,
        notes=notes or '',
        timestamp=timestamp or '',
    )


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
        sudo_user.set_password('14596357')
        sudo_user.save()
    else:
        changed = False
        if not sudo_user.password_hash:
            sudo_user.set_password('14596357')
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
        if item.usage_type == 'custom_model':
            if item.withdrawn_for_model:
                continue
            deficit = max(0, item.target_quantity - item.delivered_quantity)
            if deficit > 0:
                model_deficits.append({
                    'id': ext_id,
                    'code': item.code or item.custom_model_code or 'خاص',
                    'name': item.name,
                    'usage_type': 'custom_model',
                    'custom_model_code': item.custom_model_code,
                    'current_stock': item.current_stock,
                    'delivered_quantity': item.delivered_quantity,
                    'target_quantity': item.target_quantity,
                    'deficit': deficit,
                    'unit': item.unit,
                    'supplier': item.supplier
                })
        else:
            deficit = max(0, item.min_threshold - item.current_stock)
            if item.current_stock <= item.min_threshold:
                stock_deficits.append({
                    'id': ext_id,
                    'code': item.code or f"ACC-{item.id}",
                    'name': item.name,
                    'usage_type': 'stock',
                    'current_stock': item.current_stock,
                    'min_threshold': item.min_threshold,
                    'deficit': deficit,
                    'unit': item.unit,
                    'supplier': item.supplier
                })

    return {
        'stock_deficits': stock_deficits,
        'model_deficits': model_deficits,
        'total_count': len(stock_deficits) + len(model_deficits)
    }


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
        piece_suffix = f" [{disp.piece_label or ('تيشرت' if disp.piece_type == 'shirt' else 'بنطلون')}]"

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
    return notifications


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
    return notifications


def dispatch_model_to_sewing_service(
    model_id, workshop_name, pieces_count, expected_delivery_date,
    notes=None, user_name='مدير الإنتاج', piece_type='shirt', piece_label=None, client_id=None
):
    """
    Records sewing dispatch and moves model into sewing stage with independent piece tracking.
    """
    model = resolve_by_id(ModelItem, model_id)
    if not model:
        raise ValueError("الموديل غير موجود")
    resolved_label = piece_label or PART_LABELS.get(piece_type, 'قطعة')

    if piece_type == 'shirt':
        model.sewing_shirt_workshop = workshop_name
        model.sewing_shirt_expected_date = expected_delivery_date
        model.sewing_shirt_status = 'في ورشة المكن'
        model.sewing_shirt_pieces = pieces_count
    elif piece_type == 'pants':
        model.sewing_pants_workshop = workshop_name
        model.sewing_pants_expected_date = expected_delivery_date
        model.sewing_pants_status = 'في ورشة المكن'
        model.sewing_pants_pieces = pieces_count

    model.sewing_workshop = workshop_name
    model.sewing_expected_date = expected_delivery_date
    model.sewing_pieces_count = pieces_count
    # Only this part moves to sewing; the coarse status follows the slowest part.
    advance_parts_to_stage(model, 'sewing', [piece_type])
    derive_pipeline_status(model)
    model._skip_timeline_signal = True
    model.save()

    now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
    clean_notes = (notes or '').strip()
    dispatch = SewingDispatch.objects.create(
        client_id=client_id,
        model=model,
        piece_type=piece_type,
        piece_label=resolved_label,
        workshop_name=workshop_name,
        pieces_count=pieces_count,
        expected_delivery_date=expected_delivery_date,
        dispatched_at_str=now_str,
        status='في ورشة المكن',
        notes=clean_notes
    )

    tl_notes = f"تم إرسال {pieces_count} قطعة [{resolved_label}] للخياطة إلى ورشة ({workshop_name})، تاريخ الاستلام المتوقع: {expected_delivery_date}"
    if clean_notes:
        tl_notes += f" | ملاحظات: {clean_notes}"

    ModelTimeline.objects.create(
        model=model,
        stage='قسم المكن والخياطة',
        title=f'إرسال [{resolved_label}] إلى ورشة المكن: {workshop_name}',
        user=user_name,
        timestamp_str=now_str,
        notes=tl_notes,
        details={
            'phase_type': 'sewing_dispatch',
            'record_id': dispatch.client_id or str(dispatch.id),
            'piece_type': piece_type,
            'piece_label': resolved_label,
            'workshop_name': workshop_name,
            'pieces_count': pieces_count,
            'expected_delivery_date': str(expected_delivery_date),
            'dispatched_at': now_str,
            'status': 'في ورشة المكن',
            'worker_notes': clean_notes,
            'operator_name': user_name,
        }
    )

    return dispatch


def receive_model_from_sewing_service(dispatch_id, user_name='مراقب الجودة', notes=''):
    """
    Receives model from sewing workshop and routes it to QC (العد بعد المكن).
    """
    dispatch = resolve_by_id(SewingDispatch, dispatch_id)
    if not dispatch:
        raise ValueError("إرسالية الخياطة غير موجودة")
    now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
    dispatch.status = 'تم الاستلام'
    dispatch.received_date = date.today()
    dispatch.received_at_str = now_str
    clean_notes = (notes or '').strip()
    if clean_notes:
        dispatch.notes = f"{dispatch.notes} | استلام: {clean_notes}".strip(' |')
    dispatch.save()

    model = dispatch.model
    if dispatch.piece_type == 'shirt':
        model.sewing_shirt_status = 'تم الاستلام'
    elif dispatch.piece_type == 'pants':
        model.sewing_pants_status = 'تم الاستلام'

    # Bug fix: advance ONLY the received part. The other part keeps its stage so
    # receiving one part never ejects the sibling part out of sewing.
    advance_parts_to_stage(model, 'qc_after_sewing', [dispatch.piece_type or 'shirt'])
    derive_pipeline_status(model)

    other_pending = SewingDispatch.objects.filter(model=model).exclude(id=dispatch.id).exclude(status='تم الاستلام').exists()
    all_done = not other_pending

    model._skip_timeline_signal = True
    model.save()

    label = dispatch.piece_label or ('تيشرت' if dispatch.piece_type == 'shirt' else 'بنطلون')
    tl_notes = f"تم استلام {dispatch.pieces_count} قطعة [{label}] من ورشة {dispatch.workshop_name}{' واكتمال القطع وتوجيه الموديل تلقائياً إلى الفرز والجودة (العد بعد المكن)' if all_done else ''}"
    if clean_notes:
        tl_notes += f" | ملاحظات: {clean_notes}"

    ModelTimeline.objects.create(
        model=model,
        stage='قسم المكن والفرز',
        title=f'استلام [{label}] من ورشة المكن',
        user=user_name,
        timestamp_str=now_str,
        notes=tl_notes,
        details={
            'phase_type': 'sewing_receive',
            'record_id': dispatch.client_id or str(dispatch.id),
            'piece_type': dispatch.piece_type,
            'piece_label': label,
            'workshop_name': dispatch.workshop_name,
            'pieces_count': dispatch.pieces_count,
            'dispatched_at': dispatch.dispatched_at_str or '',
            'expected_delivery_date': str(dispatch.expected_delivery_date or ''),
            'received_at': now_str,
            'status': 'تم الاستلام',
            'worker_notes': clean_notes or (dispatch.notes or ''),
            'operator_name': user_name,
        }
    )

    return dispatch


# ---------------------------------------------------------------------------
# Assembly & Packaging services (الأسمبلي والأمبالاج)
# ---------------------------------------------------------------------------

def _parse_date_value(value):
    """Parses a date-ish value safely (returns None for empty / invalid input)."""
    if value in (None, ''):
        return None
    if isinstance(value, date):
        return value
    return parse_date(str(value)[:10])


def get_or_create_packaging_requirement(model):
    """Returns the PackagingRequirement of a model, creating it lazily."""
    if not model:
        raise ValueError('الموديل غير موجود')
    requirement, _created = PackagingRequirement.objects.get_or_create(model=model)
    return requirement


def packaging_requirement_summary(model):
    """Readiness summary used by the UI to gate the dest stage."""
    requirement = PackagingRequirement.objects.filter(model=model).first()
    if not requirement:
        return {
            'exists': False,
            'id': '',
            'is_complete': False,
            'missing_steps': [PACKAGING_STEP_LABELS[key] for key in PACKAGING_STEP_ORDER],
        }
    return {
        'exists': True,
        'id': requirement.client_id or str(requirement.id),
        'is_complete': requirement.is_complete,
        'missing_steps': requirement.missing_steps,
    }


def set_packaging_step_service(model, step, step_date=None, notes=None,
                               user_name='مسؤول الأمبالاج', sent_qty=None,
                               received_qty=None):
    """Sets one of the four packaging requirement dates and logs a timeline entry.

    Additionally tracks the photography sample quantities:
      * sent_to_photo     → photography_sent_qty (temporarily deducted from production)
      * received_from_photo → photography_received_qty (returned when the photographer is done)
    """
    if step not in PACKAGING_STEP_ORDER:
        raise ValueError('خطوة متطلبات الأمبالاج غير معروفة')
    requirement = get_or_create_packaging_requirement(model)

    parsed_date = _parse_date_value(step_date) or date.today()
    setattr(requirement, f'{step}_date', parsed_date)

    def _as_int(value):
        try:
            return max(0, int(float(value)))
        except (TypeError, ValueError):
            return None

    clean_sent_qty = _as_int(sent_qty)
    clean_received_qty = _as_int(received_qty)
    if step == 'sent_to_photo' and clean_sent_qty is not None:
        requirement.photography_sent_qty = clean_sent_qty
    if step == 'received_from_photo' and clean_received_qty is not None:
        requirement.photography_received_qty = clean_received_qty
    # Guard: never report receiving more than was actually sent.
    if requirement.photography_received_qty > requirement.photography_sent_qty:
        requirement.photography_received_qty = requirement.photography_sent_qty

    clean_notes = (notes or '').strip()
    if clean_notes:
        requirement.notes = clean_notes
    requirement.save()

    step_label = PACKAGING_STEP_LABELS[step]
    now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
    tl_notes = f"تم تسجيل ({step_label}) بتاريخ {parsed_date.isoformat()}"
    if step == 'sent_to_photo' and requirement.photography_sent_qty:
        tl_notes += f" - أُرسل للتصوير {requirement.photography_sent_qty} قطعة (خصم مؤقت من الإنتاج)"
    if step == 'received_from_photo':
        tl_notes += (
            f" - استُلم من التصوير {requirement.photography_received_qty} قطعة"
            f" (المتبقي بالتصوير: {requirement.photography_outstanding_qty})"
        )
    if requirement.is_complete:
        tl_notes += " - اكتملت متطلبات الأمبالاج وأصبح الموديل جاهزاً لمرحلة الدَست"
    elif clean_notes:
        tl_notes += f" | ملاحظات: {clean_notes}"

    ModelTimeline.objects.create(
        model=model,
        stage='الأسمبلي والأمبالاج',
        title=f"متطلبات الأمبالاج: {step_label}",
        notes=tl_notes,
        user=user_name,
        timestamp_str=now_str,
        details={
            'phase_type': 'packaging_requirement_step',
            'record_id': requirement.client_id or str(requirement.id),
            'step': step,
            'step_label': step_label,
            'step_date': parsed_date.isoformat(),
            'photography_sent_qty': requirement.photography_sent_qty,
            'photography_received_qty': requirement.photography_received_qty,
            'photography_outstanding_qty': requirement.photography_outstanding_qty,
            'missing_steps': requirement.missing_steps,
            'is_complete': requirement.is_complete,
            'worker_notes': clean_notes,
            'operator_name': user_name,
        },
    )
    return requirement


def start_finishing_service(model, parts=None, entry_date=None, expected_exit_date=None,
                            notes=None, vendor_name=None, user_name='مسؤول التشطيب'):
    """
    Starts (or updates) the finishing stage for the given model parts.
    Each part gets its own FinishingRecord and its own ``part_stages`` entry;
    the other parts are never touched by another part's progress.
    """
    if not model:
        raise ValueError('الموديل غير موجود')

    clean_notes = (notes or '').strip()
    clean_vendor = (vendor_name or '').strip()
    entry = _parse_date_value(entry_date) or date.today()
    expected = _parse_date_value(expected_exit_date)
    now_str = timezone.now().strftime('%Y-%m-%d %H:%M')

    ensure_part_stages(model)

    requested = [normalize_part_key(part) for part in (parts or get_model_parts(model))]
    part_keys = []
    for part in requested:
        if part in ('shirt', 'pants', 'jacket') and part not in part_keys:
            part_keys.append(part)
    if not part_keys:
        part_keys = ['shirt']

    # Never pull a part back: parts that already left finishing keep their stage.
    current_stages = get_part_stages(model)
    part_keys = [
        part for part in part_keys
        if _stage_index(current_stages.get(part, 'cutting')) <= _stage_index('finishing')
    ]
    if not part_keys:
        raise ValueError('القطع المحددة تجاوزت مرحلة التشطيب بالفعل')

    records = []
    stages = get_part_stages(model)
    for part in part_keys:
        record, created = FinishingRecord.objects.get_or_create(
            model=model,
            part_type=part,
            defaults={
                'entry_date': entry,
                'expected_exit_date': expected,
                'vendor_name': clean_vendor,
                'notes': clean_notes or None,
            },
        )
        if not created:
            record.entry_date = record.entry_date or entry
            if expected:
                record.expected_exit_date = expected
            if clean_notes:
                record.notes = clean_notes
            if clean_vendor:
                record.vendor_name = clean_vendor
            record.save()
        # Only the requested parts move into finishing; siblings keep their stage.
        stages[part] = 'finishing'
        records.append(record)

    model.part_stages = stages
    model.status = 'في التشطيب'
    model._skip_timeline_signal = True
    model.save()

    labels = ' / '.join(record.piece_label or record.part_type for record in records)
    tl_notes = f"تم تسجيل دخول [{labels}] إلى قسم التشطيب بتاريخ {entry.isoformat()}"
    if clean_vendor:
        tl_notes += f" | الجهة: {clean_vendor}"
    if expected:
        tl_notes += f" - الخروج المتوقع: {expected.isoformat()}"
    if clean_notes:
        tl_notes += f" | ملاحظات: {clean_notes}"

    ModelTimeline.objects.create(
        model=model,
        stage='قسم التشطيب',
        title=f'دخول التشطيب: {labels}',
        notes=tl_notes,
        user=user_name,
        timestamp_str=now_str,
        details={
            'phase_type': 'finishing_start',
            'record_ids': [record.client_id or str(record.id) for record in records],
            'parts': part_keys,
            'entry_date': entry.isoformat(),
            'expected_exit_date': expected.isoformat() if expected else '',
            'vendor_name': clean_vendor,
            'worker_notes': clean_notes,
            'operator_name': user_name,
        },
    )
    return records


def receive_finishing_service(record_id, actual_exit_date=None, notes=None,
                              user_name='مسؤول التشطيب'):
    """
    Receives one garment part from finishing. When all parts of the model are
    received the model is promoted to «في المكواة».
    """
    record = resolve_by_id(FinishingRecord, record_id)
    if not record:
        raise ValueError('سجل التشطيب غير موجود')

    actual = _parse_date_value(actual_exit_date) or date.today()
    clean_notes = (notes or '').strip()
    record.actual_exit_date = actual
    if clean_notes:
        record.notes = f"{record.notes} | استلام: {clean_notes}".strip(' |') if record.notes else clean_notes
    record.save()

    model = record.model
    # Move only this part to ironing; the model status follows the least advanced part.
    ensure_part_stages(model)
    sync_model_status_from_part_stages(model)
    all_received = not FinishingRecord.objects.filter(
        model=model, actual_exit_date__isnull=True
    ).exists()

    now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
    label = record.piece_label or ('تيشرت' if record.part_type == 'shirt' else 'بنطلون')
    tl_notes = f"تم استلام [{label}] من التشطيب بتاريخ {actual.isoformat()}"
    if all_received:
        tl_notes += ' - اكتملت كل قطع التشطيب وتوجيه الموديل تلقائياً إلى قسم المكواة'
    if clean_notes:
        tl_notes += f" | ملاحظات: {clean_notes}"

    ModelTimeline.objects.create(
        model=model,
        stage='قسم التشطيب',
        title=f'استلام [{label}] من التشطيب',
        notes=tl_notes,
        user=user_name,
        timestamp_str=now_str,
        details={
            'phase_type': 'finishing_receive',
            'record_id': record.client_id or str(record.id),
            'part_type': record.part_type,
            'piece_label': label,
            'entry_date': record.entry_date.isoformat() if record.entry_date else '',
            'expected_exit_date': record.expected_exit_date.isoformat() if record.expected_exit_date else '',
            'actual_exit_date': actual.isoformat(),
            'all_parts_received': all_received,
            'worker_notes': clean_notes,
            'operator_name': user_name,
        },
    )
    return record


ASSEMBLY_STAGE_STATUS = {
    'ironing': 'في المكواة',
    'packaging': 'في التعبئة والتغليف',
    'dest': 'جاهز للدَست',
}

ASSEMBLY_STAGE_NEXT_STATUS = {
    'ironing': 'في التعبئة والتغليف',
    'packaging': 'جاهز للدَست',
    'dest': 'مخزن الإنتاج التام',
}


def start_ironing_service(model, part_type=None, parts=None, entry_date=None,
                          expected_exit_date=None, notes=None, vendor_name=None,
                          user_name='مسؤول المكواة'):
    """Starts (or updates) the ironing stage for one or more garment parts.

    Ironing is tracked per part: each part gets its own AssemblyStageRecord with
    ``stage='ironing'`` and its own ``part_stages`` entry.
    """
    if not model:
        raise ValueError('الموديل غير موجود')

    clean_notes = (notes or '').strip()
    clean_vendor = (vendor_name or '').strip()
    entry = _parse_date_value(entry_date) or date.today()
    expected = _parse_date_value(expected_exit_date)
    now_str = timezone.now().strftime('%Y-%m-%d %H:%M')

    ensure_part_stages(model)
    stages = get_part_stages(model)

    requested = []
    for value in (parts or ([part_type] if part_type else [])):
        key = normalize_part_key(value)
        if key in ('shirt', 'pants', 'jacket') and key not in requested:
            requested.append(key)
    if not requested:
        requested = [part for part, stage in stages.items() if stage == 'ironing']
    if not requested:
        raise ValueError('لا توجد قطعة في مرحلة المكواة لتسجيل دخولها')

    # Never pull a part back: parts already sent to packaging keep their stage.
    requested = [
        part for part in requested
        if _stage_index(stages.get(part, 'cutting')) <= _stage_index('ironing')
    ]
    if not requested:
        raise ValueError('القطع المحددة تجاوزت مرحلة المكواة بالفعل')
    not_ready = [part for part in requested if stages.get(part) != 'ironing']
    if not_ready:
        labels = ' / '.join(PART_LABELS.get(part, part) for part in not_ready)
        raise ValueError(f"لا يمكن بدء المكواة قبل استلام ({labels}) من التشطيب")

    records = []
    for part in requested:
        record, created = AssemblyStageRecord.objects.get_or_create(
            model=model,
            stage='ironing',
            part_type=part,
            defaults={
                'entry_date': entry,
                'expected_exit_date': expected,
                'vendor_name': clean_vendor,
                'notes': clean_notes or None,
            },
        )
        if not created:
            record.entry_date = record.entry_date or entry
            if expected:
                record.expected_exit_date = expected
            if clean_vendor:
                record.vendor_name = clean_vendor
            if clean_notes:
                record.notes = clean_notes
            record.save()
        stages[part] = 'ironing'
        records.append(record)

    model.part_stages = stages
    model._skip_timeline_signal = True
    model.save()
    sync_model_status_from_part_stages(model)

    labels = ' / '.join(record.stage_label for record in records)
    tl_notes = f"تم تسجيل دخول [{labels}] إلى قسم المكواة بتاريخ {entry.isoformat()}"
    if clean_vendor:
        tl_notes += f" | الجهة: {clean_vendor}"
    if expected:
        tl_notes += f" - الخروج المتوقع: {expected.isoformat()}"
    if clean_notes:
        tl_notes += f" | ملاحظات: {clean_notes}"

    ModelTimeline.objects.create(
        model=model,
        stage='قسم المكواة',
        title=f'دخول المكواة: {labels}',
        notes=tl_notes,
        user=user_name,
        timestamp_str=now_str,
        details={
            'phase_type': 'ironing_start',
            'record_ids': [record.client_id or str(record.id) for record in records],
            'parts': requested,
            'entry_date': entry.isoformat(),
            'expected_exit_date': expected.isoformat() if expected else '',
            'vendor_name': clean_vendor,
            'worker_notes': clean_notes,
            'operator_name': user_name,
        },
    )
    return records


def receive_ironing_service(record_id, actual_exit_date=None, notes=None,
                            user_name='مسؤول المكواة'):
    """Completes the ironing of one part and moves that part to packaging."""
    record = resolve_by_id(AssemblyStageRecord, record_id)
    if not record or record.stage != 'ironing':
        raise ValueError('سجل المكواة غير موجود')

    actual = _parse_date_value(actual_exit_date) or date.today()
    clean_notes = (notes or '').strip()
    record.actual_exit_date = actual
    if clean_notes:
        record.notes = f"{record.notes} | استلام: {clean_notes}".strip(' |') if record.notes else clean_notes
    record.save()

    model = record.model
    # ensure_part_stages promotes this part to packaging (the record is now
    # completed); sync then derives status from the least advanced part.
    ensure_part_stages(model)
    sync_model_status_from_part_stages(model)

    now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
    label = record.stage_label
    tl_notes = f"تم استلام [{label}] من المكواة بتاريخ {actual.isoformat()}"
    if clean_notes:
        tl_notes += f" | ملاحظات: {clean_notes}"

    ModelTimeline.objects.create(
        model=model,
        stage='قسم المكواة',
        title=f'استلام [{label}] من المكواة',
        notes=tl_notes,
        user=user_name,
        timestamp_str=now_str,
        details={
            'phase_type': 'ironing_receive',
            'record_id': record.client_id or str(record.id),
            'part_type': record.part_type,
            'entry_date': record.entry_date.isoformat() if record.entry_date else '',
            'expected_exit_date': record.expected_exit_date.isoformat() if record.expected_exit_date else '',
            'actual_exit_date': actual.isoformat(),
            'next_stage': 'packaging',
            'worker_notes': clean_notes,
            'operator_name': user_name,
        },
    )
    return record


def start_assembly_stage_service(model, stage, entry_date=None, expected_exit_date=None,
                                 notes=None, vendor_name=None, part_type=None,
                                 user_name='مسؤول الأسمبلي'):
    """
    Starts (or updates) one assembly stage (ironing / packaging / dest).

    * ironing   → delegates to start_ironing_service (tracked per garment part).
    * packaging → model-level, allowed only once every part reached packaging.
    * dest      → model-level, gated by the packaging requirements.
    """
    if not model:
        raise ValueError('الموديل غير موجود')
    if stage not in ASSEMBLY_STAGE_STATUS:
        raise ValueError('مرحلة الأسمبلي غير معروفة')

    if stage == 'ironing':
        return start_ironing_service(
            model,
            part_type=part_type,
            entry_date=entry_date,
            expected_exit_date=expected_exit_date,
            notes=notes,
            vendor_name=vendor_name,
            user_name=user_name,
        )

    if stage == 'packaging':
        readiness = packaging_readiness(model)
        if not readiness['all_ready']:
            waiting = ' / '.join(item['label'] for item in readiness['waiting_parts'])
            raise ValueError(
                f"لا يمكن بدء التعبئة والتغليف قبل وصول كل القطع. في الانتظار: {waiting}"
            )

    if stage == 'dest':
        summary = packaging_requirement_summary(model)
        if not summary['is_complete']:
            missing = ' / '.join(summary['missing_steps'])
            raise ValueError(
                f"لا يمكن بدء الدَست: متطلبات الأمبالاج غير مكتملة. المتبقي: {missing}"
            )

    clean_notes = (notes or '').strip()
    clean_vendor = (vendor_name or '').strip()
    entry = _parse_date_value(entry_date) or date.today()
    expected = _parse_date_value(expected_exit_date)
    now_str = timezone.now().strftime('%Y-%m-%d %H:%M')

    record, created = AssemblyStageRecord.objects.get_or_create(
        model=model,
        stage=stage,
        part_type='',
        defaults={
            'entry_date': entry,
            'expected_exit_date': expected,
            'vendor_name': clean_vendor,
            'notes': clean_notes or None,
        },
    )
    if not created:
        record.entry_date = record.entry_date or entry
        if expected:
            record.expected_exit_date = expected
        if clean_vendor:
            record.vendor_name = clean_vendor
        if clean_notes:
            record.notes = clean_notes
        record.save()

    ensure_part_stages(model)
    sync_model_status_from_part_stages(model)

    label = ASSEMBLY_STAGE_LABELS.get(stage, stage)
    tl_notes = f"تم تسجيل دخول الموديل إلى {label} بتاريخ {entry.isoformat()}"
    if clean_vendor:
        tl_notes += f" | الجهة: {clean_vendor}"
    if expected:
        tl_notes += f" - الخروج المتوقع: {expected.isoformat()}"
    if clean_notes:
        tl_notes += f" | ملاحظات: {clean_notes}"

    ModelTimeline.objects.create(
        model=model,
        stage=label,
        title=f'دخول {label}',
        notes=tl_notes,
        user=user_name,
        timestamp_str=now_str,
        details={
            'phase_type': 'assembly_stage_start',
            'record_id': record.client_id or str(record.id),
            'stage': stage,
            'stage_label': label,
            'entry_date': entry.isoformat(),
            'expected_exit_date': expected.isoformat() if expected else '',
            'vendor_name': clean_vendor,
            'worker_notes': clean_notes,
            'operator_name': user_name,
        },
    )
    return record


def receive_assembly_stage_service(record_id, actual_exit_date=None, notes=None,
                                   user_name='مسؤول الأسمبلي'):
    """
    Completes an assembly stage record and promotes the model to the next stage
    (dest → مخزن الإنتاج التام).
    """
    record = resolve_by_id(AssemblyStageRecord, record_id)
    if not record:
        raise ValueError('سجل مرحلة الأسمبلي غير موجود')

    actual = _parse_date_value(actual_exit_date) or date.today()
    clean_notes = (notes or '').strip()
    record.actual_exit_date = actual
    if clean_notes:
        record.notes = f"{record.notes} | استلام: {clean_notes}".strip(' |') if record.notes else clean_notes
    record.save()

    model = record.model
    # Advance the per-part stages: ironing → that part to packaging,
    # packaging → all parts to dest, dest → all parts completed.
    if record.stage == 'packaging':
        set_all_part_stages(model, 'dest')
    elif record.stage == 'dest':
        set_all_part_stages(model, 'completed')
    else:
        ensure_part_stages(model)
    next_status = sync_model_status_from_part_stages(model)

    now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
    label = record.stage_label
    tl_notes = f"تم استلام الموديل من {label} بتاريخ {actual.isoformat()}"
    if next_status:
        tl_notes += f" - الحالة الجديدة: {next_status}"
    if clean_notes:
        tl_notes += f" | ملاحظات: {clean_notes}"

    ModelTimeline.objects.create(
        model=model,
        stage=label,
        title=f'استلام من {label}',
        notes=tl_notes,
        user=user_name,
        timestamp_str=now_str,
        details={
            'phase_type': 'assembly_stage_receive',
            'record_id': record.client_id or str(record.id),
            'stage': record.stage,
            'stage_label': label,
            'entry_date': record.entry_date.isoformat() if record.entry_date else '',
            'expected_exit_date': record.expected_exit_date.isoformat() if record.expected_exit_date else '',
            'actual_exit_date': actual.isoformat(),
            'next_status': next_status or '',
            'worker_notes': clean_notes,
            'operator_name': user_name,
        },
    )
    return record
