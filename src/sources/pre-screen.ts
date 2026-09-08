import Decimal from "decimal.js";
import type { SaleListingImportDraft } from "./import-types";

export const discoveryPreScreenStatuses = [
  "PROMISING",
  "WORTH_A_LOOK",
  "INTEREST_ONLY",
  "UNDERWATER",
  "NEEDS_DATA",
] as const;

export type DiscoveryPreScreenStatus =
  (typeof discoveryPreScreenStatuses)[number];

export interface DiscoveryPreScreen {
  status: DiscoveryPreScreenStatus;
  label: string;
  reason: string;
  reportedMonthlyGrossRentKsh: string | null;
  reportedOccupancy: string | null;
  requiredMonthlyGrossRentKsh: string | null;
  maximumAllowableOfferKsh: string | null;
  monthlyDebtServiceKsh: string | null;
  monthlyInterestKsh: string | null;
  debtServiceCoverageRatio: string | null;
  assumptionsLabel: string;
}

const LOAN_LTV = new Decimal("0.70");
const ANNUAL_INTEREST_RATE = new Decimal("0.145");
const AMORTIZATION_MONTHS = 180;
const PROMISING_DSCR = new Decimal("1.30");

const assumptionsLabel =
  "Loan-service screen: 70% LTV, 14.5% interest, 15-year amortization. PROMISING requires reported rent \u2265 1.30\u00d7 debt service. Underwriting adds operating costs, DSCR, and return targets.";
const preScreenCache = new Map<string, DiscoveryPreScreen>();

const monthlyPaymentFactor: Decimal = (() => {
  const monthlyRate = ANNUAL_INTEREST_RATE.div(12);
  const compound = monthlyRate.plus(1).pow(AMORTIZATION_MONTHS);
  return monthlyRate.mul(compound).div(compound.minus(1));
})();

function normalizeMoney(value: string): Decimal | null {
  const match = value
    .replaceAll(",", "")
    .match(
      /^\s*(?:(?:KSh|KES)\s*)?(\d+(?:\.\d+)?)\s*(thousand|million|billion|k|m|bn)?\s*$/i,
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
    /(?:monthly\s+(?:gross\s+)?(?:rental\s+)?income|gross\s+monthly\s+rent|monthly\s+rent\s+roll|rental\s+income\s+per\s+month)\s*(?:of|is|at|:|-)?\s*((?:KSh|KES)?\s*\d[\d,]*(?:\.\d+)?\s*(?:(?:thousand|million|billion|k|m|bn)\b)?)/i,
    /(?:generat(?:es|ing)|collects?|earn(?:s|ing)|producing|rental\s+income\s+of|income\s+of|monthly\s+income\s+of)\s*((?:KSh|KES)?\s*\d[\d,]*(?:\.\d+)?\s*(?:(?:thousand|million|billion|k|m|bn)\b)?)[^.]{0,40}(?:per\s+month|\/\s*month|monthly|\bmo\b)/i,
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
    /(?:annual\s+(?:gross\s+)?(?:rental\s+)?income|annual\s+rent\s+roll)\s*(?:of|is|at|:|-)?\s*((?:KSh|KES)?\s*\d[\d,]*(?:\.\d+)?\s*(?:(?:thousand|million|billion|k|m|bn)\b)?)/i,
  )?.[1];
  const annualAmount = annualValue ? normalizeMoney(annualValue) : null;
  return annualAmount ? annualAmount.div(12).toFixed(2) : null;
}

export function extractReportedOccupancy(
  draft: SaleListingImportDraft,
): string | null {
  if (draft.description.status !== "reported" || !draft.description.value) {
    return null;
  }
  const text = draft.description.value.replace(/\s+/g, " ");
  if (/\bfully\s+(?:let|occupied|tenanted|rented|booked)\b/i.test(text)) {
    return "1.00";
  }
  const percent = text.match(
    /(\d{1,3})\s*%\s*(?:occupan(?:cy|t)|occupied|let|tenanted|rented)/i,
  );
  if (percent) {
    const value = Number(percent[1]);
    if (Number.isFinite(value) && value >= 0 && value <= 100) {
      return new Decimal(value).div(100).toFixed(2);
    }
  }
  const ratio = text.match(
    /(\d{1,4})\s*(?:out\s+of|\/|of)\s*(\d{1,4})\s*(?:units?|apartments?|flats?|houses?)\s*(?:are\s+)?(?:let|occupied|tenanted|rented)/i,
  );
  if (ratio) {
    const occupied = Number(ratio[1]);
    const total = Number(ratio[2]);
    if (total > 0 && occupied <= total) {
      return new Decimal(occupied).div(total).toFixed(2);
    }
  }
  return null;
}

