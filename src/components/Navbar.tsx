import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  LayoutDashboard,
  Package,
  Palette,
  Scissors,
  Activity,
  GitCommit,
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
  Users
} from 'lucide-react';
import { InternalMessagingModal } from './InternalMessagingModal';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentTab, setCurrentTab, onLogout }) => {
  const { 
    currentUser, 
    hasPermission,
    canAccessSettings,
    globalSettings,
    appNotifications, 
    unreadNotificationsCount, 
    markNotificationRead,
    unreadMessagesCount,
    addFlashMessage
  } = useApp();
  const [productionOpen, setProductionOpen] = useState(true);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [messagesModalOpen, setMessagesModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [comingSoonModal, setComingSoonModal] = useState<string | null>(null);

  const isSudo = currentUser?.username?.toLowerCase() === 'sudo' || currentUser?.is_sudo;
  const siteName = globalSettings?.site_name || 'نظام إدارة المصنع';
  const siteLogo = globalSettings?.logo || '🏭';
  const isImageLogo =
    siteLogo.startsWith('http://') ||
    siteLogo.startsWith('https://') ||
    siteLogo.startsWith('data:image/') ||
    siteLogo.startsWith('/');

  const productionSubItems = [
    { 
      id: 'dashboard', 
      label: 'الرئيسية', 
      icon: LayoutDashboard, 
      color: 'text-slate-700', 
      isVisible: true 
    },
    {
      id: 'warehouse',
      label: 'قسم المخازن',
      icon: Package,
      color: 'text-blue-600',
      isVisible:
        hasPermission('fabric_warehouse') ||
        hasPermission('accessories_warehouse') ||
        hasPermission('production_warehouse')
    },
    {
      id: 'design',
      label: 'التصميم',
      icon: Palette,
      color: 'text-slate-800',
      isVisible: hasPermission('design')
    },
    {
      id: 'cutting',
      label: 'القص',
      icon: Scissors,
      color: 'text-rose-600',
      isVisible: hasPermission('cutting')
    },
    {
      id: 'production_control',
      label: 'الـ production control (مطابع، مكن)',
      icon: Activity,
      color: 'text-indigo-600',
      isVisible:
        hasPermission('printing') ||
        hasPermission('qc') ||
        hasPermission('sewing') ||
        hasPermission('reports')
    },
    {
      id: 'models_tracking',
      label: 'حركة الموديلات',
      icon: GitCommit,
      color: 'text-cyan-600',
      isVisible: hasPermission('models_tracking') || isSudo
    },
    {
      id: 'reports',
      label: 'التقارير والإحصائيات',
      icon: BarChart3,
      color: 'text-amber-600',
      isVisible: hasPermission('reports') || isSudo
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
      itemId === 'warehouse' &&
      (currentTab === 'warehouse' ||
        currentTab === 'accessories_warehouse' ||
        currentTab === 'production_warehouse')
    ) {
      return true;
    }
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
    if (
      itemId === 'production_control' &&
      (currentTab === 'production_control' ||
        currentTab === 'printing' ||
        currentTab === 'assembly' ||
        currentTab === 'qc' ||
        currentTab === 'qc_details' ||
        currentTab === 'sewing')
    ) {
      return true;
    }
    if (itemId === 'models_tracking' && currentTab === 'models_tracking') {
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

  const isAnyProductionActive = productionSubItems.some((item) => isTabActive(item.id));

  return (
    <>
      {/* Mobile Toggle Button (visible on small screens) */}
      <button
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        className="no-print lg:hidden fixed top-4 left-4 z-50 p-2.5 rounded-xl bg-slate-900 text-white shadow-lg cursor-pointer"
        title="القائمة الجانبية"
      >
        {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Mobile Backdrop */}
      {mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          className="no-print lg:hidden fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-40"
        />
      )}

      {/* Left Sidebar */}
      <aside
        className={`no-print fixed top-0 left-0 bottom-0 z-40 w-72 bg-white border-r border-slate-200/80 shadow-xl lg:shadow-xs flex flex-col justify-between transition-transform duration-200 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
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
                  title="تنبيهات مواعيد الاستلام"
                >
                  <Bell className="w-4 h-4" />
                  {unreadNotificationsCount > 0 && (
                    <span className="absolute -top-1 -end-1 min-w-[16px] h-[16px] px-1 bg-rose-600 text-white rounded-full text-[9px] font-black flex items-center justify-center animate-pulse">
                      {unreadNotificationsCount}
                    </span>
                  )}
                </button>

                {notificationsOpen && (
                  <div className="fixed left-4 top-16 w-80 sm:w-96 bg-white rounded-3xl shadow-2xl border border-slate-200 py-3 z-50 animate-in fade-in zoom-in-95 duration-150">
                    <div className="px-4 pb-2 border-b border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Bell className="w-4 h-4 text-rose-600" />
                        <h4 className="font-black text-xs text-slate-900">
                          إشعارات مواعيد الاستلام والمتابعة
                        </h4>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                        {appNotifications.length} إشعار
                      </span>
                    </div>

                    <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 p-2 space-y-1">
                      {appNotifications.length > 0 ? (
                        appNotifications.map((notif) => {
                          const isOverdue = notif.urgency === 'overdue';
                          const isToday = notif.urgency === 'today';

                          return (
                            <div
                              key={notif.id}
                              onClick={() => {
                                markNotificationRead(notif.id);
                                setCurrentTab('production_control');
                                setNotificationsOpen(false);
                              }}
                              className={`p-3 rounded-2xl transition cursor-pointer text-xs flex flex-col gap-1 border ${
                                isOverdue
                                  ? 'bg-rose-50/80 border-rose-300 text-rose-950 hover:bg-rose-100'
                                  : isToday
                                  ? 'bg-amber-50/80 border-amber-300 text-amber-950 hover:bg-amber-100'
                                  : 'bg-blue-50/60 border-blue-200 text-blue-950 hover:bg-blue-100'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-black text-[10px] ${
                                    isOverdue
                                      ? 'bg-rose-600 text-white animate-pulse'
                                      : isToday
                                      ? 'bg-amber-500 text-slate-900'
                                      : 'bg-blue-600 text-white'
                                  }`}
                                >
                                  {isOverdue && <AlertCircle className="w-3 h-3" />}
                                  {isToday && <Clock className="w-3 h-3" />}
                                  {!isOverdue && !isToday && <Calendar className="w-3 h-3" />}
                                  <span>{notif.title}</span>
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono">
                                  موديل {notif.model_code}
                                </span>
                              </div>
                              <p className="font-bold text-slate-800 text-[11px] leading-relaxed">
                                {notif.message}
                              </p>
                              <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1">
                                <span>الموقع: {notif.source_name}</span>
                                <span className="font-mono font-bold">تاريخ الاستلام: {notif.expected_date}</span>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="py-8 text-center text-slate-400">
                          <CheckCircle2 className="w-8 h-8 mx-auto mb-1 text-emerald-500" />
                          <p className="font-bold text-xs text-slate-700">لا توجد تنبيهات متأخرة أو عاجلة حالياً</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* User Profile Card at Top */}
          <div className="flex items-center justify-between gap-2 p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-black shrink-0 shadow-xs">
                {currentUser?.real_name ? currentUser.real_name[0] : 'U'}
              </div>
              <div className="flex flex-col min-w-0 text-start">
                <span className="text-xs font-black text-slate-900 truncate">
                  {currentUser?.real_name || currentUser?.username}
                </span>
                <span className="text-[10px] text-slate-500 truncate">
                  {isSudo ? 'حساب طوارئ مطلق' : currentUser?.role || 'موظف تشغيل'}
                </span>
              </div>
            </div>
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
              onClick={() => setProductionOpen(!productionOpen)}
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
                {productionSubItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = isTabActive(item.id);
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleNavClick(item.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer text-start ${
                        isActive
                          ? 'bg-blue-600 text-white shadow-xs'
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

          {/* 4. HR Button */}
          <button
            type="button"
            onClick={() => handleComingSoon('شؤون الموظفين')}
            className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-black text-slate-700 hover:bg-slate-100 transition cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <Users className="w-4 h-4 text-purple-600" />
              <span>شؤون الموظفين</span>
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              قريباً
            </span>
          </button>
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

      {/* Coming Soon Modal for Accounting & HR */}
      {comingSoonModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          onClick={() => setComingSoonModal(null)}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-sm w-full p-6 text-center space-y-4 animate-in fade-in zoom-in-95 duration-150"
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
    </>
  );
};