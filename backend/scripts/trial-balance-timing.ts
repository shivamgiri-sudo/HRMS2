/**
 * Times the Trial Balance's queries and shows their plans. STRICTLY READ-ONLY.
 *   npx tsx scripts/trial-balance-timing.ts
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const run = async (label: string, sql: string) => {
  const t0 = Date.now();
  try {
    const [rows] = await db.execute<RowDataPacket[]>(sql);
    console.log(`${label}: ${((Date.now() - t0) / 1000).toFixed(1)}s, ${(rows as any[]).length} rows`);
  } catch (e: any) { console.log(`${label}: ERR ${e.message}`); }
};
const explain = async (label: string, sql: string) => {
  try { const [rows] = await db.execute<RowDataPacket[]>(`EXPLAIN ${sql}`); console.log(`\n## EXPLAIN ${label}`); console.table((rows as any[]).map((r) => ({ id: r.id, table: r.table, type: r.type, key: r.key, rows: r.rows, extra: String(r.Extra ?? "").slice(0, 60) }))); }
  catch (e: any) { console.log(`EXPLAIN ${label}: ERR ${e.message}`); }
};

const Q_TB = `SELECT jel.account_type, jel.account_id, SUM(jel.debit_amount) d, SUM(jel.credit_amount) c
  FROM journal_entry_line jel JOIN journal_entry je ON je.id = jel.journal_entry_id WHERE je.reversed_by_entry_id IS NULL GROUP BY jel.account_type, jel.account_id`;
const Q_TX = `SELECT vendor_payment_id, SUM(amount) s FROM vendor_payment_transaction GROUP BY vendor_payment_id`;
const Q_JJ = `SELECT DISTINCT source_id FROM journal_entry WHERE source_type = 'grn' AND reversed_by_entry_id IS NULL`;
const Q_TRACK = `SELECT vpt.vendor_id, SUM(vpt.due_amount) b, SUM(CASE WHEN jj.source_id IS NULL THEN vpt.due_amount ELSE 0 END) u, SUM(COALESCE(x.s,0)) p
  FROM vendor_payment_tracking vpt LEFT JOIN grn_request g ON g.id = vpt.grn_request_id
  LEFT JOIN (${Q_TX}) x ON x.vendor_payment_id = vpt.id
  LEFT JOIN (${Q_JJ}) jj ON jj.source_id = vpt.grn_request_id GROUP BY vpt.vendor_id`;
const Q_LEG = `SELECT g.vendor_id, SUM(g.amount) a FROM grn_request g
  LEFT JOIN (${Q_JJ}) jj ON jj.source_id = g.id
  WHERE g.status='paid' AND g.vendor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vendor_payment_tracking t WHERE t.grn_request_id = g.id) GROUP BY g.vendor_id`;

async function main() {
  await run("journal trial-balance aggregate", Q_TB);
  await run("transactions grouped", Q_TX);
  await run("journaled GRN ids", Q_JJ);
  await run("tracking aggregate (joins)", Q_TRACK);
  await run("legacy settled GRNs", Q_LEG);
  await explain("tracking aggregate", Q_TRACK);
  await explain("legacy", Q_LEG);
  await explain("trial balance", Q_TB);
}
main().then(() => db.end?.()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end?.(); } catch { } process.exit(1); });
