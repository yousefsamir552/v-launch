import { auditContextHeaders } from '../utils/completedModels';
import type {
  ModelsReportResponse,
  ProductionDepartmentsResponse,
  QualityShortageResponse,
  ModelStageWaterfallResponse,
  DepartmentTargetsResponse,
  DepartmentTargetsMap
} from '../types';

/**
 * يُعيد ترويسات سياق التدقيق (X-Audit-Context / X-Audit-Section) لكي تُمرَّر
 * مع أي طلب تعديل/إجراء يتم على موديل منتهٍ. الباك إند يستخدمها لتسجيل
 * السجل بعلامة "[تعديل على موديل منتهي]" مع اسم القسم.
 */
export { auditContextHeaders };

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

/**
 * طابور تحديثات خطة الموديل (update_plan) لكل موديل.
 * يضمن وصول الطلبات بنفس ترتيب إرسالها حتى لا يكتب طلب قديم (مثلاً حفظ العدد
 * المستهدف عند مغادرة الحقل) فوق طلب أحدث (مثلاً مطابقة المقصوص الفعلي).
 */
const modelPlanQueues = new Map<string, Promise<unknown>>();

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('factory_erp_auth_token') || '';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}`, 'X-Auth-Token': token } : {}),
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
  return {
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}`, 'X-Auth-Token': token } : {}),
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
  const send = () =>
    fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: buildAuthHeaders(),
      body: form
    });

  let res: Response;
  try {
    res = await send();
  } catch (error: any) {
    // "Failed to fetch" غالباً اضطراب شبكة مؤقت (Render cold start / انقطاع لحظي)،
    // لذلك نعيد المحاولة مرة واحدة فقط بعد 800ms قبل إظهار الخطأ للمستخدم.
    if (!(error instanceof TypeError)) {
      throw new Error(error?.message || 'تعذر الاتصال بالسيرفر. يرجى المحاولة مرة أخرى.');
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
    try {
      res = await send();
    } catch {
      throw new Error(
        'تعذر الاتصال بالسيرفر (Failed to fetch). يرجى التحقق من اتصال الإنترنت ثم إعادة المحاولة.'
      );
    }
  }

  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  if (res.status === 204) {
    return {} as T;
  }
  return (await res.json()) as T;
}

/** يبني Query String من قيم اختيارية مع تجاهل القيم الفارغة. */
function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== '') {
      search.set(key, String(value));
    }
  });
  const suffix = search.toString();
  return suffix ? `?${suffix}` : '';
}

/**
 * ضغط ذكي عالي الدقة في المتصفح قبل الرفع:
 * - أي ملف ليس صورة أو حجمه <= 2.2MB يُرفع كما هو بكامل بكسلاته ودقته (بدون أي تدخل).
 * - الملفات الأكبر فقط تُعاد بناؤها على Canvas بأقصى بُعد 4096px للحفاظ على أدق
 *   تفاصيل الرسمة/الطباعة عند التكبير (Zoom) في ملفات PDF للمطبعة، مع جودة عالية
 *   تبدأ من 0.92 وتنخفض تدريجياً حتى الوصول لحد الحجم المستهدف.
 */
const TARGET_MAX_BYTES = 2.2 * 1024 * 1024;
const MAX_DIMENSION = 4096;

