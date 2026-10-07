import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  factWhere,
  hasPeopleOnlyFilter,
  num,
  numOrNull,
  round,
  type OpsCtx,
  type OpsDimension,
} from "./ops-command.context.js";
import { memo } from "./ops-command.cache.js";
import { groupKey, loadView } from "./ops-command.dim.js";
import { PERFORMANCE_HEADLINE_KEYS } from "./ops-command.definitions.js";
import { resolveNames } from "./ops-command.names.js";

export interface PerfMetricMeta {
  key: string;
  label: string;
  unit: string | null;
  direction: "higher_is_better" | "lower_is_better";
  category: string | null;
  family: string | null;
}

export interface PerfCell {
  value: number | null;
  target: number | null;
  achievementPct: number | null;
  status: "on_track" | "watch" | "off_track" | "no_target";
}

export interface PerfRow {
  id: string;
  name: string;
  sub: string | null;
  cells: Record<string, PerfCell>;
}

const MAX_METRICS = 30;
const SUM_METHODS = new Set(["sum", "count", "total"]);

/** target vs actual, capped at 120 like performance-intelligence.calculateAchievement. */
export function achievement(
  value: number | null,
  target: number | null,
  dir: PerfMetricMeta["direction"],
): number | null {
  if (value === null || target === null || target === 0) return null;
  if (dir === "lower_is_better")
    return value <= 0 ? 120 : Math.min((target / value) * 100, 120);
  return Math.min((value / target) * 100, 120);
}

export function achievementStatus(a: number | null): PerfCell["status"] {
  if (a === null) return "no_target";
  return a >= 100 ? "on_track" : a >= 90 ? "watch" : "off_track";
}

interface Acc {
  gid: string;
  key: string;
  n: number | null;
  d: number | null;
  s: number;
  a: number;
  c: number;
}

/**
 * Process-KPI matrix. Process / branch / total grain reads process_metric_actual (ratio metrics use
 * SUM(numerator)/SUM(denominator), never an average of daily percentages). Manager / analyst / LOB grain
 * reads the per-analyst feed process_metric_employee_actual.
 */
export type PerfSource = "process" | "agent";

