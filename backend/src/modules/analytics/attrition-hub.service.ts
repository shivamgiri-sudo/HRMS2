/**
 * Attrition hub - the numbers behind the AON & Attrition page: live risk scoring, the 30-day
 * backtest that calibrates it, alerts, and the exit insights.
 *
 * Two layers of cache, both in memory: the scored population (10 min) and the backtest (6 h).
 * Both are org-wide; every response is then narrowed to the caller's own scope, so a branch HR
 * or a team lead only ever receives their people.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { resolveUserBusinessScope, buildEmployeeScopeCondition } from "../../shared/enterpriseScope.js";
import { spanClauseFor } from "../../shared/reportingSpan.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import {
  FACTOR_CAPS, FACTOR_GROUP_ORDER, FACTOR_LABELS, aucOf, gainCurve, scoreFeatures, suggestActions, tierOf,
  type FactorGroup, type Reason, type Tier,
} from "./attrition-model.js";
import { addDays, loadSnapshot, setQualityListener, today, type SnapshotPerson } from "./attrition-hub.data.js";
import { canonicalReason, normaliseLeavingReason } from "./leaving-reason.js";

export const TIERS: Tier[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const MIN_TIER_SAMPLE = 30;

export interface ScoredPerson extends SnapshotPerson {
  score: number; tier: Tier; factors: Record<FactorGroup, number>; reasons: Reason[]; inNotice: boolean;
}
interface Population { asOf: string; people: ScoredPerson[]; degraded: string[]; builtAt: number }

/* ── caches ── */
let popCache: { at: number; p: Promise<Population> } | null = null;
let modelCache: { at: number; p: Promise<Model> } | null = null;
const POP_TTL = 10 * 60_000, MODEL_TTL = 6 * 3_600_000;

export function clearAttritionHubCache() { popCache = null; modelCache = null; }

async function buildPopulation(): Promise<Population> {
  const asOf = today();
  const t0 = Date.now();
  const snap = await loadSnapshot(asOf, { live: true });
  console.log(`[attrition-hub] population built: ${snap.people.length} people in ${Date.now() - t0} ms, degraded=[${snap.degraded.join(",")}]`);
  const people: ScoredPerson[] = snap.people.map((s) => {
    const sc = scoreFeatures(s.features);
    return { ...s, score: sc.score, tier: sc.tier, factors: sc.factors, reasons: sc.reasons, inNotice: snap.inNotice.has(s.id) };
  });
  return { asOf, people, degraded: snap.degraded, builtAt: Date.now() };
}

/**
 * Stale-while-revalidate: once a population exists it is always served instantly; an expired one
 * is rebuilt in the background. Only the very first caller after a restart waits for a build.
 */
export function getPopulation(): Promise<Population> {
  if (popCache) {
    if (Date.now() - popCache.at >= POP_TTL && !popRefreshing) {
      popRefreshing = true;
      buildPopulation()
        .then((fresh) => { popCache = { at: Date.now(), p: Promise.resolve(fresh) }; })
        .catch((e) => console.error("[attrition-hub] population refresh failed:", e instanceof Error ? e.message : e))
        .finally(() => { popRefreshing = false; });
    }
    return popCache.p;
  }
  const p = buildPopulation();
  popCache = { at: Date.now(), p };
  p.catch(() => { if (popCache?.p === p) popCache = null; });
  return p;
}
let popRefreshing = false;
// when call quality first becomes available, rebuild so scores include it
setQualityListener(() => { if (popCache) popCache = { ...popCache, at: 0 }; });

/* ── backtest ── */
export interface Model {
  computedAt: string; cohortDates: string[]; population: number; leavers: number; baseRatePct: number;
  auc: number | null; gain: { popPct: number; leaverPct: number }[];
  calibration: { tier: Tier; n: number; leavers: number; observedRatePct: number | null }[];
  drivers: { group: FactorGroup; label: string; avgPointsLeavers: number; avgPointsStayers: number }[];
  limits: string[];
  history: { date: string; auc: number | null; baseRatePct: number; criticalRatePct: number | null; highRatePct: number | null; population: number; leavers: number }[];
}

