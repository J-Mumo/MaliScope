import type { InputStatus } from "@/domain";
import type { DiscoveryRecord } from "./discovery-types";
import type { ImportedField } from "./import-types";
import type { DiscoveryPreScreenStatus } from "./pre-screen";

const viabilityRank: Record<DiscoveryPreScreenStatus, number> = {
  VIABLE: 0,
  NEGOTIATE: 1,
  NOT_VIABLE: 2,
  NEEDS_DATA: 3,
};

function fieldScore(field: ImportedField<unknown>): number {
  const weights: Record<InputStatus, number> = {
    reported: 1,
    estimated: 0.55,
    missing: 0,
  };
  return weights[field.status];
}

export function discoveryDataCompleteness(record: DiscoveryRecord): number {
  const draft = record.draft;
  const fields: ImportedField<unknown>[] = [
    draft.title,
    draft.description,
    draft.askingPriceKsh,
    draft.address,
    draft.county,
    draft.submarket,
    draft.propertyType,
    draft.bedrooms,
  ];
  const fieldTotal = fields.reduce(
    (total, field) => total + fieldScore(field),
    0,
  );
  const unitMixScore =
    draft.unitHints.length === 0
      ? 0
      : draft.unitHints.reduce(
          (total, hint) => total + fieldScore(hint.count),
          0,
        ) / draft.unitHints.length;
  const grossRentScore = record.preScreen?.reportedMonthlyGrossRentKsh ? 1 : 0;
  return Math.round(((fieldTotal + unitMixScore + grossRentScore) / 10) * 100);
}

export function compareDiscoveryRecords(
  left: DiscoveryRecord,
  right: DiscoveryRecord,
): number {
  const leftStatus = left.preScreen?.status ?? "NEEDS_DATA";
  const rightStatus = right.preScreen?.status ?? "NEEDS_DATA";
  const viabilityDifference =
    viabilityRank[leftStatus] - viabilityRank[rightStatus];
  if (viabilityDifference !== 0) return viabilityDifference;

  const completenessDifference =
    discoveryDataCompleteness(right) - discoveryDataCompleteness(left);
  if (completenessDifference !== 0) return completenessDifference;

  const freshnessDifference =
    new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime();
  if (freshnessDifference !== 0) return freshnessDifference;

  const titleDifference = (left.title ?? "").localeCompare(right.title ?? "");
  return titleDifference !== 0
    ? titleDifference
    : left.id.localeCompare(right.id);
}

export function sortDiscoveryRecords(
  records: DiscoveryRecord[],
): DiscoveryRecord[] {
  return [...records].sort(compareDiscoveryRecords);
}
