import { describe, expect, it, vi } from "vitest";
import type { DiscoveryRecord } from "./discovery-types";
import type { SaleListingImportDraft } from "./import-types";
import {
  discoverApprovedSource,
  discoverAllApprovedSources,
  extractSaleDetailLinks,
} from "./discovery-crawler";
import { getSourceById } from "./registry";
import { LiveSourceAccessError } from "./http";
import type { DiscoveryRepository } from "@/db/discovery-repository";

class MemoryDiscoveryRepository implements DiscoveryRepository {
  drafts: SaleListingImportDraft[] = [];
  pages = new Map<string, number>();
  stale: DiscoveryRecord[] = [];
  delisted: string[] = [];

  async claimSourcePage(sourceId: string, pageCount: number) {
    const page = (this.pages.get(sourceId) ?? 0) + 1;
    const claimed = page > pageCount ? 1 : page;
    this.pages.set(sourceId, claimed);
    return claimed;
  }

  async upsertDraft(draft: SaleListingImportDraft) {
    this.drafts.push(draft);
  }

  async list(): Promise<DiscoveryRecord[]> {
    return [];
  }

  async get(): Promise<DiscoveryRecord | null> {
    return null;
  }

  async setStatus(): Promise<void> {}

  async findStaleRecords(): Promise<DiscoveryRecord[]> {
    return this.stale;
  }

  async markDelisted(id: string): Promise<void> {
    this.delisted.push(id);
  }
}

