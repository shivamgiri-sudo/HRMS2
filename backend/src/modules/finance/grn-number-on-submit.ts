import type { RowDataPacket } from "mysql2";
import { allocateGrnNumber } from "./grn-number.service.js";
import {
  allocateMonthlyGrnNumber,
  resolveGrnNumberFormat,
} from "./grn-number-monthly.service.js";

/**
 * A GRN gets its number at SUBMISSION — the draft → submitted transition — and nowhere else.
 *
 * Drafts that are abandoned must never consume a sequence slot, or Finance sees gaps they cannot
 * account for; and the number must exist from the moment the GRN leaves the raiser's hands, so
 * every approver, query and payment reference has something to quote. Neither approval stage
 * assigns it.
 *
 * This lives in its own module because there are TWO submit paths and only one of them used to
 * allocate. `grnService.submitForApproval()` did it inline; `grnValidationControlService.submit()`
 * — which is the one that actually runs, because `smartGrnRouter` is mounted on "/grns"
 * (grn.routes.ts) hundreds of lines ABOVE the legacy `POST /grns/:id/submit`, so Express matches
 * it first — did not. The legacy allocator was therefore dead code, and every GRN raised through
 * the current form reached Branch Head and Finance Head approval carrying grn_number = NULL.
 * Six such GRNs were found live on 2026-08-27, including a Rs 28,024.98 vendor GRN.
 *
 * Both paths now call this. Do not re-inline it in either.
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
 * Returns the number this GRN should carry once submitted.
 *
 * An existing number is ALWAYS kept — a re-submit after a return/reopen, and legacy rows migrated
 * from db_bill, must not be renumbered. Callers should still write it with
 * `grn_number = COALESCE(grn_number, ?)` so a concurrent submit cannot overwrite one either.
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
