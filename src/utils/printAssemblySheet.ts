/**
 * ورقة إنتاج التشطيب والتغليف والكارت (A4) — بنفس نظافة وتنسيق ورقة المكن (`printSewingSheet.ts`).
 * تسجّل عملية الطباعة تلقائياً في سجل المراقبة (AuditLog) عبر `logClientPrintAction`.
 */
import type {
  AssemblyStageRecord,
  DesignModel,
  FinishingRecord,
  PackagingMaterialRule,
  PackagingRequirement,
  SewingDispatch
} from '../types';
import { getPartLabel, PACKAGING_STEP_LABELS, PACKAGING_STEP_ORDER } from '../types';
import { modelPackagingPieces } from './packagingMaterials';
import {
  escapeHtml,
  logClientPrintAction,
  PRINT_LOGO_CSS,
  renderLogoHtml,
  safeImageSrc
} from './printShared';

export interface AssemblyProductionSheetOptions {
  siteName?: string;
  logo?: string;
  model: DesignModel;
  sizeCategoryName?: string;
  sizes?: string[];
  colors?: string[];
  sewingDispatches?: SewingDispatch[];
  finishingRecords?: FinishingRecord[];
  assemblyStageRecords?: AssemblyStageRecord[];
  packagingRequirement?: PackagingRequirement | null;
  packagingMaterialRules?: PackagingMaterialRule[];
}

const fmtInt = (val: unknown): string => {
  const num = Number(val || 0);
  return Math.round(Number.isFinite(num) ? num : 0).toLocaleString('ar-EG');
};

const fmtQty = (val: unknown): string => {
  const num = Number(val || 0);
  return (Number.isFinite(num) ? Number(num.toFixed(3)) : 0).toLocaleString('ar-EG', {
    maximumFractionDigits: 3
  });
};

const fmtDate = (val?: string | null): string => (val ? String(val).slice(0, 10) : '—');

interface RequiredMaterialLine {
  name: string;
  spec: string;
  consumption: number;
  required: number;
  unit: string;
  deducted: boolean;
}

const computeRequiredPackagingMaterials = (
  model: DesignModel,
  expectedSets: number,
  rules: PackagingMaterialRule[],
  packagingRecord?: AssemblyStageRecord
): RequiredMaterialLine[] => {
  if (
    packagingRecord?.materials_deducted &&
    Array.isArray(packagingRecord.materials_deducted_details) &&
    packagingRecord.materials_deducted_details.length > 0
  ) {
    return packagingRecord.materials_deducted_details.map((item) => ({
      name: item.material_name,
      spec: item.dimensions_spec || item.size_group_name || '—',
      consumption: expectedSets > 0 ? Number((item.amount / expectedSets).toFixed(3)) : 0,
      required: item.amount,
      unit: item.unit || 'قطعة',
      deducted: true
    }));
  }

  const lines: RequiredMaterialLine[] = [];
  const modelGroup = (model.size_category_id || '').trim();

  (rules || [])
    .filter((rule) => rule.is_active)
    .forEach((rule) => {
      const sizeRules = rule.size_rules || [];
      if (!sizeRules.length) return;
      const applicable = (rule.applicable_size_groups || []).filter(Boolean);
      let matched = sizeRules.filter(
        (sr) => sr.size_group_id && modelGroup && sr.size_group_id === modelGroup
      );
      if (!matched.length) {
        const general = sizeRules.filter((sr) => !sr.size_group_id);
        if (general.length && (!applicable.length || (modelGroup && applicable.includes(modelGroup)))) {
          matched = general;
        }
      }
      matched.forEach((sr) => {
        const perPiece = Number(sr.consumption_per_piece || 0);
        if (perPiece <= 0) return;
        const required = Number((expectedSets * perPiece).toFixed(3));
        if (required <= 0) return;
        lines.push({
          name: rule.name,
          spec: sr.dimensions_spec || sr.size_group_name || 'كل المقاسات',
          consumption: perPiece,
          required,
          unit: rule.unit || 'قطعة',
          deducted: Boolean(packagingRecord?.materials_deducted)
        });
      });
    });

  return lines;
};

