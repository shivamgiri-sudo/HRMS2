import { attendedDaysSql, expectedToWorkSql } from "../../../../../shared/attendanceStatus.js";
import { empScope, num, one, pct, rows, toneFor } from "../../helpers.js";
import type { InsightAction, InsightContext, InsightSection, InsightSignal } from "../../types.js";
import { addDays, int, lit, queueSeverity } from "./shared.js";

/** Long-absentee windows: strict, so a rostered week-off / holiday / approved leave inside the window excludes the person. */
export interface AbsenceRow { employee_id?: unknown; days7: unknown; absent7: unknown; days5: unknown; absent5: unknown }
export function classifyAbsentees(list: AbsenceRow[]): { long5: AbsenceRow[]; abscond7: AbsenceRow[] } {
  const long5 = list.filter((r) => int(r.days5) === 5 && int(r.absent5) === 5);
  const abscond7 = list.filter((r) => int(r.days7) === 7 && int(r.absent7) === 7);
  return { long5, abscond7 };
}

/**
 * Latest day whose row count is at least `ratio` of the busiest day in the window.
 * The shared LATEST_COMPLETE_ATTENDANCE_DATE_SQL uses 0.5, which admitted 1 Oct when only 753 of ~1,100
 * rows had landed (the other days: 1,068 / 1,081 / 1,078), so absent / late / attendance were read off a
 * half-processed day. HR reports a day only when 90% of its rows exist.
 */
export function pickAnchor(days: Array<{ d: string; n: number }>, ratio = 0.9): string | null {
  const max = days.reduce((m, x) => Math.max(m, x.n), 0);
  const ok = days.filter((x) => max > 0 && x.n >= max * ratio).map((x) => x.d).sort();
  return ok.length ? ok[ok.length - 1] : null;
}

