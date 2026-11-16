import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Users,
  Briefcase,
  Clock,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Save,
  AlertTriangle,
  CalendarDays,
  Building2,
  Coffee,
  Timer,
  Info,
  Wallet,
  Scale,
  Banknote,
  RefreshCw,
  Download,
  Upload,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  XCircle,
  UsersRound,
  LayoutList,
  History,
  Printer,
  BarChart3
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { HRReportsView } from '../HRReportsView';
import { escapeHtml, renderLogoHtml } from '../../utils/printShared';
import { api } from '../../api/client';
import {
  HRJobTitle,
  HREmployee,
  HRAttendanceSettings,
  HRAttendanceRule,
  HRAttendanceRecord,
  HRAttendanceStatus,
  HRAttendanceStats,
  HRAttendanceImportResult,
  HRReviewStatus,
  HRPenalty,
  HRPenaltyType,
  HRLoan,
  HRDepartmentKey,
  HR_DEPARTMENTS,
  HR_DEPARTMENT_LABELS,
  HR_WEEK_DAYS,
  HRWeekDayKey,
  HRRuleApplicationMode,
  HRRuleViolationType,
  HRRuleDeductionType,
  HRRuleApplyMode,
  HROvertimeRule,
  HROvertimeRewardType
} from '../../types';

export type HRSection = 'staff' | 'attendance' | 'loans_penalties' | 'payroll' | 'reports';
export type HRSubTab = 'employees' | 'jobs' | 'records' | 'rules' | 'loans' | 'penalties';

export interface HRViewProps {
  initialSection?: HRSection;
  initialSubTab?: HRSubTab;
}

export const inputClass =
  'w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-800 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-100 transition';
export const labelClass = 'block text-[11px] font-black text-slate-600 mb-1.5';

export const formatMoney = (value: number) =>
  `${(Number.isFinite(value) ? value : 0).toLocaleString('en-US', {
    maximumFractionDigits: 2
  })} ج.م`;

export const VIOLATION_LABELS: Record<HRRuleViolationType, string> = {
  late_arrival: 'تأخير في الحضور',
  early_departure: 'انصراف مبكر',
  absence: 'غياب'
};

export const DEDUCTION_LABELS: Record<HRRuleDeductionType, string> = {
  hours: 'ساعات',
  days: 'أيام'
};

export const APPLY_MODE_LABELS: Record<HRRuleApplyMode, string> = {
  auto: 'تطبيق تلقائي',
  manual_review: 'مراجعة يدوية أولاً'
};

export const RULE_APPLICATION_LABELS: Record<HRRuleApplicationMode, string> = {
  auto: 'تطبيق القواعد تلقائياً',
  manual_review: 'مراجعة يدوية أولاً في الحضور'
};

export const Modal: React.FC<{
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidthClass?: string;
}> = ({ title, subtitle, onClose, children, footer, maxWidthClass = 'max-w-2xl' }) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
    onClick={onClose}
  >
    <div
      className={`bg-white w-full ${maxWidthClass} rounded-3xl shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col`}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200">
        <div>
          <h3 className="text-sm font-black text-slate-900">{title}</h3>
          {subtitle && <p className="text-[11px] font-bold text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>
      {footer && (
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/60 flex items-center justify-end gap-2">
          {footer}
        </div>
      )}
    </div>
  </div>
);

export const ErrorNote: React.FC<{ message: string }> = ({ message }) =>
  message ? (
    <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-bold">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>{message}</span>
    </div>
  ) : null;

export const PlaceholderPanel: React.FC<{ title: string; description: string }> = ({
  title,
  description
}) => (
  <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center">
    <div className="w-14 h-14 mx-auto rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center mb-3">
      <Timer className="w-7 h-7" />
    </div>
    <h3 className="text-base font-black text-slate-900 mb-1">{title}</h3>
    <p className="text-xs font-bold text-slate-500 max-w-md mx-auto leading-relaxed">
      {description}
    </p>
    <span className="inline-block mt-4 text-[11px] font-black px-3 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
      قريباً في المرحلة القادمة
    </span>
  </div>
);

/** حالات الحضور لعرض الشرائح. */
export const ATTENDANCE_STATUS_LABELS: Record<HRAttendanceStatus, string> = {
  present: 'حاضر',
  absent: 'غائب',
  leave: 'إجازة',
  missing_punch: 'بصمة ناقصة'
};

