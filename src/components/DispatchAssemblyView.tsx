import React, { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { makeIdempotentRequestId } from '../context/appContextTypes';
import {
  Printer,
  Plus,
  Truck,
  CheckCircle2,
  Layers,
  X,
  Lock,
  Star,
  Search,
  Clock
} from 'lucide-react';
import { DispatchStatus, GarmentPart, PART_EMOJI, getPartLabel, PrintDispatch, PART_STAGE_LABELS, PartStage } from '../types';
import { PrintShopOrderModal } from './PrintShopOrderModal';
import { CompletedModelsToggle, EndedModelBadge } from './CompletedModelsToggle';
import { stageBeyond } from '../utils/completedModels';
import { ZoomableImage } from './ZoomableImage';
import { SortBySelect, compareNatural, toTimestamp } from './SortBySelect';
import { useModalBackHandler } from '../utils/mobileBackNav';
import {
  WorkshopEvaluationModal,
  WorkshopEvaluationTarget
} from './WorkshopEvaluationModal';

/** نوع تشغيل افتراضي يُرسل للباك إند بعد إخفاء حقل "نوع التشغيل" من الواجهة. */
const DEFAULT_PRINT_TYPE = 'سلك سكرين مائي';

type PrintSortKey = 'newest' | 'oldest' | 'code_asc' | 'code_desc' | 'qty_desc' | 'qty_asc';

const PRINT_SORT_OPTIONS: { value: PrintSortKey; label: string }[] = [
  { value: 'newest', label: 'الأحدث أولاً' },
  { value: 'oldest', label: 'الأقدم أولاً' },
  { value: 'code_asc', label: 'الكود (تصاعدي)' },
  { value: 'code_desc', label: 'الكود (تنازلي)' },
  { value: 'qty_desc', label: 'الكمية (الأكثر أولاً)' },
  { value: 'qty_asc', label: 'الكمية (الأقل أولاً)' }
];

export const DispatchAssemblyView: React.FC = () => {
  const {
    models,
    qcRecords,
    printDispatches,
    getModelParts,
    getPartStages,
    addPrintDispatch,
    updateDispatchStatus,
    skipPrintToSewing,
    workshops,
    workshopEvaluations,
    openWhatsAppOrder,
    hasPermission,
    canViewPreviousModels,
    canViewPrintingPrices,
    canEditPrintingPrices,
    canAddPrintingNotes,
    canAddQCBeforePrintNotes,
    exportPrintDispatchesCsv
  } = useApp();

  const canEdit = hasPermission('printing', true) || hasPermission('qc', true) || hasPermission('cutting', true);
  const allowPrintNotes = canAddPrintingNotes() || canAddQCBeforePrintNotes();
  const canSeePrevious = canViewPreviousModels();

  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<PrintSortKey>('newest');
  const [showCompleted, setShowCompleted] = useState(false);
  const effectiveShowCompleted = showCompleted && canSeePrevious;

  // Parts that already have an open print dispatch are not "ready" any more;
  // they wait in the dispatches table until received.
  const openPrintKeys = new Set(
    printDispatches
      .filter((d) => d.status !== 'تم الاستلام بالمصنع')
      .map((d) => `${d.model_id}-${d.piece_type || 'shirt'}`)
  );

  // Parts currently at the printing stage — every part is its own independent card.
  const readyPartCards = models.flatMap((m) => {
    if (m.is_deleted) return [] as { model: typeof m; part: GarmentPart }[];
    const stages = getPartStages(m.id);
    return getModelParts(m.id)
      .filter(
        (part) =>
          (stages[part] || 'cutting') === 'printing' &&
          !openPrintKeys.has(`${m.id}-${part}`)
      )
      .map((part) => ({ model: m, part }));
  });
  const readyModels = models.filter(
    (m) => !m.is_deleted && readyPartCards.some((card) => card.model.id === m.id)
  );

  // الموديلات/القطع التي تجاوزت مرحلة المطابع (منتهية من هذا القسم).
  const endedPartCards = models.flatMap((m) => {
    if (m.is_deleted) return [] as { model: typeof m; part: GarmentPart }[];
    const stages = getPartStages(m.id);
    return getModelParts(m.id)
      .filter((part) => stageBeyond(stages[part], 'printing'))
      .map((part) => ({ model: m, part }));
  });

  const getPartGoodQty = (modelIdVal: string, part: GarmentPart) => {
    const m = models.find((mm) => mm.id === modelIdVal);
    const partQcRecords = qcRecords.filter(
      (q) => q.model_id === modelIdVal && (q.part_type || 'shirt') === part
    );
    return (
      m?.qc_summary?.[part] ??
      partQcRecords.reduce((sum, q) => sum + (q.good_qty ?? q.counted_pieces ?? 0), 0)
    );
  };

  const filteredReadyPartCards = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const list = readyPartCards.filter(({ model, part }) => {
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
      if (sortBy === 'qty_desc') return getPartGoodQty(b.model.id, b.part) - getPartGoodQty(a.model.id, a.part);
      if (sortBy === 'qty_asc') return getPartGoodQty(a.model.id, a.part) - getPartGoodQty(b.model.id, b.part);
      if (sortBy === 'oldest') return toTimestamp(a.model.created_at) - toTimestamp(b.model.created_at);
      return toTimestamp(b.model.created_at) - toTimestamp(a.model.created_at);
    });
  }, [readyPartCards, searchTerm, sortBy, qcRecords]);

  const filteredEndedPartCards = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const list = endedPartCards.filter(({ model, part }) => {
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
      if (sortBy === 'qty_desc') return getPartGoodQty(b.model.id, b.part) - getPartGoodQty(a.model.id, a.part);
      if (sortBy === 'qty_asc') return getPartGoodQty(a.model.id, a.part) - getPartGoodQty(b.model.id, b.part);
      if (sortBy === 'oldest') return toTimestamp(a.model.created_at) - toTimestamp(b.model.created_at);
      return toTimestamp(b.model.created_at) - toTimestamp(a.model.created_at);
    });
  }, [endedPartCards, searchTerm, sortBy, qcRecords]);

  const visibleDispatches = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const list = printDispatches.filter((disp) => {
      const isDone = disp.status === 'تم الاستلام بالمصنع';
      if (effectiveShowCompleted ? !isDone : isDone) return false;
      if (!q) return true;
      const m = models.find((mm) => mm.id === disp.model_id);
      return (
        (m?.model_code || '').toLowerCase().includes(q) ||
        (disp.shop_name || '').toLowerCase().includes(q) ||
        (disp.piece_label || getPartLabel(disp.piece_type || 'shirt')).toLowerCase().includes(q) ||
        (disp.print_location || '').toLowerCase().includes(q) ||
        (disp.print_details || '').toLowerCase().includes(q)
      );
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
  }, [printDispatches, models, searchTerm, sortBy, effectiveShowCompleted]);

  const [showModal, setShowModal] = useState(false);
  const [modelId, setModelId] = useState(readyModels[0]?.id || '');
  const [shopSelection, setShopSelection] = useState('');
  const [customShopName, setCustomShopName] = useState('');
  const [piecesCount, setPiecesCount] = useState<number>(100);
  const [pieceType, setPieceType] = useState<GarmentPart>('shirt');
  const [printLocation, setPrintLocation] = useState('صدر');
  const [printDetails, setPrintDetails] = useState('');

  // Garment parts of the selected model that are still awaiting printing.
  const selectedModel = readyModels.find((m) => m.id === modelId) || null;
  const selectedModelParts = selectedModel
    ? readyPartCards
        .filter((card) => card.model.id === selectedModel.id)
        .map((card) => card.part)
    : [];
  // القطعة المختارة يجب أن تكون من قطع الموديل فعلياً، وإلا نرجع لأول قطعة متاحة
  const effectivePieceType: GarmentPart = selectedModelParts.includes(pieceType)
    ? pieceType
    : selectedModelParts[0] || 'shirt';
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d.toISOString().slice(0, 10);
  });
  const [notes, setNotes] = useState('');
  const [printCost, setPrintCost] = useState('');
  const [printTarget, setPrintTarget] = useState<PrintDispatch | null>(null);

  // استلام سريع من المطبعة (تسجيل وقت الاستلام فقط — والعد وتقييم الورشة يتم في "العد بعد الطباعة").
  const [receivingDispatch, setReceivingDispatch] = useState<PrintDispatch | null>(null);
  const [receiveNotes, setReceiveNotes] = useState('');
  const [evalTarget, setEvalTarget] = useState<WorkshopEvaluationTarget | null>(null);

  useModalBackHandler(showModal, () => setShowModal(false));
  useModalBackHandler(Boolean(receivingDispatch), () => setReceivingDispatch(null));
  useModalBackHandler(Boolean(printTarget), () => setPrintTarget(null));

  const openReceiveModal = (disp: PrintDispatch) => {
    setReceivingDispatch(disp);
    setReceiveNotes(disp.notes || '');
  };

  const [isReceivingSubmitting, setIsReceivingSubmitting] = useState(false);
  const [isDispatchSubmitting, setIsDispatchSubmitting] = useState(false);
  const submitLockRef = React.useRef(false);
  const pendingDispatchReqIdRef = React.useRef<string | null>(null);

  const confirmQuickReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receivingDispatch || isReceivingSubmitting) return;
    setIsReceivingSubmitting(true);
    try {
      updateDispatchStatus(
        receivingDispatch.id,
        'تم الاستلام بالمصنع',
        undefined,
        allowPrintNotes ? receiveNotes.trim() : undefined,
        true
      );
      setReceivingDispatch(null);
      setReceiveNotes('');
    } finally {
      setIsReceivingSubmitting(false);
    }
  };

  // ورش المطابع والتطريز فقط (يمكن أن تحمل الورشة أكثر من تخصص).
  const printWorkshops = workshops.filter((w) =>
    (w.workshop_type || []).some((t) => t === 'printing' || t === 'embroidery')
  );
  const selectedShopWorkshop = printWorkshops.find((w) => w.id === shopSelection) || null;
  const resolvedShopName =
    selectedShopWorkshop
      ? selectedShopWorkshop.name
      : shopSelection === '__custom__'
        ? customShopName.trim()
        : '';

  const buildShopWhatsappMessage = (): string => {
    const modelCode = selectedModel?.model_code || '';
    return [
      `طلب تشغيلة طباعة / تطريز${selectedShopWorkshop ? ` - ${selectedShopWorkshop.name}` : ''}`,
      `الموديل: ${modelCode}`,
      `نوع القطعة: ${getPartLabel(effectivePieceType)}`,
      `الكمية: ${piecesCount}`,
      `مكان الطباعة: ${printLocation || '-'}`,
      printDetails ? `تفاصيل الطباعة: ${printDetails}` : '',
      `تاريخ التسليم المتوقع: ${expectedDeliveryDate}`,
      notes ? `ملاحظات: ${notes}` : ''
    ]
      .filter(Boolean)
      .join('\n');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modelId || !resolvedShopName || submitLockRef.current || isDispatchSubmitting) return;

    const requestedQty = Number(piecesCount) || 0;
    const partCut =
      Number(selectedModel?.cut_summary?.[effectivePieceType] ?? 0) ||
      Number(
        effectivePieceType === 'shirt'
          ? selectedModel?.cut_shirt_pieces
          : effectivePieceType === 'pants'
          ? selectedModel?.cut_pants_pieces
          : effectivePieceType === 'jacket'
          ? selectedModel?.cut_jacket_pieces
          : selectedModel?.total_cut_pieces
      ) ||
      Number(selectedModel?.total_cut_pieces ?? 0);
    const beforePrintGood = qcRecords
      .filter(
        (q) =>
          q.model_id === modelId &&
          q.stage === 'before_print' &&
          (q.part_type || q.partType || 'shirt') === effectivePieceType
      )
      .reduce((sum, q) => sum + Number(q.good_qty ?? q.counted_pieces ?? 0), 0);

    const exceedsCut = partCut > 0 && requestedQty > partCut;
    const exceedsBeforePrint = beforePrintGood > 0 && requestedQty > beforePrintGood;
    let allowOverLimit = false;

    if (exceedsCut || exceedsBeforePrint) {
      let confirmMsg = '';
      if (exceedsCut && exceedsBeforePrint && beforePrintGood !== partCut) {
        confirmMsg = `⚠️ تنبيه: العدد المراد إرساله للمطبعة (${requestedQty}) أكبر من العدد المسجل قبل الطباعة (${beforePrintGood}) والعدد المقصوص للقطعة (${partCut}). هل أنت متأكد من المتابعة وإرسال هذه التشغيلة؟`;
      } else if (exceedsCut) {
        confirmMsg = `⚠️ تنبيه: العدد المراد إرساله للمطبعة (${requestedQty}) أكبر من العدد المقصوص للقطعة (${partCut}). هل أنت متأكد من المتابعة وإرسال هذه التشغيلة؟`;
      } else {
        confirmMsg = `⚠️ تنبيه: العدد المراد إرساله للمطبعة (${requestedQty}) أكبر من العدد المسجل في العد قبل الطباعة (${beforePrintGood}). هل أنت متأكد من المتابعة وإرسال هذه التشغيلة؟`;
      }
      if (!window.confirm(confirmMsg)) {
        return;
      }
      allowOverLimit = true;
    }

    if (!pendingDispatchReqIdRef.current) {
      pendingDispatchReqIdRef.current = makeIdempotentRequestId('disp');
    }
    const reqId = pendingDispatchReqIdRef.current;
    submitLockRef.current = true;
    setIsDispatchSubmitting(true);
    let ok = false;
    try {
      ok = await addPrintDispatch({
        modelId,
        clientId: reqId,
        shopName: resolvedShopName,
        piecesCount: requestedQty,
        printType: DEFAULT_PRINT_TYPE,
        pieceType: effectivePieceType,
        pieceLabel: getPartLabel(effectivePieceType),
        printLocation: printLocation.trim(),
        printDetails: printDetails.trim(),
        expectedDeliveryDate,
        costPerPiece: canEditPrintingPrices() ? Math.max(0, parseFloat(printCost) || 0) : 0,
        notes: allowPrintNotes ? notes.trim() : '',
        allowOverLimit
      });
    } finally {
      submitLockRef.current = false;
      setIsDispatchSubmitting(false);
    }

    if (ok) {
      pendingDispatchReqIdRef.current = null;
      setShowModal(false);
      setShopSelection('');
      setCustomShopName('');
      setNotes('');
      setPrintCost('');
      setPrintDetails('');
    }
  };

  const getStatusBadge = (status: DispatchStatus) => {
    switch (status) {
      case 'مرسل للمطبعة':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'قيد التنفيذ':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'استلام جزئي':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'تم الاستلام بالمصنع':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header (Section 5: Renamed to المطابع والتطريز) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-teal-700 tracking-tight flex items-center gap-2">
            <Printer className="w-7 h-7 text-teal-600" />
            <span>قسم المطابع والتطريز (Printing & Embroidery)</span>
          </h2>
          <p className="text-slate-500 text-sm mt-0.5">
            إرسال الموديلات المعتمدة بعد القص لمطابع السلك سكرين والديجيتال وورش التطريز، وتوجيهها آلياً للعد بعد الاستلام.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="relative w-full sm:w-56">
            <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="بحث بكود الموديل أو المطبعة..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full ps-9 pe-3 py-2 rounded-full border border-slate-200 bg-white text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
            />
          </div>
          <SortBySelect
            value={sortBy}
            onChange={(v) => setSortBy(v as PrintSortKey)}
            options={PRINT_SORT_OPTIONS}
          />
          <button
            type="button"
            onClick={exportPrintDispatchesCsv}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition cursor-pointer shrink-0"
          >
            <span>📊 تصدير Excel</span>
          </button>
          <CompletedModelsToggle
            enabled={effectiveShowCompleted}
            count={endedPartCards.length}
            onChange={setShowCompleted}
            tone="teal"
          />
          {canEdit && readyModels.length > 0 && !effectiveShowCompleted && (
            <button
              onClick={() => {
                if (readyModels.length > 0) {
                  setModelId(readyModels[0].id);
                }
                setShowModal(true);
              }}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs shadow-md shadow-teal-700/20 transition shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ إرسال تشغيلة للمطبعة / التطريز</span>
            </button>
          )}
        </div>
      </div>

      {/* Ready Parts — hidden exclusively when viewing previous/completed models */}
      {!effectiveShowCompleted && (
      <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs">
        <h3 className="font-extrabold text-slate-900 text-sm mb-4 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-teal-600" />
            <span>القطع الجاهزة للإرسال للمطابع والتطريز ({filteredReadyPartCards.length}):</span>
          </span>
          <span className="text-[11px] text-slate-400 font-normal">
            (كل قطعة تُرسل وتُستلم وتُتخطى بشكل مستقل)
          </span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredReadyPartCards.length > 0 ? (
            filteredReadyPartCards.map(({ model: m, part }) => {
              const partGoodQty = getPartGoodQty(m.id, part);

              return (
                <div
                  key={`${m.id}-${part}`}
                  className="p-4 rounded-2xl border border-teal-200 bg-teal-50/40 hover:bg-teal-50 transition flex flex-col gap-3 shadow-2xs"
                >
                  <div className="flex items-center gap-3">
                    <ZoomableImage
                      src={m.image}
                      alt={m.model_code}
                      downloadName={`${m.model_code}.jpg`}
                      className="w-12 h-12 rounded-xl object-contain bg-white border shrink-0 p-0.5"
                    />
                    <div className="flex-grow min-w-0">
                      <h4 className="font-black text-sm text-slate-900 truncate">
                        {m.model_code}
                      </h4>
                      <span className="inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded-md bg-teal-700 text-white text-[10px] font-bold">
                        {PART_EMOJI[part]} {getPartLabel(part)}
                      </span>
                      <p className="text-[11px] text-slate-500 mt-1">
                        سليم للطباعة:{' '}
                        <strong className="text-teal-800">
                          {Number(partGoodQty || 0).toLocaleString('ar-EG')}
                        </strong>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setModelId(m.id);
                        setPieceType(part);
                        if (Number(partGoodQty) > 0) setPiecesCount(Number(partGoodQty));
                        setShowModal(true);
                      }}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-xl bg-teal-600 text-white hover:bg-teal-700 transition font-bold text-[11px] shadow-xs cursor-pointer"
                      title="إرسال هذه القطعة للمطبعة"
                    >
                      <Truck className="w-3.5 h-3.5" />
                      <span>إرسال للمطبعة</span>
                    </button>
                    <button
                      onClick={() => skipPrintToSewing(m.id, part)}
                      className="inline-flex items-center justify-center gap-1 py-2 px-3 rounded-xl bg-white text-slate-700 border border-slate-300 hover:border-teal-400 transition font-bold text-[11px] cursor-pointer"
                      title="تخطي المطابع وتحويل هذه القطعة مباشرة إلى قسم المكن"
                    >
                      تخطي → المكن
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="col-span-full text-slate-400 text-xs py-3">
              لا توجد قطع حالياً في انتظار الإرسال للمطابع. كل القطع إما قيد التشغيل أو في مراحل لاحقة.
            </p>
          )}
        </div>
      </div>
      )}

      {/* Ended parts in this section (exclusive view when "الموديلات السابقة" is ON) */}
      {effectiveShowCompleted && (
        <div className="bg-slate-50/70 rounded-3xl p-6 border-2 border-dashed border-slate-300 shadow-xs space-y-4">
          <h3 className="font-extrabold text-slate-800 text-sm flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-slate-500" />
              <span>الموديلات السابقة / المنتهية من المطابع والتطريز ({filteredEndedPartCards.length}):</span>
            </span>
            <span className="text-[11px] text-slate-500 font-normal">
              (تم تحويلها مسبقاً — إعادة الإرسال معطلة)
            </span>
          </h3>

          {filteredEndedPartCards.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredEndedPartCards.map(({ model: m, part }) => {
                const stage = getPartStages(m.id)[part] || 'cutting';
                return (
                  <div
                    key={`${m.id}-${part}`}
                    className="p-4 rounded-2xl border-2 border-dashed border-slate-300 bg-white/70 flex flex-col gap-3 shadow-2xs"
                  >
                    <div className="flex items-center gap-3">
                      <ZoomableImage
                        src={m.image}
                        alt={m.model_code}
                        downloadName={`${m.model_code}.jpg`}
                        className="w-12 h-12 rounded-xl object-contain bg-white border shrink-0 p-0.5 grayscale-[55%] opacity-90"
                      />
                      <div className="flex-grow min-w-0">
                        <h4 className="font-black text-sm text-slate-700 truncate">
                          {m.model_code}
                        </h4>
                        <span className="inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded-md bg-slate-500 text-white text-[10px] font-bold">
                          {PART_EMOJI[part]} {getPartLabel(part)}
                        </span>
                        <p className="text-[11px] text-slate-500 mt-1">
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
              لا توجد قطع منتهية من المطابع والتطريز مطابقة للبحث حالياً.
            </p>
          )}
        </div>
      )}

      {/* Dispatches Tracking Table */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-teal-700" />
            <h3 className="font-extrabold text-base text-slate-900">
              {effectiveShowCompleted
                ? 'سجل تشغيلات المطابع السابقة (المستلمة)'
                : 'سجل تشغيلات المطابع والتطريز النشطة'}
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
                <th className="px-6 py-3.5">كود الموديل</th>
                <th className="px-6 py-3.5">المطبعة / ورشة التطريز</th>
                <th className="px-6 py-3.5 text-center">القطع المرسلة</th>
                <th className="px-6 py-3.5 text-center">نوع القطعة</th>
                <th className="px-6 py-3.5">نوع الطباعة / التشغيل</th>
                {canViewPrintingPrices() && (
                  <>
                    <th className="px-6 py-3.5 text-center">تكلفة القطعة</th>
                    <th className="px-6 py-3.5 text-center">الإجمالي</th>
                  </>
                )}
                <th className="px-6 py-3.5 text-center">تاريخ الإرسال</th>
                <th className="px-6 py-3.5 text-center">الاستلام المتوقع / الفعلي</th>
                <th className="px-6 py-3.5 text-center">الحالة</th>
                <th className="px-6 py-3.5 text-center">الإجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleDispatches.length > 0 ? (
                visibleDispatches.map((disp) => {
                  const m = models.find((model) => model.id === disp.model_id);
                  const receivedPieces = Math.max(0, Number(disp.received_pieces || 0));
                  const remainingPieces = Math.max(0, Number(disp.pieces_count || 0) - receivedPieces);
                  const isReceivedStatus = disp.status === 'تم الاستلام بالمصنع';

                  return (
                    <tr key={disp.id} className="hover:bg-slate-50 transition">
                      <td className="px-6 py-4 font-bold text-slate-900 flex items-center gap-2">
                        {m && (
                          <ZoomableImage
                            src={m.image}
                            alt={m.model_code}
                            downloadName={`${m.model_code}.jpg`}
                            className="w-9 h-9 rounded-lg object-contain bg-white border p-0.5"
                          />
                        )}
                        <span>{m?.model_code || 'موديل'}</span>
                      </td>
                      <td className="px-6 py-4 font-bold text-slate-800">{disp.shop_name}</td>
                      <td className="px-6 py-4 text-center font-black text-slate-900 text-sm">
                        <div>{Number(disp.pieces_count || 0).toLocaleString('ar-EG')}</div>
                        {isReceivedStatus ? (
                          <div className="mt-1 text-[10px] font-bold text-emerald-700">
                            {receivedPieces > 0
                              ? `مستلم: ${receivedPieces.toLocaleString('ar-EG')}`
                              : 'بانتظار العد بالفرز'}
                          </div>
                        ) : receivedPieces > 0 ? (
                          <div className="mt-1 text-[10px] font-bold text-amber-700">
                            مستلم {receivedPieces.toLocaleString('ar-EG')} • متبقي {remainingPieces.toLocaleString('ar-EG')}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="px-2 py-0.5 rounded-md bg-teal-700 text-white font-bold text-[10px] whitespace-nowrap">
                          {disp.piece_label || getPartLabel(disp.piece_type || 'shirt')}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-600 font-medium">
                        {disp.print_type}
                        {disp.print_location && (
                          <span className="block text-[10px] text-teal-700 font-bold">
                            📍 {disp.print_location}
                          </span>
                        )}
                        {disp.print_details && (
                          <span className="block text-[10px] text-slate-400">{disp.print_details}</span>
                        )}
                        {disp.notes && <span className="block text-[10px] text-slate-400">{disp.notes}</span>}
                      </td>

                      {/* Printing Cost Columns guarded by permission */}
                      {canViewPrintingPrices() && (
                        <>
                          <td className="px-6 py-4 text-center font-mono font-bold text-slate-700">
                            {disp.cost_per_piece ? `${disp.cost_per_piece} ج.م` : '-'}
                          </td>
                          <td className="px-6 py-4 text-center font-mono font-black text-teal-800">
                            {disp.total_cost ? `${disp.total_cost.toLocaleString('ar-EG')} ج.م` : '-'}
                          </td>
                        </>
                      )}

                      <td className="px-6 py-4 text-center text-slate-500 font-mono">
                        {disp.dispatched_at}
                      </td>
                      <td className="px-6 py-4 text-center">
                        {disp.expected_delivery_date ? (() => {
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          const exp = new Date(disp.expected_delivery_date);
                          exp.setHours(0, 0, 0, 0);
                          const diff = Math.round((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                          const isReceived = disp.status === 'تم الاستلام بالمصنع';

                          if (!isReceived && diff < 0) {
                            return (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-red-100 text-red-700 border border-red-300 animate-pulse">
                                🚨 متأخر ({Math.abs(diff)} يوم)
                              </span>
                            );
                          }
                          if (!isReceived && diff === 0) {
                            return (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-300">
                                ⏰ موعد اليوم!
                              </span>
                            );
                          }
                          if (!isReceived && diff === 1) {
                            return (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                                📅 غداً
                              </span>
                            );
                          }
                          return (
                            <span className="font-mono text-slate-700 text-xs font-semibold">
                              {disp.expected_delivery_date}
                            </span>
                          );
                        })() : (
                          <span className="text-slate-400">-</span>
                        )}
                        {disp.received_at && (
                          <span className="block mt-1 font-mono text-[10px] font-bold text-emerald-700">
                            استلم: {disp.received_at}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span
                          className={`inline-block px-3 py-1 rounded-full text-xs font-bold border ${getStatusBadge(
                            disp.status
                          )}`}
                        >
                          {disp.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex flex-wrap items-center justify-center gap-1.5">
                          {disp.status !== 'تم الاستلام بالمصنع' && canEdit ? (
                            <button
                              onClick={() => openReceiveModal(disp)}
                              className="px-3.5 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition shadow-xs cursor-pointer"
                              title="تسجيل وقت الاستلام بالمصنع وتحويل تلقائي للعد بعد الطباعة"
                            >
                              استلام بالمصنع 📥
                            </button>
                          ) : (
                            <span className="text-emerald-700 font-bold text-xs flex items-center justify-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>مستلم بالفرز</span>
                            </span>
                          )}
                          <button
                            onClick={() => setPrintTarget(disp)}
                            className="px-3.5 py-1.5 rounded-full bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs transition shadow-xs cursor-pointer whitespace-nowrap"
                            title="طباعة أو حفظ أوردر المطبعة PDF"
                          >
                            🖨️ طباعة / PDF للمطبعة
                          </button>
                          {disp.shop_name && (() => {
                            const existingEv = workshopEvaluations.find(
                              (ev) => ev.print_dispatch_id === disp.id && ev.stage === 'printing'
                            ) || null;
                            const dispModel = models.find((mm) => mm.id === disp.model_id);
                            const matchedW = workshops.find((w) => w.name === disp.shop_name);
                            return (
                              <button
                                type="button"
                                onClick={() =>
                                  setEvalTarget({
                                    workshopId: matchedW?.id,
                                    workshopName: disp.shop_name,
                                    stage: 'printing',
                                    modelId: disp.model_id,
                                    modelCode: dispModel?.model_code || '—',
                                    printDispatchId: disp.id,
                                    expectedDate: disp.expected_delivery_date,
                                    actualDate: disp.received_at,
                                    existing: existingEv
                                  })
                                }
                                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full font-bold text-xs border transition cursor-pointer whitespace-nowrap ${
                                  existingEv
                                    ? 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200'
                                    : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                                }`}
                                title={existingEv ? 'تعديل تقييم المطبعة' : 'تقييم أداء المطبعة'}
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
                  <td colSpan={canViewPrintingPrices() ? 10 : 8} className="text-center py-8 text-slate-400">
                    لا توجد تشغيلات مسجلة للمطابع والتطريز بعد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Add Dispatch */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-3xl w-[95vw] sm:w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100 shrink-0">
              <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
                <Truck className="w-5 h-5 text-teal-700" />
                <span>إرسال تشغيلة إلى المطبعة / التطريز</span>
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col">
              {/* Scrollable body — keeps the header (close) and footer (submit) pinned */}
              <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1 min-h-0">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">الموديل *</label>
                <select
                  required
                  value={modelId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setModelId(nextId);
                    const nextParts = readyPartCards
                      .filter((card) => card.model.id === nextId)
                      .map((card) => card.part);
                    if (nextParts.length && !nextParts.includes(pieceType)) {
                      setPieceType(nextParts[0]);
                    }
                  }}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-teal-700 focus:outline-hidden"
                >
                  {readyModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      موديل {m.model_code} ({m.model_type || 'ملابس'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="block text-xs font-bold text-slate-600">
                    اسم المطبعة أو ورشة التطريز *
                  </label>
                  {selectedShopWorkshop &&
                    (selectedShopWorkshop.phone || selectedShopWorkshop.whatsapp_group_link) && (
                      <button
                        type="button"
                        onClick={() =>
                          openWhatsAppOrder(
                            selectedShopWorkshop.phone,
                            selectedShopWorkshop.whatsapp_group_link,
                            buildShopWhatsappMessage()
                          )
                        }
                        className="px-3 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold transition cursor-pointer"
                        title={
                          selectedShopWorkshop.whatsapp_group_link
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
                  value={shopSelection}
                  onChange={(e) => setShopSelection(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs bg-white focus:ring-2 focus:ring-teal-700 focus:outline-hidden"
                >
                  <option value="">— اختر المطبعة / ورشة التطريز —</option>
                  {printWorkshops.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                  <option value="__custom__">أخرى / كتابة يدوية</option>
                </select>
                {shopSelection === '__custom__' && (
                  <input
                    type="text"
                    required
                    value={customShopName}
                    onChange={(e) => setCustomShopName(e.target.value)}
                    placeholder="اكتب اسم المطبعة / الورشة يدوياً"
                    className="mt-2 w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-teal-700 focus:outline-hidden"
                  />
                )}
                {printWorkshops.length === 0 && (
                  <p className="mt-1.5 text-[11px] text-amber-600 font-bold">
                    لا توجد مطابع أو ورش تطريز مسجلة — أضفها من الإعدادات ← المقاسات والموردين والورش.
                  </p>
                )}
              </div>

              {/* نوع القطعة المرسلة (مقسمة حسب قطع الموديل) */}
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  نوع القطعة المرسلة *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {selectedModelParts.map((part) => {
                    const active = effectivePieceType === part;
                    return (
                      <button
                        key={part}
                        type="button"
                        onClick={() => setPieceType(part)}
                        className={`py-2 px-2 text-xs font-bold rounded-xl border transition cursor-pointer ${
                          active
                            ? 'bg-teal-700 text-white border-teal-700 shadow-sm'
                            : 'bg-white text-slate-700 border-slate-300 hover:border-teal-400'
                        }`}
                      >
                        {getPartLabel(part)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    مكان الطباعة (صدر / ظهر / كم / تطريز)
                  </label>
                  <input
                    type="text"
                    value={printLocation}
                    onChange={(e) => setPrintLocation(e.target.value)}
                    placeholder="مثال: صدر + ظهر، كم، تطريز شعار..."
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-teal-700 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    تفاصيل الطباعة
                  </label>
                  <input
                    type="text"
                    value={printDetails}
                    onChange={(e) => setPrintDetails(e.target.value)}
                    placeholder="مثال: طباعة شعار أمامي 3 ألوان..."
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-teal-700 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  عدد القطع المسلمة *
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={piecesCount}
                  onChange={(e) => setPiecesCount(parseInt(e.target.value) || 0)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs text-center font-bold focus:ring-2 focus:ring-teal-700 focus:outline-hidden"
                />
              </div>

              {/* سعر الطباعة للقطعة: يظهر فقط لمن يملك صلاحية تعديل أسعار المطابع */}
              {canEditPrintingPrices() && (
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    سعر الطباعة للقطعة (ج.م)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={printCost}
                    onChange={(e) => setPrintCost(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs text-center font-bold focus:ring-2 focus:ring-teal-700 focus:outline-hidden"
                  />
                </div>
              )}

              {/* Expected Delivery Date */}
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  تاريخ الاستلام المتوقع من المطبعة *
                </label>
                <input
                  type="date"
                  required
                  value={expectedDeliveryDate}
                  onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-mono font-bold focus:ring-2 focus:ring-teal-700 focus:outline-hidden"
                />
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  يُستخدم لحساب التنبيهات الذكية والإشعارات وقوائم المتأخرات تلقائياً.
                </span>
              </div>

              {/* Notes gated by permission */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-600">ملاحظات التشغيل (اختياري)</label>
                  {!allowPrintNotes && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                      <Lock className="w-3 h-3" />
                      <span>يتطلب صلاحية تسجيل ملاحظات المطابع</span>
                    </span>
                  )}
                </div>
                {allowPrintNotes ? (
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="مثال: يرجى تسليم العينة الأولى للاعتماد قبل إتمام الكمية..."
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-teal-700 focus:outline-hidden"
                  ></textarea>
                ) : (
                  <div className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-[11px] text-slate-400">
                    إدخال الملاحظات غير مفعل لحسابك حالياً.
                  </div>
                )}
              </div>

              </div>

              <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-full text-xs font-bold text-slate-600 hover:bg-slate-100"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isDispatchSubmitting}
                  className="px-6 py-2 rounded-full bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs shadow-md shadow-teal-700/20 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isDispatchSubmitting ? 'جاري الإرسال...' : 'تأكيد الإرسال للمطبعة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: تأكيد استلام تشغيلة من المطبعة (تسجيل تاريخ/وقت الاستلام فقط — العد وتقييم الورشة في الفرز) */}
      {receivingDispatch && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4"
          onClick={() => setReceivingDispatch(null)}
        >
          <div
            className="bg-white rounded-3xl w-[95vw] sm:w-full max-w-md shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-emerald-600 text-white flex items-center justify-center">
                  <Truck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-base leading-tight">
                    تسجيل استلام من المطبعة / التطريز
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {models.find((mm) => mm.id === receivingDispatch.model_id)?.model_code || 'موديل'} •{' '}
                    {receivingDispatch.shop_name} •{' '}
                    {receivingDispatch.piece_label ||
                      getPartLabel(receivingDispatch.piece_type || 'shirt')}
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

            <form onSubmit={confirmQuickReceive} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3">
                  <span className="block text-[10px] font-bold text-slate-500 mb-0.5">المطبعة / الورشة</span>
                  <span className="text-xs font-black text-slate-800 block truncate">
                    {receivingDispatch.shop_name}
                  </span>
                </div>
                <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3">
                  <span className="block text-[10px] font-bold text-slate-500 mb-0.5">العدد المرسل</span>
                  <span className="text-xs font-black text-slate-800">
                    {Number(receivingDispatch.pieces_count || 0).toLocaleString('ar-EG')} قطعة
                  </span>
                </div>
                <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3">
                  <span className="block text-[10px] font-bold text-slate-500 mb-0.5">تاريخ الخروج</span>
                  <span className="text-xs font-mono font-bold text-slate-700">
                    {receivingDispatch.dispatched_at || '—'}
                  </span>
                </div>
                <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3">
                  <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 mb-0.5">
                    <Clock className="w-3 h-3" />
                    وقت الاستلام الآن
                  </span>
                  <span className="text-xs font-mono font-black text-emerald-800">
                    {new Date().toLocaleString('ar-EG', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>
              </div>

              <div className="rounded-2xl bg-teal-50/70 border border-teal-200 px-3.5 py-2.5 text-[11px] font-semibold text-teal-900 leading-relaxed">
                سيتم تسجيل <strong>تاريخ ووقت الاستلام</strong> وتحويل القطعة مباشرة إلى <strong>العد بعد الطباعة (QC)</strong>، حيث يتم إدخال العد الفعلي وتقييم أداء المطبعة.
              </div>

              {allowPrintNotes && (
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    ملاحظات الاستلام (اختياري)
                  </label>
                  <textarea
                    rows={2}
                    value={receiveNotes}
                    onChange={(e) => setReceiveNotes(e.target.value)}
                    placeholder="أي ملاحظات سريعة عند الاستلام..."
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
                  ></textarea>
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
                  className="px-6 py-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20 cursor-pointer disabled:opacity-60"
                >
                  {isReceivingSubmitting ? 'جارٍ التسجيل...' : 'تأكيد الاستلام وتحويل للعد'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Print / Save PDF of the print-shop order */}
      {printTarget && (
        <PrintShopOrderModal dispatch={printTarget} onClose={() => setPrintTarget(null)} />
      )}

      {/* Modal: Workshop Evaluation */}
      <WorkshopEvaluationModal target={evalTarget} onClose={() => setEvalTarget(null)} />
    </div>
  );
};
