import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { readableProcessIds } from "./process-operations.service.js";
import { buildProcessEmployeeBreakdownPlan, type SourceField, type DataSourceConfig } from "../kpi/kpi-studio.sources.js";
import { evaluateFormula } from "../kpi/kpi-formula.engine.js";

/**
 * Agent-by-day and team-leader-by-day view of one metric: the level between "the process figure per day"
 * and "one person on one day". Recomputes the metric's own formula per employee for each recent day with the
 * same plan builder the existing per-analyst breakdown uses, so the numbers agree with it. Read-only.
 * Only metrics whose data source attributes rows to individual employees can be broken down.
 */

export interface DayGridAnalyst {
  employeeId: string; employeeCode: string; name: string;
  teamLeader: { employeeCode: string; name: string } | null;
  values: Array<number | null>; average: number | null;
}
export interface DayGridTeam { key: string; name: string; employeeCode: string | null; analysts: number; values: Array<number | null>; average: number | null }
export interface DayGrid {
  available: boolean; reason: string | null;
  metricName: string | null; unit: string | null; direction: string | null; targetValue: number | null;
  dates: string[]; analysts: DayGridAnalyst[]; teams: DayGridTeam[]; truncated: boolean;
}

const TL_PATTERN = /team\s*-?\s*lead|^\s*tl\s*$/i;
const MAX_ANALYSTS = 150;
const CONCURRENCY = 3;

