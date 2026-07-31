import type { County, CountyProfile, ScenarioDefinition } from "./types";

const caveat =
  "Provisional planning estimate only. Confirm property-specific rents, occupancy, costs, taxes, rates, and financing during due diligence.";

export const countyProfiles: Record<County, CountyProfile> = {
  Nairobi: {
    county: "Nairobi",
    label: "Nairobi provisional baseline",
    provisional: true,
    asOf: "2026-07-31",
    suggested: {
      baseOccupancy: "0.92",
      collectionLoss: "0.03",
      annualFixedOperatingCostPerUnitKsh: "42000",
      variablePercentOfEgi: "0.08",
      acquisitionPercentOfPrice: "0.065",
      financingPercentOfDebt: "0.02",
    },
    caveat,
  },
  Kiambu: {
    county: "Kiambu",
    label: "Kiambu provisional baseline",
    provisional: true,
    asOf: "2026-07-31",
    suggested: {
      baseOccupancy: "0.91",
      collectionLoss: "0.035",
      annualFixedOperatingCostPerUnitKsh: "36000",
      variablePercentOfEgi: "0.075",
      acquisitionPercentOfPrice: "0.065",
      financingPercentOfDebt: "0.02",
    },
    caveat,
  },
  Kajiado: {
    county: "Kajiado",
    label: "Kajiado provisional baseline",
    provisional: true,
    asOf: "2026-07-31",
    suggested: {
      baseOccupancy: "0.89",
      collectionLoss: "0.04",
      annualFixedOperatingCostPerUnitKsh: "34000",
      variablePercentOfEgi: "0.075",
      acquisitionPercentOfPrice: "0.065",
      financingPercentOfDebt: "0.02",
    },
    caveat,
  },
  Nakuru: {
    county: "Nakuru",
    label: "Nakuru provisional baseline",
    provisional: true,
    asOf: "2026-07-31",
    suggested: {
      baseOccupancy: "0.9",
      collectionLoss: "0.035",
      annualFixedOperatingCostPerUnitKsh: "31000",
      variablePercentOfEgi: "0.07",
      acquisitionPercentOfPrice: "0.065",
      financingPercentOfDebt: "0.02",
    },
    caveat,
  },
  Mombasa: {
    county: "Mombasa",
    label: "Mombasa provisional baseline",
    provisional: true,
    asOf: "2026-07-31",
    suggested: {
      baseOccupancy: "0.88",
      collectionLoss: "0.045",
      annualFixedOperatingCostPerUnitKsh: "38000",
      variablePercentOfEgi: "0.085",
      acquisitionPercentOfPrice: "0.065",
      financingPercentOfDebt: "0.02",
    },
    caveat,
  },
};

export function buildScenarios(
  baseOccupancy: string,
  stressOccupancy: string,
): ScenarioDefinition[] {
  return [
    {
      id: "base",
      label: "Base",
      occupancy: baseOccupancy,
      rentFactor: "1",
      expenseFactor: "1",
      collectionLossFactor: "1",
      qualificationScenario: false,
    },
    {
      id: "conservative",
      label: "Conservative / policy stress",
      occupancy: stressOccupancy,
      rentFactor: "0.95",
      expenseFactor: "1.1",
      collectionLossFactor: "1.25",
      qualificationScenario: true,
    },
    {
      id: "severe",
      label: "Severe downside",
      occupancy: "0.7",
      rentFactor: "0.85",
      expenseFactor: "1.25",
      collectionLossFactor: "1.5",
      qualificationScenario: false,
    },
  ];
}
