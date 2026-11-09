/**
 * ورقة "أوردر قص" رسمية جاهزة للطباعة (A4) — تحتوي على:
 *  - هيدر ببيانات الموديل (صورة، كود، نوع، العدد المستهدف، المقاسات المعتمدة، ملاحظات التصميم).
 *  - جدول ورشة سفلي فارغ لتسجيل الرقات يدوياً بالقلم أثناء سحب القماش.
 *
 * تتبع نفس نمط `printManualCountSheet` في المشروع (نافذة مستقلة + document.write + window.print).
 */

export interface CuttingOrderOptions {
  siteName?: string;
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

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmtInt = (value: number): string =>
  Math.round(Number.isFinite(value) ? value : 0).toLocaleString('ar-EG');

export const printCuttingOrder = (options: CuttingOrderOptions): void => {
  const sizes = Array.isArray(options.sizes) ? options.sizes.filter(Boolean) : [];
  const today = new Date().toLocaleDateString('ar-EG');
  const blankRows = Math.max(6, Math.min(30, options.blankRows ?? 14));

  const sizeChips =
    sizes.length > 0
      ? sizes.map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join('')
      : '<span class="muted">غير محددة</span>';

  const imageBlock = options.imageUrl
    ? `<img src="${escapeHtml(options.imageUrl)}" alt="${escapeHtml(
        options.modelCode
      )}" onerror="this.style.display='none'" />`
    : '<div class="muted" style="display:flex;align-items:center;justify-content:center;height:100%;">لا توجد صورة</div>';

  const notesBlock = options.designNotes
    ? `<div class="notes">
         <div class="t">📝 ملاحظات التصميم</div>
         <div>${escapeHtml(options.designNotes)}</div>
       </div>`
    : '';

  const emptyRows = Array.from({ length: blankRows })
    .map(
      () => `<tr>
        <td class="c-color"></td>
        <td class="c-layers"></td>
        <td class="c-weight"></td>
        <td class="c-sign"></td>
      </tr>`
    )
    .join('');

  const html = `<!DOCTYPE html>
  <html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <title>أوردر قص - ${escapeHtml(options.modelCode)}</title>
    <style>
      @page { size: A4 portrait; margin: 10mm; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body { font-family: "Tahoma", "Arial", sans-serif; color: #111; }
      .sheet { padding: 2mm; }

      header { text-align: center; border-bottom: 3px double #111; padding-bottom: 8px; margin-bottom: 12px; }
      header h1 { font-size: 20px; margin: 0 0 2px; letter-spacing: .5px; }
      header h2 { font-size: 14px; margin: 0; color: #333; font-weight: bold; }

      .info { display: flex; gap: 14px; align-items: stretch; border: 1.5px solid #222; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
      .info .thumb { width: 112px; height: 112px; flex: 0 0 auto; border: 1px solid #bbb; border-radius: 8px; overflow: hidden; background: #f7f7f7; }
      .info .thumb img { width: 100%; height: 100%; object-fit: contain; }
      .info .fields { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 18px; font-size: 13px; align-content: start; }
      .info .fields .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; border-bottom: 1px dotted #bbb; padding: 5px 2px; }
      .info .fields .row.full { grid-column: 1 / -1; }
      .info .fields .k { color: #555; font-weight: bold; white-space: nowrap; }
      .info .fields .v { font-weight: 900; text-align: left; }
      .chips { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }
      .chip { border: 1px solid #222; border-radius: 5px; padding: 1px 8px; font-size: 12px; font-weight: bold; background: #f3f3f3; }
      .muted { color: #888; font-weight: bold; }

      .notes { border: 1.5px solid #222; border-radius: 8px; padding: 8px 10px; min-height: 46px; margin-bottom: 12px; font-size: 13px; }
      .notes .t { font-weight: 900; margin-bottom: 4px; }

      h3.sec { font-size: 14px; margin: 0 0 6px; padding: 6px 8px; background: #ececec; border: 1.5px solid #222; border-radius: 6px; }

      table.workshop { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
      table.workshop th, table.workshop td { border: 1.2px solid #222; text-align: center; padding: 6px 4px; }
      table.workshop th { background: #f0f0f0; font-size: 12.5px; }
      table.workshop td { height: 34px; }
      table.workshop col.c-color { width: 30%; }
      table.workshop col.c-layers { width: 16%; }
      table.workshop col.c-weight { width: 16%; }
      table.workshop col.c-sign { width: 38%; }
      table.workshop td.c-color { text-align: right; padding-right: 8px; }

      .sign-row { display: flex; justify-content: space-between; gap: 24px; margin-top: 26px; font-size: 13px; }
      .sign-row div { flex: 1; border-top: 1px dashed #333; padding-top: 6px; text-align: center; font-weight: bold; }

      @media print {
        .sheet { padding: 0; }
        header { page-break-after: avoid; }
        table.workshop tr { page-break-inside: avoid; }
      }
    </style>
  </head>
  <body>
    <div class="sheet">
      <header>
        <h1>${escapeHtml(options.siteName || 'مصنع الملابس الجاهزة')} — أوردر قص</h1>
        <h2>قسم القص — ورقة تسجيل الرقات (الورشة)</h2>
      </header>

      <div class="info">
        <div class="thumb">${imageBlock}</div>
        <div class="fields">
          <div class="row"><span class="k">كود الموديل</span><span class="v">${escapeHtml(
            options.modelCode
          )}</span></div>
          <div class="row"><span class="k">نوع الموديل</span><span class="v">${escapeHtml(
            options.modelType || 'أولادي'
          )}</span></div>
          <div class="row"><span class="k">العدد المستهدف للقص</span><span class="v">${fmtInt(
            Number(options.targetQuantity || 0)
          )} قطعة</span></div>
          <div class="row"><span class="k">فئة المقاسات</span><span class="v">${escapeHtml(
            options.sizeCategoryName || '—'
          )}</span></div>
          <div class="row full"><span class="k">المقاسات المعتمدة</span><span class="v chips">${sizeChips}</span></div>
          <div class="row"><span class="k">التاريخ</span><span class="v">${escapeHtml(today)}</span></div>
          <div class="row"><span class="k">اسم القصاص</span><span class="v">${escapeHtml(
            options.cutterName || '..................'
          )}</span></div>
        </div>
      </div>

      ${notesBlock}

      <h3 class="sec">جدول تسجيل الرقات (العمل اليدوي للقصاص)</h3>
      <table class="workshop">
        <colgroup>
          <col class="c-color" />
          <col class="c-layers" />
          <col class="c-weight" />
          <col class="c-sign" />
        </colgroup>
        <thead>
          <tr>
            <th>الألوان</th>
            <th>عدد الرقات</th>
            <th>وزن الراق</th>
            <th>توقيع القصاص / الملاحظات</th>
          </tr>
        </thead>
        <tbody>${emptyRows}</tbody>
      </table>

      <div class="sign-row">
        <div>اسم القصاص: ........................</div>
        <div>اعتماد المشرف: ........................</div>
        <div>التاريخ: ........................</div>
      </div>
    </div>
    <script>
      window.onload = function () { window.focus(); window.print(); };
    </script>
  </body>
  </html>`;

  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) {
    alert('يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة أوردر القص.');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
};

