import React from 'react';
import { useApp } from '../context/AppContext';
import { ShieldCheck, ArrowRight, Clock, User, Globe } from 'lucide-react';

interface AuditLogsViewProps {
  onBack: () => void;
}

export const AuditLogsView: React.FC<AuditLogsViewProps> = ({ onBack }) => {
  const { auditLogs } = useApp();

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-emerald-600" />
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">
            🕵️ سجل المراقبة وتتبع العمليات (Audit Logs)
          </h2>
        </div>

        <button
          onClick={onBack}
          className="flex items-center gap-2 px-5 py-2 rounded-full border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs shadow-xs transition"
        >
          <ArrowRight className="w-4 h-4" />
          <span>← العودة للإعدادات</span>
        </button>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-center">
            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
              <tr>
                <th className="px-6 py-3.5 text-center">التاريخ والوقت</th>
                <th className="px-6 py-3.5 text-start">المستخدم</th>
                <th className="px-6 py-3.5 text-center">القسم / الإجراء</th>
                <th className="px-6 py-3.5 text-start">التفاصيل والبيانات</th>
                <th className="px-6 py-3.5 text-center">IP Address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {auditLogs.length > 0 ? (
                auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70 transition">
                    <td dir="ltr" className="px-6 py-3.5 text-slate-500 font-mono text-center">
                      {log.timestamp}
                    </td>
                    <td className="px-6 py-3.5 font-bold text-slate-900 text-start">
                      {log.userName}
                    </td>
                    <td className="px-6 py-3.5 text-center">
                      <span className="px-3 py-1 rounded-full bg-slate-900 text-white font-bold text-[11px]">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-slate-700 text-start font-medium max-w-md">
                      {log.details}
                    </td>
                    <td dir="ltr" className="px-6 py-3.5 text-slate-400 font-mono text-center">
                      {log.ip_address}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-slate-400">
                    لا توجد سجلات مراقبة مسجلة حتى الآن.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
