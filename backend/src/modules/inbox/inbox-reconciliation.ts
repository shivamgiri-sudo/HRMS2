/**
 * Inbox reconciliation — closes alerts whose work is demonstrably finished.
 *
 * Direct resolution (inboxService.resolveItems, called from the approve/submit
 * handlers) is what stops an alert the instant you act on it. This is the
 * backstop behind it: a periodic sweep that re-checks each open alert against
 * the state of the thing it was raised about, and closes the ones that are no
 * longer true. It exists because direct resolution can only cover the code
 * paths we know about — a decision recorded by an import, a legacy screen, or
 * a route added later would otherwise leave the alert nagging forever.
 *
 * Every rule closes on *affirmative evidence of completion*, never on age or
 * on the absence of information. A rule that cannot prove the work is done
 * leaves the alert standing, because a missed alert is a worse failure than a
 * stale one.
 *
 * Rules were written against the live `mas_hrms` schema and its actual column
 * values, not against the schema files — several columns that look
 * authoritative are dead. `attendance_daily_record.biometric_status` is NULL
 * on all 111,904 rows, so it can prove nothing and is not used here.
 */

import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/** Candidate states that mean a recruiter has recorded an outcome. */
const CANDIDATE_TERMINAL = `('Selected','Rejected','Hold','No Show')`;
/** Candidate states that mean feedback is still outstanding. */
const CANDIDATE_FEEDBACK_PENDING = `('registered','in_process','walkin_registered')`;
/** Leave states still awaiting somebody's decision. */
const LEAVE_OPEN = `('pending','pending_branch_head')`;
/** Regularization states that are finished; anything else is still in flight. */
const REGULARIZATION_CLOSED = `('approved','rejected','cancelled')`;

/**
 * The date a dated attendance alert refers to is carried in the query string
 * of action_url (`…?employeeId=<id>&date=YYYY-MM-DD`), not in a column.
 * Verified against production: parses cleanly on all 13,632 open rows.
 */
const ALERT_DATE = `SUBSTRING_INDEX(w.action_url, 'date=', -1)`;

export interface ResolutionRule {
  /** Alert type this rule closes. */
  key: string;
  /** What "done" means for this alert, in plain words. */
  resolvedWhen: string;
  /** WHERE body over alias `w`; must include the is_actioned = 0 guard. */
  where: string;
}

