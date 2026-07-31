import { seededListing } from "@/domain";
import type { DiscoveryContext, ListingSourceAdapter } from "./types";

export class SampleListingAdapter implements ListingSourceAdapter {
  readonly id = "sample";
  readonly permissionBasis =
    "Bundled synthetic fixture; no third-party portal data";

  async *discover(context: DiscoveryContext) {
    yield {
      ...structuredClone(seededListing),
      provenance: {
        ...seededListing.provenance,
        capturedAt: context.runAt,
        permissionBasis: this.permissionBasis,
      },
      updatedAt: context.runAt,
    };
  }
}
