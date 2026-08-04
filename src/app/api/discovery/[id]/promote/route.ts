import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeListing, counties } from "@/domain";
import {
  DiscoveryPromotionConflictError,
  PostgresDiscoveryRepository,
  savePromotedDiscovery,
} from "@/db/discovery-repository";
import { confirmDraftCounty, promoteDraftToListing } from "@/sources/promote";

const requestSchema = z.object({
  confirmedCounty: z.enum(counties).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const discoveryRepository = new PostgresDiscoveryRepository();
  try {
    const rawBody = await request.text();
    let body: unknown = {};
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        return NextResponse.json(
          { error: "Malformed JSON body" },
          { status: 400 },
        );
      }
    }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Select a supported county", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const record = await discoveryRepository.get(id);
    if (!record) {
      return NextResponse.json(
        { error: "Discovered listing not found" },
        { status: 404 },
      );
    }
    if (record.status !== "new") {
      return NextResponse.json(
        { error: "Only new discovery records can be promoted" },
        { status: 409 },
      );
    }
    const draft = parsed.data.confirmedCounty
      ? confirmDraftCounty(record.draft, parsed.data.confirmedCounty)
      : record.draft;
    const listing = promoteDraftToListing(draft);
    const analysis = analyzeListing(listing);
    await savePromotedDiscovery(id, draft, listing, analysis);
    return NextResponse.json({ listingId: listing.id, analysis });
  } catch (error: unknown) {
    if (error instanceof DiscoveryPromotionConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to promote listing",
      },
      { status: 422 },
    );
  }
}