function classifyLoanService(
  monthlyRent: Decimal,
  monthlyDebtService: Decimal,
  monthlyInterest: Decimal,
): {
  status: DiscoveryPreScreenStatus;
  label: string;
  reason: string;
} {
  const dscr = monthlyRent.div(monthlyDebtService);
  if (dscr.gte(PROMISING_DSCR)) {
    return {
      status: "PROMISING",
      label: "PROMISING",
      reason:
        "Reported rent comfortably covers the policy debt payment. Open underwriting to add operating costs and confirm returns.",
    };
  }
  if (dscr.gte(1)) {
    return {
      status: "WORTH_A_LOOK",
      label: "WORTH A LOOK",
      reason:
        "Reported rent covers the debt payment with thin margin. Verify occupancy and operating costs before committing.",
    };
  }
  if (monthlyRent.gte(monthlyInterest)) {
    return {
      status: "INTEREST_ONLY",
      label: "INTEREST ONLY",
      reason:
        "Rent covers the interest portion but not full amortization. Consider interest-only terms or a larger equity cheque.",
    };
  }
  return {
    status: "UNDERWATER",
    label: "UNDERWATER",
    reason:
      "Rent does not cover interest at policy financing. Requires an equity subsidy, a lower price, or a different rent basis.",
  };
}

function unavailable(reason: string): DiscoveryPreScreen {
  return {
    status: "NEEDS_DATA",
    label: "NEEDS DATA",
    reason,
    reportedMonthlyGrossRentKsh: null,
    reportedOccupancy: null,
    requiredMonthlyGrossRentKsh: null,
    maximumAllowableOfferKsh: null,
    monthlyDebtServiceKsh: null,
    monthlyInterestKsh: null,
    debtServiceCoverageRatio: null,
    assumptionsLabel,
  };
}

function calculatePreScreen(draft: SaleListingImportDraft): DiscoveryPreScreen {
  if (!draft.askingPriceKsh.value) {
    return unavailable(
      "Asking price is required to compute the loan-service screen.",
    );
  }
  const askingPrice = new Decimal(draft.askingPriceKsh.value);
  const loan = askingPrice.mul(LOAN_LTV);
  const monthlyDebtService = loan.mul(monthlyPaymentFactor);
  const monthlyInterest = loan.mul(ANNUAL_INTEREST_RATE).div(12);
  const requiredRent = monthlyDebtService.mul(PROMISING_DSCR);
  const reportedOccupancy = extractReportedOccupancy(draft);
  const reportedRent = extractReportedMonthlyGrossRent(draft);

  if (!reportedRent) {
    return {
      ...unavailable(
        "Gross monthly rent is not explicitly reported. Compare a verified rent against the threshold below.",
      ),
      reportedOccupancy,
      requiredMonthlyGrossRentKsh: requiredRent.toFixed(2),
      monthlyDebtServiceKsh: monthlyDebtService.toFixed(2),
      monthlyInterestKsh: monthlyInterest.toFixed(2),
    };
  }

  const rent = new Decimal(reportedRent);
  const dscr = rent.div(monthlyDebtService);
  const promisingMao = rent.div(
    LOAN_LTV.mul(monthlyPaymentFactor).mul(PROMISING_DSCR),
  );
  const { status, label, reason } = classifyLoanService(
    rent,
    monthlyDebtService,
    monthlyInterest,
  );

  return {
    status,
    label,
    reason,
    reportedMonthlyGrossRentKsh: reportedRent,
    reportedOccupancy,
    requiredMonthlyGrossRentKsh: requiredRent.toFixed(2),
    maximumAllowableOfferKsh: promisingMao.toFixed(2),
    monthlyDebtServiceKsh: monthlyDebtService.toFixed(2),
    monthlyInterestKsh: monthlyInterest.toFixed(2),
    debtServiceCoverageRatio: dscr.toFixed(2),
    assumptionsLabel,
  };
}

export function preScreenDiscoveryDraft(
  draft: SaleListingImportDraft,
): DiscoveryPreScreen {
  const cacheKey = JSON.stringify({
    extractedRecordSha256: draft.extractedRecordSha256,
    askingPriceKsh: draft.askingPriceKsh,
    description: draft.description,
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
