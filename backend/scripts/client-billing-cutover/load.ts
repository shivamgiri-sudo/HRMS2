/**
 * Client Billing Historical Cutover — Task 4: load function.
 * (docs/superpowers/plans/2026-08-19-client-billing-cutover.md Task 4,
 *  docs/superpowers/specs/2026-08-19-client-billing-cutover-design.md §6.4,
 *  docs/superpowers/specs/2026-08-19-client-billing-cutover-addendum.md A1-A4)
 *
 * ══════════════════════════════════════════════════════════════════════════
 * HARD STOP — READ BEFORE EVER CALLING loadValidatedRows FOR REAL
 *
 * This module is written and unit-tested against fixtures ONLY. It has never
 * been invoked against the real `mas_hrms` connection, is not imported by any
 * script, migration, cron, worker, or startup path, and is not reachable from
 * any route. Per design §9 / CLAUDE.md's migration-approval rule, the actual
 * production write of ~11,469 rows into client_invoice/client_invoice_line/
 * client_credit_note/client_credit_note_line requires a separate, explicit
 * human go-ahead that has not happened yet. Do not add a call site for this
 * function without that sign-off.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Consumes client_invoice_migration_staging / client_credit_note_migration_staging
 * rows where validation_status = 'valid' (Task 3's real output, addendum-applied).
 * Produces (only when a human-authorized caller eventually runs this for real)
 * rows in client_invoice / client_invoice_line / client_credit_note /
 * client_credit_note_line.
 *
 * ── Transaction granularity (design §6.4) ────────────────────────────────────
 * One transaction PER legacy row, not one giant transaction for the whole
 * batch. A mid-migration failure only needs to resume from where it stopped,
 * not roll back everything already loaded. loadValidatedRows therefore takes a
 * `db`-like object exposing getConnection() (same shape as ../../src/db/mysql.js's
 * `db` export) rather than a single already-open `conn` — it acquires and
 * commits/rolls back a fresh connection for every row it loads.
 *
 * ── Idempotency (design §3/§6.4) ──────────────────────────────────────────────
 * The header row (client_invoice / client_credit_note) is written via
 * `INSERT ... ON DUPLICATE KEY UPDATE`, keyed on the `legacy_id` unique index
 * added by migration 1304/1305 — the exact mechanism the design doc itself
 * recommends, and the same idempotency pattern extract.ts already uses for the
 * staging tables (keyed on src_id there). Re-running the load against an
 * already-loaded legacy_id updates the same row in place rather than
 * duplicating it. The line item, however, has no natural unique key to hang an
 * ON DUPLICATE KEY UPDATE off (client_invoice_line.id is a fresh random UUID
 * every time, and this migration deliberately does not add a unique
 * (invoice_id) index to that table — a real future invoice can and does carry
 * multiple lines). So idempotency for the line item is instead an explicit
 * existence check: after the header UPSERT, count existing
 * client_invoice_line/client_credit_note_line rows for that header id, and
 * only insert the synthesized line when none exist yet. This is a hand-rolled
 * check rather than a schema-level guarantee, but it is scoped to a single
 * legacy row's own transaction, so a concurrent second run of the same row is
 * still safe (each run's SELECT+INSERT happens inside its own transaction,
 * and re-running is a maintenance operation done by one operator at a time,
 * never concurrently with itself, unlike the live create-invoice path this
 * design deliberately does not touch).
 *
 * ── Line-item synthesis (this task's own decision, not in the design doc) ────
 * Legacy `tbl_invoice`/`tbl_credit_note` are HEADER-ONLY rows — a single
 * aggregate `total`/`tax`/`igst`/`sgst`/`cgst`/`grnd` per row, with no
 * legacy line-item table at all (confirmed: neither 1304's nor 1305's
 * from-live-information_schema staging column list contains anything
 * resembling a line-items child table, and the design doc's own §6.4 mechanics
 * section never mentions one). The new schema's client_invoice_line/
 * client_credit_note_line, by contrast, model a real invoice as N distinct
 * charge/deduction lines that SUM to total_amount. There is no way to recover
 * N real historical lines from a source that never recorded them — inventing
 * a breakdown that never existed would be fabricating data, not migrating it.
 * Decision: synthesize exactly ONE line item per migrated header, with
 * `qty = 1`, `rate = amount = total_amount` (the same base/taxable figure
 * already stored on the header, taken verbatim from legacy's own `total`
 * column per design §7 — never recomputed), and `particulars` set to a
 * fixed, clearly-labelled string identifying it as a migrated aggregate
 * (`"Migrated historical invoice total (legacy id <n>)"` /
 * `"Migrated historical credit note total (legacy id <n>)"`) so nobody
 * mistakes it for a real itemized charge. This keeps `SUM(line.amount) =
 * header.total_amount` true for every migrated row (an invariant real
 * invoices already rely on, e.g. any future line-level reporting), at the
 * cost of losing per-line granularity legacy never had in the first place.
 */
import { randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { buildDescription } from "./extract.transforms.js";
import { mapInvoiceStatus, mapCreditStatus } from "./validate.transforms.js";

// ── Minimal db-like interface load.ts depends on — matches ../../src/db/mysql.js's
// `db` export shape (getConnection() -> PoolConnection with begin/commit/rollback/
// release/execute), kept narrow and locally-defined here so this module never
// imports the real pool and can be driven entirely by a mock in tests.
export interface LoadDb {
  getConnection(): Promise<PoolConnection>;
}

export interface StagingInvoiceRow {
  id: number; // client_invoice_migration_staging.id
  src_id: number; // legacy tbl_invoice.id -> legacy_id
  target_id: string; // pre-generated UUID, becomes client_invoice.id
  target_cost_centre_id: string | null;
  target_gst_type: string | null;
  target_apply_gst: number | null;
  src_category: string;
  src_finance_year: string;
  src_month: string;
  src_invoicedate: string;
  src_invoicedescription: string | null;
  src_invoicedeleteremarks: string | null;
  src_proforma_bill_no: string | null;
  src_bill_no: string | null;
  src_total: string | null;
  src_tax: string | null;
  src_igst: string | null;
  src_sgst: string | null;
  src_cgst: string | null;
  src_grnd: string | null;
  validation_status: "pending" | "valid" | "error";
}

export interface StagingCreditNoteRow {
  id: number; // client_credit_note_migration_staging.id
  src_id: number; // legacy tbl_credit_note.id -> legacy_id
  target_id: string; // pre-generated UUID, becomes client_credit_note.id
  target_cost_centre_id: string | null;
  target_invoice_id: string | null; // A4-resolved client_invoice.id (future or already-loaded)
  target_gst_type: string | null;
  target_apply_gst: number | null;
  src_category: string;
  src_finance_year: string;
  src_month: string;
  src_creditdate: string;
  src_creditdescription: string | null;
  src_credit_no: string | null;
  src_credit_approve: number | null;
  src_total: string | null;
  src_tax: string | null;
  src_igst: string | null;
  src_sgst: string | null;
  src_cgst: string | null;
  src_grnd: string | null;
  validation_status: "pending" | "valid" | "error";
}

export interface LoadOptions {
  /** created_by / (for credit notes, also created_by) on the migrated row.
   *  client_invoice.created_by / client_credit_note.created_by are CHAR(36) NOT
   *  NULL with no default and no FK to a specific "system" user seeded anywhere
   *  in this codebase — the caller (a human-authorized follow-up script, per
   *  the header above) must supply a real actor id (e.g. the operator running
   *  the cutover, or a dedicated migration-service-account id Finance/Admin
   *  provisions for this purpose). Never defaulted silently here. */
  createdBy: string;
}

export interface RowLoadResult {
  legacyId: number;
  outcome: "loaded" | "already_loaded" | "skipped_not_valid" | "failed";
  targetId?: string;
  error?: string;
}

export interface LoadStats {
  invoices: RowLoadResult[];
  creditNotes: RowLoadResult[];
}

function parseAmount(raw: string | null): number {
  if (raw === null) return 0;
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : 0;
}

// ── Legacy date parsing ───────────────────────────────────────────────────────
// tbl_invoice.invoiceDate / tbl_credit_note.creditDate are legacy VARCHAR columns,
// not DATE/DATETIME — validateInvoiceRow/validateCreditNoteRow (Task 3) only check
// blank/non-blank, never format, because the live PREPARE check (parameterized,
// never EXECUTEd) cannot catch a value that is well-typed but semantically
// unparseable as a date. This is therefore a REAL per-row failure mode load.ts
// must guard, not assume away: accepts ISO 'YYYY-MM-DD[ HH:MM:SS]' and legacy's
// own common 'DD-MM-YYYY' / 'DD/MM/YYYY' shapes; anything else fails this row's
// own transaction (caught, rolled back, recorded — never crashes the whole run,
// same discipline extract.ts already uses per-row).
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}:\d{2})?$/;
const DMY_DATE_RE = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/;

export function parseLegacyDate(raw: string | null): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") {
    throw new Error(`date is blank`);
  }
  const iso = ISO_DATE_RE.exec(trimmed);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  const dmy = DMY_DATE_RE.exec(trimmed);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  throw new Error(`date "${raw}" does not match a recognized format (ISO or DD-MM-YYYY/DD/MM/YYYY)`);
}

