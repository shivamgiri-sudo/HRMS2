import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { financeBranchFilter, type FinanceBranchScope } from "./finance-access-scope.js";
import { resolvePendingWith } from "./finance-workflow-role.js";

/**
 * The GRN reporting surface: the legacy register, plus the two things it never had.
 *
 * THE FINANCE MONTH IS accounting_period, NOT bill_date.
 * This is the single rule the whole file turns on. A March invoice booked into February belongs
 * to February for every finance purpose — P&L, budget consumption, GRN numbering and the period
 * lock all read accounting_period, and bill_date stays as typed because it is a fact about the
 * supplier's document. The legacy sheet already worked this way: its "Finance Month" column
 * reads Jul against a Bill Date of 03-05-2026. So `month`/`financialYear` filter and group on
 * accounting_period, and bill_date is reported beside it as its own column rather than driving
 * anything. Filtering a finance report by bill date is how the same invoice lands in two
 * different months' totals depending on which report you opened.
 *
 * THE GST SPLIT HAS TWO SOURCES AND ONLY ONE OF THEM IS POPULATED FOR HISTORY.
 * grn_cost_allocation carries real cgst/sgst/igst columns, but only for GRNs raised through the
 * current allocation path — 44 rows against 84,784 GRNs. Every migrated row has only
 * grn_request.tax_amount plus gst_type. So the split is taken from the allocation when one
 * exists and derived from gst_type otherwise: IGST takes the whole tax, anything else splits it
 * in half. Derived exactly reproduces the legacy sheet (2,625 / 2,625 / 0 on 5,250 of tax) and
 * never invents a figure the row does not already contain.
 *
 * EVERY QUERY IS BRANCH-SCOPED BY THE CALLER'S SCOPE SET, not by a branchId the client sends.
 * A report is the easiest place in a finance module to leak another branch's spend, because it
 * is the one screen whose whole purpose is to show many rows at once.
 */

export type GrnReportFilters = {
  branchScope: FinanceBranchScope;
  branchId?: string;
  /** FY label as stored on the row, e.g. "2026-27". */
  financialYear?: string;
  /** Finance month as YYYY-MM. Filters accounting_period, never bill_date. */
  month?: string;
  head?: string;
  subHead?: string;
  /** imprest | non_imprest — the legacy sheet's "Expense Mode". */
  expenseMode?: string;
  grnNumber?: string;
  vendorId?: string;
  status?: string;
  /** Rows awaiting a named stage. Derived from status, never stored. */
  pendingWith?: string;
  limit?: number;
};

const MAX_ROWS = 5000;

