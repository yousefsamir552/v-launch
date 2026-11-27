import { api, auditContextHeaders } from '../api/client';
import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import {
  User,
  AuditLog,
  SizeDef,
  Supplier,
  Workshop,
  WorkshopType,
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
  ReadinessStageKey,
  RankLevel,
  RankOption,
  GlobalSiteSettings,
  AccessoryType,
  AccessoryItem,
  AccessoryTransaction,
  AccessoryUnit,
  AccessoryUsageType,
  PurchaseRequest,
  PurchaseRequestCategory,
  ModelTimelineEvent,
  SewingDispatch,
  SewingDispatchStatus,
  AppNotification,
  InternalMessage,
  PackagingRequirement,
  PackagingStepKey,
  FinishingRecord,
  AssemblyStageRecord,
  AssemblyStageKey,
  PackagingMaterialRule,
  PackagingMaterialSizeRule,
  PackagingMaterialOperation,
  PackagingMaterialShortageItem,
  WorkshopEvaluation,
  WorkshopEvaluationStage,
  PartStage,
  PART_STAGE_LABELS,
  PART_STAGE_ORDER,
  MODEL_STATUS_TO_PART_STAGE,
  deriveStatusFromStages,
  SnoozeHours,
  SNOOZED_NOTIFICATIONS_STORAGE_KEY,
  UIPreferences
} from '../types';
import { buildPackagingDemandMap } from '../utils/packagingMaterials';
import { finishedSetsOf, photographyOutstandingOf } from '../utils/completedModels';
import { exportCsv, exportZipCsv, datedFileName, CsvValue, CsvSheet } from '../utils/exportExcel';

/**
 * ربط مرحلة التنبيه بمفتاح الصلاحية المطلوبة لرؤيته.
 * التنبيهات لا تظهر إلا لمن يملك صلاحية القسم — حساب sudo يرى كل شيء.
 */

export const NOTIFICATION_STAGE_PERMISSION: Record<AppNotification['stage'], string> = {
  printing: 'printing',
  sewing: 'sewing',
  finishing: 'assembly_packaging',
  ironing: 'assembly_packaging',
  packaging: 'assembly_packaging',
  dest: 'assembly_packaging',
  materials: 'assembly_packaging'
};

export const makeIdempotentRequestId = (prefix: string): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export interface FlashMessage {
  id: string;
  type: 'success' | 'danger' | 'warning' | 'info';
  text: string;
}

// ---------------------------------------------------------------------------
// Per-part stage helpers shared by the pipeline actions.
// Every garment part moves on its own; the coarse ModelItem.status is always
// re-derived from the least advanced part.
// ---------------------------------------------------------------------------
export const modelPartsOf = (model: DesignModel): GarmentPart[] => {
  const explicit = Array.from(
    new Set(
      (model.garment_parts || [])
        .map((p) => String(p).toLowerCase() as GarmentPart)
        .filter((p) => (PART_ORDER as string[]).includes(p))
    )
  );
  if (explicit.length > 0) return explicit;
  if (model.parts && model.parts.length > 0) return model.parts;
  return partsForComposition(model.garment_composition);
};

/** Seeds part_stages from the coarse status for models created before per-part tracking. */
export const seedModelPartStages = (model: DesignModel): DesignModel => {
  if (model.part_stages && Object.keys(model.part_stages).length > 0) return model;
  const fallback = MODEL_STATUS_TO_PART_STAGE[model.status as string] || 'cutting';
  const seeded: Partial<Record<GarmentPart, PartStage>> = {};
  modelPartsOf(model).forEach((part) => {
    seeded[part] = fallback;
  });
  return { ...model, part_stages: seeded };
};

/** Moves a single part forward to a stage (never backward) and re-derives status. */
export const patchModelPartStage = (
  model: DesignModel,
  part: GarmentPart,
  stage: PartStage
): DesignModel => {
  const seeded = seedModelPartStages(model);
  const current = seeded.part_stages?.[part];
  const nextStage: PartStage =
    current && PART_STAGE_ORDER.indexOf(current) > PART_STAGE_ORDER.indexOf(stage)
      ? current
      : stage;
  const stages: Partial<Record<GarmentPart, PartStage>> = {
    ...(seeded.part_stages || {}),
    [part]: nextStage
  };
  const derived = deriveStatusFromStages(stages);
  return {
    ...seeded,
    part_stages: stages,
    ...(derived ? { status: derived } : {})
  };
};

