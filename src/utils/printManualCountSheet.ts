import { GarmentPart, ImageCropRegion, getPartLabel } from '../types';
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
  /** منطقة قص مؤقتة للصورة (لا تُحفظ، للطباعة فقط). */
  imageCrop?: ImageCropRegion | null;
  modelCode: string;
  modelType?: string;
  stageLabel: string;
  sizes: string[];
  parts: ManualCountSheetPart[];
  inspectorName?: string;
  notes?: string;
}

export interface QCWorkerMatrixPart {
  key: GarmentPart;
  colors: string[];
  /** خريطة `${color}___${size}` -> { good, defect } */
  matrix: Record<string, { good: number; defect: number }>;
}

export interface QCWorkerMatrixSheetOptions {
  siteName?: string;
  logo?: string;
  imageUrl?: string;
  imageCrop?: ImageCropRegion | null;
  modelCode: string;
  modelType?: string;
  stageLabel: string;
  sizes: string[];
  parts: QCWorkerMatrixPart[];
  notes?: string;
}

/**
 * توحيد مسمى المرحلة للعرض البارز بأعلى ورقة الفرز:
 * «عد قبل الطباعة» / «عد بعد الطباعة» / «عد بعد المكن».
 */
export const normalizeQcBannerStageLabel = (rawLabel: string): string => {
  const clean = String(rawLabel || '').trim();
  if (!clean) return 'عد وفرز';
  if (clean.includes('قبل الطباعة')) return 'عد قبل الطباعة';
  if (clean.includes('بعد الطباعة')) return 'عد بعد الطباعة';
  if (clean.includes('بعد المكن')) return 'عد بعد المكن';
  return clean;
};

/**
 * شريط عنوان المرحلة الكبير والواضح جداً بأعلى كل ورقة فرز (22px Bold عالية التباين)
 * بحيث يميّز عامل الفرز نوع الورقة بنظرة واحدة دون أي لبس.
 */
export const renderQcStageBannerHtml = (stageLabel: string): string => {
  const prominentLabel = normalizeQcBannerStageLabel(stageLabel);
  return `
    <div class="qc-stage-banner" role="banner">
      <span class="qc-stage-banner-tag">مرحلة الفرز والعد</span>
      <span class="qc-stage-banner-title">${escapeHtml(prominentLabel)}</span>
    </div>
  `;
};

export const QC_STAGE_BANNER_CSS = `
  .qc-stage-banner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    background: #0f172a;
    color: #ffffff;
    border: 2.5px solid #0f172a;
    border-radius: 10px;
    padding: 8px 16px;
    margin: 0 0 8px 0;
    text-align: center;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .qc-stage-banner-tag {
    font-size: 11px;
    font-weight: 800;
    background: #ffffff;
    color: #0f172a;
    padding: 3px 10px;
    border-radius: 999px;
    letter-spacing: 0.2px;
    white-space: nowrap;
  }
  .qc-stage-banner-title {
    font-size: 22px;
    font-weight: 900;
    line-height: 1.15;
    letter-spacing: 0.3px;
  }
`;

/**
 * رسم صورة الموديل داخل بطاقة بيانات الورقة مع دعم كامل لمنطقة القص المؤقتة (ImageCropRegion).
 */
export const renderQcModelImageHtml = (
  imageUrl: string | undefined,
  imageCrop: ImageCropRegion | null | undefined,
  modelCode: string,
  boxSizePx: number
): string => {
  const imageSrc = safeImageSrc(imageUrl);
  if (!imageSrc) {
    return '<div class="thumb"><span class="muted">لا توجد صورة</span></div>';
  }

  if (
    !imageCrop ||
    imageCrop.natW <= 0 ||
    imageCrop.natH <= 0 ||
    imageCrop.w <= 0 ||
    imageCrop.h <= 0
  ) {
    return `<div class="thumb">
      <img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(modelCode)}" onerror="this.style.display='none'" />
    </div>`;
  }

  const innerMax = Math.max(40, boxSizePx - 4);
  const scale = Math.min(innerMax / imageCrop.w, innerMax / imageCrop.h);
  const boxW = Math.max(1, Math.round(imageCrop.w * scale));
  const boxH = Math.max(1, Math.round(imageCrop.h * scale));

  return `<div class="thumb">
    <div class="qc-cropbox" style="width:${boxW}px;height:${boxH}px;">
      <img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(modelCode)}"
        style="position:absolute;width:${Math.round(imageCrop.natW * scale)}px;height:${Math.round(
    imageCrop.natH * scale
  )}px;left:${Math.round(-imageCrop.x * scale)}px;top:${Math.round(
    -imageCrop.y * scale
  )}px;max-width:none;max-height:none;object-fit:fill;" />
    </div>
  </div>`;
};

