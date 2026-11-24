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

/** التبويبات المستقلة لقسم الموارد البشرية. */
export type HRSectionKey =
  | 'jobs'
  | 'employees'
  | 'attendance'
  | 'rules'
  | 'loans'
  | 'penalties'
  | 'payroll'
  | 'reports';

export const HR_SECTION_KEYS: HRSectionKey[] = [
  'jobs',
  'employees',
  'attendance',
  'rules',
  'loans',
  'penalties',
  'payroll',
  'reports'
];

/** ربط كل تبويب HR بمفتاح الصلاحية الخاص به. */
export const HR_SECTION_PERM_MAP: Record<HRSectionKey, string> = {
  jobs: 'hr_jobs',
  employees: 'hr_employees',
  attendance: 'hr_attendance',
  rules: 'hr_rules',
  loans: 'hr_loans',
  penalties: 'hr_penalties',
  payroll: 'hr_payroll',
  reports: 'hr_reports'
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

  // Fine-grained financial permissions (صلاحية مستقلة لكل قسم)
  view_fabric_prices: boolean;
  edit_fabric_prices: boolean;
  view_accessory_prices: boolean;
  edit_accessory_prices: boolean;
  view_printing_prices: boolean;
  edit_printing_prices: boolean;
  view_sewing_prices: boolean;
  edit_sewing_prices: boolean;
  view_assembly_prices: boolean;
  edit_assembly_prices: boolean;

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
  hr_reports?: boolean;

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
  /** تارجتات أقسام الإنتاج (يومي / شهري): { cutting: { daily, monthly }, ... } */
  department_targets?: DepartmentTargetsMap;
  updated_by?: string;
  updated_at?: string;
}

export interface CustomRole {
  id: string;
  name: string;
  description: string;
  permissions: RolePermissions;
  /** الصلاحيات التي يحق لحاملي هذا الدور منحها/تفويضها للغير. */
  delegatable_permissions?: string[];
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
  view_printing_prices?: boolean;
  edit_printing_prices?: boolean;
  view_sewing_prices?: boolean;
  edit_sewing_prices?: boolean;
  view_assembly_prices?: boolean;
  edit_assembly_prices?: boolean;
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
  /** الصلاحيات التي يحق لهذا المستخدم منحها/تفويضها لغيره. */
  delegatable_permissions?: string[];
  /** معرّف واسم المدير الذي أنشأ هذا الحساب. */
  created_by?: string | null;
  created_by_name?: string;
  is_active: boolean;
  last_active?: string;
  last_seen?: string;
  /** الرتبة الهرمية للمستخدم (0 محصورة في sudo). */
  rank_level?: number;
  rank_label?: string;
}

export interface AuditLogChange {
  field: string;
  label: string;
  old: string;
  new: string;
}

export interface AuditLog {
  id: string;
  userId?: string;
  userName: string;
  userFullName?: string;
  section?: string;
  actionType?: string;
  action: string;
  targetName?: string;
  details: string;
  changes?: AuditLogChange[];
  ip_address: string;
  timestamp: string;
}

export interface AuditLogFilters {
  search?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  hourFrom?: string;
  hourTo?: string;
  user?: string;
  section?: string;
  actionType?: string;
  ipAddress?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditLogFilterUser {
  id: string;
  name: string;
  username?: string;
}

export interface AuditLogFilterActionType {
  key: string;
  label: string;
}

export interface AuditLogFiltersMeta {
  users: AuditLogFilterUser[];
  sections: string[];
  actionTypes: AuditLogFilterActionType[];
  ipAddresses: string[];
}

export interface AuditLogListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: AuditLog[];
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
  whatsapp_group_link?: string;
}

export type WorkshopType = 'printing' | 'embroidery' | 'sewing' | 'finishing' | 'ironing' | 'packaging';

export const WORKSHOP_TYPE_KEYS: WorkshopType[] = [
  'printing',
  'embroidery',
  'sewing',
  'finishing',
  'ironing',
  'packaging'
];