export async function attendanceSection(ctx: InsightContext): Promise<InsightSection> {
  const sc = empScope(ctx);
  const days = await rows(`SELECT DATE_FORMAT(record_date, '%Y-%m-%d') AS d, COUNT(*) AS n FROM attendance_daily_record
                            WHERE record_date >= DATE_SUB(${lit(ctx.today)}, INTERVAL 14 DAY) AND record_date < ${lit(ctx.today)} GROUP BY record_date`);
  const anchor = pickAnchor(days.map((r) => ({ d: String(r.d), n: int(r.n) })));
  if (!anchor) {
    return { kpis: [{ key: "att-rate", label: "Attendance", value: null, unavailable: "No completely processed attendance day in the last 14 days", href: "/wfm-attendance" }] };
  }
  const from7 = addDays(anchor, -6), from5 = addDays(anchor, -4);
  const [daily, absent] = await Promise.all([
    rows(
      `SELECT DATE_FORMAT(r.record_date, '%Y-%m-%d') AS d, ${expectedToWorkSql("r.attendance_status")} AS expected,
              ${attendedDaysSql("r.attendance_status")} AS attended, SUM(r.late_mark = 1) AS late,
              SUM(r.attendance_status = 'absent') AS absent, SUM(r.attendance_status = 'missing_punch') AS missing_punch
         FROM attendance_daily_record r JOIN employees e ON e.id = r.employee_id AND e.active_status = 1
        WHERE r.record_date BETWEEN ${lit(from7)} AND ${lit(anchor)}${sc.sql} GROUP BY r.record_date ORDER BY r.record_date`,
      sc.params,
    ),
    rows(
      `SELECT x.employee_id, e.employee_code, e.full_name, COALESCE(b.branch_name, '-') AS branch, x.days7, x.absent7, x.days5, x.absent5
         FROM (SELECT r.employee_id, COUNT(*) AS days7, SUM(r.attendance_status = 'absent') AS absent7,
                      SUM(r.record_date >= ${lit(from5)}) AS days5, SUM(r.record_date >= ${lit(from5)} AND r.attendance_status = 'absent') AS absent5
                 FROM attendance_daily_record r WHERE r.record_date BETWEEN ${lit(from7)} AND ${lit(anchor)} GROUP BY r.employee_id
                HAVING absent5 = 5 AND days5 = 5) x
         JOIN employees e ON e.id = x.employee_id AND e.active_status = 1
         LEFT JOIN branch_master b ON b.id = e.branch_id
        WHERE 1 = 1${sc.sql} ORDER BY x.absent7 DESC, e.full_name LIMIT 500`,
      sc.params,
    ),
  ]);
  const series = (f: (r: (typeof daily)[number]) => number | null) => daily.map(f).filter((v): v is number => v !== null);
  const rate = (r: (typeof daily)[number]) => pct(num(r.attended), num(r.expected));
  const rateSeries = series(rate), lateSeries = series((r) => pct(num(r.late), num(r.expected)));
  const last = daily[daily.length - 1], prev = daily[daily.length - 2];
  const att = last ? rate(last) : null, attPrev = prev ? rate(prev) : null;
  const late = last ? pct(num(last.late), num(last.expected)) : null;
  const absentPct = last ? pct(num(last.absent), num(last.expected)) : null;
  const mpPct = last ? pct(num(last.missing_punch), num(last.expected)) : null;
  const { long5, abscond7 } = classifyAbsentees(absent as never);
  const asOf = `as of ${anchor}`;
  const signals: InsightSignal[] = [];
  if (mpPct !== null && mpPct >= 10) signals.push({ tone: mpPct >= 20 ? "bad" : "watch", title: `${mpPct}% of rostered staff have a missing punch (${anchor})`, detail: "Missing punches turn into absences at payroll unless regularised. Push the queue through HR regularisation.", value: `${mpPct}%`, href: "/attendance-regularization" });
  if (long5.length) signals.push({ tone: abscond7.length ? "bad" : "watch", title: `${long5.length} employees absent 5 days running`, detail: `${abscond7.length} of them absent all 7 days to ${anchor}. Contact them and start the absconding process where unreachable.`, value: long5.length, href: "/wfm-attendance" });
  if (att !== null) signals.push({ tone: att >= 90 ? "good" : att >= 75 ? "watch" : "bad", title: `Attendance ${att}% on ${anchor}`, detail: "Present plus week-off worked plus half-days at 0.5, over staff rostered to work. Processed attendance runs a day or two behind.", value: `${att}%`, href: "/wfm-attendance" });
  return {
    kpis: [
      { key: "att-rate", label: "Attendance", value: att, unit: "percent", delta: att !== null && attPrev !== null ? Math.round((att - attPrev) * 10) / 10 : null, deltaLabel: `pp vs previous day · ${asOf}`, spark: rateSeries,
        tone: toneFor(att, 90, 75), formula: "(present + week-off worked + 0.5 x half-day) / staff expected to work, on the latest completely processed day", href: "/wfm-attendance" },
      { key: "late-rate", label: "Late marks", value: late, unit: "percent", higherIsBetter: false, spark: lateSeries, tone: toneFor(late, 10, 20, false), helper: asOf,
        formula: "Employees with a late mark / staff expected to work", href: "/wfm-attendance" },
      { key: "absent-rate", label: "Absent", value: absentPct, unit: "percent", higherIsBetter: false, spark: series((r) => pct(num(r.absent), num(r.expected))), tone: toneFor(absentPct, 5, 10, false), helper: asOf,
        formula: "Employees marked absent / staff expected to work", href: "/wfm-attendance" },
      { key: "long-absent", label: "Absent 5+ days running", value: long5.length, higherIsBetter: false, tone: long5.length === 0 ? "green" : abscond7.length ? "red" : "amber",
        helper: `${abscond7.length} absent all 7 days · to ${anchor}`, formula: "Active employees with an attendance row on each of the last 5 processed days, all of them absent", href: "/wfm-attendance" },
    ],
    series: [{ key: "att-week", title: "Attendance, last 7 processed days", subtitle: `Ending ${anchor}`, kind: "line", unit: "percent", keys: [{ key: "attendance", label: "Attendance %", tone: "green" }, { key: "late", label: "Late %", tone: "amber" }, { key: "absent", label: "Absent %", tone: "red" }],
      points: daily.map((r) => ({ label: String(r.d).slice(5), attendance: rate(r), late: pct(num(r.late), num(r.expected)), absent: pct(num(r.absent), num(r.expected)) })), href: "/wfm-attendance" }],
    tables: [{ key: "long-absentees", title: `Long absentees (5+ days to ${anchor})`, href: "/wfm-attendance",
      columns: [{ key: "name", label: "Employee" }, { key: "branch", label: "Branch" }, { key: "absent7", label: "Absent, last 7", unit: "count", align: "right" }],
      rows: long5.slice(0, 10).map((r) => ({ name: `${(r as never as Record<string, string>).full_name} (${(r as never as Record<string, string>).employee_code ?? ""})`, branch: (r as never as Record<string, string>).branch, absent7: int(r.absent7) })) }],
    signals,
  };
}

