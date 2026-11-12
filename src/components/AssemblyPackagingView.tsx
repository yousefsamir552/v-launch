import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { PackagingMaterialsView } from './PackagingMaterialsView';
import {
  Boxes,
  ClipboardList,
  Sparkles,
  Flame,
  Package,
  PackageCheck,
  Search,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import {
  DesignModel,
  GarmentPart,
  getPartLabel,
  partsForComposition,
  PackagingStepKey,
  PACKAGING_STEP_ORDER,
  PACKAGING_STEP_LABELS,
  PartStage,
  PART_STAGE_ORDER,
  PART_STAGE_LABELS,
  WorkshopType
} from '../types';

const CUSTOM_WORKSHOP_OPTION = '__custom__';

/**
 * قائمة منسدلة مفلترة حسب تخصص الورشة + خيار "أخرى/كتابة يدوية".
 * عند اختيار ورشة مسجّلة بها رقم أو رابط جروب يظهر زر واتساب لإرسال الطلب.
 */
const WorkshopPicker: React.FC<{
  value: string;
  onChange: (name: string) => void;
  workshopType: WorkshopType;
  placeholder: string;
  whatsappMessage: string;
}> = ({ value, onChange, workshopType, placeholder, whatsappMessage }) => {
  const { workshops, openWhatsAppOrder } = useApp();
  const options = workshops.filter((w) => (w.workshop_type || []).includes(workshopType));
  const matched = options.find((w) => w.name === value) || null;
  const [customMode, setCustomMode] = useState(Boolean(value) && !matched);
  const selectValue = customMode ? CUSTOM_WORKSHOP_OPTION : matched ? matched.name : '';

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <select
          value={selectValue}
          onChange={(event) => {
            const next = event.target.value;
            if (next === CUSTOM_WORKSHOP_OPTION) {
              setCustomMode(true);
              onChange('');
            } else {
              setCustomMode(false);
              onChange(next);
            }
          }}
          className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-slate-300 text-[11px] font-semibold bg-white"
        >
          <option value="">{placeholder}</option>
          {options.map((w) => (
            <option key={w.id} value={w.name}>
              {w.name}
            </option>
          ))}
          <option value={CUSTOM_WORKSHOP_OPTION}>أخرى / كتابة يدوية</option>
        </select>
        {matched && (matched.phone || matched.whatsapp_group_link) && (
          <button
            type="button"
            onClick={() =>
              openWhatsAppOrder(matched.phone, matched.whatsapp_group_link, whatsappMessage)
            }
            className="shrink-0 px-2 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 transition cursor-pointer"
            title={
              matched.whatsapp_group_link
                ? 'فتح جروب الواتساب (سيتم نسخ نص الطلب تلقائياً)'
                : 'إرسال الطلب عبر واتساب'
            }
          >
            💬
          </button>
        )}
      </div>
      {customMode && (
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-[11px] font-semibold"
        />
      )}
    </div>
  );
};

type TabKey = 'requirements' | 'finishing' | 'ironing' | 'packaging' | 'dest';

/** الحالات التي تدخل فيها الموديلات إلى قسم الأسمبلي والأمبالاج (بعد اعتماد العد بعد المكن). */
const ELIGIBLE_STATUSES: string[] = [
  'في التشطيب',
  'في المكواة',
  'في التعبئة والتغليف',
  'جاهز للدَست',
  'مخزن الإنتاج التام',
  'مكتمل الإنتاج'
];

/** المرحلة الحالية الفعلية للموديل أثناء قسم الأسمبلي والأمبالاج. */
const CURRENT_ASSEMBLY_STAGE: Record<string, { label: string; tone: string }> = {
  'في التشطيب': { label: 'قسم التشطيب', tone: 'bg-purple-100 text-purple-800 border-purple-300' },
  'في المكواة': { label: 'قسم المكواة', tone: 'bg-rose-100 text-rose-800 border-rose-300' },
  'في التعبئة والتغليف': {
    label: 'قسم التعبئة والتغليف',
    tone: 'bg-emerald-100 text-emerald-800 border-emerald-300'
  },
  'جاهز للدَست': { label: 'قسم الدَست', tone: 'bg-indigo-100 text-indigo-800 border-indigo-300' }
};

/** الحالة التي يجب أن يكون عليها الموديل قبل بدء المرحلة (تسلسل إلزامي). */
const todayStr = () => new Date().toISOString().slice(0, 10);

const formatDate = (value?: string | null) => (value ? String(value).slice(0, 10) : '—');

const TABS: { key: TabKey; label: string; icon: React.ReactNode; accent: string }[] = [
  {
    key: 'requirements',
    label: 'متطلبات الأمبالاج',
    icon: <ClipboardList className="w-4 h-4" />,
    accent: 'bg-amber-100 text-amber-800 border-amber-300'
  },
  {
    key: 'finishing',
    label: 'التشطيب',
    icon: <Sparkles className="w-4 h-4" />,
    accent: 'bg-purple-100 text-purple-800 border-purple-300'
  },
  {
    key: 'ironing',
    label: 'المكواة',
    icon: <Flame className="w-4 h-4" />,
    accent: 'bg-rose-100 text-rose-800 border-rose-300'
  },
  {
    key: 'packaging',
    label: 'التعبئة والتغليف',
    icon: <Package className="w-4 h-4" />,
    accent: 'bg-emerald-100 text-emerald-800 border-emerald-300'
  },
  {
    key: 'dest',
    label: 'الدَست',
    icon: <PackageCheck className="w-4 h-4" />,
    accent: 'bg-indigo-100 text-indigo-800 border-indigo-300'
  }
];

