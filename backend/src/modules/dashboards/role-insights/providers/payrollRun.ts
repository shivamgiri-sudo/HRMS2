import type { RowDataPacket } from "mysql2";
import { num, rows } from "../helpers.js";

/**
 * Run-scoped payroll computations for PAYROLL_HR_DASHBOARD's operational-summary.
 * Pure helpers (pipeline, drivers, filing status) are exported for tests; `loadRunInsights` does the I/O.
 *
 * Definitions worth knowing (verified against the live DB, 2026-10):
 *  - salary_prep_line.gross_salary is the CONTRACTUAL gross, not what was earned (incentive, arrears and
 *    portfolio pay sit outside it), and salary_prep_run.total_* headers drift (a finalized run holds
 *    total_deductions = 0 while its lines hold 1.08M; total_employees disagrees with the line count).
 *    Every figure here is therefore summed from the lines.
 *  - Payroll cost = net pay + employee deductions + employer PF + employer ESI. employer_statutory_cost is NOT
 *    used: on sampled lines it equals the employee PF deduction, not an employer contribution.
 *  - Professional Tax was retired company-wide, so PT filings are excluded; PT still sitting on lines is
 *    reported as an anomaly rather than as a liability.
 */

export type StageState = "done" | "current" | "pending" | "blocked" | "unknown";
export interface PipelineStage { key: string; label: string; state: StageState; detail: string; href: string }
export interface Pipeline {
  stages: PipelineStage[];
  stuckAt: string | null;
  stuckLabel: string | null;
  payDate: string | null;
  daysToPayDate: number | null;
  lastActivityDays: number | null;
}

export interface PipelineInput {
  status: string;
  validationStatus: string | null;
  financeApprovedAt: string | null;
  attendanceLocked: boolean;
  readiness: { units: number; frozen: number } | null;
  employees: number;
  disbursement: { status: string | null } | null;
  disbursedAt: string | null;
  filings: FilingRow[];
  payslips: { generated: number; expected: number } | null;
  payDate: string | null;
  today: string;
  runMonth: string;
  updatedAt: string | null;
}

export interface FilingRow {
  type: string;
  label: string;
  dueDate: string | null;
  status: "filed" | "pending" | "overdue";
  amountDue: number | null;
  daysToDue: number | null;
}

const FILING_LABEL: Record<string, string> = {
  EPF: "PF (EPF)", ESIC: "ESI", TDS_24Q: "TDS (24Q)", TDS_138: "TDS (sec 138)", LWF: "LWF",
};

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** `pending` past its due date is overdue regardless of what the cron last wrote. */
export function effectiveFilingStatus(status: string, dueDate: string | null, today: string): FilingRow["status"] {
  if (status === "filed") return "filed";
  if (status === "overdue") return "overdue";
  return dueDate && dueDate < today ? "overdue" : "pending";
}

const RANK: Record<string, number> = {
  draft: 0, calculating: 1, calculated: 2, under_review: 3, processing: 3, approved: 4, finalized: 5, locked: 5, disbursed: 6, cancelled: -1,
};

