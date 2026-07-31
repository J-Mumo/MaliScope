import { NextResponse } from "next/server";
import { analyzeListing, propertyListingSchema } from "@/domain";

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

  return NextResponse.json(analyzeListing(parsed.data));
}
