import { CircleDollarSign, Gauge, Landmark, Lock, PiggyBank } from "lucide-react";
import type { FinanceData, HeadRow } from "../panelTypes";
import type { TableSpec } from "../viz";
import { formatInr, formatPct } from "../format";
import { KPI_TONES, toneFor } from "../kpiModel";
import { AccentCard, BarCell, BarsChart, ChartCard, Chip, EmptyLine, GradientKpi, KpiCell, KpiGrid, NavyTable, PAL } from "../look";

/** Lakh figure for chart axes (₹ in lakh keeps tick labels short). */
export const lakh = (v: number) => (Math.abs(v) >= 100000 ? `${(v / 100000).toFixed(v % 100000 === 0 ? 0 : 1)}L` : `${Math.round(v / 1000)}k`);

/** Top heads first, then any over-budget head not already listed. */
export function budgetHeads(d: FinanceData): HeadRow[] {
  const seen = new Set<string>();
  return [...(d.byHead?.top ?? []), ...(d.byHead?.overBudget ?? [])].filter((h) => (seen.has(h.head) ? false : (seen.add(h.head), true)));
}

export function historyTable(d: FinanceData): TableSpec {
  return {
    caption: "Budget history by month",
    columns: ["Month", "Status", "Declared", "Used", "After closure", "Used %", "Heads closed"],
    rows: (d.history ?? []).map((m) => [m.periodCode, m.headerStatus ?? "—", formatInr(m.declared), formatInr(m.used), formatInr(m.afterClosure ?? m.effective),
      formatPct(m.usedPct), `${m.headsClosed} of ${m.headsTotal}`]),
  };
}

const usedColor = (pct: number) => (pct > 100 ? "#d03b3b" : PAL.s1);

/** Email section 1: budget vs consumption, heads, previous months and still-open sub-heads. */
export function FinanceBudget({ d }: { d: FinanceData }) {
  const b = d.budget;
  const tone = toneFor(b.utilizationPct, KPI_TONES.budgetPct);
  const heads = budgetHeads(d);
  const over = new Set((d.byHead?.overBudget ?? []).map((h) => h.head));
  const hist = d.history ?? [];
  return (
    <div className="space-y-4">
      {b.headerMissing ? <p role="note" className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-[13px] text-amber-950">No budget has been created for this month.</p> : null}
      <KpiGrid label="Budget vs consumption" cols={5}>
        <KpiCell><GradientKpi icon={Landmark} hue="navy" label="Total budget" value={formatInr(b.totalBudget)} sub={`Period ${b.periodCode ?? d.periodCode}${b.headerStatus ? ` · ${b.headerStatus}` : ""}`} /></KpiCell>
        <KpiCell><GradientKpi icon={CircleDollarSign} hue="emerald" label="Consumed" value={formatInr(b.consumed)} sub="Approved GRNs charged" /></KpiCell>
        <KpiCell><GradientKpi icon={Lock} hue="violet" label="Reserved" value={formatInr(b.reserved)} sub="Awaiting approval" /></KpiCell>
        <KpiCell><GradientKpi icon={PiggyBank} hue="cyan" label="Available" value={formatInr(b.available)} sub="Left to spend" /></KpiCell>
        <KpiCell><GradientKpi icon={Gauge} hue="orange" label="Utilization" value={formatPct(b.utilizationPct)} sub="Consumed + reserved"
          status={tone === "warning" ? "warning" : tone === "critical" ? "critical" : null} /></KpiCell>
      </KpiGrid>
      <div className="bhl-grid bhl-grid-2">
        <ChartCard title="Budget by head" chip={`${heads.length} heads · ${over.size} over`} accent="blue"
          table={{ caption: "Budget by head", columns: ["Head", "Budget", "Charged", "% used"], rows: heads.map((h) => [h.head, formatInr(h.budget), formatInr(h.charged), formatPct(h.pct)]) }}>
          {heads.length ? (
            <BarsChart label="Budget and charged by head" xKey="head" horizontal height={Math.max(180, heads.length * 38 + 50)} format={lakh}
              data={heads.map((h) => ({ head: h.head, budget: h.budget, charged: h.charged }))}
              series={[{ key: "budget", label: "Budget", color: PAL.s1 }, { key: "charged", label: "Charged", color: PAL.s2 }]} />
          ) : <EmptyLine text="No budget heads for this month" />}
        </ChartCard>
        <AccentCard title="Heads: % of budget used" chip={over.size ? `${over.size} over budget` : "none over budget"} accent="orange">
          <NavyTable caption="Top heads and over-budget heads with % of budget used" rows={heads} limit={8} empty="No budget heads"
            columns={[
              { key: "head", label: "Head", render: (h) => <span className="font-semibold">{h.head}</span> },
              { key: "budget", label: "Budget", num: true, render: (h) => formatInr(h.budget) },
              { key: "charged", label: "Charged", num: true, render: (h) => formatInr(h.charged) },
              { key: "pct", label: "% used", num: true, render: (h) => <BarCell pct={h.pct} text={formatPct(h.pct)} color={usedColor(h.pct)} /> },
              { key: "flag", label: "Status", render: (h) => (over.has(h.head) || h.pct > 100 ? <Chip tone="crit">Over budget</Chip> : <Chip tone="ok">Within</Chip>) },
            ]} />
        </AccentCard>
      </div>
      <div className="bhl-grid bhl-grid-2">
        <ChartCard title="Budget history and after closure" chip={`${hist.length} months`} accent="violet" table={historyTable(d)}>
          {hist.length ? (
            <BarsChart label="Declared, used and budget after closure by month, with % used" xKey="month" height={260} format={lakh} rightFormat={(v) => `${v}%`}
              data={hist.map((m) => ({ month: m.periodCode, declared: m.declared, used: m.used, after: m.afterClosure ?? m.effective, pct: m.usedPct }))}
              series={[{ key: "declared", label: "Declared", color: PAL.s1 }, { key: "used", label: "Used", color: PAL.s2 }, { key: "after", label: "After closure", color: PAL.s3 },
                { key: "pct", label: "% used", color: PAL.s4, kind: "line", axis: "right" }]} />
          ) : <EmptyLine text="No earlier budget months" />}
        </ChartCard>
        <AccentCard title="Still-open sub-heads (earlier months)" chip={`${(d.openSubheads ?? []).length} open`} accent="rose">
          <NavyTable caption="Sub-heads not yet closed in earlier months" rows={d.openSubheads ?? []} limit={8} empty="Every earlier sub-head is closed"
            columns={[
              { key: "m", label: "Month", render: (r) => r.periodCode },
              { key: "h", label: "Head", render: (r) => <span className="font-semibold">{r.head}</span> },
              { key: "s", label: "Sub-head", render: (r) => r.subhead || "—" },
              { key: "b", label: "Held", num: true, render: (r) => formatInr(r.budgetHeld) },
              { key: "u", label: "Spent", num: true, render: (r) => formatInr(r.spent) },
              { key: "l", label: "Unspent", num: true, render: (r) => formatInr(r.budgetHeld - r.spent) },
            ]} />
        </AccentCard>
      </div>
    </div>
  );
}
