import type { ListingRepository } from "@/db/repository";
import type { ListingSourceAdapter } from "@/sources/types";
import { runDiscoveryJob, runReanalysisJob } from "./discovery";

export interface ScheduledJob {
  name: string;
  schedule: string;
  run(): Promise<Record<string, unknown>>;
}

export function createScheduledJobs(
  repository: ListingRepository,
  adapters: ListingSourceAdapter[],
): ScheduledJob[] {
  return [
    ...adapters.map((adapter) => ({
      name: `discover:${adapter.id}`,
      schedule: "0 5 * * *",
      run: async () => runDiscoveryJob(adapter, repository),
    })),
    {
      name: "reanalyze:all",
      schedule: "0 6 * * *",
      run: async () => runReanalysisJob(repository),
    },
  ];
}
