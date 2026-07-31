CREATE TABLE "analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"result" jsonb NOT NULL,
	"analyzed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_name" text NOT NULL,
	"status" text NOT NULL,
	"details" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"county" text NOT NULL,
	"submarket" text NOT NULL,
	"source_adapter" text NOT NULL,
	"source_external_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analyses_listing_time_idx" ON "analyses" USING btree ("listing_id","analyzed_at");--> statement-breakpoint
CREATE INDEX "listings_county_submarket_idx" ON "listings" USING btree ("county","submarket");--> statement-breakpoint
CREATE INDEX "listings_source_idx" ON "listings" USING btree ("source_adapter","source_external_id");