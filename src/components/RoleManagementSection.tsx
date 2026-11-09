import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { CustomRole, RolePermissions, SystemSectionKey } from '../types';
import {
  ShieldAlert,
  ShieldCheck,
  Plus,
  Edit2,
  Trash2,
  X,
  Check,
  Layers,
  Sparkles,
  Boxes,
  Palette,
  Scissors,
  Search,
  FileSpreadsheet,
  Printer,
  Shirt,
  Compass,
  Coins,
  MessageCircle,
  Send,
  Eye,
  Edit3,
  FileText,
  Settings,
  Globe
} from 'lucide-react';

export const SYSTEM_SECTIONS: {
  key: SystemSectionKey;
  label: string;
  description: string;
  icon: any;
  color: string;
  bgColor: string;
}[] = [
  {
    key: 'fabric_warehouse',
    label: 'مخزن قماش',
    description: 'عرض أصناف وألوان الأقمشة وحركات الإضافة والصرف وتنبيهات النواقص',
    icon: Layers,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 border-blue-200'
  },
  {
    key: 'accessories_warehouse',
    label: 'مخزن إكسسوارات',
    description: 'أصناف وموديلات الإكسسوارات (بادج، لعبة، ورد، دانتيل) والحد الأدنى للطلب',
    icon: Sparkles,
    color: 'text-pink-600',
    bgColor: 'bg-pink-50 border-pink-200'
  },
  {
    key: 'production_warehouse',
    label: 'مخزن إنتاج',
    description: 'مخزن الإنتاج التام والموديلات الجاهزة للتسليم والتوزيع',
    icon: Boxes,
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50 border-indigo-200'
  },
  {
    key: 'design',
    label: 'قسم التصميم',
    description: 'إضافة الموديلات الجديدة وتلوينها وسحب الخامات والإكسسوارات والماركر',
    icon: Palette,
    color: 'text-amber-600',
    bgColor: 'bg-amber-50 border-amber-200'
  },
  {
    key: 'cutting',
    label: 'قسم القص',
    description: 'استلام أوامر القص وتسجيل الراقات والفرش والأوزان ونقلها للجودة',
    icon: Scissors,
    color: 'text-rose-600',
    bgColor: 'bg-rose-50 border-rose-200'
  },
  {
    key: 'qc',
    label: 'الفرز والكنترول',
    description: 'العد والفرز في مراحله الـ 3 (قبل الطباعة، بعد الطباعة، بعد المكن)',
    icon: Search,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50 border-purple-200'
  },
  {
    key: 'printing',
    label: 'المطابع والتطريز',
    description: 'إرسال واستلام شحنات المطابع الخارجية وتتبع حالات التشغيل',
    icon: Printer,
    color: 'text-teal-600',
    bgColor: 'bg-teal-50 border-teal-200'
  },
  {
    key: 'sewing',
    label: 'قسم المكن',
    description: 'تشغيل الموديلات بعد عد الطباعة وطباعة بطاقات التشغيل المزدوجة',
    icon: Shirt,
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50 border-emerald-200'
  },
  {
    key: 'assembly_packaging',
    label: 'الأسمبلي والأمبالاج',
    description: 'متطلبات الأمبالاج (الصور والكروت) والتشطيب والمكواة والتعبئة والتغليف والدَست',
    icon: Boxes,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50 border-orange-200'
  },
  {
    key: 'models_tracking',
    label: 'حركة الموديلات',
    description: 'شاشة مركزية شاملة لكافة الموديلات والبحث وتتبع خط الإنتاج الزمني',
    icon: Compass,
    color: 'text-cyan-600',
    bgColor: 'bg-cyan-50 border-cyan-200'
  },
  {
    key: 'reports',
    label: 'التقارير والإحصائيات (Reports & Analytics)',
    description: 'مركز متابعة تقارير الإنتاجية المجمعة (القص، المطابع، الفرز، المكن) يومياً وأسبوعياً وشهرياً وطباعة المستندات الرسمية',
    icon: FileSpreadsheet,
    color: 'text-amber-600',
    bgColor: 'bg-amber-50 border-amber-200'
  }
];

