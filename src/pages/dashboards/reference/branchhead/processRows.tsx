import { ChevronDown, ExternalLink } from "lucide-react";
import type { BranchProcess, CoverageTier } from "../../../../../backend/src/modules/branch-head-health/processes";
import { formatCount } from "./format";
import { BarCell, Chip, NavyTable, PAL, type ChipTone } from "./look";
import { CoverageBadge } from "./processAgents";

/** Mirrors the backend rule (ops.ts STALE_AFTER_DAYS): no metric for more than 14 days is stale. */
export const STALE_DAYS = 14;
const dayNum = (s: string) => Math.floor(Date.parse(`${s.slice(0, 10)}T00:00:00Z`) / 86_400_000);

export type Freshness = "current" | "stale" | "none";
export function freshness(latest: string | null, asOf?: string): Freshness {
  if (!latest) return "none";
  if (!asOf || !Number.isFinite(dayNum(asOf)) || !Number.isFinite(dayNum(latest))) return "current";
  return dayNum(asOf) - dayNum(latest) > STALE_DAYS ? "stale" : "current";
}

/** Zero (or no) mandated seats means not mandated, so headcount cannot be "over" it. */
export function seatGap(p: Pick<BranchProcess, "headcount" | "mandatedSeats">): { mandated: boolean; over: number; open: number } {
  const seats = p.mandatedSeats ?? 0;
  if (!(seats > 0)) return { mandated: false, over: 0, open: 0 };
  return { mandated: true, over: Math.max(0, p.headcount - seats), open: Math.max(0, seats - p.headcount) };
}

const TIER_SEVERITY: Record<CoverageTier, number> = { not_wired: 3, baseline: 2, outbound_sale: 1, inbound_quality: 1, full: 0 };

/** Worst first: over mandate, then weak coverage, then stale or missing data; ties by name. */
export function processSeverity(p: BranchProcess, asOf?: string): number {
  const g = seatGap(p);
  const f = freshness(p.latestMetricDate, asOf);
  return (g.over > 0 ? 4 : 0) + (TIER_SEVERITY[p.tier] ?? 3) + (f === "stale" ? 2 : f === "none" ? 1 : 0);
}
export function sortWorstFirst(rows: BranchProcess[], asOf?: string): BranchProcess[] {
  return [...rows].sort((a, b) => processSeverity(b, asOf) - processSeverity(a, asOf) || a.processName.localeCompare(b.processName));
}

function SeatsCell({ p }: { p: BranchProcess }) {
  const g = seatGap(p);
  if (!g.mandated) return <span className="text-[12px] text-slate-700">{`${formatCount(p.headcount)} headcount - no mandated seats`}</span>;
  const seats = p.mandatedSeats as number;
  return <BarCell pct={(p.headcount / seats) * 100} text={`${formatCount(p.headcount)} of ${formatCount(seats)} seats`} color={g.over > 0 ? "#d03b3b" : PAL.s1} />;
}

function MandateChip({ p }: { p: BranchProcess }) {
  const g = seatGap(p);
  if (!g.mandated) return <Chip tone="mute">No mandate</Chip>;
  if (g.over > 0) return <Chip tone="crit">{`Over mandate +${formatCount(g.over)}`}</Chip>;
  if (g.open > 0) return <Chip tone="info">{`${formatCount(g.open)} open`}</Chip>;
  return <Chip tone="ok">At mandate</Chip>;
}

const FRESH: Record<Freshness, { tone: ChipTone; word: string }> = { current: { tone: "ok", word: "Current" }, stale: { tone: "warn", word: "Stale" }, none: { tone: "mute", word: "No data" } };

export interface CoverageTableProps {
  caption: string;
  rows: BranchProcess[];
  asOf?: string;
  branchNames: Record<string, string>;
  openId: string | null;
  onToggle: (p: BranchProcess) => void;
  onOpenProcess?: (p: BranchProcess) => void;
  limit?: number;
}

/** Process coverage as a navy table; each row can expand its agent list (below the table) and open the process drawer. */
export function CoverageTable({ caption, rows, asOf, branchNames, openId, onToggle, onOpenProcess, limit = 10 }: CoverageTableProps) {
  const btn = "inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-blue-900 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600";
  return (
    <NavyTable<BranchProcess> caption={caption} rows={rows} limit={limit} empty="No processes"
      columns={[
        { key: "p", label: "Process", render: (p) => <span className="font-semibold">{p.processName}</span> },
        { key: "c", label: "Coverage", render: (p) => <CoverageBadge tier={p.tier} /> },
        { key: "h", label: "Headcount vs seats", wrap: true, render: (p) => <SeatsCell p={p} /> },
        { key: "m", label: "Mandate", render: (p) => <MandateChip p={p} /> },
        { key: "d", label: "Latest data", render: (p) => {
          const f = FRESH[freshness(p.latestMetricDate, asOf)];
          return <span className="inline-flex items-center gap-1.5"><span className="tabular-nums">{p.latestMetricDate ?? "—"}</span><Chip tone={f.tone}>{f.word}</Chip></span>;
        } },
        { key: "b", label: "Branches", wrap: true, render: (p) => (p.branchIds.length ? p.branchIds.map((b) => branchNames[b] ?? b).join(", ") : "—") },
        { key: "a", label: "Agents", render: (p) => (
          <span className="inline-flex items-center gap-1">
            <button type="button" className={btn} aria-expanded={openId === p.processId} aria-controls="bh-process-agents" onClick={() => onToggle(p)}
              aria-label={`${openId === p.processId ? "Hide" : "Show"} agents for ${p.processName}`}>
              <ChevronDown className={`h-4 w-4 ${openId === p.processId ? "" : "-rotate-90"}`} aria-hidden="true" />Agents
            </button>
            {onOpenProcess && p.branchIds.length ? (
              <button type="button" className={btn} onClick={() => onOpenProcess(p)} aria-label={`Open ${p.processName} details`}>
                <ExternalLink className="h-4 w-4" aria-hidden="true" />Details
              </button>
            ) : null}
          </span>
        ) },
      ]} />
  );
}
