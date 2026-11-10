export type SystemSectionKey =
  | 'fabric_warehouse'
  | 'accessories_warehouse'
  | 'production_warehouse'
  | 'design'
  | 'cutting'
  | 'qc'
  | 'printing'
  | 'sewing'
  | 'assembly_packaging'
  | 'models_tracking'
  | 'reports';

/** التبويبات السبعة المستقلة لقسم الموارد البشرية. */
export type HRSectionKey =
  | 'jobs'
  | 'employees'
  | 'attendance'
  | 'rules'
  | 'loans'
  | 'penalties'
  | 'payroll';

export const HR_SECTION_KEYS: HRSectionKey[] = [
  'jobs',
  'employees',
  'attendance',
  'rules',
  'loans',
  'penalties',
  'payroll'
];

/** ربط كل تبويب HR بمفتاح الصلاحية الخاص به. */
export const HR_SECTION_PERM_MAP: Record<HRSectionKey, string> = {
  jobs: 'hr_jobs',
  employees: 'hr_employees',
  attendance: 'hr_attendance',
  rules: 'hr_rules',
  loans: 'hr_loans',
  penalties: 'hr_penalties',
  payroll: 'hr_payroll'
};

/**
 * الرتب الهرمية الصارمة:
 * 0 = Sudo (محصورة في حساب الطوارئ)، 1 = إدارة عليا، 2 = إشرافية، 3 = عام.
 */
export type RankLevel = 0 | 1 | 2 | 3;

export interface RankOption {
  value: RankLevel;
  label: string;
  description: string;
}

export interface RolePermissions {
  // Section access permissions (View / Edit)
  fabric_warehouse_view: boolean;
  fabric_warehouse_edit: boolean;
  accessories_warehouse_view: boolean;
  accessories_warehouse_edit: boolean;
  production_warehouse_view: boolean;
  production_warehouse_edit: boolean;
  design_view: boolean;
  design_edit: boolean;
  cutting_view: boolean;
  cutting_edit: boolean;
  qc_view: boolean;
  qc_edit: boolean;
  printing_view: boolean;
  printing_edit: boolean;
  sewing_view: boolean;
  sewing_edit: boolean;
  assembly_packaging_view: boolean;
  assembly_packaging_edit: boolean;
  models_tracking_view: boolean;
  models_tracking_edit: boolean;
  reports_view: boolean;
  reports_edit: boolean;

  // Fine-grained financial permissions
  view_fabric_prices: boolean;
  edit_fabric_prices: boolean;
  view_accessory_prices: boolean;
  edit_accessory_prices: boolean;
  view_printing_costs: boolean;
  edit_printing_costs: boolean;

  // Warehouse WhatsApp dispatch permissions
  send_whatsapp_requests: boolean;

  // Internal messaging permission
  send_internal_messages: boolean;

  // Dynamic administrative permissions (Task 2 - no longer Sudo-exclusive)
  manage_permissions?: boolean;
  manage_users?: boolean;
  manage_suppliers?: boolean;
  manage_sizes?: boolean;
  view_audit_logs?: boolean;

  // Human Resources (HR) section permission
  can_manage_hr?: boolean;

  // Granular per-tab HR permissions
  hr_jobs?: boolean;
  hr_employees?: boolean;
  hr_attendance?: boolean;
  hr_rules?: boolean;
  hr_loans?: boolean;
  hr_penalties?: boolean;
  hr_payroll?: boolean;

  // Global Site Settings permissions (Task 3)
  view_global_settings?: boolean;
  edit_header_settings?: boolean;
  edit_message_templates?: boolean;

  // Department-specific Notes permissions (Task 4)
  can_add_design_notes?: boolean;
  can_add_cutting_notes?: boolean;
  can_add_qc_before_print_notes?: boolean;
  can_add_qc_after_print_notes?: boolean;
  can_add_sewing_notes?: boolean;
  can_add_printing_notes?: boolean;
}

export interface GlobalSiteSettings {
  id?: string;
  site_name: string;
  logo: string;
  footer_title: string;
  copyright_text: string;
  whatsapp_supplier_template: string;
  default_sewing_instructions: string;
  internal_message_templates: string[];
  favorite_accessory_ids?: string[];
  updated_by?: string;
  updated_at?: string;
}

export interface CustomRole {
  id: string;
  name: string;
  description: string;
  permissions: RolePermissions;
  users_count?: number;
  created_at?: string;
  /** الرتبة الهرمية للدور (0 محصورة في sudo). */
  rank_level?: number;
  rank_label?: string;
}

export type PermissionLevel = 'view' | 'edit';
export type UserRole = 'sudo' | 'owner' | 'staff' | string;

