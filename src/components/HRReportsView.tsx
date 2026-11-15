import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coins,
  Loader2,
  Printer,
  RefreshCw,
  Scale,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  X
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../api/client';
import { escapeHtml, renderLogoHtml } from '../utils/printShared';
import type {
  HRAttendanceSettings,
  HRReportDepartmentRow,
  HRReportLoanItem,
  HRReportMonthRow,
  HRReportsPayload,
  HRWeekDayKey
} from '../types';

const MONTH_LABELS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];
const WEEK_DAY_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const WEEK_DAYS_SHORT = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'];

/** مفاتيح أيام الأسبوع وفق Date.getDay() (0=الأحد ... 6=السبت). */
const WEEK_DAY_KEYS: HRWeekDayKey[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
];
/** الافتراضي: الأحد (Date.getDay() = 0). */
const DEFAULT_WEEKLY_OFF_INDEX = 0;

/** رقم يوم الإجازة الأسبوعية وفق Date.getDay() من قيمة إعدادات الحضور. */
const weeklyOffIndexFromKey = (key?: string | null): number => {
  const index = WEEK_DAY_KEYS.indexOf((key || 'Sunday') as HRWeekDayKey);
  return index >= 0 ? index : DEFAULT_WEEKLY_OFF_INDEX;
};

const pad2 = (value: number) => String(value).padStart(2, '0');
const monthKeyOf = (year: number, monthIndex: number) => `${year}-${pad2(monthIndex + 1)}`;
const formatMoney = (value: number) =>
  `${Math.round(Number(value) || 0).toLocaleString('en-US')} ج.م`;
const formatNumber = (value: number) =>
  (Number(value) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const formatInt = (value: number) => (Number(value) || 0).toLocaleString('en-US');

const monthLabel = (monthKey: string) => {
  const month = Number(monthKey.slice(5, 7));
  return MONTH_LABELS_AR[month - 1] || monthKey;
};
const formatDayLabel = (iso: string) => {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return `${WEEK_DAY_AR[parsed.getDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
};

/**
 * أيام الشهر مرتبة داخل شبكة سبعة أعمدة تبدأ من يوم الإجازة الأسبوعية
 * (الأحد افتراضياً) لأن الأسبوع يُحسب حتى يوم الإجازة.
 */
const buildMonthCells = (
  year: number,
  monthIndex: number,
  weekStartIndex: number = DEFAULT_WEEKLY_OFF_INDEX
): (string | null)[] => {
  const firstDayIndex = new Date(year, monthIndex, 1).getDay();
  const leading = (firstDayIndex - weekStartIndex + 7) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let index = 0; index < leading; index += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${year}-${pad2(monthIndex + 1)}-${pad2(day)}`);
  }
  return cells;
};

/** تسميات أيام الأسبوع مرتبة بدءاً من يوم الإجازة الأسبوعية. */
const rotateWeekLabels = (weekStartIndex: number): string[] => [
  ...WEEK_DAYS_SHORT.slice(weekStartIndex),
  ...WEEK_DAYS_SHORT.slice(0, weekStartIndex)
];

