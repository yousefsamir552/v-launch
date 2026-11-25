/**
 * طباعة «بطاقة الموديل الشاملة» (صفحة A4 واحدة مضغوطة — Single-Page A4) —
 * تجمع كل بيانات الموديل (القص، المطابع، المكن، الجودة، التشطيب والتغليف، التصوير والباركود، والتوقيعات)
 * في ورقة A4 واحدة نظيفة ومنسقة مع هيدر المصنع الموحد وسجل المراقبة.
 */
import type {
  AssemblyStageRecord,
  CuttingRecord,
  DesignModel,
  Fabric,
  FabricColor,
  FinishingRecord,
  GarmentPart,
  ModelRequirement,
  PackagingRequirement,
  PrintDispatch,
  QCRecord,
  QCStageType,
  SewingDispatch
} from '../types';
import { getPartLabel, partsForComposition } from '../types';
import { modelPackagingPieces } from './packagingMaterials';
import {
  escapeHtml,
  logClientPrintAction,
  openUnifiedPrintWindow,
  renderSignatureBar,
  safeImageSrc
} from './printShared';

export interface UnifiedModelCardPrintOptions {
  siteName?: string;
  logo?: string;
  model: DesignModel;
  sizeCategoryName?: string;
  sizes?: string[];
  colors?: string[];
  cuttingRecords: CuttingRecord[];
  requirements: ModelRequirement[];
  fabrics: Fabric[];
  fabricColors: FabricColor[];
  printDispatches: PrintDispatch[];
  sewingDispatches: SewingDispatch[];
  qcRecords: QCRecord[];
  finishingRecords: FinishingRecord[];
  assemblyStageRecords: AssemblyStageRecord[];
  packagingRequirement?: PackagingRequirement | null;
}

const fmtInt = (val: unknown): string => {
  const n = Number(val || 0);
  return Math.round(Number.isFinite(n) ? n : 0).toLocaleString('ar-EG');
};

const fmtNum = (val: unknown): string => {
  const n = Number(val || 0);
  return (Number.isFinite(n) ? Number(n.toFixed(2)) : 0).toLocaleString('ar-EG', {
    maximumFractionDigits: 2
  });
};

const fmtDate = (val?: string | null): string => (val ? String(val).slice(0, 10) : '—');

const QC_STAGE_LABELS: Record<QCStageType, string> = {
  before_print: 'قبل الطباعة',
  after_print: 'بعد الطباعة',
  after_sewing: 'بعد المكن'
};

const getModelPartsList = (model: DesignModel): GarmentPart[] => {
  if (model.garment_parts && model.garment_parts.length) {
    return model.garment_parts.filter((p) => ['shirt', 'pants', 'jacket', 'single'].includes(p));
  }
  return partsForComposition(model.garment_composition);
};

