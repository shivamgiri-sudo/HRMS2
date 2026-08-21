/**
 * Phase 1.0 follow-up — breakdown of which cost centres are causing the
 * 85 "exposed" invoices, and whether db_bill has a usable client name to
 * backfill each one from. READ-ONLY.
 */
import "dotenv/config";
import mysql from "mysql2/promise";

function stripQuotes(v) {
  return (v ?? "").replace(/^["']|["']$/g, "");
}

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
  const hrmsCfg = {
    user: stripQuotes(process.env.DB_USER),
    password: stripQuotes(process.env.DB_PASSWORD),
    database: stripQuotes(process.env.DB_NAME),
    port: Number(process.env.DB_PORT || 3306),
  };
  const billCfg = {
    user: stripQuotes(process.env.BILL_DB_USER),
    password: stripQuotes(process.env.BILL_DB_PASSWORD),
    database: stripQuotes(process.env.BILL_DB_NAME),
    port: Number(process.env.BILL_DB_PORT || 3306),
  };

  const hrms = await connectWithFallback(["192.168.10.6", "122.184.128.90"], hrmsCfg, "mas_hrms");
  const bill = await connectWithFallback(["192.168.10.22", "14.97.30.236"], billCfg, "db_bill");

  // Which cost centres (with how many invoices each) are missing billing_client_name
  const [ccGap] = await hrms.query(`
    SELECT cc.id, cc.cost_centre_code, cc.company_name, cc.billing_client_name, cc.active_status,
           COUNT(ci.id) AS invoice_count
    FROM cost_centre_master cc
    JOIN client_invoice ci ON ci.cost_centre_id = cc.id
    WHERE cc.billing_client_name IS NULL OR cc.billing_client_name = ''
    GROUP BY cc.id, cc.cost_centre_code, cc.company_name, cc.billing_client_name, cc.active_status
    ORDER BY invoice_count DESC
  `);
  console.log(`\n=== ${ccGap.length} cost centres (with >=1 invoice) missing billing_client_name ===`);
  console.log(JSON.stringify(ccGap, null, 2));

  // Which branches (via cost centre) cause blank gst_state_code exposure, with invoice counts
  const [branchGap] = await hrms.query(`
    SELECT b.id, b.branch_name, b.branch_code, COUNT(ci.id) AS invoice_count
    FROM branch_master b
    JOIN cost_centre_master cc ON cc.branch_id = b.id
    JOIN client_invoice ci ON ci.cost_centre_id = cc.id
    WHERE b.gst_state_code IS NULL
    GROUP BY b.id, b.branch_name, b.branch_code
    ORDER BY invoice_count DESC
  `);
  console.log(`\n=== branches with NULL gst_state_code that have real invoices attached ===`);
  console.log(JSON.stringify(branchGap, null, 2));

  // For each gap cost centre code, check if db_bill has a usable client name we can backfill from
  console.log(`\n=== db_bill lookup for each gap cost_centre_code ===`);
  for (const cc of ccGap) {
    if (!cc.cost_centre_code) {
      console.log(`  ${cc.id} — no cost_centre_code, cannot look up in db_bill`);
      continue;
    }
    try {
      const [rows] = await bill.query(
        `SELECT cost_client_tally_name, cost_client, COUNT(*) n
         FROM tbl_invoice
         WHERE cost_center = ?
         GROUP BY cost_client_tally_name, cost_client
         ORDER BY n DESC`,
        [cc.cost_centre_code]
      );
      console.log(`  ${cc.cost_centre_code} (${cc.invoice_count} HRMS invoices, company_name="${cc.company_name}") -> db_bill:`, JSON.stringify(rows));
    } catch (e) {
      console.log(`  ${cc.cost_centre_code} — lookup error: ${e.code || e.message}`);
    }
  }

  await hrms.end();
  await bill.end();
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
