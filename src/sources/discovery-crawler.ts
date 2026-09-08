import { load } from "cheerio";
import type { DiscoveryRepository } from "@/db/discovery-repository";
import { fetchApprovedSourceHtml, LiveSourceAccessError } from "./http";
import { parseSaleListingHtml } from "./parser";
import {
  getSourceById,
  isSourceApproved,
  parseSourceUrl,
  type SourceRegistryEntry,
  type WebsiteSourceId,
} from "./registry";

export interface SourceDiscoveryResult {
  sourceId: WebsiteSourceId;
  candidateLinks: number;
  imported: number;
  failed: number;
  verified: number;
  refreshed: number;
  delisted: number;
  errors: string[];
}

const VERIFY_STALE_DAYS = 7;
const VERIFY_LIMIT_PER_RUN = 10;

export function extractSaleDetailLinks(
  source: SourceRegistryEntry,
  indexHtml: string,
): string[] {
  const $ = load(indexHtml);
  const pattern = new RegExp(source.discovery.detailPathPattern, "i");
  const linkTextPattern = source.discovery.detailLinkTextPattern
    ? new RegExp(source.discovery.detailLinkTextPattern, "i")
    : null;
  const hosts = new Set(source.hosts);
  const links = new Set<string>();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href || href.startsWith("#")) return;
    const linkText = $(element).text().replace(/\s+/g, " ").trim();
    if (linkTextPattern && !linkTextPattern.test(linkText)) return;
    try {
      const url = new URL(href, source.saleUrl);
      if (
        url.protocol !== "https:" ||
        !hosts.has(url.hostname.toLowerCase()) ||
        !pattern.test(url.pathname)
      ) {
        return;
      }
      url.hash = "";
      url.search = "";
      links.add(parseSourceUrl(url.toString()).toString());
    } catch {
      // Malformed third-party links are ignored.
    }
  });

  return [...links].slice(0, source.discovery.maxListingsPerRun);
}

export async function discoverApprovedSource(
  sourceId: WebsiteSourceId,
  repository: DiscoveryRepository,
  options: {
    fetchHtml?: typeof fetchApprovedSourceHtml;
    sleep?: (milliseconds: number) => Promise<void>;
    runAt?: string;
  } = {},
): Promise<SourceDiscoveryResult> {
  const source = getSourceById(sourceId);
  if (!isSourceApproved(source)) {
    throw new Error(`${source.displayName} is not approved for discovery.`);
  }
  const fetchHtml = options.fetchHtml ?? fetchApprovedSourceHtml;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const runAt = options.runAt ?? new Date().toISOString();
  const candidateGroups: string[][] = [];
  const indexErrors: string[] = [];
  let indexUrls = [...(source.discovery.indexUrls ?? [source.saleUrl])];
  const pagination = source.discovery.pagination;
  if (pagination) {
    const page = await repository.claimSourcePage(
      source.id,
      pagination.pageCount,
    );
    indexUrls = indexUrls.map((indexUrl) => {
      if (page === 1) return indexUrl;
      const pagedUrl = new URL(indexUrl);
      pagedUrl.searchParams.set(pagination.queryParameter, String(page));
      return pagedUrl.toString();
    });
  }
  for (const indexUrl of indexUrls) {
    try {
      const indexHtml = await fetchHtml(indexUrl);
      candidateGroups.push(extractSaleDetailLinks(source, indexHtml));
    } catch (error: unknown) {
      indexErrors.push(
        `${indexUrl}: ${error instanceof Error ? error.message : "Unknown index error"}`,
      );
    }
  }
  const links = new Set<string>();
  for (
    let position = 0;
    links.size < source.discovery.maxListingsPerRun;
    position += 1
  ) {
    let foundAtPosition = false;
    for (const group of candidateGroups) {
      const link = group[position];
      if (link) {
        links.add(link);
        foundAtPosition = true;
      }
      if (links.size >= source.discovery.maxListingsPerRun) break;
    }
    if (!foundAtPosition) break;
  }
  const candidates = [...links];
  const result: SourceDiscoveryResult = {
    sourceId,
    candidateLinks: candidates.length,
    imported: 0,
    failed: indexErrors.length,
    verified: 0,
    refreshed: 0,
    delisted: 0,
    errors: indexErrors,
  };

  for (const [index, sourceUrl] of candidates.entries()) {
    if (index > 0 && source.discovery.requestDelayMs > 0) {
      await sleep(source.discovery.requestDelayMs);
    }
    try {
      const detailHtml = await fetchHtml(sourceUrl);
      const draft = parseSaleListingHtml(sourceUrl, detailHtml, runAt);
      await repository.upsertDraft(draft);
      result.imported += 1;
    } catch (error: unknown) {
      result.failed += 1;
      result.errors.push(
        `${sourceUrl}: ${error instanceof Error ? error.message : "Unknown import error"}`,
      );
    }
  }

  const staleCutoff = new Date(
    new Date(runAt).getTime() - VERIFY_STALE_DAYS * 86_400_000,
  );
  const candidateSet = new Set(candidates);
  const staleRecords = (
    await repository.findStaleRecords(source.id, {
      notSeenSince: staleCutoff,
      limit: VERIFY_LIMIT_PER_RUN,
    })
  ).filter((record) => !candidateSet.has(record.sourceUrl));

  for (const [index, record] of staleRecords.entries()) {
    if (
      (candidates.length > 0 || index > 0) &&
      source.discovery.requestDelayMs > 0
    ) {
      await sleep(source.discovery.requestDelayMs);
    }
    try {
      const detailHtml = await fetchHtml(record.sourceUrl);
      const draft = parseSaleListingHtml(record.sourceUrl, detailHtml, runAt);
      await repository.upsertDraft(draft);
      result.verified += 1;
      result.refreshed += 1;
    } catch (error: unknown) {
      result.verified += 1;
      if (error instanceof LiveSourceAccessError && error.gone) {
        await repository.markDelisted(record.id);
        result.delisted += 1;
        continue;
      }
      result.errors.push(
        `${record.sourceUrl}: ${error instanceof Error ? error.message : "Unknown verification error"}`,
      );
    }
  }

  return result;
}

export async function discoverAllApprovedSources(
  repository: DiscoveryRepository,
  sourceIds: WebsiteSourceId[],
  options: {
    fetchHtml?: typeof fetchApprovedSourceHtml;
    sleep?: (milliseconds: number) => Promise<void>;
    runAt?: string;
  } = {},
): Promise<SourceDiscoveryResult[]> {
  const results: SourceDiscoveryResult[] = [];
  for (const sourceId of sourceIds) {
    try {
      results.push(await discoverApprovedSource(sourceId, repository, options));
    } catch (error: unknown) {
      results.push({
        sourceId,
        candidateLinks: 0,
        imported: 0,
        failed: 1,
        verified: 0,
        refreshed: 0,
        delisted: 0,
        errors: [
          error instanceof Error ? error.message : "Unknown source error",
        ],
      });
    }
  }
  return results;
}
