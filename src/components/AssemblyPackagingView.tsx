import React, { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
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
  AssemblyStageKey,
  ASSEMBLY_STAGE_LABELS
} from '../types';

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
const STAGE_REQUIRED_STATUS: Record<AssemblyStageKey, DesignModel['status']> = {
  ironing: 'في المكواة',
  packaging: 'في التعبئة والتغليف',
  dest: 'جاهز للدَست'
};

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

const STAGE_TAB_TO_KEY: Record<'ironing' | 'packaging' | 'dest', AssemblyStageKey> = {
  ironing: 'ironing',
  packaging: 'packaging',
  dest: 'dest'
};

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
  const [notes, setNotes] = useState('');

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
                <div className="flex items-center gap-1.5 mt-2">
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
                      setPackagingStep(model.id, step, draftDates[step] ?? value ?? todayStr(), notes)
                    }
                    className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-[10px] font-bold hover:bg-slate-800 transition"
                  >
                    {value ? 'تحديث' : 'تسجيل'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

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



const FinishingCard: React.FC<{ model: DesignModel; canEdit: boolean }> = ({ model, canEdit }) => {
  const { finishingRecords, startFinishing, receiveFinishing } = useApp();
  const records = finishingRecords.filter((record) => record.model_id === model.id);
  const parts = modelParts(model);
  const [selectedParts, setSelectedParts] = useState<GarmentPart[]>(parts);
  const [expectedExit, setExpectedExit] = useState(todayStr());
  const [notes, setNotes] = useState('');

  const allReceived = records.length > 0 && records.every((record) => record.is_received);
  const pendingCount = records.filter((record) => !record.is_received).length;

  const togglePart = (part: GarmentPart) =>
    setSelectedParts((prev) =>
      prev.includes(part) ? prev.filter((item) => item !== part) : [...prev, part]
    );

  return (
    <div
      className={`bg-white rounded-3xl border p-4 shadow-xs flex flex-col gap-3 ${
        allReceived ? 'border-emerald-300' : 'border-slate-200'
      }`}
    >
      <ModelHeader model={model} />

      {records.length > 0 ? (
        <div className="space-y-2">
          {records.map((record) => (
            <div
              key={record.id}
              className={`p-2.5 rounded-2xl border ${
                record.is_received
                  ? 'bg-emerald-50/60 border-emerald-200'
                  : 'bg-purple-50/50 border-purple-200'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-black text-slate-800">
                  {record.piece_label || getPartLabel(record.part_type)}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                    record.is_received
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-purple-800 border-purple-300'
                  }`}
                >
                  {record.is_received ? 'تم الاستلام' : 'في التشطيب'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1 mt-1.5 text-[10px] font-mono text-slate-600">
                <span>دخول: {formatDate(record.entry_date)}</span>
                <span>متوقع: {formatDate(record.expected_exit_date)}</span>
                <span>فعلي: {formatDate(record.actual_exit_date)}</span>
              </div>
              {!record.is_received && canEdit && (
                <button
                  type="button"
                  onClick={() => receiveFinishing(record.id, todayStr(), notes)}
                  className="mt-2 w-full py-1.5 rounded-xl bg-emerald-600 text-white text-[10px] font-black hover:bg-emerald-700 transition"
                >
                  تسجيل استلام {record.piece_label || getPartLabel(record.part_type)}
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] font-bold text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-xl px-2.5 py-2">
          لم يتم تسجيل دخول أي قطعة للتشطيب بعد.
        </p>
      )}

      {canEdit && !allReceived && (
        <div className="pt-2 border-t border-slate-100 space-y-2">
          <p className="text-[10px] font-black text-slate-600">بدء / تسجيل دخول التشطيب:</p>
          <div className="flex flex-wrap gap-1.5">
            {parts.map((part) => (
              <button
                key={part}
                type="button"
                onClick={() => togglePart(part)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition ${
                  selectedParts.includes(part)
                    ? 'bg-purple-600 text-white border-purple-600'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {getPartLabel(part)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] font-bold text-slate-500">الخروج المتوقع</label>
            <input
              type="date"
              value={expectedExit}
              onChange={(event) => setExpectedExit(event.target.value)}
              className="flex-1 px-2 py-1 rounded-lg border border-slate-300 text-[11px] font-mono bg-white"
            />
          </div>
          <input
            type="text"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="ملاحظات التشطيب (اختياري)"
            className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-[11px] font-semibold"
          />
          <button
            type="button"
            disabled={selectedParts.length === 0}
            onClick={() =>
              startFinishing({
                modelId: model.id,
                parts: selectedParts,
                expectedExitDate: expectedExit,
                notes
              })
            }
            className="w-full py-2 rounded-xl bg-purple-600 text-white text-[11px] font-black hover:bg-purple-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            تسجيل دخول التشطيب ({selectedParts.map((part) => getPartLabel(part)).join(' / ')})
          </button>
        </div>
      )}

      {records.length > 0 && (
        <p
          className={`text-[11px] font-bold rounded-xl px-2.5 py-1.5 border ${
            allReceived
              ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
              : 'text-purple-800 bg-purple-50 border-purple-200'
          }`}
        >
          {allReceived
            ? '✅ تم استلام كل القطع من التشطيب — الموديل في قسم المكواة.'
            : `⏳ متبقي ${pendingCount} قطعة داخل التشطيب.`}
        </p>
      )}
    </div>
  );
};



const StageCard: React.FC<{
  model: DesignModel;
  stage: AssemblyStageKey;
  canEdit: boolean;
}> = ({ model, stage, canEdit }) => {
  const { assemblyStageRecords, startAssemblyStage, receiveAssemblyStage, getPackagingRequirement } =
    useApp();
  const record = assemblyStageRecords.find(
    (item) => item.model_id === model.id && item.stage === stage
  );
  const requirement = getPackagingRequirement(model.id);
  const [expectedExit, setExpectedExit] = useState(todayStr());
  const [notes, setNotes] = useState('');

  const isDest = stage === 'dest';
  const requirementComplete = Boolean(requirement?.is_complete);
  // لا تُبدأ المرحلة إلا بعد استلام المرحلة السابقة لها (تسلسل إلزامي).
  const outOfSequence = !record && model.status !== STAGE_REQUIRED_STATUS[stage];
  const blocked = (isDest && !requirementComplete) || outOfSequence;
  const stageLabel = ASSEMBLY_STAGE_LABELS[stage];

  return (
    <div
      className={`bg-white rounded-3xl border p-4 shadow-xs flex flex-col gap-3 ${
        record?.is_completed
          ? 'border-emerald-300'
          : blocked
          ? 'border-rose-200'
          : 'border-slate-200'
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

      {record ? (
        <div className="flex items-center justify-between gap-2">
          <span
            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
              record.is_completed
                ? 'bg-emerald-600 text-white border-emerald-600'
                : record.is_overdue
                ? 'bg-rose-100 text-rose-800 border-rose-300'
                : 'bg-indigo-50 text-indigo-800 border-indigo-200'
            }`}
          >
            {record.is_completed ? 'مكتملة' : record.is_overdue ? 'متأخرة' : 'جارية الآن'}
          </span>
          {record.notes ? (
            <span className="text-[10px] text-slate-500 font-semibold truncate max-w-[60%]">
              {record.notes}
            </span>
          ) : null}
        </div>
      ) : null}

      {blocked && (
        <div className="text-[10px] font-bold text-rose-800 bg-rose-50 border border-rose-200 rounded-xl px-2.5 py-2 leading-relaxed flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            {outOfSequence ? (
              <>
                لا يمكن بدء مرحلة {stageLabel} قبل استلام المرحلة السابقة لها.
                {` الحالة الحالية للموديل: ${model.status}.`}
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
              <div className="flex items-center gap-1.5">
                <label className="text-[10px] font-bold text-slate-500">الخروج المتوقع</label>
                <input
                  type="date"
                  value={expectedExit}
                  onChange={(event) => setExpectedExit(event.target.value)}
                  className="flex-1 px-2 py-1 rounded-lg border border-slate-300 text-[11px] font-mono bg-white"
                />
              </div>
              <input
                type="text"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="ملاحظات المرحلة (اختياري)"
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-[11px] font-semibold"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={blocked}
                  onClick={() =>
                    startAssemblyStage({
                      modelId: model.id,
                      stage,
                      expectedExitDate: expectedExit,
                      notes
                    })
                  }
                  className="flex-1 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black hover:bg-slate-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {record ? 'تحديث موعد الخروج' : `بدء ${stageLabel}`}
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
    hasPermission
  } = useApp();

  const canEdit = hasPermission('assembly_packaging', true);
  const [activeTab, setActiveTab] = useState<TabKey>('requirements');
  const [searchTerm, setSearchTerm] = useState('');

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

  const isFinishingDone = (modelId: string) => {
    const records = finishingRecords.filter((record) => record.model_id === modelId);
    return records.length > 0 && records.every((record) => record.is_received);
  };

  const isStageDone = (modelId: string, stage: AssemblyStageKey) => {
    const record = assemblyStageRecords.find(
      (item) => item.model_id === modelId && item.stage === stage
    );
    return Boolean(record?.is_completed);
  };

  const isDoneForTab = (model: DesignModel, tab: TabKey) => {
    if (tab === 'requirements') return Boolean(requirementCompleteMap[model.id]);
    if (tab === 'finishing') return isFinishingDone(model.id);
    return isStageDone(model.id, STAGE_TAB_TO_KEY[tab as 'ironing' | 'packaging' | 'dest']);
  };

  const pendingCountForTab = (tab: TabKey) =>
    visibleModels.filter((model) => !isDoneForTab(model, tab)).length;

  const sortedModels = useMemo(() => {
    return [...visibleModels].sort((a, b) => {
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
    assemblyStageRecords
  ]);

  const activeStage =
    activeTab === 'finishing' || activeTab === 'requirements'
      ? null
      : STAGE_TAB_TO_KEY[activeTab];


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
            return (
              <StageCard
                key={model.id}
                model={model}
                stage={activeStage as AssemblyStageKey}
                canEdit={canEdit}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AssemblyPackagingView;

