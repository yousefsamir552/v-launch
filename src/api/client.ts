const getBaseUrl = (): string => {
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (envUrl) {
    return envUrl.replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.startsWith('192.168.') ||
      host.startsWith('10.')
    ) {
      return `http://${host}:8000/api`;
    }
  }
  return 'https://erb-v-4-new.onrender.com/api';
};

export const BASE_URL = getBaseUrl();

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('factory_erp_auth_token') || '';
  const currentUserRaw = localStorage.getItem('factory_erp_current_user');
  let parsedUser: any = null;
  try {
    parsedUser = currentUserRaw ? JSON.parse(currentUserRaw) : null;
  } catch {
    parsedUser = null;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}`, 'X-Auth-Token': token } : {}),
    ...(parsedUser?.username ? { 'X-User-Username': parsedUser.username } : {}),
    ...((options.headers as Record<string, string>) || {})
  };

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || errData.error || errData.message || `خطأ في الاتصال بالسيرفر (${res.status})`);
  }

  if (res.status === 204) {
    return {} as T;
  }

  return await res.json();
}

function buildAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = localStorage.getItem('factory_erp_auth_token') || '';
  const currentUserRaw = localStorage.getItem('factory_erp_current_user');
  let parsedUser: any = null;
  try {
    parsedUser = currentUserRaw ? JSON.parse(currentUserRaw) : null;
  } catch {
    parsedUser = null;
  }
  return {
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}`, 'X-Auth-Token': token } : {}),
    ...(parsedUser?.username ? { 'X-User-Username': parsedUser.username } : {}),
    ...extra
  };
}

async function readErrorMessage(res: Response): Promise<string> {
  const errData = await res.json().catch(() => ({} as any));
  return (
    errData?.detail ||
    errData?.error ||
    errData?.message ||
    `خطأ في الاتصال بالسيرفر (${res.status})`
  );
}

/** تنزيل ملف (Blob) من السيرفر بنفس ترويسات المصادقة. */
async function requestBlob(endpoint: string): Promise<Blob> {
  const res = await fetch(`${BASE_URL}${endpoint}`, { headers: buildAuthHeaders() });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  return await res.blob();
}

/** رفع ملف بصيغة multipart/form-data (بدون تعيين Content-Type يدوياً). */
async function requestForm<T>(endpoint: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: buildAuthHeaders(),
    body: form
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  if (res.status === 204) {
    return {} as T;
  }
  return (await res.json()) as T;
}

