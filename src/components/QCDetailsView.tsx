import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  ArrowRight,
  Printer,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Lock,
  Grid,
  Save,
  Sparkles
} from 'lucide-react';
import {
  QCStageType,
  QCMatrixCellInput,
  GarmentPart,
  PART_EMOJI,
  PART_STAGE_LABELS,
  PartStage,
  getPartLabel
} from '../types';
import { printManualCountSheet } from '../utils/printManualCountSheet';
import {
  escapeHtml,
  logClientPrintAction,
  openUnifiedPrintWindow,
  renderSignatureBar,
  safeImageSrc
} from '../utils/printShared';
import { stageBeyond } from '../utils/completedModels';
import { ZoomableImage } from './ZoomableImage';
import {
  resolveDefaultGoodQtyForCell,
  findSavedQcCell
} from '../utils/qcCutDefaults';
import { qcPartStageCounts } from '../utils/qcStageCounts';

interface QCDetailsViewProps {
  modelId: string;
  onBack: () => void;
  onFinishedApproval: () => void;
}

export const QCDetailsView: React.FC<QCDetailsViewProps> = ({
  modelId,
  onBack,
  onFinishedApproval
}) => {
  const {
    models,
    getModelParts,
    getPartStages,
    getModelColorList,
    getModelSizeList,
    qcRecords,
    cuttingRecords,
    printDispatches,
    sewingDispatches,
    normalizePartKey,
    saveQCMatrix,
    recordQCStageCount,
    exportQcCsv,
    hasPermission,
    canAddQCBeforePrintNotes,
    canAddQCAfterPrintNotes,
    globalSettings
  } = useApp();

  const canEdit = hasPermission('qc', true);
  const model = models.find((m) => m.id === modelId);
  const modelParts = getModelParts(modelId);

  const [selectedStage, setSelectedStage] = useState<QCStageType>(() => {
    // Prefer the stage implied by the per-part tracking so the right tab opens.
    const stages = Object.values(getPartStages(modelId));
    if (stages.includes('qc_after_sewing')) return 'after_sewing';
    if (stages.includes('qc_after_print')) return 'after_print';
    if (stages.includes('qc_before_print')) return 'before_print';
    if (model?.status === 'العد بعد الطباعة') return 'after_print';
    if (model?.status === 'العد بعد المكن') return 'after_sewing';
    return 'before_print';
  });

  const [selectedPart, setSelectedPart] = useState<GarmentPart>(() => {
    const targetStage =
      selectedStage === 'before_print'
        ? 'qc_before_print'
        : selectedStage === 'after_print'
        ? 'qc_after_print'
        : 'qc_after_sewing';
    const stages = getPartStages(modelId);
    return modelParts.find((part) => stages[part] === targetStage) || modelParts[0] || 'shirt';
  });

  const selectedPartStages = getPartStages(modelId);
  const selectedStageKey = (
    selectedStage === 'before_print'
      ? 'qc_before_print'
      : selectedStage === 'after_print'
      ? 'qc_after_print'
      : 'qc_after_sewing'
  ) as PartStage;
  // قطعة غادرت مرحلة الفرز المختارة بالفعل لا يمكن ترحيلها مرة أخرى.
  const isSelectedPartEnded = stageBeyond(
    selectedPartStages[selectedPart],
    selectedStageKey
  );

  const canWriteNotes =
    selectedStage === 'before_print'
      ? canAddQCBeforePrintNotes()
      : canAddQCAfterPrintNotes();

  const colorList = getModelColorList(modelId, selectedPart);
  const sizeList = getModelSizeList(modelId);

  const makeCellKey = (color: string, size: string) => `${color}___${size}`;

  const [matrixState, setMatrixState] = useState<
    Record<string, { good: number; defect: number }>
  >({});
  const [defectNotes, setDefectNotes] = useState('');

  /**
   * العدد الافتراضي لخانة "السليم" في جدول العد لهذا (اللون × المقاس):
   * العدد المقصوص الفعلي من فرشات القص، أو العدد المعتمد من المرحلة السابقة
   * (بعد الطباعة / بعد المكن) إن وُجد أكبر من صفر.
   */
  const getDefaultGoodQtyForCell = (
    targetModelId: string,
    part: GarmentPart,
    stage: QCStageType,
    colorName: string,
    sizeName: string,
    allColors: string[],
    allSizes: string[]
  ): number =>
    resolveDefaultGoodQtyForCell(
      { cuttingRecords, qcRecords, normalizePartKey },
      targetModelId,
      part,
      stage,
      colorName,
      sizeName,
      allColors,
      allSizes
    );

  useEffect(() => {
    const stageRecs = qcRecords.filter(
      (r) =>
        r.model_id === modelId &&
        r.stage === selectedStage &&
        normalizePartKey(r.part_type || r.partType) === selectedPart
    );
    // الخلايا المحفوظة تظهر بقيمها المحفوظة، والخلايا التي لم تُعدّ بعد تُملأ تلقائياً
    // بالعدد المقصوص (لون × مقاس) حتى يراجع المستخدم ويعتمد مباشرة.
    const nextMatrix: Record<string, { good: number; defect: number }> = {};
    let existingNote = '';

    colorList.forEach((col) => {
      sizeList.forEach((sz) => {
        const match = findSavedQcCell(stageRecs, col, sz);

        if (match) {
          nextMatrix[makeCellKey(col, sz)] = {
            good: Number(match.good_qty ?? match.counted_pieces ?? 0),
            defect: Number(match.defect_qty ?? match.defect_pieces ?? 0)
          };
        } else {
          nextMatrix[makeCellKey(col, sz)] = {
            good: getDefaultGoodQtyForCell(
              modelId,
              selectedPart,
              selectedStage,
              col,
              sz,
              colorList,
              sizeList
            ),
            defect: 0
          };
        }
        if (match?.notes && !existingNote) {
          existingNote = match.notes;
        }
      });
    });

    setMatrixState(nextMatrix);
    setDefectNotes(existingNote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    modelId,
    selectedStage,
    selectedPart,
    qcRecords,
    cuttingRecords,
    colorList.join('|'),
    sizeList.join('|')
  ]);

  // زر "ملء تلقائي من أعداد القص": يعيد ملء خانات السليم بالعدد المقصوص في أي وقت.
  const handleFillGoodFromCutting = () => {
    const nextMatrix: Record<string, { good: number; defect: number }> = {};
    colorList.forEach((col) => {
      sizeList.forEach((sz) => {
        const key = makeCellKey(col, sz);
        nextMatrix[key] = {
          good: getDefaultGoodQtyForCell(
            modelId,
            selectedPart,
            selectedStage,
            col,
            sz,
            colorList,
            sizeList
          ),
          defect: Number(matrixState[key]?.defect) || 0
        };
      });
    });
    setMatrixState(nextMatrix);
  };

  // Build a per-part (color × size) snapshot from the saved QC records so the printed
  // worker sheet includes EVERY model part, not only the currently selected one.
  const printMatrixByPart = useMemo(() => {
    const result: Record<
      string,
      { colors: string[]; matrix: Record<string, { good: number; defect: number }> }
    > = {};
    modelParts.forEach((part) => {
      const partColors = getModelColorList(modelId, part);
      const partRecs = qcRecords.filter(
        (r) =>
          r.model_id === modelId &&
          r.stage === selectedStage &&
          normalizePartKey(r.part_type || r.partType || 'shirt') === part
      );
      const matrix: Record<string, { good: number; defect: number }> = {};
      partColors.forEach((col) => {
        sizeList.forEach((sz) => {
          const match = findSavedQcCell(partRecs, col, sz);
          matrix[makeCellKey(col, sz)] = {
            good: match ? Number(match.good_qty ?? match.counted_pieces ?? 0) : 0,
            defect: match ? Number(match.defect_qty ?? match.defect_pieces ?? 0) : 0
          };
        });
      });
      result[part] = { colors: partColors, matrix };
    });
    return result;
  }, [modelParts.join('|'), modelId, selectedStage, qcRecords, sizeList.join('|'), getModelColorList]);

  if (!model) {
    return (
      <div className="bg-white rounded-3xl p-8 text-center text-slate-500 border border-slate-200">
        <p className="font-bold text-lg text-slate-700">الموديل غير موجود</p>
        <button
          onClick={onBack}
          className="mt-4 px-6 py-2 rounded-full bg-slate-900 text-white font-bold text-xs"
        >
          العودة لقائمة الفرز
        </button>
      </div>
    );
  }

  // أرقام القطعة المختارة فقط (من سجلات القص/المطابع/المكن) — شريط مرجعي قبل الجدول.
  const partCounts = qcPartStageCounts({
    model,
    part: selectedPart,
    qcRecords,
    printDispatches,
    sewingDispatches,
    normalizePartKey
  });

  const handleCellChange = (
    color: string,
    size: string,
    field: 'good' | 'defect',
    value: number
  ) => {
    const key = makeCellKey(color, size);
    setMatrixState((prev) => ({
      ...prev,
      [key]: {
        good: prev[key]?.good ?? 0,
        defect: prev[key]?.defect ?? 0,
        [field]: Math.max(0, value)
      }
    }));
  };

  const buildMatrixEntries = (): QCMatrixCellInput[] => {
    const entries: QCMatrixCellInput[] = [];
    colorList.forEach((col) => {
      sizeList.forEach((sz) => {
        const cell = matrixState[makeCellKey(col, sz)] || { good: 0, defect: 0 };
        entries.push({
          part_type: selectedPart,
          color_name: col,
          size: sz,
          good_qty: Number(cell.good) || 0,
          defect_qty: Number(cell.defect) || 0,
          notes: canWriteNotes ? defectNotes.trim() : ''
        });
      });
    });
    return entries;
  };

  const handleSaveMatrix = (e: React.FormEvent) => {
    e.preventDefault();
    const entries = buildMatrixEntries();
    saveQCMatrix({
      modelId,
      stage: selectedStage,
      partType: selectedPart,
      matrixEntries: entries,
      notes: canWriteNotes ? defectNotes.trim() : ''
    });
  };

  const handleFinishQC = () => {
    if (isSelectedPartEnded) {
      alert('تم الانتهاء وخرجت هذه القطعة من المرحلة بالفعل ولا يمكن إعادة ترحيلها.');
      return;
    }
    const entries = buildMatrixEntries();
    const sumGood = entries.reduce((s, item) => s + item.good_qty, 0);
    const sumDefect = entries.reduce((s, item) => s + item.defect_qty, 0);

    if (sumGood === 0 && sumDefect === 0) {
      alert('يرجى إدخال أعداد القطع السليمة أو التالفة في جدول المصفوفة قبل الاعتماد!');
      return;
    }
    if (
      window.confirm(
        'هل أنت متأكد من اعتماد مصفوفة الفرز وتحويل الموديل للمرحلة التالية؟'
      )
    ) {
      recordQCStageCount({
        modelId,
        stage: selectedStage,
        partType: selectedPart,
        piecesCounted: sumGood,
        defectQty: sumDefect,
        matrixEntries: entries,
        defectNotes: canWriteNotes ? defectNotes.trim() : '',
        advanceStage: true
      });

      // Stay on the screen while another part is still waiting in this stage.
      const stageKey =
        selectedStage === 'before_print'
          ? 'qc_before_print'
          : selectedStage === 'after_print'
          ? 'qc_after_print'
          : 'qc_after_sewing';
      const remainingParts = modelParts.filter(
        (part) =>
          part !== selectedPart &&
          (selectedPartStages[part] || 'cutting') === stageKey
      );
      if (remainingParts.length === 0) {
        onFinishedApproval();
      }
    }
  };

  const totalGood = Object.values(matrixState).reduce(
    (sum, c) => sum + (Number(c.good) || 0),
    0
  );
  const totalDefect = Object.values(matrixState).reduce(
    (sum, c) => sum + (Number(c.defect) || 0),
    0
  );
  const totalCounted = totalGood + totalDefect;
  const defectRate =
    totalCounted > 0 ? ((totalDefect / totalCounted) * 100).toFixed(1) : '0';

  const modelQCRecords = qcRecords.filter(
    (r) =>
      r.model_id === modelId &&
      r.stage === selectedStage &&
      (r.part_type || 'shirt') === selectedPart
  );

  const printStageLabel =
    selectedStage === 'before_print'
      ? 'العد قبل الطباعة'
      : selectedStage === 'after_print'
      ? 'العد بعد الطباعة'
      : 'العد بعد المكن';

  const handlePrintWorkerSheet = () => {
    logClientPrintAction(
      'العد والجودة',
      `طباعة ورقة جرد الفرز (${printStageLabel}) للموديل ${model.model_code}`,
      model.model_code
    );

    const totalColorsCount = modelParts.reduce(
      (sum, part) => sum + (printMatrixByPart[part]?.colors?.length || 0),
      0
    );
    const useLandscape =
      sizeList.length > 5 || (modelParts.length > 1 && totalColorsCount > 6);
    const imageSrc = safeImageSrc(model.image);
    const today = new Date().toLocaleDateString('ar-EG');

    const partTablesHtml = modelParts
      .map((part) => {
        const partData = printMatrixByPart[part] || {
          colors: [] as string[],
          matrix: {} as Record<string, { good: number; defect: number }>
        };
        const partColors = partData.colors;
        const partMatrix = partData.matrix;
        let partGoodTotal = 0;
        let partDefTotal = 0;

        const rowsHtml = partColors.length
          ? partColors
              .map((col) => {
                let rGood = 0;
                let rDef = 0;
                const sizeCells = sizeList
                  .map((sz) => {
                    const c = partMatrix[makeCellKey(col, sz)];
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
          : `<tr><td colspan="${sizeList.length + 3}" class="muted">لا توجد ألوان مسجلة لهذه القطعة</td></tr>`;

        return `<div class="part-wrap">
          <div class="p-sec">القطعة: ${escapeHtml(getPartLabel(part))} — الإجمالي (سليم: ${partGoodTotal.toLocaleString('ar-EG')} | هالك: ${partDefTotal.toLocaleString('ar-EG')})</div>
          <table class="qc-sheet-table">
            <thead>
              <tr>
                <th class="text-right" style="width:${useLandscape ? '15%' : '18%'}">اللون / المقاس</th>
                ${sizeList
                  .map((sz) => `<th>${escapeHtml(sz)}<div class="th-sub">سليم / تالف</div></th>`)
                  .join('')}
                <th style="width:10%">المجموع السليم</th>
                <th style="width:9%">الهالك</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
            <tfoot>
              <tr class="total">
                <td class="text-right" colspan="${sizeList.length + 1}">إجمالي ${escapeHtml(getPartLabel(part))}</td>
                <td class="num ok">${partGoodTotal.toLocaleString('ar-EG')}</td>
                <td class="num ${partDefTotal > 0 ? 'bad' : ''}">${partDefTotal.toLocaleString('ar-EG')}</td>
              </tr>
            </tfoot>
          </table>
        </div>`;
      })
      .join('');

    const notesText = [model.design_notes, model.notes_shirt, model.notes_pants]
      .filter((t) => t && String(t).trim())
      .join(' • ');

    const bodyHtml = `
      <div class="p-info-card">
        <div class="thumb">
          ${
            imageSrc
              ? `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(model.model_code)}" onerror="this.style.display='none'" />`
              : '<span class="muted">لا توجد صورة</span>'
          }
        </div>
        <div class="p-fields">
          <div class="p-field"><span class="p-k">كود الموديل</span><span class="p-v">${escapeHtml(model.model_code)}</span></div>
          <div class="p-field"><span class="p-k">نوع الموديل</span><span class="p-v">${escapeHtml(model.model_type || '—')}</span></div>
          <div class="p-field"><span class="p-k">مرحلة العد</span><span class="p-v">${escapeHtml(printStageLabel)}</span></div>
          <div class="p-field"><span class="p-k">التاريخ</span><span class="p-v num">${escapeHtml(today)}</span></div>
          <div class="p-field full"><span class="p-k">القطع</span><span class="p-v">${escapeHtml(modelParts.map((p) => getPartLabel(p)).join(' + '))}</span></div>
          <div class="p-field full"><span class="p-k">المقاسات</span><span class="p-v chips">${sizeList.map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join('')}</span></div>
        </div>
      </div>

      ${partTablesHtml}

      ${
        notesText
          ? `<div class="p-note-box">
               <div class="p-note-title">ملاحظات الموديل</div>
               <div class="p-note-body">${escapeHtml(notesText)}</div>
             </div>`
          : ''
      }

      ${renderSignatureBar(['توقيع مستلم الفرز', 'اعتماد مشرف الجودة', 'توقيع الكنترول'], true)}
    `;

    openUnifiedPrintWindow({
      documentTitle: `ورقة جرد الفرز - ${model.model_code}`,
      mode: 'fit-single-page',
      orientation: useLandscape ? 'landscape' : 'portrait',
      header: {
        siteName: globalSettings?.site_name,
        logo: globalSettings?.logo,
        title: `مصفوفة الفرز والعد — ${printStageLabel}`,
        subtitle: `قسم الفرز والكنترول والجودة — موديل ${model.model_code}`,
        compact: true
      },
      bodyHtml,
      extraCss: `
        .thumb {
          width: ${useLandscape ? '88px' : '112px'};
          height: ${useLandscape ? '88px' : '112px'};
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
        .part-wrap { margin-bottom: 5px; break-inside: avoid; page-break-inside: avoid; }
        table.qc-sheet-table { table-layout: fixed; font-size: 10px; margin-bottom: 4px; }
        table.qc-sheet-table th, table.qc-sheet-table td { border: 1.2px solid #334155; padding: 4px 4px; }
        table.qc-sheet-table td.cell-blank { height: 24px; background: #ffffff !important; }
        .th-sub { font-size: 8px; font-weight: 600; color: #475569; margin-top: 1px; }
      `,
      popupBlockedMessage: 'يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة ورقة الفرز.'
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top action buttons (hidden on print) */}
      <div className="no-print flex items-center justify-between flex-wrap gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-extrabold text-purple-700 hover:text-purple-900 transition cursor-pointer"
        >
          <ArrowRight className="w-4 h-4" />
          <span>← العودة لقائمة الفرز</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {modelQCRecords.length > 0 && (
            <button
              type="button"
              onClick={() => exportQcCsv(modelId)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>📥 تصدير المصفوفة Excel</span>
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              printManualCountSheet({
                siteName: globalSettings?.site_name,
                logo: globalSettings?.logo,
                imageUrl: model.image,
                modelCode: model.model_code,
                modelType: model.model_type,
                stageLabel:
                  selectedStage === 'before_print'
                    ? 'العد قبل الطباعة'
                    : selectedStage === 'after_print'
                    ? 'العد بعد الطباعة'
                    : 'العد بعد المكن',
                sizes: sizeList,
                parts: modelParts.map((part) => ({
                  key: part,
                  colors: getModelColorList(modelId, part)
                }))
              })
            }
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-xs transition cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>🖐️ ورقة جرد يدوي (فارغة)</span>
          </button>
          <button
            type="button"
            onClick={handlePrintWorkerSheet}
            className="flex items-center gap-2 px-5 py-2 rounded-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-md transition cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>🖨️ طباعة ورقة الجرد للعامل</span>
          </button>
        </div>
      </div>

      {/* Model Info Header Card */}
      <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200/80 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4 sm:gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 min-w-0 w-full md:w-auto">
          <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden bg-slate-100 shrink-0 border border-slate-200">
            <ZoomableImage
              src={model.image}
              alt={model.model_code}
              downloadName={`${model.model_code}.jpg`}
              className="w-full h-full object-contain bg-white"
            />
          </div>

          <div className="flex-grow min-w-0">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mb-1 break-words">
              مصفوفة فرز موديل:{' '}
              <span className="text-purple-700">{model.model_code}</span>
            </h1>
            <p className="text-xs text-slate-600 font-semibold mb-1.5">
              ألوان قطعة {getPartLabel(selectedPart)}:{' '}
              <span className="text-slate-900">
                {colorList.join('، ') || 'غير محدد'}
              </span>
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-slate-500 font-medium">
                المقاسات المتاحة:
              </span>
              {sizeList.map((s) => (
                <span
                  key={s}
                  className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-800 text-xs font-bold border border-slate-200"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Stage Selector Tabs */}
        <div className="no-print flex flex-wrap gap-1 w-full md:w-auto bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
          {(
            [
              ['before_print', 'العد قبل الطباعة'],
              ['after_print', 'العد بعد الطباعة'],
              ['after_sewing', 'العد بعد المكن']
            ] as [QCStageType, string][]
          ).map(([st, label]) => (
            <button
              key={st}
              type="button"
              onClick={() => setSelectedStage(st)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                selectedStage === st
                  ? 'bg-purple-700 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Garment part selector — each part is counted independently */}
      <div className="no-print flex items-center gap-2 flex-wrap bg-white rounded-2xl border border-slate-200/80 px-4 py-3 shadow-xs">
        <span className="text-xs font-extrabold text-slate-500">القطعة:</span>
        {modelParts.map((part) => {
          const partStage = selectedPartStages[part] || 'cutting';
          return (
            <button
              key={part}
              type="button"
              onClick={() => setSelectedPart(part)}
              title={`المرحلة الحالية: ${PART_STAGE_LABELS[partStage]}`}
              className={`px-4 py-1.5 rounded-full text-xs font-bold border transition cursor-pointer ${
                selectedPart === part
                  ? 'bg-purple-700 text-white border-purple-700 shadow-xs'
                  : 'bg-white text-slate-600 border-slate-300 hover:border-purple-400'
              }`}
            >
              <span>
                {PART_EMOJI[part]} {getPartLabel(part)}
              </span>
              <span
                className={`ms-1 text-[10px] font-semibold ${
                  selectedPart === part ? 'text-purple-100' : 'text-slate-400'
                }`}
              >
                — {PART_STAGE_LABELS[partStage]}
              </span>
            </button>
          );
        })}
        <span className="ms-auto text-[11px] font-bold text-purple-700">
          المتاح للخياطة: {Number(
            model.sewing_available?.[selectedPart] ??
              model.cut_summary?.[selectedPart] ??
              0
          ).toLocaleString('ar-EG')} قطعة
        </span>
      </div>

      {/* Interactive Matrix Table & Summary */}
      <div className="no-print bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs border-t-4 border-t-purple-600 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-extrabold text-purple-700 flex items-center gap-2">
              <Grid className="w-5 h-5" />
              <span>
                📊 جدول مصفوفة الفرز (الألوان × المقاسات) —{' '}
                {selectedStage === 'before_print'
                  ? 'العد قبل الطباعة'
                  : selectedStage === 'after_print'
                  ? 'العد بعد الطباعة'
                  : 'العد بعد المكن'}
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              أدخل عدد القطع السليمة وعدد القطع التالفة لكل تقاطع بين اللون والمقاس.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-xs min-w-[280px]">
            <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
              <span className="text-[10px] text-emerald-700 font-bold block">
                إجمالي السليم
              </span>
              <strong className="text-base text-emerald-900 font-black">
                {totalGood}
              </strong>
            </div>
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200">
              <span className="text-[10px] text-rose-700 font-bold block">
                إجمالي التالف
              </span>
              <strong className="text-base text-rose-900 font-black">
                {totalDefect}
              </strong>
            </div>
            <div className="p-2.5 rounded-xl bg-purple-50 border border-purple-200">
              <span className="text-[10px] text-purple-700 font-bold block">
                نسبة التالف
              </span>
              <strong className="text-base text-purple-900 font-black">
                {defectRate}%
              </strong>
            </div>
          </div>
        </div>

        {/* شريط مرجعي موحّد: من أين دخلت قطع هذه القطعة، وما المتوقع، وما سُجّل فعلياً */}
        {(() => {
          // عند مرور نفس القطعة بطباعة + تطريز معاً لا نجمع الإرساليتين مرتين.
          const beforeCap = partCounts.beforePrintGood || partCounts.cutPieces;
          const bothPrintAndEmbroidery =
            partCounts.printSent > 0 && partCounts.embroiderySent > 0;
          const isSequentialBoth =
            bothPrintAndEmbroidery &&
            (beforeCap > 0
              ? partCounts.printSent + partCounts.embroiderySent > beforeCap
              : true);
          const effectiveAfterPrintReceived = isSequentialBoth
            ? partCounts.printReceived > 0 && partCounts.embroideryReceived > 0
              ? Math.min(partCounts.printReceived, partCounts.embroideryReceived)
              : Math.max(partCounts.printReceived, partCounts.embroideryReceived)
            : partCounts.printReceived + partCounts.embroideryReceived;
          const effectiveAfterPrintSent = isSequentialBoth
            ? Math.max(partCounts.printSent, partCounts.embroiderySent)
            : partCounts.printSent + partCounts.embroiderySent;

          const stageEntry =
            selectedStage === 'before_print'
              ? partCounts.cutPieces
              : selectedStage === 'after_print'
              ? effectiveAfterPrintReceived ||
                partCounts.beforePrintGood ||
                partCounts.cutPieces
              : partCounts.sewingReceived ||
                partCounts.sewingSent ||
                partCounts.afterPrintGood ||
                partCounts.cutPieces;
          const stageDiff = Math.max(0, stageEntry - totalGood);
          return (
            <div className="rounded-2xl border border-purple-200 bg-purple-50/60 p-3.5">
              <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 lg:grid-cols-5">
                <div>
                  <span className="block text-slate-500">
                    المقصوص الفعلي ({getPartLabel(selectedPart)}):
                  </span>
                  <strong className="text-sm font-black text-slate-900">
                    {partCounts.cutPieces.toLocaleString('ar-EG')}
                  </strong>
                </div>

                {selectedStage === 'before_print' && (
                  <div>
                    <span className="block text-slate-500">التالف قبل الطباعة:</span>
                    <strong className="text-sm font-black text-rose-700">
                      {partCounts.beforePrintDefect.toLocaleString('ar-EG')}
                    </strong>
                  </div>
                )}

                {selectedStage === 'after_print' && (
                  <>
                    <div>
                      <span className="block text-slate-500">السليم قبل الطباعة:</span>
                      <strong className="text-sm font-black text-blue-700">
                        {partCounts.beforePrintGood.toLocaleString('ar-EG')}
                      </strong>
                    </div>
                    <div>
                      <span className="block text-slate-500">الداخل من الطباعة/التطريز:</span>
                      <strong className="text-sm font-black text-indigo-700">
                        {effectiveAfterPrintReceived.toLocaleString('ar-EG')}
                      </strong>
                      <span className="block text-[10px] text-slate-400">
                        مرسل: {effectiveAfterPrintSent.toLocaleString('ar-EG')}
                        {partCounts.printSent > 0 && partCounts.embroiderySent > 0
                          ? ` • طباعة: ${partCounts.printReceived.toLocaleString('ar-EG')}/${partCounts.printSent.toLocaleString('ar-EG')} • تطريز: ${partCounts.embroideryReceived.toLocaleString('ar-EG')}/${partCounts.embroiderySent.toLocaleString('ar-EG')}`
                          : partCounts.embroiderySent > 0
                          ? ` • تطريز: ${partCounts.embroideryReceived.toLocaleString('ar-EG')}/${partCounts.embroiderySent.toLocaleString('ar-EG')}`
                          : ''}
                      </span>
                    </div>
                  </>
                )}

                {selectedStage === 'after_sewing' && (
                  <>
                    <div>
                      <span className="block text-slate-500">المسلّم للمكن:</span>
                      <strong className="text-sm font-black text-amber-700">
                        {partCounts.sewingSent.toLocaleString('ar-EG')}
                      </strong>
                    </div>
                    <div>
                      <span className="block text-slate-500">الداخل من المكن:</span>
                      <strong className="text-sm font-black text-emerald-700">
                        {partCounts.sewingReceived.toLocaleString('ar-EG')}
                      </strong>
                    </div>
                  </>
                )}

                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5">
                  <span className="block font-bold text-emerald-700">المسجل هنا (سليم):</span>
                  <strong className="text-base font-black text-emerald-900">
                    {totalGood.toLocaleString('ar-EG')}
                  </strong>
                </div>
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5">
                  <span className="block font-bold text-rose-700">فرق هذه المرحلة:</span>
                  <strong className="text-base font-black text-rose-900">
                    {stageDiff.toLocaleString('ar-EG')}
                  </strong>
                </div>
              </div>
            </div>
          );
        })()}

        <form onSubmit={handleSaveMatrix} className="space-y-5">
          {/* Auto-fill good cells from cutting spreads */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-slate-500">
              خانة "السليم" تُملأ تلقائياً بالعدد المقصوص الفعلي لكل لون ومقاس — راجع الأرقام ثم اعتمد.
            </span>
            <button
              type="button"
              onClick={handleFillGoodFromCutting}
              disabled={!canEdit}
              title="يملأ خانة السليم في كل الخلايا بالعدد المقصوص المحسوب من فرشات القص"
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold text-[11px] shadow-2xs transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>🔄 ملء تلقائي من أعداد القص</span>
            </button>
          </div>

          {/* Matrix Table */}
          <div className="rounded-2xl border border-slate-300 overflow-x-auto shadow-2xs">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-900 text-white font-bold">
                  <th className="p-3.5 text-right border-b border-e border-slate-700 min-w-[180px]">
                    اللون / المقاس
                  </th>
                  {sizeList.map((sz) => (
                    <th
                      key={sz}
                      className="p-2.5 text-center border-b border-e border-slate-700 min-w-[130px]"
                    >
                      <div className="text-sm font-black text-amber-300 mb-1">
                        مقاس {sz}
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-[10px] font-extrabold">
                        <span className="bg-emerald-700/80 text-white py-0.5 rounded">
                          سليم
                        </span>
                        <span className="bg-rose-700/80 text-white py-0.5 rounded">
                          تالف
                        </span>
                      </div>
                    </th>
                  ))}
                  <th className="p-3.5 text-center border-b border-slate-700 bg-slate-800 min-w-[120px]">
                    إجمالي اللون
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {colorList.map((colName) => {
                  let rowGood = 0;
                  let rowDefect = 0;
                  sizeList.forEach((sz) => {
                    const cell = matrixState[makeCellKey(colName, sz)];
                    rowGood += Number(cell?.good) || 0;
                    rowDefect += Number(cell?.defect) || 0;
                  });

                  return (
                    <tr key={colName} className="hover:bg-slate-50/80 transition">
                      <td className="p-3 font-black text-slate-900 bg-slate-50 border-e border-slate-200">
                        🎨 {colName}
                      </td>
                      {sizeList.map((sz) => {
                        const cell = matrixState[makeCellKey(colName, sz)] || {
                          good: 0,
                          defect: 0
                        };
                        return (
                          <td
                            key={sz}
                            className="p-2 border-e border-slate-200 bg-white align-middle"
                          >
                            <div className="grid grid-cols-2 gap-1.5">
                              <input
                                type="number"
                                min="0"
                                disabled={!canEdit}
                                value={cell.good === 0 ? '' : cell.good}
                                placeholder="0"
                                onChange={(e) =>
                                  handleCellChange(
                                    colName,
                                    sz,
                                    'good',
                                    parseInt(e.target.value) || 0
                                  )
                                }
                                title={`سليم (${colName} - ${sz})`}
                                className="w-full px-1.5 py-1.5 rounded-lg border-2 border-emerald-300 bg-emerald-50/30 text-center font-black text-emerald-900 text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                              />
                              <input
                                type="number"
                                min="0"
                                disabled={!canEdit}
                                value={cell.defect === 0 ? '' : cell.defect}
                                placeholder="0"
                                onChange={(e) =>
                                  handleCellChange(
                                    colName,
                                    sz,
                                    'defect',
                                    parseInt(e.target.value) || 0
                                  )
                                }
                                title={`تالف (${colName} - ${sz})`}
                                className="w-full px-1.5 py-1.5 rounded-lg border-2 border-rose-300 bg-rose-50/30 text-center font-black text-rose-900 text-xs focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
                              />
                            </div>
                          </td>
                        );
                      })}
                      <td className="p-2.5 text-center bg-slate-50 font-bold">
                        <div className="flex flex-col gap-0.5 text-[11px]">
                          <span className="text-emerald-700 font-black">
                            سليم: {rowGood}
                          </span>
                          <span className="text-rose-600 font-bold">
                            تالف: {rowDefect}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold">
                  <td className="p-3 text-slate-900 font-black border-e border-slate-300">
                    إجمالي المقاس
                  </td>
                  {sizeList.map((sz) => {
                    let colGood = 0;
                    let colDefect = 0;
                    colorList.forEach((colName) => {
                      const cell = matrixState[makeCellKey(colName, sz)];
                      colGood += Number(cell?.good) || 0;
                      colDefect += Number(cell?.defect) || 0;
                    });
                    return (
                      <td
                        key={sz}
                        className="p-2 text-center border-e border-slate-300"
                      >
                        <div className="grid grid-cols-2 gap-1 text-[11px]">
                          <span className="px-1 py-0.5 rounded bg-emerald-100 text-emerald-900 font-black">
                            {colGood}
                          </span>
                          <span className="px-1 py-0.5 rounded bg-rose-100 text-rose-900 font-black">
                            {colDefect}
                          </span>
                        </div>
                      </td>
                    );
                  })}
                  <td className="p-2.5 text-center bg-purple-100 text-purple-950 font-black">
                    <div className="text-xs">سليم: {totalGood}</div>
                    <div className="text-[11px] text-rose-700">
                      تالف: {totalDefect}
                    </div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Optional QC Notes Textarea */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-purple-600" />
                <span>ملاحظات الفرز والهالك (اختياري)</span>
              </label>
              {!canWriteNotes && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                  <Lock className="w-3 h-3" />
                  يتطلب صلاحية ملاحظات الفرز
                </span>
              )}
            </div>
            <textarea
              rows={2}
              disabled={!canWriteNotes}
              value={defectNotes}
              onChange={(e) => setDefectNotes(e.target.value)}
              placeholder={
                canWriteNotes
                  ? 'مثال: بقعة زيت، خياطة مفكوكة، نسل بالقماش (اختياري)...'
                  : 'ليس لديك صلاحية كتابة ملاحظات الفرز'
              }
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-purple-500 focus:outline-hidden disabled:bg-slate-100 disabled:text-slate-400"
            />
          </div>

          {canEdit && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <button
                type="submit"
                className="w-full py-3.5 rounded-full bg-purple-700 hover:bg-purple-800 text-white font-extrabold text-xs transition shadow-lg shadow-purple-600/20 flex items-center justify-center gap-2 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>💾 حفظ جدول مصفوفة الفرز</span>
              </button>

              <button
                type="button"
                onClick={handleFinishQC}
                disabled={isSelectedPartEnded}
                className={`w-full py-3.5 rounded-full font-extrabold text-xs transition flex items-center justify-center gap-2 ${
                  isSelectedPartEnded
                    ? 'bg-slate-200 text-slate-600 border border-slate-300 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/20 cursor-pointer'
                }`}
              >
                {isSelectedPartEnded ? (
                  <>
                    <Lock className="w-4 h-4" />
                    <span>🔒 تم الانتهاء وخرجت القطعة بالفعل من هذه المرحلة</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5" />
                    <span>✔️ اعتماد الفرز النهائي وترحيل الموديل للمرحلة التالية</span>
                  </>
                )}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};