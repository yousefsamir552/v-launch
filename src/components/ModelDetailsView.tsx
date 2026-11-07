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
  Lock,
  Star,
  CheckSquare,
  Square
} from 'lucide-react';
import { AccessoryItem } from '../types';

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
    globalSettings,
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

  const [targetCutQuantity, setTargetCutQuantity] = useState<number>(
    model?.target_cut_quantity || 500
  );

  // Local Form state for Section 1 (Add Color & Add Accessory)
  const [selectedColorId, setSelectedColorId] = useState('');
  const [partName, setPartName] = useState('');
  const [partPlannedQty, setPartPlannedQty] = useState<string>('10');

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
  }, [modelId, requirements, accessories]);

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

  // General Tools / Favorite Accessories saved in Settings (Task 2.1)
  const favoriteIds = globalSettings?.favorite_accessory_ids || [];
  const generalToolItems = accessoryItems.filter((item) => favoriteIds.includes(item.id));

  const handleToggleGeneralTool = (
    toolItem: AccessoryItem,
    targetType: 'shirt' | 'pants' = accTargetType
  ) => {
    if (!canEdit) return;
    // Check if this tool is already added to this model for the selected targetType (or any targetType)
    const existingEntry = modelAccs.find(
      (a) =>
        (a.accessory_id === toolItem.id || a.accessory_code === toolItem.code) &&
        a.target_type === targetType
    );

    if (existingEntry) {
      deleteModelAccessory(existingEntry.id);
    } else {
      const consumption = Number(accPieceConsumption) || 1;
      const plannedTotal = Math.round(consumption * (Number(targetCutQuantity) || 100));
      addModelAccessory(modelId, {
        id: toolItem.id,
        code: toolItem.code,
        name: toolItem.name,
        unit: toolItem.unit,
        image: toolItem.image,
        target_type: targetType,
        piece_consumption: consumption,
        planned_quantity: plannedTotal
      });
    }
  };

  const handleUpdateTargetCut = (newQty: number) => {
    setTargetCutQuantity(newQty);
    updateModelNotesAndTarget(modelId, { target_cut_quantity: newQty });
  };

  const handleAddColorSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedColorId || !partName.trim()) return;
    const qtyNum = Math.max(0, parseFloat(partPlannedQty) || 0);
    const res = addModelRequirement(modelId, selectedColorId, partName.trim(), qtyNum);
    if (res.success) {
      setPartName('');
      setSelectedColorId('');
      setPartPlannedQty('10');
    }
  };

  const handleAddAccessorySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccessoryId) return;
    const targetItem = accessoryItems.find((a) => a.id === selectedAccessoryId);
    if (!targetItem) return;

    const plannedTotal = Math.round(
      Number(accPieceConsumption) * (Number(targetCutQuantity) || 100)
    );

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
    const totalPlanned = modelReqs.reduce(
      (sum, r) => sum + (reqQuantities[r.id] ?? r.planned_quantity),
      0
    );
    if (totalPlanned <= 0) {
      alert('يجب تخطيط وحجز كميات للأقمشة أولاً قبل صرف القماش والتوجيه للقص!');
      return;
    }
    if (
      window.confirm(
        'هل أنت متأكد من صرف القماش والتوجيه للقص؟ سيتم الآن خصم الكميات المحددة من المخزون الفعلي الكلي.'
      )
    ) {
      const res = issueFabricToCutting(modelId, {
        reqQuantities,
        accQuantities
      });
      if (res.success) {
        onGoToCutting(modelId);
      }
    }
  };

  const handleDelete = () => {
    if (
      window.confirm(
        'هل أنت متأكد من حذف هذا الموديل؟ سيتم إخفاؤه من النظام وتحرير الأقمشة المحجوزة وإعادتها إلى المتاح للتصميم.'
      )
    ) {
      deleteDesignModel(modelId);
      onBack();
    }
  };

  const shirtAccessories = modelAccs.filter((a) => a.target_type !== 'pants');
  const pantsAccessories = modelAccs.filter((a) => a.target_type === 'pants');

  const selectedColorObj = fabricColors.find((c) => c.id === selectedColorId);
  const selectedColorFab = fabrics.find((f) => f.id === selectedColorObj?.fabric_id);
  const selectedColorAvailableForDesign = selectedColorObj
    ? Number((selectedColorObj.quantity - selectedColorObj.reserved_quantity).toFixed(2))
    : 0;

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
                النوع: <strong className="text-slate-800">{model.model_type || 'أولادي'}</strong> | تاريخ الإنشاء:{' '}
                {new Date(model.created_at).toLocaleDateString('ar-EG')}
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
                <span>✂️ صرف القماش والتوجيه للقص</span>
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
            <div>
              <h3 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                <Palette className="w-4 h-4 text-amber-600" />
                <span>تخصيص ألوان وخامات الموديل:</span>
              </h3>
              <p className="text-[11px] text-slate-500 mt-1">
                عند تحديد القماش للموديل، يتم خصم الكمية من <strong className="text-emerald-700">(المتاح للتصميم)</strong> فقط، ولا يتم الخصم من <strong className="text-blue-700">(المخزون الفعلي الكلي)</strong> إلا عند الضغط على زر "صرف القماش والتوجيه للقص".
              </p>
            </div>

            <form onSubmit={handleAddColorSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  اللون والخامة من المخزن *
                </label>
                <select
                  disabled={!canEdit}
                  value={selectedColorId}
                  onChange={(e) => setSelectedColorId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden"
                >
                  <option value="">-- اختر لون قماش --</option>
                  {fabricColors.map((col) => {
                    const fab = fabrics.find((f) => f.id === col.fabric_id);
                    const avail = Number((col.quantity - col.reserved_quantity).toFixed(2));
                    return (
                      <option key={col.id} value={col.id}>
                        {fab?.name} - {col.color_code} ({col.color_name || 'لون'}) [المتاح للتصميم: {avail} {fab?.unit} | الفعلي الكلي: {col.quantity}]
                      </option>
                    );
                  })}
                </select>
                {selectedColorObj && (
                  <div className="mt-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-[11px]">
                    <span className="text-slate-600">
                      المخزون الفعلي الكلي:{' '}
                      <strong className="text-blue-700 font-black">
                        {selectedColorObj.quantity} {selectedColorFab?.unit}
                      </strong>
                    </span>
                    <span className="text-emerald-800 font-bold">
                      المتاح للتصميم:{' '}
                      <strong className="font-black">
                        {selectedColorAvailableForDesign} {selectedColorFab?.unit}
                      </strong>
                    </span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    اسم القطعة أو الجزء *
                  </label>
                  <input
                    type="text"
                    required
                    disabled={!canEdit}
                    placeholder="مثال: الصدر والظهر، كابيشو..."
                    value={partName}
                    onChange={(e) => setPartName(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    الكمية المطلوبة ({selectedColorFab?.unit || 'كجم'}) *
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0.1"
                    required
                    disabled={!canEdit}
                    placeholder="مثال: 15"
                    value={partPlannedQty}
                    onChange={(e) => setPartPlannedQty(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-slate-300 focus:outline-hidden"
                  />
                </div>
              </div>

              {canEdit && (
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>تحديد القماش للموديل (حجز من المتاح للتصميم)</span>
                </button>
              )}
            </form>
          </div>

          {/* Card 2: Add Accessory to Model + General Tools Below Accessories (Task 2.1) */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-5">
            <h3 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-pink-600" />
              <span>تخصيص الإكسسوارات (تيشرت / بنطلون):</span>
            </h3>

            <form onSubmit={handleAddAccessorySubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  قسم الإكسسوار (تيشرت أو بنطلون) *
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAccTargetType('shirt')}
                    className={`py-2 px-3 text-xs font-bold rounded-xl border transition flex items-center justify-center gap-1.5 cursor-pointer ${
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
                    className={`py-2 px-3 text-xs font-bold rounded-xl border transition flex items-center justify-center gap-1.5 cursor-pointer ${
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
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  اختر الصنف من مخزن الإكسسوارات *
                </label>
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

            {/* BELOW ACCESSORIES: GENERAL TOOLS (الأدوات العامة المحفوظة من شاشة الإعدادات - Task 2.1) */}
            <div className="pt-4 border-t border-slate-200 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Star className="w-4 h-4 text-amber-500 fill-amber-500 shrink-0" />
                  <h4 className="font-extrabold text-xs text-slate-900">
                    🛠️ الأدوات العامة (اختيار سريع لـ {accTargetType === 'shirt' ? 'التيشرت' : 'البنطلون'}):
                  </h4>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-black">
                  {generalToolItems.length} أداة محفوظة
                </span>
              </div>

              <p className="text-[11px] text-slate-500">
                اضغط على أي أداة عامة (أو علامة التحديد Checkbox) لإضافتها أو إزالتها فوراً للموديل ضمن قسم{' '}
                <strong className="text-slate-800">
                  {accTargetType === 'shirt' ? 'التيشرت' : 'البنطلون'}
                </strong>
                .
              </p>

              {generalToolItems.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {generalToolItems.map((tool) => {
                    const isSelectedForCurrentTarget = modelAccs.some(
                      (a) =>
                        (a.accessory_id === tool.id || a.accessory_code === tool.code) &&
                        a.target_type === accTargetType
                    );
                    const isSelectedForOtherTarget = modelAccs.some(
                      (a) =>
                        (a.accessory_id === tool.id || a.accessory_code === tool.code) &&
                        a.target_type !== accTargetType
                    );
                    const avail = Number((tool.quantity - tool.reserved_quantity).toFixed(2));

                    return (
                      <label
                        key={tool.id}
                        onClick={(e) => {
                          e.preventDefault();
                          handleToggleGeneralTool(tool, accTargetType);
                        }}
                        className={`flex items-center justify-between gap-2 p-2.5 rounded-2xl border text-start transition select-none ${
                          !canEdit ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                        } ${
                          isSelectedForCurrentTarget
                            ? 'bg-amber-50 border-amber-500 text-amber-950 shadow-2xs ring-2 ring-amber-400/25'
                            : 'bg-slate-50/70 border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={isSelectedForCurrentTarget}
                            disabled={!canEdit}
                            onChange={() => {}}
                            className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 shrink-0 pointer-events-none"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="font-extrabold text-xs text-slate-900 truncate">
                                {tool.name}
                              </span>
                              <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-white border border-slate-200 text-slate-600">
                                {tool.code}
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-500 block">
                              متاح: {avail} {tool.unit}
                              {isSelectedForOtherTarget && (
                                <strong className="text-indigo-600 ms-1">
                                  • (مضاف أيضاً بـ {accTargetType === 'shirt' ? 'البنطلون' : 'التيشرت'})
                                </strong>
                              )}
                            </span>
                          </div>
                        </div>

                        <span
                          className={`text-[10px] font-black px-2 py-0.5 rounded-full shrink-0 ${
                            isSelectedForCurrentTarget
                              ? 'bg-amber-500 text-slate-950'
                              : 'bg-white border border-slate-200 text-slate-600'
                          }`}
                        >
                          {isSelectedForCurrentTarget ? '✓ تم الاختيار' : '+ اختر'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="p-3.5 rounded-2xl bg-amber-50/60 border border-amber-200 text-center text-xs text-amber-900">
                  لم يتم تحديد أدوات عامة مفضلة من شاشة الإعدادات بعد. يمكنك تحديدها من قسم{' '}
                  <strong>الإعدادات &larr; الإعدادات والأدوات العامة</strong> لتظهر هنا كأزرار سريعة.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Requirements, Separated Accessories, Markers & Notes */}
        <div className="lg:col-span-7 space-y-6">
          <form onSubmit={handleSavePlan} className="space-y-6">
            {/* Fabric Requirements Table */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b pb-2 flex-wrap gap-2">
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-blue-600" />
                    <span>خطة أوزان الأقمشة المطلوبة للتشغيلة:</span>
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    الكميات المخططة هنا تُخصم من <strong>(المتاح للتصميم)</strong> فقط، ويبقى <strong>(المخزون الفعلي الكلي)</strong> ثابتاً حتى الضغط على صرف القماش للقص.
                  </p>
                </div>
                <span className="text-xs font-bold text-slate-500">إجمالي الأجزاء: {modelReqs.length}</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-start">
                  <thead className="bg-slate-50 text-slate-600 font-bold">
                    <tr>
                      <th className="p-2">القطعة</th>
                      <th className="p-2">الخامة واللون</th>
                      <th className="p-2 text-center">المخزون الفعلي الكلي</th>
                      <th className="p-2 text-center">المتاح للتصميم</th>
                      <th className="p-2 text-center">الكمية المحجوزة للموديل</th>
                      <th className="p-2 text-center">حذف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {modelReqs.length > 0 ? (
                      modelReqs.map((req) => {
                        const color = fabricColors.find((c) => c.id === req.color_id);
                        const fab = fabrics.find((f) => f.id === color?.fabric_id);
                        const planned = reqQuantities[req.id] ?? req.planned_quantity;
                        const savedPlanned = req.planned_quantity || 0;
                        // Dynamically reflect any unsaved edits in the input field on the displayed Available for Design
                        const baseAvail = color
                          ? Number((color.quantity - color.reserved_quantity).toFixed(2))
                          : 0;
                        const liveAvail = Number(
                          Math.max(0, baseAvail + savedPlanned - (Number(planned) || 0)).toFixed(2)
                        );

                        return (
                          <tr key={req.id}>
                            <td className="p-2 font-bold text-slate-900">{req.part_name}</td>
                            <td className="p-2 text-slate-600">
                              <div className="flex items-center gap-1.5">
                                {color && (
                                  <span
                                    className="w-3.5 h-3.5 rounded-full border border-slate-300 shrink-0"
                                    style={{ backgroundColor: color.hex_code }}
                                  />
                                )}
                                <span>
                                  {fab?.name} ({color?.color_code})
                                </span>
                              </div>
                            </td>
                            <td className="p-2 text-center text-blue-700 font-black">
                              {color ? color.quantity : 0} {fab?.unit || 'كجم'}
                            </td>
                            <td className="p-2 text-center text-emerald-700 font-extrabold">
                              {liveAvail} {fab?.unit || 'كجم'}
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
                                className="w-24 px-2 py-1 text-center font-black text-xs border border-amber-300 bg-amber-50/40 rounded-lg focus:ring-2 focus:ring-amber-500"
                              />
                            </td>
                            <td className="p-2 text-center">
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() => deleteModelRequirement(req.id)}
                                  className="text-rose-500 hover:text-rose-700 cursor-pointer"
                                  title="حذف وإعادة الكمية للمتاح للتصميم"
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
                        <td colSpan={6} className="text-center py-4 text-slate-400">
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
                            <td className="p-2 text-center font-bold text-blue-700">
                              {acc.piece_consumption || 1}
                            </td>
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
                                  className="text-rose-500 hover:text-rose-700 cursor-pointer"
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
                            <td className="p-2 text-center font-bold text-amber-700">
                              {acc.piece_consumption || 1}
                            </td>
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
                                  className="text-rose-500 hover:text-rose-700 cursor-pointer"
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

              {/* Quick General Tools Selector Bar also accessible directly below the accessories tables */}
              {generalToolItems.length > 0 && (
                <div className="pt-3 border-t border-slate-100 space-y-2.5">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-xs font-extrabold text-amber-950 flex items-center gap-1.5">
                      <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                      <span>الأدوات العامة المحفوظة من الإعدادات (اضغط للاختيار السريع للموديل):</span>
                    </span>
                    <div className="flex items-center gap-1 text-[11px]">
                      <span className="text-slate-500">إضافة إلى:</span>
                      <button
                        type="button"
                        onClick={() => setAccTargetType('shirt')}
                        className={`px-2.5 py-0.5 rounded-lg font-bold cursor-pointer ${
                          accTargetType === 'shirt'
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        تيشرت
                      </button>
                      <button
                        type="button"
                        onClick={() => setAccTargetType('pants')}
                        className={`px-2.5 py-0.5 rounded-lg font-bold cursor-pointer ${
                          accTargetType === 'pants'
                            ? 'bg-amber-600 text-white'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        بنطلون
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {generalToolItems.map((tool) => {
                      const isChecked = modelAccs.some(
                        (a) =>
                          (a.accessory_id === tool.id || a.accessory_code === tool.code) &&
                          a.target_type === accTargetType
                      );
                      return (
                        <button
                          key={`quick-${tool.id}`}
                          type="button"
                          disabled={!canEdit}
                          onClick={() => handleToggleGeneralTool(tool, accTargetType)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition cursor-pointer ${
                            isChecked
                              ? 'bg-amber-500 text-slate-950 border-amber-600 shadow-2xs'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-amber-50'
                          }`}
                        >
                          {isChecked ? (
                            <CheckSquare className="w-3.5 h-3.5 text-slate-950" />
                          ) : (
                            <Square className="w-3.5 h-3.5 text-slate-400" />
                          )}
                          <span>{tool.name}</span>
                          <span className="text-[10px] opacity-75 font-mono">({tool.code})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
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
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    الماركر الأساسي للقص
                  </label>
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
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    ماركر الطباعة والتطريز
                  </label>
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
                <span>حفظ التعديلات وخطة التشغيل (تحديث المحجوز من المتاح للتصميم)</span>
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
};