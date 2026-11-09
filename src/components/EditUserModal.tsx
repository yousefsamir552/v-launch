import React, { useState } from 'react';
import { User, UserPermissions, RolePermissions, HR_SECTION_PERM_MAP } from '../types';
import { useApp } from '../context/AppContext';
import {
  SYSTEM_SECTIONS,
  NOTES_PERMISSIONS_LIST,
  ADMIN_AND_SETTINGS_PERMISSIONS_LIST,
  HR_PERMISSIONS_LIST,
  DEFAULT_PERMISSIONS
} from './RoleManagementSection';
import {
  X,
  ShieldCheck,
  Eye,
  EyeOff,
  Check,
  FileText,
  Settings,
  Coins,
  Sliders,
  Users
} from 'lucide-react';

interface EditUserModalProps {
  user: User;
  onClose: () => void;
  onSave: (
    userId: string,
    permissions: UserPermissions,
    newPassword?: string,
    newRole?: string,
    roleId?: string,
    newRank?: number
  ) => void;
}

export const EditUserModal: React.FC<EditUserModalProps> = ({ user, onClose, onSave }) => {
  const { roles, visibleRankOptions, currentUserRank } = useApp();
  const [selectedRoleId, setSelectedRoleId] = useState<string>(user.role_id || '');
  const [roleName, setRoleName] = useState<string>(user.role);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const rankOptions = visibleRankOptions();
  const [rankLevel, setRankLevel] = useState<number>(() => {
    const allowed = visibleRankOptions().map((opt) => Number(opt.value));
    const current = Number(user.rank_level ?? 3);
    return allowed.includes(current) ? current : allowed[allowed.length - 1] ?? 3;
  });

  const isSudoUser = user.username?.toLowerCase() === 'sudo' || Boolean(user.is_sudo);

  // Selected role object
  const currentRoleObj = roles.find((r) => r.id === selectedRoleId || r.name === roleName);

  // Compute initial effective permissions combining the user's role + user.permissions overrides
  const [customPerms, setCustomPerms] = useState<Record<string, any>>(() => {
    const base = {
      ...DEFAULT_PERMISSIONS,
      ...(currentRoleObj?.permissions || {}),
      ...(user.permissions || {})
    };
    return base;
  });

  const handleRoleChange = (roleId: string) => {
    setSelectedRoleId(roleId);
    const matched = roles.find((r) => r.id === roleId);
    if (matched) {
      setRoleName(matched.name);
      setCustomPerms({
        ...DEFAULT_PERMISSIONS,
        ...matched.permissions
      });
    }
  };

  const togglePermKey = (key: string) => {
    setCustomPerms((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (key.endsWith('_edit') && next[key]) {
        const viewKey = key.replace('_edit', '_view');
        next[viewKey] = true;
      }
      if (key.endsWith('_view') && !next[key]) {
        const editKey = key.replace('_view', '_edit');
        next[editKey] = false;
      }
      if ((key === 'edit_header_settings' || key === 'edit_message_templates') && next[key]) {
        next.view_global_settings = true;
      }
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSudoUser) {
      onClose();
      return;
    }

    onSave(
      user.id,
      customPerms as UserPermissions,
      password || undefined,
      roleName,
      selectedRoleId || undefined,
      rankLevel
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
              {user.real_name ? user.real_name[0] : 'U'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 text-base">
                  تعديل صلاحيات الموظف: {user.real_name || user.username}
                </h3>
              </div>
              <p className="text-xs text-slate-500">
                اسم المستخدم: <span className="font-mono text-slate-700">@{user.username}</span> • يمكنك تخصيص أي صلاحية مباشرة لهذا المستخدم
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-slate-200 flex items-center justify-center text-slate-500 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Password update section */}
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 space-y-2">
            <label className="block text-xs font-bold text-slate-700">
              تغيير كلمة المرور (اترك الحقل فارغاً إذا كنت لا ترغب في التغيير)
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="أدخل كلمة مرور جديدة..."
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-hidden pe-10 bg-white"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute end-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Dynamic Role Selection */}
          <div className="space-y-3">
            <label className="block text-xs font-bold text-slate-800">
              1. اختيار الدور الوظيفي الأساسي (يحمل حزمة صلاحيات افتراضية قابلة للتخصيص أدناه):
            </label>
            <select
              value={selectedRoleId}
              onChange={(e) => handleRoleChange(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold focus:ring-2 focus:ring-blue-500 focus:outline-hidden bg-white"
            >
              <option value="">-- اختر دوراً من الأدوار المتاحة --</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} {r.description ? `(${r.description})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Strict hierarchical rank (hidden from rank-3 viewers) */}
          {currentUserRank !== 3 && (
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-800">
                الرتبة الهرمية للمستخدم (تحدد من يرى ويُدير من في النظام):
              </label>
              <select
                value={rankLevel}
                onChange={(e) => setRankLevel(Number(e.target.value))}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold focus:ring-2 focus:ring-purple-500 focus:outline-hidden bg-white"
              >
                {rankOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label} — {opt.description}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                كل رتبة ترى وتدير الرتب الأقل منها فقط، ولا يمكن منح رتبة مساوية أو أعلى من رتبتك.
              </p>
            </div>
          )}

          {/* Direct User Permission Customization (Task 2, 3, 4) */}
          <div className="space-y-5">
            {/* Section Access */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex items-center gap-2 text-xs font-extrabold text-slate-900">
                <Sliders className="w-4 h-4 text-blue-600" />
                <span>2. تخصيص صلاحيات الأقسام لهذا المستخدم:</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {SYSTEM_SECTIONS.map((sec) => {
                  const viewKey = `${sec.key}_view`;
                  const editKey = `${sec.key}_edit`;
                  const hasView = Boolean(customPerms[viewKey]);
                  const hasEdit = Boolean(customPerms[editKey]);

                  return (
                    <div
                      key={sec.key}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-slate-200 text-xs"
                    >
                      <div className="flex items-center gap-1.5 font-bold text-slate-800">
                        <sec.icon className={`w-3.5 h-3.5 ${sec.color}`} />
                        <span>{sec.label}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => togglePermKey(viewKey)}
                          className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition cursor-pointer ${
                            hasView
                              ? 'bg-blue-50 text-blue-700 border-blue-300'
                              : 'bg-slate-50 text-slate-400 border-slate-200'
                          }`}
                        >
                          عرض
                        </button>
                        <button
                          type="button"
                          onClick={() => togglePermKey(editKey)}
                          className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition cursor-pointer ${
                            hasEdit
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                              : 'bg-slate-50 text-slate-400 border-slate-200'
                          }`}
                        >
                          تعديل
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Department Notes Permissions (Task 4) */}
            <div className="p-4 rounded-2xl bg-purple-50/60 border border-purple-200 space-y-3">
              <div className="flex items-center gap-2 text-xs font-extrabold text-purple-950">
                <FileText className="w-4 h-4 text-purple-600" />
                <span>3. صلاحيات كتابة الملاحظات في الأقسام (مستقلة لكل قسم):</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {NOTES_PERMISSIONS_LIST.map((np) => (
                  <label
                    key={np.key}
                    className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white border border-purple-200 cursor-pointer hover:border-purple-400 transition"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(customPerms[np.key])}
                      onChange={() => togglePermKey(np.key)}
                      className="w-4 h-4 text-purple-600 rounded-sm"
                    />
                    <div className="text-start">
                      <span className="font-bold text-xs text-slate-900 block">{np.label}</span>
                      <span className="text-[10px] text-slate-500">{np.description}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Administrative & Global Settings Permissions (Tasks 2 & 3) */}
            <div className="p-4 rounded-2xl bg-indigo-50/60 border border-indigo-200 space-y-3">
              <div className="flex items-center gap-2 text-xs font-extrabold text-indigo-950">
                <Settings className="w-4 h-4 text-indigo-600" />
                <span>4. الصلاحيات الإدارية وإعدادات الموقع العامة (بما فيها إدارة الصلاحيات):</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ADMIN_AND_SETTINGS_PERMISSIONS_LIST.map((ap) => (
                  <label
                    key={ap.key}
                    className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white border border-indigo-200 cursor-pointer hover:border-indigo-400 transition"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(customPerms[ap.key])}
                      onChange={() => togglePermKey(ap.key)}
                      className="w-4 h-4 text-indigo-600 rounded-sm"
                    />
                    <div className="text-start">
                      <span className="font-bold text-xs text-slate-900 block">{ap.label}</span>
                      <span className="text-[10px] text-slate-500">{ap.description}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* HR per-tab permissions */}
            <div className="p-4 rounded-2xl bg-rose-50/60 border border-rose-200 space-y-3">
              <div className="flex items-center gap-2 text-xs font-extrabold text-rose-950">
                <Users className="w-4 h-4 text-rose-600" />
                <span>صلاحيات تبويبات الموارد البشرية (مستقلة لكل تبويب):</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {HR_PERMISSIONS_LIST.map((hp) => {
                  const permKey = HR_SECTION_PERM_MAP[hp.key];
                  return (
                    <label
                      key={hp.key}
                      className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white border border-rose-200 cursor-pointer hover:border-rose-400 transition"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(customPerms[permKey])}
                        onChange={() => togglePermKey(permKey)}
                        className="w-4 h-4 text-rose-600 rounded-sm"
                      />
                      <div className="text-start">
                        <span className="font-bold text-xs text-slate-900 block">{hp.label}</span>
                        <span className="text-[10px] text-slate-500">{hp.description}</span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Financial & Communication Permissions */}
            <div className="p-4 rounded-2xl bg-amber-50/60 border border-amber-200 space-y-3">
              <div className="flex items-center gap-2 text-xs font-extrabold text-amber-950">
                <Coins className="w-4 h-4 text-amber-600" />
                <span>5. الصلاحيات المالية والواتساب والمراسلات:</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { key: 'view_fabric_prices', label: 'رؤية أسعار القماش' },
                  { key: 'edit_fabric_prices', label: 'تعديل أسعار القماش' },
                  { key: 'view_accessory_prices', label: 'رؤية أسعار الإكسسوارات' },
                  { key: 'edit_accessory_prices', label: 'تعديل أسعار الإكسسوارات' },
                  { key: 'view_printing_costs', label: 'رؤية تكاليف المطابع' },
                  { key: 'edit_printing_costs', label: 'تعديل تكاليف المطابع' },
                  { key: 'send_whatsapp_requests', label: 'إرسال طلبات النواقص عبر الواتساب' },
                  { key: 'send_internal_messages', label: 'إرسال الرسائل والمراسلات الداخلية' }
                ].map((fp) => (
                  <label
                    key={fp.key}
                    className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white border border-amber-200 cursor-pointer hover:border-amber-400 transition"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(customPerms[fp.key])}
                      onChange={() => togglePermKey(fp.key)}
                      className="w-4 h-4 text-amber-600 rounded-sm"
                    />
                    <span className="font-bold text-xs text-slate-900">{fp.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Footer Buttons */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-bold transition cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-md transition cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>حفظ وتطبيق الصلاحيات</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
