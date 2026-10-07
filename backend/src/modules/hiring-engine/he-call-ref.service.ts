/**
 * The reference the voice bot carries for a call: HRMS-001, HRMS-002, ... (one per match, kept for life). Superbot only echoes it back with the
 * result, so this table is how the feedback finds its match. An older reference that is a bare match id still resolves.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export const fmtRef = (seq: number) => `HRMS-${String(seq).padStart(3, "0")}`;
const REF_RE = /^HRMS-(\d{3,9})$/i;
export const parseRef = (ref: string): number | null => { const m = REF_RE.exec(String(ref).trim()); return m ? Number(m[1]) : null; };

/** References for these matches, created in the order given (so a sheet reads HRMS-041, HRMS-042, ...). */
export async function refsForMatches(matchIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(matchIds)];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const id of chunk) await db.execute("INSERT IGNORE INTO he_call_ref (match_id) VALUES (?)", [id]);
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT seq, match_id FROM he_call_ref WHERE match_id IN (${chunk.map(() => "?").join(",")})`, chunk);
    for (const r of rows) out.set(String(r.match_id), fmtRef(Number(r.seq)));
  }
  return out;
}
export async function refForMatch(matchId: string): Promise<string> { return (await refsForMatches([matchId])).get(matchId) ?? matchId; }
/** The reference already given to a match, or null (never creates one). */
export async function existingRef(matchId: string): Promise<string | null> {
  const [r] = await db.execute<RowDataPacket[]>("SELECT seq FROM he_call_ref WHERE match_id = ? LIMIT 1", [matchId]);
  return r[0] ? fmtRef(Number(r[0].seq)) : null;
}
/** The match a reference belongs to; a bare match id (older calls) passes through. */
export async function matchForRef(ref: string | null | undefined): Promise<string | null> {
  const t = String(ref ?? "").trim();
  if (!t) return null;
  const seq = parseRef(t);
  if (seq == null) return t;
  const [r] = await db.execute<RowDataPacket[]>("SELECT match_id FROM he_call_ref WHERE seq = ? LIMIT 1", [seq]);
  return r[0] ? String(r[0].match_id) : null;
}
