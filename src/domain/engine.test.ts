import { describe, expect, it } from "vitest";
import {
  analyzeListing,
  monthlyAmortizingPayment,
  propertyListingSchema,
  seededListing,
  type PropertyListing,
} from ".";

const cloneListing = (): PropertyListing => structuredClone(seededListing);

describe("monthlyAmortizingPayment", () => {
  it("calculates an amortizing payment", () => {
    const payment = monthlyAmortizingPayment("1000000", "0.12", 1);
    expect(payment.toFixed(2)).toBe("88848.79");
  });

  it("handles a zero interest loan without division by zero", () => {
    const payment = monthlyAmortizingPayment("1200000", "0", 10);
    expect(payment.toFixed(2)).toBe("10000.00");
  });

  it("returns zero for zero debt", () => {
    expect(monthlyAmortizingPayment("0", "0.15", 15).toFixed(2)).toBe("0.00");
  });
});

describe("analyzeListing formulas", () => {
  it("calculates income, expenses, NOI, debt service, and returns deterministically", () => {
    const result = analyzeListing(cloneListing(), "2026-01-01T00:00:00.000Z");
    const base = result.scenarios[0]!;

    expect(base.grossPotentialRentAnnualKsh).toBe("15360000.00");
    expect(base.effectiveGrossIncomeAnnualKsh).toBe("13707264.00");
    expect(base.operatingExpensesAnnualKsh).toBe("3196581.12");
    expect(base.noiAnnualKsh).toBe("10510682.88");
    expect(base.annualDebtServiceKsh).toBe("8085140.68");
    expect(base.dscr).toBe("1.300000");
    expect(base.monthlyPostDebtCashFlowKsh).toBe("202128.52");
    expect(base.breakEvenOccupancy).toBe("0.743047");
    expect(base.totalCashInvestedKsh).toBe("52125106.39");
    expect(base.cashOnCashReturn).toBe("0.046533");
    expect(result.analyzedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("makes each downside scenario more conservative", () => {
    const scenarios = analyzeListing(cloneListing()).scenarios;
    expect(Number(scenarios[0]!.noiAnnualKsh)).toBeGreaterThan(
      Number(scenarios[1]!.noiAnnualKsh),
    );
    expect(Number(scenarios[1]!.noiAnnualKsh)).toBeGreaterThan(
      Number(scenarios[2]!.noiAnnualKsh),
    );
    expect(Number(scenarios[1]!.monthlyPostDebtCashFlowKsh)).toBeGreaterThan(0);
    expect(Number(scenarios[2]!.monthlyPostDebtCashFlowKsh)).toBeLessThan(0);
  });

  it("includes acquisition, financing, and reserve costs in cash invested", () => {
    const listing = cloneListing();
    listing.askingPriceKsh.value = "100000000";
    listing.loanTerms.maximumLtv.value = "0";
    const base = analyzeListing(listing).scenarios[0]!;

    expect(base.debtPrincipalKsh).toBe("0.00");
    expect(base.totalCashInvestedKsh).toBe("109000000.00");
  });
});

describe("debt capacity and maximum allowable offer", () => {
  it("identifies minimum DSCR as the sample debt constraint", () => {
    const result = analyzeListing(cloneListing());
    expect(result.debtCapacity?.bindingConstraints).toEqual(["MIN_DSCR"]);
    expect(result.debtCapacity?.maximumDebtKsh).toBe("49341728.18");
  });

  it("identifies LTV when leverage is the tightest constraint", () => {
    const listing = cloneListing();
    listing.loanTerms.maximumLtv.value = "0.30";
    const result = analyzeListing(listing);

    expect(result.debtCapacity?.bindingConstraints).toEqual(["LTV"]);
    expect(result.debtCapacity?.maximumDebtKsh).toBe("27600000.00");
  });

  it("identifies positive stressed cash flow when it is tightest", () => {
    const listing = cloneListing();
    listing.askingPriceKsh.value = "100000000";
    listing.loanTerms.maximumLtv.value = "0.90";
    listing.assumptions.minimumDscr.value = "1";
    const result = analyzeListing(listing);
    const stress = result.scenarios.find(
      (scenario) => scenario.scenarioId === "conservative",
    )!;

    expect(result.debtCapacity?.bindingConstraints).toEqual([
      "POSITIVE_STRESS_CASH_FLOW",
    ]);
    expect(Number(stress.monthlyPostDebtCashFlowKsh)).toBeGreaterThan(0);
  });

  it("solves the MAO at the cash-on-cash target without circular iteration", () => {
    const initial = analyzeListing(cloneListing());
    const listing = cloneListing();
    listing.askingPriceKsh.value = initial.maximumAllowableOfferKsh;
    const atMao = analyzeListing(listing);
    const base = atMao.scenarios[0]!;

    expect(initial.maximumAllowableOfferKsh).toBe("62118400.62");
    expect(atMao.recommendation).toBe("BUY");
    expect(Number(base.cashOnCashReturn)).toBeGreaterThanOrEqual(0.13);
    expect(atMao.offerBindingConstraint).toBe("MIN_CASH_ON_CASH");
  });

  it("reduces MAO when acquisition costs increase", () => {
    const baseline = analyzeListing(cloneListing());
    const expensive = cloneListing();
    expensive.acquisitionCosts.percentOfPrice.value = "0.10";
    const expensiveResult = analyzeListing(expensive);

    expect(Number(expensiveResult.maximumAllowableOfferKsh)).toBeLessThan(
      Number(baseline.maximumAllowableOfferKsh),
    );
  });

  it("correctly solves an unlevered MAO", () => {
    const listing = cloneListing();
    listing.loanTerms.maximumLtv.value = "0";
    const result = analyzeListing(listing);

    expect(result.debtCapacity?.maximumDebtKsh).toBe("0.00");
    expect(Number(result.maximumAllowableOfferKsh)).toBeGreaterThan(0);
  });

  it("rejects when policy-stress cash flow is negative even without debt", () => {
    const listing = cloneListing();
    listing.askingPriceKsh.value = "10000000";
    listing.operatingCosts.annualFixedKsh.value = "10000000";
    const result = analyzeListing(listing);

    expect(result.recommendation).toBe("REJECT");
    expect(result.maximumAllowableOfferKsh).toBe("0.00");
    expect(result.reasons.join(" ")).toContain("even without debt");
  });
});

describe("recommendations and input quality", () => {
  it("recommends negotiation when asking price exceeds MAO", () => {
    const result = analyzeListing(cloneListing());
    expect(result.recommendation).toBe("NEGOTIATE_TO_KSH_X_OR_BELOW");
    expect(result.maximumAllowableOfferKsh).toBe("62118400.62");
  });

  it("recommends buy when asking price is inside policy", () => {
    const listing = cloneListing();
    listing.askingPriceKsh.value = "50000000";
    expect(analyzeListing(listing).recommendation).toBe("BUY");
  });

  it("rejects a property with no positive policy-compliant offer", () => {
    const listing = cloneListing();
    listing.operatingCosts.annualFixedKsh.value = "20000000";
    const result = analyzeListing(listing);

    expect(result.recommendation).toBe("REJECT");
    expect(result.maximumAllowableOfferKsh).toBe("0.00");
  });

  it("requires missing financial facts without substituting profile values", () => {
    const listing = cloneListing();
    listing.askingPriceKsh = { value: null, status: "missing" };
    const result = analyzeListing(listing);

    expect(result.recommendation).toBe("NEEDS_DATA");
    expect(result.scenarios).toEqual([]);
    expect(result.missingFields).toContain("Asking price");
    expect(result.maximumAllowableOfferKsh).toBeNull();
  });

  it("returns needs-data instead of throwing for invalid loan terms", () => {
    const listing = cloneListing();
    listing.loanTerms.amortizationYears.value = 0;
    const result = analyzeListing(listing);

    expect(result.recommendation).toBe("NEEDS_DATA");
    expect(result.missingFields.join(" ")).toContain(
      "loanTerms.amortizationYears",
    );
  });

  it("reports provisional estimates and open due diligence", () => {
    const result = analyzeListing(cloneListing());
    expect(result.completeness.label).toBe("medium");
    expect(result.warnings.join(" ")).toContain("estimated");
    expect(result.dueDiligenceFields).toContain("Title search and ownership");
    expect(result.policy.appreciationIncluded).toBe(false);
  });

  it("validates tracked-value invariants and the 12-15% policy range", () => {
    const invalidMissing = cloneListing();
    invalidMissing.askingPriceKsh = {
      value: "100",
      status: "missing",
    } as unknown as PropertyListing["askingPriceKsh"];
    expect(propertyListingSchema.safeParse(invalidMissing).success).toBe(false);

    const invalidTarget = cloneListing();
    invalidTarget.assumptions.minimumCashOnCash.value = "0.20";
    expect(propertyListingSchema.safeParse(invalidTarget).success).toBe(false);
  });
});
