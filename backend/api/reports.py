import re
from collections import defaultdict
from datetime import datetime, date, timedelta
from django.db.models import Sum
from django.db.models.functions import TruncDate, TruncWeek, TruncMonth
from django.utils import timezone
from .models import (
    CuttingRecord,
    PrintDispatch,
    QCRecord,
    SewingDispatch,
    ModelItem,
    ModelTimeline,
    SizeDef,
    FinishingRecord,
    AssemblyStageRecord,
    GlobalSettings,
    PART_TYPE_CHOICES,
    COMPOSITION_TO_PARTS,
    GARMENT_COMPOSITION_CHOICES,
)

def format_arabic_period_label(dt, period_type):
    """
    Formats a datetime or date into a user-friendly Arabic date/week/month string.
    """
    if not dt:
        return 'غير محدد'
    
    if isinstance(dt, datetime):
        d = dt.date()
    else:
        d = dt

    arabic_months = [
        'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
        'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
    ]
    arabic_days = [
        'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'
    ]

    month_name = arabic_months[d.month - 1]
    day_name = arabic_days[d.weekday()]

    if period_type == 'daily':
        return f"{day_name}، {d.day} {month_name} {d.year}"
    elif period_type == 'weekly':
        week_num = d.isocalendar()[1]
        week_end = d + timedelta(days=6)
        end_month = arabic_months[week_end.month - 1]
        return f"الأسبوع {week_num} ({d.day} {month_name} — {week_end.day} {end_month} {week_end.year})"
    elif period_type == 'monthly':
        return f"{month_name} {d.year}"
    
    return str(d)


def _record_date(value):
    """Returns the (local) date of a datetime/date value, or None."""
    if value is None:
        return None
    if isinstance(value, datetime):
        if timezone.is_aware(value):
            value = timezone.localtime(value)
        return value.date()
    return value


def _record_bucket_date(value, period):
    """Buckets a datetime/date in Python exactly like TruncDate/Week/Month.

    daily   → the day itself
    weekly  → Monday of that ISO week
    monthly → first day of that month
    """
    d = _record_date(value)
    if d is None:
        return None
    if period == 'weekly':
        return d - timedelta(days=d.weekday())
    if period == 'monthly':
        return d.replace(day=1)
    return d


