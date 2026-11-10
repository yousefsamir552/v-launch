import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Printer,
  Plus,
  Truck,
  CheckCircle2,
  Layers,
  X,
  Lock
} from 'lucide-react';
import { DispatchStatus, GarmentPart, PART_EMOJI, getPartLabel } from '../types';

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
    hasPermission,
    canViewPrintingCosts,
    canEditPrintingCosts,
    canAddPrintingNotes,
    canAddQCBeforePrintNotes
  } = useApp();

  const canEdit = hasPermission('printing', true) || hasPermission('qc', true) || hasPermission('cutting', true);
  const allowPrintNotes = canAddPrintingNotes() || canAddQCBeforePrintNotes();

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

  const [showModal, setShowModal] = useState(false);
  const [modelId, setModelId] = useState(readyModels[0]?.id || '');
  const [shopName, setShopName] = useState('');
  const [piecesCount, setPiecesCount] = useState<number>(100);
  const [printType, setPrintType] = useState('سلك سكرين مائي');
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
  const [costPerPiece, setCostPerPiece] = useState<number>(4.5);
  const [notes, setNotes] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!modelId || !shopName.trim()) return;

    addPrintDispatch({
      modelId,
      shopName: shopName.trim(),
      piecesCount: Number(piecesCount) || 0,
      printType: printType.trim(),
      pieceType: effectivePieceType,
      pieceLabel: getPartLabel(effectivePieceType),
      printLocation: printLocation.trim(),
      printDetails: printDetails.trim(),
      expectedDeliveryDate,
      costPerPiece: canEditPrintingCosts() ? Number(costPerPiece) : undefined,
      notes: allowPrintNotes ? notes.trim() : ''
    });

    setShowModal(false);
    setShopName('');
    setNotes('');
    setPrintDetails('');
  };

  const getStatusBadge = (status: DispatchStatus) => {
    switch (status) {
      case 'مرسل للمطبعة':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'قيد التنفيذ':
        return 'bg-blue-100 text-blue-800 border-blue-300';
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

        {canEdit && readyModels.length > 0 && (
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

      {/* Ready Parts — every garment part is its own card */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs">
        <h3 className="font-extrabold text-slate-900 text-sm mb-4 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-teal-600" />
            <span>القطع الجاهزة للإرسال للمطابع والتطريز ({readyPartCards.length}):</span>
          </span>
          <span className="text-[11px] text-slate-400 font-normal">
            (كل قطعة تُرسل وتُستلم وتُتخطى بشكل مستقل)
          </span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {readyPartCards.length > 0 ? (
            readyPartCards.map(({ model: m, part }) => {
              const partQcRecords = qcRecords.filter(
                (q) => q.model_id === m.id && (q.part_type || 'shirt') === part
              );
              const partGoodQty =
                m.qc_summary?.[part] ??
                partQcRecords.reduce(
                  (sum, q) => sum + (q.good_qty ?? q.counted_pieces ?? 0),
                  0
                );

              return (
                <div
                  key={`${m.id}-${part}`}
                  className="p-4 rounded-2xl border border-teal-200 bg-teal-50/40 hover:bg-teal-50 transition flex flex-col gap-3 shadow-2xs"
                >
                  <div className="flex items-center gap-3">
                    <img
                      src={m.image}
                      alt={m.model_code}
                      className="w-12 h-12 rounded-xl object-contain bg-white border shrink-0 p-0.5"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src =
                          'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=100&auto=format&fit=crop&q=60';
                      }}
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

      {/* Dispatches Tracking Table */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-teal-700" />
            <h3 className="font-extrabold text-base text-slate-900">
              سجل تشغيلات وتسليمات المطابع والتطريز
            </h3>
          </div>
          <span className="text-xs text-slate-500 font-semibold">
            إجمالي التشغيلات: {printDispatches.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
              <tr>
                <th className="px-6 py-3.5">كود الموديل</th>
                <th className="px-6 py-3.5">المطبعة / ورشة التطريز</th>
                <th className="px-6 py-3.5 text-center">القطع المسلمة</th>
                <th className="px-6 py-3.5 text-center">نوع القطعة</th>
                <th className="px-6 py-3.5">نوع الطباعة / التشغيل</th>
                {canViewPrintingCosts() && (
                  <>
                    <th className="px-6 py-3.5 text-center">تكلفة القطعة</th>
                    <th className="px-6 py-3.5 text-center">الإجمالي</th>
                  </>
                )}
                <th className="px-6 py-3.5 text-center">تاريخ الإرسال</th>
                <th className="px-6 py-3.5 text-center">الاستلام المتوقع</th>
                <th className="px-6 py-3.5 text-center">الحالة</th>
                <th className="px-6 py-3.5 text-center">الإجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {printDispatches.length > 0 ? (
                printDispatches.map((disp) => {
                  const m = models.find((model) => model.id === disp.model_id);

                  return (
                    <tr key={disp.id} className="hover:bg-slate-50 transition">
                      <td className="px-6 py-4 font-bold text-slate-900 flex items-center gap-2">
                        {m && (
                          <img
                            src={m.image}
                            alt={m.model_code}
                            className="w-9 h-9 rounded-lg object-contain bg-white border p-0.5"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src =
                                'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=100&auto=format&fit=crop&q=60';
                            }}
                          />
                        )}
                        <span>{m?.model_code || 'موديل'}</span>
                      </td>
                      <td className="px-6 py-4 font-bold text-slate-800">{disp.shop_name}</td>
                      <td className="px-6 py-4 text-center font-black text-slate-900 text-sm">
                        {disp.pieces_count}
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
                      {canViewPrintingCosts() && (
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
                        {disp.status !== 'تم الاستلام بالمصنع' && canEdit ? (
                          <button
                            onClick={() => updateDispatchStatus(disp.id, 'تم الاستلام بالمصنع')}
                            className="px-3.5 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition shadow-xs cursor-pointer"
                            title="استلام من المطبعة وتحويل تلقائي للعد بعد الطباعة"
                          >
                            استلام بالمصنع 📥
                          </button>
                        ) : (
                          <span className="text-emerald-700 font-bold text-xs flex items-center justify-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>مستلم بالفرز</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={canViewPrintingCosts() ? 10 : 8} className="text-center py-8 text-slate-400">
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
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
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
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  اسم المطبعة أو ورشة التطريز *
                </label>
                <input
                  type="text"
                  required
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  placeholder="مثال: مطبعة النجوم الحديثة، ورشة الهدى للتطريز..."
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-teal-700 focus:outline-hidden"
                />
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

              <div className="grid grid-cols-2 gap-3">
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

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">نوع التشغيل</label>
                  <select
                    value={printType}
                    onChange={(e) => setPrintType(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-teal-700 focus:outline-hidden"
                  >
                    <option value="سلك سكرين مائي">سلك سكرين مائي</option>
                    <option value="بلاستيزول حراري">بلاستيزول حراري</option>
                    <option value="تطريز كمبيوتر بارز">تطريز كمبيوتر بارز</option>
                    <option value="ديجيتال DTF">ديجيتال DTF</option>
                    <option value="فينيل كبس">فينيل كبس</option>
                  </select>
                </div>
              </div>

              {/* Printing Cost Input (Restricted by Permission) */}
              {canEditPrintingCosts() && (
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    تكلفة تشغيل القطعة بالمطبعة (ج.م)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={costPerPiece}
                    onChange={(e) => setCostPerPiece(parseFloat(e.target.value) || 0)}
                    className="w-full px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-900"
                  />
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    إجمالي التكلفة المتوقعة: {(costPerPiece * piecesCount).toLocaleString('ar-EG')} ج.م
                  </span>
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
                  className="px-6 py-2 rounded-full bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs shadow-md shadow-teal-700/20"
                >
                  تأكيد الإرسال للمطبعة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
