import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchApprovedSourceHtml, LiveSourceAccessError } from "@/sources/http";
import { parseSaleListingHtml } from "@/sources/parser";

const requestSchema = z.object({
  url: z.string().url(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A valid source URL is required", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const html = await fetchApprovedSourceHtml(parsed.data.url);
    return NextResponse.json(parseSaleListingHtml(parsed.data.url, html));
  } catch (error: unknown) {
    if (error instanceof LiveSourceAccessError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 422 },
    );
  }
}
