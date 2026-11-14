import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  ArrowRight,
  Search,
  Filter,
  X,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
  Building2,
  Activity,
  Globe,
  AlertCircle,
  History,
} from 'lucide-react';
import { api } from '../api/client';
import { COMPLETED_MODEL_MARKER, isCompletedModelAudit } from '../utils/completedModels';
import type { AuditLog, AuditLogFiltersMeta, AuditLogListResponse } from '../types';

interface AuditLogsViewProps {
  onBack: () => void;
}

const PAGE_SIZE = 50;
const HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));

const ACTION_TYPE_STYLES: Record<string, string> = {
  create: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  update: 'bg-amber-50 text-amber-700 border-amber-200',
  delete: 'bg-rose-50 text-rose-700 border-rose-200',
  status_change: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  transaction: 'bg-sky-50 text-sky-700 border-sky-200',
  settings: 'bg-violet-50 text-violet-700 border-violet-200',
  import: 'bg-teal-50 text-teal-700 border-teal-200',
  permission: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
  login: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  logout: 'bg-slate-100 text-slate-700 border-slate-200',
  upload: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  custom: 'bg-slate-100 text-slate-700 border-slate-200',
};

interface FilterState {
  search: string;
  date: string;
  dateFrom: string;
  dateTo: string;
  hourFrom: string;
  hourTo: string;
  user: string;
  section: string;
  actionType: string;
  ipAddress: string;
}

const EMPTY_FILTERS: FilterState = {
  search: '',
  date: '',
  dateFrom: '',
  dateTo: '',
  hourFrom: '',
  hourTo: '',
  user: '',
  section: '',
  actionType: '',
  ipAddress: '',
};

const EMPTY_META: AuditLogFiltersMeta = {
  users: [],
  sections: [],
  actionTypes: [],
  ipAddresses: [],
};

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100';
const labelClass = 'mb-1.5 block text-[11px] font-black text-slate-500';

