import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../../db/mysql.js";

export type BudgetTaxTreatment = "inclusive" | "exclusive" | "exempt" | "reverse_charge" | "non_gst";
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function calculateBudgetLine(line: BudgetLineInput) {
  const quantity = Number(line.quantity || 0);
  const unitRate = Number(line.unitRate || 0);
  const gstRate = Number(line.gstRate || 0);
  const quoted = roundMoney(quantity * unitRate);
  let baseAmount = quoted;
  let taxAmount = 0;
  let grossAmount = quoted;

  if (line.taxTreatment === "inclusive" && gstRate > 0) {
    baseAmount = roundMoney(quoted / (1 + gstRate / 100));
    taxAmount = roundMoney(quoted - baseAmount);
  } else if (["exclusive", "reverse_charge"].includes(line.taxTreatment) && gstRate > 0) {
    taxAmount = roundMoney(quoted * gstRate / 100);
    grossAmount = roundMoney(quoted + taxAmount);
  }

  if (["exempt", "non_gst"].includes(line.taxTreatment)) {
    taxAmount = 0;
    grossAmount = baseAmount;
  }

  const gstType: BudgetGstType = taxAmount === 0 ? "none" : (line.gstType ?? "cgst_sgst");
  const recoverablePct = clamp(Number(line.recoverableTaxPct ?? 100), 0, 100);
  const recoverableTaxAmount = roundMoney(taxAmount * recoverablePct / 100);
  const pnlCostAmount = roundMoney(baseAmount + taxAmount - recoverableTaxAmount);
  const cgstAmount = gstType === "cgst_sgst" ? roundMoney(taxAmount / 2) : 0;
  const sgstAmount = gstType === "cgst_sgst" ? roundMoney(taxAmount - cgstAmount) : 0;
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
  if (!line.head?.trim()) throw new Error(`Budget line ${index + 1}: head is required`);
  if (!line.itemName?.trim()) throw new Error(`Budget line ${index + 1}: item/service is required`);
  if (!line.unit?.trim()) throw new Error(`Budget line ${index + 1}: unit is required`);
  if (!line.justification?.trim()) throw new Error(`Budget line ${index + 1}: justification is required`);
  if (!Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0) throw new Error(`Budget line ${index + 1}: quantity must be greater than zero`);
  if (!Number.isFinite(Number(line.unitRate)) || Number(line.unitRate) < 0) throw new Error(`Budget line ${index + 1}: unit rate cannot be negative`);
  if (!Number.isFinite(Number(line.gstRate)) || Number(line.gstRate) < 0 || Number(line.gstRate) > 100) throw new Error(`Budget line ${index + 1}: invalid GST rate`);
}

async function validateAttribution(connection: PoolConnection, branchId: string, line: BudgetLineInput) {
  let processId = line.processId?.trim() || null;
  const costCentreId = line.costCentreId?.trim() || null;

  if (costCentreId) {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, process_id FROM cost_centre_master WHERE id = ? LIMIT 1`,
      [costCentreId]
    );
    if (!rows[0]) throw new Error("Selected cost centre was not found");
    const mappedProcessId = rows[0].process_id ? String(rows[0].process_id) : null;
    if (processId && mappedProcessId && processId !== mappedProcessId) {
      throw new Error("Selected cost centre is mapped to a different process");
    }
    processId = processId ?? mappedProcessId;
  }

  if (processId) {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, branch_id FROM process_master WHERE id = ? LIMIT 1`,
      [processId]
    );
    if (!rows[0]) throw new Error("Selected process was not found");
    if (rows[0].branch_id && String(rows[0].branch_id) !== branchId) {
      throw new Error("Selected process belongs to a different branch");
    }
  }

  return { processId, costCentreId };
}

