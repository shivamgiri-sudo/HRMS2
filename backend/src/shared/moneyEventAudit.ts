/**
 * Strict, transaction-scoped audit for IRREVERSIBLE MONEY EVENTS.
 *
 * WHY THIS EXISTS SEPARATELY FROM logSensitiveAction
 *   writeSensitiveActionLog is deliberately non-throwing — "audit failures must never break
 *   the primary operation" — and that is the right default for the ~200 call sites that use
 *   it. Losing the audit row for a page view or a profile edit must not deny anyone their
 *   work, and the failure is reported on stderr as SENSITIVE_ACTION_LOG_WRITE_FAILED.
 *
 *   For an irreversible money event the trade runs the other way. Recording a settlement as
 *   PAID with no audit row produces a payment that cannot be reconciled against a bank
 *   statement and cannot be attributed to a payer — and every downstream control
 *   (FF_PAID_BUT_EMPLOYEE_ACTIVE, payment reconciliation) reads that trail. A money movement
 *   that leaves no record is worse than a money movement that did not happen, because the
 *   second is retryable and the first is not detectable.
 *
 *   markFfPaid previously called `void logSensitiveAction(...)` — doubly suppressed: not
 *   awaited AND internally catching — so the settlement committed and the audit row could be
 *   silently absent with the route still returning success.
 *
 * WHAT THIS DOES
 *   Writes to the same sensitive_action_log table, with the same columns, on the CALLER'S
 *   CONNECTION so it lands inside the caller's transaction — and does NOT catch. A failure
 *   propagates, the caller rolls back, and the money event is simply not recorded. The caller
 *   can retry safely because the state transitions this guards are all expected-state
 *   guarded (`WHERE status = 'approved'`), so a retry either applies once or reports 409.
 *
 *   This is the "transaction-aware strict audit" option rather than a durable outbox: the
 *   audit target is the same database as the state change, so one transaction already gives
 *   atomicity and an outbox would add a moving part (a drainer, a backlog, a second failure
 *   mode) for no extra guarantee. An outbox earns its cost when the audit sink is REMOTE.
 *
 * SCOPE — deliberately narrow. Do not widen this to ordinary actions.
 *   Use it only where the recorded event moves money and cannot be undone by re-running:
 *   F&F marked paid, payroll disbursement, payment-file release. Everything else keeps
 *   logSensitiveAction and its non-throwing contract.
 */
import { randomUUID } from "crypto";
import type { PoolConnection } from "mysql2/promise";
import type { Request } from "express";

/** The money events permitted to use the strict path. Adding one is a deliberate act. */
export type MoneyEventAction =
  | "FULL_FINAL_PAID"
  | "PAYROLL_DISBURSED"
  | "PAYMENT_FILE_RELEASED";

export interface MoneyEventAuditEntry {
  actor_user_id: string;
  action_type: MoneyEventAction;
  module_key: string;
  entity_type: string;
  entity_id: string;
  /** The amount, reference and identifiers a reconciliation would need. */
  change_summary: Record<string, unknown>;
  employee_id?: string | null;
  actor_role?: string | null;
  reason?: string | null;
  req?: Request;
}

function requestIdFrom(entry: MoneyEventAuditEntry): string | null {
  const header = entry.req?.headers["x-request-id"];
  return (Array.isArray(header) ? header[0] : header) ?? null;
}

/**
 * Insert the audit row on `conn`, inside the caller's open transaction.
 *
 * THROWS on failure — that is the entire point. Callers must not wrap this in a catch that
 * swallows, and must not call it with `void`.
 */
export async function recordMoneyEventAudit(
  conn: PoolConnection,
  entry: MoneyEventAuditEntry
): Promise<void> {
  await conn.execute(
    `INSERT INTO sensitive_action_log
       (id, actor_user_id, action_type, module_key, entity_type, entity_id,
        ip_address, user_agent, change_summary, request_id,
        actor_role, reason, old_value_json, new_value_json, employee_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      entry.actor_user_id,
      entry.action_type,
      entry.module_key,
      entry.entity_type,
      entry.entity_id,
      entry.req?.ip ?? null,
      String(entry.req?.headers["user-agent"] ?? "").slice(0, 512) || null,
      JSON.stringify(entry.change_summary),
      requestIdFrom(entry),
      entry.actor_role ?? null,
      entry.reason ?? null,
      null,
      null,
      entry.employee_id ?? null,
    ]
  );
}
