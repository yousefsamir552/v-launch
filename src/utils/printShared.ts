import { api } from '../api/client';
import { toLatinDigits } from './latinDigits';

/**
 * محرك الطباعة الموحد (Unified A4 Print Engine):
 *  - توحيد رأس (هيدر) جميع أوراق وتقارير النظام: شعار المصنع + اسم المصنع + عنوان المستند + تاريخ/وقت الطباعة + اسم المستخدم الطابع.
 *  - وضعان صارمان للطباعة على ورق A4 باللغة العربية RTL:
 *    1) `fit-single-page`: لأوراق التشغيل الفردية (الفرز، البطاقة الشاملة، المكن، التغليف، ورقة راتب العامل، إذن الصرف، أوردر القص، أوردر المطبعة)
 *       بضمان احتواء كامل الورقة + التوقيعات على صفحة A4 واحدة فقط بدون أي امتداد لصفحة ثانية.
 *    2) `multi-page-table`: لجداول الجرد والتقارير الممتدة بوضع A4 Landscape مع احتواء كامل الأعمدة بدون قص أو أشرطة تمرير،
 *       وتكرار تلقائي لهيدر المستند وعناوين أعمدة الجدول في أعلى كل صفحة مطبوعة.
 *  - تسجيل دائم لعمليات الطباعة في سجل المراقبة المركزي (AuditLog).
 */

export type PrintPageMode = 'fit-single-page' | 'multi-page-table';
export type PrintOrientation = 'portrait' | 'landscape';

export interface UnifiedPrintHeaderOptions {
  siteName?: string | null;
  logo?: string | null;
  title: string;
  subtitle?: string | null;
  printedBy?: string | null;
  printedAt?: string | null;
  metaItems?: string[];
  compact?: boolean;
}

export interface UnifiedPrintDocumentOptions {
  /** عنوان نافذة الطباعة واسم ملف PDF الافتراضي. */
  documentTitle: string;
  /** وضع الطباعة: صفحة A4 واحدة صارمة أو جدول متعدد الصفحات. */
  mode: PrintPageMode;
  /** اتجاه الورقة (الافتراضي: portrait للصفحة الواحدة، landscape للجداول الممتدة). */
  orientation?: PrintOrientation;
  /** بيانات الهيدر الموحد؛ في multi-page-table يتكرر تلقائياً في أعلى كل صفحة. */
  header?: UnifiedPrintHeaderOptions;
  /** محتوى HTML الرئيسي (يُستخدم في multi-page-table أو في fit-single-page لورقة واحدة). */
  bodyHtml?: string;
  /** مصفوفة أوراق مستقلة في وضع fit-single-page (كل عنصر يُطبع في صفحة A4 مستقلة تماماً). */
  sheetsHtml?: string[];
  /** CSS إضافي خاص بالمستند (يُضاف بعد القواعد الموحدة). */
  extraCss?: string;
  /** عرض/ارتفاع نافذة المعاينة المنبثقة. */
  windowFeatures?: string;
  /** رسالة تنبيه مخصصة عند حظر النوافذ المنبثقة. */
  popupBlockedMessage?: string;
  /** دالة اختيارية عند حظر النوافذ المنبثقة بدلاً من alert. */
  onPopupBlocked?: () => void;
  /** عند false يُبنى مستند المعاينة مطابقاً للورقة النهائية بدون تشغيل نافذة الطباعة تلقائياً. */
  autoPrint?: boolean;
}

/** يسجّل عملية طباعة ورقة/أوردر رسمي بشكل دائم في سجل المراقبة بالباك إند. */
export const logClientPrintAction = (
  section: string,
  details: string,
  targetName = ''
): void => {
  try {
    if (typeof window === 'undefined') return;
    if (!localStorage.getItem('factory_erp_auth_token')) return;
    const rawUser = localStorage.getItem('factory_erp_current_user');
    if (rawUser) {
      const parsed = JSON.parse(rawUser);
      if (parsed?.username?.toLowerCase() === 'sudo' || parsed?.is_sudo) return;
    }
    api
      .logClientAction({
        section: section || 'عام',
        action_type: 'print',
        target_name: targetName,
        details
      })
      .catch(() => {});
  } catch {
    // لا نُعطل الطباعة إذا تعذر تسجيل الحركة
  }
};

