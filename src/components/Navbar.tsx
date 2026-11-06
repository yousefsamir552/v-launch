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
  BarChart3
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
    unreadMessagesCount
  } = useApp();
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [messagesModalOpen, setMessagesModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isSudo = currentUser?.username?.toLowerCase() === 'sudo' || currentUser?.is_sudo;
  const siteName = globalSettings?.site_name || 'نظام إدارة المصنع';
  const siteLogo = globalSettings?.logo || '🏭';
  const isImageLogo =
    siteLogo.startsWith('http://') ||
    siteLogo.startsWith('https://') ||
    siteLogo.startsWith('data:image/') ||
    siteLogo.startsWith('/');

  const allNavItems = [
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
    },
    {
      id: 'settings',
      label: 'الإعدادات',
      icon: Settings,
      color: 'text-slate-600',
      isVisible: canAccessSettings()
    }
  ];

  const navItems = allNavItems.filter((item) => item.isVisible);

  const handleNavClick = (tabId: string) => {
    setCurrentTab(tabId);
    setMobileMenuOpen(false);
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

  return (
    <>
      <nav className="no-print bg-white/95 backdrop-blur-md sticky top-0 z-40 border-b border-slate-200/80 shadow-xs">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6">
          <div className="flex items-center justify-between h-16">
            {/* Dynamic Logo & Brand Name (Task 3) */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleNavClick('dashboard')}
                className="flex items-center gap-2.5 font-black text-lg text-slate-900 hover:opacity-90 transition group shrink-0 cursor-pointer"
              >
                {isImageLogo ? (
                  <img
                    src={siteLogo}
                    alt={siteName}
                    className="w-9 h-9 rounded-xl object-contain bg-white border border-slate-200 p-0.5 shadow-2xs group-hover:scale-105 transition-transform"
                  />
                ) : (
                  <span className="text-2xl group-hover:scale-110 transition-transform">
                    {siteLogo || '🏭'}
                  </span>
                )}
                <span className="tracking-tight hidden sm:inline">{siteName}</span>
                <span className="sm:hidden font-black text-sm truncate max-w-[120px]">{siteName}</span>
              </button>
            </div>

            {/* Desktop Nav Links */}
            <div className="hidden lg:flex items-center gap-1.5 overflow-x-auto py-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = isTabActive(item.id);

                return (
                  <button
                    key={item.id}
                    onClick={() => handleNavClick(item.id)}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-bold transition-all duration-150 whitespace-nowrap cursor-pointer ${
                      isActive
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'text-slate-700 hover:bg-slate-100/90'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isActive ? 'text-white' : item.color}`} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Notifications & User Profile */}
            <div className="flex items-center gap-2">
              {/* Internal Messaging Icon Button */}
              <button
                type="button"
                onClick={() => {
                  setMessagesModalOpen(true);
                  setNotificationsOpen(false);
                  setUserDropdownOpen(false);
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
                  <span className="absolute -top-1 -end-1 min-w-[18px] h-[18px] px-1 bg-indigo-600 text-white rounded-full text-[10px] font-black flex items-center justify-center shadow-xs">
                    {unreadMessagesCount}
                  </span>
                )}
              </button>

              {/* Notifications Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setNotificationsOpen(!notificationsOpen);
                    setUserDropdownOpen(false);
                  }}
                  className={`relative p-2 rounded-full border transition cursor-pointer ${
                    unreadNotificationsCount > 0
                      ? 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
                      : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200/80'
                  }`}
                  title="تنبيهات مواعيد الاستلام"
                >
                  <Bell className="w-4 h-4" />
                  {unreadNotificationsCount > 0 && (
                    <span className="absolute -top-1 -end-1 min-w-[18px] h-[18px] px-1 bg-rose-600 text-white rounded-full text-[10px] font-black flex items-center justify-center animate-pulse shadow-xs">
                      {unreadNotificationsCount}
                    </span>
                  )}
                </button>

                {notificationsOpen && (
                  <div className="absolute start-0 sm:start-auto sm:end-0 mt-2 w-80 sm:w-96 bg-white rounded-3xl shadow-2xl border border-slate-200 py-3 z-50 animate-in fade-in zoom-in-95 duration-150">
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

                    <div className="px-4 pt-2 border-t border-slate-100 flex items-center justify-between">
                      <button
                        onClick={() => {
                          setCurrentTab('production_control');
                          setNotificationsOpen(false);
                        }}
                        className="text-[11px] font-bold text-indigo-700 hover:underline cursor-pointer"
                      >
                        فتح شاشة متابعة الإنتاج &larr;
                      </button>
                      <button
                        onClick={() => setNotificationsOpen(false)}
                        className="text-[11px] text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        إغلاق
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Profile Dropdown */}
              <div className="relative">
                <button
                  onClick={() => {
                    setUserDropdownOpen(!userDropdownOpen);
                    setNotificationsOpen(false);
                  }}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200/80 border border-slate-200 transition text-xs text-slate-800 font-semibold cursor-pointer"
                >
                  <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shadow-xs">
                    {currentUser?.real_name ? currentUser.real_name[0] : 'U'}
                  </div>
                  <div className="hidden md:flex flex-col text-start">
                    <span className="text-xs font-bold leading-tight line-clamp-1 max-w-[120px]">
                      {currentUser?.real_name || currentUser?.username}
                    </span>
                    <span className="text-[10px] text-slate-500 font-normal">
                      {isSudo
                        ? 'حساب طوارئ مطلق'
                        : currentUser?.role || 'موظف تشغيل'}
                    </span>
                  </div>
                  <ChevronDown className="w-3 h-3 text-slate-500" />
                </button>

                {userDropdownOpen && (
                  <div className="absolute start-0 mt-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-200 py-3 z-50 animate-in fade-in zoom-in-95 duration-100">
                    <div className="px-4 pb-3 border-b border-slate-100 text-start">
                      <p className="font-bold text-slate-900 text-sm">{currentUser?.real_name}</p>
                      <p className="text-xs text-slate-500 font-mono">@{currentUser?.username}</p>
                      <span className="inline-block mt-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                        {isSudo ? 'حساب طوارئ مطلق (Superuser)' : currentUser?.role || 'مستخدم النظام'}
                      </span>
                    </div>

                    <div className="p-2">
                      <button
                        onClick={() => {
                          setUserDropdownOpen(false);
                          onLogout();
                        }}
                        className="w-full flex items-center justify-center gap-2 text-xs text-rose-600 hover:bg-rose-50 font-bold py-2.5 rounded-xl transition cursor-pointer"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>تسجيل الخروج من النظام</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Mobile menu hamburger */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden p-2 rounded-xl text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>

          {/* Mobile menu dropdown */}
          {mobileMenuOpen && (
            <div className="lg:hidden py-3 border-t border-slate-200 flex flex-col gap-1.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = isTabActive(item.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => handleNavClick(item.id)}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold transition ${
                      isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isActive ? 'text-white' : item.color}`} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </nav>

      {/* Rendered outside <nav> (and via Portal) so backdrop-blur on <nav> never clips or misaligns the modal (Task 1) */}
      <InternalMessagingModal
        isOpen={messagesModalOpen}
        onClose={() => setMessagesModalOpen(false)}
      />
    </>
  );
};