const iso = (v: unknown): string => {
  const d = v instanceof Date ? v : new Date(String(v));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Mean of each team's members per day (unweighted: every analyst counts equally, whatever their volume). */
export function rollupTeams(analysts: DayGridAnalyst[], dayCount: number): DayGridTeam[] {
  const groups = new Map<string, { name: string; code: string | null; members: DayGridAnalyst[] }>();
  for (const a of analysts) {
    const key = a.teamLeader?.employeeCode ?? "__none__";
    const g = groups.get(key) ?? { name: a.teamLeader?.name ?? "No team leader found", code: a.teamLeader?.employeeCode ?? null, members: [] };
    g.members.push(a); groups.set(key, g);
  }
  return [...groups.entries()].map(([key, g]) => {
    const values = Array.from({ length: dayCount }, (_, i) => mean(g.members.map((m) => m.values[i]).filter((v): v is number => v !== null)));
    return { key, name: g.name, employeeCode: g.code, analysts: g.members.length, values, average: mean(values.filter((v): v is number => v !== null)) };
  });
}

/** Worst first, direction-aware; people/teams with no data last. */
export function sortWorstFirst<T extends { average: number | null }>(rows: T[], direction: string | null): T[] {
  return [...rows].sort((a, b) => {
    if (a.average === null && b.average === null) return 0;
    if (a.average === null) return 1;
    if (b.average === null) return -1;
    return direction === "lower_is_better" ? b.average - a.average : a.average - b.average;
  });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; p: Promise<DayGrid> }>();

/** Scope check first (per user), then a shared 5-minute cache: the audit-backed metrics scan large tables once per day. */
export async function getMetricDayAnalystGrid(userId: string, processId: string, metricKey: string, daysInput = 10): Promise<DayGrid | null> {
  const allowed = await readableProcessIds(userId);
  if (!allowed.has(processId)) return null;
  const days = Math.max(3, Math.min(21, Math.round(daysInput) || 10));
  const key = `${processId}|${metricKey}|${days}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.p;
  const p = computeGrid(processId, metricKey, days);
  cache.set(key, { at: Date.now(), p });
  p.then((g) => { if (!g.available) cache.delete(key); }).catch(() => cache.delete(key));
  if (cache.size > 100) { const k = cache.keys().next().value; if (k) cache.delete(k); }
  return p;
}

async function computeGrid(processId: string, metricKey: string, days: number): Promise<DayGrid> {
  const empty = (reason: string, extra: Partial<DayGrid> = {}): DayGrid => ({
    available: false, reason, metricName: null, unit: null, direction: null, targetValue: null, dates: [], analysts: [], teams: [], truncated: false, ...extra,
  });

  const [metricRows] = await db.execute<RowDataPacket[]>("SELECT metric_name, unit, direction FROM kpi_metric_master WHERE metric_code = ? LIMIT 1", [metricKey]);
  const metric = metricRows[0] ?? null;
  const [defRows] = await db.execute<RowDataPacket[]>(
    `SELECT d.formula_expression, d.target_value, d.data_source_id
       FROM kpi_studio_definition d JOIN kpi_metric_master m ON m.id = d.metric_id
      WHERE m.metric_code = ? AND d.process_id = ? AND d.active_status = 1
      ORDER BY (d.effective_to IS NULL) DESC, d.effective_from DESC LIMIT 1`, [metricKey, processId]);
  const def = defRows[0] ?? null;
  const meta = { metricName: metric?.metric_name ? String(metric.metric_name) : metricKey, unit: metric?.unit ?? null, direction: metric?.direction ?? null, targetValue: def?.target_value === null || def?.target_value === undefined ? null : Number(def.target_value) };
  if (!def?.data_source_id || !def.formula_expression) return empty("This metric has no configured formula or data source to recompute per person.", meta);

  const [srcRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, source_code, source_name, source_type, source_object, date_column, date_format,
            process_key_kind, process_key_column, process_key_value, employee_key_column, employee_key_kind
       FROM kpi_studio_data_source WHERE id = ? LIMIT 1`, [def.data_source_id]);
  const src = srcRows[0] as (DataSourceConfig & { date_format?: string | null }) | undefined;
  if (!src) return empty("This metric's data source no longer exists.", meta);
  if ((src.process_key_kind ?? "none") !== "employee") return empty("This metric is measured for the whole process, not attributed to individual people, so it cannot be broken down by person or team leader.", meta);

  const [fieldRows] = await db.execute<RowDataPacket[]>(
    `SELECT field_name, source_column, aggregate_fn, source_expression, filter_json FROM kpi_studio_source_field
      WHERE data_source_id = ? AND active_status = 1 ORDER BY field_name`, [def.data_source_id]);
  const fields: SourceField[] = fieldRows.map((f) => ({ field_name: String(f.field_name), source_column: f.source_column ?? null, aggregate_fn: f.aggregate_fn ?? null, source_expression: f.source_expression ?? null, filter_json: f.filter_json ?? null }));
  if (!fields.length) return empty("This data source has no fields configured yet.", meta);

  // The days to show: the last N days this metric actually has a process-level reading for, else the last N calendar days.
  const [dateRows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT score_date FROM process_metric_actual WHERE process_id = ? AND metric_key = ? AND actual_value IS NOT NULL
      ORDER BY score_date DESC LIMIT ${days}`, [processId, metricKey]); // days is a clamped integer; a bound LIMIT ? is rejected by prepared statements
  let dates = dateRows.map((r) => iso(r.score_date)).sort();
  if (!dates.length) {
    const t = new Date(); dates = Array.from({ length: days }, (_, i) => iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - (days - 1 - i))));
  }

  type Row = { id: string; code: string; name: string; value: number | null };
  let perDay: Row[][];
  try {
    perDay = await mapLimit(dates, CONCURRENCY, async (date) => {
      const plan = buildProcessEmployeeBreakdownPlan(src, fields, date, date, processId);
      const [rows] = await db.execute<RowDataPacket[]>(plan.sql, plan.params);
      return rows.map((r) => {
        const inputs: Record<string, number | string | null> = {};
        for (const name of plan.fieldNames) inputs[name] = r[name] ?? null;
        return {
          id: String(r.__employee_id), code: String(r.__employee_code ?? ""),
          name: `${r.__first_name ?? ""} ${r.__last_name ?? ""}`.trim() || String(r.__employee_code ?? "Unknown"),
          value: evaluateFormula(def.formula_expression, inputs).value,
        };
      });
    });
  } catch (err) {
    return empty(`Could not compute the day-by-day breakdown: ${(err as Error).message}`, { ...meta, dates });
  }

  const people = new Map<string, { code: string; name: string; values: Array<number | null> }>();
  perDay.forEach((rows, di) => {
    for (const r of rows) {
      const p = people.get(r.id) ?? { code: r.code, name: r.name, values: Array(dates.length).fill(null) as Array<number | null> };
      p.values[di] = r.value; people.set(r.id, p);
    }
  });
  if (!people.size) return empty("No person-level rows were found for these days.", { ...meta, dates });

  let ids = [...people.keys()];
  const truncated = ids.length > MAX_ANALYSTS;
  if (truncated) {
    ids = ids.sort((a, b) => (people.get(b)!.values.filter((v) => v !== null).length) - (people.get(a)!.values.filter((v) => v !== null).length)).slice(0, MAX_ANALYSTS);
  }

  const [chainRows] = await db.execute<RowDataPacket[]>(
    `WITH RECURSIVE chain AS (
       SELECT e.id AS start_id, e.id AS node_id, e.reporting_manager_id, 0 AS depth, CAST(e.id AS CHAR(4000)) AS visited
         FROM employees e WHERE e.id IN (${ids.map(() => "?").join(",")})
       UNION ALL
       SELECT c.start_id, m.id, m.reporting_manager_id, c.depth + 1, CONCAT(c.visited, ',', m.id)
         FROM employees m JOIN chain c ON m.id = c.reporting_manager_id
        WHERE c.depth < 6 AND FIND_IN_SET(m.id, c.visited) = 0)
     SELECT c.start_id, c.depth, e.employee_code, e.first_name, e.last_name, d.designation_name
       FROM chain c JOIN employees e ON e.id = c.node_id LEFT JOIN designation_master d ON d.id = e.designation_id
      WHERE c.depth > 0 ORDER BY c.start_id, c.depth`, ids);
  const tlByEmployee = new Map<string, { employeeCode: string; name: string }>();
  for (const r of chainRows) {
    const k = String(r.start_id);
    if (!tlByEmployee.has(k) && r.designation_name && TL_PATTERN.test(String(r.designation_name))) {
      tlByEmployee.set(k, { employeeCode: String(r.employee_code ?? ""), name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() });
    }
  }

  const analysts: DayGridAnalyst[] = ids.map((id) => {
    const p = people.get(id)!;
    return { employeeId: id, employeeCode: p.code, name: p.name, teamLeader: tlByEmployee.get(id) ?? null, values: p.values, average: mean(p.values.filter((v): v is number => v !== null)) };
  });
  return {
    available: true, reason: null, ...meta, dates, truncated,
    analysts: sortWorstFirst(analysts, meta.direction),
    teams: sortWorstFirst(rollupTeams(analysts, dates.length), meta.direction),
  };
}
