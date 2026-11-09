import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Users,
  Briefcase,
  Clock,
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Save,
  AlertTriangle,
  CalendarDays,
  Building2,
  Coffee,
  Timer,
  Info,
  Wallet,
  Scale,
  Banknote,
  RefreshCw,
  Download,
  Upload,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  XCircle,
  UsersRound,
  LayoutList,
  History,
  Printer
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../api/client';
import {
  HRJobTitle,
  HREmployee,
  HRAttendanceSettings,
  HRAttendanceRule,
  HRAttendanceRecord,
  HRAttendanceStatus,
  HRAttendanceStats,
  HRAttendanceImportResult,
  HRReviewStatus,
  HRPenalty,
  HRPenaltyType,
  HRLoan,
  HRDepartmentKey,
  HR_DEPARTMENTS,
  HR_DEPARTMENT_LABELS,
  HR_WEEK_DAYS,
  HRWeekDayKey,
  HRRuleApplicationMode,
  HRRuleViolationType,
  HRRuleDeductionType,
  HRRuleApplyMode
} from '../types';

type HRSection = 'staff' | 'attendance' | 'loans_penalties' | 'payroll';
type HRSubTab = 'employees' | 'jobs' | 'records' | 'rules' | 'loans' | 'penalties';

interface HRViewProps {
  initialSection?: HRSection;
  initialSubTab?: HRSubTab;
}

const inputClass =
  'w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-800 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-100 transition';
const labelClass = 'block text-[11px] font-black text-slate-600 mb-1.5';

const formatMoney = (value: number) =>
  `${(Number.isFinite(value) ? value : 0).toLocaleString('en-US', {
    maximumFractionDigits: 2
  })} ج.م`;

const VIOLATION_LABELS: Record<HRRuleViolationType, string> = {
  late_arrival: 'تأخير في الحضور',
  early_departure: 'انصراف مبكر',
  absence: 'غياب'
};

const DEDUCTION_LABELS: Record<HRRuleDeductionType, string> = {
  hours: 'ساعات',
  days: 'أيام'
};

const APPLY_MODE_LABELS: Record<HRRuleApplyMode, string> = {
  auto: 'تطبيق تلقائي',
  manual_review: 'مراجعة يدوية أولاً'
};

const RULE_APPLICATION_LABELS: Record<HRRuleApplicationMode, string> = {
  auto: 'تطبيق القواعد تلقائياً',
  manual_review: 'مراجعة يدوية أولاً في الحضور'
};

const Modal: React.FC<{
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidthClass?: string;
}> = ({ title, subtitle, onClose, children, footer, maxWidthClass = 'max-w-2xl' }) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
    onClick={onClose}
  >
    <div
      className={`bg-white w-full ${maxWidthClass} rounded-3xl shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col`}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200">
        <div>
          <h3 className="text-sm font-black text-slate-900">{title}</h3>
          {subtitle && <p className="text-[11px] font-bold text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>
      {footer && (
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/60 flex items-center justify-end gap-2">
          {footer}
        </div>
      )}
    </div>
  </div>
);

const ErrorNote: React.FC<{ message: string }> = ({ message }) =>
  message ? (
    <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-bold">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>{message}</span>
    </div>
  ) : null;

const PlaceholderPanel: React.FC<{ title: string; description: string }> = ({
  title,
  description
}) => (
  <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center">
    <div className="w-14 h-14 mx-auto rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center mb-3">
      <Timer className="w-7 h-7" />
    </div>
    <h3 className="text-base font-black text-slate-900 mb-1">{title}</h3>
    <p className="text-xs font-bold text-slate-500 max-w-md mx-auto leading-relaxed">
      {description}
    </p>
    <span className="inline-block mt-4 text-[11px] font-black px-3 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
      قريباً في المرحلة القادمة
    </span>
  </div>
);

/** حالات الحضور لعرض الشرائح. */
const ATTENDANCE_STATUS_LABELS: Record<HRAttendanceStatus, string> = {
  present: 'حاضر',
  absent: 'غائب',
  leave: 'إجازة',
  missing_punch: 'بصمة ناقصة'
};

/** حالات مراجعة الخصومات المحتسبة. */
const REVIEW_STATUS_LABELS: Record<HRReviewStatus, string> = {
  auto_applied: 'مطبق تلقائياً',
  pending_review: 'بانتظار المراجعة',
  approved: 'تم الاعتماد',
  rejected: 'مرفوض'
};

/** أنواع الجزاءات اليدوية. */
const PENALTY_TYPE_LABELS: Record<HRPenaltyType, string> = {
  days: 'أيام',
  hours: 'ساعات'
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);

