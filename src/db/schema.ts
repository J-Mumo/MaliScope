import {
  index,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { AnalysisResult, PropertyListing } from "@/domain";

export const listings = pgTable(
  "listings",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    county: text("county").notNull(),
    submarket: text("submarket").notNull(),
    sourceAdapter: text("source_adapter").notNull(),
    sourceExternalId: text("source_external_id"),
    payload: jsonb("payload").$type<PropertyListing>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("listings_county_submarket_idx").on(table.county, table.submarket),
    index("listings_source_idx").on(
      table.sourceAdapter,
      table.sourceExternalId,
    ),
  ],
);

export const analyses = pgTable(
  "analyses",
  {
    id: serial("id").primaryKey(),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    result: jsonb("result").$type<AnalysisResult>().notNull(),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("analyses_listing_time_idx").on(table.listingId, table.analyzedAt),
  ],
);

export const jobRuns = pgTable("job_runs", {
  id: serial("id").primaryKey(),
  jobName: text("job_name").notNull(),
  status: text("status").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
