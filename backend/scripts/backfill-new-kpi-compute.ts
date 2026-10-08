/**
 * Backfills process_metric_actual (what Process Operations actually reads --
 * confirmed by direct query that computeStudioKpis had never been run for
 * any of these new metrics, despite previewProcessFormula confirming the
 * formulas themselves compute correctly) for every metric wired this
 * session: the BLA_ABC family (sql/1729 dates), the REGINALD_ABCD and
 * REGINALD_REPT families (sql/1752 dates), and a recent window for the
 * REGINALD_MEN_EMAIL and MOLECULAR_EMAIL families
 * (dialer_db.vicidial_agent_log_10_25 -- computing its
 * full history is out of scope here, just enough to make the dashboard
 * show something real).
 *
 * Run with: npx tsx scripts/backfill-new-kpi-compute.ts
 */
import "dotenv/config";
import { computeStudioKpis } from "../src/modules/kpi/kpi-studio.compute.js";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

async function datesFor(table: string, dateColumn: string): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT DATE(\`${dateColumn}\`) d FROM ${table} ORDER BY d`,
  );
  return rows.map((r) => (r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d)));
}

async function main() {
  const [blaProc] = await db.execute<RowDataPacket[]>("SELECT id FROM process_master WHERE process_name='Bla Bli Blu'");
  const [reginaldProc] = await db.execute<RowDataPacket[]>("SELECT id FROM process_master WHERE process_name='Reginald'");
  const blaProcessId = blaProc[0].id;
  const reginaldProcessId = reginaldProc[0].id;

  const blaDates = await datesFor("bla_bli_blu_overall_sales_raw", "report_date");
  const reginaldSalesDates = await datesFor("reginald_abandoned_cart_sales_raw", "order_date");
  const today = new Date();
  const recentDates: string[] = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    recentDates.push(d.toISOString().slice(0, 10));
  }

  let totalWritten = 0, totalErrors = 0;

  console.log(`BLA: computing ${blaDates.length} real dates...`);
  for (const date of blaDates) {
    const r = await computeStudioKpis({ date, processId: blaProcessId });
    totalWritten += r.written; totalErrors += r.errors;
  }
  console.log(`  written so far: ${totalWritten}, errors: ${totalErrors}`);

  console.log(`Reginald ABC sales: computing ${reginaldSalesDates.length} real dates...`);
  for (const date of reginaldSalesDates) {
    const r = await computeStudioKpis({ date, processId: reginaldProcessId });
    totalWritten += r.written; totalErrors += r.errors;
  }
  console.log(`  written so far: ${totalWritten}, errors: ${totalErrors}`);

  console.log(`Reginald email APR: computing last ${recentDates.length} days (dialer_db full history out of scope)...`);
  for (const date of recentDates) {
    const r = await computeStudioKpis({ date, processId: reginaldProcessId });
    totalWritten += r.written; totalErrors += r.errors;
  }
  console.log(`  written so far: ${totalWritten}, errors: ${totalErrors}`);

  console.log(`\nDone. Total written: ${totalWritten}, total errors: ${totalErrors}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("FAILED", e); process.exit(1); });
