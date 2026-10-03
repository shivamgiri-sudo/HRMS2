import type { InsightAction, InsightContext, InsightKpi, InsightProvider, InsightSection, InsightSeries, InsightSignal } from "../types.js";
import { empScope, num, pct, rows, severityFor, toneFor } from "../helpers.js";
import { EXPECTED_TO_WORK_EXCLUSIONS, PRESENT_STATUSES, statusList } from "../../../../shared/attendanceStatus.js";
import {
  ageDays, attendancePct, compositeHealth, completeDays, earlyExitShare, expectedPayrollMonth, filingStatus,
  hiringGap, rollingAttrition, scaleScore, shrinkagePct, type HealthPart,
} from "./ceoCalc.js";
import { NOT_EXITING, SLA_DAYS, TERMINAL_EXIT, attendanceDays, attendanceScope, drill, exitScan, flowFrom, mandateRows } from "./ceoData.js";

/**
 * CEO_DASHBOARD insights. Every section is independent (one slow or failing query never blanks the
 * page). Sources verified against the live schema; sources that hold no rows are reported as
 * unavailable rather than rendered as a confident zero:
 *   - revenue: the bill_revenue_* snapshots stop at 2020-06 and process_revenue_daily is empty, so
 *     revenue / margin come from the P&L engine on the page (/api/finance/pnl/summary), not from here;
 *   - grievance, task_escalation_log, attendance_mismatch_escalation, ats_offer hold 0 rows -> omitted;
 *   - what truly routes to the CEO role: payment-voucher approval (VOUCHER_CEO_ROLES) and the payroll
 *     run acknowledgement above ceo_ack_threshold. Requisition approval is super_admin/branch_head,
 *     salary proposals are bm/operations/payroll/finance, budget top-ups are branch_head/finance_head.
 */

// ─── sections ───────────────────────────────────────────────────────────────────────────────────

async function approvals(ctx: InsightContext): Promise<InsightSection> {
  const [voucher, runs, flag, exits] = await Promise.all([
    rows(
      `SELECT COUNT(*) AS c, MIN(raised_at) AS oldest, COALESCE(SUM(amount), 0) AS amt,
              SUM(raised_at < DATE_SUB(NOW(), INTERVAL ${SLA_DAYS} DAY)) AS overdue
         FROM payment_voucher WHERE status = 'raised'`,
    ).catch(() => null),
    rows(
      `SELECT run_month AS m, status, total_net AS net, created_at FROM salary_prep_run
        WHERE ceo_acknowledged_at IS NULL AND LOWER(status) NOT IN ('draft','finalized','paid','disbursed','rejected','cancelled','closed')
        ORDER BY run_month`,
    ).catch(() => null),
    rows(`SELECT config_value AS v FROM payroll_config_flags WHERE config_key = 'ceo_ack_threshold' LIMIT 1`).catch(() => []),
    exitQueue(ctx).catch(() => null),
  ]);
  const actions: InsightAction[] = [];

  const v = voucher?.[0];
  actions.push({
    id: "ceo-payment-vouchers", group: "Needs your decision",
    label: "Payment vouchers awaiting CEO approval",
    count: v ? num(v.c) ?? 0 : null, oldestDays: v?.oldest ? ageDays(v.oldest as string, ctx.today) : null, overdue: v ? num(v.overdue) ?? 0 : null,
    severity: severityFor(v ? num(v.c) : null, 1, 5),
    href: "/finance/ledger?tab=payments",
    hint: v && (num(v.c) ?? 0) > 0 ? "Raised by Finance — you approve, Finance releases" : undefined,
    unavailable: v ? null : "Payment voucher register unavailable",
  });

  const thrRaw = Number(flag[0]?.v);
  const threshold = Number.isFinite(thrRaw) && thrRaw > 0 ? thrRaw : 5_000_000;
  const due = (runs ?? []).filter((r) => Number(r.net) > threshold);
  actions.push({
    id: "ceo-payroll-ack", group: "Needs your decision",
    label: "Payroll runs awaiting CEO acknowledgement",
    count: runs ? due.length : null,
    oldestDays: due.length ? Math.max(...due.map((r) => ageDays(r.created_at as string, ctx.today) ?? 0)) : null,
    overdue: due.filter((r) => (ageDays(r.created_at as string, ctx.today) ?? 0) > 10).length,
    severity: due.length ? (due.some((r) => (ageDays(r.created_at as string, ctx.today) ?? 0) > 10) ? "critical" : "high") : "info",
    href: "/payroll/sign-off",
    hint: due.length ? `${due.map((r) => String(r.m)).join(", ")} — above the CEO-acknowledgement threshold` : undefined,
    unavailable: runs ? null : "Payroll run register unavailable",
  });

  if (exits) actions.push(exits);
  // Output must not depend on the caller's role: cachedRoleInsights keys on scope only, so a CEO and a COO (both ORG_ALL)
  // share one cached result. The queues are the CEO's by definition; the page labels them so.
  return { actions };
}

