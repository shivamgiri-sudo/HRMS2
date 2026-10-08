/**
 * dialer-hold.service.ts
 *
 * Manual-enforcement dialer hold for critical training TAT breaches (FR5 / US3.3).
 *
 * IMPORTANT — READ BEFORE CHANGING THIS FILE: this module never writes to Vicidial/the
 * dialer. backend/src/db/dialerDb.ts enforces that connection read-only at three layers
 * (SQL-verb allowlist, MySQL session `READ ONLY` transaction, DB grants), which is a
 * deliberate architectural boundary in this codebase, not a gap to route around. This
 * service records that a hold SHOULD happen and routes the actual pause to a human with
 * real Vicidial admin access via a Work Inbox item. See
 * backend/sql/1821_training_dialer_hold.sql for the full rationale.
 */
import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { createWorkItemIfNotExists } from "../work-inbox/work-inbox.service.js";
import { writeSensitiveActionLog } from "../../shared/auditLog.js";

export interface DialerHoldRow extends RowDataPacket {
  id: string;
  employee_id: string;
  training_assignment_id: string;
  status: "requested" | "applied" | "lifted" | "expired";
  requested_at: string;
  applied_by: string | null;
  applied_at: string | null;
  lifted_by: string | null;
  lifted_at: string | null;
  reason: string;
  notes: string | null;
}

/**
 * Requests a hold for a CRITICAL training assignment that has breached TAT, and raises the
 * Work Inbox item that routes the actual Vicidial pause to WFM/Ops. Idempotent per
 * assignment (uq_tdh_assignment) — a second poll finding the same still-breached
 * assignment does not raise a duplicate request or a duplicate Work Inbox item
 * (createWorkItemIfNotExists dedupes on entityType+entityId+itemType+pending).
 *
 * Returns null when a hold already exists for this assignment (not an error — the caller,
 * typically the escalation sweep, should treat this as "already handled").
 */
export async function requestDialerHold(params: {
  employeeId: string;
  trainingAssignmentId: string;
  reason: string;
  branchId?: string;
}): Promise<string | null> {
  const id = randomUUID();
  try {
    await db.execute(
      `INSERT INTO training_dialer_hold
         (id, employee_id, training_assignment_id, status, reason)
       VALUES (?, ?, ?, 'requested', ?)`,
      [id, params.employeeId, params.trainingAssignmentId, params.reason]
    );
  } catch (err) {
    if ((err as { code?: string }).code === "ER_DUP_ENTRY") return null;
    throw err;
  }

  await createWorkItemIfNotExists({
    itemType: "TRAINING_DIALER_HOLD",
    title: `Pause agent in dialer — critical training breach`,
    description:
      `${params.reason} Confirm the agent has been paused in Vicidial for this hold, then ` +
      `mark it applied. Lift the hold once training is completed.`,
    moduleCode: "governance",
    entityType: "training_dialer_hold",
    entityId: id,
    assignedToRole: "wfm",
    branchId: params.branchId,
    priority: "critical",
    dueAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " "),
  });

  return id;
}

/** WFM/Ops confirming they have paused the agent in Vicidial. Idempotent — a second call on an already-applied hold is a no-op, not an error, since two people confirming the same action is not a conflict worth failing on. */
export async function markDialerHoldApplied(
  holdId: string,
  appliedBy: string
): Promise<void> {
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE training_dialer_hold
        SET status = 'applied', applied_by = ?, applied_at = NOW(), updated_at = NOW()
      WHERE id = ? AND status = 'requested'`,
    [appliedBy, holdId]
  );
  if (result.affectedRows === 0) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT status FROM training_dialer_hold WHERE id = ? LIMIT 1`,
      [holdId]
    );
    const current = (rows as RowDataPacket[])[0]?.status;
    if (!current) {
      throw Object.assign(new Error("Dialer hold not found"), { statusCode: 404 });
    }
    if (current !== "applied") {
      throw Object.assign(new Error(`Dialer hold is ${current}, cannot mark applied`), { statusCode: 409 });
    }
    // Already applied — treat as success (idempotent).
  }

  await writeSensitiveActionLog({
    actor_user_id: appliedBy,
    action_type: "TRAINING_DIALER_HOLD_APPLIED",
    module_key: "QUALITY_LEARNING",
    entity_type: "training_dialer_hold",
    entity_id: holdId,
  });
}

/** Clears a hold once training is completed (or the assignment is otherwise resolved). */
export async function liftDialerHold(
  holdId: string,
  liftedBy: string,
  notes?: string
): Promise<void> {
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE training_dialer_hold
        SET status = 'lifted', lifted_by = ?, lifted_at = NOW(),
            notes = COALESCE(?, notes), updated_at = NOW()
      WHERE id = ? AND status IN ('requested', 'applied')`,
    [liftedBy, notes ?? null, holdId]
  );
  if (result.affectedRows === 0) {
    throw Object.assign(new Error("Dialer hold not found or already resolved"), { statusCode: 409 });
  }

  await writeSensitiveActionLog({
    actor_user_id: liftedBy,
    action_type: "TRAINING_DIALER_HOLD_LIFTED",
    module_key: "QUALITY_LEARNING",
    entity_type: "training_dialer_hold",
    entity_id: holdId,
    change_summary: notes ? { notes } : undefined,
  });
}

/** Active (requested or applied) holds — the "who is currently supposed to be paused" view for WFM/Ops. */
export async function listActiveDialerHolds(): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT h.*, e.employee_code, e.full_name AS employee_name,
            ta.skill_category_id, sc.category_name
       FROM training_dialer_hold h
       JOIN employees e ON e.id = h.employee_id
       JOIN training_assignment ta ON ta.id = h.training_assignment_id
       JOIN skill_category sc ON sc.id = ta.skill_category_id
      WHERE h.status IN ('requested', 'applied')
      ORDER BY h.requested_at ASC`
  );
  return rows as RowDataPacket[];
}
