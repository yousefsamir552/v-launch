import React, { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  GarmentPart,
  PartStage,
  PART_EMOJI,
  PART_STAGE_LABELS,
  SNOOZE_OPTIONS,
  getPartLabel
} from '../types';
import {
  Layers,
  Palette,
  Users,
  Scissors,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  TrendingUp,
  Package,
  PlusCircle,
  FileSpreadsheet,
  Search,
  Printer,
  Activity,
  Sparkles,
  Shirt,
  PackageCheck,
  GitCommit,
  AlertCircle,
  Bell,
  Truck
} from 'lucide-react';

interface DashboardViewProps {
  onNavigate: (tab: string, modelId?: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate }) => {
  const {
    models,
    fabricColors,
    onlineUsers,
    cuttingRecords,
    qcRecords,
    printDispatches,
    appNotifications,
    snoozeNotification,
    getPartStages,
    exportWarehouseInventoryCsv,
    hasPermission
  } = useApp();

  const activeModels = models.filter((m) => !m.is_deleted);
  const totalModels = activeModels.length;
  const totalFabrics = fabricColors.length;

  const inDesignCount = activeModels.filter((m) => m.status === 'تصميم' || m.status === 'مرحلة التصميم').length;

  /**
   * إحصائيات المراحل مبنية على **المرحلة الحالية لكل قطعة** لا على الحالة الكلية للموديل.
   * الموديل ذو الثلاث قطع يُحتسب ثلاث مرات (مرة لكل قطعة) في المرحلة التي تمر بها فعلياً.
   */
  const stageStats = useMemo(() => {
    const counts: Record<PartStage, number> = {
      cutting: 0,
      qc_before_print: 0,
      printing: 0,
      qc_after_print: 0,
      sewing: 0,
      qc_after_sewing: 0,
      finishing: 0,
      ironing: 0,
      packaging: 0,
      dest: 0,
      completed: 0
    };
    let totalPartItems = 0;
    activeModels.forEach((model) => {
      Object.values(getPartStages(model.id)).forEach((stage) => {
        const key = (stage || 'cutting') as PartStage;
        counts[key] = (counts[key] || 0) + 1;
        totalPartItems += 1;
      });
    });
    return { counts, totalPartItems };
  }, [activeModels, getPartStages]);

  /** عدد الأطقم المكتملة للموديل = أقل عدد قطع بين كل القطع (min). */
  const modelSets = (model: (typeof activeModels)[number]): number => {
    const summary = model.cut_summary || {};
    const values = Object.values(summary)
      .map((value) => Number(value) || 0)
      .filter((value) => Number.isFinite(value));
    if (values.length) return Math.min(...values);
    return Number(model.completed_sets || 0);
  };
  const totalSets = activeModels.reduce((sum, model) => sum + modelSets(model), 0);

  const inCuttingCount = stageStats.counts.cutting;
  const inPrintingCount = stageStats.counts.printing;
  const inQcCount =
    stageStats.counts.qc_before_print +
    stageStats.counts.qc_after_print +
    stageStats.counts.qc_after_sewing;
  const inSewingCount = stageStats.counts.sewing;
  const inAssemblyCount =
    stageStats.counts.finishing +
    stageStats.counts.ironing +
    stageStats.counts.packaging +
    stageStats.counts.dest;
  const finishedCount = stageStats.counts.completed;

  const totalCutPieces = cuttingRecords.reduce((sum, c) => sum + c.pieces_count, 0);
  const totalQcGoodPieces = qcRecords.reduce((sum, q) => sum + q.good_qty, 0);
  const totalDispatchedPieces = printDispatches.reduce((sum, d) => sum + d.pieces_count, 0);

  const totalPartItems = stageStats.totalPartItems;
  const designPct = totalModels > 0 ? (inDesignCount / totalModels) * 100 : 0;
  const cuttingPct = totalPartItems > 0 ? (inCuttingCount / totalPartItems) * 100 : 0;
  const printingPct = totalPartItems > 0 ? (inPrintingCount / totalPartItems) * 100 : 0;
  const qcPct = totalPartItems > 0 ? (inQcCount / totalPartItems) * 100 : 0;
  const sewingPct = totalPartItems > 0 ? (inSewingCount / totalPartItems) * 100 : 0;
  const finishedPct = totalPartItems > 0 ? (finishedCount / totalPartItems) * 100 : 0;

  const recentModels = [...activeModels]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 6);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'تصميم':
      case 'مرحلة التصميم':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'في القص':
      case 'جاري القص':
        return 'bg-rose-100 text-rose-800 border-rose-300';
      case 'جاهز للمطبعة':
      case 'في المطبعة':
      case 'جاهز للطباعة / التجميع':
        return 'bg-indigo-100 text-indigo-800 border-indigo-300';
      case 'فرز وكنترول':
      case 'فرز قبل الطباعة':
      case 'العد بعد الطباعة':
      case 'العد بعد المكن':
        return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'في قسم المكن':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'مكتمل الإنتاج':
        return 'bg-teal-100 text-teal-800 border-teal-300';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Top Welcome & Quick Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white p-6 sm:p-8 rounded-3xl shadow-md">
        <div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-blue-200 backdrop-blur-xs mb-3">
            <TrendingUp className="w-3.5 h-3.5" />
              (ERP v4.0)
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Wellcome
          </h1>
          <p className="text-slate-300 text-sm mt-1 max-w-xl">
            متابعة فورية متكاملة للمخازن، التصميم، القص، المطابع، الفرز، المكن، وحركة الموديلات الشاملة.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {hasPermission('design', true) && (
            <button
              onClick={() => onNavigate('design')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white text-slate-900 font-bold text-xs hover:bg-slate-100 transition shadow-xs"
            >
              <PlusCircle className="w-4 h-4 text-blue-600" />
              <span>موديل جديد</span>
            </button>
          )}

          {hasPermission('fabric_warehouse', true) && (
            <button
              onClick={() => onNavigate('warehouse')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-blue-600 text-white font-bold text-xs hover:bg-blue-700 transition shadow-xs"
            >
              <Package className="w-4 h-4" />
              <span>قسم المخازن</span>
            </button>
          )}

          <button
            onClick={() => onNavigate('models_tracking')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-slate-800 border border-slate-700 text-white font-bold text-xs hover:bg-slate-700 transition shadow-xs"
          >
            <GitCommit className="w-4 h-4 text-cyan-400" />
            <span>حركة وتتبع الموديلات</span>
          </button>
        </div>
      </div>

      {/* Smart In-App Delivery Notifications Banner */}
      {appNotifications.length > 0 && (
        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 shadow-xs overflow-hidden">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-rose-100 text-rose-700 rounded-xl">
                <Bell className="w-5 h-5 animate-bounce" />
              </div>
              <div>
                <h3 className="font-extrabold text-sm text-slate-900">
                  تنبيهات مواعيد الاستلام الذكية (المطابع وورش المكن والأسمبلي والأمبالاج)
                </h3>
                <p className="text-[11px] text-slate-500">
                  متابعة المواعيد المستهدفة للمطابع وورش المكن والتشطيب والمكواة والتعبئة والتغليف،
                  التنبيه المسبق قبل الموعد بيوم، وتنبيهات المتأخرات حتى تسجيل الاستلام الفعلي
                </p>
              </div>
            </div>
            <button
              onClick={() => onNavigate('production_control')}
              className="text-xs font-bold text-indigo-700 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
            >
              <span>فتح سجل التشغيلات &larr;</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {appNotifications.map((notif) => {
              const isOverdue = notif.urgency === 'overdue';
              const isToday = notif.urgency === 'today';

              return (
                <div
                  key={notif.id}
                  onClick={() => {
                    const assemblyStages = ['finishing', 'ironing', 'packaging', 'dest'];
                    onNavigate(
                      assemblyStages.includes(notif.stage) ? 'assembly_packaging' : 'production_control'
                    );
                  }}
                  className={`p-3.5 rounded-2xl border transition cursor-pointer flex flex-col justify-between gap-2 ${
                    isOverdue
                      ? 'bg-rose-50/70 border-rose-300 text-rose-950 hover:bg-rose-100/70'
                      : isToday
                      ? 'bg-amber-50/70 border-amber-300 text-amber-950 hover:bg-amber-100/70'
                      : 'bg-blue-50/50 border-blue-200 text-blue-950 hover:bg-blue-100/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-black text-[10px] ${
                        isOverdue
                          ? 'bg-rose-600 text-white animate-pulse'
                          : isToday
                          ? 'bg-amber-500 text-slate-900'
                          : 'bg-blue-600 text-white'
                      }`}
                    >
                      {isOverdue && <AlertCircle className="w-3 h-3" />}
                      {isToday && <Clock className="w-3 h-3" />}
                      <span>{notif.title}</span>
                    </span>
                    <span className="font-mono text-xs font-black text-slate-900">
                      موديل {notif.model_code}
                    </span>
                  </div>

                  <p className="text-xs font-bold text-slate-800 leading-snug">
                    {notif.message}
                  </p>

                  <div className="pt-2 border-t border-black/5 flex items-center justify-between text-[11px] text-slate-500 font-medium">
                    <span>{notif.source_name}</span>
                    <span className="font-mono font-bold text-slate-700">تاريخ: {notif.expected_date}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1 pt-1">
                    <span className="text-[9px] font-black text-slate-500">تأجيل مؤقت:</span>
                    {SNOOZE_OPTIONS.map((opt) => (
                      <button
                        key={opt.hours}
                        type="button"
                        title={`إخفاء التنبيه لمدة ${opt.label}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          snoozeNotification(notif.id, opt.hours);
                        }}
                        className="px-1.5 py-0.5 rounded-md bg-white/90 border border-slate-200 text-[9px] font-bold text-slate-700 hover:bg-slate-900 hover:text-white transition cursor-pointer"
                      >
                        ⏰ {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Primary 3 Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:items-start">
        <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs hover:shadow-md transition text-center group">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-800 flex items-center justify-center mx-auto mb-3 group-hover:scale-105 transition-transform">
            <Layers className="w-6 h-6" />
          </div>
          <h3 className="text-slate-500 text-sm font-semibold mb-1">إجمالي الموديلات</h3>
          <p className="text-4xl font-extrabold text-slate-900 tracking-tight">{totalModels}</p>
          <span className="text-xs text-slate-400 mt-2 block">موديل مسجل بالنظام</span>
        </div>

        <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs hover:shadow-md transition text-center group">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-3 group-hover:scale-105 transition-transform">
            <Palette className="w-6 h-6" />
          </div>
          <h3 className="text-slate-500 text-sm font-semibold mb-1">ألوان الخامات</h3>
          <p className="text-4xl font-extrabold text-blue-600 tracking-tight">{totalFabrics}</p>
          <span className="text-xs text-slate-400 mt-2 block">ألوان متوفرة في المخزن</span>
        </div>

        <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs hover:shadow-md transition text-center group">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3 group-hover:scale-105 transition-transform">
            <Users className="w-6 h-6" />
          </div>
          <h3 className="text-slate-500 text-sm font-semibold mb-1">المتصلون الآن بالموقع</h3>
          <p className="text-4xl font-extrabold text-emerald-600 tracking-tight">{onlineUsers.length}</p>
          <span className="text-xs text-slate-400 mt-2 block">حسابات فاتحة للموقع خلال آخر ٥ دقائق</span>

          <div className="mt-4 pt-4 border-t border-slate-100 text-right space-y-2 max-h-44 overflow-y-auto">
            {onlineUsers.length > 0 ? (
              onlineUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center gap-2 rounded-xl bg-emerald-50/60 border border-emerald-100 px-2.5 py-1.5"
                >
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                  </span>
                  <div className="min-w-0 flex-1 text-right">
                    <p className="text-xs font-bold text-slate-800 truncate">
                      {u.real_name || u.username}
                    </p>
                    <p className="text-[10px] text-slate-500 truncate">{u.role || 'موظف تشغيل'}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-400 text-center py-1">لا يوجد متصلون حالياً</p>
            )}
          </div>
        </div>
      </div>

      {/* Visual Factory Production Line Progress Bar */}
      <div className="bg-white rounded-3xl p-6 sm:p-7 border border-slate-200/80 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-200/60 flex items-center justify-center text-indigo-600">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">مؤشر تدفق خط الإنتاج الحي للمصنع</h3>
              <p className="text-xs text-slate-500">توزيع الموديلات الحية على دورة التصنيع ونسب الإنجاز اللحظية</p>
            </div>
          </div>

          {/* Quick Throughput Chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
              <Scissors className="w-3.5 h-3.5" />
              <span>مقصوص:</span>
              <span className="font-mono">{totalCutPieces.toLocaleString('ar-EG')}</span>
              <span>ق</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-50 border border-purple-200 text-purple-800 text-xs font-bold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>جودة:</span>
              <span className="font-mono">{totalQcGoodPieces.toLocaleString('ar-EG')}</span>
              <span>ق</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs font-bold">
              <Printer className="w-3.5 h-3.5" />
              <span>مطابع:</span>
              <span className="font-mono">{totalDispatchedPieces.toLocaleString('ar-EG')}</span>
              <span>ق</span>
            </span>
          </div>
        </div>

        {/* Visual Segmented Progress Bar */}
        <div className="space-y-2">
          <div className="w-full h-5 bg-slate-100 rounded-full overflow-hidden p-0.5 flex border border-slate-200 shadow-inner">
            {inDesignCount > 0 && (
              <div
                style={{ width: `${Math.max(designPct, 8)}%` }}
                title={`مرحلة التصميم: ${inDesignCount} موديل`}
                className="bg-amber-400 hover:bg-amber-500 transition-all rounded-l-full flex items-center justify-center text-[10px] font-black text-amber-950 px-1 truncate cursor-pointer"
                onClick={() => onNavigate('design')}
              >
                تصميم ({inDesignCount})
              </div>
            )}
            {inCuttingCount > 0 && (
              <div
                style={{ width: `${Math.max(cuttingPct, 8)}%` }}
                title={`القص: ${inCuttingCount} موديل`}
                className="bg-rose-500 hover:bg-rose-600 transition-all flex items-center justify-center text-[10px] font-black text-white px-1 truncate cursor-pointer"
                onClick={() => onNavigate('cutting')}
              >
                قص ({inCuttingCount})
              </div>
            )}
            {inPrintingCount > 0 && (
              <div
                style={{ width: `${Math.max(printingPct, 8)}%` }}
                title={`المطابع والتطريز: ${inPrintingCount} موديل`}
                className="bg-indigo-500 hover:bg-indigo-600 transition-all flex items-center justify-center text-[10px] font-black text-white px-1 truncate cursor-pointer"
                onClick={() => onNavigate('printing')}
              >
                مطابع ({inPrintingCount})
              </div>
            )}
            {inQcCount > 0 && (
              <div
                style={{ width: `${Math.max(qcPct, 8)}%` }}
                title={`الفرز والكنترول: ${inQcCount} موديل`}
                className="bg-purple-500 hover:bg-purple-600 transition-all flex items-center justify-center text-[10px] font-black text-white px-1 truncate cursor-pointer"
                onClick={() => onNavigate('qc')}
              >
                فرز ({inQcCount})
              </div>
            )}
            {inSewingCount > 0 && (
              <div
                style={{ width: `${Math.max(sewingPct, 8)}%` }}
                title={`قسم المكن: ${inSewingCount} موديل`}
                className="bg-emerald-500 hover:bg-emerald-600 transition-all flex items-center justify-center text-[10px] font-black text-white px-1 truncate cursor-pointer"
                onClick={() => onNavigate('sewing')}
              >
                مكن ({inSewingCount})
              </div>
            )}
            {finishedCount > 0 && (
              <div
                style={{ width: `${Math.max(finishedPct, 8)}%` }}
                title={`مكتمل الإنتاج: ${finishedCount} موديل`}
                className="bg-teal-500 hover:bg-teal-600 transition-all rounded-r-full flex items-center justify-center text-[10px] font-black text-white px-1 truncate cursor-pointer"
                onClick={() => onNavigate('production_warehouse')}
              >
                إنتاج ({finishedCount})
              </div>
            )}
            {totalModels === 0 && (
              <div className="w-full text-center text-[10px] text-slate-400 font-bold self-center">
                لا توجد موديلات نشطة بخط الإنتاج حالياً
              </div>
            )}
          </div>

          {/* Quick interactive Stage Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-3">
            <div
              onClick={() => onNavigate('design')}
              className="cursor-pointer bg-amber-50/70 hover:bg-amber-100/70 transition p-3.5 rounded-2xl border border-amber-200 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between text-amber-800">
                <span className="text-[11px] font-bold">1. التصميم</span>
                <Palette className="w-3.5 h-3.5" />
              </div>
              <div className="mt-2">
                <span className="text-2xl font-black text-amber-900">{inDesignCount}</span>
                <span className="text-[10px] text-amber-700 block">موديل</span>
              </div>
            </div>

            <div
              onClick={() => onNavigate('cutting')}
              className="cursor-pointer bg-rose-50/70 hover:bg-rose-100/70 transition p-3.5 rounded-2xl border border-rose-200 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between text-rose-800">
                <span className="text-[11px] font-bold">2. القص</span>
                <Scissors className="w-3.5 h-3.5" />
              </div>
              <div className="mt-2">
                <span className="text-2xl font-black text-rose-900">{inCuttingCount}</span>
                <span className="text-[10px] text-rose-700 block">قطعة</span>
              </div>
            </div>

            <div
              onClick={() => onNavigate('printing')}
              className="cursor-pointer bg-indigo-50/70 hover:bg-indigo-100/70 transition p-3.5 rounded-2xl border border-indigo-200 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between text-indigo-800">
                <span className="text-[11px] font-bold">3. المطابع</span>
                <Printer className="w-3.5 h-3.5" />
              </div>
              <div className="mt-2">
                <span className="text-2xl font-black text-indigo-900">{inPrintingCount}</span>
                <span className="text-[10px] text-indigo-700 block">قطعة</span>
              </div>
            </div>

            <div
              onClick={() => onNavigate('qc')}
              className="cursor-pointer bg-purple-50/70 hover:bg-purple-100/70 transition p-3.5 rounded-2xl border border-purple-200 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between text-purple-800">
                <span className="text-[11px] font-bold">4. الفرز</span>
                <Search className="w-3.5 h-3.5" />
              </div>
              <div className="mt-2">
                <span className="text-2xl font-black text-purple-900">{inQcCount}</span>
                <span className="text-[10px] text-purple-700 block">قطعة</span>
              </div>
            </div>

            <div
              onClick={() => onNavigate('sewing')}
              className="cursor-pointer bg-emerald-50/70 hover:bg-emerald-100/70 transition p-3.5 rounded-2xl border border-emerald-200 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between text-emerald-800">
                <span className="text-[11px] font-bold">5. المكن</span>
                <Shirt className="w-3.5 h-3.5" />
              </div>
              <div className="mt-2">
                <span className="text-2xl font-black text-emerald-900">{inSewingCount}</span>
                <span className="text-[10px] text-emerald-700 block">قطعة</span>
              </div>
            </div>

            <div
              onClick={() => onNavigate('production_warehouse')}
              className="cursor-pointer bg-teal-50/70 hover:bg-teal-100/70 transition p-3.5 rounded-2xl border border-teal-200 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between text-teal-800">
                <span className="text-[11px] font-bold">6. الإنتاج</span>
                <PackageCheck className="w-3.5 h-3.5" />
              </div>
              <div className="mt-2">
                <span className="text-2xl font-black text-teal-900">{finishedCount}</span>
                <span className="text-[10px] text-teal-700 block">مكتمل</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Per-part current stages + completed sets */}
      <div className="bg-white rounded-3xl p-6 sm:p-7 border border-slate-200/80 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-orange-50 border border-orange-200/60 flex items-center justify-center text-orange-600">
              <GitCommit className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                المرحلة الحالية لكل قطعة • الأطقم المكتملة
              </h3>
              <p className="text-xs text-slate-500">
                كل قطعة (تيشرت / بنطلون / جاكيت) تتحرك مستقلة؛ الأطقم المكتملة للموديل = أقل عدد قطع
                بين القطع.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-black">
            <span className="px-3 py-1 rounded-full bg-slate-900 text-white">
              إجمالي الأطقم: {totalSets.toLocaleString('ar-EG')}
            </span>
            <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
              قطع قيد التشغيل: {totalPartItems.toLocaleString('ar-EG')}
            </span>
            <span className="px-3 py-1 rounded-full bg-orange-50 text-orange-800 border border-orange-200">
              في الأسمبلي والأمبالاج: {inAssemblyCount.toLocaleString('ar-EG')}
            </span>
          </div>
        </div>

        {activeModels.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-3">لا توجد موديلات مسجلة بعد.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {activeModels.slice(0, 10).map((model) => {
              const stages = getPartStages(model.id);
              const parts = Object.keys(stages) as GarmentPart[];
              return (
                <div
                  key={model.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onNavigate('model_details', model.id)}
                      className="text-xs font-black text-slate-900 hover:text-indigo-700 transition cursor-pointer"
                    >
                      {model.model_code}
                    </button>
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-700">
                      أطقم: {modelSets(model).toLocaleString('ar-EG')}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {parts.map((part) => {
                      const stage = (stages[part] || 'cutting') as PartStage;
                      return (
                        <span
                          key={part}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border border-slate-200 text-[10px] font-bold text-slate-700"
                        >
                          <span>{PART_EMOJI[part]}</span>
                          <span>{getPartLabel(part)}</span>
                          <span className="text-slate-300">•</span>
                          <span className="text-indigo-700">{PART_STAGE_LABELS[stage]}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Models Table */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-slate-700" />
            <h3 className="font-extrabold text-lg text-slate-900">🆕 أحدث الموديلات المسجلة</h3>
          </div>
          <button
            onClick={() => onNavigate('models_tracking')}
            className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            <span>سجل تتبع الموديلات ({totalModels})</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs font-bold border-b border-slate-200/80">
              <tr>
                <th className="px-6 py-3.5 text-start">الكود والصورة</th>
                <th className="px-6 py-3.5 text-start">النوع</th>
                <th className="px-6 py-3.5 text-start">المرحلة الحالية</th>
                <th className="px-6 py-3.5 text-center">المستهدف للقص</th>
                <th className="px-6 py-3.5 text-center">الإجراء المباشر</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentModels.length > 0 ? (
                recentModels.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/80 transition">
                    <td className="px-6 py-4 font-bold text-slate-900 flex items-center gap-3">
                      <img
                        src={m.image}
                        alt={m.model_code}
                        className="w-10 h-10 rounded-xl object-contain bg-white border border-slate-200 p-0.5"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src =
                            'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=100&auto=format&fit=crop&q=60';
                        }}
                      />
                      <span>{m.model_code}</span>
                    </td>
                    <td className="px-6 py-4 text-slate-600 font-medium">{m.model_type || 'غير محدد'}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-xs font-bold border ${getStatusBadge(
                          m.status
                        )}`}
                      >
                        {m.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center font-bold text-slate-800">
                      {(m.target_cut_quantity || 0).toLocaleString('ar-EG')} ق
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => {
                          if (m.status === 'جاري القص' || m.status === 'في القص') {
                            onNavigate('cutting_details', m.id);
                          } else if (m.status === 'فرز وكنترول' || m.status === 'فرز قبل الطباعة' || m.status === 'العد قبل الطباعة' || m.status === 'العد بعد الطباعة' || m.status === 'العد بعد المكن') {
                            onNavigate('qc');
                          } else if (m.status === 'في المطبعة' || m.status === 'جاهز للمطبعة' || m.status === 'مرسل للمطبعة' || m.status === 'جاهز للطباعة / التجميع') {
                            onNavigate('printing');
                          } else if (m.status === 'في قسم المكن') {
                            onNavigate('sewing');
                          } else if (
                            m.status === 'في التشطيب' ||
                            m.status === 'في المكواة' ||
                            m.status === 'في التعبئة والتغليف' ||
                            m.status === 'جاهز للدَست'
                          ) {
                            onNavigate('assembly_packaging');
                          } else if (m.status === 'مكتمل الإنتاج' || m.status === 'مخزن الإنتاج التام') {
                            onNavigate('production_warehouse');
                          } else {
                            onNavigate('model_details', m.id);
                          }
                        }}
                        className="px-3.5 py-1.5 rounded-full border border-slate-300 text-slate-700 hover:bg-slate-900 hover:text-white font-bold text-xs transition shadow-xs"
                      >
                        متابعة الموديل
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-slate-400">
                    لا توجد موديلات مسجلة حتى الآن.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
