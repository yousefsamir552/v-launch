/**
 * ورقة إنتاج التشطيب والتغليف والكارت (صفحة A4 واحدة صارمة — Single-Page A4) —
 * تستخدم محرك الطباعة الموحد `printShared.ts` لضمان احتواء كامل الورقة + جدول خامات التعبئة + التوقيعات
 * في صفحة A4 واحدة دون أي امتداد لصفحة ثانية، مع تسجيل دائم في سجل المراقبة (AuditLog).
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
  openUnifiedPrintWindow,
  renderSignatureBar,
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
  return Math.round(Number.isFinite(num) ? num : 0).toLocaleString('en-US');
};

const fmtQty = (val: unknown): string => {
  const num = Number(val || 0);
  return (Number.isFinite(num) ? Number(num.toFixed(3)) : 0).toLocaleString('en-US', {
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

  // جدول مراحل الأسمبلي
  const stageRows: string[] = [];
  if (finishingRecords.length) {
    finishingRecords.forEach((rec) => {
      stageRows.push(`<tr>
        <td><strong>التشطيب</strong> (${escapeHtml(rec.piece_label || getPartLabel(rec.part_type))})</td>
        <td>${escapeHtml(rec.vendor_name || '—')}</td>
        <td class="num">${fmtDate(rec.entry_date)}</td>
        <td class="num">${fmtDate(rec.expected_exit_date)}</td>
        <td class="num">${fmtDate(rec.actual_exit_date)}</td>
        <td class="${rec.is_received ? 'ok' : 'warn'}">${rec.is_received ? 'تم الاستلام' : 'قيد التنفيذ'}</td>
      </tr>`);
    });
  } else {
    stageRows.push(`<tr><td><strong>التشطيب</strong></td><td>—</td><td>—</td><td>—</td><td>—</td><td class="muted">لم يبدأ</td></tr>`);
  }

  if (ironingRecords.length) {
    ironingRecords.forEach((rec) => {
      stageRows.push(`<tr>
        <td><strong>المكواة</strong> (${escapeHtml(rec.part_label || getPartLabel(rec.part_type || 'shirt'))})</td>
        <td>${escapeHtml(rec.vendor_name || '—')}</td>
        <td class="num">${fmtDate(rec.entry_date)}</td>
        <td class="num">${fmtDate(rec.expected_exit_date)}</td>
        <td class="num">${fmtDate(rec.actual_exit_date)}</td>
        <td class="${rec.is_completed ? 'ok' : 'warn'}">${rec.is_completed ? 'مكتملة' : 'قيد التنفيذ'}</td>
      </tr>`);
    });
  } else {
    stageRows.push(`<tr><td><strong>المكواة</strong></td><td>—</td><td>—</td><td>—</td><td>—</td><td class="muted">لم يبدأ</td></tr>`);
  }

  stageRows.push(`<tr>
    <td><strong>التعبئة والتغليف</strong>${packagingRecord?.materials_deducted ? ' <span class="ok">(مخصومة)</span>' : ''}</td>
    <td>${escapeHtml(packagingRecord?.vendor_name || '—')}</td>
    <td class="num">${fmtDate(packagingRecord?.entry_date)}</td>
    <td class="num">${fmtDate(packagingRecord?.expected_exit_date)}</td>
    <td class="num">${fmtDate(packagingRecord?.actual_exit_date)}</td>
    <td class="${packagingRecord?.is_completed ? 'ok' : packagingRecord ? 'warn' : 'muted'}">${
      packagingRecord ? (packagingRecord.is_completed ? 'مكتملة' : 'قيد التنفيذ') : 'لم يبدأ'
    }</td>
  </tr>`);

  const destExpected = destRecord?.expected_pieces || expectedSets;
  const destCompleted = destRecord?.completed_pieces;
  const destShortage = destRecord?.shortage_pieces ?? 0;
  const destStatusText = destRecord
    ? `${destRecord.is_completed ? 'مكتملة' : 'قيد التنفيذ'}${
        destCompleted !== null && destCompleted !== undefined
          ? ` — منفذ: ${fmtInt(destCompleted)} / متوقع: ${fmtInt(destExpected)}${
              destShortage > 0 ? ` (عجز: ${fmtInt(destShortage)})` : ' (مطابق)'
            }`
          : ''
      }`
    : 'لم يبدأ';

  stageRows.push(`<tr>
    <td><strong>الدَست</strong></td>
    <td>${escapeHtml(destRecord?.vendor_name || '—')}</td>
    <td class="num">${fmtDate(destRecord?.entry_date)}</td>
    <td class="num">${fmtDate(destRecord?.expected_exit_date)}</td>
    <td class="num">${fmtDate(destRecord?.actual_exit_date)}</td>
    <td class="${destRecord?.is_completed ? 'ok' : destRecord ? 'warn' : 'muted'}">${escapeHtml(destStatusText)}</td>
  </tr>`);

  // متطلبات الأمبالاج
  const reqStepCells = PACKAGING_STEP_ORDER.map((step) => {
    const val =
      packagingRequirement?.steps?.[step] ||
      (packagingRequirement as any)?.[`${step}_date`] ||
      null;
    return `<tr>
      <td class="text-right"><strong>${escapeHtml(PACKAGING_STEP_LABELS[step])}</strong></td>
      <td class="${val ? 'ok' : 'muted'}">${val ? 'تم' : 'لم يتم'}</td>
      <td class="num">${fmtDate(val)}</td>
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
          <td class="num">${idx + 1}</td>
          <td class="text-right"><strong>${escapeHtml(item.name)}</strong></td>
          <td>${escapeHtml(item.spec)}</td>
          <td class="num">${fmtQty(item.consumption)}</td>
          <td class="num"><strong>${fmtQty(item.required)}</strong></td>
          <td>${escapeHtml(item.unit)}</td>
          <td class="${item.deducted ? 'ok' : 'warn'}">${item.deducted ? 'تم الخصم' : 'بانتظار الخصم'}</td>
        </tr>`
        )
        .join('')
    : `<tr><td colspan="7" class="muted">لا توجد قواعد خامات تغليف مفعّلة تنطبق على فئة مقاس هذا الموديل.</td></tr>`;

  const bodyHtml = `
    <div class="p-info-card">
      <div class="thumb">${thumbHtml}</div>
      <div class="p-fields">
        <div class="p-field"><span class="p-k">كود الموديل</span><span class="p-v">${escapeHtml(model.model_code)}</span></div>
        <div class="p-field"><span class="p-k">نوع / اسم الموديل</span><span class="p-v">${escapeHtml(model.model_type || '—')}</span></div>
        <div class="p-field"><span class="p-k">فئة المقاسات</span><span class="p-v">${escapeHtml(sizeCategoryName)}</span></div>
        <div class="p-field"><span class="p-k">الأطقم المتوقعة</span><span class="p-v num">${fmtInt(expectedSets)} طقم</span></div>
        <div class="p-field full"><span class="p-k">ورشة المكن (الخياطة)</span><span class="p-v">${escapeHtml(sewingWorkshopDisplay)}</span></div>
        <div class="p-field full"><span class="p-k">المقاسات المعتمدة</span><span class="p-v chips">${sizeChipsHtml}</span></div>
        <div class="p-field full"><span class="p-k">الألوان</span><span class="p-v chips">${colorChipsHtml}</span></div>
      </div>
    </div>

    <div class="p-sec">1. مراحل التشطيب والمكواة والتعبئة والدَست</div>
    <table class="asm-table">
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

    <div class="p-sec">2. حالة متطلبات الأمبالاج (التصوير والكارت / الباركود)</div>
    <div class="pkg-grid">
      <table class="asm-table">
        <thead>
          <tr>
            <th class="text-right">الخطوة</th>
            <th>الحالة</th>
            <th>التاريخ</th>
          </tr>
        </thead>
        <tbody>${reqStepCells}</tbody>
      </table>
      <div class="photo-summary">
        <div class="ps-row"><span>عينات التصوير المرسلة</span><strong class="num">${fmtInt(photoSent)} قطعة</strong></div>
        <div class="ps-row"><span>المستلمة من التصوير</span><strong class="num">${fmtInt(photoRecv)} قطعة</strong></div>
        <div class="ps-row"><span>عجز التصوير</span><strong class="num ${photoShort > 0 ? 'bad' : 'ok'}">${fmtInt(photoShort)} قطعة</strong></div>
        <div class="ps-row"><span>جاهزية الكارت والتغليف</span><strong class="${packagingRequirement?.is_complete ? 'ok' : 'warn'}">${
          packagingRequirement?.is_complete ? 'مكتملة' : 'ناقصة'
        }</strong></div>
      </div>
    </div>

    <div class="p-sec">3. خامات التعبئة والتغليف المطلوبة للموديل (${fmtInt(expectedSets)} طقم)</div>
    <table class="asm-table">
      <thead>
        <tr>
          <th style="width:5%">#</th>
          <th class="text-right" style="width:27%">الخامة</th>
          <th style="width:20%">المواصفات / المقاس</th>
          <th style="width:12%">الاستهلاك / طقم</th>
          <th style="width:13%">الإجمالي المطلوب</th>
          <th style="width:10%">الوحدة</th>
          <th style="width:13%">حالة الصرف</th>
        </tr>
      </thead>
      <tbody>${materialsRows}</tbody>
    </table>

    ${renderSignatureBar(
      ['مسؤول التشطيب', 'مسؤول المكواة', 'مسؤول التعبئة والتغليف', 'مسؤول الدَست', 'مدير الإنتاج'],
      true
    )}
  `;

  logClientPrintAction(
    'الأسمبلي والأمبالاج',
    `طباعة ورقة إنتاج التشطيب والتغليف والكارت للموديل ${model.model_code}`,
    model.model_code
  );

  openUnifiedPrintWindow({
    documentTitle: `ورقة إنتاج التشطيب والتغليف والكارت - ${model.model_code}`,
    mode: 'fit-single-page',
    orientation: 'portrait',
    header: {
      siteName,
      logo,
      title: 'ورقة إنتاج التشطيب والتغليف والكارت',
      subtitle: `قسم الأسمبلي والأمبالاج — موديل ${model.model_code}`,
      metaItems: [`الأطقم المتوقعة: ${fmtInt(expectedSets)} طقم`],
      compact: true
    },
    bodyHtml,
    extraCss: `
      .thumb {
        width: 112px;
        height: 116px;
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        overflow: hidden;
        background: #f8fafc;
      }
      .thumb img { width: 100%; height: 100%; object-fit: contain; }
      table.asm-table { font-size: 9.5px; margin-bottom: 5px; }
      table.asm-table th, table.asm-table td { padding: 3px 5px; }
      .pkg-grid {
        display: grid;
        grid-template-columns: 1.35fr 0.65fr;
        gap: 7px;
        align-items: stretch;
        margin-bottom: 5px;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .pkg-grid table.asm-table { margin-bottom: 0; }
      .photo-summary {
        border: 1px solid #94a3b8;
        border-radius: 5px;
        padding: 6px 8px;
        background: #f8fafc;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        font-size: 9.5px;
      }
      .ps-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 6px;
        border-bottom: 1px dotted #cbd5e1;
        padding: 3px 0;
      }
      .ps-row:last-child { border-bottom: none; }
    `,
    popupBlockedMessage: 'يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة ورقة الإنتاج.'
  });
};
