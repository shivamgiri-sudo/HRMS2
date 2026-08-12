import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { financeBranchFilter, type FinanceBranchScope } from "../finance/finance-access-scope.js";
import { tableExists } from "../../shared/dbHelpers.js";
import {
  computeLineAllocations,
  createAllocationLookupCache,
  getLineAllocations,
  replaceLineAllocations,
  type ManualAllocationInput,
} from "./branch-budget-allocation.service.js";

export type BudgetTaxTreatment =
  | "inclusive"
  | "exclusive"
  | "exempt"
  | "reverse_charge"
  | "non_gst";
export type BudgetGstType = "cgst_sgst" | "igst" | "none";
export type BudgetStatus =
  | "draft"
  | "submitted"
  | "branch_head_approved"
  | "finance_head_approved"
  | "accounts_head_approved"
  | "active"
  | "rejected"
  | "revision_required"
  | "closed";

export type BudgetPlanningLevel = "branch" | "cost_centre";

export interface BudgetLineInput {
  id?: string;
  costCentreId?: string | null;
  processId?: string | null;
  head: string;
  subHead?: string | null;
  itemName: string;
  itemDescription?: string | null;
  quantity: number;
  unit: string;
  unitRate: number;
  taxTreatment: BudgetTaxTreatment;
  gstRate: number;
  gstType?: BudgetGstType;
  recoverableTaxPct?: number;
  preferredVendorId?: string | null;
  allocationDriver?: string | null;
  justification: string;
  expenditureType?: "opex" | "capex";
  /** Defaults to "cost_centre" — today's single-attribution behaviour, unchanged. Set to
   *  "branch" to split this line's amount across the branch's active cost centres by
   *  allocationDriver (now acted on as the sharing method) instead of attributing to one. */
  planningLevel?: BudgetPlanningLevel;
  /** Only used when planningLevel = "branch" and allocationDriver = "manual". */
  manualAllocations?: ManualAllocationInput[];
  /** Only used when planningLevel = "branch". The cost centres this line actually applies to;
   *  omit to spread across every active cost centre. Lets a line that genuinely covers only part
   *  of the branch (one floor's air conditioning) exclude the rest, instead of forcing a manual
   *  split with 0% entries. */
  includedCostCentreIds?: string[] | null;
}

export interface SaveBudgetInput {
  id?: string;
  branchId: string;
  periodCode: string;
  financialYear: string;
  lines: BudgetLineInput[];
}

/** A reviewer's correction note against one head/sub-head of a budget being sent back.
 *  Anchored on head/sub-head/item rather than lineId because saveDraft() replaces the line set
 *  wholesale, so lineId goes stale as soon as the branch admin saves the requested fix. */
export interface BudgetLineCorrectionInput {
  lineId?: string | null;
  head: string;
  subHead?: string | null;
  itemName?: string | null;
  note: string;
}

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function financialYearFromPeriod(periodCode: string) {
  const [year, month] = periodCode.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) {
    throw new Error("Budget period must be a valid YYYY-MM month");
  }
  return month >= 4
    ? `${year}-${String(year + 1).slice(-2)}`
    : `${year - 1}-${String(year).slice(-2)}`;
}

export function calculateBudgetLine(line: BudgetLineInput) {
  const quantity = Number(line.quantity || 0);
  const unitRate = Number(line.unitRate || 0);
  const gstRate = Number(line.gstRate || 0);
  const quotedAmount = roundMoney(quantity * unitRate);
  let baseAmount = quotedAmount;
  let taxAmount = 0;
  let grossAmount = quotedAmount;

  if (line.taxTreatment === "inclusive" && gstRate > 0) {
    baseAmount = roundMoney(quotedAmount / (1 + gstRate / 100));
    taxAmount = roundMoney(quotedAmount - baseAmount);
  } else if (
    ["exclusive", "reverse_charge"].includes(line.taxTreatment)
    && gstRate > 0
  ) {
    taxAmount = roundMoney(quotedAmount * gstRate / 100);
    grossAmount = roundMoney(quotedAmount + taxAmount);
  }

  if (["exempt", "non_gst"].includes(line.taxTreatment)) {
    taxAmount = 0;
    grossAmount = baseAmount;
  }

  const gstType: BudgetGstType = taxAmount === 0
    ? "none"
    : line.gstType ?? "cgst_sgst";
  const recoverablePct = clamp(Number(line.recoverableTaxPct ?? 100), 0, 100);
  const recoverableTaxAmount = roundMoney(taxAmount * recoverablePct / 100);
  const pnlCostAmount = roundMoney(
    baseAmount + taxAmount - recoverableTaxAmount
  );
  const cgstAmount = gstType === "cgst_sgst"
    ? roundMoney(taxAmount / 2)
    : 0;
  const sgstAmount = gstType === "cgst_sgst"
    ? roundMoney(taxAmount - cgstAmount)
    : 0;
  const igstAmount = gstType === "igst" ? taxAmount : 0;

  return {
    baseAmount,
    taxAmount,
    grossAmount,
    recoverableTaxAmount,
    pnlCostAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    gstType,
    recoverablePct,
  };
}

function validateLine(line: BudgetLineInput, index: number) {
  const label = `Budget line ${index + 1}`;
  if (!line.head?.trim()) throw new Error(`${label}: head is required`);
  if (!line.itemName?.trim()) {
    throw new Error(`${label}: item/service is required`);
  }
  if (!line.unit?.trim()) throw new Error(`${label}: unit is required`);
  if (!line.justification?.trim()) {
    throw new Error(`${label}: justification is required`);
  }
  if (!Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0) {
    throw new Error(`${label}: quantity must be greater than zero`);
  }
  if (!Number.isFinite(Number(line.unitRate)) || Number(line.unitRate) < 0) {
    throw new Error(`${label}: unit rate cannot be negative`);
  }
  if (
    !Number.isFinite(Number(line.gstRate))
    || Number(line.gstRate) < 0
    || Number(line.gstRate) > 100
  ) {
    throw new Error(`${label}: invalid GST rate`);
  }
  if (
    line.recoverableTaxPct != null
    && (
      !Number.isFinite(Number(line.recoverableTaxPct))
      || Number(line.recoverableTaxPct) < 0
      || Number(line.recoverableTaxPct) > 100
    )
  ) {
    throw new Error(`${label}: recoverable GST must be between 0 and 100`);
  }
}

async function validateAttribution(
  connection: PoolConnection,
  branchId: string,
  line: BudgetLineInput
) {
  let processId = line.processId?.trim() || null;
  const costCentreId = line.costCentreId?.trim() || null;

  if (costCentreId) {
    const [costCentres] = await connection.execute<RowDataPacket[]>(
      `SELECT id, process_id
         FROM cost_centre_master
        WHERE id = ?
        LIMIT 1`,
      [costCentreId]
    );
    if (!costCentres[0]) throw new Error("Selected cost centre was not found");
    const mappedProcessId = costCentres[0].process_id
      ? String(costCentres[0].process_id)
      : null;
    if (processId && mappedProcessId && processId !== mappedProcessId) {
      throw new Error("Selected cost centre is mapped to a different process");
    }
    processId = processId ?? mappedProcessId;
  }

  if (processId) {
    const [processes] = await connection.execute<RowDataPacket[]>(
      `SELECT id, branch_id, active_status
         FROM process_master
        WHERE id = ?
        LIMIT 1`,
      [processId]
    );
    const process = processes[0];
    if (!process) throw new Error("Selected process was not found");
    if (Number(process.active_status ?? 1) !== 1) {
      throw new Error("Selected process is inactive");
    }
    if (process.branch_id && String(process.branch_id) !== branchId) {
      throw new Error("Selected process belongs to a different branch");
    }
  }

  if (line.preferredVendorId) {
    const [vendors] = await connection.execute<RowDataPacket[]>(
      `SELECT id, is_active
         FROM vendor_master
        WHERE id = ?
        LIMIT 1`,
      [line.preferredVendorId]
    );
    if (!vendors[0]) throw new Error("Preferred vendor was not found");
    if (Number(vendors[0].is_active ?? 0) !== 1) {
      throw new Error("Preferred vendor is inactive");
    }
  }

  return { processId, costCentreId };
}

