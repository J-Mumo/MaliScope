# MaliScope

MaliScope is an auditable cash-flow underwriting and approved-source discovery
MVP for existing apartment blocks in Nairobi, Kiambu, Kajiado, Nakuru, and
Mombasa. It combines website, manual, or typed listing ingestion, explicit
property and financing assumptions, stress scenarios, a maximum allowable offer
(MAO), and a recommendation dashboard.

### Approved website connectors

MaliScope includes bounded discovery crawlers, fixture-tested parsers, and
single-URL import for Equity Assets, HF Marketplace, Jiji Kenya, Kenya Property
Centre, PropertyPro Kenya, BuyRentKenya, HassConsult, and Knight Frank Kenya.
The current registry marks these sources approved using the agreement metadata
supplied for this deployment. A source is contacted only when its registry entry
has all of:

1. `accessStatus: "approved"`;
2. a written `permissionBasis` and `agreementRef`;
3. approval date and named reviewer;
4. an agreed identifying user agent; and
5. `liveFetchEnabled: true`.

Both the URL-import HTTP boundary and scheduled adapter permission check enforce
that metadata before making a request. Crawls use exact HTTPS host allowlists,
reject redirects, cap responses at 2 MB and detail pages at 20 per source, and
wait at least one second between detail requests. Tests use representative local
HTML fixtures. Parsed claims remain reported, location inference is estimated,
unknown facts stay missing, and only a hash of the normalized extracted record
is retained as the raw audit reference.

Connector health is reported per source rather than treating every empty result
as “no listings.” HassConsult discovery uses its current server-rendered
`/investment-collection` and `/living-collection` detail links. Equity currently
returns an Imperva challenge to this crawler and requires an allowlisted client,
feed, or API from Equity. HF Marketplace's host must be reachable from the
deployment network. Neither access control nor an unavailable host is bypassed;
the job reports the underlying source-access failure and continues with the
remaining approved sources.

## Architecture

This repository is a single deployable full-stack TypeScript application:

| Area               | Implementation                                            |
| ------------------ | --------------------------------------------------------- |
| Web and API        | Next.js App Router and React                              |
| Domain             | Pure TypeScript functions under `src/domain`              |
| Decimal arithmetic | `decimal.js`, precision 40, half-even output rounding     |
| Validation         | Zod schemas with tracked input-state invariants           |
| Persistence        | PostgreSQL with Drizzle ORM and versioned migrations      |
| Discovery boundary | Permission-gated `ListingSourceAdapter` interface         |
| Scheduled work     | Framework-neutral discovery and re-analysis job functions |
| Tests              | Vitest                                                    |

The underwriting engine has no browser, HTTP, scheduler, or database
dependency. Inputs and outputs are JSON-compatible, so results can be
reproduced independently and stored as immutable analysis snapshots.

```text
React dashboard
  -> validated API routes
    -> PostgreSQL listing + analysis snapshots

Approved source index pages
  -> bounded same-host discovery
    -> incomplete discovery draft + provenance
      -> human review / county confirmation
        -> validated underwriting listing
          -> pure underwriting engine
            -> auditable scenario result + recommendation
```

## Setup

Requires Node.js 22 or later, npm, and Docker (or an existing PostgreSQL
database).

The project Docker database binds host port `5433` to avoid collisions with a
locally installed PostgreSQL server on the default port. Drizzle commands load
`.env.local` automatically.

```powershell
npm install
Copy-Item .env.example .env.local
docker compose up -d
$env:DATABASE_URL="postgres://maliscope:maliscope@localhost:5432/maliscope"
$env:DATABASE_URL=$env:DATABASE_URL -replace ':5432/', ':5433/'
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`. The dashboard starts with a synthetic Kilimani
example. Analysis runs locally as fields change. `Save` persists the listing
and its current analysis; without `DATABASE_URL`, the API returns an explicit
configuration error and local analysis still works.

Open `http://localhost:3000/discovery` to browse persisted source drafts, filter
by source, county, status, or text, run one approved source during local
development, inspect freshness and missing facts, and promote a reviewed draft
into underwriting. An inferred or missing county must be explicitly confirmed
before promotion. Unknown rents, expenses, financing, and due-diligence facts
remain missing, so promoted records normally begin as `NEEDS_DATA`.

