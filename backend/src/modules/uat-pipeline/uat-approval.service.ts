/**
 * Approvals and segregation of duties.
 *
 * THE RULES THIS ENFORCES, AND WHY EACH IS HERE RATHER THAN IN A CONSTRAINT
 *   - submitter != approver          nobody signs off their own request
 *   - rule editor != approver        whoever last edited the checklist or the capability
 *                                    registry cannot approve an item evaluated under it
 *   - one decision per gate          UNIQUE(feedback_id, approval_type, required_role) in
 *                                    the schema; this layer returns a clean 409 rather than
 *                                    surfacing a duplicate-key error
 *   - delegation expires             a backup approver is valid ONLY inside its window. An
 *                                    expired delegation BLOCKS. Treating an expired window
 *                                    as "close enough" is how delegation becomes the hole
 *                                    every other control is routed around.
 *
 * The first two cannot be expressed as database constraints — they compare a row against
 * facts held elsewhere — so they live here, and the tests assert them directly.
 */
import type { PoolConnection } from "mysql2/promise";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { recordEvent } from "./uat-state-machine.js";
import type { ApprovalDecision, ApprovalType } from "./uat-pipeline.types.js";

export class ApprovalError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 409
  ) {
    super(message);
    this.name = "ApprovalError";
  }
}

interface ApprovalRowDb extends RowDataPacket {
  id: string;
  feedback_id: string;
  approval_type: ApprovalType;
  capability_key: string | null;
  required_role: string;
  approver_user_id: string | null;
  decision: ApprovalDecision;
  reason: string | null;
  requested_at: Date;
  decided_at: Date | null;
}

interface FeedbackActorRow extends RowDataPacket {
  submitted_by_user_id: string | null;
  submitted_by_employee_id: string;
}

interface DelegationRow extends RowDataPacket {
  id: string;
  backup_approver_id: string;
  valid_from: Date;
  valid_until: Date;
}

/**
 * Open a gate. Idempotent on (feedback, type, role) so a retried request does not create a
 * second pending row that would then need two decisions to satisfy one gate.
 */
export async function requestApproval(
  feedbackId: string,
  approvalType: ApprovalType,
  requiredRole: string,
  capabilityKey: string | null = null,
  conn?: PoolConnection
): Promise<void> {
  const exec = conn ?? db;
  await exec.execute(
    `INSERT INTO uat_approval (feedback_id, approval_type, capability_key, required_role)
     VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE capability_key = VALUES(capability_key)`,
    [feedbackId, approvalType, capabilityKey, requiredRole]
  );
}

/** Open every gate a scan's matched capabilities demand, in one call. */
export async function requestCapabilityApprovals(
  feedbackId: string,
  roles: string[],
  conn?: PoolConnection
): Promise<void> {
  for (const role of roles) {
    await requestApproval(feedbackId, "capability", role, null, conn);
  }
}

/**
 * A delegation that is valid RIGHT NOW for this role. Returns null when none applies —
 * including when one exists but has expired, which is the case that must block rather than
 * quietly pass.
 */
export async function activeDelegationFor(
  requiredRole: string,
  approverUserId: string,
  capabilityKey: string | null,
  at: Date = new Date()
): Promise<{ id: string } | null> {
  const [rows] = await db.execute<DelegationRow[]>(
    `SELECT id, backup_approver_id, valid_from, valid_until
       FROM uat_approver_delegation
      WHERE required_role = ?
        AND backup_approver_id = ?
        AND (capability_key = ? OR ? IS NULL)
        AND revoked_at IS NULL
        AND valid_from <= ? AND valid_until > ?
      ORDER BY valid_from DESC
      LIMIT 1`,
    [requiredRole, approverUserId, capabilityKey, capabilityKey, at, at]
  );
  return rows.length ? { id: rows[0].id } : null;
}

export interface DecideInput {
  feedbackId: string;
  approvalType: ApprovalType;
  requiredRole: string;
  approverUserId: string;
  decision: Exclude<ApprovalDecision, "pending">;
  reason?: string | null;
  /** Roles the approver actually holds, resolved by the caller from the role system. */
  approverRoles: string[];
  /** Users who have edited the control plane or checklist rules — see the SoD rule above. */
  ruleEditorUserIds?: string[];
}

/**
 * Record a decision, enforcing every segregation-of-duties rule.
 *
 * Throws ApprovalError (409) rather than returning a falsy result, so a caller that forgets
 * to check cannot accidentally treat a refused approval as a granted one.
 */
