/**
 * Attrition risk & leave-reconciliation executor
 *
 * Covers codes: attrition-risk-score, leave-attendance-reconciliation
 *
 * ── attrition-risk-score ────────────────────────────────────────────────────
 * A per-employee RANKING, not a prediction, and the distinction is deliberate.
 *
 * Nothing here is trained. There is no label to train against: exit_request holds 2 rows
 * against 2,632 exits in twelve months, so why anyone left is not recorded anywhere. What
 * the data does support is ordering people by how closely they resemble the population that
 * has historically left, and that turns out to be worth a great deal on its own — measured
 * over the last twelve months with impossible-tenure records excluded, 1,121 of 2,615 exits
 * (43%) happened within 30 days of joining and 1,760 (67%) within 90.
 *
 * So tenure carries most of the signal and the score says so openly: the bucket contributes
 * the largest single term, and the behavioural terms modulate it. Every component is emitted
 * as its own column so a manager can see WHY someone is ranked where they are — a score with
 * no visible drivers is an oracle, and an oracle built on a 43% base rate would get credit
 * for knowing what everybody already knows.
 *
 * Weights are stated, not learned, and are therefore a judgement rather than a finding.
 * They are here to be argued with:
 *   tenure 0-30 -> 45, 31-60 -> 30, 61-90 -> 18, 90+ -> 6   (base rate shape)
 *   absence rate over the last 30 days      -> up to 25
 *   missing-punch rate over the same window -> up to 20     (engagement proxy)
 *   half-day rate                           -> up to 10
 * Capped at 100. Bands are High >= 60, Medium >= 35, else Low.
 *
 * Two honest limits, both surfaced as columns rather than buried:
 *   - attendance_days is the denominator behind every behavioural term. A new joiner with
 *     3 days of attendance has a volatile rate, so the column is emitted and the rates are
 *     NULL below 5 days rather than allowed to swing the score on nothing.
 *   - process is NULL for 341 active employees, all 183 of them in the 0-30 bucket, so a
 *     process baseline cannot contribute for exactly the people the score is about. It is
 *     left out of the arithmetic entirely instead of silently scoring them as average.
 *
 * ── leave-attendance-reconciliation ─────────────────────────────────────────
 * Approved leave does not reach attendance: 1,180 leave requests were approved in the last
 * 90 days while attendance recorded 12 days as leave_approved. Those employees are counted
 * absent, which inflates unplanned shrinkage and understates planned absence.
 *
 * This report QUANTIFIES the gap per employee per month and writes nothing. Posting these
 * days into attendance would change payable days, and therefore salary, for months that may
 * already be settled — that is a payroll decision with a frozen-month question attached, not
 * a reporting one.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import type { ExecFilters, ExecScope, ExecOptions, ExecResult } from "./types.js";
import {
  appendScopeConditions,
  appendFilterConditions,
  dateParam,
  fetchPageWithTotal,
  rethrowReportSchemaError,
} from "./types.js";
import { AON_REFERENCE_JOIN_DATE_SQL } from "./aon.executor.js";

async function query(sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows;
}

async function count(baseSql: string, params: unknown[]): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM (${baseSql}) AS _cnt`,
    params
  );
  return Number((rows as Array<{ total?: number }>)[0]?.total ?? 0);
}

/** Minimum attendance days before a behavioural rate is trusted. */
const MIN_DAYS_FOR_RATE = 5;