export interface UserPermissions {
  warehouse?: PermissionLevel;
  design?: PermissionLevel;
  cutting?: PermissionLevel;
  qc?: PermissionLevel;
  printing?: PermissionLevel;
  sewing?: PermissionLevel;
  assembly_packaging?: PermissionLevel;
  models_tracking?: PermissionLevel;
  fabric_warehouse?: PermissionLevel;
  accessories_warehouse?: PermissionLevel;
  production_warehouse?: PermissionLevel;
  reports?: PermissionLevel;

  // Specific fine-grained overrides if applicable (any permission can be granted directly to a user)
  view_fabric_prices?: boolean;
  edit_fabric_prices?: boolean;
  view_accessory_prices?: boolean;
  edit_accessory_prices?: boolean;
  view_printing_costs?: boolean;
  edit_printing_costs?: boolean;
  send_whatsapp_requests?: boolean;
  send_internal_messages?: boolean;

  // Administrative & Settings overrides
  manage_permissions?: boolean;
  manage_users?: boolean;
  manage_suppliers?: boolean;
  manage_sizes?: boolean;
  view_audit_logs?: boolean;
  can_manage_hr?: boolean;
  view_global_settings?: boolean;
  edit_header_settings?: boolean;
  edit_message_templates?: boolean;

  // Section Notes overrides
  can_add_design_notes?: boolean;
  can_add_cutting_notes?: boolean;
  can_add_qc_before_print_notes?: boolean;
  can_add_qc_after_print_notes?: boolean;
  can_add_sewing_notes?: boolean;
  can_add_printing_notes?: boolean;

  [key: string]: any;
}

export interface User {
  id: string;
  username: string;
  real_name: string;
  password?: string;
  phone?: string;
  role: string;
  role_id?: string;
  is_sudo?: boolean;
  permissions: UserPermissions;
  is_active: boolean;
  last_active?: string;
  last_seen?: string;
  /** الرتبة الهرمية للمستخدم (0 محصورة في sudo). */
  rank_level?: number;
  rank_label?: string;
}

export interface AuditLog {
  id: string;
  userId?: string;
  userName: string;
  action: string;
  details: string;
  ip_address: string;
  timestamp: string;
}

export interface SizeDef {
  id: string;
  name: string;
  values: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
}

export type FabricUnit = 'توب' | 'كيلو' | 'متر';

export interface Fabric {
  id: string;
  name: string;
  description: string;
  unit: FabricUnit;
  supplier_id?: string;
  image?: string;
  is_deleted?: boolean;
}

export interface FabricColor {
  id: string;
  fabric_id: string;
  color_code: string;
  color_name: string;
  hex_code: string;
  price_per_unit: number;
  quantity: number;
  reserved_quantity: number;
}

export interface FabricTransaction {
  id: string;
  color_id: string;
  fabric_id: string;
  model_code_ref?: string;
  notes?: string;
  operation: 'add' | 'deduct';
  amount: number;
  timestamp: string;
}

export type ModelStatus =
  | 'مرحلة التصميم'
  | 'تصميم'
  | 'في القص'
  | 'جاري القص'
  | 'العد قبل الطباعة'
  | 'فرز قبل الطباعة'
  | 'جاهز للطباعة / التجميع'
  | 'جاهز للمطبعة'
  | 'مرسل للمطبعة'
  | 'في المطبعة'
  | 'العد بعد الطباعة'
  | 'في قسم المكن'
  | 'العد بعد المكن'
  | 'في التشطيب'
  | 'في المكواة'
  | 'في التعبئة والتغليف'
  | 'جاهز للدَست'
  | 'مخزن الإنتاج التام'
  | 'مكتمل الإنتاج'
  | 'فرز وكنترول';

export interface ModelTimelineEvent {
  id?: string;
  stage: string;
  title?: string;
  description?: string;
  user_name?: string;
  timestamp: string;
  details?: Record<string, any>;
  notes?: string;
  user?: string;
}

export interface DesignModel {
  id: string;
  model_code: string;
  image: string;
  model_type: string;
  status: ModelStatus;
  size_category_id?: string;
  main_marker_url: string;
  print_marker_url: string;

  // Quantities & Operations
  target_cut_quantity: number;
  actual_cut_count?: number;
  total_cut_pieces?: number;
  cutter_name?: string;
  spreader_name?: string;
  count_before_print?: number;
  count_after_print?: number;
  count_after_sewing?: number;

