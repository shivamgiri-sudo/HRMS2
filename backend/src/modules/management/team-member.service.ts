/**
 * One team member, from every angle a manager actually has data for.
 *
 * The My Team page was six flat team-level lists with no route into a person — which is
 * both the gap the owner asked to close and a standing breach of the drill-down mandate in
 * CLAUDE.md. This service backs the slide-over that opens on a member.
 *
 * WHAT IS AND IS NOT HERE, and why — every figure below was counted against the live
 * database on 2026-08-27 against 1,120 active employees, because a section with no rows is
 * worse than a missing section: it reads as "this person has no data" when the truth is
 * "this platform has no data".
 *
 *   attendance_daily_record   ~full coverage, daily, current      -> always rendered
 *   kpi_daily_actual          982/1,120 (88%), daily since May    -> always rendered
 *   attendance_regularization ~full                               -> always rendered
 *   employees + child tables  ~full                               -> always rendered (hygiene)
 *   apr                       244/1,120 (22%), dialler roles only  -> rendered when present
 *   call_quality_assessment   54/1,120 (5%) in 30d, but 452k rows -> rendered when present
 *   asset_master              0 rows                              -> NOT built
 *   attrition_record          0 rows                              -> NOT built
 *
 * The conditional sections report `available: false` rather than zeros, so the UI can say
 * "not audited in this window" instead of drawing a 0% quality score for someone who simply
 * is not on a dialler.
 *
 * SCOPE: assertCanViewMember() is the security boundary. UI gating is not security
 * (CLAUDE.md rule 6) — a manager may read only their own direct reports, and the wide roles
 * are the same ones resolveTeamScope() already trusts.
 *
 * PAYROLL: nothing in here touches salary, CTC, PF/ESIC amounts or bank data. Management
 * surfaces must never carry payroll (CLAUDE.md), so hygiene reports only whether a bank
 * record EXISTS, never a single digit of it.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { managementService } from "./management.service.js";

/** Roles that may look at any employee, matching resolveTeamScope()'s wide set. */
const WIDE_ROLES = ["admin", "hr", "ceo", "qa", "super_admin"] as const;

/** How far back every trend in the drawer looks. */
const WINDOW_DAYS = 90;
/** Shorter window for the "recent" figures a manager acts on this week. */
const RECENT_DAYS = 30;

export interface SectionState {
  available: boolean;
  /** Why a section is empty — 'no_data' is a fact about the person, 'unavailable' about us. */
  reason?: "no_data" | "unavailable";
}

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

/**
 * Throws unless the caller may read this member.
 *
 * Deliberately NOT "is the caller a manager by role". 64 of the 78 people who actually have
 * direct reports hold only the `employee` role, so a role test locks the real audience out.
 * The test that matches the page's purpose is the reporting line itself.
 */
export async function assertCanViewMember(userId: string, targetEmployeeId: string): Promise<void> {
  if (await hasRole(userId, ...WIDE_ROLES)) return;

  const caller = await getEmployeeForUser(userId);
  if (!caller) throw httpError("No employee record for this user", 403);
  if (caller.id === targetEmployeeId) return; // own record

  const reports = await managementService.getDirectReportIds(caller.id);
  if (!reports.includes(targetEmployeeId)) {
    throw httpError("Forbidden: this employee is not in your reporting line", 403);
  }
}

/**
 * Runs one section's query and records the outcome instead of collapsing a failure into an
 * empty result. Same reasoning as the section_status block on GET /employees/me: "the
 * employee never supplied this" and "we could not read it" are opposite facts, and a
 * manager acting on the wrong one chases the wrong person.
 */
async function section<T>(
  name: string,
  run: () => Promise<T>,
  fallback: T,
): Promise<{ data: T; state: SectionState }> {
  try {
    const data = await run();
    const empty = Array.isArray(data) ? data.length === 0 : data == null;
    return { data, state: { available: !empty, reason: empty ? "no_data" : undefined } };
  } catch (err) {
    console.error(`[team-member] section '${name}' unavailable:`, err);
    return { data: fallback, state: { available: false, reason: "unavailable" } };
  }
}

// ── Identity ──────────────────────────────────────────────────────────────────

