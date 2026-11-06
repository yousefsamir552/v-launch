import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../context/AppContext';
import { 
  MessageSquare, 
  Send, 
  X, 
  User, 
  ShieldAlert, 
  Search,
  Sparkles
} from 'lucide-react';

interface InternalMessagingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InternalMessagingModal: React.FC<InternalMessagingModalProps> = ({ isOpen, onClose }) => {
  const { 
    currentUser, 
    users, 
    internalMessages, 
    unreadMessagesCount, 
    sendInternalMessage, 
    markMessageRead, 
    canSendMessages,
    globalSettings
  } = useApp();

  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [messageText, setMessageText] = useState('');
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Filter out the current logged-in user AND strictly hide sudo from contact list (Task 2)
  const availableContacts = users.filter(
    (u) => u.id !== currentUser?.id && u.username.toLowerCase() !== 'sudo' && !u.is_sudo
  );

  const filteredContacts = availableContacts.filter((u) => {
    const q = userSearchTerm.toLowerCase();
    return (
      u.real_name.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      (u.role || '').toLowerCase().includes(q)
    );
  });

  // Set default selected user on open
  useEffect(() => {
    if (isOpen && !selectedUserId && availableContacts.length > 0) {
      setSelectedUserId(availableContacts[0].id);
    }
  }, [isOpen, selectedUserId, availableContacts]);