export const NOTES_PERMISSIONS_LIST: {
  key: keyof RolePermissions;
  label: string;
  description: string;
}[] = [
  {
    key: 'can_add_design_notes',
    label: 'صلاحية تسجيل ملاحظات التصميم',
    description: 'السماح بإدخال وتعديل الملاحظات في قسم التصميم وتفاصيل الموديل'
  },
  {
    key: 'can_add_cutting_notes',
    label: 'صلاحية تسجيل ملاحظات القص',
    description: 'السماح للمقصدار أو مسؤول القص بكتابة ملاحظات عند تسجيل الراقات'
  },
  {
    key: 'can_add_qc_before_print_notes',
    label: 'صلاحية تسجيل ملاحظات الفرز قبل الطباعة',
    description: 'السماح بكتابة ملاحظات الجودة والعيوب في مرحلة الفرز قبل الطباعة'
  },
  {
    key: 'can_add_qc_after_print_notes',
    label: 'صلاحية تسجيل ملاحظات الفرز بعد الطباعة والمكن',
    description: 'السماح بكتابة ملاحظات الجودة في مرحلة العد بعد الطباعة والعد النهائي'
  },
  {
    key: 'can_add_sewing_notes',
    label: 'صلاحية تسجيل ملاحظات قسم المكن',
    description: 'السماح بكتابة ملاحظات التشغيل عند إرسال أو استلام الموديلات من ورش المكن'
  },
  {
    key: 'can_add_printing_notes',
    label: 'صلاحية تسجيل ملاحظات المطابع والتطريز',
    description: 'السماح بكتابة ملاحظات التشغيل عند إرسال الموديلات للمطابع'
  }
];

export const ADMIN_AND_SETTINGS_PERMISSIONS_LIST: {
  key: keyof RolePermissions;
  label: string;
  description: string;
  badge?: string;
}[] = [
  {
    key: 'manage_permissions',
    label: 'إدارة الصلاحيات والأدوار الديناميكية',
    description: 'إعطاء أو سحب أي صلاحية لأي مستخدم أو دور وظيفي في النظام',
    badge: 'صلاحية عليا'
  },
  {
    key: 'manage_users',
    label: 'إدارة الموظفين والحسابات',
    description: 'إضافة مستخدمين جدد، تفعيل أو إيقاف الحسابات، وتغيير كلمات المرور'
  },
  {
    key: 'manage_suppliers',
    label: 'إدارة وإضافة الموردين',
    description: 'إضافة وتحديث بيانات الموردين وشركات الغزل ومستودعات الإكسسوار'
  },
  {
    key: 'manage_sizes',
    label: 'إدارة وإضافة فئات المقاسات',
    description: 'إضافة وتحديث فئات المقاسات المعتمدة للموديلات'
  },
  {
    key: 'view_audit_logs',
    label: 'عرض سجل المراقبة (Audit Logs)',
    description: 'الاطلاع على سجل العمليات والتحركات والتدقيق الأمني للنظام'
  },
  {
    key: 'view_global_settings',
    label: 'عرض صفحة إعدادات الموقع العامة',
    description: 'الدخول إلى تبويب الإعدادات العامة للموقع'
  },
  {
    key: 'edit_header_settings',
    label: 'صلاحية تعديل الهيدر والشعار والفوتر',
    description: 'تغيير اسم الموقع في الهيدر، رفع شعار الموقع (Logo)، وتعديل نص حقوق الملكية في الفوتر'
  },
  {
    key: 'edit_message_templates',
    label: 'صلاحية تعديل الرسائل الجاهزة وتعليمات طباعة المكن',
    description: 'تعديل نص رسالة الواتساب للموردين، الرسائل الداخلية الجاهزة، والنص الافتراضي لتعليمات طباعة المكن'
  }
];

