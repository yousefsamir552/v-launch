import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Users, Briefcase, Clock, Plus, Search, Pencil, Trash2, X, Save,
  AlertTriangle, CalendarDays, Building2, Coffee, Timer, Info, Wallet,
  Scale, Banknote, RefreshCw, Download, Upload, FileSpreadsheet, FileText,
  CheckCircle2, XCircle, UsersRound, LayoutList, History, Printer, BarChart3
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { escapeHtml, renderLogoHtml } from '../../utils/printShared';
import { api } from '../../api/client';
import {
  HRJobTitle, HREmployee, HRAttendanceSettings, HRAttendanceRule,
  HRAttendanceRecord, HRAttendanceStatus, HRAttendanceStats,
  HRAttendanceImportResult, HRReviewStatus, HRPenalty, HRPenaltyType,
  HRLoan, HRDepartmentKey, HR_DEPARTMENTS, HR_DEPARTMENT_LABELS,
  HR_WEEK_DAYS, HRWeekDayKey, HRRuleApplicationMode, HRRuleViolationType,
  HRRuleDeductionType, HRRuleApplyMode, HROvertimeRule, HROvertimeRewardType
} from '../../types';
import {
  inputClass, labelClass, formatMoney, VIOLATION_LABELS, DEDUCTION_LABELS,
  APPLY_MODE_LABELS, RULE_APPLICATION_LABELS, Modal, ErrorNote, PlaceholderPanel,
  ATTENDANCE_STATUS_LABELS, REVIEW_STATUS_LABELS, PENALTY_TYPE_LABELS,
  todayISO, currentMonth, WEEK_DAY_AR, WEEK_DAY_KEYS, DEFAULT_WEEKLY_OFF_INDEX,
  weeklyOffIndexFromKey, weeklyOffDayLabel, formatDayLabel, isoDate,
  weekDatesBeforeWeeklyOff, weeklyOffRatioForAbsences, weeklyOffRatioLabel,
  weeklyOffDeductionForDate, sumWeeklyOffDeductionsForEmployeeMonth,
  dailyRateFor, hourlyRateFor, timeToMinutes, lateMinutesFor, matchLateRule,
  isAttendedRecord, MonthAccrual, computeMonthAccrual
} from './hrShared';

interface PayrollRow {
  employee: HREmployee;
  baseSalary: number;
  attendedDays: number;
  paidSundayDays: number;
  earnedDays: number;
  earnedBase: number;
  overtimeDays: number;
  overtimeHours: number;
  overtimePay: number;
  attendanceDays: number;
  attendanceHours: number;
  attendanceDeduction: number;
  sundayDeductionDays: number;
  sundayDeduction: number;
  penaltyDays: number;
  penaltyHours: number;
  penaltyDeduction: number;
  loanDeduction: number;
  totalDeduction: number;
  netPay: number;
}

