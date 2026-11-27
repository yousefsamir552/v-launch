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
  RankLevel,
  RankOption,
  GlobalSiteSettings,
  AccessoryType,
  AccessoryItem,
  AccessoryTransaction,
  AccessoryUnit,
  AccessoryUsageType,
  PurchaseRequest,
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
  WorkshopEvaluation,
  WorkshopEvaluationStage,
  PartStage,
  PART_STAGE_LABELS,
  PART_STAGE_ORDER,
  MODEL_STATUS_TO_PART_STAGE,
  deriveStatusFromStages,
  SnoozeHours,
  SNOOZED_NOTIFICATIONS_STORAGE_KEY,
  UIPreferences,
  DEFAULT_UI_PREFERENCES
} from '../types';
import { buildPackagingDemandMap } from '../utils/packagingMaterials';
import { finishedSetsOf, photographyOutstandingOf } from '../utils/completedModels';
import { exportCsv, exportZipCsv, datedFileName, CsvValue, CsvSheet } from '../utils/exportExcel';

/**
 * ربط مرحلة التنبيه بمفتاح الصلاحية المطلوبة لرؤيته.
 * التنبيهات لا تظهر إلا لمن يملك صلاحية القسم — حساب sudo يرى كل شيء.
 */
import { NOTIFICATION_STAGE_PERMISSION, FlashMessage, modelPartsOf, seedModelPartStages, patchModelPartStage, patchModelPartsStage, DEFAULT_GLOBAL_SETTINGS, DESIGN_STAGES, PRE_PRODUCTION_STAGES, auditHeadersForModel, AppContextType, LEGACY_STORAGE_KEYS } from './appContextTypes';
import { buildPermissionHelpers } from './appPermissions';
import { buildWarehouseActions } from './appWarehouseActions';
import { buildDesignActions } from './appDesignActions';
import { buildCuttingQcActions } from './appCuttingQcActions';
import { buildExportActions } from './appExports';
import { buildPrintSewingActions } from './appPrintSewingActions';
import { buildAssemblyActions } from './appAssemblyActions';
import { buildSettingsUsersActions } from './appSettingsUsersActions';
import { buildAppNotifications } from './appNotificationsBuilder';

const AppContext = createContext<AppContextType | null>(null);

/**
 * البادئات المعروفة لكل قطعة. تُستخدم لمعرفة ما إذا كان اسم البند يبدأ بقطعة
 * أساسية صريحة (مثل "تيشرت - الصدر") أو أنه اسم حر قديم (مثل "الصدر").
 */
const KNOWN_PART_PREFIXES: Record<GarmentPart, string[]> = {
  shirt: ['تيشرت', 'تيشيرت', 'قميص', 'shirt', 'tshirt', 't-shirt'],
  pants: ['بنطلون', 'بنطال', 'بنطل', 'pants', 'trouser'],
  jacket: ['جاكيت', 'jacket'],
  single: ['قطعة واحدة', 'single']
};

