import Decimal from "decimal.js";
import {
  countyProfiles,
  screenCompleteListingPolicy,
  type County,
  type DueDiligence,
  type PropertyListing,
  type TrackedInput,
} from "@/domain";
import type { SaleListingImportDraft } from "./import-types";

export const discoveryPreScreenStatuses = [
  "VIABLE",
  "NEGOTIATE",
  "NOT_VIABLE",
  "NEEDS_DATA",
] as const;

export type DiscoveryPreScreenStatus =
  (typeof discoveryPreScreenStatuses)[number];

export interface DiscoveryPreScreen {
  status: DiscoveryPreScreenStatus;
  label: string;
  reason: string;
  reportedMonthlyGrossRentKsh: string | null;
  requiredMonthlyGrossRentKsh: string | null;
  maximumAllowableOfferKsh: string | null;
  assumptionsLabel: string;
}

const assumptionsLabel =
  "Provisional screen: county cost profile, 70% LTV, 14.5% interest, 15-year amortization, 13% cash-on-cash target, 1.30 DSCR, and 85% stress occupancy.";
const preScreenCache = new Map<string, DiscoveryPreScreen>();

const estimated = <T>(value: T, note: string): TrackedInput<T> => ({
  value,
  status: "estimated",
  note,
});

const missing = <T>(): TrackedInput<T> => ({
  value: null,
  status: "missing",
});

const dueDiligence: DueDiligence = {
  title: missing(),
  planningApprovals: missing(),
  countyRatesAndLandRent: missing(),
  utilityAndServiceArrears: missing(),
  leasesAndRentRoll: missing(),
  structuralCondition: missing(),
};

function normalizeMoney(value: string): Decimal | null {
  const match = value
    .replaceAll(",", "")
    .match(
      /^\s*(?:KSh|KES)\s*(\d+(?:\.\d+)?)\s*(thousand|million|billion|k|m|bn)?\s*$/i,
    );
  if (!match) return null;
  const magnitude = match[2]?.toLowerCase();
  const multiplier =
    magnitude === "thousand" || magnitude === "k"
      ? 1_000
      : magnitude === "million" || magnitude === "m"
        ? 1_000_000
        : magnitude === "billion" || magnitude === "bn"
          ? 1_000_000_000
          : 1;
  const amount = new Decimal(match[1]).mul(multiplier);
  return amount.gt(0) ? amount : null;
}

export function extractReportedMonthlyGrossRent(
  draft: SaleListingImportDraft,
): string | null {
  if (draft.description.status !== "reported" || !draft.description.value) {
    return null;
  }
  const text = draft.description.value.replace(/\s+/g, " ");
  const monthlyPatterns = [
    /(?:monthly\s+(?:gross\s+)?(?:rental\s+)?income|gross\s+monthly\s+rent|monthly\s+rent\s+roll|rental\s+income\s+per\s+month)\s*(?:of|is|at|:|-)?\s*((?:KSh|KES)\s*\d[\d,]*(?:\.\d+)?\s*(?:(?:thousand|million|billion|k|m|bn)\b)?)/i,
    /(?:generat(?:es|ing)|rental\s+income\s+of)\s*((?:KSh|KES)\s*\d[\d,]*(?:\.\d+)?\s*(?:(?:thousand|million|billion|k|m|bn)\b)?)[^.]{0,40}(?:per\s+month|monthly)/i,
  ];
  for (const pattern of monthlyPatterns) {
    const match = text.match(pattern);
    const value = match?.[1];
    if (!match || !value || match.index === undefined) continue;
    const amountEnd = match.index + match[0].lastIndexOf(value) + value.length;
    const amountQualifier = text.slice(amountEnd, amountEnd + 50);
    if (
      /^\s*(?:each\b|per\s+(?:unit|apartment|flat|house|room)\b)/i.test(
        amountQualifier,
      )
    ) {
      continue;
    }
    const amount = normalizeMoney(value);
    if (amount) return amount.toFixed(2);
  }

  const annualValue = text.match(
    /(?:annual\s+(?:gross\s+)?(?:rental\s+)?income|annual\s+rent\s+roll)\s*(?:of|is|at|:|-)?\s*((?:KSh|KES)\s*\d[\d,]*(?:\.\d+)?\s*(?:(?:thousand|million|billion|k|m|bn)\b)?)/i,
  )?.[1];
  const annualAmount = annualValue ? normalizeMoney(annualValue) : null;
  return annualAmount ? annualAmount.div(12).toFixed(2) : null;
}

