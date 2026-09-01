import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { resolvePendingWith } from "./finance-workflow-role.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { recordFinanceApprovalEvent } from "../../shared/financeApprovalEvent.js";
import {
  branchBudgetService,
  calculateBudgetLine,
  type BudgetGstType,
  type BudgetTaxTreatment,
} from "../process-pnl/branch-budget.service.js";
import { financeBranchFilter, type FinanceBranchScope } from "./finance-access-scope.js";
import { budgetConsumptionService } from "../process-pnl/budget-consumption.service.js";
import { isPeriodLocked } from "../process-pnl/finance-period-lock.js";
import { resolveAccountingPeriod } from "./grn-number-monthly.service.js";
import { grnSmartService } from "./grn-smart.service.js";
import { resolveGrnNumberOnSubmit } from "./grn-number-on-submit.js";
import { vendorPaymentService } from "./vendor-payment.service.js";
import { applyImprestNoGst, IMPREST_TAX_PROFILE } from "./grn-imprest-tax.js";
import { assertGrnTypeSupported } from "./grn-type-support.js";
import {
  getHeadSubHeadCoverage,
  assertCoverageExists,
  absorbableGrossFor,
} from "../process-pnl/budget-headroom-gate.service.js";
import { budgetClosureService } from "../process-pnl/budget-closure.service.js";
import { refuse } from "../process-pnl/finance-error.js";

export type GrnType = "vendor" | "imprest";
export type GrnStatus =
  | "draft"
  | "submitted"
  | "branch_head_approved"
  | "finance_head_approved"
  | "pending_accounts_payment"
  | "payment_scheduled"
  | "partially_paid"
  | "paid"
  | "approved"
  | "rejected"
  | "cancelled"
  | "consumption_reversed";

/** Statuses reached only after Finance Head approval actually moved budget from reserved
 *  into consumed via budgetConsumptionService.consume(). The only statuses eligible for
 *  reverseConsumption(). */
const CONSUMED_GRN_STATUSES: GrnStatus[] = [
  "pending_accounts_payment",
  "payment_scheduled",
  "partially_paid",
  "paid",
  "approved",
];

export interface CreateGrnPayload {
  grnType: GrnType;
  branchId: string;
  /** Legal entity (MAS / IDC / Pikquick). Stored on grn_request after migration 1218. */
  companyCode?: string;
  /**
   * The approved budget line this GRN books against.
   *
   * Required for every ordinary GRN and optional only when isUnbudgeted is true — see the
   * unbudgeted branch in createDraft() below for why that exception exists and what replaces it.
   */
  budgetLineId?: string;
  processId?: string;
  costCentreId?: string;
  /**
   * UNBUDGETED vendor GRN — the raiser picked a Head/Sub-head that has no approved budget line
   * in any of the branch's cost centres, which the vendor form deliberately allows.
   *
   * When set, budgetLineId is absent and head/subHead carry the classification the budget line
   * would otherwise have supplied. Finance Head must link a real budget line to every
   * cost-centre split before the GRN can be approved (grnSmartService.linkUnbudgetedBudgetLines).
   */
  isUnbudgeted?: boolean;
  /** Expense head — read from the budget line for a budgeted GRN, supplied here when unbudgeted. */
  head?: string;
  /** Expense sub-head — same rule as head. */
  subHead?: string;
  vendorId?: string;
  vendorName?: string;
  quantity: number;
  unitRate?: number;
  billDate?: string;
  paymentTermsDays?: number;
  remarks?: string;
  financialYear?: string;
  /**
   * The month the GRN books to, when it differs from the bill month.
   *
   * Optional and NULL on every existing caller, which is what keeps this change inert: the
   * number falls back to bill_date exactly as before. It matters only under the monthly
   * numbering format, where the MM/YY is the accounting month rather than the vendor's
   * invoice date.
   */
  accountingPeriod?: string;
}

export interface SubmitGrnPayload {
  remarks?: string;
}

export interface ReviewGrnPayload {
  decision: "approved" | "rejected";
  reviewNote?: string;
}

async function writeGrnAudit(
  action: string,
  grnId: string,
  actorId: string,
  actorRole: string,
  changes: Record<string, unknown>
) {
  await logSensitiveAction({
    actor_user_id: actorId,
    actor_role: actorRole,
    action_type: `GRN_${action}`,
    module_key: "FINANCE",
    entity_type: "grn_request",
    entity_id: grnId,
    change_summary: changes,
  });
}

async function resolveCanonicalVendor(
  grnType: GrnType,
  requestedVendorId: string | undefined,
  preferredVendorId: string | null | undefined
) {
  if (grnType === "imprest") {
    return { vendorId: null, vendorName: null };
  }

  const vendorId = requestedVendorId?.trim() || preferredVendorId || null;
  if (!vendorId) {
    throw new Error("Vendor GRN requires an active vendor selected from Vendor Master");
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, vendor_name, is_active
       FROM vendor_master
      WHERE id = ?
      LIMIT 1`,
    [vendorId]
  );
  const vendor = rows[0];
  if (!vendor) throw new Error("Selected vendor was not found in Vendor Master");
  if (Number(vendor.is_active ?? 0) !== 1) {
    throw new Error("Selected vendor is inactive and cannot be used for a GRN");
  }

  return {
    vendorId: String(vendor.id),
    vendorName: String(vendor.vendor_name),
  };
}

function financialYearFromPeriod(periodCode: string) {
  const [year, month] = periodCode.split("-").map(Number);
  if (!year || !month) throw new Error("Approved budget has an invalid period");
  return month >= 4
    ? `${year}-${String(year + 1).slice(-2)}`
    : `${year - 1}-${String(year).slice(-2)}`;
}

function addDays(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function getGrnOrThrow(grnId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM grn_request WHERE id = ? LIMIT 1`,
    [grnId]
  );
  if (!rows[0]) throw new Error("GRN not found");
  return rows[0] as any;
}

// ---------------------------------------------------------------------------
// Legacy GRN helpers
// ---------------------------------------------------------------------------

/**
 * Branch scope condition for grn_entry_snapshot.
 *
 * Primary path: grn_entry_line_snapshot → cost_centre_master.branch_id (UUID).
 * Fallback: branch_master.branch_name COLLATE = grn_entry_snapshot.branch_name.
 * ids appear twice: once for the cost_centre join, once for the name fallback.
 */
function legacyBranchCondition(
  scope: FinanceBranchScope,
  alias: string = "g"
): { sql: string; params: unknown[] } {
  if (scope.mode === "all") return { sql: "1=1", params: [] };

  const ids = scope.branchIds;
  if (ids.length === 0) return { sql: "1 = 0", params: [] };
  const ph = ids.map(() => "?").join(", ");

  const sql = `(
    EXISTS (
      SELECT 1
        FROM grn_entry_line_snapshot l
        JOIN cost_centre_master ccm
          ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
           = l.cost_centre_code  COLLATE utf8mb4_unicode_ci
       WHERE l.grn_source_id = ${alias}.bill_source_id
         AND ccm.branch_id IN (${ph})
    )
    OR EXISTS (
      SELECT 1
        FROM branch_master bm
       WHERE bm.id IN (${ph})
         AND bm.branch_name COLLATE utf8mb4_unicode_ci
           = ${alias}.branch_name COLLATE utf8mb4_unicode_ci
    )
  )`;
  return { sql, params: [...ids, ...ids] };
}
/**
 * Creates the DRAFT header for an UNBUDGETED vendor GRN — one raised against a Head/Sub-head that
 * has no approved budget line anywhere in the branch, which the vendor form deliberately permits.
 *
 * This is a separate function rather than a set of `if (isUnbudgeted)` branches threaded through
 * createDraft() because createDraft() derives essentially every column it writes from the budget
 * line: head, sub_head, unit, unit_rate, the whole tax profile, the amounts, process_id,
 * cost_centre_id, budget_id, the financial year and the period-match check. With no line to read,
 * almost none of that logic applies, and interleaving the two would have meant guarding roughly
 * twenty statements individually.
 *
 * What is written here is deliberately a THIN placeholder, and that is safe for exactly the same
 * documented reason the budgeted vendor path already relies on: the follow-up
 * PUT /api/finance/grns/:id/invoice-components call overwrites every meaningful header column
 * (head, sub_head, quantity, unit, unit_rate, the full tax breakdown, all five amount columns,
 * cost_class, process_id, cost_centre_id, allocation_mode) with the real
 * N-cost-centre x M-component breakdown before the GRN can be submitted. head/sub_head are the
 * one exception that must be RIGHT here rather than a placeholder: saveInvoiceComponents() reads
 * them back off this row to build its synthetic budget lines for the unbudgeted case, so the
 * classification the raiser chose has to survive this insert.
 *
 * budget_id and budget_line_id are left NULL and is_unbudgeted is set to 1 OPTIMISTICALLY — both
 * are corrected by the allocation save, which is the first step that knows what actually funded
 * the GRN. In the ordinary case the branch aggregate funds every split and the flag is cleared
 * back to 0 there.
 *
 * CORRECTION, 2026-08-29. This comment used to claim that "grnSmartService.review() refuses a
 * Finance Head approval while any cost-centre split still has no budget line". It does not, and
 * never did — review()'s own block comment says the opposite and is the accurate one: an
 * unbudgeted GRN approves WITHOUT a budget line, deliberately, because linking is an option
 * Finance Head has and not a gate they must pass. Two contradictory descriptions of the same rule
 * sat in one module; this is the one that was wrong.
 *
 * What genuinely bounds this path is the coverage check below: the branch must hold budget for
 * the head/sub-head, and the allocation step then funds every split out of that aggregate. A
 * split that reaches approval with budget_line_id still NULL records spend with no budget behind
 * it — visible as is_unbudgeted = 1 on the row — rather than being prevented.
 */
