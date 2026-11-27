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

type EmployeeForm = {
  name: string;
  employee_code: string;
  job_id: string;
  monthly_salary: string;
  rule_application_mode: HRRuleApplicationMode;
  national_id: string;
  birth_date: string;
  hire_date: string;
  termination_date: string;
  phone: string;
  photo: string;
  notes: string;
  is_active: boolean;
  rank_level: number;
};

const emptyEmployeeForm: EmployeeForm = {
  name: '',
  employee_code: '',
  job_id: '',
  monthly_salary: '',
  rule_application_mode: 'auto',
  national_id: '',
  birth_date: '',
  hire_date: '',
  termination_date: '',
  phone: '',
  photo: '',
  notes: '',
  is_active: true,
  rank_level: 3
};

export const EmployeesPanel: React.FC<{
  employees: HREmployee[];
  jobTitles: HRJobTitle[];
  isLoading: boolean;
  onRefresh: () => void | Promise<void>;
}> = ({ employees, jobTitles, isLoading, onRefresh }) => {
  const { addFlashMessage, logAction, visibleRankOptions, rankLabelFor, currentUserRank, canAccessHRSection } = useApp();
  const rankOptions = visibleRankOptions();
  // المرتب الشهري مخفي كلياً عمّن لا يملك صلاحية تبويب المرتبات (يحجبها الباك إند أيضاً).
  const canViewSalary = canAccessHRSection('payroll');
  // إخفاء مفهوم الرتب تماماً عمّن لا يملك إلا خياراً واحداً (رتبة 3، ورتبة 2 المفروضة على العام).
  const canChooseRank = currentUserRank !== 3 && rankOptions.length > 1;
  const forcedRankLevel = Number(rankOptions[rankOptions.length - 1]?.value ?? 3);
  // تسمية المستوى تُبنى دائماً من منظور المستخدم الحالي (بدون أرقام ولا مستويات أعلى).
  const rankLabelOf = (employee: HREmployee): string =>
    currentUserRank === 3
      ? ''
      : rankLabelFor(Number(employee.rank_level ?? 3)) || employee.rank_label || '';

  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [jobFilter, setJobFilter] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<HREmployee | null>(null);
  const [form, setForm] = useState<EmployeeForm>(emptyEmployeeForm);
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<HREmployee | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPhotoUploading, setIsPhotoUploading] = useState(false);

  const jobsForFilter = useMemo(() => {
    if (!departmentFilter) return jobTitles;
    return jobTitles.filter((job) => job.department === departmentFilter);
  }, [jobTitles, departmentFilter]);

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((emp) => {
      if (departmentFilter && emp.department !== departmentFilter) return false;
      if (jobFilter && emp.job_id !== jobFilter) return false;
      if (!q) return true;
      return (
        emp.name.toLowerCase().includes(q) ||
        (emp.employee_code || '').toLowerCase().includes(q) ||
        (emp.job_title || '').toLowerCase().includes(q) ||
        (emp.phone || '').includes(q)
      );
    });
  }, [employees, search, departmentFilter, jobFilter]);

  const updateForm = (patch: Partial<EmployeeForm>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setFormError('');
    setIsPhotoUploading(true);
    try {
      const uploaded = await api.uploadImage(file, 'hr');
      updateForm({ photo: uploaded.url });
    } catch (err: any) {
      setFormError(err?.message || 'فشل رفع صورة الموظف. يرجى المحاولة مرة أخرى.');
    } finally {
      setIsPhotoUploading(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...emptyEmployeeForm,
      job_id: jobTitles[0]?.id || '',
      rank_level: forcedRankLevel
    });
    setFormError('');
    setIsFormOpen(true);
  };

  const openEdit = (employee: HREmployee) => {
    setEditing(employee);
    setForm({
      name: employee.name || '',
      employee_code: employee.employee_code || '',
      job_id: employee.job_id || '',
      monthly_salary: String(employee.monthly_salary ?? ''),
      rule_application_mode: employee.rule_application_mode || 'auto',
      national_id: employee.national_id || '',
      birth_date: employee.birth_date || '',
      hire_date: employee.hire_date || '',
      termination_date: employee.termination_date || '',
      phone: employee.phone || '',
      photo: employee.photo || '',
      notes: employee.notes || '',
      is_active: employee.is_active !== false,
      // من لا يملك خيارات رتبة يُثبت تلقائياً على المستوى العام (3).
      rank_level: canChooseRank ? Number(employee.rank_level ?? 3) : forcedRankLevel
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
    const name = form.name.trim();
    if (!name) {
      setFormError('اسم الموظف مطلوب');
      return;
    }
    if (!form.job_id) {
      setFormError('يرجى اختيار وظيفة الموظف');
      return;
    }
    const salary = Number(form.monthly_salary);
    if (canViewSalary && (!Number.isFinite(salary) || salary <= 0)) {
      setFormError('المرتب الشهري يجب أن يكون أكبر من صفر');
      return;
    }

    if (form.hire_date && form.termination_date && form.termination_date < form.hire_date) {
      setFormError('تاريخ ترك العمل لا يمكن أن يسبق تاريخ التعيين');
      return;
    }

    setIsSaving(true);
    setFormError('');
    const payload: any = {
      name,
      employee_code: form.employee_code.trim(),
      job_id: form.job_id,
      rule_application_mode: form.rule_application_mode,
      national_id: form.national_id.trim(),
      birth_date: form.birth_date || null,
      hire_date: form.hire_date || null,
      termination_date: form.termination_date || null,
      phone: form.phone.trim(),
      photo: form.photo.trim(),
      notes: form.notes.trim(),
      is_active: form.is_active,
      rank_level: canChooseRank ? form.rank_level : forcedRankLevel
    };
    // يُرسل المرتب فقط لمن يملك صلاحية الرواتب حتى لا يُصفَّر مرتب الموظف بالخطأ.
    if (canViewSalary) payload.monthly_salary = salary;

    try {
      if (editing) {
        const saved = await api.updateHREmployee(editing.id, payload);
        // تحقق دفاعي: إن رجّع السيرفر المرتب محجوباً (null) بينما المستخدم
        // يملك صلاحية عرضه، فلا نُظهر نجاحاً زائفاً — بل نُبقى النموذج مفتوحاً.
        if (canViewSalary && (saved?.monthly_salary === null || saved?.monthly_salary === undefined)) {
          setFormError('لم يُحفظ المرتب: رفض السيرفر حفظ المرتب لعدم توفر صلاحية الرواتب لديك.');
          return;
        }
        addFlashMessage('تم تعديل بيانات الموظف بنجاح');
        logAction('الموارد البشرية', `تعديل بيانات موظف: ${name}`);
      } else {
        const created = await api.createHREmployee(payload);
        if (canViewSalary && (created?.monthly_salary === null || created?.monthly_salary === undefined)) {
          setFormError('لم يُحفظ المرتب: رفض السيرفر حفظ المرتب لعدم توفر صلاحية الرواتب لديك.');
          return;
        }
        addFlashMessage('تم إضافة الموظف بنجاح');
        logAction('الموارد البشرية', `إضافة موظف: ${name}`);
      }
      closeForm();
      await onRefresh();
    } catch (err: any) {
      setFormError(err?.message || 'فشل حفظ بيانات الموظف');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError('');
    try {
      await api.deleteHREmployee(deleteTarget.id);
      addFlashMessage('تم حذف الموظف بنجاح');
      logAction('الموارد البشرية', `حذف موظف: ${deleteTarget.name}`);
      setDeleteTarget(null);
      await onRefresh();
    } catch (err: any) {
      setDeleteError(err?.message || 'فشل حذف الموظف');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-slate-900">ملفات الموظفين</h2>
          <p className="text-[11px] font-bold text-slate-500 mt-0.5">
            الوظيفة تحدد القسم والمرتب، وكود الموظف هو نفس الـ ID المسجل على ماكينة البصمة.
          </p>
        </div>
        {canViewSalary && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white text-[11px] font-black hover:bg-purple-700 transition cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            إضافة موظف
          </button>
        )}
      </div>

      <div className="p-4 bg-slate-50/60 border-b border-slate-100 grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="بحث بالاسم أو كود البصمة أو الهاتف..."
            className={`${inputClass} pr-9`}
          />
        </div>
        <select
          value={departmentFilter}
          onChange={(event) => {
            setDepartmentFilter(event.target.value);
            setJobFilter('');
          }}
          className={inputClass}
        >
          <option value="">كل الأقسام</option>
          {HR_DEPARTMENTS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          value={jobFilter}
          onChange={(event) => setJobFilter(event.target.value)}
          className={inputClass}
        >
          <option value="">كل الوظائف</option>
          {jobsForFilter.map((job) => (
            <option key={job.id} value={job.id}>
              {job.title}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="p-10 text-center text-xs font-bold text-slate-400">جاري التحميل...</div>
      ) : filteredEmployees.length === 0 ? (
        <div className="p-10 text-center">
          <Users className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="text-xs font-black text-slate-700">لا يوجد موظفون مطابقون</p>
          <p className="text-[11px] font-bold text-slate-500 mt-1">
            تأكد من وجود وظائف أولاً، ثم أضف الموظف وحدد وظيفته ومرتبه الشهري.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="bg-slate-50 text-slate-500 font-black">
              <tr>
                <th className="px-3 py-2.5 text-start">كود البصمة</th>
                <th className="px-3 py-2.5 text-start">اسم الموظف</th>
                <th className="px-3 py-2.5 text-start">الوظيفة</th>
                <th className="px-3 py-2.5 text-start">القسم</th>
                {canViewSalary && (
                  <th className="px-3 py-2.5 text-start">المرتب الشهري</th>
                )}
                <th className="px-3 py-2.5 text-start">تطبيق القواعد</th>
                <th className="px-3 py-2.5 text-start">الحالة</th>
                <th className="px-3 py-2.5 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredEmployees.map((emp) => (
                <tr key={emp.id} className="hover:bg-slate-50/70 transition">
                  <td className="px-3 py-2.5 font-mono text-slate-600">
                    {emp.employee_code || '-'}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-full bg-purple-50 text-purple-700 flex items-center justify-center font-black text-[10px] shrink-0">
                        {(emp.name || '?').charAt(0)}
                      </span>
                      <span className="font-black text-slate-800 truncate">{emp.name}</span>
                      {rankLabelOf(emp) && (
                        <span className="px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200 text-[9px] font-black whitespace-nowrap">
                          {rankLabelOf(emp)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 font-bold text-slate-700">{emp.job_title || '-'}</td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-bold text-[10px] whitespace-nowrap">
                      <Building2 className="w-3 h-3" />
                      {emp.department_label ||
                        HR_DEPARTMENT_LABELS[emp.department as HRDepartmentKey] ||
                        '-'}
                    </span>
                  </td>
                  {canViewSalary && (
                    <td className="px-3 py-2.5 font-mono font-black whitespace-nowrap">
                      {emp.monthly_salary === null || emp.monthly_salary === undefined ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-black">
                          🔒 محجوب
                        </span>
                      ) : (
                        <span className="text-emerald-700">{formatMoney(emp.monthly_salary)}</span>
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${
                        emp.rule_application_mode === 'manual_review'
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'bg-blue-50 text-blue-700 border border-blue-200'
                      }`}
                    >
                      {RULE_APPLICATION_LABELS[emp.rule_application_mode] ||
                        RULE_APPLICATION_LABELS.auto}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        emp.is_active === false
                          ? 'bg-slate-100 text-slate-500'
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      }`}
                    >
                      {emp.is_active === false ? 'موقوف' : 'نشط'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(emp)}
                        title="تعديل"
                        className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-purple-600 transition cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteTarget(emp);
                          setDeleteError('');
                        }}
                        title="حذف"
                        className="p-1.5 rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isFormOpen && (
        <Modal
          title={editing ? 'تعديل بيانات موظف' : 'إضافة موظف جديد'}
          subtitle="بيانات الموظف ووظيفته ومرتبه وقواعد تطبيق الخصم"
          onClose={closeForm}
          maxWidthClass="max-w-2xl"
        >
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>اسم الموظف *</label>
                <input
                  value={form.name}
                  onChange={(event) => updateForm({ name: event.target.value })}
                  placeholder="الاسم رباعي"
                  className={inputClass}
                  autoFocus
                />
              </div>
              <div>
                <label className={labelClass}>كود الموظف / ID البصمة</label>
                <input
                  value={form.employee_code}
                  onChange={(event) => updateForm({ employee_code: event.target.value })}
                  placeholder="مثال: 1001"
                  className={`${inputClass} font-mono`}
                />
                <p className="text-[10px] font-bold text-slate-400 mt-1">
                  اتركه فارغاً ليتم توليد كود تلقائي، ويجب أن يطابق رقم المستخدم على ماكينة البصمة.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>الوظيفة *</label>
                <select
                  value={form.job_id}
                  onChange={(event) => updateForm({ job_id: event.target.value })}
                  className={inputClass}
                >
                  <option value="">اختر الوظيفة</option>
                  {jobTitles.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.title} - {HR_DEPARTMENT_LABELS[job.department] || job.department}
                    </option>
                  ))}
                </select>
              </div>
              {canViewSalary ? (
                <div>
                  <label className={labelClass}>المرتب الشهري (ج.م) *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.monthly_salary}
                    onChange={(event) => updateForm({ monthly_salary: event.target.value })}
                    placeholder="0.00"
                    className={`${inputClass} font-mono`}
                  />
                </div>
              ) : (
                <div className="flex items-end">
                  <p className="text-[10px] font-bold text-slate-400 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 w-full">
                    المرتب الشهري مخفي — يتطلب صلاحية تبويب المرتبات. لن يتم تغيير مرتب
                    الموظف عند حفظ باقي البيانات.
                  </p>
                </div>
              )}
            </div>

            {canChooseRank && (
              <div>
                <label className={labelClass}>نطاق الرؤية والتحكم للموظف</label>
                <select
                  value={form.rank_level}
                  onChange={(event) => updateForm({ rank_level: Number(event.target.value) })}
                  className={inputClass}
                >
                  {rankOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} — {opt.description}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className={labelClass}>طريقة تطبيق قواعد التأخير والخصم</label>
              <select
                value={form.rule_application_mode}
                onChange={(event) =>
                  updateForm({
                    rule_application_mode: event.target.value as HRRuleApplicationMode
                  })
                }
                className={inputClass}
              >
                <option value="auto">{RULE_APPLICATION_LABELS.auto}</option>
                <option value="manual_review">{RULE_APPLICATION_LABELS.manual_review}</option>
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>الرقم القومي</label>
                <input
                  value={form.national_id}
                  onChange={(event) => updateForm({ national_id: event.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className={labelClass}>الهاتف</label>
                <input
                  value={form.phone}
                  onChange={(event) => updateForm({ phone: event.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className={labelClass}>تاريخ الميلاد</label>
                <input
                  type="date"
                  value={form.birth_date}
                  onChange={(event) => updateForm({ birth_date: event.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>تاريخ التعيين / بداية العمل (اختياري)</label>
                <input
                  type="date"
                  value={form.hire_date}
                  onChange={(event) => updateForm({ hire_date: event.target.value })}
                  className={`${inputClass} font-mono`}
                />
                <p className="text-[10px] font-bold text-slate-400 mt-1">
                  يُستخدم لمحاسبة الموظف الجديد بالأيام الفعلية فقط في شهر تعيينه دون خصم الأيام السابقة.
                </p>
              </div>
              <div>
                <label className={labelClass}>تاريخ ترك العمل (اختياري)</label>
                <input
                  type="date"
                  value={form.termination_date}
                  onChange={(event) => updateForm({ termination_date: event.target.value })}
                  className={`${inputClass} font-mono`}
                />
                <p className="text-[10px] font-bold text-slate-400 mt-1">
                  عند تحديده يُحاسب الموظف بالأيام الفعلية حتى هذا التاريخ فقط.
                </p>
              </div>
            </div>

            <div>
              <label className={labelClass}>صورة الموظف (اختياري)</label>
              <div className="flex items-center gap-2">
                <input
                  value={form.photo}
                  onChange={(event) => updateForm({ photo: event.target.value })}
                  placeholder="https://..."
                  className={`${inputClass} font-mono flex-1`}
                  dir="ltr"
                />
                <label
                  className={`px-3 py-2 rounded-xl text-white text-[10px] font-black shrink-0 inline-flex items-center gap-1 cursor-pointer transition ${
                    isPhotoUploading ? 'bg-slate-400 cursor-wait' : 'bg-purple-600 hover:bg-purple-700'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{isPhotoUploading ? 'جارٍ الرفع...' : 'رفع صورة'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={isPhotoUploading}
                    onChange={handlePhotoUpload}
                    className="hidden"
                  />
                </label>
              </div>
              {form.photo && (
                <img
                  src={form.photo}
                  alt="صورة الموظف"
                  className="w-14 h-14 object-cover rounded-xl border border-slate-200 mt-2"
                />
              )}
            </div>

            <div>
              <label className={labelClass}>ملاحظات</label>
              <textarea
                value={form.notes}
                onChange={(event) => updateForm({ notes: event.target.value })}
                rows={2}
                className={inputClass}
                placeholder="أي ملاحظات إدارية عن الموظف..."
              />
            </div>

            <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) => updateForm({ is_active: event.target.checked })}
                className="w-4 h-4 accent-purple-600"
              />
              <span className="text-[11px] font-black text-slate-700">
                الموظف نشط (يظهر في الحضور والمرتبات)
              </span>
            </label>

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
                disabled={isSaving || isPhotoUploading}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white text-[11px] font-black hover:bg-purple-700 transition cursor-pointer disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                {isSaving ? 'جاري الحفظ...' : isPhotoUploading ? 'جارٍ رفع الصورة...' : 'حفظ بيانات الموظف'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          title="تأكيد حذف الموظف"
          subtitle="لا يمكن التراجع عن هذه العملية"
          onClose={() => {
            setDeleteTarget(null);
            setDeleteError('');
          }}
          maxWidthClass="max-w-2xl"
        >
          <div className="space-y-3">
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-bold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                سيتم حذف الموظف <strong>{deleteTarget.name}</strong> مع سجلات الحضور والجزاءات
                والسُلف المرتبطة به.
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
                {isDeleting ? 'جاري الحذف...' : 'حذف الموظف'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};










