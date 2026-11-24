import React, { useState } from 'react';
import {
  X,
  Plus,
  Trash2,
  Save,
  Palette,
  Calculator,
  Scissors,
  User,
  Lock,
  StickyNote,
  Layers
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  CuttingRecord,
  CuttingSpreadLayer,
  GarmentPart,
  PART_EMOJI,
  getPartLabel
} from '../types';

/** قيمة خيار "كتابة لون آخر يدوياً" في قائمة اختيار ألوان الفرشة. */
const CUSTOM_COLOR_OPTION = '__custom_color__';

/** صف لون داخل نافذة التعديل + علم محلي للكتابة اليدوية (لا يُرسل للباك إند). */
type EditLayerRow = {
  key: string;
  color_name: string;
  layers_count: number;
  isCustomColor: boolean;
};

interface EditSpreadModalProps {
  record: CuttingRecord;
  onClose: () => void;
}

/**
 * نافذة تعديل كاملة لفرشة قص قائمة: النوع (قطعة أساسية/قصة فرعية)، الفَرّاش،
 * المقصدار، الألوان والراقات، عدد القطع في الراق، وزن الراق، درجة الصبغة،
 * والملاحظات. القطع المقصوصة تُحسب تلقائياً = إجمالي الراقات × القطع في الراق.
 */
