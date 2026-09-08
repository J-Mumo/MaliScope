"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  analyzeListing,
  counties,
  countyProfiles,
  propertyListingSchema,
  seededListing,
  type County,
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
  return seedWithCountyProfile(listing);
}

const diligenceLabels: Record<DueDiligenceKey, string> = {
  title: "Title verified",
  planningApprovals: "Planning approvals",
  countyRatesAndLandRent: "Rates / land rent clear",
  utilityAndServiceArrears: "Utilities / service arrears clear",
  leasesAndRentRoll: "Leases and rent roll verified",
  structuralCondition: "Structural condition verified",
};

function resolveCounty(county: County | null | undefined): County {
  if (county && county in countyProfiles) return county;
  return "Nairobi";
}

function shouldSeed(
  field: TrackedInput<unknown>,
  overrideEstimated: boolean,
): boolean {
  if (field.status === "missing") return true;
  if (overrideEstimated && field.status === "estimated") return true;
  return false;
}

const estimatedInput = <T,>(
  value: T,
  note: string,
): TrackedInput<T> => ({
  value,
  status: "estimated",
  note,
});

function totalUnitCount(listing: PropertyListing): number {
  return listing.unitMix.reduce(
    (sum, unit) => sum + (unit.count.value ?? 0),
    0,
  );
}

function totalMonthlyRent(listing: PropertyListing): number {
  return listing.unitMix.reduce((sum, unit) => {
    const count = unit.count.value ?? 0;
    const rent = Number(unit.monthlyRentKsh.value ?? 0);
    return sum + (Number.isFinite(rent) ? count * rent : 0);
  }, 0);
}

function seedWithCountyProfile(
  listing: PropertyListing,
  { overrideEstimated = false }: { overrideEstimated?: boolean } = {},
): PropertyListing {
  const county = resolveCounty(listing.county);
  const profile = countyProfiles[county];
  const draft = structuredClone(listing);
  draft.county = county;
  const label = profile.label;
  const totalUnits = Math.max(1, totalUnitCount(draft));
  const askingPrice = Number(draft.askingPriceKsh.value ?? 0);
  const monthlyRent = totalMonthlyRent(draft);

  if (shouldSeed(draft.operatingCosts.annualFixedKsh, overrideEstimated)) {
    const fixed = Number(
      profile.suggested.annualFixedOperatingCostPerUnitKsh,
    );
    draft.operatingCosts.annualFixedKsh = estimatedInput(
      (fixed * totalUnits).toFixed(2),
      label,
    );
  }
  if (shouldSeed(draft.operatingCosts.variablePercentOfEgi, overrideEstimated)) {
    draft.operatingCosts.variablePercentOfEgi = estimatedInput(
      profile.suggested.variablePercentOfEgi,
      label,
    );
  }
  if (shouldSeed(draft.acquisitionCosts.percentOfPrice, overrideEstimated)) {
    draft.acquisitionCosts.percentOfPrice = estimatedInput(
      profile.suggested.acquisitionPercentOfPrice,
      label,
    );
  }
  if (shouldSeed(draft.acquisitionCosts.fixedKsh, overrideEstimated)) {
    const fixedAcquisition = Math.max(350_000, askingPrice * 0.005);
    draft.acquisitionCosts.fixedKsh = estimatedInput(
      fixedAcquisition.toFixed(2),
      "Provisional legal, valuation, and diligence allowance",
    );
  }
  if (
    shouldSeed(
      draft.acquisitionCosts.financingPercentOfDebt,
      overrideEstimated,
    )
  ) {
    draft.acquisitionCosts.financingPercentOfDebt = estimatedInput(
      profile.suggested.financingPercentOfDebt,
      label,
    );
  }
  if (shouldSeed(draft.acquisitionCosts.financingFixedKsh, overrideEstimated)) {
    draft.acquisitionCosts.financingFixedKsh = estimatedInput(
      "150000",
      "Provisional financing legal-cost allowance",
    );
  }
  if (shouldSeed(draft.acquisitionCosts.initialReservesKsh, overrideEstimated)) {
    if (monthlyRent > 0) {
      draft.acquisitionCosts.initialReservesKsh = estimatedInput(
        (monthlyRent * 3).toFixed(2),
        "Three months of gross rent for provisional reserves",
      );
    }
  }
  if (shouldSeed(draft.loanTerms.maximumLtv, overrideEstimated)) {
    draft.loanTerms.maximumLtv = estimatedInput(
      "0.70",
      "MaliScope policy default",
    );
  }
  if (shouldSeed(draft.loanTerms.annualInterestRate, overrideEstimated)) {
    draft.loanTerms.annualInterestRate = estimatedInput(
      "0.145",
      "MaliScope policy default",
    );
  }
  if (shouldSeed(draft.loanTerms.amortizationYears, overrideEstimated)) {
    draft.loanTerms.amortizationYears = estimatedInput(
      15,
      "MaliScope policy default",
    );
  }
  if (shouldSeed(draft.assumptions.baseOccupancy, overrideEstimated)) {
    draft.assumptions.baseOccupancy = estimatedInput(
      profile.suggested.baseOccupancy,
      label,
    );
  }
  if (shouldSeed(draft.assumptions.collectionLoss, overrideEstimated)) {
    draft.assumptions.collectionLoss = estimatedInput(
      profile.suggested.collectionLoss,
      label,
    );
  }
  if (shouldSeed(draft.assumptions.otherIncomeAnnualKsh, overrideEstimated)) {
    draft.assumptions.otherIncomeAnnualKsh = estimatedInput(
      "0",
      "No other income assumed by default",
    );
  }

  return draft;
}

