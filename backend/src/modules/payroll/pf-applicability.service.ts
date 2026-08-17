import type { RowDataPacket } from "mysql2";
import { billQuery } from "../../db/billDb.js";
import { db } from "../../db/mysql.js";

/**
 * The ONE answer to "is this employee PF-applicable for this payroll period?".
 *
 * Owner ruling 2026-08-17 (option A): db_bill's monthly payroll row is authoritative, because it
 * is what actually happened to the employee's money. HRMS has not released a salary yet; db_bill
 * has, and its PFELig flag is the decision that was applied when they were paid.
 *
 * WHY THIS EXISTS
 *   Every consumer answered this differently, and the one HRMS-native source could not answer it
 *   at all. Measured live 2026-08-17 against 1,327 active employees:
 *
 *     employee_statutory_info.pf_eligible        69 rows        (5.2%)
 *     db_bill salary_data PFELig, 2026-07     1,231 rows        (93%, ZERO unresolved)
 *
 *   So the data was never missing — it was in the system that pays people. A resolver built on
 *   employee_statutory_info would have silently covered 5% of the workforce and looked complete.
 *
 * WHY NOT COPY IT INTO mas_hrms
 *   Explicit owner instruction 2026-08-17: no duplicate tables or columns. This reads through to
 *   db_bill per period, the same pattern bank-payment-readiness already uses for credited
 *   accounts. A copied table would drift from the payroll that produced it, and the drift would
 *   be invisible — which is the failure mode this whole audit keeps finding.
 *
 * GOING FORWARD (the second half of the ruling)
 *   HRMS must keep working as it takes over payroll. db_bill is therefore the FIRST source, not
 *   the only one:
 *
 *     1. db_bill salary_data for the period      — authoritative, what was actually paid
 *     2. employee_statutory_info.pf_eligible     — HRMS-native, for employees db_bill never paid
 *     3. PF_APPLICABILITY_UNRESOLVED             — neither knows; never guessed
 *
 *   An HRMS-native joiner who has never appeared in a db_bill run resolves through (2), so the
 *   resolver does not stop working the moment payroll moves across. As db_bill coverage falls
 *   and HRMS coverage rises, the same function keeps answering without a rewrite.
 *
 * NEVER GUESSES
 *   There is deliberately no wage-threshold inference here. Deriving PF applicability from salary
 *   would be inventing statutory policy, and an employee wrongly marked applicable has money
 *   deducted that should not have been.
 *
 * WHAT THIS DOES NOT ANSWER
 *   Applicability only — not identity. A PF-applicable employee still needs a valid 12-digit UAN
 *   before ECR can be filed, and that is a separate resolution with materially worse coverage
 *   (711 of 1,327 valid, measured the same day). ECR must fail closed on a missing UAN rather
 *   than quietly dropping the contributor.
 */

export type PfApplicability =
  | "PF_APPLICABLE"
  | "PF_NOT_APPLICABLE"
  | "PF_APPLICABILITY_UNRESOLVED";

export type PfApplicabilitySource = "db_bill_payroll" | "hrms_statutory_info" | "none";

export interface PfApplicabilityResult {
  employeeCode: string;
  status: PfApplicability;
  source: PfApplicabilitySource;
  /** Human-readable, for a readiness screen. Never a guess dressed as a fact. */
  reason: string;
}

const yesNo = (raw: unknown): boolean | null => {
  const v = String(raw ?? "").trim().toUpperCase();
  if (v === "YES" || v === "Y" || v === "1" || v === "TRUE") return true;
  if (v === "NO" || v === "N" || v === "0" || v === "FALSE") return false;
  // Anything else is NOT treated as "no". db_bill's eligibility columns are known to carry
  // misaligned junk on at least one row (an IFSC code and a person's name), and reading that as
  // "not applicable" would silently drop a contributor from a statutory filing.
  return null;
};

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Resolve the whole period in one pass.
 *
 * Batched deliberately: db_bill is MySQL 5.5 on a separate host, and a per-employee call would
 * mean over a thousand round trips per readiness screen. Callers wanting a single employee should
 * still use this and read one key out — the query is indexed on the period, not the employee.
 */
