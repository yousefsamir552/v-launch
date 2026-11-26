import React, { useEffect, useState } from 'react';
import { Star, X, CheckCircle2, Sparkles } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useModalBackHandler } from '../utils/mobileBackNav';
import {
  WorkshopEvaluation,
  WorkshopEvaluationStage,
  WORKSHOP_EVALUATION_STAGE_LABELS
} from '../types';

/**
 * يقترح تقييم «ميعاد التسليم» تلقائياً (1–5 نجوم) بمقارنة تاريخ الاستلام الفعلي بالمتوقع.
 */
export const suggestTimelinessRating = (
  expectedDate?: string | null,
  actualDate?: string | null
): { score: number; hint: string } => {
  if (!expectedDate) {
    return { score: 5, hint: 'لا يوجد موعد متوقع مسجّل — التقييم الافتراضي 5/5' };
  }
  const exp = new Date(String(expectedDate).slice(0, 10));
  const act = actualDate ? new Date(String(actualDate).slice(0, 10)) : new Date();
  if (Number.isNaN(exp.getTime()) || Number.isNaN(act.getTime())) {
    return { score: 5, hint: 'التقييم الافتراضي 5/5' };
  }
  exp.setHours(0, 0, 0, 0);
  act.setHours(0, 0, 0, 0);
  const lateDays = Math.round((act.getTime() - exp.getTime()) / (1000 * 60 * 60 * 24));
  if (lateDays <= 0) {
    return { score: 5, hint: 'تم التسليم في الموعد المحدد — مقترح 5/5' };
  }
  if (lateDays <= 2) {
    return { score: 4, hint: `تأخير ${lateDays} ${lateDays === 1 ? 'يوم' : 'يومين'} — مقترح 4/5` };
  }
  if (lateDays <= 4) {
    return { score: 3, hint: `تأخير ${lateDays} أيام — مقترح 3/5` };
  }
  if (lateDays <= 7) {
    return { score: 2, hint: `تأخير ${lateDays} أيام — مقترح 2/5` };
  }
  return { score: 1, hint: `تأخير ${lateDays} يوماً — مقترح 1/5` };
};

export const StarRatingPicker: React.FC<{
  label: string;
  value: number;
  onChange: (val: number) => void;
  hint?: string;
  compact?: boolean;
}> = ({ label, value, onChange, hint, compact = false }) => {
  const [hovered, setHovered] = useState<number | null>(null);
  const displayVal = hovered ?? value;
  return (
    <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
      <div className="flex items-center justify-between gap-2">
        <span className={compact ? 'text-[11px] font-bold text-slate-700' : 'text-xs font-bold text-slate-700'}>
          {label}
        </span>
        <span className="text-[11px] font-black text-amber-600 tabular-nums">{value} / 5</span>
      </div>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onMouseEnter={() => setHovered(star)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onChange(star)}
            className="p-0.5 rounded-md transition hover:scale-110 cursor-pointer"
            title={`${star} من 5`}
          >
            <Star
              className={`${compact ? 'w-5 h-5' : 'w-6 h-6'} transition ${
                star <= displayVal
                  ? 'fill-amber-400 text-amber-500'
                  : 'fill-slate-100 text-slate-300'
              }`}
            />
          </button>
        ))}
        {hint && (
          <span className="ms-2 text-[10px] font-semibold text-slate-500 truncate">{hint}</span>
        )}
      </div>
    </div>
  );
};

export interface InlineEvaluationDraft {
  enabled: boolean;
  deliveryTimeliness: number;
  workQuality: number;
  finishingQuality: number;
  notes: string;
}

export const createInitialEvaluationDraft = (
  expectedDate?: string | null,
  actualDate?: string | null,
  existing?: WorkshopEvaluation | null
): InlineEvaluationDraft => {
  if (existing) {
    return {
      enabled: true,
      deliveryTimeliness: existing.delivery_timeliness || 5,
      workQuality: existing.work_quality || 5,
      finishingQuality: existing.finishing_quality || 5,
      notes: existing.notes || ''
    };
  }
  return {
    enabled: false,
    deliveryTimeliness: suggestTimelinessRating(expectedDate, actualDate).score,
    workQuality: 5,
    finishingQuality: 5,
    notes: ''
  };
};

/**
 * قسم تقييم اختياري مدمج داخل نوافذ العد بعد الطباعة/المكن والتشطيب.
 */
