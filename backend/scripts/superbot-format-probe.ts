/**
 * Superbot upload format probe. READ-ONLY (SELECTs only; nothing is uploaded or dialled).
 * Shape of the people we put into the last live calling-file batches: bad phones, blank fields,
 * and people who were already in an earlier batch (the portal may drop numbers it already holds).
 * Counts only: no names or numbers are printed.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];

(async () => {
  const batches = await q(
    `SELECT id, slot_key, status, row_count, created_at FROM qualified_followup_call_batch
      WHERE mode_tag = 'live' AND status IN ('sent','sent_unrecorded') AND created_at > DATE_SUB(NOW(), INTERVAL 3 DAY)
      ORDER BY created_at DESC LIMIT 8`);
  console.table(batches);
  for (const b of batches) {
    const [s] = await q(
      `SELECT COUNT(*) n, COUNT(DISTINCT qf.mobile10) distinct_phones,
              SUM(qf.mobile10 NOT REGEXP '^[6-9][0-9]{9}$') bad_phone,
              SUM(COALESCE(TRIM(qf.full_name), '') = '') no_name,
              SUM(COALESCE(TRIM(qf.role_name), '') = '') no_role,
              SUM(COALESCE(TRIM(qf.branch_name), '') = '') no_branch,
              SUM(EXISTS (SELECT 1 FROM qualified_followup p JOIN qualified_followup_call_batch pb ON pb.id = p.call_file_batch_id
                           WHERE p.mobile10 = qf.mobile10 AND p.id <> qf.id AND pb.mode_tag = 'live' AND pb.status IN ('sent','sent_unrecorded')
                             AND pb.created_at < ?)) in_earlier_batch,
              SUM(EXISTS (SELECT 1 FROM qualified_followup p JOIN qualified_followup_call_batch pb ON pb.id = p.call_file_batch_id
                           WHERE p.mobile10 = qf.mobile10 AND p.id <> qf.id AND pb.mode_tag = 'live' AND pb.status IN ('sent','sent_unrecorded')
                             AND pb.created_at < ? AND pb.created_at > DATE_SUB(?, INTERVAL 24 HOUR))) in_batch_last_24h
         FROM qualified_followup qf WHERE qf.call_file_batch_id = ?`,
      [b.created_at, b.created_at, b.created_at, b.id]);
    console.log(String(b.slot_key), "rows", b.row_count, JSON.stringify(s));
  }
  await db.end();
})().catch(async (e) => { console.error("ERR", String(e?.message ?? e).slice(0, 300)); try { await db.end(); } catch { /* */ } process.exit(1); });
