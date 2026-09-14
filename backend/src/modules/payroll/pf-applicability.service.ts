import {
  resolveStatutoryFilingReadinessForPeriod,
  type FilingStatus,
} from "./statutory-filing-readiness.service.js";
import {
  resolveStatutoryApplicabilityForPeriod,
  type Applicability,
  type ApplicabilitySource,
} from "./statutory-applicability.service.js";
// billQuery is deliberately no longer imported here: the db_bill read moved to
// statutory-applicability.service.ts so PF and ESI resolve from ONE pass over the same row.
// The UAN filing-readiness resolver below still uses `db` for its own mas_hrms query.

/**
 * PF applicability — a thin projection of statutory-applicability.service.ts.
 *
 * This file used to hold its own db_bill query. When ESI applicability turned out to be the same
 * question against the same row — salary_data carries PFELig and ESIElig side by side for the
 * same (employee, month) — keeping a separate PF implementation would have meant two round trips
 * to db_bill for one readiness screen, and two places that had to agree about period parsing,
 * employee-code normalisation, which fallback wins, and what an unreadable flag means. That is
 * the two-rival-systems defect this audit keeps finding, so the query moved to one resolver and
 * this became a projection of it.
 *
 * The PF-shaped API is preserved deliberately: callers asking only about PF should not have to
 * know ESI exists, and PF_APPLICABILITY_UNRESOLVED reads better at a PF call site than a generic
 * UNRESOLVED. Behaviour is unchanged — the rules, sources and precedence all live in the shared
 * resolver, which is where they are tested.
 */

export type PfApplicability =
  | "PF_APPLICABLE"
  | "PF_NOT_APPLICABLE"
  | "PF_APPLICABILITY_UNRESOLVED";

export type PfApplicabilitySource = ApplicabilitySource;

export interface PfApplicabilityResult {
  employeeCode: string;
  status: PfApplicability;
  source: PfApplicabilitySource;
  /** Human-readable, for a readiness screen. Never a guess dressed as a fact. */
  reason: string;
}

const toPf = (status: Applicability): PfApplicability =>
  status === "APPLICABLE" ? "PF_APPLICABLE"
  : status === "NOT_APPLICABLE" ? "PF_NOT_APPLICABLE"
  : "PF_APPLICABILITY_UNRESOLVED";

