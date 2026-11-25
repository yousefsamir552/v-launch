/**
 * ورقة "أوردر قص" رسمية جاهزة للطباعة (صفحة A4 واحدة صارمة — Single-Page A4) —
 * تحتوي على هيدر المصنع الموحد + بيانات الموديل + جدول تسجيل الرقات يدوياً + التوقيعات.
 */

import {
  escapeHtml,
  logClientPrintAction,
  openUnifiedPrintWindow,
  renderSignatureBar,
  safeImageSrc
} from './printShared';

export interface CuttingOrderOptions {
  siteName?: string;
  /** شعار المصنع من الإعدادات (رابط / Base64 / رمز) — يُعرض في رأس الورقة. */
  logo?: string;
  modelCode: string;
  modelType?: string;
  targetQuantity?: number;
  /** المقاسات المعتمدة للموديل (الأرقام الفردية) التي تُعرض كشرائح Badges. */
  sizes?: string[];
  /** اسم فئة المقاسات المعتمدة (وسط / صغار / كبار ...). */
  sizeCategoryName?: string;
  imageUrl?: string;
  designNotes?: string;
  cutterName?: string;
  /** عدد الصفوف الفارغة في جدول الرقات (الافتراضي 14). */
  blankRows?: number;
}

const fmtInt = (value: number): string =>
  Math.round(Number.isFinite(value) ? value : 0).toLocaleString('ar-EG');

export const printCuttingOrder = (options: CuttingOrderOptions): void => {
  logClientPrintAction('القص', `طباعة أوردر قص رسمي للموديل ${options.modelCode}`, options.modelCode);
  const sizes = Array.isArray(options.sizes) ? options.sizes.filter(Boolean) : [];
  const today = new Date().toLocaleDateString('ar-EG');
  const blankRows = Math.max(6, Math.min(26, options.blankRows ?? 14));
  const rowHeightPx = blankRows <= 12 ? 32 : blankRows <= 16 ? 27 : 22;

  const sizeChips =
    sizes.length > 0
      ? sizes.map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join('')
      : '<span class="muted">غير محددة</span>';

  const imageSrc = safeImageSrc(options.imageUrl);
  const imageBlock = imageSrc
    ? `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(options.modelCode)}" onerror="this.style.display='none'" />`
    : '<div class="muted" style="display:flex;align-items:center;justify-content:center;height:100%;">لا توجد صورة</div>';

  const notesBlock =
    options.designNotes && String(options.designNotes).trim()
      ? `<div class="p-note-box">
           <div class="p-note-title">ملاحظات التصميم</div>
           <div class="p-note-body">${escapeHtml(options.designNotes)}</div>
         </div>`
      : '';

  const emptyRows = Array.from({ length: blankRows })
    .map(
      (_, idx) => `<tr>
        <td class="num muted">${idx + 1}</td>
        <td class="c-color"></td>
        <td class="c-layers"></td>
        <td class="c-weight"></td>
        <td class="c-sign"></td>
      </tr>`
    )
    .join('');

  const bodyHtml = `
    <div class="p-info-card">
      <div class="thumb">${imageBlock}</div>
      <div class="p-fields">
        <div class="p-field"><span class="p-k">كود الموديل</span><span class="p-v">${escapeHtml(options.modelCode)}</span></div>
        <div class="p-field"><span class="p-k">نوع الموديل</span><span class="p-v">${escapeHtml(options.modelType || 'أولادي')}</span></div>
        <div class="p-field"><span class="p-k">العدد المستهدف للقص</span><span class="p-v num">${fmtInt(Number(options.targetQuantity || 0))} قطعة</span></div>
        <div class="p-field"><span class="p-k">فئة المقاسات</span><span class="p-v">${escapeHtml(options.sizeCategoryName || '—')}</span></div>
        <div class="p-field full"><span class="p-k">المقاسات المعتمدة</span><span class="p-v chips">${sizeChips}</span></div>
        <div class="p-field"><span class="p-k">التاريخ</span><span class="p-v num">${escapeHtml(today)}</span></div>
        <div class="p-field"><span class="p-k">اسم القصاص</span><span class="p-v">${escapeHtml(options.cutterName || '..................')}</span></div>
      </div>
    </div>

    ${notesBlock}

    <div class="p-sec">جدول تسجيل الرقات (العمل اليدوي للقصاص)</div>
    <table class="workshop" style="--row-h:${rowHeightPx}px">
      <colgroup>
        <col style="width:5%" />
        <col style="width:28%" />
        <col style="width:15%" />
        <col style="width:15%" />
        <col style="width:37%" />
      </colgroup>
      <thead>
        <tr>
          <th>م</th>
          <th>الألوان</th>
          <th>عدد الرقات</th>
          <th>وزن الراق</th>
          <th>توقيع القصاص / الملاحظات</th>
        </tr>
      </thead>
      <tbody>${emptyRows}</tbody>
    </table>

    ${renderSignatureBar(['توقيع القصاص', 'توقيع الفراش', 'اعتماد مشرف القص'], true)}
  `;

  openUnifiedPrintWindow({
    documentTitle: `أوردر قص - ${options.modelCode}`,
    mode: 'fit-single-page',
    orientation: 'portrait',
    header: {
      siteName: options.siteName,
      logo: options.logo,
      title: 'أوردر قص رسمي',
      subtitle: 'قسم القص — ورقة تسجيل الرقات (الورشة)',
      metaItems: [`الموديل: ${options.modelCode}`],
      compact: true
    },
    bodyHtml,
    extraCss: `
      .thumb {
        width: 150px;
        height: 150px;
        flex: 0 0 auto;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        overflow: hidden;
        background: #f8fafc;
      }
      .thumb img { width: 100%; height: 100%; object-fit: contain; }
      table.workshop { table-layout: fixed; font-size: 10.5px; }
      table.workshop th, table.workshop td { border: 1.2px solid #334155; }
      table.workshop tbody td { height: var(--row-h, 28px); background: #ffffff !important; }
    `,
    popupBlockedMessage: 'يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة أوردر القص.'
  });
};
