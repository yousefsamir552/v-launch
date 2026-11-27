import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Phone,
  Save,
  Shield,
  Trash2,
  User as UserIcon,
  X
} from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { useModalBackHandler } from '../utils/mobileBackNav';

interface MyProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MyProfileModal: React.FC<MyProfileModalProps> = ({ isOpen, onClose }) => {
  const { currentUser, setCurrentUser, addFlashMessage } = useApp();

  const [realName, setRealName] = useState('');
  const [phone, setPhone] = useState('');
  const [avatar, setAvatar] = useState('');
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useModalBackHandler(isOpen, onClose);

  useEffect(() => {
    if (!isOpen || !currentUser) return;
    setRealName(currentUser.real_name || '');
    setPhone(currentUser.phone || '');
    setAvatar(currentUser.avatar || '');
    setShowPasswordSection(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowCurrentPwd(false);
    setShowNewPwd(false);
    setErrorMsg('');
  }, [isOpen, currentUser]);

  if (!isOpen || !currentUser) return null;

  const isSudo =
    currentUser.username?.toLowerCase() === 'sudo' || Boolean(currentUser.is_sudo);
  const roleDisplay = isSudo ? 'مدير النظام' : currentUser.role || 'موظف تشغيل';
  const initialLetter = (realName || currentUser.real_name || currentUser.username || 'U')
    .trim()
    .charAt(0)
    .toUpperCase();

  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMsg('يرجى اختيار ملف صورة صالح (JPG / PNG / WEBP).');
      return;
    }
    setErrorMsg('');
    setUploadingAvatar(true);
    try {
      const uploaded = await api.uploadImage(file, 'avatars');
      setAvatar(uploaded.url);
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر رفع الصورة الشخصية. يرجى المحاولة مرة أخرى.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || uploadingAvatar) return;

    const trimmedName = realName.trim();
    if (!trimmedName) {
      setErrorMsg('الاسم الكامل مطلوب.');
      return;
    }

    const wantsPasswordChange =
      showPasswordSection && (currentPassword || newPassword || confirmPassword);

    if (wantsPasswordChange) {
      if (!currentPassword) {
        setErrorMsg('يرجى إدخال كلمة المرور الحالية.');
        return;
      }
      if (!newPassword) {
        setErrorMsg('يرجى إدخال كلمة المرور الجديدة.');
        return;
      }
      if (newPassword.length < 4) {
        setErrorMsg('كلمة المرور الجديدة يجب أن تكون 4 أحرف على الأقل.');
        return;
      }
      if (newPassword !== confirmPassword) {
        setErrorMsg('كلمتا المرور الجديدة وتأكيدها غير متطابقتين.');
        return;
      }
    }

    setErrorMsg('');
    setSaving(true);
    try {
      const payload: {
        real_name: string;
        phone: string;
        avatar: string;
        current_password?: string;
        new_password?: string;
      } = {
        real_name: trimmedName,
        phone: phone.trim(),
        avatar: avatar.trim()
      };
      if (wantsPasswordChange) {
        payload.current_password = currentPassword;
        payload.new_password = newPassword;
      }

      const res = await api.updateMyProfile(payload);
      if (res?.user) {
        setCurrentUser(res.user);
      }
      addFlashMessage('تم تحديث بيانات حسابك الشخصي بنجاح', 'success');
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر حفظ التعديلات. يرجى المحاولة مرة أخرى.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-[95vw] sm:w-full max-w-md max-h-[92vh] flex flex-col overflow-hidden rounded-3xl bg-white shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/80 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <UserIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-base text-slate-900 leading-tight">حسابي الشخصي</h3>
              <p className="text-[11px] text-slate-500">
                تحديث الصورة الشخصية والبيانات وكلمة المرور
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:text-slate-700 hover:bg-slate-200 flex items-center justify-center transition cursor-pointer"
            title="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col">
          <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
            {errorMsg && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-bold text-rose-700">
                {errorMsg}
              </div>
            )}

