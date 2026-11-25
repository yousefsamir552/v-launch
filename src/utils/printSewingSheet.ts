/**
 * ورقة "أمر تشغيل ورشة المكن" الرسمية الجاهزة للطباعة (صفحة A4 واحدة لكل قطعة):
 *  - هيدر المصنع الموحد (شعار + اسم المصنع + عنوان الأمر + التاريخ/الوقت + طُبع بواسطة).
 *  - صندوق بيانات الموديل (صورة مع دعم القص المؤقت + كود، نوع، فئة المقاسات، المقاسات، العدد، الورشة، التواريخ).
 *  - ملاحظات التصميم + ملاحظات خياطة القطعة + جدول الإكسسوارات + التعليمات الثابتة + شريط التوقيعات.
 *  - مضمونة الاحتواء على صفحة A4 واحدة لكل قطعة بدون أي امتداد لصفحة ثانية.
 */

import type { ImageCropRegion, ModelAccessory } from '../types';
import {
  escapeHtml,
  logClientPrintAction,
  openUnifiedPrintWindow,
  renderSignatureBar,
  renderUnifiedPrintHeader,
  safeImageSrc
} from './printShared';

export interface SewingSheetOptions {
  siteName?: string;
  /** شعار المصنع من الإعدادات (رابط / Base64 / رمز) — يُعرض في رأس الورقة. */
  logo?: string;
  modelCode: string;
  modelType?: string;
  sizeCategoryName?: string;
  /** المقاسات المعتمدة للموديل (الأرقام الفردية) التي تُعرض كشرائح Badges. */
  sizes?: string[];
  imageUrl?: string;
  /** منطقة قص مؤقتة للصورة (لا تُحفظ، للطباعة فقط). */
  imageCrop?: ImageCropRegion | null;
  pieceType: 'shirt' | 'pants' | 'jacket' | 'single';
  pieceLabel?: string;
  piecesCount?: number;
  workshopName?: string;
  dispatchDate?: string;
  expectedDate?: string;
  accessories?: ModelAccessory[];
  designNotes?: string;
  pieceNotes?: string;
  fixedInstructions?: string;
}

const fmtInt = (value: number): string =>
  Math.round(Number.isFinite(value) ? value : 0).toLocaleString('ar-EG');

const fmtDecimal = (value: number): string =>
  (Number.isFinite(value) ? Number(value.toFixed(3)) : 0).toLocaleString('ar-EG', {
    maximumFractionDigits: 3
  });

const fmtTotalCeil = (value: number): string =>
  Math.ceil(Number.isFinite(value) && value > 0 ? value : 0).toLocaleString('ar-EG');

const DEFAULT_PIECE_LABELS: Record<SewingSheetOptions['pieceType'], string> = {
  shirt: 'التيشرت',
  pants: 'البنطلون',
  jacket: 'الجاكيت',
  single: 'القطعة'
};

/** يبني الصورة داخل الصندوق مع دعم القص المؤقت بإحداثيات بيكسل دقيقة. */
const renderImage = (options: SewingSheetOptions): string => {
  const imageSrc = safeImageSrc(options.imageUrl);
  if (!imageSrc) {
    return '<div class="muted noimg">لا توجد صورة</div>';
  }

  const crop = options.imageCrop;
  if (!crop || crop.natW <= 0 || crop.natH <= 0 || crop.w <= 0 || crop.h <= 0) {
    return `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(
      options.modelCode
    )}" onerror="this.style.display='none'" />`;
  }

  const MAX_THUMB = 165;
  const scale = Math.min(MAX_THUMB / crop.w, MAX_THUMB / crop.h);
  const boxW = Math.max(1, Math.round(crop.w * scale));
  const boxH = Math.max(1, Math.round(crop.h * scale));

  return `<div class="cropbox" style="width:${boxW}px;height:${boxH}px;">
      <img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(options.modelCode)}"
        style="position:absolute;width:${Math.round(crop.natW * scale)}px;height:${Math.round(
    crop.natH * scale
  )}px;left:${Math.round(-crop.x * scale)}px;top:${Math.round(-crop.y * scale)}px;max-width:none;max-height:none;" />
    </div>`;
};

const renderNotes = (title: string, body?: string): string => {
  if (!body || !String(body).trim()) return '';
  return `<div class="p-note-box">
      <div class="p-note-title">${title}</div>
      <div class="p-note-body">${escapeHtml(body)}</div>
    </div>`;
};

