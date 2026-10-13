/**
 * Payroll Head final approval of a completed NOC.
 *
 * A NOC whose every clearance level has responded is not yet release-ready for F&F settlement.
 * It goes straight to the Payroll Head, whose single explicit approval unlocks F&F creation,
 * approval and payment (exit/ff-settlement-gate.service.ts).
 *
 * WHAT THIS IS NOT
 *
 * It is not the override. overrideNocRelease() releases money WITHOUT a completed clearance and
 * is stored in override_*. This approves a case the branch DID clear, and is stored in
 * payroll_head_approved_*. An overridden case never needs it (the Payroll Head already acted).
 *
 * SWITCH
 *
 * payroll_config_flags.noc_ph_final_approval_from holds an ISO date. Absent => the gate is inert,
 * exactly today's rules. Present => a case COMPLETED on or after that date needs this approval;
 * cases completed earlier are grandfathered, so switching it on never strands the backlog of
 * already-cleared leavers behind a queue of approvals nobody has seen yet. The date is chosen by
 * the owner, not defaulted, because it decides whose money waits.
 *
 * No automatic path exists to this approval and none must be added: it is a hard approval.
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { __writeNocEvent } from "./noc-case.service.js";
import { inboxService } from "../inbox/inbox.service.js";
import { resolveRoleHolderUserIds } from "../../shared/recipient-resolver.js";
import { notifyFfUnlocked } from "../exit/ff-notify.js";

export const NOC_PH_FINAL_FROM_KEY = "noc_ph_final_approval_from";

function refuse(statusCode: number, code: string, message: string) {
  return Object.assign(new Error(message), { statusCode, code });
}

/** ISO date from which the approval is required, or null when the gate is not switched on. */
export async function nocFinalApprovalFrom(): Promise<string | null> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT config_value FROM payroll_config_flags
        WHERE branch_id IS NULL AND process_id IS NULL AND config_key = ? LIMIT 1`,
      [NOC_PH_FINAL_FROM_KEY],
    );
    const v = String(rows[0]?.config_value ?? "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  } catch (err) {
    // Inert on a read failure: this gate withholds settlement, and a config hiccup must not
    // freeze every leaver's F&F. The queue below still shows what is waiting.
    console.error("[noc-final] could not read the gate date; treating as not switched on:", (err as Error).message);
    return null;
  }
}

/** Completed cases still waiting for the Payroll Head. */
export function awaitingFinalApprovalSql(alias = "nc"): string {
  return `(${alias}.status = 'completed'
           AND ${alias}.override_at IS NULL
           AND ${alias}.payroll_head_approved_at IS NULL
           AND DATE(${alias}.completed_at) >= ?)`;
}

export async function listAwaitingFinalApproval(): Promise<RowDataPacket[]> {
  const from = await nocFinalApprovalFrom();
  if (!from) return [];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT nc.id AS case_id, nc.employee_id, nc.employee_code, nc.employee_name, nc.location,
            nc.last_working_day, nc.completed_at, nc.fnf_option, nc.fnf_option_suggested,
            DATEDIFF(CURDATE(), DATE(nc.completed_at)) AS days_waiting
       FROM noc_case nc
      WHERE ${awaitingFinalApprovalSql("nc")}
      ORDER BY nc.completed_at ASC
      LIMIT 500`,
    [from],
  );
  return rows;
}

export async function approveNocFinal(params: {
  caseId: string;
  actorUserId: string;
  actorRole: string | null;
  actorName: string | null;
  note?: string | null;
}): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_id, status, override_at, payroll_head_approved_at, employee_name, branch_id
       FROM noc_case WHERE id = ? LIMIT 1`,
    [params.caseId],
  );
  const c = rows[0];
  if (!c) throw refuse(404, "NOC_CASE_NOT_FOUND", "NOC case not found");
  if (c.override_at) {
    throw refuse(409, "NOC_ALREADY_RELEASED", "This NOC was released by a Payroll Head override; no further approval is needed.");
  }
  if (String(c.status) !== "completed") {
    throw refuse(409, "NOC_NOT_COMPLETED", `This NOC is ${String(c.status).replace(/_/g, " ")}; every clearance level must respond before final approval.`);
  }
  if (c.payroll_head_approved_at) {
    throw refuse(409, "NOC_ALREADY_APPROVED", "This NOC has already been given final approval.");
  }

  const [res] = await db.execute<RowDataPacket[] & { affectedRows?: number }>(
    `UPDATE noc_case
        SET payroll_head_approved_by = ?, payroll_head_approved_at = NOW(),
            payroll_head_approval_note = ?
      WHERE id = ? AND status = 'completed' AND payroll_head_approved_at IS NULL`,
    [params.actorUserId, params.note?.trim().slice(0, 500) || null, params.caseId],
  );
  if ((res as { affectedRows?: number }).affectedRows !== 1) {
    throw refuse(409, "NOC_ALREADY_APPROVED", "This NOC was approved by someone else — reload to confirm.");
  }

  await __writeNocEvent(null, {
    caseId: params.caseId,
    action: "payroll_head_final_approved",
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    actorName: params.actorName,
    reason: params.note?.trim() || "Final approval for F&F settlement",
  });

  await inboxService
    .resolveItems({ entity_type: "noc_case", entity_id: params.caseId, types: ["noc_final_approval_pending"] })
    .catch(() => undefined);

  void notifyFfUnlocked(
    String(c.employee_id ?? ""),
    String(c.employee_name ?? ""),
    params.caseId,
  );
}

/**
 * Put the completed case in front of the Payroll Head. Called from the completion notifier; the
 * inbox item is the "directly goes for final approval" hand-off, and it is dedupe-safe because
 * createItem is only reached once per completion.
 */
export async function queueForFinalApproval(caseId: string): Promise<void> {
  const from = await nocFinalApprovalFrom();
  if (!from) return;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_name, employee_code, branch_id FROM noc_case WHERE id = ? LIMIT 1`,
    [caseId],
  );
  const c = rows[0];
  if (!c) return;
  for (const userId of await resolveRoleHolderUserIds("payroll_head", null)) {
    await inboxService
      .createItem({
        user_id: userId,
        type: "noc_final_approval_pending",
        title: `NOC final approval — ${c.employee_name ?? c.employee_code ?? ""}`,
        description: "All clearance levels are complete. Approve to unlock F&F settlement.",
        entity_type: "noc_case",
        entity_id: caseId,
        action_url: `/payroll/noc-cases?case=${caseId}`,
        priority: "high",
      })
      .catch(() => undefined);
  }
}
