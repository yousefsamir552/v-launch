/**
 * ورقة "إذن صرف إكسسوارات" رسمية جاهزة للطباعة (صفحة A4 واحدة صارمة — Single-Page A4) —
 * تُستخدم عند تسليم إكسسوارات موديل معيّن من مخزن الإكسسوارات إلى التشغيل،
 * موحّدة بالكامل مع محرك الطباعة الموحد `printShared.ts`.
 */

import {
  escapeHtml,
  logClientPrintAction,
  openUnifiedPrintWindow,
  renderSignatureBar
} from './printShared';

export interface AccessoryIssueOrderLine {
  accessory_name: string;
  accessory_code?: string;
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
  issuedBy?: string;
  /** تاريخ الصرف النصي؛ الافتراضي تاريخ اليوم. */
  date?: string;
  lines: AccessoryIssueOrderLine[];
  notes?: string;
}

const PART_LABELS: Record<string, string> = {
  shirt: 'تيشرت',
  pants: 'بنطلون',
  jacket: 'جاكيت',
  single: 'قطعة واحدة'
};

const fmtNum = (value: number): string =>
  (Number.isFinite(value) ? value : 0).toLocaleString('ar-EG');

export const printAccessoryIssueOrder = (options: AccessoryIssueOrderOptions): void => {
  logClientPrintAction(
    'مخزن الإكسسوارات',
    `طباعة إذن صرف إكسسوارات للموديل ${options.modelCode}`,
    options.modelCode
  );
  const lines = Array.isArray(options.lines) ? options.lines : [];
  const today = options.date || new Date().toLocaleDateString('ar-EG');
  const totalQty = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
  const modelLabel = String(options.modelCode || '').trim() || '—';

  const rows = lines.length
    ? lines
        .map((line, index) => {
          const part = PART_LABELS[String(line.target_type || '')] || 'تيشرت';
          return `<tr>
            <td class="num">${index + 1}</td>
            <td class="mono">${escapeHtml(line.accessory_code || '—')}</td>
            <td class="text-right"><strong>${escapeHtml(line.accessory_name || '—')}</strong></td>
            <td>${escapeHtml(part)}</td>
            <td class="num"><strong>${fmtNum(Number(line.quantity) || 0)}</strong></td>
            <td>${escapeHtml(line.unit || 'قطعة')}</td>
            <td></td>
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
        <div class="p-field"><span class="p-k">أمين المخزن المنفّذ</span><span class="p-v">${escapeHtml(options.issuedBy || '..................')}</span></div>
        <div class="p-field full"><span class="p-k">تاريخ الصرف</span><span class="p-v num">${escapeHtml(today)}</span></div>
      </div>
    </div>

    ${notesBlock}

    <div class="p-sec">الإكسسوارات المصروفة للموديل</div>
    <table class="items">
      <colgroup>
        <col style="width:6%" />
        <col style="width:15%" />
        <col style="width:31%" />
        <col style="width:12%" />
        <col style="width:11%" />
        <col style="width:9%" />
        <col style="width:16%" />
      </colgroup>
      <thead>
        <tr>
          <th>م</th>
          <th>الكود</th>
          <th class="text-right">اسم الإكسسوار</th>
          <th>القسم</th>
          <th>الكمية</th>
          <th>الوحدة</th>
          <th>توقيع المستلم</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
      <tfoot>
        <tr class="total">
          <td colspan="4" class="text-right">الإجمالي</td>
          <td class="num">${fmtNum(totalQty)}</td>
          <td colspan="2"></td>
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
      metaItems: [`الموديل: ${modelLabel}`],
      compact: true
    },
    bodyHtml,
    extraCss: `
      table.items { table-layout: fixed; font-size: 10.5px; }
      table.items td { height: 26px; }
    `,
    popupBlockedMessage: 'يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة إذن صرف الإكسسوارات.'
  });
};
