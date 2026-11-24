import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Package, Search, X } from 'lucide-react';
import { AccessoryItem, AccessoryType } from '../types';

interface AccessoryPickerProps {
  /** أصناف مخزن الإكسسوارات المتاحة للاختيار. */
  items: AccessoryItem[];
  /** تصنيفات الإكسسوارات (تحكم ترتيب المجموعات والأسماء البديلة). */
  types: AccessoryType[];
  /** معرّف الإكسسوار المختار حالياً. */
  value: string;
  onChange: (accessoryId: string) => void;
  disabled?: boolean;
}

interface AccessoryGroup {
  key: string;
  typeName: string;
  items: AccessoryItem[];
}

/** صورة مصغرة للإكسسوار أو أيقونة افتراضية أنيقة عند غياب الصورة. */
const AccessoryThumbnail: React.FC<{ item: AccessoryItem }> = ({ item }) =>
  item.image ? (
    <img
      src={item.image}
      alt={item.name}
      className="w-6 h-6 rounded-md object-cover border border-slate-200 bg-white shrink-0"
    />
  ) : (
    <span className="w-6 h-6 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
      <Package className="w-3.5 h-3.5 text-slate-400" />
    </span>
  );

/**
 * قائمة منسدلة ذكية قابلة للبحث لاختيار الإكسسوار من المخزن.
 * - بحث مباشر بكود الإكسسوار أو اسمه أو اسم التصنيف أو كود الموديل المخصص له.
 * - مجموعات مفصولة لكل تصنيف، ولكل مجموعة شريط عنوان داكن (اسم التصنيف + عدد الأصناف).
 * - إغلاق عند الاختيار أو الضغط خارج القائمة أو زر Escape.
 */
