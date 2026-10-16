import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { BranchHeadHealthPayload } from "../../../../../../backend/src/modules/branch-head-health/types";
import { useBranchTrends } from "@/hooks/useBranchTrends";
import { DrillDrawer } from "../viz";
import type { DrillTarget } from "../drill";
import { KPI_TREND_METRICS } from "../kpiModel";
import { EMPTY_DRILL, backDrill, drillSync, pruneDrill, pushDrill, type DrillEntry, type DrillState } from "./history";
import { MetricDrawer, METRIC_TITLES } from "./MetricDrawer";
import { ProcessDrawer } from "./ProcessDrawer";

/** The drawer host's state and actions; the layout owns one and hands `open` to every section and tile. */
export interface DrillHostApi {
  state: DrillState;
  /** Opens `target` for the overview of `branchId`; from inside the drawer it swaps the content (with Back). */
  open: (target: DrillTarget, branchId: string) => void;
  back: () => void;
  close: () => void;
  /** Drops stale entries (process or branch gone from `data`) from the stored state. */
  prune: (data: BranchHeadHealthPayload) => void;
}

export function useDrillHost(): DrillHostApi {
  const [state, setState] = useState<DrillState>(EMPTY_DRILL);
  const open = useCallback((target: DrillTarget, branchId: string) => {
    const b = target.kind === "process" && target.branchId ? target.branchId : branchId;
    setState((s) => pushDrill(s, { target, branchId: b }));
  }, []);
  const back = useCallback(() => setState(backDrill), []);
  const close = useCallback(() => setState(EMPTY_DRILL), []);
  const prune = useCallback((data: BranchHeadHealthPayload) => setState((s) => pruneDrill(s, data)), []);
  return useMemo(() => ({ state, open, back, close, prune }), [state, open, back, close, prune]);
}

const titleOf = (e: DrillEntry) => (e.target.kind === "process" ? e.target.name || "Process" : METRIC_TITLES[e.target.id]);
const TRENDS = [...KPI_TREND_METRICS];

export interface DrillHostProps {
  host: DrillHostApi;
  data: BranchHeadHealthPayload;
  branchNames: Record<string, string>;
  /** Static-markup tests only. */
  inline?: boolean;
}

/** The single drill drawer: a process 360 or a metric view, with Back through up to five earlier views. */
export function DrillHost({ host, data, branchNames, inline }: DrillHostProps) {
  // Render from the pruned state at once; the effect then clears the stored state, so a process that
  // vanishes and later reappears never pops the drawer open again and Back never lands on a stale view.
  const state = pruneDrill(host.state, data);
  const action = drillSync(host.state, data);
  const { close, prune } = host;
  useEffect(() => {
    if (action === "close") close();
    else if (action === "prune") prune(data);
  }, [action, close, prune, data]);
  const cur = state.current;
  const row = cur ? data.branches.find((b) => b.branch.branchId === cur.branchId) ?? null : null;
  const { points: trends } = useBranchTrends(cur && cur.target.kind === "metric" ? cur.branchId : null, TRENDS);
  const prev = state.back[state.back.length - 1];
  const onOpen = (t: DrillTarget) => host.open(t, cur?.branchId ?? "");
  const many = data.branches.length > 1;
  return (
    <DrillDrawer open={Boolean(cur && row)} onClose={host.close} inline={inline}
      title={cur ? titleOf(cur) : ""} subtitle={row && many ? row.branch.branchName : undefined}
      focusKey={cur ? `${state.back.length}:${cur.target.kind}:${cur.target.id}` : undefined}>
      {cur && row ? (
        <div className="space-y-4">
          {prev ? (
            <button type="button" onClick={host.back}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold text-blue-900 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to {titleOf(prev)}
            </button>
          ) : null}
          {cur.target.kind === "process" ? (
            <ProcessDrawer payload={data} overview={row.overview} target={{ ...cur.target, branchId: cur.branchId }} branchNames={branchNames} />
          ) : (
            <MetricDrawer id={cur.target.id} overview={row.overview} payload={data} trends={trends} onOpen={onOpen} />
          )}
        </div>
      ) : null}
    </DrillDrawer>
  );
}
