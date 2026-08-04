import Decimal from "decimal.js";
import { buildScenarios } from "./profiles";
import { propertyListingSchema } from "./schemas";
import type {
  AnalysisResult,
  CompletenessResult,
  DebtCapacity,
  DebtConstraint,
  FormulaAudit,
  PropertyListing,
  ScenarioDefinition,
  ScenarioResult,
  TrackedInput,
} from "./types";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

const ZERO = new Decimal(0);
const ONE = new Decimal(1);
const MONTHS_PER_YEAR = new Decimal(12);

interface RequiredValue {
  path: string;
  label: string;
  input: TrackedInput<unknown>;
}

interface Economics {
  grossPotentialRent: Decimal;
  effectiveGrossIncome: Decimal;
  fixedOperatingExpenses: Decimal;
  variableOperatingExpenses: Decimal;
  operatingExpenses: Decimal;
  noi: Decimal;
  adjustedCollectionLoss: Decimal;
}

interface ResolvedInputs {
  price: Decimal;
  annualFixedCosts: Decimal;
  variableExpenseRate: Decimal;
  acquisitionRate: Decimal;
  acquisitionFixed: Decimal;
  financingRate: Decimal;
  financingFixed: Decimal;
  reserves: Decimal;
  ltv: Decimal;
  annualInterestRate: Decimal;
  amortizationYears: number;
  baseOccupancy: Decimal;
  collectionLoss: Decimal;
  otherIncome: Decimal;
  minimumDscr: Decimal;
  minimumCashOnCash: Decimal;
  stressOccupancy: Decimal;
  minimumStressMonthlyCashFlow: Decimal;
}

function decimal(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

function money(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2);
}

function rate(value: Decimal): string {
  return value.toDecimalPlaces(6, Decimal.ROUND_HALF_EVEN).toFixed(6);
}

function requiredValues(listing: PropertyListing): RequiredValue[] {
  const values: RequiredValue[] = [
    {
      path: "askingPriceKsh",
      label: "Asking price",
      input: listing.askingPriceKsh,
    },
    {
      path: "operatingCosts.annualFixedKsh",
      label: "Annual fixed operating costs",
      input: listing.operatingCosts.annualFixedKsh,
    },
    {
      path: "operatingCosts.variablePercentOfEgi",
      label: "Variable operating cost rate",
      input: listing.operatingCosts.variablePercentOfEgi,
    },
    {
      path: "acquisitionCosts.percentOfPrice",
      label: "Acquisition cost rate",
      input: listing.acquisitionCosts.percentOfPrice,
    },
    {
      path: "acquisitionCosts.fixedKsh",
      label: "Fixed acquisition costs",
      input: listing.acquisitionCosts.fixedKsh,
    },
    {
      path: "acquisitionCosts.financingPercentOfDebt",
      label: "Financing cost rate",
      input: listing.acquisitionCosts.financingPercentOfDebt,
    },
    {
      path: "acquisitionCosts.financingFixedKsh",
      label: "Fixed financing costs",
      input: listing.acquisitionCosts.financingFixedKsh,
    },
    {
      path: "acquisitionCosts.initialReservesKsh",
      label: "Initial reserves",
      input: listing.acquisitionCosts.initialReservesKsh,
    },
    {
      path: "loanTerms.maximumLtv",
      label: "Maximum LTV",
      input: listing.loanTerms.maximumLtv,
    },
    {
      path: "loanTerms.annualInterestRate",
      label: "Annual interest rate",
      input: listing.loanTerms.annualInterestRate,
    },
    {
      path: "loanTerms.amortizationYears",
      label: "Amortization term",
      input: listing.loanTerms.amortizationYears,
    },
    {
      path: "assumptions.baseOccupancy",
      label: "Base occupancy",
      input: listing.assumptions.baseOccupancy,
    },
    {
      path: "assumptions.collectionLoss",
      label: "Collection loss",
      input: listing.assumptions.collectionLoss,
    },
    {
      path: "assumptions.otherIncomeAnnualKsh",
      label: "Annual other income",
      input: listing.assumptions.otherIncomeAnnualKsh,
    },
    {
      path: "assumptions.minimumDscr",
      label: "Minimum DSCR",
      input: listing.assumptions.minimumDscr,
    },
    {
      path: "assumptions.minimumCashOnCash",
      label: "Minimum cash-on-cash return",
      input: listing.assumptions.minimumCashOnCash,
    },
    {
      path: "assumptions.stressOccupancy",
      label: "Policy stress occupancy",
      input: listing.assumptions.stressOccupancy,
    },
    {
      path: "assumptions.minimumStressMonthlyCashFlowKsh",
      label: "Minimum stressed monthly cash flow",
      input: listing.assumptions.minimumStressMonthlyCashFlowKsh,
    },
  ];

  listing.unitMix.forEach((unit, index) => {
    values.push(
      {
        path: `unitMix.${index}.count`,
        label: `${unit.label} unit count`,
        input: unit.count,
      },
      {
        path: `unitMix.${index}.monthlyRentKsh`,
        label: `${unit.label} monthly rent`,
        input: unit.monthlyRentKsh,
      },
    );
  });

  return values;
}

