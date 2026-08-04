CREATE TABLE "discovery_source_cursors" (
	"source_id" text PRIMARY KEY NOT NULL,
	"current_page" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
