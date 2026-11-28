/**
 * ورقة "أمر تشغيل ورشة المكن" الرسمية الجاهزة للطباعة (صفحة A4 بالطول — Portrait — صفحة واحدة لكل قطعة):
 *  - ترويسة علوية مدمجة ونظيفة (شعار واسم المصنع + عنوان أمر تشغيل ورشة المكن — ورقة {القطعة}).
 *  - النصف العلوي: مربع صورة الموديل بحجم كبير وواضح (height: 118mm) مع دعم القص المؤقت وإظهار أدق التفاصيل.
 *  - النصف السفلي: بطاقة البيانات الأساسية + ملاحظات التصميم وخياطة القطعة + جدول الإكسسوارات + التعليمات الثابتة + شريط التوقيعات.
 *  - مضمونة الاحتواء على صفحة A4 واحدة نظيفة لكل قطعة بدون انقسام عشوائي.
 */

import type { ImageCropRegion, ModelAccessory } from '../types';
import { toLatinDigits } from './latinDigits';
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
  Math.round(Number.isFinite(value) ? value : 0).toLocaleString('en-US');

const fmtDecimal = (value: number): string =>
  (Number.isFinite(value) ? Number(value.toFixed(3)) : 0).toLocaleString('en-US', {
    maximumFractionDigits: 3
  });

const fmtTotalCeil = (value: number): string =>
  Math.ceil(Number.isFinite(value) && value > 0 ? value : 0).toLocaleString('en-US');

const DEFAULT_PIECE_LABELS: Record<SewingSheetOptions['pieceType'], string> = {
  shirt: 'التيشرت',
  pants: 'البنطلون',
  jacket: 'الجاكيت',
  single: 'القطعة'
};

/** يبني الصورة الكبيرة داخل النصف العلوي مع دعم القص المؤقت بإحداثيات بيكسل دقيقة. */
const renderHeroImage = (options: SewingSheetOptions): string => {
  const imageSrc = safeImageSrc(options.imageUrl);
  if (!imageSrc) {
    return '<div class="muted noimg">لا توجد صورة للموديل</div>';
  }

  const crop = options.imageCrop;
  if (!crop || crop.natW <= 0 || crop.natH <= 0 || crop.w <= 0 || crop.h <= 0) {
    return `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(
      options.modelCode
    )}" onerror="this.style.display='none'" />`;
  }

  // أبعاد حاوية الصورة الكبيرة داخل عرض A4 (196mm ≈ 740px) وارتفاع 118mm (≈ 446px) بعد خصم الهوامش
  const MAX_W = 690;
  const MAX_H = 420;
  const scale = Math.min(MAX_W / crop.w, MAX_H / crop.h);
  const boxW = Math.max(1, Math.round(crop.w * scale));
  const boxH = Math.max(1, Math.round(crop.h * scale));

  return `<div class="cropbox" style="width:${boxW}px;height:${boxH}px;">
      <img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(options.modelCode)}"
        style="position:absolute;width:${Math.round(crop.natW * scale)}px;height:${Math.round(
    crop.natH * scale
  )}px;left:${Math.round(-crop.x * scale)}px;top:${Math.round(-crop.y * scale)}px;max-width:none;max-height:none;" />
    </div>`;
};

