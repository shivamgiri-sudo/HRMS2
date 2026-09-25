/**
 * Types for the Onfido AM/TL name-to-employee reconciliation feature.
 *
 * onfido_doc_external_audit_raw and onfido_agent_daily_raw (onfido_db) identify TL/AM
 * only via free-text VARCHAR columns, with no FK and no reliable cross-database join to
 * employees (mas_hrms). These types back the application-code matching layer that
 * reconciles those free-text names against real employee records, writing results into
 * onfido_name_employee_map (see migration backend/sql/1869_onfido_name_employee_map.sql).
 */

export type RawNameRole = "tl" | "am";

export interface EmployeeCandidate {
  id: string;
  fullName: string;
  employeeCode: string;
}

export type MatchMethod = "exact_name" | "emp_code" | "unmatched" | "ambiguous";

export interface MatchResult {
  employeeId: string | null;
  confidence: number; // 0.000 to 1.000
  method: MatchMethod;
}

/** A raw TL/AM name pulled from onfido_db, tagged with which role column it came from. */
export interface RawOnfidoName {
  rawName: string;
  rawRole: RawNameRole;
}

/** A row from onfido_name_employee_map (mas_hrms), as read back by the application. */
export interface MappingRow {
  id: string;
  rawName: string;
  rawRole: RawNameRole;
  employeeId: string | null;
  matchConfidence: number;
  matchMethod: MatchMethod;
  verifiedByHr: boolean;
}

/** Input to upsertMapping — the fields a match run (or HR review) writes. */
export interface UpsertMappingInput {
  rawName: string;
  rawRole: RawNameRole;
  employeeId: string | null;
  matchConfidence: number;
  matchMethod: MatchMethod;
}