export async function leaveSection(ctx: InsightContext): Promise<InsightSection> {
  const t = ctx.today;
  const sc = empScope(ctx);
  const [today, el] = await Promise.all([
    one(`SELECT COUNT(DISTINCT lr.employee_id) AS n FROM leave_request lr JOIN employees e ON e.id = lr.employee_id AND e.active_status = 1
          WHERE lr.status = 'approved' AND lr.from_date <= ${lit(t)} AND lr.to_date >= ${lit(t)}${sc.sql}`, sc.params),
    one(`SELECT COUNT(DISTINCT l.employee_id) AS people, SUM(GREATEST(l.allocated_days + l.adjusted_days - l.used_days, 0)) AS days,
                SUM(CASE WHEN e.gross_salary > 0 THEN GREATEST(l.allocated_days + l.adjusted_days - l.used_days, 0) * e.gross_salary / 30 END) AS liability,
                COUNT(DISTINCT CASE WHEN e.gross_salary > 0 THEN l.employee_id END) AS priced
           FROM leave_balance_ledger l JOIN leave_type_master lt ON lt.id = l.leave_type_id AND lt.leave_code = 'EL'
           JOIN employees e ON e.id = l.employee_id AND e.active_status = 1
          WHERE l.balance_year = ${int(t.slice(0, 4))}${sc.sql}`, sc.params),
  ]);
  const people = int(el?.people), priced = int(el?.priced);
  const days = num(el?.days);
  return {
    kpis: [
      { key: "on-leave-today", label: "On approved leave today", value: num(today?.n), helper: "approved requests covering today", formula: "Distinct active employees with an approved leave request spanning today", href: "/leaves" },
      { key: "el-balance", label: "EL balance outstanding", value: people > 0 ? days : null, unit: "days", helper: people ? `${people} employees hold EL` : undefined, unavailable: people === 0 ? "No EL balance rows for this year" : null,
        formula: "Sum of (allocated + adjusted - used) EL days for active employees, this year, floored at 0 per person", href: "/leaves" },
      { key: "el-liability", label: "EL liability (estimate)", value: priced > 0 ? Math.round(num(el?.liability) ?? 0) : null, unit: "inr", higherIsBetter: false, tone: "amber",
        helper: priced ? `${priced} of ${people} priced · gross / 30 per day` : undefined, unavailable: priced === 0 ? "No gross salary on file for employees holding EL" : null,
        formula: "EL days x gross salary / 30, only for employees with a gross salary on file. An estimate: actual encashment follows the policy cap and basic salary", href: "/payroll/salary-package-manager" },
    ],
  };
}

/** Next occurrence of a month-day, in days from today; NULL for 29 Feb in a non-leap year. */
function nextOccurrence(col: string, today: string): string {
  const md = `DATE_FORMAT(${col}, '%m-%d')`;
  const yr = `(${int(today.slice(0, 4))} + IF(${md} < '${today.slice(5)}', 1, 0))`;
  return `STR_TO_DATE(CONCAT(${yr}, '-', ${md}), '%Y-%m-%d')`;
}

