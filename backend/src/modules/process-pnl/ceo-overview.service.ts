import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";

/**
 * The CEO view of the P&L: one figure per branch, and a ranked list of where profit is leaking.
 *
 * WHY THIS IS SEPARATE FROM THE STATEMENT
 * ---------------------------------------
 * The statement answers "what were the numbers". A CEO also needs "where do I act", and that
 * second question is not a different layout over the same rows — it needs comparisons the
 * statement does not make: branch against branch, cost ratio against the best performer, revenue
 * against the people who earned it.
 *
 * Every figure here is read from what actually happened rather than recomputed:
 *   revenue  billing_invoice_particular_snapshot   (what clients were invoiced)
 *   people   salary_prep_line                      (what payroll actually paid)
 *   spend    grn_entry_line_snapshot               (what was raised, rejections excluded)
 *   budget   finance_budget_line_snapshot          (what was planned)
 *
 * THE FINDINGS THIS SURFACES ARE REAL, NOT ILLUSTRATIVE
 * ----------------------------------------------------
 * Run against June 2026 it reports, among others: NOIDA-DIALDESK invoicing Rs 25.92 lakh with no
 * payroll attributed to it at all (an 87% margin that is an attribution error, not performance);
 * 220 people across seven dormant branches sitting in the payroll run at zero value; and NOIDA-2
 * spending 21.2% of revenue on indirect against NOIDA's 15.4%.
 *
 * None of those are visible on a statement, because each one looks plausible in isolation.
 */

export interface CeoBranchRow {
  branchId: string | null;
  branchName: string;
  revenue: number;
  peopleCost: number;
  staffPaid: number;
  indirectCost: number;
  budget: number;
  operatingProfit: number;
  /** Null where a margin is meaningless — a cost centre with no client revenue, or a closed branch. */
  marginPct: number | null;
  revenuePerHead: number | null;
  /** Set when the row cannot be read at face value, e.g. revenue with nobody posted to it. */
  flag: string | null;
  isCostCentre: boolean;
  isClosed: boolean;
}

export interface CeoOpportunity {
  id: string;
  severity: "critical" | "warning" | "settled";
  /** Headline figure, already formatted — "Rs 22.54 L", "220". */
  value: string;
  valueUnit: string;
  title: string;
  detail: string;
  action: string;
}

export interface CeoFilters {
  branchId?: string | null;
  processId?: string | null;
  costCentreId?: string | null;
  /**
   * Multi-select. A CEO comparing "Noida + Noida-2 against Ahmedabad" cannot do it one branch at a
   * time, so every filter accepts a list. The singular fields above are kept and folded in rather
   * than replaced: they are what the branch-scope resolver and every existing caller still pass.
   */
  branchIds?: string[] | null;
  processIds?: string[] | null;
  costCentreIds?: string[] | null;
}

/** Filters after the singular and plural forms have been merged into one list each. */
interface CeoScope {
  branchIds: string[];
  processIds: string[];
  costCentreIds: string[];
}

function scopeOf(f: CeoFilters): CeoScope {
  const merge = (one?: string | null, many?: string[] | null): string[] =>
    Array.from(new Set(
      [...(many ?? []), ...(one ? [one] : [])].map((v) => String(v).trim()).filter(Boolean),
    ));
  return {
    branchIds: merge(f.branchId, f.branchIds),
    processIds: merge(f.processId, f.processIds),
    costCentreIds: merge(f.costCentreId, f.costCentreIds),
  };
}

/** `IN (?,?,?)` for a list that is never empty at the call site — callers test length first. */
const marks = (list: string[]) => list.map(() => "?").join(",");

/** A month on the margin trend line. */
export interface CeoTrendPoint {
  period: string;
  revenue: number;
  operatingProfit: number;
  marginPct: number | null;
}

/**
 * The P&L for one process or cost centre, shown when a filter narrows to it.
 *
 * Process is not a grain the data supports across the board — only 18 of 66 processes carry
 * revenue at all — which is why the whole-company view stays at branch level. But for a
 * well-mapped one it holds up completely, and refusing to show it would withhold a real answer
 * because other rows are incomplete.
 *
 * So it is shown WITH its caveats attached rather than either hidden or presented bare. Onfido in
 * June is the worked example: Rs 90.39 lakh invoiced against Rs 32.05 lakh of payroll and
 * Rs 24.93 lakh of indirect — a 37% margin that is real, except that the indirect figure is the
 * ENTIRE NOIDA-2 branch GRN booked to this one cost centre, which the notes say out loud.
 */
export interface CeoFocus {
  kind: "process" | "cost_centre";
  label: string;
  revenue: number;
  invoiceLines: number;
  peopleCost: number;
  staffPaid: number;
  staffZeroPaid: number;
  indirectCost: number;
  budget: number;
  operatingProfit: number;
  marginPct: number | null;
  revenuePerHead: number | null;
  costPerHead: number | null;
  /** What a reader must know before trusting the margin above. Empty when nothing is amiss. */
  notes: string[];
}

export interface CeoOverview {
  period: string;
  revenue: number;
  peopleCost: number;
  indirectCost: number;
  operatingProfit: number;
  marginPct: number | null;
  staffPaid: number;
  revenuePerHead: number | null;
  branches: CeoBranchRow[];
  opportunities: CeoOpportunity[];
  trend: CeoTrendPoint[];
  /**
   * Distinct values for the filter controls, so the UI never invents an option that has no data.
   *
   * `branches` is deliberately NOT the filtered `branches` array above: it lists every branch that
   * traded this month, so ticking one still leaves the others selectable. Deriving the options from
   * the filtered rows makes the control a trap — select NOIDA and NOIDA becomes the only option.
   */
  options: {
    processes: { id: string; name: string }[];
    costCentres: { id: string; code: string }[];
    branches: { id: string; name: string }[];
  };
  /** Present only when exactly one process or cost centre is selected. */
  focus: CeoFocus | null;
  /** Whether this month's invoicing looks finished. Never null in practice; see billingCompleteness. */
  billing: CeoBillingCompleteness;
  /** Closed branches suppressed from `branches` because every money column was zero. */
  closedBranchesHidden: { branchName: string; staffPaid: number }[];
  /**
   * Data-quality flags that don't change any figure above but must not be silent. Currently one
   * possible entry: PAYROLL_IDC_CODE_IN_MAS_HRMS — see idcContaminationCheck(). Empty in the
   * normal case.
   */
  exceptions: { code: string; label: string; count: number; amount: number }[];
}

