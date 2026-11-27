import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpLeft,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Filter,
  Flame,
  Layers,
  Package,
  PackageCheck,
  Printer,
  Scissors,
  Search,
  Shirt,
  Sparkles,
  Tag,
  X
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ZoomableImage } from './ZoomableImage';
import {
  DesignModel,
  GarmentPart,
  PART_EMOJI,
  QCStageType,
  getPartLabel,
  partsForComposition
} from '../types';
import { modelPackagingPieces } from '../utils/packagingMaterials';
import { printUnifiedModelCard } from '../utils/printUnifiedModelCard';
import { SortBySelect, compareNatural, toTimestamp } from './SortBySelect';
import { useModalBackHandler } from '../utils/mobileBackNav';
import {
  getPartStageNavigationTarget,
  resolveEffectivePartStage,
  type StageNavigateFn
} from '../utils/stageNavigation';

type UnifiedSortKey =
  | 'newest'
  | 'oldest'
  | 'code_asc'
  | 'code_desc'
  | 'qty_desc'
  | 'qty_asc'
  | 'shortage_desc';

const UNIFIED_SORT_OPTIONS: { value: UnifiedSortKey; label: string }[] = [
  { value: 'newest', label: 'الأحدث أولاً' },
  { value: 'oldest', label: 'الأقدم أولاً' },
  { value: 'code_asc', label: 'الكود (تصاعدي)' },
  { value: 'code_desc', label: 'الكود (تنازلي)' },
  { value: 'qty_desc', label: 'المقصوص (الأكثر أولاً)' },
  { value: 'qty_asc', label: 'المقصوص (الأقل أولاً)' },
  { value: 'shortage_desc', label: 'العجز/الهالك (الأكثر)' }
];

type CoarseStageKey =
  | 'design'
  | 'cutting'
  | 'qc_before_print'
  | 'printing'
  | 'qc_after_print'
  | 'sewing'
  | 'qc_after_sewing'
  | 'finishing'
  | 'ironing'
  | 'packaging'
  | 'dest'
  | 'completed';

const STAGE_OPTIONS: { key: CoarseStageKey; label: string }[] = [
  { key: 'design', label: 'التصميم' },
  { key: 'cutting', label: 'القص' },
  { key: 'qc_before_print', label: 'العد قبل الطباعة' },
  { key: 'printing', label: 'المطابع والتطريز' },
  { key: 'qc_after_print', label: 'العد بعد الطباعة' },
  { key: 'sewing', label: 'المكن والخياطة' },
  { key: 'qc_after_sewing', label: 'العد بعد المكن' },
  { key: 'finishing', label: 'التشطيب' },
  { key: 'ironing', label: 'المكواة' },
  { key: 'packaging', label: 'التعبئة والتغليف' },
  { key: 'dest', label: 'الدَست' },
  { key: 'completed', label: 'مخزن الإنتاج التام' }
];

const QC_STAGE_LABELS: Record<QCStageType, string> = {
  before_print: 'العد قبل الطباعة',
  after_print: 'العد بعد الطباعة',
  after_sewing: 'العد بعد المكن'
};

const fmtInt = (val: unknown): string => {
  const n = Number(val || 0);
  return Math.round(Number.isFinite(n) ? n : 0).toLocaleString('ar-EG');
};

const fmtNum = (val: unknown): string => {
  const n = Number(val || 0);
  return (Number.isFinite(n) ? Number(n.toFixed(2)) : 0).toLocaleString('ar-EG', {
    maximumFractionDigits: 2
  });
};

const fmtDate = (val?: string | null): string => (val ? String(val).slice(0, 10) : '—');

const getModelParts = (model: DesignModel): GarmentPart[] => {
  if (model.garment_parts && model.garment_parts.length) {
    return model.garment_parts.filter((p) => ['shirt', 'pants', 'jacket', 'single'].includes(p));
  }
  return partsForComposition(model.garment_composition);
};

const inferCoarseStage = (status?: string): CoarseStageKey => {
  const s = (status || '').trim();
  if (s.includes('مخزن الإنتاج التام') || s.includes('مكتمل')) return 'completed';
  if (s.includes('دَست') || s.includes('دست')) return 'dest';
  if (s.includes('تعبئة') || s.includes('تغليف')) return 'packaging';
  if (s.includes('مكواة')) return 'ironing';
  if (s.includes('تشطيب')) return 'finishing';
  if (s.includes('بعد المكن')) return 'qc_after_sewing';
  if (s.includes('مكن')) return 'sewing';
  if (s.includes('بعد الطباعة')) return 'qc_after_print';
  if (s.includes('مطبعة') || s.includes('طباعة') || s.includes('تطريز')) return 'printing';
  if (s.includes('قبل الطباعة') || s.includes('فرز وكنترول')) return 'qc_before_print';
  if (s.includes('قص')) return 'cutting';
  return 'design';
};

const isModelCompleted = (status?: string): boolean => {
  const s = (status || '').trim();
  return s.includes('مخزن الإنتاج التام') || s.includes('مكتمل');
};