async function compressImageClientSide(file: File): Promise<File> {
  // قاعدة عدم اللمس: الملفات الصغيرة أو غير الصور تبقى كما هي تماماً.
  if (!file.type.startsWith('image/') || file.size <= TARGET_MAX_BYTES) {
    return file;
  }

  const loadImage = () =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('تعذر قراءة الصورة في المتصفح.'));
      };
      image.src = objectUrl;
    });

  const drawToCanvas = (
    source: HTMLImageElement | HTMLCanvasElement,
    width: number,
    height: number
  ): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('تعذر تهيئة Canvas لضغط الصورة.');
    }
    // خلفية بيضاء حتى لا تتحول الشفافية إلى أسود عند تحويلها إلى JPEG.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, width, height);
    return canvas;
  };

  const canvasToJpegBlob = (canvas: HTMLCanvasElement, quality: number) =>
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('تعذر ضغط الصورة.'))),
        'image/jpeg',
        quality
      );
    });

  const toJpegFile = (blob: Blob) =>
    new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });

  try {
    const image = await loadImage();
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (!sourceWidth || !sourceHeight) {
      return file;
    }

    const longestSide = Math.max(sourceWidth, sourceHeight);
    // إن كان أطول ضلع <= 4096 نُبقي الأبعاد الأصلية كما هي تماماً.
    const scale = longestSide > MAX_DIMENSION ? MAX_DIMENSION / longestSide : 1;
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    let canvas = drawToCanvas(image, width, height);

    // تدرج جودة عالٍ: نتوقف عند أول جودة تُنتج ملفاً في حدود الحجم المستهدف.
    for (const quality of [0.92, 0.88, 0.84, 0.78]) {
      const blob = await canvasToJpegBlob(canvas, quality);
      if (blob.size <= TARGET_MAX_BYTES) {
        return toJpegFile(blob);
      }
    }

    // ما زال كبيراً بعد جودة 0.78: تصغير واحد بنسبة 0.85 ثم إخراج بجودة 0.85.
    canvas = drawToCanvas(
      canvas,
      Math.max(1, Math.round(width * 0.85)),
      Math.max(1, Math.round(height * 0.85))
    );
    const finalBlob = await canvasToJpegBlob(canvas, 0.85);
    return toJpegFile(finalBlob);
  } catch {
    // أي خطأ غير متوقع في Canvas: نرفع الملف الأصلي بدلاً من إفشال الرفع.
    return file;
  }
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

  // رفع صورة إلى التخزين السحابي (Cloudflare R2) وإرجاع رابطها العام فقط
  uploadImage: async (file: File, folder: string = 'general') => {
    const preparedFile = await compressImageClientSide(file);
    const form = new FormData();
    form.append('file', preparedFile);
    form.append('folder', folder);
    return requestForm<{ url: string; key: string; size: number; content_type: string }>(
      '/upload-image/',
      form
    );
  },

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
  deleteUser: (id: string, cascade = false) =>
    request<any>(`/users/${encodeURIComponent(id)}/`, {
      method: 'DELETE',
      body: JSON.stringify({ cascade })
    }),
  toggleUserActive: (id: string, cascade = false) =>
    request<any>(`/users/${encodeURIComponent(id)}/toggle_active/`, {
      method: 'POST',
      body: JSON.stringify({ cascade })
    }),

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
  getWorkshops: () => request<any[]>('/workshops/'),
  createWorkshop: (data: any) =>
    request<any>('/workshops/', { method: 'POST', body: JSON.stringify(data) }),
  updateWorkshop: (id: string, data: any) =>
    request<any>(`/workshops/${encodeURIComponent(id)}/`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteWorkshop: (id: string) =>
    request<any>(`/workshops/${encodeURIComponent(id)}/`, { method: 'DELETE' }),

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
  updateFabricColor: (
    colorId: string,
    data: { color_code?: string; color_name?: string; hex_code?: string; price_per_unit?: number }
  ) =>
    request<any>(`/fabric-colors/${encodeURIComponent(colorId)}/`, {
      method: 'PATCH',
      body: JSON.stringify(data)
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
  updateModel: (id: string, data: any, auditHeaders?: Record<string, string>) =>
    request<any>(`/models/${encodeURIComponent(id)}/`, {
      method: 'PUT',
      body: JSON.stringify(data),
      ...(auditHeaders ? { headers: auditHeaders } : {})
    }),
  deleteModel: (id: string) =>
    request<any>(`/models/${encodeURIComponent(id)}/`, { method: 'DELETE' }),
  updateModelPlan: (modelId: string, data: any, auditHeaders?: Record<string, string>) => {
    const send = () =>
      request<any>(`/models/${encodeURIComponent(modelId)}/update_plan/`, {
        method: 'POST',
        body: JSON.stringify(data),
        ...(auditHeaders ? { headers: auditHeaders } : {})
      });
    const previous = modelPlanQueues.get(modelId) || Promise.resolve();
    const queued = previous.catch(() => undefined).then(send);
    modelPlanQueues.set(modelId, queued);
    queued
      .catch(() => undefined)
      .then(() => {
        if (modelPlanQueues.get(modelId) === queued) modelPlanQueues.delete(modelId);
      });
    return queued;
  },
  createModelRequirement: (data: any) =>
    request<any>('/model-requirements/', { method: 'POST', body: JSON.stringify(data) }),
  updateModelRequirement: (id: string, data: any, auditHeaders?: Record<string, string>) =>
    request<any>(`/model-requirements/${encodeURIComponent(id)}/`, {
      method: 'PUT',
      body: JSON.stringify(data),
      ...(auditHeaders ? { headers: auditHeaders } : {})
    }),
  deleteModelRequirement: (id: string) =>
    request<any>(`/model-requirements/${encodeURIComponent(id)}/`, { method: 'DELETE' }),
  createModelAccessory: (data: any) =>
    request<any>('/model-accessories/', { method: 'POST', body: JSON.stringify(data) }),
  updateModelAccessory: (id: string, data: any, auditHeaders?: Record<string, string>) =>
    request<any>(`/model-accessories/${encodeURIComponent(id)}/`, {
      method: 'PUT',
      body: JSON.stringify(data),
      ...(auditHeaders ? { headers: auditHeaders } : {})
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
  returnFabricFromCutting: (
    modelId: string,
    requirementId: string,
    quantity: number,
    userName?: string,
    notes?: string,
    defectQuantity?: number
  ) =>
    request<{
      message: string;
      model: any;
      requirement: any;
      color: any;
      transaction: any;
      defect_transaction?: any;
    }>(
      `/models/${encodeURIComponent(modelId)}/return_fabric_to_warehouse/`,
      {
        method: 'POST',
        body: JSON.stringify({
          requirement_id: requirementId,
          quantity,
          defect_quantity: defectQuantity || 0,
          user_name: userName,
          notes
        }),
        // تسجيل الحركة في سجل تدقيق قسم القص بدلاً من قسم التصميم.
        headers: { 'X-Audit-Section': 'القص' }
      }
    ),
  finishCuttingToQC: (modelId: string, userName?: string, notes?: string, parts?: string[]) =>
    request<any>(`/models/${encodeURIComponent(modelId)}/finish_cutting/`, {
      method: 'POST',
      body: JSON.stringify({ user_name: userName, notes, parts })
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
  setPackagingStep: (modelId: string, data: any, auditHeaders?: Record<string, string>) =>
    request<any>(`/models/${encodeURIComponent(modelId)}/set_packaging_step/`, {
      method: 'POST',
      body: JSON.stringify(data),
      ...(auditHeaders ? { headers: auditHeaders } : {})
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
  startIroning: (modelId: string, data: any) =>
    request<any>(`/models/${encodeURIComponent(modelId)}/start_ironing/`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  receiveIroning: (modelId: string, data: any) =>
    request<any>(`/models/${encodeURIComponent(modelId)}/receive_ironing/`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  getPartStages: (modelId: string) =>
    request<any>(`/models/${encodeURIComponent(modelId)}/part_stages/`),
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

  // خامات التشغيل والأمبالاج (Packaging & Operating Materials MRP)
  getPackagingMaterialRules: () => request<any[]>('/packaging-material-rules/'),
  savePackagingMaterialRule: (data: any) =>
    request<any>('/packaging-material-rules/', { method: 'POST', body: JSON.stringify(data) }),
  updatePackagingMaterialRule: (id: string, data: any) =>
    request<any>(`/packaging-material-rules/${encodeURIComponent(id)}/`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),
  deletePackagingMaterialRule: (id: string) =>
    request<any>(`/packaging-material-rules/${encodeURIComponent(id)}/`, {
      method: 'DELETE'
    }),
  recordPackagingMaterialTransaction: (data: any) =>
    request<{ sizeRule: any; transaction: any }>('/packaging-material-transactions/', {
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
  updatePrintDispatchStatus: (
    id: string,
    status: string,
    userName?: string,
    auditHeaders?: Record<string, string>,
    receivedQty?: number,
    notes?: string
  ) =>
    request<any>(`/dispatches/${encodeURIComponent(id)}/update_status/`, {
      method: 'POST',
      body: JSON.stringify({
        status,
        user_name: userName,
        received_qty: receivedQty,
        notes
      }),
      ...(auditHeaders ? { headers: auditHeaders } : {})
    }),
  skipPrintToSewing: (modelId: string, pieceType: string, userName?: string) =>
    request<any>('/dispatches/skip_print/', {
      method: 'POST',
      body: JSON.stringify({ model_id: modelId, piece_type: pieceType, user_name: userName })
    }),
  getSewingDispatches: () => request<any[]>('/sewing-dispatches/'),
  receiveFromSewing: (id: string, userName?: string, notes?: string, receivedQty?: number) =>
    request<any>(`/sewing-dispatches/${encodeURIComponent(id)}/receive/`, {
      method: 'POST',
      body: JSON.stringify({ user_name: userName, notes, received_qty: receivedQty })
    }),

  // التنبيهات، الرسائل الداخلية، وسجل المراقبة
  getNotifications: () => request<any>('/notifications/'),
  getInternalMessages: () => request<any[]>('/internal-messages/'),
  sendInternalMessage: (data: any) =>
    request<any>('/internal-messages/', { method: 'POST', body: JSON.stringify(data) }),
  markMessageRead: (id: string) =>
    request<any>(`/internal-messages/${encodeURIComponent(id)}/mark_read/`, { method: 'POST' }),
  getAuditLogs: (params: Record<string, string | number | undefined> = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        query.append(key, String(value));
      }
    });
    const qs = query.toString();
    return request<any>(`/audit-logs/${qs ? `?${qs}` : ''}`);
  },
  getAuditLogFilters: () => request<any>('/audit-logs/filters/'),

  // تصفير بيانات المصنع الانتقائي (sudo فقط)
  factoryReset: (sections: string[], confirmation: string) =>
    request<{
      status: string;
      summary: Record<string, number>;
      total: number;
      sections: string[];
      notes: string[];
    }>('/factory-reset/', {
      method: 'POST',
      body: JSON.stringify({ sections, confirmation })
    }),

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
  getHRAttendanceRecords: (params?: { month?: string; includePrevWeek?: boolean; employeeId?: string }) => {
    const search = new URLSearchParams();
    if (params?.month) search.set('month', params.month);
    if (params?.includePrevWeek) search.set('include_prev_week', '1');
    if (params?.employeeId) search.set('employee_id', params.employeeId);
    const qs = search.toString();
    return request<any[]>(`/hr-attendance-records/${qs ? `?${qs}` : ''}`);
  },
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
  reapplyHRAttendanceRules: (month?: string) =>
    request<any>(`/hr-attendance-records/reapply-rules/${month ? `?month=${encodeURIComponent(month)}` : ''}`, {
      method: 'POST'
    }),
  getHRPenalties: (month?: string) =>
    request<any[]>(`/hr-penalties/${month ? `?month=${encodeURIComponent(month)}` : ''}`),
  createHRPenalty: (data: any) =>
    request<any>('/hr-penalties/', { method: 'POST', body: JSON.stringify(data) }),
  updateHRPenalty: (id: string, data: any) =>
    request<any>(`/hr-penalties/${encodeURIComponent(id)}/`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteHRPenalty: (id: string) =>
    request<any>(`/hr-penalties/${encodeURIComponent(id)}/`, { method: 'DELETE' }),
  getHRLoans: (month?: string) =>
    request<any[]>(`/hr-loans/${month ? `?month=${encodeURIComponent(month)}` : ''}`),
  createHRLoan: (data: any) =>
    request<any>('/hr-loans/', { method: 'POST', body: JSON.stringify(data) }),
  updateHRLoan: (id: string, data: any) =>
    request<any>(`/hr-loans/${encodeURIComponent(id)}/`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteHRLoan: (id: string) =>
    request<any>(`/hr-loans/${encodeURIComponent(id)}/`, { method: 'DELETE' }),
  getHRReports: (params?: { year?: number; from?: string; to?: string }) => {
    const search = new URLSearchParams();
    if (params?.year) search.set('year', String(params.year));
    if (params?.from) search.set('from', params.from);
    if (params?.to) search.set('to', params.to);
    const suffix = search.toString();
    return request<any>(`/hr-reports/${suffix ? `?${suffix}` : ''}`);
  },

  // التقارير والإحصائيات (Reports & Statistics v2)
  getModelsReport: (params?: {
    metric?: 'models' | 'pieces';
    date_from?: string;
    date_to?: string;
    composition?: string;
    model_type?: string;
    stage?: string;
  }) =>
    request<ModelsReportResponse>(
      `/reports/models/${buildQuery({
        metric: params?.metric,
        date_from: params?.date_from,
        date_to: params?.date_to,
        composition: params?.composition,
        model_type: params?.model_type,
        stage: params?.stage
      })}`
    ),
  getProductionReport: (params?: { period?: string; date_from?: string; date_to?: string }) =>
    request<ProductionDepartmentsResponse>(
      `/reports/production/${buildQuery({
        period: params?.period,
        date_from: params?.date_from,
        date_to: params?.date_to
      })}`
    ),
  getQualityReport: (params?: {
    search?: string;
    sort?: string;
    date_from?: string;
    date_to?: string;
  }) =>
    request<QualityShortageResponse>(
      `/reports/quality/${buildQuery({
        search: params?.search,
        sort: params?.sort,
        date_from: params?.date_from,
        date_to: params?.date_to
      })}`
    ),
  getModelStageWaterfall: (modelId: number | string) =>
    request<ModelStageWaterfallResponse>(
      `/reports/quality/stages/${buildQuery({ model_id: modelId })}`
    ),
  getDepartmentTargets: () => request<DepartmentTargetsResponse>('/reports/targets/'),
  saveDepartmentTargets: (targets: DepartmentTargetsMap) =>
    request<DepartmentTargetsResponse>('/reports/targets/', {
      method: 'POST',
      body: JSON.stringify({ targets })
    })
};
