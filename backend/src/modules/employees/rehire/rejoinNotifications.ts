import type { RowDataPacket } from "mysql2";
import { db as pool } from "../../../db/mysql.js";
import { notificationGateway } from "../../communication/notification.gateway.js";
import type { RecipientSpec } from "../../../shared/recipient-resolver.types.js";
import type { SqlExecutor } from "./rehireFacts.js";
import type { FollowUpResult } from "./rejoinFollowUps.js";

export interface NotifyDeps {
  db: SqlExecutor;
  gateway: { notify: (input: any) => Promise<{ outcome: string }> };
}
const realDeps: NotifyDeps = { db: pool as unknown as SqlExecutor, gateway: notificationGateway };

/**
 * Every function here is best-effort and NEVER throws: a notification problem must not break a raise, an
 * approval or an ATS conversion. They return true when the gateway handled it (sent, or shadow-mode) and
 * false otherwise (disabled, duplicate, undeliverable, error).
 *
 * Leavers cannot be addressed: the `employee` selector only resolves active employees. All recipients are
 * the branch head, HR, branch payroll, or the requester (an active HR user / manager).
 */

const HR_ALL = { kind: "role_scope", roleKeys: ["hr"], scope: { type: "all" }, limit: 10 } as const;

interface RequestContext {
  requestId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  branchId: string | null;
  processId: string | null;
  branchName: string;
  proposedJoiningDate: string;
  gapDays: number;
  reason: string;
  raisedByRole: string;
  requesterUserId: string;
  requesterName: string;
  eligibilityStatus: string;
  reviewReasons: string;
  remarks: string;
  daysWaiting: number;
}

const CONTEXT_SQL = `
  SELECT r.id, r.employee_id, DATE_FORMAT(r.proposed_joining_date, '%Y-%m-%d') AS proposed_joining_date,
         r.gap_days, r.status, r.reinstatement_reason, r.raised_by_role, r.eligibility_status,
         r.eligibility_snapshot, r.initiated_by, r.branch_head_remarks,
         DATEDIFF(NOW(), r.created_at) AS created_days,
         e.employee_code, COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', e.last_name)) AS employee_name,
         e.branch_id, e.process_id, b.branch_name,
         COALESCE(NULLIF(ru.full_name, ''), CONCAT(ru.first_name, ' ', ru.last_name)) AS requester_name
    FROM employee_reactivation_requests r
    JOIN employees e ON e.id = r.employee_id
    LEFT JOIN branch_master b ON b.id = e.branch_id
    LEFT JOIN employees ru ON ru.user_id = r.initiated_by
   WHERE r.id = ?`;

async function loadContext(db: SqlExecutor, requestId: string): Promise<RequestContext | null> {
  const [rows] = await db.execute<RowDataPacket[]>(CONTEXT_SQL, [requestId]);
  const r = rows[0];
  if (!r) return null;
  // mysql2 returns a JSON column as an object; tolerate a string too.
  let snapshot: any = r.eligibility_snapshot;
  if (typeof snapshot === "string") {
    try { snapshot = JSON.parse(snapshot); } catch { snapshot = null; }
  }
  const reasons: string[] = Array.isArray(snapshot?.reasons) ? snapshot.reasons.map((x: any) => String(x.message)) : [];
  return {
    requestId: String(r.id),
    employeeId: String(r.employee_id),
    employeeCode: String(r.employee_code ?? ""),
    employeeName: String(r.employee_name ?? "").trim(),
    branchId: r.branch_id ?? null,
    processId: r.process_id ?? null,
    branchName: String(r.branch_name ?? ""),
    proposedJoiningDate: String(r.proposed_joining_date),
    gapDays: Number(r.gap_days ?? 0),
    reason: String(r.reinstatement_reason ?? ""),
    raisedByRole: String(r.raised_by_role ?? ""),
    requesterUserId: String(r.initiated_by),
    requesterName: String(r.requester_name ?? "").trim() || "HR",
    eligibilityStatus: String(r.eligibility_status ?? ""),
    reviewReasons: reasons.join(" "),
    remarks: String(r.branch_head_remarks ?? ""),
    daysWaiting: Number(r.created_days ?? 0),
  };
}

const handled = (outcome: string) => outcome === "sent" || outcome === "shadow";

