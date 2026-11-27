import {
  LayoutDashboard,
  Layers,
  Sparkles,
  PackageOpen,
  Boxes,
  ShoppingCart,
  Palette,
  Scissors,
  Search,
  Printer,
  Shirt,
  Flame,
  Package,
  PackageCheck,
  FileText,
  BarChart3,
  Users,
  Clock,
  Scale,
  Wallet,
  Settings,
  History
} from 'lucide-react';
import {
  CardsLayoutConfig,
  CardsLayoutGroup,
  CardsLayoutItem,
  HRSectionKey,
  ReadinessStageKey,
  SystemSectionKey
} from '../types';

export interface NavSectionDef {
  id: string;
  label: string;
  subtitle: string;
  defaultGroupId: string;
  defaultGroupTitle: string;
  icon: any;
  iconColor: string;
  iconBg: string;
  borderHover: string;
  alertCount?: number;
}

export interface NavPermissionCheckers {
  isSudo: boolean;
  hasPermission: (
    module: SystemSectionKey | 'warehouse' | 'design' | 'cutting' | 'qc' | 'reports',
    requireEdit?: boolean
  ) => boolean;
  hasAssemblyPackagingAccess: (requireEdit?: boolean) => boolean;
  canAccessReadinessStage: (stage: ReadinessStageKey) => boolean;
  canManageHR: () => boolean;
  canAccessHRSection: (section: HRSectionKey) => boolean;
  canAccessSettings: () => boolean;
  canViewAuditLogs: () => boolean;
  purchaseAlertCount?: number;
}

