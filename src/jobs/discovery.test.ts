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
      permissionBasis: "",
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
