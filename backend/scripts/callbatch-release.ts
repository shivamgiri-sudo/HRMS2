/**
 * Puts the people of ONE calling-file batch back in the queue so the engine files them again with today's eligibility, when the portal
 * REFUSED that batch (summary.portal.ok = false) and nobody in it has been called. Dry run unless APPLY=1.
 *   BATCH_ID=<uuid> [APPLY=1] npx tsx scripts/callbatch-release.ts
 */
import "dotenv/config";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../src/db/mysql.js";
(async () => {
  const id = String(process.env.BATCH_ID ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) { console.log("BATCH_ID missing or invalid"); process.exit(1); }
  const [b] = await db.execute<RowDataPacket[]>(
    "SELECT status, row_count, created_at, JSON_EXTRACT(summary,'$.portal.ok') AS portal_ok FROM qualified_followup_call_batch WHERE id = ? LIMIT 1", [id]);
  const batch = b[0];
  if (!batch) { console.log("batch not found"); process.exit(1); }
  const [c] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) total, SUM(call_state = 'called') called, SUM(call_state = 'in_file') in_file FROM qualified_followup WHERE call_file_batch_id = ?`, [id]);
  console.log("batch", JSON.stringify(batch), "rows", JSON.stringify(c[0]));
  const refused = batch.portal_ok === 0 || batch.portal_ok === false || String(batch.portal_ok) === "false";
  if (!refused || Number(c[0].called) > 0) { console.log("REFUSED: only a batch the portal refused, with nobody called, may be released"); process.exit(1); }
  if (process.env.APPLY !== "1") { console.log(`DRY RUN: would release ${c[0].in_file} rows`); await db.end?.(); return; }
  const [r] = await db.execute<ResultSetHeader>(
    "UPDATE qualified_followup SET call_file_batch_id = NULL WHERE call_file_batch_id = ? AND call_state = 'in_file' AND stopped_reason IS NULL", [id]);
  console.log(`RELEASED ${r.affectedRows} rows; the engine files them again in its next batch`);
  await db.end?.();
})();
