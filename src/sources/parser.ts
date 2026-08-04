import { createHash } from "node:crypto";
import { load, type CheerioAPI } from "cheerio";
import type { County } from "@/domain";
import type {
  ImportedField,
  ImportedUnitHint,
  SaleListingImportDraft,
} from "./import-types";
import { findSourceByUrl, type SourceRegistryEntry } from "./registry";

type JsonRecord = Record<string, unknown>;

const countyTerms: Record<County, readonly string[]> = {
  Nairobi: [
    "nairobi",
    "kilimani",
    "kileleshwa",
    "westlands",
    "lavington",
    "parklands",
    "karen",
    "kasarani",
    "roysambu",
  ],
  Kiambu: ["kiambu", "ruiru", "thika", "ruaka", "kikuyu", "juja"],
  Kajiado: ["kajiado", "kitengela", "ongata rongai", "rongai", "ngong"],
  Nakuru: ["nakuru", "naivasha"],
  Mombasa: ["mombasa", "nyali", "bamburi", "shanzu", "likoni", "kizingo"],
};

const missing = <T>(): ImportedField<T> => ({
  value: null,
  status: "missing",
});

const reported = <T>(value: T, evidence?: string): ImportedField<T> => ({
  value,
  status: "reported",
  ...(evidence ? { evidence } : {}),
});

const estimated = <T>(value: T, evidence: string): ImportedField<T> => ({
  value,
  status: "estimated",
  evidence,
});

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return null;
}

function parseJsonLd($: CheerioAPI): JsonRecord[] {
  const records: JsonRecord[] = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    const content = $(element).text().trim();
    if (!content) return;
    try {
      const parsed: unknown = JSON.parse(content);
      const values = Array.isArray(parsed) ? parsed : [parsed];
      for (const value of values) {
        const record = asRecord(value);
        if (!record) continue;
        const graph = Array.isArray(record["@graph"]) ? record["@graph"] : [];
        for (const item of [record, ...graph]) {
          const graphRecord = asRecord(item);
          if (graphRecord) records.push(graphRecord);
        }
      }
    } catch {
      // Invalid third-party JSON-LD is ignored; meta and text fallbacks remain.
    }
  });
  return records;
}

function findListingRecord(records: JsonRecord[]): JsonRecord | null {
  return (
    records.find((record) => {
      const type = record["@type"];
      const types = Array.isArray(type) ? type : [type];
      return (
        types.some((value) =>
          [
            "Product",
            "Accommodation",
            "Apartment",
            "House",
            "Residence",
            "RealEstateListing",
            "Offer",
          ].includes(String(value)),
        ) ||
        record.offers !== undefined ||
        record.price !== undefined
      );
    }) ??
    records.find((record) => record.name !== undefined) ??
    null
  );
}

function offerRecord(record: JsonRecord | null): JsonRecord | null {
  if (!record) return null;
  const offers = Array.isArray(record.offers)
    ? record.offers[0]
    : record.offers;
  return asRecord(offers) ?? record;
}

function normalizeMoney(
  value: unknown,
  currency: string | null,
): string | null {
  const raw = firstString(value);
  if (!raw) return null;
  if (!currency || !["KES", "KSH"].includes(currency.toUpperCase()))
    return null;
  const match = raw
    .replaceAll(",", "")
    .match(/(\d+(?:\.\d+)?)\s*(thousand|million|billion|k|m|bn)?/i);
  if (!match) return null;
  const magnitude = match[2]?.toLowerCase();
  const multiplier =
    magnitude === "thousand" || magnitude === "k"
      ? 1_000
      : magnitude === "million" || magnitude === "m"
        ? 1_000_000
        : magnitude === "billion" || magnitude === "bn"
          ? 1_000_000_000
          : 1;
  const amount = Number(match[1]) * multiplier;
  return Number.isFinite(amount) && amount > 0 ? String(amount) : null;
}

