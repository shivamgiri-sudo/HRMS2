import { rows } from "../helpers.js";
import type { InsightContext } from "../types.js";
import { excludeEmployeeShapedCandidatesSql, excludeOtherEntityCandidatesSql } from "../../../ats/ats-reporting-scope.js";
import { branchNameVariants } from "../../../ats/ats-vocabulary.js";
import { buildScopeWhere } from "../../../../shared/dashboardScope.js";
import { addDays, type CohortCandidate, type OfferRow, type ReqRow } from "./recruiterLogic.js";

/** Cohort window: 60 days so the funnel has a previous 30-day comparison period. */
export const COHORT_DAYS = 60;

const ymd = (v: unknown): string | null => (v ? String(v).slice(0, 10) : null);
const placeholders = (n: number) => Array(n).fill("?").join(",");

async function namesFor(table: "branch_master" | "process_master", col: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const r = await rows(`SELECT ${col} AS n FROM ${table} WHERE id IN (${placeholders(ids.length)})`, ids);
  return r.map((x) => String(x.n ?? "").trim()).filter(Boolean);
}

/**
 * ats_candidate stores the branch/process a candidate APPLIED FOR as free-text names, so the
 * caller's id-based scope has to be resolved to names (branch aliases included). An unresolvable
 * scope narrows to nothing, never widens. `alias` is the ats_candidate alias in the query.
 */
export async function candidateScope(ctx: InsightContext, alias = "c"): Promise<{ sql: string; params: string[] }> {
  const { scope } = ctx;
  let branchIds = [...scope.branchIds];
  let processIds = [...scope.processIds];
  const narrow = (asked: string | undefined, entitled: string[]) => (!asked ? entitled : scope.level === "ORG_ALL" || entitled.includes(asked) ? [asked] : entitled);
  if (scope.level === "ORG_ALL") { branchIds = ctx.branchId ? [ctx.branchId] : []; processIds = ctx.processId ? [ctx.processId] : []; }
  else { branchIds = narrow(ctx.branchId, branchIds); processIds = narrow(ctx.processId, processIds); }

  if (scope.level !== "ORG_ALL" && !["BRANCH_ALL", "PROCESS_ALL", "CUSTOM_SCOPE"].includes(scope.level)) return { sql: "1=0", params: [] };
  // Mirrors buildScopeWhere: PROCESS_ALL falls back to processes only when it holds no branches.
  const useBranch = scope.level === "BRANCH_ALL" || branchIds.length > 0;
  const useProcess = scope.level === "PROCESS_ALL" ? branchIds.length === 0 : scope.level !== "BRANCH_ALL" && processIds.length > 0;
  const conds: string[] = [];
  const params: string[] = [];
  if (useBranch) {
    const names = (await namesFor("branch_master", "branch_name", branchIds)).flatMap((n) => branchNameVariants(n));
    if (!names.length) return { sql: "1=0", params: [] };
    conds.push(`${alias}.applied_for_branch IN (${placeholders(names.length)})`); params.push(...names);
  }
  if (useProcess) {
    // Some rows carry the process id instead of its name in applied_for_process; match both.
    const names = [...(await namesFor("process_master", "process_name", processIds)), ...processIds];
    if (names.length === processIds.length) return { sql: "1=0", params: [] };
    conds.push(`${alias}.applied_for_process IN (${placeholders(names.length)})`); params.push(...names);
  }
  if (scope.level !== "ORG_ALL" && !conds.length) return { sql: "1=0", params: [] };
  return { sql: conds.length ? conds.join(" AND ") : "1=1", params };
}

const GENUINE = `${excludeEmployeeShapedCandidatesSql("c")} AND ${excludeOtherEntityCandidatesSql("c")} AND c.active_status = 1`;

export interface StageTime { candidateId: string; stage: string; at: string }
export interface CohortBundle { candidates: CohortCandidate[]; from: string; stageTimes: StageTime[] }
const memo = new WeakMap<InsightContext, Promise<CohortBundle>>();

/** One candidate query + one stage-log query shared by every cohort-based section (memoised per request). */
export function loadCohort(ctx: InsightContext): Promise<CohortBundle> {
  let p = memo.get(ctx);
  if (!p) { p = fetchCohort(ctx); memo.set(ctx, p); }
  return p;
}

