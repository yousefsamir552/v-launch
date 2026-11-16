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

export const buildWarehouseActions = (ctx: AppInternalContext) => {
  const {
    currentUser, setCurrentUser, setCurrentUserState, isLoadingState, setIsLoadingState, globalSettings, setGlobalSettings, roles, setRoles, users, setUsers, onlineUsers, setOnlineUsers, sizeDefs, setSizeDefs, suppliers, setSuppliers, workshops, setWorkshops, fabrics, setFabrics, fabricColorsRaw, setFabricColors, fabricColors, fabricTransactions, setFabricTransactions, models, setModels, requirements, setRequirements, accessories, setAccessories, accessoryTypes, setAccessoryTypes, accessoryItemsRaw, setAccessoryItems, accessoryItems, accessoryTransactions, setAccessoryTransactions, cuttingRecords, setCuttingRecords, qcRecords, setQcRecords, printDispatches, setPrintDispatches, sewingDispatches, setSewingDispatches, packagingRequirements, setPackagingRequirements, finishingRecords, setFinishingRecords, assemblyStageRecords, setAssemblyStageRecords, packagingMaterialRules, setPackagingMaterialRules, internalMessages, setInternalMessages, auditLogs, setAuditLogs, flashMessages, setFlashMessages, readNotificationIds, setReadNotificationIds, snoozedNotifications, setSnoozedNotifications, designModelIdsSet, removeFlashMessage, addFlashMessage, refreshState, login, logout, logAction, updateGlobalSettings, formatSupplierWhatsappMessage, openWhatsAppOrder, addModelTimelineEvent, addRole, updateRole, deleteRole, sendInternalMessage, markMessageRead, normalizePartKey, getModelParts, getModelColorList, getModelSizeList, getPackagingRequirement, getPartStages, isPackagingReady, getUserPermissionsObject, hasSpecificPermission, hasPermission, hasAssemblyPackagingAccess, canManagePermissions, canManageUsers, canManageSuppliers, canManageSizes, canViewAuditLogs, canViewGlobalSettings, canEditHeaderSettings, canEditMessageTemplates, canAccessSettings, isCurrentUserSudo, canAccessHRSection, canManageHR, currentUserRank, visibleRankLevels, visibleRankOptions, rankLabelFor, isRankVisibleToActor, clampRankToVisible, getEffectiveDelegatablePermissions, canDelegatePermission, getRoleEnabledPermissionKeys, isRoleAssignable, getCreatedDescendants, canAddDesignNotes, canAddCuttingNotes, canAddQCBeforePrintNotes, canAddQCAfterPrintNotes, canAddSewingNotes, canAddPrintingNotes, canViewFabricPrices, canEditFabricPrices, canViewAccessoryPrices, canEditAccessoryPrices, canViewPrintingPrices, canEditPrintingPrices, canViewPrintingCosts, canEditPrintingCosts, canViewSewingPrices, canEditSewingPrices, canViewAssemblyPrices, canEditAssemblyPrices, canSendWhatsApp, canSendMessages, addModelAccessory
  } = ctx;

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
    const showPrices = canViewFabricPrices();
    const headers: CsvValue[] = [
      'الخامة',
      'كود اللون',
      'اسم اللون',
      'الكمية الفعلية',
      'الكمية المحجوزة',
      'المتاح للتصميم',
      'الوحدة',
      ...(showPrices ? ['سعر الوحدة', 'إجمالي القيمة'] : [])
    ];
    const rows: CsvValue[][] = fabricColors.map((color) => {
      const fabric = fabrics.find((f) => f.id === color.fabric_id);
      const available = Number((color.quantity - color.reserved_quantity).toFixed(2));
      const unitPrice = color.price_per_unit ?? 0;
      return [
        fabric?.name || 'غير معروف',
        color.color_code,
        color.color_name || '-',
        color.quantity,
        color.reserved_quantity,
        available,
        fabric?.unit || 'كيلو',
        ...(showPrices ? [unitPrice, Number((unitPrice * color.quantity).toFixed(2))] : [])
      ];
    });

    exportCsv(datedFileName('warehouse_inventory'), headers, rows);

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

  /**
   * تعديل بيانات لون القماش الأساسية (كود اللون، اسم اللون، درجة اللون، وسعر الوحدة).
   * يتم التحديث محلياً فوراً (Optimistic) ثم يُثبّت في الباك إند، مع الرجوع للحالة السابقة عند الفشل.
   */
  const updateFabricColorDetails = (
    colorId: string,
    updates: { color_code?: string; color_name?: string; hex_code?: string; price_per_unit?: number }
  ) => {
    const current = fabricColors.find((c) => c.id === colorId);
    if (!current) return { success: false, message: 'اللون غير موجود' };

    const payload: {
      color_code?: string;
      color_name?: string;
      hex_code?: string;
      price_per_unit?: number;
    } = {};

    if (updates.color_code !== undefined) {
      const cleanCode = updates.color_code.trim();
      if (!cleanCode) return { success: false, message: 'كود اللون مطلوب ولا يمكن تركه فارغاً' };
      const duplicate = fabricColors.find(
        (c) =>
          c.id !== colorId &&
          c.fabric_id === current.fabric_id &&
          c.color_code.trim().toLowerCase() === cleanCode.toLowerCase()
      );
      if (duplicate) {
        return { success: false, message: `كود اللون (${cleanCode}) مسجل بالفعل على نفس الخامة` };
      }
      payload.color_code = cleanCode;
    }
    if (updates.color_name !== undefined) payload.color_name = updates.color_name.trim();
    if (updates.hex_code !== undefined) payload.hex_code = updates.hex_code.trim() || '#64748b';
    if (updates.price_per_unit !== undefined) {
      payload.price_per_unit = Math.max(0, Number(updates.price_per_unit) || 0);
    }

    if (Object.keys(payload).length === 0) {
      return { success: false, message: 'لا توجد بيانات جديدة لتحديثها' };
    }

    setFabricColors((prev) => prev.map((c) => (c.id === colorId ? { ...c, ...payload } : c)));

    api
      .updateFabricColor(colorId, payload)
      .then((saved) => {
        setFabricColors((prev) =>
          prev.map((c) =>
            c.id === colorId
              ? {
                  ...c,
                  color_code: saved?.color_code ?? payload.color_code ?? c.color_code,
                  color_name: saved?.color_name ?? payload.color_name ?? c.color_name,
                  hex_code: saved?.hex_code ?? payload.hex_code ?? c.hex_code,
                  price_per_unit: saved?.price_per_unit ?? payload.price_per_unit ?? c.price_per_unit
                }
              : c
          )
        );
        const label = saved?.color_code || payload.color_code || current.color_code;
        const changedParts: string[] = [];
        if (payload.color_code !== undefined) changedParts.push(`الكود: ${payload.color_code}`);
        if (payload.color_name !== undefined) changedParts.push(`الاسم: ${payload.color_name || 'بدون'}`);
        if (payload.hex_code !== undefined) changedParts.push(`الدرجة: ${payload.hex_code}`);
        if (payload.price_per_unit !== undefined) changedParts.push(`السعر: ${payload.price_per_unit}`);
        logAction(
          'مخزن الأقمشة',
          `تعديل بيانات اللون ${label}${changedParts.length ? ` (${changedParts.join(' • ')})` : ''}`
        );
        addFlashMessage(`تم تحديث بيانات اللون ${label} بنجاح`);
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تحديث بيانات اللون في الباك إند', 'danger');
      });

    return { success: true, message: 'تم تحديث بيانات اللون بنجاح' };
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
    link_model?: {
      modelId: string;
      target_type?: 'shirt' | 'pants' | 'jacket' | 'single';
      piece_consumption?: number;
      planned_quantity?: number;
    };
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
        // الربط بالموديل يتم بعد تأكيد إنشاء الإكسسوار في الباك إند حتى يُلتقط
        // سعر الوحدة التاريخي وتُحدَّث الكميات المحجوزة بدون سباق بين الطلبين.
        if (data.link_model) {
          addModelAccessory(data.link_model.modelId, {
            id: saved?.id || newItemId,
            code: saved?.code || cleanCode,
            name: saved?.name || newItem.name,
            unit: saved?.unit || newItem.unit,
            image: saved?.image || newItem.image,
            target_type: data.link_model.target_type,
            piece_consumption: data.link_model.piece_consumption,
            planned_quantity: data.link_model.planned_quantity
          });
        }
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل إضافة الإكسسوار في الباك إند', 'danger');
      });

    return { success: true, message: 'تم الحفظ بنجاح', itemId: newItemId };
  };

  const updateAccessoryItem = (id: string, updates: Partial<AccessoryItem>) => {
    // لا يُرسل سعر الوحدة للباك إند إلا لمن يملك صلاحية تعديل أسعار الإكسسوارات،
    // حتى لا تُرفض تعديلات المخزون العادية بخطأ 403.
    const safeUpdates: Partial<AccessoryItem> = { ...updates };
    if (!canEditAccessoryPrices()) {
      delete (safeUpdates as any).price_per_unit;
    }
    setAccessoryItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...safeUpdates } : item))
    );
    api
      .updateAccessory(id, safeUpdates)
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
    const showPrices = canViewAccessoryPrices();
    const headers: CsvValue[] = [
      'التصنيف',
      'الكود',
      'الاسم',
      'النوع',
      'الرصيد الحالي',
      'المحجوز',
      'المتاح',
      'الحد الأدنى / المطلوب',
      'الوحدة',
      ...(showPrices ? ['سعر الوحدة', 'إجمالي القيمة'] : [])
    ];
    const rows: CsvValue[][] = accessoryItems.map((a) => [
      a.type_name,
      a.code,
      a.name,
      a.usage_type === 'custom_model' ? `خاص بموديل ${a.custom_model_code || ''}` : 'رصيد مستمر',
      a.quantity,
      a.reserved_quantity,
      a.quantity - a.reserved_quantity,
      a.usage_type === 'custom_model' ? a.target_quantity || a.min_threshold : a.min_threshold,
      a.unit,
      ...(showPrices
        ? [
            a.price_per_unit ?? 0,
            Number(((a.price_per_unit ?? 0) * a.quantity).toFixed(2))
          ]
        : [])
    ]);

    exportCsv(datedFileName('accessories_inventory'), headers, rows);

    logAction('مخزن الإكسسوارات', 'تصدير شيت جرد الإكسسوارات إلى إكسيل');
    addFlashMessage('تم تصدير جرد الإكسسوارات بنجاح');
  };

  // Design Actions

  return {
    addFabricOrColor,
    recordTransaction,
    exportWarehouseInventoryCsv,
    updateColorPrice,
    updateFabricColorDetails,
    addAccessoryType,
    addAccessoryItem,
    updateAccessoryItem,
    deleteAccessoryItem,
    markAccessoryWithdrawn,
    recordAccessoryTransaction,
    exportAccessoryInventoryCsv
  };
};
