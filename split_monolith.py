import os
import re
import py_compile


def idx_of(lines, prefix):
    for i, line in enumerate(lines):
        if line.startswith(prefix):
            return i
    raise RuntimeError(f"Anchor not found: {prefix}")


def split_services():
    path = "backend/api/services.py"
    with open(path, "r", encoding="utf-8") as f:
        s_lines = f.readlines()

    if len(s_lines) < 500:
        print("services.py already split, skipping.")
        return

    i_norm = idx_of(s_lines, "def normalize_part_key(")
    i_schema = idx_of(s_lines, "_SCHEMA_ENSURED = False")
    i_sewing = idx_of(s_lines, "def dispatch_model_to_sewing_service(")

    s_header = "".join(s_lines[:i_norm])

    with open("backend/api/services_pipeline.py", "w", encoding="utf-8") as f:
        f.write("".join(s_lines[:i_schema]))

    with open("backend/api/services_schema_seed.py", "w", encoding="utf-8") as f:
        f.write(
            s_header
            + "\nfrom .services_pipeline import *\nfrom .services_pipeline import _stage_index, _model_reached_finished_stage\n\n"
            + "".join(s_lines[i_schema:i_sewing])
        )

    with open("backend/api/services_stages.py", "w", encoding="utf-8") as f:
        f.write(
            s_header
            + "\nfrom .services_pipeline import *\nfrom .services_pipeline import _stage_index, _model_reached_finished_stage\nfrom .services_schema_seed import *\n\n"
            + "".join(s_lines[i_sewing:])
        )

    with open(path, "w", encoding="utf-8") as f:
        f.write(
            "from .services_pipeline import *\n"
            "from .services_schema_seed import *\n"
            "from .services_stages import *\n"
        )
    print("Split backend/api/services.py -> 3 modules.")


def split_models():
    path = "backend/api/models.py"
    with open(path, "r", encoding="utf-8") as f:
        m_lines = f.readlines()

    if len(m_lines) < 500:
        print("models.py already split, skipping.")
        return

    i_size = idx_of(m_lines, "class SizeDef(")
    i_model = idx_of(m_lines, "class ModelItem(")
    i_hr = idx_of(m_lines, "def generate_employee_code(")

    m_header = (
        "from django.db import models\n"
        "from django.contrib.auth.models import User\n"
        "import uuid\n"
        "from .storage_r2 import guard_image_field\n"
        "from .models_auth import *\n"
    )

    with open("backend/api/models_auth.py", "w", encoding="utf-8") as f:
        f.write("".join(m_lines[:i_size]))

    with open("backend/api/models_warehouse.py", "w", encoding="utf-8") as f:
        f.write(m_header + "\n" + "".join(m_lines[i_size:i_model]))

    with open("backend/api/models_production.py", "w", encoding="utf-8") as f:
        f.write(m_header + "from .models_warehouse import *\n\n" + "".join(m_lines[i_model:i_hr]))

    with open("backend/api/models_hr.py", "w", encoding="utf-8") as f:
        f.write(
            m_header
            + "from .models_warehouse import *\nfrom .models_production import *\n\n"
            + "".join(m_lines[i_hr:])
        )

    with open(path, "w", encoding="utf-8") as f:
        f.write(
            "from .models_auth import *\n"
            "from .models_warehouse import *\n"
            "from .models_production import *\n"
            "from .models_hr import *\n"
        )
    print("Split backend/api/models.py -> 4 modules.")


