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
from .services_schema_seed import *

def dispatch_model_to_sewing_service(
    model_id, workshop_name, pieces_count, expected_delivery_date,
    notes=None, user_name='مدير الإنتاج', piece_type='shirt', piece_label=None, client_id=None,
    cost_per_piece=0.0, total_cost=None, workshop=None,
):
    """
    Records sewing dispatch and moves model into sewing stage with independent piece tracking.
    """
    model = resolve_by_id(ModelItem, model_id)
    if not model:
        raise ValueError("الموديل غير موجود")
    resolved_label = piece_label or PART_LABELS.get(piece_type, 'قطعة')
    unit_cost, total_work_cost = resolve_cost_values(cost_per_piece, total_cost, pieces_count)

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
    # اربط الورشة المسجلة بالاسم إن لم تُمرَّر صريحاً، مع الإبقاء على الاسم النصي كما هو.
    if workshop is None and workshop_name:
        workshop = Workshop.objects.filter(name__iexact=workshop_name).first()
    dispatch = SewingDispatch.objects.create(
        client_id=client_id,
        model=model,
        piece_type=piece_type,
        piece_label=resolved_label,
        workshop_name=workshop_name,
        workshop=workshop,
        pieces_count=pieces_count,
        expected_delivery_date=expected_delivery_date,
        dispatched_at_str=now_str,
        status='في ورشة المكن',
        notes=clean_notes,
        cost_per_piece=unit_cost,
        total_cost=total_work_cost,
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
            'cost_per_piece': unit_cost,
            'total_cost': total_work_cost,
        }
    )

    return dispatch


def receive_model_from_sewing_service(dispatch_id, user_name='مراقب الجودة', notes='', received_qty=None):
    """
    Receives model from sewing workshop and routes it to QC (العد بعد المكن).

    Supports partial receipt on several batches: every call adds ``received_qty``
    pieces to ``received_pieces``, appends a row to ``receive_history`` and keeps
    the part at the QC-after-sewing stage so the sorting section can count each
    delivered batch as soon as it arrives.
    """
    dispatch = resolve_by_id(SewingDispatch, dispatch_id)
    if not dispatch:
        raise ValueError("إرسالية الخياطة غير موجودة")
    now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
    clean_notes = (notes or '').strip()

    total_pieces = int(dispatch.pieces_count or 0)
    already_received = int(dispatch.received_pieces or 0)
    remaining_before = max(0, total_pieces - already_received)

    try:
        requested_qty = int(received_qty) if received_qty not in (None, '') else 0
    except (TypeError, ValueError):
        requested_qty = 0

    if requested_qty > 0:
        if remaining_before == 0:
            raise ValueError('تم استلام كامل كمية هذه التشغيلة مسبقاً')
        batch_qty = min(remaining_before, requested_qty)
    else:
        batch_qty = remaining_before or total_pieces

    dispatch.received_pieces = already_received + batch_qty
    history = dispatch.receive_history if isinstance(dispatch.receive_history, list) else []
    history.append({
        'date': now_str,
        'qty': batch_qty,
        'total_received': dispatch.received_pieces,
        'user': user_name,
        'notes': clean_notes,
    })
    dispatch.receive_history = history
    is_complete = dispatch.received_pieces >= total_pieces
    dispatch.status = 'تم الاستلام' if is_complete else 'استلام جزئي'
    dispatch.received_date = date.today()
    dispatch.received_at_str = now_str
    if clean_notes:
        dispatch.notes = f"{dispatch.notes} | استلام: {clean_notes}".strip(' |')
    dispatch.save()

    model = dispatch.model
    if is_complete:
        if dispatch.piece_type == 'shirt':
            model.sewing_shirt_status = 'تم الاستلام'
        elif dispatch.piece_type == 'pants':
            model.sewing_pants_status = 'تم الاستلام'

    # Bug fix: advance ONLY the received part. The other part keeps its stage so
    # receiving one part never ejects the sibling part out of sewing.
    # Partial batches also open the sorting stage so every delivered batch is
    # counted right away.
    advance_parts_to_stage(model, 'qc_after_sewing', [dispatch.piece_type or 'shirt'])
    derive_pipeline_status(model)

    other_pending = SewingDispatch.objects.filter(model=model).exclude(id=dispatch.id).exclude(status='تم الاستلام').exists()
    all_done = not other_pending and is_complete

    model._skip_timeline_signal = True
    model.save()

    label = dispatch.piece_label or ('تيشرت' if dispatch.piece_type == 'shirt' else 'بنطلون')
    tl_notes = (
        f"استلام دفعة ({batch_qty} قطعة) — إجمالي المستلم {dispatch.received_pieces} من {total_pieces} [{label}] "
        f"من ورشة {dispatch.workshop_name}"
        f"{' واكتمال القطع وتوجيه الموديل تلقائياً إلى الفرز والجودة (العد بعد المكن)' if all_done else ''}"
    )
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
            'batch_qty': batch_qty,
            'received_pieces': dispatch.received_pieces,
            'remaining_pieces': max(0, total_pieces - dispatch.received_pieces),
            'dispatched_at': dispatch.dispatched_at_str or '',
            'expected_delivery_date': str(dispatch.expected_delivery_date or ''),
            'received_at': now_str,
            'status': dispatch.status,
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


def _model_part_pieces(model, part):
    """أفضل عدد قطع متاح لهذه القطعة في الموديل (لحساب تكاليف التشطيب/المكواة).

    يعتمد على العد السليم (qc_*) أولاً، ثم المقصوص (cut_*)، ثم العد بعد المكن،
    وأخيراً إجمالي المقصوص — بنفس أولويات تقارير الإنتاج.
    """
    key = normalize_part_key(part)
    if key in ('shirt', 'pants', 'jacket'):
        value = int(getattr(model, f'qc_{key}_pieces', 0) or 0)
        if value:
            return value
        value = int(getattr(model, f'cut_{key}_pieces', 0) or 0)
        if value:
            return value
    return (
        int(getattr(model, 'count_after_sewing', 0) or 0)
        or int(getattr(model, 'total_cut_pieces', 0) or 0)
        or 0
    )


