import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Search,
  ArrowRight,
  Printer,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Lock
} from 'lucide-react';

interface QCDetailsViewProps {
  modelId: string;
  onBack: () => void;
  onFinishedApproval: () => void;
}

export const QCDetailsView: React.FC<QCDetailsViewProps> = ({
  modelId,
  onBack,
  onFinishedApproval
}) => {
  const {
    models,
    requirements,
    fabricColors,
    sizeDefs,
    qcRecords,
    addQCRecord,
    finishQCApproval,
    exportQcCsv,
    hasPermission,
    canAddQCBeforePrintNotes,
    globalSettings
  } = useApp();

  const canEdit = hasPermission('qc', true);
  const canWriteNotes = canAddQCBeforePrintNotes();
  const model = models.find((m) => m.id === modelId);

  const sizeCat = sizeDefs.find((s) => s.id === model?.size_category_id);
  const sizeList = sizeCat
    ? sizeCat.values.split(',').map((s) => s.trim()).filter(Boolean)
    : ['S', 'M', 'L', 'XL'];

  const modelReqs = requirements.filter((r) => r.model_id === modelId);
  const colorList: string[] = [];
  modelReqs.forEach((req) => {
    const col = fabricColors.find((c) => c.id === req.color_id);
    const label = `${col?.color_code || 'لون'} (${req.part_name})`;
    if (!colorList.includes(label)) {
      colorList.push(label);
    }
  });

  if (colorList.length === 0 && model) {
    colorList.push(`اللون الأساسي لموديل ${model.model_code}`);
  }

  const modelQCRecords = qcRecords.filter((r) => r.model_id === modelId);

  // Form State
  const [selectedColor, setSelectedColor] = useState(colorList[0] || '');
  const [selectedSize, setSelectedSize] = useState(sizeList[0] || '');
  const [goodQty, setGoodQty] = useState<number>(30);
  const [defectQty, setDefectQty] = useState<number>(0);
  const [defectNotes, setDefectNotes] = useState('');

  if (!model) {
    return (
      <div className="bg-white rounded-3xl p-8 text-center text-slate-500 border border-slate-200">
        <p className="font-bold text-lg text-slate-700">الموديل غير موجود</p>
        <button
          onClick={onBack}
          className="mt-4 px-6 py-2 rounded-full bg-slate-900 text-white font-bold text-xs"
        >
          العودة لقائمة الفرز
        </button>
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedColor || !selectedSize) return;

    addQCRecord({
      modelId,
      colorName: selectedColor,
      size: selectedSize,
      goodQty: Number(goodQty) || 0,
      defectQty: Number(defectQty) || 0,
      defectNotes: canWriteNotes ? defectNotes.trim() : ''
    });

    setDefectQty(0);
    setDefectNotes('');
  };

  const handleFinishQC = () => {
    if (modelQCRecords.length === 0) {
      alert('يجب تسجيل نتيجة فرز واحدة على الأقل قبل الاعتماد النهائي!');
      return;
    }
    if (window.confirm('هل أنت متأكد من الاعتماد النهائي للفرز وتحويل الموديل إلى جاهز للتجميع والطباعة؟')) {
      finishQCApproval(modelId);
      onFinishedApproval();
    }
  };

  const totalGood = modelQCRecords.reduce((sum, r) => sum + r.good_qty, 0);
  const totalDefect = modelQCRecords.reduce((sum, r) => sum + r.defect_qty, 0);
  const totalCounted = totalGood + totalDefect;
  const defectRate = totalCounted > 0 ? ((totalDefect / totalCounted) * 100).toFixed(1) : '0';

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top action buttons (hidden on print) */}
      <div className="no-print flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-extrabold text-purple-700 hover:text-purple-900 transition cursor-pointer"
        >
          <ArrowRight className="w-4 h-4" />
          <span>← العودة لقائمة الفرز</span>
        </button>

        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-5 py-2 rounded-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-md transition cursor-pointer"
        >
          <Printer className="w-4 h-4" />
          <span>🖨️ طباعة ورقة الجرد للعامل</span>
        </button>
      </div>

      {/* Model Info Header Card */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs flex items-center gap-6">
        <div className="w-28 h-28 rounded-2xl overflow-hidden bg-slate-100 shrink-0 border border-slate-200">
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

        <div className="flex-grow">
          <h1 className="text-2xl font-black text-slate-900 tracking-tight mb-1">
            فرز موديل: <span className="text-purple-700">{model.model_code}</span>
          </h1>
          <p className="text-xs text-slate-600 font-semibold mb-1">
            الألوان والقطع: <span className="text-slate-900">{colorList.join('، ') || 'غير محدد'}</span>
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-slate-500 font-medium">المقاسات المتاحة:</span>
            {sizeList.map((s) => (
              <span
                key={s}
                className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-800 text-xs font-bold border border-slate-200"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* PRINT-ONLY WORKER SHEET */}
      <div className="hidden print:block my-8 p-6 bg-white border border-black rounded-lg">
        <div className="text-center mb-6">
          <h2 className="text-xl font-bold mb-1">
            🏭 {globalSettings?.site_name || 'مصنع الملابس الجاهزة'} - قسم الفرز والجودة
          </h2>
          <h3 className="text-lg font-bold">📋 ورقة استلام الفرز وتسجيل الأعداد يدويًا</h3>
          <p className="text-sm mt-1">موديل: {model.model_code} | التاريخ: {new Date().toLocaleDateString('ar-EG')}</p>
        </div>

        <table className="w-full border-collapse border border-black text-center text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-black p-3 font-bold">اللون / المقاس</th>
              {sizeList.map((sz) => (
                <th key={sz} className="border border-black p-3 font-bold">{sz}</th>
              ))}
              <th className="border border-black p-3 font-bold">المجموع السليم</th>
              <th className="border border-black p-3 font-bold">الهالك</th>
            </tr>
          </thead>
          <tbody>
            {colorList.map((col) => (
              <tr key={col}>
                <td className="border border-black p-4 font-bold text-start">{col}</td>
                {sizeList.map((sz) => (
                  <td key={sz} className="border border-black p-4 h-12"></td>
                ))}
                <td className="border border-black p-4"></td>
                <td className="border border-black p-4"></td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-8 flex justify-between text-sm pt-4">
          <div>توقيع مستلم الفرز: .......................................</div>
          <div>اعتماد مشرف الجودة: .......................................</div>
        </div>
      </div>

      {/* Interactive Form & Aggregated Ledger */}
      <div className="no-print grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Col 5: QC Entry Form */}
        <div className="lg:col-span-5 bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs border-t-4 border-t-purple-600 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-extrabold text-purple-700 mb-4 flex items-center gap-2">
              <Search className="w-5 h-5" />
              <span>📝 تسجيل الأعداد في النظام</span>
            </h2>

            {canEdit ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    اختر اللون / القطعة *
                  </label>
                  <select
                    required
                    value={selectedColor}
                    onChange={(e) => setSelectedColor(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-purple-500 focus:outline-hidden"
                  >
                    {colorList.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    اختر المقاس *
                  </label>
                  <select
                    required
                    value={selectedSize}
                    onChange={(e) => setSelectedSize(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-purple-500 focus:outline-hidden"
                  >
                    {sizeList.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-emerald-700 mb-1">
                      العدد السليم (مطابق) *
                    </label>
                    <input
                      type="number"
                      min="0"
                      required
                      value={goodQty}
                      onChange={(e) => setGoodQty(parseInt(e.target.value) || 0)}
                      className="w-full px-4 py-2.5 rounded-xl border-2 border-emerald-400 bg-emerald-50/20 text-center font-black text-emerald-900 text-base focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-rose-700 mb-1">
                      العدد الهالك (معيوب) *
                    </label>
                    <input
                      type="number"
                      min="0"
                      required
                      value={defectQty}
                      onChange={(e) => setDefectQty(parseInt(e.target.value) || 0)}
                      className="w-full px-4 py-2.5 rounded-xl border-2 border-rose-400 bg-rose-50/20 text-center font-black text-rose-900 text-base focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
                    />
                  </div>
                </div>

                {/* Optional QC Notes Textarea gated by canAddQCBeforePrintNotes (Task 4) */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-purple-600" />
                      <span>ملاحظات الفرز والهالك (اختياري)</span>
                    </label>
                    {!canWriteNotes && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                        <Lock className="w-3 h-3" />
                        يتطلب صلاحية ملاحظات الفرز قبل الطباعة
                      </span>
                    )}
                  </div>
                  <textarea
                    rows={2}
                    disabled={!canWriteNotes}
                    value={defectNotes}
                    onChange={(e) => setDefectNotes(e.target.value)}
                    placeholder={
                      canWriteNotes
                        ? 'مثال: بقعة زيت، خياطة مفكوكة، نسل بالقماش (اختياري)...'
                        : 'ليس لديك صلاحية كتابة ملاحظات الفرز'
                    }
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-purple-500 focus:outline-hidden disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    className="w-full py-3 rounded-full bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs transition shadow-lg shadow-purple-600/20 cursor-pointer"
                  >
                    + إضافة للسجل
                  </button>
                </div>
              </form>
            ) : (
              <p className="text-xs text-slate-400">عرض فقط - الصلاحية غير متوفرة للتعديل</p>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-100">
              <span className="text-[10px] text-emerald-700 block">إجمالي السليم</span>
              <strong className="text-base text-emerald-900 font-black">{totalGood}</strong>
            </div>
            <div className="p-2 rounded-xl bg-rose-50 border border-rose-100">
              <span className="text-[10px] text-rose-700 block">إجمالي الهالك</span>
              <strong className="text-base text-rose-900 font-black">{totalDefect}</strong>
            </div>
            <div className="p-2 rounded-xl bg-purple-50 border border-purple-100">
              <span className="text-[10px] text-purple-700 block">نسبة الهالك</span>
              <strong className="text-base text-purple-900 font-black">{defectRate}%</strong>
            </div>
          </div>
        </div>

        {/* Col 7: Aggregated QC Table */}
        <div className="lg:col-span-7 bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <h2 className="text-base font-extrabold text-slate-900">سجل الإدخالات المجمعة للفرز</h2>
                <span className="text-xs text-slate-500 font-semibold">
                  إجمالي المفروز: {totalCounted} قطعة
                </span>
              </div>

              {modelQCRecords.length > 0 && (
                <button
                  type="button"
                  onClick={() => exportQcCsv(modelId)}
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
                    <th className="px-4 py-3">اللون</th>
                    <th className="px-4 py-3 text-center">المقاس</th>
                    <th className="px-4 py-3 text-center">سليم</th>
                    <th className="px-4 py-3 text-center">هالك</th>
                    <th className="px-4 py-3">ملاحظات العيوب</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {modelQCRecords.length > 0 ? (
                    modelQCRecords.map((rec) => (
                      <tr key={rec.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-bold text-slate-900">{rec.color_name}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="px-2.5 py-0.5 rounded-full bg-slate-900 text-white font-bold text-[11px]">
                            {rec.size}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center font-black text-emerald-600 text-sm">
                          {rec.good_qty}
                        </td>
                        <td className="px-4 py-3 text-center font-black text-rose-600 text-sm">
                          {rec.defect_qty}
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-[11px] max-w-xs">
                          {rec.defect_notes || '-'}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-slate-400">
                        لم يتم تسجيل أعداد فرز بعد لهذا الموديل.
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
                onClick={handleFinishQC}
                className="w-full py-3.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs transition shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="w-5 h-5" />
                <span>✔️ إنهاء الفرز والاعتماد النهائي (تحويل للتجميع والطباعة)</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
