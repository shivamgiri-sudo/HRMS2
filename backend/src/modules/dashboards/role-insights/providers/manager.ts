import type { RowDataPacket } from "mysql2";
import { LATEST_COMPLETE_ATTENDANCE_DATE_SQL, PRESENT_SESSION_STATUSES, statusList } from "../../../../shared/attendanceStatus.js";
import { computeRiskScores, RISK_HIGH } from "../../../operations/ops-command.risk.js";
import { memo } from "../../../operations/ops-command.cache.js";
import { PENDENCY_CUTOFF_DATE } from "../../pendency-cutoff.js";
import { empScope, num, one, pct, rows, toneFor } from "../helpers.js";
import type { InsightAction, InsightContext, InsightKpi, InsightProvider, InsightSection } from "../types.js";
import {
  attendanceRate, expandLeaveDays, lateRate, rollupKpis, teamHealth, upcomingMonthDays, yearsOn,
  type DayCounts, type KpiGroupRow,
} from "./managerCalc.js";
import {
  NO_TEAM_REASON, QUEUE_SLA_DAYS, addDaysIso, deltaPoints, dayDiff, guarded, mean, memoFor, opsViewFor, round1, scopeIsEmptyTeam, shortDay, toAction,
} from "./mgmtOpsQaShared.js";

/**
 * MANAGEMENT_DASHBOARD insights - "my team today".
 *
 * Scope is whatever resolveDashboardScope gave the caller (TEAM_ONLY for managers / team leaders,
 * BRANCH_ALL for a branch head); every employee-keyed read goes through empScope(ctx) and is never widened.
 * Attendance is processed with lag, so every attendance number says which day it describes.
 */

const DRILL = "MANAGEMENT_DASHBOARD";
const hrefExit = (roleKeys: string[]) =>
  roleKeys.some((r) => ["manager", "admin", "hr", "super_admin", "branch_hr", "payroll_head", "finance", "payroll"].includes(r))
    ? "/exit/resignation-command-center" : "/exit/command-center";

const f = (ctx: InsightContext) => empScope(ctx, "e");
const noTeam = (ctx: InsightContext): InsightSection | null =>
  scopeIsEmptyTeam(ctx) ? { signals: [{ tone: "watch", title: "No team mapped", detail: NO_TEAM_REASON }] } : null;