  // Per-part tracking (تيشرت / بنطلون / جاكيت / قطعة واحدة)
  garment_parts?: GarmentPart[];
  garment_composition?: GarmentComposition;
  parts?: GarmentPart[];
  part_stages?: Partial<Record<GarmentPart, PartStage>>;
  part_stages_detail?: Record<string, PartStageInfo>;
  cut_summary?: Partial<Record<GarmentPart, number>>;
  qc_summary?: Partial<Record<GarmentPart, number>>;
  sewing_available?: Partial<Record<GarmentPart, number>>;
  completed_sets?: number;
  cut_shirt_pieces?: number;
  cut_pants_pieces?: number;
  cut_jacket_pieces?: number;
  qc_shirt_pieces?: number;
  qc_pants_pieces?: number;
  qc_jacket_pieces?: number;
  print_house_name?: string;
  print_house?: string;
  print_cost?: number;
  withdrawn_fabric_qty?: number;
  marker_length?: number;
  marker_shirt_length?: number;
  marker_pants_length?: number;

  // Expected Delivery & Workshop tracking
  print_expected_date?: string;
  sewing_workshop?: string;
  sewing_expected_date?: string;
  sewing_pieces_count?: number;

  // Split sewing independent tracking for Shirt & Pants
  sewing_shirt_workshop?: string;
  sewing_shirt_expected_date?: string;
  sewing_shirt_status?: SewingDispatchStatus;
  sewing_shirt_pieces?: number;

  sewing_pants_workshop?: string;
  sewing_pants_expected_date?: string;
  sewing_pants_status?: SewingDispatchStatus;
  sewing_pants_pieces?: number;

  // Design & Split operating notes
  design_notes?: string;
  notes_shirt: string;
  notes_pants: string;

  colored_at?: string;
  cut_at?: string;
  created_at: string;
  is_deleted: boolean;
  timeline?: ModelTimelineEvent[];
  accessories?: ModelAccessory[];
}

export type Model = DesignModel;

export interface ModelRequirement {
  id: string;
  model_id: string;
  color_id: string;
  part_name: string;
  planned_quantity: number;
  required_quantity?: number;
}

export interface ModelAccessory {
  id: string;
  model_id: string;
  target_type: 'shirt' | 'pants';
  piece_consumption: number;
  planned_quantity: number;
  accessory_id?: string;
  accessory_code?: string;
  accessory_name: string;
  unit?: string;
  image?: string;
}

export interface CuttingSpreadLayer {
  id?: string;
  spread_id?: string;
  color_name: string;
  colorName?: string;
  layers_count: number;
  layersCount?: number;
  layer_weight?: number;
  layerWeight?: number;
  pieces_count?: number;
  piecesCount?: number;
  shade_degree?: string;
  shadeDegree?: string;
  notes?: string;
}

export interface CuttingRecord {
  id: string;
  model_id: string;
  spread_number?: number;
  spreadNumber?: number;
  spreader_name?: string;
  spreaderName?: string;
  cutter_name?: string;
  cutterName?: string;
  color_name?: string;
  colorName?: string;
  color_layers?: CuttingSpreadLayer[];
  colorLayers?: CuttingSpreadLayer[];
  color_code?: string;
  fabric_name?: string;
  part?: 'shirt' | 'pants' | string;
  part_type?: GarmentPart;
  partType?: GarmentPart;
  recorded_by?: string;
  layers_count: number;
  layersCount?: number;
  pieces_per_layer?: number;
  piecesPerLayer?: number;
  layer_weight: number;
  layerWeight?: number;
  pieces_count: number;
  piecesCount?: number;
  cut_pieces?: number;
  shade_degree?: string;
  shadeDegree?: string;
  notes?: string;
  created_at: string;
}

export type QCStageType = 'before_print' | 'after_print' | 'after_sewing';

// Unified garment part keys. 'shirt' is canonical for تيشرت (legacy code already uses it).
export type GarmentPart = 'shirt' | 'pants' | 'jacket' | 'single';

export const PART_LABELS: Record<GarmentPart, string> = {
  shirt: 'تيشرت',
  pants: 'بنطلون',
  jacket: 'جاكيت',
  single: 'قطعة واحدة'
};

export const PART_ORDER: GarmentPart[] = ['shirt', 'pants', 'jacket', 'single'];

export const getPartLabel = (part?: string): string =>
  PART_LABELS[(part as GarmentPart) || 'shirt'] || 'تيشرت';

// Model-level garment composition: which parts the model is made of.
// Drives which parts (تيشرت / بنطلون / جاكيت) appear in Design, Cutting and QC.
export type GarmentComposition = 'tshirt_only' | 'pants_only' | 'two_pieces' | 'three_pieces';

export const GARMENT_COMPOSITION_LABELS: Record<GarmentComposition, string> = {
  tshirt_only: 'تيشيرت فقط',
  pants_only: 'بنطلون فقط',
  two_pieces: 'قطعتان (تيشيرت + بنطلون)',
  three_pieces: 'ثلاث قطع (تيشيرت + بنطلون + جاكيت)'
};