export async function decideApproval(input: DecideInput): Promise<void> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [fbRows] = await conn.execute<FeedbackActorRow[]>(
      `SELECT submitted_by_user_id, submitted_by_employee_id
         FROM uat_feedback WHERE id = ? FOR UPDATE`,
      [input.feedbackId]
    );
    if (fbRows.length === 0) throw new ApprovalError("UAT feedback not found", 404);

    // Rule 1: submitter != approver.
    if (fbRows[0].submitted_by_user_id && fbRows[0].submitted_by_user_id === input.approverUserId) {
      throw new ApprovalError(
        "You cannot approve feedback you submitted yourself. A second person must sign this off."
      );
    }

    // Rule 2: rule editor != approver.
    if ((input.ruleEditorUserIds ?? []).includes(input.approverUserId)) {
      throw new ApprovalError(
        "You last edited the rules this item was evaluated under, so you cannot also approve it."
      );
    }

    const [rows] = await conn.execute<ApprovalRowDb[]>(
      `SELECT * FROM uat_approval
        WHERE feedback_id = ? AND approval_type = ? AND required_role = ?
        FOR UPDATE`,
      [input.feedbackId, input.approvalType, input.requiredRole]
    );
    if (rows.length === 0) {
      throw new ApprovalError(
        `No ${input.approvalType} approval is pending for role ${input.requiredRole}`,
        404
      );
    }
    const row = rows[0];

    // Idempotent: the same decision by the same approver is a no-op, not an error. A
    // double-click must not read as tampering.
    if (row.decision !== "pending") {
      if (row.decision === input.decision && row.approver_user_id === input.approverUserId) {
        await conn.commit();
        return;
      }
      throw new ApprovalError(
        `This gate was already ${row.decision}${row.decided_at ? ` on ${row.decided_at.toISOString()}` : ""}.`
      );
    }

    // Rule 3: the approver holds the role, or a currently-valid delegation for it.
    let delegationId: string | null = null;
    if (!input.approverRoles.includes(input.requiredRole)) {
      const deleg = await activeDelegationFor(
        input.requiredRole,
        input.approverUserId,
        row.capability_key
      );
      if (!deleg) {
        throw new ApprovalError(
          `This gate requires the ${input.requiredRole} role. You do not hold it, and no ` +
            `delegation to you is currently valid. An expired delegation does not carry over.`,
          403
        );
      }
      delegationId = deleg.id;
    }

    await conn.execute(
      `UPDATE uat_approval
          SET decision = ?, approver_user_id = ?, delegation_id = ?, reason = ?, decided_at = NOW()
        WHERE id = ?`,
      [input.decision, input.approverUserId, delegationId, input.reason ?? null, row.id]
    );

    await recordEvent(
      input.feedbackId,
      "approval",
      {
        actorUserId: input.approverUserId,
        actorKind: "user",
        message: `${input.approvalType}/${input.requiredRole} ${input.decision}`,
        detail: {
          approvalType: input.approvalType,
          requiredRole: input.requiredRole,
          decision: input.decision,
          viaDelegation: Boolean(delegationId),
        },
      },
      conn
    );

    await conn.commit();
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* surface the original error */
    }
    throw err;
  } finally {
    conn.release();
  }
}

export interface GateStatus {
  satisfied: boolean;
  pending: Array<{ approvalType: ApprovalType; requiredRole: string }>;
  rejected: Array<{ approvalType: ApprovalType; requiredRole: string; reason: string | null }>;
}

/**
 * Are all gates on this item satisfied?
 *
 * An item with NO approval rows is NOT satisfied. "Nobody asked for an approval" and
 * "everyone approved" must never be the same answer — that is the classic fail-open, and
 * here it would mean an unreviewed change reaching a build.
 */
export async function gateStatus(feedbackId: string): Promise<GateStatus> {
  const [rows] = await db.execute<ApprovalRowDb[]>(
    `SELECT approval_type, required_role, decision, reason
       FROM uat_approval WHERE feedback_id = ?`,
    [feedbackId]
  );
  const pending = rows
    .filter((r) => r.decision === "pending")
    .map((r) => ({ approvalType: r.approval_type, requiredRole: r.required_role }));
  const rejected = rows
    .filter((r) => r.decision === "rejected")
    .map((r) => ({ approvalType: r.approval_type, requiredRole: r.required_role, reason: r.reason }));

  return {
    satisfied: rows.length > 0 && pending.length === 0 && rejected.length === 0,
    pending,
    rejected,
  };
}

export async function listApprovals(feedbackId: string): Promise<ApprovalRowDb[]> {
  const [rows] = await db.execute<ApprovalRowDb[]>(
    `SELECT * FROM uat_approval WHERE feedback_id = ? ORDER BY requested_at`,
    [feedbackId]
  );
  return rows;
}

export async function createDelegation(input: {
  capabilityKey: string | null;
  requiredRole: string;
  primaryApproverId: string;
  backupApproverId: string;
  validFrom: Date;
  validUntil: Date;
  delegatedBy: string;
  reason?: string | null;
}): Promise<string> {
  if (input.validUntil <= input.validFrom) {
    throw new ApprovalError("A delegation must end after it begins.", 400);
  }
  if (input.backupApproverId === input.primaryApproverId) {
    throw new ApprovalError("A delegation must name a different person as backup.", 400);
  }
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO uat_approver_delegation
       (capability_key, required_role, primary_approver_id, backup_approver_id,
        valid_from, valid_until, delegated_by, reason)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      input.capabilityKey ?? "",
      input.requiredRole,
      input.primaryApproverId,
      input.backupApproverId,
      input.validFrom,
      input.validUntil,
      input.delegatedBy,
      input.reason ?? null,
    ]
  );
  return String(res.insertId ?? "");
}