export const WORKSHOP_TYPE_LABELS: Record<WorkshopType, string> = {
  printing: 'مطبعة',
  embroidery: 'تطريز',
  sewing: 'ورشة مكن / خياطة',
  finishing: 'ورشة تشطيب',
  ironing: 'ورشة مكواة',
  packaging: 'ورشة تعبئة وتغليف'
};

export interface Workshop {
  id: string;
  name: string;
  phone: string;
  whatsapp_group_link?: string;
  workshop_type: WorkshopType[];
  workshop_type_labels?: string[];
  notes?: string;
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
  // يُعاد null لمن لا يملك صلاحية عرض أسعار الأقمشة.
  price_per_unit: number | null;
  quantity: number;
  reserved_quantity: number;
}

export interface FabricTransaction {
  id: string;
  color_id: string;
  fabric_id: string;
  model_code_ref?: string;
  notes?: string;
  /** defect = عيوب قماش مسجلة أثناء قص/إرجاع الفائض (لا تُضاف للرصيد). */
  operation: 'add' | 'deduct' | 'defect';
  amount: number;
  timestamp: string;
  /** سعر الوحدة التاريخي وقت الحركة — يُعاد null لمن لا يملك صلاحية عرض أسعار الخامات. */
  unit_price_snapshot?: number | null;
  /** المورد المرتبط بالحركة (اختياري، للتوافق مع السجلات القديمة). */
  supplier_id?: string | null;
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
  /** الأطقم التامة الفعلية بعد خصم قطع عينة التصوير المحتجزة. */
  finished_good_sets?: number;
  /** عدد قطع عينة التصوير المرسلة ولم تُسترجع بعد (مخصومة مؤقتاً). */
  photography_outstanding_qty?: number;
  cut_shirt_pieces?: number;
  cut_pants_pieces?: number;
  cut_jacket_pieces?: number;
  qc_shirt_pieces?: number;
  qc_pants_pieces?: number;
  qc_jacket_pieces?: number;
  print_house_name?: string;
  print_house?: string;
  print_cost?: number | null;
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
  notes_jacket?: string;

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
  /** سعر الوحدة التاريخي — يُعاد null لمن لا يملك صلاحية عرض أسعار الخامات. */
  unit_price_snapshot?: number | null;
}

