import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Sparkles,
  Plus,
  FileSpreadsheet,
  ArrowUpDown,
  X,
  AlertTriangle,
  Coins,
  ShoppingCart,
  MessageCircle,
  ChevronDown,
  ChevronUp,
  Search,
  Image as ImageIcon,
  FolderPlus,
  Trash2,
  Printer,
  PackageCheck
} from 'lucide-react';
import { AccessoryItem, AccessoryUnit, AccessoryUsageType, Supplier } from '../types';

export const AccessoriesWarehouseView: React.FC = () => {
  const {
    accessoryTypes,
    accessoryItems,
    suppliers,
    hasPermission,
    canViewAccessoryPrices,
    canSendWhatsApp,
    addAccessoryType,
    addAccessoryItem,
    deleteAccessoryItem,
    recordAccessoryTransaction,
    exportAccessoryInventoryCsv,
    markAccessoryWithdrawn,
    formatSupplierWhatsappMessage
  } = useApp();

  const canEdit = hasPermission('warehouse', true) || hasPermission('accessories_warehouse', true);

  // Filter & Search states
  const [selectedTypeId, setSelectedTypeId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showLowStockOnly] = useState<boolean>(false);

  // Modals state
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [showAddTypeModal, setShowAddTypeModal] = useState<boolean>(false);
  const [showTransactionModal, setShowTransactionModal] = useState<boolean>(false);
  const [showPrintInventoryModal, setShowPrintInventoryModal] = useState<boolean>(false);
  const [showPrintAlertsModal, setShowPrintAlertsModal] = useState<boolean>(false);

  // Alert sidebar state & threshold
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [globalThreshold] = useState<number>(30);
  const [alertSectionTab, setAlertSectionTab] = useState<'all' | 'stock' | 'custom_model'>('all');
  const [modalAlertTab, setModalAlertTab] = useState<'all' | 'stock' | 'custom_model'>('all');

  // Transaction active item
  const [activeItem, setActiveItem] = useState<AccessoryItem | null>(null);
  const [transForm, setTransForm] = useState({
    operation: 'deduct' as 'add' | 'deduct',
    amount: 10,
    modelCodeRef: '',
    notes: ''
  });

  // Reorder modal state
  const [reorderItem, setReorderItem] = useState<{
    item: AccessoryItem;
    supplier?: Supplier;
    available: number;
    deficit?: number;
  } | null>(null);
  const [reorderQty, setReorderQty] = useState<number>(100);
  const [reorderNotes, setReorderNotes] = useState<string>('');
  const [copiedOrder, setCopiedOrder] = useState<boolean>(false);

  // New Accessory Form state
  const [addForm, setAddForm] = useState({
    typeId: accessoryTypes[0]?.id || '',
    newTypeName: '',
    code: '',
    name: '',
    image: '',
    unit: 'قطعة' as AccessoryUnit,
    quantity: 50,
    pricePerUnit: 5,
    supplierId: suppliers[0]?.id || '',
    minThreshold: 30,
    usageType: 'stock' as AccessoryUsageType,
    customModelCode: '',
    targetQuantity: 100
  });

  // New Type Form state
  const [newTypeNameInput, setNewTypeNameInput] = useState<string>('');
  const [newTypeDescInput, setNewTypeDescInput] = useState<string>('');

  // Calculate low stock / deficit items with ADVANCED USAGE TYPE LOGIC
  const lowStockItems = accessoryItems
    .map((item) => {
      const sup = suppliers.find((s) => s.id === item.supplier_id);
      const available = Number((item.quantity - item.reserved_quantity).toFixed(2));

      if (item.usage_type === 'custom_model') {
        if (item.withdrawn_for_model) {
          return { item, supplier: sup, available, threshold: 0, deficit: 0, isLow: false };
        }
        const targetReq = item.target_quantity || item.min_threshold;
        const supplied = item.delivered_quantity ?? item.quantity;
        const deficit = Math.max(0, targetReq - supplied);
        const isLow = deficit > 0;
        return {
          item,
          supplier: sup,
          available,
          threshold: targetReq,
          deficit,
          isLow
        };
      } else {
        const threshold = item.min_threshold ?? globalThreshold;
        const deficit = Math.max(0, threshold - available);
        const isLow = available <= threshold;
        return {
          item,
          supplier: sup,
          available,
          threshold,
          deficit,
          isLow
        };
      }
    })
    .filter((entry) => entry.isLow);

  const lowStockCount = lowStockItems.length;
  const stockDeficits = lowStockItems.filter((e) => e.item.usage_type !== 'custom_model');
  const modelDeficits = lowStockItems.filter((e) => e.item.usage_type === 'custom_model');

  // Filtered accessories for the main list/grid
  const filteredAccessories = accessoryItems.filter((item) => {
    if (selectedTypeId !== 'all' && item.type_id !== selectedTypeId) return false;

    if (showLowStockOnly) {
      const isItemInLowList = lowStockItems.some((e) => e.item.id === item.id);
      if (!isItemInLowList) return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const matchName = item.name.toLowerCase().includes(q);
      const matchCode = item.code.toLowerCase().includes(q);
      const matchModel = item.custom_model_code?.toLowerCase().includes(q);
      return matchName || matchCode || matchModel;
    }

    return true;
  });

  const totalItemsCount = accessoryItems.length;
  const totalQuantitySum = accessoryItems.reduce((acc, it) => acc + it.quantity, 0);

  const handleOpenTransaction = (item: AccessoryItem, op: 'add' | 'deduct' = 'deduct') => {
    setActiveItem(item);
    setTransForm({
      operation: op,
      amount: op === 'deduct' ? 10 : 50,
      modelCodeRef: item.custom_model_code || '',
      notes: ''
    });
    setShowTransactionModal(true);
  };

  const handleConfirmTransaction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeItem) return;

    const res = recordAccessoryTransaction({
      accessoryId: activeItem.id,
      operation: transForm.operation,
      amount: Number(transForm.amount),
      modelCodeRef: transForm.modelCodeRef,
      notes: transForm.notes
    });

    if (res.success) {
      setShowTransactionModal(false);
      setActiveItem(null);
    }
  };

  const handleOpenReorder = (item: AccessoryItem, suggestedDeficit?: number) => {
    const sup = suppliers.find((s) => s.id === item.supplier_id);
    const available = Number((item.quantity - item.reserved_quantity).toFixed(2));
    setReorderItem({ item, supplier: sup, available, deficit: suggestedDeficit });
    setReorderQty(suggestedDeficit && suggestedDeficit > 0 ? suggestedDeficit : 100);
    setReorderNotes('');
    setCopiedOrder(false);
  };

  const generateWhatsappText = (item: AccessoryItem, qty: number, supplierName?: string) => {
    const isCustom = item.usage_type === 'custom_model';
    return formatSupplierWhatsappMessage({
      supplier_name: supplierName || 'حضرة المورد',
      item_name: `${item.type_name} - ${item.name}${isCustom && item.custom_model_code ? ` (موديل ${item.custom_model_code})` : ''}`,
      color_code: item.code,
      quantity: qty,
      unit: item.unit,
      available: item.quantity
    });
  };

  const handleCopyWhatsappText = () => {
    if (!reorderItem) return;
    const text = generateWhatsappText(reorderItem.item, reorderQty, reorderItem.supplier?.name);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedOrder(true);
      setTimeout(() => setCopiedOrder(false), 3000);
    }
    if (reorderItem.supplier?.phone) {
      const cleanPhone = reorderItem.supplier.phone.replace(/[^0-9]/g, '');
      const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
      window.open(url, '_blank');
    }
  };

  const handleDirectWhatsapp = (item: AccessoryItem, qty: number, sup?: Supplier) => {
    const text = generateWhatsappText(item, qty, sup?.name);
    if (sup?.phone) {
      const cleanPhone = sup.phone.replace(/[^0-9]/g, '');
      const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
      window.open(url, '_blank');
    } else {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text);
        alert('تم نسخ نص طلب التوريد بنجاح! لم يتم تسجيل رقم هاتف للمورد.');
      }
    }
  };

  const handleConfirmReorderReceive = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reorderItem) return;

    const amount = Number(reorderQty);
    if (amount <= 0) return;

    const res = recordAccessoryTransaction({
      accessoryId: reorderItem.item.id,
      operation: 'add',
      amount,
      modelCodeRef: reorderItem.item.custom_model_code || 'إعادة توريد',
      notes: `طلبية توريد - المورد: ${reorderItem.supplier?.name || 'غير محدد'}. ${reorderNotes}`
    });

    if (res.success) {
      setReorderItem(null);
    }
  };

  const handleCreateAccessory = (e: React.FormEvent) => {
    e.preventDefault();

    let targetTypeId = addForm.typeId || accessoryTypes[0]?.id || "type-1";
    if (addForm.newTypeName.trim()) {
      targetTypeId = addAccessoryType(addForm.newTypeName.trim());
    }
    if (!targetTypeId) return;

    const targetQty = addForm.usageType === 'custom_model' ? Number(addForm.targetQuantity) : Number(addForm.minThreshold);

    const res = addAccessoryItem({
      type_id: targetTypeId,
      code: addForm.code,
      name: addForm.name,
      image: addForm.image,
      unit: addForm.unit,
      quantity: Number(addForm.quantity),
      price_per_unit: Number(addForm.pricePerUnit),
      supplier_id: addForm.supplierId,
      min_threshold: Number(addForm.minThreshold),
      usage_type: addForm.usageType,
      custom_model_code: addForm.customModelCode,
      target_quantity: targetQty,
      delivered_quantity: Number(addForm.quantity)
    });

    if (res.success) {
      setShowAddModal(false);
      setAddForm({
        typeId: accessoryTypes[0]?.id || '',
        newTypeName: '',
        code: '',
        name: '',
        image: '',
        unit: 'قطعة',
        quantity: 50,
        pricePerUnit: 5,
        supplierId: suppliers[0]?.id || '',
        minThreshold: 30,
        usageType: 'stock',
        customModelCode: '',
        targetQuantity: 100
      });
    }
  };

  const handleCreateType = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTypeNameInput.trim()) return;
    addAccessoryType(newTypeNameInput.trim(), newTypeDescInput.trim());
    setNewTypeNameInput('');
    setNewTypeDescInput('');
    setShowAddTypeModal(false);
  };

  const handleImageFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (uploadEvent) => {
        const result = uploadEvent.target?.result as string;
        if (result) {
          setAddForm((prev) => ({ ...prev, image: result }));
        }
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="space-y-6">
      {/* Automatic Alert Bar for Low Stock & Deficit Accessories */}
      {lowStockCount > 0 && (
        <section
          aria-label="تنبيهات نقص مخزون الإكسسوارات"
          className="relative overflow-hidden rounded-3xl bg-amber-50/90 border-2 border-amber-300 border-s-8 border-s-amber-500 p-4 sm:p-5 shadow-xs transition-all"
        >
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-amber-500 text-white rounded-2xl shadow-xs">
                <AlertTriangle className="w-5 h-5 animate-bounce" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-black text-amber-950">
                    تنبيهات نقص وتوريد الإكسسوارات والمستلزمات
                  </h3>
                  <span className="px-2.5 py-0.5 text-xs font-black bg-amber-200 text-amber-900 rounded-full border border-amber-300">
                    {lowStockCount} أصناف مطلوبة للشراء
                  </span>
                </div>
                <p className="text-xs text-amber-800 mt-0.5">
                  حساب دقيق للنواقص: (الكمية المطلوبة - الكمية الموردة). يمكنك طباعة ورقة النواقص لعامل المشتريات أو طلبها مباشرة عبر واتساب.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end flex-wrap">
              <button
                type="button"
                onClick={() => setShowPrintAlertsModal(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة ورقة النواقص</span>
              </button>

              <button
                type="button"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="flex items-center gap-1 px-3 py-2 bg-amber-200/80 hover:bg-amber-300 text-amber-950 text-xs font-bold rounded-xl transition cursor-pointer"
              >
                <span>{sidebarOpen ? 'إخفاء' : 'عرض النواقص'}</span>
                {sidebarOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Collapsible Low Stock List */}
          {sidebarOpen && (
            <div className="mt-4 pt-4 border-t border-amber-200/80">
              {/* Alert Tabs */}
              <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setAlertSectionTab('all')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                    alertSectionTab === 'all'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'bg-white/80 text-amber-900 hover:bg-white'
                  }`}
                >
                  <span>الكل (جميع النواقص)</span>
                  <span className="px-1.5 py-0.5 bg-black/15 text-current text-[10px] rounded-full font-bold">
                    {lowStockCount}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setAlertSectionTab('stock')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                    alertSectionTab === 'stock'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'bg-white/80 text-amber-900 hover:bg-white'
                  }`}
                >
                  <span>نواقص الإكسسوارات المستمرة (Stock)</span>
                  <span className="px-1.5 py-0.5 bg-black/15 text-current text-[10px] rounded-full font-bold">
                    {stockDeficits.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setAlertSectionTab('custom_model')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                    alertSectionTab === 'custom_model'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'bg-white/80 text-amber-900 hover:bg-white'
                  }`}
                >
                  <span>نواقص إكسسوارات الموديلات (Model-Specific)</span>
                  <span className="px-1.5 py-0.5 bg-black/15 text-current text-[10px] rounded-full font-bold">
                    {modelDeficits.length}
                  </span>
                </button>
              </div>

              {/* Grid of Items */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {(alertSectionTab === 'stock'
                  ? stockDeficits
                  : alertSectionTab === 'custom_model'
                  ? modelDeficits
                  : lowStockItems
                ).map(({ item, supplier, available, threshold, deficit }) => {
                  const isCustom = item.usage_type === 'custom_model';

                  return (
                    <div
                      key={item.id}
                      className="p-3.5 bg-white/95 rounded-2xl border border-amber-200 shadow-2xs hover:shadow-xs transition flex flex-col justify-between gap-2"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-12 h-12 rounded-xl bg-slate-100 overflow-hidden border border-slate-200 shrink-0">
                          {item.image ? (
                            <img src={item.image} alt={item.name} className="w-full h-full object-contain bg-white" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-400">
                              <ImageIcon className="w-5 h-5 text-slate-300" />
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono text-[10px] font-black bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded">
                              {item.code}
                            </span>
                            <span className="font-extrabold text-xs text-slate-900 truncate block">
                              {item.name}
                            </span>
                          </div>

                          {isCustom ? (
                            <p className="text-[11px] text-pink-700 font-bold mt-0.5">
                              خاص بموديل: <span className="underline">{item.custom_model_code}</span> | عجز مطلوب: <strong className="text-rose-700 font-black">{deficit}</strong> {item.unit}
                            </p>
                          ) : (
                            <p className="text-[11px] text-amber-800 mt-0.5">
                              المتاح: <strong className="text-rose-700">{available}</strong> من حد الأمان ({threshold}) | عجز: <strong>{deficit}</strong> {item.unit}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Action buttons inside alert item */}
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-1 flex-wrap">
                        {isCustom && !item.withdrawn_for_model && (
                          <button
                            type="button"
                            onClick={() => markAccessoryWithdrawn(item.id)}
                            className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-bold rounded-lg transition flex items-center gap-1 cursor-pointer"
                            title="بمجرد اكتمال توريد وسحب الإكسسوار للموديل يختفي من التنبيهات"
                          >
                            <PackageCheck className="w-3.5 h-3.5 text-emerald-600" />
                            <span>سحب للموديل (إخفاء)</span>
                          </button>
                        )}

                        <div className="flex items-center gap-1 ms-auto">
                          {canSendWhatsApp() && (
                            <button
                              type="button"
                              onClick={() => handleDirectWhatsapp(item, deficit, supplier)}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded-lg transition flex items-center gap-1 cursor-pointer"
                              title="إرسال طلب النواقص للمورد عبر واتساب"
                            >
                              <MessageCircle className="w-3 h-3" />
                              <span>واتساب</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleOpenReorder(item, deficit)}
                            className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 text-[11px] font-black rounded-lg transition flex items-center gap-1 cursor-pointer"
                          >
                            <ShoppingCart className="w-3 h-3" />
                            <span>طلب</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Top Header & Overview Stats */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="p-2 bg-pink-100 text-pink-700 rounded-2xl">
                <Sparkles className="w-5 h-5" />
              </span>
              <h2 className="text-xl font-black text-slate-900">مخزن الإكسسوارات والمستلزمات</h2>
              <span className="text-xs font-bold px-2.5 py-0.5 bg-slate-100 text-slate-700 rounded-full border border-slate-200">
                {totalItemsCount} صنف مسجل
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-1">
              إدارة مستلزمات الإنتاج (بادجات، ورود، دانتيل، سوست، تيكت) بأصناف رصيد مستمر أو استخدام مخصص لموديل معين.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPrintInventoryModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-full shadow-xs transition cursor-pointer"
              title="طباعة كشف جرد مفصل لمخزن الإكسسوارات"
            >
              <Printer className="w-4 h-4" />
              <span>🖨️ طباعة تقرير الجرد</span>
            </button>

            <button
              type="button"
              onClick={() => setShowPrintAlertsModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black rounded-full shadow-xs transition cursor-pointer"
              title="طباعة ورقة النواقص مفصلة للمشتريات"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>📋 طباعة ورقة النواقص</span>
            </button>

            <button
              type="button"
              onClick={exportAccessoryInventoryCsv}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-full transition shadow-xs cursor-pointer"
              title="تصدير شيت إكسيل"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>تصدير إكسيل</span>
            </button>

            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={() => setShowAddTypeModal(true)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-pink-50 hover:bg-pink-100 text-pink-800 text-xs font-bold rounded-full border border-pink-200 transition cursor-pointer"
                >
                  <FolderPlus className="w-4 h-4 text-pink-600" />
                  <span>إضافة تصنيف</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowAddModal(true)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-full shadow-xs transition cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>+ إضافة إكسسوار</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="mt-6 pt-5 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
            <button
              type="button"
              onClick={() => setSelectedTypeId('all')}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition shrink-0 ${
                selectedTypeId === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              الكل ({accessoryItems.length})
            </button>
            {accessoryTypes.map((t) => {
              const count = accessoryItems.filter((i) => i.type_id === t.id).length;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedTypeId(t.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition shrink-0 ${
                    selectedTypeId === t.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {t.name} ({count})
                </button>
              );
            })}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute start-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث بالاسم، الكود، أو الموديل..."
              className="w-full ps-9 pe-3 py-1.5 bg-slate-50 border border-slate-200 rounded-full text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Main Accessories Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {filteredAccessories.map((item) => {
          const supplier = suppliers.find((s) => s.id === item.supplier_id);
          const available = Number((item.quantity - item.reserved_quantity).toFixed(2));
          const isCustom = item.usage_type === 'custom_model';
          const threshold = item.min_threshold ?? globalThreshold;
          const isLow = available <= threshold;
          const totalVal = ((item.price_per_unit || 0) * item.quantity).toFixed(0);

          return (
            <div
              key={item.id}
              className={`bg-white rounded-3xl border transition overflow-hidden flex flex-col justify-between group ${
                isLow ? 'border-amber-300 ring-2 ring-amber-400/20' : 'border-slate-200 shadow-xs hover:shadow-md'
              }`}
            >
              <div>
                <div className="h-40 w-full overflow-hidden bg-slate-100 relative">
                  {item.image ? (
                    <img
                      src={item.image}
                      alt={item.name}
                      className="w-full h-full object-contain bg-white group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-1 bg-slate-50">
                      <ImageIcon className="w-8 h-8 text-slate-300" />
                      <span className="text-[11px] text-slate-400">لا توجد صورة</span>
                    </div>
                  )}

                  {/* Top Badges */}
                  <div className="absolute top-2 start-2 flex flex-col gap-1 items-start">
                    <span className="px-2 py-0.5 text-[10px] font-black bg-slate-900/90 text-white rounded-md font-mono">
                      {item.code}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-pink-600/90 text-white rounded-md">
                      {item.type_name}
                    </span>
                    {isCustom && (
                      <span className="px-2 py-0.5 text-[10px] font-black bg-amber-500 text-slate-950 rounded-md shadow-2xs">
                        خاص بموديل {item.custom_model_code}
                      </span>
                    )}
                  </div>

                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => deleteAccessoryItem(item.id)}
                      className="absolute top-2 end-2 p-1.5 bg-rose-600/90 text-white rounded-lg shadow-xs hover:bg-rose-700 transition"
                      title="حذف الصنف"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="p-4 space-y-2">
                  <h3 className="font-bold text-slate-900 text-sm line-clamp-1" title={item.name}>
                    {item.name}
                  </h3>

                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="truncate">{supplier?.name || 'مورد عام'}</span>
                    {supplier?.phone && (
                      <span className="font-mono text-[11px] text-slate-600">{supplier.phone}</span>
                    )}
                  </div>

                  <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-slate-400 block">الرصيد المتاح:</span>
                      <strong className={`text-base font-black ${isLow ? 'text-amber-600' : 'text-slate-900'}`}>
                        {available} {item.unit}
                      </strong>
                    </div>

                    <div className="text-end">
                      <span className="text-[10px] text-slate-400 block">
                        {isCustom ? 'الكمية المستهدفة:' : 'حد الأمان:'}
                      </span>
                      <span className="text-xs font-bold text-slate-700">
                        {isCustom ? item.target_quantity || item.min_threshold : threshold} {item.unit}
                      </span>
                    </div>
                  </div>

                  {/* Price display guarded by permission */}
                  {canViewAccessoryPrices() && (
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                      <div className="flex items-center gap-1 text-slate-600">
                        <Coins className="w-3.5 h-3.5 text-amber-500" />
                        <span>السعر:</span>
                        <strong className="text-slate-900">{item.price_per_unit || 0} ج.م</strong>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        إجمالي: <strong>{totalVal} ج.م</strong>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="p-3 border-t border-slate-100 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleOpenTransaction(item, 'deduct')}
                  className="py-2 px-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1 cursor-pointer"
                >
                  <ArrowUpDown className="w-3.5 h-3.5 text-slate-600" />
                  <span>صرف / إضافة</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleOpenReorder(item)}
                  className="py-2 px-2 bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black rounded-xl transition flex items-center justify-center gap-1 shadow-xs cursor-pointer"
                >
                  <ShoppingCart className="w-3.5 h-3.5" />
                  <span>طلب توريد</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* MODAL 0: ADD ACCESSORY TYPE */}
      {showAddTypeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-extrabold text-base text-slate-900">إضافة تصنيف إكسسوارات جديد</h3>
              <button onClick={() => setShowAddTypeModal(false)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateType} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">اسم التصنيف *</label>
                <input
                  type="text"
                  required
                  value={newTypeNameInput}
                  onChange={(e) => setNewTypeNameInput(e.target.value)}
                  placeholder="مثال: زراير، كباسين، كمر..."
                  className="w-full px-3 py-2 border rounded-xl text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الوصف (اختياري)</label>
                <input
                  type="text"
                  value={newTypeDescInput}
                  onChange={(e) => setNewTypeDescInput(e.target.value)}
                  placeholder="وصف مختصر..."
                  className="w-full px-3 py-2 border rounded-xl text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddTypeModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-full"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white bg-pink-600 hover:bg-pink-700 rounded-full"
                >
                  حفظ التصنيف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 1: ADD ACCESSORY ITEM */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-600 text-white rounded-xl">
                  <Plus className="w-5 h-5" />
                </div>
                <h3 className="font-extrabold text-base text-slate-900">إضافة إكسسوار / مستلزم جديد</h3>
              </div>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateAccessory} className="p-6 overflow-y-auto space-y-4">
              {/* Usage Type Selection */}
              <div className="p-3.5 bg-blue-50/70 rounded-2xl border border-blue-200 space-y-2">
                <label className="block text-xs font-black text-blue-950">نوع استخدام الإكسسوار:</label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 p-2.5 bg-white rounded-xl border border-blue-200 cursor-pointer">
                    <input
                      type="radio"
                      name="usageType"
                      checked={addForm.usageType === 'stock'}
                      onChange={() => setAddForm({ ...addForm, usageType: 'stock' })}
                      className="text-blue-600"
                    />
                    <div>
                      <span className="font-bold text-xs text-slate-900 block">رصيد مستمر (Stock)</span>
                      <span className="text-[10px] text-slate-500">صنف دائم يطلب عند انخفاض حد الأمان</span>
                    </div>
                  </label>

                  <label className="flex items-center gap-2 p-2.5 bg-white rounded-xl border border-blue-200 cursor-pointer">
                    <input
                      type="radio"
                      name="usageType"
                      checked={addForm.usageType === 'custom_model'}
                      onChange={() => setAddForm({ ...addForm, usageType: 'custom_model' })}
                      className="text-blue-600"
                    />
                    <div>
                      <span className="font-bold text-xs text-slate-900 block">استخدام واحد لموديل معين</span>
                      <span className="text-[10px] text-slate-500">ينتهي طلبه بمجرد توريد وسحب الكمية</span>
                    </div>
                  </label>
                </div>

                {addForm.usageType === 'custom_model' && (
                  <div className="pt-2 grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">كود الموديل المخصص له *</label>
                      <input
                        type="text"
                        required
                        placeholder="مثال: M-101 أو SW-204"
                        value={addForm.customModelCode}
                        onChange={(e) => setAddForm({ ...addForm, customModelCode: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs bg-white rounded-xl border border-blue-300 focus:outline-hidden"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">الكمية المطلوبة للموديل *</label>
                      <input
                        type="number"
                        min="1"
                        required
                        value={addForm.targetQuantity}
                        onChange={(e) => setAddForm({ ...addForm, targetQuantity: Number(e.target.value) })}
                        className="w-full px-3 py-1.5 text-xs bg-white rounded-xl border border-blue-300 focus:outline-hidden font-bold"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">تصنيف الإكسسوار *</label>
                  <select
                    value={addForm.typeId}
                    onChange={(e) => setAddForm({ ...addForm, typeId: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden"
                  >
                    {accessoryTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">كود الصنف الفريد *</label>
                  <input
                    type="text"
                    required
                    placeholder="مثال: BDG-99"
                    value={addForm.code}
                    onChange={(e) => setAddForm({ ...addForm, code: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 font-mono uppercase focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">اسم الإكسسوار ووصفه *</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: بادج نسر مذهب مطرز صدر"
                  value={addForm.name}
                  onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الوحدة</label>
                  <select
                    value={addForm.unit}
                    onChange={(e) => setAddForm({ ...addForm, unit: e.target.value as AccessoryUnit })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden"
                  >
                    <option value="قطعة">قطعة</option>
                    <option value="دستة">دستة</option>
                    <option value="متر">متر</option>
                    <option value="باكو">باكو</option>
                    <option value="كيس">كيس</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الرصيد المستلم حالياً</label>
                  <input
                    type="number"
                    min="0"
                    value={addForm.quantity}
                    onChange={(e) => setAddForm({ ...addForm, quantity: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 font-bold focus:outline-hidden"
                  />
                </div>

                {canViewAccessoryPrices() && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">سعر الوحدة (ج.م)</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={addForm.pricePerUnit}
                      onChange={(e) => setAddForm({ ...addForm, pricePerUnit: Number(e.target.value) })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 font-bold focus:outline-hidden"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">المورد المعتمد</label>
                <select
                  value={addForm.supplierId}
                  onChange={(e) => setAddForm({ ...addForm, supplierId: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden"
                >
                  <option value="">-- اختر مورد --</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.phone})
                    </option>
                  ))}
                </select>
              </div>

              {/* Image upload / URL */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">صورة الإكسسوار</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageFileUpload}
                  className="w-full text-xs text-slate-500 file:me-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-full"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-full shadow-md shadow-blue-500/20"
                >
                  حفظ الصنف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: PRINT INVENTORY REPORT */}
      {showPrintInventoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between no-print bg-slate-50">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-pink-600 text-white rounded-xl">
                  <Printer className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-900">
                    معاينة تقرير جرد مخزن الإكسسوارات والمستلزمات
                  </h3>
                  <p className="text-xs text-slate-500">كشف جرد مفصل لجميع الأصناف والكميات والوحدات</p>
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
                <button onClick={() => setShowPrintInventoryModal(false)} className="text-slate-400 hover:text-slate-700">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-8 overflow-y-auto space-y-6 print:p-0">
              <div className="border-b-2 border-slate-900 pb-3 flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-black text-slate-900">
                    🏭 نظام إدارة المصنع - كشف جرد مخزن الإكسسوارات
                  </h1>
                  <p className="text-xs text-slate-500 mt-0.5">
                    تاريخ الاستخراج: {new Date().toLocaleString('ar-EG', { hour12: false })}
                  </p>
                </div>
                <div className="text-end text-xs font-bold">
                  إجمالي الأصناف: {accessoryItems.length} | إجمالي الوحدات: {totalQuantitySum}
                </div>
              </div>

              <table className="w-full text-xs text-start border border-slate-200">
                <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-2.5">الصورة</th>
                    <th className="p-2.5">الكود</th>
                    <th className="p-2.5">النوع</th>
                    <th className="p-2.5">اسم الصنف</th>
                    <th className="p-2.5">نوع الاستخدام</th>
                    <th className="p-2.5 text-center">الرصيد الفعلي</th>
                    <th className="p-2.5 text-center">المحجوز</th>
                    <th className="p-2.5 text-center">المتاح</th>
                    <th className="p-2.5 text-center">الوحدة</th>
                    {canViewAccessoryPrices() && <th className="p-2.5 text-center">سعر الوحدة</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {accessoryItems.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="p-2.5">
                        <img
                          src={item.image}
                          alt={item.name}
                          className="w-8 h-8 rounded-lg object-contain bg-slate-50 border p-0.5"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src =
                              'https://images.unsplash.com/photo-1544441893-675973e31985?w=100&auto=format&fit=crop&q=60';
                          }}
                        />
                      </td>
                      <td className="p-2.5 font-mono font-bold text-blue-700">{item.code}</td>
                      <td className="p-2.5 font-semibold text-slate-600">{item.type_name}</td>
                      <td className="p-2.5 font-bold text-slate-900">{item.name}</td>
                      <td className="p-2.5 text-slate-500 text-[11px]">
                        {item.usage_type === 'custom_model' ? `خاص بموديل ${item.custom_model_code}` : 'رصيد مستمر'}
                      </td>
                      <td className="p-2.5 text-center font-black text-slate-900">{item.quantity}</td>
                      <td className="p-2.5 text-center text-amber-700 font-bold">{item.reserved_quantity}</td>
                      <td className="p-2.5 text-center font-bold text-emerald-700">
                        {item.quantity - item.reserved_quantity}
                      </td>
                      <td className="p-2.5 text-center text-slate-500">{item.unit}</td>
                      {canViewAccessoryPrices() && (
                        <td className="p-2.5 text-center font-mono font-bold text-slate-800">
                          {item.price_per_unit || 0} ج.م
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="pt-6 border-t border-slate-200 text-xs text-slate-500 flex justify-between">
                <span>أمين مخزن الإكسسوارات: ______________________</span>
                <span>اعتماد مدير المصنع: ______________________</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: PRINT DEFICIT SHEET FOR PROCUREMENT */}
      {showPrintAlertsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between no-print bg-amber-50">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-amber-500 text-white rounded-xl">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-base text-amber-950">
                    ورقة طلبيات النواقص لعامل المشتريات والموردين
                  </h3>
                  <p className="text-xs text-amber-800">
                    كشف حصر العجز المطلوب شراؤه فوراً طبقاً للكميات المستهدفة والحدود الدنيا
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-5 py-2 rounded-full bg-amber-600 hover:bg-amber-700 text-white font-black text-xs shadow-md transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>طباعة ورقة المشتريات</span>
                </button>
                <button onClick={() => setShowPrintAlertsModal(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Tabs Bar */}
            <div className="px-6 py-2.5 bg-slate-100 border-b border-slate-200 flex items-center gap-2 no-print overflow-x-auto">
              <span className="text-xs font-bold text-slate-500 ms-1">عرض وتصفية التقرير:</span>
              <button
                type="button"
                onClick={() => setModalAlertTab('all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  modalAlertTab === 'all' ? 'bg-amber-600 text-white shadow-xs' : 'bg-white text-slate-700 hover:bg-slate-200'
                }`}
              >
                <span>جميع النواقص</span>
                <span className="px-1.5 py-0.2 bg-black/15 text-[10px] rounded-full font-bold">{lowStockItems.length}</span>
              </button>

              <button
                type="button"
                onClick={() => setModalAlertTab('stock')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  modalAlertTab === 'stock' ? 'bg-amber-600 text-white shadow-xs' : 'bg-white text-slate-700 hover:bg-slate-200'
                }`}
              >
                <span>نواقص الإكسسوارات المستمرة (Stock)</span>
                <span className="px-1.5 py-0.2 bg-black/15 text-[10px] rounded-full font-bold">{stockDeficits.length}</span>
              </button>

              <button
                type="button"
                onClick={() => setModalAlertTab('custom_model')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  modalAlertTab === 'custom_model' ? 'bg-amber-600 text-white shadow-xs' : 'bg-white text-slate-700 hover:bg-slate-200'
                }`}
              >
                <span>نواقص إكسسوارات الموديلات (Model-Specific)</span>
                <span className="px-1.5 py-0.2 bg-black/15 text-[10px] rounded-full font-bold">{modelDeficits.length}</span>
              </button>
            </div>

            <div className="p-8 overflow-y-auto space-y-6 print:p-0">
              <div className="border-b-2 border-amber-500 pb-3 flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-black text-slate-900">
                    🏭 كشف طلبيات ونواقص الإكسسوارات العاجلة (شراء وتوريد)
                  </h1>
                  <p className="text-xs text-slate-500 mt-0.5">
                    تاريخ أمر الشراء: {new Date().toLocaleString('ar-EG', { hour12: false })} • تصنيف: {modalAlertTab === 'stock' ? 'إكسسوارات مستمرة (Stock)' : modalAlertTab === 'custom_model' ? 'إكسسوارات موديلات خاصة' : 'كافة النواقص المستمرة والمخصصة'}
                  </p>
                </div>
                <div className="text-end">
                  <span className="px-3 py-1 bg-amber-100 text-amber-950 rounded-full font-black text-xs border border-amber-300">
                    إجمالي الأصناف: {(modalAlertTab === 'stock' ? stockDeficits : modalAlertTab === 'custom_model' ? modelDeficits : lowStockItems).length} صنف
                  </span>
                </div>
              </div>

              {/* TABLE 1: Stock Deficits */}
              {(modalAlertTab === 'all' || modalAlertTab === 'stock') && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                    <h3 className="font-black text-sm text-slate-900">
                      أولاً: نواقص الإكسسوارات المستمرة (رصيد المخزن العام - Stock)
                    </h3>
                    <span className="text-xs text-slate-500 font-semibold">({stockDeficits.length} صنف دون حد الأمان)</span>
                  </div>

                  {stockDeficits.length > 0 ? (
                    <table className="w-full text-xs text-start border border-slate-200">
                      <thead className="bg-amber-100/70 text-amber-950 font-black border-b border-amber-200">
                        <tr>
                          <th className="p-2.5">م</th>
                          <th className="p-2.5">الصورة</th>
                          <th className="p-2.5">الكود</th>
                          <th className="p-2.5">اسم الإكسسوار</th>
                          <th className="p-2.5">التصنيف</th>
                          <th className="p-2.5 text-center">الرصيد المتاح</th>
                          <th className="p-2.5 text-center">حد الأمان الأدنى</th>
                          <th className="p-2.5 text-center font-black text-rose-800">العجز المطلوب شراؤه</th>
                          <th className="p-2.5">المورد المقترح ورقم الهاتف</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-semibold">
                        {stockDeficits.map(({ item, supplier, available, threshold, deficit }, idx) => (
                          <tr key={item.id} className="hover:bg-amber-50/40">
                            <td className="p-2.5 text-slate-400">{idx + 1}</td>
                            <td className="p-2.5">
                              <img
                                src={item.image}
                                alt={item.name}
                                className="w-8 h-8 rounded-lg object-contain bg-white border p-0.5"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src =
                                    'https://images.unsplash.com/photo-1544441893-675973e31985?w=100&auto=format&fit=crop&q=60';
                                }}
                              />
                            </td>
                            <td className="p-2.5 font-mono font-bold text-blue-700">{item.code}</td>
                            <td className="p-2.5 font-bold text-slate-900">{item.name}</td>
                            <td className="p-2.5 text-slate-600">{item.type_name}</td>
                            <td className="p-2.5 text-center text-slate-700">{available} {item.unit}</td>
                            <td className="p-2.5 text-center text-slate-900 font-bold">{threshold} {item.unit}</td>
                            <td className="p-2.5 text-center font-black text-rose-700 bg-rose-50 text-sm">
                              {deficit} {item.unit}
                            </td>
                            <td className="p-2.5 text-slate-600 text-[11px]">
                              {supplier?.name || 'مورد عام'} {supplier?.phone ? `(${supplier.phone})` : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-xs text-slate-400 py-2 italic">لا توجد نواقص في الإكسسوارات المستمرة (رصيد المخزن في أمان).</p>
                  )}
                </div>
              )}

              {/* TABLE 2: Model-Specific Deficits */}
              {(modalAlertTab === 'all' || modalAlertTab === 'custom_model') && (
                <div className="space-y-3 pt-4 border-t border-slate-200">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-pink-500"></span>
                    <h3 className="font-black text-sm text-slate-900">
                      ثانياً: نواقص إكسسوارات الموديلات المخصصة (حسب تشغيلة الموديل المستهدفة - Model-Specific)
                    </h3>
                    <span className="text-xs text-slate-500 font-semibold">({modelDeficits.length} صنف عجز توريد)</span>
                  </div>

                  {modelDeficits.length > 0 ? (
                    <table className="w-full text-xs text-start border border-slate-200">
                      <thead className="bg-pink-100/70 text-pink-950 font-black border-b border-pink-200">
                        <tr>
                          <th className="p-2.5">م</th>
                          <th className="p-2.5">الصورة</th>
                          <th className="p-2.5">الكود</th>
                          <th className="p-2.5">اسم الإكسسوار</th>
                          <th className="p-2.5">الموديل المخصص</th>
                          <th className="p-2.5 text-center">الكمية الموردة</th>
                          <th className="p-2.5 text-center">الكمية المستهدفة</th>
                          <th className="p-2.5 text-center font-black text-rose-800">العجز المطلوب توريده</th>
                          <th className="p-2.5">المورد ورقم الهاتف</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-semibold">
                        {modelDeficits.map(({ item, supplier, threshold, deficit }, idx) => (
                          <tr key={item.id} className="hover:bg-pink-50/40">
                            <td className="p-2.5 text-slate-400">{idx + 1}</td>
                            <td className="p-2.5">
                              <img
                                src={item.image}
                                alt={item.name}
                                className="w-8 h-8 rounded-lg object-contain bg-white border p-0.5"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src =
                                    'https://images.unsplash.com/photo-1544441893-675973e31985?w=100&auto=format&fit=crop&q=60';
                                }}
                              />
                            </td>
                            <td className="p-2.5 font-mono font-bold text-blue-700">{item.code}</td>
                            <td className="p-2.5 font-bold text-slate-900">{item.name}</td>
                            <td className="p-2.5 font-black text-pink-700">موديل {item.custom_model_code || 'خاص'}</td>
                            <td className="p-2.5 text-center text-slate-700">{item.delivered_quantity ?? item.quantity} {item.unit}</td>
                            <td className="p-2.5 text-center text-slate-900 font-bold">{threshold} {item.unit}</td>
                            <td className="p-2.5 text-center font-black text-rose-700 bg-rose-50 text-sm">
                              {deficit} {item.unit}
                            </td>
                            <td className="p-2.5 text-slate-600 text-[11px]">
                              {supplier?.name || 'مورد عام'} {supplier?.phone ? `(${supplier.phone})` : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-xs text-slate-400 py-2 italic">لا توجد نواقص في إكسسوارات الموديلات المخصصة.</p>
                  )}
                </div>
              )}

              <div className="pt-6 border-t border-slate-200 text-xs text-slate-500 flex justify-between">
                <span>توقيع مسؤول المشتريات: ______________________</span>
                <span>اعتماد مدير الإنتاج: ______________________</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: TRANSACTION (DEDUCT / ADD) */}
      {showTransactionModal && activeItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-extrabold text-sm text-slate-900">
                تسجيل حركة: {activeItem.name} ({activeItem.code})
              </h3>
              <button onClick={() => setShowTransactionModal(false)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmTransaction} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTransForm({ ...transForm, operation: 'deduct' })}
                  className={`py-2 text-xs font-bold rounded-xl border ${
                    transForm.operation === 'deduct' ? 'bg-rose-50 border-rose-400 text-rose-700' : 'bg-slate-50'
                  }`}
                >
                  صرف للتشغيل
                </button>
                <button
                  type="button"
                  onClick={() => setTransForm({ ...transForm, operation: 'add' })}
                  className={`py-2 text-xs font-bold rounded-xl border ${
                    transForm.operation === 'add' ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : 'bg-slate-50'
                  }`}
                >
                  إضافة / توريد (+)
                </button>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الكمية ({activeItem.unit}) *</label>
                <input
                  type="number"
                  min="0.1"
                  step="any"
                  required
                  value={transForm.amount}
                  onChange={(e) => setTransForm({ ...transForm, amount: Number(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-xl font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">رقم الموديل / إذن الصرف</label>
                <input
                  type="text"
                  placeholder="مثال: M-101"
                  value={transForm.modelCodeRef}
                  onChange={(e) => setTransForm({ ...transForm, modelCodeRef: e.target.value })}
                  className="w-full px-3 py-2 border rounded-xl text-xs"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowTransactionModal(false)}
                  className="flex-1 py-2 text-xs font-bold bg-slate-100 rounded-xl"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 text-xs font-bold text-white bg-blue-600 rounded-xl shadow-xs"
                >
                  تأكيد الحركة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: REORDER / WHATSAPP ORDER MODAL */}
      {reorderItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-extrabold text-base text-slate-900">
                طلب توريد: {reorderItem.item.name} ({reorderItem.item.code})
              </h3>
              <button onClick={() => setReorderItem(null)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 p-3 rounded-2xl border text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">المورد المعتمد:</span>
                <strong className="text-slate-900">{reorderItem.supplier?.name || 'مورد عام'}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">الرصيد المتاح حالياً:</span>
                <strong className="text-rose-700 font-bold">{reorderItem.available} {reorderItem.item.unit}</strong>
              </div>
            </div>

            <form onSubmit={handleConfirmReorderReceive} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  الكمية المطلوبة للتوريد ({reorderItem.item.unit}) *
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={reorderQty}
                  onChange={(e) => setReorderQty(Number(e.target.value))}
                  className="w-full px-3 py-2 border rounded-xl font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات الطلبية</label>
                <input
                  type="text"
                  placeholder="ملاحظات للمورد..."
                  value={reorderNotes}
                  onChange={(e) => setReorderNotes(e.target.value)}
                  className="w-full px-3 py-2 border rounded-xl text-xs"
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs"
                >
                  تأكيد استلام التوريد وإضافته للرصيد (+)
                </button>

                {canSendWhatsApp() && (
                  <button
                    type="button"
                    onClick={handleCopyWhatsappText}
                    className="py-2.5 px-4 bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black rounded-xl shadow-xs flex items-center justify-center gap-1.5"
                  >
                    <MessageCircle className="w-4 h-4" />
                    <span>{copiedOrder ? 'تم نسخ الرسالة!' : 'إرسال واتساب'}</span>
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
