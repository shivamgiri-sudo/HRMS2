import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type {
  BudgetGstType,
  BudgetTaxTreatment,
} from "./branch-budget.service.js";

const TAX_TREATMENTS = new Set([
  "inclusive",
  "exclusive",
  "exempt",
  "reverse_charge",
  "non_gst",
]);
const GST_TYPES = new Set(["cgst_sgst", "igst", "none"]);
const PNL_TREATMENTS = new Set([
  "operating_expense",
  "direct_cost",
  "non_operating",
  "excluded",
]);

function codeFromName(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
}

export interface SaveExpenseHeadInput {
  id?: string;
  headCode?: string;
  headName: string;
  description?: string | null;
  displayOrder?: number;
  activeStatus?: boolean;
}

export interface SaveExpenseSubHeadInput {
  id?: string;
  headId: string;
  subHeadCode?: string;
  subHeadName: string;
  defaultUnit: string;
  defaultTaxTreatment: BudgetTaxTreatment;
  defaultGstRate: number;
  defaultGstType: BudgetGstType;
  defaultRecoverableTaxPct: number;
  defaultAllocationDriver?: string | null;
  pnlTreatment?: "operating_expense" | "direct_cost" | "non_operating" | "excluded";
  displayOrder?: number;
  activeStatus?: boolean;
}