export const PayrollPanel: React.FC<{ employees: HREmployee[] }> = ({ employees }) => {
  const { addFlashMessage, globalSettings } = useApp();

  const [month, setMonth] = useState(currentMonth());
  const [records, setRecords] = useState<HRAttendanceRecord[]>([]);
  const [penalties, setPenalties] = useState<HRPenalty[]>([]);
  const [loans, setLoans] = useState<HRLoan[]>([]);
  const [settings, setSettings] = useState<HRAttendanceSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // يوم الإجازة الأسبوعية المدفوعة من الإعدادات (الأحد افتراضياً).
  const weeklyOffIndex = weeklyOffIndexFromKey(settings?.weekly_off_day);
  const weeklyOffLabel = weeklyOffDayLabel(weeklyOffIndex);

  const loadPayrollData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [recordsRes, penaltiesRes, loansRes, settingsRes] = await Promise.all([
        api.getHRAttendanceRecords({ month, includePrevWeek: true }),
        api.getHRPenalties(month),
        api.getHRLoans(month),
        api.getHRAttendanceSettings().catch(() => null)
      ]);
      setRecords(Array.isArray(recordsRes) ? recordsRes : []);
      setPenalties(Array.isArray(penaltiesRes) ? penaltiesRes : []);
      setLoans(Array.isArray(loansRes) ? loansRes : []);
      setSettings(settingsRes || null);
    } catch (err: any) {
      addFlashMessage(err?.message || 'فشل تحميل بيانات المرتبات', 'danger');
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  useEffect(() => {
    void loadPayrollData();
  }, [loadPayrollData]);

  const rows = useMemo<PayrollRow[]>(() => {
    const inMonth = (date?: string) => !!date && date.startsWith(month);
    const today = new Date();
    const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const upToIso =
      month === currentMonthKey
        ? isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1))
        : undefined;
    const officialStart = settings?.official_start_time || '08:30';
    // يوم الإجازة الأسبوعية المدفوعة مأخوذ من نطاق المكوّن (weeklyOffIndex).

    return employees.map((employee) => {
      const baseSalary = Number(employee.monthly_salary) || 0;
      const dayRate = dailyRateFor(baseSalary);
      const hourRate = hourlyRateFor(baseSalary);

      // خصم التأخير/الانصراف المبكر (على أيام الحضور فقط — الغياب لا يُحسب مرتين).
      let attendanceDays = 0;
      let attendanceHours = 0;
      let overtimeDays = 0;
      let overtimeHours = 0;
      records.forEach((record) => {
        if (record.employee_id !== employee.id) return;
        if (!inMonth(record.date)) return;
        if (record.review_status === 'rejected') return;
        // يوم الإجازة الأسبوعية بدون بصمة حضور = إجازة مدفوعة (تُحسب ضمن الأيام المستحقة).
        // أما يوم الإجازة الذي عمل فيه الموظف (له بصمة حضور) فيُعامل كيوم عمل عادي.
        const recordDay = new Date(`${record.date}T00:00:00`);
        if (recordDay.getDay() === weeklyOffIndex && !record.check_in) return;

        overtimeDays += Number(record.overtime_days) || 0;
        overtimeHours += Number(record.overtime_hours) || 0;

        // الغياب غير محسوب ضمن الأيام المستحقة أصلاً، فلا نخصمه مرة ثانية.
        if (!isAttendedRecord(record)) return;
        if (record.is_excused) return;

        let dedDays = Number(record.calculated_deduction_days) || 0;
        let dedHours = Number(record.calculated_deduction_hours) || 0;
        // احتياطي ديناميكي: لو لم يُخزَّن الخصم، طبّق شريحة التأخير من الإعدادات.
        if (dedDays === 0 && dedHours === 0) {
          const lateMinutes = lateMinutesFor(record.check_in, officialStart);
          const rule = matchLateRule(settings?.rules_json, lateMinutes);
          const ruleValue = Number(rule?.deduction_value) || 0;
          if (rule && ruleValue > 0) {
            if (rule.deduction_type === 'days') dedDays = ruleValue;
            else dedHours = ruleValue;
          }
        }
        attendanceDays += dedDays;
        attendanceHours += dedHours;
      });

      // الأجر المكتسب على أساس الحضور الفعلي + أيام الإجازة الأسبوعية المدفوعة (بحد أقصى 30 يوماً).
      const accrual = computeMonthAccrual(employee.id, records, month, upToIso, weeklyOffIndex);
      const earnedBase = accrual.earnedDays * dayRate;

      // خصم يوم الإجازة يُحسب من سجلات أيام العمل الستة (للعرض فقط — مطبّق ضمن الأيام المستحقة).
      const sundayDeductionDays = sumWeeklyOffDeductionsForEmployeeMonth(
        records,
        employee.id,
        month,
        upToIso,
        weeklyOffIndex
      );

      let penaltyDays = 0;
      let penaltyHours = 0;
      penalties.forEach((penalty) => {
        if (penalty.employee_id !== employee.id) return;
        if (!inMonth(penalty.date)) return;
        if (penalty.penalty_type === 'days') penaltyDays += Number(penalty.value) || 0;
        else penaltyHours += Number(penalty.value) || 0;
      });

      const loanDeduction = loans
        .filter((loan) => loan.employee_id === employee.id && inMonth(loan.date))
        .reduce((sum, loan) => sum + (Number(loan.amount) || 0), 0);

      const attendanceDeduction = attendanceDays * dayRate + attendanceHours * hourRate;
      // خصم الإجازة الأسبوعية ليس مبلغاً إضافياً: أثره ظاهر في تقليل الأيام المستحقة (earnedDays).
      const sundayDeduction = 0;
      const penaltyDeduction = penaltyDays * dayRate + penaltyHours * hourRate;
      const overtimePay = overtimeDays * dayRate + overtimeHours * hourRate;
      // الخصومات المطروحة من الأجر المكتسب: التأخير + الجزاءات اليدوية + السُلف فقط.
      const totalDeduction = attendanceDeduction + penaltyDeduction + loanDeduction;

      return {
        employee,
        baseSalary,
        attendedDays: accrual.attendedDays,
        paidSundayDays: accrual.paidSundayDays,
        earnedDays: accrual.earnedDays,
        earnedBase,
        overtimeDays,
        overtimeHours,
        overtimePay,
        attendanceDays,
        attendanceHours,
        attendanceDeduction,
        sundayDeductionDays,
        sundayDeduction,
        penaltyDays,
        penaltyHours,
        penaltyDeduction,
        loanDeduction,
        totalDeduction,
        netPay: earnedBase + overtimePay - totalDeduction
      };
    });
  }, [employees, records, penalties, loans, month, settings]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          baseSalary: acc.baseSalary + row.baseSalary,
          earnedBase: acc.earnedBase + row.earnedBase,
          overtimePay: acc.overtimePay + row.overtimePay,
          attendanceDeduction: acc.attendanceDeduction + row.attendanceDeduction,
          sundayDeduction: acc.sundayDeduction + row.sundayDeduction,
          penaltyDeduction: acc.penaltyDeduction + row.penaltyDeduction,
          loanDeduction: acc.loanDeduction + row.loanDeduction,
          totalDeduction: acc.totalDeduction + row.totalDeduction,
          netPay: acc.netPay + row.netPay
        }),
        {
          baseSalary: 0,
          earnedBase: 0,
          overtimePay: 0,
          attendanceDeduction: 0,
          sundayDeduction: 0,
          penaltyDeduction: 0,
          loanDeduction: 0,
          totalDeduction: 0,
          netPay: 0
        }
      ),
    [rows]
  );

  const workerDepartment = (row: PayrollRow) =>
    row.employee.department_label ||
    (row.employee.department ? HR_DEPARTMENT_LABELS[row.employee.department] : '—');

  const buildWorkerSheetHtml = (row: PayrollRow) => {
    const recordsByDate = new Map<string, HRAttendanceRecord>();
    records
      .filter(
        (record) =>
          record.employee_id === row.employee.id && (record.date || '').startsWith(month)
      )
      .forEach((record) => recordsByDate.set(record.date, record));

    // سُلف الشهر موزّعة على أيام تواريخها لتظهر في صف اليوم نفسه.
    const loansByDate = new Map<string, HRLoan[]>();
    loans
      .filter(
        (loan) => loan.employee_id === row.employee.id && (loan.date || '').startsWith(month)
      )
      .forEach((loan) => {
        const key = loan.date;
        if (!loansByDate.has(key)) loansByDate.set(key, []);
        loansByDate.get(key)!.push(loan);
      });

    const [yearStr, monthStr] = month.split('-');
    const year = Number(yearStr);
    const monthNumber = Number(monthStr);
    const daysInMonth = year && monthNumber ? new Date(year, monthNumber, 0).getDate() : 30;
    const dayRate = dailyRateFor(row.baseSalary);
    const hourRate = hourlyRateFor(row.baseSalary);
    const officialStart = settings?.official_start_time || '08:30';
    const weeklyOffLabel = weeklyOffDayLabel(weeklyOffIndex);
    const statusLabels: Record<string, string> = {
      present: 'حاضر',
      absent: 'غائب',
      leave: 'إجازة',
      missing_punch: 'بصمة ناقصة'
    };

    const dayRows: string[] = [];
    for (let day = 1; day <= daysInMonth; day += 1) {
      const cursor = new Date(year, monthNumber - 1, day);
      const iso = isoDate(cursor);
      const isWeeklyOff = cursor.getDay() === weeklyOffIndex;
      const record = recordsByDate.get(iso);
      const dayLabel = WEEK_DAY_AR[cursor.getDay()];
      const dateLabel = `${String(day).padStart(2, '0')}/${String(monthNumber).padStart(2, '0')}`;
      const dayLoans = loansByDate.get(iso) || [];
      const loansTotal = dayLoans.reduce((sum, loan) => sum + (Number(loan.amount) || 0), 0);
      const loansCell = loansTotal > 0 ? formatMoney(loansTotal) : '—';
      const loansReason = dayLoans.map((loan) => loan.notes || 'سلفة').join('، ');

      // يوم الإجازة الأسبوعية إجازة مدفوعة فقط عند غياب بصمة الحضور؛
      // اليوم الذي عُمل فيه يُطبع كيوم عمل عادي ببصماته وخصمه.
      if (isWeeklyOff && !(record && record.check_in)) {
        const weekDates = weekDatesBeforeWeeklyOff(iso);
        const hasWeekData = weekDates.some((dateStr) => recordsByDate.has(dateStr));
        const absentCount = weekDates.filter((dateStr) => {
          const rec = recordsByDate.get(dateStr);
          return !rec || (!rec.is_excused && !rec.check_in);
        }).length;
        const ratio = hasWeekData ? weeklyOffRatioForAbsences(absentCount) : 0;
        const deduction = ratio * dayRate;
        const reason =
          ratio > 0
            ? `خصم ${weeklyOffRatioLabel(ratio)} بسبب غياب ${absentCount} أيام بدون عذر`
            : `إجازة أسبوعية مدفوعة (${weeklyOffLabel})`;
        dayRows.push(`<tr class="${ratio > 0 ? 'row-absent' : 'row-off'}">
          <td class="mono">${dateLabel} — ${dayLabel}</td><td>—</td><td>—</td><td>—</td>
          <td class="mono">${loansCell}</td>
          <td class="mono">${deduction ? formatMoney(-deduction) : '—'}</td>
          <td class="note">${escapeHtml(reason)}${loansReason ? ` — ${escapeHtml(loansReason)}` : ''}</td></tr>`);
        continue;
      }

      if (!record) {
        dayRows.push(`<tr class="row-off">
          <td class="mono">${dateLabel} — ${dayLabel}</td><td>—</td><td>—</td><td>—</td>
          <td class="mono">${loansCell}</td><td class="mono">—</td>
          <td class="note">لا يوجد سجل${loansReason ? ` — ${escapeHtml(loansReason)}` : ''}</td></tr>`);
        continue;
      }

      let deduction =
        (Number(record.calculated_deduction_days) || 0) * dayRate +
        (Number(record.calculated_deduction_hours) || 0) * hourRate;
      if (record.is_excused) deduction = 0;
      const overtime =
        (Number(record.overtime_days) || 0) * dayRate +
        (Number(record.overtime_hours) || 0) * hourRate;
      const lateMinutes = lateMinutesFor(record.check_in, officialStart);
      let reason = 'حضور كامل';
      if (record.is_excused) reason = `بعذر: ${record.excuse_note || 'بدون خصم'}`;
      else if (record.status === 'absent') reason = 'غياب بدون عذر';
      else if (record.status === 'missing_punch') reason = 'بصمة ناقصة تحتاج مراجعة';
      else if (record.status === 'leave') reason = statusLabels[record.status] || 'إجازة';
      else if (lateMinutes > 0) reason = `تأخير ${lateMinutes} دقيقة`;
      else if (deduction > 0) reason = 'خصم تأخير / انصراف مبكر';

      // أحمر للغياب، أزرق لأيام الإضافي، أصفر للتأخير.
      let rowClass = 'row-ok';
      if (record.status === 'absent') rowClass = 'row-absent';
      else if (overtime > 0) rowClass = 'row-overtime';
      else if (record.status === 'missing_punch') rowClass = 'row-info';
      else if (record.status === 'leave') rowClass = 'row-off';
      else if (deduction > 0) rowClass = 'row-warn';

      // reason قد يحتوي على excuse_note القادم من قاعدة البيانات: يُهرَّب دائماً عند الإخراج.
      dayRows.push(`<tr class="${rowClass}">
        <td class="mono">${dateLabel} — ${dayLabel}</td>
        <td class="mono">${escapeHtml(record.check_in || '—')}</td>
        <td class="mono">${escapeHtml(record.check_out || '—')}</td>
        <td class="mono">${overtime ? formatMoney(overtime) : '—'}</td>
        <td class="mono">${loansCell}</td>
        <td class="mono">${deduction ? formatMoney(-deduction) : '—'}</td>
        <td class="note">${escapeHtml(reason)}${loansReason ? ` — ${escapeHtml(loansReason)}` : ''}</td></tr>`);
    }
    const dayRowsHtml = dayRows.join('');
    const overtimeText = `${row.overtimeDays} يوم / ${row.overtimeHours} ساعة`;
    const attendanceText = `${row.attendanceDays.toFixed(2)} يوم / ${row.attendanceHours.toFixed(2)} ساعة`;
    const penaltyText = `${row.penaltyDays.toFixed(2)} يوم / ${row.penaltyHours.toFixed(2)} ساعة`;

    return `<div class="sheet">
      <div class="head">
        <div class="brand">${renderLogoHtml(globalSettings.logo, globalSettings.site_name, 46)}</div>
        <div class="title">
          <h1>${escapeHtml(globalSettings.site_name || 'مصنع الملابس الجاهزة')}</h1>
          <p>ورقة مرتب عامل — شهر ${escapeHtml(month)}</p>
        </div>
      </div>
      <table class="info">
        <tr>
          <td class="label">اسم العامل</td><td>${escapeHtml(row.employee.name)}</td>
          <td class="label">كود البصمة</td><td class="mono">${escapeHtml(row.employee.employee_code || '-')}</td>
        </tr>
        <tr>
          <td class="label">الوظيفة</td><td>${escapeHtml(row.employee.job_title || '—')}</td>
          <td class="label">القسم</td><td>${escapeHtml(workerDepartment(row))}</td>
        </tr>
        <tr>
          <td class="label">الأيام المستحقة</td>
          <td class="mono">${row.earnedDays.toFixed(2)} يوم</td>
          <td class="label">تفصيل الأيام</td>
          <td class="mono">حضور ${row.attendedDays.toFixed(2)} + ${escapeHtml(weeklyOffLabel)} ${row.paidSundayDays.toFixed(2)}</td>
        </tr>
        <tr class="screen-only">
          <td class="label">المرتب الشهري</td>
          <td class="mono">${formatMoney(row.baseSalary)}</td>
          <td class="label">أجر اليوم / الساعة</td>
          <td class="mono">${formatMoney(dayRate)} / ${formatMoney(hourRate)}</td>
        </tr>
      </table>
      <table class="days">
        <thead><tr>
          <th>الأيام / التاريخ</th><th>حضور</th><th>انصراف</th>
          <th>الإضافي</th><th>السُلف</th><th>الخصومات</th><th>ملاحظات</th>
        </tr></thead>
        <tbody>${dayRowsHtml}</tbody>
      </table>
      <table class="totals">
        <tr><td>الأجر المكتسب (${row.earnedDays.toFixed(2)} يوم)</td><td class="mono">${formatMoney(row.earnedBase)}</td></tr>
        <tr><td>إجمالي الإضافي (${overtimeText})</td><td class="mono pos">${formatMoney(row.overtimePay)}</td></tr>
        <tr><td>خصم التأخير والانصراف المبكر (${attendanceText})</td><td class="mono neg">${formatMoney(row.attendanceDeduction)}</td></tr>
        <tr><td>خصم أيام ${escapeHtml(weeklyOffLabel)} (${row.sundayDeductionDays.toFixed(2)} يوم — مطبّق ضمن الأيام المستحقة)</td><td class="mono">—</td></tr>
        <tr><td>الجزاءات (${penaltyText})</td><td class="mono neg">${formatMoney(row.penaltyDeduction)}</td></tr>
        <tr><td>السُلف</td><td class="mono neg">${formatMoney(row.loanDeduction)}</td></tr>
        <tr><td>إجمالي الخصومات</td><td class="mono neg">${formatMoney(row.totalDeduction)}</td></tr>
        <tr class="net-row"><td>صافي المستحق</td><td class="mono">${formatMoney(row.netPay)}</td></tr>
      </table>
      <div class="sign"><span>توقيع العامل: ....................</span><span>توقيع الإدارة: ....................</span></div>
    </div>`;
  };


  const workerSheetStyles = `
    @page{size:A4 portrait;margin:8mm}
    *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{font-family:Tahoma,Arial,sans-serif;padding:3mm;color:#0f172a;margin:0;background:#fff}
    .sheet{width:100%;margin:0 auto;page-break-after:always;break-after:page}
    .sheet:last-child{page-break-after:auto;break-after:auto}
    .head{display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:2px solid #334155;padding-bottom:3mm;margin-bottom:3mm}
    .brand{text-align:right}
    .title{text-align:left}
    h1{font-size:15px;margin:0 0 1mm}
    .title p{font-size:11px;color:#475569;margin:0;font-weight:bold}
    table{width:100%;border-collapse:collapse;font-size:9px;margin-bottom:3mm}
    th,td{border:1px solid #94a3b8;padding:4px 5px;text-align:center;vertical-align:middle}
    th{background:#e2e8f0;font-weight:bold;font-size:9px}
    td.label{background:#f1f5f9;font-weight:bold;width:18%}
    td.note{text-align:right;font-size:8.5px;color:#334155}
    .mono{font-family:'Courier New',monospace;font-size:8.5px}
    .pos{color:#047857;font-weight:bold}
    .neg{color:#b91c1c;font-weight:bold}
    .days tbody td{padding:3px 4px}
    .row-ok{background:#f0fdf4}
    .row-warn{background:#fef9c3}
    .row-absent{background:#fee2e2;color:#991b1b;font-weight:bold}
    .row-overtime{background:#dbeafe;color:#1e40af}
    .row-info{background:#eef2ff}
    .row-off{background:#f8fafc;color:#64748b}
    .totals{width:62%;margin-left:auto}
    .totals td{font-size:10px;padding:5px 8px}
    .totals td:first-child{background:#f1f5f9;font-weight:bold;text-align:right;width:64%}
    .totals .net-row td{background:#dcfce7;color:#047857;font-weight:bold;font-size:12px;border-top:2px solid #059669}
    .sign{margin-top:8mm;display:flex;justify-content:space-between;font-size:10px}
    @media print{
      .screen-only{display:none !important}
      .sheet{page-break-after:always}
    }
  `;

  const printWorkerSheet = (row: PayrollRow) => {
    const win = window.open('', '_blank', 'width=900,height=800');
    if (!win) {
      addFlashMessage('فضلاً اسمح بالنوافذ المنبثقة للطباعة', 'danger');
      return;
    }
    win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8" />
      <title>ورقة مرتب ${escapeHtml(row.employee.name)}</title>
      <style>${workerSheetStyles}</style></head><body>${buildWorkerSheetHtml(row)}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  const printAllEnvelopes = () => {
    if (rows.length === 0) {
      addFlashMessage('لا يوجد موظفون لطباعة أوراقهم', 'danger');
      return;
    }
    // ورقة A4 كاملة لكل عامل، مع فاصل صفحات بين الأوراق.
    const sheets = rows.map((row) => buildWorkerSheetHtml(row)).join('');
    const win = window.open('', '_blank', 'width=1000,height=800');
    if (!win) {
      addFlashMessage('فضلاً اسمح بالنوافذ المنبثقة للطباعة', 'danger');
      return;
    }
    win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8" />
      <title>أوراق مرتبات العمال — ${escapeHtml(month)}</title>
      <style>${workerSheetStyles}</style></head><body>${sheets}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-l from-emerald-600 to-teal-600 rounded-3xl p-5 text-white shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold text-emerald-50">
              إجمالي المرتبات المطلوب دفعها حالياً
            </p>
            <p className="text-3xl font-black mt-1 font-mono">{formatMoney(totals.netPay)}</p>
            <p className="text-[11px] font-bold text-emerald-50 mt-1">
              عدد العمال: {rows.length} — الأجور المكتسبة: {formatMoney(totals.earnedBase)} — إجمالي
              الخصومات: {formatMoney(totals.totalDeduction)}
            </p>
          </div>
          <button
            type="button"
            onClick={printAllEnvelopes}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-white text-emerald-700 text-[11px] font-black hover:bg-emerald-50 transition cursor-pointer shrink-0"
          >
            <Printer className="w-4 h-4" />
            طباعة أوراق مرتبات العمال للجميع A4
          </button>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-slate-900">مرتبات الشهر</h2>
            <p className="text-[11px] font-bold text-slate-500 mt-0.5">
              صافي المرتب = الأجر المكتسب (أيام الحضور + أيام {weeklyOffLabel} المدفوعة بحد أقصى 30 يوماً) +
              الإضافي − (التأخير + الجزاءات + السُلف).
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className={`${inputClass} font-mono w-auto`}
            />
            <button
              type="button"
              onClick={() => void loadPayrollData()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-[11px] font-black text-slate-700 hover:bg-slate-50 transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              تحديث
            </button>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-black text-slate-700">
            <Users className="w-3.5 h-3.5 text-purple-600" />
            عدد الموظفين: {rows.length}
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-50 border border-purple-200 text-[11px] font-black text-purple-700">
            <Banknote className="w-3.5 h-3.5" />
            الأجور المكتسبة: {formatMoney(totals.earnedBase)}
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] font-black text-emerald-700">
            <Timer className="w-3.5 h-3.5" />
            إجمالي الإضافي: {formatMoney(totals.overtimePay)}
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] font-black text-rose-700">
            <AlertTriangle className="w-3.5 h-3.5" />
            إجمالي الخصومات: {formatMoney(totals.totalDeduction)}
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] font-black text-emerald-700">
            <Wallet className="w-3.5 h-3.5" />
            صافي المستحق: {formatMoney(totals.netPay)}
          </span>
        </div>

        {isLoading ? (
          <div className="p-10 text-center text-xs font-bold text-slate-400">جاري التحميل...</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <Users className="w-8 h-8 mx-auto text-slate-300 mb-2" />
            <p className="text-xs font-black text-slate-700">لا يوجد موظفون لحساب المرتبات</p>
            <p className="text-[11px] font-bold text-slate-500 mt-1">
              أضف الموظفين أولاً من قسم الموظفين لتتمكن من إنشاء المرتبات.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-right px-4 py-2.5 font-black whitespace-nowrap">الموظف</th>
                  <th className="text-right px-4 py-2.5 font-black whitespace-nowrap">الوظيفة / القسم</th>
                  <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">
                    الأيام المستحقة
                  </th>
                  <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">
                    الأجر المكتسب
                  </th>
                  <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">الإضافي</th>
                  <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">
                    خصم التأخير
                  </th>
                  <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">جزاءات</th>
                  <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">سُلف</th>
                  <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">الصافي</th>
                  <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.employee.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="font-black text-slate-900">{row.employee.name}</p>
                      <p className="font-bold text-[10px] text-slate-400 font-mono">
                        {row.employee.employee_code || '-'}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-600 whitespace-nowrap">
                      <p>{row.employee.job_title || '—'}</p>
                      <p className="text-[10px] text-slate-400">
                        {row.employee.department_label ||
                          (row.employee.department
                            ? HR_DEPARTMENT_LABELS[row.employee.department]
                            : '—')}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-black text-slate-800 whitespace-nowrap">
                      <p>{row.earnedDays.toFixed(2)} يوم</p>
                      <p className="text-[10px] text-slate-400">
                        حضور {row.attendedDays.toFixed(2)} + {weeklyOffLabel} {row.paidSundayDays.toFixed(2)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-black text-slate-800 whitespace-nowrap">
                      <p>{formatMoney(row.earnedBase)}</p>
                      <p className="text-[10px] text-slate-400">من {formatMoney(row.baseSalary)}</p>
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-bold text-emerald-600 whitespace-nowrap">
                      <p>{formatMoney(row.overtimePay)}</p>
                      <p className="text-[10px] text-slate-400">
                        {row.overtimeDays} يوم / {row.overtimeHours} ساعة
                      </p>
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-bold text-rose-600 whitespace-nowrap">
                      <p>{formatMoney(row.attendanceDeduction)}</p>
                      <p className="text-[10px] text-slate-400">
                        {row.attendanceDays} يوم / {row.attendanceHours} ساعة
                        {row.sundayDeductionDays > 0
                          ? ` (${weeklyOffLabel} ${row.sundayDeductionDays.toFixed(2)} يوم داخل المستحق)`
                          : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-bold text-rose-600 whitespace-nowrap">
                      <p>{formatMoney(row.penaltyDeduction)}</p>
                      <p className="text-[10px] text-slate-400">
                        {row.penaltyDays} يوم / {row.penaltyHours} ساعة
                      </p>
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-bold text-rose-600 whitespace-nowrap">
                      {formatMoney(row.loanDeduction)}
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-black whitespace-nowrap">
                      <span
                        className={
                          row.netPay >= 0
                            ? 'px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'px-2 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200'
                        }
                      >
                        {formatMoney(row.netPay)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => printWorkerSheet(row)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white text-[10px] font-black hover:bg-indigo-700 transition cursor-pointer whitespace-nowrap"
                      >
                        <Printer className="w-3 h-3" />
                        ورقة العامل
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50">
                <tr>
                  <td className="px-4 py-3 font-black text-slate-900" colSpan={2}>
                    الإجمالي
                  </td>
                  <td className="px-4 py-3 text-center font-mono font-black text-slate-900">—</td>
                  <td className="px-4 py-3 text-center font-mono font-black text-slate-900">
                    {formatMoney(totals.earnedBase)}
                  </td>
                  <td className="px-4 py-3 text-center font-mono font-black text-emerald-700">
                    {formatMoney(totals.overtimePay)}
                  </td>
                  <td className="px-4 py-3 text-center font-mono font-black text-rose-700">
                    {formatMoney(totals.attendanceDeduction)}
                  </td>
                  <td className="px-4 py-3 text-center font-mono font-black text-rose-700">
                    {formatMoney(totals.penaltyDeduction)}
                  </td>
                  <td className="px-4 py-3 text-center font-mono font-black text-rose-700">
                    {formatMoney(totals.loanDeduction)}
                  </td>
                  <td className="px-4 py-3 text-center font-mono font-black text-emerald-700">
                    {formatMoney(totals.netPay)}
                  </td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-start gap-2 px-4 py-3 rounded-2xl bg-blue-50 border border-blue-200 text-blue-800 text-[11px] font-bold">
        <Info className="w-4 h-4 shrink-0" />
        <span>
          يُحسب الأجر على أيام الحضور الفعلي + أيام {weeklyOffLabel} المدفوعة (بحد أقصى 30 يوماً)، وتُخصم
          قواعد التأخير ومخالفات الجزاءات والسُلف فقط. تُتجاهل السجلات «المرفوضة»، وراتب اليوم =
          المرتب ÷ 30 وراتب الساعة = راتب اليوم ÷ 8.
        </span>
      </div>
    </div>
  );
};




