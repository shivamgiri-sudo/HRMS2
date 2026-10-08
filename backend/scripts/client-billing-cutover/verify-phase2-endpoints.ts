/**
 * Phase 2 verification — exercise the new summary/filter/pagination/export SQL directly
 * against live data (not through HTTP, to avoid needing a running server + auth token).
 * READ-ONLY.
 */
import "dotenv/config";
import { db } from "../../src/db/mysql.js";

async function main() {
  // Summary aggregates
  const [invoiceRows] = await db.execute<any[]>(
    `SELECT invoice_status, COUNT(*) AS count, COALESCE(SUM(grand_total), 0) AS total
     FROM client_invoice GROUP BY invoice_status`
  );
  console.log("Invoice status aggregates:", invoiceRows);

  const [[thisMonth]] = await db.execute<any[]>(
    `SELECT COUNT(*) AS count, COALESCE(SUM(grand_total), 0) AS total
     FROM client_invoice
     WHERE invoice_status = 'approved'
       AND DATE_FORMAT(invoice_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')`
  );
  console.log("This month billed:", thisMonth);

  // Filtered + paginated list (status=approved, page 2, limit 10)
  const [pageRows] = await db.query<any[]>(
    `SELECT ci.bill_no, ci.invoice_status, ci.grand_total,
            COALESCE(NULLIF(cc.billing_client_name, ''), cc.company_name) AS cost_centre_display_name
     FROM client_invoice ci
     LEFT JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id
     WHERE ci.invoice_status = 'approved'
     ORDER BY ci.created_at DESC
     LIMIT ? OFFSET ?`,
    [10, 10]
  );
  console.log(`Page 2 (limit 10) approved invoices: ${pageRows.length} rows`);
  console.log(pageRows.slice(0, 3));

  const [[countRow]] = await db.execute<any[]>(
    `SELECT COUNT(*) AS total FROM client_invoice ci
     LEFT JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id
     WHERE ci.invoice_status = 'approved'`
  );
  console.log("Total approved count:", countRow.total);

  // Search filter
  const [searchRows] = await db.query<any[]>(
    `SELECT ci.bill_no, ci.proforma_no FROM client_invoice ci
     LEFT JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id
     WHERE (ci.proforma_no LIKE ? OR ci.bill_no LIKE ? OR cc.billing_client_name LIKE ? OR cc.company_name LIKE ?)
     LIMIT 5`,
    ["%Vodafone%", "%Vodafone%", "%Vodafone%", "%Vodafone%"]
  );
  console.log(`Search "Vodafone" matched ${searchRows.length} rows (sample):`, searchRows);

  // Credit note filtered list
  const [cnRows] = await db.query<any[]>(
    `SELECT ccn.credit_no, ccn.credit_status, COALESCE(ci.bill_no, ci.proforma_no) AS against_invoice_number
     FROM client_credit_note ccn
     LEFT JOIN cost_centre_master cc ON cc.id = ccn.cost_centre_id
     LEFT JOIN client_invoice ci ON ci.id = ccn.invoice_id
     WHERE ccn.credit_status = 'approved'
     ORDER BY ccn.created_at DESC
     LIMIT 5`
  );
  console.log(`Credit notes (approved), sample: ${cnRows.length} rows`, cnRows);

  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
