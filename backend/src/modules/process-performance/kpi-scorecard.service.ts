import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import {
  PROCESS_KPI_REGISTRY, findProcessKpiSet, findMetricDef,
  type KpiFamily, type KpiUnit, type KpiDirection, type ProcessKpiSet,
} from "./kpi-metric-registry.js";
import { resolveCdrScorecard, getCdrAgentBreakdown, getCdrAgentCalls } from "./kpi-cdr-source.js";
import { fetchActiveHc, fetchRolling30dAttritionRate, fetchRolling60dShrinkagePct } from "../workforce-mandate/hc-formula.service.js";

/**
 * Client Process KPI Dashboard — scorecards for the targets on the client-facing
 * "Process KPI's" sheet, per process, with a team-leader -> agent -> raw-row
 * drill-down.
 *
 * Same honesty rule as process-performance.service.ts, and reusing its exact
 * scope mechanism: a metric either returns a number computed from real
 * kpi_daily_actual rows, or it returns availability 'no_data' (a pipeline
 * exists, nothing has landed for this process/window) or 'not_tracked' (no
 * metric_code anywhere in the system captures this concept at all). Nothing
 * here fabricates a value.
 *
 * Verified live 2026-09-06: none of the 4 processes in the registry have any
 * rows yet for any of these metric_codes. Every resolver below still issues a
 * real query keyed on the registry's kpiMetricCode, so a metric starts showing
 * real numbers the moment a feed populates kpi_daily_actual for it -- no code
 * change required.
 */

// Same viewer set as process-performance.service.ts's VIEWER_ROLES, deliberately
// kept identical -- see that file's comment on why the route list, the service
// list and the page_catalog grants must all agree.
const VIEWER_ROLES = [
  "super_admin", "admin", "ceo", "coo", "manager", "process_manager",
  "operations_manager", "branch_head", "qa", "quality_analyst", "tq_head",
];

export interface KpiFilters {
  from: string;
  to: string;
}

/**
 * `kpi_daily_actual.team_leader_id_at_event` looks like the right column for
 * manager scoping and grouping, but it is NEVER written: verified live,
 * 0 of 84,913 rows have it set, system-wide, across every process. Manager
 * scope and the TL-pod drill level below therefore go through the CURRENT
 * `employees.reporting_manager_id` instead -- the same live-hierarchy join
 * process-performance.service.ts uses for its own manager grain -- via a
 * mandatory `JOIN employees e ON e.id = k.employee_id`, which every query in
 * this file carries for exactly this reason. `employee_id` is populated on
 * 100% of rows, so the join never drops a row.
 */
async function kpiScope(userId: string) {
  return buildScopeWhereClause(userId, VIEWER_ROLES, {
    processId: "k.process_id_at_event",
    branchId: "k.branch_id_at_event",
    managerEmployeeId: "e.reporting_manager_id",
    employeeId: "k.employee_id",
  }, { allowAdminBypass: true, allowCeoAllRead: true });
}

