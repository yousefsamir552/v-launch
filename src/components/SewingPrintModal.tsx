import React, { useEffect, useState } from 'react';
import { FileText, Printer, RotateCcw, Save, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { GarmentPart, getPartLabel, ImageCropRegion, Model, QCRecord, SewingDispatch } from '../types';
import { formatLatinDate, toLatinDigits } from '../utils/latinDigits';
import { printSewingSheets, SewingSheetOptions } from '../utils/printSewingSheet';
import { ImageCropperModal } from './ImageCropperModal';
import { SewingSheetData, SewingSheetPreview } from './SewingSheetPreview';

/**
 * يحسب العدد الاحتياطي الدقيق لقطعة واحدة عندما لا يوجد لها SewingDispatch بعد:
 * 1) model.sewing_available?.[part]
 * 2) آخر عدّ سليم للقطعة في qcRecords (after_print ثم before_print)
 * 3) model.cut_summary?.[part] (أو حقول القص الخاصة بالقطعة)
 * 4) model.target_cut_quantity
 */
export const resolvePartSewingFallbackCount = (
  model: Model,
  part: GarmentPart,
  qcRecords: QCRecord[]
): number => {
  const safePos = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  };

  const fromAvailable = safePos(model.sewing_available?.[part]);
  if (fromAvailable > 0) return fromAvailable;

  const sumQcStage = (stage: 'after_print' | 'before_print'): number =>
    qcRecords.reduce((sum, rec) => {
      if (rec.model_id !== model.id || rec.stage !== stage) return sum;
      const recPart = (rec.part_type || rec.partType || 'shirt') as string;
      if (recPart !== part) return sum;
      return sum + safePos(rec.good_qty ?? rec.counted_pieces);
    }, 0);

  const afterPrintGood = sumQcStage('after_print');
  if (afterPrintGood > 0) return afterPrintGood;

  const beforePrintGood = sumQcStage('before_print');
  if (beforePrintGood > 0) return beforePrintGood;

  const fromCutSummary = safePos(model.cut_summary?.[part]);
  if (fromCutSummary > 0) return fromCutSummary;

  const legacyCut =
    part === 'shirt'
      ? safePos(model.cut_shirt_pieces)
      : part === 'pants'
        ? safePos(model.cut_pants_pieces)
        : part === 'jacket'
          ? safePos(model.cut_jacket_pieces)
          : 0;
  if (legacyCut > 0) return legacyCut;

  return safePos(model.target_cut_quantity);
};

/** يبحث عن تشغيلة المكن الأنسب لقطعة محددة (النشطة أولاً ثم الأحدث). */
export const findPartSewingDispatch = (
  dispatches: SewingDispatch[],
  modelId: string,
  part: GarmentPart
): SewingDispatch | null => {
  const matching = dispatches.filter((d) => d.model_id === modelId && d.piece_type === part);
  if (matching.length === 0) return null;
  const open = matching.find((d) => d.status !== 'تم الاستلام');
  return open || matching[matching.length - 1] || null;
};

interface SewingPrintModalProps {
  model: Model;
  initialTab: 'both' | GarmentPart;
  onClose: () => void;
}

const DEFAULT_SEWING_INSTRUCTIONS =
  'تم التأكد من أعداد الإكسسوارات ومطابقتها للتشغيلة قبل التسليم للورشة. يرجى الالتزام التام بالمقاسات المعتمدة وتسليم العينة الأولى للفحص.';