async function fetchCohort(ctx: InsightContext): Promise<CohortBundle> {
  const from = addDays(ctx.today, -(COHORT_DAYS - 1));
  const sc = await candidateScope(ctx);
  const [cands, logs, joined] = await Promise.all([
    rows(
      `SELECT c.id, c.current_stage, c.status, c.sourcing_channel,
              COALESCE(NULLIF(c.recruiter_assigned_name, ''), c.recruiter_name) AS recruiter,
              c.applied_for_branch, c.applied_for_process, c.created_at, c.updated_at, c.walk_in_date
         FROM ats_candidate c
        WHERE c.created_at >= ? AND ${GENUINE} AND ${sc.sql}`,
      [from, ...sc.params],
    ),
    // Log-only scan (no join): the planner full-scans this 7k-row table either way and the join to
    // ats_candidate made it 5x slower. Rows are matched to the cohort in JS below.
    rows(
      `SELECT candidate_id, to_stage, MAX(stage_date) AS at FROM ats_candidate_stage_log
        WHERE stage_date >= ? GROUP BY candidate_id, to_stage`,
      [from],
    ),
    // Employee records are created at offer approval with a future joining date; only a date on or before today is a join.
    rows(`SELECT candidate_id FROM employees WHERE candidate_id IS NOT NULL AND date_of_joining >= ? AND date_of_joining <= ?`, [from, ctx.today]),
  ]);
  const ids = new Set(cands.map((c) => String(c.id)));
  const stageTimes: StageTime[] = [];
  const stagesBy = new Map<string, string[]>();
  for (const l of logs) {
    const k = String(l.candidate_id);
    if (!ids.has(k)) continue;
    stageTimes.push({ candidateId: k, stage: String(l.to_stage ?? ""), at: String(l.at) });
    (stagesBy.get(k) ?? stagesBy.set(k, []).get(k)!).push(String(l.to_stage ?? ""));
  }
  const joinedSet = new Set(joined.map((j) => String(j.candidate_id)));
  return {
    from,
    stageTimes,
    candidates: cands.map((c) => ({
      id: String(c.id), stage: c.current_stage ?? null, status: c.status ?? null, source: c.sourcing_channel ?? null,
      recruiter: c.recruiter ?? null, branch: c.applied_for_branch ?? null, process: c.applied_for_process ?? null,
      createdDate: ymd(c.created_at) as string, updatedDate: ymd(c.updated_at) as string, walkInDate: ymd(c.walk_in_date),
      loggedStages: stagesBy.get(String(c.id)) ?? [], joined: joinedSet.has(String(c.id)),
    })),
  };
}

/** Latest stage-log timestamps per cohort candidate/stage (docs-pending ageing, daily selections). */
export async function loadStageTimes(ctx: InsightContext, stages: string[]): Promise<StageTime[]> {
  const want = new Set(stages.map((x) => x.toLowerCase()));
  return (await loadCohort(ctx)).stageTimes.filter((s) => want.has(s.stage.toLowerCase()));
}

export interface OfferDetail extends OfferRow { name: string | null; process: string | null; branch: string | null }
const offerMemo = new WeakMap<InsightContext, Promise<OfferDetail[]>>();
export function loadOffers(ctx: InsightContext): Promise<OfferDetail[]> {
  let p = offerMemo.get(ctx);
  if (!p) { p = fetchOffers(ctx); offerMemo.set(ctx, p); }
  return p;
}
async function fetchOffers(ctx: InsightContext): Promise<OfferDetail[]> {
  const sc = await candidateScope(ctx);
  const from = addDays(ctx.today, -90);
  // `joined` used to be a correlated EXISTS on employees.candidate_id (no index): one 59k-row scan per offer,
  // ~20s for 90 days of offers. One set-based read of the joiners replaces it.
  const [r, joinedRows] = await Promise.all([
    rows(
      `SELECT o.candidate_id, o.status, o.date_of_joining, o.approved_at, o.submitted_at, c.full_name, COALESCE((SELECT pm.process_name FROM process_master pm WHERE pm.id = c.applied_for_process LIMIT 1), c.applied_for_process) AS applied_for_process, c.applied_for_branch
         FROM ats_employment_offer o JOIN ats_candidate c ON c.id = o.candidate_id
        WHERE o.status IN ('submitted', 'bh_approved') AND COALESCE(o.date_of_joining, DATE(o.created_at)) >= ? AND ${sc.sql}`,
      [from, ...sc.params],
    ),
    rows(`SELECT candidate_id FROM employees WHERE candidate_id IS NOT NULL AND date_of_joining >= ? AND date_of_joining <= ?`, [addDays(from, -120), ctx.today]),
  ]);
  const joinedIds = new Set(joinedRows.map((j) => String(j.candidate_id)));
  for (const o of r) o.joined = joinedIds.has(String(o.candidate_id)) ? 1 : 0;
  return r.map((o) => ({
    status: String(o.status), doj: ymd(o.date_of_joining), approvedAt: ymd(o.approved_at), submittedAt: ymd(o.submitted_at),
    joined: Number(o.joined) === 1, name: o.full_name ?? null, process: o.applied_for_process ?? null, branch: o.applied_for_branch ?? null,
  }));
}

