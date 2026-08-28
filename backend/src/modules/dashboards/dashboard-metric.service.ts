import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import {
  type DashboardScope,
  buildEmployeeLinkedScopeWhere,
  buildScopeWhere,
  buildScopeWhereEmployees,
} from "../../shared/dashboardScope.js";
import { enrichMetric, type MetricEnrichment } from "./dashboard-target.service.js";
import { logSourceFailure } from "../../shared/apiResponse.js";
import {
  HALF_DAY_STATUS,
  LATEST_COMPLETE_ATTENDANCE_DATE_SQL,
  LEAVE_STATUSES,
  PRESENT_SESSION_STATUSES,
  attendedDaysSql,
  expectedToWorkSql,
  presentSql,
  statusList,
} from "../../shared/attendanceStatus.js";
import { IST_DATE_EXPR } from "../../utils/dateUtils.js";
import { excludeEmployeeShapedCandidatesSql } from "../ats/ats-reporting-scope.js";
import { PENDENCY_CUTOFF_DATE, raisedOnOrAfterCutoffSql } from "./pendency-cutoff.js";

// ─── Candidate-keyed pendency: what does NOT count as outstanding ─────────────
/**
 * `ats_candidate` is a mixed table: 29,888 of its 38,191 rows are legacy EMPLOYEE
 * records imported from db_bill and 50 are seeded test records, against 8,253 genuine
 * candidates. Every candidate-keyed pendency metric here (onboarding, BGV, name match)
 * joined to it without that filter, so migrated and test rows were counted as live
 * queue. The ATS module has drawn this boundary since the record_type backfill ran;
 * the dashboards never adopted it.
 */
const GENUINE_CANDIDATE_SQL = excludeEmployeeShapedCandidatesSql("cand");

/**
 * A candidate the business has already finished with. Work still sitting open against
 * one of these is not pendency anybody can act on — it is a record that was never
 * closed out. Compared case-insensitively: `ats_candidate.status` is free varchar and
 * holds both 'Rejected' and 'rejected' shapes.
 */
const DEAD_CANDIDATE_SQL =
  `LOWER(COALESCE(cand.status, '')) IN ('rejected', 'no show', 'inactive')`;

// ─── Shared metric wrapper shape ──────────────────────────────────────────────
export interface MetricResult {
  value: number | null;
  previousValue: number | null;
  target: number | null;
  variance: number | null;
  /**
   * Percentage difference from the TARGET. Null when no target is configured.
   *
   * Not the same number as changePct, and the two are not interchangeable: a tile labelled
   * "vs last period" must read changePct. Layouts were passing variancePct under exactly
   * that label, which showed nothing only because no target had ever been set — the moment
   * one is, the tile would report distance-from-target as if it were period movement.
   */
  variancePct: number | null;
  /** Percentage change from the PREVIOUS snapshot. Null until two snapshots exist. */
  changePct: number | null;
  status: "ok" | "warn" | "critical" | "unknown";
  trend: "up" | "down" | "stable" | null;
  drilldownApi: string;
  actionUrl: null;
  detail: Record<string, number | null>;
  /**
   * Set when the metric's own query threw. Carries the driver code (e.g.
   * ER_BAD_FIELD_ERROR) so a broken panel is distinguishable from an empty one.
   */
  errorCode?: string | null;
  errorMessage?: string | null;
  /**
   * Rows the metric's source held within the caller's scope. `0` means the metric
   * genuinely measured nothing — which must render as "no data recorded" rather than
   * a confident "0". `null` means the metric does not report it.
   */
  sourceRowCount?: number | null;
  /**
   * The date the metric actually describes, when that is not "now".
   *
   * Processed attendance trails real time, so the attendance metrics anchor on the
   * last substantially-processed day — currently two days back. Without saying so,
   * a tile presents a two-day-old figure as today's, and a low reading looks like a
   * broken panel rather than an old one. `detail` cannot carry it: it is typed to
   * numbers.
   */
  asOf?: string | null;
  /**
   * The date from which this metric counts an item as live pendency, when it applies one.
   * Same reason as `asOf`: `detail` is typed to numbers and cannot carry a date, and a
   * tile that silently drops everything older than a cutoff is worse than one that says
   * so. Null on metrics with no cutoff. See pendency-cutoff.ts.
   */
  cutoffDate?: string | null;
}

/**
 * The single branch/process id to use for TARGET lookup only — never for the metric's
 * own value, which already aggregates the caller's full scope correctly via
 * buildScopeWhere*. Every wrapEnriched() call site used to pass scope.branchIds[0] /
 * scope.processIds[0] unconditionally, so a scope naming several branches or processes
 * (a Process Manager whose one process spans multiple branches, a role with several
 * explicit assignments) had its target/variance/status-vs-target silently compared
 * against whichever branch happened to be first in the array, while the value itself
 * stayed a correct multi-branch aggregate. Returns null — "no specific id, fall through
 * to the org-wide target" — for anything other than exactly one id, rather than
 * guessing. A scope with exactly one branch/process (by far the common case) is
 * unaffected.
 */
function targetScopeId(ids: readonly string[]): string | null {
  return ids.length === 1 ? ids[0] : null;
}

async function wrapEnriched(
  metricCode: string,
  value: number | null,
  detail: Record<string, number | null>,
  status: MetricResult["status"],
  higherIsBetter: boolean,
  branchId?: string | null,
  processId?: string | null,
  sourceRowCount?: number | null,
  cutoffDate?: string | null,
): Promise<MetricResult> {
  let enrichment: Partial<MetricEnrichment> = {
    previousValue: null, target: null, variance: null, variancePct: null,
    trend: undefined, status: undefined,
  };
  if (value !== null) {
    try {
      enrichment = await enrichMetric(metricCode, value, 'monthly', higherIsBetter, branchId, processId);
      // Let enrichment override status only if it has target data; otherwise keep computed status
      if (enrichment.target !== null && enrichment.status && enrichment.status !== 'unknown') {
        const statusMap: Record<string, MetricResult["status"]> = { good: "ok", warning: "warn", critical: "critical", unknown: "unknown" };
        status = statusMap[enrichment.status] ?? status;
      }
    } catch (err) {
      // Enrichment is best-effort — the metric value still stands without a target/trend.
      // Logged because a silent failure here is indistinguishable from an unseeded catalog.
      logSourceFailure("dashboard-metric.enrich", err, { metricCode });
    }
  }
  return {
    value,
    previousValue: enrichment.previousValue ?? null,
    target: enrichment.target ?? null,
    variance: enrichment.variance ?? null,
    variancePct: enrichment.variancePct ?? null,
    changePct: enrichment.changePct ?? null,
    status,
    trend: enrichment.trend ?? null,
    drilldownApi: `/api/dashboards/:dashboardCode/metric/${metricCode}/drilldown`,
    actionUrl: null,
    detail,
    errorCode: null,
    errorMessage: null,
    sourceRowCount: sourceRowCount ?? null,
    cutoffDate: cutoffDate ?? null,
  };
}

/**
 * Returned when a metric query fails. The shape is unchanged from a "no data" result,
 * so callers keep degrading gracefully — but the failure is now always logged, because
 * a silently-swallowed ER_BAD_FIELD_ERROR is indistinguishable from an empty table.
 */
function nullResult(metricCode: string, error?: unknown): MetricResult {
  const failure = error === undefined
    ? null
    : logSourceFailure("dashboard-metric", error, { metricCode });
  return {
    value: null, previousValue: null, target: null, variance: null,
    variancePct: null, changePct: null, status: "unknown", trend: null,
    drilldownApi: `/api/dashboards/:dashboardCode/metric/${metricCode}/drilldown`,
    actionUrl: null, detail: {},
    // Carry the driver code through to the response so the UI can say *why* a tile is
    // blank. Previously every null was reported as a generic "SOURCE_UNAVAILABLE",
    // which read identically whether the table was empty or the SQL was invalid.
    errorCode: failure ? "QUERY_FAILED" : null,
    errorMessage: failure
      ? `${failure.errorCode ?? "query failed"}: ${failure.errorMessage}`
      : null,
    sourceRowCount: null,
  };
}