/** حالات مراجعة الخصومات المحتسبة. */
export const REVIEW_STATUS_LABELS: Record<HRReviewStatus, string> = {
  auto_applied: 'مطبق تلقائياً',
  pending_review: 'بانتظار المراجعة',
  approved: 'تم الاعتماد',
  rejected: 'مرفوض'
};

/** أنواع الجزاءات اليدوية. */
export const PENALTY_TYPE_LABELS: Record<HRPenaltyType, string> = {
  days: 'أيام',
  hours: 'ساعات'
};

export const todayISO = () => new Date().toISOString().slice(0, 10);
export const currentMonth = () => new Date().toISOString().slice(0, 7);

/** أسماء أيام الأسبوع بالعربية لعرض سجل الحضور اليومي. */
export const WEEK_DAY_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** ترتيب مفاتيح أيام الأسبوع كما تُخزَّن في إعدادات الحضور (يطابق Date.getDay). */
export const WEEK_DAY_KEYS: HRWeekDayKey[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
];

/** الافتراضي: الأحد (Date.getDay() = 0). */
export const DEFAULT_WEEKLY_OFF_INDEX = 0;

/**
 * رقم يوم الإجازة الأسبوعية وفق Date.getDay() (0=الأحد ... 6=السبت)
 * انطلاقاً من القيمة المحفوظة في إعدادات الحضور (مثل 'Sunday'/'Friday').
 */
export const weeklyOffIndexFromKey = (key?: string | null): number => {
  const index = WEEK_DAY_KEYS.indexOf((key || 'Sunday') as HRWeekDayKey);
  return index >= 0 ? index : DEFAULT_WEEKLY_OFF_INDEX;
};

/** الاسم العربي ليوم الإجازة الأسبوعية المستخدم في العناوين والطباعة. */
export const weeklyOffDayLabel = (index: number): string => WEEK_DAY_AR[index] || WEEK_DAY_AR[0];

export const formatDayLabel = (iso: string) => {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return `${WEEK_DAY_AR[parsed.getDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
};
/** تحويل تاريخ محلي إلى صيغة YYYY-MM-DD بدون انزياح التوقيت. */
export const isoDate = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(
    value.getDate()
  ).padStart(2, '0')}`;

/** أيام العمل الستة التي تسبق يوم الإجازة الأسبوعية. */
export const weekDatesBeforeWeeklyOff = (offDayIso: string): string[] => {
  const base = new Date(`${offDayIso}T00:00:00`);
  if (Number.isNaN(base.getTime())) return [];
  const dates: string[] = [];
  for (let offset = 6; offset >= 1; offset -= 1) {
    const cursor = new Date(base);
    cursor.setDate(base.getDate() - offset);
    dates.push(isoDate(cursor));
  }
  return dates;
};

/** نسبة خصم يوم الإجازة الأسبوعية según عدد أيام الغياب بدون عذر في الأسبوع. */
export const weeklyOffRatioForAbsences = (count: number): number => {
  if (count >= 5) return 1;
  if (count === 4) return 2 / 3;
  if (count === 3) return 1 / 2;
  if (count === 2) return 1 / 3;
  return 0;
};

/** وصف عربي لنسبة خصم يوم الإجازة الأسبوعية. */
export const weeklyOffRatioLabel = (days: number): string => {
  if (days >= 1) return 'يوم كامل';
  if (days >= 2 / 3) return 'ثلثي يوم';
  if (days >= 1 / 2) return 'نصف يوم';
  if (days >= 1 / 3) return 'ثلث يوم';
  return '';
};

/** حساب خصم يوم إجازة أسبوعية واحد من سجلات أيام العمل في الأسبوع. */
export const weeklyOffDeductionForDate = (
  recordsByDate: Map<string, HRAttendanceRecord>,
  offDayIso: string
): number => {
  const weekDates = weekDatesBeforeWeeklyOff(offDayIso);
  if (weekDates.length === 0) return 0;
  // لا نحسب خصماً لأسبوع لا توجد فيه أي بيانات لهذا الموظف.
  if (!weekDates.some((day) => recordsByDate.has(day))) return 0;
  const absentCount = weekDates.filter((day) => {
    const record = recordsByDate.get(day);
    return !record || (!record.is_excused && !record.check_in);
  }).length;
  return weeklyOffRatioForAbsences(absentCount);
};

/** إجمالي خصم أيام الإجازة الأسبوعية لموظف داخل شهر معيّن. */
export const sumWeeklyOffDeductionsForEmployeeMonth = (
  records: HRAttendanceRecord[],
  employeeId: string,
  monthKey: string,
  upToIso?: string,
  weeklyOffIndex: number = DEFAULT_WEEKLY_OFF_INDEX
): number => {
  if (!monthKey) return 0;
  const [yearStr, monthStr] = monthKey.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!year || !month) return 0;

  const recordsByDate = new Map<string, HRAttendanceRecord>();
  records
    .filter((record) => record.employee_id === employeeId)
    .forEach((record) => recordsByDate.set(record.date, record));

  const lastDay = new Date(year, month, 0).getDate();
  let total = 0;
  for (let day = 1; day <= lastDay; day += 1) {
    const cursor = new Date(year, month - 1, day);
    if (cursor.getDay() !== weeklyOffIndex) continue;
    const offDayIso = isoDate(cursor);
    if (upToIso && offDayIso > upToIso) continue;
    // يوم الإجازة الذي سُجّلت له بصمة حضور يُعامل كيوم عمل، فلا يُخصم.
    const offDayRecord = recordsByDate.get(offDayIso);
    if (offDayRecord && offDayRecord.check_in) continue;
    total += weeklyOffDeductionForDate(recordsByDate, offDayIso);
  }
  return total;
};