def get_production_report(section='cutting', period='daily', date_from=None, date_to=None):
    """
    Generates dynamic aggregated analytics report for:
    - section: 'cutting' | 'printing' | 'qc' | 'sewing'
    - period: 'daily' | 'weekly' | 'monthly'
    - date_from, date_to: optional ISO date strings (YYYY-MM-DD)
    """
    results = []
    summary = {
        'total_pieces': 0,
        'total_models': 0,
        'total_operations': 0,
        'avg_pieces_per_period': 0,
        'section_name': '',
        'period_name': 'يومي' if period == 'daily' else ('أسبوعي' if period == 'weekly' else 'شهري')
    }

    # 1. CUTTING REPORT (تقرير قسم القص)
    if section == 'cutting':
        summary['section_name'] = 'تقرير قسم القص وخطوط الفرش'
        qs = CuttingRecord.objects.select_related('model').prefetch_related('color_layers')

        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)

        # استعلام واحد فقط: نجلب كل السجلات المفلترة بالتاريخ ثم نجمّعها في الذاكرة
        # بدلاً من تنفيذ filter/values_list/count لكل فترة زمنية على حدة.
        buckets = defaultdict(lambda: {
            'records': [], 'total_pieces': 0, 'total_layers': 0,
            'model_codes': [], 'cutters': [], 'spreaders': [],
        })
        for rec in qs:
            bucket_date = _record_bucket_date(rec.created_at, period)
            if bucket_date is None:
                continue
            bucket = buckets[bucket_date]
            bucket['records'].append(rec)
            bucket['total_pieces'] += int(rec.pieces_count or 0)
            bucket['total_layers'] += int(rec.layers_count or 0)
            model_code = rec.model.model_code if rec.model else ''
            if model_code and model_code not in bucket['model_codes']:
                bucket['model_codes'].append(model_code)
            if rec.cutter_name and rec.cutter_name not in bucket['cutters']:
                bucket['cutters'].append(rec.cutter_name)
            if rec.spreader_name and rec.spreader_name not in bucket['spreaders']:
                bucket['spreaders'].append(rec.spreader_name)

        all_models_set = set()

        for bucket_date in sorted(buckets.keys(), reverse=True):
            bucket = buckets[bucket_date]
            model_codes = bucket['model_codes']
            operators = list(dict.fromkeys(bucket['cutters'] + bucket['spreaders']))
            all_models_set.update(model_codes)
            total_pcs = bucket['total_pieces']
            ops_count = len(bucket['records'])

            results.append({
                'period_key': bucket_date.isoformat(),
                'period_label': format_arabic_period_label(bucket_date, period),
                'models_count': len(model_codes),
                'model_codes': model_codes,
                'total_pieces': total_pcs,
                'secondary_metric_label': 'عدد الراقات بالفرشات',
                'secondary_metric_value': bucket['total_layers'],
                'operations_count': ops_count,
                'operators_list': operators,
                'details_list': [
                    {
                        'id': rec.id,
                        'model_code': rec.model.model_code,
                        'spread_number': rec.spread_number,
                        'spreader': rec.spreader_name,
                        'color': rec.fabric_color,
                        'cutter': rec.cutter_name,
                        'pieces': rec.pieces_count,
                        'layers': rec.layers_count,
                        'notes': rec.notes or '',
                        'time': rec.created_at.strftime('%H:%M') if rec.created_at else ''
                    }
                    for rec in bucket['records'][:30]
                ]
            })

            summary['total_pieces'] += total_pcs
            summary['total_operations'] += ops_count

        summary['total_models'] = len(all_models_set)

    # 2. PRINTING REPORT (تقرير المطابع والتطريز)
    elif section == 'printing':
        summary['section_name'] = 'تقرير المطابع والتطريز'
        qs = PrintDispatch.objects.select_related('model')

        if date_from:
            qs = qs.filter(dispatch_date__gte=date_from)
        if date_to:
            qs = qs.filter(dispatch_date__lte=date_to)

        # استعلام واحد فقط ثم تجميع كامل في الذاكرة.
        buckets = defaultdict(lambda: {
            'records': [], 'total_pieces': 0, 'model_codes': [],
            'shops': [], 'received_count': 0,
        })
        for rec in qs:
            bucket_date = _record_bucket_date(rec.dispatch_date, period)
            if bucket_date is None:
                continue
            bucket = buckets[bucket_date]
            bucket['records'].append(rec)
            bucket['total_pieces'] += int(rec.pieces_count or 0)
            if rec.status == 'تم الاستلام':
                bucket['received_count'] += 1
            model_code = rec.model.model_code if rec.model else ''
            if model_code and model_code not in bucket['model_codes']:
                bucket['model_codes'].append(model_code)
            if rec.print_house and rec.print_house not in bucket['shops']:
                bucket['shops'].append(rec.print_house)

        all_models_set = set()

        for bucket_date in sorted(buckets.keys(), reverse=True):
            bucket = buckets[bucket_date]
            model_codes = bucket['model_codes']
            ops_count = len(bucket['records'])
            total_pcs = bucket['total_pieces']

            all_models_set.update(model_codes)

            results.append({
                'period_key': bucket_date.isoformat(),
                'period_label': format_arabic_period_label(bucket_date, period),
                'models_count': len(model_codes),
                'model_codes': model_codes,
                'total_pieces': total_pcs,
                'secondary_metric_label': 'تم استلامها',
                'secondary_metric_value': f"{bucket['received_count']} من {ops_count}",
                'operations_count': ops_count,
                'operators_list': bucket['shops'],
                'details_list': [
                    {
                        'id': rec.id,
                        'model_code': rec.model.model_code,
                        'print_house': rec.print_house,
                        'print_type': rec.print_type,
                        'pieces': rec.pieces_count,
                        'expected_date': str(rec.expected_delivery_date) if rec.expected_delivery_date else '',
                        'status': rec.status,
                        'notes': rec.notes or ''
                    }
                    for rec in bucket['records'][:30]
                ]
            })

            summary['total_pieces'] += total_pcs
            summary['total_operations'] += ops_count

        summary['total_models'] = len(all_models_set)

    # 3. QC REPORT (تقرير الفرز والجودة)
    elif section == 'qc':
        summary['section_name'] = 'تقرير الفرز ومراقبة الجودة (QC)'
        qs = QCRecord.objects.select_related('model')

        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)

        # استعلام واحد فقط ثم تجميع كامل في الذاكرة.
        buckets = defaultdict(lambda: {
            'records': [], 'good': 0, 'defects': 0,
            'model_codes': [], 'inspectors': [],
        })
        for rec in qs:
            bucket_date = _record_bucket_date(rec.created_at, period)
            if bucket_date is None:
                continue
            bucket = buckets[bucket_date]
            bucket['records'].append(rec)
            bucket['good'] += int(rec.counted_pieces or 0)
            bucket['defects'] += int(rec.defect_pieces or 0)
            model_code = rec.model.model_code if rec.model else ''
            if model_code and model_code not in bucket['model_codes']:
                bucket['model_codes'].append(model_code)
            if rec.checked_by and rec.checked_by not in bucket['inspectors']:
                bucket['inspectors'].append(rec.checked_by)

        all_models_set = set()

        for bucket_date in sorted(buckets.keys(), reverse=True):
            bucket = buckets[bucket_date]
            model_codes = bucket['model_codes']
            good_pcs = bucket['good']
            defect_pcs = bucket['defects']
            total_pcs = good_pcs + defect_pcs
            ops_count = len(bucket['records'])

            quality_rate = round((good_pcs / total_pcs * 100), 1) if total_pcs > 0 else 100.0

            all_models_set.update(model_codes)

            results.append({
                'period_key': bucket_date.isoformat(),
                'period_label': format_arabic_period_label(bucket_date, period),
                'models_count': len(model_codes),
                'model_codes': model_codes,
                'total_pieces': total_pcs,
                'good_pieces': good_pcs,
                'defect_pieces': defect_pcs,
                'secondary_metric_label': 'الهوالك والعيوب',
                'secondary_metric_value': f"{defect_pcs} ق ({quality_rate}% سليم)",
                'operations_count': ops_count,
                'operators_list': bucket['inspectors'],
                'details_list': [
                    {
                        'id': rec.id,
                        'model_code': rec.model.model_code,
                        'stage': rec.get_stage_display() if hasattr(rec, 'get_stage_display') else rec.stage,
                        'color_name': rec.color_name or '',
                        'size': rec.size or '',
                        'good': rec.counted_pieces,
                        'defects': rec.defect_pieces,
                        'inspector': rec.checked_by,
                        'notes': rec.notes or ''
                    }
                    for rec in bucket['records'][:50]
                ]
            })

            summary['total_pieces'] += total_pcs
            summary['total_operations'] += ops_count

        summary['total_models'] = len(all_models_set)

    # 4. SEWING REPORT (تقرير المكن وخطوط الخياطة)
    elif section == 'sewing':
        summary['section_name'] = 'تقرير قسم المكن وخطوط الخياطة'
        qs = SewingDispatch.objects.select_related('model')

        if date_from:
            qs = qs.filter(dispatched_date__gte=date_from)
        if date_to:
            qs = qs.filter(dispatched_date__lte=date_to)

        # استعلام واحد فقط ثم تجميع كامل في الذاكرة.
        buckets = defaultdict(lambda: {
            'records': [], 'total_pieces': 0, 'model_codes': [], 'workshops': [],
            'received_count': 0, 'shirt_count': 0, 'pants_count': 0,
        })
        for rec in qs:
            bucket_date = _record_bucket_date(rec.dispatched_date, period)
            if bucket_date is None:
                continue
            bucket = buckets[bucket_date]
            bucket['records'].append(rec)
            pieces = int(rec.pieces_count or 0)
            bucket['total_pieces'] += pieces
            if rec.status == 'تم الاستلام':
                bucket['received_count'] += 1
            if rec.piece_type == 'shirt':
                bucket['shirt_count'] += pieces
            elif rec.piece_type == 'pants':
                bucket['pants_count'] += pieces
            model_code = rec.model.model_code if rec.model else ''
            if model_code and model_code not in bucket['model_codes']:
                bucket['model_codes'].append(model_code)
            if rec.workshop_name and rec.workshop_name not in bucket['workshops']:
                bucket['workshops'].append(rec.workshop_name)

        all_models_set = set()

        for bucket_date in sorted(buckets.keys(), reverse=True):
            bucket = buckets[bucket_date]
            model_codes = bucket['model_codes']
            shirt_count = bucket['shirt_count']
            pants_count = bucket['pants_count']
            ops_count = len(bucket['records'])
            total_pcs = bucket['total_pieces']

            all_models_set.update(model_codes)

            results.append({
                'period_key': bucket_date.isoformat(),
                'period_label': format_arabic_period_label(bucket_date, period),
                'models_count': len(model_codes),
                'model_codes': model_codes,
                'total_pieces': total_pcs,
                'secondary_metric_label': 'تفصيل القطع',
                'secondary_metric_value': f"تيشرت: {shirt_count} • بنطلون: {pants_count}",
                'operations_count': ops_count,
                'operators_list': bucket['workshops'],
                'details_list': [
                    {
                        'id': rec.id,
                        'model_code': rec.model.model_code,
                        'piece_label': rec.piece_label or ('تيشرت' if rec.piece_type == 'shirt' else 'بنطلون'),
                        'workshop': rec.workshop_name,
                        'pieces': rec.pieces_count,
                        'expected_date': str(rec.expected_delivery_date) if rec.expected_delivery_date else '',
                        'status': rec.status,
                        'notes': rec.notes or ''
                    }
                    for rec in bucket['records'][:30]
                ]
            })

            summary['total_pieces'] += total_pcs
            summary['total_operations'] += ops_count

        summary['total_models'] = len(all_models_set)

    # Calculate average
    if len(results) > 0:
        summary['avg_pieces_per_period'] = round(summary['total_pieces'] / len(results))

    return {
        'section': section,
        'period': period,
        'summary': summary,
        'time_buckets': results,
        'generated_at': datetime.now().strftime('%Y-%m-%d %H:%M')
    }


