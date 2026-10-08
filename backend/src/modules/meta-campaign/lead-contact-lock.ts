/**
 * "Already contacted" lock (WS3 review focus 2): a Meta lead that the old flow notified, that has an Hiring Engine match for its
 * requisition, a walk-in invite or a follow-up row is never moved to another requisition (routing, retro-route, HR relink).
 * Optional tables (walkin_invite from 2140, qualified_followup from 2133) are used only when present; the presence check is cached.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { fillPhoneSql } from "../hiring-engine/he-source-attribution.js";

const CI = "COLLATE utf8mb4_unicode_ci";
const OPTIONAL = ["walkin_invite", "qualified_followup"] as const;
let present: Promise<Set<string>> | null = null;

export function optionalTables(): Promise<Set<string>> {
  present ??= db.execute<RowDataPacket[]>(
    `SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${OPTIONAL.map(() => "?").join(",")})`, [...OPTIONAL])
    .then(([rows]) => new Set(rows.map((r) => String(r.t ?? r.TABLE_NAME))))
    .catch(() => { present = null; return new Set<string>(); });
  return present;
}
/** Test hook. */
export const resetOptionalTables = (): void => { present = null; };

/** SQL boolean: the meta_lead_raw row `alias` was contacted (any channel, any path). */
export function isLeadContactedSql(alias: string, tables: Set<string>): string {
  const parts = [
    `${alias}.notification_sent_at IS NOT NULL`,
    `EXISTS (SELECT 1 FROM he_lead cl JOIN he_match cm ON cm.lead_id = cl.id WHERE (cl.meta_lead_id = ${alias}.id ${CI} OR cl.mobile10 = ${fillPhoneSql(alias)} ${CI}) AND cm.requisition_id = ${alias}.requisition_id ${CI})`,
  ];
  if (tables.has("walkin_invite")) parts.push(`EXISTS (SELECT 1 FROM walkin_invite cw WHERE cw.meta_lead_id = ${alias}.id ${CI})`);
  if (tables.has("qualified_followup")) parts.push(`EXISTS (SELECT 1 FROM qualified_followup cq WHERE cq.meta_lead_id = ${alias}.id ${CI})`);
  return `(${parts.join(" OR ")})`;
}

/** One lead: contacted or not (false when the lead does not exist). */
export async function leadContacted(metaLeadId: string): Promise<boolean> {
  const t = await optionalTables();
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT ${isLeadContactedSql("r", t)} AS c FROM meta_lead_raw r WHERE r.id = ? LIMIT 1`, [metaLeadId]);
  return Number(rows[0]?.c ?? 0) === 1;
}
