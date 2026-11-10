import React from 'react';
import { Crop as CropIcon, RotateCcw } from 'lucide-react';
import type { ImageCropRegion, ModelAccessory } from '../types';
import { isImageLogo } from '../utils/printShared';
import { CroppedImage } from './ImageCropperModal';

/** البيانات الكاملة اللازمة لورقة المكن الواحدة (تيشرت أو بنطلون). */
export interface SewingSheetData {
  pieceType: 'shirt' | 'pants' | 'jacket' | 'single';
  pieceLabel: string;
  modelCode: string;
  modelType: string;
  sizeCategoryName: string;
  sizes: string[];
  imageUrl: string;
  crop: ImageCropRegion | null;
  piecesCount: number;
  workshopName: string;
  dispatchDate: string;
  expectedDate: string;
  accessories: ModelAccessory[];
  designNotes: string;
  pieceNotes: string;
  fixedInstructions: string;
  siteName: string;
  logo: string;
}

interface SewingSheetPreviewProps {
  data: SewingSheetData;
  onEditImage: () => void;
  onResetImage: () => void;
  hasCustomImage: boolean;
  isLast: boolean;
}

const fmt = (value: number): string =>
  Math.round(Number.isFinite(value) ? value : 0).toLocaleString('ar-EG');

const Field: React.FC<{ label: string; value: string; strong?: boolean }> = ({
  label,
  value,
  strong
}) => (
  <div className="flex items-baseline justify-between gap-2 border-b border-dotted border-slate-300 px-0.5 py-1">
    <span className="text-slate-500 font-bold whitespace-nowrap">{label}</span>
    <span className={`font-black text-slate-900 text-start ${strong ? 'text-[13px]' : ''}`}>
      {value}
    </span>
  </div>
);