/**
 * Observed 30-day exit rate per tier, made trustworthy in two steps: a tier with fewer than
 * MIN_TIER_SAMPLE past people borrows from the next tier down (pooled), then the rates are forced
 * to never rise as risk falls (pool-adjacent-violators), so "critical" can never read safer than "high".
 */
export function calibrate(rows: { score: number; leaver: boolean }[]): Model["calibration"] {
  const raw = TIERS.map((tier) => {
    const t = rows.filter((r) => tierOf(r.score) === tier);
    return { tier, n: t.length, leavers: t.filter((r) => r.leaver).length };
  });
  type Block = { tiers: Tier[]; n: number; l: number };
  let blocks: Block[] = [];
  let cur: Block | null = null;
  for (const r of raw) {
    cur = cur ?? { tiers: [], n: 0, l: 0 };
    cur.tiers.push(r.tier); cur.n += r.n; cur.l += r.leavers;
    if (cur.n >= MIN_TIER_SAMPLE) { blocks.push(cur); cur = null; }
  }
  if (cur) blocks.push(cur); // a thin tail stays on its own and reads "not enough history"; it must not skew a solid block
  // risk must not fall as the tier gets riskier: merge any block that is safer than the one below it
  for (let i = 0; i < blocks.length - 1; ) {
    const solid = blocks[i].n >= MIN_TIER_SAMPLE && blocks[i + 1].n >= MIN_TIER_SAMPLE;
    if (solid && blocks[i].l / blocks[i].n < blocks[i + 1].l / blocks[i + 1].n) {
      blocks[i] = { tiers: [...blocks[i].tiers, ...blocks[i + 1].tiers], n: blocks[i].n + blocks[i + 1].n, l: blocks[i].l + blocks[i + 1].l };
      blocks.splice(i + 1, 1);
      i = Math.max(0, i - 1);
    } else i++;
  }
  const rate = new Map<Tier, number | null>();
  for (const b of blocks) for (const t of b.tiers) rate.set(t, b.n >= MIN_TIER_SAMPLE ? Math.round((b.l / b.n) * 1000) / 10 : null);
  return raw.map((r) => ({ ...r, observedRatePct: rate.get(r.tier) ?? null }));
}

export function buildModel(
  cohorts: { date: string; rows: { score: number; leaver: boolean; factors: Record<FactorGroup, number> }[] }[],
): Model {
  const rows = cohorts.flatMap((c) => c.rows);
  const leavers = rows.filter((r) => r.leaver);
  const stayers = rows.filter((r) => !r.leaver);
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);
  return {
    computedAt: new Date().toISOString(),
    cohortDates: cohorts.map((c) => c.date),
    population: rows.length,
    leavers: leavers.length,
    baseRatePct: rows.length ? Math.round((leavers.length / rows.length) * 1000) / 10 : 0,
    auc: aucOf(rows),
    gain: gainCurve(rows),
    calibration: calibrate(rows),
    drivers: FACTOR_GROUP_ORDER.map((g) => ({
      group: g, label: FACTOR_LABELS[g],
      avgPointsLeavers: avg(leavers.map((r) => r.factors[g])), avgPointsStayers: avg(stayers.map((r) => r.factors[g])),
    })),
    history: [],
    limits: [
      "Tested on past snapshots, using only signals that have history: tenure, attendance, leave, regularisation, warnings, increments, pay and the manager's team losses.",
      "KPI score, call quality, PIP and profile gaps are scored for today's people but cannot be replayed into the past, so they are not part of this test.",
      "Each past date asks: of everyone employed then, who left in the next 30 days? Pooled across the dates shown, so one person can appear more than once.",
      "Exit dates come from the employee record. Leavers with no exit date cannot be placed in time and are left out.",
      `A tier with fewer than ${MIN_TIER_SAMPLE} past people borrows the rate of the tier below it, and a riskier tier is never shown safer than a calmer one.`,
    ],
  };
}