describe("approved source discovery", () => {
  it("extracts unique same-host sale detail links only", () => {
    const source = getSourceById("buyrentkenya");
    const html = `
      <a href="/listings/3-bedroom-apartment-for-sale-kilimani-4000001">One</a>
      <a href="https://www.buyrentkenya.com/listings/3-bedroom-apartment-for-sale-kilimani-4000001?ref=home">Duplicate</a>
      <a href="/listings/3-bedroom-apartment-for-rent-kilimani-4000002">Rent</a>
      <a href="https://attacker.example/listings/block-for-sale-4000003">Other host</a>
      <a href="/about">Navigation</a>
    `;

    expect(extractSaleDetailLinks(source, html)).toEqual([
      "https://www.buyrentkenya.com/listings/3-bedroom-apartment-for-sale-kilimani-4000001",
    ]);
  });

  it("uses configured link text to exclude HassConsult navigation links", () => {
    const source = getSourceById("hassconsult");
    const html = `
      <a href="/services">SERVICES</a>
      <a href="/ankori">DETAILS</a>
      <a href="/ankori-contact-form">ENQUIRE</a>
      <a href="/elysian">DETAILS</a>
    `;

    expect(extractSaleDetailLinks(source, html)).toEqual([
      "https://www.hassconsult.com/ankori",
      "https://www.hassconsult.com/elysian",
    ]);
  });

  it("fetches, parses, and persists bounded candidate details", async () => {
    const repository = new MemoryDiscoveryRepository();
    const indexUrl = getSourceById("buyrentkenya").saleUrl;
    const detailUrl =
      "https://www.buyrentkenya.com/listings/apartment-block-for-sale-kilimani-4000004";
    const fetchHtml = vi.fn(async (url: string) => {
      if (url === indexUrl) return `<a href="${detailUrl}">Listing</a>`;
      if (url === detailUrl) {
        return `
          <script type="application/ld+json">
            {
              "@type": "Accommodation",
              "name": "Apartment block for sale",
              "address": {
                "addressLocality": "Kilimani",
                "addressRegion": "Nairobi"
              },
              "offers": {
                "@type": "Offer",
                "price": "65000000",
                "priceCurrency": "KES"
              }
            }
          </script>
        `;
      }
      throw new Error("Unexpected URL");
    });

    const result = await discoverApprovedSource("buyrentkenya", repository, {
      fetchHtml,
      sleep: vi.fn(async () => {}),
      runAt: "2026-08-04T08:00:00.000Z",
    });

    expect(result).toEqual({
      sourceId: "buyrentkenya",
      candidateLinks: 1,
      imported: 1,
      failed: 0,
      verified: 0,
      refreshed: 0,
      delisted: 0,
      errors: [],
    });
    expect(repository.drafts[0]).toMatchObject({
      sourceId: "buyrentkenya",
      sourceUrl: detailUrl,
      title: { value: "Apartment block for sale", status: "reported" },
      county: { value: "Nairobi", status: "reported" },
      askingPriceKsh: { value: "65000000", status: "reported" },
    });
  });

  it("records detail failures without aborting the source run", async () => {
    const repository = new MemoryDiscoveryRepository();
    const source = getSourceById("buyrentkenya");
    const detailUrl =
      "https://www.buyrentkenya.com/listings/block-for-sale-kilimani-4000005";
    const fetchHtml = vi.fn(async (url: string) => {
      if (url === source.saleUrl) return `<a href="${detailUrl}">Listing</a>`;
      throw new Error("HTTP 503");
    });

    const result = await discoverApprovedSource("buyrentkenya", repository, {
      fetchHtml,
      sleep: vi.fn(async () => {}),
    });

    expect(result.imported).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain("HTTP 503");
  });

  it("rotates a paginated source through bounded result pages", async () => {
    const repository = new MemoryDiscoveryRepository();
    const source = getSourceById("jiji-kenya");
    const detailUrl =
      "https://jiji.co.ke/kitengela/houses-apartments-for-sale/block-of-flats-example.html";
    const requestedIndexes: string[] = [];
    const fetchHtml = vi.fn(async (url: string) => {
      if (url.startsWith(source.saleUrl)) {
        requestedIndexes.push(url);
        return `<a href="${detailUrl}">Block listing</a>`;
      }
      return '<html><head><meta property="og:title" content="Block of Flats for sale"></head><body>Kajiado</body></html>';
    });

    await discoverApprovedSource("jiji-kenya", repository, {
      fetchHtml,
      sleep: vi.fn(async () => {}),
    });
    await discoverApprovedSource("jiji-kenya", repository, {
      fetchHtml,
      sleep: vi.fn(async () => {}),
    });

    expect(requestedIndexes).toEqual([
      source.saleUrl,
      `${source.saleUrl}?page=2`,
    ]);
  });

  it("continues with later sources when an index is unavailable", async () => {
    const repository = new MemoryDiscoveryRepository();
    const equity = getSourceById("equity-assets");
    const buyRentKenya = getSourceById("buyrentkenya");
    const detailUrl =
      "https://www.buyrentkenya.com/listings/block-for-sale-kilimani-4000006";
    const fetchHtml = vi.fn(async (url: string) => {
      if (url === equity.saleUrl) throw new Error("HTTP 503");
      if (url === buyRentKenya.saleUrl) {
        return `<a href="${detailUrl}">Listing</a>`;
      }
      if (url === detailUrl) {
        return `
          <script type="application/ld+json">
            {
              "@type": "Accommodation",
              "name": "Apartment block for sale",
              "address": { "addressRegion": "Nairobi" }
            }
          </script>
        `;
      }
      throw new Error("Unexpected URL");
    });

    const results = await discoverAllApprovedSources(
      repository,
      ["equity-assets", "buyrentkenya"],
      { fetchHtml, sleep: vi.fn(async () => {}) },
    );

    expect(results[0]).toMatchObject({
      sourceId: "equity-assets",
      failed: 1,
      imported: 0,
    });
    expect(results[1]).toMatchObject({
      sourceId: "buyrentkenya",
      failed: 0,
      imported: 1,
    });
  });

  it("marks stored listings as delisted when re-fetch returns 404", async () => {
    const repository = new MemoryDiscoveryRepository();
    const source = getSourceById("jiji-kenya");
    const staleUrl =
      "https://jiji.co.ke/bamburi/houses-apartments-for-sale/expired-block-of-flats-example.html";
    repository.stale = [
      {
        id: "stale-1",
        sourceId: "jiji-kenya",
        sourceUrl: staleUrl,
        externalId: null,
        title: "Expired block",
        county: "Mombasa",
        submarket: "Bamburi",
        askingPriceKsh: null,
        status: "new",
        draft: {} as SaleListingImportDraft,
        firstSeenAt: "2026-07-01T00:00:00.000Z",
        lastSeenAt: "2026-07-01T00:00:00.000Z",
        reviewedAt: null,
      },
    ];
    const fetchHtml = vi.fn(async (url: string) => {
      if (url.startsWith(source.saleUrl)) return "";
      if (url === staleUrl) {
        throw new LiveSourceAccessError(
          "Jiji Kenya returned HTTP 404.",
          { status: 404, gone: true },
        );
      }
      throw new Error("Unexpected URL");
    });

    const result = await discoverApprovedSource("jiji-kenya", repository, {
      fetchHtml,
      sleep: vi.fn(async () => {}),
      runAt: "2026-09-01T00:00:00.000Z",
    });

    expect(result.verified).toBe(1);
    expect(result.delisted).toBe(1);
    expect(result.refreshed).toBe(0);
    expect(repository.delisted).toEqual(["stale-1"]);
  });

  it("refreshes a stored listing when the detail page still parses", async () => {
    const repository = new MemoryDiscoveryRepository();
    const source = getSourceById("jiji-kenya");
    const staleUrl =
      "https://jiji.co.ke/kasarani/houses-apartments-for-sale/active-block-of-flats-example.html";
    repository.stale = [
      {
        id: "stale-2",
        sourceId: "jiji-kenya",
        sourceUrl: staleUrl,
        externalId: null,
        title: "Active block",
        county: "Nairobi",
        submarket: "Kasarani",
        askingPriceKsh: null,
        status: "new",
        draft: {} as SaleListingImportDraft,
        firstSeenAt: "2026-07-01T00:00:00.000Z",
        lastSeenAt: "2026-07-01T00:00:00.000Z",
        reviewedAt: null,
      },
    ];
    const fetchHtml = vi.fn(async (url: string) => {
      if (url.startsWith(source.saleUrl)) return "";
      if (url === staleUrl) {
        return `
          <script type="application/ld+json">
            {
              "@type": "Accommodation",
              "name": "Refreshed block of flats",
              "address": { "addressRegion": "Nairobi" }
            }
          </script>
        `;
      }
      throw new Error("Unexpected URL");
    });

    const result = await discoverApprovedSource("jiji-kenya", repository, {
      fetchHtml,
      sleep: vi.fn(async () => {}),
      runAt: "2026-09-01T00:00:00.000Z",
    });

    expect(result.verified).toBe(1);
    expect(result.refreshed).toBe(1);
    expect(result.delisted).toBe(0);
    expect(repository.delisted).toEqual([]);
    expect(repository.drafts.at(-1)).toMatchObject({
      sourceId: "jiji-kenya",
      sourceUrl: staleUrl,
      title: { value: "Refreshed block of flats", status: "reported" },
    });
  });
});