Each discovery card includes a **provisional policy pre-screen** before
promotion. When the source explicitly reports asking price, total units, county,
and gross rental income, it returns `PROVISIONALLY VIABLE`, `NEGOTIATE`, or
`NOT VIABLE` using the same DSCR, stressed-cash-flow, cash-on-cash, and MAO
engine as full underwriting. When rent is absent, it returns `NEEDS DATA` and,
where price/county/unit count permit, shows the minimum verified gross monthly
rent needed to pass. The screen visibly uses provisional county costs, 70% LTV,
14.5% interest, 15-year amortization, three months of gross-rent reserves, 1.30
DSCR, 13% cash-on-cash, and 85% stress occupancy; it never presents those
estimates as source-reported facts.

Run the safe sample discovery job:

```powershell
npm run job:sample
```

With `DATABASE_URL`, it upserts and analyzes the synthetic listing. Without a
database configuration, it runs in clearly labelled dry-run mode and prints
the recommendation. It never makes a network request.

Run bounded discovery for every approved source:

```powershell
npm run job:discover
```

This command requires `DATABASE_URL`, persists source drafts and job results,
and is the production scheduler entry point. On `/discovery`, leave the source
filter at **All approved sources** to run every connector, or choose one source
to run only that connector. Interactive discovery is disabled when
`NODE_ENV=production` because this MVP has no authentication.

## Tracked inputs and confidence

Every financial fact and due-diligence answer is one of:

- `reported`: present in the supplied property record;
- `estimated`: an explicit planning estimate with an optional note; or
- `missing`: no value, never silently replaced.

The completeness score weights reported inputs at 100%, estimates at 55%, and
missing inputs at 0%. Missing required financial inputs produce `NEEDS_DATA`
and no scenario calculation. Missing legal or physical due diligence remains
visible as an open checklist and warning rather than being treated as a
financial fact.

County profiles in `src/domain/profiles.ts` are configurable, dated,
provisional suggestions. They are not authoritative current market data, and
changing county does not silently overwrite listing assumptions. The seeded
example marks every profile-derived value as `estimated`.

## Underwriting formulas

All rates are decimal fractions (`0.13` means 13%). Money outputs are Kenyan
shillings. Intermediate calculations retain Decimal precision.

For unit types `i`:

```text
Gross potential rent (GPR)
  = sum(unit_count_i * monthly_rent_i * 12) * scenario_rent_factor

Effective gross income (EGI)
  = GPR * occupancy * (1 - collection_loss) + annual_other_income

Operating expenses
  = annual_fixed_costs * scenario_expense_factor
  + EGI * variable_expense_rate

NOI
  = EGI - operating_expenses
```

NOI excludes debt service, depreciation, appreciation, capital gains, and
investor income tax.

For principal `P`, monthly interest `r`, and `n` monthly payments:

```text
Monthly loan payment = P * r / (1 - (1 + r)^(-n))
Annual debt service  = monthly loan payment * 12
DSCR                 = NOI / annual debt service
Monthly cash flow    = (NOI - annual debt service) / 12
```

Zero-interest loans use `P / n`.

With variable expense ratio `v`, other income `O`, fixed expenses `F`, and
annual debt service `D`:

```text
Break-even occupancy
  = (D + F - O * (1 - v))
  / (GPR * (1 - collection_loss) * (1 - v))
```

Cash invested includes the down payment and all configured costs:

```text
Total cash invested
  = price - debt
  + price * acquisition_cost_rate
  + fixed_acquisition_costs
  + debt * financing_cost_rate
  + fixed_financing_costs
  + initial_reserves

Cash-on-cash return
  = annual_post_debt_cash_flow / total_cash_invested
```

### Maximum safely supported debt

Debt at a candidate price is the minimum of:

```text
LTV cap       = price * maximum_LTV
DSCR cap      = (base_NOI / minimum_DSCR) / annual_payment_per_KSh_debt
Stress cap    = (policy_stress_NOI - required_positive_cash_buffer)
                / annual_payment_per_KSh_debt
```

