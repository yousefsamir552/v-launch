import React, { useState, useEffect } from 'react';
import { useApp } from './context/AppContext';
import { Navbar } from './components/Navbar';
import { FlashAlerts } from './components/FlashAlerts';
import { DashboardView } from './components/DashboardView';
import { WarehouseView } from './components/WarehouseView';
import { DesignView } from './components/DesignView';
import { ModelDetailsView } from './components/ModelDetailsView';
import { CuttingView } from './components/CuttingView';
import { CuttingDetailsView } from './components/CuttingDetailsView';
import { QCDetailsView } from './components/QCDetailsView';
import { ProductionControlView } from './components/ProductionControlView';
import { MasterModelTrackingView } from './components/MasterModelTrackingView';
import { AssemblyPackagingView } from './components/AssemblyPackagingView';
import { SettingsView } from './components/SettingsView';
import { AuditLogsView } from './components/AuditLogsView';
import { ReportsView } from './components/ReportsView';
import { HRView } from './components/HRView';
import { LoginModal } from './components/LoginModal';

export const App: React.FC = () => {
  const {
    currentUser,
    logout,
    addFlashMessage,
    hasPermission,
    canAccessSettings,
    canViewAuditLogs,
    canManageHR,
    globalSettings
  } = useApp();

  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [selectedModelId, setSelectedModelId] = useState<string>('');

  const isSudo =
    currentUser?.username?.toLowerCase() === 'sudo' || Boolean(currentUser?.is_sudo);

  // Dynamically sync browser document title with globalSettings.site_name
  useEffect(() => {
    if (globalSettings?.site_name) {
      document.title = globalSettings.site_name;
    }
  }, [globalSettings?.site_name]);

  const isHrTab = (tab: string): boolean =>
    tab === 'hr_employees' ||
    tab === 'hr_attendance' ||
    tab === 'hr_loans_penalties' ||
    tab === 'hr_payroll';

  const canAccessTab = (tab: string): boolean => {
    if (isSudo) return true;
    if (tab === 'dashboard') return true;
    if (
      tab === 'warehouse' ||
      tab === 'accessories_warehouse' ||
      tab === 'production_warehouse'
    ) {
      return (
        hasPermission('fabric_warehouse') ||
        hasPermission('accessories_warehouse') ||
        hasPermission('production_warehouse')
      );
    }
    if (tab === 'design' || tab === 'model_details') return hasPermission('design');
    if (tab === 'cutting' || tab === 'cutting_details') return hasPermission('cutting');
    if (
      tab === 'production_control' ||
      tab === 'printing' ||
      tab === 'assembly' ||
      tab === 'qc' ||
      tab === 'qc_details' ||
      tab === 'sewing'
    ) {
      return (
        hasPermission('printing') ||
        hasPermission('qc') ||
        hasPermission('sewing') ||
        hasPermission('reports')
      );
    }
    if (tab === 'models_tracking') return hasPermission('models_tracking');
    if (tab === 'assembly_packaging') return hasPermission('assembly_packaging');
    if (tab === 'reports') return hasPermission('reports');
    if (tab === 'settings') return canAccessSettings();
    if (tab === 'logs') return canViewAuditLogs();
    if (
      tab === 'hr_employees' ||
      tab === 'hr_attendance' ||
      tab === 'hr_loans_penalties' ||
      tab === 'hr_payroll'
    ) {
      return canManageHR();
    }
    return true;
  };

  // If user role changes and they lose permission for the current tab, send them to dashboard.
  // HR tabs are excluded so the dedicated "no permission" guard can render instead.
  useEffect(() => {
    if (currentUser && isHrTab(currentTab)) return;
    if (currentUser && !canAccessTab(currentTab)) {
      setCurrentTab('dashboard');
    }
  }, [currentTab, currentUser]);

  if (!currentUser) {
    return (
      <LoginModal
        onSuccess={() => {
          setCurrentTab('dashboard');
          addFlashMessage('تم تسجيل الدخول بنجاح');
        }}
      />
    );
  }

  const handleNavigate = (tab: string, modelId?: string) => {
    if (!canAccessTab(tab)) {
      addFlashMessage(
        isHrTab(tab)
          ? 'عفواً، لا تمتلك الصلاحية للوصول لقسم الموارد البشرية'
          : 'عفواً، ليس لديك صلاحية للوصول لهذا القسم',
        'warning'
      );
      return;
    }
    if (modelId) {
      setSelectedModelId(modelId);
    }
    setCurrentTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLogout = () => {
    logout();
  };

  const siteLogo = globalSettings?.logo || '🏭';
  const isImageLogo =
    siteLogo.startsWith('http://') ||
    siteLogo.startsWith('https://') ||
    siteLogo.startsWith('data:image/') ||
    siteLogo.startsWith('/');

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-slate-900 flex flex-col lg:pl-72 antialiased">
      <Navbar
        currentTab={currentTab}
        setCurrentTab={(tab) => handleNavigate(tab)}
        onLogout={handleLogout}
      />

      <FlashAlerts />

      <main className="flex-grow max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {currentTab === 'dashboard' && (
          <DashboardView onNavigate={(tab, id) => handleNavigate(tab, id)} />
        )}

        {/* Warehouses Hub (Fabric, Accessories, Production) */}
        {(currentTab === 'warehouse' ||
          currentTab === 'accessories_warehouse' ||
          currentTab === 'production_warehouse') && <WarehouseView />}

        {/* Design View */}
        {currentTab === 'design' && (
          <DesignView onOpenModelDetails={(id) => handleNavigate('model_details', id)} />
        )}

        {currentTab === 'model_details' && (
          <ModelDetailsView
            modelId={selectedModelId}
            onBack={() => handleNavigate('design')}
            onGoToCutting={(id) => handleNavigate('cutting_details', id)}
          />
        )}

        {/* Cutting View */}
        {currentTab === 'cutting' && (
          <CuttingView onOpenCuttingDetails={(id) => handleNavigate('cutting_details', id)} />
        )}

        {currentTab === 'cutting_details' && (
          <CuttingDetailsView
            modelId={selectedModelId}
            onBack={() => handleNavigate('cutting')}
            onFinishedToQC={() => handleNavigate('production_control')}
          />
        )}

        {/* Production Control Hub (Printing, QC, Sewing) */}
        {currentTab === 'production_control' && <ProductionControlView />}

        {currentTab === 'printing' && <ProductionControlView initialSubTab="printing" />}
        {currentTab === 'assembly' && <ProductionControlView initialSubTab="printing" />}
        {currentTab === 'qc' && <ProductionControlView initialSubTab="qc" />}
        {currentTab === 'sewing' && <ProductionControlView initialSubTab="sewing" />}

        {currentTab === 'qc_details' && (
          <QCDetailsView
            modelId={selectedModelId}
            onBack={() => handleNavigate('production_control')}
            onFinishedApproval={() => handleNavigate('production_control')}
          />
        )}

        {/* Assembly & Packaging Section (الأسمبلي والأمبالاج) */}
        {currentTab === 'assembly_packaging' && <AssemblyPackagingView />}

        {/* Master Model Tracking */}
        {currentTab === 'models_tracking' && <MasterModelTrackingView />}

        {/* Reports & Analytics Section */}
        {currentTab === 'reports' && <ReportsView />}

        {/* Human Resources (HR) - الموارد البشرية */}
        {isHrTab(currentTab) &&
          (canManageHR() ? (
            <>
              {currentTab === 'hr_employees' && <HRView initialSection="staff" />}
              {currentTab === 'hr_attendance' && <HRView initialSection="attendance" />}
              {currentTab === 'hr_loans_penalties' && <HRView initialSection="loans_penalties" />}
              {currentTab === 'hr_payroll' && <HRView initialSection="payroll" />}
            </>
          ) : (
            <div className="p-4 lg:p-8">
              <div className="max-w-2xl mx-auto bg-white rounded-3xl border border-rose-200 shadow-xs p-8 text-center space-y-4">
                <div className="w-16 h-16 mx-auto rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center text-3xl">
                  🔒
                </div>
                <h2 className="text-lg font-black text-slate-900">
                  لا تمتلك صلاحية الوصول لقسم الموارد البشرية
                </h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  عفواً، هذا القسم مخصص للمستخدمين الذين يمتلكون صلاحية
                  <strong className="text-slate-800"> «إدارة الموارد البشرية (HR)» </strong>
                  . يرجى التواصل مع مدير النظام لمنحك الصلاحية من شاشة الصلاحيات والأدوار.
                </p>
                <button
                  type="button"
                  onClick={() => handleNavigate('dashboard')}
                  className="px-5 py-2.5 rounded-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-md transition cursor-pointer"
                >
                  العودة إلى الرئيسية
                </button>
              </div>
            </div>
          ))}

        {/* Settings & Audit Logs */}
        {currentTab === 'settings' && (
          <SettingsView onOpenLogs={() => handleNavigate('logs')} />
        )}

        {currentTab === 'logs' && (
          <AuditLogsView onBack={() => handleNavigate('settings')} />
        )}
      </main>

      {/* Dynamic Footer connected to GlobalSettings (Task 3) */}
      <footer className="no-print border-t border-slate-200/80 bg-white py-6 mt-12 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-semibold text-slate-700">
            {isImageLogo ? (
              <img
                src={siteLogo}
                alt={globalSettings?.site_name || 'Logo'}
                className="w-5 h-5 rounded-md object-contain"
              />
            ) : (
              <span>{siteLogo}</span>
            )}
            <span>
              {globalSettings?.footer_title ||
                `${globalSettings?.site_name || 'نظام إدارة المصنع'} - مصانع الملابس الجاهزة`}
            </span>
          </div>
          <p className="text-slate-400">
            {globalSettings?.copyright_text ||
              `تم التطوير لدعم دورة الإنتاج الشاملة والصلاحيات المتقدمة © ${new Date().getFullYear()}`}
          </p>
        </div>
      </footer>
    </div>
  );
};