export const AuditLogsView: React.FC<AuditLogsViewProps> = ({ onBack }) => {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [meta, setMeta] = useState<AuditLogFiltersMeta>(EMPTY_META);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(filters.search.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [filters.search]);

  useEffect(() => {
    let cancelled = false;
    api
      .getAuditLogFilters()
      .then((data: any) => {
        if (cancelled || !data) return;
        setMeta({
          users: Array.isArray(data.users) ? data.users : [],
          sections: Array.isArray(data.sections) ? data.sections : [],
          actionTypes: Array.isArray(data.actionTypes) ? data.actionTypes : [],
          ipAddresses: Array.isArray(data.ipAddresses) ? data.ipAddresses : [],
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError('');
    api
      .getAuditLogs({
        search: debouncedSearch,
        date: filters.date,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        hour_from: filters.hourFrom,
        hour_to: filters.hourTo,
        user: filters.user,
        section: filters.section,
        action_type: filters.actionType,
        ip_address: filters.ipAddress,
        page,
        page_size: PAGE_SIZE,
      })
      .then((data: any) => {
        if (cancelled) return;
        if (Array.isArray(data)) {
          setLogs(data);
          setTotalCount(data.length);
          return;
        }
        const payload = data as AuditLogListResponse;
        setLogs(Array.isArray(payload.results) ? payload.results : []);
        setTotalCount(typeof payload.count === 'number' ? payload.count : 0);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setLogs([]);
        setTotalCount(0);
        setError(err?.message || 'تعذر تحميل سجلات المراقبة');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    debouncedSearch,
    filters.date,
    filters.dateFrom,
    filters.dateTo,
    filters.hourFrom,
    filters.hourTo,
    filters.user,
    filters.section,
    filters.actionType,
    filters.ipAddress,
    page,
    reloadKey,
  ]);

  const updateFilter = useCallback((key: keyof FilterState, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    if (key !== 'search') {
      setPage(1);
    }
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setDebouncedSearch('');
    setPage(1);
  }, []);

  const activeFiltersCount = useMemo(
    () =>
      Object.entries(filters).filter(
        ([key, value]) => key !== 'search' && String(value).trim() !== ''
      ).length + (filters.search.trim() ? 1 : 0),
    [filters]
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const canGoPrev = page > 1;
  const canGoNext = page < totalPages;

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-emerald-600" />
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">
              🕵️ سجل المراقبة وتتبع العمليات
            </h2>
            <p className="text-xs font-bold text-slate-400 mt-1">
              مراقبة شاملة لكل إجراء في النظام مع فروقات الحقول (القديم ➡️ الجديد)
            </p>
          </div>
        </div>

        <button
          onClick={onBack}
          className="flex items-center gap-2 px-5 py-2 rounded-full border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs shadow-xs transition"
        >
          <ArrowRight className="w-4 h-4" />
          <span>← العودة للإعدادات</span>
        </button>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs p-4 md:p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-slate-800 font-black text-sm">
            <Filter className="w-4 h-4 text-emerald-600" />
            <span>فلاتر المراقبة</span>
            {activeFiltersCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px]">
                {activeFiltersCount} نشط
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setReloadKey((key) => key + 1)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-bold text-[11px] transition"
              title="تحديث السجلات"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              تحديث
            </button>
            <button
              type="button"
              onClick={clearFilters}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-[11px] transition"
            >
              <X className="w-3.5 h-3.5" />
              مسح كل الفلاتر
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <label className={labelClass}>بحث شامل</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
              <input
                value={filters.search}
                onChange={(event) => updateFilter('search', event.target.value)}
                placeholder="اسم المستخدم، القسم، التفاصيل، العنصر، IP..."
                className={`${inputClass} ps-9`}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>اليوم</label>
            <input
              type="date"
              value={filters.date}
              onChange={(event) => updateFilter('date', event.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>عنوان IP</label>
            <div className="relative">
              <Globe className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
              <input
                value={filters.ipAddress}
                onChange={(event) => updateFilter('ipAddress', event.target.value)}
                placeholder="127.0.0.1"
                dir="ltr"
                className={`${inputClass} ps-9 text-left`}
              />
            </div>
          </div>


          <div>
            <label className={labelClass}>من تاريخ</label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(event) => updateFilter('dateFrom', event.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>إلى تاريخ</label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(event) => updateFilter('dateTo', event.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>من الساعة</label>
            <select
              value={filters.hourFrom}
              onChange={(event) => updateFilter('hourFrom', event.target.value)}
              className={inputClass}
            >
              <option value="">كل الساعات</option>
              {HOURS.map((hour) => (
                <option key={`from-${hour}`} value={hour}>
                  {hour}:00
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>إلى الساعة</label>
            <select
              value={filters.hourTo}
              onChange={(event) => updateFilter('hourTo', event.target.value)}
              className={inputClass}
            >
              <option value="">كل الساعات</option>
              {HOURS.map((hour) => (
                <option key={`to-${hour}`} value={hour}>
                  {hour}:00
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>المستخدم</label>
            <select
              value={filters.user}
              onChange={(event) => updateFilter('user', event.target.value)}
              className={inputClass}
            >
              <option value="">كل المستخدمين</option>
              {meta.users.map((user) => (
                <option key={user.id || user.name} value={user.id || user.name}>
                  {user.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>القسم</label>
            <select
              value={filters.section}
              onChange={(event) => updateFilter('section', event.target.value)}
              className={inputClass}
            >
              <option value="">كل الأقسام</option>
              {meta.sections.map((section) => (
                <option key={section} value={section}>
                  {section}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>نوع الإجراء</label>
            <select
              value={filters.actionType}
              onChange={(event) => updateFilter('actionType', event.target.value)}
              className={inputClass}
            >
              <option value="">كل الأنواع</option>
              {meta.actionTypes.map((actionType) => (
                <option key={actionType.key} value={actionType.key}>
                  {actionType.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>


      <div className="flex items-center justify-between gap-2 flex-wrap text-xs font-bold text-slate-500">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-600" />
          <span>
            إجمالي السجلات المطابقة: <span className="text-slate-900">{totalCount}</span>
          </span>
          {isLoading && <span className="text-emerald-600">جاري التحديث…</span>}
        </div>
        {totalCount > 0 && (
          <span>
            صفحة {page} من {totalPages}
          </span>
        )}
      </div>

      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-center min-w-[1100px]">
            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
              <tr>
                <th className="px-4 py-3.5 text-center whitespace-nowrap">التاريخ والوقت</th>
                <th className="px-4 py-3.5 text-start">المستخدم</th>
                <th className="px-4 py-3.5 text-center">القسم</th>
                <th className="px-4 py-3.5 text-center">نوع الإجراء</th>
                <th className="px-4 py-3.5 text-start">التفاصيل والتغييرات (قديم ➡️ جديد)</th>
                <th className="px-4 py-3.5 text-center">IP Address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-slate-400 font-bold">
                    جاري تحميل سجلات المراقبة…
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={6} className="py-10">
                    <div className="flex flex-col items-center gap-2 text-rose-600 font-bold">
                      <AlertCircle className="w-6 h-6" />
                      <span>{error}</span>
                      <button
                        type="button"
                        onClick={() => setReloadKey((key) => key + 1)}
                        className="px-4 py-1.5 rounded-full border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px]"
                      >
                        إعادة المحاولة
                      </button>
                    </div>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-slate-400 font-bold">
                    لا توجد سجلات مطابقة للفلاتر الحالية.
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const isCompletedEdit = isCompletedModelAudit(log.details);
                  return (
                  <tr
                    key={log.id}
                    className={`hover:bg-slate-50/70 transition align-top ${
                      isCompletedEdit ? 'bg-amber-50/50' : ''
                    }`}
                  >
                    <td dir="ltr" className="px-4 py-3.5 text-slate-500 font-mono whitespace-nowrap">
                      {log.timestamp || '—'}
                    </td>
                    <td className="px-4 py-3.5 text-start">
                      <div className="font-bold text-slate-900">
                        {log.userFullName || log.userName}
                      </div>
                      {log.userFullName && log.userName && log.userFullName !== log.userName && (
                        <div dir="ltr" className="text-[11px] text-slate-400 font-mono text-start">
                          @{log.userName}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 font-bold text-[11px]">
                        <Building2 className="w-3 h-3" />
                        {log.section || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border font-bold text-[11px] ${
                          ACTION_TYPE_STYLES[log.actionType || ''] ||
                          'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        <Activity className="w-3 h-3" />
                        {log.action || '—'}
                      </span>
                      {log.targetName && (
                        <div className="mt-1 text-[11px] text-slate-500 font-bold">
                          {log.targetName}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-start max-w-xl">
                      {isCompletedEdit && (
                        <span className="mb-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-black">
                          <History className="w-3 h-3" />
                          موديل منتهي
                        </span>
                      )}
                      <div
                        className={`leading-6 font-medium ${
                          isCompletedEdit ? 'text-amber-900' : 'text-slate-700'
                        }`}
                      >
                        {(log.details || '—').split(COMPLETED_MODEL_MARKER).join('').trim() || '—'}
                      </div>
                      {log.changes && log.changes.length > 0 && (
                        <ul className="mt-2 space-y-1.5">
                          {log.changes.map((change, index) => (
                            <li
                              key={`${log.id}-${change.field}-${index}`}
                              className="flex flex-wrap items-center gap-1.5 text-[11px]"
                            >
                              <span className="font-bold text-slate-600">{change.label}:</span>
                              <span className="px-1.5 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-100 line-through decoration-rose-300">
                                {change.old || '—'}
                              </span>
                              <span className="text-slate-400">➡️</span>
                              <span className="px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-100">
                                {change.new || '—'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td dir="ltr" className="px-4 py-3.5 text-slate-400 font-mono whitespace-nowrap">
                      {log.ip_address || '—'}
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-slate-500 font-bold">
          عرض {logs.length} من إجمالي <span className="text-slate-900">{totalCount}</span> سجل
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!canGoPrev || isLoading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            <ChevronRight className="w-4 h-4" />
            السابق
          </button>
          <span className="px-3 py-2 rounded-full bg-slate-900 text-white font-bold text-xs">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={!canGoNext || isLoading}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            التالي
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

