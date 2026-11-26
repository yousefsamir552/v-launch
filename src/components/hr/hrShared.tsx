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
    className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/50 backdrop-blur-sm"
    onClick={onClose}
  >
    <div
      className={`bg-white w-[95vw] sm:w-full ${maxWidthClass} rounded-3xl shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col`}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3 px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200">
        <div className="min-w-0">
          <h3 className="text-sm font-black text-slate-900 break-words">{title}</h3>
          {subtitle && <p className="text-[11px] font-bold text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="px-4 sm:px-5 py-4 overflow-y-auto flex-1">{children}</div>
      {footer && (
        <div className="px-4 sm:px-5 py-3 border-t border-slate-200 bg-slate-50/60 flex flex-wrap items-center justify-end gap-2">
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

export const todayISO = () => isoDate(new Date());
export const currentMonth = () => isoDate(new Date()).slice(0, 7);

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

/** نسبة خصم يوم الإجازة الأسبوعية وفق عدد أيام الغياب بدون عذر في الأسبوع. */
export const weeklyOffRatioForAbsences = (count: number): number => {
  if (count >= 5) return 1;
  if (count === 4) return 2 / 3;
  if (count === 2 || count === 3) return 1 / 3;
  return 0;
};

/** وصف عربي لنسبة خصم يوم الإجازة الأسبوعية. */
export const weeklyOffRatioLabel = (days: number): string => {
  if (days >= 1) return 'يوم كامل';
  if (days >= 2 / 3 - 0.001) return 'ثلثي يوم';
  if (days >= 1 / 3 - 0.001) return 'ثلث يوم';
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
    return !record || !isAttendedRecord(record);
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
    total += weeklyOffDeductionForDate(recordsByDate, offDayIso);
  }
  return total;
};

/** احتساب ساعات العمل اليومية ديناميكياً من مواعيد الحضور والانصراف الرسمية (مع دعم عبور منتصف الليل). */
export const workingHoursPerDayFor = (
  settings?: Pick<HRAttendanceSettings, 'official_start_time' | 'official_end_time' | 'working_hours_per_day'> | null
): number => {
  if (settings?.working_hours_per_day && Number(settings.working_hours_per_day) > 0) {
    return Number(settings.working_hours_per_day);
  }
  const startMins = timeToMinutes(settings?.official_start_time || '08:30');
  const endMins = timeToMinutes(settings?.official_end_time || '17:30');
  if (startMins == null || endMins == null) return 8;
  let diff = endMins - startMins;
  if (diff <= 0) diff += 24 * 60;
  const hours = Math.round((diff / 60) * 10000) / 10000;
  return hours > 0 ? hours : 8;
};

/** أجر اليوم = المرتب ÷ 30، وأجر الساعة = أجر اليوم ÷ ساعات العمل اليومية الديناميكية. */
export const dailyRateFor = (salary: number) => (Number(salary) || 0) / 30;
export const hourlyRateFor = (salary: number, workingHoursPerDay: number = 8) => {
  const hours = Number(workingHoursPerDay) > 0 ? Number(workingHoursPerDay) : 8;
  return dailyRateFor(salary) / hours;
};

/** تحويل قيمة وقت ("08:05" أو "08:05:00") إلى دقائق من منتصف الليل. */
export const timeToMinutes = (value?: string | null): number | null => {
  if (!value) return null;
  const parts = String(value).trim().split(':');
  const hours = Number(parts[0]);
  const minutes = parts.length > 1 ? Number(parts[1]) : 0;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
};

/** دقائق التأخير = وقت الحضور − الموعد الرسمي (مع دعم الوردية الليلية التي تعبر منتصف الليل). */
export const lateMinutesFor = (
  checkIn?: string | null,
  officialStart?: string | null,
  officialEnd?: string | null
): number => {
  let inMinutes = timeToMinutes(checkIn);
  const startMinutes = timeToMinutes(officialStart);
  if (inMinutes == null || startMinutes == null) return 0;
  const endMinutes = timeToMinutes(officialEnd);
  if (endMinutes != null && endMinutes <= startMinutes && inMinutes <= endMinutes) {
    inMinutes += 1440;
  }
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

  // لا شريحة مطابقة مباشرة:
  // 1) في حالة الفجوة بين شريحتين → طبّق أقرب شريحة أقل (أكبر to_minutes < lateMinutes) بدل القفز لأقصى عقوبة.
  // 2) عند تجاوز أعلى شريحة → طبّق أعلى شريحة.
  const minFrom = candidates.reduce<number>(
    (min, rule) => Math.min(min, fromValue(rule)),
    Infinity
  );
  if (Number.isFinite(minFrom) && lateMinutes >= minFrom) {
    const lowerTiers = candidates.filter((rule) => {
      const to = toValue(rule);
      return to != null && to < lateMinutes;
    });
    const higherTiers = candidates.filter((rule) => fromValue(rule) > lateMinutes);
    if (lowerTiers.length > 0 && higherTiers.length > 0) {
      return lowerTiers.reduce((acc, rule) => {
        const accTo = toValue(acc) ?? -Infinity;
        const ruleTo = toValue(rule) ?? -Infinity;
        return ruleTo > accTo || (ruleTo === accTo && fromValue(rule) > fromValue(acc)) ? rule : acc;
      });
    }
    return candidates.reduce((acc, rule) => {
      const accTo = toValue(acc) ?? Infinity;
      const ruleTo = toValue(rule) ?? Infinity;
      return ruleTo > accTo || (ruleTo === accTo && fromValue(rule) > fromValue(acc)) ? rule : acc;
    });
  }
  return null;
};

/** هل يوجد سجل حضور فعلي (حضور / أي سجل بعذر مقبول / بصمة حضور)؟ */
export const isAttendedRecord = (record: HRAttendanceRecord): boolean => {
  if (record.status === 'present') return true;
  if (record.is_excused) return true;
  return !!record.check_in;
};

export interface MonthAccrual {
  attendedDays: number;
  paidSundayDays: number;
  workedWeeklyOffDays: number;
  weeklyOffExtraDays: number;
  sundayDeductionDays: number;
  unexcusedAbsenceDays: number;
  earnedDays: number;
  earnedDaysRaw: number;
}

/**
 * استحقاق الموظف داخل شهر وفق القواعد المحاسبية المؤكدة (مطابق 100% للباك إند):
 * 1) للشهر المكتمل: earned_base = max(0, 30 - total_unexcused_absence_days - sunday_deduction_days)
 *    بحيث يخصم يوم الغياب يوماً واحداً بالضبط سواء كان الشهر 28 أو 30 أو 31 يوماً.
 * 2) العمل يوم الإجازة الأسبوعية يمنح أجراً إضافياً فوق سقف الـ 30 يوماً بمضاعف
 *    ديناميكي (weeklyOffWorkMultiplier: 1.0 / 1.5 / 2.0 ...).
 * 3) السجلات ذات review_status='rejected' لا تُستبعد أبداً من الحضور (رفض الخصم يلغي الخصم فقط).
 */
export const computeMonthAccrual = (
  employeeId: string,
  records: HRAttendanceRecord[],
  monthKey: string,
  upToIso?: string,
  weeklyOffIndex: number = DEFAULT_WEEKLY_OFF_INDEX,
  weeklyOffWorkMultiplier: number = 1.0
): MonthAccrual => {
  const empty: MonthAccrual = {
    attendedDays: 0,
    paidSundayDays: 0,
    workedWeeklyOffDays: 0,
    weeklyOffExtraDays: 0,
    sundayDeductionDays: 0,
    unexcusedAbsenceDays: 0,
    earnedDays: 0,
    earnedDaysRaw: 0
  };
  if (!monthKey) return empty;
  const [yearStr, monthStr] = monthKey.split('-');
  const year = Number(yearStr);
  const monthNumber = Number(monthStr);
  if (!year || !monthNumber) return empty;

  const mult = Number.isFinite(weeklyOffWorkMultiplier) && weeklyOffWorkMultiplier >= 0
    ? weeklyOffWorkMultiplier
    : 1.0;

  const recordsByDate = new Map<string, HRAttendanceRecord>();
  records
    .filter((record) => record.employee_id === employeeId)
    .forEach((record) => recordsByDate.set(record.date, record));

  const lastDay = new Date(year, monthNumber, 0).getDate();
  const monthLastIso = isoDate(new Date(year, monthNumber - 1, lastDay));
  const monthComplete = !upToIso || upToIso >= monthLastIso;

  let attendedRegularDays = 0;
  let workedWeeklyOffDays = 0;
  let workdaysInScope = 0;
  let paidSundayDays = 0;
  let unexcusedAbsenceDays = 0;
  let sundayDeductionDays = 0;

  for (let day = 1; day <= lastDay; day += 1) {
    const cursor = new Date(year, monthNumber - 1, day);
    const iso = isoDate(cursor);
    const record = recordsByDate.get(iso);
    const hasCheckIn = !!record?.check_in;
    // اليوم الحالي (بعد نقطة التوقف = أمس) يُحتسب إذا وُجدت له بصمة حضور فعلية.
    if (upToIso && iso > upToIso && !hasCheckIn) continue;
    if (cursor.getDay() === weeklyOffIndex) {
      const weekDates = weekDatesBeforeWeeklyOff(iso);
      const hasWeekData = weekDates.some((dateStr) => recordsByDate.has(dateStr));
      if (hasWeekData) {
        const ded = weeklyOffDeductionForDate(recordsByDate, iso);
        sundayDeductionDays += ded;
        paidSundayDays += Math.max(0, 1 - ded);
      } else if (monthComplete) {
        sundayDeductionDays += 1;
      }
      // العمل يوم الإجازة الأسبوعية يمنح أجراً إضافياً فوق سقف الـ 30 يوماً بنفس المعادلة في منتصف ونهاية الشهر.
      if (hasCheckIn) {
        workedWeeklyOffDays += 1;
      }
      continue;
    }
    workdaysInScope += 1;
    if (record && isAttendedRecord(record)) {
      attendedRegularDays += 1;
    } else {
      unexcusedAbsenceDays += 1;
    }
  }

  const attendedDays = attendedRegularDays + workedWeeklyOffDays;
  const weeklyOffExtraDays = workedWeeklyOffDays * mult;

  let earnedDaysRaw = 0;
  if (attendedRegularDays === 0 && workedWeeklyOffDays === 0) {
    paidSundayDays = 0;
    sundayDeductionDays = 0;
    earnedDaysRaw = 0;
  } else if (monthComplete) {
    const rawBase = Math.max(0, 30 - unexcusedAbsenceDays - sundayDeductionDays);
    const baseEarned =
      workdaysInScope > 0 && unexcusedAbsenceDays >= workdaysInScope / 2
        ? Math.min(rawBase, attendedRegularDays + paidSundayDays)
        : rawBase;
    earnedDaysRaw = baseEarned + weeklyOffExtraDays;
  } else {
    const baseEarned = Math.min(30, attendedRegularDays + paidSundayDays);
    earnedDaysRaw = baseEarned + weeklyOffExtraDays;
  }

  return {
    attendedDays: Math.round(attendedDays * 100) / 100,
    paidSundayDays: Math.round(paidSundayDays * 100) / 100,
    workedWeeklyOffDays: Math.round(workedWeeklyOffDays * 100) / 100,
    weeklyOffExtraDays: Math.round(weeklyOffExtraDays * 100) / 100,
    sundayDeductionDays: Math.round(sundayDeductionDays * 100) / 100,
    unexcusedAbsenceDays: Math.round(unexcusedAbsenceDays * 100) / 100,
    earnedDays: Math.round(earnedDaysRaw * 100) / 100,
    earnedDaysRaw
  };
};



