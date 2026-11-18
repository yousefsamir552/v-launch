import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api/client';
import { X, Upload, Layers, FileText, Lock, Image as ImageIcon } from 'lucide-react';
import {
  DesignModel,
  GarmentComposition,
  GARMENT_COMPOSITION_ORDER,
  GARMENT_COMPOSITION_LABELS,
  DEFAULT_GARMENT_COMPOSITION
} from '../types';

interface EditModelModalProps {
  model: DesignModel;
  onClose: () => void;
}

/**
 * نافذة تعديل البيانات الأساسية للموديل من قسم التصميم.
 * تتيح تغيير الصورة والكود والنوع وفئة المقاسات وتكوين القطع والعدد المستهدف
 * وملاحظات التصميم، ثم تحفظها عبر `updateDesignModelBasicInfo`.
 */
export const EditModelModal: React.FC<EditModelModalProps> = ({ model, onClose }) => {
  const { sizeDefs, updateDesignModelBasicInfo, canAddDesignNotes } = useApp();
  const canWriteNotes = canAddDesignNotes();

  const [modelCode, setModelCode] = useState(model.model_code || '');
  const [modelType, setModelType] = useState(model.model_type || 'أولادي');
  const [sizeCategoryId, setSizeCategoryId] = useState(model.size_category_id || '');
  const [imageUrl, setImageUrl] = useState(model.image || '');
  const [imagePreview, setImagePreview] = useState<string | null>(model.image || null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageError, setImageError] = useState('');
  const [targetCutQuantity, setTargetCutQuantity] = useState<number>(
    model.target_cut_quantity || 500
  );
  const [designNotes, setDesignNotes] = useState(model.design_notes || '');
  const [garmentComposition, setGarmentComposition] = useState<GarmentComposition>(
    (model.garment_composition as GarmentComposition) || DEFAULT_GARMENT_COMPOSITION
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // اسمح بإعادة اختيار نفس الملف مرة أخرى.
    e.target.value = '';
    if (!file) return;

    setImageError('');
    setUploadingImage(true);
    try {
      const uploaded = await api.uploadImage(file, 'models');
      setImageUrl(uploaded.url);
      setImagePreview(uploaded.url);
    } catch (err: any) {
      // لا نمسح الصورة الحالية عند فشل الرفع.
      setImageError(err?.message || 'فشل رفع صورة الموديل. يرجى المحاولة مرة أخرى.');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || uploadingImage) return;

    if (!modelCode.trim()) {
      setFormError('كود الموديل مطلوب ولا يمكن أن يكون فارغاً.');
      return;
    }
    if (!targetCutQuantity || targetCutQuantity < 1) {
      setFormError('العدد المستهدف للقص يجب أن يكون 1 على الأقل.');
      return;
    }

    setFormError('');
    setSaving(true);
    try {
      const updates: Parameters<typeof updateDesignModelBasicInfo>[1] = {
        model_code: modelCode.trim(),
        model_type: modelType,
        size_category_id: sizeCategoryId,
        garment_composition: garmentComposition,
        target_cut_quantity: Math.max(1, Number(targetCutQuantity) || 1),
        design_notes: designNotes
      };
      // لا نرسل الصورة إلا إذا تم تغييرها فعلاً (لتجنّب حفظ الصورة الافتراضية).
      if (imageUrl !== (model.image || '')) {
        updates.image = imageUrl || '';
      }

      const res = await updateDesignModelBasicInfo(model.id, updates);
      if (res.success) {
        onClose();
      } else {
        setFormError(res.message || 'فشل تحديث بيانات الموديل');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150 my-auto">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div>
            <h3 className="font-extrabold text-lg text-slate-900">✏️ تعديل بيانات الموديل</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              الموديل الحالي: <span className="font-bold text-slate-700">{model.model_code}</span>
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {/* 1) صورة الموديل */}
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">صورة الموديل</label>
            <div className="border-2 border-dashed border-slate-300 rounded-2xl p-4 text-center hover:bg-slate-50 transition cursor-pointer relative">
              <input
                type="file"
                accept="image/*"
                disabled={saving || uploadingImage}
                onChange={handleImageFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
              />
              {uploadingImage ? (
                <div className="flex flex-col items-center">
                  <span className="text-xs font-bold text-slate-600">جارٍ رفع الصورة...</span>
                </div>
              ) : imagePreview ? (
                <div className="flex flex-col items-center gap-1">
                  <img
                    src={imagePreview}
                    alt={model.model_code}
                    className="w-28 h-28 object-contain bg-white mx-auto rounded-xl border p-1"
                  />
                  <span className="text-[10px] font-bold text-slate-500">
                    اضغط لتغيير الصورة الحالية
                  </span>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <ImageIcon className="w-7 h-7 text-slate-400 mb-1" />
                  <Upload className="w-5 h-5 text-slate-400 mb-1" />
                  <span className="text-xs font-bold text-slate-600">
                    اضغط لرفع صورة الموديل من جهازك
                  </span>
                  <span className="text-[10px] text-slate-400 mt-0.5">PNG, JPG حتى 10 ميجابايت</span>
                </div>
              )}
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              {imageError ? (
                <p className="text-[10px] font-bold text-rose-600">{imageError}</p>
              ) : (
                <span />
              )}
              {imagePreview && (
                <button
                  type="button"
                  disabled={saving || uploadingImage}
                  onClick={() => {
                    setImageUrl('');
                    setImagePreview(null);
                  }}
                  className="text-[10px] font-bold text-rose-600 hover:underline cursor-pointer disabled:opacity-40"
                >
                  إزالة الصورة
                </button>
              )}
            </div>
          </div>

          {/* 2) كود الموديل */}
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">كود الموديل *</label>
            <input
              type="text"
              required
              dir="ltr"
              maxLength={100}
              disabled={saving}
              value={modelCode}
              onChange={(e) => setModelCode(e.target.value.toUpperCase())}
              placeholder="مثال: M-101"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-bold text-left focus:ring-2 focus:ring-slate-900 focus:outline-hidden disabled:bg-slate-100"
            />
          </div>

          {/* 3) نوع الموديل + العدد المستهدف */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">نوع الموديل</label>
              <select
                value={modelType}
                disabled={saving}
                onChange={(e) => setModelType(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-slate-900 focus:outline-hidden disabled:bg-slate-100"
              >
                <option value="أولادي">أولادي</option>
                <option value="بناتي">بناتي</option>
                <option value="رجالي">رجالي</option>
                <option value="حريمي">حريمي</option>
                {modelType &&
                  !['أولادي', 'بناتي', 'رجالي', 'حريمي'].includes(modelType) && (
                    <option value={modelType}>{modelType}</option>
                  )}
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
                disabled={saving}
                value={targetCutQuantity}
                onChange={(e) => setTargetCutQuantity(Number(e.target.value) || 0)}
                placeholder="مثال: 500"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 focus:outline-hidden disabled:bg-slate-100"
              />
            </div>
          </div>

          {/* 4) فئة المقاسات */}
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">
              فئة المقاسات المعتمدة
            </label>
            <select
              value={sizeCategoryId}
              disabled={saving}
              onChange={(e) => setSizeCategoryId(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-slate-900 focus:outline-hidden disabled:bg-slate-100"
            >
              <option value="">-- بدون فئة مقاسات محددة --</option>
              {sizeDefs.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.name} ({sc.values})
                </option>
              ))}
            </select>
          </div>

          {/* 5) تكوين القطع */}
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-blue-600" />
              <span>تكوين قطع الموديل *</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {GARMENT_COMPOSITION_ORDER.map((comp) => {
                const active = garmentComposition === comp;
                return (
                  <button
                    key={comp}
                    type="button"
                    disabled={saving}
                    onClick={() => setGarmentComposition(comp)}
                    className={`px-3 py-2.5 rounded-xl border text-xs font-bold transition text-right cursor-pointer disabled:cursor-not-allowed ${
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

          {/* 6) ملاحظات التصميم */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-amber-600" />
                <span>ملاحظات قسم التصميم</span>
              </label>
              {!canWriteNotes && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                  <Lock className="w-3 h-3" />
                  يتطلب صلاحية ملاحظات التصميم
                </span>
              )}
            </div>
            <textarea
              rows={3}
              disabled={saving || !canWriteNotes}
              value={designNotes}
              onChange={(e) => setDesignNotes(e.target.value)}
              placeholder={
                canWriteNotes
                  ? 'أدخل أي ملاحظات فنية أو توجيهات خاصة بتصميم الموديل...'
                  : 'ليس لديك صلاحية كتابة ملاحظات التصميم'
              }
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-slate-900 focus:outline-hidden disabled:bg-slate-100 disabled:text-slate-400"
            />
          </div>

          {formError && (
            <p className="text-[11px] font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
              {formError}
            </p>
          )}

          <div className="pt-2 flex items-center gap-3">
            <button
              type="submit"
              disabled={saving || uploadingImage}
              className="flex-grow py-3 rounded-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm transition shadow-lg cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving ? 'جارٍ حفظ التعديلات...' : 'حفظ تعديلات الموديل'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="px-5 py-3 rounded-full border border-slate-300 text-slate-700 hover:bg-slate-50 font-bold text-sm transition cursor-pointer disabled:opacity-50"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
