import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Check,
  Layers,
  Package,
  Pencil,
  Plus,
  Save,
  Search,
  Star,
  Trash2,
  X
} from 'lucide-react';
import { AccessoryGroup, AccessoryGroupItem, AccessoryItem } from '../types';

interface AccessoryGroupsManagerProps {
  /** هل المودال مفتوح؟ */
  open: boolean;
  /** إغلاق المودال. */
  onClose: () => void;
}

type ManagerTab = 'groups' | 'favorites';

/** تنسيق رقمي مختصر (بدون أصفار زائدة). */
const fmtNum = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  return String(Number(value.toFixed(2)));
};

/** بحث موحّد بكود الإكسسوار أو اسمه أو تصنيفه أو كود الموديل المخصص. */
const accessoryMatches = (item: AccessoryItem, term: string): boolean => {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return [item.name, item.code, item.type_name, item.custom_model_code || '']
    .join(' ')
    .toLowerCase()
    .includes(q);
};

/** صورة مصغّرة للإكسسوار أو أيقونة احتياطية عند غياب الصورة. */
const ItemThumb: React.FC<{ item?: AccessoryItem; size?: string }> = ({
  item,
  size = 'w-9 h-9'
}) =>
  item?.image ? (
    <img
      src={item.image}
      alt={item.name}
      className={`${size} rounded-xl object-cover border border-slate-200 bg-white shrink-0`}
    />
  ) : (
    <span
      className={`${size} rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0`}
    >
      <Package className="w-4 h-4 text-slate-400" />
    </span>
  );

/** شارات الرصيد: المتاح للتصميم (بعد الحجز) والرصيد الفعلي بالمخزن. */
const StockBadges: React.FC<{ item: AccessoryItem }> = ({ item }) => {
  const available = Number((item.quantity - item.reserved_quantity).toFixed(2));
  return (
    <span className="flex items-center gap-1.5 flex-wrap">
      <span
        className={`px-1.5 py-0.5 rounded-full border text-[9px] font-black ${
          available > 0
            ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
            : 'bg-rose-50 border-rose-300 text-rose-700'
        }`}
        title="المتاح للتصميم (الرصيد بعد الحجز)"
      >
        متاح للتصميم: {fmtNum(available)} {item.unit}
      </span>
      <span className="text-[9px] font-bold text-slate-400" title="الرصيد الفعلي بالمخزن">
        الفعلي: {fmtNum(item.quantity)} {item.unit}
      </span>
    </span>
  );
};

/**
 * مدير الأدوات العامة: مجموعات الإكسسوارات الجاهزة + الإكسسوارات المفضلة (الأزرار السريعة).
 * يُفتح من شاشة الإعدادات ومن شاشة تفاصيل الموديل، ويحفظ النتيجة في إعدادات الموقع العامة.
 */