export function getAuthorizedNavSections(perms: NavPermissionCheckers): NavSectionDef[] {
  const {
    isSudo,
    hasPermission,
    hasAssemblyPackagingAccess,
    canAccessReadinessStage,
    canManageHR,
    canAccessHRSection,
    canAccessSettings,
    canViewAuditLogs,
    purchaseAlertCount = 0
  } = perms;

  const hrAllowed = canManageHR();

  const all: Array<NavSectionDef & { isVisible: boolean }> = [
    // الرئيسية
    {
      id: 'dashboard',
      label: 'الرئيسية',
      subtitle: 'لوحة المتابعة السريعة وملخص حالة المصنع',
      defaultGroupId: 'grp-core',
      defaultGroupTitle: 'الرئيسية',
      icon: LayoutDashboard,
      iconColor: 'text-slate-700',
      iconBg: 'bg-slate-100',
      borderHover: 'hover:border-slate-400',
      isVisible: true
    },

    // قسم المخازن
    {
      id: 'warehouse',
      label: 'مخزن القماش',
      subtitle: 'الأصناف والألوان والأرصدة وحركات الوارد والصادر',
      defaultGroupId: 'grp-warehouses',
      defaultGroupTitle: 'قسم المخازن',
      icon: Layers,
      iconColor: 'text-blue-600',
      iconBg: 'bg-blue-50',
      borderHover: 'hover:border-blue-400',
      isVisible: hasPermission('fabric_warehouse')
    },
    {
      id: 'accessories_warehouse',
      label: 'مخزن الإكسسوارات',
      subtitle: 'الإكسسوارات والمستلزمات والمحجوز والنواقص',
      defaultGroupId: 'grp-warehouses',
      defaultGroupTitle: 'قسم المخازن',
      icon: Sparkles,
      iconColor: 'text-pink-600',
      iconBg: 'bg-pink-50',
      borderHover: 'hover:border-pink-400',
      isVisible: hasPermission('accessories_warehouse')
    },
    {
      id: 'packaging_materials',
      label: 'خامات التشغيل والأمبالاج',
      subtitle: 'الأكياس والكرتون والشماعات وخامات التعبئة',
      defaultGroupId: 'grp-warehouses',
      defaultGroupTitle: 'قسم المخازن',
      icon: PackageOpen,
      iconColor: 'text-orange-600',
      iconBg: 'bg-orange-50',
      borderHover: 'hover:border-orange-400',
      isVisible: hasAssemblyPackagingAccess()
    },
    {
      id: 'production_warehouse',
      label: 'مخزن الإنتاج التام',
      subtitle: 'الموديلات المكتملة وجرد الإنتاج الجاهز للتسليم',
      defaultGroupId: 'grp-warehouses',
      defaultGroupTitle: 'قسم المخازن',
      icon: Boxes,
      iconColor: 'text-indigo-600',
      iconBg: 'bg-indigo-50',
      borderHover: 'hover:border-indigo-400',
      isVisible: hasPermission('production_warehouse')
    },
    {
      id: 'purchase_requests',
      label: 'طلبات الشراء',
      subtitle: 'طلبات النواقص والمشتريات ومتابعة الموردين',
      defaultGroupId: 'grp-warehouses',
      defaultGroupTitle: 'قسم المخازن',
      icon: ShoppingCart,
      iconColor: 'text-amber-600',
      iconBg: 'bg-amber-50',
      borderHover: 'hover:border-amber-400',
      alertCount: purchaseAlertCount,
      isVisible: hasPermission('purchase_requests')
    },

    // التصنيع ومتابعة الإنتاج
    {
      id: 'design',
      label: 'التصميم',
      subtitle: 'إنشاء الموديلات وخطط القماش والإكسسوارات',
      defaultGroupId: 'grp-production',
      defaultGroupTitle: 'التصنيع ومتابعة الإنتاج',
      icon: Palette,
      iconColor: 'text-slate-800',
      iconBg: 'bg-slate-100',
      borderHover: 'hover:border-slate-400',
      isVisible: hasPermission('design')
    },
    {
      id: 'cutting',
      label: 'القص',
      subtitle: 'تسجيل الفرشات والألوان وكميات القص الفعلية',
      defaultGroupId: 'grp-production',
      defaultGroupTitle: 'التصنيع ومتابعة الإنتاج',
      icon: Scissors,
      iconColor: 'text-rose-600',
      iconBg: 'bg-rose-50',
      borderHover: 'hover:border-rose-400',
      isVisible: hasPermission('cutting')
    },
    {
      id: 'qc',
      label: 'قسم الفرز',
      subtitle: 'العد والفرز قبل الطباعة وبعد الطباعة وبعد المكن',
      defaultGroupId: 'grp-production',
      defaultGroupTitle: 'التصنيع ومتابعة الإنتاج',
      icon: Search,
      iconColor: 'text-purple-600',
      iconBg: 'bg-purple-50',
      borderHover: 'hover:border-purple-400',
      isVisible: hasPermission('qc')
    },
    {
      id: 'printing',
      label: 'قسم الطباعة',
      subtitle: 'إرسال واستلام تشغيلات المطابع والتطريز',
      defaultGroupId: 'grp-production',
      defaultGroupTitle: 'التصنيع ومتابعة الإنتاج',
      icon: Printer,
      iconColor: 'text-teal-600',
      iconBg: 'bg-teal-50',
      borderHover: 'hover:border-teal-400',
      isVisible: hasPermission('printing') || hasPermission('reports')
    },
    {
      id: 'sewing',
      label: 'قسم المكن',
      subtitle: 'تشغيل ورش المكن والخياطة والاستلام الجزئي والكلي',
      defaultGroupId: 'grp-production',
      defaultGroupTitle: 'التصنيع ومتابعة الإنتاج',
      icon: Shirt,
      iconColor: 'text-emerald-600',
      iconBg: 'bg-emerald-50',
      borderHover: 'hover:border-emerald-400',
      isVisible: hasPermission('sewing')
    },
    {
      id: 'assembly_packaging',
      label: 'الأسمبلي والأمبالاج',
      subtitle: 'التشطيب والمكواة والتعبئة والدَست النهائي',
      defaultGroupId: 'grp-production',
      defaultGroupTitle: 'التصنيع ومتابعة الإنتاج',
      icon: Boxes,
      iconColor: 'text-orange-600',
      iconBg: 'bg-orange-50',
      borderHover: 'hover:border-orange-400',
      isVisible: hasAssemblyPackagingAccess()
    },
    {
      id: 'unified_model_cards',
      label: 'بطاقة الموديل الشاملة',
      subtitle: 'عرض تفصيلي موحّد لمراحل وحركة كل موديل',
      defaultGroupId: 'grp-production',
      defaultGroupTitle: 'التصنيع ومتابعة الإنتاج',
      icon: FileText,
      iconColor: 'text-violet-600',
      iconBg: 'bg-violet-50',
      borderHover: 'hover:border-violet-400',
      isVisible: hasPermission('models_tracking') || hasPermission('reports') || isSudo
    },
    {
      id: 'reports',
      label: 'التقارير والإحصائيات',
      subtitle: 'تقارير الأداء والإنتاج والسرعة والتكاليف',
      defaultGroupId: 'grp-production',
      defaultGroupTitle: 'التصنيع ومتابعة الإنتاج',
      icon: BarChart3,
      iconColor: 'text-amber-600',
      iconBg: 'bg-amber-50',
      borderHover: 'hover:border-amber-400',
      isVisible: hasPermission('reports') || isSudo
    },

    // جاهزية الموديلات
    {
      id: 'readiness_print',
      label: 'جاهزية المطابع',
      subtitle: 'متابعة جاهزية الموديلات لمرحلة المطابع',
      defaultGroupId: 'grp-readiness',
      defaultGroupTitle: 'جاهزية الموديلات',
      icon: Printer,
      iconColor: 'text-teal-600',
      iconBg: 'bg-teal-50',
      borderHover: 'hover:border-teal-400',
      isVisible: canAccessReadinessStage('print')
    },
    {
      id: 'readiness_sewing',
      label: 'جاهزية المكن',
      subtitle: 'متابعة جاهزية الموديلات لمرحلة المكن',
      defaultGroupId: 'grp-readiness',
      defaultGroupTitle: 'جاهزية الموديلات',
      icon: Shirt,
      iconColor: 'text-emerald-600',
      iconBg: 'bg-emerald-50',
      borderHover: 'hover:border-emerald-400',
      isVisible: canAccessReadinessStage('sewing')
    },
    {
      id: 'readiness_finishing',
      label: 'جاهزية التشطيب',
      subtitle: 'متابعة جاهزية الموديلات لمرحلة التشطيب',
      defaultGroupId: 'grp-readiness',
      defaultGroupTitle: 'جاهزية الموديلات',
      icon: Sparkles,
      iconColor: 'text-purple-600',
      iconBg: 'bg-purple-50',
      borderHover: 'hover:border-purple-400',
      isVisible: canAccessReadinessStage('finishing')
    },
    {
      id: 'readiness_ironing',
      label: 'جاهزية المكواة',
      subtitle: 'متابعة جاهزية الموديلات لمرحلة المكواة',
      defaultGroupId: 'grp-readiness',
      defaultGroupTitle: 'جاهزية الموديلات',
      icon: Flame,
      iconColor: 'text-rose-600',
      iconBg: 'bg-rose-50',
      borderHover: 'hover:border-rose-400',
      isVisible: canAccessReadinessStage('ironing')
    },
    {
      id: 'readiness_packaging',
      label: 'جاهزية التغليف',
      subtitle: 'متابعة جاهزية الموديلات لمرحلة التغليف',
      defaultGroupId: 'grp-readiness',
      defaultGroupTitle: 'جاهزية الموديلات',
      icon: Package,
      iconColor: 'text-orange-600',
      iconBg: 'bg-orange-50',
      borderHover: 'hover:border-orange-400',
      isVisible: canAccessReadinessStage('packaging')
    },
    {
      id: 'readiness_dest',
      label: 'جاهزية الدَست',
      subtitle: 'متابعة جاهزية الموديلات لمرحلة الدَست',
      defaultGroupId: 'grp-readiness',
      defaultGroupTitle: 'جاهزية الموديلات',
      icon: PackageCheck,
      iconColor: 'text-indigo-600',
      iconBg: 'bg-indigo-50',
      borderHover: 'hover:border-indigo-400',
      isVisible: canAccessReadinessStage('dest')
    },

    // الموارد البشرية
    {
      id: 'hr_employees',
      label: 'الموظفين والوظائف',
      subtitle: 'ملفات موظفي المصنع والمسميات الوظيفية',
      defaultGroupId: 'grp-hr',
      defaultGroupTitle: 'الموارد البشرية (HR)',
      icon: Users,
      iconColor: 'text-purple-600',
      iconBg: 'bg-purple-50',
      borderHover: 'hover:border-purple-400',
      isVisible: hrAllowed && (canAccessHRSection('employees') || canAccessHRSection('jobs'))
    },
    {
      id: 'hr_attendance',
      label: 'الحضور والانصراف',
      subtitle: 'متابعة البصمة والحضور وقواعد المواعيد',
      defaultGroupId: 'grp-hr',
      defaultGroupTitle: 'الموارد البشرية (HR)',
      icon: Clock,
      iconColor: 'text-purple-600',
      iconBg: 'bg-purple-50',
      borderHover: 'hover:border-purple-400',
      isVisible: hrAllowed && (canAccessHRSection('attendance') || canAccessHRSection('rules'))
    },
    {
      id: 'hr_loans',
      label: 'السُلف والجزاءات',
      subtitle: 'إدارة السلف المالية والجزاءات والخصومات',
      defaultGroupId: 'grp-hr',
      defaultGroupTitle: 'الموارد البشرية (HR)',
      icon: Scale,
      iconColor: 'text-purple-600',
      iconBg: 'bg-purple-50',
      borderHover: 'hover:border-purple-400',
      isVisible: hrAllowed && (canAccessHRSection('loans') || canAccessHRSection('penalties'))
    },
    {
      id: 'hr_payroll',
      label: 'المرتبات',
      subtitle: 'احتساب ومراجعة وصرف كشوف المرتبات الشهرية',
      defaultGroupId: 'grp-hr',
      defaultGroupTitle: 'الموارد البشرية (HR)',
      icon: Wallet,
      iconColor: 'text-purple-600',
      iconBg: 'bg-purple-50',
      borderHover: 'hover:border-purple-400',
      isVisible: hrAllowed && canAccessHRSection('payroll')
    },
    {
      id: 'hr_reports',
      label: 'تقارير الموارد البشرية',
      subtitle: 'ملخصات الحضور والأداء والتقارير الشهرية',
      defaultGroupId: 'grp-hr',
      defaultGroupTitle: 'الموارد البشرية (HR)',
      icon: BarChart3,
      iconColor: 'text-purple-600',
      iconBg: 'bg-purple-50',
      borderHover: 'hover:border-purple-400',
      isVisible: hrAllowed && (canAccessHRSection('reports') || canAccessHRSection('payroll'))
    },

    // الإدارة والإعدادات
    {
      id: 'settings',
      label: 'الإعدادات',
      subtitle: 'المستخدمون، الصلاحيات، الإعدادات العامة وتخصيص الواجهة',
      defaultGroupId: 'grp-admin',
      defaultGroupTitle: 'الإدارة والإعدادات',
      icon: Settings,
      iconColor: 'text-slate-700',
      iconBg: 'bg-slate-100',
      borderHover: 'hover:border-slate-400',
      isVisible: canAccessSettings()
    },
    {
      id: 'logs',
      label: 'سجل التدقيق',
      subtitle: 'متابعة سجل العمليات والتعديلات داخل النظام',
      defaultGroupId: 'grp-admin',
      defaultGroupTitle: 'الإدارة والإعدادات',
      icon: History,
      iconColor: 'text-slate-700',
      iconBg: 'bg-slate-100',
      borderHover: 'hover:border-slate-400',
      isVisible: canViewAuditLogs()
    }
  ];

  return all
    .filter((item) => item.isVisible)
    .map(({ isVisible: _v, ...rest }) => rest);
}

