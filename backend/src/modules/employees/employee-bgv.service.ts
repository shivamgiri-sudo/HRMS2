/**
 * Employee BGV Service
 *
 * Provides BGV status for employees (via their linked candidate_id).
 * Used by both employee self-service and HR lookup views.
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

// Score weights matching frontend (NativeBGVReport.tsx line 143)
const SCORE_WEIGHTS: Record<string, number> = {
  aadhaar: 25,
  pan: 20,
  bank: 15,
  education: 10,
  employment: 10,
  address: 10,
  criminal: 10,
  court: 10, // alias for criminal
};

// Mandatory checks for most roles
const MANDATORY_CHECKS = ["aadhaar", "pan", "bank"];

export interface BgvCheck {
  id: string;
  check_type: string;
  status: string;
  match_score: number | null;
  matched_name: string | null;
  matched_dob: string | null;
  result_summary: string | null;
  risk_flags_json: string | null;
  verified_at: string | null;
  updated_at: string;
  provider_key: string | null;
}

export interface BgvReport {
  overall_verdict: string | null;
  report_date: string | null;
  hr_comments: string | null;
  aadhaar_status: string | null;
  pan_status: string | null;
  bank_status: string | null;
  education_status: string | null;
  employment_status: string | null;
  court_status: string | null;
  locked_at: string | null;
}

export interface BgvConsent {
  consent_status: string;
  granted_at: string;
}

export type OverallStatus = "clear" | "conditional" | "hold" | "pending" | "no_bgv_record";

export interface EmployeeBgvData {
  employeeId: string;
  candidateId: string | null;
  employeeName: string;
  status: OverallStatus;
  message?: string;
  score: number;
  overall_status: OverallStatus;
  checks: BgvCheck[];
  missing_mandatory_checks: string[];
  employee_creation_ready: boolean;
  payroll_activation_ready: boolean;
  consent: BgvConsent | null;
  report: BgvReport | null;
}

/**
 * Get BGV status for an employee
 */
export async function getEmployeeBgvStatus(employeeId: string): Promise<EmployeeBgvData> {
  // Get employee and linked candidate
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.id AS employee_id,
       e.employee_code,
       CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, '')) AS employee_name,
       e.candidate_id,
       e.branch_id,
       e.process_id
     FROM employees e
     WHERE e.id = ?
     LIMIT 1`,
    [employeeId]
  );

  if (!empRows.length) {
    throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
  }

  const employee = empRows[0];
  const candidateId = employee.candidate_id;

  // If no candidate linked, return early
  if (!candidateId) {
    return {
      employeeId: employee.employee_id,
      candidateId: null,
      employeeName: employee.employee_name?.trim() || "Unknown",
      status: "no_bgv_record",
      message: "No candidate record linked to this employee. BGV data is unavailable.",
      score: 0,
      overall_status: "no_bgv_record",
      checks: [],
      missing_mandatory_checks: MANDATORY_CHECKS,
      employee_creation_ready: false,
      payroll_activation_ready: false,
      consent: null,
      report: null,
    };
  }

  // Get BGV checks
  const [checkRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       id,
       check_type,
       status,
       match_score,
       matched_name,
       matched_dob,
       result_summary,
       risk_flags_json,
       verified_at,
       updated_at,
       provider_key
     FROM candidate_bgv_check
     WHERE candidate_id = ?
     ORDER BY updated_at DESC`,
    [candidateId]
  );

  const checks = checkRows as BgvCheck[];

  // Get BGV report
  const [reportRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       overall_verdict,
       report_date,
       hr_remarks AS hr_comments,
       aadhaar_status,
       pan_status,
       bank_status,
       education_status,
       employment_status,
       court_status,
       locked_at,
       bgv_score
     FROM candidate_bgv_report
     WHERE candidate_id = ?
     LIMIT 1`,
    [candidateId]
  );

  const reportRow = reportRows[0];
  const report: BgvReport | null = reportRow
    ? {
        overall_verdict: reportRow.overall_verdict,
        report_date: reportRow.report_date,
        hr_comments: reportRow.hr_comments,
        aadhaar_status: reportRow.aadhaar_status,
        pan_status: reportRow.pan_status,
        bank_status: reportRow.bank_status,
        education_status: reportRow.education_status,
        employment_status: reportRow.employment_status,
        court_status: reportRow.court_status,
        locked_at: reportRow.locked_at,
      }
    : null;

  // Get consent
  const [consentRows] = await db.execute<RowDataPacket[]>(
    `SELECT consent_status, granted_at
     FROM candidate_bgv_consent
     WHERE candidate_id = ? AND consent_status = 'granted'
     ORDER BY granted_at DESC
     LIMIT 1`,
    [candidateId]
  );

  const consent: BgvConsent | null = consentRows[0]
    ? {
        consent_status: consentRows[0].consent_status,
        granted_at: consentRows[0].granted_at,
      }
    : null;

  // Calculate score from checks (or use stored score if available)
  let score = reportRow?.bgv_score ?? 0;
  if (!score && checks.length > 0) {
    score = computeScoreFromChecks(checks);
  }

  // Determine missing mandatory checks
  const verifiedCheckTypes = new Set(
    checks
      .filter((c) => c.status === "verified" || c.status === "waived")
      .map((c) => normalizeCheckType(c.check_type))
  );
  const missingMandatory = MANDATORY_CHECKS.filter((ct) => !verifiedCheckTypes.has(ct));

  // Determine overall status
  let overallStatus: OverallStatus = "pending";
  if (report?.overall_verdict) {
    const verdict = report.overall_verdict.toLowerCase();
    if (verdict === "clear" || verdict === "passed") {
      overallStatus = "clear";
    } else if (verdict === "conditional" || verdict === "refer") {
      overallStatus = "conditional";
    } else if (verdict === "negative" || verdict === "failed" || verdict === "hold") {
      overallStatus = "hold";
    }
  } else if (score >= 60 && missingMandatory.length === 0) {
    overallStatus = "clear";
  } else if (score >= 40) {
    overallStatus = "conditional";
  }

  // Determine readiness flags
  const employeeCreationReady = missingMandatory.length === 0 && score >= 40;
  const payrollActivationReady = missingMandatory.length === 0 && score >= 60 && overallStatus !== "hold";

  return {
    employeeId: employee.employee_id,
    candidateId,
    employeeName: employee.employee_name?.trim() || "Unknown",
    status: overallStatus,
    score,
    overall_status: overallStatus,
    checks,
    missing_mandatory_checks: missingMandatory,
    employee_creation_ready: employeeCreationReady,
    payroll_activation_ready: payrollActivationReady,
    consent,
    report,
  };
}

/**
 * Get employee ID from user ID (for self-view)
 */
export async function getEmployeeIdForUser(userId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id FROM employees e WHERE e.user_id = ? LIMIT 1`,
    [userId]
  );
  return rows[0]?.id ?? null;
}

