import { api } from '../api/client';
import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import {
  User,
  AuditLog,
  SizeDef,
  Supplier,
  Fabric,
  FabricColor,
  FabricTransaction,
  DesignModel,
  ModelRequirement,
  ModelAccessory,
  CuttingRecord,
  CuttingSpreadLayer,
  QCRecord,
  QCMatrixCellInput,
  QCStageType,
  GarmentPart,
  GarmentComposition,
  partsForComposition,
  DEFAULT_GARMENT_COMPOSITION,
  PART_ORDER,
  getPartLabel,
  PrintDispatch,
  DispatchStatus,
  CustomRole,
  SystemSectionKey,
  RolePermissions,
  HRSectionKey,
  HR_SECTION_KEYS,
  HR_SECTION_PERM_MAP,
  RankLevel,
  RankOption,
  GlobalSiteSettings,
  AccessoryType,
  AccessoryItem,
  AccessoryTransaction,
  AccessoryUnit,
  AccessoryUsageType,
  ModelTimelineEvent,
  SewingDispatch,
  AppNotification,
  InternalMessage,
  PackagingRequirement,
  PackagingStepKey,
  FinishingRecord,
  AssemblyStageRecord,
  AssemblyStageKey
} from '../types';

interface FlashMessage {
  id: string;
  type: 'success' | 'danger' | 'warning' | 'info';
  text: string;
}

const DEFAULT_GLOBAL_SETTINGS: GlobalSiteSettings = {
  site_name: 'نظام إدارة المصنع',
  logo: '🏭',
  footer_title: '🏭 نظام إدارة المصنع المتكامل - مصانع الملابس الجاهزة (ERP v2.0)',
  copyright_text: `تم التطوير لدعم دورة الإنتاج الشاملة والصلاحيات المتقدمة © ${new Date().getFullYear()}`,
  whatsapp_supplier_template:
    'السلام عليكم ورحمة الله، مطلوب طلبية توريد عاجلة لمصنعنا:\n- الصنف / الخامة: {item_name}\n- الكود / اللون: {code}\n- الكمية المطلوبة: {quantity} {unit}\n- الرصيد الحالي بالمخزن: {available} {unit}\nبرجاء التأكيد وتحديد موعد الشحن. شكراً لكم.',
  default_sewing_instructions:
    'تم التأكد من أعداد الإكسسوارات ومطابقتها للمواصفات الفنية وعينة الاعتماد قبل التسليم للورشة.\nيرجى الالتزام التام بمقاسات القص والتشطيب النظيف وموعد الاستلام المتوقع.',
  internal_message_templates: [
    'يرجى سرعة مراجعة واعتماد الموديل المحول لقسمكم.',
    'تم الانتهاء من المرحلة الحالية وجارٍ تسليم القطع للقسم التالي.',
    'تنبيه: يوجد نقص في بعض المستلزمات، يرجى المراجعة العاجلة.'
  ],
  favorite_accessory_ids: []
};

const DESIGN_STAGES = new Set(['مرحلة التصميم', 'تصميم']);

interface AppContextType {
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
  login: (username: string, password: string) => Promise<{ success: boolean; message: string }>;
  logout: () => void;
  refreshState: () => Promise<void>;
  isLoadingState: boolean;
  globalSettings: GlobalSiteSettings;
  updateGlobalSettings: (updates: Partial<GlobalSiteSettings>) => Promise<boolean>;
  formatSupplierWhatsappMessage: (params: {
    supplierName?: string;
    itemName: string;
    code: string;
    quantity: number | string;
    unit: string;
    available: number | string;
    modelCode?: string;
  }) => string;
  users: User[];
  onlineUsers: User[];
  roles: CustomRole[];
  auditLogs: AuditLog[];
  sizeDefs: SizeDef[];
  suppliers: Supplier[];
  fabrics: Fabric[];
  fabricColors: FabricColor[];
  fabricTransactions: FabricTransaction[];
  models: DesignModel[];
  requirements: ModelRequirement[];
  accessories: ModelAccessory[];
  modelAccessories: ModelAccessory[];
  cuttingRecords: CuttingRecord[];
  qcRecords: QCRecord[];
  printDispatches: PrintDispatch[];
  sewingDispatches: SewingDispatch[];
  packagingRequirements: PackagingRequirement[];
  finishingRecords: FinishingRecord[];
  assemblyStageRecords: AssemblyStageRecord[];
  appNotifications: AppNotification[];
  unreadNotificationsCount: number;
  markNotificationRead: (id: string) => void;
  flashMessages: FlashMessage[];
  addFlashMessage: (text: string, type?: 'success' | 'danger' | 'warning' | 'info') => void;
  removeFlashMessage: (id: string) => void;

  // Dynamic Role Management
  addRole: (data: Omit<CustomRole, 'id'>) => void;
  updateRole: (id: string, updates: Partial<CustomRole>) => void;
  deleteRole: (id: string) => { success: boolean; message: string };

  // Permission helper with all system sections + fine-grained checks
  hasPermission: (
    module: SystemSectionKey | 'warehouse' | 'design' | 'cutting' | 'qc' | 'reports',
    requireEdit?: boolean
  ) => boolean;
  hasSpecificPermission: (permKey: keyof RolePermissions | string) => boolean;

  // Dynamic Administrative & Global Settings Permission Checkers (Tasks 2 & 3)
  canManagePermissions: () => boolean;
  canManageUsers: () => boolean;
  canManageSuppliers: () => boolean;
  canManageSizes: () => boolean;
  canViewAuditLogs: () => boolean;
  canViewGlobalSettings: () => boolean;
  canEditHeaderSettings: () => boolean;
  canEditMessageTemplates: () => boolean;
  canAccessSettings: () => boolean;
  canManageHR: () => boolean;

  // Strict Hierarchical Ranks (الرتب الهرمية الصارمة)
  currentUserRank: number;
  visibleRankLevels: () => RankLevel[];
  visibleRankOptions: () => RankOption[];
  rankLabelFor: (rank: number) => string;

  // Per-tab HR permissions (الصلاحيات المستقلة لتبويبات الموارد البشرية)
  canAccessHRSection: (section: HRSectionKey) => boolean;

  // Department Notes Permission Checkers (Task 4)
  canAddDesignNotes: () => boolean;
  canAddCuttingNotes: () => boolean;
  canAddQCBeforePrintNotes: () => boolean;
  canAddQCAfterPrintNotes: () => boolean;
  canAddSewingNotes: () => boolean;
  canAddPrintingNotes: () => boolean;

  // Internal Messaging System
  internalMessages: InternalMessage[];
  unreadMessagesCount: number;
  sendInternalMessage: (receiverId: string, content: string) => { success: boolean; message: string };
  markMessageRead: (messageId: string) => void;

  // Financial & Sensitive Permissions Checkers
  canViewFabricPrices: () => boolean;
  canEditFabricPrices: () => boolean;
  canViewAccessoryPrices: () => boolean;
  canEditAccessoryPrices: () => boolean;
  canViewPrintingCosts: () => boolean;
  canEditPrintingCosts: () => boolean;
  canSendWhatsApp: () => boolean;
  canSendMessages: () => boolean;

  // Warehouse Actions
  addFabricOrColor: (data: {
    fabricId?: string;
    newFabricName?: string;
    unit?: 'توب' | 'كيلو' | 'متر';
    colorCode: string;
    colorName?: string;
    hexCode?: string;
    quantity: number;
    supplierId?: string;
  }) => { success: boolean; message: string; fabricId: string };
  recordTransaction: (data: {
    colorId: string;
    operation: 'add' | 'deduct';
    amount: number;
    modelCodeRef?: string;
    notes?: string;
  }) => { success: boolean; message: string };
  exportWarehouseInventoryCsv: () => void;
  updateColorPrice: (colorId: string, price: number) => void;

  // Accessories Warehouse Actions
  accessoryTypes: AccessoryType[];
  accessoryItems: AccessoryItem[];
  accessoryTransactions: AccessoryTransaction[];
  addAccessoryType: (name: string, description?: string) => string;
  addAccessoryItem: (data: {
    type_id: string;
    type_name?: string;
    code: string;
    name: string;
    image?: string;
    unit: AccessoryUnit;
    quantity: number;
    price_per_unit: number;
    supplier_id?: string;
    min_threshold: number;
    usage_type?: AccessoryUsageType;
    custom_model_code?: string;
    target_quantity?: number;
    delivered_quantity?: number;
  }) => { success: boolean; message: string; itemId: string };
  updateAccessoryItem: (id: string, updates: Partial<AccessoryItem>) => void;
  deleteAccessoryItem: (id: string) => { success: boolean; message: string };
  recordAccessoryTransaction: (data: {
    accessoryId: string;
    operation: 'add' | 'deduct';
    amount: number;
    modelCodeRef?: string;
    notes?: string;
  }) => { success: boolean; message: string };
  exportAccessoryInventoryCsv: () => void;
  markAccessoryWithdrawn: (accessoryId: string) => void;

  // Design Actions
  addDesignModel: (data: {
    modelCode: string;
    modelType: string;
    sizeCategoryId?: string;
    imageUrl?: string;
    targetCutQuantity?: number;
    designNotes?: string;
    notesShirt?: string;
    notesPants?: string;
    garmentComposition?: GarmentComposition;
  }) => { success: boolean; message: string; modelId?: string };
  updateModelPlan: (data: {
    modelId: string;
    reqQuantities: Record<string, number>;
    accQuantities: Record<string, number>;
    mainMarkerUrl?: string;
    printMarkerUrl?: string;
    designNotes?: string;
    notesShirt?: string;
    notesPants?: string;
    targetCutQuantity?: number;
  }) => { success: boolean; message: string };
  updateModelNotesAndTarget: (
    modelId: string,
    data: {
      target_cut_quantity?: number;
      design_notes?: string;
      notes_shirt?: string;
      notes_pants?: string;
      garment_composition?: GarmentComposition;
    }
  ) => void;
  addModelRequirement: (
    modelId: string,
    colorId: string,
    partName: string,
    plannedQuantity?: number
  ) => { success: boolean; message: string };
  deleteModelRequirement: (reqId: string) => void;
  addModelAccessory: (
    modelId: string,
    accessory: {
      id?: string;
      code?: string;
      name: string;
      unit?: string;
      image?: string;
      target_type?: 'shirt' | 'pants';
      piece_consumption?: number;
      planned_quantity?: number;
    }
  ) => { success: boolean; message: string };
  deleteModelAccessory: (accId: string) => void;
  issueFabricToCutting: (
    modelId: string,
    extraData?: { reqQuantities?: Record<string, number>; accQuantities?: Record<string, number> }
  ) => { success: boolean; message: string };
  deleteDesignModel: (modelId: string) => void;

  // Cutting Actions (Spreads / Lays System)
  addCuttingRecord: (data: {
    modelId: string;
    spreadNumber?: number;
    spreaderName: string;
    cutterName: string;
    colorLayers: CuttingSpreadLayer[];
    colorName?: string;
    layersCount?: number;
    piecesPerLayer: number;
    layerWeight: number;
    piecesCount?: number;
    shadeDegree?: string;
    notes?: string;
    partType?: GarmentPart;
  }) => void;
  finishCuttingToQC: (modelId: string, notes?: string) => void;
  exportCuttingCsv: (modelId: string) => void;

  // QC Actions & Multi-stage Matrix counting (Color x Size)
  getModelParts: (modelId: string) => GarmentPart[];
  getModelColorList: (modelId: string, part?: GarmentPart) => string[];
  getModelSizeList: (modelId: string) => string[];
  recordQCData: (data: {
    modelId: string;
    colorName: string;
    size: string;
    goodQty: number;
    defectQty: number;
    defectNotes?: string;
    stage?: QCStageType;
    partType?: GarmentPart;
  }) => void;
  addQCRecord: (data: any) => void;
  saveQCMatrix: (data: {
    modelId: string;
    stage: QCStageType;
    matrixEntries: QCMatrixCellInput[];
    notes?: string;
    partType?: GarmentPart;
  }) => void;
  recordQCStageCount: (data: {
    modelId: string;
    stage: QCStageType;
    piecesCounted?: number;
    defectQty?: number;
    matrixEntries?: QCMatrixCellInput[];
    defectNotes?: string;
    advanceStage?: boolean;
    partType?: GarmentPart;
  }) => void;
  finishQCApproval: (modelId: string) => void;
  exportQcCsv: (modelId: string) => void;

  // Printing & Embroidery Actions
  addPrintDispatch: (data: {
    modelId: string;
    shopName: string;
    piecesCount: number;
    printType: string;
    pieceType?: GarmentPart;
    pieceLabel?: string;
    printLocation?: string;
    printDetails?: string;
    expectedDeliveryDate?: string;
    costPerPiece?: number;
    totalCost?: number;
    notes?: string;
  }) => void;
  updateDispatchStatus: (dispatchId: string, status: DispatchStatus) => void;

  // Sewing Actions
  dispatchModelToSewing: (data: {
    modelId: string;
    workshopName: string;
    piecesCount: number;
    expectedDeliveryDate: string;
    pieceType?: GarmentPart;
    pieceLabel?: string;
    notes?: string;
  }) => void;
  receiveModelFromSewing: (dispatchId: string, modelId?: string, notes?: string) => void;
  finishSewingToQC: (modelId: string, notes?: string) => void;
  finishQCToProduction: (modelId: string, notes?: string) => void;

  // Assembly & Packaging Actions (الأسمبلي والأمبالاج)
  getPackagingRequirement: (modelId: string) => PackagingRequirement | undefined;
  setPackagingStep: (modelId: string, step: PackagingStepKey, date?: string, notes?: string) => void;
  startFinishing: (data: {
    modelId: string;
    parts?: GarmentPart[];
    entryDate?: string;
    expectedExitDate?: string;
    notes?: string;
  }) => void;
  receiveFinishing: (recordId: string, actualExitDate?: string, notes?: string) => void;
  startAssemblyStage: (data: {
    modelId: string;
    stage: AssemblyStageKey;
    entryDate?: string;
    expectedExitDate?: string;
    notes?: string;
  }) => void;
  receiveAssemblyStage: (recordId: string, actualExitDate?: string, notes?: string) => void;

  // Settings Actions
  addSizeDef: (name: string, values: string) => void;
  updateSizeDef: (id: string, name: string, values: string) => void;
  deleteSizeDef: (id: string) => void;
  addSupplier: (name: string, phone: string) => void;
  updateSupplier: (id: string, name: string, phone: string) => void;
  deleteSupplier: (id: string) => void;
  addUser: (user: Omit<User, 'id'>) => void;
  toggleUserActive: (userId: string) => { success: boolean; message: string };
  updateUserPermissionsAndPassword: (
    userId: string,
    permissions: User['permissions'],
    newPassword?: string,
    newRole?: string,
    roleId?: string,
    newRank?: number
  ) => void;
  deleteUser: (userId: string) => { success: boolean; message: string };

  // Log & Timeline helper
  logAction: (action: string, details: string) => void;
  addModelTimelineEvent: (modelId: string, event: Omit<ModelTimelineEvent, 'id' | 'timestamp'>) => void;
}

const AppContext = createContext<AppContextType | null>(null);