const n = (v: unknown): number => {
  const parsed = Number(v ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const lakh = (v: number): string => `Rs ${(v / 100000).toFixed(2)} L`;

/**
 * Only this company's own trading.
 *
 * cost_centre_master.company_name carries the legal entity, and the P&L had been consolidating
 * three of them. June 2026, before this filter:
 *
 *   Mas Callnet   revenue Rs 295.75 L   payroll Rs 210.28 L (1,162)   indirect Rs 72.62 L
 *   IDC           revenue Rs  76.32 L   payroll Rs   0.00 L (    0)   indirect Rs  4.38 L
 *   unmapped      revenue Rs   0.00 L   payroll Rs  17.60 L (  368)
 *
 * IDC contributed Rs 76.32 lakh of revenue across 38 cost centres and NOT ONE employee, which is
 * what lifted the consolidated margin to 17.8%. NOIDA-DIALDESK is a third entity again, Ispark
 * Dataconnect. Confirmed with the user: IDC is a separate company and this page is MAS Callnet's.
 *
 * Payroll is NOT filtered by company, deliberately. Every employee in this system belongs to MAS
 * Callnet — all 937 active staff with a cost centre map to it, IDC has none at all, and the 368
 * without a cost centre sit in MAS Callnet branches. Filtering payroll by cost centre would drop
 * Rs 17.60 lakh of real MAS wages simply because those employees lack a mapping.
 *
 * Matched on a normalised name because the source spells it four ways ("MAS Call Net India Pvt
 * Ltd", "Mas Callnet India Pvt. Ltd.", "Mas Callnet India Pvt Ltd", "MAS CALLNET INDIA PVT LTD.").
 */
const OWN_COMPANY_SQL = `REPLACE(REPLACE(REPLACE(LOWER(COALESCE(ccm.company_name, '')), '.', ''), ' ', ''), ',', '') LIKE '%mascallnet%'`;

/**
 * Revenue by branch, resolved through the cost centre.
 *
 * Two complementary sources are combined (same logic as pnl-actuals.service):
 *   SOURCE A — billing_invoice_particular_snapshot: detailed per-invoice lines (~540 rows FY2026-27)
 *   SOURCE B — billing_provision_snapshot: monthly billing confirmation per cost centre (7,350 rows)
 *              Used only where SOURCE A has no lines, preventing double-counting.
 *              Amounts are in RUPEES (stored as BIGINT integers by the sync script).
 *              db_bill.provision_master stores rupee figures; sync-db-bill-snapshot.mjs copies
 *              them verbatim via safeInt(). No /100 conversion is needed here.
 *
 * Only billing_provision_snapshot uses utf8mb4_0900_ai_ci — billing_invoice_particular_snapshot
 * and cost_centre_master both already use utf8mb4_unicode_ci (verified via information_schema,
 * 2026-08-19; the "both tables" wording this comment used to carry was itself the reason the
 * period_code half of the NOT EXISTS guard below went unfixed while cost_centre_code got COLLATE
 * — every column compared against billing_provision_snapshot needs it, cost_centre_code was never
 * the only one).
 */
async function revenueByBranch(period: string, s: CeoScope): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!(await tableExists("billing_invoice_particular_snapshot"))) return out;
  const hasProvision = await tableExists("billing_provision_snapshot");
  const hasCreditNote = await tableExists("billing_credit_note_snapshot");

  // Invoice particulars WHERE conditions
  const invWhere: string[] = ["p.period_code = ?", OWN_COMPANY_SQL];
  const invParams: unknown[] = [period];
  if (s.costCentreIds.length) {
    invWhere.push(`ccm.id IN (${marks(s.costCentreIds)})`);
    invParams.push(...s.costCentreIds);
  }
  // Cost centre carries no process_id on any live row, so a process narrows revenue through the
  // employees actually posted to that cost centre — the same modal rule the actuals use.
  if (s.processIds.length) {
    invWhere.push(`ccm.id IN (SELECT DISTINCT e.cost_centre_id FROM employees e
                               WHERE e.process_id IN (${marks(s.processIds)}) AND e.cost_centre_id IS NOT NULL)`);
    invParams.push(...s.processIds);
  }

  // Provision WHERE conditions — same scope filters plus extra guards
  const provWhere: string[] = ["ps.period_code = ?", "ps.revenue_active = 1", OWN_COMPANY_SQL];
  const provParams: unknown[] = [period];
  if (s.costCentreIds.length) {
    provWhere.push(`ccm.id IN (${marks(s.costCentreIds)})`);
    provParams.push(...s.costCentreIds);
  }
  if (s.processIds.length) {
    provWhere.push(`ccm.id IN (SELECT DISTINCT e.cost_centre_id FROM employees e
                                WHERE e.process_id IN (${marks(s.processIds)}) AND e.cost_centre_id IS NOT NULL)`);
    provParams.push(...s.processIds);
  }

  const creditWhere: string[] = ["cn.period_code = ?", "cn.is_approved = 1", OWN_COMPANY_SQL];
  const creditParams: unknown[] = [period];
  if (s.costCentreIds.length) {
    creditWhere.push(`ccm.id IN (${marks(s.costCentreIds)})`);
    creditParams.push(...s.costCentreIds);
  }
  if (s.processIds.length) {
    creditWhere.push(`ccm.id IN (SELECT DISTINCT e.cost_centre_id FROM employees e
                                  WHERE e.process_id IN (${marks(s.processIds)}) AND e.cost_centre_id IS NOT NULL)`);
    creditParams.push(...s.processIds);
  }

  const allParams = [
    ...invParams,
    ...(hasProvision ? provParams : []),
    ...(hasCreditNote ? creditParams : []),
  ];

  const [rows] = await db.execute<RowDataPacket[]>(
    `${hasProvision ? `
     WITH invoice_actual AS (
       SELECT p.cost_centre_code COLLATE utf8mb4_unicode_ci AS cost_centre_code,
              ccm.branch_id AS branch_id, SUM(p.amount) AS invoice_amount
         FROM billing_invoice_particular_snapshot p
         LEFT JOIN cost_centre_master ccm
                ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                 = p.cost_centre_code COLLATE utf8mb4_unicode_ci
        WHERE ${invWhere.join(" AND ")}
        GROUP BY p.cost_centre_code COLLATE utf8mb4_unicode_ci, ccm.branch_id
     ),
     provision_actual AS (
       SELECT ps.cost_centre_code COLLATE utf8mb4_unicode_ci AS cost_centre_code,
              ccm.branch_id AS branch_id,
              SUM(CASE WHEN ps.billing_amt > 0 THEN ps.billing_amt ELSE ps.provision_amt END) AS provision_amount
         FROM billing_provision_snapshot ps
         LEFT JOIN cost_centre_master ccm
                ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                 = ps.cost_centre_code COLLATE utf8mb4_unicode_ci
        WHERE ${provWhere.join(" AND ")}
        GROUP BY ps.cost_centre_code COLLATE utf8mb4_unicode_ci, ccm.branch_id
     )
     SELECT branch_id, SUM(amount) AS amount FROM (
       SELECT branch_id, invoice_amount AS amount FROM invoice_actual
       UNION ALL
       SELECT p.branch_id,
              GREATEST(p.provision_amount - COALESCE(i.invoice_amount, 0), 0) AS amount
         FROM provision_actual p
         LEFT JOIN invoice_actual i
                ON i.cost_centre_code = p.cost_centre_code
               AND COALESCE(i.branch_id, '') = COALESCE(p.branch_id, '')
       ${hasCreditNote ? `
       UNION ALL
       SELECT ccm.branch_id AS branch_id, -cn.total_amt AS amount
         FROM billing_credit_note_snapshot cn
         LEFT JOIN cost_centre_master ccm
                ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                 = cn.cost_centre_code COLLATE utf8mb4_unicode_ci
        WHERE ${creditWhere.join(" AND ")}` : ""}
     ) combined
     GROUP BY branch_id` : `
     SELECT branch_id, SUM(amount) AS amount FROM (
       SELECT ccm.branch_id AS branch_id, p.amount AS amount
         FROM billing_invoice_particular_snapshot p
         LEFT JOIN cost_centre_master ccm
                ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                 = p.cost_centre_code COLLATE utf8mb4_unicode_ci
        WHERE ${invWhere.join(" AND ")}
       ${hasCreditNote ? `
       UNION ALL
       SELECT ccm.branch_id AS branch_id, -cn.total_amt AS amount
         FROM billing_credit_note_snapshot cn
         LEFT JOIN cost_centre_master ccm
                ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                 = cn.cost_centre_code COLLATE utf8mb4_unicode_ci
        WHERE ${creditWhere.join(" AND ")}` : ""}
     ) combined
     GROUP BY branch_id`}`,
    allParams,
  );
  for (const r of rows) out.set(r.branch_id ? String(r.branch_id) : "", n(r.amount));
  return out;
}

/**
 * People cost by branch, from the payroll run rather than the recomputed snapshot.
 *
 * Read with explicit column names instead of through listColumns(), which is what made this
 * unreadable in the first place: information_schema returns COLUMN_NAME uppercased, so every
 * column probe answered false and every person came back costing nothing.
 */
/** Set by peopleByBranch() when it finds an IDC-coded employee in mas_hrms payroll — read once
 *  per getCeoOverview() call via idcContaminationFlag(). Module-level because peopleByBranch()'s
 *  Map<branchId, ...> return shape has no room for a scalar company-wide flag, and adding an
 *  IDC-guard call site is cheaper than reshaping every caller of this function's return type. */
let lastIdcContamination: { count: number; amount: number } | null = null;

