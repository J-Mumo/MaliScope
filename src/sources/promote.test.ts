import { describe, expect, it } from "vitest";
import { analyzeListing, propertyListingSchema } from "@/domain";
import { parseSaleListingHtml } from "./parser";
import { confirmDraftCounty, promoteDraftToListing } from "./promote";

describe("discovery promotion", () => {
  it("promotes reported source facts and leaves underwriting facts missing", () => {
    const draft = parseSaleListingHtml(
      "https://www.buyrentkenya.com/listings/block-for-sale-kilimani-4000010",
      `
        <script type="application/ld+json">
          {
            "@type": "Accommodation",
            "name": "10-unit apartment block for sale",
            "description": "10 x 1 bedroom",
            "address": {
              "streetAddress": "Example Road",
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
      "2026-08-04T08:00:00.000Z",
    );
    const listing = promoteDraftToListing(draft);

    expect(propertyListingSchema.safeParse(listing).success).toBe(true);
    expect(listing.askingPriceKsh).toMatchObject({
      value: "80000000",
      status: "reported",
    });
    expect(listing.unitMix[0]?.count.value).toBe(10);
    expect(listing.unitMix[0]?.monthlyRentKsh.status).toBe("missing");
    expect(listing.operatingCosts.annualFixedKsh.status).toBe("missing");
    expect(analyzeListing(listing).recommendation).toBe("NEEDS_DATA");
  });

  it("rejects inferred counties until a human confirms them", () => {
    const draft = parseSaleListingHtml(
      "https://www.buyrentkenya.com/listings/block-for-sale-ruiru-4000011",
      `
        <script type="application/ld+json">
          {
            "@type": "Accommodation",
            "name": "Apartment block for sale",
            "address": { "addressLocality": "Ruiru" }
          }
        </script>
      `,
    );

    expect(() => promoteDraftToListing(draft)).toThrow(
      "explicitly report a supported county",
    );
  });

  it("promotes a human-confirmed inferred county as an auditable fact", () => {
    const draft = parseSaleListingHtml(
      "https://www.buyrentkenya.com/listings/block-for-sale-ruiru-4000012",
      `
        <script type="application/ld+json">
          {
            "@type": "Accommodation",
            "name": "Apartment block for sale",
            "address": { "addressLocality": "Ruiru" }
          }
        </script>
      `,
    );

    const confirmed = confirmDraftCounty(draft, "Kiambu");
    const listing = promoteDraftToListing(confirmed);

    expect(confirmed.county).toEqual({
      value: "Kiambu",
      status: "reported",
      evidence: "Human-confirmed during MaliScope discovery review",
    });
    expect(listing.county).toBe("Kiambu");
  });
});
