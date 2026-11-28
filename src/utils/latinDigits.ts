/**
 * أدوات توحيد الأرقام الإنجليزية (0123456789) في كامل التطبيق والطباعة،
 * والتحويل التلقائي لأرقام الكيبورد العربي (٠-٩) والفارسي (۰-۹) أثناء الكتابة.
 */

export const LATIN_NUMBER_LOCALE = 'en-US';
export const ARABIC_LATIN_DATE_LOCALE = 'ar-EG-u-nu-latn';

const NON_LATIN_DIGIT_RE = /[\u0660-\u0669\u06F0-\u06F9\u066B]/;
const NON_LATIN_DIGIT_GLOBAL_RE = /[\u0660-\u0669\u06F0-\u06F9\u066B]/g;

/**
 * يحوّل أي رقم عربي (٠١٢٣٤٥٦٧٨٩) أو فارسي (۰۱۲۳۴۵۶۷۸۹) إلى أرقام إنجليزية (0123456789)
 * والفاصلة العشرية العربية (٫) إلى نقطة (.).
 */
export const toLatinDigits = (value: string | number | null | undefined): string => {
  if (value == null) return '';
  const str = String(value);
  if (!NON_LATIN_DIGIT_RE.test(str)) return str;
  return str.replace(NON_LATIN_DIGIT_GLOBAL_RE, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
    if (code === 0x066b) return '.';
    return ch;
  });
};

/**
 * ينسّق الأرقام بأرقام إنجليزية فقط مع فواصل الآلاف.
 */
export const formatLatinNumber = (
  value: number | string | null | undefined,
  options?: Intl.NumberFormatOptions
): string => {
  const n = Number(value ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  return toLatinDigits(safe.toLocaleString(LATIN_NUMBER_LOCALE, options));
};

/**
 * ينسّق التاريخ بأسماء/ترتيب عربي مع أرقام إنجليزية (0123456789) فقط.
 */
export const formatLatinDate = (
  date: Date | string | number = new Date(),
  options?: Intl.DateTimeFormatOptions
): string => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return toLatinDigits(String(date ?? ''));
  try {
    return toLatinDigits(d.toLocaleDateString(ARABIC_LATIN_DATE_LOCALE, options));
  } catch {
    return d.toISOString().slice(0, 10);
  }
};

/**
 * ينسّق التاريخ والوقت بأسماء/ترتيب عربي مع أرقام إنجليزية (0123456789) فقط.
 */
export const formatLatinDateTime = (
  date: Date | string | number = new Date(),
  options?: Intl.DateTimeFormatOptions
): string => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return toLatinDigits(String(date ?? ''));
  try {
    return toLatinDigits(d.toLocaleString(ARABIC_LATIN_DATE_LOCALE, options));
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
};

/**
 * ينسّق الوقت بأرقام إنجليزية (0123456789) فقط.
 */
export const formatLatinTime = (
  date: Date | string | number = new Date(),
  options?: Intl.DateTimeFormatOptions
): string => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return toLatinDigits(String(date ?? ''));
  try {
    return toLatinDigits(d.toLocaleTimeString(ARABIC_LATIN_DATE_LOCALE, options));
  } catch {
    return d.toISOString().slice(11, 16);
  }
};

const SELECTION_SUPPORTED_INPUT_TYPES = new Set(['text', 'search', 'tel', 'url', 'password']);

const isTextLikeElement = (
  el: EventTarget | null
): el is HTMLInputElement | HTMLTextAreaElement => {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    if (el.readOnly || el.disabled) return false;
    const type = (el.type || 'text').toLowerCase();
    // استبعاد الحقول غير النصية (checkbox, radio, file, date, color, range, hidden, button, submit)
    return (
      type === 'text' ||
      type === 'search' ||
      type === 'tel' ||
      type === 'url' ||
      type === 'email' ||
      type === 'password' ||
      type === 'number'
    );
  }
  return false;
};

const supportsSelectionRange = (el: HTMLInputElement | HTMLTextAreaElement): boolean => {
  if (el instanceof HTMLTextAreaElement) return true;
  const type = (el.type || 'text').toLowerCase();
  return SELECTION_SUPPORTED_INPUT_TYPES.has(type);
};

const getNativeValueSetter = (
  el: HTMLInputElement | HTMLTextAreaElement
): ((value: string) => void) | undefined => {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  return descriptor?.set;
};

let globalNormalizerInstalled = false;

/**
 * يثبّت مستمعاً عاماً على مستوى المستند لتحويل أرقام الكيبورد العربي/الفارسي
 * تلقائياً إلى أرقام إنجليزية (0-9) في جميع حقول الإدخال مع تحديث حالة React والحفاظ على موضع المؤشر.
 */
