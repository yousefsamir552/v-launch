import type { CuttingRecord, GarmentPart, QCRecord, QCStageType } from '../types';

/**
 * مصادر البيانات اللازمة لحساب القيم الافتراضية لخانة "السليم" في جدول العد
 * (الفرز والكنترول): سجلات الفرشات + سجلات الفرز + مطبّع أسماء القطع.
 */
export interface QCGoodDefaultsSources {
  cuttingRecords: CuttingRecord[];
  qcRecords: QCRecord[];
  normalizePartKey: (value?: string | null) => GarmentPart;
}

/**
 * المراحل السابقة التي يُورَّث منها العدد السليم المعتمد عند فتح مرحلة لاحقة.
 * - العد بعد الطباعة يورث من العد قبل الطباعة.
 * - العد بعد المكن يورث من العد بعد الطباعة ثم من العد قبل الطباعة.
 */
const PREVIOUS_QC_STAGES: Record<QCStageType, QCStageType[]> = {
  before_print: [],
  after_print: ['before_print'],
  after_sewing: ['after_print', 'before_print']
};

/** توحيد شكل اسم اللون للمقارنة (حذف الفراغات الزائدة وتوحيد حالة الأحرف). */
const normalizeLabel = (value?: string | null): string =>
  (value || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * مطابقة اسم لون طبقة الفرشة مع اسم اللون المعروض في مصفوفة الفرز (تطابق دقيق بدون تداخل بادئات مثل C1 و C10).
 * تعتمد التطابق المباشر (مع تجاهل اللاحقة الاختيارية بين قوسين لاسم القطعة) أو التطابق الدقيق
 * لأحد مقاطع الصيغة "كود - اسم" بدون استخدام startsWith/includes لمنع التداخل بين الأكواد المتشابهة.
 */
export const qcColorNamesMatch = (a?: string | null, b?: string | null): boolean => {
  const stripSuffix = (val: string) => val.replace(/\s*\([^()]*\)\s*$/, '').trim();
  const first = stripSuffix(normalizeLabel(a));
  const second = stripSuffix(normalizeLabel(b));
  if (!first || !second) return false;
  if (first === second) return true;

  const firstSegments = first.split(' - ').map((segment) => segment.trim()).filter(Boolean);
  const secondSegments = second.split(' - ').map((segment) => segment.trim()).filter(Boolean);
  return firstSegments.some((segment) => secondSegments.some((other) => segment === other));
};

/**
 * مطابقة اسم لون محفوظ في سجل فرز/كنترول مع اسم اللون المعروض حالياً في المصفوفة.
 * أسماء الألوان أصبحت تُعرض لكل قطعة على حِدة بدون لاحقة اسم القطعة، بينما السجلات
 * القديمة قد تكون محفوظة بصيغة "C-101 - أحمر (تيشرت - الصدر)"، لذا نطابق الاسم
 * مباشرةً أو بعد حذف اللاحقة بين قوسين من نهاية الاسم المحفوظ.
 */
export const qcSavedColorMatches = (
  savedColor?: string | null,
  currentColor?: string | null
): boolean => {
  const saved = normalizeLabel(savedColor);
  const current = normalizeLabel(currentColor);
  if (!saved || !current) return false;
  if (saved === current) return true;
  const withoutPartSuffix = saved.replace(/\s*\([^()]*\)\s*$/, '').trim();
  return withoutPartSuffix === current;
};

/**
 * يبحث عن خلية (لون × مقاس) محفوظة داخل سجلات مرحلة معينة.
 * يُفضّل التطابق المباشر لاسم اللون (أحدث السجلات) على التطابق مع سجل قديم
 * يحمل لاحقة اسم القطعة بين قوسين، حتى لا تظهر قيمة قديمة بعد الحفظ.
 */
export const findSavedQcCell = <
  T extends { color_name?: string | null; size?: string | null }
>(
  records: T[],
  colorName: string,
  sizeName: string
): T | undefined => {
  const targetSize = (sizeName || '').trim();
  const targetColor = (colorName || '').trim();
  const candidates = records.filter(
    (r) =>
      (r.size || '').trim() === targetSize &&
      qcSavedColorMatches(r.color_name, targetColor)
  );
  if (candidates.length === 0) return undefined;
  return (
    candidates.find((r) => (r.color_name || '').trim() === targetColor) ||
    candidates[candidates.length - 1]
  );
};

/** عدد القطع في الراق الواحد لفرشة معينة (قطعة واحدة على الأقل). */
const piecesPerLayerOf = (record: CuttingRecord): number =>
  Math.max(1, Number(record.pieces_per_layer ?? record.piecesPerLayer ?? 1) || 1);

/** إجمالي القطع المقصوصة في فرشة كاملة (كل الألوان). */
const spreadCutPiecesOf = (record: CuttingRecord): number => {
  const explicit = Number(record.pieces_count ?? record.piecesCount ?? record.cut_pieces ?? 0);
  if (explicit > 0) return explicit;
  const layers = Math.max(0, Number(record.layers_count ?? record.layersCount ?? 0) || 0);
  return layers * piecesPerLayerOf(record);
};

/**
 * العدد السليم المعتمد في المرحلة السابقة لنفس (الموديل، القطعة، اللون، المقاس).
 * يُرجع 0 إذا لم توجد سجلات سابقة أو كان مجموع السليم بها صفراً.
 */
const resolveInheritedGoodQty = (
  { qcRecords, normalizePartKey }: QCGoodDefaultsSources,
  modelId: string,
  part: GarmentPart,
  stage: QCStageType,
  colorName: string,
  sizeName: string
): number => {
  const previousStages = PREVIOUS_QC_STAGES[stage] || [];
  for (const previousStage of previousStages) {
    const isSameCell = (r: (typeof qcRecords)[number]) =>
      r.model_id === modelId &&
      r.stage === previousStage &&
      normalizePartKey(r.part_type || r.partType) === part &&
      (r.size || '').trim() === (sizeName || '').trim();
    // نُفضّل السجلات التي تحمل اسم اللون نفسه تماماً؛ فإن وُجدت لا نضمّ إليها
    // سجلات قديمة بنفس اللون مع لاحقة اسم القطعة حتى لا تتضاعف الكمية.
    const exactMatches = qcRecords.filter(
      (r) => isSameCell(r) && normalizeLabel(r.color_name) === normalizeLabel(colorName)
    );
    const matches =
      exactMatches.length > 0
        ? exactMatches
        : qcRecords.filter((r) => isSameCell(r) && qcColorNamesMatch(r.color_name, colorName));
    const totalGood = matches.reduce(
      (sum, r) => sum + (Number(r.good_qty ?? r.counted_pieces ?? 0) || 0),
      0
    );
    if (totalGood > 0) return totalGood;
  }
  return 0;
};

/**
 * العدد المقصوص الفعلي لكل (لون × مقاس) من سجلات الفرشات:
 * 1) نجمع راقات اللون في كل فرشات القطعة ونضربها في عدد القطع بالراق.
 * 2) الفرشات بدون تفصيل ألوان: نوزّع إجمالي مقصوصها على الألوان بالتساوي.
 * 3) نوزّع إجمالي مقصوص اللون على المقاسات المعتمدة بالتساوي (مع توزيع الباقي).
 */
const resolveCutQtyForCell = (
  { cuttingRecords, normalizePartKey }: QCGoodDefaultsSources,
  modelId: string,
  part: GarmentPart,
  colorName: string,
  sizeName: string,
  allColors: string[],
  allSizes: string[]
): number => {
  const partSpreads = cuttingRecords.filter(
    (r) =>
      r.model_id === modelId &&
      // القصّات/الأجزاء الفرعية لا تُملأ بها خانات العد التلقائية.
      !(r.is_sub_cut ?? r.isSubCut ?? false) &&
      normalizePartKey(r.part_type || r.partType) === part
  );

  const colorCount = Math.max(1, allColors.length);
  const colorIndex = Math.max(
    0,
    allColors.findIndex((color) => qcColorNamesMatch(color, colorName))
  );

  /** توزيع عدد قطع فرشة واحدة على الألوان بالتساوي (مع توزيع الباقي على أول الألوان). */
  const evenShareOfPieces = (pieces: number): number => {
    if (pieces <= 0) return 0;
    const basePerColor = Math.floor(pieces / colorCount);
    const colorRemainder = pieces % colorCount;
    return basePerColor + (colorIndex < colorRemainder ? 1 : 0);
  };

  let colorTotalCutPieces = 0;
  // هل تعرّفنا على أي اسم لون داخل راقات الفرشات؟ (لمعرفة إن كانت التسميات مختلفة تماماً)
  let hasRecognizableLayerColor = false;

  partSpreads.forEach((spread) => {
    const layers = spread.color_layers || spread.colorLayers || [];
    if (layers.length === 0) {
      // فرشة بدون تفصيل راقات الألوان → نوزّع إجمالي مقصوصها على الألوان بالتساوي.
      colorTotalCutPieces += evenShareOfPieces(spreadCutPiecesOf(spread));
      return;
    }
    const perLayer = piecesPerLayerOf(spread);
    layers.forEach((layer) => {
      const layerColor = layer.color_name || layer.colorName || '';
      if (allColors.some((color) => qcColorNamesMatch(color, layerColor))) {
        hasRecognizableLayerColor = true;
      }
      if (!qcColorNamesMatch(layerColor, colorName)) return;
      const layersCount = Math.max(0, Number(layer.layers_count ?? layer.layersCount ?? 0) || 0);
      colorTotalCutPieces += layersCount * perLayer;
    });
  });

  // احتياط: تسميات ألوان الفرشات لا تشبه ألوان الموديل إطلاقاً
  // (أو كل الفرشات بدون تفصيل ألوان) → توزيع إجمالي المقصوص بالتساوي على الألوان.
  if (!hasRecognizableLayerColor && colorTotalCutPieces <= 0) {
    const totalCutPieces = partSpreads.reduce(
      (sum, spread) => sum + spreadCutPiecesOf(spread),
      0
    );
    colorTotalCutPieces = evenShareOfPieces(totalCutPieces);
  }

  if (colorTotalCutPieces <= 0) return 0;

  const sizeCount = Math.max(1, allSizes.length);
  const sizeIndex = Math.max(0, allSizes.indexOf(sizeName));
  const basePerSize = Math.floor(colorTotalCutPieces / sizeCount);
  const remainder = colorTotalCutPieces % sizeCount;
  return basePerSize + (sizeIndex < remainder ? 1 : 0);
};

/**
 * القيمة الافتراضية لخانة "السليم" في جدول العد (لون × مقاس):
 * - في مرحلتي "بعد الطباعة" و"بعد المكن": يُستخدم العدد السليم المعتمد في المرحلة
 *   السابقة إن وُجد أكبر من صفر.
 * - وإلا يُستخدم العدد المقصوص الفعلي المحسوب من فرشات القص.
 */
export const resolveDefaultGoodQtyForCell = (
  sources: QCGoodDefaultsSources,
  modelId: string,
  part: GarmentPart,
  stage: QCStageType,
  colorName: string,
  sizeName: string,
  allColors: string[],
  allSizes: string[]
): number => {
  const cutQtyForCell = resolveCutQtyForCell(
    sources,
    modelId,
    part,
    colorName,
    sizeName,
    allColors,
    allSizes
  );
  const inheritedGoodQty = resolveInheritedGoodQty(
    sources,
    modelId,
    part,
    stage,
    colorName,
    sizeName
  );
  return inheritedGoodQty > 0 ? inheritedGoodQty : cutQtyForCell;
};