const modelParts = (model: DesignModel): GarmentPart[] => {
  if (model.garment_parts && model.garment_parts.length) {
    return model.garment_parts.filter((part) => ['shirt', 'pants', 'jacket'].includes(part));
  }
  return partsForComposition(model.garment_composition).filter((part) =>
    ['shirt', 'pants', 'jacket'].includes(part)
  );
};

const StatusBadge: React.FC<{ status?: string }> = ({ status }) => {
  const value = status || '';
  const tone = value.includes('مخزن') || value.includes('مكتمل')
    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
    : value.includes('جاهز')
    ? 'bg-indigo-100 text-indigo-800 border-indigo-300'
    : value.includes('مكواة')
    ? 'bg-rose-100 text-rose-800 border-rose-300'
    : value.includes('تعبئة')
    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
    : value.includes('تشطيب')
    ? 'bg-purple-100 text-purple-800 border-purple-300'
    : 'bg-slate-100 text-slate-700 border-slate-300';
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${tone}`}>
      {value || 'غير محدد'}
    </span>
  );
};

const CurrentStageBadge: React.FC<{ status?: string }> = ({ status }) => {
  const stage = status ? CURRENT_ASSEMBLY_STAGE[status] : undefined;
  if (!stage) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] font-bold text-slate-500">المرحلة الحالية للموديل:</span>
      <span
        className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black border ${stage.tone}`}
      >
        {stage.label}
      </span>
    </div>
  );
};

const ModelHeader: React.FC<{ model: DesignModel }> = ({ model }) => (
  <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
    <div className="flex items-center gap-3">
      <img
        src={model.image}
        alt={model.model_code}
        className="w-11 h-11 rounded-xl object-contain bg-white border border-slate-200 p-0.5"
        onError={(e) => {
          (e.target as HTMLImageElement).src =
            'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=100&auto=format&fit=crop&q=60';
        }}
      />
      <div>
        <h4 className="font-black text-sm text-slate-900">{model.model_code}</h4>
        <p className="text-[11px] text-slate-500 font-semibold">
          {model.model_type || 'غير محدد'} • {modelParts(model).map((part) => getPartLabel(part)).join(' / ')}
        </p>
      </div>
    </div>
    <StatusBadge status={model.status} />
  </div>
);


const stepDate = (
  requirement: ReturnType<typeof useApp>['packagingRequirements'][number] | undefined,
  step: PackagingStepKey
): string | null => {
  if (!requirement) return null;
  const fromSteps = requirement.steps?.[step];
  if (fromSteps) return fromSteps;
  const map: Record<PackagingStepKey, string | null | undefined> = {
    sent_to_photo: requirement.sent_to_photo_date,
    received_from_photo: requirement.received_from_photo_date,
    sent_to_print_cards: requirement.sent_to_print_cards_date,
    received_printed_cards: requirement.received_printed_cards_date
  };
  return map[step] || null;
};