/**
 * Visibility guard, not a filter — see [[hrms2-pnl-page-architecture-audit]] and the OWN_COMPANY_SQL
 * comment above. `employee_code LIKE 'IDC%'` is a real, existing company signal (the code-sequence
 * generator reserves that prefix), but filtering peopleByBranch() on it the way revenue/spend filter
 * on OWN_COMPANY_SQL would risk the same class of regression that comment already documents for the
 * 368 unmapped-cost-centre employees: a plausible-looking filter that silently drops real MAS wages
 * if the prefix convention is ever misapplied to a MAS employee. Today mas_hrms holds 0 IDC
 * employees (confirmed live, 2026-08-22 — see [[hrms2-idc-payroll-in-dbbill]]), so this is a no-op
 * in practice; its only job is to make it LOUD, not silent, the day that stops being true.
 */
async function idcContaminationCheck(period: string): Promise<void> {
  lastIdcContamination = null;
  if (!(await tableExists("salary_prep_line"))) return;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt,
            SUM(COALESCE(l.gross_salary, 0) + COALESCE(l.pf_employer, 0)
              + COALESCE(l.esic_employer, 0) + COALESCE(l.gratuity, 0)) AS amt
       FROM salary_prep_line l
       JOIN salary_prep_run r ON r.id = l.run_id
       JOIN employees e ON e.id = l.employee_id
      WHERE r.run_month = ? AND e.employee_code LIKE 'IDC%'`,
    [period],
  );
  const count = n(rows[0]?.cnt);
  if (count > 0) lastIdcContamination = { count, amount: n(rows[0]?.amt) };
}

async function peopleByBranch(period: string, s: CeoScope): Promise<Map<string, { cost: number; staff: number }>> {
  const out = new Map<string, { cost: number; staff: number }>();
  if (!(await tableExists("salary_prep_line"))) return out;
  await idcContaminationCheck(period);
  const where: string[] = ["r.run_month = ?"];
  const params: unknown[] = [period];
  if (s.processIds.length) {
    where.push(`e.process_id IN (${marks(s.processIds)})`);
    params.push(...s.processIds);
  }
  if (s.costCentreIds.length) {
    where.push(`e.cost_centre_id IN (${marks(s.costCentreIds)})`);
    params.push(...s.costCentreIds);
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.branch_id AS branch_id,
            COUNT(*) AS staff,
            SUM(COALESCE(l.gross_salary, 0)
              + COALESCE(l.pf_employer, 0)
              + COALESCE(l.esic_employer, 0)
              + COALESCE(l.gratuity, 0)) AS cost
       FROM salary_prep_line l
       JOIN salary_prep_run r ON r.id = l.run_id
       JOIN employees e ON e.id = l.employee_id
      WHERE ${where.join(" AND ")}
      GROUP BY e.branch_id`,
    params,
  );
  for (const r of rows) {
    out.set(r.branch_id ? String(r.branch_id) : "", { cost: n(r.cost), staff: n(r.staff) });
  }
  return out;
}

/**
 * GRN spend by branch. Rejections excluded via RejectDate, never the Reject flag — that flag is
 * 1 on 85,255 of 85,463 source rows and means nothing.
 *
 * RESOLVED 2026-08-29 — was mirror-only, is now app-side-first. This used to read ONLY the
 * db_bill mirror (grn_entry_line_snapshot). That was the whole GRN story when this was written:
 * the app's own grn_cost_allocation had 0 consumed rows in production. It does not any more —
 * confirmed live, real volume concentrated in exactly the months the mirror also covers — and
 * matching by GRN NUMBER (the same physical voucher's own identifier) found 97% of the app's
 * consumed GRNs already present in the mirror under the same number. The exact double-count
 * already found and fixed on the P&L Statement tab (pnl-actuals.service.ts) applies here too, on
 * the CEO's own headline spend figure.
 *
 * Same resolution as that fix, for the same reason: the app's own consumed allocation is the
 * PRIMARY source — it carries pnl_cost_amount (proper non-recoverable-GST treatment) which the
 * mirror's flat l.amount does not — and the mirror UNION only ever contributes a GRN number the
 * app has not captured, via the same NOT EXISTS guard.
 */
async function spendByBranch(period: string, s: CeoScope): Promise<Map<string, number>> {
  const out = new Map<string, number>();

  const appWhere: string[] = ["a.lifecycle_status = 'consumed'", "DATE_FORMAT(gr.bill_date, '%Y-%m') = ?"];
  const appParams: unknown[] = [period];
  if (s.costCentreIds.length) {
    appWhere.push(`ccm.id IN (${marks(s.costCentreIds)})`);
    appParams.push(...s.costCentreIds);
  }
  if (s.processIds.length) {
    appWhere.push(`ccm.id IN (SELECT DISTINCT e.cost_centre_id FROM employees e
                               WHERE e.process_id IN (${marks(s.processIds)}) AND e.cost_centre_id IS NOT NULL)`);
    appParams.push(...s.processIds);
  }
  const [appRows] = await db.execute<RowDataPacket[]>(
    `SELECT ccm.branch_id AS branch_id, SUM(a.pnl_cost_amount) AS amount
       FROM grn_cost_allocation a
       JOIN grn_request gr ON gr.id = a.grn_request_id
       LEFT JOIN cost_centre_master ccm ON ccm.id = a.cost_centre_id
      WHERE ${appWhere.join(" AND ")}
      GROUP BY ccm.branch_id`,
    appParams,
  );
  for (const r of appRows) out.set(r.branch_id ? String(r.branch_id) : "", n(r.amount));

  if (await tableExists("grn_entry_line_snapshot")) {
    const where: string[] = ["g.period_code = ?", "g.is_rejected = 0", OWN_COMPANY_SQL];
    const params: unknown[] = [period];
    if (s.costCentreIds.length) {
      where.push(`ccm.id IN (${marks(s.costCentreIds)})`);
      params.push(...s.costCentreIds);
    }
    if (s.processIds.length) {
      where.push(`ccm.id IN (SELECT DISTINCT e.cost_centre_id FROM employees e
                              WHERE e.process_id IN (${marks(s.processIds)}) AND e.cost_centre_id IS NOT NULL)`);
      params.push(...s.processIds);
    }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ccm.branch_id AS branch_id, SUM(l.amount) AS amount
         FROM grn_entry_line_snapshot l
         JOIN grn_entry_snapshot g ON g.bill_source_id = l.grn_source_id
         LEFT JOIN cost_centre_master ccm
                ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                 = l.cost_centre_code COLLATE utf8mb4_unicode_ci
        WHERE ${where.join(" AND ")}
          AND NOT EXISTS (
                SELECT 1
                  FROM grn_request gr2
                  JOIN grn_cost_allocation a2 ON a2.grn_request_id = gr2.id
                 WHERE gr2.grn_number = g.grn_no
                   AND a2.lifecycle_status = 'consumed'
              )
        GROUP BY ccm.branch_id`,
      params,
    );
    for (const r of rows) {
      const key = r.branch_id ? String(r.branch_id) : "";
      out.set(key, (out.get(key) ?? 0) + n(r.amount));
    }
  }

  return out;
}

/**
 * Budgeted indirect spend by branch.
 *
 * Two traps, both of which inflate the figure silently:
 *   - expense_particular stores the same amount again as a 'Particular' child of its 'CostCenter'
 *     parent, so counting both doubles every budget. Filtered to CostCenter.
 *   - the mirror carries a branch NAME, not an id, and branch_master holds three rows for Head
 *     Office ("HEAD OFFICE" twice plus "Head Office"). Joining on the name counted that branch's
 *     budget three times and reported a Rs 32.51 lakh underspend against a real Rs 11.88 lakh.
 *     Collapsed to one id per distinct name before joining.
 */
/*
 * Active budgets only. `expense_master.Active` is db_bill's fully-approved marker: for FY2026-27
 * it is 1 on exactly the 177 rows carrying all three approvals and 0 on exactly the 367 carrying
 * only the first — the correlation is perfect, so this one predicate says "approved" without
 * needing to test the approval columns as well. Do NOT use EntryStatus for this: it is 1 on 61 of
 * the active rows and on 206 of the inactive ones, so it means something else entirely.
 *
 * Without it this summed all 544 rows — Rs 456.03 L against a real approved budget of Rs 126.03 L,
 * overstating it 3.6x and making every underspend on this screen fiction.
 *
 * is_rejected is a SEPARATE test, not a refinement of Active: 7 of the 18 rejected FY2026-27
 * budgets are still Active = 1, worth Rs 3.97 L. Filtering on Active alone leaves them counted.
 *
 * Top-ups are added on top. expense_reopen_master.AdditionalAmount is sanctioned extra budget
 * carried on the HEADER, so it has no lines of its own and cannot appear in a line-level SUM —
 * it is added once per header below. Rs 42.11 L for FY2026-27, previously missing entirely, so
 * the budget was simultaneously overstated by inactive rows and understated by these.
 *
 * True sanctioned FY2026-27 budget: 126.03 + 42.11 = Rs 168.14 L.
 */
async function budgetByBranch(period: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!(await tableExists("finance_budget_line_snapshot"))) return out;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_id, SUM(amount) AS amount FROM (
        SELECT bm.id AS branch_id, l.amount AS amount
          FROM finance_budget_line_snapshot l
          JOIN finance_budget_snapshot b
            ON b.bill_source_id = l.budget_source_id AND b.period_code = l.period_code
          LEFT JOIN (
                SELECT MIN(id) AS id, UPPER(TRIM(branch_name)) AS nm
                  FROM branch_master GROUP BY UPPER(TRIM(branch_name))
              ) bm ON bm.nm COLLATE utf8mb4_unicode_ci
                    = UPPER(TRIM(b.branch_name)) COLLATE utf8mb4_unicode_ci
         WHERE l.period_code = ? AND l.expense_type = 'CostCenter'
           AND b.active_status = 1 AND b.is_rejected = 0
        UNION ALL
        -- Header-level top-ups: one row per budget, so they cannot be joined through the lines
        -- without multiplying by the line count.
        SELECT bm.id, b.reopen_additional_amount
          FROM finance_budget_snapshot b
          LEFT JOIN (
                SELECT MIN(id) AS id, UPPER(TRIM(branch_name)) AS nm
                  FROM branch_master GROUP BY UPPER(TRIM(branch_name))
              ) bm ON bm.nm COLLATE utf8mb4_unicode_ci
                    = UPPER(TRIM(b.branch_name)) COLLATE utf8mb4_unicode_ci
         WHERE b.period_code = ? AND b.active_status = 1 AND b.is_rejected = 0
           AND b.reopen_additional_amount <> 0
     ) sanctioned
      GROUP BY branch_id`,
    [period, period],
  );
  for (const r of rows) out.set(r.branch_id ? String(r.branch_id) : "", n(r.amount));
  return out;
}

