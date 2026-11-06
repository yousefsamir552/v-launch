import React from 'react';
import { useApp } from '../context/AppContext';
import { X, CheckCircle, AlertTriangle, AlertCircle, Info } from 'lucide-react';

export const FlashAlerts: React.FC = () => {
  const { flashMessages, removeFlashMessage } = useApp();

  if (flashMessages.length === 0) return null;

  return (
    <div className="fixed top-20 start-6 z-50 flex flex-col gap-2 max-w-md w-full pointer-events-none">
      {flashMessages.map((msg) => {
        let bg = 'bg-emerald-50 border-emerald-300 text-emerald-900';
        let icon = <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />;

        if (msg.type === 'danger') {
          bg = 'bg-rose-50 border-rose-300 text-rose-900';
          icon = <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />;
        } else if (msg.type === 'warning') {
          bg = 'bg-amber-50 border-amber-300 text-amber-900';
          icon = <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />;
        } else if (msg.type === 'info') {
          bg = 'bg-blue-50 border-blue-300 text-blue-900';
          icon = <Info className="w-5 h-5 text-blue-600 shrink-0" />;
        }

        return (
          <div
            key={msg.id}
            className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border shadow-lg transition-all transform duration-200 animate-in fade-in slide-in-from-top-2 ${bg}`}
          >
            <div className="flex items-center gap-2">
              {icon}
              <span className="font-semibold text-sm leading-relaxed">{msg.text}</span>
            </div>
            <button
              onClick={() => removeFlashMessage(msg.id)}
              className="p-1 rounded-full hover:bg-black/5 text-current opacity-70 hover:opacity-100 transition"
              title="إغلاق"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