/**
 * Check if user has access to view another employee's BGV
 * (HR can view employees in their scope)
 */
export async function canViewEmployeeBgv(
  actorUserId: string,
  targetEmployeeId: string,
  actorRoles: string[]
): Promise<boolean> {
  // Super admin and admin can view all
  if (actorRoles.includes("super_admin") || actorRoles.includes("admin")) {
    return true;
  }

  // HR and payroll_hr can view employees in their branch/process scope
  if (actorRoles.includes("hr") || actorRoles.includes("payroll_hr") || actorRoles.includes("branch_head")) {
    // Get actor's scope
    const [actorRows] = await db.execute<RowDataPacket[]>(
      `SELECT e.branch_id, e.process_id FROM employees e WHERE e.user_id = ? LIMIT 1`,
      [actorUserId]
    );
    const actorScope = actorRows[0];
    if (!actorScope) return false;

    // Get target employee's scope
    const [targetRows] = await db.execute<RowDataPacket[]>(
      `SELECT branch_id, process_id FROM employees WHERE id = ? LIMIT 1`,
      [targetEmployeeId]
    );
    const targetScope = targetRows[0];
    if (!targetScope) return false;

    // Branch head can only view same branch
    if (actorRoles.includes("branch_head")) {
      return actorScope.branch_id === targetScope.branch_id;
    }

    // HR can view same branch or unassigned
    if (actorScope.branch_id && targetScope.branch_id) {
      return actorScope.branch_id === targetScope.branch_id;
    }

    return true; // HR without branch restriction can view all
  }

  return false;
}

/**
 * Compute BGV score from checks
 */
function computeScoreFromChecks(checks: BgvCheck[]): number {
  let score = 0;
  for (const check of checks) {
    if (check.status === "verified" || check.status === "waived") {
      const checkType = normalizeCheckType(check.check_type);
      score += SCORE_WEIGHTS[checkType] ?? 0;
    }
  }
  return score;
}

/**
 * Normalize check type (e.g., aadhaar_offline -> aadhaar)
 */
function normalizeCheckType(checkType: string): string {
  const normalized = checkType.toLowerCase().replace(/_offline$/, "");
  if (normalized === "court") return "criminal";
  if (normalized === "experience") return "employment";
  return normalized;
}