// ── Approval queues ────────────────────────────────────────────────────────────────────────
async function queues(ctx: InsightContext): Promise<InsightSection> {
  const blocked = noTeam(ctx);
  if (blocked) return blocked;
  const sc = f(ctx);
  const t = ctx.today;
  const ageOf = (col: string) => `DATEDIFF(?, DATE(${col}))`;

  const q = async (site: string, sql: string, params: unknown[]) => guarded(site, () => one<RowDataPacket>(sql, params));
  const [leave, reg, wfh, exitQ, inbox, coach, train, goals, tableChecks] = await Promise.all([
    q("manager.leave",
      `SELECT COUNT(*) n, MAX(${ageOf("COALESCE(lr.applied_at, lr.created_at)")}) oldest,
              SUM(CASE WHEN lr.from_date < ? THEN 1 ELSE 0 END) started,
              SUM(CASE WHEN lr.requires_branch_head_approval = 1 THEN 1 ELSE 0 END) needs_bh,
              (SELECT COUNT(*) FROM leave_request x JOIN employees ex ON ex.id = x.employee_id AND ex.active_status = 1
                WHERE x.status = 'pending' AND x.legacy_leave_id IS NULL AND COALESCE(x.applied_at, x.created_at) < '${PENDENCY_CUTOFF_DATE}'
                  ${empScope(ctx, "ex").sql}) older
         FROM leave_request lr JOIN employees e ON e.id = lr.employee_id AND e.active_status = 1
        WHERE lr.status = 'pending' AND lr.legacy_leave_id IS NULL
          AND COALESCE(lr.applied_at, lr.created_at) >= '${PENDENCY_CUTOFF_DATE}' ${sc.sql}`,
      [t, t, ...empScope(ctx, "ex").params, ...sc.params]),
    q("manager.regularisation",
      `SELECT COUNT(*) n, MAX(${ageOf("r.created_at")}) oldest, SUM(CASE WHEN ${ageOf("r.created_at")} > ${QUEUE_SLA_DAYS} THEN 1 ELSE 0 END) overdue
         FROM attendance_regularization r JOIN employees e ON e.id = r.employee_id AND e.active_status = 1
        WHERE r.status = 'pending' AND r.dispute_type <> 'work_from_home' ${sc.sql}`,
      [t, t, ...sc.params]),
    q("manager.wfh",
      `SELECT COUNT(*) n, MAX(${ageOf("r.created_at")}) oldest, SUM(CASE WHEN ${ageOf("r.created_at")} > ${QUEUE_SLA_DAYS} THEN 1 ELSE 0 END) overdue
         FROM attendance_regularization r JOIN employees e ON e.id = r.employee_id AND e.active_status = 1
        WHERE r.status = 'pending' AND r.dispute_type = 'work_from_home' ${sc.sql}`,
      [t, t, ...sc.params]),
    q("manager.exit",
      `SELECT COUNT(*) n, MAX(${ageOf("COALESCE(x.submitted_at, x.created_at)")}) oldest,
              SUM(CASE WHEN ${ageOf("COALESCE(x.submitted_at, x.created_at)")} > ${QUEUE_SLA_DAYS} THEN 1 ELSE 0 END) overdue
         FROM exit_request x JOIN employees e ON e.id = x.employee_id AND e.active_status = 1
        WHERE x.status IN ('submitted', 'manager_review') ${sc.sql}`,
      [t, t, ...sc.params]),
    q("manager.inbox",
      `SELECT COUNT(*) n, MAX(${ageOf("created_at")}) oldest, SUM(CASE WHEN priority IN ('high','urgent') THEN 1 ELSE 0 END) urgent
         FROM work_inbox_item WHERE user_id = ? AND is_actioned = 0`,
      [t, ctx.userId]),
    q("manager.coaching",
      `SELECT COUNT(*) n, MAX(DATEDIFF(?, cs.session_date)) oldest
         FROM coaching_session cs JOIN employees e ON e.id = cs.employee_id AND e.active_status = 1
        WHERE cs.status = 'scheduled' AND cs.session_date < ? ${sc.sql}`,
      [t, t, ...sc.params]),
    q("manager.training",
      `SELECT COUNT(*) n, MAX(DATEDIFF(?, s.due_date)) oldest
         FROM lms_learning_progress_snapshot s JOIN employees e ON e.id = s.employee_id AND e.active_status = 1
        WHERE s.status IN ('not_started', 'in_progress') AND s.due_date < ? ${sc.sql}`,
      [t, t, ...sc.params]),
    q("manager.goals",
      `SELECT COUNT(*) n, MAX(DATEDIFF(?, DATE(g.created_at))) oldest
         FROM goal g JOIN employees e ON e.id = g.employee_id AND e.active_status = 1
        WHERE g.status = 'draft' ${sc.sql}`,
      [t, ...sc.params]),
    guarded("manager.sources", async () => ({
      appraisal: num((await one(`SELECT COUNT(*) n FROM appraisal_cycle`))?.n),
      probation: num((await one(`SELECT COUNT(*) n FROM employee_probation`))?.n),
      certs: num((await one(`SELECT COUNT(*) n FROM lms_certification_snapshot`))?.n),
    })),
  ]);

  const mk = (id: string, label: string, href: string, r: typeof leave, opts: { hint?: (v: RowDataPacket) => string | undefined; overdue?: (v: RowDataPacket) => number; group?: string } = {}): InsightAction =>
    r.value
      ? toAction({ id, label, href, group: opts.group, count: num(r.value.n), oldestDays: num(r.value.oldest), overdue: opts.overdue?.(r.value) ?? num(r.value.overdue) ?? 0, hint: opts.hint?.(r.value) })
      : toAction({ id, label, href, group: opts.group, count: null, unavailable: `Could not load: ${r.error}` });

  const actions: InsightAction[] = [
    mk("leave", "Leave requests to approve", "/leaves", leave, {
      group: "Approvals",
      overdue: (v) => num(v.started) ?? 0,
      hint: (v) => [num(v.started) ? `${num(v.started)} already started` : null, num(v.needs_bh) ? `${num(v.needs_bh)} need branch head` : null, num(v.older) ? `${num(v.older)} older than ${PENDENCY_CUTOFF_DATE} not counted` : null].filter(Boolean).join(" · ") || undefined,
    }),
    mk("regularisation", "Attendance regularisations", "/attendance-regularization", reg, { group: "Approvals", hint: () => `overdue = waiting > ${QUEUE_SLA_DAYS}d` }),
    mk("wfh", "Work-from-home requests", "/attendance-regularization", wfh, { group: "Approvals", hint: () => `overdue = waiting > ${QUEUE_SLA_DAYS}d` }),
    mk("exit", "Resignations awaiting your review", hrefExit(ctx.roleKeys), exitQ, { group: "People", hint: () => `overdue = waiting > ${QUEUE_SLA_DAYS}d` }),
    mk("inbox", "Work inbox - open items", "/work-inbox", inbox, {
      group: "Inbox", overdue: () => 0,
      hint: (v) => `${num(v.urgent) ?? 0} high/urgent · inbox items carry no due date, so none are marked overdue`,
    }),
    mk("coaching", "Coaching / 1:1 sessions overdue", "/team/coaching", coach, { group: "People", overdue: (v) => num(v.n) ?? 0, hint: () => "scheduled date has passed, not marked completed" }),
    mk("training", "Training past due date", `/dashboards/drill/${DRILL}/TRAINING_PROGRESS`, train, { group: "People", overdue: (v) => num(v.n) ?? 0, hint: () => "courses not completed after their due date" }),
    mk("goals", "Goals awaiting activation", "/performance", goals, { group: "Performance" }),
  ];

  const signals: InsightSection["signals"] = [];
  const src = tableChecks.value;
  if (src) {
    const missing = [src.appraisal === 0 ? "appraisal cycles" : null, src.probation === 0 ? "probation tracking" : null, src.certs === 0 ? "certifications" : null].filter(Boolean);
    if (missing.length) signals.push({ tone: "watch", title: "Some approval types are not tracked yet", detail: `No ${missing.join(", ")} exist in the system, so those items cannot appear here - this is a data gap, not an empty queue.` });
  }
  return { actions, signals };
}

