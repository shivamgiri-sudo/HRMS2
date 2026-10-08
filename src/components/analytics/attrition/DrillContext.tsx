/** One shared DrillDrawer for a whole surface: any component calls useDrill()(query) to open the people behind a number. */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import DrillDrawer from "./DrillDrawer";
import type { AlertLink, DrillQuery } from "./types";

type OpenDrill = (q: DrillQuery) => void;
const Ctx = createContext<OpenDrill>(() => undefined);
export const useDrill = () => useContext(Ctx);

export function DrillProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState<DrillQuery | null>(null);
  const open = useCallback<OpenDrill>(q => setQuery(q), []);
  const close = useCallback(() => setQuery(null), []);
  const value = useMemo(() => open, [open]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <DrillDrawer query={query} onClose={close} />
    </Ctx.Provider>
  );
}

/** Map an alert's link (Prediction-tab filters) to the equivalent active-people drill. */
export function alertLinkToDrill(link: AlertLink, title: string): DrillQuery {
  const q: DrillQuery = { population: "active", sort: "score", title };
  if (link.tier) q.tier = link.tier;
  if (link.branchId) q.branchId = link.branchId;
  if (link.processId) q.processId = link.processId;
  if (link.managerId) q.managerId = link.managerId;
  if (link.absentOnly) { q.absentOnly = true; q.minAbsentStreak = 3; }
  if (link.newJoinerOnly) q.newJoinerOnly = true;
  return q;
}
