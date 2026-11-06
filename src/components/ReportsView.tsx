import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { 
  BarChart3, 
  Printer, 
  Download, 
  Calendar, 
  Layers, 
  Scissors, 
  Printer as PrintIcon, 
  CheckCircle, 
  Shirt, 
  Filter, 
  ChevronDown, 
  ChevronUp, 
  FileSpreadsheet, 
  Search,
  Sparkles,
  TrendingUp,
  AlertCircle
} from 'lucide-react';
import { CuttingRecord, QCRecord, PrintDispatch, SewingDispatch, DesignModel } from '../types';

type ReportSection = 'cutting' | 'printing' | 'qc' | 'sewing';
type ReportPeriod = 'daily' | 'weekly' | 'monthly';

interface AggregatedBucket {
  periodKey: string;
  periodLabel: string;
  modelsCount: number;
  modelCodes: string[];
  totalPieces: number;
  secondaryLabel: string;
  secondaryValue: string | number;
  operationsCount: number;
  operators: string[];
  details: {
    id: string;
    modelCode: string;
    detail1: string;
    detail2: string;
    pieces: number;
    notes?: string;
    timestamp?: string;
  }[];
}

export const ReportsView: React.FC = () => {
  const { 
    currentUser, 
    models, 
    cuttingRecords, 
    qcRecords, 
    printDispatches, 
    sewingDispatches,
    logAction,
    addFlashMessage 
  } = useApp();

  const [selectedSection, setSelectedSection] = useState<ReportSection>('cutting');
  const [selectedPeriod, setSelectedPeriod] = useState<ReportPeriod>('daily');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedBucketKey, setExpandedBucketKey] = useState<string | null>(null);

  // Arabic date formatter
  const formatPeriodLabel = (dStr: string, period: ReportPeriod): string => {
    try {
      const d = new Date(dStr);
      if (isNaN(d.getTime())) return dStr;

      const arabicMonths = [
        'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
        'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
      ];
      const arabicDays = [
        'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'
      ];

      if (period === 'daily') {
        const dayName = arabicDays[d.getDay()];
        return `${dayName}، ${d.getDate()} ${arabicMonths[d.getMonth()]} ${d.getFullYear()}`;
      } else if (period === 'weekly') {
        // Approximate week range
        const startOfWeek = new Date(d);
        startOfWeek.setDate(d.getDate() - d.getDay());
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        return `أسبوع (${startOfWeek.getDate()} ${arabicMonths[startOfWeek.getMonth()]} — ${endOfWeek.getDate()} ${arabicMonths[endOfWeek.getMonth()]} ${endOfWeek.getFullYear()})`;
      } else {
        return `${arabicMonths[d.getMonth()]} ${d.getFullYear()}`;
      }
    } catch {
      return dStr;
    }
  };

  // Helper to extract bucket key from timestamp
  const getBucketKey = (dateVal: string | undefined, period: ReportPeriod): string => {
    if (!dateVal) return 'غير محدد';
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) {
      // Fallback: take substring
      return dateVal.slice(0, 10);
    }
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    if (period === 'daily') {
      return `${year}-${month}-${day}`;
    } else if (period === 'weekly') {
      // Start of week key (Sunday)
      const startOfWeek = new Date(d);
      startOfWeek.setDate(d.getDate() - d.getDay());
      const sY = startOfWeek.getFullYear();
      const sM = String(startOfWeek.getMonth() + 1).padStart(2, '0');
      const sD = String(startOfWeek.getDate()).padStart(2, '0');
      return `week-${sY}-${sM}-${sD}`;
    } else {
      return `${year}-${month}`;
    }
  };

  // Aggregation Engine
  const aggregatedData = useMemo(() => {
    const bucketsMap = new Map<string, AggregatedBucket>();

    const checkDateInRange = (dateStr?: string) => {
      if (!dateStr) return true;
      const d = dateStr.slice(0, 10);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    };

    if (selectedSection === 'cutting') {
      cuttingRecords.forEach((rec) => {
        if (!checkDateInRange(rec.created_at)) return;
        const bucketKey = getBucketKey(rec.created_at, selectedPeriod);
        const m = models.find((mod) => mod.id === rec.model_id);
        const modelCode = m?.model_code || 'موديل';

        if (!bucketsMap.has(bucketKey)) {
          bucketsMap.set(bucketKey, {
            periodKey: bucketKey,
            periodLabel: formatPeriodLabel(rec.created_at || bucketKey, selectedPeriod),
            modelsCount: 0,
            modelCodes: [],
            totalPieces: 0,
            secondaryLabel: 'عدد الراقات',
            secondaryValue: 0,
            operationsCount: 0,
            operators: [],
            details: []
          });
        }

        const bucket = bucketsMap.get(bucketKey)!;
        bucket.totalPieces += rec.pieces_count || 0;
        bucket.secondaryValue = (Number(bucket.secondaryValue) || 0) + (rec.layers_count || 0);
        bucket.operationsCount += 1;
        if (!bucket.modelCodes.includes(modelCode)) {
          bucket.modelCodes.push(modelCode);
        }
        if (rec.cutter_name && !bucket.operators.includes(rec.cutter_name)) {
          bucket.operators.push(rec.cutter_name);
        }
        bucket.details.push({
          id: rec.id,
          modelCode,
          detail1: `اللون: ${rec.color_name || rec.colorName || '—'}`,
          detail2: `المقصدار: ${rec.cutter_name || rec.cutterName || '—'} (راقات: ${rec.layers_count || 0})`,
          pieces: rec.pieces_count || rec.piecesCount || 0,
          notes: rec.shade_degree || rec.shadeDegree || '',
          timestamp: rec.created_at
        });
      });
    } else if (selectedSection === 'printing') {
      printDispatches.forEach((disp) => {
        const dateRef = disp.dispatched_at || disp.expected_delivery_date || '2026-11-01';
        if (!checkDateInRange(dateRef)) return;
        const bucketKey = getBucketKey(dateRef, selectedPeriod);
        const m = models.find((mod) => mod.id === disp.model_id);
        const modelCode = m?.model_code || 'موديل';

        if (!bucketsMap.has(bucketKey)) {
          bucketsMap.set(bucketKey, {
            periodKey: bucketKey,
            periodLabel: formatPeriodLabel(dateRef, selectedPeriod),
            modelsCount: 0,
            modelCodes: [],
            totalPieces: 0,
            secondaryLabel: 'حالة الاستلام بالمصنع',
            secondaryValue: '',
            operationsCount: 0,
            operators: [],
            details: []
          });
        }

        const bucket = bucketsMap.get(bucketKey)!;
        bucket.totalPieces += disp.pieces_count || 0;
        bucket.operationsCount += 1;
        if (!bucket.modelCodes.includes(modelCode)) {
          bucket.modelCodes.push(modelCode);
        }
        if (disp.shop_name && !bucket.operators.includes(disp.shop_name)) {
          bucket.operators.push(disp.shop_name);
        }
        bucket.details.push({
          id: disp.id,
          modelCode,
          detail1: `المطبعة: ${disp.shop_name}`,
          detail2: `النوع: ${disp.print_type} • الحالة: ${disp.status}`,
          pieces: disp.pieces_count || 0,
          notes: disp.notes || '',
          timestamp: disp.dispatched_at
        });
      });

      // Update secondary label for printing
      bucketsMap.forEach((bucket) => {
        const receivedCount = bucket.details.filter((d) => d.detail2.includes('تم الاستلام')).length;
        bucket.secondaryValue = `${receivedCount} من ${bucket.operationsCount} مستلم`;
      });
    } else if (selectedSection === 'qc') {
      qcRecords.forEach((rec) => {
        if (!checkDateInRange(rec.created_at)) return;
        const bucketKey = getBucketKey(rec.created_at, selectedPeriod);
        const m = models.find((mod) => mod.id === rec.model_id);
        const modelCode = m?.model_code || 'موديل';

        if (!bucketsMap.has(bucketKey)) {
          bucketsMap.set(bucketKey, {
            periodKey: bucketKey,
            periodLabel: formatPeriodLabel(rec.created_at || bucketKey, selectedPeriod),
            modelsCount: 0,
            modelCodes: [],
            totalPieces: 0,
            secondaryLabel: 'الهوالك والعيوب',
            secondaryValue: 0,
            operationsCount: 0,
            operators: [],
            details: []
          });
        }

        const bucket = bucketsMap.get(bucketKey)!;
        const counted = rec.counted_pieces || rec.good_qty || 0;
        const defects = rec.defect_pieces || rec.defect_qty || 0;

        bucket.totalPieces += counted;
        bucket.secondaryValue = (Number(bucket.secondaryValue) || 0) + defects;
        bucket.operationsCount += 1;
        if (!bucket.modelCodes.includes(modelCode)) {
          bucket.modelCodes.push(modelCode);
        }
        if (rec.inspector_name && !bucket.operators.includes(rec.inspector_name)) {
          bucket.operators.push(rec.inspector_name);
        }
        bucket.details.push({
          id: rec.id,
          modelCode,
          detail1: `مرحلة: ${rec.stage || 'فرز'}`,
          detail2: `مسؤول الجودة: ${rec.inspector_name || '—'} (هوالك: ${defects})`,
          pieces: counted,
          notes: rec.notes || rec.defect_notes || '',
          timestamp: rec.created_at
        });
      });
    } else if (selectedSection === 'sewing') {
      sewingDispatches.forEach((disp) => {
        const dateRef = disp.dispatched_at || disp.expected_delivery_date || '2026-11-01';
        if (!checkDateInRange(dateRef)) return;
        const bucketKey = getBucketKey(dateRef, selectedPeriod);
        const m = models.find((mod) => mod.id === disp.model_id);
        const modelCode = m?.model_code || 'موديل';
        const label = disp.piece_label || (disp.piece_type === 'shirt' ? 'تيشرت' : 'بنطلون');

        if (!bucketsMap.has(bucketKey)) {
          bucketsMap.set(bucketKey, {
            periodKey: bucketKey,
            periodLabel: formatPeriodLabel(dateRef, selectedPeriod),
            modelsCount: 0,
            modelCodes: [],
            totalPieces: 0,
            secondaryLabel: 'توزيع القطع (تيشرت / بنطلون)',
            secondaryValue: '',
            operationsCount: 0,
            operators: [],
            details: []
          });
        }

        const bucket = bucketsMap.get(bucketKey)!;
        bucket.totalPieces += disp.pieces_count || 0;
        bucket.operationsCount += 1;
        if (!bucket.modelCodes.includes(modelCode)) {
          bucket.modelCodes.push(modelCode);
        }
        if (disp.workshop_name && !bucket.operators.includes(disp.workshop_name)) {
          bucket.operators.push(disp.workshop_name);
        }
        bucket.details.push({
          id: disp.id,
          modelCode,
          detail1: `القطعة: [${label}] • ورشة: ${disp.workshop_name}`,
          detail2: `تاريخ الاستلام: ${disp.expected_delivery_date || '—'} (${disp.status})`,
          pieces: disp.pieces_count || 0,
          notes: disp.notes || '',
          timestamp: disp.dispatched_at
        });
      });

      // Update secondary label for sewing
      bucketsMap.forEach((bucket) => {
        const shirtPieces = bucket.details
          .filter((d) => d.detail1.includes('تيشرت'))
          .reduce((acc, d) => acc + d.pieces, 0);
        const pantsPieces = bucket.details
          .filter((d) => d.detail1.includes('بنطلون'))
          .reduce((acc, d) => acc + d.pieces, 0);
        bucket.secondaryValue = `تيشرت: ${shirtPieces.toLocaleString('ar-EG')} • بنطلون: ${pantsPieces.toLocaleString('ar-EG')}`;
      });
    }

    // Set model counts & sort by period descending
    const list = Array.from(bucketsMap.values()).map((b) => ({
      ...b,
      modelsCount: b.modelCodes.length
    }));

    return list.sort((a, b) => b.periodKey.localeCompare(a.periodKey));
  }, [
    selectedSection,
    selectedPeriod,
    dateFrom,
    dateTo,
    cuttingRecords,
    qcRecords,
    printDispatches,
    sewingDispatches,
    models
  ]);

  // Overall Totals
  const overallSummary = useMemo(() => {
    const totalPieces = aggregatedData.reduce((acc, b) => acc + b.totalPieces, 0);
    const allModelsSet = new Set<string>();
    aggregatedData.forEach((b) => b.modelCodes.forEach((code) => allModelsSet.add(code)));
    const totalOperations = aggregatedData.reduce((acc, b) => acc + b.operationsCount, 0);
    const avgPerBucket =
      aggregatedData.length > 0 ? Math.round(totalPieces / aggregatedData.length) : 0;

    return {
      totalPieces,
      totalModels: allModelsSet.size,
      totalOperations,
      avgPerBucket,
      bucketsCount: aggregatedData.length
    };
  }, [aggregatedData]);

  // Section details
  const sectionMeta = {
    cutting: {
      title: 'تقرير قسم القص وخطوط الفرش',
      icon: Scissors,
      color: 'text-rose-600',
      badgeBg: 'bg-rose-50 text-rose-800 border-rose-200'
    },
    printing: {
      title: 'تقرير المطابع والتطريز',
      icon: PrintIcon,
      color: 'text-indigo-600',
      badgeBg: 'bg-indigo-50 text-indigo-800 border-indigo-200'
    },
    qc: {
      title: 'تقرير الفرز ومراقبة الجودة (QC)',
      icon: CheckCircle,
      color: 'text-purple-600',
      badgeBg: 'bg-purple-50 text-purple-800 border-purple-200'
    },
    sewing: {
      title: 'تقرير قسم المكن وخطوط الخياطة',
      icon: Shirt,
      color: 'text-emerald-600',
      badgeBg: 'bg-emerald-50 text-emerald-800 border-emerald-200'
    }
  }[selectedSection];

  const handlePrint = () => {
    window.print();
    logAction('التقارير والإحصائيات', `طباعة ${sectionMeta.title} (${selectedPeriod})`);
  };

  const handleExportCsv = () => {
    if (aggregatedData.length === 0) {
      addFlashMessage('لا توجد بيانات متاحة للتصدير حالياً', 'warning');
      return;
    }

    const headers = [
      'الفترة الزمنية',
      'عدد الموديلات',
      'أكواد الموديلات',
      'إجمالي القطع',
      'المقياس الإضافي',
      'عدد العمليات',
      'المشرفون والورش'
    ];

    const rows = aggregatedData.map((b) => [
      `"${b.periodLabel}"`,
      b.modelsCount,
      `"${b.modelCodes.join(' - ')}"`,
      b.totalPieces,
      `"${b.secondaryValue}"`,
      b.operationsCount,
      `"${b.operators.join(' - ')}"`
    ]);

    const csvContent =
      '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `تقرير_${selectedSection}_${selectedPeriod}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addFlashMessage('تم تصدير ملف التقرير بنجاح', 'success');
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      
      {/* PRINT-ONLY OFFICIAL DOCUMENT HEADER */}
      <div className="hidden print:block text-slate-900 border-b-2 border-slate-900 pb-4 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight">شركة ومصنع الملابس الجاهزة المتكامل</h1>
            <h2 className="text-lg font-bold text-slate-800 mt-0.5">
              وثيقة تقرير الإنتاج والمتابعة الرسمية • {sectionMeta.title}
            </h2>
          </div>
          <div className="text-start text-xs space-y-1 font-semibold">
            <div>التاريخ: {new Date().toLocaleDateString('ar-EG')}</div>
            <div>وقت الاستخراج: {new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</div>
            <div>المستخدم المستخرج: {currentUser?.real_name || 'الإدارة العليا'}</div>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-6 text-xs bg-slate-100 p-2.5 rounded-lg border border-slate-300">
          <div>
            <strong>القسم: </strong>
            <span>{sectionMeta.title}</span>
          </div>
          <div>
            <strong>التجميع الزمني: </strong>
            <span>
              {selectedPeriod === 'daily' ? 'يومي (Daily)' : selectedPeriod === 'weekly' ? 'أسبوعي (Weekly)' : 'شهري (Monthly)'}
            </span>
          </div>
          <div>
            <strong>إجمالي الموديلات: </strong>
            <span>{overallSummary.totalModels} موديل</span>
          </div>
          <div>
            <strong>إجمالي القطع المنفذة: </strong>
            <span className="font-bold text-slate-900">{overallSummary.totalPieces.toLocaleString('ar-EG')} قطعة</span>
          </div>
        </div>
      </div>

      {/* Screen Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 print:hidden">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <BarChart3 className="w-8 h-8 text-amber-600" />
            <span>التقارير والإحصائيات الشاملة (Reports & Analytics)</span>
          </h2>
          <p className="text-slate-500 text-sm mt-0.5">
            مركز المتابعة والتحليل الزمني لمؤشرات إنتاجية الأقسام (القص، المطابع، الفرز، المكن) مع إمكانية التجميع اليومي والأسبوعي والشهري.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            className="px-4 py-2.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs border border-slate-200 transition flex items-center gap-2 cursor-pointer shadow-xs"
            title="تصدير جدول التقرير كملف إكسل CSV"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            <span>تصدير Excel (CSV)</span>
          </button>

          <button
            onClick={handlePrint}
            className="px-5 py-2.5 rounded-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-xs transition flex items-center gap-2 cursor-pointer"
          >
            <Printer className="w-4 h-4 text-amber-400" />
            <span>طباعة التقرير الرسمي</span>
          </button>
        </div>
      </div>

      {/* Control Panel: Filters for Section, Period, and Date Range */}
      <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs space-y-4 print:hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          
          {/* Section Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-slate-400" />
              <span>اختر قسم الإنتاج المطلوب:</span>
            </label>
            <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 p-1 rounded-2xl border border-slate-200">
              <button
                onClick={() => setSelectedSection('cutting')}
                className={`px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-1.5 cursor-pointer ${
                  selectedSection === 'cutting'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Scissors className="w-3.5 h-3.5" />
                <span>تقرير القص</span>
              </button>

              <button
                onClick={() => setSelectedSection('printing')}
                className={`px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-1.5 cursor-pointer ${
                  selectedSection === 'printing'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <PrintIcon className="w-3.5 h-3.5" />
                <span>تقرير المطابع</span>
              </button>

              <button
                onClick={() => setSelectedSection('qc')}
                className={`px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-1.5 cursor-pointer ${
                  selectedSection === 'qc'
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <CheckCircle className="w-3.5 h-3.5" />
                <span>تقرير الفرز والجودة</span>
              </button>

              <button
                onClick={() => setSelectedSection('sewing')}
                className={`px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-1.5 cursor-pointer ${
                  selectedSection === 'sewing'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Shirt className="w-3.5 h-3.5" />
                <span>تقرير المكن والخياطة</span>
              </button>
            </div>
          </div>

          {/* Period Selector (Daily, Weekly, Monthly) */}
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>التجميع الزمني (Time Period):</span>
            </label>
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-2xl border border-slate-200">
              <button
                onClick={() => setSelectedPeriod('daily')}
                className={`px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer ${
                  selectedPeriod === 'daily'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                يومي (Daily)
              </button>
              <button
                onClick={() => setSelectedPeriod('weekly')}
                className={`px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer ${
                  selectedPeriod === 'weekly'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                أسبوعي (Weekly)
              </button>
              <button
                onClick={() => setSelectedPeriod('monthly')}
                className={`px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer ${
                  selectedPeriod === 'monthly'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                شهري (Monthly)
              </button>
            </div>
          </div>

          {/* Date Range Picker */}
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5 flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span>تحديد نطاق التاريخ:</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-amber-500/20"
                placeholder="من"
              />
              <span className="text-slate-400 text-xs">إلى</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-amber-500/20"
                placeholder="إلى"
              />
              {(dateFrom || dateTo) && (
                <button
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                  }}
                  className="p-1.5 rounded-xl bg-slate-200 text-slate-600 hover:bg-slate-300 text-xs font-bold"
                  title="مسح التاريخ"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Mini Dashboard KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-500 mb-1">إجمالي القطع المنفذة</p>
            <h3 className="text-2xl font-black text-slate-900">
              {overallSummary.totalPieces.toLocaleString('ar-EG')}
            </h3>
            <span className="text-[11px] text-emerald-600 font-semibold mt-1 inline-block">
              في {overallSummary.bucketsCount} فترة زمنية
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <Shirt className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-500 mb-1">عدد الموديلات المشغلة</p>
            <h3 className="text-2xl font-black text-indigo-900">
              {overallSummary.totalModels}
            </h3>
            <span className="text-[11px] text-indigo-600 font-semibold mt-1 inline-block">
              موديل فريد خضع للعمليات
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Layers className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-500 mb-1">إجمالي العمليات المسجلة</p>
            <h3 className="text-2xl font-black text-purple-900">
              {overallSummary.totalOperations}
            </h3>
            <span className="text-[11px] text-purple-600 font-semibold mt-1 inline-block">
              حركة تشغيل وتوثيق
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center">
            <TrendingUp className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-500 mb-1">متوسط القطع لكل فترة</p>
            <h3 className="text-2xl font-black text-emerald-800">
              {overallSummary.avgPerBucket.toLocaleString('ar-EG')}
            </h3>
            <span className="text-[11px] text-emerald-600 font-semibold mt-1 inline-block">
              قطعة / {selectedPeriod === 'daily' ? 'يوم' : selectedPeriod === 'weekly' ? 'أسبوع' : 'شهر'}
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <Calendar className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Professional Aggregated Data Table */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden print:border-none print:shadow-none">
        
        {/* Table Top Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/60 print:bg-white print:border-b-2 print:border-slate-800">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-amber-600" />
            <h3 className="font-black text-slate-900 text-base">
              جدول التجميع الزمني — {sectionMeta.title} ({selectedPeriod === 'daily' ? 'يومي' : selectedPeriod === 'weekly' ? 'أسبوعي' : 'شهري'})
            </h3>
          </div>
          <span className="text-xs text-slate-500 font-bold">
            عدد السجلات المجمعة: {aggregatedData.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="bg-slate-100 text-slate-700 font-extrabold border-b border-slate-200 print:bg-slate-200 print:text-black">
              <tr>
                <th className="px-6 py-3.5">الفترة الزمنية (التاريخ / الأسبوع / الشهر)</th>
                <th className="px-6 py-3.5 text-center">عدد الموديلات</th>
                <th className="px-6 py-3.5">أكواد الموديلات المنفذة</th>
                <th className="px-6 py-3.5 text-center">إجمالي عدد القطع</th>
                <th className="px-6 py-3.5 text-center">{aggregatedData[0]?.secondaryLabel || 'المقياس الإضافي'}</th>
                <th className="px-6 py-3.5">المشرفون / الورش المعنية</th>
                <th className="px-6 py-3.5 text-center print:hidden">التفاصيل</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {aggregatedData.length > 0 ? (
                aggregatedData.map((bucket) => {
                  const isExpanded = expandedBucketKey === bucket.periodKey;

                  return (
                    <React.Fragment key={bucket.periodKey}>
                      <tr className="hover:bg-amber-50/40 transition">
                        {/* Period Label */}
                        <td className="px-6 py-4 font-black text-slate-900 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0 print:hidden"></span>
                            <span className="text-sm font-extrabold">{bucket.periodLabel}</span>
                          </div>
                        </td>

                        {/* Models Count */}
                        <td className="px-6 py-4 text-center">
                          <span className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 bg-indigo-50 text-indigo-700 rounded-full font-black text-xs border border-indigo-100">
                            {bucket.modelsCount}
                          </span>
                        </td>

                        {/* Model Codes Badges */}
                        <td className="px-6 py-4 font-bold text-slate-700 max-w-xs">
                          <div className="flex flex-wrap gap-1">
                            {bucket.modelCodes.map((code) => (
                              <span
                                key={code}
                                className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-800 text-[11px] font-extrabold border border-slate-200"
                              >
                                {code}
                              </span>
                            ))}
                          </div>
                        </td>

                        {/* Total Pieces */}
                        <td className="px-6 py-4 text-center font-black text-slate-900 text-sm">
                          <span className="text-emerald-700 font-mono text-base font-black">
                            {bucket.totalPieces.toLocaleString('ar-EG')}
                          </span>{' '}
                          <span className="text-[11px] text-slate-500 font-semibold">قطعة</span>
                        </td>

                        {/* Secondary Metric */}
                        <td className="px-6 py-4 text-center font-bold text-slate-700">
                          <span className="px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs">
                            {bucket.secondaryValue}
                          </span>
                        </td>

                        {/* Operators / Workshops */}
                        <td className="px-6 py-4 text-xs font-semibold text-slate-600 max-w-xs">
                          {bucket.operators.length > 0 ? (
                            <div className="truncate" title={bucket.operators.join('، ')}>
                              {bucket.operators.join('، ')}
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        {/* Expand Details Button */}
                        <td className="px-6 py-4 text-center print:hidden">
                          <button
                            onClick={() =>
                              setExpandedBucketKey(isExpanded ? null : bucket.periodKey)
                            }
                            className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition flex items-center justify-center gap-1 cursor-pointer mx-auto"
                            title="عرض الحركات التفصيلية لهذه الفترة"
                          >
                            <span className="text-[11px]">({bucket.details.length})</span>
                            {isExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </td>
                      </tr>

                      {/* Expandable Drilldown Row */}
                      {isExpanded && (
                        <tr className="bg-slate-50/80 print:hidden">
                          <td colSpan={7} className="px-6 py-4">
                            <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-2">
                              <h5 className="font-black text-xs text-slate-800 flex items-center gap-1.5">
                                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                                <span>تفاصيل الحركات الفردية المندرجة تحت ({bucket.periodLabel}):</span>
                              </h5>
                              <div className="overflow-x-auto">
                                <table className="w-full text-[11px] text-start border border-slate-100 rounded-xl overflow-hidden">
                                  <thead className="bg-slate-100 text-slate-600 font-bold">
                                    <tr>
                                      <th className="py-2 px-3">كود الموديل</th>
                                      <th className="py-2 px-3">البيان الأساسي</th>
                                      <th className="py-2 px-3">التفاصيل والجهة</th>
                                      <th className="py-2 px-3 text-center">القطع</th>
                                      <th className="py-2 px-3">ملاحظات</th>
                                      <th className="py-2 px-3 text-center">التوقيت</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {bucket.details.map((d) => (
                                      <tr key={d.id} className="hover:bg-slate-50">
                                        <td className="py-2 px-3 font-extrabold text-slate-900">{d.modelCode}</td>
                                        <td className="py-2 px-3 font-semibold text-slate-800">{d.detail1}</td>
                                        <td className="py-2 px-3 text-slate-600">{d.detail2}</td>
                                        <td className="py-2 px-3 text-center font-black text-emerald-700 font-mono">
                                          {d.pieces.toLocaleString('ar-EG')} ق
                                        </td>
                                        <td className="py-2 px-3 text-slate-500">{d.notes || '—'}</td>
                                        <td className="py-2 px-3 text-center font-mono text-slate-400">
                                          {d.timestamp ? d.timestamp.slice(11, 16) || d.timestamp : '—'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <AlertCircle className="w-8 h-8 text-slate-300 stroke-1" />
                      <p className="font-bold text-xs text-slate-600">
                        لا توجد حركات مسجلة تطابق التصفية وقسم الإنتاج المحدد.
                      </p>
                      <p className="text-[11px] text-slate-400">
                        جرب تغيير نطاق التاريخ أو اختيار فترة تجميع أخرى.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>

            {/* Total Footer Row */}
            {aggregatedData.length > 0 && (
              <tfoot className="bg-slate-100/90 font-black text-slate-900 border-t-2 border-slate-300 print:bg-slate-200">
                <tr>
                  <td className="px-6 py-4 text-sm font-black">
                    الإجمالي الكلي العام ({aggregatedData.length} فترة)
                  </td>
                  <td className="px-6 py-4 text-center font-black text-indigo-800 text-sm">
                    {overallSummary.totalModels} موديل
                  </td>
                  <td className="px-6 py-4 text-xs text-slate-600">
                    كافة الموديلات النشطة
                  </td>
                  <td className="px-6 py-4 text-center font-mono font-black text-emerald-800 text-base">
                    {overallSummary.totalPieces.toLocaleString('ar-EG')} قطعة
                  </td>
                  <td className="px-6 py-4 text-center text-xs text-slate-700">
                    {overallSummary.totalOperations} عملية تشغيل
                  </td>
                  <td className="px-6 py-4 text-xs text-slate-600">—</td>
                  <td className="px-6 py-4 print:hidden"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* PRINT-ONLY SIGNATURE SECTION */}
      <div className="hidden print:grid grid-cols-3 gap-8 pt-12 mt-8 border-t-2 border-slate-300 text-xs font-bold text-slate-800">
        <div className="text-center space-y-8">
          <p>مشرف قسم التشغيل:</p>
          <p className="font-normal text-slate-400">........................................</p>
        </div>
        <div className="text-center space-y-8">
          <p>إدارة مراقبة الجودة والفرز:</p>
          <p className="font-normal text-slate-400">........................................</p>
        </div>
        <div className="text-center space-y-8">
          <p>اعتماد الإدارة العليا (Sudo):</p>
          <p className="font-normal text-slate-400">........................................</p>
        </div>
      </div>

    </div>
  );
};
