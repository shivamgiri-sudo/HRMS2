/**
 * "Already contacted" lock (WS3 review focus 2): a Meta lead that the old flow notified, that has an Hiring Engine match for its
 * requisition, a walk-in invite, or a follow-up row that sent something or is live and running, is never moved to another requisition
 * (routing, retro-route, HR relink).
 * Optional tables (walkin_invite from 2140, qualified_followup from 2133) are used only when present; the presence check is cached (re-checked every minute while a table is missing).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { fillPhoneSql } from "../hiring-engine/he-source-attribution.js";

const CI = "COLLATE utf8mb4_unicode_ci";
const OPTIONAL = ["walkin_invite", "qualified_followup"] as const;
// Cached for good once every optional table exists; while one is missing the answer is re-checked after a short TTL, so a migration
// applied while the process runs (2140 after the API started) is picked up without a restart.
const MISSING_TTL_MS = 60_000;
let present: Promise<Set<string>> | null = null;
let checkedAt = 0;

export function optionalTables(now: number = Date.now()): Promise<Set<string>> {
  if (present && now - checkedAt >= MISSING_TTL_MS) {
    const cur = present;
    present = cur.then((s) => (OPTIONAL.every((t) => s.has(t)) ? s : lookup(now)));
    if (present !== cur) checkedAt = now;
  }
  if (!present) present = lookup(now);
  return present;
}
function lookup(now: number): Promise<Set<string>> {
  checkedAt = now;
  return db.execute<RowDataPacket[]>(
    `SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${OPTIONAL.map(() => "?").join(",")})`, [...OPTIONAL])
    .then(([rows]) => new Set(rows.map((r) => String(r.t ?? r.TABLE_NAME))))
    .catch(() => { present = null; return new Set<string>(); });
}
/** Test hook. */
export const resetOptionalTables = (): void => { present = null; checkedAt = 0; };

/** SQL boolean: the meta_lead_raw row `alias` was contacted (any channel, any path). */
export function isLeadContactedSql(alias: string, tables: Set<string>): string {
  const parts = [
    `${alias}.notification_sent_at IS NOT NULL`,
    `EXISTS (SELECT 1 FROM he_lead cl JOIN he_match cm ON cm.lead_id = cl.id WHERE (cl.meta_lead_id = ${alias}.id ${CI} OR cl.mobile10 = ${fillPhoneSql(alias)} ${CI}) AND cm.requisition_id = ${alias}.requisition_id ${CI})`,
  ];
  if (tables.has("walkin_invite")) parts.push(`EXISTS (SELECT 1 FROM walkin_invite cw WHERE cw.meta_lead_id = ${alias}.id ${CI})`);
  // A follow-up row locks the lead once it sent something, or while it is live and running; a row stopped before any send (for
  // example requisition_closed, the K7BK case) or a dry-run shadow does not.
  if (tables.has("qualified_followup")) parts.push(`EXISTS (SELECT 1 FROM qualified_followup cq WHERE cq.meta_lead_id = ${alias}.id ${CI}
    AND (cq.email_sent_at IS NOT NULL OR cq.wa_sent_at IS NOT NULL OR cq.called_at IS NOT NULL OR (cq.stopped_at IS NULL AND cq.mode_at_enqueue <> 'dry_run')))`);
  return `(${parts.join(" OR ")})`;
}

/** One lead: contacted or not (false when the lead does not exist). */
export async function leadContacted(metaLeadId: string): Promise<boolean> {
  const t = await optionalTables();
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT ${isLeadContactedSql("r", t)} AS c FROM meta_lead_raw r WHERE r.id = ? LIMIT 1`, [metaLeadId]);
  return Number(rows[0]?.c ?? 0) === 1;
}
