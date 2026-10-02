import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { OverviewPeriod } from "@/hooks/useAtsOverview";
import { periodFrom } from "@/components/ats/overview/shell";
import type { DrillFilters } from "@/hooks/useAtsDashboards";
import { useAtsScope } from "@/hooks/useAtsCommandCenter";

/**
 * One filter state for every Command Center tab. A tab shows only the controls its data can honour (see FilterBar `show`),
 * so a visible filter always applies to what is on screen.
 */
export interface CCFilters { period: OverviewPeriod; branch: string; process: string; recruiter: string }
interface CCState extends CCFilters {
  /** True for roles whose data is limited to their own branch / assigned processes (branch head, process manager). Those roles get the scoped tabs, built only on row-scoped endpoints. */
  scoped: boolean;
  /** True once the server has said the caller sees every branch. False while loading and for branch-limited roles, so organisation-wide-only endpoints are not called until it is true. */
  orgWide: boolean;
  /** True once the scope answer has arrived (so a screen can tell "still loading" from "not allowed"). */
  scopeKnown: boolean;
  set: (patch: Partial<CCFilters>) => void;
  /** Filters in the shape the drill / candidate endpoints take (period bounded by `from`). */
  drill: (extra?: DrillFilters) => DrillFilters;
}

const Ctx = createContext<CCState | null>(null);

export function CCProvider({ children, initial, scoped = false }: { children: ReactNode; initial?: Partial<CCFilters>; scoped?: boolean }) {
  const scopeQ = useAtsScope();
  const orgWide = scopeQ.data?.orgWide === true, scopeKnown = !!scopeQ.data || scopeQ.isError;
  const [f, setF] = useState<CCFilters>({ period: "30d", branch: "", process: "", recruiter: "", ...initial });
  const value = useMemo<CCState>(() => ({
    ...f,
    scoped, orgWide, scopeKnown,
    set: (patch) => setF((prev) => ({ ...prev, ...patch })),
    drill: (extra = {}) => {
      const out: DrillFilters = { ...extra };
      const from = periodFrom(f.period);
      if (from) out.from = from;
      if (f.branch && !out.branch) out.branch = f.branch;
      if (f.process && !out.process) out.process = f.process;
      if (f.recruiter && !out.recruiter) out.recruiter = f.recruiter;
      return out;
    },
  }), [f, scoped, orgWide, scopeKnown]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCC(): CCState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCC must be used inside <CCProvider>");
  return v;
}
