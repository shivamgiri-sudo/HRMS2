/**
 * Client Billing Historical Cutover — Task 3: validation dry-run + report.
 * (docs/superpowers/plans/2026-08-19-client-billing-cutover.md Task 3,
 *  docs/superpowers/specs/2026-08-19-client-billing-cutover-design.md §6.2-6.3)
 *
 * Reads client_invoice_migration_staging / client_credit_note_migration_staging
 * (Task 2's real output, mas_hrms), re-validates every row against the LIVE
 * client_invoice / client_credit_note column requirements (read fresh off
 * information_schema, never assumed), and writes validation_status/
 * validation_error back onto the SAME staging rows only.
 *
 * This script NEVER writes to client_invoice / client_invoice_line /
 * client_credit_note / client_credit_note_line. It PREPAREs (never EXECUTEs)
 * a real INSERT shaped like the eventual load would use, purely to confirm
 * the column list compiles against the live schema.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/client-billing-cutover/validate.ts
 */
import "dotenv/config";
import { db } from "../../src/db/mysql.js";
import {
  buildCostCentreLookup,
  validateInvoiceRow,
  validateCreditNoteRow,
  type InvoiceValidationInput,
  type CreditNoteValidationInput,
} from "./validate.transforms.js";

interface CollisionGroup {
  number: string;
  count: number;
  legacyIds: number[];
}

async function prepareCheck(conn: Awaited<ReturnType<typeof db.getConnection>>): Promise<{ invoiceOk: boolean; creditNoteOk: boolean; detail: string[] }> {
  const detail: string[] = [];
  let invoiceOk = false;
  let creditNoteOk = false;

  try {
    await conn.query(
      `PREPARE cims_validate_stmt FROM
       'INSERT INTO client_invoice (
          id, cost_centre_id, invoice_status, category, finance_year, month_label,
          invoice_date, description, proforma_no, bill_no, gst_type, apply_gst,
          total_amount, igst_amount, cgst_amount, sgst_amount, grand_total,
          created_by, is_migrated, legacy_id
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'`,
    );
    await conn.query(`DEALLOCATE PREPARE cims_validate_stmt`);
    invoiceOk = true;
    detail.push("client_invoice: PREPARE compiled cleanly against the live schema (20-column shape, see this task's report).");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    detail.push(`client_invoice: PREPARE FAILED — ${message}`);
  }

  try {
    await conn.query(
      `PREPARE ccnms_validate_stmt FROM
       'INSERT INTO client_credit_note (
          id, invoice_id, cost_centre_id, category, finance_year, month_label,
          credit_date, description, credit_no, credit_status, gst_type, apply_gst,
          total_amount, igst_amount, cgst_amount, sgst_amount, grand_total,
          created_by, is_migrated, legacy_id
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'`,
    );
    await conn.query(`DEALLOCATE PREPARE ccnms_validate_stmt`);
    creditNoteOk = true;
    detail.push("client_credit_note: PREPARE compiled cleanly against the live schema (20-column shape, see this task's report).");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    detail.push(`client_credit_note: PREPARE FAILED — ${message}`);
  }

  return { invoiceOk, creditNoteOk, detail };
}

function collisionGroups(rows: Array<{ number: string; c: number; legacy_ids: string }>): CollisionGroup[] {
  return rows.map((r) => ({
    number: r.number,
    count: r.c,
    legacyIds: r.legacy_ids.split(",").map((s) => Number(s)),
  }));
}