export const SewingPrintModal: React.FC<SewingPrintModalProps> = ({
  model,
  initialTab,
  onClose
}) => {
  const {
    modelAccessories,
    getModelSizeList,
    getModelParts,
    sewingDispatches,
    qcRecords,
    sizeDefs,
    globalSettings,
    updateGlobalSettings,
    canAddSewingNotes,
    canEditMessageTemplates
  } = useApp();

  const defaultInstructions =
    globalSettings.default_sewing_instructions || DEFAULT_SEWING_INSTRUCTIONS;

  const modelParts = getModelParts(model.id);
  const availableParts: GarmentPart[] = modelParts.length > 0 ? modelParts : ['shirt', 'pants'];

  const [tab, setTab] = useState<'both' | GarmentPart>(initialTab || 'both');
  const [instructions, setInstructions] = useState(defaultInstructions);
  const [saving, setSaving] = useState(false);
  const [crops, setCrops] = useState<Partial<Record<GarmentPart, ImageCropRegion>>>({});
  const [cropTarget, setCropTarget] = useState<GarmentPart | null>(null);

  useEffect(() => {
    setInstructions(defaultInstructions);
  }, [defaultInstructions]);

  useEffect(() => {
    setCrops({});
    setCropTarget(null);
    setTab(initialTab || 'both');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.id]);

  const allowSewingNotes = canAddSewingNotes();
  const canEditPrintInstructions = allowSewingNotes || canEditMessageTemplates();

  const handleSaveAsDefault = async () => {
    setSaving(true);
    try {
      await updateGlobalSettings({ default_sewing_instructions: instructions.trim() });
    } finally {
      setSaving(false);
    }
  };

  const buildSheet = (piece: GarmentPart): SewingSheetData => {
    const dispatch = findPartSewingDispatch(sewingDispatches, model.id, piece);

    const fallbackPieces = resolvePartSewingFallbackCount(model, piece, qcRecords);

    // إذا وُجد SewingDispatch لهذه القطعة نستخدم بياناته مباشرة؛
    // وإلا نعرض عدد القطعة الاحتياطي الدقيق دون سحب اسم ورشة أو تاريخ استلام قطعة أخرى.
    const piecesCount =
      dispatch && Number(dispatch.pieces_count) > 0
        ? Number(dispatch.pieces_count)
        : fallbackPieces;

    const workshopName = dispatch
      ? dispatch.workshop_name || '—'
      : 'لم يُرسل للورشة بعد';

    const dispatchDate = dispatch?.dispatched_at
      ? toLatinDigits(dispatch.dispatched_at)
      : formatLatinDate(new Date());

    const expectedDate = dispatch
      ? toLatinDigits(dispatch.expected_delivery_date || 'حسب الاتفاق')
      : '—';

    const fallbackNotes =
      piece === 'shirt'
        ? model.notes_shirt
        : piece === 'pants'
          ? model.notes_pants
          : piece === 'jacket'
            ? model.notes_jacket
            : model.design_notes;

    return {
      pieceType: piece,
      pieceLabel: getPartLabel(piece),
      modelCode: model.model_code,
      modelType: model.model_type || 'غير محدد',
      sizeCategoryName:
        sizeDefs.find((definition) => definition.id === model.size_category_id)?.name || '',
      sizes: getModelSizeList(model.id),
      imageUrl: model.image,
      crop: crops[piece] || null,
      piecesCount,
      workshopName,
      dispatchDate,
      expectedDate,
      accessories: modelAccessories.filter(
        (accessory) => accessory.model_id === model.id && accessory.target_type === piece
      ),
      designNotes: model.design_notes || '',
      pieceNotes: dispatch?.notes || fallbackNotes || '',
      fixedInstructions: instructions,
      siteName: globalSettings.site_name || 'مصنع الملابس الجاهزة',
      logo: globalSettings.logo || ''
    };
  };

  const sheetParts: GarmentPart[] =
    tab === 'both'
      ? availableParts
      : [tab];

  const handlePrint = () => {
    const sheets: SewingSheetOptions[] = sheetParts.map((piece) => {
      const sheet = buildSheet(piece);
      return {
        siteName: sheet.siteName,
        logo: sheet.logo,
        modelCode: sheet.modelCode,
        modelType: sheet.modelType,
        sizeCategoryName: sheet.sizeCategoryName,
        sizes: sheet.sizes,
        imageUrl: sheet.imageUrl,
        imageCrop: sheet.crop,
        pieceType: sheet.pieceType,
        pieceLabel: sheet.pieceLabel,
        piecesCount: sheet.piecesCount,
        workshopName: sheet.workshopName,
        dispatchDate: sheet.dispatchDate,
        expectedDate: sheet.expectedDate,
        accessories: sheet.accessories,
        designNotes: sheet.designNotes,
        pieceNotes: sheet.pieceNotes,
        fixedInstructions: sheet.fixedInstructions
      };
    });

    printSewingSheets(sheets);
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
        <div className="bg-white rounded-3xl w-[95vw] sm:w-full max-w-5xl p-3 sm:p-5 shadow-2xl border border-slate-100 flex flex-col max-h-[90vh] overflow-hidden">
          {/* هيدر النافذة */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-200 gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <Printer className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-black text-slate-900 text-lg">
                  أمر تشغيل ورشة المكن: موديل {model.model_code}
                </h3>
                <p className="text-xs text-slate-500">
                  ورقة مستقلة لكل قطعة بنفس تنسيق أوردر القص — صورة، بيانات، إكسسوارات، وتعليمات.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap items-center bg-slate-100 p-1 rounded-full border border-slate-200 print:hidden">
                <button
                  type="button"
                  onClick={() => setTab('both')}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition cursor-pointer ${
                    tab === 'both' ? 'bg-white text-emerald-800 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  كل القطع
                </button>
                {availableParts.map((part) => (
                  <button
                    key={part}
                    type="button"
                    onClick={() => setTab(part)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition cursor-pointer ${
                      tab === part ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    ورقة {getPartLabel(part)}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={handlePrint}
                className="px-5 py-2 rounded-full bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-xs transition flex items-center gap-2 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة الآن</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* شريط التعليمات الثابتة (غير قابل للطباعة) */}
          <div className="mt-3 p-3 rounded-2xl bg-slate-50 border border-slate-200 print:hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-1.5 text-xs font-black text-slate-700">
                <FileText className="w-4 h-4 text-emerald-700" />
                <span>نص التعليمات والملاحظات الثابتة في أسفل الورقة (يُسحب من الإعدادات العامة):</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setInstructions(defaultInstructions)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 text-[11px] font-bold hover:bg-slate-100 transition cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>استعادة النص الافتراضي</span>
                </button>
                {canEditMessageTemplates() && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleSaveAsDefault}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-700 text-white text-[11px] font-bold hover:bg-emerald-800 transition cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-3 h-3" />
                    <span>{saving ? 'جاري الحفظ...' : 'حفظ كافتراضي بالإعدادات العامة'}</span>
                  </button>
                )}
              </div>
            </div>
            {canEditPrintInstructions ? (
              <textarea
                rows={2}
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                placeholder="مثال: تم التأكد من أعداد الإكسسوارات ومطابقتها للتشغيلة..."
                className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-xs font-semibold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            ) : (
              <p className="text-xs font-semibold text-slate-700 bg-white px-3 py-2 rounded-xl border border-slate-200">
                {instructions}
              </p>
            )}
          </div>



          {/* الأوراق النظيفة */}
          <div className="mt-3 overflow-y-auto flex-grow rounded-xl bg-slate-100/70 p-3 space-y-6">
            {sheetParts.map((part, index) => (
              <React.Fragment key={part}>
                <SewingSheetPreview
                  data={buildSheet(part)}
                  onEditImage={() => setCropTarget(part)}
                  onResetImage={() =>
                    setCrops((prev) => {
                      const next = { ...prev };
                      delete next[part];
                      return next;
                    })
                  }
                  hasCustomImage={!!crops[part]}
                  isLast={index === sheetParts.length - 1}
                />
                {index < sheetParts.length - 1 && (
                  <div className="print:hidden text-center text-[11px] font-black text-slate-400">
                    — فاصل صفحة الطباعة —
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {cropTarget && (
        <ImageCropperModal
          imageUrl={model.image}
          pieceLabel={getPartLabel(cropTarget)}
          initialCrop={crops[cropTarget] || null}
          onApply={(region) => setCrops((prev) => ({ ...prev, [cropTarget]: region }))}
          onReset={() =>
            setCrops((prev) => {
              const next = { ...prev };
              delete next[cropTarget];
              return next;
            })
          }
          onClose={() => setCropTarget(null)}
        />
      )}
    </>
  );
};
