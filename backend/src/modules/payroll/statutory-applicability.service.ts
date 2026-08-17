import type { RowDataPacket } from "mysql2";
import { billQuery } from "../../db/billDb.js";
import { db } from "../../db/mysql.js";

/**
 * The ONE answer to "does PF / ESI apply to this employee for this payroll period?".
 *
 * Owner ruling 2026-08-17 (option A): db_bill's monthly payroll row is authoritative, because it
 * is what actually happened to the employee's money. HRMS has not released a salary yet; db_bill
 * has, and its eligibility flags are the decisions that were applied when they were paid.
 *
 * WHY BOTH SCHEMES LIVE IN ONE RESOLVER
 *   PF and ESI are separate statutory schemes, but here they are the same question against the
 *   same row: salary_data carries PFELig and ESIElig side by side for the same (employee, month).
 *   Resolving them separately would mean two round trips to db_bill — MySQL 5.5 across the WAN,
 *   ~1,200 rows a period — for one readiness screen, and two places that must agree about which
 *   period, which employee-code normalisation and which fallback wins. Two rival implementations
 *   of one question is the defect this audit keeps finding; this is the version that does not
 *   create another one.
 *
 * WHY NOT COPY IT INTO mas_hrms
 *   Explicit owner instruction 2026-08-17: no duplicate tables or columns. This reads through to
 *   db_bill per period, the same pattern bank-payment-readiness already uses for credited
 *   accounts. A copied table would drift from the payroll that produced it, and the drift would
 *   be invisible — which is the failure mode this whole audit keeps finding.
 *
 * MEASURED LIVE 2026-08-17, against 1,327 active employees:
 *
 *                                  PF            ESI
 *     db_bill salary_data 2026-07  1,231 (93%)   1,231 (93%)   — zero unreadable either side
 *     employee_statutory_info         69 (5.2%)     69 (5.2%)
 *
 *   The data was never missing; it was in the system that pays people. A resolver built on
 *   employee_statutory_info alone would have covered 5% of the workforce and looked complete.
 *
 * GOING FORWARD (the second half of the ruling)
 *   HRMS must keep working as it takes over payroll. db_bill is therefore the FIRST source, not
 *   the only one:
 *
 *     1. db_bill salary_data for the period      — authoritative, what was actually paid
 *     2. employee_statutory_info                 — HRMS-native, for employees db_bill never paid
 *     3. *_APPLICABILITY_UNRESOLVED              — neither knows; never guessed
 *
 *   An HRMS-native joiner who has never appeared in a db_bill run resolves through (2), so the
 *   resolver does not stop working the moment payroll moves across.
 *
 * NEVER GUESSES
 *   There is deliberately no wage-threshold inference here, for either scheme. ESI coverage is
 *   wage-linked and PF has its own rules, but deriving either from salary would be inventing
 *   statutory policy — and an employee wrongly marked applicable has money deducted that should
 *   not have been, while one wrongly marked not-applicable is silently dropped from a filing.
 *
 * WHAT THIS DOES NOT ANSWER
 *   Applicability only — not identity. An applicable employee still needs a valid identifier
 *   before anything can be filed: a 12-digit UAN for PF, a 10-digit ESIC IP number for ESI.
 *   Coverage there is materially worse and is a separate question (measured 2026-08-17: of those
 *   applicable, 203 PF and 196 ESI have no identifier even after the db_bill backfill). Filing
 *   must fail closed on a missing identifier rather than quietly dropping the contributor.
 */

export type Scheme = "pf" | "esi";

export type Applicability =
  | "APPLICABLE"
  | "NOT_APPLICABLE"
  | "UNRESOLVED";

export type ApplicabilitySource = "db_bill_payroll" | "hrms_statutory_info" | "none";

export interface SchemeResult {
  status: Applicability;
  source: ApplicabilitySource;
  /** Human-readable, for a readiness screen. Never a guess dressed as a fact. */
  reason: string;
}

