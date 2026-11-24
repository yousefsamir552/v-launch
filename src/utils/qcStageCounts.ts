import type { GarmentPart, Model, PrintDispatch, QCRecord, SewingDispatch } from '../types';

/**
 * أرقام بطاقة الفرز لقطعة واحدة (وليست إجمالي الموديل).
 *
 * المشكلة الأصلية: بطاقة الفرز كانت تعرض `count_before_print` / `count_after_print`
 * وهي إجماليات مجمّعة على كل قطع الموديل (تيشرت + بنطلون + جاكيت)، بينما البطاقة
 * نفسها مخصّصة لقطعة واحدة. لذلك كانت الأرقام تبدو أكبر من المقصوص لهذه القطعة.
 * هنا نحسب كل رقم من سجلات هذه القطعة وحدها.
 */
export interface QCPartStageCounts {
  /** المقصوص الفعلي لهذه القطعة (من cut_summary القادمة من الباك إند). */
  cutPieces: number;
  /** العدد المستهدف للموديل ككل (للعرض فقط عند مرحلة القص). */
  targetPieces: number;
  /** السليم/التالف المسجّل في العد قبل الطباعة لهذه القطعة. */
  beforePrintGood: number;
  beforePrintDefect: number;
  /** السليم/التالف المسجّل في العد بعد الطباعة لهذه القطعة. */
  afterPrintGood: number;
  afterPrintDefect: number;
  /** السليم/التالف المسجّل في العد بعد المكن لهذه القطعة. */
  afterSewingGood: number;
  afterSewingDefect: number;
  /** المرسل/المستلم من المطابع (بدون التطريز) لهذه القطعة. */
  printSent: number;
  printReceived: number;
  /** المرسل/المستلم من التطريز لهذه القطعة. */
  embroiderySent: number;
  embroideryReceived: number;
  /** المسلّم/المستلم من المكن لهذه القطعة. */
  sewingSent: number;
  sewingReceived: number;
}

export interface QCPartStageCountsInput {
  model: Model;
  part: GarmentPart;
  qcRecords: QCRecord[];
  printDispatches: PrintDispatch[];
  sewingDispatches: SewingDispatch[];
  normalizePartKey: (value?: string | null) => GarmentPart;
}

const safeNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/** هل الإرسالية للمطبعة هي تطريز وليست طباعة عادية؟ */
const isEmbroideryDispatch = (dispatch: PrintDispatch): boolean =>
  [dispatch.print_type, dispatch.print_location].some((value) =>
    String(value || '').includes('تطريز')
  );

/**
 * القطع المستلمة فعلياً في الإرسالية:
 * `received_pieces` هو المصدر الأساسي (يدعم الاستلام الجزئي)، ونستخدم
 * `pieces_count` كاحتياط فقط للسجلات القديمة التي عُلمت كمستلمة دون حفظ الكمية.
 */
const receivedQuantity = (
  dispatch: { pieces_count?: number; received_pieces?: number; status?: string }
): number => {
  const received = safeNumber(dispatch.received_pieces);
  if (received > 0) return received;
  const status = String(dispatch.status || '');
  return status === 'تم الاستلام' || status === 'تم الاستلام بالمصنع'
    ? safeNumber(dispatch.pieces_count)
    : 0;
};

/**
 * يحسب كل أرقام بطاقة الفرز لقطعة واحدة من السجلات الفعلية.
 * لا يعتمد على أي حقل مجمّع على مستوى الموديل سوى المقصوص والهدف.
 */
export const qcPartStageCounts = ({
  model,
  part,
  qcRecords,
  printDispatches,
  sewingDispatches,
  normalizePartKey
}: QCPartStageCountsInput): QCPartStageCounts => {
  const isSamePart = (value?: string | null) => normalizePartKey(value) === part;

  const stageTotals = {
    before_print: { good: 0, defect: 0 },
    after_print: { good: 0, defect: 0 },
    after_sewing: { good: 0, defect: 0 }
  };

  qcRecords.forEach((record) => {
    if (record.model_id !== model.id) return;
    if (!isSamePart(record.part_type || record.partType || 'shirt')) return;
    const bucket = stageTotals[record.stage];
    if (!bucket) return;
    bucket.good += safeNumber(record.good_qty ?? record.counted_pieces);
    bucket.defect += safeNumber(record.defect_qty ?? record.defect_pieces);
  });

  let printSent = 0;
  let printReceived = 0;
  let embroiderySent = 0;
  let embroideryReceived = 0;

  printDispatches.forEach((dispatch) => {
    if (dispatch.model_id !== model.id) return;
    if (!isSamePart(dispatch.piece_type || dispatch.piece_label || 'shirt')) return;
    const sent = safeNumber(dispatch.pieces_count);
    const received = receivedQuantity(dispatch);
    if (isEmbroideryDispatch(dispatch)) {
      embroiderySent += sent;
      embroideryReceived += received;
    } else {
      printSent += sent;
      printReceived += received;
    }
  });

  let sewingSent = 0;
  let sewingReceived = 0;
  sewingDispatches.forEach((dispatch) => {
    if (dispatch.model_id !== model.id) return;
    if (!isSamePart(dispatch.piece_type || dispatch.piece_label || 'shirt')) return;
    sewingSent += safeNumber(dispatch.pieces_count);
    sewingReceived += receivedQuantity(dispatch);
  });

  return {
    cutPieces: safeNumber(model.cut_summary?.[part]),
    targetPieces: safeNumber(model.target_cut_quantity),
    beforePrintGood: stageTotals.before_print.good,
    beforePrintDefect: stageTotals.before_print.defect,
    afterPrintGood: stageTotals.after_print.good,
    afterPrintDefect: stageTotals.after_print.defect,
    afterSewingGood: stageTotals.after_sewing.good,
    afterSewingDefect: stageTotals.after_sewing.defect,
    printSent,
    printReceived,
    embroiderySent,
    embroideryReceived,
    sewingSent,
    sewingReceived
  };
};
