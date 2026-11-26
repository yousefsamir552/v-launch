import React, { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api/client';
import {
  ShoppingCart,
  Plus,
  History,
  Search,
  Printer,
  FileSpreadsheet,
  CheckCircle2,
  Pencil,
  Trash2,
  X,
  Upload,
  ImageOff,
  MessageCircle,
  PackageCheck,
  Sparkles,
  Tag,
  Calendar,
  User as UserIcon,
  Store,
  Coins,
  Layers,
  Check,
  Copy
} from 'lucide-react';
import {
  AccessoryItem,
  PURCHASE_REQUEST_CATEGORIES,
  PurchaseRequest,
  PurchaseRequestCategory,
  Supplier
} from '../types';
import { computeAccessoryShortages } from '../utils/accessoryShortages';
import { ZoomableImage } from './ZoomableImage';
import {
  escapeHtml,
  logClientPrintAction,
  openUnifiedPrintWindow,
  renderSignatureBar,
  safeImageSrc
} from '../utils/printShared';
import { SortBySelect, compareNatural, toTimestamp } from './SortBySelect';
import { useModalBackHandler } from '../utils/mobileBackNav';

type PurchaseSortKey = 'newest' | 'oldest' | 'code_asc' | 'code_desc' | 'qty_desc' | 'qty_asc';

const PURCHASE_SORT_OPTIONS: { value: PurchaseSortKey; label: string }[] = [
  { value: 'newest', label: 'الأحدث أولاً' },
  { value: 'oldest', label: 'الأقدم أولاً' },
  { value: 'code_asc', label: 'الصنف / الكود (تصاعدي)' },
  { value: 'code_desc', label: 'الصنف / الكود (تنازلي)' },
  { value: 'qty_desc', label: 'الكمية (الأكثر أولاً)' },
  { value: 'qty_asc', label: 'الكمية (الأقل أولاً)' }
];

const COMMON_UNITS = ['قطعة', 'كيلو', 'متر', 'دستة', 'بكرة', 'لفة', 'كرتونة', 'كيس', 'توب'];

const CATEGORY_BADGE_STYLES: Record<string, string> = {
  إكسسوارات: 'bg-pink-50 text-pink-700 border-pink-200',
  قماش: 'bg-blue-50 text-blue-700 border-blue-200',
  'خامات تغليف': 'bg-orange-50 text-orange-700 border-orange-200',
  أخرى: 'bg-slate-100 text-slate-700 border-slate-200'
};

/** مربع أنيق يظهر عند عدم وجود صورة — بدون أي صور عشوائية. */
const NoImageBadge: React.FC<{ size?: 'sm' | 'md' | 'lg' }> = ({ size = 'md' }) => {
  const dims =
    size === 'sm'
      ? 'w-12 h-12 rounded-xl text-[9px]'
      : size === 'lg'
      ? 'w-24 h-24 rounded-2xl text-[11px]'
      : 'w-16 h-16 rounded-2xl text-[10px]';
  return (
    <div
      className={`${dims} bg-slate-50 border border-dashed border-slate-300 text-slate-400 flex flex-col items-center justify-center gap-0.5 shrink-0 select-none text-center px-1`}
    >
      <ImageOff className={size === 'sm' ? 'w-3.5 h-3.5 text-slate-300' : 'w-4 h-4 text-slate-300'} />
      <span className="font-bold leading-tight">بدون صورة</span>
    </div>
  );
};

export const PurchaseRequestsView: React.FC = () => {
  const {
    purchaseRequests,
    accessoryItems,
    suppliers,
    models,
    globalSettings,
    hasPermission,
    canSendWhatsApp,
    openWhatsAppOrder,
    formatSupplierWhatsappMessage,
    addPurchaseRequest,
    updatePurchaseRequest,
    deletePurchaseRequest,
    markPurchaseRequestPurchased,
    exportPurchaseRequestsCsv,
    recordAccessoryTransaction,
    markAccessoryWithdrawn
  } = useApp();

  const canEdit = hasPermission('purchase_requests', true);
  const canEditAccessories = hasPermission('accessories_warehouse', true);

  // Strict top toggle: OFF = active pending requests + low-stock shortages | ON = purchased history ONLY
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<PurchaseSortKey>('newest');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [shortageSubTab, setShortageSubTab] = useState<'all' | 'stock' | 'custom_model'>('all');

  // Create / Edit Request Modal state
  const [showRequestModal, setShowRequestModal] = useState<boolean>(false);
  const [editingRequest, setEditingRequest] = useState<PurchaseRequest | null>(null);
  const [requestForm, setRequestForm] = useState({
    item_name: '',
    quantity: '1',
    unit: 'قطعة',
    model_id: '',
    model_code_text: '',
    category: 'إكسسوارات' as PurchaseRequestCategory | string,
    notes: '',
    image: ''
  });
  const [imageUploading, setImageUploading] = useState<boolean>(false);
  const [imageUploadError, setImageUploadError] = useState<string>('');
  const [savingRequest, setSavingRequest] = useState<boolean>(false);

  // "تم الشراء" Modal state
  const [purchasingTarget, setPurchasingTarget] = useState<PurchaseRequest | null>(null);
  const [purchaseForm, setPurchaseForm] = useState({
    purchased_price: '',
    supplier_id: '',
    supplier_name: '',
    purchase_notes: ''
  });
  const [savingPurchase, setSavingPurchase] = useState<boolean>(false);

  // Quick supply / fulfill modal for low-stock accessory alerts
  const [fulfillTarget, setFulfillTarget] = useState<{
    item: AccessoryItem;
    supplier?: Supplier;
    available: number;
    deficit: number;
  } | null>(null);
  const [fulfillQty, setFulfillQty] = useState<string>('100');
  const [fulfillNotes, setFulfillNotes] = useState<string>('');
  const [copiedWhatsapp, setCopiedWhatsapp] = useState<boolean>(false);

  useModalBackHandler(showRequestModal, () => {
    setShowRequestModal(false);
    setEditingRequest(null);
  });
  useModalBackHandler(Boolean(purchasingTarget), () => setPurchasingTarget(null));
  useModalBackHandler(Boolean(fulfillTarget), () => setFulfillTarget(null));

  const activeModels = useMemo(() => models.filter((m) => !m.is_deleted), [models]);

  // Manual purchase requests partitioned strictly by status
  const pendingRequests = useMemo(
    () => (purchaseRequests || []).filter((r) => r.status === 'pending'),
    [purchaseRequests]
  );
  const purchasedRequests = useMemo(
    () =>
      (purchaseRequests || [])
        .filter((r) => r.status === 'purchased')
        .slice()
        .sort((a, b) =>
          String(b.purchased_at_iso || b.purchased_at || '').localeCompare(
            String(a.purchased_at_iso || a.purchased_at || '')
          )
        ),
    [purchaseRequests]
  );

  // Automatic low-stock accessory shortages (moved cleanly from AccessoriesWarehouseView)
  const accessoryShortages = useMemo(
    () => computeAccessoryShortages(accessoryItems, suppliers),
    [accessoryItems, suppliers]
  );
  const stockShortages = useMemo(
    () => accessoryShortages.filter((e) => e.item.usage_type === 'stock'),
    [accessoryShortages]
  );
  const modelShortages = useMemo(
    () => accessoryShortages.filter((e) => e.item.usage_type === 'custom_model'),
    [accessoryShortages]
  );

  const q = searchQuery.trim().toLowerCase();

  const matchesRequestSearch = (r: PurchaseRequest): boolean => {
    if (categoryFilter !== 'all' && (r.category || 'أخرى') !== categoryFilter) return false;
    if (!q) return true;
    return (
      (r.item_name || '').toLowerCase().includes(q) ||
      (r.model_code || '').toLowerCase().includes(q) ||
      (r.model_code_text || '').toLowerCase().includes(q) ||
      (r.category || '').toLowerCase().includes(q) ||
      (r.supplier_name || '').toLowerCase().includes(q) ||
      (r.notes || '').toLowerCase().includes(q) ||
      (r.purchase_notes || '').toLowerCase().includes(q) ||
      (r.created_by || '').toLowerCase().includes(q) ||
      (r.purchased_by || '').toLowerCase().includes(q)
    );
  };

  const sortRequests = (list: PurchaseRequest[]): PurchaseRequest[] =>
    [...list].sort((a, b) => {
      if (sortBy === 'code_asc') return compareNatural(a.item_name, b.item_name);
      if (sortBy === 'code_desc') return compareNatural(b.item_name, a.item_name);
      if (sortBy === 'qty_desc') return Number(b.quantity || 0) - Number(a.quantity || 0);
      if (sortBy === 'qty_asc') return Number(a.quantity || 0) - Number(b.quantity || 0);
      const tsA = toTimestamp(a.purchased_at_iso || a.purchased_at || a.created_at_iso || a.created_at);
      const tsB = toTimestamp(b.purchased_at_iso || b.purchased_at || b.created_at_iso || b.created_at);
      if (sortBy === 'oldest') return tsA - tsB;
      return tsB - tsA;
    });

  const filteredPendingRequests = useMemo(
    () => sortRequests(pendingRequests.filter(matchesRequestSearch)),
    [pendingRequests, q, categoryFilter, sortBy]
  );

  const filteredPurchasedRequests = useMemo(
    () => sortRequests(purchasedRequests.filter(matchesRequestSearch)),
    [purchasedRequests, q, categoryFilter, sortBy]
  );

  const filteredAccessoryShortages = useMemo(() => {
    const base =
      shortageSubTab === 'stock'
        ? stockShortages
        : shortageSubTab === 'custom_model'
        ? modelShortages
        : accessoryShortages;
    if (categoryFilter !== 'all' && categoryFilter !== 'إكسسوارات') return [];
    const list = !q
      ? base
      : base.filter(({ item, supplier }) => {
          return (
            (item.name || '').toLowerCase().includes(q) ||
            (item.code || '').toLowerCase().includes(q) ||
            (item.type_name || '').toLowerCase().includes(q) ||
            (item.custom_model_code || '').toLowerCase().includes(q) ||
            (supplier?.name || '').toLowerCase().includes(q)
          );
        });
    return [...list].sort((a, b) => {
      if (sortBy === 'code_desc') return compareNatural(b.item.code || b.item.name, a.item.code || a.item.name);
      if (sortBy === 'qty_desc') return Number(b.deficit || 0) - Number(a.deficit || 0);
      if (sortBy === 'qty_asc') return Number(a.deficit || 0) - Number(b.deficit || 0);
      return compareNatural(a.item.code || a.item.name, b.item.code || b.item.name);
    });
  }, [accessoryShortages, stockShortages, modelShortages, shortageSubTab, q, categoryFilter, sortBy]);

  const totalSpentHistory = useMemo(
    () =>
      filteredPurchasedRequests.reduce(
        (sum, r) => sum + (Number(r.purchased_price) || 0),
        0
      ),
    [filteredPurchasedRequests]
  );

  // --- Handlers: Create / Edit Request ---
  const openCreateModal = () => {
    setEditingRequest(null);
    setRequestForm({
      item_name: '',
      quantity: '1',
      unit: 'قطعة',
      model_id: '',
      model_code_text: '',
      category: 'إكسسوارات',
      notes: '',
      image: ''
    });
    setImageUploadError('');
    setShowRequestModal(true);
  };

  const openEditModal = (req: PurchaseRequest) => {
    setEditingRequest(req);
    setRequestForm({
      item_name: req.item_name || '',
      quantity: String(req.quantity ?? 1),
      unit: req.unit || 'قطعة',
      model_id: req.model_id || '',
      model_code_text: req.model_code_text || req.model_code || '',
      category: req.category || 'إكسسوارات',
      notes: req.notes || '',
      image: req.image || ''
    });
    setImageUploadError('');
    setShowRequestModal(true);
  };

  const handleRequestImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImageUploadError('');
    setImageUploading(true);
    try {
      const uploaded = await api.uploadImage(file, 'purchase_requests');
      setRequestForm((prev) => ({ ...prev, image: uploaded.url }));
    } catch (err: any) {
      setImageUploadError(err?.message || 'فشل رفع الصورة، يرجى المحاولة مرة أخرى');
    } finally {
      setImageUploading(false);
    }
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingRequest) return;
    setSavingRequest(true);
    try {
      const payload = {
        item_name: requestForm.item_name.trim(),
        quantity: Number(requestForm.quantity),
        unit: requestForm.unit.trim() || 'قطعة',
        model_id: requestForm.model_id || '',
        model_code_text: requestForm.model_code_text.trim(),
        category: requestForm.category,
        notes: requestForm.notes.trim(),
        image: requestForm.image.trim()
      };
      const res = editingRequest
        ? await updatePurchaseRequest(editingRequest.id, payload)
        : await addPurchaseRequest(payload);
      if (res.success) {
        setShowRequestModal(false);
        setEditingRequest(null);
      }
    } finally {
      setSavingRequest(false);
    }
  };

  // --- Handlers: Mark as Purchased ---
  const openMarkPurchasedModal = (req: PurchaseRequest) => {
    setPurchasingTarget(req);
    setPurchaseForm({
      purchased_price: '',
      supplier_id: '',
      supplier_name: '',
      purchase_notes: ''
    });
  };

  const handleConfirmPurchased = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purchasingTarget || savingPurchase) return;
    setSavingPurchase(true);
    try {
      const selectedSup = suppliers.find((s) => s.id === purchaseForm.supplier_id);
      const res = await markPurchaseRequestPurchased(purchasingTarget.id, {
        purchased_price: Number(purchaseForm.purchased_price),
        supplier_id: purchaseForm.supplier_id || '',
        supplier_name: purchaseForm.supplier_name.trim() || selectedSup?.name || '',
        purchase_notes: purchaseForm.purchase_notes.trim()
      });
      if (res.success) {
        setPurchasingTarget(null);
      }
    } finally {
      setSavingPurchase(false);
    }
  };

  const handleDeleteRequest = async (req: PurchaseRequest) => {
    if (!window.confirm(`هل أنت متأكد من حذف طلب الشراء «${req.item_name}»؟`)) return;
    await deletePurchaseRequest(req.id);
  };

  // --- Handlers: Automatic Accessory Shortages (WhatsApp / Fulfill / Withdraw) ---
  const buildShortageWhatsappText = (item: AccessoryItem, qty: number, supplierName?: string) =>
    formatSupplierWhatsappMessage({
      supplierName: supplierName || 'حضرة المورد',
      itemName: `${item.type_name} - ${item.name}`,
      code: item.code,
      quantity: qty,
      unit: item.unit,
      available: item.quantity,
      modelCode: item.usage_type === 'custom_model' ? item.custom_model_code : undefined
    });

  const handleDirectShortageWhatsapp = (item: AccessoryItem, deficit: number, sup?: Supplier) => {
    const text = buildShortageWhatsappText(item, deficit, sup?.name);
    openWhatsAppOrder(sup?.phone, sup?.whatsapp_group_link, text);
  };

  const openFulfillModal = (item: AccessoryItem, deficit: number, available: number, supplier?: Supplier) => {
    setFulfillTarget({ item, supplier, available, deficit });
    setFulfillQty(String(deficit > 0 ? deficit : 100));
    setFulfillNotes('');
    setCopiedWhatsapp(false);
  };

  const handleCopyFulfillWhatsapp = () => {
    if (!fulfillTarget) return;
    const qtyNum = Number(fulfillQty) || fulfillTarget.deficit;
    const text = buildShortageWhatsappText(fulfillTarget.item, qtyNum, fulfillTarget.supplier?.name);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => undefined);
      setCopiedWhatsapp(true);
      setTimeout(() => setCopiedWhatsapp(false), 3000);
    }
    openWhatsAppOrder(
      fulfillTarget.supplier?.phone,
      fulfillTarget.supplier?.whatsapp_group_link,
      text
    );
  };

  const fulfillLockRef = React.useRef(false);

  const handleConfirmFulfillSupply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fulfillTarget || fulfillLockRef.current) return;
    const amount = Number(fulfillQty);
    if (!Number.isFinite(amount) || amount <= 0) return;
    fulfillLockRef.current = true;
    try {
      const res = recordAccessoryTransaction({
        accessoryId: fulfillTarget.item.id,
        operation: 'add',
        amount,
        modelCodeRef: fulfillTarget.item.custom_model_code || 'طلب شراء / توريد',
        notes: `توريد من شاشة طلبات الشراء - المورد: ${fulfillTarget.supplier?.name || 'غير محدد'}. ${fulfillNotes}`
      });
      if (res.success) {
        setFulfillTarget(null);
      }
    } finally {
      window.setTimeout(() => {
        fulfillLockRef.current = false;
      }, 600);
    }
  };

  // --- Print (A4 Landscape using printShared.ts) ---
  const handlePrint = () => {
    if (showHistory) {
      logClientPrintAction(
        'طلبات الشراء',
        `طباعة سجل طلبات الشراء السابقة (${filteredPurchasedRequests.length} صنف)`,
        'طلبات شراء سابقة'
      );
      const rowsHtml = filteredPurchasedRequests
        .map((r, idx) => {
          const imgSrc = safeImageSrc(r.image);
          return `<tr>
            <td class="num muted">${idx + 1}</td>
            <td>${
              imgSrc
                ? `<img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(r.item_name)}" class="pr-thumb" onerror="this.style.display='none'" />`
                : '<span class="no-img-cell">بدون صورة</span>'
            }</td>
            <td class="text-right"><strong>${escapeHtml(r.item_name)}</strong></td>
            <td>${escapeHtml(r.category || 'أخرى')}</td>
            <td class="num"><strong>${Number(r.quantity || 0).toLocaleString('ar-EG')} ${escapeHtml(r.unit || 'قطعة')}</strong></td>
            <td>${escapeHtml(r.model_code || r.model_code_text || '—')}</td>
            <td class="num ok"><strong>${Number(r.purchased_price || 0).toLocaleString('ar-EG')} ج.م</strong></td>
            <td class="text-right">${escapeHtml(r.supplier_name || '—')}</td>
            <td class="mono">${escapeHtml(r.purchased_at || '—')}</td>
            <td>${escapeHtml(r.purchased_by || '—')}</td>
            <td class="text-right">${escapeHtml(r.purchase_notes || r.notes || '—')}</td>
          </tr>`;
        })
        .join('');

      const bodyHtml = `
        <div class="p-kpis">
          <div class="p-kpi"><span class="p-kpi-label">عدد الطلبات المشتراة</span><span class="p-kpi-val">${filteredPurchasedRequests.length.toLocaleString('ar-EG')}</span></div>
          <div class="p-kpi"><span class="p-kpi-label">إجمالي قيمة المشتريات</span><span class="p-kpi-val ok">${Math.round(totalSpentHistory).toLocaleString('ar-EG')} ج.م</span></div>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width:3%">#</th>
              <th style="width:7%">الصورة</th>
              <th class="text-right" style="width:16%">اسم الصنف</th>
              <th style="width:8%">التصنيف</th>
              <th style="width:9%">الكمية</th>
              <th style="width:9%">الموديل</th>
              <th style="width:10%">سعر الشراء</th>
              <th class="text-right" style="width:12%">المورد</th>
              <th style="width:10%">تاريخ الشراء</th>
              <th style="width:8%">بواسطة</th>
              <th class="text-right" style="width:8%">ملاحظات</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || '<tr><td colspan="11" class="muted">لا توجد طلبات شراء سابقة مطابقة.</td></tr>'}</tbody>
        </table>
        ${renderSignatureBar(['مسؤول المشتريات', 'أمين المخزن', 'اعتماد الإدارة'], true)}
      `;

      openUnifiedPrintWindow({
        documentTitle: 'سجل طلبات الشراء السابقة',
        mode: 'multi-page-table',
        orientation: 'landscape',
        header: {
          siteName: globalSettings?.site_name,
          logo: globalSettings?.logo,
          title: 'سجل طلبات الشراء السابقة (المشتريات المنفذة)',
          subtitle: 'كشف مفصّل بالأصناف المشتراة والأسعار الفعلية والموردين وتواريخ التنفيذ',
          metaItems: [`إجمالي السجلات: ${filteredPurchasedRequests.length.toLocaleString('ar-EG')}`]
        },
        bodyHtml,
        extraCss: `
          .pr-thumb { width: 28px; height: 28px; object-fit: contain; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; display: block; margin: 0 auto; }
          .no-img-cell { font-size: 8px; color: #64748b; border: 1px dashed #cbd5e1; padding: 2px 4px; border-radius: 4px; display: inline-block; }
        `,
        popupBlockedMessage: 'يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة سجل المشتريات.'
      });
      return;
    }

    // Active Purchase Requests + Accessory Shortages Print
    logClientPrintAction(
      'طلبات الشراء',
      `طباعة كشف طلبات الشراء والنواقص المطلوبة (${filteredPendingRequests.length} طلب يدوي + ${filteredAccessoryShortages.length} نقص إكسسوارات)`,
      'كشف طلبات الشراء'
    );

    const manualRowsHtml = filteredPendingRequests
      .map((r, idx) => {
        const imgSrc = safeImageSrc(r.image);
        return `<tr>
          <td class="num muted">${idx + 1}</td>
          <td>${
            imgSrc
              ? `<img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(r.item_name)}" class="pr-thumb" onerror="this.style.display='none'" />`
              : '<span class="no-img-cell">بدون صورة</span>'
          }</td>
          <td class="text-right"><strong>${escapeHtml(r.item_name)}</strong></td>
          <td>${escapeHtml(r.category || 'أخرى')}</td>
          <td class="num bad"><strong>${Number(r.quantity || 0).toLocaleString('ar-EG')} ${escapeHtml(r.unit || 'قطعة')}</strong></td>
          <td>${escapeHtml(r.model_code || r.model_code_text || '—')}</td>
          <td>${escapeHtml(r.created_by || '—')}</td>
          <td class="mono">${escapeHtml(r.created_at || '—')}</td>
          <td class="text-right">${escapeHtml(r.notes || '—')}</td>
        </tr>`;
      })
      .join('');

    const shortageRowsHtml = filteredAccessoryShortages
      .map(({ item, supplier, available, threshold, deficit }, idx) => {
        const imgSrc = safeImageSrc(item.image);
        return `<tr>
          <td class="num muted">${idx + 1}</td>
          <td>${
            imgSrc
              ? `<img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(item.name)}" class="pr-thumb" onerror="this.style.display='none'" />`
              : '<span class="no-img-cell">بدون صورة</span>'
          }</td>
          <td class="mono"><strong>${escapeHtml(item.code)}</strong></td>
          <td class="text-right"><strong>${escapeHtml(item.name)}</strong></td>
          <td>${escapeHtml(item.usage_type === 'custom_model' ? `موديل ${item.custom_model_code || 'خاص'}` : item.type_name || 'رصيد مستمر')}</td>
          <td class="num">${available} ${escapeHtml(item.unit)}</td>
          <td class="num">${threshold} ${escapeHtml(item.unit)}</td>
          <td class="num bad"><strong>${deficit} ${escapeHtml(item.unit)}</strong></td>
          <td class="text-right">${escapeHtml(supplier?.name || '—')}${supplier?.phone ? ` (${escapeHtml(supplier.phone)})` : ''}</td>
        </tr>`;
      })
      .join('');

    const bodyHtml = `
      <div class="p-kpis">
        <div class="p-kpi"><span class="p-kpi-label">طلبات شراء مسجلة</span><span class="p-kpi-val warn">${filteredPendingRequests.length.toLocaleString('ar-EG')}</span></div>
        <div class="p-kpi"><span class="p-kpi-label">نواقص إكسسوارات تلقائية</span><span class="p-kpi-val bad">${filteredAccessoryShortages.length.toLocaleString('ar-EG')}</span></div>
      </div>

      <div class="p-sec">أولاً: طلبات الشراء المسجلة (قيد الانتظار — ${filteredPendingRequests.length} صنف)</div>
      <table>
        <thead>
          <tr>
            <th style="width:4%">#</th>
            <th style="width:7%">الصورة</th>
            <th class="text-right" style="width:20%">اسم الصنف</th>
            <th style="width:10%">التصنيف</th>
            <th style="width:11%">الكمية المطلوبة</th>
            <th style="width:11%">الموديل</th>
            <th style="width:10%">طالب الشراء</th>
            <th style="width:11%">تاريخ الطلب</th>
            <th class="text-right" style="width:16%">ملاحظات</th>
          </tr>
        </thead>
        <tbody>${manualRowsHtml || '<tr><td colspan="9" class="muted">لا توجد طلبات شراء يدوية قيد الانتظار.</td></tr>'}</tbody>
      </table>

      <div class="p-sec" style="margin-top:12px;">ثانياً: نواقص مخزن الإكسسوارات التلقائية (${filteredAccessoryShortages.length} صنف)</div>
      <table>
        <thead>
          <tr>
            <th style="width:4%">#</th>
            <th style="width:7%">الصورة</th>
            <th style="width:10%">الكود</th>
            <th class="text-right" style="width:19%">اسم الإكسسوار</th>
            <th style="width:13%">النوع / الموديل</th>
            <th style="width:10%">المتاح</th>
            <th style="width:10%">الحد / المستهدف</th>
            <th style="width:11%">العجز المطلوب</th>
            <th class="text-right" style="width:16%">المورد والهاتف</th>
          </tr>
        </thead>
        <tbody>${shortageRowsHtml || '<tr><td colspan="9" class="muted">لا توجد نواقص تلقائية في مخزن الإكسسوارات حالياً.</td></tr>'}</tbody>
      </table>

      ${renderSignatureBar(['أمين المخزن', 'مسؤول المشتريات', 'اعتماد مدير الإنتاج'], true)}
    `;

    openUnifiedPrintWindow({
      documentTitle: 'كشف طلبات الشراء والنواقص المطلوبة',
      mode: 'multi-page-table',
      orientation: 'landscape',
      header: {
        siteName: globalSettings?.site_name,
        logo: globalSettings?.logo,
        title: 'كشف طلبات الشراء ونواقص المخازن العاجلة',
        subtitle: 'يشمل طلبات الشراء المسجلة قيد الانتظار ونواقص مخزن الإكسسوارات التلقائية',
        metaItems: [
          `إجمالي البنود: ${(filteredPendingRequests.length + filteredAccessoryShortages.length).toLocaleString('ar-EG')}`
        ]
      },
      bodyHtml,
      extraCss: `
        .pr-thumb { width: 28px; height: 28px; object-fit: contain; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; display: block; margin: 0 auto; }
        .no-img-cell { font-size: 8px; color: #64748b; border: 1px dashed #cbd5e1; padding: 2px 4px; border-radius: 4px; display: inline-block; }
      `,
      popupBlockedMessage: 'يرجى السماح بالنوافذ المنبثقة (Pop-ups) لطباعة كشف طلبات الشراء.'
    });
  };

  const activeTotalCount = pendingRequests.length + accessoryShortages.length;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Clean Dedicated Header (No heavy yellow box) */}
      <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-xs space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-xs shrink-0">
              <ShoppingCart className="w-6 h-6 text-amber-400" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg sm:text-xl font-black text-slate-900">
                  {showHistory ? 'طلبات شراء سابقة' : 'طلبات الشراء والمشتريات'}
                </h1>
                {!showHistory ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-black px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    {activeTotalCount} مطلوب للشراء
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs font-black px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {purchasedRequests.length} طلب مكتمل
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                {showHistory
                  ? 'أرشيف المشتريات المنفذة مع الأسعار الفعلية وأسماء الموردين وتواريخ ومنفذي الشراء.'
                  : 'تسجيل طلبات شراء مستقلة ومتابعة نواقص مخزن الإكسسوارات التلقائية في مكان واحد منظّم.'}
              </p>
            </div>
          </div>

          {/* Primary Actions Bar */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Strict Toggle Button: طلبات شراء سابقة */}
            <button
              type="button"
              onClick={() => setShowHistory((prev) => !prev)}
              aria-pressed={showHistory}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-black border transition cursor-pointer shadow-xs ${
                showHistory
                  ? 'bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700'
                  : 'bg-slate-50 text-slate-800 border-slate-300 hover:bg-slate-100'
              }`}
              title="التبديل بين الطلبات المطلوبة حالياً وسجل طلبات الشراء السابقة"
            >
              <History className="w-4 h-4" />
              <span>طلبات شراء سابقة</span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-black ${
                  showHistory
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                {purchasedRequests.length}
              </span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition shadow-xs cursor-pointer"
              title="طباعة الكشف (A4 أفقي)"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة</span>
            </button>

            <button
              type="button"
              onClick={() => exportPurchaseRequestsCsv(showHistory ? 'purchased' : 'pending')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-xs cursor-pointer"
              title="تصدير إلى ملف Excel"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>تصدير Excel</span>
            </button>

            {canEdit && !showHistory && (
              <button
                type="button"
                onClick={openCreateModal}
                className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-black transition shadow-md shadow-blue-500/20 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ تسجيل طلب شراء</span>
              </button>
            )}
          </div>
        </div>

        {/* Search & Category Filter Row */}
        <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition shrink-0 cursor-pointer ${
                categoryFilter === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              كل التصنيفات
            </button>
            {PURCHASE_REQUEST_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition shrink-0 cursor-pointer ${
                  categoryFilter === cat
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <SortBySelect
              value={sortBy}
              onChange={(v) => setSortBy(v as PurchaseSortKey)}
              options={PURCHASE_SORT_OPTIONS}
            />
            <div className="relative flex-grow sm:flex-none sm:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute start-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  showHistory
                    ? 'بحث بالصنف، الموديل، المورد، أو المنفذ...'
                    : 'بحث باسم الصنف، الكود، الموديل، أو المورد...'
                }
                className="w-full ps-9 pe-8 py-2 bg-slate-50 border border-slate-200 rounded-full text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute end-2.5 top-2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  aria-label="مسح البحث"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* MODE B (showHistory === true): COMPLETED / PURCHASED HISTORY ONLY */}
      {/* ================================================================= */}
      {showHistory ? (
        <div className="space-y-4">
          {/* Summary Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-white rounded-2xl border border-slate-200/80 p-4 flex items-center justify-between shadow-2xs">
              <div>
                <span className="text-[11px] font-bold text-slate-500 block">عدد الطلبات المشتراة</span>
                <strong className="text-xl font-black text-slate-900 font-mono">
                  {filteredPurchasedRequests.length.toLocaleString('ar-EG')}
                </strong>
              </div>
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200/80 p-4 flex items-center justify-between shadow-2xs">
              <div>
                <span className="text-[11px] font-bold text-slate-500 block">إجمالي قيمة المشتريات المعروضة</span>
                <strong className="text-xl font-black text-emerald-700 font-mono">
                  {totalSpentHistory.toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م
                </strong>
              </div>
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <Coins className="w-5 h-5" />
              </div>
            </div>
          </div>

          {filteredPurchasedRequests.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredPurchasedRequests.map((req) => {
                const catStyle =
                  CATEGORY_BADGE_STYLES[req.category || 'أخرى'] || CATEGORY_BADGE_STYLES['أخرى'];
                const modelDisplay = req.model_code || req.model_code_text || '';
                return (
                  <div
                    key={req.id}
                    className="bg-white rounded-3xl border border-slate-200/90 p-4 shadow-2xs hover:shadow-sm transition flex flex-col justify-between gap-3"
                  >
                    <div className="flex items-start gap-3">
                      {req.image ? (
                        <ZoomableImage
                          src={req.image}
                          alt={req.item_name}
                          className="w-16 h-16 rounded-2xl object-contain bg-slate-50 border border-slate-200 shrink-0 p-0.5"
                        />
                      ) : (
                        <NoImageBadge size="md" />
                      )}

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${catStyle}`}
                          >
                            {req.category || 'أخرى'}
                          </span>
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            تم الشراء
                          </span>
                        </div>
                        <h3 className="font-black text-sm text-slate-900 break-words">
                          {req.item_name}
                        </h3>
                        <p className="text-xs font-bold text-slate-600">
                          الكمية:{' '}
                          <span className="font-mono text-slate-900">
                            {Number(req.quantity || 0).toLocaleString('ar-EG')}
                          </span>{' '}
                          {req.unit || 'قطعة'}
                          {modelDisplay && (
                            <span className="ms-2 inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md">
                              <Tag className="w-3 h-3" />
                              {modelDisplay}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Purchase Details Box */}
                    <div className="rounded-2xl bg-slate-50 border border-slate-200/70 p-3 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-500 flex items-center gap-1 font-bold">
                          <Coins className="w-3.5 h-3.5 text-emerald-600" />
                          سعر الشراء:
                        </span>
                        <strong className="font-mono font-black text-emerald-700 text-sm">
                          {req.purchased_price !== null && req.purchased_price !== undefined
                            ? `${Number(req.purchased_price).toLocaleString('ar-EG')} ج.م`
                            : '—'}
                        </strong>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-500 flex items-center gap-1 font-bold">
                          <Store className="w-3.5 h-3.5 text-slate-400" />
                          المورد:
                        </span>
                        <span className="font-bold text-slate-800 truncate">
                          {req.supplier_name || 'غير محدد'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-500 flex items-center gap-1 font-bold">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          تاريخ الشراء:
                        </span>
                        <span className="font-mono font-bold text-slate-700 text-[11px]">
                          {req.purchased_at || '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-500 flex items-center gap-1 font-bold">
                          <UserIcon className="w-3.5 h-3.5 text-slate-400" />
                          بواسطة:
                        </span>
                        <span className="font-bold text-slate-700">
                          {req.purchased_by || '—'}
                        </span>
                      </div>
                      {(req.purchase_notes || req.notes) && (
                        <div className="pt-1.5 mt-1 border-t border-slate-200/80 text-[11px] text-slate-600 space-y-0.5">
                          {req.purchase_notes && (
                            <p>
                              <strong className="text-slate-800">ملاحظات الشراء:</strong>{' '}
                              {req.purchase_notes}
                            </p>
                          )}
                          {req.notes && (
                            <p>
                              <strong className="text-slate-800">ملاحظات الطلب:</strong> {req.notes}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {canEdit && (
                      <div className="flex items-center justify-end pt-1">
                        <button
                          type="button"
                          onClick={() => handleDeleteRequest(req)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                          title="حذف من السجل"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>حذف</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-white rounded-3xl border border-slate-200/80 p-12 text-center space-y-2">
              <History className="w-10 h-10 mx-auto text-slate-300" />
              <p className="text-sm font-black text-slate-700">لا توجد طلبات شراء سابقة مطابقة</p>
              <p className="text-xs text-slate-500">
                بمجرد الضغط على «تم الشراء» لأي طلب قيد الانتظار سيظهر هنا بكامل تفاصيل السعر والمورد.
              </p>
            </div>
          )}
        </div>
      ) : (
        /* ================================================================= */
        /* MODE A (showHistory === false): PENDING REQUESTS + SHORTAGES ONLY */
        /* ================================================================= */
        <div className="space-y-6">
          {/* Section 1: Manual Pending Purchase Requests */}
          <section className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <ShoppingCart className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-black text-slate-900">
                      طلبات الشراء المسجلة (قيد الانتظار)
                    </h2>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-blue-50 text-blue-700 border border-blue-200 font-mono">
                      {filteredPendingRequests.length}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    طلبات شراء مستقلة مسجلة مباشرة للمشتريات دون الحاجة لإنشاء صنف بالمخزن أولاً.
                  </p>
                </div>
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-black transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>طلب جديد</span>
                </button>
              )}
            </div>

            {filteredPendingRequests.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredPendingRequests.map((req) => {
                  const catStyle =
                    CATEGORY_BADGE_STYLES[req.category || 'أخرى'] || CATEGORY_BADGE_STYLES['أخرى'];
                  const modelDisplay = req.model_code || req.model_code_text || '';
                  return (
                    <div
                      key={req.id}
                      className="rounded-2xl border border-slate-200/90 bg-slate-50/40 hover:bg-white hover:shadow-sm transition p-4 flex flex-col justify-between gap-3"
                    >
                      <div className="flex items-start gap-3">
                        {req.image ? (
                          <ZoomableImage
                            src={req.image}
                            alt={req.item_name}
                            className="w-16 h-16 rounded-2xl object-contain bg-white border border-slate-200 shrink-0 p-0.5"
                          />
                        ) : (
                          <NoImageBadge size="md" />
                        )}

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${catStyle}`}
                            >
                              {req.category || 'أخرى'}
                            </span>
                            {modelDisplay && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                                <Tag className="w-2.5 h-2.5" />
                                موديل {modelDisplay}
                              </span>
                            )}
                          </div>

                          <h3 className="font-black text-sm text-slate-900 break-words">
                            {req.item_name}
                          </h3>

                          <div className="flex items-baseline gap-1.5">
                            <span className="text-xs text-slate-500 font-bold">الكمية المطلوبة:</span>
                            <strong className="font-mono text-sm font-black text-slate-900">
                              {Number(req.quantity || 0).toLocaleString('ar-EG')}
                            </strong>
                            <span className="text-xs font-bold text-slate-600">
                              {req.unit || 'قطعة'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {req.notes && (
                        <p className="text-xs text-slate-600 bg-white rounded-xl border border-slate-200/70 px-3 py-2 leading-relaxed">
                          {req.notes}
                        </p>
                      )}

                      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                        <span className="truncate">
                          {req.created_by ? `بواسطة: ${req.created_by}` : ''}
                        </span>
                        <span className="font-mono shrink-0">{req.created_at || ''}</span>
                      </div>

                      {canEdit && (
                        <div className="pt-2.5 border-t border-slate-200/80 flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditModal(req)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-bold transition cursor-pointer"
                              title="تعديل الطلب"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span>تعديل</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteRequest(req)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white hover:bg-rose-50 text-rose-600 border border-slate-200 hover:border-rose-200 text-[11px] font-bold transition cursor-pointer"
                              title="حذف الطلب"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => openMarkPurchasedModal(req)}
                            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black shadow-xs transition cursor-pointer"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            <span>تم الشراء</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 py-10 px-4 text-center space-y-2">
                <CheckCircle2 className="w-9 h-9 mx-auto text-emerald-500" />
                <p className="text-sm font-black text-slate-700">
                  لا توجد طلبات شراء مسجلة قيد الانتظار حالياً
                </p>
                {canEdit && (
                  <p className="text-xs text-slate-500">
                    يمكنك تسجيل أي صنف مطلوب شراؤه بالضغط على «+ تسجيل طلب شراء».
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Section 2: Automatic Low-Stock Accessory Shortages (Clean Slate Card Layout) */}
          <section className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-pink-50 text-pink-600 flex items-center justify-center shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-black text-slate-900">
                      نواقص مخزن الإكسسوارات (تلقائي)
                    </h2>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-black font-mono border ${
                        accessoryShortages.length > 0
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}
                    >
                      {accessoryShortages.length} صنف
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    أصناف الإكسسوارات التي وصلت دون حد التنبيه أو بها عجز توريد لموديل معيّن.
                  </p>
                </div>
              </div>

              {/* Clean Sub-filter pills */}
              <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl w-full md:w-auto overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setShortageSubTab('all')}
                  className={`flex-1 md:flex-none px-3 py-1.5 rounded-lg text-[11px] font-black transition cursor-pointer shrink-0 ${
                    shortageSubTab === 'all'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  الكل ({accessoryShortages.length})
                </button>
                <button
                  type="button"
                  onClick={() => setShortageSubTab('stock')}
                  className={`flex-1 md:flex-none px-3 py-1.5 rounded-lg text-[11px] font-black transition cursor-pointer shrink-0 ${
                    shortageSubTab === 'stock'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  رصيد مستمر ({stockShortages.length})
                </button>
                <button
                  type="button"
                  onClick={() => setShortageSubTab('custom_model')}
                  className={`flex-1 md:flex-none px-3 py-1.5 rounded-lg text-[11px] font-black transition cursor-pointer shrink-0 ${
                    shortageSubTab === 'custom_model'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  موديلات مخصصة ({modelShortages.length})
                </button>
              </div>
            </div>

            {filteredAccessoryShortages.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredAccessoryShortages.map(({ item, supplier, available, threshold, deficit }) => {
                  const isCustom = item.usage_type === 'custom_model';
                  const hasRealImage =
                    Boolean(item.image) && !String(item.image).includes('unsplash.com');

                  return (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-slate-200/90 bg-slate-50/40 hover:bg-white hover:shadow-sm transition p-4 flex flex-col justify-between gap-3"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        {hasRealImage ? (
                          <ZoomableImage
                            src={item.image}
                            alt={item.name}
                            className="w-14 h-14 rounded-2xl object-contain bg-white border border-slate-200 shrink-0 p-0.5"
                          />
                        ) : (
                          <NoImageBadge size="sm" />
                        )}

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono text-[10px] font-black bg-slate-200/80 text-slate-800 px-1.5 py-0.5 rounded">
                              {item.code}
                            </span>
                            <span className="text-[10px] font-bold text-slate-500">
                              {item.type_name}
                            </span>
                          </div>

                          <h3 className="font-black text-sm text-slate-900 truncate" title={item.name}>
                            {item.name}
                          </h3>

                          {isCustom ? (
                            <p className="text-xs text-pink-700 font-bold">
                              موديل <span className="underline">{item.custom_model_code || 'خاص'}</span> • عجز:{' '}
                              <strong className="text-rose-700 font-mono font-black">
                                {deficit} {item.unit}
                              </strong>
                            </p>
                          ) : (
                            <p className="text-xs text-slate-600 font-bold">
                              المتاح:{' '}
                              <strong className="text-rose-700 font-mono">{available}</strong> من حد ({threshold}) • عجز:{' '}
                              <strong className="text-amber-700 font-mono font-black">
                                {deficit} {item.unit}
                              </strong>
                            </p>
                          )}

                          {supplier && (
                            <p className="text-[11px] text-slate-500 flex items-center gap-1 truncate">
                              <Store className="w-3 h-3 shrink-0" />
                              <span className="truncate">{supplier.name}</span>
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="pt-2.5 border-t border-slate-200/80 flex items-center justify-between gap-1.5 flex-wrap">
                        {isCustom && !item.withdrawn_for_model && canEditAccessories && (
                          <button
                            type="button"
                            onClick={() => markAccessoryWithdrawn(item.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-[11px] font-bold transition cursor-pointer"
                            title="تأكيد اكتمال السحب للموديل وإخفاء التنبيه"
                          >
                            <PackageCheck className="w-3.5 h-3.5" />
                            <span>سحب للموديل</span>
                          </button>
                        )}

                        <div className="flex items-center gap-1.5 ms-auto">
                          {canSendWhatsApp() && (
                            <button
                              type="button"
                              onClick={() => handleDirectShortageWhatsapp(item, deficit, supplier)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold transition cursor-pointer"
                              title="إرسال طلب النواقص للمورد عبر واتساب"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              <span>واتساب</span>
                            </button>
                          )}

                          {(canEditAccessories || canEdit) && (
                            <button
                              type="button"
                              onClick={() => openFulfillModal(item, deficit, available, supplier)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-black transition cursor-pointer"
                              title="توريد واستلام الكمية في مخزن الإكسسوارات"
                            >
                              <Layers className="w-3.5 h-3.5 text-amber-400" />
                              <span>توريد / استلام</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 py-8 px-4 text-center space-y-1.5">
                <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500" />
                <p className="text-sm font-black text-slate-700">
                  لا توجد نواقص في مخزن الإكسسوارات حالياً
                </p>
                <p className="text-xs text-slate-500">جميع أصناف الإكسسوارات ضمن الحدود الآمنة.</p>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL 1: "+ تسجيل طلب شراء" / تعديل طلب شراء                       */}
      {/* ================================================================= */}
      {showRequestModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4"
          onClick={() => setShowRequestModal(false)}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-[95vw] sm:w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center">
                  <ShoppingCart className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-black text-sm text-slate-900">
                    {editingRequest ? 'تعديل طلب الشراء' : 'تسجيل طلب شراء جديد'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    تسجيل مباشر بدون الحاجة لإنشاء صنف إكسسوار مسبقاً
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowRequestModal(false)}
                className="p-1.5 rounded-full hover:bg-slate-200 text-slate-500 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitRequest} className="p-5 overflow-y-auto space-y-4">
              {/* Item Name */}
              <div>
                <label className="block text-xs font-black text-slate-700 mb-1">
                  اسم الصنف <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={requestForm.item_name}
                  onChange={(e) => setRequestForm((p) => ({ ...p, item_name: e.target.value }))}
                  placeholder="مثال: سوستة معدن 20 سم أو بادج جلد مطبوع..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-bold focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Quantity & Unit & Category */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1">
                    الكمية <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0.001"
                    required
                    value={requestForm.quantity}
                    onChange={(e) => setRequestForm((p) => ({ ...p, quantity: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs font-mono font-bold focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1">الوحدة</label>
                  <input
                    type="text"
                    list="purchase-request-units"
                    value={requestForm.unit}
                    onChange={(e) => setRequestForm((p) => ({ ...p, unit: e.target.value }))}
                    placeholder="قطعة"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs font-bold focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                  <datalist id="purchase-request-units">
                    {COMMON_UNITS.map((u) => (
                      <option key={u} value={u} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1">التصنيف</label>
                  <select
                    value={requestForm.category}
                    onChange={(e) => setRequestForm((p) => ({ ...p, category: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs font-bold bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  >
                    {PURCHASE_REQUEST_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Target Model (Select OR free text) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1">
                    الموديل المطلوب له (اختياري)
                  </label>
                  <select
                    value={requestForm.model_id}
                    onChange={(e) => {
                      const val = e.target.value;
                      const matched = activeModels.find((m) => m.id === val);
                      setRequestForm((p) => ({
                        ...p,
                        model_id: val,
                        model_code_text: matched ? matched.model_code : p.model_code_text
                      }));
                    }}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs font-bold bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">— بدون ربط بموديل —</option>
                    {activeModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.model_code} {m.model_type ? `(${m.model_type})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1">
                    أو كتابة كود الموديل يدوياً
                  </label>
                  <input
                    type="text"
                    value={requestForm.model_code_text}
                    onChange={(e) =>
                      setRequestForm((p) => ({
                        ...p,
                        model_code_text: e.target.value,
                        model_id: e.target.value.trim() ? p.model_id : ''
                      }))
                    }
                    placeholder="إن لم يُنشأ الموديل بعد..."
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs font-bold focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Optional Image Upload (Shows neat "بدون صورة" box if empty) */}
              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5">
                  صورة الصنف (اختياري)
                </label>
                <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-200">
                  {requestForm.image ? (
                    <div className="relative shrink-0">
                      <img
                        src={requestForm.image}
                        alt="معاينة"
                        className="w-20 h-20 rounded-2xl object-contain bg-white border border-slate-200 p-0.5"
                      />
                      <button
                        type="button"
                        onClick={() => setRequestForm((p) => ({ ...p, image: '' }))}
                        className="absolute -top-2 -end-2 w-6 h-6 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-xs hover:bg-rose-700 cursor-pointer"
                        title="إزالة الصورة"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <NoImageBadge size="lg" />
                  )}

                  <div className="flex-1 space-y-1.5">
                    <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-xs font-bold text-slate-700 cursor-pointer transition">
                      <Upload className="w-4 h-4 text-blue-600" />
                      <span>{imageUploading ? 'جاري الرفع...' : 'رفع صورة من الجهاز'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        disabled={imageUploading}
                        onChange={handleRequestImageUpload}
                        className="hidden"
                      />
                    </label>
                    <p className="text-[11px] text-slate-500">
                      اختيارية بالكامل — في حال عدم رفع صورة سيظهر مربع «بدون صورة».
                    </p>
                    {imageUploadError && (
                      <p className="text-[11px] font-bold text-rose-600">{imageUploadError}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-black text-slate-700 mb-1">ملاحظات</label>
                <textarea
                  rows={2}
                  value={requestForm.notes}
                  onChange={(e) => setRequestForm((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="مواصفات اللون أو المقاس أو موعد الاحتياج..."
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowRequestModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={savingRequest || imageUploading}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-black shadow-xs cursor-pointer"
                >
                  {savingRequest
                    ? 'جاري الحفظ...'
                    : editingRequest
                    ? 'حفظ التعديلات'
                    : 'تسجيل طلب الشراء'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL 2: "تم الشراء" (Price + Supplier + Purchase Notes)           */}
      {/* ================================================================= */}
      {purchasingTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4"
          onClick={() => setPurchasingTarget(null)}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-[95vw] sm:w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-100 bg-emerald-50/70 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-sm text-slate-900">تأكيد إتمام الشراء</h3>
                  <p className="text-[11px] text-slate-600 truncate max-w-[230px]">
                    {purchasingTarget.item_name} ({purchasingTarget.quantity} {purchasingTarget.unit})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPurchasingTarget(null)}
                className="p-1.5 rounded-full hover:bg-emerald-100 text-slate-500 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmPurchased} className="p-5 overflow-y-auto space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-700 mb-1">
                  سعر الشراء (اشتريتها بكام؟ — ج.م) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  required
                  autoFocus
                  value={purchaseForm.purchased_price}
                  onChange={(e) =>
                    setPurchaseForm((p) => ({ ...p, purchased_price: e.target.value }))
                  }
                  placeholder="مثال: 1500"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-mono font-black focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 mb-1">
                  المورد (اختيار من الموردين المسجلين)
                </label>
                <select
                  value={purchaseForm.supplier_id}
                  onChange={(e) => {
                    const id = e.target.value;
                    const sup = suppliers.find((s) => s.id === id);
                    setPurchaseForm((p) => ({
                      ...p,
                      supplier_id: id,
                      supplier_name: sup ? sup.name : p.supplier_name
                    }));
                  }}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs font-bold bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">— اختيار مورد مسجل أو كتابة يدوية بالأسفل —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.phone ? `(${s.phone})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 mb-1">
                  أو كتابة اسم المورد يدوياً
                </label>
                <input
                  type="text"
                  value={purchaseForm.supplier_name}
                  onChange={(e) =>
                    setPurchaseForm((p) => ({
                      ...p,
                      supplier_name: e.target.value,
                      supplier_id:
                        suppliers.find((s) => s.name === e.target.value)?.id || ''
                    }))
                  }
                  placeholder="اسم المورد أو المحل..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-bold focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 mb-1">
                  ملاحظات الشراء (اختياري)
                </label>
                <textarea
                  rows={2}
                  value={purchaseForm.purchase_notes}
                  onChange={(e) =>
                    setPurchaseForm((p) => ({ ...p, purchase_notes: e.target.value }))
                  }
                  placeholder="تفاصيل الفاتورة أو التسليم..."
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setPurchasingTarget(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={savingPurchase}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-black shadow-xs cursor-pointer"
                >
                  {savingPurchase ? 'جاري التسجيل...' : 'تأكيد الشراء والنقل للسجل'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL 3: Quick Fulfill / Supply Modal for Accessory Shortages      */}
      {/* ================================================================= */}
      {fulfillTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4"
          onClick={() => setFulfillTarget(null)}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-[95vw] sm:w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="font-black text-sm text-slate-900">
                  توريد واستلام نقص الإكسسوار
                </h3>
                <p className="text-[11px] text-slate-500">
                  {fulfillTarget.item.name} ({fulfillTarget.item.code})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFulfillTarget(null)}
                className="p-1.5 rounded-full hover:bg-slate-200 text-slate-500 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmFulfillSupply} className="p-5 space-y-4">
              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500 font-bold">المتاح حالياً:</span>
                  <strong className="font-mono text-slate-900">
                    {fulfillTarget.available} {fulfillTarget.item.unit}
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-bold">العجز المطلوب:</span>
                  <strong className="font-mono text-rose-700">
                    {fulfillTarget.deficit} {fulfillTarget.item.unit}
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-bold">المورد المسجل:</span>
                  <strong className="text-slate-800">
                    {fulfillTarget.supplier?.name || 'غير محدد'}
                  </strong>
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 mb-1">
                  الكمية المورّدة / المطلوبة ({fulfillTarget.item.unit})
                </label>
                <input
                  type="number"
                  step="any"
                  min="0.001"
                  required
                  value={fulfillQty}
                  onChange={(e) => setFulfillQty(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-mono font-bold focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 mb-1">
                  ملاحظات التوريد (اختياري)
                </label>
                <input
                  type="text"
                  value={fulfillNotes}
                  onChange={(e) => setFulfillNotes(e.target.value)}
                  placeholder="ملاحظات الاستلام..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-2 border-t border-slate-100">
                {canSendWhatsApp() && (
                  <button
                    type="button"
                    onClick={handleCopyFulfillWhatsapp}
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold cursor-pointer"
                  >
                    {copiedWhatsapp ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>تم النسخ وفتح واتساب</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>طلب عبر واتساب</span>
                      </>
                    )}
                  </button>
                )}

                <div className="flex items-center gap-2 ms-auto">
                  <button
                    type="button"
                    onClick={() => setFulfillTarget(null)}
                    className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
                  >
                    إلغاء
                  </button>
                  {canEditAccessories && (
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-black cursor-pointer"
                    >
                      تأكيد الاستلام بالمخزن
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
