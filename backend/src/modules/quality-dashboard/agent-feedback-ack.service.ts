/**
 * Agent acknowledgement of quality-audit feedback (table: mas_hrms.agent_feedback_acknowledgement,
 * sql/migrations/2225). Rows are insert-only — never updated or deleted — so the table is the
 * audit trail of who acknowledged what, when, from where, and what they were shown.
 *
 * Until the migration is applied the table does not exist; reads then report `available: false`
 * instead of failing the dashboard, and acknowledging returns a clear 503.
 */
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { CQ_SCORE_SQL } from "../../lib/query-builders/quality-queries.js";

export const ACK_SOURCE = "quality_audit";

export type AckInfo = { acknowledged_at: string; comment: string | null; acknowledged_by_user_id: string };

const isMissingTable = (e: unknown) => (e as { code?: string })?.code === "ER_NO_SUCH_TABLE";

export class AckUnavailableError extends Error {}
export class AckNotFoundError extends Error {}

/** Acknowledgements for the given audit ids of one agent. */
export async function getAckMap(masid: string, auditIds: number[]): Promise<{ available: boolean; acks: Map<number, AckInfo> }> {
  const acks = new Map<number, AckInfo>();
  const ids = [...new Set(auditIds.filter((v) => Number.isInteger(v) && v > 0))];
  if (ids.length === 0) return { available: await ackTableExists(), acks };
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT source_record_id, DATE_FORMAT(acknowledged_at, '%Y-%m-%d %H:%i') AS at, agent_comment, acknowledged_by_user_id
         FROM agent_feedback_acknowledgement
        WHERE source = ? AND agent_masid = ? AND source_record_id IN (${ids.map(() => "?").join(",")})`,
      [ACK_SOURCE, masid, ...ids],
    );
    for (const r of rows) {
      acks.set(Number(r.source_record_id), {
        acknowledged_at: String(r.at),
        comment: r.agent_comment ?? null,
        acknowledged_by_user_id: String(r.acknowledged_by_user_id),
      });
    }
    return { available: true, acks };
  } catch (e) {
    if (isMissingTable(e)) return { available: false, acks };
    throw e;
  }
}

async function ackTableExists(): Promise<boolean> {
  try {
    await db.execute(`SELECT 1 FROM agent_feedback_acknowledgement LIMIT 0`);
    return true;
  } catch (e) {
    if (isMissingTable(e)) return false;
    throw e;
  }
}

/**
 * Feedback awaiting acknowledgement: audited calls in the last `days` days that carry auditor
 * feedback text and have no acknowledgement yet.
 */
export async function getAckSummary(masid: string, days = 30): Promise<{ available: boolean; with_feedback: number; acknowledged: number; pending: number }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT q.id FROM db_audit.call_quality_assessment q
      WHERE q.User = ? AND q.CallDate >= DATE_SUB(CURDATE(), INTERVAL ${Math.max(1, Math.min(90, Math.floor(days)))} DAY)
        AND q.quality_percentage IS NOT NULL
        AND q.areas_for_improvement IS NOT NULL AND TRIM(q.areas_for_improvement) NOT IN ('', 'None', 'NA', 'N/A')`,
    [masid],
  );
  const ids = rows.map((r) => Number(r.id));
  const { available, acks } = await getAckMap(masid, ids);
  return { available, with_feedback: ids.length, acknowledged: acks.size, pending: available ? ids.length - acks.size : 0 };
}

/**
 * Records the agent's acknowledgement of one audit. The audit must belong to this agent
 * (call_quality_assessment.User = MASID) — that check is what stops an agent acknowledging someone
 * else's feedback by changing the id. Idempotent: a second acknowledgement returns the first.
 */
export async function acknowledgeFeedback(input: {
  masid: string;
  auditId: number;
  userId: string;
  employeeId: string | null;
  comment: string | null;
  ip: string | null;
}): Promise<{ created: boolean; ack: AckInfo }> {
  const [audit] = await db.execute<RowDataPacket[]>(
    `SELECT q.id, q.areas_for_improvement AS feedback, ROUND(${CQ_SCORE_SQL} * 100, 1) AS cq_pct
       FROM db_audit.call_quality_assessment q WHERE q.id = ? AND q.User = ?`,
    [input.auditId, input.masid],
  );
  if (audit.length === 0) throw new AckNotFoundError("Audit not found for this agent");

  const comment = input.comment?.trim() ? input.comment.trim().slice(0, 1000) : null;
  try {
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT IGNORE INTO agent_feedback_acknowledgement
         (source, source_record_id, agent_masid, employee_id, acknowledged_by_user_id, agent_comment,
          feedback_snapshot, cq_pct_snapshot, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ACK_SOURCE, input.auditId, input.masid, input.employeeId, input.userId, comment,
        audit[0].feedback ?? null, audit[0].cq_pct ?? null, input.ip ? input.ip.slice(0, 45) : null,
      ],
    );
    const created = res.affectedRows > 0;
    const { acks } = await getAckMap(input.masid, [input.auditId]);
    const ack = acks.get(input.auditId);
    if (!ack) throw new Error("Acknowledgement was not recorded");
    return { created, ack };
  } catch (e) {
    if (isMissingTable(e)) throw new AckUnavailableError("Feedback acknowledgement is not set up yet");
    throw e;
  }
}
