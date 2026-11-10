import React, { useEffect, useState } from 'react';
import { FileText, Printer, RotateCcw, Save, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { GarmentPart, getPartLabel, ImageCropRegion, Model } from '../types';
import { printSewingSheets, SewingSheetOptions } from '../utils/printSewingSheet';
import { ImageCropperModal } from './ImageCropperModal';
import { SewingSheetData, SewingSheetPreview } from './SewingSheetPreview';

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
    const dispatch =
      sewingDispatches.find((d) => d.model_id === model.id && d.piece_type === piece) || null;

    const fallbackPieces =
      piece === 'shirt'
        ? model.sewing_shirt_pieces
        : piece === 'pants'
          ? model.sewing_pants_pieces
          : Number(model.sewing_available?.[piece] ?? 0);

    const fallbackWorkshop =
      piece === 'shirt'
        ? model.sewing_shirt_workshop || model.sewing_workshop
        : piece === 'pants'
          ? model.sewing_pants_workshop || model.sewing_workshop
          : model.sewing_workshop;

    const fallbackExpected =
      piece === 'shirt'
        ? model.sewing_shirt_expected_date || model.sewing_expected_date
        : piece === 'pants'
          ? model.sewing_pants_expected_date || model.sewing_expected_date
          : model.sewing_expected_date;

    const fallbackNotes =
      piece === 'shirt' ? model.notes_shirt : piece === 'pants' ? model.notes_pants : '';

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
      piecesCount: Number(dispatch?.pieces_count ?? fallbackPieces ?? 0) || 0,
      workshopName: dispatch?.workshop_name || fallbackWorkshop || '',
      dispatchDate: dispatch?.dispatched_at || new Date().toLocaleDateString('ar-EG'),
      expectedDate: dispatch?.expected_delivery_date || fallbackExpected || '',
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
      <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl max-w-5xl w-full p-5 shadow-2xl border border-slate-100 flex flex-col max-h-[94vh]">
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
