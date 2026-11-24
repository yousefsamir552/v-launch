import {
  DesignModel,
  PackagingMaterialDemand,
  PackagingMaterialRule,
  PackagingMaterialSizeRule
} from '../types';

/**
 * الحالات التي يُحتسب لها احتياج نشط لخامات التشغيل والأمبالاج:
 * الموديلات الموجودة فعلياً في مراحل التشطيب/المكواة/التعبئة/الدَست فقط،
 * مع استبعاد الموديلات المكتملة في مخزن الإنتاج التام حتى لا تُحتسب كطلب نشط.
 */
export const PACKAGING_ACTIVE_STATUSES: string[] = [
  'في التشطيب',
  'في المكواة',
  'في التعبئة والتغليف',
  'جاهز للدَست'
];

const toPositive = (value: unknown): number => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
};

/**
 * عدد الأطقم (Sets) المعتمدة للموديل عند حساب خامات التعبئة (أقل قطعة وليست مجموع القطع):
 * الأولوية: finished_good_sets / completed_sets ← أقل قطعة من qc_summary / cut_summary ←
 * total_cut_pieces ← الكمية المستهدفة.
 */
export const modelPackagingPieces = (model: DesignModel): number => {
  if (model.finished_good_sets !== undefined && model.finished_good_sets !== null) {
    const sets = toPositive(model.finished_good_sets);
    if (sets > 0) return sets;
  }
  if (model.completed_sets !== undefined && model.completed_sets !== null) {
    const sets = toPositive(model.completed_sets);
    if (sets > 0) return sets;
  }

  const parts = (
    Array.isArray(model.garment_parts) && model.garment_parts.length > 0
      ? model.garment_parts
      : Object.keys(model.cut_summary || {})
  ) as Array<keyof NonNullable<DesignModel['cut_summary']>>;
  if (parts.length > 0) {
    const partCounts = parts
      .map((part) => {
        const qcVal = toPositive(model.qc_summary?.[part]);
        if (qcVal > 0) return qcVal;
        return toPositive(model.cut_summary?.[part]);
      })
      .filter((v) => v > 0);
    if (partCounts.length > 0) {
      return Math.min(...partCounts);
    }
  }

  const cutPieces = toPositive(model.total_cut_pieces);
  if (cutPieces > 0) return cutPieces;

  return toPositive(model.target_cut_quantity);
};

export const isModelActiveForPackaging = (model: DesignModel): boolean =>
  !model.is_deleted && PACKAGING_ACTIVE_STATUSES.includes(model.status);

/** الموديلات الداخلة في حساب احتياج خامات التشغيل حالياً. */
export const packagingActiveModels = (models: DesignModel[]): DesignModel[] =>
  models.filter(isModelActiveForPackaging);

/**
 * حساب MRP لصف خامة/مقاس واحد:
 * المطلوب = مجموع قطع الموديلات × معدل الاستهلاك لكل قطعة
 * العجز   = max(0, المطلوب − الرصيد)
 */
export const computePackagingDemand = (
  models: DesignModel[],
  rule: PackagingMaterialRule,
  row: PackagingMaterialSizeRule
): PackagingMaterialDemand => {
  const applicableGroups = Array.isArray(rule.applicable_size_groups)
    ? rule.applicable_size_groups.filter(Boolean)
    : [];
  // فئات المقاسات التي لها صف خاص بها؛ تُستثنى من الصف العام لتجنب العد المزدوج.
  const explicitGroups = new Set(
    (rule.size_rules || []).map((sizeRule) => sizeRule.size_group_id).filter(Boolean)
  );

  const scopedModels = models.filter((model) => {
    if (!isModelActiveForPackaging(model)) return false;
    const modelGroup = model.size_category_id || '';
    // صف مقاس محدد → الموديلات التي تنتمي لنفس فئة المقاس فقط.
    if (row.size_group_id) return modelGroup === row.size_group_id;
    // الصف العام لا يحسب الفئات التي لها صف مستقل.
    if (modelGroup && explicitGroups.has(modelGroup)) return false;
    // صف عام → فئات المقاسات المختارة في القاعدة (أو الكل عند عدم التحديد).
    if (applicableGroups.length) return applicableGroups.includes(modelGroup);
    return true;
  });

  const totalPieces = scopedModels.reduce(
    (sum, model) => sum + modelPackagingPieces(model),
    0
  );
  const consumptionPerPiece = toPositive(row.consumption_per_piece);
  const required = Number((totalPieces * consumptionPerPiece).toFixed(3));
  const stock = Number(row.current_stock || 0);
  const shortage = Math.max(0, Number((required - stock).toFixed(3)));
  const minThreshold = Number(row.min_alert_threshold || 0);

  return {
    sizeRuleId: row.id,
    totalPieces,
    modelCount: scopedModels.length,
    required,
    stock,
    shortage,
    consumptionPerPiece,
    belowMinThreshold: minThreshold > 0 && stock <= minThreshold,
    hasShortage: shortage > 0
  };
};

/** خريطة الاحتياج لكل صف خامة (مفتاحها معرّف صف المقاس). */
export const buildPackagingDemandMap = (
  models: DesignModel[],
  rules: PackagingMaterialRule[]
): Record<string, PackagingMaterialDemand> => {
  const map: Record<string, PackagingMaterialDemand> = {};
  rules.forEach((rule) => {
    (rule.size_rules || []).forEach((row) => {
      map[row.id] = computePackagingDemand(models, rule, row);
    });
  });
  return map;
};

/** هل القاعدة بحاجة لإعداد (لا توجد صفوف مقاسات)؟ */
export const isPackagingRuleConfigured = (rule: PackagingMaterialRule): boolean =>
  Array.isArray(rule.size_rules) && rule.size_rules.length > 0;
