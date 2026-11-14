import React from 'react';
import { CheckCircle2, History } from 'lucide-react';

export type CompletedToggleTone = 'slate' | 'rose' | 'teal' | 'purple' | 'emerald' | 'orange';

interface CompletedModelsToggleProps {
  /** حالة التبديل الحالية. */
  enabled: boolean;
  /** عدد الموديلات/القطع المنتهية في القسم (يظهر كشارة). */
  count?: number;
  onChange: (enabled: boolean) => void;
  className?: string;
  /** لون القسم لتوحيد شكل المفتاح مع هوية كل قسم. */
  tone?: CompletedToggleTone;
}

const TONE_ACTIVE: Record<CompletedToggleTone, string> = {
  slate: 'bg-slate-900 border-slate-900',
  rose: 'bg-rose-600 border-rose-600',
  teal: 'bg-teal-700 border-teal-700',
  purple: 'bg-purple-700 border-purple-700',
  emerald: 'bg-emerald-700 border-emerald-700',
  orange: 'bg-orange-600 border-orange-600'
};

/**
 * مفتاح موحّد لإظهار/إخفاء "الموديلات المنتهية" في أعلى كل شاشة إنتاج.
 * عند التفعيل تُعرض الموديلات التي تجاوزت مرحلة القسم الحالية ككروت
 * مميزة (إطار متقطع + شارة "منتهي") مع تعطيل أزرار التحويل المسبق.
 */
export const CompletedModelsToggle: React.FC<CompletedModelsToggleProps> = ({
  enabled,
  count,
  onChange,
  className = '',
  tone = 'slate'
}) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      title={enabled ? 'إخفاء الموديلات المنتهية من هذا القسم' : 'إظهار الموديلات المنتهية في هذا القسم'}
      className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full border text-[11px] font-black transition shadow-xs cursor-pointer ${
        enabled
          ? `${TONE_ACTIVE[tone]} text-white`
          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
      } ${className}`}
    >
      <History className="w-4 h-4" />
      <span>موديلات منتهية</span>
      {typeof count === 'number' && (
        <span
          className={`min-w-[20px] h-5 px-1 rounded-full text-[10px] flex items-center justify-center font-black ${
            enabled ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-700'
          }`}
        >
          {count}
        </span>
      )}
      <span
        className={`relative inline-flex h-4 w-7 items-center rounded-full transition ${
          enabled ? 'bg-white/40' : 'bg-slate-300'
        }`}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition ${
            enabled ? 'translate-x-3.5' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );
};

interface EndedModelBadgeProps {
  /** المرحلة الحالية للموديل بعد تجاوز مرحلة القسم. */
  currentStage?: string;
  className?: string;
}

/** شارة موحّدة توضح أن الكارت لموديل منتهٍ من هذا القسم وأن أزرار التحويل معطلة. */
export const EndedModelBadge: React.FC<EndedModelBadgeProps> = ({
  currentStage,
  className = ''
}) => (
  <span
    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-200 text-slate-700 border border-slate-300 text-[10px] font-black ${className}`}
  >
    <CheckCircle2 className="w-3.5 h-3.5" />
    <span>منتهي في هذا القسم</span>
    {currentStage && <span className="text-slate-500 font-bold">— حالياً في {currentStage}</span>}
  </span>
);

export default CompletedModelsToggle;