function allTrackedValues(listing: PropertyListing): TrackedInput<unknown>[] {
  return [
    ...requiredValues(listing).map(({ input }) => input),
    ...Object.values(listing.dueDiligence),
  ];
}

function completeness(listing: PropertyListing): CompletenessResult {
  const tracked = allTrackedValues(listing);
  const reportedCount = tracked.filter(
    (input) => input.status === "reported",
  ).length;
  const estimatedCount = tracked.filter(
    (input) => input.status === "estimated",
  ).length;
  const missingCount = tracked.filter(
    (input) => input.status === "missing",
  ).length;
  const score =
    tracked.length === 0
      ? 0
      : Math.round(
          ((reportedCount + estimatedCount * 0.55) / tracked.length) * 100,
        );

  return {
    score,
    label: score >= 80 ? "high" : score >= 55 ? "medium" : "low",
    reportedCount,
    estimatedCount,
    missingCount,
  };
}

function resolve(listing: PropertyListing): ResolvedInputs {
  return {
    price: decimal(listing.askingPriceKsh.value!),
    annualFixedCosts: decimal(listing.operatingCosts.annualFixedKsh.value!),
    variableExpenseRate: decimal(
      listing.operatingCosts.variablePercentOfEgi.value!,
    ),
    acquisitionRate: decimal(listing.acquisitionCosts.percentOfPrice.value!),
    acquisitionFixed: decimal(listing.acquisitionCosts.fixedKsh.value!),
    financingRate: decimal(
      listing.acquisitionCosts.financingPercentOfDebt.value!,
    ),
    financingFixed: decimal(listing.acquisitionCosts.financingFixedKsh.value!),
    reserves: decimal(listing.acquisitionCosts.initialReservesKsh.value!),
    ltv: decimal(listing.loanTerms.maximumLtv.value!),
    annualInterestRate: decimal(listing.loanTerms.annualInterestRate.value!),
    amortizationYears: listing.loanTerms.amortizationYears.value!,
    baseOccupancy: decimal(listing.assumptions.baseOccupancy.value!),
    collectionLoss: decimal(listing.assumptions.collectionLoss.value!),
    otherIncome: decimal(listing.assumptions.otherIncomeAnnualKsh.value!),
    minimumDscr: decimal(listing.assumptions.minimumDscr.value!),
    minimumCashOnCash: decimal(listing.assumptions.minimumCashOnCash.value!),
    stressOccupancy: decimal(listing.assumptions.stressOccupancy.value!),
    minimumStressMonthlyCashFlow: decimal(
      listing.assumptions.minimumStressMonthlyCashFlowKsh.value!,
    ),
  };
}

function grossPotentialRent(listing: PropertyListing): Decimal {
  return listing.unitMix.reduce(
    (total, unit) =>
      total.plus(
        decimal(unit.count.value!)
          .mul(decimal(unit.monthlyRentKsh.value!))
          .mul(MONTHS_PER_YEAR),
      ),
    ZERO,
  );
}

