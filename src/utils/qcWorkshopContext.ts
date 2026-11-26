import {
  GarmentPart,
  Model,
  PrintDispatch,
  QCStageType,
  SewingDispatch,
  Workshop,
  WorkshopEvaluation,
  WorkshopEvaluationStage
} from '../types';

export interface QCStageWorkshopSummary {
  stage: WorkshopEvaluationStage;
  workshopId?: string;
  workshopName: string;
  dispatchedAt?: string;
  receivedAt?: string;
  expectedDate?: string;
  printDispatchId?: string;
  sewingDispatchId?: string;
  existingEvaluation: WorkshopEvaluation | null;
}

/**
 * Resolves the latest relevant Print or Sewing dispatch (workshop name, dispatched_at, received_at)
 * and any existing WorkshopEvaluation for a post-stage QC stage (after_print / after_sewing).
 */
export function resolveQCStageWorkshopSummary(params: {
  stage: QCStageType;
  model: Model;
  part: GarmentPart;
  printDispatches: PrintDispatch[];
  sewingDispatches: SewingDispatch[];
  workshops: Workshop[];
  workshopEvaluations: WorkshopEvaluation[];
  normalizePartKey: (val?: string | null) => GarmentPart;
}): QCStageWorkshopSummary | null {
  const {
    stage,
    model,
    part,
    printDispatches,
    sewingDispatches,
    workshops,
    workshopEvaluations,
    normalizePartKey
  } = params;

  if (stage === 'after_print') {
    const partDispatches = printDispatches.filter(
      (d) => d.model_id === model.id && normalizePartKey(d.piece_type) === part
    );
    const pool = partDispatches.length > 0
      ? partDispatches
      : printDispatches.filter((d) => d.model_id === model.id);

    if (pool.length === 0) return null;

    // Prefer received dispatch, then latest by received_at / dispatched_at
    const sorted = [...pool].sort((a, b) => {
      const aRec = a.received_at ? 1 : 0;
      const bRec = b.received_at ? 1 : 0;
      if (bRec !== aRec) return bRec - aRec;
      return String(b.received_at || b.dispatched_at || '').localeCompare(
        String(a.received_at || a.dispatched_at || '')
      );
    });
    const disp = sorted[0];
    const workshopName = (disp.shop_name || '').trim();
    if (!workshopName) return null;
    const matchedW = workshops.find((w) => w.name === workshopName);
    const existingEvaluation =
      workshopEvaluations.find(
        (ev) => ev.stage === 'printing' && ev.print_dispatch_id === disp.id
      ) ||
      workshopEvaluations.find(
        (ev) =>
          ev.stage === 'printing' &&
          ev.model_id === model.id &&
          ev.workshop_name === workshopName
      ) ||
      null;

    return {
      stage: 'printing',
      workshopId: matchedW?.id,
      workshopName,
      dispatchedAt: disp.dispatched_at,
      receivedAt: disp.received_at,
      expectedDate: disp.expected_delivery_date,
      printDispatchId: disp.id,
      existingEvaluation
    };
  }

  if (stage === 'after_sewing') {
    const partDispatches = sewingDispatches.filter(
      (d) => d.model_id === model.id && normalizePartKey(d.piece_type) === part
    );
    const pool = partDispatches.length > 0
      ? partDispatches
      : sewingDispatches.filter((d) => d.model_id === model.id);

    if (pool.length > 0) {
      const sorted = [...pool].sort((a, b) => {
        const aRec = a.received_at ? 1 : 0;
        const bRec = b.received_at ? 1 : 0;
        if (bRec !== aRec) return bRec - aRec;
        return String(b.received_at || b.dispatched_at || '').localeCompare(
          String(a.received_at || a.dispatched_at || '')
        );
      });
      const disp = sorted[0];
      const workshopName = (disp.workshop_name || '').trim();
      if (!workshopName) return null;
      const matchedW = workshops.find((w) => w.name === workshopName);
      const existingEvaluation =
        workshopEvaluations.find(
          (ev) => ev.stage === 'sewing' && ev.sewing_dispatch_id === disp.id
        ) ||
        workshopEvaluations.find(
          (ev) =>
            ev.stage === 'sewing' &&
            ev.model_id === model.id &&
            ev.workshop_name === workshopName
        ) ||
        null;

      return {
        stage: 'sewing',
        workshopId: matchedW?.id,
        workshopName,
        dispatchedAt: disp.dispatched_at,
        receivedAt: disp.received_at,
        expectedDate: disp.expected_delivery_date,
        sewingDispatchId: disp.id,
        existingEvaluation
      };
    }

    // Legacy fallback on model fields if no SewingDispatch row exists
    const fallbackWorkshop = (
      part === 'shirt'
        ? model.sewing_shirt_workshop || model.sewing_workshop
        : part === 'pants'
        ? model.sewing_pants_workshop || model.sewing_workshop
        : model.sewing_workshop
    )?.trim();
    if (!fallbackWorkshop) return null;
    const matchedW = workshops.find((w) => w.name === fallbackWorkshop);
    const existingEvaluation =
      workshopEvaluations.find(
        (ev) =>
          ev.stage === 'sewing' &&
          ev.model_id === model.id &&
          ev.workshop_name === fallbackWorkshop
      ) || null;
    return {
      stage: 'sewing',
      workshopId: matchedW?.id,
      workshopName: fallbackWorkshop,
      expectedDate:
        part === 'shirt'
          ? model.sewing_shirt_expected_date || model.sewing_expected_date
          : part === 'pants'
          ? model.sewing_pants_expected_date || model.sewing_expected_date
          : model.sewing_expected_date,
      existingEvaluation
    };
  }

  return null;
}