function totalReportedUnits(draft: SaleListingImportDraft): number | null {
  if (
    draft.unitHints.length === 0 ||
    draft.unitHints.some((hint) => hint.count.value === null)
  ) {
    return null;
  }
  const total = draft.unitHints.reduce(
    (sum, hint) => sum + (hint.count.value ?? 0),
    0,
  );
  return Number.isInteger(total) && total > 0 ? total : null;
}

function screeningListing(
  draft: SaleListingImportDraft,
  county: County,
  totalUnits: number,
  monthlyGrossRent: Decimal,
): PropertyListing {
  const profile = countyProfiles[county];
  const askingPrice = new Decimal(draft.askingPriceKsh.value!);
  const fixedAcquisitionCosts = Decimal.max(350_000, askingPrice.mul("0.005"));
  return {
    id: `pre-screen-${draft.extractedRecordSha256.slice(0, 24)}`,
    title: draft.title.value ?? "Discovery pre-screen",
    address: draft.address.value ?? "",
    county,
    submarket: draft.submarket.value ?? "",
    askingPriceKsh: estimated(
      askingPrice.toFixed(2),
      "Source asking price used for provisional screening",
    ),
    unitMix: [
      {
        id: "aggregate-gross-rent",
        label: "Whole property gross rent",
        count: estimated(1, `${totalUnits} source-reported units aggregated`),
        monthlyRentKsh: estimated(
          monthlyGrossRent.toFixed(2),
          "Source-reported or required gross monthly rent",
        ),
      },
    ],
    operatingCosts: {
      annualFixedKsh: estimated(
        new Decimal(profile.suggested.annualFixedOperatingCostPerUnitKsh)
          .mul(totalUnits)
          .toFixed(2),
        profile.label,
      ),
      variablePercentOfEgi: estimated(
        profile.suggested.variablePercentOfEgi,
        profile.label,
      ),
    },
    acquisitionCosts: {
      percentOfPrice: estimated(
        profile.suggested.acquisitionPercentOfPrice,
        profile.label,
      ),
      fixedKsh: estimated(
        fixedAcquisitionCosts.toFixed(2),
        "Provisional legal, valuation, and diligence allowance",
      ),
      financingPercentOfDebt: estimated(
        profile.suggested.financingPercentOfDebt,
        profile.label,
      ),
      financingFixedKsh: estimated(
        "150000",
        "Provisional financing legal-cost allowance",
      ),
      initialReservesKsh: estimated(
        monthlyGrossRent.mul(3).toFixed(2),
        "Three months of gross rent for provisional reserves",
      ),
    },
    loanTerms: {
      maximumLtv: estimated("0.70", "MaliScope provisional screen"),
      annualInterestRate: estimated("0.145", "MaliScope provisional screen"),
      amortizationYears: estimated(15, "MaliScope provisional screen"),
    },
    assumptions: {
      baseOccupancy: estimated(profile.suggested.baseOccupancy, profile.label),
      collectionLoss: estimated(
        profile.suggested.collectionLoss,
        profile.label,
      ),
      otherIncomeAnnualKsh: estimated(
        "0",
        "No other income used in provisional screen",
      ),
      minimumDscr: estimated("1.30", "MaliScope default policy"),
      minimumCashOnCash: estimated("0.13", "MaliScope default policy"),
      stressOccupancy: estimated("0.85", "MaliScope default policy"),
      minimumStressMonthlyCashFlowKsh: estimated(
        "1",
        "Strictly positive stressed cash flow",
      ),
    },
    dueDiligence,
    provenance: {
      adapter: draft.sourceId,
      externalId: draft.externalId,
      sourceUrl: draft.sourceUrl,
      capturedAt: draft.capturedAt,
      permissionBasis: "Approved-source provisional discovery screen",
      rawReference: `sha256:${draft.extractedRecordSha256}`,
    },
    createdAt: draft.capturedAt,
    updatedAt: draft.capturedAt,
  };
}

