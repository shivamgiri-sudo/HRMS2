/**
 * Re-queues follow-up invite emails that were marked failed only because of a mail-infrastructure fault
 * (Gmail daily limit 550-5.4.5, or the careers mailbox login rejected 535) and never reached the candidate.
 *
 *   npx tsx scripts/email-requeue-failed.ts [days=3]          dry run (counts + sample)
 *   APPLY=1 npx tsx scripts/email-requeue-failed.ts [days=3]  re-arms the rows (email_due_at = NOW())
 *
 * Only pipeline-owned, not-stopped rows with no email_sent_at. The email step re-checks the requisition, opt-out,
 * duplicate invite and quiet-hours guards when it picks the row up, so a closed requisition is skipped, not mailed.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const DAYS = Number(process.argv[2] ?? 3);
const APPLY = process.env.APPLY === "1";
const WHERE = `email_status = 'failed' AND owner = 'pipeline' AND stopped_reason IS NULL AND email_sent_at IS NULL AND email IS NOT NULL
  AND mode_at_enqueue = 'live' AND updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
  AND (email_error LIKE 'Data command failed: 550-5.4.5%' OR email_error LIKE 'Invalid login: 535%' OR email_error = 'daily_limit_deferred')`;

(async () => {
  const [by] = await db.execute<RowDataPacket[]>(
    `SELECT LEFT(email_error, 40) err, source_type, COUNT(*) n, MIN(updated_at) oldest FROM qualified_followup WHERE ${WHERE} GROUP BY err, source_type ORDER BY n DESC`, [DAYS]);
  console.log(`failed-for-infrastructure follow-up emails, last ${DAYS}d:`);
  for (const r of by) console.log(JSON.stringify(r));
  const total = by.reduce((a, r) => a + Number(r.n), 0);
  console.log(`total: ${total}`);
  if (!APPLY) { console.log("dry run: nothing changed (APPLY=1 to re-arm)"); await db.end?.(); return; }
  const [res] = await db.execute<any>(
    `UPDATE qualified_followup SET email_status = NULL, email_error = NULL, email_attempts = 0, email_due_at = NOW(), step_claimed_at = NULL WHERE ${WHERE}`, [DAYS]);
  console.log(`re-armed rows: ${Number(res?.affectedRows ?? 0)}`);
  await db.end?.();
})();