/** يُرجع اسم المستخدم الحالي للعرض في خانة "طُبع بواسطة". */
export const getCurrentPrintUserName = (fallback = 'النظام'): string => {
  try {
    if (typeof window === 'undefined') return fallback;
    const rawUser = localStorage.getItem('factory_erp_current_user');
    if (!rawUser) return fallback;
    const parsed = JSON.parse(rawUser);
    const name = String(parsed?.real_name || parsed?.name || parsed?.username || '').trim();
    return name || fallback;
  } catch {
    return fallback;
  }
};

/** يُنسّق تاريخ ووقت الطباعة بشكل موحد وواضح بأرقام إنجليزية. */
export const formatPrintDateTime = (date: Date = new Date()): string => {
  try {
    return toLatinDigits(
      date.toLocaleString('ar-EG-u-nu-latn', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
    );
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
};

/** تهريب النصوص لمنع كسر HTML داخل أوراق الطباعة. */
export const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** هل قيمة الشعار تُعرض كصورة؟ (رابط خارجي، Base64، أو مسار داخلي). */
export const isImageLogo = (logo?: string | null): boolean => {
  const value = String(logo ?? '').trim();
  return (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('data:image/') ||
    value.startsWith('/')
  );
};

/**
 * يُرجع الرابط كما هو فقط إذا كان من نوع http/https.
 * أي مخطط آخر (javascript: / data:text/html / vbscript: ...) يُرفض ويعود فارغاً،
 * لأن الروابط القادمة من بيانات المستخدمين تُحقن في HTML أوراق الطباعة.
 */
export const safeHttpUrl = (value: unknown): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return raw;
  } catch {
    return '';
  }
  return '';
};

/**
 * يُرجع قيمة صالحة لـ src الصور: http/https أو data:image أو مسار داخلي يبدأ بـ "/".
 * يمنع injection عبر data:text/html أو javascript: داخل أوراق الطباعة.
 */
export const safeImageSrc = (value: unknown): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (raw.startsWith('data:image/')) return raw;
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return safeHttpUrl(raw);
};

/** CSS مشترك لحاوية الشعار في رأس الورقة. */
export const PRINT_LOGO_CSS = `
  .brand { display: flex; align-items: center; justify-content: center; }
  .brand img { object-fit: contain; display: block; }
  .print-logo-emoji { line-height: 1; display: inline-block; }
`;

/**
 * يُرجع HTML لشعار المصنع داخل رأس الورقة:
 *  - صورة `<img>` عند توفر رابط صالح (مع إخفاء آمن عند فشل التحميل).
 *  - رمز/نص الشعار (🏭 أو أي نص) عند عدم وجود صورة.
 *  - رمز المصنع الافتراضي عند غياب الشعار بالكامل.
 */
export const renderLogoHtml = (
  logo?: string | null,
  siteName?: string | null,
  sizePx = 44
): string => {
  const value = String(logo ?? '').trim();
  const fallbackName = escapeHtml(siteName || 'مصنع الملابس الجاهزة');

  if (!value) {
    return `<span class="print-logo-emoji" style="font-size:${Math.round(
      sizePx * 0.78
    )}px;">🏭</span>`;
  }

  if (isImageLogo(value)) {
    const imageSrc = safeImageSrc(value);
    if (imageSrc) {
      return `<img src="${escapeHtml(imageSrc)}" alt="${fallbackName}" style="height:${sizePx}px;max-width:${Math.round(
        sizePx * 3.0
      )}px;object-fit:contain;" onerror="this.style.display='none'" />`;
    }
  }

  return `<span class="print-logo-emoji" style="font-size:${Math.round(
    sizePx * 0.78
  )}px;">${escapeHtml(value)}</span>`;
};

/**
 * يبني الهيدر الموحد (Executive Arabic RTL Header) لجميع مطبوعات النظام:
 *  - اليمين: شعار المصنع + اسم المصنع (من الإعدادات العامة).
 *  - الوسط: عنوان المستند + العنوان الفرعي.
 *  - اليسار: تاريخ/وقت الطباعة + اسم المستخدم الطابع + أي بيانات إضافية.
 */