// ─── Headcount ────────────────────────────────────────────────────────────────
export async function getHeadcountMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhereEmployees(scope, "e");
    const { sql: reqScopeSql, params: reqScopeParams } = buildScopeWhere(scope, "branch_id", "process_id");
    const { sql: availScopeSql, params: availScopeParams } = buildScopeWhere(scope, "e.branch_id", "e.process_id");

    // active/required/available are three independent aggregates — none reads
    // another's result. Previously three sequential awaits (~4.8s measured
    // against the live DB); running them concurrently drops this to the cost
    // of the single slowest query instead of the sum of all three.
    const [[rows], [reqRows], [availRows]] = await Promise.all([
      db.execute<RowDataPacket[]>(
        // active_status alone, plus date_of_joining — not employment_status. The
        // employment_status conjunct is deliberately absent: it made this tile disagree
        // with the headcount and employee-master reports (1,123 vs 1,125 on 2026-08-07)
        // and excluded anyone on probation, notice or suspension from the company's
        // headline headcount, which is wrong — those people are here.
        //
        // date_of_joining is a different question: a pre-boarded record with a FUTURE
        // join date is someone who has not started yet, not someone currently on the
        // payroll. management.service.ts's three headcount queries already require
        // date_of_joining <= CURDATE(); this one didn't, so a super_admin switching
        // between the Super Admin and CEO/Manager dashboard tabs could see two
        // different "headcount" numbers the moment a future-dated hire exists (0
        // employees affected as of 2026-08-13 — this was a latent, not live, gap).
        `SELECT COUNT(*) AS active FROM employees e
          WHERE e.active_status = 1 AND e.date_of_joining <= CURDATE() AND ${scopeSql}`,
        scopeParams
      ),
      // Required HC: today's planned HC from slot requirements, fallback to workforce mandate
      db.execute<RowDataPacket[]>(
        `SELECT COALESCE(
          (SELECT SUM(ws.required_planned_hc)
           FROM wfm_slot_requirement ws
           WHERE ws.requirement_date = ${IST_DATE_EXPR} AND ${reqScopeSql}),
          (SELECT SUM(CEIL(wm.mandated_hc * (1 + wm.shrinkage_pct / 100)))
           FROM workforce_mandate wm
           WHERE wm.active_status = 1 AND ${reqScopeSql})
         ) AS required_hc`,
        [...reqScopeParams, ...reqScopeParams]
      ),
      // Available HC: employees clocked in/active today (IST)
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(DISTINCT s.employee_id) AS available_hc
         FROM wfm_attendance_session s
         JOIN employees e ON e.id = s.employee_id
         WHERE DATE(CONVERT_TZ(s.session_date, '+00:00', '+05:30')) = ${IST_DATE_EXPR}
           AND s.current_status IN (${statusList(PRESENT_SESSION_STATUSES)})
           AND ${availScopeSql}`,
        availScopeParams
      ),
    ]);
    const active = Number((rows[0] as any)?.active ?? 0);

    // Use scheduled/mandated HC, fall back to active headcount as baseline
    const requiredRaw = (reqRows[0] as any)?.required_hc;
    const required = requiredRaw === null || requiredRaw === undefined
      ? null
      : Number(requiredRaw);
    const available = availRows[0] != null ? Number((availRows[0] as any).available_hc ?? 0) : null;
    const short = required != null && available != null ? required - available : null;

    const status: MetricResult["status"] = active === 0 ? "warn" : "ok";
    // `active` doubles as the source row count: a scope that matches no employees must
    // report NO_DATA_IN_SOURCE, not a confident headcount of 0. That is precisely what a
    // team-scoped manager with no mapped reports was seeing.
    return wrapEnriched("HEADCOUNT", active, { active, required, available, short }, status, true, targetScopeId(scope.branchIds), targetScopeId(scope.processIds), active);
  } catch (err) {
    return nullResult("HEADCOUNT", err);
  }
}

// ─── Onboarding ───────────────────────────────────────────────────────────────
export async function getOnboardingMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    // ats_onboarding_bridge has no bridge_status/branch_id/process_id column — the
    // status column is `status`, and the only route to branch/process is via the
    // candidate's applied_for_* fields, which hold NAMES rather than FK ids.
    // The previous query referenced all three nonexistent columns, so this metric
    // raised ER_BAD_FIELD_ERROR on every CEO, HR and Recruiter dashboard load and
    // was silently reported as "no data".
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "bm.id", "pm.id");

    // bridgeRows and otpRows are independent aggregates over different tables —
    // previously two sequential awaits (~3.3s measured against the live DB).
    const [[bridgeRows], [otpRows]] = await Promise.all([
      db.execute<RowDataPacket[]>(
        // `pending` is the number an HR user can still act on, so three groups are
        // held out of it and reported alongside instead of inflating it:
        //
        //   settled   — the bridge already has an employee_id / converted_at, i.e. the
        //               person joined, but nobody advanced status to 'joined' (27 of 507
        //               live on 2026-08-28). Already onboarded is not still onboarding.
        //   closed    — the candidate is Rejected / No Show / Inactive (6 live). Their
        //               onboarding stopped; the bridge row just outlived the decision.
        //   nonCandidate — legacy_employee / test rows in ats_candidate (15 live).
        //
        // Their sum is exposed as `staleNotActionable` so the drop from the raw status
        // count is auditable from the payload rather than being an unexplained shrink.
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN b.status = 'profile_submitted' THEN 1 ELSE 0 END) AS submitted,
           SUM(CASE WHEN b.status IN ('pending','initiated') THEN 1 ELSE 0 END) AS pendingRaw,
           SUM(CASE WHEN b.status IN ('pending','initiated')
                     AND ${GENUINE_CANDIDATE_SQL}
                     AND NOT (${DEAD_CANDIDATE_SQL})
                     AND b.employee_id IS NULL
                     AND b.converted_at IS NULL
                     AND ${raisedOnOrAfterCutoffSql("b.created_at")}
               THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN b.status IN ('pending','initiated')
                     AND ${GENUINE_CANDIDATE_SQL}
                     AND NOT (${DEAD_CANDIDATE_SQL})
                     AND b.employee_id IS NULL
                     AND b.converted_at IS NULL
                     AND NOT (${raisedOnOrAfterCutoffSql("b.created_at")})
               THEN 1 ELSE 0 END) AS pendingBeforeCutoff,
           SUM(CASE WHEN b.status IN ('pending','initiated')
                     AND (b.employee_id IS NOT NULL OR b.converted_at IS NOT NULL)
               THEN 1 ELSE 0 END) AS pendingAlreadyJoined,
           SUM(CASE WHEN b.status IN ('pending','initiated')
                     AND ${GENUINE_CANDIDATE_SQL}
                     AND ${DEAD_CANDIDATE_SQL}
                     AND b.employee_id IS NULL AND b.converted_at IS NULL
               THEN 1 ELSE 0 END) AS pendingClosedCandidate,
           SUM(CASE WHEN b.status IN ('pending','initiated')
                     AND NOT (${GENUINE_CANDIDATE_SQL})
                     AND b.employee_id IS NULL AND b.converted_at IS NULL
               THEN 1 ELSE 0 END) AS pendingNonCandidate,
           SUM(CASE WHEN b.status = 'stuck' THEN 1 ELSE 0 END) AS stuck,
           SUM(CASE WHEN b.status = 'joined' THEN 1 ELSE 0 END) AS joined
         FROM ats_onboarding_bridge b
         LEFT JOIN ats_candidate cand ON cand.id = b.candidate_id
         LEFT JOIN branch_master bm ON bm.branch_name = cand.applied_for_branch
         LEFT JOIN process_master pm ON pm.process_name = cand.applied_for_process
         WHERE ${scopeSql}`,
        scopeParams
      ),
      // This subquery carried no scope predicate, so an org-wide OTP count leaked into
      // every branch- and process-scoped dashboard. candidate_onboarding_profile has no
      // branch/process column, so it is scoped the same way the bridge is — through the
      // candidate's applied_for_* fields.
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS otp_verified
           FROM candidate_onboarding_profile cop
           LEFT JOIN ats_candidate cand ON cand.id = cop.candidate_id
           LEFT JOIN branch_master bm ON bm.branch_name = cand.applied_for_branch
           LEFT JOIN process_master pm ON pm.process_name = cand.applied_for_process
          WHERE cop.otp_verified = 1
            AND ${GENUINE_CANDIDATE_SQL}
            AND ${scopeSql}`,
        scopeParams
      ),
    ]);

    const r = bridgeRows[0] as any;
    const submitted = Number(r?.submitted ?? 0);
    const pending = Number(r?.pending ?? 0);
    const pendingRaw = Number(r?.pendingRaw ?? 0);
    const pendingAlreadyJoined = Number(r?.pendingAlreadyJoined ?? 0);
    const pendingClosedCandidate = Number(r?.pendingClosedCandidate ?? 0);
    const pendingNonCandidate = Number(r?.pendingNonCandidate ?? 0);
    const pendingBeforeCutoff = Number(r?.pendingBeforeCutoff ?? 0);
    const stuck = Number(r?.stuck ?? 0);
    const joined = Number(r?.joined ?? 0);
    const total = Number(r?.total ?? 0);
    // The SQL counts otp_verified = 1, so this is the number VERIFIED — the key was
    // named otpPending, which says the opposite. The panel labels the row "OTP
    // Verified", so the displayed number was right and the key name was wrong; a
    // reader reconciling the two could reasonably have concluded either was.
    // Renamed to match what it counts. `otpPending` is kept alongside for one
    // release so any other consumer does not silently lose the value.
    const otpVerified = Number((otpRows[0] as any)?.otp_verified ?? 0);

    const status: MetricResult["status"] = stuck > 0 ? "critical" : pending > 10 ? "warn" : "ok";
    return wrapEnriched(
      "ONBOARDING",
      submitted + pending,
      {
        submitted,
        pending,
        otpVerified,
        otpPending: otpVerified,
        stuck,
        joined,
        total,
        // Raw status count and the three reasons it exceeds `pending`. Kept in the
        // payload so a reader can reconcile this tile against a plain
        // `WHERE status = 'pending'` query without having to read this file.
        pendingRaw,
        pendingAlreadyJoined,
        pendingClosedCandidate,
        pendingNonCandidate,
        // Actionable in every respect except age — raised before the cutoff. Reported so
        // the drop from pendingRaw is fully explained by the payload.
        pendingBeforeCutoff,
        staleNotActionable: pendingAlreadyJoined + pendingClosedCandidate + pendingNonCandidate,
      },
      status, true, targetScopeId(scope.branchIds), targetScopeId(scope.processIds), total,
      PENDENCY_CUTOFF_DATE,
    );
  } catch (err) {
    return nullResult("ONBOARDING", err);
  }
}

// ─── Attendance ───────────────────────────────────────────────────────────────
export async function getAttendanceMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildEmployeeLinkedScopeWhere(
      scope,
      "employee_id",
      "branch_id",
      "process_id",
    );

    // Reused across the live-present query and the coverage query below —
    // both filter on the same "e" alias, so build it once.
    const employeeScopeE = buildScopeWhereEmployees(scope, "e");

    // liveRows, dayRows and the coverage check (further below) are mutually
    // independent — none reads another's result. They were previously four
    // sequential awaits; against the live DB (~160ms RTT off-LAN, plus the
    // coverage query's own cost) that serialized to 25s+. Firing them
    // concurrently collapses that to roughly the cost of the slowest one.
    // Only the main `rows` query genuinely depends on anchorDate and stays
    // sequential after this point. Dispatch order below is live, then day,
    // then coverage — dashboard-metric-calculation.test.ts pins that order via
    // mocked call sequence, so kick off live/day before coverage even though
    // all three run concurrently regardless of statement order.
    const livePromise = db.execute<RowDataPacket[]>(
      // Use live WFM attendance sessions for real-time present count
      `SELECT COUNT(DISTINCT s.employee_id) AS live_present
       FROM wfm_attendance_session s
       JOIN employees e ON e.id = s.employee_id
       WHERE DATE(s.session_date) = ${IST_DATE_EXPR}
         AND s.current_status IN (${statusList(PRESENT_SESSION_STATUSES)})
         AND ${employeeScopeE.sql}`,
      employeeScopeE.params
    );
    const dayPromise = db.execute<RowDataPacket[]>(
      // Processed attendance trails real time: the most recent record_date routinely holds
      // a handful of stray rows while the last complete day is one or two days back.
      // Anchoring on today therefore reported ~0 present against several hundred actual.
      // Anchor on the latest day that carries a usable number of records instead, and
      // report which day that was so the tile can label itself.
      `SELECT ${LATEST_COMPLETE_ATTENDANCE_DATE_SQL} AS record_date`,
    );
    const coveragePromise: Promise<number | null> = (async () => {
      try {
        const [coverageRows] = await db.execute<RowDataPacket[]>(
          // Was one NOT EXISTS with `i.employee_code = e.employee_code OR
          // i.employee_code = e.biometric_code`. The OR on the correlated join
          // key defeats idx_biometric_daily_employee_date — MySQL falls back to
          // a full scan of integration_biometric_daily (35,951 rows) per probe,
          // measured at ~24-27s standalone on the live DB (org-wide scope).
          // Splitting into two NOT EXISTS clauses is the same predicate by De
          // Morgan's law (NOT(A OR B) == NOT A AND NOT B) but lets each one use
          // the index — 8.6x faster (~3.1s) with an identical result, verified
          // against production (uncovered=137 both ways).
          //
          // Also excludes employees at branches marked closed
          // (branch_master.active_status = 0): 46% of the 137 were at Delhi
          // Office / Head Office, both closed — still flagged "active" as
          // employee records, which is a records-hygiene question, not a
          // live attendance-enrollment gap. Verified live: 137 -> 74 with
          // this filter, matching the closed-branch share exactly. LEFT JOIN
          // + `b.id IS NULL` keeps employees with no branch assigned at all
          // in the count — absence of a branch link isn't evidence the
          // branch is closed, so it isn't grounds to exclude them.
          `SELECT COUNT(*) AS uncovered
             FROM employees e
             LEFT JOIN branch_master b ON b.id = e.branch_id
            WHERE e.active_status = 1
              AND (b.active_status = 1 OR b.id IS NULL)
              AND NOT EXISTS (
                    SELECT 1 FROM integration_biometric_daily i
                     WHERE i.employee_code = e.employee_code
                       AND i.biometric_minutes > 0
                       AND i.activity_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY))
              AND NOT EXISTS (
                    SELECT 1 FROM integration_biometric_daily i2
                     WHERE i2.employee_code = e.biometric_code
                       AND i2.biometric_minutes > 0
                       AND i2.activity_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY))
              AND ${employeeScopeE.sql}`,
          [...employeeScopeE.params],
        );
        return Number((coverageRows[0] as any)?.uncovered ?? 0);
      } catch (err) {
        // Left null rather than 0: "nobody is unenrolled" is the reassuring answer, and
        // reporting it on a failed query would hide the very gap this figure exists to show.
        logSourceFailure("dashboard-metric.attendance-coverage", err, { metricCode: "ATTENDANCE" });
        return null;
      }
    })();

    const [[liveRows], [dayRows]] = await Promise.all([livePromise, dayPromise]);
    const anchorDate = (dayRows[0] as any)?.record_date ?? null;
    if (!anchorDate) {
      const noAttendanceSourceEarly = await coveragePromise;
      void noAttendanceSourceEarly;
      return wrapEnriched("ATTENDANCE", null, {}, "unknown", true,
        targetScopeId(scope.branchIds), targetScopeId(scope.processIds), 0);
    }

    // Status vocabulary comes from shared/attendanceStatus.ts. Previously this counted
    // attendance_status='late' (not an ENUM member — always 0), omitted week_off_worked
    // from present, ignored half_day entirely, and left leave_approved inside the
    // expected-to-work denominator.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         ${presentSql()} AS present,
         SUM(CASE WHEN attendance_status = '${HALF_DAY_STATUS}' THEN 1 ELSE 0 END) AS halfDay,
         SUM(CASE WHEN attendance_status = 'absent' THEN 1 ELSE 0 END) AS absent,
         SUM(CASE WHEN late_mark = 1 THEN 1 ELSE 0 END) AS late,
         SUM(CASE WHEN attendance_status = 'missing_punch' THEN 1 ELSE 0 END) AS missedPunch,
         SUM(CASE WHEN attendance_status IN (${statusList(LEAVE_STATUSES)}) THEN 1 ELSE 0 END) AS onLeave,
         ${attendedDaysSql()} AS attended_days,
         ${expectedToWorkSql()} AS expected_to_work,
         COUNT(*) AS total
       FROM attendance_daily_record
       WHERE record_date = ? AND ${scopeSql}`,
      [anchorDate, ...scopeParams]
    );

    const livePresent = Number((liveRows[0] as any)?.live_present ?? 0);

    // Live and processed attendance are intentionally kept separate. The rate
    // uses only processed attendance numerator and denominator.
    const r = rows[0] as any;
    const present = Number(r?.present ?? 0);
    const halfDay = Number(r?.halfDay ?? 0);
    const absent = Number(r?.absent ?? 0);
    const late = Number(r?.late ?? 0);
    const missedPunch = Number(r?.missedPunch ?? 0);
    const onLeave = Number(r?.onLeave ?? 0);
    const attendedDays = Number(r?.attended_days ?? 0);
    const expectedToWork = Number(r?.expected_to_work ?? 0);
    const totalRecords = Number(r?.total ?? 0);

    // Half days count as 0.5, matching the employee self dashboard exactly so the same
    // person cannot see two different attendance percentages.
    const denominator = expectedToWork > 0 ? expectedToWork : totalRecords;
    const attendanceRate = denominator > 0 ? Math.round((attendedDays / denominator) * 100) : null;

    // Employees who cannot register a punch at all, as opposed to those who did not attend.
    //
    // 352 of 1,344 active employees have never produced a single biometric minute in 30
    // days — concentrated at branches that are now closed (Delhi Office 52, KARNAL 51,
    // AHEMDABAD HOUSE 46) plus AHMEDABAD-JALDARSHAN 40 and HEAD OFFICE 16. The attendance
    // engine correctly marks them missing_punch, because they genuinely have no punch data.
    //
    // Without this figure the rate is uninterpretable: org attendance reads 28% on a day
    // like 2026-07-30 and looks like a workforce that stopped showing up, when a quarter of
    // the denominator is people with no attendance source enrolled. It is reported rather
    // than removed from the denominator — excluding them would quietly flatter the number
    // and hide the enrolment gap, which is the thing actually worth fixing.
    //
    // Kicked off in parallel with liveRows/dayRows above (see coveragePromise) —
    // by this point it has been running concurrently, not queued behind them.
    const noAttendanceSource = await coveragePromise;

    const status: MetricResult["status"] =
      attendanceRate === null ? "unknown" : attendanceRate < 70 ? "critical" : attendanceRate < 85 ? "warn" : "ok";

    // Share of the anchored day that is still unreconciled.
    //
    // The anchor picks the last substantially-processed day, but "has rows" is not
    // "has been reconciled": 2026-08-02 carries 1,123 rows of which 845 are
    // missing_punch, giving 19% present, where 2026-07-30 has 1 missing punch and
    // 78%. Both are real, and the rule deliberately does not skip the bad day —
    // 2026-07-27 genuinely had 541 missing punches and that is operational badness
    // worth seeing. But a 19% reading with no explanation looks like a broken panel,
    // so the reason is reported alongside it and the tile can say why.
    const unreconciledPct = totalRecords > 0
      ? Math.round((missedPunch / totalRecords) * 100)
      : null;

    const result = await wrapEnriched("ATTENDANCE", attendanceRate, {
      present,
      // The numerator the percentage is actually built from: present + half a day for
      // each half day. `present` alone was published as the metric's numerator, so the
      // envelope advertised 214/308 = 69% beside a value of 81% and anyone checking the
      // tile's arithmetic — or building a drilldown off numerator/denominator — got a
      // different answer than the tile. See ATTENDANCE numeratorKey in
      // dashboard-definition.service.ts.
      attendedDays,
      halfDay,
      livePresent,
      absent,
      late,
      missedPunch,
      onLeave,
      expectedToWork: denominator,
      totalRecords,
      attendanceRate,
      noAttendanceSource,
      unreconciledPct,
    }, status, true, targetScopeId(scope.branchIds), targetScopeId(scope.processIds), totalRecords);

    // The day this actually describes — two days back today. Presenting it as
    // "now" is what makes an old figure look like a broken one.
    return { ...result, asOf: String(anchorDate).slice(0, 10) };
  } catch (err) {
    return nullResult("ATTENDANCE", err);
  }
}

// ─── Payroll Readiness ────────────────────────────────────────────────────────
/**
 * "Can this employee actually be paid?" — asked of the table the payment file reads.
 *
 * The tile used to test `employees.bank_account_number` alone, and reported 130 active
 * employees as unpayable. Checked against db_bill on 2026-08-28, 126 of those 130 had an
 * account number and IFSC in `masjclrentry`, and the account matched what their salary
 * was ACTUALLY paid into (`salary_data.AcNo`) on 1,034 of 1,034 checkable cases.
 *
 * `employees.bank_account_number` is frozen legacy data with **no writer anywhere in the
 * application** — bank-payment-readiness.service.ts:760 says so, and points out that
 * bank-advice pays from it while neft-transfer-file and /bank-export pay from
 * `employee_bank_detail`. Measuring payability against the column nothing writes, while
 * payment happens from a different table, is why the tile and reality diverged.
 *
 * So this asks the question of `employee_bank_detail` — same join the NEFT export uses
 * (`is_primary = 1 AND active_status = 1`) — and requires a digits-only 6-20 account,
 * which is what rejects the Excel damage the legacy exports carry (`4.57E+11` is not an
 * account number but is very much non-empty). The legacy column is kept as a fallback so
 * an employee who has one and no detail row is still counted as payable.
 */
const PAYABLE_BANK_SQL = `(
  EXISTS (
    SELECT 1 FROM employee_bank_detail bd
     WHERE bd.employee_id = e.id
       AND bd.is_primary = 1
       AND bd.active_status = 1
       AND CONVERT(bd.account_number USING utf8mb4) REGEXP '^[0-9]{6,20}$'
  )
  OR (e.bank_account_number IS NOT NULL AND e.bank_account_number <> '')
)`;

/**
 * An employee holds a PAN payroll can actually use.
 *
 * Two things the previous `pan_number IS NULL OR pan_number = ''` test got wrong, both
 * measured live on 2026-08-28 across 1,120 active employees:
 *
 *  1. No format check. Seven employees past the joining grace hold a value that cannot be
 *     a PAN — CTRPC455K, CPWPD2907, GJKPMO583H, NPRK4925R, SCOPS624C, BSPPTO806H,
 *     JWZPS2362, FWHPR13R — eight to ten characters in the wrong shape. Every one counted
 *     as payroll-ready here, while payroll-governance.service.ts raises
 *     INVALID_PAN_FORMAT on exactly the same rows (a blocker under auto-TDS). Two gates
 *     answering "can this employee be paid" must not disagree about what a PAN is, so
 *     this uses that file's regex verbatim.
 *
 *  2. `pan_number_encrypted` was never consulted. Six employees hold ciphertext with an
 *     empty plaintext column and were reported as missing a PAN. Every payroll read of
 *     this field goes through resolvePii(pan_number_encrypted, pan_number), which PREFERS
 *     the ciphertext (payroll.routes.ts, payroll-more.routes.ts) — payroll reads those six
 *     without difficulty.
 *
 * Ciphertext counts only where the plaintext column is empty. The encryption backfill
 * encrypted whatever plaintext was there at the time, so ciphertext sitting beside a
 * malformed plaintext value is the encryption OF that malformed value, not a second,
 * better PAN — seven of the eight bad rows above carry exactly that pairing. Preferring
 * ciphertext unconditionally would silently re-admit them.
 */
const PAN_USABLE_SQL = `(
  (e.pan_number IS NOT NULL AND UPPER(TRIM(e.pan_number)) REGEXP '^[A-Z]{5}[0-9]{4}[A-Z]$')
  OR (
    (e.pan_number IS NULL OR e.pan_number = '')
    AND e.pan_number_encrypted IS NOT NULL AND e.pan_number_encrypted <> ''
  )
)`;

/** Stored, but in a shape the Income Tax Act does not recognise. */
const PAN_INVALID_SQL = `(
  e.pan_number IS NOT NULL AND e.pan_number <> ''
  AND UPPER(TRIM(e.pan_number)) NOT REGEXP '^[A-Z]{5}[0-9]{4}[A-Z]$'
)`;

/** No PAN on file at all, in either column. */
const PAN_ABSENT_SQL = `(
  (e.pan_number IS NULL OR e.pan_number = '')
  AND (e.pan_number_encrypted IS NULL OR e.pan_number_encrypted = '')
)`;

export async function getPayrollReadinessMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhereEmployees(scope, "e");

    // Tenure grace window: bank/PAN take a few weeks of normal onboarding
    // paperwork to reach the system, and UAN allocation is a statutory EPFO
    // process that routinely takes 30-45+ days for a brand-new UAN — neither
    // is a data-quality problem for a recent joiner, only a same-day yardstick
    // measuring a process that isn't instant.
    //
    // Tightened from the original 45/90 to 30/60 (still an interim estimate,
    // not a confirmed SLA — see OPEN QUESTION below): 30 days ties bank/PAN to
    // the actual operational trigger — an employee's first payroll cycle,
    // when missing bank details become a real disbursement problem, rather
    // than an arbitrary round number. 60 days reflects EPFO's realistic
    // KYC/seeding lag for a *fresh* UAN. Verified live before/after: tightening
    // does surface more current, near-term gaps rather than hiding them —
    // missingBank 81->91, missingPan 196->203, missingUan 342->471 on the
    // live employees table. Checked whether `employees` distinguishes a
    // brand-new UAN from a transfer-from-previous-employer UAN (the latter
    // should clear in days, not weeks, and would justify a shorter window for
    // that subset) — no such column exists, only the bare `uan_number` field,
    // so this stays a single blended threshold.
    //
    // OPEN QUESTION (not yet confirmed by payroll/HR policy owner): 30/60 is
    // still my own estimate, not a documented SLA — statutory_config has no
    // grace-period key to source this from. If the real onboarding SLA or UAN
    // turnaround differs, these two numbers need to change; re-run the same
    // before/after blockerCount comparison once a real figure is confirmed.
    //
    // Tried to derive this empirically instead of guessing (live, read-only):
    // no usable signal exists. 99.96% of employee_bank_detail rows were bulk-
    // inserted in two migration batches (11,671 rows on 2026-06-02, 1,092 on
    // 2026-06-11) — that's the migration script's run date, not each
    // employee's actual paperwork-completion date. The remaining 5 rows have
    // multi-year DATEDIFF-to-joining, not onboarding signal either. audit_log
    // and employee_epf_audit_log (the only field-level change-history tables)
    // are both empty — no way to reconstruct "when was this actually filled
    // in" from this database. Do not re-attempt this empirical approach until
    // enough post-migration organic hires accumulate; until then this is a
    // policy number, not a computable one.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN NOT ${PAYABLE_BANK_SQL}
                   AND DATEDIFF(CURDATE(), date_of_joining) > 30 THEN 1 ELSE 0 END) AS missingBank,
         -- Payable by SOME route (above) is not the same question as payable by NEFT.
         -- bank-advice draws on employees.bank_account_number; the NEFT file and
         -- /bank-export draw on employee_bank_detail. An employee with only the legacy
         -- column is payable by one file and invisible to the other, so both counts are
         -- reported rather than collapsing them into a single reassuring number.
         SUM(CASE WHEN NOT EXISTS (
               SELECT 1 FROM employee_bank_detail bd
                WHERE bd.employee_id = e.id AND bd.is_primary = 1 AND bd.active_status = 1
                  AND CONVERT(bd.account_number USING utf8mb4) REGEXP '^[0-9]{6,20}$')
                   AND DATEDIFF(CURDATE(), date_of_joining) > 30 THEN 1 ELSE 0 END) AS missingNeftBank,
         -- No PAN in either column. Split from invalidPan deliberately: "232 have no PAN"
         -- and "7 hold one that will be rejected" are different pieces of work.
         SUM(CASE WHEN ${PAN_ABSENT_SQL}
                   AND DATEDIFF(CURDATE(), date_of_joining) > 30 THEN 1 ELSE 0 END) AS missingPan,
         SUM(CASE WHEN ${PAN_INVALID_SQL}
                   AND DATEDIFF(CURDATE(), date_of_joining) > 30 THEN 1 ELSE 0 END) AS invalidPan,
         SUM(CASE WHEN (uan_number IS NULL OR uan_number = '')
                   AND DATEDIFF(CURDATE(), date_of_joining) > 60 THEN 1 ELSE 0 END) AS missingUan,
         SUM(CASE WHEN
               (${PAYABLE_BANK_SQL} OR DATEDIFF(CURDATE(), date_of_joining) <= 30) AND
               (${PAN_USABLE_SQL} OR DATEDIFF(CURDATE(), date_of_joining) <= 30)
             THEN 1 ELSE 0 END) AS readyCount
       FROM employees e
       -- active_status alone, matching the headcount tile and the employee reports.
       -- The employment_status conjunct dropped probation/notice/suspended staff out of
       -- this denominator, so a missing bank account or PAN on one of them never showed
       -- as a payroll blocker.
       WHERE e.active_status = 1 AND ${scopeSql}`,
      scopeParams
    );

    const r = rows[0] as any;
    const total = Number(r.total ?? 0);
    const readyCount = Number(r.readyCount ?? 0);
    const missingBank = Number(r.missingBank ?? 0);
    const missingPan = Number(r.missingPan ?? 0);
    const invalidPan = Number(r.invalidPan ?? 0);
    const missingUan = Number(r.missingUan ?? 0);
    const blockerCount = total - readyCount;

    const status: MetricResult["status"] =
      blockerCount === 0 ? "ok" : blockerCount > 10 ? "critical" : "warn";

    // sourceRowCount was omitted, so NO_DATA_IN_SOURCE could never fire for this
    // metric and a scope containing no employees rendered "0 of 0 ready" — four
    // confident zeros that look like a clean bill of health. `total` is the
    // population the metric measured, which is exactly what that flag needs.
    return wrapEnriched(
      "PAYROLL_READINESS",
      readyCount,
      {
        total, readyCount, blockerCount, missingBank, missingPan, invalidPan, missingUan,
        // Cannot be reached by the NEFT file specifically — see the note in the query.
        missingNeftBank: Number(r.missingNeftBank ?? 0),
      },
      status, true, targetScopeId(scope.branchIds), targetScopeId(scope.processIds), total
    );
  } catch (err) {
    return nullResult("PAYROLL_READINESS", err);
  }
}