/**
 * Is this month's invoicing finished, or is it still being raised?
 *
 * MAS bills in arrears, and a large part of any month is invoiced during the NEXT one. June 2026's
 * Rs 372.07 lakh was assembled from invoices dated June (Rs 218.32 lakh) plus invoices dated July
 * (Rs 150.08 lakh). So a month read too early is not "a bad month", it is an unfinished one.
 *
 * On 7 August that produced a figure nobody could act on. NOIDA showed Rs 1.31 lakh of revenue for
 * July against Rs 80.36 lakh of payroll and Rs 17.90 lakh of GRN — a Rs 96.9 lakh loss on a branch
 * that had invoiced Rs 127.40 lakh in June and Rs 126.74 lakh in May. One of its seventeen cost
 * centres had billed; the other sixteen simply had not been raised yet.
 *
 * The numbers are NOT adjusted for this — there is nothing to adjust them to, and an estimate on a
 * P&L is worse than an incomplete fact. What is missing is the label, so a reader knows which of
 * the two they are looking at.
 *
 * Measured against the period's own recent history rather than a fixed threshold, so it stays true
 * as the business grows or shrinks.
 */
export interface CeoBillingGap {
  branchName: string;
  /** Mean monthly invoiced revenue over the baseline months in which it billed at all. */
  baselineRevenue: number;
  currentRevenue: number;
}

export interface CeoBillingCompleteness {
  /** Invoice lines mirrored for this period, within the current filters. */
  lines: number;
  /** Mean invoice lines across the three preceding months. 0 when there is no history to compare. */
  baselineLines: number;
  pctOfBaseline: number | null;
  /** True when the period is far enough below its own recent norm to read as still being raised. */
  incomplete: boolean;
  /** Branches that billed steadily in the baseline months and have almost nothing now. */
  gaps: CeoBillingGap[];
}

/** Below this share of its own recent norm, a month is treated as unfinished rather than as a fall
 *  in trading. Set at 80% because the arrears pattern routinely leaves a fifth outstanding. */
const BILLING_COMPLETE_PCT = 80;
/** A branch this far below its own baseline is called out by name. */
const BRANCH_GAP_PCT = 25;
/** Too little history to judge anything — say nothing rather than guess. */
const MIN_BASELINE_LINES = 10;

