import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";
import { assertNotFuturePeriod } from "./pnl-period-guard.js";

/**
 * The row-level detail behind every clickable P&L cell — "what actually makes up this number".
 *
 * CORRECTNESS DESIGN NOTE. The ideal is that a drilldown's total ties to its summary cell BY
 * CONSTRUCTION (the summary literally sums these same rows). For people cost and GRN spend that
 * refactor is safe and done here — peopleByBranch()/spendByBranch() in ceo-overview.service.ts
 * are simple single-purpose queries. Revenue is not: revenueByBranch() is a multi-source UNION
 * (invoice lines, a provision-shortfall fallback, credit notes) with COLLATE joins and a
 * GREATEST(provision - invoice, 0) rule to avoid double-counting — algebraically inlining that
 * into a row-returning function is a materially bigger, riskier rewrite of a live revenue
 * function than this fix warrants. Instead, revenueDrilldownRows() below is built from the
 * IDENTICAL WHERE-clause predicates as revenueByBranch() (same OWN_COMPANY_SQL, same period/
 * branch/process scoping), just ungrouped — and verify-pnl-reconciliation.ts's Section D
 * empirically checks drilldown-sum === summary-cell for a real branch/period before this is
 * trusted, rather than asserting it can never diverge by construction. Documented, not hidden.
 */

const n = (v: unknown): number => {
  const p = Number(v ?? 0);
  return Number.isFinite(p) ? p : 0;
};

export interface DrilldownRow {
  id: string;
  label: string;
  detail: string | null;
  amount: number;
  date: string | null;
}

export interface PnlDrilldownResult {
  metric: string;
  scope: Record<string, string | undefined>;
  rows: DrilldownRow[];
  total: number;
  /** True when the underlying source could only be matched by a looser/synthetic rule (e.g. a
   *  provision estimate standing in for an invoice not yet raised) — surfaced so the UI can label
   *  it, not hide it. */
  hasEstimatedRows: boolean;
}

export type PnlDrilldownQuery =
  | { metric: "revenue"; period: string; branchId: string }
  | { metric: "people"; period: string; branchId: string }
  | { metric: "indirect"; period: string; branchId: string }
  | { metric: "budget"; period: string; branchId: string };

const OWN_COMPANY_SQL = `REPLACE(REPLACE(REPLACE(LOWER(COALESCE(ccm.company_name, '')), '.', ''), ' ', ''), ',', '') LIKE '%mascallnet%'`;

