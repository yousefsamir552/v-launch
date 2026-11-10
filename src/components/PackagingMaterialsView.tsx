import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  MessageCircle,
  Package,
  Pencil,
  Ruler,
  Save,
  Settings2,
  ShoppingCart,
  TrendingDown
} from 'lucide-react';
import {
  PACKAGING_MATERIAL_EMOJI,
  PACKAGING_MATERIAL_KEYS,
  PACKAGING_MATERIAL_LABELS,
  PACKAGING_MATERIAL_OPERATION_LABELS,
  PACKAGING_MATERIAL_RULE_MODE_LABELS,
  PACKAGING_MATERIAL_UNITS,
  PackagingMaterialKey,
  PackagingMaterialOperation,
  PackagingMaterialRule,
  PackagingMaterialRuleMode,
  PackagingMaterialSizeRule,
  PackagingMaterialUnit
} from '../types';
import { computePackagingDemand } from '../utils/packagingMaterials';

const formatNumber = (value: number): string => {
  const num = Number(value) || 0;
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
};

interface RowDraft {
  id?: string;
  sizeGroupId: string;
  sizeGroupName: string;
  consumptionPerPiece: number;
  dimensionsSpec: string;
  supplierId: string;
  minAlertThreshold: number;
  currentStock: number;
}

const blankRow = (sizeGroupId = '', sizeGroupName = ''): RowDraft => ({
  sizeGroupId,
  sizeGroupName,
  consumptionPerPiece: 0,
  dimensionsSpec: '',
  supplierId: '',
  minAlertThreshold: 0,
  currentStock: 0
});

const rowToDraft = (row: PackagingMaterialSizeRule): RowDraft => ({
  id: row.id,
  sizeGroupId: row.size_group_id || '',
  sizeGroupName: row.size_group_name || '',
  consumptionPerPiece: Number(row.consumption_per_piece) || 0,
  dimensionsSpec: row.dimensions_spec || '',
  supplierId: row.supplier_id || '',
  minAlertThreshold: Number(row.min_alert_threshold) || 0,
  currentStock: Number(row.current_stock) || 0
});

const OPERATIONS: PackagingMaterialOperation[] = ['add', 'deduct', 'adjust'];