export const HRReportsView: React.FC = () => {
  const { addFlashMessage, globalSettings, canAccessHRSection } = useApp();

  const today = useMemo(() => new Date(), []);
  const currentMonth = monthKeyOf(today.getFullYear(), today.getMonth());
  const fiveMonthsAgo = (() => {
    const cursor = new Date(today.getFullYear(), today.getMonth() - 5, 1);
    return monthKeyOf(cursor.getFullYear(), cursor.getMonth());
  })();

  const [year, setYear] = useState(today.getFullYear());
  const [rangeFrom, setRangeFrom] = useState(fiveMonthsAgo);
  const [rangeTo, setRangeTo] = useState(currentMonth);
  const [payload, setPayload] = useState<HRReportsPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [openMonth, setOpenMonth] = useState<string | null>(null);
  // يوم الإجازة الأسبوعية من إعدادات الحضور — يحدد بداية شبكة الأسبوع في التقويم.
  const [weeklyOffIndex, setWeeklyOffIndex] = useState<number>(DEFAULT_WEEKLY_OFF_INDEX);

  const canView = canAccessHRSection('reports') || canAccessHRSection('payroll');

  const loadReport = useCallback(async () => {
    if (!canView) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const response = await api.getHRReports({ year, from: rangeFrom, to: rangeTo });
      setPayload(response as HRReportsPayload);
    } catch (err: any) {
      setError(err?.message || 'فشل تحميل تقارير وتحليلات الموارد البشرية');
    } finally {
      setIsLoading(false);
    }
  }, [canView, year, rangeFrom, rangeTo]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  // جلب إعدادات الحضور مرة واحدة لمعرفة يوم الإجازة الأسبوعية المعتمد.
  useEffect(() => {
    let active = true;
    api
      .getHRAttendanceSettings()
      .then((settings: HRAttendanceSettings | null) => {
        if (!active) return;
        setWeeklyOffIndex(weeklyOffIndexFromKey(settings?.weekly_off_day));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const loansByDay = payload?.loans_by_day || {};
  const loansSummary = payload?.loans_summary;
  const annualMonths = payload?.annual.months || [];
  const comparisonRows = payload?.range.comparison || [];
  const departmentRows = payload?.range.department_breakdown || [];
  const discipline = payload?.range.discipline;

  const maxDayTotal = useMemo(
    () => Object.values(loansByDay).reduce((max, day) => Math.max(max, day.total), 0),
    [loansByDay]
  );

  const monthLoanTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    Object.values(loansByDay).forEach((day) => {
      const key = day.date.slice(0, 7);
      totals[key] = (totals[key] || 0) + day.total;
    });
    return totals;
  }, [loansByDay]);

  const maxAnnualNet = useMemo(
    () => Math.max(1, ...annualMonths.map((row) => row.net_paid)),
    [annualMonths]
  );
  const maxRangeNet = useMemo(
    () => Math.max(1, ...comparisonRows.map((row) => row.net)),
    [comparisonRows]
  );
  const rangeTotalNet = useMemo(
    () => comparisonRows.reduce((sum, row) => sum + row.net, 0),
    [comparisonRows]
  );
  const rangeTotalLoans = useMemo(
    () => comparisonRows.reduce((sum, row) => sum + row.loans, 0),
    [comparisonRows]
  );
  const rangeTotalDeductions = useMemo(
    () => comparisonRows.reduce((sum, row) => sum + row.deductions, 0),
    [comparisonRows]
  );

  const heatStyle = (total: number): React.CSSProperties => {
    if (!total) return {};
    const ratio = maxDayTotal > 0 ? total / maxDayTotal : 0;
    const alpha = 0.18 + ratio * 0.72;
    return {
      backgroundColor: `rgba(126, 34, 206, ${alpha.toFixed(2)})`,
      color: alpha > 0.55 ? '#ffffff' : '#3b0764'
    };
  };

  const openDayModal = (iso: string) => {
    const day = loansByDay[iso];
    if (!day || day.count === 0) {
      addFlashMessage(`لا توجد سُلف مسجلة يوم ${formatDayLabel(iso)}`, 'info');
      return;
    }
    setOpenDay(iso);
  };


  const handlePrint = () => {
    if (!payload) return;
    const win = window.open('', '_blank', 'width=1100,height=820');
    if (!win) {
      addFlashMessage('فضلاً اسمح بالنوافذ المنبثقة لطباعة التقرير', 'danger');
      return;
    }

    const monthlyRowsHtml = annualMonths
      .map(
        (row) => `<tr>
          <td>${escapeHtml(row.label)}</td>
          <td>${formatInt(row.active_workers)}</td>
          <td>${formatNumber(row.earned_salary)}</td>
          <td>${formatNumber(row.overtime_bonus)}</td>
          <td>${formatNumber(row.loans)}</td>
          <td>${formatNumber(row.deductions)}</td>
          <td><strong>${formatNumber(row.net_paid)}</strong></td>
        </tr>`
      )
      .join('');

    const comparisonRowsHtml = comparisonRows
      .map(
        (row) => `<tr>
          <td>${escapeHtml(row.label)}</td>
          <td>${formatNumber(row.net)}</td>
          <td>${formatNumber(row.loans)}</td>
          <td>${formatNumber(row.deductions)}</td>
          <td>${row.net_change_pct === null ? '—' : `${row.net_change_pct}%`}</td>
        </tr>`
      )
      .join('');

    const departmentRowsHtml = departmentRows
      .map(
        (row) => `<tr>
          <td>${escapeHtml(row.label)}</td>
          <td>${formatInt(row.workers)}</td>
          <td>${formatNumber(row.net)}</td>
          <td>${formatNumber(row.loans)}</td>
          <td>${formatNumber(row.deductions)}</td>
          <td>${row.percent}%</td>
        </tr>`
      )
      .join('');

    const disciplineRows = (
      rows: { name: string; department_label?: string; department?: string; present_days: number; absent_days: number; late_minutes: number }[]
    ) =>
      rows
        .map(
          (row) => `<tr>
            <td>${escapeHtml(row.name)}</td>
            <td>${escapeHtml(row.department_label || row.department || '-')}</td>
            <td>${formatInt(row.present_days)}</td>
            <td>${formatInt(row.absent_days)}</td>
            <td>${Math.round(Number(row.late_minutes) || 0)}</td>
          </tr>`
        )
        .join('');

    const kpis = payload.annual.kpis;
    const worst = discipline?.worst_department;

    win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8" />
      <title>تقرير الموارد البشرية ${year}</title>
      <style>
        @page{size:A4 portrait;margin:8mm}
        *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        body{font-family:Tahoma,Arial,sans-serif;padding:18px;color:#0f172a;font-size:11px}
        .brand{text-align:center;margin-bottom:4px}
        h1{font-size:17px;margin:0 0 4px;text-align:center}
        p.meta{font-size:11px;color:#64748b;margin:0 0 12px;text-align:center}
        h2{font-size:13px;margin:14px 0 6px;border-right:4px solid #7e22ce;padding-right:8px}
        table{width:100%;border-collapse:collapse;font-size:10.5px;margin-bottom:6px}
        th,td{border:1px solid #cbd5e1;padding:4px 6px;text-align:center}
        th{background:#f1f5f9}
        .kpis{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
        .kpi{border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;flex:1 1 150px}
        .kpi span{display:block;font-size:9.5px;color:#64748b}
        .kpi strong{font-size:12px}
        .note{font-size:10px;color:#64748b;margin:4px 0 0}
      </style></head><body>
      <div class="brand">${renderLogoHtml(globalSettings.logo, globalSettings.site_name, 44)}</div>
      <h1>${escapeHtml(globalSettings.site_name || 'مصنع الملابس الجاهزة')} — تقرير الموارد البشرية ${year}</h1>
      <p class="meta">فترة المقارنة: ${escapeHtml(payload.range.from)} → ${escapeHtml(payload.range.to)} — عدد العمال النشطين: ${formatInt(kpis.active_workers)}</p>

      <h2>مؤشرات الأداء السنوية</h2>
      <div class="kpis">
        <div class="kpi"><span>إجمالي الرواتب المصروفة</span><strong>${formatMoney(kpis.net_salary_total)}</strong></div>
        <div class="kpi"><span>إجمالي السُلف</span><strong>${formatMoney(kpis.loans_total)}</strong></div>
        <div class="kpi"><span>إجمالي الإضافي</span><strong>${formatMoney(kpis.overtime_bonus_total)}</strong></div>
        <div class="kpi"><span>إجمالي الخصومات</span><strong>${formatMoney(kpis.deductions_total)}</strong></div>
        <div class="kpi"><span>متوسط التكلفة الشهرية</span><strong>${formatMoney(kpis.avg_monthly_labor_cost)}</strong></div>
        <div class="kpi"><span>سُلف الأسبوع</span><strong>${formatMoney(loansSummary?.week_total || 0)}</strong></div>
      </div>

      <h2>التقرير السنوي (${year})</h2>
      <table><thead><tr><th>الشهر</th><th>عدد العمال</th><th>الأجر المكتسب</th><th>الإضافي</th><th>السُلف</th><th>الخصومات</th><th>الصافي</th></tr></thead>
      <tbody>${monthlyRowsHtml || '<tr><td colspan="7">لا توجد بيانات</td></tr>'}</tbody></table>

      <h2>مقارنة الشهور</h2>
      <table><thead><tr><th>الشهر</th><th>الصافي</th><th>السُلف</th><th>الخصومات</th><th>نسبة التغير</th></tr></thead>
      <tbody>${comparisonRowsHtml || '<tr><td colspan="5">لا توجد بيانات</td></tr>'}</tbody></table>

      <h2>توزيع تكلفة العمالة حسب القسم</h2>
      <table><thead><tr><th>القسم</th><th>عدد العمال</th><th>الصافي</th><th>السُلف</th><th>الخصومات</th><th>النسبة</th></tr></thead>
      <tbody>${departmentRowsHtml || '<tr><td colspan="6">لا توجد بيانات</td></tr>'}</tbody></table>

      <h2>الالتزام والانضباط</h2>
      <table><thead><tr><th>الموظف</th><th>القسم</th><th>أيام الحضور</th><th>أيام الغياب</th><th>دقائق التأخير</th></tr></thead>
      <tbody>${disciplineRows(discipline?.most_committed || []) || '<tr><td colspan="5">لا توجد بيانات</td></tr>'}</tbody></table>
      <p class="note">أكثر قسم غياباً: ${worst ? `${escapeHtml(worst.label)} (${worst.absent_count} يوم غياب)` : 'لا يوجد'} — إجمالي سُلف الفترة: ${formatMoney(rangeTotalLoans)} — إجمالي الخصومات: ${formatMoney(rangeTotalDeductions)}</p>
      </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };


  const selectedDayLoans: HRReportLoanItem[] =
    openDay && loansByDay[openDay] ? loansByDay[openDay].items : [];
  const selectedDay = openDay ? loansByDay[openDay] : null;

  const selectedMonthRow: HRReportMonthRow | null =
    (openMonth && annualMonths.find((row) => row.month === openMonth)) || null;
  const selectedMonthDepartments: HRReportDepartmentRow[] =
    (openMonth && payload?.annual.monthly_departments[openMonth]) || [];


  if (!canView) {
    return (
      <div className="rounded-3xl border border-rose-200 bg-rose-50 p-8 text-center" dir="rtl">
        <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-rose-500" />
        <p className="text-sm font-black text-rose-700">لا تملك صلاحية عرض تقارير وتحليلات الموارد البشرية</p>
        <p className="mt-1 text-xs font-bold text-rose-500">تواصل مع السودو لمنحك صلاحية «تقارير الموارد البشرية».</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-purple-100 text-purple-700">
            <BarChart3 className="h-6 w-6" />
          </span>
          <div>
            <h2 className="text-lg font-black text-slate-800">تقارير وتحليلات الموارد البشرية</h2>
            <p className="text-xs font-bold text-slate-500">خريطة السُلف، التقرير السنوي، مقارنة الشهور، الأقسام والانضباط</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrint}
            disabled={!payload}
            className="inline-flex items-center gap-2 rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-xs font-black text-purple-700 transition hover:bg-purple-100 disabled:opacity-50"
          >
            <Printer className="h-4 w-4" /> طباعة A4
          </button>
          <button
            type="button"
            onClick={() => void loadReport()}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> تحديث
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
          <p className="text-xs font-black text-rose-700">{error}</p>
          <button type="button" onClick={() => void loadReport()} className="rounded-lg bg-rose-600 px-3 py-1 text-[11px] font-black text-white">
            إعادة المحاولة
          </button>
        </div>
      )}

      {isLoading && !payload ? (
        <div className="grid place-items-center rounded-3xl border border-slate-200 bg-white py-20">
          <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
          <p className="mt-3 text-xs font-black text-slate-500">جارٍ تجميع التقارير من قاعدة البيانات…</p>
        </div>
      ) : (
        <>

          {/* ═══════════ 1) خريطة حرارة السُلف ═══════════ */}
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-purple-600" />
                <h3 className="text-sm font-black text-slate-800">خريطة صرف السُلف اليومية</h3>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setYear((value) => Math.max(2000, value - 1))}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                  title="السنة السابقة"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <select
                  value={year}
                  onChange={(event) => setYear(Number(event.target.value))}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-black text-slate-700"
                >
                  {(payload?.available_years?.length ? payload.available_years : [today.getFullYear()]).map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setYear((value) => value + 1)}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                  title="السنة التالية"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-purple-100 bg-purple-50/70 p-4">
                <p className="text-[11px] font-black text-purple-700">سُلف الأسبوع الحالي</p>
                <p className="mt-1 text-lg font-black text-purple-900">{formatMoney(loansSummary?.week_total || 0)}</p>
                <p className="mt-1 text-[10px] font-bold text-purple-600">
                  {loansSummary?.week_count || 0} صرف • {loansSummary?.week_from || '—'} → {loansSummary?.week_to || '—'}
                </p>
              </div>
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
                <p className="text-[11px] font-black text-indigo-700">سُلف الشهر الحالي</p>
                <p className="mt-1 text-lg font-black text-indigo-900">{formatMoney(loansSummary?.month_total || 0)}</p>
                <p className="mt-1 text-[10px] font-bold text-indigo-600">
                  {loansSummary?.month_count || 0} صرف • {monthLabel(loansSummary?.month_key || currentMonth)}
                </p>
              </div>
              <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-4">
                <p className="text-[11px] font-black text-amber-700">أعلى يوم صرف في {year}</p>
                <p className="mt-1 text-lg font-black text-amber-900">{formatMoney(loansSummary?.top_day?.total || 0)}</p>
                <p className="mt-1 text-[10px] font-bold text-amber-600">
                  {loansSummary?.top_day
                    ? `${formatDayLabel(loansSummary.top_day.date)} • ${loansSummary.top_day.count} موظف`
                    : 'لا توجد سُلف مسجلة'}
                </p>
              </div>
            </div>



            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 12 }).map((_, monthIndex) => {
                const cells = buildMonthCells(year, monthIndex, weeklyOffIndex);
                const monthKey = monthKeyOf(year, monthIndex);
                return (
                  <div key={monthKey} className="rounded-2xl border border-slate-200 bg-slate-50/40 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[11px] font-black text-slate-700">{MONTH_LABELS_AR[monthIndex]}</span>
                      <span className="text-[10px] font-black text-purple-700">{formatMoney(monthLoanTotals[monthKey] || 0)}</span>
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {rotateWeekLabels(weeklyOffIndex).map((label, index) => (
                        <span key={`${monthKey}-head-${index}`} className="text-center text-[9px] font-black text-slate-400">{label}</span>
                      ))}
                      {cells.map((iso, index) => {
                        if (!iso) return <span key={`${monthKey}-empty-${index}`} aria-hidden="true" />;
                        const day = loansByDay[iso];
                        const total = day?.total || 0;
                        return (
                          <button
                            key={iso}
                            type="button"
                            onClick={() => openDayModal(iso)}
                            style={heatStyle(total)}
                            title={`${formatDayLabel(iso)}${total ? ` — ${formatMoney(total)} (${day?.count || 0} موظف)` : ''}`}
                            className={`h-6 rounded-md text-[9px] font-black transition ${total ? 'shadow-sm hover:opacity-80' : 'bg-white text-slate-400 hover:bg-slate-100'}`}
                          >
                            {Number(iso.slice(8, 10))}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-bold text-slate-500">
              <span>شدة اللون:</span>
              {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
                <span
                  key={`legend-${ratio}`}
                  className="inline-block h-3 w-6 rounded"
                  style={ratio === 0 ? { backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' } : heatStyle(ratio * maxDayTotal)}
                />
              ))}
              <span>اضغط على أي يوم لعرض تفاصيل الصرف</span>
            </div>
          </section>

          {/* ═══════════ 2) التقرير السنوي ═══════════ */}
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-emerald-600" />
                <h3 className="text-sm font-black text-slate-800">التقرير السنوي {year}</h3>
              </div>
              <span className="text-[10px] font-bold text-slate-400">اضغط على أي شهر لعرض التفاصيل حسب القسم</span>
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3">
                <div className="flex items-center gap-1.5 text-emerald-700">
                  <Wallet className="h-4 w-4" />
                  <p className="text-[10px] font-black">إجمالي الرواتب</p>
                </div>
                <p className="mt-1 text-sm font-black text-emerald-900">{formatMoney(payload?.annual.kpis.net_salary_total || 0)}</p>
              </div>
              <div className="rounded-2xl border border-purple-100 bg-purple-50/70 p-3">
                <div className="flex items-center gap-1.5 text-purple-700">
                  <Coins className="h-4 w-4" />
                  <p className="text-[10px] font-black">إجمالي السُلف</p>
                </div>
                <p className="mt-1 text-sm font-black text-purple-900">{formatMoney(payload?.annual.kpis.loans_total || 0)}</p>
              </div>
              <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-3">
                <div className="flex items-center gap-1.5 text-sky-700">
                  <TrendingUp className="h-4 w-4" />
                  <p className="text-[10px] font-black">إجمالي الإضافي</p>
                </div>
                <p className="mt-1 text-sm font-black text-sky-900">{formatMoney(payload?.annual.kpis.overtime_bonus_total || 0)}</p>
              </div>
              <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-3">
                <div className="flex items-center gap-1.5 text-rose-700">
                  <TrendingDown className="h-4 w-4" />
                  <p className="text-[10px] font-black">إجمالي الخصومات</p>
                </div>
                <p className="mt-1 text-sm font-black text-rose-900">{formatMoney(payload?.annual.kpis.deductions_total || 0)}</p>
              </div>
              <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-3">
                <div className="flex items-center gap-1.5 text-amber-700">
                  <Scale className="h-4 w-4" />
                  <p className="text-[10px] font-black">متوسط التكلفة الشهرية</p>
                </div>
                <p className="mt-1 text-sm font-black text-amber-900">{formatMoney(payload?.annual.kpis.avg_monthly_labor_cost || 0)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center gap-1.5 text-slate-700">
                  <Users className="h-4 w-4" />
                  <p className="text-[10px] font-black">عدد العمال النشطين</p>
                </div>
                <p className="mt-1 text-sm font-black text-slate-900">{formatInt(payload?.annual.kpis.active_workers || 0)}</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-right text-[11px]">
                <thead>
                  <tr className="bg-slate-100 text-slate-600">
                    <th className="rounded-r-xl px-3 py-2 font-black">الشهر</th>
                    <th className="px-3 py-2 font-black">عدد العمال</th>
                    <th className="px-3 py-2 font-black">الأجر المكتسب</th>
                    <th className="px-3 py-2 font-black">الإضافي</th>
                    <th className="px-3 py-2 font-black">السُلف</th>
                    <th className="px-3 py-2 font-black">الخصومات</th>
                    <th className="rounded-l-xl px-3 py-2 font-black">الصافي</th>
                  </tr>
                </thead>
                <tbody>
                  {annualMonths.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center font-bold text-slate-400">لا توجد بيانات لهذه السنة</td>
                    </tr>
                  )}
                  {annualMonths.map((row) => (
                    <tr
                      key={row.month}
                      onClick={() => setOpenMonth(row.month)}
                      className="cursor-pointer border-b border-slate-100 text-slate-700 transition hover:bg-purple-50/60"
                      title={`عرض تفاصيل ${row.label} حسب القسم`}
                    >
                      <td className="px-3 py-2 font-black">{row.label}</td>
                      <td className="px-3 py-2">{formatInt(row.active_workers)}</td>
                      <td className="px-3 py-2">{formatNumber(row.earned_salary)}</td>
                      <td className="px-3 py-2 text-sky-700">{formatNumber(row.overtime_bonus)}</td>
                      <td className="px-3 py-2 text-purple-700">{formatNumber(row.loans)}</td>
                      <td className="px-3 py-2 text-rose-700">{formatNumber(row.deductions)}</td>
                      <td className="px-3 py-2 font-black text-slate-900">{formatMoney(row.net_paid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 space-y-1.5">
              {annualMonths.map((row) => (
                <button
                  key={`bar-${row.month}`}
                  type="button"
                  onClick={() => setOpenMonth(row.month)}
                  className="flex w-full items-center gap-2 text-right"
                >
                  <span className="w-14 shrink-0 text-[10px] font-black text-slate-500">{row.label}</span>
                  <span className="relative h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <span
                      className="absolute inset-y-0 right-0 rounded-full bg-gradient-to-l from-purple-500 to-purple-400"
                      style={{ width: `${Math.max(2, (row.net_paid / maxAnnualNet) * 100)}%` }}
                    />
                  </span>
                  <span className="w-24 shrink-0 text-[10px] font-black text-slate-700">{formatMoney(row.net_paid)}</span>
                </button>
              ))}
            </div>
          </section>

          {/* ═══════════ 3) مقارنة الشهور ═══════════ */}
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Scale className="h-5 w-5 text-indigo-600" />
                <h3 className="text-sm font-black text-slate-800">مقارنة الشهور — صافي تكلفة العمالة</h3>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-[10px] font-black text-slate-500">
                  من
                  <input
                    type="month"
                    value={rangeFrom}
                    onChange={(event) => setRangeFrom(event.target.value || currentMonth)}
                    className="h-8 rounded-lg border border-slate-200 px-2 text-xs font-black text-slate-700"
                  />
                </label>
                <label className="flex items-center gap-1 text-[10px] font-black text-slate-500">
                  إلى
                  <input
                    type="month"
                    value={rangeTo}
                    onChange={(event) => setRangeTo(event.target.value || currentMonth)}
                    className="h-8 rounded-lg border border-slate-200 px-2 text-xs font-black text-slate-700"
                  />
                </label>
              </div>
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
                <p className="text-[11px] font-black text-indigo-700">إجمالي الصافي للفترة</p>
                <p className="mt-1 text-lg font-black text-indigo-900">{formatMoney(rangeTotalNet)}</p>
              </div>
              <div className="rounded-2xl border border-purple-100 bg-purple-50/70 p-4">
                <p className="text-[11px] font-black text-purple-700">إجمالي السُلف للفترة</p>
                <p className="mt-1 text-lg font-black text-purple-900">{formatMoney(rangeTotalLoans)}</p>
              </div>
              <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-4">
                <p className="text-[11px] font-black text-rose-700">إجمالي الخصومات للفترة</p>
                <p className="mt-1 text-lg font-black text-rose-900">{formatMoney(rangeTotalDeductions)}</p>
              </div>
            </div>

            <div className="space-y-2">
              {comparisonRows.length === 0 && (
                <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-xs font-bold text-slate-400">
                  لا توجد بيانات في الفترة المحددة
                </p>
              )}
              {comparisonRows.map((row) => {
                const isUp = row.net_change_pct !== null && row.net_change_pct > 0;
                const isDown = row.net_change_pct !== null && row.net_change_pct < 0;
                return (
                  <div key={`cmp-${row.month}`} className="rounded-2xl border border-slate-100 bg-slate-50/50 p-2.5">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-black text-slate-700">{row.label}</span>
                      <div className="flex items-center gap-2">
                        {row.net_change_pct !== null && (
                          <span
                            className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-black ${
                              isUp
                                ? 'bg-rose-100 text-rose-700'
                                : isDown
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-slate-200 text-slate-600'
                            }`}
                          >
                            {isUp ? <TrendingUp className="h-3 w-3" /> : isDown ? <TrendingDown className="h-3 w-3" /> : null}
                            {Math.abs(row.net_change_pct)}%
                          </span>
                        )}
                        <span className="text-[11px] font-black text-slate-900">{formatMoney(row.net)}</span>
                      </div>
                    </div>
                    <div className="relative h-3 overflow-hidden rounded-full bg-white">
                      <span
                        className="absolute inset-y-0 right-0 rounded-full bg-gradient-to-l from-indigo-500 to-sky-400"
                        style={{ width: `${Math.max(2, (row.net / maxRangeNet) * 100)}%` }}
                      />
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[9px] font-bold text-slate-500">
                      <span>سُلف: {formatNumber(row.loans)}</span>
                      <span>خصومات: {formatNumber(row.deductions)}</span>
                      <span>إضافي: {formatNumber(row.overtime)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>


          {/* ═══════════ 4) توزيع التكلفة حسب القسم ═══════════ */}
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-teal-600" />
                <h3 className="text-sm font-black text-slate-800">توزيع تكلفة العمالة حسب القسم</h3>
              </div>
              <span className="text-[10px] font-bold text-slate-400">
                {monthLabel(rangeFrom)} → {monthLabel(rangeTo)}
              </span>
            </div>

            {departmentRows.length === 0 ? (
              <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-xs font-bold text-slate-400">
                لا توجد بيانات أقسام في الفترة المحددة
              </p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {departmentRows.map((row) => (
                  <div key={`dept-${row.department}`} className="rounded-2xl border border-slate-200 bg-slate-50/40 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="grid h-8 w-8 place-items-center rounded-xl bg-teal-100 text-teal-700">
                          <Building2 className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-[11px] font-black text-slate-800">{row.label}</p>
                          <p className="text-[9px] font-bold text-slate-500">{formatInt(row.workers)} عامل</p>
                        </div>
                      </div>
                      <div className="text-left">
                        <p className="text-[11px] font-black text-slate-900">{formatMoney(row.net)}</p>
                        <p className="text-[9px] font-black text-teal-700">{row.percent}%</p>
                      </div>
                    </div>
                    <div className="relative h-2.5 overflow-hidden rounded-full bg-white">
                      <span
                        className="absolute inset-y-0 right-0 rounded-full bg-gradient-to-l from-teal-500 to-emerald-400"
                        style={{ width: `${Math.max(1.5, row.percent)}%` }}
                      />
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[9px] font-bold text-slate-500">
                      <span>مكتسب: {formatNumber(row.earned)}</span>
                      <span>إضافي: {formatNumber(row.overtime)}</span>
                      <span>سُلف: {formatNumber(row.loans)}</span>
                      <span>خصومات: {formatNumber(row.deductions)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>


          {/* ═══════════ 5) الالتزام والانضباط ═══════════ */}
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <h3 className="text-sm font-black text-slate-800">الالتزام والانضباط</h3>
              </div>
              <span className="text-[10px] font-bold text-slate-400">
                {monthLabel(rangeFrom)} → {monthLabel(rangeTo)}
              </span>
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <p className="text-[11px] font-black text-emerald-800">أكثر العمال التزاماً</p>
                </div>
                <div className="space-y-1.5">
                  {(discipline?.most_committed || []).length === 0 && (
                    <p className="py-2 text-center text-[10px] font-bold text-emerald-600/70">لا توجد بيانات</p>
                  )}
                  {(discipline?.most_committed || []).map((employee, index) => (
                    <div key={`committed-${employee.employee_id}`} className="flex items-center justify-between gap-2 rounded-xl bg-white/80 px-2.5 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-600 text-[9px] font-black text-white">{index + 1}</span>
                        <div>
                          <p className="text-[10px] font-black text-slate-800">{employee.name}</p>
                          <p className="text-[9px] font-bold text-slate-500">
                            {employee.department_label || employee.department || '—'}
                            {employee.employee_code ? ` • ${employee.employee_code}` : ''}
                          </p>
                        </div>
                      </div>
                      <span className="whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black text-emerald-700">
                        {formatInt(employee.present_days)} يوم حضور
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-rose-100 bg-rose-50/50 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-rose-600" />
                  <p className="text-[11px] font-black text-rose-800">أكثر العمال غياباً وتأخيراً</p>
                </div>
                <div className="space-y-1.5">
                  {(discipline?.most_absent || []).length === 0 && (
                    <p className="py-2 text-center text-[10px] font-bold text-rose-600/70">لا توجد بيانات</p>
                  )}
                  {(discipline?.most_absent || []).map((employee, index) => (
                    <div key={`absent-${employee.employee_id}`} className="flex items-center justify-between gap-2 rounded-xl bg-white/80 px-2.5 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="grid h-5 w-5 place-items-center rounded-full bg-rose-600 text-[9px] font-black text-white">{index + 1}</span>
                        <div>
                          <p className="text-[10px] font-black text-slate-800">{employee.name}</p>
                          <p className="text-[9px] font-bold text-slate-500">
                            {employee.department_label || employee.department || '—'}
                            {employee.employee_code ? ` • ${employee.employee_code}` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="whitespace-nowrap rounded-full bg-rose-100 px-2 py-0.5 text-[9px] font-black text-rose-700">
                          {formatInt(employee.absent_days)} يوم غياب
                        </span>
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-slate-500">
                          <Clock className="h-2.5 w-2.5" /> {Math.round(employee.late_minutes)} دقيقة
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>


              <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-amber-600" />
                  <p className="text-[11px] font-black text-amber-800">أكثر قسم غياباً</p>
                </div>
                {discipline?.worst_department ? (
                  <div className="rounded-xl bg-white/80 p-3 text-center">
                    <p className="text-sm font-black text-amber-900">{discipline.worst_department.label}</p>
                    <p className="mt-1 text-[11px] font-black text-rose-700">
                      {formatInt(discipline.worst_department.absent_count)} يوم غياب
                    </p>
                    <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-bold text-slate-500">
                      <Clock className="h-3 w-3" /> {Math.round(discipline.worst_department.late_minutes)} دقيقة تأخير
                    </p>
                  </div>
                ) : (
                  <p className="py-4 text-center text-[10px] font-bold text-amber-600/70">لا توجد حالات غياب في الفترة</p>
                )}
                <p className="mt-2 text-center text-[9px] font-bold text-slate-500">
                  إجمالي العمال النشطين: {formatInt(payload?.active_workers || 0)}
                </p>
              </div>
            </div>
          </section>


          {/* نافذة تفاصيل صرف يوم محدد */}
          {openDay && selectedDay && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" dir="rtl">
              <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Coins className="h-5 w-5 text-purple-600" />
                    <div>
                      <h3 className="text-sm font-black text-slate-800">سُلف يوم {formatDayLabel(openDay)}</h3>
                      <p className="text-[10px] font-bold text-slate-500">
                        {selectedDay.count} عملية صرف • الإجمالي {formatMoney(selectedDay.total)}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpenDay(null)}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] border-collapse text-right text-[11px]">
                    <thead>
                      <tr className="bg-slate-100 text-slate-600">
                        <th className="rounded-r-xl px-2 py-2 font-black">#</th>
                        <th className="px-2 py-2 font-black">الموظف</th>
                        <th className="px-2 py-2 font-black">القسم</th>
                        <th className="px-2 py-2 font-black">المبلغ</th>
                        <th className="rounded-l-xl px-2 py-2 font-black">ملاحظات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedDayLoans.map((loan, index) => (
                        <tr key={`day-loan-${loan.id}`} className="border-b border-slate-100 text-slate-700">
                          <td className="px-2 py-2 text-center">{index + 1}</td>
                          <td className="px-2 py-2">
                            <p className="font-black text-slate-800">{loan.employee_name || '—'}</p>
                            <p className="text-[9px] font-bold text-slate-500">{loan.employee_code || '—'}</p>
                          </td>
                          <td className="px-2 py-2">{loan.department_label || loan.department || '—'}</td>
                          <td className="px-2 py-2 font-black text-purple-700">{formatMoney(loan.amount)}</td>
                          <td className="px-2 py-2 text-[10px] text-slate-500">{loan.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <button
                  type="button"
                  onClick={() => setOpenDay(null)}
                  className="mt-4 w-full rounded-xl bg-slate-800 py-2 text-xs font-black text-white hover:bg-slate-900"
                >
                  إغلاق
                </button>
              </div>
            </div>
          )}


          {/* نافذة تفاصيل شهر حسب القسم */}
          {openMonth && selectedMonthRow && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" dir="rtl">
              <div className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Wallet className="h-5 w-5 text-emerald-600" />
                    <div>
                      <h3 className="text-sm font-black text-slate-800">
                        تفاصيل {selectedMonthRow.label} {selectedMonthRow.month.slice(0, 4)}
                      </h3>
                      <p className="text-[10px] font-bold text-slate-500">
                        عدد العمال {formatInt(selectedMonthRow.active_workers)} • الصافي {formatMoney(selectedMonthRow.net_paid)}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpenMonth(null)}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mb-3 grid gap-2 sm:grid-cols-4">
                  <div className="rounded-xl bg-emerald-50 p-2.5">
                    <p className="text-[9px] font-black text-emerald-700">الأجر المكتسب</p>
                    <p className="text-[11px] font-black text-emerald-900">{formatMoney(selectedMonthRow.earned_salary)}</p>
                  </div>
                  <div className="rounded-xl bg-sky-50 p-2.5">
                    <p className="text-[9px] font-black text-sky-700">الإضافي</p>
                    <p className="text-[11px] font-black text-sky-900">{formatMoney(selectedMonthRow.overtime_bonus)}</p>
                  </div>
                  <div className="rounded-xl bg-purple-50 p-2.5">
                    <p className="text-[9px] font-black text-purple-700">السُلف</p>
                    <p className="text-[11px] font-black text-purple-900">{formatMoney(selectedMonthRow.loans)}</p>
                  </div>
                  <div className="rounded-xl bg-rose-50 p-2.5">
                    <p className="text-[9px] font-black text-rose-700">الخصومات</p>
                    <p className="text-[11px] font-black text-rose-900">{formatMoney(selectedMonthRow.deductions)}</p>
                  </div>
                </div>


                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px] border-collapse text-right text-[11px]">
                    <thead>
                      <tr className="bg-slate-100 text-slate-600">
                        <th className="rounded-r-xl px-2 py-2 font-black">القسم</th>
                        <th className="px-2 py-2 font-black">العمال</th>
                        <th className="px-2 py-2 font-black">الأجر المكتسب</th>
                        <th className="px-2 py-2 font-black">الإضافي</th>
                        <th className="px-2 py-2 font-black">السُلف</th>
                        <th className="px-2 py-2 font-black">الخصومات</th>
                        <th className="px-2 py-2 font-black">الصافي</th>
                        <th className="rounded-l-xl px-2 py-2 font-black">النسبة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedMonthDepartments.length === 0 && (
                        <tr>
                          <td colSpan={8} className="px-2 py-5 text-center font-bold text-slate-400">لا توجد بيانات</td>
                        </tr>
                      )}
                      {selectedMonthDepartments.map((row) => (
                        <tr key={`month-dept-${row.department}`} className="border-b border-slate-100 text-slate-700">
                          <td className="px-2 py-2 font-black">{row.label}</td>
                          <td className="px-2 py-2">{formatInt(row.workers)}</td>
                          <td className="px-2 py-2">{formatNumber(row.earned)}</td>
                          <td className="px-2 py-2 text-sky-700">{formatNumber(row.overtime)}</td>
                          <td className="px-2 py-2 text-purple-700">{formatNumber(row.loans)}</td>
                          <td className="px-2 py-2 text-rose-700">{formatNumber(row.deductions)}</td>
                          <td className="px-2 py-2 font-black text-slate-900">{formatMoney(row.net)}</td>
                          <td className="px-2 py-2 font-black text-teal-700">{row.percent}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <button
                  type="button"
                  onClick={() => setOpenMonth(null)}
                  className="mt-4 w-full rounded-xl bg-slate-800 py-2 text-xs font-black text-white hover:bg-slate-900"
                >
                  إغلاق
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default HRReportsView;
