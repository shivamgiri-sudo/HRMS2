import type { RowDataPacket } from "mysql2";
import { empScope, num, rows, toneFor } from "../../helpers.js";
import type { InsightContext, InsightSection, InsightSignal } from "../../types.js";
import { adrScope, anchorDate, biometricFreshness, dailyAttendance, idFilter, lagTone, ratio, shortDate, unreconciledPct } from "../wfmParts/shared.js";
import { queueAction } from "../wfmParts/queues.js";

/** Data-integrity desk: punch pipeline, missed punches, anomalies, biometric coverage, COSEC sync. */

/** Pure: how many punched-today employees the processing engine has not yet turned into attendance. */
export function pipelineLag(punchedToday: number | null, processedPresentToday: number | null) {
  if (punchedToday === null || processedPresentToday === null) return null;
  const waiting = Math.max(0, punchedToday - processedPresentToday);
  return { waiting, pct: ratio(waiting, punchedToday) };
}

/** Today's biometric punches vs what attendance processing has recorded for today (same day, two stages). */
export async function punchPipelineSection(ctx: InsightContext): Promise<InsightSection> {
  const [byCode, byId] = await Promise.all([idFilter(ctx, "ibd.employee_code", "scoped", "code"), idFilter(ctx, "a.employee_id", "scoped")]);
  const [punched, processed] = await Promise.all([
    rows<RowDataPacket>(`SELECT COUNT(DISTINCT ibd.employee_code) AS n FROM integration_biometric_daily ibd WHERE ibd.activity_date = ?${byCode.sql}`, [ctx.today, ...byCode.params]),
    rows<RowDataPacket>(`SELECT COUNT(*) AS n, SUM(a.attendance_status IN ('present','week_off_worked','half_day')) AS present FROM attendance_daily_record a WHERE a.record_date = ?${byId.sql}`, [ctx.today, ...byId.params]),
  ]);
  const p = num(punched[0]?.n), done = num(processed[0]?.present), rowsToday = num(processed[0]?.n);
  const lag = pipelineLag(p, rowsToday ? done : null);
  return {
    kpis: [{
      key: "punch_pipeline", label: "Punched today, not yet processed", value: lag ? lag.waiting : null, unit: "count", higherIsBetter: false, tone: lag && lag.waiting > 0 ? "amber" : "green", href: "/wfm/attendance-integrity?tab=biometric",
      helper: p === null ? undefined : `${p.toLocaleString("en-IN")} employees punched today; ${(done ?? 0).toLocaleString("en-IN")} processed present`,
      formula: "Distinct employees with a biometric punch today (integration_biometric_daily) minus employees whose attendance row for TODAY is already present/half-day. Same day, two pipeline stages: this is processing lag, not absence.",
      unavailable: lag ? null : p === null ? "Biometric daily feed unreadable" : "Today's attendance rows are not created yet",
    }],
  };
}