export const financeExpenseMasterService = {
  async list(includeInactive = false) {
    const activeClause = includeInactive ? "" : "WHERE h.active_status = 1";
    const subHeadActiveClause = includeInactive
      ? ""
      : "AND sh.active_status = 1";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT h.id AS head_id,
              h.head_code,
              h.head_name,
              h.description AS head_description,
              h.display_order AS head_display_order,
              h.active_status AS head_active_status,
              sh.id AS sub_head_id,
              sh.sub_head_code,
              sh.sub_head_name,
              sh.default_unit,
              sh.default_tax_treatment,
              sh.default_gst_rate,
              sh.default_gst_type,
              sh.default_recoverable_tax_pct,
              sh.default_allocation_driver,
              sh.pnl_treatment,
              sh.display_order AS sub_head_display_order,
              sh.active_status AS sub_head_active_status
         FROM finance_expense_head_master h
         LEFT JOIN finance_expense_sub_head_master sh
           ON sh.head_id = h.id ${subHeadActiveClause}
         ${activeClause}
        ORDER BY h.display_order, h.head_name, sh.display_order, sh.sub_head_name`
    );

    const map = new Map<string, any>();
    for (const row of rows) {
      const headId = String(row.head_id);
      if (!map.has(headId)) {
        map.set(headId, {
          id: headId,
          headCode: row.head_code,
          headName: row.head_name,
          description: row.head_description,
          displayOrder: Number(row.head_display_order ?? 0),
          activeStatus: Number(row.head_active_status ?? 0) === 1,
          subHeads: [],
        });
      }
      if (row.sub_head_id) {
        map.get(headId).subHeads.push({
          id: String(row.sub_head_id),
          subHeadCode: row.sub_head_code,
          subHeadName: row.sub_head_name,
          defaultUnit: row.default_unit,
          defaultTaxTreatment: row.default_tax_treatment,
          defaultGstRate: Number(row.default_gst_rate ?? 0),
          defaultGstType: row.default_gst_type,
          defaultRecoverableTaxPct: Number(
            row.default_recoverable_tax_pct ?? 0
          ),
          defaultAllocationDriver: row.default_allocation_driver,
          pnlTreatment: row.pnl_treatment,
          displayOrder: Number(row.sub_head_display_order ?? 0),
          activeStatus: Number(row.sub_head_active_status ?? 0) === 1,
        });
      }
    }
    return Array.from(map.values());
  },

  async saveHead(input: SaveExpenseHeadInput, actorUserId: string) {
    const headName = input.headName?.trim();
    if (!headName) throw new Error("Head name is required");
    const headCode = codeFromName(input.headCode || headName);
    if (!headCode) throw new Error("Head code could not be generated");
    const displayOrder = Number(input.displayOrder ?? 0);
    if (!Number.isInteger(displayOrder) || displayOrder < 0) {
      throw new Error("Display order must be a positive whole number");
    }
    const activeStatus = input.activeStatus === false ? 0 : 1;

    if (input.id) {
      const [result] = await db.execute<ResultSetHeader>(
        `UPDATE finance_expense_head_master
            SET head_code = ?,
                head_name = ?,
                description = ?,
                display_order = ?,
                active_status = ?,
                updated_by = ?,
                updated_at = NOW()
          WHERE id = ?`,
        [
          headCode,
          headName,
          input.description?.trim() || null,
          displayOrder,
          activeStatus,
          actorUserId,
          input.id,
        ]
      );
      if (result.affectedRows !== 1) throw new Error("Expense head not found");
      return { id: input.id };
    }

    const id = randomUUID();
    await db.execute(
      `INSERT INTO finance_expense_head_master
       (id, head_code, head_name, description, display_order, active_status,
        created_by, updated_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        id,
        headCode,
        headName,
        input.description?.trim() || null,
        displayOrder,
        activeStatus,
        actorUserId,
        actorUserId,
      ]
    );
    return { id };
  },

  async saveSubHead(input: SaveExpenseSubHeadInput, actorUserId: string) {
    if (!input.headId) throw new Error("Expense head is required");
    const subHeadName = input.subHeadName?.trim();
    if (!subHeadName) throw new Error("Sub-head name is required");
    if (!input.defaultUnit?.trim()) throw new Error("Default unit is required");
    if (!TAX_TREATMENTS.has(input.defaultTaxTreatment)) {
      throw new Error("Invalid default tax treatment");
    }
    if (!GST_TYPES.has(input.defaultGstType)) {
      throw new Error("Invalid default GST type");
    }
    const gstRate = Number(input.defaultGstRate ?? 0);
    if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100) {
      throw new Error("Default GST rate must be between 0 and 100");
    }
    const recoverablePct = Number(input.defaultRecoverableTaxPct ?? 0);
    if (
      !Number.isFinite(recoverablePct)
      || recoverablePct < 0
      || recoverablePct > 100
    ) {
      throw new Error("Recoverable GST must be between 0 and 100");
    }
    const pnlTreatment = input.pnlTreatment ?? "operating_expense";
    if (!PNL_TREATMENTS.has(pnlTreatment)) {
      throw new Error("Invalid P&L treatment");
    }
    const displayOrder = Number(input.displayOrder ?? 0);
    if (!Number.isInteger(displayOrder) || displayOrder < 0) {
      throw new Error("Display order must be a positive whole number");
    }

    const [heads] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM finance_expense_head_master WHERE id = ? LIMIT 1`,
      [input.headId]
    );
    if (!heads[0]) throw new Error("Expense head not found");

    const subHeadCode = codeFromName(input.subHeadCode || subHeadName);
    const activeStatus = input.activeStatus === false ? 0 : 1;
    const values = [
      input.headId,
      subHeadCode,
      subHeadName,
      input.defaultUnit.trim(),
      input.defaultTaxTreatment,
      gstRate,
      input.defaultGstType,
      recoverablePct,
      input.defaultAllocationDriver?.trim() || null,
      pnlTreatment,
      displayOrder,
      activeStatus,
      actorUserId,
    ];

    if (input.id) {
      const [result] = await db.execute<ResultSetHeader>(
        `UPDATE finance_expense_sub_head_master
            SET head_id = ?,
                sub_head_code = ?,
                sub_head_name = ?,
                default_unit = ?,
                default_tax_treatment = ?,
                default_gst_rate = ?,
                default_gst_type = ?,
                default_recoverable_tax_pct = ?,
                default_allocation_driver = ?,
                pnl_treatment = ?,
                display_order = ?,
                active_status = ?,
                updated_by = ?,
                updated_at = NOW()
          WHERE id = ?`,
        [...values, input.id]
      );
      if (result.affectedRows !== 1) throw new Error("Expense sub-head not found");
      return { id: input.id };
    }

    const id = randomUUID();
    await db.execute(
      `INSERT INTO finance_expense_sub_head_master
       (id, head_id, sub_head_code, sub_head_name, default_unit,
        default_tax_treatment, default_gst_rate, default_gst_type,
        default_recoverable_tax_pct, default_allocation_driver, pnl_treatment,
        display_order, active_status, created_by, updated_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, ...values.slice(0, 12), actorUserId, actorUserId]
    );
    return { id };
  },
};
