import React, { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api/client';
import {
  Sparkles,
  Plus,
  FileSpreadsheet,
  ArrowUpDown,
  X,
  AlertTriangle,
  ShoppingCart,
  MessageCircle,
  ChevronDown,
  ChevronUp,
  Search,
  Image as ImageIcon,
  Upload,
  FolderPlus,
  Trash2,
  Printer,
  PackageCheck,
  Pencil,
  ClipboardList,
  CheckCircle2,
  Layers
} from 'lucide-react';
import { AccessoryItem, AccessoryUnit, AccessoryUsageType, DesignModel, ModelAccessory, Supplier } from '../types';
import {
  escapeHtml,
  isImageLogo,
  logClientPrintAction,
  openUnifiedPrintWindow,
  renderSignatureBar,
  safeImageSrc
} from '../utils/printShared';
import { printAccessoryIssueOrder } from '../utils/printAccessoryIssueOrder';

type PermitGroup = { model: DesignModel; lines: ModelAccessory[] };

const PERMIT_PART_LABELS: Record<string, string> = {
  shirt: 'تيشرت',
  pants: 'بنطلون',
  jacket: 'جاكيت',
  single: 'قطعة واحدة'
};

export const AccessoriesWarehouseView: React.FC = () => {
  const {
    accessoryTypes,
    accessoryItems,
    accessories,
    suppliers,
    hasPermission,
    canSendWhatsApp,
    openWhatsAppOrder,
    addAccessoryType,
    accessoryTransactions,
    models,
    currentUser,
    addAccessoryItem,
    updateAccessoryItem,
    deleteAccessoryItem,
    canViewAccessoryPrices,
    canEditAccessoryPrices,
    recordAccessoryTransaction,
    issueModelAccessories,
    exportAccessoryInventoryCsv,
    exportAccessoryTransactionsCsv,
    markAccessoryWithdrawn,
    formatSupplierWhatsappMessage,
    globalSettings
  } = useApp();

  const canEdit = hasPermission('warehouse', true) || hasPermission('accessories_warehouse', true);

  // Filter & Search states
  const [selectedTypeId, setSelectedTypeId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showLowStockOnly, setShowLowStockOnly] = useState<boolean>(false);

  // Modals state
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [showAddTypeModal, setShowAddTypeModal] = useState<boolean>(false);
  const [showTransactionModal, setShowTransactionModal] = useState<boolean>(false);
  const [showPrintInventoryModal, setShowPrintInventoryModal] = useState<boolean>(false);
  const [showPrintAlertsModal, setShowPrintAlertsModal] = useState<boolean>(false);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);

  // Accessory transaction history filters
  const [historyItemFilter, setHistoryItemFilter] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState<string>('');

  // Alert sidebar state
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [alertSectionTab, setAlertSectionTab] = useState<'all' | 'stock' | 'custom_model'>('all');
  const [modalAlertTab, setModalAlertTab] = useState<'all' | 'stock' | 'custom_model'>('all');

  // Top-level tabs: inventory grid vs. model accessory issue permits (أذونات الصرف).
  const [activeTab, setActiveTab] = useState<'inventory' | 'permits'>('inventory');
  const [permitSearch, setPermitSearch] = useState<string>('');
  const [permitStatusFilter, setPermitStatusFilter] = useState<'pending' | 'issued'>('pending');
  const [permitBusy, setPermitBusy] = useState<string | null>(null);
  const [permitForms, setPermitForms] = useState<
    Record<string, { issuedTo: string; notes: string; quantities: Record<string, number> }>
  >({});

  // Transaction active item
  const [activeItem, setActiveItem] = useState<AccessoryItem | null>(null);
  const [transForm, setTransForm] = useState({
    operation: 'deduct' as 'add' | 'deduct',
    amount: 10,
    modelCodeRef: '',
    notes: ''
  });

  // Edit active item state
  const [editingItem, setEditingItem] = useState<AccessoryItem | null>(null);
  const [editForm, setEditForm] = useState({
    typeId: '',
    code: '',
    name: '',
    image: '',
    unit: 'قطعة' as AccessoryUnit,
    quantity: 0,
    supplierId: '',
    minThreshold: 10,
    usageType: 'stock' as AccessoryUsageType,
    customModelCode: '',
    targetQuantity: 100,
    pricePerUnit: '' as string | number
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

  // New Accessory Form state (dynamic minThreshold + optional price for authorized users)
  const [addForm, setAddForm] = useState({
    typeId: accessoryTypes[0]?.id || '',
    newTypeName: '',
    code: '',
    name: '',
    image: '',
    unit: 'قطعة' as AccessoryUnit,
    quantity: 50,
    supplierId: suppliers[0]?.id || '',
    minThreshold: 10,
    usageType: 'stock' as AccessoryUsageType,
    customModelCode: '',
    targetQuantity: 100,
    pricePerUnit: 0,
    linkToModelAccessories: true,
    linkSection: 'shirt' as 'shirt' | 'pants' | 'jacket' | 'single',
    pieceConsumption: 1
  });

  // New Type Form state
  const [newTypeNameInput, setNewTypeNameInput] = useState<string>('');
  const [newTypeDescInput, setNewTypeDescInput] = useState<string>('');

  // Image upload (Cloudflare R2) state
  const [imageUploading, setImageUploading] = useState<boolean>(false);
  const [imageUploadError, setImageUploadError] = useState<string>('');

  // Calculate low stock / deficit items with custom per-item min_threshold
  const lowStockItems = accessoryItems
    .map((item) => {
      const sup = suppliers.find((s) => s.id === item.supplier_id);
      const available = Number((item.quantity - item.reserved_quantity).toFixed(2));

      // بضاعة الرصيد السابق / المرحّل تُصفّى فقط ولا تُحسب ضمن النواقص أبداً.
      if (item.usage_type === 'carryover') {
        return { item, supplier: sup, available, threshold: 0, deficit: 0, isLow: false };
      }

      if (item.usage_type === 'custom_model') {
        if (item.withdrawn_for_model) {
          return { item, supplier: sup, available, threshold: 0, deficit: 0, isLow: false };
        }
        const targetReq = item.target_quantity ?? item.min_threshold ?? 0;
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
        const threshold = Number(item.min_threshold ?? 0);
        const deficit = Math.max(0, Number((threshold - available).toFixed(3)));
        // حد التنبيه = 0 يعني أن التنبيهات معطّلة لهذا الصنف؛ والنقص الفعلي عند available < threshold فقط.
        const isLow = threshold > 0 && available < threshold;
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
  const stockDeficits = lowStockItems.filter((e) => e.item.usage_type === 'stock');
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

  // Active (non-deleted) models used for linking model-specific accessories.
  const activeModels = useMemo(() => models.filter((m) => !m.is_deleted), [models]);

  // Transaction history rows: filtered by the selected accessory + quick search, newest first.
  const historyTransactions = accessoryTransactions
    .filter((tx) => !historyItemFilter || tx.accessory_id === historyItemFilter)
    .filter((tx) => {
      const q = historySearch.trim().toLowerCase();
      if (!q) return true;
      return (
        (tx.accessory_code || '').toLowerCase().includes(q) ||
        (tx.accessory_name || '').toLowerCase().includes(q) ||
        (tx.model_code_ref || '').toLowerCase().includes(q) ||
        (tx.notes || '').toLowerCase().includes(q)
      );
    })
    .slice()
    .sort((a, b) => {
      const aTime = new Date(String(a.timestamp || '').replace(' ', 'T')).getTime();
      const bTime = new Date(String(b.timestamp || '').replace(' ', 'T')).getTime();
      if (!Number.isNaN(aTime) && !Number.isNaN(bTime) && aTime !== bTime) {
        return bTime - aTime;
      }
      return String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
    });

  const historyFilterItem = historyItemFilter
    ? accessoryItems.find((item) => item.id === historyItemFilter)
    : null;

  // ---------------------------------------------------------------------------
  // أذونات صرف إكسسوارات الموديلات (Model Issue Permits)
  // الإكسسوار يبقى محجوزاً حتى يؤكّد أمين المخزن الصرف الفعلي من هذا التبويب.
  // ---------------------------------------------------------------------------
  const permitGroups = useMemo(() => {
    const pendingByModel: Record<string, PermitGroup> = {};
    const issuedByModel: Record<string, PermitGroup> = {};
    const modelById: Record<string, DesignModel> = {};
    activeModels.forEach((m) => {
      modelById[m.id] = m;
    });

    accessories.forEach((acc) => {
      // البنود غير المرتبطة بصنف بالمخزن لا يمكن صرفها من المخزن.
      if (!acc.accessory_id) return;
      const model = modelById[acc.model_id];
      if (!model) return;
      const bucket = acc.is_issued ? issuedByModel : pendingByModel;
      if (!bucket[model.id]) bucket[model.id] = { model, lines: [] };
      bucket[model.id].lines.push(acc);
    });

    const q = permitSearch.trim().toLowerCase();
    const matches = (group: PermitGroup) => {
      if (!q) return true;
      if (String(group.model.model_code || '').toLowerCase().includes(q)) return true;
      return group.lines.some(
        (line) =>
          String(line.accessory_name || '').toLowerCase().includes(q) ||
          String(line.accessory_code || '').toLowerCase().includes(q)
      );
    };

    const sortByCode = (a: PermitGroup, b: PermitGroup, desc = false) => {
      const cmp = String(a.model.model_code || '').localeCompare(String(b.model.model_code || ''));
      return desc ? -cmp : cmp;
    };

    return {
      pending: Object.values(pendingByModel).filter(matches).sort((a, b) => sortByCode(a, b)),
      issued: Object.values(issuedByModel).filter(matches).sort((a, b) => sortByCode(a, b, true))
    };
  }, [accessories, activeModels, permitSearch]);

  const pendingPermitsCount = permitGroups.pending.length;

  const getPermitForm = (modelId: string) =>
    permitForms[modelId] || { issuedTo: '', notes: '', quantities: {} };

  const setPermitFormField = (
    modelId: string,
    field: 'issuedTo' | 'notes',
    value: string
  ) => {
    setPermitForms((prev) => {
      const current = prev[modelId] || { issuedTo: '', notes: '', quantities: {} };
      return { ...prev, [modelId]: { ...current, [field]: value } };
    });
  };

  const setPermitQuantity = (modelId: string, lineId: string, value: number) => {
    setPermitForms((prev) => {
      const current = prev[modelId] || { issuedTo: '', notes: '', quantities: {} };
      return {
        ...prev,
        [modelId]: {
          ...current,
          quantities: { ...current.quantities, [lineId]: value }
        }
      };
    });
  };

  const resolvePermitQuantity = (modelId: string, line: ModelAccessory): number => {
    const form = getPermitForm(modelId);
    const raw = form.quantities[line.id];
    return raw === undefined ? Number(line.planned_quantity || 0) : Number(raw);
  };

  const handlePrintPermit = (group: PermitGroup, issuedMode: boolean) => {
    const form = getPermitForm(group.model.id);
    const firstLine = group.lines[0];
    printAccessoryIssueOrder({
      siteName: globalSettings?.site_name,
      logo: globalSettings?.logo,
      modelCode: group.model.model_code,
      modelType: group.model.model_type,
      targetQuantity: group.model.target_cut_quantity,
      issuedTo: form.issuedTo || (issuedMode ? firstLine?.issued_to || '' : ''),
      issuedBy:
        (issuedMode ? firstLine?.issued_by || '' : '') || currentUser?.real_name || '',
      date: issuedMode ? firstLine?.issued_at || undefined : undefined,
      lines: group.lines.map((line) => ({
        accessory_name: line.accessory_name,
        accessory_code: line.accessory_code,
        target_type: line.target_type,
        quantity: issuedMode
          ? Number(line.issued_quantity ?? line.planned_quantity ?? 0)
          : resolvePermitQuantity(group.model.id, line),
        unit: line.unit
      })),
      notes: form.notes
    });
  };

  const handleConfirmIssue = async (group: PermitGroup) => {
    const form = getPermitForm(group.model.id);
    const quantities: Record<string, number> = {};
    for (const line of group.lines) {
      quantities[line.id] = resolvePermitQuantity(group.model.id, line);
    }
    setPermitBusy(group.model.id);
    try {
      const res = await issueModelAccessories(group.model.id, {
        issuedTo: form.issuedTo,
        notes: form.notes,
        quantities
      });
      if (res.success) {
        setPermitForms((prev) => {
          const next = { ...prev };
          delete next[group.model.id];
          return next;
        });
      }
    } finally {
      setPermitBusy(null);
    }
  };

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

  const handleOpenEdit = (item: AccessoryItem) => {
    setEditingItem(item);
    setEditForm({
      typeId: item.type_id,
      code: item.code,
      name: item.name,
      image: item.image || '',
      unit: item.unit,
      quantity: item.quantity,
      supplierId: item.supplier_id || '',
      minThreshold: Number(item.min_threshold ?? 0),
      usageType: item.usage_type || 'stock',
      customModelCode: item.custom_model_code || '',
      targetQuantity: Number(item.target_quantity ?? item.min_threshold ?? 0),
      // عند غياب صلاحية رؤية السعر تكون القيمة null: نتركها فارغة حتى لا نُصفّر السعر بالخطأ.
      pricePerUnit:
        item.price_per_unit !== null && item.price_per_unit !== undefined
          ? String(item.price_per_unit)
          : ''
    });
    setShowEditModal(true);
  };

  const handleConfirmEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;

    const matchedType = accessoryTypes.find((t) => t.id === editForm.typeId);
    const isCustom = editForm.usageType === 'custom_model';
    const isCarryover = editForm.usageType === 'carryover';
    // الرصيد السابق/المرحّل: لا حد تنبيه ولا بيانات موديل مخصص.
    const nextThreshold = isCarryover ? 0 : Math.max(0, Number(editForm.minThreshold));
    const nextTarget = isCarryover
      ? 0
      : isCustom
      ? Math.max(0, Number(editForm.targetQuantity))
      : nextThreshold;
    const rawPriceStr = String(editForm.pricePerUnit ?? '').trim();
    const parsedPrice = rawPriceStr !== '' ? Number(rawPriceStr) : NaN;

    updateAccessoryItem(editingItem.id, {
      type_id: editForm.typeId,
      type_name: matchedType?.name || editingItem.type_name,
      code: editForm.code.trim().toUpperCase(),
      name: editForm.name.trim(),
      image: editForm.image,
      unit: editForm.unit,
      quantity: Math.max(0, Number(editForm.quantity)),
      supplier_id: editForm.supplierId,
      min_threshold: nextThreshold,
      usage_type: editForm.usageType,
      custom_model_code: isCarryover ? '' : isCustom ? editForm.customModelCode.trim() : '',
      target_quantity: nextTarget,
      ...(isCarryover ? { delivered_quantity: 0, withdrawn_for_model: false } : {}),
      ...(canEditAccessoryPrices() && Number.isFinite(parsedPrice) && parsedPrice >= 0
        ? { price_per_unit: parsedPrice }
        : {})
    });

    setShowEditModal(false);
    setEditingItem(null);
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
      supplierName: supplierName || 'حضرة المورد',
      itemName: `${item.type_name} - ${item.name}`,
      code: item.code,
      quantity: qty,
      unit: item.unit,
      available: item.quantity,
      modelCode: isCustom ? item.custom_model_code : undefined
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
    if (reorderItem.supplier) {
      openWhatsAppOrder(
        reorderItem.supplier.phone,
        reorderItem.supplier.whatsapp_group_link,
        text
      );
    }
  };

  const handleDirectWhatsapp = (item: AccessoryItem, qty: number, sup?: Supplier) => {
    const text = generateWhatsappText(item, qty, sup?.name);
    openWhatsAppOrder(sup?.phone, sup?.whatsapp_group_link, text);
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

    let targetTypeId = addForm.typeId || accessoryTypes[0]?.id || 'type-1';
    if (addForm.newTypeName.trim()) {
      targetTypeId = addAccessoryType(addForm.newTypeName.trim());
    }
    if (!targetTypeId) return;

    const isCarryover = addForm.usageType === 'carryover';
    // الرصيد السابق/المرحّل: لا حد تنبيه ولا بيانات موديل مخصص.
    const minThresh = isCarryover ? 0 : Math.max(0, Number(addForm.minThreshold));
    const targetQty = isCarryover
      ? 0
      : addForm.usageType === 'custom_model'
      ? Math.max(0, Number(addForm.targetQuantity))
      : minThresh;
    const cleanModelCode = isCarryover ? '' : addForm.customModelCode.trim();
    const linkedModel =
      addForm.usageType === 'custom_model'
        ? activeModels.find((m) => m.model_code === cleanModelCode)
        : undefined;

    const res = addAccessoryItem({
      type_id: targetTypeId,
      code: addForm.code,
      name: addForm.name,
      image: addForm.image,
      unit: addForm.unit,
      quantity: Number(addForm.quantity),
      price_per_unit: canEditAccessoryPrices()
        ? Math.max(0, Number(addForm.pricePerUnit) || 0)
        : 0,
      supplier_id: addForm.supplierId,
      min_threshold: minThresh,
      usage_type: addForm.usageType,
      custom_model_code: cleanModelCode,
      target_quantity: targetQty,
      delivered_quantity: isCarryover ? 0 : Number(addForm.quantity),
      // يرتبط الإكسسوار بجدول إكسسوارات الموديل بعد نجاح الإنشاء في الباك إند
      // (في AppContext) حتى يُلتقط سعر الوحدة وتُحدَّث الكميات المحجوزة بشكل صحيح.
      ...(addForm.usageType === 'custom_model' &&
      addForm.linkToModelAccessories &&
      linkedModel
        ? {
            link_model: {
              modelId: linkedModel.id,
              target_type: addForm.linkSection,
              piece_consumption: Math.max(0, Number(addForm.pieceConsumption) || 1),
              ...(targetQty > 0 ? { planned_quantity: Math.round(targetQty) } : {})
            }
          }
        : {})
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
        supplierId: suppliers[0]?.id || '',
        minThreshold: 10,
        usageType: 'stock',
        customModelCode: '',
        targetQuantity: 100,
        pricePerUnit: 0,
        linkToModelAccessories: true,
        linkSection: 'shirt',
        pieceConsumption: 1
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

  const handleImageFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    isEdit: boolean = false
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setImageUploadError('');
    setImageUploading(true);
    try {
      const uploaded = await api.uploadImage(file, 'accessories');
      if (isEdit) {
        setEditForm((prev) => ({ ...prev, image: uploaded.url }));
      } else {
        setAddForm((prev) => ({ ...prev, image: uploaded.url }));
      }
    } catch (err: any) {
      setImageUploadError(err?.message || 'فشل رفع صورة الإكسسوار. يرجى المحاولة مرة أخرى.');
    } finally {
      setImageUploading(false);
    }
  };

  const visiblePermitGroups =
    permitStatusFilter === 'pending' ? permitGroups.pending : permitGroups.issued;
  const permitIssuedMode = permitStatusFilter === 'issued';

  const handlePrintAccessoriesInventory = () => {
    logClientPrintAction(
      'مخزن الإكسسوارات',
      'طباعة تقرير جرد مخزن الإكسسوارات والمستلزمات',
      'جرد الإكسسوارات'
    );
    const showPrices = canViewAccessoryPrices();
    const totalQty = accessoryItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const totalReserved = accessoryItems.reduce((sum, item) => sum + Number(item.reserved_quantity || 0), 0);
    const totalAvailable = totalQty - totalReserved;
    const totalValue = accessoryItems.reduce(
      (sum, item) => sum + Number(item.price_per_unit || 0) * Number(item.quantity || 0),
      0
    );

    const rowsHtml = accessoryItems
      .map((item, idx) => {
        const imgSrc = safeImageSrc(item.image);
        const usageLabel =
          item.usage_type === 'custom_model'
            ? `خاص بموديل ${item.custom_model_code || ''}`
            : item.usage_type === 'carryover'
            ? 'رصيد سابق / مرحّل'
            : 'رصيد مستمر';
        const thresholdLabel =
          item.usage_type === 'custom_model'
            ? String(item.target_quantity ?? item.min_threshold ?? 0)
            : item.usage_type === 'carryover' || Number(item.min_threshold ?? 0) <= 0
            ? '0 (ملغي)'
            : String(item.min_threshold ?? 0);
        const avail = Number(item.quantity || 0) - Number(item.reserved_quantity || 0);
        const rowValue = Number((Number(item.price_per_unit || 0) * Number(item.quantity || 0)).toFixed(2));

        return `<tr>
          <td class="num muted">${idx + 1}</td>
          <td>${
            imgSrc
              ? `<img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(item.name)}" class="acc-thumb" onerror="this.style.display='none'" />`
              : '<span class="muted">—</span>'
          }</td>
          <td class="mono"><strong>${escapeHtml(item.code)}</strong></td>
          <td>${escapeHtml(item.type_name || '—')}</td>
          <td class="text-right"><strong>${escapeHtml(item.name)}</strong></td>
          <td class="text-right">${escapeHtml(usageLabel)}</td>
          <td class="num"><strong>${Number(item.quantity || 0).toLocaleString('ar-EG')}</strong></td>
          <td class="num">${Number(item.reserved_quantity || 0).toLocaleString('ar-EG')}</td>
          <td class="num ${avail <= 0 ? 'bad' : 'ok'}">${avail.toLocaleString('ar-EG')}</td>
          <td class="num">${escapeHtml(thresholdLabel)}</td>
          <td>${escapeHtml(item.unit || 'قطعة')}</td>
          ${
            showPrices
              ? `<td class="num">${Number(item.price_per_unit || 0).toLocaleString('ar-EG')}</td>
                 <td class="num ok">${rowValue.toLocaleString('ar-EG')}</td>`
              : ''
          }
        </tr>`;
      })
      .join('');

    const bodyHtml = `
      <div class="p-kpis">
        <div class="p-kpi"><span class="p-kpi-label">إجمالي الأصناف</span><span class="p-kpi-val">${accessoryItems.length.toLocaleString('ar-EG')}</span></div>
        <div class="p-kpi"><span class="p-kpi-label">إجمالي الرصيد الفعلي</span><span class="p-kpi-val">${Math.round(totalQty).toLocaleString('ar-EG')}</span></div>
        <div class="p-kpi"><span class="p-kpi-label">إجمالي المحجوز</span><span class="p-kpi-val warn">${Math.round(totalReserved).toLocaleString('ar-EG')}</span></div>
        <div class="p-kpi"><span class="p-kpi-label">إجمالي المتاح</span><span class="p-kpi-val ok">${Math.round(totalAvailable).toLocaleString('ar-EG')}</span></div>
        ${
          showPrices
            ? `<div class="p-kpi"><span class="p-kpi-label">إجمالي قيمة المخزون</span><span class="p-kpi-val ok">${Math.round(totalValue).toLocaleString('ar-EG')} ج.م</span></div>`
            : ''
        }
      </div>

      <table class="acc-inv-table">
        <thead>
          <tr>
            <th style="width:3%">#</th>
            <th style="width:5%">الصورة</th>
            <th style="width:9%">الكود</th>
            <th style="width:9%">النوع</th>
            <th class="text-right" style="width:17%">اسم الصنف</th>
            <th class="text-right" style="width:13%">نوع الاستخدام</th>
            <th>الرصيد الفعلي</th>
            <th>المحجوز</th>
            <th>المتاح</th>
            <th>حد التنبيه / المطلوب</th>
            <th>الوحدة</th>
            ${showPrices ? '<th>سعر الوحدة</th><th>قيمة الرصيد</th>' : ''}
          </tr>
        </thead>
        <tbody>${rowsHtml || `<tr><td colspan="${showPrices ? 13 : 11}" class="muted">لا توجد أصناف إكسسوارات مسجلة.</td></tr>`}</tbody>
        <tfoot>
          <tr class="total">
            <td colspan="6" class="text-right">الإجمالي</td>
            <td class="num">${Math.round(totalQty).toLocaleString('ar-EG')}</td>
            <td class="num">${Math.round(totalReserved).toLocaleString('ar-EG')}</td>
            <td class="num">${Math.round(totalAvailable).toLocaleString('ar-EG')}</td>
            <td colspan="2"></td>
            ${showPrices ? `<td>—</td><td class="num">${Math.round(totalValue).toLocaleString('ar-EG')} ج.م</td>` : ''}
          </tr>
        </tfoot>
      </table>

      ${renderSignatureBar(['أمين مخزن الإكسسوارات', 'المراجعة والجرد', 'اعتماد مدير المصنع'], true)}
    `;

    openUnifiedPrintWindow({
      documentTitle: 'كشف جرد مخزن الإكسسوارات والمستلزمات',
      mode: 'multi-page-table',
      orientation: 'landscape',
      header: {
        siteName: globalSettings?.site_name,
        logo: globalSettings?.logo,
        title: 'كشف جرد مخزن الإكسسوارات والمستلزمات',
        subtitle: 'جرد شامل لجميع أصناف الإكسسوارات والكميات الفعلية والمحجوزة والمتاحة',
        metaItems: [`عدد الأصناف: ${accessoryItems.length.toLocaleString('ar-EG')}`]
      },
      bodyHtml,
      extraCss: `
        .acc-thumb { width: 24px; height: 24px; object-fit: contain; border: 1px solid #cbd5e1; border-radius: 3px; background: #fff; display: block; margin: 0 auto; }
        table.acc-inv-table { font-size: ${showPrices ? '8.8px' : '9.3px'}; }
        table.acc-inv-table th, table.acc-inv-table td { padding: 3px 4px; }
      `,
      popupBlockedMessage: 'يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة كشف جرد الإكسسوارات.'
    });
  };

  const handlePrintAccessoriesAlerts = () => {
    logClientPrintAction(
      'مخزن الإكسسوارات',
      'طباعة ورقة طلبيات نواقص الإكسسوارات للمشتريات',
      'نواقص الإكسسوارات'
    );
    const scopeLabel =
      modalAlertTab === 'stock'
        ? 'إكسسوارات مستمرة (Stock)'
        : modalAlertTab === 'custom_model'
        ? 'إكسسوارات موديلات خاصة'
        : 'كافة النواقص المستمرة والمخصصة';

    const stockSection =
      modalAlertTab === 'all' || modalAlertTab === 'stock'
        ? `<div class="p-sec">أولاً: نواقص الإكسسوارات المستمرة (رصيد المخزن العام — ${stockDeficits.length} صنف دون حد التنبيه)</div>
          ${
            stockDeficits.length > 0
              ? `<table>
                  <thead>
                    <tr>
                      <th style="width:4%">م</th>
                      <th style="width:6%">الصورة</th>
                      <th style="width:10%">الكود</th>
                      <th class="text-right" style="width:20%">اسم الإكسسوار</th>
                      <th style="width:10%">التصنيف</th>
                      <th style="width:11%">الرصيد المتاح</th>
                      <th style="width:11%">حد التنبيه</th>
                      <th style="width:12%">العجز المطلوب شراؤه</th>
                      <th class="text-right" style="width:16%">المورد المقترح والهاتف</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${stockDeficits
                      .map(({ item, supplier, available, threshold, deficit }, idx) => {
                        const imgSrc = safeImageSrc(item.image);
                        return `<tr>
                          <td class="num muted">${idx + 1}</td>
                          <td>${
                            imgSrc
                              ? `<img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(item.name)}" class="acc-thumb" onerror="this.style.display='none'" />`
                              : '—'
                          }</td>
                          <td class="mono"><strong>${escapeHtml(item.code)}</strong></td>
                          <td class="text-right"><strong>${escapeHtml(item.name)}</strong></td>
                          <td>${escapeHtml(item.type_name || '—')}</td>
                          <td class="num">${available} ${escapeHtml(item.unit)}</td>
                          <td class="num"><strong>${threshold} ${escapeHtml(item.unit)}</strong></td>
                          <td class="num bad"><strong>${deficit} ${escapeHtml(item.unit)}</strong></td>
                          <td class="text-right">${escapeHtml(supplier?.name || 'مورد عام')}${
                            supplier?.phone ? ` (${escapeHtml(supplier.phone)})` : ''
                          }</td>
                        </tr>`;
                      })
                      .join('')}
                  </tbody>
                </table>`
              : '<p class="muted">لا توجد نواقص في الإكسسوارات المستمرة.</p>'
          }`
        : '';

    const modelSection =
      modalAlertTab === 'all' || modalAlertTab === 'custom_model'
        ? `<div class="p-sec">ثانياً: نواقص إكسسوارات الموديلات المخصصة (Model-Specific — ${modelDeficits.length} صنف)</div>
          ${
            modelDeficits.length > 0
              ? `<table>
                  <thead>
                    <tr>
                      <th style="width:4%">م</th>
                      <th style="width:6%">الصورة</th>
                      <th style="width:10%">الكود</th>
                      <th class="text-right" style="width:20%">اسم الإكسسوار</th>
                      <th style="width:11%">الموديل المخصص</th>
                      <th style="width:10%">الكمية الموردة</th>
                      <th style="width:11%">الكمية المستهدفة</th>
                      <th style="width:12%">العجز المطلوب توريده</th>
                      <th class="text-right" style="width:16%">المورد ورقم الهاتف</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${modelDeficits
                      .map(({ item, supplier, threshold, deficit }, idx) => {
                        const imgSrc = safeImageSrc(item.image);
                        return `<tr>
                          <td class="num muted">${idx + 1}</td>
                          <td>${
                            imgSrc
                              ? `<img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(item.name)}" class="acc-thumb" onerror="this.style.display='none'" />`
                              : '—'
                          }</td>
                          <td class="mono"><strong>${escapeHtml(item.code)}</strong></td>
                          <td class="text-right"><strong>${escapeHtml(item.name)}</strong></td>
                          <td><strong>موديل ${escapeHtml(item.custom_model_code || 'خاص')}</strong></td>
                          <td class="num">${item.delivered_quantity ?? item.quantity} ${escapeHtml(item.unit)}</td>
                          <td class="num"><strong>${threshold} ${escapeHtml(item.unit)}</strong></td>
                          <td class="num bad"><strong>${deficit} ${escapeHtml(item.unit)}</strong></td>
                          <td class="text-right">${escapeHtml(supplier?.name || 'مورد عام')}${
                            supplier?.phone ? ` (${escapeHtml(supplier.phone)})` : ''
                          }</td>
                        </tr>`;
                      })
                      .join('')}
                  </tbody>
                </table>`
              : '<p class="muted">لا توجد نواقص في إكسسوارات الموديلات المخصصة.</p>'
          }`
        : '';

    const bodyHtml = `
      ${stockSection}
      ${modelSection}
      ${renderSignatureBar(['أمين مخزن الإكسسوارات', 'مسؤول المشتريات', 'اعتماد مدير الإنتاج'], true)}
    `;

    openUnifiedPrintWindow({
      documentTitle: 'كشف طلبيات ونواقص الإكسسوارات العاجلة',
      mode: 'multi-page-table',
      orientation: 'landscape',
      header: {
        siteName: globalSettings?.site_name,
        logo: globalSettings?.logo,
        title: 'كشف طلبيات ونواقص الإكسسوارات العاجلة (شراء وتوريد)',
        subtitle: `التصنيف: ${scopeLabel}`,
        metaItems: [`إجمالي النواقص: ${lowStockItems.length.toLocaleString('ar-EG')} صنف`]
      },
      bodyHtml,
      extraCss: `
        .acc-thumb { width: 24px; height: 24px; object-fit: contain; border: 1px solid #cbd5e1; border-radius: 3px; background: #fff; display: block; margin: 0 auto; }
      `,
      popupBlockedMessage: 'يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة ورقة النواقص.'
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Tabs: Inventory grid vs. Model Issue Permits (أذونات صرف الموديلات) */}
      <div className="flex items-center gap-2 bg-white rounded-2xl p-1.5 border border-slate-200/80 shadow-xs w-full sm:w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('inventory')}
          className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer ${
            activeTab === 'inventory'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>جرد المخزن</span>
          <span
            className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
              activeTab === 'inventory'
                ? 'bg-white/20 text-white'
                : 'bg-slate-200 text-slate-700'
            }`}
          >
            {totalItemsCount}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('permits')}
          className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer ${
            activeTab === 'permits'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ClipboardList className="w-4 h-4" />
          <span>أذونات صرف الموديلات</span>
          <span
            className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
              activeTab === 'permits'
                ? 'bg-white/20 text-white'
                : 'bg-amber-100 text-amber-800'
            }`}
          >
            {pendingPermitsCount}
          </span>
        </button>
      </div>

      {activeTab === 'inventory' && (
        <>
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
                  حساب دقيق للنواقص حسب حد التنبيه المخصص لكل صنف. يمكنك طباعة ورقة النواقص لعامل المشتريات أو طلبها مباشرة عبر واتساب.
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
                              المتاح: <strong className="text-rose-700">{available}</strong> من حد التنبيه ({threshold}) | عجز: <strong>{deficit}</strong> {item.unit}
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
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(item)}
                              className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold rounded-lg transition flex items-center gap-1 cursor-pointer"
                              title="تعديل حد التنبيه أو بيانات الصنف"
                            >
                              <Pencil className="w-3 h-3" />
                              <span>تعديل</span>
                            </button>
                          )}

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
              إدارة كميات وأنواع مستلزمات الإنتاج (بادجات، ورود، دانتيل، سوست، تيكت) بأصناف رصيد مستمر أو استخدام مخصص لموديل معين.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setHistoryItemFilter(null);
                setHistorySearch('');
                setShowHistoryModal(true);
              }}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-full shadow-xs transition cursor-pointer"
              title="عرض سجل جميع حركات الإكسسوارات (توريد وصرف)"
            >
              <span>📜 سجل حركات الإكسسوارات</span>
            </button>

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
              <span>📊 تصدير Excel (الجرد)</span>
            </button>

            <button
              type="button"
              onClick={exportAccessoryTransactionsCsv}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-full transition shadow-xs cursor-pointer"
              title="تصدير حركات الإكسسوارات"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>📊 تصدير Excel (الحركات)</span>
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

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setShowLowStockOnly((prev) => !prev)}
              className={`px-3 py-1.5 rounded-full text-xs font-black transition shrink-0 border cursor-pointer ${
                showLowStockOnly
                  ? 'bg-amber-500 text-slate-950 border-amber-600 shadow-xs'
                  : 'bg-white text-amber-900 border-amber-300 hover:bg-amber-50'
              }`}
              title="عرض الأصناف التي وصلت إلى حد التنبيه أو أقل فقط"
            >
              ⚠️ النواقص فقط ({lowStockCount})
            </button>

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
      </div>

      {/* Main Accessories Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {filteredAccessories.map((item) => {
          const supplier = suppliers.find((s) => s.id === item.supplier_id);
          const available = Number((item.quantity - item.reserved_quantity).toFixed(2));
          const isCustom = item.usage_type === 'custom_model';
          const isCarryover = item.usage_type === 'carryover';
          const threshold = Number(item.min_threshold ?? 0);
          const isLow =
            !isCarryover &&
            (isCustom
              ? !item.withdrawn_for_model &&
                (item.target_quantity ?? threshold) > (item.delivered_quantity ?? item.quantity)
              : threshold > 0 && available <= threshold);

          return (
            <div
              key={item.id}
              className={`bg-white rounded-3xl border transition overflow-hidden flex flex-col justify-between group ${
                isLow ? 'border-amber-300 ring-2 ring-amber-400/20' : 'border-slate-200 shadow-xs hover:shadow-md'
              }`}
            >
              <div>
                <div className="h-40 w-full overflow-hidden bg-slate-100 border-b border-slate-100 relative">
                  {item.image ? (
                    <img
                      src={item.image}
                      alt={item.name}
                      className="w-full h-full object-contain bg-white p-2 group-hover:scale-105 transition-transform duration-300"
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
                    {isCarryover && (
                      <span className="px-2 py-0.5 text-[10px] font-black bg-slate-500 text-white rounded-md shadow-2xs">
                        📦 رصيد سابق / مرحّل
                      </span>
                    )}
                  </div>

                  {canEdit && (
                    <div className="absolute top-2 end-2 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(item)}
                        className="p-1.5 bg-blue-600/90 text-white rounded-lg shadow-xs hover:bg-blue-700 transition cursor-pointer"
                        title="تعديل بيانات وحد التنبيه للصنف"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            window.confirm(
                              `هل أنت متأكد من حذف الإكسسوار "${item.name}" (${item.code}) نهائياً من المخزن؟`
                            )
                          ) {
                            deleteAccessoryItem(item.id);
                          }
                        }}
                        className="p-1.5 bg-rose-600/90 text-white rounded-lg shadow-xs hover:bg-rose-700 transition cursor-pointer"
                        title="حذف الصنف"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
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

                  <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-100 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="text-[10px] text-slate-400 block">المتاح للتصميم:</span>
                        <strong className={`text-base font-black ${isLow ? 'text-amber-600' : 'text-slate-900'}`}>
                          {available} {item.unit}
                        </strong>
                      </div>

                      <div className="text-end">
                        <span className="text-[10px] text-slate-400 block">
                          {isCustom ? 'الكمية المستهدفة:' : 'حد التنبيه:'}
                        </span>
                        <div className="flex items-center gap-1 justify-end">
                          <span className="text-xs font-bold text-slate-700">
                            {isCustom
                              ? `${item.target_quantity ?? threshold} ${item.unit}`
                              : isCarryover || threshold <= 0
                              ? 'ملغي (0)'
                              : `${threshold} ${item.unit}`}
                          </span>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(item)}
                              className="text-blue-600 hover:text-blue-800 p-0.5 rounded cursor-pointer"
                              title="تعديل حد التنبيه"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 border-t border-slate-200/70 pt-1.5 text-[10px] font-bold">
                      <span className="text-slate-500">
                        الرصيد الفعلي:{' '}
                        <strong className="text-slate-800">{item.quantity} {item.unit}</strong>
                      </span>
                      <span className="text-slate-500">
                        محجوز للموديلات:{' '}
                        <strong className="text-pink-700">{item.reserved_quantity} {item.unit}</strong>
                      </span>
                    </div>
                  </div>

                  {canViewAccessoryPrices() && (
                    <div className="p-2.5 rounded-2xl bg-emerald-50/70 border border-emerald-200 text-[11px] font-bold text-emerald-900 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span>سعر الوحدة:</span>
                        <strong className="font-black">
                          {Number(item.price_per_unit || 0).toLocaleString('ar-EG')} ج.م
                        </strong>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span>إجمالي قيمة الرصيد:</span>
                        <strong className="font-black">
                          {Number(
                            (
                              Number(item.price_per_unit || 0) * Number(item.quantity || 0)
                            ).toFixed(2)
                          ).toLocaleString('ar-EG')}{' '}
                          ج.م
                        </strong>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="p-3 border-t border-slate-100 grid grid-cols-3 gap-2">
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

                <button
                  type="button"
                  onClick={() => {
                    setHistoryItemFilter(item.id);
                    setHistorySearch('');
                    setShowHistoryModal(true);
                  }}
                  className="py-2 px-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1 cursor-pointer"
                  title="عرض سجل حركات هذا الصنف فقط"
                >
                  <span>📜 الحركات</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
        </>
      )}

      {/* Model Issue Permits Tab (أذونات صرف الموديلات) */}
      {activeTab === 'permits' && (
        <div className="space-y-5">
          <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="p-2 bg-blue-100 text-blue-700 rounded-2xl">
                    <ClipboardList className="w-5 h-5" />
                  </span>
                  <h2 className="text-lg font-black text-slate-900">أذونات صرف إكسسوارات الموديلات</h2>
                  <span className="text-xs font-bold px-2.5 py-0.5 bg-amber-100 text-amber-800 rounded-full border border-amber-200">
                    {permitGroups.pending.length} موديل بانتظار الصرف
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  الإكسسوار يبقى محجوزاً (خارج «المتاح للتصميم») حتى يؤكّد أمين المخزن الصرف الفعلي هنا.
                  يتم خصم الكميات من الرصيد الفعلي وإصدار إذن صرف A4 قابل للطباعة.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
                  <button
                    type="button"
                    onClick={() => setPermitStatusFilter('pending')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                      permitStatusFilter === 'pending'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    بانتظار الصرف ({permitGroups.pending.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPermitStatusFilter('issued')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                      permitStatusFilter === 'issued'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    تم صرفها ({permitGroups.issued.length})
                  </button>
                </div>
                <div className="relative w-full sm:w-60">
                  <Search className="w-4 h-4 text-slate-400 absolute start-3 top-2.5" />
                  <input
                    type="text"
                    value={permitSearch}
                    onChange={(e) => setPermitSearch(e.target.value)}
                    placeholder="بحث بكود الموديل أو اسم الإكسسوار..."
                    className="w-full ps-9 pe-3 py-1.5 bg-slate-50 border border-slate-200 rounded-full text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>
          {visiblePermitGroups.length === 0 ? (
            <div className="bg-white rounded-3xl border border-dashed border-slate-300 p-10 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-black text-slate-800">
                {permitIssuedMode
                  ? 'لا توجد أذونات صرف مؤكّدة بعد.'
                  : 'لا توجد إكسسوارات بانتظار الصرف حالياً.'}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {permitIssuedMode
                  ? 'ستظهر هنا الموديلات التي تم تسليم إكسسواراتها من المخزن.'
                  : 'عند إضافة إكسسوارات لموديل في التصميم سيظهر إذن صرفه هنا تلقائياً.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {visiblePermitGroups.map((group) => {
                const model = group.model;
                const form = getPermitForm(model.id);
                const busy = permitBusy === model.id;
                return (
                  <div
                    key={model.id}
                    className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden flex flex-col"
                  >
                    <div className="p-4 border-b border-slate-100 bg-slate-50/70 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-black bg-slate-900 text-white px-2 py-0.5 rounded-md">
                            {model.model_code}
                          </span>
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                            {model.status || '—'}
                          </span>
                          <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                              permitIssuedMode
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                : 'bg-amber-100 text-amber-800 border-amber-200'
                            }`}
                          >
                            {permitIssuedMode
                              ? 'تم الصرف'
                              : `${group.lines.length} صنف بانتظار الصرف`}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">
                          نوع الموديل:{' '}
                          <strong className="text-slate-700">{model.model_type || '—'}</strong>
                          {' | '}العدد المستهدف:{' '}
                          <strong className="text-slate-700">
                            {Number(model.target_cut_quantity || 0).toLocaleString('ar-EG')}
                          </strong>{' '}
                          قطعة
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handlePrintPermit(group, permitIssuedMode)}
                        className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold rounded-lg transition cursor-pointer"
                        title="طباعة إذن الصرف A4"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>طباعة</span>
                      </button>
                    </div>

                    {!permitIssuedMode && (
                      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 border-b border-slate-100">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">
                            اسم المستلم (اختياري)
                          </label>
                          <input
                            type="text"
                            value={form.issuedTo}
                            onChange={(e) => setPermitFormField(model.id, 'issuedTo', e.target.value)}
                            placeholder="اسم من يستلم الإكسسوارات"
                            className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">
                            ملاحظات (اختياري)
                          </label>
                          <input
                            type="text"
                            value={form.notes}
                            onChange={(e) => setPermitFormField(model.id, 'notes', e.target.value)}
                            placeholder="ملاحظات تُطبع على الإذن"
                            className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                    )}

                    {permitIssuedMode && (
                      <div className="px-4 py-2.5 bg-emerald-50/60 border-b border-emerald-100 text-[11px] font-bold text-emerald-900 flex flex-wrap gap-x-4 gap-y-1">
                        <span>المستلم: {group.lines[0]?.issued_to || '—'}</span>
                        <span>المنفّذ: {group.lines[0]?.issued_by || '—'}</span>
                        <span>التاريخ: {group.lines[0]?.issued_at || '—'}</span>
                      </div>
                    )}

                    <div className="p-4 space-y-2 flex-1">
                      <div className="grid grid-cols-12 gap-2 text-[10px] font-black text-slate-500 px-1">
                        <span className="col-span-5">الإكسسوار</span>
                        <span className="col-span-2 text-center">القسم</span>
                        <span className="col-span-2 text-center">المطلوب</span>
                        <span className="col-span-3 text-center">
                          {permitIssuedMode ? 'المصروف' : 'الكمية للصرف'}
                        </span>
                      </div>

                      {group.lines.map((line) => {
                        const stockItem = line.accessory_id
                          ? accessoryItems.find((it) => it.id === line.accessory_id)
                          : undefined;
                        const stockQty = Number(stockItem?.quantity ?? 0);
                        const required = resolvePermitQuantity(model.id, line);
                        const insufficient = !permitIssuedMode && required > stockQty;
                        const partLabel = PERMIT_PART_LABELS[line.target_type || ''] || 'تيشرت';
                        return (
                          <div
                            key={line.id}
                            className={`grid grid-cols-12 gap-2 items-center rounded-xl border px-2 py-1.5 ${
                              insufficient
                                ? 'border-rose-300 bg-rose-50/60'
                                : 'border-slate-200 bg-slate-50/50'
                            }`}
                          >
                            <div className="col-span-5 min-w-0">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="font-mono text-[10px] bg-slate-200 text-slate-700 px-1 py-0.5 rounded shrink-0">
                                  {line.accessory_code || '—'}
                                </span>
                                <span
                                  className="text-xs font-bold text-slate-800 truncate"
                                  title={line.accessory_name}
                                >
                                  {line.accessory_name}
                                </span>
                              </div>
                              <span
                                className={`text-[10px] font-bold ${
                                  insufficient ? 'text-rose-700' : 'text-slate-500'
                                }`}
                              >
                                رصيد المخزن: {stockQty} {line.unit || 'قطعة'}
                                {insufficient && ' — غير كافٍ'}
                              </span>
                            </div>
                            <div className="col-span-2 text-center">
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-700">
                                {partLabel}
                              </span>
                            </div>
                            <div className="col-span-2 text-center text-xs font-black text-slate-700">
                              {Number(line.planned_quantity || 0)}
                            </div>
                            <div className="col-span-3 flex justify-center">
                              {permitIssuedMode ? (
                                <span className="text-xs font-black text-emerald-700">
                                  {Number(line.issued_quantity ?? line.planned_quantity ?? 0)}{' '}
                                  {line.unit || 'قطعة'}
                                </span>
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={Number.isFinite(required) ? required : 0}
                                  onChange={(e) =>
                                    setPermitQuantity(
                                      model.id,
                                      line.id,
                                      Math.max(0, Number(e.target.value) || 0)
                                    )
                                  }
                                  className="w-20 px-2 py-1 bg-white border border-slate-300 rounded-lg text-xs text-center font-bold focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                                />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {!permitIssuedMode && (
                      <div className="p-3 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2">
                        <div className="text-[11px] font-bold text-slate-600">
                          إجمالي القطع المطلوب صرفها:{' '}
                          <strong className="text-slate-900">
                            {group.lines
                              .reduce(
                                (sum, line) => sum + resolvePermitQuantity(model.id, line),
                                0
                              )
                              .toLocaleString('ar-EG')}
                          </strong>
                        </div>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleConfirmIssue(group)}
                          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-black rounded-xl shadow-xs transition cursor-pointer"
                        >
                          <PackageCheck className="w-4 h-4" />
                          <span>{busy ? 'جارٍ الصرف...' : 'تأكيد الصرف والخصم'}</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODAL 0: ADD ACCESSORY TYPE */}
      {showAddTypeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl w-[95vw] sm:w-full max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6 shadow-2xl border border-slate-200 space-y-4">
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

      {/* MODAL 1: ADD ACCESSORY ITEM (No price fields, dynamic minThreshold) */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl w-[95vw] sm:w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
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
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <label className="flex items-center gap-2 p-2.5 bg-white rounded-xl border border-blue-200 cursor-pointer">
                    <input
                      type="radio"
                      name="usageType"
                      checked={addForm.usageType === 'stock'}
                      onChange={() =>
                        setAddForm({
                          ...addForm,
                          usageType: 'stock',
                          minThreshold: addForm.minThreshold > 0 ? addForm.minThreshold : 10
                        })
                      }
                      className="text-blue-600"
                    />
                    <div>
                      <span className="font-bold text-xs text-slate-900 block">رصيد مستمر (Stock)</span>
                      <span className="text-[10px] text-slate-500">صنف دائم يطلب عند انخفاض حد التنبيه</span>
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

                  <label className="flex items-center gap-2 p-2.5 bg-white rounded-xl border border-blue-200 cursor-pointer">
                    <input
                      type="radio"
                      name="usageType"
                      checked={addForm.usageType === 'carryover'}
                      onChange={() =>
                        setAddForm({ ...addForm, usageType: 'carryover', minThreshold: 0 })
                      }
                      className="text-blue-600"
                    />
                    <div>
                      <span className="font-bold text-xs text-slate-900 block">📦 رصيد سابق / مرحّل</span>
                      <span className="text-[10px] text-slate-500">بضاعة موسم سابق تُصفّى (بدون تنبيهات)</span>
                    </div>
                  </label>
                </div>

                {addForm.usageType === 'custom_model' && (
                  <div className="pt-2 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">الموديل المخصص له *</label>
                        <select
                          required
                          value={addForm.customModelCode}
                          onChange={(e) => {
                            const selectedCode = e.target.value;
                            const selectedModel = activeModels.find(
                              (m) => m.model_code === selectedCode
                            );
                            setAddForm({
                              ...addForm,
                              customModelCode: selectedCode,
                              targetQuantity: selectedModel
                                ? selectedModel.target_cut_quantity || 100
                                : addForm.targetQuantity
                            });
                          }}
                          className="w-full px-3 py-1.5 text-xs bg-white rounded-xl border border-blue-300 focus:outline-hidden"
                        >
                          <option value="">-- اختر الموديل --</option>
                          {activeModels.map((m) => (
                            <option key={m.id} value={m.model_code}>
                              {m.model_code} ({m.model_type || 'موديل'} — الهدف:{' '}
                              {m.target_cut_quantity})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">الكمية المطلوبة للموديل *</label>
                        <input
                          type="number"
                          min="0"
                          required
                          value={addForm.targetQuantity}
                          onChange={(e) => setAddForm({ ...addForm, targetQuantity: Number(e.target.value) })}
                          className="w-full px-3 py-1.5 text-xs bg-white rounded-xl border border-blue-300 focus:outline-hidden font-bold"
                        />
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-white border border-blue-200 space-y-2">
                      <label className="flex items-start gap-2 text-[11px] font-bold text-slate-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={addForm.linkToModelAccessories}
                          onChange={(e) =>
                            setAddForm({
                              ...addForm,
                              linkToModelAccessories: e.target.checked
                            })
                          }
                          className="mt-0.5 text-blue-600"
                        />
                        <span>
                          إضافة هذا الإكسسوار تلقائياً إلى جدول إكسسوارات الموديل في قسم التصميم
                        </span>
                      </label>

                      {addForm.linkToModelAccessories && (
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">القسم المستهدف</label>
                            <select
                              value={addForm.linkSection}
                              onChange={(e) =>
                                setAddForm({
                                  ...addForm,
                                  linkSection: e.target.value as 'shirt' | 'pants' | 'jacket' | 'single'
                                })
                              }
                              className="w-full px-3 py-1.5 text-xs bg-white rounded-xl border border-blue-300 focus:outline-hidden"
                            >
                              <option value="shirt">تيشرت</option>
                              <option value="pants">بنطلون</option>
                              <option value="jacket">جاكيت</option>
                              <option value="single">قطعة واحدة</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">استهلاك القطعة الواحدة</label>
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={addForm.pieceConsumption}
                              onChange={(e) =>
                                setAddForm({
                                  ...addForm,
                                  pieceConsumption: Number(e.target.value)
                                })
                              }
                              className="w-full px-3 py-1.5 text-xs bg-white rounded-xl border border-blue-300 focus:outline-hidden font-bold"
                            />
                          </div>
                        </div>
                      )}

                      {!addForm.customModelCode.trim() && (
                        <p className="text-[10px] font-bold text-amber-700">
                          اختر الموديل أولاً ليتم ربط الإكسسوار بجدول إكسسوارات الموديل تلقائياً.
                        </p>
                      )}
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
                    <option value="كيلو">كيلو</option>
                    <option value="بكرة">بكرة</option>
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

                <div>
                  <label className="block text-xs font-bold text-amber-800 mb-1">حد التنبيه (الأمان)</label>
                  {addForm.usageType === 'carryover' ? (
                    <div className="px-3 py-2 text-xs rounded-xl border border-slate-300 bg-slate-100 font-black text-slate-500">
                      ملغي (0)
                    </div>
                  ) : (
                    <input
                      type="number"
                      min="0"
                      required
                      value={addForm.minThreshold}
                      onChange={(e) => setAddForm({ ...addForm, minThreshold: Number(e.target.value) })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-amber-300 bg-amber-50/40 font-black text-amber-950 focus:outline-hidden"
                    />
                  )}
                </div>
              </div>

              {addForm.usageType === 'stock' && (
                <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 space-y-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Number(addForm.minThreshold) <= 0}
                      onChange={(e) =>
                        setAddForm({ ...addForm, minThreshold: e.target.checked ? 0 : 10 })
                      }
                      className="rounded text-amber-600"
                    />
                    <span className="text-xs font-bold text-amber-950">
                      إلغاء حد تنبيه الأمان (لا تنبهني عند نفاد هذا الصنف)
                    </span>
                  </label>
                  {Number(addForm.minThreshold) <= 0 && (
                    <p className="text-[10px] font-bold text-amber-700">
                      🔕 التنبيهات معطّلة لهذا الصنف لأن حد التنبيه = 0. اكتب رقماً أكبر من صفر لإعادة تفعيلها.
                    </p>
                  )}
                </div>
              )}

              {canEditAccessoryPrices() && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">سعر الوحدة (ج.م)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={addForm.pricePerUnit}
                    onChange={(e) =>
                      setAddForm({ ...addForm, pricePerUnit: Number(e.target.value) })
                    }
                    placeholder="مثال: 12.50"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-emerald-300 bg-emerald-50/40 font-bold text-emerald-950 focus:outline-hidden"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    يُستخدم لحساب قيمة المخزون وتكلفة الإكسسوار داخل الموديل.
                  </p>
                </div>
              )}

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
                <div className="relative border-2 border-dashed border-slate-300 rounded-2xl p-4 text-center hover:bg-slate-50 hover:border-blue-400 transition">
                  <input
                    type="file"
                    accept="image/*"
                    disabled={imageUploading}
                    onChange={(e) => handleImageFileUpload(e, false)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                  />
                  {imageUploading ? (
                    <div className="flex flex-col items-center justify-center py-6 gap-1">
                      <span className="text-xs font-bold text-slate-600">جارٍ رفع الصورة...</span>
                    </div>
                  ) : addForm.image ? (
                    <div className="flex flex-col items-center gap-1">
                      <img
                        src={addForm.image}
                        alt="معاينة صورة الإكسسوار"
                        className="w-28 h-28 object-contain bg-white rounded-xl border border-slate-200 p-1"
                      />
                      <span className="text-[10px] font-bold text-slate-500">اضغط لتغيير الصورة</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-6">
                      <Upload className="w-7 h-7 text-slate-400 mb-1" />
                      <span className="text-xs font-bold text-slate-600">
                        اضغط لرفع صورة الإكسسوار من جهازك
                      </span>
                      <span className="text-[10px] text-slate-400 mt-0.5">PNG أو JPG</span>
                    </div>
                  )}
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-[10px] font-bold text-rose-600">{imageUploadError}</p>
                  {addForm.image && !imageUploading && (
                    <button
                      type="button"
                      onClick={() => setAddForm((prev) => ({ ...prev, image: '' }))}
                      className="text-[10px] font-bold text-rose-600 hover:underline cursor-pointer"
                    >
                      إزالة الصورة
                    </button>
                  )}
                </div>
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
                  disabled={imageUploading}
                  className="px-6 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-full shadow-md shadow-blue-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {imageUploading ? 'جارٍ رفع الصورة...' : 'حفظ الصنف'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 1.5: EDIT ACCESSORY ITEM (Allows editing min_threshold and all non-price fields) */}
      {showEditModal && editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl w-[95vw] sm:w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-600 text-white rounded-xl">
                  <Pencil className="w-5 h-5" />
                </div>
                <h3 className="font-extrabold text-base text-slate-900">
                  تعديل بيانات وحد التنبيه: {editingItem.name}
                </h3>
              </div>
              <button onClick={() => setShowEditModal(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmEdit} className="p-6 overflow-y-auto space-y-4">
              <div className="p-3.5 bg-blue-50/70 rounded-2xl border border-blue-200 space-y-2">
                <label className="block text-xs font-black text-blue-950">نوع استخدام الإكسسوار:</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <label className="flex items-center gap-2 p-2.5 bg-white rounded-xl border border-blue-200 cursor-pointer">
                    <input
                      type="radio"
                      name="editUsageType"
                      checked={editForm.usageType === 'stock'}
                      onChange={() =>
                        setEditForm({
                          ...editForm,
                          usageType: 'stock',
                          minThreshold: editForm.minThreshold > 0 ? editForm.minThreshold : 10
                        })
                      }
                      className="text-blue-600"
                    />
                    <div>
                      <span className="font-bold text-xs text-slate-900 block">رصيد مستمر (Stock)</span>
                      <span className="text-[10px] text-slate-500">صنف دائم يطلب عند انخفاض حد التنبيه</span>
                    </div>
                  </label>

                  <label className="flex items-center gap-2 p-2.5 bg-white rounded-xl border border-blue-200 cursor-pointer">
                    <input
                      type="radio"
                      name="editUsageType"
                      checked={editForm.usageType === 'custom_model'}
                      onChange={() => setEditForm({ ...editForm, usageType: 'custom_model' })}
                      className="text-blue-600"
                    />
                    <div>
                      <span className="font-bold text-xs text-slate-900 block">استخدام واحد لموديل معين</span>
                      <span className="text-[10px] text-slate-500">ينتهي طلبه بمجرد توريد وسحب الكمية</span>
                    </div>
                  </label>

                  <label className="flex items-center gap-2 p-2.5 bg-white rounded-xl border border-blue-200 cursor-pointer">
                    <input
                      type="radio"
                      name="editUsageType"
                      checked={editForm.usageType === 'carryover'}
                      onChange={() =>
                        setEditForm({ ...editForm, usageType: 'carryover', minThreshold: 0 })
                      }
                      className="text-blue-600"
                    />
                    <div>
                      <span className="font-bold text-xs text-slate-900 block">📦 رصيد سابق / مرحّل</span>
                      <span className="text-[10px] text-slate-500">بضاعة موسم سابق تُصفّى (بدون تنبيهات)</span>
                    </div>
                  </label>
                </div>

                {editForm.usageType === 'custom_model' && (
                  <div className="pt-2 grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">كود الموديل المخصص له *</label>
                      <input
                        type="text"
                        required
                        value={editForm.customModelCode}
                        onChange={(e) => setEditForm({ ...editForm, customModelCode: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs bg-white rounded-xl border border-blue-300 focus:outline-hidden"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">الكمية المطلوبة للموديل *</label>
                      <input
                        type="number"
                        min="0"
                        required
                        value={editForm.targetQuantity}
                        onChange={(e) => setEditForm({ ...editForm, targetQuantity: Number(e.target.value) })}
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
                    value={editForm.typeId}
                    onChange={(e) => setEditForm({ ...editForm, typeId: e.target.value })}
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
                  <label className="block text-xs font-bold text-slate-700 mb-1">كود الصنف *</label>
                  <input
                    type="text"
                    required
                    value={editForm.code}
                    onChange={(e) => setEditForm({ ...editForm, code: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 font-mono uppercase focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">اسم الإكسسوار ووصفه *</label>
                <input
                  type="text"
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الوحدة</label>
                  <select
                    value={editForm.unit}
                    onChange={(e) => setEditForm({ ...editForm, unit: e.target.value as AccessoryUnit })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden"
                  >
                    <option value="قطعة">قطعة</option>
                    <option value="دستة">دستة</option>
                    <option value="متر">متر</option>
                    <option value="باكو">باكو</option>
                    <option value="كيس">كيس</option>
                    <option value="كيلو">كيلو</option>
                    <option value="بكرة">بكرة</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الرصيد الفعلي الحالي</label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.quantity}
                    onChange={(e) => setEditForm({ ...editForm, quantity: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 font-bold focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-amber-800 mb-1">حد التنبيه (الأمان)</label>
                  {editForm.usageType === 'carryover' ? (
                    <div className="px-3 py-2 text-xs rounded-xl border border-slate-300 bg-slate-100 font-black text-slate-500">
                      ملغي (0)
                    </div>
                  ) : (
                    <input
                      type="number"
                      min="0"
                      required
                      value={editForm.minThreshold}
                      onChange={(e) => setEditForm({ ...editForm, minThreshold: Number(e.target.value) })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-amber-300 bg-amber-50/40 font-black text-amber-950 focus:outline-hidden"
                    />
                  )}
                </div>
              </div>

              {editForm.usageType === 'stock' && (
                <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 space-y-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Number(editForm.minThreshold) <= 0}
                      onChange={(e) =>
                        setEditForm({ ...editForm, minThreshold: e.target.checked ? 0 : 10 })
                      }
                      className="rounded text-amber-600"
                    />
                    <span className="text-xs font-bold text-amber-950">
                      إلغاء حد تنبيه الأمان (لا تنبهني عند نفاد هذا الصنف)
                    </span>
                  </label>
                  {Number(editForm.minThreshold) <= 0 && (
                    <p className="text-[10px] font-bold text-amber-700">
                      🔕 التنبيهات معطّلة لهذا الصنف لأن حد التنبيه = 0. اكتب رقماً أكبر من صفر لإعادة تفعيلها.
                    </p>
                  )}
                </div>
              )}

              {canEditAccessoryPrices() && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">سعر الوحدة (ج.م)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editForm.pricePerUnit}
                    onChange={(e) =>
                      setEditForm({ ...editForm, pricePerUnit: e.target.value })
                    }
                    placeholder="اتركه فارغاً للإبقاء على السعر الحالي"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-emerald-300 bg-emerald-50/40 font-bold text-emerald-950 focus:outline-hidden"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    تحديث السعر يؤثر على تقييم قيمة المخزون والتقارير المالية فقط.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">المورد المعتمد</label>
                <select
                  value={editForm.supplierId}
                  onChange={(e) => setEditForm({ ...editForm, supplierId: e.target.value })}
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

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">تحديث صورة الإكسسوار</label>
                <div className="relative border-2 border-dashed border-slate-300 rounded-2xl p-4 text-center hover:bg-slate-50 hover:border-blue-400 transition">
                  <input
                    type="file"
                    accept="image/*"
                    disabled={imageUploading}
                    onChange={(e) => handleImageFileUpload(e, true)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                  />
                  {imageUploading ? (
                    <div className="flex flex-col items-center justify-center py-6 gap-1">
                      <span className="text-xs font-bold text-slate-600">جارٍ رفع الصورة...</span>
                    </div>
                  ) : editForm.image ? (
                    <div className="flex flex-col items-center gap-1">
                      <img
                        src={editForm.image}
                        alt="معاينة صورة الإكسسوار"
                        className="w-28 h-28 object-contain bg-white rounded-xl border border-slate-200 p-1"
                      />
                      <span className="text-[10px] font-bold text-slate-500">اضغط لتغيير الصورة</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-6">
                      <Upload className="w-7 h-7 text-slate-400 mb-1" />
                      <span className="text-xs font-bold text-slate-600">
                        اضغط لرفع صورة الإكسسوار من جهازك
                      </span>
                      <span className="text-[10px] text-slate-400 mt-0.5">PNG أو JPG</span>
                    </div>
                  )}
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-[10px] font-bold text-rose-600">{imageUploadError}</p>
                  {editForm.image && !imageUploading && (
                    <button
                      type="button"
                      onClick={() => setEditForm((prev) => ({ ...prev, image: '' }))}
                      className="text-[10px] font-bold text-rose-600 hover:underline cursor-pointer"
                    >
                      إزالة الصورة
                    </button>
                  )}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-full"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={imageUploading}
                  className="px-6 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-full shadow-md shadow-blue-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {imageUploading ? 'جارٍ رفع الصورة...' : 'حفظ التعديلات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 1B: ACCESSORY TRANSACTION HISTORY */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl w-[95vw] sm:w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-indigo-50">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-indigo-600 text-white rounded-xl">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-base text-indigo-950">📜 سجل حركات الإكسسوارات</h3>
                  <p className="text-xs text-indigo-800 font-bold">
                    {historyFilterItem
                      ? `حركات الصنف: ${historyFilterItem.code} — ${historyFilterItem.name}`
                      : 'كل حركات التوريد والصرف المسجلة على مخزن الإكسسوارات'}
                    <span className="mx-1.5">•</span>
                    عدد الحركات: {historyTransactions.length}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => exportAccessoryTransactionsCsv()}
                  className="px-4 py-2 rounded-full bg-white border border-indigo-300 hover:bg-indigo-100 text-indigo-900 font-bold text-xs transition flex items-center gap-1.5 cursor-pointer"
                  title="تصدير سجل الحركات إلى ملف CSV"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>تصدير CSV</span>
                </button>
                <button
                  onClick={() => setShowHistoryModal(false)}
                  className="text-indigo-400 hover:text-indigo-800 cursor-pointer"
                  title="إغلاق"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-4 border-b border-slate-100 bg-slate-50 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-4 h-4 text-slate-400 absolute start-3 top-2.5" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="بحث بالكود، اسم الصنف، مرجع الموديل، أو الملاحظات..."
                  className="w-full ps-9 pe-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {historyItemFilter && (
                <button
                  type="button"
                  onClick={() => setHistoryItemFilter(null)}
                  className="px-3 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-bold transition cursor-pointer"
                >
                  عرض حركات كل الأصناف
                </button>
              )}
            </div>

            <div className="flex-1 overflow-auto p-4">
              {historyTransactions.length === 0 ? (
                <div className="text-center py-12 space-y-2">
                  <p className="text-3xl">📭</p>
                  <p className="text-sm font-black text-slate-800">لا توجد حركات مسجلة</p>
                  <p className="text-xs text-slate-500 font-bold">
                    لم يتم تسجيل أي توريد أو صرف مطابق للفلاتر الحالية.
                  </p>
                </div>
              ) : (
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-slate-100 text-slate-900 font-black">
                    <tr>
                      <th className="border border-slate-200 p-2 text-start">التاريخ والوقت</th>
                      <th className="border border-slate-200 p-2 text-start">الكود</th>
                      <th className="border border-slate-200 p-2 text-start">الصنف</th>
                      <th className="border border-slate-200 p-2 text-center">نوع الحركة</th>
                      <th className="border border-slate-200 p-2 text-center">الكمية</th>
                      <th className="border border-slate-200 p-2 text-center">مرجع الموديل</th>
                      {canViewAccessoryPrices() && (
                        <>
                          <th className="border border-slate-200 p-2 text-center">سعر الوحدة</th>
                          <th className="border border-slate-200 p-2 text-center">قيمة الحركة</th>
                        </>
                      )}
                      <th className="border border-slate-200 p-2 text-start">ملاحظات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyTransactions.map((tx) => {
                      const isAdd = tx.operation === 'add';
                      const snapshot = Number(tx.unit_price_snapshot || 0);
                      const hasSnapshot =
                        tx.unit_price_snapshot !== null && tx.unit_price_snapshot !== undefined;

                      return (
                        <tr key={tx.id} className="hover:bg-slate-50">
                          <td className="border border-slate-200 p-2 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                            {tx.timestamp}
                          </td>
                          <td className="border border-slate-200 p-2 font-mono font-bold text-slate-900 whitespace-nowrap">
                            {tx.accessory_code}
                          </td>
                          <td className="border border-slate-200 p-2 font-bold text-slate-900">
                            {tx.accessory_name}
                          </td>
                          <td className="border border-slate-200 p-2 text-center">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${
                                isAdd
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : 'bg-rose-50 text-rose-800 border-rose-200'
                              }`}
                            >
                              {isAdd ? 'توريد / إضافة' : 'صرف / خصم'}
                            </span>
                          </td>
                          <td
                            className={`border border-slate-200 p-2 text-center font-black ${
                              isAdd ? 'text-emerald-700' : 'text-rose-700'
                            }`}
                          >
                            {isAdd ? '+' : '−'}
                            {Number(tx.amount || 0).toLocaleString('ar-EG')}
                          </td>
                          <td className="border border-slate-200 p-2 text-center font-bold text-slate-700 whitespace-nowrap">
                            {tx.model_code_ref || '—'}
                          </td>
                          {canViewAccessoryPrices() && (
                            <>
                              <td className="border border-slate-200 p-2 text-center font-bold text-slate-900">
                                {hasSnapshot
                                  ? `${snapshot.toLocaleString('ar-EG')} ج.م`
                                  : '—'}
                              </td>
                              <td className="border border-slate-200 p-2 text-center font-black text-emerald-800">
                                {hasSnapshot
                                  ? `${Number(
                                      (snapshot * Number(tx.amount || 0)).toFixed(2)
                                    ).toLocaleString('ar-EG')} ج.م`
                                  : '—'}
                              </td>
                            </>
                          )}
                          <td className="border border-slate-200 p-2 text-slate-600">
                            {tx.notes || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                type="button"
                onClick={() => setShowHistoryModal(false)}
                className="px-6 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-full shadow-md shadow-indigo-500/20 cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: PRINT INVENTORY REPORT */}
      {showPrintInventoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl w-[95vw] sm:w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
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
                  type="button"
                  onClick={handlePrintAccessoriesInventory}
                  className="px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>طباعة الكشف (A4 أفقي)</span>
                </button>
                <button onClick={() => setShowPrintInventoryModal(false)} className="text-slate-400 hover:text-slate-700">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div
              className="p-4 sm:p-8 overflow-auto space-y-6 print:p-0"
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
                    <span className="text-4xl leading-none">{globalSettings?.logo || '🏭'}</span>
                  )}
                </div>
                <h1 className="text-xl font-black text-slate-900">
                  {globalSettings?.site_name || 'مصنع الملابس الجاهزة'} — كشف جرد مخزن
                  الإكسسوارات
                </h1>
                <p className="text-xs text-slate-600 mt-0.5 font-bold">
                  تاريخ الاستخراج: {new Date().toLocaleString('ar-EG', { hour12: false })}
                </p>
              </div>

              <table className="w-full text-xs text-start border-collapse">
                <thead className="bg-slate-100 text-slate-900 font-bold">
                  <tr>
                    <th className="border border-slate-800 p-2.5">الصورة</th>
                    <th className="border border-slate-800 p-2.5">الكود</th>
                    <th className="border border-slate-800 p-2.5">النوع</th>
                    <th className="border border-slate-800 p-2.5">اسم الصنف</th>
                    <th className="border border-slate-800 p-2.5">نوع الاستخدام</th>
                    <th className="border border-slate-800 p-2.5 text-center">الرصيد الفعلي</th>
                    <th className="border border-slate-800 p-2.5 text-center">المحجوز</th>
                    <th className="border border-slate-800 p-2.5 text-center">المتاح</th>
                    <th className="border border-slate-800 p-2.5 text-center">حد التنبيه / المطلوب</th>
                    <th className="border border-slate-800 p-2.5 text-center">الوحدة</th>
                    {canViewAccessoryPrices() && (
                      <>
                        <th className="border border-slate-800 p-2.5 text-center">سعر الوحدة</th>
                        <th className="border border-slate-800 p-2.5 text-center">قيمة الرصيد</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {accessoryItems.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="border border-slate-800 p-2.5">
                        <img
                          src={item.image}
                          alt={item.name}
                          className="w-8 h-8 rounded object-contain bg-slate-50 border border-slate-300 p-0.5"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </td>
                      <td className="border border-slate-800 p-2.5 font-mono font-bold text-slate-900">{item.code}</td>
                      <td className="border border-slate-800 p-2.5 font-semibold text-slate-700">{item.type_name}</td>
                      <td className="border border-slate-800 p-2.5 font-bold text-slate-900">{item.name}</td>
                      <td className="border border-slate-800 p-2.5 text-slate-700 text-[11px]">
                        {item.usage_type === 'custom_model'
                          ? `خاص بموديل ${item.custom_model_code}`
                          : item.usage_type === 'carryover'
                          ? 'رصيد سابق / مرحّل'
                          : 'رصيد مستمر'}
                      </td>
                      <td className="border border-slate-800 p-2.5 text-center font-black text-slate-900">{item.quantity}</td>
                      <td className="border border-slate-800 p-2.5 text-center font-bold text-slate-900">{item.reserved_quantity}</td>
                      <td className="border border-slate-800 p-2.5 text-center font-black text-slate-900">
                        {item.quantity - item.reserved_quantity}
                      </td>
                      <td className="border border-slate-800 p-2.5 text-center font-bold text-slate-900">
                        {item.usage_type === 'custom_model'
                          ? item.target_quantity ?? item.min_threshold
                          : item.usage_type === 'carryover' || Number(item.min_threshold ?? 0) <= 0
                          ? '0 (ملغي)'
                          : item.min_threshold}
                      </td>
                      <td className="border border-slate-800 p-2.5 text-center text-slate-700">{item.unit}</td>
                      {canViewAccessoryPrices() && (
                        <>
                          <td className="border border-slate-800 p-2.5 text-center font-bold text-slate-900">
                            {Number(item.price_per_unit || 0).toLocaleString('ar-EG')}
                          </td>
                          <td className="border border-slate-800 p-2.5 text-center font-black text-emerald-800">
                            {Number(
                              (
                                Number(item.price_per_unit || 0) * Number(item.quantity || 0)
                              ).toFixed(2)
                            ).toLocaleString('ar-EG')}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="pt-6 border-t-2 border-slate-900 text-xs text-slate-700 flex justify-between font-bold">
                <span>أمين مخزن الإكسسوارات: ______________________</span>
                <span>اعتماد مدير المصنع: ______________________</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: PRINT DEFICIT SHEET FOR PROCUREMENT */}
      {showPrintAlertsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl w-[95vw] sm:w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
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
                  type="button"
                  onClick={handlePrintAccessoriesAlerts}
                  className="px-5 py-2 rounded-full bg-amber-600 hover:bg-amber-700 text-white font-black text-xs shadow-md transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>طباعة ورقة المشتريات (A4 أفقي)</span>
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

            <div
              className="p-4 sm:p-8 overflow-auto space-y-6 print:p-0"
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
                    <span className="text-4xl leading-none">{globalSettings?.logo || '🏭'}</span>
                  )}
                </div>
                <h1 className="text-xl font-black text-slate-900">
                  {globalSettings?.site_name || 'مصنع الملابس الجاهزة'} — كشف طلبيات
                  ونواقص الإكسسوارات العاجلة (شراء وتوريد)
                </h1>
                <p className="text-xs text-slate-600 mt-0.5 font-bold">
                  تاريخ أمر الشراء: {new Date().toLocaleString('ar-EG', { hour12: false })} • تصنيف: {modalAlertTab === 'stock' ? 'إكسسوارات مستمرة (Stock)' : modalAlertTab === 'custom_model' ? 'إكسسوارات موديلات خاصة' : 'كافة النواقص المستمرة والمخصصة'}
                </p>
              </div>

              {/* TABLE 1: Stock Deficits */}
              {(modalAlertTab === 'all' || modalAlertTab === 'stock') && (
                <div className="space-y-3">
                  <h3 className="font-black text-sm text-slate-900 bg-slate-100 border border-slate-800 rounded px-2 py-1">
                    أولاً: نواقص الإكسسوارات المستمرة (رصيد المخزن العام - Stock)
                    <span className="text-xs text-slate-600 font-bold"> ({stockDeficits.length} صنف دون حد التنبيه)</span>
                  </h3>

                  {stockDeficits.length > 0 ? (
                    <table className="w-full text-xs text-start border-collapse">
                      <thead className="bg-slate-100 text-slate-900 font-black">
                        <tr>
                          <th className="border border-slate-800 p-2.5">م</th>
                          <th className="border border-slate-800 p-2.5">الصورة</th>
                          <th className="border border-slate-800 p-2.5">الكود</th>
                          <th className="border border-slate-800 p-2.5">اسم الإكسسوار</th>
                          <th className="border border-slate-800 p-2.5">التصنيف</th>
                          <th className="border border-slate-800 p-2.5 text-center">الرصيد المتاح</th>
                          <th className="border border-slate-800 p-2.5 text-center">حد التنبيه المخصص</th>
                          <th className="border border-slate-800 p-2.5 text-center">العجز المطلوب شراؤه</th>
                          <th className="border border-slate-800 p-2.5">المورد المقترح ورقم الهاتف</th>
                        </tr>
                      </thead>
                      <tbody className="font-semibold">
                        {stockDeficits.map(({ item, supplier, available, threshold, deficit }, idx) => (
                          <tr key={item.id} className="hover:bg-slate-50">
                            <td className="border border-slate-800 p-2.5 text-slate-600">{idx + 1}</td>
                            <td className="border border-slate-800 p-2.5">
                              <img
                                src={item.image}
                                alt={item.name}
                                className="w-8 h-8 rounded object-contain bg-white border border-slate-300 p-0.5"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
                              />
                            </td>
                            <td className="border border-slate-800 p-2.5 font-mono font-bold text-slate-900">{item.code}</td>
                            <td className="border border-slate-800 p-2.5 font-bold text-slate-900">{item.name}</td>
                            <td className="border border-slate-800 p-2.5 text-slate-700">{item.type_name}</td>
                            <td className="border border-slate-800 p-2.5 text-center text-slate-700">{available} {item.unit}</td>
                            <td className="border border-slate-800 p-2.5 text-center text-slate-900 font-bold">{threshold} {item.unit}</td>
                            <td className="border border-slate-800 p-2.5 text-center font-black text-slate-900 text-sm">
                              {deficit} {item.unit}
                            </td>
                            <td className="border border-slate-800 p-2.5 text-slate-700 text-[11px]">
                              {supplier?.name || 'مورد عام'} {supplier?.phone ? `(${supplier.phone})` : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-xs text-slate-500 py-2 font-bold">لا توجد نواقص في الإكسسوارات المستمرة (رصيد المخزن في أمان).</p>
                  )}
                </div>
              )}

              {/* TABLE 2: Model-Specific Deficits */}
              {(modalAlertTab === 'all' || modalAlertTab === 'custom_model') && (
                <div className="space-y-3 pt-4 border-t-2 border-slate-900">
                  <h3 className="font-black text-sm text-slate-900 bg-slate-100 border border-slate-800 rounded px-2 py-1">
                    ثانياً: نواقص إكسسوارات الموديلات المخصصة (حسب تشغيلة الموديل المستهدفة - Model-Specific)
                    <span className="text-xs text-slate-600 font-bold"> ({modelDeficits.length} صنف عجز توريد)</span>
                  </h3>

                  {modelDeficits.length > 0 ? (
                    <table className="w-full text-xs text-start border-collapse">
                      <thead className="bg-slate-100 text-slate-900 font-black">
                        <tr>
                          <th className="border border-slate-800 p-2.5">م</th>
                          <th className="border border-slate-800 p-2.5">الصورة</th>
                          <th className="border border-slate-800 p-2.5">الكود</th>
                          <th className="border border-slate-800 p-2.5">اسم الإكسسوار</th>
                          <th className="border border-slate-800 p-2.5">الموديل المخصص</th>
                          <th className="border border-slate-800 p-2.5 text-center">الكمية الموردة</th>
                          <th className="border border-slate-800 p-2.5 text-center">الكمية المستهدفة</th>
                          <th className="border border-slate-800 p-2.5 text-center">العجز المطلوب توريده</th>
                          <th className="border border-slate-800 p-2.5">المورد ورقم الهاتف</th>
                        </tr>
                      </thead>
                      <tbody className="font-semibold">
                        {modelDeficits.map(({ item, supplier, threshold, deficit }, idx) => (
                          <tr key={item.id} className="hover:bg-slate-50">
                            <td className="border border-slate-800 p-2.5 text-slate-600">{idx + 1}</td>
                            <td className="border border-slate-800 p-2.5">
                              <img
                                src={item.image}
                                alt={item.name}
                                className="w-8 h-8 rounded object-contain bg-white border border-slate-300 p-0.5"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
                              />
                            </td>
                            <td className="border border-slate-800 p-2.5 font-mono font-bold text-slate-900">{item.code}</td>
                            <td className="border border-slate-800 p-2.5 font-bold text-slate-900">{item.name}</td>
                            <td className="border border-slate-800 p-2.5 font-black text-slate-900">موديل {item.custom_model_code || 'خاص'}</td>
                            <td className="border border-slate-800 p-2.5 text-center text-slate-700">{item.delivered_quantity ?? item.quantity} {item.unit}</td>
                            <td className="border border-slate-800 p-2.5 text-center text-slate-900 font-bold">{threshold} {item.unit}</td>
                            <td className="border border-slate-800 p-2.5 text-center font-black text-slate-900 text-sm">
                              {deficit} {item.unit}
                            </td>
                            <td className="border border-slate-800 p-2.5 text-slate-700 text-[11px]">
                              {supplier?.name || 'مورد عام'} {supplier?.phone ? `(${supplier.phone})` : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-xs text-slate-500 py-2 font-bold">لا توجد نواقص في إكسسوارات الموديلات المخصصة.</p>
                  )}
                </div>
              )}

              <div className="pt-6 border-t-2 border-slate-900 text-xs text-slate-700 flex justify-between font-bold">
                <span>توقيع مسؤول المشتريات: ______________________</span>
                <span>اعتماد مدير الإنتاج: ______________________</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: TRANSACTION (DEDUCT / ADD) */}
      {showTransactionModal && activeItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl w-[95vw] sm:w-full max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6 shadow-2xl border border-slate-200 space-y-4">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto p-4 sm:p-6 shadow-2xl border border-slate-200 space-y-4">
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