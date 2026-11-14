/**
 * أدوات مشتركة لتوحيد رأس (هيدر) جميع أوراق الطباعة في النظام:
 *  - كشف ما إذا كان شعار المصنع صورة (رابط / Base64 / مسار داخلي) أم رمزاً نصياً.
 *  - توليد HTML آمن للشعار مع سقوط أنيق (اسم المصنع / الرمز الافتراضي) عند غيابه
 *    أو عند فشل تحميل رابط الصورة — دون كسر التصميم أو ظهور أيقونة صورة تالفة.
 */

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

/** CSS مشترك لحاوية الشعار في رأس الورقة (يكفي إضافته داخل <style>). */
export const PRINT_LOGO_CSS = `
      .brand { display: flex; align-items: center; justify-content: center; margin-bottom: 5px; }
      .brand img { object-fit: contain; }
      .print-logo-emoji { line-height: 1; }
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
  sizePx = 52
): string => {
  const value = String(logo ?? '').trim();
  const fallbackName = escapeHtml(siteName || 'مصنع الملابس الجاهزة');

  if (!value) {
    return `<span class="print-logo-emoji" style="font-size:${Math.round(
      sizePx * 0.8
    )}px;">🏭</span>`;
  }

  if (isImageLogo(value)) {
    const imageSrc = safeImageSrc(value);
    if (imageSrc) {
      return `<img src="${escapeHtml(imageSrc)}" alt="${fallbackName}" style="height:${sizePx}px;max-width:${Math.round(
        sizePx * 3.2
      )}px;object-fit:contain;" onerror="this.style.display='none'" />`;
    }
  }

  return `<span class="print-logo-emoji" style="font-size:${Math.round(
    sizePx * 0.8
  )}px;">${escapeHtml(value)}</span>`;
};
