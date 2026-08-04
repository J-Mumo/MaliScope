import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { AnalysisResult, PropertyListing } from "@/domain";
import type { SaleListingImportDraft } from "@/sources/import-types";
import type {
  DiscoveryFilters,
  DiscoveryRecord,
  DiscoveryStatus,
} from "@/sources/discovery-types";
import { getDatabase } from "./client";
import {
  analyses,
  discoveredListings,
  discoverySourceCursors,
  listings,
} from "./schema";

export interface DiscoveryRepository {
  claimSourcePage(sourceId: string, pageCount: number): Promise<number>;
  upsertDraft(draft: SaleListingImportDraft): Promise<void>;
  list(filters?: DiscoveryFilters): Promise<DiscoveryRecord[]>;
  get(id: string): Promise<DiscoveryRecord | null>;
  setStatus(id: string, status: DiscoveryStatus): Promise<void>;
}

export function discoveryRecordId(draft: SaleListingImportDraft): string {
  return createHash("sha256")
    .update(`${draft.sourceId}:${draft.sourceUrl}`)
    .digest("hex");
}

function toRecord(
  row: typeof discoveredListings.$inferSelect,
): DiscoveryRecord {
  return {
    ...row,
    status: row.status as DiscoveryStatus,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

export class PostgresDiscoveryRepository implements DiscoveryRepository {
  async claimSourcePage(sourceId: string, pageCount: number): Promise<number> {
    const now = new Date();
    const [cursor] = await getDatabase()
      .insert(discoverySourceCursors)
      .values({ sourceId, currentPage: 1, updatedAt: now })
      .onConflictDoUpdate({
        target: discoverySourceCursors.sourceId,
        set: {
          currentPage: sql<number>`CASE
            WHEN ${discoverySourceCursors.currentPage} >= ${pageCount}
            THEN 1
            ELSE ${discoverySourceCursors.currentPage} + 1
          END`,
          updatedAt: now,
        },
      })
      .returning({ page: discoverySourceCursors.currentPage });
    if (!cursor)
      throw new Error(`Could not claim a discovery page for ${sourceId}`);
    return cursor.page;
  }

  async upsertDraft(draft: SaleListingImportDraft): Promise<void> {
    const seenAt = new Date(draft.capturedAt);
    await getDatabase()
      .insert(discoveredListings)
      .values({
        id: discoveryRecordId(draft),
        sourceId: draft.sourceId,
        sourceUrl: draft.sourceUrl,
        externalId: draft.externalId,
        title: draft.title.value,
        county: draft.county.value,
        submarket: draft.submarket.value,
        askingPriceKsh: draft.askingPriceKsh.value,
        contentHash: draft.extractedRecordSha256,
        status: "new",
        draft,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
      })
      .onConflictDoUpdate({
        target: discoveredListings.sourceUrl,
        set: {
          externalId: draft.externalId,
          title: draft.title.value,
          county: sql<string | null>`CASE
            WHEN ${discoveredListings.contentHash} IS DISTINCT FROM EXCLUDED.content_hash
            THEN EXCLUDED.county
            ELSE ${discoveredListings.county}
          END`,
          submarket: draft.submarket.value,
          askingPriceKsh: draft.askingPriceKsh.value,
          contentHash: draft.extractedRecordSha256,
          status: sql`CASE
            WHEN ${discoveredListings.contentHash} IS DISTINCT FROM EXCLUDED.content_hash
            THEN 'new'
            ELSE ${discoveredListings.status}
          END`,
          reviewedAt: sql`CASE
            WHEN ${discoveredListings.contentHash} IS DISTINCT FROM EXCLUDED.content_hash
            THEN NULL
            ELSE ${discoveredListings.reviewedAt}
          END`,
          draft: sql<SaleListingImportDraft>`CASE
            WHEN ${discoveredListings.contentHash} IS DISTINCT FROM EXCLUDED.content_hash
            THEN EXCLUDED.draft
            ELSE ${discoveredListings.draft}
          END`,
          lastSeenAt: seenAt,
        },
      });
  }

  async list(filters: DiscoveryFilters = {}): Promise<DiscoveryRecord[]> {
    const conditions: SQL[] = [];
    if (filters.sourceId) {
      conditions.push(eq(discoveredListings.sourceId, filters.sourceId));
    }
    if (filters.county) {
      conditions.push(eq(discoveredListings.county, filters.county));
    }
    if (filters.status) {
      conditions.push(eq(discoveredListings.status, filters.status));
    }
    const search = filters.search?.trim();
    if (search) {
      conditions.push(
        or(
          ilike(discoveredListings.title, `%${search}%`),
          ilike(discoveredListings.submarket, `%${search}%`),
          ilike(discoveredListings.sourceUrl, `%${search}%`),
        )!,
      );
    }

    const rows = await getDatabase()
      .select()
      .from(discoveredListings)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(discoveredListings.lastSeenAt))
      .limit(250);
    return rows.map(toRecord);
  }

  async get(id: string): Promise<DiscoveryRecord | null> {
    const [row] = await getDatabase()
      .select()
      .from(discoveredListings)
      .where(eq(discoveredListings.id, id))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async setStatus(id: string, status: DiscoveryStatus): Promise<void> {
    const result = await getDatabase()
      .update(discoveredListings)
      .set({
        status,
        reviewedAt: status === "reviewed" ? new Date() : null,
      })
      .where(eq(discoveredListings.id, id))
      .returning({ id: discoveredListings.id });
    if (result.length === 0) throw new Error("Discovered listing not found");
  }
}

export class DiscoveryPromotionConflictError extends Error {
  constructor() {
    super("This discovery record is no longer available for promotion.");
    this.name = "DiscoveryPromotionConflictError";
  }
}

export async function savePromotedDiscovery(
  discoveryId: string,
  draft: SaleListingImportDraft,
  listing: PropertyListing,
  result: AnalysisResult,
): Promise<void> {
  await getDatabase().transaction(async (transaction) => {
    const promoted = await transaction
      .update(discoveredListings)
      .set({
        county: draft.county.value,
        draft,
        status: "reviewed",
        reviewedAt: new Date(),
      })
      .where(
        and(
          eq(discoveredListings.id, discoveryId),
          eq(discoveredListings.status, "new"),
          eq(discoveredListings.contentHash, draft.extractedRecordSha256),
        ),
      )
      .returning({ id: discoveredListings.id });
    if (promoted.length === 0) throw new DiscoveryPromotionConflictError();

    await transaction
      .insert(listings)
      .values({
        id: listing.id,
        title: listing.title,
        county: listing.county,
        submarket: listing.submarket,
        sourceAdapter: listing.provenance.adapter,
        sourceExternalId: listing.provenance.externalId,
        payload: listing,
        createdAt: new Date(listing.createdAt),
        updatedAt: new Date(listing.updatedAt),
      })
      .onConflictDoUpdate({
        target: listings.id,
        set: {
          title: listing.title,
          county: listing.county,
          submarket: listing.submarket,
          sourceAdapter: listing.provenance.adapter,
          sourceExternalId: listing.provenance.externalId,
          payload: listing,
          updatedAt: new Date(listing.updatedAt),
        },
      });
    await transaction.insert(analyses).values({
      listingId: result.listingId,
      result,
      analyzedAt: new Date(result.analyzedAt),
    });
  });
}
