import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  GitCommit,
  Search,
  Printer,
  Clock,
  Scissors,
  X,
  User,
  Shirt,
  Eye,
  Sparkles,
  Scale,
  Truck,
  CheckCircle2,
  Circle
} from 'lucide-react';
import {
  Model,
  CuttingRecord,
  QCRecord,
  PrintDispatch,
  SewingDispatch,
  ModelRequirement,
  ModelAccessory,
  Fabric,
  FabricColor,
  GarmentPart,
  GARMENT_COMPOSITION_LABELS,
  getPartLabel,
  partsForComposition
} from '../types';

/* ------------------------------------------------------------------ */
/* Canonical production stages (derived from real records, no dupes)  */
/* ------------------------------------------------------------------ */

type StageKey =
  | 'design'
  | 'cutting'
  | 'qc_pre_print'
  | 'printing'
  | 'qc_post_print'
  | 'sewing'
  | 'qc_post_sewing';

const STAGE_ORDER: StageKey[] = [
  'design',
  'cutting',
  'qc_pre_print',
  'printing',
  'qc_post_print',
  'sewing',
  'qc_post_sewing'
];

interface StageMeta {
  title: string;
  subtitle: string;
  accent: string; // text color
  node: string; // node background
  badge: string; // badge classes
}

const STAGE_META: Record<StageKey, StageMeta> = {
  design: {
    title: 'قسم التصميم',
    subtitle: 'المواصفات، المقاسات المعتمدة، الخامات والإكسسوارات',
    accent: 'text-amber-700',
    node: 'bg-amber-500',
    badge: 'bg-amber-50 text-amber-800 border-amber-200'
  },
  cutting: {
    title: 'قسم القص',
    subtitle: 'الفرشات، الراقات، وكميات القص لكل قطعة من الموديل',
    accent: 'text-blue-700',
    node: 'bg-blue-600',
    badge: 'bg-blue-50 text-blue-800 border-blue-200'
  },
  qc_pre_print: {
    title: 'قسم العد والفرز قبل الطباعة',
    subtitle: 'مصفوفة العد (اللون × المقاس) قبل الطباعة لكل قطعة',
    accent: 'text-purple-700',
    node: 'bg-purple-600',
    badge: 'bg-purple-50 text-purple-800 border-purple-200'
  },
  printing: {
    title: 'قسم المطابع والتطريز',
    subtitle: 'إرساليات الطباعة: نوع القطعة ومكان الطباعة والكميات',
    accent: 'text-indigo-700',
    node: 'bg-indigo-600',
    badge: 'bg-indigo-50 text-indigo-800 border-indigo-200'
  },
  qc_post_print: {
    title: 'قسم العد والفرز بعد الطباعة',
    subtitle: 'نتائج العد بعد استلام المطبعة لكل قطعة',
    accent: 'text-fuchsia-700',
    node: 'bg-fuchsia-600',
    badge: 'bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200'
  },
  sewing: {
    title: 'قسم المكن والخياطة',
    subtitle: 'ورش الخياطة ونوع القطعة المرسلة لكل ورشة',
    accent: 'text-emerald-700',
    node: 'bg-emerald-600',
    badge: 'bg-emerald-50 text-emerald-800 border-emerald-200'
  },
  qc_post_sewing: {
    title: 'قسم العد بعد المكن',
    subtitle: 'الفحص النهائي: السليم والهالك لكل قطعة من الموديل',
    accent: 'text-teal-700',
    node: 'bg-teal-600',
    badge: 'bg-teal-50 text-teal-800 border-teal-200'
  }
};

const STAGE_ICONS: Record<StageKey, React.ReactNode> = {
  design: <Sparkles className="w-4 h-4" />,
  cutting: <Scissors className="w-4 h-4" />,
  qc_pre_print: <Scale className="w-4 h-4" />,
  printing: <Printer className="w-4 h-4" />,
  qc_post_print: <Scale className="w-4 h-4" />,
  sewing: <Truck className="w-4 h-4" />,
  qc_post_sewing: <CheckCircle2 className="w-4 h-4" />
};

/* ------------------------------------------------------------------ */
/* Small pure helpers                                                 */
/* ------------------------------------------------------------------ */

const splitSizes = (values?: string): string[] =>
  String(values || '')
    .split(/[,،|/]+/)
    .map((s) => s.trim())
    .filter(Boolean);

const sumByPart = (items: { part: string; qty: number }[]): Partial<Record<GarmentPart, number>> => {
  const map: Partial<Record<GarmentPart, number>> = {};
  items.forEach(({ part, qty }) => {
    const p = (part || 'shirt') as GarmentPart;
    map[p] = (map[p] || 0) + (Number(qty) || 0);
  });
  return map;
};

const formatPartsQty = (map: Partial<Record<GarmentPart, number>>): string => {
  const entries = Object.entries(map).filter(([, v]) => Number(v) > 0);
  if (!entries.length) return 'لا يوجد';
  return entries
    .map(([k, v]) => `${getPartLabel(k)}: ${Number(v).toLocaleString('ar-EG')}`)
    .join(' • ');
};

const partOf = (rec: { part_type?: GarmentPart; partType?: GarmentPart; part?: string }): GarmentPart =>
  (rec.part_type || rec.partType || (rec.part as GarmentPart) || 'shirt') as GarmentPart;

interface QcMatrix {
  colors: string[];
  sizes: string[];
  cell: Map<string, { good: number; defect: number }>;
  sizeTotals: { size: string; good: number; defect: number }[];
  grand: { good: number; defect: number };
}

const buildQcMatrix = (records: QCRecord[], sizeOrder: string[]): QcMatrix => {
  const colors: string[] = [];
  const cell = new Map<string, { good: number; defect: number }>();
  const sizeSet = new Set(sizeOrder.filter(Boolean));
  records.forEach((r) => {
    const c = r.color_name || 'بدون لون';
    if (!colors.includes(c)) colors.push(c);
    const s = r.size || '—';
    sizeSet.add(s);
    const k = `${c}||${s}`;
    const prev = cell.get(k) || { good: 0, defect: 0 };
    prev.good += Number(r.good_qty ?? r.counted_pieces ?? 0);
    prev.defect += Number(r.defect_qty ?? r.defect_pieces ?? 0);
    cell.set(k, prev);
  });
  const sizes = Array.from(sizeSet);
  const sizeTotals = sizes.map((s) => {
    let good = 0;
    let defect = 0;
    colors.forEach((c) => {
      const v = cell.get(`${c}||${s}`);
      if (v) {
        good += v.good;
        defect += v.defect;
      }
    });
    return { size: s, good, defect };
  });
  const grand = sizeTotals.reduce(
    (a, t) => ({ good: a.good + t.good, defect: a.defect + t.defect }),
    { good: 0, defect: 0 }
  );
  return { colors, sizes, cell, sizeTotals, grand };
};

/* ------------------------------------------------------------------ */
/* Presentational tables (one per stage — no cross-stage leakage)     */
/* ------------------------------------------------------------------ */