def split_views():
    path = "backend/api/views.py"
    with open(path, "r", encoding="utf-8") as f:
        v_lines = f.readlines()

    if len(v_lines) < 500:
        print("views.py already split, skipping.")
        return

    i_auth = idx_of(v_lines, "class AuthViewSet(")
    i_size = idx_of(v_lines, "class SizeDefViewSet(")
    i_model = idx_of(v_lines, "class ModelItemViewSet(")
    i_cutting = idx_of(v_lines, "class CuttingRecordViewSet(")
    i_notif = idx_of(v_lines, "class NotificationViewSet(")
    i_hr = idx_of(v_lines, "class HRJobTitleViewSet(")
    i_freset = idx_of(v_lines, "FACTORY_RESET_SECTIONS = {")

    with open("backend/api/views_common.py", "w", encoding="utf-8") as f:
        f.write("".join(v_lines[:i_auth]))

    common_import = (
        "from .views_common import *\n"
        "from .views_common import _truthy_permission_keys, _accessory_price_snapshot\n\n"
    )

    with open("backend/api/views_auth_state.py", "w", encoding="utf-8") as f:
        f.write(common_import + "".join(v_lines[i_auth:i_size]))

    with open("backend/api/views_warehouse.py", "w", encoding="utf-8") as f:
        f.write(common_import + "".join(v_lines[i_size:i_model]))

    with open("backend/api/views_models.py", "w", encoding="utf-8") as f:
        f.write(common_import + "".join(v_lines[i_model:i_cutting]))

    with open("backend/api/views_stages.py", "w", encoding="utf-8") as f:
        f.write(common_import + "".join(v_lines[i_cutting:i_notif]))

    with open("backend/api/views_system.py", "w", encoding="utf-8") as f:
        f.write(common_import + "".join(v_lines[i_notif:i_hr]) + "\n" + "".join(v_lines[i_freset:]))

    with open("backend/api/views_hr.py", "w", encoding="utf-8") as f:
        f.write(common_import + "".join(v_lines[i_hr:i_freset]))

    with open(path, "w", encoding="utf-8") as f:
        f.write(
            "from .views_common import *\n"
            "from .views_auth_state import *\n"
            "from .views_warehouse import *\n"
            "from .views_models import *\n"
            "from .views_stages import *\n"
            "from .views_system import *\n"
            "from .views_hr import *\n"
        )
    print("Split backend/api/views.py -> 7 modules.")