function scenarioEconomics(
  listing: PropertyListing,
  inputs: ResolvedInputs,
  scenario: ScenarioDefinition,
): Economics {
  const grossRent = grossPotentialRent(listing).mul(
    decimal(scenario.rentFactor),
  );
  const adjustedCollectionLoss = Decimal.min(
    ONE,
    inputs.collectionLoss.mul(decimal(scenario.collectionLossFactor)),
  );
  const effectiveGrossIncome = grossRent
    .mul(decimal(scenario.occupancy))
    .mul(ONE.minus(adjustedCollectionLoss))
    .plus(inputs.otherIncome);
  const fixedOperatingExpenses = inputs.annualFixedCosts.mul(
    decimal(scenario.expenseFactor),
  );
  const variableOperatingExpenses = effectiveGrossIncome.mul(
    inputs.variableExpenseRate,
  );
  const operatingExpenses = fixedOperatingExpenses.plus(
    variableOperatingExpenses,
  );

  return {
    grossPotentialRent: grossRent,
    effectiveGrossIncome,
    fixedOperatingExpenses,
    variableOperatingExpenses,
    operatingExpenses,
    noi: effectiveGrossIncome.minus(operatingExpenses),
    adjustedCollectionLoss,
  };
}

export function monthlyAmortizingPayment(
  principal: Decimal.Value,
  annualInterestRate: Decimal.Value,
  amortizationYears: number,
): Decimal {
  const debt = decimal(principal);
  const months = amortizationYears * 12;
  if (debt.eq(0)) return ZERO;
  if (months <= 0) throw new Error("Amortization term must be positive");

  const monthlyRate = decimal(annualInterestRate).div(12);
  if (monthlyRate.eq(0)) return debt.div(months);

  return debt
    .mul(monthlyRate)
    .div(ONE.minus(ONE.plus(monthlyRate).pow(-months)));
}

function annualPaymentFactor(inputs: ResolvedInputs): Decimal {
  return monthlyAmortizingPayment(
    ONE,
    inputs.annualInterestRate,
    inputs.amortizationYears,
  ).mul(MONTHS_PER_YEAR);
}

function debtCapacityAtPrice(
  price: Decimal,
  inputs: ResolvedInputs,
  baseNoi: Decimal,
  stressNoi: Decimal,
): { capacity: DebtCapacity; debt: Decimal } {
  const paymentFactor = annualPaymentFactor(inputs);
  const ltvCap = Decimal.max(ZERO, price.mul(inputs.ltv));
  const dscrCap = Decimal.max(
    ZERO,
    baseNoi.div(inputs.minimumDscr).div(paymentFactor),
  );
  const requiredStressAnnualCash = inputs.minimumStressMonthlyCashFlow.mul(12);
  const stressCap = Decimal.max(
    ZERO,
    stressNoi.minus(requiredStressAnnualCash).div(paymentFactor),
  );
  const debt = Decimal.min(ltvCap, dscrCap, stressCap);
  const caps: Record<DebtConstraint, Decimal> = {
    LTV: ltvCap,
    MIN_DSCR: dscrCap,
    POSITIVE_STRESS_CASH_FLOW: stressCap,
  };
  const tolerance = new Decimal("0.01");
  const bindingConstraints = (
    Object.entries(caps) as [DebtConstraint, Decimal][]
  )
    .filter(([, cap]) => cap.minus(debt).abs().lte(tolerance))
    .map(([constraint]) => constraint);

  return {
    debt,
    capacity: {
      maximumDebtKsh: money(debt),
      capsKsh: {
        LTV: money(ltvCap),
        MIN_DSCR: money(dscrCap),
        POSITIVE_STRESS_CASH_FLOW: money(stressCap),
      },
      bindingConstraints,
    },
  };
}