// ── Team attendance: processed anchor day + live today ──────────────────────────────────────────
async function attendanceDays(ctx: InsightContext) {
  return memoFor(ctx, "attendance", async () => {
    const sc = f(ctx);
    const anchorRow = await one<RowDataPacket>(`SELECT DATE_FORMAT(${LATEST_COMPLETE_ATTENDANCE_DATE_SQL}, '%Y-%m-%d') AS d`);
    const anchor: string | null = anchorRow?.d ?? null;
    if (!anchor) return { anchor: null, days: [] as Array<{ date: string; c: DayCounts }> };
    const from = addDaysIso(anchor, -13);
    const r = await rows<RowDataPacket>(
      `SELECT DATE_FORMAT(a.record_date, '%Y-%m-%d') d,
              SUM(CASE WHEN a.attendance_status IN ('present','week_off_worked') THEN 1 ELSE 0 END) present,
              SUM(CASE WHEN a.attendance_status = 'half_day' THEN 1 ELSE 0 END) half,
              SUM(CASE WHEN a.attendance_status = 'absent' THEN 1 ELSE 0 END) absent,
              SUM(CASE WHEN a.attendance_status IN ('leave_approved','on_leave','leave') THEN 1 ELSE 0 END) leave_n,
              SUM(CASE WHEN a.attendance_status IN ('missing_punch','unreconciled') THEN 1 ELSE 0 END) missing,
              SUM(CASE WHEN a.late_mark = 1 THEN 1 ELSE 0 END) late,
              SUM(CASE WHEN a.attendance_status IN ('week_off','holiday') THEN 1 ELSE 0 END) not_expected,
              COUNT(*) total
         FROM attendance_daily_record a JOIN employees e ON e.id = a.employee_id AND e.active_status = 1
        WHERE a.record_date BETWEEN ? AND ? ${sc.sql}
        GROUP BY a.record_date ORDER BY a.record_date`,
      [from, anchor, ...sc.params],
    );
    return {
      anchor,
      days: r.map((x) => ({
        date: String(x.d),
        c: { present: num(x.present) ?? 0, half: num(x.half) ?? 0, absent: num(x.absent) ?? 0, leave: num(x.leave_n) ?? 0, missing: num(x.missing) ?? 0, late: num(x.late) ?? 0, notExpected: num(x.not_expected) ?? 0, total: num(x.total) ?? 0 } satisfies DayCounts,
      })),
    };
  });
}

