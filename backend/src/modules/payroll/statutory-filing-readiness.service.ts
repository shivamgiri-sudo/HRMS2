import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { UAN_FORMAT, ESI_FORMAT } from "../../shared/statutoryFormat.js";
import {
  resolveStatutoryApplicabilityForPeriod,
  type Applicability,
  type ApplicabilitySource,
  type Scheme,
} from "./statutory-applicability.service.js";

/**
 * Can this employee's contribution actually be FILED this period?
 *
 * Applicability answers who should contribute. It says nothing about whether the filing will be
 * accepted: an applicable employee still needs a valid government identifier — a 12-digit UAN for
 * PF, a 10-digit ESIC IP number for ESI. This resolver answers both questions together, per
 * scheme, in five states:
 *
 *   READY                     — applicable, and a well-formed identifier is on file
 *   NOT_APPLICABLE            — the scheme does not apply; the identifier is irrelevant
 *   MISSING_ID                — applicable, but no identifier in any store
 *   INVALID_ID                — applicable, an identifier exists but is malformed
 *   APPLICABILITY_UNRESOLVED  — the underlying applicability question could not be answered
 *
 * WHY ONE RESOLVER FOR BOTH SCHEMES
 *   PF readiness already existed (resolveUanFilingReadinessForPeriod). Adding ESI beside it as a
 *   second implementation would have meant two passes over the same employee rows, two copies of
 *   the applicable-then-identifier precedence, and two places to keep in step — the same
 *   two-rival-systems defect that made PF and ESI applicability diverge in the first place. The
 *   PF entry point is preserved and now projects from here, so its callers and tests are
 *   unaffected.
 *
 * MEASURED LIVE 2026-08-17 (applicability from db_bill 2026-07; HRMS fallback moves ~53 rows out
 * of UNRESOLVED):
 *
 *                READY   NOT_APPLICABLE   MISSING_ID   INVALID_ID   UNRESOLVED
 *     UAN / PF     472              321          443            0           96
 *     ESIC / ESI   334              510          392            0           96
 *
 *   INVALID_ID is genuinely zero today, not masked: all 12 active employees holding a malformed
 *   ESIC value ("Not Applicable" on three, "0" on five, wrong length on four) are ESIElig = NO,
 *   so they classify NOT_APPLICABLE before the format check is reached. The state still earns its
 *   place — someone typing "Not Applicable" into the identifier field of a covered employee is
 *   the same keystroke one row over, and that row must not read as filable.
 *
 * IDENTIFIER PRECEDENCE — first non-empty wins, never merged, never guessed.
 *   Reading a single column is not enough and was measured, not assumed:
 *   employee_statutory_info.esi_number holds 39 active employees that employees.esic_number does
 *   not, and of the 14 carrying both, ZERO disagree.
 */

export type FilingStatus =
  | "READY"
  | "NOT_APPLICABLE"
  | "MISSING_ID"
  | "INVALID_ID"
  | "APPLICABILITY_UNRESOLVED";

/** Where an identifier was found. Ordered as searched. */
export type IdentifierSource =
  | "employees"
  | "employee_statutory_info"
  | "employee_uan"
  | "none";

export interface SchemeFilingReadiness {
  status: FilingStatus;
  /**
   * The applicability answer this status was built on, carried through rather than recomputed.
   * A readiness screen showing MISSING_ID needs to say whether that employee is covered because
   * payroll actually paid them that way, or because an HRMS record says so — the two invite very
   * different follow-up from HR.
   */
  applicability: Applicability;
  applicabilitySource: ApplicabilitySource;
  identifier: string | null;
  identifierSource: IdentifierSource;
  /** null only when identifier itself is null — there is nothing to have validated. */
  identifierValid: boolean | null;
}

export interface StatutoryFilingReadinessResult {
  employeeCode: string;
  pf: SchemeFilingReadiness;
  esi: SchemeFilingReadiness;
}

