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
    return wrapEnriched("HEADCOUNT", active, { active, required, available, short }, status, true, targetScopeId(scope.branchIds), targetScopeId(scope.processIds));
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
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN b.status = 'profile_submitted' THEN 1 ELSE 0 END) AS submitted,
           SUM(CASE WHEN b.status IN ('pending','initiated') THEN 1 ELSE 0 END) AS pending,
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
          WHERE cop.otp_verified = 1 AND ${scopeSql}`,
        scopeParams
      ),
    ]);

    const r = bridgeRows[0] as any;
    const submitted = Number(r?.submitted ?? 0);
    const pending = Number(r?.pending ?? 0);
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
      { submitted, pending, otpVerified, otpPending: otpVerified, stuck, joined, total },
      status, true, targetScopeId(scope.branchIds), targetScopeId(scope.processIds), total,
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
         SUM(CASE WHEN (bank_account_number IS NULL OR bank_account_number = '')
                   AND DATEDIFF(CURDATE(), date_of_joining) > 30 THEN 1 ELSE 0 END) AS missingBank,
         SUM(CASE WHEN (pan_number IS NULL OR pan_number = '')
                   AND DATEDIFF(CURDATE(), date_of_joining) > 30 THEN 1 ELSE 0 END) AS missingPan,
         SUM(CASE WHEN (uan_number IS NULL OR uan_number = '')
                   AND DATEDIFF(CURDATE(), date_of_joining) > 60 THEN 1 ELSE 0 END) AS missingUan,
         SUM(CASE WHEN
               ((bank_account_number IS NOT NULL AND bank_account_number != '') OR DATEDIFF(CURDATE(), date_of_joining) <= 30) AND
               ((pan_number IS NOT NULL AND pan_number != '') OR DATEDIFF(CURDATE(), date_of_joining) <= 30)
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
      { total, readyCount, blockerCount, missingBank, missingPan, missingUan },
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
    );
  } catch (err) {
    return nullResult("DPDP_WITHDRAWAL", err);
  }
}

// Appointment letter eSign
export async function getAppointmentEsignMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "e.branch_id", "e.process_id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN alr.current_state IN ('candidate_esign_pending','company_sign_pending','override_requested')
                   OR alr.candidate_esign_status = 'pending'
                   OR alr.company_sign_status = 'pending'
             THEN 1 ELSE 0 END) AS pending,
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
      },
      status,
      false,
      targetScopeId(scope.branchIds),
      targetScopeId(scope.processIds),
    );
  } catch (err) {
    return nullResult("APPOINTMENT_ESIGN", err);
  }
}

// ─── BGV ──────────────────────────────────────────────────────────────────────
export async function getBgvMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    // candidate_bgv_check has no `bgv_status` column (it is `status`), and
    // ats_onboarding_bridge carries no branch/process columns to scope by — so the
    // previous query raised ER_BAD_FIELD_ERROR and the BGV tile was permanently blank.
    // Scope routes via the candidate, as the other candidate-keyed metrics do.
    //
    // Status buckets are taken from the values actually present: verified, failed,
    // not_started, manual_review, mismatch, queued. Anything awaiting action counts as
    // pending — treating only the literal 'pending' as outstanding would have dropped
    // 87 of 194 records on the floor.
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "bm.id", "pm.id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS source_rows,
         SUM(CASE WHEN bgv.status IS NULL OR bgv.status IN ('pending','not_started','queued','manual_review','in_progress') THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN bgv.status IN ('cleared','verified','passed') THEN 1 ELSE 0 END) AS cleared,
         SUM(CASE WHEN bgv.status IN ('flagged','failed','mismatch','discrepancy') THEN 1 ELSE 0 END) AS flagged,
         SUM(CASE WHEN bgv.status = 'breached' THEN 1 ELSE 0 END) AS breached
       FROM candidate_bgv_check bgv
       LEFT JOIN ats_candidate cand ON cand.id = bgv.candidate_id
       LEFT JOIN branch_master bm ON bm.branch_name = cand.applied_for_branch
       LEFT JOIN process_master pm ON pm.process_name = cand.applied_for_process
       WHERE ${scopeSql}`,
      scopeParams
    );

    // A `!rows[0]` fallback used to sit here reading ats_onboarding_bridge.bgv_consent_given.
    // It was unreachable (a bare aggregate always returns exactly one row) and the column
    // it referenced does not exist, so it could only ever have thrown. Removed rather than
    // left as a second broken path behind the first.

    const r = rows[0] as any;
    const pending = Number(r.pending ?? 0);
    const cleared = Number(r.cleared ?? 0);
    const flagged = Number(r.flagged ?? 0);
    const breached = Number(r.breached ?? 0);

    const status: MetricResult["status"] =
      breached > 0 || flagged > 0 ? "critical" : pending > 20 ? "warn" : "ok";

    return wrapEnriched("BGV", pending, { pending, cleared, flagged, breached }, status, false, targetScopeId(scope.branchIds), targetScopeId(scope.processIds), Number(r.source_rows ?? 0));
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
       WHERE ${scopeSql}`,
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
         SUM(CASE WHEN c.status IN ('pending_candidate_esign','esign_initiated') THEN 1 ELSE 0 END) AS pending,
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
      },
      status,
      false,
      targetScopeId(scope.branchIds),
      targetScopeId(scope.processIds),
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
         SUM(CASE WHEN ari.resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS resolved,
         SUM(CASE WHEN ari.employee_id IS NULL THEN 1 ELSE 0 END) AS unscopeable
       FROM attendance_reconciliation_issue ari
       LEFT JOIN employees emp ON emp.id = ari.employee_id
       WHERE ari.issue_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
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
        resolved: Number(r.resolved ?? 0),
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
 * `employee_documents` holds 207,616 rows across 22,672 employees, but only 1,344 of
 * those employees are active — the rest is historical debt that never reaches zero. This
 * counts the active population, which is the number an HR user can work down.
 *
 * Real column names: `verified` (tinyint), `expiry_date`, `verification_date`. There is
 * no `verification_status`.
 *
 * `expiry_date` is 0% populated for active employees, so expiry is deliberately NOT part
 * of this metric — an "expiring documents" figure would be a permanent, misleading zero.
 * The headline is instead the count of active employees with no document on file at all
 * (1,084 of 1,344), which is the real compliance signal.
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

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS source_rows,
         SUM(CASE WHEN lr.status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN lr.status = 'pending' AND lr.from_date < CURDATE() THEN 1 ELSE 0 END) AS pendingAlreadyStarted,
         SUM(CASE WHEN lr.status = 'pending' AND lr.requires_branch_head_approval = 1 THEN 1 ELSE 0 END) AS needsBranchHead,
         SUM(CASE WHEN lr.status = 'approved' THEN 1 ELSE 0 END) AS approved,
         SUM(CASE WHEN lr.status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
         MAX(CASE WHEN lr.status = 'pending' THEN DATEDIFF(CURDATE(), lr.from_date) END) AS oldestPendingDays
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
      },
      status,
      false,
      targetScopeId(scope.branchIds),
      targetScopeId(scope.processIds),
      Number(r.source_rows ?? 0),
    );
  } catch (err) {
    return nullResult("LEAVE_APPROVALS", err);
  }
}