async function generateBudgetNumber(
  connection: PoolConnection,
  branchId: string,
  periodCode: string,
  id: string
) {
  const [branches] = await connection.execute<RowDataPacket[]>(
    `SELECT branch_seq, active_status
       FROM branch_master
      WHERE id = ?
      LIMIT 1`,
    [branchId]
  );
  const branch = branches[0];
  if (!branch) throw new Error("Selected branch was not found");
  if (Number(branch.active_status ?? 1) !== 1) {
    throw new Error("Selected branch is inactive");
  }
  const branchSequence = Number(branch.branch_seq ?? 0);
  return `BUD/${branchSequence}/${periodCode.replace("-", "")}/${id
    .slice(0, 8)
    .toUpperCase()}`;
}

async function audit(
  budgetId: string,
  action: string,
  fromStatus: string | null,
  toStatus: string,
  actorId: string,
  actorRole: string,
  remarks?: string | null
) {
  await db.execute(
    `INSERT INTO finance_budget_approval_log
      (id, budget_id, action, from_status, to_status, actor_user_id, actor_role, remarks)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      randomUUID(),
      budgetId,
      action,
      fromStatus,
      toStatus,
      actorId,
      actorRole,
      remarks ?? null,
    ]
  );
}

async function auditInTransaction(
  connection: PoolConnection,
  budgetId: string,
  action: string,
  fromStatus: string | null,
  toStatus: string,
  actorId: string,
  actorRole: string,
  remarks?: string | null
) {
  await connection.execute(
    `INSERT INTO finance_budget_approval_log
      (id, budget_id, action, from_status, to_status, actor_user_id, actor_role, remarks)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      randomUUID(),
      budgetId,
      action,
      fromStatus,
      toStatus,
      actorId,
      actorRole,
      remarks ?? null,
    ]
  );
}

export interface CostCentreConsolidationLine {
  costCentreId: string;
  costCentreName: string | null;
  quantity: number;
  grossAmount: number;
  pnlCostAmount: number;
}

export interface CostCentreConsolidationGroup {
  head: string;
  subHead: string | null;
  itemName: string;
  unit: string;
  unitConsistent: boolean;
  branchUnit: number;
  branchBaseAmount: number;
  branchTaxAmount: number;
  branchGrossAmount: number;
  branchPnlCostAmount: number;
  costCentreCount: number;
  lines: CostCentreConsolidationLine[];
}

/**
 * Cost-centre-first consolidation (spec 6.2/7.2): when several cost centres each plan the same
 * conceptual budget item independently (same head/sub-head/item name), this rolls their lines up
 * into a branch-level total for reporting — "Branch amount = Sum of cost-centre amounts". A plain
 * additive sum of already-computed, already-DECIMAL-stored line amounts, not a pool being divided
 * (unlike PR 1/2's allocatePoolAmount) — so there is no rounding-residual concern here. The one
 * real risk (spec 7.2: "do not sum non-additive values... unless explicitly configured") is unit
 * consistency, not money — surfaced via unitConsistent rather than silently assumed.
 */
export function buildCostCentreConsolidation(lines: RowDataPacket[]): CostCentreConsolidationGroup[] {
  const groups = new Map<string, CostCentreConsolidationGroup>();
  for (const line of lines) {
    if (String(line.planning_level) !== "cost_centre" || !line.cost_centre_id) continue;
    const head = String(line.head);
    const subHead = line.sub_head != null ? String(line.sub_head) : null;
    const itemName = String(line.item_name);
    const unit = String(line.unit);
    const key = `${head}|${subHead ?? ""}|${itemName}`;

    const group = groups.get(key) ?? {
      head,
      subHead,
      itemName,
      unit,
      unitConsistent: true,
      branchUnit: 0,
      branchBaseAmount: 0,
      branchTaxAmount: 0,
      branchGrossAmount: 0,
      branchPnlCostAmount: 0,
      costCentreCount: 0,
      lines: [],
    };

    if (group.unit !== unit) group.unitConsistent = false;
    group.branchUnit += Number(line.quantity ?? 0);
    group.branchBaseAmount = roundMoney(group.branchBaseAmount + Number(line.base_amount ?? 0));
    group.branchTaxAmount = roundMoney(group.branchTaxAmount + Number(line.tax_amount ?? 0));
    group.branchGrossAmount = roundMoney(group.branchGrossAmount + Number(line.gross_amount ?? 0));
    group.branchPnlCostAmount = roundMoney(group.branchPnlCostAmount + Number(line.pnl_cost_amount ?? 0));
    group.costCentreCount += 1;
    group.lines.push({
      costCentreId: String(line.cost_centre_id),
      costCentreName: line.cost_centre_name != null ? String(line.cost_centre_name) : null,
      quantity: Number(line.quantity ?? 0),
      grossAmount: Number(line.gross_amount ?? 0),
      pnlCostAmount: Number(line.pnl_cost_amount ?? 0),
    });
    groups.set(key, group);
  }
  return [...groups.values()];
}

// Structurally identical to the Executor interfaces used across this session's other
// process-pnl services — same dependency-injection pattern for testability.
interface ConsolidationExecutor {
  execute<T extends RowDataPacket[] = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
}

export interface CompanyConsolidationBranchAmount {
  branchId: string;
  branchName: string | null;
  budgetStatus: string;
  quantity: number;
  grossAmount: number;
  pnlCostAmount: number;
  reservedAmount: number;
  consumedAmount: number;
  /** vendor_payment_tracking.paid_amount (the AP team's actual running-total disbursed so far),
   *  prorated across this GRN's allocation rows by each row's share of the GRN total — so a
   *  partially_paid GRN contributes its real paid-so-far amount, not zero. */
  paidAmount: number;
  /** Sum of grn_cost_allocation.pnl_cost_amount for allocations at lifecycle_status='consumed'
   *  — the same filter vw_process_lob_grn_allocation uses to source real (not planned) P&L cost,
   *  so this lines up with what Process P&L actually booked, not what was budgeted. */
  bookedToPnlAmount: number;
}

export interface CompanyConsolidationGroup {
  head: string;
  subHead: string | null;
  itemName: string;
  unit: string;
  unitConsistent: boolean;
  companyUnit: number;
  companyGrossAmount: number;
  companyPnlCostAmount: number;
  companyReservedAmount: number;
  companyConsumedAmount: number;
  companyPaidAmount: number;
  companyBookedToPnlAmount: number;
  branchCount: number;
  branches: CompanyConsolidationBranchAmount[];
}

/**
 * PR 11: company-wide (all-branches) budget consolidation — the same head/sub-head/item grouping
 * shape as buildCostCentreConsolidation (PR 6), but across every branch's budget for a period
 * instead of one branch's cost-centre lines. Every budget status is included (not just approved) —
 * a CEO needs to see which branches haven't finalized their budget yet, not have them silently
 * excluded from the rollup ("do not silently drop" — established precedent this session).
 */
