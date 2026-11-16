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
  PartStage,
  PART_STAGE_LABELS,
  PART_STAGE_ORDER,
  MODEL_STATUS_TO_PART_STAGE,
  deriveStatusFromStages,
  SnoozeHours,
  SNOOZED_NOTIFICATIONS_STORAGE_KEY
} from '../types';
import { buildPackagingDemandMap } from '../utils/packagingMaterials';
import { finishedSetsOf, photographyOutstandingOf } from '../utils/completedModels';
import { exportCsv, exportZipCsv, datedFileName, CsvValue, CsvSheet } from '../utils/exportExcel';

/**
 * ربط مرحلة التنبيه بمفتاح الصلاحية المطلوبة لرؤيته.
 * التنبيهات لا تظهر إلا لمن يملك صلاحية القسم — حساب sudo يرى كل شيء.
 */
import { NOTIFICATION_STAGE_PERMISSION, FlashMessage, modelPartsOf, seedModelPartStages, patchModelPartStage, patchModelPartsStage, DEFAULT_GLOBAL_SETTINGS, DESIGN_STAGES, PRE_PRODUCTION_STAGES, auditHeadersForModel, AppInternalContext } from './appContextTypes';

export const buildPermissionHelpers = (ctx: AppInternalContext) => {
  const {
    currentUser, setCurrentUser, setCurrentUserState, isLoadingState, setIsLoadingState, globalSettings, setGlobalSettings, roles, setRoles, users, setUsers, onlineUsers, setOnlineUsers, sizeDefs, setSizeDefs, suppliers, setSuppliers, workshops, setWorkshops, fabrics, setFabrics, fabricColorsRaw, setFabricColors, fabricColors, fabricTransactions, setFabricTransactions, models, setModels, requirements, setRequirements, accessories, setAccessories, accessoryTypes, setAccessoryTypes, accessoryItemsRaw, setAccessoryItems, accessoryItems, accessoryTransactions, setAccessoryTransactions, cuttingRecords, setCuttingRecords, qcRecords, setQcRecords, printDispatches, setPrintDispatches, sewingDispatches, setSewingDispatches, packagingRequirements, setPackagingRequirements, finishingRecords, setFinishingRecords, assemblyStageRecords, setAssemblyStageRecords, packagingMaterialRules, setPackagingMaterialRules, internalMessages, setInternalMessages, auditLogs, setAuditLogs, flashMessages, setFlashMessages, readNotificationIds, setReadNotificationIds, snoozedNotifications, setSnoozedNotifications, designModelIdsSet, removeFlashMessage, addFlashMessage, refreshState, login, logout, logAction, updateGlobalSettings, formatSupplierWhatsappMessage, openWhatsAppOrder, addModelTimelineEvent, addRole, updateRole, deleteRole, sendInternalMessage, markMessageRead, normalizePartKey, getModelParts, getModelColorList, getModelSizeList, getPackagingRequirement, getPartStages, isPackagingReady, addModelAccessory
  } = ctx;

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
        view_printing_prices: true,
        edit_printing_prices: true,
        view_sewing_prices: true,
        edit_sewing_prices: true,
        view_assembly_prices: true,
        edit_assembly_prices: true,
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
        hr_reports: true,
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

    // توافقية مع الأسماء القديمة المحفوظة في كاش المتصفح (تكاليف → أسعار).
    const LEGACY_PERM_ALIASES: Record<string, string> = {
      view_printing_costs: 'view_printing_prices',
      edit_printing_costs: 'edit_printing_prices'
    };
    const canonicalKey = LEGACY_PERM_ALIASES[String(permKey)] || String(permKey);
    const legacyKeys = Object.keys(LEGACY_PERM_ALIASES).filter(
      (legacy) => LEGACY_PERM_ALIASES[legacy] === canonicalKey
    );

    // 1. Check user-level custom_permissions first
    const userCustom = currentUser.permissions as Record<string, any> | undefined;
    if (userCustom) {
      for (const key of [canonicalKey, ...legacyKeys]) {
        if (key in userCustom && userCustom[key] !== undefined) {
          const val = userCustom[key];
          if (typeof val === 'string') return val === 'edit' || val === 'view' || val === 'true';
          return Boolean(val);
        }
      }
    }

    // 2. Check role permissions
    const rolePerms = getUserPermissionsObject();
    if (rolePerms) {
      for (const key of [canonicalKey, ...legacyKeys]) {
        if (key in rolePerms) {
          return Boolean((rolePerms as any)[key]);
        }
      }
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

  // مفاتيح صلاحية "الأسمبلي والأمبالاج" المعتمدة: المفتاح الرئيسي الحالي + أي قيمة
  // قديمة/بديلة محفوظة سابقاً (assembly / packaging) + الصلاحيات الفرعية للقسم.
  // الهدف: ألا يختفي الزر أو تتعطل الحسابات المحفوظة قبل توحيد المفتاح.
  const ASSEMBLY_ACCESS_KEYS = [
    'assembly_packaging',
    'assembly',
    'packaging',
    'finishing',
    'ironing',
    'dest',
    'materials'
  ];

  const hasAssemblyPackagingAccess = (requireEdit: boolean = false): boolean => {
    if (!currentUser) return false;
    if (currentUser.username?.toLowerCase() === 'sudo' || currentUser.is_sudo) return true;

    const rolePerms = getUserPermissionsObject() as Record<string, any> | null;
    const userCustom = currentUser.permissions as Record<string, any> | undefined;

    const valueGrantsAccess = (val: any): boolean => {
      if (typeof val === 'string') {
        if (requireEdit) return val === 'edit';
        return val === 'view' || val === 'edit' || val === 'true';
      }
      if (requireEdit) return false;
      return Boolean(val);
    };

    return ASSEMBLY_ACCESS_KEYS.some((key) => {
      const viewKey = `${key}_view`;
      const editKey = `${key}_edit`;

      // 1) الصلاحيات المدمجة (دور + تخصيص المستخدم) بصيغة _view / _edit
      if (rolePerms) {
        if (requireEdit && Boolean(rolePerms[editKey])) return true;
        if (!requireEdit && (Boolean(rolePerms[viewKey]) || Boolean(rolePerms[editKey]))) return true;
      }

      // 2) المفاتيح القديمة المخزنة كنص مباشر (Bare) داخل تخصيص المستخدم
      if (userCustom && key in userCustom && userCustom[key] !== undefined) {
        return valueGrantsAccess(userCustom[key]);
      }

      // 3) المفاتيح القديمة المخزنة كنص مباشر داخل صلاحيات الدور
      if (rolePerms && key in rolePerms && rolePerms[key] !== undefined) {
        return valueGrantsAccess(rolePerms[key]);
      }

      return false;
    });
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

  // أي صلاحية من صلاحيات HR المستقلة تفتح القسم العام.
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

  // -------------------------------------------------------------------------
  // Privilege Delegation (تفويض الصلاحيات)
  // كل صلاحية "شخصية فقط" افتراضياً ولا يمكن منحها للغير إلا إذا أُدرجت صراحةً
  // في قائمة التفويض الخاصة بالمدير (أو كان الحساب sudo).
  // -------------------------------------------------------------------------
  const getEffectiveDelegatablePermissions = (): string[] | null => {
    if (isCurrentUserSudo()) return null; // sudo يملك حق تفويض كل شيء
    const keys = new Set<string>();
    (currentUser?.delegatable_permissions || []).forEach((key) => {
      if (key) keys.add(String(key));
    });
    const ownRole = roles.find(
      (r) => (currentUser?.role_id && r.id === currentUser.role_id) || r.name === currentUser?.role
    );
    (ownRole?.delegatable_permissions || []).forEach((key) => {
      if (key) keys.add(String(key));
    });
    return Array.from(keys);
  };

  const canDelegatePermission = (permKey: string): boolean => {
    const allowed = getEffectiveDelegatablePermissions();
    if (allowed === null) return true;
    return allowed.includes(String(permKey));
  };

  const getRoleEnabledPermissionKeys = (role: CustomRole | null | undefined): string[] => {
    if (!role || !role.permissions) return [];
    return Object.entries(role.permissions)
      .filter(([, value]) => {
        if (typeof value === 'string') {
          return ['view', 'edit', 'true', '1', 'yes'].includes(value.toLowerCase());
        }
        return Boolean(value);
      })
      .map(([key]) => key);
  };

  const isRoleAssignable = (role: CustomRole | null | undefined): boolean => {
    if (!role) return false;
    const allowed = getEffectiveDelegatablePermissions();
    if (allowed === null) return true; // sudo
    const requiredKeys = [
      ...getRoleEnabledPermissionKeys(role),
      ...(role.delegatable_permissions || [])
    ];
    return requiredKeys.every((key) => allowed.includes(String(key)));
  };

  const getCreatedDescendants = (userId: string): User[] => {
    const byCreator = new Map<string, User[]>();
    users.forEach((u) => {
      if (!u.created_by) return;
      const key = String(u.created_by);
      const bucket = byCreator.get(key);
      if (bucket) bucket.push(u);
      else byCreator.set(key, [u]);
    });
    const result: User[] = [];
    const seen = new Set<string>([userId]);
    const queue: string[] = [userId];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      (byCreator.get(current) || []).forEach((child) => {
        if (seen.has(child.id)) return;
        seen.add(child.id);
        result.push(child);
        queue.push(child.id);
      });
    }
    return result;
  };

  // Department Notes Permission Checkers (Task 4)
  const canAddDesignNotes = (): boolean => hasSpecificPermission('can_add_design_notes');
  const canAddCuttingNotes = (): boolean => hasSpecificPermission('can_add_cutting_notes');
  const canAddQCBeforePrintNotes = (): boolean => hasSpecificPermission('can_add_qc_before_print_notes');
  const canAddQCAfterPrintNotes = (): boolean => hasSpecificPermission('can_add_qc_after_print_notes');
  const canAddSewingNotes = (): boolean => hasSpecificPermission('can_add_sewing_notes');
  const canAddPrintingNotes = (): boolean => hasSpecificPermission('can_add_printing_notes');

  // Financial & Communication Permission Checkers (صلاحية مستقلة لكل قسم)
  const canViewFabricPrices = (): boolean => hasSpecificPermission('view_fabric_prices');
  const canEditFabricPrices = (): boolean => hasSpecificPermission('edit_fabric_prices');
  const canViewAccessoryPrices = (): boolean => hasSpecificPermission('view_accessory_prices');
  const canEditAccessoryPrices = (): boolean => hasSpecificPermission('edit_accessory_prices');
  const canViewPrintingPrices = (): boolean => hasSpecificPermission('view_printing_prices');
  const canEditPrintingPrices = (): boolean => hasSpecificPermission('edit_printing_prices');
  // أسماء قديمة محفوظة للتوافق مع المكونات السابقة.
  const canViewPrintingCosts = canViewPrintingPrices;
  const canEditPrintingCosts = canEditPrintingPrices;
  const canViewSewingPrices = (): boolean => hasSpecificPermission('view_sewing_prices');
  const canEditSewingPrices = (): boolean => hasSpecificPermission('edit_sewing_prices');
  const canViewAssemblyPrices = (): boolean => hasSpecificPermission('view_assembly_prices');
  const canEditAssemblyPrices = (): boolean => hasSpecificPermission('edit_assembly_prices');
  const canSendWhatsApp = (): boolean => hasSpecificPermission('send_whatsapp_requests');
  const canSendMessages = (): boolean => hasSpecificPermission('send_internal_messages');


  return {
    getUserPermissionsObject,
    hasSpecificPermission,
    hasPermission,
    ASSEMBLY_ACCESS_KEYS,
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
    isCurrentUserSudo,
    canAccessHRSection,
    canManageHR,
    currentUserRank,
    visibleRankLevels,
    visibleRankOptions,
    rankLabelFor,
    isRankVisibleToActor,
    clampRankToVisible,
    getEffectiveDelegatablePermissions,
    canDelegatePermission,
    getRoleEnabledPermissionKeys,
    isRoleAssignable,
    getCreatedDescendants,
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
    canSendMessages
  };
};