# ===========================================================================
# Reports & Statistics v2 — تبويبات التقارير الثلاثة الجديدة
# (الموديلات حسب المقاس / الإنتاج والسرعة / المشاكل والعجز)
# ===========================================================================

# تصنيفات الجنس: المؤنث يُحسب "بناتي" وما عداه "ولادي".
_GIRLS_TOKENS = ('بنات', 'حريمي', 'نسائي', 'بناتي')


def _normalize_gender(model_type):
    value = (model_type or '').strip()
    if not value:
        return 'boys'
    if any(token in value for token in _GIRLS_TOKENS):
        return 'girls'
    return 'boys'


# فلتر التكوين في الواجهة: "قطعة واحدة" تشمل تيشيرت فقط + بنطلون فقط.
COMPOSITION_FILTER_MAP = {
    'one_piece': ['tshirt_only', 'pants_only'],
    'two_pieces': ['two_pieces'],
    'three_pieces': ['three_pieces'],
}

GARMENT_COMPOSITION_LABELS = dict(GARMENT_COMPOSITION_CHOICES)

# مفاتيح القطع (تدعم العربية والإنجليزية المخزنة في garment_parts).
PART_KEY_ALIASES = {
    'shirt': 'shirt', 'تيشرت': 'shirt', 'تيشيرت': 'shirt', 'تي شيرت': 'shirt',
    'pants': 'pants', 'بنطلون': 'pants', 'بنطال': 'pants',
    'jacket': 'jacket', 'جاكيت': 'jacket', 'جاكيتة': 'jacket',
    'single': 'single', 'قطعة واحدة': 'single', 'قطعة واحدة / كامل': 'single',
}

PART_LABELS = dict(PART_TYPE_CHOICES)


def _model_parts(model):
    """يعيد قائمة قطع الموديل بمفاتيح موحّدة (shirt / pants / jacket)."""
    raw = model.garment_parts if isinstance(model.garment_parts, list) else []
    parts = []
    for item in raw:
        text = str(item).strip()
        key = PART_KEY_ALIASES.get(text.lower()) or PART_KEY_ALIASES.get(text)
        if key and key not in parts:
            parts.append(key)
    if parts:
        return parts
    composition = model.garment_composition or 'two_pieces'
    return list(COMPOSITION_TO_PARTS.get(composition, ['shirt']))


STATUS_TO_COARSE_STAGE = {
    'مرحلة التصميم': 'design', 'تصميم': 'design',
    'في القص': 'cutting', 'جاري القص': 'cutting',
    'العد قبل الطباعة': 'qc_before_print', 'فرز قبل الطباعة': 'qc_before_print',
    'فرز وكنترول': 'qc_before_print',
    'جاهز للطباعة / التجميع': 'printing', 'جاهز للمطبعة': 'printing',
    'مرسل للمطبعة': 'printing', 'في المطبعة': 'printing',
    'العد بعد الطباعة': 'qc_after_print',
    'في قسم المكن': 'sewing',
    'العد بعد المكن': 'qc_after_sewing',
    'في التشطيب': 'finishing',
    'في المكواة': 'ironing',
    'في التعبئة والتغليف': 'packaging',
    'جاهز للدَست': 'dest',
    'مخزن الإنتاج التام': 'completed', 'مكتمل الإنتاج': 'completed',
}