const AccessoriesTable: React.FC<{ accs: ModelAccessory[] }> = ({ accs }) => {
  if (!accs.length) {
    return <p className="text-xs text-slate-500 font-semibold">لا توجد إكسسوارات مربوطة بهذا الموديل.</p>;
  }
  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden">
      <div className="bg-slate-100 px-4 py-2 font-black text-slate-800 text-xs">
        الإكسسوارات المربوطة بالموديل ({accs.length}):
      </div>
      <table className="w-full text-right text-xs">
        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
          <tr>
            <th className="py-2 px-3">القطعة</th>
            <th className="py-2 px-3">اسم الإكسسوار</th>
            <th className="py-2 px-3">الكود</th>
            <th className="py-2 px-3 text-center">استهلاك القطعة</th>
            <th className="py-2 px-3 text-center">الكمية المخططة</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {accs.map((a) => (
            <tr key={a.id} className="hover:bg-slate-50">
              <td className="py-2 px-3 font-bold text-slate-800">
                {a.target_type === 'pants' ? 'بنطلون' : 'تيشرت'}
              </td>
              <td className="py-2 px-3 font-semibold text-slate-900">{a.accessory_name}</td>
              <td className="py-2 px-3 font-mono text-slate-600">{a.accessory_code || '-'}</td>
              <td className="py-2 px-3 text-center font-bold">{a.piece_consumption ?? '-'}</td>
              <td className="py-2 px-3 text-center font-black text-slate-900">
                {(a.planned_quantity || 0).toLocaleString('ar-EG')} {a.unit || ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const RequirementsTable: React.FC<{
  reqs: ModelRequirement[];
  fabrics: Fabric[];
  fabricColors: FabricColor[];
}> = ({ reqs, fabrics, fabricColors }) => {
  if (!reqs.length) {
    return <p className="text-xs text-slate-500 font-semibold">لا توجد خامات مخططة لهذا الموديل.</p>;
  }
  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden">
      <div className="bg-slate-100 px-4 py-2 font-black text-slate-800 text-xs">
        الخامات المخططة للموديل ({reqs.length}):
      </div>
      <table className="w-full text-right text-xs">
        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
          <tr>
            <th className="py-2 px-3">الخامة</th>
            <th className="py-2 px-3">اللون</th>
            <th className="py-2 px-3">البند / الجزء</th>
            <th className="py-2 px-3 text-center">الكمية المخططة</th>
            <th className="py-2 px-3 text-center">الكمية المطلوبة</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {reqs.map((r) => {
            const color = fabricColors.find((c) => c.id === r.color_id);
            const fabric = color ? fabrics.find((f) => f.id === color.fabric_id) : undefined;
            return (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="py-2 px-3 font-bold text-slate-900">{fabric?.name || '-'}</td>
                <td className="py-2 px-3 font-semibold text-slate-700">
                  {color?.color_name || '-'}
                  {color?.color_code ? ` (${color.color_code})` : ''}
                </td>
                <td className="py-2 px-3 text-slate-600">{r.part_name || '-'}</td>
                <td className="py-2 px-3 text-center font-black text-slate-900">
                  {(r.planned_quantity || 0).toLocaleString('ar-EG')}
                </td>
                <td className="py-2 px-3 text-center font-bold text-blue-700">
                  {r.required_quantity != null ? r.required_quantity.toLocaleString('ar-EG') : '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};


const CuttingSpreadsTable: React.FC<{ records: CuttingRecord[] }> = ({ records }) => {
  if (!records.length) {
    return <p className="text-xs text-slate-500 font-semibold">لا توجد فرشات قص مسجلة لهذا الموديل.</p>;
  }
  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden">
      <div className="bg-blue-50 px-4 py-2 font-black text-blue-950 text-xs">
        جدول فرشات القص التفصيلية ({records.length} فرشة):
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-right text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
            <tr>
              <th className="py-2 px-3">الفرشة</th>
              <th className="py-2 px-3">القطعة</th>
              <th className="py-2 px-3">الفَرّاش</th>
              <th className="py-2 px-3">الخامة واللون</th>
              <th className="py-2 px-3 text-center">الراقات</th>
              <th className="py-2 px-3 text-center">قطع / راق</th>
              <th className="py-2 px-3 text-center">وزن الراق</th>
              <th className="py-2 px-3 text-center">الكمية المقصوصة</th>
              <th className="py-2 px-3">المقصدار</th>
              <th className="py-2 px-3">ملاحظات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {records.map((rec, idx) => (
              <tr key={rec.id} className="hover:bg-slate-50">
                <td className="py-2 px-3 font-black text-rose-700">
                  #{rec.spread_number || rec.spreadNumber || records.length - idx}
                </td>
                <td className="py-2 px-3">
                  <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white font-bold text-[10px]">
                    {getPartLabel(partOf(rec))}
                  </span>
                </td>
                <td className="py-2 px-3 font-semibold text-slate-800">
                  {rec.spreader_name || rec.spreaderName || '-'}
                </td>
                <td className="py-2 px-3 font-bold text-slate-700">
                  {rec.fabric_name ? `${rec.fabric_name} - ` : ''}
                  {rec.color_name || rec.colorName || '-'}
                  {rec.shade_degree ? ` (${rec.shade_degree})` : ''}
                </td>
                <td className="py-2 px-3 text-center font-bold text-blue-700">
                  {(rec.layers_count ?? rec.layersCount ?? 0).toLocaleString('ar-EG')}
                </td>
                <td className="py-2 px-3 text-center font-bold text-slate-700">
                  {rec.pieces_per_layer ?? rec.piecesPerLayer ?? '-'}
                </td>
                <td className="py-2 px-3 text-center font-bold text-slate-700">
                  {rec.layer_weight ?? rec.layerWeight ?? 0} كجم
                </td>
                <td className="py-2 px-3 text-center font-black text-slate-900">
                  {(rec.pieces_count ?? rec.piecesCount ?? rec.cut_pieces ?? 0).toLocaleString('ar-EG')} ق
                </td>
                <td className="py-2 px-3 font-semibold text-emerald-800">
                  {rec.cutter_name || rec.cutterName || '-'}
                </td>
                <td className="py-2 px-3 text-amber-800 font-medium">{rec.notes || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};


const PrintDispatchesTable: React.FC<{ records: PrintDispatch[] }> = ({ records }) => {
  if (!records.length) {
    return <p className="text-xs text-slate-500 font-semibold">لا توجد إرساليات مطابع مسجلة لهذا الموديل.</p>;
  }
  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden">
      <div className="bg-indigo-50 px-4 py-2 font-black text-indigo-950 text-xs">
        إرساليات المطابع والتطريز ({records.length}):
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-right text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
            <tr>
              <th className="py-2 px-3">المطبعة / الورشة</th>
              <th className="py-2 px-3">نوع القطعة</th>
              <th className="py-2 px-3">مكان / تفاصيل الطباعة</th>
              <th className="py-2 px-3">نوع التشغيل</th>
              <th className="py-2 px-3 text-center">تاريخ الإرسال</th>
              <th className="py-2 px-3 text-center">الاستلام المتوقع</th>
              <th className="py-2 px-3 text-center">المرسلة</th>
              <th className="py-2 px-3 text-center">المستلمة</th>
              <th className="py-2 px-3 text-center">الحالة</th>
              <th className="py-2 px-3">ملاحظات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {records.map((pr) => (
              <tr key={pr.id} className="hover:bg-slate-50">
                <td className="py-2 px-3 font-bold text-slate-900">{pr.shop_name}</td>
                <td className="py-2 px-3">
                  <span className="px-2 py-0.5 rounded-md bg-indigo-700 text-white font-bold text-[10px]">
                    {pr.piece_label || getPartLabel(pr.piece_type)}
                  </span>
                </td>
                <td className="py-2 px-3 text-slate-700 font-semibold">
                  {pr.print_location || '-'}
                  {pr.print_details ? (
                    <span className="block text-[10px] text-slate-500">{pr.print_details}</span>
                  ) : null}
                </td>
                <td className="py-2 px-3 text-slate-700">{pr.print_type}</td>
                <td className="py-2 px-3 text-center font-mono text-slate-600">{pr.dispatched_at || '-'}</td>
                <td className="py-2 px-3 text-center font-mono text-slate-600">
                  {pr.expected_delivery_date || '-'}
                </td>
                <td className="py-2 px-3 text-center font-black text-slate-900">
                  {(pr.pieces_count || 0).toLocaleString('ar-EG')} ق
                </td>
                <td className="py-2 px-3 text-center font-bold text-emerald-700">
                  {pr.received_at ? `${(pr.pieces_count || 0).toLocaleString('ar-EG')} ق` : '-'}
                </td>
                <td className="py-2 px-3 text-center font-bold text-indigo-700">{pr.status}</td>
                <td className="py-2 px-3 text-slate-600">{pr.notes || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};


const SewingDispatchesTable: React.FC<{ records: SewingDispatch[] }> = ({ records }) => {
  if (!records.length) {
    return <p className="text-xs text-slate-500 font-semibold">لا توجد إرساليات ورش مكن مسجلة لهذا الموديل.</p>;
  }
  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden">
      <div className="bg-emerald-50 px-4 py-2 font-black text-emerald-950 text-xs">
        تشغيلات ورش المكن والخياطة ({records.length}):
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-right text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
            <tr>
              <th className="py-2 px-3">القطعة</th>
              <th className="py-2 px-3">اسم الورشة</th>
              <th className="py-2 px-3 text-center">تاريخ الخروج</th>
              <th className="py-2 px-3 text-center">الاستلام المتوقع</th>
              <th className="py-2 px-3 text-center">تاريخ الاستلام</th>
              <th className="py-2 px-3 text-center">العدد المسلّم</th>
              <th className="py-2 px-3 text-center">الحالة</th>
              <th className="py-2 px-3">ملاحظات المكن</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {records.map((sd) => (
              <tr key={sd.id} className="hover:bg-slate-50">
                <td className="py-2 px-3">
                  <span className="px-2 py-0.5 rounded-md bg-emerald-700 text-white font-bold text-[10px]">
                    {sd.piece_label || getPartLabel(sd.piece_type)}
                  </span>
                </td>
                <td className="py-2 px-3 font-bold text-slate-900">{sd.workshop_name}</td>
                <td className="py-2 px-3 text-center font-mono text-slate-600">{sd.dispatched_at || '-'}</td>
                <td className="py-2 px-3 text-center font-mono text-slate-600">
                  {sd.expected_delivery_date || '-'}
                </td>
                <td className="py-2 px-3 text-center font-mono text-emerald-700">{sd.received_at || '-'}</td>
                <td className="py-2 px-3 text-center font-black text-slate-900">
                  {(sd.pieces_count || 0).toLocaleString('ar-EG')} ق
                </td>
                <td className="py-2 px-3 text-center font-bold text-emerald-700">{sd.status}</td>
                <td className="py-2 px-3 text-slate-600">{sd.notes || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};


/**
 * مصفوفة العد والفرز (اللون × المقاس) — تُعرض قطعةً قطعة (تيشرت / بنطلون / جاكيت)
 * بحيث لا تختلط بيانات قطع مختلفة في نفس الجدول.
 */
const QcMatrixTable: React.FC<{
  records: QCRecord[];
  parts: GarmentPart[];
  sizes: string[];
  stageLabel: string;
}> = ({ records, parts, sizes, stageLabel }) => {
  if (!records.length) {
    return (
      <p className="text-xs text-slate-500 font-semibold">
        لا توجد سجلات عد وفرز مسجلة في مرحلة «{stageLabel}» لهذا الموديل.
      </p>
    );
  }

  // نبني الأجزاء الفعلية = قطع الموديل + أي قطعة ظهرت في السجلات
  const partsWithData = parts.slice();
  records.forEach((r) => {
    const p = partOf(r);
    if (!partsWithData.includes(p)) partsWithData.push(p);
  });

  return (
    <div className="space-y-4">
      {partsWithData.map((part) => {
        const partRecords = records.filter((r) => partOf(r) === part);
        if (!partRecords.length) {
          return (
            <div
              key={part}
              className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-500 font-semibold"
            >
              {getPartLabel(part)}: لا يوجد عد مسجل في هذه المرحلة.
            </div>
          );
        }
        const matrix = buildQcMatrix(partRecords, sizes);
        return (
          <div key={part} className="border border-slate-200 rounded-2xl overflow-hidden">
            <div className="bg-slate-900 px-4 py-2 font-black text-white text-xs flex items-center justify-between">
              <span>مصفوفة العد — قطعة: {getPartLabel(part)}</span>
              <span className="text-[11px] font-bold text-emerald-300">
                سليم: {matrix.grand.good.toLocaleString('ar-EG')} • هالك: {matrix.grand.defect.toLocaleString('ar-EG')}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                  <tr>
                    <th className="py-2 px-3">اللون</th>
                    {matrix.sizes.map((s) => (
                      <th key={s} className="py-2 px-2 text-center whitespace-nowrap">
                        {s}
                      </th>
                    ))}
                    <th className="py-2 px-3 text-center bg-emerald-50">إجمالي السليم</th>
                    <th className="py-2 px-3 text-center bg-rose-50">إجمالي الهالك</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {matrix.colors.map((c) => {
                    let rowGood = 0;
                    let rowDefect = 0;
                    matrix.sizes.forEach((s) => {
                      const v = matrix.cell.get(`${c}||${s}`);
                      if (v) {
                        rowGood += v.good;
                        rowDefect += v.defect;
                      }
                    });
                    return (
                      <tr key={c} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-bold text-slate-900">{c}</td>
                        {matrix.sizes.map((s) => {
                          const v = matrix.cell.get(`${c}||${s}`);
                          return (
                            <td key={s} className="py-2 px-2 text-center">
                              {v ? (
                                <span className="font-bold text-slate-800">
                                  {v.good.toLocaleString('ar-EG')}
                                  {v.defect > 0 && (
                                    <span className="text-rose-600 font-black"> / {v.defect}</span>
                                  )}
                                </span>
                              ) : (
                                <span className="text-slate-300">-</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="py-2 px-3 text-center font-black text-emerald-700 bg-emerald-50/40">
                          {rowGood.toLocaleString('ar-EG')}
                        </td>
                        <td className="py-2 px-3 text-center font-black text-rose-700 bg-rose-50/40">
                          {rowDefect.toLocaleString('ar-EG')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-100 border-t border-slate-300 font-black text-slate-900">
                  <tr>
                    <td className="py-2 px-3">الإجمالي</td>
                    {matrix.sizeTotals.map((t) => (
                      <td key={t.size} className="py-2 px-2 text-center">
                        {t.good.toLocaleString('ar-EG')}
                        {t.defect > 0 && <span className="text-rose-600"> / {t.defect}</span>}
                      </td>
                    ))}
                    <td className="py-2 px-3 text-center text-emerald-800">
                      {matrix.grand.good.toLocaleString('ar-EG')}
                    </td>
                    <td className="py-2 px-3 text-center text-rose-800">
                      {matrix.grand.defect.toLocaleString('ar-EG')}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="px-4 py-1.5 bg-slate-50 border-t border-slate-200 text-[10px] text-slate-500 font-semibold">
              الخلية تُقرأ: السليم / الهالك. الدرجة الثانية تُسجَّل حالياً ضمن خانة الهالك/التالف.
            </div>
          </div>
        );
      })}
    </div>
  );
};


/* ------------------------------------------------------------------ */
/* Main view                                                          */
/* ------------------------------------------------------------------ */

interface BuiltStage {
  key: StageKey;
  title: string;
  subtitle: string;
  done: boolean;
  isCurrent: boolean;
  timestamp?: string;
  user?: string;
  summary: string;
}

export const MasterModelTrackingView: React.FC = () => {
  const {
    models,
    cuttingRecords,
    qcRecords,
    printDispatches,
    sewingDispatches,
    requirements,
    modelAccessories,
    fabrics,
    fabricColors,
    globalSettings,
    sizeDefs
  } = useApp();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');
  const [activeModelForTimeline, setActiveModelForTimeline] = useState<Model | null>(null);
  const [selectedStage, setSelectedStage] = useState<{ model: Model; key: StageKey } | null>(null);
  const [showMasterPrintModal, setShowMasterPrintModal] = useState(false);

  const activeModels = models.filter((m) => !m.is_deleted);

  /* ----------------------- model-based helpers ----------------------- */

  const getModelSizes = (model: Model): string[] => {
    if (!model.size_category_id) return [];
    const def = sizeDefs.find((s) => s.id === model.size_category_id);
    return splitSizes(def?.values);
  };

  const modelParts = (model: Model): GarmentPart[] => partsForComposition(model.garment_composition);

  const compositionLabel = (model: Model): string =>
    GARMENT_COMPOSITION_LABELS[model.garment_composition || 'two_pieces'] || 'غير محدد';

  const findTimelineEvent = (model: Model, phaseTypes: string[]) =>
    (model.timeline || []).find((e) => phaseTypes.includes(String((e.details as any)?.phase_type || '')));

  /** المرحلة الحالية الحقيقية للموديل (بدون تصنيف نصي هش) */
  const resolveCurrentStageKey = (model: Model): StageKey => {
    const s = model.status || '';
    if (s.includes('فرز وكنترول')) return 'qc_pre_print';
    if (s.includes('تصميم')) return 'design';
    if (s.includes('قص')) return 'cutting';
    if (s.includes('قبل الطباعة')) return 'qc_pre_print';
    if (s.includes('بعد الطباعة')) return 'qc_post_print';
    if (s.includes('بعد المكن')) return 'qc_post_sewing';
    if (s.includes('المكن') || s.includes('خياطة')) return 'sewing';
    if (
      s.includes('المطبعة') ||
      s.includes('طباعة') ||
      s.includes('تجميع') ||
      s.includes('جاهز')
    )
      return 'printing';
    if (s.includes('مكتمل') || s.includes('الإنتاج التام') || s.includes('مخزن')) return 'qc_post_sewing';
    return 'design';
  };


  /**
   * بناء المراحل السبع من السجلات الفعلية (وليست من نص التايم لاين).
   * كل مرحلة تعرض بياناتها الخاصة فقط، وبدون أي ازدواج للمراحل.
   */
  const buildStages = (model: Model): BuiltStage[] => {
    const sizes = getModelSizes(model);

    const cutRecs = cuttingRecords.filter((r) => r.model_id === model.id);
    const qcPre = qcRecords.filter((q) => q.model_id === model.id && q.stage === 'before_print');
    const qcPostPrint = qcRecords.filter((q) => q.model_id === model.id && q.stage === 'after_print');
    const qcPostSew = qcRecords.filter((q) => q.model_id === model.id && q.stage === 'after_sewing');
    const prints = printDispatches.filter((d) => d.model_id === model.id);
    const sews = sewingDispatches.filter((d) => d.model_id === model.id);
    const reqs = requirements.filter((r) => r.model_id === model.id);
    const accs = modelAccessories.filter((a) => a.model_id === model.id);

    const designEvent = findTimelineEvent(model, ['design']);
    const cutFinishEvent = findTimelineEvent(model, [
      'cutting_finished',
      'cutting_done',
      'design_to_cutting',
      'cutting'
    ]);
    const qcPreEvent = findTimelineEvent(model, ['qc_before_print']);
    const printEvent = findTimelineEvent(model, ['printing_dispatch', 'printing_received', 'printing_receive']);
    const qcPostPrintEvent = findTimelineEvent(model, ['qc_after_print']);
    const sewEvent = findTimelineEvent(model, [
      'sewing_finished',
      'sewing_receive',
      'sewing_dispatch',
      'sewing_sent'
    ]);
    const qcPostSewEvent = findTimelineEvent(model, ['qc_after_sewing']);

    const cutByPart = sumByPart(
      cutRecs.map((r) => ({
        part: partOf(r),
        qty: Number(r.pieces_count ?? r.piecesCount ?? r.cut_pieces ?? 0)
      }))
    );
    const goodByPart = (recs: QCRecord[]) =>
      sumByPart(
        recs.map((q) => ({ part: partOf(q), qty: Number(q.good_qty ?? q.counted_pieces ?? 0) }))
      );
    const defectByPart = (recs: QCRecord[]) =>
      sumByPart(
        recs.map((q) => ({ part: partOf(q), qty: Number(q.defect_qty ?? q.defect_pieces ?? 0) }))
      );

    const printByPart = sumByPart(
      prints.map((p) => ({
        part: (p.piece_type || 'shirt') as string,
        qty: Number(p.pieces_count || 0)
      }))
    );
    const sewByPart = sumByPart(
      sews.map((s) => ({
        part: (s.piece_type || 'shirt') as string,
        qty: Number(s.pieces_count || 0)
      }))
    );
    const sewingWorkshops = sews
      .map((s) => `${getPartLabel(s.piece_type)} ← ${s.workshop_name}`)
      .filter((v, i, arr) => arr.indexOf(v) === i);

    const currentKey = resolveCurrentStageKey(model);

    return [
      {
        key: 'design',
        ...STAGE_META.design,
        done: true,
        isCurrent: currentKey === 'design',
        timestamp: designEvent?.timestamp || model.created_at,
        user: designEvent?.user || designEvent?.user_name || 'قسم التصميم',
        summary: `${compositionLabel(model)} • المقاسات: ${
          sizes.length ? sizes.join(' / ') : 'غير محددة'
        } • ${reqs.length} خامة • ${accs.length} إكسسوار`
      },
      {
        key: 'cutting',
        ...STAGE_META.cutting,
        done: cutRecs.length > 0,
        isCurrent: currentKey === 'cutting',
        timestamp: cutFinishEvent?.timestamp,
        user: cutFinishEvent?.user || cutFinishEvent?.user_name || cutRecs[0]?.cutter_name,
        summary: cutRecs.length
          ? `${cutRecs.length} فرشة • المقصوص: ${formatPartsQty(cutByPart)}`
          : `لم يبدأ القص • المستهدف: ${(model.target_cut_quantity || 0).toLocaleString('ar-EG')} قطعة`
      },
      {
        key: 'qc_pre_print',
        ...STAGE_META.qc_pre_print,
        done: qcPre.length > 0,
        isCurrent: currentKey === 'qc_pre_print',
        timestamp: qcPreEvent?.timestamp,
        user: qcPreEvent?.user || qcPreEvent?.user_name,
        summary: qcPre.length
          ? `سليم: ${formatPartsQty(goodByPart(qcPre))} • هالك: ${formatPartsQty(defectByPart(qcPre))}`
          : 'لم يُسجل عد قبل الطباعة بعد'
      },
      {
        key: 'printing',
        ...STAGE_META.printing,
        done: prints.length > 0,
        isCurrent: currentKey === 'printing',
        timestamp: printEvent?.timestamp,
        user: printEvent?.user || printEvent?.user_name,
        summary: prints.length
          ? `${prints.length} إرسالية • ${formatPartsQty(printByPart)}`
          : 'لم يُرسل للمطبعة بعد'
      },
      {
        key: 'qc_post_print',
        ...STAGE_META.qc_post_print,
        done: qcPostPrint.length > 0,
        isCurrent: currentKey === 'qc_post_print',
        timestamp: qcPostPrintEvent?.timestamp,
        user: qcPostPrintEvent?.user || qcPostPrintEvent?.user_name,
        summary: qcPostPrint.length
          ? `سليم: ${formatPartsQty(goodByPart(qcPostPrint))} • هالك: ${formatPartsQty(defectByPart(qcPostPrint))}`
          : 'لم يُسجل عد بعد الطباعة بعد'
      },
      {
        key: 'sewing',
        ...STAGE_META.sewing,
        done: sews.length > 0,
        isCurrent: currentKey === 'sewing',
        timestamp: sewEvent?.timestamp,
        user: sewEvent?.user || sewEvent?.user_name,
        summary: sews.length
          ? `${sewingWorkshops.join(' • ')} • ${formatPartsQty(sewByPart)}`
          : 'لم تُرسل للورش بعد'
      },
      {
        key: 'qc_post_sewing',
        ...STAGE_META.qc_post_sewing,
        done: qcPostSew.length > 0,
        isCurrent: currentKey === 'qc_post_sewing',
        timestamp: qcPostSewEvent?.timestamp,
        user: qcPostSewEvent?.user || qcPostSewEvent?.user_name,
        summary: qcPostSew.length
          ? `سليم: ${formatPartsQty(goodByPart(qcPostSew))} • هالك: ${formatPartsQty(defectByPart(qcPostSew))}`
          : 'لم يُسجل العد النهائي بعد'
      }
    ];
  };


  /* ----------------------------- filtering ---------------------------- */

  const filteredModels = activeModels.filter((model) => {
    const printHouse = model.print_house || model.print_house_name || '';
    const workshops = sewingDispatches
      .filter((s) => s.model_id === model.id)
      .map((s) => s.workshop_name)
      .join(' ');
    const matchesSearch =
      model.model_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (model.model_type || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (model.cutter_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      printHouse.toLowerCase().includes(searchTerm.toLowerCase()) ||
      workshops.toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;

    if (selectedStatusFilter === 'all') return true;

    const currentKey = resolveCurrentStageKey(model);
    if (selectedStatusFilter === 'design') return currentKey === 'design';
    if (selectedStatusFilter === 'cutting') return currentKey === 'cutting';
    if (selectedStatusFilter === 'printing') return currentKey === 'printing';
    if (selectedStatusFilter === 'qc')
      return ['qc_pre_print', 'qc_post_print', 'qc_post_sewing'].includes(currentKey);
    if (selectedStatusFilter === 'sewing') return currentKey === 'sewing';
    if (selectedStatusFilter === 'completed') return model.status.includes('مكتمل') || model.status.includes('الإنتاج التام');
    return true;
  });

  const countByStage = (key: StageKey) => activeModels.filter((m) => resolveCurrentStageKey(m) === key).length;
  const countDesign = countByStage('design');
  const countCutting = countByStage('cutting');
  const countPrinting = countByStage('printing');
  const countSewing = countByStage('sewing');
  const countCompleted = activeModels.filter(
    (m) => m.status.includes('مكتمل') || m.status.includes('الإنتاج التام')
  ).length;

  const getStatusBadgeColor = (status: string) => {
    const s = status || '';
    if (s.includes('تصميم')) return 'bg-amber-100 text-amber-800 border-amber-300';
    if (s.includes('قص')) return 'bg-blue-100 text-blue-800 border-blue-300';
    if (s.includes('قبل الطباعة')) return 'bg-purple-100 text-purple-800 border-purple-300';
    if (s.includes('بعد الطباعة')) return 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300';
    if (s.includes('المطبعة') || s.includes('طباعة') || s.includes('تجميع'))
      return 'bg-indigo-100 text-indigo-800 border-indigo-300';
    if (s.includes('بعد المكن')) return 'bg-teal-100 text-teal-800 border-teal-300';
    if (s.includes('المكن') || s.includes('خياطة')) return 'bg-emerald-100 text-emerald-800 border-emerald-300';
    if (s.includes('مكتمل') || s.includes('الإنتاج التام')) return 'bg-teal-100 text-teal-800 border-teal-300';
    return 'bg-slate-100 text-slate-800 border-slate-300';
  };

  /** ورش الخياطة مقسمة لكل قطعة (تيشرت / بنطلون / جاكيت) */
  const getSewingWorkshopsByPart = (model: Model) => {
    const parts = modelParts(model);
    return parts.map((part) => {
      const recs = sewingDispatches.filter(
        (s) => s.model_id === model.id && (s.piece_type || 'shirt') === part
      );
      const names = recs.map((s) => s.workshop_name).filter((v, i, arr) => arr.indexOf(v) === i);
      return { part, names, count: recs.length };
    });
  };


  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <GitCommit className="w-8 h-8 text-blue-600" />
            <span>حركة وتفاصيل الموديلات (سجل التتبع الشامل)</span>
          </h2>
          <p className="text-slate-500 text-sm mt-0.5">
            تتبع الموديل عبر 7 مراحل إنتاج حقيقية: التصميم ← القص ← العد قبل الطباعة ← المطابع ← العد بعد
            الطباعة ← المكن ← الفحص النهائي. كل مرحلة تعرض بياناتها الخاصة فقط.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowMasterPrintModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm shadow-md transition-all hover:scale-102 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة كشف جرد الموديلات الشامل</span>
          </button>
        </div>
      </div>

      {/* Top Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
          <p className="text-[11px] font-bold text-slate-500">إجمالي الموديلات</p>
          <h4 className="text-2xl font-black text-slate-900 mt-0.5">{activeModels.length}</h4>
        </div>
        <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
          <p className="text-[11px] font-bold text-amber-700">مرحلة التصميم</p>
          <h4 className="text-2xl font-black text-amber-800 mt-0.5">{countDesign}</h4>
        </div>
        <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
          <p className="text-[11px] font-bold text-blue-700">جاري القص</p>
          <h4 className="text-2xl font-black text-blue-800 mt-0.5">{countCutting}</h4>
        </div>
        <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
          <p className="text-[11px] font-bold text-indigo-700">المطابع والتطريز</p>
          <h4 className="text-2xl font-black text-indigo-800 mt-0.5">{countPrinting}</h4>
        </div>
        <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
          <p className="text-[11px] font-bold text-emerald-700">قسم المكن</p>
          <h4 className="text-2xl font-black text-emerald-800 mt-0.5">{countSewing}</h4>
        </div>
        <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs">
          <p className="text-[11px] font-bold text-teal-700">مكتمل الإنتاج</p>
          <h4 className="text-2xl font-black text-teal-800 mt-0.5">{countCompleted}</h4>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/80 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1.5 w-full md:w-auto">
          {[
            { id: 'all', label: 'الكل' },
            { id: 'design', label: 'التصميم' },
            { id: 'cutting', label: 'القص' },
            { id: 'printing', label: 'المطابع' },
            { id: 'qc', label: 'الفرز' },
            { id: 'sewing', label: 'المكن' },
            { id: 'completed', label: 'المكتمل' }
          ].map((pill) => (
            <button
              key={pill.id}
              onClick={() => setSelectedStatusFilter(pill.id)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                selectedStatusFilter === pill.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="بحث برقم الموديل، المقصدار، المطبعة، ورشة الخياطة..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full ps-9 pe-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
          />
        </div>
      </div>


      {/* Models Table View */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-bold">
              <tr>
                <th className="py-3.5 px-4">الموديل والصورة</th>
                <th className="py-3.5 px-3">القطع والمقاسات المعتمدة</th>
                <th className="py-3.5 px-3">المرحلة الحالية</th>
                <th className="py-3.5 px-3 text-center">المستهدف للقص</th>
                <th className="py-3.5 px-3 text-center">المقصوص فعلياً</th>
                <th className="py-3.5 px-3 text-center">بعد الطباعة</th>
                <th className="py-3.5 px-3 text-center">بعد المكن</th>
                <th className="py-3.5 px-3">ورش الخياطة / المطبعة</th>
                <th className="py-3.5 px-4 text-center">سجل المراحل</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredModels.length > 0 ? (
                filteredModels.map((model) => {
                  const cutPieces = model.total_cut_pieces || model.actual_cut_count || 0;
                  const printHouse = model.print_house || model.print_house_name || '';
                  const sizes = getModelSizes(model);
                  const modelCutRecs = cuttingRecords.filter((r) => r.model_id === model.id);
                  const cutByPart = sumByPart(
                    modelCutRecs.map((r) => ({
                      part: partOf(r),
                      qty: Number(r.pieces_count ?? r.piecesCount ?? r.cut_pieces ?? 0)
                    }))
                  );
                  const workshopsByPart = getSewingWorkshopsByPart(model).filter((w) => w.count > 0);
                  const qcPostPrintRecs = qcRecords.filter(
                    (q) => q.model_id === model.id && q.stage === 'after_print'
                  );
                  const qcPostSewRecs = qcRecords.filter(
                    (q) => q.model_id === model.id && q.stage === 'after_sewing'
                  );
                  const postPrintByPart = sumByPart(
                    qcPostPrintRecs.map((q) => ({
                      part: partOf(q),
                      qty: Number(q.good_qty ?? q.counted_pieces ?? 0)
                    }))
                  );
                  const postSewByPart = sumByPart(
                    qcPostSewRecs.map((q) => ({
                      part: partOf(q),
                      qty: Number(q.good_qty ?? q.counted_pieces ?? 0)
                    }))
                  );
                  const postPrintTotal = Object.values(postPrintByPart).reduce(
                    (acc, v) => acc + Number(v || 0),
                    0
                  );
                  const postSewTotal = Object.values(postSewByPart).reduce(
                    (acc, v) => acc + Number(v || 0),
                    0
                  );
                  const postPrintShown = postPrintTotal || model.count_after_print || 0;
                  const postSewShown = postSewTotal || model.count_after_sewing || 0;

                  return (
                    <tr key={model.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-xl bg-slate-100 overflow-hidden shrink-0 border border-slate-200/80">
                            {model.image ? (
                              <img
                                src={model.image}
                                alt={model.model_code}
                                className="w-full h-full object-contain bg-white"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-slate-400">
                                <Shirt className="w-5 h-5 opacity-40" />
                              </div>
                            )}
                          </div>
                          <div>
                            <span className="font-black text-slate-900 block text-sm">
                              {model.model_code}
                            </span>
                            <span className="text-[10px] text-slate-400 font-medium">
                              {model.created_at
                                ? new Date(model.created_at).toLocaleDateString('ar-EG')
                                : '-'}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-800">{compositionLabel(model)}</div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {sizes.length ? (
                            sizes.map((sz) => (
                              <span
                                key={sz}
                                className="px-1.5 py-0.5 rounded-md bg-slate-900 text-white text-[10px] font-bold"
                              >
                                {sz}
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] text-slate-400">بدون مقاسات معتمدة</span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <span
                          className={`px-2.5 py-1 rounded-full text-[11px] font-bold border inline-block ${getStatusBadgeColor(
                            model.status
                          )}`}
                        >
                          {model.status}
                        </span>
                      </td>


                      <td className="py-3 px-3 text-center font-bold text-slate-700">
                        {(model.target_cut_quantity || 0).toLocaleString('ar-EG')}
                      </td>

                      <td className="py-3 px-3 text-center">
                        <div className="font-extrabold text-blue-700">
                          {cutPieces > 0 ? cutPieces.toLocaleString('ar-EG') : '-'}
                        </div>
                        {cutPieces > 0 && (
                          <div className="text-[10px] text-slate-500 font-semibold mt-0.5">
                            {formatPartsQty(cutByPart)}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 text-center">
                        <div className="font-extrabold text-fuchsia-700">
                          {postPrintShown ? postPrintShown.toLocaleString('ar-EG') : '-'}
                        </div>
                        {postPrintTotal > 0 && (
                          <div className="text-[10px] text-slate-500 font-semibold mt-0.5">
                            {formatPartsQty(postPrintByPart)}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 text-center">
                        <div className="font-extrabold text-teal-700">
                          {postSewShown ? postSewShown.toLocaleString('ar-EG') : '-'}
                        </div>
                        {postSewTotal > 0 && (
                          <div className="text-[10px] text-slate-500 font-semibold mt-0.5">
                            {formatPartsQty(postSewByPart)}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 text-slate-600 font-medium space-y-0.5">
                        {workshopsByPart.length ? (
                          workshopsByPart.map((w) => (
                            <div key={w.part} className="text-[11px]">
                              <span className="font-bold text-emerald-800">
                                🧵 {getPartLabel(w.part)}:
                              </span>{' '}
                              {w.names.join(' / ')}
                            </div>
                          ))
                        ) : (
                          <div className="text-[11px] text-slate-400">ورش الخياطة: لم تُحدد بعد</div>
                        )}
                        <div className="text-[11px]">
                          {printHouse ? (
                            <span className="text-indigo-700 font-bold">🎨 {printHouse}</span>
                          ) : (
                            <span className="text-slate-400">المطبعة: لم تُحدد بعد</span>
                          )}
                        </div>
                        {(() => {
                          const prints = printDispatches.filter((d) => d.model_id === model.id);
                          if (!prints.length) return null;
                          const byPart = sumByPart(
                            prints.map((d) => ({
                              part: (d.piece_type || 'shirt') as string,
                              qty: Number(d.pieces_count || 0)
                            }))
                          );
                          return (
                            <div className="text-[10px] text-indigo-600 font-bold">
                              📦 {formatPartsQty(byPart)}
                            </div>
                          );
                        })()}
                      </td>

                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => setActiveModelForTimeline(model)}
                          className="px-3.5 py-1.5 rounded-full bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs border border-blue-200/80 transition flex items-center justify-center gap-1.5 mx-auto cursor-pointer"
                        >
                          <Clock className="w-3.5 h-3.5" />
                          <span>عرض المراحل (7)</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <Search className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="font-bold text-slate-600 text-sm">
                      لا توجد موديلات مطابقة للبحث أو التصفية
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>


      {/* TIMELINE DRAWER / MODAL */}
      {activeModelForTimeline && (() => {
        const model = activeModelForTimeline;
        const stages = buildStages(model);
        const sizes = getModelSizes(model);
        const currentKey = resolveCurrentStageKey(model);

        return (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl border border-slate-100 flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-150">
              {/* Drawer Header */}
              <div className="flex items-start justify-between pb-4 border-b border-slate-200">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                    <GitCommit className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-slate-900 text-lg">
                      مراحل تشغيل موديل: {model.model_code}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${getStatusBadgeColor(
                          model.status
                        )}`}
                      >
                        {model.status}
                      </span>
                      <span className="text-xs text-slate-500 font-semibold">
                        النوع: {model.model_type || '-'}
                      </span>
                      <span className="text-xs text-slate-500 font-semibold">
                        التكوين: {compositionLabel(model)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1 mt-1.5">
                      <span className="text-[10px] font-bold text-slate-500">المقاسات المعتمدة:</span>
                      {sizes.length ? (
                        sizes.map((sz) => (
                          <span
                            key={sz}
                            className="px-1.5 py-0.5 rounded-md bg-slate-900 text-white text-[10px] font-bold"
                          >
                            {sz}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-slate-400">غير محددة</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1 mt-1">
                      <span className="text-[10px] font-bold text-slate-500">القطع:</span>
                      {modelParts(model).map((p) => (
                        <span
                          key={p}
                          className="px-1.5 py-0.5 rounded-md bg-slate-100 border border-slate-300 text-slate-700 text-[10px] font-bold"
                        >
                          {getPartLabel(p)}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setActiveModelForTimeline(null)}
                  className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>


              {/* Quick Stats Grid — بيانات حقيقية مقسمة لكل قطعة */}
              <div className="grid grid-cols-2 gap-2.5 p-3.5 bg-slate-50 rounded-2xl border border-slate-100 mt-4 text-xs">
                <div>
                  <span className="text-slate-500 block">المستهدف للقص:</span>
                  <strong className="text-slate-900 text-sm font-black">
                    {(model.target_cut_quantity || 0).toLocaleString('ar-EG')} ق
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 block">المقصوص فعلياً (لكل قطعة):</span>
                  <strong className="text-blue-700 text-xs font-black">
                    {formatPartsQty(
                      sumByPart(
                        cuttingRecords
                          .filter((r) => r.model_id === model.id)
                          .map((r) => ({
                            part: partOf(r),
                            qty: Number(r.pieces_count ?? r.piecesCount ?? r.cut_pieces ?? 0)
                          }))
                      )
                    )}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 block">المطبعة / التطريز:</span>
                  <strong className="text-indigo-800 text-xs font-black">
                    {model.print_house || model.print_house_name || 'غير محدد'}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 block">ورش الخياطة (لكل قطعة):</span>
                  <div className="space-y-0.5 mt-0.5">
                    {(() => {
                      const rows = getSewingWorkshopsByPart(model).filter((w) => w.count > 0);
                      if (!rows.length) {
                        return (
                          <strong className="text-slate-500 text-xs font-bold">لم تُحدد بعد</strong>
                        );
                      }
                      return rows.map((w) => (
                        <strong
                          key={w.part}
                          className="text-emerald-800 text-[11px] font-black block"
                        >
                          {getPartLabel(w.part)}: {w.names.join(' / ')}
                        </strong>
                      ));
                    })()}
                  </div>
                </div>
              </div>


              {/* السلسلة الزمنية للمراحل السبع — كل مرحلة ببياناتها فقط */}
              <div className="flex-grow overflow-y-auto mt-4 pe-1">
                <div className="relative ps-11">
                  <div className="absolute top-4 bottom-4 start-[18px] w-0.5 bg-slate-200 rounded-full" />
                  {stages.map((stage) => {
                    const meta = STAGE_META[stage.key];
                    const stateLabel = stage.done ? 'مكتملة' : stage.isCurrent ? 'جارية الآن' : 'لم تبدأ';
                    return (
                      <button
                        key={stage.key}
                        onClick={() => setSelectedStage({ model, key: stage.key })}
                        className={`w-full text-right relative mb-2 last:mb-0 p-3 rounded-2xl border transition cursor-pointer ${
                          stage.isCurrent
                            ? 'bg-blue-50/80 border-blue-300 shadow-xs'
                            : stage.done
                            ? 'bg-white border-slate-200 hover:bg-slate-50'
                            : 'bg-slate-50/70 border-dashed border-slate-200 hover:bg-slate-100/70'
                        }`}
                      >
                        <span
                          className={`absolute -start-[38px] top-3 w-7 h-7 rounded-full flex items-center justify-center text-white ring-4 ring-white ${
                            stage.done ? meta.node : 'bg-slate-300'
                          }`}
                        >
                          {stage.done ? (
                            <CheckCircle2 className="w-4 h-4" />
                          ) : (
                            <Circle className="w-4 h-4" />
                          )}
                        </span>

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className={meta.accent}>{STAGE_ICONS[stage.key]}</span>
                            <span className="font-black text-slate-900 text-xs">{stage.title}</span>
                          </div>
                          <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${meta.badge}`}>
                            {stateLabel}
                          </span>
                        </div>

                        <p className="text-[10px] text-slate-500 font-semibold mt-0.5">{stage.subtitle}</p>

                        <p
                          className={`text-[11px] font-bold mt-1 ${
                            stage.done || stage.isCurrent ? 'text-slate-800' : 'text-slate-400'
                          }`}
                        >
                          {stage.summary}
                        </p>

                        <div className="flex flex-wrap items-center gap-3 mt-1 text-[10px] text-slate-400 font-semibold">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {stage.timestamp ? String(stage.timestamp).slice(0, 10) : 'بدون تاريخ مسجل'}
                          </span>
                          {stage.user ? (
                            <span className="flex items-center gap-1">
                              <User className="w-3 h-3" />
                              {stage.user}
                            </span>
                          ) : null}
                          <span className="flex items-center gap-1 text-blue-600 font-bold">
                            <Eye className="w-3 h-3" /> تفاصيل المرحلة
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="pt-3 mt-2 border-t border-slate-200 flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-slate-500">
                  المرحلة الحالية: {STAGE_META[currentKey].title}
                </span>
                <button
                  onClick={() => setActiveModelForTimeline(null)}
                  className="px-6 py-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
                >
                  إغلاق
                </button>
              </div>
            </div>
          </div>
        );
      })()}


      {/* STAGE DETAIL MODAL — كل مرحلة تعرض سجلاتها فقط */}
      {selectedStage &&
        (() => {
          const model = selectedStage.model;
          const key = selectedStage.key;
          const meta = STAGE_META[key];
          const sizes = getModelSizes(model);
          const parts = modelParts(model);
          const stage = buildStages(model).find((s) => s.key === key);
          const stageQc = (name: string) =>
            qcRecords.filter((q) => q.model_id === model.id && q.stage === name);
          const modelReqs = requirements.filter((r) => r.model_id === model.id);
          const modelAccs = modelAccessories.filter((a) => a.model_id === model.id);
          const modelCuts = cuttingRecords.filter((r) => r.model_id === model.id);
          const modelPrints = printDispatches.filter((d) => d.model_id === model.id);
          const modelSews = sewingDispatches.filter((d) => d.model_id === model.id);

          return (
            <div className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl max-w-5xl w-full p-6 shadow-2xl border border-slate-100 flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-150">
                <div className="flex items-start justify-between pb-4 border-b border-slate-200">
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-11 h-11 rounded-2xl flex items-center justify-center text-white ${meta.node}`}
                    >
                      {STAGE_ICONS[key]}
                    </div>
                    <div>
                      <h3 className="font-extrabold text-slate-900 text-lg">
                        {meta.title} — موديل {model.model_code}
                      </h3>
                      <p className="text-[11px] text-slate-500 font-semibold">{meta.subtitle}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-1.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            stage?.done ? meta.badge : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          {stage?.done ? 'مكتملة' : stage?.isCurrent ? 'جارية الآن' : 'لم تبدأ'}
                        </span>
                        {stage?.timestamp ? (
                          <span className="text-[10px] font-bold text-slate-500">
                            آخر تحديث: {String(stage.timestamp).slice(0, 10)}
                          </span>
                        ) : null}
                        {stage?.user ? (
                          <span className="text-[10px] font-bold text-slate-500">بواسطة: {stage.user}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => setSelectedStage(null)}
                    className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center cursor-pointer shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>


                <div className="flex-grow overflow-y-auto mt-4 pe-1 space-y-4">
                  {key === 'design' && (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                        <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200">
                          <span className="text-amber-700 font-bold block text-[10px]">تكوين الموديل</span>
                          <strong className="text-amber-900 font-black">{compositionLabel(model)}</strong>
                        </div>
                        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                          <span className="text-slate-500 font-bold block text-[10px]">القطع</span>
                          <strong className="text-slate-900 font-black">
                            {parts.map((p) => getPartLabel(p)).join(' / ') || 'غير محدد'}
                          </strong>
                        </div>
                        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                          <span className="text-slate-500 font-bold block text-[10px]">المقاسات المعتمدة</span>
                          <strong className="text-slate-900 font-black">
                            {sizes.length ? sizes.join(' / ') : 'غير محددة'}
                          </strong>
                        </div>
                        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                          <span className="text-slate-500 font-bold block text-[10px]">المستهدف للقص</span>
                          <strong className="text-slate-900 font-black">
                            {(model.target_cut_quantity || 0).toLocaleString('ar-EG')} قطعة
                          </strong>
                        </div>
                      </div>

                      <RequirementsTable reqs={modelReqs} fabrics={fabrics} fabricColors={fabricColors} />
                      <AccessoriesTable accs={modelAccs} />
                    </>
                  )}

                  {key === 'cutting' && <CuttingSpreadsTable records={modelCuts} />}

                  {key === 'qc_pre_print' && (
                    <QcMatrixTable
                      records={stageQc('before_print')}
                      parts={parts}
                      sizes={sizes}
                      stageLabel="العد قبل الطباعة"
                    />
                  )}

                  {key === 'printing' && <PrintDispatchesTable records={modelPrints} />}

                  {key === 'qc_post_print' && (
                    <QcMatrixTable
                      records={stageQc('after_print')}
                      parts={parts}
                      sizes={sizes}
                      stageLabel="العد بعد الطباعة"
                    />
                  )}

                  {key === 'sewing' && <SewingDispatchesTable records={modelSews} />}

                  {key === 'qc_post_sewing' && (
                    <QcMatrixTable
                      records={stageQc('after_sewing')}
                      parts={parts}
                      sizes={sizes}
                      stageLabel="الفحص النهائي بعد المكن"
                    />
                  )}
                </div>

                <div className="pt-3 border-t border-slate-200 flex justify-end">
                  <button
                    onClick={() => setSelectedStage(null)}
                    className="px-6 py-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
                  >
                    إغلاق
                  </button>
                </div>
              </div>
            </div>
          );
        })()}


      {/* MASTER PRINT INVENTORY MODAL */}
      {showMasterPrintModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-5xl w-full p-6 shadow-2xl border border-slate-100 flex flex-col max-h-[92vh]">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center">
                  <Printer className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-lg">كشف جرد الموديلات الشامل</h3>
                  <p className="text-xs text-slate-500">
                    كشف تفصيلي بجميع الموديلات ومواقعها الحالية في خط الإنتاج (7 مراحل)
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition flex items-center gap-2 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>طباعة فورية</span>
                </button>
                <button
                  onClick={() => setShowMasterPrintModal(false)}
                  className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Printable Content */}
            <div className="overflow-y-auto flex-grow p-4 print:p-0">
              <div className="text-center mb-6 border-b border-slate-300 pb-4">
                <h1 className="text-xl font-black text-slate-900">{globalSettings.site_name}</h1>
                <h2 className="text-base font-bold text-blue-800 mt-1">
                  كشف جرد وتتبع حركة الموديلات الشامل
                </h2>
                <div className="text-xs text-slate-500 mt-1 flex justify-center gap-6">
                  <span>تاريخ التقرير: {new Date().toLocaleDateString('ar-EG')}</span>
                  <span>إجمالي الموديلات: {filteredModels.length}</span>
                </div>
              </div>

              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-y border-slate-300 text-slate-700 font-bold">
                    <th className="py-2.5 px-3">#</th>
                    <th className="py-2.5 px-3">كود الموديل</th>
                    <th className="py-2.5 px-3">التكوين / القطع</th>
                    <th className="py-2.5 px-3">المرحلة والموقع الحالي</th>
                    <th className="py-2.5 px-3 text-center">المستهدف للقص</th>
                    <th className="py-2.5 px-3 text-center">المقصوص فعلياً</th>
                    <th className="py-2.5 px-3 text-center">بعد الطباعة</th>
                    <th className="py-2.5 px-3 text-center">بعد المكن</th>
                    <th className="py-2.5 px-3">المسؤول / الجهة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredModels.map((m, idx) => {
                    const cutCount = m.total_cut_pieces || m.actual_cut_count || 0;
                    const printHouse = m.print_house || m.print_house_name || '';
                    return (
                      <tr key={m.id}>
                        <td className="py-2 px-3 font-semibold text-slate-400">{idx + 1}</td>
                        <td className="py-2 px-3 font-black text-slate-900">{m.model_code}</td>
                        <td className="py-2 px-3 text-slate-700">
                          {GARMENT_COMPOSITION_LABELS[m.garment_composition || 'two_pieces'] || 'غير محدد'}
                        </td>
                        <td className="py-2 px-3 font-bold text-blue-800">
                          {STAGE_META[resolveCurrentStageKey(m)].title}
                        </td>
                        <td className="py-2 px-3 text-center text-slate-600">
                          {(m.target_cut_quantity || 0).toLocaleString('ar-EG')}
                        </td>
                        <td className="py-2 px-3 text-center font-bold text-slate-900">
                          {cutCount.toLocaleString('ar-EG')}
                        </td>
                        <td className="py-2 px-3 text-center text-slate-700">
                          {m.count_after_print ? m.count_after_print.toLocaleString('ar-EG') : '-'}
                        </td>
                        <td className="py-2 px-3 text-center text-slate-700">
                          {m.count_after_sewing ? m.count_after_sewing.toLocaleString('ar-EG') : '-'}
                        </td>
                        <td className="py-2 px-3 text-slate-600 text-[11px]">
                          {m.cutter_name ? `مقصدار: ${m.cutter_name} ` : ''}
                          {printHouse ? `مطبعة: ${printHouse}` : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>


              <div className="mt-8 pt-6 border-t border-slate-300 flex justify-between items-center text-xs text-slate-600 font-bold px-4">
                <div>مسؤول المتابعة والمراقبة: .......................................</div>
                <div>مدير العمليات والتشغيل: .......................................</div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setShowMasterPrintModal(false)}
                className="px-6 py-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

