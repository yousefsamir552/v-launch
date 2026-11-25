/**
 * طباعة «بطاقة الموديل الشاملة» (A4) — تجمع كل بيانات الموديل في ورقة واحدة مرتبة
 * ومقسّمة بوضوح حسب القطعة (تيشرت / بنطلون / جاكيت) مع شعار واسم المصنع وسجل المراقبة.
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
  PRINT_LOGO_CSS,
  renderLogoHtml,
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
  before_print: 'العد قبل الطباعة',
  after_print: 'العد بعد الطباعة',
  after_sewing: 'العد بعد المكن'
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
        <td><strong>${fmtInt(cutQty)}</strong></td>
        <td>${fmtInt(layersSum)}</td>
        <td>${weightSum > 0 ? `${fmtNum(weightSum)} كجم` : '—'}</td>
        <td>${escapeHtml(cutter)}</td>
        <td>${escapeHtml(spreader)}</td>
        <td>${fmtDate(lastDate)}</td>
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
            <td>${fmtInt(sent)}</td>
            <td>${fmtInt(rec)}</td>
            <td class="${shortage > 0 ? 'bad' : 'ok'}">${fmtInt(shortage)}</td>
            <td>${fmtDate(d.dispatched_at)}</td>
            <td>${fmtDate(d.received_at || d.expected_delivery_date)}</td>
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
            <td>${fmtInt(sent)}</td>
            <td>${fmtInt(rec)}</td>
            <td class="${shortage > 0 ? 'bad' : 'ok'}">${fmtInt(shortage)}</td>
            <td>${fmtDate(d.dispatched_at)}</td>
            <td>${fmtDate(d.received_at || d.expected_delivery_date)}</td>
            <td>${escapeHtml(d.status)}</td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="8" class="muted">لا توجد تشغيلات مكن أو خياطة مسجّلة لهذا الموديل.</td></tr>`;

  // 4) الفرز والجودة (العد والهوالك) حسب المرحلة والقطعة
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
        <td class="ok"><strong>${fmtInt(good)}</strong></td>
        <td class="${defect > 0 ? 'bad' : ''}">${fmtInt(defect)}</td>
        <td class="${shortage > 0 ? 'bad' : ''}">${fmtInt(shortage)}</td>
      </tr>`);
    });
  });
  const qcRows = qcRowsList.length
    ? qcRowsList.join('')
    : `<tr><td colspan="5" class="muted">لا توجد سجلات فرز أو جودة مسجّلة بعد.</td></tr>`;

  // 5) الأسمبلي والتغليف (التشطيب / المكواة / التعبئة / الدَست)
  const assemblyRows: string[] = [];
  finishingRecords.forEach((rec) => {
    assemblyRows.push(`<tr>
      <td><strong>التشطيب</strong> (${escapeHtml(rec.piece_label || getPartLabel(rec.part_type))})</td>
      <td>${escapeHtml(rec.vendor_name || '—')}</td>
      <td>${fmtInt(expectedSets)}</td>
      <td>${rec.is_received ? fmtInt(expectedSets) : '—'}</td>
      <td>0</td>
      <td>${fmtDate(rec.entry_date)}</td>
      <td>${fmtDate(rec.actual_exit_date || rec.expected_exit_date)}</td>
      <td>${rec.is_received ? '✅ مكتمل' : '⏳ قيد التنفيذ'}</td>
    </tr>`);
  });
  assemblyStageRecords
    .filter((r) => r.stage === 'ironing')
    .forEach((rec) => {
      assemblyRows.push(`<tr>
        <td><strong>المكواة</strong> (${escapeHtml(rec.part_label || getPartLabel(rec.part_type || 'shirt'))})</td>
        <td>${escapeHtml(rec.vendor_name || '—')}</td>
        <td>${fmtInt(expectedSets)}</td>
        <td>${rec.is_completed ? fmtInt(expectedSets) : '—'}</td>
        <td>0</td>
        <td>${fmtDate(rec.entry_date)}</td>
        <td>${fmtDate(rec.actual_exit_date || rec.expected_exit_date)}</td>
        <td>${rec.is_completed ? '✅ مكتمل' : '⏳ قيد التنفيذ'}</td>
      </tr>`);
    });
  const packRec = assemblyStageRecords.find((r) => r.stage === 'packaging');
  if (packRec) {
    assemblyRows.push(`<tr>
      <td><strong>التعبئة والتغليف</strong>${packRec.materials_deducted ? ' (خامات مخصومة)' : ''}</td>
      <td>${escapeHtml(packRec.vendor_name || '—')}</td>
      <td>${fmtInt(expectedSets)}</td>
      <td>${packRec.is_completed ? fmtInt(expectedSets) : '—'}</td>
      <td>0</td>
      <td>${fmtDate(packRec.entry_date)}</td>
      <td>${fmtDate(packRec.actual_exit_date || packRec.expected_exit_date)}</td>
      <td>${packRec.is_completed ? '✅ مكتمل' : '⏳ قيد التنفيذ'}</td>
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
      <td>${fmtInt(destExp)}</td>
      <td>${destComp !== null && destComp !== undefined ? fmtInt(destComp) : '—'}</td>
      <td class="${destShort > 0 ? 'bad' : 'ok'}">${fmtInt(destShort)}</td>
      <td>${fmtDate(destRec.entry_date)}</td>
      <td>${fmtDate(destRec.actual_exit_date || destRec.expected_exit_date)}</td>
      <td>${destRec.is_completed ? '✅ مكتمل' : '⏳ قيد التنفيذ'}</td>
    </tr>`);
  }
  const assemblyRowsHtml = assemblyRows.length
    ? assemblyRows.join('')
    : `<tr><td colspan="8" class="muted">لم يدخل الموديل مراحل التشطيب والتغليف بعد.</td></tr>`;

  // 6) متطلبات الأمبالاج (التصوير والباركود / الكارت)
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

  const html = `<!DOCTYPE html>
  <html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <title>بطاقة الموديل الشاملة - ${escapeHtml(model.model_code)}</title>
    <style>
      @page { size: A4 portrait; margin: 9mm; }
      * { box-sizing: border-box; }
      body { font-family: 'Cairo', 'Tahoma', Arial, sans-serif; color: #0f172a; font-size: 11px; margin: 0; }
      header { text-align: center; border-bottom: 3px double #0f172a; padding-bottom: 7px; margin-bottom: 8px; }
      header h1 { font-size: 17px; margin: 2px 0; }
      header h2 { font-size: 12.5px; margin: 0; color: #334155; }
      .meta { font-size: 10px; color: #64748b; margin-top: 2px; }
      ${PRINT_LOGO_CSS}

      .hero { display: flex; gap: 10px; border: 1.5px solid #1e293b; border-radius: 8px; padding: 8px; margin-bottom: 8px; }
      .hero .thumb { width: 120px; height: 125px; flex: 0 0 auto; border: 1px solid #cbd5e1; border-radius: 6px; display: flex; align-items: center; justify-content: center; overflow: hidden; background: #f8fafc; }
      .hero .thumb img { width: 100%; height: 100%; object-fit: contain; }
      .hero .grid { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 3px 12px; }
      .hero .row { display: flex; justify-content: space-between; gap: 6px; border-bottom: 1px dotted #cbd5e1; padding: 3px 2px; }
      .hero .row.full { grid-column: 1 / -1; }
      .hero .k { color: #475569; font-weight: 700; }
      .hero .v { font-weight: 900; text-align: left; }

      h3.sec { font-size: 12px; margin: 8px 0 4px; padding: 4px 8px; background: #f1f5f9; border-right: 4px solid #0f172a; border-radius: 4px; }
      table { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-bottom: 6px; }
      th, td { border: 1px solid #94a3b8; padding: 4px 5px; text-align: center; }
      th { background: #f8fafc; font-weight: 700; }
      .muted { color: #64748b; font-style: italic; }
      .ok { color: #047857; font-weight: 700; }
      .bad { color: #be123c; font-weight: 900; }
      .box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px; background: #f8fafc; margin-bottom: 6px; font-size: 10.5px; }
      .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      @media print {
        .hero, table, .two-col { page-break-inside: avoid; }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="brand">${renderLogoHtml(logo, siteName, 44)}</div>
      <h1>${escapeHtml(siteName)}</h1>
      <h2>بطاقة الموديل الشاملة (Master Model Sheet) — ${escapeHtml(model.model_code)}</h2>
      <div class="meta">تاريخ الطباعة: ${escapeHtml(new Date().toLocaleString('ar-EG'))}</div>
    </header>

    <div class="hero">
      <div class="thumb">
        ${
          imageSrc
            ? `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(model.model_code)}" onerror="this.style.display='none'" />`
            : '<span class="muted">لا توجد صورة</span>'
        }
      </div>
      <div class="grid">
        <div class="row"><span class="k">كود الموديل</span><span class="v">${escapeHtml(model.model_code)}</span></div>
        <div class="row"><span class="k">النوع / الاسم</span><span class="v">${escapeHtml(model.model_type || '—')}</span></div>
        <div class="row"><span class="k">فئة المقاسات</span><span class="v">${escapeHtml(sizeCategoryName)}</span></div>
        <div class="row"><span class="k">الحالة الحالية</span><span class="v">${escapeHtml(model.status || '—')}</span></div>
        <div class="row"><span class="k">الكمية المستهدفة</span><span class="v">${fmtInt(model.target_cut_quantity)} طقم</span></div>
        <div class="row"><span class="k">إجمالي القص الفعلي</span><span class="v">${fmtInt(totalCut)} قطعة</span></div>
        <div class="row full"><span class="k">القطع</span><span class="v">${escapeHtml(parts.map((p) => getPartLabel(p)).join(' • '))}</span></div>
        <div class="row full"><span class="k">المقاسات والألوان</span><span class="v">${escapeHtml(sizes.join(' - ') || '—')} | ${escapeHtml(colors.join('، ') || '—')}</span></div>
      </div>
    </div>

    <h3 class="sec">1. القص والقماش (Cutting & Fabric)</h3>
    <table>
      <thead>
        <tr>
          <th>القطعة</th><th>المقصوص</th><th>عدد الراقات</th><th>وزن الراقات</th>
          <th>القصاص</th><th>الفراش</th><th>تاريخ القص</th>
        </tr>
      </thead>
      <tbody>${cutRows}</tbody>
    </table>
    <div class="box">
      <strong>ملخص القماش:</strong>
      ${
        fabricSummaryList.length
          ? escapeHtml(fabricSummaryList.join(' • '))
          : model.withdrawn_fabric_qty
          ? `كمية القماش المسحوبة: ${fmtNum(model.withdrawn_fabric_qty)}`
          : 'لا توجد بيانات صرف قماش مسجّلة'
      }
    </div>

    <h3 class="sec">2. المطابع والتطريز (Print / Embroidery)</h3>
    <table>
      <thead>
        <tr>
          <th>القطعة</th><th>اسم المطبعة / الورشة</th><th>المرسل</th><th>المستلم</th>
          <th>العجز</th><th>تاريخ الإرسال</th><th>تاريخ الاستلام</th><th>الحالة</th>
        </tr>
      </thead>
      <tbody>${printRows}</tbody>
    </table>

    <h3 class="sec">3. المكن والخياطة (Sewing)</h3>
    <table>
      <thead>
        <tr>
          <th>القطعة</th><th>ورشة المكن</th><th>المرسل</th><th>المستلم</th>
          <th>العجز</th><th>تاريخ الإرسال</th><th>تاريخ الاستلام</th><th>الحالة</th>
        </tr>
      </thead>
      <tbody>${sewingRows}</tbody>
    </table>

    <h3 class="sec">4. الفرز والجودة والهوالك (QC & Defects)</h3>
    <table>
      <thead>
        <tr>
          <th>مرحلة الفرز</th><th>القطعة</th><th>السليم</th><th>الهالك / العيوب</th><th>العجز</th>
        </tr>
      </thead>
      <tbody>${qcRows}</tbody>
    </table>

    <h3 class="sec">5. التشطيب والمكواة والتعبئة والدَست (Assembly & Packaging)</h3>
    <table>
      <thead>
        <tr>
          <th>المرحلة</th><th>الجهة / الورشة</th><th>المتوقع</th><th>المنفذ</th>
          <th>العجز</th><th>تاريخ الدخول</th><th>تاريخ الخروج</th><th>الحالة</th>
        </tr>
      </thead>
      <tbody>${assemblyRowsHtml}</tbody>
    </table>

    <h3 class="sec">6. متطلبات الأمبالاج (التصوير والكارت / الباركود)</h3>
    <div class="two-col">
      <div class="box">
        <strong>📸 حالة التصوير:</strong> ${recvPhoto ? '✅ تم التصوير واستلام الصور' : sentPhoto ? '⏳ تم الإرسال للتصوير' : '❌ لم يُرسل للتصوير بعد'}<br />
        تاريخ الإرسال: ${fmtDate(sentPhoto)} • تاريخ الاستلام: ${fmtDate(recvPhoto)}<br />
        عينات التصوير: مرسل ${fmtInt(photoSentQty)} • مستلم ${fmtInt(photoRecvQty)} •
        <span class="${photoShortQty > 0 ? 'bad' : 'ok'}">العجز: ${fmtInt(photoShortQty)}</span>
      </div>
      <div class="box">
        <strong>🏷️ حالة الباركود والكارت:</strong> ${recvCards ? '✅ تم طباعة واستلام الكروت والباركود' : sentCards ? '⏳ جاري طباعة الكروت والباركود' : '❌ لم يُرسل للطباعة بعد'}<br />
        تاريخ الإرسال للطباعة: ${fmtDate(sentCards)}<br />
        تاريخ استلام الكروت: ${fmtDate(recvCards)}
      </div>
    </div>

    <script>
      window.onload = function () { window.focus(); window.print(); };
    </script>
  </body>
  </html>`;

  logClientPrintAction(
    'بطاقة الموديل الشاملة',
    `طباعة بطاقة الموديل الشاملة للموديل ${model.model_code}`,
    model.model_code
  );

  const win = window.open('', '_blank', 'width=980,height=1080');
  if (!win) {
    alert('يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة بطاقة الموديل.');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
};