export function computePipeline(i: PipelineInput): Pipeline {
  const status = i.status.trim().toLowerCase();
  const rank = RANK[status] ?? 0;
  const approvedOrLater = rank >= 4;
  const stages: PipelineStage[] = [];

  // 1 Attendance lock. Run-level flag is never set in production; branch readiness is the real evidence.
  const r = i.readiness;
  const allFrozen = r !== null && r.units > 0 && r.frozen >= r.units;
  stages.push({
    key: "attendance", label: "Attendance lock", href: "/payroll/readiness",
    state: i.attendanceLocked || allFrozen || approvedOrLater ? "done" : r ? (rank >= 2 ? "blocked" : "pending") : "unknown",
    detail: r ? `${r.frozen} of ${r.units} branch-process units frozen` : "No branch readiness recorded for this month",
  });

  // 2 Preparation / calculation
  const calculated = i.employees > 0 && rank >= 2;
  stages.push({
    key: "prep", label: "Prep & calculation", href: "/payroll",
    state: calculated ? "done" : "pending",
    detail: i.employees > 0 ? `${i.employees.toLocaleString("en-IN")} employees calculated` : "No payroll lines yet",
  });

  // 3 Validation
  const vs = (i.validationStatus ?? "pending").toLowerCase();
  stages.push({
    key: "validation", label: "Validation", href: "/payroll/validation",
    state: vs === "rejected" ? "blocked" : vs === "validated" || approvedOrLater ? "done" : "pending",
    detail: vs === "rejected" ? "Rejected - needs rework" : vs === "validated" ? "Validated" : approvedOrLater ? "Passed (run is past approval)" : "Awaiting validation",
  });

  // 4 Approval / sign-off
  stages.push({
    key: "approval", label: "Approval", href: "/payroll/sign-off",
    state: i.financeApprovedAt || approvedOrLater ? "done" : "pending",
    detail: i.financeApprovedAt ? `Finance approved ${i.financeApprovedAt.slice(0, 10)}` : approvedOrLater ? "Approved" : "Awaiting finance sign-off",
  });

  // 5 Disbursal
  const paid = i.disbursement?.status === "completed" || Boolean(i.disbursedAt) || status === "disbursed";
  stages.push({
    key: "disbursal", label: "Bank disbursal", href: "/payroll/payment-center",
    state: paid ? "done" : rank >= 5 ? "unknown" : "pending",
    detail: paid ? "Disbursed" : rank >= 5 ? "Run is closed but no disbursal record exists" : i.disbursement ? `Status: ${i.disbursement.status ?? "unknown"}` : "Not disbursed",
  });

  // 6 Statutory filing (PT excluded)
  const f = i.filings;
  const overdue = f.filter((x) => x.status === "overdue").length;
  const filed = f.filter((x) => x.status === "filed").length;
  stages.push({
    key: "statutory", label: "Statutory filing", href: "/payroll/statutory?tab=filing",
    state: !f.length ? "unknown" : overdue ? "blocked" : filed === f.length ? "done" : "pending",
    detail: !f.length ? `No filing records for ${i.runMonth}` : `${filed} of ${f.length} filed${overdue ? `, ${overdue} overdue` : ""}`,
  });

  // 7 Payslips
  const p = i.payslips;
  const slipsDone = p !== null && p.expected > 0 && p.generated >= p.expected;
  stages.push({
    key: "payslips", label: "Payslips", href: "/payroll/payslips",
    state: slipsDone ? "done" : p ? "pending" : "unknown",
    detail: p ? `${p.generated.toLocaleString("en-IN")} of ${p.expected.toLocaleString("en-IN")} generated` : "No payroll lines to generate payslips for",
  });

  // The first stage that is not finished becomes "current"; later pending ones stay pending.
  const idx = stages.findIndex((s) => s.state === "pending" || s.state === "blocked");
  if (idx >= 0 && stages[idx].state === "pending") stages[idx] = { ...stages[idx], state: "current" };
  const stuck = idx >= 0 ? stages[idx] : null;

  return {
    stages,
    stuckAt: stuck?.key ?? null,
    stuckLabel: stuck?.label ?? null,
    payDate: i.payDate,
    daysToPayDate: i.payDate ? daysBetween(i.today, i.payDate) : null,
    lastActivityDays: i.updatedAt ? Math.max(0, daysBetween(i.updatedAt.slice(0, 10), i.today)) : null,
  };
}

export interface RunTotals {
  employees: number; net: number; deductions: number; contractGross: number; employer: number; payrollCost: number;
  lopDays: number; lopEmployees: number; zeroNet: number; negativeNet: number; inactiveInRun: number;
  incentive: number; arrears: number; overtime: number; tds: number; loanEmi: number; reimbursement: number;
  ptLines: number; ptAmount: number; pfLiability: number; esiLiability: number;
}

export function payrollCost(net: number, deductions: number, employer: number): number {
  return Math.round((net + deductions + employer) * 100) / 100;
}

export interface Driver { key: string; label: string; amount: number; hint: string }

