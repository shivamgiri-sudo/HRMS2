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
 * There is one deliberate exception, at the bottom of the rule list. The dated
 * attendance alerts — missing punch and validation — ask someone to raise a
 * regularization for one specific past day, and the only proof of completion
 * is that regularization existing. On production 13,616 of them had none, and
 * no other source can settle them: the column that would show a punch,
 * attendance_daily_record.biometric_status, is NULL on all 111,904 rows. Left
 * alone they accumulate forever and drown the alerts that still matter. They
 * are therefore retired once the day they concern is far enough back that the
 * payroll month is closed and the correction can no longer be made. That
 * window is a business policy, not a technical threshold, so it lives in the
 * named constant below and nowhere else.
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
 *
 * The inner SUBSTRING_INDEX alone was correct only while `date=` was the LAST
 * parameter, which is how it was verified on 13,632 rows. Newer alerts append
 * more, e.g.
 *
 *     …&date=2026-08-04&employeeName=KHUSHI&employeeCode=MAS62567
 *
 * so it returned "2026-08-04&employeeName=KHUSHI&employeeCode=MAS62567". MySQL
 * rejects that in a date comparison with ER_TRUNCATED_WRONG_VALUE — and because
 * one bad row aborts the whole statement, BOTH dated rules failed outright.
 * Measured on production 2026-08-08: 3,538 of 25,701 open dated alerts carry a
 * trailing parameter, so none of the 25,701 were being auto-resolved, not just
 * the 3,538. Errors were visible every cycle as
 * `[inbox-reconciliation] rule "attendance_missing_punch" failed`.
 *
 * Trimming at the next `&` is a no-op when `date=` really is last, so the rows
 * that already worked are unaffected. Verified on the same 25,701: the outer
 * trim yields a clean YYYY-MM-DD on every one, 0 invalid.
 */
const ALERT_DATE = `SUBSTRING_INDEX(SUBSTRING_INDEX(w.action_url, 'date=', -1), '&', 1)`;

/**
 * How far back a dated attendance alert stays actionable. Past this the
 * payroll month is closed and the regularization it asks for can no longer be
 * made, so the alert is asking for something impossible. Set by the business,
 * not derived from anything — change it here and both rules below follow.
 */
const DATED_ATTENDANCE_ALERT_MAX_AGE_DAYS = 30;

/**
 * Age test for a dated attendance alert. Prefers the day the alert is actually
 * about, which is carried in action_url; falls back to when it was raised for
 * any row that does not carry one, so no row is unreachable by this rule.
 */
