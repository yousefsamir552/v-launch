import os
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from django.db import IntegrityError, transaction
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

QC_STAGE_TO_REQUIRED_PART_STAGE = {
    'before_print': 'qc_before_print',
    'after_print': 'qc_after_print',
    'after_sewing': 'qc_after_sewing',
}
QC_STAGE_ARABIC_LABELS = {
    'before_print': 'العد قبل الطباعة',
    'after_print': 'العد بعد الطباعة',
    'after_sewing': 'العد بعد المكن',
}


def validate_qc_stage_progression(model, stage, parts):
    """يتحقق من أن القطع وصلت فعلياً إلى مرحلة الفرز المطلوبة (يمنع القفز من القص للتشطيب/المكن)."""
    if stage not in QC_STAGE_TO_REQUIRED_PART_STAGE:
        raise ValueError('مرحلة الفرز غير معروفة')
    if (model.status or '') in DESIGN_STAGES:
        raise ValueError('لا يمكن تسجيل الفرز لموديل ما زال في مرحلة التصميم')
    seed_part_stages_from_status(model)
    stages = get_part_stages(model)
    required_stage = QC_STAGE_TO_REQUIRED_PART_STAGE[stage]
    required_idx = _stage_index(required_stage)
    stage_label = QC_STAGE_ARABIC_LABELS.get(stage, stage)
    not_ready = []
    for raw_part in (parts or ['shirt']):
        part = normalize_part_key(raw_part)
        cur = stages.get(part, 'cutting')
        if _stage_index(cur) < required_idx:
            not_ready.append(f"{PART_LABELS.get(part, part)} ({PART_STAGE_LABELS.get(cur, cur)})")
    if not_ready:
        raise ValueError(
            f"لا يمكن تسجيل ({stage_label}) قبل وصول القطع إلى المرحلة المطلوبة: {' / '.join(not_ready)}"
        )


def parse_qc_nonneg_int(value, field_label='الكمية', default=0):
    """يحول مدخل كمية الفرز إلى عدد صحيح غير سالب أو يرفع ValueError برسالة عربية واضحة."""
    if value is None:
        return default
    if isinstance(value, bool):
        raise ValueError(f'{field_label} يجب أن تكون رقماً صحيحاً غير سالب')
    if isinstance(value, int):
        if value < 0:
            raise ValueError(f'{field_label} لا يمكن أن تكون سالبة')
        return value
    raw = str(value).strip()
    if raw == '':
        return default
    try:
        dec = Decimal(raw)
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError(f'{field_label} غير صالحة: "{raw}"')
    if not dec.is_finite() or dec < 0 or dec != dec.to_integral_value():
        raise ValueError(f'{field_label} يجب أن تكون رقماً صحيحاً غير سالب')
    return int(dec)


