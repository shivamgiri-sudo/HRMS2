/**
 * Joining-kit eSign diagnosis. READ-ONLY (SELECTs only).
 *
 * Lists the most recent kit-scope eSign transactions with the vendor's own status,
 * timings and sanitized response, so a kit whose signing link shows "Invalid Page"
 * can be told apart from a healthy one.
 *
 *   npx tsx scripts/kit-esign-diagnose.ts [employee_code]
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const CODE = process.argv[2] ?? "MAS63661";
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];

(async () => {
  console.log("\n== auth_user id for the redispatch actor ==");
  try {
    console.table(await q(
      `SELECT id, email FROM auth_user WHERE email = ? LIMIT 3`, ["shivam.giri@teammas.in"]));
  } catch (e) { console.log("auth_user lookup failed:", (e as Error).message); }

  console.log(`\n== kits + transactions for ${CODE} ==`);
  const rows = await q(
    `SELECT k.id kit_id, k.status kit_status, k.blocked_reason, k.sent_at, k.document_count, k.total_pages,
            t.id tx_id, t.status tx_status, t.initiated_at, t.updated_at, t.poll_attempts,
            t.provider_reference_id, t.client_transaction_id, t.provider_url,
            t.error_message, LEFT(CAST(t.response_payload AS CHAR), 1500) response_payload
       FROM employee_joining_esign_kit k
       JOIN employees e ON e.id = k.employee_id
  LEFT JOIN employee_document_esign_transaction t ON t.kit_id = k.id
      WHERE e.employee_code = ?
      ORDER BY k.created_at DESC, t.initiated_at DESC LIMIT 10`, [CODE]);
  for (const r of rows) console.log(JSON.stringify(r, null, 2));

  console.log("\n== kit transactions started in the last 3 days, by status ==");
  console.table(await q(
    `SELECT status, COUNT(*) n, MIN(initiated_at) first_at, MAX(initiated_at) last_at
       FROM employee_document_esign_transaction
      WHERE scope = 'kit' AND initiated_at >= NOW() - INTERVAL 3 DAY GROUP BY status`));

  console.log("\n== last 15 kit transactions (code, status, age in minutes until status last changed) ==");
  console.table(await q(
    `SELECT e.employee_code, t.status, t.initiated_at,
            TIMESTAMPDIFF(MINUTE, t.initiated_at, t.updated_at) mins_to_last_update, t.poll_attempts,
            LEFT(t.error_message, 120) error_message
       FROM employee_document_esign_transaction t JOIN employees e ON e.id = t.employee_id
      WHERE t.scope = 'kit' ORDER BY t.initiated_at DESC LIMIT 15`));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
