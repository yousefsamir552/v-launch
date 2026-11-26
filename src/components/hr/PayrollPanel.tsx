import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Users, Briefcase, Clock, Plus, Search, Pencil, Trash2, X, Save,
  AlertTriangle, CalendarDays, Building2, Coffee, Timer, Info, Wallet,
  Scale, Banknote, RefreshCw, Download, Upload, FileSpreadsheet, FileText,
  CheckCircle2, XCircle, UsersRound, LayoutList, History, Printer, BarChart3,
  Lock, Unlock
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  escapeHtml,
  logClientPrintAction,
  openUnifiedPrintWindow,
  renderSignatureBar,
  renderUnifiedPrintHeader
} from '../../utils/printShared';
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
  dailyRateFor, hourlyRateFor, workingHoursPerDayFor, timeToMinutes, lateMinutesFor, matchLateRule,
  isAttendedRecord, MonthAccrual, computeMonthAccrual
} from './hrShared';

interface PayrollRow {
  employee: HREmployee;
  baseSalary: number;
  attendedDays: number;
  paidSundayDays: number;
  workedWeeklyOffDays: number;
  weeklyOffExtraDays: number;
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
  const { addFlashMessage, logAction, globalSettings, currentUser, canManagePermissions } = useApp();
  const canUnlockPayroll = Boolean(
    currentUser?.is_sudo ||
    currentUser?.username?.toLowerCase() === 'sudo' ||
    canManagePermissions()
  );

  const [month, setMonth] = useState(currentMonth());
  const [records, setRecords] = useState<HRAttendanceRecord[]>([]);
  const [penalties, setPenalties] = useState<HRPenalty[]>([]);
  const [loans, setLoans] = useState<HRLoan[]>([]);
  const [settings, setSettings] = useState<HRAttendanceSettings | null>(null);
  const [lockedSnapshot, setLockedSnapshot] = useState<any | null>(null);
  const [isLockModalOpen, setIsLockModalOpen] = useState(false);
  const [isUnlockModalOpen, setIsUnlockModalOpen] = useState(false);
  const [lockNotes, setLockNotes] = useState('');
  const [isLocking, setIsLocking] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const effectiveSettings = (lockedSnapshot?.settings_snapshot || settings) as HRAttendanceSettings | null;
  // يوم الإجازة الأسبوعية المدفوعة من الإعدادات (الأحد افتراضياً).
  const weeklyOffIndex = weeklyOffIndexFromKey(effectiveSettings?.weekly_off_day);
  const weeklyOffLabel = weeklyOffDayLabel(weeklyOffIndex);
  const shiftHours = workingHoursPerDayFor(effectiveSettings);
  const weeklyOffMultiplier =
    Number(effectiveSettings?.weekly_off_work_multiplier ?? 1.0) >= 0
      ? Number(effectiveSettings?.weekly_off_work_multiplier ?? 1.0)
      : 1.0;

  const loadPayrollData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [recordsRes, penaltiesRes, loansRes, settingsRes, snapshotRes] = await Promise.all([
        api.getHRAttendanceRecords({ month, includePrevWeek: true }),
        api.getHRPenalties(month),
        api.getHRLoans(month),
        api.getHRAttendanceSettings().catch(() => null),
        api.getHRPayrollSnapshot(month).catch(() => ({ is_locked: false, snapshot: null }))
      ]);
      setRecords(Array.isArray(recordsRes) ? recordsRes : []);
      setPenalties(Array.isArray(penaltiesRes) ? penaltiesRes : []);
      setLoans(Array.isArray(loansRes) ? loansRes : []);
      setSettings(settingsRes || null);
      setLockedSnapshot(snapshotRes?.is_locked ? snapshotRes.snapshot : null);
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

  const handleLockMonth = async () => {
    setIsLocking(true);
    try {
      const res = await api.lockHRPayroll(month, lockNotes.trim());
      setLockedSnapshot(res?.snapshot || null);
      setIsLockModalOpen(false);
      setLockNotes('');
      addFlashMessage(`تم اعتماد وإغلاق كشف رواتب شهر ${month} بنجاح وتجميد كافة الأرقام`, 'success');
      logAction('الموارد البشرية', `اعتماد وإغلاق كشف مرتبات شهر ${month}`);
    } catch (err: any) {
      addFlashMessage(err?.message || 'فشل اعتماد وإغلاق الشهر', 'danger');
    } finally {
      setIsLocking(false);
    }
  };