// ─── Incentive ────────────────────────────────────────────────────────────────
export async function getIncentiveMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    // The status column is `status`, not `batch_status` — the old name raised
    // ER_BAD_FIELD_ERROR on every payroll dashboard load. branch_id/process_id are real.
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "branch_id", "process_id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS source_rows,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pendingBatches,
         SUM(CASE WHEN status = 'pending' THEN total_amount ELSE 0 END) AS pendingAmount,
         SUM(CASE WHEN status = 'approved' THEN total_amount ELSE 0 END) AS approvedAmount,
         SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejectedBatches
       FROM incentive_upload_batch
       WHERE ${scopeSql}`,
      scopeParams
    );

    const r = rows[0] as any;
    const pendingBatches = Number(r.pendingBatches ?? 0);
    const pendingAmount = Number(r.pendingAmount ?? 0);
    const approvedAmount = Number(r.approvedAmount ?? 0);
    const rejectedBatches = Number(r.rejectedBatches ?? 0);

    const status: MetricResult["status"] =
      rejectedBatches > 0 ? "warn" : pendingBatches > 5 ? "warn" : "ok";

    return wrapEnriched(
      "INCENTIVE",
      pendingBatches,
      { pendingBatches, pendingAmount, approvedAmount, rejectedBatches },
      status, false, targetScopeId(scope.branchIds), targetScopeId(scope.processIds), Number(r.source_rows ?? 0)
    );
  } catch (err) {
    return nullResult("INCENTIVE", err);
  }
}

// ─── TAT ──────────────────────────────────────────────────────────────────────
export async function getTatMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    // task_tat_instance carries branch_id but no process_id, so passing a process
    // column raised ER_BAD_FIELD_ERROR for every process-scoped role. Branch scope is
    // the finest granularity this source supports.
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "branch_id", "branch_id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS source_rows,
         SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count,
         SUM(CASE WHEN due_at < NOW() AND status NOT IN ('closed','resolved') THEN 1 ELSE 0 END) AS overdue,
         SUM(CASE WHEN status = 'sla_breached' THEN 1 ELSE 0 END) AS breached,
         AVG(CASE WHEN status NOT IN ('closed','resolved')
             THEN TIMESTAMPDIFF(HOUR, created_at, NOW()) ELSE NULL END) AS avgAgeHours
       FROM task_tat_instance
       WHERE ${scopeSql}`,
      scopeParams
    );

    const r = rows[0] as any;
    const open = Number(r.open_count ?? 0);
    const overdue = Number(r.overdue ?? 0);
    const breached = Number(r.breached ?? 0);
    const avgAgeHours = r.avgAgeHours !== null ? Math.round(Number(r.avgAgeHours)) : null;

    const status: MetricResult["status"] =
      breached > 0 ? "critical" : overdue > 0 ? "warn" : "ok";

    return wrapEnriched("TAT", open, { open, overdue, breached, avgAgeHours }, status, false, targetScopeId(scope.branchIds), targetScopeId(scope.processIds), Number(r.source_rows ?? 0));
  } catch (err) {
    return nullResult("TAT", err);
  }
}

