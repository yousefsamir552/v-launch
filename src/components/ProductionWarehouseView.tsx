import React, { useMemo, useState } from 'react';
import { toLatinDigits } from '../utils/latinDigits';
import { useApp } from '../context/AppContext';
import { Boxes, Printer, X, Package, AlertTriangle, Search } from 'lucide-react';
import {
  buildPrintDocumentHtml,
  escapeHtml,
  logClientPrintAction,
  openUnifiedPrintWindow,
  renderSignatureBar,
  safeImageSrc,
  UnifiedPrintDocumentOptions
} from '../utils/printShared';
import { finishedSetsOf, photographyHoldLabel, photographyOutstandingOf } from '../utils/completedModels';
import { ZoomableImage } from './ZoomableImage';
import { SortBySelect, compareNatural, toTimestamp } from './SortBySelect';
import { useModalBackHandler } from '../utils/mobileBackNav';
import type { DesignModel } from '../types';

type ProdSortKey = 'newest' | 'oldest' | 'code_asc' | 'code_desc' | 'qty_desc' | 'qty_asc';

const PROD_SORT_OPTIONS: { value: ProdSortKey; label: string }[] = [
  { value: 'newest', label: 'الأحدث أولاً' },
  { value: 'oldest', label: 'الأقدم أولاً' },
  { value: 'code_asc', label: 'الكود (تصاعدي)' },
  { value: 'code_desc', label: 'الكود (تنازلي)' },
  { value: 'qty_desc', label: 'الأطقم الجاهزة (الأكثر)' },
  { value: 'qty_asc', label: 'الأطقم الجاهزة (الأقل)' }
];

/**
 * تنبيه صغير يظهر بجانب رقم الأطقم عندما تكون هناك قطع عينة محتجزة في التصوير
 * (تم خصمها مؤقتاً من الأطقم التامة في الباك إند).
 */
const PhotographyHoldBadge: React.FC<{ model: DesignModel }> = ({ model }) => {
  const holdQty = photographyOutstandingOf(model);
  if (holdQty <= 0) return null;
  return (
    <span
      title={`${photographyHoldLabel(holdQty)} — مخصومة مؤقتاً من الأطقم التامة`}
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200"
    >
      <AlertTriangle className="w-3 h-3" />
      {holdQty}
    </span>
  );
};

