import type { DiscoveryRecord } from "./discovery-types";

export interface DiscoveryPropertyFilters {
  propertyType: string;
  minimumPriceKsh: number | null;
  maximumPriceKsh: number | null;
}

export function filterDiscoveryRecords(
  records: DiscoveryRecord[],
  filters: DiscoveryPropertyFilters,
): DiscoveryRecord[] {
  return records.filter((record) => {
    if (
      filters.propertyType &&
      record.draft.propertyType.value !== filters.propertyType
    ) {
      return false;
    }

    if (filters.minimumPriceKsh === null && filters.maximumPriceKsh === null) {
      return true;
    }

    const price = record.askingPriceKsh
      ? Number(record.askingPriceKsh)
      : Number.NaN;
    if (!Number.isFinite(price)) return false;
    if (filters.minimumPriceKsh !== null && price < filters.minimumPriceKsh) {
      return false;
    }
    if (filters.maximumPriceKsh !== null && price > filters.maximumPriceKsh) {
      return false;
    }
    return true;
  });
}
