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

export const buildDesignActions = (ctx: AppInternalContext) => {
  const {
    currentUser, setCurrentUser, setCurrentUserState, isLoadingState, setIsLoadingState, globalSettings, setGlobalSettings, roles, setRoles, users, setUsers, onlineUsers, setOnlineUsers, sizeDefs, setSizeDefs, suppliers, setSuppliers, workshops, setWorkshops, fabrics, setFabrics, fabricColorsRaw, setFabricColors, fabricColors, fabricTransactions, setFabricTransactions, models, setModels, requirements, setRequirements, accessories, setAccessories, accessoryTypes, setAccessoryTypes, accessoryItemsRaw, setAccessoryItems, accessoryItems, accessoryTransactions, setAccessoryTransactions, cuttingRecords, setCuttingRecords, qcRecords, setQcRecords, printDispatches, setPrintDispatches, sewingDispatches, setSewingDispatches, packagingRequirements, setPackagingRequirements, finishingRecords, setFinishingRecords, assemblyStageRecords, setAssemblyStageRecords, packagingMaterialRules, setPackagingMaterialRules, internalMessages, setInternalMessages, auditLogs, setAuditLogs, flashMessages, setFlashMessages, readNotificationIds, setReadNotificationIds, snoozedNotifications, setSnoozedNotifications, designModelIdsSet, removeFlashMessage, addFlashMessage, refreshState, login, logout, logAction, updateGlobalSettings, formatSupplierWhatsappMessage, openWhatsAppOrder, addModelTimelineEvent, addRole, updateRole, deleteRole, sendInternalMessage, markMessageRead, normalizePartKey, getModelParts, getModelColorList, getModelSizeList, getPackagingRequirement, getPartStages, isPackagingReady, getUserPermissionsObject, hasSpecificPermission, hasPermission, hasAssemblyPackagingAccess, canManagePermissions, canManageUsers, canManageSuppliers, canManageSizes, canViewAuditLogs, canViewGlobalSettings, canEditHeaderSettings, canEditMessageTemplates, canAccessSettings, isCurrentUserSudo, canAccessHRSection, canManageHR, currentUserRank, visibleRankLevels, visibleRankOptions, rankLabelFor, isRankVisibleToActor, clampRankToVisible, getEffectiveDelegatablePermissions, canDelegatePermission, getRoleEnabledPermissionKeys, isRoleAssignable, getCreatedDescendants, canAddDesignNotes, canAddCuttingNotes, canAddQCBeforePrintNotes, canAddQCAfterPrintNotes, canAddSewingNotes, canAddPrintingNotes, canViewFabricPrices, canEditFabricPrices, canViewAccessoryPrices, canEditAccessoryPrices, canViewPrintingPrices, canEditPrintingPrices, canViewPrintingCosts, canEditPrintingCosts, canViewSewingPrices, canEditSewingPrices, canViewAssemblyPrices, canEditAssemblyPrices, canSendWhatsApp, canSendMessages
  } = ctx;

  const addDesignModel = (data: {
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
  }) => {
    const cleanCode = data.modelCode.trim().toUpperCase();
    const existing = models.find((m) => !m.is_deleted && m.model_code.toUpperCase() === cleanCode);
    if (existing) {
      addFlashMessage('كود الموديل مستخدم بالفعل!', 'danger');
      return { success: false, message: 'كود الموديل مستخدم بالفعل!' };
    }

    const newModelId = 'mod-' + Date.now();
    const targetCutQty = data.targetCutQuantity || 100;
    const garmentComposition: GarmentComposition =
      data.garmentComposition || DEFAULT_GARMENT_COMPOSITION;
    const garmentParts = partsForComposition(garmentComposition);
    const allowedDesignNotes = canAddDesignNotes() ? (data.designNotes || '') : '';
    const allowedShirtNotes = canAddDesignNotes() ? (data.notesShirt || '') : '';
    const allowedPantsNotes = canAddDesignNotes() ? (data.notesPants || '') : '';
    const allowedJacketNotes = canAddDesignNotes() ? (data.notesJacket || '') : '';
    const userName = currentUser?.real_name || 'مسؤول التصميم';

    const newModel: DesignModel = {
      id: newModelId,
      model_code: cleanCode,
      model_type: data.modelType,
      size_category_id: data.sizeCategoryId,
      image:
        data.imageUrl ||
        'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500&auto=format&fit=crop&q=60',
      status: 'مرحلة التصميم',
      main_marker_url: '',
      print_marker_url: '',
      target_cut_quantity: targetCutQty,
      garment_parts: garmentParts,
      garment_composition: garmentComposition,
      design_notes: allowedDesignNotes,
      notes_shirt: allowedShirtNotes,
      notes_pants: allowedPantsNotes,
      notes_jacket: allowedJacketNotes,
      created_at: new Date().toISOString(),
      is_deleted: false,
      timeline: [
        {
          id: 'tl-' + Date.now(),
          stage: 'مرحلة التصميم',
          title: 'إنشاء الموديل الجديد',
          description: `تم إنشاء الموديل بالعدد المستهدف للقص: ${targetCutQty} قطعة${allowedDesignNotes ? ` | ملاحظات التصميم: ${allowedDesignNotes}` : ''}`,
          user_name: userName,
          timestamp: new Date().toLocaleString('ar-EG', { hour12: false }),
          details: {
            phase_type: 'design',
            model_code: cleanCode,
            model_type: data.modelType,
            target_cut_quantity: targetCutQty,
            design_notes: allowedDesignNotes,
            notes_shirt: allowedShirtNotes,
            notes_pants: allowedPantsNotes,
            notes_jacket: allowedJacketNotes,
            operator_name: userName,
            worker_notes: allowedDesignNotes || allowedShirtNotes || allowedPantsNotes || allowedJacketNotes
          }
        }
      ]
    };

    setModels((prev) => [newModel, ...prev]);
    api
      .createModel({
        id: newModelId,
        model_code: cleanCode,
        model_type: data.modelType,
        size_category_id: data.sizeCategoryId,
        image: newModel.image,
        target_cut_quantity: targetCutQty,
        garment_composition: garmentComposition,
        garment_parts: garmentParts,
        design_notes: allowedDesignNotes,
        notes_shirt: allowedShirtNotes,
        notes_pants: allowedPantsNotes,
        notes_jacket: allowedJacketNotes,
        user_name: userName
      })
      .then((saved) => {
        setModels((prev) => prev.map((m) => (m.id === newModelId ? saved : m)));
        logAction('التصميم', `إنشاء موديل جديد: ${cleanCode}`);
        addFlashMessage(`تم إنشاء الموديل ${cleanCode} بنجاح`);
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل إنشاء الموديل في الباك إند', 'danger');
      });

    return { success: true, message: 'تم إنشاء الموديل بنجاح', modelId: newModelId };
  };

  /**
   * نسخ موديل تصميم كامل (بيانات + أقمشة + إكسسوارات) إلى كود موديل جديد.
   * تُنسخ كميات الأقمشة كما هي، بينما تُعاد كميات الإكسسوارات حسابياً حسب
   * العدد المستهدف الجديد (استهلاك القطعة × العدد).
   */
  const cloneDesignModel = async (
    sourceModelId: string,
    newModelCode: string,
    targetQuantity?: number
  ): Promise<{ success: boolean; message: string; modelId?: string }> => {
    const source = models.find((m) => m.id === sourceModelId && !m.is_deleted);
    if (!source) {
      addFlashMessage('الموديل الأصلي غير موجود', 'danger');
      return { success: false, message: 'الموديل الأصلي غير موجود' };
    }

    const cleanCode = (newModelCode || '').trim().toUpperCase();
    if (!cleanCode) {
      addFlashMessage('أدخل كود الموديل الجديد', 'warning');
      return { success: false, message: 'كود الموديل الجديد مطلوب' };
    }
    if (models.some((m) => !m.is_deleted && m.model_code.toUpperCase() === cleanCode)) {
      addFlashMessage('كود الموديل مستخدم بالفعل!', 'danger');
      return { success: false, message: 'كود الموديل مستخدم بالفعل!' };
    }

    const targetQty = Math.max(
      1,
      Number(targetQuantity) || Number(source.target_cut_quantity) || 100
    );
    const sourceReqs = requirements.filter((r) => r.model_id === sourceModelId);
    const sourceAccs = accessories.filter((a) => a.model_id === sourceModelId);
    const allowNotes = canAddDesignNotes();
    const userName = currentUser?.real_name || 'مسؤول التصميم';
    const composition: GarmentComposition =
      (source.garment_composition as GarmentComposition) || DEFAULT_GARMENT_COMPOSITION;
    const parts =
      source.garment_parts && source.garment_parts.length > 0
        ? source.garment_parts
        : partsForComposition(composition);

    try {
      const savedModel = await api.createModel({
        model_code: cleanCode,
        model_type: source.model_type,
        size_category_id: source.size_category_id,
        image: source.image,
        target_cut_quantity: targetQty,
        garment_composition: composition,
        garment_parts: parts,
        design_notes: allowNotes ? source.design_notes || '' : '',
        notes_shirt: allowNotes ? source.notes_shirt || '' : '',
        notes_pants: allowNotes ? source.notes_pants || '' : '',
        notes_jacket: allowNotes ? source.notes_jacket || '' : '',
        user_name: userName
      });

      const newModelId = savedModel?.id;
      if (!newModelId) {
        throw new Error('لم يتم إرجاع كود الموديل الجديد من الباك إند');
      }

      // نسخ خامات وألوان الموديل مع الحفاظ على الكميات المخططة كما هي.
      for (let i = 0; i < sourceReqs.length; i += 1) {
        const req = sourceReqs[i];
        await api.createModelRequirement({
          id: `req-${Date.now()}-${i}`,
          model_id: newModelId,
          color_id: req.color_id,
          part_name: req.part_name,
          planned_quantity: req.planned_quantity
        });
      }

      // نسخ الإكسسوارات مع إعادة حساب الكميات حسب العدد المستهدف الجديد.
      for (let i = 0; i < sourceAccs.length; i += 1) {
        const acc = sourceAccs[i];
        const consumption = Number(acc.piece_consumption) || 1;
        await api.createModelAccessory({
          id: `macc-${Date.now()}-${i}`,
          model_id: newModelId,
          accessory_id: acc.accessory_id,
          accessory_code: acc.accessory_code,
          accessory_name: acc.accessory_name,
          unit: acc.unit,
          image: acc.image,
          target_type: acc.target_type || 'shirt',
          piece_consumption: consumption,
          planned_quantity: Math.round(consumption * targetQty)
        });
      }

      // الماركرات غير مدعومة في نقطة الإنشاء، لذا تُنسخ بتحديث لاحق.
      if (source.main_marker_url || source.print_marker_url) {
        await api.updateModel(newModelId, {
          main_marker_url: source.main_marker_url || '',
          print_marker_url: source.print_marker_url || ''
        });
      }

      await refreshState();
      logAction('التصميم', `نسخ الموديل ${source.model_code} إلى موديل جديد: ${cleanCode}`);
      addFlashMessage(`تم نسخ الموديل ${source.model_code} إلى ${cleanCode} بنجاح`);
      return { success: true, message: 'تم نسخ الموديل بنجاح', modelId: newModelId };
    } catch (err: any) {
      await refreshState();
      addFlashMessage(err?.message || 'فشل نسخ الموديل', 'danger');
      return { success: false, message: err?.message || 'فشل نسخ الموديل' };
    }
  };

  const updateModelPlan = (data: {
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
  }) => {
    const model = models.find((m) => m.id === data.modelId);
    if (!model) return { success: false, message: 'الموديل غير موجود' };

    const allowNotes = canAddDesignNotes();

    // Validate that planned quantities don't exceed available for design (including what this model already had reserved)
    const modelReqs = requirements.filter((r) => r.model_id === data.modelId);
    for (const req of modelReqs) {
      const nextQty = Math.max(0, Number(data.reqQuantities[req.id] ?? req.planned_quantity) || 0);
      const col = fabricColors.find((c) => c.id === req.color_id);
      if (col) {
        const otherModelsReserved = requirements
          .filter(
            (r) =>
              r.color_id === req.color_id &&
              r.model_id !== data.modelId &&
              designModelIdsSet.has(r.model_id)
          )
          .reduce((sum, r) => sum + (Number(r.planned_quantity) || 0), 0);
        const sameModelOtherParts = modelReqs
          .filter((r) => r.color_id === req.color_id && r.id !== req.id)
          .reduce(
            (sum, r) => sum + Math.max(0, Number(data.reqQuantities[r.id] ?? r.planned_quantity) || 0),
            0
          );
        const maxAvailableForThisPart = Number(
          Math.max(0, col.quantity - otherModelsReserved - sameModelOtherParts).toFixed(2)
        );
        if (nextQty > maxAvailableForThisPart) {
          addFlashMessage(
            `الكمية المطلوبة للون (${col.color_code}) تتجاوز المتاح للتصميم (${maxAvailableForThisPart})!`,
            'warning'
          );
          return {
            success: false,
            message: `الكمية المطلوبة للون (${col.color_code}) تتجاوز المتاح للتصميم (${maxAvailableForThisPart})`
          };
        }
      }
    }

    setRequirements((prev) =>
      prev.map((r) => {
        if (r.model_id !== data.modelId) return r;
        const newQty = data.reqQuantities[r.id];
        return newQty !== undefined ? { ...r, planned_quantity: Math.max(0, newQty) } : r;
      })
    );

    setAccessories((prev) =>
      prev.map((a) => {
        if (a.model_id !== data.modelId) return a;
        const newQty = data.accQuantities[a.id];
        return newQty !== undefined ? { ...a, planned_quantity: Math.max(0, newQty) } : a;
      })
    );

    setModels((prev) =>
      prev.map((m) => {
        if (m.id !== data.modelId) return m;
        return {
          ...m,
          main_marker_url: data.mainMarkerUrl ?? m.main_marker_url,
          print_marker_url: data.printMarkerUrl ?? m.print_marker_url,
          ...(allowNotes
            ? {
                design_notes: data.designNotes ?? m.design_notes,
                notes_shirt: data.notesShirt ?? m.notes_shirt,
                notes_pants: data.notesPants ?? m.notes_pants,
                notes_jacket: data.notesJacket ?? m.notes_jacket
              }
            : {}),
          target_cut_quantity: data.targetCutQuantity ?? m.target_cut_quantity
        };
      })
    );

    api
      .updateModelPlan(data.modelId, {
        ...data,
        ...(allowNotes
          ? {}
          : {
              designNotes: model.design_notes,
              notesShirt: model.notes_shirt,
              notesPants: model.notes_pants,
              notesJacket: model.notes_jacket
            })
      }, auditHeadersForModel(model, 'التصميم'))
      .then((savedModel) => {
        setModels((prev) => prev.map((m) => (m.id === data.modelId ? savedModel : m)));
        logAction('التصميم', `تحديث خطة وخامات الموديل ${model.model_code} (حجز من المتاح للتصميم)`);
        addFlashMessage('تم حفظ خطة الموديل وخصم الكميات المحددة من (المتاح للتصميم) فقط بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل حفظ الخطة في الباك إند', 'danger');
      });

    return { success: true, message: 'تم حفظ الخطة بنجاح' };
  };

  const updateModelNotesAndTarget = (
    modelId: string,
    data: {
      target_cut_quantity?: number;
      design_notes?: string;
      notes_shirt?: string;
      notes_pants?: string;
      notes_jacket?: string;
      garment_composition?: GarmentComposition;
    }
  ) => {
    const allowNotes = canAddDesignNotes();
    const filteredData = {
      ...(data.target_cut_quantity !== undefined ? { target_cut_quantity: data.target_cut_quantity } : {}),
      ...(data.garment_composition !== undefined ? { garment_composition: data.garment_composition } : {}),
      ...(allowNotes && data.design_notes !== undefined ? { design_notes: data.design_notes } : {}),
      ...(allowNotes && data.notes_shirt !== undefined ? { notes_shirt: data.notes_shirt } : {}),
      ...(allowNotes && data.notes_pants !== undefined ? { notes_pants: data.notes_pants } : {}),
      ...(allowNotes && data.notes_jacket !== undefined ? { notes_jacket: data.notes_jacket } : {})
    };

    setModels((prev) =>
      prev.map((m) => {
        if (m.id !== modelId) return m;
        return {
          ...m,
          ...filteredData
        };
      })
    );
    api
      .updateModel(
        modelId,
        filteredData,
        auditHeadersForModel(models.find((m) => m.id === modelId), 'التصميم')
      )
      .then((saved) => {
        setModels((prev) => prev.map((m) => (m.id === modelId ? saved : m)));
        addFlashMessage('تم تحديث بيانات وملاحظات التشغيل بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل التحديث في الباك إند', 'danger');
      });
  };

  /**
   * تعديل البيانات الأساسية للموديل من قسم التصميم (الصورة، الكود، النوع،
   * فئة المقاسات، تكوين القطع، العدد المستهدف، وملاحظات التصميم).
   * يتحقق من الكود محلياً، ويحدّث الحالة فوراً، ثم يزامن مع الباك إند.
   */
  const updateDesignModelBasicInfo = async (
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
  ): Promise<{ success: boolean; message: string }> => {
    const target = models.find((m) => m.id === modelId && !m.is_deleted);
    if (!target) {
      addFlashMessage('الموديل غير موجود', 'danger');
      return { success: false, message: 'الموديل غير موجود' };
    }

    const allowNotes = canAddDesignNotes();
    const cleanCode = (data.model_code || '').trim().toUpperCase();

    if (data.model_code !== undefined) {
      if (!cleanCode) {
        const message = 'كود الموديل مطلوب ولا يمكن أن يكون فارغاً';
        addFlashMessage(message, 'warning');
        return { success: false, message };
      }
      if (
        models.some(
          (m) => !m.is_deleted && m.id !== modelId && m.model_code.toUpperCase() === cleanCode
        )
      ) {
        const message = 'كود الموديل مستخدم بالفعل لموديل آخر!';
        addFlashMessage(message, 'danger');
        return { success: false, message };
      }
    }

    const updates: Record<string, any> = {};
    if (data.model_code !== undefined) updates.model_code = cleanCode;
    if (data.image !== undefined) updates.image = data.image;
    if (data.model_type !== undefined) updates.model_type = data.model_type;
    if (data.size_category_id !== undefined) updates.size_category_id = data.size_category_id;
    if (data.garment_composition !== undefined) {
      updates.garment_composition = data.garment_composition;
    }
    if (data.target_cut_quantity !== undefined) {
      updates.target_cut_quantity = data.target_cut_quantity;
    }
    if (allowNotes && data.design_notes !== undefined) updates.design_notes = data.design_notes;

    // تحديث تفاؤلي فوري للحالة المحلية.
    setModels((prev) => prev.map((m) => (m.id === modelId ? { ...m, ...updates } : m)));
    const codeChanged =
      updates.model_code !== undefined && updates.model_code !== target.model_code;

    try {
      const saved = await api.updateModel(
        modelId,
        updates,
        auditHeadersForModel(target, 'التصميم')
      );
      setModels((prev) => prev.map((m) => (m.id === modelId ? saved : m)));
      if (codeChanged) {
        // إعادة مزامنة حركات المخزن المرتبطة بكود الموديل القديم.
        await refreshState();
      }
      const codeLabel = updates.model_code || target.model_code;
      logAction('التصميم', `تعديل البيانات الأساسية للموديل ${codeLabel}`);
      addFlashMessage(`تم تحديث بيانات الموديل ${codeLabel} بنجاح`);
      return { success: true, message: 'تم تحديث بيانات الموديل بنجاح' };
    } catch (err: any) {
      await refreshState();
      const message = err?.message || 'فشل تحديث بيانات الموديل في الباك إند';
      addFlashMessage(message, 'danger');
      return { success: false, message };
    }
  };

  const addModelRequirement = (
    modelId: string,
    colorId: string,
    partName: string,
    plannedQuantity: number = 0
  ) => {
    const col = fabricColors.find((c) => c.id === colorId);
    const cleanQty = Math.max(0, Number(plannedQuantity) || 0);

    if (col && cleanQty > 0) {
      const availableForDesign = Number((col.quantity - col.reserved_quantity).toFixed(2));
      if (cleanQty > availableForDesign) {
        addFlashMessage(
          `الكمية المطلوبة (${cleanQty}) أكبر من المتاح للتصميم حالياً (${availableForDesign}) للون ${col.color_code}`,
          'warning'
        );
        return {
          success: false,
          message: `الكمية المطلوبة أكبر من المتاح للتصميم (${availableForDesign})`
        };
      }
    }

    const makeClientId = (prefix: string) =>
      `${prefix}-${typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID().slice(0, 12) : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`;

    const newReq: ModelRequirement = {
      id: makeClientId('req'),
      model_id: modelId,
      color_id: colorId,
      part_name: partName.trim(),
      planned_quantity: cleanQty
    };
    setRequirements((prev) => [...prev, newReq]);
    api
      .createModelRequirement(newReq)
      .then((saved) => {
        setRequirements((prev) => prev.map((r) => (r.id === newReq.id ? saved : r)));
        addFlashMessage(
          cleanQty > 0
            ? `تم تخصيص خامة اللون وحجز ${cleanQty} من المتاح للتصميم فقط (دون المساس بالمخزون الفعلي الكلي)`
            : 'تمت إضافة خامة اللون بنجاح'
        );
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل إضافة الخامة للموديل في الباك إند', 'danger');
      });

    return { success: true, message: 'تمت إضافة الخامة بنجاح' };
  };

  const deleteModelRequirement = (reqId: string) => {
    setRequirements((prev) => prev.filter((r) => r.id !== reqId));
    api
      .deleteModelRequirement(reqId)
      .then(() => {
        addFlashMessage('تم حذف الخامة من الموديل وإعادة الكمية إلى المتاح للتصميم');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل حذف الخامة من الباك إند', 'danger');
      });
  };

  const addModelAccessory = (
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
      silent?: boolean;
    }
  ) => {
    const targetModel = models.find((m) => m.id === modelId);
    const targetCut = targetModel?.target_cut_quantity || 100;
    const pieceConsumption = accessory.piece_consumption || 1;
    const plannedQty = accessory.planned_quantity ?? Math.round(pieceConsumption * targetCut);

    const uniqueId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `macc-${crypto.randomUUID().slice(0, 12)}`
        : `macc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const newAcc: ModelAccessory = {
      id: uniqueId,
      model_id: modelId,
      accessory_id: accessory.id,
      accessory_code: accessory.code,
      accessory_name: accessory.name,
      unit: accessory.unit || 'قطعة',
      image: accessory.image,
      target_type: accessory.target_type || 'shirt',
      piece_consumption: pieceConsumption,
      planned_quantity: plannedQty
    };
    setAccessories((prev) => [...prev, newAcc]);
    api
      .createModelAccessory(newAcc)
      .then((saved) => {
        setAccessories((prev) => prev.map((a) => (a.id === newAcc.id ? saved : a)));
        if (!accessory.silent) {
          addFlashMessage(
            `تمت إضافة إكسسوار "${accessory.name}" إلى ${
              accessory.target_type === 'pants'
                ? 'البنطلون'
                : accessory.target_type === 'jacket'
                ? 'الجاكيت'
                : accessory.target_type === 'single'
                ? 'القطعة الواحدة'
                : 'التيشرت'
            }`
          );
        }
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل إضافة الإكسسوار للموديل في الباك إند', 'danger');
      });
    return { success: true, message: 'تمت الإضافة بنجاح' };
  };

  const deleteModelAccessory = (accId: string) => {
    setAccessories((prev) => prev.filter((a) => a.id !== accId));
    api
      .deleteModelAccessory(accId)
      .then(() => {
        addFlashMessage('تم إزالة الإكسسوار من الموديل');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل إزالة الإكسسوار من الباك إند', 'danger');
      });
  };

  const issueFabricToCutting = (
    modelId: string,
    extraData?: { reqQuantities?: Record<string, number>; accQuantities?: Record<string, number> }
  ) => {
    const targetModel = models.find((m) => m.id === modelId);
    if (!targetModel) return { success: false, message: 'الموديل غير موجود' };

    // منع إعادة الصرف/النقل لموديل غادر مرحلة التصميم بالفعل.
    if (targetModel.status !== 'مرحلة التصميم' && targetModel.status !== 'تصميم') {
      const message =
        'تم صرف خامات هذا الموديل وتحويله لقسم القص مسبقاً ولا يمكن إعادة صرفه أو نقله مرة أخرى.';
      addFlashMessage(message, 'danger');
      return { success: false, message };
    }

    const reqQuantities = extraData?.reqQuantities || {};
    const accQuantities = extraData?.accQuantities || {};

    // Update requirements and accessories locally if latest quantities were passed
    const effectiveReqs = requirements.map((r) => {
      if (r.model_id !== modelId) return r;
      const q = reqQuantities[r.id];
      return q !== undefined ? { ...r, planned_quantity: Math.max(0, Number(q) || 0) } : r;
    });
    const effectiveAccs = accessories.map((a) => {
      if (a.model_id !== modelId) return a;
      const q = accQuantities[a.id];
      return q !== undefined ? { ...a, planned_quantity: Math.max(0, Number(q) || 0) } : a;
    });

    const modelReqs = effectiveReqs.filter((r) => r.model_id === modelId && r.planned_quantity > 0);

    // Check that actual total stock is sufficient for deduction
    const colorDeductMap: Record<string, number> = {};
    for (const req of modelReqs) {
      colorDeductMap[req.color_id] = Number(
        ((colorDeductMap[req.color_id] || 0) + req.planned_quantity).toFixed(2)
      );
    }
    for (const [colId, totalNeeded] of Object.entries(colorDeductMap)) {
      const col = fabricColors.find((c) => c.id === colId);
      if (col && col.quantity < totalNeeded) {
        addFlashMessage(
          `الرصيد الفعلي الكلي للون (${col.color_code}) غير كافٍ للصرف! المطلوب: ${totalNeeded}، الفعلي بالمخزن: ${col.quantity}`,
          'danger'
        );
        return {
          success: false,
          message: `الرصيد الفعلي الكلي للون (${col.color_code}) غير كافٍ للصرف`
        };
      }
    }

    setRequirements(effectiveReqs);
    setAccessories(effectiveAccs);

    // Deduct from actual total stock (`quantity`) ONLY now when issuing fabric to Cutting!
    setFabricColors((prev) =>
      prev.map((c) => {
        const deductAmt = colorDeductMap[c.id];
        if (!deductAmt) return c;
        return {
          ...c,
          quantity: Math.max(0, Number((c.quantity - deductAmt).toFixed(2)))
        };
      })
    );

    // الإكسسوارات لا تُخصم هنا؛ تبقى محجوزة حتى يؤكّد أمين مخزن الإكسسوارات الصرف الفعلي.

    // Move model status to 'في القص' (which also automatically releases its fabric reservation)
    setModels((prev) =>
      prev.map((m) =>
        m.id === modelId ? { ...m, status: 'في القص', cut_at: new Date().toISOString() } : m
      )
    );

    api
      .issueFabricToCutting(modelId, currentUser?.real_name || 'مسؤول التصميم', extraData)
      .then(async () => {
        await refreshState();
        logAction('التصميم', `صرف قماش الموديل ${targetModel.model_code} من المخزون الفعلي الكلي وتحويله للقص (الإكسسوارات تبقى محجوزة)`);
        addFlashMessage('تم صرف القماش من المخزون الفعلي الكلي وتوجيه الموديل للقص بنجاح — الإكسسوارات تبقى محجوزة حتى صرفها من مخزن الإكسسوارات');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل صرف الخامات في الباك إند', 'danger');
      });

    return { success: true, message: 'تم صرف القماش وتحويل الموديل للقص (الإكسسوارات تبقى محجوزة حتى صرفها).' };
  };

  const returnFabricFromCutting = async (
    modelId: string,
    requirementId: string,
    quantity: number,
    notes = '',
    defectQuantity = 0
  ): Promise<{ success: boolean; message: string }> => {
    const targetModel = models.find((m) => m.id === modelId);
    if (!targetModel) {
      addFlashMessage('الموديل غير موجود', 'danger');
      return { success: false, message: 'الموديل غير موجود' };
    }

    const req = requirements.find((r) => r.id === requirementId && r.model_id === modelId);
    if (!req) {
      addFlashMessage('متطلب القماش غير موجود أو لا يتبع هذا الموديل', 'danger');
      return { success: false, message: 'متطلب القماش غير موجود أو لا يتبع هذا الموديل' };
    }

    const available = Math.max(0, Number(req.planned_quantity) || 0);
    if (available <= 0) {
      const message = 'لا توجد كمية مصروفة متبقية لهذا المتطلب لإرجاع فائض منها';
      addFlashMessage(message, 'danger');
      return { success: false, message };
    }

    const qty = Math.round((Number(quantity) || 0) * 100) / 100;
    const defectQty = Math.round((Number(defectQuantity) || 0) * 100) / 100;
    if (!Number.isFinite(qty) || !Number.isFinite(defectQty) || qty < 0 || defectQty < 0) {
      const message = 'كمية الإرجاع وكمية العيوب لا يمكن أن تكون سالبة';
      addFlashMessage(message, 'danger');
      return { success: false, message };
    }
    if (qty <= 0 && defectQty <= 0) {
      const message = 'يجب إدخال كمية إرجاع أو كمية عيوب أكبر من صفر';
      addFlashMessage(message, 'danger');
      return { success: false, message };
    }
    if (qty + defectQty > available + 0.000001) {
      const message = `إجمالي المرتجع والعيوب (${Math.round((qty + defectQty) * 100) / 100}) أكبر من الكمية المصروفة المتبقية (${available})`;
      addFlashMessage(message, 'danger');
      return { success: false, message };
    }

    try {
      const res = await api.returnFabricFromCutting(
        modelId,
        requirementId,
        qty,
        currentUser?.real_name || 'مسؤول القص',
        notes.trim(),
        defectQty
      );
      await refreshState();
      const color = fabricColors.find((c) => c.id === req.color_id);
      const defectSuffix = defectQty > 0 ? ` وتسجيل ${defectQty} عيوب قماش` : '';
      logAction(
        'القص',
        `إرجاع فائض ${qty} من القماش${color ? ` (${color.color_code})` : ''} للقطعة ${req.part_name} من الموديل ${targetModel.model_code} إلى مخزن القماش${defectSuffix}`
      );
      const message = res?.message || `تم إرجاع ${qty} من فائض القماش إلى المخزن بنجاح`;
      addFlashMessage(message);
      return { success: true, message };
    } catch (err: any) {
      await refreshState();
      const message = err?.message || 'فشل إرجاع فائض القماش إلى المخزن';
      addFlashMessage(message, 'danger');
      return { success: false, message };
    }
  };

  const deleteDesignModel = (modelId: string, confirmPostCutting = false) => {
    const target = models.find((m) => m.id === modelId);
    if (!target) return;
    setModels((prev) => prev.map((m) => (m.id === modelId ? { ...m, is_deleted: true } : m)));
    api
      .deleteModel(modelId, confirmPostCutting)
      .then(async (res: any) => {
        // حدّث كل الحالة فوراً حتى تظهر أرصدة المخزن بعد استرداد الخامات.
        await refreshState();
        logAction('التصميم', `تم حذف الموديل ${target.model_code}`);
        const summary = res?.refund_summary;
        const fabricQty = Number(summary?.fabric_total_quantity || 0);
        const accQty = Number(summary?.accessories_total_quantity || 0);
        let message = `تم حذف الموديل ${target.model_code} واسترداد خاماته وإكسسواراته للمخزن بنجاح`;
        if (fabricQty > 0 || accQty > 0) {
          const parts: string[] = [];
          if (fabricQty > 0) parts.push(`قماش ${fabricQty}`);
          if (accQty > 0) parts.push(`إكسسوارات ${accQty}`);
          message += ` (المسترد: ${parts.join(' + ')})`;
        }
        addFlashMessage(message);
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل حذف الموديل من الباك إند', 'danger');
      });
  };

  // Normalizes any free-text / alias part label to a canonical GarmentPart key.

  return {
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
    deleteDesignModel
  };
};
