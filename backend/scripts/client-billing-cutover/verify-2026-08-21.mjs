/**
 * Phase 1.0 verification — client-billing gap audit, 2026-08-21.
 * READ-ONLY. Every query here is a SELECT; nothing is written to mas_hrms
 * or db_bill. Run: cd backend && node scripts/client-billing-cutover/verify-2026-08-21.mjs
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

  const out = {};

  // 1. Row counts
  const [[invCount]] = await hrms.query("SELECT COUNT(*) n FROM client_invoice");
  const [[cnCount]] = await hrms.query("SELECT COUNT(*) n FROM client_credit_note");
  out.client_invoice_count = invCount.n;
  out.client_credit_note_count = cnCount.n;

  // 2. Staging error counts
  let stagingInvErr = null, stagingCnErr = null;
  try {
    const [[r]] = await hrms.query(
      "SELECT COUNT(*) n FROM client_invoice_migration_staging WHERE validation_status='error'"
    );
    stagingInvErr = r.n;
  } catch (e) {
    stagingInvErr = `ERR: ${e.code || e.message}`;
  }
  try {
    const [[r]] = await hrms.query(
      "SELECT COUNT(*) n FROM client_credit_note_migration_staging WHERE validation_status='error'"
    );
    stagingCnErr = r.n;
  } catch (e) {
    stagingCnErr = `ERR: ${e.code || e.message}`;
  }
  out.staging_invoice_errors = stagingInvErr;
  out.staging_credit_note_errors = stagingCnErr;

  // Also grab error message breakdown for invoices + credit notes, if column exists
  try {
    const [rows] = await hrms.query(
      "SELECT validation_error, COUNT(*) n FROM client_invoice_migration_staging WHERE validation_status='error' GROUP BY validation_error ORDER BY n DESC"
    );
    out.staging_invoice_error_breakdown = rows;
  } catch (e) {
    out.staging_invoice_error_breakdown = `ERR: ${e.code || e.message}`;
  }
  try {
    const [rows] = await hrms.query(
      "SELECT validation_error, COUNT(*) n FROM client_credit_note_migration_staging WHERE validation_status='error' GROUP BY validation_error ORDER BY n DESC"
    );
    out.staging_credit_note_error_breakdown = rows;
  } catch (e) {
    out.staging_credit_note_error_breakdown = `ERR: ${e.code || e.message}`;
  }

  // 3. db_bill legacy totals
  const [[legacyInv]] = await bill.query("SELECT COUNT(*) n FROM tbl_invoice");
  out.legacy_tbl_invoice_count = legacyInv.n;
  try {
    const [[legacyCn]] = await bill.query("SELECT COUNT(*) n FROM tbl_credit_note");
    out.legacy_tbl_credit_note_count = legacyCn.n;
  } catch (e) {
    out.legacy_tbl_credit_note_count = `ERR: ${e.code || e.message}`;
  }

  // 4. billing_client_name backfill
  const [[ccTotal]] = await hrms.query("SELECT COUNT(*) n FROM cost_centre_master");
  const [[ccMissing]] = await hrms.query(
    "SELECT COUNT(*) n FROM cost_centre_master WHERE billing_client_name IS NULL OR billing_client_name = ''"
  );
  out.cost_centre_total = ccTotal.n;
  out.cost_centre_missing_billing_client_name = ccMissing.n;

  let ccActiveTotal = null, ccActiveMissing = null;
  try {
    const [[a]] = await hrms.query("SELECT COUNT(*) n FROM cost_centre_master WHERE active_status = 1");
    const [[b]] = await hrms.query(
      "SELECT COUNT(*) n FROM cost_centre_master WHERE active_status = 1 AND (billing_client_name IS NULL OR billing_client_name = '')"
    );
    ccActiveTotal = a.n;
    ccActiveMissing = b.n;
  } catch (e) {
    ccActiveTotal = `ERR: ${e.code || e.message}`;
  }
  out.cost_centre_active_total = ccActiveTotal;
  out.cost_centre_active_missing_billing_client_name = ccActiveMissing;

  // 5. branch_master gst_state_code nulls
  const [branchNulls] = await hrms.query(
    "SELECT id, branch_name, branch_code FROM branch_master WHERE gst_state_code IS NULL"
  );
  out.branches_missing_gst_state_code = branchNulls;

  // 6. existing invoices exposed to wrong/blank client name or blank state
  const [[exposed]] = await hrms.query(`
    SELECT COUNT(*) n
    FROM client_invoice ci
    JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id
    LEFT JOIN branch_master b ON b.id = cc.branch_id
    WHERE (cc.billing_client_name IS NULL OR cc.billing_client_name = '')
       OR b.gst_state_code IS NULL
  `);
  out.invoices_exposed_to_wrong_or_blank_pdf_fields = exposed.n;

  // 7. invoices with zero line items
  const [[zeroLines]] = await hrms.query(`
    SELECT COUNT(*) n FROM client_invoice ci
    WHERE NOT EXISTS (SELECT 1 FROM client_invoice_line l WHERE l.invoice_id = ci.id)
  `);
  out.invoices_with_zero_line_items = zeroLines.n;

  // 8. spot check 3 migrated invoices vs db_bill
  const [sample] = await hrms.query(`
    SELECT id, legacy_id, proforma_no, bill_no, grand_total, cost_centre_id
    FROM client_invoice
    WHERE is_migrated = 1 AND legacy_id IS NOT NULL
    ORDER BY RAND() LIMIT 3
  `);
  out.spot_check = [];
  for (const row of sample) {
    try {
      const [[legacyRow]] = await bill.query(
        "SELECT id, grnd, cost_center, cost_client_tally_name FROM tbl_invoice WHERE id = ?",
        [row.legacy_id]
      );
      out.spot_check.push({ hrms: row, legacy: legacyRow || null });
    } catch (e) {
      out.spot_check.push({ hrms: row, legacy: `ERR: ${e.code || e.message}` });
    }
  }

  console.log(JSON.stringify(out, null, 2));

  await hrms.end();
  await bill.end();
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