export const DEFAULT_PERMISSIONS: RolePermissions = {
  fabric_warehouse_view: false,
  fabric_warehouse_edit: false,
  accessories_warehouse_view: false,
  accessories_warehouse_edit: false,
  production_warehouse_view: false,
  production_warehouse_edit: false,
  design_view: false,
  design_edit: false,
  cutting_view: false,
  cutting_edit: false,
  qc_view: false,
  qc_edit: false,
  printing_view: false,
  printing_edit: false,
  sewing_view: false,
  sewing_edit: false,
  assembly_packaging_view: false,
  assembly_packaging_edit: false,
  models_tracking_view: false,
  models_tracking_edit: false,
  reports_view: false,
  reports_edit: false,

  // Financial & Sensitive Checkboxes
  view_fabric_prices: false,
  edit_fabric_prices: false,
  view_accessory_prices: false,
  edit_accessory_prices: false,
  view_printing_costs: false,
  edit_printing_costs: false,
  send_whatsapp_requests: false,
  send_internal_messages: false,

  // Administrative & Global Settings Permissions
  manage_permissions: false,
  manage_users: false,
  manage_suppliers: false,
  manage_sizes: false,
  view_audit_logs: false,
  view_global_settings: false,
  edit_header_settings: false,
  edit_message_templates: false,

  // Section Notes Permissions
  can_add_design_notes: false,
  can_add_cutting_notes: false,
  can_add_qc_before_print_notes: false,
  can_add_qc_after_print_notes: false,
  can_add_sewing_notes: false,
  can_add_printing_notes: false
};

