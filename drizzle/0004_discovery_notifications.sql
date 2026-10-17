CREATE TABLE "discovery_notifications" (
  "id" serial PRIMARY KEY NOT NULL,
  "discovery_id" text NOT NULL REFERENCES "discovered_listings"("id") ON DELETE CASCADE,
  "content_hash" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "sent_at" timestamp with time zone,
  CONSTRAINT "discovery_notifications_version_unique" UNIQUE("discovery_id", "content_hash")
);
CREATE INDEX "discovery_notifications_status_idx" ON "discovery_notifications" USING btree ("status", "created_at");
CREATE INDEX "discovery_notifications_listing_idx" ON "discovery_notifications" USING btree ("discovery_id");