/** أسماء أيام الأسبوع بالعربية لعرض سجل الحضور اليومي. */
const WEEK_DAY_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const formatDayLabel = (iso: string) => {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return `${WEEK_DAY_AR[parsed.getDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
};

export const HRView: React.FC<HRViewProps> = ({ initialSection = 'staff', initialSubTab }) => {
  const { addFlashMessage, canManageHR, canAccessHRSection, visibleRankLevels } = useApp();

  const [section, setSection] = useState<HRSection>(initialSection);
  const [staffTab, setStaffTab] = useState<'employees' | 'jobs'>(
    initialSubTab === 'jobs' ? 'jobs' : 'employees'
  );
  const [attendanceTab, setAttendanceTab] = useState<'records' | 'rules'>(
    initialSubTab === 'rules' ? 'rules' : 'records'
  );
  const [loansTab, setLoansTab] = useState<'loans' | 'penalties'>(
    initialSubTab === 'penalties' ? 'penalties' : 'loans'
  );

  // Per-tab HR permissions (each tab has its own independent permission).
  const hrPerm = {
    jobs: canAccessHRSection('jobs'),
    employees: canAccessHRSection('employees'),
    attendance: canAccessHRSection('attendance'),
    rules: canAccessHRSection('rules'),
    loans: canAccessHRSection('loans'),
    penalties: canAccessHRSection('penalties'),
    payroll: canAccessHRSection('payroll')
  };
  const sectionAccess: Record<HRSection, boolean> = {
    staff: hrPerm.employees || hrPerm.jobs,
    attendance: hrPerm.attendance || hrPerm.rules,
    loans_penalties: hrPerm.loans || hrPerm.penalties,
    payroll: hrPerm.payroll
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
    else if (initialSubTab === 'loans' || initialSubTab === 'penalties') setLoansTab(initialSubTab);
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
      title: 'السُلف والجزاءات',
      subtitle: 'تسجيل السُلف المالية والجزاءات على الموظفين',
      icon: Scale
    },
    payroll: {
      title: 'مسير المرتبات',
      subtitle: 'احتساب المرتبات الشهرية بعد الخصومات',
      icon: Wallet
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
              ...(hrPerm.loans ? [{ id: 'loans', label: 'السُلف' }] : []),
              ...(hrPerm.penalties ? [{ id: 'penalties', label: 'الجزاءات' }] : [])
            ]
          : [];

  const rawActiveTab =
    section === 'staff'
      ? staffTab
      : section === 'attendance'
        ? attendanceTab
        : section === 'loans_penalties'
          ? loansTab
          : 'payroll';

  // حماية إضافية: لو التبويب الحالي غير مصرح به، انتقل لأول تبويب متاح.
  const activeTab =
    section === 'payroll'
      ? 'payroll'
      : tabs.some((tab) => tab.id === rawActiveTab)
        ? rawActiveTab
        : tabs[0]?.id || '';

  const handleTabChange = (tabId: string) => {
    if (section === 'staff') setStaffTab(tabId as 'employees' | 'jobs');
    else if (section === 'attendance') setAttendanceTab(tabId as 'records' | 'rules');
    else if (section === 'loans_penalties') setLoansTab(tabId as 'loans' | 'penalties');
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
              الموظفين: {employees.length}
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-black text-slate-700">
              <Briefcase className="w-3.5 h-3.5 text-purple-600" />
              الوظائف: {jobTitles.length}
            </span>
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
        <AttendanceRecordsPanel employees={rankSafeEmployees} />
      )}

      {section === 'loans_penalties' && activeTab === 'loans' && (
        <LoansPanel employees={rankSafeEmployees} />
      )}

      {section === 'loans_penalties' && activeTab === 'penalties' && (
        <PenaltiesPanel employees={rankSafeEmployees} />
      )}

      {section === 'payroll' && <PayrollPanel employees={rankSafeEmployees} />}
    </div>
  );
};

const JobsPanel: React.FC<{
  jobTitles: HRJobTitle[];
  employees: HREmployee[];
  isLoading: boolean;
  onRefresh: () => void | Promise<void>;
}> = ({ jobTitles, employees, isLoading, onRefresh }) => {
  const { addFlashMessage, logAction } = useApp();

  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<HRJobTitle | null>(null);
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState<HRDepartmentKey>('sewing');
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<HRJobTitle | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const employeesByJob = useMemo(() => {
    const map: Record<string, number> = {};
    employees.forEach((emp) => {
      map[emp.job_id] = (map[emp.job_id] || 0) + 1;
    });
    return map;
  }, [employees]);

  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobTitles.filter((job) => {
      if (departmentFilter && job.department !== departmentFilter) return false;
      if (!q) return true;
      const departmentLabel = HR_DEPARTMENT_LABELS[job.department] || '';
      return job.title.toLowerCase().includes(q) || departmentLabel.includes(search.trim());
    });
  }, [jobTitles, search, departmentFilter]);

  const openCreate = () => {
    setEditing(null);
    setTitle('');
    setDepartment('sewing');
    setFormError('');
    setIsFormOpen(true);
  };

  const openEdit = (job: HRJobTitle) => {
    setEditing(job);
    setTitle(job.title);
    setDepartment(job.department);
    setFormError('');
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditing(null);
    setFormError('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setFormError('اسم الوظيفة مطلوب');
      return;
    }
    setIsSaving(true);
    setFormError('');
    try {
      if (editing) {
        await api.updateHRJobTitle(editing.id, { title: cleanTitle, department });
        addFlashMessage('تم تعديل الوظيفة بنجاح');
        logAction('الموارد البشرية', `تعديل وظيفة: ${cleanTitle}`);
      } else {
        await api.createHRJobTitle({ title: cleanTitle, department });
        addFlashMessage('تمت إضافة الوظيفة بنجاح');
        logAction('الموارد البشرية', `إضافة وظيفة: ${cleanTitle}`);
      }
      closeForm();
      await onRefresh();
    } catch (err: any) {
      setFormError(err?.message || 'فشل حفظ الوظيفة');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError('');
    try {
      await api.deleteHRJobTitle(deleteTarget.id);
      addFlashMessage('تم حذف الوظيفة بنجاح');
      logAction('الموارد البشرية', `حذف وظيفة: ${deleteTarget.title}`);
      setDeleteTarget(null);
      await onRefresh();
    } catch (err: any) {
      setDeleteError(err?.message || 'فشل حذف الوظيفة');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-slate-900">وظائف المصنع</h2>
          <p className="text-[11px] font-bold text-slate-500 mt-0.5">
            كل وظيفة مرتبطة بقسم من أقسام المصنع، ومرتب الموظف يُسحب تلقائياً من وظيفته.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white text-[11px] font-black hover:bg-purple-700 transition cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          إضافة وظيفة
        </button>
      </div>

      <div className="p-4 bg-slate-50/60 border-b border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="بحث باسم الوظيفة أو القسم..."
            className={`${inputClass} pr-9`}
          />
        </div>
        <select
          value={departmentFilter}
          onChange={(event) => setDepartmentFilter(event.target.value)}
          className={inputClass}
        >
          <option value="">كل الأقسام</option>
          {HR_DEPARTMENTS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="p-10 text-center text-xs font-bold text-slate-400">جاري التحميل...</div>
      ) : filteredJobs.length === 0 ? (
        <div className="p-10 text-center">
          <Briefcase className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="text-xs font-black text-slate-700">لا توجد وظائف مطابقة</p>
          <p className="text-[11px] font-bold text-slate-500 mt-1">
            ابدأ بإضافة وظيفة جديدة وحدد قسمها من أقسام المصنع.
          </p>
        </div>
      ) : (
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredJobs.map((job) => (
            <div
              key={job.id}
              className="border border-slate-200 rounded-2xl p-3.5 hover:border-purple-300 transition"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-black text-slate-900 truncate">{job.title}</p>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 mt-1">
                    <Building2 className="w-3 h-3 text-purple-500" />
                    {HR_DEPARTMENT_LABELS[job.department] || job.department}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEdit(job)}
                    title="تعديل"
                    className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-purple-600 transition cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteTarget(job);
                      setDeleteError('');
                    }}
                    title="حذف"
                    className="p-1.5 rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[10px] font-bold text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <Users className="w-3 h-3 text-purple-500" />
                  {employeesByJob[job.id] || 0} موظف
                </span>
                <span className="font-mono text-slate-400">{job.id.slice(0, 8)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {isFormOpen && (
        <Modal
          title={editing ? 'تعديل وظيفة' : 'إضافة وظيفة جديدة'}
          subtitle="اختر اسماً واضحاً للوظيفة وحدد القسم الذي تعمل به"
          onClose={closeForm}
          maxWidthClass="max-w-lg"
        >
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className={labelClass}>اسم الوظيفة *</label>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="مثال: عامل خياطة - مكن أوفر"
                className={inputClass}
                autoFocus
              />
            </div>
            <div>
              <label className={labelClass}>القسم / مكان العمل *</label>
              <select
                value={department}
                onChange={(event) => setDepartment(event.target.value as HRDepartmentKey)}
                className={inputClass}
              >
                {HR_DEPARTMENTS.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <ErrorNote message={formError} />
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeForm}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-black hover:bg-slate-200 transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white text-[11px] font-black hover:bg-purple-700 transition cursor-pointer disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                {isSaving ? 'جاري الحفظ...' : 'حفظ الوظيفة'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          title="تأكيد حذف الوظيفة"
          subtitle="لا يمكن التراجع عن هذه العملية"
          onClose={() => {
            setDeleteTarget(null);
            setDeleteError('');
          }}
          maxWidthClass="max-w-md"
        >
          <div className="space-y-3">
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-bold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                سيتم حذف وظيفة <strong>{deleteTarget.title}</strong>. لا يمكن حذف وظيفة مرتبط بها
                موظفون، يجب نقلهم إلى وظيفة أخرى أولاً.
              </span>
            </div>
            <ErrorNote message={deleteError} />
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteError('');
                }}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-black hover:bg-slate-200 transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={isDeleting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 text-white text-[11px] font-black hover:bg-rose-700 transition cursor-pointer disabled:opacity-60"
              >
                <Trash2 className="w-4 h-4" />
                {isDeleting ? 'جاري الحذف...' : 'حذف الوظيفة'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

type EmployeeForm = {
  name: string;
  employee_code: string;
  job_id: string;
  monthly_salary: string;
  rule_application_mode: HRRuleApplicationMode;
  national_id: string;
  birth_date: string;
  phone: string;
  photo: string;
  notes: string;
  is_active: boolean;
  rank_level: number;
};

const emptyEmployeeForm: EmployeeForm = {
  name: '',
  employee_code: '',
  job_id: '',
  monthly_salary: '',
  rule_application_mode: 'auto',
  national_id: '',
  birth_date: '',
  phone: '',
  photo: '',
  notes: '',
  is_active: true,
  rank_level: 3
};

const EmployeesPanel: React.FC<{
  employees: HREmployee[];
  jobTitles: HRJobTitle[];
  isLoading: boolean;
  onRefresh: () => void | Promise<void>;
}> = ({ employees, jobTitles, isLoading, onRefresh }) => {
  const { addFlashMessage, logAction, visibleRankOptions, currentUserRank } = useApp();
  const rankOptions = visibleRankOptions();

  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [jobFilter, setJobFilter] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<HREmployee | null>(null);
  const [form, setForm] = useState<EmployeeForm>(emptyEmployeeForm);
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<HREmployee | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const jobsForFilter = useMemo(() => {
    if (!departmentFilter) return jobTitles;
    return jobTitles.filter((job) => job.department === departmentFilter);
  }, [jobTitles, departmentFilter]);

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((emp) => {
      if (departmentFilter && emp.department !== departmentFilter) return false;
      if (jobFilter && emp.job_id !== jobFilter) return false;
      if (!q) return true;
      return (
        emp.name.toLowerCase().includes(q) ||
        (emp.employee_code || '').toLowerCase().includes(q) ||
        (emp.job_title || '').toLowerCase().includes(q) ||
        (emp.phone || '').includes(q)
      );
    });
  }, [employees, search, departmentFilter, jobFilter]);

  const updateForm = (patch: Partial<EmployeeForm>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...emptyEmployeeForm,
      job_id: jobTitles[0]?.id || '',
      rank_level: Number(visibleRankOptions()[visibleRankOptions().length - 1]?.value ?? 3)
    });
    setFormError('');
    setIsFormOpen(true);
  };

  const openEdit = (employee: HREmployee) => {
    setEditing(employee);
    setForm({
      name: employee.name || '',
      employee_code: employee.employee_code || '',
      job_id: employee.job_id || '',
      monthly_salary: String(employee.monthly_salary ?? ''),
      rule_application_mode: employee.rule_application_mode || 'auto',
      national_id: employee.national_id || '',
      birth_date: employee.birth_date || '',
      phone: employee.phone || '',
      photo: employee.photo || '',
      notes: employee.notes || '',
      is_active: employee.is_active !== false,
      rank_level: Number(employee.rank_level ?? 3)
    });
    setFormError('');
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditing(null);
    setFormError('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setFormError('اسم الموظف مطلوب');
      return;
    }
    if (!form.job_id) {
      setFormError('يرجى اختيار وظيفة الموظف');
      return;
    }
    const salary = Number(form.monthly_salary);
    if (!Number.isFinite(salary) || salary <= 0) {
      setFormError('المرتب الشهري يجب أن يكون أكبر من صفر');
      return;
    }

    setIsSaving(true);
    setFormError('');
    const payload: any = {
      name,
      employee_code: form.employee_code.trim(),
      job_id: form.job_id,
      monthly_salary: salary,
      rule_application_mode: form.rule_application_mode,
      national_id: form.national_id.trim(),
      birth_date: form.birth_date || null,
      phone: form.phone.trim(),
      photo: form.photo.trim(),
      notes: form.notes.trim(),
      is_active: form.is_active,
      rank_level: form.rank_level
    };

    try {
      if (editing) {
        await api.updateHREmployee(editing.id, payload);
        addFlashMessage('تم تعديل بيانات الموظف بنجاح');
        logAction('الموارد البشرية', `تعديل بيانات موظف: ${name}`);
      } else {
        await api.createHREmployee(payload);
        addFlashMessage('تم إضافة الموظف بنجاح');
        logAction('الموارد البشرية', `إضافة موظف: ${name}`);
      }
      closeForm();
      await onRefresh();
    } catch (err: any) {
      setFormError(err?.message || 'فشل حفظ بيانات الموظف');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError('');
    try {
      await api.deleteHREmployee(deleteTarget.id);
      addFlashMessage('تم حذف الموظف بنجاح');
      logAction('الموارد البشرية', `حذف موظف: ${deleteTarget.name}`);
      setDeleteTarget(null);
      await onRefresh();
    } catch (err: any) {
      setDeleteError(err?.message || 'فشل حذف الموظف');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-slate-900">ملفات الموظفين</h2>
          <p className="text-[11px] font-bold text-slate-500 mt-0.5">
            الوظيفة تحدد القسم والمرتب، وكود الموظف هو نفس الـ ID المسجل على ماكينة البصمة.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white text-[11px] font-black hover:bg-purple-700 transition cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          إضافة موظف
        </button>
      </div>

      <div className="p-4 bg-slate-50/60 border-b border-slate-100 grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="بحث بالاسم أو كود البصمة أو الهاتف..."
            className={`${inputClass} pr-9`}
          />
        </div>
        <select
          value={departmentFilter}
          onChange={(event) => {
            setDepartmentFilter(event.target.value);
            setJobFilter('');
          }}
          className={inputClass}
        >
          <option value="">كل الأقسام</option>
          {HR_DEPARTMENTS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          value={jobFilter}
          onChange={(event) => setJobFilter(event.target.value)}
          className={inputClass}
        >
          <option value="">كل الوظائف</option>
          {jobsForFilter.map((job) => (
            <option key={job.id} value={job.id}>
              {job.title}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="p-10 text-center text-xs font-bold text-slate-400">جاري التحميل...</div>
      ) : filteredEmployees.length === 0 ? (
        <div className="p-10 text-center">
          <Users className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="text-xs font-black text-slate-700">لا يوجد موظفون مطابقون</p>
          <p className="text-[11px] font-bold text-slate-500 mt-1">
            تأكد من وجود وظائف أولاً، ثم أضف الموظف وحدد وظيفته ومرتبه الشهري.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="bg-slate-50 text-slate-500 font-black">
              <tr>
                <th className="px-3 py-2.5 text-start">كود البصمة</th>
                <th className="px-3 py-2.5 text-start">اسم الموظف</th>
                <th className="px-3 py-2.5 text-start">الوظيفة</th>
                <th className="px-3 py-2.5 text-start">القسم</th>
                <th className="px-3 py-2.5 text-start">المرتب الشهري</th>
                <th className="px-3 py-2.5 text-start">تطبيق القواعد</th>
                <th className="px-3 py-2.5 text-start">الحالة</th>
                <th className="px-3 py-2.5 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredEmployees.map((emp) => (
                <tr key={emp.id} className="hover:bg-slate-50/70 transition">
                  <td className="px-3 py-2.5 font-mono text-slate-600">
                    {emp.employee_code || '-'}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-full bg-purple-50 text-purple-700 flex items-center justify-center font-black text-[10px] shrink-0">
                        {(emp.name || '?').charAt(0)}
                      </span>
                      <span className="font-black text-slate-800 truncate">{emp.name}</span>
                      {currentUserRank !== 3 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200 text-[9px] font-black whitespace-nowrap">
                          {emp.rank_label || `المستوى ${emp.rank_level ?? 3}`}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 font-bold text-slate-700">{emp.job_title || '-'}</td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-bold text-[10px] whitespace-nowrap">
                      <Building2 className="w-3 h-3" />
                      {emp.department_label ||
                        HR_DEPARTMENT_LABELS[emp.department as HRDepartmentKey] ||
                        '-'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono font-black text-emerald-700 whitespace-nowrap">
                    {formatMoney(emp.monthly_salary || 0)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${
                        emp.rule_application_mode === 'manual_review'
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'bg-blue-50 text-blue-700 border border-blue-200'
                      }`}
                    >
                      {RULE_APPLICATION_LABELS[emp.rule_application_mode] ||
                        RULE_APPLICATION_LABELS.auto}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        emp.is_active === false
                          ? 'bg-slate-100 text-slate-500'
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      }`}
                    >
                      {emp.is_active === false ? 'موقوف' : 'نشط'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(emp)}
                        title="تعديل"
                        className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-purple-600 transition cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteTarget(emp);
                          setDeleteError('');
                        }}
                        title="حذف"
                        className="p-1.5 rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isFormOpen && (
        <Modal
          title={editing ? 'تعديل بيانات موظف' : 'إضافة موظف جديد'}
          subtitle="بيانات الموظف ووظيفته ومرتبه وقواعد تطبيق الخصم"
          onClose={closeForm}
          maxWidthClass="max-w-2xl"
        >
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>اسم الموظف *</label>
                <input
                  value={form.name}
                  onChange={(event) => updateForm({ name: event.target.value })}
                  placeholder="الاسم رباعي"
                  className={inputClass}
                  autoFocus
                />
              </div>
              <div>
                <label className={labelClass}>كود الموظف / ID البصمة</label>
                <input
                  value={form.employee_code}
                  onChange={(event) => updateForm({ employee_code: event.target.value })}
                  placeholder="مثال: 1001"
                  className={`${inputClass} font-mono`}
                />
                <p className="text-[10px] font-bold text-slate-400 mt-1">
                  اتركه فارغاً ليتم توليد كود تلقائي، ويجب أن يطابق رقم المستخدم على ماكينة البصمة.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>الوظيفة *</label>
                <select
                  value={form.job_id}
                  onChange={(event) => updateForm({ job_id: event.target.value })}
                  className={inputClass}
                >
                  <option value="">اختر الوظيفة</option>
                  {jobTitles.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.title} - {HR_DEPARTMENT_LABELS[job.department] || job.department}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>المرتب الشهري (ج.م) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.monthly_salary}
                  onChange={(event) => updateForm({ monthly_salary: event.target.value })}
                  placeholder="0.00"
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>

            {currentUserRank !== 3 && (
              <div>
                <label className={labelClass}>الرتبة الهرمية للموظف</label>
                <select
                  value={form.rank_level}
                  onChange={(event) => updateForm({ rank_level: Number(event.target.value) })}
                  className={inputClass}
                >
                  {rankOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} — {opt.description}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className={labelClass}>طريقة تطبيق قواعد التأخير والخصم</label>
              <select
                value={form.rule_application_mode}
                onChange={(event) =>
                  updateForm({
                    rule_application_mode: event.target.value as HRRuleApplicationMode
                  })
                }
                className={inputClass}
              >
                <option value="auto">{RULE_APPLICATION_LABELS.auto}</option>
                <option value="manual_review">{RULE_APPLICATION_LABELS.manual_review}</option>
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>الرقم القومي</label>
                <input
                  value={form.national_id}
                  onChange={(event) => updateForm({ national_id: event.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className={labelClass}>الهاتف</label>
                <input
                  value={form.phone}
                  onChange={(event) => updateForm({ phone: event.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className={labelClass}>تاريخ الميلاد</label>
                <input
                  type="date"
                  value={form.birth_date}
                  onChange={(event) => updateForm({ birth_date: event.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>رابط صورة الموظف (اختياري)</label>
              <input
                value={form.photo}
                onChange={(event) => updateForm({ photo: event.target.value })}
                placeholder="https://..."
                className={`${inputClass} font-mono`}
                dir="ltr"
              />
            </div>

            <div>
              <label className={labelClass}>ملاحظات</label>
              <textarea
                value={form.notes}
                onChange={(event) => updateForm({ notes: event.target.value })}
                rows={2}
                className={inputClass}
                placeholder="أي ملاحظات إدارية عن الموظف..."
              />
            </div>

            <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) => updateForm({ is_active: event.target.checked })}
                className="w-4 h-4 accent-purple-600"
              />
              <span className="text-[11px] font-black text-slate-700">
                الموظف نشط (يظهر في الحضور ومسير المرتبات)
              </span>
            </label>

            <ErrorNote message={formError} />

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeForm}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-black hover:bg-slate-200 transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white text-[11px] font-black hover:bg-purple-700 transition cursor-pointer disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                {isSaving ? 'جاري الحفظ...' : 'حفظ بيانات الموظف'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          title="تأكيد حذف الموظف"
          subtitle="لا يمكن التراجع عن هذه العملية"
          onClose={() => {
            setDeleteTarget(null);
            setDeleteError('');
          }}
          maxWidthClass="max-w-2xl"
        >
          <div className="space-y-3">
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-bold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                سيتم حذف الموظف <strong>{deleteTarget.name}</strong> مع سجلات الحضور والجزاءات
                والسُلف المرتبطة به.
              </span>
            </div>
            <ErrorNote message={deleteError} />
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteError('');
                }}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-black hover:bg-slate-200 transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={isDeleting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 text-white text-[11px] font-black hover:bg-rose-700 transition cursor-pointer disabled:opacity-60"
              >
                <Trash2 className="w-4 h-4" />
                {isDeleting ? 'جاري الحذف...' : 'حذف الموظف'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};










const AttendanceRulesPanel: React.FC<{
  settings: HRAttendanceSettings | null;
  isLoading: boolean;
  onRefresh: () => void | Promise<void>;
}> = ({ settings, isLoading, onRefresh }) => {
  const { addFlashMessage, logAction } = useApp();

  const [startTime, setStartTime] = useState('08:30');
  const [endTime, setEndTime] = useState('17:30');
  const [weeklyOff, setWeeklyOff] = useState<HRWeekDayKey>('Sunday');
  const [rules, setRules] = useState<HRAttendanceRule[]>([]);
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setStartTime(settings.official_start_time || '08:30');
    setEndTime(settings.official_end_time || '17:30');
    setWeeklyOff(settings.weekly_off_day || 'Sunday');
    setRules(Array.isArray(settings.rules_json) ? settings.rules_json : []);
  }, [settings]);

  const updateRule = (index: number, patch: Partial<HRAttendanceRule>) => {
    setRules((prev) => prev.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  };

  const addRule = () => {
    setRules((prev) => [
      ...prev,
      {
        id: `hr-rule-${Date.now()}`,
        violation_type: 'late_arrival',
        label: 'قاعدة تأخير جديدة',
        from_minutes: 0,
        to_minutes: 15,
        until_time: '',
        deduction_type: 'hours',
        deduction_value: 0.25,
        apply_mode: 'manual_review'
      }
    ]);
  };

  const removeRule = (index: number) => {
    setRules((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!startTime || !endTime) {
      setFormError('يرجى تحديد مواعيد الحضور والانصراف الرسمية');
      return;
    }
    if (startTime >= endTime) {
      setFormError('موعد الحضور الرسمي يجب أن يسبق موعد الانصراف الرسمي');
      return;
    }
    if (rules.some((rule) => !Number(rule.deduction_value) || Number(rule.deduction_value) <= 0)) {
      setFormError('قيمة الخصم في كل قاعدة يجب أن تكون أكبر من صفر');
      return;
    }

    setIsSaving(true);
    setFormError('');
    try {
      await api.updateHRAttendanceSettings({
        official_start_time: startTime,
        official_end_time: endTime,
        weekly_off_day: weeklyOff,
        month_calculation_days: 30,
        rules_json: rules.map((rule) => ({
          ...rule,
          from_minutes: Number(rule.from_minutes) || 0,
          to_minutes: Number(rule.to_minutes) || 0,
          deduction_value: Number(rule.deduction_value) || 0
        }))
      });
      addFlashMessage('تم حفظ قواعد الحضور والانصراف بنجاح');
      logAction('الموارد البشرية', 'تحديث قواعد الحضور والانصراف العامة');
      await onRefresh();
    } catch (err: any) {
      setFormError(err?.message || 'فشل حفظ قواعد الحضور والانصراف');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-black text-slate-900">المواعيد الرسمية للعمل</h2>
            <p className="text-[11px] font-bold text-slate-500 mt-0.5">
              تُطبق هذه المواعيد على كل الموظفين ما لم يتم استثناؤهم بقواعد خاصة داخل سجل الحضور.
            </p>
          </div>
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>موعد الحضور الرسمي</label>
            <input
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              className={`${inputClass} font-mono`}
            />
          </div>
          <div>
            <label className={labelClass}>موعد الانصراف الرسمي</label>
            <input
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              className={`${inputClass} font-mono`}
            />
          </div>
          <div>
            <label className={labelClass}>يوم الإجازة الأسبوعية المدفوعة</label>
            <select
              value={weeklyOff}
              onChange={(event) => setWeeklyOff(event.target.value as HRWeekDayKey)}
              className={inputClass}
            >
              {HR_WEEK_DAYS.map((day) => (
                <option key={day.key} value={day.key}>
                  {day.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mx-4 mb-4 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-[11px] font-bold">
          <Info className="w-4 h-4 shrink-0" />
          <span>
            الشهر الحسابي ثابت دائماً 30 يوماً، وراتب اليوم = المرتب الشهري ÷ 30، وراتب الساعة = راتب
            اليوم ÷ 8 ساعات.
          </span>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-slate-900">
              قواعد التأخير والانصراف المبكر والغياب
            </h2>
            <p className="text-[11px] font-bold text-slate-500 mt-0.5">
              كل قاعدة تحدد شريحة التأخير أو الانصراف ومقدار الخصم وطريقة تطبيقه.
            </p>
          </div>
          <button
            type="button"
            onClick={addRule}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white text-[11px] font-black hover:bg-purple-700 transition cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            إضافة قاعدة
          </button>
        </div>

        {isLoading ? (
          <div className="p-10 text-center text-xs font-bold text-slate-400">جاري التحميل...</div>
        ) : rules.length === 0 ? (
          <div className="p-10 text-center">
            <Coffee className="w-8 h-8 mx-auto text-slate-300 mb-2" />
            <p className="text-xs font-black text-slate-700">لا توجد قواعد مسجلة</p>
            <p className="text-[11px] font-bold text-slate-500 mt-1">
              أضف قاعدة جديدة لتحديد خصم التأخير أو الانصراف المبكر أو الغياب.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rules.map((rule, index) => (
              <div key={`${rule.id}-${index}`} className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-slate-100 text-slate-600 text-[10px] font-black flex items-center justify-center">
                      {index + 1}
                    </span>
                    <span className="text-[11px] font-black text-slate-800">
                      {VIOLATION_LABELS[rule.violation_type] || rule.violation_type}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        rule.apply_mode === 'manual_review'
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      }`}
                    >
                      {APPLY_MODE_LABELS[rule.apply_mode] || APPLY_MODE_LABELS.auto}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeRule(index)}
                    title="حذف القاعدة"
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className={labelClass}>نوع المخالفة</label>
                    <select
                      value={rule.violation_type}
                      onChange={(event) =>
                        updateRule(index, {
                          violation_type: event.target.value as HRRuleViolationType
                        })
                      }
                      className={inputClass}
                    >
                      <option value="late_arrival">{VIOLATION_LABELS.late_arrival}</option>
                      <option value="early_departure">{VIOLATION_LABELS.early_departure}</option>
                      <option value="absence">{VIOLATION_LABELS.absence}</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>وصف القاعدة</label>
                    <input
                      value={rule.label || ''}
                      onChange={(event) => updateRule(index, { label: event.target.value })}
                      placeholder="مثال: تأخير حتى 15 دقيقة"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>طريقة التطبيق</label>
                    <select
                      value={rule.apply_mode}
                      onChange={(event) =>
                        updateRule(index, { apply_mode: event.target.value as HRRuleApplyMode })
                      }
                      className={inputClass}
                    >
                      <option value="auto">{APPLY_MODE_LABELS.auto}</option>
                      <option value="manual_review">{APPLY_MODE_LABELS.manual_review}</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className={labelClass}>من (دقيقة)</label>
                    <input
                      type="number"
                      min="0"
                      value={rule.from_minutes ?? 0}
                      onChange={(event) =>
                        updateRule(index, { from_minutes: Number(event.target.value) })
                      }
                      disabled={rule.violation_type === 'absence'}
                      className={`${inputClass} font-mono disabled:bg-slate-100 disabled:text-slate-400`}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>إلى (دقيقة)</label>
                    <input
                      type="number"
                      min="0"
                      value={rule.to_minutes ?? 0}
                      onChange={(event) =>
                        updateRule(index, { to_minutes: Number(event.target.value) })
                      }
                      disabled={rule.violation_type === 'absence'}
                      className={`${inputClass} font-mono disabled:bg-slate-100 disabled:text-slate-400`}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>وحدة الخصم</label>
                    <select
                      value={rule.deduction_type}
                      onChange={(event) =>
                        updateRule(index, {
                          deduction_type: event.target.value as HRRuleDeductionType
                        })
                      }
                      className={inputClass}
                    >
                      <option value="hours">{DEDUCTION_LABELS.hours}</option>
                      <option value="days">{DEDUCTION_LABELS.days}</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>قيمة الخصم</label>
                    <input
                      type="number"
                      min="0"
                      step="0.25"
                      value={rule.deduction_value}
                      onChange={(event) =>
                        updateRule(index, { deduction_value: Number(event.target.value) })
                      }
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/60 space-y-3">
          <ErrorNote message={formError} />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <p className="text-[11px] font-bold text-slate-500">
              يتم احتساب الخصومات من هذه القواعد داخل سجل الحضور ثم تُخصم في مسير المرتبات.
            </p>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-[11px] font-black hover:bg-emerald-700 transition cursor-pointer disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'جاري الحفظ...' : 'حفظ القواعد'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface AttendanceRecordForm {
  employee_id: string;
  date: string;
  check_in: string;
  check_out: string;
  status: HRAttendanceStatus;
  is_excused: boolean;
  excuse_note: string;
  calculated_deduction_days: string;
  calculated_deduction_hours: string;
  review_status: HRReviewStatus;
}

