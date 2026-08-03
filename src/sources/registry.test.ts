import { describe, expect, it, vi } from "vitest";
import { fetchApprovedSourceHtml, readHtmlWithinLimit } from "./http";
import { findSourceByUrl, parseSourceUrl, sourceRegistry } from "./registry";

describe("website source registry", () => {
  it.each([
    ["https://equitygroupholdings.com/ke/equity-assets/", "equity-assets"],
    ["https://hfmarketplace.hfcb.co.ke/", "hf-marketplace"],
    ["https://jiji.co.ke/houses-apartments-for-sale", "jiji-kenya"],
    ["https://kenyapropertycentre.com/", "kenya-property-centre"],
    [
      "https://www.propertypro.co.ke/property-for-sale/property/",
      "propertypro-kenya",
    ],
    ["https://www.buyrentkenya.com/", "buyrentkenya"],
    ["https://www.hassconsult.com/", "hassconsult"],
    ["https://www.knightfrank.co.ke/", "knight-frank-kenya"],
  ])("recognizes %s", (url, sourceId) => {
    expect(findSourceByUrl(url)?.id).toBe(sourceId);
  });

  it("keeps every reviewed source disabled pending permission", () => {
    expect(sourceRegistry.every((source) => !source.liveFetchEnabled)).toBe(
      true,
    );
    expect(
      sourceRegistry.every((source) => source.accessStatus !== "approved"),
    ).toBe(true);
  });

  it.each([
    "http://www.buyrentkenya.com/listing/1",
    "https://user:pass@www.buyrentkenya.com/listing/1",
    "https://www.buyrentkenya.com:8443/listing/1",
  ])("rejects unsafe source URL %s", (url) => {
    expect(() => parseSourceUrl(url)).toThrow();
  });

  it("does not match suffix-spoofed or unrelated hosts", () => {
    expect(
      findSourceByUrl("https://www.buyrentkenya.com.attacker.example/x"),
    ).toBeNull();
    expect(
      findSourceByUrl("https://example.com/?next=buyrentkenya.com"),
    ).toBeNull();
  });

  it("blocks before making a network request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      fetchApprovedSourceHtml(
        "https://www.buyrentkenya.com/listings/example-3999440",
        fetcher,
      ),
    ).rejects.toThrow("pending permission");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("stops reading a streamed response at the byte limit", async () => {
    const encoder = new TextEncoder();
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("12345"));
          controller.enqueue(encoder.encode("67890"));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );

    await expect(readHtmlWithinLimit(response, 6)).rejects.toThrow(
      "exceeds the import size limit",
    );
    expect(cancelled).toBe(true);
  });
});
