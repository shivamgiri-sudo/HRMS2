import type { RowDataPacket } from "mysql2";
import { getEmployeeForUser } from "../../../../shared/accessGuard.js";
import { getLiveKpiPerformance } from "../../../kpi/kpi-master.service.js";
import { num, one, rows, toneFor } from "../helpers.js";
import type { InsightAction, InsightContext, InsightKpi, InsightProvider, InsightSection, InsightSignal, InsightTable } from "../types.js";
import {
  addDays,
  buildLeaveBalances,
  calendarCell,
  canonicalPayLines,
  cumulativePct,
  daysBetween,
  daysUntilAnnual,
  summariseLeave,
  summariseMonth,
  todayState,
  VISIBLE_RUN_STATUSES,
  runRank,
  ytdTotals,
  prevMonthPrefix,
  prevMonthStart,
  type DayRow,
  type PayLine,
} from "./employeeCalc.js";

/**
 * EMPLOYEE_SELF_DASHBOARD insights ("My Day"). Everything here is keyed to the CALLER's own
 * employee row (ctx.userId -> employees.id) — never to ctx.scope — so it cannot widen.
 * Each section is independent: a slow or failing source degrades only its own card.
 */

interface SelfEmp extends RowDataPacket {
  id: string;
  branch_id: string | null;
  reporting_manager_id: string | null;
  ws: string | null;
  we: string | null;
  doj: string | null;
}

const selfCache = new WeakMap<InsightContext, Promise<SelfEmp | null>>();

/** Resolve the caller's employee row once per request (all sections share it). */
function selfEmployee(ctx: InsightContext): Promise<SelfEmp | null> {
  let hit = selfCache.get(ctx);
  if (!hit) {
    hit = (async () => {
      const mapped = await getEmployeeForUser(ctx.userId);
      if (!mapped) return null;
      return one<SelfEmp>(
        `SELECT id, branch_id, reporting_manager_id,
                TIME_FORMAT(working_hours_start, '%H:%i') AS ws,
                TIME_FORMAT(working_hours_end, '%H:%i') AS we,
                DATE_FORMAT(date_of_joining, '%Y-%m-%d') AS doj
           FROM employees WHERE id = ? LIMIT 1`,
        [mapped.id],
      );
    })();
    selfCache.set(ctx, hit);
  }
  return hit;
}

const NO_EMPLOYEE = "Your login is not linked to an employee record, so personal data cannot be shown.";

/** Run `body` with the caller's employee, or answer "unavailable" instead of fabricating zeros. */
function withSelf(body: (emp: SelfEmp, ctx: InsightContext) => Promise<InsightSection>) {
  return async (ctx: InsightContext): Promise<InsightSection> => {
    const emp = await selfEmployee(ctx);
    if (!emp) return { kpis: [{ key: "self_unavailable", label: "My data", value: null, unavailable: NO_EMPLOYEE }] };
    return body(emp, ctx);
  };
}

/** Completed expected-working days needed before attendance % is colour-judged. */
const MIN_JUDGED_DAYS = 5;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const dayLabel = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ───────────────────────── today (shift + punch state) ─────────────────────────

async function today(emp: SelfEmp, ctx: InsightContext): Promise<InsightSection> {
  const [roster, session, record, hol, leave] = await Promise.all([
    one(
      `SELECT is_week_off, shift_start_time AS st, shift_end_time AS et
         FROM wfm_roster_assignment WHERE employee_id = ? AND roster_date = ? LIMIT 1`,
      [emp.id, ctx.today],
    ),
    one(
      `SELECT TIME_FORMAT(MIN(login_time), '%H:%i') AS li, TIME_FORMAT(MAX(logout_time), '%H:%i') AS lo,
              SUM(logout_time IS NULL) AS open_sessions
         FROM wfm_attendance_session WHERE employee_id = ? AND session_date = ?`,
      [emp.id, ctx.today],
    ),
    one(
      `SELECT attendance_status AS s, TIME_FORMAT(clock_in_time, '%H:%i') AS ci, TIME_FORMAT(clock_out_time, '%H:%i') AS co, raw_minutes
         FROM attendance_daily_record WHERE employee_id = ? AND record_date = ? LIMIT 1`,
      [emp.id, ctx.today],
    ),
    one(
      `SELECT holiday_name FROM leave_holiday_master
        WHERE holiday_date = ? AND active_status = 1 AND (branch_id IS NULL OR branch_id <=> ?) LIMIT 1`,
      [ctx.today, emp.branch_id],
    ),
    one(
      `SELECT 1 AS x FROM leave_request
        WHERE employee_id = ? AND status = 'approved' AND from_date <= ? AND to_date >= ? LIMIT 1`,
      [emp.id, ctx.today, ctx.today],
    ),
  ]);

  // Rostered shift wins; the profile's working hours are the documented fallback.
  const shiftStart = (roster?.st as string | null) || emp.ws;
  const shiftEnd = (roster?.et as string | null) || emp.we;
  const punchIn = (session?.li as string | null) || (record?.ci as string | null) || null;
  // A trailing open session means the person is still in; only trust logout when none is open.
  const openSessions = Number(session?.open_sessions ?? 0);
  const punchOut = openSessions > 0 ? null : ((session?.lo as string | null) || (record?.co as string | null) || null);
  const ist = new Date(Date.now() + 5.5 * 3_600_000);
  const state = todayState({
    weekOff: Boolean(roster && Number(roster.is_week_off) === 1) || record?.s === "week_off",
    holiday: Boolean(hol) || record?.s === "holiday",
    onLeave: Boolean(leave) || record?.s === "leave_approved",
    punchIn,
    punchOut,
    shiftStart,
    nowMinutes: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
  });

  return {
    tables: [{
      key: "today",
      title: "Today",
      columns: [
        { key: "state", label: "State" }, { key: "shift", label: "Shift" }, { key: "punchIn", label: "In" },
        { key: "punchOut", label: "Out" }, { key: "shiftSource", label: "Shift source" }, { key: "holiday", label: "Holiday" },
      ],
      rows: [{
        state,
        shift: shiftStart && shiftEnd ? `${shiftStart} – ${shiftEnd}` : null,
        punchIn,
        punchOut,
        shiftSource: roster?.st ? "roster" : emp.ws ? "profile working hours" : null,
        holiday: (hol?.holiday_name as string | undefined) ?? null,
      }],
      href: "/my-roster",
    }],
  };
}

