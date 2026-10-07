/** Data hooks of the Drive Command Center. Each request aborts the previous one; a stale response is never applied (see commandData.ts). */
import { useCallback, useEffect, useRef, useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { createRequestSequencer, describeError, requisitionOptions, branchOptions, type RequisitionOption } from "./commandData";
import { analyticsPath, drivePlanPath, type Filters } from "./driveCommandModel";
import type { DriveAnalytics, DrivePlan } from "./driveCommandTypes";

export interface Loaded<T> { data: T | null; error: string | null; loading: boolean; reload: () => void }

/** Loads `path` (null = idle) and reloads when it changes. Previous data stays visible while a new request runs. */
function useLatest<T>(path: string | null): Loaded<T> {
  const seq = useRef(createRequestSequencer());
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);

  const run = useCallback(async () => {
    if (!path) { seq.current.cancel(); setData(null); setError(null); setLoading(false); return; }
    const ticket = seq.current.begin();
    setLoading(true);
    try {
      const r = await hrmsApi.get<{ success?: boolean; data?: T }>(path, undefined, ticket.signal);
      if (!ticket.isCurrent()) return;
      if (r && r.data) { setData(r.data); setError(null); } else setError("Unexpected response from the server");
    } catch (e: unknown) {
      if (!ticket.isCurrent()) return;
      setError(describeError(e));
    } finally {
      if (ticket.isCurrent()) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void run();
    const s = seq.current;
    return () => s.cancel();
  }, [run]);

  return { data, error, loading, reload: () => void run() };
}

export function useDriveAnalytics(filters: Filters): Loaded<DriveAnalytics> {
  return useLatest<DriveAnalytics>(analyticsPath(filters));
}

export function useDrivePlan(requisitionId: string | null, from?: string | null, days?: number | null): Loaded<DrivePlan> {
  return useLatest<DrivePlan>(requisitionId ? drivePlanPath(requisitionId, from, days) : null);
}

/** Open requisitions (select options) from the existing endpoint; a failure leaves the lists empty and the selects usable. */
export function useFilterOptions(): { requisitions: RequisitionOption[]; branches: string[] } {
  const [requisitions, setRequisitions] = useState<RequisitionOption[]>([]);
  useEffect(() => {
    const c = new AbortController();
    hrmsApi.get<{ data?: unknown }>("/api/he/requisitions/open", undefined, c.signal)
      .then((r) => { if (!c.signal.aborted) setRequisitions(requisitionOptions(r?.data)); })
      .catch(() => undefined);
    return () => c.abort();
  }, []);
  return { requisitions, branches: branchOptions(requisitions) };
}
