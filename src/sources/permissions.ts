import {
  propertyListingSchema,
  seededListing,
  type PropertyListing,
} from "@/domain";
import { getSourceById, isSourceApproved } from "./registry";
import {
  SourcePermissionError,
  type DiscoveryContext,
  type ListingSourceAdapter,
} from "./types";

const trustedOfflineAdapters = new WeakSet<ListingSourceAdapter>();

export class SampleListingAdapter implements ListingSourceAdapter {
  readonly id = "sample";
  readonly accessKind = "offline";
  readonly permissionBasis =
    "Bundled synthetic fixture; no third-party portal data";

  constructor() {
    trustedOfflineAdapters.add(this);
  }

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

export class ManualListingAdapter implements ListingSourceAdapter {
  readonly id = "manual";
  readonly accessKind = "offline";
  readonly permissionBasis = "User-supplied listing facts";

  constructor(private readonly records: unknown[]) {
    trustedOfflineAdapters.add(this);
  }

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

export function assertAdapterPermitted(adapter: ListingSourceAdapter): void {
  if (!adapter.permissionBasis.trim()) {
    throw new SourcePermissionError(adapter.id);
  }
  if (adapter.accessKind === "offline") {
    if (!trustedOfflineAdapters.has(adapter)) {
      throw new SourcePermissionError(adapter.id);
    }
    return;
  }

  if (!adapter.websiteSourceId) throw new SourcePermissionError(adapter.id);
  const source = getSourceById(adapter.websiteSourceId);
  if (
    !isSourceApproved(source) ||
    source.permissionBasis !== adapter.permissionBasis
  ) {
    throw new SourcePermissionError(adapter.id);
  }
}
