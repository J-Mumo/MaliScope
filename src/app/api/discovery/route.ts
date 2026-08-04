import { NextResponse } from "next/server";
import { z } from "zod";
import { PostgresDiscoveryRepository } from "@/db/discovery-repository";
import { recordJobRun } from "@/db/repository";
import { discoverAllApprovedSources } from "@/sources/discovery-crawler";
import {
  discoveryStatuses,
  type DiscoveryFilters,
} from "@/sources/discovery-types";
import {
  isSourceApproved,
  sourceRegistry,
  websiteSourceIds,
} from "@/sources/registry";
import { preScreenDiscoveryDraft } from "@/sources/pre-screen";

const runSchema = z.object({
  sourceIds: z.array(z.enum(websiteSourceIds)).min(1).max(8),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sourceId = url.searchParams.get("source");
  const status = url.searchParams.get("status");
  const filters: DiscoveryFilters = {
    ...(sourceId && websiteSourceIds.includes(sourceId as never)
      ? { sourceId: sourceId as DiscoveryFilters["sourceId"] }
      : {}),
    ...(status && discoveryStatuses.includes(status as never)
      ? { status: status as DiscoveryFilters["status"] }
      : {}),
    ...(url.searchParams.get("county")
      ? { county: url.searchParams.get("county")! }
      : {}),
    ...(url.searchParams.get("search")
      ? { search: url.searchParams.get("search")! }
      : {}),
  };

  try {
    const records = await new PostgresDiscoveryRepository().list(filters);
    return NextResponse.json({
      records: records.map((record) => ({
        ...record,
        preScreen: preScreenDiscoveryDraft(record.draft),
      })),
      sources: sourceRegistry.map((source) => ({
        id: source.id,
        displayName: source.displayName,
        saleUrl: source.saleUrl,
        accessStatus: source.accessStatus,
        liveFetchEnabled: source.liveFetchEnabled,
      })),
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load discovered listings",
      },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        error:
          "Interactive discovery is disabled in production. Run the scheduled discovery job.",
      },
      { status: 403 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }
  const parsed = runSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Select one or more valid sources",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }
  const approvedIds = new Set(
    sourceRegistry.filter(isSourceApproved).map((source) => source.id),
  );
  if (parsed.data.sourceIds.some((sourceId) => !approvedIds.has(sourceId))) {
    return NextResponse.json(
      { error: "Every selected source must be approved and enabled" },
      { status: 403 },
    );
  }

  const startedAt = new Date();
  try {
    const results = await discoverAllApprovedSources(
      new PostgresDiscoveryRepository(),
      parsed.data.sourceIds,
    );
    await recordJobRun(
      "discover:websites:interactive",
      startedAt,
      "completed",
      {
        results,
      },
    );
    return NextResponse.json({ results });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await recordJobRun("discover:websites:interactive", startedAt, "failed", {
      message,
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
