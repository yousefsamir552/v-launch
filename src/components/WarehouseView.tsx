import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Package,
  Plus,
  FileSpreadsheet,
  ArrowUpDown,
  History,
  X,
  AlertTriangle,
  Phone,
  Coins,
  BellRing,
  ShoppingCart,
  MessageCircle,
  Copy,
  Check,
  SlidersHorizontal,
  Boxes,
  Sparkles,
  Layers,
  Printer,
  Search,
  Filter,
  Palette,
  RotateCcw,
  ChevronDown,
  Pencil,
  ClipboardList,
  Scissors,
  Shirt,
  Ruler,
  Tag
} from 'lucide-react';
import { DesignModel, Fabric, FabricColor, FabricTransaction, ModelRequirement, Supplier } from '../types';
import { isImageLogo } from '../utils/printShared';
import { AccessoriesWarehouseView } from './AccessoriesWarehouseView';
import { ProductionWarehouseView } from './ProductionWarehouseView';

type WarehouseSectionTab = 'fabric' | 'accessories' | 'production';
type FabricViewSubTab = 'inventory' | 'alerts' | 'audit';

type FabricUsageBreakdownItem = {
  label: string;
  quantity: number;
  percent: number;
};

/** صف جرد واحد لكل لون: الوارد الكلي مقابل المستهلك والمتبقي + توزيع الاستهلاك. */
type FabricAuditRow = {
  fabricId: string;
  fabricName: string;
  unit: string;
  colorId: string;
  colorCode: string;
  colorName: string;
  hexCode: string;
  supplierName: string;
  totalReceived: number;
  totalConsumed: number;
  totalReturned: number;
  /** إجمالي عيوب القماش المسجلة (لا تُضاف للرصيد ولا تُحسب استهلاكاً). */
  totalDefect: number;
  remaining: number;
  reserved: number;
  available: number;
  sizeBreakdown: FabricUsageBreakdownItem[];
  typeBreakdown: FabricUsageBreakdownItem[];
  modelCodes: string[];
  unlinkedConsumed: number;
};

/** بطاقة إحصائية صغيرة تُستخدم داخل تبويب جرد القماش. */
const AuditStatCard: React.FC<{
  label: string;
  value: number;
  unit: string;
  tone: 'emerald' | 'rose' | 'sky' | 'amber' | 'slate';
}> = ({ label, value, unit, tone }) => {
  const tones: Record<string, string> = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    rose: 'bg-rose-50 border-rose-200 text-rose-900',
    sky: 'bg-sky-50 border-sky-200 text-sky-900',
    amber: 'bg-amber-50 border-amber-200 text-amber-900',
    slate: 'bg-slate-50 border-slate-200 text-slate-900'
  };
  return (
    <div className={`rounded-2xl border px-3 py-2 ${tones[tone] || tones.slate}`}>
      <span className="block text-[10px] font-bold opacity-70">{label}</span>
      <strong className="text-base font-black font-mono">{value}</strong>
      <span className="text-[10px] font-bold opacity-70 ms-1">{unit}</span>
    </div>
  );
};

/** شريط توزيع استهلاك (فئات المقاسات / أنواع الموديلات). */
const AuditBreakdownChips: React.FC<{
  label: string;
  icon: React.ReactNode;
  items: FabricUsageBreakdownItem[];
  unit: string;
  tone: 'blue' | 'violet';
}> = ({ label, icon, items, unit, tone }) => {
  if (items.length === 0) return null;
  const toneClass =
    tone === 'blue'
      ? 'bg-blue-50 border-blue-200 text-blue-900'
      : 'bg-violet-50 border-violet-200 text-violet-900';
  return (
    <div className="space-y-1.5">
      <span className="text-[11px] font-black text-slate-500 flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={`${label}-${item.label}`}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold ${toneClass}`}
          >
            <span>{item.label}</span>
            <strong className="font-mono">
              {item.quantity} {unit}
            </strong>
            <span className="opacity-70">({item.percent}%)</span>
          </span>
        ))}
      </div>
    </div>
  );
};

