import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import {
  AlertTriangle,
  ArrowUpLeft,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Coins,
  Layers,
  Package,
  Palette,
  Printer,
  RotateCcw,
  Ruler,
  Scissors,
  Search,
  Shirt,
  Sparkles,
  Tag,
  X
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  escapeHtml,
  logClientPrintAction,
  openUnifiedPrintWindow,
  renderSignatureBar,
  safeImageSrc
} from '../utils/printShared';
import {
  DEFAULT_GARMENT_COMPOSITION,
  GARMENT_COMPOSITION_LABELS,
  PART_EMOJI,
  PART_LABELS,
  PART_ORDER,
  getPartLabel,
  partsForComposition
} from '../types';
import {
  getPartStageNavigationTarget,
  resolveEffectivePartStage,
  type StageNavigateFn
} from '../utils/stageNavigation';
import type {
  AccessoryItem,
  AssemblyStageKey,
  AssemblyStageRecord,
  CuttingRecord,
  DesignModel,
  Fabric,
  FabricColor,
  FabricTransaction,
  FinishingRecord,
  GarmentPart,
  ModelAccessory,
  PackagingRequirement,
  PrintDispatch,
  QCRecord,
  ReceiveHistoryEntry,
  SewingDispatch,
  SizeDef
} from '../types';

/* ------------------------------------------------------------------ */
/* Shared helpers & styling                                            */
/* ------------------------------------------------------------------ */

