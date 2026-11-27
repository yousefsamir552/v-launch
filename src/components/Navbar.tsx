import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  LayoutDashboard,
  Package,
  Palette,
  Scissors,
  Activity,
  Settings,
  LogOut,
  ChevronDown,
  Menu,
  X,
  Bell,
  AlertCircle,
  Clock,
  Calendar,
  CheckCircle2,
  MessageSquare,
  BarChart3,
  Factory,
  Calculator,
  Users,
  Boxes,
  Scale,
  Wallet,
  FileText,
  Layers,
  Sparkles,
  ShoppingCart,
  Search,
  Printer,
  Shirt,
  PackageOpen,
  Flame,
  PackageCheck,
  ClipboardCheck,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react';
import { InternalMessagingModal } from './InternalMessagingModal';
import { MyProfileModal } from './MyProfileModal';
import { SNOOZE_OPTIONS } from '../types';
import { computeAccessoryShortages } from '../utils/accessoryShortages';
import { useModalBackHandler } from '../utils/mobileBackNav';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentTab, setCurrentTab, onLogout }) => {
  const {
    currentUser,
    hasPermission,
    hasAssemblyPackagingAccess,
    canAccessSettings,
    canManageHR,
    canAccessHRSection,
    canAccessReadinessStage,
    globalSettings,
    appNotifications,
    unreadNotificationsCount,
    markNotificationRead,
    snoozeNotification,
    clearSnoozedNotifications,
    snoozedNotificationsCount,
    unreadMessagesCount,
    addFlashMessage,
    purchaseRequests,
    accessoryItems,
    suppliers,
    uiPreferences,
    setSidebarCollapsed
  } = useApp();

  const navMode = uiPreferences.nav_mode;
  const isCardsMode = navMode === 'cards';
  const sidebarCollapsed = uiPreferences.sidebar_collapsed;
  const accordionMode = uiPreferences.accordion_mode;

  const [productionOpen, setProductionOpen] = useState(true);
  const [warehousesOpen, setWarehousesOpen] = useState(false);
  const [productionControlOpen, setProductionControlOpen] = useState(false);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [hrOpen, setHrOpen] = useState(!accordionMode);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [messagesModalOpen, setMessagesModalOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [comingSoonModal, setComingSoonModal] = useState<string | null>(null);
  const [railTooltip, setRailTooltip] = useState<{ label: string; top: number } | null>(null);

  const showRailTooltip = (e: React.MouseEvent<HTMLElement>, label: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setRailTooltip({ label, top: rect.top + rect.height / 2 });
  };
  const hideRailTooltip = () => setRailTooltip(null);

  useModalBackHandler(mobileMenuOpen, () => setMobileMenuOpen(false));
  useModalBackHandler(notificationsOpen, () => setNotificationsOpen(false));
  useModalBackHandler(messagesModalOpen, () => setMessagesModalOpen(false));
  useModalBackHandler(Boolean(comingSoonModal), () => setComingSoonModal(null));

  const isSudo = currentUser?.username?.toLowerCase() === 'sudo' || currentUser?.is_sudo;
  const siteName = globalSettings?.site_name || 'نظام إدارة المصنع';
  const siteLogo = globalSettings?.logo || '🏭';
  const isImageLogo =
    siteLogo.startsWith('http://') ||
    siteLogo.startsWith('https://') ||
    siteLogo.startsWith('data:image/') ||
    siteLogo.startsWith('/');

  // Yellow/Amber Alert Dot count: pending manual purchase requests + low-stock accessory shortages
  const purchaseAlertCount = useMemo(() => {
    const pendingManual = (purchaseRequests || []).filter((r) => r.status === 'pending').length;
    const lowStockAccessories = computeAccessoryShortages(accessoryItems || [], suppliers || []).length;
    return pendingManual + lowStockAccessories;
  }, [purchaseRequests, accessoryItems, suppliers]);

  // Nested Group A: قسم المخازن (5 direct sub-items)
  const warehouseSubItems = [
    {
      id: 'warehouse',
      label: 'مخزن القماش',
      icon: Layers,
      color: 'text-blue-600',
      isVisible: hasPermission('fabric_warehouse')
    },
    {
      id: 'accessories_warehouse',
      label: 'مخزن الإكسسوارات',
      icon: Sparkles,
      color: 'text-pink-600',
      isVisible: hasPermission('accessories_warehouse')
    },
    {
      id: 'packaging_materials',
      label: 'مخزن خامات التشغيل والأمبالاج',
      icon: PackageOpen,
      color: 'text-orange-600',
      isVisible: hasAssemblyPackagingAccess()
    },
    {
      id: 'production_warehouse',
      label: 'مخزن الإنتاج التام',
      icon: Boxes,
      color: 'text-indigo-600',
      isVisible: hasPermission('production_warehouse')
    },
    {
      id: 'purchase_requests',
      label: 'طلبات الشراء',
      icon: ShoppingCart,
      color: 'text-amber-600',
      isVisible: hasPermission('purchase_requests'),
      alertCount: purchaseAlertCount
    }
  ].filter((item) => item.isVisible);

  // Nested Group B: متابعة الإنتاج (3 direct sub-items)
  const productionControlSubItems = [
    {
      id: 'qc',
      label: 'قسم الفرز',
      icon: Search,
      color: 'text-purple-600',
      isVisible: hasPermission('qc')
    },
    {
      id: 'printing',
      label: 'قسم الطباعة',
      icon: Printer,
      color: 'text-teal-600',
      isVisible: hasPermission('printing') || hasPermission('reports')
    },
    {
      id: 'sewing',
      label: 'قسم المكن',
      icon: Shirt,
      color: 'text-emerald-600',
      isVisible: hasPermission('sewing')
    }
  ].filter((item) => item.isVisible);

  // Nested Group C: جاهزية الموديلات (6 independent permission-gated stages)
  const readinessSubItems = [
    {
      id: 'readiness_print',
      label: 'المطابع',
      icon: Printer,
      color: 'text-teal-600',
      isVisible: canAccessReadinessStage('print')
    },
    {
      id: 'readiness_sewing',
      label: 'المكن',
      icon: Shirt,
      color: 'text-emerald-600',
      isVisible: canAccessReadinessStage('sewing')
    },
    {
      id: 'readiness_finishing',
      label: 'التشطيب',
      icon: Sparkles,
      color: 'text-purple-600',
      isVisible: canAccessReadinessStage('finishing')
    },
    {
      id: 'readiness_ironing',
      label: 'المكواة',
      icon: Flame,
      color: 'text-rose-600',
      isVisible: canAccessReadinessStage('ironing')
    },
    {
      id: 'readiness_packaging',
      label: 'التغليف',
      icon: Package,
      color: 'text-orange-600',
      isVisible: canAccessReadinessStage('packaging')
    },
    {
      id: 'readiness_dest',
      label: 'الدَست',
      icon: PackageCheck,
      color: 'text-indigo-600',
      isVisible: canAccessReadinessStage('dest')
    }
  ].filter((item) => item.isVisible);

  type ProductionNavEntry =
    | {
        kind: 'item';
        id: string;
        label: string;
        icon: any;
        color: string;
        isVisible: boolean;
      }
    | {
        kind: 'group';
        id: 'warehouses_group' | 'production_control_group' | 'readiness_group';
        label: string;
        icon: any;
        color: string;
        isVisible: boolean;
        alertCount?: number;
        children: Array<{
          id: string;
          label: string;
          icon: any;
          color: string;
          alertCount?: number;
        }>;
      };

  const productionNavEntries: ProductionNavEntry[] = (
    [
      {
        kind: 'item',
        id: 'dashboard',
        label: 'الرئيسية',
        icon: LayoutDashboard,
        color: 'text-slate-700',
        isVisible: true
      },
      {
        kind: 'group',
        id: 'warehouses_group',
        label: 'قسم المخازن',
        icon: Package,
        color: 'text-blue-600',
        isVisible: warehouseSubItems.length > 0,
        alertCount: purchaseAlertCount,
        children: warehouseSubItems
      },
      {
        kind: 'item',
        id: 'design',
        label: 'التصميم',
        icon: Palette,
        color: 'text-slate-800',
        isVisible: hasPermission('design')
      },
      {
        kind: 'item',
        id: 'cutting',
        label: 'القص',
        icon: Scissors,
        color: 'text-rose-600',
        isVisible: hasPermission('cutting')
      },
      {
        kind: 'group',
        id: 'production_control_group',
        label: 'متابعة الإنتاج',
        icon: Activity,
        color: 'text-indigo-600',
        isVisible: productionControlSubItems.length > 0,
        children: productionControlSubItems
      },
      {
        kind: 'item',
        id: 'assembly_packaging',
        label: 'الأسمبلي والأمبالاج',
        icon: Boxes,
        color: 'text-orange-600',
        isVisible: hasAssemblyPackagingAccess()
      },
      {
        kind: 'group',
        id: 'readiness_group',
        label: 'جاهزية الموديلات',
        icon: ClipboardCheck,
        color: 'text-emerald-600',
        isVisible: readinessSubItems.length > 0,
        children: readinessSubItems
      },
      {
        kind: 'item',
        id: 'unified_model_cards',
        label: 'بطاقة الموديل الشاملة',
        icon: FileText,
        color: 'text-violet-600',
        isVisible: hasPermission('models_tracking') || hasPermission('reports') || isSudo
      },
      {
        kind: 'item',
        id: 'reports',
        label: 'التقارير والإحصائيات',
        icon: BarChart3,
        color: 'text-amber-600',
        isVisible: hasPermission('reports') || isSudo
      }
    ] as ProductionNavEntry[]
  ).filter((entry) => entry.isVisible);

  // Accordion-aware group togglers
  const toggleProductionGroup = () => {
    setProductionOpen((prev) => {
      const next = !prev;
      if (next && accordionMode) {
        setHrOpen(false);
      }
      return next;
    });
  };

  const toggleHrGroup = () => {
    setHrOpen((prev) => {
      const next = !prev;
      if (next && accordionMode) {
        setProductionOpen(false);
        setWarehousesOpen(false);
        setProductionControlOpen(false);
        setReadinessOpen(false);
      }
      return next;
    });
  };

  const toggleNestedProductionGroup = (
    groupId: 'warehouses_group' | 'production_control_group' | 'readiness_group'
  ) => {
    if (groupId === 'warehouses_group') {
      setWarehousesOpen((prev) => {
        const next = !prev;
        if (next && accordionMode) {
          setProductionControlOpen(false);
          setReadinessOpen(false);
          setHrOpen(false);
        }
        return next;
      });
    } else if (groupId === 'production_control_group') {
      setProductionControlOpen((prev) => {
        const next = !prev;
        if (next && accordionMode) {
          setWarehousesOpen(false);
          setReadinessOpen(false);
          setHrOpen(false);
        }
        return next;
      });
    } else {
      setReadinessOpen((prev) => {
        const next = !prev;
        if (next && accordionMode) {
          setWarehousesOpen(false);
          setProductionControlOpen(false);
          setHrOpen(false);
        }
        return next;
      });
    }
  };

  // Auto-open the relevant nested sub-dropdown when navigating to one of its child tabs
  useEffect(() => {
    const isWarehouseTab =
      currentTab === 'warehouse' ||
      currentTab === 'accessories_warehouse' ||
      currentTab === 'packaging_materials' ||
      currentTab === 'production_warehouse' ||
      currentTab === 'purchase_requests';
    const isProdControlTab =
      currentTab === 'qc' ||
      currentTab === 'qc_details' ||
      currentTab === 'printing' ||
      currentTab === 'sewing' ||
      currentTab === 'production_control';
    const isReadinessTab = currentTab.startsWith('readiness_');
    const isHrTabCurrent = currentTab.startsWith('hr_');

    if (isWarehouseTab) {
      setProductionOpen(true);
      setWarehousesOpen(true);
      if (accordionMode) {
        setProductionControlOpen(false);
        setReadinessOpen(false);
        setHrOpen(false);
      }
    } else if (isProdControlTab) {
      setProductionOpen(true);
      setProductionControlOpen(true);
      if (accordionMode) {
        setWarehousesOpen(false);
        setReadinessOpen(false);
        setHrOpen(false);
      }
    } else if (isReadinessTab) {
      setProductionOpen(true);
      setReadinessOpen(true);
      if (accordionMode) {
        setWarehousesOpen(false);
        setProductionControlOpen(false);
        setHrOpen(false);
      }
    } else if (isHrTabCurrent) {
      setHrOpen(true);
      if (accordionMode) {
        setProductionOpen(false);
        setWarehousesOpen(false);
        setProductionControlOpen(false);
        setReadinessOpen(false);
      }
    }
  }, [currentTab, accordionMode]);

  // الموارد البشرية (HR) - 4 عناصر رئيسية فقط.
  // الصفحات المدمجة (موظفين + وظائف)، (حضور + قواعد)، (سلف + جزاءات) تُفتح كشاشة واحدة
  // بتبويبات داخلية تُفلتر هي نفسها حسب الصلاحيات السبعة الدقيقة داخل HRView.
  const hrSubItems = [
    {
      id: 'hr_employees',
      label: 'الموظفين والوظائف',
      icon: Users,
      color: 'text-purple-600',
      isVisible: canAccessHRSection('employees') || canAccessHRSection('jobs')
    },
    {
      id: 'hr_attendance',
      label: 'الحضور والانصراف',
      icon: Clock,
      color: 'text-purple-600',
      isVisible: canAccessHRSection('attendance') || canAccessHRSection('rules')
    },
    {
      id: 'hr_loans',
      label: 'السُلف والجزاءات',
      icon: Scale,
      color: 'text-purple-600',
      isVisible: canAccessHRSection('loans') || canAccessHRSection('penalties')
    },
    {
      id: 'hr_payroll',
      label: 'المرتبات',
      icon: Wallet,
      color: 'text-purple-600',
      isVisible: canAccessHRSection('payroll')
    },
    {
      id: 'hr_reports',
      label: 'تقارير الموارد البشرية',
      icon: BarChart3,
      color: 'text-purple-600',
      isVisible: canAccessHRSection('reports') || canAccessHRSection('payroll')
    }
  ].filter((item) => item.isVisible);

  const handleNavClick = (tabId: string) => {
    setCurrentTab(tabId);
    setMobileMenuOpen(false);
  };

  const handleComingSoon = (sectionName: string) => {
    const msg = 'قريباً - فضوا يوسف شوية وهو هيظبطه';
    setComingSoonModal(sectionName);
    addFlashMessage(msg, 'info');
  };

  const isTabActive = (itemId: string) => {
    if (currentTab === itemId) return true;
    if (
      itemId === 'design' &&
      (currentTab === 'design' || currentTab === 'model_details')
    ) {
      return true;
    }
    if (
      itemId === 'cutting' &&
      (currentTab === 'cutting' || currentTab === 'cutting_details')
    ) {
      return true;
    }
    if (itemId === 'qc' && (currentTab === 'qc' || currentTab === 'qc_details')) {
      return true;
    }
    if (
      itemId === 'settings' &&
      (currentTab === 'settings' || currentTab === 'logs')
    ) {
      return true;
    }
    return false;
  };

  const isAnyProductionActive = productionNavEntries.some((entry) =>
    entry.kind === 'group'
      ? entry.children.some((child) => isTabActive(child.id))
      : isTabActive(entry.id)
  );
  const isAnyHrActive = hrSubItems.some((item) => isTabActive(item.id));

  // Flattened authorized items for the Collapsed Slim Rail (sidebar mode)
  const slimRailSections = useMemo(() => {
    const groups: Array<{
      id: string;
      items: Array<{
        id: string;
        label: string;
        icon: any;
        color: string;
        alertCount?: number;
        accent?: 'blue' | 'purple' | 'slate';
      }>;
    }> = [];

    const mainItems: Array<{
      id: string;
      label: string;
      icon: any;
      color: string;
      alertCount?: number;
      accent?: 'blue' | 'purple' | 'slate';
    }> = [];

    productionNavEntries.forEach((entry) => {
      if (entry.kind === 'item') {
        mainItems.push({
          id: entry.id,
          label: entry.label,
          icon: entry.icon,
          color: entry.color,
          accent: 'blue'
        });
      } else {
        entry.children.forEach((child) => {
          mainItems.push({
            id: child.id,
            label:
              entry.id === 'readiness_group' ? `جاهزية: ${child.label}` : child.label,
            icon: child.icon,
            color: child.color,
            alertCount: child.alertCount,
            accent: 'blue'
          });
        });
      }
    });

    if (mainItems.length > 0) {
      groups.push({ id: 'prod', items: mainItems });
    }

    if (canManageHR() && hrSubItems.length > 0) {
      groups.push({
        id: 'hr',
        items: hrSubItems.map((it) => ({
          id: it.id,
          label: it.label,
          icon: it.icon,
          color: it.color,
          accent: 'purple'
        }))
      });
    }

    if (canAccessSettings()) {
      groups.push({
        id: 'settings',
        items: [
          {
            id: 'settings',
            label: 'الإعدادات',
            icon: Settings,
            color: 'text-slate-600',
            accent: 'slate'
          }
        ]
      });
    }

    return groups;
  }, [productionNavEntries, hrSubItems, canManageHR, canAccessSettings]);

  const userInitial = (currentUser?.real_name || currentUser?.username || 'U')
    .trim()
    .charAt(0)
    .toUpperCase();

  const isDesktopSlimRail = isCardsMode || sidebarCollapsed;

  return (
    <>
      {/* Mobile Top Sticky Header */}
      {isCardsMode ? (
        <header className="no-print lg:hidden sticky top-0 z-30 w-full bg-white/95 backdrop-blur-xs border-b border-slate-200/80 px-3 py-2 flex items-center justify-between gap-2 shadow-2xs">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => handleNavClick('nav_cards')}
              className="flex items-center gap-2 font-black text-sm text-slate-900 min-w-0 cursor-pointer"
              title={siteName}
            >
              {isImageLogo ? (
                <img
                  src={siteLogo}
                  alt={siteName}
                  className="w-8 h-8 rounded-full object-contain bg-white border border-slate-200 p-0.5 shrink-0"
                />
              ) : (
                <span className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-base shrink-0">
                  {siteLogo || '🏭'}
                </span>
              )}
              <span className="truncate max-w-[130px]">{siteName}</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => handleNavClick('nav_cards')}
              className={`p-2 rounded-xl border transition cursor-pointer ${
                currentTab === 'nav_cards'
                  ? 'bg-slate-900 border-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200/80'
              }`}
              title="صفحة كروت التنقل"
              aria-label="صفحة كروت التنقل"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => {
                setMessagesModalOpen(true);
                setNotificationsOpen(false);
              }}
              className={`relative p-2 rounded-full border transition cursor-pointer ${
                unreadMessagesCount > 0
                  ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                  : 'bg-slate-100 border-slate-200 text-slate-700'
              }`}
              title="الرسائل الداخلية"
            >
              <MessageSquare className="w-4 h-4" />
              {unreadMessagesCount > 0 && (
                <span className="absolute -top-1 -end-1 min-w-[16px] h-[16px] px-1 bg-indigo-600 text-white rounded-full text-[9px] font-black flex items-center justify-center">
                  {unreadMessagesCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setNotificationsOpen(!notificationsOpen)}
              className={`relative p-2 rounded-full border transition cursor-pointer ${
                unreadNotificationsCount > 0
                  ? 'bg-rose-50 border-rose-200 text-rose-700'
                  : 'bg-slate-100 border-slate-200 text-slate-700'
              }`}
              title="التنبيهات"
            >
              <Bell className="w-4 h-4" />
              {unreadNotificationsCount > 0 && (
                <span className="absolute -top-1 -end-1 min-w-[16px] h-[16px] px-1 bg-rose-600 text-white rounded-full text-[9px] font-black flex items-center justify-center animate-pulse">
                  {unreadNotificationsCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setProfileModalOpen(true)}
              className="rounded-full overflow-hidden border border-slate-200 shadow-2xs cursor-pointer shrink-0"
              title="حسابي الشخصي"
            >
              {currentUser?.avatar ? (
                <img
                  src={currentUser.avatar}
                  alt={currentUser?.real_name || 'avatar'}
                  className="w-8 h-8 object-cover bg-white"
                />
              ) : (
                <div className="w-8 h-8 bg-blue-600 text-white flex items-center justify-center text-xs font-black">
                  {userInitial}
                </div>
              )}
            </button>

            <button
              type="button"
              onClick={onLogout}
              className="p-2 rounded-full text-rose-600 hover:bg-rose-50 transition cursor-pointer"
              title="تسجيل الخروج"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>
      ) : (
        <header className="no-print lg:hidden sticky top-0 z-30 w-full bg-white/95 backdrop-blur-xs border-b border-slate-200/80 px-3 py-2.5 flex items-center justify-between gap-2 shadow-2xs">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-xl bg-slate-900 text-white shadow-xs cursor-pointer shrink-0"
              title="القائمة الجانبية"
              aria-label="القائمة الجانبية"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <button
              type="button"
              onClick={() => handleNavClick('dashboard')}
              className="flex items-center gap-2 font-black text-sm text-slate-900 min-w-0 cursor-pointer"
            >
              {isImageLogo ? (
                <img
                  src={siteLogo}
                  alt={siteName}
                  className="w-7 h-7 rounded-lg object-contain bg-white border border-slate-200 p-0.5 shrink-0"
                />
              ) : (
                <span className="text-lg shrink-0">{siteLogo || '🏭'}</span>
              )}
              <span className="truncate">{siteName}</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                setMessagesModalOpen(true);
                setNotificationsOpen(false);
              }}
              className={`relative p-2 rounded-full border transition cursor-pointer ${
                unreadMessagesCount > 0
                  ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                  : 'bg-slate-100 border-slate-200 text-slate-700'
              }`}
              title="المراسلات والمحادثات الداخلية"
            >
              <MessageSquare className="w-4 h-4" />
              {unreadMessagesCount > 0 && (
                <span className="absolute -top-1 -end-1 min-w-[16px] h-[16px] px-1 bg-indigo-600 text-white rounded-full text-[9px] font-black flex items-center justify-center">
                  {unreadMessagesCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setNotificationsOpen(!notificationsOpen)}
              className={`relative p-2 rounded-full border transition cursor-pointer ${
                unreadNotificationsCount > 0
                  ? 'bg-rose-50 border-rose-200 text-rose-700'
                  : 'bg-slate-100 border-slate-200 text-slate-700'
              }`}
              title="التنبيهات والإشعارات"
            >
              <Bell className="w-4 h-4" />
              {unreadNotificationsCount > 0 && (
                <span className="absolute -top-1 -end-1 min-w-[16px] h-[16px] px-1 bg-rose-600 text-white rounded-full text-[9px] font-black flex items-center justify-center animate-pulse">
                  {unreadNotificationsCount}
                </span>
              )}
            </button>
          </div>
        </header>
      )}

      {/* Mobile Backdrop (Sidebar Mode only) */}
      {!isCardsMode && mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          className="no-print lg:hidden fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-40"
        />
      )}

      {/* ===================================================================== */}
      {/* MODE 1: CARDS LAUNCHER SLIM RAIL (Desktop fixed vertical rail only)   */}
      {/* Order: Logo -> Profile Avatar -> Messages -> Notifications -> 4-Grid  */}
      {/*        ... Logout at bottom                                           */}
      {/* ===================================================================== */}
      {isCardsMode && (
        <aside className="no-print hidden lg:flex fixed top-0 left-0 bottom-0 z-40 w-[68px] bg-white border-r border-slate-200/80 shadow-xs flex-col items-center py-3.5 px-2 gap-3">
          {/* 1. Factory Logo */}
          <button
            type="button"
            onClick={() => handleNavClick('nav_cards')}
            onMouseEnter={(e) => showRailTooltip(e, `${siteName} — الرئيسية`)}
            onMouseLeave={hideRailTooltip}
            title={siteName}
            className="w-11 h-11 rounded-2xl bg-slate-50 border border-slate-200/90 hover:border-slate-400 flex items-center justify-center shadow-2xs transition hover:scale-105 cursor-pointer shrink-0 overflow-hidden"
          >
            {isImageLogo ? (
              <img src={siteLogo} alt={siteName} className="w-8 h-8 object-contain" />
            ) : (
              <span className="text-xl leading-none">{siteLogo || '🏭'}</span>
            )}
          </button>

          {/* 2. My Profile Avatar */}
          <button
            type="button"
            onClick={() => setProfileModalOpen(true)}
            onMouseEnter={(e) =>
              showRailTooltip(
                e,
                `حسابي الشخصي (${currentUser?.real_name || currentUser?.username || ''})`
              )
            }
            onMouseLeave={hideRailTooltip}
            title="حسابي الشخصي"
            className="w-10 h-10 rounded-full border-2 border-slate-200 hover:border-blue-500 overflow-hidden shadow-xs transition hover:scale-105 cursor-pointer shrink-0"
          >
            {currentUser?.avatar ? (
              <img
                src={currentUser.avatar}
                alt={currentUser?.real_name || 'avatar'}
                className="w-full h-full object-cover bg-white"
              />
            ) : (
              <div className="w-full h-full bg-blue-600 text-white flex items-center justify-center text-sm font-black">
                {userInitial}
              </div>
            )}
          </button>

          <div className="w-7 h-px bg-slate-200/80" />

          {/* 3. Internal Messages */}
          <button
            type="button"
            onClick={() => {
              setMessagesModalOpen(true);
              setNotificationsOpen(false);
            }}
            onMouseEnter={(e) => showRailTooltip(e, 'الرسائل الداخلية')}
            onMouseLeave={hideRailTooltip}
            title="الرسائل الداخلية"
            className={`relative w-10 h-10 rounded-2xl border flex items-center justify-center transition cursor-pointer shrink-0 ${
              unreadMessagesCount > 0
                ? 'bg-indigo-50 border-indigo-300 text-indigo-700 hover:bg-indigo-100'
                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            {unreadMessagesCount > 0 && (
              <span className="absolute -top-1 -end-1 min-w-[17px] h-[17px] px-1 bg-indigo-600 text-white rounded-full text-[9px] font-black flex items-center justify-center">
                {unreadMessagesCount}
              </span>
            )}
          </button>

          {/* 4. Notifications */}
          <button
            type="button"
            onClick={() => setNotificationsOpen((v) => !v)}
            onMouseEnter={(e) => showRailTooltip(e, 'التنبيهات والإشعارات')}
            onMouseLeave={hideRailTooltip}
            title="التنبيهات والإشعارات"
            className={`relative w-10 h-10 rounded-2xl border flex items-center justify-center transition cursor-pointer shrink-0 ${
              unreadNotificationsCount > 0
                ? 'bg-rose-50 border-rose-300 text-rose-700 hover:bg-rose-100'
                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Bell className="w-4 h-4" />
            {unreadNotificationsCount > 0 && (
              <span className="absolute -top-1 -end-1 min-w-[17px] h-[17px] px-1 bg-rose-600 text-white rounded-full text-[9px] font-black flex items-center justify-center animate-pulse">
                {unreadNotificationsCount}
              </span>
            )}
          </button>

          {/* 5. Four-Squares Launcher Button (LayoutGrid) */}
          <button
            type="button"
            onClick={() => handleNavClick('nav_cards')}
            onMouseEnter={(e) => showRailTooltip(e, 'صفحة كروت التنقل')}
            onMouseLeave={hideRailTooltip}
            title="صفحة كروت التنقل"
            className={`w-11 h-11 rounded-2xl flex items-center justify-center transition cursor-pointer shrink-0 ${
              currentTab === 'nav_cards'
                ? 'bg-slate-900 text-white shadow-md scale-105'
                : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-600 hover:text-white hover:border-blue-600'
            }`}
          >
            <LayoutGrid className="w-5 h-5" />
          </button>

          {/* 6. Logout at Bottom */}
          <div className="mt-auto pt-3 border-t border-slate-200/80 w-full flex justify-center">
            <button
              type="button"
              onClick={onLogout}
              onMouseEnter={(e) => showRailTooltip(e, 'تسجيل الخروج')}
              onMouseLeave={hideRailTooltip}
              title="تسجيل الخروج"
              className="w-10 h-10 rounded-2xl text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 flex items-center justify-center transition cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </aside>
      )}

      {/* ===================================================================== */}
      {/* MODE 2A: SIDEBAR COLLAPSED SLIM RAIL (Desktop lg: only when collapsed) */}
      {/* ===================================================================== */}
      {!isCardsMode && sidebarCollapsed && (
        <aside className="no-print hidden lg:flex fixed top-0 left-0 bottom-0 z-40 w-[68px] bg-white border-r border-slate-200/80 shadow-xs flex-col items-center py-3 px-2 gap-2.5">
          {/* Logo Bubble */}
          <button
            type="button"
            onClick={() => handleNavClick('dashboard')}
            onMouseEnter={(e) => showRailTooltip(e, siteName)}
            onMouseLeave={hideRailTooltip}
            title={siteName}
            className="w-10 h-10 rounded-full bg-slate-50 border border-slate-200 hover:border-slate-400 flex items-center justify-center shadow-2xs transition hover:scale-105 cursor-pointer shrink-0 overflow-hidden"
          >
            {isImageLogo ? (
              <img src={siteLogo} alt={siteName} className="w-7 h-7 object-contain" />
            ) : (
              <span className="text-lg leading-none">{siteLogo || '🏭'}</span>
            )}
          </button>

          {/* Profile Avatar Bubble */}
          <button
            type="button"
            onClick={() => setProfileModalOpen(true)}
            onMouseEnter={(e) =>
              showRailTooltip(
                e,
                `حسابي الشخصي (${currentUser?.real_name || currentUser?.username || ''})`
              )
            }
            onMouseLeave={hideRailTooltip}
            title="حسابي الشخصي"
            className="w-9 h-9 rounded-full border-2 border-slate-200 hover:border-blue-500 overflow-hidden shadow-2xs transition hover:scale-105 cursor-pointer shrink-0"
          >
            {currentUser?.avatar ? (
              <img
                src={currentUser.avatar}
                alt={currentUser?.real_name || 'avatar'}
                className="w-full h-full object-cover bg-white"
              />
            ) : (
              <div className="w-full h-full bg-blue-600 text-white flex items-center justify-center text-xs font-black">
                {userInitial}
              </div>
            )}
          </button>

          {/* Notifications + Messages */}
          <button
            type="button"
            onClick={() => setNotificationsOpen((v) => !v)}
            onMouseEnter={(e) => showRailTooltip(e, 'التنبيهات والإشعارات')}
            onMouseLeave={hideRailTooltip}
            title="التنبيهات والإشعارات"
            className={`relative w-9 h-9 rounded-xl border flex items-center justify-center transition cursor-pointer shrink-0 ${
              unreadNotificationsCount > 0
                ? 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
                : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Bell className="w-4 h-4" />
            {unreadNotificationsCount > 0 && (
              <span className="absolute -top-1 -end-1 min-w-[15px] h-[15px] px-0.5 bg-rose-600 text-white rounded-full text-[9px] font-black flex items-center justify-center animate-pulse">
                {unreadNotificationsCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setMessagesModalOpen(true);
              setNotificationsOpen(false);
            }}
            onMouseEnter={(e) => showRailTooltip(e, 'الرسائل الداخلية')}
            onMouseLeave={hideRailTooltip}
            title="الرسائل الداخلية"
            className={`relative w-9 h-9 rounded-xl border flex items-center justify-center transition cursor-pointer shrink-0 ${
              unreadMessagesCount > 0
                ? 'bg-indigo-50 border-indigo-300 text-indigo-700 hover:bg-indigo-100'
                : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            {unreadMessagesCount > 0 && (
              <span className="absolute -top-1 -end-1 min-w-[15px] h-[15px] px-0.5 bg-indigo-600 text-white rounded-full text-[9px] font-black flex items-center justify-center">
                {unreadMessagesCount}
              </span>
            )}
          </button>

          <div className="w-7 h-px bg-slate-200 shrink-0" />

          {/* Authorized Section Icons */}
          <div className="flex-1 w-full overflow-y-auto overflow-x-hidden flex flex-col items-center gap-1.5 py-0.5">
            {slimRailSections.map((group, gIdx) => (
              <React.Fragment key={group.id}>
                {gIdx > 0 && <div className="w-6 h-px bg-slate-200/80 my-1 shrink-0" />}
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isTabActive(item.id);
                  const activeClass =
                    item.accent === 'purple'
                      ? 'bg-purple-600 text-white shadow-xs'
                      : item.accent === 'slate'
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-blue-600 text-white shadow-xs';
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleNavClick(item.id)}
                      onMouseEnter={(e) => showRailTooltip(e, item.label)}
                      onMouseLeave={hideRailTooltip}
                      title={item.label}
                      className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition cursor-pointer shrink-0 ${
                        active
                          ? activeClass
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      <Icon className={`w-4 h-4 ${active ? 'text-white' : item.color}`} />
                      {(item.alertCount || 0) > 0 && (
                        <span className="absolute -top-0.5 -end-0.5 w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-white" />
                      )}
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>

          {/* Expand Sidebar + Logout */}
          <div className="pt-2 border-t border-slate-200/80 w-full flex flex-col items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                hideRailTooltip();
                setSidebarCollapsed(false);
              }}
              onMouseEnter={(e) => showRailTooltip(e, 'فتح الشريط الجانبي')}
              onMouseLeave={hideRailTooltip}
              title="فتح الشريط الجانبي"
              className="w-10 h-10 rounded-xl bg-slate-900 hover:bg-slate-800 text-white flex items-center justify-center shadow-xs transition cursor-pointer"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onLogout}
              onMouseEnter={(e) => showRailTooltip(e, 'تسجيل الخروج')}
              onMouseLeave={hideRailTooltip}
              title="تسجيل الخروج"
              className="w-9 h-9 rounded-xl text-rose-600 hover:bg-rose-50 flex items-center justify-center transition cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </aside>
      )}

      {/* ===================================================================== */}
      {/* MODE 2B: EXPANDED SIDEBAR (Desktop when not collapsed + Mobile drawer)*/}
      {/* ===================================================================== */}
      {!isCardsMode && (
        <aside
          className={`no-print fixed top-0 left-0 bottom-0 z-50 lg:z-40 w-[82vw] max-w-72 lg:w-72 bg-white border-r border-slate-200/80 shadow-xl lg:shadow-xs flex flex-col justify-between transition-transform duration-200 ${
            sidebarCollapsed ? 'lg:hidden' : ''
          } ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
        >
        {/* 1. Top Section: User Name & Quick Actions */}
        <div className="p-4 border-b border-slate-200/80 space-y-3">
          {/* Brand Header */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => handleNavClick('dashboard')}
              className="flex items-center gap-2 font-black text-sm text-slate-900 hover:opacity-90 transition cursor-pointer"
            >
              {isImageLogo ? (
                <img
                  src={siteLogo}
                  alt={siteName}
                  className="w-7 h-7 rounded-lg object-contain bg-white border border-slate-200 p-0.5"
                />
              ) : (
                <span className="text-xl">{siteLogo || '🏭'}</span>
              )}
              <span className="truncate max-w-[140px]">{siteName}</span>
            </button>

            <div className="flex items-center gap-1.5">
              {/* Internal Messaging Icon Button */}
              <button
                type="button"
                onClick={() => {
                  setMessagesModalOpen(true);
                  setNotificationsOpen(false);
                }}
                className={`relative p-2 rounded-full border transition cursor-pointer ${
                  unreadMessagesCount > 0
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700 hover:bg-indigo-100 shadow-xs'
                    : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200/80'
                }`}
                title="المراسلات والمحادثات الداخلية"
              >
                <MessageSquare className="w-4 h-4" />
                {unreadMessagesCount > 0 && (
                  <span className="absolute -top-1 -end-1 min-w-[16px] h-[16px] px-1 bg-indigo-600 text-white rounded-full text-[9px] font-black flex items-center justify-center">
                    {unreadMessagesCount}
                  </span>
                )}
              </button>

              {/* Notifications Button */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNotificationsOpen(!notificationsOpen)}
                  className={`relative p-2 rounded-full border transition cursor-pointer ${
                    unreadNotificationsCount > 0
                      ? 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
                      : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200/80'
                  }`}
                  title="التنبيهات والإشعارات"
                >
                  <Bell className="w-4 h-4" />
                  {unreadNotificationsCount > 0 && (
                    <span className="absolute -top-1 -end-1 min-w-[16px] h-[16px] px-1 bg-rose-600 text-white rounded-full text-[9px] font-black flex items-center justify-center animate-pulse">
                      {unreadNotificationsCount}
                    </span>
                  )}
                </button>
              </div>

              {/* Desktop Collapse Sidebar Button */}
              <button
                type="button"
                onClick={() => setSidebarCollapsed(true)}
                className="hidden lg:flex p-2 rounded-full border bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-900 hover:text-white hover:border-slate-900 transition cursor-pointer"
                title="طي الشريط الجانبي"
                aria-label="طي الشريط الجانبي"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* User Profile Card at Top */}
          <div className="flex items-center justify-between gap-2 p-2 rounded-2xl bg-slate-50 border border-slate-200/80">
            <button
              type="button"
              onClick={() => {
                setProfileModalOpen(true);
                setMobileMenuOpen(false);
              }}
              title="حسابي الشخصي — تعديل الصورة والبيانات وكلمة المرور"
              className="flex items-center gap-2.5 min-w-0 flex-1 p-1 rounded-xl hover:bg-slate-200/60 transition cursor-pointer text-start"
            >
              {currentUser?.avatar ? (
                <img
                  src={currentUser.avatar}
                  alt={currentUser?.real_name || currentUser?.username || 'avatar'}
                  className="w-9 h-9 rounded-full object-cover border border-slate-200 shrink-0 shadow-xs bg-white"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-black shrink-0 shadow-xs">
                  {currentUser?.real_name ? currentUser.real_name[0] : 'U'}
                </div>
              )}
              <div className="flex flex-col min-w-0 text-start">
                <span className="text-xs font-black text-slate-900 truncate">
                  {currentUser?.real_name || currentUser?.username}
                </span>
                <span className="text-[10px] text-slate-500 truncate">
                  {isSudo ? 'مدير النظام' : currentUser?.role || 'موظف تشغيل'}
                </span>
              </div>
            </button>
            <button
              onClick={onLogout}
              title="تسجيل الخروج"
              className="p-2 rounded-xl text-rose-600 hover:bg-rose-50 transition cursor-pointer shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Middle Navigation Items */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {/* 2. Production Button (Accordion / Dropdown) */}
          <div className="space-y-1">
            <button
              type="button"
              onClick={toggleProductionGroup}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-black transition cursor-pointer ${
                isAnyProductionActive
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100/80 text-slate-800 hover:bg-slate-200/70'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Factory className={`w-4 h-4 ${isAnyProductionActive ? 'text-white' : 'text-blue-600'}`} />
                <span>التصنيع</span>
              </div>
              <ChevronDown
                className={`w-4 h-4 transition-transform duration-200 ${
                  productionOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {productionOpen && (
              <div className="pr-3 pl-1 py-1 space-y-1 border-r-2 border-slate-200 mr-3">
                {productionNavEntries.map((entry) => {
                  if (entry.kind === 'group') {
                    const GroupIcon = entry.icon;
                    const isGroupOpen =
                      entry.id === 'warehouses_group'
                        ? warehousesOpen
                        : entry.id === 'production_control_group'
                        ? productionControlOpen
                        : readinessOpen;
                    const toggleGroup = () => toggleNestedProductionGroup(entry.id);
                    const isGroupActive = entry.children.some((c) => isTabActive(c.id));
                    const groupAlertCount = entry.alertCount || 0;

                    return (
                      <div key={entry.id} className="space-y-1">
                        <button
                          type="button"
                          onClick={toggleGroup}
                          aria-expanded={isGroupOpen}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs font-extrabold transition cursor-pointer text-start ${
                            isGroupActive
                              ? 'bg-slate-100 text-slate-900 ring-1 ring-slate-200'
                              : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <span className="flex items-center gap-2.5 min-w-0">
                            <GroupIcon className={`w-4 h-4 shrink-0 ${entry.color}`} />
                            <span className="truncate">{entry.label}</span>
                            {groupAlertCount > 0 && (
                              <span
                                className="inline-flex items-center gap-1 shrink-0"
                                title={`يوجد ${groupAlertCount} طلب شراء أو نقص إكسسوارات`}
                              >
                                <span className="relative flex h-2.5 w-2.5">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500 ring-2 ring-amber-200" />
                                </span>
                                <span className="px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-mono font-black leading-tight">
                                  {groupAlertCount}
                                </span>
                              </span>
                            )}
                          </span>
                          <ChevronDown
                            className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-200 ${
                              isGroupOpen ? 'rotate-180' : ''
                            }`}
                          />
                        </button>

                        {isGroupOpen && (
                          <div className="pr-3 pl-0.5 py-0.5 space-y-0.5 border-r-2 border-slate-200/80 mr-3">
                            {entry.children.map((child) => {
                              const ChildIcon = child.icon;
                              const isChildActive = isTabActive(child.id);
                              const childAlerts = child.alertCount || 0;
                              return (
                                <button
                                  key={child.id}
                                  type="button"
                                  onClick={() => handleNavClick(child.id)}
                                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl text-[11.5px] font-bold transition cursor-pointer text-start ${
                                    isChildActive
                                      ? 'bg-blue-600 text-white shadow-xs'
                                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                                  }`}
                                >
                                  <span className="flex items-center gap-2 min-w-0">
                                    <ChildIcon
                                      className={`w-3.5 h-3.5 shrink-0 ${
                                        isChildActive ? 'text-white' : child.color
                                      }`}
                                    />
                                    <span className="truncate">{child.label}</span>
                                  </span>
                                  {childAlerts > 0 && (
                                    <span
                                      className="inline-flex items-center gap-1 shrink-0"
                                      title={`يوجد ${childAlerts} صنف مطلوب للشراء`}
                                    >
                                      <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-300 opacity-80" />
                                        <span
                                          className={`relative inline-flex rounded-full h-2 w-2 ${
                                            isChildActive ? 'bg-amber-300' : 'bg-amber-500'
                                          }`}
                                        />
                                      </span>
                                      <span
                                        className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-black leading-tight ${
                                          isChildActive
                                            ? 'bg-amber-400 text-slate-950'
                                            : 'bg-amber-100 text-amber-900 border border-amber-300'
                                        }`}
                                      >
                                        {childAlerts}
                                      </span>
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  }

                  const Icon = entry.icon;
                  const isActive = isTabActive(entry.id);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => handleNavClick(entry.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer text-start ${
                        isActive
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : entry.color}`} />
                      <span className="truncate">{entry.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3. Accounting Button */}
          <button
            type="button"
            onClick={() => handleComingSoon('الحسابات')}
            className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-black text-slate-700 hover:bg-slate-100 transition cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <Calculator className="w-4 h-4 text-emerald-600" />
              <span>الحسابات</span>
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              قريباً
            </span>
          </button>

          {/* 4. HR Dropdown (الموارد البشرية) - gated by can_manage_hr permission */}
          {canManageHR() && (
          <div className="space-y-1">
            <button
              type="button"
              onClick={toggleHrGroup}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-black transition cursor-pointer ${
                isAnyHrActive
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Users className={`w-4 h-4 ${isAnyHrActive ? 'text-white' : 'text-purple-600'}`} />
                <span>الموارد البشرية (HR)</span>
              </div>
              <ChevronDown
                className={`w-4 h-4 transition-transform duration-200 ${hrOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {hrOpen && (
              <div className="pr-3 pl-1 py-1 space-y-1 border-r-2 border-slate-200 mr-3">
                {hrSubItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = isTabActive(item.id);
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleNavClick(item.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer text-start ${
                        isActive
                          ? 'bg-purple-600 text-white shadow-xs'
                          : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : item.color}`} />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          )}
        </div>

        {/* 5. Bottom Section: Settings Button */}
        {canAccessSettings() && (
          <div className="p-3 border-t border-slate-200/80 bg-slate-50/50">
            <button
              type="button"
              onClick={() => handleNavClick('settings')}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-black transition cursor-pointer ${
                isTabActive('settings')
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-700 hover:bg-slate-200/70'
              }`}
            >
              <Settings className={`w-4 h-4 ${isTabActive('settings') ? 'text-white' : 'text-slate-600'}`} />
              <span>الإعدادات</span>
            </button>
          </div>
        )}
        </aside>
      )}

      {/* Floating Tooltip for Desktop Slim Rail (never clipped by overflow-y-auto) */}
      {railTooltip && isDesktopSlimRail && (
        <div
          style={{ top: railTooltip.top }}
          className="no-print hidden lg:flex fixed left-[76px] -translate-y-1/2 z-[60] pointer-events-none px-3 py-1.5 rounded-xl bg-slate-900 text-white text-[11px] font-bold shadow-lg whitespace-nowrap animate-in fade-in duration-100"
        >
          {railTooltip.label}
        </div>
      )}

      {/* Notifications Popover (rendered outside <aside> so it never clips when mobile drawer is closed) */}
      {notificationsOpen && (
        <>
          <div
            onClick={() => setNotificationsOpen(false)}
            className="no-print fixed inset-0 z-40"
          />
          <div
            className={`no-print fixed inset-x-3 sm:inset-x-auto ${
              isDesktopSlimRail ? 'sm:left-20' : 'sm:left-4'
            } top-16 sm:w-96 max-w-[calc(100vw-1.5rem)] max-h-[80vh] flex flex-col bg-white rounded-3xl shadow-2xl border border-slate-200 py-3 z-50 animate-in fade-in zoom-in-95 duration-150`}
          >
            <div className="px-4 pb-2 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <Bell className="w-4 h-4 text-rose-600 shrink-0" />
                <h4 className="font-black text-xs text-slate-900 truncate">
                  إشعارات المواعيد وخامات التشغيل
                </h4>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  {appNotifications.length} إشعار
                </span>
                <button
                  type="button"
                  onClick={clearSnoozedNotifications}
                  title="استعادة كل التنبيهات المؤجلة"
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition cursor-pointer"
                >
                  ↺ استعادة ({snoozedNotificationsCount})
                </button>
              </div>
            </div>

            <div className="overflow-y-auto divide-y divide-slate-100 p-2 space-y-1 flex-1">
              {appNotifications.length > 0 ? (
                appNotifications.map((notif) => {
                  const isCritical = notif.urgency === 'critical';
                  const isOverdue = notif.urgency === 'overdue';
                  const isToday = notif.urgency === 'today';

                  return (
                    <div
                      key={notif.id}
                      onClick={() => {
                        markNotificationRead(notif.id);
                        const assemblyStages = ['finishing', 'ironing', 'packaging', 'dest'];
                        if (notif.kind === 'material' || notif.stage === 'materials') {
                          setCurrentTab('packaging_materials');
                        } else if (assemblyStages.includes(notif.stage)) {
                          setCurrentTab('assembly_packaging');
                        } else if (notif.stage === 'sewing') {
                          setCurrentTab('sewing');
                        } else if (notif.stage === 'printing') {
                          setCurrentTab('printing');
                        } else {
                          setCurrentTab('qc');
                        }
                        setNotificationsOpen(false);
                        setMobileMenuOpen(false);
                      }}
                      className={`p-3 rounded-2xl transition cursor-pointer text-xs flex flex-col gap-1 border ${
                        isCritical
                          ? 'bg-purple-50/80 border-purple-300 text-purple-950 hover:bg-purple-100'
                          : isOverdue
                          ? 'bg-rose-50/80 border-rose-300 text-rose-950 hover:bg-rose-100'
                          : isToday
                          ? 'bg-amber-50/80 border-amber-300 text-amber-950 hover:bg-amber-100'
                          : 'bg-blue-50/60 border-blue-200 text-blue-950 hover:bg-blue-100'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 flex-wrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-black text-[10px] ${
                            isCritical
                              ? 'bg-purple-700 text-white animate-pulse'
                              : isOverdue
                              ? 'bg-rose-600 text-white animate-pulse'
                              : isToday
                              ? 'bg-amber-500 text-slate-900'
                              : 'bg-blue-600 text-white'
                          }`}
                        >
                          {isCritical && <AlertCircle className="w-3 h-3" />}
                          {isOverdue && <AlertCircle className="w-3 h-3" />}
                          {isToday && <Clock className="w-3 h-3" />}
                          {!isCritical && !isOverdue && !isToday && (
                            <Calendar className="w-3 h-3" />
                          )}
                          <span>{notif.title}</span>
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {notif.kind === 'material'
                            ? `خامة: ${notif.model_code}`
                            : `موديل ${notif.model_code}`}
                        </span>
                      </div>
                      <p className="font-bold text-slate-800 text-[11px] leading-relaxed">
                        {notif.message}
                      </p>
                      <div className="flex items-center justify-between gap-1 flex-wrap text-[10px] text-slate-500 pt-1">
                        <span>
                          {notif.kind === 'material'
                            ? `المورد: ${notif.source_name}`
                            : `الموقع: ${notif.source_name}`}
                        </span>
                        <span className="font-mono font-bold">
                          {notif.kind === 'material'
                            ? `آخر تحديث: ${notif.expected_date}`
                            : `تاريخ الاستلام: ${notif.expected_date}`}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1 pt-1.5 mt-1 border-t border-white/70">
                        <span className="text-[9px] font-black text-slate-500">تأجيل مؤقت:</span>
                        {SNOOZE_OPTIONS.map((opt) => (
                          <button
                            key={opt.hours}
                            type="button"
                            title={`إخفاء التنبيه لمدة ${opt.label}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              snoozeNotification(notif.id, opt.hours);
                            }}
                            className="px-1.5 py-0.5 rounded-md bg-white/90 border border-slate-200 text-[9px] font-bold text-slate-700 hover:bg-slate-900 hover:text-white transition cursor-pointer"
                          >
                            ⏰ {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="py-8 text-center text-slate-400">
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-1 text-emerald-500" />
                  <p className="font-bold text-xs text-slate-700">لا توجد تنبيهات متأخرة أو عاجلة حالياً</p>
                  {snoozedNotificationsCount > 0 && (
                    <p className="mt-1 text-[10px] font-bold text-amber-600">
                      {snoozedNotificationsCount} تنبيه مؤجل — اضغط «↺ استعادة» لإظهاره.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Coming Soon Modal for Accounting & HR */}
      {comingSoonModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-3 sm:p-4"
          onClick={() => setComingSoonModal(null)}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-[95vw] sm:w-full max-w-sm max-h-[90vh] overflow-y-auto p-5 sm:p-6 text-center space-y-4 animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto text-2xl">
              ⏳
            </div>
            <h3 className="font-black text-base text-slate-900">قسم {comingSoonModal}</h3>
            <p className="text-sm font-bold text-slate-700 leading-relaxed">
              قريباً - فضوا يوسف شوية وهو هيظبطه
            </p>
            <button
              type="button"
              onClick={() => setComingSoonModal(null)}
              className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-xs font-black hover:bg-slate-800 transition cursor-pointer"
            >
              حسناً
            </button>
          </div>
        </div>
      )}

      <InternalMessagingModal
        isOpen={messagesModalOpen}
        onClose={() => setMessagesModalOpen(false)}
      />

      <MyProfileModal
        isOpen={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
      />
    </>
  );
};