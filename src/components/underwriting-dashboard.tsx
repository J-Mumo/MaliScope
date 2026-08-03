"use client";

import { useMemo, useState } from "react";
import {
  analyzeListing,
  counties,
  countyProfiles,
  propertyListingSchema,
  seededListing,
  type DueDiligenceKey,
  type PropertyListing,
  type TrackedInput,
} from "@/domain";
import type { SaleListingImportDraft } from "@/sources/import-types";
import {
  findSourceByUrl,
  sourceRegistry,
  type SourceRegistryEntry,
} from "@/sources/registry";
import { ScenarioCard } from "./scenario-card";
import { TrackedField } from "./tracked-field";

const kes = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

function blankListing(): PropertyListing {
  const now = new Date().toISOString();
  const missingMoney = (): TrackedInput<string> => ({
    value: null,
    status: "missing",
  });
  const listing = structuredClone(seededListing);
  listing.id = `manual-${Date.now()}`;
  listing.title = "New apartment block";
  listing.address = "";
  listing.submarket = "";
  listing.askingPriceKsh = missingMoney();
  listing.unitMix = [
    {
      id: "unit-type-1",
      label: "Unit type 1",
      count: { value: null, status: "missing" },
      monthlyRentKsh: missingMoney(),
    },
  ];
  listing.operatingCosts = {
    annualFixedKsh: missingMoney(),
    variablePercentOfEgi: { value: null, status: "missing" },
  };
  listing.acquisitionCosts = {
    percentOfPrice: { value: null, status: "missing" },
    fixedKsh: missingMoney(),
    financingPercentOfDebt: { value: null, status: "missing" },
    financingFixedKsh: missingMoney(),
    initialReservesKsh: missingMoney(),
  };
  listing.loanTerms = {
    maximumLtv: { value: null, status: "missing" },
    annualInterestRate: { value: null, status: "missing" },
    amortizationYears: { value: null, status: "missing" },
  };
  listing.assumptions.baseOccupancy = { value: null, status: "missing" };
  listing.assumptions.collectionLoss = { value: null, status: "missing" };
  listing.assumptions.otherIncomeAnnualKsh = missingMoney();
  for (const key of Object.keys(listing.dueDiligence) as DueDiligenceKey[]) {
    listing.dueDiligence[key] = { value: null, status: "missing" };
  }
  listing.provenance = {
    adapter: "manual",
    externalId: null,
    sourceUrl: null,
    capturedAt: now,
    permissionBasis: "User-supplied listing facts",
  };
  listing.createdAt = now;
  listing.updatedAt = now;
  return listing;
}

const diligenceLabels: Record<DueDiligenceKey, string> = {
  title: "Title verified",
  planningApprovals: "Planning approvals",
  countyRatesAndLandRent: "Rates / land rent clear",
  utilityAndServiceArrears: "Utilities / service arrears clear",
  leasesAndRentRoll: "Leases and rent roll verified",
  structuralCondition: "Structural condition verified",
};

