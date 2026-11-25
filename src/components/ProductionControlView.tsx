import React from 'react';
import { useApp } from '../context/AppContext';
import { DispatchAssemblyView } from './DispatchAssemblyView';
import { QCView } from './QCView';
import { SewingView } from './SewingView';

export type ProductionControlTab = 'qc' | 'printing' | 'sewing';

interface ProductionControlViewProps {
  initialSubTab?: ProductionControlTab;
}

/**
 * موجّه مباشر لأقسام متابعة الإنتاج (قسم الفرز / قسم الطباعة / قسم المكن).
 * تم نقل التبديل بالكامل إلى القائمة الجانبية المنسدلة «متابعة الإنتاج» وإزالة شريط التبويب العلوي.
 */
export const ProductionControlView: React.FC<ProductionControlViewProps> = ({
  initialSubTab
}) => {
  const { hasPermission } = useApp();

  const canViewQC = hasPermission('qc');
  const canViewPrinting = hasPermission('printing') || hasPermission('reports');
  const canViewSewing = hasPermission('sewing');

  const resolvedTab: ProductionControlTab =
    initialSubTab ||
    (canViewQC ? 'qc' : canViewPrinting ? 'printing' : canViewSewing ? 'sewing' : 'qc');

  return (
    <div className="animate-in fade-in duration-200">
      {resolvedTab === 'qc' && <QCView />}
      {resolvedTab === 'printing' && <DispatchAssemblyView />}
      {resolvedTab === 'sewing' && <SewingView />}
    </div>
  );
};
