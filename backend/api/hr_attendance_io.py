"""
أدوات سجل الحضور والانصراف (البصمة).

- توليد قالب البصمة الفارغ (CSV) مملوء بموظفي المصنع.
- قراءة شيتات البصمة المرفوعة بصيغة CSV أو XLSX (بدون مكتبات خارجية).
- مطابقة كود البصمة employee_code واحتساب التأخير والانصراف المبكر والغياب
  بناءً على إعدادات الحضور العامة (HRAttendanceSettings).
"""

import csv
import io
import re
import zipfile
import xml.etree.ElementTree as ET
from datetime import date, datetime, time, timedelta

# أعمدة قالب البصمة الرسمي.
TEMPLATE_HEADERS = [
    'كود البصمة ID',
    'اسم العامل',
    'التاريخ',
    'وقت الحضور',
    'وقت الانصراف',
]

# أسماء الأعمدة المقبولة عند الرفع (عربي / إنجليزي) بعد تطبيع النص.
HEADER_ALIASES = {
    'employee_code': [
        'كود البصمة id', 'كود البصمة', 'كود الموظف', 'رقم البصمة', 'كود العامل',
        'employee code', 'employee id', 'employee_code', 'code', 'id',
    ],
    'employee_name': ['اسم العامل', 'اسم الموظف', 'الاسم', 'employee name', 'name'],
    'date': ['التاريخ', 'تاريخ اليوم', 'date', 'day'],
    'check_in': ['وقت الحضور', 'بصمة الحضور', 'الحضور', 'حضور', 'check in', 'checkin', 'in'],
    'check_out': ['وقت الانصراف', 'بصمة الانصراف', 'الانصراف', 'انصراف', 'check out', 'checkout', 'out'],
    'status': ['الحالة', 'حالة الحضور', 'status', 'attendance status'],
}

STATUS_ALIASES = {
    'present': 'present',
    'حاضر': 'present',
    'موجود': 'present',
    'p': 'present',
    'absent': 'absent',
    'غائب': 'absent',
    'غياب': 'absent',
    'a': 'absent',
    'leave': 'leave',
    'إجازة': 'leave',
    'اجازة': 'leave',
    'missing punch': 'missing_punch',
    'missing_punch': 'missing_punch',
    'بصمة ناقصة': 'missing_punch',
    'بصمه ناقصه': 'missing_punch',
    'ناقص': 'missing_punch',
}

VALID_ATTENDANCE_STATUSES = ('present', 'absent', 'leave', 'missing_punch')

_EXCEL_EPOCH = date(1899, 12, 30)
_XLSX_NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


def normalize_key(value) -> str:
    """تطبيع نص للمقارنة (أعمدة / حالات) مع إزالة التشكيل والمسافات الزائدة."""
    text = str(value or '')
    text = text.replace('\ufeff', '').replace('\u200f', '').replace('\u200e', '')
    text = text.strip().lower()
    text = text.replace('_', ' ').replace('-', ' ').replace('.', ' ')
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


_HEADER_LOOKUP = {}
for _key, _aliases in HEADER_ALIASES.items():
    for _alias in _aliases:
        _HEADER_LOOKUP[normalize_key(_alias)] = _key


# ---------------------------------------------------------------------------
# تحويل التواريخ والأوقات
# ---------------------------------------------------------------------------

