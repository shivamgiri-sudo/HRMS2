import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

/**
 * The pool wrapper or a single transaction-bound connection — whichever the caller has.
 *
 * The employee-row move has to run both standalone (the deferred worker, which claims each
 * row first and applies it in autocommit) and inside the approval transaction below, without
 * the logic existing twice. Only execute() is needed, and the two types spell its overloads
 * differently, so this is deliberately the narrowest shape both satisfy.
 */
type SqlExecutor = {
  execute(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
};

/**
 * A transfer refusal the operator needs to read — already actioned, gone, or a master value
 * that does not resolve. The production error handler replaces the message of any throw
 * carrying no statusCode, so these arrived as a bare 500 with the reason stripped.
 */
function mobilityError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

/**
 * Move the employee for one approved transfer, on whichever executor is given.
 *
 * The master lookup deliberately throws rather than writing NULL: a transfer naming a branch
 * that does not resolve must fail loudly, not quietly detach the employee from every
 * branch-scoped query in the app. Run inside the approval transaction, that throw now also
 * rolls the transfer back out of 'completed'.
 */
async function applyTransferOn(
  exec: SqlExecutor,
  employee_id: string,
  transfer_type: string,
  to_value: string
): Promise<void> {
  const resolveMaster = async (sql: string, label: string, table: string): Promise<string> => {
    const [r] = await exec.execute(sql, [to_value, to_value]);
    const masterId = ((r as RowDataPacket[])[0] as { id?: unknown } | undefined)?.id ?? null;
    // Message wording preserved: existing callers and logs key off "not found in <table>".
    if (!masterId) throw mobilityError(422, `Transfer: ${label} '${to_value}' not found in ${table}`);
    return String(masterId);
  };

  if (transfer_type === "branch") {
    const masterId = await resolveMaster(
      "SELECT id FROM branch_master WHERE id = ? OR branch_name COLLATE utf8mb4_unicode_ci = ? LIMIT 1",
      "branch",
      "branch_master"
    );
    await exec.execute("UPDATE employees SET branch_id = ? WHERE id = ?", [masterId, employee_id]);

  } else if (transfer_type === "department") {
    const masterId = await resolveMaster(
      "SELECT id FROM department_master WHERE id = ? OR dept_name COLLATE utf8mb4_unicode_ci = ? LIMIT 1",
      "department",
      "department_master"
    );
    await exec.execute("UPDATE employees SET department_id = ? WHERE id = ?", [masterId, employee_id]);

  } else if (transfer_type === "designation") {
    const masterId = await resolveMaster(
      "SELECT id FROM designation_master WHERE id = ? OR designation_name COLLATE utf8mb4_unicode_ci = ? LIMIT 1",
      "designation",
      "designation_master"
    );
    await exec.execute("UPDATE employees SET designation_id = ? WHERE id = ?", [masterId, employee_id]);

  } else if (transfer_type === "process") {
    const masterId = await resolveMaster(
      "SELECT id FROM process_master WHERE id = ? OR process_name COLLATE utf8mb4_unicode_ci = ? LIMIT 1",
      "process",
      "process_master"
    );
    await exec.execute("UPDATE employees SET process_id = ? WHERE id = ?", [masterId, employee_id]);

  } else if (transfer_type === "reporting_manager") {
    // to_value is the new manager's employee_id for RM transfers.
    await exec.execute(
      `UPDATE employees SET reporting_manager_id = ? WHERE id = ?`,
      [to_value, employee_id]
    );
  }
}

interface TransferFilters {
  employee_id?: string;
  status?: string;
}

interface PromotionFilters {
  employee_id?: string;
  status?: string;
}

interface CreateTransfer {
  employee_id: string;
  transfer_type: string;
  from_value: string;
  to_value: string;
  effective_date: string;
  reason?: string;
  initiated_by: string;
}

interface CreatePromotion {
  employee_id: string;
  from_designation?: string;
  to_designation: string;
  from_grade?: string;
  to_grade?: string;
  effective_date: string;
  salary_revision?: number;
  reason?: string;
  initiated_by: string;
}

interface ApproveRejectData {
  action: "approved" | "rejected";
  remarks?: string;
  approved_by: string;
}

export const mobilityService = {
  // ── Transfers ────────────────────────────────────────────────────────────

  async listTransfers(filters: TransferFilters) {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.employee_id) { conds.push("t.employee_id = ?"); params.push(filters.employee_id); }
    if (filters.status)      { conds.push("t.status = ?");      params.push(filters.status); }
    const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT t.*, e.full_name AS employee_name, e.employee_code
       FROM transfer_record t
       LEFT JOIN employees e ON e.id = t.employee_id
       ${where}
       ORDER BY t.created_at DESC LIMIT 200`,
      params
    );
    return rows as RowDataPacket[];
  },

  async createTransfer(data: CreateTransfer) {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO transfer_record
         (id, employee_id, transfer_type, from_value, to_value, effective_date, reason, initiated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.employee_id,
        data.transfer_type,
        data.from_value,
        data.to_value,
        data.effective_date,
        data.reason ?? null,
        data.initiated_by,
      ]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM transfer_record WHERE id = ? LIMIT 1",
      [id]
    );
    return (rows as RowDataPacket[])[0];
  },

  /**
   * Approve or reject a transfer, and — when it is already due — move the employee.
   *
   * These were four unrelated autocommit statements: the status UPDATE, a re-SELECT, the
   * employee-row move, then the journey log. The status went to 'completed' first and on its
   * own, so any failure after it left the record saying the transfer had happened while the
   * employee was still in their old branch, process or reporting line.
   *
   * That was not a theoretical window. applyTransferToEmployee throws by design when a master
   * lookup misses — "branch 'X' not found in branch_master" — precisely so a FK is never
   * silently nulled. On that throw the transfer stayed 'completed', the employee never moved,
   * AND neither the journey log nor the TRANSFER_APPROVED audit ran, so nothing recorded that
   * anything had gone wrong. The record simply read as a completed transfer that never
   * happened.
   *
   * Status, employee move and journey log now share one transaction. The row is locked and
   * the status re-checked under that lock, so two approvers cannot both action the same
   * transfer — previously both succeeded, moving the employee twice and writing two audits.
   *
   * The future-dated rule is unchanged: a transfer whose effective_date has not arrived is
   * approved and held, and mobility-transfer.worker.ts applies it on the day.
   */
  async updateTransfer(id: string, data: ApproveRejectData) {
    const finalStatus = data.action === "approved" ? "completed" : "rejected";
    const today = new Date().toISOString().slice(0, 10);

    let approvedContext:
      | { employee_id: string; transfer_type: string; from_value: string; to_value: string; effectiveDateStr: string; isDue: boolean }
      | null = null;

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [lockedRows] = await conn.execute<RowDataPacket[]>(
        "SELECT * FROM transfer_record WHERE id = ? FOR UPDATE",
        [id]
      );
      const record = (lockedRows as RowDataPacket[])[0] ?? null;
      if (!record) throw mobilityError(404, "Transfer record not found");

      const currentStatus = String((record as { status?: unknown }).status ?? "");
      if (currentStatus !== "pending") {
        throw mobilityError(409, `Transfer has already been actioned — it is '${currentStatus}'`);
      }

      const [statusResult] = await conn.execute<ResultSetHeader>(
        `UPDATE transfer_record SET status = ?, approved_by = ?, updated_at = NOW()
          WHERE id = ? AND status = ?`,
        [finalStatus, data.approved_by, id, currentStatus]
      );
      if (statusResult.affectedRows !== 1) {
        throw mobilityError(409, "Transfer was actioned by someone else while this approval was in flight");
      }

      if (data.action === "approved") {
        const { employee_id, transfer_type, from_value, to_value, effective_date } = record as unknown as {
          employee_id: string;
          transfer_type: string;
          from_value: string;
          to_value: string;
          effective_date: string | null;
        };

        // Only move the employee once the effective date has been reached. Future-dated
        // transfers are approved but held; mobility-transfer.worker.ts applies them on the day.
        const effectiveDateStr = effective_date ? String(effective_date).slice(0, 10) : today;
        const isDue = effectiveDateStr <= today;

        if (isDue) {
          // Claimed the same way the deferred sweep claims: whoever stamps applied_at wins,
          // so the worker and this path can never both move the same employee.
          const [claim] = await conn.execute<ResultSetHeader>(
            `UPDATE transfer_record SET applied_at = NOW() WHERE id = ? AND applied_at IS NULL`,
            [id]
          );
          if (claim.affectedRows !== 1) {
            throw mobilityError(409, "Transfer has already been applied to the employee record");
          }
          await applyTransferOn(conn, employee_id, transfer_type, to_value);
        }

        await conn.execute(
          `INSERT INTO employee_journey_log
             (id, employee_id, event_type, event_date, description, module, triggered_by, metadata)
           VALUES (?, ?, 'transfer', ?, ?, 'MOBILITY', ?, ?)`,
          [
            randomUUID(),
            employee_id,
            effectiveDateStr,
            `Transfer: ${from_value} → ${to_value}${isDue ? "" : ` (effective ${effectiveDateStr})`}`,
            data.approved_by,
            JSON.stringify({ transfer_id: id, transfer_type, from_value, to_value, effective_date: effectiveDateStr, applied: isDue }),
          ]
        );

        approvedContext = { employee_id, transfer_type, from_value, to_value, effectiveDateStr, isDue };
      }

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      // 45 workers share this pool; one connection left unreleased has starved all of them.
      conn.release();
    }

    // Post-commit. The audit writer is non-throwing and cannot join a transaction, so it runs
    // only once the move it describes is durable — never for one that rolled back.
    if (approvedContext) {
      await logSensitiveAction({
        actor_user_id: data.approved_by,
        action_type: "TRANSFER_APPROVED",
        module_key: "MOBILITY",
        entity_type: "employee",
        entity_id: approvedContext.employee_id,
        change_summary: {
          transfer_type: approvedContext.transfer_type,
          from_value: approvedContext.from_value,
          to_value: approvedContext.to_value,
          effective_date: approvedContext.effectiveDateStr,
          applied: approvedContext.isDue,
        },
      });
    }

    // Re-fetch updated record
    const [updated] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM transfer_record WHERE id = ? LIMIT 1",
      [id]
    );
    return (updated as RowDataPacket[])[0] ?? null;
  },

  // Applies a single approved transfer's employee-row update. Called at approval
  // time when effective_date <= today, and by the deferred-transfer worker.
  // Throws if the master-table lookup returns NULL — callers must not silently null a FK.
  async applyTransferToEmployee(
    employee_id: string,
    transfer_type: string,
    to_value: string,
    transfer_id: string
  ): Promise<void> {
    await applyTransferOn(db, employee_id, transfer_type, to_value);

    // Mark applied so the deferred job does not re-apply. The deferred sweep has already
    // claimed the row before calling this, so the stamp is a confirmation there; on any
    // other path it is the claim itself.
    await db.execute(
      `UPDATE transfer_record SET applied_at = NOW() WHERE id = ?`,
      [transfer_id]
    );
  },

  /**
   * Apply all approved transfers whose effective_date has been reached but whose applied_at
   * is still NULL.
   *
   * SCHEDULED as of 2026-08-15 by mobility-transfer.worker.ts, which is registered in BOTH
   * server.ts and all-workers.ts — a worker present in only one of those never runs in every
   * deployment shape, so both registrations matter. An earlier version of this comment said
   * the function was unscheduled and called by nothing; that was true when written and is not
   * now. Left corrected rather than deleted because "nothing calls this" is exactly the claim
   * a future reader would act on.
   *
   * What it fixes: a FUTURE-DATED transfer used to be approved, recorded, and then never
   * applied — the employee stayed in their old branch/process/manager indefinitely while the
   * transfer_record sat due and unactioned. Immediate transfers (effective_date <= today)
   * apply inline from updateTransfer at approval time.
   *
   * Migration 1221 is what made it capable of running at all: applied_at did not exist, so
   * every statement here raised ER_BAD_FIELD_ERROR.
   */
  async applyPendingTransfers(): Promise<number> {
    const [pending] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_id, transfer_type, to_value
         FROM transfer_record
        WHERE status = 'completed'
          AND applied_at IS NULL
          AND effective_date <= CURDATE()`
    );
    let applied = 0;
    let failed = 0;

    for (const row of pending as RowDataPacket[]) {
      const transferId = String(row.id);

      // Claim the row BEFORE moving the employee, with an expected-state UPDATE.
      //
      // The SELECT above and the apply below are not atomic together: two workers (or a
      // worker and a manual invocation) can both read the same pending row. Whoever wins
      // this UPDATE gets affectedRows 1; the loser gets 0 and skips, so the employee master
      // is never moved twice by the same transfer. Claiming first also means a crash between
      // the employee UPDATE and the stamp can no longer leave a transfer that re-applies on
      // every subsequent run.
      const [claim] = await db.execute<import("mysql2").ResultSetHeader>(
        `UPDATE transfer_record SET applied_at = NOW() WHERE id = ? AND applied_at IS NULL`,
        [transferId]
      );
      if (claim.affectedRows !== 1) {
        console.warn(`[mobility] deferred transfer ${transferId} already claimed by another run — skipping`);
        continue;
      }

      try {
        await mobilityService.applyTransferToEmployee(
          String(row.employee_id),
          String(row.transfer_type),
          String(row.to_value),
          transferId
        );
        applied++;
      } catch (err) {
        // Release the claim so a later run retries, rather than leaving the transfer
        // permanently marked applied when the employee was never actually moved.
        failed++;
        await db.execute(
          `UPDATE transfer_record SET applied_at = NULL WHERE id = ?`,
          [transferId]
        ).catch((releaseErr) => {
          console.error(`[mobility] could not release claim on ${transferId} — it will not retry:`, releaseErr);
        });
        console.error(`[mobility] Failed to apply deferred transfer ${transferId}:`, err);
      }
    }

    if (failed > 0) {
      // Surfaced, not swallowed: a deferred transfer that silently never lands is a person
      // whose branch, manager and payroll scope are wrong for as long as nobody notices.
      console.error(`[mobility] applyPendingTransfers: ${applied} applied, ${failed} FAILED and will be retried`);
    }
    return applied;
  },

  // ── Promotions ───────────────────────────────────────────────────────────

  async listPromotions(filters: PromotionFilters) {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.employee_id) { conds.push("p.employee_id = ?"); params.push(filters.employee_id); }
    if (filters.status)      { conds.push("p.status = ?");      params.push(filters.status); }
    const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT p.*, e.full_name AS employee_name, e.employee_code
       FROM promotion_record p
       LEFT JOIN employees e ON e.id = p.employee_id
       ${where}
       ORDER BY p.created_at DESC LIMIT 200`,
      params
    );
    return rows as RowDataPacket[];
  },

  async createPromotion(data: CreatePromotion) {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO promotion_record
         (id, employee_id, from_designation, to_designation, from_grade, to_grade,
          effective_date, salary_revision, reason, initiated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.employee_id,
        data.from_designation ?? null,
        data.to_designation,
        data.from_grade ?? null,
        data.to_grade ?? null,
        data.effective_date,
        data.salary_revision ?? null,
        data.reason ?? null,
        data.initiated_by,
      ]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM promotion_record WHERE id = ? LIMIT 1",
      [id]
    );
    return (rows as RowDataPacket[])[0];
  },

  async updatePromotion(id: string, data: ApproveRejectData) {
    const finalStatus = data.action === "approved" ? "completed" : "rejected";

    if (data.action !== "approved") {
      // Rejection is a simple status update — no downstream writes, no transaction needed.
      await db.execute(
        `UPDATE promotion_record SET status = ?, approved_by = ?, updated_at = NOW() WHERE id = ?`,
        [finalStatus, data.approved_by, id]
      );
      const [updated] = await db.execute<RowDataPacket[]>(
        "SELECT * FROM promotion_record WHERE id = ? LIMIT 1",
        [id]
      );
      return (updated as RowDataPacket[])[0] ?? null;
    }

    // Approval: all downstream writes (status, designation, salary, journey log) must be
    // atomic. Previously none of these were wrapped in a transaction, so a salary-revision
    // failure left the designation already changed and the record marked completed.
    const conn = await db.getConnection();
    try {
      await conn.execute("START TRANSACTION");

      await conn.execute(
        `UPDATE promotion_record SET status = ?, approved_by = ?, updated_at = NOW() WHERE id = ?`,
        [finalStatus, data.approved_by, id]
      );

      const [rows] = await conn.execute<RowDataPacket[]>(
        "SELECT * FROM promotion_record WHERE id = ? LIMIT 1",
        [id]
      );
      const record = (rows as RowDataPacket[])[0] ?? null;
      if (!record) {
        await conn.execute("ROLLBACK");
        return null;
      }

      const { employee_id, from_designation, to_designation, salary_revision } = record as {
        employee_id: string;
        from_designation: string | null;
        to_designation: string;
        salary_revision: number | null;
      };

      const [desigRows] = await conn.execute<RowDataPacket[]>(
        "SELECT id FROM designation_master WHERE id = ? OR designation_name COLLATE utf8mb4_unicode_ci = ? LIMIT 1",
        [to_designation, to_designation]
      );
      const newDesigId = (desigRows as RowDataPacket[])[0]?.id as string | undefined;
      if (!newDesigId) {
        await conn.execute("ROLLBACK");
        (conn as any).release?.();
        throw new Error(
          `Promotion ${id}: designation '${to_designation}' not found in designation_master`
        );
      }
      await conn.execute(
        `UPDATE employees SET designation_id = ? WHERE id = ?`,
        [newDesigId, employee_id]
      );

      if (salary_revision != null && salary_revision > 0) {
        const [currentRows] = await conn.execute<RowDataPacket[]>(
          `SELECT structure_id
             FROM employee_salary_assignment
            WHERE employee_id = ? AND active_status = 1
            ORDER BY effective_from DESC
            LIMIT 1`,
          [employee_id]
        );
        const structureId = (currentRows as RowDataPacket[])[0]?.structure_id as string | undefined;

        if (!structureId) {
          // No active salary assignment: roll back the whole promotion so the record
          // does not end up in a partial state (designation changed, salary not revised).
          await conn.execute("ROLLBACK");
          throw new Error(
            `Promotion ${id}: employee ${employee_id} has no active salary assignment. ` +
            `Assign a salary structure before approving a promotion with a salary revision.`
          );
        }

        await conn.execute(
          `UPDATE employee_salary_assignment
              SET active_status = 0, effective_to = CURDATE()
            WHERE employee_id = ? AND active_status = 1`,
          [employee_id]
        );
        await conn.execute(
          `INSERT INTO employee_salary_assignment
             (id, employee_id, structure_id, ctc_annual, effective_from, assigned_by, assignment_reason)
           VALUES (?, ?, ?, ?, CURDATE(), ?, ?)`,
          [
            randomUUID(),
            employee_id,
            structureId,
            salary_revision,
            data.approved_by,
            `Promotion: ${from_designation ?? "–"} → ${to_designation}`,
          ]
        );
      }

      await conn.execute(
        `INSERT INTO employee_journey_log
           (id, employee_id, event_type, event_date, description, module, triggered_by, metadata)
         VALUES (?, ?, 'promotion', CURDATE(), ?, 'MOBILITY', ?, ?)`,
        [
          randomUUID(),
          employee_id,
          `Promotion: ${from_designation ?? "–"} → ${to_designation}`,
          data.approved_by,
          JSON.stringify({ promotion_id: id, from_designation, to_designation, salary_revision }),
        ]
      );

      await conn.execute("COMMIT");

      await logSensitiveAction({
        actor_user_id: data.approved_by,
        action_type: "PROMOTION_APPROVED",
        module_key: "MOBILITY",
        entity_type: "employee",
        entity_id: employee_id,
        change_summary: { from_designation, to_designation, salary_revision },
      });
    } catch (err) {
      await conn.execute("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      (conn as any).release?.();
    }

    const [updated] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM promotion_record WHERE id = ? LIMIT 1",
      [id]
    );
    return (updated as RowDataPacket[])[0] ?? null;
  },
};