export const printUnifiedModelCard = (opts: UnifiedModelCardPrintOptions): void => {
  const {
    siteName = 'مصنع الملابس الجاهزة',
    logo,
    model,
    sizeCategoryName = '—',
    sizes = [],
    colors = [],
    cuttingRecords,
    requirements,
    fabrics,
    fabricColors,
    printDispatches,
    sewingDispatches,
    qcRecords,
    finishingRecords,
    assemblyStageRecords,
    packagingRequirement
  } = opts;

  const parts = getModelPartsList(model);
  const expectedSets = modelPackagingPieces(model);
  const totalCut = Number(model.total_cut_pieces || model.actual_cut_count || 0);
  const imageSrc = safeImageSrc(model.image);

  // 1) القص والقماش حسب القطعة
  const cutRows = parts
    .map((part) => {
      const partRecords = cuttingRecords.filter(
        (r) => ((r.part_type || r.part || 'shirt') as string) === part && !r.is_sub_cut
      );
      const cutQty =
        Number(model.cut_summary?.[part] || 0) ||
        partRecords.reduce((s, r) => s + Number(r.pieces_count || r.cut_pieces || 0), 0);
      const layersSum = partRecords.reduce((s, r) => s + Number(r.layers_count || 0), 0);
      const weightSum = partRecords.reduce((s, r) => s + Number(r.layer_weight || 0), 0);
      const lastDate = partRecords[partRecords.length - 1]?.created_at || model.cut_at;
      const cutter =
        partRecords.find((r) => r.cutter_name)?.cutter_name || model.cutter_name || '—';
      const spreader =
        partRecords.find((r) => r.spreader_name)?.spreader_name || model.spreader_name || '—';
      return `<tr>
        <td><strong>${escapeHtml(getPartLabel(part))}</strong></td>
        <td class="num"><strong>${fmtInt(cutQty)}</strong></td>
        <td class="num">${fmtInt(layersSum)}</td>
        <td class="num">${weightSum > 0 ? `${fmtNum(weightSum)} كجم` : '—'}</td>
        <td>${escapeHtml(cutter)}</td>
        <td>${escapeHtml(spreader)}</td>
        <td class="num">${fmtDate(lastDate)}</td>
      </tr>`;
    })
    .join('');

  const fabricSummaryList = requirements.map((req) => {
    const fc = fabricColors.find((c) => c.id === req.color_id);
    const fab = fc ? fabrics.find((f) => f.id === fc.fabric_id) : undefined;
    const qty = Number(req.required_quantity ?? req.planned_quantity ?? 0);
    return `${fab?.name || 'قماش'}${fc ? ` (${fc.color_name})` : ''}: ${fmtNum(qty)} ${fab?.unit || ''}`;
  });

  // 2) المطابع والتطريز
  const printRows = printDispatches.length
    ? printDispatches
        .map((d) => {
          const sent = Number(d.pieces_count || 0);
          const rec =
            d.status === 'تم الاستلام بالمصنع'
              ? Number(d.received_pieces ?? sent)
              : Number(d.received_pieces || 0);
          const shortage = Math.max(0, sent - rec);
          return `<tr>
            <td><strong>${escapeHtml(d.piece_label || getPartLabel(d.piece_type || 'shirt'))}</strong></td>
            <td>${escapeHtml(d.shop_name || '—')}</td>
            <td class="num">${fmtInt(sent)}</td>
            <td class="num">${fmtInt(rec)}</td>
            <td class="num ${shortage > 0 ? 'bad' : 'ok'}">${fmtInt(shortage)}</td>
            <td class="num">${fmtDate(d.dispatched_at)}</td>
            <td class="num">${fmtDate(d.received_at || d.expected_delivery_date)}</td>
            <td>${escapeHtml(d.status)}</td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="8" class="muted">لا توجد تشغيلات مطابع أو تطريز مسجّلة لهذا الموديل.</td></tr>`;

  // 3) المكن والخياطة
  const sewingRows = sewingDispatches.length
    ? sewingDispatches
        .map((d) => {
          const sent = Number(d.pieces_count || 0);
          const rec =
            d.status === 'تم الاستلام'
              ? Number(d.received_pieces ?? sent)
              : Number(d.received_pieces || 0);
          const shortage = Math.max(0, sent - rec);
          return `<tr>
            <td><strong>${escapeHtml(d.piece_label || getPartLabel(d.piece_type || 'shirt'))}</strong></td>
            <td>${escapeHtml(d.workshop_name || '—')}</td>
            <td class="num">${fmtInt(sent)}</td>
            <td class="num">${fmtInt(rec)}</td>
            <td class="num ${shortage > 0 ? 'bad' : 'ok'}">${fmtInt(shortage)}</td>
            <td class="num">${fmtDate(d.dispatched_at)}</td>
            <td class="num">${fmtDate(d.received_at || d.expected_delivery_date)}</td>
            <td>${escapeHtml(d.status)}</td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="8" class="muted">لا توجد تشغيلات مكن أو خياطة مسجّلة لهذا الموديل.</td></tr>`;

  // 4) الفرز والجودة (العد والهوالك)
  const qcStagesOrder: QCStageType[] = ['before_print', 'after_print', 'after_sewing'];
  const qcRowsList: string[] = [];
  qcStagesOrder.forEach((stage) => {
    parts.forEach((part) => {
      const recs = qcRecords.filter(
        (q) => q.stage === stage && ((q.part_type || q.partType || 'shirt') as string) === part
      );
      if (!recs.length) return;
      const good = recs.reduce((s, r) => s + Number(r.good_qty ?? r.counted_pieces ?? 0), 0);
      const defect = recs.reduce((s, r) => s + Number(r.defect_qty ?? r.defect_pieces ?? 0), 0);
      const refCut =
        Number(model.cut_summary?.[part] || 0) ||
        recs.reduce((s, r) => s + Number(r.pieces_cut || r.cut_pieces_ref || 0), 0);
      const shortage = refCut > 0 ? Math.max(0, refCut - (good + defect)) : 0;
      qcRowsList.push(`<tr>
        <td><strong>${escapeHtml(QC_STAGE_LABELS[stage])}</strong></td>
        <td>${escapeHtml(getPartLabel(part))}</td>
        <td class="num ok">${fmtInt(good)}</td>
        <td class="num ${defect > 0 ? 'bad' : ''}">${fmtInt(defect)}</td>
        <td class="num ${shortage > 0 ? 'bad' : ''}">${fmtInt(shortage)}</td>
      </tr>`);
    });
  });
  const qcRows = qcRowsList.length
    ? qcRowsList.join('')
    : `<tr><td colspan="5" class="muted">لا توجد سجلات فرز أو جودة مسجّلة بعد.</td></tr>`;

  // 5) الأسمبلي والتغليف
  const assemblyRows: string[] = [];
  finishingRecords.forEach((rec) => {
    assemblyRows.push(`<tr>
      <td><strong>التشطيب</strong> (${escapeHtml(rec.piece_label || getPartLabel(rec.part_type))})</td>
      <td>${escapeHtml(rec.vendor_name || '—')}</td>
      <td class="num">${fmtInt(expectedSets)}</td>
      <td class="num">${rec.is_received ? fmtInt(expectedSets) : '—'}</td>
      <td class="num">0</td>
      <td class="num">${fmtDate(rec.entry_date)}</td>
      <td class="num">${fmtDate(rec.actual_exit_date || rec.expected_exit_date)}</td>
      <td>${rec.is_received ? 'مكتمل' : 'قيد التنفيذ'}</td>
    </tr>`);
  });
  assemblyStageRecords
    .filter((r) => r.stage === 'ironing')
    .forEach((rec) => {
      assemblyRows.push(`<tr>
        <td><strong>المكواة</strong> (${escapeHtml(rec.part_label || getPartLabel(rec.part_type || 'shirt'))})</td>
        <td>${escapeHtml(rec.vendor_name || '—')}</td>
        <td class="num">${fmtInt(expectedSets)}</td>
        <td class="num">${rec.is_completed ? fmtInt(expectedSets) : '—'}</td>
        <td class="num">0</td>
        <td class="num">${fmtDate(rec.entry_date)}</td>
        <td class="num">${fmtDate(rec.actual_exit_date || rec.expected_exit_date)}</td>
        <td>${rec.is_completed ? 'مكتمل' : 'قيد التنفيذ'}</td>
      </tr>`);
    });
  const packRec = assemblyStageRecords.find((r) => r.stage === 'packaging');
  if (packRec) {
    assemblyRows.push(`<tr>
      <td><strong>التعبئة والتغليف</strong>${packRec.materials_deducted ? ' (مخصوم)' : ''}</td>
      <td>${escapeHtml(packRec.vendor_name || '—')}</td>
      <td class="num">${fmtInt(expectedSets)}</td>
      <td class="num">${packRec.is_completed ? fmtInt(expectedSets) : '—'}</td>
      <td class="num">0</td>
      <td class="num">${fmtDate(packRec.entry_date)}</td>
      <td class="num">${fmtDate(packRec.actual_exit_date || packRec.expected_exit_date)}</td>
      <td>${packRec.is_completed ? 'مكتمل' : 'قيد التنفيذ'}</td>
    </tr>`);
  }
  const destRec = assemblyStageRecords.find((r) => r.stage === 'dest');
  if (destRec) {
    const destExp = destRec.expected_pieces || expectedSets;
    const destComp = destRec.completed_pieces;
    const destShort = destRec.shortage_pieces ?? 0;
    assemblyRows.push(`<tr>
      <td><strong>الدَست</strong></td>
      <td>${escapeHtml(destRec.vendor_name || '—')}</td>
      <td class="num">${fmtInt(destExp)}</td>
      <td class="num">${destComp !== null && destComp !== undefined ? fmtInt(destComp) : '—'}</td>
      <td class="num ${destShort > 0 ? 'bad' : 'ok'}">${fmtInt(destShort)}</td>
      <td class="num">${fmtDate(destRec.entry_date)}</td>
      <td class="num">${fmtDate(destRec.actual_exit_date || destRec.expected_exit_date)}</td>
      <td>${destRec.is_completed ? 'مكتمل' : 'قيد التنفيذ'}</td>
    </tr>`);
  }
  const assemblyRowsHtml = assemblyRows.length
    ? assemblyRows.join('')
    : `<tr><td colspan="8" class="muted">لم يدخل الموديل مراحل التشطيب والتغليف بعد.</td></tr>`;

  // 6) متطلبات الأمبالاج (التصوير والباركود)
  const sentPhoto = packagingRequirement?.steps?.sent_to_photo || packagingRequirement?.sent_to_photo_date;
  const recvPhoto =
    packagingRequirement?.steps?.received_from_photo || packagingRequirement?.received_from_photo_date;
  const sentCards =
    packagingRequirement?.steps?.sent_to_print_cards || packagingRequirement?.sent_to_print_cards_date;
  const recvCards =
    packagingRequirement?.steps?.received_printed_cards ||
    packagingRequirement?.received_printed_cards_date;
  const photoSentQty = Number(packagingRequirement?.photography_sent_qty || 0);
  const photoRecvQty = Number(packagingRequirement?.photography_received_qty || 0);
  const photoShortQty = Number(packagingRequirement?.photography_shortage || 0);

  const bodyHtml = `
    <div class="p-info-card card-hero">
      <div class="thumb">
        ${
          imageSrc
            ? `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(model.model_code)}" onerror="this.style.display='none'" />`
            : '<span class="muted">لا توجد صورة</span>'
        }
      </div>
      <div class="p-fields hero-fields">
        <div class="p-field"><span class="p-k">كود الموديل</span><span class="p-v">${escapeHtml(model.model_code)}</span></div>
        <div class="p-field"><span class="p-k">النوع / الاسم</span><span class="p-v">${escapeHtml(model.model_type || '—')}</span></div>
        <div class="p-field"><span class="p-k">فئة المقاسات</span><span class="p-v">${escapeHtml(sizeCategoryName)}</span></div>
        <div class="p-field"><span class="p-k">الحالة الحالية</span><span class="p-v">${escapeHtml(model.status || '—')}</span></div>
        <div class="p-field"><span class="p-k">الكمية المستهدفة</span><span class="p-v num">${fmtInt(model.target_cut_quantity)} طقم</span></div>
        <div class="p-field"><span class="p-k">إجمالي القص الفعلي</span><span class="p-v num">${fmtInt(totalCut)} قطعة</span></div>
        <div class="p-field full"><span class="p-k">القطع</span><span class="p-v">${escapeHtml(parts.map((p) => getPartLabel(p)).join(' • '))}</span></div>
        <div class="p-field full"><span class="p-k">المقاسات والألوان</span><span class="p-v">${escapeHtml(sizes.join(' - ') || '—')} | ${escapeHtml(colors.join('، ') || '—')}</span></div>
      </div>
    </div>

    <div class="p-sec">1. القص والقماش (Cutting & Fabric)</div>
    <table class="mc-table">
      <thead>
        <tr>
          <th>القطعة</th><th>المقصوص</th><th>عدد الراقات</th><th>وزن الراقات</th>
          <th>القصاص</th><th>الفراش</th><th>تاريخ القص</th>
        </tr>
      </thead>
      <tbody>${cutRows}</tbody>
    </table>
    <div class="fabric-strip">
      <strong>ملخص القماش:</strong>
      ${
        fabricSummaryList.length
          ? escapeHtml(fabricSummaryList.join(' • '))
          : model.withdrawn_fabric_qty
          ? `كمية القماش المسحوبة: ${fmtNum(model.withdrawn_fabric_qty)}`
          : 'لا توجد بيانات صرف قماش مسجّلة'
      }
    </div>

    <div class="p-sec">2. المطابع والتطريز (Print / Embroidery)</div>
    <table class="mc-table">
      <thead>
        <tr>
          <th>القطعة</th><th>المطبعة / الورشة</th><th>المرسل</th><th>المستلم</th>
          <th>العجز</th><th>الإرسال</th><th>الاستلام</th><th>الحالة</th>
        </tr>
      </thead>
      <tbody>${printRows}</tbody>
    </table>

    <div class="p-sec">3. المكن والخياطة (Sewing)</div>
    <table class="mc-table">
      <thead>
        <tr>
          <th>القطعة</th><th>ورشة المكن</th><th>المرسل</th><th>المستلم</th>
          <th>العجز</th><th>الإرسال</th><th>الاستلام</th><th>الحالة</th>
        </tr>
      </thead>
      <tbody>${sewingRows}</tbody>
    </table>

    <div class="p-sec">4. التشطيب والمكواة والتعبئة والدَست (Assembly & Packaging)</div>
    <table class="mc-table">
      <thead>
        <tr>
          <th>المرحلة</th><th>الجهة / الورشة</th><th>المتوقع</th><th>المنفذ</th>
          <th>العجز</th><th>الدخول</th><th>الخروج</th><th>الحالة</th>
        </tr>
      </thead>
      <tbody>${assemblyRowsHtml}</tbody>
    </table>

    <div class="mc-bottom-grid">
      <div>
        <div class="p-sec">5. الفرز والجودة والهوالك (QC & Defects)</div>
        <table class="mc-table">
          <thead>
            <tr>
              <th>المرحلة</th><th>القطعة</th><th>السليم</th><th>الهالك</th><th>العجز</th>
            </tr>
          </thead>
          <tbody>${qcRows}</tbody>
        </table>
      </div>
      <div>
        <div class="p-sec">6. الأمبالاج (التصوير والكارت والباركود)</div>
        <div class="pkg-box">
          <div class="pkg-line">
            <strong>التصوير:</strong>
            ${recvPhoto ? '<span class="ok">تم الاستلام</span>' : sentPhoto ? '<span class="warn">قيد التصوير</span>' : '<span class="muted">لم يُرسل</span>'}
            | إرسال: <span class="num">${fmtDate(sentPhoto)}</span> • استلام: <span class="num">${fmtDate(recvPhoto)}</span>
          </div>
          <div class="pkg-line">
            <strong>عينات التصوير:</strong>
            مرسل <span class="num">${fmtInt(photoSentQty)}</span> • مستلم <span class="num">${fmtInt(photoRecvQty)}</span> •
            <span class="num ${photoShortQty > 0 ? 'bad' : 'ok'}">العجز: ${fmtInt(photoShortQty)}</span>
          </div>
          <div class="pkg-line">
            <strong>الكارت والباركود:</strong>
            ${recvCards ? '<span class="ok">تم الاستلام</span>' : sentCards ? '<span class="warn">جاري الطباعة</span>' : '<span class="muted">لم يُرسل</span>'}
            | إرسال: <span class="num">${fmtDate(sentCards)}</span> • استلام: <span class="num">${fmtDate(recvCards)}</span>
          </div>
        </div>
      </div>
    </div>

    ${renderSignatureBar(
      ['مسؤول القص والمتابعة', 'مسؤول الفرز والجودة', 'مسؤول التشطيب والتغليف', 'اعتماد مدير الإنتاج'],
      true
    )}
  `;

  logClientPrintAction(
    'بطاقة الموديل الشاملة',
    `طباعة بطاقة الموديل الشاملة للموديل ${model.model_code}`,
    model.model_code
  );

  openUnifiedPrintWindow({
    documentTitle: `بطاقة الموديل الشاملة - ${model.model_code}`,
    mode: 'fit-single-page',
    orientation: 'portrait',
    header: {
      siteName,
      logo,
      title: `بطاقة الموديل الشاملة — ${model.model_code}`,
      subtitle: 'Master Model Card (تتبع كامل لمراحل التشغيل والجودة والتغليف)',
      metaItems: [`الحالة: ${model.status || '—'}`],
      compact: true
    },
    bodyHtml,
    extraCss: `
      .card-hero { padding: 5px 7px; margin-bottom: 5px; }
      .card-hero .thumb {
        width: 84px;
        height: 88px;
        flex: 0 0 auto;
        border: 1px solid #cbd5e1;
        border-radius: 5px;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        background: #f8fafc;
      }
      .card-hero .thumb img { width: 100%; height: 100%; object-fit: contain; }
      .hero-fields { font-size: 9.5px; gap: 1.5px 10px; }
      .hero-fields .p-field { padding: 1.5px 1px; }
      .p-sec { font-size: 9.8px; padding: 2.5px 6px; margin: 5px 0 3px; }
      table.mc-table { font-size: 9px; margin-bottom: 4px; }
      table.mc-table th, table.mc-table td { padding: 2.5px 4px; line-height: 1.25; }
      .fabric-strip {
        border: 1px solid #cbd5e1;
        border-radius: 4px;
        padding: 3px 6px;
        background: #f8fafc;
        font-size: 9px;
        margin-bottom: 4px;
      }
      .mc-bottom-grid {
        display: grid;
        grid-template-columns: 1.15fr 0.85fr;
        gap: 7px;
        align-items: start;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .pkg-box {
        border: 1px solid #94a3b8;
        border-radius: 4px;
        padding: 5px 7px;
        background: #f8fafc;
        font-size: 9px;
        line-height: 1.55;
      }
      .pkg-line { border-bottom: 1px dotted #cbd5e1; padding: 2px 0; }
      .pkg-line:last-child { border-bottom: none; }
    `,
    popupBlockedMessage: 'يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة بطاقة الموديل.'
  });
};