// ───────────────────────── attendance month ─────────────────────────

const DAY_SQL = `SELECT DATE_FORMAT(record_date, '%Y-%m-%d') AS d, attendance_status AS s, late_mark, late_by_minutes,
                        lwp_value, raw_minutes
                   FROM attendance_daily_record
                  WHERE employee_id = ? AND record_date >= ? AND record_date <= ?`;

async function loadDays(empId: string, todayIso: string): Promise<DayRow[]> {
  const r = await rows(DAY_SQL, [empId, prevMonthStart(todayIso), todayIso]);
  return r.map((x) => ({
    d: String(x.d), s: String(x.s), late: Number(x.late_mark ?? 0), lateBy: Number(x.late_by_minutes ?? 0),
    lwp: Number(x.lwp_value ?? 0), mins: Number(x.raw_minutes ?? 0),
  }));
}

async function attendance(emp: SelfEmp, ctx: InsightContext): Promise<InsightSection> {
  const monthPrefix = ctx.today.slice(0, 7);
  const prevPrefix = prevMonthPrefix(ctx.today);
  const monthEnd = new Date(Date.UTC(Number(monthPrefix.slice(0, 4)), Number(monthPrefix.slice(5, 7)), 0)).getUTCDate();
  const [days, hols] = await Promise.all([
    loadDays(emp.id, ctx.today),
    rows(
      `SELECT DISTINCT DATE_FORMAT(holiday_date, '%Y-%m-%d') AS d FROM leave_holiday_master
        WHERE active_status = 1 AND holiday_date BETWEEN ? AND ? AND (branch_id IS NULL OR branch_id <=> ?)`,
      [`${monthPrefix}-01`, `${monthPrefix}-${String(monthEnd).padStart(2, "0")}`, emp.branch_id],
    ),
  ]);
  const cur = summariseMonth(days, monthPrefix, ctx.today);
  const prev = summariseMonth(days, prevPrefix, `${monthPrefix}-01`);
  const holidaySet = new Set(hols.map((h) => String(h.d)));
  const byDate = new Map(days.map((d) => [d.d, d]));

  const calendar = Array.from({ length: monthEnd }, (_, i) => {
    const date = `${monthPrefix}-${String(i + 1).padStart(2, "0")}`;
    const row = byDate.get(date);
    return {
      label: date,
      value: row ? row.mins : null,
      status: calendarCell(row, date, ctx.today, holidaySet.has(date)),
      late: row?.late === 1 && date < ctx.today ? 1 : 0,
      lateBy: row && row.late === 1 ? row.lateBy : 0,
      lwp: row && date < ctx.today ? row.lwp : 0,
    };
  });

  const noData = cur.settledRows === 0
    ? `No completed attendance days are processed for ${monthLabel(monthPrefix)} yet (attendance is processed with a lag; today is never counted).`
    : null;
  const through = cur.settledThrough ? `through ${dayLabel(cur.settledThrough)}` : undefined;
  const spark = cumulativePct(days, monthPrefix, ctx.today);
  // Two completed days say little: 1 half-day on 1 Oct reads "50%". Below this basis the figure is
  // shown but not judged (no red tone, no good/bad signal, no month-on-month delta).
  const lowBasis = cur.expected < MIN_JUDGED_DAYS;
  const ring = lowBasis && prev.pct !== null ? prev.pct : cur.pct;
  const pp = !lowBasis && cur.pct !== null && prev.pct !== null ? Math.round((cur.pct - prev.pct) * 10) / 10 : null;
  const formula = "(full days + 0.5 x half days) / (completed days - holidays - week-offs - approved leave). Today is excluded until it is reconciled.";

  const kpis: InsightKpi[] = [
    { key: "att_pct", label: "Attendance", value: cur.pct, unit: "percent", spark: spark.length > 1 ? spark : undefined,
      tone: lowBasis ? "slate" : toneFor(cur.pct, 95, 85), delta: pp, deltaLabel: pp === null ? through : `vs ${monthLabel(prevPrefix)} full month`,
      helper: lowBasis && prev.pct !== null ? `${through ?? ""} · ${monthLabel(prevPrefix)} closed at ${prev.pct}%`.trim() : through, formula, href: "/attendance", unavailable: noData },
    { key: "att_present", label: "Present days", value: noData ? null : cur.present, unit: "days", tone: "green",
      helper: `of ${cur.expected} expected`, href: "/attendance", unavailable: noData },
    { key: "att_half", label: "Half days", value: noData ? null : cur.half, unit: "days", tone: cur.half > 0 ? "amber" : "green",
      helper: "each counts 0.5 present / 0.5 LOP", href: "/attendance", unavailable: noData },
    { key: "att_absent", label: "Absent", value: noData ? null : cur.absent, unit: "days", tone: cur.absent > 0 ? "red" : "green",
      helper: "1 LOP day each", href: "/attendance", unavailable: noData },
    { key: "att_late", label: "Late marks", value: noData ? null : cur.late, unit: "count", tone: cur.late >= 5 ? "red" : cur.late >= 3 ? "amber" : "green",
      higherIsBetter: false, helper: "days you clocked in after grace", href: "/attendance", unavailable: noData },
    { key: "att_lop", label: "LOP booked", value: noData ? null : cur.lop, unit: "days", tone: cur.lop > 0 ? "red" : "green", higherIsBetter: false,
      helper: "sum of loss-of-pay on completed days", href: "/attendance", unavailable: noData },
  ];

  const actions: InsightAction[] = [];
  if (cur.openDays > 0 && cur.oldestOpenDay) {
    actions.push({
      id: "regularise_days", label: "Days to regularise", count: cur.openDays, group: "Attendance",
      severity: cur.missing + cur.unreconciled > 0 ? "high" : "normal",
      oldestDays: daysBetween(cur.oldestOpenDay, ctx.today),
      hint: `${cur.missing} missing punch · ${cur.absent} absent · fix before payroll cut-off`,
      href: "/attendance-regularization",
    });
  }

  const signals: InsightSignal[] = [];
  if (cur.missing > 0) {
    signals.push({ tone: "watch", title: "Missing punches this month", detail: "Regularise them so the days are not marked absent.", value: cur.missing, href: "/attendance-regularization" });
  }
  if (cur.lop > 0) {
    signals.push({ tone: "bad", title: "Loss of pay booked", detail: `${cur.lop} day(s) of LOP on completed days this month.`, value: `${cur.lop}d`, href: "/attendance" });
  }
  if (!lowBasis && cur.pct !== null && cur.pct >= 95) {
    signals.push({ tone: "good", title: "Attendance on track", detail: `${cur.pct}% ${through ?? ""}`.trim(), value: `${cur.pct}%`, href: "/attendance" });
  } else if (!lowBasis && cur.pct !== null && cur.pct < 85) {
    signals.push({ tone: "bad", title: "Attendance below 85%", detail: "Check absent / half days and raise regularisation where punches were missed.", value: `${cur.pct}%`, href: "/attendance" });
  }

  return {
    kpis, actions, signals,
    // Early in the month the ring shows the last closed month instead of a 1-day figure.
    healthScore: ring === null ? null : Math.max(0, Math.min(100, Math.round(ring))),
    healthBasis: ring === null ? null : lowBasis && prev.pct !== null ? `Attendance ${monthLabel(prevPrefix)} (closed month)` : `Attendance ${monthLabel(monthPrefix)} ${through ?? ""}`.trim(),
    series: [{
      key: "att_calendar", title: `Attendance — ${monthLabel(monthPrefix)}`, kind: "heat", points: calendar, href: "/attendance",
      subtitle: through ? `Completed days ${through}; today and later are not counted` : undefined,
      unavailable: null,
    }],
  };
}