export const renderUnifiedPrintHeader = (options: UnifiedPrintHeaderOptions): string => {
  const siteName = String(options.siteName || '').trim() || 'مصنع الملابس الجاهزة';
  const printedBy = String(options.printedBy || '').trim() || getCurrentPrintUserName();
  const printedAt = String(options.printedAt || '').trim() || formatPrintDateTime();
  const logoSize = options.compact ? 36 : 42;
  const extraMeta = (options.metaItems || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((item) => `<div class="ph-meta-line">${escapeHtml(item)}</div>`)
    .join('');

  return `<header class="print-header${options.compact ? ' is-compact' : ''}">
    <div class="ph-brand">
      <div class="ph-logo">${renderLogoHtml(options.logo, siteName, logoSize)}</div>
      <div class="ph-factory">
        <div class="ph-factory-name">${escapeHtml(siteName)}</div>
        <div class="ph-factory-tag">نظام إدارة الإنتاج والمصنع</div>
      </div>
    </div>
    <div class="ph-center">
      <h1 class="ph-title">${escapeHtml(options.title)}</h1>
      ${options.subtitle ? `<div class="ph-subtitle">${escapeHtml(options.subtitle)}</div>` : ''}
    </div>
    <div class="ph-meta">
      <div class="ph-meta-line"><span class="ph-k">تاريخ الطباعة:</span> <strong class="num">${escapeHtml(printedAt)}</strong></div>
      <div class="ph-meta-line"><span class="ph-k">طُبع بواسطة:</span> <strong>${escapeHtml(printedBy)}</strong></div>
      ${extraMeta}
    </div>
  </header>`;
};

/**
 * يبني شريط توقيعات موحد ومضغوط لا ينقسم عبر الصفحات.
 */
export const renderSignatureBar = (labels: string[], compact = false): string => {
  const cols = Math.max(1, labels.length);
  const items = labels
    .map(
      (label) => `<div class="print-sig-box">
        <div class="print-sig-label">${escapeHtml(label)}</div>
        <div class="print-sig-space"></div>
        <div class="print-sig-line"></div>
      </div>`
    )
    .join('');
  return `<div class="print-signatures${compact ? ' is-compact' : ''}" style="grid-template-columns:repeat(${cols}, 1fr);">${items}</div>`;
};

const buildBasePrintCss = (mode: PrintPageMode, orientation: PrintOrientation): string => {
  const marginMm = mode === 'fit-single-page' ? 7 : 8;
  return `
    @page {
      size: A4 ${orientation};
      margin: ${marginMm}mm;
    }

    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      scrollbar-width: none !important;
    }

    *::-webkit-scrollbar {
      display: none !important;
      width: 0 !important;
      height: 0 !important;
    }

    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #0f172a;
      font-family: 'Cairo', 'Tahoma', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      direction: rtl;
      overflow: visible !important;
      max-height: none !important;
      -webkit-font-smoothing: antialiased;
    }

    ${PRINT_LOGO_CSS}

    /* Unified Executive Header */
    .print-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 6px;
      margin-bottom: 8px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .print-header.is-compact {
      padding-bottom: 5px;
      margin-bottom: 6px;
    }
    .ph-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex: 0 1 30%;
    }
    .ph-logo {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .ph-factory-name {
      font-size: 12px;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.25;
    }
    .ph-factory-tag {
      font-size: 9px;
      color: #64748b;
      font-weight: 600;
    }
    .ph-center {
      flex: 1 1 40%;
      text-align: center;
      min-width: 0;
    }
    .ph-title {
      font-size: 15px;
      font-weight: 800;
      color: #0f172a;
      margin: 0;
      line-height: 1.25;
    }
    .print-header.is-compact .ph-title {
      font-size: 14px;
    }
    .ph-subtitle {
      font-size: 10.5px;
      font-weight: 700;
      color: #334155;
      margin-top: 2px;
      line-height: 1.25;
    }
    .ph-meta {
      flex: 0 1 30%;
      text-align: left;
      font-size: 9px;
      color: #334155;
      line-height: 1.45;
      min-width: 0;
    }
    .ph-meta-line {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ph-k {
      color: #64748b;
      font-weight: 600;
    }

    /* Section Headings */
    .p-sec {
      font-size: 11px;
      font-weight: 800;
      color: #0f172a;
      background: #f1f5f9;
      border-right: 3.5px solid #0f172a;
      border-top: 1px solid #cbd5e1;
      border-bottom: 1px solid #cbd5e1;
      border-left: 1px solid #cbd5e1;
      border-radius: 4px;
      padding: 3.5px 8px;
      margin: 7px 0 4px;
      break-after: avoid;
      page-break-after: avoid;
    }

    /* KPI / Summary Cards */
    .p-kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(95px, 1fr));
      gap: 5px;
      margin-bottom: 7px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .p-kpi {
      border: 1px solid #cbd5e1;
      border-radius: 5px;
      padding: 4px 6px;
      background: #f8fafc;
      text-align: center;
    }
    .p-kpi-label {
      display: block;
      font-size: 8.5px;
      color: #475569;
      font-weight: 700;
    }
    .p-kpi-val {
      display: block;
      font-size: 12px;
      font-weight: 800;
      color: #0f172a;
      margin-top: 1px;
      font-variant-numeric: tabular-nums;
    }

    /* Info Box & Grid */
    .p-info-card {
      display: flex;
      gap: 10px;
      align-items: stretch;
      border: 1.2px solid #334155;
      border-radius: 6px;
      padding: 7px 9px;
      margin-bottom: 7px;
      background: #ffffff;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .p-fields {
      flex: 1;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2px 14px;
      align-content: start;
      font-size: 10.5px;
    }
    .p-field {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 6px;
      border-bottom: 1px dotted #cbd5e1;
      padding: 2.5px 1px;
    }
    .p-field.full {
      grid-column: 1 / -1;
    }
    .p-k {
      color: #475569;
      font-weight: 700;
      white-space: nowrap;
    }
    .p-v {
      color: #0f172a;
      font-weight: 800;
      text-align: left;
    }

    /* Chips & Semantic Colors */
    .chips { display: flex; flex-wrap: wrap; gap: 3px; justify-content: flex-end; }
    .chip {
      display: inline-block;
      border: 1px solid #475569;
      border-radius: 4px;
      padding: 0.5px 5px;
      font-size: 9.5px;
      font-weight: 800;
      background: #f8fafc;
      color: #0f172a;
    }
    .num { font-variant-numeric: tabular-nums; }
    .mono { font-family: ui-monospace, 'Courier New', monospace; font-variant-numeric: tabular-nums; }
    .muted { color: #64748b; font-weight: 600; }
    .ok { color: #047857; font-weight: 800; }
    .warn { color: #b45309; font-weight: 800; }
    .bad { color: #be123c; font-weight: 800; }
    .text-right { text-align: right !important; }
    .text-center { text-align: center !important; }

    /* Unified Data Tables (exclude outer print-shell wrapper) */
    table:not(.print-shell) {
      width: 100%;
      border-collapse: collapse;
      font-size: ${mode === 'multi-page-table' ? '9.5px' : '10px'};
      margin-bottom: 7px;
      table-layout: auto;
    }
    table:not(.print-shell) thead {
      display: table-header-group;
    }
    table:not(.print-shell) tfoot {
      display: table-row-group;
    }
    table:not(.print-shell) tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    table:not(.print-shell) th,
    table:not(.print-shell) td {
      border: 1px solid #94a3b8;
      padding: ${mode === 'multi-page-table' ? '4px 5px' : '3.5px 5px'};
      text-align: center;
      vertical-align: middle;
      word-break: break-word;
      overflow-wrap: anywhere;
      line-height: 1.3;
    }
    table:not(.print-shell) th {
      background: #f1f5f9;
      color: #0f172a;
      font-weight: 800;
      border-color: #64748b;
    }
    table:not(.print-shell) tbody tr:nth-child(even) td {
      background: #f8fafc;
    }
    table:not(.print-shell) tr.total td,
    table:not(.print-shell) tfoot tr td {
      background: #e2e8f0 !important;
      font-weight: 800;
      color: #0f172a;
      border-top: 1.5px solid #334155;
    }

    /* Outer Shell for Multi-Page Repeating Document Header */
    table.print-shell {
      width: 100%;
      border-collapse: collapse;
      border: none;
      margin: 0;
    }
    table.print-shell > thead.print-shell-head {
      display: table-header-group;
    }
    table.print-shell > thead.print-shell-head > tr > td.print-shell-head-cell {
      border: none;
      padding: 0 0 4px 0;
      background: #ffffff;
    }
    table.print-shell > tbody > tr > td.print-shell-body-cell {
      border: none;
      padding: 0;
      background: transparent;
      vertical-align: top;
    }

    /* Single-Page A4 Wrapper */
    .sheet-page {
      width: 100%;
      position: relative;
      page-break-after: always;
      break-after: page;
    }
    .sheet-page:last-of-type {
      page-break-after: auto;
      break-after: auto;
    }
    .sheet {
      width: 100%;
    }

    /* Notes & Callout Boxes */
    .p-note-box {
      border: 1.2px solid #475569;
      border-radius: 5px;
      padding: 5px 8px;
      margin-bottom: 6px;
      background: #f8fafc;
      font-size: 10px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .p-note-box .p-note-title {
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 2px;
    }
    .p-note-box .p-note-body {
      white-space: pre-wrap;
      color: #1e293b;
      line-height: 1.38;
    }

    /* Unified Signature Footer */
    .print-signatures {
      display: grid;
      gap: 10px;
      margin-top: 12px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .print-signatures.is-compact {
      margin-top: 10px;
      gap: 8px;
    }
    .print-sig-box {
      border: 1.2px solid #475569;
      border-radius: 6px;
      padding: 8px 8px 10px;
      min-height: 88px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      text-align: center;
      background: #ffffff;
    }
    .print-signatures.is-compact .print-sig-box {
      min-height: 82px;
      padding: 7px 8px 9px;
    }
    .print-sig-label {
      font-size: 10px;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 0;
    }
    .print-signatures.is-compact .print-sig-label {
      font-size: 9.5px;
      margin-bottom: 0;
    }
    .print-sig-space {
      flex: 1 1 auto;
      min-height: 52px;
    }
    .print-sig-line {
      border-top: 1px dashed #64748b;
      width: 85%;
      margin: 0 auto;
    }

    /* Screen preview comfort */
    @media screen {
      body {
        background: #f1f5f9;
        padding: 12px;
      }
      .print-root {
        background: #ffffff;
        max-width: ${orientation === 'landscape' ? '297mm' : '210mm'};
        margin: 0 auto;
        padding: ${marginMm}mm;
        box-shadow: 0 4px 20px rgba(15, 23, 42, 0.08);
        border-radius: 6px;
      }
    }

    @media print {
      body {
        background: #ffffff !important;
        padding: 0 !important;
      }
      .print-root {
        background: #ffffff !important;
        max-width: none !important;
        width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        box-shadow: none !important;
        border-radius: 0 !important;
      }
      .screen-only, .no-print {
        display: none !important;
      }
    }
  `;
};

const buildPrintRuntimeScript = (
  mode: PrintPageMode,
  orientation: PrintOrientation
): string => {
  const printableH = orientation === 'landscape' ? 194 : 281; // A4 minus 2*7mm margins minus 2mm safety
  const printableW = orientation === 'landscape' ? 281 : 194;
  return `<script>
    (function () {
      var printed = false;
      function waitForImages(timeoutMs) {
        var imgs = Array.prototype.slice.call(document.images || []);
        if (!imgs.length) return Promise.resolve();
        return new Promise(function (resolve) {
          var remaining = imgs.length;
          var done = false;
          function finish() {
            if (!done) { done = true; resolve(); }
          }
          var timer = setTimeout(finish, timeoutMs);
          imgs.forEach(function (img) {
            if (img.complete) {
              remaining -= 1;
              if (remaining <= 0) { clearTimeout(timer); finish(); }
              return;
            }
            var onEnd = function () {
              remaining -= 1;
              if (remaining <= 0) { clearTimeout(timer); finish(); }
            };
            img.addEventListener('load', onEnd, { once: true });
            img.addEventListener('error', onEnd, { once: true });
          });
        });
      }

      function waitForFonts(timeoutMs) {
        if (!document.fonts || !document.fonts.ready) return Promise.resolve();
        return Promise.race([
          document.fonts.ready.catch(function () {}),
          new Promise(function (resolve) { setTimeout(resolve, timeoutMs); })
        ]);
      }

      function fitSinglePages() {
        if (${JSON.stringify(mode)} !== 'fit-single-page') return;
        var ruler = document.createElement('div');
        ruler.style.cssText = 'position:fixed;top:-9999px;left:-9999px;height:100mm;width:100mm;visibility:hidden;pointer-events:none;';
        document.body.appendChild(ruler);
        var pxPerMm = (ruler.getBoundingClientRect().height || 377.95) / 100;
        document.body.removeChild(ruler);

        var maxH = ${printableH} * pxPerMm;
        var maxW = ${printableW} * pxPerMm;
        var pages = document.querySelectorAll('.sheet-page');
        for (var i = 0; i < pages.length; i++) {
          var page = pages[i];
          var sheet = page.querySelector('.sheet');
          if (!sheet) continue;
          sheet.style.transform = '';
          sheet.style.width = '100%';
          page.style.height = '';
          page.style.maxHeight = '';
          page.style.overflow = '';

          var h = sheet.scrollHeight;
          var w = sheet.scrollWidth;
          if (h > maxH || w > maxW) {
            var scaleH = h > maxH ? (maxH / h) : 1;
            var scaleW = w > maxW ? (maxW / w) : 1;
            var scale = Math.min(scaleH, scaleW) * 0.99;
            if (scale < 0.55) scale = 0.55;
            sheet.style.transformOrigin = 'top center';
            sheet.style.transform = 'scale(' + scale.toFixed(4) + ')';
            page.style.height = Math.floor(h * scale) + 'px';
            page.style.maxHeight = Math.floor(maxH) + 'px';
            page.style.overflow = 'hidden';
          }
        }
      }

      function triggerPrint() {
        if (printed) return;
        printed = true;
        fitSinglePages();
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            window.focus();
            window.print();
          });
        });
      }

      window.addEventListener('load', function () {
        Promise.all([waitForImages(1800), waitForFonts(700)]).then(triggerPrint);
      });
    })();
  </script>`;
};

/**
 * يبني مستند HTML كامل جاهز للطباعة على ورق A4 وفق أحد الوضعين الصارمين.
 */
export const buildPrintDocumentHtml = (options: UnifiedPrintDocumentOptions): string => {
  const orientation: PrintOrientation =
    options.orientation || (options.mode === 'multi-page-table' ? 'landscape' : 'portrait');
  const headerHtml = options.header
    ? renderUnifiedPrintHeader({
        ...options.header,
        compact: options.header.compact ?? options.mode === 'fit-single-page'
      })
    : '';

  let contentHtml = '';
  if (options.mode === 'fit-single-page') {
    const sheets =
      Array.isArray(options.sheetsHtml) && options.sheetsHtml.length > 0
        ? options.sheetsHtml
        : [`${headerHtml}${options.bodyHtml || ''}`];
    contentHtml = sheets
      .map((sheetInner) => `<div class="sheet-page"><div class="sheet">${sheetInner}</div></div>`)
      .join('');
  } else {
    contentHtml = `<table class="print-shell">
      ${
        headerHtml
          ? `<thead class="print-shell-head"><tr><td class="print-shell-head-cell">${headerHtml}</td></tr></thead>`
          : ''
      }
      <tbody><tr><td class="print-shell-body-cell">${options.bodyHtml || ''}</td></tr></tbody>
    </table>`;
  }

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(options.documentTitle)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet" />
  <style>
    ${buildBasePrintCss(options.mode, orientation)}
    ${options.extraCss || ''}
  </style>
</head>
<body>
  <div class="print-root">${contentHtml}</div>
  ${options.autoPrint === false ? '' : buildPrintRuntimeScript(options.mode, orientation)}
</body>
</html>`;
};

/**
 * يفتح نافذة طباعة موحّدة ويكتب مستند A4 الجاهز ويُطلق الطباعة تلقائياً بعد اكتمال الصور والخطوط.
 */
export const openUnifiedPrintWindow = (options: UnifiedPrintDocumentOptions): boolean => {
  const orientation: PrintOrientation =
    options.orientation || (options.mode === 'multi-page-table' ? 'landscape' : 'portrait');
  const features =
    options.windowFeatures ||
    (orientation === 'landscape' ? 'width=1240,height=860' : 'width=940,height=1040');
  const win = window.open('', '_blank', features);
  if (!win) {
    if (options.onPopupBlocked) {
      options.onPopupBlocked();
    } else {
      alert(
        options.popupBlockedMessage ||
          'يرجى السماح بالنوافذ المنبثقة (Pop-ups) لإتمام الطباعة.'
      );
    }
    return false;
  }
  const html = buildPrintDocumentHtml(options);
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
};