/** هل يبدأ اسم البند بقطعة أساسية معروفة (تيشرت / بنطلون / جاكيت / قطعة واحدة)؟ */
const hasKnownPartPrefix = (value?: string | null): boolean => {
  const raw = (value || '').trim().toLowerCase();
  if (!raw) return false;
  if ((PART_ORDER as string[]).includes(raw)) return true;
  return PART_ORDER.some((part) =>
    KNOWN_PART_PREFIXES[part].some((prefix) => raw.startsWith(prefix))
  );
};

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
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [fabrics, setFabrics] = useState<Fabric[]>([]);
  const [fabricColorsRaw, setFabricColors] = useState<FabricColor[]>([]);
  const [fabricTransactions, setFabricTransactions] = useState<FabricTransaction[]>([]);
  const [models, setModels] = useState<DesignModel[]>([]);
  const [requirements, setRequirements] = useState<ModelRequirement[]>([]);
  const [accessories, setAccessories] = useState<ModelAccessory[]>([]);
  const [accessoryTypes, setAccessoryTypes] = useState<AccessoryType[]>([]);
  const [accessoryItemsRaw, setAccessoryItems] = useState<AccessoryItem[]>([]);
  const [accessoryTransactions, setAccessoryTransactions] = useState<AccessoryTransaction[]>([]);
  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseRequest[]>([]);
  const [cuttingRecords, setCuttingRecords] = useState<CuttingRecord[]>([]);
  const [qcRecords, setQcRecords] = useState<QCRecord[]>([]);
  const [printDispatches, setPrintDispatches] = useState<PrintDispatch[]>([]);
  const [sewingDispatches, setSewingDispatches] = useState<SewingDispatch[]>([]);
  const [packagingRequirements, setPackagingRequirements] = useState<PackagingRequirement[]>([]);
  const [finishingRecords, setFinishingRecords] = useState<FinishingRecord[]>([]);
  const [assemblyStageRecords, setAssemblyStageRecords] = useState<AssemblyStageRecord[]>([]);
  const [workshopEvaluations, setWorkshopEvaluations] = useState<WorkshopEvaluation[]>([]);
  const [packagingMaterialRules, setPackagingMaterialRules] = useState<PackagingMaterialRule[]>([]);
  const [internalMessages, setInternalMessages] = useState<InternalMessage[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [flashMessages, setFlashMessages] = useState<FlashMessage[]>([]);
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([]);
  // Snoozed notifications: map of notification id → ISO date-time until it stays hidden (persisted in DB AppNotification).
  const [snoozedNotifications, setSnoozedNotifications] = useState<Record<string, string>>({});

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

  const activeModelIdsSet = useMemo(() => {
    return new Set(models.filter((m) => !m.is_deleted).map((m) => m.id));
  }, [models]);

  const fabricColors = useMemo<FabricColor[]>(() => {
    // إذا لم تُحمَّل الموديلات أو المتطلبات لهذا المستخدم (مثل أمين مخزن القماش فقط)، نُبقي المحجوز القادم من السيرفر كما هو دون تصفيره.
    if (models.length === 0 && requirements.length === 0) {
      return fabricColorsRaw;
    }
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
  }, [fabricColorsRaw, requirements, designModelIdsSet, models.length]);

  const accessoryItems = useMemo<AccessoryItem[]>(() => {
    // إذا لم تُحمَّل الموديلات أو إكسسواراتها لهذا المستخدم، نُبقي المحجوز القادم من السيرفر كما هو دون تصفيره.
    if (models.length === 0 && accessories.length === 0) {
      return accessoryItemsRaw;
    }
    // الإكسسوار يبقى محجوزاً عبر كل مراحل التشغيل حتى يتم صرفه فعلياً (is_issued = false).
    const reservedByAcc: Record<string, number> = {};
    accessories.forEach((acc) => {
      if (acc.accessory_id && !acc.is_issued && activeModelIdsSet.has(acc.model_id)) {
        const qty = Math.max(0, Number(acc.planned_quantity) || 0);
        reservedByAcc[acc.accessory_id] = Number(
          ((reservedByAcc[acc.accessory_id] || 0) + qty).toFixed(3)
        );
      }
    });
    return accessoryItemsRaw.map((it) => ({
      ...it,
      reserved_quantity: reservedByAcc[it.id] ?? 0
    }));
  }, [accessoryItemsRaw, accessories, activeModelIdsSet, models.length]);

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
        if (typeof user.ui_preferences?.sidebar_collapsed === 'boolean') {
          localStorage.setItem(
            `factory_erp_sidebar_collapsed_${user.id}`,
            String(user.ui_preferences.sidebar_collapsed)
          );
          localStorage.setItem(
            'factory_erp_sidebar_collapsed',
            String(user.ui_preferences.sidebar_collapsed)
          );
        }
      } else {
        localStorage.removeItem('factory_erp_current_user');
        localStorage.removeItem('factory_erp_auth_token');
      }
    } catch {
      // ignore
    }
  }, []);

  const [sidebarCollapsedLocal, setSidebarCollapsedLocal] = useState<boolean>(() => {
    try {
      const storedUser = localStorage.getItem('factory_erp_current_user');
      if (storedUser) {
        const parsed = JSON.parse(storedUser);
        if (typeof parsed?.ui_preferences?.sidebar_collapsed === 'boolean') {
          return parsed.ui_preferences.sidebar_collapsed;
        }
        const perUser = localStorage.getItem(`factory_erp_sidebar_collapsed_${parsed?.id}`);
        if (perUser === 'true' || perUser === 'false') return perUser === 'true';
      }
      return localStorage.getItem('factory_erp_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!currentUser) return;
    if (typeof currentUser.ui_preferences?.sidebar_collapsed === 'boolean') {
      setSidebarCollapsedLocal(currentUser.ui_preferences.sidebar_collapsed);
      return;
    }
    try {
      const perUser = localStorage.getItem(`factory_erp_sidebar_collapsed_${currentUser.id}`);
      if (perUser === 'true' || perUser === 'false') {
        setSidebarCollapsedLocal(perUser === 'true');
      }
    } catch {
      // ignore
    }
  }, [currentUser?.id, currentUser?.ui_preferences?.sidebar_collapsed]);

  const uiPreferences = useMemo<UIPreferences>(() => {
    const raw = currentUser?.ui_preferences;
    return {
      nav_mode: raw?.nav_mode === 'cards' ? 'cards' : 'sidebar',
      sidebar_collapsed:
        typeof raw?.sidebar_collapsed === 'boolean'
          ? raw.sidebar_collapsed
          : sidebarCollapsedLocal,
      accordion_mode:
        typeof raw?.accordion_mode === 'boolean'
          ? raw.accordion_mode
          : DEFAULT_UI_PREFERENCES.accordion_mode,
      cards_layout:
        raw?.cards_layout && typeof raw.cards_layout === 'object' ? raw.cards_layout : null
    };
  }, [currentUser?.ui_preferences, sidebarCollapsedLocal]);

  const setSidebarCollapsed = useCallback(
    (collapsed: boolean) => {
      const nextVal = Boolean(collapsed);
      setSidebarCollapsedLocal(nextVal);
      try {
        localStorage.setItem('factory_erp_sidebar_collapsed', String(nextVal));
        if (currentUser?.id) {
          localStorage.setItem(`factory_erp_sidebar_collapsed_${currentUser.id}`, String(nextVal));
        }
      } catch {
        // ignore
      }
      if (!currentUser) return;
      const optimisticUser: User = {
        ...currentUser,
        ui_preferences: {
          ...uiPreferences,
          sidebar_collapsed: nextVal
        }
      };
      setCurrentUser(optimisticUser);
      api
        .updateMyProfile({ ui_preferences: { sidebar_collapsed: nextVal } })
        .then((res) => {
          if (res?.user) {
            setCurrentUser(res.user);
          }
        })
        .catch(() => {
          // Keep optimistic localStorage value if network hiccups
        });
    },
    [currentUser, uiPreferences, setCurrentUser]
  );

  const updateUiPreferences = useCallback(
    async (
      patch: Partial<UIPreferences>
    ): Promise<{ success: boolean; message?: string; user?: User }> => {
      if (!currentUser) {
        return { success: false, message: 'يرجى تسجيل الدخول أولاً' };
      }
      try {
        const res = await api.updateMyProfile({ ui_preferences: patch });
        if (res?.user) {
          setCurrentUser(res.user);
          if (typeof res.user.ui_preferences?.sidebar_collapsed === 'boolean') {
            setSidebarCollapsedLocal(res.user.ui_preferences.sidebar_collapsed);
          }
          return { success: true, user: res.user };
        }
        return { success: false, message: 'لم يتم استلام بيانات الحساب المحدثة' };
      } catch (err: any) {
        return {
          success: false,
          message: err?.message || 'تعذر حفظ تفضيلات التنقل والواجهة'
        };
      }
    },
    [currentUser, setCurrentUser]
  );

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
        if (state.notificationStates) {
          setReadNotificationIds(
            Array.isArray(state.notificationStates.readIds) ? state.notificationStates.readIds : []
          );
          setSnoozedNotifications(
            state.notificationStates.snoozed && typeof state.notificationStates.snoozed === 'object'
              ? state.notificationStates.snoozed
              : {}
          );
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
        setWorkshops(Array.isArray(state.workshops) ? state.workshops : []);
        setFabrics(Array.isArray(state.fabrics) ? state.fabrics : []);
        setFabricColors(Array.isArray(state.fabricColors) ? state.fabricColors : []);
        setFabricTransactions(Array.isArray(state.fabricTransactions) ? state.fabricTransactions : []);
        setAccessoryTypes(Array.isArray(state.accessoryTypes) ? state.accessoryTypes : []);
        setAccessoryItems(Array.isArray(state.accessoryItems) ? state.accessoryItems : []);
        setAccessoryTransactions(
          Array.isArray(state.accessoryTransactions) ? state.accessoryTransactions : []
        );
        setPurchaseRequests(
          Array.isArray(state.purchaseRequests) ? state.purchaseRequests : []
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
        setWorkshopEvaluations(
          Array.isArray(state.workshopEvaluations) ? state.workshopEvaluations : []
        );
        setPackagingMaterialRules(
          Array.isArray(state.packagingMaterialRules) ? state.packagingMaterialRules : []
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
    // مسح كافة بيانات الجلسة من الذاكرة فوراً لمنع تسرب أي بيانات عند تبديل الحسابات.
    setRoles([]);
    setUsers([]);
    setOnlineUsers([]);
    setSizeDefs([]);
    setSuppliers([]);
    setWorkshops([]);
    setFabrics([]);
    setFabricColors([]);
    setFabricTransactions([]);
    setModels([]);
    setRequirements([]);
    setAccessories([]);
    setAccessoryTypes([]);
    setAccessoryItems([]);
    setAccessoryTransactions([]);
    setCuttingRecords([]);
    setQcRecords([]);
    setPrintDispatches([]);
    setSewingDispatches([]);
    setPackagingRequirements([]);
    setFinishingRecords([]);
    setAssemblyStageRecords([]);
    setWorkshopEvaluations([]);
    setPackagingMaterialRules([]);
    setPurchaseRequests([]);
    setInternalMessages([]);
    setAuditLogs([]);
    setReadNotificationIds([]);
    setSnoozedNotifications({});
  }, [setCurrentUser]);

  const logAction = useCallback(
    (
      action: string,
      details: string,
      options?: {
        persist?: boolean;
        actionType?: 'export' | 'print' | 'custom';
        targetName?: string;
      }
    ) => {
      // Do not log sudo emergency account actions into visible audit logs (Task 2)
      if (currentUser?.username?.toLowerCase() === 'sudo' || currentUser?.is_sudo) {
        return;
      }
      const combinedText = `${action} ${details}`;
      const isPrint =
        options?.actionType === 'print' || /طباعة|كشف للطباعة|ورقة|print/i.test(combinedText);
      const isExport =
        options?.actionType === 'export' ||
        /تصدير|تحميل قالب|نسخة احتياطية|إكسيل|excel|csv|zip/i.test(combinedText);
      const shouldPersist = Boolean(options?.persist || isPrint || isExport);
      const resolvedType: 'export' | 'print' | 'custom' =
        options?.actionType || (isPrint ? 'print' : isExport ? 'export' : 'custom');

      const tempId = 'log-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5);
      const newLog: AuditLog = {
        id: tempId,
        userName: currentUser?.real_name || currentUser?.username || 'مستخدم غير معروف',
        userId: currentUser?.id,
        section: action,
        actionType: resolvedType,
        action: resolvedType === 'print' ? 'طباعة مستند' : resolvedType === 'export' ? 'تصدير ملف' : action,
        targetName: options?.targetName || '',
        details,
        ip_address: '',
        timestamp: new Date().toLocaleString('ar-EG', { hour12: false })
      };
      setAuditLogs((prev) => [newLog, ...prev.slice(0, 200)]);

      // حفظ دائم في قاعدة البيانات لعمليات التصدير والطباعة وإجراءات العميل حتى لا تختفي بعد التحديث.
      if (shouldPersist && localStorage.getItem('factory_erp_auth_token')) {
        api
          .logClientAction({
            section: action || 'عام',
            action_type: resolvedType,
            target_name: options?.targetName || '',
            details
          })
          .then((saved) => {
            if (saved && saved.id) {
              setAuditLogs((prev) => prev.map((item) => (item.id === tempId ? saved : item)));
            }
          })
          .catch(() => {
            // لا نُعطل التصدير أو الطباعة إذا تعذر تسجيل الحركة
          });
      }
    },
    [currentUser]
  );

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
  /**
   * الدالة الموحدة لفتح واتساب وإرسال نص الطلب.
   * الجروبات لا تدعم تمرير نص مسبق، لذلك ننسخ النص تلقائياً ثم نفتح الجروب.
   */
  const openWhatsAppOrder = (
    phone: string | undefined | null,
    groupLink: string | undefined | null,
    messageText: string
  ) => {
    const cleanGroup = (groupLink || '').trim();
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');

    const copyText = (): boolean => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(messageText).catch(() => undefined);
        return true;
      }
      return false;
    };

    if (cleanGroup && /^https?:\/\//i.test(cleanGroup)) {
      copyText();
      addFlashMessage(
        '✅ تم نسخ نص الرسالة تلقائياً! اضغط لصق (Paste) داخل جروب الواتساب',
        'success'
      );
      window.open(cleanGroup, '_blank', 'noopener,noreferrer');
      return;
    }

    if (cleanPhone) {
      const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(messageText)}`;
      window.open(url, '_blank');
      return;
    }

    if (copyText()) {
      addFlashMessage('تم نسخ نص الرسالة (لا يوجد رقم هاتف أو جروب لهذه الجهة)', 'warning');
    } else {
      addFlashMessage('لا يوجد رقم هاتف أو جروب، وتعذّر نسخ النص تلقائياً', 'danger');
    }
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
    const receiverFromUsers = users.find((u) => u.id === receiverId || u.username === receiverId);
    // السماح للموظف بالرد على مدير أعلى رتبة أرسل له رسالة سابقاً حتى لو لم يظهر المدير في قائمة users.
    const threadPeer = !receiverFromUsers
      ? internalMessages.find((m) => m.sender_id === receiverId || m.receiver_id === receiverId)
      : undefined;
    const receiver = receiverFromUsers
      ? { id: receiverFromUsers.id, real_name: receiverFromUsers.real_name }
      : threadPeer
        ? {
            id: receiverId,
            real_name:
              threadPeer.sender_id === receiverId ? threadPeer.sender_name : threadPeer.receiver_name
          }
        : null;
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
  const normalizePartKey = useCallback((value?: string | null): GarmentPart => {
    const raw = (value || '').trim().toLowerCase();
    if (!raw) return 'shirt';
    if ((PART_ORDER as string[]).includes(raw)) return raw as GarmentPart;
    // فحص بداية النص أولاً: اسم القطعة الأساسية قد تتبعه قصة فرعية
    // مثل "تيشرت - الصدر" أو "تيشرت - الكم" فيجب أن يُنسب للقطعة الأساسية.
    for (const part of PART_ORDER) {
      if (KNOWN_PART_PREFIXES[part].some((prefix) => raw.startsWith(prefix))) return part;
    }
    // احتياطي للبنود الحرة القديمة التي تحمل اسم القطعة داخل النص.
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
      // الموديلات القديمة فقط: كل بنودها أسماء حرة بلا بادئة قطعة معروفة (مثل "الصدر").
      const isLegacyFreeTextModel =
        allModelReqs.length > 0 &&
        allModelReqs.every((r) => !hasKnownPartPrefix(r.part_name));
      let modelReqs = part
        ? allModelReqs.filter((r) => normalizePartKey(r.part_name) === part)
        : allModelReqs;
      // الاختلاط بين ألوان القطع ممنوع في القص والفرز والعد.
      // الرجوع لكل ألوان الموديل مسموح فقط للموديلات القديمة التي لا تحمل
      // أي بند فيها بادئة قطعة معروفة، حتى لا تظهر ألوان التيشرت داخل البنطلون.
      if (part && modelReqs.length === 0 && isLegacyFreeTextModel) {
        modelReqs = allModelReqs;
      }
      const colors: string[] = [];

      modelReqs.forEach((req) => {
        const col = fabricColors.find((c) => c.id === req.color_id);
        const baseLabel = col?.color_name
          ? `${col.color_code} - ${col.color_name}`
          : `${col?.color_code || 'لون'}`;
        // مع تحديد القطعة نعرض اسم اللون الأساسي فقط: نفس اللون المستخدم في
        // أكثر من قصة فرعية (الصدر والكم) يظهر مرة واحدة بدون تكرار.
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
  const getPackagingRequirement = useCallback(
    (modelId: string): PackagingRequirement | undefined =>
      packagingRequirements.find((req) => req.model_id === modelId),
    [packagingRequirements]
  );

  /** Independent stage per garment part, falling back to the model status. */
  const getPartStages = useCallback(
    (modelId: string): Partial<Record<GarmentPart, PartStage>> => {
      const model = models.find((m) => m.id === modelId);
      if (!model) return {};
      const raw = model.part_stages || {};
      const fallback = MODEL_STATUS_TO_PART_STAGE[model.status as string] || 'cutting';
      const stages: Partial<Record<GarmentPart, PartStage>> = {};
      getModelParts(modelId).forEach((part) => {
        const stage = raw[part];
        stages[part] =
          stage && PART_STAGE_ORDER.includes(stage) ? (stage as PartStage) : fallback;
      });
      return stages;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [models]
  );

  /** Packaging is locked until every part of the model reaches packaging. */
  const isPackagingReady = useCallback(
    (modelId: string): boolean => {
      const stages = Object.values(getPartStages(modelId));
      if (!stages.length) return false;
      return stages.every(
        (stage) => stage === 'packaging' || stage === 'dest' || stage === 'completed'
      );
    },
    [getPartStages]
  );


  const submitWorkshopEvaluation = useCallback(
    async (data: {
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
    }): Promise<{ success: boolean; message: string; evaluation?: WorkshopEvaluation }> => {
      try {
        const saved = await api.submitWorkshopEvaluation({
          workshop_id: data.workshopId,
          workshop_name: data.workshopName,
          stage: data.stage,
          model_id: data.modelId,
          print_dispatch_id: data.printDispatchId,
          sewing_dispatch_id: data.sewingDispatchId,
          finishing_record_id: data.finishingRecordId,
          delivery_timeliness: data.deliveryTimeliness,
          work_quality: data.workQuality,
          finishing_quality: data.finishingQuality,
          notes: data.notes || '',
          evaluated_by: currentUser?.real_name || currentUser?.username || 'مسؤول التشغيل'
        });
        setWorkshopEvaluations((prev) => [saved, ...prev.filter((item) => item.id !== saved.id)]);
        addFlashMessage(`تم حفظ تقييم ورشة (${saved.workshop_name}) بنجاح ⭐`, 'success');
        return { success: true, message: 'تم حفظ التقييم بنجاح', evaluation: saved };
      } catch (err: any) {
        const msg = err?.message || 'تعذر حفظ تقييم الورشة';
        addFlashMessage(msg, 'danger');
        return { success: false, message: msg };
      }
    },
    [currentUser, addFlashMessage]
  );

  const baseCtx: any = { currentUser, setCurrentUser, setCurrentUserState, isLoadingState, setIsLoadingState, globalSettings, setGlobalSettings, roles, setRoles, users, setUsers, onlineUsers, setOnlineUsers, sizeDefs, setSizeDefs, suppliers, setSuppliers, workshops, setWorkshops, fabrics, setFabrics, fabricColorsRaw, setFabricColors, fabricColors, fabricTransactions, setFabricTransactions, models, setModels, requirements, setRequirements, accessories, setAccessories, accessoryTypes, setAccessoryTypes, accessoryItemsRaw, setAccessoryItems, accessoryItems, accessoryTransactions, setAccessoryTransactions, purchaseRequests, setPurchaseRequests, cuttingRecords, setCuttingRecords, qcRecords, setQcRecords, printDispatches, setPrintDispatches, sewingDispatches, setSewingDispatches, packagingRequirements, setPackagingRequirements, finishingRecords, setFinishingRecords, assemblyStageRecords, setAssemblyStageRecords, workshopEvaluations, setWorkshopEvaluations, submitWorkshopEvaluation, packagingMaterialRules, setPackagingMaterialRules, internalMessages, setInternalMessages, auditLogs, setAuditLogs, flashMessages, setFlashMessages, readNotificationIds, setReadNotificationIds, snoozedNotifications, setSnoozedNotifications, designModelIdsSet, removeFlashMessage, addFlashMessage, refreshState, login, logout, logAction, updateGlobalSettings, formatSupplierWhatsappMessage, openWhatsAppOrder, addModelTimelineEvent, sendInternalMessage, markMessageRead, normalizePartKey, getModelParts, getModelColorList, getModelSizeList, getPackagingRequirement, getPartStages, isPackagingReady };
  const permHelpers = buildPermissionHelpers(baseCtx);
  const { getUserPermissionsObject, hasSpecificPermission, hasPermission, ASSEMBLY_ACCESS_KEYS, hasAssemblyPackagingAccess, canManagePermissions, canManageUsers, canManageSuppliers, canManageSizes, canViewAuditLogs, canViewGlobalSettings, canEditHeaderSettings, canEditMessageTemplates, canAccessSettings, isCurrentUserSudo, canAccessHRSection, canManageHR, canAccessReadinessStage, canAccessAnyReadiness, canViewPreviousModels, canCustomizeNavigation, currentUserRank, visibleRankLevels, visibleRankOptions, rankLabelFor, isRankVisibleToActor, clampRankToVisible, getEffectiveDelegatablePermissions, canDelegatePermission, getRoleEnabledPermissionKeys, isRoleAssignable, getCreatedDescendants, canAddDesignNotes, canAddCuttingNotes, canAddQCBeforePrintNotes, canAddQCAfterPrintNotes, canAddSewingNotes, canAddPrintingNotes, canViewFabricPrices, canEditFabricPrices, canViewAccessoryPrices, canEditAccessoryPrices, canViewPrintingPrices, canEditPrintingPrices, canViewPrintingCosts, canEditPrintingCosts, canViewSewingPrices, canEditSewingPrices, canViewAssemblyPrices, canEditAssemblyPrices, canSendWhatsApp, canSendMessages } = permHelpers;
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

  const ctxWithPerms: any = { ...baseCtx, ...permHelpers, addRole, updateRole, deleteRole };
  const designActions = buildDesignActions(ctxWithPerms);
  const { addDesignModel, cloneDesignModel, updateModelPlan, updateModelNotesAndTarget, updateDesignModelBasicInfo, addModelRequirement, deleteModelRequirement, addModelAccessory, deleteModelAccessory, issueFabricToCutting, returnFabricFromCutting, deleteDesignModel } = designActions;
  const fullCtx: any = { ...ctxWithPerms, ...designActions };
  const { addFabricOrColor, recordTransaction, exportWarehouseInventoryCsv, updateColorPrice, updateFabricColorDetails, addAccessoryType, addAccessoryItem, updateAccessoryItem, deleteAccessoryItem, markAccessoryWithdrawn, recordAccessoryTransaction, exportAccessoryInventoryCsv, issueModelAccessories, addPurchaseRequest, updatePurchaseRequest, deletePurchaseRequest, markPurchaseRequestPurchased, exportPurchaseRequestsCsv } = buildWarehouseActions(fullCtx);
  const { addCuttingRecord, updateCuttingRecord, deleteCuttingRecord, finishCuttingToQC, exportCuttingCsv, recordQCData, saveQCMatrix, recordQCStageCount, finishQCApproval, exportQcCsv } = buildCuttingQcActions(fullCtx);
  const { modelCodeOf, exportDesignModelsCsv, exportFabricTransactionsCsv, exportAccessoryTransactionsCsv, exportProductionWarehouseCsv, exportPrintDispatchesCsv, exportSewingDispatchesCsv, exportAssemblyPackagingCsv, exportPackagingMaterialsCsv, exportSuppliersCsv, exportWorkshopsCsv, exportAuditLogsCsv, buildHRSectionsSheets, exportHRSectionsZip, exportFullBackupZip } = buildExportActions(fullCtx);
  const { addPrintDispatch, updateDispatchStatus, skipPrintToSewing, dispatchModelToSewing, receiveModelFromSewing, finishSewingToQC, finishQCToProduction } = buildPrintSewingActions(fullCtx);
  const { setPackagingStep, startFinishing, receiveFinishing, startIroning, receiveIroning, ASSEMBLY_STAGE_STATUS_MAP, ASSEMBLY_STAGE_NEXT_STATUS_MAP, startAssemblyStage, receiveAssemblyStage, savePackagingMaterialRule, deletePackagingMaterialRule, recordPackagingMaterialTransaction } = buildAssemblyActions(fullCtx);
  const { addSizeDef, addSupplier, updateSizeDef, deleteSizeDef, updateSupplier, deleteSupplier, addWorkshop, updateWorkshop, deleteWorkshop, addUser, toggleUserActive, updateUserPermissionsAndPassword, deleteUser, markNotificationRead, snoozeNotification, clearSnoozedNotifications } = buildSettingsUsersActions(fullCtx);
  const appNotifications = useMemo<AppNotification[]>(() => buildAppNotifications({ printDispatches, sewingDispatches, finishingRecords, assemblyStageRecords, packagingMaterialRules, models, readNotificationIds }), [printDispatches, sewingDispatches, finishingRecords, assemblyStageRecords, packagingMaterialRules, models, readNotificationIds]);

  const visibleAppNotifications = useMemo<AppNotification[]>(() => {
    const isSudo =
      Boolean(currentUser?.is_sudo) || currentUser?.username?.toLowerCase() === 'sudo';
    const now = Date.now();
    return appNotifications.filter((notif) => {
      const until = snoozedNotifications[notif.id];
      if (until && new Date(until).getTime() > now) return false;
      if (isSudo) return true;
      if (!notif.permission_key) return true;
      return hasPermission(notif.permission_key as SystemSectionKey);
    });
  }, [appNotifications, snoozedNotifications, currentUser, roles]);

  const unreadNotificationsCount = useMemo(() => {
    return visibleAppNotifications.filter(
      (n) => n.urgency === 'overdue' || n.urgency === 'critical' || !n.is_read
    ).length;
  }, [visibleAppNotifications]);

  /** عدد التنبيهات المؤجلة حالياً (تأجيل لم ينتهِ بعد) — لعرض زر «استعادة». */
  const snoozedNotificationsCount = useMemo(() => {
    const now = Date.now();
    return appNotifications.filter((n) => {
      const until = snoozedNotifications[n.id];
      return Boolean(until) && new Date(until as string).getTime() > now;
    }).length;
  }, [appNotifications, snoozedNotifications]);

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
        openWhatsAppOrder,
        users,
        onlineUsers,
        roles,
        auditLogs,
        sizeDefs,
        suppliers,
        workshops,
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
        workshopEvaluations,
        submitWorkshopEvaluation,
        packagingMaterialRules,
        savePackagingMaterialRule,
        recordPackagingMaterialTransaction,
        deletePackagingMaterialRule,
        appNotifications: visibleAppNotifications,
        unreadNotificationsCount,
        markNotificationRead,
        snoozeNotification,
        clearSnoozedNotifications,
        snoozedNotificationsCount,
        flashMessages,
        addFlashMessage,
        removeFlashMessage,
        addRole,
        updateRole,
        deleteRole,
        hasPermission,
        hasSpecificPermission,
        getEffectiveDelegatablePermissions,
        canDelegatePermission,
        getRoleEnabledPermissionKeys,
        isRoleAssignable,
        getCreatedDescendants,
        hasAssemblyPackagingAccess,
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
        canAccessReadinessStage,
        canAccessAnyReadiness,
        canViewPreviousModels,
        canCustomizeNavigation,
        uiPreferences,
        setSidebarCollapsed,
        updateUiPreferences,
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
        canViewPrintingPrices,
        canEditPrintingPrices,
        canViewPrintingCosts,
        canEditPrintingCosts,
        canViewSewingPrices,
        canEditSewingPrices,
        canViewAssemblyPrices,
        canEditAssemblyPrices,
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
        updateFabricColorDetails,
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
        issueModelAccessories,
        purchaseRequests,
        addPurchaseRequest,
        updatePurchaseRequest,
        deletePurchaseRequest,
        markPurchaseRequestPurchased,
        exportPurchaseRequestsCsv,
        addDesignModel,
        cloneDesignModel,
        updateModelPlan,
        updateModelNotesAndTarget,
        updateDesignModelBasicInfo,
        addModelRequirement,
        deleteModelRequirement,
        addModelAccessory,
        deleteModelAccessory,
        issueFabricToCutting,
        returnFabricFromCutting,
        deleteDesignModel,
        addCuttingRecord,
        updateCuttingRecord,
        deleteCuttingRecord,
        finishCuttingToQC,
        exportCuttingCsv,
        getModelParts,
        normalizePartKey,
        getModelColorList,
        getModelSizeList,
        recordQCData,
        addQCRecord: recordQCData,
        saveQCMatrix,
        recordQCStageCount,
        finishQCApproval,
        exportQcCsv,
        exportDesignModelsCsv,
        exportFabricTransactionsCsv,
        exportAccessoryTransactionsCsv,
        exportProductionWarehouseCsv,
        exportPrintDispatchesCsv,
        exportSewingDispatchesCsv,
        exportAssemblyPackagingCsv,
        exportPackagingMaterialsCsv,
        exportSuppliersCsv,
        exportWorkshopsCsv,
        exportAuditLogsCsv,
        exportFullBackupZip,
        exportHRSectionsZip,
        addPrintDispatch,
        updateDispatchStatus,
        skipPrintToSewing,
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
        startIroning,
        receiveIroning,
        getPartStages,
        isPackagingReady,
        addSizeDef,
        updateSizeDef,
        deleteSizeDef,
        addSupplier,
        updateSupplier,
        deleteSupplier,
        addWorkshop,
        updateWorkshop,
        deleteWorkshop,
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