async function computeModel(): Promise<Model> {
  const t = today();
  const dates = [addDays(t, -90), addDays(t, -60), addDays(t, -30)];
  const cohorts: Parameters<typeof buildModel>[0] = [];
  for (const date of dates) {
    const snap = await loadSnapshot(date, { live: false });
    const end = addDays(date, 30);
    cohorts.push({
      date,
      rows: snap.people.map((s) => {
        const sc = scoreFeatures(s.features);
        return { score: sc.score, factors: sc.factors, leaver: !!s.exitDate && s.exitDate > date && s.exitDate <= end };
      }),
    });
  }
  const model = buildModel(cohorts);
  await saveModelSnapshot(model);
  model.history = await loadModelHistory();
  return model;
}

/** One row a day, so quality can be charted over time. Quietly skipped until migration 1989 exists. */
async function saveModelSnapshot(m: Model) {
  try {
    await db.execute(
      `INSERT INTO attrition_model_snapshot (snapshot_date, auc, base_rate_pct, population, leavers, calibration_json)
       VALUES (CURDATE(), ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE auc = VALUES(auc), base_rate_pct = VALUES(base_rate_pct), population = VALUES(population), leavers = VALUES(leavers), calibration_json = VALUES(calibration_json)`,
      [m.auc == null ? null : Math.round(m.auc * 10000) / 10000, m.baseRatePct, m.population, m.leavers, JSON.stringify(m.calibration)] as never[]);
  } catch (err) { console.error("[attrition-hub] model snapshot not saved:", err instanceof Error ? err.message : err); }
}
/** The last calibration we saved, so a restart never leaves the page without one while today's test re-runs. */
export async function loadSnapshotModel(): Promise<Model | null> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(snapshot_date, '%Y-%m-%d') AS d, auc, base_rate_pct, population, leavers, calibration_json
         FROM attrition_model_snapshot ORDER BY snapshot_date DESC LIMIT 1`);
    const r = rows[0];
    if (!r) return null;
    const calibration = JSON.parse(String(r.calibration_json ?? "[]")) as Model["calibration"];
    if (!calibration.length) return null;
    return {
      computedAt: String(r.d), cohortDates: [], population: Number(r.population), leavers: Number(r.leavers), baseRatePct: Number(r.base_rate_pct),
      auc: r.auc == null ? null : Number(r.auc), gain: [], calibration, drivers: [], history: [],
      limits: [`Showing the calibration saved on ${r.d} while today's test refreshes in the background.`],
    };
  } catch { return null; }
}

export async function loadModelHistory(): Promise<Model["history"]> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(snapshot_date, '%Y-%m-%d') AS d, auc, base_rate_pct, population, leavers, calibration_json
         FROM attrition_model_snapshot ORDER BY snapshot_date DESC LIMIT 60`);
    return rows.reverse().map((r) => {
      let cal: { tier: string; observedRatePct: number | null }[] = [];
      try { cal = JSON.parse(String(r.calibration_json ?? "[]")); } catch { /* keep empty */ }
      const rate = (t: string) => cal.find((c) => c.tier === t)?.observedRatePct ?? null;
      return { date: String(r.d), auc: r.auc == null ? null : Number(r.auc), baseRatePct: Number(r.base_rate_pct), criticalRatePct: rate("CRITICAL"), highRatePct: rate("HIGH"), population: Number(r.population), leavers: Number(r.leavers) };
    });
  } catch { return []; }
}

let modelRefreshing = false;
export function getModel(): Promise<Model> {
  if (modelCache) {
    if (Date.now() - modelCache.at >= MODEL_TTL && !modelRefreshing) {
      modelRefreshing = true;
      computeModel()
        .then((fresh) => { modelCache = { at: Date.now(), p: Promise.resolve(fresh) }; })
        .catch((e) => console.error("[attrition-hub] model refresh failed:", e instanceof Error ? e.message : e))
        .finally(() => { modelRefreshing = false; });
    }
    return modelCache.p;
  }
  const p = computeModel();
  modelCache = { at: Date.now(), p };
  p.catch(() => { if (modelCache?.p === p) modelCache = null; });
  return p;
}

/** Calibrated 30-day probability for a tier; null when the past has too few people in that tier. */
export function probabilityFor(model: Model, tier: Tier): number | null {
  const c = model.calibration.find((x) => x.tier === tier);
  return c?.observedRatePct == null ? null : c.observedRatePct / 100;
}

/* ── scope ── */
export interface Viewer { id: string }
/** Active employees the caller may see: their business scope plus their own reporting span. */
export async function scopedIds(viewer: Viewer): Promise<Set<string> | null> {
  const scope = await resolveUserBusinessScope(viewer);
  const cond = buildEmployeeScopeCondition(scope, {
    employeeId: "e.id", branchId: "e.branch_id", processId: "e.process_id", lobId: "e.lob_id",
    departmentId: "e.department_id", managerEmployeeId: "e.reporting_manager_id",
  });
  if (cond.sql === "1=1") return null;
  const me = await getEmployeeForUser(viewer.id);
  const span = me?.id ? spanClauseFor(String(me.id), "e") : null;
  const sql = span ? `(${cond.sql}) OR ${span.sql}` : cond.sql;
  const params = span ? [...cond.params, ...span.params] : cond.params;
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT e.id FROM employees e WHERE e.active_status = 1 AND (${sql})`, params as never[]);
  return new Set(rows.map((r) => String(r.id)));
}

