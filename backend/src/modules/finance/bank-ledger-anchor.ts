// backend/src/modules/finance/bank-ledger-anchor.ts
/**
 * One running-balance chain per company bank account, anchored at the opening balance.
 *
 * company_bank_account.opening_balance is the balance on opening_balance_as_of (from the bank
 * statement). The ledger also holds history from before that date (the I-Spark import, 2015-2026),
 * so the chain is built in transaction-date order (entry_date, created_at, id) around the anchor:
 *   - the last entry ON or BEFORE the as-of date carries running_balance = opening_balance, and
 *     earlier entries are walked backwards from it (history stays readable, it just ends at the
 *     opening balance instead of floating on its own);
 *   - entries AFTER the as-of date build forward: running = previous + credit - debit.
 * The account balance is therefore always opening_balance + movements after the as-of date, and the
 * "last running_balance" every screen and posting path reads is that same number.
 *
 * Found 2026-10-15: the opening balances finance entered on 2026-10-07 never reached the stored chain
 * (it had been built from 0 when the I-Spark history was loaded on 2026-09-26), so ICICI AV showed
 * -₹33.36 Cr. Recompute whenever the opening balance / as-of date changes, and after any posting that
 * could land out of order. Money in integer paise; only rows whose value changes are written.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";

/** The shared pool or a transaction connection — both expose query(sql, params). */
type Executor = { query: <T extends RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<[T, unknown]> };

const toPaise = (v: unknown) => Math.round(Number(v ?? 0) * 100);
const rupees = (p: number) => Math.round(p) / 100;

export interface LedgerRow { id: string; entry_date: string; created_at: string; credit: number; debit: number; running: number }

/** Pure: the anchored chain (paise) for rows already sorted in transaction-date order. */
export function anchoredChain(rows: Array<{ entry_date: string; credit: number; debit: number }>, openingPaise: number, asOf: string | null): number[] {
  const out = new Array<number>(rows.length);
  // Index of the last row on/before the anchor date (-1 when every row is after it, or no as-of date).
  let k = -1;
  if (asOf) for (let i = 0; i < rows.length; i++) if (rows[i].entry_date.slice(0, 10) <= asOf) k = i;
  if (k >= 0) {
    out[k] = openingPaise;
    for (let i = k; i > 0; i--) out[i - 1] = out[i] - (rows[i].credit - rows[i].debit);
  }
  let prev = k >= 0 ? out[k] : openingPaise;
  for (let i = k + 1; i < rows.length; i++) {
    prev = prev + rows[i].credit - rows[i].debit;
    out[i] = prev;
  }
  return out;
}

/** Re-anchor every account a voucher posted to (an internal transfer posts to two). */
export async function rebaseForVoucher(voucherId: string, executor: Executor | PoolConnection | typeof db = db): Promise<RebaseResult[]> {
  const [touched] = await (executor as Executor).query<RowDataPacket[]>(
    `SELECT DISTINCT bank_account_id FROM bank_account_ledger_entry WHERE voucher_id = ?`, [voucherId]);
  const out: RebaseResult[] = [];
  for (const t of touched) out.push(await rebaseRunningBalances(String(t.bank_account_id), executor));
  return out;
}

export interface RebaseResult { bankAccountId: string; rows: number; changed: number; balanceBefore: number | null; balanceAfter: number; asOf: string | null; opening: number }

/** Recompute and store the anchored chain for one account. Pass a transaction connection to make it atomic with a posting. */
export async function rebaseRunningBalances(bankAccountId: string, executor: Executor | PoolConnection | typeof db = db, options: { dryRun?: boolean } = {}): Promise<RebaseResult> {
  const ex = executor as Executor;
  const [[acct]] = await ex.query<RowDataPacket[]>(
    `SELECT opening_balance, DATE_FORMAT(opening_balance_as_of, '%Y-%m-%d') AS as_of FROM company_bank_account WHERE id = ?`, [bankAccountId]);
  if (!acct) throw Object.assign(new Error("Bank account not found"), { statusCode: 404 });
  const [raw] = await ex.query<RowDataPacket[]>(
    `SELECT id, DATE_FORMAT(entry_date, '%Y-%m-%d') AS entry_date, credit_amount, debit_amount, running_balance
       FROM bank_account_ledger_entry WHERE bank_account_id = ? ORDER BY entry_date, created_at, id`, [bankAccountId]);
  const rows = raw.map((r) => ({ id: String(r.id), entry_date: String(r.entry_date ?? ""), credit: toPaise(r.credit_amount), debit: toPaise(r.debit_amount), running: toPaise(r.running_balance) }));
  const openingPaise = toPaise(acct.opening_balance);
  const asOf = acct.as_of ? String(acct.as_of) : null;
  const chain = anchoredChain(rows, openingPaise, asOf);
  const changed = rows.map((r, i) => ({ id: r.id, value: chain[i] })).filter((x, i) => x.value !== rows[i].running);
  if (!options.dryRun) {
    for (let i = 0; i < changed.length; i += 500) {
      const part = changed.slice(i, i + 500);
      await ex.query(
        `UPDATE bank_account_ledger_entry SET running_balance = CASE id ${part.map(() => "WHEN ? THEN ?").join(" ")} END
          WHERE bank_account_id = ? AND id IN (${part.map(() => "?").join(",")})`,
        [...part.flatMap((x) => [x.id, rupees(x.value)]), bankAccountId, ...part.map((x) => x.id)],
      );
    }
  }
  const lastByDate = rows.length ? rows[rows.length - 1].running : null;
  return {
    bankAccountId, rows: rows.length, changed: changed.length,
    balanceBefore: lastByDate === null ? null : rupees(lastByDate),
    balanceAfter: rupees(rows.length ? chain[chain.length - 1] : openingPaise),
    asOf, opening: rupees(openingPaise),
  };
}