def parse_sheet_date(value):
    """تحويل قيمة تاريخ من الشيت (نص أو رقم إكسيل) إلى datetime.date."""
    if value is None or value == '':
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value

    text = str(value).strip()
    if not text:
        return None

    # إزالة الجزء الزمني إن وجد: "2026-11-09 00:00:00" / "2026-11-09T08:30"
    text = text.split('T')[0].split(' ')[0].strip()
    text = text.replace('\u200f', '').replace('\u200e', '')

    for fmt in (
        '%Y-%m-%d', '%Y/%m/%d', '%d/%m/%Y', '%d-%m-%Y', '%d/%m/%y', '%d-%m-%y',
        '%d.%m.%Y', '%Y.%m.%d', '%m/%d/%Y', '%d %B %Y', '%d %b %Y',
    ):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue

    # أرقام إكسيل التسلسلية (تاريخ اليوم كعدد صحيح).
    if re.fullmatch(r'\d+(\.\d+)?', text):
        try:
            serial = float(text)
        except ValueError:
            return None
        if 20000 < serial < 80000:
            return _EXCEL_EPOCH + timedelta(days=int(serial))
    return None


def parse_sheet_time(value):
    """تحويل قيمة وقت من الشيت (نص أو كسر إكسيل) إلى datetime.time."""
    if value is None or value == '':
        return None
    if isinstance(value, datetime):
        return value.time().replace(microsecond=0)
    if isinstance(value, time):
        return value.replace(microsecond=0)

    text = str(value).strip()
    if not text:
        return None
    text = text.replace('\u200f', '').replace('\u200e', '')

    # كسور إكسيل: 0.354166 = 08:30، و 45678.354166 = تاريخ + وقت.
    if re.fullmatch(r'\d+(\.\d+)?', text):
        try:
            number = float(text)
        except ValueError:
            return None
        fraction = number - int(number) if number >= 1 else number
        if 0 <= fraction < 1:
            total_seconds = int(round(fraction * 24 * 60 * 60))
            if total_seconds >= 24 * 60 * 60:
                total_seconds = 24 * 60 * 60 - 1
            return time(total_seconds // 3600, (total_seconds % 3600) // 60, total_seconds % 60)
        return None

    match = re.match(
        r'^(\d{1,2})\s*[:：]\s*(\d{1,2})(?:\s*[:：]\s*(\d{1,2}))?\s*([AaPp]\.?[Mm]\.?|ص|م|صباحا|مساء)?\s*$',
        text,
    )
    if not match:
        # صيغة مثل "8" أو "17" (ساعة فقط).
        hour_only = re.fullmatch(r'(\d{1,2})\s*([AaPp]\.?[Mm]\.?|ص|م)?', text)
        if not hour_only:
            return None
        hour = int(hour_only.group(1))
        minute = 0
        second = 0
        meridiem = (hour_only.group(2) or '').replace('.', '').lower()
    else:
        hour = int(match.group(1))
        minute = int(match.group(2))
        second = int(match.group(3) or 0)
        meridiem = (match.group(4) or '').replace('.', '').lower()

    if meridiem in ('pm', 'p', 'م', 'مساء'):
        if hour < 12:
            hour += 12
    elif meridiem in ('am', 'a', 'ص', 'صباحا'):
        if hour == 12:
            hour = 0

    if not (0 <= hour <= 23 and 0 <= minute <= 59 and 0 <= second <= 59):
        return None
    return time(hour, minute, second)


def normalize_status(value) -> str:
    """تطبيع حالة الحضور القادمة من الشيت إلى قيم النظام."""
    key = normalize_key(value)
    if not key:
        return ''
    return STATUS_ALIASES.get(key, '')


def month_bounds(value, today=None):
    """إرجاع أول وآخر يوم في الشهر المطلوب بصيغة YYYY-MM."""
    today = today or date.today()
    match = re.match(r'^(\d{4})-(\d{1,2})$', str(value or '').strip())
    if match:
        year, month = int(match.group(1)), int(match.group(2))
    else:
        year, month = today.year, today.month
    if not (1 <= month <= 12) or not (1900 <= year <= 2100):
        year, month = today.year, today.month

    start = date(year, month, 1)
    if month == 12:
        end = date(year, 12, 31)
    else:
        end = date(year, month + 1, 1) - timedelta(days=1)
    return start, end


# ---------------------------------------------------------------------------
# توليد قالب البصمة
# ---------------------------------------------------------------------------

def build_template_csv(settings, employees, month_start: date, month_end: date) -> str:
    """توليد قالب CSV فارغ (أوقات فارغة) لكل موظف في كل يوم عمل."""
    weekly_off = getattr(settings, 'weekly_off_day', '') or ''
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator='\n')
    writer.writerow(TEMPLATE_HEADERS)

    for employee in employees:
        code = (employee.employee_code or '').strip()
        name = (employee.name or '').strip()
        current = month_start
        while current <= month_end:
            if not weekly_off or current.strftime('%A') != weekly_off:
                writer.writerow([code, name, current.isoformat(), '', ''])
            current += timedelta(days=1)

    return '\ufeff' + buffer.getvalue()


