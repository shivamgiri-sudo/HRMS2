import { db } from "../../db/mysql.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { QualityTargetError } from "./quality-target.service.js";

/**
 * The quality-target lifecycle.
 *
 * 1057 let a draft become active in one call. That stores a policy but does not
 * defend one: a target decides who gets coached, so it has to be simulated
 * before anyone can approve it, approved by someone other than its author, and
 * impossible to edit quietly once approved.
 *
 *   draft ──simulate──> simulation_reviewed ──submit──> pending_approval
 *     ^                                                    │
 *     │                                              approve│reject
 *     └──────── edit (any governed field) ────────┐         │
 *                                                 │         v
 *   inactive <──deactivate── active <──activate── approved   rejected
 *                              │
 *                              └──superseded (by a newer dated row)
 *
 * ON STALENESS — the part worth reading before changing anything here.
 *
 * An approval approves SPECIFIC NUMBERS. If the numbers move afterwards, the
 * approval is void. Rather than trust this layer to notice, `config_fingerprint`
 * is a STORED GENERATED column over the governed fields, so it changes if and
 * only if they do and no caller can set it. Simulating copies it into
 * `simulated_config_fingerprint` *in SQL* (`SET simulated_config_fingerprint =
 * config_fingerprint`), and every later step carries
 * `AND simulated_config_fingerprint = config_fingerprint` in its WHERE clause.
 *
 * So a stale row updates zero rows and is rejected. Nothing recomputes the
 * fingerprint in TypeScript, which means the check cannot drift from the
 * schema — the usual failure mode for a rule written twice.
 */

export type TargetStatus =
  | "draft"
  | "simulation_reviewed"
  | "pending_approval"
  | "approved"
  | "active"
  | "inactive"
  | "superseded"
  | "rejected";

/**
 * Pure, and deliberately the only description of what may follow what. Kept
 * separate from the SQL so the transition rules can be tested without a
 * database, in the same spirit as coaching-trigger.ts.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<TargetStatus, readonly TargetStatus[]>> = {
  draft: ["simulation_reviewed"],
  // An edit at any pre-approval stage lands back in draft; that is the
  // invalidation rule, expressed as a transition rather than a side effect.
  simulation_reviewed: ["pending_approval", "draft"],
  pending_approval: ["approved", "rejected", "draft"],
  approved: ["active", "draft"],
  active: ["inactive", "superseded"],
  // Terminal. A superseded or deactivated policy still explains the coaching
  // raised while it applied, so it is never revived — a revision is a new
  // dated row.
  inactive: [],
  superseded: [],
  rejected: ["draft"],
};

export function canTransition(from: TargetStatus, to: TargetStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransitionAllowed(from: TargetStatus, to: TargetStatus): void {
  if (!canTransition(from, to)) {
    throw new QualityTargetError(
      `A ${from} target cannot become ${to}`
        + (ALLOWED_TRANSITIONS[from]?.length
          ? ` (allowed: ${ALLOWED_TRANSITIONS[from].join(", ")})`
          : " — it is a final state"),
      409,
    );
  }
}

type TargetRow = RowDataPacket & {
  id: string;
  process_id: string;
  metric_code: string;
  status: TargetStatus;
  effective_from: string;
  effective_to: string | null;
  created_by: string | null;
  config_fingerprint: string;
  simulated_config_fingerprint: string | null;
};

async function loadForUpdate(
  conn: { execute: (sql: string, params: unknown[]) => Promise<unknown> },
  targetId: string,
): Promise<TargetRow> {
  // FOR UPDATE, because activation reads the incumbent target and then writes
  // both rows. Without the lock two concurrent activations each see no
  // incumbent and both go active.
  const [rows] = (await conn.execute(
    `SELECT * FROM process_quality_target WHERE id = ? FOR UPDATE`,
    [targetId],
  )) as [TargetRow[], unknown];
  if (!rows.length) throw new QualityTargetError("Target not found", 404);
  return rows[0];
}

async function audit(
  conn: { execute: (sql: string, params: unknown[]) => Promise<unknown> },
  input: {
    targetId: string; processId: string;
    action: "created" | "updated" | "simulated" | "submitted" | "approved"
      | "rejected" | "activated" | "deactivated" | "superseded" | "retired";
    before?: unknown; after?: unknown; reason?: string | null; actorUserId?: string | null;
  },
): Promise<void> {
  await conn.execute(
    `INSERT INTO process_quality_target_audit
       (target_id, process_id, action, before_json, after_json, reason, actor_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.targetId, input.processId, input.action,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
      input.reason ?? null, input.actorUserId ?? null,
    ],
  );
}

async function inTransaction<T>(fn: (conn: never) => Promise<T>): Promise<T> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn as never);
    await conn.commit();
    return result;
  } catch (err) {
    await (conn as { rollback: () => Promise<void> }).rollback().catch(() => {});
    throw err;
  } finally {
    (conn as { release: () => void }).release();
  }
}

/**
 * Record a simulation against the configuration as it stands right now.
 *
 * The fingerprint is copied in SQL rather than passed in, so what is recorded
 * as "simulated" is exactly what is stored, not what the caller believed.
 */