  // Allow Escape key to close the modal smoothly
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Scroll to bottom when conversation changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [internalMessages, selectedUserId]);

  // Automatically mark unread messages from selected user as read
  useEffect(() => {
    if (!selectedUserId || !currentUser) return;
    const unread = internalMessages.filter(
      (m) =>
        m.sender_id === selectedUserId &&
        (m.receiver_id === currentUser.id || m.receiver_id === currentUser.username) &&
        !m.is_read
    );
    unread.forEach((m) => {
      markMessageRead(m.id);
    });
  }, [selectedUserId, internalMessages, currentUser, markMessageRead]);

  if (!isOpen) return null;

  const selectedUser = availableContacts.find((u) => u.id === selectedUserId);

  // Messages between currentUser and selectedUser
  const activeConversation = internalMessages.filter((m) => {
    if (!currentUser || !selectedUser) return false;
    const isSentByMe = m.sender_id === currentUser.id && m.receiver_id === selectedUser.id;
    const isSentToMe =
      m.sender_id === selectedUser.id &&
      (m.receiver_id === currentUser.id || m.receiver_id === currentUser.username);
    return isSentByMe || isSentToMe;
  });

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim() || !selectedUserId) return;

    const res = sendInternalMessage(selectedUserId, messageText);
    if (res.success) {
      setMessageText('');
    }
  };

  const hasPermissionToSend = canSendMessages();
  const readyTemplates = globalSettings?.internal_message_templates || [];

  const modalContent = (
    <div
      className="fixed inset-0 z-[100] bg-slate-900/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="المراسلات والمحادثات الداخلية"
    >
      <div
        className="bg-white rounded-3xl max-w-4xl w-full h-[82vh] max-h-[720px] min-h-[460px] my-auto shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with prominent Close (X) button */}
        <div className="p-4 sm:px-6 border-b border-slate-200 flex items-center justify-between bg-slate-50/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-xs shrink-0">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-base flex items-center gap-2">
                <span>المراسلات والمحادثات الداخلية</span>
                {unreadMessagesCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-500 text-white">
                    {unreadMessagesCount} غير مقروءة
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-500">
                نظام التواصل الداخلي المباشر بين مستخدمي ومسؤولي أقسام المصنع
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق نافذة الرسائل"
            title="إغلاق (Esc)"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white border border-rose-200 hover:border-rose-600 font-bold text-xs cursor-pointer transition-all duration-150 shadow-2xs shrink-0"
          >
            <X className="w-4 h-4" />
            <span>إغلاق</span>
          </button>
        </div>

        {/* Content Body: Two columns (Contacts Sidebar + Chat Area) */}
        <div className="flex-grow flex flex-col md:flex-row overflow-hidden min-h-0">
          {/* Contacts Sidebar */}
          <div className="w-full md:w-80 border-b md:border-b-0 md:border-e border-slate-200 flex flex-col bg-slate-50/50 shrink-0 max-h-48 md:max-h-none">
            {/* Search Box */}
            <div className="p-3 border-b border-slate-200 bg-white shrink-0">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="بحث عن مستخدم أو مسؤول..."
                  value={userSearchTerm}
                  onChange={(e) => setUserSearchTerm(e.target.value)}
                  className="w-full ps-8 pe-3 py-1.5 bg-slate-100 rounded-full text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            </div>

            {/* Users List */}
            <div className="overflow-y-auto flex-grow p-2 space-y-1">
              {filteredContacts.length > 0 ? (
                filteredContacts.map((contact) => {
                  const isSelected = contact.id === selectedUserId;
                  const contactUnread = internalMessages.filter(
                    (m) =>
                      m.sender_id === contact.id &&
                      (m.receiver_id === currentUser?.id || m.receiver_id === currentUser?.username) &&
                      !m.is_read
                  ).length;

                  const lastMsg = internalMessages
                    .filter(
                      (m) =>
                        (m.sender_id === contact.id && m.receiver_id === currentUser?.id) ||
                        (m.sender_id === currentUser?.id && m.receiver_id === contact.id)
                    )
                    .slice(-1)[0];

                  return (
                    <button
                      key={contact.id}
                      type="button"
                      onClick={() => setSelectedUserId(contact.id)}
                      className={`w-full text-start p-2.5 rounded-2xl transition flex items-center justify-between cursor-pointer border ${
                        isSelected
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                          : 'bg-white hover:bg-slate-100/80 text-slate-800 border-slate-200/70'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                            isSelected
                              ? 'bg-white/20 text-white'
                              : 'bg-indigo-50 text-indigo-700'
                          }`}
                        >
                          <User className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-extrabold text-xs truncate">
                            {contact.real_name}
                          </h4>
                          <p
                            className={`text-[10px] truncate ${
                              isSelected ? 'text-indigo-200' : 'text-slate-400'
                            }`}
                          >
                            {lastMsg ? lastMsg.content : contact.role || 'مستخدم'}
                          </p>
                        </div>
                      </div>

                      {contactUnread > 0 && (
                        <span className="min-w-[18px] h-[18px] px-1 bg-rose-600 text-white rounded-full text-[10px] font-black flex items-center justify-center shadow-xs shrink-0">
                          {contactUnread}
                        </span>
                      )}
                    </button>
                  );
                })
              ) : (
                <p className="text-slate-400 text-xs text-center py-6">
                  لا يوجد مستخدمون يطابقون البحث.
                </p>
              )}
            </div>
          </div>

          {/* Chat Area */}
          <div className="flex-grow flex flex-col bg-white overflow-hidden min-h-0">
            {selectedUser ? (
              <>
                {/* Chat Top Banner */}
                <div className="p-3.5 px-5 border-b border-slate-200 flex items-center justify-between bg-white shrink-0">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center font-black text-xs">
                      {selectedUser.real_name.charAt(0)}
                    </div>
                    <div>
                      <h4 className="font-black text-slate-900 text-xs sm:text-sm">
                        {selectedUser.real_name}
                      </h4>
                      <p className="text-[10px] text-slate-500 font-semibold">
                        الدور: {selectedUser.role || 'مسؤول'} • اسم المستخدم: @{selectedUser.username}
                      </p>
                    </div>
                  </div>

                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    نشط في النظام
                  </span>
                </div>

                {/* Conversation History */}
                <div className="flex-grow overflow-y-auto p-4 space-y-3 bg-slate-50/40 min-h-0">
                  {activeConversation.length > 0 ? (
                    activeConversation.map((msg) => {
                      const isMe = msg.sender_id === currentUser?.id;

                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col ${isMe ? 'items-start' : 'items-end'}`}
                        >
                          <div className="text-[10px] font-bold text-slate-400 mb-0.5 px-1">
                            {isMe ? 'أنت' : msg.sender_name} • {msg.created_at}
                          </div>
                          <div
                            className={`max-w-[78%] px-4 py-2.5 rounded-2xl text-xs font-semibold leading-relaxed shadow-xs whitespace-pre-wrap ${
                              isMe
                                ? 'bg-indigo-600 text-white rounded-br-xs'
                                : 'bg-white text-slate-800 border border-slate-200 rounded-bl-xs'
                            }`}
                          >
                            {msg.content}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
                      <MessageSquare className="w-12 h-12 text-slate-300 mb-2 stroke-1" />
                      <p className="text-xs font-bold text-slate-600">
                        لا توجد رسائل سابقة مع {selectedUser.real_name}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        اكتب رسالة في الأسفل لبدء المحادثة الفورية وتنسيق العمليات التشغيلية.
                      </p>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Ready-made message templates bar (Task 3 integration) */}
                {hasPermissionToSend && readyTemplates.length > 0 && (
                  <div className="px-3 py-2 bg-slate-50 border-t border-slate-100 flex items-center gap-1.5 overflow-x-auto shrink-0">
                    <span className="text-[10px] font-bold text-slate-500 flex items-center gap-1 shrink-0">
                      <Sparkles className="w-3 h-3 text-indigo-500" />
                      <span>رسائل جاهزة:</span>
                    </span>
                    {readyTemplates.map((tpl, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setMessageText(tpl)}
                        className="px-2.5 py-1 rounded-full bg-white hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200 text-[10px] font-semibold whitespace-nowrap transition cursor-pointer shrink-0"
                      >
                        {tpl.length > 42 ? tpl.slice(0, 42) + '...' : tpl}
                      </button>
                    ))}
                  </div>
                )}

                {/* Bottom Input or Permission Denied Message */}
                <div className="p-3 border-t border-slate-200 bg-white shrink-0">
                  {hasPermissionToSend ? (
                    <form onSubmit={handleSend} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder={`اكتب رسالتك إلى ${selectedUser.real_name}... (اضغط Enter للإرسال)`}
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        className="flex-grow px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-full text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:bg-white transition"
                      />
                      <button
                        type="submit"
                        disabled={!messageText.trim()}
                        className="px-5 py-2.5 rounded-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black text-xs shadow-xs transition flex items-center gap-1.5 cursor-pointer shrink-0"
                      >
                        <Send className="w-3.5 h-3.5 rtl:-scale-x-100" />
                        <span>إرسال</span>
                      </button>
                    </form>
                  ) : (
                    <div className="flex items-center gap-2 p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs">
                      <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
                      <div>
                        <strong className="block font-black">
                          خاصية إرسال الرسائل مقيدة بالصلاحيات
                        </strong>
                        <span className="text-[11px] text-amber-700">
                          حسابك الحالي لا يمتلك صلاحية (إرسال الرسائل والمراسلات الداخلية). يمكنك الاطلاع على الرسائل فقط، ويرجى مراجعة مسؤول الصلاحيات لتفعيل الإرسال.
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                يرجى اختيار مستخدم من القائمة لبدء المحادثة.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }
  return modalContent;
};
