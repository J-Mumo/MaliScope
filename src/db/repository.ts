import { desc, eq } from "drizzle-orm";
import type { AnalysisResult, PropertyListing } from "@/domain";
import { getDatabase } from "./client";
import { analyses, jobRuns, listings } from "./schema";

export interface ListingSummary {
  id: string;
  title: string;
  county: string;
  submarket: string;
  sourceAdapter: string;
  updatedAt: string;
}

export interface ListingRepository {
  saveListing(listing: PropertyListing): Promise<void>;
  saveAnalysis(result: AnalysisResult): Promise<void>;
  saveListingWithAnalysis(
    listing: PropertyListing,
    result: AnalysisResult,
  ): Promise<void>;
  listListings(): Promise<ListingSummary[]>;
  getListing(id: string): Promise<PropertyListing | null>;
  getAllListings(): Promise<PropertyListing[]>;
}

export class PostgresListingRepository implements ListingRepository {
  async saveListing(listing: PropertyListing): Promise<void> {
    const db = getDatabase();
    await db
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
  }

  async saveAnalysis(result: AnalysisResult): Promise<void> {
    await getDatabase()
      .insert(analyses)
      .values({
        listingId: result.listingId,
        result,
        analyzedAt: new Date(result.analyzedAt),
      });
  }

  async saveListingWithAnalysis(
    listing: PropertyListing,
    result: AnalysisResult,
  ): Promise<void> {
    await getDatabase().transaction(async (transaction) => {
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

  async listListings(): Promise<ListingSummary[]> {
    const rows = await getDatabase()
      .select({
        id: listings.id,
        title: listings.title,
        county: listings.county,
        submarket: listings.submarket,
        sourceAdapter: listings.sourceAdapter,
        updatedAt: listings.updatedAt,
      })
      .from(listings)
      .orderBy(desc(listings.updatedAt));

    return rows.map((row) => ({
      ...row,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async getListing(id: string): Promise<PropertyListing | null> {
    const [row] = await getDatabase()
      .select({ payload: listings.payload })
      .from(listings)
      .where(eq(listings.id, id))
      .limit(1);
    return row?.payload ?? null;
  }

  async getAllListings(): Promise<PropertyListing[]> {
    const rows = await getDatabase()
      .select({ payload: listings.payload })
      .from(listings);
    return rows.map((row) => row.payload);
  }
}

export async function recordJobRun(
  jobName: string,
  startedAt: Date,
  status: "completed" | "failed",
  details: Record<string, unknown>,
): Promise<void> {
  await getDatabase().insert(jobRuns).values({
    jobName,
    status,
    details,
    startedAt,
    completedAt: new Date(),
  });
}
