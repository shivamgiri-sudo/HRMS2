/**
 * Client Billing Historical Cutover — Task 3: validation dry-run + report.
 * (docs/superpowers/plans/2026-08-19-client-billing-cutover.md Task 3,
 *  docs/superpowers/specs/2026-08-19-client-billing-cutover-design.md §6.2-6.3)
 *
 * Extended 2026-08-19 by the design addendum (A1-A4 —
 * docs/superpowers/specs/2026-08-19-client-billing-cutover-addendum.md): before
 * re-validating, this script now also APPLIES the addendum's four approved
 * decisions directly onto the staging rows' own computed columns:
 *   A1 — derives a real gst_type/apply_gst (Integrated/Intrastate/'Not
 *        Applicable') for every row still holding target_gst_type IS NULL,
 *        via computeGstType() (extract.transforms.ts), reusing the exact
 *        cost_centre_master.branch_id -> branch_master.gst_state_code
 *        comparison client-billing.service.ts's createProforma() already uses.
 *   A2 — defaults any remaining blank src_category to 'Others'.
 *   A3 — resolves target_cost_centre_id for every row whose src_cost_center
 *        matches cost_centre_master.cost_centre_code (live, re-confirmed).
 *   A4 — resolves target_invoice_id for credit notes whose proforma_bill_no
 *        uniquely matches a staged invoice's bill_no with agreeing cost
 *        centres, via matchCreditNoteInvoice() (validate.transforms.ts).
 *
 * Reads client_invoice_migration_staging / client_credit_note_migration_staging
 * (Task 2's real output, mas_hrms), re-validates every row against the LIVE
 * client_invoice / client_credit_note column requirements (read fresh off
 * information_schema, never assumed), and writes validation_status/
 * validation_error (plus, now, target_gst_type/target_apply_gst/
 * target_cost_centre_id/target_invoice_id) back onto the SAME staging rows only.
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
import { computeGstType, normalizeCategory } from "./extract.transforms.js";
import {
  buildCostCentreLookup,
  buildBranchStateCodeLookup,
  resolveBranchStateCode,
  buildInvoiceBillNoIndex,
  matchCreditNoteInvoice,
  validateInvoiceRow,
  validateCreditNoteRow,
  type InvoiceValidationInput,
  type CreditNoteValidationInput,
  type InvoiceMatchResult,
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
  console.log("[validate] Applying 2026-08-19 design addendum A1-A4 before re-validating.");

  // ── CRITICAL pre-check: client_invoice/client_credit_note row counts BEFORE ──
  const [[ciBefore]] = await db.query<any>(`SELECT COUNT(*) AS c FROM client_invoice`);
  const [[ccnBefore]] = await db.query<any>(`SELECT COUNT(*) AS c FROM client_credit_note`);
  console.log(`[validate] BEFORE: client_invoice=${ciBefore.c} client_credit_note=${ccnBefore.c}`);

  const conn = await db.getConnection();
  const prepare = await prepareCheck(conn);
  conn.release();
  console.log("[validate] PREPARE-verification results:");
  for (const d of prepare.detail) console.log(`  ${d}`);

  // ── cost_centre_master + branch_master lookups (fresh, live) — A1/A3 ────────
  const [ccRows] = await db.query<any>(`SELECT id, cost_centre_code, branch_id FROM cost_centre_master`);
  const costCentre = buildCostCentreLookup(ccRows as any[]);
  console.log(`[validate] cost_centre_master: ${(ccRows as any[]).length} rows loaded for lookup`);

  const [branchRows] = await db.query<any>(`SELECT id, gst_state_code FROM branch_master`);
  const branchStateCodes = buildBranchStateCodeLookup(branchRows as any[]);
  console.log(`[validate] branch_master: ${(branchRows as any[]).length} rows loaded for gst_state_code lookup`);

  // ═══════════════════════ A2: category default (both tables) ════════════════
  const [catFixInv] = await db.execute<any>(
    `UPDATE client_invoice_migration_staging SET src_category = ? WHERE src_category IS NULL OR TRIM(src_category) = ''`,
    [normalizeCategory(null)],
  );
  const [catFixCn] = await db.execute<any>(
    `UPDATE client_credit_note_migration_staging SET src_category = ? WHERE src_category IS NULL OR TRIM(src_category) = ''`,
    [normalizeCategory(null)],
  );
  console.log(
    `[validate] A2: category defaulted to '${normalizeCategory(null)}' — invoices affected=${(catFixInv as any).affectedRows ?? "?"}, credit notes affected=${(catFixCn as any).affectedRows ?? "?"}`,
  );

  // ═══════════════════════ A3: cost_centre_id resolution (both tables) ═══════
  async function applyCostCentreResolution(table: "client_invoice_migration_staging" | "client_credit_note_migration_staging"): Promise<{ resolved: number; unresolved: number }> {
    const [rows] = await db.query<any>(`SELECT id, src_cost_center FROM ${table}`);
    let resolved = 0;
    let unresolved = 0;
    for (const row of rows as Array<{ id: number; src_cost_center: string | null }>) {
      const code = (row.src_cost_center ?? "").trim();
      const targetCostCentreId = code !== "" ? costCentre.get(code) ?? null : null;
      if (targetCostCentreId) resolved += 1;
      else unresolved += 1;
      await db.execute(`UPDATE ${table} SET target_cost_centre_id = ? WHERE id = ?`, [targetCostCentreId, row.id]);
    }
    return { resolved, unresolved };
  }
  const invCcResolution = await applyCostCentreResolution("client_invoice_migration_staging");
  const cnCcResolution = await applyCostCentreResolution("client_credit_note_migration_staging");
  console.log(
    `[validate] A3: cost_centre_id resolved — invoices resolved=${invCcResolution.resolved} unresolved=${invCcResolution.unresolved}, credit notes resolved=${cnCcResolution.resolved} unresolved=${cnCcResolution.unresolved}`,
  );

  // ═══════════════════════ A1: gst_type derivation — invoices ════════════════
  const [invGstRows] = await db.query<any>(
    `SELECT id, src_gsttype, target_gst_type, src_cost_vendorgstno, src_cost_center
     FROM client_invoice_migration_staging WHERE target_gst_type IS NULL`,
  );
  let invIntrastate = 0, invIntegrated = 0, invNotApplicable = 0;
  for (const row of invGstRows as Array<{ id: number; src_gsttype: string | null; src_cost_vendorgstno: string | null; src_cost_center: string | null }>) {
    const branchStateCode = resolveBranchStateCode(row.src_cost_center, costCentre, branchStateCodes);
    const gst = computeGstType({ gstTypeRaw: row.src_gsttype, vendorGstin: row.src_cost_vendorgstno, branchStateCode });
    if (gst.target_gst_type === "Intrastate") invIntrastate += 1;
    else if (gst.target_gst_type === "Integrated") invIntegrated += 1;
    else invNotApplicable += 1;
    await db.execute(
      `UPDATE client_invoice_migration_staging SET target_gst_type = ?, target_apply_gst = ? WHERE id = ?`,
      [gst.target_gst_type, gst.target_apply_gst, row.id],
    );
  }
  console.log(
    `[validate] A1 (invoices): ${(invGstRows as any[]).length} blank-GSTType rows resolved — Intrastate=${invIntrastate} Integrated=${invIntegrated} 'Not Applicable'=${invNotApplicable}`,
  );

  // ═══════════════════════ A4: credit_note -> invoice matching ═══════════════
  const [invBillRows] = await db.query<any>(
    `SELECT target_id, src_bill_no, src_cost_center, src_cost_vendorgstno FROM client_invoice_migration_staging`,
  );
  const billIndex = buildInvoiceBillNoIndex(invBillRows as any[]);
  const invoiceVendorGstinByTargetId = new Map<string, string | null>();
  for (const r of invBillRows as Array<{ target_id: string; src_cost_vendorgstno: string | null }>) {
    invoiceVendorGstinByTargetId.set(r.target_id, r.src_cost_vendorgstno);
  }

  const [cnMatchRows] = await db.query<any>(
    `SELECT id, src_proforma_bill_no, src_cost_center FROM client_credit_note_migration_staging`,
  );
  const invoiceMatchByStagingId = new Map<number, InvoiceMatchResult>();
  let a4Resolved = 0, a4Ambiguous = 0, a4Unresolved = 0;
  for (const row of cnMatchRows as Array<{ id: number; src_proforma_bill_no: string | null; src_cost_center: string | null }>) {
    const match = matchCreditNoteInvoice(row.src_proforma_bill_no, row.src_cost_center, billIndex, invoiceVendorGstinByTargetId);
    invoiceMatchByStagingId.set(row.id, match);
    if (match.status === "resolved") a4Resolved += 1;
    else if (match.status === "ambiguous") a4Ambiguous += 1;
    else a4Unresolved += 1;
    await db.execute(
      `UPDATE client_credit_note_migration_staging SET target_invoice_id = ? WHERE id = ?`,
      [match.targetInvoiceId, row.id],
    );
  }
  console.log(`[validate] A4: credit notes -> invoice matching — resolved=${a4Resolved} ambiguous=${a4Ambiguous} unresolved=${a4Unresolved}`);

  // ═══════════════════════ A1: gst_type derivation — credit notes ════════════
  // tbl_credit_note never carried its own vendor-GSTIN column (1305's own header:
  // the ~70 cost_*/eptp_*/InvoiceType* columns tbl_invoice has simply don't exist
  // here) — so a credit note's GSTIN, when derivable at all, comes from its own
  // A4-matched invoice's src_cost_vendorgstno (same real GSTIN the vendor was
  // actually billed under). An unmatched credit note has no GSTIN to derive from
  // and falls to 'Not Applicable', same as any other undecidable row.
  const [cnGstRows] = await db.query<any>(
    `SELECT id, src_gsttype, target_gst_type, src_cost_center FROM client_credit_note_migration_staging WHERE target_gst_type IS NULL`,
  );
  let cnIntrastate = 0, cnIntegrated = 0, cnNotApplicable = 0;
  for (const row of cnGstRows as Array<{ id: number; src_gsttype: string | null; src_cost_center: string | null }>) {
    const match = invoiceMatchByStagingId.get(row.id);
    const vendorGstin = match?.status === "resolved" ? match.vendorGstin : null;
    const branchStateCode = resolveBranchStateCode(row.src_cost_center, costCentre, branchStateCodes);
    const gst = computeGstType({ gstTypeRaw: row.src_gsttype, vendorGstin, branchStateCode });
    if (gst.target_gst_type === "Intrastate") cnIntrastate += 1;
    else if (gst.target_gst_type === "Integrated") cnIntegrated += 1;
    else cnNotApplicable += 1;
    await db.execute(
      `UPDATE client_credit_note_migration_staging SET target_gst_type = ?, target_apply_gst = ? WHERE id = ?`,
      [gst.target_gst_type, gst.target_apply_gst, row.id],
    );
  }
  console.log(
    `[validate] A1 (credit notes): ${(cnGstRows as any[]).length} blank-GSTType rows resolved — Intrastate=${cnIntrastate} Integrated=${cnIntegrated} 'Not Applicable'=${cnNotApplicable}`,
  );

  // ═══════════════════════════ INVOICES — re-validate ═══════════════════════
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
  console.log(`[validate] invoices with target_gst_type NULL (post-A1, should be 0): ${gstNullInv.c}`);

  // ═══════════════════════════ CREDIT NOTES — re-validate ═══════════════════
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
    const match = invoiceMatchByStagingId.get(row.id) ?? {
      status: "unresolved" as const,
      targetInvoiceId: null,
      vendorGstin: null,
      error: "invoice_id unresolvable - no proforma_bill_no recorded",
    };
    const result = validateCreditNoteRow(row, costCentre, match);
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
  console.log(`[validate] credit notes with target_gst_type NULL (post-A1, should be 0): ${gstNullCn.c}`);

  // credit-note status/credit_approve distribution — the investigation this task required
  const [statusDist] = await db.query<any>(
    `SELECT src_status, src_credit_approve, COUNT(*) AS c FROM client_credit_note_migration_staging
     GROUP BY src_status, src_credit_approve ORDER BY src_status, src_credit_approve`,
  );
  console.log("[validate] credit note src_status x src_credit_approve distribution:", JSON.stringify(statusDist));

  // ── Set-based SQL cross-checks (independent of the per-row loop above) ──────
  const [[setInvValid]] = await db.query<any>(
    `SELECT COUNT(*) AS c FROM client_invoice_migration_staging WHERE validation_status = 'valid'`,
  );
  const [[setInvError]] = await db.query<any>(
    `SELECT COUNT(*) AS c FROM client_invoice_migration_staging WHERE validation_status = 'error'`,
  );
  const [[setCnValid]] = await db.query<any>(
    `SELECT COUNT(*) AS c FROM client_credit_note_migration_staging WHERE validation_status = 'valid'`,
  );
  const [[setCnError]] = await db.query<any>(
    `SELECT COUNT(*) AS c FROM client_credit_note_migration_staging WHERE validation_status = 'error'`,
  );
  console.log(
    `[validate] set-based cross-check: invoices valid=${setInvValid.c} error=${setInvError.c} (per-row said valid=${invoiceValid} error=${invoiceError}) ${
      setInvValid.c === invoiceValid && setInvError.c === invoiceError ? "MATCH" : "MISMATCH!!"
    }`,
  );
  console.log(
    `[validate] set-based cross-check: credit notes valid=${setCnValid.c} error=${setCnError.c} (per-row said valid=${cnValid} error=${cnError}) ${
      setCnValid.c === cnValid && setCnError.c === cnError ? "MATCH" : "MISMATCH!!"
    }`,
  );
  const [[setA3InvResolved]] = await db.query<any>(
    `SELECT COUNT(*) AS c FROM client_invoice_migration_staging WHERE target_cost_centre_id IS NOT NULL`,
  );
  const [[setA4Resolved]] = await db.query<any>(
    `SELECT COUNT(*) AS c FROM client_credit_note_migration_staging WHERE target_invoice_id IS NOT NULL`,
  );
  console.log(
    `[validate] set-based cross-check: A3 invoices with target_cost_centre_id set=${setA3InvResolved.c} (per-row said resolved=${invCcResolution.resolved}) ${
      setA3InvResolved.c === invCcResolution.resolved ? "MATCH" : "MISMATCH!!"
    }`,
  );
  console.log(
    `[validate] set-based cross-check: A4 credit notes with target_invoice_id set=${setA4Resolved.c} (per-row said resolved=${a4Resolved}) ${
      setA4Resolved.c === a4Resolved ? "MATCH" : "MISMATCH!!"
    }`,
  );

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
