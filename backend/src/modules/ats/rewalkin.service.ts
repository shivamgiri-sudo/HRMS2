import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { logger } from "../../lib/logger.js";

/** State of an existing candidate row captured BEFORE the walk-in UPDATE overwrites it. */
export interface RewalkinPrior {
  priorWalkInDate: string | null;
  priorStage: string | null;
  priorStatus: string | null;
  priorDecision: string | null;
  hasQueueToken: boolean;
}

/**
 * A calling/hiring lead that never walked in (no walk_in_date, no queue token) is not a
 * re-walk-in. A same-day resubmission is a double submit, not a second visit.
 */
export function isGenuineRewalkin(
  prior: RewalkinPrior,
  todayIst: string,
): boolean {
  if (prior.priorWalkInDate && prior.priorWalkInDate === todayIst) return false;
  return Boolean(prior.priorWalkInDate) || prior.hasQueueToken;
}

export const PRIOR_STATE_SQL = `SELECT DATE_FORMAT(c.walk_in_date, '%Y-%m-%d') AS walk_in_date,
        c.current_stage, c.status,
        (SELECT s.final_decision FROM ats_interview_submission s
          WHERE s.candidate_id = c.id ORDER BY s.submitted_at DESC LIMIT 1) AS final_decision,
        EXISTS (SELECT 1 FROM ats_queue_token t WHERE t.candidate_id = c.id) AS has_token
   FROM ats_candidate c WHERE c.id = ? LIMIT 1`;

export const INSERT_REWALKIN_SQL = `INSERT INTO ats_candidate_rewalkin
   (candidate_id, walked_in_at, walk_in_date, branch, process, source_channel,
    prior_stage, prior_status, prior_decision, recruiter_assigned_name)
 SELECT c.id, NOW(), ?, c.applied_for_branch, c.applied_for_process, c.sourcing_channel,
        ?, ?, ?, c.recruiter_assigned_name
   FROM ats_candidate c WHERE c.id = ?`;

/** Never throws: failing to log a re-walk-in must not break registration. */
export async function readRewalkinPrior(
  candidateId: string,
): Promise<RewalkinPrior | null> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(PRIOR_STATE_SQL, [
      candidateId,
    ]);
    const r = rows[0];
    if (!r) return null;
    return {
      priorWalkInDate: r.walk_in_date ?? null,
      priorStage: r.current_stage ?? null,
      priorStatus: r.status ?? null,
      priorDecision: r.final_decision ?? null,
      hasQueueToken: Number(r.has_token) === 1,
    };
  } catch (error) {
    logger.error({ err: error, candidateId }, "rewalkin: prior read failed");
    return null;
  }
}

/** Never throws. Call after the candidate UPDATE and recruiter assignment. */
export async function recordRewalkin(
  candidateId: string,
  prior: RewalkinPrior | null,
  todayIst: string,
): Promise<void> {
  if (!prior || !isGenuineRewalkin(prior, todayIst)) return;
  try {
    await db.execute(INSERT_REWALKIN_SQL, [
      todayIst,
      prior.priorStage,
      prior.priorStatus,
      prior.priorDecision,
      candidateId,
    ]);
  } catch (error) {
    logger.error({ err: error, candidateId }, "rewalkin: insert failed");
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const REPORT_ROW_LIMIT = 500;
const DEFAULT_WINDOW_DAYS = 30;

export interface RewalkinReportFilters {
  from?: string;
  to?: string;
  branch?: string;
  scope: { sql: string; params: unknown[] };
}

/** Builds the shared FROM/WHERE. Scope SQL uses unqualified ats_candidate columns; alias c. */
export function buildRewalkinWhere(f: RewalkinReportFilters): {
  where: string;
  params: unknown[];
} {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (f.from && ISO_DATE.test(f.from)) {
    conds.push("r.walk_in_date >= ?");
    params.push(f.from);
  } else {
    conds.push(
      `r.walk_in_date >= CURDATE() - INTERVAL ${DEFAULT_WINDOW_DAYS} DAY`,
    );
  }
  if (f.to && ISO_DATE.test(f.to)) {
    conds.push("r.walk_in_date <= ?");
    params.push(f.to);
  }
  if (f.branch) {
    conds.push("r.branch = ?");
    params.push(f.branch);
  }
  if (f.scope.sql !== "1=1") {
    conds.push(`(${f.scope.sql})`);
    params.push(...f.scope.params);
  }
  return { where: `WHERE ${conds.join(" AND ")}`, params };
}

const REPORT_FROM = `FROM ats_candidate_rewalkin r JOIN ats_candidate c ON c.id = r.candidate_id`;

export async function getRewalkinReport(f: RewalkinReportFilters) {
  const empty = {
    total: 0,
    uniqueCandidates: 0,
    byBranch: [],
    byRecruiter: [],
    byDay: [],
    rows: [],
  };
  if (f.scope.sql === "1=0") return empty;
  const { where, params } = buildRewalkinWhere(f);
  const q = async (sql: string) =>
    (await db.execute<RowDataPacket[]>(sql, params))[0];

  const [totals, byBranch, byRecruiter, byDay, rows] = await Promise.all([
    q(
      `SELECT COUNT(*) AS total, COUNT(DISTINCT r.candidate_id) AS unique_candidates ${REPORT_FROM} ${where}`,
    ),
    q(
      `SELECT COALESCE(r.branch, 'Unknown') AS branch, COUNT(*) AS count ${REPORT_FROM} ${where} GROUP BY 1 ORDER BY count DESC`,
    ),
    q(
      `SELECT COALESCE(r.recruiter_assigned_name, 'Unassigned') AS recruiter, COUNT(*) AS count ${REPORT_FROM} ${where} GROUP BY 1 ORDER BY count DESC`,
    ),
    q(
      `SELECT DATE_FORMAT(r.walk_in_date, '%Y-%m-%d') AS day, COUNT(*) AS count ${REPORT_FROM} ${where} GROUP BY 1 ORDER BY 1`,
    ),
    q(`SELECT r.id, r.candidate_id, c.candidate_code, c.full_name, c.mobile,
              r.walked_in_at, DATE_FORMAT(r.walk_in_date, '%Y-%m-%d') AS walk_in_date,
              r.branch, r.process, r.source_channel, r.prior_stage, r.prior_status,
              r.prior_decision, r.recruiter_assigned_name
       ${REPORT_FROM} ${where} ORDER BY r.walked_in_at DESC LIMIT ${REPORT_ROW_LIMIT}`),
  ]);
  return {
    total: Number(totals[0]?.total ?? 0),
    uniqueCandidates: Number(totals[0]?.unique_candidates ?? 0),
    byBranch: byBranch.map((r) => ({
      branch: r.branch,
      count: Number(r.count),
    })),
    byRecruiter: byRecruiter.map((r) => ({
      recruiter: r.recruiter,
      count: Number(r.count),
    })),
    byDay: byDay.map((r) => ({ day: r.day, count: Number(r.count) })),
    rows,
  };
}