const MaterialStockRow: React.FC<{
  rule: PackagingMaterialRule;
  row: PackagingMaterialSizeRule;
  demand: ReturnType<typeof computePackagingDemand>;
  canEdit: boolean;
  canSend: boolean;
  onWhatsapp: () => void;
}> = ({ rule, row, demand, canEdit, canSend, onWhatsapp }) => {
  const { recordPackagingMaterialTransaction, addFlashMessage } = useApp();
  const [open, setOpen] = useState(false);
  const [operation, setOperation] = useState<PackagingMaterialOperation>('add');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      addFlashMessage('أدخل كمية صحيحة أكبر من صفر', 'warning');
      return;
    }
    setBusy(true);
    const result = await recordPackagingMaterialTransaction({
      sizeRuleId: row.id,
      operation,
      amount: value,
      notes: notes.trim()
    });
    setBusy(false);
    if (result.success) {
      setOpen(false);
      setAmount('');
      setNotes('');
    }
  };

  const lastTxn =
    row.transactions && row.transactions.length ? row.transactions[0] : undefined;
  const tone = demand.belowMinThreshold
    ? 'bg-rose-600 animate-pulse'
    : demand.hasShortage
    ? 'bg-amber-400'
    : 'bg-emerald-500';

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${tone}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-black text-xs text-slate-900">
                {row.size_group_name || 'كل المقاسات'}
              </h4>
              {row.dimensions_spec && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 text-[9px] font-bold">
                  <Ruler className="w-3 h-3" /> {row.dimensions_spec}
                </span>
              )}
              <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[9px] font-black">
                استهلاك/قطعة: {formatNumber(demand.consumptionPerPiece)}
              </span>
            </div>
            <p className="text-[10px] text-slate-500 font-semibold mt-1">
              المورد: <span className="font-black text-slate-700">{row.supplier_name || 'غير محدد'}</span>
              {row.supplier_phone ? ` • ${row.supplier_phone}` : ''}
              {' • '}موديلات محسوبة: {demand.modelCount} ({formatNumber(demand.totalPieces)} قطعة)
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="px-2.5 py-1 rounded-xl bg-slate-50 border border-slate-200">
            <p className="text-[9px] font-bold text-slate-500">الرصيد</p>
            <p className="text-xs font-black text-slate-900">{formatNumber(demand.stock)}</p>
          </div>
          <div className="px-2.5 py-1 rounded-xl bg-blue-50 border border-blue-200">
            <p className="text-[9px] font-bold text-blue-600">الاحتياج</p>
            <p className="text-xs font-black text-blue-900">{formatNumber(demand.required)}</p>
          </div>
          <div
            className={`px-2.5 py-1 rounded-xl border ${
              demand.shortage > 0
                ? 'bg-rose-50 border-rose-200'
                : 'bg-emerald-50 border-emerald-200'
            }`}
          >
            <p
              className={`text-[9px] font-bold ${
                demand.shortage > 0 ? 'text-rose-600' : 'text-emerald-600'
              }`}
            >
              العجز
            </p>
            <p
              className={`text-xs font-black ${
                demand.shortage > 0 ? 'text-rose-900' : 'text-emerald-900'
              }`}
            >
              {formatNumber(demand.shortage)}
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {demand.belowMinThreshold ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-black">
            <AlertTriangle className="w-3.5 h-3.5" />
            الرصيد وصل حد التنبيه ({formatNumber(row.min_alert_threshold)} {rule.unit})
          </span>
        ) : demand.hasShortage ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-black">
            <TrendingDown className="w-3.5 h-3.5" /> الرصيد أقل من الاحتياج الحالي
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black">
            <CheckCircle2 className="w-3.5 h-3.5" /> الرصيد كافٍ
          </span>
        )}

        <div className="flex items-center gap-2 ms-auto">
          {(demand.hasShortage || demand.belowMinThreshold) && (
            <button
              type="button"
              onClick={onWhatsapp}
              disabled={!canSend}
              title={canSend ? 'إرسال طلب توريد عبر واتساب' : 'لا تمتلك صلاحية إرسال طلبات واتساب'}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black transition ${
                canSend
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'bg-slate-200 text-slate-500 cursor-not-allowed'
              }`}
            >
              <MessageCircle className="w-3.5 h-3.5" /> طلب واتساب
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => setOpen((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900 text-white text-[10px] font-black hover:bg-slate-800"
            >
              <Package className="w-3.5 h-3.5" /> حركة مخزون
            </button>
          )}
        </div>
      </div>

      {open && canEdit && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {OPERATIONS.map((op) => (
              <button
                key={op}
                type="button"
                onClick={() => setOperation(op)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-black border transition ${
                  operation === op
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {PACKAGING_MATERIAL_OPERATION_LABELS[op]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[10px] font-black text-slate-600">
              الكمية ({rule.unit})
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="mt-1 block w-28 px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold focus:outline-none focus:ring-2 focus:ring-orange-300"
              />
            </label>
            <label className="text-[10px] font-black text-slate-600 flex-1 min-w-[150px]">
              ملاحظات
              <input
                type="text"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="مثال: فاتورة توريد رقم 123"
                className="mt-1 block w-full px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold focus:outline-none focus:ring-2 focus:ring-orange-300"
              />
            </label>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-black hover:bg-emerald-700 disabled:opacity-60"
            >
              {busy ? 'جارٍ الحفظ...' : 'حفظ الحركة'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-[10px] font-black hover:bg-slate-100"
            >
              إلغاء
            </button>
          </div>
          {lastTxn && (
            <p className="text-[9px] text-slate-500 font-semibold">
              آخر حركة:{' '}
              {lastTxn.operation_label || PACKAGING_MATERIAL_OPERATION_LABELS[lastTxn.operation]} بمقدار{' '}
              {formatNumber(lastTxn.amount)}
              {lastTxn.notes ? ` — ${lastTxn.notes}` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export const PackagingMaterialsView: React.FC = () => {
  const {
    models,
    sizeDefs,
    suppliers,
    packagingMaterialRules,
    hasPermission,
    canSendWhatsApp,
    formatSupplierWhatsappMessage,
    addFlashMessage,
    savePackagingMaterialRule
  } = useApp();

  const canEdit = hasPermission('assembly_packaging', true);
  const [view, setView] = useState<'stock' | 'rules'>('stock');
  const [editingKey, setEditingKey] = useState<PackagingMaterialKey>('bags');
  const [saving, setSaving] = useState(false);

  const rulesByKey = useMemo(() => {
    const map: Partial<Record<PackagingMaterialKey, PackagingMaterialRule>> = {};
    packagingMaterialRules.forEach((rule) => {
      map[rule.material_key] = rule;
    });
    return map;
  }, [packagingMaterialRules]);

  const orderedRules = useMemo(
    () => PACKAGING_MATERIAL_KEYS.map((key) => ({ key, rule: rulesByKey[key] })),
    [rulesByKey]
  );

  const summary = useMemo(() => {
    let rows = 0;
    let critical = 0;
    let shortage = 0;
    orderedRules.forEach(({ rule }) => {
      if (!rule) return;
      (rule.size_rules || []).forEach((row) => {
        const demand = computePackagingDemand(models, rule, row);
        rows += 1;
        if (demand.belowMinThreshold) critical += 1;
        shortage += demand.shortage;
      });
    });
    return { rows, critical, shortage };
  }, [orderedRules, models]);

  const activeRule = rulesByKey[editingKey];
  const [formUnit, setFormUnit] = useState<PackagingMaterialUnit>('قطعة');
  const [formMode, setFormMode] = useState<PackagingMaterialRuleMode>('fixed');
  const [formGroups, setFormGroups] = useState<string[]>([]);
  const [formRows, setFormRows] = useState<RowDraft[]>([blankRow()]);

  useEffect(() => {
    if (!activeRule) {
      setFormUnit('قطعة');
      setFormMode('fixed');
      setFormGroups([]);
      setFormRows([blankRow()]);
      return;
    }
    setFormUnit(activeRule.unit);
    setFormMode(activeRule.rule_mode);
    setFormGroups(
      Array.isArray(activeRule.applicable_size_groups) ? activeRule.applicable_size_groups : []
    );
    const rows = (activeRule.size_rules || []).map(rowToDraft);
    setFormRows(rows.length ? rows : [blankRow()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingKey, activeRule?.updated_at]);

  const handleModeChange = (mode: PackagingMaterialRuleMode) => {
    setFormMode(mode);
    if (mode === 'fixed') {
      const base = formRows.find((row) => !row.sizeGroupId) || formRows[0] || blankRow();
      setFormRows([{ ...base, sizeGroupId: '', sizeGroupName: '' }]);
      return;
    }
    const selected = sizeDefs.filter((size) => formGroups.includes(size.id));
    setFormRows(
      selected.length
        ? selected.map((size) => {
            const existing = formRows.find((row) => row.sizeGroupId === size.id);
            return existing
              ? { ...existing, sizeGroupId: size.id, sizeGroupName: size.name }
              : blankRow(size.id, size.name);
          })
        : [blankRow()]
    );
  };

  const toggleGroup = (sizeId: string, sizeName: string) => {
    const selected = formGroups.includes(sizeId);
    setFormGroups(selected ? formGroups.filter((id) => id !== sizeId) : [...formGroups, sizeId]);
    if (formMode === 'fixed') return;
    if (selected) {
      setFormRows((prev) => prev.filter((row) => row.sizeGroupId !== sizeId));
    } else {
      setFormRows((prev) => [...prev.filter((row) => row.sizeGroupId), blankRow(sizeId, sizeName)]);
    }
  };

  const updateRow = (index: number, patch: Partial<RowDraft>) => {
    setFormRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const handleSaveRule = async () => {
    if (!canEdit) {
      addFlashMessage('لا تمتلك صلاحية تعديل قواعد خامات التشغيل', 'danger');
      return;
    }
    const rows = formRows.length ? formRows : [blankRow()];
    setSaving(true);
    const result = await savePackagingMaterialRule({
      materialKey: editingKey,
      unit: formUnit,
      ruleMode: formMode,
      applicableSizeGroups: formGroups,
      sizeRules: rows.map((row) => ({
        id: row.id,
        sizeGroupId: row.sizeGroupId,
        sizeGroupName: row.sizeGroupName,
        consumptionPerPiece: Number(row.consumptionPerPiece) || 0,
        dimensionsSpec: row.dimensionsSpec,
        supplierId: row.supplierId,
        minAlertThreshold: Number(row.minAlertThreshold) || 0,
        currentStock: Number(row.currentStock) || 0
      }))
    });
    setSaving(false);
    if (result.success) {
      setView('stock');
    }
  };

  const handleWhatsappOrder = (
    rule: PackagingMaterialRule,
    row: PackagingMaterialSizeRule,
    demand: ReturnType<typeof computePackagingDemand>
  ) => {
    if (!canSendWhatsApp()) {
      addFlashMessage('لا تمتلك صلاحية إرسال طلبات واتساب', 'danger');
      return;
    }
    const needed =
      demand.shortage > 0
        ? Math.ceil(demand.shortage)
        : Math.max(Math.ceil(Number(row.min_alert_threshold) - demand.stock), 1);
    const text = formatSupplierWhatsappMessage({
      supplierName: row.supplier_name || 'حضرة المورد',
      itemName: `${rule.name} - ${row.size_group_name || 'كل المقاسات'}`,
      code: row.dimensions_spec || rule.material_key,
      quantity: needed,
      unit: rule.unit,
      available: demand.stock
    });
    if (row.supplier_phone) {
      const cleanPhone = row.supplier_phone.replace(/[^0-9]/g, '');
      window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`, '_blank');
      addFlashMessage('تم فتح واتساب لإرسال طلب التوريد');
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      addFlashMessage('تم نسخ نص طلب التوريد (المورد بدون رقم هاتف)', 'warning');
    }
  };

  const renderRuleCard = (key: PackagingMaterialKey, rule?: PackagingMaterialRule) => {
    const rows = rule?.size_rules || [];
    const label = rule?.name || PACKAGING_MATERIAL_LABELS[key];
    const demandRows = rule
      ? rows.map((row) => ({ row, demand: computePackagingDemand(models, rule, row) }))
      : [];
    const totalRequired = demandRows.reduce((sum, item) => sum + item.demand.required, 0);
    const totalStock = demandRows.reduce((sum, item) => sum + item.demand.stock, 0);
    const totalShortage = demandRows.reduce((sum, item) => sum + item.demand.shortage, 0);
    const critical = demandRows.some((item) => item.demand.belowMinThreshold);

    return (
      <div
        key={key}
        className={`bg-white rounded-3xl border shadow-xs overflow-hidden ${
          critical ? 'border-rose-300' : 'border-slate-200'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-gradient-to-l from-slate-50 to-white border-b border-slate-100">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{PACKAGING_MATERIAL_EMOJI[key]}</span>
            <div>
              <h3 className="font-black text-sm text-slate-900">{label}</h3>
              <p className="text-[10px] font-bold text-slate-500">
                الوحدة: {rule?.unit || 'قطعة'} •{' '}
                {rule
                  ? PACKAGING_MATERIAL_RULE_MODE_LABELS[rule.rule_mode]
                  : 'لم يتم الإعداد بعد'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-black">
            <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
              الاحتياج: {formatNumber(totalRequired)}
            </span>
            <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              الرصيد: {formatNumber(totalStock)}
            </span>
            <span
              className={`px-2.5 py-1 rounded-full border ${
                totalShortage > 0
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}
            >
              العجز: {formatNumber(totalShortage)}
            </span>
            <button
              type="button"
              onClick={() => {
                setEditingKey(key);
                setView('rules');
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
            >
              <Pencil className="w-3 h-3" /> تعديل القاعدة
            </button>
          </div>
        </div>

        {!rule || rows.length === 0 ? (
          <div className="p-6 text-center">
            <Settings2 className="w-8 h-8 mx-auto text-slate-300 mb-2" />
            <p className="text-xs font-black text-slate-700">
              لم يتم إعداد استهلاك هذه الخامة بعد
            </p>
            <p className="text-[10px] text-slate-500 font-semibold mt-1">
              حدّد معدل الاستهلاك لكل قطعة والمقاسات والمواصفات والمورد وحد التنبيه.
            </p>
            <button
              type="button"
              onClick={() => {
                setEditingKey(key);
                setView('rules');
              }}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900 text-white text-[11px] font-black"
            >
              <Settings2 className="w-3.5 h-3.5" /> إعداد القاعدة
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {demandRows.map(({ row, demand }) => {
              if (!rule) return null;
              return (
                <MaterialStockRow
                  key={row.id}
                  rule={rule}
                  row={row}
                  demand={demand}
                  canEdit={canEdit}
                  canSend={canSendWhatsApp()}
                  onWhatsapp={() => handleWhatsappOrder(rule, row, demand)}
                />
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const stockContent = (
    <div className="space-y-4">
      {packagingMaterialRules.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-3xl p-4 text-[11px] font-bold text-amber-800">
          جارٍ تهيئة فئات خامات التشغيل... إذا استمرت الشاشة فارغة أعد تحديث الصفحة.
        </div>
      )}
      {orderedRules.map(({ key, rule }) => renderRuleCard(key, rule))}
    </div>
  );

  const rulesContent = (
    <div className="space-y-4">
      <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-slate-600" />
          <h3 className="font-black text-sm text-slate-900">إعداد قواعد خامات التشغيل</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          {orderedRules.map(({ key, rule }) => {
            const isActive = editingKey === key;
            const configured = Boolean(rule && rule.size_rules.length);
            return (
              <button
                key={key}
                type="button"
                onClick={() => setEditingKey(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-black border transition ${
                  isActive
                    ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <span>{PACKAGING_MATERIAL_EMOJI[key]}</span>
                <span>{rule?.name || PACKAGING_MATERIAL_LABELS[key]}</span>
                {configured && (
                  <CheckCircle2
                    className={`w-3 h-3 ${isActive ? 'text-emerald-300' : 'text-emerald-600'}`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-black text-sm text-slate-900">
            {activeRule?.name || PACKAGING_MATERIAL_LABELS[editingKey]}
          </h3>
          <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-500">
            <ClipboardList className="w-3.5 h-3.5" />
            تُحسب الكميات من الموديلات التي وصلت للتشطيب أو تجاوزته
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-[10px] font-black text-slate-600">
            وحدة القياس
            <select
              value={formUnit}
              onChange={(event) => setFormUnit(event.target.value as PackagingMaterialUnit)}
              className="mt-1 block w-full px-2 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold focus:outline-none focus:ring-2 focus:ring-orange-300"
            >
              {PACKAGING_MATERIAL_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </label>

          <div>
            <p className="text-[10px] font-black text-slate-600 mb-1">نمط القاعدة</p>
            <div className="flex flex-wrap gap-2">
              {(['fixed', 'variable'] as PackagingMaterialRuleMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => handleModeChange(mode)}
                  className={`px-3 py-2 rounded-xl text-[10px] font-black border transition ${
                    formMode === mode
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {PACKAGING_MATERIAL_RULE_MODE_LABELS[mode]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <p className="text-[10px] font-black text-slate-600 mb-2">فئات المقاسات المستهدفة</p>
          {sizeDefs.length === 0 ? (
            <p className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2">
              لا توجد فئات مقاسات معرّفة. أضفها من الإعدادات ← المقاسات.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {sizeDefs.map((size) => {
                const selected = formGroups.includes(size.id);
                return (
                  <button
                    key={size.id}
                    type="button"
                    onClick={() => toggleGroup(size.id, size.name)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-black border transition ${
                      selected
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {selected ? '✓ ' : ''}
                    {size.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-black text-slate-600">
              {formMode === 'fixed'
                ? 'الاستهلاك ثابت لكل المقاسات المختارة'
                : 'الاستهلاك حسب كل مقاس'}
            </p>
            <p className="text-[9px] font-bold text-slate-500">
              لأكياس الدست: 0.0833 = كيس واحد لكل دستة (12 قطعة)
            </p>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full text-[10px]">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-start p-2 font-black">المقاس</th>
                  <th className="text-start p-2 font-black">استهلاك/قطعة</th>
                  <th className="text-start p-2 font-black">المقاسات والمواصفات</th>
                  <th className="text-start p-2 font-black">المورد</th>
                  <th className="text-start p-2 font-black">حد التنبيه</th>
                  <th className="text-start p-2 font-black">الرصيد الحالي</th>
                </tr>
              </thead>
              <tbody>
                {formRows.map((row, index) => (
                  <tr key={`${row.sizeGroupId}-${index}`} className="border-t border-slate-100">
                    <td className="p-2 font-black text-slate-800 whitespace-nowrap">
                      {row.sizeGroupName || 'كل المقاسات المختارة'}
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={row.consumptionPerPiece}
                        onChange={(event) =>
                          updateRow(index, { consumptionPerPiece: Number(event.target.value) })
                        }
                        className="w-24 px-2 py-1.5 rounded-lg border border-slate-200 bg-white font-bold focus:outline-none focus:ring-2 focus:ring-orange-300"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="text"
                        value={row.dimensionsSpec}
                        placeholder="مثال: 30×40 سم"
                        onChange={(event) =>
                          updateRow(index, { dimensionsSpec: event.target.value })
                        }
                        className="w-40 px-2 py-1.5 rounded-lg border border-slate-200 bg-white font-bold focus:outline-none focus:ring-2 focus:ring-orange-300"
                      />
                    </td>
                    <td className="p-2">
                      <select
                        value={row.supplierId}
                        onChange={(event) =>
                          updateRow(index, { supplierId: event.target.value })
                        }
                        className="w-36 px-2 py-1.5 rounded-lg border border-slate-200 bg-white font-bold focus:outline-none focus:ring-2 focus:ring-orange-300"
                      >
                        <option value="">بدون مورد</option>
                        {suppliers.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.minAlertThreshold}
                        onChange={(event) =>
                          updateRow(index, { minAlertThreshold: Number(event.target.value) })
                        }
                        className="w-24 px-2 py-1.5 rounded-lg border border-slate-200 bg-white font-bold focus:outline-none focus:ring-2 focus:ring-orange-300"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.currentStock}
                        onChange={(event) =>
                          updateRow(index, { currentStock: Number(event.target.value) })
                        }
                        className="w-24 px-2 py-1.5 rounded-lg border border-slate-200 bg-white font-bold focus:outline-none focus:ring-2 focus:ring-orange-300"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setView('stock')}
            className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-600 text-[10px] font-black hover:bg-slate-50"
          >
            رجوع للأرصدة
          </button>
          <button
            type="button"
            onClick={handleSaveRule}
            disabled={saving || !canEdit}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-emerald-600 text-white text-[10px] font-black hover:bg-emerald-700 disabled:opacity-60"
          >
            <Save className="w-3.5 h-3.5" /> {saving ? 'جارٍ الحفظ...' : 'حفظ القاعدة'}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="bg-gradient-to-l from-emerald-700 via-teal-700 to-slate-900 rounded-3xl p-6 text-white shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
              <ShoppingCart className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black">خامات التشغيل والأمبالاج</h2>
              <p className="text-[12px] text-white/80 font-semibold mt-1 leading-relaxed">
                تخطيط احتياجات التعبئة (MRP): أكياس البلاستيك، الكرتون، الشماعات، أكياس حديثي
                الولادة، وأكياس الدست.
                <span className="block text-[11px] text-white/70 mt-0.5">
                  الاحتياج = إجمالي القطع × معدل الاستهلاك لكل قطعة، والعجز = الاحتياج − الرصيد
                  الحالي.
                </span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="px-3 py-1.5 rounded-full bg-white/15 text-[11px] font-black">
              صفوف محسوبة: {summary.rows}
            </div>
            <div className="px-3 py-1.5 rounded-full bg-white/15 text-[11px] font-black">
              تنبيهات حرجة: {summary.critical}
            </div>
            <div className="px-3 py-1.5 rounded-full bg-white/15 text-[11px] font-black">
              إجمالي العجز: {formatNumber(summary.shortage)}
            </div>
          </div>
        </div>
      </div>

      {/* Switch */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setView('stock')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[11px] font-black border transition ${
            view === 'stock'
              ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Package className="w-4 h-4" /> الأرصدة والاحتياجات
        </button>
        <button
          type="button"
          onClick={() => setView('rules')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[11px] font-black border transition ${
            view === 'rules'
              ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Settings2 className="w-4 h-4" /> قواعد الاستهلاك
        </button>
      </div>

      {view === 'stock' ? stockContent : rulesContent}
    </div>
  );
};

export default PackagingMaterialsView;
