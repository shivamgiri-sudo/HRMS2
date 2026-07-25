import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

export interface GrnLobAllocationInput {
  budgetLineId: string;
  processLobId?: string | null;
}

function dateOnly(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

async function effectiveLobs(
  connection: PoolConnection,
  processId: string,
  effectiveDate: string
) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT id, lob_code, lob_name, approval_status, active_status
       FROM process_lob_master
      WHERE process_id = ?
        AND active_status = 1
        AND approval_status = 'approved'
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to >= ?)
      ORDER BY lob_code
      FOR UPDATE`,
    [processId, effectiveDate, effectiveDate]
  );
  return rows;
}

async function resolveLob(
  connection: PoolConnection,
  row: RowDataPacket,
  requestedLobId: string | null,
  effectiveDate: string,
  rowNumber: number
) {
  const processId = row.process_id ? String(row.process_id) : null;
  if (!processId) {
    if (requestedLobId) {
      throw Object.assign(
        new Error(`Allocation ${rowNumber}: a branch/shared budget line cannot be assigned directly to a process LOB`),
        { statusCode: 400 }
      );
    }
    return null;
  }

  const lobs = await effectiveLobs(connection, processId, effectiveDate);
  if (!lobs.length) {
    throw Object.assign(
      new Error(`Allocation ${rowNumber}: process has no approved active LOB for ${effectiveDate}`),
      { statusCode: 400 }
    );
  }

  if (requestedLobId) {
    const selected = lobs.find((lob) => String(lob.id) === requestedLobId);
    if (!selected) {
      throw Object.assign(
        new Error(`Allocation ${rowNumber}: selected LOB is inactive, outside its effective period, or belongs to another process`),
        { statusCode: 400 }
      );
    }
    return String(selected.id);
  }

  const budgetPreferred = row.budget_process_lob_id
    ? lobs.find((lob) => String(lob.id) === String(row.budget_process_lob_id))
    : null;
  if (budgetPreferred) return String(budgetPreferred.id);

  const businessLobs = lobs.filter((lob) => String(lob.lob_code).toUpperCase() !== "DEFAULT");
  if (businessLobs.length === 1) return String(businessLobs[0].id);
  if (businessLobs.length === 0 && lobs.length === 1) return String(lobs[0].id);

  throw Object.assign(
    new Error(
      `Allocation ${rowNumber}: process has ${businessLobs.length || lobs.length} active LOBs. Select the exact LOB before submission.`
    ),
    { statusCode: 400 }
  );
}

export const grnLobAttributionService = {
  async apply(
    grnId: string,
    input: GrnLobAllocationInput[],
    actorUserId: string,
    actorRole: string
  ) {
    if (!Array.isArray(input) || !input.length) {
      throw Object.assign(new Error("At least one GRN allocation is required"), { statusCode: 400 });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [grnRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id, status, bill_date, service_period_end
           FROM grn_request
          WHERE id = ?
          FOR UPDATE`,
        [grnId]
      );
      const grn = grnRows[0];
      if (!grn) throw Object.assign(new Error("GRN not found"), { statusCode: 404 });
      if (String(grn.status) !== "draft") {
        throw Object.assign(new Error("LOB attribution can only be changed while the GRN is a draft"), { statusCode: 400 });
      }

      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT a.id, a.sequence_no, a.budget_line_id, a.process_id, a.process_lob_id,
                b.process_lob_id AS budget_process_lob_id
           FROM grn_cost_allocation a
           JOIN finance_budget_line b ON b.id = a.budget_line_id
          WHERE a.grn_request_id = ?
          ORDER BY a.sequence_no
          FOR UPDATE`,
        [grnId]
      );
      if (rows.length !== input.length) {
        throw Object.assign(
          new Error("GRN allocation rows changed before LOB attribution; refresh and retry"),
          { statusCode: 409 }
        );
      }

      const effectiveDate = dateOnly(grn.service_period_end) ?? dateOnly(grn.bill_date);
      if (!effectiveDate) {
        throw Object.assign(new Error("GRN service period or bill date is required before LOB attribution"), { statusCode: 400 });
      }

      const changes: Array<{
        allocationId: string;
        budgetLineId: string;
        processId: string | null;
        processLobId: string | null;
      }> = [];

      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const supplied = input[index];
        if (String(row.budget_line_id) !== String(supplied?.budgetLineId ?? "")) {
          throw Object.assign(
            new Error(`Allocation ${index + 1}: budget-line order changed; refresh and retry`),
            { statusCode: 409 }
          );
        }
        const processLobId = await resolveLob(
          connection,
          row,
          supplied.processLobId ? String(supplied.processLobId) : null,
          effectiveDate,
          index + 1
        );
        await connection.execute(
          "UPDATE grn_cost_allocation SET process_lob_id = ?, updated_at = NOW() WHERE id = ?",
          [processLobId, row.id]
        );
        changes.push({
          allocationId: String(row.id),
          budgetLineId: String(row.budget_line_id),
          processId: row.process_id ? String(row.process_id) : null,
          processLobId,
        });
      }

      const processRows = rows.filter((row) => row.process_id);
      const unmapped = processRows.filter((row, index) => !changes[index]?.processLobId);
      if (unmapped.length) {
        throw Object.assign(new Error("Every process-linked GRN allocation must have a LOB"), { statusCode: 400 });
      }

      await connection.commit();
      await logSensitiveAction({
        actor_user_id: actorUserId,
        actor_role: actorRole,
        action_type: "GRN_LOB_ATTRIBUTION_SAVED",
        module_key: "FINANCE",
        entity_type: "grn_request",
        entity_id: grnId,
        change_summary: {
          effective_date: effectiveDate,
          allocations: changes,
        },
      });
      return { success: true, allocations: changes };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
};
