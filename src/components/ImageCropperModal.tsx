import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Crop as CropIcon, ImageOff, RotateCcw, X } from 'lucide-react';
import type { ImageCropRegion } from '../types';

/**
 * صورة معروضة بمنطقة قص مؤقتة (بدون تعديل الملف الأصلي).
 * تعتمد على إحداثيات البيكسل الطبيعية للصورة لضمان قص دقيق بغض النظر عن حجم العرض.
 */
export const CroppedImage: React.FC<{
  src: string;
  alt?: string;
  crop?: ImageCropRegion | null;
  className?: string;
  style?: React.CSSProperties;
}> = ({ src, alt, crop, className, style }) => {
  if (!crop || crop.w <= 0 || crop.h <= 0 || crop.natW <= 0 || crop.natH <= 0) {
    return <img src={src} alt={alt} className={className} style={style} />;
  }

  return (
    <div className={className} style={{ ...style, position: 'relative', overflow: 'hidden' }}>
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={{
          position: 'absolute',
          width: `${(crop.natW / crop.w) * 100}%`,
          height: `${(crop.natH / crop.h) * 100}%`,
          left: `${-(crop.x / crop.w) * 100}%`,
          top: `${-(crop.y / crop.h) * 100}%`,
          maxWidth: 'none',
          maxHeight: 'none',
          objectFit: 'fill'
        }}
      />
    </div>
  );
};

type Rect = { x: number; y: number; w: number; h: number };
type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';

interface ImageCropperModalProps {
  imageUrl: string;
  pieceLabel: string;
  initialCrop: ImageCropRegion | null;
  onApply: (region: ImageCropRegion) => void;
  onReset: () => void;
  onClose: () => void;
}