function agentKpis(from: string, to: string) {
  return memo(`kda|${from}|${to}`, async () => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT k.employee_id AS eid, m.metric_code AS mkey, SUM(k.actual_value) AS s, COUNT(*) AS c,
              SUM(k.numerator_value) AS n, SUM(k.denominator_value) AS d
         FROM kpi_daily_actual k JOIN kpi_metric_master m ON m.id = k.metric_id
        WHERE k.score_date BETWEEN ? AND ? GROUP BY k.employee_id, k.metric_id`,
      [from, to],
    );
    return rows.map((r) => ({
      eid: String(r.eid),
      key: String(r.mkey),
      s: num(r.s),
      c: num(r.c),
      n: numOrNull(r.n),
      d: numOrNull(r.d),
    }));
  });
}

export async function computePerformance(
  ctx: OpsCtx,
  dim: OpsDimension,
  source: PerfSource = dim === "all" || dim === "branch" || dim === "process"
    ? "process"
    : "agent",
): Promise<{
  metrics: PerfMetricMeta[];
  rows: PerfRow[];
  grain: "process" | "analyst";
}> {
  const { from, to } = ctx.f;
  let accs: Acc[];
  let grain: "process" | "analyst";

  const empProcess = new Map<string, string | null>();
  if (source === "process") {
    grain = "process";
    if (hasPeopleOnlyFilter(ctx)) return { metrics: [], rows: [], grain };
    const fw = factWhere(ctx, "pm.branch_id", "pma.process_id");
    const gx =
      dim === "process"
        ? `pma.process_id`
        : dim === "branch"
          ? `COALESCE(pm.branch_id,'__none__')`
          : `'all'`;
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ${gx} AS gid, pma.metric_key AS mkey, SUM(pma.rollup_numerator) AS n, SUM(pma.rollup_denominator) AS d,
              SUM(pma.actual_value) AS s, AVG(pma.actual_value) AS a, COUNT(*) AS c
         FROM process_metric_actual pma
         JOIN process_master pm ON pm.id = pma.process_id
        WHERE pma.score_date BETWEEN ? AND ? AND ${fw.sql}
        GROUP BY gid, mkey`,
      [from, to, ...fw.params],
    );
    accs = rows.map((r) => ({
      gid: String(r.gid),
      key: String(r.mkey),
      n: numOrNull(r.n),
      d: numOrNull(r.d),
      s: num(r.s),
      a: num(r.a),
      c: num(r.c),
    }));
  } else {
    grain = "analyst";
    const view = await loadView(ctx);
    const facts = await agentKpis(from, to);
    const byKey = new Map<
      string,
      {
        gid: string;
        key: string;
        n: number | null;
        d: number | null;
        s: number;
        c: number;
      }
    >();
    for (const f of facts) {
      const e = view.byId.get(f.eid);
      if (!e) continue;
      empProcess.set(f.eid, e.process);
      const gid = groupKey(e, dim);
      const k = `${gid}|${f.key}`;
      const a = byKey.get(k) ?? {
        gid,
        key: f.key,
        n: null,
        d: null,
        s: 0,
        c: 0,
      };
      a.s += f.s;
      a.c += f.c;
      if (f.n !== null && f.d !== null) {
        a.n = (a.n ?? 0) + f.n;
        a.d = (a.d ?? 0) + f.d;
      }
      byKey.set(k, a);
    }
    accs = [...byKey.values()].map((a) => ({
      gid: a.gid,
      key: a.key,
      n: a.n,
      d: a.d,
      s: a.s,
      a: a.c ? a.s / a.c : 0,
      c: a.c,
    }));
  }
  if (!accs.length) return { metrics: [], rows: [], grain };

  // Rank metrics: headline first, then by data volume.
  const volume = new Map<string, number>();
  for (const a of accs) volume.set(a.key, (volume.get(a.key) ?? 0) + a.c);
  const keys = [...volume.keys()]
    .sort((x, y) => {
      const hx = PERFORMANCE_HEADLINE_KEYS.indexOf(x),
        hy = PERFORMANCE_HEADLINE_KEYS.indexOf(y);
      if (hx !== -1 || hy !== -1)
        return (hx === -1 ? 999 : hx) - (hy === -1 ? 999 : hy);
      return (volume.get(y) ?? 0) - (volume.get(x) ?? 0);
    })
    .slice(0, MAX_METRICS);

  const marks = keys.map(() => "?").join(",");
  const [metaRows] = await db.execute<RowDataPacket[]>(
    `SELECT metric_code, metric_name, unit, direction, category, family, aggregation_method
       FROM kpi_metric_master WHERE metric_code IN (${marks})`,
    keys,
  );
  const metaByKey = new Map(metaRows.map((r) => [String(r.metric_code), r]));
  const metrics: PerfMetricMeta[] = keys.map((k) => {
    const m = metaByKey.get(k);
    return {
      key: k,
      label: m?.metric_name ? String(m.metric_name) : k.replace(/_/g, " "),
      unit: m?.unit ? String(m.unit) : null,
      direction:
        m?.direction === "lower_is_better"
          ? "lower_is_better"
          : "higher_is_better",
      category: m?.category ? String(m.category) : null,
      family: m?.family ? String(m.family) : null,
    };
  });

  // Targets: active Studio definition per process. A row gets a target only when it maps to one process.
  const targets = new Map<string, number>();
  const processIds = new Set<string>();
  if (dim === "process")
    for (const a of accs) if (a.gid !== "__none__") processIds.add(a.gid);
  if (ctx.f.processId && ctx.f.processId !== "__none__")
    processIds.add(ctx.f.processId);
  if (dim === "employee")
    for (const p of empProcess.values()) if (p) processIds.add(p);
  if (processIds.size) {
    const ids = [...processIds].slice(0, 400);
    const pm = ids.map(() => "?").join(",");
    const [tRows] = await db.execute<RowDataPacket[]>(
      `SELECT d.process_id, m.metric_code, d.target_value
         FROM kpi_studio_definition d JOIN kpi_metric_master m ON m.id = d.metric_id
        WHERE d.active_status = 1 AND d.effective_to IS NULL AND d.employee_id IS NULL
          AND d.process_id IN (${pm}) AND d.target_value IS NOT NULL AND m.metric_code IN (${marks})`,
      [...ids, ...keys],
    );
    for (const r of tRows)
      targets.set(`${r.process_id}|${r.metric_code}`, num(r.target_value));
  }

  const byGroup = new Map<string, Map<string, Acc>>();
  for (const a of accs) {
    if (!keys.includes(a.key)) continue;
    if (!byGroup.has(a.gid)) byGroup.set(a.gid, new Map());
    byGroup.get(a.gid)!.set(a.key, a);
  }

  const names = await resolveNames(dim, [...byGroup.keys()]);
  const rows: PerfRow[] = [...byGroup.entries()].map(([gid, perKey]) => {
    const cells: Record<string, PerfCell> = {};
    for (const meta of metrics) {
      const a = perKey.get(meta.key);
      if (!a) continue;
      const method = String(
        metaByKey.get(meta.key)?.aggregation_method ?? "",
      ).toLowerCase();
      const value = SUM_METHODS.has(method)
        ? a.s
        : a.d && a.n !== null
          ? a.n / a.d
          : a.a;
      const targetProcess =
        dim === "process"
          ? gid
          : dim === "employee"
            ? (empProcess.get(gid) ?? null)
            : (ctx.f.processId ?? null);
      const target = targetProcess
        ? (targets.get(`${targetProcess}|${meta.key}`) ?? null)
        : null;
      const ach = achievement(value, target, meta.direction);
      cells[meta.key] = {
        value: round(value, 2),
        target,
        achievementPct: round(ach, 1),
        status: achievementStatus(ach),
      };
    }
    return {
      id: gid,
      name: names.get(gid)?.name ?? "—",
      sub: names.get(gid)?.sub ?? null,
      cells,
    };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { metrics, rows, grain };
}