// ───────────────────────── late / half-day rules ─────────────────────────

async function rules(emp: SelfEmp, ctx: InsightContext): Promise<InsightSection> {
  const monthPrefix = ctx.today.slice(0, 7);
  const rule = await one(
    `SELECT arc.full_day_minutes AS fd, arc.half_day_minutes AS hd, arc.grace_minutes AS gr, arc.attendance_source AS src
       FROM attendance_daily_record adr
       JOIN attendance_rule_config arc ON arc.id = adr.rule_config_id
      WHERE adr.employee_id = ? AND adr.record_date >= ? AND adr.rule_config_id IS NOT NULL
      ORDER BY adr.record_date DESC LIMIT 1`,
    [emp.id, `${monthPrefix}-01`],
  );
  const days = await loadDays(emp.id, ctx.today);
  const cur = summariseMonth(days, monthPrefix, ctx.today);
  if (!rule) {
    return { signals: [], tables: [{ key: "att_rule", title: "My attendance rule", columns: [], rows: [], unavailable: "No attendance rule has been applied to your records this month yet." }] };
  }
  const fd = num(rule.fd);
  const hd = num(rule.hd);
  const gr = num(rule.gr);
  const lateBy = days.filter((d) => d.d.startsWith(monthPrefix) && d.d < ctx.today && d.late === 1).map((d) => d.lateBy);
  const avgLate = lateBy.length ? Math.round(lateBy.reduce((a, b) => a + b, 0) / lateBy.length) : null;
  const table: InsightTable = {
    key: "att_rule",
    title: "My attendance rule",
    columns: [{ key: "item", label: "Rule" }, { key: "value", label: "Value", align: "right" }],
    rows: [
      { item: "Full day at", value: fd === null ? null : `${fd} min (${Math.round((fd / 60) * 10) / 10} h) ${rule.src}` },
      { item: "Half day at", value: hd === null ? null : `${hd} min — below this is absent` },
      { item: "Late grace", value: gr === null ? null : `${gr} min after shift start` },
      { item: "Late marks this month", value: cur.late },
      { item: "Average lateness", value: avgLate === null ? null : `${avgLate} min` },
      { item: "Half days this month", value: cur.half },
    ],
    href: "/attendance",
  };
  const signals: InsightSignal[] = [];
  // The product records late marks but has NO late-mark -> half-day conversion rule (verified:
  // payroll LOP is SUM(lwp_value); lwp is 0.5 for half_day, 1.0 for absent, 0 for a late present day).
  // So the risk is worked minutes, not the late count — say that instead of inventing a threshold.
  if (cur.late > 0 && fd !== null) {
    signals.push({
      tone: cur.late >= 5 ? "bad" : "watch",
      title: `${plural(cur.late, "late mark")} this month`,
      detail: `A late mark alone is not a deduction. LOP comes from worked time: under ${fd} min is a half day (0.5 LOP)${hd !== null ? `, under ${hd} min is absent (1 LOP)` : ""}.`,
      value: cur.late, href: "/attendance",
    });
  }
  return { tables: [table], signals };
}