/** Resolve the sheet's processCode to the real process_master.id, respecting scope. */
async function resolveProcessId(userId: string, processCode: string): Promise<string | null> {
  // A process id is exposed to the caller only if it is also inside their scope
  // via the employee-scope predicate process-performance.service.ts already
  // uses -- guessing a processCode in the URL must not reveal an id outside scope.
  const scope = await buildScopeWhereClause(userId, VIEWER_ROLES, {
    processId: "p.id", branchId: "p.branch_id",
  }, { allowAdminBypass: true, allowCeoAllRead: true });
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT p.id FROM process_master p WHERE p.process_code = ? AND (${scope.sql}) LIMIT 1`,
    [processCode, ...scope.params],
  );
  return rows.length ? String(rows[0].id) : null;
}

export type Availability = "ok" | "no_data" | "not_tracked";

export interface KpiScorecardRow {
  metricKey: string;
  label: string;
  family: KpiFamily;
  unit: KpiUnit;
  lobLabel: string;
  target: number;
  direction: KpiDirection;
  availability: Availability;
  actual: number | null;
  rag: "good" | "warn" | "crit" | null;
  trend: Array<{ period: string; value: number | null }>;
  note?: string;
}

function ragFor(actual: number, target: number, direction: KpiDirection): "good" | "warn" | "crit" {
  const ratio = direction === "higher_is_better" ? actual / target : target / Math.max(actual, 1e-9);
  if (ratio >= 0.995) return "good";
  if (ratio >= 0.88) return "warn";
  return "crit";
}

/** Aggregate expression per family: volume metrics are summed per period, everything else averaged. */
function aggExprFor(family: KpiFamily): string {
  return family === "volume" ? "SUM(k.actual_value)" : "AVG(k.actual_value)";
}

export interface ProcessHealthSnapshot {
  activeHc: number;
  attrition30dPct: number | null;
  attrition30dAvailability: Availability;
  shrinkage60dPct: number | null;
  shrinkage60dAvailability: Availability;
  qualityScore: number | null;
  qualityScoreAvailability: Availability;
}

export interface ProcessKpiHeader {
  processCode: string;
  processId: string;
  billingName: string;
  projectName: string;
  note: string | null;
  health: ProcessHealthSnapshot;
}

/**
 * Real QUALITY_SCORE, averaged over the trailing 30 days. Deliberately joins
 * through the CURRENT employees.process_id, not kpi_daily_actual's own
 * process_id_at_event -- that lineage column is only 2.9% populated (0% on
 * quality rows specifically), verified live; quality-target.service.ts's
 * listProcessesMissingTarget() uses this same employees.process_id join for
 * exactly that reason, reused here rather than re-derived.
 */
async function fetchProcessQualityScore(processId: string): Promise<{ value: number | null; count: number }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT AVG(k.actual_value) AS value, COUNT(*) AS n
       FROM employees e
       JOIN kpi_daily_actual k ON k.employee_id = e.id
       JOIN kpi_metric_master m ON m.id = k.metric_id AND m.metric_code = 'QUALITY_SCORE'
      WHERE e.process_id = ?
        AND k.score_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
    [processId],
  );
  const r = rows[0];
  const n = Number(r?.n ?? 0);
  return { value: n > 0 && r?.value != null ? Number(r.value) : null, count: n };
}

/**
 * `fetchRolling60dShrinkagePct`/`fetchRolling30dAttritionRate` in
 * hc-formula.service.ts both fall back to a safe default (the mandate's
 * configured shrinkage, or 0) when there is no underlying data -- correct for
 * their own formula, where a missing input must not divide by zero, but
 * wrong here: a 0% shown on this header would read as "verified good", not
 * "no attendance/headcount data exists for this process". These two checks
 * exist only to tell those two states apart honestly.
 */
async function hasAttendanceRows(processId: string, days: number): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM attendance_daily_record adr
       JOIN employees e ON e.id = adr.employee_id
      WHERE e.process_id = ? AND adr.record_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      LIMIT 1`,
    [processId, days],
  );
  return rows.length > 0;
}

export async function getProcessKpiHeader(userId: string, processCode: string): Promise<ProcessKpiHeader | null> {
  const set = findProcessKpiSet(processCode);
  if (!set) return null;
  const processId = await resolveProcessId(userId, processCode);
  if (!processId) return null;

  // Headcount / attrition / shrinkage reuse the exact live counters
  // workforce-mandate's HC formula already computes and has proven --
  // process-scoped, no workforce_mandate row required (unlike the full
  // required-HC/coverage formula, which needs a mandate config these 4
  // processes may not have).
  const [activeHc, quality, hasAttendance60d] = await Promise.all([
    fetchActiveHc(processId, null),
    fetchProcessQualityScore(processId),
    hasAttendanceRows(processId, 60),
  ]);
  const [attrition30dPctRaw, shrinkage60dPctRaw] = await Promise.all([
    fetchRolling30dAttritionRate(processId, null, activeHc),
    fetchRolling60dShrinkagePct(processId, null, 0),
  ]);

  const health: ProcessHealthSnapshot = {
    activeHc,
    attrition30dPct: activeHc > 0 ? attrition30dPctRaw : null,
    attrition30dAvailability: activeHc > 0 ? "ok" : "no_data",
    shrinkage60dPct: hasAttendance60d ? shrinkage60dPctRaw : null,
    shrinkage60dAvailability: hasAttendance60d ? "ok" : "no_data",
    qualityScore: quality.value,
    qualityScoreAvailability: quality.count > 0 ? "ok" : "no_data",
  };

  return { processCode, processId, billingName: set.billingName, projectName: set.projectName, note: set.note ?? null, health };
}