export async function recordSimulationReview(input: {
  targetId: string;
  actorUserId: string;
  summary: unknown;
}): Promise<{ status: TargetStatus }> {
  return inTransaction(async (conn) => {
    const row = await loadForUpdate(conn, input.targetId);
    assertTransitionAllowed(row.status, "simulation_reviewed");

    await (conn as unknown as { execute: (s: string, p: unknown[]) => Promise<unknown> }).execute(
      `UPDATE process_quality_target
          SET status = 'simulation_reviewed',
              simulated_config_fingerprint = config_fingerprint,
              simulated_at = NOW(),
              simulated_by = ?,
              simulation_summary_json = ?
        WHERE id = ?`,
      [input.actorUserId, JSON.stringify(input.summary ?? null), input.targetId],
    );
    await audit(conn, {
      targetId: input.targetId, processId: row.process_id, action: "simulated",
      before: { status: row.status }, after: { status: "simulation_reviewed" },
      actorUserId: input.actorUserId,
    });
    return { status: "simulation_reviewed" as const };
  });
}

/** Send a simulated draft for approval. Refuses if the config moved since. */
export async function submitForApproval(input: {
  targetId: string; actorUserId: string; note?: string | null;
}): Promise<{ status: TargetStatus }> {
  return inTransaction(async (conn) => {
    const row = await loadForUpdate(conn, input.targetId);
    assertTransitionAllowed(row.status, "pending_approval");

    const [res] = (await (conn as unknown as {
      execute: (s: string, p: unknown[]) => Promise<unknown>;
    }).execute(
      `UPDATE process_quality_target
          SET status = 'pending_approval', submitted_by = ?, submitted_at = NOW()
        WHERE id = ?
          AND simulated_config_fingerprint = config_fingerprint`,
      [input.actorUserId, input.targetId],
    )) as [ResultSetHeader, unknown];

    if (res.affectedRows === 0) throw staleSimulation();

    await audit(conn, {
      targetId: input.targetId, processId: row.process_id, action: "submitted",
      before: { status: row.status }, after: { status: "pending_approval" },
      reason: input.note ?? null, actorUserId: input.actorUserId,
    });
    return { status: "pending_approval" as const };
  });
}

function staleSimulation(): QualityTargetError {
  return new QualityTargetError(
    "The configuration changed after it was simulated. Re-run the simulation before continuing — "
      + "an approval applies to the numbers that were simulated, not to whatever they became.",
    409,
  );
}

/**
 * Approve. Separation of duties lives here and in a CHECK constraint: the
 * author cannot approve their own target unless an exception is recorded, with
 * a reason, on the row itself.
 */
export async function approveTarget(input: {
  targetId: string;
  approverUserId: string;
  note?: string | null;
  selfApprovalException?: { reason: string } | null;
}): Promise<{ status: TargetStatus }> {
  return inTransaction(async (conn) => {
    const row = await loadForUpdate(conn, input.targetId);
    assertTransitionAllowed(row.status, "approved");

    const isSelf = row.created_by != null && row.created_by === input.approverUserId;
    const exceptionReason = input.selfApprovalException?.reason?.trim();
    if (isSelf && !exceptionReason) {
      throw new QualityTargetError(
        "You cannot approve a target you created. Ask another approver, or record an explicit "
          + "self-approval exception with a reason.",
        403,
      );
    }

    const [res] = (await (conn as unknown as {
      execute: (s: string, p: unknown[]) => Promise<unknown>;
    }).execute(
      `UPDATE process_quality_target
          SET status = 'approved', approved_by = ?, approved_at = NOW(), approval_note = ?,
              self_approval_exception = ?, self_approval_exception_reason = ?
        WHERE id = ?
          AND simulated_config_fingerprint = config_fingerprint`,
      [
        input.approverUserId, input.note ?? null,
        isSelf ? 1 : 0, isSelf ? exceptionReason : null,
        input.targetId,
      ],
    )) as [ResultSetHeader, unknown];

    if (res.affectedRows === 0) throw staleSimulation();

    await audit(conn, {
      targetId: input.targetId, processId: row.process_id, action: "approved",
      before: { status: row.status },
      after: { status: "approved", approvedBy: input.approverUserId, selfApproval: isSelf },
      reason: isSelf ? `Self-approval exception: ${exceptionReason}` : (input.note ?? null),
      actorUserId: input.approverUserId,
    });
    return { status: "approved" as const };
  });
}

