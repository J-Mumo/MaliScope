import { analyzeListing, propertyListingSchema } from "@/domain";
import type { ListingRepository } from "@/db/repository";
import {
  assertAdapterPermitted,
  type ListingSourceAdapter,
} from "@/sources/types";

export interface DiscoveryJobResult {
  adapterId: string;
  discovered: number;
  persisted: number;
  analyzed: number;
}

export async function runDiscoveryJob(
  adapter: ListingSourceAdapter,
  repository: ListingRepository,
  runAt = new Date().toISOString(),
): Promise<DiscoveryJobResult> {
  assertAdapterPermitted(adapter);
  const result: DiscoveryJobResult = {
    adapterId: adapter.id,
    discovered: 0,
    persisted: 0,
    analyzed: 0,
  };

  for await (const candidate of adapter.discover({ runAt })) {
    result.discovered += 1;
    const listing = propertyListingSchema.parse(candidate);
    const analysis = analyzeListing(listing, runAt);
    await repository.saveListingWithAnalysis(listing, analysis);
    result.persisted += 1;
    result.analyzed += 1;
  }

  return result;
}

export async function runReanalysisJob(
  repository: ListingRepository,
  runAt = new Date().toISOString(),
): Promise<{ analyzed: number }> {
  const listings = await repository.getAllListings();
  for (const listing of listings) {
    await repository.saveAnalysis(analyzeListing(listing, runAt));
  }
  return { analyzed: listings.length };
}