const INVOICE_INSERT_SQL = `
  INSERT INTO client_invoice (
    id, cost_centre_id, invoice_status, category, finance_year, month_label,
    invoice_date, description, proforma_no, bill_no, gst_type, apply_gst,
    total_amount, igst_amount, cgst_amount, sgst_amount, grand_total,
    created_by, is_migrated, legacy_id
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)
  ON DUPLICATE KEY UPDATE
    cost_centre_id = VALUES(cost_centre_id), invoice_status = VALUES(invoice_status),
    category = VALUES(category), finance_year = VALUES(finance_year), month_label = VALUES(month_label),
    invoice_date = VALUES(invoice_date), description = VALUES(description),
    proforma_no = VALUES(proforma_no), bill_no = VALUES(bill_no), gst_type = VALUES(gst_type),
    apply_gst = VALUES(apply_gst), total_amount = VALUES(total_amount), igst_amount = VALUES(igst_amount),
    cgst_amount = VALUES(cgst_amount), sgst_amount = VALUES(sgst_amount), grand_total = VALUES(grand_total),
    id = id
`;
// Note: `ON DUPLICATE KEY UPDATE ... id = id` is a deliberate no-op-on-id trick —
// MySQL requires at least one assignment for the UPDATE branch to run at all, and
// `id` must never itself be reassigned (it is the row's own real identity, already
// fixed at first insert). This lets every other column re-sync on a re-run
// (picking up any staging-row correction since the prior load) while the
// migrated row's `id` — which client_invoice_line.invoice_id / a matched credit
// note's invoice_id already reference — never changes underneath them.

const CREDIT_NOTE_INSERT_SQL = `
  INSERT INTO client_credit_note (
    id, invoice_id, cost_centre_id, category, finance_year, month_label,
    credit_date, description, credit_no, credit_status, gst_type, apply_gst,
    total_amount, igst_amount, cgst_amount, sgst_amount, grand_total,
    created_by, is_migrated, legacy_id
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)
  ON DUPLICATE KEY UPDATE
    invoice_id = VALUES(invoice_id), cost_centre_id = VALUES(cost_centre_id),
    category = VALUES(category), finance_year = VALUES(finance_year), month_label = VALUES(month_label),
    credit_date = VALUES(credit_date), description = VALUES(description),
    credit_no = VALUES(credit_no), credit_status = VALUES(credit_status), gst_type = VALUES(gst_type),
    apply_gst = VALUES(apply_gst), total_amount = VALUES(total_amount), igst_amount = VALUES(igst_amount),
    cgst_amount = VALUES(cgst_amount), sgst_amount = VALUES(sgst_amount), grand_total = VALUES(grand_total),
    id = id
`;