export const installGlobalLatinDigitNormalizer = (): void => {
  if (globalNormalizerInstalled || typeof document === 'undefined') return;
  globalNormalizerInstalled = true;

  let isDispatchingSyntheticInput = false;

  const setNativeValueAndPreserveCaret = (
    target: HTMLInputElement | HTMLTextAreaElement,
    nextValue: string,
    caretPos?: number | null
  ): void => {
    const nativeSetter = getNativeValueSetter(target);
    if (nativeSetter) {
      nativeSetter.call(target, nextValue);
    } else {
      target.value = nextValue;
    }

    if (caretPos != null && supportsSelectionRange(target)) {
      try {
        const clamped = Math.max(0, Math.min(nextValue.length, caretPos));
        target.setSelectionRange(clamped, clamped);
      } catch {
        // بعض أنواع الحقول لا تدعم setSelectionRange في بعض المتصفحات
      }
    }
  };

  const handleBeforeInput = (event: Event): void => {
    if (isDispatchingSyntheticInput) return;
    const inputEvent = event as InputEvent;
    if (inputEvent.isComposing) return;
    const data = inputEvent.data;
    if (!data || !NON_LATIN_DIGIT_RE.test(data)) return;

    const target = inputEvent.target;
    if (!isTextLikeElement(target)) return;

    const inputType = inputEvent.inputType || '';
    if (
      inputType !== 'insertText' &&
      inputType !== 'insertFromPaste' &&
      inputType !== 'insertReplacementText' &&
      inputType !== 'insertFromDrop'
    ) {
      return;
    }

    const normalizedData = toLatinDigits(data);

    // حقول type="number" ترفض عادةً الأرقام العربية من كيبورد الماك قبل وصولها لحدث input
    if (target instanceof HTMLInputElement && (target.type || '').toLowerCase() === 'number') {
      if (inputEvent.cancelable) {
        inputEvent.preventDefault();
      }
      // محاولة الإدراج الأصلي عبر execCommand للحفاظ على المؤشر والتحديد وتحديث React تلقائياً
      let inserted = false;
      try {
        if (typeof document.execCommand === 'function') {
          inserted = document.execCommand('insertText', false, normalizedData);
        }
      } catch {
        inserted = false;
      }
      if (!inserted) {
        const nextValue = toLatinDigits(target.value + normalizedData);
        setNativeValueAndPreserveCaret(target, nextValue);
        isDispatchingSyntheticInput = true;
        try {
          target.dispatchEvent(new Event('input', { bubbles: true }));
        } finally {
          isDispatchingSyntheticInput = false;
        }
      }
      return;
    }

    // حقول text / search / tel / url / password / textarea
    if (supportsSelectionRange(target)) {
      const start = target.selectionStart;
      const end = target.selectionEnd;
      if (start !== null && end !== null) {
        if (inputEvent.cancelable) {
          inputEvent.preventDefault();
        }
        const current = target.value;
        const nextValue = toLatinDigits(
          current.slice(0, start) + normalizedData + current.slice(end)
        );
        const nextCaret = start + normalizedData.length;
        setNativeValueAndPreserveCaret(target, nextValue, nextCaret);
        isDispatchingSyntheticInput = true;
        try {
          target.dispatchEvent(new Event('input', { bubbles: true }));
        } finally {
          isDispatchingSyntheticInput = false;
        }
      }
    }
  };

  const normalizeTargetValue = (target: HTMLInputElement | HTMLTextAreaElement, dispatch: boolean): void => {
    const raw = target.value;
    if (!raw || !NON_LATIN_DIGIT_RE.test(raw)) return;

    const canSelect = supportsSelectionRange(target);
    const start = canSelect ? target.selectionStart : null;
    const end = canSelect ? target.selectionEnd : null;
    const normalized = toLatinDigits(raw);
    if (normalized === raw) return;

    const nativeSetter = getNativeValueSetter(target);
    if (nativeSetter) {
      nativeSetter.call(target, normalized);
    } else {
      target.value = normalized;
    }

    if (canSelect && start !== null && end !== null) {
      try {
        target.setSelectionRange(
          Math.min(normalized.length, start),
          Math.min(normalized.length, end)
        );
      } catch {
        // تجاهل إذا تعذر استعادة المؤشر
      }
    }

    if (dispatch) {
      isDispatchingSyntheticInput = true;
      try {
        target.dispatchEvent(new Event('input', { bubbles: true }));
      } finally {
        isDispatchingSyntheticInput = false;
      }
    }
  };

  const handleInput = (event: Event): void => {
    if (isDispatchingSyntheticInput) return;
    const target = event.target;
    if (!isTextLikeElement(target)) return;
    // في مرحلة capture نعدّل القيمة عبر nativeSetter قبل أن تصل إلى React
    // فيقرأ React القيمة المحوّلة تلقائياً على نفس حدث input دون تكرار الحدث.
    normalizeTargetValue(target, false);
  };

  const handleCompositionEnd = (event: Event): void => {
    const target = event.target;
    if (!isTextLikeElement(target)) return;
    normalizeTargetValue(target, true);
  };

  document.addEventListener('beforeinput', handleBeforeInput, true);
  document.addEventListener('input', handleInput, true);
  document.addEventListener('compositionend', handleCompositionEnd, true);
};
