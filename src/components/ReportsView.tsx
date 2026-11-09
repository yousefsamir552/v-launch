import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  BarChart3,
  Printer,
  Download,
  Calendar,
  Layers,
  Scissors,
  CheckCircle,
  Shirt,
  Filter,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Search,
  Sparkles,
  TrendingUp,
  AlertCircle,
  AlertTriangle,
  ClipboardList,
  Gauge,
  Timer,
  Percent,
  Factory,
  Boxes,
  ListChecks,
  Target
} from 'lucide-react';
import {
  Model,
  GarmentPart,
  GARMENT_COMPOSITION_LABELS,
  GARMENT_COMPOSITION_ORDER,
  getPartLabel,
  partsForComposition
} from '../types';

/* ------------------------------------------------------------------ */
/* Types & shared constants                                           */
/* ------------------------------------------------------------------ */

type MainTab = 'models' | 'production' | 'quality';
type ProductionSection = 'cutting' | 'printing' | 'sewing';
type AggregationSection = 'cutting' | 'printing' | 'qc' | 'sewing';
type QualityStageFilter = 'all' | 'before_print' | 'after_print' | 'after_sewing';
type ReportPeriod = 'daily' | 'weekly' | 'monthly';

/** المراحل الست الرئيسية المستخدمة في تقرير الموديلات */
type ReportStageKey = 'design' | 'cutting' | 'qc' | 'printing' | 'sewing' | 'completed';

const REPORT_STAGE_ORDER: ReportStageKey[] = [
  'design',
  'cutting',
  'qc',
  'printing',
  'sewing',
  'completed'
];

const REPORT_STAGE_META: Record<
  ReportStageKey,
  { label: string; short: string; badge: string; dot: string; text: string }
> = {
  design: {
    label: 'مرحلة التصميم',
    short: 'التصميم',
    badge: 'bg-amber-50 text-amber-800 border-amber-200',
    dot: 'bg-amber-500',
    text: 'text-amber-700'
  },
  cutting: {
    label: 'مرحلة القص',
    short: 'القص',
    badge: 'bg-blue-50 text-blue-800 border-blue-200',
    dot: 'bg-blue-600',
    text: 'text-blue-700'
  },
  qc: {
    label: 'الفرز والكنترول',
    short: 'الفرز',
    badge: 'bg-purple-50 text-purple-800 border-purple-200',
    dot: 'bg-purple-600',
    text: 'text-purple-700'
  },
  printing: {
    label: 'مرحلة المطابع',
    short: 'المطابع',
    badge: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    dot: 'bg-indigo-600',
    text: 'text-indigo-700'
  },
  sewing: {
    label: 'مرحلة المكن',
    short: 'المكن',
    badge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    dot: 'bg-emerald-600',
    text: 'text-emerald-700'
  },
  completed: {
    label: 'مكتمل الإنتاج',
    short: 'مكتمل',
    badge: 'bg-teal-50 text-teal-800 border-teal-200',
    dot: 'bg-teal-600',
    text: 'text-teal-700'
  }
};

const QC_STAGE_LABELS: Record<QualityStageFilter, string> = {
  all: 'كل مراحل الفرز',
  before_print: 'فحص قبل الطباعة',
  after_print: 'فحص بعد الطباعة',
  after_sewing: 'الفحص النهائي بعد المكن'
};

const toNum = (value?: number | string | null): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const fmtNum = (value: number): string => Math.round(toNum(value)).toLocaleString('ar-EG');

/** نسبة مئوية بمنزلة عشرية واحدة */
const pctOf = (part: number, total: number, cap = false): number => {
  if (!total || total <= 0) return 0;
  const raw = (toNum(part) / toNum(total)) * 100;
  const val = Math.round(raw * 10) / 10;
  return cap ? Math.min(100, val) : val;
};