export const WarehouseView: React.FC = () => {
  const {
    fabrics,
    fabricColors,
    fabricTransactions,
    suppliers,
    models,
    requirements,
    sizeDefs,
    accessoryItems,
    addFabricOrColor,
    recordTransaction,
    exportWarehouseInventoryCsv,
    exportFabricTransactionsCsv,
    updateColorPrice,
    updateFabricColorDetails,
    hasPermission,
    canViewFabricPrices,
    canEditFabricPrices,
    canSendWhatsApp,
    formatSupplierWhatsappMessage,
    openWhatsAppOrder,
    addFlashMessage,
    globalSettings
  } = useApp();

  const [showPrintInventoryModal, setShowPrintInventoryModal] = useState(false);

  const canViewFabric = hasPermission('fabric_warehouse');
  const canViewAccessories = hasPermission('accessories_warehouse');
  const canViewProduction = hasPermission('production_warehouse');
  const canEdit = hasPermission('fabric_warehouse', true);

  const [activeWarehouseTab, setActiveWarehouseTab] = useState<WarehouseSectionTab>(() => {
    if (hasPermission('fabric_warehouse')) return 'fabric';
    if (hasPermission('accessories_warehouse')) return 'accessories';
    if (hasPermission('production_warehouse')) return 'production';
    return 'fabric';
  });

  React.useEffect(() => {
    if (activeWarehouseTab === 'fabric' && !canViewFabric) {
      if (canViewAccessories) setActiveWarehouseTab('accessories');
      else if (canViewProduction) setActiveWarehouseTab('production');
    } else if (activeWarehouseTab === 'accessories' && !canViewAccessories) {
      if (canViewFabric) setActiveWarehouseTab('fabric');
      else if (canViewProduction) setActiveWarehouseTab('production');
    } else if (activeWarehouseTab === 'production' && !canViewProduction) {
      if (canViewFabric) setActiveWarehouseTab('fabric');
      else if (canViewAccessories) setActiveWarehouseTab('accessories');
    }
  }, [canViewFabric, canViewAccessories, canViewProduction, activeWarehouseTab]);

  // Sub-view inside Fabric Warehouse: 'inventory' (المخزن والبطاقات) vs 'alerts' (صفحة التنبيهات الخاصة بالقماش)
  const [fabricSubView, setFabricSubView] = useState<FabricViewSubTab>('inventory');

  // Selected Fabric ID ('all' means display colors across all fabrics, or specific fabric id)
  const [selectedFabricId, setSelectedFabricId] = useState<string>(() =>
    fabrics.length > 0 ? fabrics[0].id : ''
  );

  // Advanced Search Filters (Task 1.1)
  const [colorSearchFilter, setColorSearchFilter] = useState<string>('');
  const [maxAvailableQtyFilter, setMaxAvailableQtyFilter] = useState<string>('');
  const [supplierFilter, setSupplierFilter] = useState<string>('');
  const [searchAllFabrics, setSearchAllFabrics] = useState<boolean>(false);

  const hasActiveAdvancedFilters =
    colorSearchFilter.trim() !== '' ||
    maxAvailableQtyFilter.trim() !== '' ||
    supplierFilter.trim() !== '';

  // Fallback if selected fabric was removed or not set
  const currentFabricId =
    selectedFabricId === 'all'
      ? 'all'
      : selectedFabricId || (fabrics.length > 0 ? fabrics[0].id : '');
  const selectedFabric =
    currentFabricId === 'all'
      ? undefined
      : fabrics.find((f) => f.id === currentFabricId) || fabrics[0];

  /**
   * تحديد المورد المرتبط بلون القماش بترتيب الأولوية:
   * 1) مورد الخامة المسجل (fabric.supplier_id)
   * 2) الاسم النصي القديم للخامة (fabric.supplier)
   * 3) أحدث حركة توريد (add) مسجلة على هذا اللون (supplier_id / supplier_name)
   */
  const resolveColorSupplier = (color: FabricColor): { id: string; name: string } | null => {
    const fabric = fabrics.find((f) => f.id === color.fabric_id);
    const fabricSupplierId = String(fabric?.supplier_id || '').trim();
    if (fabricSupplierId) {
      const registered = suppliers.find((s) => s.id === fabricSupplierId);
      if (registered) return { id: registered.id, name: registered.name };
    }

    const legacyFabricSupplier = String(
      (fabric as (Fabric & { supplier?: string }) | undefined)?.supplier || ''
    ).trim();
    if (legacyFabricSupplier) {
      const registered = suppliers.find(
        (s) => s.name.trim().toLowerCase() === legacyFabricSupplier.toLowerCase()
      );
      return { id: registered?.id || '', name: registered?.name || legacyFabricSupplier };
    }

    // fabricTransactions مرتبة من الأحدث للأقدم، لذا أول حركة توريد مطابقة هي الأحدث.
    const receipt = fabricTransactions.find((t) => {
      if (t.color_id !== color.id || t.operation !== 'add') return false;
      const legacyName = String(
        (t as FabricTransaction & { supplier_name?: string }).supplier_name || ''
      ).trim();
      return Boolean(String(t.supplier_id || '').trim()) || Boolean(legacyName);
    });
    if (!receipt) return null;

    const receiptSupplierId = String(receipt.supplier_id || '').trim();
    if (receiptSupplierId) {
      const registered = suppliers.find((s) => s.id === receiptSupplierId);
      if (registered) return { id: registered.id, name: registered.name };
    }
    const receiptSupplierName = String(
      (receipt as FabricTransaction & { supplier_name?: string }).supplier_name || ''
    ).trim();
    if (!receiptSupplierName) return null;
    const registered = suppliers.find(
      (s) => s.name.trim().toLowerCase() === receiptSupplierName.toLowerCase()
    );
    return { id: registered?.id || '', name: registered?.name || receiptSupplierName };
  };

  const selectedSupplierOption = suppliers.find((s) => s.id === supplierFilter) || null;

  const colorMatchesSupplierFilter = (color: FabricColor): boolean => {
    if (!supplierFilter.trim() || !selectedSupplierOption) return true;
    const supplier = resolveColorSupplier(color);
    if (!supplier) return false;
    if (supplier.id && supplier.id === selectedSupplierOption.id) return true;
    return supplier.name.trim().toLowerCase() === selectedSupplierOption.name.trim().toLowerCase();
  };

  // Base colors before advanced filters (if user searches across all fabrics or selected "all", include all fabrics)
  const baseColorsForView =
    currentFabricId === 'all' || (hasActiveAdvancedFilters && searchAllFabrics)
      ? fabricColors
      : fabricColors.filter((c) => c.fabric_id === selectedFabric?.id);

  // Colors belonging to selected fabric (unfiltered, for top summary stats)
  const colorsForSelected =
    currentFabricId === 'all'
      ? fabricColors
      : fabricColors.filter((c) => c.fabric_id === selectedFabric?.id);

  // Apply Advanced Filters:
  // 1. Filter by Available Quantity less than user-specified number
  // 2. Search by Color (name/code/hex) + Fabric name + Supplier name/code
  // 3. Filter by Supplier
  const filteredColorsForDisplay = baseColorsForView.filter((c) => {
    const availableQty = Number((c.quantity - c.reserved_quantity).toFixed(2));

    // Filter 1: Available quantity less than specified number
    if (maxAvailableQtyFilter.trim() !== '') {
      const limitNum = parseFloat(maxAvailableQtyFilter);
      if (!Number.isNaN(limitNum)) {
        if (!(availableQty < limitNum)) {
          return false;
        }
      }
    }

    // Filter 2: Supplier filter (موديل/مورد)
    if (!colorMatchesSupplierFilter(c)) {
      return false;
    }

    // Filter 3: Text search across color, fabric and supplier data
    if (colorSearchFilter.trim() !== '') {
      const q = colorSearchFilter.trim().toLowerCase();
      const qNoHash = q.replace(/^#/, '');
      const nameMatch = (c.color_name || '').toLowerCase().includes(q);
      const codeMatch = (c.color_code || '').toLowerCase().includes(q);
      const hexRaw = (c.hex_code || '').toLowerCase();
      const hexNoHash = hexRaw.replace(/^#/, '');
      const hexMatch = hexRaw.includes(q) || (qNoHash !== '' && hexNoHash.includes(qNoHash));
      const fabric = fabrics.find((f) => f.id === c.fabric_id);
      const fabricNameMatch = (fabric?.name || '').toLowerCase().includes(q);
      const supplier = resolveColorSupplier(c);
      const supplierNameMatch = (supplier?.name || '').toLowerCase().includes(q);

      if (!nameMatch && !codeMatch && !hexMatch && !fabricNameMatch && !supplierNameMatch) {
        return false;
      }
    }

    return true;
  });

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // Automatic Alert System State (Task 1.2: Replace fixed threshold buttons 1, 10, 15, 25 with a single Input Field + Confirm)
  const [minThreshold, setMinThreshold] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('erp_fabric_alert_threshold');
      const parsed = saved ? parseFloat(saved) : NaN;
      return !Number.isNaN(parsed) && parsed >= 0 ? parsed : 25;
    } catch {
      return 25;
    }
  });
  const [thresholdInput, setThresholdInput] = useState<string>(() => String(minThreshold));
  const [fabricDropdownOpen, setFabricDropdownOpen] = useState<boolean>(false);

  const handleConfirmAlertThreshold = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const parsed = parseFloat(thresholdInput);
    if (Number.isNaN(parsed) || parsed < 0) {
      addFlashMessage('يرجى إدخال رقم صحيح للكمية (0 أو أكبر)', 'warning');
      return;
    }
    setMinThreshold(parsed);
    setThresholdInput(String(parsed));
    try {
      localStorage.setItem('erp_fabric_alert_threshold', String(parsed));
    } catch {
      // ignore storage errors
    }
    addFlashMessage(`تم تأكيد حد التنبيه: يتم الآن عرض الأقمشة التي تقل كميتها عن (${parsed})`, 'info');
  };

  // Reorder Modal State
  const [reorderModalItem, setReorderModalItem] = useState<{
    color: FabricColor;
    fabric: Fabric;
    supplier?: Supplier;
    available: number;
  } | null>(null);
  const [reorderQty, setReorderQty] = useState<number>(50);
  const [reorderNotes, setReorderNotes] = useState<string>('');
  const [copiedOrder, setCopiedOrder] = useState<boolean>(false);

  // Add Modal Form State
  const [addForm, setAddForm] = useState({
    fabricId: '',
    newFabricName: '',
    unit: 'كيلو' as 'توب' | 'كيلو' | 'متر',
    colorCode: '',
    colorName: '',
    hexCode: '#3b82f6',
    quantity: 10,
    supplierId: ''
  });

  // Transaction Modal Form State
  const [activeColorId, setActiveColorId] = useState<string>('');
  const [transForm, setTransForm] = useState({
    operation: 'deduct' as 'add' | 'deduct',
    modelCodeRef: '',
    amount: 1,
    notes: ''
  });

  // Edit Color Details Modal State (تعديل كود/اسم/درجة/سعر اللون)
  const [editingColor, setEditingColor] = useState<FabricColor | null>(null);
  const [editColorForm, setEditColorForm] = useState({
    color_code: '',
    color_name: '',
    hex_code: '#64748b',
    price_per_unit: '0'
  });

  // Automatic low stock calculation across all warehouse fabrics (Strictly < minThreshold as requested: "تقل كميتها عن هذا الرقم")
  const lowStockColors = fabricColors
    .map((c) => {
      const f = fabrics.find((fab) => fab.id === c.fabric_id);
      const sup = suppliers.find((s) => s.id === f?.supplier_id);
      const available = Number((c.quantity - c.reserved_quantity).toFixed(2));
      return {
        ...c,
        fabric: f || ({ id: c.fabric_id, name: 'خامة غير محددة', unit: 'كيلو' } as Fabric),
        fabricName: f?.name || 'غير محددة',
        unit: f?.unit || 'كيلو',
        supplier: sup,
        available
      };
    })
    .filter((c) => c.available < minThreshold);

  // Number of distinct fabrics that contain at least one low-stock color
  const lowStockFabricsCount = fabrics.filter((f) =>
    fabricColors.some(
      (c) => c.fabric_id === f.id && c.quantity - c.reserved_quantity < minThreshold
    )
  ).length;

  const lowAccessoryCount =
    accessoryItems?.filter(
      (it) => it.quantity - it.reserved_quantity <= (it.min_threshold ?? 30)
    ).length || 0;

  const activeColor = fabricColors.find((c) => c.id === activeColorId);

  const handleOpenReorder = (item: {
    color: FabricColor;
    fabric: Fabric;
    supplier?: Supplier;
    available: number;
  }) => {
    setReorderModalItem(item);
    setReorderQty(50);
    setReorderNotes('');
    setCopiedOrder(false);
  };

  const handleConfirmReorderReceive = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reorderModalItem) return;

    const amount = Number(reorderQty);
    if (amount <= 0) return;

    const res = recordTransaction({
      colorId: reorderModalItem.color.id,
      operation: 'add',
      amount,
      modelCodeRef: 'إعادة توريد',
      notes: `طلبية إعادة توريد عاجلة - المورد: ${reorderModalItem.supplier?.name || 'غير محدد'}. ${reorderNotes}`
    });

    if (res.success) {
      setReorderModalItem(null);
    }
  };

  const handleCopyWhatsappText = () => {
    if (!reorderModalItem) return;
    const supplierName = reorderModalItem.supplier?.name || 'حضرة المورد';
    const text = formatSupplierWhatsappMessage({
      supplierName,
      itemName: reorderModalItem.fabric.name,
      code: `${reorderModalItem.color.color_code} (${reorderModalItem.color.color_name || 'بدون اسم'})`,
      quantity: reorderQty,
      unit: reorderModalItem.fabric.unit,
      available: reorderModalItem.available
    });

    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedOrder(true);
      setTimeout(() => setCopiedOrder(false), 3000);
    }

    openWhatsAppOrder(
      reorderModalItem.supplier?.phone,
      reorderModalItem.supplier?.whatsapp_group_link,
      text
    );
  };

  const handleOpenTransaction = (colorId: string) => {
    setActiveColorId(colorId);
    setTransForm({
      operation: 'deduct',
      modelCodeRef: '',
      amount: 1,
      notes: ''
    });
    setShowTransactionModal(true);
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const res = addFabricOrColor({
      fabricId: addForm.fabricId || undefined,
      newFabricName: addForm.newFabricName || undefined,
      unit: addForm.unit,
      colorCode: addForm.colorCode,
      colorName: addForm.colorName,
      hexCode: addForm.hexCode,
      quantity: Number(addForm.quantity) || 0,
      supplierId: addForm.supplierId || undefined
    });

    if (res.success) {
      if (res.fabricId) {
        setSelectedFabricId(res.fabricId);
      }
      setShowAddModal(false);
      setAddForm({
        fabricId: '',
        newFabricName: '',
        unit: 'كيلو',
        colorCode: '',
        colorName: '',
        hexCode: '#3b82f6',
        quantity: 10,
        supplierId: ''
      });
    }
  };

  const handleTransSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeColorId) return;

    const res = recordTransaction({
      colorId: activeColorId,
      operation: transForm.operation,
      amount: Number(transForm.amount) || 0,
      modelCodeRef: transForm.modelCodeRef,
      notes: transForm.notes
    });

    if (res.success) {
      setShowTransactionModal(false);
    }
  };

  const handleClearAdvancedFilters = () => {
    setColorSearchFilter('');
    setMaxAvailableQtyFilter('');
    setSupplierFilter('');
  };

  const handleOpenEditColor = (color: FabricColor) => {
    setEditingColor(color);
    setEditColorForm({
      color_code: color.color_code || '',
      color_name: color.color_name || '',
      hex_code: /^#[0-9A-Fa-f]{6}$/.test(color.hex_code || '') ? color.hex_code : '#64748b',
      price_per_unit: String(color.price_per_unit ?? 0)
    });
  };

  const handleEditColorSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingColor) return;

    const updates: {
      color_code?: string;
      color_name?: string;
      hex_code?: string;
      price_per_unit?: number;
    } = {
      color_code: editColorForm.color_code,
      color_name: editColorForm.color_name,
      hex_code: editColorForm.hex_code
    };

    // السعر يُعدّل فقط لمن يملك صلاحية تعديل أسعار الأقمشة.
    if (canEditFabricPrices()) {
      updates.price_per_unit = Math.max(0, parseFloat(editColorForm.price_per_unit) || 0);
    }

    const res = updateFabricColorDetails(editingColor.id, updates);
    if (res.success) {
      setEditingColor(null);
    } else {
      addFlashMessage(res.message, 'danger');
    }
  };

  // ============================================================
  // جرد القماش الشامل (وارد / مستهلك / متبقي + توزيع الاستهلاك)
  // ============================================================
  const roundQty = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

  const modelById = new Map<string, DesignModel>();
  models.forEach((model) => modelById.set(model.id, model));
  const modelByCode = new Map<string, DesignModel>();
  models.forEach((model) => {
    const code = (model.model_code || '').trim().toUpperCase();
    if (code) modelByCode.set(code, model);
  });

  const fabricAuditRows: FabricAuditRow[] = [];

  const buildAuditRowForColor = (fabric: Fabric, color: FabricColor) => {
    const colorTransactions = fabricTransactions.filter((t) => t.color_id === color.id);
    const deductTransactions = colorTransactions.filter((t) => t.operation === 'deduct');
    const returnTransactions = colorTransactions.filter(
      (t) => t.operation === 'add' && (t.notes || '').includes('إرجاع فائض')
    );
    const defectTransactions = colorTransactions.filter((t) => t.operation === 'defect');

    const totalDeducted = roundQty(
      deductTransactions.reduce((sum, t) => sum + (Number(t.amount) || 0), 0)
    );
    const totalReturned = roundQty(
      returnTransactions.reduce((sum, t) => sum + (Number(t.amount) || 0), 0)
    );
    const totalDefect = roundQty(
      defectTransactions.reduce((sum, t) => sum + (Number(t.amount) || 0), 0)
    );
    // المستهلك الصافي = إجمالي الصرف − مرتجعات فائض القص
    const totalConsumed = roundQty(Math.max(0, totalDeducted - totalReturned));
    // الرصيد الحالي هو المتبقي، وبالتالي إجمالي الوارد = المتبقي + المستهلك الصافي
    const totalReceived = roundQty(color.quantity + totalConsumed);

    const colorRequirements = requirements.filter((req) => req.color_id === color.id);
    const requirementModelIds = Array.from(
      new Set(colorRequirements.map((req) => req.model_id).filter(Boolean))
    );

    const usageByModelId = new Map<string, number>();
    const usageByModelCode = new Map<string, number>();
    let unlinkedConsumed = 0;

    const attributeUsage = (transaction: FabricTransaction, signedAmount: number) => {
      const modelCode = (transaction.model_code_ref || '').trim();
      const model = modelCode ? modelByCode.get(modelCode.toUpperCase()) : undefined;

      if (model) {
        usageByModelId.set(model.id, (usageByModelId.get(model.id) || 0) + signedAmount);
        return;
      }

      // لو الحركة غير مربوطة بكود موديل معروف: نوزعها على موديلات متطلبات هذا اللون.
      if (requirementModelIds.length === 1) {
        const modelId = requirementModelIds[0];
        usageByModelId.set(modelId, (usageByModelId.get(modelId) || 0) + signedAmount);
        return;
      }
      if (requirementModelIds.length > 1) {
        const weights = requirementModelIds.map((modelId) => ({
          modelId,
          planned: colorRequirements
            .filter((req) => req.model_id === modelId)
            .reduce((sum, req) => sum + (Number(req.planned_quantity) || 0), 0)
        }));
        const totalPlanned = weights.reduce((sum, item) => sum + item.planned, 0);
        weights.forEach(({ modelId, planned }) => {
          const share = totalPlanned > 0 ? planned / totalPlanned : 1 / weights.length;
          usageByModelId.set(modelId, (usageByModelId.get(modelId) || 0) + signedAmount * share);
        });
        return;
      }

      if (modelCode) {
        usageByModelCode.set(modelCode, (usageByModelCode.get(modelCode) || 0) + signedAmount);
      } else {
        unlinkedConsumed += signedAmount;
      }
    };

    deductTransactions.forEach((t) => attributeUsage(t, Number(t.amount) || 0));
    returnTransactions.forEach((t) => attributeUsage(t, -(Number(t.amount) || 0)));

    // تقسيم الاستهلاك على فئات المقاسات وأنواع الموديلات وأكواد الموديلات.
    const sizeCategoryLabel = (model?: DesignModel) =>
      (model?.size_category_id
        ? sizeDefs.find((def) => def.id === model.size_category_id)?.name
        : '') || 'فئة مقاس غير محددة';

    const sizeTotals = new Map<string, number>();
    const typeTotals = new Map<string, number>();
    const usedModelCodes = new Set<string>();
    let attributedConsumed = 0;

    usageByModelId.forEach((rawQty, modelId) => {
      const qty = roundQty(Math.max(0, rawQty));
      if (qty <= 0) return;
      const model = modelById.get(modelId);
      attributedConsumed += qty;
      if (model?.model_code) usedModelCodes.add(model.model_code);
      const sizeLabel = sizeCategoryLabel(model);
      const typeLabel = (model?.model_type || '').trim() || 'نوع موديل غير محدد';
      sizeTotals.set(sizeLabel, (sizeTotals.get(sizeLabel) || 0) + qty);
      typeTotals.set(typeLabel, (typeTotals.get(typeLabel) || 0) + qty);
    });

    usageByModelCode.forEach((rawQty, code) => {
      const qty = roundQty(Math.max(0, rawQty));
      if (qty <= 0) return;
      attributedConsumed += qty;
      usedModelCodes.add(code);
      sizeTotals.set('فئة مقاس غير محددة', (sizeTotals.get('فئة مقاس غير محددة') || 0) + qty);
      typeTotals.set('نوع موديل غير محدد', (typeTotals.get('نوع موديل غير محدد') || 0) + qty);
    });

    const unlinkedQty = roundQty(Math.max(0, unlinkedConsumed));
    if (unlinkedQty > 0) {
      sizeTotals.set('غير مرتبط بموديل', (sizeTotals.get('غير مرتبط بموديل') || 0) + unlinkedQty);
      typeTotals.set('غير مرتبط بموديل', (typeTotals.get('غير مرتبط بموديل') || 0) + unlinkedQty);
    }

    // إظهار أكواد موديلات المتطلبات المرتبطة باللون حتى لو لم تُصرف كمياتها بعد.
    requirementModelIds.forEach((modelId) => {
      const code = modelById.get(modelId)?.model_code;
      if (code) usedModelCodes.add(code);
    });

    const denominator = totalConsumed > 0 ? totalConsumed : attributedConsumed + unlinkedQty;
    const toBreakdown = (totals: Map<string, number>): FabricUsageBreakdownItem[] =>
      Array.from(totals.entries())
        .map(([label, quantity]) => ({
          label,
          quantity: roundQty(quantity),
          percent: denominator > 0 ? Math.round((quantity / denominator) * 1000) / 10 : 0
        }))
        .sort((a, b) => b.quantity - a.quantity);

    const resolvedSupplier = resolveColorSupplier(color);

    fabricAuditRows.push({
      fabricId: fabric.id,
      fabricName: fabric.name,
      unit: fabric.unit || 'كيلو',
      colorId: color.id,
      colorCode: color.color_code,
      colorName: color.color_name || '',
      hexCode: color.hex_code || '#64748b',
      supplierName: resolvedSupplier?.name || 'غير محدد',
      totalReceived,
      totalConsumed,
      totalReturned,
      totalDefect,
      remaining: roundQty(color.quantity),
      reserved: roundQty(color.reserved_quantity),
      available: roundQty(color.quantity - color.reserved_quantity),
      sizeBreakdown: toBreakdown(sizeTotals),
      typeBreakdown: toBreakdown(typeTotals),
      modelCodes: Array.from(usedModelCodes).sort(),
      unlinkedConsumed: unlinkedQty
    });
  };

  fabrics.forEach((fabric) => {
    fabricColors
      .filter((color) => color.fabric_id === fabric.id)
      .forEach((color) => buildAuditRowForColor(fabric, color));
  });

  // ألوان مرتبطة بخامة غير موجودة (بيانات قديمة/محذوفة) حتى لا تختفي من الجرد.
  const registeredFabricIds = new Set(fabrics.map((f) => f.id));
  fabricColors
    .filter((color) => !registeredFabricIds.has(color.fabric_id))
    .forEach((color) =>
      buildAuditRowForColor(
        { id: color.fabric_id, name: 'خامة غير محددة', description: '', unit: 'كيلو' } as Fabric,
        color
      )
    );

  const auditRowsByColorId = new Map(fabricAuditRows.map((row) => [row.colorId, row]));

  const auditFabricOrder: { id: string; name: string; unit: string }[] = [];
  fabricAuditRows.forEach((row) => {
    if (!auditFabricOrder.some((f) => f.id === row.fabricId)) {
      auditFabricOrder.push({ id: row.fabricId, name: row.fabricName, unit: row.unit });
    }
  });

  const fabricAuditGroups = auditFabricOrder.map((fabric) => ({
    fabric,
    rows: fabricAuditRows.filter((row) => row.fabricId === fabric.id)
  }));

  const auditTotals = {
    totalReceived: roundQty(fabricAuditRows.reduce((sum, row) => sum + row.totalReceived, 0)),
    totalConsumed: roundQty(fabricAuditRows.reduce((sum, row) => sum + row.totalConsumed, 0)),
    totalDefect: roundQty(fabricAuditRows.reduce((sum, row) => sum + row.totalDefect, 0)),
    totalRemaining: roundQty(fabricAuditRows.reduce((sum, row) => sum + row.remaining, 0)),
    totalAvailable: roundQty(fabricAuditRows.reduce((sum, row) => sum + row.available, 0))
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Warehouse Section Header & Segmented Sub-tabs */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/90 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-600 text-white rounded-xl shadow-xs">
              <Package className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black text-slate-900">قسم المخازن</h1>
                <span className="text-xs font-semibold px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full border border-blue-200">
                  مخازن المصنع
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                إدارة مركزية متكاملة لـ: مخزن الأقمشة، مخزن الإكسسوارات، ومخزن الإنتاج التام
              </p>
            </div>
          </div>

          {/* Sub-tab Navigation */}
          <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-xl border border-slate-200/80">
            {canViewFabric && (
              <button
                type="button"
                onClick={() => setActiveWarehouseTab('fabric')}
                className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                  activeWarehouseTab === 'fabric'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>مخزن القماش</span>
                {lowStockColors.length > 0 && (
                  <span className="px-1.5 py-0.2 bg-amber-500 text-white text-[10px] rounded-full font-mono">
                    {lowStockColors.length}
                  </span>
                )}
              </button>
            )}

            {canViewAccessories && (
              <button
                type="button"
                onClick={() => setActiveWarehouseTab('accessories')}
                className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                  activeWarehouseTab === 'accessories'
                    ? 'bg-white text-pink-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-pink-500" />
                <span>مخزن الإكسسوارات</span>
                {lowAccessoryCount > 0 && (
                  <span className="px-1.5 py-0.2 bg-amber-500 text-white text-[10px] rounded-full font-mono">
                    {lowAccessoryCount}
                  </span>
                )}
              </button>
            )}

            {canViewProduction && (
              <button
                type="button"
                onClick={() => setActiveWarehouseTab('production')}
                className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                  activeWarehouseTab === 'production'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <Boxes className="w-3.5 h-3.5 text-indigo-500" />
                <span>مخزن الإنتاج التام</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Accessories Warehouse Tab */}
      {activeWarehouseTab === 'accessories' && <AccessoriesWarehouseView />}

      {/* Production Warehouse Tab */}
      {activeWarehouseTab === 'production' && <ProductionWarehouseView />}

      {/* Fabric Warehouse Tab */}
      {activeWarehouseTab === 'fabric' && (
        <div className="space-y-6">
          {/* Top Bar with Fabric Filter Pills & Action Buttons */}
          <div className="flex flex-col gap-3">
            {/* Fabric Filter – Custom Dropdown (with yellow low-stock indicators) */}
            <div className="relative w-full lg:max-w-sm">
              <button
                type="button"
                onClick={() => setFabricDropdownOpen((v) => !v)}
                className={`w-full flex items-center justify-between gap-2 px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-bold transition-all shadow-xs cursor-pointer border ${
                  currentFabricId === 'all' && fabricSubView === 'inventory'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50'
                }`}
                title="تصفية حسب القماش"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Layers className="w-4 h-4 opacity-80 shrink-0" />
                  <span className="truncate">
                    {selectedFabric ? selectedFabric.name : 'كل الأقمشة'}
                  </span>
                  {lowStockFabricsCount > 0 && (
                    <span
                      className="relative flex h-2.5 w-2.5 shrink-0"
                      title={`${lowStockFabricsCount} خامة بها ألوان منخفضة المخزون`}
                    >
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500 ring-1 ring-amber-300" />
                    </span>
                  )}
                </span>
                <ChevronDown
                  className={`w-4 h-4 shrink-0 transition-transform ${fabricDropdownOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {fabricDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setFabricDropdownOpen(false)}
                  />
                  <div className="absolute z-30 mt-2 w-full min-w-[16rem] bg-white rounded-2xl border border-slate-200 shadow-xl p-2 space-y-1 max-h-80 overflow-y-auto">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFabricId('all');
                        setFabricSubView('inventory');
                        setFabricDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs font-bold text-right transition cursor-pointer ${
                        currentFabricId === 'all' && fabricSubView === 'inventory'
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <span>كل الأقمشة</span>
                      <span
                        className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                          currentFabricId === 'all' && fabricSubView === 'inventory'
                            ? 'bg-white/15 text-white'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {fabricColors.length}
                      </span>
                    </button>

                    {fabrics.map((f) => {
                const isSelected = currentFabricId === f.id && fabricSubView === 'inventory';
                const lowColorsInFabric = fabricColors.filter(
                  (c) => c.fabric_id === f.id && c.quantity - c.reserved_quantity < minThreshold
                ).length;

                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setSelectedFabricId(f.id);
                      setFabricSubView('inventory');
                      setFabricDropdownOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs font-bold text-right transition cursor-pointer ${
                      isSelected ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {lowColorsInFabric > 0 && (
                        <span
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            isSelected ? 'bg-amber-300 ring-2 ring-blue-700' : 'bg-amber-500 ring-1 ring-amber-200'
                          }`}
                          title="توجد ألوان منخفضة المخزون بهذه الخامة"
                        />
                      )}
                      <span className="truncate">{f.name}</span>
                    </span>
                    {lowColorsInFabric > 0 && (
                      <span
                        className={`px-1.5 py-0.2 rounded-full text-[10px] font-black shrink-0 ${
                          isSelected ? 'bg-white/15 text-amber-200' : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {lowColorsInFabric}
                      </span>
                    )}
                  </button>
                );
              })}
                  </div>
                </>
              )}
            </div>

            {/* Section Tabs / Action Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Dedicated Fabric Alerts Page Button */}
              <button
                type="button"
                onClick={() =>
                  setFabricSubView(fabricSubView === 'alerts' ? 'inventory' : 'alerts')
                }
                className={`flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-bold transition shadow-xs cursor-pointer ${
                  fabricSubView === 'alerts'
                    ? 'bg-amber-500 text-slate-950 border-amber-600 shadow-amber-500/20'
                    : 'bg-amber-50 text-amber-950 border-amber-300 hover:bg-amber-100'
                }`}
                title="فتح صفحة التنبيهات الخاصة بالقماش"
              >
                <BellRing
                  className={`w-4 h-4 ${
                    lowStockColors.length > 0 ? 'text-amber-700 animate-bounce' : 'text-amber-600'
                  }`}
                />
                <span>صفحة التنبيهات الخاصة بالقماش</span>
                <span className="px-1.5 py-0.2 rounded-full bg-slate-950 text-amber-400 font-black text-[10px]">
                  {lowStockColors.length}
                </span>
              </button>

              {/* Comprehensive Fabric Audit Page Button (جرد القماش والاستهلاك) */}
              <button
                type="button"
                onClick={() => setFabricSubView(fabricSubView === 'audit' ? 'inventory' : 'audit')}
                className={`flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-bold transition shadow-xs cursor-pointer ${
                  fabricSubView === 'audit'
                    ? 'bg-indigo-600 text-white border-indigo-700 shadow-indigo-500/20'
                    : 'bg-indigo-50 text-indigo-900 border-indigo-300 hover:bg-indigo-100'
                }`}
                title="جرد شامل: إجمالي الوارد مقابل المستهلك والمتبقي + توزيع الاستهلاك"
              >
                <ClipboardList className="w-4 h-4" />
                <span>📋 جرد القماش والاستهلاك</span>
              </button>

              <button
                type="button"
                onClick={() => setShowHistoryModal(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 text-xs font-bold transition shadow-xs cursor-pointer"
                title="سجل الحركات"
              >
                <History className="w-4 h-4 text-slate-600" />
                <span>سجل الحركات</span>
              </button>

              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setAddForm((prev) => ({ ...prev, fabricId: selectedFabric?.id || '' }));
                    setShowAddModal(true);
                  }}
                  className="flex items-center gap-2 px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-md shadow-blue-500/20 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>+ استلام قماش</span>
                </button>
              )}
            </div>

            {/* Export & Print Action Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={exportWarehouseInventoryCsv}
                className="flex items-center gap-2 px-5 py-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-md shadow-emerald-500/20 cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>📊 تصدير Excel (الجرد)</span>
              </button>

              <button
                type="button"
                onClick={exportFabricTransactionsCsv}
                className="flex items-center gap-2 px-5 py-2 rounded-full bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition shadow-md shadow-teal-500/20 cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>📊 تصدير Excel (الحركات)</span>
              </button>

              <button
                type="button"
                onClick={() => setShowPrintInventoryModal(true)}
                className="flex items-center gap-2 px-5 py-2 rounded-full bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition shadow-md shadow-slate-900/20 cursor-pointer"
                title="طباعة كشف جرد مفصل لمخزن القماش"
              >
                <Printer className="w-4 h-4" />
                <span>🖨️ طباعة تقرير جرد المخزن</span>
              </button>
            </div>
          </div>

          {/* SUB-VIEW 1: DEDICATED FABRIC ALERTS PAGE (صفحة التنبيهات الخاصة بالقماش - Task 1.2) */}
          {fabricSubView === 'alerts' && (
            <div className="bg-gradient-to-b from-amber-50 via-white to-amber-50/40 rounded-3xl p-6 border-2 border-amber-300 shadow-sm space-y-6 animate-in fade-in duration-150">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-amber-200 pb-5">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold shadow-xs shrink-0">
                    <BellRing className="w-6 h-6 animate-bounce" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h2 className="text-xl font-black text-slate-900">
                        صفحة التنبيهات الخاصة بالقماش
                      </h2>
                      <span className="px-3 py-0.5 rounded-full bg-amber-500 text-slate-950 font-black text-xs">
                        {lowStockColors.length} أقمشة أقل من ({minThreshold})
                      </span>
                    </div>
                    <p className="text-xs sm:text-sm text-slate-600 mt-1">
                      اكتب الرقم المطلوب في حقل الإدخال واضغط تأكيد لعرض كل الأقمشة التي تقل كميتها المتاحة عن هذا الرقم.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setFabricSubView('inventory')}
                  className="px-5 py-2.5 rounded-full bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition cursor-pointer self-start md:self-auto"
                >
                  ← العودة لعرض بطاقات المخزن
                </button>
              </div>

              {/* Single Input Field for Alert Quantity Threshold + Confirm Button */}
              <form
                onSubmit={handleConfirmAlertThreshold}
                className="bg-amber-100/80 p-5 rounded-2xl border border-amber-300 flex flex-col sm:flex-row items-stretch sm:items-end justify-between gap-4"
              >
                <div className="flex-1 max-w-md">
                  <label className="block text-xs font-black text-amber-950 mb-1.5 flex items-center gap-1.5">
                    <SlidersHorizontal className="w-4 h-4 text-amber-700" />
                    <span>حد التنبيه للكمية المتاحة (اعرض الأقمشة التي تقل كميتها عن):</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={thresholdInput}
                      onChange={(e) => setThresholdInput(e.target.value)}
                      placeholder="اكتب الرقم المطلوب (مثال: 20)..."
                      className="w-full px-4 py-2.5 rounded-xl border-2 border-amber-400 bg-white text-sm font-black text-slate-900 focus:ring-2 focus:ring-amber-600 focus:outline-hidden"
                    />
                    <button
                      type="submit"
                      className="px-6 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-white font-black text-xs transition shadow-sm shrink-0 cursor-pointer flex items-center gap-1.5"
                    >
                      <Check className="w-4 h-4 text-amber-400" />
                      <span>تأكيد الرقم</span>
                    </button>
                  </div>
                </div>

                <div className="text-xs font-bold text-amber-950 bg-white/90 px-4 py-3 rounded-xl border border-amber-200 flex items-center gap-3">
                  <div>
                    <span className="text-slate-500 block text-[10px]">الرقم المؤكد حالياً</span>
                    <strong className="text-base font-black text-amber-900">أقل من {minThreshold} وحدة</strong>
                  </div>
                  <div className="border-s border-amber-200 ps-3">
                    <span className="text-slate-500 block text-[10px]">الأقمشة المطابقة</span>
                    <strong className="text-base font-black text-rose-700">{lowStockColors.length} صنف / لون</strong>
                  </div>
                </div>
              </form>

              {/* Alert Fabrics Grid */}
              {lowStockColors.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {lowStockColors.map((item) => (
                    <div
                      key={item.id}
                      className="bg-white p-4 rounded-2xl border-2 border-amber-200 hover:border-amber-400 shadow-xs transition flex flex-col justify-between gap-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div
                          onClick={() => {
                            setSelectedFabricId(item.fabric_id);
                            setFabricSubView('inventory');
                          }}
                          className="flex items-center gap-3 cursor-pointer group"
                          title="فتح هذه الخامة في المخزن"
                        >
                          <div
                            className="w-10 h-10 rounded-xl border border-slate-300 shrink-0 shadow-2xs group-hover:scale-105 transition-transform"
                            style={{ backgroundColor: item.hex_code }}
                          />
                          <div>
                            <h4 className="font-black text-sm text-slate-900 group-hover:text-blue-600 transition">
                              {item.fabricName} - {item.color_code}
                            </h4>
                            <span className="text-xs text-slate-500 block">
                              {item.color_name || 'بدون اسم لون'} • <span className="font-mono">{item.hex_code}</span>
                            </span>
                          </div>
                        </div>

                        <span className="px-2.5 py-1 rounded-full bg-rose-100 text-rose-800 font-black text-xs shrink-0">
                          متاح: {item.available} {item.unit}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-xs">
                        <div>
                          <span className="text-slate-400 block text-[10px]">المخزون الفعلي الكلي</span>
                          <strong className="text-slate-800 font-black">{item.quantity} {item.unit}</strong>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">المحجوز للتصميم</span>
                          <strong className="text-amber-700 font-black">{item.reserved_quantity} {item.unit}</strong>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                        {item.supplier ? (
                          <a
                            href={`tel:${item.supplier.phone}`}
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline font-bold truncate"
                          >
                            <Phone className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                            <span className="truncate">{item.supplier.name}</span>
                          </a>
                        ) : (
                          <span className="text-xs text-slate-400">مورد غير محدد</span>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            handleOpenReorder({
                              color: item,
                              fabric: item.fabric,
                              supplier: item.supplier,
                              available: item.available
                            })
                          }
                          className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-2xs transition shrink-0 cursor-pointer"
                        >
                          <ShoppingCart className="w-3.5 h-3.5" />
                          <span>إعادة طلب توريد</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 rounded-2xl bg-white border border-emerald-200 text-center space-y-2">
                  <Check className="w-10 h-10 text-emerald-600 mx-auto" />
                  <p className="text-base font-black text-emerald-900">
                    لا توجد أي أقمشة تقل كميتها المتاحة عن ({minThreshold})!
                  </p>
                  <p className="text-xs text-slate-500">
                    جميع الأقمشة والألوان في المخزن كمياتها المتاحة أكبر من أو تساوي {minThreshold}.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* SUB-VIEW 3: COMPREHENSIVE FABRIC AUDIT (جرد القماش والاستهلاك) */}
          {fabricSubView === 'audit' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              {/* Audit Header + Warehouse Totals */}
              <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 text-white rounded-3xl p-6 shadow-lg">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/15 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
                      <ClipboardList className="w-6 h-6" />
                    </div>
                    <div>
                      <h2 className="text-lg sm:text-xl font-black">جرد القماش والاستهلاك</h2>
                      <p className="text-xs text-slate-300 mt-0.5 max-w-2xl">
                        مقارنة إجمالي الوارد بالمستهلك الفعلي والمتبقي، مع توزيع الاستهلاك حسب فئة المقاس ونوع
                        الموديل وأكواد الموديلات المستخدمة في كل لون.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPrintInventoryModal(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-full bg-white text-slate-900 hover:bg-slate-100 text-xs font-black transition shadow-sm cursor-pointer shrink-0"
                  >
                    <Printer className="w-4 h-4" />
                    <span>🖨️ طباعة تقرير الجرد</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-4">
                  {[
                    { label: 'إجمالي الوارد', value: auditTotals.totalReceived, cls: 'text-emerald-300' },
                    { label: 'إجمالي المستهلك', value: auditTotals.totalConsumed, cls: 'text-rose-300' },
                    { label: 'عيوب القماش', value: auditTotals.totalDefect, cls: 'text-amber-300' },
                    { label: 'المتبقي بالمخزن', value: auditTotals.totalRemaining, cls: 'text-sky-300' },
                    { label: 'المتاح للتصميم', value: auditTotals.totalAvailable, cls: 'text-violet-300' }
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="bg-white/10 border border-white/15 rounded-2xl px-3.5 py-2.5 backdrop-blur-xs"
                    >
                      <span className="block text-[10px] font-bold text-slate-300">{item.label}</span>
                      <strong className={`text-xl font-black font-mono ${item.cls}`}>{item.value}</strong>
                      <span className="text-[10px] font-bold text-slate-300 ms-1">كجم / وحدة</span>
                    </div>
                  ))}
                </div>
              </div>

              {fabricAuditGroups.length === 0 ? (
                <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center text-slate-400">
                  <ClipboardList className="w-12 h-12 mx-auto mb-2 text-slate-300" />
                  <p className="font-semibold text-slate-600">لا توجد ألوان مسجلة بالمخزن لعرض الجرد.</p>
                </div>
              ) : (
                fabricAuditGroups.map((group) => {
                  const groupReceived = roundQty(
                    group.rows.reduce((sum, row) => sum + row.totalReceived, 0)
                  );
                  const groupConsumed = roundQty(
                    group.rows.reduce((sum, row) => sum + row.totalConsumed, 0)
                  );
                  const groupRemaining = roundQty(
                    group.rows.reduce((sum, row) => sum + row.remaining, 0)
                  );

                  return (
                    <div
                      key={group.fabric.id}
                      className="bg-white rounded-3xl border border-slate-200/90 shadow-xs overflow-hidden"
                    >
                      {/* رأس مجموعة الخامة: الإجماليات وعدد الألوان */}
                      <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <Layers className="w-4 h-4 text-indigo-600 shrink-0" />
                          <h3 className="font-black text-sm text-slate-900">{group.fabric.name}</h3>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600">
                            {group.rows.length} لون • الوحدة: {group.fabric.unit}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-[11px] font-black">
                          <span className="text-emerald-700">وارد: {groupReceived}</span>
                          <span className="text-rose-700">مستهلك: {groupConsumed}</span>
                          <span className="text-blue-700">متبقي: {groupRemaining}</span>
                        </div>
                      </div>

                      <div className="divide-y divide-slate-100">
                        {group.rows.map((row) => (
                          <div key={row.colorId} className="p-4 sm:p-5 space-y-3">
                            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span
                                  className="w-9 h-9 rounded-xl border border-slate-300 shrink-0 shadow-2xs"
                                  style={{ backgroundColor: row.hexCode }}
                                  title={row.hexCode}
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <strong className="text-sm font-black text-slate-900">
                                      {row.colorCode}
                                    </strong>
                                    {row.colorName && (
                                      <span className="text-[11px] text-slate-500">({row.colorName})</span>
                                    )}
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-100">
                                      <Tag className="w-3 h-3" />
                                      {row.supplierName}
                                    </span>
                                  </div>
                                  <span className="block text-[10px] font-mono text-slate-400 mt-0.5">
                                    {row.hexCode}
                                  </span>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                                <AuditStatCard
                                  label="إجمالي الوارد"
                                  value={row.totalReceived}
                                  unit={group.fabric.unit}
                                  tone="emerald"
                                />
                                <AuditStatCard
                                  label="إجمالي المستهلك"
                                  value={row.totalConsumed}
                                  unit={group.fabric.unit}
                                  tone="rose"
                                />
                                <AuditStatCard
                                  label="عيوب القماش"
                                  value={row.totalDefect}
                                  unit={group.fabric.unit}
                                  tone="amber"
                                />
                                <AuditStatCard
                                  label="المتبقي الفعلي"
                                  value={row.remaining}
                                  unit={group.fabric.unit}
                                  tone="sky"
                                />
                                <AuditStatCard
                                  label="المتاح بعد الحجز"
                                  value={row.available}
                                  unit={group.fabric.unit}
                                  tone="slate"
                                />
                              </div>
                            </div>

                            {/* Consumption Breakdown */}
                            {row.totalConsumed > 0 ? (
                              <div className="space-y-2.5 bg-slate-50/70 border border-slate-100 rounded-2xl p-3">
                                <AuditBreakdownChips
                                  label="توزيع الاستهلاك حسب فئة المقاس"
                                  icon={<Ruler className="w-3.5 h-3.5 text-blue-600" />}
                                  items={row.sizeBreakdown}
                                  unit={group.fabric.unit}
                                  tone="blue"
                                />
                                <AuditBreakdownChips
                                  label="توزيع الاستهلاك حسب نوع الموديل"
                                  icon={<Shirt className="w-3.5 h-3.5 text-violet-600" />}
                                  items={row.typeBreakdown}
                                  unit={group.fabric.unit}
                                  tone="violet"
                                />
                                <div className="space-y-1.5">
                                  <span className="text-[11px] font-black text-slate-500 flex items-center gap-1.5">
                                    <Scissors className="w-3.5 h-3.5 text-slate-500" />
                                    أكواد الموديلات المرتبطة بهذا اللون
                                  </span>
                                  {row.modelCodes.length > 0 ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      {row.modelCodes.map((code) => (
                                        <span
                                          key={`${row.colorId}-${code}`}
                                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white border border-slate-200 text-[11px] font-bold text-slate-700 font-mono"
                                        >
                                          <Boxes className="w-3 h-3 text-slate-400" />
                                          {code}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-[11px] text-slate-400 font-semibold">
                                      لا توجد أكواد موديلات مرتبطة
                                    </span>
                                  )}
                                </div>
                                {row.unlinkedConsumed > 0 && (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-[11px] font-bold text-amber-900">
                                    <AlertTriangle className="w-3 h-3" />
                                    استهلاك غير مرتبط بموديل: {row.unlinkedConsumed} {group.fabric.unit}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
                                <Scissors className="w-3.5 h-3.5" />
                                لا يوجد استهلاك مسجل على هذا اللون حتى الآن
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* SUB-VIEW 2: MAIN FABRIC INVENTORY & ADVANCED FILTERS */}
          {fabricSubView === 'inventory' && (
            <>
              {/* Advanced Search & Filters Bar (Task 1.1) */}
              <div className="bg-white rounded-3xl p-5 border border-slate-200/90 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
                      <Filter className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-extrabold text-sm text-slate-900">
                        فلاتر البحث المتقدمة في مخزن القماش
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        ابحث باللون (اسم اللون، كود اللون، أو Hex Code) أو باسم الخامة أو اسم المورد، وفلتر حسب المورد أو حسب الكمية المتاحة
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-wrap">
                    <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                      <input
                        type="checkbox"
                        checked={searchAllFabrics || currentFabricId === 'all'}
                        disabled={currentFabricId === 'all'}
                        onChange={(e) => setSearchAllFabrics(e.target.checked)}
                        className="rounded text-blue-600 focus:ring-blue-500"
                      />
                      <span>البحث في جميع الخامات</span>
                    </label>

                    {hasActiveAdvancedFilters && (
                      <button
                        type="button"
                        onClick={handleClearAdvancedFilters}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold transition cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>إلغاء الفلاتر</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* Filter 1: Search by Color Name, Color Code, or Hex Code (now the widest, most prominent bar) */}
                  <div className="lg:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
                      <Palette className="w-3.5 h-3.5 text-blue-600" />
                      <span>فلتر البحث باللون (اسم اللون / كود اللون / Hex Code / اسم الخامة / اسم المورد):</span>
                    </label>
                    <div className="relative flex items-center gap-2">
                      <div className="relative flex-grow">
                        <input
                          type="text"
                          value={colorSearchFilter}
                          onChange={(e) => setColorSearchFilter(e.target.value)}
                          placeholder="اكتب اسم اللون (مثال: أسود، كحلي) أو الكود (C-101) أو Hex (#3b82f6) أو اسم المورد..."
                          className="w-full ps-11 pe-9 py-3 rounded-2xl border-2 border-slate-200 bg-white text-sm font-semibold text-slate-800 shadow-xs placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/40 focus:outline-hidden"
                        />
                        <Search className="w-5 h-5 text-blue-500 absolute start-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        {colorSearchFilter && (
                          <button
                            type="button"
                            onClick={() => setColorSearchFilter('')}
                            className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      <input
                        type="color"
                        value={
                          /^#[0-9A-Fa-f]{6}$/.test(colorSearchFilter.trim())
                            ? colorSearchFilter.trim()
                            : '#3b82f6'
                        }
                        onChange={(e) => setColorSearchFilter(e.target.value)}
                        title="اختر درجة اللون للبحث بـ Hex Code"
                        className="w-12 h-12 p-1 rounded-2xl border-2 border-slate-200 bg-white cursor-pointer shrink-0 shadow-xs"
                      />
                    </div>
                  </div>

                  {/* Filter 2: Available Quantity Less Than User-Specified Number */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-amber-600" />
                      <span>فلتر الأقمشة التي كميتها المتاحة أقل من رقم محدد:</span>
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={maxAvailableQtyFilter}
                        onChange={(e) => setMaxAvailableQtyFilter(e.target.value)}
                        placeholder="مثال: 50"
                        className="w-full px-4 py-3 rounded-2xl border-2 border-slate-200 bg-white text-sm font-bold text-slate-800 shadow-xs placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-500/40 focus:outline-hidden pe-10"
                      />
                      {maxAvailableQtyFilter && (
                        <button
                          type="button"
                          onClick={() => setMaxAvailableQtyFilter('')}
                          className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Filter 3: Supplier (المورد) */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5 text-indigo-600" />
                      <span>فلتر حسب المورد:</span>
                    </label>
                    <div className="relative">
                      <select
                        value={supplierFilter}
                        onChange={(e) => setSupplierFilter(e.target.value)}
                        className="w-full appearance-none px-4 py-3 rounded-2xl border-2 border-slate-200 bg-white text-sm font-bold text-slate-800 shadow-xs focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40 focus:outline-hidden pe-10 cursor-pointer"
                      >
                        <option value="">كل الموردين</option>
                        {suppliers.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="w-4 h-4 text-slate-400 absolute end-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>
                </div>

                {hasActiveAdvancedFilters && (
                  <div className="flex items-center justify-between bg-blue-50/80 border border-blue-200 px-4 py-2 rounded-xl text-xs font-bold text-blue-900 gap-3 flex-wrap">
                    <span>
                      نتائج الفلترة الحالية: تم العثور على ({filteredColorsForDisplay.length}) لون/قماش مطابق
                    </span>
                    <span className="flex items-center gap-3 text-[11px] text-blue-700">
                      {selectedSupplierOption && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border border-indigo-200 text-indigo-800">
                          <Tag className="w-3 h-3" />
                          المورد: {selectedSupplierOption.name}
                        </span>
                      )}
                      <span>
                        {currentFabricId === 'all' || searchAllFabrics
                          ? 'نطاق البحث: جميع الخامات بالمخزن'
                          : `نطاق البحث: خامة ${selectedFabric?.name || ''}`}
                      </span>
                    </span>
                  </div>
                )}
              </div>

              {/* Main Content Layout */}
              <div className="flex flex-col lg:flex-row gap-6 items-start">
                {/* Main Warehouse Area */}
                <div className="flex-1 min-w-0 space-y-6 w-full">
                  {/* Selected Fabric Header Card */}
                  {currentFabricId === 'all' || (hasActiveAdvancedFilters && searchAllFabrics) ? (
                    <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-3">
                          <h2 className="text-xl font-black text-slate-900 tracking-tight">
                            عرض شامل لألوان الأقمشة بالمخزن
                          </h2>
                          <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
                            {fabrics.length} خامات
                          </span>
                        </div>
                        <p className="text-slate-500 text-xs sm:text-sm mt-1">
                          يتم عرض الألوان عبر كافة خامات المصنع {hasActiveAdvancedFilters ? 'حسب فلاتر البحث المحددة' : ''}
                        </p>
                      </div>

                      <div className="flex items-center gap-4 text-xs font-bold text-slate-600 bg-slate-50 px-4 py-2.5 rounded-2xl border border-slate-200">
                        <div>
                          <span className="text-slate-400 block text-[10px]">الألوان المعروضة</span>
                          <span className="text-base text-slate-900 font-extrabold">
                            {filteredColorsForDisplay.length}
                          </span>
                        </div>
                        <div className="border-s border-slate-200 ps-4">
                          <span className="text-slate-400 block text-[10px]">إجمالي الرصيد الفعلي</span>
                          <span className="text-base text-blue-600 font-extrabold">
                            {filteredColorsForDisplay.reduce((sum, c) => sum + c.quantity, 0).toFixed(1)}
                          </span>
                        </div>
                        <div className="border-s border-slate-200 ps-4">
                          <span className="text-slate-400 block text-[10px]">المحجوز للتصميم</span>
                          <span className="text-base text-amber-600 font-extrabold">
                            {filteredColorsForDisplay.reduce((sum, c) => sum + c.reserved_quantity, 0).toFixed(1)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : selectedFabric ? (
                    <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-3">
                          <h2 className="text-xl font-black text-slate-900 tracking-tight">{selectedFabric.name}</h2>
                          <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                            الوحدة: {selectedFabric.unit}
                          </span>
                        </div>
                        {selectedFabric.description && (
                          <p className="text-slate-500 text-sm mt-1">{selectedFabric.description}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-4 text-xs font-bold text-slate-600 bg-slate-50 px-4 py-2.5 rounded-2xl border border-slate-200">
                        <div>
                          <span className="text-slate-400 block text-[10px]">عدد الألوان المسجلة</span>
                          <span className="text-base text-slate-900 font-extrabold">{colorsForSelected.length}</span>
                        </div>
                        <div className="border-s border-slate-200 ps-4">
                          <span className="text-slate-400 block text-[10px]">إجمالي الرصيد الفعلي</span>
                          <span className="text-base text-blue-600 font-extrabold">
                            {colorsForSelected.reduce((sum, c) => sum + c.quantity, 0).toFixed(1)}{' '}
                            {selectedFabric.unit}
                          </span>
                        </div>
                        <div className="border-s border-slate-200 ps-4">
                          <span className="text-slate-400 block text-[10px]">المحجوز للتصميم</span>
                          <span className="text-base text-amber-600 font-extrabold">
                            {colorsForSelected.reduce((sum, c) => sum + c.reserved_quantity, 0).toFixed(1)}{' '}
                            {selectedFabric.unit}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white rounded-3xl p-8 text-center text-slate-500 border border-slate-200">
                      لم يتم تسجيل أي خامات بالمخزن بعد.
                    </div>
                  )}

                  {/* Fabric Colors Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                    {filteredColorsForDisplay.length > 0 ? (
                      filteredColorsForDisplay.map((color) => {
                        const colorFabric =
                          fabrics.find((f) => f.id === color.fabric_id) ||
                          selectedFabric ||
                          ({ id: color.fabric_id, name: 'خامة', unit: 'كيلو' } as Fabric);
                        const availableQty = Number((color.quantity - color.reserved_quantity).toFixed(2));
                        const isLow = availableQty < minThreshold;
                        const resolvedSupplier = resolveColorSupplier(color);
                        const currentSupplier =
                          suppliers.find(
                            (s) =>
                              (Boolean(resolvedSupplier?.id) && s.id === resolvedSupplier?.id) ||
                              (Boolean(resolvedSupplier?.name) &&
                                s.name.trim().toLowerCase() ===
                                  (resolvedSupplier?.name || '').trim().toLowerCase())
                          ) || undefined;

                        return (
                          <div
                            key={color.id}
                            className={`rounded-3xl transition overflow-hidden text-center flex flex-col justify-between relative ${
                              isLow
                                ? 'bg-white border-2 border-amber-300 border-s-8 border-s-amber-500 shadow-md hover:shadow-lg ring-2 ring-amber-400/20'
                                : 'bg-white border border-slate-200/80 shadow-xs hover:shadow-md'
                            }`}
                          >
                            {/* Visual Warning Banner on Card Top */}
                            {isLow && (
                              <div className="bg-amber-400 text-slate-950 font-extrabold px-3 py-1.5 text-xs flex items-center justify-between shadow-2xs">
                                <span className="flex items-center gap-1.5">
                                  <AlertTriangle className="w-4 h-4 text-slate-950 shrink-0" />
                                  <span>تحذير: رصيد منخفض ({availableQty} {colorFabric?.unit})</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleOpenReorder({
                                      color,
                                      fabric: colorFabric,
                                      supplier: currentSupplier,
                                      available: availableQty
                                    })
                                  }
                                  className="bg-slate-950 hover:bg-slate-800 text-white text-[10px] font-black px-2 py-0.5 rounded-full transition cursor-pointer"
                                >
                                  طلب
                                </button>
                              </div>
                            )}

                            {/* Color Swatch Header */}
                            <div
                              className="h-28 w-full border-b border-slate-100 flex items-center justify-center relative shadow-inner"
                              style={{ backgroundColor: color.hex_code || '#f1f5f9' }}
                            >
                              <span className="bg-black/40 backdrop-blur-xs text-white text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full">
                                {color.hex_code || '#N/A'}
                              </span>
                              {(currentFabricId === 'all' || (hasActiveAdvancedFilters && searchAllFabrics)) && (
                                <span className="absolute top-2.5 start-2.5 bg-white/90 text-slate-900 text-[10px] font-black px-2.5 py-0.5 rounded-full shadow-2xs">
                                  {colorFabric?.name}
                                </span>
                              )}
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditColor(color)}
                                  className="absolute top-2 end-2 w-8 h-8 rounded-full bg-white/90 hover:bg-white text-slate-800 shadow-sm flex items-center justify-center transition cursor-pointer"
                                  title="تعديل بيانات اللون (الكود / الاسم / الدرجة / السعر)"
                                  aria-label={`تعديل بيانات اللون ${color.color_code}`}
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                              )}
                            </div>

                            {/* Card Body */}
                            <div className="p-5 flex flex-col justify-between flex-grow">
                              <div>
                                <h4 className="font-extrabold text-lg text-slate-900 mb-1 flex items-center justify-center gap-2">
                                  <span>{color.color_code}</span>
                                  {color.color_name && (
                                    <span className="text-xs font-semibold text-slate-500">
                                      ({color.color_name})
                                    </span>
                                  )}
                                </h4>

                                {/* Total Quantity */}
                                <div className="my-2">
                                  <span className="text-3xl font-black text-blue-600 tracking-tight">
                                    {color.quantity}
                                  </span>
                                  <span className="text-xs text-slate-500 ms-1 font-bold">
                                    {colorFabric?.unit || 'كيلو'} (فعلي كلي)
                                  </span>
                                </div>

                                {/* Available for design badge */}
                                <div className="mb-4">
                                  <span
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-extrabold border ${
                                      isLow
                                        ? 'bg-amber-100 text-amber-950 border-amber-300 font-black'
                                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    }`}
                                  >
                                    {isLow && <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />}
                                    <span>
                                      متاح للتصميم: {availableQty} {colorFabric?.unit || 'كيلو'}
                                    </span>
                                  </span>
                                  {color.reserved_quantity > 0 && (
                                    <span className="block text-[11px] text-amber-600 mt-1 font-medium">
                                      (محجوز لموديلات بالتصميم: {color.reserved_quantity} {colorFabric?.unit})
                                    </span>
                                  )}
                                </div>

                                {/* Supplier Badge (المورد المرتبط بالخامة/حركة التوريد) */}
                                <div className="mb-3 flex items-center justify-center gap-1.5 text-[11px] font-bold text-slate-600 bg-indigo-50/60 py-1.5 px-3 rounded-xl border border-indigo-100">
                                  <Tag className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                                  <span className="truncate">
                                    المورد:{' '}
                                    <strong className={resolvedSupplier?.name ? 'text-indigo-900' : 'text-slate-400'}>
                                      {resolvedSupplier?.name || 'غير محدد'}
                                    </strong>
                                  </span>
                                </div>

                                {/* Price per unit - Restricted by Permission */}
                                {canViewFabricPrices() && (
                                  <div className="mb-4 flex items-center justify-center gap-1.5 text-xs text-slate-500 font-semibold bg-slate-50 py-1.5 px-3 rounded-xl border border-slate-200">
                                    <Coins className="w-3.5 h-3.5 text-amber-600" />
                                    <span>
                                      السعر:{' '}
                                      <strong className="text-slate-800">{color.price_per_unit || 0}</strong>{' '}
                                      ج.م / {colorFabric?.unit}
                                    </span>
                                    {canEditFabricPrices() && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const p = prompt(
                                            `أدخل سعر الوحدة (ج.م) للون ${color.color_code}:`,
                                            (color.price_per_unit || 0).toString()
                                          );
                                          if (p !== null) {
                                            updateColorPrice(color.id, parseFloat(p) || 0);
                                          }
                                        }}
                                        className="text-[10px] text-blue-600 hover:underline ms-1 font-bold cursor-pointer"
                                      >
                                        تعديل
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* Action Buttons Row with Reorder Button */}
                              {isLow ? (
                                <div className="flex items-center gap-2 mt-2">
                                  {canEdit && (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenTransaction(color.id)}
                                      className="flex-1 py-2 px-3 rounded-full border border-slate-300 text-slate-800 hover:bg-slate-100 font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                                    >
                                      <ArrowUpDown className="w-3.5 h-3.5" />
                                      <span>صرف / إضافة</span>
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleOpenReorder({
                                        color,
                                        fabric: colorFabric,
                                        supplier: currentSupplier,
                                        available: availableQty
                                      })
                                    }
                                    className="flex-1 py-2 px-3 rounded-full bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-slate-950 font-black text-xs transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                                    title="إعادة طلب توريد عاجل"
                                  >
                                    <ShoppingCart className="w-3.5 h-3.5" />
                                    <span>إعادة طلب</span>
                                  </button>
                                </div>
                              ) : (
                                canEdit && (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenTransaction(color.id)}
                                    className="w-full py-2.5 px-4 rounded-full border border-slate-300 text-slate-800 hover:bg-slate-900 hover:text-white font-bold text-xs transition shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                                  >
                                    <ArrowUpDown className="w-3.5 h-3.5" />
                                    <span>صرف / إضافة</span>
                                  </button>
                                )
                              )}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="col-span-full py-12 text-center bg-white rounded-3xl border border-slate-200/80 p-6 text-slate-400">
                        <Package className="w-12 h-12 mx-auto mb-2 text-slate-300" />
                        {hasActiveAdvancedFilters ? (
                          <>
                            <p className="font-semibold text-slate-600">
                              لا توجد أقمشة أو ألوان مطابقة لفلاتر البحث المحددة.
                            </p>
                            <button
                              type="button"
                              onClick={handleClearAdvancedFilters}
                              className="mt-3 px-4 py-2 rounded-full bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition cursor-pointer"
                            >
                              إعادة ضبط الفلاتر
                            </button>
                          </>
                        ) : (
                          <>
                            <p className="font-semibold text-slate-600">لا توجد ألوان مسجلة لهذه الخامة حالياً.</p>
                            <p className="text-xs text-slate-400 mt-1">
                              اضغط على زر "+ استلام قماش" لإضافة رولات وألوان جديدة.
                            </p>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </>
          )}

          {/* Modal 1: Add Fabric / Receive Fabric (addModal) */}
          {showAddModal && (
            <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <h3 className="font-extrabold text-lg text-slate-900">إضافة خامة / استلام قماش</h3>
                  <button
                    onClick={() => setShowAddModal(false)}
                    className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleAddSubmit} className="space-y-4 mt-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">الخامة</label>
                    <select
                      value={addForm.fabricId}
                      onChange={(e) => setAddForm({ ...addForm, fabricId: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                    >
                      <option value="">-- اختر خامة موجودة أو اتركها فارغة لكتابة اسم جديد --</option>
                      {fabrics.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name} ({f.unit})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">
                      أو اكتب اسم خامة جديدة (لو مش في القائمة)
                    </label>
                    <input
                      type="text"
                      value={addForm.newFabricName}
                      onChange={(e) => setAddForm({ ...addForm, newFabricName: e.target.value })}
                      placeholder="مثال: قطن تمشيط 100%"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">
                        الوحدة (للخامات الجديدة فقط)
                      </label>
                      <select
                        value={addForm.unit}
                        onChange={(e) =>
                          setAddForm({ ...addForm, unit: e.target.value as 'توب' | 'كيلو' | 'متر' })
                        }
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                      >
                        <option value="كيلو">كيلو</option>
                        <option value="متر">متر</option>
                        <option value="توب">توب</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">المورد</label>
                      <select
                        value={addForm.supplierId}
                        onChange={(e) => setAddForm({ ...addForm, supplierId: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                      >
                        <option value="">-- اختر المورد (اختياري) --</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <hr className="border-slate-100" />

                  <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-5">
                      <label className="block text-xs font-bold text-slate-600 mb-1">كود اللون *</label>
                      <input
                        type="text"
                        required
                        value={addForm.colorCode}
                        onChange={(e) => setAddForm({ ...addForm, colorCode: e.target.value })}
                        placeholder="مثال: C-101"
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                      />
                    </div>
                    <div className="col-span-5">
                      <label className="block text-xs font-bold text-slate-600 mb-1">اسم اللون</label>
                      <input
                        type="text"
                        value={addForm.colorName}
                        onChange={(e) => setAddForm({ ...addForm, colorName: e.target.value })}
                        placeholder="مثال: أسود كربوني"
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-bold text-slate-600 mb-1">اللون</label>
                      <input
                        type="color"
                        value={addForm.hexCode}
                        onChange={(e) => setAddForm({ ...addForm, hexCode: e.target.value })}
                        className="w-full h-10 p-1 rounded-xl border border-slate-300 cursor-pointer"
                        title="اختر درجة اللون"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">
                      الكمية المستلمة *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.1"
                      required
                      value={addForm.quantity}
                      onChange={(e) => setAddForm({ ...addForm, quantity: parseFloat(e.target.value) || 0 })}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                      placeholder="الكمية المستلمة"
                    />
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      className="w-full py-3 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm transition shadow-lg shadow-blue-500/20"
                    >
                      حفظ الاستلام
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Modal 2: Stock Deduct / Add (transactionModal) */}
          {showTransactionModal && activeColor && (
            <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <h3 className="font-extrabold text-base text-slate-900">
                    تحديث الكمية للون:{' '}
                    <span className="text-blue-600">{activeColor.color_code}</span>
                    {activeColor.color_name && <small className="text-slate-400 ms-1">({activeColor.color_name})</small>}
                  </h3>
                  <button
                    onClick={() => setShowTransactionModal(false)}
                    className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleTransSubmit} className="space-y-4 mt-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">نوع الحركة</label>
                    <select
                      value={transForm.operation}
                      onChange={(e) =>
                        setTransForm({ ...transForm, operation: e.target.value as 'add' | 'deduct' })
                      }
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                    >
                      <option value="deduct">صرف للمقص / استعواض (-)</option>
                      <option value="add">إضافة / مرتجع (+)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">
                      كود الموديل (رايح / جاي لمين؟)
                    </label>
                    <input
                      type="text"
                      value={transForm.modelCodeRef}
                      onChange={(e) => setTransForm({ ...transForm, modelCodeRef: e.target.value })}
                      placeholder="مثال: M-101 أو إذن صيانة"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">
                      الكمية ({selectedFabric?.unit || 'كيلو'})
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={transForm.amount}
                      onChange={(e) => setTransForm({ ...transForm, amount: parseFloat(e.target.value) || 0 })}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                      placeholder="أدخل الكمية"
                    />
                    {transForm.operation === 'deduct' && (
                      <span className="text-[11px] text-slate-500 mt-1 block">
                        الرصيد الفعلي الحالي بالمخزن: {activeColor.quantity} {selectedFabric?.unit}
                      </span>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">
                      ملاحظات أو سبب الحركة
                    </label>
                    <textarea
                      rows={2}
                      value={transForm.notes}
                      onChange={(e) => setTransForm({ ...transForm, notes: e.target.value })}
                      placeholder="اكتب أسباب الصرف أو المرتجع..."
                      className="w-full px-4 py-2 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                    ></textarea>
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      className="w-full py-3 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm transition shadow-lg shadow-blue-500/20"
                    >
                      تنفيذ الحركة
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Modal: Edit Fabric Color Details (تعديل كود/اسم/درجة/سعر اللون) */}
          {editingColor && (
            <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto">
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
                      <Pencil className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-extrabold text-base text-slate-900">تعديل بيانات اللون</h3>
                      <span className="block text-[11px] text-slate-500">
                        الخامة:{' '}
                        {fabrics.find((f) => f.id === editingColor.fabric_id)?.name || 'خامة غير محددة'}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingColor(null)}
                    className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
                    aria-label="إغلاق"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleEditColorSubmit} className="space-y-4 mt-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">كود اللون *</label>
                      <input
                        type="text"
                        required
                        value={editColorForm.color_code}
                        onChange={(e) =>
                          setEditColorForm({ ...editColorForm, color_code: e.target.value })
                        }
                        placeholder="مثال: C-101"
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-bold focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">اسم اللون</label>
                      <input
                        type="text"
                        value={editColorForm.color_name}
                        onChange={(e) =>
                          setEditColorForm({ ...editColorForm, color_name: e.target.value })
                        }
                        placeholder="مثال: كحلي"
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">
                      درجة اللون (Hex Code)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={
                          /^#[0-9A-Fa-f]{6}$/.test(editColorForm.hex_code)
                            ? editColorForm.hex_code
                            : '#64748b'
                        }
                        onChange={(e) =>
                          setEditColorForm({ ...editColorForm, hex_code: e.target.value })
                        }
                        title="اختر درجة اللون"
                        className="w-12 h-11 p-1 rounded-xl border border-slate-300 bg-white cursor-pointer shrink-0"
                      />
                      <input
                        type="text"
                        required
                        pattern="^#[0-9A-Fa-f]{6}$"
                        title="اكتب كود اللون بصيغة Hex مثل #3b82f6"
                        value={editColorForm.hex_code}
                        onChange={(e) =>
                          setEditColorForm({ ...editColorForm, hex_code: e.target.value })
                        }
                        placeholder="#3b82f6"
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-mono font-bold focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                      />
                    </div>
                    {/* معاينة حية للدرجة */}
                    <div className="mt-2 flex items-center gap-2">
                      <span
                        className="w-full h-9 rounded-xl border border-slate-300 shadow-inner"
                        style={{
                          backgroundColor: /^#[0-9A-Fa-f]{6}$/.test(editColorForm.hex_code)
                            ? editColorForm.hex_code
                            : '#e2e8f0'
                        }}
                      />
                      <span className="text-[11px] font-mono font-bold text-slate-500 shrink-0">
                        {/^#[0-9A-Fa-f]{6}$/.test(editColorForm.hex_code)
                          ? editColorForm.hex_code
                          : '#N/A'}
                      </span>
                    </div>
                  </div>

                  {/* السعر متاح فقط لمن يملك صلاحية تعديل أسعار الأقمشة */}
                  {canEditFabricPrices() && (
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">
                        سعر الوحدة (ج.م /{' '}
                        {fabrics.find((f) => f.id === editingColor.fabric_id)?.unit || 'كيلو'})
                      </label>
                      <div className="relative">
                        <Coins className="w-4 h-4 text-amber-600 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editColorForm.price_per_unit}
                          onChange={(e) =>
                            setEditColorForm({ ...editColorForm, price_per_unit: e.target.value })
                          }
                          className="w-full ps-10 pe-4 py-2.5 rounded-xl border border-slate-300 text-sm font-bold focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-2">
                    <button
                      type="submit"
                      className="flex-1 py-3 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm transition shadow-lg shadow-blue-500/20 cursor-pointer"
                    >
                      حفظ التعديلات
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingColor(null)}
                      className="px-5 py-3 rounded-full border border-slate-300 text-slate-700 hover:bg-slate-50 font-bold text-sm transition cursor-pointer"
                    >
                      إلغاء
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Modal 3: Transaction History Drawer */}
          {showHistoryModal && (
            <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl max-w-3xl w-full p-6 shadow-2xl border border-slate-100 max-h-[85vh] flex flex-col">
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <History className="w-5 h-5 text-blue-600" />
                    <h3 className="font-extrabold text-lg text-slate-900">سجل حركات المخزن (صرف وإضافة)</h3>
                  </div>
                  <button
                    onClick={() => setShowHistoryModal(false)}
                    className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="overflow-y-auto mt-4 flex-grow">
                  <table className="w-full text-xs text-start">
                    <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3">التاريخ والوقت</th>
                        <th className="px-4 py-3">النوع</th>
                        <th className="px-4 py-3">كود اللون</th>
                        <th className="px-4 py-3">الكمية</th>
                        <th className="px-4 py-3">المرجع</th>
                        <th className="px-4 py-3">ملاحظات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {fabricTransactions.length > 0 ? (
                        fabricTransactions.map((tr) => {
                          const color = fabricColors.find((c) => c.id === tr.color_id);
                          const isAdd = tr.operation === 'add';
                          const isDefect = tr.operation === 'defect';
                          const badgeClass = isDefect
                            ? 'bg-amber-100 text-amber-800'
                            : isAdd
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800';
                          const badgeLabel = isDefect
                            ? '⚠️ عيوب قماش'
                            : isAdd
                              ? '+ إضافة / مرتجع'
                              : '- صرف للمقص';

                          return (
                            <tr key={tr.id} className="hover:bg-slate-50 transition">
                              <td className="px-4 py-3 text-slate-500">{tr.timestamp}</td>
                              <td className="px-4 py-3">
                                <span className={`px-2.5 py-0.5 rounded-full font-bold ${badgeClass}`}>
                                  {badgeLabel}
                                </span>
                              </td>
                              <td className="px-4 py-3 font-bold text-slate-900">
                                {color?.color_code || 'غير معروف'}
                              </td>
                              <td className="px-4 py-3 font-extrabold text-slate-900">{tr.amount}</td>
                              <td className="px-4 py-3 font-semibold text-blue-700">
                                {tr.model_code_ref || '-'}
                              </td>
                              <td className="px-4 py-3 text-slate-500 max-w-xs truncate">
                                {tr.notes || '-'}
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={6} className="text-center py-8 text-slate-400">
                            لا توجد حركات مسجلة بالمخزن بعد.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="pt-4 border-t border-slate-100 mt-4 text-end">
                  <button
                    onClick={() => setShowHistoryModal(false)}
                    className="px-6 py-2 rounded-full bg-slate-900 text-white font-bold text-xs"
                  >
                    إغلاق السجل
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modal 4: Reorder Fabric Modal */}
          {reorderModalItem && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-amber-300 animate-in fade-in zoom-in-95 duration-150 space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold shadow-xs">
                      <ShoppingCart className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-extrabold text-base text-slate-900">إعادة طلب توريد قماش</h3>
                      <p className="text-xs text-slate-500">طلب دفعة جديدة لتغطية حد الأمان بالمخزن</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReorderModalItem(null)}
                    className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Item Quick Summary */}
                <div className="bg-amber-50/80 border border-amber-200 rounded-2xl p-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="w-8 h-8 rounded-full border-2 border-white shadow-xs shrink-0"
                      style={{ backgroundColor: reorderModalItem.color.hex_code }}
                    />
                    <div>
                      <h4 className="font-black text-sm text-slate-900">
                        {reorderModalItem.fabric.name} - لون {reorderModalItem.color.color_code}
                      </h4>
                      <span className="text-xs text-slate-500">
                        {reorderModalItem.color.color_name || 'بدون اسم'}
                      </span>
                    </div>
                  </div>

                  <div className="text-end">
                    <span className="text-xs text-slate-500 block">الرصيد المتاح حالياً</span>
                    <span className="font-black text-rose-700 text-base">
                      {reorderModalItem.available} {reorderModalItem.fabric.unit}
                    </span>
                    <span className="text-[10px] text-amber-800 block">
                      (حد التنبيه: {minThreshold} {reorderModalItem.fabric.unit})
                    </span>
                  </div>
                </div>

                {/* Supplier Contact Section */}
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-600">المورد المعتمد للخامة:</span>
                    <span className="text-xs font-extrabold text-slate-900">
                      {reorderModalItem.supplier?.name || 'مورد عام'}
                    </span>
                  </div>

                  {reorderModalItem.supplier && (
                    <div className="flex items-center justify-between pt-1 gap-2 flex-wrap">
                      <span className="text-xs font-mono font-bold text-slate-700">
                        {reorderModalItem.supplier.phone}
                      </span>
                      <div className="flex items-center gap-2">
                        <a
                          href={`tel:${reorderModalItem.supplier.phone}`}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-bold hover:bg-blue-100 transition"
                        >
                          <Phone className="w-3.5 h-3.5" />
                          <span>اتصال مباشر</span>
                        </a>
                        {canSendWhatsApp() && (
                          <button
                            type="button"
                            onClick={handleCopyWhatsappText}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold hover:bg-emerald-100 transition cursor-pointer"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            <span>إرسال واتساب</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Reorder Form */}
                <form onSubmit={handleConfirmReorderReceive} className="space-y-4">
                  <div className={`grid ${canViewFabricPrices() ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">
                        الكمية المطلوبة ({reorderModalItem.fabric.unit}) *
                      </label>
                      <input
                        type="number"
                        min="1"
                        step="any"
                        value={reorderQty}
                        onChange={(e) => setReorderQty(parseFloat(e.target.value) || 0)}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-bold focus:ring-2 focus:ring-amber-500 focus:outline-hidden"
                        required
                      />
                    </div>

                    {canViewFabricPrices() && (
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">
                          سعر الوحدة التقديري (ج.م)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={reorderModalItem.color.price_per_unit || 0}
                          readOnly
                          className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-100 text-sm font-bold text-slate-600"
                        />
                      </div>
                    )}
                  </div>

                  {/* Calculated Cost Preview */}
                  {canViewFabricPrices() && (
                    <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 flex items-center justify-between text-xs">
                      <span className="font-bold text-amber-900">إجمالي التكلفة التقديرية للطلبية:</span>
                      <span className="font-extrabold text-amber-950 text-sm font-mono">
                        {(Number(reorderQty) * (reorderModalItem.color.price_per_unit || 0)).toLocaleString('ar-EG')} ج.م
                      </span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">
                      ملاحظات أو رقم إذن الطلبية
                    </label>
                    <input
                      type="text"
                      value={reorderNotes}
                      onChange={(e) => setReorderNotes(e.target.value)}
                      placeholder="مثال: توريد دفعة إضافية - استلام عاجل"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-amber-500 focus:outline-hidden"
                    />
                  </div>

                  {/* Action Buttons */}
                  <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row gap-2">
                    {canEdit && (
                      <button
                        type="submit"
                        className="flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-xs transition shadow-md shadow-emerald-500/20 flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Check className="w-4 h-4" />
                        <span>تأكيد استلام الطلبية وإضافتها للرصيد (+)</span>
                      </button>
                    )}

                    {canSendWhatsApp() && (
                      <button
                        type="button"
                        onClick={handleCopyWhatsappText}
                        className="py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-slate-950 font-black text-xs transition flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                      >
                        {copiedOrder ? (
                          <>
                            <Check className="w-4 h-4" />
                            <span>تم نسخ نص الطلبية!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            <span>نسخ رسالة الطلبية للمورد</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* PRINT INVENTORY REPORT MODAL */}
          {showPrintInventoryModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
              <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between no-print bg-slate-50">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-2xl bg-blue-600 text-white shadow-xs">
                      <Printer className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-extrabold text-lg text-slate-900">
                        معاينة تقرير جرد مخزن الأقمشة والخامات
                      </h3>
                      <p className="text-xs text-slate-500">
                        كشف جرد مفصل لجميع الخامات والألوان: الوارد مقابل المستهلك والرصيد الفعلي والمحجوز
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => window.print()}
                      className="px-5 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md shadow-blue-500/20 transition flex items-center gap-1.5 cursor-pointer"
                    >
                      <Printer className="w-4 h-4" />
                      <span>طباعة التقرير (Print)</span>
                    </button>
                    <button
                      onClick={() => setShowPrintInventoryModal(false)}
                      className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 transition cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Printable Content Body */}
                <div
                  className="flex-grow overflow-y-auto p-8 space-y-6 print:p-0"
                  style={{ fontFamily: 'Tahoma, Arial, sans-serif' }}
                >
                  <div className="text-center border-b-[3px] border-double border-slate-900 pb-3">
                    <div className="flex items-center justify-center mb-1">
                      {isImageLogo(globalSettings?.logo) ? (
                        <img
                          src={globalSettings?.logo}
                          alt={globalSettings?.site_name || 'شعار المصنع'}
                          className="h-14 w-auto max-w-[190px] object-contain"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <span className="text-4xl leading-none">
                          {globalSettings?.logo || '🏭'}
                        </span>
                      )}
                    </div>
                    <h1 className="text-xl font-black text-slate-900 tracking-tight">
                      {globalSettings?.site_name || 'مصنع الملابس الجاهزة'} — تقرير جرد
                      مخزن الأقمشة والخامات
                    </h1>
                    <p className="text-xs text-slate-600 mt-1 font-bold">
                      تاريخ ووقت استخراج التقرير:{' '}
                      {new Date().toLocaleString('ar-EG', { hour12: false })}
                    </p>
                  </div>

                  {/* Summary Bar */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 text-center">
                    <div className="p-2.5 bg-slate-50 rounded-md border border-slate-400">
                      <span className="text-[11px] text-slate-600 block font-bold">عدد أصناف الأقمشة</span>
                      <strong className="text-lg text-slate-900 font-black">{fabrics.length}</strong>
                    </div>
                    <div className="p-2.5 bg-slate-50 rounded-md border border-slate-400">
                      <span className="text-[11px] text-slate-600 block font-bold">إجمالي ألوان القماش</span>
                      <strong className="text-lg text-slate-900 font-black">{fabricColors.length}</strong>
                    </div>
                    <div className="p-2.5 bg-emerald-50 rounded-md border border-emerald-400">
                      <span className="text-[11px] text-emerald-800 block font-bold">إجمالي الوارد</span>
                      <strong className="text-lg text-emerald-900 font-black">{auditTotals.totalReceived}</strong>
                    </div>
                    <div className="p-2.5 bg-rose-50 rounded-md border border-rose-400">
                      <span className="text-[11px] text-rose-800 block font-bold">إجمالي المستهلك</span>
                      <strong className="text-lg text-rose-900 font-black">{auditTotals.totalConsumed}</strong>
                    </div>
                    <div className="p-2.5 bg-amber-50 rounded-md border border-amber-400">
                      <span className="text-[11px] text-amber-800 block font-bold">إجمالي عيوب القماش</span>
                      <strong className="text-lg text-amber-900 font-black">{auditTotals.totalDefect}</strong>
                    </div>
                    <div className="p-2.5 bg-slate-50 rounded-md border border-slate-400">
                      <span className="text-[11px] text-slate-600 block font-bold">إجمالي الرصيد الفعلي (كجم/توب)</span>
                      <strong className="text-lg text-slate-900 font-black">
                        {fabricColors.reduce((sum, c) => sum + c.quantity, 0).toFixed(1)}
                      </strong>
                    </div>
                    <div className="p-2.5 bg-slate-50 rounded-md border border-slate-400">
                      <span className="text-[11px] text-slate-600 block font-bold">إجمالي الرصيد المحجوز</span>
                      <strong className="text-lg text-slate-900 font-black">
                        {fabricColors.reduce((sum, c) => sum + c.reserved_quantity, 0).toFixed(1)}
                      </strong>
                    </div>
                  </div>

                  {/* Comprehensive Inventory Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-start border-collapse">
                      <thead className="bg-slate-100 text-slate-900 font-bold">
                        <tr>
                          <th className="border border-slate-800 px-3 py-2">عينة اللون / الصورة</th>
                          <th className="border border-slate-800 px-3 py-2">الخامة الأساسية</th>
                          <th className="border border-slate-800 px-3 py-2">كود اللون</th>
                          <th className="border border-slate-800 px-3 py-2">اسم اللون</th>
                          <th className="border border-slate-800 px-3 py-2 text-center">الرصيد الفعلي</th>
                          <th className="border border-slate-800 px-3 py-2 text-center">إجمالي الوارد</th>
                          <th className="border border-slate-800 px-3 py-2 text-center">إجمالي المستهلك</th>
                          <th className="border border-slate-800 px-3 py-2 text-center">عيوب القماش</th>
                          <th className="border border-slate-800 px-3 py-2 text-center">المحجوز</th>
                          <th className="border border-slate-800 px-3 py-2 text-center">المتاح للتصميم</th>
                          <th className="border border-slate-800 px-3 py-2 text-center">الوحدة</th>
                          {canViewFabricPrices() && (
                            <>
                              <th className="border border-slate-800 px-3 py-2 text-center">سعر الوحدة</th>
                              <th className="border border-slate-800 px-3 py-2 text-center">إجمالي القيمة التقديرية</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody className="font-semibold">
                        {fabricColors.map((color) => {
                          const fab = fabrics.find((f) => f.id === color.fabric_id);
                          const avail = Number((color.quantity - color.reserved_quantity).toFixed(2));
                          const totalVal = (color.price_per_unit || 0) * color.quantity;
                          const auditRow = auditRowsByColorId.get(color.id);

                          return (
                            <tr key={color.id} className="hover:bg-slate-50 transition">
                              <td className="border border-slate-800 px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <div
                                    className="w-6 h-6 rounded border border-slate-400 shrink-0"
                                    style={{ backgroundColor: color.hex_code || '#94a3b8' }}
                                    title={color.color_name}
                                  />
                                </div>
                              </td>
                              <td className="border border-slate-800 px-3 py-2 font-bold text-slate-900">{fab?.name || 'خامة'}</td>
                              <td className="border border-slate-800 px-3 py-2 font-mono font-bold text-slate-900">{color.color_code}</td>
                              <td className="border border-slate-800 px-3 py-2 text-slate-700">{color.color_name || '-'}</td>
                              <td className="border border-slate-800 px-3 py-2 text-center font-bold text-slate-900">{color.quantity}</td>
                              <td className="border border-slate-800 px-3 py-2 text-center font-bold text-emerald-800">
                                {auditRow ? auditRow.totalReceived : color.quantity}
                              </td>
                              <td className="border border-slate-800 px-3 py-2 text-center font-bold text-rose-800">
                                {auditRow ? auditRow.totalConsumed : 0}
                              </td>
                              <td className="border border-slate-800 px-3 py-2 text-center font-bold text-amber-800">
                                {auditRow ? auditRow.totalDefect : 0}
                              </td>
                              <td className="border border-slate-800 px-3 py-2 text-center font-bold text-slate-900">{color.reserved_quantity}</td>
                              <td className="border border-slate-800 px-3 py-2 text-center font-black text-slate-900">{avail}</td>
                              <td className="border border-slate-800 px-3 py-2 text-center text-slate-700">{fab?.unit || 'كيلو'}</td>
                              {canViewFabricPrices() && (
                                <>
                                  <td className="border border-slate-800 px-3 py-2 text-center font-mono font-bold text-slate-900">
                                    {color.price_per_unit || 0} ج.م
                                  </td>
                                  <td className="border border-slate-800 px-3 py-2 text-center font-mono font-black text-slate-900">
                                    {totalVal.toLocaleString('ar-EG')} ج.م
                                  </td>
                                </>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="pt-6 border-t-2 border-slate-900 text-xs text-slate-700 flex justify-between font-bold">
                    <span>مسؤول الجرد: ______________________</span>
                    <span>اعتماد مدير المصنع: ______________________</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};