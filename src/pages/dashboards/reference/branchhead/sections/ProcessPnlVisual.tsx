import { AlertOctagon, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { BranchProcess } from "../../../../../../backend/src/modules/branch-head-health/processes";
import type { ProcessPnlData, ProcessPnlRow } from "../../../../../../backend/src/modules/branch-head-health/types";
import { ChartFrame, DivergingBars, StatTile, divergingBarsTable, divergingDomain, type DivergingBarsProps, type TableSpec } from "../viz";
import { processTarget, type DrillTarget } from "../drill";
import { formatInr, formatPct } from "../format";
import { SectionShell } from "../ui";
import { branchProcesses, extendTable, Fold, Foot, TileItem, Tiles, type VisualProps } from "./shared";

const VISIBLE = 8;
const STATUS_WORD: Record<ProcessPnlRow["status"], string> = { "loss-making": "Loss-making", "at-risk": "At risk", profitable: "Profitable" };
const EXTRA_COLS = ["Client", "Status", "Revenue", "People cost", "Other cost", "OP %", "Seat fill", "Receivable"];

/**
 * Bar click: the row's own processId when this branch knows it, else a name join within the branch,
 * else the P&L row itself as a process (the drawer shows what the P&L knows). `rows` must already be
 * limited to the overview's branch.
 */
export function pnlSelect(row: Pick<ProcessPnlRow, "processId" | "processName">, rows: readonly BranchProcess[], onSelect: (t: DrillTarget) => void, branchId?: string) {
  const own = rows.find((r) => r.processId === row.processId);
  const named = own ? null : processTarget(row.processName, rows, "pnl", branchId);
  const hit = own ? { id: own.processId, name: own.processName }
    : named?.kind === "process" ? { id: named.id, name: named.name } : { id: row.processId, name: row.processName };
  onSelect(branchId ? { kind: "process", ...hit, branchId } : { kind: "process", ...hit });
}

const idle = (r: ProcessPnlRow) => r.revenue === 0 && r.peopleCost === 0 && r.otherCost === 0;

/** Active rows worst first, the diverging-bar props, the table twin (with a totals row) and the totals. */
export function buildPnl(d: ProcessPnlData) {
  const active = d.rows.filter((r) => !idle(r)).sort((a, b) => a.operatingProfit - b.operatingProfit);
  const idleRows = d.rows.filter(idle);
  const t = d.totals;
  const totals = {
    revenue: t.revenue,
    people: active.reduce((a, r) => a + r.peopleCost, 0),
    other: active.reduce((a, r) => a + r.otherCost, 0),
    operatingProfit: t.operatingProfit,
    opPct: t.opPct,
  };
  const bars: DivergingBarsProps = {
    label: "Operating profit by process, worst first",
    format: formatInr,
    positiveLabel: "Profit",
    negativeLabel: "Loss",
    items: active.map((r) => ({ id: r.processId, label: r.processName, value: r.operatingProfit })),
  };
  const base = extendTable(divergingBarsTable(bars, "Process P&L, worst operating profit first"), EXTRA_COLS, (i) => {
    const r = active[i];
    return [r.clientName, STATUS_WORD[r.status], formatInr(r.revenue), formatInr(r.peopleCost), formatInr(r.otherCost), formatPct(r.opPct), formatPct(r.seatFillPct), formatInr(r.outstandingReceivable)];
  });
  const table: TableSpec = {
    ...base,
    rows: [...base.rows, [`Total (${active.length} processes)`, formatInr(totals.operatingProfit), null, null, null,
      formatInr(totals.revenue), formatInr(totals.people), formatInr(totals.other), formatPct(totals.opPct), null, formatInr(t.outstandingReceivable)]],
  };
  // One scale for the drawn rows and the folded overflow, so bar lengths and zero match.
  return { active, idleRows, bars, table, totals, domain: divergingDomain(bars.items) };
}

function Chips({ t }: { t: ProcessPnlData["totals"] }) {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] font-semibold text-slate-900">
      <span className="inline-flex items-center gap-1 text-rose-900"><AlertOctagon className="h-4 w-4" aria-hidden="true" />{t.loss} loss-making</span>
      <span className="inline-flex items-center gap-1 text-amber-900"><AlertTriangle className="h-4 w-4" aria-hidden="true" />{t.atRisk} at risk</span>
      <span className="inline-flex items-center gap-1 text-emerald-900"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t.profitable} profitable</span>
    </p>
  );
}

export function ProcessPnlVisual({ overview, payload, onSelect }: VisualProps) {
  const scoped = branchProcesses(payload, overview.branch.branchId);
  const section = overview.processPnl;
  const period = section?.status === "ok" && section.data ? section.data.period : "";
  return (
    <SectionShell<ProcessPnlData> title={`Process P&L - P&L pages basis, ${period || "current month"}`} section={section}
      emptyText="No process P&L for this branch" errorName="Process P&L">
      {(d) => {
        const b = buildPnl(d);
        const select = (id: string) => {
          const row = b.active.find((r) => r.processId === id);
          if (row) pnlSelect(row, scoped, onSelect, overview.branch.branchId);
          else onSelect({ kind: "metric", id: "pnl" });
        };
        const first = { ...b.bars, domain: b.domain, items: b.bars.items.slice(0, VISIBLE) };
        const rest = { ...b.bars, domain: b.domain, items: b.bars.items.slice(VISIBLE), label: "Remaining processes, continuing the order above" };
        return (
          <div className="space-y-3">
            <Chips t={d.totals} />
            <Tiles label="Process P&L totals">
              <TileItem><StatTile label="Revenue" value={formatInr(b.totals.revenue)} /></TileItem>
              <TileItem><StatTile label="People cost" value={formatInr(b.totals.people)} hint={`Total cost ${formatInr(b.totals.people + b.totals.other)}`} /></TileItem>
              <TileItem><StatTile label="Other cost" value={formatInr(b.totals.other)} /></TileItem>
              <TileItem><StatTile label="Operating profit" value={formatInr(b.totals.operatingProfit)} hint={`OP % ${formatPct(b.totals.opPct)}`} /></TileItem>
            </Tiles>
            <ChartFrame title="Operating profit by process" subtitle={`${b.active.length} processes, worst first`} table={b.table} height={120}>
              <DivergingBars {...first} onSelect={select} />
              {rest.items.length > 0 ? (
                <div className="mt-3">
                  <Fold title={`Show all ${b.active.length} processes`}><DivergingBars {...rest} onSelect={select} /></Fold>
                </div>
              ) : null}
            </ChartFrame>
            {b.idleRows.length > 0 ? (
              <Fold title={`${b.idleRows.length} ${b.idleRows.length === 1 ? "process has" : "processes have"} no P&L activity this month`}>
                <ul className="list-disc pl-6 text-[13px] text-slate-900">{b.idleRows.map((r) => <li key={r.processId}>{r.processName}</li>)}</ul>
              </Fold>
            ) : null}
            <Foot>Uses the same calculation as the Process P&amp;L pages, so it can differ from the month-to-date running figures above.</Foot>
          </div>
        );
      }}
    </SectionShell>
  );
}
