import type { ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Either the pool-level `db` or a `PoolConnection` already checked out of it by a caller
 * that is inside its own open transaction — both expose an `execute` with this shape. Passing
 * a caller's own `conn` here (instead of always reaching back into the pool) is what avoids
 * mixing pool-level execute with an open transaction, the exact hazard this module's own
 * conventions warn against (see approveInvoice, which holds a `FOR UPDATE` lock via
 * `db.getConnection()` for its whole transaction).
 */
type Executor = { execute: typeof db.execute };

/**
 * Atomic counter mint, replacing legacy's `LOCK TABLES tbl_invoice READ` (wrong table, wrong
 * mode, no real serialization — confirmed race condition in the source audit). This uses
 * MySQL's well-known `INSERT ... ON DUPLICATE KEY UPDATE col = LAST_INSERT_ID(col + expr)`
 * idiom: (kind, scope_key) is the table's actual PRIMARY KEY (not a separate UNIQUE KEY beside
 * a surrogate id — see the migration's own comment for why that combination is broken), so the
 * whole statement is a single atomic read-modify-write at the storage-engine level, and
 * LAST_INSERT_ID(expr) makes the new value retrievable from the statement's own result
 * (`insertId`) with no follow-up SELECT and no explicit transaction/locking required.
 *
 * Do not add a surrogate AUTO_INCREMENT id to client_invoice_number_sequence. Proved live: when
 * the table has its own genuine AUTO_INCREMENT column, MySQL returns THAT column's real
 * generated value as `insertId` on a fresh INSERT, not the LAST_INSERT_ID(expr) value — even
 * though the wrapped value is correctly stored in last_value itself. The fresh-mint case
 * (every first invoice for a new state/company/finance-year) would silently return an
 * arbitrary large number instead of 1. This only works because (kind, scope_key) is the
 * primary key with nothing else competing for LAST_INSERT_ID(), matching
 * ai_rate_limit_bucket's PRIMARY KEY (user_id, window_start) — the working precedent this was
 * modeled on, which also has no surrogate id.
 */
async function nextSequenceValue(
  kind: "proforma" | "bill" | "credit_note",
  scopeKey: string,
  executor: Executor = db
): Promise<number> {
  const [result] = await executor.execute<ResultSetHeader>(
    `INSERT INTO client_invoice_number_sequence (kind, scope_key, \`last_value\`, updated_at)
     VALUES (?, ?, LAST_INSERT_ID(1), NOW())
     ON DUPLICATE KEY UPDATE \`last_value\` = LAST_INSERT_ID(\`last_value\` + 1), updated_at = NOW()`,
    [kind, scopeKey]
  );
  return result.insertId;
}

/**
 * Legacy format: `PI/<state_code>/<n>`, a single global counter (matches bill_no_master id=1).
 *
 * `conn` is optional: `createProforma` (client-billing.service.ts) holds its own `conn` in an
 * open transaction for this exact mint, so it passes it through here instead of reaching back
 * into the pool separately — the same pool-level-execute-inside-an-open-transaction hazard
 * mintBillNumber's docstring below describes. Callers outside a transaction omit it.
 */
async function mintProformaNumber(stateCode: string, conn?: Executor): Promise<string> {
  const n = await nextSequenceValue("proforma", "GLOBAL", conn);
  return `PI/${stateCode}/${n}`;
}

/**
 * Legacy format: `<state_code>-<NN>/<FYshort>`, scoped per (state_code, company_name,
 * finance_year) — matches `MAX(BillNoChange) WHERE finance_year=X AND state_code=Y AND
 * company_name=Z`. Zero-padded to at least 2 digits below 10, matching legacy's
 * `strlen(intval($idx))==1 ? '0'.$idx : $idx`.
 *
 * `conn` is optional: approveInvoice holds a `FOR UPDATE` lock via `db.getConnection()` for its
 * whole transaction, so it passes its own `conn` here — mixing that open transaction with a
 * separate pool-level `db.execute` call risks pool-starvation deadlocks under load (the same
 * shape as the documented 45-workers pool-starvation incident: a pool-level call queues behind
 * connections the transaction itself is holding, rather than failing fast on the same
 * connection). Callers outside a transaction omit it and fall back to the pool, unchanged.
 */
async function mintBillNumber(stateCode: string, companyName: string, financeYear: string, conn?: Executor): Promise<string> {
  const scopeKey = `${stateCode}|${companyName}|${financeYear}`;
  const n = await nextSequenceValue("bill", scopeKey, conn);
  const idx = n < 10 ? `0${n}` : String(n);
  const fyShort = financeYear.slice(2); // "2026-27" -> "26-27", matches legacy substr($f_year1,2,6)
  return `${stateCode}-${idx}/${fyShort}`;
}

/**
 * New format (fixes a confirmed legacy bug: db_bill's credit_no is a DD-MM/FY-FY date stamp
 * that collides whenever two credit notes are issued the same day — proven live, ids 163/164
 * both carry "18-08/26-27"). CN-<state_code>-<NN>/<FYshort>, scoped per (state_code,
 * company_name, finance_year) — same scoping and zero-pad rule as mintBillNumber.
 *
 * `conn` is optional, same reasoning as mintBillNumber above. FIXED 2026-08-21:
 * `createCreditNote` (client-billing-credit-note.service.ts) now passes its own open-transaction
 * `conn` through here, closing the pool-starvation hazard this docstring used to flag.
 */
async function mintCreditNoteNumber(stateCode: string, companyName: string, financeYear: string, conn?: Executor): Promise<string> {
  const scopeKey = `${stateCode}|${companyName}|${financeYear}`;
  const n = await nextSequenceValue("credit_note", scopeKey, conn);
  const idx = n < 10 ? `0${n}` : String(n);
  const fyShort = financeYear.slice(2);
  return `CN-${stateCode}-${idx}/${fyShort}`;
}

export const clientBillingNumberingService = { mintProformaNumber, mintBillNumber, mintCreditNoteNumber };