export async function getCompanyBudgetConsolidation(
  periodCode: string,
  executor: ConsolidationExecutor = db
): Promise<CompanyConsolidationGroup[]> {
  const [[rows], [grnRows]] = await Promise.all([
    executor.execute<RowDataPacket[]>(
      `SELECT h.branch_id, bm.branch_name, h.status AS budget_status,
              l.id AS line_id, l.head, l.sub_head, l.item_name, l.unit, l.quantity,
              l.gross_amount, l.pnl_cost_amount, l.reserved_amount, l.consumed_amount
         FROM finance_budget_header h
         LEFT JOIN branch_master bm ON bm.id = h.branch_id
         JOIN finance_budget_line l ON l.budget_id = h.id
        WHERE h.period_code = ?`,
      [periodCode]
    ),
    // Actuals, not plan. Booked-to-P&L keys off lifecycle_status='consumed', the same filter
    // vw_process_lob_grn_allocation already uses to source real P&L cost.
    //
    // Paid is real cash, prorated across this GRN's allocation rows by each row's share of the
    // GRN total — NOT grn_request.status='paid', which only fires once the GRN is FULLY settled.
    // vendor_payment_tracking.paid_amount is the actual running total the AP team records as
    // installments land, so a partially_paid GRN (real money already out the door) was showing
    // Paid=0 under the status-only version of this query. grn_totals guards the divide against a
    // GRN whose allocation rows happen to sum to 0 (NULLIF), and the LEFT JOIN means an imprest
    // GRN — which never gets a vendor_payment_tracking row at all — correctly contributes 0, not
    // an error.
    executor.execute<RowDataPacket[]>(
      `SELECT a.budget_line_id,
              SUM(COALESCE(vpt.paid_amount, 0) * a.amount_with_tax / NULLIF(grn_totals.total_amount, 0)) paid_amount,
              SUM(CASE WHEN a.lifecycle_status = 'consumed' THEN a.pnl_cost_amount ELSE 0 END) booked_amount
         FROM grn_cost_allocation a
         JOIN finance_budget_line l ON l.id = a.budget_line_id
         JOIN finance_budget_header h ON h.id = l.budget_id
         LEFT JOIN vendor_payment_tracking vpt ON vpt.grn_request_id = a.grn_request_id
         JOIN (
           SELECT grn_request_id, SUM(amount_with_tax) total_amount
             FROM grn_cost_allocation
            GROUP BY grn_request_id
         ) grn_totals ON grn_totals.grn_request_id = a.grn_request_id
        WHERE h.period_code = ?
        GROUP BY a.budget_line_id`,
      [periodCode]
    ),
  ]);
  const actualsByLineId = new Map(
    grnRows.map((row) => [String(row.budget_line_id), { paid: Number(row.paid_amount ?? 0), booked: Number(row.booked_amount ?? 0) }])
  );

  const groups = new Map<
    string,
    { group: CompanyConsolidationGroup; branchByBranchId: Map<string, CompanyConsolidationBranchAmount> }
  >();

  for (const row of rows) {
    const head = String(row.head);
    const subHead = row.sub_head != null ? String(row.sub_head) : null;
    const itemName = String(row.item_name);
    const unit = String(row.unit);
    const branchId = String(row.branch_id);
    const key = `${head}|${subHead ?? ""}|${itemName}`;
    const actuals = actualsByLineId.get(String(row.line_id)) ?? { paid: 0, booked: 0 };

    let entry = groups.get(key);
    if (!entry) {
      entry = {
        group: {
          head,
          subHead,
          itemName,
          unit,
          unitConsistent: true,
          companyUnit: 0,
          companyGrossAmount: 0,
          companyPnlCostAmount: 0,
          companyReservedAmount: 0,
          companyConsumedAmount: 0,
          companyPaidAmount: 0,
          companyBookedToPnlAmount: 0,
          branchCount: 0,
          branches: [],
        },
        branchByBranchId: new Map(),
      };
      groups.set(key, entry);
    }

    if (entry.group.unit !== unit) entry.group.unitConsistent = false;
    entry.group.companyUnit += Number(row.quantity ?? 0);
    entry.group.companyGrossAmount = roundMoney(entry.group.companyGrossAmount + Number(row.gross_amount ?? 0));
    entry.group.companyPnlCostAmount = roundMoney(entry.group.companyPnlCostAmount + Number(row.pnl_cost_amount ?? 0));
    entry.group.companyReservedAmount = roundMoney(entry.group.companyReservedAmount + Number(row.reserved_amount ?? 0));
    entry.group.companyConsumedAmount = roundMoney(entry.group.companyConsumedAmount + Number(row.consumed_amount ?? 0));
    entry.group.companyPaidAmount = roundMoney(entry.group.companyPaidAmount + actuals.paid);
    entry.group.companyBookedToPnlAmount = roundMoney(entry.group.companyBookedToPnlAmount + actuals.booked);

    const existingBranch = entry.branchByBranchId.get(branchId);
    if (existingBranch) {
      existingBranch.quantity += Number(row.quantity ?? 0);
      existingBranch.grossAmount = roundMoney(existingBranch.grossAmount + Number(row.gross_amount ?? 0));
      existingBranch.pnlCostAmount = roundMoney(existingBranch.pnlCostAmount + Number(row.pnl_cost_amount ?? 0));
      existingBranch.reservedAmount = roundMoney(existingBranch.reservedAmount + Number(row.reserved_amount ?? 0));
      existingBranch.consumedAmount = roundMoney(existingBranch.consumedAmount + Number(row.consumed_amount ?? 0));
      existingBranch.paidAmount = roundMoney(existingBranch.paidAmount + actuals.paid);
      existingBranch.bookedToPnlAmount = roundMoney(existingBranch.bookedToPnlAmount + actuals.booked);
    } else {
      entry.branchByBranchId.set(branchId, {
        branchId,
        branchName: row.branch_name != null ? String(row.branch_name) : null,
        budgetStatus: String(row.budget_status),
        quantity: Number(row.quantity ?? 0),
        grossAmount: Number(row.gross_amount ?? 0),
        pnlCostAmount: Number(row.pnl_cost_amount ?? 0),
        reservedAmount: Number(row.reserved_amount ?? 0),
        consumedAmount: Number(row.consumed_amount ?? 0),
        paidAmount: actuals.paid,
        bookedToPnlAmount: actuals.booked,
      });
    }
  }

  return [...groups.values()].map(({ group, branchByBranchId }) => ({
    ...group,
    branchCount: branchByBranchId.size,
    branches: [...branchByBranchId.values()],
  }));
}

/** What db.getConnection() actually hands back: a PoolConnection whose execute() accepts the
 *  loosely-typed param arrays used throughout this module. Annotating helpers as plain
 *  PoolConnection is too strict — computeLineAllocations() would reject it. */
type BudgetConnection = Awaited<ReturnType<typeof db.getConnection>>;

/** One budget line with its derived money values and resolved attribution. */
type CalculatedBudgetLine = {
  line: BudgetLineInput;
  values: ReturnType<typeof calculateBudgetLine>;
  attribution: { processId: string | null; costCentreId: string | null };
};

/** Cost every line and resolve its attribution against the branch. Shared by the branch-admin
 *  draft path and the reviewer-edit path so both compute money the same way. */
async function calculateBudgetLines(
  connection: BudgetConnection,
  branchId: string,
  lines: BudgetLineInput[]
): Promise<{ calculated: CalculatedBudgetLine[]; totals: { base: number; tax: number; gross: number; pnl: number } }> {
  const calculated: CalculatedBudgetLine[] = [];
  for (const line of lines) {
    calculated.push({
      line,
      values: calculateBudgetLine(line),
      attribution: await validateAttribution(connection, branchId, line),
    });
  }
  const totals = calculated.reduce(
    (total, item) => ({
      base: roundMoney(total.base + item.values.baseAmount),
      tax: roundMoney(total.tax + item.values.taxAmount),
      gross: roundMoney(total.gross + item.values.grossAmount),
      pnl: roundMoney(total.pnl + item.values.pnlCostAmount),
    }),
    { base: 0, tax: 0, gross: 0, pnl: 0 }
  );
  return { calculated, totals };
}

/** Replace a budget's entire line set, re-deriving cost-centre allocations for branch-common lines.
 *  The DELETE is a no-op for a freshly created budget, so both callers can share one path. */