# ---------------------------------------------------------------------------
# قراءة الشيتات (CSV / XLSX)
# ---------------------------------------------------------------------------

def _sniff_delimiter(text: str) -> str:
    sample_lines = [line for line in text.splitlines()[:20] if line.strip()][:10]
    sample = '\n'.join(sample_lines)
    if not sample:
        return ','
    try:
        return csv.Sniffer().sniff(sample, delimiters=',;\t|').delimiter
    except csv.Error:
        counts = {delimiter: sample.count(delimiter) for delimiter in (',', ';', '\t', '|')}
        best = max(counts, key=counts.get)
        return best if counts[best] > 0 else ','


def _read_csv(content: bytes):
    text = None
    for encoding in ('utf-8-sig', 'utf-8', 'cp1256', 'latin-1'):
        try:
            text = content.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        text = content.decode('utf-8', errors='replace')

    text = text.replace('\x00', '')
    if not text.strip():
        return []

    delimiter = _sniff_delimiter(text)
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    return [[cell for cell in row] for row in reader]


def _column_index(cell_ref: str) -> int:
    letters = ''.join(char for char in str(cell_ref or '') if char.isalpha())
    index = 0
    for char in letters.upper():
        index = index * 26 + (ord(char) - 64)
    return max(index - 1, 0)


def _read_xlsx(content: bytes):
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile:
        raise ValueError('ملف الإكسيل غير صالح أو تالف')

    with archive:
        names = set(archive.namelist())
        shared_strings = []
        if 'xl/sharedStrings.xml' in names:
            try:
                shared_root = ET.fromstring(archive.read('xl/sharedStrings.xml'))
            except ET.ParseError:
                raise ValueError('تعذر قراءة محتوى ملف الإكسيل')
            for item in shared_root.findall(f'{_XLSX_NS}si'):
                parts = [node.text or '' for node in item.iter(f'{_XLSX_NS}t')]
                shared_strings.append(''.join(parts))

        sheet_name = next(
            (
                name for name in sorted(names)
                if name.startswith('xl/worksheets/sheet') and name.endswith('.xml')
            ),
            None,
        )
        if not sheet_name:
            raise ValueError('الملف لا يحتوي على ورقة عمل صالحة')
        try:
            sheet_root = ET.fromstring(archive.read(sheet_name))
        except ET.ParseError:
            raise ValueError('تعذر قراءة محتوى ملف الإكسيل')

    sheet_data = sheet_root.find(f'{_XLSX_NS}sheetData')
    if sheet_data is None:
        return []

    rows = []
    for row_element in sheet_data.findall(f'{_XLSX_NS}row'):
        cells = {}
        for cell in row_element.findall(f'{_XLSX_NS}c'):
            column = _column_index(cell.get('r'))
            cell_type = cell.get('t') or ''
            if cell_type == 'inlineStr':
                text = ''.join(node.text or '' for node in cell.iter(f'{_XLSX_NS}t'))
            else:
                value_element = cell.find(f'{_XLSX_NS}v')
                raw = value_element.text if value_element is not None else ''
                if cell_type == 's' and raw:
                    try:
                        text = shared_strings[int(raw)]
                    except (ValueError, IndexError):
                        text = ''
                elif cell_type == 'e':
                    text = ''
                else:
                    text = raw or ''
            if text != '':
                cells[column] = text
        if not cells:
            rows.append([])
            continue
        width = max(cells) + 1
        rows.append([cells.get(index, '') for index in range(width)])
    return rows


