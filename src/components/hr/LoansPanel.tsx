import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Users, Briefcase, Clock, Plus, Search, Pencil, Trash2, X, Save,
  AlertTriangle, CalendarDays, Building2, Coffee, Timer, Info, Wallet,
  Scale, Banknote, RefreshCw, Download, Upload, FileSpreadsheet, FileText,
  CheckCircle2, XCircle, UsersRound, LayoutList, History, Printer, BarChart3
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  escapeHtml,
  logClientPrintAction,
  openUnifiedPrintWindow,
  renderSignatureBar
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

interface LoanDueRow {
  employee: HREmployee;
  salary: number;
  workdays: number;
  earnedDays: number;
  attendedDays: number;
  paidSundayDays: number;
  attendanceDeductionDays: number;
  attendanceDeductionHours: number;
  sundayDeductionDays: number;
  penaltyDays: number;
  penaltyHours: number;
  previousLoans: number;
  currentDue: number;
}

export const LoansPanel: React.FC<{ employees: HREmployee[] }> = ({ employees }) => {
  const { addFlashMessage, logAction, globalSettings } = useApp();

  const [loans, setLoans] = useState<HRLoan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [month, setMonth] = useState(currentMonth());
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<HRLoan | null>(null);
  const [form, setForm] = useState({ employee_id: '', date: todayISO(), amount: '', notes: '' });
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<HRLoan | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [attendanceRecords, setAttendanceRecords] = useState<HRAttendanceRecord[]>([]);
  const [penalties, setPenalties] = useState<HRPenalty[]>([]);
  const [settings, setSettings] = useState<HRAttendanceSettings | null>(null);
  // يوم الإجازة الأسبوعية من إعدادات الحضور (الأحد افتراضياً) — يُستخدم في احتساب الاستحقاق.
  const weeklyOffIndex = weeklyOffIndexFromKey(settings?.weekly_off_day);
  const weeklyOffLabel = weeklyOffDayLabel(weeklyOffIndex);
  const shiftHours = workingHoursPerDayFor(settings);
  const weeklyOffMultiplier =
    Number(settings?.weekly_off_work_multiplier ?? 1.0) >= 0
      ? Number(settings?.weekly_off_work_multiplier ?? 1.0)
      : 1.0;
  const [dueSearch, setDueSearch] = useState('');
  const [overLimit, setOverLimit] = useState<{ amount: number; limit: number } | null>(null);
  const [pendingLoanPayload, setPendingLoanPayload] = useState<any | null>(null);

  // فترة الاستحقاق: أيام العمل حتى أمس (مع احتساب حضور اليوم إن وُجد) + سُلف وجزاءات وإضافي اليوم لحظياً.
  const duePeriod = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const todayIsoStr = isoDate(now);
    const dates: string[] = [];
    for (let cursor = new Date(monthStart); cursor <= yesterday; cursor.setDate(cursor.getDate() + 1)) {
      dates.push(isoDate(cursor));
    }
    const datesThroughToday = [...dates];
    if (!datesThroughToday.includes(todayIsoStr)) {
      datesThroughToday.push(todayIsoStr);
    }
    return {
      monthKey: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      yesterdayIso: isoDate(yesterday),
      todayIso: todayIsoStr,
      yesterdayLabel: `${String(yesterday.getDate()).padStart(2, '0')}/${String(
        yesterday.getMonth() + 1
      ).padStart(2, '0')}/${yesterday.getFullYear()}`,
      workdays: Math.min(dates.length, 30),
      dates,
      datesThroughToday
    };
  }, []);

  const loadLoans = useCallback(async () => {
    setIsLoading(true);
    try {
      const [loansRes, attendanceRes, penaltiesRes, settingsRes] = await Promise.all([
        api.getHRLoans(),
        api
          .getHRAttendanceRecords({ month: duePeriod.monthKey, includePrevWeek: true })
          .catch(() => [] as HRAttendanceRecord[]),
        api.getHRPenalties().catch(() => [] as HRPenalty[]),
        api.getHRAttendanceSettings().catch(() => null)
      ]);
      setLoans(Array.isArray(loansRes) ? loansRes : []);
      setAttendanceRecords(Array.isArray(attendanceRes) ? attendanceRes : []);
      setPenalties(Array.isArray(penaltiesRes) ? penaltiesRes : []);
      setSettings(settingsRes || null);
    } catch (err: any) {
      addFlashMessage(err?.message || 'فشل تحميل السُلف من السيرفر', 'danger');
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, duePeriod.monthKey]);

  useEffect(() => {
    void loadLoans();
  }, [loadLoans]);

  const filteredLoans = useMemo(() => {
    return loans.filter((loan) => {
      if (month && !(loan.date || '').startsWith(month)) return false;
      if (employeeFilter && loan.employee_id !== employeeFilter) return false;
      return true;
    });
  }, [loans, month, employeeFilter]);

  const totalAmount = useMemo(
    () => filteredLoans.reduce((sum, loan) => sum + (Number(loan.amount) || 0), 0),
    [filteredLoans]
  );

  // المستحق الحالي = (المرتب ÷ 30) × أيام الاستحقاق + الإضافي (شامل اليوم) − التأخير المعتمد − الجزاءات (شامل اليوم) − السُلف (شامل اليوم)
  const loanDueRows = useMemo<LoanDueRow[]>(() => {
    const throughTodaySet = new Set(duePeriod.datesThroughToday);
    return employees
      .filter((emp) => emp.is_active !== false)
      .map((employee) => {
        const salary = Number(employee.monthly_salary) || 0;
        const dayRate = dailyRateFor(salary);
        const hourRate = hourlyRateFor(salary, shiftHours);
        const employeeRecords = attendanceRecords.filter((record) => {
          if (record.employee_id !== employee.id || !throughTodaySet.has(record.date)) return false;
          const recordDay = new Date(`${record.date}T00:00:00`);
          if (recordDay.getDay() === weeklyOffIndex && !record.check_in) return false;
          return true;
        });
        // الإضافي (بما في ذلك اليوم)
        const overtimeDays = employeeRecords.reduce(
          (sum, record) => sum + (Number(record.overtime_days) || 0),
          0
        );
        const overtimeHours = employeeRecords.reduce(
          (sum, record) => sum + (Number(record.overtime_hours) || 0),
          0
        );
        // خصم التأخير/الانصراف المعتمد أو التلقائي فقط (لا نخصم pending_review أو rejected).
        const penaltyRecords = employeeRecords.filter(
          (record) =>
            isAttendedRecord(record) &&
            !record.is_excused &&
            record.review_status !== 'rejected' &&
            record.review_status !== 'pending_review'
        );
        const attendanceDeductionDays = penaltyRecords.reduce(
          (sum, record) => sum + (Number(record.calculated_deduction_days) || 0),
          0
        );
        const attendanceDeductionHours = penaltyRecords.reduce(
          (sum, record) => sum + (Number(record.calculated_deduction_hours) || 0),
          0
        );
        // الجزاءات اليدوية شامل اليوم
        const employeePenalties = penalties.filter(
          (penalty) => penalty.employee_id === employee.id && throughTodaySet.has(penalty.date)
        );
        const penaltyDays = employeePenalties
          .filter((penalty) => penalty.penalty_type === 'days')
          .reduce((sum, penalty) => sum + (Number(penalty.value) || 0), 0);
        const penaltyHours = employeePenalties
          .filter((penalty) => penalty.penalty_type === 'hours')
          .reduce((sum, penalty) => sum + (Number(penalty.value) || 0), 0);
        // السُلف السابقة شامل سُلف اليوم لحظياً!
        const previousLoans = loans
          .filter((loan) => loan.employee_id === employee.id && throughTodaySet.has(loan.date))
          .reduce((sum, loan) => sum + (Number(loan.amount) || 0), 0);
        // المستحق يُبنى على الحضور الفعلي + الإضافي + معامل عمل الإجازة الأسبوعية.
        const accrual = computeMonthAccrual(
          employee.id,
          attendanceRecords,
          duePeriod.monthKey,
          duePeriod.yesterdayIso,
          weeklyOffIndex,
          weeklyOffMultiplier
        );
        const earned = dayRate * accrual.earnedDays;
        const overtimeMoney = dayRate * overtimeDays + hourRate * overtimeHours;
        const deductionMoney =
          dayRate * (attendanceDeductionDays + penaltyDays) +
          hourRate * (attendanceDeductionHours + penaltyHours);
        const currentDue = Math.max(0, earned + overtimeMoney - deductionMoney - previousLoans);
        return {
          employee,
          salary,
          workdays: duePeriod.workdays,
          earnedDays: accrual.earnedDays,
          attendedDays: accrual.attendedDays,
          paidSundayDays: accrual.paidSundayDays,
          attendanceDeductionDays,
          attendanceDeductionHours,
          sundayDeductionDays: accrual.sundayDeductionDays,
          penaltyDays,
          penaltyHours,
          previousLoans,
          currentDue
        };
      });
  }, [employees, attendanceRecords, penalties, loans, duePeriod, weeklyOffIndex, shiftHours, weeklyOffMultiplier]);

  const dueGroups = useMemo(() => {
    const query = dueSearch.trim().toLowerCase();
    const map = new Map<string, LoanDueRow[]>();
    loanDueRows
      .filter(
        (row) =>
          !query ||
          `${row.employee.name} ${row.employee.employee_code}`.toLowerCase().includes(query)
      )
      .forEach((row) => {
        const key = row.employee.department || 'other';
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(row);
      });
    return Array.from(map.entries()).map(([key, rows]) => ({
      key,
      label: key === 'other' ? 'بدون قسم' : HR_DEPARTMENT_LABELS[key as HRDepartmentKey] || key,
      rows
    }));
  }, [loanDueRows, dueSearch]);

  const dueTotals = useMemo(
    () =>
      loanDueRows.reduce(
        (acc, row) => {
          acc.salary += row.salary;
          acc.previousLoans += row.previousLoans;
          acc.currentDue += row.currentDue;
          return acc;
        },
        { salary: 0, previousLoans: 0, currentDue: 0 }
      ),
    [loanDueRows]
  );

  const selectedEmployeeDue = useMemo(() => {
    const row = loanDueRows.find((item) => item.employee.id === form.employee_id);
    const base = row?.currentDue || 0;
    // عند تعديل سلفة قائمة نضيف قيمتها القديمة لأنها محسوبة ضمن السُلف السابقة.
    const editingAmount = editing ? Number(editing.amount) || 0 : 0;
    return base + editingAmount;
  }, [loanDueRows, form.employee_id, editing]);

  const printEmptyLoanForm = () => {
    const formBlock = `
      <div class="form-block">
        <h2>نموذج طلب سلفة</h2>
        <p class="sub">${escapeHtml(globalSettings.site_name || 'مصنع الملابس الجاهزة')} — إدارة الموارد البشرية</p>
        <table>
          <tr><td class="label">اسم الموظف</td><td></td></tr>
          <tr><td class="label">كود الموظف</td><td></td></tr>
          <tr><td class="label">القسم</td><td></td></tr>
          <tr><td class="label">الوظيفة</td><td></td></tr>
          <tr><td class="label">قيمة السلفة</td><td></td></tr>
          <tr><td class="label">تاريخ الطلب</td><td></td></tr>
          <tr><td class="label">سبب السلفة</td><td></td></tr>
          <tr><td class="label">طريقة السداد</td><td></td></tr>
        </table>
        <div class="sign"><span>توقيع الموظف: ................</span><span>اعتماد الإدارة: ................</span></div>
      </div>`;

    const opened = openUnifiedPrintWindow({
      documentTitle: 'نموذج طلب سلفة فارغ',
      mode: 'fit-single-page',
      orientation: 'landscape',
      header: {
        siteName: globalSettings.site_name,
        logo: globalSettings.logo,
        title: 'نماذج طلب سلفة (3 نسخ جاهزة للقص)',
        subtitle: 'إدارة الموارد البشرية',
        compact: true
      },
      bodyHtml: `<div class="forms">${formBlock}${formBlock}${formBlock}</div>`,
      extraCss: `
        .forms { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5mm; }
        .form-block { border: 1px dashed #64748b; border-radius: 6px; padding: 4mm; background: #fff; break-inside: avoid; }
        .form-block h2 { font-size: 13px; text-align: center; margin: 0 0 2px; color: #0f172a; }
        .form-block p.sub { text-align: center; color: #64748b; font-size: 8.5px; margin: 0 0 6px; }
        .form-block table { font-size: 9.5px; margin-bottom: 0; }
        .form-block td { padding: 5px 6px; height: 26px; background: #fff !important; }
        .form-block td.label { background: #f1f5f9 !important; font-weight: 800; width: 38%; text-align: right; }
        .form-block .sign { margin-top: 8mm; display: flex; justify-content: space-between; font-size: 8.8px; gap: 6px; font-weight: 700; }
      `,
      onPopupBlocked: () => addFlashMessage('فضلاً اسمح بالنوافذ المنبثقة للطباعة', 'danger')
    });
    if (opened) {
      logClientPrintAction('الموارد البشرية', 'طباعة نموذج طلب سلفة فارغ', 'نموذج طلب سلفة');
    }
  };

  const printLoansReport = () => {
    if (loanDueRows.length === 0) {
      addFlashMessage('لا توجد بيانات لطباعتها', 'danger');
      return;
    }
    const body = dueGroups
      .map(
        (group) => `<div class="p-sec">${escapeHtml(group.label)} (${group.rows.length} موظف)</div>
        <table>
          <thead><tr>
            <th>الكود</th><th class="text-right">الموظف</th><th>المرتب</th><th>الأيام المستحقة</th>
            <th>خصم التأخير</th><th>خصم ${escapeHtml(weeklyOffLabel)}</th><th>الجزاءات</th>
            <th>السُلف السابقة</th><th>المستحق الحالي</th>
          </tr></thead>
          <tbody>
            ${group.rows
              .map((row) => {
                const attendanceDays = row.attendanceDeductionDays + row.attendanceDeductionHours / shiftHours;
                const penaltyDays = row.penaltyDays + row.penaltyHours / shiftHours;
                return `<tr>
                  <td class="mono">${escapeHtml(row.employee.employee_code || '-')}</td>
                  <td class="text-right"><strong>${escapeHtml(row.employee.name)}</strong></td>
                  <td class="num">${formatMoney(row.salary)}</td>
                  <td class="num">${row.earnedDays.toFixed(2)}</td>
                  <td class="num">${attendanceDays.toFixed(2)} يوم</td>
                  <td class="num">${row.sundayDeductionDays.toFixed(2)} يوم</td>
                  <td class="num">${penaltyDays.toFixed(2)} يوم</td>
                  <td class="num bad">${formatMoney(row.previousLoans)}</td>
                  <td class="num ok"><strong>${formatMoney(row.currentDue)}</strong></td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>`
      )
      .join('');

    const bodyHtml = `
      <div class="p-kpis">
        <div class="p-kpi"><span class="p-kpi-label">إجمالي المرتبات</span><span class="p-kpi-val">${formatMoney(dueTotals.salary)}</span></div>
        <div class="p-kpi"><span class="p-kpi-label">إجمالي السُلف السابقة</span><span class="p-kpi-val bad">${formatMoney(dueTotals.previousLoans)}</span></div>
        <div class="p-kpi"><span class="p-kpi-label">إجمالي المستحق الحالي</span><span class="p-kpi-val ok">${formatMoney(dueTotals.currentDue)}</span></div>
      </div>
      ${body}
      ${renderSignatureBar(['إدارة الموارد البشرية', 'الحسابات والمراجعة', 'اعتماد الإدارة'], true)}
    `;

    const opened = openUnifiedPrintWindow({
      documentTitle: `تقرير السُلف والمستحقات — ${duePeriod.monthKey}`,
      mode: 'multi-page-table',
      orientation: 'landscape',
      header: {
        siteName: globalSettings.site_name,
        logo: globalSettings.logo,
        title: 'تقرير السُلف والمستحقات',
        subtitle: `شهر ${duePeriod.monthKey} — من أول الشهر حتى ${duePeriod.yesterdayLabel}`,
        metaItems: [`أيام العمل: ${duePeriod.workdays}`]
      },
      bodyHtml,
      onPopupBlocked: () => addFlashMessage('فضلاً اسمح بالنوافذ المنبثقة للطباعة', 'danger')
    });
    if (opened) {
      logClientPrintAction(
        'الموارد البشرية',
        `طباعة تقرير السُلف والمستحقات لشهر ${duePeriod.monthKey}`,
        `سُلف شهر ${duePeriod.monthKey}`
      );
    }
  };

  const updateForm = (patch: Partial<typeof form>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  const openCreateFor = (employeeId?: string) => {
    setEditing(null);
    setForm({
      employee_id: employeeId || employees[0]?.id || '',
      date: todayISO(),
      amount: '',
      notes: ''
    });
    setFormError('');
    setIsFormOpen(true);
  };

  const openCreate = () => openCreateFor();

  const openEdit = (loan: HRLoan) => {
    setEditing(loan);
    setForm({
      employee_id: loan.employee_id,
      date: loan.date || todayISO(),
      amount: String(loan.amount ?? ''),
      notes: loan.notes || ''
    });
    setFormError('');
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditing(null);
    setFormError('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.employee_id) {
      setFormError('يرجى اختيار الموظف');
      return;
    }
    if (!form.date) {
      setFormError('تاريخ السلفة مطلوب');
      return;
    }
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError('قيمة السلفة يجب أن تكون أكبر من صفر');
      return;
    }

    const payload: any = {
      employee_id: form.employee_id,
      date: form.date,
      amount,
      notes: form.notes.trim()
    };

    // تنبيه عند تجاوز الحد الأقصى (المستحق الحالي) مع السماح بالمتابعة بعد التأكيد.
    if (amount > selectedEmployeeDue + 0.0001) {
      setPendingLoanPayload(payload);
      setOverLimit({ amount, limit: selectedEmployeeDue });
      return;
    }

    await saveLoan(payload);
  };

  const saveLoan = async (payload: any) => {
    setIsSaving(true);
    setFormError('');
    try {
      if (editing) {
        await api.updateHRLoan(editing.id, payload);
        addFlashMessage('تم تعديل السلفة بنجاح');
        logAction('الموارد البشرية', `تعديل سلفة بقيمة ${payload.amount} بتاريخ ${payload.date}`);
      } else {
        await api.createHRLoan(payload);
        addFlashMessage('تم إضافة السلفة بنجاح');
        logAction('الموارد البشرية', `إضافة سلفة بقيمة ${payload.amount} بتاريخ ${payload.date}`);
      }
      closeForm();
      await loadLoans();
    } catch (err: any) {
      setFormError(err?.message || 'فشل حفظ السلفة');
    } finally {
      setIsSaving(false);
    }
  };

  const confirmOverLimit = async () => {
    if (!pendingLoanPayload) return;
    const payload = pendingLoanPayload;
    setOverLimit(null);
    setPendingLoanPayload(null);
    await saveLoan(payload);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError('');
    try {
      await api.deleteHRLoan(deleteTarget.id);
      addFlashMessage('تم حذف السلفة بنجاح');
      logAction('الموارد البشرية', `حذف سلفة بتاريخ ${deleteTarget.date}`);
      setDeleteTarget(null);
      await loadLoans();
    } catch (err: any) {
      setDeleteError(err?.message || 'فشل حذف السلفة');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-slate-900">سُلف الموظفين</h2>
          <p className="text-[11px] font-bold text-slate-500 mt-0.5">
            كل سلفة تُخصم من مرتب نفس الشهر، ولا يمكن أن يتجاوز إجمالي السُلف قيمة المرتب.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={printEmptyLoanForm}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-[11px] font-black hover:bg-slate-50 transition cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            طباعة ورق سلفة فاضي
          </button>
          <button
            type="button"
            onClick={printLoansReport}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 text-white text-[11px] font-black hover:bg-indigo-700 transition cursor-pointer"
          >
            <FileText className="w-4 h-4" />
            تقرير السُلف
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white text-[11px] font-black hover:bg-purple-700 transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            صرف سلفة
          </button>
        </div>
      </div>

      <div className="p-4 bg-slate-50/60 border-b border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-2">
        <input
          type="month"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
          className={`${inputClass} font-mono`}
        />
        <select
          value={employeeFilter}
          onChange={(event) => setEmployeeFilter(event.target.value)}
          className={inputClass}
        >
          <option value="">كل الموظفين</option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.name} ({employee.employee_code})
            </option>
          ))}
        </select>
      </div>

      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-black text-slate-700">
          <Wallet className="w-3.5 h-3.5 text-purple-600" />
          عدد السُلف: {filteredLoans.length}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] font-black text-amber-700">
          <Banknote className="w-3.5 h-3.5" />
          إجمالي السُلف المسجلة: {formatMoney(totalAmount)}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] font-black text-rose-700">
          <Banknote className="w-3.5 h-3.5" />
          السُلف السابقة: {formatMoney(dueTotals.previousLoans)}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] font-black text-emerald-700">
          <Wallet className="w-3.5 h-3.5" />
          المستحق الحالي: {formatMoney(dueTotals.currentDue)}
        </span>
      </div>

      {/* استحقاق السُلف: من أول الشهر حتى أمس، مجمّع حسب القسم */}
      <div className="px-4 py-3 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-black text-slate-900">استحقاق السُلف حتى أمس</h3>
          <p className="text-[10px] font-bold text-slate-500 mt-0.5">
            من أول الشهر حتى {duePeriod.yesterdayLabel} — أيام العمل: {duePeriod.workdays} ({weeklyOffLabel} أجازة
            مدفوعة)
          </p>
        </div>
        <input
          value={dueSearch}
          onChange={(event) => setDueSearch(event.target.value)}
          placeholder="بحث بالاسم أو الكود"
          className={`${inputClass} md:w-64`}
        />
      </div>

      {isLoading ? (
        <div className="p-10 text-center text-xs font-bold text-slate-400">جاري التحميل...</div>
      ) : dueGroups.length === 0 ? (
        <div className="p-8 text-center">
          <Users className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="text-xs font-black text-slate-700">لا توجد بيانات استحقاق</p>
          <p className="text-[11px] font-bold text-slate-500 mt-1">
            {dueSearch.trim()
              ? 'لا توجد نتائج مطابقة لبحثك.'
              : 'أضف موظفين لعرض المستحقات.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-right px-4 py-2.5 font-black whitespace-nowrap">الكود</th>
                <th className="text-right px-4 py-2.5 font-black whitespace-nowrap">الموظف</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">المرتب</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">
                  الأيام المستحقة حتى أمس
                </th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">
                  السُلف السابقة
                </th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">
                  المستحق الحالي
                </th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">إجراءات</th>
              </tr>
            </thead>
            {dueGroups.map((group) => (
              <tbody key={group.key} className="divide-y divide-slate-100">
                <tr className="bg-slate-50/80">
                  <td colSpan={7} className="px-4 py-2 font-black text-slate-700">
                    {group.label}{' '}
                    <span className="text-[10px] font-bold text-slate-400">
                      ({group.rows.length} موظف)
                    </span>
                  </td>
                </tr>
                {group.rows.map((row) => (
                  <tr key={row.employee.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-mono font-bold text-slate-600 whitespace-nowrap">
                      {row.employee.employee_code || '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="font-black text-slate-900">{row.employee.name}</p>
                      <p className="font-bold text-[10px] text-slate-400">
                        {row.employee.job_title || ''}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-bold text-slate-700 whitespace-nowrap">
                      {formatMoney(row.salary)}
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-bold text-slate-600">
                      {row.earnedDays.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-bold text-amber-600 whitespace-nowrap">
                      {formatMoney(row.previousLoans)}
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-black text-emerald-700 whitespace-nowrap">
                      {formatMoney(row.currentDue)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => openCreateFor(row.employee.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-purple-600 text-white text-[10px] font-black hover:bg-purple-700 transition cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        صرف سلفة
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}

      <div className="px-4 py-3 border-b border-slate-100">
        <h3 className="text-xs font-black text-slate-900">سجل السُلف المسجلة</h3>
      </div>

      {isLoading ? (
        <div className="p-10 text-center text-xs font-bold text-slate-400">جاري التحميل...</div>
      ) : filteredLoans.length === 0 ? (
        <div className="p-10 text-center">
          <Wallet className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="text-xs font-black text-slate-700">لا توجد سُلف مسجلة لهذا الشهر</p>
          <p className="text-[11px] font-bold text-slate-500 mt-1">
            أضف سلفة جديدة ليتم خصمها تلقائياً من مرتب الموظف في المرتبات.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-right px-4 py-2.5 font-black whitespace-nowrap">التاريخ</th>
                <th className="text-right px-4 py-2.5 font-black whitespace-nowrap">الموظف</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">المبلغ</th>
                <th className="text-right px-4 py-2.5 font-black whitespace-nowrap">ملاحظات</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLoans.map((loan) => {
                const employee = employees.find((item) => item.id === loan.employee_id);
                return (
                  <tr key={loan.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-mono font-bold text-slate-700 whitespace-nowrap">
                      {loan.date}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="font-black text-slate-900">
                        {loan.employee_name || employee?.name || '-'}
                      </p>
                      <p className="font-bold text-[10px] text-slate-400 font-mono">
                        {loan.employee_code || employee?.employee_code || '-'}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-black text-rose-600 whitespace-nowrap">
                      {formatMoney(Number(loan.amount) || 0)}
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-600 max-w-[260px] truncate">
                      {loan.notes || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(loan)}
                          title="تعديل"
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-purple-50 hover:text-purple-600 transition cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError('');
                            setDeleteTarget(loan);
                          }}
                          title="حذف"
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isFormOpen && (
        <Modal
          title={editing ? 'تعديل سلفة' : 'صرف سلفة جديدة'}
          subtitle="تُخصم السلفة بالكامل من مرتب نفس الشهر في المرتبات"
          onClose={closeForm}
          maxWidthClass="max-w-xl"
        >
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>الموظف *</label>
                <select
                  value={form.employee_id}
                  onChange={(event) => updateForm({ employee_id: event.target.value })}
                  className={inputClass}
                >
                  <option value="">اختر الموظف</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name} ({employee.employee_code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>تاريخ السلفة *</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(event) => updateForm({ date: event.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>قيمة السلفة (ج.م) *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(event) => updateForm({ amount: event.target.value })}
                placeholder="0.00"
                className={`${inputClass} font-mono`}
              />
              <p className="text-[10px] font-bold text-slate-500 mt-1">
                المستحق الحالي للموظف حتى أمس: {formatMoney(selectedEmployeeDue)} — وهو الحد الأقصى للسلفة.
              </p>
            </div>

            <div>
              <label className={labelClass}>ملاحظات</label>
              <textarea
                value={form.notes}
                onChange={(event) => updateForm({ notes: event.target.value })}
                rows={2}
                className={inputClass}
                placeholder="سبب السلفة أو طريقة السداد..."
              />
            </div>

            <ErrorNote message={formError} />

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeForm}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-black hover:bg-slate-200 transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white text-[11px] font-black hover:bg-purple-700 transition cursor-pointer disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                {isSaving ? 'جاري الحفظ...' : 'حفظ السلفة'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {overLimit && (
        <Modal
          title="قيمة السلفة تتجاوز الحد الأقصى"
          subtitle="يمكنك المتابعة بعد التأكيد"
          onClose={() => {
            setOverLimit(null);
            setPendingLoanPayload(null);
          }}
          maxWidthClass="max-w-md"
        >
          <div className="space-y-3">
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-bold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                قيمة السلفة المطلوبة{' '}
                <strong className="font-mono">{formatMoney(overLimit.amount)}</strong> تتجاوز
                المستحق الحالي{' '}
                <strong className="font-mono">{formatMoney(overLimit.limit)}</strong> للموظف حتى
                أمس. هل تريد المتابعة على مسؤوليتك؟
              </span>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setOverLimit(null);
                  setPendingLoanPayload(null);
                }}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-black hover:bg-slate-200 transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void confirmOverLimit()}
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 text-white text-[11px] font-black hover:bg-amber-700 transition cursor-pointer disabled:opacity-60"
              >
                <CheckCircle2 className="w-4 h-4" />
                {isSaving ? 'جاري الحفظ...' : 'متابعة وحفظ'}
              </button>
            </div>
          </div>
        </Modal>
      )}


      {deleteTarget && (
        <Modal
          title="تأكيد حذف السلفة"
          subtitle="لا يمكن التراجع عن هذه العملية"
          onClose={() => {
            setDeleteTarget(null);
            setDeleteError('');
          }}
          maxWidthClass="max-w-md"
        >
          <div className="space-y-3">
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-bold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                سيتم حذف سلفة بقيمة{' '}
                <strong className="font-mono">{formatMoney(Number(deleteTarget.amount) || 0)}</strong>{' '}
                بتاريخ <strong className="font-mono">{deleteTarget.date}</strong> للموظف{' '}
                <strong>
                  {deleteTarget.employee_name ||
                    employees.find((item) => item.id === deleteTarget.employee_id)?.name ||
                    '-'}
                </strong>
                .
              </span>
            </div>
            <ErrorNote message={deleteError} />
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteError('');
                }}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-black hover:bg-slate-200 transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={isDeleting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 text-white text-[11px] font-black hover:bg-rose-700 transition cursor-pointer disabled:opacity-60"
              >
                <Trash2 className="w-4 h-4" />
                {isDeleting ? 'جاري الحذف...' : 'حذف السلفة'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

