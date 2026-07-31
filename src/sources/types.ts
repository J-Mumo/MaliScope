import type { PropertyListing } from "@/domain";

export interface DiscoveryContext {
  runAt: string;
}

export interface ListingSourceAdapter {
  readonly id: string;
  readonly permissionBasis: string;
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

export function assertAdapterPermitted(adapter: ListingSourceAdapter): void {
  if (!adapter.permissionBasis.trim()) {
    throw new SourcePermissionError(adapter.id);
  }
}
