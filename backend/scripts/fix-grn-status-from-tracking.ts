/**
 * Vendor GRNs whose STATUS says pending while their payment record says Paid with nothing left to pay.
 * Label-only fix: grn_request.status / accounts_payment_status become 'paid' to match. The payment record, the
 * journal and every amount are untouched, and no payment transaction is invented. Dry run by default.
 *
 * Skips any GRN with a payment voucher in progress. Saves a before-image of every row first (one transaction).
 *
 *   npx tsx scripts/fix-grn-status-from-tracking.ts [--apply]
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const APPLY = process.argv.includes("--apply");
const ACTOR = "00000000-0000-0000-0000-migrat000002";
const PENDING = ["finance_head_approved", "pending_accounts_payment", "payment_scheduled", "partially_paid", "approved"];

async function main() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT g.id, g.grn_number, g.status, g.accounts_payment_status, g.bill_date, COALESCE(NULLIF(g.amount_with_tax,0), g.amount) amt
       FROM grn_request g JOIN vendor_payment_tracking t ON t.grn_request_id = g.id
      WHERE g.grn_type = 'vendor' AND g.status IN (${PENDING.map(() => "?").join(",")})
        AND t.payment_status = 'Paid' AND t.balance_amount <= 0.01
        AND NOT EXISTS (SELECT 1 FROM payment_voucher_grn_allocation a JOIN payment_voucher pv ON pv.id = a.payment_voucher_id
                         WHERE a.vendor_payment_tracking_id = t.id AND pv.status IN ('raised','ceo_approved','changes_requested'))`, PENDING);
  const list = rows as any[];
  const by = new Map<string, { n: number; amt: number }>();
  for (const r of list) { const k = `${r.status} -> paid, billed ${String(r.bill_date ?? "-").slice(0, 4)}`; const a = by.get(k) ?? { n: 0, amt: 0 }; a.n++; a.amt += Number(r.amt); by.set(k, a); }
  console.log(`${APPLY ? "APPLY" : "DRY RUN"}: ${list.length} vendor GRNs show pending but are Paid in their payment record`);
  console.table([...by.entries()].sort().map(([k, v]) => ({ change: k, grns: v.n, amount: Math.round(v.amt) })));
  if (!APPLY || !list.length) { if (!APPLY) console.log("No changes written. Re-run with --apply."); return; }

  const conn = await (db as any).getConnection();
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS grn_status_fix_bak (id CHAR(36) PRIMARY KEY, grn_id CHAR(36) NOT NULL, grn_number VARCHAR(80), old_status VARCHAR(40), old_accounts_payment_status VARCHAR(40), backed_up_at DATETIME DEFAULT CURRENT_TIMESTAMP, KEY (grn_id))`);
    await conn.beginTransaction();
    for (const r of list) {
      await conn.query(`INSERT INTO grn_status_fix_bak (id, grn_id, grn_number, old_status, old_accounts_payment_status) VALUES (?,?,?,?,?)`, [randomUUID(), r.id, r.grn_number, r.status, r.accounts_payment_status]);
      await conn.query(`UPDATE grn_request SET status = 'paid', accounts_payment_status = 'paid' WHERE id = ? AND status = ?`, [r.id, r.status]);
    }
    await conn.query(
      `INSERT INTO sensitive_action_log (id, actor_user_id, action_type, module_key, entity_type, change_summary, acted_at, reason) VALUES (UUID(), ?, 'GRN_STATUS_FROM_TRACKING', 'finance', 'grn_request', ?, NOW(), ?)`,
      [ACTOR, JSON.stringify({ grns: list.length }), "GRN status label aligned with its Paid payment record (label only); before-images in grn_status_fix_bak"]);
    await conn.commit();
    console.log(`\napplied ${list.length} status labels; before-images in grn_status_fix_bak.`);
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}
main().then(() => db.end?.()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end?.(); } catch { } process.exit(1); });