async function loadOneInvoice(
  loadDb: LoadDb,
  row: StagingInvoiceRow,
  options: LoadOptions,
): Promise<RowLoadResult> {
  if (row.validation_status !== "valid") {
    return { legacyId: row.src_id, outcome: "skipped_not_valid" };
  }
  if (!row.target_cost_centre_id) {
    // Defense in depth: validateInvoiceRow already refuses a row with no resolved
    // cost centre as 'error', so a 'valid' row reaching here should always carry
    // target_cost_centre_id — this branch exists so a future validate.ts
    // regression fails loudly here too, not just silently NULLs an INSERT.
    return { legacyId: row.src_id, outcome: "failed", error: "target_cost_centre_id missing on a 'valid' row" };
  }

  const conn = await loadDb.getConnection();
  try {
    await conn.beginTransaction();

    const totalAmount = parseAmount(row.src_total);
    const igstAmount = parseAmount(row.src_igst);
    const cgstAmount = parseAmount(row.src_cgst);
    const sgstAmount = parseAmount(row.src_sgst);
    const grandTotal = parseAmount(row.src_grnd);
    const invoiceDate = parseLegacyDate(row.src_invoicedate);
    const description = buildDescription(row.src_invoicedescription, row.src_invoicedeleteremarks);
    const invoiceStatus = mapInvoiceStatus(row.src_bill_no);

    const [result] = await conn.execute<ResultSetHeader>(INVOICE_INSERT_SQL, [
      row.target_id, row.target_cost_centre_id, invoiceStatus, row.src_category, row.src_finance_year,
      row.src_month, invoiceDate, description, row.src_proforma_bill_no, row.src_bill_no,
      row.target_gst_type, row.target_apply_gst ?? 0, totalAmount, igstAmount, cgstAmount, sgstAmount,
      grandTotal, options.createdBy, row.src_id,
    ]);

    // affectedRows === 1 -> fresh INSERT; === 2 -> ON DUPLICATE KEY UPDATE branch ran
    // (MySQL's own documented convention for this exact idiom). Only insert the
    // synthesized line item on a fresh row — an update-path re-run must never
    // duplicate it.
    const isFreshInsert = (result as ResultSetHeader).affectedRows === 1;
    if (isFreshInsert) {
      const [existingLines] = await conn.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM client_invoice_line WHERE invoice_id = ?`,
        [row.target_id],
      );
      const lineCount = Number((existingLines[0] as { c: number }).c);
      if (lineCount === 0) {
        await conn.execute(
          `INSERT INTO client_invoice_line (id, invoice_id, line_type, particulars, qty, rate, amount)
           VALUES (?, ?, 'charge', ?, 1, ?, ?)`,
          [randomUUID(), row.target_id, `Migrated historical invoice total (legacy id ${row.src_id})`, totalAmount, totalAmount],
        );
      }
    }

    await conn.commit();
    return { legacyId: row.src_id, outcome: isFreshInsert ? "loaded" : "already_loaded", targetId: row.target_id };
  } catch (err) {
    await conn.rollback();
    const message = err instanceof Error ? err.message : String(err);
    return { legacyId: row.src_id, outcome: "failed", error: message };
  } finally {
    conn.release();
  }
}

async function loadOneCreditNote(
  loadDb: LoadDb,
  row: StagingCreditNoteRow,
  options: LoadOptions,
): Promise<RowLoadResult> {
  if (row.validation_status !== "valid") {
    return { legacyId: row.src_id, outcome: "skipped_not_valid" };
  }
  if (!row.target_cost_centre_id || !row.target_invoice_id) {
    return {
      legacyId: row.src_id,
      outcome: "failed",
      error: "target_cost_centre_id/target_invoice_id missing on a 'valid' row",
    };
  }

  const conn = await loadDb.getConnection();
  try {
    await conn.beginTransaction();

    const totalAmount = parseAmount(row.src_total);
    const igstAmount = parseAmount(row.src_igst);
    const cgstAmount = parseAmount(row.src_cgst);
    const sgstAmount = parseAmount(row.src_sgst);
    const grandTotal = parseAmount(row.src_grnd);
    const creditDate = parseLegacyDate(row.src_creditdate);
    const description = buildDescription(row.src_creditdescription, null);
    const creditStatus = mapCreditStatus(row.src_credit_approve);

    const [result] = await conn.execute<ResultSetHeader>(CREDIT_NOTE_INSERT_SQL, [
      row.target_id, row.target_invoice_id, row.target_cost_centre_id, row.src_category, row.src_finance_year,
      row.src_month, creditDate, description, row.src_credit_no, creditStatus,
      row.target_gst_type, row.target_apply_gst ?? 0, totalAmount, igstAmount, cgstAmount, sgstAmount,
      grandTotal, options.createdBy, row.src_id,
    ]);

    const isFreshInsert = (result as ResultSetHeader).affectedRows === 1;
    if (isFreshInsert) {
      const [existingLines] = await conn.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM client_credit_note_line WHERE credit_note_id = ?`,
        [row.target_id],
      );
      const lineCount = Number((existingLines[0] as { c: number }).c);
      if (lineCount === 0) {
        await conn.execute(
          `INSERT INTO client_credit_note_line (id, credit_note_id, particulars, qty, rate, amount)
           VALUES (?, ?, ?, 1, ?, ?)`,
          [randomUUID(), row.target_id, `Migrated historical credit note total (legacy id ${row.src_id})`, totalAmount, totalAmount],
        );
      }
    }

    await conn.commit();
    return { legacyId: row.src_id, outcome: isFreshInsert ? "loaded" : "already_loaded", targetId: row.target_id };
  } catch (err) {
    await conn.rollback();
    const message = err instanceof Error ? err.message : String(err);
    return { legacyId: row.src_id, outcome: "failed", error: message };
  } finally {
    conn.release();
  }
}

/**
 * Loads every 'valid' staging row into client_invoice/client_invoice_line first
 * (so a credit note's FK target already exists), then client_credit_note/
 * client_credit_note_line. One transaction per legacy row throughout — a single
 * row's failure rolls back only that row's own transaction and is recorded in
 * the returned stats, never aborting the batch.
 *
 * NEVER call this against the real mas_hrms connection outside a human-
 * authorized follow-up script — see this file's header comment.
 */
export async function loadValidatedRows(
  loadDb: LoadDb,
  stagingRows: { invoiceRows: StagingInvoiceRow[]; creditNoteRows: StagingCreditNoteRow[] },
  options: LoadOptions,
): Promise<LoadStats> {
  const invoiceResults: RowLoadResult[] = [];
  for (const row of stagingRows.invoiceRows) {
    invoiceResults.push(await loadOneInvoice(loadDb, row, options));
  }

  const creditNoteResults: RowLoadResult[] = [];
  for (const row of stagingRows.creditNoteRows) {
    creditNoteResults.push(await loadOneCreditNote(loadDb, row, options));
  }

  return { invoices: invoiceResults, creditNotes: creditNoteResults };
}
