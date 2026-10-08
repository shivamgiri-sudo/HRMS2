import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { RequestKind } from "./roster-requests.types.js";
import { parseDbTimestamp } from "./roster-requests.sla.js";
import { userIdOfEmployee, wfmRecipientUserIds } from "../wfm/team-roster-audit.js";

type Exec = { execute: (sql: string, params?: unknown[]) => Promise<any> };

export const ROSTER_REQUEST_INBOX_TYPE = "ROSTER_REQUEST_DECIDED";
export const ROSTER_REQUEST_INBOX_ENTITY = "roster_request";

export interface RosterRequestNotice {
  employeeIds: Array<string | null | undefined>;
  kind: RequestKind;
  sourceId: string;
  title: string;
  description: string;
  actionUrl?: string;
}

/**
 * Tells the employees affected by a roster-request decision. Non-fatal by design: the decision
 * is already committed, and a failed inbox write must not turn a successful approval into a 500.
 */
export async function notifyRosterRequest(notice: RosterRequestNotice, exec: Exec = db): Promise<void> {
  try {
    const employeeIds = [...new Set(notice.employeeIds.filter((e): e is string => !!e))];
    for (const employeeId of employeeIds) {
      const [rows] = await exec.execute("SELECT user_id FROM employees WHERE id = ? LIMIT 1", [employeeId]);
      const userId = (rows as RowDataPacket[])[0]?.user_id;
      if (!userId) continue;
      // work_inbox_item.entity_id is CHAR(36): keep the raw source id there and put the kind in
      // entity_type (VARCHAR(64)) so a "<kind>:<uuid>" composite never overflows.
      await exec.execute(
        `INSERT INTO work_inbox_item (id, user_id, type, title, description, entity_type, entity_id, action_url, priority)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, 'normal')`,
        [
          userId,
          ROSTER_REQUEST_INBOX_TYPE,
          notice.title.slice(0, 255),
          notice.description.slice(0, 1000),
          `${ROSTER_REQUEST_INBOX_ENTITY}:${notice.kind}`,
          notice.sourceId.slice(0, 36),
          notice.actionUrl ?? "/my-roster",
        ],
      );
    }
  } catch (err) {
    console.error("[roster-requests] notification failed (decision already applied):", (err as Error)?.message);
  }
}

/**
 * Notifies the employee of a week-off assignment about a manager decision. The lookup and the
 * notify both sit inside the try/catch: the decision is already committed, so nothing here may
 * turn a success response into a 500.
 */
export async function notifyWeekoffDecision(
  dbConn: Exec,
  assignmentId: string,
  title: string,
  describe: (date: string) => string,
): Promise<void> {
  try {
    const [rows] = await dbConn.execute(
      "SELECT employee_id, DATE_FORMAT(roster_date, '%Y-%m-%d') AS roster_date FROM wfm_roster_assignment WHERE id = ? LIMIT 1",
      [assignmentId],
    );
    const row = (rows as RowDataPacket[])[0];
    if (!row) return;
    await notifyRosterRequest(
      {
        employeeIds: [row.employee_id],
        kind: "weekoff_rejection",
        sourceId: String(assignmentId),
        title,
        description: describe(String(row.roster_date)),
      },
      dbConn,
    );
  } catch (err) {
    console.error("[roster-requests] week-off notification failed (decision already applied):", (err as Error)?.message);
  }
}

// ── Approver notifications (raise / auto-approve) ────────────────────────────────────────────

/** Approver work item for a request awaiting a decision. decide closes these by entity_type + entity_id. */
export const ROSTER_REQUEST_PENDING_TYPE = "ROSTER_REQUEST_PENDING";
export const ROSTER_REQUEST_AUTO_APPROVED_TYPE = "ROSTER_REQUEST_AUTO_APPROVED";
export const pendingEntityType = (kind: RequestKind) => `roster_request_pending:${kind}`;
export const autoEntityType = (kind: RequestKind) => `roster_request_auto:${kind}`;
export const hubActionUrl = (kind: RequestKind, id: string) =>
  `/wfm/roster-requests?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`;

export interface RaisedRequest {
  kind: RequestKind;
  sourceId: string;
  employeeId: string;
  date: string;
  processId?: string | null;
  branchId?: string | null;
  summary: string;
}

