/**
 * GRN-level: why do journal vendor credits differ from vendor_payment_tracking bills?
 * STRICTLY READ-ONLY. Classifies every journaled GRN (source_type='grn') against its tracking row.
 *   npx tsx scripts/vendor-bills-journal-vs-tracking.ts
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const q = async (label: string, sql: string, params: unknown[] = []) => {
  try { const [rows] = await db.execute<RowDataPacket[]>(sql, params); console.log(`\n## ${label}`); console.table(rows); }
  catch (e: any) { console.log(`\n## ${label}\nSKIPPED: ${e.message}`); }
};

const BASE = `
  FROM (SELECT je.source_id grn_id, SUM(jel.credit_amount) jcr FROM journal_entry je
          JOIN journal_entry_line jel ON jel.journal_entry_id = je.id AND jel.account_type = 'vendor'
         WHERE je.source_type = 'grn' AND je.reversed_by_entry_id IS NULL GROUP BY je.source_id) j
  LEFT JOIN grn_request g ON g.id = j.grn_id
  LEFT JOIN (SELECT grn_request_id, SUM(due_amount) due, COUNT(*) n FROM vendor_payment_tracking GROUP BY grn_request_id) t ON t.grn_request_id = j.grn_id`;

async function main() {
  await q("journaled GRNs by class",
    `SELECT CASE WHEN g.id IS NULL THEN 'grn row missing'
                 WHEN t.grn_request_id IS NULL THEN 'journaled, NO tracking row'
                 WHEN ABS(j.jcr - t.due) <= 1 THEN 'amounts agree'
                 WHEN t.due < j.jcr THEN 'tracking LOWER than journal'
                 ELSE 'tracking HIGHER than journal' END cls,
            COUNT(*) grns, ROUND(SUM(j.jcr),2) journal_credit, ROUND(SUM(COALESCE(t.due,0)),2) tracking_due, ROUND(SUM(j.jcr - COALESCE(t.due,0)),2) diff
       ${BASE} GROUP BY cls ORDER BY diff DESC`);

  await q("journaled-but-no-tracking: by GRN status",
    `SELECT COALESCE(g.status,'(none)') grn_status, COUNT(*) grns, ROUND(SUM(j.jcr),2) amount
       ${BASE} WHERE t.grn_request_id IS NULL GROUP BY g.status ORDER BY amount DESC`);

  await q("tracking-lower-than-journal: GRN status and typical gap",
    `SELECT COALESCE(g.status,'(none)') grn_status, COUNT(*) grns, ROUND(SUM(j.jcr - t.due),2) gap,
            ROUND(AVG(j.jcr - t.due),2) avg_gap, ROUND(AVG((j.jcr - t.due)/j.jcr*100),2) avg_gap_pct
       ${BASE} WHERE t.due < j.jcr - 1 GROUP BY g.status ORDER BY gap DESC`);

  await q("sample of 12 largest per-GRN gaps",
    `SELECT g.grn_number, g.status, ROUND(j.jcr,2) journal_credit, ROUND(t.due,2) tracking_due,
            ROUND(g.amount,2) grn_amount, ROUND(g.amount_with_tax,2) grn_with_tax
       ${BASE} WHERE ABS(j.jcr - COALESCE(t.due,0)) > 1 ORDER BY ABS(j.jcr - COALESCE(t.due,0)) DESC LIMIT 12`);

  await q("tracking rows with no journal entry",
    `SELECT COUNT(*) bills, ROUND(SUM(vpt.due_amount),2) amount FROM vendor_payment_tracking vpt
      WHERE NOT EXISTS (SELECT 1 FROM journal_entry je WHERE je.source_type='grn' AND je.source_id = vpt.grn_request_id AND je.reversed_by_entry_id IS NULL)`);

  await q("GRNs journaled more than once (live entries per GRN)",
    `SELECT COUNT(*) grns_with_multiple, ROUND(SUM(c),0) total_entries FROM (SELECT source_id, COUNT(*) c FROM journal_entry WHERE source_type='grn' AND reversed_by_entry_id IS NULL GROUP BY source_id HAVING COUNT(*) > 1) d`);
}

main().then(() => db.end?.()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end?.(); } catch { } process.exit(1); });
