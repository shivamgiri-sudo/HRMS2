/**
 * Undo a browser test of the Salary-voucher and GST Tally downloads, so Accounts' real first export is untouched.
 *
 *   npx tsx scripts/tally-ui-test-revert.ts            # dry run: snapshot + the rows the test added since T0
 *   npx tsx scripts/tally-ui-test-revert.ts --apply    # remove exactly those rows, restore what the test overwrote
 *
 * A salary XML download with a serial locks the run's vouchers (tally_export_lock, export_type salary_voucher).
 * A GST batch + XML download adds tally_voucher_batch (+ lines), may supersede an earlier draft batch, and upserts
 * tally_voucher_export per invoice. Audit-log rows are deliberately left in place.
 * Only rows created at/after T0 for the one salary run and the one GSTIN/month are touched.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const APPLY = process.argv.includes("--apply");
const T0 = process.env.TEST_T0 ?? "2026-10-14 20:00:00"; // UTC on the DB server clock, set before the test
const RUN = "61733952-9588-4222-b782-9cbccff4ebd6"; // salary_prep_run, 2026-09
const GSTIN = "09AAACM5866H1Z6";
const PERIOD = "2026-10";
/** tally_voucher_export rows as they were before the test (filled from the first dry run's snapshot). */
const EXPORT_BEFORE: RowDataPacket[] = JSON.parse(process.env.EXPORT_BEFORE ?? "[]");

const q = async (sql: string, p: unknown[] = []) => (await db.query<RowDataPacket[]>(sql, p))[0];
const out = (t: string, rows: unknown[]) => { console.log(`\n## ${t} (${rows.length})`); for (const r of rows) console.log(`  ${JSON.stringify(r)}`); };

console.log(`mode: ${APPLY ? "APPLY" : "dry run"}  T0=${T0}  db now=${JSON.stringify((await q("SELECT NOW() n"))[0].n)}`);
out("salary locks for the run (all)", await q(`SELECT id, item_key, item_label, status, format, exported_by, exported_at, active FROM tally_export_lock WHERE export_type = 'salary_voucher' AND scope_key = ? ORDER BY exported_at`, [RUN]));
const batches = await q(`SELECT id, status, superseded_by_id, voucher_kinds, total_vouchers, generated_by, created_at FROM tally_voucher_batch WHERE company_gstin = ? AND period_month = ? ORDER BY created_at`, [GSTIN, PERIOD]);
out("GST batches for GSTIN/month (all)", batches);
const sources = await q(`SELECT DISTINCT l.source_type, l.source_id FROM tally_voucher_batch_line l JOIN tally_voucher_batch b ON b.id = l.batch_id WHERE b.company_gstin = ? AND b.period_month = ?`, [GSTIN, PERIOD]);
const exportRows = sources.length
  ? await q(`SELECT * FROM tally_voucher_export WHERE (source_type, source_id) IN (${sources.map(() => "(?,?)").join(",")})`, sources.flatMap((s) => [s.source_type, s.source_id]))
  : [];
out("tally_voucher_export rows for those invoices", exportRows);

const newLocks = await q(`SELECT id FROM tally_export_lock WHERE export_type = 'salary_voucher' AND scope_key = ? AND exported_at >= ?`, [RUN, T0]);
const newBatchIds = (await q(`SELECT id FROM tally_voucher_batch WHERE company_gstin = ? AND period_month = ? AND created_at >= ?`, [GSTIN, PERIOD, T0])).map((b) => String(b.id));
const superseded = batches.filter((b) => b.superseded_by_id && newBatchIds.includes(String(b.superseded_by_id)));
const touchedExports = exportRows.filter((r) => r.last_batch_id && newBatchIds.includes(String(r.last_batch_id)));
console.log(`\nTO REVERT: ${newLocks.length} salary lock row(s); ${newBatchIds.length} GST batch(es) ${JSON.stringify(newBatchIds)}; ${superseded.length} batch(es) to un-supersede; ${touchedExports.length} export tracking row(s).`);

if (APPLY) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    if (newLocks.length) await conn.query(`DELETE FROM tally_export_lock WHERE id IN (?)`, [newLocks.map((r) => r.id)]);
    for (const r of touchedExports) {
      const before = EXPORT_BEFORE.find((b) => b.source_type === r.source_type && b.source_id === r.source_id);
      if (before) {
        await conn.query(`UPDATE tally_voucher_export SET guid = ?, voucher_number = ?, content_hash = ?, first_exported_at = ?, last_exported_at = ?, export_count = ?, last_batch_id = ? WHERE source_type = ? AND source_id = ?`,
          [before.guid, before.voucher_number, before.content_hash, before.first_exported_at, before.last_exported_at, before.export_count, before.last_batch_id, r.source_type, r.source_id]);
      } else {
        await conn.query(`DELETE FROM tally_voucher_export WHERE source_type = ? AND source_id = ?`, [r.source_type, r.source_id]);
      }
    }
    // A batch is only superseded from draft/validated; draft when it carried exception vouchers.
    for (const b of superseded)
      await conn.query(`UPDATE tally_voucher_batch SET status = IF(exception_vouchers > 0, 'draft', 'validated'), superseded_by_id = NULL WHERE id = ? AND status = 'superseded'`, [b.id]);
    if (newBatchIds.length) {
      await conn.query(`DELETE FROM tally_voucher_batch_line WHERE batch_id IN (?)`, [newBatchIds]);
      await conn.query(`DELETE FROM tally_voucher_batch WHERE id IN (?)`, [newBatchIds]);
    }
    await conn.commit();
    console.log("APPLIED: reverted.");
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
process.exit(0);