export function UnderwritingDashboard() {
  const [listing, setListing] = useState<PropertyListing>(() =>
    structuredClone(seededListing),
  );
  const [sourceUrl, setSourceUrl] = useState("");
  const [importText, setImportText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const analysis = useMemo(() => analyzeListing(listing), [listing]);
  const profile = countyProfiles[listing.county];

  const update = (change: (draft: PropertyListing) => void) => {
    setListing((current) => {
      const draft = structuredClone(current);
      change(draft);
      draft.updatedAt = new Date().toISOString();
      return draft;
    });
  };

  const importListing = () => {
    try {
      const parsedJson: unknown = JSON.parse(importText);
      const candidate =
        typeof parsedJson === "object" &&
        parsedJson !== null &&
        "listing" in parsedJson
          ? (parsedJson as { listing: unknown }).listing
          : parsedJson;
      const parsed = propertyListingSchema.safeParse(candidate);
      if (!parsed.success) {
        setNotice(`Import rejected: ${parsed.error.issues[0]?.message}`);
        return;
      }
      setListing(parsed.data);
      setNotice("Listing imported and analyzed locally.");
    } catch {
      setNotice("Import rejected: enter valid MaliScope listing JSON.");
    }
  };

  const applySourceDraft = (
    draft: SaleListingImportDraft,
    source: SourceRegistryEntry,
  ) => {
    if (!draft.county.value) {
      throw new Error(
        "The county could not be identified. Create a manual listing so it can be selected explicitly.",
      );
    }
    if (draft.county.status !== "reported") {
      throw new Error(
        `The parser inferred ${draft.county.value} County. Create a manual listing to confirm the county explicitly before analysis.`,
      );
    }
    const imported = blankListing();
    imported.id = `${draft.sourceId}-${draft.externalId ?? Date.now()}`;
    imported.title = draft.title.value ?? "Imported sale listing";
    imported.address = draft.address.value ?? "";
    imported.county = draft.county.value;
    imported.submarket = draft.submarket.value ?? "";
    imported.askingPriceKsh = draft.askingPriceKsh.value
      ? {
          value: draft.askingPriceKsh.value,
          status: "reported",
          note: draft.askingPriceKsh.evidence,
          sourceReference: draft.sourceUrl,
        }
      : { value: null, status: "missing" };
    imported.unitMix =
      draft.unitHints.length > 0
        ? draft.unitHints.map((hint, index) => ({
            id: `imported-unit-${index + 1}`,
            label: hint.label,
            count: {
              value: hint.count.value,
              status: hint.count.status,
              note: hint.count.evidence,
              sourceReference: draft.sourceUrl,
            },
            monthlyRentKsh: { value: null, status: "missing" },
          }))
        : [
            {
              id: "imported-unit-unknown",
              label: "Unit mix not reported",
              count: { value: null, status: "missing" },
              monthlyRentKsh: { value: null, status: "missing" },
            },
          ];
    imported.provenance = {
      adapter: draft.sourceId,
      externalId: draft.externalId,
      sourceUrl: draft.sourceUrl,
      capturedAt: draft.capturedAt,
      permissionBasis: source.permissionBasis!,
      rawReference: `sha256:${draft.extractedRecordSha256}`,
    };
    imported.createdAt = draft.capturedAt;
    imported.updatedAt = draft.capturedAt;
    setListing(imported);
  };

  const importFromWebsite = async () => {
    setNotice(null);
    let source: SourceRegistryEntry | null;
    try {
      source = findSourceByUrl(sourceUrl);
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "Invalid source URL");
      return;
    }
    if (!source) {
      setNotice(
        "This website is not registered. Use manual or typed JSON import instead.",
      );
      return;
    }
    if (source.accessStatus !== "approved" || !source.liveFetchEnabled) {
      setNotice(
        `${source.displayName}: ${source.accessStatus.replaceAll("_", " ")}. Live access remains disabled until written permission is recorded.`,
      );
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sourceUrl }),
      });
      const body = (await response.json()) as
        SaleListingImportDraft | { error: string };
      if (!response.ok || "error" in body) {
        throw new Error("error" in body ? body.error : "Website import failed");
      }
      applySourceDraft(body, source);
      setNotice(
        `Imported from ${source.displayName}. Review every extracted fact and complete the missing underwriting fields.`,
      );
    } catch (error: unknown) {
      setNotice(
        error instanceof Error ? error.message : "Website import failed",
      );
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(listing),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to save listing");
      }
      setNotice("Listing and analysis saved to PostgreSQL.");
    } catch (error: unknown) {
      setNotice(
        error instanceof Error ? error.message : "Unable to save listing",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <main>
      <nav className="topbar">
        <a className="brand" href="#top" aria-label="MaliScope home">
          <span className="brand-mark">M</span>
          <span>MaliScope</span>
        </a>
        <div className="nav-meta">
          <span>Kenya apartment intelligence</span>
          <span className="live-dot">MVP</span>
        </div>
      </nav>

      <section className="hero" id="top">
        <div>
          <span className="eyebrow">Cash-flow underwriting, with receipts</span>
          <h1>See the deal beneath the listing.</h1>
          <p>
            Evaluate existing apartment blocks with explicit debt, cost, stress,
            and provenance assumptions. Appreciation never decides the verdict.
          </p>
        </div>
        <div className="coverage">
          <span>Initial coverage</span>
          <strong>Nairobi / Kiambu / Kajiado / Nakuru / Mombasa</strong>
        </div>
      </section>

      <div className="workspace">
        <section className="input-panel">
          <header className="section-heading">
            <div>
              <span className="eyebrow">Property file</span>
              <h2>Listing and assumptions</h2>
            </div>
            <div className="button-row">
              <button
                className="button button-quiet"
                onClick={() => setListing(blankListing())}
              >
                New
              </button>
              <button
                className="button button-primary"
                onClick={save}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </header>

          {notice ? <div className="notice">{notice}</div> : null}

          <div className="form-grid">
            <label>
              <span className="field-label">Property name</span>
              <input
                value={listing.title}
                onChange={(event) =>
                  update((draft) => void (draft.title = event.target.value))
                }
              />
            </label>
            <label>
              <span className="field-label">Address</span>
              <input
                value={listing.address}
                onChange={(event) =>
                  update((draft) => void (draft.address = event.target.value))
                }
              />
            </label>
            <label>
              <span className="field-label">County</span>
              <select
                value={listing.county}
                onChange={(event) =>
                  update(
                    (draft) =>
                      void (draft.county = event.target
                        .value as PropertyListing["county"]),
                  )
                }
              >
                {counties.map((county) => (
                  <option key={county}>{county}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="field-label">Submarket</span>
              <input
                value={listing.submarket}
                onChange={(event) =>
                  update((draft) => void (draft.submarket = event.target.value))
                }
              />
            </label>
          </div>

          <div className="profile-caveat">
            <strong>{profile.label}</strong>
            <span>{profile.caveat}</span>
          </div>

          <fieldset>
            <legend>Price and unit mix</legend>
            <TrackedField
              label="Asking price"
              input={listing.askingPriceKsh}
              suffix="KSh"
              onChange={(value) =>
                update((draft) => void (draft.askingPriceKsh = value))
              }
            />
            {listing.unitMix.map((unit, index) => (
              <div className="unit-row" key={unit.id}>
                <label>
                  <span className="field-label">Unit type</span>
                  <input
                    value={unit.label}
                    onChange={(event) =>
                      update(
                        (draft) =>
                          void (draft.unitMix[index]!.label =
                            event.target.value),
                      )
                    }
                  />
                </label>
                <TrackedField
                  label="Count"
                  input={unit.count}
                  step="1"
                  min="1"
                  serializeAsNumber
                  onChange={(value) =>
                    update(
                      (draft) => void (draft.unitMix[index]!.count = value),
                    )
                  }
                />
                <TrackedField
                  label="Monthly rent"
                  input={unit.monthlyRentKsh}
                  suffix="KSh"
                  onChange={(value) =>
                    update(
                      (draft) =>
                        void (draft.unitMix[index]!.monthlyRentKsh = value),
                    )
                  }
                />
                {listing.unitMix.length > 1 ? (
                  <button
                    className="icon-button"
                    aria-label={`Remove ${unit.label}`}
                    onClick={() =>
                      update((draft) => void draft.unitMix.splice(index, 1))
                    }
                  >
                    &times;
                  </button>
                ) : null}
              </div>
            ))}
            <button
              className="button button-quiet"
              onClick={() =>
                update(
                  (draft) =>
                    void draft.unitMix.push({
                      id: `unit-${Date.now()}`,
                      label: "Unit type",
                      count: { value: 1, status: "reported" },
                      monthlyRentKsh: { value: null, status: "missing" },
                    }),
                )
              }
            >
              + Add unit type
            </button>
          </fieldset>

          <fieldset>
            <legend>Income and operating costs</legend>
            <div className="form-grid">
              <TrackedField
                label="Annual fixed operating costs"
                input={listing.operatingCosts.annualFixedKsh}
                suffix="KSh"
                onChange={(value) =>
                  update(
                    (draft) =>
                      void (draft.operatingCosts.annualFixedKsh = value),
                  )
                }
              />
              <TrackedField
                label="Variable costs / EGI"
                input={listing.operatingCosts.variablePercentOfEgi}
                step="0.001"
                onChange={(value) =>
                  update(
                    (draft) =>
                      void (draft.operatingCosts.variablePercentOfEgi = value),
                  )
                }
              />
              <TrackedField
                label="Other annual income"
                input={listing.assumptions.otherIncomeAnnualKsh}
                suffix="KSh"
                onChange={(value) =>
                  update(
                    (draft) =>
                      void (draft.assumptions.otherIncomeAnnualKsh = value),
                  )
                }
              />
              <TrackedField
                label="Collection loss"
                input={listing.assumptions.collectionLoss}
                step="0.001"
                onChange={(value) =>
                  update(
                    (draft) => void (draft.assumptions.collectionLoss = value),
                  )
                }
              />
            </div>
          </fieldset>

          <fieldset>
            <legend>Debt and investment policy</legend>
            <div className="form-grid">
              <TrackedField
                label="Maximum LTV"
                input={listing.loanTerms.maximumLtv}
                step="0.01"
                onChange={(value) =>
                  update((draft) => void (draft.loanTerms.maximumLtv = value))
                }
              />
              <TrackedField
                label="Annual interest rate"
                input={listing.loanTerms.annualInterestRate}
                step="0.001"
                onChange={(value) =>
                  update(
                    (draft) =>
                      void (draft.loanTerms.annualInterestRate = value),
                  )
                }
              />
              <TrackedField
                label="Amortization years"
                input={listing.loanTerms.amortizationYears}
                step="1"
                min="1"
                serializeAsNumber
                onChange={(value) =>
                  update(
                    (draft) => void (draft.loanTerms.amortizationYears = value),
                  )
                }
              />
              <TrackedField
                label="Minimum DSCR"
                input={listing.assumptions.minimumDscr}
                step="0.01"
                onChange={(value) =>
                  update(
                    (draft) => void (draft.assumptions.minimumDscr = value),
                  )
                }
              />
              <TrackedField
                label="Base occupancy"
                input={listing.assumptions.baseOccupancy}
                step="0.01"
                onChange={(value) =>
                  update(
                    (draft) => void (draft.assumptions.baseOccupancy = value),
                  )
                }
              />
              <TrackedField
                label="Policy stress occupancy"
                input={listing.assumptions.stressOccupancy}
                step="0.01"
                onChange={(value) =>
                  update(
                    (draft) => void (draft.assumptions.stressOccupancy = value),
                  )
                }
              />
              <TrackedField
                label="Minimum cash-on-cash"
                input={listing.assumptions.minimumCashOnCash}
                step="0.01"
                onChange={(value) =>
                  update(
                    (draft) =>
                      void (draft.assumptions.minimumCashOnCash = value),
                  )
                }
              />
              <TrackedField
                label="Minimum stressed monthly cash flow"
                input={listing.assumptions.minimumStressMonthlyCashFlowKsh}
                suffix="KSh"
                onChange={(value) =>
                  update(
                    (draft) =>
                      void (draft.assumptions.minimumStressMonthlyCashFlowKsh =
                        value),
                  )
                }
              />
            </div>
          </fieldset>

          <fieldset>
            <legend>Acquisition, financing, and reserves</legend>
            <div className="form-grid">
              <TrackedField
                label="Acquisition cost / price"
                input={listing.acquisitionCosts.percentOfPrice}
                step="0.001"
                onChange={(value) =>
                  update(
                    (draft) =>
                      void (draft.acquisitionCosts.percentOfPrice = value),
                  )
                }
              />
              <TrackedField
                label="Fixed acquisition costs"
                input={listing.acquisitionCosts.fixedKsh}
                suffix="KSh"
                onChange={(value) =>
                  update(
                    (draft) => void (draft.acquisitionCosts.fixedKsh = value),
                  )
                }
              />
              <TrackedField
                label="Financing cost / debt"
                input={listing.acquisitionCosts.financingPercentOfDebt}
                step="0.001"
                onChange={(value) =>
                  update(
                    (draft) =>
                      void (draft.acquisitionCosts.financingPercentOfDebt =
                        value),
                  )
                }
              />
              <TrackedField
                label="Fixed financing costs"
                input={listing.acquisitionCosts.financingFixedKsh}
                suffix="KSh"
                onChange={(value) =>
                  update(
                    (draft) =>
                      void (draft.acquisitionCosts.financingFixedKsh = value),
                  )
                }
              />
              <TrackedField
                label="Initial reserves"
                input={listing.acquisitionCosts.initialReservesKsh}
                suffix="KSh"
                onChange={(value) =>
                  update(
                    (draft) =>
                      void (draft.acquisitionCosts.initialReservesKsh = value),
                  )
                }
              />
            </div>
          </fieldset>

          <fieldset>
            <legend>Due diligence status</legend>
            <div className="diligence-grid">
              {(Object.keys(diligenceLabels) as DueDiligenceKey[]).map(
                (key) => (
                  <label key={key}>
                    <span>{diligenceLabels[key]}</span>
                    <select
                      value={
                        listing.dueDiligence[key].status === "missing"
                          ? "missing"
                          : listing.dueDiligence[key].value
                            ? "verified"
                            : "not-verified"
                      }
                      onChange={(event) =>
                        update((draft) => {
                          const value = event.target.value;
                          draft.dueDiligence[key] =
                            value === "missing"
                              ? { value: null, status: "missing" }
                              : {
                                  value: value === "verified",
                                  status: "reported",
                                };
                        })
                      }
                    >
                      <option value="missing">Missing</option>
                      <option value="not-verified">Not verified</option>
                      <option value="verified">Verified</option>
                    </select>
                  </label>
                ),
              )}
            </div>
          </fieldset>

          <details className="import-box" open>
            <summary>Import from a listing website</summary>
            <p className="import-explainer">
              Connectors and parsers are ready for testing, but live access
              stays off until the source permission record is approved.
            </p>
            <div className="source-grid">
              {sourceRegistry.map((source) => (
                <a
                  href={source.saleUrl}
                  target="_blank"
                  rel="noreferrer"
                  key={source.id}
                >
                  <strong>{source.displayName}</strong>
                  <span
                    className={`source-state source-${source.accessStatus}`}
                  >
                    {source.accessStatus.replaceAll("_", " ")}
                  </span>
                </a>
              ))}
            </div>
            <div className="url-import-row">
              <input
                type="url"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder="https://approved-source.example/property/..."
                aria-label="Property listing URL"
              />
              <button
                className="button button-primary"
                onClick={importFromWebsite}
                disabled={saving || !sourceUrl}
              >
                Import URL
              </button>
            </div>
          </details>

          <details className="import-box">
            <summary>Import typed listing JSON</summary>
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder='Paste a MaliScope PropertyListing object or {"listing": ...}'
              rows={8}
            />
            <button className="button button-primary" onClick={importListing}>
              Validate and import
            </button>
          </details>
        </section>

        <aside className="results-panel">
          <div
            className={`recommendation recommendation-${analysis.recommendation.toLowerCase()}`}
          >
            <span className="eyebrow">Recommendation</span>
            <h2>{analysis.recommendationLabel}</h2>
            <p>
              {analysis.maximumAllowableOfferKsh
                ? `MAO ${kes.format(Number(analysis.maximumAllowableOfferKsh))}`
                : "Complete the required financial inputs to calculate an offer."}
            </p>
          </div>

          <div className="confidence">
            <div>
              <span className="eyebrow">Analysis confidence</span>
              <strong>
                {analysis.completeness.score}% / {analysis.completeness.label}
              </strong>
            </div>
            <div className="confidence-bar">
              <span style={{ width: `${analysis.completeness.score}%` }} />
            </div>
            <small>
              {analysis.completeness.reportedCount} reported /{" "}
              {analysis.completeness.estimatedCount} estimated /{" "}
              {analysis.completeness.missingCount} missing
            </small>
          </div>

          <div className="reason-block">
            <h3>Decision record</h3>
            <ul>
              {analysis.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>

          {analysis.debtCapacity ? (
            <div className="debt-block">
              <span className="eyebrow">Maximum safely supported debt</span>
              <strong>
                {kes.format(Number(analysis.debtCapacity.maximumDebtKsh))}
              </strong>
              <small>
                Binding: {analysis.debtCapacity.bindingConstraints.join(", ")}
              </small>
            </div>
          ) : null}

          {analysis.missingFields.length > 0 ? (
            <div className="alert alert-danger">
              <strong>Required data missing</strong>
              <ul>
                {analysis.missingFields.map((field) => (
                  <li key={field}>{field}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {analysis.warnings.length > 0 ? (
            <div className="alert">
              <strong>Warnings</strong>
              <ul>
                {analysis.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {analysis.dueDiligenceFields.length > 0 ? (
            <div className="alert">
              <strong>Open due diligence</strong>
              <ul>
                {analysis.dueDiligenceFields.map((field) => (
                  <li key={field}>{field}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>

      {analysis.scenarios.length > 0 ? (
        <section className="scenarios">
          <header className="section-heading">
            <div>
              <span className="eyebrow">Downside visibility</span>
              <h2>Scenario ledger</h2>
            </div>
            <p>
              Same property and debt, progressively lower rent and occupancy
              with higher costs and collection loss.
            </p>
          </header>
          <div className="scenario-grid">
            {analysis.scenarios.map((scenario) => (
              <ScenarioCard key={scenario.scenarioId} scenario={scenario} />
            ))}
          </div>
        </section>
      ) : null}

      <footer>
        <span>MaliScope MVP</span>
        <span>
          Provisional assumptions are not market advice. Verify every property
          fact.
        </span>
      </footer>
    </main>
  );
}
