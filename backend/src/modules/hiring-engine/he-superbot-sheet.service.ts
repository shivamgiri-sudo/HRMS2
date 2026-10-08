/**
 * The call sheet for uploading to the Superbot portal: one row per candidate with a live slot on a drive, in the columns the bot script reads
 * (phone, name, role, interview_date, interview_time, branch_address, reference_id). reference_id is the match id, so the feedback Superbot
 * posts back lands on the right candidate. Same rules as an engine-placed call: never opted-out, declined, dead or wrong numbers, never without a branch address.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { displayFirstName } from "./he-name.js";
import { sbDate, sbTime } from "./he-superbot.js";
import { refsForMatches } from "./he-call-ref.service.js";

export const SHEET_COLUMNS = ["phone", "name", "role", "interview_date", "interview_time", "branch_address", "reference_id"] as const;
const cell = (v: unknown) => { const s = String(v ?? "").replace(/\r?\n/g, " "); return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** pending = invited and not yet confirmed (what the confirmation call is for); all = also the confirmed. */
export async function buildSuperbotSheet(driveId: string, which: "pending" | "all"): Promise<{ csv: string; rows: number; skippedNoAddress: number } | null> {
  const [d] = await db.execute<RowDataPacket[]>("SELECT id FROM he_drive WHERE id = ? LIMIT 1", [driveId]);
  if (!d[0]) return null;
  const states = which === "all" ? "('invited','confirmed')" : "('invited')";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.slot_at, l.full_name, l.mobile10, jr.designation_name, bm.address, dr.drive_date
       FROM he_match m JOIN he_lead l ON l.id = m.lead_id JOIN job_requisition jr ON jr.id = m.requisition_id JOIN he_drive dr ON dr.id = m.drive_id
       LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
      WHERE m.drive_id = ? AND m.state IN ${states} AND m.slot_at IS NOT NULL
        AND l.status NOT IN ('opted_out','dead','declined','arrived','joined')
        AND (l.last_outcome IS NULL OR l.last_outcome <> 'wrong_number')
        AND l.mobile10 REGEXP '^[6-9][0-9]{9}$'
      ORDER BY m.slot_at, l.full_name`, [driveId]);
  let skipped = 0;
  const callable = rows.filter((r) => r.address); // never read out an invented address
  skipped = rows.length - callable.length;
  const refs = await refsForMatches(callable.map((r) => String(r.id)));
  const out: string[] = [SHEET_COLUMNS.join(",")];
  for (const r of callable) {
    out.push([String(r.mobile10), displayFirstName(r.full_name), r.designation_name, sbDate(String(r.drive_date)), sbTime(String(r.slot_at).slice(11, 16)), r.address, refs.get(String(r.id)) ?? r.id].map(cell).join(","));
  }
  // The BOM makes Excel read the file as UTF-8 (otherwise "–" in an address shows as "â€“").
  return { csv: "\uFEFF" + out.join("\r\n") + "\r\n", rows: out.length - 1, skippedNoAddress: skipped };
}