// ─── Resignation ──────────────────────────────────────────────────────────────
export async function getResignationMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    // exit_request has no exit_status column (it is `status`) and no branch/process
    // columns, so the previous query raised ER_BAD_FIELD_ERROR on every dashboard that
    // shows resignations. Scope routes through the employee instead.
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "e.branch_id", "e.process_id");

    // `status` is varchar(50) with no declared vocabulary, so the named buckets are a
    // guess at what it holds. They were wrong: the only value in production is
    // 'exited' (all 2 rows), which is terminal — someone who has left is not an active
    // exit — yet it was excluded only from 'completed'/'cancelled' and so counted as
    // active. The panel therefore read "2 active, 0 pending, 0 accepted, 0 withdrawn":
    // a total that contradicts its own breakdown.
    //
    // Two changes. 'exited' joins the terminal list, compared case-insensitively
    // because nothing constrains the column's casing. And an `other` bucket catches
    // any active status not otherwise named, so totalActive always equals the sum of
    // the buckets — a value nobody anticipated shows up as "other" instead of
    // silently inflating the headline.
    // sourceRows counts every exit in scope regardless of status, so an empty table
    // renders "No data recorded yet" rather than four confident zeros. Filtering in
    // the SELECT rather than the WHERE is what makes both numbers available at once.
    const ACTIVE = `LOWER(er.status) NOT IN ('completed','cancelled','exited')`;
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS sourceRows,
         SUM(CASE WHEN ${ACTIVE} THEN 1 ELSE 0 END) AS totalActive,
         SUM(CASE WHEN ${ACTIVE} AND LOWER(er.status) = 'pending_discussion' THEN 1 ELSE 0 END) AS pendingDiscussion,
         SUM(CASE WHEN ${ACTIVE} AND LOWER(er.status) = 'accepted' THEN 1 ELSE 0 END) AS accepted,
         SUM(CASE WHEN ${ACTIVE} AND LOWER(er.status) = 'withdrawn' THEN 1 ELSE 0 END) AS withdrawn,
         SUM(CASE WHEN ${ACTIVE} AND LOWER(er.status)
                  NOT IN ('pending_discussion','accepted','withdrawn') THEN 1 ELSE 0 END) AS other
       FROM exit_request er
       LEFT JOIN employees e ON e.id = er.employee_id
       WHERE ${scopeSql}`,
      scopeParams
    );

    const r = rows[0] as any;
    const totalActive = Number(r.totalActive ?? 0);
    const pendingDiscussion = Number(r.pendingDiscussion ?? 0);
    const accepted = Number(r.accepted ?? 0);
    const withdrawn = Number(r.withdrawn ?? 0);
    const other = Number(r.other ?? 0);

    const status: MetricResult["status"] =
      pendingDiscussion > 5 ? "critical" : pendingDiscussion > 0 ? "warn" : "ok";

    return wrapEnriched(
      "RESIGNATION",
      totalActive,
      { pendingDiscussion, accepted, withdrawn, other, totalActive },
      status, false, targetScopeId(scope.branchIds), targetScopeId(scope.processIds),
      Number(r.sourceRows ?? 0)
    );
  } catch (err) {
    return nullResult("RESIGNATION", err);
  }
}

// DPDP withdrawal
export async function getDpdpWithdrawalMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "e.branch_id", "e.process_id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN dcw.status IN ('submitted','in_review') THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN dcw.status = 'approved' THEN 1 ELSE 0 END) AS approved,
         SUM(CASE WHEN dcw.status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
         SUM(CASE WHEN dcw.processing_hold_active = 1 THEN 1 ELSE 0 END) AS holdsActive,
         SUM(CASE WHEN dcw.status IN ('submitted','in_review') AND dcw.created_at < DATE_SUB(NOW(), INTERVAL 72 HOUR) THEN 1 ELSE 0 END) AS overdue
       FROM dpdp_consent_withdrawal dcw
       LEFT JOIN employees e ON e.user_id = dcw.requester_id
       WHERE ${scopeSql}`,
      scopeParams
    );

    const r = rows[0] as any;
    const pending = Number(r.pending ?? 0);
    const overdue = Number(r.overdue ?? 0);
    const status: MetricResult["status"] = overdue > 0 ? "critical" : pending > 0 ? "warn" : "ok";

    return wrapEnriched(
      // "DPDP_WITHDRAWAL" here, but the catalog defines this metric as "DPDP". Targets and
      // snapshots are keyed on the code passed to enrichMetric, so the two spellings meant a
      // DPDP target could never be matched and a DPDP snapshot could never be read back.
      // Invisible while both tables were empty; a permanent silent no-op the moment they
      // were seeded. dashboard-metric-code-contract.test.ts now pins the two together.
      "DPDP",
      pending,
      {
        total: Number(r.total ?? 0),
        pending,
        approved: Number(r.approved ?? 0),
        rejected: Number(r.rejected ?? 0),
        holdsActive: Number(r.holdsActive ?? 0),
        overdue,
      },
      status,
      false,
      targetScopeId(scope.branchIds),
      targetScopeId(scope.processIds),
      // sourceRowCount was omitted, so it arrived as undefined rather than 0 and
      // adaptLegacyMetric's `result.sourceRowCount === 0` test never fired. The tile
      // therefore rendered a confident "Pending DPDP requests: 0" from a table holding
      // literally nothing — the one shape the NO_DATA_IN_SOURCE guard exists to prevent,
      // bypassed by omission rather than by design. dpdp_consent_withdrawal held 0 rows
      // on 2026-08-28.
      Number(r.total ?? 0),
    );
  } catch (err) {
    return nullResult("DPDP", err);
  }
}