export async function scopedPopulation(viewer: Viewer) {
  const [pop, ids] = await Promise.all([getPopulation(), scopedIds(viewer)]);
  const people = ids ? pop.people.filter((p) => ids.has(p.id)) : pop.people;
  return { asOf: pop.asOf, people, degraded: pop.degraded, orgWide: ids === null };
}

/* ── exits dataset (scoped), shared by overview / insights / alerts ── */
export interface ExitRow {
  reasonSource?: "exit_record" | "legacy" | null;
  id: string; code?: string; name?: string; joinDate: string; exitDate: string; tenureDays: number; source: string | null;
  branchId: string | null; branch: string | null; processId: string | null; process: string | null;
  managerId: string | null; manager: string | null; designationId: string | null; designation: string | null;
  reason: string | null; exitType: string | null;
}

const exitsCache = new Map<string, { at: number; p: Promise<ExitsData> }>();
const EXITS_TTL = 10 * 60_000;
/** Everyone who is employed or left in the window - the base for headcount, batches, hiring quality and drill-downs. */
export interface EmpEvent {
  id: string; code: string; name: string; join: string; exit: string | null; source: string | null;
  branchId: string | null; branch: string | null; processId: string | null; process: string | null;
  managerId: string | null; manager: string | null; designationId: string | null; designation: string | null;
  reason: string | null; exitType: string | null;
  /** where the reason came from: the exit record, the legacy HRMS leaving reason (db_bill), or nowhere */
  reasonSource?: "exit_record" | "legacy" | null;
}
export interface NoticeExit { employeeId: string; branchId: string | null; branch: string | null; processId: string | null; process: string | null; lwd: string }
export interface PlannedJoiner { branchId: string | null; branch: string | null; processId: string | null; process: string | null }
export interface ExitsData { exits: ExitRow[]; headcountEvents: EmpEvent[]; notice: NoticeExit[]; planned: PlannedJoiner[] }

/** Cached per scope (not per person): everyone who sees the same people shares one load. */
export async function loadExits(viewer: Viewer, sinceDays = 400): Promise<ExitsData> {
  const scope = await resolveUserBusinessScope(viewer);
  const cond = buildEmployeeScopeCondition(scope, {
    employeeId: "e.id", branchId: "e.branch_id", processId: "e.process_id", lobId: "e.lob_id",
    departmentId: "e.department_id", managerEmployeeId: "e.reporting_manager_id",
  });
  const me = cond.sql === "1=1" ? null : await getEmployeeForUser(viewer.id);
  const span = me?.id ? spanClauseFor(String(me.id), "e") : null;
  const sql = cond.sql === "1=1" ? "1=1" : span ? `((${cond.sql}) OR ${span.sql})` : `(${cond.sql})`;
  const params = cond.sql === "1=1" ? [] : span ? [...cond.params, ...span.params] : cond.params;
  const key = JSON.stringify([sql, params, sinceDays, today()]);
  const hit = exitsCache.get(key);
  if (hit && Date.now() - hit.at < EXITS_TTL) return hit.p;
  const p = queryExits(sql, params, sinceDays);
  exitsCache.set(key, { at: Date.now(), p });
  p.catch(() => exitsCache.delete(key));
  if (exitsCache.size > 200) for (const k of exitsCache.keys()) { if (Date.now() - exitsCache.get(k)!.at >= EXITS_TTL) exitsCache.delete(k); }
  return p;
}

