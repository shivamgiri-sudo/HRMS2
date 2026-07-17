import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../../db/mysql.js";

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
}

export interface SaveBudgetInput {
  id?: string;
  branchId: string;
  periodCode: string;
  financialYear: string;
  lines: BudgetLineInput[];
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

export const branchBudgetService = {
  async list(filters: { period?: string; branchId?: string; status?: string }) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.period) {
      where.push("h.period_code = ?");
      params.push(filters.period);
    }
    if (filters.branchId) {
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
    return { ...headers[0], lines, approvals };
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
        existing = byPeriod[0];
        if (existing) budgetId = String(existing.id);
      }

      if (
        existing
        && !["draft", "revision_required"].includes(String(existing.status))
      ) {
        throw new Error(
          `A ${existing.status} budget already exists for this branch and month`
        );
      }

      const calculated: Array<{
        line: BudgetLineInput;
        values: ReturnType<typeof calculateBudgetLine>;
        attribution: { processId: string | null; costCentreId: string | null };
      }> = [];
      for (const line of input.lines) {
        calculated.push({
          line,
          values: calculateBudgetLine(line),
          attribution: await validateAttribution(connection, input.branchId, line),
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
        await connection.execute(
          `DELETE FROM finance_budget_line WHERE budget_id = ?`,
          [budgetId]
        );
        auditAction = wasRevision ? "START_REVISION" : "SAVE_DRAFT";
        auditFromStatus = String(existing.status);
      }

      for (const item of calculated) {
        const line = item.line;
        const value = item.values;
        await connection.execute(
          `INSERT INTO finance_budget_line
           (id, budget_id, cost_centre_id, process_id, head, sub_head,
            item_name, item_description, quantity, unit, unit_rate,
            tax_treatment, gst_rate, gst_type, recoverable_tax_pct,
            cgst_amount, sgst_amount, igst_amount, base_amount, tax_amount,
            gross_amount, recoverable_tax_amount, pnl_cost_amount,
            preferred_vendor_id, allocation_driver, justification)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            line.id || randomUUID(),
            budgetId,
            item.attribution.costCentreId,
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
          ]
        );
      }

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

  async review(
    id: string,
    decision: "approve" | "reject" | "revision",
    actorId: string,
    actorRole: string,
    remarks?: string
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
      const currentStatus = String(rows[0].status) as BudgetStatus;
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
      await auditInTransaction(
        connection,
        id,
        decision.toUpperCase(),
        currentStatus,
        nextStatus,
        actorId,
        actorRole,
        remarks
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
};
