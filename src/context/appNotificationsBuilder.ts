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
import { NOTIFICATION_STAGE_PERMISSION, AppInternalContext } from './appContextTypes';

export const buildAppNotifications = (ctx: Pick<AppInternalContext, 'printDispatches' | 'sewingDispatches' | 'finishingRecords' | 'assemblyStageRecords' | 'packagingMaterialRules' | 'models' | 'readNotificationIds'>): AppNotification[] => {
  const {
    printDispatches, sewingDispatches, finishingRecords,
    assemblyStageRecords, packagingMaterialRules, models, readNotificationIds
  } = ctx;
    const list: AppNotification[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    printDispatches.forEach((disp) => {
      if (disp.status === 'تم الاستلام بالمصنع' || !disp.expected_delivery_date) return;
      const model = models.find((m) => m.id === disp.model_id);
      const modelCode = model?.model_code || 'موديل';

      const expDate = new Date(disp.expected_delivery_date);
      expDate.setHours(0, 0, 0, 0);
      const diffDays = Math.round((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      const notifId = `notif-print-${disp.id}-${disp.expected_delivery_date}`;

      if (diffDays < 0) {
        list.push({
          id: notifId,
          model_id: disp.model_id,
          model_code: modelCode,
          stage: 'printing',
          source_name: disp.shop_name,
          expected_date: disp.expected_delivery_date,
          urgency: 'overdue',
          days_diff: diffDays,
          title: `🚨 تأخر استلام من المطبعة (${modelCode})`,
          message: `تخطى موعد استلام الموديل ${modelCode} من مطبعة ${disp.shop_name} بمقدار ${Math.abs(diffDays)} يوم، ولم يتم تسجيل الاستلام بعد!`,
          is_read: readNotificationIds.includes(notifId),
          created_at: disp.dispatched_at
        });
      } else if (diffDays === 0) {
        list.push({
          id: notifId,
          model_id: disp.model_id,
          model_code: modelCode,
          stage: 'printing',
          source_name: disp.shop_name,
          expected_date: disp.expected_delivery_date,
          urgency: 'today',
          days_diff: 0,
          title: `⏰ موعد استلام اليوم (${modelCode})`,
          message: `اليوم موعد استلام الموديل ${modelCode} من مطبعة ${disp.shop_name}.`,
          is_read: readNotificationIds.includes(notifId),
          created_at: disp.dispatched_at
        });
      } else if (diffDays === 1) {
        list.push({
          id: notifId,
          model_id: disp.model_id,
          model_code: modelCode,
          stage: 'printing',
          source_name: disp.shop_name,
          expected_date: disp.expected_delivery_date,
          urgency: 'tomorrow',
          days_diff: 1,
          title: `📅 موعد استلام غداً (${modelCode})`,
          message: `غداً موعد استلام الموديل ${modelCode} من مطبعة ${disp.shop_name}.`,
          is_read: readNotificationIds.includes(notifId),
          created_at: disp.dispatched_at
        });
      }
    });

    sewingDispatches.forEach((disp) => {
      if (disp.status === 'تم الاستلام' || !disp.expected_delivery_date) return;
      const model = models.find((m) => m.id === disp.model_id);
      const modelCode = model?.model_code || 'موديل';
      const pieceLabel = disp.piece_label ? ` [${disp.piece_label}]` : '';

      const expDate = new Date(disp.expected_delivery_date);
      expDate.setHours(0, 0, 0, 0);
      const diffDays = Math.round((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      const notifId = `notif-sew-${disp.id}-${disp.expected_delivery_date}`;

      if (diffDays < 0) {
        list.push({
          id: notifId,
          model_id: disp.model_id,
          model_code: modelCode,
          stage: 'sewing',
          source_name: disp.workshop_name,
          expected_date: disp.expected_delivery_date,
          urgency: 'overdue',
          days_diff: diffDays,
          title: `🚨 تأخر استلام من ورشة المكن${pieceLabel} (${modelCode})`,
          message: `تخطى موعد استلام ${modelCode}${pieceLabel} من ورشة ${disp.workshop_name} بمقدار ${Math.abs(diffDays)} يوم، ولم يتم تسجيل الاستلام بعد!`,
          is_read: readNotificationIds.includes(notifId),
          created_at: disp.dispatched_at
        });
      } else if (diffDays === 0) {
        list.push({
          id: notifId,
          model_id: disp.model_id,
          model_code: modelCode,
          stage: 'sewing',
          source_name: disp.workshop_name,
          expected_date: disp.expected_delivery_date,
          urgency: 'today',
          days_diff: 0,
          title: `⏰ موعد استلام اليوم${pieceLabel} (${modelCode})`,
          message: `اليوم موعد استلام الموديل ${modelCode}${pieceLabel} من ورشة المكن (${disp.workshop_name}).`,
          is_read: readNotificationIds.includes(notifId),
          created_at: disp.dispatched_at
        });
      } else if (diffDays === 1) {
        list.push({
          id: notifId,
          model_id: disp.model_id,
          model_code: modelCode,
          stage: 'sewing',
          source_name: disp.workshop_name,
          expected_date: disp.expected_delivery_date,
          urgency: 'tomorrow',
          days_diff: 1,
          title: `📅 موعد استلام غداً${pieceLabel} (${modelCode})`,
          message: `غداً موعد استلام الموديل ${modelCode}${pieceLabel} من ورشة المكن (${disp.workshop_name}).`,
          is_read: readNotificationIds.includes(notifId),
          created_at: disp.dispatched_at
        });
      }
    });

    // 3. Finishing (التشطيب) — per part records
    finishingRecords.forEach((rec) => {
      if (rec.is_received || !rec.expected_exit_date) return;
      const model = models.find((m) => m.id === rec.model_id);
      const modelCode = model?.model_code || 'موديل';
      const label = rec.piece_label || getPartLabel(rec.part_type);

      const expDate = new Date(rec.expected_exit_date);
      expDate.setHours(0, 0, 0, 0);
      const diffDays = Math.round((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const notifId = `notif-finish-${rec.id}-${rec.expected_exit_date}`;

      if (diffDays < 0) {
        list.push({
          id: notifId,
          model_id: rec.model_id,
          model_code: modelCode,
          stage: 'finishing',
          source_name: 'قسم التشطيب',
          expected_date: rec.expected_exit_date,
          urgency: 'overdue',
          days_diff: diffDays,
          title: `🚨 تأخر استلام من التشطيب [${label}] (${modelCode})`,
          message: `تخطى موعد خروج [${label}] موديل ${modelCode} من التشطيب بمقدار ${Math.abs(
            diffDays
          )} يوم، ولم يتم تسجيل الاستلام بعد!`,
          is_read: readNotificationIds.includes(notifId),
          created_at: rec.entry_date || rec.expected_exit_date
        });
      } else if (diffDays === 0) {
        list.push({
          id: notifId,
          model_id: rec.model_id,
          model_code: modelCode,
          stage: 'finishing',
          source_name: 'قسم التشطيب',
          expected_date: rec.expected_exit_date,
          urgency: 'today',
          days_diff: 0,
          title: `⏰ موعد استلام اليوم [${label}] (${modelCode})`,
          message: `اليوم موعد استلام [${label}] موديل ${modelCode} من قسم التشطيب.`,
          is_read: readNotificationIds.includes(notifId),
          created_at: rec.entry_date || rec.expected_exit_date
        });
      } else if (diffDays === 1) {
        list.push({
          id: notifId,
          model_id: rec.model_id,
          model_code: modelCode,
          stage: 'finishing',
          source_name: 'قسم التشطيب',
          expected_date: rec.expected_exit_date,
          urgency: 'tomorrow',
          days_diff: 1,
          title: `📅 موعد استلام غداً [${label}] (${modelCode})`,
          message: `غداً موعد استلام [${label}] موديل ${modelCode} من قسم التشطيب.`,
          is_read: readNotificationIds.includes(notifId),
          created_at: rec.entry_date || rec.expected_exit_date
        });
      }
    });

    // 4. Assembly stages (المكواة / التعبئة والتغليف / الدَست)
    const assemblyStageNames: Record<AssemblyStageKey, string> = {
      ironing: 'قسم المكواة',
      packaging: 'قسم التعبئة والتغليف',
      dest: 'قسم الدَست'
    };
    assemblyStageRecords.forEach((rec) => {
      if (rec.is_completed || !rec.expected_exit_date) return;
      const model = models.find((m) => m.id === rec.model_id);
      const modelCode = model?.model_code || 'موديل';
      const stageName = assemblyStageNames[rec.stage] || rec.stage;

      const expDate = new Date(rec.expected_exit_date);
      expDate.setHours(0, 0, 0, 0);
      const diffDays = Math.round((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const notifId = `notif-asm-${rec.stage}-${rec.id}-${rec.expected_exit_date}`;

      if (diffDays < 0) {
        list.push({
          id: notifId,
          model_id: rec.model_id,
          model_code: modelCode,
          stage: rec.stage,
          source_name: stageName,
          expected_date: rec.expected_exit_date,
          urgency: 'overdue',
          days_diff: diffDays,
          title: `🚨 تأخر استلام (${modelCode})`,
          message: `تخطى موعد خروج الموديل ${modelCode} من ${stageName} بمقدار ${Math.abs(
            diffDays
          )} يوم، ولم يتم تسجيل الاستلام بعد!`,
          is_read: readNotificationIds.includes(notifId),
          created_at: rec.entry_date || rec.expected_exit_date
        });
      } else if (diffDays === 0) {
        list.push({
          id: notifId,
          model_id: rec.model_id,
          model_code: modelCode,
          stage: rec.stage,
          source_name: stageName,
          expected_date: rec.expected_exit_date,
          urgency: 'today',
          days_diff: 0,
          title: `⏰ موعد استلام اليوم (${modelCode})`,
          message: `اليوم موعد استلام الموديل ${modelCode} من ${stageName}.`,
          is_read: readNotificationIds.includes(notifId),
          created_at: rec.entry_date || rec.expected_exit_date
        });
      } else if (diffDays === 1) {
        list.push({
          id: notifId,
          model_id: rec.model_id,
          model_code: modelCode,
          stage: rec.stage,
          source_name: stageName,
          expected_date: rec.expected_exit_date,
          urgency: 'tomorrow',
          days_diff: 1,
          title: `📅 موعد استلام غداً (${modelCode})`,
          message: `غداً موعد استلام الموديل ${modelCode} من ${stageName}.`,
          is_read: readNotificationIds.includes(notifId),
          created_at: rec.entry_date || rec.expected_exit_date
        });
      }
    });

    // تنبيهات خامات التشغيل والأمبالاج: الرصيد وصل حد التنبيه أو لا يكفي الاحتياج الحالي.
    if (packagingMaterialRules.length) {
      const demandMap = buildPackagingDemandMap(models, packagingMaterialRules, assemblyStageRecords);
      packagingMaterialRules.forEach((rule) => {
        if (rule.is_active === false) return;
        (rule.size_rules || []).forEach((row) => {
          const demand = demandMap[row.id];
          if (!demand) return;
          if (!demand.belowMinThreshold && !demand.hasShortage) return;

          const notifId = `notif-material-${row.id}-${demand.belowMinThreshold ? 'min' : 'short'}`;
          const sizeLabel = row.size_group_name || 'كل المقاسات';
          const reason = demand.belowMinThreshold
            ? `الرصيد الحالي ${demand.stock} ${rule.unit} وصل إلى حد التنبيه (${row.min_alert_threshold} ${rule.unit}).`
            : `الاحتياج الحالي ${demand.required} ${rule.unit} والعجز ${demand.shortage} ${rule.unit}.`;

          list.push({
            id: notifId,
            model_id: rule.id,
            model_code: rule.name,
            stage: 'materials',
            source_name: row.supplier_name || 'مورد خامات التشغيل',
            expected_date: new Date().toISOString().slice(0, 10),
            urgency: 'critical',
            days_diff: 0,
            title: `⚠️ خامة تشغيل حرجة: ${rule.name} (${sizeLabel})`,
            message: `${reason} يُرجى تجهيز طلب توريد من ${row.supplier_name || 'المورد'}.`,
            is_read: readNotificationIds.includes(notifId),
            created_at: new Date().toISOString(),
            kind: 'material',
            link_tab: 'materials'
          });
        });
      });
    }

    const priorityOrder: Record<AppNotification['urgency'], number> = {
      critical: -1,
      overdue: 0,
      today: 1,
      tomorrow: 2
    };
    // Attach the required permission key to every notification (stage-driven).
    const withPermissions = list.map((notif) => ({
      ...notif,
      permission_key: notif.permission_key || NOTIFICATION_STAGE_PERMISSION[notif.stage] || ''
    }));
    return withPermissions.sort((a, b) => priorityOrder[a.urgency] - priorityOrder[b.urgency]);
};
