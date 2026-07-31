import { NextResponse } from "next/server";
import { analyzeListing, propertyListingSchema } from "@/domain";
import { PostgresListingRepository } from "@/db/repository";

const repository = new PostgresListingRepository();

export async function GET() {
  try {
    return NextResponse.json(await repository.listListings());
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to list properties",
      },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const parsed = propertyListingSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid listing", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const analysis = analyzeListing(parsed.data);
    await repository.saveListingWithAnalysis(parsed.data, analysis);
    return NextResponse.json(
      { listing: parsed.data, analysis },
      { status: 201 },
    );
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to save property",
      },
      { status: 503 },
    );
  }
}