export async function calendarSection(ctx: InsightContext): Promise<InsightSection> {
  const t = ctx.today;
  const sc = empScope(ctx);
  const q = (col: string, extra = "") =>
    rows(`SELECT e.full_name AS name, COALESCE(b.branch_name, '-') AS branch, DATE_FORMAT(${nextOccurrence(col, t)}, '%d %b') AS on_day,
                 DATEDIFF(${nextOccurrence(col, t)}, ${lit(t)}) AS in_days, YEAR(${nextOccurrence(col, t)}) - YEAR(${col}) AS years
            FROM employees e LEFT JOIN branch_master b ON b.id = e.branch_id
           WHERE e.active_status = 1 AND ${col} IS NOT NULL AND ${nextOccurrence(col, t)} BETWEEN ${lit(t)} AND DATE_ADD(${lit(t)}, INTERVAL 7 DAY)${extra}${sc.sql}
           ORDER BY in_days, e.full_name LIMIT 200`, sc.params);
  const [bd, an] = await Promise.all([q("e.date_of_birth"), q("e.date_of_joining", " AND e.date_of_joining < " + lit(t))]);
  const anniv = an.filter((r) => int(r.years) >= 1);
  const dayWord = (n: unknown) => (int(n) === 0 ? "today" : int(n) === 1 ? "tomorrow" : `in ${int(n)} days`);
  return {
    kpis: [
      { key: "birthdays-week", label: "Birthdays, next 7 days", value: bd.length, helper: `${bd.filter((r) => int(r.in_days) === 0).length} today`, tone: "violet", href: "/engagement", formula: "Active employees whose birthday falls between today and 7 days ahead" },
      { key: "anniversaries-week", label: "Work anniversaries, next 7 days", value: anniv.length, helper: `${anniv.filter((r) => int(r.in_days) === 0).length} today`, tone: "violet", href: "/engagement", formula: "Active employees completing a full year of service in the next 7 days" },
    ],
    tables: [
      { key: "birthdays", title: "Birthdays this week", href: "/engagement", columns: [{ key: "name", label: "Employee" }, { key: "branch", label: "Branch" }, { key: "when", label: "When" }],
        rows: bd.slice(0, 12).map((r) => ({ name: String(r.name), branch: String(r.branch), when: `${r.on_day} (${dayWord(r.in_days)})` })) },
      { key: "anniversaries", title: "Work anniversaries this week", href: "/engagement", columns: [{ key: "name", label: "Employee" }, { key: "years", label: "Years", unit: "count", align: "right" }, { key: "when", label: "When" }],
        rows: anniv.slice(0, 12).map((r) => ({ name: String(r.name), years: int(r.years), when: `${r.on_day} (${dayWord(r.in_days)})` })) },
    ],
  };
}