async function fetchIdentity(employeeId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.first_name, e.last_name,
            COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS full_name,
            e.avatar_url, e.photo_url,
            e.date_of_joining, e.employment_type, e.employment_status,
            e.working_hours_start, e.working_hours_end,
            DATEDIFF(CURDATE(), e.date_of_joining) AS days_served,
            d.designation_name, dept.dept_name, b.branch_name, p.process_name,
            cc.cost_centre_name,
            COALESCE(NULLIF(TRIM(mgr.full_name), ''), TRIM(CONCAT(mgr.first_name, ' ', COALESCE(mgr.last_name, '')))) AS reporting_manager_name
       FROM employees e
       LEFT JOIN designation_master d    ON d.id    = e.designation_id
       LEFT JOIN department_master  dept ON dept.id = e.department_id
       LEFT JOIN branch_master      b    ON b.id    = e.branch_id
       LEFT JOIN process_master     p    ON p.id    = e.process_id
       LEFT JOIN cost_centre_master cc   ON cc.id   = e.cost_centre_id
       LEFT JOIN employees          mgr  ON mgr.id  = COALESCE(e.reporting_manager_id, e.manager_id)
      WHERE e.id = ? LIMIT 1`,
    [employeeId],
  );
  return rows[0] ?? null;
}

// ── Attendance ────────────────────────────────────────────────────────────────

/**
 * 90 days of attendance for the strip, plus the counts a manager reads first.
 *
 * missing_punch is called out separately rather than folded into "absent": it is the single
 * largest non-present status in the live data (9,637 rows in 30 days against 2,667 absent),
 * and it usually means an unenrolled or failed biometric rather than someone not turning up.
 */
async function fetchAttendance(employeeId: string) {
  const [days] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS d,
            adr.attendance_status AS status,
            adr.lwp_value,
            adr.late_mark,
            adr.late_by_minutes
       FROM attendance_daily_record adr
      WHERE adr.employee_id = ?
        AND adr.record_date >= DATE_SUB(CURDATE(), INTERVAL ${WINDOW_DAYS} DAY)
      ORDER BY adr.record_date ASC`,
    [employeeId],
  );

  const tally = (from: number) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - from);
    const iso = cutoff.toISOString().slice(0, 10);
    const window = days.filter((r) => String(r.d) >= iso);
    const count = (s: string) => window.filter((r) => String(r.status) === s).length;
    const present = count("present");
    const half = count("half_day");
    const marked = window.length;
    return {
      days_recorded: marked,
      present,
      half_day: half,
      absent: count("absent"),
      missing_punch: count("missing_punch"),
      leave: window.filter((r) => String(r.status ?? "").includes("leave")).length,
      late_marks: window.filter((r) => Number(r.late_mark) === 1).length,
      lwp_days: window.reduce((sum, r) => sum + Number(r.lwp_value ?? 0), 0),
      // Half days count as half, matching how the attendance module itself reports a rate.
      attendance_pct: marked > 0 ? Math.round(((present + half * 0.5) / marked) * 1000) / 10 : null,
    };
  };

  return {
    strip: days.map((r) => ({
      date: String(r.d),
      status: String(r.status ?? "unknown"),
      late: Number(r.late_mark) === 1,
      late_by_minutes: r.late_by_minutes == null ? null : Number(r.late_by_minutes),
      lwp: Number(r.lwp_value ?? 0),
    })),
    last_30: tally(RECENT_DAYS),
    last_90: tally(WINDOW_DAYS),
  };
}

