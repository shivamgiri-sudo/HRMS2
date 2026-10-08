/**
 * Change-type governance — checklist family H (CG-01, CG-02, CG-03).
 *
 * THE DISTINCTION THIS ENFORCES
 *   A bug fix, a feature request and a policy change look identical in a feedback form and
 *   are completely different decisions. "Leave balance shows wrong carry-forward" might be a
 *   defect in the accrual code, or it might be someone asking for the carry-forward rule to
 *   change. The first is a fix; the second alters what employees are entitled to. Treating
 *   the second as the first is how an HR policy gets changed by a bug ticket.
 *
 *   So the change type is classified, and the approvals required depend on it — enhancements
 *   need a product owner, policy changes additionally need the owning function, and both are
 *   required BEFORE a prompt is generated rather than before a merge. By merge time the work
 *   exists and the pressure is to ship it.
 *
 * `unclear` IS NOT A THIRD OUTCOME THAT PROCEEDS
 *   CG-01 blocks on `unclear`. A classification nobody could make is not a licence to guess,
 *   and the policy table has a row for it precisely so the gate points at triage rather than
 *   finding no policy and reading that as no requirement — the fail-open shape that this
 *   codebase produces over and over.
 */
import type { PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requestApproval } from "./uat-approval.service.js";
import { recordEvent } from "./uat-state-machine.js";

type UatConnection = PoolConnection | Awaited<ReturnType<typeof db.getConnection>>;

export type ChangeType = "bug" | "enhancement" | "policy_change" | "unclear";

interface PolicyRow extends RowDataPacket {
  change_type: ChangeType;
  required_role: string;
  rationale: string;
}

export interface ChangeTypeRequirement {
  requiredRole: string;
  rationale: string;
}

/**
 * Roles that must sign for a change type.
 *
 * Fails closed on an empty policy table: a change type with no rows would otherwise require
 * nobody, which is the most permissive possible answer arrived at by accident.
 */
export async function requirementsFor(
  changeType: ChangeType,
  conn?: UatConnection
): Promise<ChangeTypeRequirement[]> {
  const runner = conn ?? db;
  const [rows] = await runner.query<PolicyRow[]>(
    `SELECT change_type, required_role, rationale
       FROM uat_change_type_policy
      WHERE change_type = ? AND active_status = 1
      ORDER BY required_role`,
    [changeType]
  );
  if (!rows.length) {
    throw new Error(
      `[uat] no active governance policy for change type "${changeType}"; refusing to treat ` +
        "an empty policy as 'no approval required'."
    );
  }
  return rows.map((r) => ({ requiredRole: r.required_role, rationale: r.rationale }));
}

export interface ChangeTypeGate {
  changeType: ChangeType;
  /** True only when every required role has a DECIDED approval. */
  satisfied: boolean;
  required: ChangeTypeRequirement[];
  pending: string[];
  rejected: string[];
  /** CG-01: an unclassified item cannot proceed at all. */
  blocked: boolean;
  reason: string | null;
}

interface ApprovalStateRow extends RowDataPacket {
  required_role: string;
  decision: "pending" | "approved" | "rejected";
}

/**
 * Where the change-type gate stands.
 *
 * Reads decisions rather than inferring them from status: an item's status says where it is
 * in the lifecycle, not who signed for it, and the two drift the moment anything is retried.
 */
export async function changeTypeGate(
  feedbackId: string,
  changeType: ChangeType | null,
  conn?: UatConnection
): Promise<ChangeTypeGate> {
  if (!changeType || changeType === "unclear") {
    const required = await requirementsFor("unclear", conn);
    return {
      changeType: "unclear",
      satisfied: false,
      required,
      pending: required.map((r) => r.requiredRole),
      rejected: [],
      blocked: true,
      reason:
        "CG-01: the change type could not be established. Triage must classify this as a bug, " +
        "an enhancement or a policy change before anything else happens.",
    };
  }

  const required = await requirementsFor(changeType, conn);
  const runner = conn ?? db;
  const [rows] = await runner.query<ApprovalStateRow[]>(
    `SELECT required_role, decision FROM uat_approval
      WHERE feedback_id = ? AND approval_type = 'change_type'`,
    [feedbackId]
  );
  const byRole = new Map(rows.map((r) => [r.required_role, r.decision]));

  const pending: string[] = [];
  const rejected: string[] = [];
  for (const req of required) {
    const decision = byRole.get(req.requiredRole);
    // A role with NO row is pending, not satisfied. Absence of a decision is not a decision.
    if (decision === "approved") continue;
    if (decision === "rejected") rejected.push(req.requiredRole);
    else pending.push(req.requiredRole);
  }

  return {
    changeType,
    satisfied: pending.length === 0 && rejected.length === 0,
    required,
    pending,
    rejected,
    blocked: rejected.length > 0,
    reason: rejected.length
      ? `Refused by ${rejected.join(", ")}.`
      : pending.length
        ? `Waiting on ${pending.join(", ")}.`
        : null,
  };
}