function scenarioResult(
  scenario: ScenarioDefinition,
  economics: Economics,
  debt: Decimal,
  price: Decimal,
  inputs: ResolvedInputs,
): ScenarioResult {
  const monthlyPayment = monthlyAmortizingPayment(
    debt,
    inputs.annualInterestRate,
    inputs.amortizationYears,
  );
  const annualDebtService = monthlyPayment.mul(12);
  const dscr = annualDebtService.gt(0)
    ? economics.noi.div(annualDebtService)
    : null;
  const monthlyCashFlow = economics.noi.minus(annualDebtService).div(12);
  const cashInvested = price
    .minus(debt)
    .plus(price.mul(inputs.acquisitionRate))
    .plus(inputs.acquisitionFixed)
    .plus(debt.mul(inputs.financingRate))
    .plus(inputs.financingFixed)
    .plus(inputs.reserves);
  const cashOnCash = cashInvested.gt(0)
    ? economics.noi.minus(annualDebtService).div(cashInvested)
    : null;
  const breakEvenDenominator = economics.grossPotentialRent
    .mul(ONE.minus(economics.adjustedCollectionLoss))
    .mul(ONE.minus(inputs.variableExpenseRate));
  const breakEvenNumerator = annualDebtService
    .plus(economics.fixedOperatingExpenses)
    .minus(inputs.otherIncome.mul(ONE.minus(inputs.variableExpenseRate)));
  const breakEven = breakEvenDenominator.gt(0)
    ? breakEvenNumerator.div(breakEvenDenominator)
    : null;

  const audits: FormulaAudit[] = [
    {
      key: "grossPotentialRent",
      formula: "sum(unit count × monthly rent × 12) × scenario rent factor",
      inputs: { scenarioRentFactor: scenario.rentFactor },
      result: money(economics.grossPotentialRent),
    },
    {
      key: "effectiveGrossIncome",
      formula:
        "gross potential rent × occupancy × (1 − collection loss) + other income",
      inputs: {
        occupancy: scenario.occupancy,
        collectionLoss: rate(economics.adjustedCollectionLoss),
        otherIncomeAnnualKsh: money(inputs.otherIncome),
      },
      result: money(economics.effectiveGrossIncome),
    },
    {
      key: "operatingExpenses",
      formula:
        "fixed operating costs × scenario expense factor + effective gross income × variable expense rate",
      inputs: {
        fixedOperatingCostsKsh: money(inputs.annualFixedCosts),
        expenseFactor: scenario.expenseFactor,
        variableExpenseRate: rate(inputs.variableExpenseRate),
      },
      result: money(economics.operatingExpenses),
    },
    {
      key: "noi",
      formula:
        "effective gross income − operating expenses (excludes debt service and investor income tax)",
      inputs: {
        effectiveGrossIncomeKsh: money(economics.effectiveGrossIncome),
        operatingExpensesKsh: money(economics.operatingExpenses),
      },
      result: money(economics.noi),
    },
    {
      key: "monthlyLoanPayment",
      formula: "P × r / (1 − (1 + r)^−n)",
      inputs: {
        principalKsh: money(debt),
        monthlyInterestRate: rate(inputs.annualInterestRate.div(12)),
        paymentMonths: String(inputs.amortizationYears * 12),
      },
      result: money(monthlyPayment),
    },
    {
      key: "dscr",
      formula: "NOI / annual debt service",
      inputs: {
        noiKsh: money(economics.noi),
        annualDebtServiceKsh: money(annualDebtService),
      },
      result: dscr ? rate(dscr) : null,
    },
    {
      key: "monthlyPostDebtCashFlow",
      formula: "(NOI − annual debt service) / 12",
      inputs: {},
      result: money(monthlyCashFlow),
    },
    {
      key: "breakEvenOccupancy",
      formula:
        "(annual debt service + fixed expenses − other income × (1 − variable expense rate)) / (gross potential rent × (1 − collection loss) × (1 − variable expense rate))",
      inputs: {},
      result: breakEven ? rate(breakEven) : null,
    },
    {
      key: "totalCashInvested",
      formula:
        "price − debt + price-based acquisition costs + fixed acquisition costs + debt-based financing costs + fixed financing costs + initial reserves",
      inputs: {
        priceKsh: money(price),
        debtKsh: money(debt),
      },
      result: money(cashInvested),
    },
    {
      key: "cashOnCashReturn",
      formula: "annual post-debt cash flow / total cash invested",
      inputs: {},
      result: cashOnCash ? rate(cashOnCash) : null,
    },
  ];

  return {
    scenarioId: scenario.id,
    label: scenario.label,
    grossPotentialRentAnnualKsh: money(economics.grossPotentialRent),
    effectiveGrossIncomeAnnualKsh: money(economics.effectiveGrossIncome),
    operatingExpensesAnnualKsh: money(economics.operatingExpenses),
    noiAnnualKsh: money(economics.noi),
    debtPrincipalKsh: money(debt),
    monthlyLoanPaymentKsh: money(monthlyPayment),
    annualDebtServiceKsh: money(annualDebtService),
    dscr: dscr ? rate(dscr) : null,
    monthlyPostDebtCashFlowKsh: money(monthlyCashFlow),
    breakEvenOccupancy: breakEven ? rate(breakEven) : null,
    totalCashInvestedKsh: money(cashInvested),
    cashOnCashReturn: cashOnCash ? rate(cashOnCash) : null,
    audits,
  };
}