export async function complianceSection(ctx: InsightContext): Promise<InsightSection> {
  const t = ctx.today;
  const sc = empScope(ctx);
  const blank = (c: string) => `COALESCE(${c}, '') = ''`;
  const [gap, joinDocs, filing] = await Promise.all([
    one(`SELECT COUNT(*) AS hc, SUM(${blank("e.bank_account_number")}) AS no_bank, SUM(${blank("e.uan_number")}) AS no_uan,
                SUM(${blank("e.pan_number")} AND ${blank("e.pan_number_encrypted")} AND ${blank("e.pan_number_masked")}) AS no_pan,
                SUM(${blank("e.aadhaar_number_encrypted")} AND ${blank("e.aadhaar_number")} AND ${blank("e.aadhaar_last4")}) AS no_aadhaar,
                SUM(COALESCE(e.reporting_manager_id, e.manager_id) IS NULL) AS no_manager
           FROM employees e WHERE e.active_status = 1 AND e.date_of_joining <= ${lit(t)}${sc.sql}`, sc.params),
    one(`SELECT COALESCE(SUM(e.date_of_joining >= DATE_SUB(${lit(t)}, INTERVAL 90 DAY)), 0) AS n,
                MAX(CASE WHEN e.date_of_joining >= DATE_SUB(${lit(t)}, INTERVAL 90 DAY) THEN DATEDIFF(${lit(t)}, e.date_of_joining) END) AS oldest,
                COALESCE(SUM(e.date_of_joining >= DATE_SUB(${lit(t)}, INTERVAL 90 DAY) AND DATEDIFF(${lit(t)}, e.date_of_joining) > 7), 0) AS overdue,
                COALESCE(SUM(e.date_of_joining < DATE_SUB(${lit(t)}, INTERVAL 90 DAY)), 0) AS legacy
           FROM employees e WHERE e.active_status = 1 AND e.joining_document_status = 'pending'${sc.sql}`, sc.params),
    ctx.scope.level === "ORG_ALL"
      ? one(`SELECT COUNT(*) AS n, MAX(DATEDIFF(${lit(t)}, due_date)) AS oldest_late, SUM(due_date < ${lit(t)}) AS overdue,
                    SUM(due_date BETWEEN ${lit(t)} AND DATE_ADD(${lit(t)}, INTERVAL 7 DAY)) AS due7, GROUP_CONCAT(DISTINCT CASE WHEN due_date < ${lit(t)} THEN filing_type END) AS late_types
               FROM statutory_filing_record WHERE status IN ('pending', 'overdue')`)
      : Promise.resolve(null),
  ]);
  const hc = int(gap?.hc);
  const items: Array<[string, string, unknown]> = [["no-uan", "UAN missing", gap?.no_uan], ["no-bank", "Bank account missing", gap?.no_bank], ["no-pan", "PAN missing", gap?.no_pan], ["no-aadhaar", "Aadhaar missing", gap?.no_aadhaar], ["no-manager", "No reporting manager", gap?.no_manager]];
  const actions: InsightAction[] = [];
  if (joinDocs) {
    actions.push({ id: "joining-docs-pending", label: "Employees with joining documents pending", group: "Compliance", href: "/ats/joining-documents-tracker", count: int(joinDocs.n),
      oldestDays: joinDocs.oldest == null ? null : int(joinDocs.oldest), overdue: int(joinDocs.overdue), severity: queueSeverity(int(joinDocs.n), int(joinDocs.overdue)), hint: `joined in last 90 days · overdue = more than 7 days since joining · ${int(joinDocs.legacy)} older joiners also pending` });
  }
  actions.push(ctx.scope.level === "ORG_ALL" && filing
    ? { id: "statutory-filings", label: "Statutory filings pending", group: "Compliance", href: "/compliance/statutory", count: int(filing.n), oldestDays: int(filing.overdue) > 0 ? int(filing.oldest_late) : null,
        overdue: int(filing.overdue), severity: queueSeverity(int(filing.n), int(filing.overdue) * 5), hint: `${int(filing.due7)} due within 7 days${filing.late_types ? ` · late: ${filing.late_types}` : ""} · oldest = days past due` }
    : { id: "statutory-filings", label: "Statutory filings pending", group: "Compliance", href: "/compliance/statutory", count: null, severity: "info", unavailable: "Filings are organisation-level; not shown for a branch or process scope" });
  const kpis = items.slice(0, 3).map(([key, label, v]) => ({
    key, label, value: hc > 0 ? int(v) : null, higherIsBetter: false, tone: toneFor(pct(int(v), hc), 2, 10, false), helper: hc > 0 ? `${pct(int(v), hc)}% of ${hc.toLocaleString("en-IN")} active` : undefined,
    formula: `Active employees with no ${label.replace(" missing", "").toLowerCase()} on the employee record`, href: "/employees",
  }));
  const worst = [...items].sort((a, b) => int(b[2]) - int(a[2]))[0];
  return {
    actions, kpis,
    tables: [{ key: "profile-gaps", title: "Profile and statutory gaps (active employees)", href: "/employees",
      columns: [{ key: "gap", label: "Gap" }, { key: "count", label: "Employees", unit: "count", align: "right" }, { key: "share", label: "Of active", unit: "percent", align: "right" }],
      rows: items.map(([, label, v]) => ({ gap: label, count: int(v), share: pct(int(v), hc) })) }],
    signals: hc > 0 && worst && pct(int(worst[2]), hc)! >= 10
      ? [{ tone: pct(int(worst[2]), hc)! >= 30 ? "bad" : "watch", title: `${worst[1]} for ${pct(int(worst[2]), hc)}% of active employees`, detail: "Statutory gaps block PF/ESI filing and salary payment; fix them at source in the employee master.", value: int(worst[2]), href: "/employees" }] : [],
  };
}