interface SensitivityInputs {
  rentMultiplier: number;
  occupancyOverride: number;
  costMultiplier: number;
}

function applySensitivity(
  listing: PropertyListing,
  { rentMultiplier, occupancyOverride, costMultiplier }: SensitivityInputs,
): PropertyListing {
  const draft = structuredClone(listing);

  if (rentMultiplier !== 1) {
    draft.unitMix = draft.unitMix.map((unit) => {
      if (!unit.monthlyRentKsh.value) return unit;
      const original = Number(unit.monthlyRentKsh.value);
      if (!Number.isFinite(original)) return unit;
      return {
        ...unit,
        monthlyRentKsh: {
          ...unit.monthlyRentKsh,
          value: (original * rentMultiplier).toFixed(2),
          status: "estimated",
          note: `Sensitivity: rent \u00d7 ${rentMultiplier.toFixed(2)}`,
        },
      };
    });
  }

  draft.assumptions.baseOccupancy = {
    ...draft.assumptions.baseOccupancy,
    value: occupancyOverride.toFixed(2),
    status: "estimated",
    note: `Sensitivity: base occupancy override ${(occupancyOverride * 100).toFixed(0)}%`,
  };

  if (
    costMultiplier !== 1 &&
    draft.operatingCosts.annualFixedKsh.value
  ) {
    const original = Number(draft.operatingCosts.annualFixedKsh.value);
    if (Number.isFinite(original)) {
      draft.operatingCosts.annualFixedKsh = {
        ...draft.operatingCosts.annualFixedKsh,
        value: (original * costMultiplier).toFixed(2),
        status: "estimated",
        note: `Sensitivity: fixed opex \u00d7 ${costMultiplier.toFixed(2)}`,
      };
    }
  }

  return draft;
}