async function fetchRegularisations(employeeId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ar.status, COUNT(*) AS n
       FROM attendance_regularization ar
      WHERE ar.employee_id = ?
        AND ar.session_date >= DATE_SUB(CURDATE(), INTERVAL ${WINDOW_DAYS} DAY)
      GROUP BY ar.status`,
    [employeeId],
  );
  const by = Object.fromEntries(rows.map((r) => [String(r.status), Number(r.n)]));
  return {
    total: rows.reduce((sum, r) => sum + Number(r.n), 0),
    pending: (by.pending ?? 0) + (by.manager_approved ?? 0) + (by.payroll_pending ?? 0),
    approved: by.approved ?? 0,
    rejected: by.rejected ?? 0,
    by_status: by,
  };
}

// ── KPI ───────────────────────────────────────────────────────────────────────

/**
 * Per-metric KPI with the team median beside it.
 *
 * The number on its own says nothing — 72 is good on one metric and a fire on another, and
 * the existing /agent-performance endpoint collapses all of it into one score with inline
 * risk thresholds. Peer context and direction of travel are what a manager reviews on.
 *
 * `direction` comes from kpi_metric_master: for AHT lower is better, for conversion higher
 * is. The caller must not assume "up is good".
 */
async function fetchKpi(employeeId: string, peerIds: string[]) {
  const peerScope = peerIds.length > 0 ? peerIds : [employeeId];
  const placeholders = peerScope.map(() => "?").join(",");

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT m.metric_code, m.metric_name, m.unit, m.direction, m.decimal_places,
            ROUND(AVG(CASE WHEN k.employee_id = ? THEN k.actual_value END), 2) AS mine_90,
            ROUND(AVG(CASE WHEN k.employee_id = ? AND k.score_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                           THEN k.actual_value END), 2) AS mine_30,
            ROUND(AVG(CASE WHEN k.employee_id = ? AND k.score_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                           THEN k.actual_value END), 2) AS mine_7,
            ROUND(AVG(k.actual_value), 2) AS team_avg_90,
            COUNT(CASE WHEN k.employee_id = ? THEN 1 END) AS my_days
       FROM kpi_daily_actual k
       JOIN kpi_metric_master m ON m.id = k.metric_id
      WHERE k.employee_id IN (${placeholders})
        AND k.score_date >= DATE_SUB(CURDATE(), INTERVAL ${WINDOW_DAYS} DAY)
      GROUP BY m.metric_code, m.metric_name, m.unit, m.direction, m.decimal_places, m.display_order
     HAVING my_days > 0
      ORDER BY m.display_order, m.metric_name`,
    [employeeId, employeeId, employeeId, employeeId, ...peerScope],
  );

  return rows.map((r) => {
    const mine90 = r.mine_90 == null ? null : Number(r.mine_90);
    const mine30 = r.mine_30 == null ? null : Number(r.mine_30);
    const mine7 = r.mine_7 == null ? null : Number(r.mine_7);
    const team = r.team_avg_90 == null ? null : Number(r.team_avg_90);
    // kpi_metric_master stores 'higher_is_better' / 'lower_is_better' (69 / 24 rows), NOT
    // 'higher' / 'lower'. Matching on the bare word made every metric higher-is-better, which
    // inverted the sign on all 24 lower-is-better metrics — AHT, ACW, FATAL_RATE, RTO_RATE —
    // and would have reported rising handle time as an improvement.
    const higherIsBetter = !String(r.direction ?? "").toLowerCase().startsWith("lower");

    // Direction of travel over the last week against the 90-day baseline, signed so that
    // positive always means "getting better" regardless of the metric's own direction.
    let trend: number | null = null;
    if (mine7 != null && mine90 != null && mine90 !== 0) {
      const raw = ((mine7 - mine90) / Math.abs(mine90)) * 100;
      trend = Math.round((higherIsBetter ? raw : -raw) * 10) / 10;
    }

    let vsTeam: number | null = null;
    if (mine90 != null && team != null && team !== 0) {
      const raw = ((mine90 - team) / Math.abs(team)) * 100;
      vsTeam = Math.round((higherIsBetter ? raw : -raw) * 10) / 10;
    }

    return {
      metric_code: String(r.metric_code),
      metric_name: String(r.metric_name),
      unit: r.unit ? String(r.unit) : null,
      higher_is_better: higherIsBetter,
      decimals: Number(r.decimal_places ?? 1),
      last_7: mine7,
      last_30: mine30,
      last_90: mine90,
      team_avg_90: team,
      /** % better (+) or worse (−) than this member's own 90-day baseline. */
      trend_pct: trend,
      /** % better (+) or worse (−) than the team over the same window. */
      vs_team_pct: vsTeam,
      days_measured: Number(r.my_days),
    };
  });
}