COARSE_STAGE_LABELS = [
    ('design', 'التصميم'),
    ('cutting', 'القص'),
    ('qc_before_print', 'العد قبل الطباعة'),
    ('printing', 'المطابع'),
    ('qc_after_print', 'العد بعد الطباعة'),
    ('sewing', 'المكن'),
    ('qc_after_sewing', 'العد بعد المكن'),
    ('finishing', 'التشطيب'),
    ('ironing', 'المكواة'),
    ('packaging', 'التعبئة والتغليف'),
    ('dest', 'الدَست'),
    ('completed', 'الإنتاج التام'),
]
COARSE_STAGE_LABEL_MAP = dict(COARSE_STAGE_LABELS)


def _coarse_stage(status):
    value = (status or '').strip()
    if value in STATUS_TO_COARSE_STAGE:
        return STATUS_TO_COARSE_STAGE[value]
    if not value:
        return 'design'
    tokens = [
        ('بعد المكن', 'qc_after_sewing'),
        ('بعد الطباعة', 'qc_after_print'),
        ('قبل الطباعة', 'qc_before_print'),
        ('تصميم', 'design'),
        ('قص', 'cutting'),
        ('مطبعة', 'printing'),
        ('مكن', 'sewing'),
        ('تشطيب', 'finishing'),
        ('مكواة', 'ironing'),
        ('تعبئة', 'packaging'),
        ('دَست', 'dest'),
        ('مكتمل', 'completed'),
        ('انتاج التام', 'completed'),
    ]
    for token, key in tokens:
        if token in value:
            return key
    return 'design'