/** أجر اليوم = المرتب ÷ 30، وأجر الساعة = أجر اليوم ÷ 8. */
export const dailyRateFor = (salary: number) => (Number(salary) || 0) / 30;
export const hourlyRateFor = (salary: number) => dailyRateFor(salary) / 8;

/** تحويل قيمة وقت ("08:05" أو "08:05:00") إلى دقائق من منتصف الليل. */
export const timeToMinutes = (value?: string | null): number | null => {
  if (!value) return null;
  const parts = String(value).trim().split(':');
  const hours = Number(parts[0]);
  const minutes = parts.length > 1 ? Number(parts[1]) : 0;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
};

/** دقائق التأخير = وقت الحضور − الموعد الرسمي (صفر إذا حضر مبكراً). */
export const lateMinutesFor = (checkIn?: string | null, officialStart?: string | null): number => {
  const inMinutes = timeToMinutes(checkIn);
  const startMinutes = timeToMinutes(officialStart);
  if (inMinutes == null || startMinutes == null) return 0;
  const diff = inMinutes - startMinutes;
  return diff > 0 ? Math.round(diff) : 0;
};

/**
 * مطابقة دقائق التأخير مع شرائح قواعد الحضور (شاملة الحدين)،
 * مع تطبيق الشريحة الأعلى عند تجاوز كل الشرائح — مطابقة لاحتساب السيرفر.
 */
export const matchLateRule = (
  rules: HRAttendanceRule[] | undefined,
  lateMinutes: number
): HRAttendanceRule | null => {
  if (!rules || lateMinutes <= 0) return null;
  const candidates = rules.filter((rule) => rule.violation_type === 'late_arrival');
  if (candidates.length === 0) return null;
  const fromValue = (rule: HRAttendanceRule) => Number(rule.from_minutes) || 0;
  const toValue = (rule: HRAttendanceRule): number | null => {
    const raw = rule.to_minutes;
    if (raw === undefined || raw === null || (raw as unknown) === '') return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };

  let best: HRAttendanceRule | null = null;
  let bestFrom = -Infinity;
  candidates.forEach((rule) => {
    const from = fromValue(rule);
    const to = toValue(rule);
    if (lateMinutes < from) return;
    if (to != null && lateMinutes > to) return;
    if (from > bestFrom) {
      best = rule;
      bestFrom = from;
    }
  });
  if (best) return best;

  // لا شريحة مطابقة: إما فجوة بين شريحتين أو تجاوز أعلى شريحة — طبّق أعلى شريحة.
  const minFrom = candidates.reduce<number>(
    (min, rule) => Math.min(min, fromValue(rule)),
    Infinity
  );
  if (Number.isFinite(minFrom) && lateMinutes >= minFrom) {
    return candidates.reduce((acc, rule) => {
      const accTo = toValue(acc) ?? Infinity;
      const ruleTo = toValue(rule) ?? Infinity;
      return ruleTo > accTo || (ruleTo === accTo && fromValue(rule) > fromValue(acc)) ? rule : acc;
    });
  }
  return null;
};

