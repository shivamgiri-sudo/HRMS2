import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { RequestKind } from "./roster-requests.types.js";

type Exec = { execute: (sql: string, params?: unknown[]) => Promise<any> };

export interface DecisionLogEntry {
  kind: RequestKind | string;
  sourceId: string;
  action: string;
  actorUserId?: string | null;
  auto?: boolean;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
}

const json = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));

/**
 * Appends one row to the decision audit log. NOT non-fatal: it is part of the transactional
 * decide, so pass the transaction connection and let errors propagate.
 */
export async function logDecision(entry: DecisionLogEntry, exec: Exec = db): Promise<void> {
  await exec.execute(
    `INSERT INTO roster_request_decision_log
       (kind, source_id, action, actor_user_id, auto, reason, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.kind,
      entry.sourceId,
      entry.action,
      entry.actorUserId ?? null,
      entry.auto ? 1 : 0,
      entry.reason ? entry.reason.slice(0, 1000) : null,
      json(entry.before),
      json(entry.after),
    ],
  );
}

export async function listDecisions(kind: string, sourceId: string, exec: Exec = db): Promise<RowDataPacket[]> {
  const [rows] = await exec.execute(
    `SELECT id, kind, source_id, action, actor_user_id, auto, reason, before_json, after_json, created_at
       FROM roster_request_decision_log
      WHERE kind = ? AND source_id = ?
      ORDER BY created_at ASC, id ASC`,
    [kind, sourceId],
  );
  return rows as RowDataPacket[];
}