/** Same 24h rule as computeSla's `urgent` state. */
export function pendingPriority(shiftDate: string, now: Date = new Date()): "high" | "normal" {
  // Shift days are IST: parse as IST midnight (same as computeSla), not UTC midnight.
  const shift = parseDbTimestamp(String(shiftDate).slice(0, 10));
  if (Number.isNaN(shift)) return "normal";
  return (shift - now.getTime()) / 3_600_000 <= 24 ? "high" : "normal";
}

/**
 * Users who may decide this request: WFM roles covering the employee's branch / process (plus
 * org-wide ho_wfm, via wfmRecipientUserIds) and the employee's reporting manager. The employee's
 * own user is never an approver of their own request.
 */
export async function approverUserIdsForRequest(
  input: { employeeId: string; processId?: string | null; branchId?: string | null },
  exec: Exec = db,
): Promise<string[]> {
  const [rows] = await exec.execute(
    "SELECT user_id, branch_id, process_id, reporting_manager_id FROM employees WHERE id = ? LIMIT 1",
    [input.employeeId],
  );
  const emp = (rows as RowDataPacket[])[0] ?? {};
  const branchId = input.branchId ?? emp.branch_id ?? null;
  const processId = input.processId ?? emp.process_id ?? null;
  const [wfm, manager] = await Promise.all([
    wfmRecipientUserIds(branchId ? [String(branchId)] : [], processId ? [String(processId)] : [], exec),
    userIdOfEmployee(emp.reporting_manager_id ? String(emp.reporting_manager_id) : null, exec),
  ]);
  const self = emp.user_id ? String(emp.user_id) : null;
  return [...new Set([...wfm, ...(manager ? [manager] : [])])].filter((u) => u && u !== self);
}

async function insertInboxItems(
  userIds: string[],
  item: { type: string; title: string; description: string; entityType: string; entityId: string; actionUrl: string; priority: "high" | "normal" },
  exec: Exec,
): Promise<void> {
  for (const userId of userIds) {
    await exec.execute(
      `INSERT INTO work_inbox_item (id, user_id, type, title, description, entity_type, entity_id, action_url, priority)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        item.type,
        item.title.slice(0, 255),
        item.description.slice(0, 1000),
        item.entityType.slice(0, 64),
        item.entityId.slice(0, 36),
        item.actionUrl,
        item.priority,
      ],
    );
  }
}

const KIND_LABEL: Record<RequestKind, string> = {
  swap: "Shift swap",
  weekoff_rejection: "Week-off rejection",
  dispute: "Roster dispute",
  conflict: "Roster conflict",
};

/**
 * Tells the approvers in scope that a request is waiting for them. Never throws: the request is
 * already committed, and a failed inbox write must not fail the employee's submission.
 */
export async function notifyApproversOfRequest(req: RaisedRequest, exec: Exec = db, now: Date = new Date()): Promise<void> {
  try {
    const userIds = await approverUserIdsForRequest(req, exec);
    if (!userIds.length) return;
    await insertInboxItems(
      userIds,
      {
        type: ROSTER_REQUEST_PENDING_TYPE,
        title: `${KIND_LABEL[req.kind]} awaiting decision`,
        description: `${req.summary} (${String(req.date).slice(0, 10)})`,
        entityType: pendingEntityType(req.kind),
        entityId: req.sourceId,
        actionUrl: hubActionUrl(req.kind, req.sourceId),
        priority: pendingPriority(req.date, now),
      },
      exec,
    );
  } catch (err) {
    console.error("[roster-requests] approver notification failed (request already recorded):", (err as Error)?.message);
  }
}

/** FYI to the approvers that a rule approved the request on their behalf. Never throws. */
export async function notifyApproversAutoApproved(req: RaisedRequest, exec: Exec = db): Promise<void> {
  try {
    const userIds = await approverUserIdsForRequest(req, exec);
    if (!userIds.length) return;
    await insertInboxItems(
      userIds,
      {
        type: ROSTER_REQUEST_AUTO_APPROVED_TYPE,
        title: `${KIND_LABEL[req.kind]} auto-approved`,
        description: `${req.summary} (${String(req.date).slice(0, 10)}) was approved automatically by the process auto-approve rule.`,
        entityType: autoEntityType(req.kind),
        entityId: req.sourceId,
        actionUrl: hubActionUrl(req.kind, req.sourceId),
        priority: "normal",
      },
      exec,
    );
  } catch (err) {
    console.error("[roster-requests] auto-approve FYI failed (decision already applied):", (err as Error)?.message);
  }
}