const formatDuration = (ms: number): string => {
  if (!ms || ms <= 0) return '—';
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.round(hours * 60)} دقيقة`;
  if (hours < 24) return `${Math.round(hours * 10) / 10} ساعة`;
  return `${Math.round((hours / 24) * 10) / 10} يوم`;
};

/** تحويل حالة الموديل النصية إلى واحدة من المراحل الست (بأولوية تمنع التداخل) */
const resolveReportStage = (status?: string): ReportStageKey => {
  const s = status || '';
  if (s.includes('مكتمل') || s.includes('الإنتاج التام') || s.includes('مخزن')) return 'completed';
  if (
    s.includes('بعد المكن') ||
    s.includes('بعد الطباعة') ||
    s.includes('قبل الطباعة') ||
    s.includes('فرز')
  )
    return 'qc';
  if (s.includes('المكن') || s.includes('خياطة')) return 'sewing';
  if (s.includes('المطبعة') || s.includes('طباعة') || s.includes('تجميع') || s.includes('جاهز'))
    return 'printing';
  if (s.includes('قص')) return 'cutting';
  return 'design';
};

/* ------------------------------------------------------------------ */
/* Aggregation shapes                                                 */
/* ------------------------------------------------------------------ */

interface AggregatedBucket {
  periodKey: string;
  periodLabel: string;
  modelsCount: number;
  modelCodes: string[];
  totalPieces: number;
  secondaryLabel: string;
  secondaryValue: string | number;
  operationsCount: number;
  operators: string[];
  details: {
    id: string;
    modelCode: string;
    detail1: string;
    detail2: string;
    pieces: number;
    notes?: string;
    timestamp?: string;
  }[];
}

/** صف شامل لكل موديل داخل تقرير الموديلات */
interface ModelReportRow {
  model: Model;
  stage: ReportStageKey;
  compositionLabel: string;
  parts: GarmentPart[];
  sizes: string[];
  target: number;
  cutQty: number;
  printQty: number;
  sewingQty: number;
  qcGood: number;
  qcDefect: number;
  completedSets: number;
  progress: number;
  cutByPart: Record<string, number>;
  qcByPart: Record<string, number>;
  hasData: boolean;
}

/** صف تجميع نسب العيوب (موديل / قطعة / مطبعة / ورشة) */
interface DefectAggRow {
  key: string;
  label: string;
  sublabel?: string;
  inspected: number;
  good: number;
  defect: number;
  ratio: number;
  modelsCount: number;
}

/* ------------------------------------------------------------------ */
/* Reusable aggregated period table (production + QC)                 */
/* ------------------------------------------------------------------ */

interface AggregationTableProps {
  buckets: AggregatedBucket[];
  summary: {
    totalPieces: number;
    totalModels: number;
    totalOperations: number;
    avgPerBucket: number;
    bucketsCount: number;
  };
  title: string;
  periodLabel: string;
  secondaryFallback: string;
  emptyTitle: string;
}

const AggregationTable: React.FC<AggregationTableProps> = ({
  buckets,
  summary,
  title,
  periodLabel,
  secondaryFallback,
  emptyTitle
}) => {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden print:border-none print:shadow-none">
      <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/60 print:bg-white print:border-b-2 print:border-slate-800">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-amber-600" />
          <h3 className="font-black text-slate-900 text-base">
            {title} ({periodLabel})
          </h3>
        </div>
        <span className="text-xs text-slate-500 font-bold">
          عدد السجلات المجمعة: {buckets.length}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs text-start">
          <thead className="bg-slate-100 text-slate-700 font-extrabold border-b border-slate-200 print:bg-slate-200 print:text-black">
            <tr>
              <th className="px-6 py-3.5">الفترة الزمنية (التاريخ / الأسبوع / الشهر)</th>
              <th className="px-6 py-3.5 text-center">عدد الموديلات</th>
              <th className="px-6 py-3.5">أكواد الموديلات المنفذة</th>
              <th className="px-6 py-3.5 text-center">إجمالي عدد القطع</th>
              <th className="px-6 py-3.5 text-center">
                {buckets[0]?.secondaryLabel || secondaryFallback}
              </th>
              <th className="px-6 py-3.5">المشرفون / الورش المعنية</th>
              <th className="px-6 py-3.5 text-center print:hidden">التفاصيل</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {buckets.length > 0 ? (
              buckets.map((bucket) => {
                const isExpanded = expandedKey === bucket.periodKey;

                return (
                  <React.Fragment key={bucket.periodKey}>
                    <tr className="hover:bg-amber-50/40 transition">
                      <td className="px-6 py-4 font-black text-slate-900 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0 print:hidden"></span>
                          <span className="text-sm font-extrabold">{bucket.periodLabel}</span>
                        </div>
                      </td>

                      <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 bg-indigo-50 text-indigo-700 rounded-full font-black text-xs border border-indigo-100">
                          {bucket.modelsCount}
                        </span>
                      </td>

                      <td className="px-6 py-4 font-bold text-slate-700 max-w-xs">
                        <div className="flex flex-wrap gap-1">
                          {bucket.modelCodes.map((code) => (
                            <span
                              key={code}
                              className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-800 text-[11px] font-extrabold border border-slate-200"
                            >
                              {code}
                            </span>
                          ))}
                        </div>
                      </td>

                      <td className="px-6 py-4 text-center font-black text-slate-900 text-sm">
                        <span className="text-emerald-700 font-mono text-base font-black">
                          {fmtNum(bucket.totalPieces)}
                        </span>{' '}
                        <span className="text-[11px] text-slate-500 font-semibold">قطعة</span>
                      </td>

                      <td className="px-6 py-4 text-center font-bold text-slate-700">
                        <span className="px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs">
                          {bucket.secondaryValue}
                        </span>
                      </td>

                      <td className="px-6 py-4 text-xs font-semibold text-slate-600 max-w-xs">
                        {bucket.operators.length > 0 ? (
                          <div className="truncate" title={bucket.operators.join('، ')}>
                            {bucket.operators.join('، ')}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td className="px-6 py-4 text-center print:hidden">
                        <button
                          type="button"
                          onClick={() => setExpandedKey(isExpanded ? null : bucket.periodKey)}
                          className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition flex items-center justify-center gap-1 cursor-pointer mx-auto"
                          title="عرض الحركات التفصيلية لهذه الفترة"
                        >
                          <span className="text-[11px]">({bucket.details.length})</span>
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-slate-50/80 print:hidden">
                        <td colSpan={7} className="px-6 py-4">
                          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-2">
                            <h5 className="font-black text-xs text-slate-800 flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                              <span>تفاصيل الحركات الفردية المندرجة تحت ({bucket.periodLabel}):</span>
                            </h5>
                            <div className="overflow-x-auto">
                              <table className="w-full text-[11px] text-start border border-slate-100 rounded-xl overflow-hidden">
                                <thead className="bg-slate-100 text-slate-600 font-bold">
                                  <tr>
                                    <th className="py-2 px-3">كود الموديل</th>
                                    <th className="py-2 px-3">البيان الأساسي</th>
                                    <th className="py-2 px-3">التفاصيل والجهة</th>
                                    <th className="py-2 px-3 text-center">القطع</th>
                                    <th className="py-2 px-3">ملاحظات</th>
                                    <th className="py-2 px-3 text-center">التوقيت</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {bucket.details.map((d) => (
                                    <tr key={d.id} className="hover:bg-slate-50">
                                      <td className="py-2 px-3 font-extrabold text-slate-900">{d.modelCode}</td>
                                      <td className="py-2 px-3 font-semibold text-slate-800">{d.detail1}</td>
                                      <td className="py-2 px-3 text-slate-600">{d.detail2}</td>
                                      <td className="py-2 px-3 text-center font-black text-emerald-700 font-mono">
                                        {fmtNum(d.pieces)} ق
                                      </td>
                                      <td className="py-2 px-3 text-slate-500">{d.notes || '—'}</td>
                                      <td className="py-2 px-3 text-center font-mono text-slate-400">
                                        {d.timestamp ? d.timestamp.slice(11, 16) || d.timestamp : '—'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            ) : (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <AlertCircle className="w-8 h-8 text-slate-300 stroke-1" />
                    <p className="font-bold text-xs text-slate-600">{emptyTitle}</p>
                    <p className="text-[11px] text-slate-400">
                      جرب تغيير نطاق التاريخ أو اختيار فترة تجميع أخرى.
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>

          {buckets.length > 0 && (
            <tfoot className="bg-slate-100/90 font-black text-slate-900 border-t-2 border-slate-300 print:bg-slate-200">
              <tr>
                <td className="px-6 py-4 text-sm font-black">
                  الإجمالي الكلي العام ({buckets.length} فترة)
                </td>
                <td className="px-6 py-4 text-center font-black text-indigo-800 text-sm">
                  {summary.totalModels} موديل
                </td>
                <td className="px-6 py-4 text-xs text-slate-600">كافة الموديلات النشطة</td>
                <td className="px-6 py-4 text-center font-mono font-black text-emerald-800 text-base">
                  {fmtNum(summary.totalPieces)} قطعة
                </td>
                <td className="px-6 py-4 text-center text-xs text-slate-700">
                  {summary.totalOperations} عملية تشغيل
                </td>
                <td className="px-6 py-4 text-xs text-slate-600">—</td>
                <td className="px-6 py-4 print:hidden"></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Main component                                                     */
/* ------------------------------------------------------------------ */

export const ReportsView: React.FC = () => {
  const {
    currentUser,
    models,
    cuttingRecords,
    qcRecords,
    printDispatches,
    sewingDispatches,
    getModelSizeList,
    logAction,
    addFlashMessage
  } = useApp();

  /* ----------------------------- tab state ---------------------------- */
  const [activeTab, setActiveTab] = useState<MainTab>('models');

  /* ------------------- tab 1: model report filters -------------------- */
  const [modelSearch, setModelSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sizeFilter, setSizeFilter] = useState('all');
  const [compositionFilter, setCompositionFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState<'all' | ReportStageKey>('all');

  /* ------------- tabs 2 & 3: shared period / date filters ------------- */
  const [selectedSection, setSelectedSection] = useState<ProductionSection>('cutting');
  const [selectedPeriod, setSelectedPeriod] = useState<ReportPeriod>('daily');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  /* ------------------ tab 3: quality stage filter --------------------- */
  const [qualityStage, setQualityStage] = useState<QualityStageFilter>('all');

  const aggSection: AggregationSection = activeTab === 'quality' ? 'qc' : selectedSection;

  const activeModels = useMemo(() => models.filter((m) => !m.is_deleted), [models]);

  /* ------------------------- date helpers ----------------------------- */

  const arabicMonths = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];
  const arabicDays = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  const formatPeriodLabel = (dStr: string, period: ReportPeriod): string => {
    try {
      const d = new Date(dStr);
      if (isNaN(d.getTime())) return dStr;

      if (period === 'daily') {
        return `${arabicDays[d.getDay()]}، ${d.getDate()} ${arabicMonths[d.getMonth()]} ${d.getFullYear()}`;
      }
      if (period === 'weekly') {
        const startOfWeek = new Date(d);
        startOfWeek.setDate(d.getDate() - d.getDay());
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        return `أسبوع (${startOfWeek.getDate()} ${arabicMonths[startOfWeek.getMonth()]} — ${endOfWeek.getDate()} ${arabicMonths[endOfWeek.getMonth()]} ${endOfWeek.getFullYear()})`;
      }
      return `${arabicMonths[d.getMonth()]} ${d.getFullYear()}`;
    } catch {
      return dStr;
    }
  };

  const getBucketKey = (dateVal: string | undefined, period: ReportPeriod): string => {
    if (!dateVal) return 'غير محدد';
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return dateVal.slice(0, 10);

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    if (period === 'daily') return `${year}-${month}-${day}`;
    if (period === 'weekly') {
      const startOfWeek = new Date(d);
      startOfWeek.setDate(d.getDate() - d.getDay());
      const sY = startOfWeek.getFullYear();
      const sM = String(startOfWeek.getMonth() + 1).padStart(2, '0');
      const sD = String(startOfWeek.getDate()).padStart(2, '0');
      return `week-${sY}-${sM}-${sD}`;
    }
    return `${year}-${month}`;
  };

  const inDateRange = (dateStr?: string): boolean => {
    if (!dateStr) return true;
    const d = dateStr.slice(0, 10);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };

  /* ------------------------------------------------------------------ */
  /* Period aggregation engine (production + QC)                        */
  /* ------------------------------------------------------------------ */

  const aggregatedData = useMemo<AggregatedBucket[]>(() => {
    const bucketsMap = new Map<string, AggregatedBucket>();

    const createBucket = (
      periodKey: string,
      periodLabel: string,
      secondaryLabel: string,
      secondaryValue: string | number
    ): AggregatedBucket => ({
      periodKey,
      periodLabel,
      modelsCount: 0,
      modelCodes: [],
      totalPieces: 0,
      secondaryLabel,
      secondaryValue,
      operationsCount: 0,
      operators: [],
      details: []
    });

    if (aggSection === 'cutting') {
      cuttingRecords.forEach((rec) => {
        if (!inDateRange(rec.created_at)) return;
        const bucketKey = getBucketKey(rec.created_at, selectedPeriod);
        const modelCode = models.find((mod) => mod.id === rec.model_id)?.model_code || 'موديل';

        if (!bucketsMap.has(bucketKey)) {
          bucketsMap.set(
            bucketKey,
            createBucket(
              bucketKey,
              formatPeriodLabel(rec.created_at || bucketKey, selectedPeriod),
              'عدد الراقات',
              0
            )
          );
        }

        const bucket = bucketsMap.get(bucketKey)!;
        bucket.totalPieces += toNum(rec.pieces_count ?? rec.piecesCount);
        bucket.secondaryValue = toNum(bucket.secondaryValue) + toNum(rec.layers_count ?? rec.layersCount);
        bucket.operationsCount += 1;
        if (!bucket.modelCodes.includes(modelCode)) bucket.modelCodes.push(modelCode);
        if (rec.cutter_name && !bucket.operators.includes(rec.cutter_name)) {
          bucket.operators.push(rec.cutter_name);
        }
        if (rec.spreader_name && !bucket.operators.includes(rec.spreader_name)) {
          bucket.operators.push(rec.spreader_name);
        }
        bucket.details.push({
          id: rec.id,
          modelCode,
          detail1: `فرشة #${rec.spread_number || rec.spreadNumber || 1} (${rec.color_name || rec.colorName || '—'})`,
          detail2: `الفراش: ${rec.spreader_name || rec.spreaderName || '—'} • المقصدار: ${rec.cutter_name || rec.cutterName || '—'} (راقات: ${rec.layers_count || rec.layersCount || 0})`,
          pieces: toNum(rec.pieces_count ?? rec.piecesCount),
          notes: rec.notes || rec.shade_degree || rec.shadeDegree || '',
          timestamp: rec.created_at
        });
      });
    } else if (aggSection === 'printing') {
      printDispatches.forEach((disp) => {
        const dateRef = disp.dispatched_at || disp.expected_delivery_date || '2026-11-01';
        if (!inDateRange(dateRef)) return;
        const bucketKey = getBucketKey(dateRef, selectedPeriod);
        const modelCode = models.find((mod) => mod.id === disp.model_id)?.model_code || 'موديل';

        if (!bucketsMap.has(bucketKey)) {
          bucketsMap.set(
            bucketKey,
            createBucket(
              bucketKey,
              formatPeriodLabel(dateRef, selectedPeriod),
              'حالة الاستلام بالمصنع',
              ''
            )
          );
        }

        const bucket = bucketsMap.get(bucketKey)!;
        bucket.totalPieces += toNum(disp.pieces_count);
        bucket.operationsCount += 1;
        if (!bucket.modelCodes.includes(modelCode)) bucket.modelCodes.push(modelCode);
        if (disp.shop_name && !bucket.operators.includes(disp.shop_name)) {
          bucket.operators.push(disp.shop_name);
        }
        bucket.details.push({
          id: disp.id,
          modelCode,
          detail1: `المطبعة: ${disp.shop_name}`,
          detail2: `النوع: ${disp.print_type} • الحالة: ${disp.status}`,
          pieces: toNum(disp.pieces_count),
          notes: disp.notes || '',
          timestamp: disp.dispatched_at
        });
      });

      bucketsMap.forEach((bucket) => {
        const receivedCount = bucket.details.filter((d) => d.detail2.includes('تم الاستلام')).length;
        bucket.secondaryValue = `${receivedCount} من ${bucket.operationsCount} مستلم`;
      });
    } else if (aggSection === 'qc') {
      qcRecords.forEach((rec) => {
        if (!inDateRange(rec.created_at)) return;
        const bucketKey = getBucketKey(rec.created_at, selectedPeriod);
        const modelCode = models.find((mod) => mod.id === rec.model_id)?.model_code || 'موديل';

        if (!bucketsMap.has(bucketKey)) {
          bucketsMap.set(
            bucketKey,
            createBucket(
              bucketKey,
              formatPeriodLabel(rec.created_at || bucketKey, selectedPeriod),
              'الهوالك والعيوب',
              0
            )
          );
        }

        const bucket = bucketsMap.get(bucketKey)!;
        const counted = toNum(rec.counted_pieces ?? rec.good_qty);
        const defects = toNum(rec.defect_pieces ?? rec.defect_qty);

        bucket.totalPieces += counted;
        bucket.secondaryValue = toNum(bucket.secondaryValue) + defects;
        bucket.operationsCount += 1;
        if (!bucket.modelCodes.includes(modelCode)) bucket.modelCodes.push(modelCode);
        if (rec.inspector_name && !bucket.operators.includes(rec.inspector_name)) {
          bucket.operators.push(rec.inspector_name);
        }
        bucket.details.push({
          id: rec.id,
          modelCode,
          detail1: `مرحلة: ${QC_STAGE_LABELS[(rec.stage || 'after_sewing') as QualityStageFilter] || 'فرز'} (${rec.color_name || 'لون'} - مقاس ${rec.size || '—'})`,
          detail2: `مسؤول الجودة: ${rec.inspector_name || '—'} (تالف: ${defects})`,
          pieces: counted,
          notes: rec.notes || rec.defect_notes || '',
          timestamp: rec.created_at
        });
      });
    } else {
      sewingDispatches.forEach((disp) => {
        const dateRef = disp.dispatched_at || disp.expected_delivery_date || '2026-11-01';
        if (!inDateRange(dateRef)) return;
        const bucketKey = getBucketKey(dateRef, selectedPeriod);
        const modelCode = models.find((mod) => mod.id === disp.model_id)?.model_code || 'موديل';
        const label = disp.piece_label || getPartLabel(disp.piece_type);

        if (!bucketsMap.has(bucketKey)) {
          bucketsMap.set(
            bucketKey,
            createBucket(
              bucketKey,
              formatPeriodLabel(dateRef, selectedPeriod),
              'توزيع القطع (تيشرت / بنطلون)',
              ''
            )
          );
        }

        const bucket = bucketsMap.get(bucketKey)!;
        bucket.totalPieces += toNum(disp.pieces_count);
        bucket.operationsCount += 1;
        if (!bucket.modelCodes.includes(modelCode)) bucket.modelCodes.push(modelCode);
        if (disp.workshop_name && !bucket.operators.includes(disp.workshop_name)) {
          bucket.operators.push(disp.workshop_name);
        }
        bucket.details.push({
          id: disp.id,
          modelCode,
          detail1: `القطعة: [${label}] • ورشة: ${disp.workshop_name}`,
          detail2: `تاريخ الاستلام: ${disp.expected_delivery_date || '—'} (${disp.status})`,
          pieces: toNum(disp.pieces_count),
          notes: disp.notes || '',
          timestamp: disp.dispatched_at
        });
      });

      bucketsMap.forEach((bucket) => {
        const shirtPieces = bucket.details
          .filter((d) => d.detail1.includes('تيشرت'))
          .reduce((acc, d) => acc + d.pieces, 0);
        const pantsPieces = bucket.details
          .filter((d) => d.detail1.includes('بنطلون'))
          .reduce((acc, d) => acc + d.pieces, 0);
        bucket.secondaryValue = `تيشرت: ${fmtNum(shirtPieces)} • بنطلون: ${fmtNum(pantsPieces)}`;
      });
    }

    return Array.from(bucketsMap.values())
      .map((b) => ({ ...b, modelsCount: b.modelCodes.length }))
      .sort((a, b) => b.periodKey.localeCompare(a.periodKey));
  }, [
    aggSection,
    selectedPeriod,
    dateFrom,
    dateTo,
    cuttingRecords,
    qcRecords,
    printDispatches,
    sewingDispatches,
    models
  ]);

  const overallSummary = useMemo(() => {
    const totalPieces = aggregatedData.reduce((acc, b) => acc + b.totalPieces, 0);
    const allModelsSet = new Set<string>();
    aggregatedData.forEach((b) => b.modelCodes.forEach((code) => allModelsSet.add(code)));
    const totalOperations = aggregatedData.reduce((acc, b) => acc + b.operationsCount, 0);
    const avgPerBucket =
      aggregatedData.length > 0 ? Math.round(totalPieces / aggregatedData.length) : 0;

    return {
      totalPieces,
      totalModels: allModelsSet.size,
      totalOperations,
      avgPerBucket,
      bucketsCount: aggregatedData.length
    };
  }, [aggregatedData]);

  /* ------------------------------------------------------------------ */
  /* Tab 1 – comprehensive per-model report                             */
  /* ------------------------------------------------------------------ */

  const modelPartsOf = (model: Model): GarmentPart[] => {
    const declared =
      (model.garment_parts && model.garment_parts.length > 0 ? model.garment_parts : model.parts) ||
      [];
    if (declared.length > 0) return declared;
    return partsForComposition(model.garment_composition);
  };

  const sumPartSummary = (
    summary: Partial<Record<GarmentPart, number>> | undefined,
    parts: GarmentPart[]
  ): number => parts.reduce((acc, p) => acc + toNum(summary?.[p]), 0);

  const modelReportRows = useMemo<ModelReportRow[]>(() => {
    return activeModels.map((model) => {
      const parts = modelPartsOf(model);
      const cutByPart: Record<string, number> = {};
      const qcByPart: Record<string, number> = {};
      parts.forEach((p) => {
        cutByPart[p] = 0;
        qcByPart[p] = 0;
      });

      let cutQty = 0;
      let qcGood = 0;
      let qcDefect = 0;
      let printQty = 0;
      let sewingQty = 0;

      cuttingRecords.forEach((rec) => {
        if (rec.model_id !== model.id) return;
        const part = String(rec.part_type || rec.partType || rec.part || 'shirt');
        const qty = toNum(rec.pieces_count ?? rec.piecesCount ?? rec.cut_pieces);
        cutByPart[part] = (cutByPart[part] || 0) + qty;
        cutQty += qty;
      });

      qcRecords.forEach((rec) => {
        if (rec.model_id !== model.id) return;
        const part = String(rec.part_type || rec.partType || 'shirt');
        const good = toNum(rec.good_qty ?? rec.counted_pieces);
        const defect = toNum(rec.defect_qty ?? rec.defect_pieces);
        qcByPart[part] = (qcByPart[part] || 0) + good;
        qcGood += good;
        qcDefect += defect;
      });

      printDispatches.forEach((d) => {
        if (d.model_id === model.id) printQty += toNum(d.pieces_count);
      });
      sewingDispatches.forEach((d) => {
        if (d.model_id === model.id) sewingQty += toNum(d.pieces_count);
      });

      /* الرجوع للملخصات المخزنة على الموديل عند عدم وجود حركات مسجلة */
      if (cutQty === 0) cutQty = sumPartSummary(model.cut_summary, parts);
      if (qcGood === 0) qcGood = sumPartSummary(model.qc_summary, parts);

      const target = toNum(model.target_cut_quantity);
      const partsWithQc = parts.filter((p) => toNum(qcByPart[p]) > 0);
      const completedSets =
        toNum(model.completed_sets) ||
        (partsWithQc.length > 0 ? Math.min(...partsWithQc.map((p) => toNum(qcByPart[p]))) : qcGood);

      return {
        model,
        stage: resolveReportStage(model.status),
        compositionLabel:
          GARMENT_COMPOSITION_LABELS[
            (model.garment_composition || 'two_pieces') as keyof typeof GARMENT_COMPOSITION_LABELS
          ] || 'غير محدد',
        parts,
        sizes: getModelSizeList(model.id),
        target,
        cutQty,
        printQty,
        sewingQty,
        qcGood,
        qcDefect,
        completedSets,
        progress: target > 0 ? pctOf(cutQty, target, true) : cutQty > 0 ? 100 : 0,
        cutByPart,
        qcByPart,
        hasData: cutQty > 0 || qcGood > 0 || printQty > 0 || sewingQty > 0
      };
    });
  }, [
    activeModels,
    cuttingRecords,
    qcRecords,
    printDispatches,
    sewingDispatches,
    getModelSizeList
  ]);

  const modelTypeOptions = useMemo(
    () =>
      Array.from(new Set(activeModels.map((m) => m.model_type).filter(Boolean))).sort((a, b) =>
        String(a).localeCompare(String(b), 'ar')
      ),
    [activeModels]
  );

  const modelSizeOptions = useMemo(() => {
    const all = new Set<string>();
    activeModels.forEach((m) => getModelSizeList(m.id).forEach((s) => all.add(s)));
    return Array.from(all);
  }, [activeModels, getModelSizeList]);

  const filteredModelRows = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    return modelReportRows.filter((row) => {
      if (q) {
        const haystack = `${row.model.model_code} ${row.model.model_type || ''} ${row.model.print_house || ''} ${
          row.model.print_house_name || ''
        }`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (typeFilter !== 'all' && (row.model.model_type || '') !== typeFilter) return false;
      if (sizeFilter !== 'all' && !row.sizes.includes(sizeFilter)) return false;
      if (
        compositionFilter !== 'all' &&
        (row.model.garment_composition || 'two_pieces') !== compositionFilter
      )
        return false;
      if (stageFilter !== 'all' && row.stage !== stageFilter) return false;
      return true;
    });
  }, [modelReportRows, modelSearch, typeFilter, sizeFilter, compositionFilter, stageFilter]);

  const modelSummary = useMemo(() => {
    const stageCounts = REPORT_STAGE_ORDER.reduce(
      (acc, key) => ({ ...acc, [key]: 0 }),
      {} as Record<ReportStageKey, number>
    );

    const totals = filteredModelRows.reduce(
      (acc, row) => {
        acc.target += row.target;
        acc.cut += row.cutQty;
        acc.qcGood += row.qcGood;
        acc.qcDefect += row.qcDefect;
        acc.print += row.printQty;
        acc.sewing += row.sewingQty;
        acc.sets += row.completedSets;
        acc.modelsWithData += row.hasData ? 1 : 0;
        stageCounts[row.stage] += 1;
        return acc;
      },
      {
        target: 0,
        cut: 0,
        qcGood: 0,
        qcDefect: 0,
        print: 0,
        sewing: 0,
        sets: 0,
        modelsWithData: 0
      }
    );

    return { ...totals, stageCounts };
  }, [filteredModelRows]);

  /* ------------------------------------------------------------------ */
  /* Tab 2 – production speed & efficiency                              */
  /* ------------------------------------------------------------------ */

  const rangeDays = useMemo(() => {
    if (dateFrom && dateTo) {
      const a = new Date(dateFrom).getTime();
      const b = new Date(dateTo).getTime();
      if (!isNaN(a) && !isNaN(b) && b >= a) {
        return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
      }
    }

    const stamps: string[] = [];
    cuttingRecords.forEach((r) => {
      if (r.created_at && inDateRange(r.created_at)) stamps.push(r.created_at);
    });
    printDispatches.forEach((d) => {
      const ref = d.dispatched_at || d.expected_delivery_date;
      if (ref && inDateRange(ref)) stamps.push(ref);
    });
    sewingDispatches.forEach((d) => {
      const ref = d.dispatched_at || d.expected_delivery_date;
      if (ref && inDateRange(ref)) stamps.push(ref);
    });

    const times = stamps.map((s) => new Date(s).getTime()).filter((t) => !isNaN(t));
    if (times.length < 2) return 1;
    return Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 86_400_000) + 1);
  }, [dateFrom, dateTo, cuttingRecords, printDispatches, sewingDispatches]);

  const productionSpeed = useMemo(() => {
    const build = (pieces: number, operations: number) => ({
      pieces,
      operations,
      perDay: Math.round(pieces / rangeDays),
      perOperation: operations > 0 ? Math.round(pieces / operations) : 0
    });

    let cutPieces = 0;
    let cutOps = 0;
    cuttingRecords.forEach((r) => {
      if (!inDateRange(r.created_at)) return;
      cutPieces += toNum(r.pieces_count ?? r.piecesCount ?? r.cut_pieces);
      cutOps += 1;
    });

    let printPieces = 0;
    let printOps = 0;
    printDispatches.forEach((d) => {
      const ref = d.dispatched_at || d.expected_delivery_date;
      if (!inDateRange(ref)) return;
      printPieces += toNum(d.pieces_count);
      printOps += 1;
    });

    let sewingPieces = 0;
    let sewingOps = 0;
    sewingDispatches.forEach((d) => {
      const ref = d.dispatched_at || d.expected_delivery_date;
      if (!inDateRange(ref)) return;
      sewingPieces += toNum(d.pieces_count);
      sewingOps += 1;
    });

    return {
      cutting: build(cutPieces, cutOps),
      printing: build(printPieces, printOps),
      sewing: build(sewingPieces, sewingOps),
      totalPieces: cutPieces + printPieces + sewingPieces
    };
  }, [cuttingRecords, printDispatches, sewingDispatches, dateFrom, dateTo, rangeDays]);

  const stageDurations = useMemo(() => {
    const samples: Record<'cutting' | 'printing' | 'sewing' | 'final', number[]> = {
      cutting: [],
      printing: [],
      sewing: [],
      final: []
    };

    const phaseTime = (model: Model, phaseTypes: string[]): number | null => {
      const event = (model.timeline || []).find((e) =>
        phaseTypes.includes(String((e.details as Record<string, unknown> | undefined)?.phase_type || ''))
      );
      if (!event?.timestamp) return null;
      const time = new Date(event.timestamp).getTime();
      return isNaN(time) ? null : time;
    };

    activeModels.forEach((model) => {
      const created = new Date(model.created_at).getTime();
      const t0 = isNaN(created) ? null : created;
      const t1 = phaseTime(model, ['cutting_finished', 'cutting_done', 'design_to_cutting', 'cutting']);
      const t2 = phaseTime(model, ['printing_dispatch', 'printing_sent', 'printing_received']);
      const t3 = phaseTime(model, [
        'sewing_dispatch',
        'sewing_sent',
        'sewing_receive',
        'sewing_finished'
      ]);
      const t4 = phaseTime(model, ['qc_after_sewing']);

      if (t0 && t1 && t1 > t0) samples.cutting.push(t1 - t0);
      if (t1 && t2 && t2 > t1) samples.printing.push(t2 - t1);
      if (t2 && t3 && t3 > t2) samples.sewing.push(t3 - t2);
      if (t3 && t4 && t4 > t3) samples.final.push(t4 - t3);
    });

    const average = (values: number[]) =>
      values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;

    return {
      cutting: { avg: average(samples.cutting), count: samples.cutting.length },
      printing: { avg: average(samples.printing), count: samples.printing.length },
      sewing: { avg: average(samples.sewing), count: samples.sewing.length },
      final: { avg: average(samples.final), count: samples.final.length }
    };
  }, [activeModels]);

  /* ------------------------------------------------------------------ */
  /* Tab 3 – quality & defect ratio analytics                           */
  /* ------------------------------------------------------------------ */

  const qualityRecords = useMemo(
    () =>
      qcRecords.filter(
        (rec) => (qualityStage === 'all' || rec.stage === qualityStage) && inDateRange(rec.created_at)
      ),
    [qcRecords, qualityStage, dateFrom, dateTo]
  );

  const qualityRecordValues = (rec: (typeof qcRecords)[number]) => {
    const good = toNum(rec.good_qty ?? rec.counted_pieces);
    const defect = toNum(rec.defect_qty ?? rec.defect_pieces);
    return { good, defect, inspected: good + defect };
  };

  const buildDefectRows = (
    records: typeof qcRecords,
    keyOf: (rec: (typeof qcRecords)[number]) => string,
    labelOf: (rec: (typeof qcRecords)[number], key: string) => string,
    sublabelOf?: (key: string) => string | undefined
  ): DefectAggRow[] => {
    const map = new Map<string, DefectAggRow>();

    records.forEach((rec) => {
      const key = keyOf(rec) || 'غير محدد';
      const { good, defect, inspected } = qualityRecordValues(rec);
      const current =
        map.get(key) ||
        ({
          key,
          label: labelOf(rec, key),
          sublabel: sublabelOf ? sublabelOf(key) : undefined,
          inspected: 0,
          good: 0,
          defect: 0,
          ratio: 0,
          modelsCount: 0
        } as DefectAggRow);

      current.inspected += inspected;
      current.good += good;
      current.defect += defect;
      map.set(key, current);
    });

    return Array.from(map.values())
      .map((row) => ({
        ...row,
        ratio: pctOf(row.defect, row.inspected),
        modelsCount: new Set(
          records.filter((rec) => (keyOf(rec) || 'غير محدد') === row.key).map((rec) => rec.model_id)
        ).size
      }))
      .sort((a, b) => b.defect - a.defect || b.ratio - a.ratio);
  };

  const qualitySummary = useMemo(() => {
    const totals = qualityRecords.reduce(
      (acc, rec) => {
        const { good, defect, inspected } = qualityRecordValues(rec);
        acc.good += good;
        acc.defect += defect;
        acc.inspected += inspected;
        return acc;
      },
      { good: 0, defect: 0, inspected: 0 }
    );

    return {
      ...totals,
      ratio: pctOf(totals.defect, totals.inspected),
      records: qualityRecords.length
    };
  }, [qualityRecords]);

  const qualityByModel = useMemo(
    () =>
      buildDefectRows(
        qualityRecords,
        (rec) => rec.model_id,
        (rec) => models.find((m) => m.id === rec.model_id)?.model_code || 'موديل',
        (key) => models.find((m) => m.id === key)?.model_type
      ),
    [qualityRecords, models]
  );

  const qualityByPart = useMemo(
    () =>
      buildDefectRows(
        qualityRecords,
        (rec) => String(rec.part_type || rec.partType || 'shirt'),
        (rec) => getPartLabel(rec.part_type || rec.partType),
        (key) =>
          `${qualityRecords.filter((r) => String(r.part_type || r.partType || 'shirt') === key).length} حركة فحص`
      ),
    [qualityRecords]
  );

  const printHouseOfRecord = (rec: (typeof qcRecords)[number]): string => {
    const part = String(rec.part_type || rec.partType || 'shirt');
    const dispatch = printDispatches.find(
      (d) => d.model_id === rec.model_id && String(d.piece_type || 'shirt') === part
    );
    if (dispatch?.shop_name) return dispatch.shop_name;
    const model = models.find((m) => m.id === rec.model_id);
    return model?.print_house || model?.print_house_name || 'غير محدد';
  };

  const workshopOfRecord = (rec: (typeof qcRecords)[number]): string => {
    const part = String(rec.part_type || rec.partType || 'shirt');
    const dispatch = sewingDispatches.find(
      (d) => d.model_id === rec.model_id && String(d.piece_type || 'shirt') === part
    );
    if (dispatch?.workshop_name) return dispatch.workshop_name;
    const model = models.find((m) => m.id === rec.model_id);
    return model?.sewing_workshop || 'غير محدد';
  };

  const qualityByPrintHouse = useMemo(
    () => buildDefectRows(qualityRecords, printHouseOfRecord, (_rec, key) => key),
    [qualityRecords, printDispatches, models]
  );

  const qualityByWorkshop = useMemo(
    () => buildDefectRows(qualityRecords, workshopOfRecord, (_rec, key) => key),
    [qualityRecords, sewingDispatches, models]
  );

  /* ------------------------------------------------------------------ */
  /* Section metadata & actions                                         */
  /* ------------------------------------------------------------------ */

  const productionSectionMeta: Record<
    ProductionSection,
    { title: string; subtitle: string; icon: React.ElementType; iconClass: string; accent: string }
  > = {
    cutting: {
      title: 'تقرير قسم القص وخطوط الفرش',
      subtitle: 'متابعة سرعة القص والفرش ومعدلات الإنتاج اليومية لكل موديل.',
      icon: Scissors,
      iconClass: 'text-rose-600 bg-rose-50 border-rose-200',
      accent: 'bg-rose-600'
    },
    printing: {
      title: 'تقرير المطابع والتطريز',
      subtitle: 'متابعة كميات الإرسال للمطابع وحالات الاستلام وسرعة التشغيل.',
      icon: Printer,
      iconClass: 'text-indigo-600 bg-indigo-50 border-indigo-200',
      accent: 'bg-indigo-600'
    },
    sewing: {
      title: 'تقرير قسم المكن وخطوط الخياطة',
      subtitle: 'متابعة توزيع القطع على ورش المكن وسرعة الاستلام والتشغيل.',
      icon: Shirt,
      iconClass: 'text-emerald-600 bg-emerald-50 border-emerald-200',
      accent: 'bg-emerald-600'
    }
  };

  const sectionMeta = productionSectionMeta[selectedSection];

  const currentReportTitle =
    activeTab === 'models'
      ? 'تقرير الموديلات الشامل'
      : activeTab === 'production'
        ? sectionMeta.title
        : 'تقرير الفرز ونسب العيوب';

  const currentReportSubtitle =
    activeTab === 'models'
      ? 'بيانات مجمعة لكل موديل: التركيبة، المقاسات، المرحلة الحالية، كميات القص والفرز والمطابع والمكن ونسبة الإنجاز.'
      : activeTab === 'production'
        ? 'مؤشرات سرعة الإنتاج مع التجميع اليومي والأسبوعي والشهري وتحليل زمن المراحل.'
        : 'نسب الهالك والعيوب والدرجة الثانية لكل موديل وقطعة ومطبعة وورشة مكن مع سجل الفحص الزمني.';

  const periodLabelAr =
    selectedPeriod === 'daily'
      ? 'تجميع يومي'
      : selectedPeriod === 'weekly'
        ? 'تجميع أسبوعي'
        : 'تجميع شهري';

  const resetTimeFilters = () => {
    setDateFrom('');
    setDateTo('');
  };

  const resetModelFilters = () => {
    setModelSearch('');
    setTypeFilter('all');
    setSizeFilter('all');
    setCompositionFilter('all');
    setStageFilter('all');
  };

  const downloadCsv = (filename: string, headers: string[], rows: (string | number)[][]) => {
    const escapeCell = (cell: string | number) => {
      const text = String(cell ?? '');
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const csvContent =
      '\uFEFF' +
      [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    logAction('طباعة تقرير', `${currentReportTitle} - ${currentUser?.real_name || 'مستخدم'}`);
    window.print();
  };

  const handleExportCsv = () => {
    if (activeTab === 'models') {
      if (filteredModelRows.length === 0) {
        addFlashMessage('لا توجد بيانات موديلات للتصدير بالمعايير الحالية', 'warning');
        return;
      }

      downloadCsv(
        `model-report-${new Date().toISOString().slice(0, 10)}.csv`,
        [
          'كود الموديل',
          'نوع الموديل',
          'التركيبة',
          'المقاسات',
          'المرحلة الحالية',
          'المستهدف',
          'القص الفعلي',
          'تفاصيل القص بالقطعة',
          'الفرز السليم',
          'الهالك',
          'المطابع',
          'المكن',
          'أطقم مكتملة',
          'نسبة الإنجاز %'
        ],
        filteredModelRows.map((row) => [
          row.model.model_code,
          row.model.model_type || '—',
          row.compositionLabel,
          row.sizes.join(' / ') || '—',
          REPORT_STAGE_META[row.stage].label,
          row.target,
          row.cutQty,
          row.parts.map((p) => `${getPartLabel(p)}: ${row.cutByPart[p] || 0}`).join(' | '),
          row.qcGood,
          row.qcDefect,
          row.printQty,
          row.sewingQty,
          row.completedSets,
          row.progress
        ])
      );
    } else if (activeTab === 'production') {
      if (aggregatedData.length === 0) {
        addFlashMessage('لا توجد حركات إنتاج للتصدير في النطاق الزمني المحدد', 'warning');
        return;
      }

      downloadCsv(
        `${selectedSection}-report-${selectedPeriod}-${new Date().toISOString().slice(0, 10)}.csv`,
        [
          'الفترة',
          'عدد الموديلات',
          'أكواد الموديلات',
          'إجمالي القطع',
          aggregatedData[0]?.secondaryLabel || 'مؤشر إضافي',
          'عدد العمليات',
          'المشرفون / الورش'
        ],
        aggregatedData.map((b) => [
          b.periodLabel,
          b.modelsCount,
          b.modelCodes.join(' / '),
          b.totalPieces,
          b.secondaryValue,
          b.operationsCount,
          b.operators.join(' / ')
        ])
      );
    } else {
      if (qualityByModel.length === 0) {
        addFlashMessage('لا توجد سجلات فرز للتصدير في النطاق الزمني المحدد', 'warning');
        return;
      }

      downloadCsv(
        `quality-report-${qualityStage}-${new Date().toISOString().slice(0, 10)}.csv`,
        [
          'كود الموديل',
          'نوع الموديل',
          'عدد حركات الفحص',
          'إجمالي المفحوص',
          'السليم',
          'الهالك والدرجة الثانية',
          'نسبة العيوب %'
        ],
        qualityByModel.map((row) => [
          row.label,
          row.sublabel || '—',
          row.modelsCount,
          row.inspected,
          row.good,
          row.defect,
          row.ratio
        ])
      );
    }

    addFlashMessage('تم تصدير التقرير بصيغة CSV بنجاح', 'success');
    logAction('تصدير تقرير', currentReportTitle);
  };

  const mainTabs: { key: MainTab; label: string; hint: string; icon: React.ElementType }[] = [
    { key: 'models', label: 'تقارير الموديلات', hint: 'المقاسات • المراحل • الإنجاز', icon: Boxes },
    { key: 'production', label: 'تقارير الإنتاج والسرعة', hint: 'قص • مطابع • مكن', icon: Factory },
    { key: 'quality', label: 'تقارير الفرز والعيوب', hint: 'الهالك • العيوب • الجودة', icon: ListChecks }
  ];

  const comparisonColor = (ratio: number) =>
    ratio >= 60 ? 'bg-emerald-500' : ratio >= 30 ? 'bg-amber-500' : 'bg-rose-500';

  /** جدول نسب العيوب القابل لإعادة الاستخدام (موديل / قطعة / مطبعة / ورشة) */
  const renderDefectTable = (
    title: string,
    subtitle: string,
    rows: DefectAggRow[],
    emptyLabel: string,
    accentClass: string
  ) => {
    const maxRatio = Math.max(...rows.map((r) => r.ratio), 1);

    return (
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50/60 print:bg-white print:border-b-2 print:border-slate-800">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-8 rounded-full ${accentClass}`}></span>
              <div>
                <h3 className="font-black text-slate-900 text-sm">{title}</h3>
                <p className="text-[11px] font-bold text-slate-500">{subtitle}</p>
              </div>
            </div>
            <span className="text-[11px] font-black text-slate-600 px-2 py-1 rounded-lg bg-white border border-slate-200">
              {rows.length} بند
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-start min-w-[620px]">
            <thead className="bg-slate-100 text-slate-700 font-extrabold border-b border-slate-200 print:bg-slate-200 print:text-black">
              <tr>
                <th className="px-4 py-3">البند</th>
                <th className="px-4 py-3 text-center">موديلات</th>
                <th className="px-4 py-3 text-center">مفحوص</th>
                <th className="px-4 py-3 text-center">سليم</th>
                <th className="px-4 py-3 text-center">تالف</th>
                <th className="px-4 py-3 text-center min-w-[160px]">نسبة العيوب</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length > 0 ? (
                rows.map((row) => (
                  <tr key={row.key} className="hover:bg-amber-50/30 transition">
                    <td className="px-4 py-3">
                      <div className="font-black text-slate-900">{row.label}</div>
                      {row.sublabel && (
                        <div className="text-[10px] font-bold text-slate-400">{row.sublabel}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center font-black font-mono text-slate-700">
                      {fmtNum(row.modelsCount)}
                    </td>
                    <td className="px-4 py-3 text-center font-black font-mono text-slate-900">
                      {fmtNum(row.inspected)}
                    </td>
                    <td className="px-4 py-3 text-center font-black font-mono text-emerald-700">
                      {fmtNum(row.good)}
                    </td>
                    <td className="px-4 py-3 text-center font-black font-mono text-rose-700">
                      {fmtNum(row.defect)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${accentClass}`}
                            style={{
                              width: `${Math.min(100, Math.round((row.ratio / maxRatio) * 100))}%`
                            }}
                          ></div>
                        </div>
                        <span
                          className={`font-black font-mono text-[11px] w-12 text-end ${
                            row.ratio >= 5
                              ? 'text-rose-700'
                              : row.ratio >= 2
                                ? 'text-amber-700'
                                : 'text-emerald-700'
                          }`}
                        >
                          {row.ratio}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center">
                    <div className="flex flex-col items-center gap-1.5">
                      <ListChecks className="w-7 h-7 text-slate-300 stroke-1" />
                      <p className="text-[11px] font-black text-slate-600">{emptyLabel}</p>
                      <p className="text-[10px] font-bold text-slate-400">
                        لا توجد سجلات فرز مطابقة للمرحلة أو الفترة المحددة.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>

            {rows.length > 0 && (
              <tfoot className="bg-slate-100/90 font-black text-slate-900 border-t-2 border-slate-300 print:bg-slate-200">
                <tr>
                  <td className="px-4 py-3">الإجمالي</td>
                  <td className="px-4 py-3 text-center font-mono">{fmtNum(rows.length)}</td>
                  <td className="px-4 py-3 text-center font-mono">
                    {fmtNum(rows.reduce((acc, r) => acc + r.inspected, 0))}
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-emerald-800">
                    {fmtNum(rows.reduce((acc, r) => acc + r.good, 0))}
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-rose-800">
                    {fmtNum(rows.reduce((acc, r) => acc + r.defect, 0))}
                  </td>
                  <td className="px-4 py-3 text-center font-mono">
                    {pctOf(
                      rows.reduce((acc, r) => acc + r.defect, 0),
                      rows.reduce((acc, r) => acc + r.inspected, 0)
                    )}
                    %
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <style>{`
        @media print {
          body { background: white !important; }
        }
      `}</style>

      {/* ------------------------- رأس الصفحة ------------------------- */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="bg-gradient-to-l from-slate-900 via-slate-800 to-slate-900 p-6 text-white relative overflow-hidden">
          <div className="absolute -left-10 -top-10 w-40 h-40 rounded-full bg-amber-500/10 blur-2xl"></div>
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
                <BarChart3 className="w-7 h-7 text-amber-400" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-black tracking-tight">{currentReportTitle}</h1>
                  <span className="px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-200 text-[10px] font-black border border-amber-400/30">
                    Reports Center
                  </span>
                </div>
                <p className="text-sm text-slate-300 font-medium mt-1 max-w-2xl">
                  {currentReportSubtitle}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 print:hidden">
              <button
                type="button"
                onClick={handlePrint}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white font-bold text-sm transition cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                طباعة
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm shadow-sm transition cursor-pointer"
              >
                <Download className="w-4 h-4" />
                تصدير CSV
              </button>
            </div>
          </div>
        </div>

        {/* التبويبات الرئيسية */}
        <div className="p-3 bg-slate-50/70 border-t border-slate-100 print:hidden">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {mainTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;

              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.key);
                    setDateFrom('');
                    setDateTo('');
                  }}
                  className={`flex items-center gap-3 p-3 rounded-2xl border text-start transition cursor-pointer ${
                    isActive
                      ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <span
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                      isActive
                        ? 'bg-white/10 border-white/20 text-amber-300'
                        : 'bg-slate-100 border-slate-200 text-slate-600'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-black text-sm truncate">{tab.label}</span>
                    <span
                      className={`block text-[11px] font-semibold truncate ${
                        isActive ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {tab.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* --------------------- تبويب 1: تقارير الموديلات --------------------- */}
      {activeTab === 'models' && (
        <>
          <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs space-y-3 print:hidden">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-500" />
                <h3 className="font-black text-slate-900 text-sm">تصفية تقارير الموديلات</h3>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-black border border-slate-200">
                  {filteredModelRows.length} من {activeModels.length}
                </span>
              </div>
              <button
                type="button"
                onClick={resetModelFilters}
                className="text-[11px] font-black text-slate-500 hover:text-slate-900 px-2.5 py-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                إعادة تعيين الفلاتر
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
                <input
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  placeholder="بحث بكود الموديل أو النوع..."
                  className="w-full pr-9 pl-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50/60 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:bg-white"
                />
              </div>

              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50/60 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:bg-white cursor-pointer"
              >
                <option value="all">كل أنواع الموديلات</option>
                {modelTypeOptions.map((t) => (
                  <option key={String(t)} value={String(t)}>
                    {String(t)}
                  </option>
                ))}
              </select>

              <select
                value={compositionFilter}
                onChange={(e) => setCompositionFilter(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50/60 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:bg-white cursor-pointer"
              >
                <option value="all">كل التركيبات</option>
                {GARMENT_COMPOSITION_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {GARMENT_COMPOSITION_LABELS[c]}
                  </option>
                ))}
              </select>

              <select
                value={sizeFilter}
                onChange={(e) => setSizeFilter(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50/60 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:bg-white cursor-pointer"
              >
                <option value="all">كل المقاسات</option>
                {modelSizeOptions.map((s) => (
                  <option key={s} value={s}>
                    مقاس {s}
                  </option>
                ))}
              </select>

              <select
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value as 'all' | ReportStageKey)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50/60 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:bg-white cursor-pointer"
              >
                <option value="all">كل المراحل الحالية</option>
                {REPORT_STAGE_ORDER.map((k) => (
                  <option key={k} value={k}>
                    {REPORT_STAGE_META[k].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* مؤشرات عامة */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black text-slate-500">موديلات في التقرير</span>
                <span className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center">
                  <Boxes className="w-4 h-4 text-slate-600" />
                </span>
              </div>
              <div className="mt-2 text-2xl font-black text-slate-900 font-mono">
                {fmtNum(filteredModelRows.length)}
              </div>
              <p className="text-[11px] font-bold text-slate-500 mt-1">
                منها {fmtNum(modelSummary.modelsWithData)} موديل بها حركات إنتاج
              </p>
            </div>

            <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black text-slate-500">إجمالي المستهدف</span>
                <span className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center">
                  <Target className="w-4 h-4 text-amber-600" />
                </span>
              </div>
              <div className="mt-2 text-2xl font-black text-slate-900 font-mono">
                {fmtNum(modelSummary.target)}
              </div>
              <p className="text-[11px] font-bold text-slate-500 mt-1">
                نسبة القص {pctOf(modelSummary.cut, modelSummary.target, true)}% من المستهدف
              </p>
            </div>

            <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black text-slate-500">إجمالي القص الفعلي</span>
                <span className="w-9 h-9 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center">
                  <Scissors className="w-4 h-4 text-rose-600" />
                </span>
              </div>
              <div className="mt-2 text-2xl font-black text-rose-700 font-mono">
                {fmtNum(modelSummary.cut)}
              </div>
              <p className="text-[11px] font-bold text-slate-500 mt-1">
                مطابع {fmtNum(modelSummary.print)} • مكن {fmtNum(modelSummary.sewing)}
              </p>
            </div>

            <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black text-slate-500">أطقم مكتملة</span>
                <span className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                </span>
              </div>
              <div className="mt-2 text-2xl font-black text-emerald-700 font-mono">
                {fmtNum(modelSummary.sets)}
              </div>
              <p className="text-[11px] font-bold text-slate-500 mt-1">
                فرز سليم: {fmtNum(modelSummary.qcGood)} • هالك: {fmtNum(modelSummary.qcDefect)}
              </p>
            </div>
          </div>

          {/* توزيع المراحل */}
          <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs space-y-3 print:hidden">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-slate-500" />
                <h3 className="font-black text-slate-900 text-sm">
                  توزيع الموديلات على مراحل التشغيل
                </h3>
              </div>
              {stageFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => setStageFilter('all')}
                  className="text-[11px] font-black text-amber-700 hover:text-amber-900 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 transition cursor-pointer"
                >
                  إلغاء تصفية المرحلة
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setStageFilter('all')}
                className={`flex items-center gap-2 px-3 py-2 rounded-2xl border text-xs font-black transition cursor-pointer ${
                  stageFilter === 'all'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                كل المراحل
                <span
                  className={`px-1.5 py-0.5 rounded-lg text-[10px] font-black ${
                    stageFilter === 'all' ? 'bg-white/15 text-white' : 'bg-white text-slate-700'
                  }`}
                >
                  {filteredModelRows.length}
                </span>
              </button>

              {REPORT_STAGE_ORDER.map((key) => {
                const meta = REPORT_STAGE_META[key];
                const count = modelSummary.stageCounts[key];
                const isActive = stageFilter === key;

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setStageFilter(isActive ? 'all' : key)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-2xl border text-xs font-black transition cursor-pointer ${
                      isActive ? 'bg-slate-900 text-white border-slate-900' : `${meta.badge} hover:opacity-80`
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-white' : meta.dot}`}></span>
                    {meta.short}
                    <span
                      className={`px-1.5 py-0.5 rounded-lg text-[10px] font-black ${
                        isActive ? 'bg-white/15 text-white' : 'bg-white/70 text-slate-700'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* جدول تقارير الموديلات */}
          <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap bg-slate-50/60 print:bg-white print:border-b-2 print:border-slate-800">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-slate-700" />
                <div>
                  <h3 className="font-black text-slate-900 text-base">تفاصيل تقرير الموديلات</h3>
                  <p className="text-[11px] font-bold text-slate-500">
                    المستهدف • القص • الفرز • المطابع • المكن • الإنجاز لكل موديل بالقطعة
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-black text-slate-600 px-2.5 py-1 rounded-lg bg-white border border-slate-200">
                {filteredModelRows.length} موديل
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-start min-w-[1150px]">
                <thead className="bg-slate-100 text-slate-700 font-extrabold border-b border-slate-200 print:bg-slate-200 print:text-black">
                  <tr>
                    <th className="px-4 py-3.5">الموديل</th>
                    <th className="px-4 py-3.5">التركيبة</th>
                    <th className="px-4 py-3.5">المقاسات</th>
                    <th className="px-4 py-3.5 text-center">المرحلة الحالية</th>
                    <th className="px-4 py-3.5 text-center">المستهدف</th>
                    <th className="px-4 py-3.5 text-center">القص الفعلي</th>
                    <th className="px-4 py-3.5 text-center">الفرز السليم</th>
                    <th className="px-4 py-3.5 text-center">الهالك</th>
                    <th className="px-4 py-3.5 text-center">المطابع</th>
                    <th className="px-4 py-3.5 text-center">المكن</th>
                    <th className="px-4 py-3.5 text-center">أطقم مكتملة</th>
                    <th className="px-4 py-3.5 text-center">نسبة الإنجاز</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredModelRows.length > 0 ? (
                    filteredModelRows.map((row) => (
                      <tr key={row.model.id} className="hover:bg-amber-50/30 transition align-top">
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2">
                            <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                              {row.model.image ? (
                                <img
                                  src={row.model.image}
                                  alt={row.model.model_code}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <Shirt className="w-4 h-4 text-slate-400" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="font-black text-slate-900 text-sm">
                                {row.model.model_code}
                              </div>
                              <div className="text-[11px] font-bold text-slate-500 truncate max-w-[130px]">
                                {row.model.model_type || '—'}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-3.5">
                          <div className="font-bold text-slate-700 text-[11px] max-w-[150px]">
                            {row.compositionLabel}
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {row.parts.map((p) => (
                              <span
                                key={p}
                                className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 text-[10px] font-black"
                              >
                                {getPartLabel(p)}
                              </span>
                            ))}
                          </div>
                        </td>

                        <td className="px-4 py-3.5">
                          {row.sizes.length > 0 ? (
                            <div className="flex flex-wrap gap-1 max-w-[150px]">
                              {row.sizes.map((size) => (
                                <span
                                  key={size}
                                  className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-black"
                                >
                                  {size}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-400 font-bold text-[11px]">غير محددة</span>
                          )}
                        </td>

                        <td className="px-4 py-3.5 text-center">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-black ${
                              REPORT_STAGE_META[row.stage].badge
                            }`}
                            title={row.model.status}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${REPORT_STAGE_META[row.stage].dot}`}
                            ></span>
                            {REPORT_STAGE_META[row.stage].short}
                          </span>
                        </td>

                        <td className="px-4 py-3.5 text-center">
                          <div className="font-black font-mono text-slate-900">
                            {fmtNum(row.target)}
                          </div>
                          <div className="text-[10px] font-bold text-slate-400">قطعة</div>
                        </td>

                        <td className="px-4 py-3.5 text-center">
                          <div className="font-black font-mono text-rose-700 text-sm">
                            {fmtNum(row.cutQty)}
                          </div>
                          <div className="flex flex-wrap gap-1 justify-center mt-1">
                            {row.parts.map((p) => (
                              <span
                                key={p}
                                className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-100 text-[10px] font-black"
                                title={`${getPartLabel(p)}: ${fmtNum(row.cutByPart[p] || 0)}`}
                              >
                                {getPartLabel(p)}: {fmtNum(row.cutByPart[p] || 0)}
                              </span>
                            ))}
                          </div>
                        </td>

                        <td className="px-4 py-3.5 text-center">
                          <div className="font-black font-mono text-emerald-700 text-sm">
                            {fmtNum(row.qcGood)}
                          </div>
                          <div className="flex flex-wrap gap-1 justify-center mt-1">
                            {row.parts.map((p) => (
                              <span
                                key={p}
                                className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100 text-[10px] font-black"
                              >
                                {getPartLabel(p)}: {fmtNum(row.qcByPart[p] || 0)}
                              </span>
                            ))}
                          </div>
                        </td>

                        <td className="px-4 py-3.5 text-center">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-black ${
                              row.qcDefect > 0
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : 'bg-slate-50 text-slate-500 border-slate-200'
                            }`}
                          >
                            {fmtNum(row.qcDefect)}
                          </span>
                        </td>

                        <td className="px-4 py-3.5 text-center">
                          <div className="font-black font-mono text-indigo-700">
                            {fmtNum(row.printQty)}
                          </div>
                          <div className="text-[10px] font-bold text-slate-400">قطعة</div>
                        </td>

                        <td className="px-4 py-3.5 text-center">
                          <div className="font-black font-mono text-emerald-700">
                            {fmtNum(row.sewingQty)}
                          </div>
                          <div className="text-[10px] font-bold text-slate-400">قطعة</div>
                        </td>

                        <td className="px-4 py-3.5 text-center">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-teal-50 text-teal-800 border border-teal-200 text-[11px] font-black">
                            <CheckCircle className="w-3 h-3" />
                            {fmtNum(row.completedSets)}
                          </span>
                        </td>

                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2 min-w-[110px]">
                            <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${comparisonColor(row.progress)}`}
                                style={{ width: `${Math.min(100, Math.max(0, row.progress))}%` }}
                              ></div>
                            </div>
                            <span className="font-black font-mono text-[11px] text-slate-700 w-10 text-end">
                              {row.progress}%
                            </span>
                          </div>
                          <div className="text-[10px] font-bold text-slate-400 mt-1">
                            من المستهدف ({fmtNum(row.target)})
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={12} className="px-6 py-14 text-center">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <Search className="w-8 h-8 text-slate-300 stroke-1" />
                          <p className="font-black text-slate-700 text-sm">
                            لا توجد موديلات مطابقة لمعايير التصفية
                          </p>
                          <p className="text-[11px] font-bold text-slate-400">
                            جرب إزالة بعض الفلاتر أو البحث بكود موديل آخر.
                          </p>
                          <button
                            type="button"
                            onClick={resetModelFilters}
                            className="mt-1 px-3 py-1.5 rounded-xl bg-slate-900 text-white text-[11px] font-black hover:bg-slate-800 transition cursor-pointer print:hidden"
                          >
                            إعادة تعيين الفلاتر
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>

                {filteredModelRows.length > 0 && (
                  <tfoot className="bg-slate-100/90 font-black text-slate-900 border-t-2 border-slate-300 print:bg-slate-200">
                    <tr>
                      <td className="px-4 py-4 text-sm font-black" colSpan={3}>
                        الإجمالي ({filteredModelRows.length} موديل)
                      </td>
                      <td className="px-4 py-4 text-center text-[11px] text-slate-600">
                        {modelSummary.stageCounts.completed} مكتمل
                      </td>
                      <td className="px-4 py-4 text-center font-mono text-sm">
                        {fmtNum(modelSummary.target)}
                      </td>
                      <td className="px-4 py-4 text-center font-mono text-sm text-rose-800">
                        {fmtNum(modelSummary.cut)}
                      </td>
                      <td className="px-4 py-4 text-center font-mono text-sm text-emerald-800">
                        {fmtNum(modelSummary.qcGood)}
                      </td>
                      <td className="px-4 py-4 text-center font-mono text-sm text-rose-800">
                        {fmtNum(modelSummary.qcDefect)}
                      </td>
                      <td className="px-4 py-4 text-center font-mono text-sm text-indigo-800">
                        {fmtNum(modelSummary.print)}
                      </td>
                      <td className="px-4 py-4 text-center font-mono text-sm text-emerald-800">
                        {fmtNum(modelSummary.sewing)}
                      </td>
                      <td className="px-4 py-4 text-center font-mono text-sm text-teal-800">
                        {fmtNum(modelSummary.sets)}
                      </td>
                      <td className="px-4 py-4 text-center font-mono text-sm">
                        {pctOf(modelSummary.cut, modelSummary.target, true)}%
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}

      {/* ------------------ تبويب 2: تقارير الإنتاج والسرعة ------------------ */}
      {activeTab === 'production' && (
        <>
          <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs space-y-4 print:hidden">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(['cutting', 'printing', 'sewing'] as ProductionSection[]).map((key) => {
                const meta = productionSectionMeta[key];
                const Icon = meta.icon;
                const isActive = selectedSection === key;

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setSelectedSection(key);
                      setDateFrom('');
                      setDateTo('');
                    }}
                    className={`flex items-center gap-3 p-3 rounded-2xl border text-start transition cursor-pointer ${
                      isActive
                        ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span
                      className={`w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 ${
                        isActive ? 'bg-white/10 border-white/20 text-amber-300' : meta.iconClass
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-black text-sm truncate">{meta.title}</span>
                      <span
                        className={`block text-[11px] font-semibold truncate ${
                          isActive ? 'text-slate-300' : 'text-slate-500'
                        }`}
                      >
                        {meta.subtitle}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col lg:flex-row lg:items-end gap-3 pt-1">
              <div className="space-y-1.5">
                <span className="flex items-center gap-1.5 text-[11px] font-black text-slate-600">
                  <Calendar className="w-3.5 h-3.5" />
                  فترة التجميع
                </span>
                <div className="bg-slate-100 p-1.5 rounded-2xl flex gap-1">
                  {(
                    [
                      { key: 'daily', label: 'يومي' },
                      { key: 'weekly', label: 'أسبوعي' },
                      { key: 'monthly', label: 'شهري' }
                    ] as { key: ReportPeriod; label: string }[]
                  ).map((period) => (
                    <button
                      key={period.key}
                      type="button"
                      onClick={() => setSelectedPeriod(period.key)}
                      className={`px-4 py-1.5 rounded-xl text-xs font-black transition cursor-pointer ${
                        selectedPeriod === period.key
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {period.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 flex-1">
                <label className="space-y-1.5">
                  <span className="block text-[11px] font-black text-slate-600">من تاريخ</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50/60 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:bg-white"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="block text-[11px] font-black text-slate-600">إلى تاريخ</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50/60 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:bg-white"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={resetTimeFilters}
                className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black transition cursor-pointer"
              >
                عرض كل الفترات
              </button>
            </div>
          </div>

          {/* مؤشرات الإنتاج */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black text-slate-500">إجمالي القطع</span>
                <span className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center">
                  <Boxes className="w-4 h-4 text-slate-600" />
                </span>
              </div>
              <div className="mt-2 text-2xl font-black text-slate-900 font-mono">
                {fmtNum(overallSummary.totalPieces)}
              </div>
              <p className="text-[11px] font-bold text-slate-500 mt-1">
                على مدار {rangeDays} يوم عمل بالنطاق المحدد
              </p>
            </div>

            <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black text-slate-500">متوسط الإنتاج اليومي</span>
                <span className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center">
                  <Gauge className="w-4 h-4 text-amber-600" />
                </span>
              </div>
              <div className="mt-2 text-2xl font-black text-amber-700 font-mono">
                {fmtNum(overallSummary.avgPerBucket)}
              </div>
              <p className="text-[11px] font-bold text-slate-500 mt-1">
                لكل فترة {periodLabelAr.replace('تجميع ', '')}
              </p>
            </div>

            <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black text-slate-500">عدد عمليات التشغيل</span>
                <span className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center">
                  <Factory className="w-4 h-4 text-indigo-600" />
                </span>
              </div>
              <div className="mt-2 text-2xl font-black text-indigo-700 font-mono">
                {fmtNum(overallSummary.totalOperations)}
              </div>
              <p className="text-[11px] font-bold text-slate-500 mt-1">
                {sectionMeta.title.replace('تقرير ', '')}
              </p>
            </div>

            <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black text-slate-500">موديلات وفترات</span>
                <span className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-emerald-600" />
                </span>
              </div>
              <div className="mt-2 text-2xl font-black text-emerald-700 font-mono">
                {fmtNum(overallSummary.totalModels)}
                <span className="text-sm text-slate-400 font-bold"> موديل</span>
              </div>
              <p className="text-[11px] font-bold text-slate-500 mt-1">
                موزعة على {fmtNum(overallSummary.bucketsCount)} فترة مجمعة
              </p>
            </div>
          </div>

          {/* سرعة الأقسام */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {(['cutting', 'printing', 'sewing'] as ProductionSection[]).map((key) => {
              const meta = productionSectionMeta[key];
              const Icon = meta.icon;
              const speed = productionSpeed[key];
              const maxPerDay = Math.max(
                productionSpeed.cutting.perDay,
                productionSpeed.printing.perDay,
                productionSpeed.sewing.perDay,
                1
              );
              const fillPct = Math.min(100, Math.round((speed.perDay / maxPerDay) * 100));
              const isCurrent = selectedSection === key;

              return (
                <div
                  key={key}
                  className={`bg-white p-4 rounded-3xl border shadow-xs space-y-3 ${
                    isCurrent ? 'border-slate-900/20 ring-2 ring-amber-400/30' : 'border-slate-200/80'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-9 h-9 rounded-xl border flex items-center justify-center ${meta.iconClass}`}
                      >
                        <Icon className="w-4 h-4" />
                      </span>
                      <div>
                        <h4 className="font-black text-slate-900 text-sm">
                          {meta.title.replace('تقرير ', '')}
                        </h4>
                        <p className="text-[10px] font-bold text-slate-500">معدل السرعة الفعلي</p>
                      </div>
                    </div>
                    <Gauge className="w-4 h-4 text-slate-300" />
                  </div>

                  <div className="flex items-end gap-1">
                    <span className="text-2xl font-black font-mono text-slate-900">
                      {fmtNum(speed.perDay)}
                    </span>
                    <span className="text-[11px] font-black text-slate-500 mb-1">قطعة / يوم</span>
                  </div>

                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full rounded-full ${meta.accent}`} style={{ width: `${fillPct}%` }}></div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="bg-slate-50 rounded-xl border border-slate-100 p-2">
                      <span className="block text-[10px] font-bold text-slate-500">إجمالي القطع</span>
                      <span className="block font-black font-mono text-slate-900 text-sm">
                        {fmtNum(speed.pieces)}
                      </span>
                    </div>
                    <div className="bg-slate-50 rounded-xl border border-slate-100 p-2">
                      <span className="block text-[10px] font-bold text-slate-500">عدد العمليات</span>
                      <span className="block font-black font-mono text-slate-900 text-sm">
                        {fmtNum(speed.operations)}
                      </span>
                    </div>
                    <div className="bg-slate-50 rounded-xl border border-slate-100 p-2 col-span-2">
                      <span className="block text-[10px] font-bold text-slate-500">
                        متوسط القطع لكل عملية
                      </span>
                      <span className="block font-black font-mono text-slate-900 text-sm">
                        {fmtNum(speed.perOperation)} قطعة
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* متوسط زمن المراحل */}
          <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Timer className="w-4 h-4 text-slate-500" />
                <h3 className="font-black text-slate-900 text-sm">
                  متوسط زمن المراحل (من سجل تتبع الموديلات)
                </h3>
              </div>
              <span className="text-[11px] font-bold text-slate-500">
                عدد الموديلات المحللة: {fmtNum(activeModels.length)}
              </span>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {(
                [
                  {
                    key: 'cutting' as const,
                    title: 'التصميم ← القص',
                    cls: 'text-rose-700 bg-rose-50 border-rose-200'
                  },
                  {
                    key: 'printing' as const,
                    title: 'القص ← المطابع',
                    cls: 'text-indigo-700 bg-indigo-50 border-indigo-200'
                  },
                  {
                    key: 'sewing' as const,
                    title: 'المطابع ← المكن',
                    cls: 'text-emerald-700 bg-emerald-50 border-emerald-200'
                  },
                  {
                    key: 'final' as const,
                    title: 'المكن ← الفرز النهائي',
                    cls: 'text-amber-700 bg-amber-50 border-amber-200'
                  }
                ]
              ).map((item) => {
                const data = stageDurations[item.key];

                return (
                  <div
                    key={item.key}
                    className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 space-y-1.5"
                  >
                    <span className="block text-[11px] font-black text-slate-600">{item.title}</span>
                    <div className={`inline-flex px-2.5 py-1 rounded-xl border font-black text-sm ${item.cls}`}>
                      {formatDuration(data.avg)}
                    </div>
                    <span className="block text-[10px] font-bold text-slate-500">
                      {data.count > 0
                        ? `متوسط محسوب من ${fmtNum(data.count)} موديل`
                        : 'لا توجد أحداث كافية'}
                    </span>
                  </div>
                );
              })}
            </div>

            <p className="text-[10px] font-bold text-slate-400 leading-relaxed">
              * يتم احتساب المتوسط من أحداث التتبع المسجلة فعليًا لكل موديل، وتظهر «—» عند عدم توفر
              الأحداث اللازمة لحساب المدة.
            </p>
          </div>

          <AggregationTable
            buckets={aggregatedData}
            summary={overallSummary}
            title={sectionMeta.title}
            periodLabel={periodLabelAr}
            secondaryFallback="—"
            emptyTitle={`لا توجد حركات مسجلة في ${sectionMeta.title.replace('تقرير ', '')} خلال هذه الفترة`}
          />
        </>
      )}

      {/* ------------------ تبويب 3: تقارير الفرز والعيوب ------------------ */}
      {activeTab === 'quality' && (
        <>
          <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs space-y-4 print:hidden">
            <div className="flex flex-col lg:flex-row lg:items-end gap-3">
              <div className="space-y-1.5 flex-1">
                <span className="flex items-center gap-1.5 text-[11px] font-black text-slate-600">
                  <ListChecks className="w-3.5 h-3.5" />
                  مرحلة الفرز
                </span>
                <div className="flex flex-wrap gap-2">
                  {(
                    ['all', 'before_print', 'after_print', 'after_sewing'] as QualityStageFilter[]
                  ).map((stage) => (
                    <button
                      key={stage}
                      type="button"
                      onClick={() => setQualityStage(stage)}
                      className={`px-3.5 py-2 rounded-xl border text-xs font-black transition cursor-pointer ${
                        qualityStage === stage
                          ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {QC_STAGE_LABELS[stage]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 lg:w-[320px]">
                <label className="space-y-1.5">
                  <span className="block text-[11px] font-black text-slate-600">من تاريخ</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50/60 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:bg-white"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="block text-[11px] font-black text-slate-600">إلى تاريخ</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50/60 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:bg-white"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={() => {
                  resetTimeFilters();
                  setQualityStage('all');
                }}
                className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black transition cursor-pointer"
              >
                إعادة تعيين
              </button>
            </div>
          </div>

          {/* مؤشرات الجودة */}
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
            <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black text-slate-500">القطع المفحوصة</span>
                <span className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center">
                  <Search className="w-4 h-4 text-slate-600" />
                </span>
              </div>
              <div className="mt-2 text-2xl font-black text-slate-900 font-mono">
                {fmtNum(qualitySummary.inspected)}
              </div>
              <p className="text-[11px] font-bold text-slate-500 mt-1">إجمالي ما تم فحصه</p>
            </div>

            <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black text-slate-500">القطع السليمة</span>
                <span className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                </span>
              </div>
              <div className="mt-2 text-2xl font-black text-emerald-700 font-mono">
                {fmtNum(qualitySummary.good)}
              </div>
              <p className="text-[11px] font-bold text-slate-500 mt-1">
                {pctOf(qualitySummary.good, qualitySummary.inspected)}% من المفحوص
              </p>
            </div>

            <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black text-slate-500">القطع التالفة</span>
                <span className="w-9 h-9 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                </span>
              </div>
              <div className="mt-2 text-2xl font-black text-rose-700 font-mono">
                {fmtNum(qualitySummary.defect)}
              </div>
              <p className="text-[11px] font-bold text-slate-500 mt-1">هالك + درجة ثانية</p>
            </div>

            <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black text-slate-500">نسبة العيوب</span>
                <span className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center">
                  <Percent className="w-4 h-4 text-amber-600" />
                </span>
              </div>
              <div className="mt-2 text-2xl font-black text-amber-700 font-mono">
                {qualitySummary.ratio}%
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    qualitySummary.ratio >= 5
                      ? 'bg-rose-500'
                      : qualitySummary.ratio >= 2
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(100, qualitySummary.ratio * 5)}%` }}
                ></div>
              </div>
            </div>

            <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black text-slate-500">سجلات الفحص</span>
                <span className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center">
                  <ClipboardList className="w-4 h-4 text-indigo-600" />
                </span>
              </div>
              <div className="mt-2 text-2xl font-black text-indigo-700 font-mono">
                {fmtNum(qualitySummary.records)}
              </div>
              <p className="text-[11px] font-bold text-slate-500 mt-1">
                {QC_STAGE_LABELS[qualityStage]}
              </p>
            </div>
          </div>

          {/* جداول نسب العيوب */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {renderDefectTable(
              'نسب العيوب حسب الموديل',
              'ترتيب الموديلات حسب عدد القطع التالفة ونسبة العيوب من إجمالي المفحوص.',
              qualityByModel,
              'لا توجد عيوب مسجلة على مستوى الموديلات',
              'bg-rose-500'
            )}
            {renderDefectTable(
              'نسب العيوب حسب القطعة',
              'مقارنة التيشرت والبنطلون وبقية القطع في معدلات الهالك والدرجة الثانية.',
              qualityByPart,
              'لا توجد عيوب مسجلة على مستوى القطع',
              'bg-indigo-500'
            )}
            {renderDefectTable(
              'نسب العيوب حسب المطبعة',
              'تقييم أداء المطابع بناءً على نسبة القطع التالفة المكتشفة في الفرز.',
              qualityByPrintHouse,
              'لا توجد بيانات مطابع مرتبطة بسجلات الفرز',
              'bg-violet-500'
            )}
            {renderDefectTable(
              'نسب العيوب حسب ورشة المكن',
              'تقييم أداء ورش الخياطة بناءً على نسبة العيوب المكتشفة بعد المكن.',
              qualityByWorkshop,
              'لا توجد بيانات ورش مرتبطة بسجلات الفرز',
              'bg-emerald-500'
            )}
          </div>

          {/* سجل عمليات الفحص */}
          <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2 flex-wrap print:bg-white print:border-b-2 print:border-slate-800">
              <div className="flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-slate-700" />
                <div>
                  <h3 className="font-black text-slate-900 text-sm">سجل عمليات الفحص التفصيلي</h3>
                  <p className="text-[11px] font-bold text-slate-500">
                    أحدث سجلات الفرز مع الكميات السليمة والتالفة وملاحظات العيوب
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-black text-slate-600 px-2.5 py-1 rounded-lg bg-white border border-slate-200">
                {fmtNum(qualityRecords.length)} سجل
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-start min-w-[900px]">
                <thead className="bg-slate-100 text-slate-700 font-extrabold border-b border-slate-200 print:bg-slate-200 print:text-black">
                  <tr>
                    <th className="px-4 py-3">التاريخ</th>
                    <th className="px-4 py-3">الموديل</th>
                    <th className="px-4 py-3">المرحلة</th>
                    <th className="px-4 py-3">القطعة</th>
                    <th className="px-4 py-3">اللون / المقاس</th>
                    <th className="px-4 py-3 text-center">مفحوص</th>
                    <th className="px-4 py-3 text-center">سليم</th>
                    <th className="px-4 py-3 text-center">تالف</th>
                    <th className="px-4 py-3 text-center">النسبة</th>
                    <th className="px-4 py-3">مسؤول الجودة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {qualityRecords.length > 0 ? (
                    [...qualityRecords]
                      .sort((a, b) =>
                        String(b.created_at || '').localeCompare(String(a.created_at || ''))
                      )
                      .slice(0, 60)
                      .map((rec) => {
                        const { good, defect, inspected } = qualityRecordValues(rec);
                        const modelCode =
                          models.find((m) => m.id === rec.model_id)?.model_code || 'موديل';
                        const ratio = pctOf(defect, inspected);

                        return (
                          <tr key={rec.id} className="hover:bg-amber-50/30 transition">
                            <td className="px-4 py-3 font-bold text-slate-600 whitespace-nowrap">
                              {rec.created_at
                                ? new Date(rec.created_at).toLocaleDateString('ar-EG')
                                : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-black text-slate-900">{modelCode}</div>
                              {(rec.defect_notes || rec.notes) && (
                                <div className="text-[10px] font-bold text-rose-600 max-w-[180px] truncate">
                                  {rec.defect_notes || rec.notes}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-[10px] font-black text-slate-700">
                                {QC_STAGE_LABELS[
                                  (rec.stage || 'after_sewing') as QualityStageFilter
                                ] || 'فرز'}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-bold text-slate-700">
                              {getPartLabel(rec.part_type || rec.partType)}
                            </td>
                            <td className="px-4 py-3 font-bold text-slate-600">
                              {rec.color_name || '—'} / {rec.size || '—'}
                            </td>
                            <td className="px-4 py-3 text-center font-black font-mono text-slate-900">
                              {fmtNum(inspected)}
                            </td>
                            <td className="px-4 py-3 text-center font-black font-mono text-emerald-700">
                              {fmtNum(good)}
                            </td>
                            <td className="px-4 py-3 text-center font-black font-mono text-rose-700">
                              {fmtNum(defect)}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span
                                className={`px-2 py-0.5 rounded-lg border text-[10px] font-black ${
                                  ratio >= 5
                                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                                    : ratio >= 2
                                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                                      : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                }`}
                              >
                                {ratio}%
                              </span>
                            </td>
                            <td className="px-4 py-3 font-bold text-slate-700">
                              {rec.inspector_name || '—'}
                            </td>
                          </tr>
                        );
                      })
                  ) : (
                    <tr>
                      <td colSpan={10} className="px-6 py-12 text-center">
                        <div className="flex flex-col items-center gap-1.5">
                          <AlertCircle className="w-8 h-8 text-slate-300 stroke-1" />
                          <p className="font-black text-slate-700 text-sm">
                            لا توجد سجلات فرز في هذه المرحلة أو الفترة
                          </p>
                          <p className="text-[11px] font-bold text-slate-400">
                            اختر مرحلة فرز أخرى أو وسّع نطاق التاريخ لعرض النتائج.
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {qualityRecords.length > 60 && (
              <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-100 text-[10px] font-bold text-slate-500">
                يتم عرض أحدث 60 سجل من إجمالي {fmtNum(qualityRecords.length)} سجل — استخدم تصدير CSV
                للحصول على القائمة الكاملة.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
