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
  ChevronDown
} from 'lucide-react';
import { Fabric, FabricColor, Supplier } from '../types';
import { AccessoriesWarehouseView } from './AccessoriesWarehouseView';
import { ProductionWarehouseView } from './ProductionWarehouseView';

type WarehouseSectionTab = 'fabric' | 'accessories' | 'production';
type FabricViewSubTab = 'inventory' | 'alerts';

export const WarehouseView: React.FC = () => {
  const {
    fabrics,
    fabricColors,
    fabricTransactions,
    suppliers,
    accessoryItems,
    addFabricOrColor,
    recordTransaction,
    exportWarehouseInventoryCsv,
    updateColorPrice,
    hasPermission,
    canViewFabricPrices,
    canEditFabricPrices,
    canSendWhatsApp,
    formatSupplierWhatsappMessage,
    addFlashMessage
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
  const [searchAllFabrics, setSearchAllFabrics] = useState<boolean>(false);

  const hasActiveAdvancedFilters =
    colorSearchFilter.trim() !== '' || maxAvailableQtyFilter.trim() !== '';

  // Fallback if selected fabric was removed or not set
  const currentFabricId =
    selectedFabricId === 'all'
      ? 'all'
      : selectedFabricId || (fabrics.length > 0 ? fabrics[0].id : '');
  const selectedFabric =
    currentFabricId === 'all'
      ? undefined
      : fabrics.find((f) => f.id === currentFabricId) || fabrics[0];

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
  // 2. Filter by Color (Color Name, Color Code, or Hex Code)
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

    // Filter 2: Search by color name, color code, or Hex code
    if (colorSearchFilter.trim() !== '') {
      const q = colorSearchFilter.trim().toLowerCase();
      const qNoHash = q.replace(/^#/, '');
      const nameMatch = (c.color_name || '').toLowerCase().includes(q);
      const codeMatch = (c.color_code || '').toLowerCase().includes(q);
      const hexRaw = (c.hex_code || '').toLowerCase();
      const hexNoHash = hexRaw.replace(/^#/, '');
      const hexMatch = hexRaw.includes(q) || (qNoHash !== '' && hexNoHash.includes(qNoHash));

      if (!nameMatch && !codeMatch && !hexMatch) {
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

    if (reorderModalItem.supplier?.phone) {
      const cleanPhone = reorderModalItem.supplier.phone.replace(/[^0-9]/g, '');
      const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
      window.open(url, '_blank');
    }
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
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Fabric Filter – Custom Dropdown (with yellow low-stock indicators) */}
            <div className="relative w-full lg:flex-1 lg:max-w-md">
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

            {/* Action Buttons */}
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
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

              <button
                type="button"
                onClick={exportWarehouseInventoryCsv}
                className="flex items-center gap-2 px-5 py-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-md shadow-emerald-500/20 cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>📥 تحميل إكسيل</span>
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
                        ابحث باللون (اسم اللون، كود اللون، أو Hex Code) أو اعرض الأقمشة التي تقل كميتها المتاحة عن رقم محدد
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
                      <span>فلتر البحث باللون (اسم اللون / كود اللون / Hex Code):</span>
                    </label>
                    <div className="relative flex items-center gap-2">
                      <div className="relative flex-grow">
                        <input
                          type="text"
                          value={colorSearchFilter}
                          onChange={(e) => setColorSearchFilter(e.target.value)}
                          placeholder="اكتب اسم اللون (مثال: أسود، كحلي) أو الكود (C-101) أو Hex (#3b82f6)..."
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
                </div>

                {hasActiveAdvancedFilters && (
                  <div className="flex items-center justify-between bg-blue-50/80 border border-blue-200 px-4 py-2 rounded-xl text-xs font-bold text-blue-900">
                    <span>
                      نتائج الفلترة الحالية: تم العثور على ({filteredColorsForDisplay.length}) لون/قماش مطابق
                    </span>
                    <span className="text-[11px] text-blue-700">
                      {currentFabricId === 'all' || searchAllFabrics
                        ? 'نطاق البحث: جميع الخامات بالمخزن'
                        : `نطاق البحث: خامة ${selectedFabric?.name || ''}`}
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
                        const currentSupplier = suppliers.find((s) => s.id === colorFabric?.supplier_id);

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

                          return (
                            <tr key={tr.id} className="hover:bg-slate-50 transition">
                              <td className="px-4 py-3 text-slate-500">{tr.timestamp}</td>
                              <td className="px-4 py-3">
                                <span
                                  className={`px-2.5 py-0.5 rounded-full font-bold ${
                                    isAdd
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-rose-100 text-rose-800'
                                  }`}
                                >
                                  {isAdd ? '+ إضافة / مرتجع' : '- صرف للمقص'}
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
                        كشف جرد مفصل لجميع الخامات والألوان والأرصدة الفعلية والمحجوزة
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
                <div className="flex-grow overflow-y-auto p-8 space-y-6 print:p-0">
                  <div className="border-b-2 border-slate-900 pb-4 flex items-center justify-between">
                    <div>
                      <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                        🏭 نظام إدارة المصنع - تقرير جرد مخزن الأقمشة
                      </h1>
                      <p className="text-xs text-slate-500 mt-1">
                        تاريخ ووقت استخراج التقرير: {new Date().toLocaleString('ar-EG', { hour12: false })}
                      </p>
                    </div>
                    <div className="text-end">
                      <span className="text-xs font-bold px-3 py-1 rounded-full bg-slate-100 text-slate-800 border">
                        إجمالي الخامات: {fabrics.length} | إجمالي الألوان: {fabricColors.length}
                      </span>
                    </div>
                  </div>

                  {/* Summary Bar */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    <div className="p-3 bg-slate-50 rounded-xl border">
                      <span className="text-[11px] text-slate-500 block">عدد أصناف الأقمشة</span>
                      <strong className="text-lg text-slate-900 font-black">{fabrics.length}</strong>
                    </div>
                    <div className="p-3 bg-blue-50 rounded-xl border border-blue-200">
                      <span className="text-[11px] text-blue-700 block">إجمالي ألوان القماش</span>
                      <strong className="text-lg text-blue-900 font-black">{fabricColors.length}</strong>
                    </div>
                    <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                      <span className="text-[11px] text-emerald-700 block">إجمالي الرصيد الفعلي (كجم/توب)</span>
                      <strong className="text-lg text-emerald-900 font-black">
                        {fabricColors.reduce((sum, c) => sum + c.quantity, 0).toFixed(1)}
                      </strong>
                    </div>
                    <div className="p-3 bg-amber-50 rounded-xl border border-amber-200">
                      <span className="text-[11px] text-amber-700 block">إجمالي الرصيد المحجوز</span>
                      <strong className="text-lg text-amber-900 font-black">
                        {fabricColors.reduce((sum, c) => sum + c.reserved_quantity, 0).toFixed(1)}
                      </strong>
                    </div>
                  </div>

                  {/* Comprehensive Inventory Table */}
                  <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                    <table className="w-full text-xs text-start">
                      <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-3">عينة اللون / الصورة</th>
                          <th className="px-4 py-3">الخامة الأساسية</th>
                          <th className="px-4 py-3">كود اللون</th>
                          <th className="px-4 py-3">اسم اللون</th>
                          <th className="px-4 py-3 text-center">الرصيد الفعلي</th>
                          <th className="px-4 py-3 text-center">المحجوز</th>
                          <th className="px-4 py-3 text-center">المتاح للتصميم</th>
                          <th className="px-4 py-3 text-center">الوحدة</th>
                          {canViewFabricPrices() && (
                            <>
                              <th className="px-4 py-3 text-center">سعر الوحدة</th>
                              <th className="px-4 py-3 text-center">إجمالي القيمة التقديرية</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {fabricColors.map((color) => {
                          const fab = fabrics.find((f) => f.id === color.fabric_id);
                          const avail = Number((color.quantity - color.reserved_quantity).toFixed(2));
                          const totalVal = (color.price_per_unit || 0) * color.quantity;

                          return (
                            <tr key={color.id} className="hover:bg-slate-50 transition">
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-2">
                                  <div
                                    className="w-7 h-7 rounded-lg border border-slate-300 shadow-2xs shrink-0"
                                    style={{ backgroundColor: color.hex_code || '#3b82f6' }}
                                    title={color.color_name}
                                  />
                                </div>
                              </td>
                              <td className="px-4 py-2.5 font-bold text-slate-900">{fab?.name || 'خامة'}</td>
                              <td className="px-4 py-2.5 font-mono font-bold text-blue-700">{color.color_code}</td>
                              <td className="px-4 py-2.5 text-slate-600">{color.color_name || '-'}</td>
                              <td className="px-4 py-2.5 text-center font-bold text-slate-900">{color.quantity}</td>
                              <td className="px-4 py-2.5 text-center text-amber-700 font-bold">{color.reserved_quantity}</td>
                              <td className="px-4 py-2.5 text-center font-extrabold text-emerald-700">{avail}</td>
                              <td className="px-4 py-2.5 text-center text-slate-500">{fab?.unit || 'كيلو'}</td>
                              {canViewFabricPrices() && (
                                <>
                                  <td className="px-4 py-2.5 text-center font-mono font-bold text-slate-800">
                                    {color.price_per_unit || 0} ج.م
                                  </td>
                                  <td className="px-4 py-2.5 text-center font-mono font-black text-slate-900">
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

                  <div className="pt-6 border-t border-slate-200 text-xs text-slate-500 flex justify-between">
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