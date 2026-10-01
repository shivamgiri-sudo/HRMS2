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
import { addDays, loadSnapshot, today, type SnapshotPerson } from "./attrition-hub.data.js";

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

export function getPopulation(): Promise<Population> {
  if (popCache && Date.now() - popCache.at < POP_TTL) return popCache.p;
  const p = (async () => {
    const asOf = today();
    const snap = await loadSnapshot(asOf, { live: true });
    const people: ScoredPerson[] = snap.people.map((s) => {
      const sc = scoreFeatures(s.features);
      return { ...s, score: sc.score, tier: sc.tier, factors: sc.factors, reasons: sc.reasons, inNotice: snap.inNotice.has(s.id) };
    });
    return { asOf, people, degraded: snap.degraded, builtAt: Date.now() };
  })();
  popCache = { at: Date.now(), p };
  p.catch(() => { if (popCache?.p === p) popCache = null; });
  return p;
}

/* ── backtest ── */
export interface Model {
  computedAt: string; cohortDates: string[]; population: number; leavers: number; baseRatePct: number;
  auc: number | null; gain: { popPct: number; leaverPct: number }[];
  calibration: { tier: Tier; n: number; leavers: number; observedRatePct: number | null }[];
  drivers: { group: FactorGroup; label: string; avgPointsLeavers: number; avgPointsStayers: number }[];
  limits: string[];
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
    limits: [
      "Tested on past snapshots, using only signals that have history: tenure, attendance, leave, regularisation, warnings, increments, pay and the manager's team losses.",
      "KPI score, call quality, PIP and profile gaps are scored for today's people but cannot be replayed into the past, so they are not part of this test.",
      "Each past date asks: of everyone employed then, who left in the next 30 days? Pooled across the dates shown, so one person can appear more than once.",
      "Exit dates come from the employee record. Leavers with no exit date cannot be placed in time and are left out.",
      `A tier with fewer than ${MIN_TIER_SAMPLE} past people borrows the rate of the tier below it, and a riskier tier is never shown safer than a calmer one.`,
    ],
  };
}

export function getModel(): Promise<Model> {
  if (modelCache && Date.now() - modelCache.at < MODEL_TTL) return modelCache.p;
  const p = (async () => {
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
    return buildModel(cohorts);
  })();
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
  id: string; joinDate: string; exitDate: string; tenureDays: number; source: string | null;
  branchId: string | null; branch: string | null; processId: string | null; process: string | null;
  managerId: string | null; manager: string | null; designationId: string | null; designation: string | null;
  reason: string | null; exitType: string | null;
}

export async function loadExits(viewer: Viewer, sinceDays = 400): Promise<{ exits: ExitRow[]; headcountEvents: { join: string; exit: string | null; source: string | null }[] }> {
  const scope = await resolveUserBusinessScope(viewer);
  const cond = buildEmployeeScopeCondition(scope, {
    employeeId: "e.id", branchId: "e.branch_id", processId: "e.process_id", lobId: "e.lob_id",
    departmentId: "e.department_id", managerEmployeeId: "e.reporting_manager_id",
  });
  const me = cond.sql === "1=1" ? null : await getEmployeeForUser(viewer.id);
  const span = me?.id ? spanClauseFor(String(me.id), "e") : null;
  const sql = cond.sql === "1=1" ? "1=1" : span ? `((${cond.sql}) OR ${span.sql})` : `(${cond.sql})`;
  const params = cond.sql === "1=1" ? [] : span ? [...cond.params, ...span.params] : cond.params;
  const since = addDays(today(), -sinceDays);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, DATE_FORMAT(COALESCE(e.salary_start_date, e.date_of_joining), '%Y-%m-%d') AS join_date,
            DATE_FORMAT(e.date_of_exit, '%Y-%m-%d') AS exit_date, e.source,
            e.branch_id, b.branch_name, e.process_id, p.process_name,
            e.reporting_manager_id, COALESCE(NULLIF(TRIM(m.full_name),''), TRIM(CONCAT(m.first_name,' ',COALESCE(m.last_name,'')))) AS manager_name,
            e.designation_id, d.designation_name,
            (SELECT COALESCE(NULLIF(TRIM(er.exit_reason_category),''), NULLIF(TRIM(er.resignation_reason),''))
               FROM exit_request er WHERE er.employee_id = e.id ORDER BY er.created_at DESC LIMIT 1) AS reason,
            (SELECT er.exit_type FROM exit_request er WHERE er.employee_id = e.id ORDER BY er.created_at DESC LIMIT 1) AS exit_type
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN employees m ON m.id = e.reporting_manager_id
      WHERE ${sql}
        AND e.date_of_joining IS NOT NULL
        AND ((e.date_of_exit IS NOT NULL AND e.date_of_exit >= e.date_of_joining AND e.date_of_exit >= ?)
             OR (e.date_of_exit IS NULL AND e.employment_status = 'Active' AND e.active_status = 1))`,
    [...params, since] as never[],
  );
  const exits: ExitRow[] = [];
  const headcountEvents: { join: string; exit: string | null; source: string | null }[] = [];
  for (const r of rows) {
    headcountEvents.push({ join: String(r.join_date), exit: r.exit_date ?? null, source: r.source ?? null });
    if (!r.exit_date) continue;
    const tenureDays = Math.round((new Date(`${r.exit_date}T00:00:00`).getTime() - new Date(`${r.join_date}T00:00:00`).getTime()) / 86_400_000);
    exits.push({
      id: String(r.id), joinDate: String(r.join_date), exitDate: String(r.exit_date), tenureDays, source: r.source ?? null,
      branchId: r.branch_id ?? null, branch: r.branch_name ?? null, processId: r.process_id ?? null, process: r.process_name ?? null,
      managerId: r.reporting_manager_id ?? null, manager: r.manager_name ?? null, designationId: r.designation_id ?? null, designation: r.designation_name ?? null,
      reason: r.reason ?? null, exitType: r.exit_type ?? null,
    });
  }
  return { exits, headcountEvents };
}

export const bucketOf = (days: number): "0-30" | "31-60" | "61-90" | "90+" =>
  days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";

export { FACTOR_CAPS, FACTOR_LABELS, FACTOR_GROUP_ORDER, suggestActions };
