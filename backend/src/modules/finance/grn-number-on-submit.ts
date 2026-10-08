import type { RowDataPacket } from "mysql2";
import { allocateGrnNumber } from "./grn-number.service.js";
import {
  allocateMonthlyGrnNumber,
  resolveGrnNumberFormat,
} from "./grn-number-monthly.service.js";

/**
 * A GRN gets its number at FINAL APPROVAL — Finance Head clearing a `branch_head_approved` GRN —
 * and nowhere else. The name (`OnSubmit`) is now historical, kept to avoid a mechanical rename
 * across the half-dozen files that assert this function's name by grep; the CALL SITE is what
 * moved, not this file's logic.
 *
 * Owner ruling, superseding the 2026-08-27 "assign at submission" design this file originally
 * documented: a number identifies a spend the company has actually approved, not merely raised.
 * Consequences, all deliberate:
 *   - A GRN sits with `grn_number IS NULL` all the way through `submitted` and
 *     `branch_head_approved` — the Branch Head and Finance Head approval screens identify a
 *     pending GRN by a computed stand-in reference instead (see `pendingGrnReference()` in the
 *     frontend's grn-format.tsx), never by a real number that does not exist yet.
 *   - A REJECTED GRN never reaches approval, so it never gets a number — its audit trail shows
 *     only the stand-in reference, forever. This is intended, not a gap.
 *   - Re-submission after a return, and legacy migrated rows that already carry a number, are
 *     unaffected: `if (existing) return existing` below still guards every call.
 *
 * Called from grn-smart.service.ts's `review()` and grn.service.ts's `reviewGrn()` — the two live
 * finance_head-approval branches (see grn-number-on-submit.test.ts's routing comment for why both
 * exist) — inside the same UPDATE that flips the status, via `grn_number = COALESCE(grn_number, ?)`
 * so a retried/concurrent approval cannot mint two numbers for one GRN.
 *
 * Neither submit() implementation calls this any more — see their own comments for why.
 */

/** YYYY-MM → Indian financial year label, e.g. "2026-08" → "2026-27". April starts the year. */
export function financialYearFromPeriodCode(periodCode: string): string {
  const [year, month] = String(periodCode).split("-").map(Number);
  if (!year || !month) throw new Error("GRN has an invalid accounting period");
  return month >= 4
    ? `${year}-${String(year + 1).slice(-2)}`
    : `${year - 1}-${String(year).slice(-2)}`;
}

/**
 * Returns the number this GRN should carry once Finance Head approves it.
 *
 * An existing number is ALWAYS kept — a re-approval race, a re-submit after a return/reopen, and
 * legacy rows migrated from db_bill, must not be renumbered. Callers should still write it with
 * `grn_number = COALESCE(grn_number, ?)` so a concurrent approval cannot overwrite one either.
 */
export async function resolveGrnNumberOnSubmit(grn: RowDataPacket | Record<string, unknown>): Promise<string> {
  const existing = String((grn as Record<string, unknown>).grn_number ?? "").trim();
  if (existing) return existing;

  const accountingPeriod = String((grn as Record<string, unknown>).accounting_period ?? "");
  const storedFinancialYear = String((grn as Record<string, unknown>).financial_year ?? "").trim();
  const financialYear = storedFinancialYear || financialYearFromPeriodCode(accountingPeriod);

  // Which format runs is a config flag (finance_config.grn_number_format), not a deploy. The two
  // formats draw on different sequence tables, so flipping it never renumbers what already exists.
  const format = await resolveGrnNumberFormat();
  return format === "monthly_company"
    ? allocateMonthlyGrnNumber({ periodCode: accountingPeriod })
    : allocateGrnNumber(String((grn as Record<string, unknown>).branch_id ?? ""), financialYear);
}
