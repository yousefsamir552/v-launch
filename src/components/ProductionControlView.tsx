import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Printer, Search, Scissors, Activity, Layers, CheckCircle } from 'lucide-react';
import { DispatchAssemblyView } from './DispatchAssemblyView';
import { QCView } from './QCView';
import { SewingView } from './SewingView';

type ProductionControlTab = 'printing' | 'qc' | 'sewing';

interface ProductionControlViewProps {
  initialSubTab?: ProductionControlTab;
}

export const ProductionControlView: React.FC<ProductionControlViewProps> = ({
  initialSubTab = 'printing'
}) => {
  const { models, hasPermission } = useApp();

  const [activeSubTab, setActiveSubTab] = useState<ProductionControlTab>(initialSubTab);

  const canViewPrinting = hasPermission('printing') || hasPermission('reports');
  const canViewQC = hasPermission('qc');
  const canViewSewing = hasPermission('sewing');

  const activeModels = models.filter((m) => !m.is_deleted);
  const printingCount = activeModels.filter(
    (m) => m.status === 'جاهز للمطبعة' || m.status === 'في المطبعة' || m.status === 'مرسل للمطبعة'
  ).length;

  const qcCount = activeModels.filter(
    (m) =>
      m.status === 'فرز وكنترول' ||
      m.status === 'فرز قبل الطباعة' ||
      m.status === 'العد قبل الطباعة' ||
      m.status === 'العد بعد الطباعة' ||
      m.status === 'العد بعد المكن'
  ).length;

  const sewingCount = activeModels.filter((m) => m.status === 'في قسم المكن').length;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Header & Segmented Sub-tabs */}
      <div className="bg-white rounded-3xl p-5 border border-slate-200/90 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-600 text-white rounded-2xl shadow-xs">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black text-slate-900">مراقبة وتشغيل الإنتاج (Production Control)</h1>
                <span className="text-xs font-bold px-2.5 py-0.5 bg-indigo-50 text-indigo-700 rounded-full border border-indigo-200">
                  مطابع • فرز • مكن
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                إدارة مراحل التشغيل المتتابعة: إرسال واستلام المطابع، الفرز ومراقبة الجودة، وخطوط الخياطة.
              </p>
            </div>
          </div>

          {/* Sub-tab Navigation */}
          <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-2xl border border-slate-200/80">
            {canViewPrinting && (
              <button
                type="button"
                onClick={() => setActiveSubTab('printing')}
                className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  activeSubTab === 'printing'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <Printer className="w-3.5 h-3.5 text-indigo-600" />
                <span>المطابع والتطريز</span>
                {printingCount > 0 && (
                  <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 text-[10px] rounded-full font-mono font-bold">
                    {printingCount}
                  </span>
                )}
              </button>
            )}

            {canViewQC && (
              <button
                type="button"
                onClick={() => setActiveSubTab('qc')}
                className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  activeSubTab === 'qc'
                    ? 'bg-white text-purple-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <Search className="w-3.5 h-3.5 text-purple-600" />
                <span>الفرز والكنترول</span>
                {qcCount > 0 && (
                  <span className="px-2 py-0.5 bg-purple-100 text-purple-800 text-[10px] rounded-full font-mono font-bold">
                    {qcCount}
                  </span>
                )}
              </button>
            )}

            {canViewSewing && (
              <button
                type="button"
                onClick={() => setActiveSubTab('sewing')}
                className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  activeSubTab === 'sewing'
                    ? 'bg-white text-emerald-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <Scissors className="w-3.5 h-3.5 text-emerald-600" />
                <span>قسم المكن</span>
                {sewingCount > 0 && (
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] rounded-full font-mono font-bold">
                    {sewingCount}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Render Active Sub-view */}
      <div>
        {activeSubTab === 'printing' && <DispatchAssemblyView />}
        {activeSubTab === 'qc' && <QCView />}
        {activeSubTab === 'sewing' && <SewingView />}
      </div>
    </div>
  );
};
