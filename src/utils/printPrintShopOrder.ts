/**
 * ورقة "أوردر مطبعة / تطريز" رسمية جاهزة للطباعة (A4) — تُحفظ كـ PDF وتُرسل للمطبعة:
 *  - هيدر موحّد بشعار المصنع من الإعدادات + اسم المصنع.
 *  - صورة الموديل بحجم ضخم (~نصف ورقة A4) مع دعم القص المؤقت (Crop) لإظهار تفاصيل الرسمة بوضوح تام.
 *  - رابط ماركر / باترون الطباعة كرابط نشط قابل للضغط داخل ملف الـ PDF.
 *  - بيانات أوردر المطبعة كاملة (الموديل، المقاسات، المطبعة، القطعة، مكان/تفاصيل الطباعة، العدد، التواريخ، الملاحظات).
 *
 * تتبع نفس نمط `printSewingSheet` في المشروع (نافذة مستقلة + document.write + window.print).
 */

import type { ImageCropRegion } from '../types';
import { escapeHtml, PRINT_LOGO_CSS, renderLogoHtml, safeHttpUrl, safeImageSrc } from './printShared';

export interface PrintShopOrderOptions {
  siteName?: string;
  /** شعار المصنع من الإعدادات (رابط / Base64 / رمز) — يُعرض في رأس الورقة. */
  logo?: string;
  modelCode: string;
  modelType?: string;
  sizeCategoryName?: string;
  /** المقاسات المعتمدة للموديل التي تُعرض كشرائح Badges. */
  sizes?: string[];
  imageUrl?: string;
  /** منطقة قص مؤقتة للصورة (لا تُحفظ، للطباعة فقط). */
  imageCrop?: ImageCropRegion | null;
  /** رابط ماركر / باترون الطباعة المسجل للموديل في قسم التصميم. */
  printMarkerUrl?: string;
  shopName: string;
  pieceLabel?: string;
  printLocation?: string;
  printDetails?: string;
  piecesCount?: number;
  dispatchDate?: string;
  expectedDate?: string;
  notes?: string;
}

const fmtInt = (value: number): string =>
  Math.round(Number.isFinite(value) ? value : 0).toLocaleString('ar-EG');

/**
 * يبني صورة كبيرة (بحجم يقارب نصف A4) داخل الورقة مع دعم القص المؤقت
 * بإحداثيات البيكسل الطبيعية لضمان وضوح تفاصيل الرسمة في ملف الـ PDF.
 */
const renderLargeImage = (options: PrintShopOrderOptions): string => {
  const imageSrc = safeImageSrc(options.imageUrl);
  if (!imageSrc) {
    return '<div class="muted noimg">لا توجد صورة مسجلة لهذا الموديل</div>';
  }

  const crop = options.imageCrop;
  if (!crop || crop.natW <= 0 || crop.natH <= 0 || crop.w <= 0 || crop.h <= 0) {
    return `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(
      options.modelCode
    )}" onerror="this.style.display='none'" />`;
  }

  // حد أقصى كبير جداً (يقارب نصف A4) لإظهار تفاصيل الرسمة بوضوح للمطبعة.
  const MAX_IMAGE = 470;
  const scale = Math.min(MAX_IMAGE / crop.w, MAX_IMAGE / crop.h);
  const boxW = Math.max(1, Math.round(crop.w * scale));
  const boxH = Math.max(1, Math.round(crop.h * scale));

  return `<div class="cropbox" style="width:${boxW}px;height:${boxH}px;">
      <img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(options.modelCode)}"
        style="position:absolute;width:${Math.round(crop.natW * scale)}px;height:${Math.round(
    crop.natH * scale
  )}px;left:${Math.round(-crop.x * scale)}px;top:${Math.round(-crop.y * scale)}px;max-width:none;max-height:none;" />
    </div>`;
};

/** رابط الماركر النشط داخل الـ PDF (قابل للضغط لفتح باترون الطباعة مباشرة). */
const renderMarker = (url?: string): string => {
  const value = safeHttpUrl(url);
  if (!value) {
    return '<span class="muted">لم يتم تسجيل ماركر طباعة صالح لهذا الموديل.</span>';
  }
  return `<a class="marker-link" href="${escapeHtml(value)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
    value
  )}</a>`;
};

const renderNotes = (body?: string): string => {
  if (!body || !String(body).trim()) return '';
  return `<div class="notes">
      <div class="t">📝 ملاحظات التشغيل</div>
      <div class="body">${escapeHtml(body)}</div>
    </div>`;
};

