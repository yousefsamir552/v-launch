import React from 'react';
import { Crop as CropIcon, RotateCcw } from 'lucide-react';
import type { ImageCropRegion, ModelAccessory } from '../types';
import { toLatinDigits } from '../utils/latinDigits';
import { isImageLogo } from '../utils/printShared';
import { CroppedImage } from './ImageCropperModal';

/** البيانات الكاملة اللازمة لورقة المكن الواحدة (تيشرت أو بنطلون أو جاكيت). */
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
  Math.round(Number.isFinite(value) ? value : 0).toLocaleString('en-US');

/** يحافظ على الكسور العشرية للاستهلاك لكل قطعة (مثل 0.4 متر) بدون تصفيرها بـ Math.round. */
const fmtDecimal = (value: number): string =>
  (Number.isFinite(value) ? Number(value.toFixed(3)) : 0).toLocaleString('en-US', {
    maximumFractionDigits: 3
  });

/** إجمالي الإكسسوار المطلوب يُقرّب للأعلى (Math.ceil) لضمان عدم العجز. */
const fmtTotalCeil = (value: number): string =>
  Math.ceil(Number.isFinite(value) && value > 0 ? value : 0).toLocaleString('en-US');

const Field: React.FC<{
  label: string;
  value: string;
  strong?: boolean;
  highlight?: boolean;
}> = ({ label, value, strong, highlight }) => (
  <div
    className={`flex items-baseline justify-between gap-2 border-b border-dotted border-slate-300 px-1.5 py-1 ${
      highlight ? 'bg-slate-50 rounded-md' : ''
    }`}
  >
    <span className="text-slate-500 font-bold whitespace-nowrap">{label}</span>
    <span
      className={`font-black text-slate-900 text-start tabular-nums ${
        strong ? 'text-[13.5px]' : ''
      }`}
    >
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
  const hasDesignNotes = Boolean(data.designNotes && data.designNotes.trim());
  const hasPieceNotes = Boolean(data.pieceNotes && data.pieceNotes.trim());
  const cropRatio =
    data.crop && data.crop.h > 0 ? data.crop.w / data.crop.h : 1;

  return (
    <div
      className={`bg-white border border-slate-300 rounded-xl p-4 sm:p-5 text-slate-900 shadow-xs ${
        isLast ? '' : 'print-page-break'
      }`}
    >
      {/* 1. ترويسة علوية مدمجة ونظيفة */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-slate-900 pb-2.5 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {isImageLogo(data.logo) ? (
            <img
              src={data.logo}
              alt={data.siteName}
              className="h-10 w-auto max-w-[130px] object-contain shrink-0"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <span className="text-2xl leading-none shrink-0">{data.logo || '🏭'}</span>
          )}
          <div className="min-w-0">
            <div className="text-sm font-black text-slate-900 leading-tight truncate">
              {data.siteName}
            </div>
            <div className="text-[10px] font-bold text-slate-500">
              نظام إدارة الإنتاج والمصنع
            </div>
          </div>
        </div>

        <div className="text-center flex-1 min-w-[200px]">
          <h4 className="text-base sm:text-lg font-black leading-snug text-slate-900">
            أمر تشغيل ورشة المكن — ورقة {data.pieceLabel}
          </h4>
          <p className="text-[11px] font-bold text-slate-600">قسم الخياطة والمكن</p>
        </div>

        <div className="text-end text-[11px] font-bold text-slate-600 shrink-0 tabular-nums">
          <div>
            الموديل: <strong className="text-slate-900">{toLatinDigits(data.modelCode)}</strong>
          </div>
        </div>
      </div>

      {/* 2. النصف العلوي: مربع صورة الموديل بحجم كبير وواضح */}
      <div className="mb-3">
        <div
          className="relative w-full h-[360px] sm:h-[440px] rounded-xl border-[1.5px] border-slate-800 bg-white p-2.5 flex items-center justify-center overflow-hidden"
          style={{ containerType: 'size' }}
        >
          {data.imageUrl ? (
            data.crop ? (
              <CroppedImage
                src={data.imageUrl}
                alt={data.modelCode}
                crop={data.crop}
                style={{
                  width: `min(100cqw, calc(100cqh * ${cropRatio}))`,
                  height: `min(100cqh, calc(100cqw / ${cropRatio}))`
                }}
              />
            ) : (
              <img
                src={data.imageUrl}
                alt={data.modelCode}
                className="w-full h-full object-contain bg-white"
              />
            )
          ) : (
            <span className="text-xs font-bold text-slate-400">لا توجد صورة للموديل</span>
          )}
        </div>

        {/* شريط أدوات قص الصورة (للمعاينة فقط ولا يُطبع) */}
        <div className="print:hidden mt-2 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onEditImage}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-700 transition cursor-pointer"
          >
            <CropIcon className="w-3.5 h-3.5" />
            <span>✂️ تعديل / قص الصورة</span>
          </button>
          {hasCustomImage && (
            <button
              type="button"
              onClick={onResetImage}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-100 border border-amber-300 text-amber-900 text-xs font-bold hover:bg-amber-200 transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>إعادة تعيين الصورة الأصلية</span>
            </button>
          )}
        </div>
      </div>

      {/* 3. النصف السفلي: بطاقة البيانات الأساسية */}
      <div className="border-[1.5px] border-slate-800 rounded-lg p-3 mb-2.5 bg-white">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5 text-[12px]">
          <Field label="كود الموديل" value={toLatinDigits(data.modelCode)} />
          <Field label="نوع الموديل" value={data.modelType || 'غير محدد'} />
          <Field label="القطعة" value={data.pieceLabel} />
          <Field
            label="فئة المقاسات"
            value={toLatinDigits(data.sizeCategoryName || '—')}
          />
          <Field
            label="العدد المسلم للورشة"
            value={`${fmt(data.piecesCount)} قطعة`}
            strong
            highlight
          />
          <Field
            label="اسم الورشة"
            value={data.workshopName || 'لم يُرسل للورشة بعد'}
          />
          <Field
            label="تاريخ التسليم للورشة"
            value={toLatinDigits(data.dispatchDate || '—')}
          />
          <Field
            label="تاريخ الاستلام المتوقع"
            value={toLatinDigits(data.expectedDate || '—')}
          />
          <div className="sm:col-span-2 flex items-baseline justify-between gap-2 border-b border-dotted border-slate-300 px-1.5 py-1">
            <span className="text-slate-500 font-bold whitespace-nowrap">المقاسات المعتمدة</span>
            <span className="flex flex-wrap gap-1 justify-end tabular-nums">
              {data.sizes.length > 0 ? (
                data.sizes.map((size) => (
                  <span
                    key={size}
                    className="px-1.5 py-0.5 border border-slate-500 rounded text-[11px] font-black bg-slate-50"
                  >
                    {toLatinDigits(size)}
                  </span>
                ))
              ) : (
                <span className="text-slate-400 font-bold">غير محددة</span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* ملاحظات التصميم وخياطة القطعة */}
      {(hasDesignNotes || hasPieceNotes) && (
        <div
          className={`grid gap-2 mb-2.5 ${
            hasDesignNotes && hasPieceNotes ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'
          }`}
        >
          {hasDesignNotes && (
            <div className="border-[1.5px] border-slate-800 rounded-lg px-3 py-2 bg-slate-50/60 break-inside-avoid">
              <div className="text-[11.5px] font-black mb-0.5">📝 ملاحظات التصميم</div>
              <div className="text-[11.5px] whitespace-pre-wrap text-slate-800 leading-relaxed">
                {toLatinDigits(data.designNotes)}
              </div>
            </div>
          )}

          {hasPieceNotes && (
            <div className="border-[1.5px] border-slate-800 rounded-lg px-3 py-2 bg-slate-50/60 break-inside-avoid">
              <div className="text-[11.5px] font-black mb-0.5">
                ✂️ ملاحظات خياطة {data.pieceLabel}
              </div>
              <div className="text-[11.5px] whitespace-pre-wrap text-slate-800 leading-relaxed">
                {toLatinDigits(data.pieceNotes)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* جدول الإكسسوارات */}
      <h5 className="text-[12.5px] font-black bg-slate-100 border-[1.5px] border-slate-800 rounded-md px-2.5 py-1 my-2">
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
            <th className="border-[1.2px] border-slate-800 px-1 py-1.5 text-start">
              اسم الإكسسوار
            </th>
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
                  <td className="border-[1.2px] border-slate-800 px-1 py-1.5 text-center tabular-nums">
                    {index + 1}
                  </td>
                  <td className="border-[1.2px] border-slate-800 px-2 py-1.5 text-start font-bold">
                    {accessory.accessory_name || accessory.accessory_code || '—'}
                  </td>
                  <td className="border-[1.2px] border-slate-800 px-1 py-1.5 text-center font-mono">
                    {toLatinDigits(accessory.accessory_code || '—')}
                  </td>
                  <td className="border-[1.2px] border-slate-800 px-1 py-1.5 text-center tabular-nums">
                    {fmtDecimal(per)}
                  </td>
                  <td className="border-[1.2px] border-slate-800 px-1 py-1.5 text-center">
                    {accessory.unit || 'قطعة'}
                  </td>
                  <td className="border-[1.2px] border-slate-800 px-1 py-1.5 text-center font-black tabular-nums">
                    {fmtTotalCeil(per * data.piecesCount)}
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td
                colSpan={6}
                className="border-[1.2px] border-slate-800 px-2 py-2 text-center text-slate-400 font-bold"
              >
                لا توجد إكسسوارات مسجلة لهذه القطعة.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* التعليمات الثابتة */}
      {data.fixedInstructions && (
        <div className="border-[1.5px] border-slate-800 rounded-lg px-3 py-2 mt-2.5 break-inside-avoid">
          <div className="text-[11.5px] font-black mb-0.5">
            📌 التعليمات والملاحظات الثابتة المعتمدة
          </div>
          <div className="text-[11.5px] whitespace-pre-wrap text-slate-800 leading-relaxed">
            {toLatinDigits(data.fixedInstructions)}
          </div>
        </div>
      )}

      {/* شريط التوقيعات بالمربعات الكبيرة */}
      <div className="grid grid-cols-3 gap-2.5 mt-3 break-inside-avoid">
        {['مسؤول التسليم والتشغيل', 'توقيع مستلم ورشة المكن', 'اعتماد مشرف الإنتاج'].map((label) => (
          <div
            key={label}
            className="border border-slate-500 rounded-md px-2 py-2.5 text-center bg-white min-h-[82px] flex flex-col justify-between"
          >
            <div className="text-[11px] font-black text-slate-800">{label}</div>
            <div className="flex-1 min-h-[48px]" />
            <div className="border-t border-dashed border-slate-400 w-4/5 mx-auto" />
          </div>
        ))}
      </div>
    </div>
  );
};