/** Resignations / exits still moving through the approval chain (oversight — the manager and HR act). */
async function exitQueue(ctx: InsightContext): Promise<InsightAction> {
  const sc = empScope(ctx, "e");
  const r = await rows(
    `SELECT COUNT(*) AS c, MIN(er.submitted_at) AS oldest, SUM(er.submitted_at < DATE_SUB(NOW(), INTERVAL 7 DAY)) AS stale
       FROM exit_request er LEFT JOIN employees e ON e.id = er.employee_id
      WHERE LOWER(er.status) NOT IN ${TERMINAL_EXIT}${sc.sql}`,
    sc.params,
  );
  const c = num(r[0]?.c) ?? 0;
  return {
    id: "exit-chain", group: "Oversight", label: "Exits in the approval chain", count: c,
    oldestDays: r[0]?.oldest ? ageDays(r[0].oldest as string, ctx.today) : null, overdue: num(r[0]?.stale) ?? 0,
    severity: (num(r[0]?.stale) ?? 0) >= 3 ? "critical" : (num(r[0]?.stale) ?? 0) > 0 ? "high" : c > 0 ? "normal" : "info",
    href: "/exit/command-center", hint: "Overdue = open more than 7 days",
  };
}

async function attendanceSection(ctx: InsightContext): Promise<InsightSection> {
  const days = completeDays(await attendanceDays(ctx), ctx.today).slice(-30);
  if (!days.length) {
    const why = "No complete processed-attendance day in the last 30 days";
    return {
      kpis: [
        { key: "attendance_latest", label: "Attendance rate", value: null, unit: "percent", unavailable: why },
        { key: "shrinkage_latest", label: "Shrinkage", value: null, unit: "percent", unavailable: why },
      ],
    };
  }
  const last = days[days.length - 1]!;
  const prev = days.slice(-8, -1);
  const rate = days.map((d) => attendancePct(d));
  const shr = days.map((d) => shrinkagePct(d));
  const prevAvg = prev.length ? prev.reduce((s, d) => s + (attendancePct(d) ?? 0), 0) / prev.length : null;
  const prevShrAvg = prev.length ? prev.reduce((s, d) => s + (shrinkagePct(d) ?? 0), 0) / prev.length : null;
  const att = attendancePct(last);
  const sh = shrinkagePct(last);
  const label = `day ${last.date}`;
  const kpis: InsightKpi[] = [
    {
      key: "attendance_latest", label: "Attendance rate", value: att, unit: "percent", tone: toneFor(att, 90, 80),
      delta: att !== null && prevAvg !== null ? Math.round((att - prevAvg) * 10) / 10 : null, deltaLabel: `${label} vs prior 7-day avg`,
      spark: rate.filter((x): x is number => x !== null), href: drill("ATTENDANCE"),
      formula: "(present + week-off-worked + 0.5 x half-day) / (rows not holiday, week-off or approved leave) on the latest complete processed day",
    },
    {
      key: "shrinkage_latest", label: "Shrinkage", value: sh, unit: "percent", tone: toneFor(sh, 12, 20, false), higherIsBetter: false,
      delta: sh !== null && prevShrAvg !== null ? Math.round((sh - prevShrAvg) * 10) / 10 : null, deltaLabel: `${label} vs prior 7-day avg`,
      spark: shr.filter((x): x is number => x !== null), href: drill("ATTENDANCE"),
      formula: "(absent + unreconciled + 0.5 x half-day) / expected-to-work on the latest complete processed day — one day, not a 30-day average",
    },
  ];
  const signals: InsightSignal[] = [];
  if (att !== null) {
    signals.push(att >= 90
      ? { tone: "good", title: "Attendance healthy", detail: `${att}% on ${last.date}`, value: `${att}%`, href: drill("ATTENDANCE") }
      : { tone: att < 80 ? "bad" : "watch", title: att < 80 ? "Attendance is low" : "Attendance below 90%", detail: `${att}% on ${last.date} (${last.absent} absent/unreconciled of ${last.expected} expected)`, value: `${att}%`, href: drill("ATTENDANCE") });
  }
  if (sh !== null && sh > 12) signals.push({ tone: sh > 20 ? "bad" : "watch", title: "Shrinkage elevated", detail: `${sh}% of expected capacity was absent on ${last.date}`, value: `${sh}%`, href: drill("ATTENDANCE") });
  return {
    kpis, signals,
    series: [{
      key: "attendance_30d", title: "Attendance & shrinkage — last 30 processed days", subtitle: `Complete days only; latest ${last.date}`, kind: "line", unit: "percent",
      keys: [{ key: "attendance", label: "Attendance %", tone: "green" }, { key: "shrinkage", label: "Shrinkage %", tone: "red" }],
      points: days.map((d) => ({ label: d.date.slice(5), attendance: attendancePct(d), shrinkage: shrinkagePct(d) })),
    }],
  };
}

