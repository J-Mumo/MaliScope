import { propertyListingSchema, type PropertyListing } from "@/domain";
import type { DiscoveryContext, ListingSourceAdapter } from "./types";

export class ManualListingAdapter implements ListingSourceAdapter {
  readonly id = "manual";
  readonly permissionBasis = "User-supplied listing facts";

  constructor(private readonly records: unknown[]) {}

  async *discover(context: DiscoveryContext): AsyncIterable<PropertyListing> {
    for (const record of this.records) {
      const listing = propertyListingSchema.parse(record);
      yield {
        ...listing,
        provenance: {
          ...listing.provenance,
          adapter: this.id,
          capturedAt: context.runAt,
          permissionBasis: this.permissionBasis,
        },
        updatedAt: context.runAt,
      };
    }
  }
}
