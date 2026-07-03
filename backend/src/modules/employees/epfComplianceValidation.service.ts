import { createHash } from "crypto";
import type { RowDataPacket } from "mysql2";

import { db } from "../../db/mysql.js";

export type EpfNomineeInput = {
  nominee_name?: string | null;
  relationship?: string | null;
  date_of_birth?: string | null;
  share_percentage?: number | null;
  guardian_name?: string | null;
  guardian_relationship?: string | null;
  aadhaar_last4?: string | null;
  address_line?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  is_primary?: boolean;
};

export type EpfProfileInput = {
  employee_name?: string | null;
  father_or_spouse_name?: string | null;
  relationship_type?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  marital_status?: string | null;
  mobile_number?: string | null;
  personal_email?: string | null;
  aadhaar_number?: string | null;
  pan_number?: string | null;
  uan_number?: string | null;
  previous_pf_member?: boolean;
  previous_eps_member?: boolean;
  international_worker?: boolean;
  excluded_employee?: boolean;
  joining_date?: string | null;
  basic_wage?: number | null;
  gross_monthly_wage?: number | null;
};

export type EpfValidationIssue = {
  code: string;
  severity: "info" | "warning" | "error";
  status: "passed" | "failed";
  message: string;
  field_name?: string;
  payload?: Record<string, unknown>;
};

export type EpfValidationSummary = {
  issues: EpfValidationIssue[];
  ready_for_submission: boolean;
  ecr_ready: boolean;
  missing_fields: string[];
  inferred_status: "draft" | "hr_fill_required" | "employee_review_pending" | "payroll_review_pending" | "ready";
  uan_hash: string | null;
  aadhaar_hash: string | null;
  pan_hash: string | null;
  uan_masked: string | null;
  aadhaar_masked: string | null;
  pan_masked: string | null;
};

