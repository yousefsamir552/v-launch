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
  Save
} from 'lucide-react';
import {
  QCStageType,
  QCMatrixCellInput,
  GarmentPart,
  PART_EMOJI,
  PART_STAGE_LABELS,
  getPartLabel
} from '../types';
import { printManualCountSheet } from '../utils/printManualCountSheet';

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

  useEffect(() => {
    const stageRecs = qcRecords.filter(
      (r) =>
        r.model_id === modelId &&
        r.stage === selectedStage &&
        (r.part_type || 'shirt') === selectedPart
    );
    const nextMatrix: Record<string, { good: number; defect: number }> = {};
    let existingNote = '';

    colorList.forEach((col) => {
      sizeList.forEach((sz) => {
        const match = stageRecs.find((r) => r.color_name === col && r.size === sz);
        nextMatrix[makeCellKey(col, sz)] = {
          good: match ? Number(match.good_qty ?? match.counted_pieces ?? 0) : 0,
          defect: match ? Number(match.defect_qty ?? match.defect_pieces ?? 0) : 0
        };
        if (match?.notes && !existingNote) {
          existingNote = match.notes;
        }
      });
    });

    setMatrixState(nextMatrix);
    setDefectNotes(existingNote);
  }, [modelId, selectedStage, selectedPart, qcRecords, colorList.join('|'), sizeList.join('|')]);

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
          (r.part_type || 'shirt') === part
      );
      const matrix: Record<string, { good: number; defect: number }> = {};
      partColors.forEach((col) => {
        sizeList.forEach((sz) => {
          const match = partRecs.find((r) => r.color_name === col && r.size === sz);
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

        <div className="flex items-center gap-2">
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
            onClick={() => window.print()}
            className="flex items-center gap-2 px-5 py-2 rounded-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-md transition cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>🖨️ طباعة ورقة الجرد للعامل</span>
          </button>
        </div>
      </div>

      {/* Model Info Header Card */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-center gap-6">
          <div className="w-28 h-28 rounded-2xl overflow-hidden bg-slate-100 shrink-0 border border-slate-200">
            <img
              src={model.image}
              alt={model.model_code}
              className="w-full h-full object-contain bg-white"
              onError={(e) => {
                (e.target as HTMLImageElement).src =
                  'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500&auto=format&fit=crop&q=60';
              }}
            />
          </div>

          <div className="flex-grow">
            <h1 className="text-2xl font-black text-slate-900 tracking-tight mb-1">
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
        <div className="no-print flex bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
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

      {/* PRINT-ONLY WORKER SHEET */}
      <div className="hidden print:block my-8 p-6 bg-white border border-black rounded-lg">
        <div className="text-center mb-6">
          <h2 className="text-xl font-bold mb-1">
            🏭 {globalSettings?.site_name || 'مصنع الملابس الجاهزة'} - قسم الفرز
            والجودة
          </h2>
          <h3 className="text-lg font-bold">
            📋 جدول مصفوفة الفرز والعد ({selectedStage === 'before_print' ? 'العد قبل الطباعة' : selectedStage === 'after_print' ? 'العد بعد الطباعة' : 'العد بعد المكن'}) — القطع: {modelParts.map((p) => getPartLabel(p)).join(' + ')}
          </h3>
          <p className="text-sm mt-1">
            موديل: {model.model_code} | التاريخ:{' '}
            {new Date().toLocaleDateString('ar-EG')}
          </p>
        </div>

        {modelParts.map((part) => {
          const partData = printMatrixByPart[part] || {
            colors: [] as string[],
            matrix: {} as Record<string, { good: number; defect: number }>
          };
          const partColors = partData.colors;
          const partMatrix = partData.matrix;
          return (
            <div key={part} className="mb-8">
              <h4 className="text-base font-bold text-center mb-2">
                قطعة: {getPartLabel(part)}
              </h4>
              <table className="w-full border-collapse border border-black text-center text-sm">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border border-black p-3 font-bold">اللون / المقاس</th>
                    {sizeList.map((sz) => (
                      <th key={sz} className="border border-black p-3 font-bold">
                        {sz} (سليم / تالف)
                      </th>
                    ))}
                    <th className="border border-black p-3 font-bold">المجموع السليم</th>
                    <th className="border border-black p-3 font-bold">الهالك</th>
                  </tr>
                </thead>
                <tbody>
                  {partColors.map((col) => {
                    let rGood = 0;
                    let rDef = 0;
                    sizeList.forEach((sz) => {
                      const c = partMatrix[makeCellKey(col, sz)];
                      rGood += Number(c?.good) || 0;
                      rDef += Number(c?.defect) || 0;
                    });
                    return (
                      <tr key={col}>
                        <td className="border border-black p-4 font-bold text-start">
                          {col}
                        </td>
                        {sizeList.map((sz) => {
                          const c = partMatrix[makeCellKey(col, sz)];
                          return (
                            <td key={sz} className="border border-black p-4 h-12">
                              {c && (c.good > 0 || c.defect > 0)
                                ? `${c.good} سليم / ${c.defect} تالف`
                                : ''}
                            </td>
                          );
                        })}
                        <td className="border border-black p-4 font-bold">
                          {rGood > 0 ? rGood : ''}
                        </td>
                        <td className="border border-black p-4 font-bold">
                          {rDef > 0 ? rDef : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}

        <div className="mt-8 flex justify-between text-sm pt-4">
          <div>توقيع مستلم الفرز: .......................................</div>
          <div>اعتماد مشرف الجودة: .......................................</div>
        </div>
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

        <form onSubmit={handleSaveMatrix} className="space-y-5">
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
                className="w-full py-3.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs transition shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="w-5 h-5" />
                <span>✔️ اعتماد الفرز النهائي وترحيل الموديل للمرحلة التالية</span>
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};