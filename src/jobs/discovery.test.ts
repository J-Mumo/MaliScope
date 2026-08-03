import { describe, expect, it } from "vitest";
import {
  seededListing,
  type AnalysisResult,
  type PropertyListing,
} from "@/domain";
import type { ListingRepository, ListingSummary } from "@/db/repository";
import { SampleListingAdapter } from "@/sources/sample-adapter";
import type { ListingSourceAdapter } from "@/sources/types";
import { runDiscoveryJob, runReanalysisJob } from "./discovery";

class MemoryRepository implements ListingRepository {
  listings = new Map<string, PropertyListing>();
  analyses: AnalysisResult[] = [];

  async saveListing(listing: PropertyListing) {
    this.listings.set(listing.id, listing);
  }

  async saveAnalysis(result: AnalysisResult) {
    this.analyses.push(result);
  }

  async saveListingWithAnalysis(
    listing: PropertyListing,
    result: AnalysisResult,
  ) {
    await this.saveListing(listing);
    await this.saveAnalysis(result);
  }

  async listListings(): Promise<ListingSummary[]> {
    return [...this.listings.values()].map((listing) => ({
      id: listing.id,
      title: listing.title,
      county: listing.county,
      submarket: listing.submarket,
      sourceAdapter: listing.provenance.adapter,
      updatedAt: listing.updatedAt,
    }));
  }

  async getListing(id: string) {
    return this.listings.get(id) ?? null;
  }

  async getAllListings() {
    return [...this.listings.values()];
  }
}

describe("safe discovery and scheduled re-analysis", () => {
  it("ingests and analyzes the synthetic adapter", async () => {
    const repository = new MemoryRepository();
    const result = await runDiscoveryJob(
      new SampleListingAdapter(),
      repository,
      "2026-01-01T00:00:00.000Z",
    );

    expect(result).toEqual({
      adapterId: "sample",
      discovered: 1,
      persisted: 1,
      analyzed: 1,
    });
    expect(
      repository.listings.get(seededListing.id)?.provenance.permissionBasis,
    ).toContain("synthetic");
  });

  it("refuses an adapter without a documented permission basis", async () => {
    const adapter: ListingSourceAdapter = {
      id: "unapproved-portal",
      accessKind: "website",
      websiteSourceId: "buyrentkenya",
      permissionBasis: "",
      async *discover() {
        yield seededListing;
      },
    };

    await expect(
      runDiscoveryJob(adapter, new MemoryRepository()),
    ).rejects.toThrow("no documented permission basis");
  });

  it("refuses a website adapter with an unapproved registry entry", async () => {
    const repository = new MemoryRepository();
    let discoveryStarted = false;
    const adapter: ListingSourceAdapter = {
      id: "premature-buyrentkenya",
      accessKind: "website",
      websiteSourceId: "buyrentkenya",
      permissionBasis: "Unreviewed placeholder",
      async *discover() {
        discoveryStarted = true;
        yield seededListing;
      },
    };

    await expect(runDiscoveryJob(adapter, repository)).rejects.toThrow(
      "no documented permission basis",
    );
    expect(discoveryStarted).toBe(false);
    expect(repository.listings.size).toBe(0);
  });

  it("does not permit arbitrary adapters to self-classify as offline", async () => {
    let discoveryStarted = false;
    const adapter: ListingSourceAdapter = {
      id: "unregistered-offline-adapter",
      accessKind: "offline",
      permissionBasis: "Self-declared permission",
      async *discover() {
        discoveryStarted = true;
        yield seededListing;
      },
    };

    await expect(
      runDiscoveryJob(adapter, new MemoryRepository()),
    ).rejects.toThrow("no documented permission basis");
    expect(discoveryStarted).toBe(false);
  });

  it("does not trust copied IDs and permission strings", async () => {
    const adapter: ListingSourceAdapter = {
      id: "manual",
      accessKind: "offline",
      permissionBasis: "User-supplied listing facts",
      async *discover() {
        yield seededListing;
      },
    };

    await expect(
      runDiscoveryJob(adapter, new MemoryRepository()),
    ).rejects.toThrow("no documented permission basis");
  });

  it("does not trust a spoofed constructor property", async () => {
    const adapter = {
      id: "sample",
      accessKind: "offline" as const,
      permissionBasis: "Bundled synthetic fixture; no third-party portal data",
      constructor: SampleListingAdapter,
      async *discover() {
        yield seededListing;
      },
    };

    await expect(
      runDiscoveryJob(adapter, new MemoryRepository()),
    ).rejects.toThrow("no documented permission basis");
  });

  it("re-analyzes every persisted listing", async () => {
    const repository = new MemoryRepository();
    await repository.saveListing(structuredClone(seededListing));
    const result = await runReanalysisJob(
      repository,
      "2026-01-02T00:00:00.000Z",
    );

    expect(result).toEqual({ analyzed: 1 });
    expect(repository.analyses[0]?.analyzedAt).toBe("2026-01-02T00:00:00.000Z");
  });
});
