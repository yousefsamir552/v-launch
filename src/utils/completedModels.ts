import { PART_STAGE_LABELS, PART_STAGE_ORDER, type GarmentPart, type PartStage } from '../types';

/**
 * قيمة سياق التدقيق التي تُرسل في ترويسة X-Audit-Context
 * عند عرض / تعديل / إعادة طباعة موديل منتهٍ.
 */
export const COMPLETED_MODEL_AUDIT_CONTEXT = 'completed_model';

/**
 * العلامة النصية الموحّدة التي يضيفها الباك إند لبداية تفاصيل أي
 * سجل تدقيق ناتج عن تعديل على موديل منتهٍ. تستخدمها شاشة سجل المراقبة للتمييز.
 */
export const COMPLETED_MODEL_MARKER = '[تعديل على موديل منتهي]';

/** ترويسات سياق التدقيق التي تُمرَّر مع أي طلب تعديل/إجراء على موديل منتهٍ. */
export const auditContextHeaders = (section: string): Record<string, string> => ({
  'X-Audit-Context': COMPLETED_MODEL_AUDIT_CONTEXT,
  'X-Audit-Section': String(section || '').trim()
});

/** رتبة المرحلة ضمن سلسلة الإنتاج (الأكبر = الأكثر تقدماً). */
export const stageRank = (stage?: string | null): number => {
  const index = PART_STAGE_ORDER.indexOf(String(stage || '') as PartStage);
  return index < 0 ? -1 : index;
};

/** هل تجاوزت القطعة مرحلة معيّنة فعلياً؟ */
export const stageBeyond = (stage: string | undefined | null, target: PartStage): boolean =>
  stageRank(stage) > stageRank(target);

/**
 * المرحلة الحالية للموديل كنص عربي واضح (تعتمد على أبطأ قطعة، ثم الحالة العامة).
 */
export const currentStageLabel = (
  model?:
    | {
        status?: string;
        part_stages?: Partial<Record<GarmentPart, PartStage>>;
      }
    | null
): string => {
  if (!model) return '';
  const stages = Object.values(model.part_stages || {}) as PartStage[];
  const known = stages.filter((stage) => stageRank(stage) >= 0);
  if (known.length) {
    const slowest = known.reduce((acc, stage) =>
      stageRank(stage) < stageRank(acc) ? stage : acc
    );
    return PART_STAGE_LABELS[slowest] || model.status || '';
  }
  return model.status || '';
};

/** هل تفاصيل سجل التدقيق تشير إلى تعديل على موديل منتهٍ؟ */
export const isCompletedModelAudit = (details?: string | null): boolean =>
  Boolean(details && details.includes(COMPLETED_MODEL_MARKER));