const MIN_SIZE = 28;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const ImageCropperModal: React.FC<ImageCropperModalProps> = ({
  imageUrl,
  pieceLabel,
  initialCrop,
  onApply,
  onReset,
  onClose
}) => {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ mode: DragMode; startX: number; startY: number; rect: Rect } | null>(null);

  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [disp, setDisp] = useState({ w: 0, h: 0 });
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });

  const measure = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const box = img.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) {
      setDisp({ w: Math.round(box.width), h: Math.round(box.height) });
    }
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  // نهيئ مستطيل القص بعد معرفة أبعاد الصورة الطبيعية وأبعاد العرض.
  useEffect(() => {
    if (!nat.w || !nat.h || !disp.w || !disp.h) return;

    if (initialCrop && initialCrop.w > 0 && initialCrop.h > 0) {
      const sx = disp.w / nat.w;
      const sy = disp.h / nat.h;
      setRect({
        x: clamp(initialCrop.x * sx, 0, Math.max(0, disp.w - MIN_SIZE)),
        y: clamp(initialCrop.y * sy, 0, Math.max(0, disp.h - MIN_SIZE)),
        w: clamp(initialCrop.w * sx, MIN_SIZE, disp.w),
        h: clamp(initialCrop.h * sy, MIN_SIZE, disp.h)
      });
    } else {
      setRect({ x: 0, y: 0, w: disp.w, h: disp.h });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nat.w, nat.h, disp.w, disp.h]);

  const startDrag = (event: React.PointerEvent, mode: DragMode) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { mode, startX: event.clientX, startY: event.clientY, rect };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (drag.mode === 'move') {
      setRect({
        ...drag.rect,
        x: clamp(drag.rect.x + dx, 0, Math.max(0, disp.w - drag.rect.w)),
        y: clamp(drag.rect.y + dy, 0, Math.max(0, disp.h - drag.rect.h))
      });
      return;
    }

    let { x, y, w, h } = drag.rect;

    if (drag.mode.includes('w')) {
      const nextX = clamp(drag.rect.x + dx, 0, drag.rect.x + drag.rect.w - MIN_SIZE);
      w = drag.rect.w + (drag.rect.x - nextX);
      x = nextX;
    }
    if (drag.mode.includes('e')) {
      w = clamp(drag.rect.w + dx, MIN_SIZE, disp.w - drag.rect.x);
    }
    if (drag.mode.includes('n')) {
      const nextY = clamp(drag.rect.y + dy, 0, drag.rect.y + drag.rect.h - MIN_SIZE);
      h = drag.rect.h + (drag.rect.y - nextY);
      y = nextY;
    }
    if (drag.mode.includes('s')) {
      h = clamp(drag.rect.h + dy, MIN_SIZE, disp.h - drag.rect.y);
    }

    setRect({ x, y, w, h });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const presetFull = () => setRect({ x: 0, y: 0, w: disp.w, h: disp.h });
  const presetTop = () => setRect({ x: 0, y: 0, w: disp.w, h: Math.round(disp.h / 2) });
  const presetBottom = () =>
    setRect({ x: 0, y: Math.round(disp.h / 2), w: disp.w, h: Math.round(disp.h / 2) });

  const toRegion = (): ImageCropRegion => {
    const sx = nat.w / disp.w;
    const sy = nat.h / disp.h;
    return {
      x: Math.round(rect.x * sx),
      y: Math.round(rect.y * sy),
      w: Math.round(rect.w * sx),
      h: Math.round(rect.h * sy),
      natW: nat.w,
      natH: nat.h
    };
  };

  const handleApply = () => {
    if (!nat.w || !nat.h || !disp.w || !disp.h) return;
    onApply(toRegion());
  };

  const handleReset = () => {
    presetFull();
    onReset();
  };

  const ready = nat.w > 0 && nat.h > 0 && disp.w > 0 && disp.h > 0;

  const handles: Array<{ mode: DragMode; position: string; cursor: string }> = [
    { mode: 'nw', position: 'top-0 left-0 -translate-x-1/2 -translate-y-1/2', cursor: 'nwse-resize' },
    { mode: 'ne', position: 'top-0 right-0 translate-x-1/2 -translate-y-1/2', cursor: 'nesw-resize' },
    { mode: 'sw', position: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2', cursor: 'nesw-resize' },
    { mode: 'se', position: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2', cursor: 'nwse-resize' }
  ];

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4"
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="bg-white rounded-3xl w-full max-w-4xl shadow-2xl border border-slate-100 flex flex-col max-h-[94vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-3.5 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-slate-900 text-white flex items-center justify-center">
              <CropIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-sm">
                تعديل / قص صورة الموديل — {pieceLabel}
              </h3>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                قص مؤقت للمعاينة والطباعة فقط، ولا يؤثر على الصورة الأصلية المحفوظة بالموديل.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 shrink-0 rounded-full bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto grid grid-cols-1 md:grid-cols-[1fr_248px] gap-5">
          {/* محرر القص */}
          <div className="space-y-3 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-black text-slate-500 me-1">قص سريع:</span>
              <button
                type="button"
                onClick={presetFull}
                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold cursor-pointer"
              >
                الصورة كاملة
              </button>
              <button
                type="button"
                onClick={presetTop}
                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold cursor-pointer"
              >
                الجزء العلوي
              </button>
              <button
                type="button"
                onClick={presetBottom}
                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold cursor-pointer"
              >
                الجزء السفلي
              </button>
            </div>

            <div className="rounded-2xl bg-slate-100 p-3 flex items-center justify-center">
              <div className="relative inline-block max-w-full overflow-hidden rounded-lg select-none touch-none">
                <img
                  ref={imgRef}
                  src={imageUrl}
                  alt={pieceLabel}
                  draggable={false}
                  onLoad={(event) => {
                    const element = event.currentTarget;
                    setNat({ w: element.naturalWidth, h: element.naturalHeight });
                    window.setTimeout(measure, 0);
                  }}
                  className="block max-h-[56vh] w-auto max-w-full"
                />
                {ready && rect.w > 0 && rect.h > 0 && (
                  <div
                    className="absolute border-2 border-emerald-500 cursor-move"
                    style={{
                      left: rect.x,
                      top: rect.y,
                      width: rect.w,
                      height: rect.h,
                      boxShadow: '0 0 0 9999px rgba(15,23,42,0.5)'
                    }}
                    onPointerDown={(event) => startDrag(event, 'move')}
                  >
                    <div className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/40" />
                    <div className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/40" />
                    <div className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/40" />
                    <div className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/40" />
                    {handles.map((handle) => (
                      <div
                        key={handle.mode}
                        onPointerDown={(event) => startDrag(event, handle.mode)}
                        className={`absolute w-4 h-4 rounded-sm bg-emerald-500 border-2 border-white shadow ${handle.position}`}
                        style={{ cursor: handle.cursor }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              اسحب المستطيل لتحريكه، أو اسحب أحد أركانه لتغيير حجمه. استخدم «إعادة تعيين الصورة
              الأصلية» للرجوع للصورة كاملة.
            </p>
          </div>

          {/* المعاينة والأزرار */}
          <div className="space-y-2.5">
            <p className="text-[11px] font-black text-slate-600">معاينة مباشرة</p>
            <div
              className="rounded-xl border border-slate-300 bg-slate-50 overflow-hidden flex items-center justify-center p-2"
              style={{ minHeight: 140 }}
            >
              {ready && rect.w > 0 && rect.h > 0 ? (
                <div
                  className="relative overflow-hidden"
                  style={{ width: '100%', maxWidth: 220, aspectRatio: `${rect.w} / ${rect.h}` }}
                >
                  <img
                    src={imageUrl}
                    alt="preview"
                    style={{
                      position: 'absolute',
                      width: `${(disp.w / rect.w) * 100}%`,
                      height: `${(disp.h / rect.h) * 100}%`,
                      left: `${-(rect.x / rect.w) * 100}%`,
                      top: `${-(rect.y / rect.h) * 100}%`,
                      maxWidth: 'none',
                      maxHeight: 'none'
                    }}
                  />
                </div>
              ) : (
                <span className="flex flex-col items-center gap-1 text-slate-400 text-[11px] font-bold">
                  <ImageOff className="w-5 h-5" /> جاري تحميل الصورة...
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={handleApply}
              disabled={!ready}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-black cursor-pointer"
            >
              <Check className="w-4 h-4" /> تطبيق القص
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-900 text-xs font-black cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" /> إعادة تعيين الصورة الأصلية
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-full px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-black cursor-pointer"
            >
              إلغاء
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
