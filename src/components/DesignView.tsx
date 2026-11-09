import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Palette,
  Search,
  Plus,
  ChevronRight,
  ChevronLeft,
  X,
  Upload,
  Image as ImageIcon,
  FileText,
  Lock,
  Layers
} from 'lucide-react';

import {
  GarmentComposition,
  GARMENT_COMPOSITION_ORDER,
  GARMENT_COMPOSITION_LABELS,
  DEFAULT_GARMENT_COMPOSITION
} from '../types';

interface DesignViewProps {
  onOpenModelDetails: (modelId: string) => void;
}

export const DesignView: React.FC<DesignViewProps> = ({ onOpenModelDetails }) => {
  const { models, sizeDefs, addDesignModel, hasPermission, canAddDesignNotes } = useApp();
  const canEdit = hasPermission('design', true);
  const canWriteNotes = canAddDesignNotes();

  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  // Add Model Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [modelCode, setModelCode] = useState('');
  const [modelType, setModelType] = useState('أولادي');
  const [sizeCategoryId, setSizeCategoryId] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [targetCutQuantity, setTargetCutQuantity] = useState<number>(500);
  const [designNotes, setDesignNotes] = useState('');
  const [garmentComposition, setGarmentComposition] = useState<GarmentComposition>(
    DEFAULT_GARMENT_COMPOSITION
  );

  // Filter models (Only display models in design stage)
  const filteredModels = models
    .filter((m) => !m.is_deleted && (m.status === 'مرحلة التصميم' || m.status === 'تصميم'))
    .filter((m) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        m.model_code.toLowerCase().includes(q) ||
        (m.model_type && m.model_type.toLowerCase().includes(q))
      );
    });

  const totalPages = Math.ceil(filteredModels.length / itemsPerPage) || 1;
  const paginatedModels = filteredModels.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
        setImageUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!modelCode.trim()) return;

    const res = addDesignModel({
      modelCode: modelCode.trim(),
      modelType,
      sizeCategoryId: sizeCategoryId || undefined,
      imageUrl: imageUrl || undefined,
      targetCutQuantity: Number(targetCutQuantity) || 500,
      designNotes: canWriteNotes ? designNotes.trim() : '',
      garmentComposition
    });

    if (res.success) {
      setShowAddModal(false);
      setModelCode('');
      setModelType('أولادي');
      setSizeCategoryId('');
      setImageUrl('');
      setImagePreview(null);
      setDesignNotes('');
      setGarmentComposition(DEFAULT_GARMENT_COMPOSITION);
      if (res.modelId) {
        onOpenModelDetails(res.modelId);
      }
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'تصميم':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'في القص':
        return 'bg-rose-100 text-rose-800 border-rose-300';
      case 'فرز وكنترول':
        return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'جاهز للطباعة / التجميع':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <span>🎨 قسم التصميم والموديلات</span>
          </h2>
          <p className="text-slate-500 text-sm mt-0.5">إدارة الموديلات الجديدة وتجهيزها للقص</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {canEdit && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-md transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ إضافة موديل جديد</span>
            </button>
          )}
        </div>
      </div>

      {/* Search Input */}
      <div className="flex items-center gap-2 max-w-xl">
        <div className="relative flex-grow">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="ابحث بكود الموديل أو النوع..."
            className="w-full px-5 py-2.5 rounded-full border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:outline-hidden pe-10 shadow-xs"
          />
          <Search className="w-4 h-4 text-slate-400 absolute end-4 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="px-4 py-2.5 rounded-full border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 text-xs font-bold transition shadow-xs"
          >
            إلغاء
          </button>
        )}
      </div>

      {/* Models Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {paginatedModels.length > 0 ? (
          paginatedModels.map((model) => (
            <div
              key={model.id}
              className="bg-white rounded-3xl border border-slate-200/80 shadow-xs hover:shadow-lg transition-all duration-200 overflow-hidden flex flex-col justify-between group"
            >
              {/* Model Image */}
              <div className="h-60 w-full overflow-hidden bg-slate-100 relative">
                {model.image ? (
                  <img
                    src={model.image}
                    alt={model.model_code}
                    className="w-full h-full object-contain bg-white group-hover:scale-105 transition-transform duration-300"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src =
                        'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500&auto=format&fit=crop&q=60';
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-slate-400">
                    <ImageIcon className="w-10 h-10 mb-1 stroke-1" />
                    <span className="text-xs">بدون صورة</span>
                  </div>
                )}
                <div className="absolute top-3 end-3">
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-white/90 backdrop-blur-xs text-slate-800 shadow-xs">
                    {model.model_type || 'أولادي'}
                  </span>
                </div>
              </div>

              {/* Card Body */}
              <div className="p-5 text-center flex flex-col justify-between flex-grow">
                <div>
                  <h3 className="text-xl font-extrabold text-slate-900 mb-2">{model.model_code}</h3>
                  <div className="mb-3">
                    <span
                      className={`inline-block px-3.5 py-1 rounded-full text-xs font-extrabold border ${getStatusBadge(
                        model.status
                      )}`}
                    >
                      {model.status}
                    </span>
                  </div>
                  {(model.design_notes || model.notes_shirt || model.notes_pants) && (
                    <p className="text-[11px] text-slate-500 line-clamp-1 mb-3 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-100">
                      📝 {model.design_notes || model.notes_shirt || model.notes_pants}
                    </p>
                  )}
                </div>

                <button
                  onClick={() => onOpenModelDetails(model.id)}
                  className="w-full py-2.5 px-4 rounded-full border border-slate-900 text-slate-900 hover:bg-slate-900 hover:text-white font-bold text-xs transition shadow-xs cursor-pointer"
                >
                  التفاصيل والتلوين
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-full py-16 text-center bg-white rounded-3xl border border-slate-200/80 p-8 text-slate-400">
            <Palette className="w-12 h-12 mx-auto mb-2 text-slate-300" />
            <p className="font-bold text-slate-600 text-base">لا توجد موديلات مسجلة حالياً.</p>
            <p className="text-xs text-slate-400 mt-1">
              {searchQuery ? 'جرب البحث بكلمة أخرى أو إلغاء فلتر البحث.' : 'اضغط على "+ إضافة موديل جديد" للبدء.'}
            </p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <button
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            className="flex items-center gap-1 px-4 py-2 rounded-full border border-slate-300 bg-white text-slate-700 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition"
          >
            <ChevronRight className="w-4 h-4" />
            <span>السابق</span>
          </button>

          <span className="text-xs font-extrabold text-slate-800 px-4">
            صفحة {currentPage} من {totalPages}
          </span>

          <button
            disabled={currentPage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            className="flex items-center gap-1 px-4 py-2 rounded-full border border-slate-300 bg-white text-slate-700 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition"
          >
            <span>التالي</span>
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Add Model Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150 my-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="font-extrabold text-lg text-slate-900">إضافة موديل جديد</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  كود الموديل *
                </label>
                <input
                  type="text"
                  required
                  value={modelCode}
                  onChange={(e) => setModelCode(e.target.value)}
                  placeholder="كود الموديل (مثال: M-101)"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-slate-900 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  صورة الموديل
                </label>
                <div className="border-2 border-dashed border-slate-300 rounded-2xl p-4 text-center hover:bg-slate-50 transition cursor-pointer relative">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  {imagePreview ? (
                    <img
                      src={imagePreview}
                      alt="Preview"
                      className="w-24 h-24 object-contain bg-white mx-auto rounded-xl border p-1"
                    />
                  ) : (
                    <div className="flex flex-col items-center">
                      <Upload className="w-6 h-6 text-slate-400 mb-1" />
                      <span className="text-xs font-bold text-slate-600">
                        اضغط لرفع صورة الموديل من جهازك
                      </span>
                      <span className="text-[10px] text-slate-400 mt-0.5">PNG, JPG حتى 5 ميجابايت</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">النوع</label>
                  <select
                    value={modelType}
                    onChange={(e) => setModelType(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-slate-900 focus:outline-hidden"
                  >
                    <option value="أولادي">أولادي</option>
                    <option value="بناتي">بناتي</option>
                    <option value="رجالي">رجالي</option>
                    <option value="حريمي">حريمي</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    العدد المستهدف للقص *
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={targetCutQuantity}
                    onChange={(e) => setTargetCutQuantity(Number(e.target.value) || 0)}
                    placeholder="مثال: 500"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-blue-600" />
                  <span>تكوين قطع الموديل *</span>
                </label>
                <p className="text-[10px] text-slate-500 mb-2">
                  يحدد هذا الاختيار القطع التي ستظهر في أقسام التصميم والقص والفرز (تيشيرت / بنطلون / جاكيت).
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {GARMENT_COMPOSITION_ORDER.map((comp) => {
                    const active = garmentComposition === comp;
                    return (
                      <button
                        key={comp}
                        type="button"
                        onClick={() => setGarmentComposition(comp)}
                        className={`px-3 py-2.5 rounded-xl border text-xs font-bold transition text-right cursor-pointer ${
                          active
                            ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                            : 'bg-white text-slate-700 border-slate-300 hover:border-slate-500'
                        }`}
                      >
                        {GARMENT_COMPOSITION_LABELS[comp]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  فئة المقاسات المتاحة للموديل *
                </label>
                <select
                  required
                  value={sizeCategoryId}
                  onChange={(e) => setSizeCategoryId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-slate-900 focus:outline-hidden"
                >
                  <option value="">-- اختر فئة المقاسات (بيبي، وسط..) --</option>
                  {sizeDefs.map((sc) => (
                    <option key={sc.id} value={sc.id}>
                      {sc.name} ({sc.values})
                    </option>
                  ))}
                </select>
              </div>

              {/* Optional Design Notes Field gated by canAddDesignNotes() (Task 4) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-amber-600" />
                    <span>ملاحظات قسم التصميم (اختياري)</span>
                  </label>
                  {!canWriteNotes && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                      <Lock className="w-3 h-3" />
                      يتطلب صلاحية ملاحظات التصميم
                    </span>
                  )}
                </div>
                <textarea
                  rows={2}
                  disabled={!canWriteNotes}
                  value={designNotes}
                  onChange={(e) => setDesignNotes(e.target.value)}
                  placeholder={
                    canWriteNotes
                      ? 'أدخل أي ملاحظات فنية أو توجيهات خاصة بتصميم الموديل (اختياري)...'
                      : 'ليس لديك صلاحية كتابة ملاحظات التصميم'
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-slate-900 focus:outline-hidden disabled:bg-slate-100 disabled:text-slate-400"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-3 rounded-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm transition shadow-lg cursor-pointer"
                >
                  حفظ الموديل
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