export async function loadRequisitions(ctx: InsightContext): Promise<{ open: ReqRow[]; pendingApproval: number; avgTimeToFill: number | null; filledClosed: number }> {
  const sc = buildScopeWhere(ctx.scope, "branch_id", "process_id");
  const NOT_TEST = "requisition_code NOT LIKE 'TEST-%'";
  const [open, pending, closed] = await Promise.all([
    rows(
      `SELECT requisition_code, process_name, branch_name, requested_headcount, fulfilled_headcount, approved_at, created_at, target_joining_date, priority
         FROM job_requisition
        WHERE approval_status = 'approved' AND active_status = 1 AND closed_at IS NULL AND ${NOT_TEST} AND ${sc.sql}`,
      sc.params,
    ),
    rows(
      `SELECT COUNT(*) AS n FROM job_requisition
        WHERE approval_status IN ('draft', 'pending_approval') AND active_status = 1 AND ${NOT_TEST} AND ${sc.sql}`,
      sc.params,
    ),
    rows(
      `SELECT AVG(DATEDIFF(closed_at, COALESCE(approved_at, created_at))) AS ttf, COUNT(*) AS n FROM job_requisition
        WHERE approval_status = 'closed' AND closed_at >= DATE_SUB(?, INTERVAL 180 DAY) AND fulfilled_headcount > 0 AND ${NOT_TEST} AND ${sc.sql}`,
      [ctx.today, ...sc.params],
    ),
  ]);
  return {
    open: open.map((r) => ({
      code: String(r.requisition_code), process: r.process_name ?? null, branch: r.branch_name ?? null,
      requested: Number(r.requested_headcount ?? 0), fulfilled: Number(r.fulfilled_headcount ?? 0),
      approvedAt: ymd(r.approved_at), createdAt: ymd(r.created_at) as string, target: ymd(r.target_joining_date), priority: r.priority ?? null,
    })),
    pendingApproval: Number(pending[0]?.n ?? 0),
    avgTimeToFill: closed[0]?.ttf == null ? null : Math.round(Number(closed[0].ttf) * 10) / 10,
    filledClosed: Number(closed[0]?.n ?? 0),
  };
}

/** Joins by day from the employee master (every joiner, linked to an ATS candidate or not). The `active_status IN (0,1)` is a no-op filter that lets MySQL use idx_emp_active_doj (58k of 59k rows are inactive, so a bare date filter full-scans). */
export async function loadJoinsByDay(ctx: InsightContext, days: number): Promise<string[]> {
  const from = addDays(ctx.today, -(days - 1));
  const sc = buildScopeWhere(ctx.scope, "e.branch_id", "e.process_id");
  const r = await rows(
    `SELECT e.date_of_joining AS d FROM employees e
      WHERE e.active_status IN (0, 1) AND e.date_of_joining >= ? AND e.date_of_joining <= ? AND e.legacy_emp_id IS NULL AND ${sc.sql}`,
    [from, ctx.today, ...sc.params],
  );
  return r.map((x) => String(x.d).slice(0, 10));
}

/** Pending background-verification candidates still in the pipeline (not yet employees). */
export async function loadBgvPending(ctx: InsightContext): Promise<{ count: number; oldestDays: number | null; manualReview: number }> {
  const sc = await candidateScope(ctx);
  const from = addDays(ctx.today, -COHORT_DAYS);
  const r = await rows(
    `SELECT COUNT(DISTINCT b.candidate_id) AS n, MIN(b.created_at) AS oldest,
            COUNT(DISTINCT CASE WHEN b.status IN ('manual_review', 'mismatch') THEN b.candidate_id END) AS manual
       FROM candidate_bgv_check b JOIN ats_candidate c ON c.id = b.candidate_id
      WHERE c.created_at >= ? AND ${GENUINE} AND ${sc.sql}
        AND c.status NOT IN ('Rejected', 'No Show', 'Inactive')
        AND b.status IN ('not_started', 'consent_pending', 'queued', 'in_progress', 'manual_review', 'mismatch')
        AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.candidate_id = c.id AND e.date_of_joining <= ?)`,
    [from, ...sc.params, ctx.today],
  );
  return { count: Number(r[0]?.n ?? 0), oldestDays: r[0]?.oldest ? Math.max(0, Math.round((Date.parse(`${ctx.today}T00:00:00Z`) - Date.parse(`${String(r[0].oldest).slice(0, 10)}T00:00:00Z`)) / 86_400_000)) : null, manualReview: Number(r[0]?.manual ?? 0) };
}

/** Daily-target rows (dashboard_metric_target) for this dashboard; null when none is configured. */
export async function loadDailyTargets(ctx: InsightContext): Promise<Record<string, number>> {
  const r = await rows(
    `SELECT metric_code, AVG(target_value) AS v FROM dashboard_metric_target
      WHERE dashboard_code = 'RECRUITER_DASHBOARD' AND target_period = 'daily'
        AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) GROUP BY metric_code`,
    [ctx.today, ctx.today],
  );
  return Object.fromEntries(r.map((x) => [String(x.metric_code), Number(x.v)]));
}
