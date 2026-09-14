import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Coerce whatever a caller sent into the 0/1 the column stores.
 *
 * This was `input.activeStatus === false ? 0 : 1`, which only recognised a literal boolean false.
 * A JSON client sending `activeStatus: 0` — the obvious thing to send for a TINYINT column — hit
 * `0 === false` (false under strict equality), so the row stayed ACTIVE while the API still
 * answered success. Retiring a head appeared to work and silently did nothing, which is how a junk
 * "test / testtest" sub-head went on blocking every branch's budget submission at 97.44% coverage.
 */
function toActiveFlag(value: unknown): 0 | 1 {
  if (value === undefined || value === null) return 1;
  if (typeof value === "string") {
    const normalised = value.trim().toLowerCase();
    return normalised === "0" || normalised === "false" || normalised === "" ? 0 : 1;
  }
  return Number(value) === 0 ? 0 : 1;
}
import { writeAuditLog } from "../../shared/auditLog.js";
import { tableExists } from "../../shared/dbHelpers.js";
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

/**
 * Where a head or sub-head is still referenced. Budget lines and GRNs record the head/sub-head by
 * NAME rather than by id — there is no foreign key to follow — so those two are counted by name,
 * and by head code as well because older rows carry the code in the same column. Coverage reviews
 * do point at the master row by id (finance_budget_subhead_status has real foreign keys) and are
 * counted separately.
 */
export interface ExpenseMasterUsage {
  budgetLines: number;
  grns: number;
  coverageReviews: number;
}

export interface DeleteExpenseMasterResult {
  id: string;
  name: string;
  /** true when the row was removed outright; false when it was retired (active_status = 0). */
  removed: boolean;
  usage: ExpenseMasterUsage;
}

const usageTotal = (usage: ExpenseMasterUsage) =>
  usage.budgetLines + usage.grns + usage.coverageReviews;

const addUsage = (a: ExpenseMasterUsage, b: ExpenseMasterUsage): ExpenseMasterUsage => ({
  budgetLines: a.budgetLines + b.budgetLines,
  grns: a.grns + b.grns,
  coverageReviews: a.coverageReviews + b.coverageReviews,
});

