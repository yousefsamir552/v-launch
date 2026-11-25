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
  PackagingMaterialShortageItem,
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

export const buildAssemblyActions = (ctx: AppInternalContext) => {
  const {
    currentUser, setCurrentUser, setCurrentUserState, isLoadingState, setIsLoadingState, globalSettings, setGlobalSettings, roles, setRoles, users, setUsers, onlineUsers, setOnlineUsers, sizeDefs, setSizeDefs, suppliers, setSuppliers, workshops, setWorkshops, fabrics, setFabrics, fabricColorsRaw, setFabricColors, fabricColors, fabricTransactions, setFabricTransactions, models, setModels, requirements, setRequirements, accessories, setAccessories, accessoryTypes, setAccessoryTypes, accessoryItemsRaw, setAccessoryItems, accessoryItems, accessoryTransactions, setAccessoryTransactions, cuttingRecords, setCuttingRecords, qcRecords, setQcRecords, printDispatches, setPrintDispatches, sewingDispatches, setSewingDispatches, packagingRequirements, setPackagingRequirements, finishingRecords, setFinishingRecords, assemblyStageRecords, setAssemblyStageRecords, packagingMaterialRules, setPackagingMaterialRules, internalMessages, setInternalMessages, auditLogs, setAuditLogs, flashMessages, setFlashMessages, readNotificationIds, setReadNotificationIds, snoozedNotifications, setSnoozedNotifications, designModelIdsSet, removeFlashMessage, addFlashMessage, refreshState, login, logout, logAction, updateGlobalSettings, formatSupplierWhatsappMessage, openWhatsAppOrder, addModelTimelineEvent, addRole, updateRole, deleteRole, sendInternalMessage, markMessageRead, normalizePartKey, getModelParts, getModelColorList, getModelSizeList, getPackagingRequirement, getPartStages, isPackagingReady, getUserPermissionsObject, hasSpecificPermission, hasPermission, hasAssemblyPackagingAccess, canManagePermissions, canManageUsers, canManageSuppliers, canManageSizes, canViewAuditLogs, canViewGlobalSettings, canEditHeaderSettings, canEditMessageTemplates, canAccessSettings, isCurrentUserSudo, canAccessHRSection, canManageHR, currentUserRank, visibleRankLevels, visibleRankOptions, rankLabelFor, isRankVisibleToActor, clampRankToVisible, getEffectiveDelegatablePermissions, canDelegatePermission, getRoleEnabledPermissionKeys, isRoleAssignable, getCreatedDescendants, canAddDesignNotes, canAddCuttingNotes, canAddQCBeforePrintNotes, canAddQCAfterPrintNotes, canAddSewingNotes, canAddPrintingNotes, canViewFabricPrices, canEditFabricPrices, canViewAccessoryPrices, canEditAccessoryPrices, canViewPrintingPrices, canEditPrintingPrices, canViewPrintingCosts, canEditPrintingCosts, canViewSewingPrices, canEditSewingPrices, canViewAssemblyPrices, canEditAssemblyPrices, canSendWhatsApp, canSendMessages, addModelAccessory
  } = ctx;

  const setPackagingStep = (
    modelId: string,
    step: PackagingStepKey,
    date?: string,
    notes?: string,
    qty?: number
  ) => {
    const targetModel = models.find((m) => m.id === modelId);
    const resolvedDate = date || new Date().toISOString().slice(0, 10);
    const cleanNotes = notes?.trim() || '';
    const cleanQty =
      qty === undefined || qty === null ? undefined : Math.max(0, Math.floor(Number(qty) || 0));

    const existing = packagingRequirements.find((req) => req.model_id === modelId);
    const merged = {
      ...(existing || {}),
      id: existing?.id || `pack-req-${Date.now()}`,
      model_id: modelId,
      model_code: targetModel?.model_code,
      [`${step}_date`]: resolvedDate,
      steps: {
        ...(existing?.steps || {}),
        [step]: resolvedDate
      },
      // تتبع قطع العينة المرسلة/المستلمة من التصوير (خصم مؤقت من الإنتاج).
      ...(step === 'sent_to_photo' && cleanQty !== undefined
        ? { photography_sent_qty: cleanQty }
        : {}),
      ...(step === 'received_from_photo' && cleanQty !== undefined
        ? { photography_received_qty: cleanQty }
        : {}),
      notes: cleanNotes || existing?.notes || '',
      missing_steps: existing?.missing_steps || [],
      is_complete: existing?.is_complete || false
    } as PackagingRequirement;

    const sentQty = Number(merged.photography_sent_qty || 0);
    const receivedQty = sentQty > 0 ? Math.min(Number(merged.photography_received_qty || 0), sentQty) : 0;
    merged.photography_received_qty = receivedQty;
    merged.photography_outstanding_qty = Math.max(0, sentQty - receivedQty);
    merged.photography_shortage = merged.received_from_photo_date
      ? merged.photography_outstanding_qty
      : 0;

    setPackagingRequirements((prev) =>
      existing
        ? prev.map((req) => (req.model_id === modelId ? merged : req))
        : [...prev, merged]
    );

    api
      .setPackagingStep(
        modelId,
        {
          step,
          date: resolvedDate,
          notes: cleanNotes,
          user_name: currentUser?.real_name || 'مسؤول الأمبالاج',
          ...(step === 'sent_to_photo' && cleanQty !== undefined ? { sent_qty: cleanQty } : {}),
          ...(step === 'received_from_photo' && cleanQty !== undefined
            ? { received_qty: cleanQty }
            : {})
        },
        auditHeadersForModel(targetModel, 'الأسمبلي والأمبالاج')
      )
      .then((res) => {
        const saved: PackagingRequirement | undefined = res?.packagingRequirement;
        if (saved) {
          setPackagingRequirements((prev) => [
            saved,
            ...prev.filter((req) => req.model_id !== modelId)
          ]);
        }
        refreshState();
        logAction(
          'الأسمبلي والأمبالاج',
          `تسجيل خطوة أمبالاج (${step}) للموديل ${targetModel?.model_code}`
        );
        addFlashMessage('تم تسجيل خطوة متطلبات الأمبالاج بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تسجيل خطوة الأمبالاج في الباك إند', 'danger');
      });
  };

  const startFinishing = (data: {
    modelId: string;
    parts?: GarmentPart[];
    entryDate?: string;
    expectedExitDate?: string;
    vendorName?: string;
    notes?: string;
    costPerPiece?: number;
    totalCost?: number;
  }) => {
    const targetModel = models.find((m) => m.id === data.modelId);
    const parts = data.parts && data.parts.length ? data.parts : getModelParts(data.modelId);
    const cleanNotes = data.notes?.trim() || '';
    const cleanVendor = data.vendorName?.trim() || '';
    // السعر يُرسل فقط لمن يملك صلاحية تعديل أسعار الأسمبلي/التشطيب.
    // لا نرسل total_cost: 0 أبداً حتى يحسب الباك إند الإجمالي بدقة من سعر القطعة × عدد القطع.
    const canSetPrice = canEditAssemblyPrices();
    const piecePrice = canSetPrice ? Math.max(0, Number(data.costPerPiece) || 0) : 0;
    const explicitTotal =
      canSetPrice && data.totalCost !== undefined && Number(data.totalCost) > 0
        ? Number(data.totalCost)
        : undefined;

    setModels((prev) =>
      prev.map((m) => {
        if (m.id !== data.modelId) return m;
        const stages = { ...(m.part_stages || {}) };
        parts.forEach((part) => {
          stages[part] = 'finishing';
        });
        return { ...m, status: 'في التشطيب' as DesignModel['status'], part_stages: stages };
      })
    );
    const optimistic: FinishingRecord[] = parts.map((part, index) => ({
      id: `finish-${Date.now()}-${index}`,
      model_id: data.modelId,
      model_code: targetModel?.model_code,
      part_type: part,
      piece_label: getPartLabel(part),
      vendor_name: cleanVendor,
      entry_date: data.entryDate || new Date().toISOString().slice(0, 10),
      expected_exit_date: data.expectedExitDate || null,
      actual_exit_date: null,
      status: 'في التشطيب',
      is_received: false,
      notes: cleanNotes,
      ...(canSetPrice
        ? { cost_per_piece: piecePrice, ...(explicitTotal !== undefined ? { total_cost: explicitTotal } : {}) }
        : {})
    }));
    setFinishingRecords((prev) => [
      ...optimistic,
      ...prev.filter((rec) => rec.model_id !== data.modelId)
    ]);

    api
      .startFinishing(data.modelId, {
        parts,
        entry_date: data.entryDate,
        expected_exit_date: data.expectedExitDate,
        vendor_name: cleanVendor,
        notes: cleanNotes,
        user_name: currentUser?.real_name || 'مسؤول التشطيب',
        ...(canSetPrice
          ? { cost_per_piece: piecePrice, ...(explicitTotal !== undefined ? { total_cost: explicitTotal } : {}) }
          : {})
      })
      .then((res) => {
        const saved: FinishingRecord[] = Array.isArray(res?.finishingRecords)
          ? res.finishingRecords
          : [];
        if (saved.length) {
          setFinishingRecords((prev) => [
            ...saved,
            ...prev.filter((rec) => rec.model_id !== data.modelId)
          ]);
        }
        refreshState();
        logAction(
          'قسم التشطيب',
          `دخول قطع (${parts.map((p) => getPartLabel(p)).join(' / ')}) للموديل ${targetModel?.model_code} للتشطيب`
        );
        addFlashMessage('تم تسجيل دخول القطع لقسم التشطيب بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تسجيل التشطيب في الباك إند', 'danger');
      });
  };

  const receiveFinishing = (recordId: string, actualExitDate?: string, notes?: string) => {
    const record = finishingRecords.find((rec) => rec.id === recordId);
    if (!record) return;
    const targetModel = models.find((m) => m.id === record.model_id);
    const resolvedDate = actualExitDate || new Date().toISOString().slice(0, 10);
    const cleanNotes = notes?.trim() || '';

    const updated = finishingRecords.map((rec) =>
      rec.id === recordId
        ? {
            ...rec,
            actual_exit_date: resolvedDate,
            status: 'تم الاستلام' as const,
            is_received: true,
            notes: cleanNotes
              ? `${rec.notes || ''} | استلام: ${cleanNotes}`.replace(/^\s*\|\s*/, '')
              : rec.notes
          }
        : rec
    );
    setFinishingRecords(updated);

    // Only the model-level status advances when *every* part was received.
    const partList = getModelParts(record.model_id);
    const allPartsReceived =
      partList.length > 0 &&
      partList.every((part) =>
        updated.some(
          (rec) =>
            rec.model_id === record.model_id && rec.part_type === part && rec.is_received
        )
      );
    // Only this part moves to ironing; the others keep their own stage.
    setModels((prev) =>
      prev.map((m) => {
        if (m.id !== record.model_id) return m;
        const stages = {
          ...(m.part_stages || {}),
          [record.part_type]: 'ironing' as PartStage
        };
        return {
          ...m,
          part_stages: stages,
          status: allPartsReceived ? ('في المكواة' as DesignModel['status']) : m.status
        };
      })
    );

    api
      .receiveFinishing(record.model_id, {
        record_id: recordId,
        actual_exit_date: resolvedDate,
        notes: cleanNotes,
        user_name: currentUser?.real_name || 'مسؤول التشطيب'
      })
      .then((res) => {
        const saved: FinishingRecord[] = Array.isArray(res?.finishingRecords)
          ? res.finishingRecords
          : [];
        if (saved.length) {
          setFinishingRecords((prev) => [
            ...saved,
            ...prev.filter((rec) => rec.model_id !== record.model_id)
          ]);
        }
        refreshState();
        logAction(
          'قسم التشطيب',
          `استلام قطعة ${record.piece_label || getPartLabel(record.part_type)} من التشطيب للموديل ${targetModel?.model_code}`
        );
        addFlashMessage('تم تسجيل استلام القطعة من التشطيب بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تسجيل استلام التشطيب في الباك إند', 'danger');
      });
  };

  /** Starts (or updates) ironing for one or more parts (per-part tracking). */
  const startIroning = (data: {
    modelId: string;
    partType?: GarmentPart;
    parts?: GarmentPart[];
    entryDate?: string;
    expectedExitDate?: string;
    vendorName?: string;
    notes?: string;
    costPerPiece?: number;
    totalCost?: number;
  }) => {
    const targetModel = models.find((m) => m.id === data.modelId);
    const cleanNotes = data.notes?.trim() || '';
    const cleanVendor = data.vendorName?.trim() || '';
    const resolvedEntry = data.entryDate || new Date().toISOString().slice(0, 10);
    // السعر يُرسل فقط لمن يملك صلاحية تعديل أسعار الأسمبلي/المكواة.
    const canSetPrice = canEditAssemblyPrices();
    const piecePrice = canSetPrice ? Math.max(0, Number(data.costPerPiece) || 0) : 0;
    const explicitTotal =
      canSetPrice && data.totalCost !== undefined && Number(data.totalCost) > 0
        ? Number(data.totalCost)
        : undefined;
    const parts: GarmentPart[] =
      data.parts && data.parts.length
        ? data.parts
        : data.partType
        ? [data.partType]
        : (Object.entries(getPartStages(data.modelId))
            .filter(([, stage]) => stage === 'ironing')
            .map(([part]) => part as GarmentPart));

    if (!parts.length) {
      addFlashMessage('لا توجد قطعة في مرحلة المكواة لتسجيل دخولها', 'warning');
      return;
    }

    setAssemblyStageRecords((prev) => {
      const others = prev.filter(
        (rec) =>
          !(
            rec.model_id === data.modelId &&
            rec.stage === 'ironing' &&
            parts.includes((rec.part_type || '') as GarmentPart)
          )
      );
      const optimistic: AssemblyStageRecord[] = parts.map((part, index) => ({
        id: `asm-ironing-${Date.now()}-${index}`,
        model_id: data.modelId,
        model_code: targetModel?.model_code,
        stage: 'ironing',
        part_type: part,
        part_label: getPartLabel(part),
        vendor_name: cleanVendor,
        entry_date: resolvedEntry,
        expected_exit_date: data.expectedExitDate || null,
        actual_exit_date: null,
        status: 'جارية الآن',
        is_completed: false,
        notes: cleanNotes,
        ...(canSetPrice
          ? { cost_per_piece: piecePrice, ...(explicitTotal !== undefined ? { total_cost: explicitTotal } : {}) }
          : {})
      }));
      return [...optimistic, ...others];
    });

    api
      .startIroning(data.modelId, {
        parts,
        entry_date: resolvedEntry,
        expected_exit_date: data.expectedExitDate,
        vendor_name: cleanVendor,
        notes: cleanNotes,
        user_name: currentUser?.real_name || 'مسؤول المكواة',
        ...(canSetPrice
          ? { cost_per_piece: piecePrice, ...(explicitTotal !== undefined ? { total_cost: explicitTotal } : {}) }
          : {})
      })
      .then((res) => {
        const saved: AssemblyStageRecord[] = Array.isArray(res?.assemblyStageRecords)
          ? res.assemblyStageRecords
          : [];
        if (saved.length) {
          const savedParts = saved.map((rec) => (rec.part_type || '') as string);
          setAssemblyStageRecords((prev) => [
            ...saved,
            ...prev.filter(
              (rec) =>
                !(
                  rec.model_id === data.modelId &&
                  rec.stage === 'ironing' &&
                  savedParts.includes((rec.part_type || '') as string)
                )
            )
          ]);
        }
        refreshState();
        logAction(
          'قسم المكواة',
          `دخول قطع (${parts.map((part) => getPartLabel(part)).join(' / ')}) للموديل ${targetModel?.model_code} إلى المكواة`
        );
        addFlashMessage('تم تسجيل دخول المكواة بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تسجيل دخول المكواة في الباك إند', 'danger');
      });
  };

  /** Receives one part from ironing; only that part moves to packaging. */
  const receiveIroning = (recordId: string, actualExitDate?: string, notes?: string) => {
    const record = assemblyStageRecords.find((rec) => rec.id === recordId);
    if (!record) return;
    const targetModel = models.find((m) => m.id === record.model_id);
    const resolvedDate = actualExitDate || new Date().toISOString().slice(0, 10);
    const cleanNotes = notes?.trim() || '';

    setAssemblyStageRecords((prev) =>
      prev.map((rec) =>
        rec.id === recordId
          ? {
              ...rec,
              actual_exit_date: resolvedDate,
              status: 'مكتملة' as const,
              is_completed: true,
              notes: cleanNotes
                ? `${rec.notes || ''} | استلام: ${cleanNotes}`.replace(/^\s*\|\s*/, '')
                : rec.notes
            }
          : rec
      )
    );
    setModels((prev) =>
      prev.map((m) => {
        if (m.id !== record.model_id) return m;
        const stages = { ...(m.part_stages || {}) };
        if (record.part_type) {
          stages[record.part_type] = 'packaging';
        }
        return { ...m, part_stages: stages };
      })
    );

    api
      .receiveIroning(record.model_id, {
        record_id: recordId,
        actual_exit_date: resolvedDate,
        notes: cleanNotes,
        user_name: currentUser?.real_name || 'مسؤول المكواة'
      })
      .then((res) => {
        const saved: AssemblyStageRecord | undefined = res?.assemblyStageRecord;
        if (saved) {
          setAssemblyStageRecords((prev) => prev.map((rec) => (rec.id === saved.id ? saved : rec)));
        }
        refreshState();
        logAction(
          'قسم المكواة',
          `استلام قطعة ${record.part_label || getPartLabel(record.part_type)} من المكواة للموديل ${targetModel?.model_code}`
        );
        addFlashMessage('تم تسجيل استلام القطعة من المكواة بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل استلام المكواة في الباك إند', 'danger');
      });
  };


  const ASSEMBLY_STAGE_STATUS_MAP: Record<AssemblyStageKey, DesignModel['status']> = {
    ironing: 'في المكواة',
    packaging: 'في التعبئة والتغليف',
    dest: 'جاهز للدَست'
  };

  const ASSEMBLY_STAGE_NEXT_STATUS_MAP: Record<AssemblyStageKey, DesignModel['status']> = {
    ironing: 'في التعبئة والتغليف',
    packaging: 'جاهز للدَست',
    dest: 'مخزن الإنتاج التام'
  };

  const startAssemblyStage = async (data: {
    modelId: string;
    stage: AssemblyStageKey;
    entryDate?: string;
    expectedExitDate?: string;
    vendorName?: string;
    partType?: GarmentPart;
    notes?: string;
    costPerPiece?: number;
    totalCost?: number;
    completedPieces?: number;
    expectedPieces?: number;
  }): Promise<{ success: boolean; message?: string; shortages?: PackagingMaterialShortageItem[] }> => {
    // Ironing is per part, so it has its own dedicated flow.
    if (data.stage === 'ironing') {
      startIroning(data);
      return { success: true };
    }

    const targetModel = models.find((m) => m.id === data.modelId);
    const cleanNotes = data.notes?.trim() || '';
    const cleanVendor = data.vendorName?.trim() || '';
    const resolvedEntry = data.entryDate || new Date().toISOString().slice(0, 10);
    // السعر يُرسل فقط لمن يملك صلاحية تعديل أسعار الأسمبلي/الأمبالاج.
    const canSetPrice = canEditAssemblyPrices();
    const piecePrice = canSetPrice ? Math.max(0, Number(data.costPerPiece) || 0) : 0;
    const explicitTotal =
      canSetPrice && data.totalCost !== undefined && Number(data.totalCost) > 0
        ? Number(data.totalCost)
        : undefined;

    // في مرحلة التعبئة والتغليف توجد بوابة رصيد صارمة على الباك إند، لذا ننتظر رد الباك إند
    // قبل تحديث الحالة حتى لا يظهر الموديل كأنه دخل المرحلة بينما تم رفضه لنقص خامات التغليف.
    if (data.stage !== 'packaging') {
      setModels((prev) =>
        prev.map((m) =>
          m.id === data.modelId ? { ...m, status: ASSEMBLY_STAGE_STATUS_MAP[data.stage] } : m
        )
      );
      setAssemblyStageRecords((prev) => {
        const existingRec = prev.find(
          (rec) => rec.model_id === data.modelId && rec.stage === data.stage
        );
        const others = prev.filter(
          (rec) => !(rec.model_id === data.modelId && rec.stage === data.stage)
        );
        const expPcs = data.expectedPieces ?? existingRec?.expected_pieces ?? 0;
        const compPcs =
          data.completedPieces !== undefined
            ? data.completedPieces
            : existingRec?.completed_pieces ?? null;
        return [
          {
            id: existingRec?.id || `asm-${data.stage}-${Date.now()}`,
            model_id: data.modelId,
            model_code: targetModel?.model_code,
            stage: data.stage,
            part_type: '',
            vendor_name: cleanVendor || existingRec?.vendor_name || '',
            entry_date: existingRec?.entry_date || resolvedEntry,
            expected_exit_date: data.expectedExitDate || existingRec?.expected_exit_date || null,
            actual_exit_date: null,
            status: 'جارية الآن' as const,
            is_completed: false,
            notes: cleanNotes || existingRec?.notes || '',
            expected_pieces: expPcs,
            completed_pieces: compPcs,
            shortage_pieces:
              data.stage === 'dest' && compPcs !== null ? Math.max(0, expPcs - compPcs) : 0,
            ...(canSetPrice
              ? { cost_per_piece: piecePrice, ...(explicitTotal !== undefined ? { total_cost: explicitTotal } : {}) }
              : {})
          },
          ...others
        ];
      });
    }

    try {
      const res = await api.startAssemblyStage(data.modelId, {
        stage: data.stage,
        entry_date: resolvedEntry,
        expected_exit_date: data.expectedExitDate,
        vendor_name: cleanVendor,
        notes: cleanNotes,
        user_name: currentUser?.real_name || 'مسؤول الأسمبلي',
        ...(data.completedPieces !== undefined ? { completed_pieces: data.completedPieces } : {}),
        ...(data.expectedPieces !== undefined ? { expected_pieces: data.expectedPieces } : {}),
        ...(canSetPrice
          ? { cost_per_piece: piecePrice, ...(explicitTotal !== undefined ? { total_cost: explicitTotal } : {}) }
          : {})
      });
      const saved: AssemblyStageRecord | undefined = res?.assemblyStageRecord;
      if (saved) {
        setAssemblyStageRecords((prev) => [
          saved,
          ...prev.filter(
            (rec) => !(rec.model_id === data.modelId && rec.stage === data.stage)
          )
        ]);
      }
      refreshState();
      logAction(
        'الأسمبلي والأمبالاج',
        `بدء مرحلة (${data.stage}) للموديل ${targetModel?.model_code}`
      );
      const deductedCount = Array.isArray(res?.deductedMaterials) ? res.deductedMaterials.length : 0;
      addFlashMessage(
        data.stage === 'packaging' && deductedCount > 0
          ? `تم بدء التعبئة والتغليف وخصم ${deductedCount} خامة تغليف تلقائياً ✅`
          : 'تم تسجيل بدء المرحلة بنجاح'
      );
      return { success: true };
    } catch (err: any) {
      refreshState();
      const message = err?.message || 'فشل بدء المرحلة في الباك إند';
      const shortages: PackagingMaterialShortageItem[] | undefined = Array.isArray(err?.data?.shortages)
        ? err.data.shortages
        : undefined;
      addFlashMessage(message, 'danger');
      return { success: false, message, shortages };
    }
  };

  const receiveAssemblyStage = (
    recordId: string,
    actualExitDate?: string,
    notes?: string,
    completedPieces?: number
  ) => {
    const record = assemblyStageRecords.find((rec) => rec.id === recordId);
    if (!record) return;
    const targetModel = models.find((m) => m.id === record.model_id);
    const resolvedDate = actualExitDate || new Date().toISOString().slice(0, 10);
    const cleanNotes = notes?.trim() || '';

    setAssemblyStageRecords((prev) =>
      prev.map((rec) =>
        rec.id === recordId
          ? {
              ...rec,
              actual_exit_date: resolvedDate,
              status: 'مكتملة' as const,
              is_completed: true,
              ...(completedPieces !== undefined
                ? {
                    completed_pieces: completedPieces,
                    shortage_pieces:
                      rec.stage === 'dest'
                        ? Math.max(0, Number(rec.expected_pieces || 0) - completedPieces)
                        : 0
                  }
                : {}),
              notes: cleanNotes
                ? `${rec.notes || ''} | استلام: ${cleanNotes}`.replace(/^\s*\|\s*/, '')
                : rec.notes
            }
          : rec
      )
    );
    setModels((prev) =>
      prev.map((m) => {
        if (m.id !== record.model_id) return m;
        const stages = { ...(m.part_stages || {}) };
        if (record.stage === 'ironing' && record.part_type) {
          // Only this part completed ironing and moves to packaging.
          stages[record.part_type] = 'packaging';
        } else if (record.stage === 'packaging' || record.stage === 'dest') {
          const nextStage: PartStage = record.stage === 'packaging' ? 'dest' : 'completed';
          (Object.keys(stages) as GarmentPart[]).forEach((part) => {
            stages[part] = nextStage;
          });
        }
        return {
          ...m,
          part_stages: stages,
          status:
            record.stage === 'ironing'
              ? m.status
              : ASSEMBLY_STAGE_NEXT_STATUS_MAP[record.stage]
        };
      })
    );

    api
      .receiveAssemblyStage(record.model_id, {
        record_id: recordId,
        actual_exit_date: resolvedDate,
        notes: cleanNotes,
        user_name: currentUser?.real_name || 'مسؤول الأسمبلي',
        ...(completedPieces !== undefined ? { completed_pieces: completedPieces } : {})
      })
      .then((res) => {
        const saved: AssemblyStageRecord | undefined = res?.assemblyStageRecord;
        if (saved) {
          setAssemblyStageRecords((prev) => prev.map((rec) => (rec.id === saved.id ? saved : rec)));
        }
        refreshState();
        logAction(
          'الأسمبلي والأمبالاج',
          `استلام الموديل ${targetModel?.model_code} من مرحلة (${record.stage})`
        );
        addFlashMessage('تم تسجيل استلام المرحلة بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل استلام المرحلة في الباك إند', 'danger');
      });
  };



  // -------------------------------------------------------------------------
  // خامات التشغيل والأمبالاج (Packaging & Operating Materials MRP)
  // -------------------------------------------------------------------------
  const savePackagingMaterialRule = async (data: {
    materialKey: PackagingMaterialRule['material_key'];
    name?: string;
    icon?: string;
    unit?: PackagingMaterialRule['unit'];
    ruleMode?: PackagingMaterialRule['rule_mode'];
    applicableSizeGroups?: string[];
    sizeRules?: Array<{
      id?: string;
      sizeGroupId: string;
      sizeGroupName: string;
      consumptionPerPiece: number;
      dimensionsSpec?: string;
      supplierId?: string;
      minAlertThreshold: number;
      currentStock?: number;
      pricePerUnit?: number;
    }>;
  }): Promise<{ success: boolean; message: string }> => {
    // السعر يُرسل فقط لمن يملك صلاحية تعديل أسعار الأسمبلي/الخامات.
    const canSetPrice = canEditAssemblyPrices();
    const payload = {
      material_key: data.materialKey,
      name: data.name,
      icon: data.icon,
      unit: data.unit,
      rule_mode: data.ruleMode,
      applicable_size_groups: data.applicableSizeGroups || [],
      size_rules: (data.sizeRules || []).map((row) => ({
        id: row.id,
        size_group_id: row.sizeGroupId,
        size_group_name: row.sizeGroupName,
        consumption_per_piece: row.consumptionPerPiece,
        dimensions_spec: row.dimensionsSpec || '',
        supplier_id: row.supplierId || '',
        min_alert_threshold: row.minAlertThreshold,
        current_stock: row.currentStock,
        ...(canSetPrice ? { price_per_unit: Math.max(0, Number(row.pricePerUnit) || 0) } : {})
      }))
    };

    try {
      const existing = packagingMaterialRules.find(
        (rule) => rule.material_key === data.materialKey
      );
      const saved = existing
        ? await api.updatePackagingMaterialRule(existing.id, payload)
        : await api.savePackagingMaterialRule(payload);

      if (saved && saved.id) {
        setPackagingMaterialRules((prev) => {
          const index = prev.findIndex(
            (rule) => rule.id === saved.id || rule.material_key === saved.material_key
          );
          if (index === -1) return [...prev, saved];
          const next = [...prev];
          next[index] = saved;
          return next;
        });
      }
      refreshState();
      logAction('خامات التشغيل', `حفظ قاعدة خامة: ${data.name || data.materialKey || 'فئة جديدة'}`);
      addFlashMessage('تم حفظ قاعدة خامة التشغيل بنجاح');
      return { success: true, message: 'تم حفظ قاعدة خامة التشغيل بنجاح' };
    } catch (err: any) {
      refreshState();
      const message = err?.message || 'فشل حفظ قاعدة خامة التشغيل في الباك إند';
      addFlashMessage(message, 'danger');
      return { success: false, message };
    }
  };

  const deletePackagingMaterialRule = async (
    ruleId: string
  ): Promise<{ success: boolean; message: string }> => {
    const rule = packagingMaterialRules.find((item) => item.id === ruleId);
    try {
      await api.deletePackagingMaterialRule(ruleId);
      setPackagingMaterialRules((prev) => prev.filter((item) => item.id !== ruleId));
      refreshState();
      logAction('خامات التشغيل', `حذف خامة تشغيل: ${rule?.name || ruleId}`);
      addFlashMessage('تم حذف خامة التشغيل بنجاح');
      return { success: true, message: 'تم حذف خامة التشغيل بنجاح' };
    } catch (err: any) {
      const message = err?.message || 'فشل حذف خامة التشغيل من الباك إند';
      addFlashMessage(message, 'danger');
      return { success: false, message };
    }
  };

  const recordPackagingMaterialTransaction = async (data: {
    sizeRuleId: string;
    operation: PackagingMaterialOperation;
    amount: number;
    notes?: string;
    pricePerUnit?: number;
  }): Promise<{ success: boolean; message: string }> => {
    const sizeRule = packagingMaterialRules
      .flatMap((rule) => rule.size_rules || [])
      .find((row) => row.id === data.sizeRuleId);
    if (!sizeRule) {
      addFlashMessage('صف خامة التشغيل غير موجود', 'danger');
      return { success: false, message: 'صف خامة التشغيل غير موجود' };
    }

    try {
      const res = await api.recordPackagingMaterialTransaction({
        size_rule_id: data.sizeRuleId,
        operation: data.operation,
        amount: data.amount,
        notes: data.notes || '',
        timestamp: new Date().toISOString(),
        // سعر الوحدة يُرسل فقط عند إدخاله صريحاً من واجهة مصرح لها (حتى لا نمسح السعر المحفوظ).
        ...(canEditAssemblyPrices() && data.pricePerUnit !== undefined
          ? { price_per_unit: Math.max(0, Number(data.pricePerUnit) || 0) }
          : {})
      });
      const saved: PackagingMaterialSizeRule | undefined = res?.sizeRule;
      if (saved && saved.id) {
        setPackagingMaterialRules((prev) =>
          prev.map((rule) => ({
            ...rule,
            size_rules: (rule.size_rules || []).map((row) =>
              row.id === saved.id ? { ...row, ...saved } : row
            )
          }))
        );
      }
      refreshState();
      logAction(
        'خامات التشغيل',
        `حركة ${data.operation} بمقدار ${data.amount} لخامة ${sizeRule.rule_key || ''} - ${sizeRule.size_group_name || 'كل المقاسات'}`
      );
      addFlashMessage('تم تسجيل حركة مخزون خامة التشغيل بنجاح');
      return { success: true, message: 'تم تسجيل الحركة بنجاح' };
    } catch (err: any) {
      refreshState();
      const message = err?.message || 'فشل تسجيل حركة خامة التشغيل في الباك إند';
      addFlashMessage(message, 'danger');
      return { success: false, message };
    }
  };

  // Settings Actions

  return {
    setPackagingStep,
    startFinishing,
    receiveFinishing,
    startIroning,
    receiveIroning,
    ASSEMBLY_STAGE_STATUS_MAP,
    ASSEMBLY_STAGE_NEXT_STATUS_MAP,
    startAssemblyStage,
    receiveAssemblyStage,
    savePackagingMaterialRule,
    deletePackagingMaterialRule,
    recordPackagingMaterialTransaction
  };
};