/** Reject. The reason is required — a rejection nobody can argue with is not review. */
export async function rejectTarget(input: {
  targetId: string; actorUserId: string; reason: string;
}): Promise<{ status: TargetStatus }> {
  const reason = input.reason?.trim();
  if (!reason) throw new QualityTargetError("A rejection must say why", 400);

  return inTransaction(async (conn) => {
    const row = await loadForUpdate(conn, input.targetId);
    assertTransitionAllowed(row.status, "rejected");

    await (conn as unknown as { execute: (s: string, p: unknown[]) => Promise<unknown> }).execute(
      `UPDATE process_quality_target
          SET status = 'rejected', rejected_by = ?, rejected_at = NOW(), rejection_reason = ?
        WHERE id = ?`,
      [input.actorUserId, reason, input.targetId],
    );
    await audit(conn, {
      targetId: input.targetId, processId: row.process_id, action: "rejected",
      before: { status: row.status }, after: { status: "rejected" },
      reason, actorUserId: input.actorUserId,
    });
    return { status: "rejected" as const };
  });
}

/**
 * Activate an approved target, closing the incumbent in the same transaction.
 *
 * Both halves together, always: superseding the old without activating the new
 * leaves the process governed by nothing, which is worse than the state we
 * started in.
 */
export async function activateTarget(input: {
  targetId: string; actorUserId: string;
}): Promise<{ status: TargetStatus; supersededId: string | null }> {
  return inTransaction(async (conn) => {
    const exec = conn as unknown as { execute: (s: string, p: unknown[]) => Promise<unknown> };
    const row = await loadForUpdate(conn, input.targetId);
    assertTransitionAllowed(row.status, "active");

    // Any active row whose window overlaps this one. The DB guarantees only
    // that two OPEN-ENDED actives cannot coexist; overlapping closed windows
    // are caught here, under the row lock taken above.
    const [clash] = (await exec.execute(
      `SELECT id, effective_from, effective_to FROM process_quality_target
        WHERE process_id = ? AND metric_code = ? AND status = 'active' AND id <> ?
          AND (effective_to IS NULL OR effective_to >= ?)
          AND (? IS NULL OR effective_from <= ?)
        FOR UPDATE`,
      [
        row.process_id, row.metric_code, row.id,
        row.effective_from, row.effective_to, row.effective_to,
      ],
    )) as [RowDataPacket[], unknown];

    let supersededId: string | null = null;
    if (clash.length) {
      const incumbent = clash[0];
      if (String(incumbent.effective_from) >= String(row.effective_from)) {
        // The incumbent starts on or after the newcomer, so closing it the day
        // before would give it a negative window.
        throw new QualityTargetError(
          "An active target already covers this period starting on or after the new one. "
            + "Choose a later effective date.",
          409,
        );
      }
      supersededId = String(incumbent.id);
      await exec.execute(
        `UPDATE process_quality_target
            SET status = 'superseded', effective_to = DATE_SUB(?, INTERVAL 1 DAY)
          WHERE id = ?`,
        [row.effective_from, supersededId],
      );
      await audit(conn, {
        targetId: supersededId, processId: row.process_id, action: "superseded",
        reason: `Superseded by ${row.id}`, actorUserId: input.actorUserId,
      });
    }

    const [res] = (await exec.execute(
      `UPDATE process_quality_target
          SET status = 'active', activated_by = ?, activated_at = NOW()
        WHERE id = ?
          AND status = 'approved'
          AND simulated_config_fingerprint = config_fingerprint`,
      [input.actorUserId, input.targetId],
    )) as [ResultSetHeader, unknown];

    // Zero rows means another transaction moved it after our SELECT, or the
    // config changed. Either way the supersede above must not stand.
    if (res.affectedRows === 0) throw staleSimulation();

    await audit(conn, {
      targetId: input.targetId, processId: row.process_id, action: "activated",
      before: { status: row.status }, after: { status: "active" },
      actorUserId: input.actorUserId,
    });
    return { status: "active" as const, supersededId };
  });
}

