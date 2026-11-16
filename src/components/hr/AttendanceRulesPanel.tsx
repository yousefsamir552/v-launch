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

export const AttendanceRulesPanel: React.FC<{
  settings: HRAttendanceSettings | null;
  isLoading: boolean;
  onRefresh: () => void | Promise<void>;
}> = ({ settings, isLoading, onRefresh }) => {
  const { addFlashMessage, logAction } = useApp();

  const [startTime, setStartTime] = useState('08:30');
  const [endTime, setEndTime] = useState('17:30');
  const [weeklyOff, setWeeklyOff] = useState<HRWeekDayKey>('Sunday');
  const [rules, setRules] = useState<HRAttendanceRule[]>([]);
  const [overtimeRules, setOvertimeRules] = useState<HROvertimeRule[]>([]);
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isReapplying, setIsReapplying] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setStartTime(settings.official_start_time || '08:30');
    setEndTime(settings.official_end_time || '17:30');
    setWeeklyOff(settings.weekly_off_day || 'Sunday');
    setRules(Array.isArray(settings.rules_json) ? settings.rules_json : []);
    setOvertimeRules(Array.isArray(settings.overtime_rules) ? settings.overtime_rules : []);
  }, [settings]);

  const updateRule = (index: number, patch: Partial<HRAttendanceRule>) => {
    setRules((prev) => prev.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  };

  const addRule = () => {
    setRules((prev) => [
      ...prev,
      {
        id: `hr-rule-${Date.now()}`,
        violation_type: 'late_arrival',
        label: 'قاعدة تأخير جديدة',
        from_minutes: 0,
        to_minutes: 15,
        until_time: '',
        deduction_type: 'days',
        deduction_value: 0.25,
        apply_mode: 'manual_review'
      }
    ]);
  };

  const removeRule = (index: number) => {
    setRules((prev) => prev.filter((_, i) => i !== index));
  };

  const addOvertimeRule = () => {
    setOvertimeRules((prev) => [
      ...prev,
      {
        id: `hr-ot-${Date.now()}`,
        label: 'ميعاد إضافي جديد',
        from_time: '17:30',
        to_time: '20:00',
        reward_type: 'hours',
        reward_value: 1
      }
    ]);
  };

  const updateOvertimeRule = (index: number, patch: Partial<HROvertimeRule>) => {
    setOvertimeRules((prev) =>
      prev.map((rule, i) => (i === index ? { ...rule, ...patch } : rule))
    );
  };

  const removeOvertimeRule = (index: number) => {
    setOvertimeRules((prev) => prev.filter((_, i) => i !== index));
  };

  const handleReapply = async () => {
    if (!settings) {
      setFormError('يرجى حفظ إعدادات الحضور أولاً');
      return;
    }
    setIsReapplying(true);
    setFormError('');
    try {
      const result = await api.reapplyHRAttendanceRules();
      addFlashMessage(
        `تم إعادة تطبيق القواعد على ${Number(result?.updated ?? 0)} سجل في شهر ${result?.month || ''}`,
        'success'
      );
      logAction('الموارد البشرية', 'إعادة تطبيق قواعد الحضور على سجلات الشهر');
      await onRefresh();
    } catch (err: any) {
      setFormError(err?.message || 'فشل إعادة تطبيق قواعد الحضور');
    } finally {
      setIsReapplying(false);
    }
  };

  const handleSave = async () => {
    if (!startTime || !endTime) {
      setFormError('يرجى تحديد مواعيد الحضور والانصراف الرسمية');
      return;
    }
    if (startTime >= endTime) {
      setFormError('موعد الحضور الرسمي يجب أن يسبق موعد الانصراف الرسمي');
      return;
    }
    if (rules.some((rule) => !Number(rule.deduction_value) || Number(rule.deduction_value) <= 0)) {
      setFormError('قيمة الخصم في كل قاعدة يجب أن تكون أكبر من صفر');
      return;
    }
    if (
      overtimeRules.some(
        (rule) =>
          !Number(rule.reward_value) ||
          Number(rule.reward_value) <= 0 ||
          !rule.from_time ||
          !rule.to_time
      )
    ) {
      setFormError('كل قاعدة إضافي يجب أن تحدد من/إلى الساعة وقيمة أكبر من صفر');
      return;
    }

    setIsSaving(true);
    setFormError('');
    // تغيير يوم الإجازة الأسبوعية يغيّر احتساب السجلات المسجّلة، لذا نعيد تطبيق القواعد تلقائياً.
    const weeklyOffChanged = !!settings && weeklyOff !== settings.weekly_off_day;
    try {
      await api.updateHRAttendanceSettings({
        official_start_time: startTime,
        official_end_time: endTime,
        weekly_off_day: weeklyOff,
        month_calculation_days: 30,
        rules_json: rules.map((rule) => ({
          ...rule,
          from_minutes: Number(rule.from_minutes) || 0,
          to_minutes: Number(rule.to_minutes) || 0,
          deduction_value: Number(rule.deduction_value) || 0
        })),
        overtime_rules: overtimeRules.map((rule) => ({
          ...rule,
          reward_value: Number(rule.reward_value) || 0
        }))
      });
      addFlashMessage('تم حفظ قواعد الحضور والانصراف بنجاح');
      if (weeklyOffChanged) {
        const reapplyResult = await api.reapplyHRAttendanceRules().catch(() => null);
        const offLabel = HR_WEEK_DAYS.find((day) => day.key === weeklyOff)?.label || weeklyOff;
        addFlashMessage(
          `تم إعادة احتساب ${Number(reapplyResult?.updated ?? 0)} سجل حضور على أساس إجازة أسبوعية يوم ${offLabel}`,
          'info'
        );
      }
      logAction('الموارد البشرية', 'تحديث قواعد الحضور والانصراف العامة');
      await onRefresh();
    } catch (err: any) {
      setFormError(err?.message || 'فشل حفظ قواعد الحضور والانصراف');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-black text-slate-900">المواعيد الرسمية للعمل</h2>
            <p className="text-[11px] font-bold text-slate-500 mt-0.5">
              تُطبق هذه المواعيد على كل الموظفين ما لم يتم استثناؤهم بقواعد خاصة داخل سجل الحضور.
            </p>
          </div>
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>موعد الحضور الرسمي</label>
            <input
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              className={`${inputClass} font-mono`}
            />
          </div>
          <div>
            <label className={labelClass}>موعد الانصراف الرسمي</label>
            <input
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              className={`${inputClass} font-mono`}
            />
          </div>
          <div>
            <label className={labelClass}>يوم الإجازة الأسبوعية المدفوعة</label>
            <select
              value={weeklyOff}
              onChange={(event) => setWeeklyOff(event.target.value as HRWeekDayKey)}
              className={inputClass}
            >
              {HR_WEEK_DAYS.map((day) => (
                <option key={day.key} value={day.key}>
                  {day.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mx-4 mb-4 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-[11px] font-bold">
          <Info className="w-4 h-4 shrink-0" />
          <span>
            الشهر الحسابي ثابت دائماً 30 يوماً، وراتب اليوم = المرتب الشهري ÷ 30، وراتب الساعة = راتب
            اليوم ÷ 8 ساعات.
          </span>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-slate-900">
              قواعد التأخير والانصراف المبكر والغياب
            </h2>
            <p className="text-[11px] font-bold text-slate-500 mt-0.5">
              كل قاعدة تحدد شريحة التأخير أو الانصراف ومقدار الخصم وطريقة تطبيقه.
            </p>
          </div>
          <button
            type="button"
            onClick={addRule}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white text-[11px] font-black hover:bg-purple-700 transition cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            إضافة قاعدة
          </button>
        </div>

        {isLoading ? (
          <div className="p-10 text-center text-xs font-bold text-slate-400">جاري التحميل...</div>
        ) : rules.length === 0 ? (
          <div className="p-10 text-center">
            <Coffee className="w-8 h-8 mx-auto text-slate-300 mb-2" />
            <p className="text-xs font-black text-slate-700">لا توجد قواعد مسجلة</p>
            <p className="text-[11px] font-bold text-slate-500 mt-1">
              أضف قاعدة جديدة لتحديد خصم التأخير أو الانصراف المبكر أو الغياب.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rules.map((rule, index) => (
              <div key={`${rule.id}-${index}`} className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-slate-100 text-slate-600 text-[10px] font-black flex items-center justify-center">
                      {index + 1}
                    </span>
                    <span className="text-[11px] font-black text-slate-800">
                      {VIOLATION_LABELS[rule.violation_type] || rule.violation_type}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        rule.apply_mode === 'manual_review'
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      }`}
                    >
                      {APPLY_MODE_LABELS[rule.apply_mode] || APPLY_MODE_LABELS.auto}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeRule(index)}
                    title="حذف القاعدة"
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className={labelClass}>نوع المخالفة</label>
                    <select
                      value={rule.violation_type}
                      onChange={(event) =>
                        updateRule(index, {
                          violation_type: event.target.value as HRRuleViolationType
                        })
                      }
                      className={inputClass}
                    >
                      <option value="late_arrival">{VIOLATION_LABELS.late_arrival}</option>
                      <option value="early_departure">{VIOLATION_LABELS.early_departure}</option>
                      <option value="absence">{VIOLATION_LABELS.absence}</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>وصف القاعدة</label>
                    <input
                      value={rule.label || ''}
                      onChange={(event) => updateRule(index, { label: event.target.value })}
                      placeholder="مثال: تأخير حتى 15 دقيقة"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>طريقة التطبيق</label>
                    <select
                      value={rule.apply_mode}
                      onChange={(event) =>
                        updateRule(index, { apply_mode: event.target.value as HRRuleApplyMode })
                      }
                      className={inputClass}
                    >
                      <option value="auto">{APPLY_MODE_LABELS.auto}</option>
                      <option value="manual_review">{APPLY_MODE_LABELS.manual_review}</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className={labelClass}>من (دقيقة)</label>
                    <input
                      type="number"
                      min="0"
                      value={rule.from_minutes ?? 0}
                      onChange={(event) =>
                        updateRule(index, { from_minutes: Number(event.target.value) })
                      }
                      disabled={rule.violation_type === 'absence'}
                      className={`${inputClass} font-mono disabled:bg-slate-100 disabled:text-slate-400`}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>إلى (دقيقة)</label>
                    <input
                      type="number"
                      min="0"
                      value={rule.to_minutes ?? 0}
                      onChange={(event) =>
                        updateRule(index, { to_minutes: Number(event.target.value) })
                      }
                      disabled={rule.violation_type === 'absence'}
                      className={`${inputClass} font-mono disabled:bg-slate-100 disabled:text-slate-400`}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>وحدة الخصم</label>
                    <select
                      value={rule.deduction_type}
                      onChange={(event) =>
                        updateRule(index, {
                          deduction_type: event.target.value as HRRuleDeductionType
                        })
                      }
                      className={inputClass}
                    >
                      <option value="hours">{DEDUCTION_LABELS.hours}</option>
                      <option value="days">{DEDUCTION_LABELS.days}</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>قيمة الخصم</label>
                    <input
                      type="number"
                      min="0"
                      step="0.25"
                      value={rule.deduction_value}
                      onChange={(event) =>
                        updateRule(index, { deduction_value: Number(event.target.value) })
                      }
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* قسم مواعيد وقواعد العمل الإضافي */}
        <div className="border-t border-slate-100">
          <div className="p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 bg-blue-50/40">
            <div>
              <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
                <Timer className="w-4 h-4 text-blue-600" />
                مواعيد وقواعد العمل الإضافي
              </h3>
              <p className="text-[11px] font-bold text-slate-500 mt-1">
                تُطبق شريحة الإضافي تلقائياً عندما تكون بصمة الانصراف ضمن الميعاد أو بعده.
              </p>
            </div>
            <button
              type="button"
              onClick={addOvertimeRule}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-[11px] font-black hover:bg-blue-700 transition cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4" />
              إضافة ميعاد إضافي
            </button>
          </div>

          {overtimeRules.length === 0 ? (
            <div className="p-6 text-center text-[11px] font-bold text-slate-400">
              لا توجد قواعد إضافي مسجلة — أضف ميعاداً لتُحسب مكافأة الإضافي تلقائياً.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {overtimeRules.map((rule, index) => (
                <div key={`${rule.id}-${index}`} className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-black text-slate-800 flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-blue-50 text-blue-600 text-[10px] font-black flex items-center justify-center">
                        {index + 1}
                      </span>
                      العمل الإضافي
                    </span>
                    <button
                      type="button"
                      onClick={() => removeOvertimeRule(index)}
                      title="حذف القاعدة"
                      className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div>
                      <label className={labelClass}>وصف القاعدة</label>
                      <input
                        value={rule.label || ''}
                        onChange={(event) => updateOvertimeRule(index, { label: event.target.value })}
                        placeholder="مثال: إضافي مسائي"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>من الساعة</label>
                      <input
                        type="time"
                        value={rule.from_time}
                        onChange={(event) => updateOvertimeRule(index, { from_time: event.target.value })}
                        className={`${inputClass} font-mono`}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>إلى الساعة</label>
                      <input
                        type="time"
                        value={rule.to_time}
                        onChange={(event) => updateOvertimeRule(index, { to_time: event.target.value })}
                        className={`${inputClass} font-mono`}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>المكافأة</label>
                      <div className="flex gap-2">
                        <select
                          value={rule.reward_type}
                          onChange={(event) =>
                            updateOvertimeRule(index, {
                              reward_type: event.target.value as HROvertimeRewardType
                            })
                          }
                          className={inputClass}
                        >
                          <option value="hours">ساعات</option>
                          <option value="days">أيام</option>
                        </select>
                        <input
                          type="number"
                          min="0"
                          step="0.25"
                          value={rule.reward_value}
                          onChange={(event) =>
                            updateOvertimeRule(index, { reward_value: Number(event.target.value) })
                          }
                          className={`${inputClass} font-mono`}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>


        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/60 space-y-3">
          <ErrorNote message={formError} />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <p className="text-[11px] font-bold text-slate-500">
              يتم احتساب الخصومات من هذه القواعد داخل سجل الحضور ثم تُخصم في المرتبات.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleReapply()}
                disabled={isReapplying || isLoading}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-purple-200 text-purple-700 text-[11px] font-black hover:bg-purple-50 transition cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-4 h-4 ${isReapplying ? 'animate-spin' : ''}`} />
                {isReapplying ? 'جاري إعادة التطبيق...' : 'إعادة تطبيق القواعد على سجلات الشهر'}
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaving}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-[11px] font-black hover:bg-emerald-700 transition cursor-pointer disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                {isSaving ? 'جاري الحفظ...' : 'حفظ القواعد'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

