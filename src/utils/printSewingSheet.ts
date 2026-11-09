/**
 * ورقة "أمر تشغيل ورشة المكن" الرسمية الجاهزة للطباعة (A4) — بنفس تنسيق ونظافة ورقة القص الحديثة:
 *  - نظيفة تماماً بدون ألوان أو حدود متعرجة، بخطوط Tahoma واضحة.
 *  - هيدر مركزي + صندوق بيانات الموديل (صورة، كود، نوع، فئة المقاسات، المقاسات المعتمدة، العدد، الورشة، التواريخ).
 *  - ملاحظات التصميم + ملاحظات الخياطة الخاصة بالقطعة (تيشرت / بنطلون).
 *  - جدول إكسسوارات القطعة (الاستهلاك للقطعة + الإجمالي المطلوب).
 *  - التعليمات والملاحظات الثابتة في القاع + خطوط التوقيعات.
 *
 * تتبع نفس نمط `printCuttingOrder` في المشروع (نافذة مستقلة + document.write + window.print).
 */

import type { ImageCropRegion, ModelAccessory } from '../types';

export interface SewingSheetOptions {
  siteName?: string;
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

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmtInt = (value: number): string =>
  Math.round(Number.isFinite(value) ? value : 0).toLocaleString('ar-EG');

const DEFAULT_PIECE_LABELS: Record<SewingSheetOptions['pieceType'], string> = {
  shirt: 'التيشرت',
  pants: 'البنطلون',
  jacket: 'الجاكيت',
  single: 'القطعة'
};

/** يبني الصورة داخل الصندوق مع دعم القص المؤقت بإحداثيات بيكسل دقيقة. */
const renderImage = (options: SewingSheetOptions): string => {
  if (!options.imageUrl) {
    return '<div class="muted noimg">لا توجد صورة</div>';
  }

  const crop = options.imageCrop;
  if (!crop || crop.natW <= 0 || crop.natH <= 0 || crop.w <= 0 || crop.h <= 0) {
    return `<img src="${escapeHtml(options.imageUrl)}" alt="${escapeHtml(
      options.modelCode
    )}" onerror="this.style.display='none'" />`;
  }

  const MAX_THUMB = 112;
  const scale = Math.min(MAX_THUMB / crop.w, MAX_THUMB / crop.h);
  const boxW = Math.max(1, Math.round(crop.w * scale));
  const boxH = Math.max(1, Math.round(crop.h * scale));

  return `<div class="cropbox" style="width:${boxW}px;height:${boxH}px;">
      <img src="${escapeHtml(options.imageUrl)}" alt="${escapeHtml(options.modelCode)}"
        style="position:absolute;width:${Math.round(crop.natW * scale)}px;height:${Math.round(
    crop.natH * scale
  )}px;left:${Math.round(-crop.x * scale)}px;top:${Math.round(-crop.y * scale)}px;max-width:none;max-height:none;" />
    </div>`;
};

const renderNotes = (title: string, body?: string): string => {
  if (!body || !String(body).trim()) return '';
  return `<div class="notes">
      <div class="t">${title}</div>
      <div class="body">${escapeHtml(body)}</div>
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
        <td class="c-idx">${index + 1}</td>
        <td class="c-name">${escapeHtml(a.accessory_name || a.accessory_code || '—')}</td>
        <td class="c-code">${escapeHtml(a.accessory_code || '—')}</td>
        <td class="c-per">${fmtInt(per)}</td>
        <td class="c-unit">${escapeHtml(a.unit || 'قطعة')}</td>
        <td class="c-total">${fmtInt(total)}</td>
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
          <th>اسم الإكسسوار</th>
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
      ? `<div class="instr">
          <div class="t">📌 التعليمات والملاحظات الثابتة المعتمدة</div>
          <div class="body">${escapeHtml(options.fixedInstructions)}</div>
        </div>`
      : '';

  return `<div class="sheet">
    <header>
      <h1>${escapeHtml(options.siteName || 'مصنع الملابس الجاهزة')} — أمر تشغيل ورشة المكن</h1>
      <h2>قسم الخياطة والمكن — ورقة ${escapeHtml(pieceLabel)}</h2>
    </header>

    <div class="info">
      <div class="thumb">${renderImage(options)}</div>
      <div class="fields">
        <div class="row"><span class="k">كود الموديل</span><span class="v">${escapeHtml(
          options.modelCode
        )}</span></div>
        <div class="row"><span class="k">نوع الموديل</span><span class="v">${escapeHtml(
          options.modelType || 'غير محدد'
        )}</span></div>
        <div class="row"><span class="k">فئة المقاسات</span><span class="v">${escapeHtml(
          options.sizeCategoryName || '—'
        )}</span></div>
        <div class="row"><span class="k">القطعة</span><span class="v">${escapeHtml(
          pieceLabel
        )}</span></div>
        <div class="row full"><span class="k">المقاسات المعتمدة</span><span class="v chips">${sizeChips}</span></div>
        <div class="row"><span class="k">العدد المسلم للورشة</span><span class="v">${fmtInt(
          piecesCount
        )} قطعة</span></div>
        <div class="row"><span class="k">اسم الورشة</span><span class="v">${escapeHtml(
          options.workshopName || '—'
        )}</span></div>
        <div class="row"><span class="k">تاريخ التسليم للورشة</span><span class="v">${escapeHtml(
          options.dispatchDate || '—'
        )}</span></div>
        <div class="row full"><span class="k">تاريخ الاستلام المتوقع</span><span class="v">${escapeHtml(
          options.expectedDate || 'حسب الاتفاق'
        )}</span></div>
      </div>
    </div>

    ${renderNotes('📝 ملاحظات التصميم', options.designNotes)}
    ${renderNotes(`✂️ ملاحظات خياطة ${pieceLabel}`, options.pieceNotes)}

    <h3 class="sec">إكسسوارات ${escapeHtml(pieceLabel)} الخاصة</h3>
    ${renderAccessories(options.accessories || [], piecesCount)}

    ${instructionsBlock}

    <div class="sign-row">
      <div>اسم المسؤول: ........................</div>
      <div>توقيع الورشة: ........................</div>
      <div>التاريخ: ........................</div>
    </div>
  </div>`;
};

/**
 * يفتح نافذة طباعة مستقلة تحتوي ورقة واحدة أو ورقتين (تيشرت + بنطلون) مع فاصل صفحات صارم.
 */
export const printSewingSheets = (sheets: SewingSheetOptions[]): void => {
  const list = Array.isArray(sheets) ? sheets.filter(Boolean) : [];
  if (list.length === 0) return;

  const title =
    list.length > 1
      ? `أمر تشغيل المكن - ${list[0].modelCode}`
      : `أمر تشغيل المكن - ${list[0].pieceLabel || list[0].modelCode}`;

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
      .sheet + .sheet { page-break-before: always; break-before: page; }

      header { text-align: center; border-bottom: 3px double #111; padding-bottom: 8px; margin-bottom: 12px; }
      header h1 { font-size: 20px; margin: 0 0 2px; letter-spacing: .5px; }
      header h2 { font-size: 14px; margin: 0; color: #333; font-weight: bold; }

      .info { display: flex; gap: 14px; align-items: stretch; border: 1.5px solid #222; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
      .info .thumb { width: 112px; flex: 0 0 auto; display: flex; align-items: center; justify-content: center; border: 1px solid #bbb; border-radius: 8px; overflow: hidden; background: #f7f7f7; }
      .info .thumb > img { width: 100%; height: 112px; object-fit: contain; }
      .info .thumb .cropbox { position: relative; overflow: hidden; }
      .info .thumb .cropbox img { position: absolute; }
      .info .thumb .noimg { font-size: 11px; }
      .info .fields { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 18px; font-size: 13px; align-content: start; }
      .info .fields .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; border-bottom: 1px dotted #bbb; padding: 5px 2px; }
      .info .fields .row.full { grid-column: 1 / -1; }
      .info .fields .k { color: #555; font-weight: bold; white-space: nowrap; }
      .info .fields .v { font-weight: 900; text-align: left; }
      .chips { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }
      .chip { border: 1px solid #222; border-radius: 5px; padding: 1px 8px; font-size: 12px; font-weight: bold; background: #f3f3f3; }
      .muted { color: #888; font-weight: bold; }

      .notes { border: 1.5px solid #222; border-radius: 8px; padding: 8px 10px; min-height: 40px; margin-bottom: 10px; font-size: 13px; page-break-inside: avoid; }
      .notes .t { font-weight: 900; margin-bottom: 4px; }
      .notes .body { white-space: pre-wrap; }

      h3.sec { font-size: 14px; margin: 0 0 6px; padding: 6px 8px; background: #ececec; border: 1.5px solid #222; border-radius: 6px; }

      table.acc { width: 100%; border-collapse: collapse; font-size: 12.5px; table-layout: fixed; margin-bottom: 12px; }
      table.acc th, table.acc td { border: 1.2px solid #222; text-align: center; padding: 6px 4px; }
      table.acc th { background: #f0f0f0; font-size: 12px; }
      table.acc td { height: 28px; }
      table.acc col.c-idx { width: 6%; }
      table.acc col.c-name { width: 34%; }
      table.acc col.c-code { width: 14%; }
      table.acc col.c-per { width: 16%; }
      table.acc col.c-unit { width: 12%; }
      table.acc col.c-total { width: 18%; }
      table.acc td.c-name { text-align: right; padding-right: 8px; font-weight: bold; }
      table.acc td.c-total { font-weight: 900; }
      table.acc td.empty { height: 40px; color: #888; font-weight: bold; }

      .instr { border: 1.5px solid #222; border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; font-size: 13px; page-break-inside: avoid; }
      .instr .t { font-weight: 900; margin-bottom: 4px; }
      .instr .body { white-space: pre-wrap; }

      .sign-row { display: flex; justify-content: space-between; gap: 24px; margin-top: 26px; font-size: 13px; }
      .sign-row div { flex: 1; border-top: 1px dashed #333; padding-top: 6px; text-align: center; font-weight: bold; }

      @media print {
        .sheet { padding: 0; }
        header { page-break-after: avoid; }
        .info, .notes, .instr { page-break-inside: avoid; }
        table.acc tr { page-break-inside: avoid; }
      }
    </style>
  </head>
  <body>
    ${list.map(renderSheet).join('')}
    <script>
      window.onload = function () { window.focus(); window.print(); };
    </script>
  </body>
  </html>`;

  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) {
    alert('يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة ورقة المكن.');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
};
