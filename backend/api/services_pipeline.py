import os
from collections import defaultdict
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
from .serializers import resolve_by_id, get_ext_id


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
        # فرشات "القصة / الجزء الفرعي" تُستهلك قماشها وتُحسب أوزانها فقط،
        # ولا تدخل في عدّاد القطع المقصوصة للقطعة الأساسية.
        if getattr(rec, 'is_sub_cut', False):
            continue
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


def _model_reached_finished_stage(model):
    """True when every part of the model has moved past the sewing stage.

    Uses the per-part stages when available (the single source of truth) and
    falls back to the coarse legacy status for older rows.
    """
    raw = getattr(model, 'part_stages', None)
    stages = []
    if isinstance(raw, dict) and raw:
        stages = [
            raw.get(part) for part in get_model_parts(model)
            if raw.get(part) in PART_STAGE_ORDER
        ]
    if stages:
        return all(stage in FINISHED_PART_STAGES for stage in stages)
    return (getattr(model, 'status', '') or '') in FINISHED_STATUSES


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

    # --- الأطقم التامة الجاهزة (بعد اعتماد الفحص النهائي وخصم عينات التصوير) ---
    # العدد المعتمد لكل قطعة = عدد الفحص النهائي إن وُجد وإلا عدد القص.
    if 'single' in parts:
        healthy_sets = int(getattr(model, 'count_after_sewing', 0) or 0)
        if not healthy_sets:
            healthy_sets = int(getattr(model, 'count_after_print', 0) or 0)
        if not healthy_sets:
            healthy_sets = int(getattr(model, 'total_cut_pieces', 0) or 0)
    else:
        approved_counts = [
            int(qc_map.get(part, 0) or 0) or int(cut_map.get(part, 0) or 0)
            for part in parts
        ]
        healthy_sets = min(approved_counts, default=0)
    healthy_sets = max(0, int(healthy_sets))

    # قطع العينات التي ما زالت في التصوير تُخصم مؤقتاً من الأطقم السليمة.
    photography_outstanding_qty = 0
    try:
        requirement = model.packaging_requirement
    except PackagingRequirement.DoesNotExist:
        requirement = None
    if requirement is not None:
        photography_outstanding_qty = max(0, int(requirement.photography_outstanding_qty or 0))
    finished_good_sets = max(0, healthy_sets - photography_outstanding_qty)

    # بعد المكن/التشطيب/الإنتاج التام يصبح عدد الأطقم التامة هو المعتمد فعلياً
    # (بدلاً من عدد القص) حتى لا يظهر رقم مضاعف للموديلات ذات القطعتين.
    if _model_reached_finished_stage(model):
        completed_sets = finished_good_sets

    return {
        'parts': parts,
        'cut_summary': cut_summary,
        'qc_summary': qc_summary,
        'sewing_available': sewing_available,
        'completed_sets': completed_sets,
        'finished_good_sets': finished_good_sets,
        'photography_outstanding_qty': photography_outstanding_qty,
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

    # إذا غادرت كل القطع مرحلة القص بينما الحالة العامة ما زالت "في القص"
    # نحدّث الحالة فوراً حتى لا يظهر الموديل في قسم القص وقسم آخر في نفس الوقت.
    if stages and (model.status or '') in ('في القص', 'جاري القص'):
        if all(_stage_index(stage) > _stage_index('cutting') for stage in stages.values()):
            derive_pipeline_status(model, save=True)

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
            'view_printing_prices': True, 'edit_printing_prices': True,
            'view_sewing_prices': True, 'edit_sewing_prices': True,
            'view_assembly_prices': True, 'edit_assembly_prices': True,
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
            'view_printing_prices': False, 'edit_printing_prices': False,
            'view_sewing_prices': False, 'edit_sewing_prices': False,
            'view_assembly_prices': False, 'edit_assembly_prices': False,
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
            'view_printing_prices': False, 'edit_printing_prices': False,
            'view_sewing_prices': False, 'edit_sewing_prices': False,
            'view_assembly_prices': False, 'edit_assembly_prices': False,
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
            'view_printing_prices': False, 'edit_printing_prices': False,
            'view_sewing_prices': False, 'edit_sewing_prices': False,
            'view_assembly_prices': False, 'edit_assembly_prices': False,
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
            'view_printing_prices': False, 'edit_printing_prices': False,
            'view_sewing_prices': False, 'edit_sewing_prices': False,
            'view_assembly_prices': False, 'edit_assembly_prices': False,
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
            'view_printing_prices': False, 'edit_printing_prices': False,
            'view_sewing_prices': False, 'edit_sewing_prices': False,
            'view_assembly_prices': False, 'edit_assembly_prices': False,
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
            'view_printing_prices': True, 'edit_printing_prices': True,
            'view_sewing_prices': True, 'edit_sewing_prices': True,
            'view_assembly_prices': True, 'edit_assembly_prices': True,
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
            'view_printing_prices': False, 'edit_printing_prices': False,
            'view_sewing_prices': False, 'edit_sewing_prices': False,
            'view_assembly_prices': False, 'edit_assembly_prices': False,
            'send_whatsapp_requests': False, 'send_internal_messages': True,
            'can_add_sewing_notes': True,
        }
    }
]


