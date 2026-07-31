export const counties = [
  "Nairobi",
  "Kiambu",
  "Kajiado",
  "Nakuru",
  "Mombasa",
] as const;

export type County = (typeof counties)[number];
export type InputStatus = "reported" | "estimated" | "missing";
export type Money = string;
export type DecimalRate = string;

export interface TrackedInput<T> {
  value: T | null;
  status: InputStatus;
  note?: string;
  sourceReference?: string;
}

export interface UnitMix {
  id: string;
  label: string;
  count: TrackedInput<number>;
  monthlyRentKsh: TrackedInput<Money>;
}

export interface SourceProvenance {
  adapter: string;
  externalId: string | null;
  sourceUrl: string | null;
  capturedAt: string;
  permissionBasis: string;
  rawReference?: string;
}

export interface OperatingCosts {
  annualFixedKsh: TrackedInput<Money>;
  variablePercentOfEgi: TrackedInput<DecimalRate>;
}

export interface AcquisitionCosts {
  percentOfPrice: TrackedInput<DecimalRate>;
  fixedKsh: TrackedInput<Money>;
  financingPercentOfDebt: TrackedInput<DecimalRate>;
  financingFixedKsh: TrackedInput<Money>;
  initialReservesKsh: TrackedInput<Money>;
}

export interface LoanTerms {
  maximumLtv: TrackedInput<DecimalRate>;
  annualInterestRate: TrackedInput<DecimalRate>;
  amortizationYears: TrackedInput<number>;
}

export interface UnderwritingAssumptions {
  baseOccupancy: TrackedInput<DecimalRate>;
  collectionLoss: TrackedInput<DecimalRate>;
  otherIncomeAnnualKsh: TrackedInput<Money>;
  minimumDscr: TrackedInput<DecimalRate>;
  minimumCashOnCash: TrackedInput<DecimalRate>;
  stressOccupancy: TrackedInput<DecimalRate>;
  minimumStressMonthlyCashFlowKsh: TrackedInput<Money>;
}

export type DueDiligenceKey =
  | "title"
  | "planningApprovals"
  | "countyRatesAndLandRent"
  | "utilityAndServiceArrears"
  | "leasesAndRentRoll"
  | "structuralCondition";

export type DueDiligence = Record<DueDiligenceKey, TrackedInput<boolean>>;

export interface PropertyListing {
  id: string;
  title: string;
  address: string;
  county: County;
  submarket: string;
  askingPriceKsh: TrackedInput<Money>;
  unitMix: UnitMix[];
  operatingCosts: OperatingCosts;
  acquisitionCosts: AcquisitionCosts;
  loanTerms: LoanTerms;
  assumptions: UnderwritingAssumptions;
  dueDiligence: DueDiligence;
  provenance: SourceProvenance;
  createdAt: string;
  updatedAt: string;
}

export interface ScenarioDefinition {
  id: "base" | "conservative" | "severe";
  label: string;
  occupancy: DecimalRate;
  rentFactor: DecimalRate;
  expenseFactor: DecimalRate;
  collectionLossFactor: DecimalRate;
  qualificationScenario: boolean;
}

export type FormulaKey =
  | "grossPotentialRent"
  | "effectiveGrossIncome"
  | "operatingExpenses"
  | "noi"
  | "monthlyLoanPayment"
  | "dscr"
  | "monthlyPostDebtCashFlow"
  | "breakEvenOccupancy"
  | "totalCashInvested"
  | "cashOnCashReturn";

export interface FormulaAudit {
  key: FormulaKey;
  formula: string;
  inputs: Record<string, string>;
  result: string | null;
}

export interface ScenarioResult {
  scenarioId: ScenarioDefinition["id"];
  label: string;
  grossPotentialRentAnnualKsh: Money;
  effectiveGrossIncomeAnnualKsh: Money;
  operatingExpensesAnnualKsh: Money;
  noiAnnualKsh: Money;
  debtPrincipalKsh: Money;
  monthlyLoanPaymentKsh: Money;
  annualDebtServiceKsh: Money;
  dscr: DecimalRate | null;
  monthlyPostDebtCashFlowKsh: Money;
  breakEvenOccupancy: DecimalRate | null;
  totalCashInvestedKsh: Money;
  cashOnCashReturn: DecimalRate | null;
  audits: FormulaAudit[];
}

export type DebtConstraint = "LTV" | "MIN_DSCR" | "POSITIVE_STRESS_CASH_FLOW";

export interface DebtCapacity {
  maximumDebtKsh: Money;
  capsKsh: Record<DebtConstraint, Money>;
  bindingConstraints: DebtConstraint[];
}

export type Recommendation =
  "BUY" | "NEGOTIATE_TO_KSH_X_OR_BELOW" | "REJECT" | "NEEDS_DATA";

export interface CompletenessResult {
  score: number;
  label: "high" | "medium" | "low";
  reportedCount: number;
  estimatedCount: number;
  missingCount: number;
}

export interface AnalysisResult {
  listingId: string;
  analyzedAt: string;
  recommendation: Recommendation;
  recommendationLabel: string;
  maximumAllowableOfferKsh: Money | null;
  offerBindingConstraint: "MIN_CASH_ON_CASH" | "NO_FEASIBLE_OFFER" | null;
  debtCapacity: DebtCapacity | null;
  scenarios: ScenarioResult[];
  reasons: string[];
  warnings: string[];
  missingFields: string[];
  dueDiligenceFields: string[];
  completeness: CompletenessResult;
  policy: {
    minimumDscr: DecimalRate | null;
    minimumCashOnCash: DecimalRate | null;
    stressOccupancy: DecimalRate | null;
    appreciationIncluded: false;
  };
}

export interface CountyProfile {
  county: County;
  label: string;
  provisional: true;
  asOf: string;
  suggested: {
    baseOccupancy: DecimalRate;
    collectionLoss: DecimalRate;
    annualFixedOperatingCostPerUnitKsh: Money;
    variablePercentOfEgi: DecimalRate;
    acquisitionPercentOfPrice: DecimalRate;
    financingPercentOfDebt: DecimalRate;
  };
  caveat: string;
}
