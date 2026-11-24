import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Users, Briefcase, Clock, Plus, Search, Pencil, Trash2, X, Save,
  AlertTriangle, CalendarDays, Building2, Coffee, Timer, Info, Wallet,
  Scale, Banknote, RefreshCw, Download, Upload, FileSpreadsheet, FileText,
  CheckCircle2, XCircle, UsersRound, LayoutList, History, Printer, BarChart3
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { escapeHtml, logClientPrintAction, renderLogoHtml } from '../../utils/printShared';
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

interface AttendanceRecordForm {
  employee_id: string;
  date: string;
  check_in: string;
  check_out: string;
  status: HRAttendanceStatus;
  is_excused: boolean;
  excuse_note: string;
  calculated_deduction_days: string;
  calculated_deduction_hours: string;
  review_status: HRReviewStatus;
}

const emptyRecordForm = (employeeId: string): AttendanceRecordForm => ({
  employee_id: employeeId,
  date: todayISO(),
  check_in: '08:30',
  check_out: '17:30',
  status: 'present',
  is_excused: false,
  excuse_note: '',
  calculated_deduction_days: '0',
  calculated_deduction_hours: '0',
  review_status: 'auto_applied'
});

/** بطاقة إحصاء صغيرة أعلى شاشة سجل الحضور والانصراف. */
const AttendanceStatCard: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone: 'slate' | 'emerald' | 'rose' | 'amber' | 'blue' | 'indigo';
  icon: React.ReactNode;
}> = ({ label, value, hint, tone, icon }) => {
  const tones: Record<string, string> = {
    slate: 'bg-white border-slate-200 text-slate-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    rose: 'bg-rose-50 border-rose-200 text-rose-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700'
  };

  return (
    <div className={`rounded-2xl border p-3 ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-black tracking-wide opacity-80">{label}</p>
        {icon}
      </div>
      <p className="mt-1 text-lg font-black font-mono leading-none">{value}</p>
      {hint ? <p className="mt-1 text-[10px] font-bold opacity-70">{hint}</p> : null}
    </div>
  );
};

export const AttendanceRecordsPanel: React.FC<{ employees: HREmployee[] }> = ({ employees }) => {
  const { addFlashMessage, logAction, globalSettings } = useApp();

  const [records, setRecords] = useState<HRAttendanceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [month, setMonth] = useState(currentMonth());
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<HRAttendanceRecord | null>(null);
  const [form, setForm] = useState<AttendanceRecordForm>(emptyRecordForm(''));
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<HRAttendanceRecord | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  // عرض السجل اليومي (بالأيام) أو حسب الموظف
  const [viewMode, setViewMode] = useState<'day' | 'employee'>('day');
  const [selectedDay, setSelectedDay] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState('');

  // إحصاءات السيرفر لبطاقات أعلى الشاشة
  const [stats, setStats] = useState<HRAttendanceStats | null>(null);

  // شيت البصمة (تحميل القالب / رفع الشيت)
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<{ row: number; message: string }[]>([]);
  // يوم الإجازة الأسبوعية المعتمد من الإعدادات (الأحد افتراضياً) لعناوين خصم الإجازة.
  const [weeklyOffIndex, setWeeklyOffIndex] = useState<number>(DEFAULT_WEEKLY_OFF_INDEX);
  const weeklyOffLabel = weeklyOffDayLabel(weeklyOffIndex);

  // إدخال بصمة يدوية / تسجيل عذر
  const [timeTarget, setTimeTarget] = useState<HRAttendanceRecord | null>(null);
  const [timeForm, setTimeForm] = useState({ check_in: '', check_out: '' });
  const [timeError, setTimeError] = useState('');
  const [isSavingTime, setIsSavingTime] = useState(false);
  const [excuseTarget, setExcuseTarget] = useState<HRAttendanceRecord | null>(null);
  const [excuseNote, setExcuseNote] = useState('');
  const [excuseError, setExcuseError] = useState('');
  const [isSavingExcuse, setIsSavingExcuse] = useState(false);

  const loadRecords = useCallback(async () => {
    setIsLoading(true);
    try {
      const [res, settingsRes] = await Promise.all([
        api.getHRAttendanceRecords({ month, includePrevWeek: true }),
        api.getHRAttendanceSettings().catch(() => null)
      ]);
      setRecords(Array.isArray(res) ? res : []);
      setWeeklyOffIndex(weeklyOffIndexFromKey(settingsRes?.weekly_off_day));
    } catch (err: any) {
      addFlashMessage(err?.message || 'فشل تحميل سجل الحضور من السيرفر', 'danger');
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  const loadStats = useCallback(async () => {
    try {
      const res = await api.getHRAttendanceStats(month);
      setStats((res as HRAttendanceStats) || null);
    } catch {
      // بطاقات الإحصاءات اختيارية ولا يجب أن تعطل الشاشة عند تعذر تحميلها
      setStats(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  // إعادة تصفير اختيار اليوم/الموظف عند تغيير الشهر حتى لا تبقى تصفية قديمة.
  useEffect(() => {
    setSelectedDay('');
    setSelectedEmployee('');
  }, [month]);

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      if (month && !(record.date || '').startsWith(month)) return false;
      if (employeeFilter && record.employee_id !== employeeFilter) return false;
      if (statusFilter && record.status !== statusFilter) return false;
      return true;
    });
  }, [records, month, employeeFilter, statusFilter]);

  const summary = useMemo(() => {
    let absents = 0;
    let pending = 0;
    let present = 0;
    let deductionHours = 0;
    let deductionDays = 0;
    filteredRecords.forEach((record) => {
      if (record.status === 'present') present += 1;
      if (record.status === 'absent') absents += 1;
      if (record.review_status === 'pending_review') pending += 1;
      deductionHours += Number(record.calculated_deduction_hours) || 0;
      deductionDays += Number(record.calculated_deduction_days) || 0;
    });
    return { present, absents, pending, deductionHours, deductionDays };
  }, [filteredRecords]);

  // نسبة التزام بديلة تُحسب محلياً في حال تعذر جلب إحصاءات السيرفر.
  const localCompliance = filteredRecords.length
    ? Math.round((summary.present / filteredRecords.length) * 100)
    : 0;

  // السجلات المعروضة فعلياً حسب نمط العرض (يومي / حسب الموظف)
  const visibleRecords = useMemo(() => {
    let list = filteredRecords;
    if (viewMode === 'day' && selectedDay) {
      list = list.filter((record) => record.date === selectedDay);
    }
    if (viewMode === 'employee' && selectedEmployee) {
      list = list.filter((record) => record.employee_id === selectedEmployee);
    }
    return list;
  }, [filteredRecords, viewMode, selectedDay, selectedEmployee]);

  // تجميع السجلات على الأيام (عرض اليوم الواحد)
  const dayGroups = useMemo(() => {
    const map = new Map<
      string,
      { date: string; total: number; present: number; absent: number; missingPunch: number; pending: number }
    >();
    filteredRecords.forEach((record) => {
      const key = record.date || '';
      if (!key) return;
      const bucket =
        map.get(key) ||
        { date: key, total: 0, present: 0, absent: 0, missingPunch: 0, pending: 0 };
      bucket.total += 1;
      if (record.status === 'present') bucket.present += 1;
      if (record.status === 'absent') bucket.absent += 1;
      if (record.status === 'missing_punch') bucket.missingPunch += 1;
      if (record.review_status === 'pending_review') bucket.pending += 1;
      map.set(key, bucket);
    });
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [filteredRecords]);

  // تجميع السجلات حسب الموظف (عرض الموظفين)
  const employeeGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        employeeId: string;
        name: string;
        code: string;
        total: number;
        absent: number;
        missingPunch: number;
        pending: number;
        deductionDays: number;
        deductionHours: number;
      }
    >();
    filteredRecords.forEach((record) => {
      const employee = employees.find((item) => item.id === record.employee_id);
      const key = record.employee_id;
      const bucket =
        map.get(key) ||
        {
          employeeId: key,
          name: record.employee_name || employee?.name || '-',
          code: record.employee_code || employee?.employee_code || '-',
          total: 0,
          absent: 0,
          missingPunch: 0,
          pending: 0,
          deductionDays: 0,
          deductionHours: 0
        };
      bucket.total += 1;
      if (record.status === 'absent') bucket.absent += 1;
      if (record.status === 'missing_punch') bucket.missingPunch += 1;
      if (record.review_status === 'pending_review') bucket.pending += 1;
      bucket.deductionDays += Number(record.calculated_deduction_days) || 0;
      bucket.deductionHours += Number(record.calculated_deduction_hours) || 0;
      map.set(key, bucket);
    });
    return Array.from(map.values()).sort(
      (a, b) => b.absent - a.absent || a.name.localeCompare(b.name)
    );
  }, [filteredRecords, employees]);

  // تفصيل شهري للموظف المختار في عرض الموظفين
  const monthlyBreakdown = useMemo(() => {
    if (viewMode !== 'employee' || !selectedEmployee) return [];
    const map = new Map<
      string,
      { month: string; total: number; present: number; absent: number; missing: number; days: number; hours: number }
    >();
    filteredRecords
      .filter((record) => record.employee_id === selectedEmployee)
      .forEach((record) => {
        const key = (record.date || '').slice(0, 7);
        if (!key) return;
        const bucket =
          map.get(key) ||
          { month: key, total: 0, present: 0, absent: 0, missing: 0, days: 0, hours: 0 };
        bucket.total += 1;
        if (record.status === 'present') bucket.present += 1;
        if (record.status === 'absent') bucket.absent += 1;
        if (record.status === 'missing_punch') bucket.missing += 1;
        bucket.days += Number(record.calculated_deduction_days) || 0;
        bucket.hours += Number(record.calculated_deduction_hours) || 0;
        map.set(key, bucket);
      });
    return Array.from(map.values()).sort((a, b) => b.month.localeCompare(a.month));
  }, [filteredRecords, selectedEmployee, viewMode]);

  const updateForm = (patch: Partial<AttendanceRecordForm>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  const openCreate = () => {
    setEditing(null);
    setForm(emptyRecordForm(employees[0]?.id || ''));
    setFormError('');
    setIsFormOpen(true);
  };

  const openEdit = (record: HRAttendanceRecord) => {
    setEditing(record);
    setForm({
      employee_id: record.employee_id,
      date: record.date || todayISO(),
      check_in: record.check_in || '',
      check_out: record.check_out || '',
      status: record.status || 'present',
      is_excused: !!record.is_excused,
      excuse_note: record.excuse_note || '',
      calculated_deduction_days: String(record.calculated_deduction_days ?? 0),
      calculated_deduction_hours: String(record.calculated_deduction_hours ?? 0),
      review_status: record.review_status || 'auto_applied'
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
      setFormError('تاريخ السجل مطلوب');
      return;
    }

    setIsSaving(true);
    setFormError('');
    // الخصم اليدوي يُحترم فقط عند تغيير المشرف لقيم الخصم؛ غير ذلك يُعاد الاحتساب تلقائياً.
    const manualDays = Number(form.calculated_deduction_days) || 0;
    const manualHours = Number(form.calculated_deduction_hours) || 0;
    const originalDays = editing ? Number(editing.calculated_deduction_days) || 0 : 0;
    const originalHours = editing ? Number(editing.calculated_deduction_hours) || 0 : 0;
    const manualDeduction =
      !form.is_excused &&
      (Math.abs(manualDays - originalDays) > 1e-9 ||
        Math.abs(manualHours - originalHours) > 1e-9);
    const payload: any = {
      employee_id: form.employee_id,
      date: form.date,
      check_in: form.check_in || null,
      check_out: form.check_out || null,
      status: form.status,
      is_excused: form.is_excused,
      excuse_note: form.excuse_note.trim(),
      calculated_deduction_days: manualDays,
      calculated_deduction_hours: manualHours,
      review_status: form.review_status,
      manual_deduction: manualDeduction,
      recalculate: !manualDeduction
    };

    try {
      if (editing) {
        await api.updateHRAttendanceRecord(editing.id, payload);
        addFlashMessage('تم تعديل سجل الحضور بنجاح');
        logAction('الموارد البشرية', `تعديل سجل حضور بتاريخ ${form.date}`);
      } else {
        await api.createHRAttendanceRecord(payload);
        addFlashMessage('تم إضافة سجل الحضور بنجاح');
        logAction('الموارد البشرية', `إضافة سجل حضور بتاريخ ${form.date}`);
      }
      closeForm();
      await loadRecords();
    } catch (err: any) {
      setFormError(err?.message || 'فشل حفظ سجل الحضور');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError('');
    try {
      await api.deleteHRAttendanceRecord(deleteTarget.id);
      addFlashMessage('تم حذف سجل الحضور بنجاح');
      logAction('الموارد البشرية', `حذف سجل حضور بتاريخ ${deleteTarget.date}`);
      setDeleteTarget(null);
      await loadRecords();
    } catch (err: any) {
      setDeleteError(err?.message || 'فشل حذف سجل الحضور');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleReview = async (record: HRAttendanceRecord, reviewStatus: HRReviewStatus) => {
    try {
      const payload: Record<string, unknown> = { review_status: reviewStatus };
      if (reviewStatus === 'rejected') {
        // رفض الخصم يعني عدم تطبيقه على المرتب.
        payload.calculated_deduction_days = 0;
        payload.calculated_deduction_hours = 0;
      }
      await api.updateHRAttendanceRecord(record.id, payload);
      addFlashMessage(
        reviewStatus === 'approved' ? 'تم اعتماد الخصم المحتسب' : 'تم رفض الخصم المحتسب'
      );
      logAction(
        'الموارد البشرية',
        `${reviewStatus === 'approved' ? 'اعتماد' : 'رفض'} خصم حضور للموظف ${
          record.employee_name || record.employee_code || ''
        }`
      );
      await Promise.all([loadRecords(), loadStats()]);
    } catch (err: any) {
      addFlashMessage(err?.message || 'فشل تحديث حالة المراجعة', 'danger');
    }
  };

  // تحميل قالب البصمة الفارغ (CSV) للشهر المختار
  const handleDownloadTemplate = async () => {
    setIsDownloading(true);
    try {
      const blob = await api.downloadHRAttendanceTemplate(month);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `attendance_template_${month || currentMonth()}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      addFlashMessage('تم تحميل قالب البصمة الفارغ، املأ أوقات الحضور والانصراف ثم ارفعه مرة أخرى');
      logAction('الموارد البشرية', `تحميل قالب بصمة شهر ${month}`);
    } catch (err: any) {
      addFlashMessage(err?.message || 'فشل تحميل قالب البصمة', 'danger');
    } finally {
      setIsDownloading(false);
    }
  };

  // رفع شيت البصمة واحتساب التأخير والغياب تلقائياً
  const handleSheetSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setIsUploading(true);
    setUploadErrors([]);
    try {
      const result = (await api.uploadHRAttendanceSheet(file, month)) as HRAttendanceImportResult;
      setUploadErrors(result.errors || []);
      const parts = [
        `${result.imported} سجل جديد`,
        `${result.updated} تحديث`,
        `${result.pending_review} بانتظار المراجعة`
      ];
      if (result.skipped) {
        parts.push(`${result.skipped} صف فارغ تم تجاهله`);
      }
      if (result.error_count) {
        parts.push(`${result.error_count} صف به أخطاء`);
      }
      addFlashMessage(`تم رفع الشيت: ${parts.join(' — ')}`);
      logAction('الموارد البشرية', `رفع شيت بصمة ${file.name}`);
      await Promise.all([loadRecords(), loadStats()]);
    } catch (err: any) {
      addFlashMessage(err?.message || 'فشل رفع شيت البصمة', 'danger');
    } finally {
      setIsUploading(false);
    }
  };

  // طباعة تقرير حضور يومي (يعتمد على السجلات المعروضة حالياً)
  const handlePrintDailyReport = () => {
    const list = [...visibleRecords].sort((a, b) => a.date.localeCompare(b.date));
    if (list.length === 0) {
      addFlashMessage('لا توجد سجلات لطباعتها', 'danger');
      return;
    }
    const rowsHtml = list
      .map((record) => {
        const employee = employees.find((item) => item.id === record.employee_id);
        return `<tr>
          <td>${escapeHtml(record.date)}</td>
          <td>${escapeHtml(record.employee_name || employee?.name || '-')}</td>
          <td>${escapeHtml(record.employee_code || employee?.employee_code || '-')}</td>
          <td>${escapeHtml(record.check_in || '—')}</td>
          <td>${escapeHtml(record.check_out || '—')}</td>
          <td>${escapeHtml(ATTENDANCE_STATUS_LABELS[record.status] || record.status)}</td>
          <td>${Number(record.calculated_deduction_days) || 0} يوم / ${Number(record.calculated_deduction_hours) || 0} ساعة</td>
          <td>${Number(record.overtime_days) || 0} يوم / ${Number(record.overtime_hours) || 0} ساعة</td>
          <td>${(Number(record.sunday_deduction_days) || 0) > 0 ? `${Number(record.sunday_deduction_days)} يوم` : '—'}</td>
        </tr>`;
      })
      .join('');
    const title = selectedDay
      ? `تقرير حضور يوم ${formatDayLabel(selectedDay)}`
      : `تقرير حضور شهر ${month}`;
    const win = window.open('', '_blank', 'width=1000,height=700');
    if (!win) {
      addFlashMessage('فضلاً اسمح بالنوافذ المنبثقة لطباعة التقرير', 'danger');
      return;
    }
    win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8" />
      <title>${escapeHtml(title)}</title>
      <style>
        body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#0f172a}
        .brand{text-align:center;margin-bottom:6px}
        h1{font-size:18px;margin:0 0 4px;text-align:center}
        p.meta{font-size:12px;color:#64748b;margin:0 0 16px;text-align:center}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:center}
        th{background:#f1f5f9}
      </style></head><body>
      <div class="brand">${renderLogoHtml(globalSettings.logo, globalSettings.site_name, 46)}</div>
      <h1>${escapeHtml(globalSettings.site_name || 'مصنع الملابس الجاهزة')} — ${escapeHtml(title)}</h1>
      <p class="meta">عدد السجلات: ${list.length} — حضور: ${summary.present} — غياب: ${summary.absents} — بانتظار المراجعة: ${summary.pending}</p>
      <table><thead><tr><th>التاريخ</th><th>الموظف</th><th>الكود</th><th>الحضور</th><th>الانصراف</th><th>الحالة</th><th>الخصم</th><th>الإضافي</th><th>خصم ${escapeHtml(weeklyOffLabel)}</th></tr></thead>
      <tbody>${rowsHtml}</tbody></table>
      </body></html>`);
    win.document.close();
    win.focus();
    logClientPrintAction('الموارد البشرية', `طباعة ${title} (${list.length} سجل)`, title);
    win.print();
  };

  // إدخال بصمة يدوية لم تُسجل على الماكينة
  const openManualTime = (record: HRAttendanceRecord) => {
    setTimeTarget(record);
    setTimeForm({
      check_in: (record.check_in || '').slice(0, 5),
      check_out: (record.check_out || '').slice(0, 5)
    });
    setTimeError('');
  };

  const handleSaveManualTime = async () => {
    if (!timeTarget) return;
    if (!timeForm.check_in && !timeForm.check_out) {
      setTimeError('أدخل بصمة الحضور أو الانصراف على الأقل');
      return;
    }
    setIsSavingTime(true);
    setTimeError('');
    try {
      await api.updateHRAttendanceRecord(timeTarget.id, {
        check_in: timeForm.check_in || null,
        check_out: timeForm.check_out || null,
        recalculate: true
      });
      addFlashMessage('تم تسجيل البصمة اليدوية وإعادة احتساب التأخير');
      logAction('الموارد البشرية', `إدخال بصمة يدوية بتاريخ ${timeTarget.date}`);
      setTimeTarget(null);
      await Promise.all([loadRecords(), loadStats()]);
    } catch (err: any) {
      setTimeError(err?.message || 'فشل حفظ البصمة اليدوية');
    } finally {
      setIsSavingTime(false);
    }
  };

  // تسجيل عذر (يلغي الخصم المحتسب) أو إلغاؤه
  const openExcuse = (record: HRAttendanceRecord) => {
    setExcuseTarget(record);
    setExcuseNote(record.excuse_note || '');
    setExcuseError('');
  };

  const handleSaveExcuse = async (remove = false) => {
    if (!excuseTarget) return;
    if (!remove && !excuseNote.trim()) {
      setExcuseError('اكتب سبب العذر قبل الحفظ');
      return;
    }
    setIsSavingExcuse(true);
    setExcuseError('');
    try {
      await api.updateHRAttendanceRecord(excuseTarget.id, {
        is_excused: !remove,
        excuse_note: remove ? '' : excuseNote.trim(),
        recalculate: true
      });
      addFlashMessage(remove ? 'تم إلغاء العذر وإعادة الخصم' : 'تم تسجيل العذر وإلغاء الخصم');
      logAction(
        'الموارد البشرية',
        `${remove ? 'إلغاء' : 'تسجيل'} عذر حضور بتاريخ ${excuseTarget.date}`
      );
      setExcuseTarget(null);
      await Promise.all([loadRecords(), loadStats()]);
    } catch (err: any) {
      setExcuseError(err?.message || 'فشل حفظ العذر');
    } finally {
      setIsSavingExcuse(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-slate-900">سجل الحضور والانصراف</h2>
          <p className="text-[11px] font-bold text-slate-500 mt-0.5">
            سجلات البصمة اليومية وخصومات التأخير، مع مراجعة يدوية قبل الخصم من المرتب عند الحاجة.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* زرّي الإكسيل ملتصقين: تحميل قالب فارغ + رفع شيت البصمة وتفريغه بالـ ID */}
          <div className="inline-flex rounded-xl overflow-hidden border border-slate-200 shadow-xs">
            <button
              type="button"
              onClick={() => void handleDownloadTemplate()}
              disabled={isDownloading}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-white text-slate-700 text-[11px] font-black hover:bg-slate-50 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border-l border-slate-200"
            >
              {isDownloading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              تحميل قالب فارغ
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-600 text-white text-[11px] font-black hover:bg-emerald-700 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUploading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              رفع شيت البصمة وتفريغه بالـ ID
            </button>
          </div>
          <button
            type="button"
            onClick={handlePrintDailyReport}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 text-white text-[11px] font-black hover:bg-indigo-700 transition cursor-pointer"
          >
            <FileText className="w-4 h-4" />
            طباعة تقرير حضور يومي
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white text-[11px] font-black hover:bg-purple-700 transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            إضافة سجل يدوي
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => void handleSheetSelected(event)}
            className="hidden"
          />
        </div>
      </div>

      <div className="p-4 bg-slate-50/60 border-b border-slate-100 grid grid-cols-1 md:grid-cols-3 gap-2">
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
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className={inputClass}
        >
          <option value="">كل الحالات</option>
          {(Object.keys(ATTENDANCE_STATUS_LABELS) as HRAttendanceStatus[]).map((key) => (
            <option key={key} value={key}>
              {ATTENDANCE_STATUS_LABELS[key]}
            </option>
          ))}
        </select>
      </div>

      {/* تنبيه بقواعد الشيت */}
      <div className="px-4 pt-3">
        <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-[11px] font-bold">
          <Info className="w-4 h-4 shrink-0" />
          <span>
            قالب البصمة يُملأ لكل أيام العمل ويُرفع بصيغة CSV أو XLSX. الصفوف الفارغة (بدون بصمات) تُتجاهل
            عند الرفع، فسجّل الغياب من عمود «الحالة» داخل الشيت أو من «إضافة سجل يدوي». ويُحوَّل السجل
            للمراجعة اليدوية تلقائياً عند البصمة الناقصة أو التأخير الكبير أو الغياب حسب قواعد الحضور.
          </span>
        </div>
      </div>

      {/* بطاقات الإحصاءات الثلاث: الالتزام — متوسط الغياب اليومي — أكثر قسم غياب */}
      <div className="px-4 pt-4 grid grid-cols-1 md:grid-cols-3 gap-2">
        <AttendanceStatCard
          label="نسبة الالتزام"
          value={`${stats?.compliance_percent ?? localCompliance}%`}
          hint={`${stats?.present ?? summary.present} حضور من ${stats?.total_records ?? filteredRecords.length}`}
          tone="emerald"
          icon={<CheckCircle2 className="w-4 h-4" />}
        />
        <AttendanceStatCard
          label="متوسط الغياب اليومي"
          value={stats?.average_daily_absence ?? 0}
          hint={`إجمالي أيام الغياب: ${stats?.absent ?? summary.absents}`}
          tone="rose"
          icon={<AlertTriangle className="w-4 h-4" />}
        />
        <AttendanceStatCard
          label="أكثر قسم فيه غياب"
          value={stats?.worst_department?.label || '—'}
          hint={
            stats?.worst_department
              ? `${stats.worst_department.absent} غياب من ${stats.worst_department.total} سجل (${stats.worst_department.rate}%)`
              : 'لا توجد بيانات كافية'
          }
          tone="indigo"
          icon={<Building2 className="w-4 h-4" />}
        />
      </div>

      {uploadErrors.length > 0 && (
        <div className="mx-4 mt-3 p-3 rounded-2xl bg-rose-50 border border-rose-200">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] font-black text-rose-700">
              صفوف لم يتم استيرادها من الشيت ({uploadErrors.length})
            </p>
            <button
              type="button"
              onClick={() => setUploadErrors([])}
              className="p-1 rounded-lg text-rose-500 hover:bg-rose-100 transition cursor-pointer"
              title="إخفاء"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <ul className="mt-1.5 space-y-1 max-h-32 overflow-y-auto">
            {uploadErrors.map((error, index) => (
              <li
                key={`${error.row}-${index}`}
                className="text-[11px] font-bold text-rose-700 flex items-center gap-1.5"
              >
                <XCircle className="w-3 h-3 shrink-0" />
                صف {error.row}: {error.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* التبديل بين عرض اليوم الواحد وعرض الموظف */}
      <div className="px-4 pt-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex p-0.5 rounded-xl bg-slate-100 border border-slate-200">
          <button
            type="button"
            onClick={() => setViewMode('day')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black transition cursor-pointer ${
              viewMode === 'day'
                ? 'bg-white text-purple-700 shadow-xs'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <LayoutList className="w-3.5 h-3.5" />
            عرض يومي
          </button>
          <button
            type="button"
            onClick={() => setViewMode('employee')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black transition cursor-pointer ${
              viewMode === 'employee'
                ? 'bg-white text-purple-700 shadow-xs'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <UsersRound className="w-3.5 h-3.5" />
            عرض الموظفين
          </button>
        </div>

        {viewMode === 'day' ? (
          <select
            value={selectedDay}
            onChange={(event) => setSelectedDay(event.target.value)}
            className={`${inputClass} md:w-56`}
          >
            <option value="">كل أيام الشهر</option>
            {dayGroups.map((group) => (
              <option key={group.date} value={group.date}>
                {formatDayLabel(group.date)} — {group.total} سجل
              </option>
            ))}
          </select>
        ) : (
          <select
            value={selectedEmployee}
            onChange={(event) => setSelectedEmployee(event.target.value)}
            className={`${inputClass} md:w-64`}
          >
            <option value="">كل الموظفين</option>
            {employeeGroups.map((group) => (
              <option key={group.employeeId} value={group.employeeId}>
                {group.name} ({group.code}) — {group.total} يوم
              </option>
            ))}
          </select>
        )}

        {(selectedDay || selectedEmployee) && (
          <button
            type="button"
            onClick={() => {
              setSelectedDay('');
              setSelectedEmployee('');
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-black text-slate-500 hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            إلغاء التصفية
          </button>
        )}
      </div>

      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-black text-slate-700">
          <CalendarDays className="w-3.5 h-3.5 text-purple-600" />
          السجلات المعروضة: {visibleRecords.length}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] font-black text-rose-700">
          <AlertTriangle className="w-3.5 h-3.5" />
          غياب: {summary.absents}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] font-black text-amber-700">
          <Clock className="w-3.5 h-3.5" />
          بانتظار المراجعة: {summary.pending}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 border border-blue-200 text-[11px] font-black text-blue-700">
          <Timer className="w-3.5 h-3.5" />
          خصم ساعات: {summary.deductionHours}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 border border-indigo-200 text-[11px] font-black text-indigo-700">
          <Banknote className="w-3.5 h-3.5" />
          خصم أيام: {summary.deductionDays}
        </span>
      </div>

      {/* ملخص الأيام في العرض اليومي */}
      {viewMode === 'day' && dayGroups.length > 0 && (
        <div className="px-4 pt-3 flex gap-2 overflow-x-auto pb-1">
          {dayGroups.slice(0, 14).map((group) => {
            const isActive = selectedDay === group.date;
            return (
              <button
                key={group.date}
                type="button"
                onClick={() => setSelectedDay(isActive ? '' : group.date)}
                className={`shrink-0 px-3 py-2 rounded-xl border text-right transition cursor-pointer ${
                  isActive
                    ? 'bg-purple-600 border-purple-600 text-white'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-purple-300'
                }`}
              >
                <p className="text-[11px] font-black whitespace-nowrap">
                  {formatDayLabel(group.date)}
                </p>
                <p
                  className={`text-[10px] font-bold whitespace-nowrap mt-0.5 ${
                    isActive ? 'text-purple-100' : 'text-slate-500'
                  }`}
                >
                  {group.present} حضور • {group.absent} غياب
                  {group.pending > 0 ? ` • ${group.pending} مراجعة` : ''}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {/* تفصيل شهري للموظف المختار في عرض الموظفين */}
      {viewMode === 'employee' && selectedEmployee && monthlyBreakdown.length > 0 && (
        <div className="px-4 pt-3 flex flex-wrap gap-2">
          {monthlyBreakdown.map((row) => (
            <div key={row.month} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
              <p className="text-[11px] font-black text-slate-700 font-mono">{row.month}</p>
              <p className="text-[10px] font-bold text-slate-500">
                {row.present} حضور • {row.absent} غياب • {row.missing} بصمة ناقصة
              </p>
              <p className="text-[10px] font-bold text-indigo-600 font-mono">
                خصم: {row.days} يوم / {row.hours} ساعة
              </p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="p-10 text-center text-xs font-bold text-slate-400">جاري التحميل...</div>
      ) : visibleRecords.length === 0 ? (
        <div className="p-10 text-center">
          <Clock className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="text-xs font-black text-slate-700">لا توجد سجلات حضور مطابقة للاختيار الحالي</p>
          <p className="text-[11px] font-bold text-slate-500 mt-1">
            حمّل قالب البصمة الفارغ وارفعه بعد ملء الأوقات، أو أضف سجلاً يدوياً للمراجعة.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-right px-4 py-2.5 font-black whitespace-nowrap">التاريخ</th>
                <th className="text-right px-4 py-2.5 font-black whitespace-nowrap">الموظف</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">الحضور</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">الانصراف</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">الحالة</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">الخصم</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">المراجعة</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRecords.map((record) => {
                const employee = employees.find((item) => item.id === record.employee_id);
                return (
                  <tr key={record.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-mono font-bold text-slate-700 whitespace-nowrap">
                      <p>{record.date}</p>
                      <p className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                        {formatDayLabel(record.date)}
                        {(record.review_status === 'pending_review' ||
                          employee?.rule_application_mode === 'manual_review') && (
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500"
                            title="موظف بنظام المراجعة اليدوية"
                          />
                        )}
                      </p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="font-black text-slate-900">
                        {record.employee_name || employee?.name || '-'}
                      </p>
                      <p className="font-bold text-[10px] text-slate-400 font-mono">
                        {record.employee_code || employee?.employee_code || '-'}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-bold text-slate-600">
                      <span className={!record.check_in ? 'text-rose-500' : undefined}>
                        {record.check_in || '—'}
                      </span>
                      {!record.check_in && (
                        <p className="text-[9px] font-black text-rose-500 mt-0.5">نسيان بصمة</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-bold text-slate-600">
                      <span className={!record.check_out ? 'text-rose-500' : undefined}>
                        {record.check_out || '—'}
                      </span>
                      {!record.check_out && (
                        <p className="text-[9px] font-black text-rose-500 mt-0.5">نسيان بصمة</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black border ${
                          record.status === 'present'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : record.status === 'absent'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : record.status === 'missing_punch'
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-blue-50 text-blue-700 border-blue-200'
                        }`}
                      >
                        {ATTENDANCE_STATUS_LABELS[record.status] || record.status}
                      </span>
                      {record.is_excused && (
                        <p className="mt-1 text-[10px] font-bold text-slate-500">بعذر</p>
                      )}
                      {record.status === 'missing_punch' && (
                        <button
                          type="button"
                          onClick={() => openManualTime(record)}
                          className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-700 text-[9px] font-black hover:bg-amber-100 transition cursor-pointer"
                          title="نسيان بصمة — إدخال الوقت الناقص يدوياً"
                        >
                          <AlertTriangle className="w-3 h-3" />
                          نسيان بصمة — إدخال الوقت
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <p className="font-black text-slate-800 font-mono">
                        {Number(record.calculated_deduction_days) || 0} يوم
                      </p>
                      <p className="font-bold text-[10px] text-slate-500 font-mono">
                        {Number(record.calculated_deduction_hours) || 0} ساعة
                      </p>
                      {(Number(record.overtime_days) || 0) > 0 ||
                      (Number(record.overtime_hours) || 0) > 0 ? (
                        <p className="font-bold text-[10px] text-emerald-600 font-mono mt-0.5">
                          إضافي: {Number(record.overtime_days) || 0} يوم /{' '}
                          {Number(record.overtime_hours) || 0} ساعة
                        </p>
                      ) : null}
                      {(Number(record.sunday_deduction_days) || 0) > 0 && (
                        <p className="font-black text-[10px] text-rose-600 font-mono mt-0.5">
                          خصم {weeklyOffLabel}: {Number(record.sunday_deduction_days) || 0} يوم
                        </p>
                      )}
                      {record.sunday_deduction_note && (
                        <p className="text-[9px] font-bold text-slate-400 max-w-[170px] whitespace-normal mt-0.5">
                          {record.sunday_deduction_note}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black border ${
                          record.review_status === 'pending_review'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : record.review_status === 'rejected'
                              ? 'bg-slate-100 text-slate-600 border-slate-200'
                              : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}
                      >
                        {REVIEW_STATUS_LABELS[record.review_status] || record.review_status}
                      </span>
                      {record.review_status === 'pending_review' && (
                        <div className="flex items-center justify-center gap-1 mt-1">
                          <button
                            type="button"
                            onClick={() => void handleReview(record, 'approved')}
                            className="px-2 py-0.5 rounded-md bg-emerald-600 text-white text-[10px] font-black hover:bg-emerald-700 transition cursor-pointer"
                          >
                            قبول الخصم
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleReview(record, 'rejected')}
                            className="px-2 py-0.5 rounded-md bg-rose-600 text-white text-[10px] font-black hover:bg-rose-700 transition cursor-pointer"
                          >
                            رفض الخصم
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => openManualTime(record)}
                          title="إدخال بصمة يدوية"
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition cursor-pointer"
                        >
                          <Timer className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openExcuse(record)}
                          title={record.is_excused ? 'تعديل / إلغاء العذر' : 'تسجيل عذر'}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black transition cursor-pointer ${
                            record.is_excused
                              ? 'text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100'
                              : 'text-slate-600 bg-slate-50 border border-slate-200 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200'
                          }`}
                        >
                          <FileText className="w-3 h-3" />
                          {record.is_excused ? 'إلغاء العذر' : 'تسجيل عذر'}
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(record)}
                          title="تعديل"
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-purple-50 hover:text-purple-600 transition cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError('');
                            setDeleteTarget(record);
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
          title={editing ? 'تعديل سجل حضور' : 'إضافة سجل حضور يدوي'}
          subtitle="يُحسب الخصم من قواعد الحضور، ويمكن تعديله يدوياً مع تسجيل حالة المراجعة"
          onClose={closeForm}
          maxWidthClass="max-w-2xl"
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
                <label className={labelClass}>التاريخ *</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(event) => updateForm({ date: event.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>بصمة الحضور</label>
                <input
                  type="time"
                  value={form.check_in}
                  onChange={(event) => updateForm({ check_in: event.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className={labelClass}>بصمة الانصراف</label>
                <input
                  type="time"
                  value={form.check_out}
                  onChange={(event) => updateForm({ check_out: event.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className={labelClass}>حالة الحضور</label>
                <select
                  value={form.status}
                  onChange={(event) =>
                    updateForm({ status: event.target.value as HRAttendanceStatus })
                  }
                  className={inputClass}
                >
                  {(Object.keys(ATTENDANCE_STATUS_LABELS) as HRAttendanceStatus[]).map((key) => (
                    <option key={key} value={key}>
                      {ATTENDANCE_STATUS_LABELS[key]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_excused}
                onChange={(event) => updateForm({ is_excused: event.target.checked })}
                className="w-4 h-4 accent-purple-600"
              />
              <span className="text-[11px] font-black text-slate-700">
                الغياب بعذر (لا يتم تطبيق خصم الغياب)
              </span>
            </label>

            {form.is_excused && (
              <div>
                <label className={labelClass}>سبب العذر</label>
                <input
                  value={form.excuse_note}
                  onChange={(event) => updateForm({ excuse_note: event.target.value })}
                  placeholder="مثال: إجازة مرضية بموافقة الإدارة"
                  className={inputClass}
                />
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>خصم (أيام)</label>
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={form.calculated_deduction_days}
                  onChange={(event) => updateForm({ calculated_deduction_days: event.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className={labelClass}>خصم (ساعات)</label>
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={form.calculated_deduction_hours}
                  onChange={(event) =>
                    updateForm({ calculated_deduction_hours: event.target.value })
                  }
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className={labelClass}>حالة المراجعة</label>
                <select
                  value={form.review_status}
                  onChange={(event) =>
                    updateForm({ review_status: event.target.value as HRReviewStatus })
                  }
                  className={inputClass}
                >
                  {(Object.keys(REVIEW_STATUS_LABELS) as HRReviewStatus[]).map((key) => (
                    <option key={key} value={key}>
                      {REVIEW_STATUS_LABELS[key]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-[11px] font-bold">
              <Info className="w-4 h-4 shrink-0" />
              <span>
                يُعاد احتساب التأخير تلقائياً من قواعد الحضور عند الحفظ. عدّل «خصم (أيام/ساعات)»
                يدوياً فقط لتجاوز القواعد. القيمة المالية = (أيام × المرتب ÷ 30) + (ساعات × المرتب ÷
                30 ÷ 8).
              </span>
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
                {isSaving ? 'جاري الحفظ...' : 'حفظ السجل'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {timeTarget && (
        <Modal
          title="إدخال بصمة يدوية"
          subtitle="تُستخدم عند نسيان البصمة على الماكينة، ويُعاد احتساب التأخير تلقائياً بعد الحفظ"
          onClose={() => {
            setTimeTarget(null);
            setTimeError('');
          }}
          maxWidthClass="max-w-md"
        >
          <div className="space-y-3">
            <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-[11px] font-black text-slate-800">
                {timeTarget.employee_name || '-'}{' '}
                <span className="font-mono text-slate-400">({timeTarget.employee_code || '-'})</span>
              </p>
              <p className="text-[10px] font-bold text-slate-500 font-mono mt-0.5">
                {formatDayLabel(timeTarget.date)} — {timeTarget.date}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>بصمة الحضور</label>
                <input
                  type="time"
                  value={timeForm.check_in}
                  onChange={(event) =>
                    setTimeForm((prev) => ({ ...prev, check_in: event.target.value }))
                  }
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className={labelClass}>بصمة الانصراف</label>
                <input
                  type="time"
                  value={timeForm.check_out}
                  onChange={(event) =>
                    setTimeForm((prev) => ({ ...prev, check_out: event.target.value }))
                  }
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>

            <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-[11px] font-bold">
              <Info className="w-4 h-4 shrink-0" />
              <span>
                الخصم الحالي: {Number(timeTarget.calculated_deduction_days) || 0} يوم /{' '}
                {Number(timeTarget.calculated_deduction_hours) || 0} ساعة، وسيتم تحديثه بعد الحفظ.
              </span>
            </div>

            <ErrorNote message={timeError} />

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setTimeTarget(null);
                  setTimeError('');
                }}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-black hover:bg-slate-200 transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void handleSaveManualTime()}
                disabled={isSavingTime}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-[11px] font-black hover:bg-blue-700 transition cursor-pointer disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                {isSavingTime ? 'جاري الحفظ...' : 'حفظ البصمة'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {excuseTarget && (
        <Modal
          title={excuseTarget.is_excused ? 'تعديل / إلغاء العذر' : 'تسجيل عذر حضور'}
          subtitle="تسجيل العذر يلغي الخصم المحتسب على هذا اليوم"
          onClose={() => {
            setExcuseTarget(null);
            setExcuseError('');
          }}
          maxWidthClass="max-w-md"
        >
          <div className="space-y-3">
            <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-[11px] font-black text-slate-800">
                {excuseTarget.employee_name || '-'}{' '}
                <span className="font-mono text-slate-400">
                  ({excuseTarget.employee_code || '-'})
                </span>
              </p>
              <p className="text-[10px] font-bold text-slate-500 font-mono mt-0.5">
                {formatDayLabel(excuseTarget.date)} — {excuseTarget.date}
              </p>
            </div>

            <div>
              <label className={labelClass}>سبب العذر *</label>
              <input
                value={excuseNote}
                onChange={(event) => setExcuseNote(event.target.value)}
                placeholder="مثال: إجازة مرضية بموافقة الإدارة"
                className={inputClass}
              />
            </div>

            <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-bold">
              <Info className="w-4 h-4 shrink-0" />
              <span>
                الخصم الحالي: {Number(excuseTarget.calculated_deduction_days) || 0} يوم /{' '}
                {Number(excuseTarget.calculated_deduction_hours) || 0} ساعة، وسيتم تصفيره بعد حفظ
                العذر.
              </span>
            </div>

            <ErrorNote message={excuseError} />

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setExcuseTarget(null);
                  setExcuseError('');
                }}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-black hover:bg-slate-200 transition cursor-pointer"
              >
                إلغاء
              </button>
              {excuseTarget.is_excused && (
                <button
                  type="button"
                  onClick={() => void handleSaveExcuse(true)}
                  disabled={isSavingExcuse}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-200 text-slate-700 text-[11px] font-black hover:bg-slate-300 transition cursor-pointer disabled:opacity-60"
                >
                  <XCircle className="w-4 h-4" />
                  إلغاء العذر
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleSaveExcuse(false)}
                disabled={isSavingExcuse}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-[11px] font-black hover:bg-emerald-700 transition cursor-pointer disabled:opacity-60"
              >
                <CheckCircle2 className="w-4 h-4" />
                {isSavingExcuse ? 'جاري الحفظ...' : 'حفظ العذر'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          title="تأكيد حذف سجل الحضور"
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
                سيتم حذف سجل حضور بتاريخ <strong className="font-mono">{deleteTarget.date}</strong>{' '}
                للموظف{' '}
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
                {isDeleting ? 'جاري الحذف...' : 'حذف السجل'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};