async function revenueDrilldownRows(period: string, branchId: string): Promise<PnlDrilldownResult> {
  const rows: DrilldownRow[] = [];
  let hasEstimatedRows = false;
  if (await tableExists("billing_invoice_particular_snapshot")) {
    const [invoiceRows] = await db.execute<RowDataPacket[]>(
      `SELECT p.bill_source_id, p.cost_centre_code, ccm.cost_centre_name, p.particulars, p.service,
              p.amount, p.source_created_at
         FROM billing_invoice_particular_snapshot p
         LEFT JOIN cost_centre_master ccm
                ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci = p.cost_centre_code COLLATE utf8mb4_unicode_ci
        WHERE p.period_code = ? AND ccm.branch_id = ? AND ${OWN_COMPANY_SQL}
        ORDER BY p.amount DESC`,
      [period, branchId],
    );
    for (const r of invoiceRows) {
      rows.push({
        id: `inv-${r.bill_source_id}`,
        label: r.cost_centre_name ? String(r.cost_centre_name) : String(r.cost_centre_code ?? ""),
        detail: [r.service, r.particulars].filter(Boolean).join(" — ") || null,
        amount: n(r.amount),
        date: r.source_created_at ? String(r.source_created_at) : null,
      });
    }
    if (await tableExists("billing_credit_note_snapshot")) {
      const [creditRows] = await db.execute<RowDataPacket[]>(
        `SELECT cn.bill_source_id, cn.credit_no, cn.cost_centre_code, ccm.cost_centre_name, cn.total_amt, cn.credit_date, cn.description
           FROM billing_credit_note_snapshot cn
           LEFT JOIN cost_centre_master ccm
                  ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci = cn.cost_centre_code COLLATE utf8mb4_unicode_ci
          WHERE cn.period_code = ? AND cn.is_approved = 1 AND ccm.branch_id = ? AND ${OWN_COMPANY_SQL}`,
        [period, branchId],
      );
      for (const r of creditRows) {
        rows.push({
          id: `credit-${r.bill_source_id}-${r.credit_no}`,
          label: r.cost_centre_name ? String(r.cost_centre_name) : String(r.cost_centre_code ?? ""),
          detail: `Credit note${r.description ? `: ${r.description}` : ""}`,
          amount: -n(r.total_amt),
          date: r.credit_date ? String(r.credit_date) : null,
        });
      }
    }
    // Provision-shortfall fallback — same GREATEST(provision - invoice, 0) rule as
    // revenueByBranch(), only for cost centres this branch has that raised NO invoice line this
    // period (mirroring revenueByBranch()'s own "SOURCE A empty" condition).
    if (await tableExists("billing_provision_snapshot")) {
      const [provisionRows] = await db.execute<RowDataPacket[]>(
        `SELECT ps.cost_centre_code, ccm.cost_centre_name,
                SUM(CASE WHEN ps.billing_amt > 0 THEN ps.billing_amt ELSE ps.provision_amt END) AS provision_amount
           FROM billing_provision_snapshot ps
           LEFT JOIN cost_centre_master ccm
                  ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci = ps.cost_centre_code COLLATE utf8mb4_unicode_ci
          WHERE ps.period_code = ? AND ps.revenue_active = 1 AND ccm.branch_id = ? AND ${OWN_COMPANY_SQL}
            AND ps.cost_centre_code COLLATE utf8mb4_unicode_ci NOT IN (
                  SELECT p.cost_centre_code COLLATE utf8mb4_unicode_ci
                    FROM billing_invoice_particular_snapshot p WHERE p.period_code = ?
                )
          GROUP BY ps.cost_centre_code, ccm.cost_centre_name
         HAVING provision_amount > 0`,
        [period, branchId, period],
      );
      for (const r of provisionRows) {
        hasEstimatedRows = true;
        rows.push({
          id: `prov-${r.cost_centre_code}`,
          label: r.cost_centre_name ? String(r.cost_centre_name) : String(r.cost_centre_code ?? ""),
          detail: "Provision estimate — invoice not yet raised this period",
          amount: n(r.provision_amount),
          date: null,
        });
      }
    }
  }
  rows.sort((a, b) => b.amount - a.amount);
  return { metric: "revenue", scope: { period, branchId }, rows, total: rows.reduce((s, r) => s + r.amount, 0), hasEstimatedRows };
}

async function peopleDrilldownRows(period: string, branchId: string): Promise<PnlDrilldownResult> {
  const rows: DrilldownRow[] = [];
  if (await tableExists("salary_prep_line")) {
    const [lineRows] = await db.execute<RowDataPacket[]>(
      `SELECT l.id, e.employee_code, e.full_name, e.cost_center_code,
              (COALESCE(l.gross_salary,0)+COALESCE(l.pf_employer,0)+COALESCE(l.esic_employer,0)+COALESCE(l.gratuity,0)) AS amount
         FROM salary_prep_line l
         JOIN salary_prep_run r ON r.id = l.run_id
         JOIN employees e ON e.id = l.employee_id
        WHERE r.run_month = ? AND e.branch_id = ?
        ORDER BY amount DESC`,
      [period, branchId],
    );
    for (const r of lineRows) {
      rows.push({
        id: `sal-${r.id}`,
        label: r.full_name ? String(r.full_name) : String(r.employee_code ?? "Unnamed"),
        detail: [r.employee_code, r.cost_center_code].filter(Boolean).join(" · ") || null,
        amount: n(r.amount),
        date: null,
      });
    }
  }
  return { metric: "people", scope: { period, branchId }, rows, total: rows.reduce((s, r) => s + r.amount, 0), hasEstimatedRows: false };
}