const LEGACY_STORAGE_KEYS = [
  'factory_erp_roles',
  'factory_erp_users',
  'factory_erp_sizes',
  'factory_erp_suppliers',
  'factory_erp_fabrics',
  'factory_erp_colors',
  'factory_erp_transactions',
  'factory_erp_acc_types',
  'factory_erp_acc_items',
  'factory_erp_acc_transactions',
  'factory_erp_models',
  'factory_erp_requirements',
  'factory_erp_accessories',
  'factory_erp_cutting',
  'factory_erp_qc',
  'factory_erp_print_dispatches',
  'factory_erp_sewing_dispatches',
  'factory_erp_internal_messages',
  'factory_erp_logs'
];

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useEffect(() => {
    try {
      LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    } catch {
      // ignore storage errors
    }
  }, []);

  const [currentUser, setCurrentUserState] = useState<User | null>(() => {
    try {
      const token = localStorage.getItem('factory_erp_auth_token');
      const storedUser = localStorage.getItem('factory_erp_current_user');
      if (!token || !storedUser) {
        localStorage.removeItem('factory_erp_current_user');
        localStorage.removeItem('factory_erp_auth_token');
        return null;
      }
      return JSON.parse(storedUser);
    } catch {
      return null;
    }
  });

  const [isLoadingState, setIsLoadingState] = useState<boolean>(true);
  const [globalSettings, setGlobalSettings] = useState<GlobalSiteSettings>(DEFAULT_GLOBAL_SETTINGS);
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<User[]>([]);
  const [sizeDefs, setSizeDefs] = useState<SizeDef[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [fabrics, setFabrics] = useState<Fabric[]>([]);
  const [fabricColorsRaw, setFabricColors] = useState<FabricColor[]>([]);
  const [fabricTransactions, setFabricTransactions] = useState<FabricTransaction[]>([]);
  const [models, setModels] = useState<DesignModel[]>([]);
  const [requirements, setRequirements] = useState<ModelRequirement[]>([]);
  const [accessories, setAccessories] = useState<ModelAccessory[]>([]);
  const [accessoryTypes, setAccessoryTypes] = useState<AccessoryType[]>([]);
  const [accessoryItemsRaw, setAccessoryItems] = useState<AccessoryItem[]>([]);
  const [accessoryTransactions, setAccessoryTransactions] = useState<AccessoryTransaction[]>([]);
  const [cuttingRecords, setCuttingRecords] = useState<CuttingRecord[]>([]);
  const [qcRecords, setQcRecords] = useState<QCRecord[]>([]);
  const [printDispatches, setPrintDispatches] = useState<PrintDispatch[]>([]);
  const [sewingDispatches, setSewingDispatches] = useState<SewingDispatch[]>([]);
  const [packagingRequirements, setPackagingRequirements] = useState<PackagingRequirement[]>([]);
  const [finishingRecords, setFinishingRecords] = useState<FinishingRecord[]>([]);
  const [assemblyStageRecords, setAssemblyStageRecords] = useState<AssemblyStageRecord[]>([]);
  const [internalMessages, setInternalMessages] = useState<InternalMessage[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [flashMessages, setFlashMessages] = useState<FlashMessage[]>([]);
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('erp_read_notifications');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  /**
   * Automatically compute `reserved_quantity` for each FabricColor and AccessoryItem
   * from active models in the Design stage ('مرحلة التصميم' or 'تصميم').
   * This guarantees that selecting/planning a fabric for a model in Design ONLY deducts
   * from "Available for Design" (`quantity - reserved_quantity`), while actual total
   * stock (`quantity`) remains untouched until "صرف القماش والتوجيه للقص" is clicked.
   */
  const designModelIdsSet = useMemo(() => {
    return new Set(
      models
        .filter((m) => !m.is_deleted && DESIGN_STAGES.has(m.status))
        .map((m) => m.id)
    );
  }, [models]);

  const fabricColors = useMemo<FabricColor[]>(() => {
    const reservedByColor: Record<string, number> = {};
    requirements.forEach((req) => {
      if (designModelIdsSet.has(req.model_id)) {
        const qty = Math.max(0, Number(req.planned_quantity) || 0);
        reservedByColor[req.color_id] = Number(
          ((reservedByColor[req.color_id] || 0) + qty).toFixed(2)
        );
      }
    });
    return fabricColorsRaw.map((c) => ({
      ...c,
      reserved_quantity: reservedByColor[c.id] ?? 0
    }));
  }, [fabricColorsRaw, requirements, designModelIdsSet]);

  const accessoryItems = useMemo<AccessoryItem[]>(() => {
    const reservedByAcc: Record<string, number> = {};
    accessories.forEach((acc) => {
      if (acc.accessory_id && designModelIdsSet.has(acc.model_id)) {
        const qty = Math.max(0, Number(acc.planned_quantity) || 0);
        reservedByAcc[acc.accessory_id] = Number(
          ((reservedByAcc[acc.accessory_id] || 0) + qty).toFixed(2)
        );
      }
    });
    return accessoryItemsRaw.map((it) => ({
      ...it,
      reserved_quantity: reservedByAcc[it.id] ?? 0
    }));
  }, [accessoryItemsRaw, accessories, designModelIdsSet]);

  const removeFlashMessage = useCallback((id: string) => {
    setFlashMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const addFlashMessage = useCallback(
    (text: string, type: 'success' | 'danger' | 'warning' | 'info' = 'success') => {
      const id = 'flash-' + Date.now() + Math.random().toString(36).slice(2, 6);
      setFlashMessages((prev) => [...prev, { id, type, text }]);
      setTimeout(() => {
        removeFlashMessage(id);
      }, 4500);
    },
    [removeFlashMessage]
  );

  const setCurrentUser = useCallback((user: User | null) => {
    setCurrentUserState(user);
    try {
      if (user) {
        localStorage.setItem('factory_erp_current_user', JSON.stringify(user));
      } else {
        localStorage.removeItem('factory_erp_current_user');
        localStorage.removeItem('factory_erp_auth_token');
      }
    } catch {
      // ignore
    }
  }, []);

  const refreshState = useCallback(async () => {
    try {
      const state = await api.getState();
      if (state) {
        if (state.globalSettings) {
          setGlobalSettings({
            ...DEFAULT_GLOBAL_SETTINGS,
            ...state.globalSettings
          });
        }
        setRoles(Array.isArray(state.roles) ? state.roles : []);
        // Strictly filter out sudo from any frontend user list (Task 2)
        const rawUsers: User[] = Array.isArray(state.users) ? state.users : [];
        setUsers(
          rawUsers.filter((u) => u.username?.toLowerCase() !== 'sudo' && !u.is_sudo)
        );
        const rawOnlineUsers: User[] = Array.isArray(state.onlineUsers) ? state.onlineUsers : [];
        setOnlineUsers(
          rawOnlineUsers.filter((u) => u.username?.toLowerCase() !== 'sudo' && !u.is_sudo)
        );
        setSizeDefs(Array.isArray(state.sizeDefs) ? state.sizeDefs : []);
        setSuppliers(Array.isArray(state.suppliers) ? state.suppliers : []);
        setFabrics(Array.isArray(state.fabrics) ? state.fabrics : []);
        setFabricColors(Array.isArray(state.fabricColors) ? state.fabricColors : []);
        setFabricTransactions(Array.isArray(state.fabricTransactions) ? state.fabricTransactions : []);
        setAccessoryTypes(Array.isArray(state.accessoryTypes) ? state.accessoryTypes : []);
        setAccessoryItems(Array.isArray(state.accessoryItems) ? state.accessoryItems : []);
        setAccessoryTransactions(
          Array.isArray(state.accessoryTransactions) ? state.accessoryTransactions : []
        );
        setModels(Array.isArray(state.models) ? state.models : []);
        setRequirements(Array.isArray(state.requirements) ? state.requirements : []);
        setAccessories(Array.isArray(state.accessories) ? state.accessories : []);
        setCuttingRecords(Array.isArray(state.cuttingRecords) ? state.cuttingRecords : []);
        setQcRecords(Array.isArray(state.qcRecords) ? state.qcRecords : []);
        setPrintDispatches(Array.isArray(state.printDispatches) ? state.printDispatches : []);
        setSewingDispatches(Array.isArray(state.sewingDispatches) ? state.sewingDispatches : []);
        setPackagingRequirements(
          Array.isArray(state.packagingRequirements) ? state.packagingRequirements : []
        );
        setFinishingRecords(Array.isArray(state.finishingRecords) ? state.finishingRecords : []);
        setAssemblyStageRecords(
          Array.isArray(state.assemblyStageRecords) ? state.assemblyStageRecords : []
        );
        setInternalMessages(Array.isArray(state.internalMessages) ? state.internalMessages : []);
        const rawLogs: AuditLog[] = Array.isArray(state.auditLogs) ? state.auditLogs : [];
        setAuditLogs(
          rawLogs.filter(
            (l) =>
              l.userId?.toLowerCase() !== 'user-sudo' &&
              !l.userName?.toLowerCase().includes('sudo')
          )
        );
      }
    } catch (err) {
      console.error('Failed to sync state from backend:', err);
    } finally {
      setIsLoadingState(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function bootstrap() {
      const token = localStorage.getItem('factory_erp_auth_token');
      if (token) {
        try {
          const meRes = await api.getMe();
          if (isMounted && meRes?.user) {
            setCurrentUser(meRes.user);
          }
        } catch {
          if (isMounted) {
            setCurrentUser(null);
          }
        }
      }
      if (isMounted) {
        await refreshState();
      }
    }

    bootstrap();

    const handleFocus = () => {
      if (localStorage.getItem('factory_erp_auth_token')) {
        refreshState();
      }
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      isMounted = false;
      window.removeEventListener('focus', handleFocus);
    };
  }, [refreshState, setCurrentUser]);

  // Live ONLINE heartbeat: keeps `last_seen` fresh and refreshes the online users list.
  useEffect(() => {
    if (!currentUser) {
      setOnlineUsers([]);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      if (!localStorage.getItem('factory_erp_auth_token')) return;
      try {
        const res = await api.heartbeat();
        if (cancelled) return;
        const list: User[] = Array.isArray(res?.onlineUsers) ? res.onlineUsers : [];
        setOnlineUsers(
          list.filter((u) => u.username?.toLowerCase() !== 'sudo' && !u.is_sudo)
        );
      } catch {
        // Silently ignore heartbeat errors (offline / session expired handled elsewhere)
      }
    };
    tick();
    const intervalId = window.setInterval(tick, 45000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [currentUser]);

  const login = async (
    username: string,
    password: string
  ): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await api.login(username, password);
      localStorage.setItem('factory_erp_auth_token', res.token);
      setCurrentUser(res.user);
      await refreshState();
      return { success: true, message: 'تم تسجيل الدخول بنجاح' };
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'اسم المستخدم أو كلمة المرور غير صحيحة'
      };
    }
  };

  const logout = useCallback(() => {
    api.logout().catch(() => {});
    setCurrentUser(null);
  }, [setCurrentUser]);

  const logAction = (action: string, details: string) => {
    // Do not log sudo emergency account actions into visible audit logs (Task 2)
    if (currentUser?.username?.toLowerCase() === 'sudo' || currentUser?.is_sudo) {
      return;
    }
    const newLog: AuditLog = {
      id: 'log-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
      userName: currentUser?.real_name || currentUser?.username || 'مستخدم غير معروف',
      userId: currentUser?.id,
      action,
      details,
      ip_address: '127.0.0.1',
      timestamp: new Date().toLocaleString('ar-EG', { hour12: false })
    };
    setAuditLogs((prev) => [newLog, ...prev.slice(0, 200)]);
    api.createAuditLog(newLog).catch((err) => console.error('AuditLog error:', err));
  };

  const updateGlobalSettings = async (updates: Partial<GlobalSiteSettings>): Promise<boolean> => {
    const previous = { ...globalSettings };
    const optimistic = { ...globalSettings, ...updates };
    setGlobalSettings(optimistic);
    try {
      const saved = await api.updateGlobalSettings(updates);
      setGlobalSettings({ ...DEFAULT_GLOBAL_SETTINGS, ...saved });
      logAction('إعدادات الموقع العامة', 'تحديث إعدادات الموقع والرسائل الجاهزة');
      addFlashMessage('تم حفظ الإعدادات العامة للموقع بنجاح');
      return true;
    } catch (err: any) {
      setGlobalSettings(previous);
      addFlashMessage(err?.message || 'فشل حفظ الإعدادات العامة في السيرفر', 'danger');
      return false;
    }
  };

  const formatSupplierWhatsappMessage = (params: {
    supplierName?: string;
    itemName: string;
    code: string;
    quantity: number | string;
    unit: string;
    available: number | string;
    modelCode?: string;
  }): string => {
    const tpl =
      globalSettings?.whatsapp_supplier_template ||
      DEFAULT_GLOBAL_SETTINGS.whatsapp_supplier_template;
    return tpl
      .replace(/\{supplier_name\}/g, params.supplierName || 'حضرة المورد')
      .replace(/\{item_name\}/g, params.itemName || '')
      .replace(/\{code\}/g, params.code || '')
      .replace(/\{quantity\}/g, String(params.quantity ?? ''))
      .replace(/\{unit\}/g, params.unit || '')
      .replace(/\{available\}/g, String(params.available ?? ''))
      .replace(/\{model_code\}/g, params.modelCode || '');
  };

  const addModelTimelineEvent = (
    modelId: string,
    event: Omit<ModelTimelineEvent, 'id' | 'timestamp'>
  ) => {
    const newEvent: ModelTimelineEvent = {
      ...event,
      id: 'tl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
      timestamp: new Date().toLocaleString('ar-EG', { hour12: false })
    };
    setModels((prev) =>
      prev.map((m) => {
        if (m.id !== modelId) return m;
        return {
          ...m,
          timeline: [newEvent, ...(m.timeline || [])]
        };
      })
    );
    api.addModelTimeline(modelId, newEvent).catch((err) => console.error('Timeline error:', err));
  };

  // Dynamic Role Management
  const addRole = (data: Omit<CustomRole, 'id'>) => {
    const newRole: CustomRole = {
      ...data,
      // حماية الرتب: دور جديد لا يحمل رتبة أعلى من رتبة منشئه.
      rank_level: clampRankToVisible(data.rank_level),
      id: 'role-' + Date.now(),
      users_count: 0,
      created_at: new Date().toISOString()
    };
    setRoles((prev) => [...prev, newRole]);
    api
      .createRole(newRole)
      .then((saved) => {
        setRoles((prev) => prev.map((r) => (r.id === newRole.id ? saved : r)));
        logAction('الصلاحيات', `إنشاء دور وظيفي جديد: ${newRole.name}`);
        addFlashMessage(`تم إنشاء الدور "${newRole.name}" بنجاح`);
      })
      .catch((err) => {
        setRoles((prev) => prev.filter((r) => r.id !== newRole.id));
        addFlashMessage(err.message || 'فشل إنشاء الدور في الباك إند', 'danger');
      });
  };

  const updateRole = (id: string, updates: Partial<CustomRole>) => {
    const previousRoles = [...roles];
    // حماية الرتب: منع رفع الدور إلى رتبة مساوية أو أعلى من رتبة المستخدم الحالي،
    // ومنع تعديل أدوار أعلى من رتبته أصلاً.
    const targetRole = roles.find((r) => r.id === id);
    if (targetRole && !isRankVisibleToActor(targetRole.rank_level)) {
      addFlashMessage('لا تمتلك صلاحية تعديل هذا الدور', 'danger');
      return;
    }
    const safeUpdates: Partial<CustomRole> = {
      ...updates,
      ...(updates.rank_level !== undefined
        ? { rank_level: clampRankToVisible(updates.rank_level) }
        : {})
    };
    setRoles((prev) => prev.map((r) => (r.id === id ? { ...r, ...safeUpdates } : r)));
    api
      .updateRole(id, safeUpdates)
      .then((saved) => {
        setRoles((prev) => prev.map((r) => (r.id === id ? saved : r)));
        logAction('الصلاحيات', `تحديث صلاحيات الدور: ${updates.name || id}`);
        addFlashMessage('تم تحديث الدور الوظيفي بنجاح');
      })
      .catch((err) => {
        setRoles(previousRoles);
        addFlashMessage(err.message || 'فشل تحديث الدور في الباك إند', 'danger');
      });
  };

  const deleteRole = (id: string): { success: boolean; message: string } => {
    const role = roles.find((r) => r.id === id);
    // حماية الرتب: لا يمكن حذف دور أعلى من رتبة المستخدم الحالي.
    if (role && !isRankVisibleToActor(role.rank_level)) {
      return { success: false, message: 'لا تمتلك صلاحية حذف هذا الدور' };
    }
    const roleUsers = users.filter((u) => u.role_id === id);
    if (roleUsers.length > 0) {
      return {
        success: false,
        message: `لا يمكن حذف هذا الدور لوجود ${roleUsers.length} موظف مرتبط به حالياً.`
      };
    }
    const previousRoles = [...roles];
    setRoles((prev) => prev.filter((r) => r.id !== id));
    api
      .deleteRole(id)
      .then(() => {
        logAction('الصلاحيات', `حذف الدور: ${role?.name || id}`);
        addFlashMessage('تم حذف الدور الوظيفي بنجاح');
      })
      .catch((err) => {
        setRoles(previousRoles);
        addFlashMessage(err.message || 'فشل حذف الدور من الباك إند', 'danger');
      });
    return { success: true, message: 'تم الحذف بنجاح' };
  };

  // Permission Resolver
  const getUserPermissionsObject = (): RolePermissions | null => {
    if (!currentUser) return null;
    if (currentUser.username?.toLowerCase() === 'sudo' || currentUser.is_sudo) {
      return {
        fabric_warehouse_view: true,
        fabric_warehouse_edit: true,
        accessories_warehouse_view: true,
        accessories_warehouse_edit: true,
        production_warehouse_view: true,
        production_warehouse_edit: true,
        design_view: true,
        design_edit: true,
        cutting_view: true,
        cutting_edit: true,
        qc_view: true,
        qc_edit: true,
        printing_view: true,
        printing_edit: true,
        sewing_view: true,
        sewing_edit: true,
        assembly_packaging_view: true,
        assembly_packaging_edit: true,
        models_tracking_view: true,
        models_tracking_edit: true,
        reports_view: true,
        reports_edit: true,
        view_fabric_prices: true,
        edit_fabric_prices: true,
        view_accessory_prices: true,
        edit_accessory_prices: true,
        view_printing_costs: true,
        edit_printing_costs: true,
        send_whatsapp_requests: true,
        send_internal_messages: true,
        manage_permissions: true,
        manage_users: true,
        manage_suppliers: true,
        manage_sizes: true,
        view_audit_logs: true,
        view_global_settings: true,
        edit_header_settings: true,
        edit_message_templates: true,
        can_manage_hr: true,
        hr_jobs: true,
        hr_employees: true,
        hr_attendance: true,
        hr_rules: true,
        hr_loans: true,
        hr_penalties: true,
        hr_payroll: true,
        can_add_design_notes: true,
        can_add_cutting_notes: true,
        can_add_qc_before_print_notes: true,
        can_add_qc_after_print_notes: true,
        can_add_sewing_notes: true,
        can_add_printing_notes: true
      };
    }

    let baseRolePerms: Partial<RolePermissions> = {};
    if (currentUser.role_id) {
      const role = roles.find((r) => r.id === currentUser.role_id);
      if (role?.permissions) baseRolePerms = { ...role.permissions };
    } else {
      const roleByName = roles.find((r) => r.name === currentUser.role);
      if (roleByName?.permissions) baseRolePerms = { ...roleByName.permissions };
    }

    // Merge user-level custom_permissions on top of role permissions so any permission can be granted to any user!
    if (currentUser.permissions && typeof currentUser.permissions === 'object') {
      return { ...baseRolePerms, ...(currentUser.permissions as any) } as RolePermissions;
    }

    return Object.keys(baseRolePerms).length > 0 ? (baseRolePerms as RolePermissions) : null;
  };

  const hasSpecificPermission = (permKey: keyof RolePermissions | string): boolean => {
    if (!currentUser) return false;
    if (currentUser.username?.toLowerCase() === 'sudo' || currentUser.is_sudo) return true;

    // 1. Check user-level custom_permissions first
    const userCustom = currentUser.permissions as Record<string, any> | undefined;
    if (userCustom && permKey in userCustom && userCustom[permKey] !== undefined) {
      const val = userCustom[permKey];
      if (typeof val === 'string') return val === 'edit' || val === 'view' || val === 'true';
      return Boolean(val);
    }

    // 2. Check role permissions
    const rolePerms = getUserPermissionsObject();
    if (rolePerms && permKey in rolePerms) {
      return Boolean((rolePerms as any)[permKey]);
    }

    return false;
  };

  const hasPermission = (
    module: SystemSectionKey | 'warehouse' | 'design' | 'cutting' | 'qc' | 'reports',
    requireEdit: boolean = false
  ): boolean => {
    if (!currentUser) return false;
    if (currentUser.username?.toLowerCase() === 'sudo' || currentUser.is_sudo) return true;

    const rolePerms = getUserPermissionsObject();

    if (module === 'warehouse') {
      if (rolePerms) {
        if (requireEdit) {
          return Boolean(
            rolePerms.fabric_warehouse_edit ||
              rolePerms.accessories_warehouse_edit ||
              rolePerms.production_warehouse_edit
          );
        }
        return Boolean(
          rolePerms.fabric_warehouse_view ||
            rolePerms.accessories_warehouse_view ||
            rolePerms.production_warehouse_view
        );
      }
      const lvl = currentUser.permissions?.warehouse;
      if (!lvl) return false;
      return requireEdit ? lvl === 'edit' : true;
    }

    const key = module as SystemSectionKey;
    const viewKey = `${key}_view` as keyof RolePermissions;
    const editKey = `${key}_edit` as keyof RolePermissions;

    // Check explicit user overrides if present
    const userCustom = currentUser.permissions as Record<string, any> | undefined;
    if (userCustom) {
      if (requireEdit && editKey in userCustom) return Boolean(userCustom[editKey]);
      if (!requireEdit && viewKey in userCustom) return Boolean(userCustom[viewKey] || userCustom[editKey]);
    }

    if (rolePerms) {
      if (requireEdit) return Boolean(rolePerms[editKey]);
      return Boolean(rolePerms[viewKey] || rolePerms[editKey]);
    }

    const legacyLevel = (currentUser.permissions as any)?.[module];
    if (!legacyLevel) return false;
    return requireEdit ? legacyLevel === 'edit' : true;
  };

  // Dynamic Administrative & Global Settings Checkers (Tasks 2 & 3)
  const canManagePermissions = (): boolean => hasSpecificPermission('manage_permissions');
  const canManageUsers = (): boolean =>
    hasSpecificPermission('manage_users') || hasSpecificPermission('manage_permissions');
  const canManageSuppliers = (): boolean =>
    hasSpecificPermission('manage_suppliers') || hasSpecificPermission('manage_permissions');
  const canManageSizes = (): boolean =>
    hasSpecificPermission('manage_sizes') || hasSpecificPermission('manage_permissions');
  const canViewAuditLogs = (): boolean =>
    hasSpecificPermission('view_audit_logs') || hasSpecificPermission('manage_permissions');
  const canViewGlobalSettings = (): boolean =>
    hasSpecificPermission('view_global_settings') ||
    hasSpecificPermission('edit_header_settings') ||
    hasSpecificPermission('edit_message_templates') ||
    hasSpecificPermission('manage_permissions');
  const canEditHeaderSettings = (): boolean =>
    hasSpecificPermission('edit_header_settings') || hasSpecificPermission('manage_permissions');
  const canEditMessageTemplates = (): boolean =>
    hasSpecificPermission('edit_message_templates') || hasSpecificPermission('manage_permissions');

  const canAccessSettings = (): boolean => {
    if (!currentUser) return false;
    if (currentUser.username?.toLowerCase() === 'sudo' || currentUser.is_sudo) return true;
    return (
      canManagePermissions() ||
      canManageUsers() ||
      canManageSuppliers() ||
      canManageSizes() ||
      canViewAuditLogs() ||
      canViewGlobalSettings()
    );
  };

  // Human Resources (HR) Permission Checker
  // Falls back to manage_permissions so already-privileged admins keep access
  // even before the new flag is toggled on for their role.
  const isCurrentUserSudo = (): boolean =>
    Boolean(
      currentUser &&
        (currentUser.username?.toLowerCase() === 'sudo' || currentUser.is_sudo)
    );

  /**
   * الصلاحية المستقلة لكل تبويب داخل الموارد البشرية.
   * `can_manage_hr` و`manage_permissions` يظلان بمثابة تصريح عام لكل التبويبات.
   */
  const canAccessHRSection = (section: HRSectionKey): boolean => {
    if (!currentUser) return false;
    if (isCurrentUserSudo()) return true;
    if (hasSpecificPermission('can_manage_hr') || hasSpecificPermission('manage_permissions')) {
      return true;
    }
    return hasSpecificPermission(HR_SECTION_PERM_MAP[section]);
  };

  // أي صلاحية من صلاحيات HR السبعة تفتح القسم العام.
  const canManageHR = (): boolean => HR_SECTION_KEYS.some((section) => canAccessHRSection(section));

  // -------------------------------------------------------------------------
  // Strict Hierarchical Ranks (الرتب الهرمية الصارمة والمخفية)
  // 0 = Sudo → {0,1,2,3} | 1 → {2,3} | 2 → {3} | 3 → {3} (أقران فقط)
  // -------------------------------------------------------------------------
  const currentUserRank: RankLevel = (() => {
    if (isCurrentUserSudo()) return 0;
    const rank = Number(currentUser?.rank_level ?? 3);
    return (rank === 0 || rank === 1 || rank === 2 || rank === 3 ? rank : 3) as RankLevel;
  })();

  const visibleRankLevels = (): RankLevel[] => {
    if (currentUserRank === 0) return [0, 1, 2, 3];
    if (currentUserRank === 1) return [2, 3];
    return [3];
  };

  const visibleRankOptions = (): RankOption[] => {
    if (currentUserRank === 0) {
      return [
        { value: 1, label: 'المستوى الأول - إدارة عليا', description: 'رؤية وتحكم في المستويين الثاني والثالث' },
        { value: 2, label: 'المستوى الثاني - إشرافي', description: 'رؤية وتحكم في المستوى العام فقط' },
        { value: 3, label: 'المستوى الثالث - عام', description: 'أقل صلاحيات إدارية على الآخرين' }
      ];
    }
    if (currentUserRank === 1) {
      // بدون أي أرقام أو إشارة لوجود مستوى أعلى.
      return [
        { value: 2, label: 'مستوى إشرافي متقدم', description: 'يشرف ويدير المستوى التشغيلي العام' },
        { value: 3, label: 'مستوى تشغيلي عام', description: 'المستوى التنفيذي العام' }
      ];
    }
    return [{ value: 3, label: 'المستوى العام', description: 'المستوى التنفيذي العام' }];
  };

  const rankLabelFor = (rank: number): string => {
    const labels: Record<number, string> = {
      0: 'السيادة المطلقة (Sudo)',
      1: 'المستوى الأول - إدارة عليا',
      2: 'المستوى الثاني - إشرافي',
      3: 'المستوى الثالث - عام'
    };
    if (currentUserRank === 0) return labels[rank] || '';
    if (currentUserRank === 1) {
      // المستوى الأعلى لا يُعرض أبداً لصاحب هذا المستوى.
      if (rank === 1) return '';
      return rank === 2 ? 'مستوى إشرافي متقدم' : rank === 3 ? 'مستوى تشغيلي عام' : '';
    }
    if (currentUserRank === 2) {
      if (rank === 2) return 'مستوى إداري متقدم';
      return rank === 3 ? 'المستوى العام' : '';
    }
    // الرتبة 3: إخفاء كامل لمفهوم الرتب.
    return '';
  };

  // -------------------------------------------------------------------------
  // حماية الرتب عند المنح: لا يمكن منح/رؤية رتبة مساوية أو أعلى من رتبة الفاعل.
  // -------------------------------------------------------------------------
  const isRankVisibleToActor = (rankValue?: number): boolean => {
    const rank = Number(rankValue ?? 3);
    if (rank === 0) return false;
    if (currentUserRank === 0) return true;
    return visibleRankLevels().includes(rank as RankLevel);
  };

  const clampRankToVisible = (rankValue?: number): RankLevel => {
    const requested = Number(rankValue ?? 3);
    if (currentUserRank === 0) {
      return (requested === 0 ? 3 : requested) as RankLevel;
    }
    const allowed = visibleRankOptions().map((opt) => Number(opt.value));
    if (allowed.includes(requested)) return requested as RankLevel;
    return Number(allowed[allowed.length - 1] ?? 3) as RankLevel;
  };

  // Department Notes Permission Checkers (Task 4)
  const canAddDesignNotes = (): boolean => hasSpecificPermission('can_add_design_notes');
  const canAddCuttingNotes = (): boolean => hasSpecificPermission('can_add_cutting_notes');
  const canAddQCBeforePrintNotes = (): boolean => hasSpecificPermission('can_add_qc_before_print_notes');
  const canAddQCAfterPrintNotes = (): boolean => hasSpecificPermission('can_add_qc_after_print_notes');
  const canAddSewingNotes = (): boolean => hasSpecificPermission('can_add_sewing_notes');
  const canAddPrintingNotes = (): boolean => hasSpecificPermission('can_add_printing_notes');

  // Financial & Communication Permission Checkers
  const canViewFabricPrices = (): boolean => hasSpecificPermission('view_fabric_prices');
  const canEditFabricPrices = (): boolean => hasSpecificPermission('edit_fabric_prices');
  const canViewAccessoryPrices = (): boolean => hasSpecificPermission('view_accessory_prices');
  const canEditAccessoryPrices = (): boolean => hasSpecificPermission('edit_accessory_prices');
  const canViewPrintingCosts = (): boolean => hasSpecificPermission('view_printing_costs');
  const canEditPrintingCosts = (): boolean => hasSpecificPermission('edit_printing_costs');
  const canSendWhatsApp = (): boolean => hasSpecificPermission('send_whatsapp_requests');
  const canSendMessages = (): boolean => hasSpecificPermission('send_internal_messages');

  const unreadMessagesCount = useMemo(() => {
    if (!currentUser) return 0;
    return internalMessages.filter(
      (m) =>
        (m.receiver_id === currentUser.id || m.receiver_id === currentUser.username) && !m.is_read
    ).length;
  }, [internalMessages, currentUser]);

  const sendInternalMessage = (
    receiverId: string,
    content: string
  ): { success: boolean; message: string } => {
    if (!canSendMessages()) {
      addFlashMessage(
        'ليس لديك صلاحية إرسال الرسائل والمراسلات الداخلية. يرجى مراجعة مسؤول الصلاحيات.',
        'danger'
      );
      return { success: false, message: 'ليس لديك صلاحية إرسال الرسائل الداخلية' };
    }
    if (!content.trim()) {
      return { success: false, message: 'لا يمكن إرسال رسالة فارغة' };
    }
    const receiver = users.find((u) => u.id === receiverId || u.username === receiverId);
    if (!receiver) {
      return { success: false, message: 'المستلم المحدد غير موجود' };
    }

    const newMsg: InternalMessage = {
      id: 'msg-' + Date.now(),
      sender_id: currentUser?.id || 'user-sudo',
      sender_name: currentUser?.real_name || 'إدارة النظام',
      receiver_id: receiver.id,
      receiver_name: receiver.real_name,
      content: content.trim(),
      created_at: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
      is_read: false
    };

    setInternalMessages((prev) => [...prev, newMsg]);
    api
      .sendInternalMessage(newMsg)
      .then((saved) => {
        setInternalMessages((prev) => prev.map((m) => (m.id === newMsg.id ? saved : m)));
        logAction('المراسلات الداخلية', `إرسال رسالة من ${currentUser?.real_name} إلى ${receiver.real_name}`);
        addFlashMessage(`تم إرسال الرسالة إلى ${receiver.real_name} بنجاح`, 'success');
      })
      .catch((err) => {
        setInternalMessages((prev) => prev.filter((m) => m.id !== newMsg.id));
        addFlashMessage(err.message || 'فشل إرسال الرسالة عبر الباك إند', 'danger');
      });

    return { success: true, message: 'تم إرسال الرسالة بنجاح' };
  };

  const markMessageRead = (messageId: string) => {
    setInternalMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, is_read: true } : m))
    );
    api.markMessageRead(messageId).catch((err) => console.error('Mark message read error:', err));
  };

  // Warehouse Actions
  const addFabricOrColor = (data: {
    fabricId?: string;
    newFabricName?: string;
    unit?: 'توب' | 'كيلو' | 'متر';
    colorCode: string;
    colorName?: string;
    hexCode?: string;
    quantity: number;
    supplierId?: string;
  }) => {
    let targetFabricId = data.fabricId;
    const newFabricClientId = 'fab-' + Date.now();
    const colorClientId = 'col-' + Date.now();

    if (!targetFabricId && data.newFabricName?.trim()) {
      const newFab: Fabric = {
        id: newFabricClientId,
        name: data.newFabricName.trim(),
        description: '',
        unit: data.unit || 'كيلو',
        supplier_id: data.supplierId
      };
      setFabrics((prev) => [...prev, newFab]);
      targetFabricId = newFab.id;
    }

    if (!targetFabricId) {
      return { success: false, message: 'يجب اختيار خامة أو كتابة اسم خامة جديدة', fabricId: '' };
    }

    const cleanCode = data.colorCode.trim().toUpperCase();
    const existingColor = fabricColors.find(
      (c) => c.fabric_id === targetFabricId && c.color_code.toUpperCase() === cleanCode
    );

    if (existingColor) {
      setFabricColors((prev) =>
        prev.map((c) =>
          c.id === existingColor.id
            ? { ...c, quantity: Number((c.quantity + data.quantity).toFixed(2)) }
            : c
        )
      );
    } else {
      const newColor: FabricColor = {
        id: colorClientId,
        fabric_id: targetFabricId,
        color_code: cleanCode,
        color_name: data.colorName || '',
        hex_code: data.hexCode || '#64748b',
        price_per_unit: 0,
        quantity: Math.max(0, data.quantity),
        reserved_quantity: 0
      };
      setFabricColors((prev) => [...prev, newColor]);
    }

    api
      .addFabricOrColor({
        ...data,
        newFabricClientId,
        colorClientId
      })
      .then((res) => {
        if (res.fabric) {
          setFabrics((prev) => {
            const exists = prev.some((f) => f.id === res.fabric.id);
            return exists ? prev.map((f) => (f.id === res.fabric.id ? res.fabric : f)) : [...prev, res.fabric];
          });
        }
        if (res.color) {
          setFabricColors((prev) => {
            const exists = prev.some((c) => c.id === res.color.id);
            return exists ? prev.map((c) => (c.id === res.color.id ? res.color : c)) : [...prev, res.color];
          });
        }
        logAction('المخزن', `استلام كمية ${data.quantity} للون ${cleanCode}`);
        addFlashMessage(`تم حفظ بيانات اللون ${cleanCode} في قاعدة البيانات بنجاح`);
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل حفظ الخامة في الباك إند', 'danger');
      });

    return { success: true, message: 'تم الحفظ بنجاح', fabricId: targetFabricId };
  };

  const recordTransaction = (data: {
    colorId: string;
    operation: 'add' | 'deduct';
    amount: number;
    modelCodeRef?: string;
    notes?: string;
  }) => {
    const color = fabricColors.find((c) => c.id === data.colorId);
    if (!color) return { success: false, message: 'اللون غير موجود' };
    if (data.amount <= 0) return { success: false, message: 'الكمية يجب أن تكون أكبر من صفر' };

    if (data.operation === 'deduct' && color.quantity < data.amount) {
      return { success: false, message: 'الكمية الموجودة بالمخزن لا تكفي للصرف' };
    }

    const trId = 'tr-' + Date.now();
    const timestamp = new Date().toLocaleString('ar-EG', { hour12: false });

    setFabricColors((prev) =>
      prev.map((c) => {
        if (c.id !== data.colorId) return c;
        const newQty =
          data.operation === 'add'
            ? Number((c.quantity + data.amount).toFixed(2))
            : Number((c.quantity - data.amount).toFixed(2));
        return { ...c, quantity: Math.max(0, newQty) };
      })
    );

    const transaction: FabricTransaction = {
      id: trId,
      color_id: data.colorId,
      fabric_id: color.fabric_id,
      model_code_ref: data.modelCodeRef || '',
      notes: data.notes || '',
      operation: data.operation,
      amount: data.amount,
      timestamp
    };
    setFabricTransactions((prev) => [transaction, ...prev]);

    api
      .recordFabricTransaction({
        id: trId,
        colorId: data.colorId,
        operation: data.operation,
        amount: data.amount,
        modelCodeRef: data.modelCodeRef || '',
        notes: data.notes || '',
        timestamp
      })
      .then((res) => {
        if (res.color) {
          setFabricColors((prev) => prev.map((c) => (c.id === res.color.id ? res.color : c)));
        }
        if (res.transaction) {
          setFabricTransactions((prev) =>
            prev.map((t) => (t.id === trId ? res.transaction : t))
          );
        }
        const opText = data.operation === 'add' ? 'إضافة / مرتجع' : 'صرف للمقص';
        logAction('المخزن', `حركة ${opText} بمقدار ${data.amount} للون ${color.color_code}`);
        addFlashMessage(`تم تنفيذ حركة ${opText} بنجاح`);
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تسجيل الحركة في الباك إند', 'danger');
      });

    return { success: true, message: 'تم تنفيذ الحركة بنجاح' };
  };

  const exportWarehouseInventoryCsv = () => {
    const headers = ['الخامة', 'كود اللون', 'اسم اللون', 'الكمية الفعلية', 'الكمية المحجوزة', 'المتاح للتصميم', 'الوحدة'];
    const rows = fabricColors.map((color) => {
      const fabric = fabrics.find((f) => f.id === color.fabric_id);
      const available = Number((color.quantity - color.reserved_quantity).toFixed(2));
      return [
        fabric?.name || 'غير معروف',
        color.color_code,
        color.color_name || '-',
        color.quantity.toString(),
        color.reserved_quantity.toString(),
        available.toString(),
        fabric?.unit || 'كيلو'
      ];
    });

    const csvContent =
      '\ufeff' +
      [headers.join(','), ...rows.map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `warehouse_inventory_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    logAction('المخزن', 'تصدير تقرير جرد المخزن إلى ملف إكسيل');
    addFlashMessage('تم تحميل شيت جرد المخزن بنجاح');
  };

  const updateColorPrice = (colorId: string, price: number) => {
    setFabricColors((prev) =>
      prev.map((c) => (c.id === colorId ? { ...c, price_per_unit: Math.max(0, price) } : c))
    );
    api
      .updateColorPrice(colorId, Math.max(0, price))
      .then(() => {
        addFlashMessage('تم تحديث سعر خامة القماش بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تحديث السعر في الباك إند', 'danger');
      });
  };

  // Accessories Actions
  const addAccessoryType = (name: string, description: string = '') => {
    const trimmed = name.trim();
    const existing = accessoryTypes.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.id;
    const newId = 'type-' + Date.now();
    const newType: AccessoryType = {
      id: newId,
      name: trimmed,
      description
    };
    setAccessoryTypes((prev) => [...prev, newType]);
    api
      .createAccessoryType(newType)
      .then((saved) => {
        setAccessoryTypes((prev) => prev.map((t) => (t.id === newId ? saved : t)));
        logAction('مخزن الإكسسوارات', `إضافة تصنيف إكسسوار جديد: ${trimmed}`);
        addFlashMessage(`تم إضافة تصنيف "${trimmed}" بنجاح`);
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل إضافة التصنيف في الباك إند', 'danger');
      });
    return newId;
  };

  const addAccessoryItem = (data: {
    type_id: string;
    type_name?: string;
    code: string;
    name: string;
    image?: string;
    unit: AccessoryUnit;
    quantity: number;
    price_per_unit: number;
    supplier_id?: string;
    min_threshold: number;
    usage_type?: AccessoryUsageType;
    custom_model_code?: string;
    target_quantity?: number;
    delivered_quantity?: number;
  }) => {
    const cleanCode = data.code.trim().toUpperCase();
    const existing = accessoryItems.find((a) => a.code.toUpperCase() === cleanCode);
    if (existing) {
      return { success: false, message: 'كود الإكسسوار مستخدم بالفعل!', itemId: '' };
    }

    const matchedType = accessoryTypes.find((t) => t.id === data.type_id);
    const newItemId = 'acc-' + Date.now();
    const usageType = data.usage_type || 'stock';
    const targetQty =
      usageType === 'custom_model' ? data.target_quantity || data.min_threshold : data.min_threshold;
    const deliveredQty =
      usageType === 'custom_model' ? data.delivered_quantity ?? data.quantity : data.quantity;

    const newItem: AccessoryItem = {
      id: newItemId,
      type_id: data.type_id,
      type_name: matchedType?.name || data.type_name || 'عام',
      code: cleanCode,
      name: data.name.trim(),
      image:
        data.image ||
        'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=500&auto=format&fit=crop&q=60',
      unit: data.unit,
      quantity: Math.max(0, data.quantity),
      reserved_quantity: 0,
      price_per_unit: Math.max(0, data.price_per_unit),
      supplier_id: data.supplier_id,
      min_threshold: Math.max(0, data.min_threshold),
      usage_type: usageType,
      custom_model_code: data.custom_model_code?.trim(),
      target_quantity: targetQty,
      delivered_quantity: deliveredQty,
      withdrawn_for_model: false,
      created_at: new Date().toISOString().slice(0, 10)
    };

    setAccessoryItems((prev) => [newItem, ...prev]);
    api
      .createAccessory(newItem)
      .then((saved) => {
        setAccessoryItems((prev) => prev.map((it) => (it.id === newItemId ? saved : it)));
        logAction('مخزن الإكسسوارات', `إضافة إكسسوار جديد: ${newItem.name} (${newItem.code})`);
        addFlashMessage(`تم إضافة صنف الإكسسوار "${newItem.name}" بنجاح`);
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل إضافة الإكسسوار في الباك إند', 'danger');
      });

    return { success: true, message: 'تم الحفظ بنجاح', itemId: newItemId };
  };

  const updateAccessoryItem = (id: string, updates: Partial<AccessoryItem>) => {
    setAccessoryItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
    api
      .updateAccessory(id, updates)
      .then((saved) => {
        setAccessoryItems((prev) => prev.map((item) => (item.id === id ? saved : item)));
        logAction('مخزن الإكسسوارات', `تعديل بيانات الصنف: ${updates.name || id}`);
        addFlashMessage('تم تحديث بيانات الصنف بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تحديث الصنف في الباك إند', 'danger');
      });
  };

  const deleteAccessoryItem = (id: string) => {
    const item = accessoryItems.find((a) => a.id === id);
    if (!item) return { success: false, message: 'الصنف غير موجود' };
    if (item.reserved_quantity > 0) {
      return { success: false, message: 'لا يمكن حذف صنف محجوز منه كميات لموديلات تحت التشغيل!' };
    }
    setAccessoryItems((prev) => prev.filter((a) => a.id !== id));
    api
      .deleteAccessory(id)
      .then(() => {
        logAction('مخزن الإكسسوارات', `حذف صنف إكسسوار: ${item.name}`);
        addFlashMessage('تم حذف الصنف بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل حذف الصنف من الباك إند', 'danger');
      });
    return { success: true, message: 'تم حذف الصنف بنجاح' };
  };

  const markAccessoryWithdrawn = (accessoryId: string) => {
    setAccessoryItems((prev) =>
      prev.map((item) => (item.id === accessoryId ? { ...item, withdrawn_for_model: true } : item))
    );
    api
      .markAccessoryWithdrawn(accessoryId)
      .then(() => {
        addFlashMessage('تم تسجيل سحب الإكسسوار بالكامل للموديل بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تحديث حالة السحب في الباك إند', 'danger');
      });
  };

  const recordAccessoryTransaction = (data: {
    accessoryId: string;
    operation: 'add' | 'deduct';
    amount: number;
    modelCodeRef?: string;
    notes?: string;
  }) => {
    const item = accessoryItems.find((a) => a.id === data.accessoryId);
    if (!item) return { success: false, message: 'الصنف غير موجود' };
    if (data.amount <= 0) return { success: false, message: 'الكمية يجب أن تكون أكبر من صفر' };

    if (data.operation === 'deduct' && item.quantity < data.amount) {
      return { success: false, message: 'الرصيد المتاح لا يكفي للصرف' };
    }

    const trId = 'acc-tr-' + Date.now();
    const timestamp = new Date().toLocaleString('ar-EG', { hour12: false });

    setAccessoryItems((prev) =>
      prev.map((a) => {
        if (a.id !== data.accessoryId) return a;
        const newQty =
          data.operation === 'add'
            ? Number((a.quantity + data.amount).toFixed(2))
            : Number((a.quantity - data.amount).toFixed(2));

        let newDelivered = a.delivered_quantity;
        if (a.usage_type === 'custom_model' && data.operation === 'add') {
          newDelivered = Number(((a.delivered_quantity || 0) + data.amount).toFixed(2));
        }

        return {
          ...a,
          quantity: Math.max(0, newQty),
          delivered_quantity: newDelivered
        };
      })
    );

    const transaction: AccessoryTransaction = {
      id: trId,
      accessory_id: item.id,
      accessory_code: item.code,
      accessory_name: item.name,
      operation: data.operation,
      amount: data.amount,
      model_code_ref: data.modelCodeRef || '',
      notes: data.notes || '',
      timestamp
    };
    setAccessoryTransactions((prev) => [transaction, ...prev]);

    api
      .recordAccessoryTransaction({
        id: trId,
        accessoryId: data.accessoryId,
        operation: data.operation,
        amount: data.amount,
        modelCodeRef: data.modelCodeRef || '',
        notes: data.notes || '',
        timestamp
      })
      .then((res) => {
        if (res.accessory) {
          setAccessoryItems((prev) =>
            prev.map((a) => (a.id === res.accessory.id ? res.accessory : a))
          );
        }
        if (res.transaction) {
          setAccessoryTransactions((prev) =>
            prev.map((t) => (t.id === trId ? res.transaction : t))
          );
        }
        const opText = data.operation === 'add' ? 'إضافة / توريد' : 'صرف للتشغيل';
        logAction('مخزن الإكسسوارات', `حركة ${opText} بمقدار ${data.amount} للصنف ${item.code}`);
        addFlashMessage(`تم تسجيل حركة ${opText} بنجاح`);
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تسجيل حركة الإكسسوار في الباك إند', 'danger');
      });

    return { success: true, message: 'تم تنفيذ الحركة بنجاح' };
  };

  const exportAccessoryInventoryCsv = () => {
    const headers = [
      'التصنيف',
      'الكود',
      'الاسم',
      'النوع',
      'الرصيد الحالي',
      'المحجوز',
      'المتاح',
      'الحد الأدنى / المطلوب',
      'الوحدة'
    ];
    const rows = accessoryItems.map((a) => [
      a.type_name,
      a.code,
      a.name,
      a.usage_type === 'custom_model' ? `خاص بموديل ${a.custom_model_code || ''}` : 'رصيد مستمر',
      a.quantity.toString(),
      a.reserved_quantity.toString(),
      (a.quantity - a.reserved_quantity).toString(),
      (a.usage_type === 'custom_model' ? a.target_quantity || a.min_threshold : a.min_threshold).toString(),
      a.unit
    ]);

    const csvContent =
      '\ufeff' +
      [headers.join(','), ...rows.map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `accessories_inventory_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    logAction('مخزن الإكسسوارات', 'تصدير شيت جرد الإكسسوارات إلى إكسيل');
    addFlashMessage('تم تصدير جرد الإكسسوارات بنجاح');
  };

  // Design Actions
  const addDesignModel = (data: {
    modelCode: string;
    modelType: string;
    sizeCategoryId?: string;
    imageUrl?: string;
    targetCutQuantity?: number;
    designNotes?: string;
    notesShirt?: string;
    notesPants?: string;
    garmentComposition?: GarmentComposition;
  }) => {
    const cleanCode = data.modelCode.trim().toUpperCase();
    const existing = models.find((m) => !m.is_deleted && m.model_code.toUpperCase() === cleanCode);
    if (existing) {
      addFlashMessage('كود الموديل مستخدم بالفعل!', 'danger');
      return { success: false, message: 'كود الموديل مستخدم بالفعل!' };
    }

    const newModelId = 'mod-' + Date.now();
    const targetCutQty = data.targetCutQuantity || 100;
    const garmentComposition: GarmentComposition =
      data.garmentComposition || DEFAULT_GARMENT_COMPOSITION;
    const garmentParts = partsForComposition(garmentComposition);
    const allowedDesignNotes = canAddDesignNotes() ? (data.designNotes || '') : '';
    const allowedShirtNotes = canAddDesignNotes() ? (data.notesShirt || '') : '';
    const allowedPantsNotes = canAddDesignNotes() ? (data.notesPants || '') : '';
    const userName = currentUser?.real_name || 'مسؤول التصميم';

    const newModel: DesignModel = {
      id: newModelId,
      model_code: cleanCode,
      model_type: data.modelType,
      size_category_id: data.sizeCategoryId,
      image:
        data.imageUrl ||
        'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500&auto=format&fit=crop&q=60',
      status: 'مرحلة التصميم',
      main_marker_url: '',
      print_marker_url: '',
      target_cut_quantity: targetCutQty,
      garment_parts: garmentParts,
      garment_composition: garmentComposition,
      design_notes: allowedDesignNotes,
      notes_shirt: allowedShirtNotes,
      notes_pants: allowedPantsNotes,
      created_at: new Date().toISOString(),
      is_deleted: false,
      timeline: [
        {
          id: 'tl-' + Date.now(),
          stage: 'مرحلة التصميم',
          title: 'إنشاء الموديل الجديد',
          description: `تم إنشاء الموديل بالعدد المستهدف للقص: ${targetCutQty} قطعة${allowedDesignNotes ? ` | ملاحظات التصميم: ${allowedDesignNotes}` : ''}`,
          user_name: userName,
          timestamp: new Date().toLocaleString('ar-EG', { hour12: false }),
          details: {
            phase_type: 'design',
            model_code: cleanCode,
            model_type: data.modelType,
            target_cut_quantity: targetCutQty,
            design_notes: allowedDesignNotes,
            notes_shirt: allowedShirtNotes,
            notes_pants: allowedPantsNotes,
            operator_name: userName,
            worker_notes: allowedDesignNotes || allowedShirtNotes || allowedPantsNotes
          }
        }
      ]
    };

    setModels((prev) => [newModel, ...prev]);
    api
      .createModel({
        id: newModelId,
        model_code: cleanCode,
        model_type: data.modelType,
        size_category_id: data.sizeCategoryId,
        image: newModel.image,
        target_cut_quantity: targetCutQty,
        garment_composition: garmentComposition,
        garment_parts: garmentParts,
        design_notes: allowedDesignNotes,
        notes_shirt: allowedShirtNotes,
        notes_pants: allowedPantsNotes,
        user_name: userName
      })
      .then((saved) => {
        setModels((prev) => prev.map((m) => (m.id === newModelId ? saved : m)));
        logAction('التصميم', `إنشاء موديل جديد: ${cleanCode}`);
        addFlashMessage(`تم إنشاء الموديل ${cleanCode} بنجاح`);
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل إنشاء الموديل في الباك إند', 'danger');
      });

    return { success: true, message: 'تم إنشاء الموديل بنجاح', modelId: newModelId };
  };

  const updateModelPlan = (data: {
    modelId: string;
    reqQuantities: Record<string, number>;
    accQuantities: Record<string, number>;
    mainMarkerUrl?: string;
    printMarkerUrl?: string;
    designNotes?: string;
    notesShirt?: string;
    notesPants?: string;
    targetCutQuantity?: number;
  }) => {
    const model = models.find((m) => m.id === data.modelId);
    if (!model) return { success: false, message: 'الموديل غير موجود' };

    const allowNotes = canAddDesignNotes();

    // Validate that planned quantities don't exceed available for design (including what this model already had reserved)
    const modelReqs = requirements.filter((r) => r.model_id === data.modelId);
    for (const req of modelReqs) {
      const nextQty = Math.max(0, Number(data.reqQuantities[req.id] ?? req.planned_quantity) || 0);
      const col = fabricColors.find((c) => c.id === req.color_id);
      if (col) {
        const otherModelsReserved = requirements
          .filter(
            (r) =>
              r.color_id === req.color_id &&
              r.model_id !== data.modelId &&
              designModelIdsSet.has(r.model_id)
          )
          .reduce((sum, r) => sum + (Number(r.planned_quantity) || 0), 0);
        const sameModelOtherParts = modelReqs
          .filter((r) => r.color_id === req.color_id && r.id !== req.id)
          .reduce(
            (sum, r) => sum + Math.max(0, Number(data.reqQuantities[r.id] ?? r.planned_quantity) || 0),
            0
          );
        const maxAvailableForThisPart = Number(
          Math.max(0, col.quantity - otherModelsReserved - sameModelOtherParts).toFixed(2)
        );
        if (nextQty > maxAvailableForThisPart) {
          addFlashMessage(
            `الكمية المطلوبة للون (${col.color_code}) تتجاوز المتاح للتصميم (${maxAvailableForThisPart})!`,
            'warning'
          );
          return {
            success: false,
            message: `الكمية المطلوبة للون (${col.color_code}) تتجاوز المتاح للتصميم (${maxAvailableForThisPart})`
          };
        }
      }
    }

    setRequirements((prev) =>
      prev.map((r) => {
        if (r.model_id !== data.modelId) return r;
        const newQty = data.reqQuantities[r.id];
        return newQty !== undefined ? { ...r, planned_quantity: Math.max(0, newQty) } : r;
      })
    );

    setAccessories((prev) =>
      prev.map((a) => {
        if (a.model_id !== data.modelId) return a;
        const newQty = data.accQuantities[a.id];
        return newQty !== undefined ? { ...a, planned_quantity: Math.max(0, newQty) } : a;
      })
    );

    setModels((prev) =>
      prev.map((m) => {
        if (m.id !== data.modelId) return m;
        return {
          ...m,
          main_marker_url: data.mainMarkerUrl ?? m.main_marker_url,
          print_marker_url: data.printMarkerUrl ?? m.print_marker_url,
          ...(allowNotes
            ? {
                design_notes: data.designNotes ?? m.design_notes,
                notes_shirt: data.notesShirt ?? m.notes_shirt,
                notes_pants: data.notesPants ?? m.notes_pants
              }
            : {}),
          target_cut_quantity: data.targetCutQuantity ?? m.target_cut_quantity
        };
      })
    );

    api
      .updateModelPlan(data.modelId, {
        ...data,
        ...(allowNotes
          ? {}
          : {
              designNotes: model.design_notes,
              notesShirt: model.notes_shirt,
              notesPants: model.notes_pants
            })
      })
      .then((savedModel) => {
        setModels((prev) => prev.map((m) => (m.id === data.modelId ? savedModel : m)));
        logAction('التصميم', `تحديث خطة وخامات الموديل ${model.model_code} (حجز من المتاح للتصميم)`);
        addFlashMessage('تم حفظ خطة الموديل وخصم الكميات المحددة من (المتاح للتصميم) فقط بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل حفظ الخطة في الباك إند', 'danger');
      });

    return { success: true, message: 'تم حفظ الخطة بنجاح' };
  };

  const updateModelNotesAndTarget = (
    modelId: string,
    data: {
      target_cut_quantity?: number;
      design_notes?: string;
      notes_shirt?: string;
      notes_pants?: string;
      garment_composition?: GarmentComposition;
    }
  ) => {
    const allowNotes = canAddDesignNotes();
    const filteredData = {
      ...(data.target_cut_quantity !== undefined ? { target_cut_quantity: data.target_cut_quantity } : {}),
      ...(data.garment_composition !== undefined ? { garment_composition: data.garment_composition } : {}),
      ...(allowNotes && data.design_notes !== undefined ? { design_notes: data.design_notes } : {}),
      ...(allowNotes && data.notes_shirt !== undefined ? { notes_shirt: data.notes_shirt } : {}),
      ...(allowNotes && data.notes_pants !== undefined ? { notes_pants: data.notes_pants } : {})
    };

    setModels((prev) =>
      prev.map((m) => {
        if (m.id !== modelId) return m;
        return {
          ...m,
          ...filteredData
        };
      })
    );
    api
      .updateModel(modelId, filteredData)
      .then((saved) => {
        setModels((prev) => prev.map((m) => (m.id === modelId ? saved : m)));
        addFlashMessage('تم تحديث بيانات وملاحظات التشغيل بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل التحديث في الباك إند', 'danger');
      });
  };

  const addModelRequirement = (
    modelId: string,
    colorId: string,
    partName: string,
    plannedQuantity: number = 0
  ) => {
    const col = fabricColors.find((c) => c.id === colorId);
    const cleanQty = Math.max(0, Number(plannedQuantity) || 0);

    if (col && cleanQty > 0) {
      const availableForDesign = Number((col.quantity - col.reserved_quantity).toFixed(2));
      if (cleanQty > availableForDesign) {
        addFlashMessage(
          `الكمية المطلوبة (${cleanQty}) أكبر من المتاح للتصميم حالياً (${availableForDesign}) للون ${col.color_code}`,
          'warning'
        );
        return {
          success: false,
          message: `الكمية المطلوبة أكبر من المتاح للتصميم (${availableForDesign})`
        };
      }
    }

    const newReq: ModelRequirement = {
      id: 'req-' + Date.now(),
      model_id: modelId,
      color_id: colorId,
      part_name: partName.trim(),
      planned_quantity: cleanQty
    };
    setRequirements((prev) => [...prev, newReq]);
    api
      .createModelRequirement(newReq)
      .then((saved) => {
        setRequirements((prev) => prev.map((r) => (r.id === newReq.id ? saved : r)));
        addFlashMessage(
          cleanQty > 0
            ? `تم تخصيص خامة اللون وحجز ${cleanQty} من المتاح للتصميم فقط (دون المساس بالمخزون الفعلي الكلي)`
            : 'تمت إضافة خامة اللون بنجاح'
        );
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل إضافة الخامة للموديل في الباك إند', 'danger');
      });

    return { success: true, message: 'تمت إضافة الخامة بنجاح' };
  };

  const deleteModelRequirement = (reqId: string) => {
    setRequirements((prev) => prev.filter((r) => r.id !== reqId));
    api
      .deleteModelRequirement(reqId)
      .then(() => {
        addFlashMessage('تم حذف الخامة من الموديل وإعادة الكمية إلى المتاح للتصميم');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل حذف الخامة من الباك إند', 'danger');
      });
  };

  const addModelAccessory = (
    modelId: string,
    accessory: {
      id?: string;
      code?: string;
      name: string;
      unit?: string;
      image?: string;
      target_type?: 'shirt' | 'pants';
      piece_consumption?: number;
      planned_quantity?: number;
    }
  ) => {
    const targetModel = models.find((m) => m.id === modelId);
    const targetCut = targetModel?.target_cut_quantity || 100;
    const pieceConsumption = accessory.piece_consumption || 1;
    const plannedQty = accessory.planned_quantity ?? Math.round(pieceConsumption * targetCut);

    const newAcc: ModelAccessory = {
      id: 'macc-' + Date.now(),
      model_id: modelId,
      accessory_id: accessory.id,
      accessory_code: accessory.code,
      accessory_name: accessory.name,
      unit: accessory.unit || 'قطعة',
      image: accessory.image,
      target_type: accessory.target_type || 'shirt',
      piece_consumption: pieceConsumption,
      planned_quantity: plannedQty
    };
    setAccessories((prev) => [...prev, newAcc]);
    api
      .createModelAccessory(newAcc)
      .then((saved) => {
        setAccessories((prev) => prev.map((a) => (a.id === newAcc.id ? saved : a)));
        addFlashMessage(
          `تمت إضافة إكسسوار "${accessory.name}" إلى ${
            accessory.target_type === 'pants' ? 'البنطلون' : 'التيشرت'
          }`
        );
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل إضافة الإكسسوار للموديل في الباك إند', 'danger');
      });
    return { success: true, message: 'تمت الإضافة بنجاح' };
  };

  const deleteModelAccessory = (accId: string) => {
    setAccessories((prev) => prev.filter((a) => a.id !== accId));
    api
      .deleteModelAccessory(accId)
      .then(() => {
        addFlashMessage('تم إزالة الإكسسوار من الموديل');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل إزالة الإكسسوار من الباك إند', 'danger');
      });
  };

  const issueFabricToCutting = (
    modelId: string,
    extraData?: { reqQuantities?: Record<string, number>; accQuantities?: Record<string, number> }
  ) => {
    const targetModel = models.find((m) => m.id === modelId);
    if (!targetModel) return { success: false, message: 'الموديل غير موجود' };

    const reqQuantities = extraData?.reqQuantities || {};
    const accQuantities = extraData?.accQuantities || {};

    // Update requirements and accessories locally if latest quantities were passed
    const effectiveReqs = requirements.map((r) => {
      if (r.model_id !== modelId) return r;
      const q = reqQuantities[r.id];
      return q !== undefined ? { ...r, planned_quantity: Math.max(0, Number(q) || 0) } : r;
    });
    const effectiveAccs = accessories.map((a) => {
      if (a.model_id !== modelId) return a;
      const q = accQuantities[a.id];
      return q !== undefined ? { ...a, planned_quantity: Math.max(0, Number(q) || 0) } : a;
    });

    const modelReqs = effectiveReqs.filter((r) => r.model_id === modelId && r.planned_quantity > 0);
    const modelAccs = effectiveAccs.filter((a) => a.model_id === modelId && a.planned_quantity > 0);

    // Check that actual total stock is sufficient for deduction
    const colorDeductMap: Record<string, number> = {};
    for (const req of modelReqs) {
      colorDeductMap[req.color_id] = Number(
        ((colorDeductMap[req.color_id] || 0) + req.planned_quantity).toFixed(2)
      );
    }
    for (const [colId, totalNeeded] of Object.entries(colorDeductMap)) {
      const col = fabricColors.find((c) => c.id === colId);
      if (col && col.quantity < totalNeeded) {
        addFlashMessage(
          `الرصيد الفعلي الكلي للون (${col.color_code}) غير كافٍ للصرف! المطلوب: ${totalNeeded}، الفعلي بالمخزن: ${col.quantity}`,
          'danger'
        );
        return {
          success: false,
          message: `الرصيد الفعلي الكلي للون (${col.color_code}) غير كافٍ للصرف`
        };
      }
    }

    setRequirements(effectiveReqs);
    setAccessories(effectiveAccs);

    // Deduct from actual total stock (`quantity`) ONLY now when issuing fabric to Cutting!
    setFabricColors((prev) =>
      prev.map((c) => {
        const deductAmt = colorDeductMap[c.id];
        if (!deductAmt) return c;
        return {
          ...c,
          quantity: Math.max(0, Number((c.quantity - deductAmt).toFixed(2)))
        };
      })
    );

    const accDeductMap: Record<string, number> = {};
    for (const mAcc of modelAccs) {
      if (mAcc.accessory_id) {
        accDeductMap[mAcc.accessory_id] = Number(
          ((accDeductMap[mAcc.accessory_id] || 0) + mAcc.planned_quantity).toFixed(2)
        );
      }
    }
    setAccessoryItems((prev) =>
      prev.map((it) => {
        const deductAmt = accDeductMap[it.id];
        if (!deductAmt) return it;
        return {
          ...it,
          quantity: Math.max(0, Math.round(it.quantity - deductAmt))
        };
      })
    );

    // Move model status to 'في القص' (which also automatically releases its design reservation)
    setModels((prev) =>
      prev.map((m) =>
        m.id === modelId ? { ...m, status: 'في القص', cut_at: new Date().toISOString() } : m
      )
    );

    api
      .issueFabricToCutting(modelId, currentUser?.real_name || 'مسؤول التصميم', extraData)
      .then(async () => {
        await refreshState();
        logAction('التصميم', `صرف خامات وإكسسوارات الموديل ${targetModel.model_code} من المخزون الفعلي الكلي وتحويله للقص`);
        addFlashMessage('تم صرف القماش والإكسسوارات من المخزون الفعلي الكلي وتوجيه الموديل للقص بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل صرف الخامات في الباك إند', 'danger');
      });

    return { success: true, message: 'تم صرف الخامات والإكسسوارات وتحويل الموديل للقص.' };
  };

  const deleteDesignModel = (modelId: string) => {
    const target = models.find((m) => m.id === modelId);
    if (!target) return;
    setModels((prev) => prev.map((m) => (m.id === modelId ? { ...m, is_deleted: true } : m)));
    api
      .deleteModel(modelId)
      .then(() => {
        logAction('التصميم', `تم حذف الموديل ${target.model_code}`);
        addFlashMessage(`تم حذف الموديل ${target.model_code}`);
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل حذف الموديل من الباك إند', 'danger');
      });
  };

  // Normalizes any free-text / alias part label to a canonical GarmentPart key.
  const normalizePartKey = useCallback((value?: string | null): GarmentPart => {
    const raw = (value || '').trim().toLowerCase();
    if (!raw) return 'shirt';
    if ((PART_ORDER as string[]).includes(raw)) return raw as GarmentPart;
    if (raw.includes('بنطل') || raw.includes('pants') || raw.includes('trouser')) return 'pants';
    if (raw.includes('جاكيت') || raw.includes('jacket')) return 'jacket';
    if (raw.includes('كامل') || raw.includes('قطعة واحدة') || raw.includes('single')) return 'single';
    if (
      raw.includes('تيشرت') || raw.includes('تيشيرت') || raw.includes('قميص') ||
      raw.includes('shirt') || raw.includes('tshirt')
    ) return 'shirt';
    return 'shirt';
  }, []);

  // Ordered list of garment parts for a model (explicit → requirements → shirt+pants).
  const getModelParts = useCallback(
    (modelId: string): GarmentPart[] => {
      const model = models.find((m) => m.id === modelId);
      const explicit = (model?.garment_parts || []).map((p) => normalizePartKey(p));
      let parts = Array.from(new Set(explicit));
      if (parts.length === 0 && model?.garment_composition) {
        parts = partsForComposition(model.garment_composition);
      }
      if (parts.length === 0) {
        const modelReqs = requirements.filter((r) => r.model_id === modelId);
        const inferred = Array.from(new Set(modelReqs.map((r) => normalizePartKey(r.part_name))));
        parts = inferred.length > 0 ? inferred : partsForComposition(DEFAULT_GARMENT_COMPOSITION);
      }
      return parts.sort((a, b) => PART_ORDER.indexOf(a) - PART_ORDER.indexOf(b));
    },
    [models, requirements, normalizePartKey]
  );

  // Helper to resolve colors and sizes for a model (used in Cutting Spreads & QC Matrix).
  // When `part` is provided only that part's colors are returned, without the "(part)" suffix.
  const getModelColorList = useCallback(
    (modelId: string, part?: GarmentPart): string[] => {
      const model = models.find((m) => m.id === modelId);
      const allModelReqs = requirements.filter((r) => r.model_id === modelId);
      let modelReqs = part
        ? allModelReqs.filter((r) => normalizePartKey(r.part_name) === part)
        : allModelReqs;
      // Legacy rows store free-text part names that mostly infer 'shirt'; fall back to
      // all model colors so every part tab still shows the fabric colors.
      if (part && modelReqs.length === 0) {
        modelReqs = allModelReqs;
      }
      const colors: string[] = [];

      modelReqs.forEach((req) => {
        const col = fabricColors.find((c) => c.id === req.color_id);
        const baseLabel = col?.color_name
          ? `${col.color_code} - ${col.color_name}`
          : `${col?.color_code || 'لون'}`;
        const colorLabel = part ? baseLabel : `${baseLabel} (${req.part_name})`;
        if (!colors.includes(colorLabel)) {
          colors.push(colorLabel);
        }
      });

      // Also include any distinct colors recorded in Cutting Spreads if requirements were empty
      if (colors.length === 0) {
        const modelSpreads = cuttingRecords.filter(
          (r) =>
            r.model_id === modelId &&
            (!part || normalizePartKey(r.part_type || r.partType) === part)
        );
        modelSpreads.forEach((sp) => {
          const spreadLayers = sp.color_layers || sp.colorLayers || [];
          spreadLayers.forEach((lay) => {
            const cName = (lay.color_name || lay.colorName || '').trim();
            if (cName && !colors.includes(cName)) {
              colors.push(cName);
            }
          });
        });
      }

      if (colors.length === 0 && model) {
        colors.push(`اللون الأساسي (${model.model_code})`);
      }
      return colors;
    },
    [models, requirements, fabricColors, cuttingRecords, normalizePartKey]
  );

  const getModelSizeList = useCallback(
    (modelId: string): string[] => {
      const model = models.find((m) => m.id === modelId);
      const sizeCat = sizeDefs.find((s) => s.id === model?.size_category_id);
      if (sizeCat && sizeCat.values) {
        const parsed = sizeCat.values
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (parsed.length > 0) return parsed;
      }
      return ['S', 'M', 'L', 'XL'];
    },
    [models, sizeDefs]
  );

  // Cutting Actions (Spreads / Lays System)
  const addCuttingRecord = (data: {
    modelId: string;
    spreadNumber?: number;
    spreaderName: string;
    cutterName: string;
    colorLayers: CuttingSpreadLayer[];
    colorName?: string;
    layersCount?: number;
    piecesPerLayer: number;
    layerWeight: number;
    piecesCount?: number;
    shadeDegree?: string;
    notes?: string;
    partType?: GarmentPart;
  }) => {
    const recId = 'cut-' + Date.now();
    const createdAt = new Date().toLocaleString('ar-EG', { hour12: false });
    const cleanNotes = canAddCuttingNotes() ? (data.notes?.trim() || '') : '';
    const existingModelSpreads = cuttingRecords.filter((r) => r.model_id === data.modelId);
    const spreadNumber = data.spreadNumber || existingModelSpreads.length + 1;
    const partType: GarmentPart = normalizePartKey(data.partType || 'shirt');

    const piecesPerLayer = Math.max(1, Number(data.piecesPerLayer) || 1);
    const layerWeight = Math.max(0, Number(data.layerWeight) || 0);

    const cleanLayers: CuttingSpreadLayer[] = (data.colorLayers || [])
      .filter((l) => (l.color_name || l.colorName) && Number(l.layers_count ?? l.layersCount ?? 0) > 0)
      .map((l, idx) => {
        const lCount = Math.max(0, Number(l.layers_count ?? l.layersCount ?? 0));
        return {
          id: l.id || `lay-${Date.now()}-${idx}`,
          color_name: (l.color_name || l.colorName || '').trim(),
          colorName: (l.color_name || l.colorName || '').trim(),
          layers_count: lCount,
          layersCount: lCount,
          layer_weight: layerWeight,
          layerWeight: layerWeight,
          pieces_count: lCount * piecesPerLayer,
          piecesCount: lCount * piecesPerLayer,
          shade_degree: (l.shade_degree || l.shadeDegree || '').trim(),
          shadeDegree: (l.shade_degree || l.shadeDegree || '').trim(),
          notes: (l.notes || '').trim()
        };
      });

    const totalLayersCount =
      cleanLayers.length > 0
        ? cleanLayers.reduce((sum, item) => sum + item.layers_count, 0)
        : Math.max(0, Number(data.layersCount) || 0);

    const colorsSummary =
      cleanLayers.length > 0
        ? cleanLayers.map((item) => `${item.color_name} (${item.layers_count} راق)`).join(' + ')
        : data.colorName || '';

    const cleanSpreader = (data.spreaderName || '').trim();
    const cleanCutter = (data.cutterName || '').trim();
    const totalPieces =
      totalLayersCount > 0 && piecesPerLayer > 0
        ? totalLayersCount * piecesPerLayer
        : Math.max(0, Number(data.piecesCount) || 0);

    const newRecord: CuttingRecord = {
      id: recId,
      model_id: data.modelId,
      spread_number: spreadNumber,
      spreadNumber: spreadNumber,
      part_type: partType,
      partType: partType,
      spreader_name: cleanSpreader,
      spreaderName: cleanSpreader,
      cutter_name: cleanCutter,
      cutterName: cleanCutter,
      color_name: colorsSummary,
      colorName: colorsSummary,
      color_layers: cleanLayers,
      colorLayers: cleanLayers,
      layers_count: totalLayersCount,
      layersCount: totalLayersCount,
      pieces_per_layer: piecesPerLayer,
      piecesPerLayer: piecesPerLayer,
      layer_weight: layerWeight,
      layerWeight: layerWeight,
      pieces_count: totalPieces,
      piecesCount: totalPieces,
      shade_degree: data.shadeDegree?.trim() || '',
      shadeDegree: data.shadeDegree?.trim() || '',
      notes: cleanNotes,
      created_at: createdAt
    };
    setCuttingRecords((prev) => [newRecord, ...prev]);

    setModels((prev) =>
      prev.map((m) => {
        if (m.id !== data.modelId) return m;
        // Per-part totals: this spread only adds pieces to its own part.
        const prevPartCut =
          partType === 'pants'
            ? Number(m.cut_pants_pieces || 0)
            : partType === 'jacket'
            ? Number(m.cut_jacket_pieces || 0)
            : Number(m.cut_shirt_pieces || 0);
        const newPartCut = prevPartCut + totalPieces;
        const cutSummary = {
          ...(m.cut_summary || {}),
          [partType]: newPartCut
        } as Partial<Record<GarmentPart, number>>;
        const partValues = Object.values(cutSummary).filter(
          (v): v is number => typeof v === 'number'
        );
        const modelParts = (
          m.parts && m.parts.length > 0
            ? m.parts
            : m.garment_parts && m.garment_parts.length > 0
            ? m.garment_parts
            : getModelParts(m.id)
        ) as GarmentPart[];
        // Legacy aggregate: explicit parts use completed sets (min), legacy models keep the sum.
        const newTotal =
          m.garment_parts && m.garment_parts.length > 0 && partValues.length > 0
            ? Math.min(...partValues)
            : (m.actual_cut_count || 0) + totalPieces;
        const tlEvent: ModelTimelineEvent = {
          id: 'tl-' + Date.now(),
          stage: 'في القص',
          title: `تسجيل فرشة قص #${spreadNumber} - ${getPartLabel(partType)} (${totalPieces} قطعة)`,
          notes: `فرشة رقم #${spreadNumber} | القطعة: ${getPartLabel(partType)} | الفَرّاش: ${cleanSpreader || '-'} | المقصدار: ${cleanCutter} | الألوان والراقات: ${colorsSummary} | إجمالي الراقات: ${totalLayersCount} | عدد القطع في الراق: ${piecesPerLayer} | إجمالي وزن الراق: ${layerWeight} كجم | القطع المقصوصة: ${totalPieces}${cleanNotes ? ` | ملاحظات: ${cleanNotes}` : ''}`,
          user: cleanCutter || cleanSpreader,
          timestamp: createdAt,
          details: {
            phase_type: 'cutting',
            record_id: recId,
            spread_number: spreadNumber,
            spreader_name: cleanSpreader,
            cutter_name: cleanCutter,
            color_name: colorsSummary,
            color_layers: cleanLayers,
            layers_count: totalLayersCount,
            pieces_per_layer: piecesPerLayer,
            layer_weight: layerWeight,
            pieces_count: totalPieces,
            total_cut_pieces_so_far: newTotal,
            shade_degree: data.shadeDegree?.trim() || '',
            worker_notes: cleanNotes,
            operator_name: cleanCutter || cleanSpreader
          }
        };
        return {
          ...m,
          actual_cut_count: newTotal,
          total_cut_pieces: newTotal,
          completed_sets: newTotal,
          cut_shirt_pieces: partType === 'shirt' ? newPartCut : (m.cut_shirt_pieces || 0),
          cut_pants_pieces: partType === 'pants' ? newPartCut : (m.cut_pants_pieces || 0),
          cut_jacket_pieces: partType === 'jacket' ? newPartCut : (m.cut_jacket_pieces || 0),
          cut_summary: cutSummary,
          parts: modelParts,
          cutter_name: cleanCutter,
          spreader_name: cleanSpreader,
          timeline: [tlEvent, ...(m.timeline || [])]
        };
      })
    );

    api
      .createCuttingRecord({
        id: recId,
        model_id: data.modelId,
        spread_number: spreadNumber,
        part_type: partType,
        spreader_name: cleanSpreader,
        cutter_name: cleanCutter,
        color_name: colorsSummary,
        color_layers: cleanLayers,
        layers_count: totalLayersCount,
        pieces_per_layer: piecesPerLayer,
        layer_weight: layerWeight,
        pieces_count: totalPieces,
        shade_degree: data.shadeDegree?.trim() || '',
        notes: cleanNotes,
        created_at: createdAt
      })
      .then((saved) => {
        setCuttingRecords((prev) => prev.map((r) => (r.id === recId ? saved : r)));
        logAction('القص', `تسجيل فرشة قص #${spreadNumber} للموديل: ${totalPieces} قطعة (${totalLayersCount} راق × ${piecesPerLayer} قطعة/راق | إجمالي وزن الراق: ${layerWeight} كجم)`);
        addFlashMessage(`تم تسجيل الفرشة رقم #${spreadNumber} بنجاح (${totalPieces} قطعة مقصوصة)`);
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تسجيل الفرشة في الباك إند', 'danger');
      });
  };

  const finishCuttingToQC = (modelId: string, notes?: string) => {
    const model = models.find((m) => m.id === modelId);
    const cleanNotes = canAddCuttingNotes() ? (notes?.trim() || '') : '';
    setModels((prev) =>
      prev.map((m) => (m.id === modelId ? { ...m, status: 'العد قبل الطباعة' } : m))
    );

    api
      .finishCuttingToQC(modelId, currentUser?.real_name || 'مسؤول القص', cleanNotes)
      .then((savedModel) => {
        setModels((prev) => prev.map((m) => (m.id === modelId ? savedModel : m)));
        logAction('القص', `إنهاء قص الموديل ${model?.model_code} وتحويله للعد والفرز قبل الطباعة`);
        addFlashMessage('تم إنهاء القص وتحويل الموديل لقسم الفرز (العد قبل الطباعة) بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تحويل الموديل في الباك إند', 'danger');
      });
  };

  const exportCuttingCsv = (modelId: string) => {
    const targetModel = models.find((m) => m.id === modelId);
    const records = cuttingRecords.filter((r) => r.model_id === modelId);
    const headers = [
      'كود الموديل',
      'رقم الفرشة',
      'اسم الفراش (Spreader)',
      'الألوان والراقات داخل الفرشة',
      'إجمالي الراقات',
      'عدد القطع في الراق',
      'إجمالي وزن الراق (كجم)',
      'عدد القطع المقصوصة (الراقات × قطع الراق)',
      'اسم المقصدار (Cutter)',
      'درجة الصبغة',
      'الملاحظات',
      'تاريخ ووقت التسجيل'
    ];
    const rows = records.map((r, idx) => [
      targetModel?.model_code || modelId,
      String(r.spread_number || idx + 1),
      r.spreader_name || r.spreaderName || '-',
      r.color_name || '-',
      r.layers_count.toString(),
      (r.pieces_per_layer ?? r.piecesPerLayer ?? 0).toString(),
      r.layer_weight.toString(),
      r.pieces_count.toString(),
      r.cutter_name || '-',
      r.shade_degree || '-',
      r.notes || '-',
      r.created_at
    ]);

    const csvContent =
      '\ufeff' +
      [headers.join(','), ...rows.map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `cutting_spreads_${targetModel?.model_code || 'records'}_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    logAction('القص', `تصدير سجل فرشات القص للموديل ${targetModel?.model_code} إلى إكسيل`);
    addFlashMessage('تم تصدير سجل فرشات القص بنجاح');
  };

  // QC Actions (Matrix per Color x Size)
  const recordQCData = (data: {
    modelId: string;
    colorName: string;
    size: string;
    goodQty: number;
    defectQty: number;
    defectNotes?: string;
    stage?: QCStageType;
    partType?: GarmentPart;
  }) => {
    const stage = data.stage || 'before_print';
    const partType: GarmentPart = normalizePartKey(data.partType || 'shirt');
    const allowNotes =
      stage === 'before_print' ? canAddQCBeforePrintNotes() : canAddQCAfterPrintNotes();
    const cleanNotes = allowNotes ? (data.defectNotes?.trim() || '') : '';
    const qcId = 'qc-' + Date.now();
    const createdAt = new Date().toLocaleString('ar-EG', { hour12: false });

    const newQC: QCRecord = {
      id: qcId,
      model_id: data.modelId,
      stage,
      part_type: partType,
      partType: partType,
      color_name: data.colorName,
      size: data.size,
      good_qty: Math.max(0, data.goodQty),
      defect_qty: Math.max(0, data.defectQty),
      counted_pieces: Math.max(0, data.goodQty),
      defect_pieces: Math.max(0, data.defectQty),
      defect_notes: cleanNotes,
      notes: cleanNotes,
      inspector_name: currentUser?.real_name || 'مراقب الجودة',
      created_at: createdAt
    };

    setQcRecords((prev) => {
      const existingIdx = prev.findIndex(
        (q) =>
          q.model_id === data.modelId &&
          q.stage === stage &&
          (q.part_type || 'shirt') === partType &&
          q.color_name === data.colorName &&
          q.size === data.size
      );
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = { ...updated[existingIdx], ...newQC, id: updated[existingIdx].id };
        return updated;
      }
      return [newQC, ...prev];
    });

    api
      .createQCRecord({
        id: qcId,
        model_id: data.modelId,
        stage,
        part_type: partType,
        color_name: data.colorName,
        size: data.size,
        good_qty: Math.max(0, data.goodQty),
        defect_qty: Math.max(0, data.defectQty),
        defect_notes: cleanNotes,
        inspector_name: currentUser?.real_name || 'مراقب الجودة',
        created_at: createdAt
      })
      .then((saved) => {
        setQcRecords((prev) => {
          const filtered = prev.filter(
            (q) =>
              !(
                q.model_id === data.modelId &&
                q.stage === stage &&
                q.color_name === data.colorName &&
                q.size === data.size &&
                q.id !== saved.id
              )
          );
          const exists = filtered.some((q) => q.id === saved.id);
          return exists
            ? filtered.map((q) => (q.id === saved.id ? saved : q))
            : [saved, ...filtered];
        });
        logAction('الفرز', `تسجيل بيانات فرز (${stage}) [${data.colorName} - مقاس ${data.size}]: سليم: ${data.goodQty}، تالف: ${data.defectQty}`);
        addFlashMessage('تم حفظ خلية الفرز بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تسجيل بيانات الفرز في الباك إند', 'danger');
      });
  };

  const saveQCMatrix = (data: {
    modelId: string;
    stage: QCStageType;
    matrixEntries: QCMatrixCellInput[];
    notes?: string;
    partType?: GarmentPart;
  }) => {
    const allowNotes =
      data.stage === 'before_print' ? canAddQCBeforePrintNotes() : canAddQCAfterPrintNotes();
    const cleanNotes = allowNotes ? (data.notes?.trim() || '') : '';
    const inspector = currentUser?.real_name || 'مراقب الجودة';
    const createdAt = new Date().toLocaleString('ar-EG', { hour12: false });
    const partType: GarmentPart = normalizePartKey(data.partType || 'shirt');
    const entries = data.matrixEntries.map((entry) => ({
      ...entry,
      part_type: entry.part_type || partType
    }));

    api
      .saveQCMatrix({
        model_id: data.modelId,
        stage: data.stage,
        part_type: partType,
        matrix_entries: entries,
        notes: cleanNotes,
        inspector_name: inspector,
        created_at: createdAt
      })
      .then((res) => {
        if (res.model) {
          setModels((prev) => prev.map((m) => (m.id === data.modelId ? res.model : m)));
        }
        if (Array.isArray(res.qcRecords)) {
          setQcRecords((prev) => {
            // Only replace this part's cells; keep the other parts' records intact.
            const otherRecords = prev.filter(
              (q) =>
                !(
                  q.model_id === data.modelId &&
                  q.stage === data.stage &&
                  (q.part_type || 'shirt') === partType
                )
            );
            return [...res.qcRecords, ...otherRecords];
          });
        }
        logAction('الفرز', `حفظ جدول مصفوفة الفرز (${data.stage} - ${getPartLabel(partType)}) للموديل`);
        addFlashMessage('تم حفظ جدول الفرز (الألوان × المقاسات) بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل حفظ جدول الفرز في الباك إند', 'danger');
      });
  };

  const recordQCStageCount = (data: {
    modelId: string;
    stage: QCStageType;
    piecesCounted?: number;
    defectQty?: number;
    matrixEntries?: QCMatrixCellInput[];
    defectNotes?: string;
    advanceStage?: boolean;
    partType?: GarmentPart;
  }) => {
    const model = models.find((m) => m.id === data.modelId);
    if (!model) return;
    const partType: GarmentPart = normalizePartKey(data.partType || 'shirt');

    const allowNotes =
      data.stage === 'before_print' ? canAddQCBeforePrintNotes() : canAddQCAfterPrintNotes();
    const cleanNotes = allowNotes ? (data.defectNotes?.trim() || '') : '';
    const qcId = 'qc-' + Date.now();
    const createdAt = new Date().toLocaleString('ar-EG', { hour12: false });
    const inspector = currentUser?.real_name || 'مراقب الجودة';

    const matrixList = (data.matrixEntries || []).map((cell) => ({
      ...cell,
      part_type: cell.part_type || partType
    }));
    const totalGoodFromMatrix =
      matrixList.length > 0
        ? matrixList.reduce((sum, cell) => sum + (Number(cell.good_qty) || 0), 0)
        : Number(data.piecesCounted) || 0;
    const totalDefectFromMatrix =
      matrixList.length > 0
        ? matrixList.reduce((sum, cell) => sum + (Number(cell.defect_qty) || 0), 0)
        : Number(data.defectQty) || 0;

    if (matrixList.length > 0) {
      const optimisticRecords: QCRecord[] = matrixList.map((cell, idx) => ({
        id: `qc-${Date.now()}-${idx}`,
        model_id: data.modelId,
        stage: data.stage,
        part_type: cell.part_type || partType,
        partType: cell.part_type || partType,
        color_name: cell.color_name,
        size: cell.size,
        pieces_cut: model.actual_cut_count || model.target_cut_quantity,
        good_qty: Math.max(0, Number(cell.good_qty) || 0),
        defect_qty: Math.max(0, Number(cell.defect_qty) || 0),
        counted_pieces: Math.max(0, Number(cell.good_qty) || 0),
        defect_pieces: Math.max(0, Number(cell.defect_qty) || 0),
        defect_notes: cell.notes || cleanNotes,
        notes: cell.notes || cleanNotes,
        inspector_name: inspector,
        created_at: createdAt
      }));

      setQcRecords((prev) => {
        const others = prev.filter(
          (q) =>
            !(
              q.model_id === data.modelId &&
              q.stage === data.stage &&
              (q.part_type || 'shirt') === partType
            )
        );
        return [...optimisticRecords, ...others];
      });
    } else {
      const newQC: QCRecord = {
        id: qcId,
        model_id: data.modelId,
        stage: data.stage,
        part_type: partType,
        partType: partType,
        color_name: model.model_type || 'الأساسي',
        pieces_cut: model.actual_cut_count || model.target_cut_quantity,
        good_qty: totalGoodFromMatrix,
        defect_qty: totalDefectFromMatrix,
        counted_pieces: totalGoodFromMatrix,
        defect_pieces: totalDefectFromMatrix,
        defect_notes: cleanNotes,
        notes: cleanNotes,
        inspector_name: inspector,
        created_at: createdAt
      };
      setQcRecords((prev) => [newQC, ...prev]);
    }

    setModels((prev) =>
      prev.map((m) => {
        if (m.id !== data.modelId) return m;
        const qcSummary = {
          ...(m.qc_summary || {}),
          [partType]: totalGoodFromMatrix
        } as Partial<Record<GarmentPart, number>>;
        const patched = {
          ...m,
          qc_shirt_pieces: partType === 'shirt' ? totalGoodFromMatrix : (m.qc_shirt_pieces || 0),
          qc_pants_pieces: partType === 'pants' ? totalGoodFromMatrix : (m.qc_pants_pieces || 0),
          qc_jacket_pieces: partType === 'jacket' ? totalGoodFromMatrix : (m.qc_jacket_pieces || 0),
          qc_summary: qcSummary
        };
        if (data.stage === 'before_print') {
          return {
            ...patched,
            count_before_print: totalGoodFromMatrix,
            ...(data.advanceStage ? { status: 'جاهز للطباعة / التجميع' } : {})
          };
        }
        if (data.stage === 'after_print') {
          return {
            ...patched,
            count_after_print: totalGoodFromMatrix,
            ...(data.advanceStage ? { status: 'في قسم المكن' } : {})
          };
        }
        return {
          ...patched,
          count_after_sewing: totalGoodFromMatrix,
          ...(data.advanceStage ? { status: 'في التشطيب' } : {})
        };
      })
    );

    api
      .recordQCStageCount(data.modelId, {
        qc_id: qcId,
        stage: data.stage,
        part_type: partType,
        counted_pieces: totalGoodFromMatrix,
        defect_pieces: totalDefectFromMatrix,
        matrix_entries: matrixList,
        notes: cleanNotes,
        advanceStage: data.advanceStage,
        user_name: inspector
      })
      .then((res) => {
        if (res.model) {
          setModels((prev) => prev.map((m) => (m.id === data.modelId ? res.model : m)));
        }
        if (Array.isArray(res.qcRecords) && res.qcRecords.length > 0) {
          setQcRecords((prev) => {
            const others = prev.filter(
              (q) =>
                !(
                  q.model_id === data.modelId &&
                  q.stage === data.stage &&
                  (q.part_type || 'shirt') === partType
                )
            );
            return [...res.qcRecords!, ...others];
          });
        } else if (res.qcRecord) {
          setQcRecords((prev) => prev.map((q) => (q.id === qcId ? res.qcRecord : q)));
        }
        addFlashMessage('تم تسجيل مصفوفة العد والفرز واعتماد المرحلة بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تسجيل العد في الباك إند', 'danger');
      });
  };

  const finishQCApproval = (modelId: string) => {
    const model = models.find((m) => m.id === modelId);
    setModels((prev) =>
      prev.map((m) => (m.id === modelId ? { ...m, status: 'جاهز للطباعة / التجميع' } : m))
    );
    api
      .finishQCApproval(modelId, currentUser?.real_name || 'مراقب الجودة')
      .then((saved) => {
        setModels((prev) => prev.map((m) => (m.id === modelId ? saved : m)));
        logAction('الفرز', `الاعتماد النهائي للفرز لموديل ${model?.model_code}`);
        addFlashMessage('تم إنهاء الفرز والاعتماد بنجاح، الموديل الآن متاح في قسم المطابع والتطريز');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل الاعتماد في الباك إند', 'danger');
      });
  };

  const exportQcCsv = (modelId: string) => {
    const targetModel = models.find((m) => m.id === modelId);
    const records = qcRecords.filter((r) => r.model_id === modelId);
    const headers = [
      'المرحلة',
      'كود الموديل',
      'اللون / القطعة',
      'المقاس',
      'العدد السليم',
      'العدد التالف (الهالك)',
      'المفتش',
      'ملاحظات العيوب',
      'تاريخ ووقت الفرز'
    ];
    const rows = records.map((r) => [
      r.stage === 'before_print'
        ? 'العد قبل الطباعة'
        : r.stage === 'after_print'
        ? 'العد بعد الطباعة'
        : 'العد بعد المكن',
      targetModel?.model_code || modelId,
      r.color_name || '-',
      r.size || '-',
      (r.good_qty ?? r.counted_pieces ?? 0).toString(),
      (r.defect_qty ?? r.defect_pieces ?? 0).toString(),
      r.inspector_name || '-',
      r.defect_notes || r.notes || '-',
      r.created_at
    ]);

    const csvContent =
      '\ufeff' +
      [headers.join(','), ...rows.map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `qc_matrix_${targetModel?.model_code || 'records'}_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    logAction('الفرز', `تصدير جدول مصفوفة الجودة للموديل ${targetModel?.model_code} إلى إكسيل`);
    addFlashMessage('تم تصدير جدول الفرز والجودة بنجاح');
  };

  // Printing & Embroidery Actions
  const addPrintDispatch = (data: {
    modelId: string;
    shopName: string;
    piecesCount: number;
    printType: string;
    pieceType?: GarmentPart;
    pieceLabel?: string;
    printLocation?: string;
    printDetails?: string;
    expectedDeliveryDate?: string;
    costPerPiece?: number;
    totalCost?: number;
    notes?: string;
  }) => {
    const targetModel = models.find((m) => m.id === data.modelId);
    const dispId = 'disp-' + Date.now();
    const dispatchedAt = new Date().toLocaleString('ar-EG', { hour12: false });
    const cleanNotes = canAddPrintingNotes() || canAddQCBeforePrintNotes() ? (data.notes?.trim() || '') : '';
    const pieceType = data.pieceType || 'shirt';
    const pieceLabel = (data.pieceLabel || '').trim() || getPartLabel(pieceType);
    const printLocation = (data.printLocation || '').trim();
    const printDetails = (data.printDetails || '').trim();

    const newDisp: PrintDispatch = {
      id: dispId,
      model_id: data.modelId,
      shop_name: data.shopName.trim(),
      piece_type: pieceType,
      piece_label: pieceLabel,
      print_location: printLocation,
      print_details: printDetails,
      dispatched_at: dispatchedAt,
      expected_delivery_date: data.expectedDeliveryDate,
      pieces_count: Math.max(0, data.piecesCount),
      print_type: data.printType.trim(),
      cost_per_piece: data.costPerPiece,
      total_cost:
        data.totalCost || (data.costPerPiece ? data.costPerPiece * data.piecesCount : undefined),
      notes: cleanNotes,
      status: 'مرسل للمطبعة'
    };
    setPrintDispatches((prev) => [newDisp, ...prev]);

    setModels((prev) =>
      prev.map((m) => {
        if (m.id !== data.modelId) return m;
        return {
          ...m,
          status: 'مرسل للمطبعة',
          print_house_name: data.shopName.trim(),
          print_house: data.shopName.trim(),
          print_cost: data.costPerPiece,
          print_expected_date: data.expectedDeliveryDate
        };
      })
    );

    api
      .createPrintDispatch({
        id: dispId,
        model_id: data.modelId,
        shop_name: data.shopName.trim(),
        piece_type: pieceType,
        piece_label: pieceLabel,
        print_location: printLocation,
        print_details: printDetails,
        pieces_count: Math.max(0, data.piecesCount),
        print_type: data.printType.trim(),
        cost_per_piece: data.costPerPiece || 0,
        expected_delivery_date: data.expectedDeliveryDate || null,
        dispatched_at: dispatchedAt,
        notes: cleanNotes,
        user_name: currentUser?.real_name || 'مسؤول المطابع'
      })
      .then((saved) => {
        setPrintDispatches((prev) => prev.map((d) => (d.id === dispId ? saved : d)));
        refreshState();
        logAction(
          'المطابع والتطريز',
          `إرسال ${data.piecesCount} قطعة من موديل ${targetModel?.model_code} إلى ${data.shopName}`
        );
        addFlashMessage(`تم إرسال الموديل للمطبعة (${data.shopName}) بنجاح`);
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تسجيل إرسالية المطبعة في الباك إند', 'danger');
      });
  };

  const updateDispatchStatus = (dispatchId: string, status: DispatchStatus) => {
    const disp = printDispatches.find((d) => d.id === dispatchId);
    if (!disp) return;

    setPrintDispatches((prev) =>
      prev.map((d) => {
        if (d.id !== dispatchId) return d;
        const receivedAt =
          status === 'تم الاستلام بالمصنع'
            ? new Date().toLocaleString('ar-EG', { hour12: false })
            : d.received_at;
        return { ...d, status, received_at: receivedAt };
      })
    );

    if (status === 'تم الاستلام بالمصنع') {
      setModels((prev) =>
        prev.map((m) => (m.id === disp.model_id ? { ...m, status: 'العد بعد الطباعة' } : m))
      );
    }

    api
      .updatePrintDispatchStatus(dispatchId, status, currentUser?.real_name || 'مسؤول المطابع')
      .then((saved) => {
        setPrintDispatches((prev) => prev.map((d) => (d.id === dispatchId ? saved : d)));
        refreshState();
        logAction('المطابع والتطريز', `تحديث حالة الإرسالية إلى: ${status}`);
        addFlashMessage(`تم تحديث حالة التشغيل إلى "${status}" بنجاح`);
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تحديث حالة الإرسالية في الباك إند', 'danger');
      });
  };

  // Sewing Section Actions
  const dispatchModelToSewing = (data: {
    modelId: string;
    workshopName: string;
    piecesCount: number;
    expectedDeliveryDate: string;
    pieceType?: GarmentPart;
    pieceLabel?: string;
    notes?: string;
  }) => {
    const targetModel = models.find((m) => m.id === data.modelId);
    const resolvedType = data.pieceType || 'shirt';
    const resolvedLabel = data.pieceLabel || getPartLabel(resolvedType);
    const dispId = 'sew-disp-' + Date.now();
    const cleanNotes = canAddSewingNotes() ? (data.notes?.trim() || '') : '';

    const newDisp: SewingDispatch = {
      id: dispId,
      model_id: data.modelId,
      piece_type: resolvedType,
      piece_label: resolvedLabel,
      workshop_name: data.workshopName.trim(),
      pieces_count: Math.max(0, data.piecesCount),
      dispatched_at: new Date().toLocaleString('ar-EG', { hour12: false }),
      expected_delivery_date: data.expectedDeliveryDate,
      status: 'في ورشة المكن',
      notes: cleanNotes
    };
    setSewingDispatches((prev) => [newDisp, ...prev]);

    setModels((prev) =>
      prev.map((m) => {
        if (m.id !== data.modelId) return m;
        const updates: Partial<DesignModel> = {
          status: 'في قسم المكن',
          sewing_workshop: data.workshopName.trim(),
          sewing_expected_date: data.expectedDeliveryDate,
          sewing_pieces_count: data.piecesCount
        };
        if (resolvedType === 'shirt') {
          updates.sewing_shirt_workshop = data.workshopName.trim();
          updates.sewing_shirt_expected_date = data.expectedDeliveryDate;
          updates.sewing_shirt_status = 'في ورشة المكن';
          updates.sewing_shirt_pieces = data.piecesCount;
        } else if (resolvedType === 'pants') {
          updates.sewing_pants_workshop = data.workshopName.trim();
          updates.sewing_pants_expected_date = data.expectedDeliveryDate;
          updates.sewing_pants_status = 'في ورشة المكن';
          updates.sewing_pants_pieces = data.piecesCount;
        }
        return { ...m, ...updates };
      })
    );

    api
      .dispatchModelToSewing(data.modelId, {
        id: dispId,
        workshop_name: data.workshopName.trim(),
        pieces_count: Math.max(0, data.piecesCount),
        expected_delivery_date: data.expectedDeliveryDate,
        piece_type: resolvedType,
        piece_label: resolvedLabel,
        notes: cleanNotes,
        user_name: currentUser?.real_name || 'مسؤول خطوط الخياطة'
      })
      .then((saved) => {
        setSewingDispatches((prev) => prev.map((d) => (d.id === dispId ? saved : d)));
        refreshState();
        logAction(
          'قسم المكن',
          `إرسال ${data.piecesCount} قطعة [${resolvedLabel}] من موديل ${targetModel?.model_code} إلى ورشة ${data.workshopName}`
        );
        addFlashMessage(`تم تسجيل خروج [${resolvedLabel}] لورشة الخياطة (${data.workshopName}) بنجاح`);
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تسجيل خروج الخياطة في الباك إند', 'danger');
      });
  };

  const receiveModelFromSewing = (dispatchId: string, modelId?: string, notes?: string) => {
    const disp = sewingDispatches.find((d) => d.id === dispatchId);
    const targetModelId = modelId || disp?.model_id;
    if (!targetModelId) return;
    const targetModel = models.find((m) => m.id === targetModelId);
    const pieceType = disp?.piece_type || 'shirt';
    const pieceLabel = disp?.piece_label || getPartLabel(pieceType);
    const cleanNotes = canAddSewingNotes() ? (notes?.trim() || '') : '';

    const updatedDispatches = sewingDispatches.map((d) => {
      if (d.id !== dispatchId) return d;
      return {
        ...d,
        status: 'تم الاستلام' as const,
        received_at: new Date().toLocaleString('ar-EG', { hour12: false }),
        ...(cleanNotes ? { notes: `${d.notes || ''} | استلام: ${cleanNotes}`.replace(/^\s*\|\s*/, '') } : {})
      };
    });
    setSewingDispatches(updatedDispatches);

    const otherPending = updatedDispatches.filter(
      (d) => d.model_id === targetModelId && d.id !== dispatchId && d.status !== 'تم الاستلام'
    );
    const allPiecesReceived = otherPending.length === 0;

    setModels((prev) =>
      prev.map((m) => {
        if (m.id !== targetModelId) return m;
        const updates: Partial<DesignModel> = {};
        if (pieceType === 'shirt') {
          updates.sewing_shirt_status = 'تم الاستلام';
        } else if (pieceType === 'pants') {
          updates.sewing_pants_status = 'تم الاستلام';
        }
        if (allPiecesReceived) {
          updates.status = 'العد بعد المكن';
        }
        return { ...m, ...updates };
      })
    );

    api
      .receiveFromSewing(dispatchId, currentUser?.real_name || 'مسؤول الإنتاج', cleanNotes)
      .then((saved) => {
        setSewingDispatches((prev) => prev.map((d) => (d.id === dispatchId ? saved : d)));
        refreshState();
        logAction(
          'قسم المكن',
          `استلام [${pieceLabel}] موديل ${targetModel?.model_code} من ورشة ${disp?.workshop_name}`
        );
        addFlashMessage(
          `تم استلام [${pieceLabel}] بنجاح${
            allPiecesReceived ? ' واكتمال القطع ونقل الموديل إلى العد بعد المكن بالفرز' : ''
          }`
        );
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تسجيل الاستلام في الباك إند', 'danger');
      });
  };

  const finishSewingToQC = (modelId: string, notes?: string) => {
    const targetModel = models.find((m) => m.id === modelId);
    const cleanNotes = canAddSewingNotes() ? (notes?.trim() || '') : '';
    setModels((prev) =>
      prev.map((m) => (m.id === modelId ? { ...m, status: 'العد بعد المكن' } : m))
    );

    api
      .finishSewingToQC(modelId, {
        notes: cleanNotes,
        user_name: currentUser?.real_name || 'مسؤول قسم المكن'
      })
      .then((saved) => {
        setModels((prev) => prev.map((m) => (m.id === modelId ? saved : m)));
        logAction('قسم المكن', `إنهاء خياطة الموديل ${targetModel?.model_code} وتحويله للعد النهائي`);
        addFlashMessage('تم إنهاء الخياطة وتحويل الموديل للعد النهائي بعد المكن بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تحديث حالة الخياطة في الباك إند', 'danger');
      });
  };

  const finishQCToProduction = (modelId: string, notes?: string) => {
    const targetModel = models.find((m) => m.id === modelId);
    const cleanNotes = canAddQCAfterPrintNotes() ? (notes?.trim() || '') : '';
    setModels((prev) =>
      prev.map((m) => (m.id === modelId ? { ...m, status: 'مخزن الإنتاج التام' } : m))
    );

    api
      .finishQCToProduction(modelId, {
        notes: cleanNotes,
        user_name: currentUser?.real_name || 'مراقب الجودة'
      })
      .then((saved) => {
        setModels((prev) => prev.map((m) => (m.id === modelId ? saved : m)));
        logAction('الإنتاج', `تحويل الموديل ${targetModel?.model_code} إلى مخزن الإنتاج التام`);
        addFlashMessage('تم تحويل الموديل إلى مخزن الإنتاج التام بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تحويل الموديل لمخزن الإنتاج في الباك إند', 'danger');
      });
  };

  // -----------------------------------------------------------------
  // Assembly & Packaging Actions (الأسمبلي والأمبالاج)
  // -----------------------------------------------------------------

  const getPackagingRequirement = useCallback(
    (modelId: string): PackagingRequirement | undefined =>
      packagingRequirements.find((req) => req.model_id === modelId),
    [packagingRequirements]
  );

  const setPackagingStep = (
    modelId: string,
    step: PackagingStepKey,
    date?: string,
    notes?: string
  ) => {
    const targetModel = models.find((m) => m.id === modelId);
    const resolvedDate = date || new Date().toISOString().slice(0, 10);
    const cleanNotes = notes?.trim() || '';

    const existing = packagingRequirements.find((req) => req.model_id === modelId);
    const merged = {
      ...(existing || {}),
      id: existing?.id || `pack-req-${Date.now()}`,
      model_id: modelId,
      model_code: targetModel?.model_code,
      [`${step}_date`]: resolvedDate,
      steps: {
        ...(existing?.steps || {}),
        [step]: resolvedDate
      },
      notes: cleanNotes || existing?.notes || '',
      missing_steps: existing?.missing_steps || [],
      is_complete: existing?.is_complete || false
    } as PackagingRequirement;

    setPackagingRequirements((prev) =>
      existing
        ? prev.map((req) => (req.model_id === modelId ? merged : req))
        : [...prev, merged]
    );

    api
      .setPackagingStep(modelId, {
        step,
        date: resolvedDate,
        notes: cleanNotes,
        user_name: currentUser?.real_name || 'مسؤول الأمبالاج'
      })
      .then((res) => {
        const saved: PackagingRequirement | undefined = res?.packagingRequirement;
        if (saved) {
          setPackagingRequirements((prev) => [
            saved,
            ...prev.filter((req) => req.model_id !== modelId)
          ]);
        }
        refreshState();
        logAction(
          'الأسمبلي والأمبالاج',
          `تسجيل خطوة أمبالاج (${step}) للموديل ${targetModel?.model_code}`
        );
        addFlashMessage('تم تسجيل خطوة متطلبات الأمبالاج بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تسجيل خطوة الأمبالاج في الباك إند', 'danger');
      });
  };

  const startFinishing = (data: {
    modelId: string;
    parts?: GarmentPart[];
    entryDate?: string;
    expectedExitDate?: string;
    notes?: string;
  }) => {
    const targetModel = models.find((m) => m.id === data.modelId);
    const parts = data.parts && data.parts.length ? data.parts : getModelParts(data.modelId);
    const cleanNotes = data.notes?.trim() || '';

    setModels((prev) =>
      prev.map((m) => (m.id === data.modelId ? { ...m, status: 'في التشطيب' } : m))
    );
    const optimistic: FinishingRecord[] = parts.map((part, index) => ({
      id: `finish-${Date.now()}-${index}`,
      model_id: data.modelId,
      model_code: targetModel?.model_code,
      part_type: part,
      piece_label: getPartLabel(part),
      entry_date: data.entryDate || new Date().toISOString().slice(0, 10),
      expected_exit_date: data.expectedExitDate || null,
      actual_exit_date: null,
      status: 'في التشطيب',
      is_received: false,
      notes: cleanNotes
    }));
    setFinishingRecords((prev) => [
      ...optimistic,
      ...prev.filter((rec) => rec.model_id !== data.modelId)
    ]);

    api
      .startFinishing(data.modelId, {
        parts,
        entry_date: data.entryDate,
        expected_exit_date: data.expectedExitDate,
        notes: cleanNotes,
        user_name: currentUser?.real_name || 'مسؤول التشطيب'
      })
      .then((res) => {
        const saved: FinishingRecord[] = Array.isArray(res?.finishingRecords)
          ? res.finishingRecords
          : [];
        if (saved.length) {
          setFinishingRecords((prev) => [
            ...saved,
            ...prev.filter((rec) => rec.model_id !== data.modelId)
          ]);
        }
        refreshState();
        logAction(
          'قسم التشطيب',
          `دخول قطع (${parts.map((p) => getPartLabel(p)).join(' / ')}) للموديل ${targetModel?.model_code} للتشطيب`
        );
        addFlashMessage('تم تسجيل دخول القطع لقسم التشطيب بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تسجيل التشطيب في الباك إند', 'danger');
      });
  };

  const receiveFinishing = (recordId: string, actualExitDate?: string, notes?: string) => {
    const record = finishingRecords.find((rec) => rec.id === recordId);
    if (!record) return;
    const targetModel = models.find((m) => m.id === record.model_id);
    const resolvedDate = actualExitDate || new Date().toISOString().slice(0, 10);
    const cleanNotes = notes?.trim() || '';

    const updated = finishingRecords.map((rec) =>
      rec.id === recordId
        ? {
            ...rec,
            actual_exit_date: resolvedDate,
            status: 'تم الاستلام' as const,
            is_received: true,
            notes: cleanNotes
              ? `${rec.notes || ''} | استلام: ${cleanNotes}`.replace(/^\s*\|\s*/, '')
              : rec.notes
          }
        : rec
    );
    setFinishingRecords(updated);

    const stillPending = updated.some(
      (rec) => rec.model_id === record.model_id && !rec.is_received
    );
    if (!stillPending) {
      setModels((prev) =>
        prev.map((m) => (m.id === record.model_id ? { ...m, status: 'في المكواة' } : m))
      );
    }

    api
      .receiveFinishing(record.model_id, {
        record_id: recordId,
        actual_exit_date: resolvedDate,
        notes: cleanNotes,
        user_name: currentUser?.real_name || 'مسؤول التشطيب'
      })
      .then((res) => {
        const saved: FinishingRecord[] = Array.isArray(res?.finishingRecords)
          ? res.finishingRecords
          : [];
        if (saved.length) {
          setFinishingRecords((prev) => [
            ...saved,
            ...prev.filter((rec) => rec.model_id !== record.model_id)
          ]);
        }
        refreshState();
        logAction(
          'قسم التشطيب',
          `استلام قطعة ${record.piece_label || getPartLabel(record.part_type)} من التشطيب للموديل ${targetModel?.model_code}`
        );
        addFlashMessage('تم تسجيل استلام القطعة من التشطيب بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تسجيل استلام التشطيب في الباك إند', 'danger');
      });
  };

  const ASSEMBLY_STAGE_STATUS_MAP: Record<AssemblyStageKey, DesignModel['status']> = {
    ironing: 'في المكواة',
    packaging: 'في التعبئة والتغليف',
    dest: 'جاهز للدَست'
  };

  const ASSEMBLY_STAGE_NEXT_STATUS_MAP: Record<AssemblyStageKey, DesignModel['status']> = {
    ironing: 'في التعبئة والتغليف',
    packaging: 'جاهز للدَست',
    dest: 'مخزن الإنتاج التام'
  };

  const startAssemblyStage = (data: {
    modelId: string;
    stage: AssemblyStageKey;
    entryDate?: string;
    expectedExitDate?: string;
    notes?: string;
  }) => {
    const targetModel = models.find((m) => m.id === data.modelId);
    const cleanNotes = data.notes?.trim() || '';
    const resolvedEntry = data.entryDate || new Date().toISOString().slice(0, 10);

    setModels((prev) =>
      prev.map((m) =>
        m.id === data.modelId ? { ...m, status: ASSEMBLY_STAGE_STATUS_MAP[data.stage] } : m
      )
    );
    setAssemblyStageRecords((prev) => {
      const others = prev.filter(
        (rec) => !(rec.model_id === data.modelId && rec.stage === data.stage)
      );
      return [
        {
          id: `asm-${data.stage}-${Date.now()}`,
          model_id: data.modelId,
          model_code: targetModel?.model_code,
          stage: data.stage,
          entry_date: resolvedEntry,
          expected_exit_date: data.expectedExitDate || null,
          actual_exit_date: null,
          status: 'جارية الآن' as const,
          is_completed: false,
          notes: cleanNotes
        },
        ...others
      ];
    });

    api
      .startAssemblyStage(data.modelId, {
        stage: data.stage,
        entry_date: resolvedEntry,
        expected_exit_date: data.expectedExitDate,
        notes: cleanNotes,
        user_name: currentUser?.real_name || 'مسؤول الأسمبلي'
      })
      .then((res) => {
        const saved: AssemblyStageRecord | undefined = res?.assemblyStageRecord;
        if (saved) {
          setAssemblyStageRecords((prev) => [
            saved,
            ...prev.filter(
              (rec) => !(rec.model_id === data.modelId && rec.stage === data.stage)
            )
          ]);
        }
        refreshState();
        logAction(
          'الأسمبلي والأمبالاج',
          `بدء مرحلة (${data.stage}) للموديل ${targetModel?.model_code}`
        );
        addFlashMessage('تم تسجيل بدء المرحلة بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل بدء المرحلة في الباك إند', 'danger');
      });
  };

  const receiveAssemblyStage = (
    recordId: string,
    actualExitDate?: string,
    notes?: string
  ) => {
    const record = assemblyStageRecords.find((rec) => rec.id === recordId);
    if (!record) return;
    const targetModel = models.find((m) => m.id === record.model_id);
    const resolvedDate = actualExitDate || new Date().toISOString().slice(0, 10);
    const cleanNotes = notes?.trim() || '';

    setAssemblyStageRecords((prev) =>
      prev.map((rec) =>
        rec.id === recordId
          ? {
              ...rec,
              actual_exit_date: resolvedDate,
              status: 'مكتملة' as const,
              is_completed: true,
              notes: cleanNotes
                ? `${rec.notes || ''} | استلام: ${cleanNotes}`.replace(/^\s*\|\s*/, '')
                : rec.notes
            }
          : rec
      )
    );
    setModels((prev) =>
      prev.map((m) =>
        m.id === record.model_id
          ? { ...m, status: ASSEMBLY_STAGE_NEXT_STATUS_MAP[record.stage] }
          : m
      )
    );

    api
      .receiveAssemblyStage(record.model_id, {
        record_id: recordId,
        actual_exit_date: resolvedDate,
        notes: cleanNotes,
        user_name: currentUser?.real_name || 'مسؤول الأسمبلي'
      })
      .then((res) => {
        const saved: AssemblyStageRecord | undefined = res?.assemblyStageRecord;
        if (saved) {
          setAssemblyStageRecords((prev) => prev.map((rec) => (rec.id === saved.id ? saved : rec)));
        }
        refreshState();
        logAction(
          'الأسمبلي والأمبالاج',
          `استلام الموديل ${targetModel?.model_code} من مرحلة (${record.stage})`
        );
        addFlashMessage('تم تسجيل استلام المرحلة بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل استلام المرحلة في الباك إند', 'danger');
      });
  };



  // Settings Actions
  const addSizeDef = (name: string, values: string) => {
    const newSize: SizeDef = {
      id: 'size-' + Date.now(),
      name: name.trim(),
      values: values.trim()
    };
    setSizeDefs((prev) => [...prev, newSize]);
    api
      .createSizeDef(newSize)
      .then((saved) => {
        setSizeDefs((prev) => prev.map((s) => (s.id === newSize.id ? saved : s)));
        logAction('الإعدادات', `تعريف فئة مقاسات جديدة: ${name}`);
        addFlashMessage('تمت إضافة فئة المقاسات بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل حفظ المقاس في الباك إند', 'danger');
      });
  };

  const addSupplier = (name: string, phone: string) => {
    const newSup: Supplier = {
      id: 'sup-' + Date.now(),
      name: name.trim(),
      phone: phone.trim()
    };
    setSuppliers((prev) => [...prev, newSup]);
    api
      .createSupplier(newSup)
      .then((saved) => {
        setSuppliers((prev) => prev.map((s) => (s.id === newSup.id ? saved : s)));
        logAction('الإعدادات', `إضافة مورد جديد: ${name}`);
        addFlashMessage('تمت إضافة المورد بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل حفظ المورد في الباك إند', 'danger');
      });
  };

  const updateSizeDef = (id: string, name: string, values: string) => {
    const cleanName = name.trim();
    const cleanValues = values.trim();
    if (!cleanName || !cleanValues) return;

    setSizeDefs((prev) =>
      prev.map((s) => (s.id === id ? { ...s, name: cleanName, values: cleanValues } : s))
    );
    api
      .updateSizeDef(id, { name: cleanName, values: cleanValues })
      .then((saved) => {
        setSizeDefs((prev) => prev.map((s) => (s.id === id ? saved : s)));
        logAction('الإعدادات', `تعديل فئة المقاسات: ${cleanName}`);
        addFlashMessage('تم تعديل فئة المقاسات بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تعديل المقاس في الباك إند', 'danger');
      });
  };

  const deleteSizeDef = (id: string) => {
    const target = sizeDefs.find((s) => s.id === id);
    setSizeDefs((prev) => prev.filter((s) => s.id !== id));
    api
      .deleteSizeDef(id)
      .then(() => {
        logAction('الإعدادات', `حذف فئة المقاسات: ${target?.name || id}`);
        addFlashMessage('تم حذف فئة المقاسات بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل حذف المقاس من الباك إند', 'danger');
      });
  };

  const updateSupplier = (id: string, name: string, phone: string) => {
    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    if (!cleanName) return;

    setSuppliers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, name: cleanName, phone: cleanPhone } : s))
    );
    api
      .updateSupplier(id, { name: cleanName, phone: cleanPhone })
      .then((saved) => {
        setSuppliers((prev) => prev.map((s) => (s.id === id ? saved : s)));
        logAction('الإعدادات', `تعديل بيانات المورد: ${cleanName}`);
        addFlashMessage('تم تحديث بيانات المورد بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تعديل المورد في الباك إند', 'danger');
      });
  };

  const deleteSupplier = (id: string) => {
    const target = suppliers.find((s) => s.id === id);
    setSuppliers((prev) => prev.filter((s) => s.id !== id));
    api
      .deleteSupplier(id)
      .then(() => {
        logAction('الإعدادات', `حذف المورد: ${target?.name || id}`);
        addFlashMessage('تم حذف المورد بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل حذف المورد من الباك إند', 'danger');
      });
  };

  const addUser = (userData: Omit<User, 'id'>) => {
    if (userData.username.trim().toLowerCase() === 'sudo') {
      addFlashMessage('اسم المستخدم هذا محجوز للنظام ولا يمكن استخدامه', 'danger');
      return;
    }
    // حماية الرتب: لا يمكن منح رتبة مساوية أو أعلى من رتبة المستخدم الحالي.
    const safeRank = clampRankToVisible(userData.rank_level);
    const newUser: User = {
      ...userData,
      rank_level: safeRank,
      is_sudo: false,
      id: 'user-' + Date.now()
    };
    setUsers((prev) => [...prev, newUser]);
    api
      .createUser(newUser)
      .then((saved) => {
        setUsers((prev) => prev.map((u) => (u.id === newUser.id ? saved : u)));
        logAction('إدارة الحسابات', `إنشاء حساب جديد للموظف: ${newUser.username}`);
        addFlashMessage(`تم إنشاء حساب جديد للموظف ${newUser.real_name} وحفظه في قاعدة البيانات`);
      })
      .catch((err) => {
        setUsers((prev) => prev.filter((u) => u.id !== newUser.id));
        addFlashMessage(err.message || 'فشل إنشاء الحساب في الباك إند', 'danger');
      });
  };

  const toggleUserActive = (userId: string) => {
    const targetUser = users.find((u) => u.id === userId);
    if (!targetUser) return { success: false, message: 'المستخدم غير موجود' };
    if (targetUser.username?.toLowerCase() === 'sudo' || targetUser.is_sudo) {
      return { success: false, message: 'لا يمكن تعطيل هذا الحساب' };
    }
    if (targetUser.id === currentUser?.id) {
      return { success: false, message: 'لا يمكنك تعطيل حسابك الشخصي' };
    }
    if (!isRankVisibleToActor(targetUser.rank_level)) {
      return { success: false, message: 'لا تمتلك صلاحية تعديل هذا المستخدم' };
    }

    const nextState = !targetUser.is_active;
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, is_active: nextState } : u))
    );
    const actText = nextState ? 'تفعيل' : 'إيقاف';

    api
      .toggleUserActive(userId)
      .then((saved) => {
        setUsers((prev) => prev.map((u) => (u.id === userId ? saved : u)));
        logAction('إدارة الحسابات', `${actText} حساب المستخدم: ${targetUser.username}`);
        addFlashMessage(`تم ${actText} الحساب بنجاح`);
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || `فشل ${actText} الحساب في الباك إند`, 'danger');
      });

    return { success: true, message: `تم ${actText} الحساب بنجاح` };
  };

  const updateUserPermissionsAndPassword = (
    userId: string,
    permissions: User['permissions'],
    newPassword?: string,
    newRole?: string,
    roleId?: string,
    newRank?: number
  ) => {
    const target = users.find((u) => u.id === userId);
    if (target && (target.username?.toLowerCase() === 'sudo' || target.is_sudo)) {
      addFlashMessage('غير مسموح بتعديل هذا الحساب', 'danger');
      return;
    }
    // حماية الرتب: منع تعديل من هم في رتبتك أو أعلى، ومنع منح رتبة أعلى من رتبتك.
    if (target && target.id !== currentUser?.id && !isRankVisibleToActor(target.rank_level)) {
      addFlashMessage('لا تمتلك صلاحية تعديل هذا المستخدم', 'danger');
      return;
    }
    const safeNewRank: RankLevel | undefined =
      newRank === undefined
        ? undefined
        : target && target.id === currentUser?.id
          ? // لا يمكن للمستخدم تعديل رتبته بنفسه (منع تصعيد الذات).
            Number(target.rank_level ?? 3) as RankLevel
          : clampRankToVisible(newRank);

    setUsers((prev) =>
      prev.map((u) => {
        if (u.id !== userId) return u;
        return {
          ...u,
          permissions: { ...permissions },
          ...(newRole ? { role: newRole } : {}),
          ...(roleId ? { role_id: roleId } : {}),
          ...(safeNewRank !== undefined ? { rank_level: safeNewRank } : {})
        };
      })
    );

    api
      .updateUser(userId, {
        permissions,
        ...(newPassword ? { password: newPassword } : {}),
        ...(newRole ? { role: newRole } : {}),
        ...(roleId ? { role_id: roleId } : {}),
        ...(safeNewRank !== undefined ? { rank_level: safeNewRank } : {})
      })
      .then((saved) => {
        setUsers((prev) => prev.map((u) => (u.id === userId ? saved : u)));
        if (currentUser?.id === userId) {
          setCurrentUser(saved);
        }
        logAction('إدارة الحسابات', `تحديث بيانات وصلاحيات الموظف (ID: ${userId})`);
        addFlashMessage('تم حفظ تعديلات وصلاحيات المستخدم في قاعدة البيانات بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تحديث المستخدم في الباك إند', 'danger');
      });
  };

  const deleteUser = (userId: string) => {
    const target = users.find((u) => u.id === userId);
    if (!target) return { success: false, message: 'المستخدم غير موجود' };
    if (target.username?.toLowerCase() === 'sudo' || target.is_sudo) {
      return { success: false, message: 'لا يمكن حذف هذا الحساب' };
    }
    if (target.id === currentUser?.id) {
      return { success: false, message: 'لا يمكنك حذف حسابك الشخصي' };
    }
    if (!isRankVisibleToActor(target.rank_level)) {
      return { success: false, message: 'لا تمتلك صلاحية حذف هذا المستخدم' };
    }
    const previousUsers = [...users];
    setUsers((prev) => prev.filter((u) => u.id !== userId));
    api
      .deleteUser(userId)
      .then(() => {
        logAction('إدارة الحسابات', `حذف المستخدم: ${target.username}`);
        addFlashMessage(`تم حذف المستخدم ${target.real_name} نهائياً من قاعدة البيانات`);
      })
      .catch((err) => {
        setUsers(previousUsers);
        addFlashMessage(err.message || 'فشل حذف المستخدم من الباك إند', 'danger');
      });
    return { success: true, message: 'تم الحذف بنجاح' };
  };

  const markNotificationRead = (id: string) => {
    setReadNotificationIds((prev) => {
      const updated = prev.includes(id) ? prev : [...prev, id];
      try {
        localStorage.setItem('erp_read_notifications', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  // Smart Real-time In-App Notifications for Expected Delivery Dates
  const appNotifications = useMemo<AppNotification[]>(() => {
    const list: AppNotification[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    printDispatches.forEach((disp) => {
      if (disp.status === 'تم الاستلام بالمصنع' || !disp.expected_delivery_date) return;
      const model = models.find((m) => m.id === disp.model_id);
      const modelCode = model?.model_code || 'موديل';

      const expDate = new Date(disp.expected_delivery_date);
      expDate.setHours(0, 0, 0, 0);
      const diffDays = Math.round((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      const notifId = `notif-print-${disp.id}-${disp.expected_delivery_date}`;

      if (diffDays < 0) {
        list.push({
          id: notifId,
          model_id: disp.model_id,
          model_code: modelCode,
          stage: 'printing',
          source_name: disp.shop_name,
          expected_date: disp.expected_delivery_date,
          urgency: 'overdue',
          days_diff: diffDays,
          title: `🚨 تأخر استلام من المطبعة (${modelCode})`,
          message: `تخطى موعد استلام الموديل ${modelCode} من مطبعة ${disp.shop_name} بمقدار ${Math.abs(diffDays)} يوم، ولم يتم تسجيل الاستلام بعد!`,
          is_read: readNotificationIds.includes(notifId),
          created_at: disp.dispatched_at
        });
      } else if (diffDays === 0) {
        list.push({
          id: notifId,
          model_id: disp.model_id,
          model_code: modelCode,
          stage: 'printing',
          source_name: disp.shop_name,
          expected_date: disp.expected_delivery_date,
          urgency: 'today',
          days_diff: 0,
          title: `⏰ موعد استلام اليوم (${modelCode})`,
          message: `اليوم موعد استلام الموديل ${modelCode} من مطبعة ${disp.shop_name}.`,
          is_read: readNotificationIds.includes(notifId),
          created_at: disp.dispatched_at
        });
      } else if (diffDays === 1) {
        list.push({
          id: notifId,
          model_id: disp.model_id,
          model_code: modelCode,
          stage: 'printing',
          source_name: disp.shop_name,
          expected_date: disp.expected_delivery_date,
          urgency: 'tomorrow',
          days_diff: 1,
          title: `📅 موعد استلام غداً (${modelCode})`,
          message: `غداً موعد استلام الموديل ${modelCode} من مطبعة ${disp.shop_name}.`,
          is_read: readNotificationIds.includes(notifId),
          created_at: disp.dispatched_at
        });
      }
    });

    sewingDispatches.forEach((disp) => {
      if (disp.status === 'تم الاستلام' || !disp.expected_delivery_date) return;
      const model = models.find((m) => m.id === disp.model_id);
      const modelCode = model?.model_code || 'موديل';
      const pieceLabel = disp.piece_label ? ` [${disp.piece_label}]` : '';

      const expDate = new Date(disp.expected_delivery_date);
      expDate.setHours(0, 0, 0, 0);
      const diffDays = Math.round((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      const notifId = `notif-sew-${disp.id}-${disp.expected_delivery_date}`;

      if (diffDays < 0) {
        list.push({
          id: notifId,
          model_id: disp.model_id,
          model_code: modelCode,
          stage: 'sewing',
          source_name: disp.workshop_name,
          expected_date: disp.expected_delivery_date,
          urgency: 'overdue',
          days_diff: diffDays,
          title: `🚨 تأخر استلام من ورشة المكن${pieceLabel} (${modelCode})`,
          message: `تخطى موعد استلام ${modelCode}${pieceLabel} من ورشة ${disp.workshop_name} بمقدار ${Math.abs(diffDays)} يوم، ولم يتم تسجيل الاستلام بعد!`,
          is_read: readNotificationIds.includes(notifId),
          created_at: disp.dispatched_at
        });
      } else if (diffDays === 0) {
        list.push({
          id: notifId,
          model_id: disp.model_id,
          model_code: modelCode,
          stage: 'sewing',
          source_name: disp.workshop_name,
          expected_date: disp.expected_delivery_date,
          urgency: 'today',
          days_diff: 0,
          title: `⏰ موعد استلام اليوم${pieceLabel} (${modelCode})`,
          message: `اليوم موعد استلام الموديل ${modelCode}${pieceLabel} من ورشة المكن (${disp.workshop_name}).`,
          is_read: readNotificationIds.includes(notifId),
          created_at: disp.dispatched_at
        });
      } else if (diffDays === 1) {
        list.push({
          id: notifId,
          model_id: disp.model_id,
          model_code: modelCode,
          stage: 'sewing',
          source_name: disp.workshop_name,
          expected_date: disp.expected_delivery_date,
          urgency: 'tomorrow',
          days_diff: 1,
          title: `📅 موعد استلام غداً${pieceLabel} (${modelCode})`,
          message: `غداً موعد استلام الموديل ${modelCode}${pieceLabel} من ورشة المكن (${disp.workshop_name}).`,
          is_read: readNotificationIds.includes(notifId),
          created_at: disp.dispatched_at
        });
      }
    });

    // 3. Finishing (التشطيب) — per part records
    finishingRecords.forEach((rec) => {
      if (rec.is_received || !rec.expected_exit_date) return;
      const model = models.find((m) => m.id === rec.model_id);
      const modelCode = model?.model_code || 'موديل';
      const label = rec.piece_label || getPartLabel(rec.part_type);

      const expDate = new Date(rec.expected_exit_date);
      expDate.setHours(0, 0, 0, 0);
      const diffDays = Math.round((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const notifId = `notif-finish-${rec.id}-${rec.expected_exit_date}`;

      if (diffDays < 0) {
        list.push({
          id: notifId,
          model_id: rec.model_id,
          model_code: modelCode,
          stage: 'finishing',
          source_name: 'قسم التشطيب',
          expected_date: rec.expected_exit_date,
          urgency: 'overdue',
          days_diff: diffDays,
          title: `🚨 تأخر استلام من التشطيب [${label}] (${modelCode})`,
          message: `تخطى موعد خروج [${label}] موديل ${modelCode} من التشطيب بمقدار ${Math.abs(
            diffDays
          )} يوم، ولم يتم تسجيل الاستلام بعد!`,
          is_read: readNotificationIds.includes(notifId),
          created_at: rec.entry_date || rec.expected_exit_date
        });
      } else if (diffDays === 0) {
        list.push({
          id: notifId,
          model_id: rec.model_id,
          model_code: modelCode,
          stage: 'finishing',
          source_name: 'قسم التشطيب',
          expected_date: rec.expected_exit_date,
          urgency: 'today',
          days_diff: 0,
          title: `⏰ موعد استلام اليوم [${label}] (${modelCode})`,
          message: `اليوم موعد استلام [${label}] موديل ${modelCode} من قسم التشطيب.`,
          is_read: readNotificationIds.includes(notifId),
          created_at: rec.entry_date || rec.expected_exit_date
        });
      } else if (diffDays === 1) {
        list.push({
          id: notifId,
          model_id: rec.model_id,
          model_code: modelCode,
          stage: 'finishing',
          source_name: 'قسم التشطيب',
          expected_date: rec.expected_exit_date,
          urgency: 'tomorrow',
          days_diff: 1,
          title: `📅 موعد استلام غداً [${label}] (${modelCode})`,
          message: `غداً موعد استلام [${label}] موديل ${modelCode} من قسم التشطيب.`,
          is_read: readNotificationIds.includes(notifId),
          created_at: rec.entry_date || rec.expected_exit_date
        });
      }
    });

    // 4. Assembly stages (المكواة / التعبئة والتغليف / الدَست)
    const assemblyStageNames: Record<AssemblyStageKey, string> = {
      ironing: 'قسم المكواة',
      packaging: 'قسم التعبئة والتغليف',
      dest: 'قسم الدَست'
    };
    assemblyStageRecords.forEach((rec) => {
      if (rec.is_completed || !rec.expected_exit_date) return;
      const model = models.find((m) => m.id === rec.model_id);
      const modelCode = model?.model_code || 'موديل';
      const stageName = assemblyStageNames[rec.stage] || rec.stage;

      const expDate = new Date(rec.expected_exit_date);
      expDate.setHours(0, 0, 0, 0);
      const diffDays = Math.round((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const notifId = `notif-asm-${rec.stage}-${rec.id}-${rec.expected_exit_date}`;

      if (diffDays < 0) {
        list.push({
          id: notifId,
          model_id: rec.model_id,
          model_code: modelCode,
          stage: rec.stage,
          source_name: stageName,
          expected_date: rec.expected_exit_date,
          urgency: 'overdue',
          days_diff: diffDays,
          title: `🚨 تأخر استلام (${modelCode})`,
          message: `تخطى موعد خروج الموديل ${modelCode} من ${stageName} بمقدار ${Math.abs(
            diffDays
          )} يوم، ولم يتم تسجيل الاستلام بعد!`,
          is_read: readNotificationIds.includes(notifId),
          created_at: rec.entry_date || rec.expected_exit_date
        });
      } else if (diffDays === 0) {
        list.push({
          id: notifId,
          model_id: rec.model_id,
          model_code: modelCode,
          stage: rec.stage,
          source_name: stageName,
          expected_date: rec.expected_exit_date,
          urgency: 'today',
          days_diff: 0,
          title: `⏰ موعد استلام اليوم (${modelCode})`,
          message: `اليوم موعد استلام الموديل ${modelCode} من ${stageName}.`,
          is_read: readNotificationIds.includes(notifId),
          created_at: rec.entry_date || rec.expected_exit_date
        });
      } else if (diffDays === 1) {
        list.push({
          id: notifId,
          model_id: rec.model_id,
          model_code: modelCode,
          stage: rec.stage,
          source_name: stageName,
          expected_date: rec.expected_exit_date,
          urgency: 'tomorrow',
          days_diff: 1,
          title: `📅 موعد استلام غداً (${modelCode})`,
          message: `غداً موعد استلام الموديل ${modelCode} من ${stageName}.`,
          is_read: readNotificationIds.includes(notifId),
          created_at: rec.entry_date || rec.expected_exit_date
        });
      }
    });

    const priorityOrder = { overdue: 0, today: 1, tomorrow: 2 };
    return list.sort((a, b) => priorityOrder[a.urgency] - priorityOrder[b.urgency]);
  }, [
    printDispatches,
    sewingDispatches,
    finishingRecords,
    assemblyStageRecords,
    models,
    readNotificationIds
  ]);

  const unreadNotificationsCount = useMemo(() => {
    return appNotifications.filter((n) => n.urgency === 'overdue' || !n.is_read).length;
  }, [appNotifications]);

  return (
    <AppContext.Provider
      value={{
        currentUser,
        setCurrentUser,
        login,
        logout,
        refreshState,
        isLoadingState,
        globalSettings,
        updateGlobalSettings,
        formatSupplierWhatsappMessage,
        users,
        onlineUsers,
        roles,
        auditLogs,
        sizeDefs,
        suppliers,
        fabrics,
        fabricColors,
        fabricTransactions,
        models,
        requirements,
        accessories,
        modelAccessories: accessories,
        cuttingRecords,
        qcRecords,
        printDispatches,
        sewingDispatches,
        packagingRequirements,
        finishingRecords,
        assemblyStageRecords,
        appNotifications,
        unreadNotificationsCount,
        markNotificationRead,
        flashMessages,
        addFlashMessage,
        removeFlashMessage,
        addRole,
        updateRole,
        deleteRole,
        hasPermission,
        hasSpecificPermission,
        canManagePermissions,
        canManageUsers,
        canManageSuppliers,
        canManageSizes,
        canViewAuditLogs,
        canViewGlobalSettings,
        canEditHeaderSettings,
        canEditMessageTemplates,
        canAccessSettings,
        canManageHR,
        currentUserRank,
        visibleRankLevels,
        visibleRankOptions,
        rankLabelFor,
        canAccessHRSection,
        canAddDesignNotes,
        canAddCuttingNotes,
        canAddQCBeforePrintNotes,
        canAddQCAfterPrintNotes,
        canAddSewingNotes,
        canAddPrintingNotes,
        canViewFabricPrices,
        canEditFabricPrices,
        canViewAccessoryPrices,
        canEditAccessoryPrices,
        canViewPrintingCosts,
        canEditPrintingCosts,
        canSendWhatsApp,
        canSendMessages,
        internalMessages,
        unreadMessagesCount,
        sendInternalMessage,
        markMessageRead,
        addFabricOrColor,
        recordTransaction,
        exportWarehouseInventoryCsv,
        updateColorPrice,
        accessoryTypes,
        accessoryItems,
        accessoryTransactions,
        addAccessoryType,
        addAccessoryItem,
        updateAccessoryItem,
        deleteAccessoryItem,
        recordAccessoryTransaction,
        exportAccessoryInventoryCsv,
        markAccessoryWithdrawn,
        addDesignModel,
        updateModelPlan,
        updateModelNotesAndTarget,
        addModelRequirement,
        deleteModelRequirement,
        addModelAccessory,
        deleteModelAccessory,
        issueFabricToCutting,
        deleteDesignModel,
        addCuttingRecord,
        finishCuttingToQC,
        exportCuttingCsv,
        getModelParts,
        getModelColorList,
        getModelSizeList,
        recordQCData,
        addQCRecord: recordQCData,
        saveQCMatrix,
        recordQCStageCount,
        finishQCApproval,
        exportQcCsv,
        addPrintDispatch,
        updateDispatchStatus,
        dispatchModelToSewing,
        receiveModelFromSewing,
        finishSewingToQC,
        finishQCToProduction,
        getPackagingRequirement,
        setPackagingStep,
        startFinishing,
        receiveFinishing,
        startAssemblyStage,
        receiveAssemblyStage,
        addSizeDef,
        updateSizeDef,
        deleteSizeDef,
        addSupplier,
        updateSupplier,
        deleteSupplier,
        addUser,
        toggleUserActive,
        updateUserPermissionsAndPassword,
        deleteUser,
        logAction,
        addModelTimelineEvent
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};