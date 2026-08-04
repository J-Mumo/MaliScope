import { closeDatabase } from "@/db/client";
import { PostgresDiscoveryRepository } from "@/db/discovery-repository";
import { recordJobRun } from "@/db/repository";
import { discoverAllApprovedSources } from "@/sources/discovery-crawler";
import { isSourceApproved, sourceRegistry } from "@/sources/registry";

async function main() {
  const startedAt = new Date();
  const sourceIds = sourceRegistry
    .filter(isSourceApproved)
    .map((source) => source.id);
  try {
    const results = await discoverAllApprovedSources(
      new PostgresDiscoveryRepository(),
      sourceIds,
    );
    await recordJobRun("discover:websites", startedAt, "completed", {
      results,
    });
    console.log(JSON.stringify(results, null, 2));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await recordJobRun("discover:websites", startedAt, "failed", { message });
    throw error;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
