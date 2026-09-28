import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { Info } from "lucide-react";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { usePnlInsights, type InsightCell, type InsightContribution, type InsightUnit } from "@/hooks/usePnlInsights";
import { inrCompact } from "./PnlTrendExplorer";
import { CostCentreName, costCentreText } from "./costCentreLabel";
import { pnlLabel } from "./pnlLabels";

/**
 * P&L Insights — four answers the Live P&L table holds but cannot show at a glance.
 *
 *   Revenue confidence   how much of the month is invoiced, accrued, or still an estimate
 *   Profit contribution  which cost centres make the operating profit and which give it back
 *   Unit economics       revenue per head against full cost per head, with the break-even line
 *   Margin heatmap       every cost centre's OP% month by month — where a leak started
 *
 * Every figure is a Live P&L row (backend pnl-insights.service.ts), so it equals the Live P&L tab.
 * Colour carries one meaning throughout: blue = profit, red = loss, grey = cannot be measured,
 * amber = revenue with no salary booked (an attribution gap, so its margin is not scored).
 * A diverging scale centred on zero, never a rainbow, and every coloured cell also prints its value.
 */

const ROOT_VARS = `
[data-pnl-insights] { --ins-pos:#2a78d6; --ins-neg:#e34948; --ins-accrual:#8fb8ea; --ins-muted:#94a3b8; --ins-warn:#d9941e; }
.dark [data-pnl-insights] { --ins-pos:#3987e5; --ins-neg:#e66767; --ins-accrual:#3d5f8a; --ins-muted:#64748b; --ins-warn:#e0a33a; }`;

const CHART_CONFIG = {
  op: { label: pnlLabel("OPERATING_PROFIT_CONTRIBUTION"), color: "var(--ins-pos)" },
  revenuePerHead: { label: "Revenue per head", color: "var(--ins-pos)" },
} satisfies ChartConfig;

const pctLabel = (v: number | null | undefined) => (v == null ? "NA" : `${v.toFixed(1)}%`);
const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Diverging fill for an OP%: saturates at ±30%, so a 5% and a 25% margin are visibly different. */
function heatStyle(cell: Pick<InsightCell, "opPct" | "noPayroll">): { background: string; color: string; boxShadow?: string } {
  if (cell.noPayroll) return { background: "transparent", color: "var(--ins-warn)", boxShadow: "inset 0 0 0 1.5px var(--ins-warn)" };
  if (cell.opPct == null) return { background: "transparent", color: "var(--ins-muted)" };
  const strength = Math.min(Math.abs(cell.opPct) / 30, 1);
  const alpha = 0.1 + strength * 0.75;
  const rgb = cell.opPct >= 0 ? "42,120,214" : "227,73,72";
  return { background: `rgba(${rgb},${alpha.toFixed(2)})`, color: alpha > 0.55 ? "#fff" : "inherit" };
}

