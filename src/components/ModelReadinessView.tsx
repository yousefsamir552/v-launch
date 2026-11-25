import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Printer,
  Shirt,
  Sparkles,
  Flame,
  Package,
  PackageCheck,
  Search,
  FileSpreadsheet,
  AlertTriangle,
  Camera,
  CreditCard,
  ArrowUpLeft,
  FileText,
  X,
  CheckCircle2,
  Clock,
  Layers,
  Tag,
  ImageOff
} from 'lucide-react';
import {
  DesignModel,
  GarmentPart,
  PART_EMOJI,
  PartStage,
  ReadinessStageKey,
  getPartLabel
} from '../types';
import { finishedSetsOf, photographyOutstandingOf, stageRank } from '../utils/completedModels';
import { qcPartStageCounts } from '../utils/qcStageCounts';
import { ZoomableImage } from './ZoomableImage';
import { exportCsv, datedFileName, CsvValue } from '../utils/exportExcel';
import {
  escapeHtml,
  logClientPrintAction,
  openUnifiedPrintWindow,
  renderSignatureBar,
  safeImageSrc
} from '../utils/printShared';

type ReadinessBucket = 'ready' | 'in_progress' | 'completed';
type GenderBucket = 'boys' | 'girls' | 'other';
type PhotoCardFilter =
  | 'all'
  | 'no_photo'
  | 'has_photo'
  | 'no_card'
  | 'has_card'
  | 'both_done';

interface StageConfig {
  key: ReadinessStageKey;
  label: string;
  fullTitle: string;
  precedingLabel: string;
  actionLabel: string;
  targetTab: string;
  targetPerm: string;
  accentBg: string;
  accentText: string;
  accentBadge: string;
  icon: any;
  targetPartStage: PartStage;
}

const STAGE_CONFIGS: Record<ReadinessStageKey, StageConfig> = {
  print: {
    key: 'print',
    label: 'المطابع',
    fullTitle: 'جاهزية الموديلات — قسم المطابع',
    precedingLabel: 'العد قبل الطباعة',
    actionLabel: 'إرسال للمطبعة',
    targetTab: 'printing',
    targetPerm: 'printing',
    accentBg: 'bg-teal-600',
    accentText: 'text-teal-700',
    accentBadge: 'bg-teal-50 text-teal-800 border-teal-200',
    icon: Printer,
    targetPartStage: 'printing'
  },
  sewing: {
    key: 'sewing',
    label: 'المكن',
    fullTitle: 'جاهزية الموديلات — قسم المكن',
    precedingLabel: 'العد بعد الطباعة / تخطي الطباعة',
    actionLabel: 'إرسال للمكن',
    targetTab: 'sewing',
    targetPerm: 'sewing',
    accentBg: 'bg-emerald-600',
    accentText: 'text-emerald-700',
    accentBadge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    icon: Shirt,
    targetPartStage: 'sewing'
  },
  finishing: {
    key: 'finishing',
    label: 'التشطيب',
    fullTitle: 'جاهزية الموديلات — قسم التشطيب',
    precedingLabel: 'العد بعد المكن',
    actionLabel: 'إدخال للتشطيب',
    targetTab: 'assembly_packaging',
    targetPerm: 'assembly_packaging',
    accentBg: 'bg-purple-600',
    accentText: 'text-purple-700',
    accentBadge: 'bg-purple-50 text-purple-800 border-purple-200',
    icon: Sparkles,
    targetPartStage: 'finishing'
  },
  ironing: {
    key: 'ironing',
    label: 'المكواة',
    fullTitle: 'جاهزية الموديلات — قسم المكواة',
    precedingLabel: 'التشطيب',
    actionLabel: 'إدخال للمكواة',
    targetTab: 'assembly_packaging',
    targetPerm: 'assembly_packaging',
    accentBg: 'bg-rose-600',
    accentText: 'text-rose-700',
    accentBadge: 'bg-rose-50 text-rose-800 border-rose-200',
    icon: Flame,
    targetPartStage: 'ironing'
  },
  packaging: {
    key: 'packaging',
    label: 'التغليف',
    fullTitle: 'جاهزية الموديلات — قسم التغليف',
    precedingLabel: 'المكواة (اكتمال جميع القطع)',
    actionLabel: 'إدخال للتغليف',
    targetTab: 'assembly_packaging',
    targetPerm: 'assembly_packaging',
    accentBg: 'bg-orange-600',
    accentText: 'text-orange-700',
    accentBadge: 'bg-orange-50 text-orange-800 border-orange-200',
    icon: Package,
    targetPartStage: 'packaging'
  },
  dest: {
    key: 'dest',
    label: 'الدَست',
    fullTitle: 'جاهزية الموديلات — قسم الدَست',
    precedingLabel: 'التعبئة والتغليف',
    actionLabel: 'إدخال للدَست',
    targetTab: 'assembly_packaging',
    targetPerm: 'assembly_packaging',
    accentBg: 'bg-indigo-600',
    accentText: 'text-indigo-700',
    accentBadge: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    icon: PackageCheck,
    targetPartStage: 'dest'
  }
};

const GIRLS_TOKENS = ['بنات', 'بناتي', 'حريمي', 'نسائي'];
const BOYS_TOKENS = ['ولاد', 'أولاد', 'اولاد', 'ولادي', 'رجالي', 'شبابي'];

function classifyGender(modelType?: string, sizeCategoryName?: string): GenderBucket {
  const combined = `${modelType || ''} ${sizeCategoryName || ''}`.trim();
  if (!combined) return 'boys';
  if (GIRLS_TOKENS.some((tok) => combined.includes(tok))) return 'girls';
  if (BOYS_TOKENS.some((tok) => combined.includes(tok))) return 'boys';
  return 'other';
}