export async function peopleHealthSection(ctx: InsightContext): Promise<InsightSection> {
  const t = ctx.today;
  const sc = empScope(ctx);
  const [eng, lms] = await Promise.all([
    rows(`SELECT s.risk_label AS label, COUNT(*) AS n, AVG(s.engagement_score) AS avg_score, MAX(s.snapshot_date) AS latest
            FROM engagement_health_snapshot s JOIN employees e ON e.id = s.employee_id AND e.active_status = 1
           WHERE s.snapshot_date = (SELECT MAX(snapshot_date) FROM engagement_health_snapshot WHERE snapshot_date >= DATE_SUB(${lit(t)}, INTERVAL 45 DAY))${sc.sql}
           GROUP BY s.risk_label`, sc.params),
    one(`SELECT COUNT(*) AS n, AVG(p.readiness_score) AS readiness, SUM(p.attrition_risk_signal = 'red') AS red, SUM(p.attrition_risk_signal = 'yellow') AS yellow,
                SUM(p.ops_handover_ready = 1) AS ready, MAX(p.readiness_score) AS readiness_max
           FROM lms_learner_progress p JOIN employees e ON e.id = p.employee_id AND e.active_status = 1 WHERE 1 = 1${sc.sql}`, sc.params),
  ]);
  const total = eng.reduce((s, r) => s + int(r.n), 0);
  const risk = eng.filter((r) => ["watchlist", "attrition_risk"].includes(String(r.label))).reduce((s, r) => s + int(r.n), 0);
  const avg = total ? eng.reduce((s, r) => s + (num(r.avg_score) ?? 0) * int(r.n), 0) / total : null;
  const latest = eng[0]?.latest ? String(eng[0].latest).slice(0, 10) : null;
  const lmsN = int(lms?.n), red = int(lms?.red);
  // The LMS feed currently carries readiness 0 and a red signal for every learner but two: it is not scoring anyone, so showing it as an insight would be noise.
  const lmsCalibrated = lmsN > 0 && (num(lms?.readiness_max) ?? 0) > 0 && red / lmsN < 0.95;
  return {
    kpis: [
      { key: "engagement-score", label: "Engagement score", value: total > 0 && avg !== null ? Math.round(avg * 10) / 10 : null, unit: "score", tone: toneFor(avg, 70, 55),
        helper: total ? `only ${total} employees scored${latest ? ` · snapshot ${latest}` : ""}` : undefined, unavailable: total === 0 ? "No engagement snapshot in the last 45 days" : null,
        formula: "Average engagement_score over the latest engagement snapshot (pulse, kudos, participation, attendance, performance). Covers only employees the snapshot scored", href: "/engagement" },
      { key: "engagement-risk", label: "On engagement watchlist", value: total > 0 ? risk : null, higherIsBetter: false, tone: risk === 0 ? "green" : "amber",
        helper: total ? `${pct(risk, total)}% of ${total} scored` : undefined, unavailable: total === 0 ? "No engagement snapshot in the last 45 days" : null,
        formula: "Employees labelled watchlist or attrition_risk in the latest engagement snapshot", href: "/engagement" },
      { key: "lms-readiness", label: "Trainee readiness", value: lmsCalibrated ? Math.round((num(lms?.readiness) ?? 0) * 10) / 10 : null, unit: "score", tone: toneFor(num(lms?.readiness), 70, 50),
        helper: lmsCalibrated ? `${lmsN} learners · ${int(lms?.ready)} ready for ops handover` : undefined,
        unavailable: lmsN === 0 ? "No LMS learner progress for active employees" : !lmsCalibrated ? `LMS scores ${lmsN} learners at zero readiness and ${red} red: the feed is not calibrated` : null,
        formula: "Average readiness_score of active employees in LMS learner progress", href: "/lms/progress-dashboard" },
    ],
    signals: lmsCalibrated && red > 0 ? [{ tone: red / lmsN > 0.15 ? "bad" : "watch", title: `${red} trainees flagged red for attrition risk`, detail: "The LMS marks learners whose scores and attendance resemble past leavers; a quick manager call in week 1 to 3 is the cheapest retention step.", value: red, href: "/lms/progress-dashboard" }] : [],
  };
}
