import React, { useEffect, useState } from 'react';
import { Crop as CropIcon, FileText, Link2, Printer, RotateCcw, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getPartLabel, ImageCropRegion, PrintDispatch } from '../types';
import { printPrintShopOrder, PrintShopOrderOptions } from '../utils/printPrintShopOrder';
import { CroppedImage, ImageCropperModal } from './ImageCropperModal';
import { isImageLogo } from '../utils/printShared';

interface PrintShopOrderModalProps {
  dispatch: PrintDispatch;
  onClose: () => void;
}

/** صف بيانات واحد داخل معاينة الورقة (نفس تنسيق ورقة الطباعة). */
const Field: React.FC<{ label: string; value?: React.ReactNode; full?: boolean }> = ({
  label,
  value,
  full
}) => (
  <div
    className={`flex items-center justify-between gap-2 border-b border-dotted border-slate-300 py-1 ${
      full ? 'col-span-2' : ''
    }`}
  >
    <span className="text-[11px] font-bold text-slate-500 whitespace-nowrap">{label}</span>
    <span className="text-[12px] font-black text-slate-900 text-left break-words">
      {value ?? '—'}
    </span>
  </div>
);

export const PrintShopOrderModal: React.FC<PrintShopOrderModalProps> = ({
  dispatch,
  onClose
}) => {
  const { models, getModelSizeList, sizeDefs, globalSettings } = useApp();

  const model = models.find((item) => item.id === dispatch.model_id) || null;

  // قص مؤقت للصورة (لا يُحفظ على الموديل — لتحسين ظهور الرسمة في الورقة فقط).
  const [crop, setCrop] = useState<ImageCropRegion | null>(null);
  const [cropOpen, setCropOpen] = useState(false);

  useEffect(() => {
    setCrop(null);
    setCropOpen(false);
  }, [dispatch.id]);

  const pieceLabel = dispatch.piece_label || getPartLabel(dispatch.piece_type || 'shirt');
  const sizes = model ? getModelSizeList(model.id) : [];
  const sizeCategoryName =
    sizeDefs.find((definition) => definition.id === model?.size_category_id)?.name || '';
  const siteName = globalSettings?.site_name || 'مصنع الملابس الجاهزة';
  const logo = globalSettings?.logo || '';
  const markerUrl = model?.print_marker_url || '';

  const options: PrintShopOrderOptions = {
    siteName,
    logo,
    modelCode: model?.model_code || '—',
    modelType: model?.model_type,
    sizeCategoryName,
    sizes,
    imageUrl: model?.image,
    imageCrop: crop,
    printMarkerUrl: markerUrl,
    shopName: dispatch.shop_name,
    pieceLabel,
    printLocation: dispatch.print_location,
    printDetails: dispatch.print_details,
    piecesCount: dispatch.pieces_count,
    dispatchDate: dispatch.dispatched_at,
    expectedDate: dispatch.expected_delivery_date,
    notes: dispatch.notes
  };

  const hasImage = !!model?.image;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl max-w-4xl w-full p-5 shadow-2xl border border-slate-100 flex flex-col max-h-[94vh]">
          {/* هيدر النافذة */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-200 gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-teal-100 text-teal-700 flex items-center justify-center">
                <Printer className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-black text-slate-900 text-lg">
                  أوردر مطبعة: موديل {options.modelCode}
                </h3>
                <p className="text-xs text-slate-500">
                  ورقة A4 جاهزة للطباعة أو الحفظ PDF — صورة كبيرة للموديل + رابط ماركر الطباعة + بيانات
                  الأوردر كاملة.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => printPrintShopOrder(options)}
                className="px-5 py-2 rounded-full bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs shadow-xs transition flex items-center gap-2 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة / حفظ PDF</span>
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

          {/* معاينة الورقة (Scrollable) */}
          <div className="mt-3 overflow-y-auto flex-grow rounded-xl bg-slate-100/70 p-3">
            <div className="bg-white rounded-lg border-2 border-slate-800 p-4 mx-auto max-w-3xl">
              {/* رأس الورقة */}
              <div className="text-center border-b-[3px] border-double border-slate-900 pb-2 mb-3">
                <div className="flex justify-center mb-1">
                  {isImageLogo(logo) ? (
                    <img src={logo} alt={siteName} className="h-12 object-contain" />
                  ) : (
                    <span className="text-sm font-black text-slate-900">{logo || siteName}</span>
                  )}
                </div>
                <h4 className="text-base font-black text-slate-900">
                  {siteName} — أوردر مطبعة / تطريز
                </h4>
                <p className="text-[12px] font-bold text-slate-600">
                  قسم المطابع والتطريز — أمر تشغيل {pieceLabel}
                </p>
              </div>

              {/* الصورة الكبيرة + أدوات القص */}
              <div className="mb-3">
                <div className="flex flex-wrap items-center justify-center gap-2 mb-2 print:hidden">
                  <button
                    type="button"
                    disabled={!hasImage}
                    onClick={() => setCropOpen(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-slate-700 text-[11px] font-bold hover:bg-slate-100 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <CropIcon className="w-3 h-3" />
                    <span>قص / تحريك صورة الموديل</span>
                  </button>
                  {crop && (
                    <button
                      type="button"
                      onClick={() => setCrop(null)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-300 text-amber-800 text-[11px] font-bold hover:bg-amber-100 transition cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>🔄 إعادة تعيين الصورة الأصلية</span>
                    </button>
                  )}
                </div>

                <div
                  className="w-full flex items-center justify-center bg-slate-50 border-[1.5px] border-slate-800 rounded-lg overflow-hidden px-2 py-2"
                  style={{ minHeight: 240 }}
                >
                  {hasImage ? (
                    <CroppedImage
                      src={model?.image || ''}
                      alt={options.modelCode}
                      crop={crop}
                      style={
                        crop
                          ? { width: '100%', maxWidth: 430, aspectRatio: `${crop.w} / ${crop.h}` }
                          : { maxHeight: 430, maxWidth: '100%', objectFit: 'contain' }
                      }
                    />
                  ) : (
                    <span className="text-xs font-bold text-slate-400">
                      لا توجد صورة مسجلة لهذا الموديل
                    </span>
                  )}
                </div>
              </div>

              {/* رابط الماركر (قابل للضغط) */}
              <div className="border-[1.5px] border-slate-800 rounded-lg px-3 py-2 mb-3 bg-teal-50">
                <div className="flex items-center gap-1.5 text-[11px] font-black text-slate-800 mb-1">
                  <Link2 className="w-3.5 h-3.5" />
                  <span>رابط ماركر / باترون الطباعة</span>
                </div>
                {markerUrl ? (
                  <a
                    href={markerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12px] font-black text-teal-800 underline break-all"
                  >
                    {markerUrl}
                  </a>
                ) : (
                  <span className="text-[11px] font-bold text-slate-400">
                    لم يتم تسجيل ماركر طباعة لهذا الموديل.
                  </span>
                )}
                <p className="text-[10px] text-slate-500 mt-1">
                  يظهر هذا الرابط كرابط نشط قابل للضغط داخل ملف الـ PDF المطبوع.
                </p>
              </div>

              {/* بيانات الأوردر */}
              <div className="grid grid-cols-2 gap-x-4 border-[1.5px] border-slate-800 rounded-lg px-3 py-2 mb-3">
                <Field label="كود الموديل" value={options.modelCode} />
                <Field label="نوع / فئة الموديل" value={options.modelType || 'غير محدد'} />
                <Field label="فئة المقاسات" value={sizeCategoryName || '—'} />
                <Field label="القطعة المرسلة" value={pieceLabel} />
                <Field
                  label="المقاسات المعتمدة"
                  full
                  value={
                    sizes.length > 0 ? (
                      <span className="flex flex-wrap justify-end gap-1">
                        {sizes.map((size) => (
                          <span
                            key={size}
                            className="px-1.5 py-0.5 rounded border border-slate-800 bg-slate-100 text-[10px] font-bold"
                          >
                            {size}
                          </span>
                        ))}
                      </span>
                    ) : (
                      'غير محددة'
                    )
                  }
                />
                <Field label="اسم المطبعة / الورشة" value={dispatch.shop_name} />
                <Field label="مكان الطباعة" value={dispatch.print_location || '—'} />
                <Field
                  label="عدد القطع المسلمة"
                  value={`${Number(dispatch.pieces_count || 0).toLocaleString('ar-EG')} قطعة`}
                />
                <Field label="تاريخ التسليم للمطبعة" value={dispatch.dispatched_at || '—'} />
                <Field
                  label="تاريخ الاستلام المتوقع"
                  value={dispatch.expected_delivery_date || 'حسب الاتفاق'}
                />
              </div>

              {/* تفاصيل الطباعة */}
              <div className="border-2 border-slate-800 rounded-lg px-3 py-2 mb-3 bg-slate-50">
                <div className="flex items-center gap-1.5 text-[11px] font-black text-slate-700 mb-1">
                  <FileText className="w-3.5 h-3.5" />
                  <span>تفاصيل الطباعة / التطريز</span>
                </div>
                <div className="text-[12px] font-black text-slate-900 whitespace-pre-wrap">
                  {dispatch.print_details || 'لم تُسجل تفاصيل إضافية.'}
                </div>
              </div>

              {/* الملاحظات */}
              {dispatch.notes && (
                <div className="border-[1.5px] border-slate-800 rounded-lg px-3 py-2">
                  <div className="text-[11px] font-black text-slate-700 mb-1">📝 ملاحظات التشغيل</div>
                  <div className="text-[12px] font-semibold text-slate-800 whitespace-pre-wrap">
                    {dispatch.notes}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {cropOpen && model?.image && (
        <ImageCropperModal
          imageUrl={model.image}
          pieceLabel={pieceLabel}
          initialCrop={crop}
          onApply={(region) => setCrop(region)}
          onReset={() => setCrop(null)}
          onClose={() => setCropOpen(false)}
        />
      )}
    </>
  );
};