export const GARMENT_COMPOSITION_ORDER: GarmentComposition[] = [
  'tshirt_only',
  'pants_only',
  'two_pieces',
  'three_pieces'
];

export const COMPOSITION_TO_PARTS: Record<GarmentComposition, GarmentPart[]> = {
  tshirt_only: ['shirt'],
  pants_only: ['pants'],
  two_pieces: ['shirt', 'pants'],
  three_pieces: ['shirt', 'pants', 'jacket']
};

export const DEFAULT_GARMENT_COMPOSITION: GarmentComposition = 'two_pieces';

export const partsForComposition = (composition?: string): GarmentPart[] =>
  COMPOSITION_TO_PARTS[(composition as GarmentComposition) || DEFAULT_GARMENT_COMPOSITION] ||
  COMPOSITION_TO_PARTS.two_pieces;

export interface QCMatrixCellInput {
  part_type?: GarmentPart;
  partType?: GarmentPart;
  color_name: string;
  size: string;
  good_qty: number;
  defect_qty: number;
  notes?: string;
}

export interface QCRecord {
  id: string;
  model_id: string;
  stage: QCStageType;
  part_type?: GarmentPart;
  partType?: GarmentPart;
  color_name?: string;
  size?: string;
  pieces_cut?: number;
  cut_pieces_ref?: number;
  good_qty: number;
  defect_qty: number;
  defect_notes?: string;
  counted_pieces?: number;
  defect_pieces?: number;
  notes?: string;
  created_at: string;
  timestamp?: string;
  inspector_name?: string;
}

export type DispatchStatus = 'مرسل للمطبعة' | 'قيد التنفيذ' | 'تم الاستلام بالمصنع';

export interface PrintDispatch {
  id: string;
  model_id: string;
  shop_name: string;
  piece_type?: GarmentPart;
  piece_label?: string; // "تيشرت" / "بنطلون" / "جاكيت"
  print_location?: string; // مكان الطباعة: صدر / ظهر / كم / تطريز
  print_details?: string; // تفاصيل الطباعة الحرة
  dispatched_at: string;
  expected_delivery_date?: string;
  pieces_count: number;
  print_type: string;
  cost_per_piece?: number;
  total_cost?: number;
  notes?: string;
  status: DispatchStatus;
  received_at?: string;
}

export type SewingDispatchStatus = 'في ورشة المكن' | 'قيد الخياطة والتشغيل' | 'تم الاستلام';

export interface SewingDispatch {
  id: string;
  model_id: string;
  workshop_name: string;
  pieces_count: number;
  dispatched_at: string;
  expected_delivery_date: string;
  status: SewingDispatchStatus;
  piece_type?: GarmentPart;
  piece_label?: string; // "تيشرت" / "بنطلون" / "جاكيت"
  received_at?: string;
  notes?: string;
}

/**
 * منطقة قص مؤقتة لصورة الموديل (إحداثيات بالبيكسل داخل الصورة الأصلية).
 * تُستخدم للمعاينة والطباعة فقط ولا تُحفظ في قاعدة البيانات ولا تُعدّل الصورة الأصلية.
 */
export interface ImageCropRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  natW: number;
  natH: number;
}

/* ------------------------------------------------------------------ */
/* Assembly & Packaging (الأسمبلي والأمبالاج)                         */
/* ------------------------------------------------------------------ */

export type PackagingStepKey =
  | 'sent_to_photo'
  | 'received_from_photo'
  | 'sent_to_print_cards'
  | 'received_printed_cards';

export const PACKAGING_STEP_ORDER: PackagingStepKey[] = [
  'sent_to_photo',
  'received_from_photo',
  'sent_to_print_cards',
  'received_printed_cards'
];

export const PACKAGING_STEP_LABELS: Record<PackagingStepKey, string> = {
  sent_to_photo: 'إرسال عينة للتصوير',
  received_from_photo: 'استلام الصور من المصور',
  sent_to_print_cards: 'إرسال الصور للمطبعة',
  received_printed_cards: 'استلام الورق المطبوع من المطبعة'
};

export interface PackagingRequirement {
  id: string;
  model_id: string;
  model_code?: string;
  sent_to_photo_date?: string | null;
  received_from_photo_date?: string | null;
  sent_to_print_cards_date?: string | null;
  received_printed_cards_date?: string | null;
  steps?: Record<PackagingStepKey, string | null>;
  missing_steps: string[];
  is_complete: boolean;
  notes?: string;
  updated_at?: string;
}