async function billingCompleteness(
  period: string,
  s: CeoScope,
  branchName: (id: string) => string,
): Promise<CeoBillingCompleteness> {
  const idle: CeoBillingCompleteness = { lines: 0, baselineLines: 0, pctOfBaseline: null, incomplete: false, gaps: [] };
  if (!(await tableExists("billing_invoice_particular_snapshot"))) return idle;

  const [year, month] = period.split("-").map(Number);
  const periods: string[] = [];
  for (let back = 3; back >= 0; back--) {
    const d = new Date(Date.UTC(year, month - 1 - back, 1));
    periods.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }

  // Same joins and company filter as revenueByBranch, so the comparison is against the figures
  // actually on the page rather than against a different slice of the mirror.
  const where: string[] = [`p.period_code IN (${marks(periods)})`, OWN_COMPANY_SQL];
  const params: unknown[] = [...periods];
  if (s.costCentreIds.length) {
    where.push(`ccm.id IN (${marks(s.costCentreIds)})`);
    params.push(...s.costCentreIds);
  }
  if (s.processIds.length) {
    where.push(`ccm.id IN (SELECT DISTINCT e.cost_centre_id FROM employees e
                            WHERE e.process_id IN (${marks(s.processIds)}) AND e.cost_centre_id IS NOT NULL)`);
    params.push(...s.processIds);
  }
  if (s.branchIds.length) {
    where.push(`ccm.branch_id IN (${marks(s.branchIds)})`);
    params.push(...s.branchIds);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT p.period_code AS period_code, ccm.branch_id AS branch_id,
            COUNT(*) AS line_count, SUM(p.amount) AS amount
       FROM billing_invoice_particular_snapshot p
       LEFT JOIN cost_centre_master ccm
              ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
               = p.cost_centre_code COLLATE utf8mb4_unicode_ci
      WHERE ${where.join(" AND ")}
      GROUP BY p.period_code, ccm.branch_id`,
    params,
  );

  const current = periods[periods.length - 1];
  const baselinePeriods = periods.slice(0, -1);
  let lines = 0;
  let baselineLineTotal = 0;
  const monthsWithLines = new Set<string>();
  // branch id -> { current, baseline months that billed }
  const byBranch = new Map<string, { current: number; baseline: number[] }>();

  for (const row of rows) {
    const rowPeriod = String(row.period_code ?? "");
    const count = n(row.line_count);
    const amount = n(row.amount);
    const id = row.branch_id ? String(row.branch_id) : "";
    const entry = byBranch.get(id) ?? { current: 0, baseline: [] };
    if (rowPeriod === current) {
      lines += count;
      entry.current += amount;
    } else if (baselinePeriods.includes(rowPeriod)) {
      baselineLineTotal += count;
      monthsWithLines.add(rowPeriod);
      if (amount > 0) entry.baseline.push(amount);
    }
    byBranch.set(id, entry);
  }

  const baselineMonths = monthsWithLines.size;
  if (baselineMonths === 0) return { ...idle, lines };
  const baselineLines = baselineLineTotal / baselineMonths;
  const pctOfBaseline = baselineLines > 0 ? (lines / baselineLines) * 100 : null;
  const incomplete =
    baselineLines >= MIN_BASELINE_LINES && pctOfBaseline !== null && pctOfBaseline < BILLING_COMPLETE_PCT;

  const gaps: CeoBillingGap[] = [];
  if (incomplete) {
    for (const [id, entry] of byBranch) {
      if (entry.baseline.length === 0) continue;
      const mean = entry.baseline.reduce((t, v) => t + v, 0) / entry.baseline.length;
      if (mean <= 0 || (entry.current / mean) * 100 >= BRANCH_GAP_PCT) continue;
      gaps.push({
        branchName: id ? branchName(id) : "Unmapped cost centres",
        baselineRevenue: mean,
        currentRevenue: entry.current,
      });
    }
    gaps.sort((a, b) => (b.baselineRevenue - b.currentRevenue) - (a.baselineRevenue - a.currentRevenue));
  }

  return { lines, baselineLines, pctOfBaseline, incomplete, gaps };
}

/**
 * Rank where operating profit is recoverable.
 *
 * Deliberately derived from the branch figures rather than hardcoded, so the list changes with the
 * business instead of describing one month forever. Each entry states the evidence and the action,
 * because a finding a CEO cannot act on is decoration.
 */
function findOpportunities(branches: CeoBranchRow[], unbranchedPeople: number): CeoOpportunity[] {
  const found: CeoOpportunity[] = [];
  // A branch flagged "no payroll attributed" is not a valid benchmark — its ratios only look good
  // because a whole cost line is missing. Excluded from every comparison below.
  const trading = branches.filter(
    (b) => !b.isCostCentre && !b.isClosed && b.revenue > 0 && !b.flag,
  );

  // Revenue with nobody posted to it. The margin is not performance, it is an attribution error,
  // and it understates whichever branch is really carrying those people by the same amount.
  for (const b of branches.filter((x) => x.revenue > 0 && x.peopleCost <= 0)) {
    found.push({
      id: `no-payroll-${b.branchName}`,
      severity: "critical",
      value: lakh(b.operatingProfit),
      valueUnit: "per month, overstated",
      title: `${b.branchName} bills ${lakh(b.revenue)} with no payroll attached`,
      detail:
        `It reports a ${b.marginPct?.toFixed(0) ?? "very high"}% margin because not one employee is `
        + `posted to it. Someone is delivering that work and their cost is landing on another `
        + `branch, understating that branch by the same amount.`,
      action: `Find the staff serving ${b.branchName} and correct their branch. Two branch P&Ls are wrong until this is done.`,
    });
  }

  // Staff in the payroll run at zero value: neither a cost nor a saving, just unexplained.
  const dormant = branches.filter((b) => b.staffPaid > 0 && b.peopleCost <= 0 && b.revenue <= 0);
  const dormantHeads = dormant.reduce((total, b) => total + b.staffPaid, 0);
  if (dormantHeads > 0) {
    found.push({
      id: "zero-paid",
      severity: "critical",
      value: String(dormantHeads),
      valueUnit: "people paid nothing",
      title: `${dormant.length} branches carry staff with no salary`,
      detail:
        dormant.map((b) => `${b.branchName} ${b.staffPaid}`).join(", ")
        + ". They appear in the payroll run at zero value, so they cost nothing and produce nothing.",
      action:
        "Either they are unpaid and attendance is missing, or the records are stale. Until that is "
        + "settled neither the headcount nor the cost base can be relied on.",
    });
  }

  // The cost-ratio gap between the best and worst trading branch, priced.
  if (trading.length >= 2) {
    const byRatio = trading.slice().sort((a, b) => a.indirectCost / a.revenue - b.indirectCost / b.revenue);
    const best = byRatio[0];
    const worst = byRatio[byRatio.length - 1];
    const bestRatio = best.indirectCost / best.revenue;
    const worstRatio = worst.indirectCost / worst.revenue;
    if (worstRatio - bestRatio > 0.03) {
      found.push({
        id: "indirect-gap",
        severity: "warning",
        value: lakh(worst.indirectCost - worst.revenue * bestRatio),
        valueUnit: "per month",
        title: `${worst.branchName} spends ${(worstRatio * 100).toFixed(1)}% of revenue on indirect; ${best.branchName} spends ${(bestRatio * 100).toFixed(1)}%`,
        detail:
          `${worst.branchName} carries ${lakh(worst.indirectCost)} of indirect on ${lakh(worst.revenue)} `
          + `of revenue, against ${best.branchName}'s ${lakh(best.indirectCost)} on ${lakh(best.revenue)}.`,
        action: `Bringing ${worst.branchName} to ${best.branchName}'s ratio releases the figure shown. Rent and maintenance are the largest heads to examine.`,
      });
    }

    // Revenue per head, which separates a pricing problem from a cost problem.
    const byHead = trading.filter((b) => b.revenuePerHead !== null)
      .sort((a, b) => (b.revenuePerHead ?? 0) - (a.revenuePerHead ?? 0));
    if (byHead.length >= 2) {
      const top = byHead[0];
      const bottom = byHead[byHead.length - 1];
      const gap = (top.marginPct ?? 0) - (bottom.marginPct ?? 0);
      if (gap > 5) {
        found.push({
          id: "margin-gap",
          severity: "warning",
          value: `${gap.toFixed(1)} pts`,
          valueUnit: "margin gap",
          title: `${bottom.branchName} runs at ${bottom.marginPct?.toFixed(1)}% against ${top.branchName}'s ${top.marginPct?.toFixed(1)}%`,
          detail:
            `${bottom.staffPaid} staff producing ${lakh(bottom.revenue)} — `
            + `Rs ${((bottom.revenuePerHead ?? 0) / 1000).toFixed(1)}k revenue per head against `
            + `${top.branchName}'s Rs ${((top.revenuePerHead ?? 0) / 1000).toFixed(1)}k. `
            + `The gap is revenue per person, not cost control.`,
          action:
            "Either the billing rate is below market for this work, or the process is over-staffed "
            + `for its volume. Closing half the gap is about ${lakh(bottom.revenue * (gap / 200))} a month.`,
        });
      }
    }
  }

  // A closed branch still spending.
  for (const b of branches.filter((x) => x.isClosed && x.indirectCost > 0)) {
    found.push({
      id: `closed-spend-${b.branchName}`,
      severity: "warning",
      value: lakh(b.indirectCost),
      valueUnit: "still spent",
      title: `${b.branchName} is closed but still spent this month`,
      detail: "No revenue and no staff since closure, yet indirect cost is still landing against it.",
      action: "Confirm no further commitments remain. Whatever stops becomes a run-rate saving.",
    });
  }

  // Payroll that reaches no branch at all.
  if (unbranchedPeople > 0) {
    found.push({
      id: "no-branch",
      severity: "warning",
      value: String(unbranchedPeople),
      valueUnit: "people, no branch",
      title: "Paid employees carry no branch",
      detail:
        "Their cost cannot be attributed to any branch column, so every branch margin is slightly "
        + "overstated while the company total stays correct.",
      action: "Set a branch on these employee records; no code change is involved.",
    });
  }

  // Budget underspend, offered as a question rather than a win.
  const budgeted = branches.reduce((t, b) => t + b.budget, 0);
  const spent = branches.reduce((t, b) => t + b.indirectCost, 0);
  if (budgeted > 0 && budgeted - spent > 0) {
    found.push({
      id: "under-budget",
      severity: "settled",
      value: lakh(budgeted - spent),
      valueUnit: "under budget",
      title: "Indirect spend came in below budget",
      detail: `${lakh(budgeted)} budgeted across branches, ${lakh(spent)} actually raised.`,
      action: "Confirm this is genuine saving rather than invoices deferred into next month.",
    });
  }

  const rank = { critical: 0, warning: 1, settled: 2 };
  return found.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/**
 * Four months of margin for the sparkline, in three aggregate queries rather than four full
 * overview passes — the trend is a shape, not a drill-down, and paying 1.7s per point for it
 * would make the page slower than the engine it replaced.
 */