export const InlineWorkshopEvaluationBox: React.FC<{
  workshopName: string;
  expectedDate?: string | null;
  actualDate?: string | null;
  title?: string;
  isEditing?: boolean;
  draft: InlineEvaluationDraft;
  onChange: (next: InlineEvaluationDraft) => void;
}> = ({ workshopName, expectedDate, actualDate, title, isEditing = false, draft, onChange }) => {
  const suggestion = suggestTimelinessRating(expectedDate, actualDate);
  const avg = ((draft.deliveryTimeliness + draft.workQuality + draft.finishingQuality) / 3).toFixed(1);

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3 space-y-2.5">
      <label className="flex items-center justify-between gap-2 cursor-pointer">
        <span className="flex items-center gap-1.5 text-xs font-black text-amber-900">
          <Star className="w-4 h-4 fill-amber-400 text-amber-500 shrink-0" />
          <span>
            {title || `تقييم أداء الورشة (${workshopName})`}
            {isEditing ? ' — تعديل التقييم المسجّل' : ' — اختياري'}
          </span>
        </span>
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => onChange({ ...draft, enabled: e.target.checked })}
          className="w-4 h-4 accent-amber-600 rounded cursor-pointer shrink-0"
        />
      </label>

      {draft.enabled && (
        <div className="space-y-2.5 pt-2 border-t border-amber-200/80">
          <StarRatingPicker
            compact
            label="ميعاد التسليم"
            value={draft.deliveryTimeliness}
            onChange={(v) => onChange({ ...draft, deliveryTimeliness: v })}
            hint={suggestion.hint}
          />
          <StarRatingPicker
            compact
            label="جودة الشغل"
            value={draft.workQuality}
            onChange={(v) => onChange({ ...draft, workQuality: v })}
          />
          <StarRatingPicker
            compact
            label="جودة التشطيب"
            value={draft.finishingQuality}
            onChange={(v) => onChange({ ...draft, finishingQuality: v })}
          />
          <input
            type="text"
            value={draft.notes}
            onChange={(e) => onChange({ ...draft, notes: e.target.value })}
            placeholder="ملاحظات التقييم (اختياري)..."
            className="w-full px-3 py-1.5 rounded-xl border border-amber-200 bg-white text-[11px] font-semibold focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <div className="flex items-center justify-between text-[11px] font-bold text-amber-900">
            <span>المتوسط العام لهذا التقييم:</span>
            <span className="px-2 py-0.5 rounded-full bg-amber-200/80 font-black tabular-nums">
              ⭐ {avg} / 5
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export interface WorkshopEvaluationTarget {
  workshopId?: string;
  workshopName: string;
  stage: WorkshopEvaluationStage;
  modelId: string;
  modelCode: string;
  printDispatchId?: string;
  sewingDispatchId?: string;
  finishingRecordId?: string;
  expectedDate?: string | null;
  actualDate?: string | null;
  existing?: WorkshopEvaluation | null;
}

/**
 * نافذة تقييم ورشة مستقلة تُفتح من زر «⭐ تقييم» في المطابع / المكن / التشطيب.
 */
export const WorkshopEvaluationModal: React.FC<{
  target: WorkshopEvaluationTarget | null;
  onClose: () => void;
  onSaved?: (evaluation: WorkshopEvaluation) => void;
}> = ({ target, onClose, onSaved }) => {
  const { submitWorkshopEvaluation } = useApp();
  const [delivery, setDelivery] = useState(5);
  const [workQuality, setWorkQuality] = useState(5);
  const [finishingQuality, setFinishingQuality] = useState(5);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useModalBackHandler(Boolean(target), onClose);

  useEffect(() => {
    if (!target) return;
    if (target.existing) {
      setDelivery(target.existing.delivery_timeliness || 5);
      setWorkQuality(target.existing.work_quality || 5);
      setFinishingQuality(target.existing.finishing_quality || 5);
      setNotes(target.existing.notes || '');
    } else {
      const sug = suggestTimelinessRating(target.expectedDate, target.actualDate);
      setDelivery(sug.score);
      setWorkQuality(5);
      setFinishingQuality(5);
      setNotes('');
    }
  }, [target]);

  if (!target) return null;

  const suggestion = suggestTimelinessRating(target.expectedDate, target.actualDate);
  const avg = ((delivery + workQuality + finishingQuality) / 3).toFixed(2);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await submitWorkshopEvaluation({
      workshopId: target.workshopId,
      workshopName: target.workshopName,
      stage: target.stage,
      modelId: target.modelId,
      printDispatchId: target.printDispatchId,
      sewingDispatchId: target.sewingDispatchId,
      finishingRecordId: target.finishingRecordId,
      deliveryTimeliness: delivery,
      workQuality,
      finishingQuality,
      notes
    });
    setSaving(false);
    if (res.success && res.evaluation) {
      onSaved?.(res.evaluation);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl w-full max-w-md shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 bg-gradient-to-l from-amber-500 to-orange-600 text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-black text-sm truncate">
                {target.existing ? 'تعديل تقييم الورشة' : 'تقييم أداء الورشة'}
              </h3>
              <p className="text-[11px] text-white/90 font-semibold truncate">
                {target.workshopName} • {WORKSHOP_EVALUATION_STAGE_LABELS[target.stage]} • موديل{' '}
                {target.modelCode}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full bg-white/15 hover:bg-white/25 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3.5 space-y-3">
            <StarRatingPicker
              label="1. ميعاد التسليم (Delivery Timeliness)"
              value={delivery}
              onChange={setDelivery}
              hint={suggestion.hint}
            />
            <StarRatingPicker
              label="2. جودة الشغل (Work Quality)"
              value={workQuality}
              onChange={setWorkQuality}
            />
            <StarRatingPicker
              label="3. جودة التشطيب (Finishing Quality)"
              value={finishingQuality}
              onChange={setFinishingQuality}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">
              ملاحظات التقييم (اختياري)
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="اكتب أي ملاحظات عن جودة الشغل أو الالتزام بالمواعيد..."
              className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-amber-400 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-between rounded-2xl bg-amber-50 border border-amber-200 px-4 py-2.5">
            <span className="text-xs font-bold text-amber-900">المتوسط العام للتقييم</span>
            <span className="text-base font-black text-amber-700 tabular-nums">⭐ {avg} / 5</span>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-full text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-amber-600 hover:bg-amber-700 text-white text-xs font-black shadow-sm transition disabled:opacity-50 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{saving ? 'جارٍ الحفظ...' : 'حفظ التقييم'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
