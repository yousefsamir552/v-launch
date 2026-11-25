import { GarmentPart, getPartLabel } from '../types';
import {
  escapeHtml,
  logClientPrintAction,
  openUnifiedPrintWindow,
  renderSignatureBar,
  safeImageSrc
} from './printShared';

export interface ManualCountSheetPart {
  key: GarmentPart;
  colors: string[];
}

export interface ManualCountSheetOptions {
  siteName?: string;
  /** شعار المصنع من الإعدادات (رابط / Base64 / رمز) — يُعرض في رأس الورقة. */
  logo?: string;
  /** صورة الموديل — تُعرض بوضوح في بطاقة بيانات الموديل. */
  imageUrl?: string;
  modelCode: string;
  modelType?: string;
  stageLabel: string;
  sizes: string[];
  parts: ManualCountSheetPart[];
  inspectorName?: string;
  notes?: string;
}

/**
 * يحسب ارتفاع خانة الكتابة بالقلم ديناميكياً وفق إجمالي عدد الألوان والقطع واتجاه الصفحة
 * بحيث تظل الخانات مريحة للكتابة اليدوية وتتسع الورقة بالكامل مع التوقيعات على صفحة A4 واحدة فقط.
 */
const computeCellHeightPx = (
  totalRows: number,
  partsCount: number,
  landscape: boolean
): number => {
  const safeRows = Math.max(1, totalRows);
  const availablePx = landscape ? 470 : 730;
  const overheadPerPart = 54;
  const usable = Math.max(180, availablePx - partsCount * overheadPerPart);
  const ideal = Math.floor(usable / safeRows);
  const minH = landscape ? 28 : 34;
  const maxH = landscape ? 62 : 84;
  return Math.max(minH, Math.min(maxH, ideal));
};

/**
 * Opens a print-ready single-page A4 manual counting sheet (one blank color × size table per
 * garment part) so floor workers can count with a pen, independently per part.
 */