export interface ModelAccessory {
  id: string;
  model_id: string;
  target_type: 'shirt' | 'pants' | 'jacket' | 'single';
  piece_consumption: number;
  planned_quantity: number;
  accessory_id?: string;
  accessory_code?: string;
  accessory_name: string;
  unit?: string;
  image?: string;
  /** سعر الوحدة التاريخي — يُعاد null لمن لا يملك صلاحية عرض أسعار الإكسسوارات. */
  unit_price_snapshot?: number | null;
  /** حالة الصرف الفعلي من مخزن الإكسسوارات (يبقى محجوزاً حتى is_issued = true). */
  is_issued?: boolean;
  issued_quantity?: number;
  issued_to?: string;
  issued_at?: string;
  issued_by?: string;
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
  is_sub_cut?: boolean;
  isSubCut?: boolean;
  sub_cut_label?: string;
  subCutLabel?: string;
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

/** سجل دفعة استلام واحدة (الاستلام الجزئي على دفعات). */
export interface ReceiveHistoryEntry {
  date: string;
  qty: number;
  total_received: number;
  user?: string;
  notes?: string;
}

export type DispatchStatus =
  | 'مرسل للمطبعة'
  | 'قيد التنفيذ'
  | 'استلام جزئي'
  | 'تم الاستلام بالمصنع';

export interface PrintDispatch {
  id: string;
  model_id: string;
  shop_name: string;
  /** معرف الورشة المسجلة المرتبطة (اختياري — يظل الاسم النصي هو المصدر الأساسي). */
  workshop_id?: string;
  piece_type?: GarmentPart;
  piece_label?: string; // "تيشرت" / "بنطلون" / "جاكيت"
  print_location?: string; // مكان الطباعة: صدر / ظهر / كم / تطريز
  print_details?: string; // تفاصيل الطباعة الحرة
  dispatched_at: string;
  expected_delivery_date?: string;
  pieces_count: number;
  /** إجمالي القطع المستلمة فعلياً (الاستلام الجزئي على دفعات). */
  received_pieces?: number;
  /** المتبقي في الورشة = pieces_count - received_pieces. */
  remaining_pieces?: number;
  /** سجل كل دفعة استلام. */
  receive_history?: ReceiveHistoryEntry[];
  print_type: string;
  cost_per_piece?: number | null;
  total_cost?: number | null;
  notes?: string;
  status: DispatchStatus;
  received_at?: string;
}

export type SewingDispatchStatus =
  | 'في ورشة المكن'
  | 'قيد الخياطة والتشغيل'
  | 'استلام جزئي'
  | 'تم الاستلام';

export interface SewingDispatch {
  id: string;
  model_id: string;
  workshop_name: string;
  /** معرف الورشة المسجلة المرتبطة (اختياري — يظل الاسم النصي هو المصدر الأساسي). */
  workshop_id?: string;
  pieces_count: number;
  /** إجمالي القطع المستلمة فعلياً (الاستلام الجزئي على دفعات). */
  received_pieces?: number;
  /** المتبقي في الورشة = pieces_count - received_pieces. */
  remaining_pieces?: number;
  /** سجل كل دفعة استلام. */
  receive_history?: ReceiveHistoryEntry[];
  dispatched_at: string;
  expected_delivery_date: string;
  status: SewingDispatchStatus;
  piece_type?: GarmentPart;
  piece_label?: string; // "تيشرت" / "بنطلون" / "جاكيت"
  received_at?: string;
  notes?: string;
  /** يُعاد null لمن لا يملك صلاحية عرض أسعار المكن. */
  cost_per_piece?: number | null;
  total_cost?: number | null;
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
  /** عدد قطع العينة المرسلة للتصوير (خصم مؤقت من الإنتاج). */
  photography_sent_qty?: number;
  /** عدد قطع العينة المستلمة من التصوير. */
  photography_received_qty?: number;
  /** القطع التي ما زالت في التصوير (مرسلة - مستلمة). */
  photography_outstanding_qty?: number;
  /** عجز في قطع العينة (يُحتسب بعد استلام الصور إن لم تُرجع كل القطع). */
  photography_shortage?: number;
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
  /** معرف الورشة المسجلة المرتبطة (اختياري — يظل الاسم النصي هو المصدر الأساسي). */
  workshop_id?: string;
  entry_date?: string | null;
  expected_exit_date?: string | null;
  actual_exit_date?: string | null;
  status: 'في التشطيب' | 'تم الاستلام';
  is_received: boolean;
  is_overdue?: boolean;
  notes?: string;
  /** تُعاد null لمن لا يملك صلاحية عرض أسعار الأسمبلي/التشطيب. */
  cost_per_piece?: number | null;
  total_cost?: number | null;
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
// فئات ديناميكية: يمكن إضافة أي فئة جديدة أو حذفها من الواجهة.
// الفئات الخمس التالية هي الافتراضية التي تُزرع تلقائياً كبيانات أولية فقط.
// ---------------------------------------------------------------------------
export type PackagingMaterialKey = string;

export const DEFAULT_PACKAGING_MATERIAL_KEYS: PackagingMaterialKey[] = [
  'bags',
  'cartons',
  'hangers',
  'newborn_bags',
  'dozen_bags'
];

/** الفئات الافتراضية (متوافق مع الكود القديم - استخدم packagingMaterialRules بدلاً منه). */
export const PACKAGING_MATERIAL_KEYS: PackagingMaterialKey[] = DEFAULT_PACKAGING_MATERIAL_KEYS;

export const PACKAGING_MATERIAL_LABELS: Record<string, string> = {
  bags: 'أكياس البلاستيك',
  cartons: 'الكرتون',
  hangers: 'الشماعات',
  newborn_bags: 'أكياس حديثي الولادة',
  dozen_bags: 'أكياس الدست'
};

export const PACKAGING_MATERIAL_EMOJI: Record<string, string> = {
  bags: '🛍️',
  cartons: '📦',
  hangers: '🧷',
  newborn_bags: '👶',
  dozen_bags: '🎁'
};

/** أيقونة افتراضية لأي فئة جديدة لا تملك أيقونة محددة. */
export const PACKAGING_MATERIAL_FALLBACK_ICON = '📦';

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
  /** يُعاد null لمن لا يملك صلاحية عرض أسعار خامات التشغيل. */
  price_per_unit?: number | null;
  total_cost?: number | null;
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
  /** يُعاد null لمن لا يملك صلاحية عرض أسعار خامات التشغيل. */
  price_per_unit?: number | null;
  total_stock_value?: number | null;
  transactions?: PackagingMaterialTransaction[];
  updated_at?: string;
}

export interface PackagingMaterialRule {
  id: string;
  material_key: PackagingMaterialKey;
  name: string;
  /** أيقونة/إيموجي الفئة (اختياري للفئات القديمة). */
  icon?: string;
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
  /** معرف الورشة المسجلة المرتبطة (اختياري — يظل الاسم النصي هو المصدر الأساسي). */
  workshop_id?: string;
  entry_date?: string | null;
  expected_exit_date?: string | null;
  actual_exit_date?: string | null;
  status: 'جارية الآن' | 'مكتملة';
  is_completed: boolean;
  is_overdue?: boolean;
  notes?: string;
  /** تُعاد null لمن لا يملك صلاحية عرض أسعار الأسمبلي. */
  cost_per_piece?: number | null;
  total_cost?: number | null;
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
  /** مفتاح الصلاحية المطلوبة لرؤية هذا التنبيه (بدونها لا يظهر للمستخدم). */
  permission_key?: string;
  /** موعد انتهاء تأجيل (إخفاء) التنبيه — يبقى مخفياً حتى هذا التوقيت. */
  snoozed_until?: string | null;
}

/** مدة تأجيل التنبيه بالساعات (Quick Snooze). */
export type SnoozeHours = 1 | 2 | 24 | 48;

export const SNOOZE_OPTIONS: { hours: SnoozeHours; label: string }[] = [
  { hours: 1, label: 'ساعة' },
  { hours: 2, label: 'ساعتين' },
  { hours: 24, label: 'يوم' },
  { hours: 48, label: 'يومين' }
];

/** مفتاح localStorage لحفظ التنبيهات المؤجلة. */
export const SNOOZED_NOTIFICATIONS_STORAGE_KEY = 'erp_snoozed_notifications';

export type AccessoryUnit = 'قطعة' | 'دستة' | 'متر' | 'باكو' | 'كيس' | 'كيلو' | 'بكرة';
export type AccessoryUsageType = 'stock' | 'custom_model' | 'carryover';

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
  // يُعاد null لمن لا يملك صلاحية عرض أسعار الإكسسوارات.
  price_per_unit: number | null;
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
  /** سعر الوحدة التاريخي وقت الحركة — يُعاد null لمن لا يملك صلاحية عرض أسعار الإكسسوارات. */
  unit_price_snapshot?: number | null;
  /** المورد المرتبط بالحركة (اختياري، للتوافق مع السجلات القديمة). */
  supplier_id?: string | null;
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
  | 'administration'
  | 'crow'
  | 'accounting';

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
  administration: 'الإداريين',
  crow: 'العمال (Crew)',
  accounting: 'المحاسبين (Accounting)'
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
  // يُعاد null لمن لا يملك صلاحية الرواتب.
  monthly_salary: number | null;
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
  late_minutes?: number;
  early_minutes?: number;
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

// ---------------------------------------------------------------------------
// تقارير وتحليلات الموارد البشرية — شكل استجابة /api/hr-reports/
// ---------------------------------------------------------------------------
export interface HRReportLoanItem {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  department: string;
  department_label: string;
  amount: number;
  notes: string;
}

export interface HRReportLoanDay {
  date: string;
  total: number;
  count: number;
  items: HRReportLoanItem[];
}

export interface HRReportLoansSummary {
  week_total: number;
  week_count: number;
  week_from: string;
  week_to: string;
  month_total: number;
  month_count: number;
  month_key: string;
  top_day: { date: string; total: number; count: number } | null;
}

export interface HRReportAnnualKpis {
  net_salary_total: number;
  loans_total: number;
  overtime_bonus_total: number;
  deductions_total: number;
  avg_monthly_labor_cost: number;
  active_workers: number;
}

export interface HRReportMonthRow {
  month: string;
  label: string;
  active_workers: number;
  earned_salary: number;
  overtime_bonus: number;
  loans: number;
  deductions: number;
  net_paid: number;
}

export interface HRReportDepartmentRow {
  department: string;
  label: string;
  workers: number;
  earned: number;
  overtime: number;
  loans: number;
  deductions: number;
  net: number;
  percent: number;
}

export interface HRReportComparisonRow {
  month: string;
  label: string;
  net: number;
  loans: number;
  deductions: number;
  overtime: number;
  net_change_pct: number | null;
}

export interface HRReportDisciplineEmployee {
  employee_id: string;
  employee_code: string;
  name: string;
  department: string;
  department_label: string;
  present_days: number;
  absent_days: number;
  late_minutes: number;
}

export interface HRReportDiscipline {
  most_committed: HRReportDisciplineEmployee[];
  most_absent: HRReportDisciplineEmployee[];
  worst_department: {
    department: string;
    label: string;
    absent_count: number;
    late_minutes: number;
  } | null;
}

export interface HRReportsPayload {
  available_years: number[];
  year: number;
  active_workers: number;
  range_from: string;
  range_to: string;
  loans_by_day: Record<string, HRReportLoanDay>;
  loans_summary: HRReportLoansSummary;
  annual: {
    kpis: HRReportAnnualKpis;
    months: HRReportMonthRow[];
    monthly_departments: Record<string, HRReportDepartmentRow[]>;
  };
  range: {
    from: string;
    to: string;
    comparison: HRReportComparisonRow[];
    department_breakdown: HRReportDepartmentRow[];
    discipline: HRReportDiscipline;
  };
}

/* ------------------------------------------------------------------ */
/* Reports & Statistics v2 — التقارير والإحصائيات                      */
/* ------------------------------------------------------------------ */

/** تارجت قسم: عدد القطع اليومي والشهري. */
export interface DepartmentTarget {
  daily: number;
  monthly: number;
}

export type DepartmentTargetsMap = Record<string, DepartmentTarget>;

/** صف فئة مقاس في تبويب "الموديلات حسب المقاس". */
export interface SizeCategoryReportRow {
  size_id: string;
  size_name: string;
  size_values: string;
  boys_models: number;
  girls_models: number;
  boys_pieces: number;
  girls_pieces: number;
  boys_value: number;
  girls_value: number;
  total_models: number;
  total_pieces: number;
}

export interface ReportBreakdownItem {
  key: string;
  label: string;
  models_count: number;
  pieces_count: number;
}

export interface ReportStageItem {
  key: string;
  label: string;
  models_count: number;
}

/** موديل خفيف داخل قائمة تفاصيل الموديلات المطابقة للفلاتر. */
export interface FilteredModelItem {
  model_id: number;
  client_id: string;
  model_code: string;
  model_type: string;
  gender: 'boys' | 'girls';
  image: string;
  size_category: string;
  garment_composition: string;
  composition_label: string;
  stage: string;
  stage_label: string;
  cut_pieces: number;
}

export interface ModelsReportResponse {
  metric: 'models' | 'pieces';
  date_from: string;
  date_to: string;
  composition_filter: string;
  model_type_filter: string;
  stage_filter: string;
  active_stage: string;
  size_categories: SizeCategoryReportRow[];
  composition_breakdown: ReportBreakdownItem[];
  stage_breakdown: ReportStageItem[];
  model_types: string[];
  filtered_models: FilteredModelItem[];
  totals: {
    models: number;
    boys_models: number;
    girls_models: number;
    pieces: number;
    boys_pieces: number;
    girls_pieces: number;
    size_categories: number;
  };
  generated_at: string;
}

/** نقطة يومية في سلسلة قسم (تبويب الإنتاج والسرعة). */
export interface DepartmentDailyPoint {
  date: string;
  label: string;
  pieces: number;
  target: number;
}

export interface DepartmentReportCard {
  key: string;
  label: string;
  icon: string;
  color: string;
  models_count: number;
  pieces_count: number;
  avg_daily: number;
  target: number;
  target_daily: number;
  target_monthly: number;
  progress_percent: number;
  previous_pieces: number;
  delta: number;
  delta_percent: number;
  daily_series: DepartmentDailyPoint[];
}

export interface ProductionDepartmentsResponse {
  period: string;
  period_label: string;
  date_from: string;
  date_to: string;
  days: number;
  departments: DepartmentReportCard[];
  targets: DepartmentTargetsMap;
  generated_at: string;
}

/** صف موديل في تبويب "المشاكل والعجز". */
export interface ShortageReportRow {
  model_id: number;
  client_id: string;
  model_code: string;
  model_type: string;
  image: string;
  status: string;
  stage: string;
  stage_label: string;
  garment_composition: string;
  composition_label: string;
  cut_pieces: number;
  current_pieces: number;
  shortage: number;
  shortage_percent: number;
}

export interface DefectStageRow {
  stage: string;
  label: string;
  defects: number;
  counted: number;
}

export interface QualityShortageResponse {
  summary: {
    models_count: number;
    total_cut_pieces: number;
    total_current_pieces: number;
    total_shortage: number;
    total_shortage_percent: number;
    total_defects: number;
    worst_stage: DefectStageRow;
  };
  defects_by_stage: DefectStageRow[];
  models: ShortageReportRow[];
  sort: string;
  search: string;
  generated_at: string;
}

/** مرحلة داخل تفصيل الموديل (Waterfall): مدخل → مخرج → فقد. */
export interface ModelWaterfallStage {
  key: string;
  label: string;
  in_qty: number;
  out_qty: number;
  loss: number;
}

export interface ModelWaterfallPart {
  part: string;
  label: string;
  cut_pieces: number;
  good_pieces: number;
  printed_pieces: number;
  sewn_pieces: number;
  shortage: number;
  stages: ModelWaterfallStage[];
}

export interface ModelAssemblyStage {
  key: string;
  label: string;
  in_qty: number;
  out_qty: number;
  loss: number;
  status: 'completed' | 'in_progress' | 'not_started';
  status_label: string;
  records_count: number;
  completed_count: number;
}

export interface ModelStageWaterfallResponse {
  model: {
    id: number;
    model_code: string;
    model_type: string;
    image: string;
    status: string;
    stage: string;
    stage_label: string;
    garment_composition: string;
    composition_label: string;
    target_cut_quantity: number;
    total_cut_pieces: number;
    count_after_sewing: number;
  };
  parts: ModelWaterfallPart[];
  model_stages: ModelAssemblyStage[];
  summary: {
    cut_total: number;
    good_total: number;
    shortage_total: number;
    shortage_percent: number;
  };
  generated_at: string;
}

export interface DepartmentTargetsResponse {
  targets: DepartmentTargetsMap;
  can_edit: boolean;
}