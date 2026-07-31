import type { ScenarioResult } from "@/domain";

const kes = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

const percent = (value: string | null) =>
  value === null ? "N/A" : `${(Number(value) * 100).toFixed(1)}%`;

export function ScenarioCard({ scenario }: { scenario: ScenarioResult }) {
  return (
    <article className={`scenario-card scenario-${scenario.scenarioId}`}>
      <header>
        <div>
          <span className="eyebrow">Scenario</span>
          <h3>{scenario.label}</h3>
        </div>
        <strong>
          {kes.format(Number(scenario.monthlyPostDebtCashFlowKsh))}/mo
        </strong>
      </header>
      <dl className="metric-grid">
        <div>
          <dt>Gross potential rent</dt>
          <dd>{kes.format(Number(scenario.grossPotentialRentAnnualKsh))}</dd>
        </div>
        <div>
          <dt>Effective gross income</dt>
          <dd>{kes.format(Number(scenario.effectiveGrossIncomeAnnualKsh))}</dd>
        </div>
        <div>
          <dt>Operating expenses</dt>
          <dd>{kes.format(Number(scenario.operatingExpensesAnnualKsh))}</dd>
        </div>
        <div>
          <dt>NOI</dt>
          <dd>{kes.format(Number(scenario.noiAnnualKsh))}</dd>
        </div>
        <div>
          <dt>DSCR</dt>
          <dd>
            {scenario.dscr ? Number(scenario.dscr).toFixed(2) : "No debt"}
          </dd>
        </div>
        <div>
          <dt>Cash on cash</dt>
          <dd>{percent(scenario.cashOnCashReturn)}</dd>
        </div>
        <div>
          <dt>Break-even occupancy</dt>
          <dd>{percent(scenario.breakEvenOccupancy)}</dd>
        </div>
        <div>
          <dt>Total cash invested</dt>
          <dd>{kes.format(Number(scenario.totalCashInvestedKsh))}</dd>
        </div>
      </dl>
      <details>
        <summary>Formula audit trail</summary>
        <div className="audit-list">
          {scenario.audits.map((audit) => (
            <div key={audit.key}>
              <strong>{audit.key}</strong>
              <code>{audit.formula}</code>
              <span>{audit.result ?? "N/A"}</span>
            </div>
          ))}
        </div>
      </details>
    </article>
  );
}