async function generateBudgetNumber(connection: PoolConnection, branchId: string, periodCode: string, id: string) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT branch_seq FROM branch_master WHERE id = ? LIMIT 1`,
    [branchId]
  );
  if (!rows[0]) throw new Error("Selected branch was not found");
  const branchSeq = Number(rows[0].branch_seq ?? 0);
  return `BUD/${branchSeq}/${periodCode.replace("-", "")}/${id.slice(0, 8).toUpperCase()}`;
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
    [randomUUID(), budgetId, action, fromStatus, toStatus, actorId, actorRole, remarks ?? null]
  );
}

async function lockBudgetLine(connection: PoolConnection, lineId: string) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT l.*, h.status AS budget_status, h.branch_id, h.period_code
       FROM finance_budget_line l
       JOIN finance_budget_header h ON h.id = l.budget_id
      WHERE l.id = ?
      FOR UPDATE`,
    [lineId]
  );
  if (!rows[0]) throw new Error("Approved budget line not found");
  if (rows[0].budget_status !== "active") throw new Error("GRN can only use an active, fully approved budget");
  return rows[0];
}

export const branchBudgetService = {
  async list(filters: { period?: string; branchId?: string; status?: string }) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.period) { where.push("h.period_code = ?"); params.push(filters.period); }
    if (filters.branchId) { where.push("h.branch_id = ?"); params.push(filters.branchId); }
    if (filters.status) { where.push("h.status = ?"); params.push(filters.status); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT h.*, bm.branch_name,
              COUNT(l.id) AS line_count,
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
        WHERE h.id = ? LIMIT 1`,
      [id]
    );
    if (!headers[0]) throw new Error("Budget not found");
    const [lines] = await db.execute<RowDataPacket[]>(
      `SELECT l.*, pm.process_name, ccm.cost_centre_name, vm.vendor_name AS preferred_vendor_name,
              (l.gross_amount-l.reserved_amount-l.consumed_amount) AS available_gross_amount
         FROM finance_budget_line l
         LEFT JOIN process_master pm ON pm.id = l.process_id
         LEFT JOIN cost_centre_master ccm ON ccm.id = l.cost_centre_id
         LEFT JOIN vendor_master vm ON vm.id = l.preferred_vendor_id
        WHERE l.budget_id = ? ORDER BY l.created_at, l.id`,
      [id]
    );
    const [approvals] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM finance_budget_approval_log WHERE budget_id = ? ORDER BY created_at`,
      [id]
    );
    return { ...headers[0], lines, approvals };
  },

  async saveDraft(input: SaveBudgetInput, actorId: string) {
    if (!input.branchId || !/^\d{4}-\d{2}$/.test(input.periodCode) || !input.financialYear) {
      throw new Error("Branch, valid period and financial year are required");
    }
    if (!input.lines?.length) throw new Error("At least one detailed budget line is required");
    input.lines.forEach(validateLine);

    const id = input.id || randomUUID();
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [existing] = await connection.execute<RowDataPacket[]>(
        `SELECT status, branch_id FROM finance_budget_header WHERE id = ? FOR UPDATE`,
        [id]
      );
      if (existing[0] && !["draft", "revision_required"].includes(String(existing[0].status))) {
        throw new Error(`Only draft or revision-required budgets can be edited. Current status: ${existing[0].status}`);
      }

      const calculated: Array<{ line: BudgetLineInput; values: ReturnType<typeof calculateBudgetLine>; attribution: { processId: string | null; costCentreId: string | null } }> = [];
      for (const line of input.lines) {
        calculated.push({ line, values: calculateBudgetLine(line), attribution: await validateAttribution(connection, input.branchId, line) });
      }
      const totals = calculated.reduce((acc, item) => ({
        base: roundMoney(acc.base + item.values.baseAmount),
        tax: roundMoney(acc.tax + item.values.taxAmount),
        gross: roundMoney(acc.gross + item.values.grossAmount),
        pnl: roundMoney(acc.pnl + item.values.pnlCostAmount),
      }), { base: 0, tax: 0, gross: 0, pnl: 0 });

      if (!existing[0]) {
        const number = await generateBudgetNumber(connection, input.branchId, input.periodCode, id);
        await connection.execute(
          `INSERT INTO finance_budget_header
           (id,budget_number,branch_id,period_code,financial_year,status,base_budget_amount,tax_budget_amount,gross_budget_amount,pnl_budget_amount,created_by)
           VALUES (?,?,?,?,?,'draft',?,?,?,?,?)`,
          [id, number, input.branchId, input.periodCode, input.financialYear, totals.base, totals.tax, totals.gross, totals.pnl, actorId]
        );
      } else {
        await connection.execute(
          `UPDATE finance_budget_header
              SET branch_id=?, period_code=?, financial_year=?, status='draft',
                  base_budget_amount=?, tax_budget_amount=?, gross_budget_amount=?, pnl_budget_amount=?,
                  rejection_reason=NULL, revision_no=revision_no+1
            WHERE id=?`,
          [input.branchId, input.periodCode, input.financialYear, totals.base, totals.tax, totals.gross, totals.pnl, id]
        );
        await connection.execute(`DELETE FROM finance_budget_line WHERE budget_id = ?`, [id]);
      }

      for (const item of calculated) {
        const l = item.line;
        const v = item.values;
        await connection.execute(
          `INSERT INTO finance_budget_line
           (id,budget_id,cost_centre_id,process_id,head,sub_head,item_name,item_description,quantity,unit,unit_rate,
            tax_treatment,gst_rate,gst_type,recoverable_tax_pct,cgst_amount,sgst_amount,igst_amount,base_amount,tax_amount,
            gross_amount,recoverable_tax_amount,pnl_cost_amount,preferred_vendor_id,allocation_driver,justification)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [l.id || randomUUID(), id, item.attribution.costCentreId, item.attribution.processId, l.head.trim(), l.subHead?.trim() || null,
           l.itemName.trim(), l.itemDescription?.trim() || null, Number(l.quantity), l.unit.trim(), Number(l.unitRate), l.taxTreatment,
           Number(l.gstRate), v.gstType, v.recoverablePct, v.cgstAmount, v.sgstAmount, v.igstAmount, v.baseAmount, v.taxAmount,
           v.grossAmount, v.recoverableTaxAmount, v.pnlCostAmount, l.preferredVendorId ?? null, l.allocationDriver ?? null, l.justification.trim()]
        );
      }
      await connection.commit();
      return this.get(id);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async submit(id: string, actorId: string, actorRole: string) {
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT status FROM finance_budget_header WHERE id=? LIMIT 1`, [id]);
    if (!rows[0]) throw new Error("Budget not found");
    if (!["draft", "revision_required"].includes(String(rows[0].status))) throw new Error("Only draft budgets can be submitted");
    await db.execute(`UPDATE finance_budget_header SET status='submitted', submitted_by=?, submitted_at=NOW() WHERE id=?`, [actorId, id]);
    await audit(id, "SUBMIT", String(rows[0].status), "submitted", actorId, actorRole);
    return this.get(id);
  },

  async review(id: string, decision: "approve" | "reject" | "revision", actorId: string, actorRole: string, remarks?: string) {
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT status FROM finance_budget_header WHERE id=? LIMIT 1`, [id]);
    if (!rows[0]) throw new Error("Budget not found");
    const current = String(rows[0].status) as BudgetStatus;
    const role = actorRole.toLowerCase();
    const expected = role === "branch_head" ? "submitted" : role === "finance_head" ? "branch_head_approved" : role === "accounts_head" ? "finance_head_approved" : null;
    if (!expected || current !== expected) throw new Error(`Role ${actorRole} cannot review budget in status ${current}`);
    if (decision !== "approve" && !remarks?.trim()) throw new Error("Remarks are required for rejection or revision");

    let next: BudgetStatus;
    if (decision === "reject") next = "rejected";
    else if (decision === "revision") next = "revision_required";
    else next = role === "branch_head" ? "branch_head_approved" : role === "finance_head" ? "finance_head_approved" : "active";

    const approvalColumn = role === "branch_head" ? "branch_head_approved" : role === "finance_head" ? "finance_head_approved" : "accounts_head_approved";
    await db.execute(
      `UPDATE finance_budget_header SET status=?, ${approvalColumn}_by=?, ${approvalColumn}_at=NOW(), rejection_reason=? WHERE id=?`,
      [next, actorId, decision === "approve" ? null : remarks?.trim() ?? null, id]
    );
    await audit(id, decision.toUpperCase(), current, next, actorId, actorRole, remarks);
    return this.get(id);
  },

  async availableLines(filters: { branchId: string; processId?: string; costCentreId?: string; period?: string }) {
    if (!filters.branchId) throw new Error("Branch is required");
    const conditions = ["h.branch_id = ?", "h.status = 'active'"];
    const params: unknown[] = [filters.branchId];
    if (filters.period) { conditions.push("h.period_code = ?"); params.push(filters.period); }
    if (filters.processId) { conditions.push("(l.process_id = ? OR l.process_id IS NULL)"); params.push(filters.processId); }
    if (filters.costCentreId) { conditions.push("(l.cost_centre_id = ? OR l.cost_centre_id IS NULL)"); params.push(filters.costCentreId); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT l.*, h.budget_number, h.period_code, h.branch_id,
              pm.process_name, ccm.cost_centre_name, vm.vendor_name AS preferred_vendor_name,
              (l.gross_amount-l.reserved_amount-l.consumed_amount) AS available_gross_amount
         FROM finance_budget_line l
         JOIN finance_budget_header h ON h.id=l.budget_id
         LEFT JOIN process_master pm ON pm.id=l.process_id
         LEFT JOIN cost_centre_master ccm ON ccm.id=l.cost_centre_id
         LEFT JOIN vendor_master vm ON vm.id=l.preferred_vendor_id
        WHERE ${conditions.join(" AND ")}
        HAVING available_gross_amount > 0
        ORDER BY l.head,l.sub_head,l.item_name`,
      params
    );
    return rows;
  },

  async getLineForGrn(lineId: string, branchId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT l.*, h.status AS budget_status, h.branch_id, h.period_code,
              (l.gross_amount-l.reserved_amount-l.consumed_amount) AS available_gross_amount
         FROM finance_budget_line l
         JOIN finance_budget_header h ON h.id=l.budget_id
        WHERE l.id=? AND h.branch_id=? AND h.status='active'
        LIMIT 1`,
      [lineId, branchId]
    );
    if (!rows[0]) throw new Error("The selected approved budget line is unavailable for this branch");
    return rows[0];
  },

  async reserveLine(connection: PoolConnection, lineId: string, amount: number) {
    const line = await lockBudgetLine(connection, lineId);
    const available = roundMoney(Number(line.gross_amount) - Number(line.reserved_amount) - Number(line.consumed_amount));
    if (roundMoney(amount) > available) throw new Error(`GRN exceeds available budget by ${roundMoney(amount - available).toFixed(2)}`);
    await connection.execute(`UPDATE finance_budget_line SET reserved_amount=reserved_amount+? WHERE id=?`, [roundMoney(amount), lineId]);
  },

  async consumeLine(connection: PoolConnection, lineId: string, amount: number) {
    const line = await lockBudgetLine(connection, lineId);
    const reserved = Number(line.reserved_amount);
    if (reserved + 0.01 < amount) throw new Error("Reserved budget is lower than the GRN amount");
    await connection.execute(
      `UPDATE finance_budget_line SET reserved_amount=GREATEST(0,reserved_amount-?), consumed_amount=consumed_amount+? WHERE id=?`,
      [roundMoney(amount), roundMoney(amount), lineId]
    );
  },

  async releaseLine(connection: PoolConnection, lineId: string, amount: number) {
    await lockBudgetLine(connection, lineId);
    await connection.execute(
      `UPDATE finance_budget_line SET reserved_amount=GREATEST(0,reserved_amount-?) WHERE id=?`,
      [roundMoney(amount), lineId]
    );
  },
};
