from datetime import datetime, date, timedelta
from django.db.models import Count, Sum, F, Q
from django.db.models.functions import TruncDate, TruncWeek, TruncMonth
from .models import (
    CuttingRecord, 
    PrintDispatch, 
    QCRecord, 
    SewingDispatch, 
    ModelItem,
    ModelTimeline
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


def get_production_report(section='cutting', period='daily', date_from=None, date_to=None):
    """
    Generates dynamic aggregated analytics report for:
    - section: 'cutting' | 'printing' | 'qc' | 'sewing'
    - period: 'daily' | 'weekly' | 'monthly'
    - date_from, date_to: optional ISO date strings (YYYY-MM-DD)
    """
    # Determine Trunc function
    trunc_map = {
        'daily': TruncDate,
        'weekly': TruncWeek,
        'monthly': TruncMonth
    }
    trunc_func = trunc_map.get(period, TruncDate)

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
        qs = CuttingRecord.objects.select_related('model')

        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)

        # Group by truncated date
        raw_grouped = qs.annotate(bucket=trunc_func('created_at')).values('bucket').annotate(
            total_pieces=Sum('pieces_count'),
            total_layers=Sum('layers_count'),
            ops_count=Count('id'),
            models_count=Count('model', distinct=True)
        ).order_by('-bucket')

        all_models_set = set()

        for g in raw_grouped:
            bucket_date = g['bucket']
            bucket_str = bucket_date.isoformat() if hasattr(bucket_date, 'isoformat') else str(bucket_date)
            
            # Fetch contributing records in this bucket
            sub_records = qs.filter(created_at__date=bucket_date if period == 'daily' else bucket_date)
            model_codes = list(sub_records.values_list('model__model_code', flat=True).distinct())
            cutters = list(sub_records.values_list('cutter_name', flat=True).distinct())
            colors = list(sub_records.values_list('fabric_color', flat=True).distinct())

            all_models_set.update(model_codes)
            total_pcs = g['total_pieces'] or 0

            results.append({
                'period_key': bucket_str,
                'period_label': format_arabic_period_label(bucket_date, period),
                'models_count': g['models_count'],
                'model_codes': model_codes,
                'total_pieces': total_pcs,
                'secondary_metric_label': 'عدد الراقات',
                'secondary_metric_value': g['total_layers'] or 0,
                'operations_count': g['ops_count'],
                'operators_list': [c for c in cutters if c],
                'details_list': [
                    {
                        'id': rec.id,
                        'model_code': rec.model.model_code,
                        'color': rec.fabric_color,
                        'cutter': rec.cutter_name,
                        'pieces': rec.pieces_count,
                        'layers': rec.layers_count,
                        'notes': rec.notes or '',
                        'time': rec.created_at.strftime('%H:%M') if rec.created_at else ''
                    }
                    for rec in sub_records[:30]
                ]
            })

            summary['total_pieces'] += total_pcs
            summary['total_operations'] += g['ops_count']

        summary['total_models'] = len(all_models_set)

    # 2. PRINTING REPORT (تقرير المطابع والتطريز)
    elif section == 'printing':
        summary['section_name'] = 'تقرير المطابع والتطريز'
        qs = PrintDispatch.objects.select_related('model')

        if date_from:
            qs = qs.filter(dispatch_date__gte=date_from)
        if date_to:
            qs = qs.filter(dispatch_date__lte=date_to)

        raw_grouped = qs.annotate(bucket=trunc_func('dispatch_date')).values('bucket').annotate(
            total_pieces=Sum('pieces_count'),
            ops_count=Count('id'),
            models_count=Count('model', distinct=True)
        ).order_by('-bucket')

        all_models_set = set()

        for g in raw_grouped:
            bucket_date = g['bucket']
            bucket_str = bucket_date.isoformat() if hasattr(bucket_date, 'isoformat') else str(bucket_date)
            
            sub_records = qs.filter(dispatch_date=bucket_date)
            model_codes = list(sub_records.values_list('model__model_code', flat=True).distinct())
            shops = list(sub_records.values_list('print_house', flat=True).distinct())
            received_count = sub_records.filter(status='تم الاستلام').count()

            all_models_set.update(model_codes)
            total_pcs = g['total_pieces'] or 0

            results.append({
                'period_key': bucket_str,
                'period_label': format_arabic_period_label(bucket_date, period),
                'models_count': g['models_count'],
                'model_codes': model_codes,
                'total_pieces': total_pcs,
                'secondary_metric_label': 'تم استلامها',
                'secondary_metric_value': f"{received_count} من {g['ops_count']}",
                'operations_count': g['ops_count'],
                'operators_list': [s for s in shops if s],
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
                    for rec in sub_records[:30]
                ]
            })

            summary['total_pieces'] += total_pcs
            summary['total_operations'] += g['ops_count']

        summary['total_models'] = len(all_models_set)

    # 3. QC REPORT (تقرير الفرز والجودة)
    elif section == 'qc':
        summary['section_name'] = 'تقرير الفرز ومراقبة الجودة (QC)'
        qs = QCRecord.objects.select_related('model')

        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)

        raw_grouped = qs.annotate(bucket=trunc_func('created_at')).values('bucket').annotate(
            total_good=Sum('counted_pieces'),
            total_defects=Sum('defect_pieces'),
            ops_count=Count('id'),
            models_count=Count('model', distinct=True)
        ).order_by('-bucket')

        all_models_set = set()

        for g in raw_grouped:
            bucket_date = g['bucket']
            bucket_str = bucket_date.isoformat() if hasattr(bucket_date, 'isoformat') else str(bucket_date)
            
            sub_records = qs.filter(created_at__date=bucket_date if period == 'daily' else bucket_date)
            model_codes = list(sub_records.values_list('model__model_code', flat=True).distinct())
            inspectors = list(sub_records.values_list('checked_by', flat=True).distinct())

            good_pcs = g['total_good'] or 0
            defect_pcs = g['total_defects'] or 0
            total_pcs = good_pcs + defect_pcs

            quality_rate = round((good_pcs / total_pcs * 100), 1) if total_pcs > 0 else 100.0

            all_models_set.update(model_codes)

            results.append({
                'period_key': bucket_str,
                'period_label': format_arabic_period_label(bucket_date, period),
                'models_count': g['models_count'],
                'model_codes': model_codes,
                'total_pieces': total_pcs,
                'good_pieces': good_pcs,
                'defect_pieces': defect_pcs,
                'secondary_metric_label': 'الهوالك والعيوب',
                'secondary_metric_value': f"{defect_pcs} ق ({quality_rate}% سليم)",
                'operations_count': g['ops_count'],
                'operators_list': [ins for ins in inspectors if ins],
                'details_list': [
                    {
                        'id': rec.id,
                        'model_code': rec.model.model_code,
                        'stage': rec.get_stage_display() if hasattr(rec, 'get_stage_display') else rec.stage,
                        'good': rec.counted_pieces,
                        'defects': rec.defect_pieces,
                        'inspector': rec.checked_by,
                        'notes': rec.notes or ''
                    }
                    for rec in sub_records[:30]
                ]
            })

            summary['total_pieces'] += total_pcs
            summary['total_operations'] += g['ops_count']

        summary['total_models'] = len(all_models_set)

    # 4. SEWING REPORT (تقرير المكن وخطوط الخياطة)
    elif section == 'sewing':
        summary['section_name'] = 'تقرير قسم المكن وخطوط الخياطة'
        qs = SewingDispatch.objects.select_related('model')

        if date_from:
            qs = qs.filter(dispatched_date__gte=date_from)
        if date_to:
            qs = qs.filter(dispatched_date__lte=date_to)

        raw_grouped = qs.annotate(bucket=trunc_func('dispatched_date')).values('bucket').annotate(
            total_pieces=Sum('pieces_count'),
            ops_count=Count('id'),
            models_count=Count('model', distinct=True)
        ).order_by('-bucket')

        all_models_set = set()

        for g in raw_grouped:
            bucket_date = g['bucket']
            bucket_str = bucket_date.isoformat() if hasattr(bucket_date, 'isoformat') else str(bucket_date)
            
            sub_records = qs.filter(dispatched_date=bucket_date)
            model_codes = list(sub_records.values_list('model__model_code', flat=True).distinct())
            workshops = list(sub_records.values_list('workshop_name', flat=True).distinct())
            received_count = sub_records.filter(status='تم الاستلام').count()

            shirt_count = sub_records.filter(piece_type='shirt').aggregate(s=Sum('pieces_count'))['s'] or 0
            pants_count = sub_records.filter(piece_type='pants').aggregate(s=Sum('pieces_count'))['s'] or 0

            all_models_set.update(model_codes)
            total_pcs = g['total_pieces'] or 0

            results.append({
                'period_key': bucket_str,
                'period_label': format_arabic_period_label(bucket_date, period),
                'models_count': g['models_count'],
                'model_codes': model_codes,
                'total_pieces': total_pcs,
                'secondary_metric_label': 'تفصيل القطع',
                'secondary_metric_value': f"تيشرت: {shirt_count} • بنطلون: {pants_count}",
                'operations_count': g['ops_count'],
                'operators_list': [w for w in workshops if w],
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
                    for rec in sub_records[:30]
                ]
            })

            summary['total_pieces'] += total_pcs
            summary['total_operations'] += g['ops_count']

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
