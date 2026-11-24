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

export const buildPrintSewingActions = (ctx: AppInternalContext) => {
  const {
    currentUser, setCurrentUser, setCurrentUserState, isLoadingState, setIsLoadingState, globalSettings, setGlobalSettings, roles, setRoles, users, setUsers, onlineUsers, setOnlineUsers, sizeDefs, setSizeDefs, suppliers, setSuppliers, workshops, setWorkshops, fabrics, setFabrics, fabricColorsRaw, setFabricColors, fabricColors, fabricTransactions, setFabricTransactions, models, setModels, requirements, setRequirements, accessories, setAccessories, accessoryTypes, setAccessoryTypes, accessoryItemsRaw, setAccessoryItems, accessoryItems, accessoryTransactions, setAccessoryTransactions, cuttingRecords, setCuttingRecords, qcRecords, setQcRecords, printDispatches, setPrintDispatches, sewingDispatches, setSewingDispatches, packagingRequirements, setPackagingRequirements, finishingRecords, setFinishingRecords, assemblyStageRecords, setAssemblyStageRecords, packagingMaterialRules, setPackagingMaterialRules, internalMessages, setInternalMessages, auditLogs, setAuditLogs, flashMessages, setFlashMessages, readNotificationIds, setReadNotificationIds, snoozedNotifications, setSnoozedNotifications, designModelIdsSet, removeFlashMessage, addFlashMessage, refreshState, login, logout, logAction, updateGlobalSettings, formatSupplierWhatsappMessage, openWhatsAppOrder, addModelTimelineEvent, addRole, updateRole, deleteRole, sendInternalMessage, markMessageRead, normalizePartKey, getModelParts, getModelColorList, getModelSizeList, getPackagingRequirement, getPartStages, isPackagingReady, getUserPermissionsObject, hasSpecificPermission, hasPermission, hasAssemblyPackagingAccess, canManagePermissions, canManageUsers, canManageSuppliers, canManageSizes, canViewAuditLogs, canViewGlobalSettings, canEditHeaderSettings, canEditMessageTemplates, canAccessSettings, isCurrentUserSudo, canAccessHRSection, canManageHR, currentUserRank, visibleRankLevels, visibleRankOptions, rankLabelFor, isRankVisibleToActor, clampRankToVisible, getEffectiveDelegatablePermissions, canDelegatePermission, getRoleEnabledPermissionKeys, isRoleAssignable, getCreatedDescendants, canAddDesignNotes, canAddCuttingNotes, canAddQCBeforePrintNotes, canAddQCAfterPrintNotes, canAddSewingNotes, canAddPrintingNotes, canViewFabricPrices, canEditFabricPrices, canViewAccessoryPrices, canEditAccessoryPrices, canViewPrintingPrices, canEditPrintingPrices, canViewPrintingCosts, canEditPrintingCosts, canViewSewingPrices, canEditSewingPrices, canViewAssemblyPrices, canEditAssemblyPrices, canSendWhatsApp, canSendMessages, addModelAccessory
  } = ctx;

  const addPrintDispatch = (data: {
    modelId: string;
    shopName: string;
    piecesCount: number;
    printType: string;
    pieceType?: GarmentPart;
    pieceLabel?: string;
    printLocation?: string;
    printDetails?: string;
    expectedDeliveryDate?: string;
    costPerPiece?: number;
    totalCost?: number;
    notes?: string;
  }) => {
    const targetModel = models.find((m) => m.id === data.modelId);
    const dispId = 'disp-' + Date.now();
    const dispatchedAt = new Date().toLocaleString('ar-EG', { hour12: false });
    const cleanNotes = canAddPrintingNotes() || canAddQCBeforePrintNotes() ? (data.notes?.trim() || '') : '';
    const pieceType = data.pieceType || 'shirt';
    const pieceLabel = (data.pieceLabel || '').trim() || getPartLabel(pieceType);
    const printLocation = (data.printLocation || '').trim();
    const printDetails = (data.printDetails || '').trim();
    // سعر الطباعة يُرسل فقط لمن يملك edit_printing_prices (الباك إند يرفض غير المصرح بـ 403).
    const canSetPrintPrice = canEditPrintingPrices();
    const printCost = canSetPrintPrice ? Math.max(0, Number(data.costPerPiece) || 0) : 0;
    const printTotal = canSetPrintPrice
      ? Math.max(0, Number(data.totalCost) || printCost * Math.max(0, data.piecesCount))
      : 0;

    const newDisp: PrintDispatch = {
      id: dispId,
      model_id: data.modelId,
      shop_name: data.shopName.trim(),
      piece_type: pieceType,
      piece_label: pieceLabel,
      print_location: printLocation,
      print_details: printDetails,
      dispatched_at: dispatchedAt,
      expected_delivery_date: data.expectedDeliveryDate,
      pieces_count: Math.max(0, data.piecesCount),
      print_type: data.printType.trim(),
      ...(canSetPrintPrice ? { cost_per_piece: printCost, total_cost: printTotal } : {}),
      notes: cleanNotes,
      status: 'مرسل للمطبعة'
    };
    setPrintDispatches((prev) => [newDisp, ...prev]);

    setModels((prev) =>
      prev.map((m) => {
        if (m.id !== data.modelId) return m;
        const withPrint: DesignModel = {
          ...m,
          print_house_name: data.shopName.trim(),
          print_house: data.shopName.trim(),
          ...(canSetPrintPrice ? { print_cost: printCost } : {}),
          print_expected_date: data.expectedDeliveryDate
        };
        // Only the dispatched part is at the printing stage.
        return patchModelPartStage(withPrint, pieceType, 'printing');
      })
    );

    api
      .createPrintDispatch({
        id: dispId,
        model_id: data.modelId,
        shop_name: data.shopName.trim(),
        piece_type: pieceType,
        piece_label: pieceLabel,
        print_location: printLocation,
        print_details: printDetails,
        pieces_count: Math.max(0, data.piecesCount),
        print_type: data.printType.trim(),
        ...(canSetPrintPrice ? { cost_per_piece: printCost } : {}),
        expected_delivery_date: data.expectedDeliveryDate || null,
        dispatched_at: dispatchedAt,
        notes: cleanNotes,
        user_name: currentUser?.real_name || 'مسؤول المطابع'
      })
      .then((saved) => {
        setPrintDispatches((prev) => prev.map((d) => (d.id === dispId ? saved : d)));
        refreshState();
        logAction(
          'المطابع والتطريز',
          `إرسال ${data.piecesCount} قطعة من موديل ${targetModel?.model_code} إلى ${data.shopName}`
        );
        addFlashMessage(`تم إرسال الموديل للمطبعة (${data.shopName}) بنجاح`);
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تسجيل إرسالية المطبعة في الباك إند', 'danger');
      });
  };

  const updateDispatchStatus = (
    dispatchId: string,
    status: DispatchStatus,
    receivedQty?: number,
    notes?: string
  ) => {
    const disp = printDispatches.find((d) => d.id === dispatchId);
    if (!disp) return;

    const totalPieces = Math.max(0, Number(disp.pieces_count || 0));
    const alreadyReceived = Math.max(0, Number(disp.received_pieces || 0));
    const remainingBefore = Math.max(0, totalPieces - alreadyReceived);
    const requestedQty = receivedQty && receivedQty > 0 ? Math.floor(Number(receivedQty)) : 0;
    const isReceiving = status === 'تم الاستلام بالمصنع' || requestedQty > 0;
    const cleanNotes = notes?.trim() || '';

    if (isReceiving && remainingBefore === 0) {
      addFlashMessage('تم استلام كامل كمية هذه التشغيلة مسبقاً', 'danger');
      return;
    }
    if (isReceiving && (requestedQty <= 0 || requestedQty > remainingBefore)) {
      addFlashMessage(
        requestedQty <= 0
          ? 'يجب إدخال كمية استلام موجبة أكبر من صفر'
          : `الكمية المتبقية عند المطبعة ${remainingBefore} قطعة فقط`,
        'danger'
      );
      return;
    }

    // الاستلام الجزئي على دفعات: كل استلام يضيف الكمية المستلمة ويحفظ سجل الدفعة.
    const batchQty = isReceiving ? requestedQty : 0;
    const newReceived = isReceiving ? alreadyReceived + batchQty : alreadyReceived;
    const isComplete = isReceiving && newReceived >= totalPieces;
    const resolvedStatus: DispatchStatus = isReceiving
      ? isComplete
        ? 'تم الاستلام بالمصنع'
        : 'استلام جزئي'
      : status;
    const nowStr = new Date().toLocaleString('ar-EG', { hour12: false });

    setPrintDispatches((prev) =>
      prev.map((d) => {
        if (d.id !== dispatchId) return d;
        if (!isReceiving) return { ...d, status };
        const unitCost = d.cost_per_piece;
        return {
          ...d,
          status: resolvedStatus,
          received_pieces: newReceived,
          remaining_pieces: Math.max(0, totalPieces - newReceived),
          ...(unitCost !== null && unitCost !== undefined
            ? { total_cost: Math.round(Number(unitCost) * newReceived * 100) / 100 }
            : {}),
          receive_history: [
            ...(d.receive_history || []),
            {
              date: nowStr,
              qty: batchQty,
              total_received: newReceived,
              user: currentUser?.real_name || 'مسؤول المطابع',
              notes: cleanNotes
            }
          ],
          received_at: nowStr
        };
      })
    );

    // لا نُرقّي القطعة إلى «العد بعد الطباعة» إلا بعد اكتمال استلام كامل الكمية.
    if (isComplete) {
      const receivedPart = (disp.piece_type || 'shirt') as GarmentPart;
      setModels((prev) =>
        prev.map((m) =>
          m.id === disp.model_id ? patchModelPartStage(m, receivedPart, 'qc_after_print') : m
        )
      );
    }

    api
      .updatePrintDispatchStatus(
        dispatchId,
        status,
        currentUser?.real_name || 'مسؤول المطابع',
        auditHeadersForModel(
          models.find((m) => m.id === disp.model_id),
          'المطابع والتطريز'
        ),
        isReceiving ? batchQty : undefined,
        cleanNotes || undefined
      )
      .then((saved) => {
        setPrintDispatches((prev) => prev.map((d) => (d.id === dispatchId ? saved : d)));
        refreshState();
        logAction(
          'المطابع والتطريز',
          isReceiving
            ? `استلام دفعة (${batchQty} قطعة) من إرسالية ${disp.shop_name} — إجمالي المستلم ${newReceived} من ${totalPieces}`
            : `تحديث حالة الإرسالية إلى: ${status}`
        );
        addFlashMessage(
          isReceiving
            ? `تم استلام دفعة (${batchQty} قطعة) — إجمالي المستلم ${newReceived} من ${totalPieces}${
                isComplete ? ' واكتمال الاستلام' : ''
              }`
            : `تم تحديث حالة التشغيل إلى "${status}" بنجاح`
        );
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تحديث حالة الإرسالية في الباك إند', 'danger');
      });
  };

  /** Skips printing for one part and sends it straight to sewing. */
  const skipPrintToSewing = (modelId: string, part: GarmentPart) => {
    const targetModel = models.find((m) => m.id === modelId);
    const resolvedPart = normalizePartKey(part);

    setModels((prev) =>
      prev.map((m) =>
        m.id === modelId ? patchModelPartStage(m, resolvedPart, 'sewing') : m
      )
    );

    api
      .skipPrintToSewing(modelId, resolvedPart, currentUser?.real_name || 'مسؤول المطابع')
      .then((saved) => {
        if (saved) {
          setModels((prev) => prev.map((m) => (m.id === modelId ? saved : m)));
        }
        refreshState();
        logAction(
          'المطابع والتطريز',
          `تخطي المطابع للقطعة [${getPartLabel(resolvedPart)}] من موديل ${targetModel?.model_code} وتحويلها لقسم المكن`
        );
        addFlashMessage(
          `تم تخطي المطابع وتحويل [${getPartLabel(resolvedPart)}] إلى قسم المكن بنجاح`
        );
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تخطي مرحلة المطابع في الباك إند', 'danger');
      });
  };

  // Sewing Section Actions
  const dispatchModelToSewing = (data: {
    modelId: string;
    workshopName: string;
    piecesCount: number;
    expectedDeliveryDate: string;
    pieceType?: GarmentPart;
    pieceLabel?: string;
    costPerPiece?: number;
    totalCost?: number;
    notes?: string;
  }) => {
    const targetModel = models.find((m) => m.id === data.modelId);
    const resolvedType = data.pieceType || 'shirt';
    const resolvedLabel = data.pieceLabel || getPartLabel(resolvedType);
    const dispId = 'sew-disp-' + Date.now();
    const cleanNotes = canAddSewingNotes() ? (data.notes?.trim() || '') : '';
    // السعر يُرسل فقط لمن يملك صلاحية تعديل أسعار المكن.
    const canSetPrice = canEditSewingPrices();
    const piecePrice = canSetPrice ? Math.max(0, Number(data.costPerPiece) || 0) : 0;
    const totalPrice = canSetPrice
      ? Math.max(
          0,
          Number(data.totalCost) || piecePrice * Math.max(0, data.piecesCount)
        )
      : 0;

    const newDisp: SewingDispatch = {
      id: dispId,
      model_id: data.modelId,
      piece_type: resolvedType,
      piece_label: resolvedLabel,
      workshop_name: data.workshopName.trim(),
      pieces_count: Math.max(0, data.piecesCount),
      dispatched_at: new Date().toLocaleString('ar-EG', { hour12: false }),
      expected_delivery_date: data.expectedDeliveryDate,
      status: 'في ورشة المكن',
      notes: cleanNotes,
      ...(canSetPrice ? { cost_per_piece: piecePrice, total_cost: totalPrice } : {})
    };
    setSewingDispatches((prev) => [newDisp, ...prev]);

    setModels((prev) =>
      prev.map((m) => {
        if (m.id !== data.modelId) return m;
        const updates: Partial<DesignModel> = {
          sewing_workshop: data.workshopName.trim(),
          sewing_expected_date: data.expectedDeliveryDate,
          sewing_pieces_count: data.piecesCount
        };
        if (resolvedType === 'shirt') {
          updates.sewing_shirt_workshop = data.workshopName.trim();
          updates.sewing_shirt_expected_date = data.expectedDeliveryDate;
          updates.sewing_shirt_status = 'في ورشة المكن';
          updates.sewing_shirt_pieces = data.piecesCount;
        } else if (resolvedType === 'pants') {
          updates.sewing_pants_workshop = data.workshopName.trim();
          updates.sewing_pants_expected_date = data.expectedDeliveryDate;
          updates.sewing_pants_status = 'في ورشة المكن';
          updates.sewing_pants_pieces = data.piecesCount;
        }
        // Only the dispatched part moves to sewing.
        return patchModelPartStage({ ...m, ...updates }, resolvedType, 'sewing');
      })
    );

    api
      .dispatchModelToSewing(data.modelId, {
        id: dispId,
        workshop_name: data.workshopName.trim(),
        pieces_count: Math.max(0, data.piecesCount),
        expected_delivery_date: data.expectedDeliveryDate,
        piece_type: resolvedType,
        piece_label: resolvedLabel,
        notes: cleanNotes,
        user_name: currentUser?.real_name || 'مسؤول خطوط الخياطة',
        // حقول السعر تُرسل فقط عند امتلاك edit_sewing_prices (الباك إند يرفض غير المصرح).
        ...(canSetPrice ? { cost_per_piece: piecePrice, total_cost: totalPrice } : {})
      })
      .then((saved) => {
        setSewingDispatches((prev) => prev.map((d) => (d.id === dispId ? saved : d)));
        refreshState();
        logAction(
          'قسم المكن',
          `إرسال ${data.piecesCount} قطعة [${resolvedLabel}] من موديل ${targetModel?.model_code} إلى ورشة ${data.workshopName}`
        );
        addFlashMessage(`تم تسجيل خروج [${resolvedLabel}] لورشة الخياطة (${data.workshopName}) بنجاح`);
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تسجيل خروج الخياطة في الباك إند', 'danger');
      });
  };

  const receiveModelFromSewing = (
    dispatchId: string,
    modelId?: string,
    notes?: string,
    receivedQty?: number
  ) => {
    const disp = sewingDispatches.find((d) => d.id === dispatchId);
    const targetModelId = modelId || disp?.model_id;
    if (!targetModelId) return;
    const targetModel = models.find((m) => m.id === targetModelId);
    const pieceType = disp?.piece_type || 'shirt';
    const pieceLabel = disp?.piece_label || getPartLabel(pieceType);
    const cleanNotes = canAddSewingNotes() ? (notes?.trim() || '') : '';

    // الاستلام الجزئي على دفعات: نحسب المتبقي قبل هذه الدفعة ثم نثبّت حدود الكمية.
    const totalPieces = Math.max(0, Number(disp?.pieces_count || 0));
    const alreadyReceived = Math.max(0, Number(disp?.received_pieces || 0));
    const remainingBefore = Math.max(0, totalPieces - alreadyReceived);
    const requestedQty = receivedQty && receivedQty > 0 ? Math.floor(Number(receivedQty)) : 0;

    if (remainingBefore === 0) {
      addFlashMessage('تم استلام كامل كمية هذه التشغيلة مسبقاً', 'danger');
      return;
    }
    if (requestedQty <= 0 || requestedQty > remainingBefore) {
      addFlashMessage(
        requestedQty <= 0
          ? 'يجب إدخال كمية استلام موجبة أكبر من صفر'
          : `الكمية المتبقية بالورشة ${remainingBefore} قطعة فقط`,
        'danger'
      );
      return;
    }

    const batchQty = requestedQty;
    const newReceived = Math.min(totalPieces, alreadyReceived + batchQty);
    const isComplete = newReceived >= totalPieces;
    const resolvedStatus: SewingDispatchStatus = isComplete ? 'تم الاستلام' : 'استلام جزئي';
    const nowStr = new Date().toLocaleString('ar-EG', { hour12: false });

    const updatedDispatches = sewingDispatches.map((d) => {
      if (d.id !== dispatchId) return d;
      const unitCost = d.cost_per_piece;
      const marker = cleanNotes ? `استلام: ${cleanNotes}` : '';
      const existingNotes = (d.notes || '').trim();
      const mergedNotes =
        cleanNotes && !existingNotes.includes(marker)
          ? (existingNotes ? `${existingNotes} | ${marker}` : marker)
          : d.notes;
      return {
        ...d,
        status: resolvedStatus,
        received_pieces: newReceived,
        remaining_pieces: Math.max(0, totalPieces - newReceived),
        ...(unitCost !== null && unitCost !== undefined
          ? { total_cost: Math.round(Number(unitCost) * newReceived * 100) / 100 }
          : {}),
        receive_history: [
          ...(d.receive_history || []),
          {
            date: nowStr,
            qty: batchQty,
            total_received: newReceived,
            user: currentUser?.real_name || 'مسؤول الإنتاج',
            notes: cleanNotes
          }
        ],
        received_at: nowStr,
        notes: mergedNotes
      };
    });
    setSewingDispatches(updatedDispatches);

    // "All pieces received" only when every other part already reached
    // (or passed) the "العد بعد المكن" stage.
    const qcAfterSewingIndex = PART_STAGE_ORDER.indexOf('qc_after_sewing');
    const allPiecesReceived =
      isComplete && targetModel
        ? getModelParts(targetModelId).every((part) => {
            if (part === pieceType) return true;
            const stage = getPartStages(targetModelId)[part] || 'cutting';
            return PART_STAGE_ORDER.indexOf(stage) >= qcAfterSewingIndex;
          })
        : false;

    if (isComplete) {
      setModels((prev) =>
        prev.map((m) => {
          if (m.id !== targetModelId) return m;
          const updates: Partial<DesignModel> = {};
          // لا نغلق مرحلة المكن للقطعة إلا عند اكتمال استلام كامل كميتها.
          if (pieceType === 'shirt') {
            updates.sewing_shirt_status = 'تم الاستلام';
          } else if (pieceType === 'pants') {
            updates.sewing_pants_status = 'تم الاستلام';
          }
          // Bug fix: only the received part leaves sewing; the sibling part stays put.
          return patchModelPartStage({ ...m, ...updates }, pieceType, 'qc_after_sewing');
        })
      );
    }

    api
      .receiveFromSewing(dispatchId, currentUser?.real_name || 'مسؤول الإنتاج', cleanNotes, batchQty)
      .then((saved) => {
        setSewingDispatches((prev) => prev.map((d) => (d.id === dispatchId ? saved : d)));
        refreshState();
        logAction(
          'قسم المكن',
          `استلام دفعة (${batchQty} قطعة) [${pieceLabel}] موديل ${targetModel?.model_code} من ورشة ${disp?.workshop_name} — إجمالي المستلم ${newReceived} من ${totalPieces}`
        );
        addFlashMessage(
          isComplete
            ? `تم استلام كامل كمية [${pieceLabel}] بنجاح${
                allPiecesReceived ? ' واكتمال القطع ونقل الموديل إلى العد بعد المكن بالفرز' : ''
              }`
            : `تم استلام دفعة (${batchQty} قطعة) من [${pieceLabel}] — المتبقي ${Math.max(
                0,
                totalPieces - newReceived
              )} قطعة بورشة ${disp?.workshop_name || ''}`
        );
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تسجيل الاستلام في الباك إند', 'danger');
      });
  };

  const finishSewingToQC = (modelId: string, notes?: string) => {
    const targetModel = models.find((m) => m.id === modelId);
    const cleanNotes = canAddSewingNotes() ? (notes?.trim() || '') : '';
    setModels((prev) =>
      prev.map((m) => (m.id === modelId ? { ...m, status: 'العد بعد المكن' } : m))
    );

    api
      .finishSewingToQC(modelId, {
        notes: cleanNotes,
        user_name: currentUser?.real_name || 'مسؤول قسم المكن'
      })
      .then((saved) => {
        setModels((prev) => prev.map((m) => (m.id === modelId ? saved : m)));
        logAction('قسم المكن', `إنهاء خياطة الموديل ${targetModel?.model_code} وتحويله للعد النهائي`);
        addFlashMessage('تم إنهاء الخياطة وتحويل الموديل للعد النهائي بعد المكن بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تحديث حالة الخياطة في الباك إند', 'danger');
      });
  };

  const finishQCToProduction = (modelId: string, notes?: string) => {
    const targetModel = models.find((m) => m.id === modelId);
    const cleanNotes = canAddQCAfterPrintNotes() ? (notes?.trim() || '') : '';
    setModels((prev) =>
      prev.map((m) => (m.id === modelId ? { ...m, status: 'مخزن الإنتاج التام' } : m))
    );

    api
      .finishQCToProduction(modelId, {
        notes: cleanNotes,
        user_name: currentUser?.real_name || 'مراقب الجودة'
      })
      .then((saved) => {
        setModels((prev) => prev.map((m) => (m.id === modelId ? saved : m)));
        logAction('الإنتاج', `تحويل الموديل ${targetModel?.model_code} إلى مخزن الإنتاج التام`);
        addFlashMessage('تم تحويل الموديل إلى مخزن الإنتاج التام بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تحويل الموديل لمخزن الإنتاج في الباك إند', 'danger');
      });
  };

  // -----------------------------------------------------------------
  // Assembly & Packaging Actions (الأسمبلي والأمبالاج)
  // -----------------------------------------------------------------


  return {
    addPrintDispatch,
    updateDispatchStatus,
    skipPrintToSewing,
    dispatchModelToSewing,
    receiveModelFromSewing,
    finishSewingToQC,
    finishQCToProduction
  };
};
