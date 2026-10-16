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

/** The state still valid for `data`: closed when its branch or its process is no longer in the payload. */
export function liveDrill(s: DrillState, data: BranchHeadHealthPayload): DrillState {
  const cur = s.current;
  if (!cur) return s;
  if (!data.branches.some((b) => b.branch.branchId === cur.branchId)) return EMPTY_DRILL;
  if (cur.target.kind === "process") {
    const id = cur.target.id;
    const known = [...(data.processes?.active ?? []), ...(data.processes?.unmapped ?? [])].some((p) => p.processId === id);
    if (!known) return EMPTY_DRILL;
  }
  return s;
}