async function indirectDrilldownRows(period: string, branchId: string): Promise<PnlDrilldownResult> {
  const rows: DrilldownRow[] = [];
  if (await tableExists("grn_entry_line_snapshot")) {
    const [lineRows] = await db.execute<RowDataPacket[]>(
      `SELECT l.bill_source_id, l.particular, l.entry_type, l.total, l.cost_centre_code, ccm.cost_centre_name
         FROM grn_entry_line_snapshot l
         JOIN grn_entry_snapshot g ON g.bill_source_id = l.grn_source_id
         LEFT JOIN cost_centre_master ccm
                ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci = l.cost_centre_code COLLATE utf8mb4_unicode_ci
        WHERE g.period_code = ? AND g.is_rejected = 0 AND ccm.branch_id = ? AND ${OWN_COMPANY_SQL}
        ORDER BY l.total DESC`,
      [period, branchId],
    );
    for (const r of lineRows) {
      rows.push({
        id: `grn-${r.bill_source_id}`,
        label: r.particular ? String(r.particular) : (r.cost_centre_name ? String(r.cost_centre_name) : "GRN line"),
        detail: [r.entry_type, r.cost_centre_name].filter(Boolean).join(" · ") || null,
        amount: n(r.total),
        date: null,
      });
    }
  }
  return { metric: "indirect", scope: { period, branchId }, rows, total: rows.reduce((s, r) => s + r.amount, 0), hasEstimatedRows: false };
}

async function budgetDrilldownRows(period: string, branchId: string): Promise<PnlDrilldownResult> {
  const rows: DrilldownRow[] = [];
  if (await tableExists("finance_budget_line_snapshot")) {
    const [lineRows] = await db.execute<RowDataPacket[]>(
      `SELECT l.bill_source_id, l.expense_type_name, l.amount, b.branch_name
         FROM finance_budget_line_snapshot l
         JOIN finance_budget_snapshot b
           ON b.bill_source_id = l.budget_source_id AND b.period_code = l.period_code
         LEFT JOIN (SELECT MIN(id) AS id, UPPER(TRIM(branch_name)) AS nm FROM branch_master GROUP BY UPPER(TRIM(branch_name))) bm
                ON bm.nm COLLATE utf8mb4_unicode_ci = UPPER(TRIM(b.branch_name)) COLLATE utf8mb4_unicode_ci
        WHERE l.period_code = ? AND l.expense_type = 'CostCenter' AND bm.id = ?
          AND b.active_status = 1 AND b.is_rejected = 0
        ORDER BY l.amount DESC`,
      [period, branchId],
    );
    for (const r of lineRows) {
      rows.push({
        id: `bud-${r.bill_source_id}`,
        label: r.expense_type_name ? String(r.expense_type_name) : "Budget line",
        detail: r.branch_name ? String(r.branch_name) : null,
        amount: n(r.amount),
        date: null,
      });
    }
  }
  return { metric: "budget", scope: { period, branchId }, rows, total: rows.reduce((s, r) => s + r.amount, 0), hasEstimatedRows: false };
}

export async function getPnlDrilldown(query: PnlDrilldownQuery): Promise<PnlDrilldownResult> {
  assertNotFuturePeriod(query.period);
  switch (query.metric) {
    case "revenue": return revenueDrilldownRows(query.period, query.branchId);
    case "people": return peopleDrilldownRows(query.period, query.branchId);
    case "indirect": return indirectDrilldownRows(query.period, query.branchId);
    case "budget": return budgetDrilldownRows(query.period, query.branchId);
  }
}
