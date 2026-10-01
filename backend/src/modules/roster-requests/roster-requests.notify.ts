import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { RequestKind } from "./roster-requests.types.js";

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
