import { analyzeListing, seededListing } from "@/domain";
import { closeDatabase } from "@/db/client";
import { PostgresListingRepository } from "@/db/repository";
import { runDiscoveryJob } from "./discovery";
import { SampleListingAdapter } from "@/sources/sample-adapter";

async function main() {
  if (!process.env.DATABASE_URL) {
    const result = analyzeListing(seededListing);
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          note: "DATABASE_URL is not set; no data was persisted.",
          adapter: "sample",
          recommendation: result.recommendationLabel,
          maximumAllowableOfferKsh: result.maximumAllowableOfferKsh,
        },
        null,
        2,
      ),
    );
    return;
  }

  const result = await runDiscoveryJob(
    new SampleListingAdapter(),
    new PostgresListingRepository(),
  );
  console.log(JSON.stringify({ mode: "persisted", ...result }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
