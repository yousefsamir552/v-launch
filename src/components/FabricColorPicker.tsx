import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Fabric, FabricColor, Supplier } from '../types';

interface FabricColorPickerProps {
  colors: FabricColor[];
  fabrics: Fabric[];
  suppliers: Supplier[];
  /** معرّف اللون المختار حالياً. */
  value: string;
  onChange: (colorId: string) => void;
  disabled?: boolean;
}

interface ColorGroup {
  key: string;
  fabric?: Fabric;
  supplierName: string;
  items: FabricColor[];
}

/**
 * قائمة منسدلة ذكية قابلة للبحث لاختيار اللون والخامة من المخزن.
 * - بحث مباشر بكود اللون أو اسم اللون أو اسم الخامة أو المورد.
 * - مجموعات مفصولة لكل خامة، ولكل مجموعة شريط عنوان (الخامة • الوحدة • المورد).
 */
export const FabricColorPicker: React.FC<FabricColorPickerProps> = ({
  colors,
  fabrics,
  suppliers,
  value,
  onChange,
  disabled = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const selectedColor = colors.find((color) => color.id === value);
  const selectedFabric = fabrics.find((fabric) => fabric.id === selectedColor?.fabric_id);

  // إغلاق القائمة عند الضغط خارجها.
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen]);

  // تجميع الألوان حسب الخامة مع تطبيق فلتر البحث.
  const groups = useMemo<ColorGroup[]>(() => {
    const term = searchTerm.trim().toLowerCase();
    const map = new Map<string, ColorGroup>();

    colors.forEach((color) => {
      const fabric = fabrics.find((f) => f.id === color.fabric_id);
      const supplierName =
        suppliers.find((supplier) => supplier.id === fabric?.supplier_id)?.name || '';
      const haystack = [
        color.color_code,
        color.color_name,
        fabric?.name,
        supplierName
      ]
        .join(' ')
        .toLowerCase();

      if (term && !haystack.includes(term)) return;

      const key = fabric?.id || color.fabric_id || 'unknown-fabric';
      if (!map.has(key)) {
        map.set(key, { key, fabric, supplierName, items: [] });
      }
      map.get(key)!.items.push(color);
    });

    return Array.from(map.values());
  }, [colors, fabrics, suppliers, searchTerm]);

  const handleSelect = (colorId: string) => {
    onChange(colorId);
    setIsOpen(false);
    setSearchTerm('');
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full px-3 py-2 text-xs rounded-xl border bg-white flex items-center gap-2 text-start transition ${
          isOpen ? 'border-amber-400 ring-2 ring-amber-200' : 'border-slate-300'
        } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-amber-300'}`}
      >
        {selectedColor ? (
          <span className="flex items-center gap-2 min-w-0 flex-grow">
            <span
              className="w-4 h-4 rounded-md border border-slate-300 shrink-0"
              style={{ backgroundColor: selectedColor.hex_code || '#ffffff' }}
            />
            <span className="font-black text-slate-900 shrink-0">{selectedColor.color_code}</span>
            <span className="text-slate-600 truncate">{selectedColor.color_name || 'بدون اسم'}</span>
            <span className="text-slate-300 shrink-0">|</span>
            <span className="text-slate-500 truncate">{selectedFabric?.name || 'خامة غير معروفة'}</span>
          </span>
        ) : (
          <span className="text-slate-400 flex-grow truncate">
            -- ابحث بكود اللون أو اسم اللون أو الخامة واختر --
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
                autoFocus
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="اكتب كود اللون (C-101) أو اسم اللون أو الخامة..."
                className="w-full ps-8 pe-3 py-1.5 text-[11px] font-bold rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
              />
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {groups.length === 0 ? (
              <div className="p-4 text-center text-[11px] font-bold text-slate-400">
                لا توجد خامات أو ألوان مطابقة لبحثك.
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.key}>
                  {/* شريط عنوان الخامة (فاصل واضح لكل خامة) */}
                  <div className="sticky top-0 px-3 py-1.5 bg-slate-900 text-white flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black truncate">
                      🧵 {group.fabric?.name || 'خامة غير معروفة'}
                    </span>
                    <span className="text-[9px] font-bold text-slate-300 shrink-0">
                      {[
                        group.fabric?.unit ? `الوحدة: ${group.fabric.unit}` : '',
                        group.supplierName ? `المورد: ${group.supplierName}` : ''
                      ]
                        .filter(Boolean)
                        .join(' • ')}
                    </span>
                  </div>

                  <ul className="divide-y divide-slate-100">
                    {group.items.map((color) => {
                      const availableForDesign = Number(
                        (color.quantity - color.reserved_quantity).toFixed(2)
                      );
                      const isSelected = color.id === value;
                      return (
                        <li key={color.id}>
                          <button
                            type="button"
                            onClick={() => handleSelect(color.id)}
                            className={`w-full px-3 py-2 flex items-center gap-2 text-start transition cursor-pointer ${
                              isSelected ? 'bg-amber-100/80' : 'hover:bg-amber-50'
                            }`}
                          >
                            <span
                              className="w-4 h-4 rounded-md border border-slate-300 shrink-0"
                              style={{ backgroundColor: color.hex_code || '#ffffff' }}
                            />
                            <span className="text-[11px] font-black text-slate-900 shrink-0">
                              {color.color_code}
                            </span>
                            <span className="text-[11px] text-slate-600 truncate flex-grow">
                              {color.color_name || 'بدون اسم'}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded-full border text-[9px] font-black shrink-0 ${
                                availableForDesign > 0
                                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                                  : 'bg-rose-50 border-rose-300 text-rose-700'
                              }`}
                              title="المتاح للتصميم"
                            >
                              متاح للتصميم: {availableForDesign} {group.fabric?.unit || ''}
                            </span>
                            <span
                              className="text-[9px] font-bold text-slate-400 shrink-0"
                              title="المخزون الفعلي الكلي"
                            >
                              الفعلي: {color.quantity}
                            </span>
                            {isSelected && (
                              <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
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