/** Moves the given parts (defaults to every part) forward to one stage. */
export const patchModelPartsStage = (
  model: DesignModel,
  stage: PartStage,
  parts?: GarmentPart[]
): DesignModel => {
  const targets = parts && parts.length > 0 ? parts : modelPartsOf(model);
  return targets.reduce(
    (acc, part) => patchModelPartStage(acc, part, stage),
    seedModelPartStages(model)
  );
};

export const DEFAULT_GLOBAL_SETTINGS: GlobalSiteSettings = {
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
  favorite_accessory_ids: [],
  accessory_groups: [],
  department_targets: {}
};

export const DESIGN_STAGES = new Set(['مرحلة التصميم', 'تصميم']);

// مراحل ما قبل الإنتاج: تعديل الموديل فيها لا يُعد تعديلاً على "موديل منتهٍ".
export const PRE_PRODUCTION_STAGES = new Set(['مرحلة التصميم', 'تصميم', 'في القص', 'جاري القص']);

/**
 * ترويسات تدقيق تُمرَّر عند تعديل موديل تجاوز قسم التصميم/القص،
 * ليقوم الباك إند بتسجيل السجل بعلامة "[تعديل على موديل منتهي]".
 * القسم يحدد اسم الشاشة/القسم الذي تم منه التعديل داخل سجل التدقيق.
 */
export const auditHeadersForModel = (
  model?: DesignModel | null,
  section: string = 'التصميم'
) => {
  if (!model) return undefined;
  return PRE_PRODUCTION_STAGES.has(model.status) ? undefined : auditContextHeaders(section);
};

/**
 * حقول فرشة القص القابلة للتعديل من نافذة تعديل الفرشة.
 * كل الحقول اختيارية: أي حقل غير مُرسل يبقى على قيمته الحالية في السجل.
 */
export interface CuttingRecordUpdate {
  partType?: GarmentPart;
  spreadNumber?: number;
  isSubCut?: boolean;
  subCutLabel?: string;
  spreaderName?: string;
  cutterName?: string;
  colorLayers?: CuttingSpreadLayer[];
  colorName?: string;
  layersCount?: number;
  piecesPerLayer?: number;
  layerWeight?: number;
  piecesCount?: number;
  shadeDegree?: string;
  notes?: string;
}