async function peopleFlow(ctx: InsightContext): Promise<InsightSection> {
  const scan = await exitScan(ctx);
  const flow = flowFrom(scan);
  const completed = flow.slice(0, 12);
  const roll = rollingAttrition(completed);
  const lastFull = completed[completed.length - 1]!;
  const prevFull = completed[completed.length - 2];
  const early = earlyExitShare(completed, 3);
  const current = flow[flow.length - 1]!;
  const exits30 = scan.exits.reduce((s, r) => s + r.x30, 0);
  const net30 = scan.joins30 - exits30;
  const unavailable = scan.headcountNow > 0 ? null : "No active headcount in scope";

  const kpis: InsightKpi[] = [
    {
      key: "attrition_12m", label: "Attrition — rolling 12 months", value: roll.pct, unit: "percent", tone: toneFor(roll.pct, 40, 80, false), higherIsBetter: false,
      spark: completed.map((p) => p.attritionPct ?? 0), helper: `${roll.exits.toLocaleString("en-IN")} exits ÷ ~${roll.avgHeadcount?.toLocaleString("en-IN") ?? "—"} avg headcount`,
      formula: "Exits over the 12 completed months ÷ mean of month-end headcounts × 100. Exit date = employees.date_of_exit; headcount rebuilt backwards from today.",
      href: drill("RESIGNATION"), unavailable,
    },
    {
      key: "attrition_month", label: `Attrition — ${lastFull.month}`, value: lastFull.attritionPct, unit: "percent", tone: toneFor(lastFull.attritionPct, 8, 15, false), higherIsBetter: false,
      delta: lastFull.attritionPct !== null && prevFull?.attritionPct != null ? Math.round((lastFull.attritionPct - prevFull.attritionPct) * 10) / 10 : null,
      deltaLabel: `vs ${prevFull?.month ?? "prior month"}`, spark: completed.map((p) => p.attritionPct ?? 0),
      formula: "Exits in the month ÷ average of start and end headcount × 100 (last full month; the current month is partial)",
      href: drill("RESIGNATION"), unavailable,
    },
    {
      key: "early_exits", label: "Exits within 90 days of joining", value: early, unit: "percent", tone: toneFor(early, 30, 50, false), higherIsBetter: false,
      helper: "share of the last 3 months' exits", formula: "Exits with tenure ≤ 90 days ÷ all exits, last 3 completed months", href: drill("RESIGNATION"),
      unavailable: early === null ? "No exits recorded in the window" : null,
    },
    {
      key: "net_flow_30d", label: "Net headcount flow (30d)", value: net30, unit: "count", tone: net30 >= 0 ? "green" : "red",
      helper: `${scan.joins30.toLocaleString("en-IN")} joined − ${exits30.toLocaleString("en-IN")} left`, formula: "Joiners (date_of_joining) minus leavers (date_of_exit) in the last 30 days", href: drill("HEADCOUNT"),
    },
  ];

  const signals: InsightSignal[] = [];
  if (lastFull.attritionPct !== null) {
    const a = lastFull.attritionPct;
    signals.push({
      tone: a >= 15 ? "bad" : a >= 8 ? "watch" : "good", title: a >= 15 ? "Attrition is very high" : a >= 8 ? "Attrition above comfort" : "Attrition contained",
      detail: `${a}% of headcount left in ${lastFull.month} (${lastFull.exits} exits)`, value: `${a}%`, href: drill("RESIGNATION"),
    });
  }
  if (early !== null && early >= 50) {
    signals.push({ tone: "bad", title: "Most exits are early-tenure", detail: `${early}% of recent exits left within 90 days of joining — a hiring-quality / onboarding problem, not a retention one`, value: `${early}%`, href: drill("RESIGNATION") });
  }
  if (net30 < 0) signals.push({ tone: "watch", title: "Headcount is shrinking", detail: `${exits30} left vs ${scan.joins30} joined in the last 30 days`, value: net30, href: drill("HEADCOUNT") });

  return {
    kpis, signals,
    series: [
      {
        key: "flow_12m", title: "Joiners vs leavers — 13 months", subtitle: `Current month (${current.month}) is partial`, kind: "bar", unit: "count",
        keys: [{ key: "joins", label: "Joined", tone: "green" }, { key: "exits", label: "Left", tone: "red" }],
        points: flow.map((p) => ({ label: p.month.slice(2), joins: p.joins, exits: p.exits })),
      },
      {
        key: "attrition_trend", title: "Monthly attrition %", subtitle: "Exits ÷ average headcount", kind: "line", unit: "percent",
        keys: [{ key: "attrition", label: "Attrition %", tone: "red" }],
        points: completed.map((p) => ({ label: p.month.slice(2), attrition: p.attritionPct })),
      },
    ],
  };
}