function maximumAllowableOffer(
  inputs: ResolvedInputs,
  baseNoi: Decimal,
  baseDebtCapacity: Decimal,
): Decimal {
  const target = inputs.minimumCashOnCash;
  if (target.lte(0)) return ZERO;

  const paymentFactor = annualPaymentFactor(inputs);
  const fixedCashCosts = inputs.acquisitionFixed
    .plus(inputs.financingFixed)
    .plus(inputs.reserves);
  const numerator = baseNoi.minus(target.mul(fixedCashCosts));
  if (numerator.lte(0)) return ZERO;

  const debtEffect = paymentFactor.minus(
    target.mul(ONE.minus(inputs.financingRate)),
  );
  const ltvCoefficient = target
    .mul(ONE.plus(inputs.acquisitionRate))
    .plus(inputs.ltv.mul(debtEffect));
  const capacityCrossover = inputs.ltv.gt(0)
    ? baseDebtCapacity.div(inputs.ltv)
    : ZERO;
  const ltvCandidate = ltvCoefficient.gt(0)
    ? numerator.div(ltvCoefficient)
    : ZERO;

  if (inputs.ltv.eq(0)) {
    return numerator
      .div(target.mul(ONE.plus(inputs.acquisitionRate)))
      .toDecimalPlaces(2, Decimal.ROUND_FLOOR);
  }

  if (inputs.ltv.gt(0) && ltvCandidate.lte(capacityCrossover)) {
    return Decimal.max(ZERO, ltvCandidate).toDecimalPlaces(
      2,
      Decimal.ROUND_FLOOR,
    );
  }

  const capacityCandidate = numerator
    .minus(debtEffect.mul(baseDebtCapacity))
    .div(target.mul(ONE.plus(inputs.acquisitionRate)));
  return Decimal.max(ZERO, capacityCandidate).toDecimalPlaces(
    2,
    Decimal.ROUND_FLOOR,
  );
}

interface CorePolicyDecision {
  inputs: ResolvedInputs;
  scenarios: ScenarioDefinition[];
  economics: { scenario: ScenarioDefinition; economics: Economics }[];
  baseEconomics: Economics;
  stressEconomics: Economics;
  stressPropertyFeasible: boolean;
  capacityWithoutLtv: Decimal;
  mao: Decimal;
}

