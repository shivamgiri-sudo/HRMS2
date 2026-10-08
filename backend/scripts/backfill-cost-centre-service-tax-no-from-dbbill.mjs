/**
 * Recover cost_centre_master.service_tax_no (MAS Callnet's OWN GSTIN, per cost centre's
 * state of registration) from db_bill for cost centres that lack one.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write.
 * See backfill-cost-centre-service-tax-no-from-dbbill.ts for the full rationale/design
 * comment — this is a plain-.mjs port of the same logic (tsx/npx was hanging in this
 * environment for reasons unrelated to the DB logic; mysql2 connects fine directly).
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const isRealGstin = (value) => /^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/.test(String(value ?? "").trim());
function sq(v) { return (v ?? "").replace(/^["']|["']$/g, ""); }

async function connectWithFallback(hosts, cfg, label) {
  for (const host of hosts) {
    try {
      const conn = await mysql.createConnection({ ...cfg, host, connectTimeout: 8000 });
      await conn.query("SELECT 1");
      console.log(`[${label}] connected via ${host}`);
      return conn;
    } catch (e) {
      console.log(`[${label}] ${host} failed: ${e.code || e.message}`);
    }
  }
  throw new Error(`[${label}] all hosts failed`);
}

async function main() {
  const hrms = await connectWithFallback(["192.168.10.6", "122.184.128.90"], {
    port: Number(process.env.DB_PORT || 3306),
    user: sq(process.env.DB_USER), password: sq(process.env.DB_PASSWORD), database: sq(process.env.DB_NAME),
  }, "mas_hrms");
  const bill = await connectWithFallback(["192.168.10.22", "14.97.30.236"], {
    port: Number(process.env.BILL_DB_PORT || 3306),
    user: sq(process.env.BILL_DB_USER), password: sq(process.env.BILL_DB_PASSWORD), database: sq(process.env.BILL_DB_NAME),
  }, "db_bill");

  try {
    const [targets] = await hrms.query(
      `SELECT id, cost_centre_code, bill_source_id
         FROM cost_centre_master
        WHERE bill_source_id IS NOT NULL
          AND (service_tax_no IS NULL OR service_tax_no = '')`
    );
    const keys = targets.map((r) => r.bill_source_id).filter((v) => v != null);
    if (!keys.length) { console.log("Nothing to do."); return; }

    const [srcRows] = await bill.query(
      `SELECT id, ServiceTaxNo FROM cost_master WHERE id IN (${keys.map(() => "?").join(",")})`,
      keys
    );
    const source = new Map(srcRows.map((r) => [String(r.id), r.ServiceTaxNo]));

    const recoverable = [];
    const stranded = [];

    for (const row of targets) {
      const gstin = source.get(String(row.bill_source_id));
      if (isRealGstin(gstin)) {
        recoverable.push({ id: String(row.id), gstin: String(gstin).trim().toUpperCase(), cc: String(row.cost_centre_code) });
      } else {
        stranded.push({ cc: String(row.cost_centre_code), bill_source_id: String(row.bill_source_id) });
      }
    }

    console.log(`\nCost centres with a bill_source_id and blank service_tax_no : ${targets.length}`);
    console.log(`  recoverable from db_bill (cost_master.ServiceTaxNo)        : ${recoverable.length}`);
    console.log(`  no usable GSTIN upstream either — left for a human          : ${stranded.length}\n`);

    const byGstin = new Map();
    for (const r of recoverable) byGstin.set(r.gstin, (byGstin.get(r.gstin) ?? 0) + 1);
    console.log("GSTINs that would be written:");
    console.table([...byGstin.entries()].map(([gstin, n]) => ({ gstin, cost_centres: n })));

    if (stranded.length) {
      console.log(`\nNo ServiceTaxNo in db_bill either — sample of ${Math.min(20, stranded.length)}:`);
      console.table(stranded.slice(0, 20));
      if (stranded.length > 20) console.log(`  … and ${stranded.length - 20} more`);
    }

    if (!APPLY) {
      console.log("\nDRY RUN — nothing written. Pass --apply to write the recovered GSTINs.");
      return;
    }

    for (const row of recoverable) {
      await hrms.execute(`UPDATE cost_centre_master SET service_tax_no = ? WHERE id = ?`, [row.gstin, row.id]);
    }
    console.log(`\nAPPLIED — ${recoverable.length} cost centre(s) given their real GSTIN from db_bill.`);
  } finally {
    await hrms.end();
    await bill.end();
  }
}

main().catch((error) => { console.error("FAILED:", error); process.exit(1); });
