import React, { useState } from 'react';
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
  Lock
} from 'lucide-react';
import { QCStageType, Model } from '../types';

export const QCView: React.FC = () => {
  const {
    models,
    recordQCStageCount,
    canAddQCBeforePrintNotes,
    canAddQCAfterPrintNotes,
    globalSettings
  } = useApp();

  const [activeTab, setActiveTab] = useState<QCStageType>('before_print');
  const [searchTerm, setSearchTerm] = useState('');
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [countingModel, setCountingModel] = useState<Model | null>(null);

  // Form states for count submission modal
  const [countedPieces, setCountedPieces] = useState<number>(0);
  const [defectPieces, setDefectPieces] = useState<number>(0);
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

  const currentTabModels = getModelsForStage(activeTab).filter((m) =>
    m.model_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (m.model_type && m.model_type.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const beforePrintCount = getModelsForStage('before_print').length;
  const afterPrintCount = getModelsForStage('after_print').length;
  const afterSewingCount = getModelsForStage('after_sewing').length;
  const totalQCModels = beforePrintCount + afterPrintCount + afterSewingCount;

  const handleOpenCountModal = (model: Model) => {
    setCountingModel(model);
    const initialCount = model.total_cut_pieces || model.target_cut_quantity || 0;
    setCountedPieces(initialCount);
    setDefectPieces(0);
    setQcNotes('');
  };

  const handleSaveCount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!countingModel) return;

    recordQCStageCount({
      modelId: countingModel.id,
      stage: activeTab,
      piecesCounted: countedPieces,
      defectQty: defectPieces,
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

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-purple-800 tracking-tight flex items-center gap-2">
            <ClipboardCheck className="w-8 h-8 text-purple-600" />
            <span>قسم الفرز والكنترول والجودة</span>
          </h2>
          <p className="text-slate-500 text-sm mt-0.5">
            متابعة مراحل العد والتدقيق الثلاثية (قبل الطباعة، بعد الطباعة، وبعد المكن) بدقة مع احتساب الهوالك والعجز.
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
            activeTab === 'before_print' ? 'bg-purple-50/70 border-purple-300 ring-2 ring-purple-500/20' : 'bg-white border-slate-200/80 hover:border-purple-200'
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
            activeTab === 'after_print' ? 'bg-purple-50/70 border-purple-300 ring-2 ring-purple-500/20' : 'bg-white border-slate-200/80 hover:border-purple-200'
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
            activeTab === 'after_sewing' ? 'bg-purple-50/70 border-purple-300 ring-2 ring-purple-500/20' : 'bg-white border-slate-200/80 hover:border-purple-200'
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
            <span className={`px-2 py-0.5 rounded-full text-[10px] ${
              activeTab === 'before_print' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
            }`}>
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
            <span className={`px-2 py-0.5 rounded-full text-[10px] ${
              activeTab === 'after_print' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
            }`}>
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
            <span className={`px-2 py-0.5 rounded-full text-[10px] ${
              activeTab === 'after_sewing' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
            }`}>
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
          <span>المرحلة الحالية: <strong>{getStageTitle(activeTab)}</strong></span>
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

                    {/* Stats summary table */}
                    <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100 space-y-1.5 text-xs mt-3">
                      <div className="flex justify-between items-center text-slate-600">
                        <span>العدد المستهدف للقص:</span>
                        <strong className="text-slate-900">{targetPieces.toLocaleString('ar-EG')} ق</strong>
                      </div>
                      <div className="flex justify-between items-center text-slate-600">
                        <span>العدد المقصوص الفعلي:</span>
                        <strong className="text-purple-700 font-extrabold">{cutPieces.toLocaleString('ar-EG')} ق</strong>
                      </div>

                      {activeTab !== 'before_print' && beforePrint !== undefined && (
                        <div className="flex justify-between items-center text-slate-600">
                          <span>العدد قبل الطباعة:</span>
                          <strong className="text-blue-700 font-bold">{beforePrint.toLocaleString('ar-EG')} ق</strong>
                        </div>
                      )}

                      {activeTab === 'after_sewing' && afterPrint !== undefined && (
                        <div className="flex justify-between items-center text-slate-600">
                          <span>العدد بعد الطباعة:</span>
                          <strong className="text-emerald-700 font-bold">{afterPrint.toLocaleString('ar-EG')} ق</strong>
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => handleOpenCountModal(model)}
                    className="w-full py-2.5 px-4 rounded-full bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs transition shadow-md shadow-purple-600/20 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <ClipboardCheck className="w-4 h-4" />
                    <span>تسجيل العد واعتماد النقل</span>
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="col-span-full py-16 text-center bg-white rounded-3xl border border-slate-200/80 p-8 text-slate-400">
            <ClipboardCheck className="w-12 h-12 mx-auto mb-2 text-purple-300" />
            <p className="font-bold text-slate-700 text-base">لا توجد موديلات في مرحلة "{getStageTitle(activeTab)}" حالياً</p>
            <p className="text-xs text-slate-400 mt-1">
              الموديلات تظهر في كل مرحلة تباعاً عند إنهاء المرحلة السابقة.
            </p>
          </div>
        )}
      </div>

      {/* MODAL 1: Record Count & Defects */}
      {countingModel && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-150 my-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-purple-100 text-purple-700 flex items-center justify-center">
                  <ClipboardCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-lg">
                    تسجيل عد الموديل: {countingModel.model_code}
                  </h3>
                  <p className="text-xs text-purple-600 font-bold">
                    المرحلة: {getStageTitle(activeTab)}
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

            <form onSubmit={handleSaveCount} className="space-y-4 pt-4">
              {/* Reference Info Card */}
              <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-200/80 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-500 block">العدد المقصوص من المقصدار:</span>
                  <strong className="text-slate-800 text-sm font-black">
                    {(countingModel.total_cut_pieces || 0).toLocaleString('ar-EG')} قطعة
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 block">العدد المستهدف:</span>
                  <strong className="text-slate-800 text-sm font-black">
                    {(countingModel.target_cut_quantity || 0).toLocaleString('ar-EG')} قطعة
                  </strong>
                </div>
              </div>

              {/* Input for counted sound pieces */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  العدد الفعلي السليم (القطع الصالحة) *
                </label>
                <input
                  type="number"
                  required
                  min={0}
                  value={countedPieces || ''}
                  onChange={(e) => setCountedPieces(Number(e.target.value))}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-base font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                />
              </div>

              {/* Input for defect pieces */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  عدد الهوالك / العيوب (ديفوهات)
                </label>
                <input
                  type="number"
                  min={0}
                  value={defectPieces || ''}
                  onChange={(e) => setDefectPieces(Number(e.target.value))}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-red-600 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                />
              </div>

              {/* Deficit Calculation Preview */}
              {(() => {
                const cutCount = countingModel.total_cut_pieces || 0;
                const deficit = cutCount - countedPieces;
                return (
                  <div className={`p-3 rounded-2xl border text-xs flex items-center justify-between ${
                    deficit > 0 
                      ? 'bg-amber-50 border-amber-200 text-amber-900' 
                      : deficit < 0 
                      ? 'bg-blue-50 border-blue-200 text-blue-900' 
                      : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  }`}>
                    <span className="font-bold">
                      {deficit > 0 ? '⚠️ يوجد عجز عن المقصوص:' : deficit < 0 ? 'زيادة عن المقصوص:' : '✅ العدد مطابق للمقصوص تماماً:'}
                    </span>
                    <strong className="text-sm font-black">
                      {Math.abs(deficit).toLocaleString('ar-EG')} قطعة {deficit > 0 ? 'عجز' : deficit < 0 ? 'زيادة' : ''}
                    </strong>
                  </div>
                );
              })()}

              {/* QC Notes gated by stage-specific notes permission (Task 4) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-purple-600" />
                    <span>
                      ملاحظات {activeTab === 'before_print' ? 'الفرز قبل الطباعة' : activeTab === 'after_print' ? 'الفرز بعد الطباعة' : 'الفرز بعد المكن'} (اختياري)
                    </span>
                  </label>
                  {!canWriteNotesForCurrentStage && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                      <Lock className="w-3 h-3" />
                      يتطلب صلاحية ملاحظات {activeTab === 'before_print' ? 'الفرز قبل الطباعة' : 'الفرز بعد الطباعة'}
                    </span>
                  )}
                </div>
                <textarea
                  rows={3}
                  disabled={!canWriteNotesForCurrentStage}
                  value={qcNotes}
                  onChange={(e) => setQcNotes(e.target.value)}
                  placeholder={
                    canWriteNotesForCurrentStage
                      ? 'أي ملاحظات حول طباعة، قماش، نظافة تشغيل، الخ (اختياري)...'
                      : 'ليس لديك صلاحية كتابة ملاحظات في هذه المرحلة'
                  }
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 disabled:bg-slate-100 disabled:text-slate-400"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setCountingModel(null)}
                  className="px-5 py-2.5 rounded-full border border-slate-200 text-slate-600 font-bold text-xs hover:bg-slate-100 transition cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-full bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs shadow-md shadow-purple-600/20 transition flex items-center gap-2 cursor-pointer"
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>اعتماد العد وتوجيه الموديل للخطوة التالية</span>
                </button>
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
                    كشف تفصيلي يبين (العدد المقصوص، العدد الفعلي، والعجز)
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
            <div className="overflow-y-auto flex-grow p-4 print:p-0" id="qc-printable-report">
              <div className="text-center mb-6 border-b border-slate-300 pb-4">
                <h1 className="text-xl font-black text-slate-900">
                  {globalSettings?.site_name || 'مصنع الملابس الجاهزة - نظام إدارة الإنتاج'}
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
                    <th className="py-2.5 px-3 text-center">العدد الفعلي (المعدود)</th>
                    <th className="py-2.5 px-3 text-center">العجز / الفاقد</th>
                    <th className="py-2.5 px-3">ملاحظات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {currentTabModels.map((model, idx) => {
                    const cut = model.total_cut_pieces || 0;
                    const target = model.target_cut_quantity || 0;
                    
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
                        <td className="py-2 px-3 font-semibold text-slate-400">{idx + 1}</td>
                        <td className="py-2 px-3 font-black text-slate-900">{model.model_code}</td>
                        <td className="py-2 px-3 text-slate-700">{model.model_type || '-'}</td>
                        <td className="py-2 px-3 text-slate-700">{model.cutter_name || '-'}</td>
                        <td className="py-2 px-3 text-center text-slate-600">{target.toLocaleString('ar-EG')}</td>
                        <td className="py-2 px-3 text-center font-bold text-slate-900">{cut.toLocaleString('ar-EG')}</td>
                        <td className="py-2 px-3 text-center font-extrabold text-purple-700">
                          {actual > 0 ? actual.toLocaleString('ar-EG') : 'قيد العد'}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {actual > 0 ? (
                            deficit > 0 ? (
                              <span className="font-black text-red-600">{deficit.toLocaleString('ar-EG')} (عجز)</span>
                            ) : deficit < 0 ? (
                              <span className="font-bold text-blue-600">{Math.abs(deficit).toLocaleString('ar-EG')} (زيادة)</span>
                            ) : (
                              <span className="font-bold text-emerald-600">مطابق (0)</span>
                            )
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="py-2 px-3 text-slate-500 text-[11px]">
                          {model.design_notes || model.notes_shirt || model.notes_pants || '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="mt-8 pt-6 border-t border-slate-300 flex justify-between items-center text-xs text-slate-600 font-bold px-4">
                <div>توقيع مسؤول الفرز والكنترول: .......................................</div>
                <div>توقيع مدير الإنتاج: .......................................</div>
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