function digitsOnly(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function hashValue(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized ? createHash("sha256").update(normalized).digest("hex") : null;
}

function maskDigits(value: unknown, last = 4) {
  const digits = digitsOnly(value);
  if (!digits) return null;
  return `${"X".repeat(Math.max(0, digits.length - last))}${digits.slice(-last)}`;
}

function maskPan(value: unknown) {
  const pan = String(value ?? "").trim().toUpperCase();
  if (!pan) return null;
  return `${pan.slice(0, 3)}XXXX${pan.slice(-2)}`;
}

function requiredString(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

async function findDuplicateUan(uanHash: string, employeeId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id
       FROM employee_epf_compliance_profile
      WHERE uan_hash = ?
        AND employee_id <> ?
      LIMIT 1`,
    [uanHash, employeeId],
  );
  return rows.length > 0;
}

export async function validateEpfCompliance(
  employeeId: string,
  profile: EpfProfileInput,
  nominees: EpfNomineeInput[],
): Promise<EpfValidationSummary> {
  const issues: EpfValidationIssue[] = [];
  const missingFields: string[] = [];

  const employeeName = requiredString(profile.employee_name);
  const fatherOrSpouseName = requiredString(profile.father_or_spouse_name);
  const relationshipType = requiredString(profile.relationship_type);
  const dateOfBirth = requiredString(profile.date_of_birth);
  const mobileNumber = digitsOnly(profile.mobile_number);
  const joiningDate = requiredString(profile.joining_date);
  const personalEmail = requiredString(profile.personal_email);
  const basicWage = Number(profile.basic_wage ?? 0);
  const grossMonthlyWage = Number(profile.gross_monthly_wage ?? 0);
  const uanDigits = digitsOnly(profile.uan_number);

  const requiredChecks: Array<[string, string, string | null]> = [
    ["employee_name", "Employee name is required for EPF declaration.", employeeName],
    ["father_or_spouse_name", "Father or spouse name is required.", fatherOrSpouseName],
    ["relationship_type", "Relationship type must be selected.", relationshipType],
    ["date_of_birth", "Date of birth is required.", dateOfBirth],
    ["mobile_number", "Mobile number is required.", mobileNumber || null],
    ["joining_date", "Date of joining is required.", joiningDate],
    ["personal_email", "Personal email is required for employee review.", personalEmail],
  ];

  for (const [fieldName, message, value] of requiredChecks) {
    if (!value) {
      missingFields.push(fieldName);
      issues.push({
        code: `MISSING_${fieldName.toUpperCase()}`,
        severity: "error",
        status: "failed",
        message,
        field_name: fieldName,
      });
    }
  }

  if (uanDigits && uanDigits.length !== 12) {
    issues.push({
      code: "UAN_INVALID_LENGTH",
      severity: "error",
      status: "failed",
      message: "UAN must be exactly 12 digits.",
      field_name: "uan_number",
    });
  }

  if (profile.previous_pf_member && !uanDigits) {
    missingFields.push("uan_number");
    issues.push({
      code: "UAN_REQUIRED_FOR_PREVIOUS_PF",
      severity: "error",
      status: "failed",
      message: "UAN is required when the employee declares previous PF membership.",
      field_name: "uan_number",
    });
  }

  if (profile.previous_eps_member && !profile.previous_pf_member) {
    issues.push({
      code: "EPS_WITHOUT_PF",
      severity: "error",
      status: "failed",
      message: "Previous EPS membership cannot be marked without previous PF membership.",
      field_name: "previous_eps_member",
    });
  }

  if (basicWage > 0 && grossMonthlyWage > 0 && basicWage > grossMonthlyWage) {
    issues.push({
      code: "BASIC_EXCEEDS_GROSS",
      severity: "error",
      status: "failed",
      message: "Basic wage cannot be greater than gross monthly wage.",
      field_name: "basic_wage",
      payload: { basic_wage: basicWage, gross_monthly_wage: grossMonthlyWage },
    });
  }

  const nomineeTotal = nominees.reduce((sum, nominee) => sum + Number(nominee.share_percentage ?? 0), 0);
  if (nominees.length === 0) {
    missingFields.push("nominees");
    issues.push({
      code: "NOMINEE_REQUIRED",
      severity: "error",
      status: "failed",
      message: "At least one nominee is required for the EPF compliance pack.",
      field_name: "nominees",
    });
  } else if (Math.round(nomineeTotal * 100) / 100 !== 100) {
    issues.push({
      code: "NOMINEE_SHARE_NOT_100",
      severity: "error",
      status: "failed",
      message: `Nominee share must total 100%. Current total is ${nomineeTotal}%.`,
      field_name: "nominees",
      payload: { total_share_percentage: nomineeTotal },
    });
  }

  nominees.forEach((nominee, index) => {
    if (!requiredString(nominee.nominee_name)) {
      issues.push({
        code: `NOMINEE_${index + 1}_NAME_REQUIRED`,
        severity: "error",
        status: "failed",
        message: `Nominee ${index + 1} name is required.`,
        field_name: `nominees.${index}.nominee_name`,
      });
    }
    if (!requiredString(nominee.relationship)) {
      issues.push({
        code: `NOMINEE_${index + 1}_RELATION_REQUIRED`,
        severity: "error",
        status: "failed",
        message: `Nominee ${index + 1} relationship is required.`,
        field_name: `nominees.${index}.relationship`,
      });
    }
  });

  const uanHash = hashValue(uanDigits);
  if (uanHash && await findDuplicateUan(uanHash, employeeId)) {
    issues.push({
      code: "UAN_DUPLICATE",
      severity: "error",
      status: "failed",
      message: "This UAN is already mapped to another employee in HRMS.",
      field_name: "uan_number",
    });
  }

  if (grossMonthlyWage > 15000 && !profile.excluded_employee && !profile.previous_pf_member) {
    issues.push({
      code: "WAGE_CEILING_WARNING",
      severity: "warning",
      status: "failed",
      message: "Gross monthly wage is above the usual EPF wage ceiling. Review excluded employee handling before approval.",
      field_name: "gross_monthly_wage",
      payload: { gross_monthly_wage: grossMonthlyWage },
    });
  }

  if (profile.international_worker) {
    issues.push({
      code: "INTERNATIONAL_WORKER_REVIEW",
      severity: "info",
      status: "failed",
      message: "International worker cases require payroll review before ECR readiness.",
      field_name: "international_worker",
    });
  }

  const hasErrors = issues.some((issue) => issue.severity === "error");
  const inferredStatus: EpfValidationSummary["inferred_status"] =
    hasErrors ? "hr_fill_required"
      : missingFields.length > 0 ? "employee_review_pending"
        : "ready";

  return {
    issues,
    ready_for_submission: !hasErrors,
    ecr_ready: !hasErrors && missingFields.length === 0,
    missing_fields: missingFields,
    inferred_status: inferredStatus,
    uan_hash: uanHash,
    aadhaar_hash: hashValue(digitsOnly(profile.aadhaar_number)),
    pan_hash: hashValue(profile.pan_number),
    uan_masked: maskDigits(uanDigits),
    aadhaar_masked: maskDigits(profile.aadhaar_number),
    pan_masked: maskPan(profile.pan_number),
  };
}
