import { useState } from "react";
import { Info, Users } from "lucide-react";
import type { BranchHeadHealthPayload, BranchOverview } from "../../../../../../backend/src/modules/branch-head-health/types";
import { BarList, ChartFrame, StackedBar, StatTile, barListTable, stackedBarTable, type BarListProps, type StackedBarProps } from "../viz";
import type { DrillTarget } from "../drill";
import type { HiringData } from "../panelTypes";
import { formatCount, formatInr, formatPct } from "../format";
import { CoverageBadge, ProcessAgents } from "../ProcessCoveragePanel";
import { mandateNote } from "../sections/PeopleVisual";
import { buildHiring } from "../sections/HiringVisual";
import { OPS_METRICS, num } from "../sections/OpsHeatGrid";
import { nn, TileItem, Tiles } from "../sections/shared";
import { findProcess, okData, processDetail, type ProcessDetail } from "./processDetail";
import { Block, DrillLinks, EmptyLine } from "./parts";

type ProcessTarget = Extract<DrillTarget, { kind: "process" }>;

export interface ProcessDrawerProps {
  payload: BranchHeadHealthPayload;
  /** The branch overview the process was opened from (null when the branch is not in the payload). */
  overview: BranchOverview | null;
  target: ProcessTarget;
  branchNames: Record<string, string>;
}

/** This process's shift slots: present, absent and not marked per slot. */
export function slotBars(d: ProcessDetail): StackedBarProps {
  return {
    label: "Attendance by shift slot: present, absent and not marked",
    series: [{ key: "present", label: "Present" }, { key: "absent", label: "Absent" }, { key: "open", label: "Not marked" }],
    rows: d.slots.map((s, i) => ({
      id: `slot-${i}`, label: s.shift || "Shift",
      segments: [{ key: "present", value: nn(s.present) }, { key: "absent", value: nn(s.absent) }, { key: "open", value: Math.max(0, nn(s.planned) - nn(s.present) - nn(s.absent)) }],
    })),
  };
}

/** Revenue against the two cost lines for this process this month. */
export function pnlBars(d: ProcessDetail): BarListProps | null {
  const r = d.pnl;
  if (!r || (r.revenue === 0 && r.peopleCost === 0 && r.otherCost === 0)) return null;
  return {
    label: "P&L this month: revenue, people cost and other cost",
    format: formatInr,
    items: [
      { id: "revenue", label: "Revenue", value: r.revenue },
      { id: "people", label: "People cost", value: r.peopleCost },
      { id: "other", label: "Other cost", value: r.otherCost, note: `Operating profit ${formatInr(r.operatingProfit)}` },
    ],
  };
}

function Header({ p }: { p: NonNullable<ReturnType<typeof findProcess>> }) {
  const cc = p.costCentres?.length ?? 0;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate-800">
      <CoverageBadge tier={p.tier} />
      <span>{cc === 1 ? "1 cost centre" : `${formatCount(cc)} cost centres`}</span>
      {p.billingMirror ? (
        <span className="inline-flex items-center gap-1 text-slate-700"><Info className="h-3.5 w-3.5" aria-hidden="true" />Billing mirror: an idle process that only mirrors a cost centre for billing</span>
      ) : null}
    </div>
  );
}

function KeyTiles({ p, d }: { p: NonNullable<ReturnType<typeof findProcess>>; d: ProcessDetail }) {
  const seats = p.mandatedSeats;
  const mandated = seats != null && seats > 0;
  const over = mandated && p.headcount > (seats as number);
  return (
    <Tiles label="Process numbers">
      <TileItem><StatTile label="Headcount vs seats" value={mandated ? `${formatCount(p.headcount)} / ${formatCount(seats)}` : formatCount(p.headcount)}
        hint={mandateNote(nn(p.headcount), seats)} tone={over ? "warning" : undefined} /></TileItem>
      <TileItem><StatTile label="Revenue" value={formatInr(d.pnl?.revenue)} hint={d.pnl ? undefined : "No P&L row"} /></TileItem>
      <TileItem><StatTile label="Operating profit" value={formatInr(d.pnl?.operatingProfit)} hint={d.pnl ? `OP % ${formatPct(d.pnl.opPct)}` : undefined} /></TileItem>
      <TileItem><StatTile label="Shrinkage today" value={formatPct(d.shrinkage?.pct)}
        hint={d.shrinkage ? `${formatCount(d.shrinkage.absent)} absent of ${formatCount(d.shrinkage.planned)} planned` : "Nothing rostered"} /></TileItem>
      <TileItem><StatTile label="Attrition high risk" value={formatCount(d.attrition?.highRisk)} hint={d.attrition ? `Absent streak ${formatCount(d.attrition.absentStreak)}` : undefined} /></TileItem>
      <TileItem><StatTile label="QA %" value={formatPct(d.quality)} /></TileItem>
    </Tiles>
  );
}