export const RoleManagementSection: React.FC = () => {
  const { roles, users, addRole, updateRole, deleteRole, canManagePermissions } = useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<CustomRole | null>(null);

  // Form states
  const [roleName, setRoleName] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [permissions, setPermissions] = useState<RolePermissions>(DEFAULT_PERMISSIONS);

  if (!canManagePermissions()) {
    return (
      <div className="p-8 text-center bg-rose-50 rounded-3xl border border-rose-200">
        <ShieldAlert className="w-12 h-12 text-rose-600 mx-auto mb-3" />
        <h3 className="text-lg font-bold text-rose-900">منطقة مقيدة بالصلاحيات</h3>
        <p className="text-sm text-rose-700 mt-1">
          قسم "إدارة الصلاحيات" متاح للمستخدمين الحاصلين على صلاحية (إدارة الصلاحيات والأدوار الديناميكية).
        </p>
      </div>
    );
  }

  const openAddModal = () => {
    setEditingRole(null);
    setRoleName('');
    setRoleDescription('');
    setPermissions({ ...DEFAULT_PERMISSIONS });
    setModalOpen(true);
  };

  const openEditModal = (role: CustomRole) => {
    setEditingRole(role);
    setRoleName(role.name);
    setRoleDescription(role.description || '');
    setPermissions({
      ...DEFAULT_PERMISSIONS,
      ...role.permissions
    });
    setModalOpen(true);
  };

  const handleToggle = (section: SystemSectionKey, type: 'view' | 'edit') => {
    const viewKey = `${section}_view` as keyof RolePermissions;
    const editKey = `${section}_edit` as keyof RolePermissions;

    setPermissions((prev) => {
      const next = { ...prev };
      if (type === 'view') {
        const newVal = !next[viewKey];
        (next as any)[viewKey] = newVal;
        if (!newVal) {
          (next as any)[editKey] = false;
        }
      } else {
        const newVal = !next[editKey];
        (next as any)[editKey] = newVal;
        if (newVal) {
          (next as any)[viewKey] = true;
        }
      }
      return next;
    });
  };

  const handleToggleBooleanPerm = (key: keyof RolePermissions) => {
    setPermissions((prev) => {
      const next = { ...prev };
      const currentVal = Boolean(next[key]);
      const newVal = !currentVal;
      (next as any)[key] = newVal;

      // Auto enable view when edit is enabled
      if (newVal && key === 'edit_fabric_prices') next.view_fabric_prices = true;
      if (newVal && key === 'edit_accessory_prices') next.view_accessory_prices = true;
      if (newVal && key === 'edit_printing_costs') next.view_printing_costs = true;
      if (newVal && (key === 'edit_header_settings' || key === 'edit_message_templates')) {
        next.view_global_settings = true;
      }

      // Auto disable edit when view is disabled
      if (!newVal && key === 'view_fabric_prices') next.edit_fabric_prices = false;
      if (!newVal && key === 'view_accessory_prices') next.edit_accessory_prices = false;
      if (!newVal && key === 'view_printing_costs') next.edit_printing_costs = false;

      return next;
    });
  };

  const applyPreset = (preset: 'all_full' | 'all_view' | 'warehouse_only' | 'production_only') => {
    setPermissions((prev) => {
      const next = { ...prev };
      if (preset === 'all_full') {
        SYSTEM_SECTIONS.forEach((s) => {
          (next as any)[`${s.key}_view`] = true;
          (next as any)[`${s.key}_edit`] = true;
        });
        next.view_fabric_prices = true;
        next.edit_fabric_prices = true;
        next.view_accessory_prices = true;
        next.edit_accessory_prices = true;
        next.view_printing_costs = true;
        next.edit_printing_costs = true;
        next.send_whatsapp_requests = true;
        next.send_internal_messages = true;
        next.manage_permissions = true;
        next.manage_users = true;
        next.manage_suppliers = true;
        next.manage_sizes = true;
        next.view_audit_logs = true;
        next.view_global_settings = true;
        next.edit_header_settings = true;
        next.edit_message_templates = true;
        next.can_add_design_notes = true;
        next.can_add_cutting_notes = true;
        next.can_add_qc_before_print_notes = true;
        next.can_add_qc_after_print_notes = true;
        next.can_add_sewing_notes = true;
        next.can_add_printing_notes = true;
      } else if (preset === 'all_view') {
        SYSTEM_SECTIONS.forEach((s) => {
          (next as any)[`${s.key}_view`] = true;
          (next as any)[`${s.key}_edit`] = false;
        });
        next.view_fabric_prices = false;
        next.edit_fabric_prices = false;
        next.view_accessory_prices = false;
        next.edit_accessory_prices = false;
        next.view_printing_costs = false;
        next.edit_printing_costs = false;
        next.send_whatsapp_requests = false;
        next.manage_permissions = false;
        next.manage_users = false;
        next.edit_header_settings = false;
        next.edit_message_templates = false;
        next.can_add_design_notes = false;
        next.can_add_cutting_notes = false;
        next.can_add_qc_before_print_notes = false;
        next.can_add_qc_after_print_notes = false;
        next.can_add_sewing_notes = false;
        next.can_add_printing_notes = false;
      } else if (preset === 'warehouse_only') {
        SYSTEM_SECTIONS.forEach((s) => {
          const isWh = s.key.includes('warehouse');
          (next as any)[`${s.key}_view`] = isWh;
          (next as any)[`${s.key}_edit`] = isWh;
        });
        next.send_whatsapp_requests = true;
        next.manage_suppliers = true;
      } else if (preset === 'production_only') {
        SYSTEM_SECTIONS.forEach((s) => {
          const isProd = ['design', 'cutting', 'qc', 'printing', 'sewing', 'models_tracking', 'reports'].includes(s.key);
          (next as any)[`${s.key}_view`] = isProd;
          (next as any)[`${s.key}_edit`] = isProd;
        });
        next.can_add_design_notes = true;
        next.can_add_cutting_notes = true;
        next.can_add_qc_before_print_notes = true;
        next.can_add_qc_after_print_notes = true;
        next.can_add_sewing_notes = true;
        next.can_add_printing_notes = true;
      }
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleName.trim()) return;

    if (editingRole) {
      updateRole(editingRole.id, {
        name: roleName.trim(),
        description: roleDescription.trim(),
        permissions
      });
    } else {
      addRole({
        name: roleName.trim(),
        description: roleDescription.trim(),
        permissions
      });
    }

    setModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-blue-600" />
            <h3 className="text-xl font-black text-slate-900 tracking-tight">
              إدارة الصلاحيات والأدوار الديناميكية (Dynamic Permissions)
            </h3>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            نظام صلاحيات ديناميكي بالكامل: تحديد صلاحيات الأقسام، ملاحظات كل مرحلة، الإعدادات العامة، الأسعار، وإدارة الصلاحيات لأي دور أو مستخدم.
          </p>
        </div>

        <button
          onClick={openAddModal}
          className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md shadow-blue-500/20 transition self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>+ إضافة دور وظيفي جديد</span>
        </button>
      </div>

      {/* Roles Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {roles.map((role) => {
          const userCount = users.filter(
            (u) =>
              u.username?.toLowerCase() !== 'sudo' &&
              !u.is_sudo &&
              (u.role_id === role.id || u.role === role.name)
          ).length;
          const allowedSectionsCount = SYSTEM_SECTIONS.filter(
            (s) => role.permissions[`${s.key}_view` as keyof RolePermissions]
          ).length;

          const hasFinancial =
            role.permissions.view_fabric_prices ||
            role.permissions.view_accessory_prices ||
            role.permissions.view_printing_costs;

          const hasNotesPerms = NOTES_PERMISSIONS_LIST.some((np) => Boolean(role.permissions[np.key]));
          const hasAdminPerms = Boolean(role.permissions.manage_permissions || role.permissions.manage_users);

          return (
            <div
              key={role.id}
              className="bg-white rounded-3xl border border-slate-200/90 p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center font-bold text-sm">
                      {role.name[0]}
                    </div>
                    <div>
                      <h4 className="font-extrabold text-base text-slate-900 leading-tight">
                        {role.name}
                      </h4>
                      <span className="text-[11px] font-semibold text-slate-400">
                        {userCount} موظف مرتبط
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 opacity-90 group-hover:opacity-100 transition">
                    <button
                      onClick={() => openEditModal(role)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition cursor-pointer"
                      title="تعديل الصلاحيات"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`هل أنت متأكد من حذف الدور الوظيفي "${role.name}"؟`)) {
                          deleteRole(role.id);
                        }
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                      title="حذف الدور"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <p className="text-xs text-slate-500 line-clamp-2 min-h-[32px] mb-4">
                  {role.description || 'لا يوجد وصف محدد لهذا الدور'}
                </p>

                {/* Badges for active sections */}
                <div className="space-y-2 pt-3 border-t border-slate-100">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-600">
                    <span>الأقسام المصرح بها:</span>
                    <span className="text-blue-600">
                      {allowedSectionsCount} من {SYSTEM_SECTIONS.length}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pt-1">
                    {SYSTEM_SECTIONS.map((sec) => {
                      const canView = role.permissions[`${sec.key}_view` as keyof RolePermissions];
                      const canEdit = role.permissions[`${sec.key}_edit` as keyof RolePermissions];
                      if (!canView) return null;

                      return (
                        <span
                          key={sec.key}
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            canEdit
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          {sec.label} {canEdit ? '✍️' : '👁️'}
                        </span>
                      );
                    })}
                  </div>

                  {/* Indicators */}
                  <div className="pt-2 flex flex-wrap gap-1 text-[10px] font-semibold">
                    {hasAdminPerms && (
                      <span className="bg-indigo-50 text-indigo-800 border border-indigo-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3 text-indigo-600" />
                        إدارة وصلاحيات
                      </span>
                    )}
                    {hasNotesPerms && (
                      <span className="bg-purple-50 text-purple-800 border border-purple-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <FileText className="w-3 h-3 text-purple-600" />
                        كتابة ملاحظات
                      </span>
                    )}
                    {hasFinancial && (
                      <span className="bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Coins className="w-3 h-3 text-amber-600" />
                        صلاحيات مالية
                      </span>
                    )}
                    {role.permissions.send_whatsapp_requests && (
                      <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <MessageCircle className="w-3 h-3 text-emerald-600" />
                        طلبات واتساب
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add / Edit Role Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            {/* Header */}
            <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/70">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-blue-600 text-white shadow-xs">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-lg text-slate-900">
                    {editingRole ? `تعديل صلاحيات دور: ${editingRole.name}` : 'إنشاء دور وظيفي ديناميكي جديد'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    حدد صلاحيات الأقسام، ملاحظات العمل، الإعدادات العامة، والصلاحيات الإدارية والمالية.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Form Body */}
            <form onSubmit={handleSubmit} className="flex-grow overflow-y-auto p-6 space-y-6">
              {/* Basic Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    اسم الدور الوظيفي <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={roleName}
                    onChange={(e) => setRoleName(e.target.value)}
                    placeholder="مثال: مسؤول المخازن والمشتريات"
                    className="w-full px-4 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    وصف مختصر للدور والمهام
                  </label>
                  <input
                    type="text"
                    value={roleDescription}
                    onChange={(e) => setRoleDescription(e.target.value)}
                    placeholder="مثال: إدارة المخزون وطلب النواقص ومتابعة الجرد"
                    className="w-full px-4 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Quick Presets */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-600">تطبيق نمط صلاحيات سريع:</span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => applyPreset('all_full')}
                    className="px-3 py-1 rounded-lg text-xs font-bold bg-white hover:bg-blue-50 text-blue-700 border border-slate-200 shadow-2xs cursor-pointer"
                  >
                    تحديد الكل (كامل + إداري + مالي)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('warehouse_only')}
                    className="px-3 py-1 rounded-lg text-xs font-bold bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 shadow-2xs cursor-pointer"
                  >
                    مخازن فقط
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('production_only')}
                    className="px-3 py-1 rounded-lg text-xs font-bold bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 shadow-2xs cursor-pointer"
                  >
                    خطوط إنتاج وتشغيل + ملاحظات
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('all_view')}
                    className="px-3 py-1 rounded-lg text-xs font-bold bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 shadow-2xs cursor-pointer"
                  >
                    مشاهدة فقط (بدون تعديل)
                  </button>
                </div>
              </div>

              {/* SECTION 1: System Modules (View / Edit Grid) */}
              <div>
                <h4 className="text-sm font-extrabold text-slate-900 mb-3 flex items-center gap-2">
                  <span>1. صلاحيات الأقسام الرئيسية ({SYSTEM_SECTIONS.length} أقسام):</span>
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {SYSTEM_SECTIONS.map((sec) => {
                    const viewKey = `${sec.key}_view` as keyof RolePermissions;
                    const editKey = `${sec.key}_edit` as keyof RolePermissions;
                    const canView = Boolean(permissions[viewKey]);
                    const canEdit = Boolean(permissions[editKey]);
                    const Icon = sec.icon;

                    return (
                      <div
                        key={sec.key}
                        className={`p-3.5 rounded-2xl border transition-all ${
                          canView ? 'bg-white border-slate-300 shadow-2xs' : 'bg-slate-50/70 border-slate-200 opacity-70'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2.5">
                            <div className={`p-2 rounded-xl ${sec.bgColor} ${sec.color}`}>
                              <Icon className="w-4 h-4" />
                            </div>
                            <div>
                              <span className="font-extrabold text-sm text-slate-900 block leading-tight">
                                {sec.label}
                              </span>
                              <span className="text-[10px] text-slate-500 line-clamp-1">
                                {sec.description}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => handleToggle(sec.key, 'view')}
                            className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-xl text-xs font-bold transition border cursor-pointer ${
                              canView
                                ? 'bg-blue-50 text-blue-700 border-blue-200 shadow-2xs'
                                : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>رؤية ومشاهدة</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleToggle(sec.key, 'edit')}
                            className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-xl text-xs font-bold transition border cursor-pointer ${
                              canEdit
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 shadow-2xs'
                                : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>تعديل وحفظ</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* SECTION 2: Department Notes Permissions (Task 4) */}
              <div className="bg-purple-50/60 rounded-3xl p-5 border border-purple-200/90 space-y-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-purple-600 text-white rounded-xl shadow-xs">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-black text-sm text-purple-950">
                      2. صلاحيات تسجيل الملاحظات المستقلة لكل قسم (Notes Permissions)
                    </h4>
                    <p className="text-[11px] text-purple-800">
                      وصول الموظف للقسم لا يعني قدرته على كتابة ملاحظة؛ حدد بدقة الأقسام التي يحق لهذا الدور كتابة ملاحظات بها.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {NOTES_PERMISSIONS_LIST.map((np) => (
                    <label
                      key={np.key}
                      className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-purple-200 hover:border-purple-400 cursor-pointer transition shadow-2xs"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(permissions[np.key])}
                        onChange={() => handleToggleBooleanPerm(np.key)}
                        className="w-4 h-4 text-purple-600 rounded-sm focus:ring-purple-500"
                      />
                      <div className="text-start">
                        <span className="font-bold text-xs text-slate-900 block">{np.label}</span>
                        <span className="text-[10px] text-slate-500">{np.description}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* SECTION 3: Dynamic Administrative & Global Site Settings Permissions (Tasks 2 & 3) */}
              <div className="bg-indigo-50/60 rounded-3xl p-5 border border-indigo-200/90 space-y-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-xs">
                    <Settings className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-black text-sm text-indigo-950">
                      3. الصلاحيات الإدارية وإعدادات الموقع العامة (Admin & Global Settings)
                    </h4>
                    <p className="text-[11px] text-indigo-800">
                      يمكنك منح أي من هذه الصلاحيات لأي دور وظيفي أو مستخدم (بما في ذلك صلاحية إدارة الصلاحيات وتعديل الهيدر والرسائل).
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {ADMIN_AND_SETTINGS_PERMISSIONS_LIST.map((ap) => (
                    <label
                      key={ap.key}
                      className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-indigo-200 hover:border-indigo-400 cursor-pointer transition shadow-2xs"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(permissions[ap.key])}
                        onChange={() => handleToggleBooleanPerm(ap.key)}
                        className="w-4 h-4 text-indigo-600 rounded-sm focus:ring-indigo-500"
                      />
                      <div className="text-start">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-xs text-slate-900">{ap.label}</span>
                          {ap.badge && (
                            <span className="px-1.5 py-0.2 rounded-full bg-indigo-100 text-indigo-800 text-[9px] font-black">
                              {ap.badge}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-500 block">{ap.description}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* SECTION 4: Fine-grained Financial & WhatsApp Permissions */}
              <div className="bg-amber-50/60 rounded-3xl p-5 border border-amber-200/90 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-amber-500 text-white rounded-xl shadow-xs">
                      <Coins className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-black text-sm text-amber-950">
                        4. الصلاحيات المالية والتواصل الحساس (Financial & WhatsApp)
                      </h4>
                      <p className="text-[11px] text-amber-800">
                        من يمتلك هذه الخيارات فقط هو من تظهر له خانات الأسعار والتكلفة وأزرار طلبات الواتساب في النظام.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  {/* Fabric Prices */}
                  <label className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-amber-200 hover:border-amber-400 cursor-pointer transition shadow-2xs">
                    <input
                      type="checkbox"
                      checked={permissions.view_fabric_prices}
                      onChange={() => handleToggleBooleanPerm('view_fabric_prices')}
                      className="w-4 h-4 text-amber-600 rounded-sm focus:ring-amber-500"
                    />
                    <div className="text-start">
                      <span className="font-bold text-xs text-slate-900 block">رؤية أسعار القماش</span>
                      <span className="text-[10px] text-slate-500">إظهار أسعار الكيلو/التوب في مخزن الأقمشة</span>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-amber-200 hover:border-amber-400 cursor-pointer transition shadow-2xs">
                    <input
                      type="checkbox"
                      checked={permissions.edit_fabric_prices}
                      onChange={() => handleToggleBooleanPerm('edit_fabric_prices')}
                      className="w-4 h-4 text-amber-600 rounded-sm focus:ring-amber-500"
                    />
                    <div className="text-start">
                      <span className="font-bold text-xs text-slate-900 block">تعديل أسعار القماش</span>
                      <span className="text-[10px] text-slate-500">السماح بتحديث سعر الوحدة لألوان الأقمشة</span>
                    </div>
                  </label>

                  {/* Accessory Prices */}
                  <label className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-amber-200 hover:border-amber-400 cursor-pointer transition shadow-2xs">
                    <input
                      type="checkbox"
                      checked={permissions.view_accessory_prices}
                      onChange={() => handleToggleBooleanPerm('view_accessory_prices')}
                      className="w-4 h-4 text-amber-600 rounded-sm focus:ring-amber-500"
                    />
                    <div className="text-start">
                      <span className="font-bold text-xs text-slate-900 block">رؤية أسعار الإكسسوارات</span>
                      <span className="text-[10px] text-slate-500">إظهار سعر القطعة في مخزن الإكسسوارات والمستلزمات</span>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-amber-200 hover:border-amber-400 cursor-pointer transition shadow-2xs">
                    <input
                      type="checkbox"
                      checked={permissions.edit_accessory_prices}
                      onChange={() => handleToggleBooleanPerm('edit_accessory_prices')}
                      className="w-4 h-4 text-amber-600 rounded-sm focus:ring-amber-500"
                    />
                    <div className="text-start">
                      <span className="font-bold text-xs text-slate-900 block">تعديل أسعار الإكسسوارات</span>
                      <span className="text-[10px] text-slate-500">السماح بتحديث وتعديل أسعار أصناف الإكسسوارات</span>
                    </div>
                  </label>

                  {/* Printing Costs */}
                  <label className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-amber-200 hover:border-amber-400 cursor-pointer transition shadow-2xs">
                    <input
                      type="checkbox"
                      checked={permissions.view_printing_costs}
                      onChange={() => handleToggleBooleanPerm('view_printing_costs')}
                      className="w-4 h-4 text-amber-600 rounded-sm focus:ring-amber-500"
                    />
                    <div className="text-start">
                      <span className="font-bold text-xs text-slate-900 block">رؤية تكاليف المطابع</span>
                      <span className="text-[10px] text-slate-500">إظهار تكلفة تشغيل وطباعة القطعة والإجمالي</span>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-amber-200 hover:border-amber-400 cursor-pointer transition shadow-2xs">
                    <input
                      type="checkbox"
                      checked={permissions.edit_printing_costs}
                      onChange={() => handleToggleBooleanPerm('edit_printing_costs')}
                      className="w-4 h-4 text-amber-600 rounded-sm focus:ring-amber-500"
                    />
                    <div className="text-start">
                      <span className="font-bold text-xs text-slate-900 block">تعديل تكاليف المطابع</span>
                      <span className="text-[10px] text-slate-500">السماح بتسجيل وتعديل تكلفة التشغيل للمطابع</span>
                    </div>
                  </label>

                  {/* WhatsApp Orders Permission */}
                  <label className="sm:col-span-2 flex items-center gap-3 p-3 bg-emerald-50/80 rounded-2xl border border-emerald-300 hover:border-emerald-500 cursor-pointer transition shadow-2xs">
                    <input
                      type="checkbox"
                      checked={permissions.send_whatsapp_requests}
                      onChange={() => handleToggleBooleanPerm('send_whatsapp_requests')}
                      className="w-4 h-4 text-emerald-600 rounded-sm focus:ring-emerald-500"
                    />
                    <div className="text-start">
                      <span className="font-black text-xs text-emerald-950 block flex items-center gap-1.5">
                        <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
                        إرسال طلبات النواقص عبر الواتساب (WhatsApp Direct Ordering)
                      </span>
                      <span className="text-[11px] text-emerald-800">
                        إظهار أزرار التواصل المباشر وإرسال طلبات النواقص للموردين عبر الواتساب في مخازن الأقمشة والإكسسوارات.
                      </span>
                    </div>
                  </label>

                  {/* Internal Messaging Permission */}
                  <label className="sm:col-span-2 flex items-center gap-3 p-3 bg-blue-50/80 rounded-2xl border border-blue-300 hover:border-blue-500 cursor-pointer transition shadow-2xs">
                    <input
                      type="checkbox"
                      checked={permissions.send_internal_messages}
                      onChange={() => handleToggleBooleanPerm('send_internal_messages')}
                      className="w-4 h-4 text-blue-600 rounded-sm focus:ring-blue-500"
                    />
                    <div className="text-start">
                      <span className="font-black text-xs text-blue-950 block flex items-center gap-1.5">
                        <Send className="w-3.5 h-3.5 text-blue-600" />
                        إرسال الرسائل والمراسلات الداخلية (Can Send Internal Messages)
                      </span>
                      <span className="text-[11px] text-blue-800">
                        السماح للمستخدم بإرسال ومراسلة الزملاء مباشرة في نظام الرسائل والتوجيهات الداخلية.
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Form Action Buttons */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-5 py-2.5 rounded-full text-xs font-bold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-full text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 transition flex items-center gap-2 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>{editingRole ? 'حفظ التعديلات' : 'إنشاء الدور'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
