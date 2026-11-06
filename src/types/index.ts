export type SystemSectionKey =
  | 'fabric_warehouse'
  | 'accessories_warehouse'
  | 'production_warehouse'
  | 'design'
  | 'cutting'
  | 'qc'
  | 'printing'
  | 'sewing'
  | 'models_tracking'
  | 'reports';

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
  count_before_print?: number;
  count_after_print?: number;
  count_after_sewing?: number;
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

export interface CuttingRecord {
  id: string;
  model_id: string;
  color_name?: string;
  colorName?: string;
  color_code?: string;
  fabric_name?: string;
  part?: 'shirt' | 'pants' | string;
  cutter_name?: string;
  cutterName?: string;
  recorded_by?: string;
  layers_count: number;
  layersCount?: number;
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

export interface QCRecord {
  id: string;
  model_id: string;
  stage: QCStageType;
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
  piece_type?: 'shirt' | 'pants';
  piece_label?: string; // "تيشرت" or "بنطلون"
  received_at?: string;
  notes?: string;
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

export type NotificationUrgency = 'tomorrow' | 'today' | 'overdue';
export type NotificationStage = 'printing' | 'sewing';

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