async function createUnbudgetedDraft(
  payload: CreateGrnPayload,
  paymentTermsDays: number,
  actorUserId: string,
  actorRole: string
) {
  const head = String(payload.head ?? "").trim();
  const subHead = String(payload.subHead ?? "").trim();
  if (!head) throw new Error("An expense head is required for an unbudgeted GRN");
  if (!subHead) throw new Error("An expense sub-head is required for an unbudgeted GRN");
  if (!payload.costCentreId) {
    throw new Error("A cost centre is required for an unbudgeted GRN");
  }

  // The cost centre stands in for the budget line as the thing that ties this GRN to the branch,
  // so it gets the same scrutiny getLineForGrn() applies to a line: it must exist, be active, and
  // belong to the branch the GRN is being raised for. Without this an unbudgeted GRN would be the
  // one create path able to attribute spend to another branch's cost centre.
  const [costCentreRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, cost_centre_name, branch_id
       FROM cost_centre_master
      WHERE id = ? AND active_status = 1
      LIMIT 1`,
    [payload.costCentreId]
  );
  const costCentre = costCentreRows[0] as any;
  if (!costCentre) throw new Error("Cost centre not found or inactive");
  if (String(costCentre.branch_id) !== String(payload.branchId)) {
    throw new Error("Cost centre does not belong to this branch");
  }

  const accountingPeriod = resolveAccountingPeriod({
    accountingPeriod: payload.accountingPeriod,
    billDate: payload.billDate!,
  });
  // Same P&L-close guard the budgeted path applies against the budget line's period_code. There
  // is no line here, so it runs against the month the GRN actually books into.
  if (await isPeriodLocked(accountingPeriod)) {
    throw new Error(
      `${accountingPeriod} is locked for P&L close. Raise this against the current open period.`
    );
  }

  /*
   * The branch aggregate is checked HERE too, even though this path has no budget line.
   *
   * "Unbudgeted" describes what the raiser picked, not what the branch holds. The commonest
   * reason to arrive on this path is cost centre A having no line of its own for a head/sub-head
   * that cost centre B is budgeted for — in which case the branch DOES have the money and the
   * allocation step will fund it from B. Running the same coverage lookup at create means the
   * raiser is told the truth at the first step: either the branch has budget for this
   * head/sub-head, or NO_BUDGET_FOR_HEAD names exactly what to request.
   *
   * Deliberately NOT an amount check. The header's amount is not final on this path — the
   * cost-centre splits decide it — so the aggregate arithmetic belongs at the allocation step,
   * which does it per row. What is checked here is existence, which is knowable now and saves the
   * raiser filling in an invoice against a head nobody in the branch has budget for.
   */
  const coverage = await getHeadSubHeadCoverage(
    String(payload.branchId),
    accountingPeriod,
    head,
    subHead
  );
  assertCoverageExists(coverage, accountingPeriod, head, subHead);
  await budgetClosureService.assertSubheadOpen(db, String(coverage.budgetId), head, subHead);

  // Derived from the booking month rather than the budget line's period_code, which is the same
  // value in every budgeted case — getLineForGrn()'s period_code must already equal the bill month
  // (the "Bill date must fall within approved budget period" check enforces exactly that).
  const financialYear = financialYearFromPeriod(accountingPeriod);
  if (payload.financialYear && payload.financialYear !== financialYear) {
    throw new Error(`Financial year must be ${financialYear} for this accounting period`);
  }

  // No budget line means no preferred_vendor_id to fall back on; the vendor the raiser picked is
  // the only candidate, and resolveCanonicalVendor still enforces that a vendor GRN has one.
  const vendor = await resolveCanonicalVendor(payload.grnType, payload.vendorId, null);

  const id = randomUUID();
  const dueDate = addDays(payload.billDate!, paymentTermsDays);

  // GRN number is intentionally NOT allocated here — it is assigned at submission time only.
  // Allocating at draft creation causes sequence gaps when drafts are abandoned, and Finance
  // reconciles against submitted numbers, not draft-creation numbers.
  await db.execute(
    `INSERT INTO grn_request
     (id, grn_number, grn_type, branch_id, company_code, process_id, cost_centre_id, cost_class,
      vendor_id, vendor_name, head, sub_head, quantity, unit, unit_rate,
      tax_treatment, gst_rate, gst_type, recoverable_tax_pct,
      amount_without_tax, tax_amount, amount_with_tax, pnl_cost_amount, amount,
      bill_date, accounting_period, payment_terms_days, due_date, description, remarks, status,
      financial_year, budget_id, budget_line_id, is_unbudgeted, created_by, created_at)
     VALUES (?,NULL,?,?,?,NULL,?,'direct',?,?,?,?,?,'amount',0,
             'exclusive',0,'cgst_sgst',100,
             0,0,0,0,0,
             ?,?,?,?,?,?,'draft',?,NULL,NULL,1,?,NOW())`,
    [
      id,
      payload.grnType,
      payload.branchId,
      payload.companyCode?.trim() || null,
      payload.costCentreId,
      vendor.vendorId,
      vendor.vendorName,
      head,
      subHead,
      Number(payload.quantity),
      payload.billDate,
      accountingPeriod,
      paymentTermsDays,
      dueDate,
      `${head} - ${subHead} (unbudgeted)`,
      payload.remarks?.trim() || null,
      financialYear,
      actorUserId,
    ]
  );

  // An unbudgeted GRN has no budget line to name, which is precisely why its origin is worth
  // recording on the readable trail: it is the path that bypasses the approved budget.
  await recordFinanceApprovalEvent({
    entityType: "grn",
    entityId: id,
    action: "create",
    fromStatus: null,
    toStatus: "draft",
    actorUserId,
    actorRole,
    details: {
      branchId: payload.branchId,
      budgetLineId: null,
      accountingPeriod,
      unbudgeted: true,
    },
  });
  await writeGrnAudit("CREATE_DRAFT_UNBUDGETED", id, actorUserId, actorRole, {
    grn_number: null,
    is_unbudgeted: true,
    head,
    sub_head: subHead,
    cost_centre_id: payload.costCentreId,
    cost_centre_name: costCentre.cost_centre_name ?? null,
    accounting_period: accountingPeriod,
    financial_year: financialYear,
  });
  return { id, grnNumber: null };
}

export const grnService = {
  async createDraft(payload: CreateGrnPayload, actorUserId: string, actorRole: string) {
    // P0-2: a type with no accounting lifecycle in application code cannot be raised. Covers
    // `salary` as well as `provision` — see grn-type-support.ts.
    assertGrnTypeSupported(payload.grnType, "Creation");
    if (!payload.branchId) throw new Error("Branch is required");
    const isUnbudgeted = Boolean(payload.isUnbudgeted);
    if (!isUnbudgeted && !payload.budgetLineId) {
      throw new Error("An approved budget line is required");
    }
    if (!payload.billDate || !/^\d{4}-\d{2}-\d{2}$/.test(payload.billDate)) {
      throw new Error("A valid bill/receipt date is required");
    }
    if (!Number.isFinite(Number(payload.quantity)) || Number(payload.quantity) <= 0) {
      throw new Error("Quantity must be greater than zero");
    }

    const paymentTermsDays = Number(payload.paymentTermsDays ?? 0);
    if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 365) {
      throw new Error("Payment terms must be a whole number between 0 and 365 days");
    }

    if (isUnbudgeted) {
      return await createUnbudgetedDraft(payload, paymentTermsDays, actorUserId, actorRole);
    }

    const budgetLine = await branchBudgetService.getLineForGrn(
      payload.budgetLineId!,
      payload.branchId
    ) as any;

    // An explicit accountingPeriod is only ever present when the caller asked to book into a
    // month other than the bill date's own month — grn.routes.ts's periodOverrideRoles gate has
    // already restricted that to Finance Head/Accounts Head/Branch Admin/Super Admin before this
    // function is ever called (see the comment there). Everyone else's payload omits it, so
    // effectivePeriod is exactly billDate's month and behaviour is unchanged.
    //
    // Without this, the override was write-only: grn.routes.ts approved the request, then this
    // check re-derived the period from billDate anyway and rejected it — an elevated user who
    // picked a real, budgeted PAST period for a TODAY-dated bill (the deliberate cut-off-booking
    // case the override exists for) got "Bill date must fall within approved budget period"
    // for the one thing they were just cleared to do.
    const effectivePeriod = payload.accountingPeriod?.trim() || payload.billDate.slice(0, 7);
    if (effectivePeriod !== String(budgetLine.period_code)) {
      throw new Error(
        `Bill date must fall within approved budget period ${budgetLine.period_code}`
      );
    }
    if (await isPeriodLocked(budgetLine.period_code)) {
      throw new Error(
        `${budgetLine.period_code} is locked for P&L close. Raise this against the current open period.`
      );
    }
    if (payload.processId && payload.processId !== budgetLine.process_id) {
      throw new Error("GRN process does not match the approved budget line");
    }
    /*
     * The GRN's cost centre no longer has to be the budget line's cost centre.
     *
     * It used to, and that single check was what made "cost centre A raises against cost centre
     * B's line in the same branch" impossible to express — A had no line of its own for the
     * head/sub-head, B had budget sitting there, and the only way through was to declare the
     * spend unbudgeted. Since the branch-wide headroom gate the funding line and the cost centre
     * are deliberately independent (see budget-headroom-gate.service.ts), so requiring them to
     * agree here contradicted the rule the allocation step already applies.
     *
     * What still has to hold is the thing this check was really protecting: the cost centre must
     * exist, be active, and belong to THIS GRN's branch. Otherwise a raiser could attribute spend
     * to another branch entirely, which is the one thing no later step re-checks.
     */
    if (payload.costCentreId && payload.costCentreId !== budgetLine.cost_centre_id) {
      const [ccRows] = await db.execute<RowDataPacket[]>(
        `SELECT id, branch_id FROM cost_centre_master
          WHERE id = ? AND active_status = 1 LIMIT 1`,
        [payload.costCentreId]
      );
      const costCentre = ccRows[0] as any;
      if (!costCentre) throw new Error("GRN cost centre not found or inactive");
      if (String(costCentre.branch_id) !== String(payload.branchId)) {
        throw new Error("GRN cost centre does not belong to this branch");
      }
    }

    const quantity = Number(payload.quantity);
    // Quantity does not refuse — see budget-consumption.service.ts's file-level banner. The money check below is the limit.

    const unitRate = payload.unitRate == null
      ? Number(budgetLine.unit_rate)
      : Number(payload.unitRate);
    if (!Number.isFinite(unitRate) || unitRate < 0) {
      throw new Error("Unit rate cannot be negative");
    }
    if (unitRate > Number(budgetLine.unit_rate) + 0.0001) {
      throw new Error("GRN unit rate exceeds the approved budget rate");
    }

    const amounts = calculateBudgetLine({
      head: String(budgetLine.head),
      subHead: budgetLine.sub_head,
      itemName: String(budgetLine.item_name),
      quantity,
      unit: String(budgetLine.unit),
      unitRate,
      taxTreatment: String(budgetLine.tax_treatment) as BudgetTaxTreatment,
      gstRate: Number(budgetLine.gst_rate),
      gstType: String(budgetLine.gst_type) as BudgetGstType,
      recoverableTaxPct: Number(budgetLine.recoverable_tax_pct),
      justification: String(budgetLine.justification || "Approved budget line"),
    });
    // Imprest is petty cash with no tax invoice behind it: the whole amount is P&L cost and the
    // budget line's planned tax treatment must not manufacture a GST split. See applyImprestNoGst.
    const isImprest = payload.grnType === "imprest";
    const amountsForGrn = isImprest ? applyImprestNoGst(amounts) : amounts;

    /*
     * Checked against the BRANCH AGGREGATE, not against the one line the raiser picked.
     *
     * This was the last gate still applying the pre-2026-08-22 rule, and it contradicted the very
     * next step. Create refused on a single line's shortfall — "GRN amount exceeds the available
     * approved budget" — for money that saveAllocations() would then have spilled onto a sibling
     * line for the same head/sub-head without comment. A raiser was told there was no budget by
     * step one and shown budget by step two, or the reverse. Same coverage lookup, same two 409s
     * and the same headroom arithmetic as the allocation step, so both steps now answer alike.
     */
    const coverage = await getHeadSubHeadCoverage(
      String(payload.branchId),
      String(budgetLine.period_code),
      String(budgetLine.head),
      budgetLine.sub_head ? String(budgetLine.sub_head) : null
    );
    assertCoverageExists(
      coverage,
      String(budgetLine.period_code),
      String(budgetLine.head),
      budgetLine.sub_head ? String(budgetLine.sub_head) : null
    );
    // A head/sub-head Finance has closed for the month refuses new spend. Previously enforced
    // only inside reserve(), i.e. not until Branch Head pressed Approve.
    await budgetClosureService.assertSubheadOpen(
      db,
      String(coverage.budgetId),
      String(budgetLine.head),
      budgetLine.sub_head ? String(budgetLine.sub_head) : null
    );
    // Compared against how much invoice GROSS the branch can absorb, not against the raw budget
    // sum. On a line planned as non_gst/exempt the GST on this invoice is never charged, so a
    // Rs 21,000 line carries more than Rs 21,000 of tax-inclusive invoice — reserve() has always
    // charged those lines the taxable value, and weighing the inclusive figure here refused GRNs
    // that Branch Head approval would then have accepted.
    const absorbable = absorbableGrossFor(coverage, amounts.grossAmount, amounts.baseAmount);
    if (amounts.grossAmount > absorbable + 0.01) {
      throw refuse(
        409,
        "HEADROOM_EXCEEDED",
        `Requested amount exceeds available budget for ${budgetLine.head}/${budgetLine.sub_head || ""} across the branch by `
        + `₹${(amounts.grossAmount - absorbable).toFixed(2)}`
      );
    }

    const vendor = await resolveCanonicalVendor(
      payload.grnType,
      payload.vendorId,
      budgetLine.preferred_vendor_id
    );
    const financialYear = financialYearFromPeriod(String(budgetLine.period_code));
    if (payload.financialYear && payload.financialYear !== financialYear) {
      throw new Error(`Financial year must be ${financialYear} for the selected budget`);
    }

    const id = randomUUID();
    /*
     * Which numbering format runs is a CONFIG FLAG, not a deploy (Requirement 12).
     *
     * finance_config.grn_number_format ships as 'legacy_branch_fy', so this is byte-identical
     * to the old behaviour until somebody switches it — at which point new GRNs get
     * MAS/MM/YY/SERIAL and existing numbers are untouched, because the two formats use
     * different sequence tables.
     *
     * Wiring this in was overdue: the monthly allocator, its sequence table and the flag all
     * existed and were tested, but NOTHING read the flag, so flipping it did nothing at all.
     * Requirement 12 was built and unreachable.
     */
    const accountingPeriod = resolveAccountingPeriod({
      accountingPeriod: payload.accountingPeriod,
      billDate: payload.billDate,
    });
    // GRN number deferred to submission — see createUnbudgetedDraft for the rationale.
    const dueDate = addDays(payload.billDate, paymentTermsDays);
    const costClass: "direct" | "indirect" =
      budgetLine.process_id || budgetLine.cost_centre_id ? "direct" : "indirect";

    await db.execute(
      `INSERT INTO grn_request
       (id, grn_number, grn_type, branch_id, company_code, process_id, cost_centre_id, cost_class,
        vendor_id, vendor_name, head, sub_head, quantity, unit, unit_rate,
        tax_treatment, gst_rate, gst_type, recoverable_tax_pct,
        amount_without_tax, tax_amount, amount_with_tax, pnl_cost_amount, amount,
        bill_date, accounting_period, payment_terms_days, due_date, description, remarks, status,
        financial_year, budget_id, budget_line_id, created_by, created_at)
       VALUES (?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?,?,NOW())`,
      [
        id,
        payload.grnType,
        payload.branchId,
        payload.companyCode?.trim() || null,
        budgetLine.process_id ?? null,
        budgetLine.cost_centre_id ?? null,
        costClass,
        vendor.vendorId,
        vendor.vendorName,
        budgetLine.head,
        budgetLine.sub_head ?? "",
        quantity,
        budgetLine.unit,
        unitRate,
        isImprest ? IMPREST_TAX_PROFILE.taxTreatment : budgetLine.tax_treatment,
        isImprest ? IMPREST_TAX_PROFILE.gstRate : budgetLine.gst_rate,
        isImprest ? IMPREST_TAX_PROFILE.gstType : budgetLine.gst_type,
        isImprest ? IMPREST_TAX_PROFILE.recoverableTaxPct : budgetLine.recoverable_tax_pct,
        amountsForGrn.baseAmount,
        amountsForGrn.taxAmount,
        amountsForGrn.grossAmount,
        amountsForGrn.pnlCostAmount,
        amountsForGrn.grossAmount,
        payload.billDate,
        accountingPeriod,
        paymentTermsDays,
        dueDate,
        budgetLine.item_name,
        payload.remarks?.trim() || null,
        financialYear,
        budgetLine.budget_id,
        budgetLine.id,
        actorUserId,
      ]
    );

    // A GRN's history should start where the GRN does. Without this the readable trail began
    // at 'submitted' and could not answer who raised the document, against which budget line.
    await recordFinanceApprovalEvent({
      entityType: "grn",
      entityId: id,
      action: "create",
      fromStatus: null,
      toStatus: "draft",
      actorUserId,
      actorRole,
      details: {
        branchId: payload.branchId,
        budgetLineId: budgetLine.id,
        unbudgeted: false,
      },
    });
    await writeGrnAudit("CREATE_DRAFT", id, actorUserId, actorRole, {
      grn_number: null,
      budget_id: budgetLine.budget_id,
      budget_line_id: budgetLine.id,
      process_id: budgetLine.process_id ?? null,
      cost_centre_id: budgetLine.cost_centre_id ?? null,
      cost_class: costClass,
      quantity,
      unit: budgetLine.unit,
      unit_rate: unitRate,
      amount_without_tax: amountsForGrn.baseAmount,
      tax_amount: amountsForGrn.taxAmount,
      amount_with_tax: amountsForGrn.grossAmount,
    });
    return { id, grnNumber: null };
  },

  async submitForApproval(
    grnId: string,
    payload: SubmitGrnPayload,
    actorUserId: string,
    actorRole: string
  ) {
    const grn = await getGrnOrThrow(grnId);
    // P0-2: a type with no accounting lifecycle cannot be submitted — fail closed.
    assertGrnTypeSupported(grn.grn_type, "Submission");
    if (grn.status !== "draft") {
      throw new Error(`GRN is already ${grn.status}, cannot submit`);
    }
    if (!grn.budget_line_id) {
      throw new Error("GRN is not linked to an approved budget line");
    }
    if (!grn.attachment_path && !grn.attachment_file_path) {
      throw new Error("Invoice / supporting attachment is required before submission");
    }

    // Owner ruling: a GRN number is assigned at FINAL (Finance Head) approval, not at
    // submission — mirrors the live path's own change in grn-validation-control.service.ts's
    // submit(). See resolveGrnNumberOnSubmit's caller in reviewGrn() below and in
    // grn-smart.service.ts's review(). An existing number (re-submit after return, or a legacy
    // migrated row) is left exactly as it was.
    const grnNumber = grn.grn_number ?? null;

    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE grn_request
          SET status = 'submitted',
              submitted_by = ?,
              submitted_at = NOW(),
              remarks = COALESCE(?, remarks)
        WHERE id = ? AND status = 'draft'`,
      [actorUserId, payload.remarks?.trim() || null, grnId]
    );
    if (result.affectedRows !== 1) {
      throw new Error("GRN status changed before submission; refresh and try again");
    }

    await writeGrnAudit("SUBMIT", grnId, actorUserId, actorRole, {
      remarks: payload.remarks,
      grn_number: grnNumber,
    });
    /*
     * Also recorded on the WORKFLOW trail, not only the security one.
     *
     * writeGrnAudit -> logSensitiveAction is deliberately non-throwing: it catches, prints to
     * stderr and lets the operation continue. Correct for telemetry, wrong for the record of
     * how a GRN moved through its approval chain — that trail already held approve, reject,
     * return, resubmit and reverse, so 'submitted' was the one transition missing from the
     * only history a reviewer can read back (GET /grns/:id/approval-history), and it is the
     * transition that starts the chain. Both writes stay; they answer different questions.
     */
    await recordFinanceApprovalEvent({
      entityType: "grn",
      entityId: grnId,
      action: "submit",
      fromStatus: "draft",
      toStatus: "submitted",
      actorUserId,
      actorRole,
      remarks: payload.remarks?.trim() || null,
      details: { grnNumber: String(grnNumber ?? ""), branchId: String(grn.branch_id ?? "") },
    });
    return { success: true, newStatus: "submitted" as const, grnNumber };
  },

  async reviewGrn(
    grnId: string,
    payload: ReviewGrnPayload,
    actorUserId: string,
    actorRole: string
  ) {
    if (!payload || !["approved", "rejected"].includes(payload.decision)) {
      throw new Error("Review decision must be approved or rejected");
    }
    if (payload.decision === "rejected" && !payload.reviewNote?.trim()) {
      throw new Error("Review remarks are required when rejecting a GRN");
    }

    const role = actorRole.toLowerCase();
    const connection = await db.getConnection();
    let paymentId: string | null = null;
    let newStatus: GrnStatus;
    let grnNumber: string | null = null;

    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM grn_request WHERE id = ? FOR UPDATE`,
        [grnId]
      );
      const grn = rows[0] as any;
      if (!grn) throw new Error("GRN not found");
      if (!grn.budget_line_id) throw new Error("GRN has no approved budget mapping");

      const effectiveStage = role === "super_admin"
        ? grn.status === "submitted"
          ? "branch_head"
          : grn.status === "branch_head_approved"
            ? "finance_head"
            : null
        : role;

      // P0-2: a type with no payment/ledger/reversal lifecycle cannot be approved.
      assertGrnTypeSupported(grn.grn_type, "Approval");

      // P0-3: Re-check period lock inside the transaction immediately before the financial
      // mutation. Guards against a concurrent lock applied after the API-level check in
      // createDraft() but before this approval actually changes reserved/consumed figures.
      const grnPeriod = String(grn.accounting_period ?? grn.bill_date ?? "").substring(0, 7);
      if (grnPeriod && await isPeriodLocked(grnPeriod, connection)) {
        throw new Error(
          `${grnPeriod} was locked for P&L close before this approval completed. `
          + "Resubmit the GRN against the current open period."
        );
      }

      // P0P1-4: Enforce actor-identity maker-checker, not role names alone.
      // Applies to approvals only — rejections do not create financial commitments.
      if (payload.decision === "approved") {
        if (
          effectiveStage === "branch_head"
          && grn.submitted_by
          && String(grn.submitted_by) === actorUserId
        ) {
          throw new Error(
            "Maker-checker violation: the same person cannot submit and Branch Head-approve the same GRN"
          );
        }
        if (effectiveStage === "finance_head") {
          if (grn.submitted_by && String(grn.submitted_by) === actorUserId) {
            throw new Error(
              "Maker-checker violation: Finance Head cannot be the person who submitted this GRN"
            );
          }
          if (grn.branch_head_reviewed_by && String(grn.branch_head_reviewed_by) === actorUserId) {
            throw new Error(
              "Maker-checker violation: Finance Head cannot be the person who performed the Branch Head review"
            );
          }
        }
      }

      if (effectiveStage === "branch_head") {
        if (grn.status !== "submitted") {
          throw new Error(
            `Branch Head can only review submitted GRNs. Current status: ${grn.status}`
          );
        }

        if (payload.decision === "approved") {
          await budgetConsumptionService.reserve(
            connection,
            grn.budget_line_id,
            Number(grn.amount_with_tax || grn.amount),
            Number(grn.quantity),
            Number(grn.amount_without_tax) || undefined,
          );
          newStatus = "branch_head_approved";
        } else {
          newStatus = "rejected";
        }

        // Expected status included in WHERE so a concurrent approval (e.g. a double-submitted
        // click, or a second reviewer racing this one) yields affectedRows === 0 instead of
        // silently overwriting a transition that already happened. The FOR UPDATE lock above
        // already serializes concurrent reviewers of this exact row, but that protection
        // depends entirely on every future caller reading through this same locked
        // transaction; this WHERE clause is the same atomic guard used by submit() above and
        // by cancelGrn/returnGrn/resubmitReturnedGrn elsewhere in this file, so a stray
        // refactor that drops the FOR UPDATE read doesn't silently reopen double-approval.
        const [bhUpdateResult] = await connection.execute<ResultSetHeader>(
          `UPDATE grn_request
              SET status = ?,
                  branch_head_reviewed_by = ?,
                  branch_head_reviewed_at = NOW(),
                  branch_head_review_note = ?,
                  reviewed_by = ?,
                  reviewed_at = NOW(),
                  review_note = ?,
                  rejection_reason = ?
            WHERE id = ? AND status = 'submitted'`,
          [
            newStatus,
            actorUserId,
            payload.reviewNote?.trim() || null,
            actorUserId,
            payload.reviewNote?.trim() || null,
            payload.decision === "rejected" ? payload.reviewNote?.trim() : null,
            grnId,
          ]
        );
        if (bhUpdateResult.affectedRows !== 1) {
          throw Object.assign(
            new Error("GRN state changed concurrently; refresh and try again"),
            { code: "STATE_CHANGED", statusCode: 409 }
          );
        }
      } else if (effectiveStage === "finance_head") {
        if (grn.status !== "branch_head_approved") {
          throw new Error(
            `Finance Head can only review Branch Head-approved GRNs. Current status: ${grn.status}`
          );
        }

        if (payload.decision === "approved") {
          await budgetConsumptionService.consume(
            connection,
            grn.budget_line_id,
            Number(grn.amount_with_tax || grn.amount),
            Number(grn.quantity),
            Number(grn.amount_without_tax) || undefined,
          );
          newStatus = grn.grn_type === "vendor"
            ? "pending_accounts_payment"
            : "approved";

          // Owner ruling: a GRN number is assigned at FINAL (Finance Head) approval, not at
          // submission — see the same change in grn-smart.service.ts's review() and
          // grn-validation-control.service.ts's submit(). A rejected GRN never reaches this
          // branch, so it never gets one.
          grnNumber = await resolveGrnNumberOnSubmit(grn);

          const [fhUpdateResult] = await connection.execute<ResultSetHeader>(
            `UPDATE grn_request
                SET status = ?,
                    accounts_payment_status = ?,
                    finance_head_reviewed_by = ?,
                    finance_head_reviewed_at = NOW(),
                    finance_head_review_note = ?,
                    reviewed_by = ?,
                    reviewed_at = NOW(),
                    review_note = ?,
                    approved_by = ?,
                    approved_at = NOW(),
                    rejection_reason = NULL,
                    grn_number = COALESCE(grn_number, ?)
              WHERE id = ? AND status = 'branch_head_approved'`,
            [
              newStatus,
              grn.grn_type === "vendor" ? "pending" : "not_required",
              actorUserId,
              payload.reviewNote?.trim() || null,
              actorUserId,
              payload.reviewNote?.trim() || null,
              actorUserId,
              grnNumber,
              grnId,
            ]
          );
          if (fhUpdateResult.affectedRows !== 1) {
            throw Object.assign(
              new Error("GRN state changed concurrently; refresh and try again"),
              { code: "STATE_CHANGED", statusCode: 409 }
            );
          }

          if (grn.grn_type === "vendor") {
            paymentId = await vendorPaymentService.createFromGrn(
              grnId,
              actorUserId,
              connection
            );
          }
        } else {
          await budgetConsumptionService.release(
            connection,
            grn.budget_line_id,
            Number(grn.amount_with_tax || grn.amount),
            Number(grn.quantity),
            Number(grn.amount_without_tax) || undefined,
          );
          newStatus = "rejected";
          const [fhRejectResult] = await connection.execute<ResultSetHeader>(
            `UPDATE grn_request
                SET status = 'rejected',
                    finance_head_reviewed_by = ?,
                    finance_head_reviewed_at = NOW(),
                    finance_head_review_note = ?,
                    reviewed_by = ?,
                    reviewed_at = NOW(),
                    review_note = ?,
                    rejection_reason = ?
              WHERE id = ? AND status = 'branch_head_approved'`,
            [
              actorUserId,
              payload.reviewNote?.trim(),
              actorUserId,
              payload.reviewNote?.trim(),
              payload.reviewNote?.trim(),
              grnId,
            ]
          );
          if (fhRejectResult.affectedRows !== 1) {
            throw Object.assign(
              new Error("GRN state changed concurrently; refresh and try again"),
              { code: "STATE_CHANGED", statusCode: 409 }
            );
          }
        }
      } else {
        throw new Error(`Role ${actorRole} is not permitted to review GRNs`);
      }

      /*
       * The approval and the rejection, recorded — the two decisions this history existed to
       * hold and the only two it did not.
       *
       * finance_approval_event was written by the billing-cycle, return and resubmit paths and
       * by imprest, but never here. GET /grns/:id/approval-history reads nothing else, so a GRN
       * that went submitted -> branch_head_approved -> approved showed an empty timeline, while
       * the queue told reviewers "the reason is kept on the voucher's history". Only a RETURNED
       * voucher produced any rows at all, which is why the endpoint looked half-alive rather
       * than dead. Confirmed against production: the table holds zero rows.
       *
       * One event covers both stages: newStatus and grn.status are set on every path that
       * reaches here, so there is no branch left to forget. Written on the same connection as
       * the status UPDATE, so the event and the transition commit or roll back together —
       * a history row surviving a rolled-back approval would assert something that never
       * happened. recordFinanceApprovalEvent throws rather than swallowing, and that is
       * deliberate: a history that can silently drop a row is not a history.
       *
       * actorRole is the stage that was cleared, not the actor's primary role, so a super_admin
       * acting at the Branch Head stage reads as branch_head — the question later is "which
       * stage was passed", not "who was logged in".
       */
      await recordFinanceApprovalEvent(
        {
          entityType: "grn",
          entityId: grnId,
          action: payload.decision === "approved" ? "approve" : "reject",
          fromStatus: String(grn.status),
          toStatus: newStatus,
          decision: payload.decision,
          actorUserId,
          actorRole: effectiveStage,
          remarks: payload.reviewNote?.trim() || null,
          details: paymentId ? { vendorPaymentId: paymentId } : undefined,
        },
        connection
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await writeGrnAudit(
      payload.decision.toUpperCase(),
      grnId,
      actorUserId,
      actorRole,
      {
        review_note: payload.reviewNote,
        new_status: newStatus!,
        payment_id: paymentId,
      }
    );
    if (paymentId) {
      await vendorPaymentService.notifyPaymentPending(paymentId).catch(() => undefined);
    }
    return { success: true, newStatus: newStatus!, paymentId, grnNumber };
  },

  async cancelGrn(grnId: string, actorUserId: string, actorRole: string) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM grn_request WHERE id = ? FOR UPDATE`,
        [grnId]
      );
      const grn = rows[0] as any;
      if (!grn) throw new Error("GRN not found");
      if (
        [
          "finance_head_approved",
          "pending_accounts_payment",
          "payment_scheduled",
          "partially_paid",
          "paid",
          "approved",
          "cancelled",
        ].includes(grn.status)
      ) {
        throw new Error(`Cannot cancel a GRN with status '${grn.status}'`);
      }

      if (grn.status === "branch_head_approved" && grn.budget_line_id) {
        await budgetConsumptionService.release(
          connection,
          grn.budget_line_id,
          Number(grn.amount_with_tax || grn.amount),
          Number(grn.quantity),
          Number(grn.amount_without_tax) || undefined,
        );
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE grn_request
            SET status = 'cancelled', reviewed_by = ?, reviewed_at = NOW()
          WHERE id = ? AND status = ?`,
        [actorUserId, grnId, grn.status]
      );
      if (result.affectedRows !== 1) {
        throw new Error("GRN status changed before cancellation; refresh and try again");
      }
      // Cancellation is terminal and can release consumed budget, so it belongs on the readable
      // workflow trail as much as an approval does. On the SAME connection as the UPDATE and the
      // release, per recordFinanceApprovalEvent's contract: if the cancellation rolls back, the
      // event saying it happened must roll back with it.
      await recordFinanceApprovalEvent(
        {
          entityType: "grn",
          entityId: grnId,
          action: "cancel",
          fromStatus: String(grn.status),
          toStatus: "cancelled",
          actorUserId,
          actorRole,
          details: { grnNumber: String(grn.grn_number ?? ""), branchId: String(grn.branch_id ?? "") },
        },
        connection
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await writeGrnAudit("CANCEL", grnId, actorUserId, actorRole, {});
    return { success: true };
  },

  /**
   * Permanently removes a draft GRN — the creator's undo button, distinct from cancelGrn above
   * (which only ever flips status to 'cancelled' and is meant for GRNs already in flight).
   *
   * Restricted to status='draft': budget is never reserved at draft (reserve() only runs from
   * submitForApproval, see budgetConsumptionService.reserve call site), so there is nothing to
   * release — a hard delete here cannot desync the budget ledger the way deleting a submitted
   * GRN could.
   *
   * Restricted to the creator or a super_admin: unlike cancelGrn, this is destructive and
   * unrecoverable, so it is deliberately narrower than GRN_WRITE_ROLES branch-level access.
   *
   * Every child table cascades on grn_request_id EXCEPT grn_invoice_component (1074_grn_invoice_
   * gst_components.sql never added ON DELETE CASCADE), so that one is cleared explicitly first.
   * finance_approval_event and audit_action_log/sensitive_action_log rows are left in place on
   * purpose — entity_id there is deliberately un-keyed (1089_finance_approval_event.sql) so a
   * deleted GRN's audit trail still reads, just against an id that no longer resolves.
   */
  async deleteDraftGrn(grnId: string, actorUserId: string, actorRole: string) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT id, status, created_by, grn_number, branch_id FROM grn_request WHERE id = ? FOR UPDATE`,
        [grnId]
      );
      const grn = rows[0] as any;
      if (!grn) throw new Error("GRN not found");
      if (grn.status !== "draft") {
        throw new Error(`Only a draft GRN can be deleted (current status '${grn.status}')`);
      }
      const isOwner = String(grn.created_by ?? "") === String(actorUserId);
      if (!isOwner && actorRole !== "super_admin") {
        throw Object.assign(
          new Error("Only the GRN's creator or a Super Admin may delete a draft"),
          { statusCode: 403 }
        );
      }

      await connection.execute(`DELETE FROM grn_invoice_component WHERE grn_request_id = ?`, [grnId]);

      await recordFinanceApprovalEvent(
        {
          entityType: "grn",
          entityId: grnId,
          action: "delete_draft",
          fromStatus: "draft",
          toStatus: "deleted",
          actorUserId,
          actorRole,
          details: { grnNumber: String(grn.grn_number ?? ""), branchId: String(grn.branch_id ?? "") },
        },
        connection
      );

      const [result] = await connection.execute<ResultSetHeader>(
        `DELETE FROM grn_request WHERE id = ? AND status = 'draft'`,
        [grnId]
      );
      if (result.affectedRows !== 1) {
        throw new Error("GRN status changed before deletion; refresh and try again");
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await writeGrnAudit("DELETE_DRAFT", grnId, actorUserId, actorRole, {});
    return { success: true };
  },

  /** Corrects a Finance-Head-approved GRN that should not have consumed budget — releases the
   *  consumed_amount/consumed_quantity back onto the budget line and moves the GRN to a
   *  terminal 'consumption_reversed' status. Symmetric to the release() already used when a
   *  GRN is rejected before reaching this stage; there was previously no way back once a GRN
   *  passed finance_head_approved (cancelGrn explicitly refuses at that point). */
  async reverseConsumption(
    grnId: string,
    reason: string,
    actorUserId: string,
    actorRole: string
  ) {
    const trimmedReason = reason?.trim();
    if (!trimmedReason) {
      throw new Error("A reason is required to reverse a GRN's budget consumption");
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM grn_request WHERE id = ? FOR UPDATE`,
        [grnId]
      );
      const grn = rows[0] as any;
      if (!grn) throw new Error("GRN not found");
      if (!CONSUMED_GRN_STATUSES.includes(grn.status)) {
        throw new Error(
          `Cannot reverse consumption for a GRN with status '${grn.status}' — it has not consumed budget, or has already been reversed`
        );
      }

      if (await grnSmartService.hasAllocations(grnId)) {
        await grnSmartService.reverseConsumption(connection, grnId);
      } else {
        await budgetConsumptionService.reverseConsumption(
          connection,
          grn.budget_line_id,
          Number(grn.amount_with_tax || grn.amount),
          Number(grn.quantity),
          Number(grn.amount_without_tax) || undefined,
        );
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE grn_request
            SET status = 'consumption_reversed',
                reviewed_by = ?,
                reviewed_at = NOW(),
                review_note = ?,
                rejection_reason = ?
          WHERE id = ? AND status = ?`,
        [actorUserId, trimmedReason, trimmedReason, grnId, grn.status]
      );
      if (result.affectedRows !== 1) {
        throw new Error("GRN status changed before reversal; refresh and try again");
      }
      // Write into the reviewer-facing financial timeline inside the transaction so the
      // approval sequence never shows a complete chain with the reversal silently elsewhere.
      await recordFinanceApprovalEvent({
        entityType: "grn",
        entityId: grnId,
        action: "reverse",
        fromStatus: String(grn.status),
        toStatus: "consumption_reversed",
        decision: "reversed",
        actorUserId,
        actorRole,
        remarks: trimmedReason,
      }, connection);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await writeGrnAudit("CONSUMPTION_REVERSED", grnId, actorUserId, actorRole, {
      reason: trimmedReason,
    });
    return { success: true };
  },

  async listGrns(filters: {
    branchId?: string;
    /**
     * Multi-branch scope. Wins over `branchId` when present.
     *
     * Both are accepted so routers can migrate one at a time: an unmigrated caller keeps
     * passing a single `branchId` and behaves exactly as before.
     */
    branchScope?: FinanceBranchScope;
    processId?: string;
    costCentreId?: string;
    costClass?: string;
    status?: string;
    financialYear?: string;
    grnType?: string;
    search?: string;
    // Requirement 14 — the GRN Search workspace. Free-text `search` stays; these are the
    // structured filters, which an operator needs to answer "which GRNs are this vendor's,
    // in August, over a lakh, still unpaid" without scrolling.
    grnNumber?: string;
    invoiceNumber?: string;
    vendorId?: string;
    head?: string;
    subHead?: string;
    billingCycleStatus?: string;
    accountingPeriod?: string;
    billDateFrom?: string;
    billDateTo?: string;
    amountFrom?: number;
    amountTo?: number;
    createdBy?: string;
    multiMonth?: boolean;
    page?: number;
    limit?: number;
    /** Opt-in only — GRN Search and other existing callers must keep showing drafts by default. */
    excludeDraft?: boolean;
  }) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.branchScope) {
      const filter = financeBranchFilter(filters.branchScope, "g.branch_id");
      if (filter.sql !== "1=1") {
        conditions.push(filter.sql);
        params.push(...filter.params);
      }
    } else if (filters.branchId) {
      conditions.push("g.branch_id = ?");
      params.push(filters.branchId);
    }
    if (filters.processId) {
      conditions.push("g.process_id = ?");
      params.push(filters.processId);
    }
    if (filters.costCentreId) {
      // A GRN split across more than one cost centre has its own header cost_centre_id set to
      // NULL by grn-smart.service.ts (saveAllocations/saveComponentAllocations) — the real
      // per-cost-centre truth lives in grn_cost_allocation, which is what
      // budget-cost-centre-utilization.service.ts already reads for the "Consumed" figure.
      // Matching that same lifecycle_status set here keeps the drill-down and the consumed
      // figure agreeing on what counts.
      conditions.push(`(
        g.cost_centre_id = ?
        OR EXISTS (
          SELECT 1 FROM grn_cost_allocation gca
           WHERE gca.grn_request_id = g.id
             AND gca.cost_centre_id = ?
             AND gca.lifecycle_status IN ('reserved', 'consumed')
        )
      )`);
      params.push(filters.costCentreId, filters.costCentreId);
    }
    if (filters.costClass) {
      conditions.push("g.cost_class = ?");
      params.push(filters.costClass);
    }
    if (filters.status) {
      conditions.push("g.status = ?");
      params.push(filters.status);
    }
    if (filters.excludeDraft) {
      conditions.push("g.status <> 'draft'");
    }
    if (filters.financialYear) {
      conditions.push("g.financial_year = ?");
      params.push(filters.financialYear);
    }
    if (filters.grnType) {
      conditions.push("g.grn_type = ?");
      params.push(filters.grnType);
    }
    if (filters.search) {
      conditions.push(
        "(g.grn_number LIKE ? OR g.vendor_name LIKE ? OR g.head LIKE ? OR g.description LIKE ?)"
      );
      const like = `%${filters.search}%`;
      params.push(like, like, like, like);
    }
    // Partial match on the two identifiers people actually quote at each other.
    if (filters.grnNumber) {
      conditions.push("g.grn_number LIKE ?");
      params.push(`%${filters.grnNumber}%`);
    }
    if (filters.invoiceNumber) {
      conditions.push("g.invoice_number LIKE ?");
      params.push(`%${filters.invoiceNumber}%`);
    }
    if (filters.vendorId) {
      conditions.push("g.vendor_id = ?");
      params.push(filters.vendorId);
    }
    if (filters.head) {
      // For split GRNs the smart flow overwrites grn_request.head with the last component's value,
      // so a plain equality misses GRNs where this head was one of several components. When a cost
      // centre filter is also active, check through grn_cost_allocation → finance_budget_line too.
      if (filters.costCentreId) {
        conditions.push(`(
          g.head = ?
          OR EXISTS (
            SELECT 1 FROM grn_cost_allocation gca_h
            JOIN finance_budget_line bl_h ON bl_h.id = gca_h.budget_line_id
            WHERE gca_h.grn_request_id = g.id
              AND gca_h.lifecycle_status IN ('reserved', 'consumed')
              AND bl_h.head = ?
          )
        )`);
        params.push(filters.head, filters.head);
      } else {
        conditions.push("g.head = ?");
        params.push(filters.head);
      }
    }
    if (filters.subHead) {
      // Same split-GRN problem as head above: check both grn_request.sub_head and alloc rows.
      if (filters.costCentreId) {
        conditions.push(`(
          g.sub_head = ?
          OR EXISTS (
            SELECT 1 FROM grn_cost_allocation gca_s
            JOIN finance_budget_line bl_s ON bl_s.id = gca_s.budget_line_id
            WHERE gca_s.grn_request_id = g.id
              AND gca_s.lifecycle_status IN ('reserved', 'consumed')
              AND bl_s.sub_head = ?
          )
        )`);
        params.push(filters.subHead, filters.subHead);
      } else {
        conditions.push("g.sub_head = ?");
        params.push(filters.subHead);
      }
    }
    if (filters.billingCycleStatus) {
      // 'UNCLASSIFIED' is how the UI asks for historical rows, which are NULL because the
      // column postdates them. A plain equality would silently return nothing for those.
      if (filters.billingCycleStatus === "UNCLASSIFIED") {
        conditions.push("g.billing_cycle_status IS NULL");
      } else {
        conditions.push("g.billing_cycle_status = ?");
        params.push(filters.billingCycleStatus);
      }
    }
    if (filters.accountingPeriod) {
      // Falls back to bill_date for rows raised before accounting_period existed, so a period
      // filter does not simply hide every historical GRN.
      conditions.push(
        "COALESCE(g.accounting_period, DATE_FORMAT(g.bill_date, '%Y-%m')) = ?"
      );
      params.push(filters.accountingPeriod);
    }
    if (filters.billDateFrom) {
      conditions.push("g.bill_date >= ?");
      params.push(filters.billDateFrom);
    }
    if (filters.billDateTo) {
      conditions.push("g.bill_date <= ?");
      params.push(filters.billDateTo);
    }
    // Compared against the gross, which is what the list column shows — filtering on a
    // different figure from the one on screen is how "the filter is broken" reports start.
    if (filters.amountFrom !== undefined && Number.isFinite(filters.amountFrom)) {
      conditions.push("COALESCE(g.amount_with_tax, g.amount) >= ?");
      params.push(filters.amountFrom);
    }
    if (filters.amountTo !== undefined && Number.isFinite(filters.amountTo)) {
      conditions.push("COALESCE(g.amount_with_tax, g.amount) <= ?");
      params.push(filters.amountTo);
    }
    if (filters.createdBy) {
      conditions.push("g.created_by = ?");
      params.push(filters.createdBy);
    }
    if (filters.multiMonth !== undefined) {
      conditions.push("COALESCE(g.is_multi_month, 0) = ?");
      params.push(filters.multiMonth ? 1 : 0);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 30));
    const offset = (page - 1) * limit;

    // mysql2 3.22.3 throws ER_WRONG_ARGUMENTS (errno 1210) binding LIMIT/OFFSET
    // via execute()'s prepared-statement protocol on this server — reproduced
    // even for a trivial single-column, no-join query. limit/offset are
    // server-clamped numbers (Math.min/Math.max above), never raw user input,
    // so query()'s text protocol is safe here.
    // Named per stage (not just the latest generic reviewed_by) so a history/timeline view can
    // show who actually acted at Branch Head vs Finance Head, not just who touched it last.
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT g.*,
              bm.branch_name,
              pm.process_name,
              ccm.cost_centre_name,
              h.budget_number,
              l.item_name AS budget_item_name,
              -- listLegacyGrns (the source=legacy mirror) always sets this literal; a legacy row
              -- migrated straight into grn_request needs the same signal computed from
              -- bill_source_id, or the History "Legacy" badge and any future legacy-only styling
              -- silently never fires for these 84,767 rows under the default source=new view.
              CASE WHEN g.bill_source_id IS NOT NULL THEN 'legacy' ELSE 'new' END AS source_type,
              -- Legacy rows (bill_source_id IS NOT NULL) never got a real created_by/
              -- reviewed_by/*_reviewed_by FK — migrate-grn-from-dbbill.ts wrote a single
              -- migration-sentinel user for all 84,767 of them, so these employees joins miss
              -- and CONCAT(...) returns NULL. Falls back to the legacy_*_name columns
              -- (sql/1511_grn_legacy_identity_columns.sql), resolved from db_bill's own
              -- userid/ApprovedBy fields, so History/Approval Queue show a real name instead of
              -- blank. legacy_approved_by_name is one flat field (db_bill never had a separate
              -- Branch Head / Finance Head approval stage — verified never populated across its
              -- full history), routed to whichever review column matches this row's own
              -- two-stage model: Branch Head for imprest, Finance Head for vendor/salary.
              COALESCE(CONCAT(cb.first_name, ' ', cb.last_name), g.legacy_raised_by_name) AS created_by_name,
              COALESCE(CONCAT(rb.first_name, ' ', rb.last_name), g.legacy_approved_by_name) AS reviewed_by_name,
              COALESCE(
                CONCAT(bhb.first_name, ' ', bhb.last_name),
                CASE WHEN g.grn_type = 'imprest' THEN g.legacy_approved_by_name END
              ) AS branch_head_reviewed_by_name,
              COALESCE(
                CONCAT(fhb.first_name, ' ', fhb.last_name),
                CASE WHEN g.grn_type <> 'imprest' THEN g.legacy_approved_by_name END
              ) AS finance_head_reviewed_by_name
         FROM grn_request g
         LEFT JOIN branch_master bm ON bm.id = g.branch_id
         LEFT JOIN process_master pm ON pm.id = g.process_id
         LEFT JOIN cost_centre_master ccm ON ccm.id = g.cost_centre_id
         LEFT JOIN finance_budget_header h ON h.id = g.budget_id
         LEFT JOIN finance_budget_line l ON l.id = g.budget_line_id
         LEFT JOIN employees cb ON cb.user_id = g.created_by
         LEFT JOIN employees rb ON rb.user_id = g.reviewed_by
         LEFT JOIN employees bhb ON bhb.user_id = g.branch_head_reviewed_by
         LEFT JOIN employees fhb ON fhb.user_id = g.finance_head_reviewed_by
         ${where}
        ORDER BY g.created_at DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM grn_request g ${where}`,
      params
    );

    return {
      data: (rows as RowDataPacket[]).map(decorateGrnPendency),
      total: Number(countRows[0]?.total ?? 0),
      page,
      limit,
    };
  },

  async listLegacyGrns(filters: {
    branchScope?: FinanceBranchScope;
    processId?: string;
    costCentreId?: string;
    status?: string;
    grnNumber?: string;
    head?: string;
    subHead?: string;
    accountingPeriod?: string;
    billDateFrom?: string;
    billDateTo?: string;
    amountFrom?: number;
    amountTo?: number;
    search?: string;
    page?: number;
    limit?: number;
    /**
     * Accepted purely so `sharedFilters` (shared with listGrns) type-checks cleanly when both
     * are spread from the same object in grn.routes.ts. Legacy rows (bill_source_id IS NOT
     * NULL, migrated from db_bill) have no meaningful "draft" status concept — this is a no-op
     * here, not an invented draft semantics for legacy data.
     */
    excludeDraft?: boolean;
  }) {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.branchScope) {
      if (filters.branchScope.mode !== "all") {
        const { sql, params: bParams } = legacyBranchCondition(filters.branchScope);
        conditions.push(sql);
        params.push(...bParams);
      }
    }

    if (filters.costCentreId) {
      conditions.push(`EXISTS (
        SELECT 1
          FROM grn_entry_line_snapshot l
          JOIN cost_centre_master ccm
            ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
             = l.cost_centre_code  COLLATE utf8mb4_unicode_ci
         WHERE l.grn_source_id = g.bill_source_id
           AND ccm.id = ?
      )`);
      params.push(filters.costCentreId);
    }

    if (filters.processId) {
      conditions.push(`EXISTS (
        SELECT 1
          FROM grn_entry_line_snapshot l
          JOIN cost_centre_master ccm
            ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
             = l.cost_centre_code  COLLATE utf8mb4_unicode_ci
          JOIN employees e
            ON e.cost_centre_id = ccm.id
           AND e.active_status   = 1
           AND e.process_id IS NOT NULL
         WHERE l.grn_source_id = g.bill_source_id
           AND e.process_id = ?
      )`);
      params.push(filters.processId);
    }

    // Mirrors the CASE below that derives the `status` column returned per row — see the note
    // there on why entry_status alone cannot tell "approved" from "still pending".
    if (filters.status) {
      if (filters.status === "rejected") {
        conditions.push("g.is_rejected = 1");
      } else if (filters.status === "approved" || filters.status === "paid") {
        conditions.push(
          "g.is_rejected = 0 AND (g.entry_status = 'Close' OR (g.entry_status <> 'Booked' AND g.approved_at IS NOT NULL))"
        );
      } else if (
        filters.status === "pending_accounts_payment" ||
        filters.status === "payment_scheduled"
      ) {
        conditions.push("g.is_rejected = 0 AND g.entry_status = 'Booked'");
      } else if (filters.status === "submitted" || filters.status === "branch_head_approved") {
        conditions.push(
          "g.is_rejected = 0 AND g.entry_status NOT IN ('Close', 'Booked') AND g.approved_at IS NULL"
        );
      } else {
        conditions.push("1 = 0");
      }
    } else {
      conditions.push("g.is_rejected = 0");
    }

    if (filters.accountingPeriod) {
      conditions.push("g.period_code = ?");
      params.push(filters.accountingPeriod);
    }
    if (filters.billDateFrom) {
      conditions.push("g.period_code >= ?");
      params.push(filters.billDateFrom.slice(0, 7));
    }
    if (filters.billDateTo) {
      conditions.push("g.period_code <= ?");
      params.push(filters.billDateTo.slice(0, 7));
    }

    if (filters.amountFrom !== undefined && Number.isFinite(filters.amountFrom)) {
      conditions.push("(g.amount + g.cgst + g.sgst + g.igst) >= ?");
      params.push(filters.amountFrom);
    }
    if (filters.amountTo !== undefined && Number.isFinite(filters.amountTo)) {
      conditions.push("(g.amount + g.cgst + g.sgst + g.igst) <= ?");
      params.push(filters.amountTo);
    }

    if (filters.grnNumber) {
      conditions.push("g.grn_no LIKE ?");
      params.push(`%${filters.grnNumber}%`);
    }

    if (filters.head) {
      conditions.push("(hd.head_name = ? OR g.head_id = ?)");
      params.push(filters.head, filters.head);
    }
    if (filters.subHead) {
      conditions.push("(shd.head_name = ? OR g.sub_head_id = ?)");
      params.push(filters.subHead, filters.subHead);
    }

    if (filters.search) {
      conditions.push(
        "(g.grn_no LIKE ? OR g.vendor LIKE ? OR hd.head_name LIKE ? OR g.description LIKE ?)"
      );
      const like = `%${filters.search}%`;
      params.push(like, like, like, like);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const page  = Math.max(1, filters.page  ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 30));
    const offset = (page - 1) * limit;

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT
          CONCAT('leg_', g.bill_source_id)           AS id,
          g.grn_no                                   AS grn_number,
          'legacy'                                   AS source_type,
          'vendor'                                   AS grn_type,
          g.vendor                                   AS vendor_name,
          g.branch_name,
          COALESCE(hd.head_name,  g.head_id)         AS head,
          COALESCE(shd.head_name, g.sub_head_id)     AS sub_head,
          NULL                                       AS invoice_number,
          g.bill_date,
          g.amount                                   AS amount,
          g.amount + g.cgst + g.sgst + g.igst        AS amount_with_tax,
          g.period_code                              AS accounting_period,
          -- entry_status ('Open'/'Booked'/'Close') is db_bill's booking/payment bookkeeping,
          -- NOT its approval workflow. 1,534 of 1,535 non-rejected rows synced here are
          -- 'Open' with ApprovalDate already set (approved_at) — they were already approved
          -- in db_bill and only stayed 'Open' because nothing downstream re-booked them.
          -- Reading entry_status alone put every one of those already-approved GRNs into the
          -- 'submitted' bucket, i.e. the live Approval Queue, instead of History/Approved.
          CASE
            WHEN g.is_rejected = 1           THEN 'rejected'
            WHEN g.entry_status = 'Close'    THEN 'approved'
            WHEN g.entry_status = 'Booked'   THEN 'pending_accounts_payment'
            WHEN g.approved_at IS NOT NULL   THEN 'approved'
            ELSE                                  'submitted'
          END                                        AS status,
          g.entry_status                             AS legacy_entry_status,
          NULL                                       AS billing_cycle_status,
          0                                          AS is_multi_month,
          NULL                                       AS created_by_name,
          g.source_created_at                        AS created_at,
          NULL                                       AS submitted_at,
          NULL                                       AS branch_head_reviewed_at,
          NULL                                       AS branch_head_reviewed_by_name,
          g.approved_by_fh_at                        AS finance_head_reviewed_at,
          NULL                                       AS finance_head_reviewed_by_name,
          NULL                                       AS rejection_reason,
          NULL                                       AS process_name,
          NULL                                       AS cost_centre_name,
          NULL                                       AS budget_number,
          NULL                                       AS budget_item_name,
          NULL                                       AS reviewed_by_name
        FROM grn_entry_snapshot g
        LEFT JOIN finance_expense_head_snapshot hd
               ON hd.bill_source_id = g.head_id  AND hd.head_type = 'head'
        LEFT JOIN finance_expense_head_snapshot shd
               ON shd.bill_source_id = g.sub_head_id AND shd.head_type = 'subhead'
        ${where}
        ORDER BY g.source_created_at DESC, g.bill_source_id DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
         FROM grn_entry_snapshot g
         LEFT JOIN finance_expense_head_snapshot hd
                ON hd.bill_source_id = g.head_id  AND hd.head_type = 'head'
         LEFT JOIN finance_expense_head_snapshot shd
                ON shd.bill_source_id = g.sub_head_id AND shd.head_type = 'subhead'
         ${where}`,
      params
    );

    return {
      data: rows as RowDataPacket[],
      total: Number(countRows[0]?.total ?? 0),
      page,
      limit,
    };
  },

  /**
   * Counts and rupee totals per status, for the GRN page header and its filter chips.
   *
   * This exists because listGrns clamps limit to 100 (see above), so summing amounts from a
   * fetched page silently under-reports on any branch with more than 100 GRNs — and a wrong
   * money figure on a finance screen is worse than no figure. Aggregating in SQL is exact at
   * any volume and costs one query instead of one per chip.
   *
   * Branch scope is applied by the caller via resolveFinanceBranchScope, exactly as the list
   * endpoint does; this method never widens what the caller may see.
   */
  /**
   * Sets the OPEN / BOOKED / CLOSED billing cycle status (Requirement 4).
   *
   * Deliberately its own method touching its own column. billing_cycle_status answers
   * "is another invoice expected against this service cycle?", which is orthogonal to
   * grn_request.status, the twelve-value approval and payment chain. Overloading `status`
   * would have made "is this paid" and "is this cycle finished" the same question, and they
   * are not — a monthly rental GRN can be fully paid and still OPEN.
   *
   * No approval transition ever writes this column, and this never writes `status`. A contract
   * test asserts they never appear in the same UPDATE, because the moment they do, closing a
   * billing cycle starts moving GRNs through the payment workflow.
   *
   * NULL stays reachable: historical rows predate the column and read as "Not classified".
   * Clearing back to unclassified is allowed rather than forcing a guess.
   */
  async setBillingCycleStatus(
    grnId: string,
    billingCycleStatus: "OPEN" | "BOOKED" | "CLOSED" | null,
    actorUserId: string,
  ) {
    const allowed = new Set(["OPEN", "BOOKED", "CLOSED"]);
    if (billingCycleStatus !== null && !allowed.has(billingCycleStatus)) {
      throw new Error("Billing status must be OPEN, BOOKED or CLOSED");
    }

    /*
     * The UPDATE and its history row share one transaction.
     *
     * They used to be two independent statements on the pool, with the event recorded after the
     * status had already been written. recordFinanceApprovalEvent throws by design, so a failure
     * there returned "Unable to set billing status" to the user while the billing cycle status
     * had in fact already changed — the operation reported as failed and the row said otherwise.
     * Now either both land or neither does, which is the same rule the review paths follow.
     */
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [existing] = await connection.execute<RowDataPacket[]>(
        `SELECT id, billing_cycle_status FROM grn_request WHERE id = ? FOR UPDATE`,
        [grnId],
      );
      if (!existing[0]) throw new Error("GRN not found");
      const previous = existing[0].billing_cycle_status ?? null;

      await connection.execute(
        `UPDATE grn_request SET billing_cycle_status = ? WHERE id = ?`,
        [billingCycleStatus, grnId],
      );

      await recordFinanceApprovalEvent(
        {
          entityType: "grn",
          entityId: grnId,
          action: "billing_cycle_set",
          fromStatus: previous ? String(previous) : null,
          toStatus: billingCycleStatus ?? "UNCLASSIFIED",
          actorUserId,
          actorRole: "finance",
          remarks: null,
        },
        connection,
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return { id: grnId, billing_cycle_status: billingCycleStatus };
  },

  /**
   * Sends a GRN back for correction instead of killing it (Requirement 9).
   *
   * Rejection was terminal: a voucher rejected by Finance had to be raised again from scratch,
   * and the original reason lived only in a column the next transition overwrote. That is
   * unusable for imprest, where a Branch Head is expected to correct and resubmit.
   *
   * Two return targets, deliberately distinct:
   *   returned_to_branch_head  Finance sends it back to the Branch Head, who can fix and
   *                            resubmit without the raiser being involved.
   *   returned_to_raiser       the Branch Head sends it further back to whoever raised it,
   *                            because the correction needs the original documents.
   *
   * WHY NOT REUSE 'draft'
   * `draft` means "never submitted", and saveAllocations/saveComponentAllocations gate on it.
   * Reusing it would let a returned GRN silently rewrite its allocations with nobody aware it
   * had already been through approval.
   *
   * The reservation is RELEASED on return. Holding it while the GRN sits with someone freezes
   * budget headroom for an unbounded time and starves the line — the money is not committed
   * until it comes back and is approved again.
   *
   * History is appended, never overwritten: every hop writes a finance_approval_event carrying
   * its own reason, so a GRN returned twice shows both.
   */
  async returnGrn(
    grnId: string,
    target: "branch_head" | "raiser",
    reason: string,
    actorUserId: string,
    actorRole: string,
  ) {
    if (!reason || !reason.trim()) {
      throw new Error("A reason is required to return a GRN");
    }
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM grn_request WHERE id = ? FOR UPDATE`,
        [grnId],
      );
      const grn = rows[0];
      if (!grn) throw new Error("GRN not found");
      const from = String(grn.status);

      // Only a GRN that is actually with a reviewer can be sent back. Returning a paid or
      // cancelled one would reopen something already accounted for.
      const RETURNABLE = new Set(["submitted", "branch_head_approved", "returned_to_branch_head"]);
      if (!RETURNABLE.has(from)) {
        throw new Error(`A GRN with status ${from} cannot be returned`);
      }
      const to = target === "branch_head" ? "returned_to_branch_head" : "returned_to_raiser";
      if (from === to) throw new Error(`This GRN is already ${to}`);

      // Release only from branch_head_approved — that is the only state holding a reservation.
      if (from === "branch_head_approved" && grn.budget_line_id) {
        await budgetConsumptionService.release(
          connection,
          String(grn.budget_line_id),
          Number(grn.amount_with_tax || grn.amount),
          Number(grn.quantity),
          Number(grn.amount_without_tax) || undefined,
        );
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE grn_request
            SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = NOW()
          WHERE id = ? AND status = ?`,
        [to, reason, actorUserId, grnId, from],
      );
      // Optimistic guard: someone else moved it while we were deciding.
      if (result.affectedRows !== 1) {
        throw new Error("GRN status changed during review; refresh and retry");
      }

      await recordFinanceApprovalEvent(
        {
          entityType: "grn",
          entityId: grnId,
          action: "return",
          fromStatus: from,
          toStatus: to,
          decision: target === "branch_head" ? "returned_to_branch_head" : "returned_to_raiser",
          actorUserId,
          actorRole,
          remarks: reason,
        },
        connection,
      );

      await connection.commit();
      return { id: grnId, status: to };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  /**
   * Puts a returned GRN back into the approval chain.
   *
   * From returned_to_branch_head it goes to 'submitted', NOT straight to
   * branch_head_approved — the Branch Head must approve it again, which re-reserves the
   * budget through the normal path rather than through a second reservation route here.
   */
  async resubmitReturnedGrn(grnId: string, actorUserId: string, actorRole: string, note?: string) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT id, status FROM grn_request WHERE id = ? FOR UPDATE`,
        [grnId],
      );
      const grn = rows[0];
      if (!grn) throw new Error("GRN not found");
      const from = String(grn.status);
      if (from !== "returned_to_branch_head" && from !== "returned_to_raiser") {
        throw new Error(`Only a returned GRN can be resubmitted; this one is ${from}`);
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE grn_request SET status = 'submitted', submitted_at = NOW() WHERE id = ? AND status = ?`,
        [grnId, from],
      );
      if (result.affectedRows !== 1) {
        throw new Error("GRN status changed during resubmission; refresh and retry");
      }

      await recordFinanceApprovalEvent(
        {
          entityType: "grn",
          entityId: grnId,
          action: "resubmit",
          fromStatus: from,
          toStatus: "submitted",
          actorUserId,
          actorRole,
          remarks: note ?? null,
        },
        connection,
      );

      await connection.commit();
      return { id: grnId, status: "submitted" };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async getGrnSummary(filters: {
    branchId?: string;
    branchScope?: FinanceBranchScope;
    financialYear?: string;
  }) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.branchScope) {
      const filter = financeBranchFilter(filters.branchScope, "g.branch_id");
      if (filter.sql !== "1=1") {
        conditions.push(filter.sql);
        params.push(...filter.params);
      }
    } else if (filters.branchId) {
      conditions.push("g.branch_id = ?");
      params.push(filters.branchId);
    }
    if (filters.financialYear) {
      conditions.push("g.financial_year = ?");
      params.push(filters.financialYear);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT g.status AS status,
              COUNT(*) AS count,
              COALESCE(SUM(COALESCE(g.amount_with_tax, g.amount)), 0) AS value
         FROM grn_request g
         ${where}
        GROUP BY g.status`,
      params
    );

    const byStatus: Record<string, { count: number; value: number }> = {};
    for (const row of rows) {
      byStatus[String(row.status)] = {
        count: Number(row.count ?? 0),
        value: Number(row.value ?? 0),
      };
    }

    // "In queue" spans both review stages: a GRN waiting on the Branch Head and one already
    // through it and waiting on Finance are both awaiting a decision from someone.
    const inQueue = ["submitted", "branch_head_approved"].reduce(
      (acc, status) => {
        const bucket = byStatus[status];
        if (bucket) {
          acc.count += bucket.count;
          acc.value += bucket.value;
        }
        return acc;
      },
      { count: 0, value: 0 }
    );

    return { byStatus, inQueue };
  },

  async getGrn(grnId: string) {
    return getGrnOrThrow(grnId);
  },

  async saveAttachment(
    grnId: string,
    filePath: string,
    originalName: string,
    actorUserId: string,
    mimeType?: string
  ) {
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE grn_request
          SET attachment_path = ?,
              attachment_original_name = ?,
              attachment_mime = ?,
              attachment_file_path = ?,
              attachment_file_name = ?,
              attachment_file_mime = ?
        WHERE id = ? AND status = 'draft'`,
      [
        filePath,
        originalName,
        mimeType ?? null,
        filePath,
        originalName,
        mimeType ?? null,
        grnId,
      ]
    );
    if (result.affectedRows !== 1) {
      throw new Error("Attachment can only be changed on an existing draft GRN");
    }

    await logSensitiveAction({
      actor_user_id: actorUserId,
      action_type: "GRN_ATTACHMENT_SAVED",
      module_key: "finance",
      entity_type: "grn_request",
      entity_id: grnId,
      change_summary: { filePath, originalName, mimeType },
    });
  },
};


/**
 * Adds the pendency fields the approval queue renders (Requirement 10).
 *
 * Derived, never stored. Pending-with is a pure function of status, so a column would be a
 * second source of truth free to drift from the status it describes.
 *
 * Ageing counts time in the CURRENT stage, not since the GRN was raised. Measuring from
 * creation buries a fast Finance turnaround inside a slow Branch Head one, which is the
 * opposite of what a pendency queue is for.
 *
 * LEGACY DATA HANDLING: GRNs migrated from db_bill (bill_source_id is not null) have
 * timestamps from their original creation, which can show misleadingly large ageing days.
 * For legacy data, we show ageing relative to the migration cutoff date or mark as "Legacy".
 */
function decorateGrnPendency(row: RowDataPacket): RowDataPacket {
  const status = String(row.status ?? "");
  const pending = resolvePendingWith(status, "grn");

  // Check if this is legacy data from db_bill
  const isLegacyData = Boolean(row.bill_source_id);

  // The clock restarts at each hand-off, so it reads from the most recent one.
  const stageStartedAt =
    row.branch_head_reviewed_at ?? row.submitted_at ?? row.created_at ?? null;

  let ageDays: number | null = null;
  if (pending.isPending && stageStartedAt) {
    const rawAgeDays = Math.max(0, Math.floor((Date.now() - new Date(String(stageStartedAt)).getTime()) / 86_400_000));
    // For legacy data with timestamps older than 90 days, cap at a reasonable display value
    // This handles migrated data where the original timestamps are years old
    ageDays = isLegacyData && rawAgeDays > 90 ? -1 : rawAgeDays;
  }

  return {
    ...row,
    pending_with_role: pending.role,
    pending_with: pending.label,
    is_pending: pending.isPending,
    pending_since: pending.isPending ? stageStartedAt : null,
    ageing_days: ageDays,
    age_bucket: ageDays === null ? null : ageDays === -1 ? "legacy" : ageDays <= 2 ? "0-2" : ageDays <= 7 ? "3-7" : "7+",
    is_legacy: isLegacyData,
  } as RowDataPacket;
}