/** Missed / unreconciled punches on the anchor day with in/out split and a 14-day trend. */
export async function missedPunchSection(ctx: InsightContext): Promise<InsightSection> {
  const [anchor, days] = await Promise.all([anchorDate(ctx), dailyAttendance(ctx)]);
  if (!anchor || !days.length) return { kpis: [{ key: "missed_punch", label: "Missed punches", value: null, unit: "count", unavailable: "No complete processed attendance day" }] };
  const s = adrScope(ctx);
  const r = await rows<RowDataPacket>(
    `SELECT SUM(a.attendance_status = 'missing_punch') AS miss, SUM(a.attendance_status = 'missing_punch' AND a.clock_in_time IS NULL) AS miss_in,
            SUM(a.attendance_status = 'missing_punch' AND a.clock_in_time IS NOT NULL AND a.clock_out_time IS NULL) AS miss_out,
            SUM(a.attendance_status = 'unreconciled') AS unrec, COUNT(*) AS total
       FROM attendance_daily_record a WHERE a.record_date = ?${s.sql}`,
    [anchor, ...s.params],
  );
  const x = r[0] ?? {};
  const miss = num(x.miss) ?? 0, last = days[days.length - 1];
  const pct = unreconciledPct(last);
  const trend = days.slice(-14);
  return {
    kpis: [{
      key: "missed_punch", label: "Missed punches", value: miss, unit: "count", higherIsBetter: false, tone: toneFor(pct, 5, 15, false), spark: trend.map((d) => d.missing), href: "/wfm/attendance-integrity?tab=mismatches",
      helper: `${num(x.miss_in) ?? 0} no in-punch, ${num(x.miss_out) ?? 0} no out-punch (${shortDate(anchor)})`,
      formula: "Attendance rows on the anchor day with status missing_punch. In = no clock-in recorded; out = clocked in but never out. Each is payroll-blocking until corrected.",
    }, {
      key: "missed_punch_rate", label: "Missing-punch rate", value: pct, unit: "percent", higherIsBetter: false, tone: toneFor(pct, 5, 15, false), spark: trend.map((d) => unreconciledPct(d) ?? 0), href: "/wfm/attendance-integrity?tab=mismatches",
      formula: "missing_punch rows over all attendance rows that day. A rate above ~15% usually means the nightly reconciliation has not caught up rather than that people forgot to punch.",
    }],
    series: [{ key: "missed_trend", title: "Missed-punch trend", subtitle: "Rows left as missing_punch per processed day", kind: "bar", unit: "count", href: "/wfm/attendance-integrity?tab=mismatches", keys: [{ key: "missing", label: "Missing punch", tone: "red" }],
      points: trend.map((d) => ({ label: d.date.slice(5), missing: d.missing })) }],
    signals: pct !== null && pct >= 15 ? [{ tone: "bad", title: `${pct}% of ${shortDate(anchor)} is missing-punch`, detail: `${miss.toLocaleString("en-IN")} rows are unresolved. Check reconciliation health before chasing individuals.`, value: `${pct}%`, href: "/wfm/attendance-integrity?tab=mismatches" }] : [],
  };
}

/** Anomalous punches on the anchor day: implausible day length and single-swipe days. */
export async function anomalySection(ctx: InsightContext): Promise<InsightSection> {
  const anchor = await anchorDate(ctx);
  if (!anchor) return {};
  const s = await idFilter(ctx, "b.employee_id", "scoped");
  const r = await rows<RowDataPacket>(
    `SELECT COUNT(*) AS n, SUM(b.raw_minutes > 960) AS long_day, SUM(b.total_punches = 1) AS single, SUM(b.first_punch_in > b.last_punch_out) AS inverted
       FROM biometric_attendance_log b WHERE b.punch_date = ?${s.sql}`,
    [anchor, ...s.params],
  );
  const x = r[0] ?? {};
  const n = num(x.n) ?? 0, long = num(x.long_day) ?? 0, single = num(x.single) ?? 0, inv = num(x.inverted) ?? 0;
  const anomalies = long + single + inv;
  return {
    kpis: [{ key: "anomalous_punches", label: "Anomalous punch days", value: n ? anomalies : null, unit: "count", higherIsBetter: false, tone: anomalies && ratio(anomalies, n)! > 10 ? "amber" : "green", href: "/attendance/biometric-logs",
      helper: n ? `${long} over 16h, ${single} single-swipe, ${inv} out-before-in (${shortDate(anchor)})` : undefined,
      formula: "Biometric day logs on the anchor day with a span over 16 hours, exactly one punch, or a last punch earlier than the first. Multiple punches per day are normal at this site (door swipes) so they are not treated as duplicates.",
      unavailable: n ? null : "No biometric day logs for the anchor day in this scope" }],
    signals: n && long >= 20 ? [{ tone: "watch", title: `${long} biometric days span more than 16 hours`, detail: "Usually a missed out-punch carried into the next day. Correct them before payroll.", value: long, href: "/attendance/biometric-logs" }] : [],
  };
}