const renderNotesBlock = (
  pieceLabel: string,
  designNotes?: string,
  pieceNotes?: string
): string => {
  const hasDesign = Boolean(designNotes && String(designNotes).trim());
  const hasPiece = Boolean(pieceNotes && String(pieceNotes).trim());
  if (!hasDesign && !hasPiece) return '';

  const designHtml = hasDesign
    ? `<div class="p-note-box sew-note">
        <div class="p-note-title">ملاحظات التصميم</div>
        <div class="p-note-body">${escapeHtml(toLatinDigits(designNotes))}</div>
      </div>`
    : '';
  const pieceHtml = hasPiece
    ? `<div class="p-note-box sew-note">
        <div class="p-note-title">ملاحظات خياطة ${escapeHtml(pieceLabel)}</div>
        <div class="p-note-body">${escapeHtml(toLatinDigits(pieceNotes))}</div>
      </div>`
    : '';

  if (hasDesign && hasPiece) {
    return `<div class="sew-notes-grid">${designHtml}${pieceHtml}</div>`;
  }
  return designHtml || pieceHtml;
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
        <td class="c-code mono">${escapeHtml(toLatinDigits(a.accessory_code || '—'))}</td>
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
      ? sizes.map((s) => `<span class="chip num">${escapeHtml(toLatinDigits(s))}</span>`).join('')
      : '<span class="muted">غير محددة</span>';

  const instructionsBlock =
    options.fixedInstructions && String(options.fixedInstructions).trim()
      ? `<div class="p-note-box instr-box">
          <div class="p-note-title">التعليمات والملاحظات الثابتة المعتمدة</div>
          <div class="p-note-body">${escapeHtml(toLatinDigits(options.fixedInstructions))}</div>
        </div>`
      : '';

  const headerHtml = renderUnifiedPrintHeader({
    siteName: options.siteName,
    logo: options.logo,
    title: `أمر تشغيل ورشة المكن — ورقة ${pieceLabel}`,
    subtitle: 'قسم الخياطة والمكن',
    metaItems: [`الموديل: ${toLatinDigits(options.modelCode)}`],
    compact: true
  });

  const dispatchDateText = toLatinDigits(options.dispatchDate || '—');
  const expectedDateText = toLatinDigits(options.expectedDate || '—');
  const workshopText = options.workshopName || 'لم يُرسل للورشة بعد';

  return `
    ${headerHtml}

    <div class="sew-hero-box">
      ${renderHeroImage(options)}
    </div>

    <div class="sew-details-card">
      <div class="sew-fields">
        <div class="p-field"><span class="p-k">كود الموديل</span><span class="p-v num">${escapeHtml(toLatinDigits(options.modelCode))}</span></div>
        <div class="p-field"><span class="p-k">نوع الموديل</span><span class="p-v">${escapeHtml(options.modelType || 'غير محدد')}</span></div>
        <div class="p-field"><span class="p-k">القطعة</span><span class="p-v">${escapeHtml(pieceLabel)}</span></div>
        <div class="p-field"><span class="p-k">فئة المقاسات</span><span class="p-v">${escapeHtml(toLatinDigits(options.sizeCategoryName || '—'))}</span></div>
        <div class="p-field highlight-qty"><span class="p-k">العدد المسلم للورشة</span><span class="p-v num qty-strong">${fmtInt(piecesCount)} قطعة</span></div>
        <div class="p-field"><span class="p-k">اسم الورشة</span><span class="p-v">${escapeHtml(workshopText)}</span></div>
        <div class="p-field"><span class="p-k">تاريخ التسليم للورشة</span><span class="p-v num">${escapeHtml(dispatchDateText)}</span></div>
        <div class="p-field"><span class="p-k">تاريخ الاستلام المتوقع</span><span class="p-v num">${escapeHtml(expectedDateText)}</span></div>
        <div class="p-field full"><span class="p-k">المقاسات المعتمدة</span><span class="p-v chips">${sizeChips}</span></div>
      </div>
    </div>

    ${renderNotesBlock(pieceLabel, options.designNotes, options.pieceNotes)}

    <div class="p-sec sew-sec">إكسسوارات ${escapeHtml(pieceLabel)} الخاصة</div>
    ${renderAccessories(options.accessories || [], piecesCount)}

    ${instructionsBlock}

    ${renderSignatureBar(['مسؤول التسليم والتشغيل', 'توقيع مستلم ورشة المكن', 'اعتماد مشرف الإنتاج'], true)}
  `;
};

/**
 * يفتح نافذة طباعة مستقلة تحتوي ورقة واحدة أو أكثر (تيشرت / بنطلون / جاكيت)
 * حيث تُضبط كل ورقة على صفحة A4 واحدة كاملة (النصف العلوي لصورة الموديل والنصف السفلي للتفاصيل والتوقيعات).
 */