// Appointment letter eSign
export async function getAppointmentEsignMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "e.branch_id", "e.process_id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN (alr.current_state IN ('candidate_esign_pending','company_sign_pending','override_requested')
                   OR alr.candidate_esign_status = 'pending'
                   OR alr.company_sign_status = 'pending')
                   AND ${raisedOnOrAfterCutoffSql("alr.created_at")}
             THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN (alr.current_state IN ('candidate_esign_pending','company_sign_pending','override_requested')
                   OR alr.candidate_esign_status = 'pending'
                   OR alr.company_sign_status = 'pending')
                   AND NOT (${raisedOnOrAfterCutoffSql("alr.created_at")})
             THEN 1 ELSE 0 END) AS pendingBeforeCutoff,
         SUM(CASE WHEN alr.current_state = 'candidate_esign_pending' OR alr.candidate_esign_status = 'pending' THEN 1 ELSE 0 END) AS candidatePending,
         SUM(CASE WHEN alr.current_state = 'company_sign_pending' OR alr.company_sign_status = 'pending' THEN 1 ELSE 0 END) AS companyPending,
         SUM(CASE WHEN alr.current_state = 'override_requested' THEN 1 ELSE 0 END) AS overrideRequested,
         SUM(CASE WHEN alr.current_state IN ('completed','locked') OR alr.pdf_locked = 1 THEN 1 ELSE 0 END) AS completed
       FROM appointment_letter_request alr
       LEFT JOIN employees e ON e.id = alr.employee_id
       WHERE ${scopeSql}`,
      scopeParams
    );

    const r = rows[0] as any;
    const pending = Number(r.pending ?? 0);
    const overrideRequested = Number(r.overrideRequested ?? 0);
    const status: MetricResult["status"] = overrideRequested > 0 ? "warn" : pending > 10 ? "warn" : "ok";

    return wrapEnriched(
      "APPOINTMENT_ESIGN",
      pending,
      {
        total: Number(r.total ?? 0),
        pending,
        candidatePending: Number(r.candidatePending ?? 0),
        companyPending: Number(r.companyPending ?? 0),
        overrideRequested,
        completed: Number(r.completed ?? 0),
        pendingBeforeCutoff: Number(r.pendingBeforeCutoff ?? 0),
      },
      status,
      false,
      targetScopeId(scope.branchIds),
      targetScopeId(scope.processIds),
      // The row count IS available here — it is `total`. Passing null meant an empty
      // appointment_letter_request table rendered "0 pending" as a measurement rather than
      // "no data recorded yet".
      Number(r.total ?? 0),
      PENDENCY_CUTOFF_DATE,
    );
  } catch (err) {
    return nullResult("APPOINTMENT_ESIGN", err);
  }
}

// ─── BGV ──────────────────────────────────────────────────────────────────────
/**
 * BGV pendency, counted in **candidates** — not in checks.
 *
 * `candidate_bgv_check` holds one row per verification (aadhaar, pan, bank, criminal,
 * …), so a single candidate contributes up to eleven rows. Counting rows made the tile
 * read 280 "BGV Pending" against 121 real people, and the number moved whenever the
 * check mix changed rather than when the queue did. Every consumer of this metric
 * ("BGV Pending — Approvals pending" on CEO and HR) is asking how many *people* are
 * waiting, so the headline is now DISTINCT candidates; the check-level totals stay in
 * `checksPending` / `totalChecks` so the drilldown and the old reading are still
 * available.
 *
 * Buckets are a partition of the candidates in scope, evaluated with precedence
 * breached > flagged > pending > cleared, so they sum to `candidates` exactly. A person
 * with one failed check and three still queued is one flagged candidate, not one of each.
 *
 * Status vocabulary is taken from the values actually present: verified, failed,
 * not_started, manual_review, mismatch, queued, waived. `waived` counts as settled —
 * it is an explicit decision to skip the check, not an outstanding one.
 *
 * Legacy/test candidates and candidates the business has already rejected are excluded;
 * both are reported separately so the exclusion is visible rather than silent.
 */
export async function getBgvMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    // candidate_bgv_check has no `bgv_status` column (it is `status`), and
    // ats_onboarding_bridge carries no branch/process columns to scope by — so an
    // earlier query raised ER_BAD_FIELD_ERROR and the BGV tile was permanently blank.
    // Scope routes via the candidate, as the other candidate-keyed metrics do.
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "bm.id", "pm.id");

    const OUTSTANDING_STATUS = `(bgv.status IS NULL OR bgv.status IN ('pending','not_started','queued','manual_review','in_progress'))`;
    // A check still open but raised before the cutoff is history, not queue. Counted
    // separately as `outstandingBeforeCutoff` so the tile can say what it set aside.
    const OUTSTANDING = `(${OUTSTANDING_STATUS} AND ${raisedOnOrAfterCutoffSql("bgv.created_at")})`;
    const OUTSTANDING_OLD = `(${OUTSTANDING_STATUS} AND NOT (${raisedOnOrAfterCutoffSql("bgv.created_at")}))`;
    const FLAGGED = `bgv.status IN ('flagged','failed','mismatch','discrepancy')`;
    const SETTLED = `bgv.status IN ('cleared','verified','passed','waived')`;

    const [rows] = await db.execute<RowDataPacket[]>(
      // Rolled up per candidate first, then counted — a candidate-level bucket cannot be
      // expressed as a SUM over check rows without double-counting people.
      `SELECT
         COUNT(*) AS candidates,
         SUM(CASE WHEN c.breached > 0 THEN 1 ELSE 0 END) AS breached,
         SUM(CASE WHEN c.breached = 0 AND c.flagged > 0 THEN 1 ELSE 0 END) AS flagged,
         SUM(CASE WHEN c.breached = 0 AND c.flagged = 0 AND c.outstanding > 0 THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN c.breached = 0 AND c.flagged = 0 AND c.outstanding = 0 THEN 1 ELSE 0 END) AS cleared,
         SUM(CASE WHEN c.breached = 0 AND c.flagged = 0 AND c.outstanding = 0 AND c.outstandingOld > 0 THEN 1 ELSE 0 END) AS pendingBeforeCutoff,
         COALESCE(SUM(c.checks), 0) AS totalChecks,
         COALESCE(SUM(c.outstanding), 0) AS checksPending
       FROM (
         SELECT bgv.candidate_id,
                COUNT(*) AS checks,
                SUM(CASE WHEN ${OUTSTANDING} THEN 1 ELSE 0 END) AS outstanding,
                SUM(CASE WHEN ${OUTSTANDING_OLD} THEN 1 ELSE 0 END) AS outstandingOld,
                SUM(CASE WHEN ${FLAGGED} THEN 1 ELSE 0 END) AS flagged,
                SUM(CASE WHEN bgv.status = 'breached' THEN 1 ELSE 0 END) AS breached,
                SUM(CASE WHEN ${SETTLED} THEN 1 ELSE 0 END) AS settled
           FROM candidate_bgv_check bgv
           LEFT JOIN ats_candidate cand ON cand.id = bgv.candidate_id
           LEFT JOIN branch_master bm ON bm.branch_name = cand.applied_for_branch
           LEFT JOIN process_master pm ON pm.process_name = cand.applied_for_process
          WHERE ${GENUINE_CANDIDATE_SQL}
            AND NOT (${DEAD_CANDIDATE_SQL})
            AND ${scopeSql}
          GROUP BY bgv.candidate_id
       ) c`,
      scopeParams
    );

    // Everything the two filters above removed, so the tile can say how much it set
    // aside instead of quietly shrinking. Counted in candidates, same unit as the
    // headline. A failure here must not take the metric down — the exclusions are
    // provenance, not the measurement.
    const [excludedRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(DISTINCT CASE WHEN NOT (${GENUINE_CANDIDATE_SQL}) OR cand.id IS NULL
                             THEN bgv.candidate_id END) AS nonCandidateRecords,
         COUNT(DISTINCT CASE WHEN ${GENUINE_CANDIDATE_SQL} AND ${DEAD_CANDIDATE_SQL}
                             THEN bgv.candidate_id END) AS closedCandidates
       FROM candidate_bgv_check bgv
       LEFT JOIN ats_candidate cand ON cand.id = bgv.candidate_id`,
    ).catch((err: unknown) => {
      logSourceFailure("dashboard-metric.bgv-exclusions", err, { metricCode: "BGV" });
      return [[{ nonCandidateRecords: null, closedCandidates: null }]] as any;
    });

    const r = rows[0] as any;
    const pending = Number(r.pending ?? 0);
    const cleared = Number(r.cleared ?? 0);
    const flagged = Number(r.flagged ?? 0);
    const breached = Number(r.breached ?? 0);
    const candidates = Number(r.candidates ?? 0);
    const x = excludedRows[0] as any;

    const status: MetricResult["status"] =
      breached > 0 || flagged > 0 ? "critical" : pending > 20 ? "warn" : "ok";

    return wrapEnriched(
      "BGV",
      pending,
      {
        pending,
        cleared,
        flagged,
        breached,
        candidates,
        // The old headline, kept so nobody reconciling against a saved screenshot has
        // to guess why the number moved.
        checksPending: Number(r.checksPending ?? 0),
        totalChecks: Number(r.totalChecks ?? 0),
        // Candidates whose only outstanding checks predate the cutoff. They are still
        // open; they are just not this queue. See pendency-cutoff.ts.
        pendingBeforeCutoff: Number(r.pendingBeforeCutoff ?? 0),
        excludedNonCandidateRecords: x?.nonCandidateRecords == null ? null : Number(x.nonCandidateRecords),
        excludedClosedCandidates: x?.closedCandidates == null ? null : Number(x.closedCandidates),
      },
      status,
      false,
      targetScopeId(scope.branchIds),
      targetScopeId(scope.processIds),
      candidates,
      PENDENCY_CUTOFF_DATE,
    );
  } catch (err) {
    return nullResult("BGV", err);
  }
}

