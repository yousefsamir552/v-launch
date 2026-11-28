import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users, Briefcase, Clock, Wallet, Scale, Banknote, RefreshCw,
  Download, UsersRound, BarChart3, FileSpreadsheet
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
import { BonusesPanel } from './hr/BonusesPanel';
import { PayrollPanel } from './hr/PayrollPanel';

export const HRView: React.FC<HRViewProps> = ({ initialSection = 'staff', initialSubTab }) => {
  const { addFlashMessage, canManageHR, canAccessHRSection, visibleRankLevels, exportHRSectionsZip } = useApp();

  const [section, setSection] = useState<HRSection>(initialSection);
  const [staffTab, setStaffTab] = useState<'employees' | 'jobs'>(
    initialSubTab === 'jobs' ? 'jobs' : 'employees'
  );
  const [attendanceTab, setAttendanceTab] = useState<'records' | 'rules'>(
    initialSubTab === 'rules' ? 'rules' : 'records'
  );
  const [loansTab, setLoansTab] = useState<'loans' | 'penalties' | 'bonuses'>(
    initialSubTab === 'penalties' ? 'penalties' : initialSubTab === 'bonuses' ? 'bonuses' : 'loans'
  );

  // Per-tab HR permissions (each tab has its own independent permission).
  const hrPerm = {
    jobs: canAccessHRSection('jobs'),
    employees: canAccessHRSection('employees'),
    attendance: canAccessHRSection('attendance'),
    rules: canAccessHRSection('rules'),
    loans: canAccessHRSection('loans'),
    penalties: canAccessHRSection('penalties'),
    payroll: canAccessHRSection('payroll'),
    reports: canAccessHRSection('reports')
  };
  const sectionAccess: Record<HRSection, boolean> = {
    staff: hrPerm.employees || hrPerm.jobs,
    attendance: hrPerm.attendance || hrPerm.rules,
    loans_penalties: hrPerm.loans || hrPerm.penalties,
    payroll: hrPerm.payroll,
    reports: hrPerm.reports || hrPerm.payroll
  };

  const [jobTitles, setJobTitles] = useState<HRJobTitle[]>([]);
  const [employees, setEmployees] = useState<HREmployee[]>([]);
  const [settings, setSettings] = useState<HRAttendanceSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    if (initialSubTab === 'employees' || initialSubTab === 'jobs') setStaffTab(initialSubTab);
    else if (initialSubTab === 'records' || initialSubTab === 'rules') setAttendanceTab(initialSubTab);
    else if (initialSubTab === 'loans' || initialSubTab === 'penalties' || initialSubTab === 'bonuses') setLoansTab(initialSubTab);
  }, [initialSubTab]);

  const loadHRData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [jobsRes, employeesRes, settingsRes] = await Promise.all([
        api.getHRJobTitles().catch(() => []),
        api.getHREmployees().catch(() => []),
        api.getHRAttendanceSettings().catch(() => null)
      ]);
      setJobTitles(Array.isArray(jobsRes) ? jobsRes : []);
      setEmployees(Array.isArray(employeesRes) ? employeesRes : []);
      setSettings(settingsRes || null);
    } catch (err: any) {
      addFlashMessage(err?.message || 'فشل تحميل بيانات الموارد البشرية من السيرفر', 'danger');
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!canManageHR()) return;
    void loadHRData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadHRData]);

  const sectionMeta: Record<
    HRSection,
    { title: string; subtitle: string; icon: React.ComponentType<{ className?: string }> }
  > = {
    staff: {
      title: 'الموظفين والوظائف',
      subtitle: 'إدارة وظائف المصنع وملفات الموظفين وقواعد تطبيق الخصم',
      icon: Users
    },
    attendance: {
      title: 'الحضور والانصراف',
      subtitle: 'القواعد العامة للمواعيد والتأخيرات والغياب',
      icon: Clock
    },
    loans_penalties: {
      title: 'السُلف والجزاءات والمكافآت',
      subtitle: 'تسجيل السُلف المقسّطة والجزاءات والمكافآت الفورية والدورية',
      icon: Scale
    },
    payroll: {
      title: 'المرتبات',
      subtitle: 'احتساب المرتبات الشهرية بعد الخصومات',
      icon: Wallet
    },
    reports: {
      title: 'تقارير وإحصائيات الموارد البشرية',
      subtitle: 'تحليل السُلف والمرتبات والانتظام الشهري والسنوي',
      icon: BarChart3
    }
  };

  const meta = sectionMeta[section];
  const SectionIcon = meta.icon;

  const tabs =
    section === 'staff'
      ? [
          ...(hrPerm.employees ? [{ id: 'employees', label: 'قائمة الموظفين' }] : []),
          ...(hrPerm.jobs ? [{ id: 'jobs', label: 'إدارة الوظائف' }] : [])
        ]
      : section === 'attendance'
        ? [
            ...(hrPerm.attendance ? [{ id: 'records', label: 'سجل الحضور والبصمة' }] : []),
            ...(hrPerm.rules ? [{ id: 'rules', label: 'القواعد العامة للمواعيد' }] : [])
          ]
        : section === 'loans_penalties'
          ? [
              ...(hrPerm.loans ? [{ id: 'loans', label: 'السُلف والأقساط' }] : []),
              ...(hrPerm.penalties ? [{ id: 'penalties', label: 'الجزاءات' }] : []),
              ...(hrPerm.payroll || hrPerm.loans || hrPerm.penalties
                ? [{ id: 'bonuses', label: 'المكافآت الفورية والدورية' }]
                : [])
            ]
          : [];

  const rawActiveTab =
    section === 'staff'
      ? staffTab
      : section === 'attendance'
        ? attendanceTab
        : section === 'loans_penalties'
          ? loansTab
          : section;

  // حماية إضافية: لو التبويب الحالي غير مصرح به، انتقل لأول تبويب متاح.
  const activeTab =
    section === 'payroll' || section === 'reports'
      ? section
      : tabs.some((tab) => tab.id === rawActiveTab)
        ? rawActiveTab
        : tabs[0]?.id || '';

  const handleTabChange = (tabId: string) => {
    if (section === 'staff') setStaffTab(tabId as 'employees' | 'jobs');
    else if (section === 'attendance') setAttendanceTab(tabId as 'records' | 'rules');
    else if (section === 'loans_penalties') setLoansTab(tabId as 'loans' | 'penalties' | 'bonuses');
  };

  // Defense-in-depth: never render the HR panels without the dynamic permission.
  if (!canManageHR() || !sectionAccess[section]) {
    return (
      <div className="p-4" dir="rtl">
        <div className="max-w-2xl mx-auto bg-white rounded-3xl border border-rose-200 shadow-xs p-8 text-center space-y-3">
          <div className="w-14 h-14 mx-auto rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center text-2xl">
            🔒
          </div>
          <h2 className="text-base font-black text-slate-900">
            لا تمتلك صلاحية الوصول لقسم الموارد البشرية
          </h2>
          <p className="text-xs text-slate-500 leading-relaxed">
            يرجى التواصل مع مدير النظام لمنحك صلاحية
            <strong className="text-slate-800"> «إدارة الموارد البشرية (HR)» </strong>
            من شاشة الصلاحيات والأدوار.
          </p>
        </div>
      </div>
    );
  }

  // Client-side defense: restrict everything to the rank levels visible to the viewer.
  const allowedRanks = visibleRankLevels();
  const rankSafeEmployees = employees.filter((emp) =>
    allowedRanks.includes(Number(emp.rank_level ?? 3) as 0 | 1 | 2 | 3)
  );
  // الموظفون النشطون فقط لشاشات التشغيل الفعالة (الحضور / السُلف / الجزاءات / المرتبات المفتوحة).
  const activeEmployees = rankSafeEmployees.filter((emp) => emp.is_active !== false);

  return (
    <div className="space-y-4" dir="rtl">
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
              <SectionIcon className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900">{meta.title}</h1>
              <p className="text-[11px] font-bold text-slate-500 mt-0.5">{meta.subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-black text-slate-700">
              <Users className="w-3.5 h-3.5 text-purple-600" />
              الموظفين: {rankSafeEmployees.length}
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-black text-slate-700">
              <Briefcase className="w-3.5 h-3.5 text-purple-600" />
              الوظائف: {jobTitles.length}
            </span>
            <button
              type="button"
              onClick={() => void exportHRSectionsZip()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-black transition cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              📊 تصدير Excel
            </button>
            <button
              type="button"
              onClick={() => void loadHRData()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-[11px] font-black text-slate-700 hover:bg-slate-50 transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              تحديث
            </button>
          </div>
        </div>

        {tabs.length > 0 && (
          <div className="flex items-center gap-1.5 mt-4 pt-4 border-t border-slate-100 flex-wrap">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className={`px-3.5 py-2 rounded-xl text-[11px] font-black transition cursor-pointer ${
                  activeTab === tab.id
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {section === 'staff' && activeTab === 'employees' && (
        <EmployeesPanel
          employees={rankSafeEmployees}
          jobTitles={jobTitles}
          isLoading={isLoading}
          onRefresh={loadHRData}
        />
      )}

      {section === 'staff' && activeTab === 'jobs' && (
        <JobsPanel
          jobTitles={jobTitles}
          employees={rankSafeEmployees}
          isLoading={isLoading}
          onRefresh={loadHRData}
        />
      )}

      {section === 'attendance' && activeTab === 'rules' && (
        <AttendanceRulesPanel settings={settings} isLoading={isLoading} onRefresh={loadHRData} />
      )}

      {section === 'attendance' && activeTab === 'records' && (
        <AttendanceRecordsPanel employees={activeEmployees} />
      )}

      {section === 'loans_penalties' && activeTab === 'loans' && (
        <LoansPanel employees={activeEmployees} />
      )}

      {section === 'loans_penalties' && activeTab === 'penalties' && (
        <PenaltiesPanel employees={activeEmployees} />
      )}

      {section === 'loans_penalties' && activeTab === 'bonuses' && (
        <BonusesPanel employees={activeEmployees} />
      )}

      {section === 'payroll' && <PayrollPanel employees={activeEmployees} />}

      {section === 'reports' && <HRReportsView />}
    </div>
  );
};

