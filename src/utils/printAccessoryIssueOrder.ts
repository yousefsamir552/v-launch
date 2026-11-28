/**
 * ورقة "إذن صرف إكسسوارات" رسمية جاهزة للطباعة (صفحة A4 واحدة صارمة — Single-Page A4) —
 * تُستخدم عند تسليم إكسسوارات موديل معيّن من مخزن الإكسسوارات إلى التشغيل،
 * موحّدة بالكامل مع محرك الطباعة الموحد `printShared.ts`.
 */

import {
  escapeHtml,
  getCurrentPrintUserName,
  logClientPrintAction,
  openUnifiedPrintWindow,
  renderSignatureBar,
  safeImageSrc
} from './printShared';

export interface AccessoryIssueOrderLine {
  accessory_name: string;
  accessory_code?: string;
  image?: string;
  target_type?: string;
  quantity: number;
  unit?: string;
  is_issued?: boolean;
}

export interface AccessoryIssueOrderOptions {
  siteName?: string;
  /** شعار المصنع من الإعدادات (رابط / Base64 / رمز). */
  logo?: string;
  modelCode: string;
  modelType?: string;
  targetQuantity?: number;
  issuedTo?: string;
  /** يُتجاهل للعرض: اسم أمين المخزن المنفذ ثابت دائماً على "فهيم". */
  issuedBy?: string;
  /** اسم المستخدم الذي قام بالطباعة (يُعرض في ترويسة الورقة بالأعلى). */
  printedBy?: string;
  /** تاريخ الصرف النصي؛ الافتراضي تاريخ اليوم. */
  date?: string;
  lines: AccessoryIssueOrderLine[];
  notes?: string;
}

const FIXED_WAREHOUSE_KEEPER_NAME = 'فهيم';

const PART_LABELS: Record<string, string> = {
  shirt: 'تيشرت',
  pants: 'بنطلون',
  jacket: 'جاكيت',
  single: 'قطعة واحدة'
};

const fmtNum = (value: number): string =>
  (Number.isFinite(value) ? value : 0).toLocaleString('en-US');

export const printAccessoryIssueOrder = (options: AccessoryIssueOrderOptions): void => {
  logClientPrintAction(
    'مخزن الإكسسوارات',
    `طباعة إذن صرف إكسسوارات للموديل ${options.modelCode}`,
    options.modelCode
  );
  const lines = Array.isArray(options.lines) ? options.lines : [];
  const today = options.date || new Date().toLocaleDateString('ar-EG-u-nu-latn');
  const totalQty = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
  const modelLabel = String(options.modelCode || '').trim() || '—';
  const printedBy = String(options.printedBy || '').trim() || getCurrentPrintUserName();

  const rows = lines.length
    ? lines
        .map((line, index) => {
          const part = PART_LABELS[String(line.target_type || '')] || 'تيشرت';
          const imgSrc = safeImageSrc(line.image);
          const imgCell = imgSrc
            ? `<img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(line.accessory_name || 'إكسسوار')}" class="acc-thumb" onerror="this.style.display='none'" />`
            : '<div class="acc-thumb-empty">بدون صورة</div>';
          return `<tr>
            <td class="num">${index + 1}</td>
            <td class="acc-img-cell">${imgCell}</td>
            <td class="mono">${escapeHtml(line.accessory_code || '—')}</td>
            <td class="text-right"><strong>${escapeHtml(line.accessory_name || '—')}</strong></td>
            <td>${escapeHtml(part)}</td>
            <td class="num"><strong>${fmtNum(Number(line.quantity) || 0)}</strong></td>
            <td>${escapeHtml(line.unit || 'قطعة')}</td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="7" class="muted" style="padding:12px;">لا توجد إكسسوارات مسجّلة لهذا الموديل</td></tr>`;

  const notesBlock =
    options.notes && String(options.notes).trim()
      ? `<div class="p-note-box">
           <div class="p-note-title">ملاحظات الصرف</div>
           <div class="p-note-body">${escapeHtml(options.notes)}</div>
         </div>`
      : '';

  const bodyHtml = `
    <div class="p-info-card">
      <div class="p-fields">
        <div class="p-field"><span class="p-k">كود الموديل</span><span class="p-v">${escapeHtml(modelLabel)}</span></div>
        <div class="p-field"><span class="p-k">نوع الموديل</span><span class="p-v">${escapeHtml(options.modelType || '—')}</span></div>
        <div class="p-field"><span class="p-k">العدد المستهدف</span><span class="p-v num">${fmtNum(Number(options.targetQuantity || 0))} قطعة</span></div>
        <div class="p-field"><span class="p-k">عدد أصناف الإكسسوار</span><span class="p-v num">${fmtNum(lines.length)} صنف</span></div>
        <div class="p-field"><span class="p-k">اسم المستلم</span><span class="p-v">${escapeHtml(options.issuedTo || '..................')}</span></div>
        <div class="p-field"><span class="p-k">أمين المخزن المنفّذ</span><span class="p-v">${FIXED_WAREHOUSE_KEEPER_NAME}</span></div>
        <div class="p-field full"><span class="p-k">تاريخ الصرف</span><span class="p-v num">${escapeHtml(today)}</span></div>
      </div>
    </div>

    ${notesBlock}

    <div class="p-sec">الإكسسوارات المصروفة للموديل</div>
    <table class="items">
      <colgroup>
        <col style="width:5%" />
        <col style="width:15%" />
        <col style="width:14%" />
        <col style="width:33%" />
        <col style="width:12%" />
        <col style="width:11%" />
        <col style="width:10%" />
      </colgroup>
      <thead>
        <tr>
          <th>م</th>
          <th>الصورة</th>
          <th>الكود</th>
          <th class="text-right">اسم الإكسسوار</th>
          <th>القسم</th>
          <th>الكمية</th>
          <th>الوحدة</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
      <tfoot>
        <tr class="total">
          <td colspan="5" class="text-right">الإجمالي</td>
          <td class="num">${fmtNum(totalQty)}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>

    ${renderSignatureBar(['أمين المخزن', 'المستلم', 'اعتماد الإدارة'], true)}
  `;

  openUnifiedPrintWindow({
    documentTitle: `إذن صرف إكسسوارات - ${modelLabel}`,
    mode: 'fit-single-page',
    orientation: 'portrait',
    header: {
      siteName: options.siteName,
      logo: options.logo,
      title: 'إذن صرف إكسسوارات',
      subtitle: 'مخزن الإكسسوارات والمستلزمات — تسليم إكسسوارات الموديل للتشغيل',
      printedBy,
      metaItems: [`الموديل: ${modelLabel}`],
      compact: true
    },
    bodyHtml,
    extraCss: `
      table.items { table-layout: fixed; font-size: 10.5px; }
      table.items td { padding: 4px 5px; }
      table.items td.acc-img-cell { padding: 4px; text-align: center; vertical-align: middle; }
      .acc-thumb {
        width: 80px;
        height: 80px;
        object-fit: contain;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        display: block;
        margin: 0 auto;
      }
      .acc-thumb-empty {
        width: 80px;
        height: 80px;
        margin: 0 auto;
        border: 1px dashed #cbd5e1;
        border-radius: 6px;
        background: #f8fafc;
        color: #94a3b8;
        font-size: 9px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
      }
    `,
    popupBlockedMessage: 'يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة إذن صرف الإكسسوارات.'
  });
};