// ─── Name Mismatch ────────────────────────────────────────────────────────────
export async function getNameMismatchMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    // The previous query referenced nm.match_status and nm.is_blocking (neither exists —
    // the real columns are overall_match_status and blocks_employee_code) and scoped on
    // ats_onboarding_bridge.branch_id/process_id, which that table also lacks. Every
    // execution raised ER_BAD_FIELD_ERROR and was reported as "no data".
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "bm.id", "pm.id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS source_rows,
         SUM(CASE WHEN nm.overall_match_status = 'mismatch' THEN 1 ELSE 0 END) AS mismatch,
         SUM(CASE WHEN nm.overall_match_status = 'partial' THEN 1 ELSE 0 END) AS partial,
         SUM(CASE WHEN nm.overall_match_status = 'pending' OR nm.overall_match_status IS NULL THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN nm.blocks_employee_code = 1 THEN 1 ELSE 0 END) AS blocking
       FROM candidate_name_match_summary nm
       LEFT JOIN ats_candidate cand ON cand.id = nm.candidate_id
       LEFT JOIN branch_master bm ON bm.branch_name = cand.applied_for_branch
       LEFT JOIN process_master pm ON pm.process_name = cand.applied_for_process
       -- Same boundary the onboarding and BGV metrics draw: legacy_employee and test
       -- rows in ats_candidate are not a live name-verification queue.
       WHERE ${GENUINE_CANDIDATE_SQL}
         AND ${scopeSql}`,
      scopeParams
    );

    const r = rows[0] as any;
    const mismatch = Number(r.mismatch ?? 0);
    const partial = Number(r.partial ?? 0);
    const pending = Number(r.pending ?? 0);
    const blocking = Number(r.blocking ?? 0);

    const status: MetricResult["status"] =
      blocking > 0 ? "critical" : mismatch > 0 ? "warn" : "ok";

    return wrapEnriched("NAME_MISMATCH", mismatch + partial, { mismatch, partial, pending, blocking }, status, false, targetScopeId(scope.branchIds), targetScopeId(scope.processIds), Number(r.source_rows ?? 0));
  } catch (err) {
    return nullResult("NAME_MISMATCH", err);
  }
}

// ─── Joining Document eSign ──────────────────────────────────────────────────
export async function getJoiningDocEsignMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "e.branch_id", "e.process_id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN c.status IN ('pending_candidate_esign','esign_initiated')
                   AND ${raisedOnOrAfterCutoffSql("c.created_at")} THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN c.status IN ('pending_candidate_esign','esign_initiated')
                   AND NOT (${raisedOnOrAfterCutoffSql("c.created_at")}) THEN 1 ELSE 0 END) AS pendingBeforeCutoff,
         SUM(CASE WHEN c.status IN ('esign_completed','completed','signed_verified') THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN c.status = 'esign_failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN c.status IN ('pending_candidate_esign','esign_initiated') AND c.due_at < NOW() THEN 1 ELSE 0 END) AS overdue
       FROM employee_joining_document_checklist c
       JOIN employees e ON e.id = c.employee_id
       WHERE c.action_type = 'esign'
         AND ${scopeSql}`,
      scopeParams,
    );

    const r = rows[0] as any;
    const pending = Number(r.pending ?? 0);
    const overdue = Number(r.overdue ?? 0);
    const failed = Number(r.failed ?? 0);
    const status: MetricResult["status"] = overdue > 0 ? "critical" : failed > 0 ? "warn" : pending > 10 ? "warn" : "ok";

    return wrapEnriched(
      "JOINING_DOC_ESIGN",
      pending,
      {
        total: Number(r.total ?? 0),
        pending,
        completed: Number(r.completed ?? 0),
        failed,
        overdue,
        pendingBeforeCutoff: Number(r.pendingBeforeCutoff ?? 0),
      },
      status,
      false,
      targetScopeId(scope.branchIds),
      targetScopeId(scope.processIds),
      Number(r.total ?? 0),
      PENDENCY_CUTOFF_DATE,
    );
  } catch (err) {
    return nullResult("JOINING_DOC_ESIGN", err);
  }
}

// ─── Attendance reconciliation exceptions ─────────────────────────────────────
/**
 * Open attendance reconciliation issues — the queue that blocks payroll.
 *
 * Column names verified against live `attendance_reconciliation_issue`: the date column
 * is `issue_date` (there is no `created_at`), open-ness is `resolved_at IS NULL` (there
 * is no `status`), and the buckets are `issue_type` + `severity`.
 *
 * 3,393 of 4,389 rows in a 30-day window carry an `employee_id` that resolves; the
 * remaining 996 (mostly `unmapped_cosec_user`, which by definition has no employee yet)
 * cannot be scoped to a branch. Those are counted in `unscopeable` and excluded from a
 * scoped viewer's totals rather than leaked org-wide.
 */
export async function getAttendanceExceptionMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "emp.branch_id", "emp.process_id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS source_rows,
         SUM(CASE WHEN ari.resolved_at IS NULL THEN 1 ELSE 0 END) AS open_total,
         SUM(CASE WHEN ari.resolved_at IS NULL AND ari.severity = 'blocker' THEN 1 ELSE 0 END) AS blockers,
         SUM(CASE WHEN ari.resolved_at IS NULL AND ari.severity = 'warning' THEN 1 ELSE 0 END) AS warnings,
         SUM(CASE WHEN ari.resolved_at IS NULL AND ari.issue_type = 'missing_adr' THEN 1 ELSE 0 END) AS missingAdr,
         SUM(CASE WHEN ari.resolved_at IS NULL AND ari.issue_type = 'salary_payable_days_mismatch' THEN 1 ELSE 0 END) AS payableMismatch,
         SUM(CASE WHEN ari.resolved_at IS NULL AND ari.issue_type = 'unmapped_cosec_user' THEN 1 ELSE 0 END) AS unmappedCosec,
         SUM(CASE WHEN ari.resolved_at IS NULL AND ari.issue_type = 'zero_minute_attendance' THEN 1 ELSE 0 END) AS zeroMinute,
         SUM(CASE WHEN ari.resolved_at IS NULL AND ari.issue_type = 'missing_punch_with_usable_source' THEN 1 ELSE 0 END) AS missingPunchWithSource,
         SUM(CASE WHEN ari.resolved_at IS NULL AND ari.issue_type = 'dialler_source_without_evidence' THEN 1 ELSE 0 END) AS diallerWithoutEvidence,
         SUM(CASE WHEN ari.resolved_at IS NULL AND ari.issue_type = 'missing_ibd' THEN 1 ELSE 0 END) AS missingIbd,
         SUM(CASE WHEN ari.resolved_at IS NULL AND ari.issue_type = 'inactive_cosec_user_activity' THEN 1 ELSE 0 END) AS inactiveCosecActivity,
         SUM(CASE WHEN ari.resolved_at IS NULL AND ari.issue_type NOT IN (
               'missing_adr', 'salary_payable_days_mismatch', 'unmapped_cosec_user',
               'zero_minute_attendance', 'missing_punch_with_usable_source',
               'dialler_source_without_evidence', 'missing_ibd', 'inactive_cosec_user_activity'
             ) THEN 1 ELSE 0 END) AS otherOpen,
         SUM(CASE WHEN ari.employee_id IS NULL THEN 1 ELSE 0 END) AS unscopeable
       FROM attendance_reconciliation_issue ari
       LEFT JOIN employees emp ON emp.id = ari.employee_id
       WHERE ari.issue_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
         AND ${scopeSql}`,
      scopeParams,
    );

    // Cleared in the last 30 days, measured on WHEN IT WAS CLEARED. Deliberately not
    // constrained by issue_date: the query above counts resolved rows inside a window
    // filtered on issue_date, i.e. "raised in the last 30 days and since cleared", while
    // the panel labels that row "Cleared in the last 30 days". Those are different sets.
    const [clearedRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS resolved_last_30d
         FROM attendance_reconciliation_issue ari
         LEFT JOIN employees emp ON emp.id = ari.employee_id
        WHERE ari.resolved_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
          AND ${scopeSql}`,
      scopeParams,
    );

    const r = rows[0] as any;
    const blockers = Number(r.blockers ?? 0);
    const openTotal = Number(r.open_total ?? 0);
    const payableMismatch = Number(r.payableMismatch ?? 0);

    // A payable-days mismatch stops a payroll run, so any open blocker is critical.
    const status: MetricResult["status"] =
      blockers > 0 ? "critical" : openTotal > 50 ? "warn" : "ok";

    return wrapEnriched(
      "ATTENDANCE_EXCEPTIONS",
      openTotal,
      {
        openTotal,
        blockers,
        warnings: Number(r.warnings ?? 0),
        missingAdr: Number(r.missingAdr ?? 0),
        payableMismatch,
        unmappedCosec: Number(r.unmappedCosec ?? 0),
        zeroMinute: Number(r.zeroMinute ?? 0),
        missingPunchWithSource: Number(r.missingPunchWithSource ?? 0),
        diallerWithoutEvidence: Number(r.diallerWithoutEvidence ?? 0),
        missingIbd: Number(r.missingIbd ?? 0),
        inactiveCosecActivity: Number(r.inactiveCosecActivity ?? 0),
        otherOpen: Number(r.otherOpen ?? 0),
        // `resolved` (resolved among issues RAISED in the window) is deliberately NOT
        // returned. It is not what the panel's "Cleared in the last 30 days" row means,
        // and dashboard-widget-coverage.test.ts rightly fails any detail key that is
        // fetched on every dashboard load and displayed nowhere.
        resolvedLast30d: Number((clearedRows[0] as any)?.resolved_last_30d ?? 0),
        unscopeable: Number(r.unscopeable ?? 0),
      },
      status,
      false,
      targetScopeId(scope.branchIds),
      targetScopeId(scope.processIds),
      Number(r.source_rows ?? 0),
    );
  } catch (err) {
    return nullResult("ATTENDANCE_EXCEPTIONS", err);
  }
}