function requiredMonthlyRent(
  draft: SaleListingImportDraft,
  county: County,
  totalUnits: number,
): Decimal | null {
  const askingPrice = new Decimal(draft.askingPriceKsh.value!);
  let low = new Decimal(0);
  let high = Decimal.max(100_000, askingPrice.mul("0.01"));
  let highAnalysis: ReturnType<typeof screenCompleteListingPolicy> | null =
    null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    highAnalysis = screenCompleteListingPolicy(
      screeningListing(draft, county, totalUnits, high),
    );
    if (highAnalysis.recommendation === "BUY") break;
    high = high.mul(2);
  }
  if (highAnalysis?.recommendation !== "BUY") return null;

  while (high.minus(low).gt(1_000)) {
    const middle = low.plus(high).div(2);
    const analysis = screenCompleteListingPolicy(
      screeningListing(draft, county, totalUnits, middle),
    );
    if (analysis.recommendation === "BUY") high = middle;
    else low = middle;
  }
  return high.div(1_000).ceil().mul(1_000);
}

function unavailable(reason: string): DiscoveryPreScreen {
  return {
    status: "NEEDS_DATA",
    label: "NEEDS DATA",
    reason,
    reportedMonthlyGrossRentKsh: null,
    requiredMonthlyGrossRentKsh: null,
    maximumAllowableOfferKsh: null,
    assumptionsLabel,
  };
}

function calculatePreScreen(draft: SaleListingImportDraft): DiscoveryPreScreen {
  if (!draft.askingPriceKsh.value) {
    return unavailable("Asking price is required for a viability pre-screen.");
  }
  if (!draft.county.value) {
    return unavailable("County is required to select provisional cost inputs.");
  }
  const totalUnits = totalReportedUnits(draft);
  if (!totalUnits) {
    return unavailable(
      "A complete source-reported unit count is required for the cost screen.",
    );
  }

  const requiredRent = requiredMonthlyRent(
    draft,
    draft.county.value,
    totalUnits,
  );
  const reportedRent = extractReportedMonthlyGrossRent(draft);
  if (!reportedRent) {
    return {
      ...unavailable(
        requiredRent
          ? "Gross monthly rent is not explicitly reported; compare verified rent against the threshold below."
          : "Gross monthly rent is required and no feasible threshold could be derived.",
      ),
      requiredMonthlyGrossRentKsh: requiredRent?.toFixed(2) ?? null,
    };
  }

  const analysis = screenCompleteListingPolicy(
    screeningListing(
      draft,
      draft.county.value,
      totalUnits,
      new Decimal(reportedRent),
    ),
  );
  const base = {
    reportedMonthlyGrossRentKsh: reportedRent,
    requiredMonthlyGrossRentKsh: requiredRent?.toFixed(2) ?? null,
    maximumAllowableOfferKsh: analysis.maximumAllowableOfferKsh,
    assumptionsLabel,
  };
  if (analysis.recommendation === "BUY") {
    return {
      ...base,
      status: "VIABLE",
      label: "PROVISIONALLY VIABLE",
      reason:
        "Reported gross rent passes the provisional policy screen at the asking price.",
    };
  }

  if (analysis.recommendation === "NEGOTIATE_TO_KSH_X_OR_BELOW") {
    return {
      ...base,
      status: "NEGOTIATE",
      label: "NEGOTIATE",
      reason:
        "Reported gross rent does not pass at the asking price, but a lower provisional MAO is feasible.",
    };
  }
  return {
    ...base,
    status: "NOT_VIABLE",
    label: "NOT VIABLE",
    reason:
      analysis.recommendation === "REJECT"
        ? "No positive offer passes the provisional policy screen."
        : "Required screening inputs remain incomplete.",
  };
}

export function preScreenDiscoveryDraft(
  draft: SaleListingImportDraft,
): DiscoveryPreScreen {
  const cacheKey = JSON.stringify({
    extractedRecordSha256: draft.extractedRecordSha256,
    askingPriceKsh: draft.askingPriceKsh,
    county: draft.county,
    description: draft.description,
    unitHints: draft.unitHints.map((hint) => ({
      label: hint.label,
      count: hint.count,
    })),
  });
  const cached = preScreenCache.get(cacheKey);
  if (cached) return cached;
  const result = calculatePreScreen(draft);
  if (preScreenCache.size >= 1_000) {
    const oldestKey = preScreenCache.keys().next().value;
    if (oldestKey) preScreenCache.delete(oldestKey);
  }
  preScreenCache.set(cacheKey, result);
  return result;
}