// ───────────────────────── leave ─────────────────────────

async function leave(emp: SelfEmp, ctx: InsightContext): Promise<InsightSection> {
  const year = Number(ctx.today.slice(0, 4));
  const month = Number(ctx.today.slice(5, 7));
  const [bal, hol, credit, el] = await Promise.all([
    rows(
      `SELECT lt.leave_code AS code, lt.leave_name AS name, lt.carry_forward AS cf,
              lbl.allocated_days AS a, lbl.used_days AS u, lbl.adjusted_days AS adj
         FROM leave_balance_ledger lbl JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
        WHERE lbl.employee_id = ? AND lbl.balance_year = ? AND lt.active_status = 1`,
      [emp.id, year],
    ),
    rows(
      `SELECT DATE_FORMAT(holiday_date, '%Y-%m-%d') AS d, MIN(holiday_name) AS name FROM leave_holiday_master
        WHERE active_status = 1 AND holiday_date >= ? AND (branch_id IS NULL OR branch_id <=> ?)
        GROUP BY holiday_date ORDER BY holiday_date LIMIT 5`,
      [ctx.today, emp.branch_id],
    ),
    rows(`SELECT month, leave_code AS code, credit_days AS days FROM leave_credit_schedule WHERE month > ? ORDER BY month LIMIT 1`, [month]),
    one(`SELECT accrued_days, last_credited_month FROM leave_el_accrual_ledger WHERE employee_id = ? AND accrual_year = ? LIMIT 1`, [emp.id, year]),
  ]);

  const balances = buildLeaveBalances(bal.map((b) => ({
    code: String(b.code), name: String(b.name), carryForward: Number(b.cf) === 1,
    allocated: Number(b.a ?? 0), used: Number(b.u ?? 0), adjusted: Number(b.adj ?? 0),
  })));
  const sum = summariseLeave(balances, ctx.today);
  const next = credit[0] as RowDataPacket | undefined;
  const noLedger = balances.length === 0 ? `No leave balance has been allocated to you for ${year}.` : null;

  const kpis: InsightKpi[] = [
    { key: "leave_available", label: "Leave available", value: noLedger ? null : sum.available, unit: "days", tone: "violet",
      helper: noLedger ? undefined : "regular types (excludes maternity / paternity, LWP)", href: "/leaves",
      formula: "allocated + adjusted - used, per leave type, floored at 0; event-based types are listed but not pooled", unavailable: noLedger },
    { key: "leave_lapsing", label: "Lapsing 31 Dec", value: noLedger ? null : sum.lapsing, unit: "days",
      tone: sum.lapsing > 0 && sum.lapsesInDays <= 90 ? "amber" : "slate", higherIsBetter: false,
      helper: noLedger ? undefined : `${sum.lapsesInDays} days left; types with no carry-forward`, href: "/leaves",
      formula: "Remaining days on leave types where carry_forward = 0 — they do not roll into next year's ledger", unavailable: noLedger },
  ];

  const tables: InsightTable[] = [
    {
      key: "leave_balances", title: "Leave balances", href: "/leaves", unavailable: noLedger,
      columns: [
        { key: "type", label: "Type" }, { key: "remaining", label: "Left", unit: "days", align: "right" },
        { key: "used", label: "Used", unit: "days", align: "right" }, { key: "total", label: "Granted", unit: "days", align: "right" },
        { key: "note", label: "Note" },
      ],
      rows: balances.map((b) => ({
        type: b.name, remaining: b.remaining, used: b.used, total: b.allocated + b.adjusted,
        note: b.eventBased ? "event-based" : b.carryForward ? "carries forward" : "lapses 31 Dec",
      })),
    },
    {
      key: "holidays", title: "Upcoming holidays", href: "/leaves",
      columns: [{ key: "date", label: "Date" }, { key: "name", label: "Holiday" }, { key: "in", label: "In", align: "right" }],
      rows: hol.map((h) => ({ date: dayLabel(String(h.d)), name: String(h.name), in: daysBetween(ctx.today, String(h.d)) === 0 ? "Today" : `${daysBetween(ctx.today, String(h.d))}d` })),
    },
    {
      key: "leave_accrual", title: "Leave accrual", href: "/leaves",
      columns: [{ key: "item", label: "Item" }, { key: "value", label: "Value", align: "right" }],
      rows: [
        { item: "Next scheduled credit", value: next ? `${num(next.days)} day ${next.code} in ${MONTHS[Number(next.month) - 1]}` : "None scheduled this year" },
        { item: `Earned leave credits ${year}`, value: el?.last_credited_month ? `credited through ${MONTHS[Number(el.last_credited_month) - 1]}` : null },
      ],
    },
  ];

  return { kpis, tables };
}