export const ProductionWarehouseView: React.FC = () => {
  const { models, globalSettings, exportProductionWarehouseCsv } = useApp();
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<ProdSortKey>('newest');

  useModalBackHandler(showPrintModal, () => setShowPrintModal(false));

  // Finished production models — فقط الموديلات التي وصلت فعلاً لمخزن الإنتاج التام
  // (بعد اكتمال التشطيب ← المكواة ← التعبئة والتغليف ← الدَست).
  const finishedModels = useMemo(() => {
    const q = toLatinDigits(searchTerm).trim().toLowerCase();
    const list = models.filter(
      (m) =>
        !m.is_deleted &&
        (m.status === 'مخزن الإنتاج التام' || m.status === 'مكتمل الإنتاج') &&
        (!q ||
          (m.model_code || '').toLowerCase().includes(q) ||
          (m.model_type || '').toLowerCase().includes(q))
    );
    return [...list].sort((a, b) => {
      if (sortBy === 'code_asc') return compareNatural(a.model_code, b.model_code);
      if (sortBy === 'code_desc') return compareNatural(b.model_code, a.model_code);
      if (sortBy === 'qty_desc') return finishedSetsOf(b) - finishedSetsOf(a);
      if (sortBy === 'qty_asc') return finishedSetsOf(a) - finishedSetsOf(b);
      if (sortBy === 'oldest') return toTimestamp(a.created_at) - toTimestamp(b.created_at);
      return toTimestamp(b.created_at) - toTimestamp(a.created_at);
    });
  }, [models, searchTerm, sortBy]);

  // الأطقم التامة الفعلية (completed_sets من الباك إند بعد خصم عينات التصوير).
  const totalFinishedSets = finishedModels.reduce((sum, m) => sum + finishedSetsOf(m), 0);

  const buildProductionPrintOptions = (): UnifiedPrintDocumentOptions => {
    const totalTarget = finishedModels.reduce((sum, m) => sum + Number(m.target_cut_quantity || 0), 0);
    const rowsHtml = finishedModels
      .map((m, idx) => {
        const actual = finishedSetsOf(m);
        const holdQty = photographyOutstandingOf(m);
        const imgSrc = safeImageSrc(m.image);
        return `<tr>
          <td class="num muted">${idx + 1}</td>
          <td>${
            imgSrc
              ? `<img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(m.model_code)}" class="prod-thumb" onerror="this.style.display='none'" />`
              : '—'
          }</td>
          <td class="text-right"><strong>${escapeHtml(m.model_code)}</strong></td>
          <td>${escapeHtml(m.model_type || '—')}</td>
          <td class="num">${Number(m.target_cut_quantity || 0).toLocaleString('en-US')}</td>
          <td class="num ok"><strong>${actual.toLocaleString('en-US')} طقم</strong>${
            holdQty > 0 ? ` <span class="warn">(تصوير: ${holdQty})</span>` : ''
          }</td>
          <td class="num">${new Date(m.created_at).toLocaleDateString('ar-EG-u-nu-latn')}</td>
          <td><strong>${escapeHtml(m.status)}</strong></td>
        </tr>`;
      })
      .join('');

    const bodyHtml = `
      <div class="p-kpis">
        <div class="p-kpi"><span class="p-kpi-label">عدد الموديلات الجاهزة</span><span class="p-kpi-val">${finishedModels.length.toLocaleString('en-US')}</span></div>
        <div class="p-kpi"><span class="p-kpi-label">إجمالي الكمية المستهدفة</span><span class="p-kpi-val">${totalTarget.toLocaleString('en-US')} طقم</span></div>
        <div class="p-kpi"><span class="p-kpi-label">إجمالي الأطقم التامة الجاهزة</span><span class="p-kpi-val ok">${totalFinishedSets.toLocaleString('en-US')} طقم</span></div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:4%">#</th>
            <th style="width:8%">الصورة</th>
            <th class="text-right" style="width:16%">كود الموديل</th>
            <th style="width:14%">النوع / التصنيف</th>
            <th style="width:14%">الكمية المستهدفة</th>
            <th style="width:18%">الكمية التامة الفعلية</th>
            <th style="width:12%">تاريخ الإنشاء</th>
            <th style="width:14%">الحالة</th>
          </tr>
        </thead>
        <tbody>${rowsHtml || '<tr><td colspan="8" class="muted">لا توجد تشغيلات مكتملة في مخزن الإنتاج حالياً.</td></tr>'}</tbody>
        <tfoot>
          <tr class="total">
            <td colspan="4" class="text-right">الإجمالي</td>
            <td class="num">${totalTarget.toLocaleString('en-US')}</td>
            <td class="num ok">${totalFinishedSets.toLocaleString('en-US')} طقم</td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>

      ${renderSignatureBar(['أمين مخزن الإنتاج التام', 'مراقبة الجودة والتعبئة', 'اعتماد مدير المصنع'], true)}
    `;

    return {
      documentTitle: 'كشف جرد مخزن الإنتاج التام الجاهز للشحن',
      mode: 'multi-page-table',
      orientation: 'landscape',
      header: {
        siteName: globalSettings?.site_name,
        logo: globalSettings?.logo,
        title: 'كشف جرد مخزن الإنتاج التام الجاهز للشحن',
        subtitle: 'حصر المنتجات النهائية المكتملة بعد التشطيب والمكواة والتعبئة والدَست',
        metaItems: [`إجمالي الأطقم الجاهزة: ${totalFinishedSets.toLocaleString('en-US')} طقم`]
      },
      bodyHtml,
      extraCss: `
        .prod-thumb { width: 28px; height: 28px; object-fit: contain; border: 1px solid #cbd5e1; border-radius: 3px; background: #fff; display: block; margin: 0 auto; }
      `,
      popupBlockedMessage: 'يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة كشف مخزن الإنتاج التام.'
    };
  };

  const handlePrintProductionWarehouse = () => {
    logClientPrintAction('مخزن الإنتاج', 'طباعة تقرير جرد مخزن الإنتاج التام', 'جرد الإنتاج التام');
    openUnifiedPrintWindow(buildProductionPrintOptions());
  };

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
              حصر المنتجات النهائية المكتملة بعد التشطيب والمكواة والتعبئة والتغليف والدَست، الجاهزة
              للتسليم والتوزيع
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={exportProductionWarehouseCsv}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-500/20 transition cursor-pointer"
          >
            <span>📊 تصدير Excel</span>
          </button>
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
        <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-indigo-600" />
            <h3 className="font-extrabold text-base text-slate-900">
              قائمة تشغيلات الإنتاج التام بالمخزن ({finishedModels.length} موديلات)
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-56">
              <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="بحث بكود الموديل أو النوع..."
                className="w-full ps-9 pe-3 py-1.5 rounded-full border border-slate-200 bg-slate-50 text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <SortBySelect
              value={sortBy}
              onChange={(v) => setSortBy(v as ProdSortKey)}
              options={PROD_SORT_OPTIONS}
            />
            <span className="text-xs font-bold px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">
              إجمالي الأطقم الجاهزة: {totalFinishedSets} طقم
            </span>
          </div>
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
                  const actual = finishedSetsOf(m);
                  return (
                    <tr key={m.id} className="hover:bg-slate-50 transition">
                      <td className="px-6 py-4 font-bold text-slate-900 flex items-center gap-2">
                        <ZoomableImage
                          src={m.image}
                          alt={m.model_code}
                          downloadName={`${m.model_code}.jpg`}
                          className="w-10 h-10 rounded-lg object-contain bg-white border p-0.5 shrink-0"
                        />
                        <span className="font-black text-sm text-indigo-700">{m.model_code}</span>
                      </td>
                      <td className="px-6 py-4 text-slate-600">{m.model_type}</td>
                      <td className="px-6 py-4 text-center font-bold text-slate-700">{m.target_cut_quantity}</td>
                      <td className="px-6 py-4 text-center font-black text-emerald-700 text-sm">
                        <span className="inline-flex items-center gap-1.5">
                          {actual} طقم
                          <PhotographyHoldBadge model={m} />
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center text-slate-500 font-mono">
                        {new Date(m.created_at).toLocaleDateString('ar-EG-u-nu-latn')}
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

      {/* PRINT INVENTORY REPORT MODAL — exact A4 final print sheet preview */}
      {showPrintModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in"
          onClick={() => setShowPrintModal(false)}
        >
          <div
            className="bg-white rounded-3xl w-[96vw] sm:w-full max-w-6xl h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 no-print bg-slate-50 shrink-0">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-indigo-600 text-white rounded-xl">
                  <Printer className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-900">
                    معاينة تقرير جرد مخزن الإنتاج التام (مطابق للطباعة النهائية A4)
                  </h3>
                  <p className="text-xs text-slate-500">كشف رسمي بالبضاعة الجاهزة الصالحة للتسليم</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrintProductionWarehouse}
                  className="px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>طباعة الكشف (A4 أفقي)</span>
                </button>
                <button
                  onClick={() => setShowPrintModal(false)}
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <iframe
              title="معاينة جرد مخزن الإنتاج التام"
              srcDoc={buildPrintDocumentHtml({
                ...buildProductionPrintOptions(),
                autoPrint: false
              })}
              className="w-full flex-1 border-0 bg-slate-200/70"
            />
          </div>
        </div>
      )}
    </div>
  );
};