export const AccessoryGroupsManager: React.FC<AccessoryGroupsManagerProps> = ({
  open,
  onClose
}) => {
  const {
    globalSettings,
    accessoryItems,
    updateGlobalSettings,
    addFlashMessage,
    canEditHeaderSettings,
    canEditMessageTemplates
  } = useApp();

  const [tab, setTab] = useState<ManagerTab>('groups');
  const [groups, setGroups] = useState<AccessoryGroup[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [favoritesSearch, setFavoritesSearch] = useState('');

  // محرّر المجموعة (إنشاء/تعديل)
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftItems, setDraftItems] = useState<AccessoryGroupItem[]>([]);
  const [itemSearch, setItemSearch] = useState('');
  const [splitTotal, setSplitTotal] = useState('1');

  const canSave = canEditHeaderSettings() || canEditMessageTemplates();

  const accById = useMemo(() => {
    const map = new Map<string, AccessoryItem>();
    accessoryItems.forEach((item) => map.set(item.id, item));
    return map;
  }, [accessoryItems]);

  // مزامنة الحالة المحلية مع الإعدادات عند فتح المودال (مع حماية من بيانات قديمة غير مصفوفية).
  useEffect(() => {
    if (!open) return;
    setGroups(Array.isArray(globalSettings.accessory_groups) ? globalSettings.accessory_groups : []);
    setFavoriteIds(
      Array.isArray(globalSettings.favorite_accessory_ids)
        ? globalSettings.favorite_accessory_ids
        : []
    );
  }, [open, globalSettings]);

  // إغلاق المودال بمفتاح Escape.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const pickerItems = useMemo(
    () => accessoryItems.filter((item) => accessoryMatches(item, itemSearch)),
    [accessoryItems, itemSearch]
  );

  const favoriteItems = useMemo(
    () => accessoryItems.filter((item) => accessoryMatches(item, favoritesSearch)),
    [accessoryItems, favoritesSearch]
  );

  const filteredGroups = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return groups;
    return groups.filter((group) => {
      if ((group.name || '').toLowerCase().includes(term)) return true;
      if ((group.description || '').toLowerCase().includes(term)) return true;
      return group.items.some((entry) => {
        const item = accById.get(entry.accessory_id);
        return item ? accessoryMatches(item, term) : false;
      });
    });
  }, [groups, searchTerm, accById]);


  const openCreateEditor = () => {
    setEditingId(null);
    setDraftName('');
    setDraftDescription('');
    setDraftItems([]);
    setItemSearch('');
    setSplitTotal('1');
    setEditorOpen(true);
  };

  const openEditEditor = (group: AccessoryGroup) => {
    setEditingId(group.id);
    setDraftName(group.name);
    setDraftDescription(group.description || '');
    setDraftItems(group.items.map((entry) => ({ ...entry })));
    setItemSearch('');
    setSplitTotal('1');
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditingId(null);
  };

  const addAccessoryToDraft = (item: AccessoryItem) => {
    setDraftItems((prev) =>
      prev.some((entry) => entry.accessory_id === item.id)
        ? prev
        : [...prev, { accessory_id: item.id, piece_consumption: 1 }]
    );
  };

  const removeAccessoryFromDraft = (accessoryId: string) => {
    setDraftItems((prev) => prev.filter((entry) => entry.accessory_id !== accessoryId));
  };

  const updateDraftConsumption = (accessoryId: string, raw: string) => {
    const value = Math.max(0, Number(raw) || 0);
    setDraftItems((prev) =>
      prev.map((entry) =>
        entry.accessory_id === accessoryId ? { ...entry, piece_consumption: value } : entry
      )
    );
  };

  /** توزيع إجمالي الاستهلاك المُدخل بالتساوي على كل عناصر المجموعة. */
  const distributeEvenly = () => {
    const count = draftItems.length;
    if (count === 0) return;
    const total = Math.max(0, Number(splitTotal) || 0);
    const per = Number((total / count).toFixed(4));
    setDraftItems((prev) => prev.map((entry) => ({ ...entry, piece_consumption: per })));
  };

  const applyEditor = () => {
    const name = draftName.trim();
    if (!name) {
      addFlashMessage('يرجى إدخال اسم المجموعة', 'danger');
      return;
    }
    if (draftItems.length === 0) {
      addFlashMessage('أضف عنصراً واحداً على الأقل إلى المجموعة', 'danger');
      return;
    }
    const cleanItems: AccessoryGroupItem[] = draftItems.map((entry) => ({
      accessory_id: entry.accessory_id,
      piece_consumption: Math.max(0, Number(entry.piece_consumption) || 0)
    }));
    const description = draftDescription.trim() || undefined;

    if (editingId) {
      setGroups((prev) =>
        prev.map((group) =>
          group.id === editingId ? { ...group, name, description, items: cleanItems } : group
        )
      );
    } else {
      setGroups((prev) => [
        ...prev,
        { id: `ag-${Date.now()}`, name, description, items: cleanItems }
      ]);
    }
    closeEditor();
  };

  const removeGroup = (id: string) => {
    if (!window.confirm('حذف هذه المجموعة نهائياً؟')) return;
    setGroups((prev) => prev.filter((group) => group.id !== id));
  };

  const toggleFavorite = (accessoryId: string) => {
    setFavoriteIds((prev) =>
      prev.includes(accessoryId)
        ? prev.filter((id) => id !== accessoryId)
        : [...prev, accessoryId]
    );
  };

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      // updateGlobalSettings يعرض رسالة النجاح/الفشل بنفسه ويحدّث الإعدادات محلياً.
      const ok = await updateGlobalSettings({
        accessory_groups: groups,
        favorite_accessory_ids: favoriteIds
      });
      if (ok) onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-3xl w-full max-w-5xl max-h-[94vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-black text-base text-slate-900 flex items-center gap-2">
              <Layers className="w-5 h-5 text-indigo-600" />
              إدارة الأدوات العامة ومجموعات الإكسسوارات
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              أنشئ مجموعات جاهزة (مثل تيكتات بيبي مقاسات 2-5) تُضاف بضغطة واحدة في شاشة
              التصميم، وحدد الإكسسوارات المفضلة كأزرار فردية سريعة.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white border border-slate-200 hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer shrink-0"
            title="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-4 sm:px-5 pt-3 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setTab('groups')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-black border transition cursor-pointer ${
              tab === 'groups'
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
            }`}
          >
            📦 مجموعات الإكسسوارات ({groups.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('favorites')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-black border transition cursor-pointer ${
              tab === 'favorites'
                ? 'bg-amber-500 text-white border-amber-500 shadow-xs'
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
            }`}
          >
            ⭐ الأدوات الفردية السريعة ({favoriteIds.length})
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {tab === 'groups' ? (
            editorOpen ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-black text-sm text-slate-900">
                    {editingId ? '✏️ تعديل المجموعة' : '➕ إنشاء مجموعة جديدة'}
                  </h4>
                  <button
                    type="button"
                    onClick={closeEditor}
                    className="px-3 py-1.5 rounded-full bg-white border border-slate-300 text-slate-600 text-[11px] font-bold hover:bg-slate-50 cursor-pointer"
                  >
                    رجوع للقائمة
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-black text-slate-700 mb-1">
                      اسم المجموعة *
                    </label>
                    <input
                      type="text"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      placeholder="مثال: تيكتات بيبي (مقاسات 2-5)"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold focus:ring-2 focus:ring-indigo-400 focus:outline-hidden"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-black text-slate-700 mb-1">
                      وصف اختياري
                    </label>
                    <input
                      type="text"
                      value={draftDescription}
                      onChange={(e) => setDraftDescription(e.target.value)}
                      placeholder="مثال: طقم تيكتات بأربع مقاسات يُضاف معاً"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold focus:ring-2 focus:ring-indigo-400 focus:outline-hidden"
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs font-black text-slate-800">
                      العناصر المختارة ({draftItems.length})
                    </span>
                    <div
                      className="flex items-center gap-1.5"
                      title="أدخل إجمالي الاستهلاك للطقم ثم وزّعه بالتساوي على العناصر"
                    >
                      <input
                        type="number"
                        min="0"
                        step="0.25"
                        value={splitTotal}
                        onChange={(e) => setSplitTotal(e.target.value)}
                        className="w-16 px-2 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-center"
                      />
                      <button
                        type="button"
                        onClick={distributeEvenly}
                        disabled={draftItems.length === 0}
                        className="px-2.5 py-1.5 rounded-lg bg-indigo-100 text-indigo-800 border border-indigo-300 text-[10px] font-black disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                      >
                        توزيع متساوٍ
                      </button>
                    </div>
                  </div>

                  {draftItems.length === 0 ? (
                    <p className="text-[11px] text-slate-500 text-center py-2">
                      لم تُضف عناصر بعد. اختر من قائمة الإكسسوارات بالأسفل.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {draftItems.map((entry) => {
                        const item = accById.get(entry.accessory_id);
                        return (
                          <li
                            key={entry.accessory_id}
                            className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 p-2"
                          >
                            <ItemThumb item={item} />
                            <div className="min-w-0 flex-grow">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-mono text-[10px] font-black px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                                  {item?.code || '—'}
                                </span>
                                <span className="text-xs font-bold text-slate-900 truncate">
                                  {item?.name || 'صنف محذوف من المخزن'}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                <span className="text-[10px] text-slate-500">
                                  {item?.type_name || '—'}
                                </span>
                                {item && <StockBadges item={item} />}
                              </div>
                            </div>
                            <label className="flex items-center gap-1 shrink-0">
                              <span className="text-[9px] font-bold text-slate-500">
                                استهلاك/قطعة
                              </span>
                              <input
                                type="number"
                                min="0"
                                step="0.25"
                                value={entry.piece_consumption}
                                onChange={(e) =>
                                  updateDraftConsumption(entry.accessory_id, e.target.value)
                                }
                                className="w-16 px-2 py-1 rounded-lg border border-slate-300 text-xs font-bold text-center"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => removeAccessoryFromDraft(entry.accessory_id)}
                              className="w-7 h-7 rounded-lg bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 flex items-center justify-center shrink-0 cursor-pointer"
                              title="إزالة"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 p-3 space-y-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
                    <input
                      type="text"
                      value={itemSearch}
                      onChange={(e) => setItemSearch(e.target.value)}
                      placeholder="ابحث بكود الإكسسوار أو اسمه أو تصنيفه لإضافته..."
                      className="w-full ps-8 pe-2 py-2 text-[11px] font-bold rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                  <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-100 divide-y divide-slate-100">
                    {pickerItems.length === 0 ? (
                      <p className="text-[11px] text-slate-400 text-center py-4">
                        لا توجد إكسسوارات مطابقة لبحثك.
                      </p>
                    ) : (
                      pickerItems.map((item) => {
                        const added = draftItems.some(
                          (entry) => entry.accessory_id === item.id
                        );
                        return (
                          <div
                            key={item.id}
                            className={`flex items-center gap-2 p-2 ${
                              added ? 'bg-emerald-50/50' : ''
                            }`}
                          >
                            <ItemThumb item={item} />
                            <div className="min-w-0 flex-grow">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-mono text-[10px] font-black px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                                  {item.code}
                                </span>
                                <span className="text-xs font-bold text-slate-900 truncate">
                                  {item.name}
                                </span>
                                <span className="text-[9px] font-bold text-slate-400">
                                  {item.type_name}
                                </span>
                              </div>
                              <div className="mt-0.5">
                                <StockBadges item={item} />
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                added
                                  ? removeAccessoryFromDraft(item.id)
                                  : addAccessoryToDraft(item)
                              }
                              className={`px-2.5 py-1 rounded-full text-[10px] font-black border flex items-center gap-1 shrink-0 cursor-pointer ${
                                added
                                  ? 'bg-emerald-100 border-emerald-300 text-emerald-800'
                                  : 'bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700'
                              }`}
                            >
                              {added ? (
                                <>
                                  <Check className="w-3 h-3" /> مضاف
                                </>
                              ) : (
                                <>
                                  <Plus className="w-3 h-3" /> إضافة
                                </>
                              )}
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeEditor}
                    className="px-4 py-2 rounded-full border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-50 cursor-pointer"
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    onClick={applyEditor}
                    className="px-5 py-2 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    {editingId ? 'تحديث المجموعة' : 'إضافة المجموعة'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="relative flex-grow max-w-xs">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="ابحث في المجموعات أو عناصرها..."
                      className="w-full ps-8 pe-2 py-2 text-[11px] font-bold rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={openCreateEditor}
                    className="px-4 py-2 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" /> مجموعة جديدة
                  </button>
                </div>

                {filteredGroups.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                    <p className="text-xs font-bold text-slate-600">لا توجد مجموعات بعد.</p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      أنشئ أول مجموعة مثل «تيكتات بيبي (مقاسات 2-5)» لتظهر كزر إضافة سريع في
                      شاشة التصميم.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

                    {filteredGroups.map((group) => (
                      <div
                        key={group.id}
                        className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-3 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h5 className="font-black text-sm text-indigo-950 flex items-center gap-1.5">
                              <Package className="w-4 h-4 text-indigo-600 shrink-0" />
                              <span className="truncate">{group.name}</span>
                            </h5>
                            {group.description && (
                              <p className="text-[11px] text-slate-600 mt-0.5">
                                {group.description}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => openEditEditor(group)}
                              className="w-7 h-7 rounded-lg bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-100 flex items-center justify-center cursor-pointer"
                              title="تعديل"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeGroup(group.id)}
                              className="w-7 h-7 rounded-lg bg-white border border-rose-200 text-rose-600 hover:bg-rose-100 flex items-center justify-center cursor-pointer"
                              title="حذف"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-1">
                          {group.items.map((entry) => {
                            const item = accById.get(entry.accessory_id);
                            return (
                              <span
                                key={entry.accessory_id}
                                className="px-1.5 py-0.5 rounded-full bg-white border border-indigo-200 text-[9px] font-bold text-slate-700"
                              >
                                {item
                                  ? `${item.code} · ${fmtNum(entry.piece_consumption)}`
                                  : 'صنف محذوف'}
                              </span>
                            );
                          })}
                        </div>

                        <span className="text-[10px] font-black text-indigo-800">
                          {group.items.length} عنصر
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          ) : (
            <div className="space-y-3">
              <div className="relative max-w-sm">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
                <input
                  type="text"
                  value={favoritesSearch}
                  onChange={(e) => setFavoritesSearch(e.target.value)}
                  placeholder="ابحث عن إكسسوار لتحديده كأداة سريعة..."
                  className="w-full ps-8 pe-2 py-2 text-[11px] font-bold rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                />
              </div>

              {favoriteItems.length === 0 ? (
                <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center">
                  لا توجد إكسسوارات مسجلة في مخزن الإكسسوارات حالياً. أضف أصنافاً في مخزن
                  الإكسسوارات أولاً لتحديد المفضّل منها.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-[52vh] overflow-y-auto p-1">
                  {favoriteItems.map((item) => {
                    const isFav = favoriteIds.includes(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggleFavorite(item.id)}
                        className={`flex items-center gap-2 p-2.5 rounded-2xl border text-start transition cursor-pointer ${
                          isFav
                            ? 'bg-amber-500/15 border-amber-500 ring-2 ring-amber-400/30'
                            : 'bg-white border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <ItemThumb item={item} />
                        <div className="min-w-0 flex-grow">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono text-[10px] font-black px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                              {item.code}
                            </span>
                            <span className="text-xs font-bold text-slate-900 truncate">
                              {item.name}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-500 block mt-0.5">
                            {item.type_name}
                          </span>
                          <div className="mt-0.5">
                            <StockBadges item={item} />
                          </div>
                        </div>
                        <span
                          className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border ${
                            isFav
                              ? 'bg-amber-500 border-amber-600 text-white'
                              : 'bg-slate-100 border-slate-300 text-transparent'
                          }`}
                        >
                          <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-white' : ''}`} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11px] text-slate-500">
            {canSave
              ? 'سيتم تطبيق المجموعات والأدوات المفضلة على شاشة التصميم فور الحفظ.'
              : 'لا تملك صلاحية تعديل الإعدادات العامة، لذلك لا يمكن الحفظ.'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-full border border-slate-300 text-slate-700 font-bold text-xs hover:bg-white cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave || saving}
              className="px-5 py-2 rounded-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black text-xs flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
            >
              <Save className="w-4 h-4" />
              {saving ? 'جارٍ الحفظ...' : 'حفظ وتطبيق'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