// ───────────────────────── my requests (leave + regularisation) ─────────────────────────

async function requests(emp: SelfEmp, ctx: InsightContext): Promise<InsightSection> {
  const [lv, reg] = await Promise.all([
    rows(
      `SELECT lt.leave_name AS type, DATE_FORMAT(lr.from_date, '%Y-%m-%d') AS f, DATE_FORMAT(lr.to_date, '%Y-%m-%d') AS t,
              lr.total_days AS days, lr.status,
              DATE_FORMAT(COALESCE(lr.requested_at, lr.applied_at, lr.created_at), '%Y-%m-%d') AS asked
         FROM leave_request lr JOIN leave_type_master lt ON lt.id = lr.leave_type_id
        WHERE lr.employee_id = ? AND (lr.status = 'pending' OR lr.to_date >= DATE_SUB(?, INTERVAL 30 DAY))
        ORDER BY lr.from_date DESC LIMIT 8`,
      [emp.id, ctx.today],
    ),
    rows(
      `SELECT DATE_FORMAT(session_date, '%Y-%m-%d') AS d, COALESCE(dispute_type, reason_code, LEFT(reason, 40)) AS kind, status,
              DATE_FORMAT(created_at, '%Y-%m-%d') AS asked
         FROM attendance_regularization
        WHERE employee_id = ? ORDER BY created_at DESC LIMIT 6`,
      [emp.id],
    ),
  ]);

  const pendingLeave = lv.filter((r) => r.status === "pending");
  const openReg = reg.filter((r) => ["pending", "manager_approved", "escalated"].includes(String(r.status)));
  const oldest = (list: RowDataPacket[]) => list.length ? Math.max(...list.map((r) => daysBetween(String(r.asked), ctx.today))) : null;
  const actions: InsightAction[] = [
    {
      id: "my_leave_pending", label: "My leave requests awaiting approval", count: pendingLeave.length, group: "My requests",
      severity: pendingLeave.some((r) => daysBetween(String(r.asked), ctx.today) > 3) ? "high" : pendingLeave.length ? "normal" : "info",
      oldestDays: oldest(pendingLeave), href: "/leaves",
      hint: pendingLeave.length ? pendingLeave.map((r) => `${r.type} ${dayLabel(String(r.f))}`).slice(0, 2).join(" · ") : undefined,
    },
    {
      id: "my_reg_open", label: "My regularisation requests in review", count: openReg.length, group: "My requests",
      severity: openReg.some((r) => daysBetween(String(r.asked), ctx.today) > 3) ? "high" : openReg.length ? "normal" : "info",
      oldestDays: oldest(openReg), href: "/attendance-regularization",
      hint: openReg.length ? openReg.map((r) => String(r.status).replace("_", " ")).slice(0, 2).join(" · ") : undefined,
    },
  ];

  const stat = (s: unknown) => String(s).replace(/_/g, " ");
  const tables: InsightTable[] = [
    {
      key: "my_leave_requests", title: "My leave requests", href: "/leaves",
      columns: [{ key: "type", label: "Type" }, { key: "dates", label: "Dates" }, { key: "days", label: "Days", align: "right" }, { key: "status", label: "Status" }],
      rows: lv.map((r) => ({ type: String(r.type), dates: r.f === r.t ? dayLabel(String(r.f)) : `${dayLabel(String(r.f))} – ${dayLabel(String(r.t))}`, days: num(r.days), status: stat(r.status) })),
    },
    {
      key: "my_regularisations", title: "My regularisation requests", href: "/attendance-regularization",
      columns: [{ key: "day", label: "Day" }, { key: "kind", label: "Reason" }, { key: "status", label: "Status" }],
      rows: reg.map((r) => ({ day: dayLabel(String(r.d)), kind: r.kind ? stat(r.kind) : "—", status: stat(r.status) })),
    },
  ];
  return { actions, tables };
}

// ───────────────────────── payslips ─────────────────────────