export async function resolvePfApplicabilityForPeriod(
  payrollMonth: string,
): Promise<Map<string, PfApplicabilityResult>> {
  const all = await resolveStatutoryApplicabilityForPeriod(payrollMonth);
  const out = new Map<string, PfApplicabilityResult>();
  for (const [code, r] of all) {
    // An employee whose row resolved ESI but not PF is genuinely PF-unresolved, and is dropped
    // from this map rather than reported as a resolved PF answer — the caller asked about PF.
    if (r.pf.status === "UNRESOLVED" && r.pf.source === "hrms_statutory_info") continue;
    out.set(code, { employeeCode: code, status: toPf(r.pf.status), source: r.pf.source, reason: r.pf.reason });
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

// ═══════════════════════════════════════════════════════════════════════════
// UAN filing readiness — applicability plus identity
// ═══════════════════════════════════════════════════════════════════════════

/**
 * PF applicability tells you WHO should contribute. It says nothing about whether that
 * contribution can actually be FILED — a PF-applicable employee still needs a valid 12-digit
 * UAN before ECR will accept them. This resolver answers the second question, on top of the
 * first, for exactly the five states the 2026-08-17 go-live closure asked for:
 *
 *   READY                        — PF-applicable, and a valid 12-digit UAN is on file.
 *   NOT_APPLICABLE               — PF resolver says not applicable; UAN is irrelevant.
 *   MISSING_UAN                  — PF-applicable, no UAN in any of the three stores.
 *   INVALID_UAN                  — PF-applicable, a UAN exists but is not 12 digits.
 *   PF_APPLICABILITY_UNRESOLVED  — the underlying PF question itself could not be answered.
 *
 * `INVALID_UAN` did not exist anywhere in the codebase before this — every prior check treated
 * "a UAN is present" as sufficient, with no format check at the point of use.
 */

export type UanFilingStatus =
  | "READY"
  | "NOT_APPLICABLE"
  | "MISSING_UAN"
  | "INVALID_UAN"
  | "PF_APPLICABILITY_UNRESOLVED";

export type UanSource = "employees" | "employee_statutory_info" | "employee_uan" | "none";

export interface UanFilingReadinessResult {
  employeeCode: string;
  pfStatus: PfApplicability;
  pfSource: PfApplicabilitySource;
  uan: string | null;
  uanSource: UanSource;
  /** null only when uan itself is null — there is nothing to have validated. */
  uanValid: boolean | null;
  status: UanFilingStatus;
}

/**
 * Resolve UAN filing readiness for every active employee, for one payroll period.
 *
 * Same batching discipline as resolvePfApplicabilityForPeriod: one query for the whole period,
 * not a per-employee round trip.
 *
 * UAN PRECEDENCE — first non-empty wins, never merged or guessed:
 *   1. employees.uan_number             — the canonical HRMS field; verified live 2026-08-13,
 *                                          464 populated and every one already 12-digit valid.
 *   2. employee_statutory_info.uan_number — HRMS-native secondary store.
 *   3. employee_uan.uan (is_active = 1)   — legacy table; verified empty in production as of
 *                                          2026-08-16, kept as a source in case that changes.
 * This is the same three stores payroll-readiness-categories.service.ts's
 * STATUTORY_UAN_MISSING_FOR_PF_DEDUCTED already treats as "any one counts" — this resolver
 * additionally validates the FORMAT of whichever one is found, which that check does not.
 */
export async function resolveUanFilingReadinessForPeriod(
  payrollMonth: string,
): Promise<Map<string, UanFilingReadinessResult>> {
  // Projected from the shared filing-readiness resolver, which answers this question for PF and
  // ESI in one pass. Keeping a second PF-only implementation here would have meant two passes
  // over the same employee rows and two copies of the applicable-then-identifier precedence — the
  // same divergence that let PF and ESI applicability drift apart. The PF-shaped result is
  // preserved exactly, so callers and tests of this function are unaffected.
  const all = await resolveStatutoryFilingReadinessForPeriod(payrollMonth);

  const toPfStatus = (s: FilingStatus): UanFilingStatus =>
    s === "MISSING_ID" ? "MISSING_UAN"
    : s === "INVALID_ID" ? "INVALID_UAN"
    : s === "APPLICABILITY_UNRESOLVED" ? "PF_APPLICABILITY_UNRESOLVED"
    : s;

  const out = new Map<string, UanFilingReadinessResult>();
  for (const [code, r] of all) {
    out.set(code, {
      employeeCode: code,
      pfStatus: toPf(r.pf.applicability),
      pfSource: r.pf.applicabilitySource,
      uan: r.pf.identifier,
      uanSource: r.pf.identifierSource as UanSource,
      uanValid: r.pf.identifierValid,
      status: toPfStatus(r.pf.status),
    });
  }
  return out;
}

/** Population counts for a filing-readiness screen. */
export function summariseUanFilingReadiness(results: Iterable<UanFilingReadinessResult>) {
  let ready = 0, notApplicable = 0, missingUan = 0, invalidUan = 0, unresolved = 0;
  for (const r of results) {
    if (r.status === "READY") ready++;
    else if (r.status === "NOT_APPLICABLE") notApplicable++;
    else if (r.status === "MISSING_UAN") missingUan++;
    else if (r.status === "INVALID_UAN") invalidUan++;
    else unresolved++;
  }
  return { ready, notApplicable, missingUan, invalidUan, unresolved };
}