async function hiring(ctx: InsightContext): Promise<InsightSection> {
  const m = await mandateRows(ctx);
  if (!m.length) {
    return { kpis: [{ key: "hiring_gap", label: "Hiring gap vs mandate", value: null, unit: "count", unavailable: "No active workforce mandate in scope — nobody has recorded the billing mandate" }] };
  }
  const g = hiringGap(m);
  const worst = [...m].map((r) => ({ ...r, gap: r.seatTarget - r.active })).filter((r) => r.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 8);
  const over = m.filter((r) => r.active > r.seatTarget).length;
  return {
    kpis: [{
      key: "hiring_gap", label: "Hiring gap vs mandate", value: g.shortToTarget, unit: "count", tone: g.shortToTarget === 0 ? "green" : g.shortToTarget > g.seatTarget * 0.1 ? "red" : "amber", higherIsBetter: false,
      helper: `${g.active.toLocaleString("en-IN")} on roll vs ${g.seatTarget.toLocaleString("en-IN")} seat target (mandate ${g.mandate.toLocaleString("en-IN")}); ${g.shortToRequired.toLocaleString("en-IN")} short once shrinkage is covered`,
      formula: "Σ per process of max(0, mandate + buffer% − active) — the same rule as the Hiring Shortage metric and its drilldown. active = active employees mapped to that branch + process. Shrinkage-adjusted need is shown in the table.",
      href: drill("HIRING_ALERT"),
    }, {
      key: "mandate_fill", label: "Mandate fill", value: g.fillPct, unit: "percent", tone: toneFor(g.fillPct, 98, 90),
      helper: `${g.understaffed} of ${m.length} processes short · ${over} over`, formula: "Σ min(active, seat target) ÷ Σ seat target — a surplus in one process cannot mask a shortage in another", href: drill("HIRING_ALERT"),
    }],
    tables: [{
      key: "understaffed", title: "Processes short of their billing mandate",
      columns: [
        { key: "process", label: "Process" }, { key: "branch", label: "Branch" },
        { key: "mandate", label: "Mandate", align: "right" }, { key: "seatTarget", label: "Seat target", align: "right" }, { key: "required", label: "Incl. shrinkage", align: "right" },
        { key: "active", label: "On roll", align: "right" }, { key: "gap", label: "Short by", align: "right" },
      ],
      rows: worst.map((r) => ({ process: r.process, branch: r.branch, mandate: r.mandate, seatTarget: r.seatTarget, required: r.required, active: r.active, gap: r.gap })),
    }],
    signals: g.shortToTarget > 0
      ? [{ tone: g.shortToTarget > g.seatTarget * 0.1 ? "bad" : "watch", title: "Mandated seats at risk", detail: `${g.shortToTarget} hires short of the seat target across ${g.understaffed} processes (${g.shortToRequired} once shrinkage is covered)`, value: g.shortToTarget, href: drill("HIRING_ALERT") }]
      : [{ tone: "good", title: "Every mandate is staffed", detail: `${g.active.toLocaleString("en-IN")} on roll against a ${g.seatTarget.toLocaleString("en-IN")} seat target`, href: drill("HIRING_ALERT") }],
  };
}

