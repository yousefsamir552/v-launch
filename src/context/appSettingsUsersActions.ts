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

export const buildSettingsUsersActions = (ctx: AppInternalContext) => {
  const {
    currentUser, setCurrentUser, setCurrentUserState, isLoadingState, setIsLoadingState, globalSettings, setGlobalSettings, roles, setRoles, users, setUsers, onlineUsers, setOnlineUsers, sizeDefs, setSizeDefs, suppliers, setSuppliers, workshops, setWorkshops, fabrics, setFabrics, fabricColorsRaw, setFabricColors, fabricColors, fabricTransactions, setFabricTransactions, models, setModels, requirements, setRequirements, accessories, setAccessories, accessoryTypes, setAccessoryTypes, accessoryItemsRaw, setAccessoryItems, accessoryItems, accessoryTransactions, setAccessoryTransactions, cuttingRecords, setCuttingRecords, qcRecords, setQcRecords, printDispatches, setPrintDispatches, sewingDispatches, setSewingDispatches, packagingRequirements, setPackagingRequirements, finishingRecords, setFinishingRecords, assemblyStageRecords, setAssemblyStageRecords, packagingMaterialRules, setPackagingMaterialRules, internalMessages, setInternalMessages, auditLogs, setAuditLogs, flashMessages, setFlashMessages, readNotificationIds, setReadNotificationIds, snoozedNotifications, setSnoozedNotifications, designModelIdsSet, removeFlashMessage, addFlashMessage, refreshState, login, logout, logAction, updateGlobalSettings, formatSupplierWhatsappMessage, openWhatsAppOrder, addModelTimelineEvent, addRole, updateRole, deleteRole, sendInternalMessage, markMessageRead, normalizePartKey, getModelParts, getModelColorList, getModelSizeList, getPackagingRequirement, getPartStages, isPackagingReady, getUserPermissionsObject, hasSpecificPermission, hasPermission, hasAssemblyPackagingAccess, canManagePermissions, canManageUsers, canManageSuppliers, canManageSizes, canViewAuditLogs, canViewGlobalSettings, canEditHeaderSettings, canEditMessageTemplates, canAccessSettings, isCurrentUserSudo, canAccessHRSection, canManageHR, currentUserRank, visibleRankLevels, visibleRankOptions, rankLabelFor, isRankVisibleToActor, clampRankToVisible, getEffectiveDelegatablePermissions, canDelegatePermission, getRoleEnabledPermissionKeys, isRoleAssignable, getCreatedDescendants, canAddDesignNotes, canAddCuttingNotes, canAddQCBeforePrintNotes, canAddQCAfterPrintNotes, canAddSewingNotes, canAddPrintingNotes, canViewFabricPrices, canEditFabricPrices, canViewAccessoryPrices, canEditAccessoryPrices, canViewPrintingPrices, canEditPrintingPrices, canViewPrintingCosts, canEditPrintingCosts, canViewSewingPrices, canEditSewingPrices, canViewAssemblyPrices, canEditAssemblyPrices, canSendWhatsApp, canSendMessages, addModelAccessory
  } = ctx;

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

  const addSupplier = (name: string, phone: string, whatsappGroupLink?: string) => {
    const newSup: Supplier = {
      id: 'sup-' + Date.now(),
      name: name.trim(),
      phone: phone.trim(),
      whatsapp_group_link: (whatsappGroupLink || '').trim()
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

  const updateSupplier = (id: string, name: string, phone: string, whatsappGroupLink?: string) => {
    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    const cleanGroup = (whatsappGroupLink || '').trim();
    if (!cleanName) return;

    setSuppliers((prev) =>
      prev.map((s) =>
        s.id === id
          ? { ...s, name: cleanName, phone: cleanPhone, whatsapp_group_link: cleanGroup }
          : s
      )
    );
    api
      .updateSupplier(id, {
        name: cleanName,
        phone: cleanPhone,
        whatsapp_group_link: cleanGroup
      })
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
  const addWorkshop = (data: {
    name: string;
    phone: string;
    whatsappGroupLink?: string;
    workshopType: WorkshopType[];
    notes?: string;
  }) => {
    const cleanName = data.name.trim();
    if (!cleanName) {
      addFlashMessage('يرجى إدخال اسم الورشة', 'danger');
      return;
    }
    const newWorkshop: Workshop = {
      id: 'wrk-' + Date.now(),
      name: cleanName,
      phone: (data.phone || '').trim(),
      whatsapp_group_link: (data.whatsappGroupLink || '').trim(),
      workshop_type: data.workshopType,
      notes: (data.notes || '').trim()
    };
    setWorkshops((prev) => [...prev, newWorkshop]);
    api
      .createWorkshop(newWorkshop)
      .then((saved) => {
        setWorkshops((prev) => prev.map((w) => (w.id === newWorkshop.id ? saved : w)));
        logAction('الإعدادات', `إضافة ورشة/مطبعة: ${cleanName}`);
        addFlashMessage('تمت إضافة الورشة بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل حفظ الورشة في الباك إند', 'danger');
      });
  };

  const updateWorkshop = (
    id: string,
    data: {
      name: string;
      phone: string;
      whatsappGroupLink?: string;
      workshopType: WorkshopType[];
      notes?: string;
    }
  ) => {
    const cleanName = data.name.trim();
    if (!cleanName) {
      addFlashMessage('يرجى إدخال اسم الورشة', 'danger');
      return;
    }
    const cleanPhone = (data.phone || '').trim();
    const cleanGroup = (data.whatsappGroupLink || '').trim();
    const cleanNotes = (data.notes || '').trim();

    setWorkshops((prev) =>
      prev.map((w) =>
        w.id === id
          ? {
              ...w,
              name: cleanName,
              phone: cleanPhone,
              whatsapp_group_link: cleanGroup,
              workshop_type: data.workshopType,
              notes: cleanNotes
            }
          : w
      )
    );
    api
      .updateWorkshop(id, {
        name: cleanName,
        phone: cleanPhone,
        whatsapp_group_link: cleanGroup,
        workshop_type: data.workshopType,
        notes: cleanNotes
      })
      .then((saved) => {
        setWorkshops((prev) => prev.map((w) => (w.id === id ? saved : w)));
        logAction('الإعدادات', `تعديل بيانات الورشة: ${cleanName}`);
        addFlashMessage('تم تحديث بيانات الورشة بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تعديل الورشة في الباك إند', 'danger');
      });
  };

  const deleteWorkshop = (id: string) => {
    const target = workshops.find((w) => w.id === id);
    setWorkshops((prev) => prev.filter((w) => w.id !== id));
    api
      .deleteWorkshop(id)
      .then(() => {
        logAction('الإعدادات', `حذف الورشة: ${target?.name || id}`);
        addFlashMessage('تم حذف الورشة بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل حذف الورشة من الباك إند', 'danger');
      });
  };



  const addUser = async (userData: Omit<User, 'id'>): Promise<boolean> => {
    if (userData.username.trim().toLowerCase() === 'sudo') {
      addFlashMessage('اسم المستخدم هذا محجوز للنظام ولا يمكن استخدامه', 'danger');
      return false;
    }
    // حماية الرتب: لا يمكن منح رتبة مساوية أو أعلى من رتبة المستخدم الحالي.
    const safeRank = clampRankToVisible(userData.rank_level);

    // لا إضافة وهمية (No Optimistic Update): ننتظر استجابة السيرفر ونضيف
    // الحساب الحقيقي المحفوظ في قاعدة البيانات فقط بعد نجاح الطلب.
    try {
      const saved = await api.createUser({
        ...userData,
        rank_level: safeRank,
        is_sudo: false
      });
      setUsers((prev) => [...prev, saved]);
      logAction('إدارة الحسابات', `إنشاء حساب جديد للموظف: ${saved.username || userData.username}`);
      addFlashMessage(
        `تم إنشاء حساب جديد للموظف ${saved.real_name || userData.real_name} وحفظه في قاعدة البيانات`
      );
      return true;
    } catch (err: any) {
      // عند أي خطأ من السيرفر (مثل تكرار username) لا نمسح أو نعدّل أي حسابات.
      addFlashMessage(err?.message || 'فشل إنشاء الحساب في الباك إند', 'danger');
      return false;
    }
  };

  const toggleUserActive = (userId: string, cascade = false) => {
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
      .toggleUserActive(userId, cascade)
      .then((saved) => {
        setUsers((prev) => prev.map((u) => (u.id === userId ? saved : u)));
        if (cascade) {
          const affectedIds: string[] = Array.isArray(saved?.affected_user_ids)
            ? saved.affected_user_ids
            : [];
          const cascadeState = typeof saved?.is_active === 'boolean' ? saved.is_active : nextState;
          setUsers((prev) =>
            prev.map((u) =>
              affectedIds.includes(u.id) ? { ...u, is_active: cascadeState } : u
            )
          );
        }
        logAction('إدارة الحسابات', `${actText} حساب المستخدم: ${targetUser.username}`);
        addFlashMessage(
          cascade
            ? `تم ${actText} الحساب وجميع الحسابات التي أنشأها بنجاح`
            : `تم ${actText} الحساب بنجاح`
        );
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
    newRank?: number,
    delegatablePermissions?: string[]
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
          ...(delegatablePermissions !== undefined
            ? { delegatable_permissions: [...delegatablePermissions] }
            : {}),
          ...(newRole ? { role: newRole } : {}),
          ...(roleId ? { role_id: roleId } : {}),
          ...(safeNewRank !== undefined ? { rank_level: safeNewRank } : {})
        };
      })
    );

    api
      .updateUser(userId, {
        permissions,
        ...(delegatablePermissions !== undefined
          ? { delegatable_permissions: delegatablePermissions }
          : {}),
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

  const deleteUser = (userId: string, cascade = false) => {
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
    const descendants = cascade ? getCreatedDescendants(userId) : [];
    const removedIds = new Set<string>([userId, ...descendants.map((d) => d.id)]);
    const previousUsers = [...users];
    setUsers((prev) => prev.filter((u) => !removedIds.has(u.id)));
    api
      .deleteUser(userId, cascade)
      .then(() => {
        logAction('إدارة الحسابات', `حذف المستخدم: ${target.username}`);
        const extra = descendants.length > 0 ? ` و${descendants.length} حساب أنشأها` : '';
        addFlashMessage(
          `تم حذف المستخدم ${target.real_name}${extra} نهائياً من قاعدة البيانات`
        );
      })
      .catch((err) => {
        setUsers(previousUsers);
        addFlashMessage(err.message || 'فشل حذف المستخدم من الباك إند', 'danger');
      });
    return { success: true, message: 'تم الحذف بنجاح' };
  };

  const markNotificationRead = (id: string) => {
    setReadNotificationIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    api.markNotificationRead(id).then((res) => {
      if (res && Array.isArray(res.readIds)) {
        setReadNotificationIds(res.readIds);
      }
    }).catch(() => {});
  };

  /** Snoozes a notification for N hours: it disappears from the bell/dashboard until then (persisted in DB). */
  const snoozeNotification = (id: string, hours: SnoozeHours) => {
    const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    setSnoozedNotifications((prev) => ({ ...prev, [id]: until }));
    api.snoozeNotification(id, hours).then((res) => {
      if (res && res.snoozed && typeof res.snoozed === 'object') {
        setSnoozedNotifications(res.snoozed);
      }
    }).catch(() => {});
  };

  /** Clears every snooze (useful from the bell's "restore all" button, persisted in DB). */
  const clearSnoozedNotifications = () => {
    setSnoozedNotifications({});
    api.clearSnoozedNotifications().catch(() => {});
  };


  return {
    addSizeDef,
    addSupplier,
    updateSizeDef,
    deleteSizeDef,
    updateSupplier,
    deleteSupplier,
    addWorkshop,
    updateWorkshop,
    deleteWorkshop,
    addUser,
    toggleUserActive,
    updateUserPermissionsAndPassword,
    deleteUser,
    markNotificationRead,
    snoozeNotification,
    clearSnoozedNotifications
  };
};
