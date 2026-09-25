/**
 * Branch Recruitment Activity Report — data layer. Read-only.
 *
 * Two reads, all scoped to genuine MAS candidates (record_type = 'candidate', not IDC):
 *   A. ats_queue_token rows           — the walk-in queue (token, call and closure timestamps)
 *   B. q_token-only registrations     — walk-ins the intake path tokenised on ats_candidate without a queue row
 *
 * All durations are computed in MySQL (session tz is IST, see db/mysql.ts) so JS never parses a
 * DATETIME. `arrival_date` is a formatted string, not a Date.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import {
  excludeEmployeeShapedCandidatesSql,
  excludeOtherEntityCandidatesSql,
} from "../ats-reporting-scope.js";
import type { RawTokenRow } from "./metrics.js";

const SCOPE = `${excludeEmployeeShapedCandidatesSql("c")} AND ${excludeOtherEntityCandidatesSql("c")}`;
const DECISION = `COALESCE(NULLIF(s.final_decision,''), NULLIF(c.final_decision,''), NULLIF(c.status,''), c.current_stage)`;
const PROCESS = `COALESCE(NULLIF(c.role_applied,''), NULLIF(c.applied_for_process,''))`;

function timing(arrival: string, call: string, close: string): string {
  return `
    IF(${call} IS NULL, NULL, TIMESTAMPDIFF(MINUTE, ${arrival}, ${call}))                         AS wait_min,
    IF(${call} IS NULL OR ${close} IS NULL, NULL, TIMESTAMPDIFF(MINUTE, ${call}, ${close}))       AS handle_min,
    IF(${call} IS NULL, 0, 1)                                                                     AS has_call,
    TIMESTAMPDIFF(MINUTE, ${arrival}, NOW())                                                      AS since_arrival_min,
    IF(${call} IS NULL, NULL, TIMESTAMPDIFF(MINUTE, ${call}, NOW()))                              AS since_call_min`;
}

const A_CALL = `COALESCE(qt.called_at, s.candidate_called_at, qt.interview_started_at, s.interview_started_at)`;
const A_CLOSE = `COALESCE(qt.interview_completed_at, s.submitted_at)`;

/**
 * A. Queue tokens arriving in [from, to]. A submission belongs to a token when it was filed at/after that
 * token's arrival and BEFORE the same candidate's next token arrived — otherwise a candidate with two visits
 * and one form would close both tokens.
 */
async function queueTokens(from: string, to: string): Promise<RawTokenRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT qt.id AS token_id, qt.candidate_id,
            COALESCE(NULLIF(qt.token_number,''), c.q_token)                                  AS token_number,
            c.full_name, ${PROCESS} AS process,
            COALESCE(NULLIF(qt.branch_name,''), NULLIF(c.branch_display_name,''), NULLIF(c.applied_for_branch,'')) AS branch_raw,
            COALESCE(NULLIF(rr.name,''), NULLIF(c.recruiter_assigned_name,''), NULLIF(c.recruiter_name,'')) AS recruiter_raw,
            DATE_FORMAT(qt.arrival_time,'%Y-%m-%d') AS arrival_date,
            DATE_FORMAT(qt.arrival_time,'%H:%i')    AS arrival_hhmm,
            COALESCE(qt.queue_status, IF(qt.status='active','waiting',qt.status)) AS queue_status,
            1 AS has_queue_row, s.id AS sub_id, DATE_FORMAT(s.submitted_at,'%Y-%m-%d') AS form_date,
            ${DECISION} AS decision_text, c.current_stage, c.status AS cand_status,
            ${timing("qt.arrival_time", A_CALL, A_CLOSE)}
       FROM ats_queue_token qt
       JOIN ats_candidate c ON c.id = qt.candidate_id
       LEFT JOIN ats_recruiter_roster rr ON rr.id = COALESCE(qt.recruiter_id, qt.assigned_recruiter_id)
       LEFT JOIN ats_interview_submission s
              ON s.candidate_id = qt.candidate_id
             AND s.submitted_at >= DATE_SUB(qt.arrival_time, INTERVAL 1 MINUTE)
             AND NOT EXISTS (SELECT 1 FROM ats_queue_token nx
                              WHERE nx.candidate_id = qt.candidate_id
                                AND nx.arrival_time > qt.arrival_time AND nx.arrival_time <= s.submitted_at)
      WHERE ${SCOPE}
        AND qt.arrival_time >= ? AND qt.arrival_time < DATE_ADD(?, INTERVAL 1 DAY)
      ORDER BY qt.arrival_time, s.submitted_at`,
    [from, to],
  );
  return rows as RawTokenRow[];
}

const B_ARRIVAL = `TIMESTAMP(c.created_date, COALESCE(c.created_time,'00:00:00'))`;
const B_CALL = `COALESCE(s.candidate_called_at, s.interview_started_at)`;
const B_CLOSE = `COALESCE(s.submitted_at, c.hr_form_submission_time)`;
/**
 * B. Candidates carrying a q_token but NO queue row at all. A candidate who has any queue row had their q_token
 * overwritten by it (registration writes the newest token to ats_candidate), so the older registration would
 * otherwise reappear here as a second "token" attached to the same interview form.
 */
const NO_QUEUE_ROW = `NOT EXISTS (SELECT 1 FROM ats_queue_token q WHERE q.candidate_id = c.id)`;
async function tokenOnlyRegistrations(
  from: string,
  to: string,
): Promise<RawTokenRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id AS token_id, c.id AS candidate_id, c.q_token AS token_number, c.full_name, ${PROCESS} AS process,
            COALESCE(NULLIF(c.branch_text,''), NULLIF(c.branch_display_name,''), NULLIF(c.applied_for_branch,'')) AS branch_raw,
            COALESCE(NULLIF(c.recruiter_assigned_name,''), NULLIF(c.recruiter_name,'')) AS recruiter_raw,
            DATE_FORMAT(c.created_date,'%Y-%m-%d') AS arrival_date,
            DATE_FORMAT(c.created_time,'%H:%i')    AS arrival_hhmm,
            NULL AS queue_status, 0 AS has_queue_row, s.id AS sub_id, DATE_FORMAT(s.submitted_at,'%Y-%m-%d') AS form_date,
            ${DECISION} AS decision_text, c.current_stage, c.status AS cand_status,
            ${timing(B_ARRIVAL, B_CALL, B_CLOSE)}
       FROM ats_candidate c
       LEFT JOIN ats_interview_submission s ON s.candidate_id = c.id AND s.q_token = c.q_token
      WHERE ${SCOPE}
        AND c.created_date BETWEEN ? AND ?
        AND c.q_token IS NOT NULL AND c.q_token <> ''
        AND ${NO_QUEUE_ROW}`,
    [from, to],
  );
  return rows as RawTokenRow[];
}

/** First submission per token wins (the join can fan out when a candidate was submitted more than once). */
function dedupeByToken(rows: RawTokenRow[]): RawTokenRow[] {
  const seen = new Set<string>();
  return rows.filter((r) =>
    seen.has(r.token_id) ? false : (seen.add(r.token_id), true),
  );
}

export async function fetchRawFacts(from: string, to: string) {
  const [queue, tokenOnly] = await Promise.all([
    queueTokens(from, to),
    tokenOnlyRegistrations(from, to),
  ]);
  return { rows: [...dedupeByToken(queue), ...tokenOnly] };
}