async function payslips(emp: SelfEmp, ctx: InsightContext): Promise<InsightSection> {
  const fyFrom = (() => {
    const [y, m] = ctx.today.split("-").map(Number);
    return `${m >= 4 ? y : y - 1}-04`;
  })();
  const vis = VISIBLE_RUN_STATUSES.map(() => "?").join(",");
  const [lines, slips] = await Promise.all([
    rows(
      `SELECT spr.run_month AS rm, spr.status AS rs, spl.id AS lid, spl.gross_salary AS gross, spl.net_salary AS net,
              spl.total_deductions AS ded, GREATEST(COALESCE(spl.tds_amount, 0), COALESCE(spl.tds, 0)) AS tds
         FROM salary_prep_line spl JOIN salary_prep_run spr ON spr.id = spl.run_id
        WHERE spl.employee_id = ? AND spr.run_month >= ? AND spr.status IN (${vis})
          AND spl.status NOT IN ('excluded', 'blocked')`,
      [emp.id, fyFrom, ...VISIBLE_RUN_STATUSES],
    ),
    rows(`SELECT CONVERT(prep_line_id USING utf8mb4) AS lid, acknowledged_at IS NOT NULL AS ack FROM salary_payslip WHERE employee_id = ? AND run_month >= ?`, [emp.id, fyFrom]),
  ]);
  const generated = new Map(slips.map((s) => [String(s.lid), Number(s.ack) === 1]));
  const payLines: Array<PayLine & { lid: string }> = lines.map((l) => ({
    runMonth: String(l.rm), rank: runRank(String(l.rs)), gross: num(l.gross), net: num(l.net), deductions: num(l.ded), tds: num(l.tds), lid: String(l.lid),
  }));
  // Only months with a generated payslip are shown as payslips; YTD still uses every finalised line.
  const issued = canonicalPayLines(payLines.filter((l) => generated.has(l.lid)));
  const ytd = ytdTotals(payLines, issued[0]?.runMonth ?? ctx.today.slice(0, 7));
  const latest = issued[0];
  const unack = latest ? generated.get(latest.lid) === false : false;
  const none = issued.length === 0 ? "No payslip has been issued to you this financial year yet." : null;

  const kpis: InsightKpi[] = [
    { key: "pay_latest_net", label: latest ? `Net pay ${monthLabel(latest.runMonth)}` : "Latest net pay", value: latest?.net ?? null, unit: "inr", tone: "green",
      helper: latest?.gross != null ? `gross ${Math.round(latest.gross).toLocaleString("en-IN")}` : undefined, href: "/payroll/payslips", unavailable: none },
    { key: "pay_ytd_gross", label: "Earnings FY to date", value: none ? null : ytd.gross, unit: "inr", tone: "blue", helper: `${plural(ytd.months, "month")} this FY`,
      formula: "Sum of gross over finalised runs from April, one line per run month", href: "/payroll/payslips", unavailable: none },
    { key: "pay_ytd_tds", label: "Tax (TDS) FY to date", value: none ? null : ytd.tds, unit: "inr", tone: "slate", href: "/payroll/payslips",
      formula: "Sum of TDS deducted over the same months", unavailable: none },
  ];
  const actions: InsightAction[] = latest && unack
    ? [{ id: "payslip_ack", label: `Payslip ${monthLabel(latest.runMonth)} is ready`, count: 1, severity: "normal", group: "Pay", href: "/payroll/payslips", hint: "View and acknowledge" }]
    : [];
  return {
    kpis, actions,
    tables: [{
      key: "payslips", title: "Last 3 payslips", href: "/payroll/payslips", unavailable: none,
      columns: [{ key: "month", label: "Month" }, { key: "gross", label: "Gross", unit: "inr", align: "right" }, { key: "ded", label: "Deductions", unit: "inr", align: "right" }, { key: "net", label: "Net", unit: "inr", align: "right" }],
      rows: issued.slice(0, 3).map((l) => ({ month: monthLabel(l.runMonth), gross: l.gross, ded: l.deductions, net: l.net, href: "/payroll/payslips" })),
    }],
  };
}

// ───────────────────────── performance (KPI) ─────────────────────────