export const INBOX_RESOLUTION_RULES: readonly ResolutionRule[] = [
  {
    key: "sla_breach_uncalled",
    resolvedWhen: "the candidate has been called, or has left the waiting state",
    where: `
      w.type = 'sla_breach_uncalled' AND w.is_actioned = 0
      AND EXISTS (
        SELECT 1 FROM ats_candidate c
         WHERE c.id = w.entity_id
           AND ( c.status <> 'Waiting'
              OR EXISTS ( SELECT 1 FROM ats_queue_token qt
                           WHERE qt.candidate_id = c.id
                             AND ( qt.called_at IS NOT NULL
                                OR qt.interview_completed_at IS NOT NULL
                                OR qt.queue_status IN ('completed','no_show','in_interview') ) ) )
      )`,
  },
  {
    key: "walkin_submission_sla",
    resolvedWhen: "the interview has been completed or the queue entry closed",
    where: `
      w.type = 'walkin_submission_sla' AND w.is_actioned = 0
      AND ( EXISTS ( SELECT 1 FROM ats_queue_token qt
                      WHERE qt.candidate_id = w.entity_id
                        AND ( qt.interview_completed_at IS NOT NULL
                           OR qt.queue_status IN ('completed','no_show') ) )
         OR EXISTS ( SELECT 1 FROM ats_candidate c
                      WHERE c.id = w.entity_id AND c.status IN ${CANDIDATE_TERMINAL} ) )`,
  },
  {
    key: "interview_submission_overdue",
    resolvedWhen: "the interview has been completed or the queue entry closed",
    where: `
      w.type = 'interview_submission_overdue' AND w.is_actioned = 0
      AND ( EXISTS ( SELECT 1 FROM ats_queue_token qt
                      WHERE qt.candidate_id = w.entity_id
                        AND ( qt.interview_completed_at IS NOT NULL
                           OR qt.queue_status IN ('completed','no_show') ) )
         OR EXISTS ( SELECT 1 FROM ats_candidate c
                      WHERE c.id = w.entity_id AND c.status IN ${CANDIDATE_TERMINAL} ) )`,
  },
  {
    // The generating worker asks whether `candidate_status` is still
    // 'registered'. On production that column sits at 'registered' for 32,653
    // candidates and never moves — the recruiter decision lands in `status`
    // instead. So all 17 open alerts had a recorded outcome and none could
    // ever clear. This rule accepts a decision recorded in either column, or
    // an interview result row.
    key: "walkin_feedback_pending",
    resolvedWhen: "an interview outcome has been recorded anywhere",
    where: `
      w.type = 'walkin_feedback_pending' AND w.is_actioned = 0
      AND ( EXISTS ( SELECT 1 FROM ats_candidate c
                      WHERE c.id = w.entity_id
                        AND ( c.status IN ${CANDIDATE_TERMINAL}
                           OR c.candidate_status NOT IN ${CANDIDATE_FEEDBACK_PENDING} ) )
         OR EXISTS ( SELECT 1 FROM ats_interview_result r WHERE r.candidate_id = w.entity_id ) )`,
  },
  {
    // entity_id has historically held the employee id rather than the leave
    // request id, so both readings are accepted: the alert clears once nothing
    // matching it is still awaiting a decision.
    key: "leave_request",
    resolvedWhen: "no leave request this alert could refer to is still pending",
    where: `
      w.type = 'leave_request' AND w.is_actioned = 0
      AND NOT EXISTS (
        SELECT 1 FROM leave_request lr
         WHERE ( lr.id = w.entity_id OR lr.employee_id = w.entity_id )
           AND lr.status IN ${LEAVE_OPEN}
      )`,
  },
  {
    key: "attendance_regularization",
    resolvedWhen: "no regularization this alert could refer to is still in flight",
    where: `
      w.type = 'attendance_regularization' AND w.is_actioned = 0
      AND NOT EXISTS (
        SELECT 1 FROM attendance_regularization ar
         WHERE ( ar.id = w.entity_id OR ar.employee_id = w.entity_id )
           AND ar.status NOT IN ${REGULARIZATION_CLOSED}
      )`,
  },
  {
    key: "attendance_missing_punch",
    resolvedWhen: "a regularization has been raised for that employee and date",
    where: `
      w.type = 'attendance_missing_punch' AND w.is_actioned = 0
      AND w.action_url LIKE '%date=%'
      AND EXISTS (
        SELECT 1 FROM attendance_regularization ar
         WHERE ar.employee_id = w.entity_id
           AND ar.session_date = ${ALERT_DATE}
      )`,
  },
  {
    key: "attendance_validation",
    resolvedWhen: "a regularization has been raised for that employee and date",
    where: `
      w.type = 'attendance_validation' AND w.is_actioned = 0
      AND w.action_url LIKE '%date=%'
      AND EXISTS (
        SELECT 1 FROM attendance_regularization ar
         WHERE ar.employee_id = w.entity_id
           AND ar.session_date = ${ALERT_DATE}
      )`,
  },
  {
    key: "it_provisioning",
    resolvedWhen: "the provisioning request has been actioned",
    where: `
      w.type = 'it_provisioning' AND w.is_actioned = 0
      AND EXISTS (
        SELECT 1 FROM it_provisioning_request p
         WHERE p.id = w.entity_id
           AND ( p.actioned_at IS NOT NULL OR p.status <> 'pending' )
      )`,
  },
  {
    key: "official_email_compliance",
    resolvedWhen: "the employee now has a compliant official email, or has left",
    where: `
      w.type = 'alerts' AND w.entity_type = 'official_email_compliance' AND w.is_actioned = 0
      AND EXISTS (
        SELECT 1 FROM employees e
         WHERE e.id = w.entity_id
           AND ( e.active_status <> 1
              OR LOWER(COALESCE(NULLIF(TRIM(e.official_email), ''), e.email)) LIKE '%@teammas.in'
              OR LOWER(COALESCE(NULLIF(TRIM(e.official_email), ''), e.email)) LIKE '%@teammas.co.in' )
      )`,
  },
];

export interface ReconciliationResult {
  /** Alerts closed (or, in a dry run, that would be closed) per rule. */
  byRule: Record<string, number>;
  total: number;
  dryRun: boolean;
}

/** Rows per UPDATE statement, so a sweep never takes a long lock on a live table. */
const BATCH_SIZE = 2000;
/** Guards against a malformed rule looping forever. */
const MAX_BATCHES_PER_RULE = 200;

/**
 * Close every open alert whose underlying work is finished.
 *
 * With `dryRun`, counts what would close and writes nothing — use it before
 * running this against a backlog.
 */
export async function runInboxReconciliation(
  opts: { dryRun?: boolean; rules?: readonly ResolutionRule[] } = {},
): Promise<ReconciliationResult> {
  const dryRun = opts.dryRun ?? false;
  const rules = opts.rules ?? INBOX_RESOLUTION_RULES;
  const byRule: Record<string, number> = {};
  let total = 0;

  for (const rule of rules) {
    try {
      if (dryRun) {
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT COUNT(*) AS n FROM work_inbox_item w WHERE ${rule.where}`,
        );
        const n = Number(rows[0]?.n ?? 0);
        byRule[rule.key] = n;
        total += n;
        continue;
      }

      let closed = 0;
      for (let batch = 0; batch < MAX_BATCHES_PER_RULE; batch += 1) {
        const [result] = await db.execute<ResultSetHeader>(
          `UPDATE work_inbox_item w
              SET w.is_actioned = 1, w.is_read = 1
            WHERE ${rule.where}
            LIMIT ${BATCH_SIZE}`,
        );
        const affected = Number(result?.affectedRows ?? 0);
        closed += affected;
        if (affected < BATCH_SIZE) break;
      }
      byRule[rule.key] = closed;
      total += closed;
    } catch (error) {
      // One broken rule must not stop the rest of the sweep.
      console.error(
        `[inbox-reconciliation] rule "${rule.key}" failed:`,
        error instanceof Error ? error.message : String(error),
      );
      byRule[rule.key] = 0;
    }
  }

  return { byRule, total, dryRun };
}