/** بناء التخطيط الافتراضي المرتب بمجموعات للأقسام المصرح بها للمستخدم فقط. */
export function buildDefaultCardsLayout(authorizedSections: NavSectionDef[]): CardsLayoutConfig {
  const groupMap = new Map<string, CardsLayoutGroup>();
  for (const sec of authorizedSections) {
    let grp = groupMap.get(sec.defaultGroupId);
    if (!grp) {
      grp = {
        id: sec.defaultGroupId,
        title: sec.defaultGroupTitle,
        items: []
      };
      groupMap.set(sec.defaultGroupId, grp);
    }
    grp.items.push({
      kind: 'card',
      id: `card-${sec.id}`,
      tabId: sec.id
    });
  }
  return {
    version: 1,
    groups: Array.from(groupMap.values())
  };
}

/**
 * مطابقة التخطيط المحفوظ مع الصلاحيات الحالية للمستخدم:
 * - إزالة أي كارت قسم لم يعد مصرحاً به.
 * - منع تكرار نفس القسم.
 * - إلحاق أي قسم مصرح به غير موجود في التخطيط المحفوظ تلقائياً حتى لا يختفي أبداً.
 */
export function reconcileCardsLayout(
  saved: CardsLayoutConfig | null | undefined,
  authorizedSections: NavSectionDef[]
): CardsLayoutConfig {
  if (!saved || !Array.isArray(saved.groups) || saved.groups.length === 0) {
    return buildDefaultCardsLayout(authorizedSections);
  }

  const allowedIds = new Set(authorizedSections.map((s) => s.id));
  const placedTabIds = new Set<string>();
  const cleanedGroups: CardsLayoutGroup[] = [];

  for (const grp of saved.groups) {
    if (!grp || typeof grp !== 'object') continue;
    const grpId = String(grp.id || `grp-${cleanedGroups.length + 1}`);
    const grpTitle = String(grp.title || 'مجموعة بدون اسم').trim() || 'مجموعة بدون اسم';
    const rawItems = Array.isArray(grp.items) ? grp.items : [];
    const cleanedItems: CardsLayoutItem[] = [];

    for (const item of rawItems) {
      if (!item || typeof item !== 'object') continue;
      if (item.kind === 'card') {
        const tabId = String(item.tabId || '');
        if (!allowedIds.has(tabId) || placedTabIds.has(tabId)) continue;
        placedTabIds.add(tabId);
        cleanedItems.push({
          kind: 'card',
          id: String(item.id || `card-${tabId}`),
          tabId
        });
      } else if (item.kind === 'spacer') {
        cleanedItems.push({
          kind: 'spacer',
          id: String(item.id || `spacer-${Math.random().toString(36).slice(2, 8)}`)
        });
      } else if (item.kind === 'divider') {
        cleanedItems.push({
          kind: 'divider',
          id: String(item.id || `divider-${Math.random().toString(36).slice(2, 8)}`),
          label: typeof item.label === 'string' ? item.label : ''
        });
      }
    }

    cleanedGroups.push({
      id: grpId,
      title: grpTitle,
      items: cleanedItems
    });
  }

  // أي قسم جديد أو مصرح به لم يظهر في التخطيط المحفوظ يُضاف تلقائياً.
  const missingSections = authorizedSections.filter((s) => !placedTabIds.has(s.id));
  if (missingSections.length > 0) {
    if (cleanedGroups.length === 0) {
      return buildDefaultCardsLayout(authorizedSections);
    }
    const targetGroup = cleanedGroups[cleanedGroups.length - 1];
    missingSections.forEach((sec) => {
      targetGroup.items.push({
        kind: 'card',
        id: `card-${sec.id}`,
        tabId: sec.id
      });
    });
  }

  return {
    version: 1,
    groups: cleanedGroups
  };
}
