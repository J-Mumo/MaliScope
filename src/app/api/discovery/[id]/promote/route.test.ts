import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseSaleListingHtml } from "@/sources/parser";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  savePromotedDiscovery: vi.fn(),
}));

vi.mock("@/db/discovery-repository", () => ({
  DiscoveryPromotionConflictError: class extends Error {},
  PostgresDiscoveryRepository: class {
    get = mocks.get;
  },
  savePromotedDiscovery: mocks.savePromotedDiscovery,
}));

import { POST } from "./route";

describe("POST /api/discovery/[id]/promote", () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.savePromotedDiscovery.mockReset().mockResolvedValue(undefined);
  });

  it("accepts a human-confirmed county and persists a needs-data listing", async () => {
    const draft = parseSaleListingHtml(
      "https://www.buyrentkenya.com/listings/block-for-sale-ruiru-4000013",
      `
        <script type="application/ld+json">
          {
            "@type": "Accommodation",
            "name": "Apartment block for sale",
            "address": { "addressLocality": "Ruiru" }
          }
        </script>
      `,
      "2026-08-04T08:00:00.000Z",
    );
    mocks.get.mockResolvedValue({
      id: "draft-1",
      draft,
      status: "new",
    });

    const response = await POST(
      new Request("http://localhost/api/discovery/draft-1/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmedCounty: "Kiambu" }),
      }),
      { params: Promise.resolve({ id: "draft-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.analysis.recommendation).toBe("NEEDS_DATA");
    expect(mocks.savePromotedDiscovery).toHaveBeenCalledWith(
      "draft-1",
      expect.objectContaining({
        county: expect.objectContaining({
          value: "Kiambu",
          status: "reported",
        }),
      }),
      expect.objectContaining({ county: "Kiambu" }),
      expect.objectContaining({ recommendation: "NEEDS_DATA" }),
    );
  });

  it("rejects an unsupported county confirmation", async () => {
    const response = await POST(
      new Request("http://localhost/api/discovery/draft-1/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmedCounty: "Kisumu" }),
      }),
      { params: Promise.resolve({ id: "draft-1" }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("rejects ignored records at the server boundary", async () => {
    mocks.get.mockResolvedValue({
      id: "draft-1",
      draft: {},
      status: "ignored",
    });

    const response = await POST(
      new Request("http://localhost/api/discovery/draft-1/promote", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "draft-1" }) },
    );

    expect(response.status).toBe(409);
    expect(mocks.savePromotedDiscovery).not.toHaveBeenCalled();
  });
});