function Section({ title, subtitle, children, action }: { title: string; subtitle: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{text}</p>;
}

// ── Revenue confidence ──────────────────────────────────────────────────────────────────────────

function MixBar({ invoiced, accrual, estimated, total }: { invoiced: number; accrual: number; estimated: number; total: number }) {
  const base = Math.max(invoiced + accrual + estimated, 1);
  const seg = (v: number) => `${Math.max(0, (v / base) * 100)}%`;
  return (
    <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-muted" role="img"
      aria-label={`Invoiced ${inrCompact(invoiced)}, accrual ${inrCompact(accrual)}, estimate ${inrCompact(estimated)} of ${inrCompact(total)}`}>
      <div style={{ width: seg(invoiced), background: "var(--ins-pos)" }} />
      <div style={{ width: seg(accrual), background: "var(--ins-accrual)" }} />
      <div style={{ width: seg(estimated), backgroundImage: "repeating-linear-gradient(135deg, var(--ins-pos) 0 3px, transparent 3px 7px)", boxShadow: "inset 0 0 0 1px var(--ins-pos)" }} />
    </div>
  );
}

function RevenueConfidence({ mix, contribution }: { mix: NonNullable<ReturnType<typeof usePnlInsights>["data"]>["revenueMix"]; contribution: InsightContribution[] }) {
  const pending = contribution.filter((c) => c.revenueEstimated > 0).sort((a, b) => b.revenueEstimated - a.revenueEstimated);
  const t = mix.totals;
  const gross = t.invoiced + t.accrual + t.estimated;
  const realPct = gross > 0 ? ((t.invoiced + t.accrual) / gross) * 100 : null;
  return (
    <Section
      title="Revenue confidence"
      subtitle="How much of this month's revenue is invoiced, accrued, or still a seat-rate estimate."
      action={realPct != null ? (
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground">{realPct.toFixed(0)}% billed or accrued</span>
      ) : undefined}
    >
      {mix.branches.length === 0 ? <Empty text="No revenue recorded for this month." /> : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--ins-pos)" }} />Invoiced {inrCompact(t.invoiced)}</span>
            {t.accrual >= 1000 && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--ins-accrual)" }} />Accrual {inrCompact(t.accrual)}</span>}
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundImage: "repeating-linear-gradient(135deg, var(--ins-pos) 0 2px, transparent 2px 4px)", boxShadow: "inset 0 0 0 1px var(--ins-pos)" }} />Seat-rate estimate {inrCompact(t.estimated)}</span>
            {t.creditNote > 0 && <span>Credit notes −{inrCompact(t.creditNote)}</span>}
          </div>
          <div className="grid grid-cols-[minmax(90px,160px)_1fr_auto] items-center gap-x-3 gap-y-2 text-xs">
            <span className="font-semibold text-foreground">Company</span>
            <MixBar invoiced={t.invoiced} accrual={t.accrual} estimated={t.estimated} total={t.revenue} />
            <span className="text-right font-semibold tabular-nums text-foreground">{inrCompact(t.revenue)}</span>
            {mix.branches.map((b) => (
              <div key={b.branchId ?? b.branchName} className="contents">
                <span className="truncate text-muted-foreground" title={b.branchName}>{b.branchName}</span>
                <MixBar invoiced={b.invoiced} accrual={b.accrual} estimated={b.estimated} total={b.revenue} />
                <span className="text-right tabular-nums text-foreground">{inrCompact(b.revenue)}</span>
              </div>
            ))}
          </div>
          {pending.length > 0 && (
            <div className="border-t border-border pt-3">
              <p className="mb-1.5 text-xs font-semibold text-foreground">Not invoiced yet — {pending.length} cost centre{pending.length === 1 ? "" : "s"} carried at seat rate</p>
              <ul className="space-y-1.5">
                {pending.map((c) => (
                  <li key={c.costCentreId} className="flex items-center justify-between gap-3 text-xs">
                    <CostCentreName code={c.code} processName={c.processName} sub={c.branchName} className="flex-1" />
                    <span className="shrink-0 tabular-nums text-foreground">{inrCompact(c.revenueEstimated)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

// ── Profit contribution ─────────────────────────────────────────────────────────────────────────

function ContributionTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: InsightContribution }> }) {
  if (!active || !payload?.length) return null;
  const c = payload[0].payload;
  return (
    <div className="max-w-[260px] rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-foreground">{c.code}</p>
      <p className="text-muted-foreground">{[c.processName, c.branchName].filter(Boolean).join(" · ")}</p>
      {c.kind === "no_payroll" && <p className="mt-1 text-amber-700 dark:text-amber-400">No salary booked here — its staff are paid under another cost centre, so this profit is overstated.</p>}
      {c.kind === "no_revenue" && <p className="mt-1 text-muted-foreground">No revenue this month — an overhead, or a client process not billed or estimated yet.</p>}
      <div className="mt-1.5 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
        <span className="text-muted-foreground">{pnlLabel("RECOGNISED_REVENUE")}{c.estimated ? " (est.)" : ""}</span><span className="text-right">{inrCompact(c.revenue)}</span>
        <span className="text-muted-foreground">{pnlLabel("PEOPLE_COST")}</span><span className="text-right">{inrCompact(c.payroll)}</span>
        <span className="text-muted-foreground">{pnlLabel("INDIRECT_COST")}</span><span className="text-right">{inrCompact(c.idc)}</span>
        <span className="font-semibold">{pnlLabel("OPERATING_PROFIT_CONTRIBUTION")}</span><span className={`text-right font-semibold ${c.op < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>{inrCompact(c.op)}</span>
        <span className="text-muted-foreground">{pnlLabel("OPERATING_MARGIN")}</span><span className="text-right">{pctLabel(c.opPct)}</span>
      </div>
    </div>
  );
}

function ProfitContribution({ rows, salaryMissing }: { rows: InsightContribution[]; salaryMissing: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const makers = rows.filter((r) => r.op > 0);
  const losers = rows.filter((r) => r.op < 0);
  // The header counts only real trading losses; overheads and unbooked salary are their own lines.
  const trueLosers = losers.filter((r) => r.kind === "trading");
  const overheads = rows.filter((r) => r.kind === "no_revenue");
  const unpaid = rows.filter((r) => r.kind === "no_payroll");
  const sumOp = (list: InsightContribution[]) => list.reduce((t, r) => t + r.op, 0);
  const shown = showAll ? rows : [...makers.slice(0, 8), ...losers.slice(-8)];
  const hidden = rows.length - shown.length;
  const totalMade = makers.reduce((t, r) => t + r.op, 0);
  const totalLost = losers.reduce((t, r) => t + r.op, 0);
  const height = Math.max(160, shown.length * 30 + 40);
  const fillOf = (r: InsightContribution) =>
    r.kind === "no_revenue" ? "var(--ins-muted)" : r.kind === "no_payroll" ? "var(--ins-warn)" : r.op >= 0 ? "var(--ins-pos)" : "var(--ins-neg)";
  const chartRows = shown.map((r) => ({ ...r, label: costCentreText(r.code, r.processName) }));
  // Round axis steps (1/2/5 x 10^k) with room on the loss side for the value labels.
  const axis = useMemo(() => {
    const lo = Math.min(0, ...chartRows.map((r) => r.op)) * 1.35;
    const hi = Math.max(0, ...chartRows.map((r) => r.op)) * 1.15;
    const raw = Math.max((hi - lo) / 5, 1);
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((v) => v >= raw) ?? 10 * mag;
    const start = Math.floor(lo / step) * step, end = Math.ceil(hi / step) * step;
    const ticks: number[] = [];
    for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v));
    return { domain: [start, end] as [number, number], ticks };
  }, [chartRows]);
  return (
    <Section
      title="Profit contribution"
      subtitle={salaryMissing
        ? `Payroll for this month has not run — these bars are ${pnlLabel("RECOGNISED_REVENUE")} less ${pnlLabel("INDIRECT_COST")} only, not ${pnlLabel("OPERATING_PROFIT_CONTRIBUTION")}.`
        : `${pnlLabel("OPERATING_PROFIT_CONTRIBUTION")} by cost centre. Top earners above, the ones giving profit back below.`}
      action={rows.length > 16 ? (
        <Button size="sm" variant="outline" onClick={() => setShowAll((v) => !v)}>{showAll ? "Top & bottom 8" : `Show all ${rows.length}`}</Button>
      ) : undefined}
    >
      {rows.length === 0 ? <Empty text="No cost centre activity for this month." /> : (
        <>
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className="text-muted-foreground">{makers.filter((r) => r.kind === "trading").length} earning <b className="text-foreground tabular-nums">{inrCompact(sumOp(makers.filter((r) => r.kind === "trading")))}</b></span>
            <span className="text-muted-foreground">{trueLosers.length} losing <b className="tabular-nums text-rose-600 dark:text-rose-400">{inrCompact(sumOp(trueLosers))}</b></span>
            {overheads.length > 0 && <span className="text-muted-foreground">{overheads.length} with no revenue <b className="tabular-nums text-foreground">{inrCompact(sumOp(overheads))}</b></span>}
            {unpaid.length > 0 && <span className="text-muted-foreground">{unpaid.length} with no salary booked <b className="tabular-nums text-amber-700 dark:text-amber-400">{inrCompact(sumOp(unpaid))}</b></span>}
            <span className="text-muted-foreground">company OP <b className="tabular-nums text-foreground">{inrCompact(sumOp(rows))}</b></span>
            {hidden > 0 && <span className="text-muted-foreground">{hidden} in the middle not shown</span>}
          </div>
          <div className="overflow-x-auto">
            <ChartContainer config={CHART_CONFIG} className="aspect-auto min-w-[520px] w-full" style={{ height }}>
              <BarChart data={chartRows} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 8 }} barCategoryGap={5}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis type="number" tickFormatter={(v: number) => inrCompact(v)} tick={{ fontSize: 11 }}
                  domain={axis.domain} ticks={axis.ticks} />
                <YAxis type="category" dataKey="label" width={290} interval={0} tick={{ fontSize: 11 }} tickFormatter={(v: string) => truncate(v, 44)} />
                <ReferenceLine x={0} stroke="var(--ins-muted)" />
                <Tooltip content={<ContributionTooltip />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }} />
                <Bar dataKey="op" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {chartRows.map((r) => (
                    <Cell key={r.costCentreId} fill={fillOf(r)} fillOpacity={r.estimated ? 0.55 : 1} />
                  ))}
                  <LabelList
                    dataKey="op"
                    content={(props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: number | string }) => {
                      const x = Number(props.x ?? 0), y = Number(props.y ?? 0), w = Number(props.width ?? 0), h = Number(props.height ?? 0), v = Number(props.value ?? 0);
                      const end = x + w; // w is negative for a loss, so the bar ends left of x
                      return (
                        <text x={v >= 0 ? end + 6 : end - 6} y={y + h / 2} dy="0.35em" textAnchor={v >= 0 ? "start" : "end"} fontSize={11} className="fill-foreground tabular-nums">
                          {inrCompact(v)}
                        </text>
                      );
                    }}
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--ins-pos)" }} />Profit</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--ins-neg)" }} />Loss</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--ins-warn)" }} />No salary booked — profit overstated</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--ins-muted)" }} />No revenue this month (overhead, or not billed yet)</span>
            <span>Lighter bars include a seat-rate estimate.</span>
          </div>
        </>
      )}
    </Section>
  );
}

// ── Unit economics ──────────────────────────────────────────────────────────────────────────────

function UnitTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: InsightUnit }> }) {
  if (!active || !payload?.length) return null;
  const u = payload[0].payload;
  const gap = u.revenuePerHead - u.costPerHead;
  return (
    <div className="max-w-[260px] rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-foreground">{u.code}</p>
      <p className="text-muted-foreground">{[u.processName, u.branchName].filter(Boolean).join(" · ")}</p>
      <div className="mt-1.5 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
        <span className="text-muted-foreground">{pnlLabel("PAID_STAFF")}</span><span className="text-right">{u.staff.toLocaleString("en-IN")}</span>
        <span className="text-muted-foreground">Revenue / head</span><span className="text-right">{inrCompact(u.revenuePerHead)}</span>
        <span className="text-muted-foreground">Cost / head</span><span className="text-right">{inrCompact(u.costPerHead)}</span>
        <span className="font-semibold">{gap >= 0 ? "Earns" : "Loses"} / head</span><span className={`text-right font-semibold ${gap < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>{inrCompact(Math.abs(gap))}</span>
        <span className="text-muted-foreground">{pnlLabel("RECOGNISED_REVENUE")}</span><span className="text-right">{inrCompact(u.revenue)}</span>
        <span className="text-muted-foreground">{pnlLabel("OPERATING_MARGIN")}</span><span className="text-right">{pctLabel(u.opPct)}</span>
      </div>
    </div>
  );
}

function UnitEconomics({ rows, salaryMissing }: { rows: InsightUnit[]; salaryMissing: boolean }) {
  const { above, below, max } = useMemo(() => {
    const top = rows.reduce((m, r) => Math.max(m, r.revenuePerHead, r.costPerHead), 0);
    return {
      above: rows.filter((r) => r.revenuePerHead >= r.costPerHead),
      below: rows.filter((r) => r.revenuePerHead < r.costPerHead),
      max: Math.ceil((top * 1.08) / 5000) * 5000,
    };
  }, [rows]);
  return (
    <Section
      title="Unit economics"
      subtitle="Revenue per head against full cost per head (salary + IDC). Above the dashed line a cost centre earns; below it, each seat costs more than it bills. Bubble size is revenue."
    >
      {rows.length === 0 ? (
        <Empty text={salaryMissing ? "Payroll for this month has not run yet, so there is no cost per head to compare." : "No cost centre both billed and paid staff this month."} />
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--ins-pos)" }} />{above.length} earning</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--ins-neg)" }} />{below.length} below break-even</span>
          </div>
          <ChartContainer config={CHART_CONFIG} className="aspect-auto h-[340px] w-full">
            <ScatterChart margin={{ top: 8, right: 16, bottom: 20, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" dataKey="costPerHead" name="Cost per head" domain={[0, max]} tickFormatter={(v: number) => inrCompact(v)} tick={{ fontSize: 11 }}
                label={{ value: "Cost per head →", position: "insideBottom", offset: -12, fontSize: 11 }} />
              <YAxis type="number" dataKey="revenuePerHead" name="Revenue per head" domain={[0, max]} tickFormatter={(v: number) => inrCompact(v)} tick={{ fontSize: 11 }} width={72} />
              <ZAxis type="number" dataKey="revenue" range={[50, 700]} />
              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: max, y: max }]} stroke="var(--ins-muted)" strokeDasharray="6 4" ifOverflow="hidden"
                label={{ value: "break-even", position: "insideTopRight", fontSize: 11, fill: "var(--ins-muted)" }} />
              <Tooltip content={<UnitTooltip />} cursor={{ strokeDasharray: "3 3" }} />
              <Scatter data={above} fill="var(--ins-pos)" fillOpacity={0.7} stroke="var(--ins-pos)" isAnimationActive={false} />
              <Scatter data={below} fill="var(--ins-neg)" fillOpacity={0.7} stroke="var(--ins-neg)" isAnimationActive={false} />
            </ScatterChart>
          </ChartContainer>
        </>
      )}
    </Section>
  );
}

// ── Margin heatmap ──────────────────────────────────────────────────────────────────────────────

function MarginHeatmap({ data }: { data: NonNullable<ReturnType<typeof usePnlInsights>["data"]> }) {
  const { months, heatmap } = data;
  return (
    <Section
      title="Margin heatmap"
      subtitle={`OP% for each cost centre, month by month — ${heatmap.length} largest by revenue. Blue is profit, red is loss, deeper means further from zero.`}
    >
      {heatmap.length === 0 ? <Empty text="No cost centre activity in this window." /> : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span>−30%</span>
            <span className="h-2.5 w-40 rounded-full" style={{ background: "linear-gradient(90deg, rgba(227,73,72,.85), rgba(227,73,72,.1) 49%, rgba(42,120,214,.1) 51%, rgba(42,120,214,.85))" }} />
            <span>+30%</span>
            <span className="ml-3">NA = no revenue, or payroll not run</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded-sm" style={{ boxShadow: "inset 0 0 0 1.5px var(--ins-warn)" }} />no pay = revenue with no salary booked, margin not scored</span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-muted/60 text-muted-foreground">
                  <th scope="col" className="sticky left-0 z-10 min-w-[190px] bg-muted px-3 py-2 text-left font-semibold">Cost centre</th>
                  {months.map((m) => (
                    <th key={m.period} scope="col" className="min-w-[68px] px-1 py-2 text-center font-semibold">
                      {m.label}{(m.salaryMissing || m.idcMissing) && <span className="block text-[10px] font-normal">{m.salaryMissing ? "no payroll" : "no IDC"}</span>}
                    </th>
                  ))}
                  <th scope="col" className="min-w-[80px] px-2 py-2 text-center font-semibold">Window</th>
                </tr>
              </thead>
              <tbody>
                {heatmap.map((row) => (
                  <tr key={row.costCentreId} className="border-t border-border">
                    <th scope="row" className="sticky left-0 z-10 max-w-[260px] bg-card px-3 py-1.5 text-left font-normal">
                      <CostCentreName code={row.code} processName={row.processName} sub={row.branchName} />
                    </th>
                    {row.cells.map((c) => {
                      const style = heatStyle(c);
                      return (
                        <td key={c.period} className="p-0.5">
                          <div
                            className="flex h-9 flex-col items-center justify-center rounded-md tabular-nums"
                            style={style}
                            title={`${costCentreText(row.code, row.processName)} · ${c.period}\nRevenue ${inrCompact(c.revenue)} · Cost ${inrCompact(c.cost)} · OP ${inrCompact(c.op)} · ${c.noPayroll ? "no salary booked, margin not shown" : pctLabel(c.opPct)}${c.estimated ? " · includes seat-rate estimate" : ""}`}
                          >
                            <span className="font-semibold">{c.noPayroll ? "no pay" : c.opPct == null ? (c.revenue || c.cost ? "NA" : "·") : `${c.opPct.toFixed(0)}%`}</span>
                            {c.estimated && <span className="text-[9px] leading-none opacity-80">est</span>}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-2 text-center">
                      <span className="font-semibold tabular-nums" style={{ color: row.windowOpPct == null ? "var(--ins-muted)" : row.windowOpPct < 0 ? "var(--ins-neg)" : "var(--ins-pos)" }}>
                        {pctLabel(row.windowOpPct)}
                      </span>
                      {row.windowOpPct != null && <span className="block text-[10px] text-muted-foreground tabular-nums">{inrCompact(row.windowOp)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}

// ── Panel ───────────────────────────────────────────────────────────────────────────────────────

export function PnlInsightsPanel({ period, branchId }: { period: string; branchId?: string }) {
  const [months, setMonths] = useState(6);
  const query = usePnlInsights(period, months, branchId);
  const data = query.data;

  return (
    <div data-pnl-insights className="flex flex-col gap-4">
      <style>{ROOT_VARS}</style>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">P&amp;L Insights{data ? ` · ${data.months[data.months.length - 1]?.label}` : ""}</h2>
          <p className="text-xs text-muted-foreground">Read from the Live P&amp;L, so every figure matches that tab.</p>
        </div>
        <div role="radiogroup" aria-label="Heatmap window" className="inline-flex rounded-xl border border-border bg-muted/60 p-0.5">
          {[6, 12].map((m) => (
            <button key={m} type="button" role="radio" aria-checked={months === m} onClick={() => setMonths(m)}
              className={`min-h-9 rounded-lg px-3 text-xs font-semibold transition-colors duration-200 ${months === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {m} months
            </button>
          ))}
        </div>
      </div>

      {query.isLoading ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}
        </div>
      ) : query.isError || !data ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-6 text-center text-sm text-rose-600 dark:border-rose-900 dark:bg-rose-950/40">
          Could not load P&amp;L insights for {period}.{" "}
          <button type="button" className="underline" onClick={() => void query.refetch()}>Retry</button>
        </p>
      ) : (
        <div className={`flex flex-col gap-4 transition-opacity ${query.isFetching ? "opacity-60" : ""}`}>
          {data.notes.length > 0 && (
            <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="space-y-0.5">{data.notes.map((n) => <p key={n}>{n}</p>)}</div>
            </div>
          )}
          <div className="grid gap-4 xl:grid-cols-2">
            <RevenueConfidence mix={data.revenueMix} contribution={data.contribution} />
            <UnitEconomics rows={data.unitEconomics} salaryMissing={data.salaryMissing} />
          </div>
          <ProfitContribution rows={data.contribution} salaryMissing={data.salaryMissing} />
          <MarginHeatmap data={data} />
        </div>
      )}
    </div>
  );
}
