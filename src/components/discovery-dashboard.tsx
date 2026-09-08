"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { counties } from "@/domain";
import {
  discoveryStatuses,
  type DiscoveryRecord,
} from "@/sources/discovery-types";
import { filterDiscoveryRecords } from "@/sources/discovery-filter";
import { discoveryDataCompleteness } from "@/sources/discovery-sort";
import {
  discoveryPreScreenStatuses,
  type DiscoveryPreScreen,
} from "@/sources/pre-screen";
import type { WebsiteSourceId } from "@/sources/registry";

interface PublicSource {
  id: WebsiteSourceId;
  displayName: string;
  saleUrl: string;
  accessStatus: string;
  liveFetchEnabled: boolean;
}

interface DiscoveryResponse {
  records: DiscoveryRecord[];
  sources: PublicSource[];
  error?: string;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    await response.text();
    throw new Error(
      `Discovery server returned HTTP ${response.status} instead of JSON.`,
    );
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error("Discovery server returned malformed JSON.");
  }
}

const kes = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

const unavailableScreen: DiscoveryPreScreen = {
  status: "NEEDS_DATA",
  label: "NEEDS DATA",
  reason: "The loan-service screen is unavailable.",
  reportedMonthlyGrossRentKsh: null,
  reportedOccupancy: null,
  requiredMonthlyGrossRentKsh: null,
  maximumAllowableOfferKsh: null,
  monthlyDebtServiceKsh: null,
  monthlyInterestKsh: null,
  debtServiceCoverageRatio: null,
  assumptionsLabel: "Open underwriting to enter and verify missing facts.",
};

function missingFactCount(record: DiscoveryRecord): number {
  const draft = record.draft;
  return (
    [
      draft.askingPriceKsh,
      draft.address,
      draft.county,
      draft.submarket,
      draft.propertyType,
      draft.bedrooms,
    ].filter((field) => field.status === "missing").length +
    (draft.unitHints.length === 0 ? 1 : 0)
  );
}

function freshness(lastSeenAt: string): {
  label: string;
  stale: boolean;
} {
  const days = Math.floor(
    (Date.now() - new Date(lastSeenAt).getTime()) / 86_400_000,
  );
  return {
    label: days <= 0 ? "Today" : `${days}d ago`,
    stale: days > 14,
  };
}

function priceBound(value: string): { invalid: boolean; value: number | null } {
  if (!value.trim()) return { invalid: false, value: null };
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? { invalid: false, value: parsed }
    : { invalid: true, value: null };
}

