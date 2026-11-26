import React, { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { Scissors, Lock, Search } from 'lucide-react';
import { CompletedModelsToggle, EndedModelBadge } from './CompletedModelsToggle';
import { currentStageLabel, stageBeyond } from '../utils/completedModels';
import { ZoomableImage } from './ZoomableImage';
import { SortBySelect, compareNatural, toTimestamp } from './SortBySelect';
import { DesignModel } from '../types';

interface CuttingViewProps {
  onOpenCuttingDetails: (modelId: string) => void;
}

type CuttingSortKey = 'newest' | 'oldest' | 'code_asc' | 'code_desc' | 'qty_desc' | 'qty_asc';

const CUTTING_SORT_OPTIONS: { value: CuttingSortKey; label: string }[] = [
  { value: 'newest', label: 'الأحدث أولاً' },
  { value: 'oldest', label: 'الأقدم أولاً' },
  { value: 'code_asc', label: 'الكود (تصاعدي)' },
  { value: 'code_desc', label: 'الكود (تنازلي)' },
  { value: 'qty_desc', label: 'الكمية (الأكثر أولاً)' },
  { value: 'qty_asc', label: 'الكمية (الأقل أولاً)' }
];

const DESIGN_STATUSES = ['مرحلة التصميم', 'تصميم'];

export const CuttingView: React.FC<CuttingViewProps> = ({ onOpenCuttingDetails }) => {
  const { models, getModelParts, getPartStages, canViewPreviousModels } = useApp();
  const [showCompleted, setShowCompleted] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<CuttingSortKey>('newest');
  const effectiveShowCompleted = showCompleted && canViewPreviousModels();

  const sortModels = (list: DesignModel[]): DesignModel[] =>
    [...list].sort((a, b) => {
      if (sortBy === 'code_asc') return compareNatural(a.model_code, b.model_code);
      if (sortBy === 'code_desc') return compareNatural(b.model_code, a.model_code);
      if (sortBy === 'qty_desc') return Number(b.target_cut_quantity || 0) - Number(a.target_cut_quantity || 0);
      if (sortBy === 'qty_asc') return Number(a.target_cut_quantity || 0) - Number(b.target_cut_quantity || 0);
      if (sortBy === 'oldest') return toTimestamp(a.created_at) - toTimestamp(b.created_at);
      return toTimestamp(b.created_at) - toTimestamp(a.created_at);
    });

  // تظهر في قسم القص فقط الموديلات التي لديها قطعة واحدة على الأقل ما زالت في القص.
  const cuttingModels = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const list = models.filter(
      (m) =>
        !m.is_deleted &&
        !DESIGN_STATUSES.includes(m.status) &&
        getModelParts(m.id).some(
          (part) => (getPartStages(m.id)[part] || 'cutting') === 'cutting'
        ) &&
        (!q ||
          (m.model_code || '').toLowerCase().includes(q) ||
          (m.model_type || '').toLowerCase().includes(q))
    );
    return sortModels(list);
  }, [models, searchTerm, sortBy]);

  // الموديلات التي تجاوزت *جميع* قطعها مرحلة القص (منتهية من هذا القسم).
  const endedModels = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const list = models.filter(
      (m) =>
        !m.is_deleted &&
        !DESIGN_STATUSES.includes(m.status) &&
        getModelParts(m.id).every((part) =>
          stageBeyond(getPartStages(m.id)[part], 'cutting')
        ) &&
        (!q ||
          (m.model_code || '').toLowerCase().includes(q) ||
          (m.model_type || '').toLowerCase().includes(q))
    );
    return sortModels(list);
  }, [models, searchTerm, sortBy]);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header matching original Django template */}
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-rose-600 tracking-tight flex items-center gap-2">
            <span>✂️ قسم القص</span>
          </h2>
          <p className="text-slate-500 text-sm mt-0.5">
            الموديلات الجاهزة للقص والتي تم صرف قماشها وتخصيصها على بنك القص.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-56">
            <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="بحث بكود الموديل أو النوع..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full ps-9 pe-3 py-2 rounded-full border border-slate-200 bg-white text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
            />
          </div>
          <SortBySelect
            value={sortBy}
            onChange={(v) => setSortBy(v as CuttingSortKey)}
            options={CUTTING_SORT_OPTIONS}
          />
          <CompletedModelsToggle
            enabled={effectiveShowCompleted}
            count={endedModels.length}
            onChange={setShowCompleted}
            tone="rose"
          />
        </div>
      </div>

      {/* Grid of Active Models in Cutting — hidden exclusively when viewing previous models */}
      {!effectiveShowCompleted && (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {cuttingModels.length > 0 ? (
          cuttingModels.map((model) => (
            <div
              key={model.id}
              className="bg-white rounded-3xl border border-slate-200/80 shadow-xs hover:shadow-lg transition-all duration-200 overflow-hidden flex flex-col justify-between group"
            >
              <div className="h-56 w-full overflow-hidden bg-slate-100 relative">
                {model.image ? (
                  <ZoomableImage
                    src={model.image}
                    alt={model.model_code}
                    downloadName={`${model.model_code}.jpg`}
                    className="w-full h-full object-contain bg-slate-50 group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400">
                    بدون صورة
                  </div>
                )}
                <span className="absolute top-3 end-3 px-3 py-1 rounded-full text-xs font-bold bg-rose-600 text-white shadow-xs">
                  على بنك القص
                </span>
              </div>

              <div className="p-5 text-center flex flex-col justify-between flex-grow">
                <div>
                  <h3 className="text-xl font-extrabold text-slate-900 mb-1">
                    موديل: {model.model_code}
                  </h3>
                  <p className="text-xs text-slate-500 font-semibold mb-4">
                    النوع: {model.model_type || 'غير محدد'}
                  </p>
                </div>

                <button
                  onClick={() => onOpenCuttingDetails(model.id)}
                  className="w-full py-2.5 px-4 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition shadow-md shadow-rose-600/20"
                >
                  تسجيل القص
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-full py-16 text-center bg-white rounded-3xl border border-slate-200/80 p-8 text-slate-400">
            <Scissors className="w-12 h-12 mx-auto mb-2 text-rose-300" />
            <p className="font-bold text-slate-700 text-base">لا توجد طلبيات جاهزة للقص حالياً.</p>
            <p className="text-xs text-slate-400 mt-1">
              يتم تحويل الموديلات إلى هذا القسم تلقائياً بمجرد صرف أقمشتها من شاشة تفاصيل الموديل.
            </p>
          </div>
        )}
      </div>
      )}

      {/* Ended models in this section (exclusive view when "الموديلات السابقة" is ON) */}
      {effectiveShowCompleted && (
        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-3">
            <span className="h-px flex-grow bg-slate-200" />
            <h3 className="text-sm font-black text-slate-700 whitespace-nowrap">
              الموديلات السابقة / المنتهية من قسم القص ({endedModels.length})
            </h3>
            <span className="h-px flex-grow bg-slate-200" />
          </div>

          {endedModels.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {endedModels.map((model) => (
                <div
                  key={model.id}
                  className="bg-slate-50/90 rounded-3xl border-2 border-dashed border-slate-300 shadow-xs overflow-hidden flex flex-col justify-between"
                >
                  <div className="h-44 w-full overflow-hidden bg-slate-100 relative">
                    {model.image ? (
                      <ZoomableImage
                        src={model.image}
                        alt={model.model_code}
                        downloadName={`${model.model_code}.jpg`}
                        className="w-full h-full object-contain bg-white grayscale-[55%] opacity-90"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">
                        بدون صورة
                      </div>
                    )}
                    <span className="absolute top-3 end-3 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-700 text-white">
                      {model.status}
                    </span>
                  </div>
                  <div className="p-4 space-y-2 text-center">
                    <EndedModelBadge currentStage={currentStageLabel(model)} />
                    <h3 className="text-lg font-extrabold text-slate-800">
                      موديل: {model.model_code}
                    </h3>
                    <p className="text-xs text-slate-500 font-semibold">
                      النوع: {model.model_type || 'غير محدد'}
                    </p>
                    <div className="pt-1 space-y-1.5">
                      <div className="w-full py-2 px-4 rounded-full bg-slate-200 text-slate-600 border border-slate-300 font-bold text-xs text-center cursor-not-allowed inline-flex items-center justify-center gap-1.5">
                        <Lock className="w-3.5 h-3.5" />
                        <span>تم الانتهاء وخرج بالفعل من هذه المرحلة</span>
                      </div>
                      <button
                        onClick={() => onOpenCuttingDetails(model.id)}
                        className="w-full py-2 px-4 rounded-full border border-slate-400 text-slate-700 hover:bg-slate-700 hover:text-white font-bold text-xs transition cursor-pointer"
                      >
                        عرض التفاصيل
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center bg-white rounded-3xl border border-dashed border-slate-300 text-slate-400 text-sm font-bold">
              لا توجد موديلات منتهية من قسم القص حالياً.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