async function attendance(ctx: InsightContext): Promise<InsightSection> {
  const blocked = noTeam(ctx);
  if (blocked) return blocked;
  const sc = f(ctx);
  const [{ anchor, days }, live] = await Promise.all([
    attendanceDays(ctx),
    one<RowDataPacket>(
      `SELECT (SELECT COUNT(*) FROM employees e WHERE e.active_status = 1 ${sc.sql}) team,
              (SELECT COUNT(DISTINCT s.employee_id) FROM wfm_attendance_session s JOIN employees e ON e.id = s.employee_id AND e.active_status = 1
                WHERE s.session_date = ? AND s.current_status IN (${statusList(PRESENT_SESSION_STATUSES)}) ${sc.sql}) logged_in,
              (SELECT COUNT(DISTINCT s.employee_id) FROM wfm_attendance_session s JOIN employees e ON e.id = s.employee_id AND e.active_status = 1
                WHERE s.session_date = ? ${sc.sql}) punched_any,
              (SELECT COUNT(DISTINCT lr.employee_id) FROM leave_request lr JOIN employees e ON e.id = lr.employee_id AND e.active_status = 1
                WHERE lr.status = 'approved' AND lr.from_date <= ? AND lr.to_date >= ? ${sc.sql}) on_leave`,
      [...sc.params, ctx.today, ...sc.params, ctx.today, ...sc.params, ctx.today, ctx.today, ...sc.params],
    ),
  ]);

  const last = days[days.length - 1];
  const prev = days.slice(-8, -1).map((d) => attendanceRate(d.c));
  const rate = last ? attendanceRate(last.c) : null;
  const rateSeries = days.map((d) => attendanceRate(d.c));
  const team = num(live?.team);
  const punched = num(live?.punched_any);
  const onLeave = num(live?.on_leave) ?? 0;
  const notPunched = team !== null && punched !== null ? Math.max(team - punched - onLeave, 0) : null;
  const asOf = anchor ? `as of ${shortDay(anchor)}` : "no processed day yet";
  const spark = (pick: (c: DayCounts) => number | null) => days.map((d) => pick(d.c)).filter((v): v is number => v !== null);

  const kpis: InsightKpi[] = [
    { key: "att_rate", label: "Team attendance", value: rate, unit: "percent", delta: deltaPoints(rate, round1(mean(prev))), deltaLabel: `${asOf} · vs prior 7 days`, spark: spark(attendanceRate), tone: toneFor(rate, 90, 80), formula: "(present + week-off-worked + 0.5 x half-day) / rows where attendance was expected (excludes week-offs, holidays, approved leave). Processed attendance trails real time.", drill: { metricCode: "ATTENDANCE" }, unavailable: rate === null ? "No processed attendance for this team yet" : null },
    { key: "att_absent", label: "Absent", value: last?.c.absent ?? null, unit: "count", higherIsBetter: false, deltaLabel: asOf, spark: spark((c) => c.absent), tone: toneFor(last ? pct(last.c.absent, last.c.total - last.c.notExpected - last.c.leave) : null, 5, 10, false), formula: "Rows with status absent on the latest processed day.", drill: { metricCode: "ATTENDANCE" } },
    { key: "att_late", label: "Late marks", value: last?.c.late ?? null, unit: "count", higherIsBetter: false, deltaLabel: asOf, spark: spark((c) => c.late), tone: toneFor(last ? lateRate(last.c) : null, 8, 15, false), formula: "Rows with late_mark = 1 on the latest processed day.", drill: { metricCode: "ATTENDANCE" } },
    { key: "att_missing", label: "Missing punches", value: last?.c.missing ?? null, unit: "count", higherIsBetter: false, deltaLabel: asOf, spark: spark((c) => c.missing), tone: toneFor(last ? pct(last.c.missing, last.c.total - last.c.notExpected - last.c.leave) : null, 3, 10, false), formula: "missing_punch + unreconciled rows: no usable punch, usually a sync issue rather than absence.", href: "/attendance-regularization" },
    { key: "live_in", label: "Logged in now", value: num(live?.logged_in), unit: "count", deltaLabel: `today ${shortDay(ctx.today)} · live`, tone: "blue", formula: "Team members with a wfm_attendance_session today in Logged In / Partial.", href: "/wfm/team-attendance" },
    { key: "not_punched", label: "Not punched yet", value: notPunched, unit: "count", higherIsBetter: false, deltaLabel: "today · live", tone: toneFor(notPunched !== null && team ? (notPunched / team) * 100 : null, 15, 35, false), formula: "Team size - people with any session today - people on approved leave today. Includes week-offs, which the live feed cannot separate.", href: "/wfm/team-attendance" },
    { key: "on_leave_today", label: "On leave today", value: team === null ? null : onLeave, unit: "count", deltaLabel: "approved leave covering today", tone: "violet", formula: "Distinct team members with an approved leave_request spanning today.", href: "/leaves" },
  ];

  const series: InsightSection["series"] = [];
  if (days.length) {
    series.push({ key: "att_trend", title: "Team attendance - last 14 processed days", subtitle: anchor ? `through ${shortDay(anchor)}` : undefined, kind: "line", unit: "percent", keys: [{ key: "rate", label: "Attendance %", tone: "blue" }, { key: "late", label: "Late %", tone: "amber" }], points: days.map((d) => ({ label: d.date.slice(5), rate: attendanceRate(d.c), late: lateRate(d.c) })), href: "/attendance" });
  }
  if (last) {
    const c = last.c;
    series.push({ key: "att_mix", title: `Who was where - ${shortDay(last.date)}`, subtitle: "processed day", kind: "donut", points: [
      { label: "Present", value: c.present }, { label: "Half day", value: c.half }, { label: "On leave", value: c.leave },
      { label: "Absent", value: c.absent }, { label: "Missing punch", value: c.missing }, { label: "Week off / holiday", value: c.notExpected },
    ], href: "/attendance" });
  }
  return { kpis, series };
}