/** Active employees with no biometric minute in 7 days, by branch (enrolment / device coverage). */
export async function coverageSection(ctx: InsightContext): Promise<InsightSection> {
  const s = empScope(ctx);
  const r = await rows<RowDataPacket>(
    `SELECT COALESCE(b.branch_name,'No branch') AS branch, COUNT(*) AS total,
            SUM(NOT EXISTS (SELECT 1 FROM integration_biometric_daily i WHERE i.employee_code = e.employee_code AND i.biometric_minutes > 0 AND i.activity_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY))
                AND NOT EXISTS (SELECT 1 FROM integration_biometric_daily i2 WHERE i2.employee_code = e.biometric_code AND i2.biometric_minutes > 0 AND i2.activity_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY))) AS silent
       FROM employees e LEFT JOIN branch_master b ON b.id = e.branch_id
      WHERE e.active_status = 1 AND e.date_of_joining <= CURDATE() AND (b.active_status = 1 OR b.id IS NULL)${s.sql}
      GROUP BY b.branch_name`,
    s.params,
  );
  const total = r.reduce((a, x) => a + (num(x.total) ?? 0), 0), silent = r.reduce((a, x) => a + (num(x.silent) ?? 0), 0);
  const covered = total ? ratio(total - silent, total) : null;
  const ranked = r.map((x) => ({ label: String(x.branch), value: ratio(num(x.silent), num(x.total)), silent: num(x.silent) ?? 0, total: num(x.total) ?? 0 })).filter((x) => x.silent > 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 8);
  return {
    kpis: [{ key: "biometric_coverage", label: "Biometric coverage (7d)", value: covered, unit: "percent", tone: toneFor(covered, 90, 75), href: "/wfm/attendance-integrity?tab=biometric",
      helper: total ? `${silent.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")} active employees have no biometric minute in 7 days` : undefined,
      formula: "Active employees (open branches) with at least one biometric minute in the last 7 days, matched on employee code or biometric code. People with none cannot register attendance at all: they surface as missing-punch, not absent.",
      unavailable: total ? null : "No active employees in scope" }],
    series: [{ key: "coverage_gap", title: "Biometric gap by branch", subtitle: "% of active employees with no punch in 7 days", kind: "ranked", unit: "percent", href: "/wfm/attendance-integrity?tab=biometric", points: ranked, unavailable: ranked.length ? null : "Every branch is fully covered" }],
    signals: covered !== null && covered < 85 ? [{ tone: "bad", title: `${silent.toLocaleString("en-IN")} employees cannot punch`, detail: "No biometric activity in 7 days. Check enrolment and device access for these branches.", value: `${covered}%`, href: "/wfm/attendance-integrity?tab=biometric" }] : [],
  };
}

