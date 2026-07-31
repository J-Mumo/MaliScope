import { z } from "zod";
import { counties } from "./types";

const decimalString = z
  .string()
  .trim()
  .min(1)
  .refine((value) => /^-?\d+(\.\d+)?$/.test(value), "Must be a decimal string");

const money = decimalString.refine(
  (value) => Number(value) >= 0,
  "Money cannot be negative",
);
const rate = decimalString.refine(
  (value) => Number(value) >= 0 && Number(value) <= 1,
  "Rate must be between 0 and 1",
);

function tracked<T extends z.ZodType>(valueSchema: T) {
  const metadata = {
    note: z.string().optional(),
    sourceReference: z.string().optional(),
  };

  return z.discriminatedUnion("status", [
    z.object({
      ...metadata,
      value: valueSchema,
      status: z.literal("reported"),
    }),
    z.object({
      ...metadata,
      value: valueSchema,
      status: z.literal("estimated"),
    }),
    z.object({
      ...metadata,
      value: z.null(),
      status: z.literal("missing"),
    }),
  ]);
}

const trackedMoney = tracked(money);
const trackedRate = tracked(rate);
const trackedBoolean = tracked(z.boolean());
const trackedPositiveInteger = tracked(z.number().int().positive());

export const propertyListingSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  address: z.string(),
  county: z.enum(counties),
  submarket: z.string(),
  askingPriceKsh: trackedMoney,
  unitMix: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        count: trackedPositiveInteger,
        monthlyRentKsh: trackedMoney,
      }),
    )
    .min(1),
  operatingCosts: z.object({
    annualFixedKsh: trackedMoney,
    variablePercentOfEgi: trackedRate,
  }),
  acquisitionCosts: z.object({
    percentOfPrice: trackedRate,
    fixedKsh: trackedMoney,
    financingPercentOfDebt: trackedRate,
    financingFixedKsh: trackedMoney,
    initialReservesKsh: trackedMoney,
  }),
  loanTerms: z.object({
    maximumLtv: trackedRate,
    annualInterestRate: trackedRate,
    amortizationYears: trackedPositiveInteger,
  }),
  assumptions: z.object({
    baseOccupancy: trackedRate,
    collectionLoss: trackedRate,
    otherIncomeAnnualKsh: trackedMoney,
    minimumDscr: tracked(
      decimalString.refine(
        (value) => Number(value) >= 1,
        "DSCR must be at least 1",
      ),
    ),
    minimumCashOnCash: tracked(
      rate.refine(
        (value) => Number(value) >= 0.12 && Number(value) <= 0.15,
        "Cash-on-cash target must be between 0.12 and 0.15",
      ),
    ),
    stressOccupancy: trackedRate,
    minimumStressMonthlyCashFlowKsh: trackedMoney,
  }),
  dueDiligence: z.object({
    title: trackedBoolean,
    planningApprovals: trackedBoolean,
    countyRatesAndLandRent: trackedBoolean,
    utilityAndServiceArrears: trackedBoolean,
    leasesAndRentRoll: trackedBoolean,
    structuralCondition: trackedBoolean,
  }),
  provenance: z.object({
    adapter: z.string().min(1),
    externalId: z.string().nullable(),
    sourceUrl: z.string().url().nullable(),
    capturedAt: z.string().datetime(),
    permissionBasis: z.string().min(1),
    rawReference: z.string().optional(),
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const listingImportSchema = z.object({
  listing: propertyListingSchema,
});

export type PropertyListingInput = z.infer<typeof propertyListingSchema>;
