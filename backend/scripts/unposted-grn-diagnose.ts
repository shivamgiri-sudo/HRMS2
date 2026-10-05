/** Why vendor GRNs have no journal entry. STRICTLY READ-ONLY.  npx tsx scripts/unposted-grn-diagnose.ts */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const q = async (label: string, sql: string, params: unknown[] = []) => {
  try { const [rows] = await db.execute<RowDataPacket[]>(sql, params); console.log(`\n## ${label}`); console.table(rows); return rows as any[]; }
  catch (e: any) { console.log(`\n## ${label}\nSKIPPED: ${e.message}`); return []; }
};

const UNPOSTED = `g.grn_type = 'vendor' AND g.status IN ('pending_accounts_payment','payment_scheduled','partially_paid','paid','approved')
  AND NOT EXISTS (SELECT 1 FROM journal_entry je WHERE je.source_type='grn' AND je.source_id = g.id)`;

async function main() {
  await q("unposted by status / vendor present / ledger head match",
    `SELECT g.status, g.vendor_id IS NOT NULL has_vendor,
            EXISTS (SELECT 1 FROM finance_expense_sub_head_master sh JOIN finance_expense_head_master h ON h.id = sh.head_id
                     WHERE LOWER(TRIM(h.head_name)) = LOWER(TRIM(g.head)) AND LOWER(TRIM(sh.sub_head_name)) = LOWER(TRIM(g.sub_head))
                       AND sh.active_status = 1 AND h.active_status = 1) head_matches,
            COUNT(*) grns, ROUND(SUM(COALESCE(NULLIF(g.amount_with_tax,0), g.amount)),2) amount, MIN(g.created_at) first_created, MAX(g.created_at) last_created
       FROM grn_request g WHERE ${UNPOSTED} GROUP BY g.status, has_vendor, head_matches ORDER BY grns DESC`);
  await q("unposted GRNs whose head / sub-head has no active ledger head (what to map)",
    `SELECT g.head, g.sub_head, COUNT(*) grns, ROUND(SUM(COALESCE(NULLIF(g.amount_with_tax,0), g.amount)),2) amount,
            (SELECT GROUP_CONCAT(DISTINCT CONCAT(h.head_name,' / ',sh.sub_head_name) SEPARATOR ' | ')
               FROM finance_expense_head_master h JOIN finance_expense_sub_head_master sh ON sh.head_id = h.id
              WHERE LOWER(TRIM(h.head_name)) = LOWER(TRIM(g.head)) AND sh.active_status = 1 LIMIT 1) sub_heads_under_same_head,
            (SELECT COUNT(*) FROM finance_expense_head_master h WHERE LOWER(TRIM(h.head_name)) = LOWER(TRIM(g.head)) AND h.active_status = 1) head_exists_active,
            (SELECT COUNT(*) FROM finance_expense_sub_head_master sh JOIN finance_expense_head_master h ON h.id = sh.head_id
              WHERE LOWER(TRIM(h.head_name)) = LOWER(TRIM(g.head)) AND LOWER(TRIM(sh.sub_head_name)) = LOWER(TRIM(g.sub_head)) AND (sh.active_status = 0 OR h.active_status = 0)) exists_but_inactive
       FROM grn_request g WHERE ${UNPOSTED}
        AND NOT EXISTS (SELECT 1 FROM finance_expense_sub_head_master sh JOIN finance_expense_head_master h ON h.id = sh.head_id
                         WHERE LOWER(TRIM(h.head_name)) = LOWER(TRIM(g.head)) AND LOWER(TRIM(sh.sub_head_name)) = LOWER(TRIM(g.sub_head)) AND sh.active_status = 1 AND h.active_status = 1)
      GROUP BY g.head, g.sub_head ORDER BY amount DESC LIMIT 40`);
  await q("unposted GRNs that DO have a matching head (should post)",
    `SELECT g.grn_number, g.status, g.head, g.sub_head, ROUND(COALESCE(NULLIF(g.amount_with_tax,0), g.amount),2) amount, g.vendor_id IS NOT NULL has_vendor
       FROM grn_request g WHERE ${UNPOSTED}
        AND EXISTS (SELECT 1 FROM finance_expense_sub_head_master sh JOIN finance_expense_head_master h ON h.id = sh.head_id
                     WHERE LOWER(TRIM(h.head_name)) = LOWER(TRIM(g.head)) AND LOWER(TRIM(sh.sub_head_name)) = LOWER(TRIM(g.sub_head)) AND sh.active_status = 1 AND h.active_status = 1) LIMIT 20`);
}
main().then(() => db.end?.()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end?.(); } catch { } process.exit(1); });
