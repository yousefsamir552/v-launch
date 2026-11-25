/**
 * ورقة "أوردر مطبعة / تطريز" رسمية جاهزة للطباعة (صفحة A4 واحدة صارمة — Single-Page A4) —
 * تُحفظ كـ PDF وتُرسل للمطبعة، مع صورة واضحة كبيرة ودعم القص المؤقت (Crop) ورابط ماركر نشط.
 */

import type { ImageCropRegion } from '../types';
import {
  escapeHtml,
  logClientPrintAction,
  openUnifiedPrintWindow,
  renderSignatureBar,
  safeHttpUrl,
  safeImageSrc
} from './printShared';

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

  const MAX_IMAGE = 370;
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

const renderMarker = (url?: string): string => {
  const value = safeHttpUrl(url);
  if (!value) {
    return '<span class="muted">لم يتم تسجيل ماركر طباعة صالح لهذا الموديل.</span>';
  }
  return `<a class="marker-link" href="${escapeHtml(value)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
    value
  )}</a>`;
};

export const printPrintShopOrder = (options: PrintShopOrderOptions): void => {
  logClientPrintAction(
    'المطابع',
    `طباعة أوردر مطبعة (${options.shopName || 'مطبعة'}) للموديل ${options.modelCode}`,
    options.modelCode
  );
  const sizes = Array.isArray(options.sizes) ? options.sizes.filter(Boolean) : [];
  const sizeChips =
    sizes.length > 0
      ? sizes.map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join('')
      : '<span class="muted">غير محددة</span>';

  const pieceLabel = options.pieceLabel || 'القطعة';
  const piecesCount = Number(options.piecesCount) || 0;

  const notesBlock =
    options.notes && String(options.notes).trim()
      ? `<div class="p-note-box">
           <div class="p-note-title">ملاحظات التشغيل</div>
           <div class="p-note-body">${escapeHtml(options.notes)}</div>
         </div>`
      : '';

  const bodyHtml = `
    <div class="bigimg">${renderLargeImage(options)}</div>

    <div class="marker">
      <div class="marker-label">رابط ماركر / باترون الطباعة</div>
      ${renderMarker(options.printMarkerUrl)}
    </div>

    <div class="p-info-card">
      <div class="p-fields">
        <div class="p-field"><span class="p-k">كود الموديل</span><span class="p-v">${escapeHtml(options.modelCode)}</span></div>
        <div class="p-field"><span class="p-k">نوع / فئة الموديل</span><span class="p-v">${escapeHtml(options.modelType || 'غير محدد')}</span></div>
        <div class="p-field"><span class="p-k">فئة المقاسات</span><span class="p-v">${escapeHtml(options.sizeCategoryName || '—')}</span></div>
        <div class="p-field"><span class="p-k">القطعة المرسلة</span><span class="p-v">${escapeHtml(pieceLabel)}</span></div>
        <div class="p-field full"><span class="p-k">المقاسات المعتمدة</span><span class="p-v chips">${sizeChips}</span></div>
        <div class="p-field"><span class="p-k">اسم المطبعة / الورشة</span><span class="p-v">${escapeHtml(options.shopName || '—')}</span></div>
        <div class="p-field"><span class="p-k">مكان الطباعة</span><span class="p-v">${escapeHtml(options.printLocation || '—')}</span></div>
        <div class="p-field"><span class="p-k">عدد القطع المسلمة</span><span class="p-v num">${fmtInt(piecesCount)} قطعة</span></div>
        <div class="p-field"><span class="p-k">تاريخ التسليم للمطبعة</span><span class="p-v num">${escapeHtml(options.dispatchDate || '—')}</span></div>
        <div class="p-field full"><span class="p-k">تاريخ الاستلام المتوقع</span><span class="p-v num">${escapeHtml(options.expectedDate || 'حسب الاتفاق')}</span></div>
      </div>
    </div>

    <div class="p-note-box details-box">
      <div class="p-note-title">تفاصيل الطباعة / التطريز</div>
      <div class="p-note-body details-body">${escapeHtml(options.printDetails || 'لم تُسجل تفاصيل إضافية.')}</div>
    </div>

    ${notesBlock}

    ${renderSignatureBar(['مسؤول تسليم المطابع', 'توقيع مستلم المطبعة', 'اعتماد مشرف الإنتاج'], true)}
  `;

  openUnifiedPrintWindow({
    documentTitle: `أوردر مطبعة - ${options.modelCode}`,
    mode: 'fit-single-page',
    orientation: 'portrait',
    header: {
      siteName: options.siteName,
      logo: options.logo,
      title: 'أوردر مطبعة / تطريز',
      subtitle: `قسم المطابع والتطريز — أمر تشغيل ${pieceLabel}`,
      metaItems: [`الموديل: ${options.modelCode}`],
      compact: true
    },
    bodyHtml,
    extraCss: `
      .bigimg {
        width: 100%;
        min-height: 210px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1.2px solid #334155;
        border-radius: 6px;
        padding: 6px;
        background: #f8fafc;
        margin-bottom: 7px;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .bigimg > img { max-width: 100%; max-height: 365px; object-fit: contain; }
      .bigimg .cropbox { position: relative; overflow: hidden; }
      .bigimg .cropbox img { position: absolute; }
      .bigimg .noimg { font-size: 11px; }
      .marker {
        border: 1.2px solid #334155;
        border-radius: 6px;
        padding: 5px 8px;
        margin-bottom: 7px;
        background: #f0fdf4;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .marker-label { font-size: 10px; font-weight: 800; color: #0f172a; margin-bottom: 2px; }
      .marker-link {
        font-size: 10.5px;
        font-weight: 800;
        color: #047857;
        text-decoration: underline;
        word-break: break-all;
        direction: ltr;
        display: inline-block;
      }
      .details-box { border-color: #0f172a; background: #f8fafc; }
      .details-body { font-size: 11px; font-weight: 800; color: #0f172a; }
    `,
    popupBlockedMessage: 'يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة أوردر المطبعة.'
  });
};