def start_finishing_service(model, parts=None, entry_date=None, expected_exit_date=None,
                            notes=None, vendor_name=None, user_name='مسؤول التشطيب',
                            cost_per_piece=0.0, total_cost=None, workshop=None):
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
    unit_cost, total_finish_cost = resolve_cost_values(cost_per_piece, total_cost)

    # اربط الورشة المسجلة بالاسم إن لم تُمرَّر صريحاً، مع الإبقاء على الاسم النصي كما هو.
    if workshop is None and clean_vendor:
        workshop = Workshop.objects.filter(name__iexact=clean_vendor).first()

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
    part_totals = []
    stages = get_part_stages(model)
    for part in part_keys:
        part_pieces = _model_part_pieces(model, part)
        part_unit_cost, part_total_cost = resolve_cost_values(
            cost_per_piece, total_cost, pieces_count=part_pieces
        )
        part_totals.append(part_total_cost)
        record, created = FinishingRecord.objects.get_or_create(
            model=model,
            part_type=part,
            defaults={
                'entry_date': entry,
                'expected_exit_date': expected,
                'vendor_name': clean_vendor,
                'workshop': workshop,
                'notes': clean_notes or None,
                'cost_per_piece': part_unit_cost,
                'total_cost': part_total_cost,
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
            if workshop is not None:
                record.workshop = workshop
            if part_unit_cost or part_total_cost:
                record.cost_per_piece = part_unit_cost
                record.total_cost = part_total_cost
            record.save()
        # Only the requested parts move into finishing; siblings keep their stage.
        stages[part] = 'finishing'
        records.append(record)

    # إن لم يرسل المستخدم الإجمالي يدوياً، فالإجمالي = مجموع تكلفة قطع كل الأجزاء.
    if total_cost in (None, ''):
        total_finish_cost = round(sum(part_totals), 2)

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
            'cost_per_piece': unit_cost,
            'total_cost': total_finish_cost,
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
                          user_name='مسؤول المكواة', cost_per_piece=0.0, total_cost=None,
                          workshop=None):
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
    unit_cost, total_iron_cost = resolve_cost_values(cost_per_piece, total_cost)

    # اربط الورشة المسجلة بالاسم إن لم تُمرَّر صريحاً، مع الإبقاء على الاسم النصي كما هو.
    if workshop is None and clean_vendor:
        workshop = Workshop.objects.filter(name__iexact=clean_vendor).first()

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
    part_totals = []
    for part in requested:
        part_pieces = _model_part_pieces(model, part)
        part_unit_cost, part_total_cost = resolve_cost_values(
            cost_per_piece, total_cost, pieces_count=part_pieces
        )
        part_totals.append(part_total_cost)
        record, created = AssemblyStageRecord.objects.get_or_create(
            model=model,
            stage='ironing',
            part_type=part,
            defaults={
                'entry_date': entry,
                'expected_exit_date': expected,
                'vendor_name': clean_vendor,
                'workshop': workshop,
                'notes': clean_notes or None,
                'cost_per_piece': part_unit_cost,
                'total_cost': part_total_cost,
            },
        )
        if not created:
            record.entry_date = record.entry_date or entry
            if expected:
                record.expected_exit_date = expected
            if clean_vendor:
                record.vendor_name = clean_vendor
            if workshop is not None:
                record.workshop = workshop
            if clean_notes:
                record.notes = clean_notes
            if part_unit_cost or part_total_cost:
                record.cost_per_piece = part_unit_cost
                record.total_cost = part_total_cost
            record.save()
        stages[part] = 'ironing'
        records.append(record)

    # إن لم يرسل المستخدم الإجمالي يدوياً، فالإجمالي = مجموع تكلفة قطع كل الأجزاء.
    if total_cost in (None, ''):
        total_iron_cost = round(sum(part_totals), 2)

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
            'cost_per_piece': unit_cost,
            'total_cost': total_iron_cost,
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
                                 user_name='مسؤول الأسمبلي', cost_per_piece=0.0, total_cost=None,
                                 workshop=None):
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
            cost_per_piece=cost_per_piece,
            total_cost=total_cost,
            workshop=workshop,
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
    unit_cost, total_stage_cost = resolve_cost_values(cost_per_piece, total_cost)

    # اربط الورشة المسجلة بالاسم إن لم تُمرَّر صريحاً، مع الإبقاء على الاسم النصي كما هو.
    if workshop is None and clean_vendor:
        workshop = Workshop.objects.filter(name__iexact=clean_vendor).first()

    record, created = AssemblyStageRecord.objects.get_or_create(
        model=model,
        stage=stage,
        part_type='',
        defaults={
            'entry_date': entry,
            'expected_exit_date': expected,
            'vendor_name': clean_vendor,
            'workshop': workshop,
            'notes': clean_notes or None,
            'cost_per_piece': unit_cost,
            'total_cost': total_stage_cost,
        },
    )
    if not created:
        record.entry_date = record.entry_date or entry
        if expected:
            record.expected_exit_date = expected
        if clean_vendor:
            record.vendor_name = clean_vendor
        if workshop is not None:
            record.workshop = workshop
        if clean_notes:
            record.notes = clean_notes
        if unit_cost or total_stage_cost:
            record.cost_per_piece = unit_cost
            record.total_cost = total_stage_cost
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
            'cost_per_piece': unit_cost,
            'total_cost': total_stage_cost,
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