const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const fmt = (value: number | null | undefined): string => numberFormatter.format(Number(value || 0));
const money = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${numberFormatter.format(Number(value || 0))} ج.م`;
const round2 = (value: number): number => Math.round((Number(value) || 0) * 100) / 100;
const percentOf = (part: number, total: number): number =>
  total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
const uniq = (values: Array<string | null | undefined>): string[] =>
  Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
const normalizeCode = (value?: string | null): string => String(value || '').trim().toUpperCase();
const safeHex = (value?: string | null): string =>
  /^#[0-9A-Fa-f]{6}$/.test(String(value || '').trim()) ? String(value).trim() : '#64748b';
const matchText = (query: string, values: Array<string | number | null | undefined>): boolean => {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => String(value ?? '').toLowerCase().includes(needle));
};

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100';
const cardClass = 'rounded-2xl border border-slate-200 bg-white shadow-sm';

/** حركة إرجاع فائض قماش أو استرداد أو فرق تعديل بعد القص (تُخصم من الاستهلاك). */
const isFabricReturn = (txn: FabricTransaction): boolean =>
  txn.operation === 'add' && /إرجاع|مرتجع|فائض|استرداد/i.test(String(txn.notes || ''));

/** صافي حركة القماش: الصرف بالموجب والإرجاع بالسالب. */
const netFabricQty = (txn: FabricTransaction): number => {
  const amount = Number(txn.amount || 0);
  if (txn.operation === 'deduct') return amount;
  if (isFabricReturn(txn)) return -amount;
  return 0;
};

/** حركة إرجاع إكسسوار أو استرداد للمخزن (تُخصم من الاستهلاك). */
const isAccessoryReturn = (notes?: string | null): boolean =>
  /إرجاع|مرتجع|فائض|استرداد/i.test(String(notes || ''));

const detectPart = (value?: string | null): GarmentPart | null => {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  if (/بنطلون|pants|pant|trouser/.test(text)) return 'pants';
  if (/جاكيت|jacket/.test(text)) return 'jacket';
  if (/قطعة واحدة|single|one[\s-]?piece/.test(text)) return 'single';
  if (/تيشرت|تي شيرت|شيرت|shirt|tshirt|t[\s-]?shirt/.test(text)) return 'shirt';
  return null;
};

/** استخراج القطعة من ملاحظات حركة الصرف: "صرف خامات للقص - قطعة: تيشرت". */
const partFromNotes = (notes?: string | null): GarmentPart | null => {
  const match = /قطعة\s*[:：]\s*([^|]+)/.exec(String(notes || ''));
  return match ? detectPart(match[1]) : null;
};

const resolvePartKey = (value: string | null | undefined, fallback: GarmentPart = 'shirt'): GarmentPart =>
  detectPart(value) || fallback;

const partQtyFields: Record<GarmentPart, keyof DesignModel> = {
  shirt: 'cut_shirt_pieces',
  pants: 'cut_pants_pieces',
  jacket: 'cut_jacket_pieces',
  single: 'total_cut_pieces'
};

const qcQtyFields: Record<GarmentPart, keyof DesignModel> = {
  shirt: 'qc_shirt_pieces',
  pants: 'qc_pants_pieces',
  jacket: 'qc_jacket_pieces',
  single: 'count_after_sewing'
};

const unitLabel = (unit?: string | null): string => String(unit || 'وحدة');

type UnitQty = { unit: string; qty: number };

const addUnitQty = (bucket: Map<string, number>, unit: string | null | undefined, qty: number): void => {
  if (!qty) return;
  const key = unitLabel(unit);
  bucket.set(key, round2((bucket.get(key) || 0) + qty));
};

const unitQtyList = (bucket: Map<string, number>): UnitQty[] =>
  Array.from(bucket.entries())
    .filter(([, qty]) => Math.abs(qty) > 0.0001)
    .map(([unit, qty]) => ({ unit, qty: round2(qty) }));

const formatUnitQty = (items: UnitQty[]): string =>
  items.length === 0 ? '0' : items.map((item) => `${fmt(item.qty)} ${item.unit}`).join(' • ');

const tableClass = 'w-full min-w-[560px] text-right text-xs';
const thClass = 'border-b border-slate-200 bg-slate-50 px-2 py-2 font-semibold text-slate-500';
const tdClass = 'border-b border-slate-100 px-2 py-2 text-slate-700';

/** فتح نافذة طباعة موحّدة بهيدر المصنع المتكرر في كل صفحة (A4 Landscape). */
const usePrintWindow = () => {
  const { globalSettings } = useApp();
  return (title: string, bodyHtml: string, orientation: 'portrait' | 'landscape' = 'landscape') => {
    const siteName = globalSettings?.site_name || 'نظام إدارة المصنع';
    const opened = openUnifiedPrintWindow({
      documentTitle: title,
      mode: 'multi-page-table',
      orientation,
      header: {
        siteName,
        logo: globalSettings?.logo,
        title,
        subtitle: 'تقارير الخامات واستهلاك الموديلات — A4'
      },
      bodyHtml: `${bodyHtml}${renderSignatureBar(['إعداد التقرير', 'مراقبة المخازن والإنتاج', 'اعتماد الإدارة'], true)}`,
      extraCss: `
        h2 {
          font-size: 11px;
          font-weight: 800;
          margin: 9px 0 4px;
          padding: 3.5px 8px;
          background: #f1f5f9;
          border-right: 3.5px solid #0f172a;
          border-top: 1px solid #cbd5e1;
          border-bottom: 1px solid #cbd5e1;
          border-left: 1px solid #cbd5e1;
          border-radius: 4px;
          break-after: avoid;
          page-break-after: avoid;
        }
        h3 {
          font-size: 10.5px;
          font-weight: 800;
          margin: 8px 0 3px;
          color: #0f172a;
          background: #f8fafc;
          border-right: 3px solid #334155;
          padding: 3px 7px;
          break-after: avoid;
          page-break-after: avoid;
        }
        table:not(.print-shell) { font-size: 8.8px; margin-bottom: 7px; }
        table:not(.print-shell) th, table:not(.print-shell) td { padding: 3.5px 4px; text-align: right; vertical-align: top; }
        table:not(.print-shell) td.num, table:not(.print-shell) th.num { text-align: center; }
        .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 5px; margin-bottom: 7px; break-inside: avoid; page-break-inside: avoid; }
        .card { border: 1px solid #cbd5e1; border-radius: 5px; padding: 4px 7px; background: #f8fafc; font-size: 9px; color: #475569; font-weight: 700; }
        .card b { display: block; font-size: 12px; color: #0f172a; margin-top: 2px; font-weight: 800; }
        .kv { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px 10px; font-size: 9.5px; margin-bottom: 6px; break-inside: avoid; page-break-inside: avoid; }
        .kv span { border-bottom: 1px dotted #cbd5e1; padding: 2px 0; }
      `
    });
    if (opened) {
      logClientPrintAction('التقارير', `طباعة تقرير: ${title}`, title);
    }
    return opened;
  };
};

/* ------------------------------------------------------------------ */
/* Materials report types                                             */
/* ------------------------------------------------------------------ */

type BreakdownItem = { label: string; qty: number; percent: number };

type FabricColorAudit = {
  id: string;
  colorCode: string;
  colorName: string;
  hexCode: string;
  unit: string;
  supplierId: string;
  supplierName: string;
  price: number | null;
  consumedValue: number | null;
  totalReceived: number;
  totalConsumed: number;
  totalReturned: number;
  /** عيوب القماش المسجلة عند إرجاع الفائض (لا تُضاف للرصيد ولا تُحسب استهلاكاً). */
  totalDefects: number;
  netConsumed: number;
  remaining: number;
  reserved: number;
  modelCodes: string[];
  sizeBreakdown: BreakdownItem[];
  typeBreakdown: BreakdownItem[];
};

type FabricAuditGroup = {
  fabricId: string;
  fabricName: string;
  unit: string;
  colors: FabricColorAudit[];
};

type AccessoryAuditRow = {
  item: AccessoryItem;
  supplierId: string;
  supplierName: string;
  totalReceived: number;
  totalConsumed: number;
  totalReturned: number;
  remaining: number;
  reserved: number;
  modelCodes: string[];
  price: number | null;
  consumedValue: number | null;
};

/* ------------------------------------------------------------------ */
/* Small presentational helpers                                       */
/* ------------------------------------------------------------------ */

const StatTile: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon: React.ReactNode;
  tone?: 'slate' | 'emerald' | 'rose' | 'amber' | 'indigo';
}> = ({ label, value, hint, icon, tone = 'slate' }) => {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    rose: 'bg-rose-50 text-rose-600',
    amber: 'bg-amber-50 text-amber-600',
    indigo: 'bg-indigo-50 text-indigo-600'
  };
  return (
    <div className={`${cardClass} p-4`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}>
          {icon}
        </span>
      </div>
      <p className="mt-2 break-words text-lg font-bold text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-slate-400">{hint}</p> : null}
    </div>
  );
};

const BreakdownBars: React.FC<{ title: string; items: BreakdownItem[]; color: string }> = ({
  title,
  items,
  color
}) => (
  <div>
    <p className="mb-2 text-[11px] font-semibold text-slate-500">{title}</p>
    {items.length === 0 ? (
      <p className="text-[11px] text-slate-400">لا يوجد استهلاك مرتبط بهذا التصنيف.</p>
    ) : (
      <div className="space-y-1.5">
        {items.map((item) => (
          <div key={item.label}>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-600">{item.label}</span>
              <span className="tabular-nums text-slate-500">
                {fmt(item.qty)} • {item.percent}%
              </span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.min(100, item.percent)}%`, backgroundColor: color }}
              />
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

const EmptyNote: React.FC<{ text: string }> = ({ text }) => (
  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-xs text-slate-500">
    {text}
  </div>
);

const MiniStat: React.FC<{ label: string; value: React.ReactNode; tone?: string }> = ({
  label,
  value,
  tone = 'text-slate-900'
}) => (
  <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-center">
    <p className="text-[10px] text-slate-500">{label}</p>
    <p className={`mt-0.5 text-sm font-bold tabular-nums ${tone}`}>{value}</p>
  </div>
);

const ModelCodeChips: React.FC<{ codes: string[]; max?: number }> = ({ codes, max = 8 }) => {
  if (codes.length === 0) return <span className="text-[11px] text-slate-400">لا توجد موديلات مرتبطة</span>;
  const shown = codes.slice(0, max);
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((code) => (
        <span
          key={code}
          className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600"
        >
          {code}
        </span>
      ))}
      {codes.length > shown.length ? (
        <span className="text-[10px] text-slate-400">+{codes.length - shown.length}</span>
      ) : null}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Materials & accessories report                                     */
/* ------------------------------------------------------------------ */

export const MaterialsReportSection: React.FC<{ refreshTick?: number }> = ({ refreshTick = 0 }) => {
  const {
    models,
    sizeDefs,
    suppliers,
    fabrics,
    fabricColors,
    fabricTransactions: stateFabricTransactions,
    accessoryItems,
    accessoryTransactions: stateAccessoryTransactions,
    canViewFabricPrices,
    canViewAccessoryPrices
  } = useApp();
  const [fullFabricTxns, setFullFabricTxns] = useState<FabricTransaction[] | null>(null);
  const [fullAccessoryTxns, setFullAccessoryTxns] = useState<typeof stateAccessoryTransactions | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.getFabricTransactions().catch(() => null),
      api.getAccessoryTransactions().catch(() => null)
    ]).then(([fTxns, aTxns]) => {
      if (!active) return;
      if (Array.isArray(fTxns)) setFullFabricTxns(fTxns);
      if (Array.isArray(aTxns)) setFullAccessoryTxns(aTxns);
    });
    return () => {
      active = false;
    };
  }, [refreshTick, stateFabricTransactions.length, stateAccessoryTransactions.length]);

  const fabricTransactions = fullFabricTxns ?? stateFabricTransactions;
  const accessoryTransactions = fullAccessoryTxns ?? stateAccessoryTransactions;
  const openPrint = usePrintWindow();

  const [activeSection, setActiveSection] = useState<'fabric' | 'accessory'>('fabric');
  const [search, setSearch] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [materialFilter, setMaterialFilter] = useState('all');

  const sizeById = useMemo(() => {
    const map = new Map<string, SizeDef>();
    sizeDefs.forEach((size) => {
      map.set(String(size.id), size);
    });
    return map;
  }, [sizeDefs]);

  const supplierById = useMemo(() => {
    const map = new Map<string, string>();
    suppliers.forEach((supplier) => {
      map.set(String(supplier.id), supplier.name);
    });
    return map;
  }, [suppliers]);

  /* ---------------------- fabric audit (per color) ------------------- */
  const fabricGroups = useMemo<FabricAuditGroup[]>(() => {
    const modelById = new Map<string, DesignModel>();
    const modelByCode = new Map<string, DesignModel>();
    models.filter((model) => !model.is_deleted).forEach((model) => {
      modelById.set(String(model.id), model);
      modelByCode.set(normalizeCode(model.model_code), model);
    });

    const txByColor = new Map<string, FabricTransaction[]>();
    fabricTransactions.forEach((txn) => {
      const key = String(txn.color_id || '');
      if (!key) return;
      if (!txByColor.has(key)) txByColor.set(key, []);
      txByColor.get(key)!.push(txn);
    });

    const groups: FabricAuditGroup[] = [];
    fabrics
      .filter((fabric) => !fabric.is_deleted)
      .forEach((fabric) => {
        const colors = fabricColors
          .filter((color) => color.fabric_id === fabric.id)
          .map<FabricColorAudit>((color) => {
            const txns = txByColor.get(color.id) || [];
            const sizeBucket = new Map<string, number>();
            const typeBucket = new Map<string, number>();
            const codes = new Set<string>();
            const currentColorPrice = Number(color.price_per_unit || 0);
            let consumed = 0;
            let returned = 0;
            let defects = 0;
            let net = 0;
            let rawConsumedValue = 0;
            let weightedPriceNumerator = 0;
            let weightedPriceDenominator = 0;

            txns.forEach((txn) => {
              const amount = Number(txn.amount || 0);
              const snapPrice = Number(txn.unit_price_snapshot || 0);
              const txnUnitPrice = snapPrice > 0 ? snapPrice : currentColorPrice;
              if (txn.operation === 'defect') {
                // العيوب تُسجل كهدر مستقل: لا تُضاف للرصيد ولا تُحسب استهلاكاً.
                defects += amount;
                return;
              }
              const netQty = netFabricQty(txn);
              if (!netQty) return;
              net += netQty;
              if (txn.operation === 'deduct') {
                consumed += amount;
                rawConsumedValue += amount * txnUnitPrice;
                if (txnUnitPrice > 0 && amount > 0) {
                  weightedPriceNumerator += amount * txnUnitPrice;
                  weightedPriceDenominator += amount;
                }
              } else {
                returned += amount;
                rawConsumedValue -= amount * txnUnitPrice;
              }

              const code = String(txn.model_code_ref || '').trim();
              if (code) codes.add(code);
              const model = txn.model_id
                ? modelById.get(String(txn.model_id))
                : modelByCode.get(normalizeCode(code));
              const sizeName = model?.size_category_id
                ? sizeById.get(String(model.size_category_id))?.name || 'فئة مقاس غير معروفة'
                : 'بدون فئة مقاس';
              const typeName = model?.model_type?.trim() || 'غير محدد';
              sizeBucket.set(sizeName, (sizeBucket.get(sizeName) || 0) + netQty);
              typeBucket.set(typeName, (typeBucket.get(typeName) || 0) + netQty);
            });

            const netConsumed = round2(Math.max(0, net - defects));
            // البسط يجمع netQty (قبل طرح الهالك)، لذا نقسم على إجمالي الصافي |net| حتى لا تتجاوز النسب 100%.
            const breakdownTotal = Math.abs(net);
            const buildBreakdown = (bucket: Map<string, number>): BreakdownItem[] =>
              Array.from(bucket.entries())
                .map(([label, qty]) => ({
                  label,
                  qty: round2(qty),
                  percent: percentOf(Math.abs(qty), breakdownTotal)
                }))
                .sort((a, b) => Math.abs(b.qty) - Math.abs(a.qty));

            const supplierFromTxn = txns.find((txn) => txn.supplier_id)?.supplier_id || '';
            const supplierId = fabric.supplier_id || supplierFromTxn;
            const weightedAvgPrice =
              weightedPriceDenominator > 0
                ? round2(weightedPriceNumerator / weightedPriceDenominator)
                : 0;
            // سعر تقييم المتبقي: السعر الحالي بالخامة ثم المتوسط المرجّح للحركات التاريخية.
            const price = canViewFabricPrices()
              ? currentColorPrice > 0
                ? currentColorPrice
                : weightedAvgPrice > 0
                ? weightedAvgPrice
                : (color.price_per_unit ?? null)
              : null;
            const consumedValue = canViewFabricPrices()
              ? round2(Math.max(0, rawConsumedValue))
              : null;

            return {
              id: color.id,
              colorCode: color.color_code || '',
              colorName: color.color_name || '',
              hexCode: safeHex(color.hex_code),
              unit: unitLabel(fabric.unit),
              supplierId: String(supplierId || ''),
              supplierName: supplierById.get(String(supplierId || '')) || '—',
              price,
              consumedValue,
              totalReceived: round2(Number(color.quantity || 0) + netConsumed + defects),
              totalConsumed: round2(consumed),
              totalReturned: round2(returned),
              totalDefects: round2(defects),
              netConsumed,
              remaining: round2(color.quantity || 0),
              reserved: round2(color.reserved_quantity || 0),
              modelCodes: Array.from(codes).sort(),
              sizeBreakdown: buildBreakdown(sizeBucket),
              typeBreakdown: buildBreakdown(typeBucket)
            };
          })
          .sort((a, b) => Math.abs(b.netConsumed) - Math.abs(a.netConsumed));

        if (colors.length > 0) {
          groups.push({
            fabricId: fabric.id,
            fabricName: fabric.name,
            unit: unitLabel(fabric.unit),
            colors
          });
        }
      });

    return groups;
  }, [fabrics, fabricColors, fabricTransactions, models, sizeById, supplierById, canViewFabricPrices]);



  /* --------------------- accessories audit rows ---------------------- */
  const accessoryRows = useMemo<AccessoryAuditRow[]>(() => {
    return accessoryItems
      .map<AccessoryAuditRow>((item) => {
        const txns = accessoryTransactions.filter(
          (txn) =>
            String(txn.accessory_id || '') === String(item.id) ||
            (!!txn.accessory_code && txn.accessory_code === item.code)
        );
        const currentItemPrice = Number(item.price_per_unit || 0);
        let consumed = 0;
        let returned = 0;
        let rawConsumedValue = 0;
        let weightedPriceNum = 0;
        let weightedPriceDen = 0;
        const codes = new Set<string>();

        txns.forEach((txn) => {
          const amount = Number(txn.amount || 0);
          const snapPrice = Number(txn.unit_price_snapshot || 0);
          const txnUnitPrice = snapPrice > 0 ? snapPrice : currentItemPrice;
          if (txn.operation === 'deduct') {
            consumed += amount;
            rawConsumedValue += amount * txnUnitPrice;
            if (txnUnitPrice > 0 && amount > 0) {
              weightedPriceNum += amount * txnUnitPrice;
              weightedPriceDen += amount;
            }
            if (txn.model_code_ref) codes.add(String(txn.model_code_ref).trim());
          } else if (isAccessoryReturn(txn.notes)) {
            returned += amount;
            rawConsumedValue -= amount * txnUnitPrice;
          }
        });

        // ربط الإكسسوار بالموديلات من بطاقة الموديل نفسها (حتى لو لم تُسجّل حركة صرف).
        models.forEach((model) => {
          if (model.is_deleted) return;
          (model.accessories || []).forEach((acc: ModelAccessory) => {
            const sameItem =
              (!!acc.accessory_id && String(acc.accessory_id) === String(item.id)) ||
              (!!acc.accessory_code && acc.accessory_code === item.code);
            if (sameItem) codes.add(model.model_code);
          });
        });

        const net = round2(consumed - returned);
        const supplierFromTxn = txns.find((txn) => txn.supplier_id)?.supplier_id || '';
        const supplierId = item.supplier_id || supplierFromTxn;
        const weightedAvgPrice =
          weightedPriceDen > 0 ? round2(weightedPriceNum / weightedPriceDen) : 0;
        const price = canViewAccessoryPrices()
          ? weightedAvgPrice > 0
            ? weightedAvgPrice
            : currentItemPrice > 0
            ? currentItemPrice
            : (item.price_per_unit ?? null)
          : null;

        return {
          item,
          supplierId: String(supplierId || ''),
          supplierName: supplierById.get(String(supplierId || '')) || '—',
          totalReceived: round2(Number(item.quantity || 0) + net),
          totalConsumed: round2(consumed),
          totalReturned: round2(returned),
          remaining: round2(item.quantity || 0),
          reserved: round2(item.reserved_quantity || 0),
          modelCodes: Array.from(codes).sort(),
          price,
          consumedValue: canViewAccessoryPrices() ? round2(Math.max(0, rawConsumedValue)) : null
        };
      })
      .sort((a, b) => b.totalConsumed - a.totalConsumed);
  }, [accessoryItems, accessoryTransactions, models, supplierById, canViewAccessoryPrices]);

  /* ---------------------------- filters ------------------------------ */
  const fabricMaterialOptions = useMemo(
    () => fabricGroups.map((group) => ({ id: group.fabricId, label: group.fabricName })),
    [fabricGroups]
  );
  const accessoryMaterialOptions = useMemo(
    () => uniq(accessoryRows.map((row) => row.item.type_name)).sort(),
    [accessoryRows]
  );
  const supplierOptions = useMemo(() => {
    const source =
      activeSection === 'fabric'
        ? fabricGroups.flatMap((group) =>
            group.colors.map((color) => ({ id: color.supplierId, name: color.supplierName }))
          )
        : accessoryRows.map((row) => ({ id: row.supplierId, name: row.supplierName }));
    const map = new Map<string, string>();
    source.forEach((entry) => {
      if (entry.id) map.set(entry.id, entry.name);
    });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [activeSection, fabricGroups, accessoryRows]);

  const filteredFabricGroups = useMemo(() => {
    return fabricGroups
      .map((group) => ({
        ...group,
        colors: group.colors.filter(
          (color) =>
            (materialFilter === 'all' || group.fabricId === materialFilter) &&
            (supplierFilter === 'all' || color.supplierId === supplierFilter) &&
            matchText(search, [
              group.fabricName,
              color.colorCode,
              color.colorName,
              color.supplierName,
              color.modelCodes.join(' ')
            ])
        )
      }))
      .filter((group) => group.colors.length > 0);
  }, [fabricGroups, materialFilter, supplierFilter, search]);

  const filteredAccessoryRows = useMemo(() => {
    return accessoryRows.filter(
      (row) =>
        (materialFilter === 'all' || row.item.type_name === materialFilter) &&
        (supplierFilter === 'all' || row.supplierId === supplierFilter) &&
        matchText(search, [
          row.item.code,
          row.item.name,
          row.item.type_name,
          row.supplierName,
          row.modelCodes.join(' ')
        ])
    );
  }, [accessoryRows, materialFilter, supplierFilter, search]);

  /* ---------------------------- totals ------------------------------- */
  const fabricTotals = useMemo(() => {
    const received = new Map<string, number>();
    const consumed = new Map<string, number>();
    const defects = new Map<string, number>();
    const remaining = new Map<string, number>();
    const reserved = new Map<string, number>();
    filteredFabricGroups.forEach((group) => {
      group.colors.forEach((color) => {
        addUnitQty(received, color.unit, color.totalReceived);
        addUnitQty(consumed, color.unit, color.netConsumed);
        addUnitQty(defects, color.unit, color.totalDefects);
        addUnitQty(remaining, color.unit, color.remaining);
        addUnitQty(reserved, color.unit, color.reserved);
      });
    });
    return {
      received: unitQtyList(received),
      consumed: unitQtyList(consumed),
      defects: unitQtyList(defects),
      remaining: unitQtyList(remaining),
      reserved: unitQtyList(reserved),
      colors: filteredFabricGroups.reduce((sum, group) => sum + group.colors.length, 0),
      fabrics: filteredFabricGroups.length
    };
  }, [filteredFabricGroups]);

  const accessoryTotals = useMemo(() => {
    const received = new Map<string, number>();
    const consumed = new Map<string, number>();
    const remaining = new Map<string, number>();
    const reserved = new Map<string, number>();
    filteredAccessoryRows.forEach((row) => {
      addUnitQty(received, row.item.unit, row.totalReceived);
      addUnitQty(consumed, row.item.unit, row.totalConsumed);
      addUnitQty(remaining, row.item.unit, row.remaining);
      addUnitQty(reserved, row.item.unit, row.reserved);
    });
    return {
      received: unitQtyList(received),
      consumed: unitQtyList(consumed),
      remaining: unitQtyList(remaining),
      reserved: unitQtyList(reserved),
      items: filteredAccessoryRows.length
    };
  }, [filteredAccessoryRows]);

  /* ---------------------------- printing ----------------------------- */
  const printMaterialsReportRef = useRef<() => void>(() => {});
  const printMaterialsReport = () => {
    const title =
      activeSection === 'fabric'
        ? 'تقرير الخامات — الأقمشة والألوان'
        : 'تقرير الخامات — الإكسسوارات ومستلزمات التشغيل';
    const showFabricPrices = canViewFabricPrices();
    const showAccessoryPrices = canViewAccessoryPrices();

    if (activeSection === 'fabric') {
      const priceHeads = showFabricPrices ? '<th>سعر الوحدة</th><th>قيمة المتبقي</th>' : '';
      const groupHtml = filteredFabricGroups
        .map((group) => {
          const rows = group.colors
            .map((color) => {
              const priceCells = showFabricPrices
                ? `<td class="num">${money(color.price)}</td><td class="num">${money(
                    color.price === null ? null : color.price * color.remaining
                  )}</td>`
                : '';
              return `<tr>
                <td>${escapeHtml(color.colorCode)}${color.colorName ? ` — ${escapeHtml(color.colorName)}` : ''}</td>
                <td>${escapeHtml(color.supplierName)}</td>
                <td class="num">${fmt(color.totalReceived)}</td>
                <td class="num">${fmt(color.totalConsumed)}</td>
                <td class="num">${fmt(color.totalReturned)}</td>
                <td class="num">${fmt(color.totalDefects)}</td>
                <td class="num">${fmt(color.netConsumed)}</td>
                <td class="num">${fmt(color.remaining)}</td>
                <td class="num">${fmt(color.reserved)}</td>
                <td>${escapeHtml(color.sizeBreakdown.map((item) => `${item.label} ${item.percent}%`).join(' • ') || '—')}</td>
                <td>${escapeHtml(color.typeBreakdown.map((item) => `${item.label} ${item.percent}%`).join(' • ') || '—')}</td>
                <td>${escapeHtml(color.modelCodes.join('، ') || '—')}</td>
                ${priceCells}
              </tr>`;
            })
            .join('');
          return `<h3>${escapeHtml(group.fabricName)} — الوحدة: ${escapeHtml(group.unit)}</h3>
            <table>
              <thead><tr>
                <th>اللون</th><th>المورد</th><th>الوارد</th><th>المستهلك</th><th>المرتجع</th>
                <th>العيوب</th>
                <th>الصافي</th><th>المتبقي</th><th>المحجوز</th><th>فئات المقاسات</th><th>نوع الموديل</th>
                <th>الموديلات المستخدمة</th>${priceHeads}
              </tr></thead>
              <tbody>${rows || '<tr><td colspan="14">لا توجد ألوان</td></tr>'}</tbody>
            </table>`;
        })
        .join('');

      openPrint(
        title,
        `<div class="cards">
          <div class="card">عدد الأقمشة<b>${fmt(fabricTotals.fabrics)}</b></div>
          <div class="card">عدد الألوان<b>${fmt(fabricTotals.colors)}</b></div>
          <div class="card">إجمالي المستهلك<b>${escapeHtml(formatUnitQty(fabricTotals.consumed))}</b></div>
          <div class="card">إجمالي العيوب<b>${escapeHtml(formatUnitQty(fabricTotals.defects))}</b></div>
          <div class="card">إجمالي المتبقي<b>${escapeHtml(formatUnitQty(fabricTotals.remaining))}</b></div>
        </div>
        ${groupHtml || '<p class="muted">لا توجد بيانات مطابقة للفلاتر الحالية.</p>'}`,
        'landscape'
      );
      return;
    }

    const priceHeads = showAccessoryPrices ? '<th>سعر الوحدة</th><th>قيمة المستهلك</th>' : '';
    const rows = filteredAccessoryRows
      .map((row) => {
        const priceCells = showAccessoryPrices
          ? `<td class="num">${money(row.price)}</td><td class="num">${money(row.consumedValue)}</td>`
          : '';
        return `<tr>
          <td>${escapeHtml(row.item.type_name)}</td>
          <td>${escapeHtml(row.item.code)}</td>
          <td>${escapeHtml(row.item.name)}</td>
          <td>${escapeHtml(row.item.unit || '')}</td>
          <td>${escapeHtml(row.supplierName)}</td>
          <td class="num">${fmt(row.totalReceived)}</td>
          <td class="num">${fmt(row.totalConsumed)}</td>
          <td class="num">${fmt(row.totalReturned)}</td>
          <td class="num">${fmt(row.remaining)}</td>
          <td class="num">${fmt(row.reserved)}</td>
          <td>${escapeHtml(row.modelCodes.join('، ') || '—')}</td>
          ${priceCells}
        </tr>`;
      })
      .join('');

    openPrint(
      title,
      `<div class="cards">
        <div class="card">عدد الإكسسوارات<b>${fmt(accessoryTotals.items)}</b></div>
        <div class="card">إجمالي المستهلك<b>${escapeHtml(formatUnitQty(accessoryTotals.consumed))}</b></div>
        <div class="card">إجمالي المتبقي<b>${escapeHtml(formatUnitQty(accessoryTotals.remaining))}</b></div>
        <div class="card">المحجوز<b>${escapeHtml(formatUnitQty(accessoryTotals.reserved))}</b></div>
      </div>
      <table>
        <thead><tr>
          <th>الفئة</th><th>الكود</th><th>الاسم</th><th>الوحدة</th><th>المورد</th>
          <th>الوارد</th><th>المستهلك</th><th>المرتجع</th><th>المتبقي</th><th>المحجوز</th>
          <th>الموديلات المستخدمة</th>${priceHeads}
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="13">لا توجد بيانات مطابقة للفلاتر الحالية.</td></tr>'}</tbody>
      </table>`,
      'landscape'
    );
  };
  printMaterialsReportRef.current = printMaterialsReport;

  useEffect(() => {
    const handler = () => printMaterialsReportRef.current();
    window.addEventListener('erp:print-materials-report', handler);
    return () => window.removeEventListener('erp:print-materials-report', handler);
  }, []);

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-l from-slate-900 via-slate-800 to-emerald-900 p-5 text-white shadow-lg">
        <div className="absolute -left-10 -top-12 h-40 w-40 rounded-full bg-emerald-400/20 blur-2xl" />
        <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-emerald-200">مركز تقارير الخامات</p>
            <h2 className="mt-1 text-xl font-bold">تقارير الخامات والاستهلاك</h2>
            <p className="mt-1 max-w-2xl text-xs leading-6 text-slate-200">
              متابعة الأقمشة والألوان والإكسسوارات: الوارد، الصرف للموديلات، المرتجعات، المتبقي، وتوزيع الاستهلاك
              على فئات المقاسات وأنواع الموديلات.
            </p>
          </div>
          <button
            type="button"
            onClick={printMaterialsReport}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-bold text-slate-900 shadow transition hover:bg-emerald-50"
          >
            <Printer size={16} /> طباعة التقرير (A4)
          </button>
        </div>
        <div className="relative z-10 mt-4 inline-flex rounded-xl bg-white/10 p-1">
          <button
            type="button"
            onClick={() => {
              setActiveSection('fabric');
              setMaterialFilter('all');
              setSupplierFilter('all');
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              activeSection === 'fabric' ? 'bg-white text-slate-900 shadow' : 'text-white/80 hover:text-white'
            }`}
          >
            <Palette size={14} /> الأقمشة والألوان
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveSection('accessory');
              setMaterialFilter('all');
              setSupplierFilter('all');
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              activeSection === 'accessory' ? 'bg-white text-slate-900 shadow' : 'text-white/80 hover:text-white'
            }`}
          >
            <Tag size={14} /> الإكسسوارات
          </button>
        </div>
      </div>

      <div className={`${cardClass} p-4`}>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ابحث باسم الخامة أو اللون أو المورد أو كود الموديل"
              className={`${inputClass} pr-9`}
            />
          </label>
          <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)} className={inputClass}>
            <option value="all">كل الموردين</option>
            {supplierOptions.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
          <select value={materialFilter} onChange={(event) => setMaterialFilter(event.target.value)} className={inputClass}>
            <option value="all">{activeSection === 'fabric' ? 'كل أنواع الأقمشة' : 'كل فئات الإكسسوار'}</option>
            {activeSection === 'fabric'
              ? fabricMaterialOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))
              : accessoryMaterialOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
          </select>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
          <span>
            {activeSection === 'fabric'
              ? `${fmt(fabricTotals.fabrics)} قماش • ${fmt(fabricTotals.colors)} لون مطابق`
              : `${fmt(accessoryTotals.items)} إكسسوار مطابق`}
          </span>
          {search || supplierFilter !== 'all' || materialFilter !== 'all' ? (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setSupplierFilter('all');
                setMaterialFilter('all');
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              <RotateCcw size={12} /> إعادة ضبط الفلاتر
            </button>
          ) : null}
        </div>
      </div>


      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {activeSection === 'fabric' ? (
          <>
            <StatTile
              label="الأقمشة / الألوان"
              value={`${fmt(fabricTotals.fabrics)} / ${fmt(fabricTotals.colors)}`}
              hint="أقمشة وألوان مطابقة للفلاتر"
              icon={<Layers size={16} />}
            />
            <StatTile
              label="إجمالي الوارد"
              value={formatUnitQty(fabricTotals.received)}
              hint="المتبقي + صافي المستهلك"
              icon={<Package size={16} />}
              tone="indigo"
            />
            <StatTile
              label="صافي المستهلك"
              value={formatUnitQty(fabricTotals.consumed)}
              hint={`الصرف بعد خصم المرتجعات • عيوب: ${formatUnitQty(fabricTotals.defects)}`}
              icon={<Scissors size={16} />}
              tone="rose"
            />
            <StatTile
              label="المتبقي بالمخزن"
              value={formatUnitQty(fabricTotals.remaining)}
              hint={`المحجوز: ${formatUnitQty(fabricTotals.reserved)}`}
              icon={<Boxes size={16} />}
              tone="emerald"
            />
          </>
        ) : (
          <>
            <StatTile
              label="عدد الإكسسوارات"
              value={fmt(accessoryTotals.items)}
              hint="أصناف مطابقة للفلاتر"
              icon={<Tag size={16} />}
            />
            <StatTile
              label="إجمالي الوارد"
              value={formatUnitQty(accessoryTotals.received)}
              hint="المتبقي + صافي المستهلك"
              icon={<Package size={16} />}
              tone="indigo"
            />
            <StatTile
              label="إجمالي المستهلك"
              value={formatUnitQty(accessoryTotals.consumed)}
              hint="حركات الصرف للموديلات"
              icon={<Scissors size={16} />}
              tone="rose"
            />
            <StatTile
              label="المتبقي بالمخزن"
              value={formatUnitQty(accessoryTotals.remaining)}
              hint={`المحجوز: ${formatUnitQty(accessoryTotals.reserved)}`}
              icon={<Boxes size={16} />}
              tone="emerald"
            />
          </>
        )}
      </div>


      {activeSection === 'fabric' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-800">تفاصيل الأقمشة والألوان</h3>
            <p className="text-[11px] text-slate-500">الصافي = الصرف − المرتجعات، والوارد = المتبقي + الصافي.</p>
          </div>

          {filteredFabricGroups.length === 0 ? (
            <EmptyNote text="لا توجد أقمشة أو ألوان مطابقة للفلاتر الحالية." />
          ) : (
            filteredFabricGroups.map((group) => {
              const groupNet = round2(group.colors.reduce((sum, color) => sum + color.netConsumed, 0));
              const groupRemaining = round2(group.colors.reduce((sum, color) => sum + color.remaining, 0));
              return (
                <div key={group.fabricId} className={`${cardClass} overflow-hidden`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                        <Layers size={17} />
                      </span>
                      <div>
                        <p className="text-sm font-bold text-slate-800">{group.fabricName}</p>
                        <p className="text-[11px] text-slate-500">
                          {fmt(group.colors.length)} لون • وحدة القياس: {group.unit}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-[11px]">
                      <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-600">
                        صافي المستهلك: <b className="text-rose-600">{fmt(groupNet)} {group.unit}</b>
                      </span>
                      <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-600">
                        المتبقي: <b className="text-emerald-600">{fmt(groupRemaining)} {group.unit}</b>
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-3 p-3 xl:grid-cols-2">
                    {group.colors.map((color) => (
                      <div key={color.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className="h-9 w-9 shrink-0 rounded-lg border border-slate-200 shadow-inner"
                              style={{ backgroundColor: color.hexCode }}
                              title={color.hexCode}
                            />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-slate-800">
                                {color.colorCode || 'بدون كود'}
                                {color.colorName ? ` — ${color.colorName}` : ''}
                              </p>
                              <p className="truncate text-[11px] text-slate-500">المورد: {color.supplierName}</p>
                            </div>
                          </div>
                          <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">
                            {color.unit}
                          </span>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                          <MiniStat label="الوارد" value={fmt(color.totalReceived)} />
                          <MiniStat label="صافي المستهلك" value={fmt(color.netConsumed)} tone="text-rose-600" />
                          <MiniStat label="المتبقي" value={fmt(color.remaining)} tone="text-emerald-600" />
                          <MiniStat label="المحجوز" value={fmt(color.reserved)} tone="text-amber-600" />
                        </div>

                        {color.totalReturned > 0 ? (
                          <p className="mt-2 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">
                            <RotateCcw size={11} /> مرتجع من القص: {fmt(color.totalReturned)} {color.unit}
                          </p>
                        ) : null}

                        {color.totalDefects > 0 ? (
                          <p className="mt-2 inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">
                            <AlertTriangle size={11} /> عيوب قماش مسجلة: {fmt(color.totalDefects)} {color.unit}
                          </p>
                        ) : null}


                        <div className="mt-3">
                          <p className="mb-1 text-[10px] font-semibold text-slate-500">الموديلات المستخدمة</p>
                          <ModelCodeChips codes={color.modelCodes} />
                        </div>

                        <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
                          <BreakdownBars title="فئات المقاسات" items={color.sizeBreakdown} color="#4f46e5" />
                          <BreakdownBars title="أنواع الموديلات" items={color.typeBreakdown} color="#db2777" />
                        </div>

                        {color.price !== null ? (
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-indigo-50/70 px-2.5 py-2 text-[11px] text-indigo-800">
                            <span className="inline-flex items-center gap-1 font-semibold">
                              <Coins size={12} /> سعر الوحدة: {money(color.price)}
                            </span>
                            {color.consumedValue !== null && color.consumedValue > 0 ? (
                              <span className="font-semibold">قيمة المستهلك: {money(color.consumedValue)}</span>
                            ) : null}
                            <span className="font-semibold">قيمة المتبقي: {money(color.price * color.remaining)}</span>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-800">تفاصيل الإكسسوارات ومستلزمات التشغيل</h3>
            <p className="text-[11px] text-slate-500">الوارد = المتبقي + الصافي، والمحجوز يعكس الحجوزات غير المصروفة.</p>
          </div>

          {filteredAccessoryRows.length === 0 ? (
            <EmptyNote text="لا توجد إكسسوارات مطابقة للفلاتر الحالية." />
          ) : (
            <div className={`${cardClass} overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th className={thClass}>الفئة</th>
                      <th className={thClass}>الكود</th>
                      <th className={thClass}>الاسم</th>
                      <th className={thClass}>المورد</th>
                      <th className={thClass}>الوارد</th>
                      <th className={thClass}>مستهلك</th>
                      <th className={thClass}>مرتجع</th>
                      <th className={thClass}>متبقي</th>
                      <th className={thClass}>محجوز</th>
                      <th className={thClass}>الموديلات</th>
                      {canViewAccessoryPrices() ? <th className={thClass}>قيمة المستهلك</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAccessoryRows.map((row) => (
                      <tr key={row.item.id} className="transition hover:bg-slate-50/70">
                        <td className={tdClass}>
                          <span className="rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                            {row.item.type_name || 'عام'}
                          </span>
                        </td>
                        <td className={`${tdClass} font-semibold text-slate-500`}>{row.item.code}</td>
                        <td className={tdClass}>
                          <p className="font-semibold text-slate-800">{row.item.name}</p>
                          <p className="text-[10px] text-slate-400">الوحدة: {row.item.unit || '—'}</p>
                        </td>
                        <td className={tdClass}>{row.supplierName}</td>
                        <td className={`${tdClass} tabular-nums`}>{fmt(row.totalReceived)}</td>
                        <td className={`${tdClass} tabular-nums font-semibold text-rose-600`}>{fmt(row.totalConsumed)}</td>
                        <td className={`${tdClass} tabular-nums text-emerald-600`}>{fmt(row.totalReturned)}</td>
                        <td className={`${tdClass} tabular-nums font-semibold`}>{fmt(row.remaining)}</td>
                        <td className={`${tdClass} tabular-nums text-amber-600`}>{fmt(row.reserved)}</td>
                        <td className={`${tdClass} min-w-[150px]`}>
                          <ModelCodeChips codes={row.modelCodes} max={4} />
                        </td>
                        {canViewAccessoryPrices() ? (
                          <td className={`${tdClass} tabular-nums font-semibold text-indigo-700`}>
                            {money(row.consumedValue)}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};


/* ------------------------------------------------------------------ */
/* Detailed model consumption report                                  */
/* ------------------------------------------------------------------ */

type ModelPartUsage = {
  part: GarmentPart;
  planned: number;
  cut: number;
  qc: number;
  printed: number;
  sewn: number;
  finishingRecords: number;
};

type ModelFabricUsage = {
  key: string;
  fabricName: string;
  colorCode: string;
  colorName: string;
  hexCode: string;
  unit: string;
  qty: number;
  returned: number;
  partBreakdown: BreakdownItem[];
};

type ModelAccessoryUsage = {
  key: string;
  name: string;
  code: string;
  partLabel: string;
  unit: string;
  planned: number;
  perPiece: number;
  actual: number;
  price: number | null;
  value: number | null;
};

type ModelConsumptionReport = {
  parts: ModelPartUsage[];
  fabric: ModelFabricUsage[];
  fabricTotals: UnitQty[];
  accessories: ModelAccessoryUsage[];
  printing: { pieces: number; received: number; remaining: number; cost: number | null; shops: string[] };
  sewing: { pieces: number; received: number; remaining: number; cost: number | null; shops: string[] };
  qc: { good: number; defects: number; counted: number; byStage: BreakdownItem[] };
  finishing: { total: number; received: number; overdue: number; vendors: string[] };
  assembly: Array<{ stage: AssemblyStageKey; label: string; total: number; done: number }>;
  photography: PackagingRequirement | undefined;
  planTarget: number;
  actualCut: number;
  cutTotal: number;
  currentGood: number;
  shortage: number;
  shortagePercent: number;
};

const QC_STAGE_LABELS: Record<string, string> = {
  before_print: 'فرز قبل الطباعة',
  after_print: 'فرز بعد الطباعة',
  after_sewing: 'فرز بعد المكن'
};

const ASSEMBLY_LABELS: Record<AssemblyStageKey, string> = {
  ironing: 'المكواة',
  packaging: 'التعبئة والتغليف',
  dest: 'الدَست'
};

export const ModelConsumptionReportSection: React.FC<{
  refreshTick?: number;
  onNavigateToStage?: StageNavigateFn;
}> = ({ refreshTick = 0, onNavigateToStage }) => {
  const {
    models,
    sizeDefs,
    fabrics,
    fabricColors,
    fabricTransactions: stateFabricTransactions,
    accessoryTransactions: stateAccessoryTransactions,
    cuttingRecords,
    printDispatches,
    sewingDispatches,
    qcRecords,
    finishingRecords,
    assemblyStageRecords,
    getModelParts,
    getPartStages,
    getPackagingRequirement,
    hasPermission,
    hasAssemblyPackagingAccess,
    canViewFabricPrices,
    canViewAccessoryPrices,
    canViewPrintingPrices,
    canViewSewingPrices,
    canViewAssemblyPrices
  } = useApp();
  const [fullFabricTxns, setFullFabricTxns] = useState<FabricTransaction[] | null>(null);
  const [fullAccessoryTxns, setFullAccessoryTxns] = useState<typeof stateAccessoryTransactions | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.getFabricTransactions().catch(() => null),
      api.getAccessoryTransactions().catch(() => null)
    ]).then(([fTxns, aTxns]) => {
      if (!active) return;
      if (Array.isArray(fTxns)) setFullFabricTxns(fTxns);
      if (Array.isArray(aTxns)) setFullAccessoryTxns(aTxns);
    });
    return () => {
      active = false;
    };
  }, [refreshTick, stateFabricTransactions.length, stateAccessoryTransactions.length]);

  const fabricTransactions = fullFabricTxns ?? stateFabricTransactions;
  const accessoryTransactions = fullAccessoryTxns ?? stateAccessoryTransactions;
  const openPrint = usePrintWindow();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [showAllFabric, setShowAllFabric] = useState(false);

  const activeModels = useMemo(
    () => models.filter((model) => !model.is_deleted),
    [models]
  );

  const filteredModels = useMemo(
    () =>
      activeModels.filter(
        (model) =>
          (typeFilter === 'all' || model.model_type === typeFilter) &&
          matchText(search, [model.model_code, model.model_type, model.status])
      ),
    [activeModels, search, typeFilter]
  );

  const selectedModel = useMemo(
    () => filteredModels.find((model) => model.id === selectedId) || filteredModels[0],
    [filteredModels, selectedId]
  );

  const typeOptions = useMemo(() => uniq(activeModels.map((model) => model.model_type)).sort(), [activeModels]);

  const sizeById = useMemo(() => {
    const map = new Map<string, SizeDef>();
    sizeDefs.forEach((size) => map.set(String(size.id), size));
    return map;
  }, [sizeDefs]);


  const report = useMemo<ModelConsumptionReport | null>(() => {
    if (!selectedModel) return null;
    const model = selectedModel;
    const modelId = String(model.id);
    const code = normalizeCode(model.model_code);

    const rawParts = getModelParts(model.id) || [];
    const fallbackParts = model.garment_parts?.length
      ? model.garment_parts
      : partsForComposition(model.garment_composition);
    const parts: GarmentPart[] = Array.from(new Set(rawParts.length ? rawParts : fallbackParts));
    const safeParts = parts.length ? parts : (['shirt'] as GarmentPart[]);
    const isLegacy = !(model.garment_parts || []).length;

    const prints = printDispatches.filter((dispatch) => String(dispatch.model_id) === modelId);
    const sews = sewingDispatches.filter((dispatch) => String(dispatch.model_id) === modelId);
    const finishes = finishingRecords.filter((record) => String(record.model_id) === modelId);
    const assemblies = assemblyStageRecords.filter((record) => String(record.model_id) === modelId);
    const modelQc = qcRecords.filter((record) => String(record.model_id) === modelId);
    const modelCuts = cuttingRecords.filter((record) => String(record.model_id) === modelId);

    const resolveDispatchPart = (pieceType?: string | null, pieceLabel?: string | null): GarmentPart => {
      const detected = detectPart(pieceType) || detectPart(pieceLabel);
      if (detected && safeParts.includes(detected)) return detected;
      return safeParts.length === 1 ? safeParts[0] : 'shirt';
    };

    const cutPieces = (part: GarmentPart): number => {
      const fieldValue = Number((model[partQtyFields[part]] as number | undefined) || 0);
      if (fieldValue > 0) return fieldValue;
      const fromRecords = modelCuts
        .filter(
          (record) =>
            !(record.is_sub_cut ?? record.isSubCut ?? false) &&
            resolveDispatchPart(record.part_type || record.part, null) === part
        )
        .reduce((sum, record) => sum + Number(record.pieces_count || 0), 0);
      return fromRecords;
    };
    const qcPieces = (part: GarmentPart): number =>
      Number((model[qcQtyFields[part]] as number | undefined) || 0);

    const partRows: ModelPartUsage[] = safeParts.map((part) => ({
      part,
      planned: Number(model.target_cut_quantity || 0) || cutPieces(part),
      cut: cutPieces(part),
      qc: qcPieces(part),
      printed: prints
        .filter((dispatch) => resolveDispatchPart(dispatch.piece_type, dispatch.piece_label) === part)
        .reduce((sum, dispatch) => sum + Number(dispatch.pieces_count || 0), 0),
      sewn: sews
        .filter((dispatch) => resolveDispatchPart(dispatch.piece_type, dispatch.piece_label) === part)
        .reduce((sum, dispatch) => sum + Number(dispatch.pieces_count || 0), 0),
      finishingRecords: finishes.filter((record) => resolvePartKey(record.part_type, 'shirt') === part).length
    }));

    const sumCut = partRows.reduce((sum, row) => sum + row.cut, 0);
    const cutTotal =
      Number(model.total_cut_pieces || 0) ||
      (safeParts.length === 1 ? sumCut : Math.min(...partRows.map((row) => row.cut)));
    const actualCut = Number(model.actual_cut_count || 0) || cutTotal;

    const stageText = String(model.status || '');
    let currentGood = cutTotal;
    if (!/تصميم|قص/.test(stageText)) {
      const positiveQc = partRows.map((row) => row.qc).filter((value) => value > 0);
      if (positiveQc.length > 0) {
        currentGood = isLegacy ? partRows.reduce((sum, row) => sum + row.qc, 0) : Math.min(...positiveQc);
      } else {
        currentGood = Number(
          model.count_after_sewing || model.count_after_print || model.count_before_print || cutTotal
        );
      }
      const photoOut = Math.max(0, Number(model.photography_outstanding_qty || 0));
      currentGood = Math.max(0, currentGood - photoOut);
    }
    const shortage = Math.max(0, cutTotal - currentGood);
    const shortagePercent = cutTotal > 0 ? Math.round((shortage / cutTotal) * 1000) / 10 : 0;

    const printReceived = prints.reduce(
      (sum, dispatch) =>
        sum +
        Number(
          dispatch.received_pieces ??
            (dispatch.status === 'تم الاستلام بالمصنع' ? dispatch.pieces_count : 0)
        ),
      0
    );
    const printPieces = prints.reduce((sum, dispatch) => sum + Number(dispatch.pieces_count || 0), 0);
    const printCost = canViewPrintingPrices()
      ? round2(prints.reduce((sum, dispatch) => sum + Number(dispatch.total_cost || 0), 0))
      : null;

    const sewReceived = sews.reduce(
      (sum, dispatch) =>
        sum +
        Number(
          dispatch.received_pieces ?? (dispatch.status === 'تم الاستلام' ? dispatch.pieces_count : 0)
        ),
      0
    );
    const sewPieces = sews.reduce((sum, dispatch) => sum + Number(dispatch.pieces_count || 0), 0);
    const sewCost = canViewSewingPrices()
      ? round2(sews.reduce((sum, dispatch) => sum + Number(dispatch.total_cost || 0), 0))
      : null;

    // نأخذ السليم من أحدث مرحلة فرز متاحة فقط (بدلاً من جمع 3 مراحل وتكرار العدد 3 أضعاف).
    const latestQcStage = modelQc.some((r) => r.stage === 'after_sewing')
      ? 'after_sewing'
      : modelQc.some((r) => r.stage === 'after_print')
      ? 'after_print'
      : 'before_print';
    let qcGood = 0;
    let qcDefects = 0;
    let qcCounted = 0;
    const qcStageMap = new Map<string, number>();
    modelQc.forEach((record) => {
      const good = Number(record.good_qty ?? record.counted_pieces ?? 0);
      const defect = Number(record.defect_pieces ?? record.defect_qty ?? 0);
      if (record.stage === latestQcStage) {
        qcGood += good;
      }
      qcDefects += defect;
      qcCounted += good + defect;
      const label = QC_STAGE_LABELS[record.stage] || record.stage;
      qcStageMap.set(label, (qcStageMap.get(label) || 0) + defect);
    });
    const totalQcDefects = qcDefects;

    const finishingVendors = uniq(finishes.map((record) => record.vendor_name || ''));
    const assemblyRows = (Object.keys(ASSEMBLY_LABELS) as AssemblyStageKey[]).map((stage) => {
      const stageRecords = assemblies.filter((record) => record.stage === stage);
      return {
        stage,
        label: ASSEMBLY_LABELS[stage],
        total: stageRecords.length,
        done: stageRecords.filter((record) => record.is_completed).length
      };
    });


    /* ----------------------- fabric by part & color ------------------- */
    const colorById = new Map<string, FabricColor>();
    fabricColors.forEach((color) => colorById.set(String(color.id), color));
    const fabricById = new Map<string, Fabric>();
    fabrics.forEach((fabric) => fabricById.set(String(fabric.id), fabric));

    const matchesModelTxn = (txn: { model_id?: string | null; model_code_ref?: string | null }) =>
      txn.model_id ? String(txn.model_id) === String(model.id) : normalizeCode(txn.model_code_ref) === code;

    const modelFabricTxns = fabricTransactions.filter((txn) => matchesModelTxn(txn));
    type FabricEntry = {
      key: string;
      fabricName: string;
      colorCode: string;
      colorName: string;
      hexCode: string;
      unit: string;
      qty: number;
      returned: number;
      partMap: Map<string, number>;
    };
    const fabricMap = new Map<string, FabricEntry>();

    modelFabricTxns.forEach((txn) => {
      const netQty = netFabricQty(txn);
      if (!netQty) return;
      const color = colorById.get(String(txn.color_id));
      const sourceFabric = fabricById.get(String(color?.fabric_id || txn.fabric_id));
      const key = String(txn.color_id || txn.fabric_id || 'unknown');
      let entry = fabricMap.get(key);
      if (!entry) {
        entry = {
          key,
          fabricName: sourceFabric?.name || '—',
          colorCode: color?.color_code || '',
          colorName: color?.color_name || '',
          hexCode: safeHex(color?.hex_code),
          unit: unitLabel(sourceFabric?.unit),
          qty: 0,
          returned: 0,
          partMap: new Map<string, number>()
        };
        fabricMap.set(key, entry);
      }
      entry.qty += netQty;
      if (netQty < 0) entry.returned += Math.abs(netQty);
      const part = partFromNotes(txn.notes) || (safeParts.length === 1 ? safeParts[0] : null);
      const label = part ? getPartLabel(part) : 'غير محدد';
      entry.partMap.set(label, (entry.partMap.get(label) || 0) + netQty);
    });

    const fabric: ModelFabricUsage[] = Array.from(fabricMap.values())
      .map((entry) => {
        const total = Math.abs(entry.qty);
        return {
          key: entry.key,
          fabricName: entry.fabricName,
          colorCode: entry.colorCode,
          colorName: entry.colorName,
          hexCode: entry.hexCode,
          unit: entry.unit,
          qty: round2(entry.qty),
          returned: round2(entry.returned),
          partBreakdown: Array.from(entry.partMap.entries())
            .map(([label, qty]) => ({ label, qty: round2(qty), percent: percentOf(Math.abs(qty), total) }))
            .sort((a, b) => Math.abs(b.qty) - Math.abs(a.qty))
        };
      })
      .sort((a, b) => Math.abs(b.qty) - Math.abs(a.qty));

    const fabricUnitBucket = new Map<string, number>();
    fabric.forEach((entry) => addUnitQty(fabricUnitBucket, entry.unit, entry.qty));
    const fabricTotals = unitQtyList(fabricUnitBucket);


    /* -------------------------- accessories --------------------------- */
    const accessoryMap = new Map<string, ModelAccessoryUsage>();
    const accKey = (id?: string | null, accCode?: string | null, name?: string | null): string =>
      String(id || accCode || name || '').trim();
    const ensureAccessory = (key: string, name?: string | null, accCode?: string | null): ModelAccessoryUsage => {
      let entry = accessoryMap.get(key);
      if (!entry) {
        entry = {
          key,
          name: name || '',
          code: accCode || '',
          partLabel: '—',
          unit: '',
          planned: 0,
          perPiece: 0,
          actual: 0,
          price: null,
          value: null
        };
        accessoryMap.set(key, entry);
      }
      return entry;
    };

    const rawAccessoryValues = new Map<string, number>();
    const rawAccessoryHasValue = new Set<string>();
    const showAccPrices = canViewAccessoryPrices();

    accessoryTransactions
      .filter((txn) => matchesModelTxn(txn))
      .forEach((txn) => {
        const key = accKey(txn.accessory_id, txn.accessory_code, txn.accessory_name);
        if (!key) return;
        const entry = ensureAccessory(key, txn.accessory_name, txn.accessory_code);
        const amount = Number(txn.amount || 0);
        const snapPrice = Number(txn.unit_price_snapshot || 0);
        if (txn.operation === 'deduct') {
          entry.actual += amount;
          if (showAccPrices && snapPrice > 0) {
            rawAccessoryValues.set(key, (rawAccessoryValues.get(key) || 0) + amount * snapPrice);
            rawAccessoryHasValue.add(key);
          }
        } else if (isAccessoryReturn(txn.notes)) {
          entry.actual -= amount;
          if (showAccPrices && snapPrice > 0) {
            rawAccessoryValues.set(key, (rawAccessoryValues.get(key) || 0) - amount * snapPrice);
            rawAccessoryHasValue.add(key);
          }
        }
        if ((entry.price === null || entry.price <= 0) && showAccPrices && snapPrice > 0) {
          entry.price = snapPrice;
        }
      });

    (model.accessories || []).forEach((acc) => {
      const key = accKey(acc.accessory_id, acc.accessory_code, acc.accessory_name);
      if (!key) return;
      const entry = ensureAccessory(key, acc.accessory_name, acc.accessory_code);
      entry.name = acc.accessory_name || entry.name;
      entry.code = acc.accessory_code || entry.code;
      entry.partLabel = getPartLabel(acc.target_type);
      entry.unit = acc.unit || entry.unit;
      entry.planned = round2(entry.planned + Number(acc.planned_quantity || 0));
      entry.perPiece = Number(acc.piece_consumption || 0);
      if ((entry.price === null || entry.price <= 0) && showAccPrices && Number(acc.unit_price_snapshot) > 0) {
        entry.price = Number(acc.unit_price_snapshot);
      }
    });

    const accessories = Array.from(accessoryMap.values())
      .map((entry) => {
        const actual = round2(entry.actual);
        const value = !showAccPrices
          ? null
          : rawAccessoryHasValue.has(entry.key)
          ? round2(Math.max(0, rawAccessoryValues.get(entry.key) || 0))
          : entry.price === null
          ? null
          : round2(entry.price * actual);
        return {
          ...entry,
          actual,
          value
        };
      })
      .sort((a, b) => Math.abs(b.actual) - Math.abs(a.actual));

    return {
      parts: partRows,
      fabric,
      fabricTotals,
      accessories,
      printing: {
        pieces: printPieces,
        received: printReceived,
        remaining: Math.max(0, printPieces - printReceived),
        cost: printCost,
        shops: uniq(prints.map((dispatch) => dispatch.shop_name))
      },
      sewing: {
        pieces: sewPieces,
        received: sewReceived,
        remaining: Math.max(0, sewPieces - sewReceived),
        cost: sewCost,
        shops: uniq(sews.map((dispatch) => dispatch.workshop_name))
      },
      qc: {
        good: qcGood,
        defects: totalQcDefects,
        counted: qcCounted,
        byStage: Array.from(qcStageMap.entries())
          .map(([label, qty]) => ({
            label,
            qty: round2(qty),
            percent: percentOf(qty, totalQcDefects)
          }))
          .sort((a, b) => b.qty - a.qty)
      },
      finishing: {
        total: finishes.length,
        received: finishes.filter((record) => record.is_received).length,
        overdue: finishes.filter((record) => record.is_overdue).length,
        vendors: finishingVendors
      },
      assembly: assemblyRows,
      photography: getPackagingRequirement(model.id),
      planTarget: Number(model.target_cut_quantity || 0),
      actualCut,
      cutTotal,
      currentGood,
      shortage,
      shortagePercent
    };

  }, [
    selectedModel,
    getModelParts,
    printDispatches,
    sewingDispatches,
    finishingRecords,
    assemblyStageRecords,
    qcRecords,
    cuttingRecords,
    fabricTransactions,
    fabricColors,
    fabrics,
    accessoryTransactions,
    getPackagingRequirement,
    canViewFabricPrices,
    canViewAccessoryPrices,
    canViewPrintingPrices,
    canViewSewingPrices
  ]);

  const printModelReportRef = useRef<() => void>(() => {});
  const printModelReport = () => {
    if (!selectedModel || !report) return;
    const model = selectedModel;
    const sizeName = model.size_category_id
      ? sizeById.get(String(model.size_category_id))?.name || '—'
      : '—';
    const composition = GARMENT_COMPOSITION_LABELS[model.garment_composition || DEFAULT_GARMENT_COMPOSITION];
    const showAccessoryPrices = canViewAccessoryPrices();
    const showStageCost = canViewPrintingPrices() || canViewSewingPrices();

    const partsRows = report.parts
      .map(
        (row) => `<tr>
          <td>${escapeHtml(PART_LABELS[row.part] || row.part)}</td>
          <td class="num">${fmt(row.planned)}</td>
          <td class="num">${fmt(row.cut)}</td>
          <td class="num">${fmt(row.qc)}</td>
          <td class="num">${fmt(row.printed)}</td>
          <td class="num">${fmt(row.sewn)}</td>
          <td class="num">${fmt(row.finishingRecords)}</td>
        </tr>`
      )
      .join('');

    const fabricRows = report.fabric
      .map(
        (row) => `<tr>
          <td>${escapeHtml(row.fabricName)}</td>
          <td>${escapeHtml(row.colorCode)}${row.colorName ? ` — ${escapeHtml(row.colorName)}` : ''}</td>
          <td>${escapeHtml(row.unit)}</td>
          <td class="num">${fmt(row.qty)}</td>
          <td class="num">${fmt(row.returned)}</td>
          <td>${escapeHtml(row.partBreakdown.map((item) => `${item.label}: ${fmt(item.qty)}`).join(' • ') || '—')}</td>
        </tr>`
      )
      .join('');

    const accessoryRows = report.accessories
      .map(
        (row) => `<tr>
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.code || '—')}</td>
          <td>${escapeHtml(row.partLabel)}</td>
          <td class="num">${fmt(row.planned)}</td>
          <td class="num">${fmt(row.perPiece)}</td>
          <td class="num">${fmt(row.actual)}</td>
          <td>${escapeHtml(row.unit || '—')}</td>
          ${showAccessoryPrices ? `<td class="num">${money(row.value)}</td>` : ''}
        </tr>`
      )
      .join('');

    const stageRows = [
      {
        label: 'المطبعة',
        shops: report.printing.shops.join('، ') || '—',
        sent: report.printing.pieces,
        received: report.printing.received,
        remaining: report.printing.remaining,
        cost: report.printing.cost
      },
      {
        label: 'ورشة المكن',
        shops: report.sewing.shops.join('، ') || '—',
        sent: report.sewing.pieces,
        received: report.sewing.received,
        remaining: report.sewing.remaining,
        cost: report.sewing.cost
      }
    ]
      .map(
        (row) => `<tr>
          <td>${escapeHtml(row.label)}</td>
          <td>${escapeHtml(row.shops)}</td>
          <td class="num">${fmt(row.sent)}</td>
          <td class="num">${fmt(row.received)}</td>
          <td class="num">${fmt(row.remaining)}</td>
          ${showStageCost ? `<td class="num">${money(row.cost)}</td>` : ''}
        </tr>`
      )
      .join('');

    const photography = report.photography;
    const markers = [model.main_marker_url, model.print_marker_url]
      .map((url) => safeImageSrc(url))
      .filter(Boolean)
      .map(
        (src) =>
          `<img src="${escapeHtml(src)}" alt="marker" style="max-width:48%;max-height:190px;border:1px solid #cbd5e1;border-radius:4px;margin:2px" />`
      )
      .join('');


    openPrint(
      `استهلاك الموديل المفصل — ${model.model_code}`,
      `<div class="kv">
        <span>الكود: <b>${escapeHtml(model.model_code)}</b></span>
        <span>النوع: <b>${escapeHtml(model.model_type || '—')}</b></span>
        <span>الحالة: <b>${escapeHtml(model.status || '—')}</b></span>
        <span>فئة المقاس: <b>${escapeHtml(sizeName)}</b></span>
        <span>التكوين: <b>${escapeHtml(composition)}</b></span>
        <span>تاريخ الإنشاء: <b>${escapeHtml(String(model.created_at || '').slice(0, 10))}</b></span>
      </div>
      <div class="cards" style="margin-top:8px">
        <div class="card">مخطط القص<b>${fmt(report.planTarget)}</b></div>
        <div class="card">المقصوص الفعلي<b>${fmt(report.cutTotal)}</b></div>
        <div class="card">السليم الحالي<b>${fmt(report.currentGood)}</b></div>
        <div class="card">العجز<b class="${report.shortage > 0 ? 'bad' : 'ok'}">${fmt(report.shortage)} (${report.shortagePercent}%)</b></div>
      </div>
      ${markers ? `<h2>الماركرات</h2><div>${markers}</div>` : ''}
      <h2>خطة القص مقابل الفعلي</h2>
      <table><thead><tr><th>القطعة</th><th>المخطط</th><th>المقصوص</th><th>العد السليم</th><th>مرسل للمطبعة</th><th>مرسل للمكن</th><th>سجلات التشطيب</th></tr></thead><tbody>${partsRows}</tbody></table>
      <h2>استهلاك الأقمشة حسب القطعة واللون</h2>
      <table><thead><tr><th>الخامة</th><th>اللون</th><th>الوحدة</th><th>الصافي</th><th>المرتجع</th><th>التوزيع على القطع</th></tr></thead><tbody>${fabricRows || '<tr><td colspan="6">لا توجد حركات صرف لهذا الموديل.</td></tr>'}</tbody></table>
      <h2>الإكسسوارات المستخدمة</h2>
      <table><thead><tr><th>الاسم</th><th>الكود</th><th>القطعة</th><th>المخطط</th><th>استهلاك/قطعة</th><th>المصروف الفعلي</th><th>الوحدة</th>${showAccessoryPrices ? '<th>القيمة</th>' : ''}</tr></thead><tbody>${accessoryRows || `<tr><td colspan="${showAccessoryPrices ? 8 : 7}">لا توجد إكسسوارات مرتبطة بهذا الموديل.</td></tr>`}</tbody></table>
      <h2>المطبعة والمكن</h2>
      <table><thead><tr><th>المرحلة</th><th>الورش</th><th>المرسل</th><th>المستلم</th><th>المتبقي</th>${showStageCost ? '<th>التكلفة</th>' : ''}</tr></thead><tbody>${stageRows}</tbody></table>
      <h2>الجودة والعجز</h2>
      <div class="kv">
        <span>السليم بعد الفرز: <b>${fmt(report.qc.good)}</b></span>
        <span>الهالك: <b class="bad">${fmt(report.qc.defects)}</b></span>
        <span>إجمالي المفرز: <b>${fmt(report.qc.counted)}</b></span>
        <span>العجز: <b class="${report.shortage > 0 ? 'bad' : 'ok'}">${fmt(report.shortage)}</b></span>
        <span>نسبة العجز: <b>${report.shortagePercent}%</b></span>
        <span>أكبر مرحلة هالك: <b>${escapeHtml(report.qc.byStage[0]?.label || '—')}</b></span>
        <span>قطع التصوير المعلقة: <b>${fmt(photography?.photography_outstanding_qty || 0)}</b></span>
        <span>عجز التصوير: <b>${fmt(photography?.photography_shortage || 0)}</b></span>
      </div>
      <h2>التشطيب والأسمبلي</h2>
      <div class="kv">
        <span>سجلات التشطيب: <b>${fmt(report.finishing.total)}</b></span>
        <span>مستلمة: <b class="ok">${fmt(report.finishing.received)}</b></span>
        <span>متأخرة: <b class="warn">${fmt(report.finishing.overdue)}</b></span>
        <span>ورش التشطيب: <b>${escapeHtml(report.finishing.vendors.join('، ') || '—')}</b></span>
        ${report.assembly
          .map((row) => `<span>${escapeHtml(row.label)}: <b>${fmt(row.done)} / ${fmt(row.total)}</b></span>`)
          .join('')}
      </div>`,
      'landscape'
    );
  };
  printModelReportRef.current = printModelReport;

  useEffect(() => {
    const handler = () => printModelReportRef.current();
    window.addEventListener('erp:print-model-consumption-report', handler);
    return () => window.removeEventListener('erp:print-model-consumption-report', handler);
  }, []);


  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-l from-slate-900 via-indigo-950 to-purple-900 p-5 text-white shadow-lg">
        <div className="absolute -left-10 -top-12 h-40 w-40 rounded-full bg-indigo-400/20 blur-2xl" />
        <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-indigo-200">تقرير تشغيلي شامل</p>
            <h2 className="mt-1 text-xl font-bold">استهلاك الموديل المفصل</h2>
            <p className="mt-1 max-w-2xl text-xs leading-6 text-slate-200">
              صفحة واحدة لكل موديل: الهوية والماركرات، خطة القص مقابل الفعلي، استهلاك الأقمشة والإكسسوارات،
              المطبعة والمكن، الجودة والعجز، ثم التشطيب والتصوير.
            </p>
          </div>
          <button
            type="button"
            onClick={printModelReport}
            disabled={!report}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-bold text-slate-900 shadow transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Printer size={16} /> طباعة الموديل (A4)
          </button>
        </div>
      </div>

      <div className={`${cardClass} p-4`}>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="relative block md:col-span-2">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ابحث بكود الموديل أو النوع أو الحالة"
              className={`${inputClass} pr-9`}
            />
          </label>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className={inputClass}>
            <option value="all">كل الأنواع</option>
            {typeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          {fmt(filteredModels.length)} موديل مطابق — اختر موديلاً لعرض تقريره المفصل.
        </p>
      </div>

      {filteredModels.length === 0 ? (
        <EmptyNote text="لا توجد موديلات مطابقة للبحث أو فلتر النوع." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredModels.map((model) => {
            const isActive = selectedModel?.id === model.id;
            const image = safeImageSrc(model.image);
            const cut = Number(model.total_cut_pieces || 0);
            return (
              <button
                type="button"
                key={model.id}
                onClick={() => setSelectedId(model.id)}
                className={`flex items-center gap-3 rounded-2xl border p-3 text-right transition ${
                  isActive
                    ? 'border-indigo-400 bg-indigo-50/70 ring-2 ring-indigo-100'
                    : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50'
                }`}
              >
                {image ? (
                  <img
                    src={image}
                    alt={model.model_code}
                    className="h-14 w-14 shrink-0 rounded-xl border border-slate-200 object-cover"
                  />
                ) : (
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                    <Shirt size={22} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-800">{model.model_code}</p>
                  <p className="truncate text-[11px] text-slate-500">
                    {model.model_type || 'غير محدد'} • {model.status || '—'}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600">
                      مقصوص: {fmt(cut)}
                    </span>
                    <span className="rounded bg-indigo-100 px-1.5 py-0.5 font-semibold text-indigo-700">
                      مطلوب: {fmt(model.target_cut_quantity)}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}


      {!selectedModel || !report ? (
        <EmptyNote text="اختر موديلاً من القائمة أعلاه لعرض تقرير الاستهلاك المفصل." />
      ) : (
        <div className="space-y-4">
          <div className={`${cardClass} overflow-hidden`}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/70 p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
                  <Shirt size={20} />
                </span>
                <div>
                  <p className="text-base font-bold text-slate-900">{selectedModel.model_code}</p>
                  <p className="text-[11px] text-slate-500">
                    {selectedModel.model_type || 'غير محدد'} •{' '}
                    {GARMENT_COMPOSITION_LABELS[selectedModel.garment_composition || DEFAULT_GARMENT_COMPOSITION]} •{' '}
                    {selectedModel.size_category_id
                      ? sizeById.get(String(selectedModel.size_category_id))?.name || 'فئة غير معروفة'
                      : 'بدون فئة مقاس'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="rounded-lg bg-slate-900 px-2 py-1 font-semibold text-white">
                  {selectedModel.status || '—'}
                </span>
                <span
                  className={`rounded-lg px-2 py-1 font-semibold ${
                    report.shortage > 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  <AlertTriangle size={11} className="ml-1 inline" />
                  العجز: {fmt(report.shortage)} ({report.shortagePercent}%)
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 p-4 lg:grid-cols-4">
              <MiniStat label="مخطط القص (الأطقم)" value={fmt(report.planTarget)} />
              <MiniStat label="المقصوص الفعلي" value={fmt(report.cutTotal)} tone="text-indigo-600" />
              <MiniStat label="السليم الحالي" value={fmt(report.currentGood)} tone="text-emerald-600" />
              <MiniStat
                label="نسبة العجز"
                value={`${report.shortagePercent}%`}
                tone={report.shortage > 0 ? 'text-rose-600' : 'text-emerald-600'}
              />
            </div>

            {/* المرحلة الحالية لكل قطعة + أزرار الانتقال السريع (مقيّدة بالصلاحيات) */}
            {(() => {
              const partStages = getPartStages(selectedModel.id);
              return (
                <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3">
                  <p className="mb-2 text-[11px] font-bold text-slate-600">
                    مرحلة كل قطعة والانتقال السريع للقسم:
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {report.parts.map((row) => {
                      const effectiveStage = resolveEffectivePartStage(
                        selectedModel,
                        row.part,
                        partStages
                      );
                      const target = getPartStageNavigationTarget(effectiveStage);
                      const canJump =
                        Boolean(onNavigateToStage) &&
                        (target.permissionSection === 'assembly_packaging'
                          ? hasAssemblyPackagingAccess()
                          : hasPermission(target.permissionSection));

                      return (
                        <div
                          key={row.part}
                          className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-2xs"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-800">
                              {PART_EMOJI[row.part]} {getPartLabel(row.part)}
                            </p>
                            <span
                              className={`mt-1 inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold ${target.badgeClass}`}
                            >
                              {target.stageLabel}
                            </span>
                          </div>
                          {canJump && (
                            <button
                              type="button"
                              onClick={() =>
                                onNavigateToStage?.(
                                  target.tab,
                                  target.subTab,
                                  target.passModelId ? selectedModel.id : undefined
                                )
                              }
                              className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold shadow-xs transition cursor-pointer ${target.buttonClass}`}
                              title={`الانتقال المباشر إلى ${target.sectionLabel}`}
                            >
                              <span>{target.sectionLabel}</span>
                              <ArrowUpLeft className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>

          <div className={`${cardClass} p-4`}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-800">الماركرات</h3>
              <span className="text-[11px] text-slate-400">الماركر الأساسي وماركر الطباعة</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: 'الماركر الأساسي', url: selectedModel.main_marker_url },
                { label: 'ماركر الطباعة', url: selectedModel.print_marker_url }
              ].map((marker) => {
                const src = safeImageSrc(marker.url);
                return (
                  <div key={marker.label} className="rounded-xl border border-slate-200 bg-slate-50/50 p-2">
                    <p className="mb-1 text-[11px] font-semibold text-slate-500">{marker.label}</p>
                    {src ? (
                      <a href={src} target="_blank" rel="noreferrer">
                        <img
                          src={src}
                          alt={marker.label}
                          className="h-44 w-full rounded-lg border border-slate-200 bg-white object-contain"
                        />
                      </a>
                    ) : (
                      <p className="flex h-44 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white text-[11px] text-slate-400">
                        لا يوجد ملف ماركر مرفوع
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>


          <div className={`${cardClass} overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <h3 className="text-sm font-bold text-slate-800">خطة القص مقابل الفعلي (حسب القطعة)</h3>
              <span className="text-[11px] text-slate-500">
                المقصوص: {fmt(report.parts.reduce((sum, row) => sum + row.cut, 0))} • السليم:{' '}
                {fmt(report.parts.reduce((sum, row) => sum + row.qc, 0))}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>القطعة</th>
                    <th className={thClass}>المخطط</th>
                    <th className={thClass}>المقصوص</th>
                    <th className={thClass}>العد السليم</th>
                    <th className={thClass}>مرسل للمطبعة</th>
                    <th className={thClass}>مرسل للمكن</th>
                    <th className={thClass}>سجلات التشطيب</th>
                  </tr>
                </thead>
                <tbody>
                  {report.parts.map((row) => (
                    <tr key={row.part} className="transition hover:bg-slate-50/70">
                      <td className={`${tdClass} font-semibold text-slate-800`}>{PART_LABELS[row.part]}</td>
                      <td className={`${tdClass} tabular-nums`}>{fmt(row.planned)}</td>
                      <td className={`${tdClass} tabular-nums font-semibold text-indigo-700`}>{fmt(row.cut)}</td>
                      <td className={`${tdClass} tabular-nums font-semibold text-emerald-700`}>{fmt(row.qc)}</td>
                      <td className={`${tdClass} tabular-nums`}>{fmt(row.printed)}</td>
                      <td className={`${tdClass} tabular-nums`}>{fmt(row.sewn)}</td>
                      <td className={`${tdClass} tabular-nums`}>{fmt(row.finishingRecords)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>


          <div className="grid gap-4 xl:grid-cols-2">
            <div className={`${cardClass} overflow-hidden`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
                    <Palette size={16} />
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">استهلاك الأقمشة</h3>
                    <p className="text-[11px] text-slate-500">{formatUnitQty(report.fabricTotals)}</p>
                  </div>
                </div>
                {report.fabric.length > 6 ? (
                  <button
                    type="button"
                    onClick={() => setShowAllFabric((value) => !value)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
                  >
                    {showAllFabric ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    {showAllFabric ? 'أقل' : `كل الألوان (${fmt(report.fabric.length)})`}
                  </button>
                ) : null}
              </div>
              <div className="space-y-2 p-3">
                {report.fabric.length === 0 ? (
                  <EmptyNote text="لا توجد حركات صرف قماش مرتبطة بكود هذا الموديل." />
                ) : (
                  (showAllFabric ? report.fabric : report.fabric.slice(0, 6)).map((entry) => (
                    <div key={entry.key} className="rounded-xl border border-slate-200 p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className="h-8 w-8 shrink-0 rounded-lg border border-slate-200"
                            style={{ backgroundColor: entry.hexCode }}
                          />
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-slate-800">{entry.fabricName}</p>
                            <p className="truncate text-[10px] text-slate-500">
                              {entry.colorCode}
                              {entry.colorName ? ` — ${entry.colorName}` : ''}
                            </p>
                          </div>
                        </div>
                        <span className="shrink-0 rounded-md bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700">
                          {fmt(entry.qty)} {entry.unit}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px]">
                        {entry.partBreakdown.map((part) => (
                          <span
                            key={part.label}
                            className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-semibold text-slate-600"
                          >
                            {part.label}: {fmt(part.qty)} ({part.percent}%)
                          </span>
                        ))}
                        {entry.returned > 0 ? (
                          <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700">
                            مرتجع: {fmt(entry.returned)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>


            <div className={`${cardClass} overflow-hidden`}>
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
                    <Tag size={16} />
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">الإكسسوارات</h3>
                    <p className="text-[11px] text-slate-500">{fmt(report.accessories.length)} صنف مرتبط بالموديل</p>
                  </div>
                </div>
                {canViewAccessoryPrices() ? (
                  <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700">
                    <Coins size={11} /> الأسعار ظاهرة
                  </span>
                ) : null}
              </div>
              {report.accessories.length === 0 ? (
                <div className="p-3">
                  <EmptyNote text="لا توجد إكسسوارات مرتبطة بهذا الموديل أو لم تُسجّل حركات صرف له." />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className={tableClass}>
                    <thead>
                      <tr>
                        <th className={thClass}>الاسم</th>
                        <th className={thClass}>القطعة</th>
                        <th className={thClass}>المخطط</th>
                        <th className={thClass}>المصروف</th>
                        {canViewAccessoryPrices() ? <th className={thClass}>القيمة</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {report.accessories.map((row) => (
                        <tr key={row.key} className="transition hover:bg-slate-50/70">
                          <td className={tdClass}>
                            <p className="font-semibold text-slate-800">{row.name || '—'}</p>
                            <p className="text-[10px] text-slate-400">
                              {row.code || 'بدون كود'} • استهلاك/قطعة: {fmt(row.perPiece)}
                            </p>
                          </td>
                          <td className={tdClass}>{row.partLabel}</td>
                          <td className={`${tdClass} tabular-nums`}>
                            {fmt(row.planned)} {row.unit}
                          </td>
                          <td className={`${tdClass} tabular-nums font-semibold text-rose-600`}>
                            {fmt(row.actual)} {row.unit}
                          </td>
                          {canViewAccessoryPrices() ? (
                            <td className={`${tdClass} tabular-nums font-semibold text-indigo-700`}>
                              {money(row.value)}
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>


          <div className="grid gap-4 xl:grid-cols-2">
            <div className={`${cardClass} p-4`}>
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                  <Scissors size={16} />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">المطبعة والمكن</h3>
                  <p className="text-[11px] text-slate-500">المرسل والمستلم والمتبقي في الورش</p>
                </div>
              </div>
              <div className="space-y-3">
                {[
                  { key: 'printing', title: 'المطبعة', data: report.printing, showCost: canViewPrintingPrices() },
                  { key: 'sewing', title: 'ورشة المكن', data: report.sewing, showCost: canViewSewingPrices() }
                ].map((stage) => {
                  const percent = stage.data.pieces > 0 ? Math.round((stage.data.received / stage.data.pieces) * 100) : 0;
                  return (
                    <div key={stage.key} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold text-slate-800">{stage.title}</p>
                        <p className="text-[10px] text-slate-500">{stage.data.shops.join('، ') || 'لم تُحدد ورشة'}</p>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-1.5">
                        <MiniStat label="المرسل" value={fmt(stage.data.pieces)} />
                        <MiniStat label="المستلم" value={fmt(stage.data.received)} tone="text-emerald-600" />
                        <MiniStat label="المتبقي" value={fmt(stage.data.remaining)} tone="text-amber-600" />
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${Math.min(100, percent)}%` }}
                        />
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                        <span>نسبة الاستلام: {percent}%</span>
                        {stage.showCost ? <span className="font-semibold">التكلفة: {money(stage.data.cost)}</span> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={`${cardClass} p-4`}>
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                  <CheckCircle2 size={16} />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">الجودة والعجز</h3>
                  <p className="text-[11px] text-slate-500">العد السليم والهالك والعجز بين المقصوص والحالي</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                <MiniStat label="السليم" value={fmt(report.qc.good)} tone="text-emerald-600" />
                <MiniStat label="الهالك" value={fmt(report.qc.defects)} tone="text-rose-600" />
                <MiniStat label="المفرز" value={fmt(report.qc.counted)} />
                <MiniStat
                  label="العجز"
                  value={`${fmt(report.shortage)} (${report.shortagePercent}%)`}
                  tone={report.shortage > 0 ? 'text-rose-600' : 'text-emerald-600'}
                />
              </div>
              <div className="mt-3 border-t border-slate-100 pt-3">
                <BreakdownBars title="توزيع الهالك على مراحل الفرز" items={report.qc.byStage} color="#e11d48" />
              </div>
              <div
                className={`mt-3 flex items-start gap-2 rounded-lg px-2.5 py-2 text-[11px] ${
                  report.shortage > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
                }`}
              >
                {report.shortage > 0 ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                <span>
                  {report.shortage > 0
                    ? `يوجد عجز ${fmt(report.shortage)} قطعة بين المقصوص (${fmt(report.cutTotal)}) والسليم الحالي (${fmt(report.currentGood)}).`
                    : 'لا يوجد عجز: العدد السليم الحالي يغطي كامل الكمية المقصوصة.'}
                </span>
              </div>
            </div>
          </div>


          <div className={`${cardClass} p-4`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
                  <Layers size={16} />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">التشطيب والأسمبلي والتصوير</h3>
                  <p className="text-[11px] text-slate-500">حالة المراحل بعد المكن حتى الإنتاج التام</p>
                </div>
              </div>
              <span className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">
                ورش التشطيب: {report.finishing.vendors.join('، ') || 'غير محددة'}
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <MiniStat label="سجلات التشطيب" value={fmt(report.finishing.total)} />
              <MiniStat label="مستلمة" value={fmt(report.finishing.received)} tone="text-emerald-600" />
              <MiniStat label="متأخرة" value={fmt(report.finishing.overdue)} tone="text-amber-600" />
              <MiniStat
                label="في التصوير"
                value={fmt(report.photography?.photography_outstanding_qty || 0)}
                tone="text-indigo-600"
              />
              <MiniStat
                label="عجز التصوير"
                value={fmt(report.photography?.photography_shortage || 0)}
                tone={Number(report.photography?.photography_shortage || 0) > 0 ? 'text-rose-600' : 'text-emerald-600'}
              />
              <MiniStat
                label="أطقم تامة"
                value={fmt(report.currentGood)}
                tone="text-slate-900"
              />
            </div>
            <div className="mt-3 border-t border-slate-100 pt-3">
              <BreakdownBars
                title="تقدم مراحل الأسمبلي"
                items={report.assembly.map((row) => ({
                  label: row.label,
                  qty: row.done,
                  percent: row.total > 0 ? Math.round((row.done / row.total) * 100) : 0
                }))}
                color="#7c3aed"
              />
            </div>
            <div className="mt-3 grid gap-2 text-[11px] text-slate-600 sm:grid-cols-2">
              <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                السليم الحالي:{' '}
                <b className="text-slate-900">{fmt(report.currentGood)}</b> طقم — المتبقي على الخطة:{' '}
                <b className="text-indigo-700">{fmt(Math.max(0, report.planTarget - report.currentGood))}</b>
              </div>
              <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                آخر تحديث للتصوير:{' '}
                <b className="text-slate-900">
                  {report.photography?.received_from_photo_date
                    ? String(report.photography.received_from_photo_date).slice(0, 10)
                    : 'لم يُستلم بعد'}
                </b>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