export const SewingSheetPreview: React.FC<SewingSheetPreviewProps> = ({
  data,
  onEditImage,
  onResetImage,
  hasCustomImage,
  isLast
}) => {
  return (
    <div
      className={`bg-white border border-slate-300 rounded-lg p-5 text-slate-900 ${
        isLast ? '' : 'print-page-break'
      }`}
    >
      {/* هيدر الورقة */}
      <div className="text-center border-b-[3px] border-double border-slate-800 pb-2 mb-3">
        <div className="flex items-center justify-center mb-1">
          {isImageLogo(data.logo) ? (
            <img
              src={data.logo}
              alt={data.siteName}
              className="h-12 w-auto max-w-[170px] object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <span className="text-3xl leading-none">{data.logo || '🏭'}</span>
          )}
        </div>
        <h4 className="text-lg font-black leading-snug">
          {data.siteName} — أمر تشغيل ورشة المكن
        </h4>
        <p className="text-xs font-bold text-slate-600 mt-0.5">
          قسم الخياطة والمكن — ورقة {data.pieceLabel}
        </p>
      </div>

      {/* بيانات الموديل */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch border-[1.5px] border-slate-800 rounded-lg p-3 mb-3">
        <div className="shrink-0 w-full sm:w-[190px] flex flex-col items-center gap-1.5">
          <div className="w-full flex items-center justify-center overflow-hidden rounded-md border border-slate-300 bg-slate-50 p-1">
            {data.crop ? (
              <CroppedImage
                src={data.imageUrl}
                alt={data.modelCode}
                crop={data.crop}
                className="w-full"
                style={{ width: '100%', aspectRatio: `${data.crop.w} / ${data.crop.h}` }}
              />
            ) : (
              <img
                src={data.imageUrl}
                alt={data.modelCode}
                className="w-full object-contain"
                style={{ maxHeight: 200 }}
              />
            )}
          </div>
          <button
            type="button"
            onClick={onEditImage}
            className="print:hidden inline-flex items-center justify-center gap-1 w-full px-2 py-1 rounded-md bg-slate-900 text-white text-[10px] font-bold hover:bg-slate-700 cursor-pointer"
          >
            <CropIcon className="w-3 h-3" /> تعديل / قص الصورة
          </button>
          {hasCustomImage && (
            <button
              type="button"
              onClick={onResetImage}
              className="print:hidden inline-flex items-center justify-center gap-1 w-full px-2 py-1 rounded-md bg-amber-100 border border-amber-300 text-amber-900 text-[10px] font-bold hover:bg-amber-200 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" /> إعادة تعيين الصورة الأصلية
            </button>
          )}
        </div>

        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-0.5 content-start text-[12px]">
          <Field label="كود الموديل" value={data.modelCode} />
          <Field label="نوع الموديل" value={data.modelType || '—'} />
          <Field label="فئة المقاسات" value={data.sizeCategoryName || '—'} />
          <Field label="القطعة" value={data.pieceLabel} />
          <div className="sm:col-span-2 flex items-baseline justify-between gap-2 border-b border-dotted border-slate-300 px-0.5 py-1">
            <span className="text-slate-500 font-bold whitespace-nowrap">المقاسات المعتمدة</span>
            <span className="flex flex-wrap gap-1 justify-end">
              {data.sizes.length > 0 ? (
                data.sizes.map((size) => (
                  <span
                    key={size}
                    className="px-1.5 py-0.5 border border-slate-500 rounded text-[11px] font-black bg-slate-50"
                  >
                    {size}
                  </span>
                ))
              ) : (
                <span className="text-slate-400 font-bold">غير محددة</span>
              )}
            </span>
          </div>
          <Field label="العدد المسلم للورشة" value={`${fmt(data.piecesCount)} قطعة`} strong />
          <Field label="اسم الورشة" value={data.workshopName || '—'} />
          <Field label="تاريخ التسليم للورشة" value={data.dispatchDate || '—'} />
          <Field label="تاريخ الاستلام المتوقع" value={data.expectedDate || 'حسب الاتفاق'} />
        </div>
      </div>

      {/* ملاحظات التصميم */}
      {data.designNotes && (
        <div className="border-[1.5px] border-slate-800 rounded-lg px-3 py-2 mb-2 break-inside-avoid">
          <div className="text-[12px] font-black mb-1">📝 ملاحظات التصميم</div>
          <div className="text-[12px] whitespace-pre-wrap text-slate-800 leading-relaxed">
            {data.designNotes}
          </div>
        </div>
      )}

      {/* ملاحظات خياطة القطعة */}
      {data.pieceNotes && (
        <div className="border-[1.5px] border-slate-800 rounded-lg px-3 py-2 mb-2 break-inside-avoid">
          <div className="text-[12px] font-black mb-1">✂️ ملاحظات خياطة {data.pieceLabel}</div>
          <div className="text-[12px] whitespace-pre-wrap text-slate-800 leading-relaxed">
            {data.pieceNotes}
          </div>
        </div>
      )}

      {/* جدول الإكسسوارات */}
      <h5 className="text-[13px] font-black bg-slate-100 border-[1.5px] border-slate-800 rounded-md px-2 py-1 my-2">
        إكسسوارات {data.pieceLabel} الخاصة
      </h5>
      <table className="w-full border-collapse text-[11.5px] table-fixed">
        <colgroup>
          <col style={{ width: '6%' }} />
          <col style={{ width: '34%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '18%' }} />
        </colgroup>
        <thead>
          <tr className="bg-slate-100">
            <th className="border-[1.2px] border-slate-800 px-1 py-1.5">#</th>
            <th className="border-[1.2px] border-slate-800 px-1 py-1.5 text-start">اسم الإكسسوار</th>
            <th className="border-[1.2px] border-slate-800 px-1 py-1.5">الكود</th>
            <th className="border-[1.2px] border-slate-800 px-1 py-1.5">الاستهلاك / قطعة</th>
            <th className="border-[1.2px] border-slate-800 px-1 py-1.5">الوحدة</th>
            <th className="border-[1.2px] border-slate-800 px-1 py-1.5">الإجمالي المطلوب</th>
          </tr>
        </thead>
        <tbody>
          {data.accessories.length > 0 ? (
            data.accessories.map((accessory, index) => {
              const per = Number(accessory.piece_consumption) || 1;
              return (
                <tr key={accessory.id} className="break-inside-avoid">
                  <td className="border-[1.2px] border-slate-800 px-1 py-1.5 text-center">
                    {index + 1}
                  </td>
                  <td className="border-[1.2px] border-slate-800 px-2 py-1.5 text-start font-bold">
                    {accessory.accessory_name || accessory.accessory_code || '—'}
                  </td>
                  <td className="border-[1.2px] border-slate-800 px-1 py-1.5 text-center">
                    {accessory.accessory_code || '—'}
                  </td>
                  <td className="border-[1.2px] border-slate-800 px-1 py-1.5 text-center">
                    {fmt(per)}
                  </td>
                  <td className="border-[1.2px] border-slate-800 px-1 py-1.5 text-center">
                    {accessory.unit || 'قطعة'}
                  </td>
                  <td className="border-[1.2px] border-slate-800 px-1 py-1.5 text-center font-black">
                    {fmt(per * data.piecesCount)}
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td
                colSpan={6}
                className="border-[1.2px] border-slate-800 px-2 py-2.5 text-center text-slate-400 font-bold"
              >
                لا توجد إكسسوارات مسجلة لهذه القطعة.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* التعليمات الثابتة */}
      {data.fixedInstructions && (
        <div className="border-[1.5px] border-slate-800 rounded-lg px-3 py-2 mt-3 break-inside-avoid">
          <div className="text-[12px] font-black mb-1">📌 التعليمات والملاحظات الثابتة المعتمدة</div>
          <div className="text-[12px] whitespace-pre-wrap text-slate-800 leading-relaxed">
            {data.fixedInstructions}
          </div>
        </div>
      )}
    </div>
  );
};
