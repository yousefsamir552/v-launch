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
  Star
} from 'lucide-react';
import { ZoomableImage } from './ZoomableImage';
import { EditModelModal } from './EditModelModal';
import {
  AccessoryItem,
  GarmentComposition,
  GarmentPart,
  GARMENT_COMPOSITION_ORDER,
  GARMENT_COMPOSITION_LABELS,
  DEFAULT_GARMENT_COMPOSITION,
  PART_EMOJI,
  partsForComposition,
  getPartLabel
} from '../types';
import { FabricColorPicker } from './FabricColorPicker';
import { EndedModelBadge } from './CompletedModelsToggle';
import { currentStageLabel } from '../utils/completedModels';

/** ألوان شارات القطع في جدول الأقمشة المخصصة للموديل. */
const PART_BADGE_STYLES: Record<GarmentPart, string> = {
  shirt: 'bg-blue-50 text-blue-900 border-blue-200',
  pants: 'bg-amber-50 text-amber-900 border-amber-200',
  jacket: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  single: 'bg-violet-50 text-violet-900 border-violet-200'
};

/** أسماء القطع الأساسية كما قد تُكتب في بند قديم بدون قصة فرعية. */
const PART_NAME_SYNONYMS: Record<GarmentPart, string[]> = {
  shirt: ['تيشرت', 'تيشيرت', 'قميص', 'shirt', 't-shirt', 'tshirt'],
  pants: ['بنطلون', 'بنطال', 'pants', 'trouser', 'trousers'],
  jacket: ['جاكيت', 'jacket'],
  single: ['قطعة واحدة', 'single', 'كامل']
};

/**
 * يفصل اسم بند القماش إلى القطعة الأساسية والقصة الفرعية:
 * "تيشرت - الصدر" → { part: 'shirt', subPart: 'الصدر' }
 * "الصدر" (بند قديم حر) → { part: 'shirt', subPart: 'الصدر' }
 */
