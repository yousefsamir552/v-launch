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

export const buildCuttingQcActions = (ctx: AppInternalContext) => {
  const {
    currentUser, setCurrentUser, setCurrentUserState, isLoadingState, setIsLoadingState, globalSettings, setGlobalSettings, roles, setRoles, users, setUsers, onlineUsers, setOnlineUsers, sizeDefs, setSizeDefs, suppliers, setSuppliers, workshops, setWorkshops, fabrics, setFabrics, fabricColorsRaw, setFabricColors, fabricColors, fabricTransactions, setFabricTransactions, models, setModels, requirements, setRequirements, accessories, setAccessories, accessoryTypes, setAccessoryTypes, accessoryItemsRaw, setAccessoryItems, accessoryItems, accessoryTransactions, setAccessoryTransactions, cuttingRecords, setCuttingRecords, qcRecords, setQcRecords, printDispatches, setPrintDispatches, sewingDispatches, setSewingDispatches, packagingRequirements, setPackagingRequirements, finishingRecords, setFinishingRecords, assemblyStageRecords, setAssemblyStageRecords, packagingMaterialRules, setPackagingMaterialRules, internalMessages, setInternalMessages, auditLogs, setAuditLogs, flashMessages, setFlashMessages, readNotificationIds, setReadNotificationIds, snoozedNotifications, setSnoozedNotifications, designModelIdsSet, removeFlashMessage, addFlashMessage, refreshState, login, logout, logAction, updateGlobalSettings, formatSupplierWhatsappMessage, openWhatsAppOrder, addModelTimelineEvent, addRole, updateRole, deleteRole, sendInternalMessage, markMessageRead, normalizePartKey, getModelParts, getModelColorList, getModelSizeList, getPackagingRequirement, getPartStages, isPackagingReady, getUserPermissionsObject, hasSpecificPermission, hasPermission, hasAssemblyPackagingAccess, canManagePermissions, canManageUsers, canManageSuppliers, canManageSizes, canViewAuditLogs, canViewGlobalSettings, canEditHeaderSettings, canEditMessageTemplates, canAccessSettings, isCurrentUserSudo, canAccessHRSection, canManageHR, currentUserRank, visibleRankLevels, visibleRankOptions, rankLabelFor, isRankVisibleToActor, clampRankToVisible, getEffectiveDelegatablePermissions, canDelegatePermission, getRoleEnabledPermissionKeys, isRoleAssignable, getCreatedDescendants, canAddDesignNotes, canAddCuttingNotes, canAddQCBeforePrintNotes, canAddQCAfterPrintNotes, canAddSewingNotes, canAddPrintingNotes, canViewFabricPrices, canEditFabricPrices, canViewAccessoryPrices, canEditAccessoryPrices, canViewPrintingPrices, canEditPrintingPrices, canViewPrintingCosts, canEditPrintingCosts, canViewSewingPrices, canEditSewingPrices, canViewAssemblyPrices, canEditAssemblyPrices, canSendWhatsApp, canSendMessages, addModelAccessory
  } = ctx;

  const addCuttingRecord = (data: {
    modelId: string;
    spreadNumber?: number;
    spreaderName: string;
    cutterName: string;
    colorLayers: CuttingSpreadLayer[];
    colorName?: string;
    layersCount?: number;
    piecesPerLayer: number;
    layerWeight: number;
    piecesCount?: number;
    shadeDegree?: string;
    notes?: string;
    partType?: GarmentPart;
  }) => {
    const recId = 'cut-' + Date.now();
    const createdAt = new Date().toLocaleString('ar-EG', { hour12: false });
    const cleanNotes = canAddCuttingNotes() ? (data.notes?.trim() || '') : '';
    const existingModelSpreads = cuttingRecords.filter((r) => r.model_id === data.modelId);
    const spreadNumber = data.spreadNumber || existingModelSpreads.length + 1;
    const partType: GarmentPart = normalizePartKey(data.partType || 'shirt');

    const piecesPerLayer = Math.max(1, Number(data.piecesPerLayer) || 1);
    const layerWeight = Math.max(0, Number(data.layerWeight) || 0);

    const cleanLayers: CuttingSpreadLayer[] = (data.colorLayers || [])
      .filter((l) => (l.color_name || l.colorName) && Number(l.layers_count ?? l.layersCount ?? 0) > 0)
      .map((l, idx) => {
        const lCount = Math.max(0, Number(l.layers_count ?? l.layersCount ?? 0));
        return {
          id: l.id || `lay-${Date.now()}-${idx}`,
          color_name: (l.color_name || l.colorName || '').trim(),
          colorName: (l.color_name || l.colorName || '').trim(),
          layers_count: lCount,
          layersCount: lCount,
          layer_weight: layerWeight,
          layerWeight: layerWeight,
          pieces_count: lCount * piecesPerLayer,
          piecesCount: lCount * piecesPerLayer,
          shade_degree: (l.shade_degree || l.shadeDegree || '').trim(),
          shadeDegree: (l.shade_degree || l.shadeDegree || '').trim(),
          notes: (l.notes || '').trim()
        };
      });

    const totalLayersCount =
      cleanLayers.length > 0
        ? cleanLayers.reduce((sum, item) => sum + item.layers_count, 0)
        : Math.max(0, Number(data.layersCount) || 0);

    const colorsSummary =
      cleanLayers.length > 0
        ? cleanLayers.map((item) => `${item.color_name} (${item.layers_count} راق)`).join(' + ')
        : data.colorName || '';

    const cleanSpreader = (data.spreaderName || '').trim();
    const cleanCutter = (data.cutterName || '').trim();
    const totalPieces =
      totalLayersCount > 0 && piecesPerLayer > 0
        ? totalLayersCount * piecesPerLayer
        : Math.max(0, Number(data.piecesCount) || 0);

    const newRecord: CuttingRecord = {
      id: recId,
      model_id: data.modelId,
      spread_number: spreadNumber,
      spreadNumber: spreadNumber,
      part_type: partType,
      partType: partType,
      spreader_name: cleanSpreader,
      spreaderName: cleanSpreader,
      cutter_name: cleanCutter,
      cutterName: cleanCutter,
      color_name: colorsSummary,
      colorName: colorsSummary,
      color_layers: cleanLayers,
      colorLayers: cleanLayers,
      layers_count: totalLayersCount,
      layersCount: totalLayersCount,
      pieces_per_layer: piecesPerLayer,
      piecesPerLayer: piecesPerLayer,
      layer_weight: layerWeight,
      layerWeight: layerWeight,
      pieces_count: totalPieces,
      piecesCount: totalPieces,
      shade_degree: data.shadeDegree?.trim() || '',
      shadeDegree: data.shadeDegree?.trim() || '',
      notes: cleanNotes,
      created_at: createdAt
    };
    setCuttingRecords((prev) => [newRecord, ...prev]);

    setModels((prev) =>
      prev.map((m) => {
        if (m.id !== data.modelId) return m;
        // Per-part totals: this spread only adds pieces to its own part.
        const prevPartCut =
          partType === 'pants'
            ? Number(m.cut_pants_pieces || 0)
            : partType === 'jacket'
            ? Number(m.cut_jacket_pieces || 0)
            : Number(m.cut_shirt_pieces || 0);
        const newPartCut = prevPartCut + totalPieces;
        const cutSummary = {
          ...(m.cut_summary || {}),
          [partType]: newPartCut
        } as Partial<Record<GarmentPart, number>>;
        const partValues = Object.values(cutSummary).filter(
          (v): v is number => typeof v === 'number'
        );
        const modelParts = (
          m.parts && m.parts.length > 0
            ? m.parts
            : m.garment_parts && m.garment_parts.length > 0
            ? m.garment_parts
            : getModelParts(m.id)
        ) as GarmentPart[];
        // Legacy aggregate: explicit parts use completed sets (min), legacy models keep the sum.
        const newTotal =
          m.garment_parts && m.garment_parts.length > 0 && partValues.length > 0
            ? Math.min(...partValues)
            : (m.actual_cut_count || 0) + totalPieces;
        const tlEvent: ModelTimelineEvent = {
          id: 'tl-' + Date.now(),
          stage: 'في القص',
          title: `تسجيل فرشة قص #${spreadNumber} - ${getPartLabel(partType)} (${totalPieces} قطعة)`,
          notes: `فرشة رقم #${spreadNumber} | القطعة: ${getPartLabel(partType)} | الفَرّاش: ${cleanSpreader || '-'} | المقصدار: ${cleanCutter} | الألوان والراقات: ${colorsSummary} | إجمالي الراقات: ${totalLayersCount} | عدد القطع في الراق: ${piecesPerLayer} | إجمالي وزن الراق: ${layerWeight} كجم | القطع المقصوصة: ${totalPieces}${cleanNotes ? ` | ملاحظات: ${cleanNotes}` : ''}`,
          user: cleanCutter || cleanSpreader,
          timestamp: createdAt,
          details: {
            phase_type: 'cutting',
            record_id: recId,
            spread_number: spreadNumber,
            spreader_name: cleanSpreader,
            cutter_name: cleanCutter,
            color_name: colorsSummary,
            color_layers: cleanLayers,
            layers_count: totalLayersCount,
            pieces_per_layer: piecesPerLayer,
            layer_weight: layerWeight,
            pieces_count: totalPieces,
            total_cut_pieces_so_far: newTotal,
            shade_degree: data.shadeDegree?.trim() || '',
            worker_notes: cleanNotes,
            operator_name: cleanCutter || cleanSpreader
          }
        };
        return {
          ...m,
          actual_cut_count: newTotal,
          total_cut_pieces: newTotal,
          completed_sets: newTotal,
          cut_shirt_pieces: partType === 'shirt' ? newPartCut : (m.cut_shirt_pieces || 0),
          cut_pants_pieces: partType === 'pants' ? newPartCut : (m.cut_pants_pieces || 0),
          cut_jacket_pieces: partType === 'jacket' ? newPartCut : (m.cut_jacket_pieces || 0),
          cut_summary: cutSummary,
          parts: modelParts,
          cutter_name: cleanCutter,
          spreader_name: cleanSpreader,
          timeline: [tlEvent, ...(m.timeline || [])]
        };
      })
    );

    api
      .createCuttingRecord({
        id: recId,
        model_id: data.modelId,
        spread_number: spreadNumber,
        part_type: partType,
        spreader_name: cleanSpreader,
        cutter_name: cleanCutter,
        color_name: colorsSummary,
        color_layers: cleanLayers,
        layers_count: totalLayersCount,
        pieces_per_layer: piecesPerLayer,
        layer_weight: layerWeight,
        pieces_count: totalPieces,
        shade_degree: data.shadeDegree?.trim() || '',
        notes: cleanNotes,
        created_at: createdAt
      })
      .then((saved) => {
        setCuttingRecords((prev) => prev.map((r) => (r.id === recId ? saved : r)));
        logAction('القص', `تسجيل فرشة قص #${spreadNumber} للموديل: ${totalPieces} قطعة (${totalLayersCount} راق × ${piecesPerLayer} قطعة/راق | إجمالي وزن الراق: ${layerWeight} كجم)`);
        addFlashMessage(`تم تسجيل الفرشة رقم #${spreadNumber} بنجاح (${totalPieces} قطعة مقصوصة)`);
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تسجيل الفرشة في الباك إند', 'danger');
      });
  };

  const finishCuttingToQC = (modelId: string, notes?: string, parts?: GarmentPart[]) => {
    const model = models.find((m) => m.id === modelId);
    const cleanNotes = canAddCuttingNotes() ? (notes?.trim() || '') : '';
    const targetParts =
      parts && parts.length > 0 ? parts.map((part) => normalizePartKey(part)) : undefined;
    const partsLabel = targetParts
      ? targetParts.map((part) => getPartLabel(part)).join(' + ')
      : 'جميع القطع';

    setModels((prev) =>
      prev.map((m) =>
        m.id === modelId ? patchModelPartsStage(m, 'qc_before_print', targetParts) : m
      )
    );

    api
      .finishCuttingToQC(
        modelId,
        currentUser?.real_name || 'مسؤول القص',
        cleanNotes,
        targetParts
      )
      .then((savedModel) => {
        setModels((prev) => prev.map((m) => (m.id === modelId ? savedModel : m)));
        logAction('القص', `إنهاء قص [${partsLabel}] من الموديل ${model?.model_code} وتحويلها للعد والفرز قبل الطباعة`);
        addFlashMessage(`تم إنهاء قص [${partsLabel}] وتحويلها لقسم الفرز (العد قبل الطباعة) بنجاح`);
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تحويل الموديل في الباك إند', 'danger');
      });
  };

  const exportCuttingCsv = (modelId: string) => {
    const targetModel = models.find((m) => m.id === modelId);
    const records = cuttingRecords.filter((r) => r.model_id === modelId);
    const headers = [
      'كود الموديل',
      'رقم الفرشة',
      'اسم الفراش (Spreader)',
      'الألوان والراقات داخل الفرشة',
      'إجمالي الراقات',
      'عدد القطع في الراق',
      'إجمالي وزن الراق (كجم)',
      'عدد القطع المقصوصة (الراقات × قطع الراق)',
      'اسم المقصدار (Cutter)',
      'درجة الصبغة',
      'الملاحظات',
      'تاريخ ووقت التسجيل'
    ];
    const rows: CsvValue[][] = records.map((r, idx) => [
      targetModel?.model_code || modelId,
      r.spread_number || idx + 1,
      r.spreader_name || r.spreaderName || '-',
      r.color_name || '-',
      r.layers_count,
      r.pieces_per_layer ?? r.piecesPerLayer ?? 0,
      r.layer_weight,
      r.pieces_count,
      r.cutter_name || '-',
      r.shade_degree || '-',
      r.notes || '-',
      r.created_at
    ]);

    exportCsv(
      `cutting_spreads_${targetModel?.model_code || 'records'}_${new Date().toISOString().slice(0, 10)}`,
      headers,
      rows
    );

    logAction('القص', `تصدير سجل فرشات القص للموديل ${targetModel?.model_code} إلى إكسيل`);
    addFlashMessage('تم تصدير سجل فرشات القص بنجاح');
  };

  // QC Actions (Matrix per Color x Size)
  const recordQCData = (data: {
    modelId: string;
    colorName: string;
    size: string;
    goodQty: number;
    defectQty: number;
    defectNotes?: string;
    stage?: QCStageType;
    partType?: GarmentPart;
  }) => {
    const stage = data.stage || 'before_print';
    const partType: GarmentPart = normalizePartKey(data.partType || 'shirt');
    const allowNotes =
      stage === 'before_print' ? canAddQCBeforePrintNotes() : canAddQCAfterPrintNotes();
    const cleanNotes = allowNotes ? (data.defectNotes?.trim() || '') : '';
    const qcId = 'qc-' + Date.now();
    const createdAt = new Date().toLocaleString('ar-EG', { hour12: false });

    const newQC: QCRecord = {
      id: qcId,
      model_id: data.modelId,
      stage,
      part_type: partType,
      partType: partType,
      color_name: data.colorName,
      size: data.size,
      good_qty: Math.max(0, data.goodQty),
      defect_qty: Math.max(0, data.defectQty),
      counted_pieces: Math.max(0, data.goodQty),
      defect_pieces: Math.max(0, data.defectQty),
      defect_notes: cleanNotes,
      notes: cleanNotes,
      inspector_name: currentUser?.real_name || 'مراقب الجودة',
      created_at: createdAt
    };

    setQcRecords((prev) => {
      const existingIdx = prev.findIndex(
        (q) =>
          q.model_id === data.modelId &&
          q.stage === stage &&
          (q.part_type || 'shirt') === partType &&
          q.color_name === data.colorName &&
          q.size === data.size
      );
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = { ...updated[existingIdx], ...newQC, id: updated[existingIdx].id };
        return updated;
      }
      return [newQC, ...prev];
    });

    api
      .createQCRecord({
        id: qcId,
        model_id: data.modelId,
        stage,
        part_type: partType,
        color_name: data.colorName,
        size: data.size,
        good_qty: Math.max(0, data.goodQty),
        defect_qty: Math.max(0, data.defectQty),
        defect_notes: cleanNotes,
        inspector_name: currentUser?.real_name || 'مراقب الجودة',
        created_at: createdAt
      })
      .then((saved) => {
        setQcRecords((prev) => {
          const filtered = prev.filter(
            (q) =>
              !(
                q.model_id === data.modelId &&
                q.stage === stage &&
                q.color_name === data.colorName &&
                q.size === data.size &&
                q.id !== saved.id
              )
          );
          const exists = filtered.some((q) => q.id === saved.id);
          return exists
            ? filtered.map((q) => (q.id === saved.id ? saved : q))
            : [saved, ...filtered];
        });
        logAction('الفرز', `تسجيل بيانات فرز (${stage}) [${data.colorName} - مقاس ${data.size}]: سليم: ${data.goodQty}، تالف: ${data.defectQty}`);
        addFlashMessage('تم حفظ خلية الفرز بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تسجيل بيانات الفرز في الباك إند', 'danger');
      });
  };

  const saveQCMatrix = (data: {
    modelId: string;
    stage: QCStageType;
    matrixEntries: QCMatrixCellInput[];
    notes?: string;
    partType?: GarmentPart;
  }) => {
    const allowNotes =
      data.stage === 'before_print' ? canAddQCBeforePrintNotes() : canAddQCAfterPrintNotes();
    const cleanNotes = allowNotes ? (data.notes?.trim() || '') : '';
    const inspector = currentUser?.real_name || 'مراقب الجودة';
    const createdAt = new Date().toLocaleString('ar-EG', { hour12: false });
    const partType: GarmentPart = normalizePartKey(data.partType || 'shirt');
    const entries = data.matrixEntries.map((entry) => ({
      ...entry,
      part_type: entry.part_type || partType
    }));

    api
      .saveQCMatrix({
        model_id: data.modelId,
        stage: data.stage,
        part_type: partType,
        matrix_entries: entries,
        notes: cleanNotes,
        inspector_name: inspector,
        created_at: createdAt
      })
      .then((res) => {
        if (res.model) {
          setModels((prev) => prev.map((m) => (m.id === data.modelId ? res.model : m)));
        }
        if (Array.isArray(res.qcRecords)) {
          setQcRecords((prev) => {
            // Only replace this part's cells; keep the other parts' records intact.
            const otherRecords = prev.filter(
              (q) =>
                !(
                  q.model_id === data.modelId &&
                  q.stage === data.stage &&
                  (q.part_type || 'shirt') === partType
                )
            );
            return [...res.qcRecords, ...otherRecords];
          });
        }
        logAction('الفرز', `حفظ جدول مصفوفة الفرز (${data.stage} - ${getPartLabel(partType)}) للموديل`);
        addFlashMessage('تم حفظ جدول الفرز (الألوان × المقاسات) بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل حفظ جدول الفرز في الباك إند', 'danger');
      });
  };

  const recordQCStageCount = (data: {
    modelId: string;
    stage: QCStageType;
    piecesCounted?: number;
    defectQty?: number;
    matrixEntries?: QCMatrixCellInput[];
    defectNotes?: string;
    advanceStage?: boolean;
    partType?: GarmentPart;
  }) => {
    const model = models.find((m) => m.id === data.modelId);
    if (!model) return;
    const partType: GarmentPart = normalizePartKey(data.partType || 'shirt');

    const allowNotes =
      data.stage === 'before_print' ? canAddQCBeforePrintNotes() : canAddQCAfterPrintNotes();
    const cleanNotes = allowNotes ? (data.defectNotes?.trim() || '') : '';
    const qcId = 'qc-' + Date.now();
    const createdAt = new Date().toLocaleString('ar-EG', { hour12: false });
    const inspector = currentUser?.real_name || 'مراقب الجودة';

    const matrixList = (data.matrixEntries || []).map((cell) => ({
      ...cell,
      part_type: cell.part_type || partType
    }));
    const totalGoodFromMatrix =
      matrixList.length > 0
        ? matrixList.reduce((sum, cell) => sum + (Number(cell.good_qty) || 0), 0)
        : Number(data.piecesCounted) || 0;
    const totalDefectFromMatrix =
      matrixList.length > 0
        ? matrixList.reduce((sum, cell) => sum + (Number(cell.defect_qty) || 0), 0)
        : Number(data.defectQty) || 0;

    if (matrixList.length > 0) {
      const optimisticRecords: QCRecord[] = matrixList.map((cell, idx) => ({
        id: `qc-${Date.now()}-${idx}`,
        model_id: data.modelId,
        stage: data.stage,
        part_type: cell.part_type || partType,
        partType: cell.part_type || partType,
        color_name: cell.color_name,
        size: cell.size,
        pieces_cut: model.actual_cut_count || model.target_cut_quantity,
        good_qty: Math.max(0, Number(cell.good_qty) || 0),
        defect_qty: Math.max(0, Number(cell.defect_qty) || 0),
        counted_pieces: Math.max(0, Number(cell.good_qty) || 0),
        defect_pieces: Math.max(0, Number(cell.defect_qty) || 0),
        defect_notes: cell.notes || cleanNotes,
        notes: cell.notes || cleanNotes,
        inspector_name: inspector,
        created_at: createdAt
      }));

      setQcRecords((prev) => {
        const others = prev.filter(
          (q) =>
            !(
              q.model_id === data.modelId &&
              q.stage === data.stage &&
              (q.part_type || 'shirt') === partType
            )
        );
        return [...optimisticRecords, ...others];
      });
    } else {
      const newQC: QCRecord = {
        id: qcId,
        model_id: data.modelId,
        stage: data.stage,
        part_type: partType,
        partType: partType,
        color_name: model.model_type || 'الأساسي',
        pieces_cut: model.actual_cut_count || model.target_cut_quantity,
        good_qty: totalGoodFromMatrix,
        defect_qty: totalDefectFromMatrix,
        counted_pieces: totalGoodFromMatrix,
        defect_pieces: totalDefectFromMatrix,
        defect_notes: cleanNotes,
        notes: cleanNotes,
        inspector_name: inspector,
        created_at: createdAt
      };
      setQcRecords((prev) => [newQC, ...prev]);
    }

    setModels((prev) =>
      prev.map((m) => {
        if (m.id !== data.modelId) return m;
        const qcSummary = {
          ...(m.qc_summary || {}),
          [partType]: totalGoodFromMatrix
        } as Partial<Record<GarmentPart, number>>;
        const patched: DesignModel = {
          ...m,
          qc_shirt_pieces: partType === 'shirt' ? totalGoodFromMatrix : (m.qc_shirt_pieces || 0),
          qc_pants_pieces: partType === 'pants' ? totalGoodFromMatrix : (m.qc_pants_pieces || 0),
          qc_jacket_pieces: partType === 'jacket' ? totalGoodFromMatrix : (m.qc_jacket_pieces || 0),
          qc_summary: qcSummary
        };
        if (data.stage === 'before_print') {
          const withCount: DesignModel = {
            ...patched,
            count_before_print: totalGoodFromMatrix
          };
          return data.advanceStage
            ? patchModelPartStage(withCount, partType, 'printing')
            : withCount;
        }
        if (data.stage === 'after_print') {
          const withCount: DesignModel = {
            ...patched,
            count_after_print: totalGoodFromMatrix
          };
          return data.advanceStage
            ? patchModelPartStage(withCount, partType, 'sewing')
            : withCount;
        }
        const withCount: DesignModel = {
          ...patched,
          count_after_sewing: totalGoodFromMatrix
        };
        return data.advanceStage
          ? patchModelPartStage(withCount, partType, 'finishing')
          : withCount;
      })
    );

    api
      .recordQCStageCount(data.modelId, {
        qc_id: qcId,
        stage: data.stage,
        part_type: partType,
        counted_pieces: totalGoodFromMatrix,
        defect_pieces: totalDefectFromMatrix,
        matrix_entries: matrixList,
        notes: cleanNotes,
        advanceStage: data.advanceStage,
        user_name: inspector
      })
      .then((res) => {
        if (res.model) {
          setModels((prev) => prev.map((m) => (m.id === data.modelId ? res.model : m)));
        }
        if (Array.isArray(res.qcRecords) && res.qcRecords.length > 0) {
          setQcRecords((prev) => {
            const others = prev.filter(
              (q) =>
                !(
                  q.model_id === data.modelId &&
                  q.stage === data.stage &&
                  (q.part_type || 'shirt') === partType
                )
            );
            return [...res.qcRecords!, ...others];
          });
        } else if (res.qcRecord) {
          setQcRecords((prev) => prev.map((q) => (q.id === qcId ? res.qcRecord : q)));
        }
        addFlashMessage('تم تسجيل مصفوفة العد والفرز واعتماد المرحلة بنجاح');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل تسجيل العد في الباك إند', 'danger');
      });
  };

  const finishQCApproval = (modelId: string) => {
    const model = models.find((m) => m.id === modelId);
    setModels((prev) =>
      prev.map((m) => (m.id === modelId ? { ...m, status: 'جاهز للطباعة / التجميع' } : m))
    );
    api
      .finishQCApproval(modelId, currentUser?.real_name || 'مراقب الجودة')
      .then((saved) => {
        setModels((prev) => prev.map((m) => (m.id === modelId ? saved : m)));
        logAction('الفرز', `الاعتماد النهائي للفرز لموديل ${model?.model_code}`);
        addFlashMessage('تم إنهاء الفرز والاعتماد بنجاح، الموديل الآن متاح في قسم المطابع والتطريز');
      })
      .catch((err) => {
        refreshState();
        addFlashMessage(err.message || 'فشل الاعتماد في الباك إند', 'danger');
      });
  };

  const exportQcCsv = (modelId: string) => {
    const targetModel = models.find((m) => m.id === modelId);
    const records = qcRecords.filter((r) => r.model_id === modelId);
    const headers = [
      'المرحلة',
      'كود الموديل',
      'اللون / القطعة',
      'المقاس',
      'العدد السليم',
      'العدد التالف (الهالك)',
      'المفتش',
      'ملاحظات العيوب',
      'تاريخ ووقت الفرز'
    ];
    const rows: CsvValue[][] = records.map((r) => [
      r.stage === 'before_print'
        ? 'العد قبل الطباعة'
        : r.stage === 'after_print'
        ? 'العد بعد الطباعة'
        : 'العد بعد المكن',
      targetModel?.model_code || modelId,
      r.color_name || '-',
      r.size || '-',
      r.good_qty ?? r.counted_pieces ?? 0,
      r.defect_qty ?? r.defect_pieces ?? 0,
      r.inspector_name || '-',
      r.defect_notes || r.notes || '-',
      r.created_at
    ]);

    exportCsv(
      `qc_matrix_${targetModel?.model_code || 'records'}_${new Date().toISOString().slice(0, 10)}`,
      headers,
      rows
    );

    logAction('الفرز', `تصدير جدول مصفوفة الجودة للموديل ${targetModel?.model_code} إلى إكسيل`);
    addFlashMessage('تم تصدير جدول الفرز والجودة بنجاح');
  };

  // -------------------------------------------------------------------------
  // Unified exports (Excel/CSV) — columns are permission-aware.
  // -------------------------------------------------------------------------

  return {
    addCuttingRecord,
    finishCuttingToQC,
    exportCuttingCsv,
    recordQCData,
    saveQCMatrix,
    recordQCStageCount,
    finishQCApproval,
    exportQcCsv
  };
};