  const handleUnlockMonth = async () => {
    setIsLocking(true);
    try {
      await api.unlockHRPayroll(month);
      setLockedSnapshot(null);
      setIsUnlockModalOpen(false);
      addFlashMessage(`تم إعادة فتح كشف رواتب شهر ${month}`, 'info');
      logAction('الموارد البشرية', `إعادة فتح كشف مرتبات شهر ${month}`);
      await loadPayrollData();
    } catch (err: any) {
      addFlashMessage(err?.message || 'فشل إعادة فتح الشهر', 'danger');
    } finally {
      setIsLocking(false);
    }
  };

  const rows = useMemo<PayrollRow[]>(() => {
    // عند اعتماد وإغلاق الشهر تُعرض اللقطة المجمّدة كما هي (لا تتأثر بأي تعديل مستقبلي للرواتب أو القواعد أو إيقاف الموظفين).
    if (lockedSnapshot && Array.isArray(lockedSnapshot.rows)) {
      return lockedSnapshot.rows.map((item: any) => ({
        employee: {
          id: String(item.employee_id || ''),
          employee_code: item.employee_code || '',
          name: item.employee_name || '—',
          job_id: '',
          job_title: item.job_title || '—',
          department: item.department || undefined,
          department_label: item.department_label || '',
          monthly_salary: Number(item.base_salary) || 0,
          rule_application_mode: 'auto',
          is_active: item.is_active !== false
        } as HREmployee,
        baseSalary: Number(item.base_salary) || 0,
        attendedDays: Number(item.attended_days) || 0,
        paidSundayDays: Number(item.paid_sunday_days) || 0,
        workedWeeklyOffDays: Number(item.worked_weekly_off_days) || 0,
        weeklyOffExtraDays: Number(item.weekly_off_extra_days) || 0,
        earnedDays: Number(item.earned_days) || 0,
        earnedBase: Number(item.earned_base) || 0,
        overtimeDays: Number(item.overtime_days) || 0,
        overtimeHours: Number(item.overtime_hours) || 0,
        overtimePay: Number(item.overtime_pay) || 0,
        attendanceDays: Number(item.attendance_days) || 0,
        attendanceHours: Number(item.attendance_hours) || 0,
        attendanceDeduction: Number(item.attendance_deduction) || 0,
        sundayDeductionDays: Number(item.sunday_deduction_days) || 0,
        sundayDeduction: 0,
        penaltyDays: Number(item.penalty_days) || 0,
        penaltyHours: Number(item.penalty_hours) || 0,
        penaltyDeduction: Number(item.penalty_deduction) || 0,
        loanDeduction: Number(item.loan_deduction) || 0,
        totalDeduction: Number(item.total_deduction) || 0,
        netPay: Number(item.net_pay) || 0
      }));
    }

    const inMonth = (date?: string) => !!date && date.startsWith(month);
    const today = new Date();
    const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const lastDayOfCurrentMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const upToIso =
      month === currentMonthKey && today.getDate() < lastDayOfCurrentMonth
        ? isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1))
        : undefined;
    const officialStart = settings?.official_start_time || '08:30';
    const officialEnd = settings?.official_end_time || '17:30';
    const r2 = (v: number) => Math.round(v * 100) / 100;