export const printSewingSheets = (sheets: SewingSheetOptions[]): void => {
  const list = Array.isArray(sheets) ? sheets.filter(Boolean) : [];
  if (list.length === 0) return;
  const modelCode = toLatinDigits(list[0].modelCode || '');
  logClientPrintAction(
    'المكن',
    `طباعة أمر تشغيل ورشة المكن (${list.length} ورقة) للموديل ${modelCode}`,
    modelCode
  );

  const title =
    list.length > 1
      ? `أمر تشغيل المكن - ${modelCode}`
      : `أمر تشغيل المكن - ${list[0].pieceLabel || modelCode}`;

  openUnifiedPrintWindow({
    documentTitle: title,
    mode: 'fit-single-page',
    orientation: 'portrait',
    sheetsHtml: list.map(renderSheet),
    extraCss: `
      .print-header.is-compact {
        padding-bottom: 4px;
        margin-bottom: 5px;
      }
      .sew-hero-box {
        width: 100%;
        height: 118mm;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1.5px solid #334155;
        border-radius: 8px;
        background: #ffffff;
        padding: 3mm;
        margin-bottom: 6px;
        overflow: hidden;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .sew-hero-box > img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        background: #ffffff;
        display: block;
      }
      .sew-hero-box .cropbox {
        position: relative;
        overflow: hidden;
        background: #ffffff;
      }
      .sew-hero-box .cropbox img {
        position: absolute;
      }
      .sew-hero-box .noimg {
        font-size: 12px;
      }

      .sew-details-card {
        border: 1.3px solid #334155;
        border-radius: 6px;
        padding: 5px 9px;
        margin-bottom: 5px;
        background: #ffffff;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .sew-fields {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 1.5px 14px;
        font-size: 10px;
      }
      .sew-fields .p-field {
        padding: 2px 2px;
      }
      .sew-fields .highlight-qty {
        background: #f8fafc;
        border-radius: 4px;
        padding: 2px 5px;
      }
      .sew-fields .qty-strong {
        font-size: 11.5px;
        font-weight: 900;
        color: #0f172a;
      }

      .sew-notes-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        margin-bottom: 5px;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .sew-notes-grid .sew-note {
        margin-bottom: 0;
      }
      .sew-note {
        padding: 4px 7px;
        margin-bottom: 5px;
        font-size: 9.5px;
      }

      .sew-sec {
        margin: 4px 0 3px;
        padding: 2.5px 8px;
        font-size: 10.5px;
      }

      table.acc {
        table-layout: fixed;
        font-size: 9.5px;
        margin-bottom: 5px;
      }
      table.acc th, table.acc td {
        padding: 2.5px 4px;
        line-height: 1.25;
      }
      table.acc col.c-idx { width: 6%; }
      table.acc col.c-name { width: 35%; }
      table.acc col.c-code { width: 15%; }
      table.acc col.c-per { width: 15%; }
      table.acc col.c-unit { width: 11%; }
      table.acc col.c-total { width: 18%; }
      table.acc td.c-name { text-align: right; padding-right: 7px; font-weight: 700; }
      table.acc td.c-total { font-weight: 800; color: #0f172a; }
      table.acc td.empty { padding: 7px; color: #64748b; font-weight: 700; }

      .instr-box {
        background: #ffffff;
        border-color: #334155;
        padding: 4px 7px;
        margin-bottom: 5px;
        font-size: 9.2px;
      }

      .print-signatures.is-compact {
        margin-top: 6px;
        gap: 8px;
      }
      .print-signatures.is-compact .print-sig-box {
        min-height: 78px;
        padding: 6px 8px 8px;
      }
      .print-signatures.is-compact .print-sig-space {
        min-height: 46px;
      }
    `,
    popupBlockedMessage: 'يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة ورقة المكن.'
  });
};
