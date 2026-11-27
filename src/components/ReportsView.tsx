import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  BarChart3,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Factory,
  Flame,
  Gauge,
  Layers,
  Loader2,
  Minus,
  Package,
  Printer,
  RefreshCw,
  Scissors,
  Search,
  Settings2,
  Shirt,
  Sparkles,
  Star,
  Target,
  TrendingDown,
  TrendingUp,
  X
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { MaterialsReportSection, ModelConsumptionReportSection } from './MaterialsAndModelConsumptionReports';
import type { StageNavigateFn } from '../utils/stageNavigation';
import { datedFileName, exportCsv } from '../utils/exportExcel';
import {
  escapeHtml,
  logClientPrintAction,
  openUnifiedPrintWindow,
  renderSignatureBar
} from '../utils/printShared';
import type {
  DepartmentReportCard,
  DepartmentTargetsMap,
  ModelsReportResponse,
  ModelStageWaterfallResponse,
  ProductionDepartmentsResponse,
  QualityShortageResponse,
  StageLossKey,
  WorkshopEvaluationsReportResponse
} from '../types';

/* ------------------------------------------------------------------ */
/* Types & constants                                                   */
/* ------------------------------------------------------------------ */

type ReportTab =
  | 'models'
  | 'production'
  | 'quality'
  | 'materials'
  | 'model_consumption'
  | 'workshop_evaluations';
type MetricMode = 'models' | 'pieces';
type PeriodKey = 'today' | 'week' | 'month' | 'custom';
type SortKey = 'shortage' | 'percent' | 'cut' | 'code' | 'loss';
type EvalCategoryFilter = 'all' | 'printing' | 'sewing' | 'finishing';

const BOYS_COLOR = '#3B82F6';
const GIRLS_COLOR = '#EC4899';

// تسميات قيم فلتر التكوين (تشمل القيم المفردة القادمة من كارت التكوين).
const COMPOSITION_FILTER_LABELS: Record<string, string> = {
  one_piece: 'قطعة واحدة',
  tshirt_only: 'تيشيرت فقط',
  pants_only: 'بنطلون فقط',
  two_pieces: 'قطعتان',
  three_pieces: 'ثلاث قطع'
};

// تسميات المراحل الـ 12 بالترتيب الكامل.
const STAGE_FILTER_LABELS: Record<string, string> = {
  design: 'التصميم',
  cutting: 'القص',
  qc_before_print: 'العد قبل الطباعة',
  printing: 'المطابع والتطريز',
  qc_after_print: 'العد بعد الطباعة',
  sewing: 'المكن والخياطة',
  qc_after_sewing: 'العد بعد المكن',
  finishing: 'التشطيب',
  ironing: 'المكواة',
  packaging: 'التعبئة والتغليف',
  dest: 'الدَست',
  completed: 'مخزن الإنتاج التام'
};

/** بيانات عرض مراحل الفقد الأربع في تبويب "المشاكل والعجز". */
const STAGE_LOSS_META: Array<{
  key: StageLossKey;
  label: string;
  short: string;
  icon: React.ComponentType<{ className?: string }>;
  gradient: string;
  badge: string;
  ring: string;
}> = [
  {
    key: 'cutting',
    label: 'القص والفرز قبل الطباعة',
    short: 'قص وفرز',
    icon: Scissors,
    gradient: 'from-rose-500 to-rose-600',
    badge: 'border-rose-200 bg-rose-50 text-rose-700',
    ring: 'ring-rose-400/60'
  },
  {
    key: 'printing',
    label: 'الطباعة',
    short: 'طباعة',
    icon: Printer,
    gradient: 'from-blue-500 to-indigo-600',
    badge: 'border-blue-200 bg-blue-50 text-blue-700',
    ring: 'ring-blue-400/60'
  },
  {
    key: 'embroidery',
    label: 'التطريز',
    short: 'تطريز',
    icon: Sparkles,
    gradient: 'from-amber-500 to-orange-600',
    badge: 'border-amber-200 bg-amber-50 text-amber-700',
    ring: 'ring-amber-400/60'
  },
  {
    key: 'sewing',
    label: 'الخياطة (المكن)',
    short: 'خياطة',
    icon: Shirt,
    gradient: 'from-emerald-500 to-teal-600',
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    ring: 'ring-emerald-400/60'
  }
];

const TAB_META: Array<{
  key: ReportTab;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    key: 'models',
    label: 'الموديلات حسب المقاس',
    description: 'توزيع الموديلات والقطع ولادي / بناتي',
    icon: Boxes
  },
  {
    key: 'production',
    label: 'الإنتاج والسرعة',
    description: 'أرقام كل قسم ومقارنتها بالتارجت',
    icon: Gauge
  },
  {
    key: 'quality',
    label: 'المشاكل والعجز',
    description: 'الفاقد والعجز بين مراحل الإنتاج',
    icon: AlertTriangle
  },
  {
    key: 'materials',
    label: 'تقارير الخامات',
    description: 'الأقمشة والإكسسوارات والاستهلاك',
    icon: Layers
  },
  {
    key: 'model_consumption',
    label: 'استهلاك الموديل المفصل',
    description: 'صفحة تشغيلية شاملة لكل موديل',
    icon: Shirt
  },
  {
    key: 'workshop_evaluations',
    label: 'تقييم الورش',
    description: 'الالتزام بالمواعيد وجودة الشغل والتشطيب',
    icon: Star
  }
];

const PERIOD_OPTIONS: Array<{ key: PeriodKey; label: string }> = [
  { key: 'today', label: 'اليوم' },
  { key: 'week', label: 'الأسبوع' },
  { key: 'month', label: 'الشهر' },
  { key: 'custom', label: 'فترة مخصصة' }
];

const DEPARTMENT_ORDER = ['cutting', 'printing', 'qc', 'sewing', 'finishing', 'ironing', 'packaging'];

const DEPARTMENT_META: Record<string, { label: string; icon: React.ReactNode }> = {
  cutting: { label: 'القص', icon: <Scissors className="h-4 w-4" /> },
  printing: { label: 'المطابع والتطريز', icon: <Printer className="h-4 w-4" /> },
  qc: { label: 'الفرز والجودة', icon: <CheckCircle2 className="h-4 w-4" /> },
  sewing: { label: 'المكن', icon: <Shirt className="h-4 w-4" /> },
  finishing: { label: 'التشطيب', icon: <Sparkles className="h-4 w-4" /> },
  ironing: { label: 'المكواة', icon: <Flame className="h-4 w-4" /> },
  packaging: { label: 'التعبئة والدَست', icon: <Package className="h-4 w-4" /> }
};

const EMPTY_TOTALS = {
  models: 0,
  boys_models: 0,
  girls_models: 0,
  pieces: 0,
  boys_pieces: 0,
  girls_pieces: 0,
  size_categories: 0
};

const numberFormatter = new Intl.NumberFormat('en-US');
const fmt = (value: number | null | undefined): string => numberFormatter.format(Number(value || 0));
const pct = (value: number | null | undefined): string => `${Number(value || 0).toFixed(1)}%`;

const toneClasses: Record<string, { wrap: string; text: string }> = {
  slate: { wrap: 'bg-slate-100 text-slate-600', text: 'text-slate-900' },
  blue: { wrap: 'bg-blue-50 text-blue-600', text: 'text-blue-700' },
  pink: { wrap: 'bg-pink-50 text-pink-600', text: 'text-pink-700' },
  emerald: { wrap: 'bg-emerald-50 text-emerald-600', text: 'text-emerald-700' },
  amber: { wrap: 'bg-amber-50 text-amber-600', text: 'text-amber-700' },
  rose: { wrap: 'bg-rose-50 text-rose-600', text: 'text-rose-700' },
  indigo: { wrap: 'bg-indigo-50 text-indigo-600', text: 'text-indigo-700' }
};

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100';

/* ------------------------------------------------------------------ */
/* Small presentational components                                     */
/* ------------------------------------------------------------------ */

const StatCard: React.FC<{
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  tone?: keyof typeof toneClasses;
}> = ({ label, value, hint, icon, tone = 'slate' }) => {
  const cls = toneClasses[tone] || toneClasses.slate;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${cls.wrap}`}>{icon}</span>
      </div>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${cls.text}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
};

const SectionCard: React.FC<{
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ title, subtitle, action, children, className = '' }) => (
  <section className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
    <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 pb-3 pt-4">
      <div>
        <h2 className="text-sm font-bold text-slate-800">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
      </div>
      {action}
    </header>
    <div className="p-5">{children}</div>
  </section>
);

const LoadingBlock: React.FC<{ label?: string }> = ({ label = 'جارٍ تحميل البيانات...' }) => (
  <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
    <Loader2 className="h-4 w-4 animate-spin" />
    <span>{label}</span>
  </div>
);

const EmptyState: React.FC<{ title: string; hint?: string; icon?: React.ReactNode }> = ({
  title,
  hint,
  icon
}) => (
  <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
      {icon || <BarChart3 className="h-5 w-5" />}
    </span>
    <p className="text-sm font-semibold text-slate-700">{title}</p>
    {hint ? <p className="max-w-sm text-xs text-slate-500">{hint}</p> : null}
  </div>
);

const ErrorBanner: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
    <span className="flex items-center gap-2">
      <AlertTriangle className="h-4 w-4" />
      {message}
    </span>
    <button
      type="button"
      onClick={onRetry}
      className="rounded-lg border border-rose-300 bg-white px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
    >
      إعادة المحاولة
    </button>
  </div>
);

const ProgressBar: React.FC<{ value: number; color: string }> = ({ value, color }) => (
  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
    <div
      className="h-full rounded-full transition-all"
      style={{ width: `${Math.min(100, Math.max(0, value))}%`, backgroundColor: color }}
    />
  </div>
);

const DeltaBadge: React.FC<{ delta: number; percent: number }> = ({ delta, percent }) => {
  const positive = delta > 0;
  const negative = delta < 0;
  const Icon = positive ? TrendingUp : negative ? TrendingDown : Minus;
  const cls = positive
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : negative
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : 'border-slate-200 bg-slate-50 text-slate-600';
  return (
    <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold ${cls}`}>
      <Icon className="h-3.5 w-3.5" />
      {positive ? '+' : ''}
      {fmt(delta)} ({Math.abs(percent)}%)
    </span>
  );
};