/** COSEC pipeline: feed freshness, failed user provisioning, kiosk liveness, and what cannot be measured. */
export async function cosecSection(ctx: InsightContext): Promise<InsightSection> {
  const [f, q, msg, kiosk] = await Promise.all([
    biometricFreshness(ctx),
    rows<RowDataPacket>(`SELECT COUNT(*) AS n, MAX(DATEDIFF(CURDATE(), created_at)) AS age, SUM(created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)) AS ovr FROM cosec_user_sync_queue WHERE status = 'failed'`),
    rows<RowDataPacket>(`SELECT message, COUNT(*) AS n FROM cosec_user_sync_queue WHERE status = 'failed' GROUP BY message ORDER BY n DESC LIMIT 1`),
    rows<RowDataPacket>(`SELECT COUNT(*) AS total, SUM(last_used_at IS NULL OR last_used_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS silent FROM break_kiosk_devices WHERE is_active = 1`),
  ]);
  const failed = num(q[0]?.n) ?? 0, topMsg = msg[0]?.message ? String(msg[0].message).slice(0, 90) : null;
  const silentKiosks = num(kiosk[0]?.silent), kiosks = num(kiosk[0]?.total);
  const signals: InsightSignal[] = [];
  if (failed > 0) signals.push({ tone: "bad", title: `${failed} COSEC user enrolments failed`, detail: topMsg ? `Most common error: ${topMsg}. New joiners cannot punch until this is fixed.` : "New joiners cannot punch until this is fixed.", value: failed, href: "/wfm/attendance-integrity?tab=biometric" });
  if (f.rawPunchLagH !== null && f.rawPunchLagH > 48) signals.push({ tone: "watch", title: `Raw COSEC punch table last wrote ${f.rawPunchAt}`, detail: "The daily integration still feeds attendance; the raw-punch sync and its watermark stopped.", value: `${Math.round(f.rawPunchLagH / 24)}d`, href: "/wfm/attendance-integrity?tab=biometric" });
  return {
    actions: [queueAction({ id: "cosec_enrol_failed", label: "COSEC user enrolments failed", count: failed, oldestDays: num(q[0]?.age), overdue: num(q[0]?.ovr) ?? 0, href: "/wfm/attendance-integrity?tab=biometric", hint: topMsg ?? "retry needed", group: "Biometric", high: 1, critical: 20 })],
    signals,
    kpis: [
      { key: "cosec_sync_lag", label: "COSEC daily-feed lag", value: f.dailyFeedLagH, unit: "hours", higherIsBetter: false, tone: lagTone(f.dailyFeedLagH), href: "/wfm/attendance-integrity?tab=biometric", helper: f.dailyFeedAt ? `last write ${f.dailyFeedAt} IST` : undefined,
        formula: "Hours since integration_biometric_daily (the table attendance reads) was last written, on the database clock.", unavailable: f.dailyFeedLagH === null ? "No biometric daily rows in 3 days" : null },
      { key: "cosec_raw_lag", label: "Raw punch sync lag", value: f.rawPunchLagH === null ? null : Math.round(f.rawPunchLagH / 24), unit: "days", higherIsBetter: false, tone: lagTone(f.rawPunchLagH), href: "/wfm/attendance-integrity?tab=biometric", helper: f.rawPunchAt ? `last raw punch ${f.rawPunchAt}` : undefined,
        formula: "Days since the newest row in cosec_punch_sync. The sync watermark table last updated " + (f.watermarkAt ?? "never") + ".", unavailable: f.rawPunchLagH === null ? "cosec_punch_sync unreadable" : null },
      { key: "kiosks_silent", label: "Break kiosks silent 24h", value: silentKiosks, unit: "count", higherIsBetter: false, tone: silentKiosks ? "amber" : "green", href: "/wfm/break-desk-devices", helper: kiosks !== null ? `of ${kiosks} active kiosks` : undefined,
        formula: "Active break kiosks with no use in 24 hours. Biometric readers themselves have no device registry (biometric_device_master is empty and punches carry no device id), so per-reader offline status cannot be shown.", unavailable: silentKiosks === null ? "Kiosk table unreadable" : null },
    ],
  };
}