def _parse_iso_date(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.strptime(str(value)[:10], '%Y-%m-%d').date()
    except (TypeError, ValueError):
        return None


def _to_int(value):
    try:
        return max(0, int(float(value or 0)))
    except (TypeError, ValueError):
        return 0


def _size_sort_key(bucket):
    name = bucket.get('size_name') or ''
    numbers = [int(n) for n in re.findall(r'\d+', name)]
    if numbers:
        return (0, numbers, name)
    return (1, [999999], name)


def _model_part_good_pieces(model, part_type):
    """أفضل عدد سليم متاح للقطعة (يُستخدم في التشطيب/المكواة حيث لا يوجد عد قطع)."""
    part = (part_type or '').strip()
    value = 0
    if part == 'shirt':
        value = model.qc_shirt_pieces
    elif part == 'pants':
        value = model.qc_pants_pieces
    elif part == 'jacket':
        value = model.qc_jacket_pieces
    elif part == 'single':
        value = (model.qc_shirt_pieces or 0) + (model.qc_pants_pieces or 0) + (model.qc_jacket_pieces or 0)
    if not value:
        value = model.count_after_sewing or model.total_cut_pieces or 0
    return int(value or 0)


def _model_total_good_pieces(model):
    total = (model.qc_shirt_pieces or 0) + (model.qc_pants_pieces or 0) + (model.qc_jacket_pieces or 0)
    if not total:
        total = model.count_after_sewing or 0
    if not total:
        total = model.total_cut_pieces or 0
    return int(total or 0)


def _current_good_pieces(model):
    """العدد السليم الحالي للموديل بما يتوافق مع دلالة total_cut_pieces.

    - الموديلات الجديدة (لها garment_parts): total_cut_pieces = أقل عدد مقصوص بين
      القطع (أطقم مكتملة)، لذلك السليم الحالي = أقل عدد سليم بين القطع التي لها عد.
    - الموديلات القديمة (بدون garment_parts): total_cut_pieces = مجموع القطع،
      لذلك السليم الحالي = مجموع السليم لكل قطعة.
    """
    stage = _coarse_stage(model.status)
    if stage in ('design', 'cutting'):
        return int(model.total_cut_pieces or 0)

    parts = [p for p in _model_parts(model) if p in ('shirt', 'pants', 'jacket')]
    is_legacy = not (model.garment_parts or [])
    per_part = [int(getattr(model, f'qc_{p}_pieces', 0) or 0) for p in parts]
    if parts and any(per_part):
        if is_legacy:
            return sum(per_part)
        positive = [value for value in per_part if value > 0]
        return min(positive) if positive else sum(per_part)

    if stage in ('qc_after_sewing', 'finishing', 'ironing', 'packaging', 'dest', 'completed'):
        value = model.count_after_sewing
        if not value:
            value = (model.qc_shirt_pieces or 0) + (model.qc_pants_pieces or 0) + (model.qc_jacket_pieces or 0)
    elif stage in ('sewing', 'qc_after_print', 'qc_before_print', 'printing'):
        value = model.count_after_print or model.count_before_print
    else:
        value = model.count_after_print or model.count_before_print or model.total_cut_pieces
    return int(value or 0)


def get_models_report(metric='models', date_from=None, date_to=None, composition=None, model_type=None):
    """
    تبويب "الموديلات حسب المقاس":
    يجمع الموديلات على فئات المقاسات (SizeDef) مع فصل ولادي/بناتي
    (حسب عدد الموديلات أو إجمالي القطع) ويعيد تفنيد التكوين والمراحل.
    """
    start = _parse_iso_date(date_from)
    end = _parse_iso_date(date_to)

    # الموديلات المحذوفة (حذفاً ناعماً) لا تظهر في أي تقرير.
    qs = ModelItem.objects.filter(is_deleted=False)
    if start:
        qs = qs.filter(created_at__date__gte=start)
    if end:
        qs = qs.filter(created_at__date__lte=end)
    if model_type:
        qs = qs.filter(model_type=model_type)
    if composition:
        comps = COMPOSITION_FILTER_MAP.get(composition)
        if comps:
            qs = qs.filter(garment_composition__in=comps)

    rows = list(qs.values(
        'size_category_id', 'model_type', 'status', 'total_cut_pieces', 'garment_composition',
    ))

    # فئة المقاس تُخزَّن في الموديل بالمعرف الخارجي (client_id) بينما قد يقارن
    # التقرير بالمعرف الداخلي (pk)؛ لذا نفهرس الفئتين معاً حتى لا تسقط الفئات
    # الحقيقية في خانة "بدون فئة مقاس".
    size_defs = {}
    for item in SizeDef.objects.all():
        size_defs[str(item.id)] = item
        if item.client_id:
            size_defs[str(item.client_id)] = item
    buckets = {}

    def _bucket(key, name, values):
        if key not in buckets:
            buckets[key] = {
                'size_id': key,
                'size_name': name,
                'size_values': values,
                'boys_models': 0,
                'girls_models': 0,
                'boys_pieces': 0,
                'girls_pieces': 0,
            }
        return buckets[key]

    for row in rows:
        size_key = str(row.get('size_category_id') or '')
        size_obj = size_defs.get(size_key)
        if size_obj:
            bucket = _bucket(size_key, size_obj.name, size_obj.values)
        else:
            bucket = _bucket('__none__', 'بدون فئة مقاس', '')
        gender = _normalize_gender(row.get('model_type'))
        pieces = int(row.get('total_cut_pieces') or 0)
        if gender == 'girls':
            bucket['girls_models'] += 1
            bucket['girls_pieces'] += pieces
        else:
            bucket['boys_models'] += 1
            bucket['boys_pieces'] += pieces

    size_categories = sorted(buckets.values(), key=_size_sort_key)

    for bucket in size_categories:
        bucket['boys_value'] = bucket['boys_pieces'] if metric == 'pieces' else bucket['boys_models']
        bucket['girls_value'] = bucket['girls_pieces'] if metric == 'pieces' else bucket['girls_models']
        bucket['total_models'] = bucket['boys_models'] + bucket['girls_models']
        bucket['total_pieces'] = bucket['boys_pieces'] + bucket['girls_pieces']

    composition_breakdown = []
    for comp_key, comp_label in GARMENT_COMPOSITION_CHOICES:
        members = [r for r in rows if (r.get('garment_composition') or 'two_pieces') == comp_key]
        composition_breakdown.append({
            'key': comp_key,
            'label': comp_label,
            'models_count': len(members),
            'pieces_count': sum(int(r.get('total_cut_pieces') or 0) for r in members),
        })

    stage_counts = {}
    for row in rows:
        stage = _coarse_stage(row.get('status'))
        stage_counts[stage] = stage_counts.get(stage, 0) + 1
    stage_breakdown = [
        {'key': key, 'label': label, 'models_count': stage_counts.get(key, 0)}
        for key, label in COARSE_STAGE_LABELS
        if stage_counts.get(key, 0)
    ]
    stage_breakdown.sort(key=lambda item: item['models_count'], reverse=True)

    model_types = list(
        ModelItem.objects.filter(is_deleted=False)
        .exclude(model_type__isnull=True).exclude(model_type='')
        .values_list('model_type', flat=True).distinct().order_by('model_type')
    )

    totals = {
        'models': len(rows),
        'boys_models': sum(b['boys_models'] for b in size_categories),
        'girls_models': sum(b['girls_models'] for b in size_categories),
        'pieces': sum(int(r.get('total_cut_pieces') or 0) for r in rows),
        'boys_pieces': sum(b['boys_pieces'] for b in size_categories),
        'girls_pieces': sum(b['girls_pieces'] for b in size_categories),
        'size_categories': len([b for b in size_categories if b['size_id'] != '__none__']),
    }

    return {
        'metric': 'pieces' if metric == 'pieces' else 'models',
        'date_from': start.isoformat() if start else '',
        'date_to': end.isoformat() if end else '',
        'composition_filter': composition or '',
        'model_type_filter': model_type or '',
        'size_categories': size_categories,
        'composition_breakdown': composition_breakdown,
        'stage_breakdown': stage_breakdown,
        'model_types': model_types,
        'totals': totals,
        'generated_at': datetime.now().strftime('%Y-%m-%d %H:%M'),
    }


# ---------------------------------------------------------------------------
# تبويب الإنتاج والسرعة — أقسام المصنع والتارجت
# ---------------------------------------------------------------------------

DEPARTMENT_DEFS = [
    {'key': 'cutting', 'label': 'القص', 'icon': '✂️', 'color': '#6366F1'},
    {'key': 'printing', 'label': 'المطابع والتطريز', 'icon': '🖨️', 'color': '#3B82F6'},
    {'key': 'qc', 'label': 'الفرز والجودة', 'icon': '🔍', 'color': '#10B981'},
    {'key': 'sewing', 'label': 'المكن', 'icon': '🧵', 'color': '#F59E0B'},
    {'key': 'finishing', 'label': 'التشطيب', 'icon': '✨', 'color': '#8B5CF6'},
    {'key': 'ironing', 'label': 'المكواة', 'icon': '🔥', 'color': '#EF4444'},
    {'key': 'packaging', 'label': 'التعبئة والدَست', 'icon': '📦', 'color': '#0EA5E9'},
]
DEPARTMENT_KEYS = {item['key'] for item in DEPARTMENT_DEFS}


def _resolve_report_period(period, date_from=None, date_to=None):
    today = date.today()
    key = (period or 'today').strip().lower()
    if key in ('day', 'today', 'daily'):
        start = end = today
        key = 'today'
    elif key in ('week', 'weekly'):
        start = today - timedelta(days=today.weekday())
        end = start + timedelta(days=6)
        key = 'week'
    elif key in ('month', 'monthly'):
        start = today.replace(day=1)
        end = (start + timedelta(days=32)).replace(day=1) - timedelta(days=1)
        key = 'month'
    elif key == 'custom':
        start = _parse_iso_date(date_from) or today.replace(day=1)
        end = _parse_iso_date(date_to) or today
    else:
        start = end = today
        key = 'today'
    if end < start:
        start, end = end, start
    days = max(1, (end - start).days + 1)
    return start, end, days, key


def _previous_period(start, end):
    days = (end - start).days + 1
    prev_end = start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=max(0, days - 1))
    return prev_start, prev_end


