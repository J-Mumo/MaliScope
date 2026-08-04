"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { counties } from "@/domain";
import {
  discoveryStatuses,
  type DiscoveryRecord,
} from "@/sources/discovery-types";
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
  reason: "The provisional viability screen is unavailable.",
  reportedMonthlyGrossRentKsh: null,
  requiredMonthlyGrossRentKsh: null,
  maximumAllowableOfferKsh: null,
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

export function DiscoveryDashboard() {
  const [records, setRecords] = useState<DiscoveryRecord[]>([]);
  const [sources, setSources] = useState<PublicSource[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [county, setCounty] = useState("");
  const [status, setStatus] = useState("");
  const [screenStatus, setScreenStatus] = useState("");
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
    if (!sourceId) {
      setNotice("Select one approved source before running discovery.");
      return;
    }
    setRunning(true);
    setNotice(null);
    try {
      const response = await fetch("/api/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceIds: [sourceId] }),
      });
      const body = await readJsonResponse<{
        error?: string;
        results?: { imported: number; failed: number }[];
      }>(response);
      if (!response.ok) throw new Error(body.error ?? "Discovery failed");
      const result = body.results?.[0];
      setNotice(
        `Discovery completed: ${result?.imported ?? 0} imported, ${result?.failed ?? 0} failed.`,
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

  const visibleRecords = useMemo(
    () =>
      screenStatus
        ? records.filter((record) => record.preScreen?.status === screenStatus)
        : records,
    [records, screenStatus],
  );

  const metrics = useMemo(
    () => ({
      total: visibleRecords.length,
      viable: visibleRecords.filter(
        (record) => record.preScreen?.status === "VIABLE",
      ).length,
      negotiate: visibleRecords.filter(
        (record) =>
          record.preScreen?.status === "NEGOTIATE" ||
          record.preScreen?.status === "NOT_VIABLE",
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
            disabled={running || !sourceId}
            onClick={runDiscovery}
          >
            {running ? "Discovering..." : "Run selected source"}
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
            <span>Provisionally viable</span>
            <strong>{metrics.viable}</strong>
          </div>
          <div>
            <span>Negotiate / not viable</span>
            <strong>{metrics.negotiate}</strong>
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
            <span className="field-label">Search</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Title, submarket, or URL"
            />
          </label>
        </div>

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
                    className={`pre-screen pre-screen-${screening.status.toLowerCase().replace("_", "-")}`}
                  >
                    <div>
                      <span>Policy pre-screen</span>
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
                    {screening.requiredMonthlyGrossRentKsh ? (
                      <span>
                        Minimum gross rent to pass:{" "}
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
                        Provisional MAO:{" "}
                        <b>
                          {kes.format(
                            Number(screening.maximumAllowableOfferKsh),
                          )}
                        </b>
                      </span>
                    ) : null}
                    <small title={screening.assumptionsLabel}>
                      Provisional assumptions — verify before relying on this
                      result.
                    </small>
                  </div>
                  <div className="listing-facts">
                    <span>{record.draft.unitHints.length} unit hints</span>
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