// ─── Document compliance ──────────────────────────────────────────────────────
/**
 * Document verification backlog for **active** employees only.
 *
 * Re-measured live 2026-08-28: 1,120 active employees, of whom just 20 hold any document
 * at all (500 documents between them) — 1.8% coverage. The 1,344 / 1,084 figures this
 * comment used to quote are an older snapshot; do not reason from them.
 *
 * `employee_documents` holds 207,616 rows across 22,672 employees, but only 1,120 of
 * those employees are active — the rest is historical debt that never reaches zero. This
 * counts the active population, which is the number an HR user can work down.
 *
 * Real column names: `verified` (tinyint), `expiry_date`, `verification_date`. There is
 * no `verification_status`.
 *
 * `expiry_date` is 0% populated for active employees, so expiry is deliberately NOT part
 * of this metric — an "expiring documents" figure would be a permanent, misleading zero.
 * The headline is instead the count of active employees with no document on file at all
 * (1,100 of 1,120), which is the real compliance signal.
 */
export async function getDocumentComplianceMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhereEmployees(scope, "e");

    const [rows] = await db.execute<RowDataPacket[]>(
      // Joined directly instead of via a derived table. The old form ran
      // `SELECT ... FROM employee_documents GROUP BY employee_id` with no filter,
      // so MySQL aggregated all 150k document rows for all 56k employees and
      // materialised that before joining to the ~1.1k active ones
      // (EXPLAIN: DERIVED, rows=150032). Measured on prod 2026-08-04: 96,971 ms.
      // This form is index-driven off idx_emp_doc_emp for active employees only:
      // 1,418 ms, byte-identical output (1125 / 1051 / 74 / 1068 / 169).
      // Do NOT reintroduce the derived-table form — it times out the 30s client
      // limit and has taken the backend process down.
      `SELECT
         COUNT(DISTINCT e.id) AS activeEmployees,
         COUNT(DISTINCT e.id)
           - COUNT(DISTINCT CASE WHEN d.id IS NOT NULL THEN e.id END) AS employeesWithNoDocs,
         COUNT(DISTINCT CASE WHEN d.id IS NOT NULL THEN e.id END) AS employeesWithDocs,
         COUNT(d.id) AS totalDocs,
         COALESCE(SUM(CASE WHEN d.verified = 1 THEN 1 ELSE 0 END), 0) AS verifiedDocs,
         -- the verified flag is set on 487 of the 500 documents held by active employees and NONE
         -- of them carries a verification_date (live, 2026-08-28). The flag was written in
         -- bulk by the migration, not by anyone checking a document, so "Verified
         -- Documents" was asserting a compliance level nobody had established. The panel
         -- now qualifies the 487 with this figure instead of presenting it unadorned.
         COALESCE(SUM(CASE WHEN d.verified = 1 AND d.verification_date IS NOT NULL THEN 1 ELSE 0 END), 0)
           AS verifiedWithEvidence,
         COUNT(d.id)
           - COALESCE(SUM(CASE WHEN d.verified = 1 THEN 1 ELSE 0 END), 0) AS unverifiedDocs
       FROM employees e
       LEFT JOIN employee_documents d ON d.employee_id = e.id
       WHERE e.active_status = 1
         AND ${scopeSql}`,
      scopeParams,
    );

    const r = rows[0] as any;
    const activeEmployees = Number(r.activeEmployees ?? 0);
    const employeesWithNoDocs = Number(r.employeesWithNoDocs ?? 0);
    const unverifiedDocs = Number(r.unverifiedDocs ?? 0);
    const coveragePct = activeEmployees > 0
      ? Math.round(((activeEmployees - employeesWithNoDocs) / activeEmployees) * 1000) / 10
      : null;

    const status: MetricResult["status"] =
      coveragePct === null ? "unknown" : coveragePct < 50 ? "critical" : coveragePct < 90 ? "warn" : "ok";

    return wrapEnriched(
      "DOC_COMPLIANCE",
      employeesWithNoDocs,
      {
        activeEmployees,
        employeesWithNoDocs,
        employeesWithDocs: Number(r.employeesWithDocs ?? 0),
        totalDocs: Number(r.totalDocs ?? 0),
        verifiedDocs: Number(r.verifiedDocs ?? 0),
        verifiedWithEvidence: Number(r.verifiedWithEvidence ?? 0),
        unverifiedDocs,
        coveragePct,
      },
      status,
      false,
      targetScopeId(scope.branchIds),
      targetScopeId(scope.processIds),
      activeEmployees,
    );
  } catch (err) {
    return nullResult("DOC_COMPLIANCE", err);
  }
}

// ─── Biometric activity ───────────────────────────────────────────────────────
/**
 * Biometric punch activity from `integration_biometric_daily`.
 *
 * Uses this table, not `cosec_punch_sync`: that holds 3.19M rows but its last write was
 * 2026-06-18, so a "live punches" tile over it would present six-week-old data as today's.
 *
 * Anchored on the latest date strictly before today. Today's partial day reads 1.54
 * average hours at 15:00 against 10.34 for the completed day before it, so anchoring on
 * MAX(activity_date) would make every afternoon look like a mass early-departure.
 *
 * Real columns: `employee_code` (not employee_id), `activity_date` (not attendance_date),
 * `first_punch`, `last_punch`, `total_punches`, `biometric_minutes`.
 */
export async function getBiometricActivityMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhereEmployees(scope, "e");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS source_rows,
         COUNT(DISTINCT b.employee_code) AS employees,
         SUM(CASE WHEN b.total_punches >= 2 THEN 1 ELSE 0 END) AS completePunchPairs,
         SUM(CASE WHEN b.total_punches = 1 THEN 1 ELSE 0 END) AS singlePunchOnly,
         ROUND(AVG(b.biometric_minutes) / 60, 2) AS avgHours,
         ROUND(AVG(b.total_punches), 1) AS avgPunches,
         MAX(b.activity_date) AS activityDate
       FROM integration_biometric_daily b
       JOIN employees e ON e.employee_code = b.employee_code
       WHERE b.activity_date = (
               SELECT MAX(activity_date) FROM integration_biometric_daily
                WHERE activity_date < CURDATE()
             )
         AND e.active_status = 1
         AND ${scopeSql}`,
      scopeParams,
    );

    const r = rows[0] as any;
    const employees = Number(r.employees ?? 0);
    const singlePunchOnly = Number(r.singlePunchOnly ?? 0);
    const completePunchPairs = Number(r.completePunchPairs ?? 0);

    // A single punch means no out-punch was captured, which becomes an attendance
    // exception downstream — so a high share of them is the signal worth surfacing.
    const singlePunchPct = employees > 0 ? Math.round((singlePunchOnly / employees) * 1000) / 10 : null;
    const status: MetricResult["status"] =
      singlePunchPct === null ? "unknown" : singlePunchPct > 25 ? "critical" : singlePunchPct > 10 ? "warn" : "ok";

    return wrapEnriched(
      "BIOMETRIC_ACTIVITY",
      employees,
      {
        employees,
        completePunchPairs,
        singlePunchOnly,
        singlePunchPct,
        avgHours: r.avgHours === null ? null : Number(r.avgHours),
        avgPunches: r.avgPunches === null ? null : Number(r.avgPunches),
      },
      status,
      true,
      targetScopeId(scope.branchIds),
      targetScopeId(scope.processIds),
      Number(r.source_rows ?? 0),
    );
  } catch (err) {
    return nullResult("BIOMETRIC_ACTIVITY", err);
  }
}

// ─── Salary component breakdown ───────────────────────────────────────────────
/**
 * Component-level split of the most recent payroll run.
 *
 * The payroll dashboard shows gross, net and total deductions but never which components
 * make them up. Anchored on the newest run by (run_month, created_at) so it tracks the
 * run the rest of the payroll panel describes.
 */
export async function getSalaryComponentMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhereEmployees(scope, "e");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS source_rows,
         COUNT(DISTINCT c.component_code) AS componentCodes,
         COUNT(DISTINCT c.employee_id) AS employees,
         SUM(CASE WHEN c.component_type = 'earning' THEN 1 ELSE 0 END) AS earningLines,
         SUM(CASE WHEN c.component_type = 'deduction' THEN 1 ELSE 0 END) AS deductionLines,
         ROUND(SUM(CASE WHEN c.component_type = 'earning' THEN c.amount ELSE 0 END), 2) AS earningTotal,
         ROUND(SUM(CASE WHEN c.component_type = 'deduction' THEN c.amount ELSE 0 END), 2) AS deductionTotal,
         SUM(CASE WHEN c.taxable = 1 THEN 1 ELSE 0 END) AS taxableLines
       FROM salary_prep_line_component c
       -- Anchor on the parent line, not just run_id. salary_prep_line_component carries
       -- denormalised run_id/employee_id and has no foreign key, so deleting a payroll
       -- line leaves its components behind: 9,841 such orphans exist in production,
       -- spread over 16 run-months and still pointing at runs that exist. Counting by
       -- run_id alone therefore inflates component counts, employee counts and earning
       -- totals. The current latest run happens to have none, so this reads correctly
       -- today; it did not when 2025-12 (861 orphans across 126 employees) was latest.
       JOIN salary_prep_line l ON l.id = c.line_id
       JOIN employees e ON e.id = c.employee_id
       WHERE c.run_id = (
               SELECT id FROM salary_prep_run ORDER BY run_month DESC, created_at DESC LIMIT 1
             )
         AND ${scopeSql}`,
      scopeParams,
    );

    const r = rows[0] as any;
    const componentCodes = Number(r.componentCodes ?? 0);
    const earningTotal = Number(r.earningTotal ?? 0);
    const deductionTotal = Number(r.deductionTotal ?? 0);

    // Deductions exceeding earnings on a run is arithmetically impossible for a payable
    // register and indicates a component-mapping fault, so it is surfaced, not smoothed.
    const status: MetricResult["status"] =
      componentCodes === 0 ? "unknown" : deductionTotal > earningTotal ? "critical" : "ok";

    return wrapEnriched(
      "SALARY_COMPONENTS",
      componentCodes,
      {
        componentCodes,
        employees: Number(r.employees ?? 0),
        earningLines: Number(r.earningLines ?? 0),
        deductionLines: Number(r.deductionLines ?? 0),
        earningTotal,
        deductionTotal,
        taxableLines: Number(r.taxableLines ?? 0),
      },
      status,
      true,
      targetScopeId(scope.branchIds),
      targetScopeId(scope.processIds),
      Number(r.source_rows ?? 0),
    );
  } catch (err) {
    return nullResult("SALARY_COMPONENTS", err);
  }
}

