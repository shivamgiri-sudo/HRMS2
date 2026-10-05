/**
 * db_bill P&L-source discovery. READ-ONLY (billQuery only allows SELECT/SHOW/DESCRIBE).
 * Prints column lists for tbl_invoice / salary_data / masjclrentry, a few invoice sample rows,
 * and 2026 monthly row counts, so a per-branch component extract can be written against real columns.
 *
 *   npx tsx scripts/dbbill-pnl-discover.ts
 */
import "dotenv/config";
import { billQuery } from "../src/db/billDb.js";

const show = async (title: string, sql: string) => {
  try {
    const rows = await billQuery<any>(sql);
    console.log(`DBB_${title} ` + JSON.stringify(rows));
  } catch (e) {
    console.log(`DBB_${title} ERROR ` + (e instanceof Error ? e.message : String(e)));
  }
};

(async () => {
  for (const t of ["tbl_invoice", "salary_data", "masjclrentry"]) {
    await show(`COLS_${t}`, `SELECT COLUMN_NAME c, DATA_TYPE d FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${t}' ORDER BY ORDINAL_POSITION`);
  }
  await show("TABLES", `SELECT TABLE_NAME t, TABLE_ROWS r FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`);
  await show("INVOICE_SAMPLE", `SELECT * FROM tbl_invoice WHERE invoiceDate >= '2026-04-01' ORDER BY id DESC LIMIT 3`);
  await show("INVOICE_MONTHS", `SELECT DATE_FORMAT(invoiceDate,'%Y-%m') p, COUNT(*) n, SUM(total) total FROM tbl_invoice WHERE status = 0 AND invoiceDate >= '2026-04-01' GROUP BY p ORDER BY p`);
  await show("SALARY_MONTHS", `SELECT DATE_FORMAT(SalayDate,'%Y-%m') p, COUNT(*) n, SUM(CAST(Gross AS DECIMAL(14,2))) gross FROM salary_data WHERE SalayDate >= '2026-04-01' GROUP BY p ORDER BY p`);
  await new Promise((resolve) => process.stdout.write("DBB_DONE\n", resolve));
  process.exit(0);
})();
