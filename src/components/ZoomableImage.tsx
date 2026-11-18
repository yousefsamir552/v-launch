import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';

/** صورة بديلة موحّدة تُستخدم عند فشل تحميل صورة الموديل (نفس الصورة المستخدمة في الشاشات الحالية). */
export const FALLBACK_MODEL_IMAGE =
  'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500&auto=format&fit=crop&q=60';

interface ZoomableImageProps {
  /** رابط الصورة الأصلي. */
  src: string;
  /** نص بديل / اسم الموديل. */
  alt?: string;
  /** كلاسات الصورة المصغّرة كما هي في التصميم الحالي. */
  className?: string;
  /** اسم الملف عند تحميل الصورة (افتراضياً اسم الموديل). */
  downloadName?: string;
}

interface FullscreenImageProps {
  src: string;
  alt?: string;
  downloadName?: string;
  onClose: () => void;
}

/**
 * عارض صورة بملء الشاشة.
 *
 * الصورة عنصر <img> حقيقي ومباشر بدون أي طبقة شفافة فوقه، لذلك تعمل قائمة
 * الكليك يمين الطبيعية في المتصفح ("حفظ الصورة باسم" / فتحها في تبويب جديد)
 * بنسبة 100% دون أن تُغلق النافذة.
 */
const FullscreenImage: React.FC<FullscreenImageProps> = ({
  src,
  alt,
  downloadName,
  onClose
}) => {
  // قفل تمرير الصفحة + الإغلاق بمفتاح Escape أثناء العرض.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  // الإغلاق فقط عند الضغط على الخلفية نفسها (وليس على الصورة أو الشريط العلوي).
  const closeOnBackdrop = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  const handleDownload = async () => {
    const fileName = downloadName || alt || 'model-image';
    try {
      const response = await fetch(src, { mode: 'cors' });
      if (!response.ok) throw new Error('download failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // نؤجل الإلغاء حتى يبدأ المتصفح التنزيل فعلياً.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // صور خارجية (R2) قد تمنع fetch بسبب CORS — نفتحها في تبويب جديد ليحفظها المستخدم.
      window.open(src, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex flex-col bg-slate-950/95 backdrop-blur-xs animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-label={alt || 'عرض الصورة'}
      onClick={closeOnBackdrop}
    >
      {/* شريط علوي: اسم الموديل + زر التحميل + زر الإغلاق */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <span className="truncate text-sm font-black text-white/90">{alt}</span>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/20 cursor-pointer"
            title="تحميل الصورة"
          >
            <Download className="h-4 w-4" />
            <span>تحميل</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 cursor-pointer"
            title="إغلاق"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* منطقة الصورة: <img> مباشر غير مغطّى بأي طبقة تفاعلية */}
      <div
        className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-6"
        onClick={closeOnBackdrop}
      >
        <img
          src={src}
          alt={alt || 'صورة الموديل'}
          className="max-h-[92vh] max-w-[95vw] rounded-2xl bg-white object-contain shadow-2xl"
        />
      </div>
    </div>
  );
};

/**
 * صورة موديل قابلة للتكبير بملء الشاشة بضغطة واحدة.
 * تُستخدم بدل <img> مباشرة مع الحفاظ على نفس كلاسات التصميم الحالية.
 */
export const ZoomableImage: React.FC<ZoomableImageProps> = ({
  src,
  alt = '',
  className = '',
  downloadName
}) => {
  const [open, setOpen] = useState(false);
  const [resolvedSrc, setResolvedSrc] = useState(src);

  // مزامنة الرابط عند تغيّر الموديل/الصورة.
  useEffect(() => {
    setResolvedSrc(src);
  }, [src]);

  const close = useCallback(() => setOpen(false), []);

  const fullscreen =
    open && typeof document !== 'undefined'
      ? createPortal(
          <FullscreenImage
            src={resolvedSrc}
            alt={alt}
            downloadName={downloadName}
            onClose={close}
          />,
          document.body
        )
      : null;

  return (
    <>
      <img
        src={resolvedSrc}
        alt={alt}
        className={`${className} cursor-zoom-in`}
        title="اضغط لتكبير الصورة"
        onClick={(event) => {
          // منع تفعيل أي إجراء خاص بالبطاقة/الصف الحاضن عند تكبير الصورة فقط.
          event.stopPropagation();
          setOpen(true);
        }}
        onError={() => {
          if (resolvedSrc !== FALLBACK_MODEL_IMAGE) setResolvedSrc(FALLBACK_MODEL_IMAGE);
        }}
      />
      {fullscreen}
    </>
  );
};

export default ZoomableImage;
