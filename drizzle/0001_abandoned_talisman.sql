CREATE TABLE "discovered_listings" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"source_url" text NOT NULL,
	"external_id" text,
	"title" text,
	"county" text,
	"submarket" text,
	"asking_price_ksh" text,
	"status" text DEFAULT 'new' NOT NULL,
	"draft" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "discovered_listings_source_url_unique" UNIQUE("source_url")
);
--> statement-breakpoint
CREATE INDEX "discovered_source_status_idx" ON "discovered_listings" USING btree ("source_id","status");--> statement-breakpoint
CREATE INDEX "discovered_county_seen_idx" ON "discovered_listings" USING btree ("county","last_seen_at");