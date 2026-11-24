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

export const buildExportActions = (ctx: AppInternalContext) => {
  const {
    currentUser, setCurrentUser, setCurrentUserState, isLoadingState, setIsLoadingState, globalSettings, setGlobalSettings, roles, setRoles, users, setUsers, onlineUsers, setOnlineUsers, sizeDefs, setSizeDefs, suppliers, setSuppliers, workshops, setWorkshops, fabrics, setFabrics, fabricColorsRaw, setFabricColors, fabricColors, fabricTransactions, setFabricTransactions, models, setModels, requirements, setRequirements, accessories, setAccessories, accessoryTypes, setAccessoryTypes, accessoryItemsRaw, setAccessoryItems, accessoryItems, accessoryTransactions, setAccessoryTransactions, cuttingRecords, setCuttingRecords, qcRecords, setQcRecords, printDispatches, setPrintDispatches, sewingDispatches, setSewingDispatches, packagingRequirements, setPackagingRequirements, finishingRecords, setFinishingRecords, assemblyStageRecords, setAssemblyStageRecords, packagingMaterialRules, setPackagingMaterialRules, internalMessages, setInternalMessages, auditLogs, setAuditLogs, flashMessages, setFlashMessages, readNotificationIds, setReadNotificationIds, snoozedNotifications, setSnoozedNotifications, designModelIdsSet, removeFlashMessage, addFlashMessage, refreshState, login, logout, logAction, updateGlobalSettings, formatSupplierWhatsappMessage, openWhatsAppOrder, addModelTimelineEvent, addRole, updateRole, deleteRole, sendInternalMessage, markMessageRead, normalizePartKey, getModelParts, getModelColorList, getModelSizeList, getPackagingRequirement, getPartStages, isPackagingReady, getUserPermissionsObject, hasSpecificPermission, hasPermission, hasAssemblyPackagingAccess, canManagePermissions, canManageUsers, canManageSuppliers, canManageSizes, canViewAuditLogs, canViewGlobalSettings, canEditHeaderSettings, canEditMessageTemplates, canAccessSettings, isCurrentUserSudo, canAccessHRSection, canManageHR, currentUserRank, visibleRankLevels, visibleRankOptions, rankLabelFor, isRankVisibleToActor, clampRankToVisible, getEffectiveDelegatablePermissions, canDelegatePermission, getRoleEnabledPermissionKeys, isRoleAssignable, getCreatedDescendants, canAddDesignNotes, canAddCuttingNotes, canAddQCBeforePrintNotes, canAddQCAfterPrintNotes, canAddSewingNotes, canAddPrintingNotes, canViewFabricPrices, canEditFabricPrices, canViewAccessoryPrices, canEditAccessoryPrices, canViewPrintingPrices, canEditPrintingPrices, canViewPrintingCosts, canEditPrintingCosts, canViewSewingPrices, canEditSewingPrices, canViewAssemblyPrices, canEditAssemblyPrices, canSendWhatsApp, canSendMessages, addModelAccessory
  } = ctx;

  const modelCodeOf = (modelId: string): string =>
    models.find((m) => m.id === modelId)?.model_code || modelId;

  const exportDesignModelsCsv = () => {
    const headers: CsvValue[] = [
      'كود الموديل',
      'نوع الموديل',
      'الحالة',
      'عدد القطع المستهدف',
      'القطع المقصوصة فعلياً',
      'ملاحظات التصميم',
      'تاريخ الإنشاء'
    ];
    const rows: CsvValue[][] = models
      .filter((m) => !m.is_deleted)
      .map((m) => [
        m.model_code,
        m.model_type,
        m.status,
        m.target_cut_quantity ?? 0,
        m.actual_cut_count ?? m.total_cut_pieces ?? 0,
        m.design_notes || '-',
        m.created_at || '-'
      ]);

    exportCsv(datedFileName('design_models'), headers, rows);
    logAction('التصميم', 'تصدير قائمة الموديلات إلى إكسيل');
    addFlashMessage('تم تصدير بيانات التصميم بنجاح');
  };

  const exportFabricTransactionsCsv = async () => {
    const headers: CsvValue[] = [
      'التاريخ',
      'الخامة',
      'كود اللون',
      'اسم اللون',
      'الحركة',
      'الكمية',
      'مرجع الموديل',
      'الملاحظات'
    ];
    let fullTxns = fabricTransactions;
    try {
      const fetched = await api.getFabricTransactions();
      if (Array.isArray(fetched)) fullTxns = fetched;
    } catch {
      // fallback to in-memory state if endpoint unavailable
    }
    const rows: CsvValue[][] = fullTxns.map((tx) => {
      const color = fabricColors.find((c) => c.id === tx.color_id);
      const fabric = fabrics.find((f) => f.id === (color?.fabric_id || tx.fabric_id));
      return [
        tx.timestamp || '-',
        fabric?.name || 'غير معروف',
        color?.color_code || '-',
        color?.color_name || '-',
        tx.operation === 'add'
          ? 'وارد (إضافة)'
          : tx.operation === 'defect'
            ? 'عيب قماش / نسيج'
            : 'منصرف (خصم)',
        tx.amount,
        tx.model_code_ref || '-',
        tx.notes || '-'
      ];
    });

    exportCsv(datedFileName('fabric_transactions'), headers, rows);
    logAction('المخزن', 'تصدير حركات مخزن القماش إلى إكسيل');
    addFlashMessage('تم تصدير حركات القماش بنجاح');
  };

  const exportAccessoryTransactionsCsv = async () => {
    const headers: CsvValue[] = [
      'التاريخ',
      'كود الإكسسوار',
      'اسم الإكسسوار',
      'الحركة',
      'الكمية',
      'مرجع الموديل',
      'الملاحظات'
    ];
    let fullTxns = accessoryTransactions;
    try {
      const fetched = await api.getAccessoryTransactions();
      if (Array.isArray(fetched)) fullTxns = fetched;
    } catch {
      // fallback to in-memory state
    }
    const rows: CsvValue[][] = fullTxns.map((tx) => [
      tx.timestamp || '-',
      tx.accessory_code || '-',
      tx.accessory_name || '-',
      tx.operation === 'add' ? 'وارد (إضافة)' : 'منصرف (خصم)',
      tx.amount,
      tx.model_code_ref || '-',
      tx.notes || '-'
    ]);

    exportCsv(datedFileName('accessory_transactions'), headers, rows);
    logAction('مخزن الإكسسوارات', 'تصدير حركات مخزن الإكسسوارات إلى إكسيل');
    addFlashMessage('تم تصدير حركات الإكسسوارات بنجاح');
  };

  const exportProductionWarehouseCsv = () => {
    const finishedStatuses = new Set<string>(['مخزن الإنتاج التام', 'مكتمل الإنتاج']);
    const completed = models.filter((m) => !m.is_deleted && finishedStatuses.has(m.status));
    const headers: CsvValue[] = [
      'كود الموديل',
      'نوع الموديل',
      'الحالة',
      'عدد القطع المقصوصة',
      'عدد الأطقم المكتملة',
      'قطع عينة في التصوير (مخصومة)',
      'ملاحظات'
    ];
    const rows: CsvValue[][] = completed.map((m) => [
      m.model_code,
      m.model_type,
      m.status,
      m.total_cut_pieces ?? 0,
      // الأطقم التامة الفعلية بعد خصم عينات التصوير (completed_sets من الباك إند).
      finishedSetsOf(m),
      photographyOutstandingOf(m),
      m.design_notes || '-'
    ]);

    exportCsv(datedFileName('production_warehouse'), headers, rows);
    logAction('مخزن الإنتاج', 'تصدير جرد مخزن الإنتاج التام إلى إكسيل');
    addFlashMessage('تم تصدير جرد مخزن الإنتاج بنجاح');
  };


  const exportPrintDispatchesCsv = () => {
    const showPrices = canViewPrintingPrices();
    const headers: CsvValue[] = [
      'كود الموديل',
      'القطعة',
      'المطبعة / الورشة',
      'نوع الطباعة',
      'مكان الطباعة',
      'عدد القطع',
      'تاريخ الإرسال',
      'تاريخ الاستلام المتوقع',
      'الحالة',
      'الملاحظات',
      ...(showPrices ? ['سعر القطعة', 'التكلفة الإجمالية'] : [])
    ];
    const rows: CsvValue[][] = printDispatches.map((d) => [
      modelCodeOf(d.model_id),
      d.piece_label || d.piece_type || '-',
      d.shop_name || '-',
      d.print_type || '-',
      d.print_location || '-',
      d.pieces_count,
      d.dispatched_at || '-',
      d.expected_delivery_date || '-',
      d.status,
      d.notes || '-',
      ...(showPrices
        ? [
            d.cost_per_piece ?? 0,
            d.total_cost ?? Number(((d.cost_per_piece ?? 0) * d.pieces_count).toFixed(2))
          ]
        : [])
    ]);

    exportCsv(datedFileName('print_dispatches'), headers, rows);
    logAction('المطابع', 'تصدير أوامر المطابع إلى إكسيل');
    addFlashMessage(showPrices ? 'تم تصدير أوامر المطابع بنجاح' : 'تم تصدير أوامر المطابع (بدون أسعار) بنجاح');
  };

  const exportSewingDispatchesCsv = () => {
    const showPrices = canViewSewingPrices();
    const headers: CsvValue[] = [
      'كود الموديل',
      'القطعة',
      'ورشة المكن',
      'عدد القطع',
      'تاريخ الإرسال',
      'تاريخ الاستلام المتوقع',
      'الحالة',
      'الملاحظات',
      ...(showPrices ? ['سعر القطعة', 'التكلفة الإجمالية'] : [])
    ];
    const rows: CsvValue[][] = sewingDispatches.map((d) => [
      modelCodeOf(d.model_id),
      d.piece_label || d.piece_type || '-',
      d.workshop_name || '-',
      d.pieces_count,
      d.dispatched_at || '-',
      d.expected_delivery_date || '-',
      d.status,
      d.notes || '-',
      ...(showPrices
        ? [
            d.cost_per_piece ?? 0,
            d.total_cost ?? Number(((d.cost_per_piece ?? 0) * d.pieces_count).toFixed(2))
          ]
        : [])
    ]);

    exportCsv(datedFileName('sewing_dispatches'), headers, rows);
    logAction('المكن', 'تصدير أوامر ورش المكن إلى إكسيل');
    addFlashMessage(showPrices ? 'تم تصدير أوامر المكن بنجاح' : 'تم تصدير أوامر المكن (بدون أسعار) بنجاح');
  };

  const exportAssemblyPackagingCsv = () => {
    const showPrices = canViewAssemblyPrices();
    const headers: CsvValue[] = [
      'النوع',
      'كود الموديل',
      'القطعة',
      'الورشة / المرحلة',
      'تاريخ الدخول',
      'الخروج المتوقع',
      'الخروج الفعلي',
      'الحالة',
      'الملاحظات',
      ...(showPrices ? ['سعر القطعة', 'التكلفة الإجمالية'] : [])
    ];

    const finishingRows: CsvValue[][] = finishingRecords.map((r) => [
      'تشطيب',
      modelCodeOf(r.model_id),
      r.piece_label || r.part_type || '-',
      r.vendor_name || '-',
      r.entry_date || '-',
      r.expected_exit_date || '-',
      r.actual_exit_date || '-',
      r.status,
      r.notes || '-',
      ...(showPrices ? [r.cost_per_piece ?? 0, r.total_cost ?? 0] : [])
    ]);

    const assemblyRows: CsvValue[][] = assemblyStageRecords.map((r) => [
      'أسمبلي',
      modelCodeOf(r.model_id),
      r.part_label || r.part_type || '-',
      r.stage_label || r.stage || '-',
      r.entry_date || '-',
      r.expected_exit_date || '-',
      r.actual_exit_date || '-',
      r.status,
      r.notes || '-',
      ...(showPrices ? [r.cost_per_piece ?? 0, r.total_cost ?? 0] : [])
    ]);

    exportCsv(datedFileName('assembly_packaging'), headers, [...finishingRows, ...assemblyRows]);
    logAction('الأسمبلي والأمبالاج', 'تصدير بيانات التشطيب والأسمبلي إلى إكسيل');
    addFlashMessage(showPrices ? 'تم تصدير بيانات الأسمبلي والأمبالاج بنجاح' : 'تم تصدير بيانات الأسمبلي (بدون أسعار) بنجاح');
  };

  const exportPackagingMaterialsCsv = () => {
    const showPrices = canViewAssemblyPrices();
    const headers: CsvValue[] = [
      'الفئة',
      'الوحدة',
      'فئة المقاس',
      'الاستهلاك لكل قطعة',
      'المخزون الحالي',
      'حد التنبيه',
      'المورد',
      'الهاتف',
      'المواصفات',
      ...(showPrices ? ['سعر الوحدة', 'إجمالي قيمة المخزون'] : [])
    ];
    const rows: CsvValue[][] = packagingMaterialRules.flatMap((rule) =>
      rule.size_rules.map((sr) => [
        rule.name,
        rule.unit,
        sr.size_group_name || '-',
        sr.consumption_per_piece,
        sr.current_stock,
        sr.min_alert_threshold,
        sr.supplier_name || '-',
        sr.supplier_phone || '-',
        sr.dimensions_spec || '-',
        ...(showPrices ? [sr.price_per_unit ?? 0, sr.total_stock_value ?? 0] : [])
      ])
    );

    exportCsv(datedFileName('packaging_materials'), headers, rows);
    logAction('خامات التشغيل', 'تصدير بيانات خامات التشغيل والأمبالاج إلى إكسيل');
    addFlashMessage(showPrices ? 'تم تصدير خامات التشغيل بنجاح' : 'تم تصدير خامات التشغيل (بدون أسعار) بنجاح');
  };

  const exportSuppliersCsv = () => {
    const headers: CsvValue[] = ['اسم المورد', 'رقم الهاتف', 'رابط جروب الواتساب'];
    const rows: CsvValue[][] = suppliers.map((s) => [
      s.name,
      s.phone || '-',
      s.whatsapp_group_link || '-'
    ]);

    exportCsv(datedFileName('suppliers'), headers, rows);
    logAction('الموردين', 'تصدير قائمة الموردين إلى إكسيل');
    addFlashMessage('تم تصدير قائمة الموردين بنجاح');
  };

  const exportWorkshopsCsv = () => {
    const headers: CsvValue[] = ['اسم الورشة', 'نوع الورشة', 'رقم الهاتف', 'رابط جروب الواتساب', 'الملاحظات'];
    const rows: CsvValue[][] = workshops.map((w) => [
      w.name,
      (w.workshop_type_labels && w.workshop_type_labels.length > 0
        ? w.workshop_type_labels
        : w.workshop_type || []
      ).join(' / ') || '-',
      w.phone || '-',
      w.whatsapp_group_link || '-',
      w.notes || '-'
    ]);

    exportCsv(datedFileName('workshops'), headers, rows);
    logAction('الورش', 'تصدير قائمة الورش إلى إكسيل');
    addFlashMessage('تم تصدير قائمة الورش بنجاح');
  };

  const exportAuditLogsCsv = () => {
    const headers: CsvValue[] = [
      'التاريخ والوقت',
      'المستخدم',
      'القسم',
      'نوع الإجراء',
      'الإجراء',
      'العنصر المتأثر',
      'التفاصيل',
      'عنوان IP'
    ];
    const rows: CsvValue[][] = auditLogs.map((log) => [
      log.timestamp || '-',
      log.userName || '-',
      log.section || '-',
      log.actionType || '-',
      log.action || '-',
      log.targetName || '-',
      log.details || '-',
      log.ip_address || '-'
    ]);

    exportCsv(datedFileName('audit_logs'), headers, rows);
    logAction('سجل المراقبة', 'تصدير سجل التدقيق إلى إكسيل');
    addFlashMessage('تم تصدير سجل التدقيق بنجاح');
  };

  /**
   * يبني أوراق الموارد البشرية المتاحة للمستخدم فقط، بحسب صلاحية كل تبويب.
   * يُستخدم في النسخة الاحتياطية الكاملة وفي تصدير قسم HR المستقل.
   */
  const buildHRSectionsSheets = async (): Promise<CsvSheet[]> => {
    const hrSheets: CsvSheet[] = [];
    const showPayroll = canAccessHRSection('payroll');

    if (canAccessHRSection('jobs')) {
      const jobs: any[] = await api.getHRJobTitles();
      hrSheets.push({
        name: 'hr_job_titles',
        headers: ['الوظيفة', 'القسم'],
        rows: jobs.map((j) => [j.title || '-', j.department_label || j.department || '-'])
      });
    }
    if (canAccessHRSection('employees')) {
      const employees: any[] = await api.getHREmployees();
      hrSheets.push({
        name: 'hr_employees',
        headers: [
          'كود الموظف', 'الاسم', 'الوظيفة', 'القسم', 'الهاتف', 'نشط',
          ...(showPayroll ? ['المرتب الشهري'] : [])
        ],
        rows: employees.map((e) => [
          e.employee_code || '-',
          e.name || '-',
          e.job_title || '-',
          e.department_label || e.department || '-',
          e.phone || '-',
          e.is_active ? 'نعم' : 'لا',
          ...(showPayroll ? [e.monthly_salary ?? 0] : [])
        ])
      });
    }
    if (canAccessHRSection('attendance')) {
      const attendance: any[] = await api.getHRAttendanceRecords();
      hrSheets.push({
        name: 'hr_attendance',
        headers: ['الموظف', 'التاريخ', 'الحضور', 'الانصراف', 'الحالة', 'تأخير (دقيقة)', 'إضافي (ساعات)'],
        rows: attendance.map((r) => [
          r.employee_name || '-',
          r.date || '-',
          r.check_in || '-',
          r.check_out || '-',
          r.status_label || r.status || '-',
          r.late_minutes ?? 0,
          r.overtime_hours ?? 0
        ])
      });
    }
    if (canAccessHRSection('penalties')) {
      const penalties: any[] = await api.getHRPenalties();
      hrSheets.push({
        name: 'hr_penalties',
        headers: ['الموظف', 'التاريخ', 'النوع', 'القيمة', 'السبب'],
        rows: penalties.map((p) => [
          p.employee_name || '-',
          p.date || '-',
          p.penalty_type_label || p.penalty_type || '-',
          p.value ?? 0,
          p.reason || '-'
        ])
      });
    }
    if (canAccessHRSection('loans')) {
      const loans: any[] = await api.getHRLoans();
      hrSheets.push({
        name: 'hr_loans',
        headers: ['الموظف', 'التاريخ', 'المبلغ', 'ملاحظات'],
        rows: loans.map((l) => [
          l.employee_name || '-',
          l.date || '-',
          l.amount ?? 0,
          l.notes || '-'
        ])
      });
    }

    return hrSheets;
  };

  /**
   * تصدير قسم الموارد البشرية فقط كحزمة ZIP (بحسب صلاحيات كل تبويب).
   */
  const exportHRSectionsZip = async () => {
    try {
      const hrSheets = await buildHRSectionsSheets();
      if (hrSheets.length === 0) {
        addFlashMessage('لا تمتلك صلاحية الوصول لأي بيانات في الموارد البشرية', 'warning');
        return;
      }
      exportZipCsv(datedFileName('hr_backup', 'zip'), hrSheets);
      logAction('الموارد البشرية', 'تصدير بيانات الموارد البشرية إلى إكسيل');
      addFlashMessage(`تم تصدير بيانات الموارد البشرية بنجاح (${hrSheets.length} ملف)`);
    } catch (err) {
      addFlashMessage('فشل تصدير بيانات الموارد البشرية', 'danger');
    }
  };

  /**
   * تنزيل نسخة احتياطية كاملة (ZIP) تضم كل الأوراق المتاحة للمستخدم،
   * مع إخفاء أعمدة الأسعار/الرواتب لمن لا يملك صلاحيتها.
   */
  const exportFullBackupZip = async () => {
    const sheets: CsvSheet[] = [];

    // 1) التصميم
    sheets.push({
      name: 'design_models',
      headers: ['كود الموديل', 'نوع الموديل', 'الحالة', 'القطع المستهدفة', 'القطع المقصوصة', 'ملاحظات التصميم', 'تاريخ الإنشاء'],
      rows: models
        .filter((m) => !m.is_deleted)
        .map((m) => [
          m.model_code,
          m.model_type,
          m.status,
          m.target_cut_quantity ?? 0,
          m.actual_cut_count ?? m.total_cut_pieces ?? 0,
          m.design_notes || '-',
          m.created_at || '-'
        ])
    });

    // 2) مخزن القماش (جرد + حركات)
    const showFabricPrices = canViewFabricPrices();
    sheets.push({
      name: 'fabric_inventory',
      headers: [
        'الخامة', 'كود اللون', 'اسم اللون', 'الكمية', 'المحجوز', 'المتاح', 'الوحدة',
        ...(showFabricPrices ? ['سعر الوحدة', 'إجمالي القيمة'] : [])
      ],
      rows: fabricColors.map((color) => {
        const fabric = fabrics.find((f) => f.id === color.fabric_id);
        const unitPrice = color.price_per_unit ?? 0;
        return [
          fabric?.name || 'غير معروف',
          color.color_code,
          color.color_name || '-',
          color.quantity,
          color.reserved_quantity,
          Number((color.quantity - color.reserved_quantity).toFixed(2)),
          fabric?.unit || 'كيلو',
          ...(showFabricPrices ? [unitPrice, Number((unitPrice * color.quantity).toFixed(2))] : [])
        ];
      })
    });
    // جلب سجل الحركات الكامل غير المقتطع للنسخة الاحتياطية الشاملة.
    const [fullFabricTxnsRes, fullAccessoryTxnsRes] = await Promise.all([
      api.getFabricTransactions().catch(() => null),
      api.getAccessoryTransactions().catch(() => null)
    ]);
    const backupFabricTxns = Array.isArray(fullFabricTxnsRes) ? fullFabricTxnsRes : fabricTransactions;
    const backupAccessoryTxns = Array.isArray(fullAccessoryTxnsRes) ? fullAccessoryTxnsRes : accessoryTransactions;

    sheets.push({
      name: 'fabric_transactions',
      headers: ['التاريخ', 'الخامة', 'كود اللون', 'الحركة', 'الكمية', 'مرجع الموديل', 'الملاحظات'],
      rows: backupFabricTxns.map((tx) => {
        const color = fabricColors.find((c) => c.id === tx.color_id);
        const fabric = fabrics.find((f) => f.id === (color?.fabric_id || tx.fabric_id));
        return [
          tx.timestamp || '-',
          fabric?.name || 'غير معروف',
          color?.color_code || '-',
          tx.operation === 'add' ? 'وارد' : tx.operation === 'defect' ? 'عيب قماش / نسيج' : 'منصرف',
          tx.amount,
          tx.model_code_ref || '-',
          tx.notes || '-'
        ];
      })
    });

    // 3) مخزن الإكسسوارات (جرد + حركات) مع أسعار شرطية
    const showAccessoryPrices = canViewAccessoryPrices();
    sheets.push({
      name: 'accessory_inventory',
      headers: [
        'التصنيف', 'الكود', 'الاسم', 'الرصيد', 'المحجوز', 'المتاح', 'الوحدة',
        ...(showAccessoryPrices ? ['سعر الوحدة', 'إجمالي القيمة'] : [])
      ],
      rows: accessoryItems.map((a) => [
        a.type_name,
        a.code,
        a.name,
        a.quantity,
        a.reserved_quantity,
        a.quantity - a.reserved_quantity,
        a.unit,
        ...(showAccessoryPrices
          ? [a.price_per_unit ?? 0, Number(((a.price_per_unit ?? 0) * a.quantity).toFixed(2))]
          : [])
      ])
    });
    sheets.push({
      name: 'accessory_transactions',
      headers: ['التاريخ', 'الكود', 'الاسم', 'الحركة', 'الكمية', 'مرجع الموديل', 'الملاحظات'],
      rows: backupAccessoryTxns.map((tx) => [
        tx.timestamp || '-',
        tx.accessory_code || '-',
        tx.accessory_name || '-',
        tx.operation === 'add' ? 'وارد' : 'منصرف',
        tx.amount,
        tx.model_code_ref || '-',
        tx.notes || '-'
      ])
    });

    // 4) خط الإنتاج
    sheets.push({
      name: 'production_models',
      headers: ['كود الموديل', 'نوع الموديل', 'الحالة', 'القطع المقصوصة', 'الأطقم المكتملة'],
      rows: models
        .filter((m) => !m.is_deleted)
        .map((m) => [m.model_code, m.model_type, m.status, m.total_cut_pieces ?? 0, m.completed_sets ?? 0])
    });

    // 5) المطابع والمكن والأسمبلي
    const showPrintPrices = canViewPrintingPrices();
    sheets.push({
      name: 'print_dispatches',
      headers: [
        'كود الموديل', 'القطعة', 'المطبعة', 'نوع الطباعة', 'عدد القطع', 'تاريخ الإرسال', 'الحالة',
        ...(showPrintPrices ? ['سعر القطعة', 'التكلفة الإجمالية'] : [])
      ],
      rows: printDispatches.map((d) => [
        modelCodeOf(d.model_id),
        d.piece_label || d.piece_type || '-',
        d.shop_name || '-',
        d.print_type || '-',
        d.pieces_count,
        d.dispatched_at || '-',
        d.status,
        ...(showPrintPrices ? [d.cost_per_piece ?? 0, d.total_cost ?? 0] : [])
      ])
    });

    const showSewingPrices = canViewSewingPrices();
    sheets.push({
      name: 'sewing_dispatches',
      headers: [
        'كود الموديل', 'القطعة', 'ورشة المكن', 'عدد القطع', 'تاريخ الإرسال', 'الحالة',
        ...(showSewingPrices ? ['سعر القطعة', 'التكلفة الإجمالية'] : [])
      ],
      rows: sewingDispatches.map((d) => [
        modelCodeOf(d.model_id),
        d.piece_label || d.piece_type || '-',
        d.workshop_name || '-',
        d.pieces_count,
        d.dispatched_at || '-',
        d.status,
        ...(showSewingPrices ? [d.cost_per_piece ?? 0, d.total_cost ?? 0] : [])
      ])
    });

    const showAssemblyPrices = canViewAssemblyPrices();
    sheets.push({
      name: 'assembly_packaging',
      headers: [
        'النوع', 'كود الموديل', 'القطعة', 'الورشة/المرحلة', 'تاريخ الدخول', 'الخروج المتوقع', 'الحالة',
        ...(showAssemblyPrices ? ['التكلفة الإجمالية'] : [])
      ],
      rows: [
        ...finishingRecords.map((r) => [
          'تشطيب',
          modelCodeOf(r.model_id),
          r.piece_label || r.part_type || '-',
          r.vendor_name || '-',
          r.entry_date || '-',
          r.expected_exit_date || '-',
          r.status,
          ...(showAssemblyPrices ? [r.total_cost ?? 0] : [])
        ] as CsvValue[]),
        ...assemblyStageRecords.map((r) => [
          'أسمبلي',
          modelCodeOf(r.model_id),
          r.part_label || r.part_type || '-',
          r.stage_label || r.stage || '-',
          r.entry_date || '-',
          r.expected_exit_date || '-',
          r.status,
          ...(showAssemblyPrices ? [r.total_cost ?? 0] : [])
        ] as CsvValue[])
      ]
    });

    // 6) خامات التشغيل
    sheets.push({
      name: 'packaging_materials',
      headers: [
        'الفئة', 'الوحدة', 'فئة المقاس', 'الاستهلاك/قطعة', 'المخزون', 'حد التنبيه', 'المورد',
        ...(showAssemblyPrices ? ['سعر الوحدة', 'قيمة المخزون'] : [])
      ],
      rows: packagingMaterialRules.flatMap((rule) =>
        rule.size_rules.map((sr) => [
          rule.name,
          rule.unit,
          sr.size_group_name || '-',
          sr.consumption_per_piece,
          sr.current_stock,
          sr.min_alert_threshold,
          sr.supplier_name || '-',
          ...(showAssemblyPrices ? [sr.price_per_unit ?? 0, sr.total_stock_value ?? 0] : [])
        ] as CsvValue[])
      )
    });

    // 7) الموردون والورش
    sheets.push({
      name: 'suppliers',
      headers: ['اسم المورد', 'الهاتف', 'جروب الواتساب'],
      rows: suppliers.map((s) => [s.name, s.phone || '-', s.whatsapp_group_link || '-'])
    });
    sheets.push({
      name: 'workshops',
      headers: ['اسم الورشة', 'النوع', 'الهاتف', 'جروب الواتساب', 'ملاحظات'],
      rows: workshops.map((w) => [
        w.name,
        (w.workshop_type_labels && w.workshop_type_labels.length > 0
          ? w.workshop_type_labels
          : w.workshop_type || []
        ).join(' / ') || '-',
        w.phone || '-',
        w.whatsapp_group_link || '-',
        w.notes || '-'
      ])
    });

    // 8) المستخدمون والأدوار (لمن يملك صلاحية الإدارة)
    if (canManageUsers()) {
      sheets.push({
        name: 'users',
        headers: ['اسم المستخدم', 'الاسم الكامل', 'الدور', 'الرتبة', 'نشط'],
        rows: users
          .filter((u) => u.username?.toLowerCase() !== 'sudo' && !u.is_sudo)
          .map((u) => [
            u.username,
            u.real_name || '-',
            u.role || '-',
            u.rank_label || String(u.rank_level ?? '-'),
            u.is_active ? 'نعم' : 'لا'
          ])
      });
    }
    if (canManagePermissions()) {
      sheets.push({
        name: 'roles',
        headers: ['اسم الدور', 'الوصف', 'الرتبة', 'عدد المستخدمين'],
        rows: roles.map((r) => [
          r.name,
          r.description || '-',
          r.rank_label || String(r.rank_level ?? '-'),
          r.users_count ?? 0
        ])
      });
    }

    // 9) سجل التدقيق
    if (canViewAuditLogs()) {
      sheets.push({
        name: 'audit_logs',
        headers: ['التاريخ', 'المستخدم', 'القسم', 'نوع الإجراء', 'الإجراء', 'العنصر', 'التفاصيل', 'IP'],
        rows: auditLogs.map((log) => [
          log.timestamp || '-',
          log.userName || '-',
          log.section || '-',
          log.actionType || '-',
          log.action || '-',
          log.targetName || '-',
          log.details || '-',
          log.ip_address || '-'
        ])
      });
    }

    // 10) الموارد البشرية — بحسب صلاحية كل تبويب (ويُخفى المرتب بدون صلاحية المرتبات)
    try {
      sheets.push(...(await buildHRSectionsSheets()));
    } catch (err) {
      // تعذّر جلب بيانات HR لا يمنع تصدير باقي الأقسام.
      addFlashMessage('تم تصدير النسخة الاحتياطية بدون قسم الموارد البشرية (تعذّر الجلب)', 'warning');
    }

    if (sheets.length === 0) {
      addFlashMessage('لا توجد بيانات متاحة للتصدير', 'warning');
      return;
    }

    exportZipCsv(datedFileName('factory_backup', 'zip'), sheets);
    logAction('الإعدادات', 'تصدير نسخة احتياطية كاملة (ZIP) لكل الأقسام');
    addFlashMessage(`تم تصدير النسخة الاحتياطية بنجاح (${sheets.length} ملف)`);
  };


  // Printing & Embroidery Actions

  return {
    modelCodeOf,
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
    buildHRSectionsSheets,
    exportHRSectionsZip,
    exportFullBackupZip
  };
};