export interface FinishingRecord {
  id: string;
  model_id: string;
  model_code?: string;
  part_type: GarmentPart;
  piece_label?: string;
  vendor_name?: string;
  entry_date?: string | null;
  expected_exit_date?: string | null;
  actual_exit_date?: string | null;
  status: 'في التشطيب' | 'تم الاستلام';
  is_received: boolean;
  is_overdue?: boolean;
  notes?: string;
  updated_at?: string;
}

export type AssemblyStageKey = 'ironing' | 'packaging' | 'dest';

export const ASSEMBLY_STAGE_ORDER: AssemblyStageKey[] = ['ironing', 'packaging', 'dest'];

export const ASSEMBLY_STAGE_LABELS: Record<AssemblyStageKey, string> = {
  ironing: 'قسم المكواة',
  packaging: 'قسم التعبئة والتغليف',
  dest: 'قسم الدَست'
};

// ---------------------------------------------------------------------------
// خامات التشغيل والأمبالاج (Packaging & Operating Materials MRP)
// خمس فئات ثابتة: أكياس البلاستيك / الكرتون / الشماعات / أكياس حديثي الولادة /
// أكياس الدست، ولكل فئة استهلاك لكل قطعة + مورد + حد تنبيه + رصيد.
// ---------------------------------------------------------------------------
export type PackagingMaterialKey = 'bags' | 'cartons' | 'hangers' | 'newborn_bags' | 'dozen_bags';

export const PACKAGING_MATERIAL_KEYS: PackagingMaterialKey[] = [
  'bags',
  'cartons',
  'hangers',
  'newborn_bags',
  'dozen_bags'
];

export const PACKAGING_MATERIAL_LABELS: Record<PackagingMaterialKey, string> = {
  bags: 'أكياس البلاستيك',
  cartons: 'الكرتون',
  hangers: 'الشماعات',
  newborn_bags: 'أكياس حديثي الولادة',
  dozen_bags: 'أكياس الدست'
};

export const PACKAGING_MATERIAL_EMOJI: Record<PackagingMaterialKey, string> = {
  bags: '🛍️',
  cartons: '📦',
  hangers: '🧷',
  newborn_bags: '👶',
  dozen_bags: '🎁'
};

export type PackagingMaterialUnit = 'قطعة' | 'كيلو' | 'دستة' | 'متر';

export const PACKAGING_MATERIAL_UNITS: PackagingMaterialUnit[] = ['قطعة', 'كيلو', 'دستة', 'متر'];

export type PackagingMaterialRuleMode = 'fixed' | 'variable';

export const PACKAGING_MATERIAL_RULE_MODE_LABELS: Record<PackagingMaterialRuleMode, string> = {
  fixed: 'ثابتة لكل المقاسات',
  variable: 'متغيرة حسب المقاس'
};

export type PackagingMaterialOperation = 'add' | 'deduct' | 'adjust';

export const PACKAGING_MATERIAL_OPERATION_LABELS: Record<PackagingMaterialOperation, string> = {
  add: 'وارد جديد',
  deduct: 'منصرف',
  adjust: 'تعديل الرصيد'
};

export interface PackagingMaterialTransaction {
  id: string;
  size_rule_id: string;
  operation: PackagingMaterialOperation;
  operation_label?: string;
  amount: number;
  notes?: string;
  timestamp?: string;
  created_at?: string;
}

export interface PackagingMaterialSizeRule {
  id: string;
  rule_id: string;
  rule_key?: PackagingMaterialKey;
  size_group_id: string;
  size_group_name: string;
  consumption_per_piece: number;
  dimensions_spec?: string;
  supplier_id?: string;
  supplier_name?: string;
  supplier_phone?: string;
  min_alert_threshold: number;
  current_stock: number;
  transactions?: PackagingMaterialTransaction[];
  updated_at?: string;
}

export interface PackagingMaterialRule {
  id: string;
  material_key: PackagingMaterialKey;
  name: string;
  unit: PackagingMaterialUnit;
  rule_mode: PackagingMaterialRuleMode;
  applicable_size_groups: string[];
  is_active: boolean;
  total_stock?: number;
  size_rules: PackagingMaterialSizeRule[];
  created_at?: string;
  updated_at?: string;
}

/** نتيجة حساب MRP لصف خامة/مقاس واحد. */
export interface PackagingMaterialDemand {
  sizeRuleId: string;
  totalPieces: number;
  modelCount: number;
  required: number;
  stock: number;
  shortage: number;
  consumptionPerPiece: number;
  belowMinThreshold: boolean;
  hasShortage: boolean;
}