const emptyRecordForm = (employeeId: string): AttendanceRecordForm => ({
  employee_id: employeeId,
  date: todayISO(),
  check_in: '08:30',
  check_out: '17:30',
  status: 'present',
  is_excused: false,
  excuse_note: '',
  calculated_deduction_days: '0',
  calculated_deduction_hours: '0',
  review_status: 'auto_applied'
});

/** بطاقة إحصاء صغيرة أعلى شاشة سجل الحضور والانصراف. */
const AttendanceStatCard: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone: 'slate' | 'emerald' | 'rose' | 'amber' | 'blue' | 'indigo';
  icon: React.ReactNode;
}> = ({ label, value, hint, tone, icon }) => {
  const tones: Record<string, string> = {
    slate: 'bg-white border-slate-200 text-slate-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    rose: 'bg-rose-50 border-rose-200 text-rose-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700'
  };

  return (
    <div className={`rounded-2xl border p-3 ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-black tracking-wide opacity-80">{label}</p>
        {icon}
      </div>
      <p className="mt-1 text-lg font-black font-mono leading-none">{value}</p>
      {hint ? <p className="mt-1 text-[10px] font-bold opacity-70">{hint}</p> : null}
    </div>
  );
};

const AttendanceRecordsPanel: React.FC<{ employees: HREmployee[] }> = ({ employees }) => {
  const { addFlashMessage, logAction } = useApp();

  const [records, setRecords] = useState<HRAttendanceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [month, setMonth] = useState(currentMonth());
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<HRAttendanceRecord | null>(null);
  const [form, setForm] = useState<AttendanceRecordForm>(emptyRecordForm(''));
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<HRAttendanceRecord | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  // عرض السجل اليومي (بالأيام) أو حسب الموظف
  const [viewMode, setViewMode] = useState<'day' | 'employee'>('day');
  const [selectedDay, setSelectedDay] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState('');

  // إحصاءات السيرفر لبطاقات أعلى الشاشة
  const [stats, setStats] = useState<HRAttendanceStats | null>(null);

  // شيت البصمة (تحميل القالب / رفع الشيت)
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<{ row: number; message: string }[]>([]);

  // إدخال بصمة يدوية / تسجيل عذر
  const [timeTarget, setTimeTarget] = useState<HRAttendanceRecord | null>(null);
  const [timeForm, setTimeForm] = useState({ check_in: '', check_out: '' });
  const [timeError, setTimeError] = useState('');
  const [isSavingTime, setIsSavingTime] = useState(false);
  const [excuseTarget, setExcuseTarget] = useState<HRAttendanceRecord | null>(null);
  const [excuseNote, setExcuseNote] = useState('');
  const [excuseError, setExcuseError] = useState('');
  const [isSavingExcuse, setIsSavingExcuse] = useState(false);

  const loadRecords = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getHRAttendanceRecords();
      setRecords(Array.isArray(res) ? res : []);
    } catch (err: any) {
      addFlashMessage(err?.message || 'فشل تحميل سجل الحضور من السيرفر', 'danger');
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  const loadStats = useCallback(async () => {
    try {
      const res = await api.getHRAttendanceStats(month);
      setStats((res as HRAttendanceStats) || null);
    } catch {
      // بطاقات الإحصاءات اختيارية ولا يجب أن تعطل الشاشة عند تعذر تحميلها
      setStats(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  // إعادة تصفير اختيار اليوم/الموظف عند تغيير الشهر حتى لا تبقى تصفية قديمة.
  useEffect(() => {
    setSelectedDay('');
    setSelectedEmployee('');
  }, [month]);

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      if (month && !(record.date || '').startsWith(month)) return false;
      if (employeeFilter && record.employee_id !== employeeFilter) return false;
      if (statusFilter && record.status !== statusFilter) return false;
      return true;
    });
  }, [records, month, employeeFilter, statusFilter]);

  const summary = useMemo(() => {
    let absents = 0;
    let pending = 0;
    let present = 0;
    let deductionHours = 0;
    let deductionDays = 0;
    filteredRecords.forEach((record) => {
      if (record.status === 'present') present += 1;
      if (record.status === 'absent') absents += 1;
      if (record.review_status === 'pending_review') pending += 1;
      deductionHours += Number(record.calculated_deduction_hours) || 0;
      deductionDays += Number(record.calculated_deduction_days) || 0;
    });
    return { present, absents, pending, deductionHours, deductionDays };
  }, [filteredRecords]);

  // نسبة التزام بديلة تُحسب محلياً في حال تعذر جلب إحصاءات السيرفر.
  const localCompliance = filteredRecords.length
    ? Math.round((summary.present / filteredRecords.length) * 100)
    : 0;

  // السجلات المعروضة فعلياً حسب نمط العرض (يومي / حسب الموظف)
  const visibleRecords = useMemo(() => {
    let list = filteredRecords;
    if (viewMode === 'day' && selectedDay) {
      list = list.filter((record) => record.date === selectedDay);
    }
    if (viewMode === 'employee' && selectedEmployee) {
      list = list.filter((record) => record.employee_id === selectedEmployee);
    }
    return list;
  }, [filteredRecords, viewMode, selectedDay, selectedEmployee]);

  // تجميع السجلات على الأيام (عرض اليوم الواحد)
  const dayGroups = useMemo(() => {
    const map = new Map<
      string,
      { date: string; total: number; present: number; absent: number; missingPunch: number; pending: number }
    >();
    filteredRecords.forEach((record) => {
      const key = record.date || '';
      if (!key) return;
      const bucket =
        map.get(key) ||
        { date: key, total: 0, present: 0, absent: 0, missingPunch: 0, pending: 0 };
      bucket.total += 1;
      if (record.status === 'present') bucket.present += 1;
      if (record.status === 'absent') bucket.absent += 1;
      if (record.status === 'missing_punch') bucket.missingPunch += 1;
      if (record.review_status === 'pending_review') bucket.pending += 1;
      map.set(key, bucket);
    });
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [filteredRecords]);

  // تجميع السجلات حسب الموظف (عرض الموظفين)
  const employeeGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        employeeId: string;
        name: string;
        code: string;
        total: number;
        absent: number;
        missingPunch: number;
        pending: number;
        deductionDays: number;
        deductionHours: number;
      }
    >();
    filteredRecords.forEach((record) => {
      const employee = employees.find((item) => item.id === record.employee_id);
      const key = record.employee_id;
      const bucket =
        map.get(key) ||
        {
          employeeId: key,
          name: record.employee_name || employee?.name || '-',
          code: record.employee_code || employee?.employee_code || '-',
          total: 0,
          absent: 0,
          missingPunch: 0,
          pending: 0,
          deductionDays: 0,
          deductionHours: 0
        };
      bucket.total += 1;
      if (record.status === 'absent') bucket.absent += 1;
      if (record.status === 'missing_punch') bucket.missingPunch += 1;
      if (record.review_status === 'pending_review') bucket.pending += 1;
      bucket.deductionDays += Number(record.calculated_deduction_days) || 0;
      bucket.deductionHours += Number(record.calculated_deduction_hours) || 0;
      map.set(key, bucket);
    });
    return Array.from(map.values()).sort(
      (a, b) => b.absent - a.absent || a.name.localeCompare(b.name)
    );
  }, [filteredRecords, employees]);

  // تفصيل شهري للموظف المختار في عرض الموظفين
  const monthlyBreakdown = useMemo(() => {
    if (viewMode !== 'employee' || !selectedEmployee) return [];
    const map = new Map<
      string,
      { month: string; total: number; present: number; absent: number; missing: number; days: number; hours: number }
    >();
    filteredRecords
      .filter((record) => record.employee_id === selectedEmployee)
      .forEach((record) => {
        const key = (record.date || '').slice(0, 7);
        if (!key) return;
        const bucket =
          map.get(key) ||
          { month: key, total: 0, present: 0, absent: 0, missing: 0, days: 0, hours: 0 };
        bucket.total += 1;
        if (record.status === 'present') bucket.present += 1;
        if (record.status === 'absent') bucket.absent += 1;
        if (record.status === 'missing_punch') bucket.missing += 1;
        bucket.days += Number(record.calculated_deduction_days) || 0;
        bucket.hours += Number(record.calculated_deduction_hours) || 0;
        map.set(key, bucket);
      });
    return Array.from(map.values()).sort((a, b) => b.month.localeCompare(a.month));
  }, [filteredRecords, selectedEmployee, viewMode]);

  const updateForm = (patch: Partial<AttendanceRecordForm>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  const openCreate = () => {
    setEditing(null);
    setForm(emptyRecordForm(employees[0]?.id || ''));
    setFormError('');
    setIsFormOpen(true);
  };

  const openEdit = (record: HRAttendanceRecord) => {
    setEditing(record);
    setForm({
      employee_id: record.employee_id,
      date: record.date || todayISO(),
      check_in: record.check_in || '',
      check_out: record.check_out || '',
      status: record.status || 'present',
      is_excused: !!record.is_excused,
      excuse_note: record.excuse_note || '',
      calculated_deduction_days: String(record.calculated_deduction_days ?? 0),
      calculated_deduction_hours: String(record.calculated_deduction_hours ?? 0),
      review_status: record.review_status || 'auto_applied'
    });
    setFormError('');
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditing(null);
    setFormError('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.employee_id) {
      setFormError('يرجى اختيار الموظف');
      return;
    }
    if (!form.date) {
      setFormError('تاريخ السجل مطلوب');
      return;
    }

    setIsSaving(true);
    setFormError('');
    const payload: any = {
      employee_id: form.employee_id,
      date: form.date,
      check_in: form.check_in || null,
      check_out: form.check_out || null,
      status: form.status,
      is_excused: form.is_excused,
      excuse_note: form.excuse_note.trim(),
      calculated_deduction_days: Number(form.calculated_deduction_days) || 0,
      calculated_deduction_hours: Number(form.calculated_deduction_hours) || 0,
      review_status: form.review_status
    };

    try {
      if (editing) {
        await api.updateHRAttendanceRecord(editing.id, payload);
        addFlashMessage('تم تعديل سجل الحضور بنجاح');
        logAction('الموارد البشرية', `تعديل سجل حضور بتاريخ ${form.date}`);
      } else {
        await api.createHRAttendanceRecord(payload);
        addFlashMessage('تم إضافة سجل الحضور بنجاح');
        logAction('الموارد البشرية', `إضافة سجل حضور بتاريخ ${form.date}`);
      }
      closeForm();
      await loadRecords();
    } catch (err: any) {
      setFormError(err?.message || 'فشل حفظ سجل الحضور');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError('');
    try {
      await api.deleteHRAttendanceRecord(deleteTarget.id);
      addFlashMessage('تم حذف سجل الحضور بنجاح');
      logAction('الموارد البشرية', `حذف سجل حضور بتاريخ ${deleteTarget.date}`);
      setDeleteTarget(null);
      await loadRecords();
    } catch (err: any) {
      setDeleteError(err?.message || 'فشل حذف سجل الحضور');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleReview = async (record: HRAttendanceRecord, reviewStatus: HRReviewStatus) => {
    try {
      const payload: Record<string, unknown> = { review_status: reviewStatus };
      if (reviewStatus === 'rejected') {
        // رفض الخصم يعني عدم تطبيقه على المرتب.
        payload.calculated_deduction_days = 0;
        payload.calculated_deduction_hours = 0;
      }
      await api.updateHRAttendanceRecord(record.id, payload);
      addFlashMessage(
        reviewStatus === 'approved' ? 'تم اعتماد الخصم المحتسب' : 'تم رفض الخصم المحتسب'
      );
      logAction(
        'الموارد البشرية',
        `${reviewStatus === 'approved' ? 'اعتماد' : 'رفض'} خصم حضور للموظف ${
          record.employee_name || record.employee_code || ''
        }`
      );
      await Promise.all([loadRecords(), loadStats()]);
    } catch (err: any) {
      addFlashMessage(err?.message || 'فشل تحديث حالة المراجعة', 'danger');
    }
  };

  // تحميل قالب البصمة الفارغ (CSV) للشهر المختار
  const handleDownloadTemplate = async () => {
    setIsDownloading(true);
    try {
      const blob = await api.downloadHRAttendanceTemplate(month);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `attendance_template_${month || currentMonth()}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      addFlashMessage('تم تحميل قالب البصمة الفارغ، املأ أوقات الحضور والانصراف ثم ارفعه مرة أخرى');
      logAction('الموارد البشرية', `تحميل قالب بصمة شهر ${month}`);
    } catch (err: any) {
      addFlashMessage(err?.message || 'فشل تحميل قالب البصمة', 'danger');
    } finally {
      setIsDownloading(false);
    }
  };

  // رفع شيت البصمة واحتساب التأخير والغياب تلقائياً
  const handleSheetSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setIsUploading(true);
    setUploadErrors([]);
    try {
      const result = (await api.uploadHRAttendanceSheet(file, month)) as HRAttendanceImportResult;
      setUploadErrors(result.errors || []);
      const parts = [
        `${result.imported} سجل جديد`,
        `${result.updated} تحديث`,
        `${result.pending_review} بانتظار المراجعة`
      ];
      if (result.skipped) {
        parts.push(`${result.skipped} صف فارغ تم تجاهله`);
      }
      if (result.error_count) {
        parts.push(`${result.error_count} صف به أخطاء`);
      }
      addFlashMessage(`تم رفع الشيت: ${parts.join(' — ')}`);
      logAction('الموارد البشرية', `رفع شيت بصمة ${file.name}`);
      await Promise.all([loadRecords(), loadStats()]);
    } catch (err: any) {
      addFlashMessage(err?.message || 'فشل رفع شيت البصمة', 'danger');
    } finally {
      setIsUploading(false);
    }
  };

  // طباعة تقرير حضور يومي (يعتمد على السجلات المعروضة حالياً)
  const handlePrintDailyReport = () => {
    const list = [...visibleRecords].sort((a, b) => a.date.localeCompare(b.date));
    if (list.length === 0) {
      addFlashMessage('لا توجد سجلات لطباعتها', 'danger');
      return;
    }
    const rowsHtml = list
      .map((record) => {
        const employee = employees.find((item) => item.id === record.employee_id);
        return `<tr>
          <td>${record.date}</td>
          <td>${record.employee_name || employee?.name || '-'}</td>
          <td>${record.employee_code || employee?.employee_code || '-'}</td>
          <td>${record.check_in || '—'}</td>
          <td>${record.check_out || '—'}</td>
          <td>${ATTENDANCE_STATUS_LABELS[record.status] || record.status}</td>
          <td>${Number(record.calculated_deduction_days) || 0} يوم / ${Number(record.calculated_deduction_hours) || 0} ساعة</td>
        </tr>`;
      })
      .join('');
    const title = selectedDay
      ? `تقرير حضور يوم ${formatDayLabel(selectedDay)}`
      : `تقرير حضور شهر ${month}`;
    const win = window.open('', '_blank', 'width=1000,height=700');
    if (!win) {
      addFlashMessage('فضلاً اسمح بالنوافذ المنبثقة لطباعة التقرير', 'danger');
      return;
    }
    win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8" />
      <title>${title}</title>
      <style>
        body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#0f172a}
        h1{font-size:18px;margin:0 0 4px}
        p.meta{font-size:12px;color:#64748b;margin:0 0 16px}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:center}
        th{background:#f1f5f9}
      </style></head><body>
      <h1>${title}</h1>
      <p class="meta">عدد السجلات: ${list.length} — حضور: ${summary.present} — غياب: ${summary.absents} — بانتظار المراجعة: ${summary.pending}</p>
      <table><thead><tr><th>التاريخ</th><th>الموظف</th><th>الكود</th><th>الحضور</th><th>الانصراف</th><th>الحالة</th><th>الخصم</th></tr></thead>
      <tbody>${rowsHtml}</tbody></table>
      </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  // إدخال بصمة يدوية لم تُسجل على الماكينة
  const openManualTime = (record: HRAttendanceRecord) => {
    setTimeTarget(record);
    setTimeForm({
      check_in: (record.check_in || '').slice(0, 5),
      check_out: (record.check_out || '').slice(0, 5)
    });
    setTimeError('');
  };

  const handleSaveManualTime = async () => {
    if (!timeTarget) return;
    if (!timeForm.check_in && !timeForm.check_out) {
      setTimeError('أدخل بصمة الحضور أو الانصراف على الأقل');
      return;
    }
    setIsSavingTime(true);
    setTimeError('');
    try {
      await api.updateHRAttendanceRecord(timeTarget.id, {
        check_in: timeForm.check_in || null,
        check_out: timeForm.check_out || null,
        recalculate: true
      });
      addFlashMessage('تم تسجيل البصمة اليدوية وإعادة احتساب التأخير');
      logAction('الموارد البشرية', `إدخال بصمة يدوية بتاريخ ${timeTarget.date}`);
      setTimeTarget(null);
      await Promise.all([loadRecords(), loadStats()]);
    } catch (err: any) {
      setTimeError(err?.message || 'فشل حفظ البصمة اليدوية');
    } finally {
      setIsSavingTime(false);
    }
  };

  // تسجيل عذر (يلغي الخصم المحتسب) أو إلغاؤه
  const openExcuse = (record: HRAttendanceRecord) => {
    setExcuseTarget(record);
    setExcuseNote(record.excuse_note || '');
    setExcuseError('');
  };

  const handleSaveExcuse = async (remove = false) => {
    if (!excuseTarget) return;
    if (!remove && !excuseNote.trim()) {
      setExcuseError('اكتب سبب العذر قبل الحفظ');
      return;
    }
    setIsSavingExcuse(true);
    setExcuseError('');
    try {
      await api.updateHRAttendanceRecord(excuseTarget.id, {
        is_excused: !remove,
        excuse_note: remove ? '' : excuseNote.trim(),
        recalculate: true
      });
      addFlashMessage(remove ? 'تم إلغاء العذر وإعادة الخصم' : 'تم تسجيل العذر وإلغاء الخصم');
      logAction(
        'الموارد البشرية',
        `${remove ? 'إلغاء' : 'تسجيل'} عذر حضور بتاريخ ${excuseTarget.date}`
      );
      setExcuseTarget(null);
      await Promise.all([loadRecords(), loadStats()]);
    } catch (err: any) {
      setExcuseError(err?.message || 'فشل حفظ العذر');
    } finally {
      setIsSavingExcuse(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-slate-900">سجل الحضور والانصراف</h2>
          <p className="text-[11px] font-bold text-slate-500 mt-0.5">
            سجلات البصمة اليومية وخصومات التأخير، مع مراجعة يدوية قبل الخصم من المرتب عند الحاجة.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* زرّي الإكسيل ملتصقين: تحميل قالب فارغ + رفع شيت البصمة وتفريغه بالـ ID */}
          <div className="inline-flex rounded-xl overflow-hidden border border-slate-200 shadow-xs">
            <button
              type="button"
              onClick={() => void handleDownloadTemplate()}
              disabled={isDownloading}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-white text-slate-700 text-[11px] font-black hover:bg-slate-50 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border-l border-slate-200"
            >
              {isDownloading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              تحميل قالب فارغ
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-600 text-white text-[11px] font-black hover:bg-emerald-700 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUploading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              رفع شيت البصمة وتفريغه بالـ ID
            </button>
          </div>
          <button
            type="button"
            onClick={handlePrintDailyReport}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 text-white text-[11px] font-black hover:bg-indigo-700 transition cursor-pointer"
          >
            <FileText className="w-4 h-4" />
            طباعة تقرير حضور يومي
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white text-[11px] font-black hover:bg-purple-700 transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            إضافة سجل يدوي
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => void handleSheetSelected(event)}
            className="hidden"
          />
        </div>
      </div>

      <div className="p-4 bg-slate-50/60 border-b border-slate-100 grid grid-cols-1 md:grid-cols-3 gap-2">
        <input
          type="month"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
          className={`${inputClass} font-mono`}
        />
        <select
          value={employeeFilter}
          onChange={(event) => setEmployeeFilter(event.target.value)}
          className={inputClass}
        >
          <option value="">كل الموظفين</option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.name} ({employee.employee_code})
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className={inputClass}
        >
          <option value="">كل الحالات</option>
          {(Object.keys(ATTENDANCE_STATUS_LABELS) as HRAttendanceStatus[]).map((key) => (
            <option key={key} value={key}>
              {ATTENDANCE_STATUS_LABELS[key]}
            </option>
          ))}
        </select>
      </div>

      {/* تنبيه بقواعد الشيت */}
      <div className="px-4 pt-3">
        <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-[11px] font-bold">
          <Info className="w-4 h-4 shrink-0" />
          <span>
            قالب البصمة يُملأ لكل أيام العمل ويُرفع بصيغة CSV أو XLSX. الصفوف الفارغة (بدون بصمات) تُتجاهل
            عند الرفع، فسجّل الغياب من عمود «الحالة» داخل الشيت أو من «إضافة سجل يدوي». ويُحوَّل السجل
            للمراجعة اليدوية تلقائياً عند البصمة الناقصة أو التأخير الكبير أو الغياب حسب قواعد الحضور.
          </span>
        </div>
      </div>

      {/* بطاقات الإحصاءات الثلاث: الالتزام — متوسط الغياب اليومي — أكثر قسم غياب */}
      <div className="px-4 pt-4 grid grid-cols-1 md:grid-cols-3 gap-2">
        <AttendanceStatCard
          label="نسبة الالتزام"
          value={`${stats?.compliance_percent ?? localCompliance}%`}
          hint={`${stats?.present ?? summary.present} حضور من ${stats?.total_records ?? filteredRecords.length}`}
          tone="emerald"
          icon={<CheckCircle2 className="w-4 h-4" />}
        />
        <AttendanceStatCard
          label="متوسط الغياب اليومي"
          value={stats?.average_daily_absence ?? 0}
          hint={`إجمالي أيام الغياب: ${stats?.absent ?? summary.absents}`}
          tone="rose"
          icon={<AlertTriangle className="w-4 h-4" />}
        />
        <AttendanceStatCard
          label="أكثر قسم فيه غياب"
          value={stats?.worst_department?.label || '—'}
          hint={
            stats?.worst_department
              ? `${stats.worst_department.absent} غياب من ${stats.worst_department.total} سجل (${stats.worst_department.rate}%)`
              : 'لا توجد بيانات كافية'
          }
          tone="indigo"
          icon={<Building2 className="w-4 h-4" />}
        />
      </div>

      {uploadErrors.length > 0 && (
        <div className="mx-4 mt-3 p-3 rounded-2xl bg-rose-50 border border-rose-200">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] font-black text-rose-700">
              صفوف لم يتم استيرادها من الشيت ({uploadErrors.length})
            </p>
            <button
              type="button"
              onClick={() => setUploadErrors([])}
              className="p-1 rounded-lg text-rose-500 hover:bg-rose-100 transition cursor-pointer"
              title="إخفاء"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <ul className="mt-1.5 space-y-1 max-h-32 overflow-y-auto">
            {uploadErrors.map((error, index) => (
              <li
                key={`${error.row}-${index}`}
                className="text-[11px] font-bold text-rose-700 flex items-center gap-1.5"
              >
                <XCircle className="w-3 h-3 shrink-0" />
                صف {error.row}: {error.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* التبديل بين عرض اليوم الواحد وعرض الموظف */}
      <div className="px-4 pt-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex p-0.5 rounded-xl bg-slate-100 border border-slate-200">
          <button
            type="button"
            onClick={() => setViewMode('day')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black transition cursor-pointer ${
              viewMode === 'day'
                ? 'bg-white text-purple-700 shadow-xs'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <LayoutList className="w-3.5 h-3.5" />
            عرض يومي
          </button>
          <button
            type="button"
            onClick={() => setViewMode('employee')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black transition cursor-pointer ${
              viewMode === 'employee'
                ? 'bg-white text-purple-700 shadow-xs'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <UsersRound className="w-3.5 h-3.5" />
            عرض الموظفين
          </button>
        </div>

        {viewMode === 'day' ? (
          <select
            value={selectedDay}
            onChange={(event) => setSelectedDay(event.target.value)}
            className={`${inputClass} md:w-56`}
          >
            <option value="">كل أيام الشهر</option>
            {dayGroups.map((group) => (
              <option key={group.date} value={group.date}>
                {formatDayLabel(group.date)} — {group.total} سجل
              </option>
            ))}
          </select>
        ) : (
          <select
            value={selectedEmployee}
            onChange={(event) => setSelectedEmployee(event.target.value)}
            className={`${inputClass} md:w-64`}
          >
            <option value="">كل الموظفين</option>
            {employeeGroups.map((group) => (
              <option key={group.employeeId} value={group.employeeId}>
                {group.name} ({group.code}) — {group.total} يوم
              </option>
            ))}
          </select>
        )}

        {(selectedDay || selectedEmployee) && (
          <button
            type="button"
            onClick={() => {
              setSelectedDay('');
              setSelectedEmployee('');
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-black text-slate-500 hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            إلغاء التصفية
          </button>
        )}
      </div>

      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-black text-slate-700">
          <CalendarDays className="w-3.5 h-3.5 text-purple-600" />
          السجلات المعروضة: {visibleRecords.length}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] font-black text-rose-700">
          <AlertTriangle className="w-3.5 h-3.5" />
          غياب: {summary.absents}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] font-black text-amber-700">
          <Clock className="w-3.5 h-3.5" />
          بانتظار المراجعة: {summary.pending}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 border border-blue-200 text-[11px] font-black text-blue-700">
          <Timer className="w-3.5 h-3.5" />
          خصم ساعات: {summary.deductionHours}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 border border-indigo-200 text-[11px] font-black text-indigo-700">
          <Banknote className="w-3.5 h-3.5" />
          خصم أيام: {summary.deductionDays}
        </span>
      </div>

      {/* ملخص الأيام في العرض اليومي */}
      {viewMode === 'day' && dayGroups.length > 0 && (
        <div className="px-4 pt-3 flex gap-2 overflow-x-auto pb-1">
          {dayGroups.slice(0, 14).map((group) => {
            const isActive = selectedDay === group.date;
            return (
              <button
                key={group.date}
                type="button"
                onClick={() => setSelectedDay(isActive ? '' : group.date)}
                className={`shrink-0 px-3 py-2 rounded-xl border text-right transition cursor-pointer ${
                  isActive
                    ? 'bg-purple-600 border-purple-600 text-white'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-purple-300'
                }`}
              >
                <p className="text-[11px] font-black whitespace-nowrap">
                  {formatDayLabel(group.date)}
                </p>
                <p
                  className={`text-[10px] font-bold whitespace-nowrap mt-0.5 ${
                    isActive ? 'text-purple-100' : 'text-slate-500'
                  }`}
                >
                  {group.present} حضور • {group.absent} غياب
                  {group.pending > 0 ? ` • ${group.pending} مراجعة` : ''}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {/* تفصيل شهري للموظف المختار في عرض الموظفين */}
      {viewMode === 'employee' && selectedEmployee && monthlyBreakdown.length > 0 && (
        <div className="px-4 pt-3 flex flex-wrap gap-2">
          {monthlyBreakdown.map((row) => (
            <div key={row.month} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
              <p className="text-[11px] font-black text-slate-700 font-mono">{row.month}</p>
              <p className="text-[10px] font-bold text-slate-500">
                {row.present} حضور • {row.absent} غياب • {row.missing} بصمة ناقصة
              </p>
              <p className="text-[10px] font-bold text-indigo-600 font-mono">
                خصم: {row.days} يوم / {row.hours} ساعة
              </p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="p-10 text-center text-xs font-bold text-slate-400">جاري التحميل...</div>
      ) : visibleRecords.length === 0 ? (
        <div className="p-10 text-center">
          <Clock className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="text-xs font-black text-slate-700">لا توجد سجلات حضور مطابقة للاختيار الحالي</p>
          <p className="text-[11px] font-bold text-slate-500 mt-1">
            حمّل قالب البصمة الفارغ وارفعه بعد ملء الأوقات، أو أضف سجلاً يدوياً للمراجعة.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-right px-4 py-2.5 font-black whitespace-nowrap">التاريخ</th>
                <th className="text-right px-4 py-2.5 font-black whitespace-nowrap">الموظف</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">الحضور</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">الانصراف</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">الحالة</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">الخصم</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">المراجعة</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRecords.map((record) => {
                const employee = employees.find((item) => item.id === record.employee_id);
                return (
                  <tr key={record.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-mono font-bold text-slate-700 whitespace-nowrap">
                      <p>{record.date}</p>
                      <p className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                        {formatDayLabel(record.date)}
                        {(record.review_status === 'pending_review' ||
                          employee?.rule_application_mode === 'manual_review') && (
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500"
                            title="موظف بنظام المراجعة اليدوية"
                          />
                        )}
                      </p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="font-black text-slate-900">
                        {record.employee_name || employee?.name || '-'}
                      </p>
                      <p className="font-bold text-[10px] text-slate-400 font-mono">
                        {record.employee_code || employee?.employee_code || '-'}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-bold text-slate-600">
                      <span className={!record.check_in ? 'text-rose-500' : undefined}>
                        {record.check_in || '—'}
                      </span>
                      {!record.check_in && (
                        <p className="text-[9px] font-black text-rose-500 mt-0.5">نسيان بصمة</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-bold text-slate-600">
                      <span className={!record.check_out ? 'text-rose-500' : undefined}>
                        {record.check_out || '—'}
                      </span>
                      {!record.check_out && (
                        <p className="text-[9px] font-black text-rose-500 mt-0.5">نسيان بصمة</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black border ${
                          record.status === 'present'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : record.status === 'absent'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : record.status === 'missing_punch'
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-blue-50 text-blue-700 border-blue-200'
                        }`}
                      >
                        {ATTENDANCE_STATUS_LABELS[record.status] || record.status}
                      </span>
                      {record.is_excused && (
                        <p className="mt-1 text-[10px] font-bold text-slate-500">بعذر</p>
                      )}
                      {record.status === 'missing_punch' && (
                        <button
                          type="button"
                          onClick={() => openManualTime(record)}
                          className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-700 text-[9px] font-black hover:bg-amber-100 transition cursor-pointer"
                          title="نسيان بصمة — إدخال الوقت الناقص يدوياً"
                        >
                          <AlertTriangle className="w-3 h-3" />
                          نسيان بصمة — إدخال الوقت
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <p className="font-black text-slate-800 font-mono">
                        {Number(record.calculated_deduction_days) || 0} يوم
                      </p>
                      <p className="font-bold text-[10px] text-slate-500 font-mono">
                        {Number(record.calculated_deduction_hours) || 0} ساعة
                      </p>
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black border ${
                          record.review_status === 'pending_review'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : record.review_status === 'rejected'
                              ? 'bg-slate-100 text-slate-600 border-slate-200'
                              : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}
                      >
                        {REVIEW_STATUS_LABELS[record.review_status] || record.review_status}
                      </span>
                      {record.review_status === 'pending_review' && (
                        <div className="flex items-center justify-center gap-1 mt-1">
                          <button
                            type="button"
                            onClick={() => void handleReview(record, 'approved')}
                            className="px-2 py-0.5 rounded-md bg-emerald-600 text-white text-[10px] font-black hover:bg-emerald-700 transition cursor-pointer"
                          >
                            قبول الخصم
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleReview(record, 'rejected')}
                            className="px-2 py-0.5 rounded-md bg-rose-600 text-white text-[10px] font-black hover:bg-rose-700 transition cursor-pointer"
                          >
                            رفض الخصم
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => openManualTime(record)}
                          title="إدخال بصمة يدوية"
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition cursor-pointer"
                        >
                          <Timer className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openExcuse(record)}
                          title={record.is_excused ? 'تعديل / إلغاء العذر' : 'تسجيل عذر'}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black transition cursor-pointer ${
                            record.is_excused
                              ? 'text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100'
                              : 'text-slate-600 bg-slate-50 border border-slate-200 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200'
                          }`}
                        >
                          <FileText className="w-3 h-3" />
                          {record.is_excused ? 'إلغاء العذر' : 'تسجيل عذر'}
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(record)}
                          title="تعديل"
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-purple-50 hover:text-purple-600 transition cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError('');
                            setDeleteTarget(record);
                          }}
                          title="حذف"
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isFormOpen && (
        <Modal
          title={editing ? 'تعديل سجل حضور' : 'إضافة سجل حضور يدوي'}
          subtitle="يُحسب الخصم من قواعد الحضور، ويمكن تعديله يدوياً مع تسجيل حالة المراجعة"
          onClose={closeForm}
          maxWidthClass="max-w-2xl"
        >
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>الموظف *</label>
                <select
                  value={form.employee_id}
                  onChange={(event) => updateForm({ employee_id: event.target.value })}
                  className={inputClass}
                >
                  <option value="">اختر الموظف</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name} ({employee.employee_code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>التاريخ *</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(event) => updateForm({ date: event.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>بصمة الحضور</label>
                <input
                  type="time"
                  value={form.check_in}
                  onChange={(event) => updateForm({ check_in: event.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className={labelClass}>بصمة الانصراف</label>
                <input
                  type="time"
                  value={form.check_out}
                  onChange={(event) => updateForm({ check_out: event.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className={labelClass}>حالة الحضور</label>
                <select
                  value={form.status}
                  onChange={(event) =>
                    updateForm({ status: event.target.value as HRAttendanceStatus })
                  }
                  className={inputClass}
                >
                  {(Object.keys(ATTENDANCE_STATUS_LABELS) as HRAttendanceStatus[]).map((key) => (
                    <option key={key} value={key}>
                      {ATTENDANCE_STATUS_LABELS[key]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_excused}
                onChange={(event) => updateForm({ is_excused: event.target.checked })}
                className="w-4 h-4 accent-purple-600"
              />
              <span className="text-[11px] font-black text-slate-700">
                الغياب بعذر (لا يتم تطبيق خصم الغياب)
              </span>
            </label>

            {form.is_excused && (
              <div>
                <label className={labelClass}>سبب العذر</label>
                <input
                  value={form.excuse_note}
                  onChange={(event) => updateForm({ excuse_note: event.target.value })}
                  placeholder="مثال: إجازة مرضية بموافقة الإدارة"
                  className={inputClass}
                />
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>خصم (أيام)</label>
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={form.calculated_deduction_days}
                  onChange={(event) => updateForm({ calculated_deduction_days: event.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className={labelClass}>خصم (ساعات)</label>
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={form.calculated_deduction_hours}
                  onChange={(event) =>
                    updateForm({ calculated_deduction_hours: event.target.value })
                  }
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className={labelClass}>حالة المراجعة</label>
                <select
                  value={form.review_status}
                  onChange={(event) =>
                    updateForm({ review_status: event.target.value as HRReviewStatus })
                  }
                  className={inputClass}
                >
                  {(Object.keys(REVIEW_STATUS_LABELS) as HRReviewStatus[]).map((key) => (
                    <option key={key} value={key}>
                      {REVIEW_STATUS_LABELS[key]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-[11px] font-bold">
              <Info className="w-4 h-4 shrink-0" />
              <span>
                القيمة النهائية للخصم تُحسب كالتالي: (أيام × المرتب ÷ 30) + (ساعات × المرتب ÷ 30 ÷
                8).
              </span>
            </div>

            <ErrorNote message={formError} />

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeForm}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-black hover:bg-slate-200 transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white text-[11px] font-black hover:bg-purple-700 transition cursor-pointer disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                {isSaving ? 'جاري الحفظ...' : 'حفظ السجل'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {timeTarget && (
        <Modal
          title="إدخال بصمة يدوية"
          subtitle="تُستخدم عند نسيان البصمة على الماكينة، ويُعاد احتساب التأخير تلقائياً بعد الحفظ"
          onClose={() => {
            setTimeTarget(null);
            setTimeError('');
          }}
          maxWidthClass="max-w-md"
        >
          <div className="space-y-3">
            <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-[11px] font-black text-slate-800">
                {timeTarget.employee_name || '-'}{' '}
                <span className="font-mono text-slate-400">({timeTarget.employee_code || '-'})</span>
              </p>
              <p className="text-[10px] font-bold text-slate-500 font-mono mt-0.5">
                {formatDayLabel(timeTarget.date)} — {timeTarget.date}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>بصمة الحضور</label>
                <input
                  type="time"
                  value={timeForm.check_in}
                  onChange={(event) =>
                    setTimeForm((prev) => ({ ...prev, check_in: event.target.value }))
                  }
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className={labelClass}>بصمة الانصراف</label>
                <input
                  type="time"
                  value={timeForm.check_out}
                  onChange={(event) =>
                    setTimeForm((prev) => ({ ...prev, check_out: event.target.value }))
                  }
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>

            <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-[11px] font-bold">
              <Info className="w-4 h-4 shrink-0" />
              <span>
                الخصم الحالي: {Number(timeTarget.calculated_deduction_days) || 0} يوم /{' '}
                {Number(timeTarget.calculated_deduction_hours) || 0} ساعة، وسيتم تحديثه بعد الحفظ.
              </span>
            </div>

            <ErrorNote message={timeError} />

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setTimeTarget(null);
                  setTimeError('');
                }}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-black hover:bg-slate-200 transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void handleSaveManualTime()}
                disabled={isSavingTime}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-[11px] font-black hover:bg-blue-700 transition cursor-pointer disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                {isSavingTime ? 'جاري الحفظ...' : 'حفظ البصمة'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {excuseTarget && (
        <Modal
          title={excuseTarget.is_excused ? 'تعديل / إلغاء العذر' : 'تسجيل عذر حضور'}
          subtitle="تسجيل العذر يلغي الخصم المحتسب على هذا اليوم"
          onClose={() => {
            setExcuseTarget(null);
            setExcuseError('');
          }}
          maxWidthClass="max-w-md"
        >
          <div className="space-y-3">
            <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-[11px] font-black text-slate-800">
                {excuseTarget.employee_name || '-'}{' '}
                <span className="font-mono text-slate-400">
                  ({excuseTarget.employee_code || '-'})
                </span>
              </p>
              <p className="text-[10px] font-bold text-slate-500 font-mono mt-0.5">
                {formatDayLabel(excuseTarget.date)} — {excuseTarget.date}
              </p>
            </div>

            <div>
              <label className={labelClass}>سبب العذر *</label>
              <input
                value={excuseNote}
                onChange={(event) => setExcuseNote(event.target.value)}
                placeholder="مثال: إجازة مرضية بموافقة الإدارة"
                className={inputClass}
              />
            </div>

            <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-bold">
              <Info className="w-4 h-4 shrink-0" />
              <span>
                الخصم الحالي: {Number(excuseTarget.calculated_deduction_days) || 0} يوم /{' '}
                {Number(excuseTarget.calculated_deduction_hours) || 0} ساعة، وسيتم تصفيره بعد حفظ
                العذر.
              </span>
            </div>

            <ErrorNote message={excuseError} />

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setExcuseTarget(null);
                  setExcuseError('');
                }}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-black hover:bg-slate-200 transition cursor-pointer"
              >
                إلغاء
              </button>
              {excuseTarget.is_excused && (
                <button
                  type="button"
                  onClick={() => void handleSaveExcuse(true)}
                  disabled={isSavingExcuse}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-200 text-slate-700 text-[11px] font-black hover:bg-slate-300 transition cursor-pointer disabled:opacity-60"
                >
                  <XCircle className="w-4 h-4" />
                  إلغاء العذر
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleSaveExcuse(false)}
                disabled={isSavingExcuse}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-[11px] font-black hover:bg-emerald-700 transition cursor-pointer disabled:opacity-60"
              >
                <CheckCircle2 className="w-4 h-4" />
                {isSavingExcuse ? 'جاري الحفظ...' : 'حفظ العذر'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          title="تأكيد حذف سجل الحضور"
          subtitle="لا يمكن التراجع عن هذه العملية"
          onClose={() => {
            setDeleteTarget(null);
            setDeleteError('');
          }}
          maxWidthClass="max-w-md"
        >
          <div className="space-y-3">
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-bold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                سيتم حذف سجل حضور بتاريخ <strong className="font-mono">{deleteTarget.date}</strong>{' '}
                للموظف{' '}
                <strong>
                  {deleteTarget.employee_name ||
                    employees.find((item) => item.id === deleteTarget.employee_id)?.name ||
                    '-'}
                </strong>
                .
              </span>
            </div>
            <ErrorNote message={deleteError} />
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteError('');
                }}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-black hover:bg-slate-200 transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={isDeleting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 text-white text-[11px] font-black hover:bg-rose-700 transition cursor-pointer disabled:opacity-60"
              >
                <Trash2 className="w-4 h-4" />
                {isDeleting ? 'جاري الحذف...' : 'حذف السجل'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};


interface LoanDueRow {
  employee: HREmployee;
  salary: number;
  workdays: number;
  previousLoans: number;
  currentDue: number;
}

const LoansPanel: React.FC<{ employees: HREmployee[] }> = ({ employees }) => {
  const { addFlashMessage, logAction } = useApp();

  const [loans, setLoans] = useState<HRLoan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [month, setMonth] = useState(currentMonth());
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<HRLoan | null>(null);
  const [form, setForm] = useState({ employee_id: '', date: todayISO(), amount: '', notes: '' });
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<HRLoan | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [attendanceRecords, setAttendanceRecords] = useState<HRAttendanceRecord[]>([]);
  const [penalties, setPenalties] = useState<HRPenalty[]>([]);
  const [dueSearch, setDueSearch] = useState('');

  const loadLoans = useCallback(async () => {
    setIsLoading(true);
    try {
      const [loansRes, attendanceRes, penaltiesRes] = await Promise.all([
        api.getHRLoans(),
        api.getHRAttendanceRecords().catch(() => [] as HRAttendanceRecord[]),
        api.getHRPenalties().catch(() => [] as HRPenalty[])
      ]);
      setLoans(Array.isArray(loansRes) ? loansRes : []);
      setAttendanceRecords(Array.isArray(attendanceRes) ? attendanceRes : []);
      setPenalties(Array.isArray(penaltiesRes) ? penaltiesRes : []);
    } catch (err: any) {
      addFlashMessage(err?.message || 'فشل تحميل السُلف من السيرفر', 'danger');
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadLoans();
  }, [loadLoans]);

  const filteredLoans = useMemo(() => {
    return loans.filter((loan) => {
      if (month && !(loan.date || '').startsWith(month)) return false;
      if (employeeFilter && loan.employee_id !== employeeFilter) return false;
      return true;
    });
  }, [loans, month, employeeFilter]);

  const totalAmount = useMemo(
    () => filteredLoans.reduce((sum, loan) => sum + (Number(loan.amount) || 0), 0),
    [filteredLoans]
  );

  // فترة الاستحقاق: من أول الشهر حتى أمس، مع اعتبار الأحد أجازة مدفوعة (30 يوماً حسابية)
  const duePeriod = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const dates: string[] = [];
    for (let cursor = new Date(monthStart); cursor <= yesterday; cursor.setDate(cursor.getDate() + 1)) {
      if (cursor.getDay() !== 0) {
        dates.push(
          `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(
            cursor.getDate()
          ).padStart(2, '0')}`
        );
      }
    }
    return {
      monthKey: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      yesterdayLabel: `${String(yesterday.getDate()).padStart(2, '0')}/${String(
        yesterday.getMonth() + 1
      ).padStart(2, '0')}/${yesterday.getFullYear()}`,
      workdays: Math.min(dates.length, 30),
      dates
    };
  }, []);

  // احتساب المستحق لكل موظف حتى أمس: المرتب ÷ 30 × أيام العمل − الغياب − الجزاءات − السُلف السابقة
  const loanDueRows = useMemo<LoanDueRow[]>(() => {
    const rangeSet = new Set(duePeriod.dates);
    return employees.map((employee) => {
      const salary = Number(employee.monthly_salary) || 0;
      const dayRate = salary / 30;
      const employeeRecords = attendanceRecords.filter(
        (record) => record.employee_id === employee.id && rangeSet.has(record.date)
      );
      const absentDays = employeeRecords.filter(
        (record) => record.status === 'absent' && !record.is_excused
      ).length;
      const employeePenalties = penalties.filter(
        (penalty) => penalty.employee_id === employee.id && rangeSet.has(penalty.date)
      );
      const penaltyDays = employeePenalties
        .filter((penalty) => penalty.penalty_type === 'days')
        .reduce((sum, penalty) => sum + (Number(penalty.value) || 0), 0);
      const penaltyHours = employeePenalties
        .filter((penalty) => penalty.penalty_type === 'hours')
        .reduce((sum, penalty) => sum + (Number(penalty.value) || 0), 0);
      const previousLoans = loans
        .filter((loan) => loan.employee_id === employee.id && rangeSet.has(loan.date))
        .reduce((sum, loan) => sum + (Number(loan.amount) || 0), 0);
      const earned = dayRate * duePeriod.workdays;
      const deduction = dayRate * absentDays + dayRate * penaltyDays + (dayRate / 8) * penaltyHours;
      const currentDue = Math.max(0, earned - deduction - previousLoans);
      return {
        employee,
        salary,
        workdays: duePeriod.workdays,
        previousLoans,
        currentDue
      };
    });
  }, [employees, attendanceRecords, penalties, loans, duePeriod]);

  const dueGroups = useMemo(() => {
    const query = dueSearch.trim().toLowerCase();
    const map = new Map<string, LoanDueRow[]>();
    loanDueRows
      .filter(
        (row) =>
          !query ||
          `${row.employee.name} ${row.employee.employee_code}`.toLowerCase().includes(query)
      )
      .forEach((row) => {
        const key = row.employee.department || 'other';
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(row);
      });
    return Array.from(map.entries()).map(([key, rows]) => ({
      key,
      label: key === 'other' ? 'بدون قسم' : HR_DEPARTMENT_LABELS[key as HRDepartmentKey] || key,
      rows
    }));
  }, [loanDueRows, dueSearch]);

  const dueTotals = useMemo(
    () =>
      loanDueRows.reduce(
        (acc, row) => {
          acc.salary += row.salary;
          acc.previousLoans += row.previousLoans;
          acc.currentDue += row.currentDue;
          return acc;
        },
        { salary: 0, previousLoans: 0, currentDue: 0 }
      ),
    [loanDueRows]
  );

  const selectedEmployeeDue = useMemo(
    () => loanDueRows.find((row) => row.employee.id === form.employee_id)?.currentDue || 0,
    [loanDueRows, form.employee_id]
  );

  const printEmptyLoanForm = () => {
    const win = window.open('', '_blank', 'width=900,height=750');
    if (!win) {
      addFlashMessage('فضلاً اسمح بالنوافذ المنبثقة للطباعة', 'danger');
      return;
    }
    win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8" />
      <title>ورقة سلفة</title>
      <style>
        body{font-family:Tahoma,Arial,sans-serif;padding:28px;color:#0f172a}
        h1{font-size:20px;text-align:center;margin:0 0 4px}
        p.sub{text-align:center;color:#64748b;font-size:12px;margin:0 0 24px}
        table{width:100%;border-collapse:collapse;font-size:13px}
        td{border:1px solid #94a3b8;padding:14px 10px;height:38px}
        td.label{background:#f1f5f9;font-weight:bold;width:32%}
        .sign{margin-top:56px;display:flex;justify-content:space-between;font-size:13px}
      </style></head><body>
      <h1>نموذج طلب سلفة</h1>
      <p class="sub">إدارة الموارد البشرية</p>
      <table>
        <tr><td class="label">اسم الموظف</td><td></td></tr>
        <tr><td class="label">كود الموظف</td><td></td></tr>
        <tr><td class="label">القسم</td><td></td></tr>
        <tr><td class="label">الوظيفة</td><td></td></tr>
        <tr><td class="label">قيمة السلفة</td><td></td></tr>
        <tr><td class="label">تاريخ الطلب</td><td></td></tr>
        <tr><td class="label">سبب السلفة</td><td></td></tr>
        <tr><td class="label">طريقة السداد</td><td></td></tr>
      </table>
      <div class="sign"><span>توقيع الموظف: ....................</span><span>اعتماد الإدارة: ....................</span></div>
      </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  const printLoansReport = () => {
    if (loanDueRows.length === 0) {
      addFlashMessage('لا توجد بيانات لطباعتها', 'danger');
      return;
    }
    const body = dueGroups
      .map(
        (group) => `<h2>${group.label} <span>(${group.rows.length} موظف)</span></h2>
        <table>
          <thead><tr>
            <th>الكود</th><th>الموظف</th><th>المرتب</th><th>أيام العمل حتى أمس</th>
            <th>السُلف السابقة</th><th>المستحق الحالي</th>
          </tr></thead>
          <tbody>
            ${group.rows
              .map(
                (row) => `<tr>
                  <td>${row.employee.employee_code || '-'}</td>
                  <td>${row.employee.name}</td>
                  <td>${formatMoney(row.salary)}</td>
                  <td>${row.workdays}</td>
                  <td>${formatMoney(row.previousLoans)}</td>
                  <td>${formatMoney(row.currentDue)}</td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>`
      )
      .join('');
    const win = window.open('', '_blank', 'width=1100,height=820');
    if (!win) {
      addFlashMessage('فضلاً اسمح بالنوافذ المنبثقة للطباعة', 'danger');
      return;
    }
    win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8" />
      <title>تقرير السُلف والمستحقات</title>
      <style>
        body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#0f172a}
        h1{font-size:19px;margin:0 0 4px}
        p.sub{font-size:12px;color:#64748b;margin:0 0 18px}
        h2{font-size:14px;margin:18px 0 6px}
        h2 span{font-size:11px;color:#64748b;font-weight:normal}
        table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px}
        th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:center}
        th{background:#f1f5f9}
      </style></head><body>
      <h1>تقرير السُلف والمستحقات</h1>
      <p class="sub">شهر ${duePeriod.monthKey} — من أول الشهر حتى ${duePeriod.yesterdayLabel} (أيام العمل: ${duePeriod.workdays})</p>
      ${body}
      <p class="sub">إجمالي المرتبات: ${formatMoney(dueTotals.salary)} — إجمالي السُلف السابقة: ${formatMoney(
        dueTotals.previousLoans
      )} — إجمالي المستحق الحالي: ${formatMoney(dueTotals.currentDue)}</p>
      </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  const updateForm = (patch: Partial<typeof form>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  const openCreateFor = (employeeId?: string) => {
    setEditing(null);
    setForm({
      employee_id: employeeId || employees[0]?.id || '',
      date: todayISO(),
      amount: '',
      notes: ''
    });
    setFormError('');
    setIsFormOpen(true);
  };

  const openCreate = () => openCreateFor();

  const openEdit = (loan: HRLoan) => {
    setEditing(loan);
    setForm({
      employee_id: loan.employee_id,
      date: loan.date || todayISO(),
      amount: String(loan.amount ?? ''),
      notes: loan.notes || ''
    });
    setFormError('');
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditing(null);
    setFormError('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.employee_id) {
      setFormError('يرجى اختيار الموظف');
      return;
    }
    if (!form.date) {
      setFormError('تاريخ السلفة مطلوب');
      return;
    }
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError('قيمة السلفة يجب أن تكون أكبر من صفر');
      return;
    }

    setIsSaving(true);
    setFormError('');
    const payload: any = {
      employee_id: form.employee_id,
      date: form.date,
      amount,
      notes: form.notes.trim()
    };

    try {
      if (editing) {
        await api.updateHRLoan(editing.id, payload);
        addFlashMessage('تم تعديل السلفة بنجاح');
        logAction('الموارد البشرية', `تعديل سلفة بقيمة ${amount} بتاريخ ${form.date}`);
      } else {
        await api.createHRLoan(payload);
        addFlashMessage('تم إضافة السلفة بنجاح');
        logAction('الموارد البشرية', `إضافة سلفة بقيمة ${amount} بتاريخ ${form.date}`);
      }
      closeForm();
      await loadLoans();
    } catch (err: any) {
      setFormError(err?.message || 'فشل حفظ السلفة');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError('');
    try {
      await api.deleteHRLoan(deleteTarget.id);
      addFlashMessage('تم حذف السلفة بنجاح');
      logAction('الموارد البشرية', `حذف سلفة بتاريخ ${deleteTarget.date}`);
      setDeleteTarget(null);
      await loadLoans();
    } catch (err: any) {
      setDeleteError(err?.message || 'فشل حذف السلفة');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-slate-900">سُلف الموظفين</h2>
          <p className="text-[11px] font-bold text-slate-500 mt-0.5">
            كل سلفة تُخصم من مرتب نفس الشهر، ولا يمكن أن يتجاوز إجمالي السُلف قيمة المرتب.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={printEmptyLoanForm}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-[11px] font-black hover:bg-slate-50 transition cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            طباعة ورق سلفة فاضي
          </button>
          <button
            type="button"
            onClick={printLoansReport}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 text-white text-[11px] font-black hover:bg-indigo-700 transition cursor-pointer"
          >
            <FileText className="w-4 h-4" />
            تقرير السُلف
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white text-[11px] font-black hover:bg-purple-700 transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            صرف سلفة
          </button>
        </div>
      </div>

      <div className="p-4 bg-slate-50/60 border-b border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-2">
        <input
          type="month"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
          className={`${inputClass} font-mono`}
        />
        <select
          value={employeeFilter}
          onChange={(event) => setEmployeeFilter(event.target.value)}
          className={inputClass}
        >
          <option value="">كل الموظفين</option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.name} ({employee.employee_code})
            </option>
          ))}
        </select>
      </div>

      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-black text-slate-700">
          <Wallet className="w-3.5 h-3.5 text-purple-600" />
          عدد السُلف: {filteredLoans.length}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] font-black text-amber-700">
          <Banknote className="w-3.5 h-3.5" />
          إجمالي السُلف المسجلة: {formatMoney(totalAmount)}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] font-black text-rose-700">
          <Banknote className="w-3.5 h-3.5" />
          السُلف السابقة: {formatMoney(dueTotals.previousLoans)}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] font-black text-emerald-700">
          <Wallet className="w-3.5 h-3.5" />
          المستحق الحالي: {formatMoney(dueTotals.currentDue)}
        </span>
      </div>

      {/* استحقاق السُلف: من أول الشهر حتى أمس، مجمّع حسب القسم */}
      <div className="px-4 py-3 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-black text-slate-900">استحقاق السُلف حتى أمس</h3>
          <p className="text-[10px] font-bold text-slate-500 mt-0.5">
            من أول الشهر حتى {duePeriod.yesterdayLabel} — أيام العمل: {duePeriod.workdays} (الأحد
            أجازة مدفوعة)
          </p>
        </div>
        <input
          value={dueSearch}
          onChange={(event) => setDueSearch(event.target.value)}
          placeholder="بحث بالاسم أو الكود"
          className={`${inputClass} md:w-64`}
        />
      </div>

      {isLoading ? (
        <div className="p-10 text-center text-xs font-bold text-slate-400">جاري التحميل...</div>
      ) : dueGroups.length === 0 ? (
        <div className="p-8 text-center">
          <Users className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="text-xs font-black text-slate-700">لا توجد بيانات استحقاق</p>
          <p className="text-[11px] font-bold text-slate-500 mt-1">
            {dueSearch.trim()
              ? 'لا توجد نتائج مطابقة لبحثك.'
              : 'أضف موظفين لعرض المستحقات.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-right px-4 py-2.5 font-black whitespace-nowrap">الكود</th>
                <th className="text-right px-4 py-2.5 font-black whitespace-nowrap">الموظف</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">المرتب</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">
                  أيام العمل حتى أمس
                </th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">
                  السُلف السابقة
                </th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">
                  المستحق الحالي
                </th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">إجراءات</th>
              </tr>
            </thead>
            {dueGroups.map((group) => (
              <tbody key={group.key} className="divide-y divide-slate-100">
                <tr className="bg-slate-50/80">
                  <td colSpan={7} className="px-4 py-2 font-black text-slate-700">
                    {group.label}{' '}
                    <span className="text-[10px] font-bold text-slate-400">
                      ({group.rows.length} موظف)
                    </span>
                  </td>
                </tr>
                {group.rows.map((row) => (
                  <tr key={row.employee.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-mono font-bold text-slate-600 whitespace-nowrap">
                      {row.employee.employee_code || '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="font-black text-slate-900">{row.employee.name}</p>
                      <p className="font-bold text-[10px] text-slate-400">
                        {row.employee.job_title || ''}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-bold text-slate-700 whitespace-nowrap">
                      {formatMoney(row.salary)}
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-bold text-slate-600">
                      {row.workdays}
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-bold text-amber-600 whitespace-nowrap">
                      {formatMoney(row.previousLoans)}
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-black text-emerald-700 whitespace-nowrap">
                      {formatMoney(row.currentDue)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => openCreateFor(row.employee.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-purple-600 text-white text-[10px] font-black hover:bg-purple-700 transition cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        صرف سلفة
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}

      <div className="px-4 py-3 border-b border-slate-100">
        <h3 className="text-xs font-black text-slate-900">سجل السُلف المسجلة</h3>
      </div>

      {isLoading ? (
        <div className="p-10 text-center text-xs font-bold text-slate-400">جاري التحميل...</div>
      ) : filteredLoans.length === 0 ? (
        <div className="p-10 text-center">
          <Wallet className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="text-xs font-black text-slate-700">لا توجد سُلف مسجلة لهذا الشهر</p>
          <p className="text-[11px] font-bold text-slate-500 mt-1">
            أضف سلفة جديدة ليتم خصمها تلقائياً من مرتب الموظف في مسير المرتبات.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-right px-4 py-2.5 font-black whitespace-nowrap">التاريخ</th>
                <th className="text-right px-4 py-2.5 font-black whitespace-nowrap">الموظف</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">المبلغ</th>
                <th className="text-right px-4 py-2.5 font-black whitespace-nowrap">ملاحظات</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLoans.map((loan) => {
                const employee = employees.find((item) => item.id === loan.employee_id);
                return (
                  <tr key={loan.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-mono font-bold text-slate-700 whitespace-nowrap">
                      {loan.date}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="font-black text-slate-900">
                        {loan.employee_name || employee?.name || '-'}
                      </p>
                      <p className="font-bold text-[10px] text-slate-400 font-mono">
                        {loan.employee_code || employee?.employee_code || '-'}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-black text-rose-600 whitespace-nowrap">
                      {formatMoney(Number(loan.amount) || 0)}
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-600 max-w-[260px] truncate">
                      {loan.notes || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(loan)}
                          title="تعديل"
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-purple-50 hover:text-purple-600 transition cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError('');
                            setDeleteTarget(loan);
                          }}
                          title="حذف"
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isFormOpen && (
        <Modal
          title={editing ? 'تعديل سلفة' : 'صرف سلفة جديدة'}
          subtitle="تُخصم السلفة بالكامل من مرتب نفس الشهر في مسير المرتبات"
          onClose={closeForm}
          maxWidthClass="max-w-xl"
        >
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>الموظف *</label>
                <select
                  value={form.employee_id}
                  onChange={(event) => updateForm({ employee_id: event.target.value })}
                  className={inputClass}
                >
                  <option value="">اختر الموظف</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name} ({employee.employee_code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>تاريخ السلفة *</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(event) => updateForm({ date: event.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>قيمة السلفة (ج.م) *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(event) => updateForm({ amount: event.target.value })}
                placeholder="0.00"
                className={`${inputClass} font-mono`}
              />
              <p className="text-[10px] font-bold text-slate-500 mt-1">
                المستحق الحالي للموظف حتى أمس: {formatMoney(selectedEmployeeDue)}
              </p>
            </div>

            <div>
              <label className={labelClass}>ملاحظات</label>
              <textarea
                value={form.notes}
                onChange={(event) => updateForm({ notes: event.target.value })}
                rows={2}
                className={inputClass}
                placeholder="سبب السلفة أو طريقة السداد..."
              />
            </div>

            <ErrorNote message={formError} />

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeForm}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-black hover:bg-slate-200 transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white text-[11px] font-black hover:bg-purple-700 transition cursor-pointer disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                {isSaving ? 'جاري الحفظ...' : 'حفظ السلفة'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          title="تأكيد حذف السلفة"
          subtitle="لا يمكن التراجع عن هذه العملية"
          onClose={() => {
            setDeleteTarget(null);
            setDeleteError('');
          }}
          maxWidthClass="max-w-md"
        >
          <div className="space-y-3">
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-bold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                سيتم حذف سلفة بقيمة{' '}
                <strong className="font-mono">{formatMoney(Number(deleteTarget.amount) || 0)}</strong>{' '}
                بتاريخ <strong className="font-mono">{deleteTarget.date}</strong> للموظف{' '}
                <strong>
                  {deleteTarget.employee_name ||
                    employees.find((item) => item.id === deleteTarget.employee_id)?.name ||
                    '-'}
                </strong>
                .
              </span>
            </div>
            <ErrorNote message={deleteError} />
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteError('');
                }}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-black hover:bg-slate-200 transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={isDeleting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 text-white text-[11px] font-black hover:bg-rose-700 transition cursor-pointer disabled:opacity-60"
              >
                <Trash2 className="w-4 h-4" />
                {isDeleting ? 'جاري الحذف...' : 'حذف السلفة'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

const PenaltiesPanel: React.FC<{ employees: HREmployee[] }> = ({ employees }) => {
  const { addFlashMessage, logAction } = useApp();

  const [penalties, setPenalties] = useState<HRPenalty[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [month, setMonth] = useState(currentMonth());
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [historyEmployeeId, setHistoryEmployeeId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<HRPenalty | null>(null);
  const [form, setForm] = useState({
    employee_id: '',
    date: todayISO(),
    penalty_type: 'days' as HRPenaltyType,
    value: '',
    reason: ''
  });
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<HRPenalty | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const loadPenalties = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getHRPenalties();
      setPenalties(Array.isArray(res) ? res : []);
    } catch (err: any) {
      addFlashMessage(err?.message || 'فشل تحميل الجزاءات من السيرفر', 'danger');
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadPenalties();
  }, [loadPenalties]);

  const filteredPenalties = useMemo(() => {
    const query = search.trim().toLowerCase();
    return penalties.filter((penalty) => {
      if (month && !(penalty.date || '').startsWith(month)) return false;
      if (employeeFilter && penalty.employee_id !== employeeFilter) return false;
      if (query) {
        const employee = employees.find((item) => item.id === penalty.employee_id);
        const haystack = `${penalty.employee_name || employee?.name || ''} ${
          penalty.employee_code || employee?.employee_code || ''
        } ${penalty.reason || ''}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [penalties, month, employeeFilter, search, employees]);

  // سجل جزاءات الموظف مجمّعاً حسب الشهور
  const historyEmployee = useMemo(
    () => employees.find((item) => item.id === historyEmployeeId) || null,
    [employees, historyEmployeeId]
  );

  const historyPenalties = useMemo(() => {
    if (!historyEmployeeId) return [];
    return penalties
      .filter((penalty) => penalty.employee_id === historyEmployeeId)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [penalties, historyEmployeeId]);

  const historyByMonth = useMemo(() => {
    const map = new Map<string, HRPenalty[]>();
    historyPenalties.forEach((penalty) => {
      const key = (penalty.date || '').slice(0, 7) || 'غير محدد';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(penalty);
    });
    return Array.from(map.entries());
  }, [historyPenalties]);

  const summary = useMemo(() => {
    let days = 0;
    let hours = 0;
    filteredPenalties.forEach((penalty) => {
      if (penalty.penalty_type === 'days') days += Number(penalty.value) || 0;
      else hours += Number(penalty.value) || 0;
    });
    return { days, hours };
  }, [filteredPenalties]);

  const updateForm = (patch: Partial<typeof form>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  const openCreate = () => {
    setEditing(null);
    setForm({
      employee_id: employees[0]?.id || '',
      date: todayISO(),
      penalty_type: 'days',
      value: '',
      reason: ''
    });
    setFormError('');
    setIsFormOpen(true);
  };

  const openEdit = (penalty: HRPenalty) => {
    setEditing(penalty);
    setForm({
      employee_id: penalty.employee_id,
      date: penalty.date || todayISO(),
      penalty_type: penalty.penalty_type || 'days',
      value: String(penalty.value ?? ''),
      reason: penalty.reason || ''
    });
    setFormError('');
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditing(null);
    setFormError('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.employee_id) {
      setFormError('يرجى اختيار الموظف');
      return;
    }
    if (!form.date) {
      setFormError('تاريخ الجزاء مطلوب');
      return;
    }
    const value = Number(form.value);
    if (!Number.isFinite(value) || value <= 0) {
      setFormError('قيمة الجزاء يجب أن تكون أكبر من صفر');
      return;
    }
    const maxAllowed = form.penalty_type === 'days' ? 3 : 8;
    if (value > maxAllowed) {
      setFormError(
        form.penalty_type === 'days'
          ? 'الحد الأقصى لمقدار الجزاء ٣ أيام'
          : 'الحد الأقصى لمقدار الجزاء ٨ ساعات'
      );
      return;
    }

    setIsSaving(true);
    setFormError('');
    const payload: any = {
      employee_id: form.employee_id,
      date: form.date,
      penalty_type: form.penalty_type,
      value,
      reason: form.reason.trim()
    };

    try {
      if (editing) {
        await api.updateHRPenalty(editing.id, payload);
        addFlashMessage('تم تعديل الجزاء بنجاح');
        logAction('الموارد البشرية', `تعديل جزاء بقيمة ${value} بتاريخ ${form.date}`);
      } else {
        await api.createHRPenalty(payload);
        addFlashMessage('تم إضافة الجزاء بنجاح');
        logAction('الموارد البشرية', `إضافة جزاء بقيمة ${value} بتاريخ ${form.date}`);
      }
      closeForm();
      await loadPenalties();
    } catch (err: any) {
      setFormError(err?.message || 'فشل حفظ الجزاء');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError('');
    try {
      await api.deleteHRPenalty(deleteTarget.id);
      addFlashMessage('تم حذف الجزاء بنجاح');
      logAction('الموارد البشرية', `حذف جزاء بتاريخ ${deleteTarget.date}`);
      setDeleteTarget(null);
      await loadPenalties();
    } catch (err: any) {
      setDeleteError(err?.message || 'فشل حذف الجزاء');
    } finally {
      setIsDeleting(false);
    }
  };

  // خيارات ثابتة لمقدار الجزاء (الحد الأقصى ٣ أيام أو ٨ ساعات)
  const penaltyPresets =
    form.penalty_type === 'days'
      ? [
          { value: '0.25', label: 'ربع يوم' },
          { value: '0.5', label: 'نصف يوم' },
          { value: '1', label: 'يوم' },
          { value: '2', label: 'يومان' },
          { value: '3', label: '٣ أيام' }
        ]
      : [
          { value: '1', label: 'ساعة' },
          { value: '2', label: 'ساعتان' },
          { value: '3', label: '٣ ساعات' },
          { value: '4', label: '٤ ساعات' }
        ];

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-slate-900">الجزاءات والخصومات الإدارية</h2>
          <p className="text-[11px] font-bold text-slate-500 mt-0.5">
            جزاءات مسجلة يدوياً من الإدارة (أيام أو ساعات) وتُخصم في مسير مرتبات نفس الشهر.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white text-[11px] font-black hover:bg-purple-700 transition cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          تطبيق جزاء
        </button>
      </div>

      <div className="p-4 bg-slate-50/60 border-b border-slate-100 grid grid-cols-1 md:grid-cols-3 gap-2">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="بحث بالاسم أو الكود أو السبب"
          className={inputClass}
        />
        <input
          type="month"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
          className={`${inputClass} font-mono`}
        />
        <select
          value={employeeFilter}
          onChange={(event) => setEmployeeFilter(event.target.value)}
          className={inputClass}
        >
          <option value="">كل الموظفين</option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.name} ({employee.employee_code})
            </option>
          ))}
        </select>
      </div>

      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-black text-slate-700">
          <Scale className="w-3.5 h-3.5 text-purple-600" />
          عدد الجزاءات: {filteredPenalties.length}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] font-black text-rose-700">
          <CalendarDays className="w-3.5 h-3.5" />
          إجمالي الأيام: {summary.days}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] font-black text-amber-700">
          <Timer className="w-3.5 h-3.5" />
          إجمالي الساعات: {summary.hours}
        </span>
      </div>

      {isLoading ? (
        <div className="p-10 text-center text-xs font-bold text-slate-400">جاري التحميل...</div>
      ) : filteredPenalties.length === 0 ? (
        <div className="p-10 text-center">
          <Scale className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="text-xs font-black text-slate-700">لا توجد جزاءات مسجلة لهذا الشهر</p>
          <p className="text-[11px] font-bold text-slate-500 mt-1">
            الخصومات التلقائية للتأخير والغياب تُحسب من سجل الحضور، أما هذا القسم فللجزاءات اليدوية.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-right px-4 py-2.5 font-black whitespace-nowrap">التاريخ</th>
                <th className="text-right px-4 py-2.5 font-black whitespace-nowrap">الموظف</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">النوع</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">القيمة</th>
                <th className="text-right px-4 py-2.5 font-black whitespace-nowrap">السبب</th>
                <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPenalties.map((penalty) => {
                const employee = employees.find((item) => item.id === penalty.employee_id);
                return (
                  <tr key={penalty.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-mono font-bold text-slate-700 whitespace-nowrap">
                      {penalty.date}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="font-black text-slate-900">
                        {penalty.employee_name || employee?.name || '-'}
                      </p>
                      <p className="font-bold text-[10px] text-slate-400 font-mono">
                        {penalty.employee_code || employee?.employee_code || '-'}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black border ${
                          penalty.penalty_type === 'days'
                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}
                      >
                        {PENALTY_TYPE_LABELS[penalty.penalty_type] || penalty.penalty_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-black text-rose-600 whitespace-nowrap">
                      {Number(penalty.value) || 0}
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-600 max-w-[260px] truncate">
                      {penalty.reason || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => setHistoryEmployeeId(penalty.employee_id)}
                          title="سجل الجزاءات"
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 transition cursor-pointer"
                        >
                          <History className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(penalty)}
                          title="تعديل"
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-purple-50 hover:text-purple-600 transition cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError('');
                            setDeleteTarget(penalty);
                          }}
                          title="حذف"
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isFormOpen && (
        <Modal
          title={editing ? 'تعديل جزاء' : 'إضافة جزاء جديد'}
          subtitle="الجزاء يُخصم من مرتب نفس الشهر بإضافة إلى خصومات الحضور"
          onClose={closeForm}
          maxWidthClass="max-w-xl"
        >
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>الموظف *</label>
                <select
                  value={form.employee_id}
                  onChange={(event) => updateForm({ employee_id: event.target.value })}
                  className={inputClass}
                >
                  <option value="">اختر الموظف</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name} ({employee.employee_code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>تاريخ الجزاء *</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(event) => updateForm({ date: event.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>نوع الجزاء</label>
                <select
                  value={form.penalty_type}
                  onChange={(event) =>
                    updateForm({ penalty_type: event.target.value as HRPenaltyType })
                  }
                  className={inputClass}
                >
                  <option value="days">{PENALTY_TYPE_LABELS.days}</option>
                  <option value="hours">{PENALTY_TYPE_LABELS.hours}</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>
                  القيمة {form.penalty_type === 'days' ? '(أيام)' : '(ساعات)'} *
                </label>
                <input
                  type="number"
                  min="0"
                  max={form.penalty_type === 'days' ? 3 : 8}
                  step="0.25"
                  value={form.value}
                  onChange={(event) => updateForm({ value: event.target.value })}
                  placeholder="0"
                  className={`${inputClass} font-mono`}
                />
                <div className="flex flex-wrap gap-1 mt-2">
                  {penaltyPresets.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => updateForm({ value: preset.value })}
                      className={`px-2 py-1 rounded-lg text-[10px] font-black border transition cursor-pointer ${
                        form.value === preset.value
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className={labelClass}>سبب الجزاء</label>
              <textarea
                value={form.reason}
                onChange={(event) => updateForm({ reason: event.target.value })}
                rows={2}
                className={inputClass}
                placeholder="مثال: مخالفة تعليمات السلامة المهنية"
              />
            </div>

            <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-[11px] font-bold">
              <Info className="w-4 h-4 shrink-0" />
              <span>
                يُحسب الجزاء كالتالي: (الأيام × المرتب ÷ 30) + (الساعات × المرتب ÷ 30 ÷ 8)، ويُخصم
                في مسير مرتبات نفس الشهر.
              </span>
            </div>

            <ErrorNote message={formError} />

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeForm}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-black hover:bg-slate-200 transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white text-[11px] font-black hover:bg-purple-700 transition cursor-pointer disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                {isSaving ? 'جاري الحفظ...' : 'حفظ الجزاء'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          title="تأكيد حذف الجزاء"
          subtitle="لا يمكن التراجع عن هذه العملية"
          onClose={() => {
            setDeleteTarget(null);
            setDeleteError('');
          }}
          maxWidthClass="max-w-md"
        >
          <div className="space-y-3">
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-bold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                سيتم حذف جزاء بقيمة{' '}
                <strong className="font-mono">{Number(deleteTarget.value) || 0}</strong>{' '}
                {PENALTY_TYPE_LABELS[deleteTarget.penalty_type] || ''} بتاريخ{' '}
                <strong className="font-mono">{deleteTarget.date}</strong> للموظف{' '}
                <strong>
                  {deleteTarget.employee_name ||
                    employees.find((item) => item.id === deleteTarget.employee_id)?.name ||
                    '-'}
                </strong>
                .
              </span>
            </div>
            <ErrorNote message={deleteError} />
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteError('');
                }}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-black hover:bg-slate-200 transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={isDeleting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 text-white text-[11px] font-black hover:bg-rose-700 transition cursor-pointer disabled:opacity-60"
              >
                <Trash2 className="w-4 h-4" />
                {isDeleting ? 'جاري الحذف...' : 'حذف الجزاء'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {historyEmployeeId && (
        <Modal
          title={`سجل جزاءات ${historyEmployee?.name || ''}`}
          subtitle="جميع الجزاءات المسجلة للموظف مجمّعة حسب الشهور"
          onClose={() => setHistoryEmployeeId(null)}
          maxWidthClass="max-w-3xl"
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-black text-slate-700">
                <Scale className="w-3.5 h-3.5 text-purple-600" />
                إجمالي الجزاءات: {historyPenalties.length}
              </span>
              <button
                type="button"
                onClick={() => {
                  const employeeId = historyEmployeeId;
                  setHistoryEmployeeId(null);
                  setEditing(null);
                  setForm({
                    employee_id: employeeId,
                    date: todayISO(),
                    penalty_type: 'days',
                    value: '',
                    reason: ''
                  });
                  setFormError('');
                  setIsFormOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600 text-white text-[11px] font-black hover:bg-purple-700 transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                تطبيق جزاء
              </button>
            </div>

            {historyByMonth.length === 0 ? (
              <div className="p-8 text-center">
                <Scale className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                <p className="text-xs font-black text-slate-700">لا توجد جزاءات مسجلة لهذا الموظف</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                {historyByMonth.map(([monthKey, items]) => {
                  const daysTotal = items
                    .filter((item) => item.penalty_type === 'days')
                    .reduce((sum, item) => sum + (Number(item.value) || 0), 0);
                  const hoursTotal = items
                    .filter((item) => item.penalty_type === 'hours')
                    .reduce((sum, item) => sum + (Number(item.value) || 0), 0);
                  return (
                    <div key={monthKey} className="rounded-2xl border border-slate-200 overflow-hidden">
                      <div className="px-3 py-2 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] font-black text-slate-800 font-mono">{monthKey}</p>
                        <p className="text-[10px] font-black text-slate-500">
                          {items.length} جزاء — {daysTotal} يوم — {hoursTotal} ساعة
                        </p>
                      </div>
                      <table className="w-full text-xs">
                        <thead className="bg-white text-slate-400">
                          <tr>
                            <th className="text-right px-3 py-2 font-black">التاريخ</th>
                            <th className="text-center px-3 py-2 font-black">النوع</th>
                            <th className="text-center px-3 py-2 font-black">القيمة</th>
                            <th className="text-right px-3 py-2 font-black">السبب</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {items.map((penalty) => (
                            <tr key={penalty.id}>
                              <td className="px-3 py-2 font-mono font-bold text-slate-600">
                                {penalty.date}
                              </td>
                              <td className="px-3 py-2 text-center font-bold text-slate-600">
                                {PENALTY_TYPE_LABELS[penalty.penalty_type] || penalty.penalty_type}
                              </td>
                              <td className="px-3 py-2 text-center font-mono font-black text-rose-600">
                                {Number(penalty.value) || 0}
                              </td>
                              <td className="px-3 py-2 font-bold text-slate-600">
                                {penalty.reason || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};


interface PayrollRow {
  employee: HREmployee;
  baseSalary: number;
  attendanceDays: number;
  attendanceHours: number;
  attendanceDeduction: number;
  penaltyDays: number;
  penaltyHours: number;
  penaltyDeduction: number;
  loanDeduction: number;
  totalDeduction: number;
  netPay: number;
}

const PayrollPanel: React.FC<{ employees: HREmployee[] }> = ({ employees }) => {
  const { addFlashMessage } = useApp();

  const [month, setMonth] = useState(currentMonth());
  const [records, setRecords] = useState<HRAttendanceRecord[]>([]);
  const [penalties, setPenalties] = useState<HRPenalty[]>([]);
  const [loans, setLoans] = useState<HRLoan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [workerSheet, setWorkerSheet] = useState<PayrollRow | null>(null);

  const loadPayrollData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [recordsRes, penaltiesRes, loansRes] = await Promise.all([
        api.getHRAttendanceRecords(),
        api.getHRPenalties(),
        api.getHRLoans()
      ]);
      setRecords(Array.isArray(recordsRes) ? recordsRes : []);
      setPenalties(Array.isArray(penaltiesRes) ? penaltiesRes : []);
      setLoans(Array.isArray(loansRes) ? loansRes : []);
    } catch (err: any) {
      addFlashMessage(err?.message || 'فشل تحميل بيانات مسير المرتبات', 'danger');
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadPayrollData();
  }, [loadPayrollData]);

  const rows = useMemo<PayrollRow[]>(() => {
    const inMonth = (date?: string) => !!date && date.startsWith(month);

    return employees.map((employee) => {
      const baseSalary = Number(employee.monthly_salary) || 0;
      const dayRate = baseSalary / 30;
      const hourRate = dayRate / 8;

      let attendanceDays = 0;
      let attendanceHours = 0;
      records.forEach((record) => {
        if (record.employee_id !== employee.id) return;
        if (!inMonth(record.date)) return;
        if (record.review_status === 'rejected') return;
        attendanceDays += Number(record.calculated_deduction_days) || 0;
        attendanceHours += Number(record.calculated_deduction_hours) || 0;
      });

      let penaltyDays = 0;
      let penaltyHours = 0;
      penalties.forEach((penalty) => {
        if (penalty.employee_id !== employee.id) return;
        if (!inMonth(penalty.date)) return;
        if (penalty.penalty_type === 'days') penaltyDays += Number(penalty.value) || 0;
        else penaltyHours += Number(penalty.value) || 0;
      });

      const loanDeduction = loans
        .filter((loan) => loan.employee_id === employee.id && inMonth(loan.date))
        .reduce((sum, loan) => sum + (Number(loan.amount) || 0), 0);

      const attendanceDeduction = attendanceDays * dayRate + attendanceHours * hourRate;
      const penaltyDeduction = penaltyDays * dayRate + penaltyHours * hourRate;
      const totalDeduction = attendanceDeduction + penaltyDeduction + loanDeduction;

      return {
        employee,
        baseSalary,
        attendanceDays,
        attendanceHours,
        attendanceDeduction,
        penaltyDays,
        penaltyHours,
        penaltyDeduction,
        loanDeduction,
        totalDeduction,
        netPay: baseSalary - totalDeduction
      };
    });
  }, [employees, records, penalties, loans, month]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          baseSalary: acc.baseSalary + row.baseSalary,
          attendanceDeduction: acc.attendanceDeduction + row.attendanceDeduction,
          penaltyDeduction: acc.penaltyDeduction + row.penaltyDeduction,
          loanDeduction: acc.loanDeduction + row.loanDeduction,
          totalDeduction: acc.totalDeduction + row.totalDeduction,
          netPay: acc.netPay + row.netPay
        }),
        {
          baseSalary: 0,
          attendanceDeduction: 0,
          penaltyDeduction: 0,
          loanDeduction: 0,
          totalDeduction: 0,
          netPay: 0
        }
      ),
    [rows]
  );

  const workerDepartment = (row: PayrollRow) =>
    row.employee.department_label ||
    (row.employee.department ? HR_DEPARTMENT_LABELS[row.employee.department] : '—');

  const buildWorkerSheetHtml = (row: PayrollRow) => `
    <div class="sheet">
      <h1>ورقة مرتب عامل</h1>
      <p class="sub">شهر ${month} — إدارة الموارد البشرية</p>
      <table>
        <tr><td class="label">اسم الموظف</td><td>${row.employee.name}</td><td class="label">كود الموظف</td><td>${row.employee.employee_code || '-'}</td></tr>
        <tr><td class="label">الوظيفة</td><td>${row.employee.job_title || '—'}</td><td class="label">القسم</td><td>${workerDepartment(row)}</td></tr>
        <tr><td class="label">المرتب الشهري</td><td colspan="3">${formatMoney(row.baseSalary)}</td></tr>
      </table>
      <table>
        <thead><tr><th>البند</th><th>التفاصيل</th><th>القيمة</th></tr></thead>
        <tbody>
          <tr><td>خصم الحضور</td><td>${row.attendanceDays} يوم / ${row.attendanceHours} ساعة</td><td>${formatMoney(row.attendanceDeduction)}</td></tr>
          <tr><td>الجزاءات</td><td>${row.penaltyDays} يوم / ${row.penaltyHours} ساعة</td><td>${formatMoney(row.penaltyDeduction)}</td></tr>
          <tr><td>السُلف</td><td>—</td><td>${formatMoney(row.loanDeduction)}</td></tr>
          <tr><td colspan="2">إجمالي الخصومات</td><td>${formatMoney(row.totalDeduction)}</td></tr>
        </tbody>
      </table>
      <div class="net">صافي المستحق: ${formatMoney(row.netPay)}</div>
      <div class="sign"><span>توقيع الموظف: ....................</span><span>توقيع الإدارة: ....................</span></div>
    </div>
  `;

  const workerSheetStyles = `
    body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#0f172a}
    .sheet{max-width:720px;margin:0 auto}
    h1{font-size:20px;text-align:center;margin:0 0 4px}
    p.sub{text-align:center;color:#64748b;font-size:12px;margin:0 0 18px}
    table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px}
    th,td{border:1px solid #cbd5e1;padding:8px;text-align:center}
    th{background:#f1f5f9}
    td.label{background:#f1f5f9;font-weight:bold;width:18%}
    .net{margin-top:12px;padding:14px;border:2px solid #059669;border-radius:10px;text-align:center;font-size:18px;font-weight:bold;color:#047857}
    .sign{margin-top:40px;display:flex;justify-content:space-between;font-size:13px}
  `;

  const printWorkerSheet = (row: PayrollRow) => {
    const win = window.open('', '_blank', 'width=900,height=800');
    if (!win) {
      addFlashMessage('فضلاً اسمح بالنوافذ المنبثقة للطباعة', 'danger');
      return;
    }
    win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8" />
      <title>ورقة مرتب ${row.employee.name}</title>
      <style>${workerSheetStyles}</style></head><body>${buildWorkerSheetHtml(row)}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  const printAllEnvelopes = () => {
    if (rows.length === 0) {
      addFlashMessage('لا يوجد موظفون لطباعة أظرفهم', 'danger');
      return;
    }
    const cards = rows
      .map(
        (row) => `
        <div class="env">
          <div class="env-head">كارت أظرف المرتبات — شهر ${month}</div>
          <div class="env-name">${row.employee.name}</div>
          <div class="env-meta">${row.employee.employee_code || '-'} — ${
          row.employee.job_title || '—'
        }</div>
          <div class="env-meta">${workerDepartment(row)}</div>
          <table>
            <tr><td>المرتب</td><td>${formatMoney(row.baseSalary)}</td></tr>
            <tr><td>الخصومات</td><td>${formatMoney(row.totalDeduction)}</td></tr>
          </table>
          <div class="env-net">الصافي: ${formatMoney(row.netPay)}</div>
        </div>`
      )
      .join('');
    const win = window.open('', '_blank', 'width=1000,height=800');
    if (!win) {
      addFlashMessage('فضلاً اسمح بالنوافذ المنبثقة للطباعة', 'danger');
      return;
    }
    win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8" />
      <title>كروت أظرف المرتبات</title>
      <style>
        body{font-family:Tahoma,Arial,sans-serif;padding:16px;color:#0f172a}
        .env{border:2px dashed #94a3b8;border-radius:12px;padding:14px;margin:0 10px 14px 0;width:320px;height:180px;display:inline-block;vertical-align:top;page-break-inside:avoid}
        .env-head{font-size:10px;color:#64748b;margin-bottom:4px}
        .env-name{font-size:17px;font-weight:bold;margin-bottom:2px}
        .env-meta{font-size:11px;color:#475569}
        .env table{width:100%;border-collapse:collapse;font-size:11px;margin:6px 0}
        .env td{border-bottom:1px solid #e2e8f0;padding:2px 0}
        .env td:last-child{text-align:left;font-family:monospace}
        .env-net{margin-top:4px;padding:5px;background:#ecfdf5;border:1px solid #6ee7b7;border-radius:8px;text-align:center;font-weight:bold;color:#047857;font-size:12px}
        @media print{.env{page-break-after:always}}
      </style></head><body>${cards}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-l from-emerald-600 to-teal-600 rounded-3xl p-5 text-white shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold text-emerald-50">
              إجمالي المرتبات المطلوب دفعها حالياً
            </p>
            <p className="text-3xl font-black mt-1 font-mono">{formatMoney(totals.netPay)}</p>
            <p className="text-[11px] font-bold text-emerald-50 mt-1">
              عدد العمال: {rows.length} — إجمالي المرتبات: {formatMoney(totals.baseSalary)} — إجمالي
              الخصومات: {formatMoney(totals.totalDeduction)}
            </p>
          </div>
          <button
            type="button"
            onClick={printAllEnvelopes}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-white text-emerald-700 text-[11px] font-black hover:bg-emerald-50 transition cursor-pointer shrink-0"
          >
            <Printer className="w-4 h-4" />
            طباعة كروت أظرف المرتبات للجميع PDF
          </button>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-slate-900">مسير مرتبات الشهر</h2>
            <p className="text-[11px] font-bold text-slate-500 mt-0.5">
              صافي المرتب = المرتب الشهري − (خصومات الحضور + الجزاءات + السُلف) على أساس 30 يوماً
              للشهر.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className={`${inputClass} font-mono w-auto`}
            />
            <button
              type="button"
              onClick={() => void loadPayrollData()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-[11px] font-black text-slate-700 hover:bg-slate-50 transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              تحديث
            </button>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-black text-slate-700">
            <Users className="w-3.5 h-3.5 text-purple-600" />
            عدد الموظفين: {rows.length}
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-50 border border-purple-200 text-[11px] font-black text-purple-700">
            <Banknote className="w-3.5 h-3.5" />
            إجمالي المرتبات: {formatMoney(totals.baseSalary)}
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] font-black text-rose-700">
            <AlertTriangle className="w-3.5 h-3.5" />
            إجمالي الخصومات: {formatMoney(totals.totalDeduction)}
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] font-black text-emerald-700">
            <Wallet className="w-3.5 h-3.5" />
            صافي المستحق: {formatMoney(totals.netPay)}
          </span>
        </div>

        {isLoading ? (
          <div className="p-10 text-center text-xs font-bold text-slate-400">جاري التحميل...</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <Users className="w-8 h-8 mx-auto text-slate-300 mb-2" />
            <p className="text-xs font-black text-slate-700">لا يوجد موظفون لحساب المرتبات</p>
            <p className="text-[11px] font-bold text-slate-500 mt-1">
              أضف الموظفين أولاً من قسم الموظفين لتتمكن من إنشاء مسير المرتبات.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-right px-4 py-2.5 font-black whitespace-nowrap">الموظف</th>
                  <th className="text-right px-4 py-2.5 font-black whitespace-nowrap">الوظيفة</th>
                  <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">
                    المرتب الشهري
                  </th>
                  <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">خصم حضور</th>
                  <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">جزاءات</th>
                  <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">سُلف</th>
                  <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">
                    إجمالي الخصم
                  </th>
                  <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">الصافي</th>
                  <th className="text-center px-4 py-2.5 font-black whitespace-nowrap">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.employee.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="font-black text-slate-900">{row.employee.name}</p>
                      <p className="font-bold text-[10px] text-slate-400 font-mono">
                        {row.employee.employee_code || '-'}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-600 whitespace-nowrap">
                      <p>{row.employee.job_title || '—'}</p>
                      <p className="text-[10px] text-slate-400">
                        {row.employee.department_label ||
                          (row.employee.department
                            ? HR_DEPARTMENT_LABELS[row.employee.department]
                            : '—')}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-black text-slate-800 whitespace-nowrap">
                      {formatMoney(row.baseSalary)}
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-bold text-rose-600 whitespace-nowrap">
                      <p>{formatMoney(row.attendanceDeduction)}</p>
                      <p className="text-[10px] text-slate-400">
                        {row.attendanceDays} يوم / {row.attendanceHours} ساعة
                      </p>
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-bold text-rose-600 whitespace-nowrap">
                      <p>{formatMoney(row.penaltyDeduction)}</p>
                      <p className="text-[10px] text-slate-400">
                        {row.penaltyDays} يوم / {row.penaltyHours} ساعة
                      </p>
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-bold text-rose-600 whitespace-nowrap">
                      {formatMoney(row.loanDeduction)}
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-black text-rose-700 whitespace-nowrap">
                      {formatMoney(row.totalDeduction)}
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-black whitespace-nowrap">
                      <span
                        className={
                          row.netPay >= 0
                            ? 'px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'px-2 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200'
                        }
                      >
                        {formatMoney(row.netPay)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => setWorkerSheet(row)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white text-[10px] font-black hover:bg-indigo-700 transition cursor-pointer whitespace-nowrap"
                      >
                        <FileText className="w-3 h-3" />
                        ورقة العامل
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50">
                <tr>
                  <td className="px-4 py-3 font-black text-slate-900" colSpan={2}>
                    الإجمالي
                  </td>
                  <td className="px-4 py-3 text-center font-mono font-black text-slate-900">
                    {formatMoney(totals.baseSalary)}
                  </td>
                  <td className="px-4 py-3 text-center font-mono font-black text-rose-700">
                    {formatMoney(totals.attendanceDeduction)}
                  </td>
                  <td className="px-4 py-3 text-center font-mono font-black text-rose-700">
                    {formatMoney(totals.penaltyDeduction)}
                  </td>
                  <td className="px-4 py-3 text-center font-mono font-black text-rose-700">
                    {formatMoney(totals.loanDeduction)}
                  </td>
                  <td className="px-4 py-3 text-center font-mono font-black text-rose-700">
                    {formatMoney(totals.totalDeduction)}
                  </td>
                  <td className="px-4 py-3 text-center font-mono font-black text-emerald-700">
                    {formatMoney(totals.netPay)}
                  </td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-start gap-2 px-4 py-3 rounded-2xl bg-blue-50 border border-blue-200 text-blue-800 text-[11px] font-bold">
        <Info className="w-4 h-4 shrink-0" />
        <span>
          يتم تجاهل سجلات الحضور التي حالتها «مرفوض» عند حساب الخصم، ويُحسب راتب اليوم = المرتب ÷ 30
          وراتب الساعة = راتب اليوم ÷ 8.
        </span>
      </div>

      {workerSheet && (
        <Modal
          title="ورقة مرتب عامل"
          subtitle={`${workerSheet.employee.name} — شهر ${month}`}
          onClose={() => setWorkerSheet(null)}
          maxWidthClass="max-w-2xl"
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'الموظف', value: workerSheet.employee.name },
                { label: 'الكود', value: workerSheet.employee.employee_code || '-' },
                { label: 'الوظيفة', value: workerSheet.employee.job_title || '—' },
                { label: 'القسم', value: workerDepartment(workerSheet) },
                { label: 'المرتب الشهري', value: formatMoney(workerSheet.baseSalary) },
                { label: 'الشهر', value: month }
              ].map((item) => (
                <div
                  key={item.label}
                  className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200"
                >
                  <p className="text-[10px] font-black text-slate-500">{item.label}</p>
                  <p className="text-[11px] font-black text-slate-800">{item.value}</p>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-slate-200 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="text-right px-3 py-2 font-black">البند</th>
                    <th className="text-center px-3 py-2 font-black">التفاصيل</th>
                    <th className="text-center px-3 py-2 font-black">القيمة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="px-3 py-2 font-bold text-slate-700">خصم الحضور</td>
                    <td className="px-3 py-2 text-center font-bold text-slate-600">
                      {workerSheet.attendanceDays} يوم / {workerSheet.attendanceHours} ساعة
                    </td>
                    <td className="px-3 py-2 text-center font-mono font-black text-rose-600">
                      {formatMoney(workerSheet.attendanceDeduction)}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-bold text-slate-700">الجزاءات</td>
                    <td className="px-3 py-2 text-center font-bold text-slate-600">
                      {workerSheet.penaltyDays} يوم / {workerSheet.penaltyHours} ساعة
                    </td>
                    <td className="px-3 py-2 text-center font-mono font-black text-rose-600">
                      {formatMoney(workerSheet.penaltyDeduction)}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-bold text-slate-700">السُلف</td>
                    <td className="px-3 py-2 text-center font-bold text-slate-600">—</td>
                    <td className="px-3 py-2 text-center font-mono font-black text-rose-600">
                      {formatMoney(workerSheet.loanDeduction)}
                    </td>
                  </tr>
                  <tr className="bg-slate-50/70">
                    <td className="px-3 py-2 font-black text-slate-800" colSpan={2}>
                      إجمالي الخصومات
                    </td>
                    <td className="px-3 py-2 text-center font-mono font-black text-rose-700">
                      {formatMoney(workerSheet.totalDeduction)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 px-4 py-3 text-center">
              <p className="text-[11px] font-black text-emerald-700">صافي المستحق</p>
              <p className="text-2xl font-black font-mono text-emerald-700">
                {formatMoney(workerSheet.netPay)}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setWorkerSheet(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-black hover:bg-slate-200 transition cursor-pointer"
              >
                إغلاق
              </button>
              <button
                type="button"
                onClick={() => printWorkerSheet(workerSheet)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-[11px] font-black hover:bg-indigo-700 transition cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                طباعة ورقة العامل
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};




