import { GarmentPart, getPartLabel } from '../types';

export interface ManualCountSheetPart {
  key: GarmentPart;
  colors: string[];
}

export interface ManualCountSheetOptions {
  siteName?: string;
  modelCode: string;
  modelType?: string;
  stageLabel: string;
  sizes: string[];
  parts: ManualCountSheetPart[];
  inspectorName?: string;
}

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Opens a print-ready A4 manual counting sheet (one blank color × size table per
 * garment part) so floor workers can count with a pen, independently per part.
 */
export const printManualCountSheet = (options: ManualCountSheetOptions): void => {
  const sizes = options.sizes.length > 0 ? options.sizes : ['S', 'M', 'L', 'XL'];
  const parts: ManualCountSheetPart[] =
    options.parts.length > 0
      ? options.parts
      : [{ key: 'shirt' as GarmentPart, colors: [] }];
  const today = new Date().toLocaleDateString('ar-EG');

  const partSections = parts
    .map((part) => {
      const colors = part.colors.length > 0 ? part.colors : ['', '', ''];
      const bodyRows = colors
        .map((color) => {
          const cells = sizes.map(() => '<td class="cell"></td>').join('');
          return `<tr>
            <td class="color">${escapeHtml(color)}</td>
            ${cells}
            <td class="cell total"></td>
            <td class="cell total"></td>
          </tr>`;
        })
        .join('');
      const headCells = sizes.map((s) => `<th>${escapeHtml(s)}</th>`).join('');
      return `
        <section class="part">
          <h3>القطعة: ${escapeHtml(getPartLabel(part.key))}</h3>
          <table>
            <thead>
              <tr>
                <th class="color">اللون / المقاس</th>
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

  const html = `<!DOCTYPE html>
  <html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <title>ورقة جرد يدوي - ${escapeHtml(options.modelCode)}</title>
    <style>
      @page { size: A4 portrait; margin: 12mm; }
      * { box-sizing: border-box; }
      body { font-family: "Tahoma", "Arial", sans-serif; color: #111; margin: 0; }
      header { text-align: center; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 14px; }
      header h1 { font-size: 18px; margin: 0 0 4px; }
      header h2 { font-size: 15px; margin: 0 0 4px; }
      .meta { display: flex; justify-content: space-between; font-size: 12px; margin-top: 6px; gap: 8px; flex-wrap: wrap; }
      .part { margin-bottom: 16px; page-break-inside: avoid; }
      .part h3 { font-size: 14px; margin: 0 0 6px; padding: 4px 8px; background: #eee; border: 1px solid #999; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { border: 1px solid #333; text-align: center; padding: 4px; }
      th { background: #f2f2f2; }
      td.color, th.color { text-align: right; min-width: 120px; font-weight: bold; }
      td.cell { height: 34px; }
      td.total { background: #fafafa; }
      .signatures { display: flex; justify-content: space-between; margin-top: 26px; font-size: 12px; gap: 20px; }
      .signatures div { width: 48%; border-top: 1px dashed #333; padding-top: 6px; }
    </style>
  </head>
  <body>
    <header>
      <h1>${escapeHtml(options.siteName || 'مصنع الملابس الجاهزة')} - قسم الفرز والجودة</h1>
      <h2>ورقة جرد وعد يدوي — ${escapeHtml(options.stageLabel)}</h2>
      <div class="meta">
        <span>كود الموديل: <strong>${escapeHtml(options.modelCode)}</strong></span>
        <span>النوع: <strong>${escapeHtml(options.modelType || '-')}</strong></span>
        <span>التاريخ: <strong>${escapeHtml(today)}</strong></span>
      </div>
    </header>
    ${partSections}
    <div class="signatures">
      <div>اسم العامل / المفتش: ${escapeHtml(options.inspectorName || '.......................................')}</div>
      <div>اعتماد مشرف الجودة: .......................................</div>
    </div>
    <script>
      window.onload = function () { window.focus(); window.print(); };
    </script>
  </body>
  </html>`;

  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) {
    alert('يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة ورقة الجرد اليدوي.');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
};