async function marginTrend(endPeriod: string, s: CeoScope): Promise<CeoTrendPoint[]> {
  const [year, month] = endPeriod.split("-").map(Number);
  const periods: string[] = [];
  for (let back = 3; back >= 0; back--) {
    const d = new Date(Date.UTC(year, month - 1 - back, 1));
    periods.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  /*
   * All four months at once, not one after another.
   *
   * Written as a sequential loop first, which cost 8.5-11.3s on production: four round trips of
   * three queries each, every one waiting on the last for no reason — the months are independent.
   * Issuing them together brings the page back to roughly the cost of a single month.
   */
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  return Promise.all(
    periods.map(async (period) => {
      const [rev, ppl, spend] = await Promise.all([
        revenueByBranch(period, s), peopleByBranch(period, s), spendByBranch(period, s),
      ]);
      const revenue = sum(rev);
      const people = [...ppl.values()].reduce((a, b) => a + b.cost, 0);
      const operatingProfit = revenue - people - sum(spend);
      return {
        period, revenue, operatingProfit,
        marginPct: revenue > 0 ? (operatingProfit / revenue) * 100 : null,
      };
    }),
  );
}

/**
 * Only offer a filter value that has data behind it — an option that returns an empty page is
 * indistinguishable from a broken one.
 *
 * Takes `scope` for two reasons that were both missing before this fix: (1) an inactive cost
 * centre stayed offered forever, since this query never checked `active_status` at all (the
 * process query already did); (2) selecting a branch anywhere else on this page never narrowed
 * either dropdown, because this was the one query beside `revenueByBranch`/`peopleByBranch`/
 * `spendByBranch`/`marginTrend` that was called without the caller's own `scope` object — every
 * sibling query already receives it, this one was simply left out.
 */
async function filterOptions(period: string, scope: CeoScope) {
  // Guard: tables may not exist if mirrors haven't synced yet for this period
  const [hasSalaryPrep, hasInvoice] = await Promise.all([
    tableExists("salary_prep_line"),
    tableExists("billing_invoice_particular_snapshot"),
  ]);

  // Empty when no branch is selected, so an unfiltered request still offers every active
  // process/cost centre exactly as before — only a real branch selection narrows either list.
  const processBranchCondition = scope.branchIds.length
    ? `AND pm.branch_id IN (${marks(scope.branchIds)})`
    : "";
  const processes = hasSalaryPrep
    ? (await db.execute<RowDataPacket[]>(
        `SELECT DISTINCT pm.id AS id, pm.process_name AS name
           FROM salary_prep_line l
           JOIN salary_prep_run r ON r.id = l.run_id AND r.run_month = ?
           JOIN employees e ON e.id = l.employee_id
           JOIN process_master pm ON pm.id = e.process_id
          WHERE pm.active_status = 1
          ${processBranchCondition}
          ORDER BY pm.process_name`,
        [period, ...scope.branchIds],
      ))[0]
    : [];

  const costCentreBranchCondition = scope.branchIds.length
    ? `AND ccm.branch_id IN (${marks(scope.branchIds)})`
    : "";
  const costCentres = hasInvoice
    ? (await db.execute<RowDataPacket[]>(
        `SELECT DISTINCT ccm.id AS id, ccm.cost_centre_code AS code
           FROM billing_invoice_particular_snapshot p
           JOIN cost_centre_master ccm
             ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
              = p.cost_centre_code COLLATE utf8mb4_unicode_ci
          WHERE p.period_code = ?
            AND ccm.active_status = 1
          ${costCentreBranchCondition}
          ORDER BY ccm.cost_centre_code`,
        [period, ...scope.branchIds],
      ))[0]
    : [];

  return {
    processes: processes.map((r: RowDataPacket) => ({ id: String(r.id), name: String(r.name) })),
    costCentres: costCentres.map((r: RowDataPacket) => ({ id: String(r.id), code: String(r.code) })),
  };
}

/**
 * The P&L for the one process or cost centre a filter has narrowed to, with its caveats.
 *
 * The caveats are the point. Onfido's June margin of 37% is real, but its indirect line is the
 * whole NOIDA-2 branch GRN booked against a single cost centre — so the figure is a contribution,
 * not a standalone P&L, and a reader has no way to know that from the number itself. Every note
 * below is derived from the data rather than written in, so it stays true as the mapping improves.
 */
async function buildFocus(
  period: string,
  s: CeoScope,
  totals: { revenue: number; peopleCost: number; indirectCost: number; staffPaid: number },
): Promise<CeoFocus | null> {
  /*
   * Only for a selection of exactly one. The panel below is a single entity's P&L with its own
   * caveats attached — "the indirect figure is really the whole branch's overhead" is a statement
   * about one cost centre. Under a multi-select of four processes the same panel would carry one
   * label and four entities' worth of arithmetic, which reads as a fact about the first of them.
   */
  const processId = s.processIds.length === 1 ? s.processIds[0] : null;
  const costCentreId = s.costCentreIds.length === 1 ? s.costCentreIds[0] : null;
  if (!processId && !costCentreId) return null;

  const notes: string[] = [];
  let label = "";
  let kind: "process" | "cost_centre" = processId ? "process" : "cost_centre";
  let invoiceLines = 0;
  let staffZeroPaid = 0;
  let budget = 0;

  if (processId) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT process_name FROM process_master WHERE id = ? LIMIT 1`, [processId],
    );
    label = rows[0]?.process_name ? String(rows[0].process_name) : "Process";
    const [paid] = await db.execute<RowDataPacket[]>(
      `SELECT SUM(CASE WHEN COALESCE(l.gross_salary, 0) = 0 THEN 1 ELSE 0 END) AS zero_paid
         FROM salary_prep_line l
         JOIN salary_prep_run r ON r.id = l.run_id AND r.run_month = ?
         JOIN employees e ON e.id = l.employee_id
        WHERE e.process_id = ?`,
      [period, processId],
    );
    staffZeroPaid = n(paid[0]?.zero_paid);
  } else if (costCentreId) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cost_centre_code FROM cost_centre_master WHERE id = ? LIMIT 1`, [costCentreId],
    );
    label = rows[0]?.cost_centre_code ? String(rows[0].cost_centre_code) : "Cost centre";
  }

  // Invoice lines and budget both key on the cost centre CODE, so resolve the codes in scope once.
  const [codes] = await db.execute<RowDataPacket[]>(
    costCentreId
      ? `SELECT cost_centre_code AS code, branch_id FROM cost_centre_master WHERE id = ?`
      : `SELECT DISTINCT ccm.cost_centre_code AS code, ccm.branch_id AS branch_id
           FROM employees e JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
          WHERE e.process_id = ?`,
    [costCentreId ?? processId],
  );
  const codeList = codes.map((r) => String(r.code)).filter(Boolean);

  if (codeList.length > 0) {
    const codeMarks = marks(codeList);

    // Guard: snapshot tables may not exist for this period
    const [hasInvoiceSnap, hasBudgetSnap, hasGrnSnap] = await Promise.all([
      tableExists("billing_invoice_particular_snapshot"),
      tableExists("finance_budget_line_snapshot"),
      tableExists("grn_entry_line_snapshot"),
    ]);

    if (hasInvoiceSnap) {
      const [inv] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM billing_invoice_particular_snapshot
          WHERE period_code = ? AND cost_centre_code IN (${codeMarks})`,
        [period, ...codeList],
      );
      invoiceLines = n(inv[0]?.n);
    }

    // Approved budgets only — see budgetByBranch. Summing every mirrored row counts 367 rows
    // that never got past the first approval.
    if (hasBudgetSnap) {
      const [bud] = await db.execute<RowDataPacket[]>(
        `SELECT COALESCE(SUM(l.amount), 0) AS a
           FROM finance_budget_line_snapshot l
           JOIN finance_budget_snapshot b
             ON b.bill_source_id = l.budget_source_id AND b.period_code = l.period_code
          WHERE l.period_code = ? AND l.expense_type = 'CostCenter'
            AND l.expense_type_name IN (${codeMarks})
            AND b.active_status = 1 AND b.is_rejected = 0`,
        [period, ...codeList],
      );
      budget = n(bud[0]?.a);
    }

    // Does this cost centre carry its whole branch's overhead? If so the margin is a contribution,
    // not a standalone P&L, and saying so is the difference between a usable figure and a wrong one.
    const branchId = codes[0]?.branch_id ? String(codes[0].branch_id) : null;
    if (branchId && totals.indirectCost > 0 && hasGrnSnap) {
      // `totals.indirectCost` (the figure this branchTotal is compared against, two lines below)
      // is built from spendByBranch(), fixed 2026-08-29 to be app-side-first with the mirror only
      // filling gaps. This comparison query was still mirror-only — comparing an already
      // de-duplicated figure against a doubled one would have thrown the 95% "is this really the
      // whole branch's overhead" heuristic off by roughly 2x on any branch with real Smart GRN
      // activity. Same fix, same reason: see spendByBranch()'s own banner.
      const [appGrn] = await db.execute<RowDataPacket[]>(
        `SELECT COALESCE(SUM(a.pnl_cost_amount), 0) AS a
           FROM grn_cost_allocation a
           JOIN grn_request gr ON gr.id = a.grn_request_id
           LEFT JOIN cost_centre_master ccm ON ccm.id = a.cost_centre_id
          WHERE a.lifecycle_status = 'consumed'
            AND DATE_FORMAT(gr.bill_date, '%Y-%m') = ?
            AND ccm.branch_id = ?`,
        [period, branchId],
      );
      const [branchGrn] = await db.execute<RowDataPacket[]>(
        `SELECT COALESCE(SUM(l.amount), 0) AS a
           FROM grn_entry_line_snapshot l
           JOIN grn_entry_snapshot g ON g.bill_source_id = l.grn_source_id
           LEFT JOIN cost_centre_master ccm
                  ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                   = l.cost_centre_code COLLATE utf8mb4_unicode_ci
          WHERE g.period_code = ? AND g.is_rejected = 0 AND ccm.branch_id = ?
            AND NOT EXISTS (
                  SELECT 1
                    FROM grn_request gr2
                    JOIN grn_cost_allocation a2 ON a2.grn_request_id = gr2.id
                   WHERE gr2.grn_number = g.grn_no
                     AND a2.lifecycle_status = 'consumed'
                )`,
        [period, branchId],
      );
      const branchTotal = n(appGrn[0]?.a) + n(branchGrn[0]?.a);
      if (branchTotal > 0 && totals.indirectCost / branchTotal >= 0.95) {
        notes.push(
          `The indirect figure is effectively the whole branch's overhead (${lakh(branchTotal)}) `
          + `booked to this cost centre, not what it alone consumes. Treat the margin as a `
          + `contribution: the standalone figure would be higher.`,
        );
      }
    }
  }

  if (staffZeroPaid > 0) {
    notes.push(`${staffZeroPaid} of ${totals.staffPaid + staffZeroPaid} payroll lines were paid nothing, so the people cost covers the rest.`);
  }
  if (totals.revenue > 0 && totals.peopleCost <= 0) {
    notes.push("Revenue is billed here but no payroll is attributed, so the margin is an attribution error rather than performance.");
  }
  if (totals.revenue <= 0 && totals.peopleCost > 0) {
    notes.push("People are paid here but no invoice maps to it, so this shows cost without the revenue it earned.");
  }

  const operatingProfit = totals.revenue - totals.peopleCost - totals.indirectCost;
  return {
    kind, label,
    revenue: totals.revenue,
    invoiceLines,
    peopleCost: totals.peopleCost,
    staffPaid: totals.staffPaid,
    staffZeroPaid,
    indirectCost: totals.indirectCost,
    budget,
    operatingProfit,
    marginPct: totals.revenue > 0 ? (operatingProfit / totals.revenue) * 100 : null,
    revenuePerHead: totals.staffPaid > 0 ? totals.revenue / totals.staffPaid : null,
    costPerHead: totals.staffPaid > 0 ? totals.peopleCost / totals.staffPaid : null,
    notes,
  };
}