async function branchLeague(ctx: InsightContext): Promise<InsightSection> {
  const [scan, days] = await Promise.all([exitScan(ctx), attendanceDays(ctx)]);
  const complete = completeDays(days, ctx.today);
  const latest = complete[complete.length - 1]?.date ?? null;
  const sc = attendanceScope(ctx);
  const att = latest
    ? await rows(
        `SELECT ${sc.branchCol} AS branchId,
                SUM(adr.attendance_status IN (${statusList(PRESENT_STATUSES)})) AS present, SUM(adr.attendance_status = 'half_day') AS half_day,
                COUNT(CASE WHEN adr.attendance_status NOT IN (${statusList(EXPECTED_TO_WORK_EXCLUSIONS)}) THEN 1 END) AS expected
           FROM attendance_daily_record adr ${sc.join}
          WHERE adr.record_date = ?${sc.where} GROUP BY ${sc.branchCol}`,
        [latest, ...sc.params],
      )
    : [];
  const attBy = new Map(att.map((r) => [String(r.branchId), attendancePct({ present: num(r.present) ?? 0, halfDay: num(r.half_day) ?? 0, expected: num(r.expected) ?? 0 })]));
  const x90By = new Map<string, number>();
  for (const r of scan.exits) x90By.set(String(r.branchId), (x90By.get(String(r.branchId)) ?? 0) + r.x90);

  const table = scan.branches.filter((b) => b.headcount > 0).sort((a, b) => b.headcount - a.headcount).map((b) => {
    const key = String(b.branchId);
    const exits90 = x90By.get(key) ?? 0;
    return {
      branchId: b.branchId, branch: b.name, headcount: b.headcount, attendance: attBy.get(key) ?? null,
      exits90, exitRate90: pct(exits90, b.headcount + exits90 / 2),
      href: b.branchId ? drill("HEADCOUNT", { branchId: b.branchId }) : drill("HEADCOUNT"),
    };
  });
  return {
    tables: [{
      key: "branch_league", title: "Branch league table",
      columns: [
        { key: "branch", label: "Branch" }, { key: "headcount", label: "Headcount", align: "right" },
        { key: "attendance", label: latest ? `Attendance ${latest.slice(5)}` : "Attendance", unit: "percent", align: "right" },
        { key: "exits90", label: "Exits 90d", align: "right" }, { key: "exitRate90", label: "Exit rate 90d", unit: "percent", align: "right" },
      ],
      rows: table,
      unavailable: table.length ? null : "No active headcount in scope",
    }],
  };
}