function scopeConditions(filters: GrnReportFilters) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  const scope = financeBranchFilter(filters.branchScope, "g.branch_id");
  if (scope.sql !== "1=1") {
    conditions.push(scope.sql);
    params.push(...scope.params);
  }
  // A requested branch NARROWS the scope set; it can never widen it, because the scope filter
  // above is already in the WHERE clause beside it.
  if (filters.branchId) {
    conditions.push("g.branch_id = ?");
    params.push(filters.branchId);
  }
  if (filters.financialYear) {
    conditions.push("g.financial_year = ?");
    params.push(filters.financialYear);
  }
  if (filters.month) {
    conditions.push("g.accounting_period = ?");
    params.push(filters.month);
  }
  /*
   * Head and sub-head are matched on the header OR on any allocation row.
   *
   * A GRN split across several heads stores the literal 'Multiple Heads' / 'Multiple Sub-Heads'
   * in the header columns, so `g.head = ?` silently drops every split GRN from a head-filtered
   * register — the rows most worth looking at when you are chasing one head's spend. The EXISTS
   * arm recovers them through the allocation's budget line, which carries the real head.
   *
   * Written as `IN (subquery)` rather than a JOIN so a GRN with five matching allocation rows
   * still appears once. listGrns already had this workaround but only applied it alongside a
   * cost-centre filter.
   */
  if (filters.head) {
    conditions.push(
      `(g.head = ? OR g.id IN (
          SELECT a.grn_request_id FROM grn_cost_allocation a
            JOIN finance_budget_line bl ON bl.id = a.budget_line_id
           WHERE bl.head = ? AND a.lifecycle_status NOT IN ('released', 'reversed')
        ))`
    );
    params.push(filters.head, filters.head);
  }
  if (filters.subHead) {
    conditions.push(
      `(g.sub_head = ? OR g.id IN (
          SELECT a.grn_request_id FROM grn_cost_allocation a
            JOIN finance_budget_line bl ON bl.id = a.budget_line_id
           WHERE bl.sub_head = ? AND a.lifecycle_status NOT IN ('released', 'reversed')
        ))`
    );
    params.push(filters.subHead, filters.subHead);
  }
  if (filters.expenseMode === "imprest") {
    conditions.push("g.grn_type = 'imprest'");
  } else if (filters.expenseMode === "non_imprest") {
    conditions.push("g.grn_type <> 'imprest'");
  }
  if (filters.grnNumber) {
    conditions.push("g.grn_number LIKE ?");
    params.push(`%${filters.grnNumber}%`);
  }
  if (filters.vendorId) {
    conditions.push("g.vendor_id = ?");
    params.push(filters.vendorId);
  }
  if (filters.status) {
    conditions.push("g.status = ?");
    params.push(filters.status);
  }
  return { conditions, params };
}

/**
 * Who raised it, as the legacy sheet shows it.
 *
 * Migrated rows carry legacy_raised_by_name and no created_by that resolves to a live user —
 * "PARVEEN KUMAR" in the reference sheet is one of those. Preferring the join and falling back
 * to the legacy name keeps both eras readable in one column; preferring the legacy name would
 * hide who actually raised a GRN in HRMS2.
 */
const RAISED_BY = "COALESCE(NULLIF(TRIM(u.full_name), ''), g.legacy_raised_by_name, '')";