/** Every registered process, for the picker -- listing only what the sheet defines, not the whole org. */
export function listRegisteredProcesses(): Array<{ processCode: string; billingName: string; projectName: string }> {
  return PROCESS_KPI_REGISTRY.map((p) => ({ processCode: p.processCode, billingName: p.billingName, projectName: p.projectName }));
}

export async function getKpiScorecards(
  userId: string, processCode: string, filters: KpiFilters,
): Promise<KpiScorecardRow[]> {
  const set = findProcessKpiSet(processCode);
  if (!set) return [];
  const processId = await resolveProcessId(userId, processCode);
  const scope = await kpiScope(userId);
  return computeScorecards(set, processId, filters, scope);
}

/** Resolve a raw process_master.id back to its sheet processCode, for callers (the
 *  Client Portal) that only ever hold a process_master.id, never the sheet's own code. */
export async function resolveProcessCodeById(processId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT process_code FROM process_master WHERE id = ? LIMIT 1`, [processId],
  );
  return rows.length ? String(rows[0].process_code) : null;
}

/**
 * Client Portal entry point. No `buildScopeWhereClause` involved: the portal's own
 * boundary (a client_user's token-carried `process_id`, re-verified live on every
 * request by requireClientAuth, plus the controller's `assertProcessAccess`) has
 * ALREADY authorized this exact processId before this function is ever called --
 * applying the internal role/scope predicate on top would be redundant, not safer,
 * and would wrongly deny every portal client (none of them hold an internal
 * `user_roles` row at all).
 *
 * Returns null when this process isn't one of the 4 registered in
 * kpi-metric-registry.ts, so the caller (portalKpiService) can fall back to its
 * existing kpi_template/kpi_score path for every other process untouched.
 */
export async function getKpiScorecardsForProcessId(
  processId: string, filters: KpiFilters,
): Promise<KpiScorecardRow[] | null> {
  const processCode = await resolveProcessCodeById(processId);
  if (!processCode) return null;
  const set = findProcessKpiSet(processCode);
  if (!set) return null;
  return computeScorecards(set, processId, filters, { sql: "1=1", params: [] });
}

async function computeScorecards(
  set: ProcessKpiSet, processId: string | null,
  filters: KpiFilters, scope: { sql: string; params: unknown[] },
): Promise<KpiScorecardRow[]> {
  // One batched query per distinct metric_code actually referenced by this
  // process's registry, rather than one query per sheet row -- several sheet
  // rows (e.g. ABC and Upgrade's Conversion %) share the same metric_code.
  const codes = [...new Set(set.metrics.map((m) => m.kpiMetricCode).filter((c): c is string => c !== null))];
  const actualByCode = new Map<string, { value: number | null; count: number }>();
  const trendByCode = new Map<string, Array<{ period: string; value: number | null }>>();

  if (processId && codes.length) {
    // actual_value's aggregate depends on family, but every code here happens to
    // be single-family across this process's registry today, so one query per
    // family bucket rather than per code keeps this to two round trips, not N.
    for (const family of ["rate", "volume", "duration", "roi"] as const) {
      const codesInFamily = [...new Set(
        set.metrics.filter((m) => m.family === family && m.kpiMetricCode).map((m) => m.kpiMetricCode as string),
      )];
      if (!codesInFamily.length) continue;
      const agg = aggExprFor(family);
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT m.metric_code, ${agg} AS value, COUNT(*) AS n
           FROM kpi_daily_actual k
           JOIN kpi_metric_master m ON m.id = k.metric_id
           JOIN employees e ON e.id = k.employee_id
          WHERE m.metric_code IN (${codesInFamily.map(() => "?").join(",")})
            AND k.process_id_at_event = ?
            AND k.score_date BETWEEN ? AND ?
            AND (${scope.sql})
          GROUP BY m.metric_code`,
        [...codesInFamily, processId, filters.from, filters.to, ...scope.params],
      );
      for (const r of rows) {
        actualByCode.set(String(r.metric_code), { value: r.value == null ? null : Number(r.value), count: Number(r.n) });
      }
      const [trendRows] = await db.execute<RowDataPacket[]>(
        `SELECT m.metric_code, DATE_FORMAT(k.score_date, '%Y-%m') AS period, ${agg} AS value
           FROM kpi_daily_actual k
           JOIN kpi_metric_master m ON m.id = k.metric_id
           JOIN employees e ON e.id = k.employee_id
          WHERE m.metric_code IN (${codesInFamily.map(() => "?").join(",")})
            AND k.process_id_at_event = ?
            AND k.score_date BETWEEN ? AND ?
            AND (${scope.sql})
          GROUP BY m.metric_code, period ORDER BY period ASC`,
        [...codesInFamily, processId, filters.from, filters.to, ...scope.params],
      );
      for (const r of trendRows) {
        const code = String(r.metric_code);
        const list = trendByCode.get(code) ?? [];
        list.push({ period: String(r.period), value: r.value == null ? null : Number(r.value) });
        trendByCode.set(code, list);
      }
    }
  }

  // CDR-sourced metrics (dialer_db) — a handful of the sheet's Inbound metrics
  // have no kpi_daily_actual code but do have a real call-center feed. Fetched
  // in parallel, one dialer_db round trip per distinct metric.
  const cdrMetrics = set.metrics.filter((m) => !m.kpiMetricCode && m.cdrSource);
  const cdrByMetricKey = new Map<string, Awaited<ReturnType<typeof resolveCdrScorecard>>>();
  // Gated on processId exactly like the kpi_daily_actual path above: a null
  // processId means this process is unresolved or outside the caller's scope,
  // and a real campaign feed must not leak data past that boundary either.
  if (processId && cdrMetrics.length) {
    const results = await Promise.all(
      cdrMetrics.map((m) => resolveCdrScorecard(m.cdrSource!, m.cdrSource!.field, filters.from, filters.to)),
    );
    cdrMetrics.forEach((m, i) => cdrByMetricKey.set(m.metricKey, results[i]));
  }

  return set.metrics.map((m): KpiScorecardRow => {
    if (m.cdrSource) {
      const cdr = cdrByMetricKey.get(m.metricKey);
      const availability: Availability = cdr && cdr.count > 0 ? "ok" : "no_data";
      return {
        metricKey: m.metricKey, label: m.label, family: m.family, unit: m.unit, lobLabel: m.lobLabel,
        target: m.target, direction: m.direction, availability,
        actual: availability === "ok" ? cdr!.value : null,
        rag: availability === "ok" && cdr!.value != null ? ragFor(cdr!.value, m.target, m.direction) : null,
        trend: cdr?.trend ?? [],
        note: availability === "no_data" ? "No calls recorded on this campaign for this window." : undefined,
      };
    }
    if (!m.kpiMetricCode) {
      return {
        metricKey: m.metricKey, label: m.label, family: m.family, unit: m.unit, lobLabel: m.lobLabel,
        target: m.target, direction: m.direction, availability: "not_tracked",
        actual: null, rag: null, trend: [], note: m.notTrackedNote,
      };
    }
    const found = actualByCode.get(m.kpiMetricCode);
    const availability: Availability = !processId ? "no_data" : found && found.count > 0 ? "ok" : "no_data";
    return {
      metricKey: m.metricKey, label: m.label, family: m.family, unit: m.unit, lobLabel: m.lobLabel,
      target: m.target, direction: m.direction, availability,
      actual: availability === "ok" ? found!.value : null,
      rag: availability === "ok" && found!.value != null ? ragFor(found!.value, m.target, m.direction) : null,
      trend: trendByCode.get(m.kpiMetricCode) ?? [],
      note: availability === "no_data"
        ? "kpi_daily_actual has no rows for this process/window yet -- the pipeline exists, nothing has landed here."
        : undefined,
    };
  });
}

