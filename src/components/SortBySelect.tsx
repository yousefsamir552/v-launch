import React from 'react';
import { ArrowUpDown } from 'lucide-react';

export interface SortOption {
  value: string;
  label: string;
}

interface SortBySelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SortOption[];
  className?: string;
  compact?: boolean;
}

/**
 * مقارنة طبيعية للأكواد والنصوص العربية/الإنجليزية مع دعم الأرقام (M-2 قبل M-10).
 */
export const compareNatural = (a?: string | null, b?: string | null): number =>
  String(a || '').localeCompare(String(b || ''), 'ar', {
    numeric: true,
    sensitivity: 'base'
  });

/**
 * تحويل أي تاريخ/وقت نصي إلى طابع رقمي قابل للمقارنة بأمان.
 */
export const toTimestamp = (value?: string | null): number => {
  if (!value) return 0;
  const normalized = String(value).trim().replace(' ', 'T');
  const ts = Date.parse(normalized);
  return Number.isNaN(ts) ? 0 : ts;
};

/**
 * مكون موحّد لاختيار الترتيب (ترتيب حسب) بجانب شرائط البحث والفلاتر في كل أقسام النظام.
 */
export const SortBySelect: React.FC<SortBySelectProps> = ({
  value,
  onChange,
  options,
  className = '',
  compact = false
}) => {
  return (
    <div
      className={`inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl shadow-2xs ${
        compact ? 'px-2.5 py-1.5' : 'px-3 py-2'
      } ${className}`}
    >
      <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
      <span className="text-[11px] font-bold text-slate-500 whitespace-nowrap hidden sm:inline">
        ترتيب حسب:
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="ترتيب حسب"
        className="bg-transparent text-xs font-extrabold text-slate-800 focus:outline-none cursor-pointer pe-1"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
};

export default SortBySelect;