def read_sheet_rows(filename: str, content: bytes):
    """قراءة صفوف الشيت الخام من ملف CSV أو XLSX."""
    if not content:
        raise ValueError('الملف المرفوع فارغ')

    name = str(filename or '').lower()
    if name.endswith('.xlsx') or name.endswith('.xlsm'):
        return _read_xlsx(content)
    if name.endswith('.xls'):
        raise ValueError('صيغة XLS القديمة غير مدعومة. يرجى حفظ الشيت بصيغة CSV أو XLSX.')
    return _read_csv(content)


def _clean_code(value) -> str:
    text = str(value or '').strip()
    text = text.replace('\u200f', '').replace('\u200e', '')
    if re.fullmatch(r'\d+\.0+', text):
        text = text.split('.')[0]
    return text


def _find_header(rows):
    """تحديد صف العناوين وأعمدة الشيت المعروفة."""
    for index, row in enumerate(rows[:12]):
        mapping = {}
        for column, cell in enumerate(row):
            key = _HEADER_LOOKUP.get(normalize_key(cell))
            if key and key not in mapping:
                mapping[key] = column
        if 'employee_code' in mapping and ('date' in mapping or 'check_in' in mapping):
            return index, mapping

    # شيت بدون عناوين: نفترض الترتيب القياسي (كود، اسم، تاريخ، حضور، انصراف).
    return -1, {
        'employee_code': 0,
        'employee_name': 1,
        'date': 2,
        'check_in': 3,
        'check_out': 4,
    }


def parse_attendance_sheet(filename: str, content: bytes):
    """
    تحليل شيت البصمة وإرجاع الصفوف الصالحة مع الأخطاء والصفوف المتجاهلة.

    Returns dict(rows, errors, skipped, total_rows).
    """
    raw_rows = read_sheet_rows(filename, content)
    if not raw_rows:
        raise ValueError('الملف فارغ أو غير قابل للقراءة')

    header_index, columns = _find_header(raw_rows)
    errors = []
    rows = []
    skipped = 0

    for offset, raw in enumerate(raw_rows[header_index + 1:], start=header_index + 2):
        if not any(str(cell).strip() for cell in raw):
            continue

        def cell(key):
            column = columns.get(key)
            if column is None or column >= len(raw):
                return ''
            return raw[column]

        code = _clean_code(cell('employee_code'))
        name = str(cell('employee_name') or '').strip()
        if not code and not name:
            skipped += 1
            continue

        work_date = parse_sheet_date(cell('date'))
        if not work_date:
            errors.append({'row': offset, 'message': 'التاريخ غير صحيح أو مفقود'})
            continue

        check_in = parse_sheet_time(cell('check_in'))
        check_out = parse_sheet_time(cell('check_out'))
        status = normalize_status(cell('status'))

        if not check_in and not check_out and not status:
            # صف موجود في القالب بدون بصمات (لم يُسجل حضور بعد) — يتم تجاهله.
            skipped += 1
            continue

        rows.append({
            'row': offset,
            'employee_code': code,
            'employee_name': name,
            'date': work_date,
            'check_in': check_in,
            'check_out': check_out,
            'status': status,
        })

    return {
        'rows': rows,
        'errors': errors,
        'skipped': skipped,
        'total_rows': len(raw_rows),
    }


# ---------------------------------------------------------------------------
# احتساب التأخير / الانصراف المبكر / الغياب
# ---------------------------------------------------------------------------

def _minutes_between(start: time, end: time) -> float:
    return max(
        0.0,
        (end.hour * 60 + end.minute + end.second / 60.0)
        - (start.hour * 60 + start.minute + start.second / 60.0),
    )


