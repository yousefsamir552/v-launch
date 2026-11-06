import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  ArrowRight,
  Scissors,
  Trash2,
  Palette,
  Save,
  Plus,
  Shirt,
  Sparkles,
  Layers,
  FileText,
  Lock
} from 'lucide-react';

interface ModelDetailsViewProps {
  modelId: string;
  onBack: () => void;
  onGoToCutting: (modelId: string) => void;
}

export const ModelDetailsView: React.FC<ModelDetailsViewProps> = ({
  modelId,
  onBack,
  onGoToCutting
}) => {
  const {
    models,
    fabrics,
    fabricColors,
    requirements,
    accessories,
    accessoryItems,
    addModelRequirement,
    deleteModelRequirement,
    addModelAccessory,
    deleteModelAccessory,
    updateModelPlan,
    updateModelNotesAndTarget,
    issueFabricToCutting,
    deleteDesignModel,
    hasPermission,
    canAddDesignNotes
  } = useApp();

  const canEdit = hasPermission('design', true);
  const canWriteNotes = canAddDesignNotes();
  const model = models.find((m) => m.id === modelId && !m.is_deleted);

  const modelReqs = requirements.filter((r) => r.model_id === modelId);
  const modelAccs = accessories.filter((a) => a.model_id === modelId);

  const [targetCutQuantity, setTargetCutQuantity] = useState<number>(model?.target_cut_quantity || 500);

  // Local Form state for Section 1 (Add Color & Add Accessory)
  const [selectedColorId, setSelectedColorId] = useState('');
  const [partName, setPartName] = useState('');

  // Accessory addition form with target_type & piece_consumption
  const [selectedAccessoryId, setSelectedAccessoryId] = useState('');
  const [accTargetType, setAccTargetType] = useState<'shirt' | 'pants'>('shirt');
  const [accPieceConsumption, setAccPieceConsumption] = useState<number>(1);

  // Local Form state for Section 2 (Planning quantities, markers, notes)
  const [reqQuantities, setReqQuantities] = useState<Record<string, number>>({});
  const [accQuantities, setAccQuantities] = useState<Record<string, number>>({});
  const [mainMarkerUrl, setMainMarkerUrl] = useState('');
  const [printMarkerUrl, setPrintMarkerUrl] = useState('');
  const [designNotes, setDesignNotes] = useState('');
  const [notesShirt, setNotesShirt] = useState('');
  const [notesPants, setNotesPants] = useState('');

  useEffect(() => {
    if (model) {
      setTargetCutQuantity(model.target_cut_quantity || 500);
      setMainMarkerUrl(model.main_marker_url || '');
      setPrintMarkerUrl(model.print_marker_url || '');
      setDesignNotes(model.design_notes || '');
      setNotesShirt(model.notes_shirt || '');
      setNotesPants(model.notes_pants || '');
    }
  }, [model]);

  useEffect(() => {
    const rMap: Record<string, number> = {};
    modelReqs.forEach((r) => {
      rMap[r.id] = r.planned_quantity;
    });
    setReqQuantities(rMap);

    const aMap: Record<string, number> = {};
    modelAccs.forEach((a) => {
      aMap[a.id] = a.planned_quantity ?? 0;
    });
    setAccQuantities(aMap);
  }, [modelId, requirements.length, accessories.length]);

  if (!model) {
    return (
      <div className="bg-white rounded-3xl p-8 text-center text-slate-500 border border-slate-200">
        <p className="font-bold text-lg text-slate-700">الموديل غير موجود أو تم حذفه</p>
        <button
          onClick={onBack}
          className="mt-4 px-6 py-2 rounded-full bg-slate-900 text-white font-bold text-xs"
        >
          العودة لقائمة الموديلات
        </button>
      </div>
    );
  }

  const handleUpdateTargetCut = (newQty: number) => {
    setTargetCutQuantity(newQty);
    updateModelNotesAndTarget(modelId, { target_cut_quantity: newQty });
  };

  const handleAddColorSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedColorId || !partName.trim()) return;
    addModelRequirement(modelId, selectedColorId, partName.trim());
    setPartName('');
    setSelectedColorId('');
  };

  const handleAddAccessorySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccessoryId) return;
    const targetItem = accessoryItems.find((a) => a.id === selectedAccessoryId);
    if (!targetItem) return;

    const plannedTotal = Math.round(Number(accPieceConsumption) * (Number(targetCutQuantity) || 100));

    addModelAccessory(modelId, {
      id: targetItem.id,
      code: targetItem.code,
      name: targetItem.name,
      unit: targetItem.unit,
      image: targetItem.image,
      target_type: accTargetType,
      piece_consumption: Number(accPieceConsumption) || 1,
      planned_quantity: plannedTotal
    });
    setSelectedAccessoryId('');
  };

  const handleSavePlan = (e: React.FormEvent) => {
    e.preventDefault();
    updateModelPlan({
      modelId,
      reqQuantities,
      accQuantities,
      mainMarkerUrl,
      printMarkerUrl,
      designNotes,
      notesShirt,
      notesPants,
      targetCutQuantity
    });
  };

  const handleIssueFabric = () => {
    const totalPlanned = modelReqs.reduce((sum, r) => sum + (reqQuantities[r.id] ?? r.planned_quantity), 0);
    if (totalPlanned <= 0) {
      alert('يجب تخطيط وحجز كميات للأقمشة أولاً قبل الصرف للقص!');
      return;
    }
    if (window.confirm('هل أنت متأكد من صرف القماش وتحويل الموديل للقص نهائياً؟')) {
      const res = issueFabricToCutting(modelId);
      if (res.success) {
        onGoToCutting(modelId);
      }
    }
  };

  const handleDelete = () => {
    if (window.confirm('هل أنت متأكد من حذف هذا الموديل؟ سيتم إخفاؤه من النظام وتحرير الأقمشة المحجوزة.')) {
      deleteDesignModel(modelId);
      onBack();
    }
  };

  const shirtAccessories = modelAccs.filter((a) => a.target_type !== 'pants');
  const pantsAccessories = modelAccs.filter((a) => a.target_type === 'pants');

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Return Link */}
      <div>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-extrabold text-blue-600 hover:text-blue-800 transition cursor-pointer"
        >
          <ArrowRight className="w-4 h-4" />
          <span>← العودة لقسم التصميم</span>
        </button>
      </div>

      {/* TOP HEADER CARD */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs flex flex-col md:flex-row items-start gap-6">
        <div className="w-40 h-40 rounded-2xl overflow-hidden bg-slate-100 shrink-0 border border-slate-200 shadow-xs">
          <img
            src={model.image}
            alt={model.model_code}
            className="w-full h-full object-contain bg-white"
            onError={(e) => {
              (e.target as HTMLImageElement).src =
                'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500&auto=format&fit=crop&q=60';
            }}
          />
        </div>

        <div className="flex-grow space-y-4 w-full">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                  موديل: {model.model_code}
                </h1>
                <span className="inline-block px-3 py-1 rounded-full text-xs font-black bg-amber-100 text-amber-900 border border-amber-300">
                  {model.status}
                </span>
              </div>
              <p className="text-slate-500 text-xs sm:text-sm mt-1">
                النوع: <strong className="text-slate-800">{model.model_type || 'أولادي'}</strong> | تاريخ الإنشاء: {new Date(model.created_at).toLocaleDateString('ar-EG')}
              </p>
            </div>

            {/* TARGET CUTTING QUANTITY */}
            <div className="p-3.5 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-2xl flex items-center gap-3 shadow-xs">
              <div className="p-2 bg-blue-600 text-white rounded-xl shadow-xs">
                <Scissors className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[11px] font-bold text-blue-900 block">العدد المستهدف للقص:</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <input
                    type="number"
                    min="1"
                    disabled={!canEdit}
                    value={targetCutQuantity}
                    onChange={(e) => handleUpdateTargetCut(parseInt(e.target.value) || 0)}
                    className="w-24 px-2 py-1 text-base font-black text-blue-950 bg-white border border-blue-300 rounded-lg text-center focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-xs font-black text-blue-800">قطعة</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-slate-100">
            {canEdit && (
              <button
                onClick={handleIssueFabric}
                className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20 transition cursor-pointer"
              >
                <Scissors className="w-4 h-4" />
                <span>✂️ صرف القماش والإكسسوارات وبدء القص</span>
              </button>
            )}

            {canEdit && (
              <button
                onClick={handleDelete}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-full border border-rose-300 text-rose-700 hover:bg-rose-50 font-bold text-xs shadow-xs transition cursor-pointer ms-auto"
              >
                <Trash2 className="w-4 h-4" />
                <span>حذف الموديل</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Color & Accessory Pickers */}
        <div className="lg:col-span-5 space-y-6">
          {/* Card 1: Add Fabric Color to Model */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-4">
            <h3 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
              <Palette className="w-4 h-4 text-amber-600" />
              <span>تخصيص ألوان وخامات الموديل:</span>
            </h3>

            <form onSubmit={handleAddColorSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">اللون والخامة من المخزن</label>
                <select
                  disabled={!canEdit}
                  value={selectedColorId}
                  onChange={(e) => setSelectedColorId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden"
                >
                  <option value="">-- اختر لون قماش --</option>
                  {fabricColors.map((col) => {
                    const fab = fabrics.find((f) => f.id === col.fabric_id);
                    const avail = Number((col.quantity - col.reserved_quantity).toFixed(1));
                    return (
                      <option key={col.id} value={col.id}>
                        {fab?.name} - {col.color_code} ({col.color_name || 'لون'}) [متاح: {avail} {fab?.unit}]
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">اسم القطعة أو الجزء</label>
                <input
                  type="text"
                  disabled={!canEdit}
                  placeholder="مثال: الصدر والظهر، كابيشو، أساور..."
                  value={partName}
                  onChange={(e) => setPartName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden"
                />
              </div>

              {canEdit && (
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>إضافة خامة اللون للموديل</span>
                </button>
              )}
            </form>
          </div>

          {/* Card 2: Add Accessory to Model */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-4">
            <h3 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-pink-600" />
              <span>تخصيص الإكسسوارات (تيشرت / بنطلون):</span>
            </h3>

            <form onSubmit={handleAddAccessorySubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">قسم الإكسسوار (تيشرت أو بنطلون) *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAccTargetType('shirt')}
                    className={`py-2 px-3 text-xs font-bold rounded-xl border transition flex items-center justify-center gap-1.5 ${
                      accTargetType === 'shirt'
                        ? 'bg-blue-50 border-blue-400 text-blue-900 shadow-2xs'
                        : 'bg-white border-slate-200 text-slate-600'
                    }`}
                  >
                    <Shirt className="w-3.5 h-3.5 text-blue-600" />
                    <span>إكسسوار تيشرت</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccTargetType('pants')}
                    className={`py-2 px-3 text-xs font-bold rounded-xl border transition flex items-center justify-center gap-1.5 ${
                      accTargetType === 'pants'
                        ? 'bg-amber-50 border-amber-400 text-amber-900 shadow-2xs'
                        : 'bg-white border-slate-200 text-slate-600'
                    }`}
                  >
                    <span>👖 إكسسوار بنطلون</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">اختر الصنف من مخزن الإكسسوارات *</label>
                <select
                  disabled={!canEdit}
                  value={selectedAccessoryId}
                  onChange={(e) => setSelectedAccessoryId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden"
                >
                  <option value="">-- اختر إكسسوار --</option>
                  {accessoryItems.map((acc) => {
                    const avail = acc.quantity - acc.reserved_quantity;
                    return (
                      <option key={acc.id} value={acc.id}>
                        {acc.code} - {acc.name} ({acc.type_name}) [متاح: {avail} {acc.unit}]
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  استهلاك القطعة الواحدة (Piece Consumption) *
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    disabled={!canEdit}
                    value={accPieceConsumption}
                    onChange={(e) => setAccPieceConsumption(parseFloat(e.target.value) || 1)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 font-bold focus:outline-hidden"
                  />
                  <span className="text-[11px] text-slate-500 shrink-0">لكل قطعة</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  المطلوب التلقائي = {accPieceConsumption} × {targetCutQuantity} (الهدف) ={' '}
                  <strong className="text-slate-700">
                    {Math.round(accPieceConsumption * targetCutQuantity)}
                  </strong>
                </p>
              </div>

              {canEdit && (
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-pink-600 hover:bg-pink-700 text-white font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>إضافة الإكسسوار لـ {accTargetType === 'shirt' ? 'التيشرت' : 'البنطلون'}</span>
                </button>
              )}
            </form>
          </div>
        </div>

        {/* Right Column: Requirements, Separated Accessories, Markers & Notes */}
        <div className="lg:col-span-7 space-y-6">
          <form onSubmit={handleSavePlan} className="space-y-6">
            {/* Fabric Requirements Table */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b pb-2">
                <h3 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-blue-600" />
                  <span>خطة أوزان الأقمشة المطلوبة للتشغيلة:</span>
                </h3>
                <span className="text-xs text-slate-400">إجمالي الأجزاء: {modelReqs.length}</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-start">
                  <thead className="bg-slate-50 text-slate-600 font-bold">
                    <tr>
                      <th className="p-2">القطعة</th>
                      <th className="p-2">الخامة واللون</th>
                      <th className="p-2 text-center">المتاح بالمخزن</th>
                      <th className="p-2 text-center">الكمية المخططة (كجم)</th>
                      <th className="p-2 text-center">حذف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {modelReqs.length > 0 ? (
                      modelReqs.map((req) => {
                        const color = fabricColors.find((c) => c.id === req.color_id);
                        const fab = fabrics.find((f) => f.id === color?.fabric_id);
                        const avail = color ? Number((color.quantity - color.reserved_quantity).toFixed(1)) : 0;
                        const planned = reqQuantities[req.id] ?? req.planned_quantity;

                        return (
                          <tr key={req.id}>
                            <td className="p-2 font-bold text-slate-900">{req.part_name}</td>
                            <td className="p-2 text-slate-600">
                              {fab?.name} ({color?.color_code})
                            </td>
                            <td className="p-2 text-center text-emerald-700 font-bold">
                              {avail} {fab?.unit || 'كجم'}
                            </td>
                            <td className="p-2 text-center">
                              <input
                                type="number"
                                min="0"
                                step="any"
                                disabled={!canEdit}
                                value={planned}
                                onChange={(e) =>
                                  setReqQuantities({
                                    ...reqQuantities,
                                    [req.id]: parseFloat(e.target.value) || 0
                                  })
                                }
                                className="w-20 px-2 py-1 text-center font-bold text-xs border rounded-lg"
                              />
                            </td>
                            <td className="p-2 text-center">
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() => deleteModelRequirement(req.id)}
                                  className="text-rose-500 hover:text-rose-700"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={5} className="text-center py-4 text-slate-400">
                          لم يتم تخصيص خامات بعد لهذا الموديل.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* SEPARATED ACCESSORIES SECTION: Shirt vs Pants */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-5">
              <div className="flex items-center justify-between border-b pb-2">
                <h3 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-pink-600" />
                  <span>قائمة إكسسوارات التشغيل (مقسمة تيشرت / بنطلون):</span>
                </h3>
              </div>

              {/* Subsection 1: T-Shirt Accessories */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-black text-blue-900 bg-blue-50/70 p-2 rounded-xl border border-blue-200">
                  <Shirt className="w-4 h-4 text-blue-600" />
                  <span>إكسسوارات ومستلزمات التيشرت ({shirtAccessories.length}):</span>
                </div>

                <div className="overflow-x-auto border rounded-2xl">
                  <table className="w-full text-xs text-start">
                    <thead className="bg-slate-50 text-slate-600 font-bold">
                      <tr>
                        <th className="p-2">الإكسسوار</th>
                        <th className="p-2 text-center">استهلاك القطعة</th>
                        <th className="p-2 text-center">الكمية الإجمالية المطلوبة</th>
                        <th className="p-2 text-center">الوحدة</th>
                        <th className="p-2 text-center">إجراء</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {shirtAccessories.length > 0 ? (
                        shirtAccessories.map((acc) => (
                          <tr key={acc.id}>
                            <td className="p-2 font-bold text-slate-900">{acc.accessory_name}</td>
                            <td className="p-2 text-center font-bold text-blue-700">{acc.piece_consumption || 1}</td>
                            <td className="p-2 text-center">
                              <input
                                type="number"
                                min="0"
                                disabled={!canEdit}
                                value={accQuantities[acc.id] ?? acc.planned_quantity}
                                onChange={(e) =>
                                  setAccQuantities({
                                    ...accQuantities,
                                    [acc.id]: parseFloat(e.target.value) || 0
                                  })
                                }
                                className="w-20 px-2 py-1 text-center font-black text-xs border rounded-lg"
                              />
                            </td>
                            <td className="p-2 text-center text-slate-500">{acc.unit || 'قطعة'}</td>
                            <td className="p-2 text-center">
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() => deleteModelAccessory(acc.id)}
                                  className="text-rose-500 hover:text-rose-700"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="text-center py-3 text-slate-400">
                            لا توجد إكسسوارات محددة للتيشرت بعد.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Subsection 2: Pants Accessories */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-black text-amber-950 bg-amber-50/70 p-2 rounded-xl border border-amber-200">
                  <span>👖 إكسسوارات ومستلزمات البنطلون ({pantsAccessories.length}):</span>
                </div>

                <div className="overflow-x-auto border rounded-2xl">
                  <table className="w-full text-xs text-start">
                    <thead className="bg-slate-50 text-slate-600 font-bold">
                      <tr>
                        <th className="p-2">الإكسسوار</th>
                        <th className="p-2 text-center">استهلاك القطعة</th>
                        <th className="p-2 text-center">الكمية الإجمالية المطلوبة</th>
                        <th className="p-2 text-center">الوحدة</th>
                        <th className="p-2 text-center">إجراء</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pantsAccessories.length > 0 ? (
                        pantsAccessories.map((acc) => (
                          <tr key={acc.id}>
                            <td className="p-2 font-bold text-slate-900">{acc.accessory_name}</td>
                            <td className="p-2 text-center font-bold text-amber-700">{acc.piece_consumption || 1}</td>
                            <td className="p-2 text-center">
                              <input
                                type="number"
                                min="0"
                                disabled={!canEdit}
                                value={accQuantities[acc.id] ?? acc.planned_quantity}
                                onChange={(e) =>
                                  setAccQuantities({
                                    ...accQuantities,
                                    [acc.id]: parseFloat(e.target.value) || 0
                                  })
                                }
                                className="w-20 px-2 py-1 text-center font-black text-xs border rounded-lg"
                              />
                            </td>
                            <td className="p-2 text-center text-slate-500">{acc.unit || 'قطعة'}</td>
                            <td className="p-2 text-center">
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() => deleteModelAccessory(acc.id)}
                                  className="text-rose-500 hover:text-rose-700"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="text-center py-3 text-slate-400">
                            لا توجد إكسسوارات محددة للبنطلون بعد.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* DESIGN & OPERATING NOTES (Gated by canAddDesignNotes permission - Task 4) */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b pb-2">
                <h3 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-amber-600" />
                  <span>📝 ملاحظات التصميم والتشغيل والقص (اختياري):</span>
                </h3>
                {!canWriteNotes && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                    <Lock className="w-3 h-3" />
                    يتطلب صلاحية تسجيل ملاحظات التصميم
                  </span>
                )}
              </div>

              {/* General Design Notes */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-800">
                  ملاحظات التصميم العامة (اختياري):
                </label>
                <textarea
                  rows={2}
                  disabled={!canWriteNotes}
                  value={designNotes}
                  onChange={(e) => setDesignNotes(e.target.value)}
                  placeholder={
                    canWriteNotes
                      ? 'أي ملاحظات عامة خاصة بتصميم الموديل أو الباترون...'
                      : 'ليس لديك صلاحية كتابة ملاحظات التصميم'
                  }
                  className="w-full p-3 rounded-2xl border border-slate-300 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-hidden disabled:bg-slate-100 disabled:text-slate-400"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Shirt Notes */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-blue-900 flex items-center gap-1.5">
                    <Shirt className="w-3.5 h-3.5 text-blue-600" />
                    <span>ملاحظات تشغيل وقص التيشرت (اختياري):</span>
                  </label>
                  <textarea
                    rows={3}
                    disabled={!canWriteNotes}
                    value={notesShirt}
                    onChange={(e) => setNotesShirt(e.target.value)}
                    placeholder="تعليمات خاصة بياقة التيشرت، التيكت، تركيب البادج، السوستة، أو التطريز..."
                    className="w-full p-3 rounded-2xl border border-slate-300 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-hidden disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </div>

                {/* Pants Notes */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-amber-950 flex items-center gap-1.5">
                    <span>👖 ملاحظات تشغيل وقص البنطلون (اختياري):</span>
                  </label>
                  <textarea
                    rows={3}
                    disabled={!canWriteNotes}
                    value={notesPants}
                    onChange={(e) => setNotesPants(e.target.value)}
                    placeholder="تعليمات خاصة بكمر البنطلون، الجيوب، الأساور المطاطية، الاستيك، أو الحليات..."
                    className="w-full p-3 rounded-2xl border border-slate-300 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-hidden disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </div>
              </div>

              {/* Marker Codes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">الماركر الأساسي للقص</label>
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={mainMarkerUrl}
                    onChange={(e) => setMainMarkerUrl(e.target.value)}
                    placeholder="كود أو رابط الماركر الأساسي"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">ماركر الطباعة والتطريز</label>
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={printMarkerUrl}
                    onChange={(e) => setPrintMarkerUrl(e.target.value)}
                    placeholder="كود أو ملف ماركر الطباعة"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  />
                </div>
              </div>
            </div>

            {(canEdit || canWriteNotes) && (
              <button
                type="submit"
                className="w-full py-3.5 rounded-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition shadow-lg flex items-center justify-center gap-2 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>حفظ التعديلات وخطة التشغيل والملاحظات</span>
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
};
