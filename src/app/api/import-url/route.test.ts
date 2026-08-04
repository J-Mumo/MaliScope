import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";

describe("POST /api/import-url", () => {
  it("imports an approved source listing", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        `
          <script type="application/ld+json">
            {
              "@type": "Accommodation",
              "name": "Apartment for sale",
              "address": { "addressRegion": "Nairobi" },
              "offers": {
                "@type": "Offer",
                "price": "25000000",
                "priceCurrency": "KES"
              }
            }
          </script>
        `,
        {
          status: 200,
          headers: { "Content-Type": "text/html" },
        },
      ),
    );
    const response = await POST(
      new Request("http://localhost/api/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://www.buyrentkenya.com/listings/example-for-sale-3999440",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sourceId: "buyrentkenya",
      title: { value: "Apartment for sale", status: "reported" },
      askingPriceKsh: { value: "25000000", status: "reported" },
    });
    expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockRestore();
  });

  it("rejects malformed and unsupported URLs", async () => {
    const malformed = await POST(
      new Request("http://localhost/api/import-url", {
        method: "POST",
        body: "{",
      }),
    );
    expect(malformed.status).toBe(400);

    const unsupported = await POST(
      new Request("http://localhost/api/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/listing/1" }),
      }),
    );
    expect(unsupported.status).toBe(403);
  });
});
