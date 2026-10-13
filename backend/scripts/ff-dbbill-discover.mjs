// Read-only: where does db_bill hold F&F / settlement data, and what do its figures look like?
// SELECT/SHOW/INFORMATION_SCHEMA only. Output: table + column names, counts, and numeric column
// aggregates; no names, no free text.
import "dotenv/config";
import mysql from "mysql2/promise";
const need = (k) => { const v = process.env[k]; if (!v) throw new Error(`${k} is not set`); return v; };
const bill = await mysql.createConnection({
  host: need("BILL_DB_HOST"), port: Number(process.env.BILL_DB_PORT || 3306),
  user: need("BILL_DB_USER"), password: need("BILL_DB_PASSWORD"), database: need("BILL_DB_NAME"), connectTimeout: 20000,
});
const sel = async (sql, p = []) => {
  if (!/^\s*(select|show)\b/i.test(sql)) throw new Error("read-only");
  const [rows] = await bill.query(sql, p); return rows;
};
const tables = await sel(`SELECT TABLE_NAME t, TABLE_ROWS n FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME REGEXP 'fnf|f_n_f|full|final|settle|clearance|noc|gratuity|notice|relie|exit|resign'`);
console.log("TABLES", JSON.stringify(tables));
for (const { t } of tables) {
  const cols = await sel(`SELECT COLUMN_NAME c, DATA_TYPE ty FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`, [t]);
  console.log(`\n== ${t} ==`, cols.map((x) => `${x.c}:${x.ty}`).join(", ").slice(0, 1500));
  const [cnt] = await sel(`SELECT COUNT(*) n FROM \`${t}\``);
  console.log("rows", cnt.n);
}
// Columns anywhere that smell like F&F components
const comp = await sel(`SELECT TABLE_NAME t, COLUMN_NAME c FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME REGEXP 'fnf|f_n_f|gratuity|notice_?(pay|recov|amount)|leave_?encash|settle|net_?payable'`);
console.log("\nCOMPONENT-LIKE COLUMNS", JSON.stringify(comp).slice(0, 3000));
await bill.end();