async function fetchKpiSeries(employeeId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT m.metric_code, DATE_FORMAT(k.score_date, '%Y-%m-%d') AS d,
            ROUND(AVG(k.actual_value), 2) AS v
       FROM kpi_daily_actual k
       JOIN kpi_metric_master m ON m.id = k.metric_id
      WHERE k.employee_id = ?
        AND k.score_date >= DATE_SUB(CURDATE(), INTERVAL ${WINDOW_DAYS} DAY)
      GROUP BY m.metric_code, k.score_date
      ORDER BY k.score_date ASC`,
    [employeeId],
  );
  const byMetric: Record<string, { date: string; value: number }[]> = {};
  for (const r of rows) {
    const code = String(r.metric_code);
    (byMetric[code] ??= []).push({ date: String(r.d), value: Number(r.v) });
  }
  return byMetric;
}

// ── Quality (upstream db_audit, read-only) ────────────────────────────────────

/**
 * AI call-audit history for this member.
 *
 * Reads db_audit directly, which is what the existing quality dashboard already does. That
 * database is an upstream read-only source under the charter — nothing here writes to it.
 *
 * No Campaign filter. The team-quality endpoint filtered `Campaign LIKE 'INBOUND%'` while
 * every one of the 14,356 rows in the last 30 days carries Campaign = NULL, and NULL never
 * satisfies a LIKE — so that screen returned zero rows for every manager, every day, while
 * 9,561 scored rows sat in the same window averaging 73.7%.
 */
async function fetchQuality(employeeCode: string) {
  const [summary] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS audits,
            ROUND(AVG(q.quality_percentage), 1) AS avg_score,
            MIN(q.quality_percentage) AS worst,
            MAX(q.quality_percentage) AS best,
            SUM(q.quality_percentage < 60) AS poor_calls,
            DATE_FORMAT(MAX(q.CallDate), '%Y-%m-%d') AS last_audit
       FROM db_audit.call_quality_assessment q
      WHERE q.User = ?
        AND q.CallDate >= DATE_SUB(NOW(), INTERVAL ${WINDOW_DAYS} DAY)
        AND q.quality_percentage IS NOT NULL`,
    [employeeCode],
  );

  const head = summary[0];
  if (!head || Number(head.audits) === 0) return null;

  const [recent] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(q.CallDate, '%Y-%m-%d') AS d,
            ROUND(AVG(q.quality_percentage), 1) AS score,
            COUNT(*) AS calls
       FROM db_audit.call_quality_assessment q
      WHERE q.User = ?
        AND q.CallDate >= DATE_SUB(NOW(), INTERVAL ${WINDOW_DAYS} DAY)
        AND q.quality_percentage IS NOT NULL
      GROUP BY DATE_FORMAT(q.CallDate, '%Y-%m-%d')
      ORDER BY DATE_FORMAT(q.CallDate, '%Y-%m-%d') ASC`,
    [employeeCode],
  );

  // Behaviour flags the audit already scores. Surfaced because a percentage tells a manager
  // that something is wrong but never what to coach.
  const [flags] = await db.execute<RowDataPacket[]>(
    `SELECT SUM(q.escalation_failure = 1)               AS escalation_failures,
            SUM(q.dead_air_under_10_seconds = 0)        AS dead_air_breaches,
            SUM(q.express_empathy = 0)                  AS empathy_misses,
            SUM(q.accurate_issue_probing = 0)           AS probing_misses,
            SUM(q.correct_and_complete_information = 0) AS information_misses,
            SUM(COALESCE(q.agent_english_cuss_count, 0) + COALESCE(q.agent_hindi_cuss_count, 0)) AS language_incidents
       FROM db_audit.call_quality_assessment q
      WHERE q.User = ?
        AND q.CallDate >= DATE_SUB(NOW(), INTERVAL ${RECENT_DAYS} DAY)`,
    [employeeCode],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);

  return {
    audits: Number(head.audits),
    avg_score: head.avg_score == null ? null : Number(head.avg_score),
    best: head.best == null ? null : Number(head.best),
    worst: head.worst == null ? null : Number(head.worst),
    poor_calls: Number(head.poor_calls ?? 0),
    last_audit: head.last_audit ? String(head.last_audit) : null,
    series: recent.map((r) => ({ date: String(r.d), score: Number(r.score), calls: Number(r.calls) })),
    coaching_flags: flags[0]
      ? Object.fromEntries(Object.entries(flags[0]).map(([k, v]) => [k, Number(v ?? 0)]))
      : {},
  };
}

// ── Ops / dialler (APR) ───────────────────────────────────────────────────────

async function fetchOps(employeeCode: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS days,
            ROUND(AVG(a.Calls), 0)       AS avg_calls,
            ROUND(AVG(a.AHT), 0)         AS avg_aht,
            ROUND(AVG(a.Net_Login), 0)   AS avg_net_login,
            ROUND(AVG(a.TALK_TIME), 0)   AS avg_talk,
            ROUND(AVG(a.PAUSE_TIME), 0)  AS avg_pause,
            ROUND(AVG(a.WAIT_TIME), 0)   AS avg_wait,
            DATE_FORMAT(MAX(a.ReportDate), '%Y-%m-%d') AS last_day
       FROM apr a
      WHERE a.UserID = ?
        AND a.ReportDate >= DATE_SUB(CURDATE(), INTERVAL ${WINDOW_DAYS} DAY)`,
    [employeeCode],
  );
  const r = rows[0];
  if (!r || Number(r.days) === 0) return null;
  return {
    days: Number(r.days),
    avg_calls: r.avg_calls == null ? null : Number(r.avg_calls),
    avg_aht: r.avg_aht == null ? null : Number(r.avg_aht),
    avg_net_login: r.avg_net_login == null ? null : Number(r.avg_net_login),
    avg_talk: r.avg_talk == null ? null : Number(r.avg_talk),
    avg_pause: r.avg_pause == null ? null : Number(r.avg_pause),
    avg_wait: r.avg_wait == null ? null : Number(r.avg_wait),
    last_day: r.last_day ? String(r.last_day) : null,
  };
}

