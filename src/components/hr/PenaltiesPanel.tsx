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

export const PenaltiesPanel: React.FC<{ employees: HREmployee[] }> = ({ employees }) => {
  const { addFlashMessage, logAction } = useApp();

  const [penalties, setPenalties] = useState<HRPenalty[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [month, setMonth] = useState(currentMonth());
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [historyEmployeeId, setHistoryEmployeeId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<HRPenalty | null>(null);
  const [form, setForm] = useState({
    employee_id: '',
    date: todayISO(),
    penalty_type: 'days' as HRPenaltyType,
    value: '',
    reason: ''
  });
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<HRPenalty | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const loadPenalties = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getHRPenalties();
      setPenalties(Array.isArray(res) ? res : []);
    } catch (err: any) {
      addFlashMessage(err?.message || 'فشل تحميل الجزاءات من السيرفر', 'danger');
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadPenalties();
  }, [loadPenalties]);

  const filteredPenalties = useMemo(() => {
    const query = search.trim().toLowerCase();
    return penalties.filter((penalty) => {
      if (month && !(penalty.date || '').startsWith(month)) return false;
      if (employeeFilter && penalty.employee_id !== employeeFilter) return false;
      if (query) {
        const employee = employees.find((item) => item.id === penalty.employee_id);
        const haystack = `${penalty.employee_name || employee?.name || ''} ${
          penalty.employee_code || employee?.employee_code || ''
        } ${penalty.reason || ''}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [penalties, month, employeeFilter, search, employees]);

  // سجل جزاءات الموظف مجمّعاً حسب الشهور
  const historyEmployee = useMemo(
    () => employees.find((item) => item.id === historyEmployeeId) || null,
    [employees, historyEmployeeId]
  );

  const historyPenalties = useMemo(() => {
    if (!historyEmployeeId) return [];
    return penalties
      .filter((penalty) => penalty.employee_id === historyEmployeeId)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [penalties, historyEmployeeId]);

  const historyByMonth = useMemo(() => {
    const map = new Map<string, HRPenalty[]>();
    historyPenalties.forEach((penalty) => {
      const key = (penalty.date || '').slice(0, 7) || 'غير محدد';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(penalty);
    });
    return Array.from(map.entries());
  }, [historyPenalties]);

  const summary = useMemo(() => {
    let days = 0;
    let hours = 0;
    filteredPenalties.forEach((penalty) => {
      if (penalty.penalty_type === 'days') days += Number(penalty.value) || 0;
      else hours += Number(penalty.value) || 0;
    });
    return { days, hours };
  }, [filteredPenalties]);

  const updateForm = (patch: Partial<typeof form>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  const openCreate = () => {
    setEditing(null);
    setForm({
      employee_id: employees[0]?.id || '',
      date: todayISO(),
      penalty_type: 'days',
      value: '',
      reason: ''
    });
    setFormError('');
    setIsFormOpen(true);
  };

  const openEdit = (penalty: HRPenalty) => {
    setEditing(penalty);
    setForm({
      employee_id: penalty.employee_id,
      date: penalty.date || todayISO(),
      penalty_type: penalty.penalty_type || 'days',
      value: String(penalty.value ?? ''),
      reason: penalty.reason || ''
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
      setFormError('تاريخ الجزاء مطلوب');
      return;
    }
    const value = Number(form.value);
    if (!Number.isFinite(value) || value <= 0) {
      setFormError('قيمة الجزاء يجب أن تكون أكبر من صفر');
      return;
    }
    const maxAllowed = form.penalty_type === 'days' ? 3 : 8;
    if (value > maxAllowed) {
      setFormError(
        form.penalty_type === 'days'
          ? 'الحد الأقصى لمقدار الجزاء ٣ أيام'
          : 'الحد الأقصى لمقدار الجزاء ٨ ساعات'
      );
      return;
    }

    setIsSaving(true);
    setFormError('');
    const payload: any = {
      employee_id: form.employee_id,
      date: form.date,
      penalty_type: form.penalty_type,
      value,
      reason: form.reason.trim()
    };

    try {
      if (editing) {
        await api.updateHRPenalty(editing.id, payload);
        addFlashMessage('تم تعديل الجزاء بنجاح');
        logAction('الموارد البشرية', `تعديل جزاء بقيمة ${value} بتاريخ ${form.date}`);
      } else {
        await api.createHRPenalty(payload);
        addFlashMessage('تم إضافة الجزاء بنجاح');
        logAction('الموارد البشرية', `إضافة جزاء بقيمة ${value} بتاريخ ${form.date}`);
      }
      closeForm();
      await loadPenalties();
    } catch (err: any) {
      setFormError(err?.message || 'فشل حفظ الجزاء');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError('');
    try {
      await api.deleteHRPenalty(deleteTarget.id);
      addFlashMessage('تم حذف الجزاء بنجاح');
      logAction('الموارد البشرية', `حذف جزاء بتاريخ ${deleteTarget.date}`);
      setDeleteTarget(null);
      await loadPenalties();
    } catch (err: any) {
      setDeleteError(err?.message || 'فشل حذف الجزاء');
    } finally {
      setIsDeleting(false);
    }
  };

  // خيارات ثابتة لمقدار الجزاء (الحد الأقصى ٣ أيام أو ٨ ساعات)
  const penaltyPresets =
    form.penalty_type === 'days'
      ? [
          { value: '0.25', label: 'ربع يوم' },
          { value: '0.5', label: 'نصف يوم' },
          { value: '1', label: 'يوم' },
          { value: '2', label: 'يومان' },
          { value: '3', label: '٣ أيام' }
        ]
      : [
          { value: '1', label: 'ساعة' },
          { value: '2', label: 'ساعتان' },
          { value: '3', label: '٣ ساعات' },
          { value: '4', label: '٤ ساعات' }
        ];

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-slate-900">الجزاءات والخصومات الإدارية</h2>
          <p className="text-[11px] font-bold text-slate-500 mt-0.5">
            جزاءات مسجلة يدوياً من الإدارة (أيام أو ساعات) وتُخصم في مسير مرتبات نفس الشهر.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white text-[11px] font-black hover:bg-purple-700 transition cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          تطبيق جزاء
        </button>
      </div>

      <div className="p-4 bg-slate-50/60 border-b border-slate-100 grid grid-cols-1 md:grid-cols-3 gap-2">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="بحث بالاسم أو الكود أو السبب"
          className={inputClass}
        />
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
          <Scale className="w-3.5 h-3.5 text-purple-600" />
          عدد الجزاءات: {filteredPenalties.length}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] font-black text-rose-700">
          <CalendarDays className="w-3.5 h-3.5" />
          إجمالي الأيام: {summary.days}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] font-black text-amber-700">
          <Timer className="w-3.5 h-3.5" />
          إجمالي الساعات: {summary.hours}
        </span>
      </div>

      {isLoading ? (
        <div className="p-10 text-center text-xs font-bold text-slate-400">جاري التحميل...</div>
      ) : filteredPenalties.length === 0 ? (
        <div className="p-10 text-center">
          <Scale className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="text-xs font-black text-slate-700">لا توجد جزاءات مسجلة لهذا الشهر</p>
          <p className="text-[11px] font-bold text-slate-500 mt-1">
            الخصومات التلقائية للتأخير والغياب تُحسب من سجل الحضور، أما هذا القسم فللجزاءات اليدوية.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-right px-4 py-2.5 font-black whitespace-nowrap">التاريخ</th>
                <th className="text-right px-4 py-2.5 font-black whitespace-nowrap">الموظف</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">النوع</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">القيمة</th>
                <th className="text-right px-4 py-2.5 font-black whitespace-nowrap">السبب</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPenalties.map((penalty) => {
                const employee = employees.find((item) => item.id === penalty.employee_id);
                return (
                  <tr key={penalty.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-mono font-bold text-slate-700 whitespace-nowrap">
                      {penalty.date}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="font-black text-slate-900">
                        {penalty.employee_name || employee?.name || '-'}
                      </p>
                      <p className="font-bold text-[10px] text-slate-400 font-mono">
                        {penalty.employee_code || employee?.employee_code || '-'}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black border ${
                          penalty.penalty_type === 'days'
                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}
                      >
                        {PENALTY_TYPE_LABELS[penalty.penalty_type] || penalty.penalty_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-black text-rose-600 whitespace-nowrap">
                      {Number(penalty.value) || 0}
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-600 max-w-[260px] truncate">
                      {penalty.reason || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => setHistoryEmployeeId(penalty.employee_id)}
                          title="سجل الجزاءات"
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 transition cursor-pointer"
                        >
                          <History className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(penalty)}
                          title="تعديل"
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-purple-50 hover:text-purple-600 transition cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError('');
                            setDeleteTarget(penalty);
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
          title={editing ? 'تعديل جزاء' : 'إضافة جزاء جديد'}
          subtitle="الجزاء يُخصم من مرتب نفس الشهر بإضافة إلى خصومات الحضور"
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
                <label className={labelClass}>تاريخ الجزاء *</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(event) => updateForm({ date: event.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>نوع الجزاء</label>
                <select
                  value={form.penalty_type}
                  onChange={(event) =>
                    updateForm({ penalty_type: event.target.value as HRPenaltyType })
                  }
                  className={inputClass}
                >
                  <option value="days">{PENALTY_TYPE_LABELS.days}</option>
                  <option value="hours">{PENALTY_TYPE_LABELS.hours}</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>
                  القيمة {form.penalty_type === 'days' ? '(أيام)' : '(ساعات)'} *
                </label>
                <input
                  type="number"
                  min="0"
                  max={form.penalty_type === 'days' ? 3 : 8}
                  step="0.25"
                  value={form.value}
                  onChange={(event) => updateForm({ value: event.target.value })}
                  placeholder="0"
                  className={`${inputClass} font-mono`}
                />
                <div className="flex flex-wrap gap-1 mt-2">
                  {penaltyPresets.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => updateForm({ value: preset.value })}
                      className={`px-2 py-1 rounded-lg text-[10px] font-black border transition cursor-pointer ${
                        form.value === preset.value
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className={labelClass}>سبب الجزاء</label>
              <textarea
                value={form.reason}
                onChange={(event) => updateForm({ reason: event.target.value })}
                rows={2}
                className={inputClass}
                placeholder="مثال: مخالفة تعليمات السلامة المهنية"
              />
            </div>

            <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-[11px] font-bold">
              <Info className="w-4 h-4 shrink-0" />
              <span>
                يُحسب الجزاء كالتالي: (الأيام × المرتب ÷ 30) + (الساعات × المرتب ÷ 30 ÷ 8)، ويُخصم
                في مسير مرتبات نفس الشهر.
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
                {isSaving ? 'جاري الحفظ...' : 'حفظ الجزاء'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          title="تأكيد حذف الجزاء"
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
                سيتم حذف جزاء بقيمة{' '}
                <strong className="font-mono">{Number(deleteTarget.value) || 0}</strong>{' '}
                {PENALTY_TYPE_LABELS[deleteTarget.penalty_type] || ''} بتاريخ{' '}
                <strong className="font-mono">{deleteTarget.date}</strong> للموظف{' '}
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
                {isDeleting ? 'جاري الحذف...' : 'حذف الجزاء'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {historyEmployeeId && (
        <Modal
          title={`سجل جزاءات ${historyEmployee?.name || ''}`}
          subtitle="جميع الجزاءات المسجلة للموظف مجمّعة حسب الشهور"
          onClose={() => setHistoryEmployeeId(null)}
          maxWidthClass="max-w-3xl"
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-black text-slate-700">
                <Scale className="w-3.5 h-3.5 text-purple-600" />
                إجمالي الجزاءات: {historyPenalties.length}
              </span>
              <button
                type="button"
                onClick={() => {
                  const employeeId = historyEmployeeId;
                  setHistoryEmployeeId(null);
                  setEditing(null);
                  setForm({
                    employee_id: employeeId,
                    date: todayISO(),
                    penalty_type: 'days',
                    value: '',
                    reason: ''
                  });
                  setFormError('');
                  setIsFormOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600 text-white text-[11px] font-black hover:bg-purple-700 transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                تطبيق جزاء
              </button>
            </div>

            {historyByMonth.length === 0 ? (
              <div className="p-8 text-center">
                <Scale className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                <p className="text-xs font-black text-slate-700">لا توجد جزاءات مسجلة لهذا الموظف</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                {historyByMonth.map(([monthKey, items]) => {
                  const daysTotal = items
                    .filter((item) => item.penalty_type === 'days')
                    .reduce((sum, item) => sum + (Number(item.value) || 0), 0);
                  const hoursTotal = items
                    .filter((item) => item.penalty_type === 'hours')
                    .reduce((sum, item) => sum + (Number(item.value) || 0), 0);
                  return (
                    <div key={monthKey} className="rounded-2xl border border-slate-200 overflow-hidden">
                      <div className="px-3 py-2 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] font-black text-slate-800 font-mono">{monthKey}</p>
                        <p className="text-[10px] font-black text-slate-500">
                          {items.length} جزاء — {daysTotal} يوم — {hoursTotal} ساعة
                        </p>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-white text-slate-400">
                            <tr>
                              <th className="text-right px-3 py-2 font-black">التاريخ</th>
                              <th className="text-center px-3 py-2 font-black">النوع</th>
                              <th className="text-center px-3 py-2 font-black">القيمة</th>
                              <th className="text-right px-3 py-2 font-black">السبب</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {items.map((penalty) => (
                              <tr key={penalty.id}>
                                <td className="px-3 py-2 font-mono font-bold text-slate-600">
                                  {penalty.date}
                                </td>
                                <td className="px-3 py-2 text-center font-bold text-slate-600">
                                  {PENALTY_TYPE_LABELS[penalty.penalty_type] || penalty.penalty_type}
                                </td>
                                <td className="px-3 py-2 text-center font-mono font-black text-rose-600">
                                  {Number(penalty.value) || 0}
                                </td>
                                <td className="px-3 py-2 font-bold text-slate-600">
                                  {penalty.reason || '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};