// ─── Recruiter hiring activity ────────────────────────────────────────────────
/**
 * Recruiter funnel over the last 30 days from `ats_recruiter_hiring_activity`.
 *
 * Scope routes through `branch_name` / `process_name`, joined to the masters by name —
 * NOT through a recruiter FK. `recruiter_employee_id`, `recruiter_id` and
 * `recruiter_code` are each populated on only 10 of 16,857 rows, so scoping or grouping
 * by them would silently discard 99.94% of the data. `recruiter_name_snapshot` is 100%
 * populated (15 distinct recruiters) and is what the drilldown groups by; it is a
 * denormalised name, not a foreign key, so it identifies but cannot be scoped.
 *
 * `offer_letter_status` is 100% NULL in this window, so offers are not reported at all
 * rather than shown as a permanent zero.
 */
export async function getRecruiterActivityMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "bm.id", "pm.id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS source_rows,
         COUNT(DISTINCT r.recruiter_name_snapshot) AS recruiters,
         SUM(CASE WHEN r.contacted_flag = 1 THEN 1 ELSE 0 END) AS contacted,
         SUM(CASE WHEN r.walkin_flag = 1 THEN 1 ELSE 0 END) AS walkins,
         SUM(CASE WHEN r.hr_interview_status IS NOT NULL AND r.hr_interview_status <> '' THEN 1 ELSE 0 END) AS hrScreened,
         SUM(CASE WHEN r.final_selection_flag = 1 THEN 1 ELSE 0 END) AS selected,
         SUM(CASE WHEN r.joined_flag = 1 THEN 1 ELSE 0 END) AS joined,
         MAX(r.activity_date) AS latestActivity
       FROM ats_recruiter_hiring_activity r
       LEFT JOIN branch_master bm ON bm.branch_name = r.branch_name
       LEFT JOIN process_master pm ON pm.process_name = r.process_name
       WHERE r.activity_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
         AND ${scopeSql}`,
      scopeParams,
    );

    const r = rows[0] as any;
    const leads = Number(r.source_rows ?? 0);
    const selected = Number(r.selected ?? 0);
    const joined = Number(r.joined ?? 0);
    const conversionPct = selected > 0 ? Math.round((joined / selected) * 1000) / 10 : null;

    const status: MetricResult["status"] =
      leads === 0 ? "unknown" : selected === 0 ? "critical" : conversionPct !== null && conversionPct < 20 ? "warn" : "ok";

    return wrapEnriched(
      "RECRUITER_ACTIVITY",
      leads,
      {
        leads,
        recruiters: Number(r.recruiters ?? 0),
        contacted: Number(r.contacted ?? 0),
        walkins: Number(r.walkins ?? 0),
        hrScreened: Number(r.hrScreened ?? 0),
        selected,
        joined,
        conversionPct,
      },
      status,
      true,
      targetScopeId(scope.branchIds),
      targetScopeId(scope.processIds),
      leads,
    );
  } catch (err) {
    return nullResult("RECRUITER_ACTIVITY", err);
  }
}

// ─── Training progress ────────────────────────────────────────────────────────
/**
 * Learning progress from `lms_learning_progress_snapshot`.
 *
 * This is the synced copy already inside `mas_hrms`, which is what CLAUDE.md's LMS
 * boundary requires — the deployed LMS stays the system of record and is never queried
 * here. 151k rows, last synced today.
 *
 * The snapshot covers 264 employees, of whom 214 resolve to an active employee. The
 * remainder are leavers whose history is retained; they are excluded by the active join
 * so a branch-scoped viewer's numbers reconcile with their own headcount.
 */
export async function getTrainingProgressMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhereEmployees(scope, "e");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS source_rows,
         COUNT(DISTINCT s.employee_id) AS learners,
         COUNT(DISTINCT s.course_id) AS courses,
         SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN s.status = 'in_progress' THEN 1 ELSE 0 END) AS inProgress,
         SUM(CASE WHEN s.status = 'not_started' THEN 1 ELSE 0 END) AS notStarted,
         ROUND(AVG(s.completion_pct), 1) AS avgCompletionPct,
         ROUND(AVG(NULLIF(s.score, 0)), 1) AS avgScore
       FROM lms_learning_progress_snapshot s
       JOIN employees e ON e.id = s.employee_id AND e.active_status = 1
       WHERE ${scopeSql}`,
      scopeParams,
    );

    const r = rows[0] as any;
    const total = Number(r.source_rows ?? 0);
    const completed = Number(r.completed ?? 0);
    const notStarted = Number(r.notStarted ?? 0);
    const completionRate = total > 0 ? Math.round((completed / total) * 1000) / 10 : null;

    const status: MetricResult["status"] =
      completionRate === null ? "unknown" : completionRate < 40 ? "critical" : completionRate < 70 ? "warn" : "ok";

    return wrapEnriched(
      "TRAINING_PROGRESS",
      completionRate,
      {
        assignments: total,
        learners: Number(r.learners ?? 0),
        courses: Number(r.courses ?? 0),
        completed,
        inProgress: Number(r.inProgress ?? 0),
        notStarted,
        avgCompletionPct: r.avgCompletionPct === null ? null : Number(r.avgCompletionPct),
        avgScore: r.avgScore === null ? null : Number(r.avgScore),
      },
      status,
      true,
      targetScopeId(scope.branchIds),
      targetScopeId(scope.processIds),
      total,
    );
  } catch (err) {
    return nullResult("TRAINING_PROGRESS", err);
  }
}

// ─── Leave approvals ──────────────────────────────────────────────────────────
/**
 * Pending leave approvals.
 *
 * Deliberately modest: `leave_request` holds 2,678 rows but only 29 are pending, and
 * once restricted to active employees that is 14 — all of which have a start date
 * already in the past. A small number an approver can clear, not a headline.
 *
 * `oldestPendingDays` is reported because those 14 requests date from 2018: they are a
 * legacy import backlog, not live approvals, and a bare "14 pending" would read as
 * today's queue. The age makes the difference visible on the tile.
 *
 * Leave type resolves through `leave_type_master` (sourced by sql/006_leave.sql) rather
 * than `leave_request.leave_type_code`: that column is 0% populated and is defined only
 * in 064_leave_legacy_sync.sql, which 000_run_all.sql does not source because another
 * file shares its 064 prefix.
 */
export async function getLeaveApprovalMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhereEmployees(scope, "e");

    // When the request was FILED, not when the leave falls. A request filed on 26-Aug for
    // leave taken in July is still somebody's decision to make; filtering on from_date
    // would discard it. applied_at is NULL on some rows, hence the COALESCE.
    const LEAVE_RAISED_AT = "COALESCE(lr.applied_at, lr.created_at)";

    const [rows] = await db.execute<RowDataPacket[]>(
      // `pending` is what a manager can still decide; `legacyBacklog` is what the
      // db_bill import left behind.
      //
      // 551 of the 586 rows this table reports as pending carry a legacy_leave_id, and
      // cross-checking each one against db_bill.leave_management (2026-08-28) showed 547
      // of them were **already decided in the legacy system** — 514 with Status =
      // 'Not Approved' (548 of the 718 such rows carry an explicit DisApprovedReason, so
      // the value means rejected, not "awaiting approval") and 33 more blanked but still
      // carrying a disapproval reason. A mapper in the import turned that terminal state
      // into 'pending'. Only 4 legacy rows were genuinely undecided.
      //
      // The effect on screen was a "Pending Leave Approvals" queue of 171 (branch-scoped)
      // to 586 (org-wide) of which none was actionable: every one of the 586 has a
      // to_date in the past. Splitting the count leaves the backlog visible and countable
      // without letting it stand in for today's approval queue.
      //
      // legacy_leave_id IS NOT NULL is the marker written by the db_bill migration
      // (backend/scripts/migrate-leave-history-full.ts); natively-filed requests leave it
      // NULL. This is a display split only — the underlying rows are untouched, and the
      // data repair is backend/scripts/repair-legacy-leave-status.mjs.
      `SELECT
         COUNT(*) AS source_rows,
         SUM(CASE WHEN lr.status = 'pending' AND lr.legacy_leave_id IS NULL
                   AND ${raisedOnOrAfterCutoffSql(LEAVE_RAISED_AT)} THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN lr.status = 'pending' AND lr.legacy_leave_id IS NULL
                   AND NOT (${raisedOnOrAfterCutoffSql(LEAVE_RAISED_AT)}) THEN 1 ELSE 0 END) AS pendingBeforeCutoff,
         SUM(CASE WHEN lr.status = 'pending' THEN 1 ELSE 0 END) AS pendingAllSources,
         SUM(CASE WHEN lr.status = 'pending' AND lr.legacy_leave_id IS NOT NULL THEN 1 ELSE 0 END) AS legacyBacklog,
         SUM(CASE WHEN lr.status = 'pending' AND lr.legacy_leave_id IS NULL AND lr.from_date < CURDATE() THEN 1 ELSE 0 END) AS pendingAlreadyStarted,
         SUM(CASE WHEN lr.status = 'pending' AND lr.legacy_leave_id IS NULL AND lr.requires_branch_head_approval = 1 THEN 1 ELSE 0 END) AS needsBranchHead,
         SUM(CASE WHEN lr.status = 'approved' THEN 1 ELSE 0 END) AS approved,
         SUM(CASE WHEN lr.status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
         MAX(CASE WHEN lr.status = 'pending' AND lr.legacy_leave_id IS NULL THEN DATEDIFF(CURDATE(), lr.from_date) END) AS oldestPendingDays
       FROM leave_request lr
       JOIN employees e ON e.id = lr.employee_id AND e.active_status = 1
       WHERE ${scopeSql}`,
      scopeParams,
    );

    const r = rows[0] as any;
    const pending = Number(r.pending ?? 0);
    const pendingAlreadyStarted = Number(r.pendingAlreadyStarted ?? 0);

    // A leave request whose start date has already passed cannot be approved in time,
    // so it is the urgent case regardless of how small the queue is.
    const status: MetricResult["status"] =
      pendingAlreadyStarted > 0 ? "critical" : pending > 20 ? "warn" : "ok";

    return wrapEnriched(
      "LEAVE_APPROVALS",
      pending,
      {
        pending,
        pendingAlreadyStarted,
        needsBranchHead: Number(r.needsBranchHead ?? 0),
        approved: Number(r.approved ?? 0),
        rejected: Number(r.rejected ?? 0),
        oldestPendingDays: r.oldestPendingDays === null ? null : Number(r.oldestPendingDays),
        // Migrated rows the db_bill import left as 'pending', and the raw total the
        // table still reports. Both kept so the backlog is visible and the headline is
        // reconcilable against a plain status count.
        legacyBacklog: Number(r.legacyBacklog ?? 0),
        pendingAllSources: Number(r.pendingAllSources ?? 0),
        pendingBeforeCutoff: Number(r.pendingBeforeCutoff ?? 0),
      },
      status,
      false,
      targetScopeId(scope.branchIds),
      targetScopeId(scope.processIds),
      Number(r.source_rows ?? 0),
      PENDENCY_CUTOFF_DATE,
    );
  } catch (err) {
    return nullResult("LEAVE_APPROVALS", err);
  }
}