export const api = {
  // المصادقة والجلسات (Authentication)
  login: (username: string, password: string) =>
    request<{ token: string; user: any }>('/auth/login/', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    }),
  getMe: () => request<{ user: any }>('/auth/me/'),
  heartbeat: () => request<{ onlineUsers: any[] }>('/auth/heartbeat/'),
  logout: () => request<{ status: string }>('/auth/logout/', { method: 'POST' }),

  // جلب الحالة الكاملة للنظام من قاعدة البيانات المركزية
  getState: () => request<any>('/state/'),

  // الإعدادات العامة للموقع (Global Settings)
  getGlobalSettings: () => request<any>('/global-settings/'),
  updateGlobalSettings: (data: any) =>
    request<any>('/global-settings/update_settings/', {
      method: 'POST',
      body: JSON.stringify(data)
    }),

  // الأدوار والصلاحيات (Roles)
  getRoles: () => request<any[]>('/roles/'),
  createRole: (data: any) =>
    request<any>('/roles/', { method: 'POST', body: JSON.stringify(data) }),
  updateRole: (id: string, data: any) =>
    request<any>(`/roles/${encodeURIComponent(id)}/`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRole: (id: string) =>
    request<any>(`/roles/${encodeURIComponent(id)}/`, { method: 'DELETE' }),

  // المستخدمين والحسابات (Users)
  getUsers: () => request<any[]>('/users/'),
  createUser: (data: any) =>
    request<any>('/users/', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id: string, data: any) =>
    request<any>(`/users/${encodeURIComponent(id)}/`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUser: (id: string) =>
    request<any>(`/users/${encodeURIComponent(id)}/`, { method: 'DELETE' }),
  toggleUserActive: (id: string) =>
    request<any>(`/users/${encodeURIComponent(id)}/toggle_active/`, { method: 'POST' }),

  // المقاسات والموردين (Sizes & Suppliers)
  getSizeDefs: () => request<any[]>('/sizes/'),
  createSizeDef: (data: any) =>
    request<any>('/sizes/', { method: 'POST', body: JSON.stringify(data) }),
  updateSizeDef: (id: string, data: any) =>
    request<any>(`/sizes/${encodeURIComponent(id)}/`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSizeDef: (id: string) =>
    request<any>(`/sizes/${encodeURIComponent(id)}/`, { method: 'DELETE' }),
  getSuppliers: () => request<any[]>('/suppliers/'),
  createSupplier: (data: any) =>
    request<any>('/suppliers/', { method: 'POST', body: JSON.stringify(data) }),
  updateSupplier: (id: string, data: any) =>
    request<any>(`/suppliers/${encodeURIComponent(id)}/`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSupplier: (id: string) =>
    request<any>(`/suppliers/${encodeURIComponent(id)}/`, { method: 'DELETE' }),

  // الأقمشة والألوان وحركات المخزن (Fabrics & Colors)
  getFabrics: () => request<any[]>('/fabrics/'),
  getFabricColors: () => request<any[]>('/fabric-colors/'),
  getFabricTransactions: () => request<any[]>('/fabric-transactions/'),
  addFabricOrColor: (data: any) =>
    request<{ fabric: any; color: any }>('/fabrics/add_fabric_or_color/', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  recordFabricTransaction: (data: any) =>
    request<{ color: any; transaction: any }>('/fabric-colors/record_transaction/', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  updateColorPrice: (colorId: string, price: number) =>
    request<any>(`/fabric-colors/${encodeURIComponent(colorId)}/`, {
      method: 'PUT',
      body: JSON.stringify({ price_per_unit: price })
    }),

  // الإكسسوارات والتصنيفات وحركات الصرف (Accessories)
  getAccessoryTypes: () => request<any[]>('/accessory-types/'),
  createAccessoryType: (data: any) =>
    request<any>('/accessory-types/', { method: 'POST', body: JSON.stringify(data) }),
  getAccessories: () => request<any[]>('/accessories/'),
  createAccessory: (data: any) =>
    request<any>('/accessories/', { method: 'POST', body: JSON.stringify(data) }),
  updateAccessory: (id: string, data: any) =>
    request<any>(`/accessories/${encodeURIComponent(id)}/`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),
  deleteAccessory: (id: string) =>
    request<any>(`/accessories/${encodeURIComponent(id)}/`, { method: 'DELETE' }),
  recordAccessoryTransaction: (data: any) =>
    request<{ accessory: any; transaction: any }>('/accessories/record_transaction/', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  markAccessoryWithdrawn: (id: string) =>
    request<any>(`/accessories/${encodeURIComponent(id)}/mark_withdrawn/`, { method: 'POST' }),
  getAccessoryAlerts: () => request<any>('/accessories/alerts/'),

  // الموديلات ومتطلبات التصميم ومراحل الإنتاج (Models & Lifecycle)
  getModels: () => request<any[]>('/models/'),
  createModel: (data: any) =>
    request<any>('/models/', { method: 'POST', body: JSON.stringify(data) }),
  updateModel: (id: string, data: any) =>
    request<any>(`/models/${encodeURIComponent(id)}/`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),
  deleteModel: (id: string) =>
    request<any>(`/models/${encodeURIComponent(id)}/`, { method: 'DELETE' }),
  updateModelPlan: (modelId: string, data: any) =>
    request<any>(`/models/${encodeURIComponent(modelId)}/update_plan/`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  createModelRequirement: (data: any) =>
    request<any>('/model-requirements/', { method: 'POST', body: JSON.stringify(data) }),
  updateModelRequirement: (id: string, data: any) =>
    request<any>(`/model-requirements/${encodeURIComponent(id)}/`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),
  deleteModelRequirement: (id: string) =>
    request<any>(`/model-requirements/${encodeURIComponent(id)}/`, { method: 'DELETE' }),
  createModelAccessory: (data: any) =>
    request<any>('/model-accessories/', { method: 'POST', body: JSON.stringify(data) }),
  updateModelAccessory: (id: string, data: any) =>
    request<any>(`/model-accessories/${encodeURIComponent(id)}/`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),
  deleteModelAccessory: (id: string) =>
    request<any>(`/model-accessories/${encodeURIComponent(id)}/`, { method: 'DELETE' }),
  issueFabricToCutting: (
    modelId: string,
    userName?: string,
    extraData?: { reqQuantities?: Record<string, number>; accQuantities?: Record<string, number> }
  ) =>
    request<any>(`/models/${encodeURIComponent(modelId)}/issue_fabric_to_cutting/`, {
      method: 'POST',
      body: JSON.stringify({ user_name: userName, ...(extraData || {}) })
    }),
  finishCuttingToQC: (modelId: string, userName?: string, notes?: string) =>
    request<any>(`/models/${encodeURIComponent(modelId)}/finish_cutting/`, {
      method: 'POST',
      body: JSON.stringify({ user_name: userName, notes })
    }),
  recordQCStageCount: (modelId: string, data: any) =>
    request<{ model: any; qcRecord?: any; qcRecords?: any[] }>(`/models/${encodeURIComponent(modelId)}/record_qc_count/`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  finishQCApproval: (modelId: string, userName?: string) =>
    request<any>(`/models/${encodeURIComponent(modelId)}/finish_qc_approval/`, {
      method: 'POST',
      body: JSON.stringify({ user_name: userName })
    }),
  dispatchModelToSewing: (modelId: string, data: any) =>
    request<any>(`/models/${encodeURIComponent(modelId)}/dispatch_to_sewing/`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  finishSewingToQC: (modelId: string, data: any) =>
    request<any>(`/models/${encodeURIComponent(modelId)}/finish_sewing/`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  finishQCToProduction: (modelId: string, data: any) =>
    request<any>(`/models/${encodeURIComponent(modelId)}/finish_qc_to_production/`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  addModelTimeline: (modelId: string, data: any) =>
    request<any>(`/models/${encodeURIComponent(modelId)}/add_timeline/`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),

  // الأسمبلي والأمبالاج (Assembly & Packaging)
  getPackagingRequirement: (modelId: string) =>
    request<any>(`/models/${encodeURIComponent(modelId)}/packaging_requirement/`),
  setPackagingStep: (modelId: string, data: any) =>
    request<any>(`/models/${encodeURIComponent(modelId)}/set_packaging_step/`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  startFinishing: (modelId: string, data: any) =>
    request<any>(`/models/${encodeURIComponent(modelId)}/start_finishing/`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  receiveFinishing: (modelId: string, data: any) =>
    request<any>(`/models/${encodeURIComponent(modelId)}/receive_finishing/`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  startAssemblyStage: (modelId: string, data: any) =>
    request<any>(`/models/${encodeURIComponent(modelId)}/start_assembly_stage/`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  receiveAssemblyStage: (modelId: string, data: any) =>
    request<any>(`/models/${encodeURIComponent(modelId)}/receive_assembly_stage/`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),

  // سجلات القص، الفرز، المطابع، والمكن
  getCuttingRecords: () => request<any[]>('/cutting-records/'),
  createCuttingRecord: (data: any) =>
    request<any>('/cutting-records/', { method: 'POST', body: JSON.stringify(data) }),
  getQCRecords: () => request<any[]>('/qc-records/'),
  createQCRecord: (data: any) =>
    request<any>('/qc-records/', { method: 'POST', body: JSON.stringify(data) }),
  saveQCMatrix: (data: any) =>
    request<{ model: any; qcRecords: any[] }>('/qc-records/save_matrix/', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  getDispatches: () => request<any[]>('/dispatches/'),
  createPrintDispatch: (data: any) =>
    request<any>('/dispatches/', { method: 'POST', body: JSON.stringify(data) }),
  updatePrintDispatchStatus: (id: string, status: string, userName?: string) =>
    request<any>(`/dispatches/${encodeURIComponent(id)}/update_status/`, {
      method: 'POST',
      body: JSON.stringify({ status, user_name: userName })
    }),
  getSewingDispatches: () => request<any[]>('/sewing-dispatches/'),
  receiveFromSewing: (id: string, userName?: string, notes?: string) =>
    request<any>(`/sewing-dispatches/${encodeURIComponent(id)}/receive/`, {
      method: 'POST',
      body: JSON.stringify({ user_name: userName, notes })
    }),

  // التنبيهات، الرسائل الداخلية، وسجل المراقبة
  getNotifications: () => request<any>('/notifications/'),
  getInternalMessages: () => request<any[]>('/internal-messages/'),
  sendInternalMessage: (data: any) =>
    request<any>('/internal-messages/', { method: 'POST', body: JSON.stringify(data) }),
  markMessageRead: (id: string) =>
    request<any>(`/internal-messages/${encodeURIComponent(id)}/mark_read/`, { method: 'POST' }),
  getAuditLogs: () => request<any[]>('/audit-logs/'),
  createAuditLog: (data: any) =>
    request<any>('/audit-logs/', { method: 'POST', body: JSON.stringify(data) }),

  // الموارد البشرية (HR)
  getHRJobTitles: () => request<any[]>('/hr-job-titles/'),
  createHRJobTitle: (data: any) =>
    request<any>('/hr-job-titles/', { method: 'POST', body: JSON.stringify(data) }),
  updateHRJobTitle: (id: string, data: any) =>
    request<any>(`/hr-job-titles/${encodeURIComponent(id)}/`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteHRJobTitle: (id: string) =>
    request<any>(`/hr-job-titles/${encodeURIComponent(id)}/`, { method: 'DELETE' }),
  getHREmployees: () => request<any[]>('/hr-employees/'),
  createHREmployee: (data: any) =>
    request<any>('/hr-employees/', { method: 'POST', body: JSON.stringify(data) }),
  updateHREmployee: (id: string, data: any) =>
    request<any>(`/hr-employees/${encodeURIComponent(id)}/`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteHREmployee: (id: string) =>
    request<any>(`/hr-employees/${encodeURIComponent(id)}/`, { method: 'DELETE' }),
  getHRAttendanceSettings: () => request<any>('/hr-attendance-settings/'),
  updateHRAttendanceSettings: (data: any) =>
    request<any>('/hr-attendance-settings/update_settings/', { method: 'POST', body: JSON.stringify(data) }),
  getHRAttendanceRecords: () => request<any[]>('/hr-attendance-records/'),
  createHRAttendanceRecord: (data: any) =>
    request<any>('/hr-attendance-records/', { method: 'POST', body: JSON.stringify(data) }),
  updateHRAttendanceRecord: (id: string, data: any) =>
    request<any>(`/hr-attendance-records/${encodeURIComponent(id)}/`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    }),
  deleteHRAttendanceRecord: (id: string) =>
    request<any>(`/hr-attendance-records/${encodeURIComponent(id)}/`, { method: 'DELETE' }),
  getHRAttendanceStats: (month?: string) =>
    request<any>(`/hr-attendance-records/stats/${month ? `?month=${encodeURIComponent(month)}` : ''}`),
  downloadHRAttendanceTemplate: (month?: string) =>
    requestBlob(`/hr-attendance-records/template/${month ? `?month=${encodeURIComponent(month)}` : ''}`),
  uploadHRAttendanceSheet: (file: File, month?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (month) {
      form.append('month', month);
    }
    return requestForm<any>('/hr-attendance-records/upload-sheet/', form);
  },
  getHRPenalties: () => request<any[]>('/hr-penalties/'),
  createHRPenalty: (data: any) =>
    request<any>('/hr-penalties/', { method: 'POST', body: JSON.stringify(data) }),
  updateHRPenalty: (id: string, data: any) =>
    request<any>(`/hr-penalties/${encodeURIComponent(id)}/`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteHRPenalty: (id: string) =>
    request<any>(`/hr-penalties/${encodeURIComponent(id)}/`, { method: 'DELETE' }),
  getHRLoans: () => request<any[]>('/hr-loans/'),
  createHRLoan: (data: any) =>
    request<any>('/hr-loans/', { method: 'POST', body: JSON.stringify(data) }),
  updateHRLoan: (id: string, data: any) =>
    request<any>(`/hr-loans/${encodeURIComponent(id)}/`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteHRLoan: (id: string) =>
    request<any>(`/hr-loans/${encodeURIComponent(id)}/`, { method: 'DELETE' })
};
