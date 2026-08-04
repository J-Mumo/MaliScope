import { describe, expect, it } from "vitest";
import type { DiscoveryRecord } from "./discovery-types";
import type { SaleListingImportDraft } from "./import-types";
import { filterDiscoveryRecords } from "./discovery-filter";

function record(
  id: string,
  propertyType: string | null,
  askingPriceKsh: string | null,
): DiscoveryRecord {
  const draft = {
    sourceId: "jiji-kenya",
    sourceUrl: `https://jiji.co.ke/${id}`,
    externalId: id,
    capturedAt: "2026-08-04T10:00:00.000Z",
    title: { value: id, status: "reported" },
    description: { value: null, status: "missing" },
    askingPriceKsh: {
      value: askingPriceKsh,
      status: askingPriceKsh ? "reported" : "missing",
    },
    address: { value: null, status: "missing" },
    county: { value: null, status: "missing" },
    submarket: { value: null, status: "missing" },
    propertyType: {
      value: propertyType,
      status: propertyType ? "reported" : "missing",
    },
    bedrooms: { value: null, status: "missing" },
    unitHints: [],
    imageUrls: [],
    publishedAt: null,
    modifiedAt: null,
    extractedRecordSha256: id.padEnd(64, "0"),
    warnings: [],
  } satisfies SaleListingImportDraft;
  return {
    id,
    sourceId: draft.sourceId,
    sourceUrl: draft.sourceUrl,
    externalId: id,
    title: id,
    county: null,
    submarket: null,
    askingPriceKsh,
    status: "new",
    draft,
    firstSeenAt: draft.capturedAt,
    lastSeenAt: draft.capturedAt,
    reviewedAt: null,
  };
}

describe("discovery property filters", () => {
  const records = [
    record("block-low", "Block of Flats", "30000000"),
    record("block-high", "Block of Flats", "90000000"),
    record("apartment", "Apartment", "50000000"),
    record("missing-price", "Block of Flats", null),
  ];

  it("filters by exact normalized property type", () => {
    expect(
      filterDiscoveryRecords(records, {
        propertyType: "Apartment",
        minimumPriceKsh: null,
        maximumPriceKsh: null,
      }).map(({ id }) => id),
    ).toEqual(["apartment"]);
  });

  it("applies inclusive price bounds and excludes unknown prices", () => {
    expect(
      filterDiscoveryRecords(records, {
        propertyType: "Block of Flats",
        minimumPriceKsh: 30_000_000,
        maximumPriceKsh: 90_000_000,
      }).map(({ id }) => id),
    ).toEqual(["block-low", "block-high"]);
  });

  it("keeps unknown prices when no price bound is active", () => {
    expect(
      filterDiscoveryRecords(records, {
        propertyType: "Block of Flats",
        minimumPriceKsh: null,
        maximumPriceKsh: null,
      }),
    ).toHaveLength(3);
  });
});