const WaterfallPanel: React.FC<{ data: ModelStageWaterfallResponse }> = ({ data }) => (
  <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
      <span className="font-bold text-slate-800">{data.model.model_code}</span>
      <span className="rounded-md bg-slate-100 px-2 py-0.5">{data.model.stage_label}</span>
      <span>{data.model.composition_label}</span>
      <span>
        العجز الإجمالي:{' '}
        <b className={data.summary.shortage_total > 0 ? 'text-rose-600' : 'text-emerald-600'}>
          {fmt(data.summary.shortage_total)}
        </b>{' '}
        ({pct(data.summary.shortage_percent)})
      </span>
      <span>المستهدف: {fmt(data.model.target_cut_quantity)}</span>
      {(data.summary.dest_shortage || 0) > 0 && (
        <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700">
          عجز الدَست: {fmt(data.summary.dest_shortage)}
        </span>
      )}
      {data.summary.loss_by_stage && (
        <span className="flex flex-wrap items-center gap-1">
          {STAGE_LOSS_META.filter(
            (meta) => (data.summary.loss_by_stage?.[meta.key] || 0) > 0
          ).map((meta) => (
            <span
              key={meta.key}
              className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${meta.badge}`}
            >
              {meta.short}: فقد {fmt(data.summary.loss_by_stage?.[meta.key] || 0)}
            </span>
          ))}
        </span>
      )}
    </div>

    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {data.parts.map((part) => (
        <div key={part.part} className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-slate-800">{part.label}</p>
            <span className="text-[11px] text-slate-500">
              مقصوص {fmt(part.cut_pieces)} • سليم {fmt(part.good_pieces)}
            </span>
          </div>
          {part.loss_by_stage && (
            <div className="mb-2 flex flex-wrap gap-1">
              {STAGE_LOSS_META.filter(
                (meta) => (part.loss_by_stage?.[meta.key] || 0) > 0
              ).map((meta) => (
                <span
                  key={meta.key}
                  className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${meta.badge}`}
                >
                  {meta.short}: {fmt(part.loss_by_stage?.[meta.key] || 0)}
                </span>
              ))}
            </div>
          )}
          <div className="space-y-2">
            {part.stages.map((stage) => {
              const outWidth = stage.in_qty > 0 ? (stage.out_qty / stage.in_qty) * 100 : 0;
              const lossWidth = stage.in_qty > 0 ? (stage.loss / stage.in_qty) * 100 : 0;
              return (
                <div key={stage.key}>
                  <div className="flex items-center justify-between text-[11px] text-slate-600">
                    <span>{stage.label}</span>
                    <span className="tabular-nums">
                      {fmt(stage.out_qty)} / {fmt(stage.in_qty)}
                      {stage.loss > 0 ? ` • فقد ${fmt(stage.loss)}` : ''}
                    </span>
                  </div>
                  <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full bg-emerald-500" style={{ width: `${outWidth}%` }} />
                    <div className="h-full bg-rose-400" style={{ width: `${lossWidth}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>

    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
      {data.model_stages.map((stage) => {
        const badge =
          stage.status === 'completed'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : stage.status === 'in_progress'
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : 'border-slate-200 bg-slate-50 text-slate-600';
        return (
          <div
            key={stage.key}
            className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3"
          >
            <div>
              <p className="text-sm font-semibold text-slate-800">{stage.label}</p>
              <p className="text-[11px] text-slate-500">
                {stage.completed_count}/{stage.records_count} سجل مكتمل • {fmt(stage.in_qty)} قطعة
              </p>
              {stage.key === 'dest' && data.model.dest_completed_pieces != null && (
                <p className="text-[11px] font-semibold text-slate-600 mt-0.5">
                  متوقع {fmt(data.model.dest_expected_pieces ?? stage.in_qty)} • منفذ {fmt(data.model.dest_completed_pieces)}
                  {(data.model.dest_shortage_pieces || stage.loss || 0) > 0 && (
                    <span className="text-rose-600 font-bold">
                      {' '}• عجز {fmt(data.model.dest_shortage_pieces ?? stage.loss)}
                    </span>
                  )}
                </p>
              )}
            </div>
            <span className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${badge}`}>
              {stage.status_label}
            </span>
          </div>
        );
      })}
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export const ReportsView: React.FC<{ onNavigateToStage?: StageNavigateFn }> = ({
  onNavigateToStage
}) => {
  const { hasPermission, addFlashMessage, globalSettings, refreshState, logAction } = useApp();

  const canViewReports = hasPermission('reports');
  const canEditTargets = hasPermission('reports', true);

  const [activeTab, setActiveTab] = useState<ReportTab>('models');
  const [materialsRefreshTick, setMaterialsRefreshTick] = useState(0);

  /* ---------- tab 1: الموديلات حسب المقاس ---------- */
  const [metric, setMetric] = useState<MetricMode>('models');
  const [composition, setComposition] = useState('all');
  const [stageFilter, setStageFilter] = useState('');
  const [modelType, setModelType] = useState('all');
  const [modelsFrom, setModelsFrom] = useState('');
  const [modelsTo, setModelsTo] = useState('');
  const [modelsReport, setModelsReport] = useState<ModelsReportResponse | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');

  /* ---------- tab 2: الإنتاج والسرعة ---------- */
  const [period, setPeriod] = useState<PeriodKey>('today');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [productionReport, setProductionReport] = useState<ProductionDepartmentsResponse | null>(null);
  const [productionLoading, setProductionLoading] = useState(false);
  const [productionError, setProductionError] = useState('');
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [targetsDraft, setTargetsDraft] = useState<DepartmentTargetsMap>({});
  const [targetsSaving, setTargetsSaving] = useState(false);

  /* ---------- tab 3: المشاكل والعجز ---------- */
  const [qualitySearch, setQualitySearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [qualitySort, setQualitySort] = useState<SortKey>('shortage');
  const [qualityStageFilter, setQualityStageFilter] = useState<StageLossKey | ''>('');
  const [qualityFrom, setQualityFrom] = useState('');
  const [qualityTo, setQualityTo] = useState('');
  const [qualityReport, setQualityReport] = useState<QualityShortageResponse | null>(null);
  const [qualityLoading, setQualityLoading] = useState(false);
  const [qualityError, setQualityError] = useState('');
  const [expandedModelId, setExpandedModelId] = useState<number | null>(null);
  const [waterfalls, setWaterfalls] = useState<Record<number, ModelStageWaterfallResponse>>({});
  const [waterfallLoading, setWaterfallLoading] = useState<number | null>(null);

  /* ---------- tab 6: تقييم الورش ---------- */
  const [evalCategory, setEvalCategory] = useState<EvalCategoryFilter>('all');
  const [evalSearch, setEvalSearch] = useState('');
  const [debouncedEvalSearch, setDebouncedEvalSearch] = useState('');
  const [evalFrom, setEvalFrom] = useState('');
  const [evalTo, setEvalTo] = useState('');
  const [evalReport, setEvalReport] = useState<WorkshopEvaluationsReportResponse | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalError, setEvalError] = useState('');
  const [expandedWorkshopKey, setExpandedWorkshopKey] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(qualitySearch.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [qualitySearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedEvalSearch(evalSearch.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [evalSearch]);

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError('');
    try {
      const data = await api.getModelsReport({
        metric,
        composition: composition === 'all' ? undefined : composition,
        model_type: modelType === 'all' ? undefined : modelType,
        stage: stageFilter || undefined,
        date_from: modelsFrom || undefined,
        date_to: modelsTo || undefined
      });
      setModelsReport(data);
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : 'تعذّر تحميل تقرير الموديلات.');
    } finally {
      setModelsLoading(false);
    }
  }, [composition, metric, modelType, modelsFrom, modelsTo, stageFilter]);

  // تبديل فلتر المرحلة من كارت "المراحل" (ضغط ثانٍ يلغي الفلتر).
  const toggleStage = (key: string) => setStageFilter((prev) => (prev === key ? '' : key));
  // تبديل فلتر التكوين من كارت "التكوين" (ضغط ثانٍ يلغي الفلتر).
  const toggleComposition = (key: string) =>
    setComposition((prev) => (prev === key ? 'all' : key));
  // إعادة تعيين كل فلاتر تبويب الموديلات التفاعلية.
  const clearModelsFilters = () => {
    setStageFilter('');
    setComposition('all');
  };

  const loadProduction = useCallback(async () => {
    setProductionLoading(true);
    setProductionError('');
    try {
      const data = await api.getProductionReport({
        period,
        date_from: period === 'custom' ? periodFrom || undefined : undefined,
        date_to: period === 'custom' ? periodTo || undefined : undefined
      });
      setProductionReport(data);
    } catch (error) {
      setProductionError(error instanceof Error ? error.message : 'تعذّر تحميل تقرير الإنتاج.');
    } finally {
      setProductionLoading(false);
    }
  }, [period, periodFrom, periodTo]);

  const loadQuality = useCallback(async () => {
    setQualityLoading(true);
    setQualityError('');
    try {
      const data = await api.getQualityReport({
        search: debouncedSearch || undefined,
        sort: qualitySort,
        date_from: qualityFrom || undefined,
        date_to: qualityTo || undefined
      });
      setQualityReport(data);
    } catch (error) {
      setQualityError(error instanceof Error ? error.message : 'تعذّر تحميل تقرير العجز.');
    } finally {
      setQualityLoading(false);
    }
  }, [debouncedSearch, qualityFrom, qualitySort, qualityTo]);

  const loadWorkshopEvaluations = useCallback(async () => {
    setEvalLoading(true);
    setEvalError('');
    try {
      const data = await api.getWorkshopEvaluationsReport({
        category: evalCategory === 'all' ? undefined : evalCategory,
        search: debouncedEvalSearch || undefined,
        date_from: evalFrom || undefined,
        date_to: evalTo || undefined
      });
      setEvalReport(data);
    } catch (error) {
      setEvalError(error instanceof Error ? error.message : 'تعذّر تحميل تقرير تقييم الورش.');
    } finally {
      setEvalLoading(false);
    }
  }, [debouncedEvalSearch, evalCategory, evalFrom, evalTo]);

  useEffect(() => {
    if (!canViewReports || activeTab !== 'models') return;
    void loadModels();
  }, [activeTab, canViewReports, loadModels]);

  useEffect(() => {
    if (!canViewReports || activeTab !== 'production') return;
    void loadProduction();
  }, [activeTab, canViewReports, loadProduction]);

  useEffect(() => {
    if (!canViewReports || activeTab !== 'quality') return;
    void loadQuality();
  }, [activeTab, canViewReports, loadQuality]);

  useEffect(() => {
    if (!canViewReports || activeTab !== 'workshop_evaluations') return;
    void loadWorkshopEvaluations();
  }, [activeTab, canViewReports, loadWorkshopEvaluations]);

  const selectPeriod = (key: PeriodKey) => {
    if (key === 'custom' && (!periodFrom || !periodTo)) {
      const pad = (value: number) => String(value).padStart(2, '0');
      const toIso = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      const today = new Date();
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      setPeriodFrom(periodFrom || toIso(monthStart));
      setPeriodTo(periodTo || toIso(today));
    }
    setPeriod(key);
  };

  const refreshActiveTab = () => {
    if (activeTab === 'models') void loadModels();
    else if (activeTab === 'production') void loadProduction();
    else if (activeTab === 'quality') void loadQuality();
    else if (activeTab === 'workshop_evaluations') void loadWorkshopEvaluations();
    else {
      void refreshState();
      setMaterialsRefreshTick((n) => n + 1);
    }
  };

  const toggleModelDetails = async (modelId: number) => {
    if (expandedModelId === modelId) {
      setExpandedModelId(null);
      return;
    }
    setExpandedModelId(modelId);
    if (waterfalls[modelId]) return;
    setWaterfallLoading(modelId);
    try {
      const data = await api.getModelStageWaterfall(modelId);
      setWaterfalls((prev) => ({ ...prev, [modelId]: data }));
    } catch (error) {
      addFlashMessage(error instanceof Error ? error.message : 'تعذّر تحميل تفصيل المراحل.', 'danger');
    } finally {
      setWaterfallLoading(null);
    }
  };

  const openTargetsEditor = () => {
    const current: DepartmentTargetsMap =
      productionReport?.targets || globalSettings.department_targets || {};
    const draft: DepartmentTargetsMap = {};
    DEPARTMENT_ORDER.forEach((key) => {
      draft[key] = {
        daily: Number(current[key]?.daily || 0),
        monthly: Number(current[key]?.monthly || 0)
      };
    });
    setTargetsDraft(draft);
    setTargetsOpen(true);
  };

  const updateTargetValue = (key: string, field: 'daily' | 'monthly', raw: string) => {
    const value = Math.max(0, Math.floor(Number(raw) || 0));
    setTargetsDraft((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || { daily: 0, monthly: 0 }), [field]: value }
    }));
  };

  const saveTargets = async () => {
    setTargetsSaving(true);
    try {
      const result = await api.saveDepartmentTargets(targetsDraft);
      setProductionReport((prev) => (prev ? { ...prev, targets: result.targets } : prev));
      setTargetsOpen(false);
      addFlashMessage('تم حفظ تارجتات الأقسام بنجاح.', 'success');
      void loadProduction();
    } catch (error) {
      addFlashMessage(error instanceof Error ? error.message : 'تعذّر حفظ التارجتات.', 'danger');
    } finally {
      setTargetsSaving(false);
    }
  };

  /* ----------------------------- printing ---------------------------- */
  const openPrintWindow = (title: string, bodyHtml: string, subtitle?: string) => {
    const siteName = globalSettings?.site_name || 'نظام إدارة المصنع';
    const opened = openUnifiedPrintWindow({
      documentTitle: title,
      mode: 'multi-page-table',
      orientation: 'landscape',
      header: {
        siteName,
        logo: globalSettings?.logo,
        title,
        subtitle: subtitle || 'مركز التقارير والإحصائيات التنفيذية'
      },
      bodyHtml: `${bodyHtml}${renderSignatureBar(['إعداد التقارير', 'مدير الإنتاج', 'اعتماد الإدارة'], true)}`,
      onPopupBlocked: () => addFlashMessage('يرجى السماح بالنوافذ المنبثقة لإتمام الطباعة.', 'warning')
    });
    if (opened) {
      logClientPrintAction('التقارير', `طباعة تقرير: ${title}`, title);
    }
  };

  const printModelsReport = () => {
    if (!modelsReport) return;
    const rows = modelsReport.size_categories
      .map(
        (row) => `<tr>
          <td>${escapeHtml(row.size_name)}</td>
          <td class="num">${fmt(row.boys_value)}</td>
          <td class="num">${fmt(row.girls_value)}</td>
          <td class="num">${fmt(row.boys_pieces)}</td>
          <td class="num">${fmt(row.girls_pieces)}</td>
          <td class="num">${fmt(row.total_models)}</td>
        </tr>`
      )
      .join('');
    const metricLabel = modelsReport.metric === 'pieces' ? 'عدد القطع' : 'عدد الموديلات';
    const boysTotal =
      modelsReport.metric === 'pieces' ? modelsReport.totals.boys_pieces : modelsReport.totals.boys_models;
    const girlsTotal =
      modelsReport.metric === 'pieces' ? modelsReport.totals.girls_pieces : modelsReport.totals.girls_models;
    openPrintWindow(
      'تقرير الموديلات حسب المقاس',
      `<table>
        <thead><tr>
          <th>فئة المقاس</th><th>ولادي (${metricLabel})</th><th>بناتي (${metricLabel})</th>
          <th>قطع ولادي</th><th>قطع بناتي</th><th>إجمالي الموديلات</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="6">لا توجد بيانات</td></tr>'}</tbody>
        <tfoot><tr class="total">
          <td>الإجمالي</td>
          <td class="num">${fmt(boysTotal)}</td>
          <td class="num">${fmt(girlsTotal)}</td>
          <td class="num">${fmt(modelsReport.totals.boys_pieces)}</td>
          <td class="num">${fmt(modelsReport.totals.girls_pieces)}</td>
          <td class="num">${fmt(modelsReport.totals.models)}</td>
        </tr></tfoot>
      </table>`
    );
  };

  const printProductionReport = () => {
    if (!productionReport) return;
    const rows = productionReport.departments
      .map(
        (dep) => `<tr>
          <td>${escapeHtml(dep.label)}</td>
          <td class="num">${fmt(dep.models_count)}</td>
          <td class="num">${fmt(dep.pieces_count)}</td>
          <td class="num">${fmt(dep.avg_daily)}</td>
          <td class="num">${fmt(dep.target)}</td>
          <td class="num">${dep.progress_percent}%</td>
          <td class="num">${dep.delta > 0 ? '+' : ''}${fmt(dep.delta)}</td>
        </tr>`
      )
      .join('');
    openPrintWindow(
      `تقرير الإنتاج والسرعة — ${productionReport.period_label}`,
      `<table>
        <thead><tr>
          <th>القسم</th><th>الموديلات</th><th>القطع</th><th>السرعة اليومية</th>
          <th>التارجت</th><th>نسبة الإنجاز</th><th>الفرق عن السابق</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="7">لا توجد بيانات</td></tr>'}</tbody>
      </table>`
    );
  };

  const printQualityReport = () => {
    if (!qualityReport) return;
    const filteredList = qualityStageFilter
      ? qualityReport.models.filter((row) => (row.stage_losses?.[qualityStageFilter] || 0) > 0)
      : qualityReport.models;
    const stageSummary = (qualityReport.stage_loss_totals || [])
      .filter((item) => item.loss > 0)
      .map((item) => `${escapeHtml(item.label)}: ${fmt(item.loss)}`)
      .join(' • ');
    const rows = filteredList
      .map((row) => {
        const lossText =
          STAGE_LOSS_META.filter((meta) => (row.stage_losses?.[meta.key] || 0) > 0)
            .map((meta) => `${meta.short}: ${fmt(row.stage_losses?.[meta.key] || 0)}`)
            .join(' • ') || '—';
        return `<tr>
          <td>${escapeHtml(row.model_code)}</td>
          <td>${escapeHtml(row.model_type || '—')}</td>
          <td>${escapeHtml(row.stage_label || '—')}</td>
          <td class="num">${fmt(row.cut_pieces)}</td>
          <td class="num">${fmt(row.current_pieces)}</td>
          <td class="num">${fmt(row.shortage)}</td>
          <td class="num">${row.shortage_percent}%</td>
          <td>${escapeHtml(lossText)}</td>
        </tr>`;
      })
      .join('');
    const totalCutFiltered = filteredList.reduce((s, r) => s + Number(r.cut_pieces || 0), 0);
    const totalCurFiltered = filteredList.reduce((s, r) => s + Number(r.current_pieces || 0), 0);
    openPrintWindow(
      qualityStageFilter ? `تقرير المشاكل والعجز — ${activeStageLossMeta?.label || qualityStageFilter}` : 'تقرير المشاكل والعجز',
      `<p class="meta" style="margin:0 0 8px">أين ضاعت القطع؟ ${escapeHtml(stageSummary || 'لا يوجد فقد مسجّل')}</p>
      <table>
        <thead><tr>
          <th>الموديل</th><th>النوع</th><th>المرحلة</th><th>المقصوص</th>
          <th>السليم الحالي</th><th>العجز</th><th>نسبة العجز</th><th>أين الفقد</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="8">لا توجد بيانات</td></tr>'}</tbody>
        <tfoot><tr class="total">
          <td colspan="3">الإجمالي</td>
          <td class="num">${fmt(qualityStageFilter ? totalCutFiltered : qualityReport.summary.total_cut_pieces)}</td>
          <td class="num">${fmt(qualityStageFilter ? totalCurFiltered : qualityReport.summary.total_current_pieces)}</td>
          <td class="num">${fmt(qualityReport.summary.total_shortage)}</td>
          <td class="num">${pct(qualityReport.summary.total_shortage_percent)}</td>
          <td></td>
        </tr></tfoot>
      </table>`
    );
  };

  const printWorkshopEvaluationsReport = () => {
    if (!evalReport) return;
    const rows = evalReport.workshops
      .map(
        (row) => `<tr>
          <td>${escapeHtml(row.workshop_name)}</td>
          <td>${escapeHtml(row.category_label || '—')}</td>
          <td class="num">${row.evaluations_count > 0 ? row.avg_delivery.toFixed(2) : '—'}</td>
          <td class="num">${row.evaluations_count > 0 ? row.avg_work_quality.toFixed(2) : '—'}</td>
          <td class="num">${row.evaluations_count > 0 ? row.avg_finishing_quality.toFixed(2) : '—'}</td>
          <td class="num"><strong>${row.evaluations_count > 0 ? `${row.overall_avg.toFixed(2)} / 5` : 'غير مُقيّم'}</strong></td>
          <td class="num">${fmt(row.evaluations_count)}</td>
          <td class="num">${fmt(row.total_dispatches)}</td>
          <td class="num">${row.on_time_percent != null ? `${row.on_time_percent.toFixed(1)}%` : '—'}</td>
          <td class="num">${row.defect_percent != null ? `${row.defect_percent.toFixed(1)}%` : '—'}</td>
        </tr>`
      )
      .join('');
    openPrintWindow(
      'تقرير تقييم أداء الورش',
      `<table>
        <thead><tr>
          <th>الورشة</th><th>التخصص</th><th>ميعاد التسليم</th><th>جودة الشغل</th>
          <th>جودة التشطيب</th><th>المتوسط العام</th><th>عدد التقييمات</th>
          <th>إجمالي التشغيلات</th><th>الالتزام بالمواعيد %</th><th>نسبة العيوب %</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="10">لا توجد بيانات</td></tr>'}</tbody>
      </table>`
    );
  };

  const exportWorkshopEvaluationsExcel = () => {
    const list = evalReport?.workshops || [];
    if (!list.length) {
      addFlashMessage('لا توجد بيانات تقييم ورش لتصديرها.', 'warning');
      return;
    }
    const headers = [
      'اسم الورشة',
      'التخصص',
      'عدد التقييمات',
      'متوسط ميعاد التسليم (من 5)',
      'متوسط جودة الشغل (من 5)',
      'متوسط جودة التشطيب (من 5)',
      'المتوسط العام (من 5)',
      'إجمالي التشغيلات',
      'نسبة الالتزام بالمواعيد %',
      'نسبة العيوب %'
    ];
    const rows = list.map((w) => [
      w.workshop_name,
      w.category_label || '—',
      w.evaluations_count,
      w.evaluations_count > 0 ? w.avg_delivery.toFixed(2) : '—',
      w.evaluations_count > 0 ? w.avg_work_quality.toFixed(2) : '—',
      w.evaluations_count > 0 ? w.avg_finishing_quality.toFixed(2) : '—',
      w.evaluations_count > 0 ? w.overall_avg.toFixed(2) : '—',
      w.total_dispatches,
      w.on_time_percent != null ? `${w.on_time_percent.toFixed(1)}%` : '—',
      w.defect_percent != null ? `${w.defect_percent.toFixed(1)}%` : '—'
    ]);
    exportCsv(datedFileName('تقييم_الورش'), headers, rows);
    logAction('التقارير', `تصدير تقرير تقييم الورش (${list.length} ورشة) إلى Excel`, {
      actionType: 'export'
    });
  };

  const printActiveTab = () => {
    if (activeTab === 'models') printModelsReport();
    else if (activeTab === 'production') printProductionReport();
    else if (activeTab === 'quality') printQualityReport();
    else if (activeTab === 'workshop_evaluations') printWorkshopEvaluationsReport();
    else if (activeTab === 'materials') window.dispatchEvent(new CustomEvent('erp:print-materials-report'));
    else if (activeTab === 'model_consumption') window.dispatchEvent(new CustomEvent('erp:print-model-consumption-report'));
  };

  /* --------------------------- derived data -------------------------- */
  const modelTotals = modelsReport?.totals || EMPTY_TOTALS;
  const sizeRows = modelsReport?.size_categories || [];
  const chartData = sizeRows.map((row) => ({
    name: row.size_name,
    boys: row.boys_value,
    girls: row.girls_value
  }));
  const departments = productionReport?.departments || [];
  const qualitySummary = qualityReport?.summary;
  const qualityRows = qualityReport?.models || [];
  const compositionRows = (modelsReport?.composition_breakdown || []).filter(
    (item) => item.models_count > 0 || item.pieces_count > 0
  );
  const compositionMax = Math.max(
    ...compositionRows.map((item) => (metric === 'pieces' ? item.pieces_count : item.models_count)),
    1
  );
  const filteredModels = modelsReport?.filtered_models || [];
  const hasActiveModelsFilter = stageFilter !== '' || composition !== 'all';
  const activeStageLabel =
    (modelsReport?.stage_breakdown || []).find((item) => item.key === stageFilter)?.label ||
    STAGE_FILTER_LABELS[stageFilter] ||
    stageFilter;
  const defectRows = qualityReport?.defects_by_stage || [];
  const defectsMax = Math.max(...defectRows.map((item) => item.defects), 1);
  const stageLossTotals = qualityReport?.stage_loss_totals || [];
  const stageLossTotalMax = Math.max(...stageLossTotals.map((item) => item.loss), 1);
  // عند اختيار مرحلة، نعرض فقط الموديلات التي فقدت قطعاً فيها فعلاً.
  const visibleQualityRows = qualityStageFilter
    ? qualityRows.filter((row) => (row.stage_losses?.[qualityStageFilter] || 0) > 0)
    : qualityRows;
  const activeStageLossMeta = STAGE_LOSS_META.find((meta) => meta.key === qualityStageFilter);

  const productionTotals = useMemo(() => {
    const list = productionReport?.departments || [];
    const pieces = list.reduce((sum, dep) => sum + dep.pieces_count, 0);
    const targetedList = list.filter((dep) => dep.target > 0);
    const targetedPieces = targetedList.reduce((sum, dep) => sum + dep.pieces_count, 0);
    const target = targetedList.reduce((sum, dep) => sum + dep.target, 0);
    const best = list.reduce<DepartmentReportCard | null>(
      (winner, dep) => (!winner || dep.pieces_count > winner.pieces_count ? dep : winner),
      null
    );
    return {
      pieces,
      target,
      best,
      activeCount: list.filter((dep) => dep.pieces_count > 0).length,
      progress: target > 0 ? Math.round((targetedPieces / target) * 100) : 0
    };
  }, [productionReport]);

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/20">
            <BarChart3 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">التقارير والإحصائيات</h1>
            <p className="mt-1 text-sm text-slate-500">
              قراءة سريعة لأداء المصنع: الموديلات، سرعة الأقسام، والعجز بين المراحل.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refreshActiveTab}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            تحديث
          </button>
          <button
            type="button"
            onClick={printActiveTab}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
          >
            <Printer className="h-4 w-4" />
            طباعة
          </button>
        </div>
      </div>

      {!canViewReports ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-5 w-5" />
            لا تملك صلاحية عرض التقارير والإحصائيات.
          </div>
          <p className="mt-1 text-amber-700">يرجى مراجعة إدارة النظام لمنحك صلاحية عرض التقارير.</p>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {TAB_META.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex items-center gap-3 rounded-xl px-4 py-3 text-right transition ${
                      active ? 'bg-slate-900 text-white shadow' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                        active ? 'bg-white/15' : 'bg-slate-100'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{tab.label}</span>
                      <span
                        className={`block truncate text-xs ${active ? 'text-white/70' : 'text-slate-400'}`}
                      >
                        {tab.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {activeTab === 'models' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <div>
                    <span className="mb-1 block text-xs font-medium text-slate-500">المؤشر</span>
                    <div className="flex rounded-xl bg-slate-100 p-1">
                      <button
                        type="button"
                        onClick={() => setMetric('models')}
                        className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${
                          metric === 'models' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                        }`}
                      >
                        عدد الموديلات
                      </button>
                      <button
                        type="button"
                        onClick={() => setMetric('pieces')}
                        className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${
                          metric === 'pieces' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                        }`}
                      >
                        عدد القطع
                      </button>
                    </div>
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-500">التكوين</span>
                    <select
                      value={composition}
                      onChange={(event) => setComposition(event.target.value)}
                      className={inputClass}
                    >
                      <option value="all">كل التكوينات</option>
                      <option value="one_piece">قطعة واحدة</option>
                      <option value="tshirt_only">تيشيرت فقط</option>
                      <option value="pants_only">بنطلون فقط</option>
                      <option value="two_pieces">قطعتان</option>
                      <option value="three_pieces">ثلاث قطع</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-500">نوع الموديل</span>
                    <select
                      value={modelType}
                      onChange={(event) => setModelType(event.target.value)}
                      className={inputClass}
                    >
                      <option value="all">كل الأنواع</option>
                      {(modelsReport?.model_types || []).map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-500">من تاريخ</span>
                    <input
                      type="date"
                      value={modelsFrom}
                      onChange={(event) => setModelsFrom(event.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-500">إلى تاريخ</span>
                    <input
                      type="date"
                      value={modelsTo}
                      onChange={(event) => setModelsTo(event.target.value)}
                      className={inputClass}
                    />
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard
                  label="إجمالي الموديلات"
                  value={fmt(modelTotals.models)}
                  hint={`${fmt(modelTotals.size_categories)} فئة مقاس`}
                  icon={<Boxes className="h-4 w-4" />}
                  tone="slate"
                />
                <StatCard
                  label="موديلات ولادي"
                  value={fmt(modelTotals.boys_models)}
                  hint={`${fmt(modelTotals.boys_pieces)} قطعة`}
                  icon={<Shirt className="h-4 w-4" />}
                  tone="blue"
                />
                <StatCard
                  label="موديلات بناتي"
                  value={fmt(modelTotals.girls_models)}
                  hint={`${fmt(modelTotals.girls_pieces)} قطعة`}
                  icon={<Sparkles className="h-4 w-4" />}
                  tone="pink"
                />
                <StatCard
                  label="إجمالي القطع"
                  value={fmt(modelTotals.pieces)}
                  hint="مجموع القطع المقصوصة"
                  icon={<Layers className="h-4 w-4" />}
                  tone="indigo"
                />
              </div>

              {modelsError ? <ErrorBanner message={modelsError} onRetry={() => void loadModels()} /> : null}

              <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
                <SectionCard
                  className="xl:col-span-2"
                  title="الموديلات حسب فئة المقاس"
                  subtitle="مقارنة ولادي / بناتي داخل كل فئة"
                >
                  {modelsLoading && !modelsReport ? (
                    <LoadingBlock />
                  ) : sizeRows.length === 0 ? (
                    <EmptyState
                      title="لا توجد موديلات مطابقة"
                      hint="جرّب تغيير الفلاتر أو الفترة الزمنية."
                      icon={<Boxes className="h-5 w-5" />}
                    />
                  ) : (
                    <>
                      {hasActiveModelsFilter && (
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          {stageFilter && (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                              المرحلة: {activeStageLabel}
                              <button
                                type="button"
                                onClick={() => setStageFilter('')}
                                className="rounded-full p-0.5 transition hover:bg-blue-200/60"
                                title="إزالة فلتر المرحلة"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          )}
                          {composition !== 'all' && (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
                              التكوين: {COMPOSITION_FILTER_LABELS[composition] || composition}
                              <button
                                type="button"
                                onClick={() => setComposition('all')}
                                className="rounded-full p-0.5 transition hover:bg-indigo-200/60"
                                title="إزالة فلتر التكوين"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={clearModelsFilters}
                            className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                          >
                            عرض الكل
                          </button>
                        </div>
                      )}
                      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: BOYS_COLOR }} />
                          ولادي
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: GIRLS_COLOR }} />
                          بناتي
                        </span>
                        <span className="ms-auto text-slate-400">{modelsReport?.generated_at}</span>
                      </div>
                      <div className="h-[340px] w-full" dir="ltr">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={chartData}
                            margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                            barGap={6}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                            <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} interval={0} />
                            <YAxis tick={{ fontSize: 12, fill: '#64748b' }} allowDecimals={false} />
                            <Tooltip contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }} />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            <Bar dataKey="boys" name="ولادي" fill={BOYS_COLOR} radius={[6, 6, 0, 0]} maxBarSize={38} />
                            <Bar dataKey="girls" name="بناتي" fill={GIRLS_COLOR} radius={[6, 6, 0, 0]} maxBarSize={38} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </>
                  )}
                </SectionCard>

                <div className="space-y-5">
                  <SectionCard
                    title="التكوين"
                    subtitle={metric === 'pieces' ? 'عدد القطع لكل تكوين' : 'عدد الموديلات لكل تكوين'}
                  >
                    {compositionRows.length === 0 ? (
                      <EmptyState title="لا توجد بيانات" icon={<Scissors className="h-5 w-5" />} />
                    ) : (
                      <div className="space-y-3">
                        {compositionRows.map((item) => {
                          const value = metric === 'pieces' ? item.pieces_count : item.models_count;
                          const active = composition === item.key;
                          return (
                            <button
                              key={item.key}
                              type="button"
                              onClick={() => toggleComposition(item.key)}
                              className={`w-full rounded-xl px-3 py-2 text-right transition ${
                                active ? 'bg-indigo-600 ring-2 ring-indigo-200' : 'hover:bg-slate-50'
                              }`}
                              title={active ? 'إلغاء فلتر التكوين' : 'تصفية بهذا التكوين'}
                            >
                              <div className="mb-1 flex items-center justify-between text-xs">
                                <span className={active ? 'text-white' : 'text-slate-600'}>
                                  {item.label}
                                </span>
                                <span className={`font-semibold ${active ? 'text-white' : 'text-slate-800'}`}>
                                  {fmt(value)}
                                </span>
                              </div>
                              <ProgressBar
                                value={(value / compositionMax) * 100}
                                color={active ? '#ffffff' : '#6366F1'}
                              />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </SectionCard>

                  <SectionCard
                    title="المراحل"
                    subtitle="توزيع الموديلات النشطة على كل مراحل الإنتاج بالترتيب (12 مرحلة)"
                  >
                    {(modelsReport?.stage_breakdown || []).length === 0 ? (
                      <EmptyState title="لا توجد بيانات" icon={<Gauge className="h-5 w-5" />} />
                    ) : (
                      <div className="space-y-1.5">
                        {(modelsReport?.stage_breakdown || []).map((item, idx) => {
                          const active = stageFilter === item.key;
                          const isZero = item.models_count === 0;
                          return (
                            <button
                              key={item.key}
                              type="button"
                              onClick={() => toggleStage(item.key)}
                              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs transition ${
                                active
                                  ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-200'
                                  : isZero
                                  ? 'bg-slate-50/70 text-slate-400 hover:bg-slate-100'
                                  : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                              }`}
                              title={active ? 'إلغاء فلتر المرحلة' : 'تصفية بهذه المرحلة'}
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                <span
                                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${
                                    active
                                      ? 'bg-white/20 text-white'
                                      : isZero
                                      ? 'bg-slate-200/70 text-slate-400'
                                      : 'bg-white text-slate-600 border border-slate-200'
                                  }`}
                                >
                                  {idx + 1}
                                </span>
                                {active && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                                <span className="truncate font-semibold">{item.label}</span>
                              </span>
                              <span
                                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                                  active
                                    ? 'bg-white/20 text-white'
                                    : isZero
                                    ? 'text-slate-400'
                                    : 'bg-white text-slate-800 border border-slate-200'
                                }`}
                              >
                                {fmt(item.models_count)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </SectionCard>
                </div>
              </div>

              {hasActiveModelsFilter && (
                <SectionCard
                  title="الموديلات المطابقة للفلتر الحالي"
                  subtitle={`${fmt(filteredModels.length)} موديل ضمن المرحلة/التكوين المختار`}
                >
                  {filteredModels.length === 0 ? (
                    <EmptyState
                      title="لا توجد موديلات مطابقة"
                      hint="جرّب إزالة الفلتر أو اختيار مرحلة/تكوين آخر."
                      icon={<Boxes className="h-5 w-5" />}
                    />
                  ) : (
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {filteredModels.map((model) => (
                        <div
                          key={model.model_id}
                          className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5"
                        >
                          {model.image ? (
                            <img
                              src={model.image}
                              alt={model.model_code}
                              className="h-11 w-11 shrink-0 rounded-lg object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                              <Shirt className="h-5 w-5" />
                            </span>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-slate-800">{model.model_code}</p>
                            <p className="truncate text-[11px] text-slate-500">
                              {model.gender === 'girls' ? 'بناتي' : 'ولادي'}
                              {model.model_type ? ` • ${model.model_type}` : ''}
                              {` • ${model.size_category}`}
                              {model.composition_label ? ` • ${model.composition_label}` : ''}
                            </p>
                          </div>
                          <div className="shrink-0 text-left">
                            <span className="block rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                              {model.stage_label}
                            </span>
                            <span className="mt-1 block text-[11px] font-semibold tabular-nums text-slate-700">
                              {fmt(model.cut_pieces)} ق
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
              )}

              <SectionCard
                title="تفصيل فئات المقاسات"
                subtitle={`الأرقام المفصلة لكل فئة حسب مؤشر: ${
                  metric === 'models' ? 'عدد الموديلات' : 'عدد القطع'
                }`}
              >
                {sizeRows.length === 0 ? (
                  <EmptyState
                    title="لا توجد فئات مقاسات"
                    hint="أضف فئات المقاسات أو موديلات لعرض التفصيل."
                    icon={<Boxes className="h-5 w-5" />}
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs text-slate-500">
                          <th className="py-2 text-right font-medium">فئة المقاس</th>
                          <th className="py-2 text-center font-medium">المقاسات</th>
                          <th className="py-2 text-center font-medium">
                            ولادي ({metric === 'models' ? 'موديل' : 'قطعة'})
                          </th>
                          <th className="py-2 text-center font-medium">
                            بناتي ({metric === 'models' ? 'موديل' : 'قطعة'})
                          </th>
                          <th className="py-2 text-center font-medium">إجمالي الموديلات</th>
                          <th className="py-2 text-center font-medium">إجمالي القطع</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sizeRows.map((row) => (
                          <tr key={row.size_id} className="text-slate-700 hover:bg-slate-50/70">
                            <td className="py-2 pr-1 text-right font-semibold">{row.size_name}</td>
                            <td className="py-2 text-center text-xs text-slate-500">{row.size_values || '—'}</td>
                            <td className="py-2 text-center tabular-nums">{fmt(row.boys_value)}</td>
                            <td className="py-2 text-center tabular-nums">{fmt(row.girls_value)}</td>
                            <td className="py-2 text-center font-semibold tabular-nums">{fmt(row.total_models)}</td>
                            <td className="py-2 text-center tabular-nums">{fmt(row.total_pieces)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>
            </div>
          )}

          {activeTab === 'production' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <span className="mb-1 block text-xs font-medium text-slate-500">الفترة</span>
                      <div className="flex flex-wrap rounded-xl bg-slate-100 p-1">
                        {PERIOD_OPTIONS.map((option) => (
                          <button
                            key={option.key}
                            type="button"
                            onClick={() => selectPeriod(option.key)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                              period === option.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {period === 'custom' && (
                      <>
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-slate-500">من</span>
                          <input
                            type="date"
                            value={periodFrom}
                            onChange={(event) => setPeriodFrom(event.target.value)}
                            className={inputClass}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-slate-500">إلى</span>
                          <input
                            type="date"
                            value={periodTo}
                            onChange={(event) => setPeriodTo(event.target.value)}
                            className={inputClass}
                          />
                        </label>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-slate-500">
                      {productionReport?.period_label}
                      {productionReport ? ` • ${productionReport.days} يوم` : ''}
                    </span>
                    {canEditTargets && (
                      <button
                        type="button"
                        onClick={openTargetsEditor}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                      >
                        <Settings2 className="h-4 w-4" />
                        تعديل التارجت
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {productionError ? (
                <ErrorBanner message={productionError} onRetry={() => void loadProduction()} />
              ) : null}

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard
                  label="إجمالي القطع"
                  value={fmt(productionTotals.pieces)}
                  hint="كل الأقسام خلال الفترة"
                  icon={<Package className="h-4 w-4" />}
                  tone="blue"
                />
                <StatCard
                  label="إجمالي التارجت"
                  value={fmt(productionTotals.target)}
                  hint={`نسبة الإنجاز ${productionTotals.progress}%`}
                  icon={<Target className="h-4 w-4" />}
                  tone="indigo"
                />
                <StatCard
                  label="أعلى قسم"
                  value={productionTotals.best?.label || '—'}
                  hint={
                    productionTotals.best
                      ? `${fmt(productionTotals.best.pieces_count)} قطعة`
                      : 'لا توجد بيانات'
                  }
                  icon={<Factory className="h-4 w-4" />}
                  tone="emerald"
                />
                <StatCard
                  label="الأقسام النشطة"
                  value={fmt(productionTotals.activeCount)}
                  hint="أقسام سجّلت إنتاجاً"
                  icon={<Gauge className="h-4 w-4" />}
                  tone="amber"
                />
              </div>

              {productionLoading && !productionReport ? (
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <LoadingBlock />
                </div>
              ) : departments.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <EmptyState
                    title="لا توجد أرقام إنتاج في هذه الفترة"
                    hint="جرّب توسيع الفترة الزمنية أو اختيار الشهر."
                    icon={<Gauge className="h-5 w-5" />}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {departments.map((dep) => (
                    <div key={dep.key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="flex h-9 w-9 items-center justify-center rounded-xl"
                            style={{ backgroundColor: `${dep.color}1A`, color: dep.color }}
                          >
                            {DEPARTMENT_META[dep.key]?.icon || <Factory className="h-4 w-4" />}
                          </span>
                          <div>
                            <p className="text-sm font-bold text-slate-800">{dep.label}</p>
                            <p className="text-[11px] text-slate-500">{fmt(dep.models_count)} موديل</p>
                          </div>
                        </div>
                        <DeltaBadge delta={dep.delta} percent={dep.delta_percent} />
                      </div>

                      <div className="mt-4 flex items-end justify-between">
                        <div>
                          <p className="text-2xl font-bold tabular-nums text-slate-900">{fmt(dep.pieces_count)}</p>
                          <p className="text-[11px] text-slate-500">قطعة</p>
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-bold tabular-nums text-slate-800">{fmt(dep.avg_daily)}</p>
                          <p className="text-[11px] text-slate-500">قطعة / يوم</p>
                        </div>
                      </div>

                      <div className="mt-3">
                        {dep.target > 0 ? (
                          <>
                            <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                              <span>
                                التارجت: {fmt(dep.target)}
                                {dep.target_daily > 0 ? ` • يومي ${fmt(dep.target_daily)}` : ''}
                              </span>
                              <span className="font-semibold text-slate-700">{dep.progress_percent}%</span>
                            </div>
                            <ProgressBar value={dep.progress_percent} color={dep.color} />
                          </>
                        ) : (
                          <p className="text-[11px] text-slate-400">لم يُحدد تارجت لهذا القسم</p>
                        )}
                      </div>

                      {dep.daily_series.length > 1 && (
                        <div className="mt-3 h-16 w-full" dir="ltr">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={dep.daily_series} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                              <Area
                                type="monotone"
                                dataKey="pieces"
                                stroke={dep.color}
                                fill={dep.color}
                                fillOpacity={0.15}
                                strokeWidth={2}
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'quality' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="relative block">
                    <span className="mb-1 block text-xs font-medium text-slate-500">بحث بكود الموديل</span>
                    <Search className="pointer-events-none absolute right-3 top-[34px] h-4 w-4 text-slate-400" />
                    <input
                      value={qualitySearch}
                      onChange={(event) => setQualitySearch(event.target.value)}
                      placeholder="مثال: MD-1024"
                      className={`${inputClass} pr-9`}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-500">ترتيب حسب</span>
                    <select
                      value={qualitySort}
                      onChange={(event) => setQualitySort(event.target.value as SortKey)}
                      className={inputClass}
                    >
                      <option value="shortage">أكبر عجز</option>
                      <option value="loss">أكبر فاقد بين المراحل</option>
                      <option value="percent">أعلى نسبة عجز</option>
                      <option value="cut">أكبر كمية مقصوصة</option>
                      <option value="code">كود الموديل</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-500">من تاريخ</span>
                    <input
                      type="date"
                      value={qualityFrom}
                      onChange={(event) => setQualityFrom(event.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-500">إلى تاريخ</span>
                    <input
                      type="date"
                      value={qualityTo}
                      onChange={(event) => setQualityTo(event.target.value)}
                      className={inputClass}
                    />
                  </label>
                </div>
              </div>

              {qualityError ? <ErrorBanner message={qualityError} onRetry={() => void loadQuality()} /> : null}

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard
                  label="إجمالي المقصوص"
                  value={fmt(qualitySummary?.total_cut_pieces)}
                  hint={`${fmt(qualitySummary?.models_count)} موديل`}
                  icon={<Scissors className="h-4 w-4" />}
                  tone="slate"
                />
                <StatCard
                  label="السليم الحالي"
                  value={fmt(qualitySummary?.total_current_pieces)}
                  hint="حسب مرحلة كل موديل"
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  tone="emerald"
                />
                <StatCard
                  label="إجمالي العجز"
                  value={fmt(qualitySummary?.total_shortage)}
                  hint={`نسبة ${pct(qualitySummary?.total_shortage_percent)}`}
                  icon={<AlertTriangle className="h-4 w-4" />}
                  tone="rose"
                />
                <StatCard
                  label="إجمالي الهالك"
                  value={fmt(qualitySummary?.total_defects)}
                  hint={
                    qualitySummary && qualitySummary.worst_stage && qualitySummary.worst_stage.defects > 0
                      ? `أعلى مرحلة: ${qualitySummary.worst_stage.label}`
                      : 'لا توجد عيوب مسجلة'
                  }
                  icon={<Flame className="h-4 w-4" />}
                  tone="amber"
                />
              </div>

              {defectRows.length > 0 && (
                <SectionCard title="الهالك حسب مرحلة الفرز" subtitle="مجموع القطع التالفة المسجلة في كل مرحلة">
                  <div className="space-y-3">
                    {defectRows.map((item) => (
                      <div key={item.stage}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="text-slate-600">{item.label}</span>
                          <span className="font-semibold text-slate-800">{fmt(item.defects)} تالف</span>
                        </div>
                        <ProgressBar value={(item.defects / defectsMax) * 100} color="#F59E0B" />
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )}

              {stageLossTotals.length > 0 && (
              <SectionCard
                title="أين ضاعت القطع؟"
                subtitle="فقد كل مرحلة على حدة — اضغط على المرحلة لعرض الموديلات التي فقدت قطعاً فيها فقط"
              >
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {STAGE_LOSS_META.map((meta) => {
                    const item = stageLossTotals.find((entry) => entry.key === meta.key);
                    const loss = item?.loss || 0;
                    const active = qualityStageFilter === meta.key;
                    const Icon = meta.icon;
                    return (
                      <button
                        key={meta.key}
                        type="button"
                        onClick={() => setQualityStageFilter(active ? '' : meta.key)}
                        title={active ? 'إلغاء فلتر هذه المرحلة' : `عرض موديلات ${meta.label} فقط`}
                        className={`rounded-2xl border p-3 text-right transition ${
                          active
                            ? 'border-slate-300 bg-slate-50 ring-2 shadow-sm'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                        } ${active ? meta.ring : ''}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br text-white ${meta.gradient}`}>
                            <Icon className="h-4 w-4" />
                          </span>
                          {active ? (
                            <span className="rounded-md bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold text-white">
                              مفلتر
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-2 text-[11px] font-medium text-slate-500">{meta.label}</p>
                        <p className={`text-2xl font-black tabular-nums ${loss > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {fmt(loss)}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          قطعة • {fmt(item?.models_count || 0)} موديل
                        </p>
                        <div className="mt-2">
                          <ProgressBar
                            value={(loss / stageLossTotalMax) * 100}
                            color={loss > 0 ? '#F43F5E' : '#10B981'}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
                {activeStageLossMeta && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                    <span className="font-semibold text-slate-700">
                      الفلتر الحالي: موديلات فقدت قطعاً في «{activeStageLossMeta.label}» (
                      {fmt(visibleQualityRows.length)} موديل)
                    </span>
                    <button
                      type="button"
                      onClick={() => setQualityStageFilter('')}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-600 hover:bg-slate-100"
                    >
                      إلغاء الفلتر ✕
                    </button>
                  </div>
                )}
              </SectionCard>
              )}

              <SectionCard
                title="الموديلات والعجز"
                subtitle={
                  activeStageLossMeta
                    ? `موديلات فقدت قطعاً في «${activeStageLossMeta.label}» — اضغط على أي موديل لتفصيل المراحل`
                    : 'اضغط على أي موديل لعرض تفصيل المراحل والفاقد'
                }
                action={<span className="text-xs text-slate-500">{fmt(visibleQualityRows.length)} موديل</span>}
              >
                {qualityLoading && !qualityReport ? (
                  <LoadingBlock />
                ) : visibleQualityRows.length === 0 ? (
                  <EmptyState
                    title={qualityStageFilter ? 'لا يوجد موديلات بفقد في هذه المرحلة' : 'لا توجد موديلات مطابقة'}
                    hint={
                      qualityStageFilter
                        ? 'اضغط «إلغاء الفلتر» لعرض كل الموديلات.'
                        : 'جرّب تغيير البحث أو الفترة الزمنية.'
                    }
                    icon={<AlertTriangle className="h-5 w-5" />}
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs text-slate-500">
                          <th className="w-8 py-2" />
                          <th className="py-2 text-right font-medium">الموديل</th>
                          <th className="py-2 text-center font-medium">النوع</th>
                          <th className="py-2 text-center font-medium">المرحلة</th>
                          <th className="py-2 text-center font-medium">المقصوص</th>
                          <th className="py-2 text-center font-medium">السليم</th>
                          <th className="py-2 text-center font-medium">العجز</th>
                          <th className="py-2 text-center font-medium">نسبة العجز</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {visibleQualityRows.map((row) => {
                          const expanded = expandedModelId === row.model_id;
                          const waterfall = waterfalls[row.model_id];
                          return (
                            <React.Fragment key={row.model_id}>
                              <tr
                                onClick={() => void toggleModelDetails(row.model_id)}
                                className={`cursor-pointer text-slate-700 transition hover:bg-slate-50/70 ${
                                  expanded ? 'bg-slate-50' : ''
                                }`}
                              >
                                <td className="py-2 text-center text-slate-400">
                                  {waterfallLoading === row.model_id ? (
                                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                                  ) : expanded ? (
                                    <ChevronUp className="mx-auto h-4 w-4" />
                                  ) : (
                                    <ChevronDown className="mx-auto h-4 w-4" />
                                  )}
                                </td>
                                <td className="py-2 pr-1 text-right">
                                  <span className="font-semibold">{row.model_code}</span>
                                  <span className="mt-0.5 block text-[11px] text-slate-400">
                                    {row.composition_label}
                                  </span>
                                  {row.stage_losses && (
                                    <span className="mt-1 flex flex-wrap gap-1">
                                      {STAGE_LOSS_META.filter(
                                        (meta) => (row.stage_losses?.[meta.key] || 0) > 0
                                      ).map((meta) => (
                                        <span
                                          key={meta.key}
                                          className={`rounded border px-1 py-0.5 text-[10px] font-semibold ${meta.badge}`}
                                        >
                                          {meta.short}: {fmt(row.stage_losses?.[meta.key] || 0)}
                                        </span>
                                      ))}
                                    </span>
                                  )}
                                </td>
                                <td className="py-2 text-center text-xs">{row.model_type || '—'}</td>
                                <td className="py-2 text-center">
                                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                    {row.stage_label}
                                  </span>
                                </td>
                                <td className="py-2 text-center tabular-nums">{fmt(row.cut_pieces)}</td>
                                <td className="py-2 text-center tabular-nums">{fmt(row.current_pieces)}</td>
                                <td
                                  className={`py-2 text-center font-semibold tabular-nums ${
                                    row.shortage > 0 ? 'text-rose-600' : 'text-emerald-600'
                                  }`}
                                >
                                  {fmt(row.shortage)}
                                </td>
                                <td className="py-2 text-center text-xs tabular-nums text-slate-500">
                                  {pct(row.shortage_percent)}
                                </td>
                              </tr>
                              {expanded && (
                                <tr>
                                  <td colSpan={8} className="bg-slate-50/60 px-2 py-3">
                                    {waterfall ? (
                                      <WaterfallPanel data={waterfall} />
                                    ) : waterfallLoading === row.model_id ? (
                                      <LoadingBlock label="جارٍ تحميل تفصيل المراحل..." />
                                    ) : (
                                      <p className="py-4 text-center text-xs text-slate-500">
                                        تعذّر تحميل تفصيل هذا الموديل.
                                      </p>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>
            </div>
          )}


          {activeTab === 'materials' && <MaterialsReportSection refreshTick={materialsRefreshTick} />}
          {activeTab === 'model_consumption' && (
            <ModelConsumptionReportSection
              refreshTick={materialsRefreshTick}
              onNavigateToStage={onNavigateToStage}
            />
          )}

          {activeTab === 'workshop_evaluations' && (
            <div className="space-y-5">
              {/* Filters + Excel Export */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        { key: 'all', label: 'كل الورش' },
                        { key: 'printing', label: 'مطابع وتطريز' },
                        { key: 'sewing', label: 'مكن وخياطة' },
                        { key: 'finishing', label: 'تشطيب' }
                      ] as { key: EvalCategoryFilter; label: string }[]
                    ).map((cat) => (
                      <button
                        key={cat.key}
                        type="button"
                        onClick={() => setEvalCategory(cat.key)}
                        className={`rounded-xl px-3.5 py-2 text-xs font-bold transition cursor-pointer ${
                          evalCategory === cat.key
                            ? 'bg-amber-600 text-white shadow-sm'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={exportWorkshopEvaluationsExcel}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition cursor-pointer"
                  >
                    <Download className="h-4 w-4" />
                    <span>تصدير Excel</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="relative">
                    <Search className="h-4 w-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
                    <input
                      type="text"
                      value={evalSearch}
                      onChange={(e) => setEvalSearch(e.target.value)}
                      placeholder="بحث باسم الورشة..."
                      className={`${inputClass} ps-9`}
                    />
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-500">من تاريخ</span>
                    <input
                      type="date"
                      value={evalFrom}
                      onChange={(e) => setEvalFrom(e.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-500">إلى تاريخ</span>
                    <input
                      type="date"
                      value={evalTo}
                      onChange={(e) => setEvalTo(e.target.value)}
                      className={inputClass}
                    />
                  </label>
                </div>
              </div>

              {/* Summary KPIs */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard
                  label="إجمالي الورش"
                  value={fmt(evalReport?.summary.total_workshops)}
                  hint={`${fmt(evalReport?.summary.rated_workshops)} ورشة مُقيّمة`}
                  icon={<Factory className="h-4 w-4" />}
                  tone="slate"
                />
                <StatCard
                  label="إجمالي التقييمات"
                  value={fmt(evalReport?.summary.total_evaluations)}
                  hint={
                    evalReport?.summary.top_workshop
                      ? `الأفضل: ${evalReport.summary.top_workshop} (${evalReport.summary.top_workshop_score.toFixed(1)}/5)`
                      : 'تقييمات مسجّلة في الفترة'
                  }
                  icon={<Award className="h-4 w-4" />}
                  tone="indigo"
                />
                <StatCard
                  label="متوسط التقييم العام"
                  value={
                    evalReport?.summary.avg_overall
                      ? `${evalReport.summary.avg_overall.toFixed(2)} / 5`
                      : '—'
                  }
                  hint="متوسط الميعاد + الشغل + التشطيب"
                  icon={<Star className="h-4 w-4" />}
                  tone="amber"
                />
                <StatCard
                  label="متوسط الالتزام بالمواعيد"
                  value={
                    evalReport?.summary.avg_on_time_percent != null
                      ? `${evalReport.summary.avg_on_time_percent.toFixed(1)}%`
                      : '—'
                  }
                  hint="نسبة التسليم في الموعد المحدد"
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  tone="emerald"
                />
              </div>

              {evalError ? (
                <ErrorBanner message={evalError} onRetry={() => void loadWorkshopEvaluations()} />
              ) : null}

              <SectionCard
                title="جدول تقييم وأداء الورش"
                subtitle="تفصيل الدرجات (من 5 نجوم) ونسبة الالتزام بالمواعيد ونسبة العيوب لكل ورشة"
              >
                {evalLoading && !evalReport ? (
                  <LoadingBlock />
                ) : !(evalReport?.workshops || []).length ? (
                  <EmptyState
                    title="لا توجد ورش مطابقة للبحث"
                    hint="يمكنك تقييم أي ورشة عند استلام تشغيلاتها من أقسام المطابع أو المكن أو التشطيب."
                    icon={<Star className="h-5 w-5" />}
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs text-slate-500">
                          <th className="py-2.5 w-8" />
                          <th className="py-2.5 text-right font-semibold">الورشة والتخصص</th>
                          <th className="py-2.5 text-center font-semibold">ميعاد التسليم</th>
                          <th className="py-2.5 text-center font-semibold">جودة الشغل</th>
                          <th className="py-2.5 text-center font-semibold">جودة التشطيب</th>
                          <th className="py-2.5 text-center font-semibold">المتوسط العام</th>
                          <th className="py-2.5 text-center font-semibold">إجمالي التشغيلات</th>
                          <th className="py-2.5 text-center font-semibold">الالتزام %</th>
                          <th className="py-2.5 text-center font-semibold">نسبة العيوب %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(evalReport?.workshops || []).map((row) => {
                          const rowKey = row.workshop_id || row.workshop_name;
                          const isExpanded = expandedWorkshopKey === rowKey;
                          const hasEval = row.evaluations_count > 0;
                          const renderScoreCell = (score: number) =>
                            hasEval ? (
                              <div className="inline-flex flex-col items-center gap-0.5">
                                <span className="font-bold tabular-nums text-slate-800">
                                  {score.toFixed(1)}
                                </span>
                                <span className="flex items-center gap-0.5">
                                  {[1, 2, 3, 4, 5].map((s) => (
                                    <Star
                                      key={s}
                                      className={`h-3 w-3 ${
                                        s <= Math.round(score)
                                          ? 'fill-amber-400 text-amber-500'
                                          : 'fill-slate-100 text-slate-300'
                                      }`}
                                    />
                                  ))}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            );

                          return (
                            <React.Fragment key={rowKey}>
                              <tr
                                onClick={() =>
                                  setExpandedWorkshopKey(isExpanded ? null : rowKey)
                                }
                                className={`cursor-pointer transition hover:bg-slate-50/80 ${
                                  isExpanded ? 'bg-amber-50/40' : ''
                                }`}
                              >
                                <td className="py-3 text-center text-slate-400">
                                  {row.recent_evaluations.length > 0 ? (
                                    isExpanded ? (
                                      <ChevronUp className="mx-auto h-4 w-4" />
                                    ) : (
                                      <ChevronDown className="mx-auto h-4 w-4" />
                                    )
                                  ) : null}
                                </td>
                                <td className="py-3 pr-1 text-right">
                                  <p className="font-bold text-slate-900">{row.workshop_name}</p>
                                  <div className="mt-0.5 flex flex-wrap gap-1">
                                    {row.category_label && (
                                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                                        {row.category_label}
                                      </span>
                                    )}
                                    <span className="text-[10px] text-slate-400">
                                      ({fmt(row.evaluations_count)} تقييم)
                                    </span>
                                  </div>
                                </td>
                                <td className="py-3 text-center">
                                  {renderScoreCell(row.avg_delivery)}
                                </td>
                                <td className="py-3 text-center">
                                  {renderScoreCell(row.avg_work_quality)}
                                </td>
                                <td className="py-3 text-center">
                                  {renderScoreCell(row.avg_finishing_quality)}
                                </td>
                                <td className="py-3 text-center">
                                  {hasEval ? (
                                    <span
                                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-black tabular-nums ${
                                        row.overall_avg >= 4
                                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                          : row.overall_avg >= 3
                                          ? 'border-amber-200 bg-amber-50 text-amber-700'
                                          : 'border-rose-200 bg-rose-50 text-rose-700'
                                      }`}
                                    >
                                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />
                                      {row.overall_avg.toFixed(2)} / 5
                                    </span>
                                  ) : (
                                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-400">
                                      لم تُقيّم بعد
                                    </span>
                                  )}
                                </td>
                                <td className="py-3 text-center font-semibold tabular-nums text-slate-700">
                                  {fmt(row.total_dispatches)}
                                </td>
                                <td className="py-3 text-center tabular-nums">
                                  {row.on_time_percent != null ? (
                                    <span
                                      className={`font-bold ${
                                        row.on_time_percent >= 80
                                          ? 'text-emerald-600'
                                          : row.on_time_percent >= 60
                                          ? 'text-amber-600'
                                          : 'text-rose-600'
                                      }`}
                                    >
                                      {row.on_time_percent.toFixed(1)}%
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </td>
                                <td className="py-3 text-center tabular-nums">
                                  {row.defect_percent != null ? (
                                    <span
                                      className={`font-bold ${
                                        row.defect_percent <= 3
                                          ? 'text-emerald-600'
                                          : row.defect_percent <= 8
                                          ? 'text-amber-600'
                                          : 'text-rose-600'
                                      }`}
                                    >
                                      {row.defect_percent.toFixed(1)}%
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </td>
                              </tr>
                              {isExpanded && row.recent_evaluations.length > 0 && (
                                <tr>
                                  <td colSpan={9} className="bg-slate-50/70 px-4 py-3">
                                    <p className="text-xs font-bold text-slate-700 mb-2">
                                      أحدث التقييمات المسجّلة لورشة {row.workshop_name}:
                                    </p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                      {row.recent_evaluations.map((ev) => (
                                        <div
                                          key={ev.id}
                                          className="rounded-xl border border-slate-200 bg-white p-2.5 text-xs space-y-1"
                                        >
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="font-bold text-slate-800">
                                              موديل {ev.model_code || '—'} • {row.category_label}
                                            </span>
                                            <span className="font-black text-amber-700 tabular-nums">
                                              ⭐ {ev.overall_score.toFixed(2)} / 5
                                            </span>
                                          </div>
                                          <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
                                            <span>ميعاد: {ev.delivery_timeliness}/5</span>
                                            <span>شغل: {ev.work_quality}/5</span>
                                            <span>تشطيب: {ev.finishing_quality}/5</span>
                                          </div>
                                          {ev.notes && (
                                            <p className="text-[11px] text-slate-600 bg-slate-50 rounded-lg px-2 py-1">
                                              {ev.notes}
                                            </p>
                                          )}
                                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                                            <span>بواسطة: {ev.evaluated_by || '—'}</span>
                                            <span className="font-mono">
                                              {ev.created_at ? ev.created_at.slice(0, 10) : ''}
                                            </span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>
            </div>
          )}

          {targetsOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-2 sm:p-4" dir="rtl">
              <div className="w-[95vw] sm:w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                      <Target className="h-4 w-4" />
                    </span>
                    <div>
                      <h3 className="text-sm font-bold text-slate-800">تارجت الأقسام</h3>
                      <p className="text-xs text-slate-500">تُحفظ القيم وتُطبق على تقارير الإنتاج مباشرة.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTargetsOpen(false)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="max-h-[60vh] space-y-3 overflow-y-auto px-5 py-4">
                  {DEPARTMENT_ORDER.map((key) => {
                    const meta = DEPARTMENT_META[key];
                    const entry = targetsDraft[key] || { daily: 0, monthly: 0 };
                    return (
                      <div
                        key={key}
                        className="grid grid-cols-1 items-center gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[1fr_130px_130px]"
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                            {meta?.icon || <Factory className="h-4 w-4" />}
                          </span>
                          <p className="text-sm font-semibold text-slate-700">{meta?.label || key}</p>
                        </div>
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-medium text-slate-500">تارجت يومي</span>
                          <input
                            type="number"
                            min={0}
                            value={entry.daily}
                            onChange={(event) => updateTargetValue(key, 'daily', event.target.value)}
                            className={inputClass}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-medium text-slate-500">تارجت شهري</span>
                          <input
                            type="number"
                            min={0}
                            value={entry.monthly}
                            onChange={(event) => updateTargetValue(key, 'monthly', event.target.value)}
                            className={inputClass}
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
                  <button
                    type="button"
                    onClick={() => setTargetsOpen(false)}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveTargets()}
                    disabled={targetsSaving}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {targetsSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    حفظ التارجت
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