def _match_rule(rules, violation_type: str, minutes: float):
    """اختيار أنسب قاعدة مطابقة للمخالفة (الأكثر تحديداً)."""
    best = None
    for rule in rules or []:
        if not isinstance(rule, dict):
            continue
        if rule.get('violation_type') != violation_type:
            continue
        if violation_type == 'absence':
            return rule

        try:
            from_minutes = float(rule.get('from_minutes') or 0)
        except (TypeError, ValueError):
            from_minutes = 0
        raw_to = rule.get('to_minutes')
        try:
            to_minutes = float(raw_to) if raw_to not in (None, '') else None
        except (TypeError, ValueError):
            to_minutes = None

        if minutes < from_minutes:
            continue
        if to_minutes is not None and minutes > to_minutes:
            continue
        if best is None or from_minutes > best[0]:
            best = (from_minutes, rule)
    return best[1] if best else None


def _apply_rule(rules, violation_type: str, minutes: float, totals) -> bool:
    """تطبيق قاعدة خصم وإرجاع True إذا كانت تتطلب مراجعة يدوية."""
    rule = _match_rule(rules, violation_type, minutes)
    if not rule:
        return False
    try:
        value = float(rule.get('deduction_value') or 0)
    except (TypeError, ValueError):
        value = 0.0
    if value <= 0:
        return False

    if rule.get('deduction_type') == 'days':
        totals['days'] += value
    else:
        totals['hours'] += value
    return str(rule.get('apply_mode') or 'auto') == 'manual_review'


def compute_attendance(settings, employee, work_date, check_in, check_out, status_override=''):
    """
    احتساب حالة الحضور والخصومات لموظف في يوم واحد.

    Returns dict(status, late_minutes, early_minutes, deduction_days,
                 deduction_hours, review_status).
    """
    official_start = getattr(settings, 'official_start_time', None) or time(8, 30)
    official_end = getattr(settings, 'official_end_time', None) or time(17, 30)

    status = (status_override or '').strip()
    if status not in VALID_ATTENDANCE_STATUSES:
        if check_in and check_out:
            status = 'present'
        elif check_in or check_out:
            status = 'missing_punch'
        else:
            status = 'absent'

    late_minutes = 0
    early_minutes = 0
    if status == 'present':
        if check_in and check_in > official_start:
            late_minutes = int(round(_minutes_between(official_start, check_in)))
        if check_out and check_out < official_end:
            early_minutes = int(round(_minutes_between(check_out, official_end)))

    totals = {'days': 0.0, 'hours': 0.0}
    manual_review = getattr(employee, 'rule_application_mode', 'auto') == 'manual_review'
    rules = getattr(settings, 'rules_json', None) or []

    if status == 'absent':
        manual_review = _apply_rule(rules, 'absence', 0, totals) or manual_review
    elif status == 'present':
        if late_minutes > 0:
            manual_review = _apply_rule(rules, 'late_arrival', late_minutes, totals) or manual_review
        if early_minutes > 0:
            manual_review = _apply_rule(rules, 'early_departure', early_minutes, totals) or manual_review
    elif status == 'missing_punch':
        # البصمة الناقصة تحتاج تدخل الموارد البشرية دائماً.
        manual_review = True

    deduction_days = round(totals['days'], 2)
    deduction_hours = round(totals['hours'], 2)

    if manual_review and status in ('missing_punch', 'absent'):
        review_status = 'pending_review'
    elif manual_review and (deduction_days or deduction_hours):
        review_status = 'pending_review'
    else:
        review_status = 'auto_applied'

    return {
        'status': status,
        'late_minutes': late_minutes,
        'early_minutes': early_minutes,
        'deduction_days': deduction_days,
        'deduction_hours': deduction_hours,
        'review_status': review_status,
    }