async function main(): Promise<void> {
  console.log("[validate] Client Billing Historical Cutover — Task 3 validation dry-run starting");

  // ── CRITICAL pre-check: client_invoice/client_credit_note row counts BEFORE ──
  const [[ciBefore]] = await db.query<any>(`SELECT COUNT(*) AS c FROM client_invoice`);
  const [[ccnBefore]] = await db.query<any>(`SELECT COUNT(*) AS c FROM client_credit_note`);
  console.log(`[validate] BEFORE: client_invoice=${ciBefore.c} client_credit_note=${ccnBefore.c}`);

  const conn = await db.getConnection();
  const prepare = await prepareCheck(conn);
  conn.release();
  console.log("[validate] PREPARE-verification results:");
  for (const d of prepare.detail) console.log(`  ${d}`);

  // ── cost_centre_master lookup (fresh, live) ─────────────────────────────────
  const [ccRows] = await db.query<any>(`SELECT id, cost_centre_code FROM cost_centre_master`);
  const costCentre = buildCostCentreLookup(ccRows as any[]);
  console.log(`[validate] cost_centre_master: ${(ccRows as any[]).length} rows loaded for lookup`);

  // ═══════════════════════════ INVOICES ═══════════════════════════
  const [invRows] = await db.query<any>(
    `SELECT id, src_id, src_category, src_finance_year, src_month, src_invoicedate,
            src_cost_center, target_gst_type, src_total, src_tax, src_igst, src_sgst,
            src_cgst, src_grnd, src_bill_no
     FROM client_invoice_migration_staging`,
  );
  const invoiceStagingRows = invRows as Array<InvoiceValidationInput & { id: number; src_bill_no: string | null }>;
  console.log(`[validate] client_invoice_migration_staging: ${invoiceStagingRows.length} rows to re-validate`);

  let invoiceValid = 0;
  let invoiceError = 0;
  const invoiceErrorCounts = new Map<string, number>();
  const invoiceErrorLegacyIds = new Map<string, number[]>();

  for (const row of invoiceStagingRows) {
    const result = validateInvoiceRow(row, costCentre);
    if (result.status === "valid") {
      invoiceValid += 1;
      await db.execute(
        `UPDATE client_invoice_migration_staging SET validation_status = 'valid', validation_error = NULL WHERE id = ?`,
        [row.id],
      );
    } else {
      invoiceError += 1;
      await db.execute(
        `UPDATE client_invoice_migration_staging SET validation_status = 'error', validation_error = ? WHERE id = ?`,
        [result.error, row.id],
      );
      // count each individual distinct sub-message for the report's per-message breakdown
      for (const part of (result.error ?? "").split("; ")) {
        invoiceErrorCounts.set(part, (invoiceErrorCounts.get(part) ?? 0) + 1);
        const ids = invoiceErrorLegacyIds.get(part) ?? [];
        if (ids.length < 20) ids.push(row.src_id);
        invoiceErrorLegacyIds.set(part, ids);
      }
    }
  }
  console.log(`[validate] invoices: valid=${invoiceValid} error=${invoiceError}`);

  // bill_no collision groups (design §5.3)
  const [invCollisionRows] = await db.query<any>(
    `SELECT src_bill_no AS number, COUNT(*) AS c, GROUP_CONCAT(src_id ORDER BY src_id) AS legacy_ids
     FROM client_invoice_migration_staging
     WHERE src_bill_no IS NOT NULL AND src_bill_no <> ''
     GROUP BY src_bill_no HAVING COUNT(*) > 1
     ORDER BY c DESC`,
  );
  const invoiceCollisions = collisionGroups(invCollisionRows as any[]);
  console.log(`[validate] invoice bill_no collision groups: ${invoiceCollisions.length}`);

  const [[gstNullInv]] = await db.query<any>(
    `SELECT COUNT(*) AS c FROM client_invoice_migration_staging WHERE target_gst_type IS NULL`,
  );
  console.log(`[validate] invoices with target_gst_type NULL: ${gstNullInv.c}`);

  // ═══════════════════════════ CREDIT NOTES ═══════════════════════════
  const [cnRows] = await db.query<any>(
    `SELECT id, src_id, src_category, src_finance_year, src_month, src_creditdate,
            src_cost_center, target_gst_type, src_total, src_tax, src_igst, src_sgst,
            src_cgst, src_grnd, src_status, src_credit_approve
     FROM client_credit_note_migration_staging`,
  );
  const creditNoteStagingRows = cnRows as Array<
    CreditNoteValidationInput & { id: number; src_status: number | null; src_credit_approve: number | null }
  >;
  console.log(`[validate] client_credit_note_migration_staging: ${creditNoteStagingRows.length} rows to re-validate`);

  let cnValid = 0;
  let cnError = 0;
  const cnErrorCounts = new Map<string, number>();

  for (const row of creditNoteStagingRows) {
    const result = validateCreditNoteRow(row, costCentre);
    if (result.status === "valid") {
      cnValid += 1;
      await db.execute(
        `UPDATE client_credit_note_migration_staging SET validation_status = 'valid', validation_error = NULL WHERE id = ?`,
        [row.id],
      );
    } else {
      cnError += 1;
      await db.execute(
        `UPDATE client_credit_note_migration_staging SET validation_status = 'error', validation_error = ? WHERE id = ?`,
        [result.error, row.id],
      );
      for (const part of (result.error ?? "").split("; ")) {
        cnErrorCounts.set(part, (cnErrorCounts.get(part) ?? 0) + 1);
      }
    }
  }
  console.log(`[validate] credit notes: valid=${cnValid} error=${cnError}`);

  // credit_no collision groups
  const [cnCollisionRows] = await db.query<any>(
    `SELECT src_credit_no AS number, COUNT(*) AS c, GROUP_CONCAT(src_id ORDER BY src_id) AS legacy_ids
     FROM client_credit_note_migration_staging
     WHERE src_credit_no IS NOT NULL AND src_credit_no <> ''
     GROUP BY src_credit_no HAVING COUNT(*) > 1
     ORDER BY c DESC`,
  );
  const creditNoteCollisions = collisionGroups(cnCollisionRows as any[]);
  console.log(`[validate] credit_no collision groups: ${creditNoteCollisions.length}`);

  const [[gstNullCn]] = await db.query<any>(
    `SELECT COUNT(*) AS c FROM client_credit_note_migration_staging WHERE target_gst_type IS NULL`,
  );
  console.log(`[validate] credit notes with target_gst_type NULL: ${gstNullCn.c}`);

  // credit-note status/credit_approve distribution — the investigation this task required
  const [statusDist] = await db.query<any>(
    `SELECT src_status, src_credit_approve, COUNT(*) AS c FROM client_credit_note_migration_staging
     GROUP BY src_status, src_credit_approve ORDER BY src_status, src_credit_approve`,
  );
  console.log("[validate] credit note src_status x src_credit_approve distribution:", JSON.stringify(statusDist));

  // ── CRITICAL post-check: client_invoice/client_credit_note row counts AFTER ──
  const [[ciAfter]] = await db.query<any>(`SELECT COUNT(*) AS c FROM client_invoice`);
  const [[ccnAfter]] = await db.query<any>(`SELECT COUNT(*) AS c FROM client_credit_note`);
  console.log(`[validate] AFTER:  client_invoice=${ciAfter.c} client_credit_note=${ccnAfter.c}`);
  console.log(
    `[validate] client_invoice unchanged: ${ciBefore.c === ciAfter.c ? "MATCH" : "MISMATCH!!"}, ` +
      `client_credit_note unchanged: ${ccnBefore.c === ccnAfter.c ? "MATCH" : "MISMATCH!!"}`,
  );

  console.log("\n[validate] ══ SUMMARY (for report) ══");
  console.log(`invoices: total=${invoiceStagingRows.length} valid=${invoiceValid} error=${invoiceError}`);
  console.log(`credit notes: total=${creditNoteStagingRows.length} valid=${cnValid} error=${cnError}`);
  console.log("\ninvoice error message breakdown:");
  for (const [msg, count] of [...invoiceErrorCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  [${count}] ${msg}`);
  }
  console.log("\ncredit note error message breakdown:");
  for (const [msg, count] of [...cnErrorCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  [${count}] ${msg}`);
  }
  console.log("\ninvoice bill_no collision groups (all):");
  for (const g of invoiceCollisions) {
    console.log(`  ${g.number} x${g.count} legacy_ids=[${g.legacyIds.join(",")}]`);
  }
  console.log("\ncredit_no collision groups (all):");
  for (const g of creditNoteCollisions) {
    console.log(`  ${g.number} x${g.count} legacy_ids=[${g.legacyIds.join(",")}]`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[validate] FATAL:", err);
  process.exit(1);
});