def upsert_qc_record(
    model,
    *,
    stage,
    part_type,
    color_name,
    size,
    pieces_cut,
    good_qty,
    defect_qty,
    notes='',
    can_write_notes=True,
    checked_by='مراقب الجودة',
    created_at_str='',
    client_id=None,
):
    """حفظ/تحديث ذرّي آمن لخلية QCRecord يحترم قيد التفرد uniq_qc_record_cell ويزيل أي تكرار قديم."""
    clean_stage = str(stage or 'before_print').strip()
    if clean_stage not in QC_STAGE_TO_REQUIRED_PART_STAGE:
        raise ValueError('مرحلة الفرز غير معروفة')

    clean_part = normalize_part_key(part_type or 'shirt')
    clean_color = str(color_name or '').strip()[:150]
    clean_size = str(size or '').strip()[:50]
    clean_checker = (str(checked_by or '').strip() or 'مراقب الجودة')[:150]
    clean_ts = (str(created_at_str or '').strip() or timezone.now().strftime('%Y-%m-%d %H:%M'))[:100]
    clean_notes = str(notes or '').strip()
    clean_cut = max(0, int(pieces_cut or 0))
    clean_good = max(0, int(good_qty or 0))
    clean_defect = max(0, int(defect_qty or 0))

    lookup = {
        'model': model,
        'stage': clean_stage,
        'part_type': clean_part,
        'color_name': clean_color,
        'size': clean_size,
    }

    matches = list(QCRecord.objects.select_for_update().filter(**lookup).order_by('id'))
    if matches:
        rec = matches[0]
        if len(matches) > 1:
            extra_ids = [dup.pk for dup in matches[1:]]
            QCRecord.objects.filter(pk__in=extra_ids).delete()
        rec.pieces_cut = clean_cut
        rec.counted_pieces = clean_good
        rec.defect_pieces = clean_defect
        if can_write_notes:
            rec.notes = clean_notes
        rec.checked_by = clean_checker
        rec.created_at_str = clean_ts
        rec.save()
        return rec

    clean_client_id = str(client_id).strip()[:100] if client_id else None
    if clean_client_id == '':
        clean_client_id = None

    try:
        with transaction.atomic():
            return QCRecord.objects.create(
                client_id=clean_client_id,
                model=model,
                stage=clean_stage,
                part_type=clean_part,
                color_name=clean_color,
                size=clean_size,
                pieces_cut=clean_cut,
                counted_pieces=clean_good,
                defect_pieces=clean_defect,
                notes=clean_notes if can_write_notes else '',
                checked_by=clean_checker,
                created_at_str=clean_ts,
            )
    except IntegrityError:
        # في حال تزامن طلبين على نفس الخلية في نفس اللحظة: نحدّث السجل الفائز بدلاً من رمي 500.
        rec = QCRecord.objects.select_for_update().filter(**lookup).order_by('id').first()
        if rec is None:
            raise
        rec.pieces_cut = clean_cut
        rec.counted_pieces = clean_good
        rec.defect_pieces = clean_defect
        if can_write_notes:
            rec.notes = clean_notes
        rec.checked_by = clean_checker
        rec.created_at_str = clean_ts
        rec.save()
        return rec


def _append_receive_note(existing_notes, clean_notes):
    """يلحق ملاحظة الاستلام دون تكرارها إن كانت مسجلة بالفعل."""
    if not clean_notes:
        return existing_notes
    base = (existing_notes or '').strip()
    marker = f"استلام: {clean_notes}"
    if not base:
        return marker
    if base == clean_notes or base.endswith(marker) or f"| {marker}" in base:
        return base
    return f"{base} | {marker}"


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
    unit_cost, _ = resolve_cost_values(cost_per_piece, None, pieces_count=0)
    # القاعدة المحاسبية المؤكدة: تكلفة تشغيل المكن تُحسب دائماً على القطع المستلمة فعلياً
    # (وعند الإرسال يكون المستلم 0، وتُحدَّث تلقائياً عند كل دفعة استلام).
    total_work_cost = 0.0

    with transaction.atomic():
        model = ModelItem.objects.select_for_update().get(pk=model.pk)
        if (model.status or '').strip() in ('مرحلة التصميم', 'تصميم'):
            raise ValueError(
                'لا يمكن إرسال الموديل لورشة المكن وهو لا يزال في مرحلة التصميم؛ يجب صرف القماش والقص أولاً.'
            )
        part_cut = 0
        if piece_type in ('shirt', 'pants', 'jacket'):
            part_cut = int(getattr(model, f'cut_{piece_type}_pieces', 0) or 0)
        if part_cut <= 0:
            part_cut = int(model.total_cut_pieces or 0)
        if part_cut <= 0:
            raise ValueError('لا يمكن إرسال الموديل لورشة المكن قبل تسجيل كميات القص الفعلية.')
        from django.db.models import Sum as _Sum
        already_sent = int(
            SewingDispatch.objects.filter(model=model, piece_type=piece_type)
            .aggregate(total=_Sum('pieces_count'))['total'] or 0
        )
        if already_sent + int(pieces_count) > part_cut:
            remaining_allowed = max(0, part_cut - already_sent)
            raise ValueError(
                f'إجمالي القطع المرسلة للمكن ({already_sent + int(pieces_count)}) يتجاوز الكمية المقصوصة ({part_cut})؛ '
                f'المتاح للإرسال حالياً: {remaining_allowed} قطعة.'
            )
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