export function DiscoveryDashboard() {
  const [records, setRecords] = useState<DiscoveryRecord[]>([]);
  const [sources, setSources] = useState<PublicSource[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [county, setCounty] = useState("");
  const [status, setStatus] = useState("");
  const [screenStatus, setScreenStatus] = useState("");
  const [propertyType, setPropertyType] = useState("");
  const [minimumPriceKsh, setMinimumPriceKsh] = useState("");
  const [maximumPriceKsh, setMaximumPriceKsh] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmedCounties, setConfirmedCounties] = useState<
    Record<string, string>
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    const params = new URLSearchParams();
    if (sourceId) params.set("source", sourceId);
    if (county) params.set("county", county);
    if (status) params.set("status", status);
    if (search.trim()) params.set("search", search.trim());
    try {
      const response = await fetch(`/api/discovery?${params}`);
      const body = await readJsonResponse<DiscoveryResponse>(response);
      if (!response.ok)
        throw new Error(body.error ?? "Unable to load listings");
      setRecords(body.records);
      setSources(body.sources);
    } catch (error: unknown) {
      setNotice(
        error instanceof Error ? error.message : "Unable to load listings",
      );
    } finally {
      setLoading(false);
    }
  }, [county, search, sourceId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const runDiscovery = async () => {
    const sourceIds = sourceId
      ? [sourceId]
      : sources
          .filter(
            (source) =>
              source.accessStatus === "approved" && source.liveFetchEnabled,
          )
          .map((source) => source.id);
    if (sourceIds.length === 0) {
      setNotice("No approved sources are available for discovery.");
      return;
    }
    setRunning(true);
    setNotice(null);
    try {
      const response = await fetch("/api/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceIds }),
      });
      const body = await readJsonResponse<{
        error?: string;
        results?: {
          sourceId: WebsiteSourceId;
          imported: number;
          failed: number;
          errors: string[];
        }[];
      }>(response);
      if (!response.ok) throw new Error(body.error ?? "Discovery failed");
      const results = body.results ?? [];
      const imported = results.reduce(
        (total, result) => total + result.imported,
        0,
      );
      const failed = results.reduce(
        (total, result) => total + result.failed,
        0,
      );
      const issues = results
        .filter((result) => result.errors.length > 0)
        .map((result) => {
          const sourceName =
            sources.find((source) => source.id === result.sourceId)
              ?.displayName ?? result.sourceId;
          return `${sourceName}: ${result.errors.join(", ")}`;
        });
      setNotice(
        [
          `Discovery completed across ${results.length} source${results.length === 1 ? "" : "s"}: ${imported} imported, ${failed} failed.`,
          issues.length > 0 ? `Source issues: ${issues.join("; ")}` : null,
        ]
          .filter(Boolean)
          .join(" "),
      );
      await load();
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "Discovery failed");
    } finally {
      setRunning(false);
    }
  };

  const promote = async (record: DiscoveryRecord) => {
    setNotice(null);
    try {
      const response = await fetch(
        `/api/discovery/${encodeURIComponent(record.id)}/promote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmedCounty: confirmedCounties[record.id] || undefined,
          }),
        },
      );
      const body = await readJsonResponse<{
        listingId?: string;
        error?: string;
      }>(response);

      if (!response.ok || !body.listingId) {
        throw new Error(body.error ?? "Unable to open in underwriting");
      }
      window.location.assign(`/?listing=${encodeURIComponent(body.listingId)}`);
    } catch (error: unknown) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Unable to open in underwriting",
      );
    }
  };

  const openUnderwriting = (record: DiscoveryRecord) => {
    const listingId = `discovered-${record.draft.extractedRecordSha256.slice(0, 24)}`;
    window.location.assign(`/?listing=${encodeURIComponent(listingId)}`);
  };

  const propertyTypes = useMemo(
    () =>
      [
        ...new Set(
          records
            .map((record) => record.draft.propertyType.value)
            .filter((value): value is string => Boolean(value)),
        ),
      ].sort((left, right) => left.localeCompare(right)),
    [records],
  );
  const minimumPrice = priceBound(minimumPriceKsh);
  const maximumPrice = priceBound(maximumPriceKsh);
  const invalidPriceRange =
    minimumPrice.invalid ||
    maximumPrice.invalid ||
    (minimumPrice.value !== null &&
      maximumPrice.value !== null &&
      minimumPrice.value > maximumPrice.value);
  const visibleRecords = useMemo(() => {
    if (invalidPriceRange) return [];
    const screenedRecords = screenStatus
      ? records.filter((record) => record.preScreen?.status === screenStatus)
      : records;
    return filterDiscoveryRecords(screenedRecords, {
      propertyType,
      minimumPriceKsh: minimumPrice.value,
      maximumPriceKsh: maximumPrice.value,
    });
  }, [
    invalidPriceRange,
    maximumPrice.value,
    minimumPrice.value,
    propertyType,
    records,
    screenStatus,
  ]);

  const metrics = useMemo(
    () => ({
      total: visibleRecords.length,
      promising: visibleRecords.filter(
        (record) => record.preScreen?.status === "PROMISING",
      ).length,
      worthALook: visibleRecords.filter(
        (record) => record.preScreen?.status === "WORTH_A_LOOK",
      ).length,
      requiresSubsidy: visibleRecords.filter(
        (record) =>
          record.preScreen?.status === "INTEREST_ONLY" ||
          record.preScreen?.status === "UNDERWATER",
      ).length,
      needsData: visibleRecords.filter(
        (record) => record.preScreen?.status === "NEEDS_DATA",
      ).length,
    }),
    [visibleRecords],
  );

  return (
    <main>
      <nav className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">M</span>
          <span>MaliScope</span>
        </Link>
        <div className="nav-links">
          <Link href="/">Underwriting</Link>
          <Link className="active" href="/discovery">
            Listings discovery
          </Link>
        </div>
      </nav>

      <section className="discovery-hero">
        <div>
          <span className="eyebrow">Approved-source pipeline</span>
          <h1>Listings discovery</h1>
          <p>
            Review source facts before they enter underwriting. Missing rents,
            costs, and due diligence remain missing by design.
          </p>
        </div>
        <div className="button-row">
          <button className="button button-quiet" onClick={() => void load()}>
            Refresh
          </button>
          <button
            className="button button-primary"
            disabled={running}
            onClick={runDiscovery}
          >
            {running
              ? "Discovering..."
              : sourceId
                ? "Run selected source"
                : "Run all approved sources"}
          </button>
        </div>
      </section>

      <section className="discovery-shell">
        {notice ? <div className="notice">{notice}</div> : null}

        <div className="discovery-metrics">
          <div>
            <span>Visible listings</span>
            <strong>{metrics.total}</strong>
          </div>
          <div>
            <span>Promising</span>
            <strong>{metrics.promising}</strong>
          </div>
          <div>
            <span>Worth a look</span>
            <strong>{metrics.worthALook}</strong>
          </div>
          <div>
            <span>Requires subsidy</span>
            <strong>{metrics.requiresSubsidy}</strong>
          </div>
          <div>
            <span>Needs data</span>
            <strong>{metrics.needsData}</strong>
          </div>
        </div>

        <div className="discovery-filters">
          <label>
            <span className="field-label">Source</span>
            <select
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
            >
              <option value="">All approved sources</option>
              {sources
                .filter(
                  (source) =>
                    source.accessStatus === "approved" &&
                    source.liveFetchEnabled,
                )
                .map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.displayName}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span className="field-label">County</span>
            <select
              value={county}
              onChange={(event) => setCounty(event.target.value)}
            >
              <option value="">All counties</option>
              {counties.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label">Review status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              {discoveryStatuses.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label">Viability pre-screen</span>
            <select
              value={screenStatus}
              onChange={(event) => setScreenStatus(event.target.value)}
            >
              <option value="">All screen results</option>
              {discoveryPreScreenStatuses.map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label">Property type</span>
            <select
              value={propertyType}
              onChange={(event) => setPropertyType(event.target.value)}
            >
              <option value="">All property types</option>
              {propertyTypes.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label">Minimum price (KES)</span>
            <input
              type="number"
              min="0"
              step="100000"
              inputMode="numeric"
              value={minimumPriceKsh}
              onChange={(event) => setMinimumPriceKsh(event.target.value)}
              placeholder="No minimum"
            />
          </label>
          <label>
            <span className="field-label">Maximum price (KES)</span>
            <input
              type="number"
              min="0"
              step="100000"
              inputMode="numeric"
              value={maximumPriceKsh}
              onChange={(event) => setMaximumPriceKsh(event.target.value)}
              placeholder="No maximum"
            />
          </label>
          <label>
            <span className="field-label">Search</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Title, submarket, or URL"
            />
          </label>
        </div>
        {invalidPriceRange ? (
          <p className="filter-validation">
            Enter non-negative prices with the minimum no greater than the
            maximum.
          </p>
        ) : null}

        {loading ? (
          <div className="empty-state">Loading discovered listings...</div>
        ) : visibleRecords.length === 0 ? (
          <div className="empty-state">
            <strong>No listings match these filters.</strong>
            <span>
              Select an approved source and run discovery, or run{" "}
              <code>npm run job:discover</code> from the scheduler.
            </span>
          </div>
        ) : (
          <div className="listing-grid">
            {visibleRecords.map((record) => {
              const seen = freshness(record.lastSeenAt);
              const source = sources.find(
                (item) => item.id === record.sourceId,
              );
              const missing = missingFactCount(record);
              const completeness = discoveryDataCompleteness(record);
              const screening = record.preScreen ?? unavailableScreen;
              const needsCountyConfirmation =
                record.draft.county.status !== "reported";
              const isReviewed = record.status === "reviewed";
              const canPromote =
                isReviewed ||
                (record.status === "new" &&
                  (!needsCountyConfirmation ||
                    Boolean(confirmedCounties[record.id])));
              return (
                <article className="listing-card" key={record.id}>
                  <header>
                    <span className="source-label">
                      {source?.displayName ?? record.sourceId}
                    </span>
                    <span
                      className={seen.stale ? "freshness stale" : "freshness"}
                    >
                      {seen.label}
                    </span>
                  </header>
                  <h2>{record.title ?? "Untitled source listing"}</h2>
                  <p>
                    {[record.submarket, record.county]
                      .filter(Boolean)
                      .join(", ") || "Location not reported"}
                  </p>
                  <strong className="listing-price">
                    {record.askingPriceKsh
                      ? kes.format(Number(record.askingPriceKsh))
                      : "Price not reported"}
                  </strong>
                  <div
                    className={`pre-screen pre-screen-${screening.status.toLowerCase().replaceAll("_", "-")}`}
                  >
                    <div>
                      <span>Loan-service screen</span>
                      <strong>{screening.label}</strong>
                    </div>
                    <p>{screening.reason}</p>
                    {screening.reportedMonthlyGrossRentKsh ? (
                      <span>
                        Reported gross rent:{" "}
                        <b>
                          {kes.format(
                            Number(screening.reportedMonthlyGrossRentKsh),
                          )}
                          /month
                        </b>
                      </span>
                    ) : null}
                    {screening.reportedOccupancy ? (
                      <span>
                        Reported occupancy:{" "}
                        <b>
                          {Math.round(
                            Number(screening.reportedOccupancy) * 100,
                          )}
                          %
                        </b>
                      </span>
                    ) : null}
                    {screening.monthlyDebtServiceKsh ? (
                      <span>
                        Debt payment @ 70% LTV:{" "}
                        <b>
                          {kes.format(
                            Number(screening.monthlyDebtServiceKsh),
                          )}
                          /month
                        </b>
                      </span>
                    ) : null}
                    {screening.debtServiceCoverageRatio ? (
                      <span>
                        DSCR (rent ÷ payment):{" "}
                        <b>{Number(screening.debtServiceCoverageRatio).toFixed(2)}×</b>
                      </span>
                    ) : null}
                    {screening.requiredMonthlyGrossRentKsh ? (
                      <span>
                        Rent needed for PROMISING:{" "}
                        <b>
                          {kes.format(
                            Number(screening.requiredMonthlyGrossRentKsh),
                          )}
                          /month
                        </b>
                      </span>
                    ) : null}
                    {screening.maximumAllowableOfferKsh ? (
                      <span>
                        Price for PROMISING at reported rent:{" "}
                        <b>
                          {kes.format(
                            Number(screening.maximumAllowableOfferKsh),
                          )}
                        </b>
                      </span>
                    ) : null}
                    <small title={screening.assumptionsLabel}>
                      Loan-service view only. Underwriting adds operating costs and
                      returns.
                    </small>
                  </div>
                  <div className="listing-facts">
                    <span>{record.draft.unitHints.length} unit hints</span>
                    <span>{completeness}% source data available</span>
                    <span>{missing} discovery fields missing</span>
                    <span className={`review-state state-${record.status}`}>
                      {record.status}
                    </span>
                  </div>
                  {record.draft.warnings.length > 0 ? (
                    <p className="listing-warning">
                      {record.draft.warnings[0]}
                    </p>
                  ) : null}
                  {needsCountyConfirmation ? (
                    <label>
                      <span className="field-label">
                        Confirm county before underwriting
                      </span>
                      <select
                        value={confirmedCounties[record.id] ?? ""}
                        onChange={(event) =>
                          setConfirmedCounties((current) => ({
                            ...current,
                            [record.id]: event.target.value,
                          }))
                        }
                      >
                        <option value="">Select verified county</option>
                        {counties.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <footer>
                    <a
                      className="button button-quiet"
                      href={record.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View source
                    </a>
                    <button
                      className="button button-primary"
                      disabled={!canPromote}
                      onClick={() =>
                        isReviewed
                          ? openUnderwriting(record)
                          : void promote(record)
                      }
                    >
                      {isReviewed ? "Open underwriting" : "Review underwriting"}
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