const datedAlertIsExpired = `(
     ( w.action_url LIKE '%date=%'
       AND ${ALERT_DATE} < DATE_SUB(CURDATE(), INTERVAL ${DATED_ATTENDANCE_ALERT_MAX_AGE_DAYS} DAY) )
  OR ( w.action_url NOT LIKE '%date=%'
       AND w.created_at < DATE_SUB(NOW(), INTERVAL ${DATED_ATTENDANCE_ALERT_MAX_AGE_DAYS} DAY) )
)`;

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
    // Originally closed only on a regularization row. On production 5,051 of
    // these (2026-08-18) had already gone through bulk attendance correction,
    // a direct edit, or a re-sync — none of which write a regularization row —
    // so the alert kept nagging for the full 30 days about a day that was
    // fixed weeks earlier. attendance_daily_record.attendance_status moving
    // off 'missing_punch' is just as much affirmative evidence the day is no
    // longer missing a punch, however it got fixed.
    key: "attendance_missing_punch",
    resolvedWhen: "a regularization has been raised for that employee and date, or the day's attendance record no longer shows missing_punch",
    where: `
      w.type = 'attendance_missing_punch' AND w.is_actioned = 0
      AND w.action_url LIKE '%date=%'
      AND ( EXISTS (
              SELECT 1 FROM attendance_regularization ar
               WHERE ar.employee_id = w.entity_id
                 AND ar.session_date = ${ALERT_DATE}
            )
         OR EXISTS (
              SELECT 1 FROM attendance_daily_record adr
               WHERE adr.employee_id = w.entity_id
                 AND adr.record_date = ${ALERT_DATE}
                 AND adr.attendance_status <> 'missing_punch'
            ) )`,
  },
  {
    // Same fix as attendance_missing_punch above, for the same reason —
    // 5,207 open on production 2026-08-18. This one asks for review of a
    // COSEC-vs-dialler mismatch, so "resolved" means the day now carries a
    // settled, non-ambiguous status rather than still sitting on whatever
    // provisional/anomalous status raised the alert in the first place.
    key: "attendance_validation",
    resolvedWhen: "a regularization has been raised for that employee and date, or the day's attendance record now shows a settled status",
    where: `
      w.type = 'attendance_validation' AND w.is_actioned = 0
      AND w.action_url LIKE '%date=%'
      AND ( EXISTS (
              SELECT 1 FROM attendance_regularization ar
               WHERE ar.employee_id = w.entity_id
                 AND ar.session_date = ${ALERT_DATE}
            )
         OR EXISTS (
              SELECT 1 FROM attendance_daily_record adr
               WHERE adr.employee_id = w.entity_id
                 AND adr.record_date = ${ALERT_DATE}
                 AND adr.attendance_status IN ('present','half_day','week_off','holiday','leave_approved')
            ) )`,
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

  // ── Age-based retirement — the documented exception ────────────────────────
  // These two close without proof of completion. See the note at the top of
  // the file: no proof is obtainable, and the correction they ask for is no
  // longer possible once the payroll month has closed.
  {
    key: "attendance_missing_punch_expired",
    resolvedWhen: `the day it concerns is over ${DATED_ATTENDANCE_ALERT_MAX_AGE_DAYS} days old and can no longer be corrected`,
    where: `
      w.type = 'attendance_missing_punch' AND w.is_actioned = 0
      AND ${datedAlertIsExpired}`,
  },
  {
    key: "attendance_validation_expired",
    resolvedWhen: `the day it concerns is over ${DATED_ATTENDANCE_ALERT_MAX_AGE_DAYS} days old and can no longer be corrected`,
    where: `
      w.type = 'attendance_validation' AND w.is_actioned = 0
      AND ${datedAlertIsExpired}`,
  },
];

/**
 * Identify open items that are exact restatements of another open item.
 *
 * createItem now keeps one open row per (user, type, entity, action_url), but
 * that only stops new duplicates — it cannot collapse what the old 30-minute
 * window and the daily official-email insert already wrote. Production carried
 * 30,077 open rows standing for 757 pieces of work, roughly forty copies each,
 * which is what makes a bell unusable even after the stale alerts are gone.
 *
 * The survivor is the *oldest* row in each group, matching createItem's rule
 * that ageing counts from when the work first came up rather than from the
 * last reminder. Ties on created_at break by id so the choice is deterministic
 * and a re-run closes nothing new.
 *
 * Grouping is done here rather than in SQL because "keep the oldest of each
 * group" needs the id of a specific row, which a GROUP BY cannot hand back
 * without MySQL-version-specific contortions around updating a table that the
 * subquery also reads.
 */
export async function findDuplicateOpenItems(): Promise<{
  toClose: string[];
  groupsAffected: number;
}> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, user_id, type, entity_type, entity_id, action_url, created_at
       FROM work_inbox_item
      WHERE is_actioned = 0`,
  );

  const groups = new Map<string, Array<{ id: string; created_at: string }>>();
  for (const r of rows as RowDataPacket[]) {
    const key = [r.user_id, r.type, r.entity_type ?? "", r.entity_id ?? "", r.action_url ?? ""].join(" ");
    const bucket = groups.get(key);
    const entry = { id: String(r.id), created_at: String(r.created_at ?? "") };
    if (bucket) bucket.push(entry);
    else groups.set(key, [entry]);
  }

  const toClose: string[] = [];
  let groupsAffected = 0;
  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue;
    groupsAffected += 1;
    bucket.sort((a, b) =>
      a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at.localeCompare(b.created_at),
    );
    for (let i = 1; i < bucket.length; i += 1) toClose.push(bucket[i].id);
  }

  return { toClose, groupsAffected };
}

/** Close the given items by id, in batches so no single lock is long-held. */
export async function closeItemsByIds(ids: readonly string[]): Promise<number> {
  let closed = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE work_inbox_item SET is_actioned = 1, is_read = 1
        WHERE is_actioned = 0 AND id IN (${chunk.map(() => "?").join(",")})`,
      [...chunk],
    );
    closed += Number(result?.affectedRows ?? 0);
  }
  return closed;
}

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
