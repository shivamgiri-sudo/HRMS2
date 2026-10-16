import type { BranchHeadHealthPayload } from "../../../../../../backend/src/modules/branch-head-health/types";
import type { DrillTarget } from "../drill";

/** One drawer view: what is open and for which branch overview. */
export interface DrillEntry { target: DrillTarget; branchId: string }
/** The open view plus the views "Back" returns to (oldest first). */
export interface DrillState { current: DrillEntry | null; back: DrillEntry[] }

export const MAX_DRILL_DEPTH = 5;
export const EMPTY_DRILL: DrillState = { current: null, back: [] };

export function sameEntry(a: DrillEntry | null, b: DrillEntry | null): boolean {
  if (!a || !b) return a === b;
  return a.branchId === b.branchId && a.target.kind === b.target.kind && a.target.id === b.target.id;
}

/** Open `entry`: fresh when closed, else push the current view (history capped at MAX_DRILL_DEPTH). */
export function pushDrill(s: DrillState, entry: DrillEntry): DrillState {
  if (sameEntry(s.current, entry)) return s;
  if (!s.current) return { current: entry, back: [] };
  return { current: entry, back: [...s.back, s.current].slice(-MAX_DRILL_DEPTH) };
}

/** Return to the previous view; unchanged when there is none. */
export function backDrill(s: DrillState): DrillState {
  if (s.back.length === 0) return s;
  return { current: s.back[s.back.length - 1], back: s.back.slice(0, -1) };
}

/** Changes whenever the drawer must close: another branch selected, another date, another branch list. */
export function drillResetKey(selectedBranchId: string, date: string | undefined, branchIds: readonly string[]): string {
  return JSON.stringify([selectedBranchId, date ?? "", [...branchIds]]);
}

/**
 * Whether an entry still makes sense for `data`: its branch is loaded and, for a process, the id is a
 * known process (active or unmapped) or a row of that branch's process P&L (a P&L-only process).
 */
export function entryValid(e: DrillEntry, data: BranchHeadHealthPayload): boolean {
  const row = data.branches.find((b) => b.branch.branchId === e.branchId);
  if (!row) return false;
  if (e.target.kind !== "process") return true;
  const id = e.target.id;
  if ([...(data.processes?.active ?? []), ...(data.processes?.unmapped ?? [])].some((p) => p.processId === id)) return true;
  const pnl = row.overview.processPnl;
  return pnl?.status === "ok" && Array.isArray(pnl.data?.rows) && pnl.data.rows.some((r) => r.processId === id);
}

/**
 * The state with every stale entry removed: closed (EMPTY) when the open view vanished, else the open
 * view with only the still-valid Back entries. Returns `s` itself when nothing changed.
 */
export function pruneDrill(s: DrillState, data: BranchHeadHealthPayload): DrillState {
  if (!s.current) return s.back.length ? EMPTY_DRILL : s;
  if (!entryValid(s.current, data)) return EMPTY_DRILL;
  const back = s.back.filter((e) => entryValid(e, data));
  return back.length === s.back.length ? s : { current: s.current, back };
}

/** What the host must do to its stored state after a payload change. */
export function drillSync(s: DrillState, data: BranchHeadHealthPayload): "none" | "close" | "prune" {
  const next = pruneDrill(s, data);
  if (next === s) return "none";
  return s.current && !next.current ? "close" : "prune";
}