function genderLabel(g: GenderBucket): string {
  if (g === 'girls') return 'بناتي';
  if (g === 'boys') return 'ولادي';
  return 'أخرى';
}

interface ReadinessCardItem {
  model: DesignModel;
  parts: GarmentPart[];
  relevantParts: GarmentPart[];
  partQuantities: Array<{ part: GarmentPart; qty: number; stateNote?: string }>;
  totalPieces: number;
  setsCount: number;
  colors: string[];
  sizes: string[];
  sizeCategoryName: string;
  gender: GenderBucket;
  totalDefects: number;
  destShortage: number;
  photoShortage: number;
  photoOutstanding: number;
  hasIssue: boolean;
  notesSummary: string;
  photoStatus: 'done' | 'sent' | 'none';
  cardStatus: 'done' | 'sent' | 'none';
  photoSentQty: number;
  photoReceivedQty: number;
  activeVendors: string[];
  expectedDate: string;
}

interface ModelReadinessViewProps {
  stage: ReadinessStageKey;
  onNavigate: (tab: string, modelId?: string) => void;
}

export const ModelReadinessView: React.FC<ModelReadinessViewProps> = ({ stage, onNavigate }) => {
  const {
    models,
    sizeDefs,
    qcRecords,
    printDispatches,
    sewingDispatches,
    finishingRecords,
    assemblyStageRecords,
    packagingRequirements,
    getModelParts,
    getPartStages,
    getModelColorList,
    getModelSizeList,
    normalizePartKey,
    hasPermission,
    hasAssemblyPackagingAccess,
    globalSettings,
    logAction,
    addFlashMessage
  } = useApp();

  const cfg = STAGE_CONFIGS[stage];
  const StageIcon = cfg.icon;

  // 3-state segmented switcher (defaults to 'ready' whenever stage changes)
  const [bucket, setBucket] = useState<ReadinessBucket>('ready');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [genderFilter, setGenderFilter] = useState<'all' | GenderBucket>('all');
  const [sizeCategoryFilter, setSizeCategoryFilter] = useState<string>('all');
  const [issuesOnly, setIssuesOnly] = useState<boolean>(false);
  const [photoCardFilter, setPhotoCardFilter] = useState<PhotoCardFilter>('all');

  useEffect(() => {
    setBucket('ready');
  }, [stage]);

  // Pre-index records by model_id for fast O(N) classification
  const indexed = useMemo(() => {
    const activeModels = models.filter((m) => !m.is_deleted);

    const openPrintByModel = new Map<string, typeof printDispatches>();
    printDispatches.forEach((d) => {
      if (d.status !== 'تم الاستلام بالمصنع') {
        const list = openPrintByModel.get(d.model_id) || [];
        list.push(d);
        openPrintByModel.set(d.model_id, list);
      }
    });

    const openSewingByModel = new Map<string, typeof sewingDispatches>();
    sewingDispatches.forEach((d) => {
      if (d.status !== 'تم الاستلام') {
        const list = openSewingByModel.get(d.model_id) || [];
        list.push(d);
        openSewingByModel.set(d.model_id, list);
      }
    });

    const openFinishingByModel = new Map<string, typeof finishingRecords>();
    finishingRecords.forEach((r) => {
      if (!r.is_received && r.status !== 'تم الاستلام') {
        const list = openFinishingByModel.get(r.model_id) || [];
        list.push(r);
        openFinishingByModel.set(r.model_id, list);
      }
    });

    const openAssemblyByModelStage = new Map<string, typeof assemblyStageRecords>();
    const destShortageByModel = new Map<string, number>();
    assemblyStageRecords.forEach((r) => {
      if (!r.is_completed && r.status !== 'مكتملة') {
        const key = `${r.model_id}__${r.stage}`;
        const list = openAssemblyByModelStage.get(key) || [];
        list.push(r);
        openAssemblyByModelStage.set(key, list);
      }
      if (r.stage === 'dest' && Number(r.shortage_pieces || 0) > 0) {
        destShortageByModel.set(
          r.model_id,
          (destShortageByModel.get(r.model_id) || 0) + Number(r.shortage_pieces || 0)
        );
      }
    });

    const pkgReqByModel = new Map<string, (typeof packagingRequirements)[number]>();
    packagingRequirements.forEach((p) => pkgReqByModel.set(p.model_id, p));

    const sizeDefById = new Map<string, string>();
    sizeDefs.forEach((s) => sizeDefById.set(s.id, s.name));

    const buildCard = (
      model: DesignModel,
      parts: GarmentPart[],
      relevantParts: GarmentPart[],
      activeVendors: string[],
      expectedDate: string
    ): ReadinessCardItem => {
      const sizeCategoryName =
        (model.size_category_id && sizeDefById.get(model.size_category_id)) || 'غير محددة';
      const gender = classifyGender(model.model_type, sizeCategoryName);

      const sizes = getModelSizeList(model.id);
      const colorSet = new Set<string>();
      parts.forEach((p) => getModelColorList(model.id, p).forEach((c) => colorSet.add(c)));
      const colors = Array.from(colorSet);

      let totalDefects = 0;
      const partQuantities = parts.map((part) => {
        const counts = qcPartStageCounts({
          model,
          part,
          qcRecords,
          printDispatches,
          sewingDispatches,
          normalizePartKey
        });
        totalDefects +=
          Number(counts.beforePrintDefect || 0) +
          Number(counts.afterPrintDefect || 0) +
          Number(counts.afterSewingDefect || 0);

        let qty = 0;
        if (stage === 'print') {
          qty = counts.beforePrintGood || counts.cutPieces || 0;
        } else if (stage === 'sewing') {
          qty =
            Number(model.sewing_available?.[part] || 0) ||
            counts.afterPrintGood ||
            counts.beforePrintGood ||
            counts.cutPieces ||
            0;
        } else {
          qty =
            counts.afterSewingGood ||
            counts.sewingReceived ||
            counts.afterPrintGood ||
            counts.cutPieces ||
            0;
        }
        return { part, qty };
      });

      const setsCount =
        stage === 'packaging' || stage === 'dest'
          ? finishedSetsOf(model)
          : partQuantities.length > 0
          ? Math.min(...partQuantities.map((p) => p.qty))
          : 0;

      const totalPieces =
        stage === 'packaging' || stage === 'dest'
          ? setsCount
          : partQuantities
              .filter((pq) => relevantParts.length === 0 || relevantParts.includes(pq.part))
              .reduce((sum, pq) => sum + pq.qty, 0);

      const pkgReq = pkgReqByModel.get(model.id);
      const photoStatus: 'done' | 'sent' | 'none' = pkgReq?.received_from_photo_date
        ? 'done'
        : pkgReq?.sent_to_photo_date
        ? 'sent'
        : 'none';
      const cardStatus: 'done' | 'sent' | 'none' = pkgReq?.received_printed_cards_date
        ? 'done'
        : pkgReq?.sent_to_print_cards_date
        ? 'sent'
        : 'none';
      const photoSentQty = Number(pkgReq?.photography_sent_qty || 0);
      const photoReceivedQty = Number(pkgReq?.photography_received_qty || 0);
      const photoShortage = Number(pkgReq?.photography_shortage || 0);
      const photoOutstanding =
        Number(pkgReq?.photography_outstanding_qty || 0) || photographyOutstandingOf(model);
      const destShortage = destShortageByModel.get(model.id) || 0;

      const notesParts = [
        model.design_notes,
        model.notes_shirt,
        model.notes_pants,
        model.notes_jacket,
        pkgReq?.notes
      ]
        .map((s) => String(s || '').trim())
        .filter(Boolean);
      const notesSummary = notesParts.join(' • ');

      const hasIssue = totalDefects > 0 || destShortage > 0 || photoShortage > 0;

      return {
        model,
        parts,
        relevantParts,
        partQuantities,
        totalPieces,
        setsCount,
        colors,
        sizes,
        sizeCategoryName,
        gender,
        totalDefects,
        destShortage,
        photoShortage,
        photoOutstanding,
        hasIssue,
        notesSummary,
        photoStatus,
        cardStatus,
        photoSentQty,
        photoReceivedQty,
        activeVendors: Array.from(new Set(activeVendors.filter(Boolean))),
        expectedDate
      };
    };

    const ready: ReadinessCardItem[] = [];
    const inProgress: ReadinessCardItem[] = [];
    const completed: ReadinessCardItem[] = [];

    for (const model of activeModels) {
      const parts = getModelParts(model.id);
      const stages = getPartStages(model.id);
      const partStage = (p: GarmentPart): PartStage => (stages[p] || 'cutting') as PartStage;

      if (stage === 'print') {
        const openDispatches = openPrintByModel.get(model.id) || [];
        const openParts = new Set(openDispatches.map((d) => normalizePartKey(d.piece_type || 'shirt')));
        const readyParts = parts.filter((p) => partStage(p) === 'printing' && !openParts.has(p));
        const allPassed =
          parts.length > 0 && parts.every((p) => stageRank(partStage(p)) > stageRank('printing'));

        if (readyParts.length > 0) {
          ready.push(buildCard(model, parts, readyParts, [], ''));
        }
        if (openDispatches.length > 0) {
          inProgress.push(
            buildCard(
              model,
              parts,
              Array.from(openParts),
              openDispatches.map((d) => d.shop_name),
              openDispatches.map((d) => d.expected_delivery_date || '').filter(Boolean)[0] || ''
            )
          );
        }
        if (allPassed) {
          completed.push(buildCard(model, parts, parts, [], ''));
        }
      } else if (stage === 'sewing') {
        const openDispatches = openSewingByModel.get(model.id) || [];
        const openParts = new Set(openDispatches.map((d) => normalizePartKey(d.piece_type || 'shirt')));
        const readyParts = parts.filter((p) => partStage(p) === 'sewing' && !openParts.has(p));
        const allPassed =
          parts.length > 0 && parts.every((p) => stageRank(partStage(p)) > stageRank('sewing'));

        if (readyParts.length > 0) {
          ready.push(buildCard(model, parts, readyParts, [], ''));
        }
        if (openDispatches.length > 0) {
          inProgress.push(
            buildCard(
              model,
              parts,
              Array.from(openParts),
              openDispatches.map((d) => d.workshop_name),
              openDispatches.map((d) => d.expected_delivery_date || '').filter(Boolean)[0] || ''
            )
          );
        }
        if (allPassed) {
          completed.push(buildCard(model, parts, parts, [], ''));
        }
      } else if (stage === 'finishing') {
        const openRecs = openFinishingByModel.get(model.id) || [];
        const openParts = new Set(openRecs.map((r) => normalizePartKey(r.part_type || 'shirt')));
        const readyParts = parts.filter((p) => partStage(p) === 'finishing' && !openParts.has(p));
        const allPassed =
          parts.length > 0 && parts.every((p) => stageRank(partStage(p)) > stageRank('finishing'));

        if (readyParts.length > 0) {
          ready.push(buildCard(model, parts, readyParts, [], ''));
        }
        if (openRecs.length > 0) {
          inProgress.push(
            buildCard(
              model,
              parts,
              Array.from(openParts),
              openRecs.map((r) => r.vendor_name || ''),
              openRecs.map((r) => r.expected_exit_date || '').filter(Boolean)[0] || ''
            )
          );
        }
        if (allPassed) {
          completed.push(buildCard(model, parts, parts, [], ''));
        }
      } else if (stage === 'ironing') {
        const openRecs = openAssemblyByModelStage.get(`${model.id}__ironing`) || [];
        const hasModelLevelOpen = openRecs.some((r) => !r.part_type);
        const openParts = new Set(
          openRecs.filter((r) => Boolean(r.part_type)).map((r) => normalizePartKey(r.part_type))
        );
        const readyParts = hasModelLevelOpen
          ? []
          : parts.filter((p) => partStage(p) === 'ironing' && !openParts.has(p));
        const allPassed =
          parts.length > 0 && parts.every((p) => stageRank(partStage(p)) > stageRank('ironing'));

        if (readyParts.length > 0) {
          ready.push(buildCard(model, parts, readyParts, [], ''));
        }
        if (openRecs.length > 0) {
          inProgress.push(
            buildCard(
              model,
              parts,
              hasModelLevelOpen ? parts : Array.from(openParts),
              openRecs.map((r) => r.vendor_name || ''),
              openRecs.map((r) => r.expected_exit_date || '').filter(Boolean)[0] || ''
            )
          );
        }
        if (allPassed) {
          completed.push(buildCard(model, parts, parts, [], ''));
        }
      } else if (stage === 'packaging') {
        const openRecs = openAssemblyByModelStage.get(`${model.id}__packaging`) || [];
        const allReachedPackaging =
          parts.length > 0 && parts.every((p) => stageRank(partStage(p)) >= stageRank('packaging'));
        const allPassed =
          parts.length > 0 && parts.every((p) => stageRank(partStage(p)) > stageRank('packaging'));

        if (openRecs.length > 0) {
          inProgress.push(
            buildCard(
              model,
              parts,
              parts,
              openRecs.map((r) => r.vendor_name || ''),
              openRecs.map((r) => r.expected_exit_date || '').filter(Boolean)[0] || ''
            )
          );
        } else if (allReachedPackaging && !allPassed) {
          ready.push(buildCard(model, parts, parts, [], ''));
        }
        if (allPassed) {
          completed.push(buildCard(model, parts, parts, [], ''));
        }
      } else if (stage === 'dest') {
        const openRecs = openAssemblyByModelStage.get(`${model.id}__dest`) || [];
        const allReachedDest =
          parts.length > 0 && parts.every((p) => stageRank(partStage(p)) >= stageRank('dest'));
        const allPassed =
          (parts.length > 0 && parts.every((p) => partStage(p) === 'completed')) ||
          model.status === 'مخزن الإنتاج التام' ||
          model.status === 'مكتمل الإنتاج';

        if (openRecs.length > 0) {
          inProgress.push(
            buildCard(
              model,
              parts,
              parts,
              openRecs.map((r) => r.vendor_name || ''),
              openRecs.map((r) => r.expected_exit_date || '').filter(Boolean)[0] || ''
            )
          );
        } else if (allReachedDest && !allPassed) {
          ready.push(buildCard(model, parts, parts, [], ''));
        }
        if (allPassed) {
          completed.push(buildCard(model, parts, parts, [], ''));
        }
      }
    }

    const sortByCode = (a: ReadinessCardItem, b: ReadinessCardItem) =>
      String(a.model.model_code || '').localeCompare(String(b.model.model_code || ''));

    return {
      ready: ready.sort(sortByCode),
      in_progress: inProgress.sort(sortByCode),
      completed: completed.sort(sortByCode)
    };
  }, [
    models,
    sizeDefs,
    qcRecords,
    printDispatches,
    sewingDispatches,
    finishingRecords,
    assemblyStageRecords,
    packagingRequirements,
    stage,
    getModelParts,
    getPartStages,
    getModelColorList,
    getModelSizeList,
    normalizePartKey
  ]);

  const bucketItems = indexed[bucket];

  // Apply Search & Smart Filters
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return bucketItems.filter((item) => {
      if (genderFilter !== 'all' && item.gender !== genderFilter) return false;
      if (sizeCategoryFilter !== 'all' && (item.model.size_category_id || '') !== sizeCategoryFilter) {
        return false;
      }
      if (issuesOnly && !item.hasIssue) return false;
      if (photoCardFilter === 'no_photo' && item.photoStatus === 'done') return false;
      if (photoCardFilter === 'has_photo' && item.photoStatus !== 'done') return false;
      if (photoCardFilter === 'no_card' && item.cardStatus === 'done') return false;
      if (photoCardFilter === 'has_card' && item.cardStatus !== 'done') return false;
      if (
        photoCardFilter === 'both_done' &&
        !(item.photoStatus === 'done' && item.cardStatus === 'done')
      ) {
        return false;
      }
      if (q) {
        const hit =
          (item.model.model_code || '').toLowerCase().includes(q) ||
          (item.model.model_type || '').toLowerCase().includes(q) ||
          item.sizeCategoryName.toLowerCase().includes(q) ||
          item.colors.some((c) => c.toLowerCase().includes(q)) ||
          item.notesSummary.toLowerCase().includes(q) ||
          item.activeVendors.some((v) => v.toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [bucketItems, searchQuery, genderFilter, sizeCategoryFilter, issuesOnly, photoCardFilter]);

  // Dynamic KPIs for current tab & filters
  const kpis = useMemo(() => {
    let boys = 0;
    let girls = 0;
    let other = 0;
    let totalPieces = 0;
    let totalSets = 0;
    filteredItems.forEach((item) => {
      if (item.gender === 'girls') girls += 1;
      else if (item.gender === 'boys') boys += 1;
      else other += 1;
      totalPieces += item.totalPieces;
      totalSets += item.setsCount;
    });
    return {
      totalModels: filteredItems.length,
      boys,
      girls,
      other,
      totalPieces,
      totalSets
    };
  }, [filteredItems]);

  const canJumpToOperationalStage =
    cfg.targetPerm === 'assembly_packaging'
      ? hasAssemblyPackagingAccess()
      : cfg.targetPerm === 'printing'
      ? hasPermission('printing') || hasPermission('reports')
      : hasPermission(cfg.targetPerm as any);

  const canOpenUnifiedCard = hasPermission('models_tracking') || hasPermission('reports');

  const bucketLabel =
    bucket === 'ready'
      ? 'جاهزة للدخول'
      : bucket === 'in_progress'
      ? 'قيد التشغيل حالياً'
      : 'تم الانتهاء منها';

  const handleQuickJump = (item: ReadinessCardItem) => {
    logAction(
      'جاهزية الموديلات',
      `انتقال سريع (${cfg.actionLabel}) للموديل ${item.model.model_code} من شاشة جاهزية ${cfg.label}`,
      { persist: true, actionType: 'custom', targetName: item.model.model_code }
    );
    if (canJumpToOperationalStage) {
      onNavigate(cfg.targetTab, item.model.id);
    } else if (canOpenUnifiedCard) {
      onNavigate('unified_model_cards', item.model.id);
    } else {
      addFlashMessage('لا تمتلك صلاحية فتح شاشة التشغيل المباشرة لهذا القسم', 'warning');
    }
  };

  const handleOpenUnifiedCard = (item: ReadinessCardItem) => {
    logAction(
      'جاهزية الموديلات',
      `فتح بطاقة الموديل الشاملة للموديل ${item.model.model_code} من جاهزية ${cfg.label}`,
      { persist: true, actionType: 'custom', targetName: item.model.model_code }
    );
    onNavigate('unified_model_cards', item.model.id);
  };

  const handleExportExcel = () => {
    const headers: CsvValue[] = [
      'كود الموديل',
      'النوع',
      'التصنيف',
      'فئة المقاس',
      'حالة المرحلة',
      'القطع والكميات',
      'إجمالي القطع',
      'الأطقم',
      'الألوان',
      'المقاسات',
      'التصوير',
      'الكارت/الباركود',
      'العيوب/التوالف',
      'الجهة الحالية',
      'ملاحظات'
    ];
    const rows: CsvValue[][] = filteredItems.map((it) => [
      it.model.model_code,
      it.model.model_type || 'أولادي',
      genderLabel(it.gender),
      it.sizeCategoryName,
      bucketLabel,
      it.partQuantities.map((pq) => `${getPartLabel(pq.part)}: ${pq.qty}`).join(' | '),
      it.totalPieces,
      it.setsCount,
      it.colors.join('، ') || '—',
      it.sizes.join('، ') || '—',
      it.photoStatus === 'done'
        ? 'تم التصوير'
        : it.photoStatus === 'sent'
        ? `في التصوير (${it.photoSentQty})`
        : 'لم يتصور',
      it.cardStatus === 'done'
        ? 'تم عمل الكارت'
        : it.cardStatus === 'sent'
        ? 'قيد الطباعة'
        : 'بدون كارت',
      it.totalDefects + it.destShortage + it.photoShortage,
      it.activeVendors.join('، ') || '—',
      it.notesSummary || ''
    ]);
    exportCsv(datedFileName(`readiness_${stage}_${bucket}`), headers, rows);
    logAction(
      'جاهزية الموديلات',
      `تصدير شيت Excel لـ ${cfg.fullTitle} (${bucketLabel} — ${filteredItems.length} موديل)`,
      { persist: true, actionType: 'export', targetName: `${cfg.label} (${bucketLabel})` }
    );
    addFlashMessage(`تم تصدير كشف جاهزية ${cfg.label} بنجاح`);
  };

  const handlePrint = () => {
    logClientPrintAction(
      'جاهزية الموديلات',
      `طباعة كشف ${cfg.fullTitle} (${bucketLabel} — ${filteredItems.length} موديل)`,
      `${cfg.label} - ${bucketLabel}`
    );

    const rowsHtml = filteredItems
      .map((it, idx) => {
        const imgSrc = safeImageSrc(it.model.image);
        const partsHtml = it.partQuantities
          .map((pq) => `${escapeHtml(getPartLabel(pq.part))}: <strong>${pq.qty.toLocaleString('ar-EG')}</strong>`)
          .join(' • ');
        const photoTxt =
          it.photoStatus === 'done'
            ? '<span class="ok">تم التصوير</span>'
            : it.photoStatus === 'sent'
            ? `<span class="warn">قيد التصوير${it.photoSentQty ? ` (${it.photoSentQty})` : ''}</span>`
            : '<span class="muted">لم يتصور</span>';
        const cardTxt =
          it.cardStatus === 'done'
            ? '<span class="ok">تم الكارت</span>'
            : it.cardStatus === 'sent'
            ? '<span class="warn">قيد الطباعة</span>'
            : '<span class="muted">بدون كارت</span>';

        return `<tr>
          <td class="num muted">${idx + 1}</td>
          <td>${
            imgSrc
              ? `<img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(it.model.model_code)}" class="rd-thumb" onerror="this.style.display='none'" />`
              : '<span class="muted">—</span>'
          }</td>
          <td class="text-right"><strong>${escapeHtml(it.model.model_code)}</strong><div style="font-size:8px;color:#64748b">${escapeHtml(it.model.model_type || '')}</div></td>
          <td>${escapeHtml(genderLabel(it.gender))}</td>
          <td>${escapeHtml(it.sizeCategoryName)}</td>
          <td class="text-right">${partsHtml}</td>
          <td class="num"><strong>${it.totalPieces.toLocaleString('ar-EG')}</strong></td>
          <td class="text-right">${escapeHtml(it.colors.join('، ') || '—')}</td>
          <td>${escapeHtml(it.sizes.join(' - ') || '—')}</td>
          <td>${photoTxt}<br/>${cardTxt}</td>
          <td class="num ${it.hasIssue ? 'bad' : 'muted'}">${it.totalDefects > 0 ? `${it.totalDefects} تالف` : ''}${it.destShortage > 0 ? ` ${it.destShortage} عجز` : ''}${!it.hasIssue ? '—' : ''}</td>
          <td class="text-right">${escapeHtml(it.activeVendors.join('، ') || it.notesSummary || '—')}</td>
        </tr>`;
      })
      .join('');

    const bodyHtml = `
      <div class="p-kpis">
        <div class="p-kpi"><span class="p-kpi-label">إجمالي الموديلات</span><span class="p-kpi-val">${kpis.totalModels.toLocaleString('ar-EG')}</span></div>
        <div class="p-kpi"><span class="p-kpi-label">ولادي</span><span class="p-kpi-val">${kpis.boys.toLocaleString('ar-EG')}</span></div>
        <div class="p-kpi"><span class="p-kpi-label">بناتي</span><span class="p-kpi-val">${kpis.girls.toLocaleString('ar-EG')}</span></div>
        <div class="p-kpi"><span class="p-kpi-label">إجمالي القطع / الأطقم</span><span class="p-kpi-val ok">${kpis.totalPieces.toLocaleString('ar-EG')}</span></div>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width:3%">#</th>
            <th style="width:5%">الصورة</th>
            <th class="text-right" style="width:10%">الموديل</th>
            <th style="width:6%">الجنس</th>
            <th style="width:9%">فئة المقاس</th>
            <th class="text-right" style="width:16%">توزيع القطع</th>
            <th style="width:7%">الإجمالي</th>
            <th class="text-right" style="width:12%">الألوان</th>
            <th style="width:9%">المقاسات</th>
            <th style="width:9%">التصوير والكارت</th>
            <th style="width:6%">عيوب/عجز</th>
            <th class="text-right" style="width:8%">جهة / ملاحظات</th>
          </tr>
        </thead>
        <tbody>${rowsHtml || '<tr><td colspan="12" class="muted">لا توجد موديلات مطابقة للفلتر الحالي.</td></tr>'}</tbody>
      </table>
      ${renderSignatureBar(['مسؤول المتابعة', 'مشرف القسم', 'مدير الإنتاج'], true)}
    `;

    openUnifiedPrintWindow({
      documentTitle: `${cfg.fullTitle} - ${bucketLabel}`,
      mode: 'multi-page-table',
      orientation: 'landscape',
      header: {
        siteName: globalSettings?.site_name,
        logo: globalSettings?.logo,
        title: `${cfg.fullTitle} — ${bucketLabel}`,
        subtitle: `المرحلة السابقة: ${cfg.precedingLabel}`,
        metaItems: [
          `عدد الموديلات: ${kpis.totalModels.toLocaleString('ar-EG')}`,
          `إجمالي القطع: ${kpis.totalPieces.toLocaleString('ar-EG')}`
        ]
      },
      bodyHtml,
      extraCss: `
        .rd-thumb { width: 26px; height: 26px; object-fit: contain; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; display: block; margin: 0 auto; }
      `,
      popupBlockedMessage: 'يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة كشف الجاهزية.'
    });
  };

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    genderFilter !== 'all' ||
    sizeCategoryFilter !== 'all' ||
    issuesOnly ||
    photoCardFilter !== 'all';

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Header & 3-State Segmented Switcher */}
      <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-xs space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div
              className={`w-12 h-12 rounded-2xl ${cfg.accentBg} text-white flex items-center justify-center shadow-xs shrink-0`}
            >
              <StageIcon className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg sm:text-xl font-black text-slate-900">{cfg.fullTitle}</h1>
                <span className={`text-[11px] font-black px-2.5 py-0.5 rounded-full border ${cfg.accentBadge}`}>
                  بعد: {cfg.precedingLabel}
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                متابعة فورية للموديلات الجاهزة للدخول أو الجارية حالياً أو المنتهية من مرحلة {cfg.label}.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs transition cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة (A4 أفقي)</span>
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>تصدير Excel</span>
            </button>
          </div>
        </div>

        {/* 3-State Segmented Switcher */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-100 p-1.5 rounded-2xl border border-slate-200/80">
          <button
            type="button"
            onClick={() => setBucket('ready')}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition cursor-pointer ${
              bucket === 'ready'
                ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CheckCircle2 className={`w-4 h-4 ${bucket === 'ready' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span>جاهزة للدخول</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-mono font-black ${
                bucket === 'ready'
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-200 text-slate-600'
              }`}
            >
              {indexed.ready.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setBucket('in_progress')}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition cursor-pointer ${
              bucket === 'in_progress'
                ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Clock className={`w-4 h-4 ${bucket === 'in_progress' ? 'text-amber-600' : 'text-slate-400'}`} />
            <span>قيد التشغيل حالياً</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-mono font-black ${
                bucket === 'in_progress'
                  ? 'bg-amber-100 text-amber-900'
                  : 'bg-slate-200 text-slate-600'
              }`}
            >
              {indexed.in_progress.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setBucket('completed')}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition cursor-pointer ${
              bucket === 'completed'
                ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Layers className={`w-4 h-4 ${bucket === 'completed' ? 'text-blue-600' : 'text-slate-400'}`} />
            <span>تم الانتهاء منها</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-mono font-black ${
                bucket === 'completed'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-slate-200 text-slate-600'
              }`}
            >
              {indexed.completed.length}
            </span>
          </button>
        </div>

        {/* Dynamic KPI Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
            <span className="text-[11px] font-bold text-slate-500 block">إجمالي الموديلات</span>
            <strong className="text-2xl font-black text-slate-900 font-mono">
              {kpis.totalModels.toLocaleString('ar-EG')}
            </strong>
            <span className="text-[10px] font-bold text-slate-400 block mt-0.5">{bucketLabel}</span>
          </div>

          <div className="rounded-2xl border border-blue-200/80 bg-blue-50/50 p-3.5">
            <span className="text-[11px] font-bold text-blue-700 block">موديلات ولادي</span>
            <strong className="text-2xl font-black text-blue-900 font-mono">
              {kpis.boys.toLocaleString('ar-EG')}
            </strong>
            <span className="text-[10px] font-bold text-blue-600/80 block mt-0.5">
              {kpis.totalModels > 0 ? `${Math.round((kpis.boys / kpis.totalModels) * 100)}%` : '0%'}
            </span>
          </div>

          <div className="rounded-2xl border border-pink-200/80 bg-pink-50/50 p-3.5">
            <span className="text-[11px] font-bold text-pink-700 block">موديلات بناتي</span>
            <strong className="text-2xl font-black text-pink-900 font-mono">
              {kpis.girls.toLocaleString('ar-EG')}
            </strong>
            <span className="text-[10px] font-bold text-pink-600/80 block mt-0.5">
              {kpis.other > 0
                ? `+ ${kpis.other} أخرى`
                : kpis.totalModels > 0
                ? `${Math.round((kpis.girls / kpis.totalModels) * 100)}%`
                : '0%'}
            </span>
          </div>

          <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/50 p-3.5">
            <span className="text-[11px] font-bold text-emerald-700 block">
              {stage === 'packaging' || stage === 'dest' ? 'إجمالي الأطقم التامة' : 'إجمالي القطع المتاحة'}
            </span>
            <strong className="text-2xl font-black text-emerald-900 font-mono">
              {kpis.totalPieces.toLocaleString('ar-EG')}
            </strong>
            {stage !== 'packaging' && stage !== 'dest' && (
              <span className="text-[10px] font-bold text-emerald-700/80 block mt-0.5">
                أطقم تقريبية: {kpis.totalSets.toLocaleString('ar-EG')}
              </span>
            )}
          </div>
        </div>

        {/* Search & Smart Filters Bar */}
        <div className="pt-3 border-t border-slate-100 flex flex-col gap-3">
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2.5">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute start-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث بكود الموديل، النوع، اللون، الورشة، أو الملاحظات..."
                className="w-full ps-9 pe-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute end-2.5 top-2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Gender Pills */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl shrink-0">
              {(
                [
                  { id: 'all', label: 'الكل' },
                  { id: 'boys', label: 'ولادي' },
                  { id: 'girls', label: 'بناتي' },
                  ...(kpis.other > 0 || genderFilter === 'other'
                    ? [{ id: 'other', label: 'أخرى' }]
                    : [])
                ] as Array<{ id: 'all' | GenderBucket; label: string }>
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setGenderFilter(opt.id)}
                  className={`px-3 py-1 rounded-lg text-[11px] font-black transition cursor-pointer ${
                    genderFilter === opt.id
                      ? 'bg-slate-900 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Size Category Dropdown */}
            <select
              value={sizeCategoryFilter}
              onChange={(e) => setSizeCategoryFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">كل فئات المقاس</option>
              {sizeDefs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            {/* Photo & Card Status Filter */}
            <select
              value={photoCardFilter}
              onChange={(e) => setPhotoCardFilter(e.target.value as PhotoCardFilter)}
              className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">التصوير والكارت: الكل</option>
              <option value="no_photo">لم يتصور بعد</option>
              <option value="has_photo">تم التصوير</option>
              <option value="no_card">لم يُعمل له كارت</option>
              <option value="has_card">تم عمل الكارت</option>
              <option value="both_done">التصوير والكارت مكتملان</option>
            </select>

            {/* Issues / Defects Toggle */}
            <button
              type="button"
              onClick={() => setIssuesOnly((v) => !v)}
              className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-black transition cursor-pointer shrink-0 ${
                issuesOnly
                  ? 'bg-rose-600 text-white border-rose-700 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-rose-50 hover:text-rose-700'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>بها عيوب / عجز</span>
            </button>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setGenderFilter('all');
                  setSizeCategoryFilter('all');
                  setIssuesOnly(false);
                  setPhotoCardFilter('all');
                }}
                className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold cursor-pointer shrink-0"
              >
                إعادة ضبط
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Rich Actionable Model Cards Grid */}
      {filteredItems.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredItems.map((item) => {
            const { model } = item;
            const genderBadgeClass =
              item.gender === 'girls'
                ? 'bg-pink-50 text-pink-700 border-pink-200'
                : item.gender === 'boys'
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'bg-slate-100 text-slate-700 border-slate-200';

            return (
              <div
                key={model.id}
                className="bg-white rounded-3xl border border-slate-200/90 p-4 shadow-2xs hover:shadow-md transition flex flex-col justify-between gap-3.5"
              >
                {/* Top: Photo + Code + Badges */}
                <div className="flex items-start gap-3">
                  {model.image ? (
                    <ZoomableImage
                      src={model.image}
                      alt={model.model_code}
                      downloadName={`${model.model_code}.jpg`}
                      className="w-18 h-18 rounded-2xl object-contain bg-slate-50 border border-slate-200 shrink-0 p-0.5"
                    />
                  ) : (
                    <div className="w-18 h-18 rounded-2xl bg-slate-50 border border-dashed border-slate-300 text-slate-400 flex flex-col items-center justify-center gap-0.5 shrink-0 text-[10px]">
                      <ImageOff className="w-4 h-4 text-slate-300" />
                      <span className="font-bold">بدون صورة</span>
                    </div>
                  )}

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center justify-between gap-1.5">
                      <h3 className="font-black text-base text-slate-900 truncate">
                        {model.model_code}
                      </h3>
                      <span
                        className={`text-[10px] font-black px-2 py-0.5 rounded-full border shrink-0 ${genderBadgeClass}`}
                      >
                        {genderLabel(item.gender)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                        <Tag className="w-3 h-3 text-slate-400" />
                        {item.sizeCategoryName}
                      </span>
                      {model.model_type && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-50 text-slate-600 border border-slate-200">
                          {model.model_type}
                        </span>
                      )}
                    </div>

                    {item.activeVendors.length > 0 && (
                      <p className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-0.5 truncate">
                        الجهة الحالية: {item.activeVendors.join('، ')}
                        {item.expectedDate ? ` • متوقع ${item.expectedDate.slice(0, 10)}` : ''}
                      </p>
                    )}
                  </div>
                </div>

                {/* Quantities per Part */}
                <div className="rounded-2xl bg-slate-50 border border-slate-200/70 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-500">
                      {stage === 'packaging' || stage === 'dest'
                        ? 'الأطقم التامة الجاهزة'
                        : 'الكمية المتاحة للمرحلة'}
                    </span>
                    <strong className="font-mono font-black text-slate-900 text-sm">
                      {item.totalPieces.toLocaleString('ar-EG')}{' '}
                      <span className="text-[10px] font-bold text-slate-500">
                        {stage === 'packaging' || stage === 'dest' ? 'طقم' : 'قطعة'}
                      </span>
                    </strong>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {item.partQuantities.map(({ part, qty }) => {
                      const isRelevant = item.relevantParts.includes(part);
                      return (
                        <span
                          key={part}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold border ${
                            isRelevant
                              ? 'bg-white border-slate-300 text-slate-900 shadow-2xs'
                              : 'bg-slate-100/70 border-slate-200 text-slate-500'
                          }`}
                        >
                          <span>{PART_EMOJI[part]}</span>
                          <span>{getPartLabel(part)}:</span>
                          <strong className="font-mono">{qty.toLocaleString('ar-EG')}</strong>
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Colors & Sizes */}
                <div className="space-y-1.5 text-[11px]">
                  {item.colors.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="font-black text-slate-500 me-1">الألوان:</span>
                      {item.colors.slice(0, 6).map((c) => (
                        <span
                          key={c}
                          className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold"
                        >
                          {c}
                        </span>
                      ))}
                      {item.colors.length > 6 && (
                        <span className="text-slate-400 font-bold">+{item.colors.length - 6}</span>
                      )}
                    </div>
                  )}
                  {item.sizes.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="font-black text-slate-500 me-1">المقاسات:</span>
                      {item.sizes.map((sz) => (
                        <span
                          key={sz}
                          className="px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-mono font-bold text-[10px]"
                        >
                          {sz}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Packaging Status Indicators: Photography & Card/Barcode */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl border text-[11px] font-bold ${
                      item.photoStatus === 'done'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : item.photoStatus === 'sent'
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : 'bg-slate-50 text-slate-500 border-slate-200'
                    }`}
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>
                      {item.photoStatus === 'done'
                        ? 'تم التصوير'
                        : item.photoStatus === 'sent'
                        ? `قيد التصوير${item.photoSentQty ? ` (${item.photoSentQty} عينة)` : ''}`
                        : 'لم يتصور'}
                    </span>
                  </span>

                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl border text-[11px] font-bold ${
                      item.cardStatus === 'done'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : item.cardStatus === 'sent'
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : 'bg-slate-50 text-slate-500 border-slate-200'
                    }`}
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>
                      {item.cardStatus === 'done'
                        ? 'تم الكارت والباركود'
                        : item.cardStatus === 'sent'
                        ? 'الكارت قيد الطباعة'
                        : 'بدون كارت'}
                    </span>
                  </span>

                  {item.photoOutstanding > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-xl bg-purple-50 text-purple-800 border border-purple-200 text-[10px] font-bold">
                      📷 {item.photoOutstanding} عينة محتجزة
                    </span>
                  )}
                </div>

                {/* Defects & Notes Summary */}
                {(item.hasIssue || item.notesSummary) && (
                  <div className="space-y-1">
                    {item.hasIssue && (
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-black text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-2.5 py-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        {item.totalDefects > 0 && <span>توالف فرز: {item.totalDefects}</span>}
                        {item.destShortage > 0 && <span>• عجز دَست: {item.destShortage}</span>}
                        {item.photoShortage > 0 && <span>• عجز تصوير: {item.photoShortage}</span>}
                      </div>
                    )}
                    {item.notesSummary && (
                      <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200/70 rounded-xl px-2.5 py-1.5 line-clamp-2">
                        {item.notesSummary}
                      </p>
                    )}
                  </div>
                )}

                {/* Action Footer */}
                <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
                  {canOpenUnifiedCard && (
                    <button
                      type="button"
                      onClick={() => handleOpenUnifiedCard(item)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold transition cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>بطاقة الموديل</span>
                    </button>
                  )}

                  {canJumpToOperationalStage && (
                    <button
                      type="button"
                      onClick={() => handleQuickJump(item)}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl ${cfg.accentBg} hover:opacity-95 text-white text-[11px] font-black shadow-xs transition cursor-pointer ms-auto`}
                    >
                      <span>{cfg.actionLabel}</span>
                      <ArrowUpLeft className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-dashed border-slate-300 p-12 text-center space-y-2">
          <StageIcon className="w-10 h-10 mx-auto text-slate-300" />
          <p className="text-sm font-black text-slate-700">
            لا توجد موديلات في حالة «{bucketLabel}» لمرحلة {cfg.label}
          </p>
          <p className="text-xs text-slate-500">
            {hasActiveFilters
              ? 'جرّب تعديل أو مسح الفلاتر لعرض باقي الموديلات.'
              : bucket === 'ready'
              ? `ستظهر الموديلات هنا تلقائياً فور انتهائها من مرحلة «${cfg.precedingLabel}».`
              : 'لا توجد موديلات مطابقة حالياً.'}
          </p>
        </div>
      )}
    </div>
  );
};