const renderAccessories = (accessories: ModelAccessory[], piecesCount: number): string => {
  const list = Array.isArray(accessories) ? accessories : [];
  if (list.length === 0) {
    return '<table class="acc"><tbody><tr><td class="empty" colspan="6">لا توجد إكسسوارات مسجلة لهذه القطعة.</td></tr></tbody></table>';
  }

  const rows = list
    .map((a, index) => {
      const per = Number(a.piece_consumption) || 1;
      const total = per * piecesCount;
      return `<tr>
        <td class="c-idx num">${index + 1}</td>
        <td class="c-name">${escapeHtml(a.accessory_name || a.accessory_code || '—')}</td>
        <td class="c-code mono">${escapeHtml(a.accessory_code || '—')}</td>
        <td class="c-per num">${fmtDecimal(per)}</td>
        <td class="c-unit">${escapeHtml(a.unit || 'قطعة')}</td>
        <td class="c-total num">${fmtTotalCeil(total)}</td>
      </tr>`;
    })
    .join('');

  return `<table class="acc">
      <colgroup>
        <col class="c-idx" />
        <col class="c-name" />
        <col class="c-code" />
        <col class="c-per" />
        <col class="c-unit" />
        <col class="c-total" />
      </colgroup>
      <thead>
        <tr>
          <th>#</th>
          <th class="text-right">اسم الإكسسوار</th>
          <th>الكود</th>
          <th>الاستهلاك / قطعة</th>
          <th>الوحدة</th>
          <th>الإجمالي المطلوب</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
};

const renderSheet = (options: SewingSheetOptions): string => {
  const pieceLabel = options.pieceLabel || DEFAULT_PIECE_LABELS[options.pieceType] || 'القطعة';
  const piecesCount = Number(options.piecesCount) || 0;
  const sizes = Array.isArray(options.sizes) ? options.sizes.filter(Boolean) : [];

  const sizeChips =
    sizes.length > 0
      ? sizes.map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join('')
      : '<span class="muted">غير محددة</span>';

  const instructionsBlock =
    options.fixedInstructions && String(options.fixedInstructions).trim()
      ? `<div class="p-note-box instr-box">
          <div class="p-note-title">التعليمات والملاحظات الثابتة المعتمدة</div>
          <div class="p-note-body">${escapeHtml(options.fixedInstructions)}</div>
        </div>`
      : '';

  const headerHtml = renderUnifiedPrintHeader({
    siteName: options.siteName,
    logo: options.logo,
    title: 'أمر تشغيل ورشة المكن',
    subtitle: `قسم الخياطة والمكن — ورقة ${pieceLabel}`,
    metaItems: [`الموديل: ${options.modelCode}`],
    compact: true
  });

  return `
    ${headerHtml}

    <div class="p-info-card">
      <div class="thumb">${renderImage(options)}</div>
      <div class="p-fields">
        <div class="p-field"><span class="p-k">كود الموديل</span><span class="p-v">${escapeHtml(options.modelCode)}</span></div>
        <div class="p-field"><span class="p-k">نوع الموديل</span><span class="p-v">${escapeHtml(options.modelType || 'غير محدد')}</span></div>
        <div class="p-field"><span class="p-k">فئة المقاسات</span><span class="p-v">${escapeHtml(options.sizeCategoryName || '—')}</span></div>
        <div class="p-field"><span class="p-k">القطعة</span><span class="p-v">${escapeHtml(pieceLabel)}</span></div>
        <div class="p-field full"><span class="p-k">المقاسات المعتمدة</span><span class="p-v chips">${sizeChips}</span></div>
        <div class="p-field"><span class="p-k">العدد المسلم للورشة</span><span class="p-v num">${fmtInt(piecesCount)} قطعة</span></div>
        <div class="p-field"><span class="p-k">اسم الورشة</span><span class="p-v">${escapeHtml(options.workshopName || '—')}</span></div>
        <div class="p-field"><span class="p-k">تاريخ التسليم للورشة</span><span class="p-v num">${escapeHtml(options.dispatchDate || '—')}</span></div>
        <div class="p-field"><span class="p-k">تاريخ الاستلام المتوقع</span><span class="p-v num">${escapeHtml(options.expectedDate || 'حسب الاتفاق')}</span></div>
      </div>
    </div>

    ${renderNotes('ملاحظات التصميم', options.designNotes)}
    ${renderNotes(`ملاحظات خياطة ${pieceLabel}`, options.pieceNotes)}

    <div class="p-sec">إكسسوارات ${escapeHtml(pieceLabel)} الخاصة</div>
    ${renderAccessories(options.accessories || [], piecesCount)}

    ${instructionsBlock}

    ${renderSignatureBar(['مسؤول التسليم والتشغيل', 'توقيع مستلم ورشة المكن', 'اعتماد مشرف الإنتاج'], true)}
  `;
};

/**
 * يفتح نافذة طباعة مستقلة تحتوي ورقة واحدة أو أكثر (تيشرت / بنطلون / جاكيت)
 * حيث تُضبط كل ورقة على صفحة A4 واحدة كاملة مع فاصل صفحات صارم بين القطع.
 */
export const printSewingSheets = (sheets: SewingSheetOptions[]): void => {
  const list = Array.isArray(sheets) ? sheets.filter(Boolean) : [];
  if (list.length === 0) return;
  const modelCode = list[0].modelCode || '';
  logClientPrintAction(
    'المكن',
    `طباعة أمر تشغيل ورشة المكن (${list.length} ورقة) للموديل ${modelCode}`,
    modelCode
  );

  const title =
    list.length > 1
      ? `أمر تشغيل المكن - ${list[0].modelCode}`
      : `أمر تشغيل المكن - ${list[0].pieceLabel || list[0].modelCode}`;

  openUnifiedPrintWindow({
    documentTitle: title,
    mode: 'fit-single-page',
    orientation: 'portrait',
    sheetsHtml: list.map(renderSheet),
    extraCss: `
      .thumb {
        width: 165px;
        min-height: 155px;
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        overflow: hidden;
        background: #f8fafc;
      }
      .thumb > img { width: 100%; height: 165px; object-fit: contain; }
      .thumb .cropbox { position: relative; overflow: hidden; }
      .thumb .cropbox img { position: absolute; }
      .thumb .noimg { font-size: 10px; }
      table.acc { table-layout: fixed; font-size: 10px; margin-bottom: 6px; }
      table.acc col.c-idx { width: 6%; }
      table.acc col.c-name { width: 35%; }
      table.acc col.c-code { width: 15%; }
      table.acc col.c-per { width: 15%; }
      table.acc col.c-unit { width: 11%; }
      table.acc col.c-total { width: 18%; }
      table.acc td.c-name { text-align: right; padding-right: 7px; font-weight: 700; }
      table.acc td.c-total { font-weight: 800; color: #0f172a; }
      table.acc td.empty { padding: 10px; color: #64748b; font-weight: 700; }
      .instr-box { background: #ffffff; border-color: #334155; }
    `,
    popupBlockedMessage: 'يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة ورقة المكن.'
  });
};