// ── Who is out this week ─────────────────────────────────────────────────────────────────────
async function weekOut(ctx: InsightContext): Promise<InsightSection> {
  const blocked = noTeam(ctx);
  if (blocked) return blocked;
  const sc = f(ctx);
  const to = addDaysIso(ctx.today, 6);
  const [list, spans] = await Promise.all([
    rows<RowDataPacket>(
      `SELECT e.full_name name, DATE_FORMAT(lr.from_date, '%Y-%m-%d') f, DATE_FORMAT(lr.to_date, '%Y-%m-%d') t, lr.total_days days, COALESCE(lt.leave_name, lr.leave_type_code) type
         FROM leave_request lr JOIN employees e ON e.id = lr.employee_id AND e.active_status = 1
         LEFT JOIN leave_type_master lt ON lt.id = lr.leave_type_id
        WHERE lr.status = 'approved' AND lr.from_date <= ? AND lr.to_date >= ? ${sc.sql}
        ORDER BY lr.from_date, e.full_name LIMIT 25`, [to, ctx.today, ...sc.params]),
    rows<RowDataPacket>(
      `SELECT DATE_FORMAT(lr.from_date, '%Y-%m-%d') f, DATE_FORMAT(lr.to_date, '%Y-%m-%d') t, COUNT(DISTINCT lr.employee_id) people
         FROM leave_request lr JOIN employees e ON e.id = lr.employee_id AND e.active_status = 1
        WHERE lr.status = 'approved' AND lr.from_date <= ? AND lr.to_date >= ? ${sc.sql}
        GROUP BY lr.from_date, lr.to_date`, [to, ctx.today, ...sc.params]),
  ]);
  const perDay = expandLeaveDays(spans.map((s) => ({ from: String(s.f), to: String(s.t), people: num(s.people) ?? 1 })), ctx.today, to);
  const peak = perDay.reduce((m, d) => (d.out > m.out ? d : m), perDay[0]);
  const teamSize = num((await one<RowDataPacket>(`SELECT COUNT(*) n FROM employees e WHERE e.active_status = 1 ${sc.sql}`, sc.params))?.n) ?? 0;
  const peakAlarm = Math.max(3, Math.round(teamSize * 0.15));
  return {
    series: [{ key: "out_week", title: "Who's out - next 7 days", subtitle: "approved leave, head-count per day", kind: "bar", unit: "count", points: perDay.map((d) => ({ label: shortDay(d.date), value: d.out })), href: "/leaves" }],
    tables: [{ key: "out_list", title: "Away this week", href: "/leaves",
      columns: [{ key: "name", label: "Employee" }, { key: "type", label: "Leave" }, { key: "from", label: "From" }, { key: "to", label: "To" }, { key: "days", label: "Days", align: "right", unit: "count" }],
      rows: list.map((l) => ({ name: String(l.name), type: String(l.type ?? "Leave"), from: shortDay(String(l.f)), to: shortDay(String(l.t)), days: num(l.days) })) }],
    signals: peak && peak.out > 0 ? [{ tone: peak.out >= peakAlarm ? "watch" : "good", title: `Peak absence ${shortDay(peak.date)}`, detail: `${peak.out} team member${peak.out === 1 ? "" : "s"} on approved leave that day.`, value: peak.out, href: "/leaves" }] : [],
  };
}

