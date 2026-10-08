/**
 * Governance executor — placeholder implementations
 *
 * Codes: compliance-audit-summary, help-desk-summary,
 *        grievance-register, audit-observation-register
 *
 * These functions are intentional stubs. The source tables
 * (compliance_checklist_response, helpdesk_ticket, grievance_record,
 * audit_observation) are under validation and may not yet exist in all
 * environments.  Each function returns an empty result set so that the
 * catalog can register and reference them as "draft" reports without
 * causing runtime errors.
 *
 * Replace the stub body with real SQL once the underlying tables are
 * confirmed in the schema baseline.
 */
import type { ExecFilters, ExecScope, ExecOptions, ExecResult } from "./types.js";

// ---------------------------------------------------------------------------
// compliance-audit-summary
// ---------------------------------------------------------------------------
export async function complianceAuditSummary(
  _filters: ExecFilters,
  _scope: ExecScope,
  _options: ExecOptions
): Promise<ExecResult> {
  return { rows: [], rowCount: 0, isTruncated: false };
}

// ---------------------------------------------------------------------------
// help-desk-summary
// ---------------------------------------------------------------------------
export async function helpDeskSummary(
  _filters: ExecFilters,
  _scope: ExecScope,
  _options: ExecOptions
): Promise<ExecResult> {
  return { rows: [], rowCount: 0, isTruncated: false };
}

// ---------------------------------------------------------------------------
// grievance-register
// ---------------------------------------------------------------------------
export async function grievanceRegister(
  _filters: ExecFilters,
  _scope: ExecScope,
  _options: ExecOptions
): Promise<ExecResult> {
  return { rows: [], rowCount: 0, isTruncated: false };
}

// ---------------------------------------------------------------------------
// audit-observation-register
// ---------------------------------------------------------------------------
export async function auditObservationRegister(
  _filters: ExecFilters,
  _scope: ExecScope,
  _options: ExecOptions
): Promise<ExecResult> {
  return { rows: [], rowCount: 0, isTruncated: false };
}