export const grnReportService = {
  /**
   * The GRN register — the legacy "Imprest Report" columns, plus the workflow facts that sheet
   * could not carry because it was exported from a system with no approval chain.
   */
  async register(filters: GrnReportFilters) {
    const { conditions, params } = scopeConditions(filters);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    // LIMIT is interpolated, not bound: mysql2 3.22.3 rejects LIMIT placeholders in execute(),
    // the same footgun already fixed in listGrns. Clamped to an integer first.
    const limit = Math.min(Math.max(Number(filters.limit) || 1000, 1), MAX_ROWS);

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT
          g.id,
          g.grn_number,
          g.branch_id,
          bm.branch_name,
          g.accounting_period,
          g.financial_year,
          g.grn_type,
          g.is_unbudgeted,
          g.is_late_invoice,
          g.is_multi_month,
          g.vendor_name,
          g.invoice_number,
          g.head,
          g.sub_head,
          g.description,
          g.remarks,
          g.amount_without_tax,
          g.tax_amount,
          g.other_charges,
          g.round_off_amount,
          g.amount_with_tax,
          g.pnl_cost_amount,
          g.gst_type,
          -- Allocation split when the GRN has one, derived from gst_type when it does not.
          COALESCE(alloc.cgst_amount,
                   CASE WHEN g.gst_type = 'igst' THEN 0 ELSE ROUND(COALESCE(g.tax_amount, 0) / 2, 2) END) AS cgst_amount,
          COALESCE(alloc.sgst_amount,
                   CASE WHEN g.gst_type = 'igst' THEN 0 ELSE ROUND(COALESCE(g.tax_amount, 0) / 2, 2) END) AS sgst_amount,
          COALESCE(alloc.igst_amount,
                   CASE WHEN g.gst_type = 'igst' THEN COALESCE(g.tax_amount, 0) ELSE 0 END) AS igst_amount,
          CASE WHEN alloc.grn_request_id IS NULL THEN 'derived' ELSE 'allocated' END AS gst_split_source,
          DATE(g.created_at) AS grn_date,
          COALESCE(g.approved_at, g.finance_head_reviewed_at, g.branch_head_reviewed_at) AS approval_date,
          g.bill_date,
          g.due_date,
          -- The decorator below reads all five of these. They were absent from this SELECT, so
          -- is_legacy was permanently false (killing the legacy ageing clamp it exists to
          -- drive) and the stage clock always fell back to created_at. 84,767 of 84,818 rows are
          -- migrated, so "permanently false" meant "wrong on 99.9% of the register".
          g.bill_source_id,
          g.submitted_at,
          g.branch_head_reviewed_at,
          g.finance_head_reviewed_at,
          g.accounts_payment_status,
          pay.payment_date,
          pay.paid_amount,
          pay.tds_deducted_amount,
          pay.payment_status,
          g.status,
          ${RAISED_BY} AS raised_by_name,
          COALESCE(g.attachment_file_path, g.attachment_path) AS attachment_path,
          COALESCE(g.attachment_file_name, g.attachment_original_name) AS attachment_name,
          g.cost_centre_id,
          cc.cost_centre_name,
          g.process_id,
          g.budget_line_id,
          g.recognition_start_period,
          g.recognition_end_period
        FROM grn_request g
        LEFT JOIN branch_master bm ON bm.id = g.branch_id
        LEFT JOIN employees u ON u.user_id = g.created_by
        LEFT JOIN cost_centre_master cc ON cc.id = g.cost_centre_id
        LEFT JOIN (
          -- NOT IN ('released') also admitted 'reversed' and 'draft'. Reversed tax has been credited
          -- back and a draft row is not a booking at all, so counting either overstates the GST
          -- on a GRN whose allocations were corrected. Named exclusions instead of one negation,
          -- so a new lifecycle value has to be considered rather than silently included.
          SELECT grn_request_id,
                 SUM(cgst_amount) AS cgst_amount,
                 SUM(sgst_amount) AS sgst_amount,
                 SUM(igst_amount) AS igst_amount
            FROM grn_cost_allocation
           WHERE lifecycle_status IN ('reserved', 'consumed')
           GROUP BY grn_request_id
        ) alloc ON alloc.grn_request_id = g.id
        LEFT JOIN (
          SELECT grn_request_id,
                 MAX(payment_date) AS payment_date,
                 SUM(paid_amount) AS paid_amount,
                 SUM(tds_deducted_amount) AS tds_deducted_amount,
                 MAX(payment_status) AS payment_status
            FROM vendor_payment_tracking
           GROUP BY grn_request_id
        ) pay ON pay.grn_request_id = g.id
        ${where}
        ORDER BY g.accounting_period DESC, g.created_at DESC
        LIMIT ${limit}`,
      params
    );

    const decorated = (rows as RowDataPacket[]).map((row) => {
      const pending = resolvePendingWith(String(row.status ?? ""), "grn");
      const stageStartedAt = row.branch_head_reviewed_at ?? row.submitted_at ?? row.grn_date ?? null;
      const isLegacyData = Boolean(row.bill_source_id);
      let ageDays: number | null = null;
      if (pending.isPending && stageStartedAt) {
        const rawAgeDays = Math.max(0, Math.floor((Date.now() - new Date(String(stageStartedAt)).getTime()) / 86_400_000));
        ageDays = isLegacyData && rawAgeDays > 90 ? -1 : rawAgeDays;
      }
      return {
        ...row,
        expense_mode: String(row.grn_type) === "imprest" ? "Imprest" : "Non Imprest",
        pending_with: pending.label,
        pending_with_role: pending.role,
        is_pending: pending.isPending,
        ageing_days: ageDays,
        age_bucket: ageDays === null ? null : ageDays === -1 ? "legacy" : ageDays <= 2 ? "0-2" : ageDays <= 7 ? "3-7" : "7+",
        is_legacy: isLegacyData,
      };
    });

    const visible = filters.pendingWith
      ? decorated.filter((row) => row.pending_with_role === filters.pendingWith)
      : decorated;

    // Totals come from the rows actually returned, so the footer can never claim more than the
    // table above it shows — including when the LIMIT truncates.
    const sum = (key: string) => visible.reduce((total, row) => total + Number((row as any)[key] ?? 0), 0);
    return {
      rows: visible,
      totals: {
        count: visible.length,
        amountWithoutTax: sum("amount_without_tax"),
        taxAmount: sum("tax_amount"),
        cgstAmount: sum("cgst_amount"),
        sgstAmount: sum("sgst_amount"),
        igstAmount: sum("igst_amount"),
        amountWithTax: sum("amount_with_tax"),
        paidAmount: sum("paid_amount"),
        tdsDeducted: sum("tds_deducted_amount"),
      },
      truncated: visible.length >= limit,
      limit,
    };
  },

  /**
   * The audit trail as a REPORT rather than one entity's timeline.
   *
   * finance_approval_event already had a per-GRN read (GET /grns/:id/approval-history), which
   * answers "what happened to this one". It could not answer "what did this branch approve last
   * month", which is the question an auditor actually arrives with. Branch scope is applied by
   * joining back to the GRN, because the event table is polymorphic and carries no branch of
   * its own.
   */
  async auditTrail(filters: GrnReportFilters & { entityType?: string; action?: string; from?: string; to?: string }) {
    const conditions: string[] = [];
    const params: unknown[] = [];

    const scope = financeBranchFilter(filters.branchScope, "COALESCE(g.branch_id, h.branch_id)");
    if (scope.sql !== "1=1") {
      conditions.push(scope.sql);
      params.push(...scope.params);
    }
    if (filters.branchId) {
      conditions.push("COALESCE(g.branch_id, h.branch_id) = ?");
      params.push(filters.branchId);
    }
    if (filters.entityType) {
      conditions.push("e.entity_type = ?");
      params.push(filters.entityType);
    }
    if (filters.action) {
      conditions.push("e.action = ?");
      params.push(filters.action);
    }
    if (filters.month) {
      // The finance month of the GRN the event belongs to — not the month the click happened.
      // An approval in August of a July GRN is July's business.
      conditions.push("COALESCE(g.accounting_period, h.period_code) = ?");
      params.push(filters.month);
    }
    if (filters.from) {
      conditions.push("e.created_at >= ?");
      params.push(`${filters.from} 00:00:00`);
    }
    if (filters.to) {
      conditions.push("e.created_at <= ?");
      params.push(`${filters.to} 23:59:59`);
    }
    /*
     * An event whose entity resolves to NO branch is dropped, not shown.
     *
     * The LEFT JOINs mean an imprest_allocation or vendor_payment event has NULL on both sides,
     * so COALESCE(...) IS NULL and the scope predicate cannot judge it. Showing those rows would
     * hand every branch a slice of the trail nobody scoped; hiding them is the fail-closed
     * reading, and the entity types that ARE branch-resolvable (grn, budget_topup) are the ones
     * this report is for.
     */
    conditions.push("COALESCE(g.branch_id, h.branch_id) IS NOT NULL");

    const where = `WHERE ${conditions.join(" AND ")}`;
    const limit = Math.min(Math.max(Number(filters.limit) || 1000, 1), MAX_ROWS);

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT
          e.id,
          e.entity_type,
          e.entity_id,
          e.action,
          e.from_status,
          e.to_status,
          e.decision,
          e.actor_role,
          e.remarks,
          e.details_json,
          e.created_at,
          COALESCE(NULLIF(TRIM(au.full_name), ''), e.actor_user_id) AS actor_name,
          COALESCE(g.grn_number, t.id) AS reference,
          COALESCE(g.accounting_period, h.period_code) AS finance_month,
          COALESCE(g.branch_id, h.branch_id) AS branch_id,
          bm.branch_name,
          COALESCE(g.head, l.head) AS head,
          COALESCE(g.sub_head, l.sub_head) AS sub_head,
          COALESCE(g.amount_with_tax, t.requested_amount) AS amount
        FROM finance_approval_event e
        LEFT JOIN employees au ON au.user_id = e.actor_user_id
        LEFT JOIN grn_request g ON e.entity_type = 'grn' AND g.id = e.entity_id
        LEFT JOIN finance_budget_topup_request t ON e.entity_type = 'budget_topup' AND t.id = e.entity_id
        LEFT JOIN finance_budget_line l ON l.id = t.budget_line_id
        LEFT JOIN finance_budget_header h ON h.id = t.budget_id
        LEFT JOIN branch_master bm ON bm.id = COALESCE(g.branch_id, h.branch_id)
        ${where}
        ORDER BY e.created_at DESC
        LIMIT ${limit}`,
      params
    );

    return {
      rows: (rows as RowDataPacket[]).map((row) => ({
        ...row,
        details: row.details_json ? safeParse(String(row.details_json)) : null,
      })),
      truncated: rows.length >= limit,
      limit,
    };
  },

  /**
   * Top-up requests as a report: every branch in scope, every month, with ageing.
   *
   * BudgetTopupPanel lists one branch and one month at a time because it is a work queue. That
   * makes a request raised against a month nobody is currently looking at effectively invisible
   * — which is how one sat three days at 'submitted' with nobody chasing it. This is the view
   * that answers "what is outstanding anywhere".
   */
  async topups(filters: GrnReportFilters & { status?: string }) {
    const conditions: string[] = [];
    const params: unknown[] = [];

    const scope = financeBranchFilter(filters.branchScope, "h.branch_id");
    if (scope.sql !== "1=1") {
      conditions.push(scope.sql);
      params.push(...scope.params);
    }
    if (filters.branchId) {
      conditions.push("h.branch_id = ?");
      params.push(filters.branchId);
    }
    if (filters.month) {
      conditions.push("h.period_code = ?");
      params.push(filters.month);
    }
    if (filters.head) {
      conditions.push("l.head = ?");
      params.push(filters.head);
    }
    if (filters.status) {
      conditions.push("t.status = ?");
      params.push(filters.status);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.min(Math.max(Number(filters.limit) || 1000, 1), MAX_ROWS);

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT
          t.id,
          t.status,
          t.requested_amount,
          t.requested_quantity,
          t.reason,
          t.rejection_reason,
          t.created_at,
          t.branch_head_reviewed_at,
          t.finance_head_reviewed_at,
          t.applied_at,
          h.period_code AS finance_month,
          h.budget_number,
          h.branch_id,
          bm.branch_name,
          l.head,
          l.sub_head,
          l.item_name,
          l.unit_rate,
          l.gross_amount AS line_gross_amount,
          COALESCE(NULLIF(TRIM(ru.full_name), ''), t.requested_by) AS requested_by_name
        FROM finance_budget_topup_request t
        JOIN finance_budget_line l ON l.id = t.budget_line_id
        JOIN finance_budget_header h ON h.id = t.budget_id
        LEFT JOIN branch_master bm ON bm.id = h.branch_id
        LEFT JOIN employees ru ON ru.user_id = t.requested_by
        ${where}
        ORDER BY t.created_at DESC
        LIMIT ${limit}`,
      params
    );

    const decorated = (rows as RowDataPacket[]).map((row) => {
      const pending = resolvePendingWith(String(row.status ?? ""), "topup");
      const stageStartedAt = row.branch_head_reviewed_at ?? row.created_at ?? null;
      return {
        ...row,
        pending_with: pending.label,
        pending_with_role: pending.role,
        is_pending: pending.isPending,
        ageing_days: pending.isPending && stageStartedAt
          ? Math.max(0, Math.floor((Date.now() - new Date(String(stageStartedAt)).getTime()) / 86_400_000))
          : null,
      };
    });

    const visible = filters.pendingWith
      ? decorated.filter((row) => row.pending_with_role === filters.pendingWith)
      : decorated;

    return {
      rows: visible,
      totals: {
        count: visible.length,
        requestedAmount: visible.reduce((total, row) => total + Number((row as any).requested_amount ?? 0), 0),
        appliedAmount: visible
          .filter((row) => String((row as any).status) === "applied")
          .reduce((total, row) => total + Number((row as any).requested_amount ?? 0), 0),
        pending: visible.filter((row) => row.is_pending).length,
      },
      truncated: visible.length >= limit,
      limit,
    };
  },

  /**
   * Head / sub-head / financial-year / period values that actually occur in the caller's scope,
   * for the filter dropdowns.
   *
   * THREE SEPARATE QUERIES, NOT ONE CROSS-PRODUCT.
   * This used to be a single `SELECT DISTINCT head, sub_head, financial_year, accounting_period
   * ... LIMIT 2000`, which is a distinct over the CARTESIAN combination of four columns. Post
   * migration that combination has 4,224 distinct rows against 26 heads, 92 head/sub-head pairs,
   * 10 financial years and 120 periods — so the LIMIT cut it in half, and because the ORDER BY
   * was `head, sub_head`, what survived was the alphabetically-first heads plus whichever years
   * and periods happened to travel with them. Heads from roughly "R" onward, and most of the ten
   * years of history, were simply missing from every filter on the page.
   *
   * Splitting it means each list is bounded by its own real cardinality instead of by the other
   * three, and the DISTINCTs are small enough that no LIMIT is needed at all.
   *
   * Blank head/sub-head values are excluded in SQL rather than skipped in the loop, so an empty
   * option can never reach the dropdown.
   */
  async filterOptions(filters: GrnReportFilters) {
    const { conditions, params } = scopeConditions({ ...filters, head: undefined, subHead: undefined });
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [headRows, yearRows, periodRows] = await Promise.all([
      db.query<RowDataPacket[]>(
        `SELECT g.head, g.sub_head
           FROM grn_request g
           ${where}${where ? " AND" : " WHERE"} TRIM(COALESCE(g.head, '')) <> ''
          GROUP BY g.head, g.sub_head
          ORDER BY g.head, g.sub_head`,
        params
      ),
      db.query<RowDataPacket[]>(
        `SELECT g.financial_year
           FROM grn_request g
           ${where}${where ? " AND" : " WHERE"} TRIM(COALESCE(g.financial_year, '')) <> ''
          GROUP BY g.financial_year
          ORDER BY g.financial_year DESC`,
        params
      ),
      db.query<RowDataPacket[]>(
        `SELECT g.accounting_period
           FROM grn_request g
           ${where}${where ? " AND" : " WHERE"} TRIM(COALESCE(g.accounting_period, '')) <> ''
          GROUP BY g.accounting_period
          ORDER BY g.accounting_period DESC`,
        params
      ),
    ]);

    const heads = new Map<string, Set<string>>();
    for (const row of headRows[0] as RowDataPacket[]) {
      const head = String(row.head ?? "").trim();
      if (!head) continue;
      if (!heads.has(head)) heads.set(head, new Set());
      const subHead = String(row.sub_head ?? "").trim();
      if (subHead) heads.get(head)!.add(subHead);
    }

    return {
      heads: Array.from(heads.entries())
        .map(([head, subHeads]) => ({ head, subHeads: Array.from(subHeads).sort() }))
        .sort((a, b) => a.head.localeCompare(b.head)),
      financialYears: (yearRows[0] as RowDataPacket[]).map((r) => String(r.financial_year)),
      periods: (periodRows[0] as RowDataPacket[]).map((r) => String(r.accounting_period)),
    };
  },
};

function safeParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    // details_json is written by us, but a malformed row must not take the whole report down.
    return null;
  }
}