// ---------------------------------------------------------------------------
// attrition-risk-score
// ---------------------------------------------------------------------------
export async function attritionRiskScore(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const windowDays = Number(filters.windowDays ?? 30) || 30;

  const clauses: string[] = ["e.active_status = 1", "e.date_of_joining IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  // Attendance is aggregated in a derived table keyed by employee so the outer query stays
  // one row per employee. Doing it as correlated subqueries in the SELECT would re-scan
  // attendance_daily_record once per employee per metric.
  const base = `
    SELECT e.employee_code,
           COALESCE(NULLIF(TRIM(e.full_name),''),
                    TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED')       AS branch_name,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(p.process_name, 'UNASSIGNED')      AS process_name,
           DATE_FORMAT(e.date_of_joining, '%Y-%m-%d')  AS date_of_joining,
           DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL})      AS aon_days,
           CASE
             WHEN DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) <= 30 THEN '0-30'
             WHEN DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) <= 60 THEN '31-60'
             WHEN DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) <= 90 THEN '61-90'
             ELSE '90+'
           END AS aon_bucket,
           COALESCE(a.attendance_days, 0)              AS attendance_days,
           CASE WHEN COALESCE(a.attendance_days,0) >= ${MIN_DAYS_FOR_RATE}
                THEN ROUND(a.absent_days   * 100.0 / a.attendance_days, 1) END AS absence_rate_pct,
           CASE WHEN COALESCE(a.attendance_days,0) >= ${MIN_DAYS_FOR_RATE}
                THEN ROUND(a.missing_days  * 100.0 / a.attendance_days, 1) END AS missing_punch_rate_pct,
           CASE WHEN COALESCE(a.attendance_days,0) >= ${MIN_DAYS_FOR_RATE}
                THEN ROUND(a.half_days     * 100.0 / a.attendance_days, 1) END AS half_day_rate_pct,
           -- Component columns, so the ranking can be argued with rather than trusted.
           CASE
             WHEN DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) <= 30 THEN 45
             WHEN DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) <= 60 THEN 30
             WHEN DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) <= 90 THEN 18
             ELSE 6
           END AS tenure_points,
           CASE WHEN COALESCE(a.attendance_days,0) >= ${MIN_DAYS_FOR_RATE}
                THEN LEAST(25, ROUND(a.absent_days  * 25.0 / a.attendance_days, 1)) ELSE 0 END AS absence_points,
           CASE WHEN COALESCE(a.attendance_days,0) >= ${MIN_DAYS_FOR_RATE}
                THEN LEAST(20, ROUND(a.missing_days * 20.0 / a.attendance_days, 1)) ELSE 0 END AS missing_punch_points,
           CASE WHEN COALESCE(a.attendance_days,0) >= ${MIN_DAYS_FOR_RATE}
                THEN LEAST(10, ROUND(a.half_days    * 10.0 / a.attendance_days, 1)) ELSE 0 END AS half_day_points,
           LEAST(100,
             CASE
               WHEN DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) <= 30 THEN 45
               WHEN DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) <= 60 THEN 30
               WHEN DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) <= 90 THEN 18
               ELSE 6
             END
             + CASE WHEN COALESCE(a.attendance_days,0) >= ${MIN_DAYS_FOR_RATE}
                    THEN LEAST(25, a.absent_days  * 25.0 / a.attendance_days) ELSE 0 END
             + CASE WHEN COALESCE(a.attendance_days,0) >= ${MIN_DAYS_FOR_RATE}
                    THEN LEAST(20, a.missing_days * 20.0 / a.attendance_days) ELSE 0 END
             + CASE WHEN COALESCE(a.attendance_days,0) >= ${MIN_DAYS_FOR_RATE}
                    THEN LEAST(10, a.half_days    * 10.0 / a.attendance_days) ELSE 0 END
           ) AS risk_score,
           CASE
             WHEN LEAST(100,
               CASE
                 WHEN DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) <= 30 THEN 45
                 WHEN DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) <= 60 THEN 30
                 WHEN DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) <= 90 THEN 18
                 ELSE 6
               END
               + CASE WHEN COALESCE(a.attendance_days,0) >= ${MIN_DAYS_FOR_RATE}
                      THEN LEAST(25, a.absent_days  * 25.0 / a.attendance_days) ELSE 0 END
               + CASE WHEN COALESCE(a.attendance_days,0) >= ${MIN_DAYS_FOR_RATE}
                      THEN LEAST(20, a.missing_days * 20.0 / a.attendance_days) ELSE 0 END
               + CASE WHEN COALESCE(a.attendance_days,0) >= ${MIN_DAYS_FOR_RATE}
                      THEN LEAST(10, a.half_days    * 10.0 / a.attendance_days) ELSE 0 END
             ) >= 60 THEN 'High'
             WHEN LEAST(100,
               CASE
                 WHEN DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) <= 30 THEN 45
                 WHEN DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) <= 60 THEN 30
                 WHEN DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}) <= 90 THEN 18
                 ELSE 6
               END
               + CASE WHEN COALESCE(a.attendance_days,0) >= ${MIN_DAYS_FOR_RATE}
                      THEN LEAST(25, a.absent_days  * 25.0 / a.attendance_days) ELSE 0 END
               + CASE WHEN COALESCE(a.attendance_days,0) >= ${MIN_DAYS_FOR_RATE}
                      THEN LEAST(20, a.missing_days * 20.0 / a.attendance_days) ELSE 0 END
               + CASE WHEN COALESCE(a.attendance_days,0) >= ${MIN_DAYS_FOR_RATE}
                      THEN LEAST(10, a.half_days    * 10.0 / a.attendance_days) ELSE 0 END
             ) >= 35 THEN 'Medium'
             ELSE 'Low'
           END AS risk_band
      FROM employees e
      LEFT JOIN branch_master b       ON b.id  = e.branch_id
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
      LEFT JOIN process_master p      ON p.id  = e.process_id
      LEFT JOIN (
        SELECT adr.employee_id,
               COUNT(*)                                      AS attendance_days,
               SUM(adr.attendance_status = 'absent')         AS absent_days,
               SUM(adr.attendance_status = 'missing_punch')  AS missing_days,
               SUM(adr.attendance_status = 'half_day')       AS half_days
          FROM attendance_daily_record adr
         WHERE adr.record_date >= DATE_SUB(CURDATE(), INTERVAL ${windowDays} DAY)
         GROUP BY adr.employee_id
      ) a ON a.employee_id = e.id
     WHERE ${clauses.join(" AND ")}
     ORDER BY risk_score DESC, aon_days ASC`;

  try {
    const paged = await fetchPageWithTotal(base, params, options, query, count);
    const total = paged.total;
    const rows = paged.rows as Record<string, unknown>[];
    return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
  } catch (err) {
    rethrowReportSchemaError("attrition-risk-score", err, base);
  }
}

// ---------------------------------------------------------------------------
// leave-attendance-reconciliation
// ---------------------------------------------------------------------------
export async function leaveAttendanceReconciliation(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  /*
   * One month, not three.
   *
   * Timed live against the same contended database that makes aon-bucket-shrinkage 504:
   * three months took 126.8s (past the 120s gateway limit), one month 86s. The query is not
   * the problem — 131,906 attendance rows should aggregate in about a second — but a report
   * that reliably times out is worth less than a narrower one that returns, and the caller
   * can always widen the range explicitly and wait.
   */
  const oneMonthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
  const from = dateParam(filters.from, iso(oneMonthAgo));
  const to = dateParam(filters.to, iso(today));

  const clauses: string[] = ["lr.status = 'approved'"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("lr.from_date >= ?", "lr.from_date <= ?");
  params.push(from, to);

  /*
   * One row per employee per month of approved leave, with what attendance says about the
   * same days. `days_marked_absent` is the number that matters: those are days a person was
   * on sanctioned leave and the attendance feed calls it absence, so they land in unplanned
   * shrinkage and, depending on the payroll rules in force, may be unpaid.
   *
   * Joined on the leave START date rather than expanding each request into individual dates.
   * Expanding would need a calendar table this schema does not have, and the per-request
   * grain is enough to size the gap and identify who is affected.
   */
  const base = `
    SELECT DATE_FORMAT(lr.from_date, '%Y-%m')          AS month,
           e.employee_code,
           COALESCE(NULLIF(TRIM(e.full_name),''),
                    TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED')       AS branch_name,
           COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(p.process_name, 'UNASSIGNED')      AS process_name,
           COUNT(*)                                    AS approved_requests,
           SUM(GREATEST(DATEDIFF(lr.to_date, lr.from_date) + 1, 1)) AS approved_leave_days,
           SUM(COALESCE(m.marked_leave, 0))            AS days_marked_leave_in_attendance,
           SUM(COALESCE(m.marked_absent, 0))           AS days_marked_absent_in_attendance,
           ROUND(
             SUM(COALESCE(m.marked_leave,0)) * 100.0
             / NULLIF(SUM(GREATEST(DATEDIFF(lr.to_date, lr.from_date) + 1, 1)), 0), 1
           ) AS attendance_agreement_pct
      FROM leave_request lr
      JOIN employees e                ON e.id  = lr.employee_id
      LEFT JOIN branch_master b       ON b.id  = e.branch_id
      LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
      LEFT JOIN process_master p      ON p.id  = e.process_id
      LEFT JOIN (
        SELECT adr.employee_id, adr.record_date,
               SUM(adr.attendance_status = 'leave_approved') AS marked_leave,
               SUM(adr.attendance_status = 'absent')         AS marked_absent
          FROM attendance_daily_record adr
         -- Bounded to the reported window. Without this the derived table aggregates all
         -- 131,906 attendance rows before the join throws almost all of them away, which
         -- measured at 141s live — past the 120s gateway limit, so the report would have
         -- 504'd exactly like aon-bucket-shrinkage does.
         WHERE adr.record_date >= ? AND adr.record_date <= ?
         GROUP BY adr.employee_id, adr.record_date
      ) m ON m.employee_id = lr.employee_id AND m.record_date = lr.from_date
     WHERE ${clauses.join(" AND ")}
     GROUP BY DATE_FORMAT(lr.from_date, '%Y-%m'), e.employee_code, employee_name,
              b.branch_name, cc.cost_centre_code, cc.cost_centre_name, p.process_name
     ORDER BY month DESC, days_marked_absent_in_attendance DESC`;

  /*
   * The two bounds for the derived table are prepended, not appended.
   *
   * mysql2 binds `?` strictly by position in the SQL TEXT, and the subquery's WHERE sits
   * inside the JOIN — ahead of the outer WHERE where `clauses`/`params` land. Appending them
   * would feed the scope predicates the dates and the date predicates a branch id: no error,
   * just a silently wrong result set, which is the worst failure this file could have.
   */
  const boundParams = [from, to, ...params];

  try {
    const paged = await fetchPageWithTotal(base, boundParams, options, query, count);
    const total = paged.total;
    const rows = paged.rows as Record<string, unknown>[];
    return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
  } catch (err) {
    rethrowReportSchemaError("leave-attendance-reconciliation", err, base);
  }
}
