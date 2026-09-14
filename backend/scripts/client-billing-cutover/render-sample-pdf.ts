/**
 * Phase 1 verification — render a real invoice + credit note PDF (both letterhead
 * variants) from live data, to visually confirm the rewritten renderer against the
 * user-supplied reference sample. READ-ONLY against the DB; writes PDFs to the
 * scratchpad only.
 */
import "dotenv/config";
import fs from "node:fs";
import { db } from "../../src/db/mysql.js";
import { clientBillingPdfService } from "../../src/modules/client-billing/client-billing-pdf.service.js";

const OUT_DIR = process.argv[2] || ".";

async function main() {
  const [invoiceRows] = await db.query(`
    SELECT ci.id, ci.bill_no, ci.proforma_no FROM client_invoice ci
    JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id
    WHERE cc.service_tax_no IS NOT NULL AND cc.service_tax_no != ''
      AND ci.invoice_status = 'approved'
    ORDER BY RAND() LIMIT 1
  `);
  const invoice = (invoiceRows as any[])[0];
  console.log("Rendering invoice:", invoice);

  const withLetterhead = await clientBillingPdfService.generateInvoicePdf(invoice.id, true);
  fs.writeFileSync(`${OUT_DIR}/sample-invoice-letterhead.pdf`, withLetterhead);
  const withoutLetterhead = await clientBillingPdfService.generateInvoicePdf(invoice.id, false);
  fs.writeFileSync(`${OUT_DIR}/sample-invoice-plain.pdf`, withoutLetterhead);
  console.log("Wrote sample-invoice-letterhead.pdf and sample-invoice-plain.pdf");

  const [cnRows] = await db.query(`
    SELECT cn.id, cn.credit_no FROM client_credit_note cn
    JOIN cost_centre_master cc ON cc.id = cn.cost_centre_id
    WHERE cc.service_tax_no IS NOT NULL AND cc.service_tax_no != ''
    ORDER BY RAND() LIMIT 1
  `);
  const cn = (cnRows as any[])[0];
  if (cn) {
    console.log("Rendering credit note:", cn);
    const cnPdf = await clientBillingPdfService.generateCreditNotePdf(cn.id, true);
    fs.writeFileSync(`${OUT_DIR}/sample-credit-note-letterhead.pdf`, cnPdf);
    console.log("Wrote sample-credit-note-letterhead.pdf");
  } else {
    console.log("No credit note found with a populated-GSTIN cost centre — skipping.");
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