// ── Hygiene ───────────────────────────────────────────────────────────────────

/**
 * The compliance fields this member is missing.
 *
 * Presence only — never a value. A bank record's existence is a management fact; its digits
 * are payroll data and must not cross into a management endpoint.
 *
 * Live scale of the problem across 1,120 active employees: 1,095 have no nominee, 1,080 no
 * emergency contact, 702 no UAN, 330 no PAN, 143 no bank record, 34 no date of birth.
 */
export const HYGIENE_FIELDS = [
  { key: "date_of_birth",     label: "Date of birth",     critical: false },
  { key: "pan_number",        label: "PAN",               critical: true },
  { key: "uan_number",        label: "UAN",               critical: true },
  { key: "personal_email",    label: "Personal email",    critical: false },
  { key: "mobile",            label: "Mobile",            critical: true },
  { key: "bank_detail",       label: "Bank record",       critical: true },
  { key: "emergency_contact", label: "Emergency contact", critical: true },
  { key: "nominee",           label: "Nominee",           critical: true },
] as const;

const HYGIENE_SELECT = `
  (e.date_of_birth IS NOT NULL)                                   AS date_of_birth,
  (e.pan_number IS NOT NULL AND TRIM(e.pan_number) <> '')         AS pan_number,
  (e.uan_number IS NOT NULL AND TRIM(e.uan_number) <> '')         AS uan_number,
  (e.personal_email IS NOT NULL AND TRIM(e.personal_email) <> '') AS personal_email,
  (e.mobile IS NOT NULL AND TRIM(e.mobile) <> '')                 AS mobile,
  EXISTS(SELECT 1 FROM employee_bank_detail b
          WHERE b.employee_id = e.id AND b.active_status = 1)      AS bank_detail,
  EXISTS(SELECT 1 FROM employee_emergency_contact ec
          WHERE ec.employee_id = e.id)                             AS emergency_contact,
  EXISTS(SELECT 1 FROM employee_nominee n
          WHERE n.employee_id = e.id)                              AS nominee`;

function toHygiene(row: RowDataPacket) {
  const fields = HYGIENE_FIELDS.map((f) => ({
    key: f.key,
    label: f.label,
    critical: f.critical,
    present: Number((row as Record<string, unknown>)[f.key] ?? 0) === 1,
  }));
  const missing = fields.filter((f) => !f.present);
  return {
    fields,
    missing_count: missing.length,
    missing_critical: missing.filter((f) => f.critical).length,
    complete_pct: Math.round(((fields.length - missing.length) / fields.length) * 100),
  };
}