/**
 * Stop a target governing, without erasing what it governed.
 *
 * The row stays, its dates stay, and the coaching sessions raised under it keep
 * pointing at a policy that still explains them.
 */
export async function deactivateTarget(input: {
  targetId: string; actorUserId: string; reason: string;
}): Promise<{ status: TargetStatus }> {
  const reason = input.reason?.trim();
  if (!reason) throw new QualityTargetError("Say why this target is being deactivated", 400);

  return inTransaction(async (conn) => {
    const row = await loadForUpdate(conn, input.targetId);
    assertTransitionAllowed(row.status, "inactive");

    await (conn as unknown as { execute: (s: string, p: unknown[]) => Promise<unknown> }).execute(
      `UPDATE process_quality_target
          SET status = 'inactive', active_status = 0,
              deactivated_by = ?, deactivated_at = NOW(), deactivation_reason = ?
        WHERE id = ?`,
      [input.actorUserId, reason, input.targetId],
    );
    await audit(conn, {
      targetId: input.targetId, processId: row.process_id, action: "deactivated",
      before: { status: row.status }, after: { status: "inactive" },
      reason, actorUserId: input.actorUserId,
    });
    return { status: "inactive" as const };
  });
}

/**
 * Edit a governed field. Always lands in draft, and clears the simulation and
 * approval that referred to the old numbers.
 *
 * This is the visible half of the invalidation rule; the CHECK constraints and
 * the fingerprint are the half that does not depend on anyone calling this.
 */
export async function editTarget(input: {
  targetId: string;
  actorUserId: string;
  changes: Partial<{
    targetScore: number;
    warningThresholdPct: number;
    criticalThresholdPct: number;
    minAuditCount: number;
    evaluationPeriod: "daily" | "weekly" | "monthly";
    effectiveFrom: string;
    effectiveTo: string | null;
  }>;
}): Promise<{ status: TargetStatus }> {
  return inTransaction(async (conn) => {
    const row = await loadForUpdate(conn, input.targetId);
    if (row.status === "active" || row.status === "superseded" || row.status === "inactive") {
      throw new QualityTargetError(
        `A ${row.status} target is a historical record and cannot be edited — clone it instead`,
        409,
      );
    }

    const columns: Record<string, unknown> = {};
    const c = input.changes;
    if (c.targetScore !== undefined) columns.target_score = c.targetScore;
    if (c.warningThresholdPct !== undefined) columns.warning_threshold_pct = c.warningThresholdPct;
    if (c.criticalThresholdPct !== undefined) columns.critical_threshold_pct = c.criticalThresholdPct;
    if (c.minAuditCount !== undefined) columns.min_audit_count = c.minAuditCount;
    if (c.evaluationPeriod !== undefined) columns.evaluation_period = c.evaluationPeriod;
    if (c.effectiveFrom !== undefined) columns.effective_from = c.effectiveFrom;
    if (c.effectiveTo !== undefined) columns.effective_to = c.effectiveTo;

    const keys = Object.keys(columns);
    if (!keys.length) throw new QualityTargetError("Nothing to change", 400);

    const warning = (c.warningThresholdPct ?? Number((row as never)["warning_threshold_pct"]));
    const critical = (c.criticalThresholdPct ?? Number((row as never)["critical_threshold_pct"]));
    if (!(warning > critical)) {
      throw new QualityTargetError("The warning threshold must sit above the critical threshold");
    }

    await (conn as unknown as { execute: (s: string, p: unknown[]) => Promise<unknown> }).execute(
      `UPDATE process_quality_target
          SET ${keys.map((k) => `${k} = ?`).join(", ")},
              status = 'draft',
              simulated_config_fingerprint = NULL, simulated_at = NULL,
              simulated_by = NULL, simulation_summary_json = NULL,
              submitted_by = NULL, submitted_at = NULL,
              approved_by = NULL, approved_at = NULL, approval_note = NULL,
              self_approval_exception = 0, self_approval_exception_reason = NULL
        WHERE id = ?`,
      [...keys.map((k) => columns[k]), input.targetId],
    );
    await audit(conn, {
      targetId: input.targetId, processId: row.process_id, action: "updated",
      before: { status: row.status }, after: { status: "draft", ...input.changes },
      reason: "Edited — simulation and approval cleared", actorUserId: input.actorUserId,
    });
    return { status: "draft" as const };
  });
}
