import React, { useEffect, useMemo, useState } from 'react';
import {
  Pencil,
  Save,
  RotateCcw,
  X,
  Plus,
  Trash2,
  GripVertical,
  ArrowUp,
  ArrowDown,
  ChevronRight,
  ChevronLeft,
  LayoutGrid,
  Search,
  SquareDashed,
  Minus,
  FolderPlus,
  Loader2,
  Check
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { CardsLayoutConfig, CardsLayoutGroup, CardsLayoutItem } from '../types';
import {
  buildDefaultCardsLayout,
  getAuthorizedNavSections,
  NavSectionDef,
  reconcileCardsLayout
} from '../utils/navCatalog';
import { computeAccessoryShortages } from '../utils/accessoryShortages';

interface NavigationCardsViewProps {
  onNavigate: (tab: string) => void;
}

interface DragPayload {
  sourceGroupId: string;
  itemId: string;
}

export const NavigationCardsView: React.FC<NavigationCardsViewProps> = ({ onNavigate }) => {
  const {
    currentUser,
    globalSettings,
    hasPermission,
    hasAssemblyPackagingAccess,
    canAccessReadinessStage,
    canManageHR,
    canAccessHRSection,
    canAccessSettings,
    canViewAuditLogs,
    canCustomizeNavigation,
    uiPreferences,
    updateUiPreferences,
    addFlashMessage,
    purchaseRequests,
    accessoryItems,
    suppliers
  } = useApp();

  const isSudo =
    currentUser?.username?.toLowerCase() === 'sudo' || Boolean(currentUser?.is_sudo);
  const canEditLayout = canCustomizeNavigation();

  const purchaseAlertCount = useMemo(() => {
    const pendingManual = (purchaseRequests || []).filter((r) => r.status === 'pending').length;
    const lowStockAccessories = computeAccessoryShortages(
      accessoryItems || [],
      suppliers || []
    ).length;
    return pendingManual + lowStockAccessories;
  }, [purchaseRequests, accessoryItems, suppliers]);

  const authorizedSections = useMemo(
    () =>
      getAuthorizedNavSections({
        isSudo,
        hasPermission,
        hasAssemblyPackagingAccess,
        canAccessReadinessStage,
        canManageHR,
        canAccessHRSection,
        canAccessSettings,
        canViewAuditLogs,
        purchaseAlertCount
      }),
    [
      isSudo,
      hasPermission,
      hasAssemblyPackagingAccess,
      canAccessReadinessStage,
      canManageHR,
      canAccessHRSection,
      canAccessSettings,
      canViewAuditLogs,
      purchaseAlertCount
    ]
  );

  const sectionMap = useMemo(() => {
    const map = new Map<string, NavSectionDef>();
    authorizedSections.forEach((sec) => map.set(sec.id, sec));
    return map;
  }, [authorizedSections]);

  const resolvedLayout = useMemo(
    () => reconcileCardsLayout(uiPreferences.cards_layout, authorizedSections),
    [uiPreferences.cards_layout, authorizedSections]
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [draftLayout, setDraftLayout] = useState<CardsLayoutConfig>(resolvedLayout);
  const [resetToNullPending, setResetToNullPending] = useState(false);
  const [saving, setSaving] = useState(false);

  // Add group inline form state
  const [newGroupName, setNewGroupName] = useState('');
  const [showAddGroupForm, setShowAddGroupForm] = useState(false);
  const [editingGroupTitleId, setEditingGroupTitleId] = useState<string | null>(null);
  const [selectedGroupForInsert, setSelectedGroupForInsert] = useState<string>('');

  // HTML5 Drag & Drop state
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<{
    groupId: string;
    itemId?: string;
  } | null>(null);

  useEffect(() => {
    if (!isEditing) {
      setDraftLayout(resolvedLayout);
      setResetToNullPending(false);
    }
  }, [resolvedLayout, isEditing]);

  useEffect(() => {
    if (isEditing && draftLayout.groups.length > 0) {
      const exists = draftLayout.groups.some((g) => g.id === selectedGroupForInsert);
      if (!exists) {
        setSelectedGroupForInsert(draftLayout.groups[0].id);
      }
    }
  }, [isEditing, draftLayout.groups, selectedGroupForInsert]);

  const startEditing = () => {
    if (!canEditLayout) return;
    setDraftLayout(JSON.parse(JSON.stringify(resolvedLayout)));
    setResetToNullPending(false);
    setSearchQuery('');
    setShowAddGroupForm(false);
    setEditingGroupTitleId(null);
    setSelectedGroupForInsert(resolvedLayout.groups[0]?.id || '');
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setDraftLayout(resolvedLayout);
    setResetToNullPending(false);
    setDragging(null);
    setDragOverTarget(null);
    setShowAddGroupForm(false);
    setEditingGroupTitleId(null);
  };

  const mutateDraft = (updater: (prev: CardsLayoutConfig) => CardsLayoutConfig) => {
    setResetToNullPending(false);
    setDraftLayout((prev) => updater(prev));
  };

  const handleCreateGroup = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const title = newGroupName.trim();
    if (!title) return;
    const newId = `grp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    mutateDraft((prev) => ({
      ...prev,
      groups: [
        {
          id: newId,
          title,
          items: []
        },
        ...prev.groups
      ]
    }));
    setSelectedGroupForInsert(newId);
    setNewGroupName('');
    setShowAddGroupForm(false);
  };

  const handleRenameGroup = (groupId: string, nextTitle: string) => {
    mutateDraft((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => (g.id === groupId ? { ...g, title: nextTitle } : g))
    }));
  };

  const handleMoveGroup = (groupId: string, direction: -1 | 1) => {
    mutateDraft((prev) => {
      const idx = prev.groups.findIndex((g) => g.id === groupId);
      const targetIdx = idx + direction;
      if (idx < 0 || targetIdx < 0 || targetIdx >= prev.groups.length) return prev;
      const next = [...prev.groups];
      const [moved] = next.splice(idx, 1);
      next.splice(targetIdx, 0, moved);
      return { ...prev, groups: next };
    });
  };

  const handleDeleteGroup = (groupId: string) => {
    mutateDraft((prev) => {
      const target = prev.groups.find((g) => g.id === groupId);
      if (!target) return prev;
      const rescuedCards = target.items.filter((item) => item.kind === 'card');
      const remaining = prev.groups.filter((g) => g.id !== groupId);

      if (remaining.length === 0) {
        // نبقي مجموعة عامة واحدة دائماً حتى لا يختفي أي قسم.
        return {
          ...prev,
          groups: [
            {
              id: 'grp-general',
              title: 'الأقسام العامة',
              items: rescuedCards
            }
          ]
        };
      }

      if (rescuedCards.length > 0) {
        // نبحث عن مجموعة "الأقسام العامة" أو نضيفها للمجموعة الأخيرة المتبقية.
        const generalIdx = remaining.findIndex(
          (g) => g.id === 'grp-general' || g.title.trim() === 'الأقسام العامة'
        );
        if (generalIdx >= 0) {
          const updated = remaining.map((g, i) =>
            i === generalIdx ? { ...g, items: [...g.items, ...rescuedCards] } : g
          );
          return { ...prev, groups: updated };
        }
        return {
          ...prev,
          groups: [
            ...remaining,
            {
              id: 'grp-general',
              title: 'الأقسام العامة',
              items: rescuedCards
            }
          ]
        };
      }

      return { ...prev, groups: remaining };
    });
  };

  const handleAddSpacer = (groupId?: string) => {
    const targetId = groupId || selectedGroupForInsert || draftLayout.groups[0]?.id;
    if (!targetId) return;
    const spacer: CardsLayoutItem = {
      kind: 'spacer',
      id: `spacer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    };
    mutateDraft((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id === targetId ? { ...g, items: [...g.items, spacer] } : g
      )
    }));
  };

  const handleAddDivider = (groupId?: string) => {
    const targetId = groupId || selectedGroupForInsert || draftLayout.groups[0]?.id;
    if (!targetId) return;
    const divider: CardsLayoutItem = {
      kind: 'divider',
      id: `divider-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: ''
    };
    mutateDraft((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id === targetId ? { ...g, items: [...g.items, divider] } : g
      )
    }));
  };

  const handleUpdateDividerLabel = (groupId: string, itemId: string, label: string) => {
    mutateDraft((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id === groupId
          ? {
              ...g,
              items: g.items.map((it) =>
                it.id === itemId && it.kind === 'divider' ? { ...it, label } : it
              )
            }
          : g
      )
    }));
  };

  const handleRemoveDecorativeItem = (groupId: string, itemId: string) => {
    mutateDraft((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id === groupId
          ? {
              ...g,
              items: g.items.filter((it) => !(it.id === itemId && it.kind !== 'card'))
            }
          : g
      )
    }));
  };

  const handleMoveItemWithinGroup = (groupId: string, itemId: string, direction: -1 | 1) => {
    mutateDraft((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => {
        if (g.id !== groupId) return g;
        const idx = g.items.findIndex((it) => it.id === itemId);
        const nextIdx = idx + direction;
        if (idx < 0 || nextIdx < 0 || nextIdx >= g.items.length) return g;
        const nextItems = [...g.items];
        const [moved] = nextItems.splice(idx, 1);
        nextItems.splice(nextIdx, 0, moved);
        return { ...g, items: nextItems };
      })
    }));
  };

  const handleMoveItemToGroup = (
    sourceGroupId: string,
    itemId: string,
    targetGroupId: string,
    beforeItemId?: string
  ) => {
    if (sourceGroupId === targetGroupId && itemId === beforeItemId) return;
    mutateDraft((prev) => {
      let movedItem: CardsLayoutItem | null = null;
      const withoutSource = prev.groups.map((g) => {
        if (g.id !== sourceGroupId) return g;
        const found = g.items.find((it) => it.id === itemId);
        if (found) movedItem = found;
        return { ...g, items: g.items.filter((it) => it.id !== itemId) };
      });
      if (!movedItem) return prev;
      const itemToInsert = movedItem;

      const updated = withoutSource.map((g) => {
        if (g.id !== targetGroupId) return g;
        const nextItems = [...g.items];
        if (beforeItemId) {
          const targetIdx = nextItems.findIndex((it) => it.id === beforeItemId);
          if (targetIdx >= 0) {
            nextItems.splice(targetIdx, 0, itemToInsert);
            return { ...g, items: nextItems };
          }
        }
        nextItems.push(itemToInsert);
        return { ...g, items: nextItems };
      });
      return { ...prev, groups: updated };
    });
  };

  const handleResetDefault = () => {
    const def = buildDefaultCardsLayout(authorizedSections);
    setDraftLayout(def);
    setResetToNullPending(true);
    setSelectedGroupForInsert(def.groups[0]?.id || '');
    addFlashMessage('تمت استعادة الترتيب الافتراضي — اضغط «حفظ الترتيب» لتثبيته', 'info');
  };

  const handleSaveLayout = async () => {
    if (saving || !canEditLayout) return;
    setSaving(true);
    try {
      // نظّف عناوين المجموعات الفارغة قبل الحفظ
      const payloadLayout: CardsLayoutConfig | null = resetToNullPending
        ? null
        : {
            version: 1,
            groups: draftLayout.groups.map((g, idx) => ({
              id: g.id,
              title: g.title.trim() || `مجموعة ${idx + 1}`,
              items: g.items
            }))
          };
      const result = await updateUiPreferences({ cards_layout: payloadLayout });
      if (result.success) {
        addFlashMessage('تم حفظ تخطيط كروت التنقل بنجاح', 'success');
        setIsEditing(false);
        setResetToNullPending(false);
      } else {
        addFlashMessage(result.message || 'تعذر حفظ تخطيط الكروت', 'danger');
      }
    } finally {
      setSaving(false);
    }
  };

  // Drag handlers
  const onItemDragStart = (
    e: React.DragEvent,
    sourceGroupId: string,
    itemId: string
  ) => {
    if (!isEditing) return;
    setDragging({ sourceGroupId, itemId });
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', JSON.stringify({ sourceGroupId, itemId }));
    } catch {
      // ignore
    }
  };

  const onItemDragOver = (
    e: React.DragEvent,
    groupId: string,
    itemId?: string
  ) => {
    if (!isEditing) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverTarget((prev) =>
      prev && prev.groupId === groupId && prev.itemId === itemId ? prev : { groupId, itemId }
    );
  };

  const onItemDrop = (
    e: React.DragEvent,
    targetGroupId: string,
    targetItemId?: string
  ) => {
    if (!isEditing) return;
    e.preventDefault();
    e.stopPropagation();

    let payload = dragging;
    if (!payload) {
      try {
        const raw = e.dataTransfer.getData('text/plain');
        if (raw) payload = JSON.parse(raw);
      } catch {
        // ignore
      }
    }
    if (payload && payload.sourceGroupId && payload.itemId) {
      handleMoveItemToGroup(
        payload.sourceGroupId,
        payload.itemId,
        targetGroupId,
        targetItemId
      );
    }
    setDragging(null);
    setDragOverTarget(null);
  };

  const onDragEnd = () => {
    setDragging(null);
    setDragOverTarget(null);
  };

  const activeLayout = isEditing ? draftLayout : resolvedLayout;
  const trimmedSearch = searchQuery.trim().toLowerCase();

  const displayedGroups: CardsLayoutGroup[] = useMemo(() => {
    if (isEditing || !trimmedSearch) {
      return activeLayout.groups.filter((g) => isEditing || g.items.some((it) => it.kind === 'card'));
    }
    return activeLayout.groups
      .map((g) => ({
        ...g,
        items: g.items.filter((it) => {
          if (it.kind !== 'card') return false;
          const sec = sectionMap.get(it.tabId);
          if (!sec) return false;
          return (
            sec.label.toLowerCase().includes(trimmedSearch) ||
            sec.subtitle.toLowerCase().includes(trimmedSearch) ||
            g.title.toLowerCase().includes(trimmedSearch)
          );
        })
      }))
      .filter((g) => g.items.length > 0);
  }, [activeLayout.groups, isEditing, trimmedSearch, sectionMap]);

  const siteName = globalSettings?.site_name || 'نظام إدارة المصنع';

  return (
    <div className="space-y-6 animate-in fade-in duration-200" dir="rtl">
      {/* Top Header */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* Right side: Title & Greeting */}
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-sm shrink-0">
              <LayoutGrid className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight truncate">
                أقسام {siteName}
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                مرحباً <strong className="text-slate-700">{currentUser?.real_name || currentUser?.username}</strong> — اختر القسم المطلوب للدخول المباشر ({authorizedSections.length} قسم متاح لك)
              </p>
            </div>
          </div>

          {/* Left side (أعلى يسار الصفحة): Search + Edit Layout Pencil Button */}
          <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap shrink-0">
            {!isEditing && (
              <div className="relative flex-1 sm:w-56">
                <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ابحث عن قسم..."
                  className="w-full ps-9 pe-8 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-xs font-semibold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute end-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            {canEditLayout && !isEditing && (
              <button
                type="button"
                onClick={startEditing}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black shadow-sm transition cursor-pointer"
                title="تعديل ترتيب الكروت والمجموعات والفراغات والفواصل"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>تعديل التخطيط</span>
              </button>
            )}

            {isEditing && (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleSaveLayout}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black shadow-sm transition disabled:opacity-60 cursor-pointer"
                >
                  {saving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  <span>حفظ الترتيب</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetDefault}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-bold transition cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>إعادة الترتيب الافتراضي</span>
                </button>
                <button
                  type="button"
                  onClick={cancelEditing}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>إلغاء</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Edit Mode Toolbar */}
        {isEditing && (
          <div className="mt-5 pt-4 border-t border-indigo-100 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-indigo-50/70 border border-indigo-200/80 rounded-2xl p-3.5">
              <div className="space-y-0.5">
                <p className="text-xs font-black text-indigo-950 flex items-center gap-1.5">
                  <Pencil className="w-3.5 h-3.5 text-indigo-600" />
                  <span>وضع تعديل التخطيط نشط</span>
                </p>
                <p className="text-[11px] font-semibold text-indigo-800/80">
                  اسحب أي كارت وأفلته في مكانه الجديد داخل نفس المجموعة أو انقله لمجموعة أخرى، أو استخدم أزرار الأسهم للتعديل السريع.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setShowAddGroupForm((v) => !v)}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  <span>+ إنشاء مجموعة جديدة</span>
                </button>

                {draftLayout.groups.length > 0 && (
                  <div className="flex items-center gap-1.5 bg-white border border-indigo-200 rounded-xl px-2 py-1">
                    <span className="text-[10px] font-bold text-slate-500">إدراج في:</span>
                    <select
                      value={selectedGroupForInsert}
                      onChange={(e) => setSelectedGroupForInsert(e.target.value)}
                      className="text-[11px] font-bold text-slate-800 bg-transparent focus:outline-hidden cursor-pointer max-w-[140px]"
                    >
                      {draftLayout.groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.title || 'مجموعة بدون اسم'}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => handleAddSpacer()}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold transition cursor-pointer"
                      title="إضافة خانة فارغة (Spacer) لترتيب الشبكة"
                    >
                      <SquareDashed className="w-3.5 h-3.5" />
                      <span>+ مساحة فارغة</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddDivider()}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold transition cursor-pointer"
                      title="إضافة فاصل أفقي بين الكروت"
                    >
                      <Minus className="w-3.5 h-3.5" />
                      <span>+ فاصل</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Inline Create New Group Form */}
            {showAddGroupForm && (
              <form
                onSubmit={handleCreateGroup}
                className="flex flex-wrap items-center gap-2 bg-white border-2 border-indigo-200 rounded-2xl p-3 animate-in fade-in duration-150"
              >
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="اسم المجموعة الجديدة (مثال: شغلي اليومي، متابعة الإنتاج، المخازن...)"
                  className="flex-1 min-w-[220px] px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-bold focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  autoFocus
                />
                <button
                  type="submit"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>إضافة المجموعة</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddGroupForm(false);
                    setNewGroupName('');
                  }}
                  className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold transition cursor-pointer"
                >
                  إلغاء
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      {/* Groups & Cards Grid */}
      {displayedGroups.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center space-y-2">
          <LayoutGrid className="w-10 h-10 text-slate-300 mx-auto" />
          <p className="text-sm font-black text-slate-700">لا توجد أقسام مطابقة لبحثك</p>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="mt-2 px-4 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold cursor-pointer"
            >
              إظهار جميع الأقسام
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {displayedGroups.map((group, groupIdx) => {
            const isGroupDropHighlight =
              isEditing &&
              dragOverTarget?.groupId === group.id &&
              !dragOverTarget?.itemId;
            const groupCardCount = group.items.filter((it) => it.kind === 'card').length;

            return (
              <section
                key={group.id}
                onDragOver={(e) => onItemDragOver(e, group.id)}
                onDrop={(e) => onItemDrop(e, group.id)}
                className={`rounded-3xl transition-all ${
                  isEditing
                    ? `bg-white/90 border-2 p-4 sm:p-5 ${
                        isGroupDropHighlight
                          ? 'border-indigo-500 bg-indigo-50/40 ring-4 ring-indigo-200/60'
                          : 'border-dashed border-slate-300'
                      }`
                    : 'space-y-3'
                }`}
              >
                {/* Group Header */}
                <div
                  className={`flex flex-wrap items-center justify-between gap-2 ${
                    isEditing ? 'pb-3 mb-3 border-b border-slate-200/80' : 'px-1'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-1.5 h-5 rounded-full bg-indigo-600 shrink-0" />
                    {isEditing && editingGroupTitleId === group.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={group.title}
                          onChange={(e) => handleRenameGroup(group.id, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') setEditingGroupTitleId(null);
                          }}
                          className="px-3 py-1 rounded-xl border border-indigo-400 text-sm font-black text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 bg-white"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => setEditingGroupTitleId(null)}
                          className="p-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer"
                          title="تم"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <h2 className="text-sm sm:text-base font-black text-slate-800 truncate">
                        {group.title}
                      </h2>
                    )}
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold">
                      {groupCardCount}
                    </span>
                  </div>

                  {isEditing && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() =>
                          setEditingGroupTitleId(
                            editingGroupTitleId === group.id ? null : group.id
                          )
                        }
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold transition cursor-pointer"
                        title="إعادة تسمية المجموعة"
                      >
                        <Pencil className="w-3 h-3" />
                        <span>تسمية</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddSpacer(group.id)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold transition cursor-pointer"
                        title="إضافة مساحة فارغة لهذه المجموعة"
                      >
                        <SquareDashed className="w-3 h-3" />
                        <span>+ فراغ</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddDivider(group.id)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold transition cursor-pointer"
                        title="إضافة فاصل أفقي لهذه المجموعة"
                      >
                        <Minus className="w-3 h-3" />
                        <span>+ فاصل</span>
                      </button>
                      <button
                        type="button"
                        disabled={groupIdx === 0}
                        onClick={() => handleMoveGroup(group.id, -1)}
                        className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-35 transition cursor-pointer"
                        title="تحريك المجموعة لأعلى"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={groupIdx === displayedGroups.length - 1}
                        onClick={() => handleMoveGroup(group.id, 1)}
                        className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-35 transition cursor-pointer"
                        title="تحريك المجموعة لأسفل"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteGroup(group.id)}
                        className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 transition cursor-pointer"
                        title="حذف المجموعة (تُعاد كروتها تلقائياً للمجموعة العامة)"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Cards / Spacers / Dividers Grid */}
                {group.items.length === 0 && isEditing ? (
                  <div className="py-8 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/70 text-center text-xs font-bold text-slate-400">
                    اسحب أي كارت قسم وأفلته هنا لإضافته إلى «{group.title}»
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5 sm:gap-4">
                    {group.items.map((item, itemIdx) => {
                      const isDraggingThis =
                        dragging?.sourceGroupId === group.id && dragging?.itemId === item.id;
                      const isDropHere =
                        isEditing &&
                        dragOverTarget?.groupId === group.id &&
                        dragOverTarget?.itemId === item.id &&
                        !isDraggingThis;

                      // 1. DIVIDER ITEM
                      if (item.kind === 'divider') {
                        if (!isEditing) {
                          return (
                            <div
                              key={item.id}
                              className="col-span-full flex items-center gap-3 py-1.5"
                            >
                              <div className="flex-1 h-px bg-slate-200" />
                              {item.label?.trim() && (
                                <span className="px-3 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-[11px] font-black text-slate-600">
                                  {item.label}
                                </span>
                              )}
                              <div className="flex-1 h-px bg-slate-200" />
                            </div>
                          );
                        }

                        return (
                          <div
                            key={item.id}
                            draggable
                            onDragStart={(e) => onItemDragStart(e, group.id, item.id)}
                            onDragOver={(e) => onItemDragOver(e, group.id, item.id)}
                            onDrop={(e) => onItemDrop(e, group.id, item.id)}
                            onDragEnd={onDragEnd}
                            className={`col-span-full flex flex-wrap items-center gap-2 px-3 py-2 rounded-2xl border-2 border-dashed bg-slate-50 transition ${
                              isDraggingThis
                                ? 'opacity-40 border-indigo-400'
                                : isDropHere
                                ? 'border-indigo-500 ring-2 ring-indigo-300 bg-indigo-50/50'
                                : 'border-slate-300'
                            }`}
                          >
                            <GripVertical className="w-4 h-4 text-slate-400 cursor-grab shrink-0" />
                            <span className="text-[11px] font-black text-slate-500 shrink-0">
                              فاصل أفقي:
                            </span>
                            <input
                              type="text"
                              value={item.label || ''}
                              onChange={(e) =>
                                handleUpdateDividerLabel(group.id, item.id, e.target.value)
                              }
                              placeholder="عنوان اختياري للفاصل..."
                              className="flex-1 min-w-[140px] px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-400"
                            />
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                disabled={itemIdx === 0}
                                onClick={() => handleMoveItemWithinGroup(group.id, item.id, -1)}
                                className="p-1 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-35 cursor-pointer"
                                title="تحريك للخلف"
                              >
                                <ChevronRight className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={itemIdx === group.items.length - 1}
                                onClick={() => handleMoveItemWithinGroup(group.id, item.id, 1)}
                                className="p-1 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-35 cursor-pointer"
                                title="تحريك للأمام"
                              >
                                <ChevronLeft className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveDecorativeItem(group.id, item.id)}
                                className="p-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 cursor-pointer"
                                title="حذف الفاصل"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      }

                      // 2. SPACER ITEM
                      if (item.kind === 'spacer') {
                        if (!isEditing) {
                          return (
                            <div
                              key={item.id}
                              aria-hidden="true"
                              className="hidden sm:block min-h-[120px] pointer-events-none select-none"
                            />
                          );
                        }

                        return (
                          <div
                            key={item.id}
                            draggable
                            onDragStart={(e) => onItemDragStart(e, group.id, item.id)}
                            onDragOver={(e) => onItemDragOver(e, group.id, item.id)}
                            onDrop={(e) => onItemDrop(e, group.id, item.id)}
                            onDragEnd={onDragEnd}
                            className={`min-h-[138px] rounded-2xl border-2 border-dashed p-3 flex flex-col items-center justify-between gap-2 bg-slate-50/70 transition ${
                              isDraggingThis
                                ? 'opacity-40 border-indigo-400'
                                : isDropHere
                                ? 'border-indigo-500 ring-2 ring-indigo-300 bg-indigo-50/50 scale-[1.02]'
                                : 'border-slate-300'
                            }`}
                          >
                            <div className="w-full flex items-center justify-between">
                              <GripVertical className="w-4 h-4 text-slate-400 cursor-grab" />
                              <button
                                type="button"
                                onClick={() => handleRemoveDecorativeItem(group.id, item.id)}
                                className="p-1 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 cursor-pointer"
                                title="حذف المساحة الفارغة"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div className="text-center space-y-1">
                              <SquareDashed className="w-5 h-5 text-slate-400 mx-auto" />
                              <span className="block text-[11px] font-bold text-slate-500">
                                مساحة فارغة
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={itemIdx === 0}
                                onClick={() => handleMoveItemWithinGroup(group.id, item.id, -1)}
                                className="p-1 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-35 cursor-pointer"
                                title="تحريك يمين"
                              >
                                <ChevronRight className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={itemIdx === group.items.length - 1}
                                onClick={() => handleMoveItemWithinGroup(group.id, item.id, 1)}
                                className="p-1 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-35 cursor-pointer"
                                title="تحريك يسار"
                              >
                                <ChevronLeft className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      }

                      // 3. SECTION CARD ITEM
                      const sec = sectionMap.get(item.tabId);
                      if (!sec) return null;
                      const Icon = sec.icon;
                      const alerts = sec.alertCount || 0;

                      if (!isEditing) {
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => onNavigate(sec.id)}
                            className={`group relative flex flex-col items-start justify-between text-start p-4 sm:p-5 min-h-[138px] rounded-2xl bg-white border border-slate-200/90 shadow-2xs hover:shadow-md hover:-translate-y-0.5 ${sec.borderHover} transition-all duration-150 cursor-pointer`}
                          >
                            {alerts > 0 && (
                              <span
                                className="absolute top-3 end-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-mono font-black"
                                title={`يوجد ${alerts} تنبيه`}
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                {alerts}
                              </span>
                            )}

                            <div
                              className={`w-11 h-11 rounded-2xl ${sec.iconBg} flex items-center justify-center shadow-2xs group-hover:scale-105 transition-transform`}
                            >
                              <Icon className={`w-5 h-5 ${sec.iconColor}`} />
                            </div>

                            <div className="mt-3.5 space-y-1 w-full">
                              <h3 className="text-sm font-black text-slate-900 leading-snug group-hover:text-blue-700 transition-colors">
                                {sec.label}
                              </h3>
                              <p className="text-[11px] font-medium text-slate-500 leading-relaxed line-clamp-2">
                                {sec.subtitle}
                              </p>
                            </div>
                          </button>
                        );
                      }

                      // Card in Edit Mode (Draggable + Arrow & Group-Move Helpers)
                      return (
                        <div
                          key={item.id}
                          draggable
                          onDragStart={(e) => onItemDragStart(e, group.id, item.id)}
                          onDragOver={(e) => onItemDragOver(e, group.id, item.id)}
                          onDrop={(e) => onItemDrop(e, group.id, item.id)}
                          onDragEnd={onDragEnd}
                          className={`relative flex flex-col justify-between p-3.5 min-h-[152px] rounded-2xl bg-white border-2 transition cursor-grab active:cursor-grabbing ${
                            isDraggingThis
                              ? 'opacity-40 border-indigo-400 scale-95'
                              : isDropHere
                              ? 'border-indigo-500 ring-2 ring-indigo-300 bg-indigo-50/40 scale-[1.02]'
                              : 'border-slate-200 hover:border-indigo-300 shadow-2xs'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div
                              className={`w-9 h-9 rounded-xl ${sec.iconBg} flex items-center justify-center shrink-0`}
                            >
                              <Icon className={`w-4 h-4 ${sec.iconColor}`} />
                            </div>
                            <span
                              className="p-1 rounded-lg bg-slate-100 text-slate-400"
                              title="اسحب للترتيب"
                            >
                              <GripVertical className="w-3.5 h-3.5" />
                            </span>
                          </div>

                          <div className="my-2">
                            <p className="text-xs font-black text-slate-900 leading-snug">
                              {sec.label}
                            </p>
                          </div>

                          {/* Touch / Mac fallback controls */}
                          <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-1">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={itemIdx === 0}
                                onClick={() => handleMoveItemWithinGroup(group.id, item.id, -1)}
                                className="p-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-35 transition cursor-pointer"
                                title="تحريك للسابق"
                              >
                                <ChevronRight className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={itemIdx === group.items.length - 1}
                                onClick={() => handleMoveItemWithinGroup(group.id, item.id, 1)}
                                className="p-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-35 transition cursor-pointer"
                                title="تحريك للتالي"
                              >
                                <ChevronLeft className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {draftLayout.groups.length > 1 && (
                              <select
                                value={group.id}
                                onChange={(e) =>
                                  handleMoveItemToGroup(group.id, item.id, e.target.value)
                                }
                                title="نقل لمجموعة أخرى"
                                className="max-w-[92px] px-1.5 py-0.5 rounded-lg border border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-700 focus:outline-hidden cursor-pointer"
                              >
                                {draftLayout.groups.map((targetGrp) => (
                                  <option key={targetGrp.id} value={targetGrp.id}>
                                    {targetGrp.title || 'مجموعة'}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};
