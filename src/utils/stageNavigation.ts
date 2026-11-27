import type { DesignModel, GarmentPart, PartStage, SystemSectionKey } from '../types';
import { PART_STAGE_LABELS } from '../types';

export type NavigablePartStage = 'design' | PartStage;

export type StageNavigateFn = (tab: string, subTab?: string, modelId?: string) => void;

export interface PartStageTarget {
  stage: NavigablePartStage;
  stageLabel: string;
  sectionLabel: string;
  tab: string;
  subTab?: string;
  passModelId?: boolean;
  permissionSection: SystemSectionKey;
  badgeClass: string;
  buttonClass: string;
}

export const resolveEffectivePartStage = (
  model: DesignModel,
  part: GarmentPart,
  partStages: Partial<Record<GarmentPart, PartStage>>
): NavigablePartStage => {
  const status = (model.status || '').trim();
  const inDesign = status === 'مرحلة التصميم' || status === 'تصميم' || status === 'design';
  const explicit = model.part_stages?.[part];
  if (inDesign && !explicit) {
    return 'design';
  }
  return partStages[part] || 'cutting';
};

export const getPartStageNavigationTarget = (stage: NavigablePartStage): PartStageTarget => {
  switch (stage) {
    case 'design':
      return {
        stage,
        stageLabel: 'التصميم',
        sectionLabel: 'قسم التصميم',
        tab: 'design',
        passModelId: true,
        permissionSection: 'design',
        badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
        buttonClass: 'bg-slate-800 hover:bg-slate-900 text-white'
      };
    case 'cutting':
      return {
        stage,
        stageLabel: PART_STAGE_LABELS.cutting,
        sectionLabel: 'قسم القص',
        tab: 'cutting',
        passModelId: true,
        permissionSection: 'cutting',
        badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
        buttonClass: 'bg-rose-600 hover:bg-rose-700 text-white'
      };
    case 'qc_before_print':
    case 'qc_after_print':
    case 'qc_after_sewing':
      return {
        stage,
        stageLabel: PART_STAGE_LABELS[stage],
        sectionLabel: 'قسم الفرز والكنترول',
        tab: 'production_control',
        subTab: 'qc',
        permissionSection: 'qc',
        badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',
        buttonClass: 'bg-purple-600 hover:bg-purple-700 text-white'
      };
    case 'printing':
      return {
        stage,
        stageLabel: PART_STAGE_LABELS.printing,
        sectionLabel: 'قسم المطابع والتطريز',
        tab: 'production_control',
        subTab: 'printing',
        permissionSection: 'printing',
        badgeClass: 'bg-teal-50 text-teal-700 border-teal-200',
        buttonClass: 'bg-teal-600 hover:bg-teal-700 text-white'
      };
    case 'sewing':
      return {
        stage,
        stageLabel: PART_STAGE_LABELS.sewing,
        sectionLabel: 'قسم المكن',
        tab: 'production_control',
        subTab: 'sewing',
        permissionSection: 'sewing',
        badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        buttonClass: 'bg-emerald-600 hover:bg-emerald-700 text-white'
      };
    case 'finishing':
    case 'ironing':
    case 'packaging':
    case 'dest':
      return {
        stage,
        stageLabel: PART_STAGE_LABELS[stage],
        sectionLabel: 'الأسمبلي والأمبالاج',
        tab: 'assembly_packaging',
        permissionSection: 'assembly_packaging',
        badgeClass: 'bg-orange-50 text-orange-700 border-orange-200',
        buttonClass: 'bg-orange-600 hover:bg-orange-700 text-white'
      };
    case 'completed':
      return {
        stage,
        stageLabel: PART_STAGE_LABELS.completed,
        sectionLabel: 'مخزن الإنتاج التام',
        tab: 'warehouse',
        subTab: 'production_warehouse',
        permissionSection: 'production_warehouse',
        badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        buttonClass: 'bg-indigo-600 hover:bg-indigo-700 text-white'
      };
  }
};