The result includes every cap and all tied binding constraints. The default
positive cash buffer is KSh 1 per month, making "positive" strict rather than
allowing exactly zero.

### Maximum allowable offer

The MAO uses maximum safely supported debt at each offer. It is solved in
closed form across the two debt regions:

1. debt is LTV-limited (`debt = LTV * price`);
2. debt is income/stress-limited (a fixed debt capacity).

For target cash-on-cash `t`, acquisition rate `q`, financing rate `f`, annual
payment per KSh of debt `a`, fixed cash costs `F`, base NOI `N`, and debt `L`:

```text
N - aL >= t * ((1 + q) * price - (1 - f) * L + F)
```

The engine solves that inequality in each region, selects the valid region,
and rounds the offer down to cents. This avoids a circular cap-rate shortcut
or a hand-tuned search. DSCR, policy-stress cash flow, LTV/down payment,
acquisition costs, financing costs, and reserves all participate. The result
reports the offer constraint (`MIN_CASH_ON_CASH`) and the separate binding debt
constraint.

## Policy and scenarios

Default policy:

- minimum DSCR: 1.30;
- strictly positive cash flow under the 85% occupancy policy stress;
- configurable cash-on-cash target constrained to 12%-15%;
- all configured acquisition, financing, and reserve costs included; and
- appreciation excluded from pass/fail.

Scenarios:

| Scenario                     |   Occupancy | Rent | Fixed costs | Collection loss |
| ---------------------------- | ----------: | ---: | ----------: | --------------: |
| Base                         |  configured | 100% |        100% |      configured |
| Conservative / policy stress | 85% default |  95% |        110% |            125% |
| Severe                       |         70% |  85% |        125% |            150% |

Collection loss is capped at 100%. The same selected debt is shown in all
three scenarios so the downside comparison is meaningful.

## Recommendations

- `BUY`: asking price is at or below MAO.
- `NEGOTIATE_TO_KSH_X_OR_BELOW`: a feasible MAO exists below asking.
- `REJECT`: no positive offer satisfies the configured return policy.
- `NEEDS_DATA`: one or more required financial facts is missing.

Each result includes reasons, warnings, missing financial fields, open
due-diligence fields, confidence, debt caps, MAO, scenario metrics, and a
formula audit trail.

## Scheduled deployment

Run `npm run job:discover` from the production platform's scheduler, a container
cron runner, or a managed job service (suggested cron `0 5 * * *`).
`createScheduledJobs` also exposes framework-neutral sample discovery and
portfolio re-analysis (`0 6 * * *`) boundaries. Production deployments should
run `npm run db:migrate` before starting the Next.js application.

Useful commands:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

## Known limitations

- County profile values are provisional examples, not live market data.
- The MVP does not authenticate users or isolate portfolios.
- Website layouts can change; parser failures are recorded per listing and
  require adapter maintenance.
- Some source index pages are client-rendered or intermittently unavailable, so
  a run can legitimately discover zero candidates without treating that as
  listing absence.
- Discovery currently covers the configured sale index pages only and does not
  paginate.
- The dashboard saves snapshots but does not yet expose a portfolio/history
  browser.
- Taxes specific to an investor, depreciation, appreciation, sale proceeds,
  refinancing, and IRR are intentionally outside the pass/fail model.
- The model assumes level monthly amortization and does not yet model
  interest-only periods, floating-rate resets, or staged capital works.
- A recommendation is screening support, not valuation, lending, legal,
  engineering, or investment advice.

## Roadmap

1. Add only permitted listing APIs after written terms/API review, storing the
   permission basis and raw source reference.
2. Add normalized-address and source-ID duplicate detection with human merge
   review.
3. Add saved searches and alerts for new listings, material price changes, and
   re-analysis failures.
4. Add rent-roll import and verification against leases, deposits, receipts,
   vacancy, and bank evidence.
5. Add evidence attachments and reviewer sign-off for Kenyan due diligence:
   title and encumbrances; planning/building approvals; county rates and land
   rent; utilities/service-charge arrears; leases/deposits; and independent
   structural, fire-safety, and condition review.
6. Add authenticated multi-user portfolios, scenario versioning, audit exports,
   and lender quote comparisons.