async function send(
  label: string,
  requestId: string,
  d: NotifyDeps,
  build: (c: RequestContext) => { eventCode: string; dedupeKey: string; data: Record<string, unknown>; specOverride?: RecipientSpec },
): Promise<boolean> {
  try {
    const c = await loadContext(d.db, requestId);
    if (!c) return false;
    const n = build(c);
    const res = await d.gateway.notify({
      eventCode: n.eventCode,
      dedupeKey: n.dedupeKey,
      context: { employeeId: c.employeeId, branchId: c.branchId, processId: c.processId },
      entityType: "employee_reactivation_request",
      entityId: c.requestId,
      correlationId: `rejoin:${c.requestId}`,
      data: {
        request_id: c.requestId,
        // Relative path: notification.links.ts makes it absolute. Lands on this request's review page.
        action_url: `/employees/reactivation/${c.requestId}/review`,
        employee_name: c.employeeName,
        employee_code: c.employeeCode,
        branch_name: c.branchName,
        proposed_joining_date: c.proposedJoiningDate,
        ...n.data,
      },
      ...(n.specOverride ? { specOverride: n.specOverride } : {}),
    });
    return handled(res.outcome);
  } catch (err) {
    console.error(`[rejoin-notify] ${label} ${requestId}:`, (err as Error).message);
    return false;
  }
}

export function notifyRejoinRequested(requestId: string, d: NotifyDeps = realDeps): Promise<boolean> {
  return send("requested", requestId, d, (c) => ({
    eventCode: "rejoin_requested",
    dedupeKey: `rejoin_request:${c.requestId}:requested`,
    data: {
      requester_name: c.requesterName, requester_role: c.raisedByRole, gap_days: c.gapDays,
      eligibility_status: c.eligibilityStatus, review_reasons: c.reviewReasons, reason: c.reason,
    },
  }));
}

export function notifyRejoinDecided(requestId: string, decision: "approved" | "rejected", d: NotifyDeps = realDeps): Promise<boolean> {
  return send("decided", requestId, d, (c) => ({
    eventCode: "rejoin_decided",
    dedupeKey: `rejoin_request:${c.requestId}:decided:${decision}`,
    data: { decision, remarks: c.remarks },
    // The requester is dynamic, so the producer sets the recipients: requester to, HR and branch payroll cc.
    specOverride: {
      to: [{ kind: "user", userId: c.requesterUserId }],
      cc: [{ ...HR_ALL, roleKeys: [...HR_ALL.roleKeys] }, { kind: "payroll_hr", branchId: c.branchId ?? undefined }],
    },
  }));
}

export function notifyRejoinReminder(requestId: string, reminderNo: number, d: NotifyDeps = realDeps): Promise<boolean> {
  return send("reminder", requestId, d, (c) => ({
    eventCode: "rejoin_pending_reminder",
    dedupeKey: `rejoin_request:${c.requestId}:reminder:${reminderNo}`,
    data: { reminder_no: reminderNo, days_waiting: c.daysWaiting },
  }));
}

export function notifyRejoinEscalation(requestId: string, d: NotifyDeps = realDeps): Promise<boolean> {
  return send("escalation", requestId, d, (c) => ({
    eventCode: "rejoin_pending_escalation",
    dedupeKey: `rejoin_request:${c.requestId}:escalated`,
    data: { days_waiting: c.daysWaiting, requester_name: c.requesterName },
  }));
}

export async function notifyFollowUpAttention(requestId: string, steps: FollowUpResult[], d: NotifyDeps = realDeps): Promise<boolean> {
  const failed = steps.filter((s) => !s.ok);
  if (failed.length === 0) return false;
  return send("followup", requestId, d, (c) => ({
    eventCode: "rejoin_followup_attention",
    dedupeKey: `rejoin_request:${c.requestId}:followup_attention`,
    data: { failed_count: failed.length, failed_steps: failed.map((s) => `${s.step}: ${s.detail ?? "failed"}`).join("; ") },
  }));
}

export interface BlockedAtJoining {
  candidateId: string;
  leaver: { employeeId: string; employeeCode: string; fullName: string; employmentStatus: string };
  message: string;
}

export async function notifyRejoinBlockedAtJoining(p: BlockedAtJoining, d: NotifyDeps = realDeps): Promise<boolean> {
  try {
    const [rows] = await d.db.execute<RowDataPacket[]>(
      `SELECT COALESCE(NULLIF(TRIM(full_name), ''), candidate_code) AS candidate_name,
              NULL AS branch_id
         FROM ats_candidate WHERE id = ?`,
      [p.candidateId],
    );
    const res = await d.gateway.notify({
      eventCode: "rejoin_blocked_at_joining",
      dedupeKey: `ats_candidate:${p.candidateId}:rejoin_blocked`,
      context: { employeeId: p.leaver.employeeId },
      entityType: "ats_candidate",
      entityId: p.candidateId,
      correlationId: `ats-rejoin:${p.candidateId}`,
      data: {
        candidate_name: String(rows[0]?.candidate_name ?? "A candidate"),
        employee_name: p.leaver.fullName,
        employee_code: p.leaver.employeeCode,
        employment_status: p.leaver.employmentStatus,
        outcome_message: p.message,
      },
    });
    return handled(res.outcome);
  } catch (err) {
    console.error(`[rejoin-notify] blocked-at-joining ${p.candidateId}:`, (err as Error).message);
    return false;
  }
}
