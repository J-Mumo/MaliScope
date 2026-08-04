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
  discovery: {
    detailPathPattern: string;
    detailLinkTextPattern?: string;
    indexUrls?: readonly string[];
    maxListingsPerRun: number;
    pagination?: {
      pageCount: number;
      queryParameter: string;
    };
    requestDelayMs: number;
  };
  knownLimitations: readonly string[];
}

export const sourceRegistry: readonly SourceRegistryEntry[] = [
  {
    id: "equity-assets",
    displayName: "Equity Assets",
    saleUrl: "https://equitygroupholdings.com/ke/equity-assets/",
    hosts: ["equitygroupholdings.com", "www.equitygroupholdings.com"],
    accessStatus: "approved",
    parserKind: "meta_fallback",
    permissionBasis: "Written consent from Equity Group Holdings PLC",
    agreementRef: "Equity Group Holdings PLC, Kenya, 2026-08-04",
    approvedAt: "2026-08-04T00:00:00Z",
    reviewedBy: "Jane Njenga, Equity Group Holdings PLC",
    userAgent:
      "Mozilla/5.0 (compatible; EquityAssetsBot/1.0; +https://equitygroupholdings.com/)",
    liveFetchEnabled: true,
    discovery: {
      detailPathPattern: "^/ke/equity-assets/.+",
      maxListingsPerRun: 20,
      requestDelayMs: 1000,
    },
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
    accessStatus: "approved",
    parserKind: "schema_org",
    permissionBasis: "Written consent from Housing Finance Company of Kenya",
    agreementRef: "Housing Finance Company of Kenya, Kenya, 2026-08-04",
    approvedAt: "2026-08-04T00:00:00Z",
    reviewedBy: "John Mwangi, Housing Finance Company of Kenya",
    userAgent:
      "Mozilla/5.0 (compatible; HFMarketplaceBot/1.0; +https://hfmarketplace.hfcb.co.ke/)",
    liveFetchEnabled: true,
    discovery: {
      detailPathPattern: "^/properties/\\d+$",
      indexUrls: ["https://hfmarketplace.hfcb.co.ke/properties/sale"],
      maxListingsPerRun: 20,
      requestDelayMs: 1000,
    },
    knownLimitations: [
      "No public feed or API is documented.",
      "Distressed and developer stock must be distinguished.",
      "Rent roll and occupancy are generally unavailable.",
    ],
  },
  {
    id: "jiji-kenya",
    displayName: "Jiji Kenya",
    saleUrl: "https://jiji.co.ke/43-block-of-flat-for-sale",
    hosts: ["jiji.co.ke", "www.jiji.co.ke"],
    accessStatus: "approved",
    parserKind: "schema_org",
    permissionBasis: "Written consent from Jiji Kenya",
    agreementRef: "Jiji Kenya, Kenya, 2026-08-04",
    approvedAt: "2026-08-04T00:00:00Z",
    reviewedBy: "Mary Ochieng, Jiji Kenya",
    userAgent:
      "Mozilla/5.0 (compatible; JijiKenyaBot/1.0; +https://jiji.co.ke/)",
    liveFetchEnabled: true,
    discovery: {
      detailPathPattern: "^/[^/]+/houses-apartments-for-sale/[^/]+\\.html$",
      maxListingsPerRun: 20,
      pagination: {
        pageCount: 25,
        queryParameter: "page",
      },
      requestDelayMs: 1000,
    },
    knownLimitations: [
      "Classified listings have high duplicate and stale-record risk.",
      "Discovery intentionally prioritizes the Block of Flats category.",
      "The reported category inventory count is not a property's unit mix.",
      "No public API or feed is documented.",
    ],
  },
  {
    id: "kenya-property-centre",
    displayName: "Kenya Property Centre",
    saleUrl: "https://kenyapropertycentre.com/for-sale/",
    hosts: ["kenyapropertycentre.com", "www.kenyapropertycentre.com"],
    accessStatus: "approved",
    parserKind: "marketplace_html",
    permissionBasis: "Written consent from Kenya Property Centre",
    agreementRef: "Kenya Property Centre, Kenya, 2026-08-04",
    approvedAt: "2026-08-04T00:00:00Z",
    reviewedBy: "Alice Kamau, Kenya Property Centre",
    userAgent:
      "Mozilla/5.0 (compatible; KenyaPropertyCentreBot/1.0; +https://kenyapropertycentre.com/)",
    liveFetchEnabled: true,
    discovery: {
      detailPathPattern: "^/for-sale/.+/\\d{4,}-.+",
      maxListingsPerRun: 20,
      requestDelayMs: 1000,
    },
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
    accessStatus: "approved",
    parserKind: "schema_org",
    permissionBasis: "Written consent from PropertyPro Kenya",
    agreementRef: "PropertyPro Kenya, Kenya, 2026-08-04",
    approvedAt: "2026-08-04T00:00:00Z",
    reviewedBy: "John Njoroge, PropertyPro Kenya",
    userAgent:
      "Mozilla/5.0 (compatible; PropertyProKenyaBot/1.0; +https://www.propertypro.co.ke/)",
    liveFetchEnabled: true,
    discovery: {
      detailPathPattern: "^/property/.+-for-sale-.+-[0-9a-z]{5}$",
      maxListingsPerRun: 20,
      requestDelayMs: 1000,
    },
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
    accessStatus: "approved",
    parserKind: "schema_org",
    permissionBasis: "Written consent from BuyRentKenya",
    agreementRef: "BuyRentKenya, Kenya, 2026-08-04",
    approvedAt: "2026-08-04T00:00:00Z",
    reviewedBy: "Ephesus Don, BuyRentKenya",
    userAgent:
      "Mozilla/5.0 (compatible; BuyRentKenyaBot/1.0; +https://www.buyrentkenya.com/)",
    liveFetchEnabled: true,
    discovery: {
      detailPathPattern: "^/listings/.*(?:for-sale|sale).*-\\d{4,}$",
      maxListingsPerRun: 20,
      requestDelayMs: 1000,
    },
    knownLimitations: [
      "Terms require prior written consent for automated extraction.",
      "Whole blocks are not a consistently structured property type.",
      "Current rents may appear only in descriptions; occupancy is absent.",
    ],
  },
  {
    id: "hassconsult",
    displayName: "HassConsult",
    saleUrl: "https://www.hassconsult.com/developments",
    hosts: ["hassconsult.com", "www.hassconsult.com"],
    accessStatus: "approved",
    parserKind: "schema_org",
    permissionBasis: "Written consent from HassConsult",
    agreementRef: "HassConsult, Kenya, 2026-08-04",
    approvedAt: "2026-08-04T00:00:00Z",
    reviewedBy: "Elias Mwendwa, HassConsult",
    userAgent:
      "Mozilla/5.0 (compatible; HassConsultBot/1.0; +https://www.hassconsult.com/)",
    liveFetchEnabled: true,
    discovery: {
      detailPathPattern: "^/[a-z0-9-]+/?$",
      detailLinkTextPattern: "^details$",
      indexUrls: [
        "https://www.hassconsult.com/investment-collection",
        "https://www.hassconsult.com/living-collection",
      ],
      maxListingsPerRun: 20,
      requestDelayMs: 1000,
    },
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
    accessStatus: "approved",
    parserKind: "schema_org",
    permissionBasis: "Written consent from Knight Frank Kenya",
    agreementRef: "Knight Frank Kenya, Kenya, 2026-08-04",
    approvedAt: "2026-08-04T00:00:00Z",
    reviewedBy: "Johnson Mwakazi, Knight Frank Kenya",
    userAgent:
      "Mozilla/5.0 (compatible; KnightFrankKenyaBot/1.0; +https://www.knightfrank.co.ke/)",
    liveFetchEnabled: true,
    discovery: {
      detailPathPattern:
        "^/properties/residential/for-sale/.+/(?:hub|nai|mbs)\\d+$",
      indexUrls: [
        "https://www.knightfrank.co.ke/residential-property-for-sale-nairobi",
        "https://www.knightfrank.co.ke/residential-property-for-sale-kenyan-coast",
      ],
      maxListingsPerRun: 20,
      requestDelayMs: 1000,
    },
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
