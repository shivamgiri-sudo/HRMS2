import type { RowDataPacket } from "mysql2";
import { buildScopeWhere } from "../../../../shared/dashboardScope.js";
import type { InsightAction, InsightContext, InsightProvider, InsightSection, InsightSignal } from "../types.js";
import { empScope, num, one, rows, severityFor } from "../helpers.js";
import { daysBetween, effectiveFilingStatus, payrollCost } from "./payrollRun.js";

/**
 * PAYROLL_HR_DASHBOARD insights: the queues the payroll owner can act on, the cost / headcount / LOP trend across runs,
 * the statutory and cycle calendars, and computed signals. Run-specific analytics (selected run) live in the
 * operational-summary payload (payrollRun.ts); everything here is independent of which run is selected.
 *
 * Aging: no queue below has a stored SLA, so "overdue" is a stated age threshold (AGING_DAYS) rather than an invented deadline.
 * Run-level queues (sign-off, validation) have no branch dimension and are shown to org-wide callers only.
 */
const AGING_DAYS = 7;
const FNF_AGING_DAYS = 30;

const isOrg = (ctx: InsightContext) => ctx.scope.level === "ORG_ALL";
const ORG_ONLY = "Run-level queue - visible to org-wide payroll roles only";

/** The month payroll is being processed for today: the previous calendar month. */
export function cycleMonth(today: string): string {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

function action(
  id: string, label: string, href: string, r: RowDataPacket | null,
  opts: { high?: number; critical?: number; hint?: string; group?: string; overdueKey?: string } = {},
): InsightAction {
  const count = r ? num(r.n) ?? 0 : null;
  return {
    id, label, href, count, oldestDays: r && count ? num(r.oldest) : null,
    overdue: r && count ? num(r[opts.overdueKey ?? "overdue"]) ?? 0 : null,
    severity: severityFor(count, opts.high ?? 1, opts.critical ?? 10), hint: opts.hint, group: opts.group,
  };
}

const unavailable = (id: string, label: string, href: string, why: string): InsightAction =>
  ({ id, label, href, count: null, severity: "info", unavailable: why });

const wrap = (fn: (ctx: InsightContext) => Promise<InsightAction[]>) =>
  async (ctx: InsightContext): Promise<InsightSection> => ({ actions: await fn(ctx) });

export interface SignalInput {
  today: string;
  cycle: string;
  cycleRunExists: boolean;
  latest: { month: string; status: string; net: number; zeroNet: number; employees: number; ptLines: number; ptAmount: number } | null;
  previousNet: number | null;
  payDate: string | null;
  filingsOverdue: number;
  filingsDueSoon: number;
  bankExceptions: number | null;
  unfrozenUnits: number | null;
}

/** Thresholds -> good/bad/watch. Pure so the rules are testable and none of the text is hard-coded status. */
export function buildSignals(i: SignalInput): InsightSignal[] {
  const out: InsightSignal[] = [];
  if (!i.cycleRunExists) {
    out.push({ tone: "bad", title: `No payroll run exists for ${i.cycle}`, detail: "The cycle month has no run; attendance, deductions and incentives cannot be paid until one is created.", href: "/payroll" });
  }
  if (i.latest) {
    const closed = ["finalized", "locked", "disbursed"].includes(i.latest.status.toLowerCase());
    if (i.payDate && i.payDate < i.today && !closed) {
      out.push({ tone: "bad", title: `${i.latest.month} pay date passed ${daysBetween(i.payDate, i.today)}d ago`, detail: `Run is still '${i.latest.status}'. Pay date per payroll calendar was ${i.payDate}.`, value: `${daysBetween(i.payDate, i.today)}d`, href: "/payroll/run-lifecycle" });
    }
    if (i.latest.employees > 0) {
      const share = (i.latest.zeroNet / i.latest.employees) * 100;
      if (share >= 5) out.push({ tone: "bad", title: "High share of zero-net lines", detail: `${i.latest.zeroNet} of ${i.latest.employees} lines in ${i.latest.month} net to zero - usually missing attendance or unpaid leave.`, value: `${share.toFixed(1)}%`, href: "/payroll/attendance-control-tower" });
      else if (share > 0) out.push({ tone: "watch", title: "Zero-net lines in the latest run", detail: `${i.latest.zeroNet} of ${i.latest.employees} lines net to zero.`, value: `${share.toFixed(1)}%`, href: "/payroll/attendance-control-tower" });
    }
    if (i.previousNet && i.previousNet > 0) {
      const pctChange = ((i.latest.net - i.previousNet) / i.previousNet) * 100;
      if (Math.abs(pctChange) >= 10) out.push({ tone: "watch", title: `Net pay moved ${pctChange > 0 ? "up" : "down"} sharply`, detail: `${i.latest.month} net is ${Math.abs(pctChange).toFixed(1)}% ${pctChange > 0 ? "above" : "below"} the previous run.`, value: `${pctChange > 0 ? "+" : ""}${pctChange.toFixed(1)}%`, href: "/payroll/variance-analysis" });
      else out.push({ tone: "good", title: "Net pay is stable vs previous run", detail: `Within 10% of the previous run (${pctChange > 0 ? "+" : ""}${pctChange.toFixed(1)}%).`, href: "/payroll/variance-analysis" });
    }
    if (i.latest.ptLines > 0) {
      out.push({ tone: "watch", title: "Professional tax still present on payroll lines", detail: `${i.latest.ptLines} lines in ${i.latest.month} carry PT (Rs ${Math.round(i.latest.ptAmount).toLocaleString("en-IN")}) although PT is retired company-wide.`, value: i.latest.ptLines, href: "/payroll/masters" });
    }
  }
  if (i.filingsOverdue > 0) out.push({ tone: "bad", title: "Statutory filings overdue", detail: `${i.filingsOverdue} filing(s) are past their due date and not marked filed.`, value: i.filingsOverdue, href: "/payroll/statutory?tab=filing" });
  else if (i.filingsDueSoon > 0) out.push({ tone: "watch", title: "Statutory filings due within 7 days", detail: `${i.filingsDueSoon} filing(s) fall due this week.`, value: i.filingsDueSoon, href: "/payroll/statutory?tab=filing" });
  else out.push({ tone: "good", title: "No statutory filing overdue", detail: "Every filing is filed or not yet due.", href: "/payroll/statutory?tab=filing" });
  if (i.bankExceptions !== null && i.bankExceptions > 0) out.push({ tone: "watch", title: "Open bank exceptions", detail: `${i.bankExceptions} employees have an unresolved bank-account exception that can fail a NEFT file.`, value: i.bankExceptions, href: "/payroll/payment-center?tab=bank" });
  if (i.unfrozenUnits !== null && i.unfrozenUnits > 0) out.push({ tone: "watch", title: `Attendance not frozen for ${i.cycle}`, detail: `${i.unfrozenUnits} branch-process units have not frozen attendance for the cycle month.`, value: i.unfrozenUnits, href: "/payroll/readiness" });
  return out;
}

/** Per-run sums for the trend and signals. Joins employees only when a scope clamp needs it (the join is the slow part). */
async function runSums(runId: string, sc: { sql: string; params: string[] }): Promise<RowDataPacket[]> {
  return rows(
    `SELECT l.run_id, COUNT(*) AS emp, SUM(l.net_salary) AS net, SUM(l.total_deductions) AS ded, SUM(l.pf_employer + l.esic_employer) AS er,
            SUM(l.lwp_days) AS lop, SUM(l.net_salary <= 0) AS zero, SUM(l.professional_tax > 0) AS ptl, SUM(l.professional_tax) AS pt
       FROM salary_prep_line l ${sc.sql ? "JOIN employees e ON e.id = l.employee_id" : ""}
      WHERE l.run_id = ?${sc.sql} GROUP BY l.run_id`, [runId, ...sc.params]);
}

const provider: InsightProvider = {
  sections: {
    incentives: wrap(async (ctx) => {
      const s = buildScopeWhere(ctx.scope, "branch_id", "process_id");
      const r = await one(
        `SELECT COUNT(*) AS n, COALESCE(SUM(total_amount),0) AS amt, DATEDIFF(CURDATE(), MIN(created_at)) AS oldest,
                SUM(created_at < DATE_SUB(CURDATE(), INTERVAL ${AGING_DAYS} DAY)) AS overdue
           FROM incentive_upload_batch
          WHERE status IN ('pending','pending_approval','approval_chain_active','finance_approved') AND ${s.sql}`, s.params);
      return [action("incentives", "Incentive batches awaiting approval", "/payroll/incentives", r,
        { high: 1, critical: 5, group: "Inputs", hint: r && num(r.n) ? `Rs ${Math.round(num(r.amt) ?? 0).toLocaleString("en-IN")} held; overdue = older than ${AGING_DAYS}d` : undefined })];
    }),

    reimbursements: wrap(async (ctx) => {
      const sc = empScope(ctx);
      const r = await one(
        `SELECT COUNT(*) AS n, DATEDIFF(CURDATE(), MIN(c.submitted_at)) AS oldest,
                SUM(c.submitted_at < DATE_SUB(CURDATE(), INTERVAL ${AGING_DAYS} DAY)) AS overdue
           FROM employee_reimbursement_claim c JOIN employees e ON e.id = c.employee_id
          WHERE c.status IN ('submitted','manager_approved','branch_head_approved')${sc.sql}`, sc.params);
      return [action("reimbursements", "Reimbursement claims awaiting action", "/payroll/reimbursements", r, { high: 1, critical: 15, group: "Inputs", hint: `overdue = older than ${AGING_DAYS}d` })];
    }),

    fnf: wrap(async (ctx) => {
      const sc = empScope(ctx);
      const r = await one(
        `SELECT SUM(f.status IN ('draft','verified')) AS draftN, SUM(f.status = 'approved') AS approvedN, COUNT(*) AS n,
                DATEDIFF(CURDATE(), MIN(f.created_at)) AS oldest,
                SUM(f.created_at < DATE_SUB(CURDATE(), INTERVAL ${FNF_AGING_DAYS} DAY)) AS overdue,
                COALESCE(SUM(f.salary_hold), 0) AS held
           FROM full_final_calculation f JOIN employees e ON e.id = f.employee_id
          WHERE f.status IN ('draft','verified','approved')${sc.sql}`, sc.params);
      const base = action("fnf", "F&F settlements not yet paid", "/payroll/full-final", r,
        { high: 1, critical: 20, group: "Settlements", hint: r ? `${num(r.draftN) ?? 0} awaiting verification, ${num(r.approvedN) ?? 0} approved unpaid; overdue = older than ${FNF_AGING_DAYS}d` : undefined });
      return [base];
    }),

    disputes: wrap(async (ctx) => {
      const s = buildScopeWhere(ctx.scope, "branch_id", "process_id");
      const r = await one(
        `SELECT COUNT(*) AS n, DATEDIFF(CURDATE(), MIN(created_at)) AS oldest, SUM(sla_breached = 1) AS overdue
           FROM salary_dispute WHERE status IN ('pending_payroll_head','arrear_pending') AND ${s.sql}`, s.params);
      return [action("disputes", "Salary disputes with payroll (incl. arrears to pay)", "/payroll/salary-disputes?tab=queue", r, { high: 1, critical: 10, group: "Settlements", overdueKey: "overdue", hint: "overdue = SLA breached" })];
    }),

    salaryReview: wrap(async (ctx) => {
      const sc = empScope(ctx);
      const r = await one(
        `SELECT COUNT(*) AS n, DATEDIFF(CURDATE(), MIN(h.created_at)) AS oldest,
                SUM(h.created_at < DATE_SUB(CURDATE(), INTERVAL ${AGING_DAYS} DAY)) AS overdue
           FROM employee_payroll_head_review h JOIN employees e ON e.id = h.employee_id
          WHERE h.status = 'pending_review'${sc.sql}`, sc.params);
      return [action("salary-review", "New-joiner salary reviews pending", "/payroll/salary-review", r, { high: 1, critical: 20, group: "Inputs", hint: `overdue = older than ${AGING_DAYS}d` })];
    }),

    runQueues: wrap(async (ctx) => {
      if (!isOrg(ctx)) return [unavailable("signoff", "Runs awaiting sign-off", "/payroll/sign-off", ORG_ONLY), unavailable("validation", "Runs awaiting validation", "/payroll/validation", ORG_ONLY)];
      const r = await one(
        `SELECT SUM(finance_approved_at IS NULL) AS signoffN, SUM(validation_status = 'pending') AS validationN,
                DATEDIFF(CURDATE(), MIN(created_at)) AS oldest,
                SUM(window_close_date IS NOT NULL AND window_close_date < CURDATE()) AS overdue
           FROM salary_prep_run
          WHERE run_kind IN ('regular','supplementary','offcycle') AND status IN ('processing','under_review','calculated','approved')`);
      const mk = (id: string, label: string, href: string, n: unknown) =>
        action(id, label, href, r ? { ...r, n } as RowDataPacket : null, { high: 1, critical: 3, group: "Run", hint: "overdue = past the run's window-close date" });
      return [mk("signoff", "Runs awaiting finance sign-off", "/payroll/sign-off", r?.signoffN), mk("validation", "Runs awaiting validation", "/payroll/validation", r?.validationN)];
    }),

    bank: wrap(async (ctx) => {
      const sc = empScope(ctx);
      const r = await one(
        `SELECT COUNT(*) AS n, DATEDIFF(CURDATE(), MIN(x.created_at)) AS oldest,
                SUM(x.created_at < DATE_SUB(CURDATE(), INTERVAL ${AGING_DAYS} DAY)) AS overdue
           FROM payroll_bank_exception x JOIN employees e ON e.id = x.employee_id
          WHERE x.workflow_status IN ('open','in_progress')${sc.sql}`, sc.params);
      return [action("bank-exceptions", "Bank-account exceptions open", "/payroll/payment-center?tab=bank", r, { high: 1, critical: 50, group: "Disbursal", hint: `overdue = older than ${AGING_DAYS}d` })];
    }),

    attendanceUnits: wrap(async (ctx) => {
      const cycle = cycleMonth(ctx.today);
      const branch = isOrg(ctx) ? { sql: "1=1", params: [] as string[] }
        : ctx.scope.branchIds.length ? { sql: `branch_id IN (${ctx.scope.branchIds.map(() => "?").join(",")})`, params: [...ctx.scope.branchIds] } : { sql: "1=0", params: [] as string[] };
      const r = await one(
        `SELECT SUM(attendance_frozen = 0) AS n, COUNT(*) AS units, COALESCE(SUM(pending_regularization_count),0) AS regs,
                COALESCE(SUM(pending_leave_count),0) AS leaves
           FROM payroll_branch_readiness
          WHERE process_month COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci AND ${branch.sql}`, [cycle, ...branch.params]);
      if (!r || !num(r.units)) return [unavailable("attendance-unfrozen", `Attendance not frozen (${cycle})`, "/payroll/readiness", `No branch readiness rows exist for ${cycle}`)];
      return [{ ...action("attendance-unfrozen", `Branch units with attendance not frozen (${cycle})`, "/payroll/readiness", { ...r, oldest: null, overdue: 0 } as RowDataPacket, { high: 1, critical: 20, group: "Attendance" }),
        hint: `${num(r.units)} units tracked; ${num(r.regs)} pending regularizations, ${num(r.leaves)} pending leaves` }];
    }),

    recalcQueue: wrap(async (ctx) => {
      const sc = empScope(ctx);
      const r = await one(
        `SELECT COUNT(*) AS n, DATEDIFF(CURDATE(), MIN(q.requested_at)) AS oldest, SUM(q.status = 'failed') AS overdue
           FROM payroll_recalculation_queue q JOIN employees e ON e.id = q.employee_id
          WHERE q.status IN ('pending','processing','failed')${sc.sql}`, sc.params);
      return [action("recalc", "Recalculation requests pending / failed", "/payroll/recalculation-queue", r, { high: 1, critical: 25, group: "Run", hint: "overdue = failed" })];
    }),

    filings: wrap(async (ctx) => {
      if (!isOrg(ctx)) return [unavailable("filings", "Statutory filings due", "/payroll/statutory?tab=filing", "Statutory filings are company-level - org-wide roles only")];
      const r = await one(
        `SELECT COUNT(*) AS n, DATEDIFF(CURDATE(), MIN(due_date)) AS oldest, SUM(due_date < CURDATE()) AS overdue
           FROM statutory_filing_record
          WHERE status <> 'filed' AND filing_type <> 'PT' AND due_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)`);
      const a = action("filings", "Statutory filings overdue or due in 7 days", "/payroll/statutory?tab=filing", r, { high: 1, critical: 1, group: "Statutory", hint: "PF, ESI, TDS, LWF (PT retired); oldest = days past due" });
      return [a];
    }),

    cycleRun: wrap(async (ctx) => {
      if (!isOrg(ctx)) return [];
      const cycle = cycleMonth(ctx.today);
      const [run, cal] = await Promise.all([
        one(`SELECT COUNT(*) AS n FROM salary_prep_run WHERE run_month = ? AND status <> 'cancelled'`, [cycle]),
        one(`SELECT DATE_FORMAT(payroll_run_date, '%Y-%m-%d') AS d FROM payroll_calendar WHERE calendar_month = ? LIMIT 1`, [cycle]),
      ]);
      const missing = (num(run?.n) ?? 0) === 0;
      const due = cal?.d ? String(cal.d) : null;
      return [{
        id: "cycle-run", label: `Create the ${cycle} payroll run`, href: "/payroll", group: "Run", count: missing ? 1 : 0,
        severity: missing ? (due && due < ctx.today ? "critical" : "high") : "info", oldestDays: missing && due && due < ctx.today ? daysBetween(due, ctx.today) : null,
        overdue: missing && due && due < ctx.today ? 1 : 0,
        hint: due ? `Calendar run date ${due}` : "No payroll calendar row for this month",
      }];
    }),
  },
};

provider.sections.trends = async (ctx): Promise<InsightSection> => {
  const sc = empScope(ctx);
  const runs = await rows(
    `SELECT id, run_month FROM salary_prep_run WHERE run_kind = 'regular' AND status NOT IN ('draft','cancelled') AND branch_filter IS NULL
      ORDER BY run_month DESC, created_at DESC LIMIT 12`);
  // One run per month (newest created wins) - supplementary / re-runs must not double a month.
  const seen = new Set<string>();
  const picked = runs.filter((r) => (seen.has(String(r.run_month)) ? false : (seen.add(String(r.run_month)), true))).reverse();
  if (!picked.length) return { series: [{ key: "cost-trend", title: "Payroll cost by run", kind: "stacked", points: [], unavailable: "No payroll runs exist yet" }] };
  // One query per run, in parallel: a single IN (...) over a dozen runs joined to employees measured 9s against the live DB
  // (the join, not the sums, is the cost), while each run on its own is sub-second. Org-wide callers skip the join entirely.
  const agg = (await Promise.all(picked.map((r) => runSums(String(r.id), sc)))).flat();
  const by = new Map(agg.map((r) => [String(r.run_id), r]));
  const pts = picked.map((r) => ({ label: String(r.run_month), a: by.get(String(r.id)) }));
  return {
    series: [
      { key: "cost-trend", title: "Payroll cost by run", subtitle: "Net pay + employee deductions + employer PF/ESI, summed from payroll lines", kind: "stacked", unit: "inr", href: "/payroll/variance-analysis",
        keys: [{ key: "net", label: "Net pay", tone: "blue" }, { key: "deductions", label: "Employee deductions", tone: "amber" }, { key: "employer", label: "Employer PF + ESI", tone: "violet" }],
        points: pts.map((p) => ({ label: p.label, net: num(p.a?.net), deductions: num(p.a?.ded), employer: num(p.a?.er), value: p.a ? payrollCost(num(p.a.net) ?? 0, num(p.a.ded) ?? 0, num(p.a.er) ?? 0) : null })) },
      { key: "headcount-trend", title: "Employees paid per run", kind: "line", unit: "count", points: pts.map((p) => ({ label: p.label, value: num(p.a?.emp) })) },
      { key: "lop-trend", title: "LOP days per run", subtitle: "Sum of lwp_days on payroll lines", kind: "bar", unit: "days", points: pts.map((p) => ({ label: p.label, value: num(p.a?.lop) })) },
    ],
  };
};

provider.sections.statutoryDue = async (): Promise<InsightSection> => {
  const list = await rows(
    `SELECT filing_type AS type, filing_month AS month, DATE_FORMAT(due_date, '%Y-%m-%d') AS due, status
       FROM statutory_filing_record WHERE filing_type <> 'PT' AND (status <> 'filed' OR due_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY))
      ORDER BY due_date DESC LIMIT 12`);
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const label: Record<string, string> = { EPF: "PF (EPF)", ESIC: "ESI", TDS_24Q: "TDS (24Q)", TDS_138: "TDS (sec 138)", LWF: "LWF" };
  return {
    tables: [{
      key: "statutory-due", title: "Statutory filings (PT retired)", href: "/payroll/statutory?tab=filing",
      columns: [{ key: "filing", label: "Filing" }, { key: "month", label: "For month" }, { key: "due", label: "Due" }, { key: "status", label: "Status" }, { key: "days", label: "Days to due", unit: "days", align: "right" }],
      rows: list.map((r) => {
        const status = effectiveFilingStatus(String(r.status), r.due ? String(r.due) : null, today);
        return { filing: label[String(r.type)] ?? String(r.type), month: String(r.month), due: r.due ? String(r.due) : null, status: status === "overdue" ? "Overdue" : status === "filed" ? "Filed" : "Pending", days: r.due ? daysBetween(today, String(r.due)) : null };
      }),
    }],
  };
};

provider.sections.calendar = async (ctx): Promise<InsightSection> => {
  const cycle = cycleMonth(ctx.today);
  const c = await one(
    `SELECT DATE_FORMAT(attendance_cutoff_date, '%Y-%m-%d') AS cutoff, DATE_FORMAT(incentive_upload_deadline, '%Y-%m-%d') AS incentive,
            DATE_FORMAT(deductions_upload_deadline, '%Y-%m-%d') AS deductions, DATE_FORMAT(branch_readiness_deadline, '%Y-%m-%d') AS readiness,
            DATE_FORMAT(payroll_run_date, '%Y-%m-%d') AS runDate, DATE_FORMAT(validation_date, '%Y-%m-%d') AS validation,
            DATE_FORMAT(disbursement_date, '%Y-%m-%d') AS pay
       FROM payroll_calendar WHERE calendar_month = ? LIMIT 1`, [cycle]);
  if (!c) return { tables: [{ key: "cycle-calendar", title: `Payroll calendar ${cycle}`, columns: [], rows: [], href: "/payroll/calendar", unavailable: `No payroll calendar configured for ${cycle}` }] };
  const items: Array<[string, unknown]> = [["Attendance cut-off", c.cutoff], ["Incentive upload deadline", c.incentive], ["Deductions upload deadline", c.deductions], ["Branch readiness deadline", c.readiness], ["Payroll run", c.runDate], ["Validation", c.validation], ["Pay date (disbursement)", c.pay]];
  return {
    tables: [{
      key: "cycle-calendar", title: `Payroll calendar ${cycle}`, href: "/payroll/calendar",
      columns: [{ key: "milestone", label: "Milestone" }, { key: "date", label: "Date" }, { key: "days", label: "From today", unit: "days", align: "right" }],
      rows: items.filter(([, d]) => d).map(([milestone, d]) => ({ milestone, date: String(d), days: daysBetween(ctx.today, String(d)) })),
    }],
  };
};

provider.sections.readinessByBranch = async (ctx): Promise<InsightSection> => {
  const cycle = cycleMonth(ctx.today);
  const branch = isOrg(ctx) ? { sql: "1=1", params: [] as string[] }
    : ctx.scope.branchIds.length ? { sql: `r.branch_id IN (${ctx.scope.branchIds.map(() => "?").join(",")})`, params: [...ctx.scope.branchIds] } : { sql: "1=0", params: [] as string[] };
  const list = await rows(
    `SELECT COALESCE(bm.branch_name, 'Unassigned') AS branch, COUNT(*) AS units, SUM(r.attendance_frozen = 1) AS frozen,
            COALESCE(SUM(r.pending_regularization_count),0) AS regs, COALESCE(SUM(r.pending_leave_count),0) AS leaves,
            COALESCE(SUM(r.employees_without_attendance),0) AS noAtt
       FROM payroll_branch_readiness r LEFT JOIN branch_master bm ON bm.id = r.branch_id
      WHERE r.process_month COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci AND ${branch.sql}
      GROUP BY r.branch_id, bm.branch_name ORDER BY (COUNT(*) - SUM(r.attendance_frozen = 1)) DESC, SUM(r.pending_regularization_count) DESC LIMIT 10`, [cycle, ...branch.params]);
  return {
    tables: [{
      key: "readiness-branches", title: `Attendance lock by branch (${cycle})`, href: "/payroll/readiness",
      columns: [{ key: "branch", label: "Branch" }, { key: "frozen", label: "Frozen / units" }, { key: "regs", label: "Pending regularizations", unit: "count", align: "right" }, { key: "leaves", label: "Pending leaves", unit: "count", align: "right" }, { key: "noAtt", label: "No attendance", unit: "count", align: "right" }],
      rows: list.map((r) => ({ branch: String(r.branch), frozen: `${num(r.frozen) ?? 0} / ${num(r.units) ?? 0}`, regs: num(r.regs), leaves: num(r.leaves), noAtt: num(r.noAtt), href: "/payroll/readiness" })),
      unavailable: list.length ? null : `No branch readiness rows for ${cycle}`,
    }],
  };
};

provider.sections.loans = async (ctx): Promise<InsightSection> => {
  const sc = empScope(ctx);
  const r = await one(
    `SELECT COUNT(*) AS n, COALESCE(SUM(l.pending_amount),0) AS outstanding, COALESCE(SUM(l.deduction_per_month),0) AS emi
       FROM employee_loans l JOIN employees e ON e.id = l.employee_id WHERE l.status = 'active'${sc.sql}`, sc.params);
  return {
    kpis: [{ key: "loans", label: "Active loans & advances", value: num(r?.n), unit: "count", tone: "violet", href: "/payroll/loans",
      helper: r ? `Rs ${Math.round(num(r.outstanding) ?? 0).toLocaleString("en-IN")} outstanding, Rs ${Math.round(num(r.emi) ?? 0).toLocaleString("en-IN")} EMI/month` : undefined,
      formula: "employee_loans with status = active; outstanding = sum(pending_amount). Org-wide position, not run-scoped." }],
  };
};

provider.sections.signals = async (ctx): Promise<InsightSection> => {
  const sc = empScope(ctx);
  const cycle = cycleMonth(ctx.today);
  const [runs, filings, bank, units, cycleRun] = await Promise.all([
    rows(`SELECT id, run_month, status FROM salary_prep_run WHERE run_kind = 'regular' AND status <> 'cancelled' AND branch_filter IS NULL ORDER BY run_month DESC, created_at DESC LIMIT 2`),
    isOrg(ctx) ? one(`SELECT SUM(due_date < CURDATE()) AS overdue, SUM(due_date >= CURDATE() AND due_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)) AS soon FROM statutory_filing_record WHERE status <> 'filed' AND filing_type <> 'PT'`) : Promise.resolve(null),
    one(`SELECT COUNT(*) AS n FROM payroll_bank_exception x JOIN employees e ON e.id = x.employee_id WHERE x.workflow_status IN ('open','in_progress')${sc.sql}`, sc.params),
    one(`SELECT SUM(attendance_frozen = 0) AS n FROM payroll_branch_readiness WHERE process_month COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci`, [cycle]),
    one(`SELECT COUNT(*) AS n FROM salary_prep_run WHERE run_month = ? AND status <> 'cancelled'`, [cycle]),
  ]);
  const cal = runs[0] ? await one(`SELECT DATE_FORMAT(disbursement_date, '%Y-%m-%d') AS pay FROM payroll_calendar WHERE calendar_month = ? LIMIT 1`, [String(runs[0].run_month)]) : null;
  let latest: SignalInput["latest"] = null;
  let previousNet: number | null = null;
  if (runs[0]) {
    const ids = runs.map((r) => String(r.id));
    const agg = (await Promise.all(ids.map((id) => runSums(id, sc)))).flat();
    const by = new Map(agg.map((r) => [String(r.run_id), r]));
    const cur = by.get(ids[0]);
    if (cur) latest = { month: String(runs[0].run_month), status: String(runs[0].status), net: num(cur.net) ?? 0, zeroNet: num(cur.zero) ?? 0, employees: num(cur.emp) ?? 0, ptLines: num(cur.ptl) ?? 0, ptAmount: num(cur.pt) ?? 0 };
    previousNet = ids[1] ? num(by.get(ids[1])?.net) : null;
  }
  return {
    signals: buildSignals({
      today: ctx.today, cycle, cycleRunExists: !isOrg(ctx) || (num(cycleRun?.n) ?? 0) > 0, latest, previousNet,
      payDate: cal?.pay ? String(cal.pay) : null, filingsOverdue: num(filings?.overdue) ?? 0, filingsDueSoon: num(filings?.soon) ?? 0,
      bankExceptions: num(bank?.n), unfrozenUnits: num(units?.n),
    }),
  };
};

export default provider;