/** What moved the net bill between two runs, biggest first. Amounts are signed (current - previous). */
export function deriveDrivers(cur: RunTotals, prev: RunTotals, joiners: { count: number; net: number }, dropped: { count: number; net: number }): Driver[] {
  const d = (key: string, label: string, amount: number, hint: string): Driver => ({ key, label, amount: Math.round(amount * 100) / 100, hint });
  const items: Driver[] = [
    d("joiners", "New in this run", joiners.net, `${joiners.count} employees not in the previous run`),
    d("dropped", "Dropped since previous run", -dropped.net, `${dropped.count} employees paid last run, absent now`),
    d("incentive", "Incentive", cur.incentive - prev.incentive, "incentive_total across lines"),
    d("arrears", "Arrears", cur.arrears - prev.arrears, "arrears_amount across lines"),
    d("overtime", "Overtime", cur.overtime - prev.overtime, "overtime_pay across lines"),
    d("tds", "TDS withheld", -(cur.tds - prev.tds), "higher TDS lowers net"),
    d("loan", "Loan EMI", -(cur.loanEmi - prev.loanEmi), "higher EMI lowers net"),
    d("lop", "LOP days", 0, `${cur.lopDays - prev.lopDays >= 0 ? "+" : ""}${Math.round((cur.lopDays - prev.lopDays) * 10) / 10} days vs previous run`),
  ];
  return items.filter((x) => x.amount !== 0 || x.key === "lop").sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

const EMPTY: RunTotals = {
  employees: 0, net: 0, deductions: 0, contractGross: 0, employer: 0, payrollCost: 0, lopDays: 0, lopEmployees: 0, zeroNet: 0, negativeNet: 0,
  inactiveInRun: 0, incentive: 0, arrears: 0, overtime: 0, tds: 0, loanEmi: 0, reimbursement: 0, ptLines: 0, ptAmount: 0, pfLiability: 0, esiLiability: 0,
};

function toTotals(r: RowDataPacket | undefined): RunTotals {
  if (!r) return { ...EMPTY };
  const n = (k: string) => num(r[k]) ?? 0;
  const net = n("net"), ded = n("ded"), er = n("er");
  return {
    employees: n("emp"), net, deductions: ded, contractGross: n("gross"), employer: er, payrollCost: payrollCost(net, ded, er),
    lopDays: n("lop"), lopEmployees: n("lopEmp"), zeroNet: n("zeroNet"), negativeNet: n("negNet"), inactiveInRun: n("inactiveInRun"),
    incentive: n("inc"), arrears: n("arr"), overtime: n("ot"), tds: n("tds"), loanEmi: n("loan"), reimbursement: n("reimb"),
    ptLines: n("ptLines"), ptAmount: n("pt"), pfLiability: n("pfl"), esiLiability: n("esil"),
  };
}

export interface RunRef { id: string; run_month: string; run_kind?: string | null; branch_filter?: string | null; status: string; updated_at?: unknown }
interface ScopeFrag { sql: string; params: string[] }

const AGG_SQL = `SELECT l.run_id AS run_id, COUNT(DISTINCT l.employee_id) AS emp,
       SUM(l.gross_salary) AS gross, SUM(l.net_salary) AS net, SUM(l.total_deductions) AS ded,
       SUM(l.pf_employer + l.esic_employer) AS er, SUM(l.lwp_days) AS lop, SUM(l.lwp_days > 0) AS lopEmp,
       SUM(l.net_salary <= 0) AS zeroNet, SUM(l.net_salary < 0) AS negNet, SUM(e.active_status = 0) AS inactiveInRun,
       SUM(l.incentive_total) AS inc, SUM(COALESCE(l.arrears_amount, 0)) AS arr, SUM(l.overtime_pay) AS ot,
       SUM(l.tds_amount) AS tds, SUM(l.loan_emi) AS loan, SUM(l.reimbursement_total) AS reimb,
       SUM(l.professional_tax > 0) AS ptLines, SUM(l.professional_tax) AS pt,
       SUM(l.pf_employee + l.pf_employer) AS pfl, SUM(l.esic_employee + l.esic_employer) AS esil
  FROM salary_prep_line l JOIN employees e ON e.id = l.employee_id`;

export async function loadRunInsights(runRef: RunRef, scope: ScopeFrag, isOrgWide: boolean, today: string) {
  // The caller's SELECT predates validation / approval tracking and carries no run_kind, so read them here.
  const meta = (await rows<RowDataPacket>(
    `SELECT run_kind, branch_filter, validation_status, attendance_snapshot_locked AS locked, DATE_FORMAT(finance_approved_at, '%Y-%m-%d') AS fin,
            DATE_FORMAT(disbursed_at, '%Y-%m-%d') AS disb, updated_at
       FROM salary_prep_run WHERE id = ?`, [runRef.id]))[0] ?? {};
  const run = { ...runRef, run_kind: meta.run_kind ?? runRef.run_kind, branch_filter: meta.branch_filter ?? runRef.branch_filter, updated_at: meta.updated_at ?? runRef.updated_at };
  const prevRows = await rows<RowDataPacket>(
    `SELECT id, run_month FROM salary_prep_run
      WHERE run_kind = ? AND run_month < ? AND branch_filter <=> ? AND status NOT IN ('draft','cancelled')
      ORDER BY run_month DESC, created_at DESC LIMIT 1`,
    [run.run_kind ?? "regular", run.run_month, run.branch_filter ?? null],
  );
  const prev = prevRows[0] ?? null;
  const ids = prev ? [run.id, String(prev.id)] : [run.id];
  const monthEnd = new Date(Date.UTC(Number(run.run_month.slice(0, 4)), Number(run.run_month.slice(5, 7)), 0)).toISOString().slice(0, 10);

  const [aggRows, head, joinRows, dropRows, variance, anomalies, branches, cal, filingRows, slips, disb, readiness] = await Promise.all([
    // Per run in parallel: one IN (...) over both runs was several times slower than two single-run queries.
    Promise.all(ids.map((id) => rows<RowDataPacket>(`${AGG_SQL} WHERE l.run_id = ? AND ${scope.sql} GROUP BY l.run_id`, [id, ...scope.params]))).then((r) => r.flat()),
    rows<RowDataPacket>(
      `SELECT COUNT(*) AS active, SUM(l.employee_id IS NOT NULL) AS activeInRun,
              SUM(l.employee_id IS NULL AND e.date_of_joining > ?) AS notDue,
              SUM(l.employee_id IS NULL AND (e.date_of_joining IS NULL OR e.date_of_joining <= ?)
                  AND NOT EXISTS (SELECT 1 FROM employee_salary_assignment a WHERE a.employee_id = e.id AND a.active_status = 1)) AS noStructure,
              SUM(l.employee_id IS NULL AND (e.date_of_joining IS NULL OR e.date_of_joining <= ?)
                  AND EXISTS (SELECT 1 FROM employee_salary_assignment a WHERE a.employee_id = e.id AND a.active_status = 1)) AS otherMissing
         FROM employees e LEFT JOIN salary_prep_line l ON l.run_id = ? AND l.employee_id = e.id
        WHERE e.active_status = 1 AND ${scope.sql}`,
      [monthEnd, monthEnd, monthEnd, run.id, ...scope.params],
    ),
    prev ? rows<RowDataPacket>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(c.net_salary), 0) AS net FROM salary_prep_line c JOIN employees e ON e.id = c.employee_id
         LEFT JOIN salary_prep_line p ON p.run_id = ? AND p.employee_id = c.employee_id
        WHERE c.run_id = ? AND p.id IS NULL AND ${scope.sql}`, [prev.id, run.id, ...scope.params]) : Promise.resolve([]),
    prev ? rows<RowDataPacket>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(p.net_salary), 0) AS net FROM salary_prep_line p JOIN employees e ON e.id = p.employee_id
         LEFT JOIN salary_prep_line c ON c.run_id = ? AND c.employee_id = p.employee_id
        WHERE p.run_id = ? AND c.id IS NULL AND ${scope.sql}`, [run.id, prev.id, ...scope.params]) : Promise.resolve([]),
    prev ? rows<RowDataPacket>(
      `SELECT e.id, e.employee_code AS code, e.full_name AS name, c.net_salary AS net, p.net_salary AS prevNet
         FROM salary_prep_line c JOIN salary_prep_line p ON p.run_id = ? AND p.employee_id = c.employee_id
         JOIN employees e ON e.id = c.employee_id
        WHERE c.run_id = ? AND p.net_salary > 0 AND ABS(c.net_salary - p.net_salary) >= 2000
          AND ABS(c.net_salary - p.net_salary) / p.net_salary >= 0.25 AND ${scope.sql}
        ORDER BY ABS(c.net_salary - p.net_salary) DESC LIMIT 8`, [prev.id, run.id, ...scope.params]) : Promise.resolve([]),
    rows<RowDataPacket>(
      `SELECT e.id, e.employee_code AS code, e.full_name AS name, l.net_salary AS net, l.attendance_data_source AS src
         FROM salary_prep_line l JOIN employees e ON e.id = l.employee_id
        WHERE l.run_id = ? AND e.active_status = 1 AND l.net_salary <= 0 AND ${scope.sql}
        ORDER BY l.net_salary ASC LIMIT 8`, [run.id, ...scope.params]),
    rows<RowDataPacket>(
      `SELECT COALESCE(bm.branch_name, 'Unassigned') AS branch, COUNT(*) AS emp, SUM(l.net_salary) AS net, SUM(l.total_deductions) AS ded,
              SUM(l.pf_employer + l.esic_employer) AS er
         FROM salary_prep_line l JOIN employees e ON e.id = l.employee_id LEFT JOIN branch_master bm ON bm.id = e.branch_id
        WHERE l.run_id = ? AND ${scope.sql} GROUP BY bm.id, bm.branch_name ORDER BY SUM(l.net_salary) DESC LIMIT 12`,
      [run.id, ...scope.params]),
    rows<RowDataPacket>(
      `SELECT DATE_FORMAT(disbursement_date, '%Y-%m-%d') AS pay, DATE_FORMAT(attendance_cutoff_date, '%Y-%m-%d') AS cutoff,
              DATE_FORMAT(incentive_upload_deadline, '%Y-%m-%d') AS incentive, DATE_FORMAT(branch_readiness_deadline, '%Y-%m-%d') AS readiness,
              DATE_FORMAT(payroll_run_date, '%Y-%m-%d') AS runDate, DATE_FORMAT(validation_date, '%Y-%m-%d') AS validation
         FROM payroll_calendar WHERE calendar_month = ? LIMIT 1`, [run.run_month]),
    rows<RowDataPacket>(
      `SELECT filing_type AS type, DATE_FORMAT(due_date, '%Y-%m-%d') AS due, status, amount_due AS amount
         FROM statutory_filing_record WHERE filing_month = ? AND filing_type <> 'PT' ORDER BY due_date ASC`, [run.run_month]),
    rows<RowDataPacket>(
      `SELECT COUNT(*) AS expected, SUM(sp.id IS NOT NULL) AS made, SUM(sp.acknowledged_at IS NOT NULL) AS acked, SUM(l.payslip_emailed = 1) AS emailed
         FROM salary_prep_line l JOIN employees e ON e.id = l.employee_id LEFT JOIN salary_payslip sp ON sp.prep_line_id = l.id
        WHERE l.run_id = ? AND ${scope.sql}`, [run.id, ...scope.params]),
    isOrgWide ? rows<RowDataPacket>(
      `SELECT status, total_amount AS amount, employee_count AS emp, bank_ref AS ref, DATE_FORMAT(disbursed_at, '%Y-%m-%d') AS at
         FROM payroll_disbursement WHERE run_id = ? ORDER BY disbursed_at DESC LIMIT 1`, [run.id]) : Promise.resolve([]),
    rows<RowDataPacket>(
      `SELECT COUNT(*) AS units, SUM(attendance_frozen = 1) AS frozen FROM payroll_branch_readiness
        WHERE process_month COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci`, [run.run_month]),
  ]);

  const byRun = new Map(aggRows.map((r) => [String(r.run_id), r]));
  const totals = toTotals(byRun.get(run.id));
  const previous = prev ? toTotals(byRun.get(String(prev.id))) : null;
  const h = head[0] ?? {};
  const active = num(h.active) ?? 0;
  const headcount = {
    activeInScope: active,
    inRun: totals.employees,
    activeInRun: num(h.activeInRun) ?? 0,
    paidInactive: totals.inactiveInRun,
    missingTotal: active - (num(h.activeInRun) ?? 0),
    missingNotDue: num(h.notDue) ?? 0,
    missingNoStructure: num(h.noStructure) ?? 0,
    missingOther: num(h.otherMissing) ?? 0,
  };

  const joiners = { count: num(joinRows[0]?.n) ?? 0, net: num(joinRows[0]?.net) ?? 0 };
  const dropped = { count: num(dropRows[0]?.n) ?? 0, net: num(dropRows[0]?.net) ?? 0 };
  const drivers = previous ? deriveDrivers(totals, previous, joiners, dropped) : [];

  const filings: FilingRow[] = filingRows.map((r) => ({
    type: String(r.type), label: FILING_LABEL[String(r.type)] ?? String(r.type), dueDate: r.due ? String(r.due) : null,
    status: effectiveFilingStatus(String(r.status), r.due ? String(r.due) : null, today), amountDue: num(r.amount),
    daysToDue: r.due ? daysBetween(today, String(r.due)) : null,
  }));
  const s = slips[0];
  const payslips = s && (num(s.expected) ?? 0) > 0
    ? { expected: num(s.expected) ?? 0, generated: num(s.made) ?? 0, acknowledged: num(s.acked) ?? 0, emailed: num(s.emailed) ?? 0 }
    : null;
  const d = disb[0];
  const disbursement = d ? { status: d.status ? String(d.status) : null, amount: num(d.amount), employees: num(d.emp), bankRef: d.ref ?? null, at: d.at ?? null } : null;
  const rd = readiness[0];
  const units = num(rd?.units) ?? 0;
  const calendar = cal[0] ?? null;

  const pipeline = computePipeline({
    status: String(run.status), validationStatus: meta.validation_status ? String(meta.validation_status) : null,
    financeApprovedAt: meta.fin ? String(meta.fin) : null, attendanceLocked: Boolean(meta.locked),
    readiness: units > 0 ? { units, frozen: num(rd?.frozen) ?? 0 } : null, employees: totals.employees, disbursement, disbursedAt: meta.disb ? String(meta.disb) : null,
    filings, payslips, payDate: calendar?.pay ? String(calendar.pay) : null, today, runMonth: run.run_month,
    updatedAt: run.updated_at ? new Date(run.updated_at as string).toISOString() : null,
  });

  return {
    totals, previous, previousRun: prev ? { id: String(prev.id), month: String(prev.run_month) } : null,
    headcount, joiners, dropped, drivers, filings, payslips, disbursement, calendar,
    pipeline, readinessUnits: units ? { units, frozen: num(rd?.frozen) ?? 0 } : null,
    branchCost: branches.map((b) => ({
      branch: String(b.branch), employees: num(b.emp) ?? 0, net: num(b.net) ?? 0, deductions: num(b.ded) ?? 0,
      cost: payrollCost(num(b.net) ?? 0, num(b.ded) ?? 0, num(b.er) ?? 0),
    })),
    abnormal: [
      ...anomalies.map((a) => ({ code: String(a.code), name: String(a.name ?? ""), net: num(a.net) ?? 0, reason: (num(a.net) ?? 0) < 0 ? "Negative net" : `Zero net${a.src === "NO_DATA" || a.src === null ? " (no attendance data)" : ""}` })),
      ...variance.map((v) => {
        const net = num(v.net) ?? 0, p = num(v.prevNet) ?? 0;
        return { code: String(v.code), name: String(v.name ?? ""), net, prevNet: p, reason: `${net >= p ? "+" : ""}${Math.round(((net - p) / p) * 100)}% vs previous run` };
      }),
    ],
  };
}
