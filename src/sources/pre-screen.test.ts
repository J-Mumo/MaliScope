import { describe, expect, it } from "vitest";
import { parseSaleListingHtml } from "./parser";
import {
  extractReportedMonthlyGrossRent,
  extractReportedOccupancy,
  preScreenDiscoveryDraft,
} from "./pre-screen";

function draftWithDescription(description: string) {
  return parseSaleListingHtml(
    "https://www.buyrentkenya.com/listings/apartment-block-for-sale-kilimani-4000099",
    `
      <script type="application/ld+json">
        {
          "@type": "Accommodation",
          "name": "10-unit apartment block for sale",
          "description": ${JSON.stringify(description)},
          "address": {
            "addressLocality": "Kilimani",
            "addressRegion": "Nairobi"
          },
          "offers": {
            "@type": "Offer",
            "price": "80000000",
            "priceCurrency": "KES"
          }
        }
      </script>
    `,
  );
}

describe("discovery viability pre-screen", () => {
  it("shows the required rent threshold instead of inventing missing income", () => {
    const result = preScreenDiscoveryDraft(
      draftWithDescription("10 x 1 bedroom apartments"),
    );

    expect(result.status).toBe("NEEDS_DATA");
    expect(result.reportedMonthlyGrossRentKsh).toBeNull();
    expect(Number(result.requiredMonthlyGrossRentKsh)).toBeGreaterThan(0);
  });

  it("extracts explicit monthly and annual gross rental income", () => {
    expect(
      extractReportedMonthlyGrossRent(
        draftWithDescription(
          "10 x 1 bedroom apartments. Monthly rental income: KSh 1.2 million.",
        ),
      ),
    ).toBe("1200000.00");
    expect(
      extractReportedMonthlyGrossRent(
        draftWithDescription(
          "10 x 1 bedroom apartments. Annual rent roll KES 12,000,000.",
        ),
      ),
    ).toBe("1000000.00");
  });

  it("does not parse the m in monthly as a million suffix", () => {
    expect(
      extractReportedMonthlyGrossRent(
        draftWithDescription(
          "10 x 1 bedroom apartments generating KES 50,000 monthly.",
        ),
      ),
    ).toBe("50000.00");
  });

  it("does not treat per-unit rent as whole-property gross rent", () => {
    const draft = draftWithDescription(
      "10 apartments generating KES 150,000 each per month.",
    );

    expect(extractReportedMonthlyGrossRent(draft)).toBeNull();
    expect(preScreenDiscoveryDraft(draft).status).toBe("NEEDS_DATA");
  });

  it("classifies rent against the loan-service tiers at policy financing", () => {
    const promising = preScreenDiscoveryDraft(
      draftWithDescription(
        "10 x 1 bedroom apartments. Monthly rental income: KSh 1.5 million.",
      ),
    );
    const worthALook = preScreenDiscoveryDraft(
      draftWithDescription(
        "10 x 1 bedroom apartments. Monthly rental income: KSh 900,000.",
      ),
    );
    const interestOnly = preScreenDiscoveryDraft(
      draftWithDescription(
        "10 x 1 bedroom apartments. Monthly rental income: KSh 700,000.",
      ),
    );
    const underwater = preScreenDiscoveryDraft(
      draftWithDescription(
        "10 x 1 bedroom apartments. Monthly rental income: KSh 250,000.",
      ),
    );

    expect(promising.status).toBe("PROMISING");
    expect(
      Number(promising.debtServiceCoverageRatio),
    ).toBeGreaterThanOrEqual(1.3);
    expect(worthALook.status).toBe("WORTH_A_LOOK");
    expect(interestOnly.status).toBe("INTEREST_ONLY");
    expect(underwater.status).toBe("UNDERWATER");
    expect(Number(promising.maximumAllowableOfferKsh)).toBeGreaterThan(
      80_000_000,
    );
    expect(Number(underwater.maximumAllowableOfferKsh)).toBeLessThan(
      80_000_000,
    );
  });

  it("invalidates cached results when the asking price changes", () => {
    const draft = draftWithDescription(
      "10 x 1 bedroom apartments. Monthly rental income: KSh 900,000.",
    );
    const first = preScreenDiscoveryDraft(draft);
    draft.askingPriceKsh = {
      value: "200000000",
      status: "reported",
      evidence: "Adjusted price",
    };
    const second = preScreenDiscoveryDraft(draft);

    expect(second.requiredMonthlyGrossRentKsh).not.toBe(
      first.requiredMonthlyGrossRentKsh,
    );
    expect(second.status).toBe("UNDERWATER");
  });

  it("extracts Jiji-style rent stated without a currency prefix", () => {
    expect(
      extractReportedMonthlyGrossRent(
        draftWithDescription(
          "Fairly used block of flats consisting of 124 bedsitters, fully let with an income of 1,032,600 / month.",
        ),
      ),
    ).toBe("1032600.00");
    expect(
      extractReportedMonthlyGrossRent(
        draftWithDescription(
          "12 bedsitters generating 480,000 per month.",
        ),
      ),
    ).toBe("480000.00");
  });

  it("extracts reported occupancy from natural-language descriptions", () => {
    expect(
      extractReportedOccupancy(
        draftWithDescription("124 bedsitters, fully let with an income."),
      ),
    ).toBe("1.00");
    expect(
      extractReportedOccupancy(
        draftWithDescription("Currently at 85% occupancy across all units."),
      ),
    ).toBe("0.85");
    expect(
      extractReportedOccupancy(
        draftWithDescription("18 of 20 apartments are let, two vacant."),
      ),
    ).toBe("0.90");
    expect(
      extractReportedOccupancy(
        draftWithDescription("Occupancy details unavailable at this time."),
      ),
    ).toBeNull();
  });

  it("returns reported occupancy alongside pre-screen output", () => {
    const result = preScreenDiscoveryDraft(
      draftWithDescription(
        "10 x 1 bedroom apartments. Monthly rental income: KSh 1.5 million. Fully let.",
      ),
    );

    expect(result.reportedOccupancy).toBe("1.00");
    expect(result.reportedMonthlyGrossRentKsh).toBe("1500000.00");
  });
});