/** Table names here are literals from this module, never user input. */
async function countRows(table: string, where: string, params: unknown[]) {
  if (!(await tableExists(table))) return 0;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM ${table} ${where}`,
    params
  );
  return Number(rows[0]?.n ?? 0);
}

async function headUsage(
  headId: string,
  headName: string,
  headCode: string
): Promise<ExpenseMasterUsage> {
  const nameParams = [headName, headCode];
  const nameClause = "WHERE LOWER(head) IN (LOWER(?), LOWER(?))";
  return {
    budgetLines: await countRows("finance_budget_line", nameClause, nameParams),
    grns: await countRows("grn_request", nameClause, nameParams),
    coverageReviews: await countRows(
      "finance_budget_subhead_status",
      "WHERE expense_head_id = ?",
      [headId]
    ),
  };
}

async function subHeadUsage(
  subHeadId: string,
  subHeadName: string,
  headName: string,
  headCode: string
): Promise<ExpenseMasterUsage> {
  // Scoped to the parent head as well, because sub-head names are only unique within a head.
  const nameParams = [subHeadName, headName, headCode];
  const nameClause =
    "WHERE LOWER(COALESCE(sub_head, '')) = LOWER(?) AND LOWER(head) IN (LOWER(?), LOWER(?))";
  return {
    budgetLines: await countRows("finance_budget_line", nameClause, nameParams),
    grns: await countRows("grn_request", nameClause, nameParams),
    coverageReviews: await countRows(
      "finance_budget_subhead_status",
      "WHERE expense_sub_head_id = ?",
      [subHeadId]
    ),
  };
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
              sh.capex_opex,
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
          capexOpex: row.capex_opex ?? null,
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
    const activeStatus = toActiveFlag(input.activeStatus);

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
    const activeStatus = toActiveFlag(input.activeStatus);
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

  /**
   * Remove a sub-head when nothing references it, retire it when something does.
   *
   * A budget line records its sub-head by name, and an approved budget is a financial record, so a
   * sub-head that any line or GRN already names is never dropped — it is set inactive, which is
   * what both the planner and the master list filter on, so it disappears from every picker while
   * the history that names it stays readable.
   */
  async deleteSubHead(
    id: string,
    actorUserId: string
  ): Promise<DeleteExpenseMasterResult> {
    if (!id) throw new Error("Sub-head id is required");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT sh.id, sh.sub_head_name, sh.active_status, h.head_name, h.head_code
         FROM finance_expense_sub_head_master sh
         JOIN finance_expense_head_master h ON h.id = sh.head_id
        WHERE sh.id = ? LIMIT 1`,
      [id]
    );
    const row = rows[0];
    if (!row) throw new Error("Expense sub-head not found");

    const usage = await subHeadUsage(
      id,
      String(row.sub_head_name),
      String(row.head_name),
      String(row.head_code)
    );
    const removed = usageTotal(usage) === 0;

    if (removed) {
      await db.execute(
        `DELETE FROM finance_expense_sub_head_master WHERE id = ?`,
        [id]
      );
    } else {
      await db.execute(
        `UPDATE finance_expense_sub_head_master
            SET active_status = 0, updated_by = ?, updated_at = NOW()
          WHERE id = ?`,
        [actorUserId, id]
      );
    }

    await writeAuditLog({
      actor_user_id: actorUserId,
      action_type: removed ? "expense_sub_head_deleted" : "expense_sub_head_retired",
      module_key: "finance_expense_master",
      entity_type: "finance_expense_sub_head_master",
      entity_id: id,
      metadata: { subHeadName: row.sub_head_name, headName: row.head_name, usage },
    });

    return { id, name: String(row.sub_head_name), removed, usage };
  },

  /**
   * Remove a head when neither it nor any of its sub-heads is referenced, retire it otherwise.
   *
   * A head is only dropped together with its sub-heads, because the sub-head table has a foreign
   * key to it. Retiring leaves the sub-head rows' own active_status untouched: the list query
   * already hides every sub-head of an inactive head, so nothing extra needs changing, and a
   * restore then puts back exactly what was there.
   */
  async deleteHead(
    id: string,
    actorUserId: string
  ): Promise<DeleteExpenseMasterResult> {
    if (!id) throw new Error("Head id is required");
    const [heads] = await db.execute<RowDataPacket[]>(
      `SELECT id, head_name, head_code FROM finance_expense_head_master WHERE id = ? LIMIT 1`,
      [id]
    );
    const head = heads[0];
    if (!head) throw new Error("Expense head not found");

    const headName = String(head.head_name);
    const headCode = String(head.head_code);
    const [subHeads] = await db.execute<RowDataPacket[]>(
      `SELECT id, sub_head_name FROM finance_expense_sub_head_master WHERE head_id = ?`,
      [id]
    );

    let usage = await headUsage(id, headName, headCode);
    for (const sub of subHeads) {
      usage = addUsage(
        usage,
        await subHeadUsage(String(sub.id), String(sub.sub_head_name), headName, headCode)
      );
    }
    const removed = usageTotal(usage) === 0;

    if (removed) {
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute(
          `DELETE FROM finance_expense_sub_head_master WHERE head_id = ?`,
          [id]
        );
        await connection.execute(
          `DELETE FROM finance_expense_head_master WHERE id = ?`,
          [id]
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } else {
      await db.execute(
        `UPDATE finance_expense_head_master
            SET active_status = 0, updated_by = ?, updated_at = NOW()
          WHERE id = ?`,
        [actorUserId, id]
      );
    }

    await writeAuditLog({
      actor_user_id: actorUserId,
      action_type: removed ? "expense_head_deleted" : "expense_head_retired",
      module_key: "finance_expense_master",
      entity_type: "finance_expense_head_master",
      entity_id: id,
      metadata: { headName, subHeadCount: subHeads.length, usage },
    });

    return { id, name: headName, removed, usage };
  },
};