// ── Team KPI vs target, bottom performers ────────────────────────────────────────────────────────
async function performance(ctx: InsightContext): Promise<InsightSection> {
  const blocked = noTeam(ctx);
  if (blocked) return blocked;
  const sc = f(ctx);
  const from = addDaysIso(ctx.today, -30);
  const [{ view }, facts, pip] = await Promise.all([
    opsViewFor(ctx),
    // Org-wide per-(employee, metric) aggregate, shared by every manager for a few minutes and filtered through
    // the caller's scoped view below - a cache hit can never widen scope.
    memo(`mgr-kpi|${from}|${ctx.today}`, () => rows<RowDataPacket>(
      `SELECT a.employee_id eid, m.metric_code code, m.metric_name name, m.unit unit, m.direction direction,
              SUM(a.numerator_value) n, SUM(a.denominator_value) d, AVG(a.actual_value) av, COUNT(*) c
         FROM kpi_daily_actual a JOIN kpi_metric_master m ON m.id = a.metric_id
        WHERE a.score_date BETWEEN ? AND ? AND m.metric_code <> 'ATTENDANCE_PCT'
        GROUP BY a.employee_id, a.metric_id`, [from, ctx.today])),
    guarded("manager.pip", async () => {
      const total = num((await one(`SELECT COUNT(*) n FROM pip_record`))?.n) ?? 0;
      const active = total ? num((await one(`SELECT COUNT(*) n FROM pip_record p JOIN employees e ON e.id = p.employee_id AND e.active_status = 1 WHERE p.status IN ('active','extended') ${sc.sql}`, sc.params))?.n) : null;
      return { total, active };
    }),
  ]);
  const grpMap = new Map<string, KpiGroupRow & { emps: Set<string> }>();
  const qualityBy = new Map<string, { sum: number; n: number }>();
  for (const r of facts) {
    const e = view.byId.get(String(r.eid));
    if (!e || e.active !== 1) continue;
    const key = `${r.code}|${e.process ?? ""}`;
    const g = grpMap.get(key) ?? { code: String(r.code), name: String(r.name), unit: r.unit ? String(r.unit) : null, direction: r.direction === "lower_is_better" ? "lower_is_better" as const : "higher_is_better" as const, processId: e.process, n: null, d: null, avg: null, samples: 0, employees: 0, emps: new Set<string>() };
    const c = num(r.c) ?? 0;
    const hasRatio = num(r.n) !== null && num(r.d) !== null;
    g.n = hasRatio ? (g.n ?? 0) + (num(r.n) as number) : g.n;
    g.d = hasRatio ? (g.d ?? 0) + (num(r.d) as number) : g.d;
    g.avg = ((g.avg ?? 0) * g.samples + (num(r.av) ?? 0) * c) / Math.max(g.samples + c, 1);
    g.samples += c;
    g.emps.add(String(r.eid));
    g.employees = g.emps.size;
    grpMap.set(key, g);
    if (r.code === "QUALITY_SCORE" && num(r.av) !== null) qualityBy.set(String(r.eid), { sum: (num(r.av) as number) * c, n: c });
  }
  const bottom = [...qualityBy.entries()].filter(([, v]) => v.n >= 3).map(([id, v]) => ({ id, name: view.byId.get(id)?.name ?? "-", score: Math.round((v.sum / v.n) * 10) / 10, days: v.n })).sort((x, y) => x.score - y.score).slice(0, 5);
  const groupRows: KpiGroupRow[] = [...grpMap.values()];
  const targets = new Map<string, number>();
  const procIds = [...new Set(groupRows.map((g) => g.processId).filter((x): x is string => !!x))].slice(0, 300);
  const codes = [...new Set(groupRows.map((g) => g.code))].slice(0, 60);
  if (procIds.length && codes.length) {
    const tr = await rows<RowDataPacket>(
      `SELECT d.process_id, m.metric_code, d.target_value FROM kpi_studio_definition d JOIN kpi_metric_master m ON m.id = d.metric_id
        WHERE d.active_status = 1 AND d.effective_to IS NULL AND d.employee_id IS NULL AND d.target_value IS NOT NULL
          AND d.process_id IN (${procIds.map(() => "?").join(",")}) AND m.metric_code IN (${codes.map(() => "?").join(",")})`, [...procIds, ...codes]);
    for (const r of tr) { const v = num(r.target_value); if (v !== null) targets.set(`${r.process_id}|${r.metric_code}`, v); }
  }
  const rolled = rollupKpis(groupRows, targets).slice(0, 8);
  const unitText = (v: number | null, unit: string | null) => v === null ? "-" : `${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })}${unit === "percent" || unit === "percentage" ? "%" : unit === "seconds" ? " s" : unit === "minutes" ? " min" : ""}`;
  const withTarget = rolled.filter((r) => r.achievementPct !== null);
  const avgAch = round1(mean(withTarget.map((r) => r.achievementPct)));
  const quality = rolled.find((r) => r.code === "QUALITY_SCORE");

  const kpis: InsightKpi[] = [
    { key: "kpi_achievement", label: "Team KPI vs target", value: avgAch, unit: "percent", deltaLabel: withTarget.length ? `${withTarget.length} metrics with a target · last 30 days` : "last 30 days", tone: toneFor(avgAch, 100, 90), formula: "Mean of per-metric attainment (actual / target, inverted for lower-is-better, capped 120%) over metrics where processes holding half the samples have an active target. Attendance KPI is excluded - attendance has one system of record.", href: "/kpi/my-team", unavailable: avgAch === null ? "No metric with a configured target has data for this team" : null },
    { key: "kpi_quality", label: "Team quality score", value: quality?.value ?? null, unit: "percent", deltaLabel: "last 30 days", tone: toneFor(quality?.value ?? null, 85, 75), formula: "SUM(numerator)/SUM(denominator) of QUALITY_SCORE actuals over the team, last 30 days.", href: "/kpi/my-team", unavailable: quality ? null : "No quality actuals for this team" },
  ];
  if (pip.value) {
    kpis.push({ key: "pip_active", label: "On PIP", value: pip.value.active, unit: "count", higherIsBetter: false, tone: (pip.value.active ?? 0) > 0 ? "amber" : "green", formula: "pip_record rows with status active/extended for team members.", href: "/performance", unavailable: pip.value.total === 0 ? "No PIPs have ever been recorded" : null });
  }
  return {
    kpis,
    tables: [
      { key: "team_kpi", title: "Team KPIs vs target", href: "/kpi/my-team",
        columns: [{ key: "metric", label: "KPI" }, { key: "value", label: "Team", align: "right" }, { key: "target", label: "Target", align: "right" }, { key: "ach", label: "Attainment", align: "right", unit: "percent" }, { key: "emps", label: "People", align: "right", unit: "count" }],
        rows: rolled.map((r) => ({ metric: r.name, value: unitText(r.value, r.unit), target: unitText(r.target, r.unit), ach: r.achievementPct, emps: r.employees })),
        unavailable: rolled.length ? null : "No KPI actuals for this team in the last 30 days" },
      { key: "bottom", title: "Needs coaching - lowest quality (30d)", href: "/team/coaching",
        columns: [{ key: "name", label: "Employee" }, { key: "score", label: "Quality", align: "right", unit: "percent" }, { key: "days", label: "Scored days", align: "right", unit: "count" }],
        rows: bottom.map((b) => ({ name: b.name, score: b.score, days: b.days, href: "/team/coaching" })),
        unavailable: bottom.length ? null : "Fewer than 3 scored days per person - nothing to rank" },
    ],
  };
}

