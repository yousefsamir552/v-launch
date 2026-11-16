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

export const JobsPanel: React.FC<{
  jobTitles: HRJobTitle[];
  employees: HREmployee[];
  isLoading: boolean;
  onRefresh: () => void | Promise<void>;
}> = ({ jobTitles, employees, isLoading, onRefresh }) => {
  const { addFlashMessage, logAction } = useApp();

  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<HRJobTitle | null>(null);
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState<HRDepartmentKey>('sewing');
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<HRJobTitle | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const employeesByJob = useMemo(() => {
    const map: Record<string, number> = {};
    employees.forEach((emp) => {
      map[emp.job_id] = (map[emp.job_id] || 0) + 1;
    });
    return map;
  }, [employees]);

  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobTitles.filter((job) => {
      if (departmentFilter && job.department !== departmentFilter) return false;
      if (!q) return true;
      const departmentLabel = HR_DEPARTMENT_LABELS[job.department] || '';
      return job.title.toLowerCase().includes(q) || departmentLabel.includes(search.trim());
    });
  }, [jobTitles, search, departmentFilter]);

  const openCreate = () => {
    setEditing(null);
    setTitle('');
    setDepartment('sewing');
    setFormError('');
    setIsFormOpen(true);
  };

  const openEdit = (job: HRJobTitle) => {
    setEditing(job);
    setTitle(job.title);
    setDepartment(job.department);
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
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setFormError('اسم الوظيفة مطلوب');
      return;
    }
    setIsSaving(true);
    setFormError('');
    try {
      if (editing) {
        await api.updateHRJobTitle(editing.id, { title: cleanTitle, department });
        addFlashMessage('تم تعديل الوظيفة بنجاح');
        logAction('الموارد البشرية', `تعديل وظيفة: ${cleanTitle}`);
      } else {
        await api.createHRJobTitle({ title: cleanTitle, department });
        addFlashMessage('تمت إضافة الوظيفة بنجاح');
        logAction('الموارد البشرية', `إضافة وظيفة: ${cleanTitle}`);
      }
      closeForm();
      await onRefresh();
    } catch (err: any) {
      setFormError(err?.message || 'فشل حفظ الوظيفة');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError('');
    try {
      await api.deleteHRJobTitle(deleteTarget.id);
      addFlashMessage('تم حذف الوظيفة بنجاح');
      logAction('الموارد البشرية', `حذف وظيفة: ${deleteTarget.title}`);
      setDeleteTarget(null);
      await onRefresh();
    } catch (err: any) {
      setDeleteError(err?.message || 'فشل حذف الوظيفة');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-slate-900">وظائف المصنع</h2>
          <p className="text-[11px] font-bold text-slate-500 mt-0.5">
            كل وظيفة مرتبطة بقسم من أقسام المصنع، ومرتب الموظف يُسحب تلقائياً من وظيفته.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white text-[11px] font-black hover:bg-purple-700 transition cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          إضافة وظيفة
        </button>
      </div>

      <div className="p-4 bg-slate-50/60 border-b border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="بحث باسم الوظيفة أو القسم..."
            className={`${inputClass} pr-9`}
          />
        </div>
        <select
          value={departmentFilter}
          onChange={(event) => setDepartmentFilter(event.target.value)}
          className={inputClass}
        >
          <option value="">كل الأقسام</option>
          {HR_DEPARTMENTS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="p-10 text-center text-xs font-bold text-slate-400">جاري التحميل...</div>
      ) : filteredJobs.length === 0 ? (
        <div className="p-10 text-center">
          <Briefcase className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="text-xs font-black text-slate-700">لا توجد وظائف مطابقة</p>
          <p className="text-[11px] font-bold text-slate-500 mt-1">
            ابدأ بإضافة وظيفة جديدة وحدد قسمها من أقسام المصنع.
          </p>
        </div>
      ) : (
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredJobs.map((job) => (
            <div
              key={job.id}
              className="border border-slate-200 rounded-2xl p-3.5 hover:border-purple-300 transition"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-black text-slate-900 truncate">{job.title}</p>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 mt-1">
                    <Building2 className="w-3 h-3 text-purple-500" />
                    {HR_DEPARTMENT_LABELS[job.department] || job.department}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEdit(job)}
                    title="تعديل"
                    className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-purple-600 transition cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteTarget(job);
                      setDeleteError('');
                    }}
                    title="حذف"
                    className="p-1.5 rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[10px] font-bold text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <Users className="w-3 h-3 text-purple-500" />
                  {employeesByJob[job.id] || 0} موظف
                </span>
                <span className="font-mono text-slate-400">{job.id.slice(0, 8)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {isFormOpen && (
        <Modal
          title={editing ? 'تعديل وظيفة' : 'إضافة وظيفة جديدة'}
          subtitle="اختر اسماً واضحاً للوظيفة وحدد القسم الذي تعمل به"
          onClose={closeForm}
          maxWidthClass="max-w-lg"
        >
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className={labelClass}>اسم الوظيفة *</label>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="مثال: عامل خياطة - مكن أوفر"
                className={inputClass}
                autoFocus
              />
            </div>
            <div>
              <label className={labelClass}>القسم / مكان العمل *</label>
              <select
                value={department}
                onChange={(event) => setDepartment(event.target.value as HRDepartmentKey)}
                className={inputClass}
              >
                {HR_DEPARTMENTS.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
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
                {isSaving ? 'جاري الحفظ...' : 'حفظ الوظيفة'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          title="تأكيد حذف الوظيفة"
          subtitle="لا يمكن التراجع عن هذه العملية"
          onClose={() => {
            setDeleteTarget(null);
            setDeleteError('');
          }}
          maxWidthClass="max-w-md"
        >
          <div className="space-y-3">
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-bold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                سيتم حذف وظيفة <strong>{deleteTarget.title}</strong>. لا يمكن حذف وظيفة مرتبط بها
                موظفون، يجب نقلهم إلى وظيفة أخرى أولاً.
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
                {isDeleting ? 'جاري الحذف...' : 'حذف الوظيفة'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