def _period_label(start, end, period_key):
    if start == end:
        return format_arabic_period_label(start, 'daily')
    if period_key == 'month':
        return format_arabic_period_label(start, 'monthly')
    return f"من {start.day}/{start.month}/{start.year} إلى {end.day}/{end.month}/{end.year}"


def _daily_pieces(qs, date_field, pieces_field, start, end, is_datetime):
    """تجميع القطع والموديلات يومياً + الإجمالي خلال الفترة."""
    if is_datetime:
        filtered = qs.filter(**{f'{date_field}__date__range': (start, end)})
        grouped = (
            filtered.annotate(_day=TruncDate(date_field))
            .values('_day').annotate(pieces=Sum(pieces_field)).order_by('_day')
        )
    else:
        filtered = qs.filter(**{f'{date_field}__range': (start, end)})
        grouped = (
            filtered.values(date_field).annotate(pieces=Sum(pieces_field)).order_by(date_field)
        )
    daily = {}
    total = 0
    for row in grouped:
        day = row['_day'] if is_datetime else row[date_field]
        day_key = day.isoformat() if hasattr(day, 'isoformat') else str(day)
        qty = int(row.get('pieces') or 0)
        daily[day_key] = daily.get(day_key, 0) + qty
        total += qty
    models_total = filtered.values('model').distinct().count()
    return total, models_total, daily


def _assembly_like_aggregate(qs, start, end, piece_fn, date_field='actual_exit_date'):
    """تجميع أقسام لا تحمل عدد قطع (التشطيب / المكواة / التعبئة)."""
    records = qs.filter(**{f'{date_field}__range': (start, end)}).select_related('model')
    daily = {}
    model_ids = set()
    total = 0
    for record in records:
        pieces = int(piece_fn(record) or 0)
        total += pieces
        model_ids.add(record.model_id)
        day = getattr(record, date_field, None)
        if day:
            day_key = day.isoformat() if hasattr(day, 'isoformat') else str(day)
            daily[day_key] = daily.get(day_key, 0) + pieces
    return total, len(model_ids), daily


def _build_daily_series(start, end, daily_map, daily_target=0):
    series = []
    cursor = start
    while cursor <= end:
        key = cursor.isoformat()
        series.append({
            'date': key,
            'label': f'{cursor.day}/{cursor.month}',
            'pieces': int(daily_map.get(key, 0)),
            'target': int(daily_target or 0),
        })
        cursor += timedelta(days=1)
    return series


def get_department_targets():
    settings = GlobalSettings.get_solo()
    raw = settings.department_targets if isinstance(settings.department_targets, dict) else {}
    targets = {}
    for dep in DEPARTMENT_DEFS:
        entry = raw.get(dep['key'])
        entry = entry if isinstance(entry, dict) else {}
        targets[dep['key']] = {
            'daily': _to_int(entry.get('daily')),
            'monthly': _to_int(entry.get('monthly')),
        }
    return targets


def save_department_targets(payload):
    if not isinstance(payload, dict):
        raise ValueError('صيغة تارجت الأقسام غير صحيحة.')
    settings = GlobalSettings.get_solo()
    current = settings.department_targets if isinstance(settings.department_targets, dict) else {}
    cleaned = dict(current)
    for key, value in payload.items():
        if key not in DEPARTMENT_KEYS:
            continue
        entry = value if isinstance(value, dict) else {}
        cleaned[key] = {
            'daily': _to_int(entry.get('daily')),
            'monthly': _to_int(entry.get('monthly')),
        }
    settings.department_targets = cleaned
    settings.save(update_fields=['department_targets'])
    return get_department_targets()