export const EditSpreadModal: React.FC<EditSpreadModalProps> = ({ record, onClose }) => {
  const {
    models,
    updateCuttingRecord,
    getModelColorList,
    getModelParts,
    normalizePartKey,
    canAddCuttingNotes
  } = useApp();

  const model = models.find((m) => m.id === record.model_id);
  const canWriteNotes = canAddCuttingNotes();

  const initialPart = normalizePartKey(record.part_type || record.partType || 'shirt');
  const rawModelParts = getModelParts(record.model_id);
  const modelParts: GarmentPart[] = rawModelParts.length > 0 ? rawModelParts : [initialPart];

  const [partType, setPartType] = useState<GarmentPart>(initialPart);
  const [isSubCut, setIsSubCut] = useState<boolean>(
    Boolean(record.is_sub_cut ?? record.isSubCut ?? false)
  );
  const [subCutLabel, setSubCutLabel] = useState<string>(
    record.sub_cut_label ?? record.subCutLabel ?? ''
  );
  const [spreaderName, setSpreaderName] = useState<string>(
    record.spreader_name ?? record.spreaderName ?? ''
  );
  const [cutterName, setCutterName] = useState<string>(
    record.cutter_name ?? record.cutterName ?? ''
  );
  const [piecesPerLayer, setPiecesPerLayer] = useState<number>(
    Number(record.pieces_per_layer ?? record.piecesPerLayer ?? 0) || 0
  );
  const [layerWeight, setLayerWeight] = useState<number>(
    Number(record.layer_weight ?? record.layerWeight ?? 0) || 0
  );
  const [shadeDegree, setShadeDegree] = useState<string>(
    record.shade_degree ?? record.shadeDegree ?? ''
  );
  const [notes, setNotes] = useState<string>(record.notes ?? '');
  const [customColorInput, setCustomColorInput] = useState<string>('');
  const [error, setError] = useState<string>('');

  const [layerRows, setLayerRows] = useState<EditLayerRow[]>(() => {
    const source = record.color_layers ?? record.colorLayers ?? [];
    const rows = source
      .filter(
        (l) => (l.color_name || l.colorName) && Number(l.layers_count ?? l.layersCount ?? 0) > 0
      )
      .map((l, idx) => ({
        key: l.id || `edit-lay-${idx}`,
        color_name: (l.color_name || l.colorName || '').trim(),
        layers_count: Math.max(0, Number(l.layers_count ?? l.layersCount ?? 0)),
        isCustomColor: false
      }));
    if (rows.length > 0) return rows;
    // سجلات قديمة تحمل اللون/الراقات على مستوى الفرشة نفسها.
    const fallbackColor =
      (record.color_name || record.colorName || '').trim() ||
      getModelColorList(record.model_id, initialPart)[0] ||
      (model ? `اللون الأساسي (${model.model_code})` : '');
    return [
      {
        key: 'edit-lay-0',
        color_name: fallbackColor,
        layers_count: Math.max(0, Number(record.layers_count ?? record.layersCount ?? 0)),
        isCustomColor: false
      }
    ];
  });

  const partColors = getModelColorList(record.model_id, partType);
  const availableColors: string[] =
    partColors.length > 0
      ? partColors
      : model
        ? [`اللون الأساسي (${model.model_code})`]
        : [];

  const totalLayers = layerRows.reduce((sum, row) => sum + (Number(row.layers_count) || 0), 0);
  const totalPieces = totalLayers > 0 && piecesPerLayer > 0 ? totalLayers * piecesPerLayer : 0;
  const spreadNo = record.spread_number ?? record.spreadNumber ?? '';

  const setLayerField = (idx: number, patch: Partial<EditLayerRow>) =>
    setLayerRows((prev) => prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)));

  const handleColorSelect = (idx: number, value: string) => {
    if (value === CUSTOM_COLOR_OPTION) {
      setLayerField(idx, { color_name: '', isCustomColor: true });
      return;
    }
    setLayerField(idx, { color_name: value, isCustomColor: false });
  };

  const handleAddColorRow = () => {
    const nextColor =
      availableColors.find((c) => !layerRows.some((l) => l.color_name === c)) ||
      availableColors[0] ||
      '';
    setLayerRows((prev) => [
      ...prev,
      { key: `edit-lay-${Date.now()}`, color_name: nextColor, layers_count: 10, isCustomColor: false }
    ]);
  };

  const handleRemoveColorRow = (idx: number) => {
    setLayerRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  };

  const handleAddCustomColorRow = () => {
    const value = customColorInput.trim();
    if (!value) return;
    setLayerRows((prev) => [
      ...prev,
      { key: `edit-lay-${Date.now()}`, color_name: value, layers_count: 10, isCustomColor: true }
    ]);
    setCustomColorInput('');
  };

  const handleSave = () => {
    setError('');
    if (!spreaderName.trim()) {
      setError('رجاء إدخال اسم الشخص الذي قام بالفرش (الفَرّاش).');
      return;
    }
    if (!cutterName.trim()) {
      setError('رجاء إدخال اسم المقصدار (القاصص).');
      return;
    }
    if (piecesPerLayer <= 0) {
      setError('عدد القطع في الراق يجب أن يكون أكبر من صفر.');
      return;
    }
    if (layerWeight <= 0) {
      setError('إجمالي وزن الراق يجب أن يكون أكبر من صفر.');
      return;
    }

    const cleanLayers: CuttingSpreadLayer[] = layerRows
      .filter((row) => row.color_name.trim() && Number(row.layers_count) > 0)
      .map((row, idx) => ({
        id: row.key || `edit-lay-${idx}`,
        color_name: row.color_name.trim(),
        layers_count: Number(row.layers_count) || 0,
        layer_weight: layerWeight,
        pieces_count: (Number(row.layers_count) || 0) * piecesPerLayer,
        shade_degree: shadeDegree.trim(),
        notes: ''
      }));

    if (cleanLayers.length === 0) {
      setError('أضف لوناً واحداً على الأقل مع عدد راقات أكبر من صفر.');
      return;
    }

    updateCuttingRecord(record.id, {
      partType,
      isSubCut,
      subCutLabel: subCutLabel.trim(),
      spreaderName: spreaderName.trim(),
      cutterName: cutterName.trim(),
      colorLayers: cleanLayers,
      layersCount: totalLayers,
      piecesPerLayer,
      layerWeight,
      piecesCount: totalPieces,
      shadeDegree: shadeDegree.trim(),
      notes: canWriteNotes ? notes.trim() : record.notes ?? ''
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95">
        {/* HEADER */}
        <div className="p-5 border-b border-slate-100 bg-rose-50/80 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-black text-rose-950 flex items-center gap-2">
              <Scissors className="w-4 h-4 text-rose-700 shrink-0" />
              <span>تعديل فرشة القص #{spreadNo}</span>
            </h3>
            <p className="mt-1 text-[11px] font-bold text-rose-800">
              الموديل: {model?.model_code || record.model_id} | {PART_EMOJI[partType]}{' '}
              {getPartLabel(partType)}
              {isSubCut ? ' | قصة فرعية (قماش فقط)' : ' | قطعة أساسية'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="إغلاق"
            className="p-1.5 rounded-full text-slate-500 hover:text-rose-700 hover:bg-white transition cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* BODY */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-300 text-[11px] font-black text-rose-800">
              {error}
            </div>
          )}

          {/* النوع: قطعة أساسية / قصة فرعية */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
            <label className="block text-xs font-extrabold text-slate-800">
              نوع الفرشة والقطعة
            </label>
            <div className="flex flex-wrap gap-1.5">
              {modelParts.map((part) => (
                <button
                  key={part}
                  type="button"
                  onClick={() => setPartType(part)}
                  className={`px-3 py-1.5 rounded-full border text-[11px] font-black transition cursor-pointer ${
                    partType === part
                      ? 'bg-rose-600 text-white border-rose-600'
                      : 'bg-white text-slate-600 border-slate-300 hover:border-rose-400'
                  }`}
                >
                  {PART_EMOJI[part]} {getPartLabel(part)}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsSubCut(false)}
                className={`px-3 py-2 rounded-xl border text-[11px] font-black transition cursor-pointer ${
                  !isSubCut
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-slate-600 border-slate-300 hover:border-emerald-400'
                }`}
              >
                ✅ قطعة أساسية (تُجمع على العدد)
              </button>
              <button
                type="button"
                onClick={() => setIsSubCut(true)}
                className={`px-3 py-2 rounded-xl border text-[11px] font-black transition cursor-pointer ${
                  isSubCut
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-white text-slate-600 border-slate-300 hover:border-amber-400'
                }`}
              >
                🧩 قصة / جزء فرعي (قماش فقط)
              </button>
            </div>
            {isSubCut && (
              <input
                type="text"
                value={subCutLabel}
                onChange={(e) => setSubCutLabel(e.target.value)}
                placeholder={`اسم القصة الفرعية (مثال: قصة ${getPartLabel(partType)})`}
                className="w-full px-3 py-2 rounded-xl bg-white border border-amber-300 text-xs font-bold focus:ring-2 focus:ring-amber-500 focus:outline-hidden"
              />
            )}
          </div>

          {/* الفَرّاش والمقصدار */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="mb-1 flex items-center gap-1 text-[11px] font-extrabold text-slate-700">
                <User className="w-3.5 h-3.5 text-slate-500" />
                <span>الفَرّاش (Spreader) *</span>
              </label>
              <input
                type="text"
                value={spreaderName}
                onChange={(e) => setSpreaderName(e.target.value)}
                placeholder="اسم عامل الفرش"
                className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300 text-xs font-bold focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
              />
            </div>
            <div>
              <label className="mb-1 flex items-center gap-1 text-[11px] font-extrabold text-slate-700">
                <Scissors className="w-3.5 h-3.5 text-slate-500" />
                <span>المقصدار (القاصص) *</span>
              </label>
              <input
                type="text"
                value={cutterName}
                onChange={(e) => setCutterName(e.target.value)}
                placeholder="اسم المقصدار"
                className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300 text-xs font-bold focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
              />
            </div>
          </div>

          {/* الألوان وعدد الراقات */}
          <div className="p-4 rounded-2xl bg-rose-50/40 border border-rose-200/80 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-1.5 text-xs font-extrabold text-rose-950">
                <Palette className="w-4 h-4 text-rose-600" />
                <span>الألوان وعدد الراقات داخل الفرشة</span>
              </label>
              <button
                type="button"
                onClick={handleAddColorRow}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold transition cursor-pointer shadow-2xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>إضافة لون</span>
              </button>
            </div>

            <div className="space-y-2.5">
              {layerRows.map((row, idx) => (
                <div
                  key={row.key}
                  className="p-3 rounded-xl bg-white border border-rose-200/80 shadow-2xs space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-black text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
                      اللون #{idx + 1}
                    </span>
                    {layerRows.length > 1 && (
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
                    <div className="sm:col-span-8">
                      <label className="mb-1 block text-[10px] font-bold text-slate-500">
                        اللون ({getPartLabel(partType)})
                      </label>
                      {row.isCustomColor ||
                      (!!row.color_name && !availableColors.includes(row.color_name)) ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={row.color_name}
                            onChange={(e) => setLayerField(idx, { color_name: e.target.value })}
                            placeholder="اكتب اللون يدوياً..."
                            className="w-full px-3 py-2 rounded-lg border border-amber-300 bg-amber-50/40 text-xs font-bold focus:ring-2 focus:ring-amber-500 focus:outline-hidden"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setLayerField(idx, {
                                isCustomColor: false,
                                color_name: availableColors[0] || ''
                              })
                            }
                            title="الرجوع لألوان هذه القطعة"
                            className="shrink-0 px-2 py-2 rounded-lg bg-white border border-slate-300 text-slate-500 hover:text-rose-600 text-[10px] font-bold cursor-pointer"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <select
                          value={row.color_name}
                          onChange={(e) => handleColorSelect(idx, e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold focus:ring-2 focus:ring-rose-500 focus:outline-hidden bg-white"
                        >
                          <option value="">-- اختر لون --</option>
                          {availableColors.map((colOption) => (
                            <option key={colOption} value={colOption}>
                              {colOption}
                            </option>
                          ))}
                          <option value={CUSTOM_COLOR_OPTION}>✏️ كتابة لون آخر يدوياً...</option>
                        </select>
                      )}
                    </div>

                    <div className="sm:col-span-4">
                      <label className="mb-1 block text-[10px] font-bold text-slate-500">
                        عدد الراقات
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={row.layers_count || ''}
                        onChange={(e) =>
                          setLayerField(idx, { layers_count: parseInt(e.target.value) || 0 })
                        }
                        placeholder="عدد الراقات"
                        className="w-full px-3 py-2 rounded-lg border border-rose-300 bg-rose-50/30 text-xs text-center font-black text-rose-900 focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customColorInput}
                onChange={(e) => setCustomColorInput(e.target.value)}
                placeholder="إضافة لون آخر سريع..."
                className="flex-grow px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] focus:outline-hidden focus:border-rose-400"
              />
              <button
                type="button"
                onClick={handleAddCustomColorRow}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-[11px] font-bold cursor-pointer"
              >
                + أضف للفرشة
              </button>
            </div>

            <div className="flex items-center justify-between border-t border-rose-200/60 pt-2 text-xs font-extrabold text-rose-900">
              <span className="flex items-center gap-1">
                <Layers className="w-3.5 h-3.5" />
                إجمالي راقات الفرشة:
              </span>
              <span className="px-3 py-0.5 rounded-full bg-rose-600 text-white font-black">
                {totalLayers} راق
              </span>
            </div>
          </div>

          {/* عدد القطع في الراق + وزن الراق + معاينة الحساب */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  عدد القطع في الراق *
                </label>
                <input
                  type="number"
                  min="1"
                  value={piecesPerLayer || ''}
                  onChange={(e) => setPiecesPerLayer(parseInt(e.target.value) || 0)}
                  placeholder="مثال: 4"
                  className="w-full px-4 py-2.5 rounded-xl border-2 border-rose-300 bg-rose-50/30 text-sm text-center font-black text-rose-900 focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  إجمالي وزن الراق (كجم) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={layerWeight || ''}
                  onChange={(e) => setLayerWeight(parseFloat(e.target.value) || 0)}
                  placeholder="مثال: 1.5"
                  className="w-full px-4 py-2.5 rounded-xl border-2 border-rose-300 bg-rose-50/30 text-sm text-center font-black text-rose-900 focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-2xl bg-blue-50 border border-blue-200 px-4 py-2.5">
              <span className="flex items-center gap-1.5 text-[11px] font-extrabold text-blue-900">
                <Calculator className="w-4 h-4 text-blue-700" />
                <span>
                  القطع المقصوصة = {totalLayers} راق × {piecesPerLayer} قطعة/راق
                </span>
              </span>
              <span className="px-3 py-0.5 rounded-full bg-blue-700 text-white text-xs font-black">
                {totalPieces} قطعة
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] font-extrabold text-slate-700">
                  درجة الصبغة
                </label>
                <input
                  type="text"
                  value={shadeDegree}
                  onChange={(e) => setShadeDegree(e.target.value)}
                  placeholder="مثال: درجة أولى"
                  className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300 text-xs font-bold focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
                />
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1 text-[11px] font-extrabold text-slate-700">
                  <StickyNote className="w-3.5 h-3.5 text-slate-500" />
                  <span>ملاحظات القص</span>
                  {!canWriteNotes && <Lock className="w-3 h-3.5 text-amber-600" />}
                </label>
                <input
                  type="text"
                  value={notes}
                  disabled={!canWriteNotes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={
                    canWriteNotes ? 'ملاحظات العامل...' : 'لا تملك صلاحية كتابة ملاحظات القص'
                  }
                  className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300 text-xs font-bold focus:ring-2 focus:ring-rose-500 focus:outline-hidden disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                />
              </div>
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-bold text-slate-600">
            القطع بعد الحفظ: <span className="text-rose-700 font-black">{totalPieces}</span> قطعة
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-100 transition cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black transition cursor-pointer shadow-sm"
            >
              <Save className="w-4 h-4" />
              <span>حفظ التعديلات</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

