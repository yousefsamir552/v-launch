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

/**
 * ترويسات سياق التدقيق التي تُمرَّر مع أي طلب تعديل/إجراء على موديل منتهٍ.
 * قيمة X-Audit-Section تُرمَّز بـ encodeURIComponent لأن fetch يرفض أي حرف
 * عربي (خارج ISO-8859-1) داخل الـ Headers ويتوقف الطلب قبل إرساله للسيرفر.
 * الباك إند يفك الترميز بـ urllib.parse.unquote قبل حفظ اسم القسم.
 */
export const auditContextHeaders = (section: string): Record<string, string> => ({
  'X-Audit-Context': COMPLETED_MODEL_AUDIT_CONTEXT,
  'X-Audit-Section': encodeURIComponent(String(section || '').trim())
});

/**
 * الأطقم التامة الفعلية للموديل:
 * تُعتمد قيمة completed_sets الجاهزة من الباك إند أولاً (وهي تخصم عجز عينات
 * التصوير)، وإلا نرجع للمعادلة القديمة كاحتياط للموديلات غير المحسوبة.
 */
export const finishedSetsOf = (
  model?:
    | {
        finished_good_sets?: number;
        completed_sets?: number;
        count_after_sewing?: number;
        count_after_print?: number;
        actual_cut_count?: number;
        target_cut_quantity?: number;
      }
    | null
): number => {
  if (!model) return 0;
  // تجنب خطأ 0 falsy: إذا أعاد الباك إند 0 صراحةً (مثلاً كل القطع في التصوير) لا نرجع للأرقام الخام.
  if (model.finished_good_sets !== undefined && model.finished_good_sets !== null) {
    const val = Number(model.finished_good_sets);
    return Number.isFinite(val) && val >= 0 ? val : 0;
  }
  if (model.completed_sets !== undefined && model.completed_sets !== null) {
    const val = Number(model.completed_sets);
    return Number.isFinite(val) && val >= 0 ? val : 0;
  }
  return Number(
    model.count_after_sewing ??
      model.count_after_print ??
      model.actual_cut_count ??
      model.target_cut_quantity ??
      0
  );
};

/** عدد قطع عينة التصوير المحتجزة (تُخصم مؤقتاً من الأطقم التامة). */
export const photographyOutstandingOf = (
  model?: { photography_outstanding_qty?: number } | null
): number => Math.max(0, Number(model?.photography_outstanding_qty || 0));

/** وصف قصير يظهر بجانب الرقم عند وجود قطع محتجزة في التصوير. */
export const photographyHoldLabel = (quantity: number): string =>
  quantity > 0 ? `${quantity} قطعة عينة في التصوير` : '';

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
