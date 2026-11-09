import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  CheckCircle,
  Printer,
  Search,
  Layers,
  Shirt,
  Sparkles,
  ClipboardCheck,
  X,
  FileText,
  Lock,
  Grid,
  Save
} from 'lucide-react';
import { QCStageType, Model, QCMatrixCellInput, GarmentPart, getPartLabel } from '../types';
import { printManualCountSheet } from '../utils/printManualCountSheet';

export const QCView: React.FC = () => {
  const {
    models,
    qcRecords,
    getModelParts,
    getModelColorList,
    getModelSizeList,
    saveQCMatrix,
    recordQCStageCount,
    canAddQCBeforePrintNotes,
    canAddQCAfterPrintNotes,
    hasPermission,
    globalSettings
  } = useApp();

  const canEdit = hasPermission('qc', true);

  const [activeTab, setActiveTab] = useState<QCStageType>('before_print');
  const [searchTerm, setSearchTerm] = useState('');
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [countingModel, setCountingModel] = useState<Model | null>(null);
  const [modalPart, setModalPart] = useState<GarmentPart>('shirt');
  const modalParts: GarmentPart[] = countingModel ? getModelParts(countingModel.id) : [];

  // Matrix state: key is `${color}___${size}` -> { good: number, defect: number }
  const [matrixState, setMatrixState] = useState<
    Record<string, { good: number; defect: number }>
  >({});
  const [qcNotes, setQcNotes] = useState('');

  const canWriteNotesForCurrentStage =
    activeTab === 'before_print'
      ? canAddQCBeforePrintNotes()
      : canAddQCAfterPrintNotes();

  // Filter models based on the active tab
  const getModelsForStage = (stage: QCStageType) => {
    return models.filter((m) => {
      if (m.is_deleted) return false;
      if (stage === 'before_print') {
        return (
          m.status === 'فرز وكنترول' ||
          m.status === 'فرز قبل الطباعة' ||
          m.status === 'العد قبل الطباعة'
        );
      }
      if (stage === 'after_print') {
        return m.status === 'العد بعد الطباعة';
      }
      if (stage === 'after_sewing') {
        return m.status === 'العد بعد المكن';
      }
      return false;
    });
  };

  const currentTabModels = getModelsForStage(activeTab).filter(
    (m) =>
      m.model_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (m.model_type && m.model_type.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const beforePrintCount = getModelsForStage('before_print').length;
  const afterPrintCount = getModelsForStage('after_print').length;
  const afterSewingCount = getModelsForStage('after_sewing').length;
  const totalQCModels = beforePrintCount + afterPrintCount + afterSewingCount;

  const makeCellKey = (color: string, size: string) => `${color}___${size}`;

  const handleOpenCountModal = (model: Model) => {
    const parts = getModelParts(model.id);
    setModalPart(parts[0] || 'shirt');
    setCountingModel(model);
  };

  // Loads the matrix for the currently selected part (each part counted independently).
  useEffect(() => {
    if (!countingModel) return;
    const colors = getModelColorList(countingModel.id, modalPart);
    const sizes = getModelSizeList(countingModel.id);
    const existingStageRecs = qcRecords.filter(
      (r) =>
        r.model_id === countingModel.id &&
        r.stage === activeTab &&
        (r.part_type || 'shirt') === modalPart
    );

    const initialMatrix: Record<string, { good: number; defect: number }> = {};
    let existingNote = '';

    colors.forEach((col) => {
      sizes.forEach((sz) => {
        const match = existingStageRecs.find(
          (r) => r.color_name === col && r.size === sz
        );
        initialMatrix[makeCellKey(col, sz)] = {
          good: match ? Number(match.good_qty ?? match.counted_pieces ?? 0) : 0,
          defect: match ? Number(match.defect_qty ?? match.defect_pieces ?? 0) : 0
        };
        if (match?.notes && !existingNote) {
          existingNote = match.notes;
        }
      });
    });

    setMatrixState(initialMatrix);
    setQcNotes(existingNote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countingModel, modalPart, activeTab, qcRecords]);

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

  const buildMatrixEntriesFromState = (model: Model): QCMatrixCellInput[] => {
    const colors = getModelColorList(model.id, modalPart);
    const sizes = getModelSizeList(model.id);
    const entries: QCMatrixCellInput[] = [];

    colors.forEach((col) => {
      sizes.forEach((sz) => {
        const cell = matrixState[makeCellKey(col, sz)] || { good: 0, defect: 0 };
        entries.push({
          part_type: modalPart,
          color_name: col,
          size: sz,
          good_qty: Number(cell.good) || 0,
          defect_qty: Number(cell.defect) || 0,
          notes: canWriteNotesForCurrentStage ? qcNotes.trim() : ''
        });
      });
    });
    return entries;
  };

  const handleSaveMatrixOnly = () => {
    if (!countingModel) return;
    const entries = buildMatrixEntriesFromState(countingModel);
    saveQCMatrix({
      modelId: countingModel.id,
      stage: activeTab,
      partType: modalPart,
      matrixEntries: entries,
      notes: canWriteNotesForCurrentStage ? qcNotes.trim() : ''
    });
  };

  const handleApproveAndAdvance = (e: React.FormEvent) => {
    e.preventDefault();
    if (!countingModel) return;

    const entries = buildMatrixEntriesFromState(countingModel);
    const totalGood = entries.reduce((sum, item) => sum + item.good_qty, 0);
    const totalDefect = entries.reduce((sum, item) => sum + item.defect_qty, 0);

    if (totalGood === 0 && totalDefect === 0) {
      if (
        !window.confirm(
          'جميع خلايا الجدول (السليم والتالف) تساوي صفر. هل أنت متأكد من المتابعة؟'
        )
      ) {
        return;
      }
    }

    recordQCStageCount({
      modelId: countingModel.id,
      stage: activeTab,
      partType: modalPart,
      piecesCounted: totalGood,
      defectQty: totalDefect,
      matrixEntries: entries,
      defectNotes: canWriteNotesForCurrentStage ? qcNotes.trim() : '',
      advanceStage: true
    });

    setCountingModel(null);
  };

  const getStageTitle = (stage: QCStageType) => {
    switch (stage) {
      case 'before_print':
        return 'العد قبل الطباعة (المحول من القص)';
      case 'after_print':
        return 'العد بعد الطباعة (المستلم من المطبعة)';
      case 'after_sewing':
        return 'العد بعد المكن (الفحص النهائي)';
    }
  };

  // Prints a blank A4 manual-count sheet (one table per garment part) for floor workers.
  const handlePrintManualSheet = (model: Model) => {
    const parts = getModelParts(model.id);
    printManualCountSheet({
      siteName: globalSettings?.site_name,
      modelCode: model.model_code,
      modelType: model.model_type,
      stageLabel: getStageTitle(activeTab) || '',
      sizes: getModelSizeList(model.id),
      parts: parts.map((part) => ({
        key: part,
        colors: getModelColorList(model.id, part)
      }))
    });
  };

  const getNextStageLabel = (stage: QCStageType) => {
    switch (stage) {
      case 'before_print':
        return 'التحويل لقسم المطابع والتطريز';
      case 'after_print':
        return 'التحويل لقسم المكن (الخياطة)';
      case 'after_sewing':
        return 'التحويل لمخزن الإنتاج التام';
    }
  };

  // Compute active modal matrix dimensions & totals
  const modalColors = countingModel ? getModelColorList(countingModel.id, modalPart) : [];
  const modalSizes = countingModel ? getModelSizeList(countingModel.id) : [];

  const modalTotalGood = Object.values(matrixState).reduce(
    (sum, cell) => sum + (Number(cell.good) || 0),
    0
  );
  const modalTotalDefect = Object.values(matrixState).reduce(
    (sum, cell) => sum + (Number(cell.defect) || 0),
    0
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-purple-800 tracking-tight flex items-center gap-2">
            <ClipboardCheck className="w-8 h-8 text-purple-600" />
            <span>قسم الفرز والكنترول والجودة (نظام المصفوفة)</span>
          </h2>
          <p className="text-slate-500 text-sm mt-0.5">
            مصفوفة الفرز الديناميكية (الألوان × المقاسات) لتسجيل القطع السليمة والتالفة لكل تقاطع بدقة عبر المراحل الثلاث.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPrintModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-purple-700 hover:bg-purple-800 text-white font-bold text-sm shadow-md shadow-purple-600/20 transition-all hover:scale-102 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة جرد المرحلة الحالية</span>
          </button>
        </div>
      </div>

      {/* Top Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-500 mb-1">إجمالي الموديلات بالفرز</p>
            <h3 className="text-2xl font-black text-purple-900">{totalQCModels}</h3>
            <span className="text-xs text-purple-600 font-semibold mt-1 inline-block">جميع مراحل الجودة</span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center">
            <Layers className="w-6 h-6" />
          </div>
        </div>

        <div
          onClick={() => setActiveTab('before_print')}
          className={`p-5 rounded-3xl border cursor-pointer transition-all shadow-xs flex items-center justify-between ${
            activeTab === 'before_print'
              ? 'bg-purple-50/70 border-purple-300 ring-2 ring-purple-500/20'
              : 'bg-white border-slate-200/80 hover:border-purple-200'
          }`}
        >
          <div>
            <p className="text-xs font-bold text-slate-500 mb-1">العد قبل الطباعة</p>
            <h3 className="text-2xl font-black text-amber-700">{beforePrintCount}</h3>
            <span className="text-xs text-amber-600 font-semibold mt-1 inline-block">من قسم القص</span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
            1
          </div>
        </div>

        <div
          onClick={() => setActiveTab('after_print')}
          className={`p-5 rounded-3xl border cursor-pointer transition-all shadow-xs flex items-center justify-between ${
            activeTab === 'after_print'
              ? 'bg-purple-50/70 border-purple-300 ring-2 ring-purple-500/20'
              : 'bg-white border-slate-200/80 hover:border-purple-200'
          }`}
        >
          <div>
            <p className="text-xs font-bold text-slate-500 mb-1">العد بعد الطباعة</p>
            <h3 className="text-2xl font-black text-blue-700">{afterPrintCount}</h3>
            <span className="text-xs text-blue-600 font-semibold mt-1 inline-block">من المطابع والتطريز</span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
            2
          </div>
        </div>

        <div
          onClick={() => setActiveTab('after_sewing')}
          className={`p-5 rounded-3xl border cursor-pointer transition-all shadow-xs flex items-center justify-between ${
            activeTab === 'after_sewing'
              ? 'bg-purple-50/70 border-purple-300 ring-2 ring-purple-500/20'
              : 'bg-white border-slate-200/80 hover:border-purple-200'
          }`}
        >
          <div>
            <p className="text-xs font-bold text-slate-500 mb-1">العد بعد المكن</p>
            <h3 className="text-2xl font-black text-emerald-700">{afterSewingCount}</h3>
            <span className="text-xs text-emerald-600 font-semibold mt-1 inline-block">من خط الخياطة</span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
            3
          </div>
        </div>
      </div>

      {/* Tabs Bar & Search */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/80 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* 3 Main Internal Tabs */}
        <div className="flex bg-slate-100 p-1 rounded-2xl w-full sm:w-auto">
          <button
            onClick={() => setActiveTab('before_print')}
            className={`flex-1 sm:flex-none px-5 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer ${
              activeTab === 'before_print'
                ? 'bg-purple-700 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>العد قبل الطباعة</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] ${
                activeTab === 'before_print'
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-200 text-slate-700'
              }`}
            >
              {beforePrintCount}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('after_print')}
            className={`flex-1 sm:flex-none px-5 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer ${
              activeTab === 'after_print'
                ? 'bg-purple-700 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>العد بعد الطباعة</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] ${
                activeTab === 'after_print'
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-200 text-slate-700'
              }`}
            >
              {afterPrintCount}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('after_sewing')}
            className={`flex-1 sm:flex-none px-5 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer ${
              activeTab === 'after_sewing'
                ? 'bg-purple-700 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>العد بعد المكن</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] ${
                activeTab === 'after_sewing'
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-200 text-slate-700'
              }`}
            >
              {afterSewingCount}
            </span>
          </button>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="بحث برقم الموديل أو النوع..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full ps-9 pe-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition"
          />
        </div>
      </div>

      {/* Section Sub-banner info */}
      <div className="bg-purple-50/60 border border-purple-200/80 rounded-2xl p-3 px-5 flex items-center justify-between text-xs text-purple-900 font-semibold">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-600" />
          <span>
            المرحلة الحالية: <strong>{getStageTitle(activeTab)}</strong>
          </span>
        </div>
        <span className="text-purple-700 font-bold">
          الخطوة التالية بعد الاعتماد: {getNextStageLabel(activeTab)}
        </span>
      </div>

      {/* Grid of Models in this stage */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {currentTabModels.length > 0 ? (
          currentTabModels.map((model) => {
            const cutPieces = model.total_cut_pieces || 0;
            const targetPieces = model.target_cut_quantity || 0;
            const beforePrint = model.count_before_print;
            const afterPrint = model.count_after_print;
            const mColors = getModelColorList(model.id);
            const mSizes = getModelSizeList(model.id);
            const stageSavedRecs = qcRecords.filter(
              (r) => r.model_id === model.id && r.stage === activeTab
            );
            const stageSavedGood = stageSavedRecs.reduce(
              (s, r) => s + (r.good_qty ?? r.counted_pieces ?? 0),
              0
            );
            const stageSavedDefect = stageSavedRecs.reduce(
              (s, r) => s + (r.defect_qty ?? r.defect_pieces ?? 0),
              0
            );

            return (
              <div
                key={model.id}
                className="bg-white rounded-3xl border border-slate-200/80 shadow-xs hover:shadow-lg transition-all duration-200 overflow-hidden flex flex-col justify-between group"
              >
                <div className="h-52 w-full overflow-hidden bg-slate-100 relative">
                  {model.image ? (
                    <img
                      src={model.image}
                      alt={model.model_code}
                      className="w-full h-full object-contain bg-slate-50 group-hover:scale-105 transition-transform duration-300"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src =
                          'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500&auto=format&fit=crop&q=60';
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400">
                      <Shirt className="w-10 h-10 opacity-40" />
                    </div>
                  )}

                  <span className="absolute top-3 end-3 px-3 py-1 rounded-full text-[11px] font-bold bg-purple-700 text-white shadow-xs">
                    {model.status}
                  </span>

                  {model.cutter_name && (
                    <span className="absolute bottom-3 start-3 px-2.5 py-0.5 rounded-lg text-[10px] font-bold bg-black/60 backdrop-blur-xs text-white">
                      مقصدار: {model.cutter_name}
                    </span>
                  )}
                </div>

                <div className="p-5 flex flex-col justify-between flex-grow space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-xl font-extrabold text-slate-900">
                        {model.model_code}
                      </h3>
                      <span className="text-xs px-2.5 py-0.5 bg-slate-100 text-slate-700 rounded-lg font-bold">
                        {model.model_type || 'تيشرت/بنطلون'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[10px] font-bold text-slate-500">
                      <span className="px-2 py-0.5 rounded-md bg-purple-50 text-purple-800 border border-purple-200">
                        {mColors.length} ألوان
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                        مقاسات: {mSizes.join('، ')}
                      </span>
                    </div>

                    {/* Stats summary table */}
                    <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100 space-y-1.5 text-xs mt-3">
                      <div className="flex justify-between items-center text-slate-600">
                        <span>العدد المستهدف للقص:</span>
                        <strong className="text-slate-900">
                          {targetPieces.toLocaleString('ar-EG')} ق
                        </strong>
                      </div>
                      <div className="flex justify-between items-center text-slate-600">
                        <span>العدد المقصوص الفعلي:</span>
                        <strong className="text-purple-700 font-extrabold">
                          {cutPieces.toLocaleString('ar-EG')} ق
                        </strong>
                      </div>

                      {/* Per-part cut breakdown (parts are never summed together) */}
                      {getModelParts(model.id).length > 1 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {getModelParts(model.id).map((part) => (
                            <span
                              key={part}
                              className="px-2 py-0.5 rounded-lg bg-purple-50 text-purple-800 border border-purple-200 text-[10px] font-bold"
                            >
                              {getPartLabel(part)}:{' '}
                              {Number(model.cut_summary?.[part] ?? 0).toLocaleString('ar-EG')}
                            </span>
                          ))}
                        </div>
                      )}

                      {stageSavedRecs.length > 0 && (
                        <div className="flex justify-between items-center text-emerald-700 pt-1 border-t border-slate-200/70">
                          <span>مسجل بالجدول حالياً:</span>
                          <strong className="font-black">
                            سليم: {stageSavedGood} | تالف: {stageSavedDefect}
                          </strong>
                        </div>
                      )}

                      {activeTab !== 'before_print' && beforePrint !== undefined && (
                        <div className="flex justify-between items-center text-slate-600">
                          <span>العدد قبل الطباعة:</span>
                          <strong className="text-blue-700 font-bold">
                            {beforePrint.toLocaleString('ar-EG')} ق
                          </strong>
                        </div>
                      )}

                      {activeTab === 'after_sewing' && afterPrint !== undefined && (
                        <div className="flex justify-between items-center text-slate-600">
                          <span>العدد بعد الطباعة:</span>
                          <strong className="text-emerald-700 font-bold">
                            {afterPrint.toLocaleString('ar-EG')} ق
                          </strong>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <button
                      onClick={() => handleOpenCountModal(model)}
                      className="w-full py-2.5 px-4 rounded-full bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs transition shadow-md shadow-purple-600/20 flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Grid className="w-4 h-4" />
                      <span>فتح جدول الفرز (الألوان × المقاسات)</span>
                    </button>
                    <button
                      onClick={() => handlePrintManualSheet(model)}
                      className="w-full py-2 px-4 rounded-full bg-white hover:bg-purple-50 text-purple-700 border border-purple-300 font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Printer className="w-4 h-4" />
                      <span>🖐️ طباعة ورقة جرد يدوي (فارغة)</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="col-span-full py-16 text-center bg-white rounded-3xl border border-slate-200/80 p-8 text-slate-400">
            <ClipboardCheck className="w-12 h-12 mx-auto mb-2 text-purple-300" />
            <p className="font-bold text-slate-700 text-base">
              لا توجد موديلات في مرحلة "{getStageTitle(activeTab)}" حالياً
            </p>
            <p className="text-xs text-slate-400 mt-1">
              الموديلات تظهر في كل مرحلة تباعاً عند إنهاء المرحلة السابقة.
            </p>
          </div>
        )}
      </div>

      {/* MODAL 1: Dynamic Matrix (Color x Size) for Good & Defect Counts */}
      {countingModel && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-6xl w-full p-5 sm:p-6 shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-150 my-auto max-h-[94vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-purple-100 text-purple-700 flex items-center justify-center">
                  <Grid className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-base sm:text-lg">
                    مصفوفة الفرز والعد للموديل: {countingModel.model_code}
                  </h3>
                  <p className="text-xs text-purple-600 font-bold">
                    المرحلة: {getStageTitle(activeTab)} — القطعة: {getPartLabel(modalPart)} — إدخال (السليم والتالف) لكل لون ومقاس على حدة
                  </p>
                </div>
              </div>
              <button
                onClick={() => setCountingModel(null)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:text-slate-600 hover:bg-slate-200 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Per-part selector: every garment part is counted independently */}
            {modalParts.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap pt-3 shrink-0">
                <span className="text-xs font-bold text-slate-500">القطعة:</span>
                {modalParts.map((part) => (
                  <button
                    key={part}
                    type="button"
                    onClick={() => setModalPart(part)}
                    className={`px-4 py-1.5 rounded-full text-xs font-bold border transition cursor-pointer ${
                      modalPart === part
                        ? 'bg-purple-700 text-white border-purple-700 shadow-xs'
                        : 'bg-white text-slate-600 border-slate-300 hover:border-purple-400'
                    }`}
                  >
                    {getPartLabel(part)}
                  </button>
                ))}
                <span className="text-[11px] font-bold text-purple-600 ms-auto">
                  العدد المتاح للقطعة:{' '}
                  {Number(countingModel?.sewing_available?.[modalPart] ?? countingModel?.cut_summary?.[modalPart] ?? 0).toLocaleString('ar-EG')} قطعة
                </span>
              </div>
            )}

            <form
              onSubmit={handleApproveAndAdvance}
              className="space-y-4 pt-4 overflow-y-auto flex-grow"
            >
              {/* Reference Summary Banner */}
              <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-200/80 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-slate-500 block">المقصوص الفعلي ({getPartLabel(modalPart)}):</span>
                  <strong className="text-slate-900 text-sm font-black">
                    {Number(
                      countingModel.cut_summary?.[modalPart] ??
                        countingModel.total_cut_pieces ??
                        0
                    ).toLocaleString('ar-EG')} قطعة
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 block">العدد المستهدف:</span>
                  <strong className="text-slate-800 text-sm font-black">
                    {(countingModel.target_cut_quantity || 0).toLocaleString('ar-EG')} قطعة
                  </strong>
                </div>
                <div className="bg-emerald-50/90 border border-emerald-200 rounded-xl px-3 py-1.5">
                  <span className="text-emerald-700 font-bold block">إجمالي السليم بالجدول:</span>
                  <strong className="text-emerald-900 text-base font-black">
                    {modalTotalGood.toLocaleString('ar-EG')} قطعة
                  </strong>
                </div>
                <div className="bg-rose-50/90 border border-rose-200 rounded-xl px-3 py-1.5">
                  <span className="text-rose-700 font-bold block">إجمالي التالف (الهالك):</span>
                  <strong className="text-rose-900 text-base font-black">
                    {modalTotalDefect.toLocaleString('ar-EG')} قطعة
                  </strong>
                </div>
              </div>

              {/* DYNAMIC MATRIX TABLE (Colors x Sizes) */}
              <div className="rounded-2xl border border-slate-300 overflow-x-auto shadow-2xs">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-900 text-white font-bold">
                      <th className="p-3 text-right border-b border-e border-slate-700 min-w-[170px]">
                        اللون / المقاس
                      </th>
                      {modalSizes.map((sz) => (
                        <th
                          key={sz}
                          className="p-2.5 text-center border-b border-e border-slate-700 min-w-[125px]"
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
                      <th className="p-3 text-center border-b border-slate-700 bg-slate-800 min-w-[120px]">
                        إجمالي اللون
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {modalColors.map((colName) => {
                      let rowGood = 0;
                      let rowDefect = 0;
                      modalSizes.forEach((sz) => {
                        const cell = matrixState[makeCellKey(colName, sz)];
                        rowGood += Number(cell?.good) || 0;
                        rowDefect += Number(cell?.defect) || 0;
                      });

                      return (
                        <tr key={colName} className="hover:bg-slate-50/80 transition">
                          <td className="p-3 font-black text-slate-900 bg-slate-50 border-e border-slate-200">
                            🎨 {colName}
                          </td>

                          {modalSizes.map((sz) => {
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
                                  {/* Good pieces input */}
                                  <div>
                                    <input
                                      type="number"
                                      min={0}
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
                                      title={`القطع السليمة (${colName} - مقاس ${sz})`}
                                      className="w-full px-1.5 py-1.5 rounded-lg border-2 border-emerald-300 bg-emerald-50/30 text-center font-black text-emerald-900 text-xs focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                                    />
                                  </div>
                                  {/* Defect pieces input */}
                                  <div>
                                    <input
                                      type="number"
                                      min={0}
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
                                      title={`القطع التالفة (${colName} - مقاس ${sz})`}
                                      className="w-full px-1.5 py-1.5 rounded-lg border-2 border-rose-300 bg-rose-50/30 text-center font-black text-rose-900 text-xs focus:outline-hidden focus:ring-2 focus:ring-rose-500"
                                    />
                                  </div>
                                </div>
                              </td>
                            );
                          })}

                          {/* Row Totals */}
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

                  {/* Column Totals Footer */}
                  <tfoot>
                    <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold">
                      <td className="p-3 text-slate-900 font-black border-e border-slate-300">
                        إجمالي المقاس
                      </td>
                      {modalSizes.map((sz) => {
                        let colGood = 0;
                        let colDefect = 0;
                        modalColors.forEach((colName) => {
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
                        <div className="text-xs">سليم: {modalTotalGood}</div>
                        <div className="text-[11px] text-rose-700">
                          تالف: {modalTotalDefect}
                        </div>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Deficit Calculation Preview against Cut Pieces */}
              {(() => {
                const cutCount = countingModel.total_cut_pieces || 0;
                const deficit = cutCount - modalTotalGood;
                return (
                  <div
                    className={`p-3 rounded-2xl border text-xs flex items-center justify-between ${
                      deficit > 0
                        ? 'bg-amber-50 border-amber-200 text-amber-900'
                        : deficit < 0
                        ? 'bg-blue-50 border-blue-200 text-blue-900'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    }`}
                  >
                    <span className="font-bold">
                      {deficit > 0
                        ? '⚠️ الفرق بين المقصوص وإجمالي السليم بالجدول:'
                        : deficit < 0
                        ? 'زيادة عن المقصوص:'
                        : '✅ إجمالي السليم بالجدول مطابق للمقصوص تماماً:'}
                    </span>
                    <strong className="text-sm font-black">
                      {Math.abs(deficit).toLocaleString('ar-EG')} قطعة{' '}
                      {deficit > 0 ? 'عجز / هالك' : deficit < 0 ? 'زيادة' : ''}
                    </strong>
                  </div>
                );
              })()}

              {/* QC Notes gated by stage-specific notes permission */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-purple-600" />
                    <span>
                      ملاحظات{' '}
                      {activeTab === 'before_print'
                        ? 'الفرز قبل الطباعة'
                        : activeTab === 'after_print'
                        ? 'الفرز بعد الطباعة'
                        : 'الفرز بعد المكن'}{' '}
                      (اختياري)
                    </span>
                  </label>
                  {!canWriteNotesForCurrentStage && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                      <Lock className="w-3 h-3" />
                      يتطلب صلاحية ملاحظات{' '}
                      {activeTab === 'before_print'
                        ? 'الفرز قبل الطباعة'
                        : 'الفرز بعد الطباعة'}
                    </span>
                  )}
                </div>
                <textarea
                  rows={2}
                  disabled={!canWriteNotesForCurrentStage}
                  value={qcNotes}
                  onChange={(e) => setQcNotes(e.target.value)}
                  placeholder={
                    canWriteNotesForCurrentStage
                      ? 'أي ملاحظات حول عيوب الألوان والمقاسات، الطباعة، نظافة التشغيل، الخ (اختياري)...'
                      : 'ليس لديك صلاحية كتابة ملاحظات في هذه المرحلة'
                  }
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 disabled:bg-slate-100 disabled:text-slate-400"
                />
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-end gap-2.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCountingModel(null)}
                  className="px-5 py-2.5 rounded-full border border-slate-200 text-slate-600 font-bold text-xs hover:bg-slate-100 transition cursor-pointer"
                >
                  إغلاق
                </button>
                {canEdit && (
                  <>
                    <button
                      type="button"
                      onClick={handleSaveMatrixOnly}
                      className="px-5 py-2.5 rounded-full bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                    >
                      <Save className="w-4 h-4" />
                      <span>حفظ الجدول فقط (بدون ترحيل المرحلة)</span>
                    </button>
                    <button
                      type="submit"
                      className="px-6 py-2.5 rounded-full bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs shadow-md shadow-purple-600/20 transition flex items-center gap-2 cursor-pointer"
                    >
                      <CheckCircle className="w-4 h-4" />
                      <span>اعتماد جدول العد وتوجيه الموديل للخطوة التالية</span>
                    </button>
                  </>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Printable Stage Inventory Report */}
      {showPrintModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-4xl w-full p-6 shadow-2xl border border-slate-100 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-purple-100 text-purple-700 flex items-center justify-center">
                  <Printer className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-lg">
                    تقرير جرد مرحلة: {getStageTitle(activeTab)}
                  </h3>
                  <p className="text-xs text-slate-500">
                    كشف تفصيلي يبين (العدد المقصوص، العدد الفعلي السليم، التالف، والعجز)
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-4 py-2 rounded-full bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>طباعة فورية</span>
                </button>
                <button
                  onClick={() => setShowPrintModal(false)}
                  className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Printable Content Area */}
            <div
              className="overflow-y-auto flex-grow p-4 print:p-0"
              id="qc-printable-report"
            >
              <div className="text-center mb-6 border-b border-slate-300 pb-4">
                <h1 className="text-xl font-black text-slate-900">
                  {globalSettings?.site_name ||
                    'مصنع الملابس الجاهزة - نظام إدارة الإنتاج'}
                </h1>
                <h2 className="text-base font-bold text-purple-800 mt-1">
                  تقرير تدقيق ومطابقة مرحلة الفرز: {getStageTitle(activeTab)}
                </h2>
                <div className="text-xs text-slate-500 mt-1 flex justify-center gap-6">
                  <span>تاريخ التقرير: {new Date().toLocaleDateString('ar-EG')}</span>
                  <span>عدد الموديلات: {currentTabModels.length}</span>
                </div>
              </div>

              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-y border-slate-300 text-slate-700 font-bold">
                    <th className="py-2.5 px-3">#</th>
                    <th className="py-2.5 px-3">كود الموديل</th>
                    <th className="py-2.5 px-3">نوع الموديل</th>
                    <th className="py-2.5 px-3">المقصدار</th>
                    <th className="py-2.5 px-3 text-center">العدد المستهدف</th>
                    <th className="py-2.5 px-3 text-center">العدد المقصوص</th>
                    <th className="py-2.5 px-3 text-center">العدد السليم</th>
                    <th className="py-2.5 px-3 text-center">التالف</th>
                    <th className="py-2.5 px-3 text-center">العجز / الفاقد</th>
                    <th className="py-2.5 px-3">ملاحظات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {currentTabModels.map((model, idx) => {
                    const cut = model.total_cut_pieces || 0;
                    const target = model.target_cut_quantity || 0;
                    const stageRecs = qcRecords.filter(
                      (r) => r.model_id === model.id && r.stage === activeTab
                    );
                    const stageDefects = stageRecs.reduce(
                      (s, r) => s + (r.defect_qty ?? r.defect_pieces ?? 0),
                      0
                    );

                    let actual = 0;
                    if (activeTab === 'before_print') {
                      actual = model.count_before_print ?? 0;
                    } else if (activeTab === 'after_print') {
                      actual = model.count_after_print ?? 0;
                    } else {
                      actual = model.count_after_sewing ?? 0;
                    }

                    const deficit = cut - actual;

                    return (
                      <tr key={model.id} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-semibold text-slate-400">
                          {idx + 1}
                        </td>
                        <td className="py-2 px-3 font-black text-slate-900">
                          {model.model_code}
                        </td>
                        <td className="py-2 px-3 text-slate-700">
                          {model.model_type || '-'}
                        </td>
                        <td className="py-2 px-3 text-slate-700">
                          {model.cutter_name || '-'}
                        </td>
                        <td className="py-2 px-3 text-center text-slate-600">
                          {target.toLocaleString('ar-EG')}
                        </td>
                        <td className="py-2 px-3 text-center font-bold text-slate-900">
                          {cut.toLocaleString('ar-EG')}
                        </td>
                        <td className="py-2 px-3 text-center font-extrabold text-emerald-700">
                          {actual > 0 ? actual.toLocaleString('ar-EG') : 'قيد العد'}
                        </td>
                        <td className="py-2 px-3 text-center font-bold text-rose-600">
                          {stageDefects > 0
                            ? stageDefects.toLocaleString('ar-EG')
                            : '0'}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {actual > 0 ? (
                            deficit > 0 ? (
                              <span className="font-black text-red-600">
                                {deficit.toLocaleString('ar-EG')} (عجز)
                              </span>
                            ) : deficit < 0 ? (
                              <span className="font-bold text-blue-600">
                                {Math.abs(deficit).toLocaleString('ar-EG')} (زيادة)
                              </span>
                            ) : (
                              <span className="font-bold text-emerald-600">
                                مطابق (0)
                              </span>
                            )
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="py-2 px-3 text-slate-500 text-[11px]">
                          {model.design_notes ||
                            model.notes_shirt ||
                            model.notes_pants ||
                            '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="mt-8 pt-6 border-t border-slate-300 flex justify-between items-center text-xs text-slate-600 font-bold px-4">
                <div>
                  توقيع مسؤول الفرز والكنترول: .......................................
                </div>
                <div>
                  توقيع مدير الإنتاج: .......................................
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setShowPrintModal(false)}
                className="px-6 py-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};