ALTER TABLE "discovered_listings" ADD COLUMN "content_hash" text;--> statement-breakpoint
UPDATE "discovered_listings"
SET "content_hash" = "draft"->>'extractedRecordSha256'
WHERE "content_hash" IS NULL;--> statement-breakpoint
ALTER TABLE "discovered_listings" ALTER COLUMN "content_hash" SET NOT NULL;