            {/* Avatar Upload & Preview */}
            <div className="flex flex-col items-center gap-3 pb-3 border-b border-slate-100">
              <div className="relative">
                {avatar ? (
                  <img
                    src={avatar}
                    alt={realName || currentUser.username}
                    className="w-24 h-24 rounded-full object-cover border-4 border-blue-100 shadow-md bg-white"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-blue-600 text-white flex items-center justify-center text-3xl font-black border-4 border-blue-100 shadow-md">
                    {initialLetter}
                  </div>
                )}
                <button
                  type="button"
                  disabled={uploadingAvatar}
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute bottom-0 start-0 w-8 h-8 rounded-full bg-slate-900 hover:bg-blue-700 text-white flex items-center justify-center shadow-md border-2 border-white transition cursor-pointer disabled:opacity-60"
                  title="تغيير الصورة الشخصية"
                >
                  {uploadingAvatar ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Camera className="w-4 h-4" />
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarFileChange}
                  className="hidden"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={uploadingAvatar}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-bold transition cursor-pointer disabled:opacity-60"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>{uploadingAvatar ? 'جارٍ الرفع...' : avatar ? 'تغيير الصورة' : 'رفع صورة شخصية'}</span>
                </button>
                {avatar && (
                  <button
                    type="button"
                    disabled={uploadingAvatar}
                    onClick={() => setAvatar('')}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>إزالة الصورة</span>
                  </button>
                )}
              </div>
            </div>

            {/* Read-only identity info */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-2xl bg-slate-50 border border-slate-200 px-3 py-2.5">
                <span className="block text-[10px] font-bold text-slate-400">اسم المستخدم</span>
                <span className="text-xs font-black text-slate-800 font-mono truncate block mt-0.5">
                  @{currentUser.username}
                </span>
              </div>
              <div className="rounded-2xl bg-slate-50 border border-slate-200 px-3 py-2.5">
                <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400">
                  <Shield className="w-3 h-3 text-blue-500" />
                  الدور الوظيفي
                </span>
                <span className="text-xs font-black text-slate-800 truncate block mt-0.5">
                  {roleDisplay}
                </span>
              </div>
            </div>

            {/* Editable Fields */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  الاسم الكامل *
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={realName}
                    onChange={(e) => setRealName(e.target.value)}
                    placeholder="اكتب اسمك الكامل"
                    className="w-full ps-9 pe-3 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  رقم الهاتف
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="مثال: 010xxxxxxxx"
                    className="w-full ps-9 pe-3 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-800 font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-hidden"
                  />
                </div>
              </div>
            </div>

            {/* Optional Password Change Section */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 space-y-3">
              <button
                type="button"
                onClick={() => {
                  setShowPasswordSection((prev) => !prev);
                  setCurrentPassword('');
                  setNewPassword('');
                  setConfirmPassword('');
                }}
                className="w-full flex items-center justify-between text-xs font-black text-slate-800 cursor-pointer"
              >
                <span className="inline-flex items-center gap-1.5">
                  <KeyRound className="w-4 h-4 text-amber-600" />
                  <span>تغيير كلمة المرور (اختياري)</span>
                </span>
                <span className="text-[11px] font-bold text-blue-600">
                  {showPasswordSection ? 'إلغاء' : 'تعديل'}
                </span>
              </button>

              {showPasswordSection && (
                <div className="space-y-2.5 pt-2 border-t border-slate-200/80">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      كلمة المرور الحالية *
                    </label>
                    <div className="relative">
                      <input
                        type={showCurrentPwd ? 'text' : 'password'}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="أدخل كلمة المرور الحالية"
                        className="w-full ps-3 pe-9 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-hidden"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrentPwd((v) => !v)}
                        className="absolute end-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        {showCurrentPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      كلمة المرور الجديدة *
                    </label>
                    <div className="relative">
                      <input
                        type={showNewPwd ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="4 أحرف على الأقل"
                        className="w-full ps-3 pe-9 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-hidden"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPwd((v) => !v)}
                        className="absolute end-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        {showNewPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      تأكيد كلمة المرور الجديدة *
                    </label>
                    <input
                      type={showNewPwd ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="أعد كتابة كلمة المرور الجديدة"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-hidden"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/70 flex items-center justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-full text-xs font-bold text-slate-600 hover:bg-slate-200/70 transition cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={saving || uploadingAvatar}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-black shadow-md shadow-blue-600/20 transition cursor-pointer disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>{saving ? 'جارٍ الحفظ...' : 'حفظ التغييرات'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
