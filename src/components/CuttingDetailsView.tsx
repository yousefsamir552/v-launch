import React, { useState } from 'react';
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
  Palette
} from 'lucide-react';
import { CuttingSpreadLayer } from '../types';

interface CuttingDetailsViewProps {
  modelId: string;
  onBack: () => void;
  onFinishedToQC: () => void;
}

export const CuttingDetailsView: React.FC<CuttingDetailsViewProps> = ({
  modelId,
  onBack,
  onFinishedToQC
}) => {
  const {
    models,
    requirements,
    fabricColors,
    cuttingRecords,
    addCuttingRecord,
    finishCuttingToQC,
    exportCuttingCsv,
    hasPermission,
    canAddCuttingNotes
  } = useApp();

  const canEdit = hasPermission('cutting', true);
  const canWriteNotes = canAddCuttingNotes();
  const model = models.find((m) => m.id === modelId);
  const modelReqs = requirements.filter((r) => r.model_id === modelId);
  const modelCuttingRecords = cuttingRecords.filter((r) => r.model_id === modelId);

  // Build available color options for this model
  const availableColors: string[] = [];
  modelReqs.forEach((req) => {
    const col = fabricColors.find((c) => c.id === req.color_id);
    const label = col?.color_name
      ? `${col.color_code} - ${col.color_name} (${req.part_name})`
      : `${col?.color_code || 'لون'} (${req.part_name})`;
    if (!availableColors.includes(label)) {
      availableColors.push(label);
    }
  });
  if (availableColors.length === 0 && model) {
    availableColors.push(`اللون الأساسي (${model.model_code})`);
  }

  // State for "Add Spread" (إضافة فرشة) panel
  const [isAddingSpread, setIsAddingSpread] = useState<boolean>(true);
  const [spreaderName, setSpreaderName] = useState<string>('');
  const [spreadLayers, setSpreadLayers] = useState<CuttingSpreadLayer[]>([
    {
      color_name: availableColors[0] || '',
      layers_count: 50,
      layer_weight: 0,
      shade_degree: ''
    }
  ]);
  const [customColorInput, setCustomColorInput] = useState<string>('');
  const [cutterName, setCutterName] = useState<string>('');
  const [piecesCount, setPiecesCount] = useState<number>(150);
  const [spreadWeight, setSpreadWeight] = useState<number>(0);
  const [shadeDegree, setShadeDegree] = useState<string>('');
  const [cuttingNotes, setCuttingNotes] = useState<string>('');

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

  const handleAddColorRow = () => {
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
        shade_degree: ''
      }
    ]);
  };

  const handleAddCustomColorRow = () => {
    if (!customColorInput.trim()) return;
    setSpreadLayers((prev) => [
      ...prev,
      {
        color_name: customColorInput.trim(),
        layers_count: 40,
        layer_weight: 0,
        shade_degree: ''
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
    if (!cutterName.trim()) {
      alert('يرجى إدخال اسم المقصدار / القاصص للفرشة بالكامل!');
      return;
    }

    addCuttingRecord({
      modelId,
      spreadNumber: modelCuttingRecords.length + 1,
      spreaderName: spreaderName.trim(),
      cutterName: cutterName.trim(),
      colorLayers: validLayers,
      layersCount: currentSpreadTotalLayers,
      layerWeight: Number(spreadWeight) || 0,
      piecesCount: Number(piecesCount) || 0,
      shadeDegree: shadeDegree.trim(),
      notes: canWriteNotes ? cuttingNotes.trim() : ''
    });

    // Reset for next spread
    setSpreadLayers([
      {
        color_name: availableColors[0] || '',
        layers_count: 50,
        layer_weight: 0,
        shade_degree: ''
      }
    ]);
    setShadeDegree('');
    setCuttingNotes('');
  };

  const handleFinishCutting = () => {
    if (modelCuttingRecords.length === 0) {
      alert('يجب تسجيل فرشة قص واحدة على الأقل قبل التحويل للفرز!');
      return;
    }
    if (window.confirm('هل أنت متأكد من إنهاء القص وتحويل الموديل للفرز والكنترول (العد قبل الطباعة)؟')) {
      finishCuttingToQC(modelId, canWriteNotes ? cuttingNotes.trim() : '');
      onFinishedToQC();
    }
  };

  const totalPiecesProduced = modelCuttingRecords.reduce((sum, r) => sum + (r.pieces_count || 0), 0);
  const totalLayers = modelCuttingRecords.reduce((sum, r) => sum + (r.layers_count || 0), 0);

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

      {/* TOP INFORMATIONAL CARD */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/90 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0 shadow-xs">
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

          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                موديل: {model.model_code}
              </h1>
              <span className="px-3 py-0.5 rounded-full text-xs font-black bg-rose-50 text-rose-700 border border-rose-200">
                {model.status}
              </span>
            </div>

            <p className="text-xs text-slate-500 font-semibold">
              النوع والتصنيف: <strong className="text-slate-800">{model.model_type || 'أولادي'}</strong>
            </p>

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
              {model.design_notes && (
                <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 font-bold border border-amber-200 line-clamp-1 max-w-[220px]" title={model.design_notes}>
                  ملاحظات التصميم: {model.design_notes}
                </span>
              )}
              {model.notes_shirt && (
                <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-800 font-bold border border-blue-200 line-clamp-1 max-w-[220px]" title={model.notes_shirt}>
                  ملاحظات تيشرت: {model.notes_shirt}
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
                width: `${Math.min(100, (totalPiecesProduced / (model.target_cut_quantity || 1)) * 100)}%`
              }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] font-extrabold text-slate-600">
            <span>المنفذ حتى الآن: <strong className="text-rose-700 font-black">{totalPiecesProduced}</strong></span>
            <span>عدد الفرشات: <strong className="text-rose-800">{modelCuttingRecords.length}</strong></span>
            <span>الإنجاز: {Math.round((totalPiecesProduced / (model.target_cut_quantity || 1)) * 100)}%</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Col 5: Spread (الفرشة) Input Form */}
        <div className="lg:col-span-5 bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs border-t-4 border-t-rose-600 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-extrabold text-rose-600 flex items-center gap-2">
                <Layers className="w-5 h-5" />
                <span>📝 تسجيل فرشة قص جديدة (فرشة #{modelCuttingRecords.length + 1})</span>
              </h2>
              <span className="px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[11px] font-black">
                نظام الفرشات
              </span>
            </div>

            {canEdit ? (
              isAddingSpread ? (
                <form onSubmit={handleSubmitSpread} className="space-y-4">
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
                                اللون / القطعة
                              </label>
                              <input
                                type="text"
                                list={`spread-color-options-${modelId}`}
                                required
                                value={layerRow.color_name}
                                onChange={(e) =>
                                  handleLayerChange(idx, 'color_name', e.target.value)
                                }
                                placeholder="اختر أو اكتب اللون (مثال: أحمر، أخضر)..."
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
                              />
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

                      <datalist id={`spread-color-options-${modelId}`}>
                        {availableColors.map((colOption) => (
                          <option key={colOption} value={colOption} />
                        ))}
                      </datalist>
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

                  {/* Step 3: Total Pieces & Weight of Spread */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        إجمالي القطع الناتجة من الفرشة *
                      </label>
                      <input
                        type="number"
                        min="1"
                        required
                        value={piecesCount}
                        onChange={(e) => setPiecesCount(parseInt(e.target.value) || 0)}
                        placeholder="العدد الناتج"
                        className="w-full px-4 py-2.5 rounded-xl border-2 border-rose-300 bg-rose-50/30 text-sm text-center font-black text-rose-900 focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">
                        إجمالي وزن الفرشة (كجم - اختياري)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={spreadWeight || ''}
                        onChange={(e) => setSpreadWeight(parseFloat(e.target.value) || 0)}
                        placeholder="وزن الفرشة بالكيلو"
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs text-center font-bold focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
                      />
                    </div>
                  </div>

                  {/* Step 4: Cutter Name at the end of the Spread details (اسم المقصدار للفرشة كلها مرة واحدة) */}
                  <div className="p-3.5 rounded-2xl bg-emerald-50/60 border-2 border-emerald-300 space-y-2">
                    <label className="block text-xs font-extrabold text-emerald-950 flex items-center gap-1.5">
                      <Scissors className="w-4 h-4 text-emerald-700" />
                      <span>3️⃣ اسم المقصدار / القاصص (للفرشة بالكامل مرة واحدة) *</span>
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
                      <span>حفظ الفرشة بالكامل وإضافتها للسجل</span>
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
              <p className="text-xs text-slate-400">عرض فقط - الصلاحية غير متوفرة للتعديل</p>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>إجمالي الفرشات: <strong className="text-slate-900">{modelCuttingRecords.length}</strong></span>
            <span>مجموع الراقات: <strong className="text-slate-800">{totalLayers}</strong></span>
            <span>إجمالي القطع: <strong className="text-rose-600 font-bold">{totalPiecesProduced}</strong></span>
          </div>
        </div>

        {/* Col 7: Cutting Spreads Ledger Table */}
        <div className="lg:col-span-7 bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <h2 className="text-base font-extrabold text-slate-900">
                  سجل الفرشات المقصوصة للموديل: <span className="text-rose-600">{model.model_code}</span>
                </h2>
                <span className="text-xs text-slate-500 font-semibold">
                  إجمالي الفرشات المسجلة: {modelCuttingRecords.length} فرشة
                </span>
              </div>

              {modelCuttingRecords.length > 0 && (
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
              {modelCuttingRecords.length > 0 ? (
                modelCuttingRecords.map((rec, idx) => {
                  const spreadNum = rec.spread_number || rec.spreadNumber || modelCuttingRecords.length - idx;
                  const layersList = rec.color_layers || rec.colorLayers || [];
                  const spreader = rec.spreader_name || rec.spreaderName || 'غير محدد';
                  const cutter = rec.cutter_name || rec.cutterName || 'غير محدد';

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
                        </div>

                        <div className="flex items-center gap-2 text-xs">
                          <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 font-bold text-slate-700">
                            إجمالي الراقات: <strong className="text-rose-700">{rec.layers_count}</strong>
                          </span>
                          <span className="px-3 py-1 rounded-lg bg-emerald-100 text-emerald-900 font-black border border-emerald-300">
                            القطع المنتجة: {rec.pieces_count} قطعة
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
                            {rec.color_name || 'لون أساسي'} ({rec.layers_count} راق)
                          </div>
                        )}

                        {/* Spread Footer: Cutter Name & Metadata */}
                        <div className="pt-3 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-50 text-emerald-900 border border-emerald-300 font-black">
                              <Scissors className="w-3.5 h-3.5 text-emerald-700" />
                              <span>المقصدار (القاصص): {cutter}</span>
                            </span>
                            {rec.layer_weight > 0 && (
                              <span className="text-slate-500 font-semibold">
                                الوزن: {rec.layer_weight} كجم
                              </span>
                            )}
                          </div>

                          <div className="text-[11px] text-slate-500">
                            {(rec.notes || rec.shade_degree) && (
                              <span className="font-semibold text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded-lg border border-amber-200">
                                {[rec.shade_degree, rec.notes].filter(Boolean).join(' | ')}
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
                  <p className="font-bold text-slate-600 text-sm">لم يتم تسجيل أي فرشة قص بعد لهذا الموديل.</p>
                  <p className="text-xs text-slate-400 mt-1">
                    استخدم النموذج الجانبي لإضافة الفرشة وتحديد الفَرّاش والألوان والراقات ثم اسم المقصدار.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="pt-6 mt-6 border-t border-slate-100">
            {canEdit && (
              <button
                onClick={handleFinishCutting}
                className="w-full py-3.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs transition shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="w-5 h-5" />
                <span>✔️ إنهاء القص والتحويل للفرز والكنترول (جدول العد قبل الطباعة)</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};