async function fetchHygiene(employeeId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, ${HYGIENE_SELECT} FROM employees e WHERE e.id = ? LIMIT 1`,
    [employeeId],
  );
  return rows[0] ? toHygiene(rows[0]) : null;
}

/** The same checklist across a whole team — backs the Hygiene tab. */
export async function getTeamHygiene(employeeIds: string[]) {
  if (employeeIds.length === 0) return { members: [], summary: { team_size: 0, fully_complete: 0, avg_complete_pct: 0, by_field: {} } };
  const placeholders = employeeIds.map(() => "?").join(",");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code,
            COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS full_name,
            d.designation_name, ${HYGIENE_SELECT}
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
      WHERE e.id IN (${placeholders}) AND e.active_status = 1
      ORDER BY full_name`,
    employeeIds,
  );

  const members = rows.map((r) => ({
    employee_id: String(r.id),
    employee_code: r.employee_code ? String(r.employee_code) : null,
    full_name: String(r.full_name ?? "").trim() || "—",
    designation: r.designation_name ? String(r.designation_name) : null,
    ...toHygiene(r),
  }));

  const byField: Record<string, number> = {};
  for (const f of HYGIENE_FIELDS) {
    byField[f.key] = members.filter((m) => !m.fields.find((x) => x.key === f.key)?.present).length;
  }

  return {
    members,
    summary: {
      team_size: members.length,
      fully_complete: members.filter((m) => m.missing_count === 0).length,
      avg_complete_pct: members.length
        ? Math.round(members.reduce((s, m) => s + m.complete_pct, 0) / members.length)
        : 0,
      /** Missing counts per field — what to chase first. */
      by_field: byField,
    },
  };
}

// ── Open items ────────────────────────────────────────────────────────────────

async function fetchOpenItems(employeeId: string) {
  const [leave] = await db.execute<RowDataPacket[]>(
    `SELECT lr.id, lt.leave_name AS leave_type, lr.status,
            DATE_FORMAT(lr.from_date, '%Y-%m-%d') AS from_date,
            DATE_FORMAT(lr.to_date, '%Y-%m-%d')   AS to_date,
            lr.total_days, lr.reason
       FROM leave_request lr
       LEFT JOIN leave_type_master lt ON lt.id = lr.leave_type_id
      WHERE lr.employee_id = ? AND lr.status LIKE 'pending%'
      ORDER BY lr.from_date ASC LIMIT 20`,
    [employeeId],
  );

  const [regs] = await db.execute<RowDataPacket[]>(
    `SELECT ar.id, DATE_FORMAT(ar.session_date, '%Y-%m-%d') AS session_date,
            ar.status, ar.requested_status, ar.old_status, ar.new_status
       FROM attendance_regularization ar
      WHERE ar.employee_id = ?
        AND ar.status NOT IN ('approved', 'rejected', 'cancelled', 'discarded')
      ORDER BY ar.session_date DESC LIMIT 20`,
    [employeeId],
  );

  return {
    pending_leave: leave.map((r) => ({ ...r, total_days: Number(r.total_days ?? 0) })),
    pending_regularisations: regs,
  };
}

// ── Assembly ──────────────────────────────────────────────────────────────────

export async function getTeamMemberDeepDive(employeeId: string, peerIds: string[]) {
  const identity = await fetchIdentity(employeeId);
  if (!identity) throw httpError("Employee not found", 404);

  const employeeCode = identity.employee_code ? String(identity.employee_code) : "";

  const [attendance, regularisations, kpi, kpiSeries, quality, ops, hygiene, openItems] = await Promise.all([
    section("attendance", () => fetchAttendance(employeeId), { strip: [], last_30: null, last_90: null } as never),
    section("regularisations", () => fetchRegularisations(employeeId), null as never),
    section("kpi", () => fetchKpi(employeeId, peerIds), [] as never),
    section("kpi_series", () => fetchKpiSeries(employeeId), {} as never),
    section("quality", () => (employeeCode ? fetchQuality(employeeCode) : Promise.resolve(null)), null as never),
    section("ops", () => (employeeCode ? fetchOps(employeeCode) : Promise.resolve(null)), null as never),
    section("hygiene", () => fetchHygiene(employeeId), null as never),
    section("open_items", () => fetchOpenItems(employeeId), { pending_leave: [], pending_regularisations: [] } as never),
  ]);

  return {
    employee: identity,
    attendance: attendance.data,
    regularisations: regularisations.data,
    kpi: kpi.data,
    kpi_series: kpiSeries.data,
    quality: quality.data,
    ops: ops.data,
    hygiene: hygiene.data,
    open_items: openItems.data,
    /**
     * Per-section outcome. `no_data` means this person genuinely has nothing in that source
     * (a non-dialler has no APR rows and that is correct); `unavailable` means the query
     * failed and the section must not be read as a zero.
     */
    section_status: {
      attendance: attendance.state,
      regularisations: regularisations.state,
      kpi: kpi.state,
      quality: quality.state,
      ops: ops.state,
      hygiene: hygiene.state,
      open_items: openItems.state,
    },
    window_days: WINDOW_DAYS,
  };
}