function numberValue(value: unknown): number | null {
  const raw = firstString(value);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function meta($: CheerioAPI, property: string): string | null {
  return (
    $(`meta[property="${property}"]`).attr("content")?.trim() ??
    $(`meta[name="${property}"]`).attr("content")?.trim() ??
    null
  );
}

function salePriceFromBody(value: string): string | null {
  const labelled = value.match(
    /(?:asking price|sale price|selling (?:at|for)|price)\s*[:\-]?\s*((?:KSh|KES)\s*[\d,]+(?:\.\d+)?\s*(?:thousand|million|billion|k|m|bn)?)/i,
  )?.[1];
  if (labelled) return labelled;

  const currencyAmounts =
    /\b(?:KSh|KES)\s*[\d,]+(?:\.\d+)?\s*(?:thousand|million|billion|k|m|bn)?\b/gi;
  for (const match of value.matchAll(currencyAmounts)) {
    const precedingText = value.slice(
      Math.max(0, match.index - 50),
      match.index,
    );
    if (
      /rent|service charge|per (?:month|week|day|year)|monthly|weekly|daily/i.test(
        precedingText,
      )
    ) {
      continue;
    }
    return match[0];
  }
  return null;
}

function addressFromRecord(record: JsonRecord | null): string | null {
  const rawAddress = asRecord(record?.address);
  if (!rawAddress) return firstString(record?.address);
  return [
    rawAddress.streetAddress,
    rawAddress.addressLocality,
    rawAddress.addressRegion,
    rawAddress.addressCountry,
  ]
    .map((value) => firstString(value))
    .filter((value): value is string => Boolean(value))
    .join(", ");
}

function countyFromText(value: string): County | null {
  const normalized = value.toLowerCase();
  for (const [county, terms] of Object.entries(countyTerms) as [
    County,
    readonly string[],
  ][]) {
    if (terms.some((term) => normalized.includes(term))) return county;
  }
  return null;
}

function explicitCountyFromRegion(value: string): County | null {
  const normalized = value.trim().toLowerCase();
  for (const county of Object.keys(countyTerms) as County[]) {
    if (
      normalized === county.toLowerCase() ||
      normalized === `${county.toLowerCase()} county`
    ) {
      return county;
    }
  }
  return null;
}

function submarketFromAddress(
  address: string,
  county: County | null,
): string | null {
  if (!address) return null;
  const segments = address
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
  return (
    segments.find(
      (segment) =>
        segment.toLowerCase() !== county?.toLowerCase() &&
        segment.toLowerCase() !== "kenya",
    ) ?? null
  );
}

function unitHintsFromText(value: string): ImportedUnitHint[] {
  const hints: ImportedUnitHint[] = [];
  const pattern =
    /(\d{1,4})\s*(?:x|units?\s+of)?\s*(studio|bedsitter|[1-9]\s*(?:br|bedroom)s?)/gi;
  for (const match of value.matchAll(pattern)) {
    const count = Number(match[1]);
    const label = match[2]?.replace(/\s+/g, " ").trim();
    if (!label || !Number.isInteger(count) || count <= 0) continue;
    hints.push({
      label,
      count: reported(count, match[0]),
      askingPriceKsh: missing(),
    });
  }
  return hints.slice(0, 20);
}

function imageUrls(record: JsonRecord | null, $: CheerioAPI): string[] {
  const values = Array.isArray(record?.image) ? record.image : [record?.image];
  const urls = values
    .map((value) => {
      const image = asRecord(value);
      return firstString(image?.url, image?.contentUrl, value);
    })
    .filter((value): value is string => Boolean(value));
  const openGraphImage = meta($, "og:image");
  if (openGraphImage) urls.push(openGraphImage);
  return [...new Set(urls)].filter((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  });
}

function externalId(
  source: SourceRegistryEntry,
  url: URL,
  record: JsonRecord | null,
): string | null {
  const supplied = firstString(
    record?.sku,
    record?.productID,
    record?.identifier,
  );
  if (supplied) return supplied;
  const numericIds = [...url.pathname.matchAll(/\d{4,}/g)];
  const fromPath = numericIds.at(-1)?.[0];
  return fromPath ? `${source.id}:${fromPath}` : null;
}

export function parseSaleListingHtml(
  sourceUrl: string,
  html: string,
  capturedAt = new Date().toISOString(),
): SaleListingImportDraft {
  const source = findSourceByUrl(sourceUrl);
  if (!source)
    throw new Error("The URL is not registered as a MaliScope source.");
  const url = new URL(sourceUrl);
  const $ = load(html);
  const records = parseJsonLd($);
  const record = findListingRecord(records);
  const offer = offerRecord(record);
  const bodyText = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100_000);
  const title = firstString(
    record?.name,
    meta($, "og:title"),
    $("h1").first().text(),
  );
  const description = firstString(
    record?.description,
    meta($, "description"),
    meta($, "og:description"),
  );
  const address = firstString(
    addressFromRecord(record),
    meta($, "place:location:address"),
  );
  const structuredAddress = asRecord(record?.address);
  const regionText = firstString(structuredAddress?.addressRegion) ?? "";
  const explicitRegionCounty = explicitCountyFromRegion(regionText);
  const inferredRegionCounty = countyFromText(regionText);
  const localityCounty = countyFromText(
    firstString(structuredAddress?.addressLocality) ?? "",
  );
  const combinedLocation = [
    address,
    title,
    description,
    bodyText.slice(0, 2_000),
  ]
    .filter(Boolean)
    .join(" ");
  const county =
    explicitRegionCounty ??
    inferredRegionCounty ??
    localityCounty ??
    countyFromText(combinedLocation);
  const submarket = submarketFromAddress(address ?? "", county);
  const priceSpecification = asRecord(offer?.priceSpecification);
  const structuredPrice = offer?.price ?? priceSpecification?.price;
  const structuredCurrency = firstString(
    offer?.priceCurrency,
    priceSpecification?.priceCurrency,
  );
  const recurringUnit = firstString(
    offer?.unitText,
    offer?.unitCode,
    priceSpecification?.unitText,
    priceSpecification?.unitCode,
  );
  const listingText = `${url.pathname} ${title ?? ""} ${description ?? ""}`;
  const rentalListing =
    /(?:^|[\s/_-])(?:for[\s_-]?rent|to[\s_-]?let)(?:$|[\s/_-])/i.test(
      listingText,
    ) ||
    Boolean(
      recurringUnit &&
      /month|monthly|week|weekly|day|daily|year|yearly|annum/i.test(
        recurringUnit,
      ),
    );
  const metaPrice = meta($, "product:price:amount");
  const metaCurrency = firstString(meta($, "product:price:currency"));
  const bodyPrice = salePriceFromBody(bodyText);
  const price = rentalListing
    ? null
    : structuredPrice !== undefined
      ? normalizeMoney(structuredPrice, structuredCurrency)
      : metaPrice
        ? normalizeMoney(metaPrice, metaCurrency)
        : normalizeMoney(bodyPrice, bodyPrice ? "KES" : null);
  const bedrooms = numberValue(record?.numberOfBedrooms);
  const type = firstString(
    record?.accommodationCategory,
    record?.["@type"],
    meta($, "property:type"),
  );
  const hints = unitHintsFromText(`${title ?? ""} ${description ?? ""}`);
  if (hints.length === 0 && bedrooms) {
    hints.push({
      label: `${bedrooms} bedroom`,
      count: reported(1, "Schema.org numberOfBedrooms"),
      askingPriceKsh: price
        ? reported(price, "Schema.org offer price for individual unit")
        : missing(),
    });
  }
  const extractedRecord = {
    sourceId: source.id,
    sourceUrl: url.toString(),
    externalId: externalId(source, url, record),
    title,
    description,
    price,
    address,
    county,
    submarket,
    type,
    bedrooms,
    unitHints: hints,
    publishedAt: firstString(record?.datePublished, offer?.validFrom),
    modifiedAt: firstString(record?.dateModified),
  };
  const warnings: string[] = [];
  if (rentalListing) {
    warnings.push(
      "Rental listing detected; no sale asking price was imported.",
    );
  }
  if (
    structuredPrice !== undefined &&
    structuredCurrency &&
    !["KES", "KSH"].includes(structuredCurrency.toUpperCase())
  ) {
    warnings.push(
      `Asking price uses unsupported currency ${structuredCurrency}; no KES value was inferred.`,
    );
  }
  if (!price) warnings.push("Asking price was not found.");
  if (!county) warnings.push("Target county could not be determined.");
  if (hints.length === 0) warnings.push("Unit mix was not found.");
  warnings.push(
    "Imported listing claims require human verification against the source page.",
  );

  return {
    sourceId: source.id,
    sourceUrl: url.toString(),
    externalId: extractedRecord.externalId,
    capturedAt,
    title: title ? reported(title, "Listing title") : missing(),
    description: description
      ? reported(description, "Listing description")
      : missing(),
    askingPriceKsh: price ? reported(price, "Listing asking price") : missing(),
    address: address ? reported(address, "Listing address") : missing(),
    county: county
      ? explicitRegionCounty
        ? reported(county, "Schema.org address region")
        : estimated(
            county,
            inferredRegionCounty
              ? "County inferred from Schema.org address region"
              : localityCounty
                ? "County inferred from Schema.org address locality"
                : "County inferred from listing location text",
          )
      : missing(),
    submarket: submarket
      ? reported(submarket, "Submarket parsed from listing address")
      : missing(),
    propertyType: type ? reported(type, "Listing property type") : missing(),
    bedrooms: bedrooms
      ? reported(bedrooms, "Schema.org bedroom count")
      : missing(),
    unitHints: hints,
    imageUrls: imageUrls(record, $),
    publishedAt: extractedRecord.publishedAt,
    modifiedAt: extractedRecord.modifiedAt,
    extractedRecordSha256: createHash("sha256")
      .update(JSON.stringify(extractedRecord))
      .digest("hex"),
    warnings,
  };
}
