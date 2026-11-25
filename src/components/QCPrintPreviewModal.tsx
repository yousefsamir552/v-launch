import React, { useEffect, useState } from 'react';
import { Crop as CropIcon, ImageOff, Printer, RotateCcw, X } from 'lucide-react';
import { GarmentPart, ImageCropRegion, getPartLabel } from '../types';
import { CroppedImage, ImageCropperModal } from './ImageCropperModal';
import {
  ManualCountSheetPart,
  QCWorkerMatrixPart,
  normalizeQcBannerStageLabel,
  printManualCountSheet,
  printQCWorkerMatrixSheet
} from '../utils/printManualCountSheet';

export type QCPrintPreviewConfig =
  | {
      mode: 'manual';
      siteName?: string;
      logo?: string;
      imageUrl?: string;
      modelCode: string;
      modelType?: string;
      stageLabel: string;
      sizes: string[];
      parts: ManualCountSheetPart[];
      inspectorName?: string;
      notes?: string;
    }
  | {
      mode: 'worker_matrix';
      siteName?: string;
      logo?: string;
      imageUrl?: string;
      modelCode: string;
      modelType?: string;
      stageLabel: string;
      sizes: string[];
      parts: QCWorkerMatrixPart[];
      notes?: string;
    };

interface QCPrintPreviewModalProps {
  config: QCPrintPreviewConfig;
  onClose: () => void;
}

export const QCPrintPreviewModal: React.FC<QCPrintPreviewModalProps> = ({ config, onClose }) => {
  const [crop, setCrop] = useState<ImageCropRegion | null>(null);
  const [cropOpen, setCropOpen] = useState(false);

  useEffect(() => {
    setCrop(null);
    setCropOpen(false);
  }, [config.modelCode, config.stageLabel, config.mode]);

  const bannerLabel = normalizeQcBannerStageLabel(config.stageLabel);
  const partsSummary = config.parts.map((p) => getPartLabel(p.key as GarmentPart)).join(' + ');
  const hasImage = Boolean(config.imageUrl && String(config.imageUrl).trim());
  const isManual = config.mode === 'manual';

  const handleConfirmPrint = () => {
    if (config.mode === 'manual') {
      printManualCountSheet({
        ...config,
        imageCrop: crop
      });
    } else {
      printQCWorkerMatrixSheet({
        ...config,
        imageCrop: crop
      });
    }
    onClose();
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-3xl w-[95vw] sm:w-full max-w-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-purple-600 text-white flex items-center justify-center shrink-0">
                <Printer className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-black text-slate-900 text-base truncate">
                  {isManual ? 'معاينة ورقة الجرد اليدوي (فارغة)' : 'معاينة ورقة مصفوفة الفرز للعامل'}
                </h3>
                <p className="text-[11px] text-slate-500">
                  يمكنك قص جزء محدد من صورة الموديل (مثلاً التيشرت أو البنطلون فقط) قبل الطباعة في صفحة A4 واحدة.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-200/70 hover:bg-slate-300/70 text-slate-600 flex items-center justify-center cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 overflow-y-auto space-y-4">
            {/* Prominent Bold Stage Banner Preview */}
            <div className="rounded-2xl bg-slate-900 text-white px-4 py-3 flex items-center justify-center gap-3 shadow-xs">
              <span className="px-2.5 py-0.5 rounded-full bg-white text-slate-900 text-[11px] font-black">
                مرحلة الفرز والعد
              </span>
              <span className="text-xl font-black tracking-tight">{bannerLabel}</span>
            </div>

            {/* Image + Cropper Controls + Model Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-4 items-start bg-slate-50 rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-col items-center gap-2">
                <div className="w-40 h-40 rounded-2xl bg-white border border-slate-200 overflow-hidden flex items-center justify-center p-1.5 shadow-2xs">
                  {hasImage ? (
                    <CroppedImage
                      src={config.imageUrl!}
                      alt={config.modelCode}
                      crop={crop}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-slate-400 text-xs font-bold">
                      <ImageOff className="w-6 h-6 text-slate-300" />
                      <span>بدون صورة</span>
                    </div>
                  )}
                </div>

                {hasImage && (
                  <div className="flex flex-wrap items-center justify-center gap-1.5 w-full">
                    <button
                      type="button"
                      onClick={() => setCropOpen(true)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-black transition cursor-pointer"
                    >
                      <CropIcon className="w-3.5 h-3.5" />
                      <span>{crop ? 'تعديل القص' : 'قص الصورة'}</span>
                    </button>
                    {crop && (
                      <button
                        type="button"
                        onClick={() => setCrop(null)}
                        className="inline-flex items-center justify-center p-1.5 rounded-xl bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-900 transition cursor-pointer"
                        title="إعادة تعيين الصورة الأصلية"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-white border border-slate-200 p-2.5">
                    <span className="text-[10px] font-bold text-slate-400 block">كود الموديل</span>
                    <strong className="text-sm font-black text-slate-900">{config.modelCode}</strong>
                  </div>
                  <div className="rounded-xl bg-white border border-slate-200 p-2.5">
                    <span className="text-[10px] font-bold text-slate-400 block">نوع الموديل</span>
                    <strong className="text-sm font-black text-slate-900">
                      {config.modelType || '—'}
                    </strong>
                  </div>
                </div>

                <div className="rounded-xl bg-white border border-slate-200 p-2.5 space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 block">القطع المشمولة بالورقة</span>
                  <strong className="text-xs font-black text-slate-800">{partsSummary || '—'}</strong>
                </div>

                <div className="rounded-xl bg-white border border-slate-200 p-2.5 space-y-1.5">
                  <span className="text-[10px] font-bold text-slate-400 block">
                    المقاسات ({config.sizes.length})
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {(config.sizes.length > 0 ? config.sizes : ['S', 'M', 'L', 'XL']).map((sz) => (
                      <span
                        key={sz}
                        className="px-2 py-0.5 rounded-md bg-purple-50 text-purple-800 border border-purple-200 font-mono font-bold text-[11px]"
                      >
                        {sz}
                      </span>
                    ))}
                  </div>
                </div>

                {crop && (
                  <p className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-1.5">
                    ✂️ تم تطبيق قص مؤقت للصورة — سيظهر الجزء المقصوص بوضوح على الورقة المطبوعة (دون تغيير صورة الموديل الأصلية).
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-200/80 hover:bg-slate-300/80 text-slate-700 text-xs font-bold cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="button"
              onClick={handleConfirmPrint}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-purple-700 hover:bg-purple-800 text-white text-xs font-black shadow-sm transition cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة / حفظ PDF (صفحة A4 واحدة)</span>
            </button>
          </div>
        </div>
      </div>

      {cropOpen && hasImage && (
        <ImageCropperModal
          imageUrl={config.imageUrl!}
          pieceLabel={`${config.modelCode} — ${partsSummary || bannerLabel}`}
          initialCrop={crop}
          onApply={(region) => {
            setCrop(region);
            setCropOpen(false);
          }}
          onReset={() => setCrop(null)}
          onClose={() => setCropOpen(false)}
        />
      )}
    </>
  );
};