export interface KpiDetailRecord {
  id: string;
  name: string;
  subtitle: string | null;
  value: number | null;
  drillAs: "team_leader" | "employee" | null;
}

export interface KpiMetricDetail {
  metricKey: string;
  label: string;
  availability: Availability;
  unit: KpiUnit;
  trend: Array<{ period: string; value: number | null }>;
  recordsLabel: string;
  records: KpiDetailRecord[];
  note?: string;
}

/**
 * Level 2 (by TL pod), level 3 (by agent) and level 4 (raw ledger rows), on top
 * of the level-1 trend the scorecard already carries. `teamLeaderId`/`employeeId`
 * walk one level deeper each, mirroring getMetricDetail's stack contract in
 * process-performance.service.ts -- the frontend detail panel is a variant of
 * KpiCellDetail.tsx and expects the same shape.
 */
export async function getKpiMetricDetail(
  userId: string, processCode: string, metricKey: string, filters: KpiFilters,
  teamLeaderId: string | null, employeeId: string | null,
): Promise<KpiMetricDetail | null> {
  const def = findMetricDef(processCode, metricKey);
  if (!def) return null;
  const label = def.label;
  const base: KpiMetricDetail = {
    metricKey, label, availability: "not_tracked", unit: def.unit,
    trend: [], recordsLabel: "Team leaders", records: [], note: def.notTrackedNote,
  };

  if (def.cdrSource) {
    // Scope check first -- same boundary the kpi_daily_actual path enforces,
    // even though the campaign query itself doesn't need a processId.
    const scopedProcessId = await resolveProcessId(userId, processCode);
    if (!scopedProcessId) return { ...base, availability: "no_data", note: "This process is outside your scope or has no id on file." };
    return getCdrMetricDetail(def.cdrSource, metricKey, label, def.unit, filters, employeeId);
  }

  if (!def.kpiMetricCode) return base;

  const processId = await resolveProcessId(userId, processCode);
  if (!processId) return { ...base, availability: "no_data", note: "This process is outside your scope or has no id on file." };

  const scope = await kpiScope(userId);
  const agg = aggExprFor(def.family);
  // `employees e` is always joined -- both for the scope predicate's
  // reporting_manager_id alias, and because "team leader" here means "this
  // person's current reporting manager" (team_leader_id_at_event is dead, see
  // kpiScope's comment), so team-pod narrowing filters e.reporting_manager_id.
  const narrowSql: string[] = ["k.process_id_at_event = ?"];
  const narrowParams: unknown[] = [processId];
  if (teamLeaderId) { narrowSql.push("e.reporting_manager_id = ?"); narrowParams.push(teamLeaderId); }
  if (employeeId) { narrowSql.push("k.employee_id = ?"); narrowParams.push(employeeId); }

  const joinSql = `FROM kpi_daily_actual k
     JOIN kpi_metric_master m ON m.id = k.metric_id AND m.metric_code = ?
     JOIN employees e ON e.id = k.employee_id
    WHERE k.score_date BETWEEN ? AND ? AND ${narrowSql.join(" AND ")} AND (${scope.sql})`;
  const joinParams = [def.kpiMetricCode, filters.from, filters.to, ...narrowParams, ...scope.params];

  const [tr] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(k.score_date, '%Y-%m') AS period, ${agg} AS value ${joinSql}
      GROUP BY period ORDER BY period ASC`,
    joinParams,
  );

  // Leaf level: the raw ledger behind the leftmost drilled-into employee.
  if (employeeId) {
    const [recs] = await db.execute<RowDataPacket[]>(
      `SELECT k.id, k.score_date, k.actual_value, k.source, k.source_system ${joinSql}
        ORDER BY k.score_date DESC LIMIT 200`,
      joinParams,
    );
    return {
      metricKey, label, unit: def.unit,
      availability: tr.length || recs.length ? "ok" : "no_data",
      trend: tr.map((r) => ({ period: String(r.period), value: r.value == null ? null : Number(r.value) })),
      recordsLabel: "Recorded entries",
      records: recs.map((r) => ({
        id: String(r.id),
        name: String(r.score_date),
        subtitle: `${r.source ?? "unknown"}${r.source_system ? ` · ${r.source_system}` : ""}`,
        value: r.actual_value == null ? null : Number(r.actual_value),
        drillAs: null,
      })),
      note: tr.length || recs.length ? undefined : "No records in this window for this employee.",
    };
  }

  // Level 2 (grouped by each agent's current reporting manager -- the "TL pod")
  // or level 3 (grouped by agent, within one already-chosen manager). `e` is
  // the agent row (already joined in joinSql); the manager's own name needs a
  // second, separate join to `employees` since a manager is also a row in the
  // same table.
  const groupCol = teamLeaderId ? "e.id" : "e.reporting_manager_id";
  const nameCol = teamLeaderId ? "e.full_name" : "tl.full_name";
  const subCol = teamLeaderId ? "e.employee_code" : "tl.employee_code";
  const managerJoin = teamLeaderId ? "" : "LEFT JOIN employees tl ON tl.id = e.reporting_manager_id";
  const [recs] = await db.execute<RowDataPacket[]>(
    `SELECT ${groupCol} AS id, ${nameCol} AS name, ${subCol} AS subtitle, ${agg} AS value
       ${joinSql.replace("JOIN employees e ON e.id = k.employee_id", `JOIN employees e ON e.id = k.employee_id ${managerJoin}`)}
        AND ${groupCol} IS NOT NULL
      GROUP BY id, name, subtitle
      ORDER BY value ${def.direction === "higher_is_better" ? "ASC" : "DESC"}
      LIMIT 100`,
    joinParams,
  );

  return {
    metricKey, label, unit: def.unit,
    availability: tr.length || recs.length ? "ok" : "no_data",
    trend: tr.map((r) => ({ period: String(r.period), value: r.value == null ? null : Number(r.value) })),
    recordsLabel: teamLeaderId ? "Agents (worst first)" : "TL pods (worst first)",
    records: recs.map((r) => ({
      id: String(r.id),
      name: String(r.name ?? "Unassigned"),
      subtitle: r.subtitle ? String(r.subtitle) : null,
      value: r.value == null ? null : Number(r.value),
      drillAs: teamLeaderId ? "employee" : "team_leader",
    })),
    note: tr.length || recs.length ? undefined : "No rows in this window at this level.",
  };
}

/**
 * CDR-sourced drilldown (dialer_db) -- two real levels, honestly shorter than
 * the kpi_daily_actual path's three: by agent (as dialer_db names them, no
 * fabricated TL layer -- see kpi-cdr-source.ts's header comment), then that
 * agent's raw calls. `employeeId` here is a dialer AgentId string (e.g.
 * 'MAS60390'), passed straight through by KpiScorecardDetail.tsx's existing
 * drillAs:"employee" contract -- no frontend change needed.
 */
async function getCdrMetricDetail(
  source: import("./kpi-metric-registry.js").KpiCdrSource,
  metricKey: string, label: string, unit: KpiUnit, filters: KpiFilters, agentId: string | null,
): Promise<KpiMetricDetail> {
  const overall = await resolveCdrScorecard(source, source.field, filters.from, filters.to);

  if (agentId) {
    const calls = await getCdrAgentCalls(source, agentId, filters.from, filters.to);
    return {
      metricKey, label, unit,
      availability: calls.length ? "ok" : "no_data",
      trend: overall.trend,
      recordsLabel: "Calls",
      records: calls.map((c) => ({
        id: String(c.id),
        name: new Date(c.CallDate).toLocaleString("en-IN"),
        subtitle: `${c.Disposition ?? "—"} · ${c.DisconnBy ?? "—"} · queue ${c.QueueDuration ?? "0"}`,
        value: c.CallDurationSecond == null ? null : Number(c.CallDurationSecond),
        drillAs: null,
      })),
      note: calls.length ? undefined : "No calls recorded for this agent in this window.",
    };
  }

  const agents = await getCdrAgentBreakdown(source, source.field, filters.from, filters.to);
  return {
    metricKey, label, unit,
    availability: agents.length ? "ok" : "no_data",
    trend: overall.trend,
    recordsLabel: "Agents",
    records: agents.map((a) => ({
      id: a.agentId,
      name: a.agentName,
      subtitle: `${a.offered} calls`,
      value: a.value,
      drillAs: "employee",
    })),
    note: agents.length ? undefined : "No calls recorded on this campaign for this window.",
  };
}