export interface AppContextType {
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
  /**
   * فتح واتساب لإرسال طلب موحّد:
   * - إن وُجد رابط جروب → ينسخ نص الرسالة تلقائياً (لأن الواتساب لا يقبل نصاً مسبقاً في الجروبات) ثم يفتح الجروب.
   * - وإلا إن وُجد رقم هاتف → يفتح محادثة wa.me مع النص جاهزاً.
   * - وإلا → ينسخ النص مع تنبيه.
   */
  openWhatsAppOrder: (phone: string | undefined | null, groupLink: string | undefined | null, messageText: string) => void;
  users: User[];
  onlineUsers: User[];
  roles: CustomRole[];
  auditLogs: AuditLog[];
  sizeDefs: SizeDef[];
  suppliers: Supplier[];
  workshops: Workshop[];
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
  workshopEvaluations: WorkshopEvaluation[];
  submitWorkshopEvaluation: (data: {
    workshopId?: string;
    workshopName: string;
    stage: WorkshopEvaluationStage;
    modelId: string;
    printDispatchId?: string;
    sewingDispatchId?: string;
    finishingRecordId?: string;
    deliveryTimeliness: number;
    workQuality: number;
    finishingQuality: number;
    notes?: string;
  }) => Promise<{ success: boolean; message: string; evaluation?: WorkshopEvaluation }>;
  packagingMaterialRules: PackagingMaterialRule[];
  savePackagingMaterialRule: (data: {
    materialKey: PackagingMaterialRule['material_key'];
    name?: string;
    icon?: string;
    unit?: PackagingMaterialRule['unit'];
    ruleMode?: PackagingMaterialRule['rule_mode'];
    applicableSizeGroups?: string[];
    sizeRules?: Array<{
      id?: string;
      sizeGroupId: string;
      sizeGroupName: string;
      consumptionPerPiece: number;
      dimensionsSpec?: string;
      supplierId?: string;
      minAlertThreshold: number;
      currentStock?: number;
      /** سعر الوحدة (يُرسل فقط لمن يملك edit_assembly_prices). */
      pricePerUnit?: number;
    }>;
  }) => Promise<{ success: boolean; message: string }>;
  recordPackagingMaterialTransaction: (data: {
    sizeRuleId: string;
    operation: PackagingMaterialOperation;
    amount: number;
    notes?: string;
    /** سعر الوحدة (يُرسل فقط لمن يملك edit_assembly_prices). */
    pricePerUnit?: number;
    clientId?: string;
  }) => Promise<{ success: boolean; message: string }>;
  deletePackagingMaterialRule: (ruleId: string) => Promise<{ success: boolean; message: string }>;
  appNotifications: AppNotification[];
  unreadNotificationsCount: number;
  markNotificationRead: (id: string) => void;
  snoozeNotification: (id: string, hours: SnoozeHours) => void;
  clearSnoozedNotifications: () => void;
  /** عدد التنبيهات المخفية حالياً بسبب التأجيل (لعرض زر الاستعادة فقط عند الحاجة). */
  snoozedNotificationsCount: number;
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

  // Privilege Delegation (تفويض الصلاحيات ومنع تصعيدها)
  /** الصلاحيات القابلة للتفويض للمستخدم الحالي (null = sudo، أي كل شيء). */
  getEffectiveDelegatablePermissions: () => string[] | null;
  canDelegatePermission: (permKey: string) => boolean;
  getRoleEnabledPermissionKeys: (role: CustomRole | null | undefined) => string[];
  isRoleAssignable: (role: CustomRole | null | undefined) => boolean;
  /** كل الحسابات التي أنشأها هذا المستخدم (شجرة متكررة عبر created_by). */
  getCreatedDescendants: (userId: string) => User[];
  // "الأسمبلي والأمبالاج": يقبل المفتاح الرئيسي الحالي (assembly_packaging)
  // والمفاتيح القديمة/الفرعية (assembly، packaging، finishing، ironing، dest، materials)
  hasAssemblyPackagingAccess: (requireEdit?: boolean) => boolean;

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

  // Per-stage Model Readiness permissions (الصلاحيات المستقلة لجاهزية الموديلات)
  canAccessReadinessStage: (stage: ReadinessStageKey) => boolean;
  canAccessAnyReadiness: () => boolean;
  /** صلاحية مستقلة لعرض الموديلات السابقة / المنتهية في الأقسام. */
  canViewPreviousModels: () => boolean;
  /** صلاحية مستقلة لتخصيص شكل التنقل والواجهة (وضع الكروت / Accordion / ترتيب الكروت). */
  canCustomizeNavigation: () => boolean;

  // User Navigation & UI Preferences (تفضيلات التنقل والواجهة لكل مستخدم)
  uiPreferences: UIPreferences;
  setSidebarCollapsed: (collapsed: boolean) => void;
  updateUiPreferences: (
    patch: Partial<UIPreferences>
  ) => Promise<{ success: boolean; message?: string; user?: User }>;

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