export async function getCeoOverview(period: string, filters: CeoFilters = {}): Promise<CeoOverview> {
  const scope = scopeOf(filters);
  const selectedBranches = new Set(scope.branchIds);
  const empty: CeoOverview = {
    period, revenue: 0, peopleCost: 0, indirectCost: 0, operatingProfit: 0,
    marginPct: null, staffPaid: 0, revenuePerHead: null, branches: [], opportunities: [],
    trend: [], options: { processes: [], costCentres: [], branches: [] }, focus: null,
    billing: { lines: 0, baselineLines: 0, pctOfBaseline: null, incomplete: false, gaps: [] },
    closedBranchesHidden: [],
    exceptions: [],
  };
  if (!/^\d{4}-\d{2}$/.test(period)) return empty;

  const [branchRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_name, active_status FROM branch_master`,
  );
  const nameOfBranch = (id: string) =>
    String(branchRows.find((r) => String(r.id) === id)?.branch_name ?? "Unnamed");
  const [revenue, people, spend, budget, trend, options, billing] = await Promise.all([
    revenueByBranch(period, scope), peopleByBranch(period, scope),
    spendByBranch(period, scope), budgetByBranch(period),
    marginTrend(period, scope), filterOptions(period, scope),
    billingCompleteness(period, scope, nameOfBranch),
  ]);

  /*
   * branch_master holds duplicates — three rows spell Head Office three ways — and each carries
   * its own slice of the staff. Left alone the overview listed Head Office twice, once as a cost
   * centre and once as closed, and double-counted its headcount. Merged on the normalised name,
   * keeping the first id seen.
   */
  const merged = new Map<string, { id: string; name: string; active: boolean }>();
  for (const row of branchRows) {
    const key = String(row.branch_name ?? "").trim().toUpperCase();
    const existing = merged.get(key);
    if (existing) {
      // Any active spelling makes the branch active.
      existing.active = existing.active || Number(row.active_status) === 1;
      continue;
    }
    merged.set(key, {
      id: String(row.id),
      name: String(row.branch_name ?? "Unnamed"),
      active: Number(row.active_status) === 1,
    });
  }

  /*
   * Every branch that traded this month, built BEFORE the selection is applied.
   *
   * The branch dropdown is fed from this list, so it keeps offering the other branches once one is
   * ticked. Deriving the options from the filtered rows instead makes the control a trap: select
   * NOIDA and NOIDA is the only remaining option, so there is no way to add NOIDA-2 without
   * clearing the filter first.
   */
  const traded: { row: CeoBranchRow; ids: string[]; hiddenAsClosed: boolean }[] = [];
  for (const [, entry] of merged) {
    const id = entry.id;
    // Sum across every duplicate id that shares this name, or the merge would drop their figures.
    const ids = branchRows
      .filter((r) => String(r.branch_name ?? "").trim().toUpperCase() === entry.name.trim().toUpperCase())
      .map((r) => String(r.id));
    const rev = ids.reduce((t, i) => t + (revenue.get(i) ?? 0), 0);
    const pay = ids.reduce(
      (t, i) => {
        const p = people.get(i);
        return p ? { cost: t.cost + p.cost, staff: t.staff + p.staff } : t;
      },
      { cost: 0, staff: 0 },
    );
    const idc = ids.reduce((t, i) => t + (spend.get(i) ?? 0), 0);
    if (rev === 0 && pay.staff === 0 && idc === 0) continue;   // nothing happened here this month

    const isClosed = !entry.active;
    /*
     * A closed branch with nothing but headcount is not a P&L row.
     *
     * branch_master holds 45 branches and only 5 are active. Nine of the closed ones survived the
     * test above in July 2026 — KARNAL, Delhi Office, MOHALI, AHEMDABAD HOUSE, MEERUT, HYDERABAD,
     * JAIPUR and both Head Office duplicates — carrying 234 people between them and Rs 0 in every
     * money column. They contributed nothing to any total and nothing to any comparison; they
     * lengthened the table and filled the branch dropdown with places that closed.
     *
     * A closed branch that is still SPENDING stays, because that is a finding — findOpportunities
     * raises it by name. Only the all-zero rows go, and they are reported in closedBranchesHidden
     * so the 234 heads are visibly set aside rather than quietly dropped.
     *
     * The row is still built and still handed to findOpportunities via `allRows` below. Dropping it
     * from that too would have deleted the "N branches carry staff with no salary" finding, which
     * is the one place those 234 people are accounted for — hiding a row from a table and hiding it
     * from the analysis are different decisions, and only the first was asked for.
     */
    const hiddenAsClosed = isClosed && rev === 0 && pay.cost === 0 && idc === 0;
    // A branch that pays people and raises spend but bills no client is a cost centre, not a
    // failing business — reporting a negative margin for Head Office would be nonsense.
    const isCostCentre = !isClosed && rev < pay.cost * 0.2;
    const op = rev - pay.cost - idc;
    const row: CeoBranchRow = {
      branchId: id,
      branchName: entry.name,
      revenue: rev,
      peopleCost: pay.cost,
      staffPaid: pay.staff,
      indirectCost: idc,
      budget: ids.reduce((t, i) => t + (budget.get(i) ?? 0), 0),
      operatingProfit: op,
      marginPct: rev > 0 && !isCostCentre && !isClosed ? (op / rev) * 100 : null,
      revenuePerHead: pay.staff > 0 ? rev / pay.staff : null,
      flag: rev > 0 && pay.cost <= 0 ? "no payroll attributed" : null,
      isCostCentre,
      isClosed,
    };
    traded.push({ row, ids, hiddenAsClosed });
  }

  // A multi-select matches on ANY of the duplicate spellings: the id a user picks is whichever one
  // the dropdown offered, and the others are the same branch under a different spelling.
  const selected = selectedBranches.size === 0
    ? traded
    : traded.filter((t) => t.ids.some((i) => selectedBranches.has(i)));

  /** Every selected row, INCLUDING the closed all-zero ones the table hides. */
  const allRows = selected.map((t) => t.row);
  const branches = selected.filter((t) => !t.hiddenAsClosed).map((t) => t.row);
  const closedBranchesHidden = selected
    .filter((t) => t.hiddenAsClosed)
    .map((t) => ({ branchName: t.row.branchName, staffPaid: t.row.staffPaid }));

  branches.sort((a, b) => b.operatingProfit - a.operatingProfit);

  /*
   * From allRows, not `branches`. The closed all-zero rows are hidden from the TABLE; they are
   * still 234 people in this month's payroll run, and dropping them from the company headcount
   * would mean the same page reported a different number of staff before and after a cosmetic
   * filter. Their money columns are zero by definition, so no financial total moves.
   */
  const totals = allRows.reduce(
    (acc, b) => ({
      revenue: acc.revenue + b.revenue,
      peopleCost: acc.peopleCost + b.peopleCost,
      indirectCost: acc.indirectCost + b.indirectCost,
      staffPaid: acc.staffPaid + b.staffPaid,
    }),
    { revenue: 0, peopleCost: 0, indirectCost: 0, staffPaid: 0 },
  );
  const operatingProfit = totals.revenue - totals.peopleCost - totals.indirectCost;
  const unbranched = people.get("")?.staff ?? 0;

  return {
    period,
    ...totals,
    operatingProfit,
    marginPct: totals.revenue > 0 ? (operatingProfit / totals.revenue) * 100 : null,
    revenuePerHead: totals.staffPaid > 0 ? totals.revenue / totals.staffPaid : null,
    branches,
    closedBranchesHidden,
    billing,
    // A narrowed view compares nothing against nothing, and a branch-scoped user must not be shown
    // findings computed across branches they cannot see.
    opportunities: scope.branchIds.length || scope.processIds.length || scope.costCentreIds.length
      ? []
      : findOpportunities(allRows, unbranched),
    /*
     * The trend sums its source maps directly, while the headline is built from the branch rows —
     * which drop any branch where nothing happened at all. That left the last bar reading 18.1%
     * beside a headline of 17.8%: the same figure, on the same card, twice. The current month is
     * replaced with the headline so the two can never disagree.
     */
    focus: await buildFocus(period, scope, {
      revenue: totals.revenue,
      peopleCost: totals.peopleCost,
      indirectCost: totals.indirectCost,
      staffPaid: totals.staffPaid,
    }),
    trend: trend.map((point) =>
      point.period === period
        ? { ...point, revenue: totals.revenue, operatingProfit, marginPct: totals.revenue > 0 ? (operatingProfit / totals.revenue) * 100 : null }
        : point,
    ),
    options: {
      ...options,
      // Closed all-zero branches are excluded here too: an option that resolves to a hidden row
      // would select nothing and read as a broken filter.
      branches: traded
        .filter((t) => !t.hiddenAsClosed)
        .map((t) => ({ id: t.row.branchId ?? "", name: t.row.branchName }))
        .filter((b) => b.id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
    exceptions: lastIdcContamination
      ? [{
          code: "PAYROLL_IDC_CODE_IN_MAS_HRMS",
          label: "IDC-coded payroll present in MAS Callnet's own P&L",
          count: lastIdcContamination.count,
          amount: lastIdcContamination.amount,
        }]
      : [],
  };
}

export interface CeoYtdSummary {
  fy: string;
  months: string[];
  totalRevenue: number;
  totalPeopleCost: number;
  totalIndirectCost: number;
  totalOperatingProfit: number;
  totalBudget: number;
  marginPct: number | null;
  monthly: Array<{ period: string; revenue: number; peopleCost: number; indirectCost: number; operatingProfit: number; budget: number }>;
}

export async function getYtdSummary(upToMonth: string, filters: CeoFilters = {}): Promise<CeoYtdSummary> {
  // Indian financial year: April (month 4) to March (month 3)
  const [y, m] = upToMonth.split("-").map(Number);
  const fyStartYear = m >= 4 ? y : y - 1;
  const fyStart = `${fyStartYear}-04`;

  const months: string[] = [];
  let cursor = fyStart;
  while (cursor <= upToMonth) {
    months.push(cursor);
    const [cy, cm] = cursor.split("-").map(Number);
    const next = cm === 12 ? `${cy + 1}-01` : `${cy}-${String(cm + 1).padStart(2, "0")}`;
    cursor = next;
  }

  const monthly: CeoYtdSummary["monthly"] = [];
  let totalRevenue = 0, totalPeopleCost = 0, totalIndirectCost = 0, totalBudget = 0, totalOp = 0;

  await Promise.all(
    months.map(async (period) => {
      const [overview, budgetMap] = await Promise.all([
        getCeoOverview(period, filters),
        budgetByBranch(period),
      ]);
      const budget = Array.from(budgetMap.values()).reduce((s, v) => s + v, 0);
      monthly.push({ period, revenue: overview.revenue, peopleCost: overview.peopleCost, indirectCost: overview.indirectCost, operatingProfit: overview.operatingProfit, budget });
    })
  );

  monthly.sort((a, b) => a.period.localeCompare(b.period));
  for (const m of monthly) {
    totalRevenue += m.revenue;
    totalPeopleCost += m.peopleCost;
    totalIndirectCost += m.indirectCost;
    totalBudget += m.budget;
    totalOp += m.operatingProfit;
  }
  const totalOperatingProfit = totalOp;

  return {
    fy: `${fyStartYear}-${fyStartYear + 1}`,
    months,
    totalRevenue,
    totalPeopleCost,
    totalIndirectCost,
    totalOperatingProfit,
    totalBudget,
    marginPct: totalRevenue > 0 ? (totalOperatingProfit / totalRevenue) * 100 : null,
    monthly,
  };
}

export const ceoOverviewService = { getCeoOverview, getYtdSummary };