const renderSheet = (options: PrintShopOrderOptions): string => {
  const sizes = Array.isArray(options.sizes) ? options.sizes.filter(Boolean) : [];
  const sizeChips =
    sizes.length > 0
      ? sizes.map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join('')
      : '<span class="muted">غير محددة</span>';

  const pieceLabel = options.pieceLabel || 'القطعة';
  const piecesCount = Number(options.piecesCount) || 0;

  return `<div class="sheet">
    <header>
      <div class="brand">${renderLogoHtml(options.logo, options.siteName, 54)}</div>
      <h1>${escapeHtml(options.siteName || 'مصنع الملابس الجاهزة')} — أوردر مطبعة / تطريز</h1>
      <h2>قسم المطابع والتطريز — أمر تشغيل ${escapeHtml(pieceLabel)}</h2>
    </header>

    <div class="bigimg">${renderLargeImage(options)}</div>

    <div class="marker">
      <div class="marker-label">🔗 رابط ماركر / باترون الطباعة</div>
      ${renderMarker(options.printMarkerUrl)}
    </div>

    <div class="fields">
      <div class="row"><span class="k">كود الموديل</span><span class="v">${escapeHtml(
        options.modelCode
      )}</span></div>
      <div class="row"><span class="k">نوع / فئة الموديل</span><span class="v">${escapeHtml(
        options.modelType || 'غير محدد'
      )}</span></div>
      <div class="row"><span class="k">فئة المقاسات</span><span class="v">${escapeHtml(
        options.sizeCategoryName || '—'
      )}</span></div>
      <div class="row"><span class="k">القطعة المرسلة</span><span class="v">${escapeHtml(
        pieceLabel
      )}</span></div>
      <div class="row full"><span class="k">المقاسات المعتمدة</span><span class="v chips">${sizeChips}</span></div>
      <div class="row"><span class="k">اسم المطبعة / الورشة</span><span class="v">${escapeHtml(
        options.shopName || '—'
      )}</span></div>
      <div class="row"><span class="k">مكان الطباعة</span><span class="v">${escapeHtml(
        options.printLocation || '—'
      )}</span></div>
      <div class="row"><span class="k">عدد القطع المسلمة</span><span class="v">${fmtInt(
        piecesCount
      )} قطعة</span></div>
      <div class="row"><span class="k">تاريخ التسليم للمطبعة</span><span class="v">${escapeHtml(
        options.dispatchDate || '—'
      )}</span></div>
      <div class="row"><span class="k">تاريخ الاستلام المتوقع</span><span class="v">${escapeHtml(
        options.expectedDate || 'حسب الاتفاق'
      )}</span></div>
    </div>

    <div class="print-details">
      <div class="t">🎨 تفاصيل الطباعة / التطريز</div>
      <div class="body">${escapeHtml(options.printDetails || 'لم تُسجل تفاصيل إضافية.')}</div>
    </div>

    ${renderNotes(options.notes)}
  </div>`;
};

/**
 * يفتح نافذة طباعة مستقلة لأوردر المطبعة (A4) جاهزة للحفظ كـ PDF.
 */
export const printPrintShopOrder = (options: PrintShopOrderOptions): void => {
  const title = `أوردر مطبعة - ${options.modelCode}`;

  const html = `<!DOCTYPE html>
  <html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page { size: A4 portrait; margin: 10mm; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body { font-family: "Tahoma", "Arial", sans-serif; color: #111; }
      .sheet { padding: 2mm; }

      header { text-align: center; border-bottom: 3px double #111; padding-bottom: 8px; margin-bottom: 10px; }
      header h1 { font-size: 20px; margin: 0 0 2px; letter-spacing: .5px; }
      header h2 { font-size: 14px; margin: 0; color: #333; font-weight: bold; }
      ${PRINT_LOGO_CSS}

      .bigimg { width: 100%; min-height: 250px; display: flex; align-items: center; justify-content: center;
        border: 1.5px solid #222; border-radius: 8px; padding: 8px; background: #fafafa; margin-bottom: 10px;
        page-break-inside: avoid; }
      .bigimg > img { max-width: 100%; max-height: 470px; object-fit: contain; }
      .bigimg .cropbox { position: relative; overflow: hidden; }
      .bigimg .cropbox img { position: absolute; }
      .bigimg .noimg { font-size: 12px; }

      .marker { border: 1.5px solid #222; border-radius: 8px; padding: 8px 10px; margin-bottom: 10px;
        background: #f3f7f5; page-break-inside: avoid; }
      .marker-label { font-size: 12px; font-weight: 900; margin-bottom: 4px; }
      .marker-link { font-size: 13px; font-weight: 900; color: #0f5132; text-decoration: underline;
        word-break: break-all; direction: ltr; display: inline-block; }

      .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 18px; font-size: 13px;
        border: 1.5px solid #222; border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
      .fields .row { display: flex; justify-content: space-between; align-items: center; gap: 8px;
        border-bottom: 1px dotted #bbb; padding: 5px 2px; }
      .fields .row.full { grid-column: 1 / -1; }
      .fields .k { color: #555; font-weight: bold; white-space: nowrap; }
      .fields .v { font-weight: 900; text-align: left; }
      .chips { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }
      .chip { border: 1px solid #222; border-radius: 5px; padding: 1px 8px; font-size: 12px; font-weight: bold; background: #f3f3f3; }
      .muted { color: #888; font-weight: bold; }

      .print-details { border: 2px solid #222; border-radius: 8px; padding: 8px 10px; margin-bottom: 10px;
        background: #f7f7f7; page-break-inside: avoid; }
      .print-details .t { font-weight: 900; margin-bottom: 4px; }
      .print-details .body { white-space: pre-wrap; font-size: 14px; font-weight: 900; }

      .notes { border: 1.5px solid #222; border-radius: 8px; padding: 8px 10px; min-height: 40px;
        margin-bottom: 10px; font-size: 13px; page-break-inside: avoid; }
      .notes .t { font-weight: 900; margin-bottom: 4px; }
      .notes .body { white-space: pre-wrap; }

      @media print {
        .sheet { padding: 0; }
        header { page-break-after: avoid; }
        .bigimg, .marker, .fields, .print-details, .notes { page-break-inside: avoid; }
      }
    </style>
  </head>
  <body>
    ${renderSheet(options)}
    <script>
      window.onload = function () { window.focus(); window.print(); };
    </script>
  </body>
  </html>`;

  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) {
    alert('يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة أوردر المطبعة.');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
};