// ---------------------------------------------------------------------------
// Independent per-part production stages.
// Each garment part (تيشرت / بنطلون / جاكيت) moves through these on its own;
// the model status is only a coarse label derived from the least advanced part.
// ---------------------------------------------------------------------------
export type PartStage =
  | 'cutting'
  | 'qc_before_print'
  | 'printing'
  | 'qc_after_print'
  | 'sewing'
  | 'qc_after_sewing'
  | 'finishing'
  | 'ironing'
  | 'packaging'
  | 'dest'
  | 'completed';

export const PART_STAGE_ORDER: PartStage[] = [
  'cutting',
  'qc_before_print',
  'printing',
  'qc_after_print',
  'sewing',
  'qc_after_sewing',
  'finishing',
  'ironing',
  'packaging',
  'dest',
  'completed'
];

export const PART_STAGE_LABELS: Record<PartStage, string> = {
  cutting: 'القص',
  qc_before_print: 'العد قبل الطباعة',
  printing: 'المطابع',
  qc_after_print: 'العد بعد الطباعة',
  sewing: 'المكن',
  qc_after_sewing: 'العد بعد المكن',
  finishing: 'التشطيب',
  ironing: 'المكواة',
  packaging: 'التعبئة والتغليف',
  dest: 'الدَست',
  completed: 'مخزن الإنتاج التام'
};

/** Stages at which a part counts as "arrived at packaging" for the lock rule. */
export const PACKAGING_READY_STAGES: PartStage[] = ['packaging', 'dest', 'completed'];

/** Visual badge per garment part (used on the independent part cards). */
export const PART_EMOJI: Record<GarmentPart, string> = {
  shirt: '👕',
  pants: '👖',
  jacket: '🧥',
  single: '🧵'
};

/** Coarse ModelStatus implied by each part stage (least advanced part wins). */
export const PART_STAGE_STATUS_MAP: Record<PartStage, ModelStatus> = {
  cutting: 'في القص',
  qc_before_print: 'العد قبل الطباعة',
  printing: 'جاهز للطباعة / التجميع',
  qc_after_print: 'العد بعد الطباعة',
  sewing: 'في قسم المكن',
  qc_after_sewing: 'العد بعد المكن',
  finishing: 'في التشطيب',
  ironing: 'في المكواة',
  packaging: 'في التعبئة والتغليف',
  dest: 'جاهز للدَست',
  completed: 'مخزن الإنتاج التام'
};

/** Legacy fallback: coarse status -> part stage (used when part_stages is empty). */
export const MODEL_STATUS_TO_PART_STAGE: Record<string, PartStage> = {
  'مرحلة التصميم': 'cutting',
  'تصميم': 'cutting',
  'في القص': 'cutting',
  'جاري القص': 'cutting',
  'العد قبل الطباعة': 'qc_before_print',
  'فرز قبل الطباعة': 'qc_before_print',
  'فرز وكنترول': 'qc_before_print',
  'جاهز للطباعة / التجميع': 'printing',
  'جاهز للمطبعة': 'printing',
  'مرسل للمطبعة': 'printing',
  'في المطبعة': 'printing',
  'العد بعد الطباعة': 'qc_after_print',
  'في قسم المكن': 'sewing',
  'العد بعد المكن': 'qc_after_sewing',
  'في التشطيب': 'finishing',
  'في المكواة': 'ironing',
  'في التعبئة والتغليف': 'packaging',
  'جاهز للدَست': 'dest',
  'مخزن الإنتاج التام': 'completed',
  'مكتمل الإنتاج': 'completed'
};

/** Derives the coarse model status from a {part: stage} map (slowest part wins). */
export const deriveStatusFromStages = (
  stages?: Partial<Record<GarmentPart, PartStage>>
): ModelStatus | undefined => {
  const values = (Object.values(stages || {}) as (PartStage | undefined)[]).filter(
    (stage): stage is PartStage => Boolean(stage)
  );
  if (!values.length) return undefined;
  const slowest = values.reduce((acc, stage) =>
    PART_STAGE_ORDER.indexOf(stage) < PART_STAGE_ORDER.indexOf(acc) ? stage : acc
  );
  return PART_STAGE_STATUS_MAP[slowest];
};

export interface PartStageInfo {
  stage: PartStage;
  stage_label?: string;
  ready_for_packaging?: boolean;
}

export interface PartStageItem {
  part: GarmentPart;
  label: string;
  stage: PartStage;
  stage_label?: string;
}

export interface PackagingReadiness {
  all_ready: boolean;
  has_arrived?: boolean;
  ready_parts: PartStageItem[];
  waiting_parts: PartStageItem[];
  parts?: Record<string, PartStageInfo>;
}

