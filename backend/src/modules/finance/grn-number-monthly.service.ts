import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";

/**
 * The MAS/MM/YY/SERIAL GRN number, allocated per company per month.
 *
 * Sits alongside allocateGrnNumber (the Mas/{branch_seq}/{YY}/{seq} format) rather than
 * replacing it. Which one runs is a config flag, not a deploy: see resolveGrnNumberFormat.
 * Historical numbers are never rewritten under any circumstances.
 *
 * WHY PER COMPANY
 * The business issues GRNs under two live legal entities. In the legacy system db_bill,
 * CompId 1 issues 68,646 numbers prefixed `Mas` and CompId 2 issues 8,590 prefixed `IDC`,
 * both still active in FY 2026-27. A serial shared across both would leave each entity a run
 * full of the other's gaps, which cannot be reconciled against a physical register.
 */

export type GrnNumberFormat = "legacy_branch_fy" | "monthly_company";

const DEFAULT_FORMAT: GrnNumberFormat = "legacy_branch_fy";
const DEFAULT_COMPANY = "MAS";

/** `YYYY-MM`. Anything else is a bug upstream, not something to coerce. */
function assertPeriodCode(periodCode: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodCode)) {
    throw new Error(`Accounting period must be YYYY-MM, received "${periodCode}"`);
  }
}

async function readConfig(key: string, fallback: string): Promise<string> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT config_value FROM finance_config WHERE config_key = ? LIMIT 1`,
      [key],
    );
    const value = rows[0]?.config_value;
    return value === undefined || value === null || value === "" ? fallback : String(value);
  } catch {
    // finance_config arrives with migration 1088. Before it exists, or if the row was never
    // seeded, fall back rather than failing GRN creation — the fallback is the legacy format,
    // which is the pre-existing behaviour.
    return fallback;
  }
}

export async function resolveGrnNumberFormat(): Promise<GrnNumberFormat> {
  const value = await readConfig("grn_number_format", DEFAULT_FORMAT);
  return value === "monthly_company" ? "monthly_company" : DEFAULT_FORMAT;
}

/**
 * Reserves the next serial for (company, period) and returns the formatted number.
 *
 * The locking sequence is copied verbatim from allocateGrnNumber and must stay that way:
 *   INSERT ... ON DUPLICATE KEY UPDATE next_sequence = next_sequence   (make the row exist)
 *   SELECT next_sequence ... FOR UPDATE                                (lock it)
 *   UPDATE next_sequence = next_sequence + 1                           (claim it)
 * The no-op ON DUPLICATE KEY UPDATE is load-bearing: it guarantees a row exists for FOR
 * UPDATE to lock, and serialises the create-race at the unique index. Never replace this with
 * MAX(serial)+1, which has no lock at all.
 *
 * Pass `connection` to join the caller's transaction. That is what stops a failed
 * grn_request INSERT from burning a serial — a gap in a branch-scoped run is cosmetic, but a
 * gap in a company-global monthly run is an audit finding, because it cannot be explained
 * away as one branch's failed entry. When a connection is supplied this function neither
 * commits nor rolls back; the caller owns the transaction.
 */
export async function allocateMonthlyGrnNumber(input: {
  periodCode: string;
  companyCode?: string | null;
  connection?: PoolConnection;
}): Promise<string> {
  assertPeriodCode(input.periodCode);
  const companyCode = (input.companyCode?.trim() || (await readConfig("grn_default_company_code", DEFAULT_COMPANY))).toUpperCase();

  const owned = !input.connection;
  const connection = input.connection ?? (await db.getConnection());
  try {
    if (owned) await connection.beginTransaction();

    const [companyRows] = await connection.execute<RowDataPacket[]>(
      `SELECT grn_prefix FROM finance_company WHERE company_code = ? AND active_status = 1 LIMIT 1`,
      [companyCode],
    );
    if (!companyRows[0]) {
      throw new Error(`No active company is configured for code "${companyCode}"`);
    }
    const prefix = String(companyRows[0].grn_prefix);

    await connection.execute(
      `INSERT INTO finance_grn_monthly_sequence (company_code, period_code, next_sequence)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE next_sequence = next_sequence`,
      [companyCode, input.periodCode],
    );

    const [sequenceRows] = await connection.execute<RowDataPacket[]>(
      `SELECT next_sequence
         FROM finance_grn_monthly_sequence
        WHERE company_code = ? AND period_code = ?
        FOR UPDATE`,
      [companyCode, input.periodCode],
    );
    if (!sequenceRows[0]) throw new Error("GRN sequence could not be initialized");

    const sequence = Number(sequenceRows[0].next_sequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error("GRN sequence is invalid");
    }

    await connection.execute(
      `UPDATE finance_grn_monthly_sequence
          SET next_sequence = next_sequence + 1
        WHERE company_code = ? AND period_code = ?`,
      [companyCode, input.periodCode],
    );

    if (owned) await connection.commit();

    const [yyyy, mm] = input.periodCode.split("-");
    // Padded to four digits for readability, but never truncated: the 10,000th GRN of a month
    // becomes MAS/08/26/10000 rather than wrapping and colliding.
    return `${prefix}/${mm}/${yyyy.slice(2, 4)}/${String(sequence).padStart(4, "0")}`;
  } catch (error) {
    if (owned) await connection.rollback();
    throw error;
  } finally {
    if (owned) connection.release();
  }
}

/**
 * Derives the accounting period a GRN books into.
 *
 * Explicitly NOT bill_date: an invoice is dated by the vendor and may arrive in a later month,
 * and minting a number into a month whose sequence has already moved on makes "serials within
 * MAS/07/26 are contiguous" untrue. Falls back to bill_date only when no accounting period was
 * supplied, which is the historical shape.
 */
export function resolveAccountingPeriod(input: {
  accountingPeriod?: string | null;
  billDate?: string | null;
}): string {
  const explicit = input.accountingPeriod?.trim();
  if (explicit) {
    assertPeriodCode(explicit);
    return explicit;
  }
  const billDate = input.billDate?.trim();
  if (billDate && /^\d{4}-\d{2}/.test(billDate)) return billDate.slice(0, 7);
  throw new Error("An accounting period or bill date is required to number a GRN");
}
