import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Scissors,
  ArrowRight,
  CheckCircle2,
  User,
  FileSpreadsheet,
  FileText,
  Lock
} from 'lucide-react';

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

  // Form State
  const [colorName, setColorName] = useState('');
  const [cutterName, setCutterName] = useState('');
  const [layersCount, setLayersCount] = useState<number>(30);
  const [layerWeight, setLayerWeight] = useState<number>(1.5);
  const [piecesCount, setPiecesCount] = useState<number>(120);
  const [shadeDegree, setShadeDegree] = useState('');
  const [cuttingNotes, setCuttingNotes] = useState('');

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!colorName || !cutterName.trim()) return;

    addCuttingRecord({
      modelId,
      colorName,
      cutterName: cutterName.trim(),
      layersCount: Number(layersCount) || 0,
      layerWeight: Number(layerWeight) || 0,
      piecesCount: Number(piecesCount) || 0,
      shadeDegree: shadeDegree.trim(),
      notes: canWriteNotes ? cuttingNotes.trim() : ''
    });

    setShadeDegree('');
    setCuttingNotes('');
  };

  const handleFinishCutting = () => {
    if (modelCuttingRecords.length === 0) {
      alert('يجب تسجيل راق قص واحد على الأقل قبل التحويل للفرز!');
      return;
    }
    if (window.confirm('هل أنت متأكد من إنهاء القص وتحويل الموديل للفرز والكنترول؟')) {
      finishCuttingToQC(modelId, canWriteNotes ? cuttingNotes.trim() : '');
      onFinishedToQC();
    }
  };

  const totalPiecesProduced = modelCuttingRecords.reduce((sum, r) => sum + r.pieces_count, 0);
  const totalLayers = modelCuttingRecords.reduce((sum, r) => sum + r.layers_count, 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Return link */}
      <div>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-extrabold text-rose-600 hover:text-rose-800 transition cursor-pointer"
        >
          <ArrowRight className="w-4 h-4" />
          <span>← العودة لقائمة القص</span>
        </button>
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
            <span>نسبة الإنجاز: {Math.round((totalPiecesProduced / (model.target_cut_quantity || 1)) * 100)}%</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Col 5: Cutting Input Form */}
        <div className="lg:col-span-5 bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs border-t-4 border-t-rose-600 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-extrabold text-rose-600 mb-4 flex items-center gap-2">
              <Scissors className="w-5 h-5" />
              <span>📝 تسجيل بيانات راق جديد</span>
            </h2>

            {canEdit ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    القطعة واللون *
                  </label>
                  <select
                    required
                    value={colorName}
                    onChange={(e) => setColorName(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
                  >
                    <option value="">-- اختر القطعة واللون --</option>
                    {modelReqs.map((req) => {
                      const col = fabricColors.find((c) => c.id === req.color_id);
                      const label = `${col?.color_code || 'لون'} (${req.part_name})`;
                      return (
                        <option key={req.id} value={label}>
                          {col?.color_code} - {req.part_name}
                        </option>
                      );
                    })}
                    {modelReqs.length === 0 && (
                      <option value={`اللون الأساسي (${model.model_code})`}>
                        اللون الأساسي ({model.model_code})
                      </option>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    اسم المقصدار *
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={cutterName}
                      onChange={(e) => setCutterName(e.target.value)}
                      placeholder="اسم الفني أو المقصدار المسئول"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
                    />
                    <User className="w-4 h-4 text-slate-400 absolute end-3 top-1/2 -translate-y-1/2" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">
                      عدد الرقات *
                    </label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={layersCount}
                      onChange={(e) => setLayersCount(parseInt(e.target.value) || 0)}
                      placeholder="عدد الرقات"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs text-center font-bold focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">
                      وزن الراق (كجم) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      value={layerWeight}
                      onChange={(e) => setLayerWeight(parseFloat(e.target.value) || 0)}
                      placeholder="وزن الراق"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs text-center font-bold focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    العدد الناتج من القطع (القطع التامة) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={piecesCount}
                    onChange={(e) => setPiecesCount(parseInt(e.target.value) || 0)}
                    placeholder="العدد الناتج"
                    className="w-full px-4 py-2.5 rounded-xl border-2 border-rose-300 bg-rose-50/30 text-sm font-black text-rose-900 focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    درجة الصبغة (اختياري)
                  </label>
                  <input
                    type="text"
                    value={shadeDegree}
                    onChange={(e) => setShadeDegree(e.target.value)}
                    placeholder="مثال: لوت 4 - صبغة متجانسة"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
                  />
                </div>

                {/* Optional Cutting Notes Textarea gated by canAddCuttingNotes() (Task 4) */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-rose-600" />
                      <span>ملاحظات القص (اختياري)</span>
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
                        ? 'أدخل أي ملاحظات حول الفرش، عيوب القماش، أو تفاصيل القص (اختياري)...'
                        : 'ليس لديك صلاحية تسجيل ملاحظات القص'
                    }
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-rose-500 focus:outline-hidden disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    className="w-full py-3 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition shadow-lg shadow-rose-500/20 cursor-pointer"
                  >
                    + إضافة الراق للسجل
                  </button>
                </div>
              </form>
            ) : (
              <p className="text-xs text-slate-400">عرض فقط - الصلاحية غير متوفرة للتعديل</p>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>مجموع الرقات: <strong className="text-slate-800">{totalLayers}</strong></span>
            <span>إجمالي القطع: <strong className="text-rose-600 font-bold">{totalPiecesProduced}</strong></span>
          </div>
        </div>

        {/* Col 7: Cutting Ledger Table */}
        <div className="lg:col-span-7 bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <h2 className="text-base font-extrabold text-slate-900">
                  سجل القص للموديل: <span className="text-rose-600">{model.model_code}</span>
                </h2>
                <span className="text-xs text-slate-500 font-semibold">
                  إجمالي السجلات: {modelCuttingRecords.length}
                </span>
              </div>

              {modelCuttingRecords.length > 0 && (
                <button
                  type="button"
                  onClick={() => exportCuttingCsv(modelId)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>📥 تصدير Excel</span>
                </button>
              )}
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full text-xs text-start">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">اللون / القطعة</th>
                    <th className="px-4 py-3">المقصدار</th>
                    <th className="px-4 py-3 text-center">الرقات</th>
                    <th className="px-4 py-3 text-center">القطع المنتجة</th>
                    <th className="px-4 py-3 text-center">الوزن</th>
                    <th className="px-4 py-3">الملاحظات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {modelCuttingRecords.length > 0 ? (
                    modelCuttingRecords.map((rec) => (
                      <tr key={rec.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-bold text-slate-900">{rec.color_name}</td>
                        <td className="px-4 py-3 text-slate-600">{rec.cutter_name}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-800 font-bold">
                            {rec.layers_count}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 font-extrabold">
                            {rec.pieces_count}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center text-slate-500">
                          {rec.layer_weight} كجم
                        </td>
                        <td className="px-4 py-3 text-slate-600 text-[11px] max-w-[180px]">
                          {rec.notes || rec.shade_degree || '-'}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-slate-400">
                        لم يتم تسجيل أرقام قص بعد لهذا الموديل.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="pt-6 mt-6 border-t border-slate-100">
            {canEdit && (
              <button
                onClick={handleFinishCutting}
                className="w-full py-3.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs transition shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="w-5 h-5" />
                <span>✔️ إنهاء القص والتحويل للفرز والكنترول</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