def get_production_departments_report(period='today', date_from=None, date_to=None):
    """
    تبويب "الإنتاج والسرعة": أرقام كل قسم خلال الفترة (موديلات/قطع/سرعة يومية)
    مع التارجت اليومي/الشهري ونسبة الإنجاز والمقارنة بالفترة السابقة.
    """
    start, end, days, period_key = _resolve_report_period(period, date_from, date_to)
    prev_start, prev_end = _previous_period(start, end)
    targets = get_department_targets()

    simple_sources = {
        'cutting': (CuttingRecord.objects.all(), 'created_at', 'pieces_count', True),
        'printing': (PrintDispatch.objects.all(), 'dispatch_date', 'pieces_count', False),
        'qc': (QCRecord.objects.all(), 'created_at', 'counted_pieces', True),
        'sewing': (SewingDispatch.objects.all(), 'dispatched_date', 'pieces_count', False),
    }

    departments = []
    for dep in DEPARTMENT_DEFS:
        key = dep['key']
        if key in simple_sources:
            qs, date_field, pieces_field, is_datetime = simple_sources[key]
            pieces, models_count, daily_map = _daily_pieces(
                qs, date_field, pieces_field, start, end, is_datetime
            )
            previous_pieces, _, _ = _daily_pieces(
                qs, date_field, pieces_field, prev_start, prev_end, is_datetime
            )
        elif key == 'finishing':
            finishing_qs = FinishingRecord.objects.all()
            pieces, models_count, daily_map = _assembly_like_aggregate(
                finishing_qs, start, end,
                lambda rec: _model_part_good_pieces(rec.model, rec.part_type),
            )
            previous_pieces, _, _ = _assembly_like_aggregate(
                finishing_qs, prev_start, prev_end,
                lambda rec: _model_part_good_pieces(rec.model, rec.part_type),
            )
        elif key == 'ironing':
            ironing_qs = AssemblyStageRecord.objects.filter(stage='ironing')
            pieces, models_count, daily_map = _assembly_like_aggregate(
                ironing_qs, start, end,
                lambda rec: _model_part_good_pieces(rec.model, rec.part_type),
            )
            previous_pieces, _, _ = _assembly_like_aggregate(
                ironing_qs, prev_start, prev_end,
                lambda rec: _model_part_good_pieces(rec.model, rec.part_type),
            )
        else:  # packaging + dest
            packaging_qs = AssemblyStageRecord.objects.filter(stage__in=('packaging', 'dest'))
            pieces, models_count, daily_map = _assembly_like_aggregate(
                packaging_qs, start, end, lambda rec: _model_total_good_pieces(rec.model),
            )
            previous_pieces, _, _ = _assembly_like_aggregate(
                packaging_qs, prev_start, prev_end, lambda rec: _model_total_good_pieces(rec.model),
            )

        dep_target = targets.get(key) or {'daily': 0, 'monthly': 0}
        daily_target = dep_target.get('daily', 0)
        monthly_target = dep_target.get('monthly', 0)
        target = monthly_target if period_key == 'month' else daily_target * days
        avg_daily = round(pieces / days) if days else 0
        progress = round((pieces / target) * 100) if target else 0
        delta = pieces - previous_pieces
        delta_percent = round((delta / previous_pieces) * 100) if previous_pieces else (100 if pieces else 0)

        departments.append({
            **dep,
            'models_count': models_count,
            'pieces_count': pieces,
            'avg_daily': avg_daily,
            'target': target,
            'target_daily': daily_target,
            'target_monthly': monthly_target,
            'progress_percent': progress,
            'previous_pieces': previous_pieces,
            'delta': delta,
            'delta_percent': delta_percent,
            'daily_series': _build_daily_series(start, end, daily_map, daily_target),
        })

    return {
        'period': period_key,
        'period_label': _period_label(start, end, period_key),
        'date_from': start.isoformat(),
        'date_to': end.isoformat(),
        'days': days,
        'departments': departments,
        'targets': targets,
        'generated_at': datetime.now().strftime('%Y-%m-%d %H:%M'),
    }


# ---------------------------------------------------------------------------
# تبويب المشاكل والعجز — العجز بين المراحل + الهالك
# ---------------------------------------------------------------------------

def get_quality_shortage_report(search=None, sort='shortage', date_from=None, date_to=None):
    """تبويب "المشاكل والعجز": المقصوص مقابل العدد الحالي السليم لكل موديل + الهالك."""
    start = _parse_iso_date(date_from)
    end = _parse_iso_date(date_to)

    # استبعاد الموديلات المحذوفة من تقرير العجز أيضاً.
    qs = ModelItem.objects.filter(is_deleted=False)
    if search:
        qs = qs.filter(model_code__icontains=search.strip())
    if start:
        qs = qs.filter(created_at__date__gte=start)
    if end:
        qs = qs.filter(created_at__date__lte=end)

    models = list(qs)
    rows = []
    total_cut = 0
    total_current = 0
    for model in models:
        cut = int(model.total_cut_pieces or 0)
        current = _current_good_pieces(model)
        shortage = max(0, cut - current)
        shortage_percent = round((shortage / cut) * 100, 1) if cut else 0.0
        total_cut += cut
        total_current += current
        stage = _coarse_stage(model.status)
        rows.append({
            'model_id': model.id,
            'client_id': model.client_id or '',
            'model_code': model.model_code,
            'model_type': model.model_type or '',
            'image': model.image or '',
            'status': model.status or '',
            'stage': stage,
            'stage_label': COARSE_STAGE_LABEL_MAP.get(stage, model.status or ''),
            'garment_composition': model.garment_composition or '',
            'composition_label': GARMENT_COMPOSITION_LABELS.get(model.garment_composition or 'two_pieces', ''),
            'cut_pieces': cut,
            'current_pieces': current,
            'shortage': shortage,
            'shortage_percent': shortage_percent,
        })

    if sort == 'code':
        rows.sort(key=lambda item: item['model_code'])
    elif sort == 'cut':
        rows.sort(key=lambda item: item['cut_pieces'], reverse=True)
    elif sort == 'percent':
        rows.sort(key=lambda item: item['shortage_percent'], reverse=True)
    else:
        rows.sort(key=lambda item: item['shortage'], reverse=True)

    stage_defect_labels = dict(QCRecord.STAGE_TYPES)
    defect_rows = (
        QCRecord.objects.values('stage')
        .annotate(defects=Sum('defect_pieces'), counted=Sum('counted_pieces'))
        .order_by('-defects')
    )
    defects_by_stage = [
        {
            'stage': row['stage'],
            'label': stage_defect_labels.get(row['stage'], row['stage']),
            'defects': int(row['defects'] or 0),
            'counted': int(row['counted'] or 0),
        }
        for row in defect_rows
    ]
    worst_stage = (
        defects_by_stage[0]
        if defects_by_stage
        else {'stage': '', 'label': '—', 'defects': 0, 'counted': 0}
    )
    total_defects = sum(item['defects'] for item in defects_by_stage)

    total_shortage = max(0, total_cut - total_current)
    total_shortage_percent = round((total_shortage / total_cut) * 100, 1) if total_cut else 0.0

    return {
        'summary': {
            'models_count': len(rows),
            'total_cut_pieces': total_cut,
            'total_current_pieces': total_current,
            'total_shortage': total_shortage,
            'total_shortage_percent': total_shortage_percent,
            'total_defects': total_defects,
            'worst_stage': worst_stage,
        },
        'defects_by_stage': defects_by_stage,
        'models': rows,
        'sort': sort,
        'search': search or '',
        'generated_at': datetime.now().strftime('%Y-%m-%d %H:%M'),
    }


