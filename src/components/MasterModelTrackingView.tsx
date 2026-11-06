import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { 
  GitCommit, 
  Search, 
  Printer, 
  Clock, 
  Scissors, 
  X, 
  User, 
  Shirt,
  Eye,
  FileText,
  Sparkles,
  Scale,
  Truck
} from 'lucide-react';
import { Model, ModelTimelineEvent } from '../types';

export const MasterModelTrackingView: React.FC = () => {
  const {
    models,
    cuttingRecords,
    qcRecords,
    printDispatches,
    sewingDispatches,
    requirements,
    modelAccessories,
    fabrics,
    fabricColors,
    globalSettings
  } = useApp();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');
  const [activeModelForTimeline, setActiveModelForTimeline] = useState<Model | null>(null);
  const [selectedPhaseEvent, setSelectedPhaseEvent] = useState<{
    model: Model;
    event: ModelTimelineEvent;
    index: number;
  } | null>(null);
  const [showMasterPrintModal, setShowMasterPrintModal] = useState(false);

  const activeModels = models.filter((m) => !m.is_deleted);

  const filteredModels = activeModels.filter((model) => {
    const printHouse = model.print_house || model.print_house_name || '';
    const matchesSearch =
      model.model_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (model.model_type && model.model_type.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (model.cutter_name && model.cutter_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      printHouse.toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;

    if (selectedStatusFilter === 'all') return true;
    if (selectedStatusFilter === 'design') {
      return model.status === 'مرحلة التصميم' || model.status === 'تصميم';
    }
    if (selectedStatusFilter === 'cutting') {
      return model.status === 'جاري القص' || model.status === 'في القص';
    }
    if (selectedStatusFilter === 'printing') {
      return model.status === 'جاهز للمطبعة' || model.status === 'في المطبعة' || model.status === 'مرسل للمطبعة';
    }
    if (selectedStatusFilter === 'qc') {
      return (
        model.status === 'فرز وكنترول' ||
        model.status === 'فرز قبل الطباعة' ||
        model.status === 'العد قبل الطباعة' ||
        model.status === 'العد بعد الطباعة' ||
        model.status === 'العد بعد المكن'
      );
    }
    if (selectedStatusFilter === 'sewing') {
      return model.status === 'في قسم المكن';
    }
    if (selectedStatusFilter === 'completed') {
      return model.status === 'مكتمل الإنتاج' || model.status === 'مخزن الإنتاج التام';
    }
    return true;
  });

  const countDesign = activeModels.filter((m) => m.status === 'مرحلة التصميم' || m.status === 'تصميم').length;
  const countCutting = activeModels.filter((m) => m.status === 'جاري القص' || m.status === 'في القص').length;
  const countPrinting = activeModels.filter((m) => m.status === 'جاهز للمطبعة' || m.status === 'في المطبعة' || m.status === 'مرسل للمطبعة').length;
  const countSewing = activeModels.filter((m) => m.status === 'في قسم المكن').length;
  const countCompleted = activeModels.filter((m) => m.status === 'مكتمل الإنتاج' || m.status === 'مخزن الإنتاج التام').length;

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'مرحلة التصميم':
      case 'تصميم':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'في القص':
      case 'جاري القص':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'فرز وكنترول':
      case 'فرز قبل الطباعة':
      case 'العد قبل الطباعة':
      case 'العد بعد الطباعة':
      case 'العد بعد المكن':
        return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'في المطبعة':
      case 'جاهز للمطبعة':
      case 'مرسل للمطبعة':
        return 'bg-indigo-100 text-indigo-800 border-indigo-300';
      case 'في قسم المكن':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'مكتمل الإنتاج':
      case 'مخزن الإنتاج التام':
        return 'bg-teal-100 text-teal-800 border-teal-300';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  // Detect phase category from timeline event stage/title/details
  const resolveEventPhaseCategory = (
    event: ModelTimelineEvent
  ): 'design' | 'cutting' | 'qc' | 'printing' | 'sewing' | 'completed' => {
    const detailsPhase = event.details?.phase ? String(event.details.phase).toLowerCase() : '';
    if (detailsPhase === 'design') return 'design';
    if (detailsPhase === 'cutting') return 'cutting';
    if (detailsPhase.startsWith('qc')) return 'qc';
    if (detailsPhase === 'printing') return 'printing';
    if (detailsPhase === 'sewing') return 'sewing';

    const label = `${event.stage || ''} ${event.title || ''} ${event.description || ''} ${event.notes || ''}`;
    if (label.includes('القص') || label.includes('قص') || label.includes('فرشة')) return 'cutting';
    if (label.includes('فرز') || label.includes('العد') || label.includes('كنترول')) return 'qc';
    if (label.includes('المطبعة') || label.includes('طباعة') || label.includes('تطريز')) return 'printing';
    if (label.includes('المكن') || label.includes('خياطة') || label.includes('ورشة')) return 'sewing';
    if (label.includes('مكتمل') || label.includes('الإنتاج التام')) return 'completed';
    return 'design';
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <GitCommit className="w-8 h-8 text-blue-600" />
            <span>حركة وتفاصيل الموديلات (سجل التتبع الشامل)</span>
          </h2>
          <p className="text-slate-500 text-sm mt-0.5">
            متابعة شاملة لجميع موديلات المصنع وسجل انتقالها عبر الأقسام بالتاريخ والوقت والأعداد — اضغط على أي نقطة في التايم لاين لعرض تفاصيل المرحلة كاملة.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowMasterPrintModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm shadow-md transition-all hover:scale-102 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة كشف جرد الموديلات الشامل</span>
          </button>
        </div>
      </div>

      {/* Top Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
          <p className="text-[11px] font-bold text-slate-500">إجمالي الموديلات</p>
          <h4 className="text-2xl font-black text-slate-900 mt-0.5">{activeModels.length}</h4>
        </div>
        <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
          <p className="text-[11px] font-bold text-amber-700">مرحلة التصميم</p>
          <h4 className="text-2xl font-black text-amber-800 mt-0.5">{countDesign}</h4>
        </div>
        <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
          <p className="text-[11px] font-bold text-blue-700">جاري القص</p>
          <h4 className="text-2xl font-black text-blue-800 mt-0.5">{countCutting}</h4>
        </div>
        <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
          <p className="text-[11px] font-bold text-indigo-700">المطابع والتطريز</p>
          <h4 className="text-2xl font-black text-indigo-800 mt-0.5">{countPrinting}</h4>
        </div>
        <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
          <p className="text-[11px] font-bold text-emerald-700">قسم المكن</p>
          <h4 className="text-2xl font-black text-emerald-800 mt-0.5">{countSewing}</h4>
        </div>
        <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
          <p className="text-[11px] font-bold text-teal-700">مكتمل الإنتاج</p>
          <h4 className="text-2xl font-black text-teal-800 mt-0.5">{countCompleted}</h4>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/80 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Status Pills */}
        <div className="flex flex-wrap items-center gap-1.5 w-full md:w-auto">
          {[
            { id: 'all', label: 'الكل' },
            { id: 'design', label: 'التصميم' },
            { id: 'cutting', label: 'القص' },
            { id: 'printing', label: 'المطابع' },
            { id: 'qc', label: 'الفرز' },
            { id: 'sewing', label: 'المكن' },
            { id: 'completed', label: 'المكتمل' },
          ].map((pill) => (
            <button
              key={pill.id}
              onClick={() => setSelectedStatusFilter(pill.id)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                selectedStatusFilter === pill.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="بحث برقم الموديل، المقصدار، المطبعة..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full ps-9 pe-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
          />
        </div>
      </div>

      {/* Models Table View */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-bold">
              <tr>
                <th className="py-3.5 px-4">الموديل والصورة</th>
                <th className="py-3.5 px-3">النوع</th>
                <th className="py-3.5 px-3">المرحلة الحالية</th>
                <th className="py-3.5 px-3 text-center">المستهدف للقص</th>
                <th className="py-3.5 px-3 text-center">المقصوص فعلياً</th>
                <th className="py-3.5 px-3 text-center">بعد الطباعة</th>
                <th className="py-3.5 px-3 text-center">بعد المكن</th>
                <th className="py-3.5 px-3">المقصدار / المطبعة</th>
                <th className="py-3.5 px-4 text-center">سجل الحركة والتايم لاين</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredModels.length > 0 ? (
                filteredModels.map((model) => {
                  const cutPieces = model.total_cut_pieces || model.actual_cut_count || 0;
                  const printHouse = model.print_house || model.print_house_name || '';

                  return (
                    <tr key={model.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-xl bg-slate-100 overflow-hidden shrink-0 border border-slate-200/80">
                            {model.image ? (
                              <img
                                src={model.image}
                                alt={model.model_code}
                                className="w-full h-full object-contain bg-white"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-slate-400">
                                <Shirt className="w-5 h-5 opacity-40" />
                              </div>
                            )}
                          </div>
                          <div>
                            <span className="font-black text-slate-900 block text-sm">
                              {model.model_code}
                            </span>
                            <span className="text-[10px] text-slate-400 font-medium">
                              {model.created_at ? new Date(model.created_at).toLocaleDateString('ar-EG') : '-'}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-3 font-semibold text-slate-700">
                        {model.model_type || '-'}
                      </td>

                      <td className="py-3 px-3">
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border inline-block ${getStatusBadgeColor(model.status)}`}>
                          {model.status}
                        </span>
                      </td>

                      <td className="py-3 px-3 text-center font-bold text-slate-700">
                        {(model.target_cut_quantity || 0).toLocaleString('ar-EG')}
                      </td>

                      <td className="py-3 px-3 text-center font-extrabold text-blue-700">
                        {cutPieces > 0 ? cutPieces.toLocaleString('ar-EG') : '-'}
                      </td>

                      <td className="py-3 px-3 text-center font-extrabold text-indigo-700">
                        {model.count_after_print ? model.count_after_print.toLocaleString('ar-EG') : '-'}
                      </td>

                      <td className="py-3 px-3 text-center font-extrabold text-emerald-700">
                        {model.count_after_sewing ? model.count_after_sewing.toLocaleString('ar-EG') : '-'}
                      </td>

                      <td className="py-3 px-3 text-slate-600 font-medium">
                        <div>{model.cutter_name ? `✂️ ${model.cutter_name}` : ''}</div>
                        <div>{printHouse ? `🎨 ${printHouse}` : ''}</div>
                        {!model.cutter_name && !printHouse && <span className="text-slate-400">-</span>}
                      </td>

                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => setActiveModelForTimeline(model)}
                          className="px-3.5 py-1.5 rounded-full bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs border border-blue-200/80 transition flex items-center justify-center gap-1.5 mx-auto cursor-pointer"
                        >
                          <Clock className="w-3.5 h-3.5" />
                          <span>سجل الحركة ({model.timeline?.length || 1})</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <Search className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="font-bold text-slate-600 text-sm">لا توجد موديلات مطابقة للبحث أو التصفية</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* TIMELINE DRAWER / MODAL */}
      {activeModelForTimeline && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl border border-slate-100 flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-150">
            {/* Drawer Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center">
                  <GitCommit className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-lg">
                    السجل الزمني لموديل: {activeModelForTimeline.model_code}
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${getStatusBadgeColor(activeModelForTimeline.status)}`}>
                      {activeModelForTimeline.status}
                    </span>
                    <span className="text-xs text-slate-500 font-semibold">
                      النوع: {activeModelForTimeline.model_type || '-'}
                    </span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setActiveModelForTimeline(null)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3.5 bg-slate-50 rounded-2xl border border-slate-100 mt-4 text-xs">
              <div>
                <span className="text-slate-500 block">المستهدف للقص:</span>
                <strong className="text-slate-900 text-sm font-black">
                  {(activeModelForTimeline.target_cut_quantity || 0).toLocaleString('ar-EG')} ق
                </strong>
              </div>
              <div>
                <span className="text-slate-500 block">المقصوص فعلياً:</span>
                <strong className="text-blue-700 text-sm font-black">
                  {(activeModelForTimeline.total_cut_pieces || activeModelForTimeline.actual_cut_count || 0).toLocaleString('ar-EG')} ق
                </strong>
              </div>
              <div>
                <span className="text-slate-500 block">المقصدار:</span>
                <strong className="text-slate-800 text-xs font-bold">
                  {activeModelForTimeline.cutter_name || 'غير محدد'}
                </strong>
              </div>
              <div>
                <span className="text-slate-500 block">المطبعة:</span>
                <strong className="text-slate-800 text-xs font-bold">
                  {activeModelForTimeline.print_house || activeModelForTimeline.print_house_name || 'غير محدد'}
                </strong>
              </div>
            </div>

            {/* Timeline Stream */}
            <div className="overflow-y-auto flex-grow py-4 px-2 space-y-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-bold text-slate-700 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-600" />
                  <span>محطات انتقال الموديل عبر خط الإنتاج (اضغط على أي مرحلة لعرض بياناتها بالكامل):</span>
                </h4>
              </div>

              <div className="relative border-s-2 border-blue-200 ms-4 space-y-6">
                {(activeModelForTimeline.timeline && activeModelForTimeline.timeline.length > 0) ? (
                  activeModelForTimeline.timeline.map((event: ModelTimelineEvent, idx: number) => {
                    const eventText = event.notes || event.description || event.title;
                    const eventUser = event.user || event.user_name;

                    return (
                      <div key={idx} className="relative ps-6 group">
                        {/* Clickable Node Bullet */}
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedPhaseEvent({
                              model: activeModelForTimeline,
                              event,
                              index: idx
                            })
                          }
                          className="absolute -start-[10px] top-1 w-4.5 h-4.5 rounded-full bg-blue-600 group-hover:bg-blue-700 group-hover:scale-125 transition ring-4 ring-white border-2 border-blue-200 cursor-pointer"
                          title="اضغط لعرض بيانات هذه المرحلة بالكامل"
                        />
                        
                        <div
                          onClick={() =>
                            setSelectedPhaseEvent({
                              model: activeModelForTimeline,
                              event,
                              index: idx
                            })
                          }
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedPhaseEvent({
                                model: activeModelForTimeline,
                                event,
                                index: idx
                              });
                            }
                          }}
                          className="bg-white rounded-2xl p-3.5 border border-slate-200/80 shadow-xs hover:border-blue-400 hover:shadow-md hover:bg-blue-50/20 transition-all cursor-pointer"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                            <span className="font-black text-slate-900 text-xs group-hover:text-blue-700 transition">
                              {event.stage || event.title}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-400 font-medium">
                                {new Date(event.timestamp).toLocaleString('ar-EG')}
                              </span>
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-extrabold group-hover:bg-blue-600 group-hover:text-white transition">
                                <Eye className="w-3 h-3" />
                                <span>عرض بيانات المرحلة</span>
                              </span>
                            </div>
                          </div>

                          {eventText && (
                            <p className="text-xs text-slate-600 font-medium mt-1 bg-slate-50 p-2 rounded-xl border border-slate-100">
                              {eventText}
                            </p>
                          )}

                          {eventUser && (
                            <div className="text-[10px] text-slate-500 font-semibold mt-1.5 flex items-center gap-1">
                              <User className="w-3 h-3 text-blue-600" />
                              <span>المسؤول: {eventUser}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="relative ps-6">
                    <div className="absolute -start-[9px] top-1 w-4 h-4 rounded-full bg-blue-600 ring-4 ring-white" />
                    <div
                      onClick={() =>
                        setSelectedPhaseEvent({
                          model: activeModelForTimeline,
                          event: {
                            stage: activeModelForTimeline.status || 'مرحلة التصميم',
                            timestamp: activeModelForTimeline.created_at,
                            notes: activeModelForTimeline.design_notes || 'تم إنشاء الموديل وإدخاله إلى النظام.'
                          },
                          index: 0
                        })
                      }
                      className="bg-white rounded-2xl p-3.5 border border-slate-200/80 hover:border-blue-400 text-xs text-slate-600 font-semibold cursor-pointer flex items-center justify-between"
                    >
                      <span>تم إنشاء الموديل وإدخاله إلى النظام.</span>
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-extrabold">
                        <Eye className="w-3 h-3" />
                        <span>عرض بيانات المرحلة</span>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setActiveModelForTimeline(null)}
                className="px-6 py-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* READ-ONLY PHASE DETAILS MODAL (Task 5) */}
      {selectedPhaseEvent && (() => {
        const { model, event } = selectedPhaseEvent;
        const phaseCategory = resolveEventPhaseCategory(event);
        const snap = (event.details || {}) as Record<string, any>;
        const eventUser = event.user || event.user_name || snap.cutter_name || snap.recorded_by || snap.inspector || 'غير محدد';
        const eventNotes = snap.worker_notes || snap.notes || event.notes || event.description || '';

        const modelCutRecords = cuttingRecords.filter((r) => r.model_id === model.id);
        const modelQcRecords = qcRecords.filter((q) => q.model_id === model.id);
        const modelPrintRecords = printDispatches.filter((d) => d.model_id === model.id);
        const modelSewingRecords = sewingDispatches.filter((d) => d.model_id === model.id);
        const modelReqs = requirements.filter((r) => r.model_id === model.id);
        const modelAccs = modelAccessories.filter((a) => a.model_id === model.id);
        const totalCutWeight = modelCutRecords.reduce(
          (s, r) => s + (r.layer_weight || 0) * (r.layers_count || 0),
          0
        );
        const totalQcDefects = modelQcRecords.reduce(
          (s, q) => s + (q.defect_qty ?? q.defect_pieces ?? 0),
          0
        );

        return (
          <div className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl max-w-3xl w-full p-6 shadow-2xl border border-slate-200 flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-150">
              {/* Modal Header */}
              <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-black text-slate-900 text-base sm:text-lg">
                        بيانات المرحلة (Read-Only): {event.stage || event.title}
                      </h3>
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-slate-100 text-slate-700 border border-slate-300">
                        للقراءة فقط
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      موديل: <strong className="text-slate-800">{model.model_code}</strong> • التوقيت المسجل: {new Date(event.timestamp).toLocaleString('ar-EG')}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setSelectedPhaseEvent(null)}
                  className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-rose-50 hover:text-rose-600 flex items-center justify-center transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="overflow-y-auto flex-grow py-4 space-y-5 text-xs">
                {/* Summary Metadata Banner */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                  <div>
                    <span className="text-slate-400 font-bold block text-[11px]">المرحلة / الحدث</span>
                    <strong className="text-slate-900 font-black text-sm">{event.stage || event.title}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 font-bold block text-[11px]">الموظف / المسؤول المسجل</span>
                    <strong className="text-blue-700 font-black text-sm flex items-center gap-1 mt-0.5">
                      <User className="w-3.5 h-3.5" />
                      <span>{eventUser}</span>
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 font-bold block text-[11px]">تاريخ ووقت التسجيل</span>
                    <strong className="text-slate-800 font-mono font-bold text-xs">
                      {new Date(event.timestamp).toLocaleString('ar-EG')}
                    </strong>
                  </div>
                </div>

                {/* Worker / Employee Notes Box */}
                <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200">
                  <h4 className="font-black text-amber-950 text-xs mb-1.5 flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-amber-600" />
                    <span>البيان والملاحظات المسجلة في هذه المرحلة:</span>
                  </h4>
                  <p className="text-xs text-slate-800 font-semibold whitespace-pre-wrap leading-relaxed">
                    {eventNotes || 'لا توجد ملاحظات إضافية مسجلة لهذه المرحلة.'}
                  </p>
                </div>

                {/* PHASE 1: CUTTING DETAILS */}
                {phaseCategory === 'cutting' && (
                  <div className="space-y-4">
                    <h4 className="font-black text-blue-900 text-sm flex items-center gap-2">
                      <Scissors className="w-4 h-4 text-blue-600" />
                      <span>بيانات مرحلة القص المسجلة (الكمية المقصوصة، الراقات، المقصدار، والملاحظات):</span>
                    </h4>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-3.5 rounded-2xl bg-blue-50 border border-blue-200">
                        <span className="text-[11px] text-blue-700 font-bold block">الكمية المقصوصة</span>
                        <strong className="text-lg font-black text-blue-900">
                          {(snap.cut_pieces ?? snap.pieces_count ?? snap.total_cut_pieces ?? model.total_cut_pieces ?? model.actual_cut_count ?? 0).toLocaleString('ar-EG')} قطعة
                        </strong>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-blue-50 border border-blue-200">
                        <span className="text-[11px] text-blue-700 font-bold block">عدد الراقات</span>
                        <strong className="text-lg font-black text-blue-900">
                          {(snap.layers_count ?? modelCutRecords.reduce((s, r) => s + r.layers_count, 0) ?? 0).toLocaleString('ar-EG')} راق
                        </strong>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                        <span className="text-[11px] text-slate-500 font-bold block">اسم المقصدار (من قام بالقص)</span>
                        <strong className="text-sm font-black text-slate-900">
                          {snap.cutter_name || snap.recorded_by || model.cutter_name || eventUser}
                        </strong>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                        <span className="text-[11px] text-slate-500 font-bold block">وزن الراقة / القماش المقصوص</span>
                        <strong className="text-sm font-black text-slate-900">
                          {snap.layer_weight
                            ? `${snap.layer_weight} كجم`
                            : `${totalCutWeight.toFixed(1)} كجم`}
                        </strong>
                      </div>
                    </div>

                    {/* Specific Cutting Record Snapshot if available */}
                    {(snap.color_code || snap.color_name || snap.fabric_name || snap.worker_notes) && (
                      <div className="p-4 rounded-2xl bg-white border border-blue-200 space-y-2">
                        <div className="font-black text-blue-900 text-xs">تفاصيل الفرشة المسجلة في هذا الحدث:</div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          <div>
                            <span className="text-slate-400">الخامة واللون: </span>
                            <strong className="text-slate-800">{snap.fabric_name || ''} ({snap.color_name || snap.color_code || '-'})</strong>
                          </div>
                          <div>
                            <span className="text-slate-400">القطعة: </span>
                            <strong className="text-slate-800">{snap.part === 'pants' ? 'بنطلون' : 'تيشرت'}</strong>
                          </div>
                          <div>
                            <span className="text-slate-400">درجة اللون: </span>
                            <strong className="text-slate-800">{snap.shade_degree || 'درجة أساسية'}</strong>
                          </div>
                          <div>
                            <span className="text-slate-400">ملاحظات عامل القص: </span>
                            <strong className="text-amber-800">{snap.worker_notes || snap.notes || 'لا توجد'}</strong>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* All Cutting Records Table for the Model */}
                    {modelCutRecords.length > 0 && (
                      <div className="border border-slate-200 rounded-2xl overflow-hidden">
                        <div className="bg-slate-100 px-4 py-2 font-black text-slate-800 text-xs">
                          جدول فرشات وسجلات القص التفصيلية للموديل ({modelCutRecords.length} سجل):
                        </div>
                        <table className="w-full text-right text-xs">
                          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                            <tr>
                              <th className="py-2 px-3">اللون / الدرجة</th>
                              <th className="py-2 px-3 text-center">عدد الراقات</th>
                              <th className="py-2 px-3 text-center">وزن الراقة</th>
                              <th className="py-2 px-3 text-center">الكمية المقصوصة</th>
                              <th className="py-2 px-3">المقصدار</th>
                              <th className="py-2 px-3">ملاحظات العامل</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {modelCutRecords.map((rec) => (
                              <tr key={rec.id} className="hover:bg-slate-50">
                                <td className="py-2 px-3 font-bold">
                                  {rec.color_name || rec.colorName || '-'} {rec.shade_degree ? `(${rec.shade_degree})` : ''}
                                </td>
                                <td className="py-2 px-3 text-center font-bold text-blue-700">{rec.layers_count}</td>
                                <td className="py-2 px-3 text-center">{rec.layer_weight} كجم</td>
                                <td className="py-2 px-3 text-center font-black text-slate-900">
                                  {rec.pieces_count ?? rec.piecesCount ?? 0} ق
                                </td>
                                <td className="py-2 px-3 font-semibold">
                                  {rec.cutter_name || rec.cutterName || model.cutter_name || '-'}
                                </td>
                                <td className="py-2 px-3 text-amber-800 font-medium">{rec.notes || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* PHASE 2: QC DETAILS */}
                {phaseCategory === 'qc' && (
                  <div className="space-y-4">
                    <h4 className="font-black text-purple-900 text-sm flex items-center gap-2">
                      <Scale className="w-4 h-4 text-purple-600" />
                      <span>بيانات الفرز والجودة والعد المسجلة في هذه المرحلة:</span>
                    </h4>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                        <span className="text-[11px] text-slate-500 font-bold block">مرجع المقصوص</span>
                        <strong className="text-lg font-black text-slate-900">
                          {(snap.cut_pieces_ref ?? snap.pieces_cut ?? model.total_cut_pieces ?? model.actual_cut_count ?? 0).toLocaleString('ar-EG')} ق
                        </strong>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200">
                        <span className="text-[11px] text-emerald-700 font-bold block">القطع السليمة المعتمدة</span>
                        <strong className="text-lg font-black text-emerald-800">
                          {(snap.good_qty ?? snap.counted_pieces ?? model.count_after_print ?? model.count_before_print ?? 0).toLocaleString('ar-EG')} ق
                        </strong>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200">
                        <span className="text-[11px] text-rose-700 font-bold block">قطع الديفوه / التالف</span>
                        <strong className="text-lg font-black text-rose-800">
                          {(snap.defect_qty ?? snap.defect_pieces ?? totalQcDefects ?? 0).toLocaleString('ar-EG')} ق
                        </strong>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-purple-50 border border-purple-200">
                        <span className="text-[11px] text-purple-700 font-bold block">مسؤول الفرز والكنترول</span>
                        <strong className="text-sm font-black text-purple-900">
                          {snap.inspector || snap.inspector_name || eventUser}
                        </strong>
                      </div>
                    </div>

                    {modelQcRecords.length > 0 && (
                      <div className="border border-slate-200 rounded-2xl overflow-hidden">
                        <div className="bg-purple-50 px-4 py-2 font-black text-purple-950 text-xs">
                          سجلات الفرز والكنترول للموديل ({modelQcRecords.length} سجل):
                        </div>
                        <table className="w-full text-right text-xs">
                          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                            <tr>
                              <th className="py-2 px-3">التوقيت</th>
                              <th className="py-2 px-3 text-center">مرجع القص</th>
                              <th className="py-2 px-3 text-center">السليم</th>
                              <th className="py-2 px-3 text-center">الديفوه</th>
                              <th className="py-2 px-3">ملاحظات الفرز</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {modelQcRecords.map((q) => (
                              <tr key={q.id} className="hover:bg-slate-50">
                                <td className="py-2 px-3 font-mono text-[11px]">{q.created_at}</td>
                                <td className="py-2 px-3 text-center font-bold">
                                  {q.pieces_cut ?? model.total_cut_pieces ?? model.actual_cut_count ?? 0} ق
                                </td>
                                <td className="py-2 px-3 text-center font-black text-emerald-700">
                                  {q.good_qty ?? q.counted_pieces ?? 0} ق
                                </td>
                                <td className="py-2 px-3 text-center font-bold text-rose-700">
                                  {q.defect_qty ?? q.defect_pieces ?? 0} ق
                                </td>
                                <td className="py-2 px-3 text-slate-700">{q.notes || q.defect_notes || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* PHASE 3: PRINTING DETAILS */}
                {phaseCategory === 'printing' && (
                  <div className="space-y-4">
                    <h4 className="font-black text-indigo-900 text-sm flex items-center gap-2">
                      <Printer className="w-4 h-4 text-indigo-600" />
                      <span>بيانات مرحلة المطابع والتطريز المسجلة:</span>
                    </h4>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-3.5 rounded-2xl bg-indigo-50 border border-indigo-200">
                        <span className="text-[11px] text-indigo-700 font-bold block">اسم المطبعة / الورشة</span>
                        <strong className="text-sm font-black text-indigo-950">
                          {snap.shop_name || model.print_house || model.print_house_name || 'غير محدد'}
                        </strong>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-indigo-50 border border-indigo-200">
                        <span className="text-[11px] text-indigo-700 font-bold block">نوع الطباعة / التشغيل</span>
                        <strong className="text-sm font-black text-indigo-950">
                          {snap.print_type || modelPrintRecords[0]?.print_type || 'طباعة وتطريز'}
                        </strong>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                        <span className="text-[11px] text-slate-500 font-bold block">الكمية المرسلة</span>
                        <strong className="text-base font-black text-slate-900">
                          {(snap.pieces_count ?? modelPrintRecords[0]?.pieces_count ?? model.count_before_print ?? 0).toLocaleString('ar-EG')} قطعة
                        </strong>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                        <span className="text-[11px] text-slate-500 font-bold block">موعد الاستلام المتوقع</span>
                        <strong className="text-xs font-mono font-black text-slate-900">
                          {snap.expected_delivery_date || modelPrintRecords[0]?.expected_delivery_date || '-'}
                        </strong>
                      </div>
                    </div>

                    {modelPrintRecords.length > 0 && (
                      <div className="border border-slate-200 rounded-2xl overflow-hidden">
                        <div className="bg-indigo-50 px-4 py-2 font-black text-indigo-950 text-xs">
                          سجل إرساليات المطابع لهذا الموديل:
                        </div>
                        <table className="w-full text-right text-xs">
                          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                            <tr>
                              <th className="py-2 px-3">المطبعة</th>
                              <th className="py-2 px-3">نوع التشغيل</th>
                              <th className="py-2 px-3 text-center">العدد</th>
                              <th className="py-2 px-3 text-center">الحالة</th>
                              <th className="py-2 px-3">الملاحظات</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {modelPrintRecords.map((pr) => (
                              <tr key={pr.id} className="hover:bg-slate-50">
                                <td className="py-2 px-3 font-bold">{pr.shop_name}</td>
                                <td className="py-2 px-3">{pr.print_type}</td>
                                <td className="py-2 px-3 text-center font-black">{pr.pieces_count} ق</td>
                                <td className="py-2 px-3 text-center font-bold text-indigo-700">{pr.status}</td>
                                <td className="py-2 px-3 text-slate-600">{pr.notes || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* PHASE 4: SEWING DETAILS */}
                {phaseCategory === 'sewing' && (
                  <div className="space-y-4">
                    <h4 className="font-black text-emerald-900 text-sm flex items-center gap-2">
                      <Truck className="w-4 h-4 text-emerald-600" />
                      <span>بيانات مرحلة المكن وخطوط الخياطة المسجلة:</span>
                    </h4>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200">
                        <span className="text-[11px] text-emerald-700 font-bold block">اسم ورشة المكن</span>
                        <strong className="text-sm font-black text-emerald-950">
                          {snap.workshop_name || model.sewing_workshop || model.sewing_shirt_workshop || model.sewing_pants_workshop || 'ورشة الخياطة'}
                        </strong>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200">
                        <span className="text-[11px] text-emerald-700 font-bold block">القطعة المستهدفة</span>
                        <strong className="text-sm font-black text-emerald-950">
                          {snap.piece_label || (snap.piece_type === 'pants' ? 'بنطلون' : snap.piece_type === 'shirt' ? 'تيشرت' : 'تيشرت وبنطلون')}
                        </strong>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                        <span className="text-[11px] text-slate-500 font-bold block">الكمية بالورشة</span>
                        <strong className="text-base font-black text-slate-900">
                          {(snap.pieces_count ?? model.count_after_print ?? model.total_cut_pieces ?? 0).toLocaleString('ar-EG')} قطعة
                        </strong>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                        <span className="text-[11px] text-slate-500 font-bold block">موعد الاستلام المتوقع</span>
                        <strong className="text-xs font-mono font-black text-slate-900">
                          {snap.expected_delivery_date || model.sewing_expected_date || '-'}
                        </strong>
                      </div>
                    </div>

                    {modelSewingRecords.length > 0 && (
                      <div className="border border-slate-200 rounded-2xl overflow-hidden">
                        <div className="bg-emerald-50 px-4 py-2 font-black text-emerald-950 text-xs">
                          تشغيلات ورش المكن المسجلة للموديل:
                        </div>
                        <table className="w-full text-right text-xs">
                          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                            <tr>
                              <th className="py-2 px-3">القطعة</th>
                              <th className="py-2 px-3">اسم الورشة</th>
                              <th className="py-2 px-3 text-center">العدد</th>
                              <th className="py-2 px-3 text-center">الاستلام المتوقع</th>
                              <th className="py-2 px-3 text-center">الحالة</th>
                              <th className="py-2 px-3">ملاحظات المكن</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {modelSewingRecords.map((sd) => (
                              <tr key={sd.id} className="hover:bg-slate-50">
                                <td className="py-2 px-3 font-bold">{sd.piece_label || (sd.piece_type === 'pants' ? 'بنطلون' : 'تيشرت')}</td>
                                <td className="py-2 px-3 font-bold text-slate-900">{sd.workshop_name}</td>
                                <td className="py-2 px-3 text-center font-black">{sd.pieces_count} ق</td>
                                <td className="py-2 px-3 text-center font-mono">{sd.expected_delivery_date || '-'}</td>
                                <td className="py-2 px-3 text-center font-bold text-emerald-700">{sd.status}</td>
                                <td className="py-2 px-3 text-slate-600">{sd.notes || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* PHASE 5: DESIGN / COMPLETED / GENERAL DETAILS */}
                {(phaseCategory === 'design' || phaseCategory === 'completed') && (
                  <div className="space-y-4">
                    <h4 className="font-black text-amber-900 text-sm flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-600" />
                      <span>بطاقة مواصفات الموديل وبيانات المرحلة:</span>
                    </h4>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200">
                        <span className="text-[11px] text-amber-800 font-bold block">المستهدف للقص</span>
                        <strong className="text-base font-black text-amber-950">
                          {(snap.target_cut_quantity ?? model.target_cut_quantity ?? 0).toLocaleString('ar-EG')} قطعة
                        </strong>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                        <span className="text-[11px] text-slate-500 font-bold block">نوع الموديل</span>
                        <strong className="text-sm font-black text-slate-900">
                          {snap.model_type || model.model_type || '-'}
                        </strong>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                        <span className="text-[11px] text-slate-500 font-bold block">ماركر القص / الطباعة</span>
                        <strong className="text-xs font-black text-slate-900">
                          {model.main_marker_url ? 'ماركر أساسي مرفق' : 'بدون ماركر'}
                        </strong>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                        <span className="text-[11px] text-slate-500 font-bold block">إجمالي الإكسسوارات المربوطة</span>
                        <strong className="text-sm font-black text-slate-900">
                          {modelAccs.length} صنف
                        </strong>
                      </div>
                    </div>

                    {(model.design_notes || model.notes_shirt || model.notes_pants) && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {model.design_notes && (
                          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                            <span className="text-[10px] font-bold text-slate-500 block">ملاحظات قسم التصميم:</span>
                            <p className="text-xs font-semibold text-slate-800 mt-0.5">{model.design_notes}</p>
                          </div>
                        )}
                        {model.notes_shirt && (
                          <div className="p-3 rounded-2xl bg-blue-50/60 border border-blue-200">
                            <span className="text-[10px] font-bold text-blue-700 block">تعليمات التيشرت:</span>
                            <p className="text-xs font-semibold text-slate-800 mt-0.5">{model.notes_shirt}</p>
                          </div>
                        )}
                        {model.notes_pants && (
                          <div className="p-3 rounded-2xl bg-emerald-50/60 border border-emerald-200">
                            <span className="text-[10px] font-bold text-emerald-700 block">تعليمات البنطلون:</span>
                            <p className="text-xs font-semibold text-slate-800 mt-0.5">{model.notes_pants}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {modelReqs.length > 0 && (
                      <div className="border border-slate-200 rounded-2xl overflow-hidden">
                        <div className="bg-slate-100 px-4 py-2 font-black text-slate-800 text-xs">
                          الأقمشة والألوان المحجوزة للموديل ({modelReqs.length}):
                        </div>
                        <div className="p-3 flex flex-wrap gap-2">
                          {modelReqs.map((req) => {
                            const col = fabricColors.find((c) => c.id === req.color_id);
                            const fab = fabrics.find((f) => f.id === col?.fabric_id);
                            return (
                              <span
                                key={req.id}
                                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-800"
                              >
                                <span
                                  className="w-3 h-3 rounded-full border border-slate-300"
                                  style={{ backgroundColor: col?.hex_code || '#3b82f6' }}
                                />
                                <span>
                                  {fab?.name || 'قماش'} - {col?.color_code || ''} ({req.planned_quantity} {fab?.unit || 'كيلو'})
                                </span>
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
                <span className="text-[11px] text-slate-400 font-semibold">
                  نافذة معاينة بيانات المرحلة التاريخية (Read-Only)
                </span>
                <button
                  onClick={() => setSelectedPhaseEvent(null)}
                  className="px-6 py-2 rounded-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition cursor-pointer"
                >
                  إغلاق النافذة
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MASTER PRINT INVENTORY MODAL */}
      {showMasterPrintModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-5xl w-full p-6 shadow-2xl border border-slate-100 flex flex-col max-h-[92vh]">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center">
                  <Printer className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-lg">
                    كشف جرد الموديلات الشامل
                  </h3>
                  <p className="text-xs text-slate-500">
                    كشف تفصيلي بجميع الموديلات ومواقعها الحالية في خط الإنتاج
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition flex items-center gap-2 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>طباعة فورية</span>
                </button>
                <button
                  onClick={() => setShowMasterPrintModal(false)}
                  className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Printable Content */}
            <div className="overflow-y-auto flex-grow p-4 print:p-0">
              <div className="text-center mb-6 border-b border-slate-300 pb-4">
                <h1 className="text-xl font-black text-slate-900">{globalSettings.site_name}</h1>
                <h2 className="text-base font-bold text-blue-800 mt-1">كشف جرد وتتبع حركة الموديلات الشامل</h2>
                <div className="text-xs text-slate-500 mt-1 flex justify-center gap-6">
                  <span>تاريخ التقرير: {new Date().toLocaleDateString('ar-EG')}</span>
                  <span>إجمالي الموديلات: {filteredModels.length}</span>
                </div>
              </div>

              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-y border-slate-300 text-slate-700 font-bold">
                    <th className="py-2.5 px-3">#</th>
                    <th className="py-2.5 px-3">كود الموديل</th>
                    <th className="py-2.5 px-3">النوع</th>
                    <th className="py-2.5 px-3">الموقع / الحالة الحالية</th>
                    <th className="py-2.5 px-3 text-center">المستهدف للقص</th>
                    <th className="py-2.5 px-3 text-center">المقصوص فعلياً</th>
                    <th className="py-2.5 px-3 text-center">بعد الطباعة</th>
                    <th className="py-2.5 px-3 text-center">بعد المكن</th>
                    <th className="py-2.5 px-3">المسؤول / الجهة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredModels.map((m, idx) => {
                    const cutCount = m.total_cut_pieces || m.actual_cut_count || 0;
                    const printHouse = m.print_house || m.print_house_name || '';

                    return (
                      <tr key={m.id}>
                        <td className="py-2 px-3 font-semibold text-slate-400">{idx + 1}</td>
                        <td className="py-2 px-3 font-black text-slate-900">{m.model_code}</td>
                        <td className="py-2 px-3 text-slate-700">{m.model_type || '-'}</td>
                        <td className="py-2 px-3 font-bold text-blue-800">{m.status}</td>
                        <td className="py-2 px-3 text-center text-slate-600">{(m.target_cut_quantity || 0).toLocaleString('ar-EG')}</td>
                        <td className="py-2 px-3 text-center font-bold text-slate-900">{cutCount.toLocaleString('ar-EG')}</td>
                        <td className="py-2 px-3 text-center text-slate-700">{m.count_after_print ? m.count_after_print.toLocaleString('ar-EG') : '-'}</td>
                        <td className="py-2 px-3 text-center text-slate-700">{m.count_after_sewing ? m.count_after_sewing.toLocaleString('ar-EG') : '-'}</td>
                        <td className="py-2 px-3 text-slate-600 text-[11px]">
                          {m.cutter_name ? `مقصدار: ${m.cutter_name} ` : ''}
                          {printHouse ? `مطبعة: ${printHouse}` : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="mt-8 pt-6 border-t border-slate-300 flex justify-between items-center text-xs text-slate-600 font-bold px-4">
                <div>مسؤول المتابعة والمراقبة: .......................................</div>
                <div>مدير العمليات والتشغيل: .......................................</div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setShowMasterPrintModal(false)}
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
