import { describe, expect, it } from "vitest";
import type { DiscoveryRecord } from "./discovery-types";
import type { SaleListingImportDraft } from "./import-types";
import {
  discoveryDataCompleteness,
  sortDiscoveryRecords,
} from "./discovery-sort";

function field<T>(
  value: T | null,
  status: "reported" | "estimated" | "missing",
) {
  return { value, status };
}

function record(
  id: string,
  status: "VIABLE" | "NEGOTIATE" | "NOT_VIABLE" | "NEEDS_DATA",
  complete: boolean,
): DiscoveryRecord {
  const available = <T>(value: T) =>
    complete ? field(value, "reported") : field<T>(null, "missing");
  const draft: SaleListingImportDraft = {
    sourceId: "jiji-kenya",
    sourceUrl: `https://jiji.co.ke/listing-${id}`,
    externalId: id,
    capturedAt: "2026-08-04T10:00:00.000Z",
    title: available(`Listing ${id}`),
    description: available("Description"),
    askingPriceKsh: available("50000000"),
    address: available("Nairobi"),
    county: available("Nairobi"),
    submarket: available("Kilimani"),
    propertyType: available("Block of Flats"),
    bedrooms: available(2),
    unitHints: complete
      ? [
          {
            label: "1 bedroom",
            count: field(10, "reported"),
            askingPriceKsh: field<string>(null, "missing"),
          },
        ]
      : [],
    imageUrls: [],
    publishedAt: null,
    modifiedAt: null,
    extractedRecordSha256: id.padEnd(64, "0"),
    warnings: [],
  };
  return {
    id,
    sourceId: "jiji-kenya",
    sourceUrl: draft.sourceUrl,
    externalId: id,
    title: draft.title.value,
    county: draft.county.value,
    submarket: draft.submarket.value,
    askingPriceKsh: draft.askingPriceKsh.value,
    status: "new",
    draft,
    firstSeenAt: "2026-08-04T10:00:00.000Z",
    lastSeenAt: "2026-08-04T10:00:00.000Z",
    reviewedAt: null,
    preScreen: {
      status,
      label: status,
      reason: "Test",
      reportedMonthlyGrossRentKsh: complete ? "500000" : null,
      requiredMonthlyGrossRentKsh: null,
      maximumAllowableOfferKsh: null,
      assumptionsLabel: "Test",
    },
  };
}

describe("discovery sorting", () => {
  it("orders viability before data completeness", () => {
    const records = [
      record("needs-complete", "NEEDS_DATA", true),
      record("not-viable", "NOT_VIABLE", true),
      record("viable-incomplete", "VIABLE", false),
      record("negotiate", "NEGOTIATE", true),
    ];

    expect(sortDiscoveryRecords(records).map(({ id }) => id)).toEqual([
      "viable-incomplete",
      "negotiate",
      "not-viable",
      "needs-complete",
    ]);
  });

  it("orders equal viability by available data", () => {
    const incomplete = record("incomplete", "NEEDS_DATA", false);
    const complete = record("complete", "NEEDS_DATA", true);

    expect(discoveryDataCompleteness(complete)).toBe(100);
    expect(discoveryDataCompleteness(incomplete)).toBe(0);
    expect(
      sortDiscoveryRecords([incomplete, complete]).map(({ id }) => id),
    ).toEqual(["complete", "incomplete"]);
  });
});
