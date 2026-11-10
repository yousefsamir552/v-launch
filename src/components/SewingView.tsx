import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
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
  Lock
} from 'lucide-react';
import { Model, SewingDispatch, GarmentPart, PART_EMOJI, getPartLabel } from '../types';
import { SewingPrintModal } from './SewingPrintModal';

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
    logAction,
    globalSettings,
    canAddSewingNotes
  } = useApp();

  const [searchTerm, setSearchTerm] = useState('');
  // نافذة أمر التشغيل: الموديل + القطعة المطلوب معاينتها/طباعتها (both = الورقتين معاً)
  const [printTarget, setPrintTarget] = useState<{
    modelId: string;
    tab: 'both' | GarmentPart;
  } | null>(null);
  const [pieceFilter, setPieceFilter] = useState<'all' | GarmentPart>('all');

  // Modal State for Dispatching to Sewing Workshop
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [dispatchPieceType, setDispatchPieceType] = useState<GarmentPart>('shirt');
  const [dispatchPieceLabel, setDispatchPieceLabel] = useState<string>('تيشرت');
  const [workshopName, setWorkshopName] = useState('');
  const [piecesCount, setPiecesCount] = useState<number>(0);
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [dispatchNotes, setDispatchNotes] = useState('');

  // Modal State for Receiving from Sewing Workshop (with optional notes)
  const [receivingDispatch, setReceivingDispatch] = useState<SewingDispatch | null>(null);
  const [receiveNotes, setReceiveNotes] = useState('');

  const allowSewingNotes = canAddSewingNotes();

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

  const filteredDispatches = sewingDispatches.filter((disp) => {
    const m = models.find((mod) => mod.id === disp.model_id);
    const code = m?.model_code || '';
    const name = disp.workshop_name || '';
    const label = disp.piece_label || '';
    const q = searchTerm.toLowerCase();
    const matchesSearch = code.toLowerCase().includes(q) || name.toLowerCase().includes(q) || label.toLowerCase().includes(q);
    const matchesPiece = pieceFilter === 'all' || disp.piece_type === pieceFilter;
    return matchesSearch && matchesPiece;
  });

  const activeDispatches = filteredDispatches.filter(d => d.status !== 'تم الاستلام');

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
    setWorkshopName(prevWorkshop);

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

  const handleSubmitDispatch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedModelId || !workshopName.trim() || piecesCount <= 0 || !expectedDeliveryDate) {
      alert('يرجى ملء جميع الحقول المطلوبة وتحديد اسم الورشة وتاريخ الاستلام المتوقع');
      return;
    }

    dispatchModelToSewing({
      modelId: selectedModelId,
      workshopName: workshopName.trim(),
      piecesCount: piecesCount,
      expectedDeliveryDate: expectedDeliveryDate,
      pieceType: dispatchPieceType,
      pieceLabel: dispatchPieceLabel,
      notes: allowSewingNotes ? dispatchNotes.trim() : ''
    });

    setShowDispatchModal(false);
    setSelectedModelId('');
    setWorkshopName('');
    setPiecesCount(0);
    setExpectedDeliveryDate('');
    setDispatchNotes('');
  };

  const handleReceive = (dispatch: SewingDispatch) => {
    setReceivingDispatch(dispatch);
    setReceiveNotes('');
  };

  const confirmReceiveFromSewing = (e: React.FormEvent) => {
    e.preventDefault();
    if (!receivingDispatch) return;
    const m = models.find(mod => mod.id === receivingDispatch.model_id);
    const code = m?.model_code || 'الموديل';
    const label = receivingDispatch.piece_label || (receivingDispatch.piece_type === 'shirt' ? 'تيشرت' : 'بنطلون');
    const finalNotes = allowSewingNotes ? receiveNotes.trim() : '';

    receiveModelFromSewing(receivingDispatch.id, receivingDispatch.model_id, finalNotes || undefined);
    logAction(
      'قسم المكن',
      `استلام تشغيلة خياطة [${label}] موديل ${code} من ورشة ${receivingDispatch.workshop_name} (${receivingDispatch.pieces_count} قطعة)${finalNotes ? ` — ملاحظات: ${finalNotes}` : ''}`
    );
    setReceivingDispatch(null);
    setReceiveNotes('');
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
        <div className="flex items-center gap-2 w-full md:w-auto">
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
              {activeDispatches.reduce((acc, d) => acc + d.pieces_count, 0).toLocaleString('ar-EG')}
            </h3>
            <span className="text-[11px] text-slate-500 font-semibold mt-1 inline-block">قطعة قيد الخياطة</span>
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

      {/* SECTION 1: Ready Models - SPLIT INTO TWO DISTINCT ITEMS (SHIRT & PANTS) */}
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
          {readyPartCards.length > 0 ? (
            readyPartCards
              .filter((card) => pieceFilter === 'all' || card.part === pieceFilter)
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
                    <button
                      onClick={() => setPrintTarget({ modelId: item.model.id, tab: item.pieceType })}
                      className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition text-xs cursor-pointer flex items-center gap-1"
                      title="طباعة ورقة التشغيل الفردية لهذه القطعة"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span className="text-[10px] font-bold">طباعة الورقة</span>
                    </button>
                  </div>

                  {/* Thumbnail and Info */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-14 h-14 rounded-xl border border-white/30 bg-white p-1 shrink-0 overflow-hidden flex items-center justify-center">
                      <img
                        src={item.model.image}
                        alt={item.model.model_code}
                        className="w-full h-full object-contain"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src =
                            'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=100&auto=format&fit=crop&q=60';
                        }}
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

      {/* SECTION 2: Active Sewing Dispatches Table */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-emerald-700" />
            <h3 className="font-extrabold text-base text-slate-900">
              سجل تشغيلات وتسليمات ورش المكن والخياطة (معاينة مستقلة لكل قطعة)
            </h3>
          </div>
          <span className="text-xs text-slate-500 font-semibold">
            إجمالي التشغيلات المسجلة: {sewingDispatches.length}
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
                <th className="px-6 py-3.5 text-center">تاريخ الإرسال</th>
                <th className="px-6 py-3.5 text-center">تاريخ الاستلام المتوقع</th>
                <th className="px-6 py-3.5 text-center">الحالة والتنبيه</th>
                <th className="px-6 py-3.5 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredDispatches.length > 0 ? (
                filteredDispatches.map((disp) => {
                  const m = models.find((model) => model.id === disp.model_id);
                  const isShirt = disp.piece_type === 'shirt';

                  return (
                    <tr key={disp.id} className="hover:bg-slate-50/80 transition">
                      <td className="px-6 py-4 font-bold text-slate-900">
                        <div className="flex items-center gap-3">
                          {m && (
                            <div className="w-12 h-12 rounded-xl bg-white border border-slate-200 p-1 shrink-0 flex items-center justify-center overflow-hidden">
                              <img
                                src={m.image}
                                alt={m.model_code}
                                className="w-full h-full object-contain"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src =
                                    'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=100&auto=format&fit=crop&q=60';
                                }}
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
                            isShirt ? 'bg-blue-100 text-blue-800 border border-blue-200' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          }`}
                        >
                          {disp.piece_label || (isShirt ? 'تيشرت' : 'بنطلون')}
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
                        {disp.pieces_count.toLocaleString('ar-EG')} ق
                      </td>

                      <td className="px-6 py-4 text-center text-slate-500 font-mono text-[11px]">
                        {disp.dispatched_at}
                      </td>

                      <td className="px-6 py-4 text-center font-mono font-bold text-slate-800">
                        {disp.expected_delivery_date || 'غير محدد'}
                      </td>

                      <td className="px-6 py-4 text-center">
                        {getDateStatusBadge(disp.expected_delivery_date, disp.status)}
                      </td>

                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {disp.status !== 'تم الاستلام' ? (
                            <button
                              onClick={() => handleReceive(disp)}
                              className="px-3 py-1.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs shadow-xs transition flex items-center gap-1 cursor-pointer"
                              title="تسجيل استلام القطع وتوجيهها للعد بعد المكن"
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
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-slate-400">
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
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95">
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
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  اسم ورشة المكن / الخياطة *
                </label>
                <input
                  type="text"
                  required
                  placeholder="مثال: ورشة الأمل، ورشة النور، خط إنتاج 2..."
                  value={workshopName}
                  onChange={(e) => setWorkshopName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-bold focus:ring-2 focus:ring-emerald-700 focus:outline-hidden"
                />
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
                  className="px-6 py-2 rounded-full bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-md shadow-emerald-700/20 cursor-pointer"
                >
                  تأكيد الإرسال للورشة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RECEIVE FROM SEWING MODAL (WITH OPTIONAL NOTES) */}
      {receivingDispatch && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-purple-600 text-white flex items-center justify-center">
                  <CheckCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-base">
                    تأكيد استلام تشغيلة من ورشة المكن
                  </h3>
                  <p className="text-xs text-slate-500">
                    ورشة: {receivingDispatch.workshop_name} • ({receivingDispatch.pieces_count} قطعة)
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
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-600">
                    ملاحظات استلام المكن (اختياري)
                  </label>
                  {!allowSewingNotes && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                      <Lock className="w-3 h-3" />
                      <span>يتطلب صلاحية ملاحظات المكن</span>
                    </span>
                  )}
                </div>
                {allowSewingNotes ? (
                  <textarea
                    rows={3}
                    value={receiveNotes}
                    onChange={(e) => setReceiveNotes(e.target.value)}
                    placeholder="سجل أي ملاحظات عند الاستلام من الورشة (جودة التشطيب، نقص أو استكمال، ملاحظات للفرز)..."
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-purple-600 focus:outline-hidden"
                  />
                ) : (
                  <div className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-[11px] text-slate-400">
                    لا تملك صلاحية كتابة ملاحظات قسم المكن — يمكنك تأكيد الاستلام مباشرة.
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReceivingDispatch(null)}
                  className="px-4 py-2 rounded-full text-xs font-bold text-slate-600 hover:bg-slate-100"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 rounded-full bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs shadow-md shadow-purple-700/20 cursor-pointer"
                >
                  تأكيد الاستلام وتحويل للفرز
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
    </div>
  );
};
