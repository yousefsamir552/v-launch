import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Scissors,
  ArrowRight,
  CheckCircle2,
  User,
  FileSpreadsheet,
  FileText,
  Lock,
  Plus,
  Trash2,
  Layers,
  Palette,
  Calculator,
  Printer,
  Ruler,
  StickyNote,
  RotateCcw,
  Pencil
} from 'lucide-react';
import { CuttingRecord, CuttingSpreadLayer, GarmentPart, ModelRequirement, PART_EMOJI, getPartLabel, PART_STAGE_LABELS, PartStage } from '../types';
import { EditSpreadModal } from './EditSpreadModal';
import { printCuttingOrder } from '../utils/printCuttingOrder';
import { EndedModelBadge } from './CompletedModelsToggle';
import { ZoomableImage } from './ZoomableImage';
import { currentStageLabel, stageBeyond } from '../utils/completedModels';

interface CuttingDetailsViewProps {
  modelId: string;
  onBack: () => void;
  onFinishedToQC: () => void;
}

/** قيمة خيار "كتابة لون آخر يدوياً" في قائمة اختيار ألوان الفرشة. */
const CUSTOM_COLOR_OPTION = '__custom_color__';

/**
 * صف ألوان الفرشة + علم محلي يوضح أن العامل اختار كتابة لون يدوياً.
 * العلم محلي فقط ولا يُرسل للباك إند (طبقات الفرشة تُعاد بناؤها صراحةً عند الحفظ).
 */
type SpreadLayerRow = CuttingSpreadLayer & { isCustomColor?: boolean };

/**
 * مسودة إدخال إرجاع فائض بند واحد: كمية العيوب + صافي الفائض المرتجع + ملاحظات.
 * القيم نصية لتسمح بالكتابة الحرة داخل الحقول ثم تُحوَّل لأرقام عند الإرسال.
 */
type SurplusDraft = { defect: string; net: string; notes: string };

