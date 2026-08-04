import type { County, PropertyListing, TrackedInput } from "@/domain";
import type { SaleListingImportDraft } from "./import-types";
import { getSourceById, isSourceApproved } from "./registry";

const missing = <T>(): TrackedInput<T> => ({
  value: null,
  status: "missing",
});

const reported = <T>(
  value: T,
  note: string,
  sourceReference?: string,
): TrackedInput<T> => ({
  value,
  status: "reported",
  note,
  ...(sourceReference ? { sourceReference } : {}),
});

export function confirmDraftCounty(
  draft: SaleListingImportDraft,
  county: County,
): SaleListingImportDraft {
  return {
    ...draft,
    county: {
      value: county,
      status: "reported",
      evidence: "Human-confirmed during MaliScope discovery review",
    },
  };
}

export function promoteDraftToListing(
  draft: SaleListingImportDraft,
): PropertyListing {
  const source = getSourceById(draft.sourceId);
  if (!isSourceApproved(source)) {
    throw new Error(`${source.displayName} is not approved for promotion.`);
  }
  if (!draft.county.value || draft.county.status !== "reported") {
    throw new Error(
      "The source must explicitly report a supported county before promotion.",
    );
  }
  const sourceReference = draft.sourceUrl;

  return {
    id: `discovered-${draft.extractedRecordSha256.slice(0, 24)}`,
    title: draft.title.value ?? "Imported sale listing",
    address: draft.address.value ?? "",
    county: draft.county.value,
    submarket: draft.submarket.value ?? "",
    askingPriceKsh: draft.askingPriceKsh.value
      ? reported(
          draft.askingPriceKsh.value,
          draft.askingPriceKsh.evidence ?? "Source asking price",
          sourceReference,
        )
      : missing(),
    unitMix:
      draft.unitHints.length > 0
        ? draft.unitHints.map((hint, index) => ({
            id: `source-unit-${index + 1}`,
            label: hint.label,
            count: hint.count.value
              ? reported(
                  hint.count.value,
                  hint.count.evidence ?? "Source unit count",
                  sourceReference,
                )
              : missing(),
            monthlyRentKsh: missing(),
          }))
        : [
            {
              id: "source-unit-unknown",
              label: "Unit mix not reported",
              count: missing(),
              monthlyRentKsh: missing(),
            },
          ],
    operatingCosts: {
      annualFixedKsh: missing(),
      variablePercentOfEgi: missing(),
    },
    acquisitionCosts: {
      percentOfPrice: missing(),
      fixedKsh: missing(),
      financingPercentOfDebt: missing(),
      financingFixedKsh: missing(),
      initialReservesKsh: missing(),
    },
    loanTerms: {
      maximumLtv: missing(),
      annualInterestRate: missing(),
      amortizationYears: missing(),
    },
    assumptions: {
      baseOccupancy: missing(),
      collectionLoss: missing(),
      otherIncomeAnnualKsh: missing(),
      minimumDscr: reported("1.30", "MaliScope default investment policy"),
      minimumCashOnCash: reported(
        "0.13",
        "MaliScope default investment policy",
      ),
      stressOccupancy: reported("0.85", "MaliScope default investment policy"),
      minimumStressMonthlyCashFlowKsh: reported(
        "1",
        "Strictly positive policy-stress cash flow",
      ),
    },
    dueDiligence: {
      title: missing(),
      planningApprovals: missing(),
      countyRatesAndLandRent: missing(),
      utilityAndServiceArrears: missing(),
      leasesAndRentRoll: missing(),
      structuralCondition: missing(),
    },
    provenance: {
      adapter: draft.sourceId,
      externalId: draft.externalId,
      sourceUrl: draft.sourceUrl,
      capturedAt: draft.capturedAt,
      permissionBasis: source.permissionBasis,
      rawReference: `sha256:${draft.extractedRecordSha256}`,
    },
    createdAt: draft.capturedAt,
    updatedAt: draft.capturedAt,
  };
}
