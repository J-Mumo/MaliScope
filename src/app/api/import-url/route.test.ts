import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";

describe("POST /api/import-url", () => {
  it("rejects pending sources before network access", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    const response = await POST(
      new Request("http://localhost/api/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://www.buyrentkenya.com/listings/example-3999440",
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error:
        "BuyRentKenya live import is pending permission and cannot contact the website.",
    });
    expect(fetcher).not.toHaveBeenCalled();
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