export const CuttingDetailsView: React.FC<CuttingDetailsViewProps> = ({
  modelId,
  onBack,
  onFinishedToQC
}) => {
  const {
    models,
    requirements,
    fabricColors,
    fabrics,
    cuttingRecords,
    getModelParts,
    getPartStages,
    getModelColorList,
    getModelSizeList,
    sizeDefs,
    addCuttingRecord,
    updateCuttingRecord,
    deleteCuttingRecord,
    finishCuttingToQC,
    exportCuttingCsv,
    returnFabricFromCutting,
    hasPermission,
    hasSpecificPermission,
    canAddCuttingNotes,
    globalSettings,
    normalizePartKey
  } = useApp();

  const canEdit = hasPermission('cutting', true);
  const canWriteNotes = canAddCuttingNotes();
  // إرجاع الفائض متاح لمن يعدّل القص أو يعدّل مخزن القماش.
  const canReturnSurplus = canEdit || hasSpecificPermission('fabric_warehouse_edit');
  const model = models.find((m) => m.id === modelId);
  const modelReqs = requirements.filter((r) => r.model_id === modelId);
  const modelCuttingRecords = cuttingRecords.filter((r) => r.model_id === modelId);

  // Approved sizes for the model (from its size category) + the category name itself.
  const modelSizes = getModelSizeList(modelId);
  const sizeCategoryName =
    (model && sizeDefs.find((s) => s.id === model.size_category_id)?.name) || '';

  // Garment parts for this model — each part is cut & counted independently.
  const modelParts = getModelParts(modelId);
  // Per-part stages: a part that already left cutting can never be finished again.
  const partStages = getPartStages(modelId);
  const isPartCuttingCompleted = (part: GarmentPart) => stageBeyond(partStages[part], 'cutting');
  const isAllCuttingCompleted = modelParts.every((part) => isPartCuttingCompleted(part));
  const [selectedPart, setSelectedPart] = useState<GarmentPart>(
    () => modelParts[0] || 'shirt'
  );
  const partRecords = modelCuttingRecords.filter(
    (r) => normalizePartKey(r.part_type || r.partType || 'shirt') === selectedPart
  );
  const isSubCutRecord = (rec: (typeof modelCuttingRecords)[number]) =>
    Boolean(rec.is_sub_cut ?? rec.isSubCut ?? false);
  // الفرشات الأساسية وحدها تُجمع على عدد القطع؛ القصّات/الأجزاء الفرعية للقماش فقط.
  const basicPartRecords = partRecords.filter((rec) => !isSubCutRecord(rec));
  const subCutPartRecords = partRecords.filter((rec) => isSubCutRecord(rec));

  // ألوان هذه القطعة وحدها (لا تُخلط مطلقاً مع ألوان قطعة أخرى في نفس الموديل).
  const partColors = getModelColorList(modelId, selectedPart);
  const hasRegisteredColors = partColors.length > 0;
  const availableColors: string[] = hasRegisteredColors
    ? partColors
    : model
      ? [`اللون الأساسي (${model.model_code})`]
      : [];

  const handleSelectPart = (part: GarmentPart) => {
    setSelectedPart(part);
    setSubCutLabel('');
    const colors = getModelColorList(modelId, part);
    const firstColor = colors[0] || (model ? `اللون الأساسي (${model.model_code})` : '');
    setSpreadLayers([
      {
        color_name: firstColor,
        layers_count: 50,
        layer_weight: 0,
        shade_degree: '',
        isCustomColor: false
      }
    ]);
  };

  // State for "Add Spread" (إضافة فرشة) panel
  const [isAddingSpread, setIsAddingSpread] = useState<boolean>(true);
  const [spreaderName, setSpreaderName] = useState<string>('');
  const [spreadLayers, setSpreadLayers] = useState<SpreadLayerRow[]>([
    {
      color_name: availableColors[0] || '',
      layers_count: 50,
      layer_weight: 0,
      shade_degree: '',
      isCustomColor: false
    }
  ]);
  const [customColorInput, setCustomColorInput] = useState<string>('');
  const [piecesPerLayer, setPiecesPerLayer] = useState<number>(4);
  const [layerWeight, setLayerWeight] = useState<number>(1.5);
  const [cutterName, setCutterName] = useState<string>('');
  const [shadeDegree, setShadeDegree] = useState<string>('');
  const [cuttingNotes, setCuttingNotes] = useState<string>('');
  // نوع الفرشة: قطعة أساسية (تُجمع على العدد) أو قصة / جزء فرعي (قماش ووزن فقط).
  const [isSubCut, setIsSubCut] = useState<boolean>(false);
  const [subCutLabel, setSubCutLabel] = useState<string>('');
  // نافذة تعديل فرشة قائمة (تعديل كامل لكل بياناتها: النوع، الأسماء، الألوان، الأوزان، الملاحظات).
  const [editingRecord, setEditingRecord] = useState<CuttingRecord | null>(null);

  // إبقاء القطعة المختارة ضمن قطع الموديل الفعلية (بعد أي تعديل في التصميم)
  // وإعادة ضبط ألوان الفرشة على ألوان هذه القطعة فقط.
  useEffect(() => {
    if (modelParts.length > 0 && !modelParts.includes(selectedPart)) {
      handleSelectPart(modelParts[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelParts.join('|'), selectedPart]);

  // حالة إرجاع فائض القماش إلى المخزن (إدخال مباشر داخل بطاقة كل بند)
  const [surplusDrafts, setSurplusDrafts] = useState<Record<string, SurplusDraft>>({});
  const [returningSurplusReqId, setReturningSurplusReqId] = useState<string | null>(null);

  if (!model) {
    return (
      <div className="bg-white rounded-3xl p-8 text-center text-slate-500 border border-slate-200">
        <p className="font-bold text-lg text-slate-700">الموديل غير موجود</p>
        <button
          onClick={onBack}
          className="mt-4 px-6 py-2 rounded-full bg-slate-900 text-white font-bold text-xs"
        >
          العودة لقائمة القص
        </button>
      </div>
    );
  }

  // البنود المصروفة للقص والتي ما زال لها رصيد قابل للإرجاع كمخزون.
  const returnableReqs = modelReqs.filter((r) => Number(r.planned_quantity) > 0);

  const roundQty = (value: number): number => Math.round((Number(value) || 0) * 100) / 100;

  /**
   * يحسب كمية القماش المستهلكة فعلياً لهذا البند من سجلات الفرشات:
   * مجموع (عدد راقات اللون × وزن الراق) عبر كل فرشات الموديل لنفس القطعة واللون.
   */
  const consumedInSpreadsForReq = (req: ModelRequirement): number => {
    const part = normalizePartKey(req.part_name);
    const color = fabricColors.find((c) => c.id === req.color_id);
    if (!color) return 0;
    const code = String(color.color_code || '').trim();
    const name = String(color.color_name || '').trim();
    const canonical = name ? `${code} - ${name}` : code;
    // مطابقة دقيقة لاسم لون الطبقة مع لون المتطلب (بدون startsWith/includes حتى لا يتداخل C1 مع C10).
    const codeNorm = code.toLowerCase();
    const nameNorm = name.toLowerCase();
    const canonicalNorm = canonical.toLowerCase();
    const matchesColor = (layerName?: string | null): boolean => {
      const value = String(layerName || '').trim();
      if (!value) return false;
      const valNorm = value.toLowerCase();
      if (canonicalNorm && valNorm === canonicalNorm) return true;
      if (codeNorm && valNorm === codeNorm) return true;
      if (nameNorm && valNorm === nameNorm) return true;
      // صيغة "CODE - NAME" أو "CODE — NAME": نطابق الجزء قبل الشرطة بالضبط مع الكود.
      const dashParts = valNorm.split(/\s*[-–—]\s*/);
      if (dashParts.length >= 2) {
        const partCode = dashParts[0].trim();
        const partName = dashParts.slice(1).join(' - ').trim();
        if (codeNorm && partCode === codeNorm) {
          if (!nameNorm || partName === nameNorm) return true;
        }
      }
      return false;
    };
    let consumed = 0;
    modelCuttingRecords.forEach((record) => {
      const recordPart = record.part_type || record.partType || record.part;
      if (normalizePartKey(recordPart) !== part) return;
      const recordWeight = Number(record.layer_weight ?? record.layerWeight ?? 0) || 0;
      const layers = record.color_layers || record.colorLayers || [];
      if (layers.length === 0) {
        // سجلات قديمة/مبسطة تحمل اللون والوزن على مستوى الفرشة نفسها.
        if (matchesColor(record.color_name || record.colorName)) {
          const count = Number(record.layers_count ?? record.layersCount ?? 0) || 0;
          consumed += count * recordWeight;
        }
        return;
      }
      layers.forEach((layer) => {
        if (!matchesColor(layer.color_name || layer.colorName)) return;
        const count = Number(layer.layers_count ?? layer.layersCount ?? 0) || 0;
        // وزن الراق يُسجل على مستوى الطبقة، ويسقط على وزن الفرشة في السجلات القديمة.
        const weight = Number(layer.layer_weight ?? layer.layerWeight ?? 0) || recordWeight;
        consumed += count * weight;
      });
    });
    return roundQty(consumed);
  };

  const emptySurplusDraft: SurplusDraft = { defect: '0', net: '', notes: '' };
  const getSurplusDraft = (reqId: string): SurplusDraft => surplusDrafts[reqId] || emptySurplusDraft;

  const setSurplusDraftField = (reqId: string, patch: Partial<SurplusDraft>) =>
    setSurplusDrafts((prev) => ({
      ...prev,
      [reqId]: { ...(prev[reqId] || emptySurplusDraft), ...patch }
    }));

  /**
   * تفصيل الفائض لكل بند:
   * المصروف = planned_quantity الحالي، المستهلك = من الفرشات،
   * صافي الفائض الافتراضي = المصروف - المستهلك - العيوب (قابل للتعديل).
   */
  const surplusBreakdownFor = (req: ModelRequirement) => {
    const issued = roundQty(Math.max(0, Number(req.planned_quantity) || 0));
    const consumed = consumedInSpreadsForReq(req);
    const draft = getSurplusDraft(req.id);
    const defect = Math.max(0, roundQty(Number(draft.defect) || 0));
    const defaultNet = roundQty(Math.max(0, issued - consumed - defect));
    const net = draft.net.trim() === '' ? defaultNet : Math.max(0, roundQty(Number(draft.net) || 0));
    const color = fabricColors.find((c) => c.id === req.color_id);
    const unit = (color ? fabrics.find((f) => f.id === color.fabric_id)?.unit : '') || '';
    const isValid = net + defect > 0 && net + defect <= issued + 0.000001;
    return { issued, consumed, defect, defaultNet, net, unit, draft, isValid };
  };

  /** تغيير كمية العيوب يعيد حساب صافي الفائض تلقائياً (المصروف - المستهلك - العيوب). */
  const handleSurplusDefectChange = (req: ModelRequirement, value: string) => {
    const breakdown = surplusBreakdownFor(req);
    const defect = Math.max(0, roundQty(Number(value) || 0));
    const nextNet = roundQty(Math.max(0, breakdown.issued - breakdown.consumed - defect));
    setSurplusDraftField(req.id, { defect: value, net: String(nextNet) });
  };

  const handleReturnSurplus = async (req: ModelRequirement) => {
    if (returningSurplusReqId) return;
    const breakdown = surplusBreakdownFor(req);
    if (!breakdown.isValid) return;
    setReturningSurplusReqId(req.id);
    const result = await returnFabricFromCutting(
      modelId,
      req.id,
      breakdown.net,
      canWriteNotes ? breakdown.draft.notes.trim() : '',
      breakdown.defect
    );
    setReturningSurplusReqId(null);
    if (result.success) {
      setSurplusDrafts((prev) => {
        const next = { ...prev };
        delete next[req.id];
        return next;
      });
    }
  };

  /** حذف فرشة قص نهائياً بعد تأكيد المستخدم (يُعاد حساب القطع وفائض القماش تلقائياً). */
  const handleDeleteRecord = (rec: CuttingRecord) => {
    const spreadNum = rec.spread_number ?? rec.spreadNumber ?? '';
    if (
      !window.confirm(
        `هل أنت متأكد من حذف فرشة القص #${spreadNum} نهائياً؟\nسيتم إعادة حساب أعداد القطع المقصوصة وفائض القماش تلقائياً.`
      )
    ) {
      return;
    }
    deleteCuttingRecord(rec.id);
  };

  const handleAddColorRow = () => {
    // يختار تلقائياً أول لون من ألوان القطعة المختارة لم يُستخدم في الصفوف السابقة.
    const nextColor =
      availableColors.find((c) => !spreadLayers.some((l) => l.color_name === c)) ||
      availableColors[0] ||
      '';
    setSpreadLayers((prev) => [
      ...prev,
      {
        color_name: nextColor,
        layers_count: 40,
        layer_weight: 0,
        shade_degree: '',
        isCustomColor: false
      }
    ]);
  };

  /** اختيار لون من القائمة الصريحة أو تفعيل الكتابة اليدوية للون غير المسجل. */
  const handleColorSelectChange = (index: number, value: string) => {
    if (value === CUSTOM_COLOR_OPTION) {
      setSpreadLayers((prev) =>
        prev.map((row, idx) =>
          idx === index ? { ...row, isCustomColor: true, color_name: '' } : row
        )
      );
      return;
    }
    setSpreadLayers((prev) =>
      prev.map((row, idx) =>
        idx === index ? { ...row, isCustomColor: false, color_name: value } : row
      )
    );
  };

  const handleAddCustomColorRow = () => {
    if (!customColorInput.trim()) return;
    setSpreadLayers((prev) => [
      ...prev,
      {
        color_name: customColorInput.trim(),
        layers_count: 40,
        layer_weight: 0,
        shade_degree: '',
        isCustomColor: true
      }
    ]);
    setCustomColorInput('');
  };

  const handleRemoveColorRow = (index: number) => {
    if (spreadLayers.length <= 1) return;
    setSpreadLayers((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleLayerChange = (
    index: number,
    field: keyof CuttingSpreadLayer,
    value: string | number
  ) => {
    setSpreadLayers((prev) =>
      prev.map((row, idx) => (idx === index ? { ...row, [field]: value } : row))
    );
  };

  const currentSpreadTotalLayers = spreadLayers.reduce(
    (sum, item) => sum + (Number(item.layers_count) || 0),
    0
  );

  // Automatic calculation: عدد القطع المقصوصة = عدد الراقات × عدد القطع في الراق
  const calculatedPiecesCount =
    currentSpreadTotalLayers * (Number(piecesPerLayer) > 0 ? Number(piecesPerLayer) : 0);

  const handleSubmitSpread = (e: React.FormEvent) => {
    e.preventDefault();
    const validLayers = spreadLayers.filter(
      (l) => l.color_name.trim() !== '' && Number(l.layers_count) > 0
    );

    if (!spreaderName.trim()) {
      alert('يرجى إدخال اسم الشخص الذي قام بالفرش (الفَرّاش)!');
      return;
    }
    if (validLayers.length === 0) {
      alert('يرجى إضافة لون واحد وعدد راقات أكبر من صفر داخل الفرشة!');
      return;
    }
    if (!piecesPerLayer || Number(piecesPerLayer) <= 0) {
      alert('يرجى إدخال عدد القطع في الراق (يجب أن يكون أكبر من صفر)!');
      return;
    }
    if (!layerWeight || Number(layerWeight) <= 0) {
      alert('يرجى إدخال وزن الراق الواحد (مطلوب لحسابات التكلفة والتسعير)!');
      return;
    }
    if (!cutterName.trim()) {
      alert('يرجى إدخال اسم المقصدار / القاصص للفرشة بالكامل!');
      return;
    }

    addCuttingRecord({
      modelId,
      // يتم توليد رقم الفرشة تلقائياً على الباك إند داخل قفل الموديل لمنع أي تكرار.
      spreadNumber: undefined as unknown as number,
      partType: selectedPart,
      isSubCut,
      subCutLabel: subCutLabel.trim(),
      spreaderName: spreaderName.trim(),
      cutterName: cutterName.trim(),
      // لا نحفظ علم isCustomColor (خاص بالواجهة فقط).
      colorLayers: validLayers.map(
        ({ color_name, layers_count, layer_weight, shade_degree }) => ({
          color_name,
          layers_count,
          layer_weight,
          shade_degree
        })
      ),
      layersCount: currentSpreadTotalLayers,
      piecesPerLayer: Number(piecesPerLayer),
      layerWeight: Number(layerWeight),
      piecesCount: calculatedPiecesCount,
      shadeDegree: shadeDegree.trim(),
      notes: canWriteNotes ? cuttingNotes.trim() : ''
    });

    // Reset for next spread
    setSpreadLayers([
      {
        color_name: availableColors[0] || '',
        layers_count: 50,
        layer_weight: 0,
        shade_degree: '',
        isCustomColor: false
      }
    ]);
    setShadeDegree('');
    setCuttingNotes('');
  };

  const handleFinishCutting = (parts?: GarmentPart[]) => {
    const requestedParts = parts && parts.length > 0 ? parts : modelParts;
    // فقط القطع التي ما زالت فعلياً في مرحلة القص قابلة للإنهاء.
    const targetParts = requestedParts.filter((part) => !isPartCuttingCompleted(part));
    if (targetParts.length === 0) {
      alert('تم إنهاء قص هذه القطع وتحويلها للمرحلة التالية مسبقاً ولا يمكن إعادة تحويلها.');
      return;
    }

    // التحقق من كل قطعة على حدة: لا يُسمح بإنهاء وترحيل أي قطعة عدد قطعها المقصوصة = 0.
    const emptyParts = targetParts.filter((part) => {
      const partCutPieces = modelCuttingRecords
        .filter(
          (r) =>
            ((r.part_type || r.partType || 'shirt') as GarmentPart) === part &&
            !isSubCutRecord(r)
        )
        .reduce((sum, r) => sum + (Number(r.pieces_count ?? r.piecesCount ?? 0) || 0), 0);
      return partCutPieces <= 0;
    });
    if (emptyParts.length > 0) {
      const emptyLabels = emptyParts.map((part) => getPartLabel(part)).join(' / ');
      alert(
        `لا يمكن إنهاء قص (${emptyLabels}) لأن عدد القطع المقصوصة يساوي 0! يرجى تسجيل فرشة قص أساسية لكل قطعة أولاً.`
      );
      return;
    }

    const partsLabel = targetParts.map((part) => getPartLabel(part)).join(' + ');
    if (
      !window.confirm(
        `هل أنت متأكد من إنهاء قص [${partsLabel}] وتحويلها للفرز والكنترول (العد قبل الطباعة)?`
      )
    ) {
      return;
    }

    finishCuttingToQC(modelId, canWriteNotes ? cuttingNotes.trim() : '', targetParts);

    // Stay on the screen while other parts are still in cutting.
    const remainingParts = modelParts.filter(
      (part) => !targetParts.includes(part) && !isPartCuttingCompleted(part)
    );
    if (remainingParts.length === 0) {
      onFinishedToQC();
    }
  };

  const handlePrintCuttingOrder = () => {
    printCuttingOrder({
      siteName: globalSettings?.site_name,
      logo: globalSettings?.logo,
      modelCode: model.model_code,
      modelType: model.model_type,
      targetQuantity: model.target_cut_quantity,
      sizes: modelSizes,
      sizeCategoryName,
      imageUrl: model.image,
      designNotes: model.design_notes,
      cutterName: cutterName.trim() || undefined
    });
  };

  // Totals are per selected part — parts are never summed into one number.
  // القطع المقصوصة من الفرشات الأساسية فقط؛ القصّات الفرعية تُحسب قماشاً ووزناً.
  const totalPiecesProduced = basicPartRecords.reduce(
    (sum, r) => sum + (r.pieces_count || 0),
    0
  );
  const subCutPieces = subCutPartRecords.reduce(
    (sum, r) => sum + (r.pieces_count || 0),
    0
  );
  const totalLayers = partRecords.reduce(
    (sum, r) => sum + (r.layers_count || 0),
    0
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Return link */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-extrabold text-rose-600 hover:text-rose-800 transition cursor-pointer"
        >
          <ArrowRight className="w-4 h-4" />
          <span>← العودة لقائمة القص</span>
        </button>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handlePrintCuttingOrder}
            title="طباعة ورقة أوردر القص الرسمية"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs shadow-md shadow-slate-900/20 transition cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>🖨️ طباعة أوردر القص</span>
          </button>

          {canEdit && (
            <button
              type="button"
              onClick={() => setIsAddingSpread((prev) => !prev)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs shadow-md shadow-rose-600/20 transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ إضافة فرشة جديدة (Add Spread)</span>
            </button>
          )}
        </div>
      </div>

      {/* Garment part selector — each part is cut & counted independently */}
      <div className="flex items-center gap-2 flex-wrap bg-white rounded-2xl border border-slate-200/80 px-4 py-3 shadow-xs">
        <span className="text-xs font-extrabold text-slate-500">القطعة:</span>
        {modelParts.map((part) => (
          <button
            key={part}
            type="button"
            onClick={() => handleSelectPart(part)}
            className={`px-4 py-1.5 rounded-full text-xs font-bold border transition cursor-pointer ${
              selectedPart === part
                ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                : 'bg-white text-slate-600 border-slate-300 hover:border-rose-400'
            }`}
          >
            {getPartLabel(part)}
            <span className="ms-1.5 text-[10px] opacity-90">
              ({Number(model.cut_summary?.[part] ?? 0).toLocaleString('ar-EG')} من {Number(model.target_cut_quantity || 0).toLocaleString('ar-EG')})
            </span>
          </button>
        ))}
        <span className="ms-auto text-[11px] font-bold text-rose-700">
          إجمالي هذه القطعة: {totalPiecesProduced.toLocaleString('ar-EG')} قطعة
        </span>
      </div>

      {/* TOP INFORMATIONAL CARD */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/90 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0 shadow-xs">
            <ZoomableImage
              src={model.image}
              alt={model.model_code}
              downloadName={`${model.model_code}.jpg`}
              className="w-full h-full object-contain bg-white"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                موديل: {model.model_code}
              </h1>
              <span className="px-3 py-0.5 rounded-full text-xs font-black bg-rose-50 text-rose-700 border border-rose-200">
                {model.status}
              </span>
              {isAllCuttingCompleted && (
                <EndedModelBadge currentStage={currentStageLabel(model)} />
              )}
            </div>

            <p className="text-xs text-slate-500 font-semibold">
              النوع والتصنيف:{' '}
              <strong className="text-slate-800">{model.model_type || 'أولادي'}</strong>
            </p>

            {/* Approved sizes for the model (Sizes Badges) */}
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-slate-500">
                <Ruler className="w-3.5 h-3.5 text-rose-600" />
                المقاسات المعتمدة:
              </span>
              {sizeCategoryName && (
                <span className="px-2.5 py-0.5 rounded-full bg-rose-600 text-white text-[11px] font-black border border-rose-700">
                  {sizeCategoryName}
                </span>
              )}
              {modelSizes.length > 0 ? (
                modelSizes.map((s) => (
                  <span
                    key={s}
                    className="px-2.5 py-0.5 rounded-lg bg-rose-50 text-rose-800 border border-rose-200 text-[11px] font-black"
                  >
                    {s}
                  </span>
                ))
              ) : (
                <span className="text-[11px] font-bold text-slate-400">غير محددة</span>
              )}
            </div>

            {/* Design & Marker Details */}
            <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
              {model.main_marker_url && (
                <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-mono font-bold border border-slate-200">
                  ماركر القص: {model.main_marker_url}
                </span>
              )}
              {model.print_marker_url && (
                <span className="px-2.5 py-1 rounded-lg bg-teal-50 text-teal-800 font-mono font-bold border border-teal-200">
                  ماركر الطباعة: {model.print_marker_url}
                </span>
              )}
              {model.notes_shirt && (
                <span
                  className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-800 font-bold border border-blue-200 line-clamp-1 max-w-[220px]"
                  title={model.notes_shirt}
                >
                  ملاحظات تيشرت: {model.notes_shirt}
                </span>
              )}
              {model.notes_pants && (
                <span
                  className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-800 font-bold border border-indigo-200 line-clamp-1 max-w-[220px]"
                  title={model.notes_pants}
                >
                  ملاحظات بنطلون: {model.notes_pants}
                </span>
              )}
              {model.notes_jacket && (
                <span
                  className="px-2.5 py-1 rounded-lg bg-violet-50 text-violet-800 font-bold border border-violet-200 line-clamp-1 max-w-[220px]"
                  title={model.notes_jacket}
                >
                  ملاحظات جاكيت: {model.notes_jacket}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Target Cut Quantity & Progress Card */}
        <div className="bg-gradient-to-r from-rose-50 to-pink-50 p-4 rounded-2xl border-2 border-rose-200 min-w-[260px] text-center shrink-0 w-full md:w-auto">
          <div className="flex items-center justify-between text-xs font-bold text-rose-900 mb-1">
            <span>العدد المستهدف للقص:</span>
            <span className="text-lg font-black text-rose-950 font-mono">
              {model.target_cut_quantity || 100} قطعة
            </span>
          </div>

          <div className="w-full bg-rose-200 h-2.5 rounded-full overflow-hidden my-2">
            <div
              className="bg-rose-600 h-full rounded-full transition-all duration-300"
              style={{
                width: `${Math.min(
                  100,
                  (totalPiecesProduced / (model.target_cut_quantity || 1)) * 100
                )}%`
              }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] font-extrabold text-slate-600">
            <span>
              المنفذ حتى الآن:{' '}
              <strong className="text-rose-700 font-black">{totalPiecesProduced}</strong>
            </span>
            <span>
              عدد الفرشات:{' '}
              <strong className="text-rose-800">{basicPartRecords.length}</strong>
              {subCutPartRecords.length > 0 && (
                <span className="text-amber-700 font-black">
                  {' '}
                  (+{subCutPartRecords.length} فرعية)
                </span>
              )}
            </span>
            <span>
              الإنجاز:{' '}
              {Math.round(
                (totalPiecesProduced / (model.target_cut_quantity || 1)) * 100
              )}
              %
            </span>
          </div>
        </div>
      </div>

      {/* Design Notes Card — notes written for the model in the Design section */}
      {model.design_notes && (
        <div className="bg-amber-50/70 rounded-3xl border border-amber-200 p-4 shadow-xs flex items-start gap-3">
          <span className="w-9 h-9 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0">
            <StickyNote className="w-4 h-4 text-amber-700" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-black text-amber-800 mb-1">📝 ملاحظات التصميم</p>
            <p className="text-sm font-bold text-slate-800 whitespace-pre-wrap break-words leading-relaxed">
              {model.design_notes}
            </p>
          </div>
        </div>
      )}

      {/* Surplus Fabric Return Card — إرجاع ما لم يُستخدم من الأقمشة المصروفة للقص */}
      {returnableReqs.length > 0 && (
        <div className="bg-white rounded-3xl p-5 border border-emerald-200/90 shadow-xs">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-emerald-100 border border-emerald-200 flex items-center justify-center shrink-0">
                <RotateCcw className="w-4 h-4 text-emerald-700" />
              </span>
              <div>
                <h2 className="text-sm font-black text-emerald-900">
                  ↩️ إرجاع فائض الأقمشة إلى المخزن
                </h2>
                <p className="text-[11px] font-bold text-slate-500">
                  يُحسب المستهلك تلقائياً من الفرشات المسجلة — عدّل العيوب وصافي الفائض ثم أرجعه للمخزن
                </p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-black">
              {returnableReqs.length.toLocaleString('ar-EG')} بند قابل للإرجاع
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {returnableReqs.map((req) => {
              const col = fabricColors.find((c) => c.id === req.color_id);
              const fab = col ? fabrics.find((f) => f.id === col.fabric_id) : undefined;
              const { issued, consumed, net, unit, draft, isValid } = surplusBreakdownFor(req);
              const isBusy = returningSurplusReqId === req.id;
              const fmtQty = (value: number) =>
                value.toLocaleString('ar-EG', { maximumFractionDigits: 2 });
              return (
                <div
                  key={req.id}
                  className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-3 flex flex-col gap-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-[11px] font-black text-emerald-950 truncate">
                      {fab?.name || 'خامة غير معروفة'}
                      {col ? (
                        <span className="text-emerald-700 font-bold">
                          {' '}• {col.color_code}
                          {col.color_name ? ` (${col.color_name})` : ''}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[10px] font-bold text-slate-500">{req.part_name}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 text-center">
                    <div className="rounded-lg bg-white border border-slate-200 px-2 py-1.5">
                      <p className="text-[9px] font-bold text-slate-500">المصروف للقص</p>
                      <p className="text-[12px] font-black text-slate-800">
                        {fmtQty(issued)} {unit}
                      </p>
                    </div>
                    <div className="rounded-lg bg-white border border-rose-200 px-2 py-1.5">
                      <p className="text-[9px] font-bold text-slate-500">المستهلك في الفرشات</p>
                      <p className="text-[12px] font-black text-rose-700">
                        {fmtQty(consumed)} {unit}
                      </p>
                    </div>
                  </div>

                  {canReturnSurplus ? (
                    <>
                      <div className="grid grid-cols-2 gap-1.5">
                        <label className="block">
                          <span className="block text-[10px] font-extrabold text-amber-800 mb-1">
                            عيوب القماش ({unit || 'وحدة'})
                          </span>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={draft.defect}
                            onChange={(event) => handleSurplusDefectChange(req, event.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-amber-300 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none text-xs font-black text-slate-800 bg-white"
                          />
                        </label>
                        <label className="block">
                          <span className="block text-[10px] font-extrabold text-emerald-800 mb-1">
                            صافي الفائض للإرجاع
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={issued}
                            step="0.01"
                            value={net}
                            onChange={(event) => setSurplusDraftField(req.id, { net: event.target.value })}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-emerald-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none text-xs font-black text-slate-800 bg-white"
                          />
                        </label>
                      </div>

                      {canWriteNotes && (
                        <input
                          type="text"
                          value={draft.notes}
                          onChange={(event) => setSurplusDraftField(req.id, { notes: event.target.value })}
                          placeholder="ملاحظات الإرجاع (اختياري)"
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none text-[11px] font-bold text-slate-700 bg-white"
                        />
                      )}

                      {!isValid && (
                        <p className="text-[9px] font-bold text-rose-600">
                          يجب أن يكون (صافي الفائض + العيوب) أكبر من صفر ولا يتجاوز المصروف.
                        </p>
                      )}

                      <button
                        type="button"
                        onClick={() => handleReturnSurplus(req)}
                        disabled={!isValid || !!returningSurplusReqId}
                        className="inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-extrabold transition cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>{isBusy ? 'جارٍ الإرجاع...' : 'إرجاع الفائض للمخزن'}</span>
                      </button>
                    </>
                  ) : (
                    <p className="text-[10px] font-bold text-slate-400">
                      🔒 إرجاع الفائض يتطلب صلاحية تعديل القص أو تعديل مخزن القماش.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Col 5: Spread (الفرشة) Input Form */}
        <div className="lg:col-span-5 bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs border-t-4 border-t-rose-600 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-extrabold text-rose-600 flex items-center gap-2">
                <Layers className="w-5 h-5" />
                <span>
                  📝 تسجيل فرشة قص جديدة — {getPartLabel(selectedPart)} (فرشة #{partRecords.length + 1})
                </span>
              </h2>
              <span className="px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[11px] font-black">
                نظام الفرشات
              </span>
            </div>

            {canEdit ? (
              isAddingSpread ? (
                <form onSubmit={handleSubmitSpread} className="space-y-4">
                  {/* Step 0: Which garment part this spread belongs to */}
                  {modelParts.length > 1 && (
                    <div className="p-3.5 rounded-2xl bg-rose-50/60 border border-rose-200 space-y-2">
                      <label className="block text-xs font-extrabold text-rose-900">
                        0️⃣ هذه الفرشة خاصة بـ
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {modelParts.map((part) => (
                          <button
                            key={part}
                            type="button"
                            onClick={() => handleSelectPart(part)}
                            className={`px-4 py-1.5 rounded-full text-xs font-bold border transition cursor-pointer ${
                              selectedPart === part
                                ? 'bg-rose-600 text-white border-rose-600'
                                : 'bg-white text-slate-600 border-slate-300 hover:border-rose-400'
                            }`}
                          >
                            {getPartLabel(part)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Step 0.5: نوع الفرشة — قطعة أساسية أم قصة / جزء فرعي */}
                  <div className="p-3.5 rounded-2xl bg-amber-50/70 border border-amber-300 space-y-2">
                    <label className="block text-xs font-extrabold text-amber-950">
                      نوع هذه الفرشة
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setIsSubCut(false)}
                        className={`px-3 py-2 rounded-xl text-xs font-extrabold border transition cursor-pointer ${
                          !isSubCut
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                            : 'bg-white text-slate-600 border-slate-300 hover:border-emerald-400'
                        }`}
                      >
                        🧵 قطعة أساسية (تُجمع على العدد)
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsSubCut(true)}
                        className={`px-3 py-2 rounded-xl text-xs font-extrabold border transition cursor-pointer ${
                          isSubCut
                            ? 'bg-amber-500 text-white border-amber-500 shadow-xs'
                            : 'bg-white text-slate-600 border-slate-300 hover:border-amber-400'
                        }`}
                      >
                        🧩 قصة / جزء فرعي (قماش فقط)
                      </button>
                    </div>
                    {isSubCut && (
                      <>
                        <input
                          type="text"
                          value={subCutLabel}
                          onChange={(e) => setSubCutLabel(e.target.value)}
                          placeholder={`اسم القصة الفرعية (مثال: قصة ${getPartLabel(selectedPart)})`}
                          className="w-full px-3 py-2 rounded-xl bg-white border border-amber-300 text-xs font-bold focus:ring-2 focus:ring-amber-500 focus:outline-hidden"
                        />
                        <p className="text-[10px] font-bold text-amber-800 leading-relaxed">
                          ⚠️ قماش ووزن هذه الفرشة يُحسبان في مخزون القماش والتكلفة، لكن قطعها
                          لا تُضاف إلى العدد المقصوص ولا إلى تقارير الإنتاج ولا خانات العد التلقائي.
                        </p>
                      </>
                    )}
                  </div>

                  {/* Step 1: Spreader Name (اسم الشخص الذي قام بالفرش) */}
                  <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/90 space-y-2">
                    <label className="block text-xs font-extrabold text-slate-800">
                      1️⃣ اسم الشخص الذي قام بالفرش (الفَرّاش - Spreader) *
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        required
                        value={spreaderName}
                        onChange={(e) => setSpreaderName(e.target.value)}
                        placeholder="اكتب اسم عامل الفرش المسؤول عن هذه الفرشة..."
                        className="w-full px-4 py-2.5 rounded-xl bg-white border border-slate-300 text-xs font-bold focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
                      />
                      <User className="w-4 h-4 text-slate-400 absolute end-3 top-1/2 -translate-y-1/2" />
                    </div>
                  </div>

                  {/* Step 2: Colors and Layers inside this Spread (الألوان وعدد الراقات داخل الفرشة) */}
                  <div className="p-4 rounded-2xl bg-rose-50/40 border border-rose-200/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-extrabold text-rose-950 flex items-center gap-1.5">
                        <Palette className="w-4 h-4 text-rose-600" />
                        <span>2️⃣ الألوان وعدد الراقات في هذه الفرشة *</span>
                      </label>
                      <button
                        type="button"
                        onClick={handleAddColorRow}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold transition cursor-pointer shadow-2xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>إضافة لون بالفرشة</span>
                      </button>
                    </div>

                    <div className="space-y-2.5">
                      {spreadLayers.map((layerRow, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-xl bg-white border border-rose-200/80 shadow-2xs flex flex-col gap-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-black text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
                              اللون #{idx + 1}
                            </span>
                            {spreadLayers.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveColorRow(idx)}
                                className="text-slate-400 hover:text-rose-600 transition p-1 cursor-pointer"
                                title="حذف هذا اللون من الفرشة"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                            <div className="sm:col-span-7">
                              <label className="block text-[10px] font-bold text-slate-500 mb-1">
                                اللون / القطعة ({getPartLabel(selectedPart)})
                              </label>
                              {(layerRow.isCustomColor ||
                                (!!layerRow.color_name &&
                                  !availableColors.includes(layerRow.color_name))) ? (
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    autoFocus
                                    required
                                    value={layerRow.color_name}
                                    onChange={(e) =>
                                      handleLayerChange(idx, 'color_name', e.target.value)
                                    }
                                    placeholder="اكتب اللون يدوياً (مثال: كحلي غامق)..."
                                    className="w-full px-3 py-2 rounded-lg border border-amber-300 bg-amber-50/40 text-xs font-bold focus:ring-2 focus:ring-amber-500 focus:outline-hidden"
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSpreadLayers((prev) =>
                                        prev.map((row, i) =>
                                          i === idx
                                            ? {
                                                ...row,
                                                isCustomColor: false,
                                                color_name: availableColors[0] || ''
                                              }
                                            : row
                                        )
                                      )
                                    }
                                    title="الرجوع لألوان هذه القطعة"
                                    className="shrink-0 px-2 py-2 rounded-lg bg-white border border-slate-300 text-slate-500 hover:text-rose-600 text-[10px] font-bold cursor-pointer"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <select
                                  required
                                  value={layerRow.color_name}
                                  onChange={(e) => handleColorSelectChange(idx, e.target.value)}
                                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold focus:ring-2 focus:ring-rose-500 focus:outline-hidden bg-white"
                                >
                                  <option value="">-- اختر لون من ألوان هذه القطعة --</option>
                                  {availableColors.map((colOption) => (
                                    <option key={colOption} value={colOption}>
                                      {colOption}
                                    </option>
                                  ))}
                                  <option value={CUSTOM_COLOR_OPTION}>
                                    ✏️ كتابة لون آخر يدوياً...
                                  </option>
                                </select>
                              )}
                              {!hasRegisteredColors && (
                                <span className="block mt-1 text-[10px] font-bold text-amber-700">
                                  ⚠️ لا توجد ألوان مسجلة لهذه القطعة في التصميم — أضفها من شاشة
                                  الموديل أو اكتب اللون يدوياً.
                                </span>
                              )}
                            </div>

                            <div className="sm:col-span-5">
                              <label className="block text-[10px] font-bold text-slate-500 mb-1">
                                عدد الراقات (مثال: 50 راق)
                              </label>
                              <input
                                type="number"
                                min="1"
                                required
                                value={layerRow.layers_count || ''}
                                onChange={(e) =>
                                  handleLayerChange(
                                    idx,
                                    'layers_count',
                                    parseInt(e.target.value) || 0
                                  )
                                }
                                placeholder="عدد الراقات"
                                className="w-full px-3 py-2 rounded-lg border border-rose-300 bg-rose-50/30 text-xs text-center font-black text-rose-900 focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Quick Add Custom Color bar */}
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="text"
                        value={customColorInput}
                        onChange={(e) => setCustomColorInput(e.target.value)}
                        placeholder="إضافة لون آخر سريع (مثال: كحلي، أسود)..."
                        className="flex-grow px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] focus:outline-hidden focus:border-rose-400"
                      />
                      <button
                        type="button"
                        onClick={handleAddCustomColorRow}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-[11px] font-bold cursor-pointer shrink-0"
                      >
                        + أضف للفرشة
                      </button>
                    </div>

                    <div className="pt-2 border-t border-rose-200/60 flex items-center justify-between text-xs font-extrabold text-rose-900">
                      <span>إجمالي راقات هذه الفرشة:</span>
                      <span className="px-3 py-0.5 rounded-full bg-rose-600 text-white font-black">
                        {currentSpreadTotalLayers} راق
                      </span>
                    </div>
                  </div>

                  {/* Step 3: Pieces per Layer & Total Layer Weight (Both Required!) + Auto-Calculated Cut Pieces */}
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          عدد القطع في الراق *
                        </label>
                        <input
                          type="number"
                          min="1"
                          required
                          value={piecesPerLayer || ''}
                          onChange={(e) =>
                            setPiecesPerLayer(parseInt(e.target.value) || 0)
                          }
                          placeholder="مثال: 4 قطع بالراق"
                          className="w-full px-4 py-2.5 rounded-xl border-2 border-rose-300 bg-rose-50/30 text-sm text-center font-black text-rose-900 focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          وزن الراق الواحد (كجم) *
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          required
                          value={layerWeight || ''}
                          onChange={(e) =>
                            setLayerWeight(parseFloat(e.target.value) || 0)
                          }
                          placeholder="وزن الراق للتسعير"
                          className="w-full px-4 py-2.5 rounded-xl border-2 border-blue-300 bg-blue-50/30 text-sm text-center font-black text-blue-900 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                        />
                      </div>
                    </div>

                    {/* Automatic Cut Pieces Calculation Box */}
                    <div className="p-3 rounded-2xl bg-slate-900 text-white flex items-center justify-between text-xs shadow-xs">
                      <div className="flex items-center gap-2">
                        <Calculator className="w-4 h-4 text-rose-400 shrink-0" />
                        <span>
                          {isSubCut
                            ? `قطع القصة الفرعية (قماش فقط = ${currentSpreadTotalLayers} راق × ${piecesPerLayer || 0}):`
                            : `عدد القطع المقصوصة (تلقائي = ${currentSpreadTotalLayers} راق × ${piecesPerLayer || 0} قطع بالراق):`}
                        </span>
                      </div>
                      <span className="px-3 py-1 rounded-full bg-rose-600 text-white font-black text-sm">
                        {calculatedPiecesCount} قطعة
                      </span>
                    </div>
                  </div>

                  {/* Step 4: Cutter Name at the end of the Spread details (اسم المقصدار للفرشة كلها مرة واحدة) */}
                  <div className="p-3.5 rounded-2xl bg-emerald-50/60 border-2 border-emerald-300 space-y-2">
                    <label className="block text-xs font-extrabold text-emerald-950 flex items-center gap-1.5">
                      <Scissors className="w-4 h-4 text-emerald-700" />
                      <span>
                        3️⃣ اسم المقصدار / القاصص (للفرشة بالكامل مرة واحدة) *
                      </span>
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        required
                        value={cutterName}
                        onChange={(e) => setCutterName(e.target.value)}
                        placeholder="اسم المقصدار الذي قام بقص هذه الفرشة بالكامل..."
                        className="w-full px-4 py-2.5 rounded-xl bg-white border border-emerald-400 text-xs font-black text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                      />
                      <User className="w-4 h-4 text-emerald-600 absolute end-3 top-1/2 -translate-y-1/2" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">
                      درجة الصبغة / اللوت للفرشة (اختياري)
                    </label>
                    <input
                      type="text"
                      value={shadeDegree}
                      onChange={(e) => setShadeDegree(e.target.value)}
                      placeholder="مثال: لوت 4 - صبغة متجانسة"
                      className="w-full px-4 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
                    />
                  </div>

                  {/* Optional Cutting Notes Textarea gated by canAddCuttingNotes() */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-rose-600" />
                        <span>ملاحظات الفرشة والقص (اختياري)</span>
                      </label>
                      {!canWriteNotes && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                          <Lock className="w-3 h-3" />
                          يتطلب صلاحية ملاحظات القص
                        </span>
                      )}
                    </div>
                    <textarea
                      rows={2}
                      disabled={!canWriteNotes}
                      value={cuttingNotes}
                      onChange={(e) => setCuttingNotes(e.target.value)}
                      placeholder={
                        canWriteNotes
                          ? 'أدخل أي ملاحظات حول الفرشة، عيوب القماش، أو تفاصيل القص (اختياري)...'
                          : 'ليس لديك صلاحية تسجيل ملاحظات القص'
                      }
                      className="w-full px-4 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-rose-500 focus:outline-hidden disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      className="w-full py-3.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs transition shadow-lg shadow-rose-500/20 cursor-pointer flex items-center justify-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      <span>
                        {isSubCut ? 'حفظ القصة الفرعية وإضافتها للسجل' : 'حفظ الفرشة بالكامل وإضافتها للسجل'}
                      </span>
                    </button>
                  </div>
                </form>
              ) : (
                <div className="text-center py-8">
                  <button
                    type="button"
                    onClick={() => setIsAddingSpread(true)}
                    className="px-6 py-3 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-md cursor-pointer"
                  >
                    + فتح نموذج إضافة فرشة جديدة
                  </button>
                </div>
              )
            ) : (
              <p className="text-xs text-slate-400">
                عرض فقط - الصلاحية غير متوفرة للتعديل
              </p>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>
              إجمالي فرشات {getPartLabel(selectedPart)}:{' '}
              <strong className="text-slate-900">{partRecords.length}</strong>
              {subCutPartRecords.length > 0 && (
                <span className="text-amber-700 font-bold">
                  {' '}
                  (أساسية {basicPartRecords.length} + قصص فرعية {subCutPartRecords.length})
                </span>
              )}
            </span>
            <span>
              مجموع الراقات:{' '}
              <strong className="text-slate-800">{totalLayers}</strong>
            </span>
            <span>
              إجمالي القطع:{' '}
              <strong className="text-rose-600 font-bold">{totalPiecesProduced}</strong>
            </span>
            {subCutPartRecords.length > 0 && (
              <span className="text-amber-700">
                قطع القصص الفرعية:{' '}
                <strong className="font-black">{subCutPieces}</strong> (قماش فقط)
              </span>
            )}
          </div>
        </div>

        {/* Col 7: Cutting Spreads Ledger Table */}
        <div className="lg:col-span-7 bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <h2 className="text-base font-extrabold text-slate-900">
                  سجل الفرشات المقصوصة للموديل:{' '}
                  <span className="text-rose-600">{model.model_code}</span>
                </h2>
                <span className="text-xs text-slate-500 font-semibold">
                  إجمالي فرشات {getPartLabel(selectedPart)} المسجلة: {partRecords.length} فرشة
                  {subCutPartRecords.length > 0 && (
                    <span className="text-amber-700 font-black">
                      {' '}
                      (أساسية {basicPartRecords.length} + قصص فرعية {subCutPartRecords.length})
                    </span>
                  )}
                </span>
              </div>

              {partRecords.length > 0 && (
                <button
                  type="button"
                  onClick={() => exportCuttingCsv(modelId)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>📥 تصدير سجل الفرشات Excel</span>
                </button>
              )}
            </div>

            <div className="space-y-4">
              {partRecords.length > 0 ? (
                partRecords.map((rec, idx) => {
                  const spreadNum =
                    rec.spread_number ||
                    rec.spreadNumber ||
                    partRecords.length - idx;
                  const layersList = rec.color_layers || rec.colorLayers || [];
                  const spreader =
                    rec.spreader_name || rec.spreaderName || 'غير محدد';
                  const cutter =
                    rec.cutter_name || rec.cutterName || 'غير محدد';
                  const pcsPerLay =
                    rec.pieces_per_layer ?? rec.piecesPerLayer ?? 0;

                  return (
                    <div
                      key={rec.id}
                      className="rounded-2xl border border-slate-200 bg-slate-50/50 overflow-hidden shadow-2xs"
                    >
                      {/* Spread Card Header */}
                      <div className="bg-slate-100/90 px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="px-3 py-1 rounded-full bg-rose-600 text-white text-xs font-black">
                            فرشة #{spreadNum}
                          </span>
                          <span className="text-xs font-bold text-slate-700">
                            الفَرّاش (Spreader):{' '}
                            <strong className="text-slate-950 underline decoration-rose-400">
                              {spreader}
                            </strong>
                          </span>
                          {isSubCutRecord(rec) && (
                            <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[11px] font-black">
                              🧩 قصة فرعية
                              {(rec.sub_cut_label || rec.subCutLabel)
                                ? `: ${rec.sub_cut_label || rec.subCutLabel}`
                                : ''}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 font-bold text-slate-700">
                            إجمالي الراقات:{' '}
                            <strong className="text-rose-700">
                              {rec.layers_count}
                            </strong>
                          </span>
                          {pcsPerLay > 0 && (
                            <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 font-bold text-slate-700">
                              عدد القطع في الراق:{' '}
                              <strong className="text-slate-900">
                                {pcsPerLay}
                              </strong>
                            </span>
                          )}
                          <span className="px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 font-bold text-blue-900">
                            وزن الراق الواحد:{' '}
                            <strong>{rec.layer_weight} كجم</strong>
                          </span>
                          <span
                            className={`px-3 py-1 rounded-lg font-black border ${
                              isSubCutRecord(rec)
                                ? 'bg-amber-100 text-amber-900 border-amber-300'
                                : 'bg-emerald-100 text-emerald-900 border-emerald-300'
                            }`}
                          >
                            {isSubCutRecord(rec) ? 'قطع القصة (قماش فقط): ' : 'القطع المقصوصة: '}
                            {rec.pieces_count} قطعة
                          </span>
                        </div>
                      </div>

                      {/* Colors & Layers Breakdown inside the Spread */}
                      <div className="p-4 space-y-3">
                        <div className="text-[11px] font-bold text-slate-500">
                          الألوان وعدد الراقات داخل هذه الفرشة:
                        </div>

                        {layersList.length > 0 ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                            {layersList.map((lay, lIdx) => (
                              <div
                                key={lay.id || lIdx}
                                className="px-3 py-2 rounded-xl bg-white border border-slate-200 flex items-center justify-between text-xs shadow-2xs"
                              >
                                <span className="font-bold text-slate-800 truncate">
                                  🎨 {lay.color_name || lay.colorName}
                                </span>
                                <span className="px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-800 font-black border border-rose-200 shrink-0">
                                  {lay.layers_count ?? lay.layersCount} راق
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-800">
                            {rec.color_name || 'لون أساسي'} ({rec.layers_count}{' '}
                            راق)
                          </div>
                        )}

                        {/* Spread Footer: Cutter Name & Metadata */}
                        <div className="pt-3 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-50 text-emerald-900 border border-emerald-300 font-black">
                              <Scissors className="w-3.5 h-3.5 text-emerald-700" />
                              <span>المقصدار (القاصص): {cutter}</span>
                            </span>
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() =>
                                  updateCuttingRecord(rec.id, {
                                    isSubCut: !isSubCutRecord(rec)
                                  })
                                }
                                title={
                                  isSubCutRecord(rec)
                                    ? 'إرجاع هذه الفرشة إلى قطعة أساسية وجمع قطعها على العدد'
                                    : 'تحويل هذه الفرشة إلى قصة / جزء فرعي (قماش فقط دون جمع قطعها)'
                                }
                                className={`inline-flex items-center gap-1 px-3 py-1 rounded-full border font-black text-[11px] transition cursor-pointer ${
                                  isSubCutRecord(rec)
                                    ? 'bg-white text-emerald-800 border-emerald-300 hover:bg-emerald-50'
                                    : 'bg-white text-amber-800 border-amber-300 hover:bg-amber-50'
                                }`}
                              >
                                {isSubCutRecord(rec)
                                  ? '↩️ إرجاع لقطعة أساسية'
                                  : '🧩 تحويل إلى قصة فرعية'}
                              </button>
                            )}
                            {canEdit && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setEditingRecord(rec)}
                                  title="تعديل كل بيانات الفرشة (الألوان، الراقات، الأوزان، الأسماء، الملاحظات)"
                                  className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white text-blue-800 border border-blue-300 hover:bg-blue-50 font-black text-[11px] transition cursor-pointer"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                  <span>تعديل الفرشة</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteRecord(rec)}
                                  title="حذف الفرشة نهائياً مع إعادة حساب أعداد القطع"
                                  className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white text-rose-800 border border-rose-300 hover:bg-rose-50 font-black text-[11px] transition cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>حذف</span>
                                </button>
                              </>
                            )}
                            <span className="px-2.5 py-0.5 rounded-lg bg-blue-50 text-blue-800 border border-blue-200 font-bold text-[11px]">
                              وزن الراق الواحد: {rec.layer_weight} كجم
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-500">
                            {(rec.notes || rec.shade_degree) && (
                              <span className="font-semibold text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded-lg border border-amber-200">
                                {[rec.shade_degree, rec.notes]
                                  .filter(Boolean)
                                  .join(' | ')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-12 rounded-2xl border border-dashed border-slate-200 text-slate-400">
                  <Layers className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                  <p className="font-bold text-slate-600 text-sm">
                    لم يتم تسجيل أي فرشة قص بعد لهذا الموديل.
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    استخدم النموذج الجانبي لإضافة الفرشة وتحديد الفَرّاش والألوان
                    والراقات وعدد القطع في الراق وإجمالي وزن الراق ثم اسم المقصدار.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="pt-6 mt-6 border-t border-slate-100 space-y-3">
            {canEdit && (
              <>
                <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                  <Scissors className="w-4 h-4 text-emerald-600" />
                  <span>إنهاء قص القطع بشكل مستقل (كل قطعة تنتقل للفرز على حدة):</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {modelParts.map((part) => {
                    const partSpreadCount = modelCuttingRecords.filter(
                      (r) =>
                        !isSubCutRecord(r) &&
                        normalizePartKey(r.part_type || r.partType || 'shirt') === part
                    ).length;
                    const isCompleted = isPartCuttingCompleted(part);
                    return (
                      <button
                        key={part}
                        type="button"
                        onClick={() => handleFinishCutting([part])}
                        disabled={partSpreadCount === 0 || isCompleted}
                        className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full font-extrabold text-xs border transition ${
                          isCompleted
                            ? 'bg-slate-200 text-slate-600 border-slate-300 cursor-not-allowed'
                            : partSpreadCount === 0
                            ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                            : 'bg-white text-emerald-800 border-emerald-300 hover:bg-emerald-50 cursor-pointer'
                        }`}
                      >
                        {isCompleted ? (
                          <>
                            <Lock className="w-3.5 h-3.5" />
                            <span>
                              تم إنهاء قص {getPartLabel(part)} — خرجت إلى (
                              {PART_STAGE_LABELS[(partStages[part] || 'cutting') as PartStage]})
                            </span>
                          </>
                        ) : (
                          <>
                            <span>{PART_EMOJI[part]}</span>
                            <span>إنهاء قص {getPartLabel(part)}</span>
                            <span className="text-[10px] font-bold text-slate-400">
                              ({partSpreadCount} فرشة)
                            </span>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
                {isAllCuttingCompleted ? (
                  <button
                    type="button"
                    disabled
                    className="w-full py-3.5 rounded-full bg-slate-200 text-slate-600 border border-slate-300 font-extrabold text-xs flex items-center justify-center gap-2 cursor-not-allowed"
                  >
                    <Lock className="w-4 h-4" />
                    <span>
                      🔒 تم الانتهاء وخرج الموديل بالفعل من مرحلة القص ({currentStageLabel(model)})
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleFinishCutting()}
                    className="w-full py-3.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs transition shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <CheckCircle2 className="w-5 h-5" />
                    <span>
                      ✔️ إنهاء قص كل القطع والتحويل للفرز والكنترول (جدول العد قبل الطباعة)
                    </span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {editingRecord && (
        <EditSpreadModal record={editingRecord} onClose={() => setEditingRecord(null)} />
      )}
    </div>
  );
};