async function exitsBreakdown(ctx: InsightContext): Promise<InsightSection> {
  const sc = empScope(ctx, "e");
  const [stages, types, lwd] = await Promise.all([
    rows(
      `SELECT LOWER(er.status) AS s, COUNT(*) AS c FROM exit_request er LEFT JOIN employees e ON e.id = er.employee_id
        WHERE LOWER(er.status) NOT IN ${TERMINAL_EXIT}${sc.sql} GROUP BY s ORDER BY c DESC`,
      sc.params,
    ),
    rows(
      `SELECT er.exit_type AS t, COUNT(*) AS c FROM exit_request er LEFT JOIN employees e ON e.id = er.employee_id
        WHERE er.submitted_at >= DATE_SUB(?, INTERVAL 30 DAY) AND LOWER(er.status) NOT IN ${NOT_EXITING}${sc.sql} GROUP BY t`,
      [ctx.today, ...sc.params],
    ),
    rows(
      `SELECT COUNT(*) AS c FROM exit_request er LEFT JOIN employees e ON e.id = er.employee_id
        WHERE er.last_working_day_confirmed BETWEEN ? AND DATE_ADD(?, INTERVAL 14 DAY) AND LOWER(er.status) NOT IN ${TERMINAL_EXIT}${sc.sql}`,
      [ctx.today, ctx.today, ...sc.params],
    ),
  ]);
  const series: InsightSeries[] = [];
  if (stages.length) {
    series.push({
      key: "exit_stages", title: "Exits in notice — by stage", subtitle: "Open requests in the exit register", kind: "ranked", unit: "count", href: "/exit/command-center",
      points: stages.map((r) => ({ label: String(r.s).replace(/_/g, " "), value: num(r.c) ?? 0 })),
    });
  }
  if (types.length) {
    series.push({
      key: "exit_types", title: "Exit type — last 30 days", subtitle: "Voluntary vs involuntary (exit register)", kind: "donut", unit: "count",
      points: types.map((r) => ({ label: String(r.t ?? "unspecified"), value: num(r.c) ?? 0 })),
    });
  }
  const lw = num(lwd[0]?.c) ?? 0;
  return {
    series,
    kpis: [{ key: "lwd_14d", label: "Last working days in 14 days", value: lw, unit: "count", tone: lw > 10 ? "amber" : "slate", href: "/exit/command-center", helper: "open exits with a confirmed LWD", formula: "Open exit requests whose confirmed last working day falls in the next 14 days" }],
  };
}

/**
 * Payroll run STATUS only. Rupee totals (net payroll, cost) are deliberately NOT returned: repo rule
 * "never expose payroll/salary data through management surfaces or any non-payroll endpoint" — the CEO
 * sees the amounts on /payroll/sign-off, where the acknowledgement happens.
 */
async function payrollCycle(ctx: InsightContext): Promise<InsightSection> {
  const runs = await rows(
    `SELECT run_month AS m, status, DATE_FORMAT(created_at, '%Y-%m-%d') AS created
       FROM salary_prep_run WHERE run_kind = 'regular' AND scope_kind = 'company' ORDER BY run_month DESC LIMIT 7`,
  );
  if (!runs.length) return { kpis: [{ key: "payroll_runs_open", label: "Payroll runs not finalized", value: null, unit: "count", unavailable: "No payroll run has been created" }] };
  const latest = runs[0]!;
  const signals: InsightSignal[] = [];
  const expected = expectedPayrollMonth(ctx.today);
  const dom = Number(ctx.today.slice(8, 10));
  const missing = !runs.some((r) => String(r.m) === expected);
  if (missing) {
    signals.push({ tone: dom > 7 ? "bad" : "watch", title: `${expected} payroll run not started`, detail: `Latest run on record is ${latest.m} (${latest.status}). Salary for ${expected} cannot be paid until a run exists.`, href: "/payroll/sign-off" });
  }
  const open = runs.filter((r) => !/^(finalized|paid|disbursed|rejected|cancelled|closed)$/i.test(String(r.status)));
  const stale = open.filter((r) => (ageDays(`${r.created}T00:00:00Z`, ctx.today) ?? 0) > 10);
  for (const r of stale.slice(0, 2)) {
    signals.push({ tone: "bad", title: `${r.m} payroll still ${r.status}`, detail: `Created ${ageDays(`${r.created}T00:00:00Z`, ctx.today)} days ago and not finalized`, value: `${ageDays(`${r.created}T00:00:00Z`, ctx.today)}d`, href: "/payroll/sign-off" });
  }
  return {
    signals,
    kpis: [{
      key: "payroll_runs_open", label: "Payroll runs not finalized", value: open.length, unit: "count", tone: stale.length || missing ? "red" : open.length ? "amber" : "green", higherIsBetter: false,
      helper: `latest ${latest.m} · ${latest.status}${missing ? ` · ${expected} not started` : ""}`,
      formula: "salary_prep_run (regular, company) rows in the last 7 months whose status is not finalized / paid / disbursed / rejected / cancelled / closed",
      href: "/payroll/sign-off",
    }],
  };
}