export const printManualCountSheet = (options: ManualCountSheetOptions): void => {
  logClientPrintAction(
    'العد والجودة',
    `طباعة ورقة جرد يدوي (${options.stageLabel}) للموديل ${options.modelCode}`,
    options.modelCode
  );
  const sizes = options.sizes.length > 0 ? options.sizes : ['S', 'M', 'L', 'XL'];
  const parts: ManualCountSheetPart[] =
    options.parts.length > 0
      ? options.parts
      : [{ key: 'shirt' as GarmentPart, colors: [] }];

  const normalizedParts = parts.map((p) => ({
    key: p.key,
    colors: p.colors.length > 0 ? p.colors : ['', '', '']
  }));

  const totalColorRows = normalizedParts.reduce((sum, p) => sum + p.colors.length, 0);
  const useLandscape =
    sizes.length > 6 || (normalizedParts.length >= 2 && sizes.length > 5);
  const cellHeightPx = computeCellHeightPx(
    totalColorRows,
    normalizedParts.length,
    useLandscape
  );
  const today = new Date().toLocaleDateString('ar-EG');

  const partSections = normalizedParts
    .map((part) => {
      const bodyRows = part.colors
        .map((color) => {
          const cells = sizes.map(() => '<td class="cell"></td>').join('');
          return `<tr>
            <td class="c-color">${escapeHtml(color)}</td>
            ${cells}
            <td class="cell c-total"></td>
            <td class="cell c-total"></td>
          </tr>`;
        })
        .join('');
      const headCells = sizes.map((s) => `<th>${escapeHtml(s)}</th>`).join('');
      const cols = [
        '<col class="col-color" />',
        ...sizes.map(() => '<col />'),
        '<col class="col-total" />',
        '<col class="col-total" />'
      ].join('');
      return `
        <section class="part-sec">
          <div class="p-sec">القطعة: ${escapeHtml(getPartLabel(part.key))} (${part.colors.length} لون)</div>
          <table class="qc-grid" style="--cell-h: ${cellHeightPx}px">
            <colgroup>${cols}</colgroup>
            <thead>
              <tr>
                <th class="c-color">اللون / المقاس</th>
                ${headCells}
                <th>إجمالي السليم</th>
                <th>الهالك</th>
              </tr>
            </thead>
            <tbody>${bodyRows}</tbody>
          </table>
        </section>`;
    })
    .join('');

  const imageSrc = safeImageSrc(options.imageUrl);
  const imageBlock = imageSrc
    ? `<div class="thumb">
        <img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(options.modelCode)}" onerror="this.style.display='none'" />
      </div>`
    : '<div class="thumb"><span class="muted">لا توجد صورة</span></div>';

  const notesBlock =
    options.notes && String(options.notes).trim()
      ? `<div class="p-note-box">
           <div class="p-note-title">ملاحظات الفرز</div>
           <div class="p-note-body">${escapeHtml(options.notes)}</div>
         </div>`
      : '';

  const bodyHtml = `
    <div class="p-info-card">
      ${imageBlock}
      <div class="p-fields">
        <div class="p-field"><span class="p-k">كود الموديل</span><span class="p-v">${escapeHtml(options.modelCode)}</span></div>
        <div class="p-field"><span class="p-k">نوع الموديل</span><span class="p-v">${escapeHtml(options.modelType || '—')}</span></div>
        <div class="p-field"><span class="p-k">مرحلة العد</span><span class="p-v">${escapeHtml(options.stageLabel)}</span></div>
        <div class="p-field"><span class="p-k">التاريخ</span><span class="p-v num">${escapeHtml(today)}</span></div>
        <div class="p-field full"><span class="p-k">القطع</span><span class="p-v">${escapeHtml(normalizedParts.map((p) => getPartLabel(p.key)).join(' + '))}</span></div>
        <div class="p-field full"><span class="p-k">المقاسات</span><span class="p-v chips">${sizes.map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join('')}</span></div>
      </div>
    </div>

    ${partSections}
    ${notesBlock}

    ${renderSignatureBar(
      [
        `العامل / المفتش${options.inspectorName ? ` (${options.inspectorName})` : ''}`,
        'اعتماد مشرف الجودة',
        'مسؤول الكنترول'
      ],
      true
    )}
  `;

  openUnifiedPrintWindow({
    documentTitle: `ورقة جرد يدوي - ${options.modelCode}`,
    mode: 'fit-single-page',
    orientation: useLandscape ? 'landscape' : 'portrait',
    header: {
      siteName: options.siteName,
      logo: options.logo,
      title: 'ورقة جرد وعد يدوي (فارغة)',
      subtitle: `قسم الفرز والجودة — ${options.stageLabel}`,
      metaItems: [`الموديل: ${options.modelCode}`],
      compact: true
    },
    bodyHtml,
    extraCss: `
      .thumb {
        width: ${useLandscape ? '92px' : '116px'};
        height: ${useLandscape ? '92px' : '116px'};
        flex: 0 0 auto;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        overflow: hidden;
        background: #f8fafc;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .thumb img { width: 100%; height: 100%; object-fit: contain; }
      .part-sec { margin-bottom: 5px; break-inside: avoid; page-break-inside: avoid; }
      table.qc-grid { table-layout: fixed; font-size: 10.5px; margin-bottom: 4px; }
      table.qc-grid th, table.qc-grid td { border: 1.2px solid #334155; padding: 3px 4px; }
      table.qc-grid th { background: #f1f5f9; font-size: 10px; }
      table.qc-grid td.c-color, table.qc-grid th.c-color { text-align: right; font-weight: 800; padding-right: 7px; font-size: 11px; }
      table.qc-grid td.cell { height: var(--cell-h, 46px); background: #ffffff !important; }
      table.qc-grid td.c-total { background: #f8fafc !important; }
      table.qc-grid col.col-color { width: ${useLandscape ? '15%' : '18%'}; }
      table.qc-grid col.col-total { width: ${useLandscape ? '10%' : '12%'}; }
    `,
    popupBlockedMessage: 'يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة ورقة الجرد اليدوي.'
  });
};
