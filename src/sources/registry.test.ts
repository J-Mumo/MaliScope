import { describe, expect, it, vi } from "vitest";
import { fetchApprovedSourceHtml, readHtmlWithinLimit } from "./http";
import {
  findSourceByUrl,
  isSourceApproved,
  parseSourceUrl,
  sourceRegistry,
} from "./registry";

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
    ["https://www.hassconsult.com/developments", "hassconsult"],
    ["https://www.knightfrank.co.ke/", "knight-frank-kenya"],
  ])("recognizes %s", (url, sourceId) => {
    expect(findSourceByUrl(url)?.id).toBe(sourceId);
  });

  it("requires complete activation metadata for every approved source", () => {
    expect(sourceRegistry.every(isSourceApproved)).toBe(true);
    for (const source of sourceRegistry) {
      expect(source.agreementRef).toBeTruthy();
      expect(source.permissionBasis).toBeTruthy();
      expect(source.reviewedBy).toBeTruthy();
      expect(source.userAgent).toContain("compatible");
      expect(source.discovery.maxListingsPerRun).toBeLessThanOrEqual(20);
      expect(source.discovery.requestDelayMs).toBeGreaterThanOrEqual(1000);
      for (const indexUrl of source.discovery.indexUrls ?? [source.saleUrl]) {
        expect(findSourceByUrl(indexUrl)?.id).toBe(source.id);
      }
    }
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

  it("uses the registered identity for an approved source request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("<html></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
    const url =
      "https://www.buyrentkenya.com/listings/example-for-sale-3999440";
    await expect(fetchApprovedSourceHtml(url, fetcher)).resolves.toBe(
      "<html></html>",
    );
    expect(fetcher).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        headers: expect.objectContaining({
          "User-Agent": expect.stringContaining("BuyRentKenyaBot"),
        }),
      }),
    );
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

  it("reports anti-bot challenge pages explicitly", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        '<meta name="robots" content="noindex,nofollow"><script src="/_Incapsula_Resource"></script>',
        {
          status: 200,
          headers: { "Content-Type": "text/html" },
        },
      ),
    );

    await expect(
      fetchApprovedSourceHtml(
        "https://equitygroupholdings.com/ke/equity-assets/",
        fetcher,
      ),
    ).rejects.toThrow("Imperva bot-protection challenge");
  });
});
