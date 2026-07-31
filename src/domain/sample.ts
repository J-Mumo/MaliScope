import type { DueDiligence, PropertyListing, TrackedInput } from "./types";

const reported = <T>(
  value: T,
  note?: string,
  sourceReference?: string,
): TrackedInput<T> => ({
  value,
  status: "reported",
  ...(note ? { note } : {}),
  ...(sourceReference ? { sourceReference } : {}),
});

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
  leasesAndRentRoll: estimated(
    false,
    "Sample listing; rent roll not yet verified",
  ),
  structuralCondition: missing(),
};

export const seededListing: PropertyListing = {
  id: "sample-kilimani-18",
  title: "18-unit apartment block (sample)",
  address: "Kilimani, Nairobi",
  county: "Nairobi",
  submarket: "Kilimani",
  askingPriceKsh: reported(
    "92000000",
    "Illustrative seller asking price",
    "sample-manual-record",
  ),
  unitMix: [
    {
      id: "one-bedroom",
      label: "1 bedroom",
      count: reported(10, "Illustrative unit schedule"),
      monthlyRentKsh: reported(
        "60000",
        "Illustrative asking rent; verify rent roll",
      ),
    },
    {
      id: "two-bedroom",
      label: "2 bedroom",
      count: reported(8, "Illustrative unit schedule"),
      monthlyRentKsh: reported(
        "85000",
        "Illustrative asking rent; verify rent roll",
      ),
    },
  ],
  operatingCosts: {
    annualFixedKsh: estimated(
      "2100000",
      "Provisional maintenance, management, security, insurance, and rates envelope",
    ),
    variablePercentOfEgi: estimated("0.08", "Nairobi provisional profile"),
  },
  acquisitionCosts: {
    percentOfPrice: estimated(
      "0.065",
      "Planning allowance for transfer-related costs; obtain professional quote",
    ),
    fixedKsh: estimated(
      "350000",
      "Legal, valuation, and technical diligence allowance",
    ),
    financingPercentOfDebt: estimated("0.02", "Illustrative lender fees"),
    financingFixedKsh: estimated(
      "150000",
      "Illustrative financing legal costs",
    ),
    initialReservesKsh: estimated(
      "2000000",
      "Initial operating and repair reserve",
    ),
  },
  loanTerms: {
    maximumLtv: estimated("0.7", "Illustrative lender ceiling"),
    annualInterestRate: estimated(
      "0.145",
      "Illustrative rate; obtain lender quote",
    ),
    amortizationYears: estimated(15, "Illustrative amortization"),
  },
  assumptions: {
    baseOccupancy: estimated("0.92", "Nairobi provisional profile"),
    collectionLoss: estimated("0.03", "Nairobi provisional profile"),
    otherIncomeAnnualKsh: reported("0", "No other income reported"),
    minimumDscr: reported("1.30", "MaliScope default investment policy"),
    minimumCashOnCash: reported("0.13", "User-adjustable 12–15% policy target"),
    stressOccupancy: reported("0.85", "MaliScope default investment policy"),
    minimumStressMonthlyCashFlowKsh: reported(
      "1",
      "Strictly positive policy-stress cash flow",
    ),
  },
  dueDiligence,
  provenance: {
    adapter: "sample",
    externalId: "kilimani-18",
    sourceUrl: null,
    capturedAt: "2026-07-31T09:00:00.000Z",
    permissionBasis: "Bundled synthetic sample; no portal data",
    rawReference: "README seeded example",
  },
  createdAt: "2026-07-31T09:00:00.000Z",
  updatedAt: "2026-07-31T09:00:00.000Z",
};
