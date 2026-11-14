import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Scissors } from 'lucide-react';
import { CompletedModelsToggle, EndedModelBadge } from './CompletedModelsToggle';
import { currentStageLabel } from '../utils/completedModels';

interface CuttingViewProps {
  onOpenCuttingDetails: (modelId: string) => void;
}

const DESIGN_OR_CUTTING_STATUSES = ['مرحلة التصميم', 'تصميم', 'في القص', 'جاري القص'];

export const CuttingView: React.FC<CuttingViewProps> = ({ onOpenCuttingDetails }) => {
  const { models } = useApp();
  const [showCompleted, setShowCompleted] = useState(false);

  const cuttingModels = models.filter((m) => !m.is_deleted && m.status === 'في القص');

  // الموديلات التي تجاوزت قسم القص (منتهية من هذا القسم).
  const endedModels = models.filter(
    (m) => !m.is_deleted && !DESIGN_OR_CUTTING_STATUSES.includes(m.status)
  );

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
        <CompletedModelsToggle
          enabled={showCompleted}
          count={endedModels.length}
          onChange={setShowCompleted}
          tone="rose"
        />
      </div>

      {/* Grid of Models in Cutting */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {cuttingModels.length > 0 ? (
          cuttingModels.map((model) => (
            <div
              key={model.id}
              className="bg-white rounded-3xl border border-slate-200/80 shadow-xs hover:shadow-lg transition-all duration-200 overflow-hidden flex flex-col justify-between group"
            >
              <div className="h-56 w-full overflow-hidden bg-slate-100 relative">
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

      {/* Ended models in this section */}
      {showCompleted && (
        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-3">
            <span className="h-px flex-grow bg-slate-200" />
            <h3 className="text-sm font-black text-slate-700 whitespace-nowrap">
              الموديلات المنتهية في هذا القسم ({endedModels.length})
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
                      <img
                        src={model.image}
                        alt={model.model_code}
                        className="w-full h-full object-contain bg-white grayscale-[55%] opacity-90"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src =
                            'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500&auto=format&fit=crop&q=60';
                        }}
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
                      <div className="w-full py-2 px-4 rounded-full bg-slate-200 text-slate-500 font-bold text-xs text-center cursor-not-allowed">
                        تم تحويله مسبقاً
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
