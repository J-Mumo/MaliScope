import { describe, expect, it } from "vitest";
import { parseSaleListingHtml } from "./parser";

describe("sale listing parser", () => {
  it("extracts a BuyRentKenya-style Schema.org listing", () => {
    const html = `
      <!doctype html>
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Accommodation",
              "name": "3 Bedroom Apartment for Sale",
              "description": "Rental income KES 160,000 per month.",
              "numberOfBedrooms": 3,
              "datePublished": "2026-07-21",
              "dateModified": "2026-07-22",
              "address": {
                "@type": "PostalAddress",
                "streetAddress": "Garden Estate",
                "addressLocality": "Roysambu",
                "addressRegion": "Nairobi",
                "addressCountry": "Kenya"
              },
              "offers": {
                "@type": "Offer",
                "price": "28000000",
                "priceCurrency": "KES"
              },
              "image": ["https://images.example.test/one.jpg"],
              "sku": "en-3999440"
            }
          </script>
        </head>
        <body><h1>Fallback title</h1></body>
      </html>
    `;
    const draft = parseSaleListingHtml(
      "https://www.buyrentkenya.com/listings/3-bedroom-apartment-3999440",
      html,
      "2026-08-03T10:00:00.000Z",
    );

    expect(draft.sourceId).toBe("buyrentkenya");
    expect(draft.externalId).toBe("en-3999440");
    expect(draft.title.value).toBe("3 Bedroom Apartment for Sale");
    expect(draft.askingPriceKsh.value).toBe("28000000");
    expect(draft.address.value).toBe("Garden Estate, Roysambu, Nairobi, Kenya");
    expect(draft.county).toMatchObject({
      value: "Nairobi",
      status: "reported",
    });
    expect(draft.bedrooms.value).toBe(3);
    expect(draft.unitHints).toEqual([
      {
        label: "3 bedroom",
        count: {
          value: 1,
          status: "reported",
          evidence: "Schema.org numberOfBedrooms",
        },
        askingPriceKsh: {
          value: "28000000",
          status: "reported",
          evidence: "Schema.org offer price for individual unit",
        },
      },
    ]);
    expect(draft.imageUrls).toEqual(["https://images.example.test/one.jpg"]);
    expect(draft.extractedRecordSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("extracts unit-mix hints from a marketplace description", () => {
    const html = `
      <html>
        <head>
          <meta property="og:title" content="Income apartment block for sale">
          <meta name="description" content="10 x 1 bedroom and 8 x 2 bedrooms in Ruiru, Kiambu">
          <meta property="product:price:amount" content="75,000,000">
          <meta property="product:price:currency" content="KES">
        </head>
        <body><h1>Apartment block</h1></body>
      </html>
    `;
    const draft = parseSaleListingHtml(
      "https://kenyapropertycentre.com/for-sale/apartment-block/66012-example",
      html,
    );

    expect(draft.externalId).toBe("kenya-property-centre:66012");
    expect(draft.askingPriceKsh.value).toBe("75000000");
    expect(draft.county.value).toBe("Kiambu");
    expect(
      draft.unitHints.map((hint) => [hint.label, hint.count.value]),
    ).toEqual([
      ["1 bedroom", 10],
      ["2 bedrooms", 8],
    ]);
  });

  it("preserves absent underwriting facts as missing", () => {
    const draft = parseSaleListingHtml(
      "https://equitygroupholdings.com/ke/equity-assets/property/example",
      "<html><head><title>Property</title></head><body>Nairobi asset</body></html>",
    );

    expect(draft.askingPriceKsh.status).toBe("missing");
    expect(draft.unitHints).toEqual([]);
    expect(draft.warnings).toContain("Asking price was not found.");
    expect(draft.warnings).toContain("Unit mix was not found.");
  });

  it("does not misreport foreign currency or total rooms as KES bedrooms", () => {
    const html = `
      <script type="application/ld+json">
        {
          "@type": "Accommodation",
          "name": "Apartment for sale",
          "numberOfRooms": 7,
          "address": { "addressRegion": "Nairobi" },
          "offers": {
            "@type": "Offer",
            "price": "250000",
            "priceCurrency": "USD"
          }
        }
      </script>
    `;
    const draft = parseSaleListingHtml(
      "https://www.buyrentkenya.com/listings/example-4000001",
      html,
    );

    expect(draft.askingPriceKsh.status).toBe("missing");
    expect(draft.bedrooms.status).toBe("missing");
    expect(draft.unitHints).toEqual([]);
    expect(draft.warnings.join(" ")).toContain("unsupported currency USD");
  });

  it("parses explicit KES magnitude suffixes", () => {
    const draft = parseSaleListingHtml(
      "https://jiji.co.ke/nairobi/houses-apartments-for-sale/example",
      "<html><body><h1>Apartment block</h1><p>Price KSh 28 million in Nairobi</p></body></html>",
    );
    expect(draft.askingPriceKsh.value).toBe("28000000");
  });

  it("parses an unlabelled KES sale amount from marketplace detail text", () => {
    const draft = parseSaleListingHtml(
      "https://www.propertypro.co.ke/property/3-bedroom-flatapartment-for-sale-nyali-mombasa-5BRMY",
      "<html><body><h1>Apartment for sale</h1><p>Must See KSH 40,000,000 3 Beds</p></body></html>",
    );
    expect(draft.askingPriceKsh.value).toBe("40000000");
  });

  it("does not treat rent or service-charge text as an asking price", () => {
    const draft = parseSaleListingHtml(
      "https://jiji.co.ke/nairobi/houses-apartments-for-sale/example",
      "<html><body><h1>Apartment</h1><p>Monthly rent KES 160,000. Service charge KES 20,000.</p></body></html>",
    );
    expect(draft.askingPriceKsh.status).toBe("missing");
  });

  it("rejects structured recurring rental offers", () => {
    const html = `
      <script type="application/ld+json">
        {
          "@type": "Accommodation",
          "name": "Apartment for rent",
          "address": { "addressRegion": "Nairobi" },
          "offers": {
            "@type": "Offer",
            "price": "160000",
            "priceCurrency": "KES",
            "unitText": "MONTH"
          }
        }
      </script>
    `;
    const draft = parseSaleListingHtml(
      "https://www.buyrentkenya.com/listings/apartment-for-rent-4000004",
      html,
    );
    expect(draft.askingPriceKsh.status).toBe("missing");
    expect(draft.warnings).toContain(
      "Rental listing detected; no sale asking price was imported.",
    );
  });

  it("prioritizes a structured county over conflicting description text", () => {
    const html = `
      <script type="application/ld+json">
        {
          "@type": "Accommodation",
          "name": "Apartment for sale",
          "description": "Agent office is located in Nairobi.",
          "address": {
            "addressLocality": "Ruiru",
            "addressRegion": "Kiambu"
          }
        }
      </script>
    `;
    const draft = parseSaleListingHtml(
      "https://www.buyrentkenya.com/listings/example-4000002",
      html,
    );
    expect(draft.county).toMatchObject({
      value: "Kiambu",
      status: "reported",
    });
  });

  it("marks locality-to-county mapping as estimated", () => {
    const html = `
      <script type="application/ld+json">
        {
          "@type": "Accommodation",
          "name": "Apartment for sale",
          "address": { "addressLocality": "Ruiru" }
        }
      </script>
    `;
    const draft = parseSaleListingHtml(
      "https://www.buyrentkenya.com/listings/example-4000003",
      html,
    );
    expect(draft.county).toMatchObject({
      value: "Kiambu",
      status: "estimated",
    });
  });

  it("marks a locality alias in addressRegion as estimated", () => {
    const html = `
      <script type="application/ld+json">
        {
          "@type": "Accommodation",
          "name": "Apartment for sale",
          "address": { "addressRegion": "Ruiru" }
        }
      </script>
    `;
    const draft = parseSaleListingHtml(
      "https://www.buyrentkenya.com/listings/example-4000005",
      html,
    );
    expect(draft.county).toMatchObject({
      value: "Kiambu",
      status: "estimated",
    });
  });

  it("rejects unregistered source URLs", () => {
    expect(() =>
      parseSaleListingHtml(
        "https://unregistered.example/listing/1",
        "<html></html>",
      ),
    ).toThrow("not registered");
  });
});