// ── Attrition / retention risk ───────────────────────────────────────────────────────────────────
async function people(ctx: InsightContext): Promise<InsightSection> {
  const blocked = noTeam(ctx);
  if (blocked) return blocked;
  const { ops, view } = await opsViewFor(ctx);
  const scores = await computeRiskScores(ops, view);
  const ranked = [...scores.entries()].map(([id, r]) => ({ id, ...r, name: view.byId.get(id)?.name ?? "—" })).sort((a, b) => b.score - a.score);
  const high = ranked.filter((r) => r.level === "high").length;
  const med = ranked.filter((r) => r.level === "medium").length;
  const share = ranked.length ? high / ranked.length : null;
  return {
    kpis: [
      { key: "risk_high", label: "High retention risk", value: ranked.length ? high : null, unit: "count", higherIsBetter: false, deltaLabel: `${med} more at medium · of ${ranked.length}`, tone: high > 0 ? "red" : "green", formula: `Composite 0-100 indicator (absence, lateness, warnings, PIP, notice, tenure, call quality, training) - high >= ${RISK_HIGH}. An indicator, not a prediction.`, href: "/my-team" },
    ],
    tables: [{ key: "risk_list", title: "Attrition-risk watchlist", href: "/my-team",
      columns: [{ key: "name", label: "Employee" }, { key: "score", label: "Risk", align: "right", unit: "score" }, { key: "why", label: "Why" }],
      rows: ranked.filter((r) => r.level !== "low").slice(0, 8).map((r) => ({ name: r.name, score: r.score, why: r.reasons.slice(0, 3).join(" · ") })),
      unavailable: ranked.length ? null : "No active team members to score" }],
    signals: share !== null && share > 0 ? [{ tone: share >= 0.1 ? "bad" : "watch", title: `${high} high-risk team member${high === 1 ? "" : "s"}`, detail: "Combine absence, lateness, notice and quality signals - review in 1:1s this week.", value: high, href: "/my-team" }] : [],
  };
}

// ── Coaching / 1:1 ───────────────────────────────────────────────────────────────────────────────
async function coaching(ctx: InsightContext): Promise<InsightSection> {
  const blocked = noTeam(ctx);
  if (blocked) return blocked;
  const sc = f(ctx);
  const [up, findings] = await Promise.all([
    rows<RowDataPacket>(
      `SELECT e.full_name name, cs.session_type type, DATE_FORMAT(cs.session_date, '%Y-%m-%d') d, cs.status status
         FROM coaching_session cs JOIN employees e ON e.id = cs.employee_id AND e.active_status = 1
        WHERE cs.status = 'scheduled' AND cs.session_date <= ? ${sc.sql}
        ORDER BY cs.session_date LIMIT 10`, [addDaysIso(ctx.today, 14), ...sc.params]),
    one<RowDataPacket>(
      `SELECT COUNT(*) n FROM tni_finding t JOIN employees e ON e.id = t.employee_id AND e.active_status = 1
        WHERE t.status = 'OPEN' ${sc.sql}`, sc.params),
  ]);
  const overdue = up.filter((u) => String(u.d) < ctx.today).length;
  return {
    kpis: [{ key: "tni_open", label: "Open training-need findings", value: num(findings?.n), unit: "count", higherIsBetter: false, tone: (num(findings?.n) ?? 0) > 0 ? "amber" : "green", formula: "tni_finding rows still OPEN for team members (QA-derived coaching needs).", href: "/wfm/tni-analysis" }],
    tables: [{ key: "coach_next", title: "Coaching & 1:1 - next 14 days", href: "/team/coaching",
      columns: [{ key: "name", label: "Employee" }, { key: "type", label: "Type" }, { key: "when", label: "Date" }, { key: "state", label: "State" }],
      rows: up.map((u) => ({ name: String(u.name), type: String(u.type), when: shortDay(String(u.d)), state: String(u.d) < ctx.today ? `overdue ${dayDiff(ctx.today, String(u.d))}d` : "scheduled" })),
      unavailable: up.length ? null : "No coaching or 1:1 sessions are scheduled in the next 14 days" }],
    signals: overdue ? [{ tone: "bad", title: `${overdue} coaching session${overdue === 1 ? "" : "s"} overdue`, detail: "Scheduled date has passed without completion.", value: overdue, href: "/team/coaching" }] : [],
  };
}

// ── Birthdays & anniversaries ────────────────────────────────────────────────────────────────────
async function celebrations(ctx: InsightContext): Promise<InsightSection> {
  const blocked = noTeam(ctx);
  if (blocked) return blocked;
  const sc = f(ctx);
  const win = upcomingMonthDays(ctx.today, 7);
  const mds = win.map((w) => w.md);
  const ph = mds.map(() => "?").join(",");
  const r = await rows<RowDataPacket>(
    `SELECT e.full_name name, DATE_FORMAT(e.date_of_birth, '%m-%d') bmd, DATE_FORMAT(e.date_of_joining, '%m-%d') jmd, DATE_FORMAT(e.date_of_joining, '%Y-%m-%d') joined
       FROM employees e WHERE e.active_status = 1 ${sc.sql}
        AND (DATE_FORMAT(e.date_of_birth, '%m-%d') IN (${ph}) OR (DATE_FORMAT(e.date_of_joining, '%m-%d') IN (${ph}) AND e.date_of_joining < ?))
      LIMIT 60`, [...sc.params, ...mds, ...mds, ctx.today]);
  const events: Array<{ date: string; name: string; what: string }> = [];
  for (const x of r) {
    const b = win.find((w) => w.md === x.bmd);
    if (b) events.push({ date: b.date, name: String(x.name), what: "Birthday" });
    const j = win.find((w) => w.md === x.jmd);
    const yrs = j ? yearsOn(String(x.joined), j.date) : 0;
    if (j && yrs >= 1) events.push({ date: j.date, name: String(x.name), what: `${yrs}-year work anniversary` });
  }
  events.sort((a, b) => a.date.localeCompare(b.date));
  return {
    tables: [{ key: "celebrations", title: "Birthdays & anniversaries - next 7 days",
      columns: [{ key: "name", label: "Employee" }, { key: "what", label: "Occasion" }, { key: "when", label: "When" }],
      rows: events.slice(0, 12).map((e) => ({ name: e.name, what: e.what, when: e.date === ctx.today ? "Today" : shortDay(e.date) })),
      unavailable: events.length ? null : "No birthdays or anniversaries in the next 7 days" }],
  };
}

