import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  Ruler,
  Building2,
  Users,
  ShieldCheck,
  Shield,
  Plus,
  Trash2,
  Sliders,
  History,
  Globe,
  Upload,
  Save,
  MessageCircle,
  FileText,
  Sparkles,
  RotateCcw,
  Lock,
  Pencil,
  Check,
  X,
  Star
} from 'lucide-react';
import { User } from '../types';
import { EditUserModal } from './EditUserModal';
import { RoleManagementSection, DEFAULT_PERMISSIONS } from './RoleManagementSection';

interface SettingsViewProps {
  onOpenLogs: () => void;
}

type SettingsTab = 'users' | 'roles' | 'global_settings' | 'sizes_suppliers';

export const SettingsView: React.FC<SettingsViewProps> = ({ onOpenLogs }) => {
  const {
    roles,
    sizeDefs,
    suppliers,
    users,
    accessoryItems,
    globalSettings,
    updateGlobalSettings,
    addSizeDef,
    updateSizeDef,
    deleteSizeDef,
    addSupplier,
    updateSupplier,
    deleteSupplier,
    addUser,
    deleteUser,
    toggleUserActive,
    updateUserPermissionsAndPassword,
    canManagePermissions,
    canManageUsers,
    canManageSuppliers,
    canManageSizes,
    canViewAuditLogs,
    canViewGlobalSettings,
    canEditHeaderSettings,
    canEditMessageTemplates,
    visibleRankOptions,
    currentUserRank
  } = useApp();

  // Strictly filter out sudo so regular users never see or know of sudo (Task 2)
  const visibleUsers = users.filter(
    (u) => u.username?.toLowerCase() !== 'sudo' && !u.is_sudo
  );

  const hasUsersPerm = canManageUsers();
  const hasRolesPerm = canManagePermissions();
  const hasGlobalSettingsPerm = canViewGlobalSettings();
  const hasSizesOrSuppliersPerm = canManageSizes() || canManageSuppliers();
  const hasAuditLogsPerm = canViewAuditLogs();

  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    if (canManageUsers()) return 'users';
    if (canManagePermissions()) return 'roles';
    if (canViewGlobalSettings()) return 'global_settings';
    if (canManageSizes() || canManageSuppliers()) return 'sizes_suppliers';
    return 'users';
  });

  // Size Form & Edit State
  const [sizeName, setSizeName] = useState('');
  const [sizeValues, setSizeValues] = useState('');
  const [editingSizeId, setEditingSizeId] = useState<string | null>(null);
  const [editSizeName, setEditSizeName] = useState('');
  const [editSizeValues, setEditSizeValues] = useState('');

  // Supplier Form & Edit State
  const [supName, setSupName] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [editingSupId, setEditingSupId] = useState<string | null>(null);
  const [editSupName, setEditSupName] = useState('');
  const [editSupPhone, setEditSupPhone] = useState('');

  // User Form State
  const [realName, setRealName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState<string>(roles[0]?.id || '');
  const rankOptions = visibleRankOptions();
  const [newUserRank, setNewUserRank] = useState<number>(
    () => Number(visibleRankOptions()[visibleRankOptions().length - 1]?.value ?? 3)
  );

  // Global Settings Form State (Task 3 + Favorite Accessories)
  const [siteName, setSiteName] = useState(globalSettings.site_name);
  const [siteLogo, setSiteLogo] = useState(globalSettings.logo);
  const [footerTitle, setFooterTitle] = useState(globalSettings.footer_title);
  const [copyrightText, setCopyrightText] = useState(globalSettings.copyright_text);
  const [whatsappTemplate, setWhatsappTemplate] = useState(globalSettings.whatsapp_supplier_template);
  const [sewingInstructions, setSewingInstructions] = useState(globalSettings.default_sewing_instructions);
  const [internalTemplates, setInternalTemplates] = useState<string[]>(
    globalSettings.internal_message_templates || []
  );
  const [favoriteAccessoryIds, setFavoriteAccessoryIds] = useState<string[]>(
    globalSettings.favorite_accessory_ids || []
  );
  const [newInternalTemplate, setNewInternalTemplate] = useState('');

  useEffect(() => {
    setSiteName(globalSettings.site_name || 'نظام إدارة المصنع');
    setSiteLogo(globalSettings.logo || '🏭');
    setFooterTitle(globalSettings.footer_title || '');
    setCopyrightText(globalSettings.copyright_text || '');
    setWhatsappTemplate(globalSettings.whatsapp_supplier_template || '');
    setSewingInstructions(globalSettings.default_sewing_instructions || '');
    setInternalTemplates(globalSettings.internal_message_templates || []);
    setFavoriteAccessoryIds(globalSettings.favorite_accessory_ids || []);
  }, [globalSettings]);

  useEffect(() => {
    if (!selectedRoleId && roles.length > 0) {
      setSelectedRoleId(roles[0].id);
    }
  }, [roles, selectedRoleId]);

  // User modal edit state
  const [selectedUserForModal, setSelectedUserForModal] = useState<User | null>(null);

  const handleAddSize = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sizeName.trim() || !sizeValues.trim()) return;
    addSizeDef(sizeName.trim(), sizeValues.trim());
    setSizeName('');
    setSizeValues('');
  };

  const handleStartEditSize = (id: string, currentName: string, currentValues: string) => {
    setEditingSizeId(id);
    setEditSizeName(currentName);
    setEditSizeValues(currentValues);
  };

  const handleSaveEditSize = (id: string) => {
    if (!editSizeName.trim() || !editSizeValues.trim()) return;
    updateSizeDef(id, editSizeName.trim(), editSizeValues.trim());
    setEditingSizeId(null);
  };

  const handleAddSupplier = (e: React.FormEvent) => {
    e.preventDefault();
    if (!supName.trim()) return;
    addSupplier(supName.trim(), supPhone.trim());
    setSupName('');
    setSupPhone('');
  };

  const handleStartEditSupplier = (id: string, currentName: string, currentPhone: string) => {
    setEditingSupId(id);
    setEditSupName(currentName);
    setEditSupPhone(currentPhone || '');
  };

  const handleSaveEditSupplier = (id: string) => {
    if (!editSupName.trim()) return;
    updateSupplier(id, editSupName.trim(), editSupPhone.trim());
    setEditingSupId(null);
  };

  const handleToggleFavoriteAccessory = (accId: string) => {
    setFavoriteAccessoryIds((prev) =>
      prev.includes(accId) ? prev.filter((id) => id !== accId) : [...prev, accId]
    );
  };

  const handleAddUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!realName.trim() || !username.trim() || !password) return;

    const effectiveRoleId = selectedRoleId || roles[0]?.id || '';
    const matchedRole = roles.find((r) => r.id === effectiveRoleId);

    addUser({
      real_name: realName.trim(),
      username: username.trim(),
      password,
      role: matchedRole ? matchedRole.name : 'موظف تشغيل',
      role_id: effectiveRoleId || undefined,
      is_active: true,
      rank_level: newUserRank,
      permissions: matchedRole?.permissions
        ? { ...DEFAULT_PERMISSIONS, ...matchedRole.permissions }
        : { ...DEFAULT_PERMISSIONS }
    });

    setRealName('');
    setUsername('');
    setPassword('');
  };

  const handleLogoFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (reader.result) {
          setSiteLogo(reader.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddInternalTemplate = () => {
    if (!newInternalTemplate.trim()) return;
    setInternalTemplates((prev) => [...prev, newInternalTemplate.trim()]);
    setNewInternalTemplate('');
  };

  const handleRemoveInternalTemplate = (index: number) => {
    setInternalTemplates((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSaveGlobalSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateGlobalSettings({
      site_name: siteName.trim() || 'نظام إدارة المصنع',
      logo: siteLogo.trim() || '🏭',
      footer_title: footerTitle.trim(),
      copyright_text: copyrightText.trim(),
      whatsapp_supplier_template: whatsappTemplate,
      default_sewing_instructions: sewingInstructions,
      internal_message_templates: internalTemplates,
      favorite_accessory_ids: favoriteAccessoryIds
    });
  };

  const isImageLogo =
    siteLogo.startsWith('http://') ||
    siteLogo.startsWith('https://') ||
    siteLogo.startsWith('data:image/') ||
    siteLogo.startsWith('/');

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <span>⚙️ إعدادات النظام والصلاحيات والإعدادات العامة</span>
          </h2>
          <p className="text-slate-500 text-sm mt-0.5">
            إدارة الحسابات، الصلاحيات الديناميكية، إعدادات الموقع والأدوات العامة، فئات المقاسات، والموردين
          </p>
        </div>

        {/* Top Settings Tabs */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-2xl border border-slate-200/80 flex-wrap">
          {hasUsersPerm && (
            <button
              onClick={() => setActiveTab('users')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'users'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>إدارة الموظفين</span>
              <span className="px-1.5 py-0.2 bg-slate-200 text-slate-800 text-[10px] rounded-full">
                {visibleUsers.length}
              </span>
            </button>
          )}

          {hasRolesPerm && (
            <button
              onClick={() => setActiveTab('roles')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'roles'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-indigo-700 hover:text-indigo-900 hover:bg-indigo-50 font-bold'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>إدارة الصلاحيات</span>
            </button>
          )}

          {hasGlobalSettingsPerm && (
            <button
              onClick={() => setActiveTab('global_settings')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'global_settings'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 font-bold'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>الإعدادات والأدوات العامة</span>
            </button>
          )}

          {hasSizesOrSuppliersPerm && (
            <button
              onClick={() => setActiveTab('sizes_suppliers')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'sizes_suppliers'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>المقاسات والموردين</span>
            </button>
          )}

          {hasAuditLogsPerm && (
            <button
              onClick={onOpenLogs}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 transition cursor-pointer"
            >
              <History className="w-3.5 h-3.5" />
              <span>سجل التدقيق</span>
            </button>
          )}
        </div>
      </div>

      {/* Tab 1: Roles Management */}
      {activeTab === 'roles' && hasRolesPerm && <RoleManagementSection />}

      {/* Tab 2: Global Site Settings & General Tools */}
      {activeTab === 'global_settings' && hasGlobalSettingsPerm && (
        <form onSubmit={handleSaveGlobalSettings} className="space-y-6">
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-emerald-600 text-white shadow-xs">
                  <Globe className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">
                    الإعدادات والأدوات العامة (Global Settings & General Tools)
                  </h3>
                  <p className="text-xs text-slate-500">
                    تحكم ديناميكي في هوية الموقع، نصوص الرسائل، واختيار الإكسسوارات المفضلة/الدائمة للاستخدام السريع في التصميم.
                  </p>
                </div>
              </div>

              <button
                type="submit"
                disabled={!canEditHeaderSettings() && !canEditMessageTemplates()}
                className="px-6 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black text-xs shadow-md shadow-emerald-600/20 transition flex items-center gap-2 cursor-pointer self-start sm:self-auto"
              >
                <Save className="w-4 h-4" />
                <span>حفظ وتطبيق الإعدادات العامة</span>
              </button>
            </div>

            {/* Part A: Header, Logo & Footer Settings (Controlled by edit_header_settings) */}
            <div className="bg-slate-50/70 rounded-3xl p-5 border border-slate-200/90 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                  <span>🏢 هوية الموقع والهيدر والفوتر (Header, Logo & Footer)</span>
                </h4>
                {!canEditHeaderSettings() && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                    <Lock className="w-3 h-3" />
                    للعرض فقط (يتطلب صلاحية تعديل الهيدر)
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    اسم الموقع / المصنع (يظهر في القائمة والمطبوعات) *
                  </label>
                  <input
                    type="text"
                    required
                    disabled={!canEditHeaderSettings()}
                    value={siteName}
                    onChange={(e) => setSiteName(e.target.value)}
                    placeholder="مثال: مصنع النور للملابس الجاهزة"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-xs font-bold focus:ring-2 focus:ring-emerald-500 focus:outline-hidden disabled:opacity-60"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    شعار الموقع (Logo — رابط صورة، رفع ملف، أو رمز)
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="w-11 h-11 rounded-xl bg-white border border-slate-300 flex items-center justify-center shrink-0 overflow-hidden shadow-2xs">
                      {isImageLogo ? (
                        <img src={siteLogo} alt="Logo Preview" className="w-full h-full object-contain p-1" />
                      ) : (
                        <span className="text-xl">{siteLogo || '🏭'}</span>
                      )}
                    </div>
                    <input
                      type="text"
                      disabled={!canEditHeaderSettings()}
                      value={siteLogo}
                      onChange={(e) => setSiteLogo(e.target.value)}
                      placeholder="رابط الشعار أو رمز (🏭)"
                      className="flex-grow px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-hidden disabled:opacity-60"
                    />
                    {canEditHeaderSettings() && (
                      <label className="px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer flex items-center gap-1.5 shrink-0 transition">
                        <Upload className="w-3.5 h-3.5" />
                        <span>رفع شعار</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleLogoFileUpload}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    النص التعريفي في الفوتر (Footer Title)
                  </label>
                  <input
                    type="text"
                    disabled={!canEditHeaderSettings()}
                    value={footerTitle}
                    onChange={(e) => setFooterTitle(e.target.value)}
                    placeholder="🏭 نظام إدارة المصنع المتكامل - مصانع الملابس الجاهزة"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-xs font-semibold focus:ring-2 focus:ring-emerald-500 focus:outline-hidden disabled:opacity-60"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    جملة حقوق الملكية في الفوتر (Copyright Text) *
                  </label>
                  <input
                    type="text"
                    required
                    disabled={!canEditHeaderSettings()}
                    value={copyrightText}
                    onChange={(e) => setCopyrightText(e.target.value)}
                    placeholder="تم التطوير لدعم دورة الإنتاج الشاملة © 2026"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-xs font-semibold focus:ring-2 focus:ring-emerald-500 focus:outline-hidden disabled:opacity-60"
                  />
                </div>
              </div>
            </div>

            {/* Part B: General Tools - Favorite / Permanent Accessories for Quick Use in Design */}
            <div className="bg-amber-50/40 rounded-3xl p-5 border border-amber-200/90 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h4 className="font-extrabold text-sm text-amber-950 flex items-center gap-2">
                    <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                    <span>🛠️ الأدوات العامة: الإكسسوارات المفضلة / الدائمة (أزرار سريعة في قسم التصميم)</span>
                  </h4>
                  <p className="text-xs text-slate-600 mt-0.5">
                    حدد الإكسسوارات الدائمة (مثل: أستيك، قمر، شريط، إلخ) من مخزن الإكسسوارات ليتم حفظها وظهورها كأزرار إضافة سريعة داخل شاشة التصميم.
                  </p>
                </div>
                <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-xs font-black">
                  محدد حالياً: {favoriteAccessoryIds.length} عنصر
                </span>
              </div>

              {accessoryItems.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 max-h-72 overflow-y-auto p-1">
                  {accessoryItems.map((acc) => {
                    const isFav = favoriteAccessoryIds.includes(acc.id);
                    const avail = acc.quantity - acc.reserved_quantity;
                    return (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => handleToggleFavoriteAccessory(acc.id)}
                        className={`flex items-center justify-between gap-2 p-3 rounded-2xl border text-start transition cursor-pointer ${
                          isFav
                            ? 'bg-amber-500/15 border-amber-500 text-amber-950 shadow-2xs ring-2 ring-amber-400/30'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[10px] font-black px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                              {acc.code}
                            </span>
                            <span className="font-bold text-xs truncate">{acc.name}</span>
                          </div>
                          <span className="text-[10px] text-slate-500 block mt-0.5">
                            {acc.type_name} • متاح: {avail} {acc.unit}
                          </span>
                        </div>
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border ${
                            isFav
                              ? 'bg-amber-500 border-amber-600 text-white'
                              : 'bg-slate-100 border-slate-300 text-transparent'
                          }`}
                        >
                          <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-white' : ''}`} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-slate-500 bg-white p-4 rounded-2xl border border-slate-200 text-center">
                  لا توجد إكسسوارات مسجلة في مخزن الإكسسوارات حالياً. أضف أصنافاً في مخزن الإكسسوارات أولاً لتحديد المفضل منها.
                </p>
              )}
            </div>

            {/* Part C: Message Templates & Default Sewing Print Instructions */}
            <div className="bg-emerald-50/40 rounded-3xl p-5 border border-emerald-200/90 space-y-5">
              <div className="flex items-center justify-between">
                <h4 className="font-extrabold text-sm text-emerald-950 flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-emerald-600" />
                  <span>💬 نصوص الرسائل الجاهزة وتعليمات طباعة المكن الافتراضية</span>
                </h4>
                {!canEditMessageTemplates() && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                    <Lock className="w-3 h-3" />
                    للعرض فقط (يتطلب صلاحية تعديل الرسائل)
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* WhatsApp Supplier Message Template */}
                <div className="bg-white p-4 rounded-2xl border border-emerald-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                      <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
                      <span>نص رسالة الواتساب الجاهزة للموردين:</span>
                    </label>
                    {canEditMessageTemplates() && (
                      <button
                        type="button"
                        onClick={() =>
                          setWhatsappTemplate(
                            'السلام عليكم ورحمة الله، مطلوب طلبية توريد عاجلة لمصنعنا:\n- الصنف / الخامة: {item_name}\n- الكود / اللون: {code}\n- الكمية المطلوبة: {quantity} {unit}\n- الرصيد الحالي بالمخزن: {available} {unit}\nبرجاء التأكيد وتحديد موعد الشحن. شكراً لكم.'
                          )
                        }
                        className="text-[10px] font-bold text-slate-500 hover:text-emerald-700 flex items-center gap-1 cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>استعادة الافتراضي</span>
                      </button>
                    )}
                  </div>
                  <textarea
                    rows={5}
                    disabled={!canEditMessageTemplates()}
                    value={whatsappTemplate}
                    onChange={(e) => setWhatsappTemplate(e.target.value)}
                    className="w-full p-3 rounded-xl border border-slate-300 text-xs font-semibold leading-relaxed focus:ring-2 focus:ring-emerald-500 focus:outline-hidden disabled:opacity-60"
                  />
                  <p className="text-[10px] text-slate-500 leading-normal">
                    المتغيرات المتاحة للاستبدال التلقائي:{' '}
                    <code className="bg-slate-100 px-1 rounded text-emerald-800">{'{item_name}'}</code> اسم الخامة/الإكسسوار،{' '}
                    <code className="bg-slate-100 px-1 rounded text-emerald-800">{'{code}'}</code> الكود/اللون،{' '}
                    <code className="bg-slate-100 px-1 rounded text-emerald-800">{'{quantity}'}</code> الكمية المطلوبة،{' '}
                    <code className="bg-slate-100 px-1 rounded text-emerald-800">{'{unit}'}</code> الوحدة،{' '}
                    <code className="bg-slate-100 px-1 rounded text-emerald-800">{'{available}'}</code> الرصيد المتاح.
                  </p>
                </div>

                {/* Default Sewing Print Instructions */}
                <div className="bg-white p-4 rounded-2xl border border-emerald-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-indigo-600" />
                      <span>النص الافتراضي لتعليمات وملاحظات طباعة المكن (للورش):</span>
                    </label>
                    {canEditMessageTemplates() && (
                      <button
                        type="button"
                        onClick={() =>
                          setSewingInstructions(
                            'تم التأكد من أعداد الإكسسوارات ومطابقتها للمواصفات الفنية وعينة الاعتماد قبل التسليم للورشة.\nيرجى الالتزام التام بمقاسات القص والتشطيب النظيف وموعد الاستلام المتوقع.'
                          )
                        }
                        className="text-[10px] font-bold text-slate-500 hover:text-indigo-700 flex items-center gap-1 cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>استعادة الافتراضي</span>
                      </button>
                    )}
                  </div>
                  <textarea
                    rows={5}
                    disabled={!canEditMessageTemplates()}
                    value={sewingInstructions}
                    onChange={(e) => setSewingInstructions(e.target.value)}
                    placeholder="مثال: تم التأكد من أعداد الإكسسوارات ومطابقتها للمواصفات الفنية..."
                    className="w-full p-3 rounded-xl border border-slate-300 text-xs font-semibold leading-relaxed focus:ring-2 focus:ring-indigo-500 focus:outline-hidden disabled:opacity-60"
                  />
                  <p className="text-[10px] text-slate-500 leading-normal">
                    يظهر هذا النص تلقائياً في القسم السفلي للتعليمات والملاحظات في صفحة <strong>طباعة المكن</strong> التي تذهب للورش، مع إمكانية تعديله قبل الطباعة.
                  </p>
                </div>
              </div>

              {/* Ready-made Internal Message Templates */}
              <div className="bg-white p-4 rounded-2xl border border-emerald-200 space-y-3">
                <label className="block text-xs font-black text-slate-900 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                  <span>قوالب الرسائل الداخلية الجاهزة (تظهر كأزرار سريعة في نافذة المراسلات الداخلية):</span>
                </label>

                {canEditMessageTemplates() && (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newInternalTemplate}
                      onChange={(e) => setNewInternalTemplate(e.target.value)}
                      placeholder="أضف نص رسالة جاهزة جديدة..."
                      className="flex-grow px-3.5 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                    />
                    <button
                      type="button"
                      onClick={handleAddInternalTemplate}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition cursor-pointer shrink-0"
                    >
                      + إضافة قالب
                    </button>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {internalTemplates.map((tpl, idx) => (
                    <div
                      key={idx}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700"
                    >
                      <span>{tpl}</span>
                      {canEditMessageTemplates() && (
                        <button
                          type="button"
                          onClick={() => handleRemoveInternalTemplate(idx)}
                          className="text-rose-500 hover:text-rose-700 font-bold cursor-pointer"
                          title="حذف القالب"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* Tab 3: Users Management */}
      {activeTab === 'users' && hasUsersPerm && (
        <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-600" />
                <span>إدارة حسابات الموظفين والصلاحيات</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                إنشاء وتعديل حسابات العاملين وتعيين الأدوار وتخصيص أي صلاحية لأي مستخدم
              </p>
            </div>

            {hasRolesPerm && (
              <button
                onClick={() => setActiveTab('roles')}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold text-xs border border-indigo-200 transition cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4 text-indigo-600" />
                <span>إدارة الصلاحيات الديناميكية →</span>
              </button>
            )}
          </div>

          {/* Add User Form */}
          <form
            onSubmit={handleAddUser}
            className="bg-slate-50 p-5 rounded-2xl border border-slate-200/80 space-y-4"
          >
            <h4 className="text-xs font-black text-slate-800 flex items-center gap-1.5">
              <Plus className="w-4 h-4 text-indigo-600" />
              <span>إضافة مستخدم جديد</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">اسم الموظف</label>
                <input
                  type="text"
                  required
                  value={realName}
                  onChange={(e) => setRealName(e.target.value)}
                  placeholder="مثال: يوسف حسام"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">اسم المستخدم</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">كلمة المرور</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  الدور والصلاحية المخصصة
                </label>
                <select
                  value={selectedRoleId}
                  onChange={(e) => setSelectedRoleId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-xs font-semibold focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              {currentUserRank !== 3 && (
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    الرتبة الهرمية
                  </label>
                  <select
                    value={newUserRank}
                    onChange={(e) => setNewUserRank(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-xs font-semibold focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                  >
                    {rankOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-md transition cursor-pointer"
              >
                إنشاء حساب الموظف
              </button>
            </div>
          </form>

          {/* Users Table */}
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full text-xs text-start">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 text-center">
                <tr>
                  <th className="px-4 py-3 text-start">الاسم</th>
                  <th className="px-4 py-3">اسم المستخدم</th>
                  <th className="px-4 py-3">الدور / الصلاحية</th>
                  {currentUserRank !== 3 && <th className="px-4 py-3">الرتبة</th>}
                  <th className="px-4 py-3">الحالة</th>
                  <th className="px-4 py-3">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-center">
                {visibleUsers.length > 0 ? (
                  visibleUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3.5 font-bold text-slate-900 text-start flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-800 font-bold flex items-center justify-center text-xs">
                          {u.real_name ? u.real_name[0] : 'U'}
                        </div>
                        <span>{u.real_name}</span>
                      </td>

                      <td className="px-4 py-3.5 text-slate-500 font-mono">@{u.username}</td>

                      <td className="px-4 py-3.5">
                        <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-800 font-bold text-xs border border-slate-200">
                          {u.role}
                        </span>
                      </td>

                      {currentUserRank !== 3 && (
                        <td className="px-4 py-3.5">
                          <span className="px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-800 font-bold border border-purple-200">
                            {u.rank_label || `المستوى ${u.rank_level ?? 3}`}
                          </span>
                        </td>
                      )}

                      <td className="px-4 py-3.5">
                        {u.is_active ? (
                          <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold">
                            نشط
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold">
                            موقوف
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => toggleUserActive(u.id)}
                            className={`px-3 py-1 rounded-full text-xs font-bold transition border cursor-pointer ${
                              u.is_active
                                ? 'border-rose-300 text-rose-700 hover:bg-rose-50'
                                : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                            }`}
                          >
                            {u.is_active ? 'إيقاف' : 'تفعيل'}
                          </button>

                          <button
                            onClick={() => setSelectedUserForModal(u)}
                            className="px-3.5 py-1 rounded-full border border-blue-200 bg-blue-50/70 hover:bg-blue-600 hover:text-white text-blue-700 font-bold text-xs transition flex items-center gap-1 cursor-pointer"
                          >
                            <Shield className="w-3.5 h-3.5" />
                            <span>تخصيص الصلاحيات</span>
                          </button>

                          <button
                            onClick={() => deleteUser(u.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                            title="حذف حساب الموظف"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400">
                      لا يوجد موظفون مسجلون حالياً. يمكنك إضافة موظف جديد من النموذج أعلاه.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Sizes & Suppliers (With Edit & Delete buttons connected to Backend) */}
      {activeTab === 'sizes_suppliers' && hasSizesOrSuppliersPerm && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 1. Size Categories Definition */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs flex flex-col justify-between">
            <div>
              <h3 className="text-base font-extrabold text-blue-600 mb-4 flex items-center gap-2">
                <Ruler className="w-5 h-5" />
                <span>📏 تعريف فئات المقاسات</span>
              </h3>

              {canManageSizes() && (
                <form
                  onSubmit={handleAddSize}
                  className="space-y-3 mb-6 bg-slate-50 p-4 rounded-2xl border border-slate-200/60"
                >
                  <div>
                    <input
                      type="text"
                      required
                      value={sizeName}
                      onChange={(e) => setSizeName(e.target.value)}
                      placeholder="اسم الفئة (مثال: بيبي، وسط، شبابي، رجالي)"
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      required
                      value={sizeValues}
                      onChange={(e) => setSizeValues(e.target.value)}
                      placeholder="المقاسات (مثال: 2, 3, 4, 5 أو S, M, L, XL)"
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs transition shadow-xs cursor-pointer"
                  >
                    إضافة الفئة
                  </button>
                </form>
              )}

              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="w-full text-xs text-center">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2.5 text-start">الفئة</th>
                      <th className="px-4 py-2.5">المقاسات الداخلية</th>
                      {canManageSizes() && <th className="px-4 py-2.5">إجراءات</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sizeDefs.map((s) => {
                      const isEditing = editingSizeId === s.id;
                      return (
                        <tr key={s.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-extrabold text-slate-900 text-start">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editSizeName}
                                onChange={(e) => setEditSizeName(e.target.value)}
                                className="w-full px-2.5 py-1 rounded-lg border border-blue-300 text-xs font-bold"
                              />
                            ) : (
                              s.name
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editSizeValues}
                                onChange={(e) => setEditSizeValues(e.target.value)}
                                className="w-full px-2.5 py-1 rounded-lg border border-blue-300 text-xs font-bold"
                              />
                            ) : (
                              <div className="flex items-center justify-center gap-1 flex-wrap">
                                {s.values.split(',').map((val, idx) => (
                                  <span
                                    key={idx}
                                    className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 font-bold text-[11px]"
                                  >
                                    {val.trim()}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          {canManageSizes() && (
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-center gap-1.5">
                                {isEditing ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleSaveEditSize(s.id)}
                                      className="p-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition cursor-pointer"
                                      title="حفظ"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingSizeId(null)}
                                      className="p-1.5 rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300 transition cursor-pointer"
                                      title="إلغاء"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleStartEditSize(s.id, s.name, s.values)}
                                      className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition cursor-pointer"
                                      title="تعديل المقاس"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => deleteSizeDef(s.id)}
                                      className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                                      title="حذف المقاس"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* 2. Suppliers Management */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs flex flex-col justify-between">
            <div>
              <h3 className="text-base font-extrabold text-emerald-600 mb-4 flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                <span>🏢 الموردين وشركات الغزل والإكسسوار</span>
              </h3>

              {canManageSuppliers() && (
                <form
                  onSubmit={handleAddSupplier}
                  className="space-y-3 mb-6 bg-slate-50 p-4 rounded-2xl border border-slate-200/60"
                >
                  <div>
                    <input
                      type="text"
                      required
                      value={supName}
                      onChange={(e) => setSupName(e.target.value)}
                      placeholder="اسم المورد أو شركة الغزل أو مستودع الإكسسوار"
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      value={supPhone}
                      onChange={(e) => setSupPhone(e.target.value)}
                      placeholder="رقم الهاتف للتواصل أو الواتساب"
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition shadow-xs cursor-pointer"
                  >
                    إضافة المورد
                  </button>
                </form>
              )}

              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="w-full text-xs text-start">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2.5">اسم المورد</th>
                      <th className="px-4 py-2.5">رقم الهاتف</th>
                      {canManageSuppliers() && <th className="px-4 py-2.5 text-center">إجراءات</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {suppliers.map((sup) => {
                      const isEditing = editingSupId === sup.id;
                      return (
                        <tr key={sup.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-extrabold text-slate-900">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editSupName}
                                onChange={(e) => setEditSupName(e.target.value)}
                                className="w-full px-2.5 py-1 rounded-lg border border-emerald-300 text-xs font-bold"
                              />
                            ) : (
                              sup.name
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-600 font-mono">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editSupPhone}
                                onChange={(e) => setEditSupPhone(e.target.value)}
                                className="w-full px-2.5 py-1 rounded-lg border border-emerald-300 text-xs font-mono"
                              />
                            ) : (
                              sup.phone || '-'
                            )}
                          </td>
                          {canManageSuppliers() && (
                            <td className="px-4 py-3 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                {isEditing ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleSaveEditSupplier(sup.id)}
                                      className="p-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition cursor-pointer"
                                      title="حفظ"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingSupId(null)}
                                      className="p-1.5 rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300 transition cursor-pointer"
                                      title="إلغاء"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleStartEditSupplier(sup.id, sup.name, sup.phone)}
                                      className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition cursor-pointer"
                                      title="تعديل المورد"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => deleteSupplier(sup.id)}
                                      className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                                      title="حذف المورد"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Standalone Edit User Permissions & Password Modal */}
      {selectedUserForModal && (
        <EditUserModal
          user={selectedUserForModal}
          onClose={() => setSelectedUserForModal(null)}
          onSave={(userId, permissions, newPassword, newRole, roleId, newRank) => {
            updateUserPermissionsAndPassword(userId, permissions, newPassword, newRole, roleId, newRank);
            setSelectedUserForModal(null);
          }}
        />
      )}
    </div>
  );
};