import type { SaleListingImportDraft } from "./import-types";
import type { DiscoveryPreScreen } from "./pre-screen";
import type { WebsiteSourceId } from "./registry";

export const discoveryStatuses = [
  "new",
  "reviewed",
  "ignored",
  "delisted",
] as const;
export type DiscoveryStatus = (typeof discoveryStatuses)[number];

export interface DiscoveryFilters {
  sourceId?: WebsiteSourceId;
  county?: string;
  status?: DiscoveryStatus;
  search?: string;
  includeDelisted?: boolean;
}

export interface DiscoveryRecord {
  id: string;
  sourceId: string;
  sourceUrl: string;
  externalId: string | null;
  title: string | null;
  county: string | null;
  submarket: string | null;
  askingPriceKsh: string | null;
  status: DiscoveryStatus;
  draft: SaleListingImportDraft;
  firstSeenAt: string;
  lastSeenAt: string;
  reviewedAt: string | null;
  preScreen?: DiscoveryPreScreen;
}