export async function resolvePfApplicabilityForPeriod(
  payrollMonth: string,
): Promise<Map<string, PfApplicabilityResult>> {
  if (!PERIOD_RE.test(payrollMonth)) {
    throw new Error(`Payroll month must be YYYY-MM, received "${payrollMonth}"`);
  }
  const out = new Map<string, PfApplicabilityResult>();

  // ── 1. db_bill payroll for the period — authoritative ─────────────────────
  let billRows: Array<{ EmpCode?: unknown; PFELig?: unknown }> = [];
  try {
    billRows = (await billQuery(
      `SELECT EmpCode, PFELig FROM salary_data
        WHERE DATE_FORMAT(SalDate, '%Y-%m') = ?
          AND EmpCode IS NOT NULL AND TRIM(EmpCode) <> ''`,
      [payrollMonth],
    )) as Array<{ EmpCode?: unknown; PFELig?: unknown }>;
  } catch (err) {
    // db_bill unreachable is UNRESOLVED for everyone, never "not applicable". A statutory
    // population that silently empties when a remote host is down is the worst possible failure.
    throw new Error(
      `PF applicability cannot be resolved for ${payrollMonth}: the payroll source (db_bill) is `
      + `unreachable. ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  for (const row of billRows) {
    const code = String(row.EmpCode ?? "").trim().toUpperCase();
    if (!code || out.has(code)) continue;
    const flag = yesNo(row.PFELig);
    out.set(code, {
      employeeCode: code,
      status:
        flag === true ? "PF_APPLICABLE"
        : flag === false ? "PF_NOT_APPLICABLE"
        : "PF_APPLICABILITY_UNRESOLVED",
      source: "db_bill_payroll",
      reason:
        flag === null
          ? `The ${payrollMonth} payroll row carries an unreadable PF eligibility value`
          : `Resolved from the ${payrollMonth} payroll run`,
    });
  }

  // ── 2. HRMS-native fallback, for employees that period never paid ─────────
  const [hrmsRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.employee_code, s.pf_eligible
       FROM employees e
       JOIN employee_statutory_info s ON s.employee_id = e.id
      WHERE e.active_status = 1 AND e.employee_code IS NOT NULL`,
  );
  for (const row of hrmsRows as Array<{ employee_code?: unknown; pf_eligible?: unknown }>) {
    const code = String(row.employee_code ?? "").trim().toUpperCase();
    if (!code || out.has(code)) continue; // db_bill wins — it is what was actually paid
    const flag = yesNo(row.pf_eligible);
    if (flag === null) continue; // leave genuinely unresolved rather than inventing a default
    out.set(code, {
      employeeCode: code,
      status: flag ? "PF_APPLICABLE" : "PF_NOT_APPLICABLE",
      source: "hrms_statutory_info",
      reason: "Not in that period's payroll; resolved from the HRMS statutory record",
    });
  }

  return out;
}

/**
 * The same answer for one employee. Convenience only — it resolves the whole period, so do not
 * call it in a loop.
 */
export async function resolvePfApplicability(
  employeeCode: string,
  payrollMonth: string,
): Promise<PfApplicabilityResult> {
  const all = await resolvePfApplicabilityForPeriod(payrollMonth);
  const code = String(employeeCode ?? "").trim().toUpperCase();
  return (
    all.get(code) ?? {
      employeeCode: code,
      status: "PF_APPLICABILITY_UNRESOLVED",
      source: "none",
      reason:
        `Neither the ${payrollMonth} payroll run nor the HRMS statutory record says whether PF `
        + `applies to this employee`,
    }
  );
}

/** Population counts for a readiness screen. Unresolved is reported, never folded into "no". */
export function summarisePfApplicability(results: Iterable<PfApplicabilityResult>) {
  let applicable = 0, notApplicable = 0, unresolved = 0;
  let fromPayroll = 0, fromHrms = 0;
  for (const r of results) {
    if (r.status === "PF_APPLICABLE") applicable++;
    else if (r.status === "PF_NOT_APPLICABLE") notApplicable++;
    else unresolved++;
    if (r.source === "db_bill_payroll") fromPayroll++;
    else if (r.source === "hrms_statutory_info") fromHrms++;
  }
  return { applicable, notApplicable, unresolved, fromPayroll, fromHrms };
}
