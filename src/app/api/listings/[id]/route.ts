import { NextResponse } from "next/server";
import { PostgresListingRepository } from "@/db/repository";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const listing = await new PostgresListingRepository().getListing(id);
    if (!listing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }
    return NextResponse.json(listing);
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to load listing",
      },
      { status: 503 },
    );
  }
}