  // Financial & Sensitive Permissions Checkers (صلاحية مستقلة لكل قسم)
  canViewFabricPrices: () => boolean;
  canEditFabricPrices: () => boolean;
  canViewAccessoryPrices: () => boolean;
  canEditAccessoryPrices: () => boolean;
  canViewPrintingPrices: () => boolean;
  canEditPrintingPrices: () => boolean;
  /** @deprecated استخدم canViewPrintingPrices */
  canViewPrintingCosts: () => boolean;
  /** @deprecated استخدم canEditPrintingPrices */
  canEditPrintingCosts: () => boolean;
  canViewSewingPrices: () => boolean;
  canEditSewingPrices: () => boolean;
  canViewAssemblyPrices: () => boolean;
  canEditAssemblyPrices: () => boolean;
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
  }) => { success: boolean; message: string; fabricId: string; promise?: Promise<boolean> };
  recordTransaction: (data: {
    colorId: string;
    operation: 'add' | 'deduct';
    amount: number;
    modelCodeRef?: string;
    notes?: string;
    clientId?: string;
  }) => { success: boolean; message: string; promise?: Promise<boolean> };
  exportWarehouseInventoryCsv: () => void;
  updateColorPrice: (colorId: string, price: number) => void;
  /** تعديل بيانات لون القماش الأساسية (الكود، الاسم، الدرجة، والسعر حسب الصلاحية). */
  updateFabricColorDetails: (
    colorId: string,
    updates: { color_code?: string; color_name?: string; hex_code?: string; price_per_unit?: number }
  ) => { success: boolean; message: string };

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
    /** ربط تلقائي بجدول إكسسوارات الموديل بعد نجاح الإنشاء في الباك إند. */
    link_model?: {
      modelId: string;
      target_type?: 'shirt' | 'pants' | 'jacket' | 'single';
      piece_consumption?: number;
      planned_quantity?: number;
    };
  }) => { success: boolean; message: string; itemId: string };
  updateAccessoryItem: (id: string, updates: Partial<AccessoryItem>) => void;
  deleteAccessoryItem: (id: string) => { success: boolean; message: string };
  recordAccessoryTransaction: (data: {
    accessoryId: string;
    operation: 'add' | 'deduct';
    amount: number;
    modelCodeRef?: string;
    notes?: string;
    clientId?: string;
  }) => { success: boolean; message: string; promise?: Promise<boolean> };
  exportAccessoryInventoryCsv: () => void;
  markAccessoryWithdrawn: (accessoryId: string) => void;
  issueModelAccessories: (
    modelId: string,
    data?: {
      issuedTo?: string;
      notes?: string;
      accessoryIds?: string[];
      quantities?: Record<string, number>;
    }
  ) => Promise<{ success: boolean; message: string }>;

  // Purchase Requests (طلبات الشراء والمشتريات)
  purchaseRequests: PurchaseRequest[];
  addPurchaseRequest: (data: {
    item_name: string;
    quantity: number;
    unit?: string;
    image?: string;
    model_id?: string;
    model_code_text?: string;
    category?: PurchaseRequestCategory | string;
    notes?: string;
  }) => Promise<{ success: boolean; message: string; request?: PurchaseRequest }>;
  updatePurchaseRequest: (
    id: string,
    updates: {
      item_name?: string;
      quantity?: number;
      unit?: string;
      image?: string;
      model_id?: string;
      model_code_text?: string;
      category?: PurchaseRequestCategory | string;
      notes?: string;
    }
  ) => Promise<{ success: boolean; message: string; request?: PurchaseRequest }>;
  deletePurchaseRequest: (id: string) => Promise<{ success: boolean; message: string }>;
  markPurchaseRequestPurchased: (
    id: string,
    data: {
      purchased_price: number;
      supplier_id?: string;
      supplier_name?: string;
      purchase_notes?: string;
    }
  ) => Promise<{ success: boolean; message: string; request?: PurchaseRequest }>;
  exportPurchaseRequestsCsv: (mode?: 'pending' | 'purchased' | 'all') => void;

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
    notesJacket?: string;
    garmentComposition?: GarmentComposition;
  }) => { success: boolean; message: string; modelId?: string };
  cloneDesignModel: (
    sourceModelId: string,
    newModelCode: string,
    targetQuantity?: number
  ) => Promise<{ success: boolean; message: string; modelId?: string }>;
  updateModelPlan: (data: {
    modelId: string;
    reqQuantities: Record<string, number>;
    accQuantities: Record<string, number>;
    mainMarkerUrl?: string;
    printMarkerUrl?: string;
    designNotes?: string;
    notesShirt?: string;
    notesPants?: string;
    notesJacket?: string;
    targetCutQuantity?: number;
  }) => { success: boolean; message: string };
  updateModelNotesAndTarget: (
    modelId: string,
    data: {
      target_cut_quantity?: number;
      design_notes?: string;
      notes_shirt?: string;
      notes_pants?: string;
      notes_jacket?: string;
      garment_composition?: GarmentComposition;
    }
  ) => void;
  updateDesignModelBasicInfo: (
    modelId: string,
    data: {
      model_code?: string;
      image?: string;
      model_type?: string;
      size_category_id?: string;
      garment_composition?: GarmentComposition;
      target_cut_quantity?: number;
      design_notes?: string;
    }
  ) => Promise<{ success: boolean; message: string }>;
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
      target_type?: 'shirt' | 'pants' | 'jacket' | 'single';
      piece_consumption?: number;
      planned_quantity?: number;
      /** عند true لا تُعرض رسالة نجاح فردية (تُستخدم عند الإضافة ضمن مجموعة برسالة ملخّصة). */
      silent?: boolean;
    }
  ) => { success: boolean; message: string };
  deleteModelAccessory: (accId: string) => void;
  issueFabricToCutting: (
    modelId: string,
    extraData?: { reqQuantities?: Record<string, number>; accQuantities?: Record<string, number> }
  ) => { success: boolean; message: string };
  returnFabricFromCutting: (
    modelId: string,
    requirementId: string,
    quantity: number,
    notes?: string,
    defectQuantity?: number
  ) => Promise<{ success: boolean; message: string }>;
  deleteDesignModel: (modelId: string, confirmPostCutting?: boolean) => void;

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
    isSubCut?: boolean;
    subCutLabel?: string;
    clientId?: string;
  }) => Promise<boolean>;
  /** تعديل كامل لفرشة قص قائمة (يشمل تحويلها بين أساسية/فرعية). */
  updateCuttingRecord: (recordId: string, updates: CuttingRecordUpdate) => void;
  /** حذف فرشة قص نهائياً مع إعادة حساب أعداد القطع وفائض القماش. */
  deleteCuttingRecord: (recordId: string) => void;
  finishCuttingToQC: (modelId: string, notes?: string, parts?: GarmentPart[]) => void;
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

  // Unified permission-aware exports (Excel/CSV)
  exportDesignModelsCsv: () => void;
  exportFabricTransactionsCsv: () => void | Promise<void>;
  exportAccessoryTransactionsCsv: () => void | Promise<void>;
  exportProductionWarehouseCsv: () => void;
  exportPrintDispatchesCsv: () => void;
  exportSewingDispatchesCsv: () => void;
  exportAssemblyPackagingCsv: () => void;
  exportPackagingMaterialsCsv: () => void;
  exportSuppliersCsv: () => void;
  exportWorkshopsCsv: () => void;
  exportAuditLogsCsv: () => void;
  /** نسخة احتياطية كاملة (ZIP) لكل الأقسام المتاحة للمستخدم. */
  exportFullBackupZip: () => Promise<void>;
  /** تصدير بيانات الموارد البشرية فقط (ZIP) بحسب صلاحية كل تبويب. */
  exportHRSectionsZip: () => Promise<void>;

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
    clientId?: string;
    allowOverLimit?: boolean;
  }) => Promise<boolean>;
  updateDispatchStatus: (
    dispatchId: string,
    status: DispatchStatus,
    receivedQty?: number,
    notes?: string,
    quickReceive?: boolean
  ) => void;
  skipPrintToSewing: (modelId: string, part: GarmentPart) => void;

  // Sewing Actions
  dispatchModelToSewing: (data: {
    modelId: string;
    workshopName: string;
    piecesCount: number;
    expectedDeliveryDate: string;
    pieceType?: GarmentPart;
    pieceLabel?: string;
    /** سعر تشغيل القطعة (يُرسل فقط لمن يملك edit_sewing_prices). */
    costPerPiece?: number;
    totalCost?: number;
    notes?: string;
    clientId?: string;
  }) => Promise<boolean>;
  receiveModelFromSewing: (
    dispatchId: string,
    modelId?: string,
    notes?: string,
    receivedQty?: number,
    quickReceive?: boolean
  ) => void;
  finishSewingToQC: (modelId: string, notes?: string) => void;
  finishQCToProduction: (modelId: string, notes?: string) => void;

  // Assembly & Packaging Actions (الأسمبلي والأمبالاج)
  getPackagingRequirement: (modelId: string) => PackagingRequirement | undefined;
  setPackagingStep: (
    modelId: string,
    step: PackagingStepKey,
    date?: string,
    notes?: string,
    qty?: number
  ) => void;
  startFinishing: (data: {
    modelId: string;
    parts?: GarmentPart[];
    entryDate?: string;
    expectedExitDate?: string;
    vendorName?: string;
    notes?: string;
    /** سعر تشطيب القطعة (يُرسل فقط لمن يملك edit_assembly_prices). */
    costPerPiece?: number;
    totalCost?: number;
  }) => void;
  receiveFinishing: (recordId: string, actualExitDate?: string, notes?: string) => void;
  startAssemblyStage: (data: {
    modelId: string;
    stage: AssemblyStageKey;
    entryDate?: string;
    expectedExitDate?: string;
    vendorName?: string;
    partType?: GarmentPart;
    notes?: string;
    /** سعر المرحلة (يُرسل فقط لمن يملك edit_assembly_prices). */
    costPerPiece?: number;
    totalCost?: number;
    completedPieces?: number;
    expectedPieces?: number;
  }) => Promise<{ success: boolean; message?: string; shortages?: PackagingMaterialShortageItem[] }>;
  receiveAssemblyStage: (
    recordId: string,
    actualExitDate?: string,
    notes?: string,
    completedPieces?: number
  ) => void;
  startIroning: (data: {
    modelId: string;
    partType?: GarmentPart;
    parts?: GarmentPart[];
    entryDate?: string;
    expectedExitDate?: string;
    vendorName?: string;
    notes?: string;
    /** سعر المكواة للقطعة (يُرسل فقط لمن يملك edit_assembly_prices). */
    costPerPiece?: number;
    totalCost?: number;
  }) => void;
  receiveIroning: (recordId: string, actualExitDate?: string, notes?: string) => void;
  /** Independent stage of each garment part (falls back to the model status). */
  getPartStages: (modelId: string) => Partial<Record<GarmentPart, PartStage>>;
  /** True when every part of the model reached the packaging stage. */
  isPackagingReady: (modelId: string) => boolean;
  /** مطبّع موحّد لمسميات القطع (تيشرت / بنطلون / جاكيت / قطعة واحدة). */
  normalizePartKey: (value?: string | null) => GarmentPart;

  // Settings Actions
  addSizeDef: (name: string, values: string) => void;
  updateSizeDef: (id: string, name: string, values: string) => void;
  deleteSizeDef: (id: string) => void;
  addSupplier: (name: string, phone: string, whatsappGroupLink?: string) => void;
  updateSupplier: (id: string, name: string, phone: string, whatsappGroupLink?: string) => void;
  deleteSupplier: (id: string) => void;
  addWorkshop: (data: {
    name: string;
    phone: string;
    whatsappGroupLink?: string;
    workshopType: WorkshopType[];
    notes?: string;
  }) => void;
  updateWorkshop: (
    id: string,
    data: {
      name: string;
      phone: string;
      whatsappGroupLink?: string;
      workshopType: WorkshopType[];
      notes?: string;
    }
  ) => void;
  deleteWorkshop: (id: string) => void;
  addUser: (user: Omit<User, 'id'>) => Promise<boolean>;
  toggleUserActive: (userId: string, cascade?: boolean) => { success: boolean; message: string };
  updateUserPermissionsAndPassword: (
    userId: string,
    permissions: User['permissions'],
    newPassword?: string,
    newRole?: string,
    roleId?: string,
    newRank?: number,
    delegatablePermissions?: string[]
  ) => void;
  deleteUser: (userId: string, cascade?: boolean) => { success: boolean; message: string };

  // Log & Timeline helper
  logAction: (
    action: string,
    details: string,
    options?: {
      persist?: boolean;
      actionType?: 'export' | 'print' | 'custom';
      targetName?: string;
    }
  ) => void;
  addModelTimelineEvent: (modelId: string, event: Omit<ModelTimelineEvent, 'id' | 'timestamp'>) => void;
}

