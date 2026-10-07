import {
  addDays,
  daysBetween,
  pct,
  type OpsCtx,
  type OpsDimension,
} from "./ops-command.context.js";
import { groupKey, loadView } from "./ops-command.dim.js";
import * as F from "./ops-command.facts.js";
import { resolveNames } from "./ops-command.names.js";

export type HeatMetric = "attendance" | "shrinkage" | "absent" | "late";
export const HEAT_METRICS: HeatMetric[] = [
  "attendance",
  "shrinkage",
  "absent",
  "late",
];
const MAX_DAYS = 62;
const MAX_GROUPS = 60;

export interface Heatmap {
  metric: HeatMetric;
  dates: string[];
  rows: Array<{
    id: string;
    name: string;
    sub: string | null;
    cells: Array<number | null>;
    overall: number | null;
  }>;
  truncatedGroups: boolean;
}

/** Group × day matrix using exactly the attendance/shrinkage formulas of the summary table. */
export async function computeHeatmap(
  ctx: OpsCtx,
  dim: OpsDimension,
  metric: HeatMetric,
): Promise<Heatmap> {
  const attTo = ctx.f.to < ctx.attThrough ? ctx.f.to : ctx.attThrough;
  let from = ctx.f.from;
  if (daysBetween(from, attTo) > MAX_DAYS)
    from = addDays(attTo, -(MAX_DAYS - 1));
  if (from > attTo)
    return { metric, dates: [], rows: [], truncatedGroups: false };

  const view = await loadView(ctx);
  const raw = await F.adrRows(from, attTo);
  type Cell = {
    sched: number;
    present: number;
    half: number;
    leave_d: number;
    absent: number;
    missing: number;
    late: number;
    worked: number;
  };
  const blank = (): Cell => ({
    sched: 0,
    present: 0,
    half: 0,
    leave_d: 0,
    absent: 0,
    missing: 0,
    late: 0,
    worked: 0,
  });
  const cellsBy = new Map<string, Map<string, Cell>>();
  for (const r of raw) {
    const e = view.byId.get(r.eid);
    if (!e) continue;
    const gid = groupKey(e, dim);
    const g = cellsBy.get(gid) ?? new Map<string, Cell>();
    const c = g.get(r.d) ?? blank();
    if (!["week_off", "holiday", "week_off_worked"].includes(r.st)) c.sched++;
    if (r.st === "present") c.present++;
    if (r.st === "half_day") c.half++;
    if (r.st === "leave_approved") c.leave_d++;
    if (r.st === "absent") c.absent++;
    if (r.st === "missing_punch" || r.st === "unreconciled") c.missing++;
    if (r.late) c.late++;
    if (r.st === "present" || r.st === "half_day") c.worked++;
    g.set(r.d, c);
    cellsBy.set(gid, g);
  }

  const value = (r: Cell): number | null => {
    const sched = r.sched,
      half = r.half,
      leave = r.leave_d;
    switch (metric) {
      case "attendance":
        return pct(r.present + half / 2, sched - leave);
      case "shrinkage":
        return pct(leave + r.absent + r.missing + half / 2, sched);
      case "absent":
        return pct(r.absent, sched);
      default:
        return pct(r.late, r.worked);
    }
  };

  const dates: string[] = [];
  for (let d = from; d <= attTo; d = addDays(d, 1)) dates.push(d);

  const sorted = [...cellsBy.entries()]
    .map(([gid, g]) => ({
      gid,
      g,
      weight: [...g.values()].reduce((t, c) => t + c.sched, 0),
    }))
    .sort((a, b) => b.weight - a.weight);
  const kept = sorted.slice(0, MAX_GROUPS);
  const names = await resolveNames(
    dim,
    kept.map((k) => k.gid),
  );
  return {
    metric,
    dates,
    truncatedGroups: sorted.length > MAX_GROUPS,
    rows: kept.map(({ gid, g }) => {
      const total = blank();
      for (const c of g.values())
        for (const k of Object.keys(total) as Array<keyof Cell>)
          total[k] += c[k];
      return {
        id: gid,
        name: names.get(gid)?.name ?? "—",
        sub: names.get(gid)?.sub ?? null,
        cells: dates.map((d) => (g.has(d) ? value(g.get(d)!) : null)),
        overall: value(total),
      };
    }),
  };
}