async function kpi(emp: SelfEmp, ctx: InsightContext): Promise<InsightSection> {
  const perf = await getLiveKpiPerformance(emp.id, "mtd", ctx.today);
  const metrics = (perf.metrics ?? []) as Array<Record<string, unknown>>;
  const scored = metrics.filter((m) => m.actual_value !== null && m.actual_value !== undefined);
  if (!metrics.length || !scored.length) {
    const why = !metrics.length ? "No KPI targets are assigned to your role yet." : "No KPI data has been recorded for you this month yet.";
    return { kpis: [{ key: "kpi_score", label: "My KPI score", value: null, unit: "percent", href: "/my-kpi", unavailable: why }] };
  }
  const daily = [...((perf as { daily_performance?: Array<{ date: string; overall_score: number }> }).daily_performance ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const scores = daily.map((d) => d.overall_score);
  const last7 = scores.slice(-7);
  const prior7 = scores.slice(-14, -7);
  const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const delta = last7.length >= 3 && prior7.length >= 3 ? Math.round((avg(last7) - avg(prior7)) * 10) / 10 : null;
  const pcts = scored.map((m) => m.percentile).filter((p): p is number => typeof p === "number");
  const percentile = pcts.length ? Math.round(avg(pcts)) : null;
  const overall = Number((perf as { overall_score?: number }).overall_score);
  const rating = (perf as { overall_rating?: string | null }).overall_rating ?? null;

  const kpis: InsightKpi[] = [
    { key: "kpi_score", label: "My KPI score (MTD)", value: Number.isFinite(overall) ? overall : null, unit: "percent", tone: toneFor(overall, 90, 70),
      spark: scores.length >= 7 ? scores.slice(-14) : undefined, delta, deltaLabel: delta === null ? undefined : "last 7 days vs the 7 before",
      helper: rating ? `Rating ${rating}` : undefined, href: "/my-kpi",
      formula: "Weighted average of each KPI's score against its target, month to date" },
    { key: "kpi_percentile", label: "Peer standing", value: percentile, unit: "percent", tone: toneFor(percentile, 60, 40),
      helper: percentile === null ? undefined : `better than ~${percentile}% of peers on the same process`, href: "/my-kpi?tab=quality",
      formula: "Average of your per-KPI percentile among peers with the same process + designation (direction-aware)",
      unavailable: percentile === null ? "Not enough peers with data to rank you." : null },
  ];
  const table: InsightTable = {
    key: "kpi_metrics", title: "My KPIs vs target (weakest first)", href: "/my-kpi",
    columns: [{ key: "name", label: "KPI" }, { key: "actual", label: "Actual", align: "right" }, { key: "target", label: "Target", align: "right" }, { key: "score", label: "Score", unit: "percent", align: "right" }, { key: "pctile", label: "Peers", unit: "percent", align: "right" }],
    rows: [...scored].sort((a, b) => Number(a.score_pct) - Number(b.score_pct)).slice(0, 6).map((m) => ({
      name: String(m.metric_name), actual: Math.round(Number(m.actual_value) * 100) / 100, target: num(m.target_value),
      score: Math.round(Number(m.score_pct) * 10) / 10, pctile: typeof m.percentile === "number" ? m.percentile : null,
    })),
  };
  const signals: InsightSignal[] = [];
  const weakest = [...scored].sort((a, b) => Number(a.score_pct) - Number(b.score_pct))[0];
  if (weakest && Number(weakest.score_pct) < 70) {
    signals.push({ tone: "watch", title: `Biggest gap: ${String(weakest.metric_name)}`, detail: `Scoring ${Math.round(Number(weakest.score_pct))}% of target month to date.`, value: `${Math.round(Number(weakest.score_pct))}%`, href: "/my-kpi" });
  }
  if (delta !== null && delta >= 3) signals.push({ tone: "good", title: "Performance trending up", detail: `Daily score is ${delta} pts higher than the previous week.`, value: `+${delta}`, href: "/my-kpi" });
  if (delta !== null && delta <= -3) signals.push({ tone: "bad", title: "Performance trending down", detail: `Daily score is ${Math.abs(delta)} pts lower than the previous week.`, value: `${delta}`, href: "/my-kpi" });
  return { kpis, tables: [table], signals };
}

// ───────────────────────── other pending work ─────────────────────────

const CORE_DOCS = ["identity", "address_proof", "bank"] as const;

async function workItems(emp: SelfEmp, ctx: InsightContext): Promise<InsightSection> {
  const settled = await Promise.allSettled([
    rows(`SELECT status, DATE_FORMAT(created_at, '%Y-%m-%d') AS asked FROM helpdesk_ticket WHERE employee_id = ? AND status IN ('open','in_progress','pending_info','on_hold')`, [emp.id]),
    rows(`SELECT DISTINCT doc_category AS c FROM employee_documents WHERE employee_id = ? AND doc_category IN ('identity','address_proof','bank')`, [emp.id]),
    rows(
      `SELECT status, DATE_FORMAT(due_date, '%Y-%m-%d') AS due, completion_pct FROM lms_learning_progress_snapshot WHERE employee_id = ?`,
      [emp.id],
    ),
    rows(`SELECT target_value, actual_value FROM goal WHERE employee_id = ? AND status = 'active'`, [emp.id]),
    rows(
      `SELECT sm.survey_id FROM survey_master sm
        WHERE sm.is_active = 1 AND DATE(sm.start_date) <= ? AND DATE(sm.end_date) >= ?
          AND NOT EXISTS (SELECT 1 FROM survey_response sr WHERE sr.survey_id = sm.survey_id AND sr.employee_id = ?)`,
      [ctx.today, ctx.today, emp.id],
    ),
  ]);
  const [tickets, docs, learning, goals, surveys] = settled;
  const actions: InsightAction[] = [];
  const kpis: InsightKpi[] = [];
  const signals: InsightSignal[] = [];

  if (tickets.status === "fulfilled") {
    const t = tickets.value;
    const awaiting = t.filter((r) => r.status === "pending_info");
    actions.push({
      id: "helpdesk_reply", label: "Helpdesk tickets waiting for your reply", count: awaiting.length, group: "Support",
      severity: awaiting.length ? "high" : "info", oldestDays: awaiting.length ? Math.max(...awaiting.map((r) => daysBetween(String(r.asked), ctx.today))) : null,
      href: "/helpdesk", hint: t.length - awaiting.length > 0 ? `${t.length - awaiting.length} more open with support` : undefined,
    });
  }
  if (docs.status === "fulfilled") {
    const have = new Set(docs.value.map((r) => String(r.c)));
    const missing = CORE_DOCS.filter((c) => !have.has(c));
    actions.push({
      id: "docs_missing", label: "Core documents missing from my profile", count: missing.length, group: "Documents",
      severity: missing.length ? "high" : "info", href: "/profile",
      hint: missing.length ? `Missing: ${missing.map((m) => m.replace("_", " ")).join(", ")}` : "ID, address proof and bank proof are on file",
    });
  }
  if (learning.status === "fulfilled") {
    const l = learning.value;
    const todo = l.filter((r) => r.status === "not_started" || r.status === "in_progress");
    const overdue = todo.filter((r) => r.due && String(r.due) < ctx.today).length;
    if (l.length > 0) {
      actions.push({
        id: "courses_todo", label: "Courses to complete", count: todo.length, group: "Learning",
        severity: overdue > 0 ? "critical" : todo.length ? "normal" : "info", overdue, href: "/lms/my-learning",
        hint: `${l.length - todo.length} of ${l.length} done${overdue === 0 && todo.length ? " · no due dates set" : ""}`,
      });
      const avg = Math.round(l.reduce((s, r) => s + Number(r.completion_pct ?? 0), 0) / l.length);
      kpis.push({ key: "learn_progress", label: "Learning progress", value: avg, unit: "percent", tone: toneFor(avg, 80, 40),
        helper: `${l.length - todo.length} of ${plural(l.length, "course")} completed`, href: "/lms/my-learning", formula: "Average completion % across my assigned courses" });
    }
  }
  if (goals.status === "fulfilled" && goals.value.length) {
    const g = goals.value;
    const withTarget = g.filter((r) => Number(r.target_value) > 0);
    const pct = withTarget.length ? Math.round(avgOf(withTarget.map((r) => Math.min(100, (Number(r.actual_value ?? 0) / Number(r.target_value)) * 100)))) : null;
    kpis.push({ key: "goals", label: "Goals progress", value: pct, unit: "percent", tone: toneFor(pct, 80, 40), helper: `${plural(g.length, "active goal")}`, href: "/performance",
      formula: "Average of actual / target across my active goals (capped at 100% each)", unavailable: pct === null ? "Goals have no numeric targets" : null });
  }
  if (surveys.status === "fulfilled") {
    actions.push({ id: "survey_open", label: "Surveys waiting for my response", count: surveys.value.length, group: "Engagement", severity: surveys.value.length ? "normal" : "info", href: "/engagement" });
  }
  return { actions, kpis, signals };
}

function avgOf(v: number[]): number {
  return v.reduce((a, b) => a + b, 0) / v.length;
}

// ───────────────────────── team moments ─────────────────────────

async function team(emp: SelfEmp, ctx: InsightContext): Promise<InsightSection> {
  if (!emp.reporting_manager_id) return { tables: [{ key: "team_moments", title: "Team moments", columns: [], rows: [], unavailable: "No reporting manager is set, so there is no team to show." }] };
  const mates = await rows(
    `SELECT COALESCE(full_name, first_name) AS name, DATE_FORMAT(date_of_birth, '%m-%d') AS dob, DATE_FORMAT(date_of_joining, '%m-%d') AS doj, YEAR(date_of_joining) AS jy
       FROM employees WHERE reporting_manager_id = ? AND active_status = 1 AND id <> ? LIMIT 80`,
    [emp.reporting_manager_id, emp.id],
  );
  const year = Number(ctx.today.slice(0, 4));
  const moments: Array<{ who: string; what: string; days: number; on: string }> = [];
  for (const m of mates) {
    const name = String(m.name ?? "Teammate").split(" ")[0];
    if (m.dob) {
      const d = daysUntilAnnual(String(m.dob), ctx.today);
      if (d <= 14) moments.push({ who: name, what: "Birthday", days: d, on: addDays(ctx.today, d) });
    }
    if (m.doj && m.jy && Number(m.jy) < year) {
      const d = daysUntilAnnual(String(m.doj), ctx.today);
      const on = addDays(ctx.today, d);
      if (d <= 14) moments.push({ who: name, what: `${Number(on.slice(0, 4)) - Number(m.jy)}-year work anniversary`, days: d, on });
    }
  }
  moments.sort((a, b) => a.days - b.days);
  return {
    tables: [{
      key: "team_moments", title: "Team moments — next 14 days",
      columns: [{ key: "who", label: "Who" }, { key: "what", label: "Occasion" }, { key: "when", label: "When", align: "right" }],
      rows: moments.slice(0, 6).map((m) => ({ who: m.who, what: m.what, when: m.days === 0 ? "Today" : m.days === 1 ? "Tomorrow" : dayLabel(m.on) })),
    }],
  };
}

const provider: InsightProvider = {
  sections: {
    today: withSelf(today),
    attendance: withSelf(attendance),
    rules: withSelf(rules),
    leave: withSelf(leave),
    requests: withSelf(requests),
    payslips: withSelf(payslips),
    kpi: withSelf(kpi),
    workItems: withSelf(workItems),
    team: withSelf(team),
  },
};

export default provider;