/**
 * The legacy HRMS leaving reason (employee_legacy_meta.left_reason, backfilled from db_bill's LeftReason).
 * Used only for people who left and have no reason on an exit record: 2,499 of the 2,500 last-12-month
 * exits with none had one here. Read in id chunks instead of joined so a collation difference between the
 * two tables can never break the page.
 */
async function loadLegacyLeavingReasons(ids: string[]): Promise<Map<string, { category: string; exitType: "voluntary" | "involuntary" | null }>> {
  const out = new Map<string, { category: string; exitType: "voluntary" | "involuntary" | null }>();
  try {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT employee_id, left_reason FROM employee_legacy_meta
          WHERE left_reason IS NOT NULL AND TRIM(left_reason) <> '' AND employee_id IN (${chunk.map(() => "?").join(",")})`, chunk as never[]);
      for (const r of rows) {
        const n = normaliseLeavingReason(String(r.left_reason));
        if (n && !out.has(String(r.employee_id))) out.set(String(r.employee_id), n);
      }
    }
  } catch (err) { console.error("[attrition-hub] legacy leaving reasons unavailable:", err instanceof Error ? err.message : err); }
  return out;
}

async function queryExits(sql: string, params: unknown[], sinceDays: number): Promise<ExitsData> {
  const t0 = Date.now();
  const todayStr = today();
  const since = addDays(todayStr, -sinceDays);
  // Latest exit_request per employee in ONE pass (a correlated subquery per row was the slow part).
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS emp_name,
            DATE_FORMAT(COALESCE(e.salary_start_date, e.date_of_joining), '%Y-%m-%d') AS join_date,
            DATE_FORMAT(e.date_of_exit, '%Y-%m-%d') AS exit_date, e.source,
            e.branch_id, b.branch_name, e.process_id, p.process_name,
            e.reporting_manager_id, COALESCE(NULLIF(TRIM(m.full_name),''), TRIM(CONCAT(m.first_name,' ',COALESCE(m.last_name,'')))) AS manager_name,
            e.designation_id, d.designation_name, x.reason, x.exit_type
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN employees m ON m.id = e.reporting_manager_id
       LEFT JOIN (
         SELECT er.employee_id,
                MAX(COALESCE(NULLIF(TRIM(er.exit_reason_category),''), NULLIF(TRIM(er.resignation_reason),''))) AS reason,
                MAX(er.exit_type) AS exit_type
           FROM exit_request er
           JOIN (SELECT employee_id, MAX(created_at) AS mc FROM exit_request GROUP BY employee_id) l
             ON l.employee_id = er.employee_id AND l.mc = er.created_at
          GROUP BY er.employee_id
       ) x ON x.employee_id = e.id
      WHERE ${sql}
        AND e.date_of_joining IS NOT NULL
        AND ((e.date_of_exit IS NOT NULL AND e.date_of_exit >= e.date_of_joining AND e.date_of_exit >= ?)
             OR (e.date_of_exit IS NULL AND e.employment_status = 'Active' AND e.active_status = 1))`,
    [...params, since] as never[],
  );
  console.log(`[attrition-hub] exits loaded: ${rows.length} rows in ${Date.now() - t0} ms`);
  const legacy = await loadLegacyLeavingReasons(rows.filter((r) => r.exit_date && !r.reason).map((r) => String(r.id)));
  const exits: ExitRow[] = [];
  const headcountEvents: EmpEvent[] = [];
  for (const r of rows) {
    const join = String(r.join_date);
    if (join > todayStr) continue; // not employed yet: counted as a planned joiner below, not as headcount
    const exit = r.exit_date ?? null;
    const ev: EmpEvent = {
      id: String(r.id), code: String(r.employee_code ?? ""), name: String(r.emp_name ?? "").trim() || String(r.employee_code ?? ""),
      join, exit, source: r.source ?? null,
      branchId: r.branch_id ?? null, branch: r.branch_name ?? null, processId: r.process_id ?? null, process: r.process_name ?? null,
      managerId: r.reporting_manager_id ?? null, manager: r.manager_name ?? null, designationId: r.designation_id ?? null, designation: r.designation_name ?? null,
      reason: canonicalReason(r.reason), exitType: r.exit_type ?? null, reasonSource: r.reason ? "exit_record" : null,
    };
    if (exit && !ev.reason) {
      const l = legacy.get(ev.id);
      if (l) { ev.reason = l.category; ev.reasonSource = "legacy"; if (!ev.exitType && l.exitType) ev.exitType = l.exitType; }
    }
    headcountEvents.push(ev);
    if (!exit) continue;
    const tenureDays = Math.round((new Date(`${exit}T00:00:00`).getTime() - new Date(`${join}T00:00:00`).getTime()) / 86_400_000);
    exits.push({
      id: ev.id, code: ev.code, name: ev.name, joinDate: join, exitDate: exit, tenureDays, source: ev.source,
      branchId: ev.branchId, branch: ev.branch, processId: ev.processId, process: ev.process,
      managerId: ev.managerId, manager: ev.manager, designationId: ev.designationId, designation: ev.designation,
      reason: ev.reason, exitType: ev.exitType, reasonSource: ev.reasonSource,
    });
  }

  // Next-30-day inputs. Each is optional: the outlook just shows what it could find.
  const horizon = addDays(todayStr, 30);
  let notice: NoticeExit[] = [];
  let planned: PlannedJoiner[] = [];
  try {
    const [nr] = await db.execute<RowDataPacket[]>(
      `SELECT e.id AS employee_id, e.branch_id, b.branch_name, e.process_id, p.process_name,
              DATE_FORMAT(COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed, CURDATE()), '%Y-%m-%d') AS lwd
         FROM exit_request er
         JOIN employees e ON e.id = er.employee_id
         LEFT JOIN branch_master b ON b.id = e.branch_id
         LEFT JOIN process_master p ON p.id = e.process_id
        WHERE ${sql}
          AND er.status NOT IN ('rejected','revoked','exited','withdrawn','cancelled')
          AND e.active_status = 1
          AND COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed, CURDATE()) <= ?`,
      [...params, horizon] as never[],
    );
    notice = nr.map((r) => ({ employeeId: String(r.employee_id), branchId: r.branch_id ?? null, branch: r.branch_name ?? null, processId: r.process_id ?? null, process: r.process_name ?? null, lwd: String(r.lwd) }));
  } catch (err) { console.error("[attrition-hub] notice exits unavailable:", err instanceof Error ? err.message : err); }
  try {
    const [pr] = await db.execute<RowDataPacket[]>(
      `SELECT e.branch_id, b.branch_name, e.process_id, p.process_name
         FROM employees e
         LEFT JOIN branch_master b ON b.id = e.branch_id
         LEFT JOIN process_master p ON p.id = e.process_id
        WHERE ${sql} AND e.active_status = 1 AND e.date_of_exit IS NULL
          AND e.date_of_joining > ? AND e.date_of_joining <= ?`,
      [...params, todayStr, horizon] as never[],
    );
    planned = pr.map((r) => ({ branchId: r.branch_id ?? null, branch: r.branch_name ?? null, processId: r.process_id ?? null, process: r.process_name ?? null }));
  } catch (err) { console.error("[attrition-hub] planned joiners unavailable:", err instanceof Error ? err.message : err); }
  return { exits, headcountEvents, notice, planned };
}

export const bucketOf = (days: number): "0-30" | "31-60" | "61-90" | "90+" =>
  days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";

export { FACTOR_CAPS, FACTOR_LABELS, FACTOR_GROUP_ORDER, suggestActions };
