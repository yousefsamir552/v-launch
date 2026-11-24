/**
 * ورقة "إذن صرف إكسسوارات" رسمية جاهزة للطباعة (A4) — تُستخدم عند تسليم
 * إكسسوارات موديل معيّن من مخزن الإكسسوارات إلى التشغيل.
 *
 * تحتوي على:
 *  - هيدر ببيانات المصنع + عنوان الإذن.
 *  - بيانات الموديل (الكود، النوع، العدد المستهدف) + اسم المستلم والمنفّذ والتاريخ.
 *  - جدول الإكسسوارات المصروفة (الكود، الاسم، القسم، الكمية، الوحدة، التوقيع).
 *  - ملاحظات + توقيعات (أمين المخزن / المستلم / الاعتماد).
 *
 * تتبع نفس نمط `printCuttingOrder` في المشروع (نافذة مستقلة + document.write + print).
 */

import { escapeHtml, PRINT_LOGO_CSS, renderLogoHtml } from './printShared';

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
  const lines = Array.isArray(options.lines) ? options.lines : [];
  const today = options.date || new Date().toLocaleDateString('ar-EG');
  const totalQty = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
  const modelLabel = String(options.modelCode || '').trim() || '—';

  const rows = lines.length
    ? lines
        .map((line, index) => {
          const part = PART_LABELS[String(line.target_type || '')] || 'تيشرت';
          return `<tr>
            <td class="c-idx">${index + 1}</td>
            <td class="c-code">${escapeHtml(line.accessory_code || '—')}</td>
            <td class="c-name">${escapeHtml(line.accessory_name || '—')}</td>
            <td class="c-part">${escapeHtml(part)}</td>
            <td class="c-qty">${fmtNum(Number(line.quantity) || 0)}</td>
            <td class="c-unit">${escapeHtml(line.unit || 'قطعة')}</td>
            <td class="c-sign"></td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="7" class="empty">لا توجد إكسسوارات مسجّلة لهذا الموديل</td></tr>`;

  const notesBlock = options.notes
    ? `<div class="notes">
         <div class="t">📝 ملاحظات</div>
         <div>${escapeHtml(options.notes)}</div>
       </div>`
    : '';

  const html = `<!DOCTYPE html>
  <html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <title>إذن صرف إكسسوارات - ${escapeHtml(modelLabel)}</title>
    <style>
      @page { size: A4 portrait; margin: 10mm; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body { font-family: "Tahoma", "Arial", sans-serif; color: #111; }
      .sheet { padding: 2mm; }

      header { text-align: center; border-bottom: 3px double #111; padding-bottom: 8px; margin-bottom: 12px; }
      header h1 { font-size: 20px; margin: 0 0 2px; letter-spacing: .5px; }
      header h2 { font-size: 14px; margin: 0; color: #333; font-weight: bold; }
      ${PRINT_LOGO_CSS}

      .info { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 18px; border: 1.5px solid #222; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; font-size: 13px; }
      .info .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; border-bottom: 1px dotted #bbb; padding: 5px 2px; }
      .info .row.full { grid-column: 1 / -1; }
      .info .k { color: #555; font-weight: bold; white-space: nowrap; }
      .info .v { font-weight: 900; text-align: left; }
      .muted { color: #888; font-weight: bold; }

      .notes { border: 1.5px solid #222; border-radius: 8px; padding: 8px 10px; min-height: 46px; margin-bottom: 12px; font-size: 13px; }
      .notes .t { font-weight: 900; margin-bottom: 4px; }

      h3.sec { font-size: 14px; margin: 0 0 6px; padding: 6px 8px; background: #ececec; border: 1.5px solid #222; border-radius: 6px; }

      table.items { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
      table.items th, table.items td { border: 1.2px solid #222; text-align: center; padding: 6px 4px; }
      table.items th { background: #f0f0f0; font-size: 12.5px; }
      table.items td { height: 32px; }
      table.items col.c-idx { width: 6%; }
      table.items col.c-code { width: 15%; }
      table.items col.c-name { width: 31%; }
      table.items col.c-part { width: 12%; }
      table.items col.c-qty { width: 11%; }
      table.items col.c-unit { width: 9%; }
      table.items col.c-sign { width: 16%; }
      table.items td.c-name { text-align: right; padding-right: 8px; font-weight: bold; }
      table.items tr.total td { font-weight: 900; background: #f7f7f7; height: 34px; }
      table.items td.empty { color: #888; font-weight: bold; padding: 14px; }

      .sign-row { display: flex; justify-content: space-between; gap: 24px; margin-top: 26px; font-size: 13px; }
      .sign-row div { flex: 1; border-top: 1px dashed #333; padding-top: 6px; text-align: center; font-weight: bold; }

      @media print {
        .sheet { padding: 0; }
        header { page-break-after: avoid; }
        table.items tr { page-break-inside: avoid; }
      }
    </style>
  </head>
  <body>
    <div class="sheet">
      <header>
        <div class="brand">${renderLogoHtml(options.logo, options.siteName, 54)}</div>
        <h1>${escapeHtml(options.siteName || 'مصنع الملابس الجاهزة')} — إذن صرف إكسسوارات</h1>
        <h2>مخزن الإكسسوارات والمستلزمات — تسليم إكسسوارات الموديل للتشغيل</h2>
      </header>

      <div class="info">
        <div class="row"><span class="k">كود الموديل</span><span class="v">${escapeHtml(modelLabel)}</span></div>
        <div class="row"><span class="k">نوع الموديل</span><span class="v">${escapeHtml(options.modelType || '—')}</span></div>
        <div class="row"><span class="k">العدد المستهدف</span><span class="v">${fmtNum(Number(options.targetQuantity || 0))} قطعة</span></div>
        <div class="row"><span class="k">عدد أصناف الإكسسوار</span><span class="v">${fmtNum(lines.length)} صنف</span></div>
        <div class="row"><span class="k">اسم المستلم</span><span class="v">${escapeHtml(options.issuedTo || '..................')}</span></div>
        <div class="row"><span class="k">أمين المخزن المنفّذ</span><span class="v">${escapeHtml(options.issuedBy || '..................')}</span></div>
        <div class="row full"><span class="k">تاريخ الصرف</span><span class="v">${escapeHtml(today)}</span></div>
      </div>

      ${notesBlock}

      <h3 class="sec">الإكسسوارات المصروفة للموديل</h3>
      <table class="items">
        <colgroup>
          <col class="c-idx" />
          <col class="c-code" />
          <col class="c-name" />
          <col class="c-part" />
          <col class="c-qty" />
          <col class="c-unit" />
          <col class="c-sign" />
        </colgroup>
        <thead>
          <tr>
            <th>م</th>
            <th>الكود</th>
            <th>اسم الإكسسوار</th>
            <th>القسم</th>
            <th>الكمية</th>
            <th>الوحدة</th>
            <th>توقيع المستلم</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr class="total">
            <td colspan="4">الإجمالي</td>
            <td>${fmtNum(totalQty)}</td>
            <td colspan="2"></td>
          </tr>
        </tbody>
      </table>

      <div class="sign-row">
        <div>أمين المخزن: ........................</div>
        <div>المستلم: ........................</div>
        <div>اعتماد الإدارة: ........................</div>
      </div>
    </div>
    <script>
      window.onload = function () { window.focus(); window.print(); };
    </script>
  </body>
  </html>`;

  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) {
    alert('يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة إذن صرف الإكسسوارات.');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
};