/**
 * Confirm a change type and open the approvals it demands.
 *
 * A HUMAN confirms it, not the model. The validator proposes a classification; someone in
 * triage accepts or overrides it, and that acceptance is recorded with their id. The
 * distinction matters because the classification decides who has to sign, and letting the
 * model choose that would let the model choose its own reviewers.
 *
 * Re-confirming with a DIFFERENT type withdraws the approvals opened under the old one:
 * a product owner who approved an "enhancement" has not approved a "policy_change", and
 * carrying their signature across would be forging it.
 */
export async function confirmChangeType(input: {
  feedbackId: string;
  changeType: ChangeType;
  actorUserId: string;
}): Promise<ChangeTypeGate> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [current] = await conn.execute<RowDataPacket[]>(
      `SELECT change_type FROM uat_feedback WHERE id = ? FOR UPDATE`,
      [input.feedbackId]
    );
    if (!current.length) throw new Error("UAT feedback not found");
    const previous = current[0].change_type as ChangeType | null;

    if (previous && previous !== input.changeType) {
      const [removed] = await conn.execute(
        `DELETE FROM uat_approval
          WHERE feedback_id = ? AND approval_type = 'change_type'`,
        [input.feedbackId]
      );
      await recordEvent(
        input.feedbackId,
        "change_type_reclassified",
        {
          actorUserId: input.actorUserId,
          actorKind: "user",
          message: `Reclassified from ${previous} to ${input.changeType}; prior change-type approvals withdrawn.`,
          detail: {
            from: previous,
            to: input.changeType,
            withdrawn: (removed as { affectedRows?: number }).affectedRows ?? 0,
          },
        },
        conn
      );
    }

    await conn.execute(
      `UPDATE uat_feedback
          SET change_type = ?, change_type_confirmed_by = ?, change_type_confirmed_at = NOW()
        WHERE id = ?`,
      [input.changeType, input.actorUserId, input.feedbackId]
    );

    const required = await requirementsFor(input.changeType, conn);
    for (const req of required) {
      await requestApproval(input.feedbackId, "change_type", req.requiredRole, null, conn);
    }

    await recordEvent(
      input.feedbackId,
      "change_type_confirmed",
      {
        actorUserId: input.actorUserId,
        actorKind: "user",
        message: `Classified as ${input.changeType}; requires ${required.map((r) => r.requiredRole).join(", ")}.`,
        detail: { changeType: input.changeType, requiredRoles: required.map((r) => r.requiredRole) },
      },
      conn
    );

    await conn.commit();
  } catch (error) {
    try {
      await conn.rollback();
    } catch {
      /* surface the original */
    }
    throw error;
  } finally {
    conn.release();
  }

  return changeTypeGate(input.feedbackId, input.changeType);
}

// ── Kill switches ─────────────────────────────────────────────────────────────

interface ConfigRow extends RowDataPacket {
  config_key: string;
  config_value: string;
}

/**
 * Read a pipeline switch.
 *
 * Both the env var and the DB row are consulted, and EITHER can veto. Two independent
 * mechanisms because they fail in different ways: an env var needs a deploy to change, and
 * the moment you most want to stop the pipeline is the moment you least want to deploy; a DB
 * row is instant but is gone if the row was never seeded. Requiring both to be on means a
 * missing row is a stop, not a start.
 */
export async function switchEnabled(
  key: string,
  envValue: string | undefined,
  conn?: UatConnection
): Promise<{ enabled: boolean; reason: string | null }> {
  const envOn = String(envValue ?? "").toLowerCase() === "true";
  if (!envOn) {
    return { enabled: false, reason: `Disabled by environment (${key} is not "true").` };
  }
  const runner = conn ?? db;
  const [rows] = await runner.query<ConfigRow[]>(
    `SELECT config_key, config_value FROM uat_pipeline_config WHERE config_key = ? LIMIT 1`,
    [key]
  );
  if (!rows.length) {
    return {
      enabled: false,
      reason: `No uat_pipeline_config row for "${key}". A missing switch is off, never on.`,
    };
  }
  const dbOn = String(rows[0].config_value).toLowerCase() === "true";
  return dbOn
    ? { enabled: true, reason: null }
    : { enabled: false, reason: `Switched off by an operator (uat_pipeline_config.${key}).` };
}

export async function readConfig(
  key: string,
  fallback: string,
  conn?: UatConnection
): Promise<string> {
  const runner = conn ?? db;
  const [rows] = await runner.query<ConfigRow[]>(
    `SELECT config_value FROM uat_pipeline_config WHERE config_key = ? LIMIT 1`,
    [key]
  );
  return rows.length ? String(rows[0].config_value) : fallback;
}