const splitRequirementPartName = (
  rawName: string | undefined | null,
  normalize: (value?: string | null) => GarmentPart
): { part: GarmentPart; subPart: string } => {
  const raw = (rawName || '').trim();
  const part = normalize(raw);
  const label = getPartLabel(part);
  if (!raw) return { part, subPart: '' };

  const separatorMatch = raw.match(/^(.+?)\s*[-–—:|]\s*(.+)$/);
  if (separatorMatch && normalize(separatorMatch[1]) === part) {
    return { part, subPart: separatorMatch[2].trim() };
  }

  if (raw.startsWith(label)) {
    const subPart = raw.slice(label.length).replace(/^[\s\-–—:|]+/, '').trim();
    return { part, subPart: subPart === label ? '' : subPart };
  }

  // اسم القطعة الأساسية فقط (بصيغة أخرى) لا يُعد قصة فرعية.
  if (PART_NAME_SYNONYMS[part].includes(raw.toLowerCase())) {
    return { part, subPart: '' };
  }

  return { part, subPart: raw };
};

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
    suppliers,
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
    normalizePartKey,
    hasPermission,
    canAddDesignNotes
  } = useApp();

  const canEdit = hasPermission('design', true);
  const canWriteNotes = canAddDesignNotes();
  const model = models.find((m) => m.id === modelId && !m.is_deleted);
  const [editModalOpen, setEditModalOpen] = useState(false);

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
  const [accTargetType, setAccTargetType] = useState<'shirt' | 'pants' | 'jacket' | 'single'>('shirt');
  const [accPieceConsumption, setAccPieceConsumption] = useState<number>(1);

  // القطعة التي يُضاف لها القماش/اللون (تتزامن مع تكوين قطع الموديل مثل accTargetType).
  const [reqTargetPart, setReqTargetPart] = useState<GarmentPart>('shirt');

  // Local Form state for Section 2 (Planning quantities, markers, notes)
  const [reqQuantities, setReqQuantities] = useState<Record<string, number>>({});
  const [accQuantities, setAccQuantities] = useState<Record<string, number>>({});
  const [mainMarkerUrl, setMainMarkerUrl] = useState('');
  const [printMarkerUrl, setPrintMarkerUrl] = useState('');
  const [designNotes, setDesignNotes] = useState('');
  const [notesShirt, setNotesShirt] = useState('');
  const [notesPants, setNotesPants] = useState('');
  const [notesJacket, setNotesJacket] = useState('');

  useEffect(() => {
    if (model) {
      setTargetCutQuantity(model.target_cut_quantity || 500);
      setMainMarkerUrl(model.main_marker_url || '');
      setPrintMarkerUrl(model.print_marker_url || '');
      setDesignNotes(model.design_notes || '');
      setNotesShirt(model.notes_shirt || '');
      setNotesPants(model.notes_pants || '');
      setNotesJacket(model.notes_jacket || '');
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

  // ---- Garment composition drives which accessory sections are available ----
  // A shirt-only model must never show a pants accessory section and vice versa.
  const compositionParts = (() => {
    const parts = [...partsForComposition(model?.garment_composition)];
    // بعض الموديلات (المستوردة أو القديمة) تحمل قطعاً إضافية مثل "قطعة واحدة"
    // في garment_parts دون تغيير التكوين الأساسي، لذا ندمجها لعرض قسم الإكسسوار.
    (model?.garment_parts || []).forEach((part) => {
      if (part && !parts.includes(part)) parts.push(part);
    });
    return parts;
  })();
  const canAddShirt = compositionParts.includes('shirt');
  const canAddPants = compositionParts.includes('pants');
  const canAddJacket = compositionParts.includes('jacket');
  const canAddSingle = compositionParts.includes('single');

  // Arabic label for the currently selected accessory section (تيشرت / بنطلون / جاكيت / قطعة واحدة).
  const accTargetLabel = getPartLabel(accTargetType);

  // عدد بنود الأقمشة المسجلة لكل قطعة — يُعرض على أزرار اختيار القطعة.
  const reqCountByPart: Partial<Record<GarmentPart, number>> = {};
  modelReqs.forEach((r) => {
    const key = normalizePartKey(r.part_name);
    reqCountByPart[key] = (reqCountByPart[key] || 0) + 1;
  });

  /**
   * يبني اسم بند القماش النهائي: "القطعة" أو "القطعة - القصة الفرعية".
   * القصة الفرعية اختيارية، وتُحذف بادئة القطعة منها لو كتبها المستخدم بنفسه
   * حتى لا يتكرر الاسم مثل "تيشرت - تيشرت - الصدر".
   */
  const buildRequirementPartName = (part: GarmentPart, subPartRaw: string): string => {
    const label = getPartLabel(part);
    const sub = subPartRaw.trim();
    const cleanSub = sub.startsWith(label)
      ? sub.slice(label.length).replace(/^[\s\-–—:|]+/, '').trim()
      : sub;
    return cleanSub && cleanSub !== label ? `${label} - ${cleanSub}` : label;
  };

  useEffect(() => {
    const availableTargets: Array<'shirt' | 'pants' | 'jacket' | 'single'> = [
      ...(canAddShirt ? (['shirt'] as const) : []),
      ...(canAddPants ? (['pants'] as const) : []),
      ...(canAddJacket ? (['jacket'] as const) : []),
      ...(canAddSingle ? (['single'] as const) : [])
    ];
    if (availableTargets.length > 0 && !availableTargets.includes(accTargetType)) {
      setAccTargetType(availableTargets[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accTargetType, canAddShirt, canAddPants, canAddJacket, canAddSingle]);

  // مزامنة قطعة نموذج إضافة القماش مع قطع الموديل المتاحة.
  useEffect(() => {
    const availableTargets: GarmentPart[] = [
      ...(canAddShirt ? (['shirt'] as const) : []),
      ...(canAddPants ? (['pants'] as const) : []),
      ...(canAddJacket ? (['jacket'] as const) : []),
      ...(canAddSingle ? (['single'] as const) : [])
    ];
    if (availableTargets.length > 0 && !availableTargets.includes(reqTargetPart)) {
      setReqTargetPart(availableTargets[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqTargetPart, canAddShirt, canAddPants, canAddJacket, canAddSingle]);

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

  // A model that already left the design stage must never be issued again.
  const isDesignCompleted =
    model.status !== 'مرحلة التصميم' && model.status !== 'تصميم';

  // General Tools / Favorite Accessories saved in Settings (Task 2.1)
  const favoriteIds = globalSettings?.favorite_accessory_ids || [];
  const generalToolItems = accessoryItems.filter((item) => favoriteIds.includes(item.id));

  // Quick-add only: tools already added to the current target section are hidden from the quick box
  // so they never duplicate. Removal happens from the accessories table itself.
  const remainingGeneralTools = generalToolItems.filter(
    (tool) =>
      !modelAccs.some(
        (a) =>
          (a.accessory_id === tool.id || a.accessory_code === tool.code) &&
          a.target_type === accTargetType
      )
  );

  const handleAddGeneralTool = (
    toolItem: AccessoryItem,
    targetType: 'shirt' | 'pants' | 'jacket' | 'single' = accTargetType
  ) => {
    if (!canEdit) return;
    // Guard against duplicates for the same target section
    const existingEntry = modelAccs.find(
      (a) =>
        (a.accessory_id === toolItem.id || a.accessory_code === toolItem.code) &&
        a.target_type === targetType
    );
    if (existingEntry) return;

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
  };

  /**
   * إعادة حساب كميات الإكسسوارات تلقائياً = استهلاك القطعة × أساس العدّ
   * (العدد المستهدف للقص أو العدد المقصوص فعلياً).
   */
  const recalcAccQuantities = (basis: number) => {
    const safeBasis = Math.max(0, Number(basis) || 0);
    const next: Record<string, number> = {};
    modelAccs.forEach((acc) => {
      next[acc.id] = Math.round((Number(acc.piece_consumption) || 1) * safeBasis);
    });
    setAccQuantities(next);
    return next;
  };

  const handleUpdateTargetCut = (newQty: number) => {
    const safeQty = Math.max(0, Number(newQty) || 0);
    setTargetCutQuantity(safeQty);
    // مزامنة تلقائية لكميات الإكسسوارات مع العدد المستهدف للقص.
    recalcAccQuantities(safeQty);
  };

  /**
   * حفظ العدد المستهدف وكميات الإكسسوارات المزامنة معه عند مغادرة حقل العدد
   * (تجنب إرسال طلب للباك إند مع كل رقم يُكتب).
   */
  const handlePersistTargetCut = () => {
    if (!canEdit) return;
    if (targetCutQuantity === Number(model?.target_cut_quantity ?? 500)) return;
    const nextQuantities = recalcAccQuantities(targetCutQuantity);
    updateModelPlan({
      modelId,
      reqQuantities,
      accQuantities: nextQuantities,
      mainMarkerUrl,
      printMarkerUrl,
      designNotes,
      notesShirt,
      notesPants,
      notesJacket,
      targetCutQuantity
    });
  };

  /** مطابقة كميات كل الإكسسوارات مع العدد المقصوص فعلياً للموديل. */
  const handleMatchActualCut = () => {
    if (!canEdit) return;
    const actualCut = Number(model.total_cut_pieces || model.actual_cut_count || 0);
    if (actualCut <= 0) {
      alert('لا يوجد عدد مقصوص فعلي مسجّل لهذا الموديل بعد. سجّل القص أولاً ثم أعد المحاولة.');
      return;
    }
    const nextQuantities = recalcAccQuantities(actualCut);
    updateModelPlan({
      modelId,
      reqQuantities,
      accQuantities: nextQuantities,
      mainMarkerUrl,
      printMarkerUrl,
      designNotes,
      notesShirt,
      notesPants,
      notesJacket,
      targetCutQuantity
    });
  };

  /** أقسام الموديل الأخرى التي تحتوي على نفس الأداة العامة (تيشرت / بنطلون / جاكيت). */
  const otherTargetsLabel = (tool: AccessoryItem): string =>
    Array.from(
      new Set(
        modelAccs
          .filter(
            (a) =>
              (a.accessory_id === tool.id || a.accessory_code === tool.code) &&
              a.target_type !== accTargetType
          )
          .map((a) => getPartLabel(a.target_type))
      )
    ).join(' / ');

  const currentComposition: GarmentComposition =
    (model.garment_composition as GarmentComposition) || DEFAULT_GARMENT_COMPOSITION;

  const handleChangeComposition = (comp: GarmentComposition) => {
    if (!canEdit || comp === currentComposition) return;
    updateModelNotesAndTarget(modelId, { garment_composition: comp });
  };

  const handleAddColorSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedColorId) return;
    const qtyNum = Math.max(0, parseFloat(partPlannedQty) || 0);
    const finalPartName = buildRequirementPartName(reqTargetPart, partName);
    const res = addModelRequirement(modelId, selectedColorId, finalPartName, qtyNum);
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
      notesJacket,
      targetCutQuantity
    });
  };

  const handleIssueFabric = () => {
    if (isDesignCompleted) {
      alert(
        `تم الانتهاء وخرج الموديل بالفعل من مرحلة التصميم (${currentStageLabel(model)}) ولا يمكن إعادة صرف القماش أو نقله مرة أخرى.`
      );
      return;
    }
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

  const shirtAccessories = modelAccs.filter((a) => a.target_type === 'shirt');
  const pantsAccessories = modelAccs.filter((a) => a.target_type === 'pants');
  const jacketAccessories = modelAccs.filter((a) => a.target_type === 'jacket');
  const singleAccessories = modelAccs.filter((a) => a.target_type === 'single');

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
          <ZoomableImage
            src={model.image}
            alt={model.model_code}
            downloadName={`${model.model_code}.jpg`}
            className="w-full h-full object-contain bg-white"
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
                {isDesignCompleted && <EndedModelBadge currentStage={currentStageLabel(model)} />}
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
                    onBlur={handlePersistTargetCut}
                    className="w-24 px-2 py-1 text-base font-black text-blue-950 bg-white border border-blue-300 rounded-lg text-center focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-xs font-black text-blue-800">قطعة</span>
                </div>
                <span className="text-[10px] text-blue-700/80 block mt-1">
                  تتم مزامنة كميات الإكسسوارات تلقائياً مع هذا العدد، وتُحفظ عند مغادرة
                  الحقل أو حفظ خطة الموديل.
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-slate-100">
            {canEdit && (
              isDesignCompleted ? (
                <button
                  type="button"
                  disabled
                  className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-slate-200 text-slate-600 border border-slate-300 font-bold text-xs cursor-not-allowed"
                >
                  <Lock className="w-4 h-4" />
                  <span>
                    🔒 تم الانتهاء وخرج الموديل بالفعل من مرحلة التصميم ({currentStageLabel(model)})
                  </span>
                </button>
              ) : (
                <button
                  onClick={handleIssueFabric}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20 transition cursor-pointer"
                >
                  <Scissors className="w-4 h-4" />
                  <span>✂️ صرف القماش والتوجيه للقص</span>
                </button>
              )
            )}

            {canEdit && (
              <button
                type="button"
                onClick={() => setEditModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-600 hover:text-white font-bold text-xs shadow-xs transition cursor-pointer"
              >
                ✏️ <span>تعديل بيانات الموديل</span>
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
                  لأي قطعة من الموديل تضيف هذا القماش؟ *
                </label>
                <div
                  className={`grid gap-2 ${
                    [canAddShirt, canAddPants, canAddJacket, canAddSingle].filter(Boolean).length >= 3
                      ? 'grid-cols-3'
                      : canAddShirt && canAddPants
                        ? 'grid-cols-2'
                        : 'grid-cols-1'
                  }`}
                >
                  {canAddShirt && (
                    <button
                      type="button"
                      onClick={() => setReqTargetPart('shirt')}
                      className={`py-2 px-3 text-xs font-bold rounded-xl border transition flex items-center justify-center gap-1.5 cursor-pointer ${
                        reqTargetPart === 'shirt'
                          ? 'bg-blue-50 border-blue-400 text-blue-900 shadow-2xs'
                          : 'bg-white border-slate-200 text-slate-600'
                      }`}
                    >
                      <span>👕 قماش تيشرت</span>
                      <span className="text-[10px] font-black opacity-70">
                        ({reqCountByPart.shirt || 0})
                      </span>
                    </button>
                  )}
                  {canAddPants && (
                    <button
                      type="button"
                      onClick={() => setReqTargetPart('pants')}
                      className={`py-2 px-3 text-xs font-bold rounded-xl border transition flex items-center justify-center gap-1.5 cursor-pointer ${
                        reqTargetPart === 'pants'
                          ? 'bg-amber-50 border-amber-400 text-amber-900 shadow-2xs'
                          : 'bg-white border-slate-200 text-slate-600'
                      }`}
                    >
                      <span>👖 قماش بنطلون</span>
                      <span className="text-[10px] font-black opacity-70">
                        ({reqCountByPart.pants || 0})
                      </span>
                    </button>
                  )}
                  {canAddJacket && (
                    <button
                      type="button"
                      onClick={() => setReqTargetPart('jacket')}
                      className={`py-2 px-3 text-xs font-bold rounded-xl border transition flex items-center justify-center gap-1.5 cursor-pointer ${
                        reqTargetPart === 'jacket'
                          ? 'bg-emerald-50 border-emerald-400 text-emerald-900 shadow-2xs'
                          : 'bg-white border-slate-200 text-slate-600'
                      }`}
                    >
                      <span>🧥 قماش جاكيت</span>
                      <span className="text-[10px] font-black opacity-70">
                        ({reqCountByPart.jacket || 0})
                      </span>
                    </button>
                  )}
                  {canAddSingle && (
                    <button
                      type="button"
                      onClick={() => setReqTargetPart('single')}
                      className={`py-2 px-3 text-xs font-bold rounded-xl border transition flex items-center justify-center gap-1.5 cursor-pointer ${
                        reqTargetPart === 'single'
                          ? 'bg-violet-50 border-violet-400 text-violet-900 shadow-2xs'
                          : 'bg-white border-slate-200 text-slate-600'
                      }`}
                    >
                      <span>🧵 قماش قطعة واحدة</span>
                      <span className="text-[10px] font-black opacity-70">
                        ({reqCountByPart.single || 0})
                      </span>
                    </button>
                  )}
                </div>
                <span className="text-[10px] text-slate-400 block mt-1">
                  يُضاف القماش لقطعة <strong className="text-slate-700">{getPartLabel(reqTargetPart)}</strong>{' '}
                  فقط، وتظهر ألوانها وحدها في القص والفرز والعد.
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  اللون والخامة من المخزن *
                </label>
                <FabricColorPicker
                  colors={fabricColors}
                  fabrics={fabrics}
                  suppliers={suppliers}
                  value={selectedColorId}
                  onChange={setSelectedColorId}
                  disabled={!canEdit}
                />
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
                    اسم الجزء / القصة (اختياري)
                  </label>
                  <input
                    type="text"
                    disabled={!canEdit}
                    placeholder="اختياري: الصدر، الكم، الكابيشو... (اتركه فارغاً للقطعة كاملة)"
                    value={partName}
                    onChange={(e) => setPartName(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden"
                  />
                  <span className="text-[10px] text-slate-400 block mt-1">
                    سيُحفظ البند باسم: {buildRequirementPartName(reqTargetPart, partName)}
                  </span>
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
                  disabled={!selectedColorId}
                  className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 disabled:cursor-not-allowed text-white font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>
                    {selectedColorId
                      ? `تحديد قماش ${getPartLabel(reqTargetPart)} للموديل (حجز من المتاح للتصميم)`
                      : 'اختر اللون أولاً لتحديد القماش للموديل'}
                  </span>
                </button>
              )}
            </form>
          </div>

          {/* Card 2: Add Accessory to Model + General Tools Below Accessories (Task 2.1) */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-5">
            <h3 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-pink-600" />
              <span>
                تخصيص الإكسسوارات (
                {compositionParts.map((part) => getPartLabel(part)).join(' / ')}):
              </span>
            </h3>

            <form onSubmit={handleAddAccessorySubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  قسم الإكسسوار حسب قطع الموديل *
                </label>
                <div
                  className={`grid gap-2 ${
                    [canAddShirt, canAddPants, canAddJacket, canAddSingle].filter(Boolean).length >= 3
                      ? 'grid-cols-3'
                      : canAddShirt && canAddPants
                        ? 'grid-cols-2'
                        : 'grid-cols-1'
                  }`}
                >
                  {canAddShirt && (
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
                  )}
                  {canAddPants && (
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
                  )}
                  {canAddJacket && (
                    <button
                      type="button"
                      onClick={() => setAccTargetType('jacket')}
                      className={`py-2 px-3 text-xs font-bold rounded-xl border transition flex items-center justify-center gap-1.5 cursor-pointer ${
                        accTargetType === 'jacket'
                          ? 'bg-emerald-50 border-emerald-400 text-emerald-900 shadow-2xs'
                          : 'bg-white border-slate-200 text-slate-600'
                      }`}
                    >
                      <span>🧥 إكسسوار جاكيت</span>
                    </button>
                  )}
                  {canAddSingle && (
                    <button
                      type="button"
                      onClick={() => setAccTargetType('single')}
                      className={`py-2 px-3 text-xs font-bold rounded-xl border transition flex items-center justify-center gap-1.5 cursor-pointer ${
                        accTargetType === 'single'
                          ? 'bg-violet-50 border-violet-400 text-violet-900 shadow-2xs'
                          : 'bg-white border-slate-200 text-slate-600'
                      }`}
                    >
                      <span>👕 إكسسوار قطعة واحدة</span>
                    </button>
                  )}
                </div>
                <span className="text-[10px] text-slate-400 block mt-1">
                  {compositionParts.length > 1
                    ? `الموديل يحتوي على ${compositionParts
                        .map((part) => getPartLabel(part))
                        .join(' و')}: يمكنك إضافة إكسسوارات لكل قطعة على حدة.`
                    : `الموديل ${getPartLabel(compositionParts[0])} فقط: تُضاف الإكسسوارات لقسم ${getPartLabel(
                        compositionParts[0]
                      )}.`}
                </span>
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
                  <span>إضافة الإكسسوار لـ {accTargetLabel}</span>
                </button>
              )}
            </form>

            {/* BELOW ACCESSORIES: GENERAL TOOLS (الأدوات العامة المحفوظة من شاشة الإعدادات - Task 2.1) */}
            <div className="pt-4 border-t border-slate-200 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Star className="w-4 h-4 text-amber-500 fill-amber-500 shrink-0" />
                  <h4 className="font-extrabold text-xs text-slate-900">
                    🛠️ الأدوات العامة (اختيار سريع لـ {accTargetLabel}):
                  </h4>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-black">
                  {generalToolItems.length} أداة محفوظة
                </span>
              </div>

              <p className="text-[11px] text-slate-500">
                اضغط على أي أداة عامة لإضافتها فوراً كصف عادي في قائمة إكسسوارات الموديل ضمن قسم{' '}
                <strong className="text-slate-800">
                  {accTargetLabel}
                </strong>
                . الأداة المضافة تختفي من هنا، ويمكن حذفها من جدول الإكسسوارات.
              </p>

              {generalToolItems.length > 0 ? (
                remainingGeneralTools.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {remainingGeneralTools.map((tool) => {
                    const isAddedToOtherTarget = modelAccs.some(
                      (a) =>
                        (a.accessory_id === tool.id || a.accessory_code === tool.code) &&
                        a.target_type !== accTargetType
                    );
                    const avail = Number((tool.quantity - tool.reserved_quantity).toFixed(2));

                    return (
                      <button
                        key={tool.id}
                        type="button"
                        disabled={!canEdit}
                        onClick={() => handleAddGeneralTool(tool, accTargetType)}
                        className="flex items-center justify-between gap-2 p-2.5 rounded-2xl border border-slate-200 bg-slate-50/70 text-slate-700 text-start transition cursor-pointer hover:bg-emerald-50 hover:border-emerald-300 disabled:opacity-60 disabled:cursor-not-allowed"
                        title="إضافة الأداة كصف إكسسوار للموديل"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Plus className="w-4 h-4 text-emerald-600 shrink-0" />
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
                              {isAddedToOtherTarget && (
                                <strong className="text-indigo-600 ms-1">
                                  • (مضاف أيضاً بـ {otherTargetsLabel(tool) || accTargetLabel})
                                </strong>
                              )}
                            </span>
                          </div>
                        </div>

                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full shrink-0 bg-emerald-100 border border-emerald-300 text-emerald-800">
                          + إضافة
                        </span>
                      </button>
                    );
                  })}
                </div>
                ) : (
                  <div className="p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-200 text-center text-xs text-emerald-900 font-bold">
                    ✓ تمت إضافة كل الأدوات العامة إلى قسم {accTargetLabel}.
                  </div>
                )
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
            {/* Model Garment Composition (drives parts in Cutting & QC) */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-3">
              <div>
                <h3 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-600" />
                  <span>تكوين قطع الموديل:</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  يحدد القطع التي تظهر في أقسام القص والفرز (تيشيرت / بنطلون / جاكيت). الموديلات القديمة تُعامل كقطعتين افتراضياً.
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {GARMENT_COMPOSITION_ORDER.map((comp) => {
                  const active = currentComposition === comp;
                  return (
                    <button
                      key={comp}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => handleChangeComposition(comp)}
                      className={`px-3 py-2.5 rounded-xl border text-xs font-bold transition text-center ${
                        active
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                          : 'bg-white text-slate-700 border-slate-300 hover:border-indigo-400'
                      } ${!canEdit ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      {GARMENT_COMPOSITION_LABELS[comp]}
                    </button>
                  );
                })}
              </div>
            </div>

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
                      <th className="p-2">القطعة / القصة</th>
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
                        // شارة القطعة التابع لها البند + القصة الفرعية إن وجدت.
                        const partInfo = splitRequirementPartName(req.part_name, normalizePartKey);

                        return (
                          <tr key={req.id}>
                            <td className="p-2">
                              <div className="flex flex-col items-start gap-1">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-black ${PART_BADGE_STYLES[partInfo.part]}`}
                                >
                                  <span>{PART_EMOJI[partInfo.part]}</span>
                                  <span>{getPartLabel(partInfo.part)}</span>
                                </span>
                                {partInfo.subPart && (
                                  <span className="text-[10px] font-bold text-slate-500">
                                    القصة: {partInfo.subPart}
                                  </span>
                                )}
                              </div>
                            </td>
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

            {/* SEPARATED ACCESSORIES SECTION: Shirt / Pants / Jacket */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                <h3 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-pink-600" />
                  <span>
                    قائمة إكسسوارات التشغيل (
                    {compositionParts.map((part) => getPartLabel(part)).join(' / ')}):
                  </span>
                </h3>
                {canEdit && (
                  <button
                    type="button"
                    onClick={handleMatchActualCut}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] shadow-xs transition cursor-pointer"
                    title="إعادة حساب كمية كل إكسسوار = استهلاك القطعة × العدد المقصوص فعلياً"
                  >
                    <span>🔄 مطابقة الكميات مع المقصوص الفعلي</span>
                    <span className="px-1.5 py-0.2 rounded-full bg-white/20 text-[10px] font-black">
                      {Number(model.total_cut_pieces || model.actual_cut_count || 0)}
                    </span>
                  </button>
                )}
              </div>
              <p className="text-[10px] text-slate-500 -mt-2">
                زر المطابقة يعيد حساب الكمية الإجمالية المطلوبة لكل إكسسوار حسب العدد المقصوص فعلياً ويحفظ الخطة، بينما تغيير العدد المستهدف في الأعلى يزامن الكميات تلقائياً قبل الحفظ.
              </p>

              {/* Subsection 1: T-Shirt Accessories (only for models that include a shirt part) */}
              {canAddShirt && (
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
              )}

              {/* Subsection 2: Pants Accessories (only for models that include a pants part) */}
              {canAddPants && (
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
              )}

              {/* Subsection 3: Jacket Accessories (only for three-piece models) */}
              {canAddJacket && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-black text-emerald-950 bg-emerald-50/70 p-2 rounded-xl border border-emerald-200">
                  <span>🧥 إكسسوارات ومستلزمات الجاكيت ({jacketAccessories.length}):</span>
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
                      {jacketAccessories.length > 0 ? (
                        jacketAccessories.map((acc) => (
                          <tr key={acc.id}>
                            <td className="p-2 font-bold text-slate-900">{acc.accessory_name}</td>
                            <td className="p-2 text-center font-bold text-emerald-700">
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
                            لا توجد إكسسوارات محددة للجاكيت بعد.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              )}

              {/* Subsection 4: Single-piece Accessories (for models whose unit is a single piece) */}
              {(canAddSingle || singleAccessories.length > 0) && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-black text-violet-950 bg-violet-50/70 p-2 rounded-xl border border-violet-200">
                  <span>👕 إكسسوارات ومستلزمات القطعة الواحدة ({singleAccessories.length}):</span>
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
                      {singleAccessories.length > 0 ? (
                        singleAccessories.map((acc) => (
                          <tr key={acc.id}>
                            <td className="p-2 font-bold text-slate-900">{acc.accessory_name}</td>
                            <td className="p-2 text-center font-bold text-violet-700">
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
                            لا توجد إكسسوارات محددة للقطعة الواحدة بعد.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
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

                {/* Jacket Notes (only for models that include a jacket part) */}
                {canAddJacket && (
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                      <span>🧥 ملاحظات تشغيل وقص الجاكيت (اختياري):</span>
                    </label>
                    <textarea
                      rows={3}
                      disabled={!canWriteNotes}
                      value={notesJacket}
                      onChange={(e) => setNotesJacket(e.target.value)}
                      placeholder="تعليمات خاصة بسوستة الجاكيت، البطانة، الكاب، الجيوب، أو التطريز..."
                      className="w-full p-3 rounded-2xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-hidden disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </div>
                )}
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

      {editModalOpen && model && (
        <EditModelModal
          key={model.id}
          model={model}
          onClose={() => setEditModalOpen(false)}
        />
      )}
    </div>
  );
};