export const AppContext = createContext<AppContextType | null>(null);

export const LEGACY_STORAGE_KEYS = [
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


export interface AppInternalContext extends AppContextType {
  setCurrentUserState: React.Dispatch<React.SetStateAction<User | null>>;
  setIsLoadingState: React.Dispatch<React.SetStateAction<boolean>>;
  setGlobalSettings: React.Dispatch<React.SetStateAction<GlobalSiteSettings>>;
  setRoles: React.Dispatch<React.SetStateAction<CustomRole[]>>;
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  setOnlineUsers: React.Dispatch<React.SetStateAction<User[]>>;
  setSizeDefs: React.Dispatch<React.SetStateAction<SizeDef[]>>;
  setSuppliers: React.Dispatch<React.SetStateAction<Supplier[]>>;
  setWorkshops: React.Dispatch<React.SetStateAction<Workshop[]>>;
  setFabrics: React.Dispatch<React.SetStateAction<Fabric[]>>;
  fabricColorsRaw: FabricColor[];
  setFabricColors: React.Dispatch<React.SetStateAction<FabricColor[]>>;
  setFabricTransactions: React.Dispatch<React.SetStateAction<FabricTransaction[]>>;
  setModels: React.Dispatch<React.SetStateAction<DesignModel[]>>;
  setRequirements: React.Dispatch<React.SetStateAction<ModelRequirement[]>>;
  setAccessories: React.Dispatch<React.SetStateAction<ModelAccessory[]>>;
  setAccessoryTypes: React.Dispatch<React.SetStateAction<AccessoryType[]>>;
  accessoryItemsRaw: AccessoryItem[];
  setAccessoryItems: React.Dispatch<React.SetStateAction<AccessoryItem[]>>;
  setAccessoryTransactions: React.Dispatch<React.SetStateAction<AccessoryTransaction[]>>;
  setPurchaseRequests: React.Dispatch<React.SetStateAction<PurchaseRequest[]>>;
  setCuttingRecords: React.Dispatch<React.SetStateAction<CuttingRecord[]>>;
  setQcRecords: React.Dispatch<React.SetStateAction<QCRecord[]>>;
  setPrintDispatches: React.Dispatch<React.SetStateAction<PrintDispatch[]>>;
  setSewingDispatches: React.Dispatch<React.SetStateAction<SewingDispatch[]>>;
  setPackagingRequirements: React.Dispatch<React.SetStateAction<PackagingRequirement[]>>;
  setFinishingRecords: React.Dispatch<React.SetStateAction<FinishingRecord[]>>;
  setAssemblyStageRecords: React.Dispatch<React.SetStateAction<AssemblyStageRecord[]>>;
  setWorkshopEvaluations: React.Dispatch<React.SetStateAction<WorkshopEvaluation[]>>;
  setPackagingMaterialRules: React.Dispatch<React.SetStateAction<PackagingMaterialRule[]>>;
  setInternalMessages: React.Dispatch<React.SetStateAction<InternalMessage[]>>;
  setAuditLogs: React.Dispatch<React.SetStateAction<AuditLog[]>>;
  setFlashMessages: React.Dispatch<React.SetStateAction<FlashMessage[]>>;
  readNotificationIds: string[];
  setReadNotificationIds: React.Dispatch<React.SetStateAction<string[]>>;
  snoozedNotifications: Record<string, string>;
  setSnoozedNotifications: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  designModelIdsSet: Set<string>;
  normalizePartKey: (value?: string | null) => GarmentPart;
  getUserPermissionsObject: () => RolePermissions | null;
  isCurrentUserSudo: () => boolean;
  isRankVisibleToActor: (rankValue?: number) => boolean;
  clampRankToVisible: (rankValue?: number) => RankLevel;
}