// ── Training ─────────────────────────────────────────────────────────────────────────────────────
async function training(ctx: InsightContext): Promise<InsightSection> {
  const blocked = noTeam(ctx);
  if (blocked) return blocked;
  const sc = f(ctx);
  const [agg, due] = await Promise.all([
    one<RowDataPacket>(
      `SELECT COUNT(*) n, SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END) done, SUM(CASE WHEN s.status IN ('not_started','in_progress') AND s.due_date < ? THEN 1 ELSE 0 END) overdue,
              SUM(CASE WHEN s.status = 'failed' THEN 1 ELSE 0 END) failed
         FROM lms_learning_progress_snapshot s JOIN employees e ON e.id = s.employee_id AND e.active_status = 1 WHERE 1=1 ${sc.sql}`, [ctx.today, ...sc.params]),
    rows<RowDataPacket>(
      `SELECT e.full_name name, s.course_name course, DATEDIFF(?, s.due_date) late
         FROM lms_learning_progress_snapshot s JOIN employees e ON e.id = s.employee_id AND e.active_status = 1
        WHERE s.status IN ('not_started','in_progress') AND s.due_date < ? ${sc.sql} ORDER BY s.due_date LIMIT 8`, [ctx.today, ctx.today, ...sc.params]),
  ]);
  const n = num(agg?.n) ?? 0;
  const rate = n ? pct(num(agg?.done), n) : null;
  return {
    kpis: [{ key: "train_rate", label: "Training completion", value: rate, unit: "percent", deltaLabel: n ? `${n} assignments` : undefined, tone: toneFor(rate, 70, 40), formula: "Completed assignments / all LMS assignments for the team.", drill: { metricCode: "TRAINING_PROGRESS" }, unavailable: n ? null : "No LMS assignments synced for this team" }],
    tables: [{ key: "train_due", title: "Training past due", href: `/dashboards/drill/${DRILL}/TRAINING_PROGRESS`,
      columns: [{ key: "name", label: "Employee" }, { key: "course", label: "Course" }, { key: "late", label: "Days late", align: "right", unit: "days" }],
      rows: due.map((d) => ({ name: String(d.name), course: String(d.course ?? "Course"), late: num(d.late) })),
      unavailable: due.length ? null : "No courses are past their due date" }],
  };
}

// ── Team health (hero ring) ──────────────────────────────────────────────────────────────────────
async function health(ctx: InsightContext): Promise<InsightSection> {
  const blocked = noTeam(ctx);
  if (blocked) return {};
  const { days } = await attendanceDays(ctx);
  const last = days[days.length - 1];
  const sc = f(ctx);
  const [pend, team] = await Promise.all([
    one<RowDataPacket>(
      `SELECT (SELECT COUNT(*) FROM attendance_regularization r JOIN employees e ON e.id = r.employee_id AND e.active_status = 1 WHERE r.status = 'pending' ${sc.sql}) total,
              (SELECT COUNT(*) FROM attendance_regularization r JOIN employees e ON e.id = r.employee_id AND e.active_status = 1 WHERE r.status = 'pending' AND DATEDIFF(?, DATE(r.created_at)) > ${QUEUE_SLA_DAYS} ${sc.sql}) overdue`,
      [...sc.params, ctx.today, ...sc.params]),
    one<RowDataPacket>(`SELECT COUNT(*) n FROM employees e WHERE e.active_status = 1 ${sc.sql}`, sc.params),
  ]);
  const { ops, view } = await opsViewFor(ctx);
  const scores = await computeRiskScores(ops, view).catch(() => null);
  const highShare = scores && team && num(team.n) ? [...scores.values()].filter((s) => s.level === "high").length / (num(team.n) as number) : null;
  const total = num(pend?.total) ?? 0;
  const h = teamHealth({ attendancePct: last ? attendanceRate(last.c) : null, overdueShare: total ? (num(pend?.overdue) ?? 0) / total : total === 0 ? 0 : null, highRiskShare: highShare });
  return h ? { healthScore: h.score, healthBasis: h.basis } : { healthScore: null, healthBasis: "Not enough data to score team health." };
}

const provider: InsightProvider = {
  sections: { queues, attendance, weekOut, performance, people, coaching, celebrations, training, health },
};

export default provider;
export { hrefExit };