const pickFirst = (
  candidates: Array<[unknown, IdentifierSource]>,
): { value: string | null; source: IdentifierSource } => {
  for (const [raw, source] of candidates) {
    const trimmed = String(raw ?? "").trim();
    if (trimmed) return { value: trimmed, source };
  }
  return { value: null, source: "none" };
};

const classify = (
  applicable: "APPLICABLE" | "NOT_APPLICABLE" | "UNRESOLVED",
  value: string | null,
  valid: boolean | null,
): FilingStatus => {
  if (applicable === "UNRESOLVED") return "APPLICABILITY_UNRESOLVED";
  if (applicable === "NOT_APPLICABLE") return "NOT_APPLICABLE";
  if (value === null) return "MISSING_ID";
  return valid ? "READY" : "INVALID_ID";
};

/**
 * Resolve filing readiness for both schemes, for every active employee, for one payroll period.
 *
 * Two queries total regardless of headcount: one to db_bill for applicability (via the shared
 * resolver) and one to mas_hrms for identifiers. Not per-employee — db_bill is MySQL 5.5 across
 * the WAN and a readiness screen must not become a thousand round trips.
 */
export async function resolveStatutoryFilingReadinessForPeriod(
  payrollMonth: string,
): Promise<Map<string, StatutoryFilingReadinessResult>> {
  const applicability = await resolveStatutoryApplicabilityForPeriod(payrollMonth);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.employee_code,
            e.uan_number  AS uan_employees,
            si.uan_number AS uan_statutory_info,
            eu.uan        AS uan_employee_uan,
            e.esic_number AS esi_employees,
            si.esi_number AS esi_statutory_info
       FROM employees e
       LEFT JOIN employee_statutory_info si ON si.employee_id = e.id
       LEFT JOIN employee_uan eu ON eu.employee_id = e.id AND eu.is_active = 1
      WHERE e.active_status = 1 AND e.employee_code IS NOT NULL`,
  );

  const out = new Map<string, StatutoryFilingReadinessResult>();
  for (const row of rows as Array<Record<string, unknown>>) {
    const code = String(row.employee_code ?? "").trim().toUpperCase();
    if (!code) continue;

    const app = applicability.get(code);

    const uan = pickFirst([
      [row.uan_employees, "employees"],
      [row.uan_statutory_info, "employee_statutory_info"],
      [row.uan_employee_uan, "employee_uan"],
    ]);
    const esi = pickFirst([
      [row.esi_employees, "employees"],
      [row.esi_statutory_info, "employee_statutory_info"],
    ]);

    const uanValid = uan.value === null ? null : UAN_FORMAT.test(uan.value);
    const esiValid = esi.value === null ? null : ESI_FORMAT.test(esi.value);

    out.set(code, {
      employeeCode: code,
      pf: {
        status: classify(app?.pf.status ?? "UNRESOLVED", uan.value, uanValid),
        applicability: app?.pf.status ?? "UNRESOLVED",
        applicabilitySource: app?.pf.source ?? "none",
        identifier: uan.value,
        identifierSource: uan.source,
        identifierValid: uanValid,
      },
      esi: {
        status: classify(app?.esi.status ?? "UNRESOLVED", esi.value, esiValid),
        applicability: app?.esi.status ?? "UNRESOLVED",
        applicabilitySource: app?.esi.source ?? "none",
        identifier: esi.value,
        identifierSource: esi.source,
        identifierValid: esiValid,
      },
    });
  }
  return out;
}

/** Population counts for a filing-readiness screen, per scheme. */
export function summariseFilingReadiness(
  results: Iterable<StatutoryFilingReadinessResult>,
  scheme: Scheme,
) {
  let ready = 0, notApplicable = 0, missingId = 0, invalidId = 0, unresolved = 0;
  for (const r of results) {
    switch (r[scheme].status) {
      case "READY": ready++; break;
      case "NOT_APPLICABLE": notApplicable++; break;
      case "MISSING_ID": missingId++; break;
      case "INVALID_ID": invalidId++; break;
      default: unresolved++;
    }
  }
  return { ready, notApplicable, missingId, invalidId, unresolved };
}