function corePolicyDecision(listing: PropertyListing): CorePolicyDecision {
  const inputs = resolve(listing);
  const scenarios = buildScenarios(
    inputs.baseOccupancy.toString(),
    inputs.stressOccupancy.toString(),
  );
  const economics = scenarios.map((scenario) => ({
    scenario,
    economics: scenarioEconomics(listing, inputs, scenario),
  }));
  const baseEconomics = economics.find(
    ({ scenario }) => scenario.id === "base",
  )!.economics;
  const stressEconomics = economics.find(
    ({ scenario }) => scenario.qualificationScenario,
  )!.economics;
  const requiredStressAnnualCash = inputs.minimumStressMonthlyCashFlow.mul(12);
  const stressPropertyFeasible = stressEconomics.noi.gt(
    requiredStressAnnualCash,
  );
  const capacityWithoutLtv = debtCapacityAtPrice(
    new Decimal("1e30"),
    inputs,
    baseEconomics.noi,
    stressEconomics.noi,
  ).debt;
  const mao = stressPropertyFeasible
    ? maximumAllowableOffer(inputs, baseEconomics.noi, capacityWithoutLtv)
    : ZERO;
  return {
    inputs,
    scenarios,
    economics,
    baseEconomics,
    stressEconomics,
    stressPropertyFeasible,
    capacityWithoutLtv,
    mao,
  };
}

export function screenCompleteListingPolicy(listing: PropertyListing): {
  recommendation: Exclude<AnalysisResult["recommendation"], "NEEDS_DATA">;
  maximumAllowableOfferKsh: string;
} {
  const { inputs, baseEconomics, mao } = corePolicyDecision(listing);
  return {
    recommendation:
      mao.lte(0) || baseEconomics.noi.lte(0)
        ? "REJECT"
        : inputs.price.lte(mao)
          ? "BUY"
          : "NEGOTIATE_TO_KSH_X_OR_BELOW",
    maximumAllowableOfferKsh: money(mao),
  };
}

function dueDiligenceFields(listing: PropertyListing): string[] {
  const labels: Record<keyof PropertyListing["dueDiligence"], string> = {
    title: "Title search and ownership",
    planningApprovals: "Planning and building approvals",
    countyRatesAndLandRent: "County rates and land rent clearance",
    utilityAndServiceArrears: "Utility and service-charge arrears",
    leasesAndRentRoll: "Leases, deposits, and verified rent roll",
    structuralCondition: "Independent structural and condition survey",
  };

  return Object.entries(listing.dueDiligence)
    .filter(([, input]) => input.status === "missing" || input.value !== true)
    .map(([key]) => labels[key as keyof typeof labels]);
}