const RequirementsCard: React.FC<{ model: DesignModel; canEdit: boolean }> = ({
  model,
  canEdit
}) => {
  const { getPackagingRequirement, setPackagingStep } = useApp();
  const requirement = getPackagingRequirement(model.id);
  const [draftDates, setDraftDates] = useState<Record<string, string>>({});
  const [draftQty, setDraftQty] = useState<Record<string, string>>({
    sent_to_photo: String(requirement?.photography_sent_qty ?? 0),
    received_from_photo: String(requirement?.photography_received_qty ?? 0)
  });
  const [notes, setNotes] = useState('');

  const sentQty = Number(requirement?.photography_sent_qty || 0);
  const receivedQty = Number(requirement?.photography_received_qty || 0);
  const outstandingQty = Math.max(0, sentQty - receivedQty);
  const shortageQty = Number(requirement?.photography_shortage || 0);

  const completedCount = PACKAGING_STEP_ORDER.filter((step) =>
    Boolean(stepDate(requirement, step))
  ).length;
  const isComplete = completedCount === PACKAGING_STEP_ORDER.length;
  const missing = PACKAGING_STEP_ORDER.filter((step) => !stepDate(requirement, step)).map(
    (step) => PACKAGING_STEP_LABELS[step]
  );
  const progress = Math.round((completedCount / PACKAGING_STEP_ORDER.length) * 100);

  return (
    <div
      className={`bg-white rounded-3xl border p-4 shadow-xs flex flex-col gap-3 transition ${
        isComplete ? 'border-emerald-300' : 'border-slate-200'
      }`}
    >
      <ModelHeader model={model} />
      <CurrentStageBadge status={model.status} />

      <div className="flex items-center justify-between text-[11px] font-bold">
        <span className="text-slate-600">
          مكتمل {completedCount} من {PACKAGING_STEP_ORDER.length} خطوات
        </span>
        <span className={isComplete ? 'text-emerald-700' : 'text-amber-700'}>{progress}%</span>
      </div>
      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            isComplete ? 'bg-emerald-500' : 'bg-amber-500'
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="space-y-2">
        {PACKAGING_STEP_ORDER.map((step, index) => {
          const value = stepDate(requirement, step);
          return (
            <div
              key={step}
              className={`p-2.5 rounded-2xl border ${
                value ? 'bg-emerald-50/60 border-emerald-200' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black ${
                      value ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {value ? <CheckCircle2 className="w-3.5 h-3.5" /> : index + 1}
                  </span>
                  <span className="text-[11px] font-bold text-slate-800">
                    {PACKAGING_STEP_LABELS[step]}
                  </span>
                </div>
                <span className="font-mono text-[10px] font-black text-slate-700">
                  {formatDate(value)}
                </span>
              </div>

              {canEdit && (
                <div className="space-y-1.5 mt-2">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="date"
                      value={draftDates[step] ?? value ?? todayStr()}
                      onChange={(event) =>
                        setDraftDates((prev) => ({ ...prev, [step]: event.target.value }))
                      }
                      className="flex-1 px-2 py-1 rounded-lg border border-slate-300 text-[11px] font-mono bg-white"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setPackagingStep(
                          model.id,
                          step,
                          draftDates[step] ?? value ?? todayStr(),
                          notes,
                          step === 'sent_to_photo' || step === 'received_from_photo'
                            ? Number(draftQty[step] || 0)
                            : undefined
                        )
                      }
                      className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-[10px] font-bold hover:bg-slate-800 transition"
                    >
                      {value ? 'تحديث' : 'تسجيل'}
                    </button>
                  </div>
                  {(step === 'sent_to_photo' || step === 'received_from_photo') && (
                    <div className="flex items-center gap-1.5">
                      <label className="text-[10px] font-bold text-slate-500 shrink-0">
                        {step === 'sent_to_photo' ? 'عدد القطع المرسلة' : 'عدد القطع المستلمة'}
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={draftQty[step] ?? ''}
                        onChange={(event) =>
                          setDraftQty((prev) => ({ ...prev, [step]: event.target.value }))
                        }
                        className="w-20 px-2 py-1 rounded-lg border border-slate-300 text-[11px] font-mono bg-white"
                      />
                      <span className="text-[9px] font-bold text-slate-400">قطعة</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {sentQty > 0 && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-black text-indigo-900">
            <span>📸 قطع العينة في التصوير</span>
            <span className="font-mono">{outstandingQty} قطعة</span>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center text-[10px] font-bold">
            <div className="rounded-lg bg-white/80 border border-indigo-100 py-1">
              <span className="block text-[9px] text-slate-500">مرسل</span>
              <strong className="text-indigo-900">{sentQty}</strong>
            </div>
            <div className="rounded-lg bg-white/80 border border-indigo-100 py-1">
              <span className="block text-[9px] text-slate-500">مستلم</span>
              <strong className="text-emerald-700">{receivedQty}</strong>
            </div>
            <div className="rounded-lg bg-white/80 border border-indigo-100 py-1">
              <span className="block text-[9px] text-slate-500">متبقي بالتصوير</span>
              <strong className="text-amber-700">{outstandingQty}</strong>
            </div>
          </div>
          {outstandingQty > 0 ? (
            <p className="text-[10px] font-bold text-indigo-800 leading-relaxed">
              ⏳ {outstandingQty} قطعة مخصومة مؤقتاً من الإنتاج حتى رجوعها من التصوير.
            </p>
          ) : (
            <p className="text-[10px] font-bold text-emerald-700">
              ✅ تم إرجاع كل قطع العينة إلى الخط الإنتاجي.
            </p>
          )}
          {shortageQty > 0 && (
            <p className="text-[10px] font-black text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-2 py-1">
              ⚠️ عجز {shortageQty} قطعة: تم استلام الصور ولم تُرجع كل القطع للخط الإنتاجي.
            </p>
          )}
        </div>
      )}

      {canEdit && (
        <input
          type="text"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="ملاحظات الأمبالاج (اختياري)"
          className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-[11px] font-semibold"
        />
      )}

      {isComplete ? (
        <p className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-2.5 py-1.5">
          ✅ متطلبات الأمبالاج مكتملة — الموديل جاهز لمرحلة الدَست.
        </p>
      ) : (
        <p className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-2.5 py-1.5 leading-relaxed">
          ⚠️ متطلبات ناقصة: {missing.join(' / ')}
        </p>
      )}
    </div>
  );
};



/* ------------------------------------------------------------------ */
/* Finishing (per part)                                               */
/* ------------------------------------------------------------------ */

const PartFinishingRow: React.FC<{
  model: DesignModel;
  part: GarmentPart;
  canEdit: boolean;
}> = ({ model, part, canEdit }) => {
  const { finishingRecords, startFinishing, receiveFinishing, getPartStages } = useApp();
  const record = finishingRecords.find(
    (item) => item.model_id === model.id && item.part_type === part
  );
  const stage = getPartStages(model.id)[part] || 'cutting';
  const stageIndex = PART_STAGE_ORDER.indexOf(stage);
  const finishingIndex = PART_STAGE_ORDER.indexOf('finishing');
  const ironingIndex = PART_STAGE_ORDER.indexOf('ironing');

  const [expectedExit, setExpectedExit] = useState(
    record?.expected_exit_date?.slice(0, 10) || todayStr()
  );
  const [vendor, setVendor] = useState(record?.vendor_name || '');
  const [notes, setNotes] = useState('');

  const inFinishing = stageIndex === finishingIndex;
  const completed = Boolean(record?.is_received) || stageIndex >= ironingIndex;
  const canStart = !completed && stageIndex <= finishingIndex;

  const tone = completed
    ? 'bg-emerald-50/60 border-emerald-200'
    : inFinishing
    ? 'bg-purple-50/50 border-purple-200'
    : 'bg-slate-50 border-slate-200';

  return (
    <div className={`p-2.5 rounded-2xl border ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-black text-slate-800">{getPartLabel(part)}</span>
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
            completed
              ? 'bg-emerald-600 text-white border-emerald-600'
              : inFinishing
              ? 'bg-white text-purple-800 border-purple-300'
              : 'bg-white text-slate-600 border-slate-300'
          }`}
        >
          {completed ? 'تم الاستلام' : PART_STAGE_LABELS[stage]}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-1 mt-1.5 text-[10px] font-mono text-slate-600">
        <span>دخول: {formatDate(record?.entry_date)}</span>
        <span>متوقع: {formatDate(record?.expected_exit_date)}</span>
        <span>فعلي: {formatDate(record?.actual_exit_date)}</span>
      </div>
      {record?.vendor_name ? (
        <p className="mt-1 text-[10px] font-bold text-slate-500">الجهة: {record.vendor_name}</p>
      ) : null}

      {!completed && canEdit && (
        <div className="mt-2 space-y-1.5">
          {!record && (
            <>
              <div className="flex items-center gap-1.5">
                <label className="text-[10px] font-bold text-slate-500">الخروج المتوقع</label>
                <input
                  type="date"
                  value={expectedExit}
                  onChange={(event) => setExpectedExit(event.target.value)}
                  className="flex-1 px-2 py-1 rounded-lg border border-slate-300 text-[11px] font-mono bg-white"
                />
              </div>
              <WorkshopPicker
                value={vendor}
                onChange={setVendor}
                workshopType="finishing"
                placeholder="الجهة / ورشة التشطيب (اختياري)"
                whatsappMessage={`طلب تشطيب - موديل ${model.model_code} - قطعة ${getPartLabel(part)}`}
              />
            </>
          )}
          {!record ? (
            <button
              type="button"
              disabled={!canStart}
              onClick={() =>
                startFinishing({
                  modelId: model.id,
                  parts: [part],
                  expectedExitDate: expectedExit,
                  vendorName: vendor,
                  notes
                })
              }
              className="w-full py-1.5 rounded-xl bg-purple-600 text-white text-[10px] font-black hover:bg-purple-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              تسجيل دخول {getPartLabel(part)} للتشطيب
            </button>
          ) : (
            <button
              type="button"
              onClick={() => receiveFinishing(record.id, todayStr(), notes)}
              className="w-full py-1.5 rounded-xl bg-emerald-600 text-white text-[10px] font-black hover:bg-emerald-700 transition"
            >
              تسجيل استلام {getPartLabel(part)}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const FinishingCard: React.FC<{ model: DesignModel; canEdit: boolean }> = ({ model, canEdit }) => {
  const { finishingRecords } = useApp();
  const parts = modelParts(model);
  const records = finishingRecords.filter((record) => record.model_id === model.id);
  const allReceived = parts.every((part) =>
    records.some((record) => record.part_type === part && record.is_received)
  );

  return (
    <div
      className={`bg-white rounded-3xl border p-4 shadow-xs flex flex-col gap-3 ${
        allReceived ? 'border-emerald-300' : 'border-slate-200'
      }`}
    >
      <ModelHeader model={model} />

      <div className="space-y-2">
        {parts.map((part) => (
          <PartFinishingRow key={part} model={model} part={part} canEdit={canEdit} />
        ))}
      </div>

      <p
        className={`text-[11px] font-bold rounded-xl px-2.5 py-1.5 border ${
          allReceived
            ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
            : 'text-purple-800 bg-purple-50 border-purple-200'
        }`}
      >
        {allReceived
          ? '✅ تم استلام كل القطع من التشطيب — يمكن بدء المكواة لكل قطعة على حدة.'
          : '⏳ كل قطعة تُستلم على حدة؛ ولا تُفتح المكواة إلا بعد استلام القطعة من التشطيب.'}
      </p>
    </div>
  );
};


/* ------------------------------------------------------------------ */
/* Ironing (per part)                                                 */
/* ------------------------------------------------------------------ */

const PartIroningRow: React.FC<{
  model: DesignModel;
  part: GarmentPart;
  canEdit: boolean;
}> = ({ model, part, canEdit }) => {
  const { assemblyStageRecords, startIroning, receiveIroning, getPartStages } = useApp();
  const record = assemblyStageRecords.find(
    (item) => item.model_id === model.id && item.stage === 'ironing' && item.part_type === part
  );
  const stage = getPartStages(model.id)[part] || 'cutting';
  const stageIndex = PART_STAGE_ORDER.indexOf(stage);
  const ironingIndex = PART_STAGE_ORDER.indexOf('ironing');

  const [expectedExit, setExpectedExit] = useState(
    record?.expected_exit_date?.slice(0, 10) || todayStr()
  );
  const [vendor, setVendor] = useState(record?.vendor_name || '');
  const [notes, setNotes] = useState('');

  const readyForIroning = stageIndex === ironingIndex;
  const completed = Boolean(record?.is_completed) || stageIndex > ironingIndex;
  const waitingFinishing = stageIndex < ironingIndex;

  const tone = completed
    ? 'bg-emerald-50/60 border-emerald-200'
    : readyForIroning
    ? 'bg-rose-50/50 border-rose-200'
    : 'bg-slate-50 border-slate-200';

  return (
    <div className={`p-2.5 rounded-2xl border ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-black text-slate-800">{getPartLabel(part)}</span>
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
            completed
              ? 'bg-emerald-600 text-white border-emerald-600'
              : readyForIroning
              ? 'bg-white text-rose-800 border-rose-300'
              : 'bg-white text-slate-600 border-slate-300'
          }`}
        >
          {completed ? 'تمت المكواة' : PART_STAGE_LABELS[stage]}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-1 mt-1.5 text-[10px] font-mono text-slate-600">
        <span>دخول: {formatDate(record?.entry_date)}</span>
        <span>متوقع: {formatDate(record?.expected_exit_date)}</span>
        <span>فعلي: {formatDate(record?.actual_exit_date)}</span>
      </div>
      {record?.vendor_name ? (
        <p className="mt-1 text-[10px] font-bold text-slate-500">الجهة: {record.vendor_name}</p>
      ) : null}

      {waitingFinishing && (
        <p className="mt-2 text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-2 py-1.5">
          ⏳ بانتظار استلام هذه القطعة من التشطيب أولاً.
        </p>
      )}

      {readyForIroning && !completed && canEdit && (
        <div className="mt-2 space-y-1.5">
          {!record ? (
            <>
              <div className="flex items-center gap-1.5">
                <label className="text-[10px] font-bold text-slate-500">الخروج المتوقع</label>
                <input
                  type="date"
                  value={expectedExit}
                  onChange={(event) => setExpectedExit(event.target.value)}
                  className="flex-1 px-2 py-1 rounded-lg border border-slate-300 text-[11px] font-mono bg-white"
                />
              </div>
              <WorkshopPicker
                value={vendor}
                onChange={setVendor}
                workshopType="ironing"
                placeholder="الجهة / ورشة المكواة (اختياري)"
                whatsappMessage={`طلب مكواة - موديل ${model.model_code} - قطعة ${getPartLabel(part)}`}
              />
              <button
                type="button"
                onClick={() =>
                  startIroning({
                    modelId: model.id,
                    partType: part,
                    expectedExitDate: expectedExit,
                    vendorName: vendor,
                    notes
                  })
                }
                className="w-full py-1.5 rounded-xl bg-rose-600 text-white text-[10px] font-black hover:bg-rose-700 transition"
              >
                تسجيل دخول {getPartLabel(part)} للمكواة
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => receiveIroning(record.id, todayStr(), notes)}
              className="w-full py-1.5 rounded-xl bg-emerald-600 text-white text-[10px] font-black hover:bg-emerald-700 transition"
            >
              تسجيل استلام {getPartLabel(part)} من المكواة
            </button>
          )}
        </div>
      )}

      {completed && (
        <p className="mt-2 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-2 py-1.5">
          ✅ وصلت القطعة إلى التعبئة والتغليف.
        </p>
      )}
    </div>
  );
};

const IroningCard: React.FC<{ model: DesignModel; canEdit: boolean }> = ({ model, canEdit }) => {
  const { getPartStages } = useApp();
  const parts = modelParts(model);
  const stages = getPartStages(model.id);
  const ironingIndex = PART_STAGE_ORDER.indexOf('ironing');
  const allDone = parts.every(
    (part) => PART_STAGE_ORDER.indexOf(stages[part] || 'cutting') > ironingIndex
  );

  return (
    <div
      className={`bg-white rounded-3xl border p-4 shadow-xs flex flex-col gap-3 ${
        allDone ? 'border-emerald-300' : 'border-slate-200'
      }`}
    >
      <ModelHeader model={model} />

      <div className="space-y-2">
        {parts.map((part) => (
          <PartIroningRow key={part} model={model} part={part} canEdit={canEdit} />
        ))}
      </div>

      <p
        className={`text-[11px] font-bold rounded-xl px-2.5 py-1.5 border ${
          allDone
            ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
            : 'text-rose-800 bg-rose-50 border-rose-200'
        }`}
      >
        {allDone
          ? '✅ كل القطع انتهت من المكواة ووصلت إلى التعبئة والتغليف.'
          : '🧺 كل قطعة تُستلم من المكواة على حدة؛ التعبئة لا تُفتح إلا بعد اكتمال كل القطع.'}
      </p>
    </div>
  );
};
/* ------------------------------------------------------------------ */
/* Packaging (single card, locked until every part arrives)           */
/* ------------------------------------------------------------------ */

const PackagingCard: React.FC<{ model: DesignModel; canEdit: boolean }> = ({ model, canEdit }) => {
  const {
    assemblyStageRecords,
    startAssemblyStage,
    receiveAssemblyStage,
    getPartStages
  } = useApp();
  const parts = modelParts(model);
  const stages = getPartStages(model.id);
  const packagingIndex = PART_STAGE_ORDER.indexOf('packaging');

  const waitingParts = parts.filter(
    (part) => PART_STAGE_ORDER.indexOf(stages[part] || 'cutting') < packagingIndex
  );
  const arrivedParts = parts.filter((part) => !waitingParts.includes(part));
  const allReady = waitingParts.length === 0;

  const record = assemblyStageRecords.find(
    (item) => item.model_id === model.id && item.stage === 'packaging'
  );
  const completed = Boolean(record?.is_completed);

  const [expectedExit, setExpectedExit] = useState(todayStr());
  const [vendor, setVendor] = useState(record?.vendor_name || '');
  const [notes, setNotes] = useState('');

  return (
    <div
      className={`bg-white rounded-3xl border p-4 shadow-xs flex flex-col gap-3 ${
        completed ? 'border-emerald-300' : allReady ? 'border-slate-200' : 'border-rose-200'
      }`}
    >
      <ModelHeader model={model} />

      <div className="flex flex-wrap gap-1.5">
        {parts.map((part) => {
          const arrived = PART_STAGE_ORDER.indexOf(stages[part] || 'cutting') >= packagingIndex;
          return (
            <span
              key={part}
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                arrived
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                  : 'bg-amber-50 text-amber-800 border-amber-300'
              }`}
            >
              {arrived ? '✓' : '⏳'} {getPartLabel(part)} — {PART_STAGE_LABELS[stages[part] || 'cutting']}
            </span>
          );
        })}
      </div>

      {!allReady && (
        <div className="text-[11px] font-bold text-rose-800 bg-rose-50 border border-rose-200 rounded-xl px-2.5 py-2 leading-relaxed flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            {`🔒 التعبئة والتغليف مقفولة حتى تصل كل القطع (${arrivedParts.length} من ${parts.length}). `}
            {`في الانتظار: ${waitingParts.map((part) => getPartLabel(part)).join(' / ')}`}
          </span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono">
        <div className="p-2 rounded-xl bg-slate-50 border border-slate-200">
          <span className="block text-[9px] font-bold text-slate-500">دخول</span>
          <strong className="text-slate-800">{formatDate(record?.entry_date)}</strong>
        </div>
        <div className="p-2 rounded-xl bg-slate-50 border border-slate-200">
          <span className="block text-[9px] font-bold text-slate-500">خروج متوقع</span>
          <strong className="text-slate-800">{formatDate(record?.expected_exit_date)}</strong>
        </div>
        <div className="p-2 rounded-xl bg-slate-50 border border-slate-200">
          <span className="block text-[9px] font-bold text-slate-500">خروج فعلي</span>
          <strong className="text-slate-800">{formatDate(record?.actual_exit_date)}</strong>
        </div>
      </div>

      {record?.vendor_name ? (
        <p className="text-[10px] font-bold text-slate-500">الجهة: {record.vendor_name}</p>
      ) : null}

      {canEdit && !completed && (
        <div className="space-y-2 pt-2 border-t border-slate-100">
          {!record && (
            <>
              <div className="flex items-center gap-1.5">
                <label className="text-[10px] font-bold text-slate-500">الخروج المتوقع</label>
                <input
                  type="date"
                  value={expectedExit}
                  onChange={(event) => setExpectedExit(event.target.value)}
                  className="flex-1 px-2 py-1 rounded-lg border border-slate-300 text-[11px] font-mono bg-white"
                />
              </div>
              <WorkshopPicker
                value={vendor}
                onChange={setVendor}
                workshopType="packaging"
                placeholder="الجهة / ورشة التغليف (اختياري)"
                whatsappMessage={`طلب تعبئة وتغليف - موديل ${model.model_code}`}
              />
              <button
                type="button"
                disabled={!allReady}
                onClick={() =>
                  startAssemblyStage({
                    modelId: model.id,
                    stage: 'packaging',
                    expectedExitDate: expectedExit,
                    vendorName: vendor,
                    notes
                  })
                }
                className="w-full py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black hover:bg-emerald-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                بدء التعبئة والتغليف
              </button>
            </>
          )}
          {record && (
            <button
              type="button"
              onClick={() => receiveAssemblyStage(record.id, todayStr(), notes)}
              className="w-full py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black hover:bg-emerald-700 transition"
            >
              تسجيل استلام التعبئة
            </button>
          )}
        </div>
      )}

      {completed && (
        <p className="text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-center">
          ✅ التعبئة والتغليف مكتملة — الموديل انتقل إلى قسم الدَست.
        </p>
      )}
    </div>
  );
};
/* ------------------------------------------------------------------ */
/* Dest (model-level, gated by packaging requirements + all parts)    */
/* ------------------------------------------------------------------ */