function Agents(props: { p: NonNullable<ReturnType<typeof findProcess>>; branchId: string; branchNames: Record<string, string> }) {
  const [show, setShow] = useState(false);
  return (
    <Block title="Agents">
      <button type="button" aria-expanded={show} onClick={() => setShow((v) => !v)}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-[13px] font-semibold text-slate-900 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
        <Users className="h-4 w-4" aria-hidden="true" />{show ? "Hide agent list" : "Show agent list"}
      </button>
      {show ? <ProcessAgents p={props.p} selectedBranchId={props.branchId} branchNames={props.branchNames} /> : null}
    </Block>
  );
}

/** Process 360: header, key tiles, mini charts, ops row, the agent list (only place names appear) and links. */
export function ProcessDrawer({ payload, overview, target, branchNames }: ProcessDrawerProps) {
  const branchId = target.branchId ?? overview?.branch.branchId ?? "";
  const p = findProcess(payload, target, branchId);
  if (!p) {
    return (
      <div className="space-y-4">
        <EmptyLine>No detail available for this process in the loaded data.</EmptyLine>
        <DrillLinks target={target} />
      </div>
    );
  }
  const d = processDetail(overview, p);
  const slots = slotBars(d);
  const money = pnlBars(d);
  const hiring = okData<HiringData>(overview?.hiring);
  const batches = hiring && d.batches.length ? buildHiring({ ...hiring, batches: d.batches }) : null;
  const opsTiles = d.ops ? OPS_METRICS.filter(([k]) => typeof d.ops?.metrics?.[k] === "number") : [];
  return (
    <div className="space-y-5">
      <Header p={p} />
      <KeyTiles p={p} d={d} />
      <ChartFrame title="Attendance by shift slot" subtitle="Today" table={stackedBarTable(slots)} height={72}>
        {slots.rows.length ? <StackedBar {...slots} /> : <EmptyLine>No attendance rostered today</EmptyLine>}
      </ChartFrame>
      {money ? (
        <ChartFrame title="P&L this month" subtitle={`OP % ${formatPct(d.pnl?.opPct)}`} table={barListTable(money)} height={96}><BarList {...money} /></ChartFrame>
      ) : <Block title="P&L this month"><EmptyLine>No P&amp;L activity this month</EmptyLine></Block>}
      {batches ? (
        <ChartFrame title="Open hiring batches" subtitle="Open positions; marker = in pipeline" table={batches.batchesTable} height={72}><BarList {...batches.batches} /></ChartFrame>
      ) : <Block title="Open hiring batches"><EmptyLine>No open hiring batches for this process</EmptyLine></Block>}
      <Block title="Operations metrics">
        {opsTiles.length ? (
          <>
            <Tiles label="Operations metrics">
              {opsTiles.map(([k, l]) => <TileItem key={k}><StatTile label={l} value={num(d.ops?.metrics?.[k])} /></TileItem>)}
            </Tiles>
            <p className="text-[12px] text-slate-700">Latest {d.ops?.latestDate ?? "—"}{d.ops?.stale ? " · Stale" : ""}</p>
          </>
        ) : <EmptyLine>No operational metrics for this process</EmptyLine>}
      </Block>
      <Agents p={p} branchId={branchId} branchNames={branchNames} />
      <DrillLinks target={target} />
    </div>
  );
}