/** هل يوجد سجل حضور فعلي (حضور / إجازة بعذر / بصمة حضور)؟ */
export const isAttendedRecord = (record: HRAttendanceRecord): boolean => {
  if (record.status === 'present') return true;
  if (record.status === 'leave' && record.is_excused) return true;
  return !!record.check_in;
};

export interface MonthAccrual {
  attendedDays: number;
  paidSundayDays: number;
  earnedDays: number;
}

/**
 * استحقاق الموظف داخل شهر على أساس الحضور الفعلي:
 * - أيام العمل الفعلية (عدا يوم الإجازة الأسبوعية) التي حضر فيها.
 * - أيام الإجازة الأسبوعية المدفوعة في الأسابيع التي حضر فيها (بعد خصم نسبة الغياب).
 * - إذا اكتمل الشهر بحضور كامل يُمنح 30 يوماً (تعويض 28/29) وبحد أقصى 30.
 */
export const computeMonthAccrual = (
  employeeId: string,
  records: HRAttendanceRecord[],
  monthKey: string,
  upToIso?: string,
  weeklyOffIndex: number = DEFAULT_WEEKLY_OFF_INDEX
): MonthAccrual => {
  const empty: MonthAccrual = { attendedDays: 0, paidSundayDays: 0, earnedDays: 0 };
  if (!monthKey) return empty;
  const [yearStr, monthStr] = monthKey.split('-');
  const year = Number(yearStr);
  const monthNumber = Number(monthStr);
  if (!year || !monthNumber) return empty;

  const recordsByDate = new Map<string, HRAttendanceRecord>();
  records
    .filter((record) => record.employee_id === employeeId && record.review_status !== 'rejected')
    .forEach((record) => recordsByDate.set(record.date, record));

  const lastDay = new Date(year, monthNumber, 0).getDate();
  let attendedDays = 0;
  let workdaysInScope = 0;
  let paidSundayDays = 0;

  for (let day = 1; day <= lastDay; day += 1) {
    const cursor = new Date(year, monthNumber - 1, day);
    const iso = isoDate(cursor);
    const record = recordsByDate.get(iso);
    const hasCheckIn = !!record?.check_in;
    // اليوم الحالي (بعد نقطة التوقف = أمس) يُحتسب إذا وُجدت له بصمة حضور فعلية.
    if (upToIso && iso > upToIso && !hasCheckIn) continue;
    if (cursor.getDay() === weeklyOffIndex) {
      // يوم الإجازة الذي عمل فيه الموظف (له بصمة حضور) يوم عمل عادي مستحق.
      if (hasCheckIn) {
        workdaysInScope += 1;
        attendedDays += 1;
        continue;
      }
      const weekDates = weekDatesBeforeWeeklyOff(iso);
      const hasWeekData = weekDates.some((dateStr) => recordsByDate.has(dateStr));
      if (hasWeekData) {
        paidSundayDays += Math.max(0, 1 - weeklyOffDeductionForDate(recordsByDate, iso));
      }
      continue;
    }
    workdaysInScope += 1;
    if (record && isAttendedRecord(record)) attendedDays += 1;
  }

  let earnedDays = attendedDays + paidSundayDays;
  const monthLastIso = isoDate(new Date(year, monthNumber - 1, lastDay));
  const monthComplete = !upToIso || upToIso >= monthLastIso;
  if (monthComplete && workdaysInScope > 0 && attendedDays >= workdaysInScope) {
    // شهر مكتمل بحضور كامل: 30 يوماً حسابية مهما كان طول الشهر.
    earnedDays = 30;
  }
  earnedDays = Math.min(30, earnedDays);
  return {
    attendedDays: Math.round(attendedDays * 100) / 100,
    paidSundayDays: Math.round(paidSundayDays * 100) / 100,
    earnedDays: Math.round(earnedDays * 100) / 100
  };
};