async function replaceBudgetLines(
  connection: BudgetConnection,
  budgetId: string,
  branchId: string,
  periodCode: string,
  calculated: CalculatedBudgetLine[],
  actorId: string
) {
  await connection.execute(
    `DELETE FROM finance_budget_line WHERE budget_id = ?`,
    [budgetId]
  );

  // One cache for the whole save. Every allocation lookup below is keyed on branchId/periodCode,
  // which do not vary across lines, so without this a 58-line budget re-read the same cost
  // centres and monthly drivers 58 times each — sequentially, inside this transaction.
  const lookupCache = createAllocationLookupCache();

  for (const item of calculated) {
    const line = item.line;
    const value = item.values;
    const lineId = line.id || randomUUID();
    const planningLevel: BudgetPlanningLevel = line.planningLevel === "branch" ? "branch" : "cost_centre";
    await connection.execute(
      `INSERT INTO finance_budget_line
       (id, budget_id, cost_centre_id, planning_level, process_id, head, sub_head,
        item_name, item_description, quantity, unit, unit_rate,
        tax_treatment, gst_rate, gst_type, recoverable_tax_pct,
        cgst_amount, sgst_amount, igst_amount, base_amount, tax_amount,
        gross_amount, recoverable_tax_amount, pnl_cost_amount,
        preferred_vendor_id, allocation_driver, justification,
        expenditure_type, alert_threshold_pct)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        lineId,
        budgetId,
        item.attribution.costCentreId,
        planningLevel,
        item.attribution.processId,
        line.head.trim(),
        line.subHead?.trim() || null,
        line.itemName.trim(),
        line.itemDescription?.trim() || null,
        Number(line.quantity),
        line.unit.trim(),
        Number(line.unitRate),
        line.taxTreatment,
        Number(line.gstRate),
        value.gstType,
        value.recoverablePct,
        value.cgstAmount,
        value.sgstAmount,
        value.igstAmount,
        value.baseAmount,
        value.taxAmount,
        value.grossAmount,
        value.recoverableTaxAmount,
        value.pnlCostAmount,
        line.preferredVendorId ?? null,
        line.allocationDriver ?? null,
        line.justification.trim(),
        line.expenditureType ?? "opex",
        80,
      ]
    );

    if (planningLevel === "branch") {
      const allocations = await computeLineAllocations(
        branchId,
        periodCode,
        line.allocationDriver,
        {
          baseAmount: value.baseAmount,
          taxAmount: value.taxAmount,
          grossAmount: value.grossAmount,
          pnlCostAmount: value.pnlCostAmount,
        },
        line.manualAllocations,
        connection,
        undefined,
        line.includedCostCentreIds,
        lookupCache
      );
      await replaceLineAllocations(connection, lineId, allocations, actorId);
    }
  }
}

/**
 * Last month's budget for a branch, read from the db_bill mirror.
 *
 * The workspace's Prev/Variance columns and its Copy-forward button both read the PREVIOUS
 * month's budget out of finance_budget_header. For July 2026 there is no such row — the July
 * budget was only ever mirrored from db_bill into finance_budget_snapshot — so the Copy button
 * sits disabled and the Variance column reads zero against a month that really does have a
 * budget. This supplies that month from the mirror, read-only: nothing here creates a budget,
 * changes a status, or touches GRN.
 *
 * THREE THINGS THE MIRROR WILL GET WRONG IF COPIED NAIVELY
 * -------------------------------------------------------
 * 1. Every amount is stored TWICE, once as expense_type 'CostCenter' and once as 'Particular'
 *    (July: 101 rows and Rs 81.52 lakh under each). Summing both doubles the budget. We take
 *    'CostCenter', which carries the real cost-centre code; 'Particular' holds free text such
 *    as "mannual".
 * 2. head_id and sub_head_id are drawn from SEPARATE id sequences that collide —
 *    bill_source_id '000001' is both the head "Communication & Connectivity" and the sub-head
 *    "Performance Incentives". Joining on the id alone fans every row out threefold and pairs
 *    heads with unrelated sub-heads ("Tea, Coffee & Refreshment / Office Rent"). Both joins are
 *    therefore qualified by head_type.
 * 3. Branch is matched by NAME, and branch_master holds three rows for Head Office ("HEAD
 *    OFFICE" twice plus "Head Office"). Joining outward from the mirror would triple it, so the
 *    lookup runs the other way: the caller's branch id resolves to a name, and mirror rows are
 *    filtered to it.
 *
 * Keys are `head|sub_head` lower-cased, matching how the workspace builds priorByKey, because
 * saveDraft replaces the line set with fresh UUIDs on every save and ids cannot be matched.
 */
export async function getPriorBudgetFromMirror(
  periodCode: string,
  branchId: string,
): Promise<{ head: string; subHead: string; amount: number }[]> {
  if (!/^\d{4}-\d{2}$/.test(periodCode) || !branchId) return [];
  for (const table of ["finance_budget_snapshot", "finance_budget_line_snapshot", "finance_expense_head_snapshot"]) {
    if (!(await tableExists(table))) return [];
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT hh.head_name AS head, sh.head_name AS sub_head, SUM(l.amount) AS amount
       FROM finance_budget_line_snapshot l
       JOIN finance_budget_snapshot b
         ON b.bill_source_id = l.budget_source_id AND b.period_code = l.period_code
       JOIN branch_master bm
         ON UPPER(TRIM(bm.branch_name)) COLLATE utf8mb4_unicode_ci
          = UPPER(TRIM(b.branch_name)) COLLATE utf8mb4_unicode_ci
       LEFT JOIN finance_expense_head_snapshot hh
              ON hh.bill_source_id = l.head_id AND hh.head_type = 'head'
       LEFT JOIN finance_expense_head_snapshot sh
              ON sh.bill_source_id = l.sub_head_id AND sh.head_type = 'subhead'
      WHERE l.period_code = ? AND bm.id = ? AND l.expense_type = 'CostCenter'
        AND hh.head_name IS NOT NULL
        -- Approved budgets only. active_status is db_bill's fully-approved marker (perfectly
        -- correlated with all three approvals). Copy-forward exists to seed a new month from what
        -- was actually sanctioned last month, so carrying unapproved lines across would propagate
        -- a budget nobody signed off — and for FY2026-27 that is 367 of 544 rows, Rs 326 L.
        AND b.active_status = 1 AND b.is_rejected = 0
      GROUP BY hh.head_name, sh.head_name`,
    [periodCode, branchId],
  );

  return rows.map((r) => ({
    head: String(r.head),
    subHead: r.sub_head ? String(r.sub_head) : "",
    amount: Number(r.amount ?? 0),
  }));
}

export const branchBudgetService = {
  getPriorBudgetFromMirror,
  async list(filters: {
    period?: string;
    branchId?: string;
    /** Multi-branch scope; wins over branchId. Both exist so routers migrate one at a time. */
    branchScope?: FinanceBranchScope;
    status?: string;
  }) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.period) {
      where.push("h.period_code = ?");
      params.push(filters.period);
    }
    if (filters.branchScope) {
      const filter = financeBranchFilter(filters.branchScope, "h.branch_id");
      if (filter.sql !== "1=1") {
        where.push(filter.sql);
        params.push(...filter.params);
      }
    } else if (filters.branchId) {
      where.push("h.branch_id = ?");
      params.push(filters.branchId);
    }
    if (filters.status) {
      where.push("h.status = ?");
      params.push(filters.status);
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT h.*, bm.branch_name,
              COUNT(l.id) AS line_count,
              COALESCE(SUM(l.reserved_quantity),0) AS reserved_quantity,
              COALESCE(SUM(l.consumed_quantity),0) AS consumed_quantity,
              COALESCE(SUM(l.reserved_amount),0) AS reserved_amount,
              COALESCE(SUM(l.consumed_amount),0) AS consumed_amount
         FROM finance_budget_header h
         LEFT JOIN branch_master bm ON bm.id = h.branch_id
         LEFT JOIN finance_budget_line l ON l.budget_id = h.id
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        GROUP BY h.id, bm.branch_name
        ORDER BY h.period_code DESC, h.created_at DESC`,
      params
    );
    return rows;
  },

  async get(id: string) {
    const [headers] = await db.execute<RowDataPacket[]>(
      `SELECT h.*, bm.branch_name
         FROM finance_budget_header h
         LEFT JOIN branch_master bm ON bm.id = h.branch_id
        WHERE h.id = ?
        LIMIT 1`,
      [id]
    );
    if (!headers[0]) throw new Error("Budget not found");

    const [lines] = await db.execute<RowDataPacket[]>(
      `SELECT l.*,
              pm.process_name,
              ccm.cost_centre_name,
              vm.vendor_name AS preferred_vendor_name,
              (l.quantity-l.reserved_quantity-l.consumed_quantity)
                AS available_quantity,
              (l.gross_amount-l.reserved_amount-l.consumed_amount)
                AS available_gross_amount
         FROM finance_budget_line l
         LEFT JOIN process_master pm ON pm.id = l.process_id
         LEFT JOIN cost_centre_master ccm ON ccm.id = l.cost_centre_id
         LEFT JOIN vendor_master vm ON vm.id = l.preferred_vendor_id
        WHERE l.budget_id = ?
        ORDER BY l.created_at, l.id`,
      [id]
    );
    const [approvals] = await db.execute<RowDataPacket[]>(
      `SELECT *
         FROM finance_budget_approval_log
        WHERE budget_id = ?
        ORDER BY created_at, id`,
      [id]
    );

    // Per head/sub-head correction notes raised by a reviewer sending the budget back. Ordered
    // newest-first so the branch admin reads the current round before earlier history.
    const [corrections] = await db.execute<RowDataPacket[]>(
      // Joined on employees.user_id, not employees.id. raised_by is written from actor(req).id
      // (process-pnl.routes.ts), which is the auth_user id — a different value from the employee
      // row's own id. On e.id the join could never match, so raised_by_name was always NULL and
      // the UI silently fell back to the role label. Same idiom as grn.service.ts's
      // "LEFT JOIN employees cb ON cb.user_id = g.created_by".
      `SELECT c.*,
              CONCAT_WS(' ', e.first_name, e.last_name) AS raised_by_name
         FROM finance_budget_line_correction c
         LEFT JOIN employees e ON e.user_id = c.raised_by
        WHERE c.budget_id = ?
        ORDER BY c.raised_at DESC, c.id`,
      [id]
    );

    const linesWithAllocations = await Promise.all(
      lines.map(async (line) => {
        if (String(line.planning_level) !== "branch") return line;
        const allocations = await getLineAllocations(String(line.id));
        return { ...line, allocations };
      })
    );

    return {
      ...headers[0],
      lines: linesWithAllocations,
      approvals,
      corrections,
      costCentreConsolidation: buildCostCentreConsolidation(lines),
    };
  },

  async saveDraft(
    input: SaveBudgetInput,
    actorId: string,
    actorRole = "branch_admin"
  ) {
    if (!input.branchId || !/^\d{4}-\d{2}$/.test(input.periodCode)) {
      throw new Error("Branch and a valid budget period are required");
    }
    const expectedFinancialYear = financialYearFromPeriod(input.periodCode);
    if (input.financialYear !== expectedFinancialYear) {
      throw new Error(
        `Financial year must be ${expectedFinancialYear} for ${input.periodCode}`
      );
    }
    if (!input.lines?.length) {
      throw new Error("At least one detailed budget line is required");
    }
    input.lines.forEach(validateLine);

    const connection = await db.getConnection();
    let budgetId = input.id?.trim() || "";
    try {
      await connection.beginTransaction();

      let existing: RowDataPacket | undefined;
      if (budgetId) {
        const [byId] = await connection.execute<RowDataPacket[]>(
          `SELECT *
             FROM finance_budget_header
            WHERE id = ?
            FOR UPDATE`,
          [budgetId]
        );
        existing = byId[0];
        if (!existing) throw new Error("Budget draft was not found");
        if (
          String(existing.branch_id) !== input.branchId
          || String(existing.period_code) !== input.periodCode
        ) {
          throw new Error("Budget branch and period cannot be changed after creation");
        }
      } else {
        const [byPeriod] = await connection.execute<RowDataPacket[]>(
          `SELECT *
             FROM finance_budget_header
            WHERE branch_id = ? AND period_code = ?
            LIMIT 1
            FOR UPDATE`,
          [input.branchId, input.periodCode]
        );
        const found = byPeriod[0];
        // deleteOrSupersede() closes a budget instead of deleting it specifically to keep
        // GRN-touched history intact — reusing that same row here (and letting the code below
        // wipe its lines via replaceBudgetLines) would erase exactly what that was protecting.
        // A closed budget is retired, not resumable: treat it as if nothing exists yet, so a
        // genuinely new budget gets created instead, exactly as the close message promises.
        if (found && String(found.status) !== "closed") {
          existing = found;
          budgetId = String(existing.id);
        }
      }

      // 'submitted' is editable too — a branch admin correcting a mistake right after submitting,
      // before Branch Head has acted on it, should not have to wait for a reject/revision round
      // trip first. The save below always resets status back to 'draft' regardless of which of
      // these three it came from, so editing a submitted budget pulls it back for re-submission
      // rather than silently rewriting the version Branch Head may already be reviewing. Once
      // Branch Head has actually approved, the status leaves this list and edits are refused again.
      if (
        existing
        && !["draft", "revision_required", "submitted"].includes(String(existing.status))
      ) {
        throw new Error(
          `A ${existing.status} budget already exists for this branch and month`
        );
      }

      const { calculated, totals } = await calculateBudgetLines(
        connection,
        input.branchId,
        input.lines
      );

      let auditAction = "SAVE_DRAFT";
      let auditFromStatus: string | null = "draft";
      if (!existing) {
        budgetId = randomUUID();
        const budgetNumber = await generateBudgetNumber(
          connection,
          input.branchId,
          input.periodCode,
          budgetId
        );
        await connection.execute(
          `INSERT INTO finance_budget_header
           (id, budget_number, branch_id, period_code, financial_year, status,
            base_budget_amount, tax_budget_amount, gross_budget_amount,
            pnl_budget_amount, created_by)
           VALUES (?,?,?,?,?,'draft',?,?,?,?,?)`,
          [
            budgetId,
            budgetNumber,
            input.branchId,
            input.periodCode,
            expectedFinancialYear,
            totals.base,
            totals.tax,
            totals.gross,
            totals.pnl,
            actorId,
          ]
        );
        auditAction = "CREATE_DRAFT";
        auditFromStatus = null;
      } else {
        const wasRevision = String(existing.status) === "revision_required";
        await connection.execute(
          `UPDATE finance_budget_header
              SET financial_year = ?,
                  status = 'draft',
                  base_budget_amount = ?,
                  tax_budget_amount = ?,
                  gross_budget_amount = ?,
                  pnl_budget_amount = ?,
                  submitted_by = NULL,
                  submitted_at = NULL,
                  branch_head_approved_by = NULL,
                  branch_head_approved_at = NULL,
                  finance_head_approved_by = NULL,
                  finance_head_approved_at = NULL,
                  accounts_head_approved_by = NULL,
                  accounts_head_approved_at = NULL,
                  rejection_reason = NULL,
                  revision_no = revision_no + ?
            WHERE id = ?`,
          [
            expectedFinancialYear,
            totals.base,
            totals.tax,
            totals.gross,
            totals.pnl,
            wasRevision ? 1 : 0,
            budgetId,
          ]
        );
        auditAction = wasRevision ? "START_REVISION" : "SAVE_DRAFT";
        auditFromStatus = String(existing.status);
      }

      await replaceBudgetLines(
        connection,
        budgetId,
        input.branchId,
        input.periodCode,
        calculated,
        actorId
      );

      await auditInTransaction(
        connection,
        budgetId,
        auditAction,
        auditFromStatus,
        "draft",
        actorId,
        actorRole,
        `${calculated.length} budget line(s); gross ${totals.gross}`
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return this.get(budgetId);
  },

  async submit(id: string, actorId: string, actorRole: string) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT status
           FROM finance_budget_header
          WHERE id = ?
          FOR UPDATE`,
        [id]
      );
      if (!rows[0]) throw new Error("Budget not found");
      if (String(rows[0].status) !== "draft") {
        throw new Error("Only a draft budget can be submitted");
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE finance_budget_header
            SET status = 'submitted', submitted_by = ?, submitted_at = NOW()
          WHERE id = ? AND status = 'draft'`,
        [actorId, id]
      );
      if (result.affectedRows !== 1) {
        throw new Error("Budget status changed before submission; refresh and retry");
      }
      // Close any outstanding correction notes: they stay open (and visible) for the whole time the
      // branch admin is editing, and are marked resolved only once the budget goes back for review.
      // The rows are kept, not deleted, so repeated round trips remain auditable.
      await connection.execute(
        `UPDATE finance_budget_line_correction
            SET resolved_at = NOW(), resolved_by = ?
          WHERE budget_id = ? AND resolved_at IS NULL`,
        [actorId, id]
      );
      await auditInTransaction(
        connection,
        id,
        "SUBMIT",
        "draft",
        "submitted",
        actorId,
        actorRole
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return this.get(id);
  },

  /** Let the reviewer whose stage a budget is sitting at correct the lines in place, instead of
   *  bouncing the whole budget back to the branch admin for a small fix. Status is deliberately
   *  left untouched: the reviewer still has to Approve afterwards, so the edit cannot be used to
   *  skip their own stage or anyone else's. Recorded as REVIEWER_EDIT with a mandatory reason. */
  async reviewerRevise(
    id: string,
    lines: BudgetLineInput[],
    actorId: string,
    actorRole: string,
    reason: string
  ) {
    const role = actorRole.toLowerCase();
    const expectedStatus = role === "branch_head"
      ? "submitted"
      : role === "finance_head"
        ? "branch_head_approved"
        : role === "accounts_head"
          ? "finance_head_approved"
          : null;
    if (!expectedStatus) {
      throw new Error(`Role ${actorRole} cannot revise branch budgets`);
    }
    if (!reason?.trim()) {
      throw new Error("A reason is required when a reviewer edits budget lines");
    }
    if (!lines?.length) {
      throw new Error("At least one budget line is required");
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT status, branch_id, period_code
           FROM finance_budget_header
          WHERE id = ?
          FOR UPDATE`,
        [id]
      );
      if (!rows[0]) throw new Error("Budget not found");
      const currentStatus = String(rows[0].status);
      if (currentStatus !== expectedStatus) {
        throw new Error(
          `Role ${actorRole} cannot revise a budget in status ${currentStatus}`
        );
      }
      const branchId = String(rows[0].branch_id);
      const periodCode = String(rows[0].period_code);

      const { calculated, totals } = await calculateBudgetLines(connection, branchId, lines);
      await connection.execute(
        `UPDATE finance_budget_header
            SET base_budget_amount = ?,
                tax_budget_amount = ?,
                gross_budget_amount = ?,
                pnl_budget_amount = ?
          WHERE id = ? AND status = ?`,
        [totals.base, totals.tax, totals.gross, totals.pnl, id, expectedStatus]
      );
      await replaceBudgetLines(connection, id, branchId, periodCode, calculated, actorId);

      await auditInTransaction(
        connection,
        id,
        "REVIEWER_EDIT",
        currentStatus,
        currentStatus,
        actorId,
        actorRole,
        `${reason.trim()} — ${calculated.length} line(s); gross ${totals.gross}`
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return this.get(id);
  },

  /**
   * Remove a budget, or retire it when removal would destroy history.
   *
   * A hard delete is only safe while no GRN has ever touched the budget: grn_cost_allocation and
   * finance_budget_line's reserved/consumed columns record real spend against these line ids, and
   * deleting the budget would violate the (non-cascading) FK from grn_cost_allocation, or orphan
   * consumed/reserved figures. That guard is unconditional, for every role — the database itself
   * would refuse it regardless.
   *
   * A merely-approved-but-untouched budget is a softer case: normally superseded instead, so the
   * approval trail survives, but super_admin may explicitly hard-delete it — e.g. a budget approved
   * in error, with nothing yet spent against it. Every other role still gets the supersede path.
   * So the caller's intent is honoured where it is safe and converted to a supersede where it is
   * not, and the outcome is reported back rather than silently chosen.
   */
  async deleteOrSupersede(id: string, actorId: string, actorRole: string, reason: string) {
    if (!reason?.trim()) {
      throw new Error("A reason is required to delete or supersede a budget");
    }
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT id, budget_number, status, created_by FROM finance_budget_header WHERE id = ? FOR UPDATE`,
        [id]
      );
      if (!rows[0]) throw new Error("Budget not found");
      const status = String(rows[0].status);
      const budgetNumber = String(rows[0].budget_number);
      const createdBy = rows[0].created_by == null ? null : String(rows[0].created_by);

      // Who may delete at all. super_admin may act on any budget; everyone else may only remove a
      // budget they raised themselves and only while it is still a draft. This is the real gate —
      // the route's requireRole only narrows the field to roles that can create budgets, and UI
      // gating is not security.
      const isSuperAdminActor = actorRole.toLowerCase() === "super_admin";
      if (!isSuperAdminActor) {
        if (createdBy !== actorId) {
          throw new Error("Only the person who raised this budget can delete it");
        }
        if (status !== "draft") {
          throw new Error(
            `This budget is ${status}, so it can no longer be deleted by its creator. `
            + "Ask a super admin to supersede it."
          );
        }
      }

      const [[usage]] = await connection.execute<RowDataPacket[]>(
        `SELECT COALESCE(SUM(reserved_amount),0) AS reserved,
                COALESCE(SUM(consumed_amount),0) AS consumed,
                COUNT(*) AS line_count
           FROM finance_budget_line WHERE budget_id = ?`,
        [id]
      ) as unknown as [RowDataPacket[], unknown];
      const [[grn]] = await connection.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM grn_cost_allocation WHERE budget_id = ?`,
        [id]
      ) as unknown as [RowDataPacket[], unknown];

      const touchedByGrn = Number(usage?.reserved ?? 0) > 0
        || Number(usage?.consumed ?? 0) > 0
        || Number(grn?.n ?? 0) > 0;

      // Once branch_head/finance_head has signed off (or the budget is active), a hard delete
      // would erase an approval decision even if no GRN has spent against it yet — supersede
      // instead, same as the GRN-touched case, so the approval trail always survives. super_admin
      // is the one role trusted to override that and truly delete an approved-but-untouched budget;
      // touchedByGrn is NOT overridable by anyone — real spend history is never deletable.
      const APPROVED_STATUSES = ["branch_head_approved", "finance_head_approved", "active"];
      const requiresSupersede = touchedByGrn || (APPROVED_STATUSES.includes(status) && !isSuperAdminActor);

      if (requiresSupersede) {
        await connection.execute(
          `UPDATE finance_budget_header
              SET status = 'closed', rejection_reason = ?
            WHERE id = ?`,
          [reason.trim(), id]
        );
        await auditInTransaction(connection, id, "SUPERSEDE", status, "closed", actorId, actorRole,
          touchedByGrn
            ? `${reason.trim()} — kept because GRN activity exists against it`
            : `${reason.trim()} — kept because it was already approved (${status})`);
        await connection.commit();
        return {
          outcome: "superseded" as const,
          budgetNumber,
          message: touchedByGrn
            ? `${budgetNumber} has GRN activity against it, so it was closed rather than deleted. `
              + `A new budget can now be created for this branch and month.`
            : `${budgetNumber} was already approved, so it was closed rather than deleted. `
              + `A new budget can now be created for this branch and month.`,
        };
      }

      // Audit BEFORE the delete: the FK on the audit table cascades with the header.
      await auditInTransaction(connection, id, "DELETE", status, "deleted", actorId, actorRole, reason.trim());
      const [result] = await connection.execute<ResultSetHeader>(
        `DELETE FROM finance_budget_header WHERE id = ?`,
        [id]
      );
      if (result.affectedRows !== 1) throw new Error("Budget was changed by someone else; refresh and retry");
      await connection.commit();
      return {
        outcome: "deleted" as const,
        budgetNumber,
        message: `${budgetNumber} was deleted. No GRN had consumed against it, so nothing was lost.`,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  /** Corrects the tax treatment on a single line of an already-active budget.
   *  Only finance_head and super_admin may call this — it is a targeted override for the
   *  common case where a branch planned a line as non_gst/exempt but the vendor invoice
   *  carries GST. Existing consumed/reserved amounts are not touched; only the planned
   *  line amounts and the header totals are recomputed. A mandatory audit reason is logged. */
  async amendLineTaxTreatment(
    budgetId: string,
    lineId: string,
    patch: {
      taxTreatment: BudgetTaxTreatment;
      gstRate: number;
      gstType: BudgetGstType;
      recoverableTaxPct: number;
    },
    actorId: string,
    actorRole: string,
    reason: string
  ) {
    const role = actorRole.toLowerCase();
    if (!["finance_head", "super_admin"].includes(role)) {
      throw new Error("Only finance_head or super_admin can amend a budget line's tax treatment");
    }
    if (!reason?.trim()) {
      throw new Error("A reason is required for a tax-treatment amendment");
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [[header]] = await connection.execute<RowDataPacket[]>(
        `SELECT id, status FROM finance_budget_header WHERE id = ? FOR UPDATE`,
        [budgetId]
      ) as unknown as [RowDataPacket[], unknown];
      if (!header) throw new Error("Budget not found");
      if (String(header.status) !== "active") {
        throw new Error(
          `Tax-treatment amendment is only allowed on active budgets (current status: ${header.status})`
        );
      }

      const [[line]] = await connection.execute<RowDataPacket[]>(
        `SELECT id, head, sub_head, item_name, quantity, unit, unit_rate, justification, tax_treatment
           FROM finance_budget_line
          WHERE id = ? AND budget_id = ?
          FOR UPDATE`,
        [lineId, budgetId]
      ) as unknown as [RowDataPacket[], unknown];
      if (!line) throw new Error("Budget line not found in this budget");

      const oldTreatment = String(line.tax_treatment);
      const recomputed = calculateBudgetLine({
        head: String(line.head),
        subHead: line.sub_head ? String(line.sub_head) : undefined,
        itemName: String(line.item_name),
        quantity: Number(line.quantity),
        unit: String(line.unit),
        unitRate: Number(line.unit_rate),
        taxTreatment: patch.taxTreatment,
        gstRate: patch.gstRate,
        gstType: patch.gstType,
        recoverableTaxPct: patch.recoverableTaxPct,
        justification: String(line.justification),
      });

      await connection.execute(
        `UPDATE finance_budget_line
            SET tax_treatment = ?, gst_rate = ?, gst_type = ?, recoverable_tax_pct = ?,
                base_amount = ?, tax_amount = ?, gross_amount = ?,
                cgst_amount = ?, sgst_amount = ?, igst_amount = ?,
                recoverable_tax_amount = ?, pnl_cost_amount = ?
          WHERE id = ?`,
        [
          patch.taxTreatment, patch.gstRate, patch.gstType, patch.recoverableTaxPct,
          recomputed.baseAmount, recomputed.taxAmount, recomputed.grossAmount,
          recomputed.cgstAmount, recomputed.sgstAmount, recomputed.igstAmount,
          recomputed.recoverableTaxAmount, recomputed.pnlCostAmount,
          lineId,
        ]
      );

      const [[totals]] = await connection.execute<RowDataPacket[]>(
        `SELECT COALESCE(SUM(base_amount),0)    AS base,
                COALESCE(SUM(tax_amount),0)     AS tax,
                COALESCE(SUM(gross_amount),0)   AS gross,
                COALESCE(SUM(pnl_cost_amount),0) AS pnl
           FROM finance_budget_line WHERE budget_id = ?`,
        [budgetId]
      ) as unknown as [RowDataPacket[], unknown];

      await connection.execute(
        `UPDATE finance_budget_header
            SET base_budget_amount = ?, tax_budget_amount = ?,
                gross_budget_amount = ?, pnl_budget_amount = ?
          WHERE id = ?`,
        [
          Number(totals?.base ?? 0), Number(totals?.tax ?? 0),
          Number(totals?.gross ?? 0), Number(totals?.pnl ?? 0),
          budgetId,
        ]
      );

      await auditInTransaction(
        connection,
        budgetId,
        "TAX_TREATMENT_AMENDMENT",
        "active",
        "active",
        actorId,
        actorRole,
        `Line "${line.item_name}": ${oldTreatment} → ${patch.taxTreatment} @ ${patch.gstRate}% GST. ${reason.trim()}`
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return this.get(budgetId);
  },

  async review(
    id: string,
    decision: "approve" | "reject" | "revision",
    actorId: string,
    actorRole: string,
    remarks?: string,
    /** Per head/sub-head correction notes. Only meaningful when sending a budget back, so the
     *  branch admin is told which head/sub-head to fix rather than just "revise this budget". */
    lineCorrections?: BudgetLineCorrectionInput[]
  ) {
    const role = actorRole.toLowerCase();
    const expectedStatus = role === "branch_head"
      ? "submitted"
      : role === "finance_head"
        ? "branch_head_approved"
        : role === "accounts_head"
          ? "finance_head_approved"
          : null;
    if (!expectedStatus) {
      throw new Error(`Role ${actorRole} cannot review branch budgets`);
    }
    if (decision !== "approve" && !remarks?.trim()) {
      throw new Error("Remarks are required for rejection or revision");
    }
    const corrections = (lineCorrections ?? []).filter((entry) => entry.note?.trim());
    if (decision === "revision" && !corrections.length) {
      throw new Error(
        "At least one head/sub-head correction note is required when sending a budget back for revision"
      );
    }
    for (const entry of corrections) {
      if (!entry.head?.trim()) {
        throw new Error("Every correction note must name the head it applies to");
      }
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT status, revision_no
           FROM finance_budget_header
          WHERE id = ?
          FOR UPDATE`,
        [id]
      );
      if (!rows[0]) throw new Error("Budget not found");
      const currentStatus = String(rows[0].status) as BudgetStatus;
      const currentRevision = Number(rows[0].revision_no ?? 0);
      if (currentStatus !== expectedStatus) {
        throw new Error(
          `Role ${actorRole} cannot review budget in status ${currentStatus}`
        );
      }

      const nextStatus: BudgetStatus = decision === "reject"
        ? "rejected"
        : decision === "revision"
          ? "revision_required"
          : role === "branch_head"
            ? "branch_head_approved"
            : role === "finance_head"
              ? "finance_head_approved"
              : "active";
      const approvalPrefix = role === "branch_head"
        ? "branch_head_approved"
        : role === "finance_head"
          ? "finance_head_approved"
          : "accounts_head_approved";

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE finance_budget_header
            SET status = ?,
                ${approvalPrefix}_by = ?,
                ${approvalPrefix}_at = NOW(),
                rejection_reason = ?
          WHERE id = ? AND status = ?`,
        [
          nextStatus,
          actorId,
          decision === "approve" ? null : remarks?.trim(),
          id,
          expectedStatus,
        ]
      );
      if (result.affectedRows !== 1) {
        throw new Error("Budget status changed during review; refresh and retry");
      }

      for (const entry of corrections) {
        await connection.execute(
          `INSERT INTO finance_budget_line_correction
           (id, budget_id, line_id, head, sub_head, item_name, correction_note,
            raised_by_role, raised_by, raised_at, revision_no)
           VALUES (?,?,?,?,?,?,?,?,?,NOW(),?)`,
          [
            randomUUID(),
            id,
            entry.lineId ?? null,
            entry.head.trim(),
            entry.subHead?.trim() || null,
            entry.itemName?.trim() || null,
            entry.note.trim(),
            role,
            actorId,
            currentRevision,
          ]
        );
      }

      await auditInTransaction(
        connection,
        id,
        decision.toUpperCase(),
        currentStatus,
        nextStatus,
        actorId,
        actorRole,
        corrections.length
          ? `${remarks ?? ""} (${corrections.length} head/sub-head correction note(s))`.trim()
          : remarks
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return this.get(id);
  },

  async availableLines(filters: {
    branchId: string;
    processId?: string;
    costCentreId?: string;
    period?: string;
  }) {
    if (!filters.branchId) throw new Error("Branch is required");
    const conditions = ["h.branch_id = ?", "h.status = 'active'"];
    const params: unknown[] = [filters.branchId];
    if (filters.period) {
      conditions.push("h.period_code = ?");
      params.push(filters.period);
    }
    if (filters.processId) {
      conditions.push("(l.process_id = ? OR l.process_id IS NULL)");
      params.push(filters.processId);
    }
    if (filters.costCentreId) {
      conditions.push("(l.cost_centre_id = ? OR l.cost_centre_id IS NULL)");
      params.push(filters.costCentreId);
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT l.*,
              h.budget_number,
              h.period_code,
              h.branch_id,
              pm.process_name,
              ccm.cost_centre_name,
              vm.vendor_name AS preferred_vendor_name,
              (l.quantity-l.reserved_quantity-l.consumed_quantity)
                AS available_quantity,
              (l.gross_amount-l.reserved_amount-l.consumed_amount)
                AS available_gross_amount
         FROM finance_budget_line l
         JOIN finance_budget_header h ON h.id = l.budget_id
         LEFT JOIN process_master pm ON pm.id = l.process_id
         LEFT JOIN cost_centre_master ccm ON ccm.id = l.cost_centre_id
         LEFT JOIN vendor_master vm ON vm.id = l.preferred_vendor_id
        WHERE ${conditions.join(" AND ")}
        HAVING available_quantity > 0 AND available_gross_amount > 0
        ORDER BY l.head, l.sub_head, l.item_name`,
      params
    );
    return rows;
  },

  async getLineForGrn(lineId: string, branchId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT l.*,
              h.status AS budget_status,
              h.branch_id,
              h.period_code,
              vm.vendor_name AS preferred_vendor_name,
              (l.quantity-l.reserved_quantity-l.consumed_quantity)
                AS available_quantity,
              (l.gross_amount-l.reserved_amount-l.consumed_amount)
                AS available_gross_amount
         FROM finance_budget_line l
         JOIN finance_budget_header h ON h.id = l.budget_id
         LEFT JOIN vendor_master vm ON vm.id = l.preferred_vendor_id
        WHERE l.id = ?
          AND h.branch_id = ?
          AND h.status = 'active'
        LIMIT 1`,
      [lineId, branchId]
    );
    if (!rows[0]) {
      throw new Error(
        "The selected approved budget line is unavailable for this branch"
      );
    }
    return rows[0];
  },

  /**
   * Moves budget (gross_amount) from one active line to another within the same budget.
   * Validates: same budget, active status, from_line has sufficient available amount.
   */
  async transferBetweenLines(input: {
    budgetId: string;
    fromLineId: string;
    toLineId: string;
    transferAmount: number;
    reason: string;
    actorId: string;
  }) {
    const amount = roundMoney(Number(input.transferAmount));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Transfer amount must be a positive number");
    }
    if (!input.reason?.trim()) throw new Error("Reason is required for a budget transfer");
    if (input.fromLineId === input.toLineId) throw new Error("From and To lines must be different");

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [headerRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id, status FROM finance_budget_header WHERE id = ? FOR UPDATE`,
        [input.budgetId]
      );
      if (!headerRows[0]) throw new Error("Budget not found");
      if (headerRows[0].status !== "active") {
        throw new Error("Budget transfers are only allowed on active budgets");
      }

      const [lineRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id, budget_id,
                gross_amount, reserved_amount, consumed_amount,
                (gross_amount - reserved_amount - consumed_amount) AS available_gross_amount
           FROM finance_budget_line
          WHERE id IN (?, ?)
          FOR UPDATE`,
        [input.fromLineId, input.toLineId]
      );
      const fromLine = (lineRows as RowDataPacket[]).find((row) => row.id === input.fromLineId);
      const toLine   = (lineRows as RowDataPacket[]).find((row) => row.id === input.toLineId);
      if (!fromLine) throw new Error("Source budget line not found");
      if (!toLine)   throw new Error("Target budget line not found");
      if (String(fromLine.budget_id) !== input.budgetId) throw new Error("Source line belongs to a different budget");
      if (String(toLine.budget_id)   !== input.budgetId) throw new Error("Target line belongs to a different budget");

      const available = roundMoney(Number(fromLine.available_gross_amount));
      if (amount > available) {
        throw new Error(
          `Transfer amount ₹${amount.toLocaleString("en-IN")} exceeds available balance ₹${available.toLocaleString("en-IN")} on the source line`
        );
      }

      await connection.execute(
        `UPDATE finance_budget_line SET gross_amount = gross_amount - ? WHERE id = ?`,
        [amount, input.fromLineId]
      );
      await connection.execute(
        `UPDATE finance_budget_line SET gross_amount = gross_amount + ? WHERE id = ?`,
        [amount, input.toLineId]
      );

      const transferId = randomUUID();
      await connection.execute(
        `INSERT INTO finance_budget_transfer
           (id, budget_id, from_line_id, to_line_id, transfer_amount, reason,
            status, approved_by, approved_at, created_by)
         VALUES (?,?,?,?,?,?,'approved',?,NOW(),?)`,
        [transferId, input.budgetId, input.fromLineId, input.toLineId, amount, input.reason.trim(), input.actorId, input.actorId]
      );

      await auditInTransaction(
        connection, input.budgetId, "TRANSFER", "active", "active", input.actorId, "finance_head",
        `Transfer ₹${amount} from ${input.fromLineId} to ${input.toLineId}: ${input.reason.trim()}`
      );

      await connection.commit();
      return { transferId, fromLineId: input.fromLineId, toLineId: input.toLineId, amount };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async getGrnsForLine(lineId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT gr.id, gr.grn_number, gr.bill_date, gr.status,
              gr.amount_without_tax, gr.amount_with_tax, gr.pnl_cost_amount,
              gr.vendor_id, vm.vendor_name,
              -- grn_cost_allocation has none of reserved_amount, consumed_amount or
              -- allocation_amount; those three column names belong to finance_budget_line, which
              -- does carry them. Selected here they made the whole statement throw
              -- ER_BAD_FIELD_ERROR, so this endpoint returned nothing for every budget line.
              -- The allocation table records lifecycle as a status plus timestamps, so the two
              -- amounts are derived from it — the same idiom this file already uses for
              -- booked_amount above. Aliased back to the original names so callers are unchanged.
              ca.pnl_cost_amount AS allocation_amount,
              CASE WHEN ca.lifecycle_status = 'reserved' THEN ca.pnl_cost_amount ELSE 0 END AS reserved_amount,
              CASE WHEN ca.lifecycle_status = 'consumed' THEN ca.pnl_cost_amount ELSE 0 END AS consumed_amount
         FROM grn_cost_allocation ca
         JOIN grn_request gr ON gr.id = ca.grn_request_id
         LEFT JOIN vendor_master vm ON vm.id = gr.vendor_id
        WHERE ca.budget_line_id = ?
        ORDER BY gr.bill_date DESC`,
      [lineId]
    );
    return rows;
  },
};