def split_hr_view():
    path = "src/components/HRView.tsx"
    with open(path, "r", encoding="utf-8") as f:
        h_lines = f.readlines()

    if len(h_lines) < 1000:
        print("HRView.tsx already split, skipping.")
        return

    i_main = idx_of(h_lines, "export const HRView:")
    i_jobs = idx_of(h_lines, "const JobsPanel:")
    i_emp_form = idx_of(h_lines, "type EmployeeForm =")
    i_rules = idx_of(h_lines, "const AttendanceRulesPanel:")
    i_rec_form = idx_of(h_lines, "interface AttendanceRecordForm {")
    i_loan_row = idx_of(h_lines, "interface LoanDueRow {")
    i_pen = idx_of(h_lines, "const PenaltiesPanel:")
    i_pay_row = idx_of(h_lines, "interface PayrollRow {")

    os.makedirs("src/components/hr", exist_ok=True)

    shared_raw = "".join(h_lines[:i_main])
    shared_code = (
        shared_raw.replace("from '../context/AppContext'", "from '../../context/AppContext'")
        .replace("from './HRReportsView'", "from '../HRReportsView'")
        .replace("from '../utils/printShared'", "from '../../utils/printShared'")
        .replace("from '../api/client'", "from '../../api/client'")
        .replace("from '../types'", "from '../../types'")
    )
    shared_code = re.sub(r"^(type |interface |const )", r"export \1", shared_code, flags=re.M)

    with open("src/components/hr/hrShared.tsx", "w", encoding="utf-8") as f:
        f.write(shared_code)

    panel_header = """import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Users, Briefcase, Clock, Plus, Search, Pencil, Trash2, X, Save,
  AlertTriangle, CalendarDays, Building2, Coffee, Timer, Info, Wallet,
  Scale, Banknote, RefreshCw, Download, Upload, FileSpreadsheet, FileText,
  CheckCircle2, XCircle, UsersRound, LayoutList, History, Printer, BarChart3
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { escapeHtml, renderLogoHtml } from '../../utils/printShared';
import { api } from '../../api/client';
import {
  HRJobTitle, HREmployee, HRAttendanceSettings, HRAttendanceRule,
  HRAttendanceRecord, HRAttendanceStatus, HRAttendanceStats,
  HRAttendanceImportResult, HRReviewStatus, HRPenalty, HRPenaltyType,
  HRLoan, HRDepartmentKey, HR_DEPARTMENTS, HR_DEPARTMENT_LABELS,
  HR_WEEK_DAYS, HRWeekDayKey, HRRuleApplicationMode, HRRuleViolationType,
  HRRuleDeductionType, HRRuleApplyMode, HROvertimeRule, HROvertimeRewardType
} from '../../types';
import {
  inputClass, labelClass, formatMoney, VIOLATION_LABELS, DEDUCTION_LABELS,
  APPLY_MODE_LABELS, RULE_APPLICATION_LABELS, Modal, ErrorNote, PlaceholderPanel,
  ATTENDANCE_STATUS_LABELS, REVIEW_STATUS_LABELS, PENALTY_TYPE_LABELS,
  todayISO, currentMonth, WEEK_DAY_AR, WEEK_DAY_KEYS, DEFAULT_WEEKLY_OFF_INDEX,
  weeklyOffIndexFromKey, weeklyOffDayLabel, formatDayLabel, isoDate,
  weekDatesBeforeWeeklyOff, weeklyOffRatioForAbsences, weeklyOffRatioLabel,
  weeklyOffDeductionForDate, sumWeeklyOffDeductionsForEmployeeMonth,
  dailyRateFor, hourlyRateFor, timeToMinutes, lateMinutesFor, matchLateRule,
  isAttendedRecord, MonthAccrual, computeMonthAccrual
} from './hrShared';

"""

    panels = [
        ("JobsPanel.tsx", i_jobs, i_emp_form, "const JobsPanel:"),
        ("EmployeesPanel.tsx", i_emp_form, i_rules, "const EmployeesPanel:"),
        ("AttendanceRulesPanel.tsx", i_rules, i_rec_form, "const AttendanceRulesPanel:"),
        ("AttendanceRecordsPanel.tsx", i_rec_form, i_loan_row, "const AttendanceRecordsPanel:"),
        ("LoansPanel.tsx", i_loan_row, i_pen, "const LoansPanel:"),
        ("PenaltiesPanel.tsx", i_pen, i_pay_row, "const PenaltiesPanel:"),
        ("PayrollPanel.tsx", i_pay_row, len(h_lines), "const PayrollPanel:"),
    ]

    for fname, start, end, export_target in panels:
        body = "".join(h_lines[start:end]).replace(export_target, "export " + export_target, 1)
        with open(f"src/components/hr/{fname}", "w", encoding="utf-8") as f:
            f.write(panel_header + body)

    hr_main_header = """import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users, Briefcase, Clock, Wallet, Scale, Banknote, RefreshCw,
  Download, UsersRound, BarChart3
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { HRReportsView } from './HRReportsView';
import { api } from '../api/client';
import { HRJobTitle, HREmployee, HRAttendanceSettings } from '../types';
import { HRSection, HRSubTab, HRViewProps } from './hr/hrShared';
import { JobsPanel } from './hr/JobsPanel';
import { EmployeesPanel } from './hr/EmployeesPanel';
import { AttendanceRulesPanel } from './hr/AttendanceRulesPanel';
import { AttendanceRecordsPanel } from './hr/AttendanceRecordsPanel';
import { LoansPanel } from './hr/LoansPanel';
import { PenaltiesPanel } from './hr/PenaltiesPanel';
import { PayrollPanel } from './hr/PayrollPanel';

"""
    with open(path, "w", encoding="utf-8") as f:
        f.write(hr_main_header + "".join(h_lines[i_main:i_jobs]))
    print("Split src/components/HRView.tsx -> 8 modules in src/components/hr/.")


