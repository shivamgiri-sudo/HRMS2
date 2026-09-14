/**
 * Shared filter state for the Roster Command Center console.
 *
 * The console shell (RosterCommandCenter.tsx) owns branchId/processId/from/to in its own
 * `useSearchParams`, alongside `tab` — so a URL like
 * `/wfm/roster-command-center?tab=compliance&branchId=xxx&processId=yyy` is independently
 * deep-linkable per tab. Since every tab panel is a React.lazy() component that takes no
 * props (the pattern this console reuses from AttendanceIntegrityConsole.tsx), filters
 * reach each panel through this context instead of prop drilling through TabDef.Component.
 *
 * Phase A note: this context exists and is populated by the shell's filter bar, but most
 * of the 6 moved-verbatim panels still manage their own internal branch/process pickers
 * (unchanged from their original pages) rather than consuming this context yet — wiring
 * them in is tracked as Phase B bug-fix items (see the merge plan's Bug Fixes table,
 * items 4-5). The new Team Roster panel (Phase C) is the first real consumer.
 */
import { createContext, useContext } from "react";

export interface RosterConsoleFilters {
  branchId: string; // "" = all branches
  processId: string; // "" = all processes
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

export interface RosterConsoleFilterContextValue {
  filters: RosterConsoleFilters;
  setBranchId: (branchId: string) => void;
  setProcessId: (processId: string) => void;
  setDateRange: (from: string, to: string) => void;
}

const RosterConsoleFilterContext = createContext<RosterConsoleFilterContextValue | null>(null);

export const RosterConsoleFilterProvider = RosterConsoleFilterContext.Provider;

/** Throws if used outside the console shell — every panel in TAB_DEFS is always rendered
 *  inside the provider, so this indicates a real wiring bug, not a normal empty state. */
export function useRosterConsoleFilters(): RosterConsoleFilterContextValue {
  const ctx = useContext(RosterConsoleFilterContext);
  if (!ctx) {
    throw new Error("useRosterConsoleFilters() called outside RosterConsoleFilterProvider");
  }
  return ctx;
}