async function compliance(ctx: InsightContext): Promise<InsightSection> {
  const r = await rows(
    `SELECT filing_type AS t, filing_month AS fm, DATE_FORMAT(due_date, '%Y-%m-%d') AS due, status
       FROM statutory_filing_record WHERE LOWER(status) NOT IN ('filed','paid','completed') ORDER BY due_date LIMIT 12`,
  );
  const items = r.map((x) => ({ type: String(x.t), month: String(x.fm), due: x.due as string | null, state: filingStatus({ status: String(x.status), dueDate: (x.due as string | null) ?? null }, ctx.today) }));
  const overdue = items.filter((i) => i.state === "overdue").length;
  const soon = items.filter((i) => i.state === "due_soon").length;
  const signals: InsightSignal[] = [];
  if (overdue) signals.push({ tone: "bad", title: "Statutory filings past due", detail: `${overdue} filing${overdue === 1 ? "" : "s"} unfiled after the due date: ${items.filter((i) => i.state === "overdue").map((i) => `${i.type} ${i.month}`).join(", ")}`, value: overdue });
  if (soon) signals.push({ tone: "watch", title: "Statutory filings due within 7 days", detail: items.filter((i) => i.state === "due_soon").map((i) => `${i.type} ${i.month} (${i.due})`).join(", "), value: soon });
  return {
    signals,
    kpis: [{ key: "filings_overdue", label: "Statutory filings overdue", value: overdue, unit: "count", tone: overdue ? "red" : "green", higherIsBetter: false, helper: `${soon} due in 7 days`, formula: "statutory_filing_record rows not filed whose due date is before today" }],
    tables: [{
      key: "statutory_calendar", title: "Statutory filing calendar",
      columns: [{ key: "type", label: "Filing" }, { key: "month", label: "For month" }, { key: "due", label: "Due" }, { key: "state", label: "State" }],
      rows: items.map((i) => ({ type: i.type, month: i.month, due: i.due, state: i.state.replace("_", " ") })),
    }],
  };
}

/** Composite health from the sources this provider can measure; quality and revenue live on the page. */
async function health(ctx: InsightContext): Promise<InsightSection> {
  const [days, scan, mand] = await Promise.all([attendanceDays(ctx), exitScan(ctx), mandateRows(ctx)]);
  const complete = completeDays(days, ctx.today);
  const last = complete[complete.length - 1];
  const wk = complete.slice(-7);
  const attendance7 = wk.length ? wk.reduce((s, d) => s + (attendancePct(d) ?? 0), 0) / wk.length : null;
  const flow = flowFrom(scan).slice(0, 12);
  const monthly = flow[flow.length - 1]?.attritionPct ?? null;
  const g = mand.length ? hiringGap(mand) : null;
  const parts: HealthPart[] = [
    // 7-day mean, not the latest day: one bad day should move the ring, not slam it.
    { key: "attendance", label: "Attendance (7d)", score: last ? scaleScore(attendance7, 70, 95) : null, weight: 30 },
    { key: "mandate", label: "Mandate fill", score: g ? scaleScore(g.fillPct, 70, 100) : null, weight: 30 },
    { key: "attrition", label: "Attrition", score: scaleScore(monthly, 25, 5), weight: 40 },
  ];
  const h = compositeHealth(parts);
  return { healthScore: h.score, healthBasis: h.basis };
}

const provider: InsightProvider = {
  sections: {
    approvals,
    attendance: attendanceSection,
    people_flow: peopleFlow,
    hiring,
    branch_league: branchLeague,
    exits_breakdown: exitsBreakdown,
    payroll_cycle: payrollCycle,
    compliance,
    health,
  },
};

export default provider;
