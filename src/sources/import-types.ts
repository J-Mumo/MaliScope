import type { County, InputStatus } from "@/domain";
import type { WebsiteSourceId } from "./registry";

export interface ImportedField<T> {
  value: T | null;
  status: InputStatus;
  evidence?: string;
}

export interface ImportedUnitHint {
  label: string;
  count: ImportedField<number>;
  askingPriceKsh: ImportedField<string>;
}

export interface SaleListingImportDraft {
  sourceId: WebsiteSourceId;
  sourceUrl: string;
  externalId: string | null;
  capturedAt: string;
  title: ImportedField<string>;
  description: ImportedField<string>;
  askingPriceKsh: ImportedField<string>;
  address: ImportedField<string>;
  county: ImportedField<County>;
  submarket: ImportedField<string>;
  propertyType: ImportedField<string>;
  bedrooms: ImportedField<number>;
  unitHints: ImportedUnitHint[];
  imageUrls: string[];
  publishedAt: string | null;
  modifiedAt: string | null;
  extractedRecordSha256: string;
  warnings: string[];
}
