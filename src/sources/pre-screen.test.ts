import { describe, expect, it } from "vitest";
import { parseSaleListingHtml } from "./parser";
import {
  extractReportedMonthlyGrossRent,
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

  it("classifies source-reported income against the policy screen", () => {
    const viable = preScreenDiscoveryDraft(
      draftWithDescription(
        "10 x 1 bedroom apartments. Monthly rental income: KSh 1.5 million.",
      ),
    );
    const weak = preScreenDiscoveryDraft(
      draftWithDescription(
        "10 x 1 bedroom apartments. Monthly rental income: KSh 250,000.",
      ),
    );

    expect(viable.status).toBe("VIABLE");
    expect(["NEGOTIATE", "NOT_VIABLE"]).toContain(weak.status);
    expect(Number(weak.maximumAllowableOfferKsh)).toBeLessThan(80_000_000);
  });

  it("does not reuse a cached result after county confirmation changes", () => {
    const draft = draftWithDescription("10 x 1 bedroom apartments");
    const nairobi = preScreenDiscoveryDraft(draft);
    draft.county = {
      value: "Mombasa",
      status: "reported",
      evidence: "Human-confirmed during MaliScope discovery review",
    };
    const mombasa = preScreenDiscoveryDraft(draft);

    expect(mombasa.requiredMonthlyGrossRentKsh).not.toBe(
      nairobi.requiredMonthlyGrossRentKsh,
    );
  });
});