def _model_stage_waterfall(model):
    """تفصيل مراحل الموديل (مدخل/مخرج/نقص) مع فصل القطع حيث تتوفر أرقام لكل قطعة."""
    parts = _model_parts(model)
    target = int(model.target_cut_quantity or 0)

    print_by_part = {}
    for rec in PrintDispatch.objects.filter(model=model):
        key = PART_KEY_ALIASES.get((rec.piece_type or '').strip().lower()) or rec.piece_type or 'shirt'
        print_by_part[key] = print_by_part.get(key, 0) + int(rec.pieces_count or 0)

    sewing_by_part = {}
    for rec in SewingDispatch.objects.filter(model=model):
        key = PART_KEY_ALIASES.get((rec.piece_type or '').strip().lower()) or rec.piece_type or 'shirt'
        sewing_by_part[key] = sewing_by_part.get(key, 0) + int(rec.pieces_count or 0)

    part_rows = []
    cut_total = 0
    good_total = 0
    sewn_total = 0
    for part in parts:
        cut = int(getattr(model, f'cut_{part}_pieces', 0) or 0)
        good = int(getattr(model, f'qc_{part}_pieces', 0) or 0)
        printed = print_by_part.get(part, 0)
        sewn = sewing_by_part.get(part, 0)

        cut_in = target if len(parts) == 1 else cut
        cut_out = cut
        print_in = cut_out
        print_out = min(print_in, printed) if printed else print_in
        qc_in = print_out
        qc_out = min(qc_in, good) if good else qc_in
        sew_in = qc_out
        sew_out = min(sew_in, sewn) if sewn else sew_in

        stages = [
            {'key': 'cutting', 'label': 'القص', 'in_qty': cut_in, 'out_qty': cut_out,
             'loss': max(0, cut_in - cut_out)},
            {'key': 'printing', 'label': 'المطابع', 'in_qty': print_in, 'out_qty': print_out,
             'loss': max(0, print_in - print_out)},
            {'key': 'qc', 'label': 'الفرز والجودة', 'in_qty': qc_in, 'out_qty': qc_out,
             'loss': max(0, qc_in - qc_out)},
            {'key': 'sewing', 'label': 'المكن', 'in_qty': sew_in, 'out_qty': sew_out,
             'loss': max(0, sew_in - sew_out)},
        ]

        part_rows.append({
            'part': part,
            'label': PART_LABELS.get(part, part),
            'cut_pieces': cut,
            'good_pieces': good,
            'printed_pieces': printed,
            'sewn_pieces': sewn,
            'shortage': max(0, cut - (good or cut)),
            'stages': stages,
        })
        cut_total += cut
        good_total += (good or cut)
        sewn_total += sewn or good

    assembly_in = (
        int(model.count_after_sewing or 0)
        or sewn_total
        or good_total
        or int(model.total_cut_pieces or 0)
    )

    finishing_records = list(FinishingRecord.objects.filter(model=model))
    ironing_records = list(AssemblyStageRecord.objects.filter(model=model, stage='ironing'))
    packaging_records = list(
        AssemblyStageRecord.objects.filter(model=model, stage__in=('packaging', 'dest'))
    )

    def _model_stage(key, label, records):
        completed = [r for r in records if getattr(r, 'actual_exit_date', None)]
        if completed:
            status_key, status_label = 'completed', 'تم'
        elif records:
            status_key, status_label = 'in_progress', 'قيد التنفيذ'
        else:
            status_key, status_label = 'not_started', 'لم يبدأ'
        return {
            'key': key,
            'label': label,
            'in_qty': assembly_in,
            'out_qty': assembly_in if completed else 0,
            'loss': 0,
            'status': status_key,
            'status_label': status_label,
            'records_count': len(records),
            'completed_count': len(completed),
        }

    model_stages = [
        _model_stage('finishing', 'التشطيب', finishing_records),
        _model_stage('ironing', 'المكواة', ironing_records),
        _model_stage('packaging', 'التعبئة والدَست', packaging_records),
    ]

    return {
        'model': {
            'id': model.id,
            'model_code': model.model_code,
            'model_type': model.model_type or '',
            'image': model.image or '',
            'status': model.status or '',
            'stage': _coarse_stage(model.status),
            'stage_label': COARSE_STAGE_LABEL_MAP.get(_coarse_stage(model.status), model.status or ''),
            'garment_composition': model.garment_composition or '',
            'composition_label': GARMENT_COMPOSITION_LABELS.get(model.garment_composition or 'two_pieces', ''),
            'target_cut_quantity': target,
            'total_cut_pieces': int(model.total_cut_pieces or 0),
            'count_after_sewing': int(model.count_after_sewing or 0),
        },
        'parts': part_rows,
        'model_stages': model_stages,
        'summary': {
            'cut_total': cut_total,
            'good_total': good_total,
            'shortage_total': max(0, cut_total - good_total),
            'shortage_percent': (
                round((max(0, cut_total - good_total) / cut_total) * 100, 1) if cut_total else 0.0
            ),
        },
        'generated_at': datetime.now().strftime('%Y-%m-%d %H:%M'),
    }


def get_model_stage_waterfall(model_id):
    model = ModelItem.objects.filter(id=model_id).first()
    if not model:
        return None
    return _model_stage_waterfall(model)
