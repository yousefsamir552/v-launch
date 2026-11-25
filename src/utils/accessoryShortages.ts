import { AccessoryItem, Supplier } from '../types';

export interface AccessoryShortageEntry {
  item: AccessoryItem;
  supplier?: Supplier;
  available: number;
  threshold: number;
  deficit: number;
}

/**
 * حساب نواقص مخزن الإكسسوارات بنفس منطق الباك إند:
 * - يستبعد أصناف الرصيد السابق/المرحّل (carryover).
 * - لأصناف الموديل المخصص (custom_model): يستبعد المسحوب بالكامل ويحسب (المستهدف - المورّد).
 * - لأصناف الرصيد المستمر (stock): يستبعد حد التنبيه <= 0 ويحسب العجز عند available < threshold.
 */
export function computeAccessoryShortages(
  accessoryItems: AccessoryItem[],
  suppliers: Supplier[]
): AccessoryShortageEntry[] {
  const results: AccessoryShortageEntry[] = [];

  for (const item of accessoryItems || []) {
    if (item.usage_type === 'carryover') continue;

    const supplier = suppliers.find((s) => s.id === item.supplier_id);
    const available = Number(((Number(item.quantity) || 0) - (Number(item.reserved_quantity) || 0)).toFixed(2));

    if (item.usage_type === 'custom_model') {
      if (item.withdrawn_for_model) continue;
      const targetReq = Number(item.target_quantity ?? item.min_threshold ?? 0);
      const supplied = Number(item.delivered_quantity ?? item.quantity ?? 0);
      const deficit = Math.max(0, Number((targetReq - supplied).toFixed(3)));
      if (deficit > 0) {
        results.push({
          item,
          supplier,
          available,
          threshold: targetReq,
          deficit
        });
      }
    } else {
      const threshold = Number(item.min_threshold ?? 0);
      if (threshold <= 0) continue;
      const deficit = Math.max(0, Number((threshold - available).toFixed(3)));
      if (available < threshold && deficit > 0) {
        results.push({
          item,
          supplier,
          available,
          threshold,
          deficit
        });
      }
    }
  }

  return results;
}
