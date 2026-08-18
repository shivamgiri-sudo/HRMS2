import type { ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Atomic counter mint, replacing legacy's `LOCK TABLES tbl_invoice READ` (wrong table, wrong
 * mode, no real serialization — confirmed race condition in the source audit). This uses
 * MySQL's well-known `INSERT ... ON DUPLICATE KEY UPDATE col = LAST_INSERT_ID(col + expr)`
 * idiom: the UNIQUE KEY on (kind, scope_key) makes the whole statement a single atomic
 * read-modify-write at the storage-engine level, and LAST_INSERT_ID(expr) makes the new value
 * retrievable from the statement's own result (`insertId`) with no follow-up SELECT and no
 * explicit transaction/locking required.
 */
async function nextSequenceValue(kind: "proforma" | "bill", scopeKey: string): Promise<number> {
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO client_invoice_number_sequence (kind, scope_key, last_value, updated_at)
     VALUES (?, ?, 1, NOW())
     ON DUPLICATE KEY UPDATE last_value = LAST_INSERT_ID(last_value + 1), updated_at = NOW()`,
    [kind, scopeKey]
  );
  return result.insertId;
}

/** Legacy format: `PI/<state_code>/<n>`, a single global counter (matches bill_no_master id=1). */
async function mintProformaNumber(stateCode: string): Promise<string> {
  const n = await nextSequenceValue("proforma", "GLOBAL");
  return `PI/${stateCode}/${n}`;
}

/**
 * Legacy format: `<state_code>-<NN>/<FYshort>`, scoped per (state_code, company_name,
 * finance_year) — matches `MAX(BillNoChange) WHERE finance_year=X AND state_code=Y AND
 * company_name=Z`. Zero-padded to at least 2 digits below 10, matching legacy's
 * `strlen(intval($idx))==1 ? '0'.$idx : $idx`.
 */
async function mintBillNumber(stateCode: string, companyName: string, financeYear: string): Promise<string> {
  const scopeKey = `${stateCode}|${companyName}|${financeYear}`;
  const n = await nextSequenceValue("bill", scopeKey);
  const idx = n < 10 ? `0${n}` : String(n);
  const fyShort = financeYear.slice(2); // "2026-27" -> "26-27", matches legacy substr($f_year1,2,6)
  return `${stateCode}-${idx}/${fyShort}`;
}

export const clientBillingNumberingService = { mintProformaNumber, mintBillNumber };