export interface AssemblyStageRecord {
  id: string;
  model_id: string;
  model_code?: string;
  stage: AssemblyStageKey;
  stage_label?: string;
  part_type?: GarmentPart | '';
  part_label?: string;
  vendor_name?: string;
  entry_date?: string | null;
  expected_exit_date?: string | null;
  actual_exit_date?: string | null;
  status: 'جارية الآن' | 'مكتملة';
  is_completed: boolean;
  is_overdue?: boolean;
  notes?: string;
  updated_at?: string;
}

export interface InternalMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  receiver_id: string;
  receiver_name: string;
  content: string;
  created_at: string;
  is_read: boolean;
}

export type NotificationUrgency = 'tomorrow' | 'today' | 'overdue' | 'critical';
export type NotificationStage =
  | 'printing'
  | 'sewing'
  | 'finishing'
  | 'ironing'
  | 'packaging'
  | 'dest'
  | 'materials';

export interface AppNotification {
  id: string;
  model_id: string;
  model_code: string;
  stage: NotificationStage;
  source_name: string;
  expected_date: string;
  urgency: NotificationUrgency;
  days_diff: number;
  title: string;
  message: string;
  is_read?: boolean;
  created_at: string;
  /** يميز تنبيهات خامات التشغيل عن تنبيهات مواعيد الاستلام. */
  kind?: 'delivery' | 'material';
  /** رابط داخلي للانتقال إلى شاشة خامات التشغيل عند الضغط على التنبيه. */
  link_tab?: string;
}

export type AccessoryUnit = 'قطعة' | 'دستة' | 'متر' | 'باكو' | 'كيس';
export type AccessoryUsageType = 'stock' | 'custom_model';

export interface AccessoryType {
  id: string;
  name: string;
  icon?: string;
  description?: string;
}

export interface AccessoryItem {
  id: string;
  type_id: string;
  type_name: string;
  code: string;
  name: string;
  image: string;
  unit: AccessoryUnit;
  quantity: number;
  reserved_quantity: number;
  price_per_unit: number;
  supplier_id?: string;
  min_threshold: number;
  created_at?: string;

  // Advanced Usage & Deficit tracking
  usage_type: AccessoryUsageType;
  custom_model_code?: string;
  target_quantity?: number;
  delivered_quantity?: number;
  withdrawn_for_model?: boolean;
}

export interface AccessoryTransaction {
  id: string;
  accessory_id: string;
  accessory_code: string;
  accessory_name: string;
  operation: 'add' | 'deduct';
  amount: number;
  model_code_ref?: string;
  notes?: string;
  timestamp: string;
}

// ==========================================================================
// HR (الموارد البشرية)
// ==========================================================================

export type HRDepartmentKey =
  | 'design'
  | 'cutting'
  | 'fabric_warehouse'
  | 'accessories_warehouse'
  | 'sorting_control'
  | 'sewing'
  | 'finishing'
  | 'ironing'
  | 'packaging'
  | 'dest'
  | 'finished_goods';

export interface HRDepartmentOption {
  key: HRDepartmentKey;
  label: string;
}

export const HR_DEPARTMENT_LABELS: Record<HRDepartmentKey, string> = {
  design: 'التصميم',
  cutting: 'القص',
  fabric_warehouse: 'مخزن القماش',
  accessories_warehouse: 'مخزن الإكسسوارات',
  sorting_control: 'الفرز والكنترول',
  sewing: 'المكن والخياطة',
  finishing: 'التشطيب',
  ironing: 'المكواة',
  packaging: 'التعبئة والتغليف',
  dest: 'الدَست',
  finished_goods: 'مخزن الإنتاج التام'
};

export const HR_DEPARTMENTS: HRDepartmentOption[] = (
  Object.keys(HR_DEPARTMENT_LABELS) as HRDepartmentKey[]
).map((key) => ({ key, label: HR_DEPARTMENT_LABELS[key] }));

export type HRWeekDayKey =
  | 'Saturday'
  | 'Sunday'
  | 'Monday'
  | 'Tuesday'
  | 'Wednesday'
  | 'Thursday'
  | 'Friday';

export interface HRWeekDayOption {
  key: HRWeekDayKey;
  label: string;
}

export const HR_WEEK_DAYS: HRWeekDayOption[] = [
  { key: 'Saturday', label: 'السبت' },
  { key: 'Sunday', label: 'الأحد' },
  { key: 'Monday', label: 'الإثنين' },
  { key: 'Tuesday', label: 'الثلاثاء' },
  { key: 'Wednesday', label: 'الأربعاء' },
  { key: 'Thursday', label: 'الخميس' },
  { key: 'Friday', label: 'الجمعة' }
];

/** طريقة تطبيق قواعد التأخير/الخصم على الموظف. */
export type HRRuleApplicationMode = 'auto' | 'manual_review';