export function UnderwritingDashboard() {
  const [listing, setListing] = useState<PropertyListing>(() =>
    structuredClone(seededListing),
  );
  const [sourceUrl, setSourceUrl] = useState("");
  const [importText, setImportText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rentDelta, setRentDelta] = useState(0);
  const [occupancyOverride, setOccupancyOverride] = useState<number | null>(
    null,
  );
  const [costInflation, setCostInflation] = useState(0);
  const analysis = useMemo(() => analyzeListing(listing), [listing]);
  const profile = countyProfiles[listing.county];

  const baseOccupancyValue = Number(listing.assumptions.baseOccupancy.value);
  const effectiveOccupancy =
    occupancyOverride ??
    (Number.isFinite(baseOccupancyValue) && baseOccupancyValue > 0
      ? Math.min(1, Math.max(0.75, baseOccupancyValue))
      : 0.9);
  const sensitivityInputs: SensitivityInputs = {
    rentMultiplier: 1 + rentDelta,
    occupancyOverride: effectiveOccupancy,
    costMultiplier: 1 + costInflation,
  };
  const sensitivityActive =
    rentDelta !== 0 || costInflation !== 0 || occupancyOverride !== null;
  const sensitivityListing = useMemo(
    () => applySensitivity(listing, sensitivityInputs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      listing,
      sensitivityInputs.rentMultiplier,
      sensitivityInputs.occupancyOverride,
      sensitivityInputs.costMultiplier,
    ],
  );
  const sensitivityAnalysis = useMemo(
    () => analyzeListing(sensitivityListing),
    [sensitivityListing],
  );
  const sensitivityBaseScenario = sensitivityAnalysis.scenarios.find(
    (scenario) => scenario.scenarioId === "base",
  );
  const baseScenario = analysis.scenarios.find(
    (scenario) => scenario.scenarioId === "base",
  );
  const resetSensitivity = () => {
    setRentDelta(0);
    setOccupancyOverride(null);
    setCostInflation(0);
  };

  useEffect(() => {
    const listingId = new URLSearchParams(window.location.search).get(
      "listing",
    );
    if (!listingId) return;
    let active = true;
    fetch(`/api/listings/${encodeURIComponent(listingId)}`)
      .then(async (response) => {
        const body = (await response.json()) as
          PropertyListing | { error: string };
        if (!response.ok || "error" in body) {
          throw new Error(
            "error" in body ? body.error : "Unable to load listing",
          );
        }
        if (active) {
          setListing(seedWithCountyProfile(body));
          setNotice(
            "Discovered listing loaded. County-profile defaults applied where source facts were missing \u2014 review the estimated fields.",
          );
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setNotice(
            error instanceof Error ? error.message : "Unable to load listing",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

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
      setListing(seedWithCountyProfile(parsed.data));
      setNotice("Listing imported and analyzed locally.");
    } catch {
      setNotice("Import rejected: enter valid MaliScope listing JSON.");
    }
  };

  const applySourceDraft = (
    draft: SaleListingImportDraft,
    source: SourceRegistryEntry,
  ) => {
    const imported = blankListing();
    imported.id = `${draft.sourceId}-${draft.externalId ?? Date.now()}`;
    imported.title = draft.title.value ?? "Imported sale listing";
    imported.address = draft.address.value ?? "";
    imported.county = resolveCounty(draft.county.value);
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
    setListing(seedWithCountyProfile(imported));
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
        <div className="nav-links">
          <Link className="active" href="/">
            Underwriting
          </Link>
          <Link href="/discovery">Listings discovery</Link>
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
                onChange={(event) => {
                  const nextCounty = event.target
                    .value as PropertyListing["county"];
                  setListing((current) => {
                    const next = seedWithCountyProfile(
                      { ...current, county: nextCounty },
                      { overrideEstimated: true },
                    );
                    next.updatedAt = new Date().toISOString();
                    return next;
                  });
                }}
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
          <div className="sensitivity-strip">
            <div className="sensitivity-heading">
              <div>
                <span className="eyebrow">Sensitivity</span>
                <strong>Move the sliders to stress-test the analysis</strong>
              </div>
              <button
                className="button button-quiet"
                type="button"
                onClick={resetSensitivity}
                disabled={!sensitivityActive}
              >
                Reset
              </button>
            </div>
            <div className="sensitivity-sliders">
              <label>
                <span className="field-label">
                  Rent{" "}
                  <b>
                    {rentDelta >= 0 ? "+" : ""}
                    {Math.round(rentDelta * 100)}%
                  </b>
                </span>
                <input
                  type="range"
                  min={-0.2}
                  max={0.2}
                  step={0.01}
                  value={rentDelta}
                  onChange={(event) =>
                    setRentDelta(Number(event.target.value))
                  }
                />
              </label>
              <label>
                <span className="field-label">
                  Base occupancy <b>{Math.round(effectiveOccupancy * 100)}%</b>
                </span>
                <input
                  type="range"
                  min={0.75}
                  max={1}
                  step={0.01}
                  value={effectiveOccupancy}
                  onChange={(event) =>
                    setOccupancyOverride(Number(event.target.value))
                  }
                />
              </label>
              <label>
                <span className="field-label">
                  Fixed opex{" "}
                  <b>
                    {costInflation >= 0 ? "+" : ""}
                    {Math.round(costInflation * 100)}%
                  </b>
                </span>
                <input
                  type="range"
                  min={0}
                  max={0.5}
                  step={0.05}
                  value={costInflation}
                  onChange={(event) =>
                    setCostInflation(Number(event.target.value))
                  }
                />
              </label>
            </div>
            {analysis.scenarios.length > 0 ||
            sensitivityAnalysis.scenarios.length > 0 ? (
              <div className="sensitivity-metrics">
                <div>
                  <span>Recommendation</span>
                  <strong>{sensitivityAnalysis.recommendationLabel}</strong>
                  {sensitivityActive &&
                  sensitivityAnalysis.recommendation !==
                    analysis.recommendation ? (
                    <small>was {analysis.recommendationLabel}</small>
                  ) : null}
                </div>
                <div>
                  <span>MAO</span>
                  <strong>
                    {sensitivityAnalysis.maximumAllowableOfferKsh
                      ? kes.format(
                          Number(sensitivityAnalysis.maximumAllowableOfferKsh),
                        )
                      : "\u2014"}
                  </strong>
                  {sensitivityActive &&
                  sensitivityAnalysis.maximumAllowableOfferKsh &&
                  analysis.maximumAllowableOfferKsh ? (
                    <small>
                      {(() => {
                        const base = Number(analysis.maximumAllowableOfferKsh);
                        const next = Number(
                          sensitivityAnalysis.maximumAllowableOfferKsh,
                        );
                        if (!Number.isFinite(base) || base === 0) return null;
                        const delta = ((next - base) / base) * 100;
                        const arrow =
                          delta > 0 ? "\u2191" : delta < 0 ? "\u2193" : "";
                        return `${arrow} ${Math.abs(delta).toFixed(1)}% vs base`;
                      })()}
                    </small>
                  ) : null}
                </div>
                <div>
                  <span>Base DSCR</span>
                  <strong>
                    {sensitivityBaseScenario?.dscr
                      ? `${Number(sensitivityBaseScenario.dscr).toFixed(2)}\u00d7`
                      : "\u2014"}
                  </strong>
                  {sensitivityActive && baseScenario?.dscr ? (
                    <small>
                      {`was ${Number(baseScenario.dscr).toFixed(2)}\u00d7`}
                    </small>
                  ) : null}
                </div>
                <div>
                  <span>Base cash-on-cash</span>
                  <strong>
                    {sensitivityBaseScenario?.cashOnCashReturn
                      ? `${(
                          Number(sensitivityBaseScenario.cashOnCashReturn) * 100
                        ).toFixed(1)}%`
                      : "\u2014"}
                  </strong>
                  {sensitivityActive && baseScenario?.cashOnCashReturn ? (
                    <small>
                      was{" "}
                      {(Number(baseScenario.cashOnCashReturn) * 100).toFixed(1)}
                      %
                    </small>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="sensitivity-empty">
                Fill in the required financial inputs (asking price, at least
                one unit rent, operating costs, and loan terms) to activate the
                stress tiles.
              </p>
            )}
          </div>
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
