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
from django.utils import timezone

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

# تحويل اسم يوم الإجازة الأسبوعية (من إعدادات الحضور) إلى رقم date.weekday()
# حيث الإثنين = 0 ... الأحد = 6. الافتراضي هو الأحد.
WEEKLY_OFF_DAY_INDEX = {
    'monday': 0,
    'tuesday': 1,
    'wednesday': 2,
    'thursday': 3,
    'friday': 4,
    'saturday': 5,
    'sunday': 6,
    # أسماء عربية (احتياط) بنفس الترتيب.
    'الإثنين': 0, 'الاثنين': 0,
    'الثلاثاء': 1,
    'الأربعاء': 2, 'الاربعاء': 2,
    'الخميس': 3,
    'الجمعة': 4,
    'السبت': 5,
    'الأحد': 6, 'الاحد': 6,
}

DEFAULT_WEEKLY_OFF_WEEKDAY = 6  # الأحد


def weekly_off_weekday(settings, default=DEFAULT_WEEKLY_OFF_WEEKDAY):
    """رقم يوم الإجازة الأسبوعية المدفوعة وفق date.weekday() (الإثنين=0 ... الأحد=6)."""
    raw = str(getattr(settings, 'weekly_off_day', '') or '').strip()
    if not raw:
        return default
    if raw in WEEKLY_OFF_DAY_INDEX:
        return WEEKLY_OFF_DAY_INDEX[raw]
    return WEEKLY_OFF_DAY_INDEX.get(raw.lower(), default)

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
    text = text.replace('\u200f', '').replace('\u200e', '')

    # جرّب الصيغ المحتوية على مسافات أولاً مثل "15 May 2026" أو "15-May-2026" قبل القص عند المسافة.
    for spaced_fmt in ('%d %B %Y', '%d %b %Y', '%B %d, %Y', '%b %d, %Y', '%d-%b-%Y', '%d-%B-%Y'):
        try:
            return datetime.strptime(text, spaced_fmt).date()
        except ValueError:
            continue

    # إزالة الجزء الزمني إن وجد: "2026-11-09 00:00:00" / "2026-11-09T08:30"
    text = text.split('T')[0].split(' ')[0].strip()

    for fmt in (
        '%Y-%m-%d', '%Y/%m/%d', '%d/%m/%Y', '%d-%m-%Y', '%d/%m/%y', '%d-%m-%y',
        '%d.%m.%Y', '%Y.%m.%d', '%m/%d/%Y',
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

    # دعم السلاسل المحتوية على تاريخ + وقت مثل "2026-11-09 08:30:00" أو "2026-11-09T08:30:00".
    dt_match = re.match(r'^\d{4}[-/]\d{1,2}[-/]\d{1,2}[T\s]+(.+)$', text)
    if dt_match:
        text = dt_match.group(1).strip()

    # أرقام صحيحة من خانة أو خانتين مثل "8" أو "17" تعني الساعة (08:00 / 17:00) وليس منتصف الليل.
    if re.fullmatch(r'\d{1,2}', text):
        hour_int = int(text)
        if 0 <= hour_int <= 23:
            return time(hour_int, 0, 0)
        return None

    # كسور إكسيل (عشرية أو ترميز علمي مثل 1.5e-5): 0.354166 = 08:30، و 45678.354166 = تاريخ + وقت.
    if re.fullmatch(r'\d+(?:\.\d+)?(?:[eE][+-]?\d+)?', text) and ('.' in text or 'e' in text.lower()):
        try:
            number = float(text)
        except ValueError:
            return None
        if number < 0:
            return None
        fraction = number - int(number) if number >= 1 else number
        if 0 <= fraction < 1:
            total_seconds = int(round(fraction * 24 * 60 * 60))
            if total_seconds >= 24 * 60 * 60:
                total_seconds = 24 * 60 * 60 - 1
            return time(total_seconds // 3600, (total_seconds % 3600) // 60, total_seconds % 60)
        return None

    match = re.match(
        r'^(\d{1,2})\s*[:：]\s*(\d{1,2})(?:\s*[:：]\s*(\d{1,2}))?\s*([AaPp]\.?[Mm]\.?|ص|م|صباحا|صباحاً|مساء|مساءً)?\s*$',
        text,
    )
    if not match:
        # صيغة مثل "8" أو "17" (ساعة فقط).
        hour_only = re.fullmatch(r'(\d{1,2})\s*([AaPp]\.?[Mm]\.?|ص|م|صباحا|صباحاً|مساء|مساءً)?', text)
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

    if meridiem in ('pm', 'p', 'م', 'مساء', 'مساءً'):
        if hour < 12:
            hour += 12
    elif meridiem in ('am', 'a', 'ص', 'صباحا', 'صباحاً'):
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
    """إرجاع أول وآخر يوم في الشهر المطلوب بصيغة YYYY-MM أو ككائن تاريخ."""
    today = today or date.today()
    if isinstance(value, datetime):
        value = value.date()
    if isinstance(value, date):
        value = f'{value.year}-{value.month}'
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
    off_weekday = weekly_off_weekday(settings)
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator='\n')
    writer.writerow(TEMPLATE_HEADERS)

    for employee in employees:
        code = (employee.employee_code or '').strip()
        name = (employee.name or '').strip()
        current = month_start
        while current <= month_end:
            if current.weekday() != off_weekday:
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
        # حماية ضد هجمات قنابل الضغط (ZIP Bomb): الحد الأقصى للحجم غير المضغوط 25 ميجابايت.
        total_uncompressed = sum(info.file_size for info in archive.infolist())
        if total_uncompressed > 25 * 1024 * 1024:
            raise ValueError('حجم محتوى ملف الإكسيل بعد فك الضغط يتجاوز الحد الآمن المسموح (25 ميجابايت)')
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

    # دمج صفوف البصمة المنفصلة لنفس الموظف في نفس اليوم (مثلاً صف للحضور وصف للانصراف).
    merged_by_key = {}
    merged_order = []
    for item in rows:
        emp_key = (
            item['employee_code'].casefold()
            if item['employee_code']
            else ' '.join(item['employee_name'].split()).casefold()
        )
        key = (emp_key, item['date'])
        existing = merged_by_key.get(key)
        if existing is None:
            merged_by_key[key] = dict(item)
            merged_order.append(key)
            continue

        # جمع كل البصمات المتاحة لهذا اليوم (أقدم بصمة = حضور، أحدث بصمة = انصراف، حتى مع 3+ بصمات).
        all_times = [
            t for t in (existing['check_in'], existing['check_out'], item['check_in'], item['check_out'])
            if t is not None
        ]
        if len(all_times) >= 2:
            earliest = min(all_times)
            latest = max(all_times)
            existing['check_in'] = earliest
            existing['check_out'] = latest if latest != earliest else existing['check_out']
        elif len(all_times) == 1:
            existing['check_in'] = existing['check_in'] or item['check_in']
            existing['check_out'] = existing['check_out'] or item['check_out']

        if item['status'] and (not existing['status'] or existing['status'] == 'missing_punch'):
            existing['status'] = item['status']
        if item['employee_name'] and not existing['employee_name']:
            existing['employee_name'] = item['employee_name']

    merged_rows = [merged_by_key[key] for key in merged_order]

    return {
        'rows': merged_rows,
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
    """اختيار أنسب قاعدة مطابقة للمخالفة (الأكثر تحديداً).

    - المطابقة شاملة للحدين: ``from_minutes <= minutes <= to_minutes``.
    - إذا تجاوزت الدقائق كل شرائح التأخير/الانصراف المبكر، تُطبَّق القاعدة
      الأعلى (الأكبر ``to_minutes``) بدلاً من تجاهل الخصم بصمت.
    - إذا كانت الدقائق أقل من كل الشرائح فلا خصم.
    """
    candidates = []
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
        candidates.append((from_minutes, to_minutes, rule))

    if not candidates:
        return None

    best = None
    for from_minutes, to_minutes, rule in candidates:
        if minutes < from_minutes:
            continue
        if to_minutes is not None and minutes > to_minutes:
            continue
        if best is None or from_minutes > best[0]:
            best = (from_minutes, rule)
    if best:
        return best[1]

    # لا توجد شريحة مطابقة مباشرة:
    # 1) إذا وقعت الدقائق في فجوة بين شريحتين (أقل من أعلى حد أقصى)، نطبّق أقرب شريحة سابقة (أكبر to_minutes < minutes)
    #    بدلاً من القفز إلى أقصى عقوبة.
    # 2) إذا تجاوزت الدقائق أعلى شريحة مسجلة، نطبّق الشريحة الأعلى.
    min_from = min((from_min for from_min, _to, _rule in candidates), default=None)
    if min_from is not None and minutes >= min_from:
        lower_tiers = [
            item for item in candidates
            if item[1] is not None and item[1] < minutes
        ]
        higher_tiers = [
            item for item in candidates
            if item[0] > minutes
        ]
        if lower_tiers and higher_tiers:
            # وقعت في فجوة بين شريحة أقل وشريحة أعلى → طبّق أقرب شريحة أقل.
            closest_lower = max(lower_tiers, key=lambda item: (item[1], item[0]))
            return closest_lower[2]
        # تجاوزت كل الشرائح → طبّق أعلى شريحة.
        highest = max(
            candidates,
            key=lambda item: (
                item[1] if item[1] is not None else float('inf'),
                item[0],
            ),
        )
        return highest[2]
    return None


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


def effective_absence_decision(record) -> str:
    """قرار الغياب الفعلي للسجل مع التوافق الكامل مع السجلات القديمة."""
    if record is None:
        return 'unexcused'
    decision = str(getattr(record, 'absence_decision', '') or '').strip()
    if decision in ('unexcused', 'excused_unpaid', 'paid_company'):
        return decision
    if getattr(record, 'is_excused', False):
        return 'paid_company'
    return 'unexcused'


def is_attended_record(record) -> bool:
    """
    هل يُعد السجل حضوراً مدفوعاً (مؤقتاً أو مؤكداً)؟
    - حاضر (present)
    - غياب/إجازة بقرار «على حساب الشركة (مدفوع)» (paid_company)
    - أي بصمة واحدة (check_in أو check_out)، بما يشمل البصمة الناقصة كحضور مؤقت لحين قرار المشرف.
    """
    if record is None:
        return False
    status = getattr(record, 'status', '') or ''
    if status == 'present':
        return True
    if status in ('absent', 'leave'):
        return effective_absence_decision(record) == 'paid_company'
    if getattr(record, 'check_in', None) or getattr(record, 'check_out', None):
        return True
    return bool(getattr(record, 'is_excused', False))


def is_excused_unpaid_record(record) -> bool:
    """غياب بعذر (خصم اليوم فقط دون جزاء إضافي، ويدخل الآن في عدّاد خصم الإجازة الأسبوعية)."""
    if record is None or is_attended_record(record):
        return False
    status = getattr(record, 'status', '') or ''
    if status in ('absent', 'leave'):
        return effective_absence_decision(record) == 'excused_unpaid'
    return False


def is_pending_absence_record(record) -> bool:
    """غياب معلّق بدون قرار مسؤول (يُعامل كغياب بعذر لصالح العامل عند الحساب ويدخل في عدّاد الأحد)."""
    if record is None or is_attended_record(record):
        return False
    status = getattr(record, 'status', '') or ''
    if status in ('absent', 'leave'):
        raw_decision = str(getattr(record, 'absence_decision', '') or '').strip()
        review_status = str(getattr(record, 'review_status', '') or '').strip()
        if not raw_decision and not getattr(record, 'is_excused', False):
            return True
        if review_status == 'pending_review':
            return True
    return False


def is_unexcused_absence_record(record) -> bool:
    """غياب بدون عذر (يدخل في خصم الإجازة الأسبوعية ويستوجب جزاء الغياب الإضافي بعد الاعتماد)."""
    if record is None:
        return True
    if is_attended_record(record):
        return False
    return not is_excused_unpaid_record(record)


def is_absence_for_weekly_off(record) -> bool:
    """
    هل يُحتسب اليوم ضمن عدّاد خصم يوم الإجازة الأسبوعية (الأحد)؟
    وفق القاعدة النهائية المعتمدة (بنود 9، 10، 12):
    جميع أيام الغياب (بدون عذر + بعذر + الغياب المعلّق) تدخل في عدّاد خصم يوم الإجازة،
    ولا يُستثنى منها إلا الحضور الفعلي أو الإجازة المدفوعة على حساب الشركة أو البصمة الناقصة.
    """
    return not is_attended_record(record)


def employee_shift_times(settings, employee=None):
    """إرجاع (بداية الوردية، نهاية الوردية) للموظف مع fallback للإعدادات العامة (الافتراضي 08:00–17:00)."""
    emp_start = getattr(employee, 'shift_start_time', None) if employee is not None else None
    emp_end = getattr(employee, 'shift_end_time', None) if employee is not None else None
    official_start = emp_start or getattr(settings, 'official_start_time', None) or time(8, 0)
    official_end = emp_end or getattr(settings, 'official_end_time', None) or time(17, 0)
    return official_start, official_end


def compute_worked_hours(check_in, check_out, official_start=None, official_end=None):
    """احتساب عدد ساعات العمل الفعلية بين بصمتي الحضور والانصراف (مع دعم الورديات الليلية)."""
    ci = _clock_minutes(check_in)
    co = _clock_minutes(check_out)
    if ci is None or co is None:
        return None
    eff_in = ci
    eff_out = co
    start_m = _clock_minutes(official_start) if official_start else None
    end_m = _clock_minutes(official_end) if official_end else None
    if start_m is not None and end_m is not None and end_m <= start_m:
        if eff_in < start_m - 360:
            eff_in += 1440
        if eff_out <= start_m:
            eff_out += 1440
    if eff_out < eff_in:
        eff_out += 1440
    diff_mins = max(0.0, eff_out - eff_in)
    return round(diff_mins / 60.0, 4)


def absence_extra_penalty_days(rules) -> float:
    """
    أيام الجزاء الإضافية للغياب بدون عذر (فوق يوم الغياب نفسه المخصوم من earnedDays).
    - إذا ضُبطت قاعدة absence بـ N أيام (مثلاً 2 يوم): الجزاء الإضافي = max(1.0, N - 1.0) = 1.0
      ليصبح إجمالي الخصم = 1 (غياب) + 1 (جزاء) = يومين بالضبط.
    - الحد الأدنى للجزاء الإضافي على الغياب بدون عذر = 1.0 يوم.
    """
    rule = _match_rule(rules, 'absence', 0)
    if rule and rule.get('deduction_type') == 'days':
        try:
            rule_days = float(rule.get('deduction_value') or 0)
        except (TypeError, ValueError):
            rule_days = 0.0
        return round(max(1.0, rule_days - 1.0), 2)
    return 1.0


def weekly_off_ratio_for_absences(absent_count: int) -> float:
    """
    نسبة خصم يوم الإجازة الأسبوعية وفق الشرائح الخمس الرسمية:
      0 أو 1 يوم غياب بدون عذر -> 0
      2 يوم                     -> 1/3
      3 أيام                    -> 1/2
      4 أيام                    -> 2/3
      5 أو 6 أيام               -> 1.0
    """
    if absent_count >= 5:
        return 1.0
    if absent_count == 4:
        return 2.0 / 3.0
    if absent_count == 3:
        return 0.5
    if absent_count == 2:
        return 1.0 / 3.0
    return 0.0


def eligible_week_dates(week_dates, hire_date=None, termination_date=None):
    """تصفية أيام الأسبوع الستة لتشمل فقط الأيام الواقعة ضمن فترة عمل الموظف."""
    result = []
    for day in week_dates:
        if hire_date and day < hire_date:
            continue
        if termination_date and day > termination_date:
            continue
        result.append(day)
    return result


def compute_attendance(settings, employee, work_date, check_in, check_out,
                       status_override='', absence_decision=''):
    """
    احتساب حالة الحضور والخصومات لموظف في يوم واحد.

    Returns dict(status, late_minutes, early_minutes, deduction_days,
                 deduction_hours, review_status).
    """
    official_start, official_end = employee_shift_times(settings, employee)

    status = (status_override or '').strip()
    if status not in VALID_ATTENDANCE_STATUSES:
        if check_in and check_out:
            status = 'present'
        elif check_in or check_out:
            status = 'missing_punch'
        else:
            status = 'absent'
    elif check_in and status in ('absent', 'leave'):
        # أي يوم له بصمة حضور فعلية يُعدّ حضوراً، حتى لو كان مُعلّماً كغياب/إجازة.
        status = 'present' if check_out else 'missing_punch'

    late_minutes = 0
    early_minutes = 0
    # تُحتسب دقائق التأخير/الانصراف المبكر متى وُجدت بصمة فعلية (حضور أو بصمة ناقصة).
    # ندعم الورديات العابرة لمنتصف الليل (مثل 22:00 → 06:00 أو انصراف إضافي بعد 00:00).
    if status in ('present', 'missing_punch') and (check_in or check_out):
        check_in_minutes = _clock_minutes(check_in)
        check_out_minutes = _clock_minutes(check_out)
        start_minutes = _clock_minutes(official_start)
        end_minutes = _clock_minutes(official_end)
        if start_minutes is not None and end_minutes is not None:
            is_overnight_shift = end_minutes <= start_minutes
            eff_end = end_minutes + 1440 if is_overnight_shift else end_minutes

            eff_in = check_in_minutes
            if eff_in is not None and is_overnight_shift and eff_in < start_minutes - 360:
                eff_in += 1440

            eff_out = check_out_minutes
            if eff_out is not None:
                if is_overnight_shift and eff_out <= start_minutes:
                    eff_out += 1440
                elif not is_overnight_shift and eff_in is not None and eff_out < eff_in:
                    # وردية نهارية استمرت لما بعد منتصف الليل (مثلاً حضور 08:30 وانصراف 00:30).
                    eff_out += 1440

            if eff_in is not None and eff_in > start_minutes:
                late_minutes = int(round(eff_in - start_minutes))
            if eff_out is not None and eff_out < eff_end:
                early_minutes = int(round(eff_end - eff_out))

    totals = {'days': 0.0, 'hours': 0.0}
    manual_review = getattr(employee, 'rule_application_mode', 'auto') == 'manual_review'
    rules = getattr(settings, 'rules_json', None) or []
    decision = str(absence_decision or '').strip()

    if status in ('absent', 'leave'):
        if decision in ('excused_unpaid', 'paid_company'):
            # غياب بعذر (خصم اليوم فقط) أو على حساب الشركة (مدفوع): لا جزاء إضافي.
            totals['days'] = 0.0
            totals['hours'] = 0.0
            manual_review = False
        else:
            # غياب بدون عذر (أو بدون قرار بعد): يوم جزاء إضافي على الأقل فوق يوم الغياب نفسه.
            totals['days'] += absence_extra_penalty_days(rules)
            rule = _match_rule(rules, 'absence', 0)
            if rule and str(rule.get('apply_mode') or 'auto') == 'manual_review':
                manual_review = True
            if not decision:
                # سجل غياب لم يحسم المشرف قراره بعد -> يظهر في "يحتاج قرار المشرف".
                manual_review = True
    elif status in ('present', 'missing_punch'):
        # تُطبّق قواعد التأخير/الانصراف المبكر على أي يوم له بصمة فعلية.
        if late_minutes > 0:
            manual_review = _apply_rule(rules, 'late_arrival', late_minutes, totals) or manual_review
        if early_minutes > 0:
            manual_review = _apply_rule(rules, 'early_departure', early_minutes, totals) or manual_review
        if status == 'missing_punch':
            # البصمة الناقصة تُحسب حضوراً مؤقتاً وتحتاج قرار المشرف دائماً.
            manual_review = True

    deduction_days = round(totals['days'], 2)
    deduction_hours = round(totals['hours'], 2)

    if status in ('absent', 'leave') and decision in ('unexcused', 'excused_unpaid', 'paid_company'):
        review_status = 'approved'
    elif manual_review and status in ('missing_punch', 'absent'):
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


# ---------------------------------------------------------------------------
# العمل الإضافي وخصم يوم الإجازة الأسبوعية
# ---------------------------------------------------------------------------

def _clock_minutes(value):
    """تحويل قيمة وقت ('17:00' أو time) إلى دقائق، وإرجاع None إذا تعذّر التحويل."""
    if value is None or value == '':
        return None
    if isinstance(value, time):
        return value.hour * 60 + value.minute + value.second / 60.0
    text = str(value).strip()
    if not text:
        return None
    parts = text.split(':')
    try:
        hours = int(parts[0])
        minutes = int(parts[1]) if len(parts) > 1 else 0
    except (TypeError, ValueError):
        return None
    return hours * 60 + minutes


def working_hours_per_day(settings, employee=None) -> float:
    """احتساب ساعات العمل اليومية ديناميكياً من مواعيد وردية الموظف أو الإعدادات العامة."""
    emp_start = getattr(employee, 'shift_start_time', None) if employee is not None else None
    emp_end = getattr(employee, 'shift_end_time', None) if employee is not None else None
    if not emp_start and not emp_end and settings is not None and hasattr(settings, 'working_hours_per_day'):
        try:
            val = float(settings.working_hours_per_day)
            if val > 0:
                return val
        except (TypeError, ValueError):
            pass
    official_start, official_end = employee_shift_times(settings, employee)
    start_m = _clock_minutes(official_start)
    end_m = _clock_minutes(official_end)
    if start_m is None or end_m is None:
        return 9.0
    diff = end_m - start_m
    if diff <= 0:
        diff += 1440
    hours = round(diff / 60.0, 4)
    return hours if hours > 0 else 9.0


def compute_overtime(settings, check_out, check_in=None, employee=None):
    """
    احتساب العمل الإضافي من بصمة الانصراف وفق قواعد الإضافي الديناميكية.

    يدعم كلا النوعين من الشرائح:
    - شرائح نسبية مربوطة بموعد نهاية وردية الموظف (`offset_from_minutes` / `offset_to_minutes`).
    - شرائح ساعات ثابتة (`from_time` / `to_time`) للتوافق الكامل مع الإعدادات القائمة.
    مع دعم الورديات الليلية التي تعبر منتصف الليل.

    Returns dict(overtime_days, overtime_hours, overtime_label).
    """
    empty = {'overtime_days': 0.0, 'overtime_hours': 0.0, 'overtime_label': ''}
    if not check_out:
        return empty

    rules = getattr(settings, 'overtime_rules', None) or []
    check_out_minutes = _clock_minutes(check_out)
    if check_out_minutes is None:
        return empty

    official_start, official_end = employee_shift_times(settings, employee)
    start_minutes = _clock_minutes(official_start) or 0
    end_minutes = _clock_minutes(official_end) or 0
    is_overnight_shift = end_minutes <= start_minutes
    eff_shift_end = end_minutes + 1440 if is_overnight_shift else end_minutes
    check_in_minutes = _clock_minutes(check_in)

    eff_out = check_out_minutes
    if is_overnight_shift and eff_out <= start_minutes:
        eff_out += 1440
    elif not is_overnight_shift and (
        (check_in_minutes is not None and eff_out < check_in_minutes)
        or (check_in_minutes is None and eff_out < start_minutes)
    ):
        eff_out += 1440

    best = None
    highest_reached = None
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        raw_offset_from = rule.get('offset_from_minutes')
        raw_offset_to = rule.get('offset_to_minutes')
        if raw_offset_from not in (None, ''):
            try:
                eff_from = eff_shift_end + float(raw_offset_from)
            except (TypeError, ValueError):
                continue
            if raw_offset_to not in (None, ''):
                try:
                    eff_to = eff_shift_end + float(raw_offset_to)
                except (TypeError, ValueError):
                    eff_to = None
            else:
                eff_to = None
        else:
            from_minutes = _clock_minutes(rule.get('from_time'))
            if from_minutes is None:
                continue
            to_minutes = _clock_minutes(rule.get('to_time'))

            # تطبيع شريحة الإضافي لعبور منتصف الليل عند الحاجة.
            eff_from = from_minutes
            eff_to = to_minutes
            if is_overnight_shift and eff_from <= start_minutes:
                eff_from += 1440
            elif not is_overnight_shift and eff_from < start_minutes:
                eff_from += 1440
            if eff_to is not None:
                if eff_to <= eff_from:
                    eff_to += 1440
                elif eff_to < start_minutes and eff_from >= 1440:
                    eff_to += 1440

        if eff_out < eff_from:
            continue
        if highest_reached is None or eff_from > highest_reached[0]:
            highest_reached = (eff_from, rule)
        if eff_to is not None and eff_out > eff_to:
            continue
        if best is None or eff_from > best[0]:
            best = (eff_from, rule)

    # إذا تجاوز وقت الانصراف أعلى شريحة إضافي، تُمنح الشريحة الأعلى بدلاً من ضياع الإضافي (صفر).
    chosen = best or highest_reached
    if not chosen:
        return empty

    rule = chosen[1]
    try:
        value = float(rule.get('reward_value') or 0)
    except (TypeError, ValueError):
        value = 0.0
    if value <= 0:
        return empty

    if rule.get('reward_type') == 'hours':
        return {
            'overtime_days': 0.0,
            'overtime_hours': round(value, 2),
            'overtime_label': f'{value:g} ساعة',
        }
    return {
        'overtime_days': round(value, 2),
        'overtime_hours': 0.0,
        'overtime_label': f'{value:g} يوم',
    }


def sunday_deduction_for_week(records_by_date, week_dates, hire_date=None, termination_date=None):
    """
    احتساب خصم يوم الإجازة الأسبوعية وفق إجمالي عدد أيام الغياب (بدون عذر + بعذر + معلّق)
    خلال أيام العمل الستة السابقة له ضمن فترة عمل الموظف:

      0 أو 1 يوم -> 0 (بدون خصم)
      2 يوم      -> ثلث يوم (1/3)
      3 أيام     -> نصف يوم (1/2)
      4 أيام     -> ثلثي يوم (2/3)
      5 أو 6 أيام -> يوم كامل (1)

    Returns dict(sunday_deduction_days, sunday_deduction_note).
    """
    empty = {'sunday_deduction_days': 0.0, 'sunday_deduction_note': ''}
    scoped_dates = eligible_week_dates(week_dates, hire_date=hire_date, termination_date=termination_date)
    if not scoped_dates:
        return empty
    absent_dates = []
    for day in scoped_dates:
        record = records_by_date.get(day)
        if is_absence_for_weekly_off(record):
            absent_dates.append(day)

    count = len(absent_dates)
    ratio = weekly_off_ratio_for_absences(count)
    if ratio <= 0:
        return empty
    if count >= 5:
        label = 'يوم الإجازة كاملاً'
    elif count == 4:
        label = 'ثلثي يوم الإجازة'
    elif count == 3:
        label = 'نصف يوم الإجازة'
    else:
        label = 'ثلث يوم الإجازة'

    dates_text = '، '.join(day.isoformat() for day in absent_dates)
    note = f'خصم {label} بسبب غياب في أيام: {dates_text}'
    return {
        'sunday_deduction_days': round(ratio, 2),
        'sunday_deduction_note': note,
    }


def _week_dates_before(off_date):
    """أيام العمل الستة التي تسبق يوم الإجازة الأسبوعية."""
    return [off_date - timedelta(days=offset) for offset in range(6, 0, -1)]


def reapply_employee_month(settings, employee, month_start, month_end, preserve_decisions=True):
    """
    إعادة تطبيق قواعد الحضور والإضافي وخصم الإجازة الأسبوعية على كل سجلات موظف في شهر.

    تُستخدم عند رفع الشيت وتعديل/حذف سجل والضغط على "إعادة تطبيق القواعد".
    عند preserve_decisions=True تُحفظ قرارات المراجعة اليدوية (approved/rejected)
    وكذلك الخصم اليدوي (manual_deduction=True) مع تحديث الإضافي وخصم الإجازة الأسبوعية.
    تحذف سجل الأحد الشبح المُنشأ تلقائياً إذا لم تعد توجد سجلات عمل في الأسبوع.
    ترجع عدد السجلات التي تغيّرت.
    """
    from .models import HRAttendanceRecord

    weekly_off_index = weekly_off_weekday(settings)
    hire_date = getattr(employee, 'hire_date', None)
    termination_date = getattr(employee, 'termination_date', None)

    lookup_start = month_start - timedelta(days=6)
    all_records = list(
        HRAttendanceRecord.objects.filter(
            employee=employee,
            date__gte=lookup_start,
            date__lte=month_end,
        )
    )
    records = [record for record in all_records if month_start <= record.date <= month_end]
    records_by_date = {record.date: record for record in all_records}
    changed = 0

    for record in records:
        is_weekly_off = record.date.weekday() == weekly_off_index
        worked_weekly_off = is_weekly_off and bool(record.check_in)

        # حذف سجل يوم الإجازة الشبح المُنشأ تلقائياً إذا لم تعد هناك أي سجلات في الأسبوع أو كان خارج فترة التوظيف.
        is_auto_weekly_off_placeholder = (
            is_weekly_off
            and not record.check_in
            and not record.check_out
            and record.status == 'leave'
            and record.is_excused
            and not (record.excuse_note or '').strip()
        )
        if is_auto_weekly_off_placeholder:
            outside_employment = bool(
                (hire_date and record.date < hire_date)
                or (termination_date and record.date > termination_date)
            )
            scoped_week = eligible_week_dates(
                _week_dates_before(record.date),
                hire_date=hire_date,
                termination_date=termination_date,
            )
            has_week_data = any(day in records_by_date for day in scoped_week)
            if outside_employment or not has_week_data:
                records_by_date.pop(record.date, None)
                record.delete()
                changed += 1
                continue

        decision = str(getattr(record, 'absence_decision', '') or '').strip()
        computed = compute_attendance(
            settings,
            employee,
            record.date,
            record.check_in,
            record.check_out,
            record.status,
            absence_decision=decision if decision else ('paid_company' if record.is_excused and record.status in ('absent', 'leave') else ''),
        )

        # احترام الخصم اليدوي وقرارات المراجعة اليدوية عند preserve_decisions=True.
        if preserve_decisions and getattr(record, 'manual_deduction', False):
            deduction_days = record.calculated_deduction_days
            deduction_hours = record.calculated_deduction_hours
            review_status = record.review_status
        elif record.status in ('absent', 'leave') and decision in ('excused_unpaid', 'paid_company'):
            deduction_days = 0.0
            deduction_hours = 0.0
            review_status = 'approved'
        elif record.is_excused and (record.status not in ('absent', 'leave') or decision == ''):
            deduction_days = 0.0
            deduction_hours = 0.0
            review_status = 'auto_applied'
        elif preserve_decisions and record.review_status in ('approved', 'rejected'):
            deduction_days = record.calculated_deduction_days
            deduction_hours = record.calculated_deduction_hours
            review_status = record.review_status
        else:
            deduction_days = computed['deduction_days']
            deduction_hours = computed['deduction_hours']
            review_status = computed['review_status']

        if is_weekly_off and not worked_weekly_off:
            deduction_days = 0.0
            deduction_hours = 0.0
            review_status = 'auto_applied'

        new_status = 'leave' if (is_weekly_off and not worked_weekly_off) else computed['status']

        # الإضافي يُحسب فقط لأيام الحضور الفعلية، ولا يُخزّن ليوم الإجازة الأسبوعية بلا بصمة حضور.
        attended_after = (
            new_status == 'present'
            or (new_status not in ('absent', 'leave') and bool(record.check_in or record.check_out))
            or (new_status in ('absent', 'leave') and effective_absence_decision(record) == 'paid_company')
        )
        if (is_weekly_off and not worked_weekly_off) or not attended_after:
            overtime = {'overtime_days': 0.0, 'overtime_hours': 0.0}
        else:
            overtime = compute_overtime(settings, record.check_out, record.check_in, employee=employee)

        weekly_off_days = 0.0
        weekly_off_note = ''
        if is_weekly_off:
            scoped_week = eligible_week_dates(
                _week_dates_before(record.date),
                hire_date=hire_date,
                termination_date=termination_date,
            )
            if scoped_week and any(day in records_by_date for day in scoped_week):
                result = sunday_deduction_for_week(
                    records_by_date, scoped_week,
                    hire_date=hire_date, termination_date=termination_date,
                )
                weekly_off_days = result['sunday_deduction_days']
                weekly_off_note = result['sunday_deduction_note']

        new_values = {
            'status': new_status,
            'calculated_deduction_days': deduction_days,
            'calculated_deduction_hours': deduction_hours,
            'late_minutes': 0.0 if (is_weekly_off and not worked_weekly_off) else float(computed['late_minutes'] or 0),
            'early_minutes': 0.0 if (is_weekly_off and not worked_weekly_off) else float(computed['early_minutes'] or 0),
            'overtime_days': overtime['overtime_days'],
            'overtime_hours': overtime['overtime_hours'],
            'sunday_deduction_days': weekly_off_days,
            'sunday_deduction_note': weekly_off_note,
            'review_status': review_status,
        }

        dirty = False
        for field, value in new_values.items():
            current = getattr(record, field)
            if isinstance(current, float) or isinstance(value, float):
                if round(float(current or 0), 2) != round(float(value or 0), 2):
                    setattr(record, field, value)
                    dirty = True
            elif current != value:
                setattr(record, field, value)
                dirty = True
        if dirty:
            record.save()
            changed += 1

    # إنشاء سجل ليوم الإجازة الأسبوعية (إجازة مدفوعة) لكل أسبوع به بيانات عمل ضمن فترة توظيف الموظف.
    today = timezone.localdate()
    limit = min(month_end, today)
    cursor = month_start
    while cursor <= limit:
        if cursor.weekday() == weekly_off_index and cursor not in records_by_date:
            in_employment = (
                (not hire_date or cursor >= hire_date)
                and (not termination_date or cursor <= termination_date)
            )
            if in_employment:
                scoped_week = eligible_week_dates(
                    _week_dates_before(cursor),
                    hire_date=hire_date,
                    termination_date=termination_date,
                )
                if scoped_week and any(day in records_by_date for day in scoped_week):
                    result = sunday_deduction_for_week(
                        records_by_date, scoped_week,
                        hire_date=hire_date, termination_date=termination_date,
                    )
                    created_off = HRAttendanceRecord.objects.create(
                        employee=employee,
                        date=cursor,
                        status='leave',
                        is_excused=True,
                        absence_decision='paid_company',
                        calculated_deduction_days=0,
                        calculated_deduction_hours=0,
                        overtime_days=0,
                        overtime_hours=0,
                        sunday_deduction_days=result['sunday_deduction_days'],
                        sunday_deduction_note=result['sunday_deduction_note'],
                        review_status='auto_applied',
                    )
                    records_by_date[cursor] = created_off
                    changed += 1
        cursor += timedelta(days=1)

    return changed
