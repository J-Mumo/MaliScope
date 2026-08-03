export const websiteSourceIds = [
  "equity-assets",
  "hf-marketplace",
  "jiji-kenya",
  "kenya-property-centre",
  "propertypro-kenya",
  "buyrentkenya",
  "hassconsult",
  "knight-frank-kenya",
] as const;

export type WebsiteSourceId = (typeof websiteSourceIds)[number];
export type SourceAccessStatus =
  "approved" | "pending_permission" | "manual_only" | "blocked";
export type SourceParserKind =
  "schema_org" | "marketplace_html" | "meta_fallback";

export interface SourceRegistryEntry {
  id: WebsiteSourceId;
  displayName: string;
  saleUrl: string;
  hosts: readonly string[];
  accessStatus: SourceAccessStatus;
  parserKind: SourceParserKind;
  permissionBasis: string | null;
  agreementRef: string | null;
  approvedAt: string | null;
  reviewedBy: string | null;
  userAgent: string | null;
  liveFetchEnabled: boolean;
  knownLimitations: readonly string[];
}

export const sourceRegistry: readonly SourceRegistryEntry[] = [
  {
    id: "equity-assets",
    displayName: "Equity Assets",
    saleUrl: "https://equitygroupholdings.com/ke/equity-assets/",
    hosts: ["equitygroupholdings.com", "www.equitygroupholdings.com"],
    accessStatus: "manual_only",
    parserKind: "meta_fallback",
    permissionBasis: null,
    agreementRef: null,
    approvedAt: null,
    reviewedBy: null,
    userAgent: null,
    liveFetchEnabled: false,
    knownLimitations: [
      "Terms and robots rules require live verification.",
      "Reserve prices are not equivalent to market value.",
      "Rent roll and occupancy are generally unavailable.",
    ],
  },
  {
    id: "hf-marketplace",
    displayName: "HF Marketplace",
    saleUrl: "https://hfmarketplace.hfcb.co.ke/",
    hosts: ["hfmarketplace.hfcb.co.ke"],
    accessStatus: "pending_permission",
    parserKind: "marketplace_html",
    permissionBasis: null,
    agreementRef: null,
    approvedAt: null,
    reviewedBy: null,
    userAgent: null,
    liveFetchEnabled: false,
    knownLimitations: [
      "No public feed or API is documented.",
      "Distressed and developer stock must be distinguished.",
      "Rent roll and occupancy are generally unavailable.",
    ],
  },
  {
    id: "jiji-kenya",
    displayName: "Jiji Kenya",
    saleUrl: "https://jiji.co.ke/houses-apartments-for-sale",
    hosts: ["jiji.co.ke", "www.jiji.co.ke"],
    accessStatus: "manual_only",
    parserKind: "meta_fallback",
    permissionBasis: null,
    agreementRef: null,
    approvedAt: null,
    reviewedBy: null,
    userAgent: null,
    liveFetchEnabled: false,
    knownLimitations: [
      "Classified listings have high duplicate and stale-record risk.",
      "Most inventory is individual units rather than whole blocks.",
      "No public API or feed is documented.",
    ],
  },
  {
    id: "kenya-property-centre",
    displayName: "Kenya Property Centre",
    saleUrl: "https://kenyapropertycentre.com/for-sale/",
    hosts: ["kenyapropertycentre.com", "www.kenyapropertycentre.com"],
    accessStatus: "pending_permission",
    parserKind: "marketplace_html",
    permissionBasis: null,
    agreementRef: null,
    approvedAt: null,
    reviewedBy: null,
    userAgent: null,
    liveFetchEnabled: false,
    knownLimitations: [
      "No public API is documented.",
      "Unit mix may appear only in free-form descriptions.",
      "Current rents and occupancy are usually absent.",
    ],
  },
  {
    id: "propertypro-kenya",
    displayName: "PropertyPro Kenya",
    saleUrl: "https://www.propertypro.co.ke/property-for-sale/property/",
    hosts: ["propertypro.co.ke", "www.propertypro.co.ke"],
    accessStatus: "blocked",
    parserKind: "meta_fallback",
    permissionBasis: null,
    agreementRef: null,
    approvedAt: null,
    reviewedBy: null,
    userAgent: null,
    liveFetchEnabled: false,
    knownLimitations: [
      "Search and filter paths are restricted by the published crawl policy.",
      "No usable public API or listing sitemap was identified.",
      "Whole-apartment-block relevance appears low.",
    ],
  },
  {
    id: "buyrentkenya",
    displayName: "BuyRentKenya",
    saleUrl: "https://www.buyrentkenya.com/property-for-sale",
    hosts: ["buyrentkenya.com", "www.buyrentkenya.com"],
    accessStatus: "pending_permission",
    parserKind: "schema_org",
    permissionBasis: null,
    agreementRef: null,
    approvedAt: null,
    reviewedBy: null,
    userAgent: null,
    liveFetchEnabled: false,
    knownLimitations: [
      "Terms require prior written consent for automated extraction.",
      "Whole blocks are not a consistently structured property type.",
      "Current rents may appear only in descriptions; occupancy is absent.",
    ],
  },
  {
    id: "hassconsult",
    displayName: "HassConsult",
    saleUrl: "https://www.hassconsult.com/properties/",
    hosts: ["hassconsult.com", "www.hassconsult.com"],
    accessStatus: "manual_only",
    parserKind: "schema_org",
    permissionBasis: null,
    agreementRef: null,
    approvedAt: null,
    reviewedBy: null,
    userAgent: null,
    liveFetchEnabled: false,
    knownLimitations: [
      "Whole-block inventory appears limited.",
      "No public listing API or feed is documented.",
      "Research-report licensing is separate from listing permission.",
    ],
  },
  {
    id: "knight-frank-kenya",
    displayName: "Knight Frank Kenya",
    saleUrl: "https://www.knightfrank.co.ke/properties/residential/for-sale",
    hosts: ["knightfrank.co.ke", "www.knightfrank.co.ke"],
    accessStatus: "pending_permission",
    parserKind: "schema_org",
    permissionBasis: null,
    agreementRef: null,
    approvedAt: null,
    reviewedBy: null,
    userAgent: null,
    liveFetchEnabled: false,
    knownLimitations: [
      "No public listing API or feed is documented.",
      "Investment listings may use price-on-application.",
      "Rent rolls are normally available only through an agent process.",
    ],
  },
] as const;

export function parseSourceUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new Error(
      "Source URLs must use HTTPS without credentials or custom ports.",
    );
  }
  return url;
}

export function findSourceByUrl(value: string): SourceRegistryEntry | null {
  const url = parseSourceUrl(value);
  const hostname = url.hostname.toLowerCase();
  return (
    sourceRegistry.find((source) =>
      source.hosts.some((host) => host === hostname),
    ) ?? null
  );
}

export function getSourceById(id: WebsiteSourceId): SourceRegistryEntry {
  const source = sourceRegistry.find((candidate) => candidate.id === id);
  if (!source) throw new Error(`Unknown source registry entry: ${id}`);
  return source;
}

export function isSourceApproved(
  source: SourceRegistryEntry,
): source is SourceRegistryEntry & {
  accessStatus: "approved";
  permissionBasis: string;
  agreementRef: string;
  approvedAt: string;
  reviewedBy: string;
  userAgent: string;
  liveFetchEnabled: true;
} {
  return Boolean(
    source.accessStatus === "approved" &&
    source.liveFetchEnabled &&
    source.permissionBasis?.trim() &&
    source.agreementRef?.trim() &&
    source.approvedAt &&
    source.reviewedBy?.trim() &&
    source.userAgent?.trim(),
  );
}
