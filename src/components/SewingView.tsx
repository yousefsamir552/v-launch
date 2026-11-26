import React, { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { makeIdempotentRequestId } from '../context/appContextTypes';
import {
  Scissors, 
  Printer, 
  Search, 
  CheckCircle, 
  Shirt, 
  X, 
  Layers,
  Truck,
  Calendar,
  AlertTriangle,
  Clock,
  Lock,
  Package,
  PackagePlus,
  ClipboardList,
  Plus,
  Star
} from 'lucide-react';
import { ZoomableImage } from './ZoomableImage';
import {
  Model,
  SewingDispatch,
  GarmentPart,
  ModelAccessory,
  PART_EMOJI,
  getPartLabel,
  PART_STAGE_LABELS,
  PartStage
} from '../types';
import { SewingPrintModal } from './SewingPrintModal';
import { CompletedModelsToggle, EndedModelBadge } from './CompletedModelsToggle';
import { stageBeyond } from '../utils/completedModels';
import { printAccessoryIssueOrder } from '../utils/printAccessoryIssueOrder';
import { SortBySelect, compareNatural, toTimestamp } from './SortBySelect';
import { useModalBackHandler } from '../utils/mobileBackNav';
import {
  WorkshopEvaluationModal,
  WorkshopEvaluationTarget
} from './WorkshopEvaluationModal';

type SewingSortKey = 'newest' | 'oldest' | 'code_asc' | 'code_desc' | 'qty_desc' | 'qty_asc';

const SEWING_SORT_OPTIONS: { value: SewingSortKey; label: string }[] = [
  { value: 'newest', label: 'الأحدث أولاً' },
  { value: 'oldest', label: 'الأقدم أولاً' },
  { value: 'code_asc', label: 'الكود (تصاعدي)' },
  { value: 'code_desc', label: 'الكود (تنازلي)' },
  { value: 'qty_desc', label: 'الكمية (الأكثر أولاً)' },
  { value: 'qty_asc', label: 'الكمية (الأقل أولاً)' }
];

// Per-part card styling (kept independent so every part has its own colour identity).
const PART_CARD_STYLES: Record<string, { accentColor: string; badgeColor: string; button: string }> = {
  shirt: {
    accentColor: 'border-blue-400 bg-blue-950/40 text-blue-300',
    badgeColor: 'bg-blue-600 text-white',
    button: 'bg-blue-500 hover:bg-blue-400 text-white'
  },
  pants: {
    accentColor: 'border-emerald-400 bg-emerald-950/40 text-emerald-300',
    badgeColor: 'bg-emerald-600 text-white',
    button: 'bg-emerald-500 hover:bg-emerald-400 text-slate-900'
  },
  jacket: {
    accentColor: 'border-amber-400 bg-amber-950/40 text-amber-300',
    badgeColor: 'bg-amber-600 text-white',
    button: 'bg-amber-500 hover:bg-amber-400 text-slate-900'
  },
  single: {
    accentColor: 'border-fuchsia-400 bg-fuchsia-950/40 text-fuchsia-300',
    badgeColor: 'bg-fuchsia-600 text-white',
    button: 'bg-fuchsia-500 hover:bg-fuchsia-400 text-white'
  }
};

export const SewingView: React.FC = () => {
  const { 
    models, 
    getModelParts,
    getPartStages,
    sewingDispatches, 
    dispatchModelToSewing, 
    receiveModelFromSewing,
    workshops,
    workshopEvaluations,
    accessories,
    accessoryItems,
    recordAccessoryTransaction,
    openWhatsAppOrder,
    logAction,
    globalSettings,
    canViewPreviousModels,
    canAddSewingNotes,
    canViewSewingPrices,
    canEditSewingPrices,
    exportSewingDispatchesCsv
  } = useApp();

  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<SewingSortKey>('newest');
  // نافذة أمر التشغيل: الموديل + القطعة المطلوب معاينتها/طباعتها (both = الورقتين معاً)
  const [printTarget, setPrintTarget] = useState<{
    modelId: string;
    tab: 'both' | GarmentPart;
  } | null>(null);
  const [pieceFilter, setPieceFilter] = useState<'all' | GarmentPart>('all');
  const [showCompleted, setShowCompleted] = useState(false);
  const effectiveShowCompleted = showCompleted && canViewPreviousModels();

  // Modal State for Dispatching to Sewing Workshop
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [dispatchPieceType, setDispatchPieceType] = useState<GarmentPart>('shirt');
  const [dispatchPieceLabel, setDispatchPieceLabel] = useState<string>('تيشرت');
  const [workshopSelection, setWorkshopSelection] = useState('');
  const [customWorkshopName, setCustomWorkshopName] = useState('');
  const [piecesCount, setPiecesCount] = useState<number>(0);
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [sewingCost, setSewingCost] = useState('');
  const [dispatchNotes, setDispatchNotes] = useState('');

  // Modal State for Receiving from Sewing Workshop (timestamp-only receipt; counting & evaluation happen in QC)
  const [receivingDispatch, setReceivingDispatch] = useState<SewingDispatch | null>(null);
  const [receiveNotes, setReceiveNotes] = useState('');
  const [evalTarget, setEvalTarget] = useState<WorkshopEvaluationTarget | null>(null);

  // صرف إكسسوار إضافي (بدل فاقد/تالف أو زيادة احتياج) لورشة الخياطة.
  const [extraAccessoryDispatch, setExtraAccessoryDispatch] = useState<SewingDispatch | null>(null);
  const [extraAccessoryId, setExtraAccessoryId] = useState('');
  const [extraAccessoryQty, setExtraAccessoryQty] = useState<number>(1);

  useModalBackHandler(showDispatchModal, () => setShowDispatchModal(false));
  useModalBackHandler(Boolean(receivingDispatch), () => setReceivingDispatch(null));
  useModalBackHandler(Boolean(extraAccessoryDispatch), () => {
    setExtraAccessoryDispatch(null);
    setExtraAccessoryId('');
    setExtraAccessoryQty(1);
  });
  useModalBackHandler(Boolean(printTarget), () => setPrintTarget(null));

  const allowSewingNotes = canAddSewingNotes();

  /** طباعة إذن صرف إكسسوارات موديل من شاشة المكن (نفس ورقة مخزن الإكسسوارات). */
  const handlePrintAccessoryPermit = (modelId: string) => {
    const model = models.find((m) => m.id === modelId);
    if (!model) return;
    const modelAccs = accessories.filter((a) => a.model_id === modelId);
    if (modelAccs.length === 0) return;
    const firstIssued = modelAccs.find((a) => a.is_issued);
    printAccessoryIssueOrder({
      siteName: globalSettings?.site_name,
      logo: globalSettings?.logo,
      modelCode: model.model_code,
      modelType: model.model_type,
      targetQuantity: model.target_cut_quantity,
      issuedTo: modelAccs.find((a) => a.issued_to)?.issued_to || '',
      issuedBy: firstIssued?.issued_by || '',
      date: firstIssued?.issued_at || undefined,
      lines: modelAccs.map((a) => ({
        accessory_name: a.accessory_name,
        accessory_code: a.accessory_code,
        target_type: a.target_type,
        quantity: a.is_issued
          ? Number(a.issued_quantity ?? a.planned_quantity ?? 0)
          : Number(a.planned_quantity || 0),
        unit: a.unit,
        is_issued: a.is_issued
      }))
    });
  };

  /** المتبقي داخل الورشة = الكمية المرسلة − الكمية المستلمة فعلياً. */
  const getRemainingPieces = (dispatch: SewingDispatch) =>
    Math.max(0, Number(dispatch.pieces_count || 0) - Number(dispatch.received_pieces || 0));

  /** إكسسوارات الموديل المرتبطة بنوع القطعة (أو إكسسوارات القطعة الواحدة). */
  const getModelAccessoriesForPart = (modelId?: string, part?: GarmentPart): ModelAccessory[] => {
    if (!modelId) return [];
    const target = part || 'shirt';
    return accessories.filter(
      (acc) =>
        acc.model_id === modelId &&
        (acc.target_type === target || acc.target_type === 'single')
    );
  };

  /** رصيد صنف الإكسسوار في المخزن المقابل لسطر احتياج الموديل. */
  const getAccessoryStock = (acc: ModelAccessory): number => {
    const item = accessoryItems.find(
      (it) =>
        (acc.accessory_id && it.id === acc.accessory_id) ||
        (acc.accessory_code && it.code === acc.accessory_code) ||
        it.name === acc.accessory_name
    );
    return item?.quantity ?? 0;
  };

  /** أصناف المخزن المتاحة للصرف الإضافي لإرسالية معينة. */
  const getDispensableAccessories = (dispatch: SewingDispatch | null) => {
    if (!dispatch) return [] as { acc: ModelAccessory; itemId: string; stock: number }[];
    const rows = getModelAccessoriesForPart(dispatch.model_id, dispatch.piece_type || 'shirt');
    const linked = rows
      .map((acc) => {
        const item = accessoryItems.find(
          (it) =>
            (acc.accessory_id && it.id === acc.accessory_id) ||
            (acc.accessory_code && it.code === acc.accessory_code) ||
            it.name === acc.accessory_name
        );
        return item ? { acc, itemId: item.id, stock: item.quantity } : null;
      })
      .filter((row): row is { acc: ModelAccessory; itemId: string; stock: number } => !!row);
    if (linked.length > 0) return linked;
    // لا توجد إكسسوارات مرتبطة بالموديل → اسمح بالصرف من كل أصناف المخزن.
    return accessoryItems.map((item) => ({
      acc: {
        id: item.id,
        model_id: dispatch.model_id,
        target_type: 'single',
        piece_consumption: 1,
        planned_quantity: 0,
        accessory_id: item.id,
        accessory_code: item.code,
        accessory_name: item.name,
        unit: item.unit
      },
      itemId: item.id,
      stock: item.quantity
    }));
  };

  // Accessories manifest of the model/piece currently selected in the dispatch modal.
  const dispatchManifest = getModelAccessoriesForPart(selectedModelId, dispatchPieceType);
  const extraAccessoryOptions = getDispensableAccessories(extraAccessoryDispatch);

  // ورش المكن / الخياطة فقط.
  const sewingWorkshops = workshops.filter((w) => (w.workshop_type || []).includes('sewing'));
  const selectedSewingWorkshop = sewingWorkshops.find((w) => w.id === workshopSelection) || null;
  const resolvedWorkshopName = selectedSewingWorkshop
    ? selectedSewingWorkshop.name
    : workshopSelection === '__custom__'
      ? customWorkshopName.trim()
      : '';

  const buildSewingWhatsappMessage = (): string => {
    const model = models.find((m) => m.id === selectedModelId);
    return [
      `طلب تشغيلة خياطة${selectedSewingWorkshop ? ` - ${selectedSewingWorkshop.name}` : ''}`,
      `الموديل: ${model?.model_code || ''}`,
      `نوع القطعة: ${dispatchPieceLabel || getPartLabel(dispatchPieceType)}`,
      `عدد القطع: ${piecesCount}`,
      `تاريخ الاستلام المتوقع: ${expectedDeliveryDate || '-'}`,
      dispatchNotes ? `ملاحظات: ${dispatchNotes}` : ''
    ]
      .filter(Boolean)
      .join('\n');
  };

  // Parts currently at the sewing stage — each part is tracked independently.
  const readyPartCards = models.flatMap((m) => {
    if (m.is_deleted) return [] as { model: Model; part: GarmentPart }[];
    const stages = getPartStages(m.id);
    return getModelParts(m.id)
      .filter((part) => (stages[part] || 'cutting') === 'sewing')
      .map((part) => ({ model: m, part }));
  });
  const readyModels = models.filter(
    (m) => !m.is_deleted && readyPartCards.some((card) => card.model.id === m.id)
  );

  // القطع التي تجاوزت مرحلة المكن (منتهية من هذا القسم).
  const endedPartCards = models.flatMap((m) => {
    if (m.is_deleted) return [] as { model: Model; part: GarmentPart }[];
    const stages = getPartStages(m.id);
    return getModelParts(m.id)
      .filter((part) => stageBeyond(stages[part], 'sewing'))
      .map((part) => ({ model: m, part }));
  });

  const getCardPiecesCount = (m: Model, part: GarmentPart) => {
    const openDisp = sewingDispatches.find(
      (d) => d.model_id === m.id && d.piece_type === part && d.status !== 'تم الاستلام'
    );
    const prevPieces =
      part === 'shirt' ? m.sewing_shirt_pieces : part === 'pants' ? m.sewing_pants_pieces : 0;
    return openDisp?.pieces_count || prevPieces || Number(m.sewing_available?.[part] ?? 0);
  };

  const filteredReadyPartCards = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const list = readyPartCards.filter(({ model, part }) => {
      if (pieceFilter !== 'all' && part !== pieceFilter) return false;
      if (!q) return true;
      const openDisp = sewingDispatches.find(
        (d) => d.model_id === model.id && d.piece_type === part && d.status !== 'تم الاستلام'
      );
      return (
        (model.model_code || '').toLowerCase().includes(q) ||
        (model.model_type || '').toLowerCase().includes(q) ||
        getPartLabel(part).toLowerCase().includes(q) ||
        (openDisp?.workshop_name || '').toLowerCase().includes(q)
      );
    });
    return [...list].sort((a, b) => {
      if (sortBy === 'code_asc') return compareNatural(a.model.model_code, b.model.model_code);
      if (sortBy === 'code_desc') return compareNatural(b.model.model_code, a.model.model_code);
      if (sortBy === 'qty_desc') return getCardPiecesCount(b.model, b.part) - getCardPiecesCount(a.model, a.part);
      if (sortBy === 'qty_asc') return getCardPiecesCount(a.model, a.part) - getCardPiecesCount(b.model, b.part);
      if (sortBy === 'oldest') return toTimestamp(a.model.created_at) - toTimestamp(b.model.created_at);
      return toTimestamp(b.model.created_at) - toTimestamp(a.model.created_at);
    });
  }, [readyPartCards, pieceFilter, searchTerm, sortBy, sewingDispatches]);

  const filteredEndedPartCards = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const list = endedPartCards.filter(({ model, part }) => {
      if (pieceFilter !== 'all' && part !== pieceFilter) return false;
      if (!q) return true;
      return (
        (model.model_code || '').toLowerCase().includes(q) ||
        (model.model_type || '').toLowerCase().includes(q) ||
        getPartLabel(part).toLowerCase().includes(q)
      );
    });
    return [...list].sort((a, b) => {
      if (sortBy === 'code_asc') return compareNatural(a.model.model_code, b.model.model_code);
      if (sortBy === 'code_desc') return compareNatural(b.model.model_code, a.model.model_code);
      if (sortBy === 'qty_desc') return Number(b.model.target_cut_quantity || 0) - Number(a.model.target_cut_quantity || 0);
      if (sortBy === 'qty_asc') return Number(a.model.target_cut_quantity || 0) - Number(b.model.target_cut_quantity || 0);
      if (sortBy === 'oldest') return toTimestamp(a.model.created_at) - toTimestamp(b.model.created_at);
      return toTimestamp(b.model.created_at) - toTimestamp(a.model.created_at);
    });
  }, [endedPartCards, pieceFilter, searchTerm, sortBy]);

  const filteredDispatches = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const list = sewingDispatches.filter((disp) => {
      const m = models.find((mod) => mod.id === disp.model_id);
      const code = m?.model_code || '';
      const name = disp.workshop_name || '';
      const label = disp.piece_label || '';
      const matchesSearch = !q || code.toLowerCase().includes(q) || name.toLowerCase().includes(q) || label.toLowerCase().includes(q);
      const matchesPiece = pieceFilter === 'all' || disp.piece_type === pieceFilter;
      return matchesSearch && matchesPiece;
    });
    return [...list].sort((a, b) => {
      const ma = models.find((mm) => mm.id === a.model_id);
      const mb = models.find((mm) => mm.id === b.model_id);
      if (sortBy === 'code_asc') return compareNatural(ma?.model_code, mb?.model_code);
      if (sortBy === 'code_desc') return compareNatural(mb?.model_code, ma?.model_code);
      if (sortBy === 'qty_desc') return Number(b.pieces_count || 0) - Number(a.pieces_count || 0);
      if (sortBy === 'qty_asc') return Number(a.pieces_count || 0) - Number(b.pieces_count || 0);
      if (sortBy === 'oldest') return toTimestamp(a.dispatched_at) - toTimestamp(b.dispatched_at);
      return toTimestamp(b.dispatched_at) - toTimestamp(a.dispatched_at);
    });
  }, [sewingDispatches, models, searchTerm, pieceFilter, sortBy]);

  const activeDispatches = filteredDispatches.filter(d => d.status !== 'تم الاستلام');
  const visibleDispatches = effectiveShowCompleted
    ? filteredDispatches.filter(d => d.status === 'تم الاستلام')
    : activeDispatches;

  const openDispatchModal = (model: Model, pieceType: GarmentPart = 'shirt') => {
    setSelectedModelId(model.id);
    setDispatchPieceType(pieceType);
    setDispatchPieceLabel(getPartLabel(pieceType));

    // Each part uses ONLY its own available quantity — never a shared/combined number.
    const prevPieces =
      pieceType === 'shirt'
        ? model.sewing_shirt_pieces
        : pieceType === 'pants'
        ? model.sewing_pants_pieces
        : 0;
    const count = prevPieces || Number(model.sewing_available?.[pieceType] ?? 0);
    setPiecesCount(count);

    const prevWorkshop = pieceType === 'shirt'
      ? (model.sewing_shirt_workshop || model.sewing_workshop || '')
      : pieceType === 'pants'
      ? (model.sewing_pants_workshop || model.sewing_workshop || '')
      : (model.sewing_workshop || '');
    // إعادة اختيار الورشة السابقة من القائمة، أو فتح وضع الكتابة اليدوية إن لم تكن مسجّلة.
    const matchedPrevWorkshop = sewingWorkshops.find((w) => w.name === prevWorkshop);
    if (matchedPrevWorkshop) {
      setWorkshopSelection(matchedPrevWorkshop.id);
      setCustomWorkshopName('');
    } else if (prevWorkshop) {
      setWorkshopSelection('__custom__');
      setCustomWorkshopName(prevWorkshop);
    } else {
      setWorkshopSelection('');
      setCustomWorkshopName('');
    }

    const prevDate = pieceType === 'shirt'
      ? model.sewing_shirt_expected_date
      : pieceType === 'pants'
      ? model.sewing_pants_expected_date
      : model.sewing_expected_date;

    if (prevDate) {
      setExpectedDeliveryDate(prevDate);
    } else {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);
      setExpectedDeliveryDate(futureDate.toISOString().split('T')[0]);
    }

    const defaultNotes = allowSewingNotes
      ? (pieceType === 'shirt' ? (model.notes_shirt || '') : pieceType === 'pants' ? (model.notes_pants || '') : '')
      : '';
    setDispatchNotes(defaultNotes);

    setShowDispatchModal(true);
  };

  const submitLockRef = React.useRef(false);
  const pendingDispatchReqIdRef = React.useRef<string | null>(null);
  const [isDispatchSubmitting, setIsDispatchSubmitting] = useState(false);
  const [isReceivingSubmitting, setIsReceivingSubmitting] = useState(false);

  const handleSubmitDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isDispatchSubmitting) return;
    if (!selectedModelId || !resolvedWorkshopName || piecesCount <= 0 || !expectedDeliveryDate) {
      alert('يرجى ملء جميع الحقول المطلوبة وتحديد اسم الورشة وتاريخ الاستلام المتوقع');
      return;
    }

    if (!pendingDispatchReqIdRef.current) {
      pendingDispatchReqIdRef.current = makeIdempotentRequestId('sew-disp');
    }
    const reqId = pendingDispatchReqIdRef.current;
    submitLockRef.current = true;
    setIsDispatchSubmitting(true);
    let ok = false;
    try {
      ok = await dispatchModelToSewing({
        modelId: selectedModelId,
        clientId: reqId,
        workshopName: resolvedWorkshopName,
        piecesCount: piecesCount,
        expectedDeliveryDate: expectedDeliveryDate,
        pieceType: dispatchPieceType,
        pieceLabel: dispatchPieceLabel,
        // يظهر ويُرسل فقط لمن يملك صلاحية تعديل أسعار المكن.
        costPerPiece: canEditSewingPrices() ? Math.max(0, parseFloat(sewingCost) || 0) : undefined,
        notes: allowSewingNotes ? dispatchNotes.trim() : ''
      });
    } finally {
      submitLockRef.current = false;
      setIsDispatchSubmitting(false);
    }

    if (ok) {
      pendingDispatchReqIdRef.current = null;
      setShowDispatchModal(false);
      setSelectedModelId('');
      setWorkshopSelection('');
      setCustomWorkshopName('');
      setPiecesCount(0);
      setExpectedDeliveryDate('');
      setSewingCost('');
      setDispatchNotes('');
    }
  };

  const handleReceive = (dispatch: SewingDispatch) => {
    setReceivingDispatch(dispatch);
    setReceiveNotes('');
  };

  const confirmReceiveFromSewing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receivingDispatch || isReceivingSubmitting) return;
    setIsReceivingSubmitting(true);
    try {
      const m = models.find(mod => mod.id === receivingDispatch.model_id);
      const code = m?.model_code || 'الموديل';
      const label = receivingDispatch.piece_label || getPartLabel(receivingDispatch.piece_type || 'shirt');
      const finalNotes = allowSewingNotes ? receiveNotes.trim() : '';

      receiveModelFromSewing(
        receivingDispatch.id,
        receivingDispatch.model_id,
        finalNotes || undefined,
        undefined,
        true
      );
      logAction(
        'قسم المكن',
        `تسجيل استلام تشغيلة خياطة [${label}] موديل ${code} من ورشة ${receivingDispatch.workshop_name} (تحويل للعد بعد المكن)${finalNotes ? ` — ملاحظات: ${finalNotes}` : ''}`
      );
      setReceivingDispatch(null);
      setReceiveNotes('');
    } finally {
      setIsReceivingSubmitting(false);
    }
  };

  /** صرف إكسسوار إضافي لورشة الخياطة (بدل فاقد/تالف أو احتياج زائد). */
  const handleExtraAccessoryDispense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!extraAccessoryDispatch || !extraAccessoryId) {
      alert('اختر صنف الإكسسوار المطلوب صرفه');
      return;
    }
    const qty = Math.floor(Number(extraAccessoryQty) || 0);
    if (qty <= 0) {
      alert('أدخل كمية صرف أكبر من صفر');
      return;
    }
    const item = accessoryItems.find((it) => it.id === extraAccessoryId);
    if (!item) {
      alert('الصنف غير موجود في مخزن الإكسسوارات');
      return;
    }
    const m = models.find((mod) => mod.id === extraAccessoryDispatch.model_id);
    const label =
      extraAccessoryDispatch.piece_label ||
      getPartLabel(extraAccessoryDispatch.piece_type || 'shirt');
    const notes = `صرف إضافي لورشة المكن: ${extraAccessoryDispatch.workshop_name} — موديل ${
      m?.model_code || ''
    } — قطعة ${label}`;

    const result = recordAccessoryTransaction({
      accessoryId: extraAccessoryId,
      operation: 'deduct',
      amount: qty,
      modelCodeRef: m?.model_code,
      notes
    });
    if (!result.success) {
      alert(result.message);
      return;
    }
    logAction(
      'قسم المكن',
      `صرف إكسسوار إضافي (${item.name} × ${qty} ${item.unit || ''}) لورشة ${extraAccessoryDispatch.workshop_name} — موديل ${m?.model_code || ''}`
    );
    setExtraAccessoryDispatch(null);
    setExtraAccessoryId('');
    setExtraAccessoryQty(1);
  };

  // Helper to compute date diff badge
  const getDateStatusBadge = (expectedDateStr?: string, status?: string) => {
    if (!expectedDateStr) return null;
    if (status === 'تم الاستلام') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600">
          <CheckCircle className="w-3 h-3 text-emerald-600" />
          تم الاستلام بالفرز
        </span>
      );
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(expectedDateStr);
    target.setHours(0, 0, 0, 0);
    const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-red-100 text-red-700 border border-red-300 animate-pulse">
          <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
          متأخر {Math.abs(diffDays)} يوم عن الموعد!
        </span>
      );
    }
    if (diffDays === 0) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-amber-100 text-amber-800 border border-amber-300">
          <Clock className="w-3.5 h-3.5 text-amber-600" />
          موعد الاستلام اليوم
        </span>
      );
    }
    if (diffDays === 1) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
          <Calendar className="w-3 h-3 text-blue-600" />
          موعد الاستلام غداً
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700">
        <Calendar className="w-3 h-3 text-slate-400" />
        متبقي {diffDays} أيام ({expectedDateStr})
      </span>
    );
  };

  // الموديل الخاص بنافذة أمر التشغيل المفتوحة
  const printTargetModel = printTarget
    ? models.find((model) => model.id === printTarget.modelId) || null
    : null;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-emerald-800 tracking-tight flex items-center gap-2">
            <Scissors className="w-8 h-8 text-emerald-600" />
            <span>قسم المكن وخطوط الخياطة (Sewing Section)</span>
          </h2>
          <p className="text-slate-500 text-sm mt-0.5">
            مسارات مستقلة لخياطة التيشرت والبنطلون، تحديد ورش ومواعيد استلام منفصلة لكل قطعة، وطباعة أوراق التشغيل بأبعاد صور كاملة بدون أي قص.
          </p>
        </div>

        {/* Search & Piece Filter */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <button
            type="button"
            onClick={exportSewingDispatchesCsv}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition cursor-pointer shrink-0"
          >
            <span>📊 تصدير Excel</span>
          </button>
          <div className="relative w-full md:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="بحث برقم الموديل أو اسم الورشة..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full ps-9 pe-4 py-2.5 bg-white border border-slate-200 rounded-full text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition shadow-xs"
            />
          </div>

          <div className="flex items-center bg-slate-100 p-1 rounded-full border border-slate-200 shrink-0">
            <button
              onClick={() => setPieceFilter('all')}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition cursor-pointer ${
                pieceFilter === 'all' ? 'bg-white text-emerald-800 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              الكل
            </button>
            <button
              onClick={() => setPieceFilter('shirt')}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition cursor-pointer ${
                pieceFilter === 'shirt' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              تيشرت
            </button>
            <button
              onClick={() => setPieceFilter('pants')}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition cursor-pointer ${
                pieceFilter === 'pants' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              بنطلون
            </button>
          </div>

          <SortBySelect
            value={sortBy}
            onChange={(v) => setSortBy(v as SewingSortKey)}
            options={SEWING_SORT_OPTIONS}
          />

          <CompletedModelsToggle
            enabled={effectiveShowCompleted}
            count={endedPartCards.length}
            onChange={setShowCompleted}
            tone="emerald"
          />
        </div>
      </div>

      {/* Top Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-500 mb-1">قطع جاهزة للمكن</p>
            <h3 className="text-2xl font-black text-emerald-900">{readyPartCards.length}</h3>
            <span className="text-[11px] text-emerald-600 font-semibold mt-1 inline-block">
              {readyModels.length} موديل — كل قطعة مسار عمل مستقل
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <Layers className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-500 mb-1">تشغيلات قيد الخياطة</p>
            <h3 className="text-2xl font-black text-indigo-900">{activeDispatches.length}</h3>
            <span className="text-[11px] text-indigo-600 font-semibold mt-1 inline-block">تشغيلة بورش الخياطة</span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Truck className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-500 mb-1">إجمالي القطع بالمكن</p>
            <h3 className="text-2xl font-black text-slate-900">
              {activeDispatches.reduce((acc, d) => acc + getRemainingPieces(d), 0).toLocaleString('ar-EG')}
            </h3>
            <span className="text-[11px] text-slate-500 font-semibold mt-1 inline-block">قطعة متبقية بالورش</span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <Shirt className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-500 mb-1">المحطة التالية بعد الاستلام</p>
            <h3 className="text-lg font-black text-purple-800">العد بعد المكن</h3>
            <span className="text-[11px] text-purple-600 font-semibold mt-1 inline-block">الفرز والكنترول QC</span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center">
            <CheckCircle className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* SECTION 1: Ready Models — hidden exclusively when viewing previous/completed models */}
      {!effectiveShowCompleted && (
      <div className="bg-slate-900 text-white rounded-3xl p-6 shadow-md relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-full text-xs font-black bg-emerald-500 text-slate-900 uppercase tracking-wide">
                القطع الجاهزة للمكن — بطاقة مستقلة لكل قطعة (تيشرت / بنطلون / جاكيت)
              </span>
              <span className="text-slate-300 text-xs">
                (استقلالية كاملة لكل قطعة في تحديد اسم ورشة المكن وتاريخ الاستلام المتوقع)
              </span>
            </div>
            <h3 className="text-lg font-black text-white mt-1">
              اختر خط القطعة (تيشرت أو بنطلون) لتسجيل خروجه إلى ورشة الخياطة الخاصة به
            </h3>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 relative z-10">
          {filteredReadyPartCards.length > 0 ? (
            filteredReadyPartCards
              .map(({ model: m, part }) => {
                const isShirt = part === 'shirt';
                const isPants = part === 'pants';
                // Dispatch state comes from the sewing dispatch records so each
                // part keeps its own workshop / dates independently.
                const partDispatches = sewingDispatches.filter(
                  (d) => d.model_id === m.id && d.piece_type === part
                );
                const openDispatch = partDispatches.find((d) => d.status !== 'تم الاستلام');
                const allReceived =
                  partDispatches.length > 0 &&
                  partDispatches.every((d) => d.status === 'تم الاستلام');
                const legacyDispatched = isShirt
                  ? m.sewing_shirt_status === 'في ورشة المكن'
                  : isPants && m.sewing_pants_status === 'في ورشة المكن';
                const isDispatched =
                  Boolean(openDispatch) ||
                  (partDispatches.length === 0 && Boolean(legacyDispatched));
                const isReceived = allReceived && !openDispatch;
                const workshop =
                  openDispatch?.workshop_name ||
                  (isShirt
                    ? m.sewing_shirt_workshop || m.sewing_workshop
                    : isPants
                    ? m.sewing_pants_workshop || m.sewing_workshop
                    : m.sewing_workshop);
                const expectedDate =
                  openDispatch?.expected_delivery_date ||
                  (isShirt
                    ? m.sewing_shirt_expected_date || m.sewing_expected_date
                    : isPants
                    ? m.sewing_pants_expected_date || m.sewing_expected_date
                    : m.sewing_expected_date);
                const prevPieces = isShirt
                  ? m.sewing_shirt_pieces
                  : isPants
                  ? m.sewing_pants_pieces
                  : 0;
                // Each card shows ONLY its own part quantity (no shared combined number).
                const pieces =
                  openDispatch?.pieces_count || prevPieces || Number(m.sewing_available?.[part] ?? 0);
                const style = PART_CARD_STYLES[part] || PART_CARD_STYLES.shirt;

                return {
                  id: `${m.id}-${part}`,
                  model: m,
                  pieceType: part,
                  pieceLabel: getPartLabel(part),
                  accentColor: style.accentColor,
                  badgeColor: style.badgeColor,
                  button: style.button,
                  isDispatched,
                  isReceived,
                  workshop,
                  expectedDate,
                  pieces,
                  dispatchRecord: openDispatch
                };
              }).map((item) => (
              <div
                key={item.id}
                className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-4 flex flex-col justify-between hover:bg-white/15 transition group shadow-xs"
              >
                <div>
                  {/* Top Bar with Badge */}
                  <div className="flex items-center justify-between mb-3">
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-black ${item.badgeColor}`}>
                      {PART_EMOJI[item.pieceType]} {item.pieceLabel}
                    </span>
                    <div className="flex items-center gap-1">
                      {accessories.some((a) => a.model_id === item.model.id) && (
                        <button
                          onClick={() => handlePrintAccessoryPermit(item.model.id)}
                          className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
                          title="طباعة إذن صرف إكسسوارات الموديل (A4)"
                        >
                          <ClipboardList className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => setPrintTarget({ modelId: item.model.id, tab: item.pieceType })}
                        className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition text-xs cursor-pointer flex items-center gap-1"
                        title="طباعة ورقة التشغيل الفردية لهذه القطعة"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-bold">طباعة الورقة</span>
                      </button>
                    </div>
                  </div>

                  {/* Thumbnail and Info */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-14 h-14 rounded-xl border border-white/30 bg-white p-1 shrink-0 overflow-hidden flex items-center justify-center">
                      <ZoomableImage
                        src={item.model.image}
                        alt={item.model.model_code}
                        downloadName={`${item.model.model_code}.jpg`}
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <div className="min-w-0 flex-grow">
                      <h4 className="font-black text-sm text-white truncate">
                        موديل: {item.model.model_code}
                      </h4>
                      <p className="text-[11px] text-slate-300">
                        العدد: <strong className="text-white font-bold">{item.pieces.toLocaleString('ar-EG')} ق</strong>
                      </p>
                    </div>
                  </div>

                  {/* Status / Workshop Info */}
                  <div className="bg-black/25 rounded-xl p-2.5 mb-3 text-xs space-y-1">
                    {item.isReceived ? (
                      <div className="flex items-center gap-1 text-emerald-400 font-bold">
                        <CheckCircle className="w-3.5 h-3.5" />
                        <span>تم الاستلام بالفرز</span>
                      </div>
                    ) : item.isDispatched ? (
                      <div>
                        <div className="text-[11px] text-slate-400">بالورشة:</div>
                        <div className="font-black text-white truncate">{item.workshop}</div>
                        <div className="mt-1">
                          {getDateStatusBadge(item.expectedDate, 'في ورشة المكن')}
                        </div>
                      </div>
                    ) : (
                      <div className="text-slate-400 text-[11px] flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-amber-400" />
                        <span>بانتظار تحديد ورشة {getPartLabel(item.pieceType)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-2 border-t border-white/10">
                  {item.isReceived ? (
                    <div className="w-full py-2 px-3 rounded-xl bg-emerald-500/20 text-emerald-300 font-bold text-xs text-center">
                      جاهز بالفرز والجودة
                    </div>
                  ) : item.isDispatched ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (item.dispatchRecord) {
                            handleReceive(item.dispatchRecord);
                          }
                        }}
                        className="flex-1 py-2 px-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-black text-xs transition flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        <span>استلام {getPartLabel(item.pieceType)}</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => openDispatchModal(item.model, item.pieceType)}
                      className={`w-full py-2 px-3 rounded-xl font-black text-xs transition flex items-center justify-center gap-1.5 shadow-xs cursor-pointer ${
                        item.button || 'bg-blue-500 hover:bg-blue-400 text-white'
                      }`}
                    >
                      <Scissors className="w-3.5 h-3.5" />
                      <span>إرسال ورشة {getPartLabel(item.pieceType)}</span>
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <p className="col-span-full text-slate-300 text-xs py-6 text-center">
              لا توجد قطع بانتظار الإرسال إلى ورش المكن حالياً. كل القطع إما بالورش أو بمراحل أخرى.
            </p>
          )}
        </div>
      </div>
      )}

      {/* SECTION 1.b: Ended parts (exclusive view when "الموديلات السابقة" is ON) */}
      {effectiveShowCompleted && (
        <div className="bg-slate-50/70 rounded-3xl p-6 border-2 border-dashed border-slate-300 shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-extrabold text-slate-800 text-sm flex items-center gap-2">
              <Layers className="w-4 h-4 text-slate-500" />
              <span>الموديلات السابقة / المنتهية من قسم المكن ({filteredEndedPartCards.length}):</span>
            </h3>
            <span className="text-[11px] text-slate-500 font-normal">
              (تم تحويلها مسبقاً — إعادة الإرسال معطلة)
            </span>
          </div>

          {filteredEndedPartCards.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {filteredEndedPartCards
                .map(({ model: m, part }) => {
                  const stage = getPartStages(m.id)[part] || 'cutting';
                  return (
                    <div
                      key={`${m.id}-${part}`}
                      className="bg-white rounded-2xl border-2 border-dashed border-slate-300 p-4 flex flex-col gap-3 shadow-2xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-600 text-white">
                          {PART_EMOJI[part]} {getPartLabel(part)}
                        </span>
                        <button
                          onClick={() => setPrintTarget({ modelId: m.id, tab: part })}
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition cursor-pointer"
                          title="طباعة ورقة التشغيل الفردية لهذه القطعة"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl border border-slate-200 bg-white p-1 shrink-0 overflow-hidden flex items-center justify-center">
                          <ZoomableImage
                            src={m.image}
                            alt={m.model_code}
                            downloadName={`${m.model_code}.jpg`}
                            className="w-full h-full object-contain grayscale-[55%] opacity-90"
                          />
                        </div>
                        <div className="min-w-0 flex-grow">
                          <h4 className="font-black text-sm text-slate-700 truncate">
                            موديل: {m.model_code}
                          </h4>
                          <p className="text-[11px] text-slate-500">
                            المرحلة الحالية:{' '}
                            <strong className="text-slate-700">
                              {PART_STAGE_LABELS[stage as PartStage]}
                            </strong>
                          </p>
                        </div>
                      </div>

                      <EndedModelBadge currentStage={PART_STAGE_LABELS[stage as PartStage]} />

                      <div className="w-full py-2 rounded-xl bg-slate-200 text-slate-600 border border-slate-300 font-bold text-[11px] text-center cursor-not-allowed">
                        <span>🔒 تم الانتهاء وخرج بالفعل من هذه المرحلة</span>
                        <Lock className="w-3.5 h-3.5 inline ms-1" />
                      </div>
                    </div>
                  );
                })}
            </div>
          ) : (
            <p className="text-center text-slate-500 text-xs py-4">
              لا توجد قطع منتهية من قسم المكن حالياً.
            </p>
          )}
        </div>
      )}

      {/* SECTION 2: Sewing Dispatches Table (Active vs Previous exclusively) */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-emerald-700" />
            <h3 className="font-extrabold text-base text-slate-900">
              {effectiveShowCompleted
                ? 'سجل تشغيلات المكن السابقة (المستلمة)'
                : 'سجل تشغيلات ورش المكن النشطة'}
            </h3>
          </div>
          <span className="text-xs text-slate-500 font-semibold">
            المعروض: {visibleDispatches.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
              <tr>
                <th className="px-6 py-3.5">الموديل وصورته</th>
                <th className="px-6 py-3.5 text-center">القطعة المستهدفة</th>
                <th className="px-6 py-3.5">اسم ورشة المكن / الخياطة</th>
                <th className="px-6 py-3.5 text-center">القطع المرسلة</th>
                {canViewSewingPrices() && (
                  <>
                    <th className="px-6 py-3.5 text-center">سعر القطعة</th>
                    <th className="px-6 py-3.5 text-center">إجمالي التشغيل</th>
                  </>
                )}
                <th className="px-6 py-3.5 text-center">تاريخ الإرسال</th>
                <th className="px-6 py-3.5 text-center">تاريخ الاستلام المتوقع / الفعلي</th>
                <th className="px-6 py-3.5 text-center">الحالة والتنبيه</th>
                <th className="px-6 py-3.5 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleDispatches.length > 0 ? (
                visibleDispatches.map((disp) => {
                  const m = models.find((model) => model.id === disp.model_id);
                  const isShirt = disp.piece_type === 'shirt';
                  const totalPieces = Math.max(0, Number(disp.pieces_count || 0));
                  const receivedPieces = Math.max(0, Number(disp.received_pieces || 0));
                  const remainingPieces = Math.max(0, totalPieces - receivedPieces);
                  const progressPct =
                    totalPieces > 0 ? Math.min(100, Math.round((receivedPieces / totalPieces) * 100)) : 0;

                  return (
                    <tr key={disp.id} className="hover:bg-slate-50/80 transition">
                      <td className="px-6 py-4 font-bold text-slate-900">
                        <div className="flex items-center gap-3">
                          {m && (
                            <div className="w-12 h-12 rounded-xl bg-white border border-slate-200 p-1 shrink-0 flex items-center justify-center overflow-hidden">
                              <ZoomableImage
                                src={m.image}
                                alt={m.model_code}
                                downloadName={`${m.model_code}.jpg`}
                                className="w-full h-full object-contain"
                              />
                            </div>
                          )}
                          <div>
                            <span className="block text-slate-900 font-extrabold text-sm">{m?.model_code || '—'}</span>
                            <span className="text-[11px] text-slate-500">{m?.model_type || 'ملابس جاهزة'}</span>
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black ${
                            isShirt
                              ? 'bg-blue-100 text-blue-800 border border-blue-200'
                              : disp.piece_type === 'jacket'
                              ? 'bg-amber-100 text-amber-800 border border-amber-200'
                              : disp.piece_type === 'single'
                              ? 'bg-purple-100 text-purple-800 border border-purple-200'
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          }`}
                        >
                          {disp.piece_label || getPartLabel(disp.piece_type || 'shirt')}
                        </span>
                      </td>

                      <td className="px-6 py-4 font-extrabold text-slate-800">
                        <div className="flex items-center gap-1.5">
                          <Scissors className="w-4 h-4 text-emerald-600" />
                          <span>{disp.workshop_name}</span>
                        </div>
                        {disp.notes && (
                          <p className="text-[11px] text-slate-500 font-normal mt-0.5 max-w-xs truncate">
                            {disp.notes}
                          </p>
                        )}
                      </td>

                      <td className="px-6 py-4 text-center font-black text-slate-900 text-sm">
                        <div>{totalPieces.toLocaleString('ar-EG')} ق</div>
                        <div className="mt-1.5 w-28 mx-auto">
                          <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                remainingPieces === 0
                                  ? 'bg-emerald-600'
                                  : receivedPieces > 0
                                    ? 'bg-amber-500'
                                    : 'bg-slate-300'
                              }`}
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                          <div className="mt-1 flex items-center justify-between text-[10px] font-bold">
                            <span className="text-emerald-700">
                              مستلم {receivedPieces.toLocaleString('ar-EG')}
                            </span>
                            <span className={remainingPieces > 0 ? 'text-amber-700' : 'text-slate-400'}>
                              متبقي {remainingPieces.toLocaleString('ar-EG')}
                            </span>
                          </div>
                        </div>
                        {disp.status === 'استلام جزئي' && (
                          <span className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                            <Clock className="w-3 h-3" />
                            استلام جزئي
                          </span>
                        )}
                      </td>

                      {canViewSewingPrices() && (
                        <>
                          <td className="px-6 py-4 text-center font-mono font-bold text-slate-700">
                            {disp.cost_per_piece ? `${disp.cost_per_piece} ج.م` : '—'}
                          </td>
                          <td className="px-6 py-4 text-center font-mono font-black text-emerald-800">
                            {disp.total_cost
                              ? `${Number(disp.total_cost).toLocaleString('ar-EG')} ج.م`
                              : '—'}
                          </td>
                        </>
                      )}

                      <td className="px-6 py-4 text-center text-slate-500 font-mono text-[11px]">
                        {disp.dispatched_at}
                      </td>

                      <td className="px-6 py-4 text-center font-mono font-bold text-slate-800">
                        <div>{disp.expected_delivery_date || 'غير محدد'}</div>
                        {disp.received_at && (
                          <div className="mt-1 text-[10px] font-bold text-emerald-700">
                            استلم: {disp.received_at}
                          </div>
                        )}
                      </td>

                      <td className="px-6 py-4 text-center">
                        {getDateStatusBadge(disp.expected_delivery_date, disp.status)}
                      </td>

                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {disp.status !== 'تم الاستلام' ? (
                            <button
                              onClick={() => handleReceive(disp)}
                              className="px-3 py-1.5 rounded-xl font-bold text-xs shadow-xs transition flex items-center gap-1 cursor-pointer bg-purple-700 hover:bg-purple-800 text-white"
                              title="تسجيل وقت الاستلام وتوجيهها للعد بعد المكن"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              <span>استلام</span>
                            </button>
                          ) : (
                            <span className="text-emerald-700 font-bold text-xs flex items-center gap-1">
                              <CheckCircle className="w-3.5 h-3.5" />
                              <span>تم</span>
                            </span>
                          )}

                          <button
                            onClick={() => {
                              setExtraAccessoryDispatch(disp);
                              setExtraAccessoryId('');
                              setExtraAccessoryQty(1);
                            }}
                            className="p-1.5 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-800 transition cursor-pointer"
                            title="صرف إكسسوار إضافي للورشة (بدل فاقد/تالف)"
                          >
                            <PackagePlus className="w-4 h-4" />
                          </button>

                          {m && (
                            <button
                              onClick={() =>
                                setPrintTarget({ modelId: m.id, tab: disp.piece_type || 'shirt' })
                              }
                              className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
                              title="طباعة ورقة التشغيل الخاصة بهذه القطعة"
                            >
                              <Printer className="w-4 h-4" />
                            </button>
                          )}

                          {disp.workshop_name && (() => {
                            const existingEv = workshopEvaluations.find(
                              (ev) => ev.sewing_dispatch_id === disp.id && ev.stage === 'sewing'
                            ) || null;
                            const matchedW = workshops.find((w) => w.name === disp.workshop_name);
                            return (
                              <button
                                type="button"
                                onClick={() =>
                                  setEvalTarget({
                                    workshopId: matchedW?.id,
                                    workshopName: disp.workshop_name,
                                    stage: 'sewing',
                                    modelId: disp.model_id,
                                    modelCode: m?.model_code || '—',
                                    sewingDispatchId: disp.id,
                                    expectedDate: disp.expected_delivery_date,
                                    actualDate: disp.received_at,
                                    existing: existingEv
                                  })
                                }
                                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-bold text-xs border transition cursor-pointer whitespace-nowrap ${
                                  existingEv
                                    ? 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200'
                                    : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                                }`}
                                title={existingEv ? 'تعديل تقييم ورشة المكن' : 'تقييم ورشة المكن'}
                              >
                                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-500" />
                                <span>{existingEv ? `${existingEv.overall_score}/5` : 'تقييم'}</span>
                              </button>
                            );
                          })()}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={canViewSewingPrices() ? 10 : 8} className="px-6 py-8 text-center text-slate-400">
                    لا توجد تشغيلات مسجلة تطابق البحث المحدد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* DISPATCH TO SEWING MODAL */}
      {showDispatchModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-3xl w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto p-4 sm:p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className={`w-9 h-9 rounded-2xl flex items-center justify-center text-white font-bold ${
                  PART_CARD_STYLES[dispatchPieceType]?.badgeColor || 'bg-blue-600'
                }`}>
                  <Scissors className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-base">
                    تسجيل خروج لورشة الخياطة — [{dispatchPieceLabel}]
                  </h3>
                  <p className="text-xs text-slate-500">
                    تحديد اسم ورشة المكن وتاريخ الاستلام المتوقع المستهدف
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDispatchModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitDispatch} className="space-y-4 mt-4">
              {/* Piece Selection toggle inside modal */}
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">القطعة المستهدفة للخياطة *</label>
                <div className="grid grid-cols-2 gap-2">
                  {(() => {
                    const dm = models.find((m) => m.id === selectedModelId);
                    const sewingParts = dm
                      ? getModelParts(dm.id).filter(
                          (part) => (getPartStages(dm.id)[part] || 'cutting') === 'sewing'
                        )
                      : [];
                    const parts: GarmentPart[] =
                      sewingParts.length > 0
                        ? sewingParts
                        : dm
                        ? getModelParts(dm.id)
                        : (['shirt', 'pants'] as GarmentPart[]);
                    return parts.map((part) => (
                      <button
                        key={part}
                        type="button"
                        onClick={() => {
                          setDispatchPieceType(part);
                          setDispatchPieceLabel(getPartLabel(part));
                        }}
                        className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                          dispatchPieceType === part
                            ? 'border-purple-500 bg-purple-50 text-purple-800 ring-2 ring-purple-500/20'
                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <Shirt className="w-4 h-4" />
                        <span>
                          {PART_EMOJI[part]} خط {getPartLabel(part)}
                        </span>
                      </button>
                    ));
                  })()}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="block text-xs font-bold text-slate-600">
                    اسم ورشة المكن / الخياطة *
                  </label>
                  {selectedSewingWorkshop &&
                    (selectedSewingWorkshop.phone || selectedSewingWorkshop.whatsapp_group_link) && (
                      <button
                        type="button"
                        onClick={() =>
                          openWhatsAppOrder(
                            selectedSewingWorkshop.phone,
                            selectedSewingWorkshop.whatsapp_group_link,
                            buildSewingWhatsappMessage()
                          )
                        }
                        className="px-3 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold transition cursor-pointer"
                        title={
                          selectedSewingWorkshop.whatsapp_group_link
                            ? 'فتح جروب الواتساب (سيتم نسخ نص الطلب تلقائياً)'
                            : 'إرسال أمر التشغيل عبر واتساب'
                        }
                      >
                        💬 إرسال عبر واتساب
                      </button>
                    )}
                </div>
                <select
                  required
                  value={workshopSelection}
                  onChange={(e) => setWorkshopSelection(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-bold bg-white focus:ring-2 focus:ring-emerald-700 focus:outline-hidden"
                >
                  <option value="">— اختر ورشة المكن / الخياطة —</option>
                  {sewingWorkshops.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                  <option value="__custom__">أخرى / كتابة يدوية</option>
                </select>
                {workshopSelection === '__custom__' && (
                  <input
                    type="text"
                    required
                    placeholder="اكتب اسم ورشة المكن / الخياطة يدوياً"
                    value={customWorkshopName}
                    onChange={(e) => setCustomWorkshopName(e.target.value)}
                    className="mt-2 w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-bold focus:ring-2 focus:ring-emerald-700 focus:outline-hidden"
                  />
                )}
                {sewingWorkshops.length === 0 && (
                  <p className="mt-1.5 text-[11px] text-amber-600 font-bold">
                    لا توجد ورش خياطة مسجلة — أضفها من الإعدادات ← المقاسات والموردين والورش.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">عدد القطع المسلمة *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={piecesCount}
                    onChange={(e) => setPiecesCount(parseInt(e.target.value) || 0)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs text-center font-bold focus:ring-2 focus:ring-emerald-700 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    تاريخ الاستلام المتوقع من الورشة *
                  </label>
                  <input
                    type="date"
                    required
                    value={expectedDeliveryDate}
                    onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-mono font-bold focus:ring-2 focus:ring-emerald-700 focus:outline-hidden"
                  />
                </div>
              </div>

              {/* بيان إكسسوارات التشغيلة (المطلوب لكل قطعة × عدد القطع) */}
              <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-xs font-black text-indigo-900">
                    <Package className="w-4 h-4" />
                    بيان إكسسوارات هذه التشغيلة
                  </div>
                  <span className="text-[10px] font-bold text-indigo-700">
                    {dispatchPieceLabel} • {piecesCount || 0} قطعة
                  </span>
                </div>
                {dispatchManifest.length === 0 ? (
                  <p className="text-[11px] text-indigo-500">
                    لا توجد إكسسوارات مسجلة لهذه القطعة في الموديل.
                  </p>
                ) : (
                  <ul className="space-y-1.5 max-h-40 overflow-y-auto">
                    {dispatchManifest.map((acc) => {
                      const required = Math.ceil(
                        Number(acc.piece_consumption || 1) * Math.max(0, piecesCount)
                      );
                      const stock = getAccessoryStock(acc);
                      const alreadyIssued = Boolean(acc.is_issued);
                      const short = !alreadyIssued && required > stock;
                      return (
                        <li
                          key={acc.id}
                          className="flex items-center justify-between gap-2 rounded-xl bg-white border border-indigo-100 px-2.5 py-1.5 text-[11px]"
                        >
                          <span className="font-bold text-slate-700 truncate">
                            {acc.accessory_name}
                            {acc.unit ? ` (${acc.unit})` : ''}
                          </span>
                          <span className="flex items-center gap-2 shrink-0 font-bold">
                            <span className="text-indigo-800">
                              مطلوب: {required.toLocaleString('ar-EG')}
                            </span>
                            {alreadyIssued ? (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                                تم الصرف مسبقاً
                              </span>
                            ) : (
                              <>
                                <span className={short ? 'text-red-600' : 'text-emerald-600'}>
                                  بالمخزن: {Number(stock).toLocaleString('ar-EG')}
                                </span>
                                {short && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
                                    نقص
                                  </span>
                                )}
                              </>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="mt-2 text-[10px] text-indigo-500 font-normal">
                  تُصرف الإكسسوارات من مخزن الإكسسوارات مع التشغيلة. عند الحاجة لبدل فاقد/تالف استخدم زر
                  «صرف إكسسوار إضافي» في جدول التشغيلات.
                </p>
              </div>

              {/* سعر تشغيل القطعة: يظهر فقط لمن يملك صلاحية تعديل أسعار المكن */}
              {canEditSewingPrices() && (
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    سعر تشغيل القطعة (ج.م)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={sewingCost}
                    onChange={(e) => setSewingCost(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs text-center font-bold focus:ring-2 focus:ring-emerald-700 focus:outline-hidden"
                  />
                  <p className="mt-1 text-[10px] text-slate-400">
                    يُحسب الإجمالي تلقائياً = السعر × عدد القطع المسلمة.
                  </p>
                </div>
              )}

              {/* Optional Sewing Notes gated by can_add_sewing_notes */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-600">
                    ملاحظات التشغيل والورشة (اختياري)
                  </label>
                  {!allowSewingNotes && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                      <Lock className="w-3 h-3" />
                      <span>يتطلب صلاحية تسجيل ملاحظات المكن</span>
                    </span>
                  )}
                </div>
                {allowSewingNotes ? (
                  <textarea
                    rows={2}
                    value={dispatchNotes}
                    onChange={(e) => setDispatchNotes(e.target.value)}
                    placeholder="أي تعليمات خاصة بالخياطة، السرفلة، المقاسات، أو الإكسسوارات..."
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-700 focus:outline-hidden"
                  ></textarea>
                ) : (
                  <div className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-[11px] text-slate-400">
                    إدخال الملاحظات في قسم المكن غير مفعل لحسابك حالياً.
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowDispatchModal(false)}
                  className="px-4 py-2 rounded-full text-xs font-bold text-slate-600 hover:bg-slate-100"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isDispatchSubmitting}
                  className="px-6 py-2 rounded-full bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-md shadow-emerald-700/20 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isDispatchSubmitting ? 'جاري الإرسال...' : 'تأكيد الإرسال للورشة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RECEIVE FROM SEWING MODAL (TIMESTAMP-ONLY — COUNTING & EVALUATION HAPPEN IN QC) */}
      {receivingDispatch && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4"
          onClick={() => setReceivingDispatch(null)}
        >
          <div
            className="bg-white rounded-3xl w-[95vw] sm:w-full max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-purple-600 text-white flex items-center justify-center">
                  <CheckCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-base">
                    تسجيل استلام من ورشة المكن
                  </h3>
                  <p className="text-xs text-slate-500">
                    {models.find((mm) => mm.id === receivingDispatch.model_id)?.model_code || 'موديل'} •{' '}
                    ورشة {receivingDispatch.workshop_name} •{' '}
                    {receivingDispatch.piece_label || getPartLabel(receivingDispatch.piece_type || 'shirt')}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setReceivingDispatch(null)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={confirmReceiveFromSewing} className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] font-bold text-slate-500">ورشة المكن</div>
                  <div className="text-xs font-black text-slate-800 truncate">
                    {receivingDispatch.workshop_name}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] font-bold text-slate-500">العدد المرسل</div>
                  <div className="text-xs font-black text-slate-800">
                    {Number(receivingDispatch.pieces_count || 0).toLocaleString('ar-EG')} قطعة
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] font-bold text-slate-500">تاريخ الخروج</div>
                  <div className="text-xs font-mono font-bold text-slate-700">
                    {receivingDispatch.dispatched_at || '—'}
                  </div>
                </div>
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                  <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-700">
                    <Clock className="w-3 h-3" />
                    وقت الاستلام الآن
                  </div>
                  <div className="text-xs font-mono font-black text-emerald-800">
                    {new Date().toLocaleString('ar-EG', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-purple-50/70 border border-purple-200 px-3.5 py-2.5 text-[11px] font-semibold text-purple-900 leading-relaxed">
                سيتم تسجيل <strong>تاريخ ووقت الاستلام</strong> وتحويل القطعة مباشرة إلى <strong>العد بعد المكن (QC)</strong>، حيث يتم إدخال العد الفعلي وتقييم أداء الورشة.
              </div>

              {allowSewingNotes && (
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    ملاحظات استلام المكن (اختياري)
                  </label>
                  <textarea
                    rows={2}
                    value={receiveNotes}
                    onChange={(e) => setReceiveNotes(e.target.value)}
                    placeholder="أي ملاحظات سريعة عند الاستلام من الورشة..."
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-purple-600 focus:outline-hidden"
                  />
                </div>
              )}

              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReceivingDispatch(null)}
                  className="px-4 py-2 rounded-full text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isReceivingSubmitting}
                  className="px-6 py-2 rounded-full bg-purple-700 hover:bg-purple-800 disabled:bg-slate-300 disabled:text-slate-500 text-white font-bold text-xs shadow-md shadow-purple-700/20 cursor-pointer"
                >
                  {isReceivingSubmitting ? 'جارٍ التسجيل...' : 'تأكيد الاستلام وتحويل للعد'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EXTRA ACCESSORY DISPENSE MODAL (بدل فاقد/تالف أو احتياج زائد) */}
      {extraAccessoryDispatch && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-3xl w-[95vw] sm:w-full max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-amber-600 text-white flex items-center justify-center">
                  <PackagePlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-base">
                    صرف إكسسوار إضافي لورشة المكن
                  </h3>
                  <p className="text-xs text-slate-500">
                    ورشة: {extraAccessoryDispatch.workshop_name} •{' '}
                    {extraAccessoryDispatch.piece_label ||
                      getPartLabel(extraAccessoryDispatch.piece_type || 'shirt')}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setExtraAccessoryDispatch(null);
                  setExtraAccessoryId('');
                  setExtraAccessoryQty(1);
                }}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleExtraAccessoryDispense} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  صنف الإكسسوار *
                </label>
                <select
                  required
                  value={extraAccessoryId}
                  onChange={(e) => setExtraAccessoryId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-bold bg-white focus:ring-2 focus:ring-amber-600 focus:outline-hidden"
                >
                  <option value="">— اختر صنف الإكسسوار —</option>
                  {extraAccessoryOptions.map((row) => (
                    <option key={row.itemId} value={row.itemId}>
                      {row.acc.accessory_name} — رصيد {Number(row.stock).toLocaleString('ar-EG')}{' '}
                      {row.acc.unit || ''}
                    </option>
                  ))}
                </select>
                {extraAccessoryOptions.length === 0 && (
                  <p className="mt-1.5 text-[11px] font-bold text-amber-600">
                    لا توجد أصناف إكسسوارات متاحة للصرف — راجع مخزن الإكسسوارات.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  الكمية المصروفة *
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  value={extraAccessoryQty || ''}
                  onChange={(e) => setExtraAccessoryQty(parseInt(e.target.value) || 0)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm text-center font-black text-amber-800 focus:ring-2 focus:ring-amber-600 focus:outline-hidden"
                />
                {(() => {
                  const selected = extraAccessoryOptions.find(
                    (row) => row.itemId === extraAccessoryId
                  );
                  if (!selected) return null;
                  return (
                    <p className="mt-1 text-[10px] font-bold text-slate-500">
                      الرصيد المتاح بالمخزن: {Number(selected.stock).toLocaleString('ar-EG')}{' '}
                      {selected.acc.unit || ''}
                    </p>
                  );
                })()}
              </div>

              <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800 leading-relaxed">
                يُسجَّل الصرف على مخزن الإكسسوارات ويُربط بالموديل والورشة، ويُخصم من الرصيد فوراً.
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setExtraAccessoryDispatch(null);
                    setExtraAccessoryId('');
                    setExtraAccessoryQty(1);
                  }}
                  className="px-4 py-2 rounded-full text-xs font-bold text-slate-600 hover:bg-slate-100"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 rounded-full bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-md shadow-amber-600/20 cursor-pointer inline-flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  تأكيد الصرف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* أمر التشغيل النظيف (بنفس تنسيق أوردر القص) — معاينة + قص صورة مؤقت + طباعة A4 */}
      {printTargetModel && (
        <SewingPrintModal
          model={printTargetModel}
          initialTab={printTarget?.tab || 'both'}
          onClose={() => setPrintTarget(null)}
        />
      )}

      {/* نافذة تقييم ورشة المكن */}
      <WorkshopEvaluationModal target={evalTarget} onClose={() => setEvalTarget(null)} />
    </div>
  );
};
