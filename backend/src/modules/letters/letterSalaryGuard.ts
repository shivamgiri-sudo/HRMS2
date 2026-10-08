/**
 * Keeps salary figures on letters to what was approved.
 *
 * Owner rule 2026-10-05: a letter prints only salary the Payroll Head approved. Two leaks sat in the generic
 * letter generator (letters.service.ts generateLetter and the preview route):
 *
 *   1. `override_vars` was spread AFTER the approved salary rows, so a caller could overwrite basic, gross,
 *      net, CTC ... with anything they typed. stripSalaryOverrides() removes those keys.
 *   2. The increment letter's figures (revised CTC, fixed CTC, TCTC, variable pay, effective date) came only
 *      from override_vars, i.e. free-typed. resolveApprovedIncrementVars() reads them from the approved and
 *      implemented salary_increment_request instead, and refuses (409) when there is none.
 *
 * Variable pay has no approved source (salary_increment_request carries a fixed CTC only), so it is blank and
 * the TCTC row equals the approved fixed CTC.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { istDisplayDate } from "./letterFormat.js";

/** Keys the approved-package resolver fills (same list as appointmentLetterData.LETTER_SALARY_KEYS). */
export const APPROVED_SALARY_KEYS = [
  "basic", "hra", "lta", "conveyance", "other_allowance", "special_allowance",
  "bonus", "medical_allowance", "portfolio", "pli", "gross_salary", "esic",
  "epf", "net_salary", "employer_esic", "employer_epf", "admin_charges", "ctc",
] as const;

/** Keys the increment letter derives from the approved increment. */
export const INCREMENT_KEYS = ["revised_ctc", "revised_fixed_ctc", "total_tctc", "variable_pay", "effective_date"] as const;

/**
 * override_vars minus every salary figure the system supplies. Increment keys are removed too when the
 * letter is an increment letter, because those are derived, not typed.
 */
export function stripSalaryOverrides(
  letterType: string | null | undefined,
  overrides: Record<string, string> | null | undefined,
): Record<string, string> {
  if (!overrides) return {};
  const blocked = new Set<string>(APPROVED_SALARY_KEYS);
  if (letterType === "increment") for (const k of INCREMENT_KEYS) blocked.add(k);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(overrides)) if (!blocked.has(k)) out[k] = v;
  return out;
}

const inr = (n: number) => Math.round(n).toLocaleString("en-IN");

/**
 * The latest increment that went through approval AND was implemented. proposed_ctc is the annual CTC
 * (increment requests store annual; employee_salary_assignment.ctc_annual is set from it on implement).
 */
export async function resolveApprovedIncrementVars(employeeId: string): Promise<Record<string, string>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT proposed_ctc, effective_from
       FROM salary_increment_request
      WHERE employee_id = ? AND source = 'hrms' AND status = 'implemented' AND approved_at IS NOT NULL
      ORDER BY effective_from DESC, implemented_at DESC
      LIMIT 1`,
    [employeeId],
  );
  const r = (rows as RowDataPacket[])[0];
  const annual = Number(r?.proposed_ctc);
  if (!r || !Number.isFinite(annual) || annual <= 0) {
    throw Object.assign(
      new Error(
        "This employee has no approved and implemented salary increment, so there is no approved revised CTC to print. " +
          "Raise the increment and get it approved and implemented first.",
      ),
      { statusCode: 409 },
    );
  }
  return {
    revised_ctc: inr(annual),
    revised_fixed_ctc: inr(annual),
    variable_pay: "",
    total_tctc: inr(annual),
    effective_date: istDisplayDate(r.effective_from),
  };
}