/**
 * يحسب ارتفاع خانة الكتابة بالقلم ديناميكياً وفق إجمالي عدد الألوان والقطع واتجاه الصفحة
 * بحيث تظل الخانات مريحة للكتابة اليدوية وتتسع الورقة بالكامل (مع شريط المرحلة البارز والتوقيعات)
 * على صفحة A4 واحدة فقط.
 */
const computeCellHeightPx = (
  totalRows: number,
  partsCount: number,
  landscape: boolean
): number => {
  const safeRows = Math.max(1, totalRows);
  const availablePx = landscape ? 420 : 670;
  const overheadPerPart = 54;
  const usable = Math.max(160, availablePx - partsCount * overheadPerPart);
  const ideal = Math.floor(usable / safeRows);
  const minH = landscape ? 24 : 30;
  const maxH = landscape ? 56 : 78;
  return Math.max(minH, Math.min(maxH, ideal));
};

/**
 * Opens a print-ready single-page A4 manual counting sheet (one blank color × size table per
 * garment part) with bold stage header and optional cropped photo so floor workers can count with a pen.
 */
export const printManualCountSheet = (options: ManualCountSheetOptions): void => {
  const bannerLabel = normalizeQcBannerStageLabel(options.stageLabel);
  logClientPrintAction(
    'العد والجودة',
    `طباعة ورقة جرد يدوي (${bannerLabel}) للموديل ${options.modelCode}${
      options.imageCrop ? ' (مع قص الصورة)' : ''
    }`,
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
  const thumbPx = useLandscape ? 92 : 114;
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

  const imageBlock = renderQcModelImageHtml(
    options.imageUrl,
    options.imageCrop,
    options.modelCode,
    thumbPx
  );

  const notesBlock =
    options.notes && String(options.notes).trim()
      ? `<div class="p-note-box">
           <div class="p-note-title">ملاحظات الفرز</div>
           <div class="p-note-body">${escapeHtml(options.notes)}</div>
         </div>`
      : '';

  const bodyHtml = `
    ${renderQcStageBannerHtml(options.stageLabel)}

    <div class="p-info-card">
      ${imageBlock}
      <div class="p-fields">
        <div class="p-field"><span class="p-k">كود الموديل</span><span class="p-v">${escapeHtml(options.modelCode)}</span></div>
        <div class="p-field"><span class="p-k">نوع الموديل</span><span class="p-v">${escapeHtml(options.modelType || '—')}</span></div>
        <div class="p-field"><span class="p-k">مرحلة العد</span><span class="p-v"><strong>${escapeHtml(bannerLabel)}</strong></span></div>
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
    documentTitle: `ورقة جرد يدوي (${bannerLabel}) - ${options.modelCode}`,
    mode: 'fit-single-page',
    orientation: useLandscape ? 'landscape' : 'portrait',
    header: {
      siteName: options.siteName,
      logo: options.logo,
      title: 'ورقة جرد وعد يدوي (فارغة)',
      subtitle: `قسم الفرز والجودة — ${bannerLabel}`,
      metaItems: [`الموديل: ${options.modelCode}`],
      compact: true
    },
    bodyHtml,
    extraCss: `
      ${QC_STAGE_BANNER_CSS}
      .thumb {
        width: ${thumbPx}px;
        height: ${thumbPx}px;
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
      .qc-cropbox { position: relative; overflow: hidden; border-radius: 4px; background: #ffffff; }
      .part-sec { margin-bottom: 5px; break-inside: avoid; page-break-inside: avoid; }
      table.qc-grid { table-layout: fixed; font-size: 10.5px; margin-bottom: 4px; }
      table.qc-grid th, table.qc-grid td { border: 1.2px solid #334155; padding: 3px 4px; }
      table.qc-grid th { background: #f1f5f9; font-size: 10px; }
      table.qc-grid td.c-color, table.qc-grid th.c-color { text-align: right; font-weight: 800; padding-right: 7px; font-size: 11px; }
      table.qc-grid td.cell { height: var(--cell-h, 42px); background: #ffffff !important; }
      table.qc-grid td.c-total { background: #f8fafc !important; }
      table.qc-grid col.col-color { width: ${useLandscape ? '15%' : '18%'}; }
      table.qc-grid col.col-total { width: ${useLandscape ? '10%' : '12%'}; }
    `,
    popupBlockedMessage: 'يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة ورقة الجرد اليدوي.'
  });
};

/**
 * طباعة ورقة مصفوفة الفرز للعامل (بالأرقام المسجلة أو الخانات الفارغة) في صفحة A4 واحدة صارمة،
 * مع شريط عنوان مرحلة كبير وبارز ودعم قص صورة الموديل قبل الطباعة.
 */
export const printQCWorkerMatrixSheet = (options: QCWorkerMatrixSheetOptions): void => {
  const bannerLabel = normalizeQcBannerStageLabel(options.stageLabel);
  logClientPrintAction(
    'العد والجودة',
    `طباعة ورقة جرد الفرز (${bannerLabel}) للموديل ${options.modelCode}${
      options.imageCrop ? ' (مع قص الصورة)' : ''
    }`,
    options.modelCode
  );

  const sizes = options.sizes.length > 0 ? options.sizes : ['S', 'M', 'L', 'XL'];
  const parts = options.parts.length > 0 ? options.parts : [];
  const totalColorsCount = parts.reduce((sum, p) => sum + (p.colors?.length || 0), 0);
  const useLandscape = sizes.length > 5 || (parts.length > 1 && totalColorsCount > 6);
  const thumbPx = useLandscape ? 88 : 110;
  const today = new Date().toLocaleDateString('ar-EG');

  const partTablesHtml = parts
    .map((part) => {
      let partGoodTotal = 0;
      let partDefTotal = 0;

      const rowsHtml = part.colors.length
        ? part.colors
            .map((col) => {
              let rGood = 0;
              let rDef = 0;
              const sizeCells = sizes
                .map((sz) => {
                  const c = part.matrix[`${col}___${sz}`];
                  const g = Number(c?.good) || 0;
                  const d = Number(c?.defect) || 0;
                  rGood += g;
                  rDef += d;
                  if (g > 0 || d > 0) {
                    return `<td class="num"><span class="ok">${g}</span> / <span class="${
                      d > 0 ? 'bad' : 'muted'
                    }">${d}</span></td>`;
                  }
                  return '<td class="cell-blank"></td>';
                })
                .join('');
              partGoodTotal += rGood;
              partDefTotal += rDef;
              return `<tr>
                <td class="text-right"><strong>${escapeHtml(col)}</strong></td>
                ${sizeCells}
                <td class="num ok">${rGood > 0 ? rGood.toLocaleString('ar-EG') : '—'}</td>
                <td class="num ${rDef > 0 ? 'bad' : 'muted'}">${
                  rDef > 0 ? rDef.toLocaleString('ar-EG') : '—'
                }</td>
              </tr>`;
            })
            .join('')
        : `<tr><td colspan="${sizes.length + 3}" class="muted">لا توجد ألوان مسجلة لهذه القطعة</td></tr>`;

      return `<div class="part-wrap">
        <div class="p-sec">القطعة: ${escapeHtml(getPartLabel(part.key))} — الإجمالي (سليم: ${partGoodTotal.toLocaleString('ar-EG')} | هالك: ${partDefTotal.toLocaleString('ar-EG')})</div>
        <table class="qc-sheet-table">
          <thead>
            <tr>
              <th class="text-right" style="width:${useLandscape ? '15%' : '18%'}">اللون / المقاس</th>
              ${sizes
                .map((sz) => `<th>${escapeHtml(sz)}<div class="th-sub">سليم / تالف</div></th>`)
                .join('')}
              <th style="width:10%">المجموع السليم</th>
              <th style="width:9%">الهالك</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
          <tfoot>
            <tr class="total">
              <td class="text-right" colspan="${sizes.length + 1}">إجمالي ${escapeHtml(getPartLabel(part.key))}</td>
              <td class="num ok">${partGoodTotal.toLocaleString('ar-EG')}</td>
              <td class="num ${partDefTotal > 0 ? 'bad' : ''}">${partDefTotal.toLocaleString('ar-EG')}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
    })
    .join('');

  const imageBlock = renderQcModelImageHtml(
    options.imageUrl,
    options.imageCrop,
    options.modelCode,
    thumbPx
  );

  const notesBlock =
    options.notes && String(options.notes).trim()
      ? `<div class="p-note-box">
           <div class="p-note-title">ملاحظات الموديل</div>
           <div class="p-note-body">${escapeHtml(options.notes)}</div>
         </div>`
      : '';

  const bodyHtml = `
    ${renderQcStageBannerHtml(options.stageLabel)}

    <div class="p-info-card">
      ${imageBlock}
      <div class="p-fields">
        <div class="p-field"><span class="p-k">كود الموديل</span><span class="p-v">${escapeHtml(options.modelCode)}</span></div>
        <div class="p-field"><span class="p-k">نوع الموديل</span><span class="p-v">${escapeHtml(options.modelType || '—')}</span></div>
        <div class="p-field"><span class="p-k">مرحلة العد</span><span class="p-v"><strong>${escapeHtml(bannerLabel)}</strong></span></div>
        <div class="p-field"><span class="p-k">التاريخ</span><span class="p-v num">${escapeHtml(today)}</span></div>
        <div class="p-field full"><span class="p-k">القطع</span><span class="p-v">${escapeHtml(parts.map((p) => getPartLabel(p.key)).join(' + '))}</span></div>
        <div class="p-field full"><span class="p-k">المقاسات</span><span class="p-v chips">${sizes.map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join('')}</span></div>
      </div>
    </div>

    ${partTablesHtml}
    ${notesBlock}

    ${renderSignatureBar(['توقيع مستلم الفرز', 'اعتماد مشرف الجودة', 'توقيع الكنترول'], true)}
  `;

  openUnifiedPrintWindow({
    documentTitle: `ورقة جرد الفرز (${bannerLabel}) - ${options.modelCode}`,
    mode: 'fit-single-page',
    orientation: useLandscape ? 'landscape' : 'portrait',
    header: {
      siteName: options.siteName,
      logo: options.logo,
      title: `مصفوفة الفرز والعد — ${bannerLabel}`,
      subtitle: `قسم الفرز والكنترول والجودة — موديل ${options.modelCode}`,
      compact: true
    },
    bodyHtml,
    extraCss: `
      ${QC_STAGE_BANNER_CSS}
      .thumb {
        width: ${thumbPx}px;
        height: ${thumbPx}px;
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
      .qc-cropbox { position: relative; overflow: hidden; border-radius: 4px; background: #ffffff; }
      .part-wrap { margin-bottom: 5px; break-inside: avoid; page-break-inside: avoid; }
      table.qc-sheet-table { table-layout: fixed; font-size: 10px; margin-bottom: 4px; }
      table.qc-sheet-table th, table.qc-sheet-table td { border: 1.2px solid #334155; padding: 3.5px 4px; }
      table.qc-sheet-table td.cell-blank { height: 22px; background: #ffffff !important; }
      .th-sub { font-size: 8px; font-weight: 600; color: #475569; margin-top: 1px; }
    `,
    popupBlockedMessage: 'يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة ورقة الفرز.'
  });
};
