/**
 * Payroll debit account config — the company account bank-file exports debit from.
 *
 * Was a raw string literal '033005005852' duplicated in payroll.executor.ts (bankAdvice and
 * neftTransferFile). Moved to payroll_debit_account_config (migration 1753) so it is an
 * admin-editable setting with an audit trail instead of something that requires a code
 * change + redeploy to update.
 *
 * FALLBACK_DEBIT_ACCOUNT below is the last-known value and is used only if the migration
 * has not been applied yet or the row is missing — never a reason for a live bank-file
 * export to start emitting a blank debit account.
 */
import { db } from "../../db/mysql.js";

const FALLBACK_DEBIT_ACCOUNT = "033005005852";

interface CachedValue {
  account_number: string;
  bank_name: string | null;
  at: number;
}

let cache: CachedValue | null = null;
const CACHE_TTL_MS = 60_000;

export interface DebitAccountConfig {
  debit_account_number: string;
  bank_name: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

/** Read the current debit account number. Cached briefly since every export row would otherwise re-query it. */
export async function getDebitAccountNumber(): Promise<string> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.account_number;
  try {
    const [rows] = await db.query<any[]>(
      `SELECT debit_account_number, bank_name FROM payroll_debit_account_config WHERE id = 1 LIMIT 1`,
    );
    const row = (rows as any[])[0];
    const value = String(row?.debit_account_number ?? "").trim();
    cache = { account_number: value || FALLBACK_DEBIT_ACCOUNT, bank_name: row?.bank_name ?? null, at: Date.now() };
    return cache.account_number;
  } catch {
    // Table not migrated yet, or a transient DB hiccup — a bank-file export must never break
    // or emit a blank debit account over this; fall back to the value it always used.
    return FALLBACK_DEBIT_ACCOUNT;
  }
}

/** Full config row, for the admin read/write endpoints. */
export async function getDebitAccountConfig(): Promise<DebitAccountConfig> {
  const [rows] = await db.query<any[]>(
    `SELECT debit_account_number, bank_name, updated_by, updated_at
       FROM payroll_debit_account_config WHERE id = 1 LIMIT 1`,
  );
  const row = (rows as any[])[0];
  if (!row) {
    return { debit_account_number: FALLBACK_DEBIT_ACCOUNT, bank_name: null, updated_by: null, updated_at: null };
  }
  return {
    debit_account_number: String(row.debit_account_number ?? ""),
    bank_name: row.bank_name ?? null,
    updated_by: row.updated_by ?? null,
    updated_at: row.updated_at ?? null,
  };
}

export async function setDebitAccountConfig(params: {
  debit_account_number: string;
  bank_name: string | null;
  updated_by: string;
}): Promise<void> {
  await db.execute(
    `INSERT INTO payroll_debit_account_config (id, debit_account_number, bank_name, updated_by)
     VALUES (1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       debit_account_number = VALUES(debit_account_number),
       bank_name = VALUES(bank_name),
       updated_by = VALUES(updated_by),
       updated_at = CURRENT_TIMESTAMP`,
    [params.debit_account_number, params.bank_name, params.updated_by],
  );
  cache = null; // next read picks up the new value immediately
}