export function analyzeListing(
  listing: PropertyListing,
  analyzedAt = new Date().toISOString(),
): AnalysisResult {
  const required = requiredValues(listing);
  const missing = required
    .filter(({ input }) => input.status === "missing" || input.value === null)
    .map(({ label }) => label);
  const diligence = dueDiligenceFields(listing);
  const completenessResult = completeness(listing);
  const basePolicy = {
    minimumDscr: listing.assumptions.minimumDscr.value,
    minimumCashOnCash: listing.assumptions.minimumCashOnCash.value,
    stressOccupancy: listing.assumptions.stressOccupancy.value,
    appreciationIncluded: false as const,
  };

  if (missing.length > 0) {
    return {
      listingId: listing.id,
      analyzedAt,
      recommendation: "NEEDS_DATA",
      recommendationLabel: "NEEDS DATA",
      maximumAllowableOfferKsh: null,
      offerBindingConstraint: null,
      debtCapacity: null,
      scenarios: [],
      reasons: [
        "Required financial inputs are missing; MaliScope does not silently replace them with county defaults.",
      ],
      warnings: [
        "County profiles are provisional suggestions and have not been applied automatically.",
      ],
      missingFields: missing,
      dueDiligenceFields: diligence,
      completeness: completenessResult,
      policy: basePolicy,
    };
  }

  const validation = propertyListingSchema.safeParse(listing);
  if (!validation.success) {
    return {
      listingId: listing.id,
      analyzedAt,
      recommendation: "NEEDS_DATA",
      recommendationLabel: "NEEDS DATA",
      maximumAllowableOfferKsh: null,
      offerBindingConstraint: null,
      debtCapacity: null,
      scenarios: [],
      reasons: [
        "One or more supplied inputs is invalid; correct the values before underwriting.",
      ],
      warnings: [
        "County profiles are provisional suggestions and have not been applied automatically.",
      ],
      missingFields: validation.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      ),
      dueDiligenceFields: diligence,
      completeness: completenessResult,
      policy: basePolicy,
    };
  }

  const {
    inputs,
    economics,
    baseEconomics,
    stressEconomics,
    stressPropertyFeasible,
    mao,
  } = corePolicyDecision(listing);
  const { debt, capacity } = debtCapacityAtPrice(
    inputs.price,
    inputs,
    baseEconomics.noi,
    stressEconomics.noi,
  );
  const scenarioResults = economics.map(({ scenario, economics: values }) =>
    scenarioResult(scenario, values, debt, inputs.price, inputs),
  );
  const baseResult = scenarioResults.find(
    (scenario) => scenario.scenarioId === "base",
  )!;
  const stressResult = scenarioResults.find(
    (scenario) => scenario.scenarioId === "conservative",
  )!;
  const severeResult = scenarioResults.find(
    (scenario) => scenario.scenarioId === "severe",
  )!;
  const estimatedCount = required.filter(
    ({ input }) => input.status === "estimated",
  ).length;
  const warnings: string[] = [];

  if (estimatedCount > 0) {
    warnings.push(
      `${estimatedCount} required input${estimatedCount === 1 ? " is" : "s are"} estimated; confirm against property evidence.`,
    );
  }
  if (decimal(severeResult.monthlyPostDebtCashFlowKsh).lte(0)) {
    warnings.push(
      "The severe downside scenario has non-positive post-debt cash flow.",
    );
  }
  if (diligence.length > 0) {
    warnings.push(
      "Underwriting is not a substitute for legal, physical, tenancy, and arrears due diligence.",
    );
  }

  let recommendation: AnalysisResult["recommendation"];
  let recommendationLabel: string;
  const reasons: string[] = [];

  if (mao.lte(0) || baseEconomics.noi.lte(0)) {
    recommendation = "REJECT";
    recommendationLabel = "REJECT";
    reasons.push(
      stressPropertyFeasible
        ? "No positive offer satisfies the configured cash-on-cash policy after acquisition, financing, and reserve costs."
        : `The property does not produce the required positive cash flow even without debt under the ${rate(inputs.stressOccupancy)} occupancy policy stress.`,
    );
  } else if (inputs.price.lte(mao)) {
    recommendation = "BUY";
    recommendationLabel = "BUY";
    reasons.push(
      `The asking price is at or below the maximum allowable offer of KSh ${money(mao)}.`,
      `Base DSCR is ${baseResult.dscr ?? "not applicable"} against a minimum of ${rate(inputs.minimumDscr)}.`,
      `Cash-on-cash return is ${baseResult.cashOnCashReturn ?? "not applicable"} against a target of ${rate(inputs.minimumCashOnCash)}.`,
      `Policy-stress monthly cash flow at ${rate(inputs.stressOccupancy)} occupancy is KSh ${stressResult.monthlyPostDebtCashFlowKsh}.`,
    );
  } else {
    recommendation = "NEGOTIATE_TO_KSH_X_OR_BELOW";
    recommendationLabel = `NEGOTIATE TO KSH ${money(mao)} OR BELOW`;
    reasons.push(
      `The asking price exceeds the maximum allowable offer by KSh ${money(inputs.price.minus(mao))}.`,
      "The MAO is the highest price that reaches the configured cash-on-cash target while debt remains capped by LTV, minimum DSCR, and positive policy-stress cash flow.",
    );
  }

  return {
    listingId: listing.id,
    analyzedAt,
    recommendation,
    recommendationLabel,
    maximumAllowableOfferKsh: money(mao),
    offerBindingConstraint: mao.gt(0)
      ? "MIN_CASH_ON_CASH"
      : "NO_FEASIBLE_OFFER",
    debtCapacity: capacity,
    scenarios: scenarioResults,
    reasons,
    warnings,
    missingFields: [],
    dueDiligenceFields: diligence,
    completeness: completenessResult,
    policy: {
      minimumDscr: rate(inputs.minimumDscr),
      minimumCashOnCash: rate(inputs.minimumCashOnCash),
      stressOccupancy: rate(inputs.stressOccupancy),
      appreciationIncluded: false,
    },
  };
}