def receive_model_from_sewing_service(
    dispatch_id,
    user_name='مراقب الجودة',
    notes='',
    received_qty=None,
    quick_receive=False,
):
    """
    Receives model from sewing workshop and routes it to QC (العد بعد المكن) once complete.

    - When ``quick_receive=True``: records receipt date/timestamp immediately without
      requiring piece count entry at receipt time (marks the dispatch received and moves
      the part to ``qc_after_sewing`` so counting & workshop evaluation happen in QC).
    - Otherwise supports partial receipt on several batches: requires an explicit
      positive ``received_qty`` (0 < received_qty <= remaining), recalculates
      ``total_cost = round(received_pieces * cost_per_piece, 2)``, and keeps the
      part in ``sewing`` until ``received_pieces >= pieces_count``.
    """
    target = resolve_by_id(SewingDispatch, dispatch_id)
    if not target:
        raise ValueError("إرسالية الخياطة غير موجودة")
    now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
    clean_notes = (notes or '').strip()

    with transaction.atomic():
        dispatch = SewingDispatch.objects.select_for_update().select_related('model').get(pk=target.pk)
        model = ModelItem.objects.select_for_update().get(pk=dispatch.model_id)

        total_pieces = int(dispatch.pieces_count or 0)
        already_received = int(dispatch.received_pieces or 0)
        remaining_before = max(0, total_pieces - already_received)

        if quick_receive:
            if dispatch.status == 'تم الاستلام' and remaining_before <= 0:
                raise ValueError('تم استلام هذه التشغيلة مسبقاً')
            batch_qty = remaining_before
        else:
            if remaining_before <= 0:
                raise ValueError('تم استلام كامل كمية هذه التشغيلة مسبقاً')

            if received_qty in (None, ''):
                raise ValueError('يجب تحديد عدد القطع المستلمة صراحةً (أكبر من صفر)')
            try:
                requested_qty = int(received_qty)
            except (TypeError, ValueError):
                raise ValueError('عدد القطع المستلمة يجب أن يكون رقماً صحيحاً موجباً')

            if requested_qty <= 0:
                raise ValueError('عدد القطع المستلمة يجب أن يكون أكبر من صفر')
            if requested_qty > remaining_before:
                raise ValueError(
                    f'لا يمكن استلام ({requested_qty}) قطعة — المتبقي بالورشة ({remaining_before}) قطعة فقط'
                )

            batch_qty = requested_qty

        dispatch.received_pieces = already_received + batch_qty
        dispatch.total_cost = round(
            float(dispatch.cost_per_piece or 0) * int(dispatch.received_pieces or 0), 2
        )
        history = list(dispatch.receive_history) if isinstance(dispatch.receive_history, list) else []
        history_entry = {
            'date': now_str,
            'qty': batch_qty,
            'total_received': dispatch.received_pieces,
            'user': user_name,
            'notes': clean_notes,
        }
        if quick_receive:
            history_entry['quick_receive'] = True
        history.append(history_entry)
        dispatch.receive_history = history
        is_complete = quick_receive or (dispatch.received_pieces >= total_pieces)
        dispatch.status = 'تم الاستلام' if is_complete else 'استلام جزئي'
        dispatch.received_date = date.today()
        dispatch.received_at_str = now_str
        if clean_notes:
            dispatch.notes = _append_receive_note(dispatch.notes, clean_notes)
        dispatch.save()

        if is_complete:
            other_pending_same_part = SewingDispatch.objects.filter(
                model=model,
                piece_type=dispatch.piece_type or 'shirt',
            ).exclude(id=dispatch.id).exclude(status='تم الاستلام').exists()
            if not other_pending_same_part:
                if dispatch.piece_type == 'shirt':
                    model.sewing_shirt_status = 'تم الاستلام'
                elif dispatch.piece_type == 'pants':
                    model.sewing_pants_status = 'تم الاستلام'
                # لا نُرقّي القطعة إلى «العد بعد المكن» إلا عند اكتمال استلام كل إرساليات هذه القطعة.
                advance_parts_to_stage(model, 'qc_after_sewing', [dispatch.piece_type or 'shirt'])
                derive_pipeline_status(model)

        other_pending = SewingDispatch.objects.filter(model=model).exclude(id=dispatch.id).exclude(status='تم الاستلام').exists()
        all_done = not other_pending and is_complete

        model._skip_timeline_signal = True
        model.save()

        label = dispatch.piece_label or PART_LABELS.get(dispatch.piece_type, 'قطعة')
        if quick_receive:
            tl_notes = (
                f"تم تسجيل استلام [{label}] من ورشة {dispatch.workshop_name} بتاريخ {now_str} "
                f"(بانتظار العد الفعلي وتقييم الورشة في الفرز بعد المكن)"
            )
        else:
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
                'cost_per_piece': float(dispatch.cost_per_piece or 0),
                'total_cost': float(dispatch.total_cost or 0),
                'worker_notes': clean_notes,
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
        int(getattr(model, 'total_cut_pieces', 0) or 0)
        or int(getattr(model, 'target_cut_quantity', 0) or 0)
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

    with transaction.atomic():
        model = ModelItem.objects.select_for_update().get(pk=model.pk)
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
        not_ready_for_finishing = [
            part for part in part_keys
            if _stage_index(current_stages.get(part, 'cutting')) < _stage_index('qc_after_sewing')
        ]
        if not_ready_for_finishing:
            labels = ' / '.join(PART_LABELS.get(part, part) for part in not_ready_for_finishing)
            raise ValueError(
                f"لا يمكن بدء التشطيب قبل وصول القطع ({labels}) إلى مرحلة ما بعد المكن"
            )
        part_keys = [
            part for part in part_keys
            if _stage_index(current_stages.get(part, 'cutting')) <= _stage_index('finishing')
        ]
        if not part_keys:
            raise ValueError('القطع المحددة تجاوزت مرحلة التشطيب بالفعل')

        records = []
        part_totals = []
        stages = get_part_stages(model)
        # عند إدخال إجمالي ثابت بدون سعر قطعة لعدة أجزاء، نوزّعه على الأجزاء بالتساوي بدلاً من تكراره.
        split_explicit_total = (
            round(float(total_finish_cost) / len(part_keys), 2)
            if (unit_cost == 0 and total_finish_cost > 0 and len(part_keys) > 1)
            else total_cost
        )
        for part in part_keys:
            part_pieces = _model_part_pieces(model, part)
            part_unit_cost, part_total_cost = resolve_cost_values(
                cost_per_piece, split_explicit_total, pieces_count=part_pieces
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

        # دائماً نحسب الإجمالي من مجموع تكلفة قطع كل الأجزاء على الباك إند (ولا يُصفّر بصفر من الواجهة).
        if total_cost in (None, '', 0, '0', 0.0) or unit_cost > 0:
            total_finish_cost = round(sum(part_totals), 2)

        model.part_stages = stages
        model._skip_timeline_signal = True
        model.save()
        sync_model_status_from_part_stages(model)

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
    target = resolve_by_id(FinishingRecord, record_id)
    if not target:
        raise ValueError('سجل التشطيب غير موجود')

    actual = _parse_date_value(actual_exit_date) or date.today()
    clean_notes = (notes or '').strip()
    with transaction.atomic():
        record = FinishingRecord.objects.select_for_update().select_related('model').get(pk=target.pk)
        if record.actual_exit_date is not None:
            return record
        model = ModelItem.objects.select_for_update().get(pk=record.model_id)
        record.actual_exit_date = actual
        if clean_notes:
            record.notes = _append_receive_note(record.notes, clean_notes)
        record.save()

        # Move only this part to ironing; the model status follows the least advanced part.
        ensure_part_stages(model)
        sync_model_status_from_part_stages(model)
        all_received = not FinishingRecord.objects.filter(
            model=model, actual_exit_date__isnull=True
        ).exists()

        now_str = timezone.now().strftime('%Y-%m-%d %H:%M')
        label = record.piece_label or PART_LABELS.get(record.part_type, 'قطعة')
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

    with transaction.atomic():
        model = ModelItem.objects.select_for_update().get(pk=model.pk)
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
        split_explicit_total = (
            round(float(total_iron_cost) / len(requested), 2)
            if (unit_cost == 0 and total_iron_cost > 0 and len(requested) > 1)
            else total_cost
        )
        for part in requested:
            part_pieces = _model_part_pieces(model, part)
            part_unit_cost, part_total_cost = resolve_cost_values(
                cost_per_piece, split_explicit_total, pieces_count=part_pieces
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

        # دائماً نحسب الإجمالي من مجموع تكلفة قطع كل الأجزاء على الباك إند (ولا يُصفّر بصفر من الواجهة).
        if total_cost in (None, '', 0, '0', 0.0) or unit_cost > 0:
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
    target = resolve_by_id(AssemblyStageRecord, record_id)
    if not target or target.stage != 'ironing':
        raise ValueError('سجل المكواة غير موجود')

    actual = _parse_date_value(actual_exit_date) or date.today()
    clean_notes = (notes or '').strip()
    with transaction.atomic():
        record = AssemblyStageRecord.objects.select_for_update().select_related('model').get(pk=target.pk)
        if record.actual_exit_date is not None:
            return record
        model = ModelItem.objects.select_for_update().get(pk=record.model_id)
        record.actual_exit_date = actual
        if clean_notes:
            record.notes = _append_receive_note(record.notes, clean_notes)
        record.save()

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


class PackagingStockShortageError(ValueError):
    """خطأ يُرفع عند عدم كفاية رصيد خامات التغليف لدخول مرحلة التعبئة والتغليف."""
    def __init__(self, message, shortages=None):
        super().__init__(message)
        self.shortages = shortages or []


def _model_sets_count(model) -> int:
    """عدد الأطقم الفعلي للموديل (للتعبئة والتغليف والدَست)."""
    summary_info = model_part_summary(model)
    return (
        int(summary_info.get('finished_good_sets') or 0)
        or int(summary_info.get('completed_sets') or 0)
        or int(getattr(model, 'total_cut_pieces', 0) or 0)
        or int(getattr(model, 'target_cut_quantity', 0) or 0)
        or 0
    )


def _model_size_group_keys(model) -> set:
    """كل المفاتيح الممكنة لفئة مقاس الموديل (client_id و pk) لضمان التطابق الدقيق."""
    raw = str(getattr(model, 'size_category_id', '') or '').strip()
    keys = set()
    if not raw:
        return keys
    keys.add(raw)
    size_obj = resolve_by_id(SizeDef, raw)
    if size_obj is not None:
        keys.add(str(size_obj.pk))
        if size_obj.client_id:
            keys.add(str(size_obj.client_id))
    return keys


def calculate_model_packaging_materials(model, sets_count=None):
    """
    يحسب خامات التعبئة والتغليف المطلوبة لموديل محدد بناءً على فئة مقاساته
    والقواعد المفعّلة (PackagingMaterialRule / PackagingMaterialSizeRule) وعدد الأطقم الفعلي.
    """
    qty_sets = _model_sets_count(model) if sets_count is None else max(0, int(sets_count or 0))
    if qty_sets <= 0:
        return []

    size_keys = _model_size_group_keys(model)
    requirements = []

    rules = (
        PackagingMaterialRule.objects.filter(is_active=True)
        .prefetch_related('size_rules')
        .order_by('id')
    )
    for rule in rules:
        size_rules = list(rule.size_rules.all())
        if not size_rules:
            continue

        applicable_groups = [
            str(g).strip()
            for g in (rule.applicable_size_groups if isinstance(rule.applicable_size_groups, list) else [])
            if str(g).strip()
        ]
        # نطابق أولاً صف المقاس المخصص لفئة مقاس الموديل، وإلا الصف العام (size_group_id='').
        matched_rows = [
            row for row in size_rules
            if (row.size_group_id or '').strip() and (row.size_group_id or '').strip() in size_keys
        ]
        if not matched_rows:
            general_rows = [row for row in size_rules if not (row.size_group_id or '').strip()]
            if general_rows:
                if not applicable_groups or (size_keys and any(k in applicable_groups for k in size_keys)):
                    matched_rows = general_rows

        for row in matched_rows:
            consumption = float(row.consumption_per_piece or 0)
            if consumption <= 0:
                continue
            required_qty = round(qty_sets * consumption, 3)
            if required_qty <= 0:
                continue
            requirements.append({
                'size_rule': row,
                'size_rule_pk': row.pk,
                'rule': rule,
                'material_name': rule.label,
                'unit': rule.unit or 'قطعة',
                'size_group_name': row.size_group_name or 'كل المقاسات',
                'dimensions_spec': row.dimensions_spec or '',
                'consumption_per_piece': consumption,
                'sets_count': qty_sets,
                'required': required_qty,
            })

    return requirements


def _validate_and_deduct_packaging_materials(model, sets_count, now_str):
    """
    داخل transaction.atomic(): يقفل صفوف أرصدة خامات التغليف المطلوبة بـ select_for_update()،
    يرفض العملية بخطأ عربي تفصيلي عند وجود أي عجز، وإلا يخصم تلقائياً ويسجّل الحركات.
    """
    required_items = calculate_model_packaging_materials(model, sets_count=sets_count)
    if not required_items:
        return []

    pks = sorted({item['size_rule_pk'] for item in required_items})
    locked_map = {
        sr.pk: sr
        for sr in PackagingMaterialSizeRule.objects.select_for_update()
        .select_related('rule')
        .filter(pk__in=pks)
        .order_by('pk')
    }

    # تجميع المطلوب لكل صف (تحسباً لتكرار صف واحد)
    total_needed_by_pk = {}
    meta_by_pk = {}
    for item in required_items:
        pk = item['size_rule_pk']
        total_needed_by_pk[pk] = round(total_needed_by_pk.get(pk, 0.0) + item['required'], 3)
        meta_by_pk[pk] = item

    shortages = []
    for pk in pks:
        sr = locked_map.get(pk)
        if sr is None:
            continue
        meta = meta_by_pk[pk]
        required = total_needed_by_pk[pk]
        available = round(float(sr.current_stock or 0), 3)
        if available + 1e-6 < required:
            shortage_val = round(max(0.0, required - available), 3)
            shortages.append({
                'size_rule_id': sr.client_id or str(sr.pk),
                'material_name': meta['material_name'],
                'size_group_name': meta['size_group_name'],
                'dimensions_spec': meta['dimensions_spec'],
                'unit': meta['unit'],
                'required': required,
                'available': available,
                'shortage': shortage_val,
            })

    if shortages:
        lines = [
            (
                f"• {s['material_name']}"
                + (f" ({s['size_group_name']})" if s['size_group_name'] else '')
                + f": المطلوب {s['required']:g} {s['unit']} — المتاح {s['available']:g} {s['unit']}"
                + f" — العجز {s['shortage']:g} {s['unit']}"
            )
            for s in shortages
        ]
        message = (
            f"لا يمكن إدخال الموديل ({model.model_code}) لمرحلة التعبئة والتغليف بسبب نقص رصيد خامات التغليف:\n"
            + "\n".join(lines)
        )
        raise PackagingStockShortageError(message, shortages=shortages)

    deducted_details = []
    for pk in pks:
        sr = locked_map.get(pk)
        if sr is None:
            continue
        meta = meta_by_pk[pk]
        required = total_needed_by_pk[pk]
        old_stock = round(float(sr.current_stock or 0), 3)
        new_stock = round(max(0.0, old_stock - required), 3)
        sr.current_stock = new_stock
        sr.save(update_fields=['current_stock', 'updated_at'])

        PackagingMaterialTransaction.objects.create(
            size_rule=sr,
            operation='deduct',
            amount=required,
            price_per_unit=sr.price_per_unit or 0,
            model=model,
            model_code_ref=model.model_code,
            notes=(
                f"خصم تلقائي عند دخول التعبئة والتغليف — موديل {model.model_code} "
                f"({sets_count} طقم × {meta['consumption_per_piece']:g})"
            ),
            timestamp=now_str,
        )
        deducted_details.append({
            'size_rule_id': sr.client_id or str(sr.pk),
            'material_name': meta['material_name'],
            'size_group_name': meta['size_group_name'],
            'dimensions_spec': meta['dimensions_spec'],
            'unit': meta['unit'],
            'amount': required,
            'old_stock': old_stock,
            'new_stock': new_stock,
        })

    return deducted_details


def start_assembly_stage_service(model, stage, entry_date=None, expected_exit_date=None,
                                 notes=None, vendor_name=None, part_type=None,
                                 user_name='مسؤول الأسمبلي', cost_per_piece=0.0, total_cost=None,
                                 workshop=None, completed_pieces=None, expected_pieces=None):
    """
    Starts (or updates) one assembly stage (ironing / packaging / dest).

    * ironing   → delegates to start_ironing_service (tracked per garment part).
    * packaging → model-level, allowed only once every part reached packaging.
                  Enforces strict packaging-material stock gate and auto-deducts
                  required materials once (guarded by ``materials_deducted``).
    * dest      → model-level, gated by the packaging requirements.
                  Tracks expected_pieces vs completed_pieces and auto-computes shortage.
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
        ensure_part_stages(model)
        current_stages = get_part_stages(model)
        waiting_dest = [
            PART_LABELS.get(part, part)
            for part, st in current_stages.items()
            if _stage_index(st) < _stage_index('dest')
        ]
        if waiting_dest:
            raise ValueError(
                f"لا يمكن بدء الدَست قبل اكتمال التعبئة والتغليف لجميع القطع. في الانتظار: {' / '.join(waiting_dest)}"
            )
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

    parsed_completed = None
    if completed_pieces not in (None, ''):
        try:
            parsed_completed = max(0, int(float(completed_pieces)))
        except (TypeError, ValueError):
            raise ValueError('العدد المنفذ فعلياً يجب أن يكون رقماً صحيحاً غير سالب')

    parsed_expected_override = None
    if expected_pieces not in (None, ''):
        try:
            parsed_expected_override = max(0, int(float(expected_pieces)))
        except (TypeError, ValueError):
            parsed_expected_override = None

    # اربط الورشة المسجلة بالاسم إن لم تُمرَّر صريحاً، مع الإبقاء على الاسم النصي كما هو.
    if workshop is None and clean_vendor:
        workshop = Workshop.objects.filter(name__iexact=clean_vendor).first()

    deducted_now = []
    with transaction.atomic():
        model = ModelItem.objects.select_for_update().get(pk=model.pk)
        stage_pieces = _model_sets_count(model)
        unit_cost, total_stage_cost = resolve_cost_values(
            cost_per_piece, total_cost, pieces_count=stage_pieces
        )

        record = (
            AssemblyStageRecord.objects.select_for_update()
            .filter(model=model, stage=stage, part_type='')
            .first()
        )
        created = record is None

        # بوابة فحص وخصم خامات التعبئة والتغليف تلقائياً (مرة واحدة فقط لمنع الخصم المزدوج).
        if stage == 'packaging' and (created or not record.materials_deducted):
            deducted_now = _validate_and_deduct_packaging_materials(
                model, sets_count=stage_pieces, now_str=now_str
            )

        if created:
            dest_expected = (
                parsed_expected_override
                if parsed_expected_override is not None
                else (stage_pieces if stage == 'dest' else 0)
            )
            record = AssemblyStageRecord.objects.create(
                model=model,
                stage=stage,
                part_type='',
                entry_date=entry,
                expected_exit_date=expected,
                vendor_name=clean_vendor,
                workshop=workshop,
                notes=clean_notes or None,
                cost_per_piece=unit_cost,
                total_cost=total_stage_cost,
                materials_deducted=(stage == 'packaging'),
                materials_deducted_details=deducted_now if stage == 'packaging' else [],
                expected_pieces=dest_expected if stage == 'dest' else 0,
                completed_pieces=parsed_completed if stage == 'dest' else None,
            )
        else:
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
            if stage == 'packaging' and not record.materials_deducted:
                record.materials_deducted = True
                record.materials_deducted_details = deducted_now
            if stage == 'dest':
                if parsed_expected_override is not None:
                    record.expected_pieces = parsed_expected_override
                elif not record.expected_pieces:
                    record.expected_pieces = stage_pieces
                if parsed_completed is not None:
                    record.completed_pieces = parsed_completed
            record.save()

        ensure_part_stages(model)
        sync_model_status_from_part_stages(model)

        label = ASSEMBLY_STAGE_LABELS.get(stage, stage)
        tl_notes = f"تم تسجيل دخول الموديل إلى {label} بتاريخ {entry.isoformat()}"
        if clean_vendor:
            tl_notes += f" | الجهة: {clean_vendor}"
        if expected:
            tl_notes += f" - الخروج المتوقع: {expected.isoformat()}"
        if stage == 'packaging' and deducted_now:
            deducted_summary = '، '.join(
                f"{item['material_name']} ({item['amount']:g} {item['unit']})"
                for item in deducted_now
            )
            tl_notes += f" | خصم خامات التغليف تلقائياً: {deducted_summary}"
        if stage == 'dest' and record.completed_pieces is not None:
            tl_notes += (
                f" | المتوقع: {record.expected_pieces} — المنفذ: {record.completed_pieces}"
                f" — العجز: {record.shortage_pieces}"
            )
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
                'materials_deducted': bool(record.materials_deducted),
                'materials_deducted_details': deducted_now,
                'expected_pieces': int(record.expected_pieces or 0),
                'completed_pieces': record.completed_pieces,
                'shortage_pieces': int(record.shortage_pieces or 0),
            },
        )
    # نُرفق الخامات التي خُصمت في هذه العملية فقط لتسجيلها في AuditLog من الـ View.
    record._deducted_now = deducted_now
    return record


def receive_assembly_stage_service(record_id, actual_exit_date=None, notes=None,
                                   user_name='مسؤول الأسمبلي', completed_pieces=None):
    """
    Completes an assembly stage record and promotes the model to the next stage
    (dest → مخزن الإنتاج التام).
    """
    target = resolve_by_id(AssemblyStageRecord, record_id)
    if not target:
        raise ValueError('سجل مرحلة الأسمبلي غير موجود')

    actual = _parse_date_value(actual_exit_date) or date.today()
    clean_notes = (notes or '').strip()

    parsed_completed = None
    if completed_pieces not in (None, ''):
        try:
            parsed_completed = max(0, int(float(completed_pieces)))
        except (TypeError, ValueError):
            raise ValueError('العدد المنفذ فعلياً يجب أن يكون رقماً صحيحاً غير سالب')

    with transaction.atomic():
        record = AssemblyStageRecord.objects.select_for_update().select_related('model').get(pk=target.pk)
        if record.actual_exit_date is not None:
            return record
        model = ModelItem.objects.select_for_update().get(pk=record.model_id)

        record.actual_exit_date = actual
        if clean_notes:
            record.notes = _append_receive_note(record.notes, clean_notes)

        if record.stage == 'dest':
            if not record.expected_pieces:
                record.expected_pieces = _model_sets_count(model)
            if parsed_completed is not None:
                record.completed_pieces = parsed_completed
            elif record.completed_pieces is None:
                record.completed_pieces = int(record.expected_pieces or 0)
            if float(record.cost_per_piece or 0) > 0 and record.completed_pieces is not None:
                record.total_cost = round(float(record.cost_per_piece) * int(record.completed_pieces), 2)
        record.save()

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
        if record.stage == 'dest':
            tl_notes += (
                f" | المتوقع: {record.expected_pieces} — المنفذ فعلياً: {record.completed_pieces}"
                f" — العجز: {record.shortage_pieces}"
            )
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
                'expected_pieces': int(record.expected_pieces or 0),
                'completed_pieces': record.completed_pieces,
                'shortage_pieces': int(record.shortage_pieces or 0),
                'next_status': next_status or '',
                'worker_notes': clean_notes,
                'operator_name': user_name,
            },
        )
    return record