export const AccessoryPicker: React.FC<AccessoryPickerProps> = ({
  items,
  types,
  value,
  onChange,
  disabled = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedItem = items.find((item) => item.id === value);

  const typeNameById = useMemo(() => {
    const map = new Map<string, string>();
    types.forEach((type) => map.set(type.id, type.name));
    return map;
  }, [types]);

  // إغلاق القائمة عند الضغط خارجها أو الضغط على Escape.
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // تجميع الإكسسوارات حسب التصنيف مع تطبيق فلتر البحث.
  const groups = useMemo<AccessoryGroup[]>(() => {
    const term = searchTerm.trim().toLowerCase();
    const map = new Map<string, AccessoryGroup>();

    items.forEach((item) => {
      const typeName =
        item.type_name || typeNameById.get(item.type_id) || 'غير مصنف';
      const haystack = [
        item.name,
        item.code,
        typeName,
        item.custom_model_code || ''
      ]
        .join(' ')
        .toLowerCase();

      if (term && !haystack.includes(term)) return;

      const key = item.type_id || typeName;
      if (!map.has(key)) {
        map.set(key, { key, typeName, items: [] });
      }
      map.get(key)!.items.push(item);
    });

    // ترتيب المجموعات حسب ترتيب التصنيفات المعرّفة، وغير المعرّف في النهاية.
    const orderById = new Map<string, number>();
    types.forEach((type, index) => orderById.set(type.id, index));

    return Array.from(map.values()).sort((a, b) => {
      const aIndex = orderById.has(a.key) ? orderById.get(a.key)! : Number.MAX_SAFE_INTEGER;
      const bIndex = orderById.has(b.key) ? orderById.get(b.key)! : Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });
  }, [items, types, typeNameById, searchTerm]);

  const handleSelect = (accessoryId: string) => {
    onChange(accessoryId);
    setIsOpen(false);
    setSearchTerm('');
  };

  const selectedAvailable = selectedItem
    ? Number((selectedItem.quantity - selectedItem.reserved_quantity).toFixed(2))
    : 0;


  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (isOpen) setSearchTerm('');
          setIsOpen((prev) => !prev);
        }}
        className={`w-full px-3 py-2 text-xs rounded-xl border bg-white flex items-center gap-2 text-start transition ${
          isOpen ? 'border-pink-400 ring-2 ring-pink-200' : 'border-slate-300'
        } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-pink-300'}`}
      >
        {selectedItem ? (
          <span className="flex items-center gap-2 min-w-0 flex-grow">
            <AccessoryThumbnail item={selectedItem} />
            <span className="font-black text-slate-900 shrink-0 font-mono">
              {selectedItem.code}
            </span>
            <span className="text-slate-600 truncate">{selectedItem.name}</span>
            <span className="text-slate-300 shrink-0">|</span>
            <span
              className={`font-bold shrink-0 ${
                selectedAvailable > 0 ? 'text-emerald-700' : 'text-rose-600'
              }`}
            >
              متاح: {selectedAvailable} {selectedItem.unit}
            </span>
          </span>
        ) : (
          <span className="text-slate-400 flex-grow truncate">
            -- ابحث بكود الإكسسوار أو اسمه أو تصنيفه واختر --
          </span>
        )}
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-slate-400 transition ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && !disabled && (
        <div className="absolute z-30 mt-1 w-full rounded-2xl border border-slate-300 bg-white shadow-xl overflow-hidden">
          {/* حقل البحث المباشر */}
          <div className="p-2 border-b border-slate-200 bg-slate-50">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
              <input
                ref={searchInputRef}
                autoFocus
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="اكتب كود الإكسسوار أو اسمه أو التصنيف أو كود الموديل..."
                className="w-full ps-8 pe-8 py-1.5 text-[11px] font-bold rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-pink-400"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    searchInputRef.current?.focus();
                  }}
                  className="absolute top-1/2 -translate-y-1/2 end-2 w-5 h-5 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-600 flex items-center justify-center cursor-pointer"
                  title="مسح البحث"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>


          <div className="max-h-80 overflow-y-auto">
            {groups.length === 0 ? (
              <div className="p-4 text-center text-[11px] font-bold text-slate-400">
                لا توجد إكسسوارات مطابقة لبحثك.
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.key}>
                  {/* شريط عنوان التصنيف (فاصل واضح لكل تصنيف) */}
                  <div className="sticky top-0 px-3 py-1.5 bg-slate-900 text-white flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black truncate">
                      🏷️ {group.typeName}
                    </span>
                    <span className="text-[9px] font-bold text-slate-300 shrink-0">
                      {group.items.length} صنف
                    </span>
                  </div>

                  <ul className="divide-y divide-slate-100">
                    {group.items.map((item) => {
                      const available = Number(
                        (item.quantity - item.reserved_quantity).toFixed(2)
                      );
                      const isSelected = item.id === value;
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => handleSelect(item.id)}
                            className={`w-full px-3 py-2 flex items-start gap-2 text-start transition cursor-pointer ${
                              isSelected ? 'bg-pink-100/80' : 'hover:bg-pink-50'
                            }`}
                          >
                            <AccessoryThumbnail item={item} />
                            <span className="min-w-0 flex-grow">
                              <span className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[11px] font-black text-slate-900 font-mono shrink-0">
                                  {item.code}
                                </span>
                                <span className="text-[11px] text-slate-600 truncate">
                                  {item.name}
                                </span>
                                {item.usage_type === 'custom_model' && (
                                  <span
                                    className="px-1.5 py-0.5 rounded-full border text-[9px] font-black shrink-0 bg-pink-50 border-pink-300 text-pink-800"
                                    title="خاص بموديل"
                                  >
                                    خاص بموديل {item.custom_model_code || '—'}
                                  </span>
                                )}
                                {item.usage_type === 'carryover' && (
                                  <span
                                    className="px-1.5 py-0.5 rounded-full border text-[9px] font-black shrink-0 bg-indigo-50 border-indigo-300 text-indigo-800"
                                    title="رصيد سابق / مرحّل"
                                  >
                                    رصيد سابق / مرحّل
                                  </span>
                                )}
                              </span>
                              <span className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                <span
                                  className={`px-1.5 py-0.5 rounded-full border text-[9px] font-black ${
                                    available > 0
                                      ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                                      : 'bg-rose-50 border-rose-300 text-rose-700'
                                  }`}
                                  title="المتاح للتصميم"
                                >
                                  متاح للتصميم: {available} {item.unit}
                                </span>
                                <span
                                  className="text-[9px] font-bold text-slate-400"
                                  title="الرصيد الفعلي"
                                >
                                  الفعلي: {item.quantity} {item.unit}
                                </span>
                              </span>
                            </span>
                            {isSelected && (
                              <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