const DestCard: React.FC<{ model: DesignModel; canEdit: boolean }> = ({ model, canEdit }) => {
  const {
    assemblyStageRecords,
    startAssemblyStage,
    receiveAssemblyStage,
    getPackagingRequirement,
    getPartStages
  } = useApp();
  const record = assemblyStageRecords.find(
    (item) => item.model_id === model.id && item.stage === 'dest'
  );
  const requirement = getPackagingRequirement(model.id);
  const stages = getPartStages(model.id);
  const parts = modelParts(model);
  const destIndex = PART_STAGE_ORDER.indexOf('dest');
  const waitingDest = parts.filter(
    (part) => PART_STAGE_ORDER.indexOf(stages[part] || 'cutting') < destIndex
  );

  const [expectedExit, setExpectedExit] = useState(todayStr());
  const [vendor, setVendor] = useState(record?.vendor_name || '');
  const [notes, setNotes] = useState('');

  const requirementComplete = Boolean(requirement?.is_complete);
  const allArrived = waitingDest.length === 0;
  // التسلسل الإلزامي: لا يبدأ الدَست إلا بعد اكتمال التعبئة لكل القطع والمتطلبات.
  const outOfSequence = !record && !allArrived;
  const blocked = !requirementComplete || outOfSequence;

  return (
    <div
      className={`bg-white rounded-3xl border p-4 shadow-xs flex flex-col gap-3 ${
        record?.is_completed ? 'border-emerald-300' : blocked ? 'border-rose-200' : 'border-slate-200'
      }`}
    >
      <ModelHeader model={model} />

      <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono">
        <div className="p-2 rounded-xl bg-slate-50 border border-slate-200">
          <span className="block text-[9px] font-bold text-slate-500">دخول</span>
          <strong className="text-slate-800">{formatDate(record?.entry_date)}</strong>
        </div>
        <div className="p-2 rounded-xl bg-slate-50 border border-slate-200">
          <span className="block text-[9px] font-bold text-slate-500">خروج متوقع</span>
          <strong className="text-slate-800">{formatDate(record?.expected_exit_date)}</strong>
        </div>
        <div className="p-2 rounded-xl bg-slate-50 border border-slate-200">
          <span className="block text-[9px] font-bold text-slate-500">خروج فعلي</span>
          <strong className="text-slate-800">{formatDate(record?.actual_exit_date)}</strong>
        </div>
      </div>

      {record?.vendor_name ? (
        <p className="text-[10px] font-bold text-slate-500">الجهة: {record.vendor_name}</p>
      ) : null}

      {blocked && (
        <div className="text-[10px] font-bold text-rose-800 bg-rose-50 border border-rose-200 rounded-xl px-2.5 py-2 leading-relaxed flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            {outOfSequence ? (
              <>
                لا يمكن بدء الدَست قبل اكتمال استلام كل القطع من التعبئة والتغليف.
                {` في الانتظار: ${waitingDest.map((part) => getPartLabel(part)).join(' / ')}`}
              </>
            ) : (
              <>
                لا يمكن بدء الدَست قبل اكتمال متطلبات الأمبالاج.
                {requirement?.missing_steps?.length
                  ? ` المتبقي: ${requirement.missing_steps.join(' / ')}`
                  : ' يرجى تسجيل خطوات الأمبالاج الأربعة أولاً.'}
              </>
            )}
          </span>
        </div>
      )}

      {canEdit && (
        <div className="space-y-2 pt-2 border-t border-slate-100">
          {!record || !record.is_completed ? (
            <>
              {!record && (
                <>
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] font-bold text-slate-500">الخروج المتوقع</label>
                    <input
                      type="date"
                      value={expectedExit}
                      onChange={(event) => setExpectedExit(event.target.value)}
                      className="flex-1 px-2 py-1 rounded-lg border border-slate-300 text-[11px] font-mono bg-white"
                    />
                  </div>
                  <WorkshopPicker
                    value={vendor}
                    onChange={setVendor}
                    workshopType="packaging"
                    placeholder="الجهة / ورشة الدَست (اختياري)"
                    whatsappMessage={`طلب دَست - موديل ${model.model_code}`}
                  />
                </>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={Boolean(blocked)}
                  onClick={() =>
                    startAssemblyStage({
                      modelId: model.id,
                      stage: 'dest',
                      expectedExitDate: expectedExit,
                      vendorName: vendor,
                      notes
                    })
                  }
                  className="flex-1 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black hover:bg-slate-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {record ? 'تحديث موعد الخروج' : 'بدء قسم الدَست'}
                </button>
                {record && (
                  <button
                    type="button"
                    onClick={() => receiveAssemblyStage(record.id, todayStr(), notes)}
                    className="flex-1 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black hover:bg-emerald-700 transition"
                  >
                    تسجيل استلام
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-center">
              ✅ المرحلة مكتملة ومُستلمة. لتعديل التواريخ استخدم سجل التتبع في «حركة الموديلات».
            </p>
          )}
        </div>
      )}
    </div>
  );
};



/* ------------------------------------------------------------------ */
/* Main view                                                          */
/* ------------------------------------------------------------------ */

export const AssemblyPackagingView: React.FC = () => {
  const {
    models,
    packagingRequirements,
    finishingRecords,
    assemblyStageRecords,
    getPartStages,
    hasPermission,
    hasAssemblyPackagingAccess
  } = useApp();

  const activeSectionDefault = (): 'pipeline' | 'materials' => {
    try {
      if (localStorage.getItem('erp_packaging_materials_focus')) {
        localStorage.removeItem('erp_packaging_materials_focus');
        return 'materials';
      }
    } catch {}
    return 'pipeline';
  };

  const canEdit = hasAssemblyPackagingAccess(true);
  const [activeTab, setActiveTab] = useState<TabKey>('requirements');
  const [activeSection, setActiveSection] = useState<'pipeline' | 'materials'>(activeSectionDefault);
  const [searchTerm, setSearchTerm] = useState('');

  // تنبيهات خامات التشغيل في شريط الإشعارات تفتح هذا القسم مباشرة.
  useEffect(() => {
    const openMaterials = () => setActiveSection('materials');
    window.addEventListener('erp:open-packaging-materials', openMaterials);
    return () => window.removeEventListener('erp:open-packaging-materials', openMaterials);
  }, []);

  const requirementCompleteMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    packagingRequirements.forEach((req) => {
      map[req.model_id] = Boolean(req.is_complete);
    });
    return map;
  }, [packagingRequirements]);

  const eligibleModels = useMemo(() => {
    const withRecords = new Set<string>([
      ...finishingRecords.map((record) => record.model_id),
      ...assemblyStageRecords.map((record) => record.model_id),
      ...packagingRequirements.map((req) => req.model_id)
    ]);
    return models.filter(
      (model) =>
        !model.is_deleted && (ELIGIBLE_STATUSES.includes(model.status) || withRecords.has(model.id))
    );
  }, [models, finishingRecords, assemblyStageRecords, packagingRequirements]);

  const visibleModels = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return eligibleModels;
    return eligibleModels.filter(
      (model) =>
        model.model_code.toLowerCase().includes(term) ||
        (model.model_type || '').toLowerCase().includes(term)
    );
  }, [eligibleModels, searchTerm]);

  /** كل القطع وصلت إلى المرحلة المطلوبة أو تجاوزتها. */
  const allPartsAtOrBeyond = (model: DesignModel, stage: PartStage) => {
    const parts = modelParts(model);
    if (!parts.length) return false;
    const stages = getPartStages(model.id);
    const threshold = PART_STAGE_ORDER.indexOf(stage);
    return parts.every(
      (part) => PART_STAGE_ORDER.indexOf(stages[part] || 'cutting') >= threshold
    );
  };

  const isDoneForTab = (model: DesignModel, tab: TabKey) => {
    if (tab === 'requirements') return Boolean(requirementCompleteMap[model.id]);
    if (tab === 'finishing') return allPartsAtOrBeyond(model, 'ironing');
    if (tab === 'ironing') return allPartsAtOrBeyond(model, 'packaging');
    if (tab === 'packaging') return allPartsAtOrBeyond(model, 'dest');
    return allPartsAtOrBeyond(model, 'completed');
  };

  /** هل يظهر الموديل في هذا التبويب حسب المرحلة الحالية لكل قطعة؟ */
  const modelInTab = (model: DesignModel, tab: TabKey): boolean => {
    if (tab === 'requirements') return true;
    const stages = Object.values(getPartStages(model.id)) as PartStage[];
    if (!stages.length) return false;
    const rank = (stage: PartStage) => PART_STAGE_ORDER.indexOf(stage);
    if (tab === 'finishing') {
      // تظل البطاقة ظاهرة ما دامت هناك قطعة لم تُستلم من التشطيب بعد (حتى لو تقدّمت قطعة أخرى).
      return stages.some((stage) => rank(stage) <= rank('finishing'));
    }
    if (tab === 'ironing') {
      return stages.some((stage) => stage === 'ironing');
    }
    if (tab === 'packaging') {
      // بطاقة تغليف واحدة تظهر بمجرد وصول أول قطعة، وتُقفل حتى وصول كل القطع.
      return (
        stages.some((stage) => rank(stage) >= rank('packaging')) &&
        !stages.every((stage) => rank(stage) >= rank('dest'))
      );
    }
    // الدَست: لا يظهر الموديل إلا بعد اكتمال تعبئة كل القطع (ويُخفى بعد اكتمال الدَست).
    return (
      stages.every((stage) => rank(stage) >= rank('packaging')) &&
      !stages.every((stage) => stage === 'completed')
    );
  };

  const pendingCountForTab = (tab: TabKey) =>
    visibleModels.filter((model) => modelInTab(model, tab) && !isDoneForTab(model, tab)).length;

  const sortedModels = useMemo(() => {
    return visibleModels
      .filter((model) => modelInTab(model, activeTab))
      .sort((a, b) => {
        const aDone = isDoneForTab(a, activeTab) ? 1 : 0;
        const bDone = isDoneForTab(b, activeTab) ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        return a.model_code.localeCompare(b.model_code);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    visibleModels,
    activeTab,
    requirementCompleteMap,
    finishingRecords,
    assemblyStageRecords,
    models
  ]);

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="bg-gradient-to-l from-orange-600 via-amber-600 to-slate-900 rounded-3xl p-6 text-white shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
              <Boxes className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black">قسم الأسمبلي والأمبالاج</h2>
              <p className="text-[12px] text-white/80 font-semibold mt-1 leading-relaxed">
                متطلبات الأمبالاج (الصور والكروت) ← التشطيب ← المكواة ← التعبئة والتغليف ← الدَست
                <span className="block text-[11px] text-white/70 mt-0.5">
                  كل قطعة (تيشرت / بنطلون / جاكيت) تتبع مراحلها بشكل مستقل، والتعبئة مقفولة حتى وصول كل القطع.
                </span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="px-3 py-1.5 rounded-full bg-white/15 text-[11px] font-black">
              موديلات مؤهلة: {eligibleModels.length}
            </div>
            <div className="px-3 py-1.5 rounded-full bg-white/15 text-[11px] font-black">
              {TABS.find((tab) => tab.key === activeTab)?.label}: متبقي{' '}
              {pendingCountForTab(activeTab)}
            </div>
          </div>
        </div>
      </div>

      {/* Section switcher */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveSection('pipeline')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[11px] font-black border transition ${
            activeSection === 'pipeline'
              ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <ClipboardList className="w-4 h-4" /> متابعة المراحل التشغيلية
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('materials')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[11px] font-black border transition ${
            activeSection === 'materials'
              ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Boxes className="w-4 h-4" /> خامات التشغيل والأمبالاج
        </button>
      </div>

      {activeSection === 'materials' ? (
        <PackagingMaterialsView />
      ) : (
        <>
      {/* Search + Tabs */}
      <div className="bg-white rounded-3xl border border-slate-200/80 p-4 shadow-xs space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="بحث بكود الموديل أو النوع..."
            className="w-full ps-9 pe-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            const pending = pendingCountForTab(tab.key);
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-[11px] font-black border transition ${
                  isActive
                    ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                    : `${tab.accent} hover:opacity-90`
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
                <span
                  className={`min-w-[20px] h-5 px-1 rounded-full text-[9px] flex items-center justify-center font-black ${
                    isActive ? 'bg-white/20 text-white' : 'bg-white/70 text-slate-700'
                  }`}
                >
                  {pending}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Cards grid */}
      {sortedModels.length === 0 ? (
        <div className="bg-white rounded-3xl border border-dashed border-slate-300 p-10 text-center">
          <Package className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-black text-slate-700">
            لا توجد موديلات في قسم الأسمبلي والأمبالاج
          </p>
          <p className="text-[11px] text-slate-500 font-semibold mt-1">
            تظهر الموديلات هنا بعد اكتمال العد والفرز بعد المكن.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sortedModels.map((model) => {
            if (activeTab === 'requirements') {
              return <RequirementsCard key={model.id} model={model} canEdit={canEdit} />;
            }
            if (activeTab === 'finishing') {
              return <FinishingCard key={model.id} model={model} canEdit={canEdit} />;
            }
            if (activeTab === 'ironing') {
              return <IroningCard key={model.id} model={model} canEdit={canEdit} />;
            }
            if (activeTab === 'packaging') {
              return <PackagingCard key={model.id} model={model} canEdit={canEdit} />;
            }
            return <DestCard key={model.id} model={model} canEdit={canEdit} />;
          })}
        </div>
      )}
        </>
      )}
    </div>
  );
};

export default AssemblyPackagingView;