export const printAssemblyProductionSheet = (options: AssemblyProductionSheetOptions): void => {
  const {
    siteName = 'مصنع الملابس الجاهزة',
    logo,
    model,
    sizeCategoryName = '—',
    sizes = [],
    colors = [],
    sewingDispatches = [],
    finishingRecords = [],
    assemblyStageRecords = [],
    packagingRequirement,
    packagingMaterialRules = []
  } = options;

  const expectedSets = modelPackagingPieces(model);
  const ironingRecords = assemblyStageRecords.filter((r) => r.stage === 'ironing');
  const packagingRecord = assemblyStageRecords.find((r) => r.stage === 'packaging');
  const destRecord = assemblyStageRecords.find((r) => r.stage === 'dest');

  // جمع أسماء ورش المكن التي عملت على الموديل
  const sewingWorkshopsList = Array.from(
    new Set(
      [
        ...sewingDispatches.map((d) =>
          d.piece_label || d.piece_type
            ? `${d.workshop_name} (${d.piece_label || getPartLabel(d.piece_type)})`
            : d.workshop_name
        ),
        model.sewing_workshop || ''
      ].filter(Boolean)
    )
  );
  const sewingWorkshopDisplay = sewingWorkshopsList.length ? sewingWorkshopsList.join(' • ') : '—';

  const requiredMaterials = computeRequiredPackagingMaterials(
    model,
    expectedSets,
    packagingMaterialRules,
    packagingRecord
  );

  const imageSrc = safeImageSrc(model.image);
  const thumbHtml = imageSrc
    ? `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(model.model_code)}" onerror="this.style.display='none'" />`
    : '<div class="muted">لا توجد صورة</div>';

  const sizeChipsHtml = sizes.length
    ? sizes.map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join('')
    : '<span class="muted">غير محددة</span>';

  const colorChipsHtml = colors.length
    ? colors.map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join('')
    : '<span class="muted">غير محددة</span>';

  // جدول مراحل الأسمبلي (التشطيب / المكواة / التعبئة / الدَست)
  const stageRows: string[] = [];
  if (finishingRecords.length) {
    finishingRecords.forEach((rec) => {
      stageRows.push(`<tr>
        <td><strong>التشطيب</strong> (${escapeHtml(rec.piece_label || getPartLabel(rec.part_type))})</td>
        <td>${escapeHtml(rec.vendor_name || '—')}</td>
        <td>${fmtDate(rec.entry_date)}</td>
        <td>${fmtDate(rec.expected_exit_date)}</td>
        <td>${fmtDate(rec.actual_exit_date)}</td>
        <td>${rec.is_received ? '✅ تم الاستلام' : '⏳ قيد التنفيذ'}</td>
      </tr>`);
    });
  } else {
    stageRows.push(`<tr><td><strong>التشطيب</strong></td><td>—</td><td>—</td><td>—</td><td>—</td><td>لم يبدأ</td></tr>`);
  }

  if (ironingRecords.length) {
    ironingRecords.forEach((rec) => {
      stageRows.push(`<tr>
        <td><strong>المكواة</strong> (${escapeHtml(rec.part_label || getPartLabel(rec.part_type || 'shirt'))})</td>
        <td>${escapeHtml(rec.vendor_name || '—')}</td>
        <td>${fmtDate(rec.entry_date)}</td>
        <td>${fmtDate(rec.expected_exit_date)}</td>
        <td>${fmtDate(rec.actual_exit_date)}</td>
        <td>${rec.is_completed ? '✅ مكتملة' : '⏳ قيد التنفيذ'}</td>
      </tr>`);
    });
  } else {
    stageRows.push(`<tr><td><strong>المكواة</strong></td><td>—</td><td>—</td><td>—</td><td>—</td><td>لم يبدأ</td></tr>`);
  }

  stageRows.push(`<tr>
    <td><strong>التعبئة والتغليف</strong>${packagingRecord?.materials_deducted ? ' <span class="badge-ok">(خامات مخصومة)</span>' : ''}</td>
    <td>${escapeHtml(packagingRecord?.vendor_name || '—')}</td>
    <td>${fmtDate(packagingRecord?.entry_date)}</td>
    <td>${fmtDate(packagingRecord?.expected_exit_date)}</td>
    <td>${fmtDate(packagingRecord?.actual_exit_date)}</td>
    <td>${packagingRecord ? (packagingRecord.is_completed ? '✅ مكتملة' : '⏳ قيد التنفيذ') : 'لم يبدأ'}</td>
  </tr>`);

  const destExpected = destRecord?.expected_pieces || expectedSets;
  const destCompleted = destRecord?.completed_pieces;
  const destShortage = destRecord?.shortage_pieces ?? 0;
  const destStatusText = destRecord
    ? `${destRecord.is_completed ? '✅ مكتملة' : '⏳ قيد التنفيذ'}${
        destCompleted !== null && destCompleted !== undefined
          ? ` — منفذ: ${fmtInt(destCompleted)} / متوقع: ${fmtInt(destExpected)}${
              destShortage > 0 ? ` (عجز: ${fmtInt(destShortage)})` : ' (بدون عجز)'
            }`
          : ''
      }`
    : 'لم يبدأ';

  stageRows.push(`<tr>
    <td><strong>الدَست</strong></td>
    <td>${escapeHtml(destRecord?.vendor_name || '—')}</td>
    <td>${fmtDate(destRecord?.entry_date)}</td>
    <td>${fmtDate(destRecord?.expected_exit_date)}</td>
    <td>${fmtDate(destRecord?.actual_exit_date)}</td>
    <td>${escapeHtml(destStatusText)}</td>
  </tr>`);

  // متطلبات الأمبالاج (التصوير والكارت/الباركود)
  const reqStepCells = PACKAGING_STEP_ORDER.map((step) => {
    const val =
      packagingRequirement?.steps?.[step] ||
      (packagingRequirement as any)?.[`${step}_date`] ||
      null;
    return `<tr>
      <td><strong>${escapeHtml(PACKAGING_STEP_LABELS[step])}</strong></td>
      <td>${val ? '✅ تم' : '⏳ لم يتم'}</td>
      <td>${fmtDate(val)}</td>
    </tr>`;
  }).join('');

  const photoSent = Number(packagingRequirement?.photography_sent_qty || 0);
  const photoRecv = Number(packagingRequirement?.photography_received_qty || 0);
  const photoShort = Number(packagingRequirement?.photography_shortage || 0);

  // جدول خامات التعبئة المطلوبة
  const materialsRows = requiredMaterials.length
    ? requiredMaterials
        .map(
          (item, idx) => `<tr>
          <td>${idx + 1}</td>
          <td class="r"><strong>${escapeHtml(item.name)}</strong></td>
          <td>${escapeHtml(item.spec)}</td>
          <td>${fmtQty(item.consumption)}</td>
          <td><strong>${fmtQty(item.required)}</strong></td>
          <td>${escapeHtml(item.unit)}</td>
          <td>${item.deducted ? '✅ تم الخصم' : 'بانتظار الخصم'}</td>
        </tr>`
        )
        .join('')
    : `<tr><td colspan="7" class="muted">لا توجد قواعد خامات تغليف مفعّلة تنطبق على فئة مقاس هذا الموديل.</td></tr>`;

  const html = `<!DOCTYPE html>
  <html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <title>ورقة إنتاج التشطيب والتغليف والكارت - ${escapeHtml(model.model_code)}</title>
    <style>
      @page { size: A4 portrait; margin: 10mm; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body { font-family: "Tahoma", "Arial", sans-serif; color: #111; font-size: 12px; }
      .sheet { padding: 2mm; }
      header { text-align: center; border-bottom: 3px double #111; padding-bottom: 8px; margin-bottom: 10px; }
      header h1 { font-size: 18px; margin: 2px 0; }
      header h2 { font-size: 13px; margin: 0; color: #333; font-weight: bold; }
      .meta { font-size: 10.5px; color: #555; margin-top: 3px; }
      ${PRINT_LOGO_CSS}

      .info { display: flex; gap: 12px; align-items: stretch; border: 1.5px solid #222; border-radius: 8px; padding: 10px; margin-bottom: 10px; }
      .info .thumb { width: 145px; flex: 0 0 auto; display: flex; align-items: center; justify-content: center; border: 1px solid #bbb; border-radius: 8px; overflow: hidden; background: #f7f7f7; }
      .info .thumb img { width: 100%; height: 155px; object-fit: contain; }
      .info .fields { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; align-content: start; }
      .info .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; border-bottom: 1px dotted #bbb; padding: 4px 2px; }
      .info .row.full { grid-column: 1 / -1; }
      .info .k { color: #555; font-weight: bold; white-space: nowrap; }
      .info .v { font-weight: 900; text-align: left; }
      .chips { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }
      .chip { border: 1px solid #222; border-radius: 4px; padding: 1px 7px; font-size: 11px; font-weight: bold; background: #f3f3f3; }
      .muted { color: #777; font-weight: bold; text-align: center; }
      .badge-ok { font-size: 10px; font-weight: bold; color: #047857; }

      h3.sec { font-size: 13px; margin: 10px 0 5px; padding: 5px 8px; background: #ececec; border: 1.2px solid #222; border-radius: 6px; }
      table { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-bottom: 8px; }
      th, td { border: 1px solid #333; padding: 5px 6px; text-align: center; }
      th { background: #f1f5f9; font-weight: bold; }
      td.r { text-align: right; }

      .photo-bar { display: flex; justify-content: space-between; gap: 10px; border: 1px solid #444; border-radius: 6px; padding: 6px 10px; background: #f8fafc; font-size: 11px; margin-bottom: 8px; }

      .sigs { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-top: 14px; page-break-inside: avoid; }
      .sig { border: 1.2px solid #222; border-radius: 6px; padding: 8px 6px 26px; text-align: center; font-size: 11px; font-weight: bold; }

      @media print {
        .sheet { padding: 0; }
        .info, table, .sigs { page-break-inside: avoid; }
      }
    </style>
  </head>
  <body>
    <div class="sheet">
      <header>
        <div class="brand">${renderLogoHtml(logo, siteName, 48)}</div>
        <h1>${escapeHtml(siteName)}</h1>
        <h2>ورقة إنتاج التشطيب والتغليف والكارت</h2>
        <div class="meta">تاريخ الطباعة: ${escapeHtml(new Date().toLocaleString('ar-EG'))}</div>
      </header>

      <div class="info">
        <div class="thumb">${thumbHtml}</div>
        <div class="fields">
          <div class="row"><span class="k">كود الموديل</span><span class="v">${escapeHtml(model.model_code)}</span></div>
          <div class="row"><span class="k">نوع / اسم الموديل</span><span class="v">${escapeHtml(model.model_type || '—')}</span></div>
          <div class="row"><span class="k">فئة المقاسات</span><span class="v">${escapeHtml(sizeCategoryName)}</span></div>
          <div class="row"><span class="k">الأطقم المتوقعة</span><span class="v">${fmtInt(expectedSets)} طقم</span></div>
          <div class="row full"><span class="k">ورشة المكن (الخياطة)</span><span class="v">${escapeHtml(sewingWorkshopDisplay)}</span></div>
          <div class="row full"><span class="k">المقاسات المعتمدة</span><span class="v chips">${sizeChipsHtml}</span></div>
          <div class="row full"><span class="k">الألوان</span><span class="v chips">${colorChipsHtml}</span></div>
        </div>
      </div>

      <h3 class="sec">1. مراحل التشطيب والمكواة والتعبئة والدَست</h3>
      <table>
        <thead>
          <tr>
            <th>المرحلة</th>
            <th>الجهة / الورشة</th>
            <th>تاريخ الدخول</th>
            <th>الخروج المتوقع</th>
            <th>الخروج الفعلي</th>
            <th>الحالة / العدد</th>
          </tr>
        </thead>
        <tbody>${stageRows.join('')}</tbody>
      </table>

      <h3 class="sec">2. حالة متطلبات الأمبالاج (التصوير والكارت / الباركود)</h3>
      <table>
        <thead>
          <tr>
            <th>الخطوة</th>
            <th>الحالة</th>
            <th>التاريخ</th>
          </tr>
        </thead>
        <tbody>${reqStepCells}</tbody>
      </table>
      <div class="photo-bar">
        <span><strong>عينات التصوير المرسلة:</strong> ${fmtInt(photoSent)} قطعة</span>
        <span><strong>المستلمة من التصوير:</strong> ${fmtInt(photoRecv)} قطعة</span>
        <span><strong>عجز التصوير:</strong> ${fmtInt(photoShort)} قطعة</span>
        <span><strong>جاهزية الكارت والتغليف:</strong> ${packagingRequirement?.is_complete ? '✅ مكتملة' : '⏳ ناقصة'}</span>
      </div>

      <h3 class="sec">3. خامات التعبئة والتغليف المطلوبة للموديل (${fmtInt(expectedSets)} طقم)</h3>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>الخامة</th>
            <th>المواصفات / المقاس</th>
            <th>الاستهلاك / طقم</th>
            <th>الإجمالي المطلوب</th>
            <th>الوحدة</th>
            <th>حالة الصرف</th>
          </tr>
        </thead>
        <tbody>${materialsRows}</tbody>
      </table>

      <div class="sigs">
        <div class="sig">مسؤول التشطيب</div>
        <div class="sig">مسؤول المكواة</div>
        <div class="sig">مسؤول التعبئة والتغليف</div>
        <div class="sig">مسؤول الدَست</div>
        <div class="sig">مدير الإنتاج</div>
      </div>
    </div>
    <script>
      window.onload = function () { window.focus(); window.print(); };
    </script>
  </body>
  </html>`;

  logClientPrintAction(
    'الأسمبلي والأمبالاج',
    `طباعة ورقة إنتاج التشطيب والتغليف والكارت للموديل ${model.model_code}`,
    model.model_code
  );

  const win = window.open('', '_blank', 'width=950,height=1050');
  if (!win) {
    alert('يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة ورقة الإنتاج.');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
};
