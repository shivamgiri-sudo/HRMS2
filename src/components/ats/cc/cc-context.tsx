import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { OverviewPeriod } from "@/hooks/useAtsOverview";
import { periodFrom } from "@/components/ats/overview/shell";
import type { DrillFilters } from "@/hooks/useAtsDashboards";

/**
 * One filter state for every Command Center tab. A tab shows only the controls its data can honour (see FilterBar `show`),
 * so a visible filter always applies to what is on screen.
 */
export interface CCFilters { period: OverviewPeriod; branch: string; process: string; recruiter: string }
interface CCState extends CCFilters {
  set: (patch: Partial<CCFilters>) => void;
  /** Filters in the shape the drill / candidate endpoints take (period bounded by `from`). */
  drill: (extra?: DrillFilters) => DrillFilters;
}

const Ctx = createContext<CCState | null>(null);

export function CCProvider({ children, initial }: { children: ReactNode; initial?: Partial<CCFilters> }) {
  const [f, setF] = useState<CCFilters>({ period: "30d", branch: "", process: "", recruiter: "", ...initial });
  const value = useMemo<CCState>(() => ({
    ...f,
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
  }), [f]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCC(): CCState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCC must be used inside <CCProvider>");
  return v;
}
