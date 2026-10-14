/**
 * vendor-gst-from-dbbill-audit.mjs  — READ-ONLY on both databases.
 *
 * tbl_vendormaster has no GST column, so this discovers where db_bill keeps a vendor GSTIN
 * (any column named like %gst%, %gstin%, %tin%) and, for each such table that also carries a
 * vendor id/name, prints the distinct vendor -> GSTIN pairs mapped to mas_hrms.vendor_master
 * (vendor_code = DB_BILL_<Id>, falling back to exact lower-cased name).
 * Writes nothing. Uses only SELECT / information_schema.
 */
import mysql from "mysql2/promise";
import "dotenv/config";

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const cfg = (p, db) => ({ host: process.env[`${p}HOST`], port: Number(process.env[`${p}PORT`] || 3306),
  user: process.env[`${p}USER`], password: process.env[`${p}PASSWORD`], database: db, connectTimeout: 20000 });

const hrms = await mysql.createConnection(cfg("DB_", process.env.DB_NAME));
const bill = await mysql.createConnection(cfg("BILL_DB_", process.env.BILL_DB_NAME));
const q = async (c, sql, p = []) => (await c.query(sql, p))[0];

const cols = await q(bill, `SELECT TABLE_NAME t, COLUMN_NAME c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND (COLUMN_NAME LIKE '%gst%' OR COLUMN_NAME LIKE '%tin%')
  ORDER BY 1,2`);
console.log(`\n== candidate GST columns in db_bill: ${cols.length}`);
const byTable = new Map();
for (const r of cols) { if (!byTable.has(r.t)) byTable.set(r.t, []); byTable.get(r.t).push(r.c); }

const hv = await q(hrms, "SELECT id, vendor_code, vendor_name, gst_number FROM vendor_master");
console.log(`HRMS vendor_master rows: ${hv.length}; with gst_number already: ${hv.filter(v => v.gst_number && String(v.gst_number).trim()).length}`);
const byCode = new Map(hv.map(v => [v.vendor_code, v]));
const byName = new Map(hv.map(v => [String(v.vendor_name).trim().toLowerCase(), v]));

for (const [t, gcols] of byTable) {
  const vcols = (await q(bill, `SELECT COLUMN_NAME c FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME LIKE '%vendor%'`, [t])).map(r => r.c);
  console.log(`\n-- ${t}: gst cols [${gcols.join(", ")}] vendor cols [${vcols.join(", ")}]`);
  for (const g of gcols) {
    const [s] = await q(bill, `SELECT COUNT(*) n, SUM(\`${g}\` IS NOT NULL AND TRIM(\`${g}\`) <> '') filled FROM \`${t}\``);
    console.log(`   ${g}: rows=${s.n} filled=${s.filled}`);
    if (!Number(s.filled) || !vcols.length) continue;
    for (const v of vcols) {
      const rows = await q(bill, `SELECT \`${v}\` v, UPPER(TRIM(\`${g}\`)) g, COUNT(*) n FROM \`${t}\`
        WHERE \`${g}\` IS NOT NULL AND TRIM(\`${g}\`) <> '' AND \`${v}\` IS NOT NULL GROUP BY 1,2 LIMIT 5000`);
      let mapped = 0, valid = 0; const per = new Map();
      for (const r of rows) {
        const key = String(r.v).trim();
        const hit = byCode.get(`DB_BILL_${key}`) ?? byName.get(key.toLowerCase());
        const ok = GSTIN.test(r.g);
        if (hit) mapped++; if (ok) valid++;
        const k = hit ? hit.vendor_code : `?${key}`;
        if (!per.has(k)) per.set(k, new Set());
        if (ok) per.get(k).add(r.g);
      }
      const multi = [...per.values()].filter(s => s.size > 1).length;
      console.log(`   via ${v}: distinct pairs=${rows.length} mapped-to-HRMS=${mapped} valid-GSTIN=${valid} vendors=${per.size} vendors-with-conflicting-GSTINs=${multi}`);
      if (rows.length) console.log("   sample:", JSON.stringify(rows.slice(0, 5)));
    }
  }
}
await hrms.end(); await bill.end();
console.log("\nDone — nothing written.");
