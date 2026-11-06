import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Boxes, Printer, X, CheckCircle2, Factory, Package } from 'lucide-react';

export const ProductionWarehouseView: React.FC = () => {
  const { models } = useApp();
  const [showPrintModal, setShowPrintModal] = useState(false);

  // Finished production models
  const finishedModels = models.filter(
    (m) => !m.is_deleted && (m.status === 'مخزن الإنتاج التام' || m.status === 'جاهز للطباعة / التجميع' || m.count_after_sewing)
  );

  const totalFinishedPieces = finishedModels.reduce((sum, m) => sum + (m.count_after_sewing || m.count_after_print || m.target_cut_quantity || 0), 0);

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
            <Boxes className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-slate-900">مخزن الإنتاج التام والجاهز</h2>
              <span className="px-2.5 py-0.5 text-xs font-bold bg-emerald-100 text-emerald-800 rounded-full border border-emerald-200">
                جاهز للتسليم والشحن
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              حصر المنتجات النهائية والتشغيلات المكتملة بعد الفحص والعد النهائي لتجهيزها للتوزيع
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setShowPrintModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-md shadow-slate-900/20 transition cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>🖨️ طباعة تقرير جرد مخزن الإنتاج</span>
          </button>
        </div>
      </div>

      {/* Finished Goods Inventory Table */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-indigo-600" />
            <h3 className="font-extrabold text-base text-slate-900">
              قائمة تشغيلات الإنتاج التام بالمخزن ({finishedModels.length} موديلات)
            </h3>
          </div>
          <span className="text-xs font-bold px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">
            إجمالي القطع الجاهزة: {totalFinishedPieces} قطعة
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
              <tr>
                <th className="px-6 py-3.5">كود الموديل</th>
                <th className="px-6 py-3.5">النوع / التصنيف</th>
                <th className="px-6 py-3.5 text-center">العدد المستهدف</th>
                <th className="px-6 py-3.5 text-center">العدد الفعلي المعتمد</th>
                <th className="px-6 py-3.5 text-center">تاريخ الإنشاء</th>
                <th className="px-6 py-3.5 text-center">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-semibold">
              {finishedModels.length > 0 ? (
                finishedModels.map((m) => {
                  const actual = m.count_after_sewing || m.count_after_print || m.actual_cut_count || m.target_cut_quantity;
                  return (
                    <tr key={m.id} className="hover:bg-slate-50 transition">
                      <td className="px-6 py-4 font-bold text-slate-900 flex items-center gap-2">
                        <img
                          src={m.image}
                          alt={m.model_code}
                          className="w-10 h-10 rounded-lg object-contain bg-white border p-0.5 shrink-0"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src =
                              'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=100&auto=format&fit=crop&q=60';
                          }}
                        />
                        <span className="font-black text-sm text-indigo-700">{m.model_code}</span>
                      </td>
                      <td className="px-6 py-4 text-slate-600">{m.model_type}</td>
                      <td className="px-6 py-4 text-center font-bold text-slate-700">{m.target_cut_quantity}</td>
                      <td className="px-6 py-4 text-center font-black text-emerald-700 text-sm">
                        {actual} قطعة
                      </td>
                      <td className="px-6 py-4 text-center text-slate-500 font-mono">
                        {new Date(m.created_at).toLocaleDateString('ar-EG')}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="inline-block px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                          {m.status}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-400">
                    لا توجد تشغيلات مكتملة بالكامل في مخزن الإنتاج حالياً.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* PRINT INVENTORY REPORT MODAL */}
      {showPrintModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between no-print bg-slate-50">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-indigo-600 text-white rounded-xl">
                  <Printer className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-900">
                    تقرير جرد مخزن الإنتاج التام
                  </h3>
                  <p className="text-xs text-slate-500">كشف رسمي بالبضاعة الجاهزة الصالحة للتسليم</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>طباعة الكشف</span>
                </button>
                <button onClick={() => setShowPrintModal(false)} className="text-slate-400 hover:text-slate-700">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-8 overflow-y-auto space-y-6 print:p-0">
              <div className="border-b-2 border-indigo-600 pb-3 flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-black text-slate-900">
                    🏭 كشف جرد مخزن الإنتاج التام الجاهز للشحن
                  </h1>
                  <p className="text-xs text-slate-500 mt-0.5">
                    تاريخ الاستخراج: {new Date().toLocaleString('ar-EG', { hour12: false })}
                  </p>
                </div>
                <div className="text-end">
                  <span className="font-black text-sm text-slate-800">
                    إجمالي القطع الجاهزة: {totalFinishedPieces} قطعة
                  </span>
                </div>
              </div>

              <table className="w-full text-xs text-start border border-slate-200">
                <thead className="bg-slate-100 text-slate-700 font-black border-b border-slate-200">
                  <tr>
                    <th className="p-3">صورة الموديل</th>
                    <th className="p-3">كود الموديل</th>
                    <th className="p-3">النوع</th>
                    <th className="p-3 text-center">الكمية المستهدفة</th>
                    <th className="p-3 text-center font-black">الكمية التامة الفعلية</th>
                    <th className="p-3 text-center">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-semibold">
                  {finishedModels.map((m) => {
                    const actual = m.count_after_sewing || m.count_after_print || m.actual_cut_count || m.target_cut_quantity;
                    return (
                      <tr key={m.id}>
                        <td className="p-3">
                          <img
                            src={m.image}
                            alt={m.model_code}
                            className="w-10 h-10 rounded-lg object-contain bg-slate-50 border p-0.5"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src =
                                'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=100&auto=format&fit=crop&q=60';
                            }}
                          />
                        </td>
                        <td className="p-3 font-bold text-slate-900">{m.model_code}</td>
                        <td className="p-3 text-slate-600">{m.model_type}</td>
                        <td className="p-3 text-center">{m.target_cut_quantity}</td>
                        <td className="p-3 text-center font-black text-emerald-700">{actual} قطعة</td>
                        <td className="p-3 text-center text-slate-600">{m.status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="pt-6 border-t border-slate-200 text-xs text-slate-500 flex justify-between">
                <span>مسؤول مخزن الإنتاج: ______________________</span>
                <span>اعتماد مدير المصنع: ______________________</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