export interface StatutoryApplicabilityResult {
  employeeCode: string;
  pf: SchemeResult;
  esi: SchemeResult;
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

const unresolved = (reason: string): SchemeResult => ({ status: "UNRESOLVED", source: "none", reason });

const fromFlag = (flag: boolean | null, source: ApplicabilitySource, resolved: string, unreadable: string): SchemeResult =>
  flag === null
    ? { status: "UNRESOLVED", source, reason: unreadable }
    : { status: flag ? "APPLICABLE" : "NOT_APPLICABLE", source, reason: resolved };

/**
 * Resolve both schemes for the whole period in one pass.
 *
 * Batched deliberately: db_bill is MySQL 5.5 on a separate host, and a per-employee call would
 * mean over a thousand round trips per readiness screen. Callers wanting a single employee should
 * still use this and read one key out — the query is indexed on the period, not the employee.
 */
export async function resolveStatutoryApplicabilityForPeriod(
  payrollMonth: string,
): Promise<Map<string, StatutoryApplicabilityResult>> {
  if (!PERIOD_RE.test(payrollMonth)) {
    throw new Error(`Payroll month must be YYYY-MM, received "${payrollMonth}"`);
  }
  const out = new Map<string, StatutoryApplicabilityResult>();

  // ── 1. db_bill payroll for the period — authoritative ─────────────────────
  let billRows: Array<{ EmpCode?: unknown; PFELig?: unknown; ESIElig?: unknown }> = [];
  try {
    billRows = (await billQuery(
      `SELECT EmpCode, PFELig, ESIElig FROM salary_data
        WHERE DATE_FORMAT(SalDate, '%Y-%m') = ?
          AND EmpCode IS NOT NULL AND TRIM(EmpCode) <> ''`,
      [payrollMonth],
    )) as Array<{ EmpCode?: unknown; PFELig?: unknown; ESIElig?: unknown }>;
  } catch (err) {
    // db_bill unreachable is UNRESOLVED for everyone, never "not applicable". A statutory
    // population that silently empties when a remote host is down is the worst possible failure.
    throw new Error(
      `Statutory applicability cannot be resolved for ${payrollMonth}: the payroll source (db_bill) `
      + `is unreachable. ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  for (const row of billRows) {
    const code = String(row.EmpCode ?? "").trim().toUpperCase();
    if (!code || out.has(code)) continue;
    const resolvedFrom = `Resolved from the ${payrollMonth} payroll run`;
    const unreadableIn = (s: string) => `The ${payrollMonth} payroll row carries an unreadable ${s} eligibility value`;
    out.set(code, {
      employeeCode: code,
      pf: fromFlag(yesNo(row.PFELig), "db_bill_payroll", resolvedFrom, unreadableIn("PF")),
      esi: fromFlag(yesNo(row.ESIElig), "db_bill_payroll", resolvedFrom, unreadableIn("ESI")),
    });
  }

  // ── 2. HRMS-native fallback, for employees that period never paid ─────────
  const [hrmsRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.employee_code, s.pf_eligible, s.esi_eligible
       FROM employees e
       JOIN employee_statutory_info s ON s.employee_id = e.id
      WHERE e.active_status = 1 AND e.employee_code IS NOT NULL`,
  );
  for (const row of hrmsRows as Array<{ employee_code?: unknown; pf_eligible?: unknown; esi_eligible?: unknown }>) {
    const code = String(row.employee_code ?? "").trim().toUpperCase();
    if (!code || out.has(code)) continue; // db_bill wins — it is what was actually paid
    const native = "Not in that period's payroll; resolved from the HRMS statutory record";
    const pf = yesNo(row.pf_eligible);
    const esi = yesNo(row.esi_eligible);
    // Only record the employee if at least one scheme is actually readable. A row where both are
    // junk tells us nothing and must stay unresolved rather than appear as a resolved entry.
    if (pf === null && esi === null) continue;
    out.set(code, {
      employeeCode: code,
      pf: pf === null
        ? unresolved("The HRMS statutory record holds no readable PF eligibility")
        : fromFlag(pf, "hrms_statutory_info", native, ""),
      esi: esi === null
        ? unresolved("The HRMS statutory record holds no readable ESI eligibility")
        : fromFlag(esi, "hrms_statutory_info", native, ""),
    });
  }

  // ── 3. HRMS statutory overrides — approved opt-outs win over both prior sources ────────────
  // An approved pf_opt_out or esic_opt_out with effective_from_month <= payrollMonth means the
  // employee is NOT_APPLICABLE for ECR filing, regardless of what db_bill recorded for the period.
  // db_bill's row may predate the approval or reflect a run that predates the elected month.
  const [overrideRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.employee_code, eso.override_type
       FROM employee_statutory_override eso
       JOIN employees e ON e.id = eso.employee_id
      WHERE eso.status = 'approved'
        AND (eso.effective_from_month IS NULL OR eso.effective_from_month <= ?)`,
    [payrollMonth],
  );
  for (const row of overrideRows as Array<{ employee_code?: unknown; override_type?: unknown }>) {
    const code = String(row.employee_code ?? "").trim().toUpperCase();
    if (!code) continue;
    const optOutReason = "HRMS statutory opt-out approved in employee_statutory_override — not applicable from the elected month";
    const notApplicable: SchemeResult = { status: "NOT_APPLICABLE", source: "hrms_statutory_info", reason: optOutReason };
    const existing = out.get(code);
    if (String(row.override_type) === "pf_opt_out") {
      out.set(code, existing
        ? { ...existing, pf: notApplicable }
        : { employeeCode: code, pf: notApplicable, esi: unresolved("No ESI data available; employee has a PF opt-out on file") }
      );
    } else if (String(row.override_type) === "esic_opt_out") {
      out.set(code, existing
        ? { ...existing, esi: notApplicable }
        : { employeeCode: code, pf: unresolved("No PF data available; employee has an ESI opt-out on file"), esi: notApplicable }
      );
    }
  }

  return out;
}

/** The same answer for one employee. Convenience only — it resolves the whole period. */
export async function resolveStatutoryApplicability(
  employeeCode: string,
  payrollMonth: string,
): Promise<StatutoryApplicabilityResult> {
  const all = await resolveStatutoryApplicabilityForPeriod(payrollMonth);
  const code = String(employeeCode ?? "").trim().toUpperCase();
  const none = (scheme: string) =>
    unresolved(
      `Neither the ${payrollMonth} payroll run nor the HRMS statutory record says whether ${scheme} `
      + `applies to this employee`,
    );
  return all.get(code) ?? { employeeCode: code, pf: none("PF"), esi: none("ESI") };
}

/** Population counts for a readiness screen. Unresolved is reported, never folded into "no". */
export function summariseApplicability(
  results: Iterable<StatutoryApplicabilityResult>,
  scheme: Scheme,
) {
  let applicable = 0, notApplicable = 0, unresolvedCount = 0;
  let fromPayroll = 0, fromHrms = 0;
  for (const r of results) {
    const s = r[scheme];
    if (s.status === "APPLICABLE") applicable++;
    else if (s.status === "NOT_APPLICABLE") notApplicable++;
    else unresolvedCount++;
    if (s.source === "db_bill_payroll") fromPayroll++;
    else if (s.source === "hrms_statutory_info") fromHrms++;
  }
  return { applicable, notApplicable, unresolved: unresolvedCount, fromPayroll, fromHrms };
}
