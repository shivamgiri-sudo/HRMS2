/**
 * Backfill: imprest GRNs must book their WHOLE amount to P&L (no GST split).
 *
 * Companion to the code fix in grn-imprest-tax.ts (applyImprestNoGst). That stops NEW imprest
 * rows inheriting the funding budget line's planning tax treatment; this repairs the rows already
 * written that way. amount_with_tax / amount are never touched — the gross is correct and budget
 * consumption (reserved_amount/consumed_amount) is measured on it, so headroom does not move.
 *
 *   node backend/scripts/imprest_pnl_backfill.mjs           # dry run, writes the rollback file
 *   node backend/scripts/imprest_pnl_backfill.mjs --apply    # applies inside one transaction
 */
import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";

const APPLY = process.argv.includes("--apply");
const env = Object.fromEntries(
  fs.readFileSync("backend/.env", "utf8").split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")])
);
const hosts = [env.DB_HOST, "192.168.10.6", "122.184.128.90"].filter((h, i, a) => h && a.indexOf(h) === i);
let conn = null;
for (const host of hosts) {
  try {
    conn = await mysql.createConnection({
      host, port: Number(env.DB_PORT || 3306), user: env.DB_USER,
      password: env.DB_PASSWORD, database: env.DB_NAME, connectTimeout: 8000,
    });
    console.log(`[db] ${host}`);
    break;
  } catch (e) { console.log(`[db] ${host}: ${e.code}`); }
}
if (!conn) throw new Error("no reachable DB host");

const q = async (s, p = []) => (await conn.query(s, p))[0];

const HEADER_PRED = `grn_type='imprest' AND (ROUND(pnl_cost_amount,2)<>ROUND(amount_with_tax,2)
   OR ROUND(amount_without_tax,2)<>ROUND(amount_with_tax,2) OR ROUND(tax_amount,2)<>0)`;
const ALLOC_PRED = `g.grn_type='imprest' AND (ROUND(a.pnl_cost_amount,2)<>ROUND(a.amount_with_tax,2)
   OR ROUND(a.amount_without_tax,2)<>ROUND(a.amount_with_tax,2) OR ROUND(a.tax_amount,2)<>0)`;

const headers = await q(`
  SELECT id, grn_number, status, tax_treatment, gst_rate, gst_type, recoverable_tax_pct,
         amount_without_tax, tax_amount, amount_with_tax, pnl_cost_amount
    FROM grn_request WHERE ${HEADER_PRED}`);
const allocs = await q(`
  SELECT a.id, a.grn_request_id, g.grn_number, g.status, a.lifecycle_status,
         a.tax_treatment, a.gst_rate, a.gst_type, a.recoverable_tax_pct,
         a.amount_without_tax, a.tax_amount, a.cgst_amount, a.sgst_amount, a.igst_amount,
         a.amount_with_tax, a.recoverable_tax_amount, a.pnl_cost_amount
    FROM grn_cost_allocation a JOIN grn_request g ON g.id=a.grn_request_id
   WHERE ${ALLOC_PRED}`);

const sum = (rows, f) => Math.round(rows.reduce((s, r) => s + Number(r[f]), 0) * 100) / 100;
console.log(`headers    : ${headers.length} rows, P&L understated by Rs ${sum(headers, "amount_with_tax") - sum(headers, "pnl_cost_amount")}`);
console.log(`allocations: ${allocs.length} rows, P&L understated by Rs ${Math.round((sum(allocs, "amount_with_tax") - sum(allocs, "pnl_cost_amount")) * 100) / 100}`);

// Nothing here may be paid or consumed: gross is unchanged, but refuse anyway rather than touch
// a row whose money has already left, since a paid row's tax split may have been reported.
const paid = allocs.filter((r) => !["draft", "reserved"].includes(String(r.lifecycle_status)));
if (paid.length) {
  console.error(`REFUSING: ${paid.length} allocation row(s) are past 'reserved' — review manually.`);
  await conn.end();
  process.exit(1);
}

const stamp = "imprest_pnl_backfill";
const outDir = path.join("backend", "scripts");
fs.writeFileSync(path.join(outDir, `${stamp}_BEFORE.json`), JSON.stringify({ headers, allocs }, null, 2));

const rollback = [
  ...headers.map((r) => `UPDATE grn_request SET tax_treatment=${JSON.stringify(r.tax_treatment)}, gst_rate=${r.gst_rate}, gst_type=${JSON.stringify(r.gst_type)}, recoverable_tax_pct=${r.recoverable_tax_pct}, amount_without_tax=${r.amount_without_tax}, tax_amount=${r.tax_amount}, pnl_cost_amount=${r.pnl_cost_amount} WHERE id='${r.id}';`),
  ...allocs.map((r) => `UPDATE grn_cost_allocation SET tax_treatment=${JSON.stringify(r.tax_treatment)}, gst_rate=${r.gst_rate}, gst_type=${JSON.stringify(r.gst_type)}, recoverable_tax_pct=${r.recoverable_tax_pct}, amount_without_tax=${r.amount_without_tax}, tax_amount=${r.tax_amount}, cgst_amount=${r.cgst_amount}, sgst_amount=${r.sgst_amount}, igst_amount=${r.igst_amount}, recoverable_tax_amount=${r.recoverable_tax_amount}, pnl_cost_amount=${r.pnl_cost_amount} WHERE id='${r.id}';`),
].join("\n");
fs.writeFileSync(path.join(outDir, `${stamp}_ROLLBACK.sql`), rollback + "\n");
console.log(`wrote ${stamp}_BEFORE.json and ${stamp}_ROLLBACK.sql`);

if (!APPLY) {
  console.log("dry run — pass --apply to write");
  await conn.end();
  process.exit(0);
}

await conn.beginTransaction();
try {
  const [h] = await conn.query(`
    UPDATE grn_request
       SET amount_without_tax = amount_with_tax,
           tax_amount = 0,
           pnl_cost_amount = amount_with_tax,
           tax_treatment = 'non_gst', gst_rate = 0, gst_type = 'none', recoverable_tax_pct = 0
     WHERE ${HEADER_PRED}`);
  const [a] = await conn.query(`
    UPDATE grn_cost_allocation a JOIN grn_request g ON g.id = a.grn_request_id
       SET a.amount_without_tax = a.amount_with_tax,
           a.tax_amount = 0, a.cgst_amount = 0, a.sgst_amount = 0, a.igst_amount = 0,
           a.recoverable_tax_amount = 0,
           a.pnl_cost_amount = a.amount_with_tax,
           a.tax_treatment = 'non_gst', a.gst_rate = 0, a.gst_type = 'none', a.recoverable_tax_pct = 0
     WHERE ${ALLOC_PRED}`);
  console.log(`updated ${h.affectedRows} header(s), ${a.affectedRows} allocation(s)`);
  await conn.commit();
} catch (e) {
  await conn.rollback();
  throw e;
}

const [left] = await q(`SELECT COUNT(*) n FROM grn_request WHERE ${HEADER_PRED}`);
const [leftA] = await q(`
  SELECT COUNT(*) n FROM grn_cost_allocation a JOIN grn_request g ON g.id=a.grn_request_id WHERE ${ALLOC_PRED}`);
console.log(`remaining after apply — headers: ${left.n}, allocations: ${leftA.n}`);
await conn.end();
