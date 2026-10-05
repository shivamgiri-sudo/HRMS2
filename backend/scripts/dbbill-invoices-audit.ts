/**
 * db_bill invoice-level listing, Mar-Oct 2026. READ-ONLY (billQuery = SELECT only).
 * One output line per invoice so individual cost-centre/month differences vs the MAS sheet can be explained.
 *
 *   npx tsx scripts/dbbill-invoices-audit.ts
 */
import "dotenv/config";
import { billQuery } from "../src/db/billDb.js";

(async () => {
  const rows = await billQuery<any>(
    `SELECT id, bill_no, proforma_bill_no pbn, DATE_FORMAT(invoiceDate,'%Y-%m-%d') idate, TRIM(month) svc, TRIM(cost_company_name) company,
            TRIM(branch_name) branch, TRIM(cost_center) cc, TRIM(cost_process_name) pname, TRIM(cost_client) client, LEFT(invoiceDescription,60) descr,
            CAST(total AS DECIMAL(16,2)) total, CAST(grnd AS DECIMAL(16,2)) grnd, status, invoiceType itype, CurrentInvoiceType cur, InvoiceTypeApproval appr, category, proforma_approve pa
       FROM tbl_invoice
      WHERE invoiceDate >= '2026-03-01' AND invoiceDate < '2026-11-01'
      ORDER BY cc, invoiceDate, id`);
  for (const r of rows) console.log("DBB_INV " + JSON.stringify(r));
  await new Promise((resolve) => process.stdout.write("DBB_DONE\n", resolve));
  process.exit(0);
})();