/** Late-coming bands and half-day volume on the anchor day, with the configured half-day floors. */
export async function lateRulesSection(ctx: InsightContext): Promise<InsightSection> {
  const anchor = await anchorDate(ctx);
  if (!anchor) return {};
  const s = adrScope(ctx);
  const [r, cfg] = await Promise.all([
    rows<RowDataPacket>(
      `SELECT SUM(a.late_mark = 1) AS late, SUM(a.late_mark = 1 AND a.late_by_minutes <= 15) AS b15, SUM(a.late_mark = 1 AND a.late_by_minutes > 15 AND a.late_by_minutes <= 30) AS b30,
              SUM(a.late_mark = 1 AND a.late_by_minutes > 30 AND a.late_by_minutes <= 60) AS b60, SUM(a.late_mark = 1 AND a.late_by_minutes > 60) AS b60p,
              SUM(a.attendance_status = 'half_day') AS half, ROUND(AVG(CASE WHEN a.late_mark = 1 THEN a.late_by_minutes END), 0) AS avg_late
         FROM attendance_daily_record a WHERE a.record_date = ?${s.sql}`, [anchor, ...s.params]),
    rows<RowDataPacket>(`SELECT config_key, config_value FROM attendance_feature_config WHERE config_key IN ('biometric_half_day_floor_minutes','netlogin_half_day_floor_minutes')`),
  ]);
  const x = r[0] ?? {};
  const floors = Object.fromEntries(cfg.map((c) => [String(c.config_key), String(c.config_value)]));
  const bands = [["0-15 min", x.b15], ["16-30 min", x.b30], ["31-60 min", x.b60], ["60+ min", x.b60p]] as const;
  return {
    kpis: [{ key: "half_day_rule", label: "Half-day marks", value: num(x.half), unit: "count", higherIsBetter: false, tone: "amber", href: "/wfm/attendance-integrity?tab=exceptions",
      helper: `floor ${floors.biometric_half_day_floor_minutes ?? "?"} min biometric / ${floors.netlogin_half_day_floor_minutes ?? "?"} min net-login (${shortDate(anchor)})`,
      formula: "Rows with status half_day on the anchor day. A day below the configured floor of worked minutes is a half day; below half of it, absent. Floors are read from attendance_feature_config." }],
    series: [{ key: "late_bands", title: "Late-coming by minutes late", subtitle: `${num(x.late) ?? 0} late marks on ${shortDate(anchor)}${num(x.avg_late) !== null ? `, avg ${num(x.avg_late)} min` : ""}`, kind: "bar", unit: "count", href: "/wfm/attendance-integrity?tab=exceptions",
      keys: [{ key: "value", label: "Late marks", tone: "amber" }], points: bands.map(([label, v]) => ({ label, value: num(v) ?? 0 })) }],
  };
}

const ISSUE_LABELS: Record<string, string> = {
  missing_adr: "No attendance row built", dialler_source_without_evidence: "Dialler login without punch evidence", unmapped_cosec_user: "COSEC user not mapped to an employee",
  salary_payable_days_mismatch: "Payable days differ from attendance", zero_minute_attendance: "Present with zero worked minutes", missing_punch_with_usable_source: "Missing punch (other source available)",
  inactive_cosec_user_activity: "Punches from an inactive COSEC user", missing_ibd: "No biometric daily row", apr_minutes_mismatch: "APR minutes mismatch", apr_missing_adr: "APR row without attendance",
  apr_source_fallback_when_apr_exists: "APR source fallback",
};

/** Open reconciliation issues by type: what is stuck, how severe, how old. */
export async function issueTypesSection(ctx: InsightContext): Promise<InsightSection> {
  const s = await idFilter(ctx, "i.employee_id", "scoped");
  const r = await rows<RowDataPacket>(
    `SELECT i.issue_type AS type, i.severity AS severity, COUNT(*) AS n, MAX(DATEDIFF(CURDATE(), i.issue_date)) AS age
       FROM attendance_reconciliation_issue i WHERE i.resolved_at IS NULL${s.sql} GROUP BY i.issue_type, i.severity ORDER BY n DESC LIMIT 12`,
    s.params,
  );
  const list = r.map((x) => ({ type: ISSUE_LABELS[String(x.type)] ?? String(x.type).replace(/_/g, " "), severity: String(x.severity), n: num(x.n) ?? 0, age: num(x.age) }));
  return {
    series: [{ key: "issue_types", title: "Open integrity issues by type", subtitle: "Unresolved attendance reconciliation findings", kind: "ranked", unit: "count", href: "/wfm/attendance-integrity?tab=mismatches", points: list.map((x) => ({ label: x.type, value: x.n })), unavailable: list.length ? null : "No open integrity issues" }],
    tables: [{ key: "issue_table", title: "Integrity issues: severity and age", href: "/wfm/attendance-integrity?tab=mismatches",
      columns: [{ key: "type", label: "Issue" }, { key: "severity", label: "Severity" }, { key: "n", label: "Open", align: "right" }, { key: "age", label: "Oldest (days)", align: "right" }],
      rows: list, unavailable: list.length ? null : "No open integrity issues" }],
  };
}