def split_app_context():
    path = "src/context/AppContext.tsx"
    with open(path, "r", encoding="utf-8") as f:
        a_lines = f.readlines()

    if len(a_lines) < 2000:
        print("AppContext.tsx already split, skipping.")
        return

    i_imports_end = idx_of(a_lines, "const NOTIFICATION_STAGE_PERMISSION")
    i_provider = idx_of(a_lines, "export const AppProvider:")
    i_perm_start = idx_of(a_lines, "  const getUserPermissionsObject =")
    i_perm_end = idx_of(a_lines, "  const unreadMessagesCount =")
    i_wh_start = idx_of(a_lines, "  const addFabricOrColor =")
    i_design_start = idx_of(a_lines, "  const addDesignModel =")
    i_part_hooks = idx_of(a_lines, "  const normalizePartKey =")
    i_cut_start = idx_of(a_lines, "  const addCuttingRecord =")
    i_exp_start = idx_of(a_lines, "  const modelCodeOf =")
    i_print_start = idx_of(a_lines, "  const addPrintDispatch =")
    i_pkg_hooks = idx_of(a_lines, "  const getPackagingRequirement =")
    i_assm_start = idx_of(a_lines, "  const setPackagingStep =")
    i_set_start = idx_of(a_lines, "  const addSizeDef =")
    i_notif_start = idx_of(a_lines, "  const appNotifications = useMemo<AppNotification[]>")
    i_vis_notif = idx_of(a_lines, "  const visibleAppNotifications = useMemo")

    top_imports = "".join(a_lines[:i_imports_end])

    types_body = "".join(a_lines[i_imports_end:i_provider])
    types_body = re.sub(r"^(const |interface )", r"export \1", types_body, flags=re.M)
    with open("src/context/appContextTypes.ts", "w", encoding="utf-8") as f:
        f.write(top_imports + "\n" + types_body)

    notif_inner = "".join(a_lines[i_notif_start + 1 : i_vis_notif - 11])
    with open("src/context/appNotificationsBuilder.ts", "w", encoding="utf-8") as f:
        f.write(
            top_imports
            + "import { NOTIFICATION_STAGE_PERMISSION } from './appContextTypes';\n\n"
            + "export const buildAppNotifications = (ctx: any): AppNotification[] => {\n"
            + "  const {\n"
            + "    printDispatches, sewingDispatches, finishingRecords,\n"
            + "    assemblyStageRecords, packagingMaterialRules, models, readNotificationIds\n"
            + "  } = ctx;\n"
            + notif_inner
            + "\n};\n"
        )

    all_ctx_keys = [
        "currentUser", "setCurrentUser", "setCurrentUserState", "isLoadingState", "setIsLoadingState",
        "globalSettings", "setGlobalSettings", "roles", "setRoles", "users", "setUsers",
        "onlineUsers", "setOnlineUsers", "sizeDefs", "setSizeDefs", "suppliers", "setSuppliers",
        "workshops", "setWorkshops", "fabrics", "setFabrics", "fabricColorsRaw", "setFabricColors",
        "fabricColors", "fabricTransactions", "setFabricTransactions", "models", "setModels",
        "requirements", "setRequirements", "accessories", "setAccessories",
        "accessoryTypes", "setAccessoryTypes", "accessoryItemsRaw", "setAccessoryItems",
        "accessoryItems", "accessoryTransactions", "setAccessoryTransactions",
        "cuttingRecords", "setCuttingRecords", "qcRecords", "setQcRecords",
        "printDispatches", "setPrintDispatches", "sewingDispatches", "setSewingDispatches",
        "packagingRequirements", "setPackagingRequirements", "finishingRecords", "setFinishingRecords",
        "assemblyStageRecords", "setAssemblyStageRecords", "packagingMaterialRules", "setPackagingMaterialRules",
        "internalMessages", "setInternalMessages", "auditLogs", "setAuditLogs",
        "flashMessages", "setFlashMessages", "readNotificationIds", "setReadNotificationIds",
        "snoozedNotifications", "setSnoozedNotifications", "designModelIdsSet",
        "removeFlashMessage", "addFlashMessage", "refreshState", "login", "logout", "logAction",
        "updateGlobalSettings", "formatSupplierWhatsappMessage", "openWhatsAppOrder",
        "addModelTimelineEvent", "addRole", "updateRole", "deleteRole",
        "sendInternalMessage", "markMessageRead", "normalizePartKey", "getModelParts",
        "getModelColorList", "getModelSizeList", "getPackagingRequirement", "getPartStages", "isPackagingReady",
        "getUserPermissionsObject", "hasSpecificPermission", "hasPermission", "hasAssemblyPackagingAccess",
        "canManagePermissions", "canManageUsers", "canManageSuppliers", "canManageSizes",
        "canViewAuditLogs", "canViewGlobalSettings", "canEditHeaderSettings", "canEditMessageTemplates",
        "canAccessSettings", "isCurrentUserSudo", "canAccessHRSection", "canManageHR",
        "currentUserRank", "visibleRankLevels", "visibleRankOptions", "rankLabelFor",
        "isRankVisibleToActor", "clampRankToVisible", "getEffectiveDelegatablePermissions",
        "canDelegatePermission", "getRoleEnabledPermissionKeys", "isRoleAssignable",
        "getCreatedDescendants", "canAddDesignNotes", "canAddCuttingNotes",
        "canAddQCBeforePrintNotes", "canAddQCAfterPrintNotes", "canAddSewingNotes", "canAddPrintingNotes",
        "canViewFabricPrices", "canEditFabricPrices", "canViewAccessoryPrices", "canEditAccessoryPrices",
        "canViewPrintingPrices", "canEditPrintingPrices", "canViewPrintingCosts", "canEditPrintingCosts",
        "canViewSewingPrices", "canEditSewingPrices", "canViewAssemblyPrices", "canEditAssemblyPrices",
        "canSendWhatsApp", "canSendMessages", "addModelAccessory",
    ]

    blocks = [
        ("appPermissions.ts", "buildPermissionHelpers", "  const getUserPermissionsObject =", "  const unreadMessagesCount ="),
        ("appWarehouseActions.ts", "buildWarehouseActions", "  const addFabricOrColor =", "  const addDesignModel ="),
        ("appDesignActions.ts", "buildDesignActions", "  const addDesignModel =", "  const normalizePartKey ="),
        ("appCuttingQcActions.ts", "buildCuttingQcActions", "  const addCuttingRecord =", "  const modelCodeOf ="),
        ("appExports.ts", "buildExportActions", "  const modelCodeOf =", "  const addPrintDispatch ="),
        ("appPrintSewingActions.ts", "buildPrintSewingActions", "  const addPrintDispatch =", "  const getPackagingRequirement ="),
        ("appAssemblyActions.ts", "buildAssemblyActions", "  const setPackagingStep =", "  const addSizeDef ="),
        ("appSettingsUsersActions.ts", "buildSettingsUsersActions", "  const addSizeDef =", "  // Smart Real-time In-App Notifications"),
    ]

    for fname, fn_name, start_p, end_p in blocks:
        s = idx_of(a_lines, start_p)
        e = idx_of(a_lines, end_p)
        chunk = "".join(a_lines[s:e])
        decls = re.findall(r"^  const ([a-zA-Z0-9_]+)\s*(?::[^=]+)?=", chunk, flags=re.M)
        needed_keys = [k for k in all_ctx_keys if k not in decls]
        destructure_block = "  const {\n    " + ", ".join(needed_keys) + "\n  } = ctx;\n"
        content = (
            top_imports
            + "import { NOTIFICATION_STAGE_PERMISSION, FlashMessage, modelPartsOf, seedModelPartStages, patchModelPartStage, patchModelPartsStage, DEFAULT_GLOBAL_SETTINGS, DESIGN_STAGES, PRE_PRODUCTION_STAGES, auditHeadersForModel } from './appContextTypes';\n\n"
            + f"export const {fn_name} = (ctx: any) => {{\n"
            + destructure_block
            + "\n"
            + chunk
            + "\n  return {\n    "
            + ",\n    ".join(decls)
            + "\n  };\n};\n"
        )
        with open(f"src/context/{fname}", "w", encoding="utf-8") as f:
            f.write(content)
