import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Lock, User, Loader2 } from 'lucide-react';

interface LoginModalProps {
  onSuccess: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ onSuccess }) => {
  const { login } = useApp();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const cleanUser = username.trim();

    if (!cleanUser || !password) {
      setError('يرجى إدخال اسم المستخدم وكلمة المرور');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await login(cleanUser, password);
      if (!result.success) {
        setError(result.message || 'اسم المستخدم أو كلمة المرور غير صحيحة');
        return;
      }
      onSuccess();
    } catch (err: any) {
      setError(err?.message || 'تعذر الاتصال بخادم الباك إند، يرجى التأكد من تشغيل السيرفر');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-slate-100 text-center animate-in fade-in zoom-in-95 duration-200">
        <div className="w-16 h-16 rounded-3xl bg-slate-900 text-white flex items-center justify-center mx-auto mb-4 text-3xl shadow-lg">
          🏭
        </div>

        <h2 className="text-2xl font-black text-slate-900 tracking-tight mb-1">
          تسجيل الدخول
        </h2>
        <p className="text-slate-500 text-xs mb-6">نظام إدارة مصنع الملابس الجاهزة المتكامل</p>

        {error && (
          <div className="mb-4 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="relative">
            <input
              type="text"
              required
              disabled={isSubmitting}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="اسم المستخدم"
              className="w-full px-4 py-3 rounded-2xl border border-slate-300 text-sm focus:ring-2 focus:ring-slate-900 focus:outline-hidden pe-10 disabled:opacity-60"
            />
            <User className="w-4 h-4 text-slate-400 absolute end-3.5 top-1/2 -translate-y-1/2" />
          </div>

          <div className="relative">
            <input
              type="password"
              required
              disabled={isSubmitting}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="كلمة المرور"
              className="w-full px-4 py-3 rounded-2xl border border-slate-300 text-sm focus:ring-2 focus:ring-slate-900 focus:outline-hidden pe-10 disabled:opacity-60"
            />
            <Lock className="w-4 h-4 text-slate-400 absolute end-3.5 top-1/2 -translate-y-1/2" />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3.5 rounded-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-600 text-white font-extrabold text-sm transition shadow-lg cursor-pointer flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>جاري التحقق من الحساب...</span>
              </>
            ) : (
              <span>دخول للنظام</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};