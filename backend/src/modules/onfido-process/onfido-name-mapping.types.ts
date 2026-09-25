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
