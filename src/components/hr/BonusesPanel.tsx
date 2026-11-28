import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award,
  Gift,
  Plus,
  Pencil,
  Trash2,
  Save,
  CalendarDays,
  Users,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../api/client';
import {
  HREmployee,
  HRBonusPlan,
  HRBonusCategory,
  HRBonusValueType,
  HRDirectBonus
} from '../../types';
import {
  inputClass,
  labelClass,
  formatMoney,
  Modal,
  ErrorNote,
  todayISO,
  currentMonth,
  BONUS_CATEGORY_LABELS,
  BONUS_VALUE_TYPE_LABELS
} from './hrShared';

export const BonusesPanel: React.FC<{ employees: HREmployee[] }> = ({ employees }) => {
  const { addFlashMessage, logAction } = useApp();

  const [subTab, setSubTab] = useState<'direct' | 'plans'>('direct');
  const [month, setMonth] = useState(currentMonth());
  const [employeeFilter, setEmployeeFilter] = useState('');

  // المكافآت الفورية
  const [directBonuses, setDirectBonuses] = useState<HRDirectBonus[]>([]);
  const [isLoadingDirect, setIsLoadingDirect] = useState(true);
  const [isDirectModalOpen, setIsDirectModalOpen] = useState(false);
  const [editingDirect, setEditingDirect] = useState<HRDirectBonus | null>(null);
  const [directForm, setDirectForm] = useState({
    employee_id: '',
    date: todayISO(),
    amount: '',
    reason: ''
  });
  const [directError, setDirectError] = useState('');
  const [isSavingDirect, setIsSavingDirect] = useState(false);

  // أنظمة المكافآت الدورية
  const [plans, setPlans] = useState<HRBonusPlan[]>([]);
  const [isLoadingPlans, setIsLoadingPlans] = useState(true);
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<HRBonusPlan | null>(null);
  const [planForm, setPlanForm] = useState({
    name: '',
    category: 'attendance' as HRBonusCategory,
    value_type: 'fixed' as HRBonusValueType,
    value: '',
    requires_full_month: true,
    affected_by_absence: true,
    absence_deduction_percent: '100',
    affected_by_late: true,
    late_deduction_percent: '100',
    is_active: true,
    notes: ''
  });
  const [planError, setPlanError] = useState('');
  const [isSavingPlan, setIsSavingPlan] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoadingDirect(true);
    setIsLoadingPlans(true);
    try {
      const [directRes, plansRes] = await Promise.all([
        api.getHRDirectBonuses(month).catch(() => []),
        api.getHRBonusPlans().catch(() => [])
      ]);
      setDirectBonuses(Array.isArray(directRes) ? directRes : []);
      setPlans(Array.isArray(plansRes) ? plansRes : []);
    } catch (err: any) {
      addFlashMessage(err?.message || 'فشل تحميل بيانات المكافآت', 'danger');
    } finally {
      setIsLoadingDirect(false);
      setIsLoadingPlans(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredDirect = useMemo(() => {
    return directBonuses.filter((item) => {
      if (employeeFilter && item.employee_id !== employeeFilter) return false;
      return true;
    });
  }, [directBonuses, employeeFilter]);

  const directTotal = useMemo(
    () => filteredDirect.reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
    [filteredDirect]
  );

  // --- CRUD المكافآت الفورية ---
  const openCreateDirect = () => {
    setEditingDirect(null);
    setDirectForm({
      employee_id: employees[0]?.id || '',
      date: todayISO(),
      amount: '',
      reason: ''
    });
    setDirectError('');
    setIsDirectModalOpen(true);
  };

  const openEditDirect = (item: HRDirectBonus) => {
    setEditingDirect(item);
    setDirectForm({
      employee_id: item.employee_id,
      date: item.date || todayISO(),
      amount: String(item.amount ?? ''),
      reason: item.reason || ''
    });
    setDirectError('');
    setIsDirectModalOpen(true);
  };

  const saveDirect = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!directForm.employee_id) {
      setDirectError('يرجى اختيار الموظف');
      return;
    }
    const amt = Number(directForm.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setDirectError('قيمة المكافأة يجب أن تكون أكبر من صفر');
      return;
    }
    setIsSavingDirect(true);
    setDirectError('');
    try {
      const payload = {
        employee_id: directForm.employee_id,
        date: directForm.date,
        amount: amt,
        reason: directForm.reason.trim()
      };
      if (editingDirect) {
        await api.updateHRDirectBonus(editingDirect.id, payload);
        addFlashMessage('تم تعديل المكافأة الفورية بنجاح');
        logAction('الموارد البشرية', `تعديل مكافأة فورية بقيمة ${amt}`);
      } else {
        await api.createHRDirectBonus(payload);
        addFlashMessage('تم إضافة المكافأة الفورية بنجاح');
        logAction('الموارد البشرية', `صرف مكافأة فورية بقيمة ${amt}`);
      }
      setIsDirectModalOpen(false);
      await loadData();
    } catch (err: any) {
      setDirectError(err?.message || 'فشل حفظ المكافأة');
    } finally {
      setIsSavingDirect(false);
    }
  };

  const deleteDirect = async (item: HRDirectBonus) => {
    try {
      await api.deleteHRDirectBonus(item.id);
      addFlashMessage('تم حذف المكافأة الفورية بنجاح');
      await loadData();
    } catch (err: any) {
      addFlashMessage(err?.message || 'فشل حذف المكافأة', 'danger');
    }
  };

  // --- CRUD أنظمة المكافآت الدورية ---
  const openCreatePlan = () => {
    setEditingPlan(null);
    setPlanForm({
      name: '',
      category: 'attendance',
      value_type: 'fixed',
      value: '',
      requires_full_month: true,
      affected_by_absence: true,
      absence_deduction_percent: '100',
      affected_by_late: true,
      late_deduction_percent: '100',
      is_active: true,
      notes: ''
    });
    setPlanError('');
    setIsPlanModalOpen(true);
  };

  const openEditPlan = (plan: HRBonusPlan) => {
    setEditingPlan(plan);
    setPlanForm({
      name: plan.name || '',
      category: plan.category || 'attendance',
      value_type: plan.value_type || 'fixed',
      value: String(plan.value ?? ''),
      requires_full_month: plan.requires_full_month !== false,
      affected_by_absence: plan.affected_by_absence !== false,
      absence_deduction_percent: String(plan.absence_deduction_percent ?? 100),
      affected_by_late: plan.affected_by_late !== false,
      late_deduction_percent: String(plan.late_deduction_percent ?? 100),
      is_active: plan.is_active !== false,
      notes: plan.notes || ''
    });
    setPlanError('');
    setIsPlanModalOpen(true);
  };

  const savePlan = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!planForm.name.trim()) {
      setPlanError('اسم نظام المكافأة مطلوب');
      return;
    }
    const val = Number(planForm.value);
    if (!Number.isFinite(val) || val <= 0) {
      setPlanError('قيمة المكافأة يجب أن تكون أكبر من صفر');
      return;
    }
    setIsSavingPlan(true);
    setPlanError('');
    try {
      const payload = {
        name: planForm.name.trim(),
        category: planForm.category,
        value_type: planForm.value_type,
        value: val,
        requires_full_month: planForm.requires_full_month,
        affected_by_absence: planForm.affected_by_absence,
        absence_deduction_percent: Number(planForm.absence_deduction_percent) || 0,
        affected_by_late: planForm.affected_by_late,
        late_deduction_percent: Number(planForm.late_deduction_percent) || 0,
        is_active: planForm.is_active,
        notes: planForm.notes.trim()
      };
      if (editingPlan) {
        await api.updateHRBonusPlan(editingPlan.id, payload);
        addFlashMessage('تم تحديث نظام المكافأة الدورية بنجاح');
        logAction('الموارد البشرية', `تعديل نظام مكافأة دورية: ${payload.name}`);
      } else {
        await api.createHRBonusPlan(payload);
        addFlashMessage('تم إنشاء نظام المكافأة الدورية بنجاح');
        logAction('الموارد البشرية', `إنشاء نظام مكافأة دورية: ${payload.name}`);
      }
      setIsPlanModalOpen(false);
      await loadData();
    } catch (err: any) {
      setPlanError(err?.message || 'فشل حفظ نظام المكافأة');
    } finally {
      setIsSavingPlan(false);
    }
  };

  const deletePlan = async (plan: HRBonusPlan) => {
    try {
      await api.deleteHRBonusPlan(plan.id);
      addFlashMessage('تم حذف نظام المكافأة الدورية بنجاح');
      await loadData();
    } catch (err: any) {
      addFlashMessage(err?.message || 'فشل حذف نظام المكافأة', 'danger');
    }
  };

  return (
    <div className="space-y-4">
      {/* شريط التبديل بين المكافآت الفورية والمكافآت الدورية */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab('direct')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer ${
              subTab === 'direct'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Gift className="w-4 h-4" />
            المكافآت الفورية ({directBonuses.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('plans')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer ${
              subTab === 'plans'
                ? 'bg-purple-600 text-white shadow-xs'
                : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Award className="w-4 h-4" />
            أنظمة المكافآت الدورية ({plans.length})
          </button>
        </div>

        {subTab === 'direct' ? (
          <button
            type="button"
            onClick={openCreateDirect}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            صرف مكافأة فورية
          </button>
        ) : (
          <button
            type="button"
            onClick={openCreatePlan}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-black transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            إنشاء نظام مكافأة دورية
          </button>
        )}
      </div>

      {/* قسم المكافآت الفورية */}
      {subTab === 'direct' && (
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className={labelClass}>الشهر</label>
                <div className="relative">
                  <CalendarDays className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="month"
                    value={month}
                    onChange={(event) => setMonth(event.target.value)}
                    className={`${inputClass} pr-8 font-mono`}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>فلترة بالموظف</label>
                <select
                  value={employeeFilter}
                  onChange={(event) => setEmployeeFilter(event.target.value)}
                  className={inputClass}
                >
                  <option value="">كل الموظفين</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.employee_code})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="px-4 py-2 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800">
              <div className="text-[10px] font-bold">إجمالي المكافآت الفورية في الشهر</div>
              <div className="text-sm font-black font-mono">{formatMoney(directTotal)}</div>
            </div>
          </div>

          {isLoadingDirect ? (
            <div className="p-10 text-center text-xs font-bold text-slate-400">جاري التحميل...</div>
          ) : filteredDirect.length === 0 ? (
            <div className="p-10 text-center text-xs font-bold text-slate-400">
              لا توجد مكافآت فورية مسجلة في هذا الشهر.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-black text-slate-600">
                  <tr>
                    <th className="px-4 py-3">التاريخ</th>
                    <th className="px-4 py-3">الموظف</th>
                    <th className="px-4 py-3">المبلغ</th>
                    <th className="px-4 py-3">السبب / البيان</th>
                    <th className="px-4 py-3 text-center">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredDirect.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-mono font-bold text-slate-600">{item.date}</td>
                      <td className="px-4 py-3">
                        <div className="font-black text-slate-800">{item.employee_name || '—'}</div>
                        <div className="text-[10px] font-mono text-slate-400">{item.employee_code || ''}</div>
                      </td>
                      <td className="px-4 py-3 font-mono font-black text-emerald-700">
                        {formatMoney(item.amount)}
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-600">{item.reason || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditDirect(item)}
                            className="p-1.5 rounded-lg text-slate-500 hover:bg-purple-50 hover:text-purple-600 transition cursor-pointer"
                            title="تعديل"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteDirect(item)}
                            className="p-1.5 rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
                            title="حذف"
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
        </div>
      )}

      {/* قسم أنظمة المكافآت الدورية */}
      {subTab === 'plans' && (
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <h3 className="text-sm font-black text-slate-900">أنظمة المكافآت الدورية</h3>
            <p className="text-[11px] font-bold text-slate-500 mt-0.5">
              يمكنك إنشاء أكثر من نظام مكافأة دورية، ثم ضم الموظفين إلى نظام واحد أو أكثر من شاشة «قائمة الموظفين».
            </p>
          </div>

          {isLoadingPlans ? (
            <div className="p-10 text-center text-xs font-bold text-slate-400">جاري التحميل...</div>
          ) : plans.length === 0 ? (
            <div className="p-10 text-center text-xs font-bold text-slate-400">
              لا توجد أنظمة مكافآت دورية بعد — اضغط «إنشاء نظام مكافأة دورية» للبدء.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {plans.map((plan) => (
                <div key={plan.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-slate-50/50">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-black text-slate-900">{plan.name}</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-purple-50 text-purple-700 border border-purple-200">
                        {BONUS_CATEGORY_LABELS[plan.category] || plan.category}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black font-mono bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {plan.value_type === 'percent' ? `${plan.value}% من المرتب` : formatMoney(plan.value)}
                      </span>
                      {plan.is_active ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">
                          <CheckCircle2 className="w-3 h-3" /> نشط
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500">
                          <XCircle className="w-3 h-3" /> متوقف
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-[11px] font-bold text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <Users className="w-3.5 h-3.5 text-purple-500" />
                        الموظفون المشتركون: <strong className="font-mono text-slate-800">{plan.employees_count ?? 0}</strong>
                      </span>
                      <span>
                        • اكتمال الشهر: <strong>{plan.requires_full_month ? 'مطلوب' : 'غير مطلوب'}</strong>
                      </span>
                      <span>
                        • الغياب: <strong>{plan.affected_by_absence ? `خصم ${plan.absence_deduction_percent}% لكل يوم` : 'لا يتأثر'}</strong>
                      </span>
                      <span>
                        • التأخير: <strong>{plan.affected_by_late ? `خصم ${plan.late_deduction_percent}% لكل مرة` : 'لا يتأثر'}</strong>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditPlan(plan)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-purple-50 text-slate-700 hover:text-purple-700 border border-slate-200 text-[11px] font-black transition cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      تعديل
                    </button>
                    <button
                      type="button"
                      onClick={() => void deletePlan(plan)}
                      className="p-1.5 rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
                      title="حذف"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* نافذة إضافة/تعديل مكافأة فورية */}
      {isDirectModalOpen && (
        <Modal
          title={editingDirect ? 'تعديل مكافأة فورية' : 'صرف مكافأة فورية لموظف'}
          onClose={() => setIsDirectModalOpen(false)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setIsDirectModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs font-black text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                form="hr-direct-bonus-form"
                disabled={isSavingDirect}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black cursor-pointer disabled:opacity-60"
              >
                <Save className="w-3.5 h-3.5" />
                {isSavingDirect ? 'جاري الحفظ...' : 'حفظ'}
              </button>
            </>
          }
        >
          <form id="hr-direct-bonus-form" onSubmit={saveDirect} className="space-y-3">
            <ErrorNote message={directError} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>الموظف</label>
                <select
                  value={directForm.employee_id}
                  onChange={(e) => setDirectForm((prev) => ({ ...prev, employee_id: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">اختر الموظف...</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.employee_code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>التاريخ</label>
                <input
                  type="date"
                  value={directForm.date}
                  onChange={(e) => setDirectForm((prev) => ({ ...prev, date: e.target.value }))}
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className={labelClass}>المبلغ (ج.م)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={directForm.amount}
                  onChange={(e) => setDirectForm((prev) => ({ ...prev, amount: e.target.value }))}
                  placeholder="مثال: 200"
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className={labelClass}>السبب / البيان</label>
                <input
                  value={directForm.reason}
                  onChange={(e) => setDirectForm((prev) => ({ ...prev, reason: e.target.value }))}
                  placeholder="مثال: مكافأة إنتاج / تشجيعية"
                  className={inputClass}
                />
              </div>
            </div>
          </form>
        </Modal>
      )}

      {/* نافذة إنشاء/تعديل نظام مكافأة دورية */}
      {isPlanModalOpen && (
        <Modal
          title={editingPlan ? 'تعديل نظام مكافأة دورية' : 'إنشاء نظام مكافأة دورية جديد'}
          onClose={() => setIsPlanModalOpen(false)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setIsPlanModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs font-black text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                form="hr-bonus-plan-form"
                disabled={isSavingPlan}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-black cursor-pointer disabled:opacity-60"
              >
                <Save className="w-3.5 h-3.5" />
                {isSavingPlan ? 'جاري الحفظ...' : 'حفظ النظام'}
              </button>
            </>
          }
        >
          <form id="hr-bonus-plan-form" onSubmit={savePlan} className="space-y-3">
            <ErrorNote message={planError} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>اسم نظام المكافأة</label>
                <input
                  value={planForm.name}
                  onChange={(e) => setPlanForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="مثال: حافز انتظام شهري"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>الفئة / السبب</label>
                <select
                  value={planForm.category}
                  onChange={(e) => setPlanForm((prev) => ({ ...prev, category: e.target.value as HRBonusCategory }))}
                  className={inputClass}
                >
                  {Object.entries(BONUS_CATEGORY_LABELS).map(([k, lbl]) => (
                    <option key={k} value={k}>
                      {lbl}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>نوع القيمة</label>
                <select
                  value={planForm.value_type}
                  onChange={(e) => setPlanForm((prev) => ({ ...prev, value_type: e.target.value as HRBonusValueType }))}
                  className={inputClass}
                >
                  {Object.entries(BONUS_VALUE_TYPE_LABELS).map(([k, lbl]) => (
                    <option key={k} value={k}>
                      {lbl}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>
                  القيمة ({planForm.value_type === 'percent' ? '%' : 'ج.م'})
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={planForm.value}
                  onChange={(e) => setPlanForm((prev) => ({ ...prev, value: e.target.value }))}
                  placeholder={planForm.value_type === 'percent' ? 'مثال: 10' : 'مثال: 300'}
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
              <div className="space-y-2">
                <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={planForm.affected_by_absence}
                    onChange={(e) => setPlanForm((prev) => ({ ...prev, affected_by_absence: e.target.checked }))}
                    className="rounded border-slate-300 text-purple-600"
                  />
                  تتأثر بالغياب
                </label>
                {planForm.affected_by_absence && (
                  <div>
                    <label className={labelClass}>نسبة الخصم لكل يوم غياب (%)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={planForm.absence_deduction_percent}
                      onChange={(e) => setPlanForm((prev) => ({ ...prev, absence_deduction_percent: e.target.value }))}
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={planForm.affected_by_late}
                    onChange={(e) => setPlanForm((prev) => ({ ...prev, affected_by_late: e.target.checked }))}
                    className="rounded border-slate-300 text-purple-600"
                  />
                  تتأثر بالتأخير المخصوم
                </label>
                {planForm.affected_by_late && (
                  <div>
                    <label className={labelClass}>نسبة الخصم لكل مرة تأخير مخصومة (%)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={planForm.late_deduction_percent}
                      onChange={(e) => setPlanForm((prev) => ({ ...prev, late_deduction_percent: e.target.value }))}
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-slate-100">
              <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={planForm.requires_full_month}
                  onChange={(e) => setPlanForm((prev) => ({ ...prev, requires_full_month: e.target.checked }))}
                  className="rounded border-slate-300 text-purple-600"
                />
                يشترط اكتمال الشهر (لا يُصرف للمعيّن أو التارك في منتصف الشهر)
              </label>
              <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={planForm.is_active}
                  onChange={(e) => setPlanForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                  className="rounded border-slate-300 text-emerald-600"
                />
                النظام نشط
              </label>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