/** نوع المخالفة التي تعالجها القاعدة. */
export type HRRuleViolationType = 'late_arrival' | 'early_departure' | 'absence';

/** وحدة الخصم المترتب على المخالفة. */
export type HRRuleDeductionType = 'hours' | 'days';

/** طريقة تطبيق القاعدة: تلقائي أو مراجعة يدوية أولاً في الحضور والانصراف. */
export type HRRuleApplyMode = 'auto' | 'manual_review';

export interface HRAttendanceRule {
  id: string;
  violation_type: HRRuleViolationType;
  label?: string;
  from_minutes?: number;
  to_minutes?: number;
  until_time?: string;
  deduction_type: HRRuleDeductionType;
  deduction_value: number;
  apply_mode: HRRuleApplyMode;
}

/** نوع مكافأة العمل الإضافي: أيام أو ساعات. */
export type HROvertimeRewardType = 'hours' | 'days';

/** قاعدة/شريحة عمل إضافي مربوطة بوقت الانصراف. */
export interface HROvertimeRule {
  id: string;
  label?: string;
  from_time: string;
  to_time: string;
  reward_type: HROvertimeRewardType;
  reward_value: number;
}

export interface HRJobTitle {
  id: string;
  title: string;
  department: HRDepartmentKey;
  department_label?: string;
  employees_count?: number;
  created_at?: string;
}

export interface HREmployee {
  id: string;
  employee_code: string;
  name: string;
  job_id: string;
  job_title?: string;
  department?: HRDepartmentKey;
  department_label?: string;
  monthly_salary: number;
  rule_application_mode: HRRuleApplicationMode;
  rule_application_mode_label?: string;
  national_id?: string;
  birth_date?: string | null;
  phone?: string;
  photo?: string;
  notes?: string;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
  /** الرتبة الهرمية للموظف. */
  rank_level?: number;
  rank_label?: string;
}

export interface HRAttendanceSettings {
  id?: string;
  official_start_time: string;
  official_end_time: string;
  weekly_off_day: HRWeekDayKey;
  weekly_off_day_label?: string;
  /** عدد أيام الشهر الحسابية ثابت دائماً = 30 يوماً. */
  month_calculation_days: number;
  rules_json: HRAttendanceRule[];
  overtime_rules: HROvertimeRule[];
  updated_at?: string;
}

export type HRAttendanceStatus = 'present' | 'absent' | 'leave' | 'missing_punch';

export type HRReviewStatus = 'auto_applied' | 'pending_review' | 'approved' | 'rejected';

export interface HRAttendanceRecord {
  id: string;
  employee_id: string;
  employee_code?: string;
  employee_name?: string;
  department?: HRDepartmentKey;
  date: string;
  check_in?: string;
  check_out?: string;
  status: HRAttendanceStatus;
  status_label?: string;
  is_excused: boolean;
  excuse_note?: string;
  calculated_deduction_days: number;
  calculated_deduction_hours: number;
  overtime_days?: number;
  overtime_hours?: number;
  sunday_deduction_days?: number;
  sunday_deduction_note?: string;
  review_status: HRReviewStatus;
  review_status_label?: string;
  updated_at?: string;
}

export type HRPenaltyType = 'days' | 'hours';

/** إحصاءات أعلى شاشة سجل الحضور والانصراف (تُحسب على السيرفر). */
export interface HRAttendanceStats {
  month: string;
  month_start: string;
  month_end: string;
  workdays: number;
  total_employees: number;
  total_records: number;
  present: number;
  absent: number;
  leave: number;
  missing_punch: number;
  excused: number;
  pending_review: number;
  late_records: number;
  compliance_percent: number;
  average_daily_absence: number;
  deduction_days: number;
  deduction_hours: number;
  worst_department: {
    department: string;
    label: string;
    total: number;
    absent: number;
    rate: number;
  } | null;
}

/** نتيجة رفع شيت البصمة واحتساب التأخير والغياب. */
export interface HRAttendanceImportResult {
  month: string;
  filename: string;
  imported: number;
  updated: number;
  processed: number;
  skipped: number;
  total_rows: number;
  pending_review: number;
  error_count: number;
  errors: { row: number; message: string }[];
}


export interface HRPenalty {
  id: string;
  employee_id: string;
  employee_code?: string;
  employee_name?: string;
  date: string;
  penalty_type: HRPenaltyType;
  penalty_type_label?: string;
  value: number;
  reason?: string;
  created_at?: string;
}

export interface HRLoan {
  id: string;
  employee_id: string;
  employee_code?: string;
  employee_name?: string;
  date: string;
  amount: number;
  notes?: string;
  created_at?: string;
}