export const UnifiedModelCardsView: React.FC<{
  onNavigateToStage?: StageNavigateFn;
}> = ({ onNavigateToStage }) => {
  const {
    models,
    sizeDefs,
    fabrics,
    fabricColors,
    requirements,
    cuttingRecords,
    qcRecords,
    printDispatches,
    sewingDispatches,
    finishingRecords,
    assemblyStageRecords,
    packagingRequirements,
    getModelColorList,
    getModelSizeList,
    getPartStages,
    hasPermission,
    hasAssemblyPackagingAccess,
    globalSettings
  } = useApp();

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<UnifiedSortKey>('newest');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [workshopFilter, setWorkshopFilter] = useState<string>('all');
  const [shortageFilter, setShortageFilter] = useState<'all' | 'has_shortage' | 'no_shortage'>('all');
  const [completionFilter, setCompletionFilter] = useState<'all' | 'active' | 'completed'>('all');
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  useModalBackHandler(Boolean(selectedModelId), () => setSelectedModelId(null));

  const activeModels = useMemo(() => models.filter((m) => !m.is_deleted), [models]);

  // حساب الملخص لكل موديل مرة واحدة للبطاقات والفلاتر.
  const modelSummaries = useMemo(() => {
    return activeModels.map((model) => {
      const parts = getModelParts(model);
      const mCuts = cuttingRecords.filter((r) => r.model_id === model.id);
      const mPrint = printDispatches.filter((d) => d.model_id === model.id);
      const mSewing = sewingDispatches.filter((d) => d.model_id === model.id);
      const mQc = qcRecords.filter((q) => q.model_id === model.id);
      const mFin = finishingRecords.filter((r) => r.model_id === model.id);
      const mAsm = assemblyStageRecords.filter((r) => r.model_id === model.id);
      const mReq = packagingRequirements.find((r) => r.model_id === model.id) || null;

      const workshopNames = Array.from(
        new Set(
          [
            ...mPrint.map((d) => d.shop_name),
            ...mSewing.map((d) => d.workshop_name),
            ...mFin.map((r) => r.vendor_name || ''),
            ...mAsm.map((r) => r.vendor_name || ''),
            model.sewing_workshop || '',
            model.sewing_shirt_workshop || '',
            model.sewing_pants_workshop || ''
          ]
            .map((s) => s.trim())
            .filter(Boolean)
        )
      );

      // حساب إجمالي العجز عبر المراحل (طباعة + خياطة + هوالك QC + دَست + تصوير)
      const printShortage = mPrint.reduce((sum, d) => {
        const sent = Number(d.pieces_count || 0);
        const rec =
          d.status === 'تم الاستلام بالمصنع'
            ? Number(d.received_pieces ?? sent)
            : Number(d.received_pieces || 0);
        return sum + (d.status === 'تم الاستلام بالمصنع' ? Math.max(0, sent - rec) : 0);
      }, 0);
      const sewingShortage = mSewing.reduce((sum, d) => {
        const sent = Number(d.pieces_count || 0);
        const rec =
          d.status === 'تم الاستلام'
            ? Number(d.received_pieces ?? sent)
            : Number(d.received_pieces || 0);
        return sum + (d.status === 'تم الاستلام' ? Math.max(0, sent - rec) : 0);
      }, 0);
      const qcDefects = mQc.reduce((sum, q) => sum + Number(q.defect_qty ?? q.defect_pieces ?? 0), 0);
      const destRec = mAsm.find((r) => r.stage === 'dest');
      const destShortage = Number(destRec?.shortage_pieces || 0);
      const photoShortage = Number(mReq?.photography_shortage || 0);
      const totalShortage =
        printShortage + sewingShortage + qcDefects + destShortage + photoShortage;

      const coarseStage = inferCoarseStage(model.status);
      const completed = isModelCompleted(model.status);
      const totalCut = Number(model.total_cut_pieces || model.actual_cut_count || 0);
      const photoDone = Boolean(
        mReq?.steps?.received_from_photo || mReq?.received_from_photo_date
      );
      const cardsDone = Boolean(
        mReq?.steps?.received_printed_cards || mReq?.received_printed_cards_date
      );

      return {
        model,
        parts,
        coarseStage,
        completed,
        totalCut,
        workshopNames,
        totalShortage,
        printShortage,
        sewingShortage,
        qcDefects,
        destShortage,
        photoShortage,
        photoDone,
        cardsDone,
        mCuts,
        mPrint,
        mSewing,
        mQc,
        mFin,
        mAsm,
        mReq
      };
    });
  }, [
    activeModels,
    cuttingRecords,
    printDispatches,
    sewingDispatches,
    qcRecords,
    finishingRecords,
    assemblyStageRecords,
    packagingRequirements
  ]);

  const allWorkshopOptions = useMemo(() => {
    const names = new Set<string>();
    modelSummaries.forEach((item) => item.workshopNames.forEach((w) => names.add(w)));
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [modelSummaries]);

  const filteredSummaries = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = modelSummaries.filter((item) => {
      if (q) {
        const matchCode = item.model.model_code.toLowerCase().includes(q);
        const matchType = (item.model.model_type || '').toLowerCase().includes(q);
        if (!matchCode && !matchType) return false;
      }
      if (stageFilter !== 'all' && item.coarseStage !== stageFilter) return false;
      if (workshopFilter !== 'all' && !item.workshopNames.includes(workshopFilter)) return false;
      if (shortageFilter === 'has_shortage' && item.totalShortage <= 0) return false;
      if (shortageFilter === 'no_shortage' && item.totalShortage > 0) return false;
      if (completionFilter === 'active' && item.completed) return false;
      if (completionFilter === 'completed' && !item.completed) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      if (sortBy === 'code_asc') return compareNatural(a.model.model_code, b.model.model_code);
      if (sortBy === 'code_desc') return compareNatural(b.model.model_code, a.model.model_code);
      if (sortBy === 'qty_desc') return b.totalCut - a.totalCut;
      if (sortBy === 'qty_asc') return a.totalCut - b.totalCut;
      if (sortBy === 'shortage_desc') return b.totalShortage - a.totalShortage;
      if (sortBy === 'oldest') return toTimestamp(a.model.created_at) - toTimestamp(b.model.created_at);
      return toTimestamp(b.model.created_at) - toTimestamp(a.model.created_at);
    });
  }, [modelSummaries, search, stageFilter, workshopFilter, shortageFilter, completionFilter, sortBy]);

  const selectedSummary = useMemo(
    () => modelSummaries.find((item) => item.model.id === selectedModelId) || null,
    [modelSummaries, selectedModelId]
  );

  const handlePrintSelected = () => {
    if (!selectedSummary) return;
    const { model, mCuts, mPrint, mSewing, mQc, mFin, mAsm, mReq } = selectedSummary;
    const sizeDef = sizeDefs.find((s) => s.id === model.size_category_id);
    printUnifiedModelCard({
      siteName: globalSettings.site_name,
      logo: globalSettings.logo,
      model,
      sizeCategoryName: sizeDef?.name || '—',
      sizes: getModelSizeList(model.id),
      colors: getModelColorList(model.id),
      cuttingRecords: mCuts,
      requirements: requirements.filter((r) => r.model_id === model.id),
      fabrics,
      fabricColors,
      printDispatches: mPrint,
      sewingDispatches: mSewing,
      qcRecords: mQc,
      finishingRecords: mFin,
      assemblyStageRecords: mAsm,
      packagingRequirement: mReq
    });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-violet-700 via-indigo-700 to-slate-900 rounded-3xl p-6 text-white shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-black">بطاقة الموديل الشاملة (موديل بموديل)</h1>
              <p className="text-xs text-white/80 font-semibold mt-1 leading-relaxed">
                عرض موحّد لكل موديل في بطاقة واحدة — اضغط على أي موديل لفتح الشيت التفصيلي الشامل
                مقسّماً حسب القطعة (القص، المطابع، المكن، الفرز، التشطيب، التغليف، الدَست، التصوير والباركود).
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="px-3 py-1.5 rounded-full bg-white/15 text-xs font-black">
              إجمالي الموديلات: {fmtInt(activeModels.length)}
            </span>
            <span className="px-3 py-1.5 rounded-full bg-white/15 text-xs font-black">
              المعروض: {fmtInt(filteredSummaries.length)}
            </span>
          </div>
        </div>
      </div>

      {/* Search & Filters Bar */}
      <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بكود الموديل أو النوع / الاسم..."
              className="w-full ps-9 pe-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>

          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700"
          >
            <option value="all">كل المراحل (12 مرحلة)</option>
            {STAGE_OPTIONS.map((st) => (
              <option key={st.key} value={st.key}>
                {st.label}
              </option>
            ))}
          </select>

          <select
            value={workshopFilter}
            onChange={(e) => setWorkshopFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700"
          >
            <option value="all">كل الورش والمطابع</option>
            {allWorkshopOptions.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>

          <div className="flex gap-1.5">
            <select
              value={shortageFilter}
              onChange={(e) => setShortageFilter(e.target.value as any)}
              className="flex-1 px-2.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700"
            >
              <option value="all">العجز: الكل</option>
              <option value="has_shortage">بها عجز / هالك</option>
              <option value="no_shortage">بدون عجز</option>
            </select>
            <select
              value={completionFilter}
              onChange={(e) => setCompletionFilter(e.target.value as any)}
              className="flex-1 px-2.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700"
            >
              <option value="all">الحالة: الكل</option>
              <option value="active">نشط بالتشغيل</option>
              <option value="completed">مكتمل / مخزن التام</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100">
          <SortBySelect
            value={sortBy}
            onChange={(v) => setSortBy(v as UnifiedSortKey)}
            options={UNIFIED_SORT_OPTIONS}
          />
        </div>

        {(search ||
          stageFilter !== 'all' ||
          workshopFilter !== 'all' ||
          shortageFilter !== 'all' ||
          completionFilter !== 'all') && (
          <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100">
            <span className="inline-flex items-center gap-1 font-semibold">
              <Filter className="w-3.5 h-3.5 text-violet-600" />
              نتائج التصفية: {fmtInt(filteredSummaries.length)} موديل
            </span>
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setStageFilter('all');
                setWorkshopFilter('all');
                setShortageFilter('all');
                setCompletionFilter('all');
              }}
              className="text-violet-700 font-bold hover:underline cursor-pointer"
            >
              مسح كل الفلاتر
            </button>
          </div>
        )}
      </div>

      {/* Unified Model Cards Grid (1 card per model) */}
      {filteredSummaries.length === 0 ? (
        <div className="bg-white rounded-3xl border border-dashed border-slate-300 p-12 text-center">
          <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-black text-slate-700">لا توجد موديلات مطابقة للبحث والفلاتر</p>
          <p className="text-xs text-slate-400 mt-1">جرّب تغيير البحث أو إزالة بعض الفلاتر.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSummaries.map((item) => {
            const { model, parts, totalCut, totalShortage, workshopNames, photoDone, cardsDone } =
              item;
            const sizeDef = sizeDefs.find((s) => s.id === model.size_category_id);

            return (
              <div
                key={model.id}
                onClick={() => setSelectedModelId(model.id)}
                className="group bg-white rounded-3xl border border-slate-200 hover:border-violet-400 hover:shadow-md p-4 transition cursor-pointer flex flex-col gap-3"
              >
                <div className="flex items-start gap-3">
                  <div className="w-16 h-16 rounded-2xl border border-slate-200 bg-slate-50 p-1 shrink-0 overflow-hidden flex items-center justify-center">
                    {model.image ? (
                      <img
                        src={model.image}
                        alt={model.model_code}
                        className="w-full h-full object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <Shirt className="w-7 h-7 text-slate-300" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-black text-base text-slate-900 truncate group-hover:text-violet-700 transition">
                        {model.model_code}
                      </h3>
                      <span
                        className={`shrink-0 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                          item.completed
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-violet-50 text-violet-800 border-violet-200'
                        }`}
                      >
                        {model.status || 'تصميم'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 font-semibold truncate mt-0.5">
                      {model.model_type || 'بدون نوع'}
                      {sizeDef ? ` • ${sizeDef.name}` : ''}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {parts.map((part) => (
                        <span
                          key={part}
                          className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-bold"
                        >
                          {PART_EMOJI[part]} {getPartLabel(part)}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Quick metrics */}
                <div className="grid grid-cols-3 gap-1.5 text-center">
                  <div className="rounded-xl bg-slate-50 border border-slate-100 py-1.5 px-1">
                    <span className="block text-[9px] font-bold text-slate-400">المستهدف</span>
                    <strong className="text-xs font-black text-slate-800 tabular-nums">
                      {fmtInt(model.target_cut_quantity)}
                    </strong>
                  </div>
                  <div className="rounded-xl bg-blue-50/70 border border-blue-100 py-1.5 px-1">
                    <span className="block text-[9px] font-bold text-blue-500">المقصوص</span>
                    <strong className="text-xs font-black text-blue-800 tabular-nums">
                      {fmtInt(totalCut)}
                    </strong>
                  </div>
                  <div
                    className={`rounded-xl border py-1.5 px-1 ${
                      totalShortage > 0
                        ? 'bg-rose-50 border-rose-200 text-rose-700'
                        : 'bg-emerald-50/70 border-emerald-200 text-emerald-700'
                    }`}
                  >
                    <span className="block text-[9px] font-bold">العجز / الهالك</span>
                    <strong className="text-xs font-black tabular-nums">
                      {totalShortage > 0 ? fmtInt(totalShortage) : '0'}
                    </strong>
                  </div>
                </div>

                {/* Workshops & Ambalage status */}
                <div className="space-y-1.5 pt-1 border-t border-slate-100 text-[11px]">
                  <p className="text-slate-500 truncate">
                    <span className="font-bold text-slate-700">الورش: </span>
                    {workshopNames.length ? workshopNames.join(' • ') : 'لم تُحدد بعد'}
                  </p>
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          photoDone
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-50 text-slate-500 border-slate-200'
                        }`}
                      >
                        <Camera className="w-3 h-3" />
                        {photoDone ? 'تم التصوير' : 'لم يُصوّر'}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          cardsDone
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-50 text-slate-500 border-slate-200'
                        }`}
                      >
                        <Tag className="w-3 h-3" />
                        {cardsDone ? 'الكارت جاهز' : 'بدون كارت'}
                      </span>
                    </div>
                    <span className="text-[11px] font-black text-violet-700 group-hover:translate-x-[-2px] transition">
                      فتح البطاقة ←
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detailed Model Sheet Modal */}
      {selectedSummary && (() => {
        const { model, parts, mCuts, mPrint, mSewing, mQc, mFin, mAsm, mReq } = selectedSummary;
        const sizeDef = sizeDefs.find((s) => s.id === model.size_category_id);
        const sizes = getModelSizeList(model.id);
        const colors = getModelColorList(model.id);
        const modelReqs = requirements.filter((r) => r.model_id === model.id);
        const expectedSets = modelPackagingPieces(model);
        const packRec = mAsm.find((r) => r.stage === 'packaging');
        const destRec = mAsm.find((r) => r.stage === 'dest');
        const ironingRecs = mAsm.filter((r) => r.stage === 'ironing');

        const sentPhoto = mReq?.steps?.sent_to_photo || mReq?.sent_to_photo_date;
        const recvPhoto = mReq?.steps?.received_from_photo || mReq?.received_from_photo_date;
        const sentCards = mReq?.steps?.sent_to_print_cards || mReq?.sent_to_print_cards_date;
        const recvCards = mReq?.steps?.received_printed_cards || mReq?.received_printed_cards_date;

        return (
          <div
            className="fixed inset-0 z-50 bg-slate-900/65 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4"
            onClick={() => setSelectedModelId(null)}
          >
            <div
              className="bg-white rounded-3xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150"
              dir="rtl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal sticky top bar */}
              <div className="px-5 py-4 bg-gradient-to-l from-violet-700 via-indigo-700 to-slate-900 text-white flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-black truncate">
                      بطاقة الموديل الشاملة — {model.model_code}
                    </h2>
                    <p className="text-xs text-white/80 font-semibold truncate">
                      {model.model_type || 'بدون نوع'} • {sizeDef?.name || 'فئة مقاس غير محددة'} •{' '}
                      {model.status}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePrintSelected}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white text-slate-900 hover:bg-slate-100 text-xs font-black shadow-sm transition cursor-pointer"
                  >
                    <Printer className="w-4 h-4" />
                    <span>طباعة بطاقة الموديل</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedModelId(null)}
                    className="p-2 rounded-full bg-white/15 hover:bg-white/25 transition cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Scrollable Master Sheet Body */}
              <div className="p-5 overflow-y-auto space-y-5 flex-1 bg-slate-50/50">
                {/* 1. Header Card */}
                <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="w-28 h-28 rounded-2xl border border-slate-200 bg-slate-50 p-1.5 shrink-0 flex items-center justify-center mx-auto sm:mx-0">
                      <ZoomableImage
                        src={model.image}
                        alt={model.model_code}
                        downloadName={`${model.model_code}.jpg`}
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                      <div className="rounded-xl bg-slate-50 border border-slate-100 p-2.5">
                        <span className="block text-[10px] font-bold text-slate-400">كود الموديل</span>
                        <strong className="text-sm font-black text-slate-900">{model.model_code}</strong>
                      </div>
                      <div className="rounded-xl bg-slate-50 border border-slate-100 p-2.5">
                        <span className="block text-[10px] font-bold text-slate-400">النوع / الاسم</span>
                        <strong className="font-bold text-slate-800">{model.model_type || '—'}</strong>
                      </div>
                      <div className="rounded-xl bg-slate-50 border border-slate-100 p-2.5">
                        <span className="block text-[10px] font-bold text-slate-400">فئة المقاسات</span>
                        <strong className="font-bold text-slate-800">{sizeDef?.name || '—'}</strong>
                      </div>
                      <div className="rounded-xl bg-indigo-50/70 border border-indigo-100 p-2.5">
                        <span className="block text-[10px] font-bold text-indigo-500">الكمية المستهدفة</span>
                        <strong className="text-sm font-black text-indigo-900 tabular-nums">
                          {fmtInt(model.target_cut_quantity)} طقم
                        </strong>
                      </div>
                      <div className="rounded-xl bg-blue-50/70 border border-blue-100 p-2.5">
                        <span className="block text-[10px] font-bold text-blue-500">إجمالي المقصوص</span>
                        <strong className="text-sm font-black text-blue-900 tabular-nums">
                          {fmtInt(selectedSummary.totalCut)} قطعة
                        </strong>
                      </div>
                      <div className="rounded-xl bg-violet-50/70 border border-violet-100 p-2.5">
                        <span className="block text-[10px] font-bold text-violet-500">الحالة الحالية</span>
                        <strong className="font-black text-violet-900">{model.status || '—'}</strong>
                      </div>
                    </div>
                  </div>
                  {(sizes.length > 0 || colors.length > 0) && (
                    <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-4 text-[11px]">
                      <div>
                        <span className="font-bold text-slate-500 me-1.5">المقاسات:</span>
                        {sizes.length ? (
                          sizes.map((s) => (
                            <span
                              key={s}
                              className="inline-block me-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold"
                            >
                              {s}
                            </span>
                          ))
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </div>
                      <div>
                        <span className="font-bold text-slate-500 me-1.5">الألوان:</span>
                        {colors.length ? (
                          colors.map((c) => (
                            <span
                              key={c}
                              className="inline-block me-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold"
                            >
                              {c}
                            </span>
                          ))
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* المرحلة الحالية لكل قطعة + أزرار الانتقال السريع (مقيّدة بالصلاحيات) */}
                  {(() => {
                    const partStages = getPartStages(model.id);
                    return (
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <p className="text-[11px] font-black text-slate-600 mb-2">
                          المرحلة الحالية لكل قطعة والانتقال السريع:
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          {parts.map((part) => {
                            const effectiveStage = resolveEffectivePartStage(
                              model,
                              part,
                              partStages
                            );
                            const target = getPartStageNavigationTarget(effectiveStage);
                            const canJump =
                              Boolean(onNavigateToStage) &&
                              (target.permissionSection === 'assembly_packaging'
                                ? hasAssemblyPackagingAccess()
                                : hasPermission(target.permissionSection));

                            return (
                              <div
                                key={part}
                                className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <span className="block text-xs font-black text-slate-800">
                                    {PART_EMOJI[part]} {getPartLabel(part)}
                                  </span>
                                  <span
                                    className={`mt-1 inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold ${target.badgeClass}`}
                                  >
                                    {target.stageLabel}
                                  </span>
                                </div>
                                {canJump && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedModelId(null);
                                      onNavigateToStage?.(
                                        target.tab,
                                        target.subTab,
                                        target.passModelId ? model.id : undefined
                                      );
                                    }}
                                    className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold shadow-xs transition cursor-pointer ${target.buttonClass}`}
                                    title={`الانتقال المباشر إلى ${target.sectionLabel}`}
                                  >
                                    <span>{target.sectionLabel}</span>
                                    <ArrowUpLeft className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </section>

                {/* 2. Cutting & Fabric */}
                <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3">
                  <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
                    <Scissors className="w-4 h-4 text-rose-600" />
                    <span>1. القص والقماش (مقسّم حسب القطعة)</span>
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                    {parts.map((part) => {
                      const partCuts = mCuts.filter(
                        (r) =>
                          ((r.part_type || r.part || 'shirt') as string) === part && !r.is_sub_cut
                      );
                      const cutQty =
                        Number(model.cut_summary?.[part] || 0) ||
                        partCuts.reduce(
                          (s, r) => s + Number(r.pieces_count || r.cut_pieces || 0),
                          0
                        );
                      const layers = partCuts.reduce((s, r) => s + Number(r.layers_count || 0), 0);
                      const weight = partCuts.reduce((s, r) => s + Number(r.layer_weight || 0), 0);
                      const lastDate = partCuts[partCuts.length - 1]?.created_at || model.cut_at;
                      return (
                        <div
                          key={part}
                          className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-1 text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-black text-slate-800">
                              {PART_EMOJI[part]} {getPartLabel(part)}
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-black tabular-nums">
                              {fmtInt(cutQty)} قطعة
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500">
                            راقات: <strong>{fmtInt(layers)}</strong>
                            {weight > 0 ? ` • وزن: ${fmtNum(weight)} كجم` : ''}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            تاريخ القص: <span className="font-mono">{fmtDate(lastDate)}</span>
                          </p>
                        </div>
                      );
                    })}
                  </div>
                  <div className="rounded-xl bg-amber-50/70 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                    <strong className="me-1">ملخص القماش:</strong>
                    {modelReqs.length > 0 ? (
                      modelReqs
                        .map((req) => {
                          const fc = fabricColors.find((c) => c.id === req.color_id);
                          const fab = fc ? fabrics.find((f) => f.id === fc.fabric_id) : undefined;
                          const qty = Number(req.required_quantity ?? req.planned_quantity ?? 0);
                          return `${fab?.name || 'قماش'}${fc ? ` (${fc.color_name})` : ''}: ${fmtNum(qty)} ${fab?.unit || ''}`;
                        })
                        .join(' • ')
                    ) : model.withdrawn_fabric_qty ? (
                      <span>إجمالي المسحوب من مخزن القماش: {fmtNum(model.withdrawn_fabric_qty)}</span>
                    ) : (
                      <span className="text-amber-700">لا توجد بيانات صرف قماش مسجّلة بعد.</span>
                    )}
                  </div>
                </section>

                {/* 3. Print / Embroidery */}
                <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3">
                  <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-teal-600" />
                    <span>2. المطابع والتطريز (انطبع فين — لكل قطعة)</span>
                  </h3>
                  {mPrint.length === 0 ? (
                    <p className="text-xs text-slate-400">
                      لا توجد تشغيلات مطابع أو تطريز مسجّلة لهذا الموديل.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500">
                            <th className="py-2 text-right">القطعة</th>
                            <th className="py-2 text-right">المطبعة / الورشة</th>
                            <th className="py-2 text-center">المرسل</th>
                            <th className="py-2 text-center">المستلم</th>
                            <th className="py-2 text-center">العجز</th>
                            <th className="py-2 text-center">تاريخ الإرسال</th>
                            <th className="py-2 text-center">تاريخ الاستلام</th>
                            <th className="py-2 text-center">الحالة</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {mPrint.map((d) => {
                            const sent = Number(d.pieces_count || 0);
                            const rec =
                              d.status === 'تم الاستلام بالمصنع'
                                ? Number(d.received_pieces ?? sent)
                                : Number(d.received_pieces || 0);
                            const shortage = Math.max(0, sent - rec);
                            return (
                              <tr key={d.id}>
                                <td className="py-2 font-bold text-slate-800">
                                  {d.piece_label || getPartLabel(d.piece_type || 'shirt')}
                                </td>
                                <td className="py-2 font-bold text-teal-800">{d.shop_name}</td>
                                <td className="py-2 text-center tabular-nums">{fmtInt(sent)}</td>
                                <td className="py-2 text-center tabular-nums text-emerald-700 font-bold">
                                  {fmtInt(rec)}
                                </td>
                                <td
                                  className={`py-2 text-center tabular-nums font-black ${
                                    shortage > 0 ? 'text-rose-600' : 'text-emerald-600'
                                  }`}
                                >
                                  {fmtInt(shortage)}
                                </td>
                                <td className="py-2 text-center font-mono text-slate-500">
                                  {fmtDate(d.dispatched_at)}
                                </td>
                                <td className="py-2 text-center font-mono text-slate-500">
                                  {fmtDate(d.received_at || d.expected_delivery_date)}
                                </td>
                                <td className="py-2 text-center">
                                  <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold text-[10px]">
                                    {d.status}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                {/* 4. Sewing */}
                <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3">
                  <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
                    <Shirt className="w-4 h-4 text-emerald-600" />
                    <span>3. المكن والخياطة (لكل قطعة)</span>
                  </h3>
                  {mSewing.length === 0 ? (
                    <p className="text-xs text-slate-400">
                      لا توجد تشغيلات مكن أو خياطة مسجّلة لهذا الموديل.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500">
                            <th className="py-2 text-right">القطعة</th>
                            <th className="py-2 text-right">ورشة المكن</th>
                            <th className="py-2 text-center">المرسل</th>
                            <th className="py-2 text-center">المستلم</th>
                            <th className="py-2 text-center">العجز</th>
                            <th className="py-2 text-center">تاريخ الإرسال</th>
                            <th className="py-2 text-center">تاريخ الاستلام</th>
                            <th className="py-2 text-center">الحالة</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {mSewing.map((d) => {
                            const sent = Number(d.pieces_count || 0);
                            const rec =
                              d.status === 'تم الاستلام'
                                ? Number(d.received_pieces ?? sent)
                                : Number(d.received_pieces || 0);
                            const shortage = Math.max(0, sent - rec);
                            return (
                              <tr key={d.id}>
                                <td className="py-2 font-bold text-slate-800">
                                  {d.piece_label || getPartLabel(d.piece_type || 'shirt')}
                                </td>
                                <td className="py-2 font-bold text-emerald-800">
                                  {d.workshop_name}
                                </td>
                                <td className="py-2 text-center tabular-nums">{fmtInt(sent)}</td>
                                <td className="py-2 text-center tabular-nums text-emerald-700 font-bold">
                                  {fmtInt(rec)}
                                </td>
                                <td
                                  className={`py-2 text-center tabular-nums font-black ${
                                    shortage > 0 ? 'text-rose-600' : 'text-emerald-600'
                                  }`}
                                >
                                  {fmtInt(shortage)}
                                </td>
                                <td className="py-2 text-center font-mono text-slate-500">
                                  {fmtDate(d.dispatched_at)}
                                </td>
                                <td className="py-2 text-center font-mono text-slate-500">
                                  {fmtDate(d.received_at || d.expected_delivery_date)}
                                </td>
                                <td className="py-2 text-center">
                                  <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold text-[10px]">
                                    {d.status}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                {/* 5. QC & Defects */}
                <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3">
                  <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
                    <ClipboardCheck className="w-4 h-4 text-purple-600" />
                    <span>4. الفرز والجودة والهوالك (لكل مرحلة وقطعة)</span>
                  </h3>
                  {mQc.length === 0 ? (
                    <p className="text-xs text-slate-400">لا توجد سجلات فرز أو جودة مسجّلة بعد.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500">
                            <th className="py-2 text-right">مرحلة الفرز</th>
                            <th className="py-2 text-right">القطعة</th>
                            <th className="py-2 text-center">السليم</th>
                            <th className="py-2 text-center">الهالك / العيوب</th>
                            <th className="py-2 text-center">العجز</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(['before_print', 'after_print', 'after_sewing'] as QCStageType[]).flatMap(
                            (stage) =>
                              parts.map((part) => {
                                const recs = mQc.filter(
                                  (q) =>
                                    q.stage === stage &&
                                    ((q.part_type || q.partType || 'shirt') as string) === part
                                );
                                if (!recs.length) return null;
                                const good = recs.reduce(
                                  (s, r) => s + Number(r.good_qty ?? r.counted_pieces ?? 0),
                                  0
                                );
                                const defect = recs.reduce(
                                  (s, r) => s + Number(r.defect_qty ?? r.defect_pieces ?? 0),
                                  0
                                );
                                const refCut =
                                  Number(model.cut_summary?.[part] || 0) ||
                                  recs.reduce(
                                    (s, r) => s + Number(r.pieces_cut || r.cut_pieces_ref || 0),
                                    0
                                  );
                                const shortage =
                                  refCut > 0 ? Math.max(0, refCut - (good + defect)) : 0;
                                return (
                                  <tr key={`${stage}-${part}`}>
                                    <td className="py-2 font-bold text-slate-800">
                                      {QC_STAGE_LABELS[stage]}
                                    </td>
                                    <td className="py-2">{getPartLabel(part)}</td>
                                    <td className="py-2 text-center font-black text-emerald-700 tabular-nums">
                                      {fmtInt(good)}
                                    </td>
                                    <td
                                      className={`py-2 text-center font-bold tabular-nums ${
                                        defect > 0 ? 'text-rose-600' : 'text-slate-500'
                                      }`}
                                    >
                                      {fmtInt(defect)}
                                    </td>
                                    <td
                                      className={`py-2 text-center font-bold tabular-nums ${
                                        shortage > 0 ? 'text-rose-600' : 'text-emerald-600'
                                      }`}
                                    >
                                      {fmtInt(shortage)}
                                    </td>
                                  </tr>
                                );
                              })
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                {/* 6. Assembly & Packaging */}
                <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3">
                  <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
                    <Package className="w-4 h-4 text-orange-600" />
                    <span>5. التشطيب والمكواة والتعبئة والدَست</span>
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    {/* التشطيب */}
                    <div className="rounded-xl border border-purple-200 bg-purple-50/40 p-3 space-y-1.5">
                      <div className="flex items-center gap-1.5 font-black text-purple-900">
                        <Sparkles className="w-4 h-4" /> التشطيب
                      </div>
                      {mFin.length ? (
                        mFin.map((rec) => (
                          <div
                            key={rec.id}
                            className="rounded-lg bg-white border border-purple-100 p-2 space-y-0.5"
                          >
                            <div className="flex justify-between font-bold">
                              <span>{rec.piece_label || getPartLabel(rec.part_type)}</span>
                              <span className={rec.is_received ? 'text-emerald-700' : 'text-amber-700'}>
                                {rec.is_received ? '✅ مكتمل' : '⏳ قيد التنفيذ'}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-600">
                              الورشة: <strong>{rec.vendor_name || '—'}</strong>
                            </p>
                            <p className="text-[10px] font-mono text-slate-500">
                              دخول: {fmtDate(rec.entry_date)} • خروج:{' '}
                              {fmtDate(rec.actual_exit_date || rec.expected_exit_date)}
                            </p>
                          </div>
                        ))
                      ) : (
                        <p className="text-[11px] text-slate-400">لم يبدأ بعد.</p>
                      )}
                    </div>

                    {/* المكواة */}
                    <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-3 space-y-1.5">
                      <div className="flex items-center gap-1.5 font-black text-rose-900">
                        <Flame className="w-4 h-4" /> المكواة
                      </div>
                      {ironingRecs.length ? (
                        ironingRecs.map((rec) => (
                          <div
                            key={rec.id}
                            className="rounded-lg bg-white border border-rose-100 p-2 space-y-0.5"
                          >
                            <div className="flex justify-between font-bold">
                              <span>{rec.part_label || getPartLabel(rec.part_type || 'shirt')}</span>
                              <span className={rec.is_completed ? 'text-emerald-700' : 'text-amber-700'}>
                                {rec.is_completed ? '✅ مكتمل' : '⏳ قيد التنفيذ'}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-600">
                              الورشة: <strong>{rec.vendor_name || '—'}</strong>
                            </p>
                            <p className="text-[10px] font-mono text-slate-500">
                              دخول: {fmtDate(rec.entry_date)} • خروج:{' '}
                              {fmtDate(rec.actual_exit_date || rec.expected_exit_date)}
                            </p>
                          </div>
                        ))
                      ) : (
                        <p className="text-[11px] text-slate-400">لم يبدأ بعد.</p>
                      )}
                    </div>

                    {/* التعبئة والتغليف */}
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 font-black text-emerald-900">
                          <Package className="w-4 h-4" /> التعبئة والتغليف
                        </span>
                        {packRec?.materials_deducted && (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-bold">
                            خامات مخصومة ✓
                          </span>
                        )}
                      </div>
                      {packRec ? (
                        <>
                          <p className="text-[11px] text-slate-600">
                            الورشة: <strong>{packRec.vendor_name || '—'}</strong> •{' '}
                            {packRec.is_completed ? '✅ مكتملة' : '⏳ قيد التنفيذ'}
                          </p>
                          <p className="text-[10px] font-mono text-slate-500">
                            دخول: {fmtDate(packRec.entry_date)} • خروج:{' '}
                            {fmtDate(packRec.actual_exit_date || packRec.expected_exit_date)}
                          </p>
                        </>
                      ) : (
                        <p className="text-[11px] text-slate-400">لم يبدأ بعد.</p>
                      )}
                    </div>

                    {/* الدَست */}
                    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 font-black text-indigo-900">
                          <PackageCheck className="w-4 h-4" /> الدَست
                        </span>
                        {destRec && (destRec.shortage_pieces || 0) > 0 && (
                          <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-bold">
                            عجز {fmtInt(destRec.shortage_pieces)}
                          </span>
                        )}
                      </div>
                      {destRec ? (
                        <>
                          <p className="text-[11px] text-slate-600">
                            الورشة: <strong>{destRec.vendor_name || '—'}</strong> •{' '}
                            {destRec.is_completed ? '✅ مكتمل' : '⏳ قيد التنفيذ'}
                          </p>
                          <p className="text-[11px] font-bold text-indigo-900">
                            المتوقع: {fmtInt(destRec.expected_pieces || expectedSets)} • المنفذ:{' '}
                            {destRec.completed_pieces != null
                              ? fmtInt(destRec.completed_pieces)
                              : '—'}{' '}
                            • العجز:{' '}
                            <span
                              className={
                                (destRec.shortage_pieces || 0) > 0
                                  ? 'text-rose-600'
                                  : 'text-emerald-700'
                              }
                            >
                              {fmtInt(destRec.shortage_pieces || 0)}
                            </span>
                          </p>
                          <p className="text-[10px] font-mono text-slate-500">
                            دخول: {fmtDate(destRec.entry_date)} • خروج:{' '}
                            {fmtDate(destRec.actual_exit_date || destRec.expected_exit_date)}
                          </p>
                        </>
                      ) : (
                        <p className="text-[11px] text-slate-400">لم يبدأ بعد.</p>
                      )}
                    </div>
                  </div>
                </section>

                {/* 7. Packaging Requirements (Photography & Barcode/Card) */}
                <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3">
                  <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
                    <Camera className="w-4 h-4 text-amber-600" />
                    <span>6. متطلبات الأمبالاج (التصوير والباركود / الكارت)</span>
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div
                      className={`rounded-xl border p-3 space-y-1.5 ${
                        recvPhoto
                          ? 'bg-emerald-50/60 border-emerald-200'
                          : sentPhoto
                          ? 'bg-amber-50/60 border-amber-200'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between font-black">
                        <span className="flex items-center gap-1.5">
                          <Camera className="w-4 h-4" /> حالة التصوير
                        </span>
                        <span>
                          {recvPhoto
                            ? '✅ اتصور وتم الاستلام'
                            : sentPhoto
                            ? '⏳ في التصوير'
                            : '❌ لم يُصوّر بعد'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 font-mono">
                        إرسال: {fmtDate(sentPhoto)} • استلام: {fmtDate(recvPhoto)}
                      </p>
                      <p className="text-[11px] font-bold text-slate-700">
                        عينات التصوير — مرسل: {fmtInt(mReq?.photography_sent_qty || 0)} • مستلم:{' '}
                        {fmtInt(mReq?.photography_received_qty || 0)} • عجز:{' '}
                        <span
                          className={
                            Number(mReq?.photography_shortage || 0) > 0
                              ? 'text-rose-600 font-black'
                              : 'text-emerald-700'
                          }
                        >
                          {fmtInt(mReq?.photography_shortage || 0)}
                        </span>
                      </p>
                    </div>

                    <div
                      className={`rounded-xl border p-3 space-y-1.5 ${
                        recvCards
                          ? 'bg-emerald-50/60 border-emerald-200'
                          : sentCards
                          ? 'bg-amber-50/60 border-amber-200'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between font-black">
                        <span className="flex items-center gap-1.5">
                          <Tag className="w-4 h-4" /> حالة الباركود والكارت
                        </span>
                        <span>
                          {recvCards
                            ? '✅ اتعمل وتم الاستلام'
                            : sentCards
                            ? '⏳ جاري الطباعة'
                            : '❌ لم يُطبع بعد'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 font-mono">
                        إرسال لطباعة الكروت: {fmtDate(sentCards)}
                      </p>
                      <p className="text-[11px] text-slate-600 font-mono">
                        استلام الكروت والباركود: {fmtDate(recvCards)}
                      </p>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default UnifiedModelCardsView;
