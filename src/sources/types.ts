import type { PropertyListing } from "@/domain";
import type { WebsiteSourceId } from "./registry";

export interface DiscoveryContext {
  runAt: string;
}

export interface ListingSourceAdapter {
  readonly id: string;
  readonly permissionBasis: string;
  readonly accessKind: "offline" | "website";
  readonly websiteSourceId?: WebsiteSourceId;
  discover(context: DiscoveryContext): AsyncIterable<PropertyListing>;
}

export class SourcePermissionError extends Error {
  constructor(adapterId: string) {
    super(
      `Source adapter "${adapterId}" has no documented permission basis and cannot run.`,
    );
    this.name = "SourcePermissionError";
  }
}