    return employees
      .filter((emp) => {
        if (emp.is_active !== false) return true;
        // مطابقة الباك إند: الموظف غير النشط الذي له سجلات حضور أو جزاءات أو سُلف في هذا الشهر يظهر في كشف الشهر.
        return (
          records.some((r) => r.employee_id === emp.id && inMonth(r.date)) ||
          penalties.some((p) => p.employee_id === emp.id && inMonth(p.date)) ||
          loans.some((l) => l.employee_id === emp.id && inMonth(l.date))
        );
      })
      .map((employee) => {
        const baseSalary = Number(employee.monthly_salary) || 0;
        const dayRate = dailyRateFor(baseSalary);
        const hourRate = hourlyRateFor(baseSalary, shiftHours);

        // خصم التأخير/الانصراف المبكر (على أيام الحضور المعتمدة فقط — المرفوض وبانتظار المراجعة لا يُخصم).
        let attendanceDays = 0;
        let attendanceHours = 0;
        let overtimeDays = 0;
        let overtimeHours = 0;
        records.forEach((record) => {
          if (record.employee_id !== employee.id) return;
          if (!inMonth(record.date)) return;
          // يوم الإجازة الأسبوعية بدون بصمة حضور = إجازة مدفوعة (تُحسب ضمن الأيام المستحقة).
          const recordDay = new Date(`${record.date}T00:00:00`);
          if (recordDay.getDay() === weeklyOffIndex && !record.check_in) return;

          // الإضافي يُحسب دائماً حتى عند رفض الخصم (رفض الخصم يلغي الغرامة فقط لا اليوم).
          overtimeDays += Number(record.overtime_days) || 0;
          overtimeHours += Number(record.overtime_hours) || 0;

          // الغياب غير محسوب ضمن الأيام المستحقة أصلاً، فلا نخصمه مرة ثانية.
          if (!isAttendedRecord(record)) return;
          if (record.is_excused) return;
          if (record.review_status === 'rejected' || record.review_status === 'pending_review') return;

          let dedDays = Number(record.calculated_deduction_days) || 0;
          let dedHours = Number(record.calculated_deduction_hours) || 0;
          // احتياطي ديناميكي: لو لم يُخزَّن الخصم (لسجل معتمد أو تلقائي)، طبّق شريحة التأخير من الإعدادات.
          if (dedDays === 0 && dedHours === 0 && employee.rule_application_mode !== 'manual_review') {
            const lateMinutes = lateMinutesFor(record.check_in, officialStart, officialEnd);
            const rule = matchLateRule(settings?.rules_json, lateMinutes);
            const ruleValue = Number(rule?.deduction_value) || 0;
            if (rule && ruleValue > 0 && rule.apply_mode !== 'manual_review') {
              if (rule.deduction_type === 'days') dedDays = ruleValue;
              else dedHours = ruleValue;
            }
          }
          attendanceDays += dedDays;
          attendanceHours += dedHours;
        });

        // الأجر المكتسب وفق القواعد المؤكدة (30 - غياب - خصم إجازة، + عمل يوم الإجازة × المضاعف فوق سقف الـ30).
        const accrual = computeMonthAccrual(
          employee.id,
          records,
          month,
          upToIso,
          weeklyOffIndex,
          weeklyOffMultiplier
        );
        const earnedBaseRaw = accrual.earnedDaysRaw * dayRate;

        const sundayDeductionDays = accrual.sundayDeductionDays;

        let penaltyDays = 0;
        let penaltyHours = 0;
        penalties.forEach((penalty) => {
          if (penalty.employee_id !== employee.id) return;
          if (!inMonth(penalty.date)) return;
          if (penalty.penalty_type === 'days') penaltyDays += Number(penalty.value) || 0;
          else penaltyHours += Number(penalty.value) || 0;
        });

        const loanDeductionRaw = loans
          .filter((loan) => loan.employee_id === employee.id && inMonth(loan.date))
          .reduce((sum, loan) => sum + (Number(loan.amount) || 0), 0);

        const attendanceDeductionRaw = attendanceDays * dayRate + attendanceHours * hourRate;
        const sundayDeduction = 0;
        const penaltyDeductionRaw = penaltyDays * dayRate + penaltyHours * hourRate;
        const overtimePayRaw = overtimeDays * dayRate + overtimeHours * hourRate;
        const totalDeductionRaw = attendanceDeductionRaw + penaltyDeductionRaw + loanDeductionRaw;

        return {
          employee,
          baseSalary: r2(baseSalary),
          attendedDays: accrual.attendedDays,
          paidSundayDays: accrual.paidSundayDays,
          workedWeeklyOffDays: accrual.workedWeeklyOffDays,
          weeklyOffExtraDays: accrual.weeklyOffExtraDays,
          earnedDays: accrual.earnedDays,
          earnedBase: r2(earnedBaseRaw),
          overtimeDays: r2(overtimeDays),
          overtimeHours: r2(overtimeHours),
          overtimePay: r2(overtimePayRaw),
          attendanceDays: r2(attendanceDays),
          attendanceHours: r2(attendanceHours),
          attendanceDeduction: r2(attendanceDeductionRaw),
          sundayDeductionDays,
          sundayDeduction,
          penaltyDays: r2(penaltyDays),
          penaltyHours: r2(penaltyHours),
          penaltyDeduction: r2(penaltyDeductionRaw),
          loanDeduction: r2(loanDeductionRaw),
          totalDeduction: r2(totalDeductionRaw),
          netPay: r2(earnedBaseRaw + overtimePayRaw - totalDeductionRaw)
        };
      });
  }, [employees, records, penalties, loans, month, settings, lockedSnapshot, weeklyOffIndex, shiftHours, weeklyOffMultiplier]);

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
          // إجمالي النقد المطلوب دفعه: لا يُسمح لرصيد سالب لعامل أن يخفض مستحقات باقي العمال.
          netPay: acc.netPay + Math.max(0, row.netPay)
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
    // نُبقي سجلات الأسبوع السابق من الشهر الماضي داخل recordsByDate حتى يتطابق خصم أول يوم إجازة 100% مع جدول المرتبات.
    const recordsByDate = new Map<string, HRAttendanceRecord>();
    records
      .filter((record) => record.employee_id === row.employee.id)
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
    const hourRate = hourlyRateFor(row.baseSalary, shiftHours);
    const officialStart = effectiveSettings?.official_start_time || '08:30';
    const officialEnd = effectiveSettings?.official_end_time || '17:30';
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
      // اليوم الذي عُمل فيه يُطبع كيوم عمل إضافي فوق سقف الـ30 يوماً بمضاعف الإعدادات.
      if (isWeeklyOff && !(record && record.check_in)) {
        const weekDates = weekDatesBeforeWeeklyOff(iso);
        const hasWeekData = weekDates.some((dateStr) => recordsByDate.has(dateStr));
        const absentCount = weekDates.filter((dateStr) => {
          const rec = recordsByDate.get(dateStr);
          return !rec || !isAttendedRecord(rec);
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

      const waivedByReview = record.review_status === 'rejected' || record.review_status === 'pending_review';
      let dedDays = 0;
      let dedHours = 0;
      if (isAttendedRecord(record) && !record.is_excused && !waivedByReview) {
        dedDays = Number(record.calculated_deduction_days) || 0;
        dedHours = Number(record.calculated_deduction_hours) || 0;
        if (dedDays === 0 && dedHours === 0 && row.employee.rule_application_mode !== 'manual_review') {
          const lm = lateMinutesFor(record.check_in, officialStart, officialEnd);
          const rule = matchLateRule(effectiveSettings?.rules_json, lm);
          const rv = Number(rule?.deduction_value) || 0;
          if (rule && rv > 0 && rule.apply_mode !== 'manual_review') {
            if (rule.deduction_type === 'days') dedDays = rv;
            else dedHours = rv;
          }
        }
      }
      const deduction = dedDays * dayRate + dedHours * hourRate;
      const overtime =
        (Number(record.overtime_days) || 0) * dayRate +
        (Number(record.overtime_hours) || 0) * hourRate;
      const lateMinutes = lateMinutesFor(record.check_in, officialStart, officialEnd);
      let reason = isWeeklyOff ? `عمل يوم الإجازة الأسبوعية (×${weeklyOffMultiplier})` : 'حضور كامل';
      if (record.is_excused) reason = `بعذر: ${record.excuse_note || 'بدون خصم'}`;
      else if (record.review_status === 'rejected') reason = 'تم رفض الخصم (بدون خصم)';
      else if (record.review_status === 'pending_review') reason = 'بانتظار المراجعة (غير مخصوم حتى الاعتماد)';
      else if (record.status === 'absent') reason = 'غياب بدون عذر';
      else if (record.status === 'missing_punch') reason = 'بصمة ناقصة تحتاج مراجعة';
      else if (record.status === 'leave') reason = statusLabels[record.status] || 'إجازة';
      else if (lateMinutes > 0 && !isWeeklyOff) reason = `تأخير ${lateMinutes} دقيقة`;
      else if (deduction > 0) reason = 'خصم تأخير / انصراف مبكر';

      // أحمر للغياب، أزرق لأيام الإضافي/عمل الإجازة، أصفر للتأخير.
      let rowClass = 'row-ok';
      if (record.status === 'absent') rowClass = 'row-absent';
      else if (overtime > 0 || isWeeklyOff) rowClass = 'row-overtime';
      else if (record.status === 'missing_punch') rowClass = 'row-info';
      else if (record.status === 'leave') rowClass = 'row-off';
      else if (deduction > 0) rowClass = 'row-warn';

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
    const extraOffText =
      row.workedWeeklyOffDays > 0
        ? ` + عمل إجازة ${row.workedWeeklyOffDays}×${weeklyOffMultiplier} (${row.weeklyOffExtraDays.toFixed(2)} يوم)`
        : '';

    const headerHtml = renderUnifiedPrintHeader({
      siteName: globalSettings.site_name,
      logo: globalSettings.logo,
      title: `ورقة مرتب عامل — شهر ${month}`,
      subtitle: `${row.employee.name} (${row.employee.employee_code || '—'})`,
      metaItems: [`القسم: ${workerDepartment(row)}`],
      compact: true
    });

    return `
      ${headerHtml}
      <table class="info">
        <tr>
          <td class="label">اسم العامل</td><td><strong>${escapeHtml(row.employee.name)}</strong></td>
          <td class="label">كود البصمة</td><td class="mono">${escapeHtml(row.employee.employee_code || '-')}</td>
        </tr>
        <tr>
          <td class="label">الوظيفة</td><td>${escapeHtml(row.employee.job_title || '—')}</td>
          <td class="label">القسم</td><td>${escapeHtml(workerDepartment(row))}</td>
        </tr>
        <tr>
          <td class="label">الأيام المستحقة</td>
          <td class="mono"><strong>${row.earnedDays.toFixed(2)} يوم</strong></td>
          <td class="label">تفصيل الأيام</td>
          <td class="mono">حضور ${row.attendedDays.toFixed(2)} + ${escapeHtml(weeklyOffLabel)} ${row.paidSundayDays.toFixed(2)}${escapeHtml(extraOffText)}</td>
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
          <th style="width:19%">الأيام / التاريخ</th>
          <th style="width:8%">حضور</th>
          <th style="width:8%">انصراف</th>
          <th style="width:11%">الإضافي</th>
          <th style="width:11%">السُلف</th>
          <th style="width:11%">الخصومات</th>
          <th class="text-right" style="width:32%">ملاحظات</th>
        </tr></thead>
        <tbody>${dayRowsHtml}</tbody>
      </table>
      <div class="bottom-summary">
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
      </div>
      ${renderSignatureBar(['توقيع العامل بالاستلام', 'مسؤول الموارد البشرية', 'اعتماد الإدارة'], true)}
    `;
  };

  const workerSheetExtraCss = `
    table.info { font-size: 8.8px; margin-bottom: 4px; }
    table.info td { padding: 2.5px 5px; }
    table.info td.label { background: #f1f5f9 !important; font-weight: 800; width: 16%; text-align: right; }
    table.days { font-size: 8px; margin-bottom: 4px; table-layout: fixed; }
    table.days th { font-size: 8.2px; padding: 2.5px 3px; }
    table.days tbody td { padding: 1.6px 3px; line-height: 1.18; }
    table.days td.note { text-align: right; font-size: 7.8px; color: #334155; }
    .pos { color: #047857; font-weight: 800; }
    .neg { color: #be123c; font-weight: 800; }
    table.days tbody tr.row-ok td { background: #f0fdf4 !important; }
    table.days tbody tr.row-warn td { background: #fefce8 !important; }
    table.days tbody tr.row-absent td { background: #fef2f2 !important; color: #991b1b; font-weight: 700; }
    table.days tbody tr.row-overtime td { background: #eff6ff !important; color: #1e40af; }
    table.days tbody tr.row-info td { background: #eef2ff !important; }
    table.days tbody tr.row-off td { background: #f8fafc !important; color: #64748b; }
    .bottom-summary { break-inside: avoid; page-break-inside: avoid; }
    table.totals { width: 64%; margin-left: auto; margin-right: 0; font-size: 8.8px; margin-bottom: 4px; }
    table.totals td { padding: 2.5px 6px; line-height: 1.2; }
    table.totals td:first-child { background: #f1f5f9 !important; font-weight: 800; text-align: right; width: 68%; }
    table.totals tr.net-row td { background: #dcfce7 !important; color: #047857; font-weight: 800; font-size: 10.5px; border-top: 2px solid #047857; }
  `;

  const printWorkerSheet = (row: PayrollRow) => {
    const opened = openUnifiedPrintWindow({
      documentTitle: `ورقة مرتب ${row.employee.name} - ${month}`,
      mode: 'fit-single-page',
      orientation: 'portrait',
      sheetsHtml: [buildWorkerSheetHtml(row)],
      extraCss: workerSheetExtraCss,
      onPopupBlocked: () => addFlashMessage('فضلاً اسمح بالنوافذ المنبثقة للطباعة', 'danger')
    });
    if (opened) {
      logClientPrintAction(
        'الموارد البشرية',
        `طباعة ورقة مرتب الموظف ${row.employee.name} لشهر ${month}`,
        row.employee.name
      );
    }
  };

  const printAllEnvelopes = () => {
    if (rows.length === 0) {
      addFlashMessage('لا يوجد موظفون لطباعة أوراقهم', 'danger');
      return;
    }
    const opened = openUnifiedPrintWindow({
      documentTitle: `أوراق مرتبات العمال — ${month}`,
      mode: 'fit-single-page',
      orientation: 'portrait',
      sheetsHtml: rows.map((row) => buildWorkerSheetHtml(row)),
      extraCss: workerSheetExtraCss,
      onPopupBlocked: () => addFlashMessage('فضلاً اسمح بالنوافذ المنبثقة للطباعة', 'danger')
    });
    if (opened) {
      logClientPrintAction(
        'الموارد البشرية',
        `طباعة أوراق مرتبات جميع العمال (${rows.length} موظف) لشهر ${month}`,
        `مرتبات شهر ${month}`
      );
    }
  };

  const printGroupPayrollTable = () => {
    if (rows.length === 0) {
      addFlashMessage('لا يوجد موظفون لطباعة كشف المرتبات', 'danger');
      return;
    }
    const rowsHtml = rows
      .map(
        (row, idx) => `<tr>
          <td class="num muted">${idx + 1}</td>
          <td class="mono">${escapeHtml(row.employee.employee_code || '-')}</td>
          <td class="text-right"><strong>${escapeHtml(row.employee.name)}</strong></td>
          <td class="text-right">${escapeHtml(row.employee.job_title || '—')} / ${escapeHtml(workerDepartment(row))}</td>
          <td class="num"><strong>${row.earnedDays.toFixed(2)}</strong><div class="sub">ح ${row.attendedDays.toFixed(1)} + إ ${row.paidSundayDays.toFixed(1)}</div></td>
          <td class="num">${formatMoney(row.baseSalary)}</td>
          <td class="num"><strong>${formatMoney(row.earnedBase)}</strong></td>
          <td class="num ok">${formatMoney(row.overtimePay)}</td>
          <td class="num bad">${formatMoney(row.attendanceDeduction)}</td>
          <td class="num bad">${formatMoney(row.penaltyDeduction)}</td>
          <td class="num bad">${formatMoney(row.loanDeduction)}</td>
          <td class="num bad"><strong>${formatMoney(row.totalDeduction)}</strong></td>
          <td class="num ${row.netPay >= 0 ? 'ok' : 'bad'}"><strong>${formatMoney(row.netPay)}</strong></td>
          <td></td>
        </tr>`
      )
      .join('');

    const bodyHtml = `
      <div class="p-kpis">
        <div class="p-kpi"><span class="p-kpi-label">عدد الموظفين</span><span class="p-kpi-val">${rows.length.toLocaleString('ar-EG')}</span></div>
        <div class="p-kpi"><span class="p-kpi-label">إجمالي الأجور المكتسبة</span><span class="p-kpi-val">${formatMoney(totals.earnedBase)}</span></div>
        <div class="p-kpi"><span class="p-kpi-label">إجمالي الإضافي</span><span class="p-kpi-val ok">${formatMoney(totals.overtimePay)}</span></div>
        <div class="p-kpi"><span class="p-kpi-label">إجمالي الخصومات والسُلف</span><span class="p-kpi-val bad">${formatMoney(totals.totalDeduction)}</span></div>
        <div class="p-kpi"><span class="p-kpi-label">صافي المرتبات المستحقة</span><span class="p-kpi-val ok">${formatMoney(totals.netPay)}</span></div>
      </div>

      <table class="group-payroll-table">
        <thead>
          <tr>
            <th style="width:3%">#</th>
            <th style="width:6%">الكود</th>
            <th class="text-right" style="width:13%">الموظف</th>
            <th class="text-right" style="width:12%">الوظيفة / القسم</th>
            <th style="width:8%">الأيام المستحقة</th>
            <th style="width:7%">المرتب</th>
            <th style="width:7%">الأجر المكتسب</th>
            <th style="width:7%">الإضافي</th>
            <th style="width:7%">التأخير</th>
            <th style="width:6%">الجزاءات</th>
            <th style="width:6%">السُلف</th>
            <th style="width:7%">إجمالي الخصم</th>
            <th style="width:7%">الصافي</th>
            <th style="width:6%">التوقيع</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot>
          <tr class="total">
            <td colspan="6" class="text-right">الإجمالي العام (${rows.length} موظف)</td>
            <td class="num">${formatMoney(totals.earnedBase)}</td>
            <td class="num ok">${formatMoney(totals.overtimePay)}</td>
            <td class="num bad">${formatMoney(totals.attendanceDeduction)}</td>
            <td class="num bad">${formatMoney(totals.penaltyDeduction)}</td>
            <td class="num bad">${formatMoney(totals.loanDeduction)}</td>
            <td class="num bad">${formatMoney(totals.totalDeduction)}</td>
            <td class="num ok">${formatMoney(totals.netPay)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>

      ${renderSignatureBar(['إعداد الموارد البشرية', 'المراجعة والحسابات', 'اعتماد المدير العام'], true)}
    `;

    const opened = openUnifiedPrintWindow({
      documentTitle: `كشف المرتبات الجماعي — ${month}`,
      mode: 'multi-page-table',
      orientation: 'landscape',
      header: {
        siteName: globalSettings.site_name,
        logo: globalSettings.logo,
        title: `كشف المرتبات الجماعي — شهر ${month}`,
        subtitle: lockedSnapshot ? 'كشف معتمد ومغلق نهائياً' : 'كشف مرتبات الشهر التفصيلي لجميع العاملين',
        metaItems: [`عدد العمال: ${rows.length.toLocaleString('ar-EG')}`]
      },
      bodyHtml,
      extraCss: `
        table.group-payroll-table { font-size: 8.6px; }
        table.group-payroll-table th, table.group-payroll-table td { padding: 3.5px 4px; }
        .sub { font-size: 7.4px; color: #64748b; }
      `,
      onPopupBlocked: () => addFlashMessage('فضلاً اسمح بالنوافذ المنبثقة للطباعة', 'danger')
    });
    if (opened) {
      logClientPrintAction(
        'الموارد البشرية',
        `طباعة كشف المرتبات الجماعي (${rows.length} موظف) لشهر ${month}`,
        `كشف مرتبات ${month}`
      );
    }
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
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {lockedSnapshot ? (
              canUnlockPayroll ? (
                <button
                  type="button"
                  onClick={() => setIsUnlockModalOpen(true)}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-amber-400 text-slate-950 text-[11px] font-black hover:bg-amber-300 transition cursor-pointer"
                >
                  <Unlock className="w-4 h-4" />
                  الشهر معتمد ومغلق — إعادة فتح
                </button>
              ) : (
                <span className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-amber-400/90 text-slate-950 text-[11px] font-black">
                  <Lock className="w-4 h-4" />
                  الشهر معتمد ومغلق
                </span>
              )
            ) : (
              <button
                type="button"
                onClick={() => setIsLockModalOpen(true)}
                disabled={rows.length === 0}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-900/90 text-white text-[11px] font-black hover:bg-slate-900 transition cursor-pointer disabled:opacity-50"
              >
                <Lock className="w-4 h-4" />
                اعتماد وإغلاق الشهر
              </button>
            )}
            <button
              type="button"
              onClick={printGroupPayrollTable}
              disabled={rows.length === 0}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-950/35 border border-white/30 text-white text-[11px] font-black hover:bg-emerald-950/50 transition cursor-pointer shrink-0 disabled:opacity-50"
            >
              <Printer className="w-4 h-4" />
              طباعة كشف المرتبات الجماعي A4
            </button>
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
      </div>

      {lockedSnapshot && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 text-[11px] font-bold">
          <Lock className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
          <div>
            <p className="font-black">
              تم اعتماد وإغلاق كشف رواتب شهر {month} وتجميد جميع الأرقام بشكل نهائي.
            </p>
            <p className="text-[10px] text-amber-800 mt-0.5">
              بواسطة: {lockedSnapshot.locked_by || 'الإدارة'}
              {lockedSnapshot.locked_at ? ` — بتاريخ ${String(lockedSnapshot.locked_at).slice(0, 16).replace('T', ' ')}` : ''}
              {lockedSnapshot.notes ? ` — ملاحظات: ${lockedSnapshot.notes}` : ''}
            </p>
          </div>
        </div>
      )}

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
          يُحسب الأجر وفق القواعد المؤكدة (30 يوماً − الغياب − خصم {weeklyOffLabel}) مع إضافة العمل يوم{' '}
          {weeklyOffLabel} فوق سقف الـ30 يوماً بمعامل ×{weeklyOffMultiplier}. تُعفى الخصومات «المرفوضة»
          و«بانتظار المراجعة» من الصافي مع الإبقاء على يوم الحضور، وراتب اليوم = المرتب ÷ 30 وراتب
          الساعة = راتب اليوم ÷ {Number(shiftHours.toFixed(2))} ساعة.
        </span>
      </div>

      {isLockModalOpen && (
        <Modal
          title={`اعتماد وإغلاق مرتبات شهر ${month}`}
          subtitle="سيتم تجميد المرتبات والأرصدة والقواعد لهذا الشهر بشكل دائم لحمايتها من أي تعديلات مستقبلية."
          onClose={() => setIsLockModalOpen(false)}
          maxWidthClass="max-w-lg"
          footer={
            <>
              <button
                type="button"
                onClick={() => setIsLockModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-black text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isLocking}
                onClick={() => void handleLockMonth()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black hover:bg-emerald-700 cursor-pointer disabled:opacity-60"
              >
                <Lock className="w-3.5 h-3.5" />
                {isLocking ? 'جاري الإغلاق...' : 'تأكيد اعتماد وإغلاق الشهر'}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-900">
              إجمالي النقد المطلوب دفعه: <span className="font-mono font-black">{formatMoney(totals.netPay)}</span> — عدد العمال: {rows.length}
            </div>
            <div>
              <label className={labelClass}>ملاحظات الإغلاق (اختياري)</label>
              <textarea
                value={lockNotes}
                onChange={(e) => setLockNotes(e.target.value)}
                rows={2}
                placeholder="مثال: تم الصرف النقدي بالكامل ومراجعة السُلف..."
                className={inputClass}
              />
            </div>
          </div>
        </Modal>
      )}

      {isUnlockModalOpen && (
        <Modal
          title={`إعادة فتح كشف رواتب شهر ${month}`}
          subtitle="إعادة فتح الشهر ستسمح بتعديل الحضور والجزاءات والسُلف وإعادة حساب المرتبات وفق القواعد الحالية."
          onClose={() => setIsUnlockModalOpen(false)}
          maxWidthClass="max-w-md"
          footer={
            <>
              <button
                type="button"
                onClick={() => setIsUnlockModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-black text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                تراجع
              </button>
              <button
                type="button"
                disabled={isLocking}
                onClick={() => void handleUnlockMonth()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-black hover:bg-amber-700 cursor-pointer disabled:opacity-60"
              >
                <Unlock className="w-3.5 h-3.5" />
                {isLocking ? 'جاري الفتح...' : 'تأكيد إعادة فتح الشهر'}
              </button>
            </>
          }
        >
          <p className="text-xs font-bold text-slate-600">
            هل أنت متأكد من إلغاء تجميد شهر <span className="font-mono font-black">{month}</span>؟
          </p>
        </Modal>
      )}
    </div>
  );
};