DESIGN_STAGES = ('مرحلة التصميم', 'تصميم')


def sync_reserved_quantities():
    """
    Synchronizes `reserved_quantity` across all FabricColor and Accessory items:
    - Fabric: while a model is in the Design stage ('مرحلة التصميم' or 'تصميم') and not
      deleted, its planned fabric quantities are reserved (deducted from 'Available for
      Design' only, NOT from actual total stock `quantity`). Once the fabric is issued to
      Cutting (`issue_fabric_to_cutting`) the reservation is released.
    - Accessories: the reservation is kept across ALL pipeline stages until the accessory
      warehouse keeper confirms the actual issue (`is_issued = True`). Only then is the
      reservation released and the real `current_stock` deducted.
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

    # 2. Sync Accessory reserved_quantity — يبقى محجوزاً حتى الصرف الفعلي (is_issued=False).
    design_accs = (
        ModelAccessory.objects.filter(
            model__is_deleted=False,
            is_issued=False,
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


def _resolve_refund_supplier(item):
    """يربط حركة الاسترداد بسجل المورد المسجل على الخامة/الإكسسوار.

    يُكرّر منطق ``resolve_supplier_link`` الموجود في طبقة الـ views لكن دون
    استيراد ``views_common`` (تفادياً للاستيراد الدائري لأن views يعتمد على services).
    """
    supplier_id_ref = getattr(item, 'supplier_id_ref', None)
    if supplier_id_ref:
        found = resolve_by_id(Supplier, supplier_id_ref)
        if found:
            return found
    supplier_name = str(getattr(item, 'supplier', None) or '').strip()
    if supplier_name:
        return Supplier.objects.filter(name__iexact=supplier_name).first()
    return None


def refund_model_consumed_inventory(model, user_name=''):
    """استرداد آمن (Idempotent) لخامات وإكسسوارات موديل محذوف إلى المخزن.

    لكل ``color_id`` و``accessory_id`` مرتبط بالموديل (عبر ``model_code_ref``)
    يُحسب الصافي المنصرف فعلياً = مجموع حركات ``deduct`` - مجموع حركات ``add``.
    لا يُعاد إلا ما تبقّى مصروفاً فعلاً (الصافي موجب)؛ وبما أنّ حركة الاسترداد
    نفسها تُسجَّل بـ ``operation='add'`` وبنفس ``model_code_ref``، فإن إعادة
    استدعاء الدالة تُنتج صافياً صفرياً ولا يُكرَّر الاسترداد أبداً.

    حركات ``defect`` (عيوب القماش) لا تُخصم من الصافي عمداً لأنها لم تُعَد
    للمخزن أصلاً وتبقى ضمن كمية الصرف.

    تعمل الكل داخل ``transaction.atomic()`` مع ``select_for_update()`` على صفوف
    الأرصدة لمنع أي تعارض تزامني، وتُرجع ملخصاً بالكميات المستردة.
    """
    now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
    model_code = (model.model_code or '').strip()

    refund_note = f"استرداد تلقائي لخامات الموديل المحذوف {model_code}"
    if user_name:
        refund_note += f" بواسطة {user_name}"

    fabric_details = []
    accessory_details = []

    with transaction.atomic():
        # قفل سجل الموديل أولاً داخل المعاملة لمنع أي استرداد مزدوج متزامن.
        if getattr(model, 'pk', None):
            ModelItem.objects.select_for_update().filter(pk=model.pk).first()

        # 1. تجميع الصافي المنصرف لكل لون قماش / إكسسوار من الحركات المرتبطة بالموديل.
        # القاعدة المحاسبية المؤكدة: لا يُعاد قماش العيوب (defect) أبداً للرصيد السليم:
        #   refund = total_deducted - total_returned_good (add) - total_defect (defect)
        fabric_net = defaultdict(float)
        accessory_net = defaultdict(float)
        if model_code:
            for txn in (
                FabricTransaction.objects
                .filter(model_code_ref__iexact=model_code)
                .values('color_id', 'operation', 'amount')
            ):
                color_id = txn['color_id']
                if color_id is None:
                    continue
                amount = float(txn['amount'] or 0)
                if txn['operation'] == 'deduct':
                    fabric_net[color_id] += amount
                elif txn['operation'] in ('add', 'defect'):
                    fabric_net[color_id] -= amount

            for txn in (
                AccessoryTransaction.objects
                .filter(model_code_ref__iexact=model_code)
                .values('accessory_id', 'operation', 'amount')
            ):
                accessory_id = txn['accessory_id']
                if accessory_id is None:
                    continue
                amount = float(txn['amount'] or 0)
                if txn['operation'] == 'deduct':
                    accessory_net[accessory_id] += amount
                elif txn['operation'] == 'add':
                    accessory_net[accessory_id] -= amount

        # 2. استرداد القماش: إضافة الصافي للرصيد الفعلي وتسجيل حركة إضافة.
        for color_id, raw_net in fabric_net.items():
            net = round(float(raw_net), 2)
            if net <= 0:
                continue
            try:
                col = (
                    FabricColor.objects.select_for_update()
                    .select_related('fabric')
                    .get(pk=color_id)
                )
            except FabricColor.DoesNotExist:
                continue
            col.quantity = round(float(col.quantity or 0) + net, 2)
            col.save(update_fields=['quantity'])

            fabric = col.fabric
            FabricTransaction.objects.create(
                color=col,
                fabric=fabric,
                model_code_ref=model.model_code,
                notes=refund_note,
                operation='add',
                amount=net,
                timestamp=now_str,
                unit_price_snapshot=col.price_per_unit or 0,
                supplier=_resolve_refund_supplier(fabric),
            )
            fabric_details.append({
                'color_id': get_ext_id(col),
                'color_code': col.color_code or '',
                'color_name': col.color_name or '',
                'fabric_name': fabric.name if fabric else '',
                'quantity': net,
                'unit': fabric.unit if fabric else '',
            })

        # 3. استرداد الإكسسوارات: إضافة الصافي للرصيد الفعلي وتسجيل حركة إضافة.
        from decimal import Decimal as _Decimal
        for accessory_id, raw_net in accessory_net.items():
            net = round(float(raw_net), 3)
            if net <= 0:
                continue
            try:
                item = Accessory.objects.select_for_update().get(pk=accessory_id)
            except Accessory.DoesNotExist:
                continue
            cur = _Decimal(str(item.current_stock or 0))
            item.current_stock = (cur + _Decimal(str(net))).quantize(_Decimal('0.001'))
            item.save(update_fields=['current_stock'])

            AccessoryTransaction.objects.create(
                accessory=item,
                accessory_code=item.code or '',
                accessory_name=item.name or '',
                operation='add',
                amount=net,
                model_code_ref=model.model_code,
                notes=refund_note,
                timestamp=now_str,
                unit_price_snapshot=item.price_per_unit or 0,
                supplier=_resolve_refund_supplier(item),
            )
            accessory_details.append({
                'accessory_id': get_ext_id(item),
                'accessory_code': item.code or '',
                'accessory_name': item.name or '',
                'quantity': net,
                'unit': item.unit or 'قطعة',
            })

        # 4. تصفير حالة الصرف الفعلي لإكسسوارات الموديل إن كانت قد صُرفت فعلاً،
        #    حتى لا تبقى معلّمة كـ«مصروفة» بعد عودة أرصدتها للمخزن.
        reset_count = 0
        for m_acc in ModelAccessory.objects.filter(model=model, is_issued=True):
            m_acc.is_issued = False
            m_acc.issued_quantity = 0
            m_acc.issued_to = ''
            m_acc.issued_at = ''
            m_acc.issued_by = ''
            m_acc.save(update_fields=[
                'is_issued', 'issued_quantity', 'issued_to', 'issued_at', 'issued_by',
            ])
            reset_count += 1

        if reset_count:
            sync_reserved_quantities()

    return {
        'model_code': model.model_code,
        'fabric_colors_count': len(fabric_details),
        'fabric_total_quantity': round(sum(d['quantity'] for d in fabric_details), 2),
        'fabric_details': fabric_details,
        'accessories_count': len(accessory_details),
        'accessories_total_quantity': round(sum(d['quantity'] for d in accessory_details), 2),
        'accessory_details': accessory_details,
    }


