import { createHash, randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import PDFDocumentKit from "pdfkit";
import pdfLib from "pdf-lib";
const { PDFDocument, StandardFonts } = pdfLib;
import PizZip from "pizzip";
import { epfNominationFieldMaps } from "./epfNominationForm.js";
import { getPayrollHrSignatoryForEmployee, mergeBranchSignatureIntoSeal } from "./branchPayrollHrSignatory.service.js";
import { isOperationsExecutiveByRegex } from "../wfm/attendance-engine.service.js";
import type { RowDataPacket } from "mysql2";

import { db } from "../../db/mysql.js";
import { fillAcroFormPdf, validateAcroFormTemplate } from "./pdfAcroFormFill.service.js";
import { applyCompanySeal, loadCompanySeal } from "./companySeal.service.js";
import { resolveTemplateFile } from "./joiningDocumentTemplatePath.js";
import { hasStructuredPdf, renderJoiningDocumentPdf } from "./joiningDocumentPdf.service.js";
import { resolveEmployeeLetterhead } from "../org/branchAddress.service.js";

const STORAGE_ROOT = path.resolve(process.cwd(), "private-storage", "employee-joining-documents");

type FieldMapInput = {
  id?: string;
  field_key: string;
  field_label: string;
  source_path?: string | null;
  page_no?: number;
  x?: number | null;
  y?: number | null;
  width?: number | null;
  height?: number | null;
  font_size?: number | null;
  font_weight?: string | null;
  alignment?: string | null;
  field_type?: string | null;
  required?: boolean;
  masking_rule?: string | null;
  mapping_mode?: string | null;
  placeholder_token?: string | null;
  pdf_field_name?: string | null;
  transform_rule?: string | null;
  checked_when?: string | null;
  min_font_size?: number | null;
  max_font_size?: number | null;
  max_length?: number | null;
  validation_rule?: string | null;
  overflow_strategy?: "shrink" | "wrap" | "block" | null;
  schema_field_tooltip?: string | null;
  schema_suggested_path?: string | null;
  mapping_confirmed?: boolean | number | null;
};

type FieldValueUpdate = {
  field_key: string;
  value_text: string;
  reason?: string | null;
};

type DefaultFieldMap = FieldMapInput & {
  aliases?: string[];
};

type ChecklistContextRow = {
  checklist_id: string;
  employee_id: string;
  candidate_id: string | null;
  document_code: string;
  document_name: string;
  template_id: string | null;
  template_name: string | null;
  template_storage_path: string | null;
  template_mime_type: string | null;
  fill_mode: string | null;
  template_schema_json: string | null;
};

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeTrim(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function digitsOnly(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function hashValue(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized ? createHash("sha256").update(normalized).digest("hex") : null;
}

function maskDigits(value: unknown, visible = 4) {
  const digits = digitsOnly(value);
  if (!digits) return null;
  return `${"X".repeat(Math.max(0, digits.length - visible))}${digits.slice(-visible)}`;
}

function maskPan(value: unknown) {
  const pan = safeTrim(value)?.toUpperCase();
  if (!pan) return null;
  return `${pan.slice(0, 3)}XXXX${pan.slice(-2)}`;
}

function maskBankAccount(value: unknown) {
  const digits = digitsOnly(value);
  if (!digits) return null;
  return `XXXXXX${digits.slice(-4)}`;
}

/**
 * A yes/no box on a statutory form has three states, not two.
 *
 * Form 11 asks whether the member was previously in the PF and the EPS. The
 * resolution was `Number(x ?? 0) === 1` for the Yes box and `!== 1` for the No
 * box, so an employee whose answer is simply unrecorded — which is nearly all of
 * them, the source table holding 4 rows — had "No" ticked on their behalf.
 * Declaring a previous membership does not exist is not the same as not knowing,
 * and on a signed statutory form the difference matters.
 *
 * Returns null when nothing answered the question, which leaves both boxes blank
 * for the member to complete, exactly as an unfilled form would be.
 */
function tri(...candidates: unknown[]): boolean | null {
  for (const value of candidates) {
    if (value == null || value === "") continue;
    return Number(value) === 1;
  }
  return null;
}

/**
 * Reads a NOT NULL DEFAULT 0 flag as an answer only when it says yes.
 *
 * All five flags on employee_epf_compliance_profile, and international_worker on
 * candidate_onboarding_profile, are NOT NULL DEFAULT 0. They therefore cannot be
 * null, and a 0 is indistinguishable from never having been asked — creating a
 * profile row instantly "answers" every one of them with No. A 1 is a real
 * declaration and is trusted; a 0 falls through so a nullable source can answer,
 * and if none does the boxes stay blank.
 *
 * The nullable columns (candidate_onboarding_profile.previous_pf_member and
 * .eps_member) are the only place a genuine "No" can come from, and tri() reads
 * those directly.
 */
function affirmativeOnly(value: unknown): 1 | null {
  return value != null && Number(value) === 1 ? 1 : null;
}

function nestedValue(source: Record<string, unknown>, sourcePath?: string | null) {
  const normalized = safeTrim(sourcePath);
  if (!normalized) return null;
  return normalized.split(".").reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== "object") return null;
    return (acc as Record<string, unknown>)[key] ?? null;
  }, source);
}

function formatValueForField(value: unknown, fieldType: string, checkedWhen?: string | null) {
  if (value == null) return "";
  if (fieldType === "checkbox" || fieldType === "radio") {
    // A map with `checked_when` selects one box out of a group by comparing the
    // stored value against a discriminant — "Male" picks gender_male, "father"
    // picks relationship_father. Collapsing to "Yes" here would destroy that
    // discriminant and leave every box in the group unticked, so keep the raw
    // value verbatim and let pdfAcroFormFill do the comparison.
    if (checkedWhen) return String(value);
    return value ? "Yes" : "";
  }
  return String(value);
}

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const COMMON_TEMPLATE_FIELDS: DefaultFieldMap[] = [
  { field_key: "employee_name", field_label: "Employee Name", source_path: "employee.full_name", required: true, aliases: ["employee_name", "name", "candidate_name"] },
  { field_key: "employee_code", field_label: "Employee Code", source_path: "employee.employee_code", required: false, aliases: ["employee_code", "emp_code", "employee_id"] },
  { field_key: "father_name", field_label: "Father / Spouse Name", source_path: "employee.father_name", required: false, aliases: ["father_name", "father_or_spouse_name"] },
  { field_key: "date_of_birth", field_label: "Date of Birth", source_path: "employee.date_of_birth", required: false, field_type: "date", aliases: ["date_of_birth", "dob"] },
  { field_key: "date_of_joining", field_label: "Date of Joining", source_path: "employee.date_of_joining", required: false, field_type: "date", aliases: ["date_of_joining", "doj", "joining_date"] },
  { field_key: "designation", field_label: "Designation", source_path: "employee.designation", required: false, aliases: ["designation"] },
  { field_key: "department", field_label: "Department", source_path: "employee.department", required: false, aliases: ["department"] },
  { field_key: "branch", field_label: "Branch", source_path: "employee.branch", required: false, aliases: ["branch", "location"] },
  { field_key: "process", field_label: "Process", source_path: "employee.process", required: false, aliases: ["process"] },
  { field_key: "mobile", field_label: "Mobile Number", source_path: "employee.mobile", required: false, aliases: ["mobile", "mobile_number", "phone"] },
  { field_key: "email", field_label: "Email", source_path: "employee.email", required: false, field_type: "email", aliases: ["email", "personal_email"] },
  { field_key: "pan_masked", field_label: "PAN", source_path: "statutory.pan_masked", required: false, masking_rule: "pan", aliases: ["pan", "pan_number"] },
  { field_key: "aadhaar_masked", field_label: "Aadhaar", source_path: "statutory.aadhaar_masked", required: false, masking_rule: "aadhaar", aliases: ["aadhaar", "aadhaar_number"] },
  { field_key: "uan", field_label: "UAN", source_path: "statutory.uan", required: false, aliases: ["uan", "uan_number"] },
  { field_key: "current_date", field_label: "Current Date", source_path: "system.current_date", required: false, field_type: "date", aliases: ["date", "current_date", "signed_date"] },
  { field_key: "nda_employee_name", field_label: "NDA Agreement - Employee Name", source_path: "employee.full_name", required: true, aliases: ["nda_employee_name"] },
  { field_key: "nda_signature_date", field_label: "NDA Agreement - Signature Date", source_path: "system.current_date", required: true, field_type: "date", aliases: ["nda_signature_date"] },
  { field_key: "it_employee_name", field_label: "IT Compliance - Employee Name", source_path: "employee.full_name", required: true, aliases: ["it_employee_name"] },
  { field_key: "it_signature_date", field_label: "IT Compliance - Signature Date", source_path: "system.current_date", required: true, field_type: "date", aliases: ["it_signature_date"] },
  { field_key: "surveillance_candidate_name", field_label: "Surveillance/Anti-Bribery - Candidate Name", source_path: "employee.full_name", required: true, aliases: ["surveillance_candidate_name"] },
  // Was source_path: null, so this printed blank on every NDA ever issued. It
  // is the Payroll HR of the branch the candidate joins, configured per branch.
  { field_key: "surveillance_hr_name", field_label: "Surveillance/Anti-Bribery - HR Name", source_path: "payroll_hr.name", required: false, aliases: ["surveillance_hr_name"] },
  { field_key: "surveillance_signature_date", field_label: "Surveillance/Anti-Bribery - Signature Date", source_path: "system.current_date", required: true, field_type: "date", aliases: ["surveillance_signature_date"] },
  { field_key: "bams_employee_name", field_label: "BAMS Declaration - Employee Name", source_path: "employee.full_name", required: true, aliases: ["bams_employee_name"] },
  { field_key: "bams_employee_code", field_label: "BAMS Declaration - Employee Code", source_path: "employee.employee_code", required: false, aliases: ["bams_employee_code"] },
  { field_key: "bams_date_of_joining", field_label: "BAMS Declaration - DOJ", source_path: "employee.date_of_joining", required: false, field_type: "date", aliases: ["bams_date_of_joining"] },
  { field_key: "pi_employee_name", field_label: "Personal Information Consent - Employee Name", source_path: "employee.full_name", required: true, aliases: ["pi_employee_name"] },
  { field_key: "pi_signature_date", field_label: "Personal Information Consent - Signature Date", source_path: "system.current_date", required: true, field_type: "date", aliases: ["pi_signature_date"] },
  { field_key: "zero_tolerance_employee_name", field_label: "Zero Tolerance - Employee Name", source_path: "employee.full_name", required: true, aliases: ["zero_tolerance_employee_name"] },
  { field_key: "zero_tolerance_signature_date", field_label: "Zero Tolerance - Signature Date", source_path: "system.current_date", required: true, field_type: "date", aliases: ["zero_tolerance_signature_date"] },
  // The employment agreement names the second party as "r/o <address>" and
  // repeats it as the notice address, so a blank here is a defective contract.
  { field_key: "employee_address", field_label: "Residential Address", source_path: "employee.permanent_address", required: false, aliases: ["employee_address", "address", "permanent_address"] },
  // Resolves the agreement's "s/o | d/o" from gender. Not required: an unknown
  // gender legitimately yields both forms rather than a blank.
  { field_key: "relation_prefix", field_label: "Relation (s/o or d/o)", source_path: "employee.relation_prefix", required: false, aliases: ["relation_prefix"] },
  // The employer block on the employment contract. Same person who signs the
  // EPF forms — the Payroll HR of the branch the candidate joins. Optional:
  // blank until a branch is configured, and must never block the document.
  { field_key: "payroll_hr_name", field_label: "Payroll HR Name (employer signatory)", source_path: "payroll_hr.name", required: false, aliases: ["payroll_hr_name"] },
  { field_key: "payroll_hr_designation", field_label: "Payroll HR Designation", source_path: "payroll_hr.designation", required: false, aliases: ["payroll_hr_designation"] },
  // The agreement's appendix states the remuneration, so figure and words are
  // both required; a contract that says one and not the other is defective.
  { field_key: "monthly_remuneration", field_label: "Monthly Remuneration", source_path: "salary.monthly_gross", required: false, aliases: ["monthly_remuneration", "remuneration"] },
  { field_key: "attendance_system_name", field_label: "Attendance System", source_path: "attendance.system_name", required: false, aliases: ["attendance_system_name"] },
  { field_key: "attendance_criterion", field_label: "Attendance Criterion", source_path: "attendance.criterion_statement", required: false, aliases: ["attendance_criterion"] },
  { field_key: "attendance_login_hours", field_label: "Log-in Hours", source_path: "attendance.login_hours_statement", required: false, aliases: ["attendance_login_hours"] },
  { field_key: "monthly_remuneration_words", field_label: "Monthly Remuneration (in words)", source_path: "salary.monthly_gross_words", required: false, aliases: ["monthly_remuneration_words"] },
];

const DEFAULT_FIELDS_BY_DOCUMENT: Record<string, string[]> = {
  NDA_CONFIDENTIALITY: [
    "employee_name",
    "employee_code",
    "date_of_joining",
    "branch",
    "process",
    "designation",
    "department",
    "current_date",
    "nda_employee_name",
    "nda_signature_date",
    "it_employee_name",
    "it_signature_date",
    "surveillance_candidate_name",
    "surveillance_hr_name",
    "surveillance_signature_date",
    "bams_employee_name",
    "bams_employee_code",
    "bams_date_of_joining",
    "pi_employee_name",
    "pi_signature_date",
    "zero_tolerance_employee_name",
    "zero_tolerance_signature_date",
  ],
  IT_COMPLIANCE: ["employee_name", "employee_code", "date_of_joining", "branch", "process", "current_date"],
  BAMS_DECLARATION: ["employee_name", "employee_code", "date_of_joining", "branch", "process", "designation", "department", "current_date", "attendance_system_name", "attendance_criterion", "attendance_login_hours"],
  PI_PROCESSING_CONSENT: ["employee_name", "employee_code", "process", "mobile", "email", "current_date", "pi_signature_date"],
  ZERO_TOLERANCE_ACK: ["employee_name", "employee_code", "date_of_joining", "branch", "process", "current_date", "zero_tolerance_signature_date"],
  EPF_DECLARATION: ["employee_name", "father_name", "date_of_birth", "date_of_joining", "mobile", "email", "pan_masked", "aadhaar_masked", "uan", "current_date"],
  EMPLOYMENT_CONTRACT: ["employee_name", "employee_code", "date_of_joining", "designation", "department", "branch", "process", "current_date", "father_name", "relation_prefix", "employee_address", "monthly_remuneration", "monthly_remuneration_words", "payroll_hr_name", "payroll_hr_designation"],
};

function normalizeToken(value: string) {
  return value
    .replace(/^\{\{|\}\}$/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

/**
 * The field behind a template placeholder, matched by key or alias.
 *
 * This is what decides whether `{{something}}` is filled or silently rendered
 * as an empty string: an unmatched placeholder still gets a field map, but with
 * a null source_path, so nothing ever populates it and the document prints a
 * blank where a name or a date should be. Exported so the template audit can
 * ask the same question the renderer asks, instead of keeping a second copy of
 * the rule that drifts out of step with this one.
 */
export function matchPlaceholderField(placeholder: string) {
  const token = normalizeToken(placeholder);
  return COMMON_TEMPLATE_FIELDS.find((field) =>
    field.field_key === token || field.aliases?.some((alias) => normalizeToken(alias) === token),
  );
}

function fieldsForDocument(documentCode: string) {
  const wanted = DEFAULT_FIELDS_BY_DOCUMENT[String(documentCode || "").trim().toUpperCase()] ?? [
    "employee_name",
    "employee_code",
    "date_of_joining",
    "branch",
    "current_date",
  ];
  const byKey = new Map(COMMON_TEMPLATE_FIELDS.map((field) => [field.field_key, field]));
  return wanted.map((key) => byKey.get(key)).filter(Boolean) as DefaultFieldMap[];
}

function extractDocxPlaceholders(fileBuffer?: Buffer | null) {
  if (!fileBuffer?.byteLength) return [];
  try {
    const zip = new PizZip(fileBuffer);
    const xml = zip.file("word/document.xml")?.asText() ?? "";
    const placeholders = new Set<string>();
    for (const match of xml.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
      const token = normalizeToken(match[1] ?? "");
      if (token) placeholders.add(token);
    }
    return [...placeholders];
  } catch {
    return [];
  }
}

function epfAcroMap(
  field_key: string,
  source_path: string | null,
  options: Partial<FieldMapInput> = {},
): FieldMapInput {
  return {
    field_key,
    field_label: options.field_label ?? field_key.replace(/_/g, " "),
    source_path,
    page_no: options.page_no ?? 1,
    x: null,
    y: null,
    width: null,
    height: null,
    font_size: options.font_size ?? null,
    font_weight: null,
    alignment: null,
    field_type: options.field_type ?? "text",
    required: Boolean(options.required),
    masking_rule: options.masking_rule ?? null,
    mapping_mode: "acroform",
    placeholder_token: null,
    pdf_field_name: options.pdf_field_name ?? field_key,
    transform_rule: options.transform_rule ?? null,
    checked_when: options.checked_when ?? null,
    min_font_size: options.min_font_size ?? 5,
    max_font_size: options.max_font_size ?? 9,
    max_length: options.max_length ?? null,
    validation_rule: options.validation_rule ?? null,
    overflow_strategy: options.overflow_strategy ?? "shrink",
  };
}

function epfAcroformFieldMaps(): FieldMapInput[] {
  const text = (fieldKey: string, sourcePath: string | null, options: Partial<FieldMapInput> = {}) => epfAcroMap(fieldKey, sourcePath, options);
  const check = (fieldKey: string, sourcePath: string | null, checkedWhen: string, options: Partial<FieldMapInput> = {}) =>
    epfAcroMap(fieldKey, sourcePath, { ...options, field_type: "checkbox", checked_when: checkedWhen });
  return [
    text("employee_name", "epf.employee_name", { required: true, validation_rule: "required" }),
    text("father_or_spouse_name", "epf.father_or_spouse_name", { required: true, validation_rule: "required" }),
    check("relationship_father", "epf.relationship_type", "father", { required: true }),
    check("relationship_husband", "epf.relationship_type", "husband"),
    text("dob_day", "epf.date_of_birth", { required: true, transform_rule: "date_day", validation_rule: "date" }),
    text("dob_month", "epf.date_of_birth", { required: true, transform_rule: "date_month", validation_rule: "date" }),
    text("dob_year_1", "epf.date_of_birth", { required: true, transform_rule: "date_year_1", validation_rule: "date" }),
    text("dob_year_2", "epf.date_of_birth", { required: true, transform_rule: "date_year_2", validation_rule: "date" }),
    text("dob_year_3", "epf.date_of_birth", { required: true, transform_rule: "date_year_3", validation_rule: "date" }),
    text("dob_year_4", "epf.date_of_birth", { required: true, transform_rule: "date_year_4", validation_rule: "date" }),
    check("gender_male", "epf.gender", "Male", { required: true }),
    check("gender_female", "epf.gender", "Female", { required: true }),
    check("gender_other", "epf.gender", "Other", { required: true }),
    text("mobile_number", "epf.mobile_number", { required: true, validation_rule: "mobile_10" }),
    text("email", "epf.personal_email", { validation_rule: "email" }),
    check("previous_pf_member_yes", "epf.previous_pf_member", "true", { required: true }),
    check("previous_pf_member_no", "epf.previous_pf_member_no", "true", { required: true }),
    check("previous_eps_member_yes", "epf.previous_eps_member", "true", { required: true }),
    check("previous_eps_member_no", "epf.previous_eps_member_no", "true", { required: true }),
    text("uan", "epf.uan_masked", { validation_rule: "uan_12" }),
    text("previous_pf_account_number", "epf.previous_pf_account_number", { validation_rule: "previous_pf_account_if_needed" }),
    text("date_of_exit_previous_day", "epf.previous_exit_date", { transform_rule: "date_day" }),
    text("date_of_exit_previous_month", "epf.previous_exit_date", { transform_rule: "date_month" }),
    text("date_of_exit_previous_year", "epf.previous_exit_date", { transform_rule: "date_year" }),
    text("scheme_certificate_number", "epf.scheme_certificate_number"),
    text("ppo_number", "epf.ppo_number"),
    check("international_worker_yes", "epf.international_worker", "true", { required: true }),
    check("international_worker_no", "epf.international_worker_no", "true", { required: true }),
    text("country_of_origin", "epf.country_of_origin", { validation_rule: "international_worker_required" }),
    text("passport_number", "epf.passport_number", { validation_rule: "international_worker_required" }),
    text("passport_valid_from_day", "epf.passport_valid_from", { transform_rule: "date_day" }),
    text("passport_valid_from_month", "epf.passport_valid_from", { transform_rule: "date_month" }),
    text("passport_valid_from_year", "epf.passport_valid_from", { transform_rule: "date_year" }),
    text("passport_valid_to_day", "epf.passport_valid_to", { transform_rule: "date_day" }),
    text("passport_valid_to_month", "epf.passport_valid_to", { transform_rule: "date_month" }),
    text("passport_valid_to_year", "epf.passport_valid_to", { transform_rule: "date_year" }),
    check("education_illiterate", "epf.education_qualification", "illiterate"),
    check("education_non_matric", "epf.education_qualification", "non_matric"),
    check("education_matric", "epf.education_qualification", "matric"),
    check("education_senior_secondary", "epf.education_qualification", "senior_secondary"),
    check("education_graduate", "epf.education_qualification", "graduate"),
    check("education_post_graduate", "epf.education_qualification", "post_graduate"),
    check("education_doctor", "epf.education_qualification", "doctor"),
    check("education_technical_professional", "epf.education_qualification", "technical_professional"),
    check("marital_status_married", "epf.marital_status", "Married"),
    check("marital_status_unmarried", "epf.marital_status", "Unmarried"),
    check("marital_status_widow_widower", "epf.marital_status", "Widow/Widower"),
    check("marital_status_divorcee", "epf.marital_status", "Divorcee"),
    check("specially_abled_yes", "epf.specially_abled", "true"),
    check("specially_abled_no", "epf.specially_abled_no", "true"),
    check("disability_locomotive", "epf.disability_type", "locomotive"),
    check("disability_visual", "epf.disability_type", "visual"),
    check("disability_hearing", "epf.disability_type", "hearing"),
    text("kyc_bank_account_number", "statutory.bank_account_masked", { validation_rule: "bank_account" }),
    text("kyc_bank_ifsc", "statutory.ifsc_code", { validation_rule: "ifsc" }),
    text("kyc_aadhaar_name", "epf.aadhaar_name_as_per_kyc"),
    text("kyc_aadhaar_number", "epf.aadhaar_masked", { masking_rule: "aadhaar" }),
    text("kyc_pan_name", "epf.pan_name_as_per_kyc"),
    text("kyc_pan_number", "epf.pan_masked", { validation_rule: "pan", masking_rule: "pan" }),
    text("place", "epf.branch_name_snapshot", { required: true }),
    text("signature_date_day", "system.current_date", { required: true, transform_rule: "date_day" }),
    text("signature_date_month", "system.current_date", { required: true, transform_rule: "date_month" }),
    text("signature_date_year", "system.current_date", { required: true, transform_rule: "date_year" }),
    text("employee_signature", null),
    text("employer_name", "system.company_name"),
    text("employer_signature", null),
    text("doj_day", "epf.joining_date", { required: true, transform_rule: "date_day", validation_rule: "date" }),
    text("doj_month", "epf.joining_date", { required: true, transform_rule: "date_month", validation_rule: "date" }),
    text("doj_year", "epf.joining_date", { required: true, transform_rule: "date_year", validation_rule: "date" }),
  ];
}

export function defaultMapsForTemplate(documentCode: string, fileName?: string | null, fileBuffer?: Buffer | null): FieldMapInput[] {
  const code = String(documentCode || "").trim().toUpperCase();
  const isPdf = String(fileName || "").toLowerCase().endsWith(".pdf");
  // The two statutory EPF forms are authored AcroForms with fixed field names,
  // so their maps come from the form definition rather than being derived.
  if (code === "EPF_DECLARATION" && isPdf) {
    return epfAcroformFieldMaps();
  }
  if (code === "EPF_NOMINATION_FORM2" && isPdf) {
    return epfNominationFieldMaps().map((map) => ({
      field_key: map.field_key,
      field_label: map.field_label,
      source_path: map.source_path ?? null,
      page_no: 1,
      x: null, y: null, width: null, height: null,
      font_size: 9, font_weight: null, alignment: null,
      field_type: map.field_type ?? "text",
      required: false,
      masking_rule: null,
      mapping_mode: "acroform",
      placeholder_token: null,
      pdf_field_name: map.pdf_field_name,
      transform_rule: map.transform_rule ?? null,
      checked_when: map.checked_when ?? null,
    })) as FieldMapInput[];
  }

  const placeholders = extractDocxPlaceholders(fileBuffer);
  const baseFields = fieldsForDocument(documentCode);
  const maps = new Map<string, FieldMapInput>();

  for (const field of baseFields) {
    maps.set(field.field_key, {
      field_key: field.field_key,
      field_label: field.field_label,
      source_path: field.source_path ?? null,
      page_no: 1,
      x: null,
      y: null,
      width: null,
      height: null,
      font_size: 9,
      font_weight: null,
      alignment: null,
      field_type: field.field_type ?? "text",
      required: Boolean(field.required),
      masking_rule: field.masking_rule ?? null,
      mapping_mode: String(fileName || "").toLowerCase().endsWith(".pdf") ? "pdf_coordinate_overlay" : "placeholder",
      placeholder_token: `{{${field.field_key}}}`,
      pdf_field_name: null,
    });
  }

  for (const placeholder of placeholders) {
    const matched = matchPlaceholderField(placeholder);
    const fieldKey = matched?.field_key ?? placeholder;
    maps.set(fieldKey, {
      field_key: fieldKey,
      field_label: matched?.field_label ?? placeholder.replace(/_/g, " "),
      source_path: matched?.source_path ?? null,
      page_no: 1,
      x: null,
      y: null,
      width: null,
      height: null,
      font_size: 9,
      font_weight: null,
      alignment: null,
      field_type: matched?.field_type ?? "text",
      required: Boolean(matched?.required),
      masking_rule: matched?.masking_rule ?? null,
      mapping_mode: "placeholder",
      placeholder_token: `{{${placeholder}}}`,
      pdf_field_name: null,
    });
  }

  return [...maps.values()];
}

async function auditFieldChange(input: {
  employeeId: string;
  candidateId?: string | null;
  checklistId: string;
  documentCode: string;
  actionType: string;
  actorUserId?: string | null;
  actorType?: "hr" | "employee" | "public_token" | "system";
  remarks?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  await db.execute(
    `INSERT INTO employee_joining_document_audit_log
       (id, employee_id, candidate_id, checklist_id, document_code, action_type, old_value, new_value, remarks, actor_user_id, actor_type, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      input.employeeId,
      input.candidateId ?? null,
      input.checklistId,
      input.documentCode,
      input.actionType,
      input.oldValue ? JSON.stringify(input.oldValue) : null,
      input.newValue ? JSON.stringify(input.newValue) : null,
      input.remarks ?? null,
      input.actorUserId ?? null,
      input.actorType ?? "system",
      input.ipAddress ?? null,
      input.userAgent ?? null,
    ],
  );
}

async function checklistContext(checklistId: string): Promise<ChecklistContextRow> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        c.id AS checklist_id,
        c.employee_id,
        c.candidate_id,
        c.document_code,
        c.document_name,
        c.template_id,
        t.document_name AS template_name,
        t.template_storage_path,
        t.template_mime_type,
        t.fill_mode,
        JSON_UNQUOTE(JSON_EXTRACT(t.template_schema_json, '$')) AS template_schema_json
       FROM employee_joining_document_checklist c
       LEFT JOIN employee_joining_document_template t ON t.id = c.template_id
      WHERE c.id = ?
      LIMIT 1`,
    [checklistId],
  );
  const row = (rows as unknown as ChecklistContextRow[])[0];
  if (!row) {
    const err = new Error("Checklist item not found") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  return row;
}

/**
 * Single-line postal address, skipping the parts that are blank. Defaults to
 * the permanent address (what "r/o" and "permanent address" mean on the
 * statutory forms), falling back to the current one when it is not recorded.
 */
function joinAddress(employee: RowDataPacket | undefined, which: "permanent" | "current" = "permanent") {
  const pick = (...keys: string[]) => keys.map((key) => safeTrim(employee?.[key])).filter(Boolean);
  const permanent = pick("permanent_address1", "permanent_address2", "permanent_city", "permanent_state", "permanent_pincode");
  const current = pick("address1", "address2", "city", "state", "pincode");
  if (which === "current") return current.join(", ");
  return (permanent.length ? permanent : current).join(", ");
}

/**
 * "s/o" or "d/o" for the parties clause of the employment agreement.
 *
 * The template shipped the unresolved choice — "s/o | d/o" — and it printed on
 * every contract. Anything that is not recognisably male or female keeps both
 * forms: it reads as a form yet to be completed, which is true, rather than
 * asserting a relationship the employee record does not support.
 */
/**
 * The marital status spelled the way EPF Form 11 compares it.
 *
 * The form ticks a box by exact, case-insensitive match against one of four
 * discriminants, so the spelling matters. The sources disagree: the onboarding
 * form stores "Single", "DIVORCE" and "WIDOW", the employees table "single",
 * "divorced" and "widowed", and none of those equals "Unmarried", "Divorcee" or
 * "Widow/Widower". Every box therefore stayed empty even where the datum was
 * recorded — and it usually is: only 53 onboarding rows lack one.
 *
 * Anything unrecognised is passed through untouched, which leaves every box
 * unticked. That is deliberate: no box means "Separated", and picking the
 * nearest one would state something about a real person that no record supports.
 */
export function maritalStatusForForm(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  switch (raw.toLowerCase()) {
    case "married": return "Married";
    case "single": case "unmarried": return "Unmarried";
    case "widow": case "widower": case "widowed": case "widow/widower": return "Widow/Widower";
    case "divorce": case "divorced": case "divorcee": return "Divorcee";
    default: return raw;
  }
}

export function relationPrefix(gender: unknown) {
  const value = String(gender ?? "").trim().toLowerCase();
  if (value === "male" || value === "m") return "s/o";
  if (value === "female" || value === "f") return "d/o";
  return "s/o | d/o";
}

/** Exported so diagnostics can resolve exactly what a document would be filled with. */
export /**
 * Whether this employee's attendance is counted from the dialler or from
 * biometric punches.
 *
 * Mirrors the attendance engine's precedence exactly (isAprEligible in
 * attendance-engine.service.ts): apr_eligibility_config first, most specific
 * match winning, and the Operations+Executive regex only when that table is
 * empty or absent. It matters that these agree — the joiner signs a declaration
 * stating how their attendance is tracked, and a document that contradicts the
 * engine is a false declaration.
 */
async function resolveAttendanceSource(
  employee: RowDataPacket | undefined,
): Promise<"dialler" | "biometric"> {
  const departmentName = String(employee?.department_name ?? "");
  const designationName = String(employee?.designation_name ?? "");
  try {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id FROM apr_eligibility_config
        WHERE active_status = 1
          AND (designation_id = ? OR designation_id IS NULL)
          AND (department_id  = ? OR department_id  IS NULL)
          AND (process_id     = ? OR process_id     IS NULL)
        ORDER BY (CASE WHEN process_id     IS NOT NULL THEN 4 ELSE 0 END +
                  CASE WHEN department_id  IS NOT NULL THEN 2 ELSE 0 END +
                  CASE WHEN designation_id IS NOT NULL THEN 1 ELSE 0 END) DESC
        LIMIT 1`,
      [employee?.designation_id ?? null, employee?.department_id ?? null, employee?.process_id ?? null],
    );
    if ((rows as RowDataPacket[]).length) return "dialler";
    // An empty table means nothing is configured yet, so fall back to the rule
    // the engine falls back to rather than declaring everyone biometric.
    const [[{ total }]] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM apr_eligibility_config WHERE active_status = 1`,
    ) as unknown as [[{ total: number }]];
    if (Number(total) === 0 && isOperationsExecutiveByRegex(departmentName, designationName)) return "dialler";
    return "biometric";
  } catch {
    // Table missing — same fallback the engine uses.
    return isOperationsExecutiveByRegex(departmentName, designationName) ? "dialler" : "biometric";
  }
}

/** Groups digits the Indian way: 12,34,567 rather than 1,234,567. */
function indianDigits(value: number): string {
  const [whole] = value.toFixed(2).split(".");
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  return rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function underThousand(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
  return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${underThousand(n % 100)}` : ""}`;
}

/**
 * Amount in words, in the crore/lakh convention an Indian contract uses. The
 * appendix to the employment agreement prints "(Rupees ______ only)", so the
 * figure and its words have to agree.
 */
function amountInWords(value: number): string {
  const n = Math.floor(Math.abs(value));
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${underThousand(crore)} Crore`);
  if (lakh) parts.push(`${underThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${underThousand(thousand)} Thousand`);
  if (rest) parts.push(underThousand(rest));
  return parts.join(" ");
}

/** Exported so diagnostics can resolve exactly what a document would be filled with. */
export async function buildSourceContext(employeeId: string, candidateId?: string | null) {
  const [[employee]] = await db.execute<RowDataPacket[]>(
    `SELECT
        e.id,
        e.employee_code,
        COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS full_name,
        e.first_name,
        e.last_name,
        e.date_of_birth,
        e.date_of_joining,
        e.gender,
        e.marital_status,
        e.address1, e.address2, e.city, e.state, e.pincode,
        e.permanent_address1, e.permanent_address2, e.permanent_city,
        e.permanent_state, e.permanent_pincode,
        e.mobile,
        COALESCE(NULLIF(TRIM(e.official_email), ''), NULLIF(TRIM(e.office_email), ''), e.email) AS email,
        -- The statutory identifiers live on the employee row for the bulk of the
        -- workforce (11,751 UAN, 11,754 EPF, 9,663 ESIC), while the EPF context
        -- below reads the EPF compliance profile, which holds 4 rows in all.
        -- Without these the forms printed blank for everyone but those 4.
        -- Do not name another table in this comment: the test doubles dispatch
        -- on SQL substrings, so a table name here routes this query to the
        -- wrong stub and the employee comes back empty.
        e.uan_number,
        e.epf_number,
        e.esic_number,
        e.nominee_name,
        e.nominee_relation,
        d.designation_name,
        dept.dept_name AS department_name,
        b.branch_name,
        p.process_name
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN department_master dept ON dept.id = e.department_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
      WHERE e.id = ?
      LIMIT 1`,
    [employeeId],
  );

  const [[bank]] = await db.execute<RowDataPacket[]>(
    `SELECT
        COALESCE(ac.bank_name, ebd.bank_name) AS bank_name,
        ac.bank_account_no,
        ac.bank_ifsc,
        ebd.ifsc_code,
        ebd.verified AS bank_verified
       FROM employees e
       LEFT JOIN ats_candidate ac ON ac.id = ?
       LEFT JOIN employee_bank_detail ebd ON ebd.employee_id = e.id
      WHERE e.id = ?
      LIMIT 1`,
    [candidateId ?? "", employeeId],
  ).catch(() => [[null] as unknown as RowDataPacket[], []]);

  const [[onboarding]] = await db.execute<RowDataPacket[]>(
    `SELECT
        father_husband_name,
        date_of_birth,
        marital_status,
        mobile_number,
        personal_email_id,
        pan_number_masked,
        aadhaar_number_masked,
        uan_number,
        -- The candidate onboarding journey already asks for all of this
        -- (nominee at step 2, statutory ids at step 5). Selecting only the
        -- eight columns above meant EPF Form 2 nominees were re-collected by
        -- hand although the candidate had already supplied them: 19,925 of the
        -- 32,764 profiles carry a nominee name, 19,928 a nominee date of birth.
        gender,
        nominee_name,
        nominee_relation,
        nominee_date_of_birth,
        nominee1_share_pct,
        nominee2_name,
        nominee2_relation,
        nominee2_dob,
        nominee2_share_pct,
        epf_number,
        esic_number,
        -- Form 11's previous-membership boxes. Nullable with no default, so a
        -- non-null value here is a real answer from the statutory step rather
        -- than a column default.
        previous_pf_member,
        eps_member,
        international_worker,
        permanent_address,
        permanent_state,
        permanent_city,
        permanent_pincode
       FROM candidate_onboarding_profile
      WHERE candidate_id = ?
      LIMIT 1`,
    [candidateId ?? ""],
  ).catch(() => [[null] as unknown as RowDataPacket[], []]);

  const [[epf]] = await db.execute<RowDataPacket[]>(
    `SELECT
        father_or_spouse_name,
        date_of_birth,
        mobile_number,
        personal_email,
        pan_masked,
        aadhaar_masked,
        uan_masked,
        employee_name,
        relationship_type,
        gender,
        marital_status,
        previous_pf_member,
        previous_pf_account_number,
        previous_exit_date,
        previous_eps_member,
        international_worker,
        country_of_origin,
        passport_number,
        passport_valid_from,
        passport_valid_to,
        education_qualification,
        specially_abled,
        disability_type,
        aadhaar_name_as_per_kyc,
        pan_name_as_per_kyc,
        scheme_certificate_number,
        ppo_number,
        branch_name_snapshot,
        joining_date
       FROM employee_epf_compliance_profile
      WHERE employee_id = ?
      LIMIT 1`,
    [employeeId],
  ).catch(() => [[null] as unknown as RowDataPacket[], []]);

  const [[salary]] = await db.execute<RowDataPacket[]>(
    `SELECT ctc_offered, basic, hra, conveyance, da, special_allowance,
            portfolio_allowance, medical_allowance, lta, mobile_allowance,
            other_allowance, bonus, gross, net_in_hand,
            epf_employee, epf_employer, esic_employee, esic_employer,
            professional_tax, gratuity, admin_charges
       FROM employee_salary_snapshot
      WHERE employee_id = ?
      ORDER BY snapshot_date DESC
      LIMIT 1`,
    [employeeId],
  ).catch(() => [[null] as unknown as RowDataPacket[], []]);

  // The EPF compliance screen writes its own nominee rows, keyed to the EPF
  // profile and carrying the fields Form 2 actually asks for — share, guardian
  // for a minor, and a full address. Nothing ever read them: the form took the
  // general-purpose nominee table instead, so every nominee HR entered on that
  // screen was discarded at render time. The table is empty today, which is why
  // no document has been wrong yet, but it would have silently lost data the
  // moment the screen was used in earnest.
  //
  // It wins where it has rows: it is the EPF-specific record, curated for this
  // form, while the table below is shared with gratuity and insurance.
  const [epfNominees] = await db.execute<RowDataPacket[]>(
    `SELECT nominee_name, relationship, date_of_birth, share_percentage,
            guardian_name, guardian_relationship AS guardian_relation,
            CONCAT_WS(', ', NULLIF(address_line, ''), NULLIF(city, ''),
                      NULLIF(state, ''), NULLIF(pincode, '')) AS address,
            -- This table has no is_minor flag, and the flattener below prints a
            -- guardian only for a minor. A guardian is recorded for exactly one
            -- reason, so treat its presence as the flag: hardcoding 0 here would
            -- silently drop the guardian the screen just collected.
            CASE WHEN NULLIF(TRIM(guardian_name), '') IS NULL THEN 0 ELSE 1 END AS is_minor
       FROM employee_epf_nominee
      WHERE employee_id = ?
      ORDER BY is_primary DESC, share_percentage DESC, id ASC
      LIMIT 4`,
    [employeeId],
  ).catch(() => [[] as unknown as RowDataPacket[], []]);

  // EPF Form 2 nominates against the PF corpus, so take the PF nominees. Rows
  // are flattened to nominee.n1_*, n2_* … because a field map addresses one
  // scalar path per box and the form prints a fixed number of rows.
  const [generalNominees] = await db.execute<RowDataPacket[]>(
    `SELECT nominee_name, relationship, date_of_birth, share_percentage,
            address, is_minor, guardian_name, guardian_relation
       FROM employee_nominee
      WHERE employee_id = ?
        AND (nominee_for IS NULL OR nominee_for LIKE '%pf%')
      ORDER BY share_percentage DESC, id ASC
      LIMIT 4`,
    [employeeId],
  ).catch(() => [[] as unknown as RowDataPacket[], []]);

  const nominees = (epfNominees as RowDataPacket[]).length
    ? (epfNominees as RowDataPacket[])
    : (generalNominees as RowDataPacket[]);

  // employee_nominee is the system of record and wins whenever it has rows. It
  // is empty for anyone who joined through the candidate onboarding journey and
  // has not been re-entered by HR since — SOFIYA SULTAN (MAS63086) has no row
  // here while her onboarding profile names SULTAN AHMED, born 1980-02-03. The
  // journey collects a maximum of two nominees, in fixed columns rather than
  // rows, so map them onto the same n1_/n2_ shape the form prints. Nominee
  // address and guardian are not asked for anywhere on that journey, so they
  // stay null and remain HR's to fill.
  const onboardingNominees: RowDataPacket[] = [];
  if (safeTrim(onboarding?.nominee_name)) {
    onboardingNominees.push({
      nominee_name: onboarding?.nominee_name,
      relationship: onboarding?.nominee_relation ?? null,
      date_of_birth: onboarding?.nominee_date_of_birth ?? null,
      share_percentage: onboarding?.nominee1_share_pct ?? null,
      address: null, is_minor: 0, guardian_name: null, guardian_relation: null,
    } as unknown as RowDataPacket);
  }
  if (safeTrim(onboarding?.nominee2_name)) {
    onboardingNominees.push({
      nominee_name: onboarding?.nominee2_name,
      relationship: onboarding?.nominee2_relation ?? null,
      date_of_birth: onboarding?.nominee2_dob ?? null,
      share_percentage: onboarding?.nominee2_share_pct ?? null,
      address: null, is_minor: 0, guardian_name: null, guardian_relation: null,
    } as unknown as RowDataPacket);
  }
  // Last resort: 18,742 employees carry a single nominee on their own row with
  // nothing in employee_nominee at all.
  if (!onboardingNominees.length && safeTrim(employee?.nominee_name)) {
    onboardingNominees.push({
      nominee_name: employee?.nominee_name,
      relationship: employee?.nominee_relation ?? null,
      date_of_birth: null, share_percentage: null,
      address: null, is_minor: 0, guardian_name: null, guardian_relation: null,
    } as unknown as RowDataPacket);
  }

  const resolvedNominees = (nominees as RowDataPacket[]).length
    ? (nominees as RowDataPacket[])
    : onboardingNominees;

  const nominee: Record<string, unknown> = {};
  resolvedNominees.forEach((entry, index) => {
    const p = `n${index + 1}_`;
    nominee[`${p}name`] = entry.nominee_name ?? null;
    nominee[`${p}relationship`] = entry.relationship ?? null;
    nominee[`${p}date_of_birth`] = entry.date_of_birth ?? null;
    nominee[`${p}share_percentage`] = entry.share_percentage == null ? null : `${entry.share_percentage}`;
    nominee[`${p}address`] = entry.address ?? null;
    // The guardian line is only meaningful for a minor nominee.
    nominee[`${p}guardian_name`] = Number(entry.is_minor ?? 0) === 1 ? entry.guardian_name ?? null : null;
    nominee[`${p}guardian_relation`] = Number(entry.is_minor ?? 0) === 1 ? entry.guardian_relation ?? null : null;
  });

  // EPF Form 2 Part B declares the member's FAMILY for the pension scheme. It is
  // a different question from Part A's PF nomination and has no overlap with it:
  // deriving a family from the nominee would be a false statutory declaration,
  // so the only legitimate source is what the member wrote themselves during
  // onboarding. Anyone who did not supply one keeps a blank Part B to complete
  // by hand, exactly as before.
  const [familyMembers] = await db.execute<RowDataPacket[]>(
    `SELECT member_name, relation, dob, address, is_eps_nominee
       FROM candidate_onboarding_family_member
      WHERE candidate_id = ?
        -- All 31 rows written before the writer skipped blank drafts have a
        -- NULL member_name. Unfiltered they would take a Part B slot and print
        -- an empty line, pushing a real family member off the form.
        AND member_name IS NOT NULL AND TRIM(member_name) <> ''
      ORDER BY created_at ASC`,
    [candidateId ?? ""],
  ).catch(() => [[] as unknown as RowDataPacket[], []]);

  // The EPS block on the form is the fallback used where no eligible family
  // exists, so a flagged row goes there and never into the family table.
  const epsRow = (familyMembers as RowDataPacket[]).find((r) => Number(r.is_eps_nominee ?? 0) === 1) ?? null;
  const family: Record<string, unknown> = {};
  (familyMembers as RowDataPacket[])
    .filter((r) => Number(r.is_eps_nominee ?? 0) !== 1)
    .slice(0, 4)
    .forEach((entry, index) => {
      const p = `f${index + 1}_`;
      family[`${p}name`] = safeTrim(entry.member_name);
      family[`${p}relationship`] = safeTrim(entry.relation);
      family[`${p}date_of_birth`] = entry.dob ?? null;
      family[`${p}address`] = safeTrim(entry.address);
    });

  const epsNominee = {
    name: safeTrim(epsRow?.member_name),
    relationship: safeTrim(epsRow?.relation),
    date_of_birth: epsRow?.dob ?? null,
    address: safeTrim(epsRow?.address),
  };

  const attendanceSource = await resolveAttendanceSource(employee);

  // Gross is the contractual monthly remuneration the employee signs against.
  //
  // Priority order (highest to lowest):
  //   1. salary_package_master.gross — the authoritative offer figure assigned
  //      by Payroll Head. This is exactly the number the appointment letter PDF
  //      salary table already prints, so both documents now agree.
  //   2. employee_salary_snapshot.gross — covers existing/legacy employees who
  //      were never assigned through the package master flow.
  //   3. Component sum — snapshot exists but gross column is 0 (DEFAULT 0 on
  //      that table, so 0 ≠ null and a ?? fallback never fires). 15,518 rows.
  //   4. ctc_offered (guarded) — last resort; see guard below.
  //   5. null (blank on contract) — honest; fabricated zero is not.
  const [[packageRow]] = await db.execute<RowDataPacket[]>(
    `SELECT p.gross AS package_gross
       FROM salary_component_assignments a
       JOIN salary_package_master p ON p.id = a.package_id
      WHERE a.employee_id = ? AND a.status = 'active' AND a.package_id IS NOT NULL
      ORDER BY a.effective_date DESC
      LIMIT 1`,
    [employeeId],
  ).catch(() => [[null] as unknown as RowDataPacket[], []]);

  const num = (value: unknown) => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const componentSum = [
    salary?.basic, salary?.hra, salary?.conveyance, salary?.da,
    salary?.portfolio_allowance, salary?.medical_allowance, salary?.lta,
    salary?.mobile_allowance, salary?.special_allowance, salary?.other_allowance,
  ].reduce<number>((total, part) => total + num(part), 0);

  const packageGross = num(packageRow?.package_gross);
  const snapshotGross = num(salary?.gross);

  // Last resort, and the one that needs a guard. ctc_offered is monthly on
  // 31,100 of the 31,142 rows that carry one — but five hold 110,000 to
  // 625,000, which on this workforce can only be an annual CTC typed into a
  // monthly column. With no components to corroborate the figure there is no
  // way to tell the two apart, and printing an annual CTC as the monthly
  // remuneration overstates it twelvefold on a document someone signs.
  //
  // So an uncorroborated figure at or above this ceiling is refused. It is not
  // a cap on what may be printed: where the components agree, they are used
  // and no ceiling applies, so a genuine senior salary is unaffected. The
  // largest value that actually reaches this branch today is 32,966.
  const UNCORROBORATED_MONTHLY_CEILING = 200_000;
  const offered = num(salary?.ctc_offered);
  const offeredMonthly = offered > 0 && offered < UNCORROBORATED_MONTHLY_CEILING ? offered : 0;

  // 595 rows carry no figure anywhere. A blank on the contract is honest; a
  // fabricated one is not, so nothing is invented for them.
  const grossRaw = packageGross > 0
    ? packageGross
    : snapshotGross > 0
      ? snapshotGross
      : componentSum > 0
        ? componentSum
        : offeredMonthly > 0
          ? offeredMonthly
          : null;
  const monthlyGross = grossRaw == null || !Number.isFinite(grossRaw) || grossRaw <= 0
    ? null
    : grossRaw;

  // The Payroll HR who signs this candidate's joining documents. Resolved from
  // the employee's branch; null where no signatory is configured yet, or where
  // sql/1061 has not been applied, in which case the name prints blank exactly
  // as it always has.
  const payrollHr = await getPayrollHrSignatoryForEmployee(employeeId).catch(() => null);

  return {
    nominee,
    family,
    eps_nominee: epsNominee,
    payroll_hr: {
      name: payrollHr?.hrName ?? null,
      designation: payrollHr?.hrDesignation ?? null,
    },
    employee: {
      full_name: employee?.full_name ?? null,
      employee_code: employee?.employee_code ?? null,
      date_of_birth: employee?.date_of_birth ?? onboarding?.date_of_birth ?? epf?.date_of_birth ?? null,
      date_of_joining: employee?.date_of_joining ?? null,
      designation: employee?.designation_name ?? null,
      department: employee?.department_name ?? null,
      branch: employee?.branch_name ?? null,
      process: employee?.process_name ?? null,
      mobile: employee?.mobile ?? onboarding?.mobile_number ?? epf?.mobile_number ?? null,
      email: employee?.email ?? onboarding?.personal_email_id ?? epf?.personal_email ?? null,
      father_name: epf?.father_or_spouse_name ?? onboarding?.father_husband_name ?? null,
      // The agreement named the second party "<name> s/o | d/o <father>" —
      // the template's own placeholder text, printed verbatim on every signed
      // contract because nothing ever resolved it. Gender decides it: 43,427
      // employees are Male and 15,139 Female, so it is nearly always known.
      // The 63 without one keep both forms rather than have the document
      // assert a relationship the record does not support.
      // Falls back to onboarding and EPF sources so newly converted ATS
      // candidates whose employees.gender is not yet populated still get
      // the correct s/o or d/o on the first page of their contract.
      relation_prefix: relationPrefix(employee?.gender ?? onboarding?.gender ?? epf?.gender),
      // "r/o" on the employment agreement means place of residence, so prefer
      // the permanent address and fall back to the current one.
      // Falls back to the address the candidate typed during onboarding when the
      // employee record has none. Only 67 profiles carry one today, so this
      // closes a small gap rather than a large one.
      permanent_address: joinAddress(employee)
        || [onboarding?.permanent_address, onboarding?.permanent_city,
            onboarding?.permanent_state, onboarding?.permanent_pincode]
             .map((part) => safeTrim(part)).filter(Boolean).join(", ")
        || null,
      current_address: joinAddress(employee, "current") || null,
    },
    epf: {
      employee_name: epf?.employee_name ?? employee?.full_name ?? null,
      father_or_spouse_name: epf?.father_or_spouse_name ?? onboarding?.father_husband_name ?? null,
      relationship_type: epf?.relationship_type ?? "father",
      date_of_birth: epf?.date_of_birth ?? onboarding?.date_of_birth ?? employee?.date_of_birth ?? null,
      joining_date: epf?.joining_date ?? employee?.date_of_joining ?? null,
      gender: safeTrim(epf?.gender) ?? safeTrim(employee?.gender) ?? safeTrim(onboarding?.gender),
      marital_status: maritalStatusForForm(
        epf?.marital_status ?? onboarding?.marital_status ?? employee?.marital_status,
      ),
      mobile_number: epf?.mobile_number ?? onboarding?.mobile_number ?? employee?.mobile ?? null,
      personal_email: epf?.personal_email ?? onboarding?.personal_email_id ?? employee?.email ?? null,
      pan_masked: epf?.pan_masked ?? onboarding?.pan_number_masked ?? null,
      aadhaar_masked: epf?.aadhaar_masked ?? onboarding?.aadhaar_number_masked ?? null,
      // employee_epf_compliance_profile holds 4 rows, so uan_masked was null for
      // effectively everyone while 11,751 employee rows carry a UAN. Masked on
      // the way through to match what this field has always printed — the raw
      // value is deliberately not widened here.
      // safeTrim, not `??`: these columns hold '' rather than NULL on 65 profiles,
      // and `??` treats '' as a real value, so the employee-row fallback would
      // never fire and the form would print blank for someone who has a UAN.
      uan_masked: safeTrim(epf?.uan_masked) ?? safeTrim(onboarding?.uan_number) ?? maskDigits(employee?.uan_number),
      previous_pf_member: tri(affirmativeOnly(epf?.previous_pf_member), onboarding?.previous_pf_member) === true,
      previous_pf_member_no: tri(affirmativeOnly(epf?.previous_pf_member), onboarding?.previous_pf_member) === false,
      // Only the onboarding column is a valid fallback: its field is labelled
      // "Previous EPF / PF Number". employees.epf_number is the CURRENT member
      // id, and printing it here would make Form 11 assert a previous
      // membership that does not exist.
      previous_pf_account_number: safeTrim(epf?.previous_pf_account_number) ?? safeTrim(onboarding?.epf_number),
      previous_exit_date: epf?.previous_exit_date ?? null,
      previous_eps_member: tri(affirmativeOnly(epf?.previous_eps_member), onboarding?.eps_member) === true,
      previous_eps_member_no: tri(affirmativeOnly(epf?.previous_eps_member), onboarding?.eps_member) === false,
      // Both sources for this one are DEFAULT 0, so it can only ever be answered
      // yes. With no affirmative anywhere the boxes stay blank rather than
      // asserting a "No" nobody made.
      international_worker: tri(affirmativeOnly(epf?.international_worker), affirmativeOnly(onboarding?.international_worker)) === true,
      international_worker_no: tri(affirmativeOnly(epf?.international_worker), affirmativeOnly(onboarding?.international_worker)) === false,
      country_of_origin: epf?.country_of_origin ?? null,
      passport_number: epf?.passport_number ?? null,
      passport_valid_from: epf?.passport_valid_from ?? null,
      passport_valid_to: epf?.passport_valid_to ?? null,
      education_qualification: epf?.education_qualification ?? null,
      specially_abled: Number(epf?.specially_abled ?? 0) === 1,
      specially_abled_no: Number(epf?.specially_abled ?? 0) !== 1,
      disability_type: epf?.disability_type ?? null,
      aadhaar_name_as_per_kyc: epf?.aadhaar_name_as_per_kyc ?? epf?.employee_name ?? employee?.full_name ?? null,
      pan_name_as_per_kyc: epf?.pan_name_as_per_kyc ?? epf?.employee_name ?? employee?.full_name ?? null,
      scheme_certificate_number: epf?.scheme_certificate_number ?? null,
      ppo_number: epf?.ppo_number ?? null,
      branch_name_snapshot: epf?.branch_name_snapshot ?? employee?.branch_name ?? null,
    },
    statutory: {
      pan_masked: epf?.pan_masked ?? onboarding?.pan_number_masked ?? null,
      aadhaar_masked: epf?.aadhaar_masked ?? onboarding?.aadhaar_number_masked ?? null,
      uan: safeTrim(epf?.uan_masked) ?? safeTrim(onboarding?.uan_number) ?? maskDigits(employee?.uan_number),
      bank_account_masked: maskBankAccount(bank?.bank_account_no ?? null),
      ifsc_code: bank?.bank_ifsc ?? bank?.ifsc_code ?? null,
      bank_verified: Number(bank?.bank_verified ?? 0) === 1,
    },
    salary: {
      ctc_annual: salary?.ctc_offered ?? null,
      basic: salary?.basic ?? null,
      hra: salary?.hra ?? null,
      conveyance: salary?.conveyance ?? null,
      da: salary?.da ?? null,
      special_allowance: salary?.special_allowance ?? null,
      other_allowance: salary?.other_allowance ?? null,
      bonus: salary?.bonus ?? null,
      gross: salary?.gross ?? null,
      net_in_hand: salary?.net_in_hand ?? null,
      epf_employee: salary?.epf_employee ?? null,
      epf_employer: salary?.epf_employer ?? null,
      esic_employee: salary?.esic_employee ?? null,
      esic_employer: salary?.esic_employer ?? null,
      professional_tax: salary?.professional_tax ?? null,
      gratuity: salary?.gratuity ?? null,
      admin_charges: salary?.admin_charges ?? null,
      // The employment agreement's appendix prints the monthly figure and the
      // same amount in words, so both are derived from one source.
      monthly_gross: monthlyGross == null ? null : indianDigits(monthlyGross),
      monthly_gross_words: monthlyGross == null ? null : amountInWords(monthlyGross),
    },
    attendance: {
      source: attendanceSource,
      // The wording the joiner signs, so it has to match how they are actually
      // tracked. Log-in hours follow the engine's thresholds: the dialler rule
      // is 480 minutes, the biometric default 540.
      system_name: attendanceSource === "dialler"
        ? "Dialler-based Attendance (APR) with Biometric Attendance Management System (BAMS) for entry and exit"
        : "Biometric Attendance Management System (BAMS)",
      criterion_statement: attendanceSource === "dialler"
        ? "my attendance is tracked from my dialler log-in hours recorded in the Company's systems, and that I am also required to record my entry and exit on the Biometric Attendance Management System"
        : "the Biometric Attendance Management System is the only criterion for tracking my attendance",
      login_hours_statement: attendanceSource === "dialler"
        ? "Log-in hours = 8 hours (dialler log-in) + 1 hour (break)"
        : "Log-in hours = 9 hours (system log-in, inclusive of 1 hour break)",
    },
    system: {
      current_date: new Date().toISOString().slice(0, 10),
      company_name: "Mas Callnet India Pvt. Ltd.",
    },
  };
}

async function fieldMapsForTemplate(templateId: string | null, documentCode: string) {
  const params: unknown[] = [documentCode];
  let templateSql = "";
  if (templateId) {
    templateSql = " OR template_id = ?";
    params.push(templateId);
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT *
       FROM document_template_field_map
      WHERE document_code = ?${templateSql}
      ORDER BY page_no ASC, created_at ASC`,
    params,
  );
  return rows as RowDataPacket[];
}

/** Exported alongside buildSourceContext for the same reason. */
export function deriveFieldValue(map: RowDataPacket, sourceContext: Record<string, unknown>) {
  const sourceValue = nestedValue(sourceContext, String(map.source_path ?? ""));
  const fieldType = String(map.field_type ?? "text");
  const maskingRule = safeTrim(map.masking_rule);
  let rawValue = sourceValue;
  if (maskingRule === "aadhaar") rawValue = maskDigits(sourceValue);
  if (maskingRule === "pan") rawValue = maskPan(sourceValue);
  if (maskingRule === "bank_account") rawValue = maskBankAccount(sourceValue);
  const textValue = formatValueForField(rawValue, fieldType, safeTrim(map.checked_when));
  return {
    value_text: textValue || null,
    masked_value: textValue || null,
    confidence_score: textValue ? 100 : 0,
    fill_status: textValue ? "auto_filled" : "hr_fill_required",
    requires_confirmation: textValue ? 0 : 1,
    value_source: "SYSTEM",
  };
}

async function upsertFieldValue(params: {
  checklistId: string;
  employeeId: string;
  documentCode: string;
  fieldKey: string;
  fieldLabel: string;
  sourcePath?: string | null;
  fieldType: string;
  valueText?: string | null;
  maskedValue?: string | null;
  valueSource: "SYSTEM" | "HR_ENTERED" | "EMPLOYEE_CONFIRMED" | "PAYROLL_ENTERED";
  fillStatus: string;
  confidenceScore?: number | null;
  requiresConfirmation?: number;
  employeeConfirmed?: number;
  employeeConfirmationComment?: string | null;
  hrReason?: string | null;
  actorUserId?: string | null;
}) {
  const [existingRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, value_text, value_source, fill_status, employee_confirmed
       FROM employee_joining_document_field_value
      WHERE checklist_id = ? AND field_key = ?
      LIMIT 1`,
    [params.checklistId, params.fieldKey],
  );
  const existing = existingRows[0] as RowDataPacket | undefined;
  if (existing) {
    await db.execute(
      `UPDATE employee_joining_document_field_value
          SET field_label = ?,
              source_path = ?,
              field_type = ?,
              value_text = ?,
              masked_value = ?,
              value_source = ?,
              fill_status = ?,
              confidence_score = ?,
              requires_confirmation = ?,
              employee_confirmed = ?,
              employee_confirmed_at = CASE WHEN ? = 1 THEN COALESCE(employee_confirmed_at, NOW()) ELSE employee_confirmed_at END,
              employee_confirmation_comment = ?,
              hr_reason = ?,
              updated_by = ?,
              updated_at = NOW()
        WHERE id = ?`,
      [
        params.fieldLabel,
        params.sourcePath ?? null,
        params.fieldType,
        params.valueText ?? null,
        params.maskedValue ?? null,
        params.valueSource,
        params.fillStatus,
        params.confidenceScore ?? null,
        params.requiresConfirmation ?? 0,
        params.employeeConfirmed ?? 0,
        params.employeeConfirmed ?? 0,
        params.employeeConfirmationComment ?? null,
        params.hrReason ?? null,
        params.actorUserId ?? null,
        existing.id,
      ],
    );
    return existing.id as string;
  }

  const id = randomUUID();
  await db.execute(
    `INSERT INTO employee_joining_document_field_value
       (id, checklist_id, employee_id, document_code, field_key, field_label, source_path, field_type, value_text, masked_value, value_source, fill_status, confidence_score, requires_confirmation, employee_confirmed, employee_confirmed_at, employee_confirmation_comment, hr_reason, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.checklistId,
      params.employeeId,
      params.documentCode,
      params.fieldKey,
      params.fieldLabel,
      params.sourcePath ?? null,
      params.fieldType,
      params.valueText ?? null,
      params.maskedValue ?? null,
      params.valueSource,
      params.fillStatus,
      params.confidenceScore ?? null,
      params.requiresConfirmation ?? 0,
      params.employeeConfirmed ?? 0,
      params.employeeConfirmed ? new Date() : null,
      params.employeeConfirmationComment ?? null,
      params.hrReason ?? null,
      params.actorUserId ?? null,
      params.actorUserId ?? null,
    ],
  );
  return id;
}

/**
 * Optional fields that have no source path.
 *
 * The system can never fill these and nothing requires them, so counting them as
 * "missing" pinned the whole document at hr_fill_required for good — which is
 * why a joining kit containing the NDA could never be sent. Derived from the
 * definitions rather than hardcoded, so a future optional-and-unsourced field is
 * handled without another fix here.
 *
 * HR can still enter a value by hand on the review screen; that sets
 * value_source = 'HR_ENTERED' and is unaffected.
 */
/**
 * Optional fields whose source can legitimately resolve to nothing.
 *
 * The derivation below covers optional fields with no source at all. It does
 * not cover a field that HAS a source which is simply empty for this employee —
 * and surveillance_hr_name became exactly that when it was pointed at
 * payroll_hr.name: a branch with no configured signatory yields null, the field
 * stays at hr_fill_required, and the document can never complete. Since no
 * branch is configured yet, that would have been every document.
 *
 * Listed explicitly rather than loosening the rule to `required === false`,
 * which would also stop genuinely missing statutory data (EPF nominees) from
 * blocking.
 */
const OPTIONAL_SOURCED_FIELD_KEYS = [
  "surveillance_hr_name",
  "payroll_hr_name",
  "payroll_hr_designation",
  // Same shape: sourced from employee.process, but 19,270 of 58,627 employees
  // (and 1,044 of the 1,648 who joined in 2026) have no process_id, so the
  // resolved value is null and the Employment Agreement, BAMS and NDA stayed
  // pinned at hr_fill_required forever. A process is assigned by Operations
  // after joining, so it is legitimately unknown when the kit is issued.
  "process",
];

const NON_BLOCKING_FIELD_KEYS: string[] = [
  ...COMMON_TEMPLATE_FIELDS
    .filter((f) => f.required === false && !f.source_path)
    .map((f) => String(f.field_key)),
  ...OPTIONAL_SOURCED_FIELD_KEYS,
];

async function persistChecklistFillStatus(checklistId: string) {
  // `NOT IN ()` is a syntax error, so use a sentinel that never matches a key.
  const skip = NON_BLOCKING_FIELD_KEYS.length ? NON_BLOCKING_FIELD_KEYS : ["__none__"];
  const skipSql = skip.map(() => "?").join(",");
  // Only a field the template marks required may hold a document back.
  //
  // Optional fields were blocking too, and there are far more of them than the
  // named exceptions could ever cover: Form 11 alone marks 43 of its 69 fields
  // optional — every education and disability tickbox, passport, country of
  // origin, previous exit date — none of which we hold for anyone. One employee
  // (MAS63086) had 82 fields flagged across her kit, so it could never be sent
  // and the e-sign mail never fired. A document that can never complete is worse
  // than one that goes out with optional boxes for the member to tick at
  // signing, which is what the paper form expects anyway.
  //
  // A field with no map row keeps the old behaviour, so anything the template
  // does not describe still blocks rather than being silently waived. Signature
  // fields are filled during e-sign, after this runs, so they never block.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        SUM(CASE WHEN fv.fill_status = 'hr_fill_required'
                  AND fv.field_key NOT IN (${skipSql})
                  AND fv.field_key NOT REGEXP '(^|_)signature$'
                  AND COALESCE(m.required, 1) = 1 THEN 1 ELSE 0 END) AS missing_count,
        SUM(CASE WHEN fv.value_source = 'HR_ENTERED' THEN 1 ELSE 0 END) AS hr_count,
        SUM(CASE WHEN fv.employee_confirmed = 0 THEN 1 ELSE 0 END) AS unconfirmed_count
       FROM employee_joining_document_field_value fv
       JOIN employee_joining_document_checklist cl ON cl.id = fv.checklist_id
       LEFT JOIN document_template_field_map m
              ON m.document_code = cl.document_code AND m.field_key = fv.field_key
      WHERE fv.checklist_id = ?`,
    [...skip, checklistId],
  );
  const row = rows[0] as RowDataPacket | undefined;
  const missing = Number(row?.missing_count ?? 0);
  const hrEntered = Number(row?.hr_count ?? 0);
  const unconfirmed = Number(row?.unconfirmed_count ?? 0);

  const fillStatus = missing > 0
    ? "hr_fill_required"
    : hrEntered > 0
      ? "hr_filled"
      : "auto_filled";
  const reviewStatus = missing > 0
    ? "pending"
    : unconfirmed > 0
      ? "employee_review_pending"
      : "confirmed";

  await db.execute(
    `UPDATE employee_joining_document_checklist
        SET fill_status = ?,
            employee_review_status = ?,
            status = CASE
              WHEN ? = 'pending' THEN 'draft_generated'
              WHEN ? = 'employee_review_pending' THEN 'employee_review_pending'
              ELSE status
            END,
            updated_at = NOW()
      WHERE id = ?`,
    [fillStatus, reviewStatus, reviewStatus, reviewStatus, checklistId],
  );
}

export async function listTemplateFieldMaps(templateId: string, documentCode: string) {
  return fieldMapsForTemplate(templateId, documentCode);
}

export async function replaceTemplateFieldMaps(templateId: string, documentCode: string, actorUserId: string, maps: FieldMapInput[]) {
  await db.execute(
    `DELETE FROM document_template_field_map WHERE template_id = ? AND document_code = ?`,
    [templateId, documentCode],
  );
  for (const map of maps) {
    await db.execute(
      `INSERT INTO document_template_field_map
         (id, template_id, document_code, field_key, field_label, source_path, page_no, x, y, width, height, font_size, font_weight, alignment, field_type, required, masking_rule, mapping_mode, placeholder_token, pdf_field_name, transform_rule, checked_when, min_font_size, max_font_size, max_length, validation_rule, overflow_strategy, schema_field_tooltip, schema_suggested_path, mapping_confirmed, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        map.id ?? randomUUID(),
        templateId,
        documentCode,
        map.field_key,
        map.field_label,
        map.source_path ?? null,
        Number(map.page_no ?? 1),
        map.x ?? null,
        map.y ?? null,
        map.width ?? null,
        map.height ?? null,
        map.font_size ?? null,
        map.font_weight ?? null,
        map.alignment ?? null,
        map.field_type ?? "text",
        map.required ? 1 : 0,
        map.masking_rule ?? null,
        map.mapping_mode ?? "placeholder",
        map.placeholder_token ?? null,
        map.pdf_field_name ?? null,
        map.transform_rule ?? null,
        map.checked_when ?? null,
        map.min_font_size ?? null,
        map.max_font_size ?? null,
        map.max_length ?? null,
        map.validation_rule ?? null,
        map.overflow_strategy ?? "shrink",
        map.schema_field_tooltip ?? null,
        map.schema_suggested_path ?? null,
        map.mapping_confirmed ? 1 : 0,
        actorUserId,
      ],
    );
  }
  return listTemplateFieldMaps(templateId, documentCode);
}

export async function ensureDefaultTemplateFieldMaps(params: {
  templateId: string;
  documentCode: string;
  actorUserId: string;
  fileName?: string | null;
  fileBuffer?: Buffer | null;
}) {
  const existing = await listTemplateFieldMaps(params.templateId, params.documentCode);
  if (existing.length > 0) return existing;
  const maps = defaultMapsForTemplate(params.documentCode, params.fileName, params.fileBuffer);
  if (maps.length === 0) return existing;
  return replaceTemplateFieldMaps(params.templateId, params.documentCode, params.actorUserId, maps);
}

// ─── Schema JSON seeding ────────────────────────────────────────────────────

type SchemaJsonField = {
  page: number;
  name: string;
  type: "comb_text" | "text" | "checkbox" | "signature_placeholder";
  rect_pdf_pt: [number, number, number, number]; // [x, y, width, height]
  db_source_suggestion: string;
  tooltip?: string;
  max_length?: number;
};

type SchemaJson = {
  fields: SchemaJsonField[];
};

/** Parse a raw db_source_suggestion string into source_path, transform_rule, checked_when. */
function parseDbSourceSuggestion(suggestion: string): {
  source_path: string | null;
  transform_rule: string | null;
  checked_when: string | null;
} {
  if (!suggestion || suggestion.startsWith("esign.") || suggestion.startsWith("employer_kyc") || suggestion.startsWith("employer.")) {
    return { source_path: null, transform_rule: null, checked_when: null };
  }

  // Checkbox pattern:  "some.path == VALUE"
  const eqMatch = suggestion.match(/^([^\s=]+)\s*==\s*(.+)$/);
  if (eqMatch) {
    const rawPath = eqMatch[1].trim();
    const checkedWhen = eqMatch[2].trim();
    return { source_path: mapKycPath(rawPath), transform_rule: null, checked_when: checkedWhen };
  }

  // Slice pattern:  "some.path[N:M]"
  const sliceMatch = suggestion.match(/^([^\[]+)\[(\d+):(\d+)\]/);
  if (sliceMatch) {
    const rawPath = sliceMatch[1].trim();
    const n = sliceMatch[2];
    const m = sliceMatch[3];
    return { source_path: mapKycPath(rawPath), transform_rule: `slice_${n}_${m}`, checked_when: null };
  }

  // Date format pattern:  "... formatted DDMMYYYY"
  const dateFmtMatch = suggestion.match(/^([^\s]+)\s+formatted\s+DDMMYYYY/i);
  if (dateFmtMatch) {
    return { source_path: mapKycPath(dateFmtMatch[1].trim()), transform_rule: "date_ddmmyyyy", checked_when: null };
  }

  // Digits-only fields (mobile, UAN, account numbers)
  const digitsFields = ["employee.mobile_number", "epf.uan_number", "kyc.bank_account.number"];
  const cleaned = suggestion.split(" ")[0].trim();
  if (digitsFields.includes(cleaned)) {
    return { source_path: mapKycPath(cleaned), transform_rule: "digits_only", checked_when: null };
  }

  // Plain path
  return { source_path: mapKycPath(cleaned), transform_rule: null, checked_when: null };
}

/** Map kyc.* and employment.* paths to the HRMS source context paths. */
function mapKycPath(raw: string): string {
  const MAP: Record<string, string> = {
    "kyc.aadhaar.name":            "statutory.aadhaar_name",
    "kyc.aadhaar.number":          "statutory.aadhaar_number",
    "kyc.aadhaar.remarks":         "statutory.aadhaar_remarks",
    "kyc.pan.name":                "statutory.pan_name",
    "kyc.pan.number":              "statutory.pan_number",
    "kyc.pan.remarks":             "statutory.pan_remarks",
    "kyc.bank_account.name":       "statutory.bank_account_name",
    "kyc.bank_account.number":     "statutory.bank_account_number",
    "kyc.bank_account.remarks":    "statutory.ifsc_code",
    "kyc.passport.name":           "kyc.passport_name",
    "kyc.passport.number":         "kyc.passport_number",
    "kyc.passport.remarks":        "kyc.passport_remarks",
    "kyc.driving_licence.name":    "kyc.driving_licence_name",
    "kyc.driving_licence.number":  "kyc.driving_licence_number",
    "kyc.driving_licence.remarks": "kyc.driving_licence_remarks",
    "kyc.election_card.name":      "kyc.election_card_name",
    "kyc.election_card.number":    "kyc.election_card_number",
    "kyc.election_card.remarks":   "kyc.election_card_remarks",
    "kyc.ration_card.name":        "kyc.ration_card_name",
    "kyc.ration_card.number":      "kyc.ration_card_number",
    "kyc.ration_card.remarks":     "kyc.ration_card_remarks",
    "kyc.esic_card.name":          "kyc.esic_card_name",
    "kyc.esic_card.number":        "kyc.esic_card_number",
    "kyc.esic_card.remarks":       "kyc.esic_card_remarks",
    "employment.joining_date":     "employee.date_of_joining",
    "epf.declaration_date":        "system.current_date",
    "employee.branch_or_city":     "employee.branch_name",
  };
  return MAP[raw] ?? raw;
}

/** Map JSON field type → fill engine mapping_mode and field_type. */
function schemaTypeToMappingMode(type: SchemaJsonField["type"]): { mapping_mode: string; field_type: string } {
  switch (type) {
    case "comb_text":             return { mapping_mode: "pdf_box_grid",             field_type: "text" };
    case "text":                  return { mapping_mode: "pdf_coordinate_overlay",   field_type: "text" };
    case "checkbox":              return { mapping_mode: "pdf_coordinate_overlay",   field_type: "checkbox" };
    case "signature_placeholder": return { mapping_mode: "pdf_coordinate_overlay",   field_type: "signature" };
  }
}

/**
 * Seed document_template_field_map rows from an uploaded JSON schema.
 * Rows with mapping_confirmed = 1 are not overwritten.
 * Returns the number of rows upserted.
 */
export async function seedFieldMapsFromSchema(
  templateId: string,
  documentCode: string,
  schema: SchemaJson,
  actorUserId: string,
): Promise<number> {
  if (!schema?.fields?.length) return 0;

  // Fetch existing confirmed field keys so we don't overwrite them
  const [confirmedRows] = await db.execute<RowDataPacket[]>(
    `SELECT field_key FROM document_template_field_map
      WHERE template_id = ? AND document_code = ? AND mapping_confirmed = 1`,
    [templateId, documentCode],
  );
  const confirmedKeys = new Set(confirmedRows.map((r) => String(r.field_key)));

  let upserted = 0;

  for (const field of schema.fields) {
    if (confirmedKeys.has(field.name)) continue; // admin already confirmed this one

    const { mapping_mode, field_type } = schemaTypeToMappingMode(field.type);
    const { source_path, transform_rule, checked_when } = parseDbSourceSuggestion(field.db_source_suggestion ?? "");
    const [x, y, w, h] = field.rect_pdf_pt;

    await db.execute(
      `INSERT INTO document_template_field_map
         (id, template_id, document_code, field_key, field_label, source_path,
          page_no, x, y, width, height,
          field_type, mapping_mode, placeholder_token, pdf_field_name,
          transform_rule, checked_when, max_length,
          schema_field_tooltip, schema_suggested_path,
          mapping_confirmed, required, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
       ON DUPLICATE KEY UPDATE
         source_path          = IF(mapping_confirmed = 0, VALUES(source_path),          source_path),
         page_no              = IF(mapping_confirmed = 0, VALUES(page_no),              page_no),
         x                    = IF(mapping_confirmed = 0, VALUES(x),                    x),
         y                    = IF(mapping_confirmed = 0, VALUES(y),                    y),
         width                = IF(mapping_confirmed = 0, VALUES(width),                width),
         height               = IF(mapping_confirmed = 0, VALUES(height),               height),
         field_type           = IF(mapping_confirmed = 0, VALUES(field_type),           field_type),
         mapping_mode         = IF(mapping_confirmed = 0, VALUES(mapping_mode),         mapping_mode),
         transform_rule       = IF(mapping_confirmed = 0, VALUES(transform_rule),       transform_rule),
         checked_when         = IF(mapping_confirmed = 0, VALUES(checked_when),         checked_when),
         max_length           = IF(mapping_confirmed = 0, VALUES(max_length),           max_length),
         schema_field_tooltip = VALUES(schema_field_tooltip),
         schema_suggested_path = VALUES(schema_suggested_path),
         updated_at           = NOW()`,
      [
        randomUUID(),
        templateId,
        documentCode,
        field.name,
        field.tooltip ?? field.name,
        source_path,
        field.page ?? 1,
        x, y, w, h,
        field_type,
        mapping_mode,
        `{{${field.name.toUpperCase()}}}`,
        field.name,
        transform_rule,
        checked_when,
        field.max_length ?? null,
        field.tooltip ?? null,
        field.db_source_suggestion ?? null,
        actorUserId,
      ],
    );
    upserted++;
  }

  return upserted;
}

export async function synchronizeChecklistFieldValues(checklistId: string, actorUserId?: string | null) {
  const checklist = await checklistContext(checklistId);
  const maps = await fieldMapsForTemplate(checklist.template_id, checklist.document_code);
  const sourceContext = await buildSourceContext(checklist.employee_id, checklist.candidate_id);
  const [existingRows] = await db.execute<RowDataPacket[]>(
    `SELECT field_key, value_source, value_text
       FROM employee_joining_document_field_value
      WHERE checklist_id = ?`,
    [checklistId],
  );
  const existingByKey = new Map(existingRows.map((row) => [String(row.field_key), row]));

  for (const map of maps) {
    const existing = existingByKey.get(String(map.field_key));
    if (existing && ["HR_ENTERED", "EMPLOYEE_CONFIRMED", "PAYROLL_ENTERED"].includes(String(existing.value_source))) {
      continue;
    }
    const derived = deriveFieldValue(map, sourceContext);
    const valueId = await upsertFieldValue({
      checklistId,
      employeeId: checklist.employee_id,
      documentCode: checklist.document_code,
      fieldKey: String(map.field_key),
      fieldLabel: String(map.field_label),
      sourcePath: safeTrim(map.source_path),
      fieldType: String(map.field_type ?? "text"),
      valueText: derived.value_text,
      maskedValue: derived.masked_value,
      valueSource: "SYSTEM",
      fillStatus: derived.fill_status,
      confidenceScore: derived.confidence_score,
      requiresConfirmation: Number(derived.requires_confirmation),
      actorUserId,
    });
    await auditFieldChange({
      employeeId: checklist.employee_id,
      candidateId: checklist.candidate_id ?? null,
      checklistId,
      documentCode: checklist.document_code,
      actionType: derived.value_text ? "AUTO_FIELD_FILLED" : "AUTO_FIELD_MISSING",
      actorUserId,
      actorType: actorUserId ? "hr" : "system",
      newValue: {
        valueId,
        field_key: map.field_key,
        value_source: "SYSTEM",
        fill_status: derived.fill_status,
      },
    });
  }

  await persistChecklistFillStatus(checklistId);
  return getChecklistFieldReview(checklistId);
}

export async function manualFillChecklistValues(params: {
  checklistId: string;
  actorUserId: string;
  updates: FieldValueUpdate[];
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const checklist = await checklistContext(params.checklistId);
  for (const update of params.updates) {
    const [mapRows] = await db.execute<RowDataPacket[]>(
      `SELECT field_label, source_path, field_type
         FROM document_template_field_map
        WHERE document_code = ? AND field_key = ?
        ORDER BY updated_at DESC
        LIMIT 1`,
      [checklist.document_code, update.field_key],
    );
    const fieldMap = mapRows[0];
    const [existingRows] = await db.execute<RowDataPacket[]>(
      `SELECT value_text, value_source FROM employee_joining_document_field_value WHERE checklist_id = ? AND field_key = ? LIMIT 1`,
      [params.checklistId, update.field_key],
    );
    const existing = existingRows[0];
    await upsertFieldValue({
      checklistId: params.checklistId,
      employeeId: checklist.employee_id,
      documentCode: checklist.document_code,
      fieldKey: update.field_key,
      fieldLabel: String(fieldMap?.field_label ?? update.field_key),
      sourcePath: safeTrim(fieldMap?.source_path),
      fieldType: String(fieldMap?.field_type ?? "text"),
      valueText: safeTrim(update.value_text),
      maskedValue: safeTrim(update.value_text),
      valueSource: "HR_ENTERED",
      fillStatus: "hr_filled",
      confidenceScore: 100,
      requiresConfirmation: 1,
      actorUserId: params.actorUserId,
      hrReason: safeTrim(update.reason),
    });
    await auditFieldChange({
      employeeId: checklist.employee_id,
      candidateId: checklist.candidate_id ?? null,
      checklistId: params.checklistId,
      documentCode: checklist.document_code,
      actionType: "HR_FIELD_MANUAL_FILL",
      actorUserId: params.actorUserId,
      actorType: "hr",
      remarks: safeTrim(update.reason),
      oldValue: existing ? { value_text: existing.value_text, value_source: existing.value_source } : null,
      newValue: { value_text: update.value_text, value_source: "HR_ENTERED" },
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    });
  }
  await persistChecklistFillStatus(params.checklistId);
  return getChecklistFieldReview(params.checklistId);
}

async function writeArtifact(employeeId: string, documentCode: string, fileName: string, content: Buffer) {
  const dirPath = path.join(STORAGE_ROOT, employeeId, documentCode.toLowerCase(), "filled");
  ensureDir(dirPath);
  const storedFilename = `${Date.now()}-${randomUUID()}${path.extname(fileName) || ".pdf"}`;
  const storagePath = path.join(dirPath, storedFilename);
  fs.writeFileSync(storagePath, content);
  return {
    storedFilename,
    storagePath,
    fileHash: createHash("sha256").update(content).digest("hex"),
    fileSize: content.byteLength,
  };
}

/**
 * States that mean a document is finished.
 *
 * Mirrors isChecklistTerminalStatus() in employeeJoiningDocuments.service.ts and
 * TERMINAL_STATUSES in joiningKitAssembly.service.ts — the same five states, kept
 * as a local copy the way joiningKitAssembly does, rather than importing across
 * module boundaries for one array.
 */
const TERMINAL_CHECKLIST_STATUSES = [
  'verified', 'completed', 'esign_completed', 'signed_verified', 'wet_signed_uploaded',
] as const;

async function attachGeneratedArtifact(checklist: ChecklistContextRow, content: Buffer, fileName: string, actorUserId?: string | null) {
  const artifact = await writeArtifact(checklist.employee_id, checklist.document_code, fileName, content);
  const fileId = randomUUID();
  await db.execute(
    `INSERT INTO employee_joining_document_file
       (id, checklist_id, employee_id, candidate_id, document_code, file_role, original_filename, stored_filename, storage_path, mime_type, file_size_bytes, file_hash_sha256, uploaded_by, uploaded_by_type)
     VALUES (?, ?, ?, ?, ?, 'generated', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fileId,
      checklist.checklist_id,
      checklist.employee_id,
      checklist.candidate_id ?? null,
      checklist.document_code,
      fileName,
      artifact.storedFilename,
      artifact.storagePath,
      mimeTypeFromFileName(fileName),
      artifact.fileSize,
      artifact.fileHash,
      actorUserId ?? null,
      actorUserId ? "hr" : "system",
    ],
  );
  await db.execute(
    `UPDATE employee_joining_document_checklist
        SET fill_status = CASE WHEN employee_review_status = 'confirmed' THEN 'ready_for_esign' ELSE fill_status END,
            status = CASE
              -- A regenerated draft must never walk a finished document backwards.
              -- This CASE used to end at 'draft_generated' unconditionally, so
              -- regenerating any document that had already been signed reset it to
              -- "draft" and destroyed the completion — with fill_status and
              -- completed_at left behind as the only evidence it had ever been
              -- signed. It happened in production once (MAS47814's employment
              -- contract, signed 2026-08-01 11:13, reset at 17:21).
              --
              -- ats.convert.service.ts already documents this hazard and works
              -- around it by not calling the generator at all. That protects one
              -- call site; the corruption belongs to this write, so the guard
              -- belongs here, where every caller gets it.
              WHEN status IN (${TERMINAL_CHECKLIST_STATUSES.map(() => '?').join(', ')}) THEN status
              WHEN employee_review_status = 'confirmed' THEN 'ready_for_esign'
              WHEN fill_status = 'hr_fill_required' THEN 'hr_fill_required'
              ELSE 'draft_generated'
            END,
            updated_at = NOW()
      WHERE id = ?`,
    [...TERMINAL_CHECKLIST_STATUSES, checklist.checklist_id],
  );
  return fileId;
}

function mimeTypeFromFileName(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === ".html") return "text/html";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

async function renderSummaryPdf(checklist: ChecklistContextRow, values: RowDataPacket[]) {
  const outputPath = path.join(STORAGE_ROOT, checklist.employee_id, checklist.document_code.toLowerCase(), "summary-preview.pdf");
  ensureDir(path.dirname(outputPath));
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocumentKit({ margin: 42, size: "A4" });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);
    doc.fontSize(22).fillColor("#B91C1C").text("DRAFT - TEMPLATE NOT CONFIGURED", { align: "center" });
    doc.moveDown(0.75);
    doc.fillColor("#111827").fontSize(18).text(checklist.document_name, { align: "center" });
    doc.moveDown();
    doc.fontSize(11).text("Digital draft generated by HRMS Universal Digital Form Fill Engine.");
    doc.text("This is a placeholder until the official template and field map are configured.");
    doc.moveDown();
    values.forEach((value) => {
      doc.font("Helvetica-Bold").text(`${value.field_label}: `, { continued: true });
      doc.font("Helvetica").text(String(value.value_text ?? ""));
    });
    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  return fs.readFileSync(outputPath);
}

/**
 * ISO date -> DD/MM/YYYY, for display in a signed document.
 *
 * Presentation only. Stored field values must stay ISO: the EPF declaration
 * splits dates into individual character boxes via applyTransformRule, whose
 * splitIsoDate matches /^(\d{4})-(\d{2})-(\d{2})/ — a DD/MM/YYYY value there
 * would blank every date box on the statutory form.
 */
function formatDateForDocumentDisplay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

/** Exported for tests: the legacy fix-up pass below is easy to regress silently. */
export async function renderPlaceholderDocx(templatePath: string, replacements: Record<string, string>) {
  const zip = new PizZip(fs.readFileSync(templatePath));
  const documentXml = zip.file("word/document.xml")?.asText();
  if (!documentXml) throw new Error("DOCX template is missing word/document.xml");
  let nextXml = documentXml;
  // The fix-ups further down were written for the original hand-authored Word
  // files, which had bare labels ("Employee Name:") and no placeholders. On a
  // token template they are not just redundant but destructive: the PI consent
  // line renders "Employee Name: {{pi_employee_name}}   Employee Code: {{employee_code}}"
  // as a single run, and /Employee Name\s*:\s*[^<]+/ is greedy to the end of
  // that run, so it swallows the already-substituted employee code. Templates
  // that carry placeholders are fully described by their tokens — skip the
  // legacy pass for them and keep it only for the older uploaded documents.
  const isTokenTemplate = documentXml.includes("{{");
  for (const [token, value] of Object.entries(replacements)) {
    // A joiner signing "Date of Joining: 2017-01-19" reads as a system dump;
    // Indian documents use DD/MM/YYYY. Applied here so only the rendered
    // document changes, never the persisted value.
    nextXml = nextXml.split(`{{${token}}}`).join(formatDateForDocumentDisplay(value));
  }
  const employeeName = escapeXml(replacements.employee_name ?? replacements.full_name ?? "");
  const employeeCode = escapeXml(replacements.employee_code ?? "");
  const joiningDate = escapeXml(replacements.date_of_joining ?? "");
  const currentDate = escapeXml(replacements.current_date ?? "");
  const ndaDate = escapeXml(replacements.nda_signature_date ?? currentDate);
  const itDate = escapeXml(replacements.it_signature_date ?? currentDate);
  const surveillanceDate = escapeXml(replacements.surveillance_signature_date ?? currentDate);
  const bamsName = escapeXml(replacements.bams_employee_name ?? employeeName);
  const bamsCode = escapeXml(replacements.bams_employee_code ?? employeeCode);
  const bamsDoj = escapeXml(replacements.bams_date_of_joining ?? joiningDate);
  const piName = escapeXml(replacements.pi_employee_name ?? employeeName);
  const piDate = escapeXml(replacements.pi_signature_date ?? currentDate);
  const zeroToleranceDate = escapeXml(replacements.zero_tolerance_signature_date ?? currentDate);
  const hrName = escapeXml(replacements.surveillance_hr_name ?? "");
  if (employeeName && !isTokenTemplate) {
    nextXml = nextXml
      .replace(/(I\s+)([A-Z][A-Z\s.]{2,80})(\s*,\s*agree)/g, `$1${employeeName}$3`);
  }
  if (!isTokenTemplate) nextXml = nextXml
    .replace(/Name of the Analyst:\s*Date/g, `Name of the Analyst: ${employeeName}    Date: ${ndaDate}`)
    .replace(/Signature\s+Date/g, `Signature: __________________    Date: ${itDate}`)
    .replace(/Name of the candidate:\s*HR Person name\s*:/g, `Name of the candidate: ${employeeName}    HR Person name: ${hrName}`)
    .replace(/Signature\s*:\s*Date\s*:/g, `Signature: __________________    Date: ${surveillanceDate}`)
    .replace(/Regards,\s*Name/g, `Regards, ${bamsName}`)
    .replace(/E Code\s+DOJ/g, `E Code: ${bamsCode}    DOJ: ${bamsDoj}`)
    .replace(/Employee Name\s*:\s*[^<]+/g, `Employee Name: ${piName}`)
    .replace(/Employee Signature\s*:\s*Date\s*:/g, `Employee Signature: __________________    Date: ${piDate}`)
    .replace(/Signature:\s*Date:/g, `Signature: __________________    Date: ${zeroToleranceDate}`);
  zip.file("word/document.xml", nextXml);
  return zip.generate({ type: "nodebuffer" });
}

async function renderFillablePdf(templatePath: string, fieldMaps: RowDataPacket[], values: RowDataPacket[]) {
  const pdfBytes = fs.readFileSync(templatePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const form = pdfDoc.getForm();
  const valueMap = new Map(values.map((value) => [String(value.field_key), String(value.value_text ?? "")]));
  for (const fieldMap of fieldMaps) {
    const fieldName = safeTrim(fieldMap.pdf_field_name) ?? String(fieldMap.field_key);
    const textValue = valueMap.get(String(fieldMap.field_key)) ?? "";
    const field = form.getFields().find((candidate) => candidate.getName() === fieldName);
    if (!field) continue;
    try {
      if ("setText" in field && typeof field.setText === "function") {
        const textField = field as { setText?: (value: string) => void };
        textField.setText?.(textValue);
      }
      if ("check" in field && typeof field.check === "function" && textValue) {
        const checkboxField = field as { check?: () => void };
        checkboxField.check?.();
      }
    } catch {
      continue;
    }
  }
  form.flatten();
  return Buffer.from(await pdfDoc.save());
}

function normalizeGridText(text: string, fieldType: string) {
  const value = String(text || "").toUpperCase();
  if (fieldType === "date") return value.replace(/\D/g, "");
  if (fieldType === "email") return value.replace(/\s+/g, "");
  return value.replace(/\s+/g, " ").trim();
}

async function renderOverlayPdf(templatePath: string, fieldMaps: RowDataPacket[], values: RowDataPacket[]) {
  const pdfBytes = fs.readFileSync(templatePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const valueMap = new Map(values.map((value) => [String(value.field_key), String(value.value_text ?? "")]));
  const pages = pdfDoc.getPages();
  for (const map of fieldMaps) {
    const pageIndex = Math.max(0, Number(map.page_no ?? 1) - 1);
    const page = pages[pageIndex];
    if (!page) continue;
    const text = valueMap.get(String(map.field_key)) ?? "";
    if (!text) continue;
    if (map.x == null || map.y == null) continue;
    const x = Number(map.x ?? 40);
    const y = Number(map.y ?? 700);
    const fontSize = Number(map.font_size ?? 10);
    const mappingMode = String(map.mapping_mode ?? "");
    if (mappingMode === "pdf_box_grid") {
      const cellWidth = Math.max(1, Number(map.width ?? 12));
      const gridText = normalizeGridText(text, String(map.field_type ?? "text"));
      [...gridText].forEach((char, index) => {
        const glyphWidth = boldFont.widthOfTextAtSize(char, fontSize);
        page.drawText(char, {
          x: x + index * cellWidth + Math.max(0, (cellWidth - glyphWidth) / 2),
          y,
          size: fontSize,
          font: boldFont,
        });
      });
      continue;
    }
    if (String(map.field_type ?? "text") === "checkbox") {
      page.drawText(text ? "X" : "", { x, y, size: fontSize, font: boldFont });
    } else {
      page.drawText(text, { x, y, size: fontSize, font });
    }
  }
  return Buffer.from(await pdfDoc.save());
}

/**
 * Field values supplied for one render and deliberately never persisted.
 *
 * The EPF declaration is a statutory EPFO filing: page 3 requires the real bank
 * account + IFSC (mandatory), Aadhaar and PAN. This system masks those at the
 * point of save by design, so the stored values are unusable on the form. The
 * employee therefore supplies them at signing time and they are written into the
 * generated PDF only — the PDF lives in access-controlled private storage, and
 * nothing is written back to any column.
 */
export type TransientFieldValues = Record<string, string>;

export async function generateChecklistDraft(
  checklistId: string,
  actorUserId?: string | null,
  transientValues?: TransientFieldValues,
) {
  const checklist = await checklistContext(checklistId);
  const fieldReview = await synchronizeChecklistFieldValues(checklistId, actorUserId);
  const persisted = fieldReview.values as RowDataPacket[];
  // Overlay the transient values over the persisted (masked) ones for this
  // render only. synchronizeChecklistFieldValues has already run, so nothing
  // below writes these back.
  const values = (transientValues && Object.keys(transientValues).length
    ? persisted.map((row) => {
        const override = transientValues[String(row.field_key)];
        return override === undefined ? row : { ...row, value_text: override };
      })
    : persisted) as RowDataPacket[];
  const fieldMaps = await fieldMapsForTemplate(checklist.template_id, checklist.document_code);
  const replacements = Object.fromEntries([
    ...values.map((value) => [String(value.field_key), String(value.value_text ?? "")]),
    ...fieldMaps
      .filter((map) => safeTrim(map.placeholder_token))
      .map((map) => {
        const fieldValue = values.find((value) => String(value.field_key) === String(map.field_key));
        return [String(map.placeholder_token).replace(/^\{\{|\}\}$/g, ""), String(fieldValue?.value_text ?? "")];
      }),
  ]);
  let outputFileName = `${checklist.document_code.toLowerCase()}-draft.pdf`;
  let content: Buffer;

  try {
    // Prefer the letterheaded renderer wherever a definition exists.
    //
    // joiningDocumentPdf.service was written to issue these as finished, letterheaded
    // PDFs carrying the company logo, address and page numbering - and was then never
    // imported anywhere, so every joiner kept receiving the bare .docx produced from
    // the placeholder template. Those files contain no images at all, which is why no
    // logo has ever appeared on an issued document.
    //
    // It also fixes signing. Luckpay rejects every one of these .docx drafts with
    // "Unable to generate appearance"; the only document that ever signed cleanly was
    // a PDF. Six document codes have definitions - BAMS_DECLARATION,
    // EMPLOYMENT_CONTRACT, IT_COMPLIANCE, NDA_CONFIDENTIALITY, PI_PROCESSING_CONSENT
    // and ZERO_TOLERANCE_ACK - and they are exactly the six that were failing.
    //
    // Anything without a definition keeps the previous template path unchanged.
    const templatePath = resolveTemplateFile(checklist.template_storage_path);
    if (hasStructuredPdf(checklist.document_code)) {
      outputFileName = `-draft.pdf`;
      // Letterhead shows the branch that issued the document, not a hardcoded
      // head-office address. Resolution failure is non-fatal: the renderer falls
      // back to the constant rather than blocking a draft.
      const letterhead = await resolveEmployeeLetterhead(String(checklist.employee_id))
        .catch(() => undefined);
      content = await renderJoiningDocumentPdf(checklist.document_code, replacements, letterhead);
    } else if (templatePath) {
      const fillMode = safeTrim(checklist.fill_mode) ?? "placeholder";
      if (fillMode === "placeholder" && templatePath.toLowerCase().endsWith(".docx")) {
        outputFileName = `${checklist.document_code.toLowerCase()}-draft.docx`;
        content = await renderPlaceholderDocx(templatePath, replacements);
      } else if (fillMode === "acroform") {
        if (!templatePath.toLowerCase().endsWith(".pdf")) {
          throw new Error("AcroForm templates must be PDF files.");
        }
        content = await fillAcroFormPdf({
          templatePath,
          fieldMaps,
          values: values.map((value) => ({ field_key: String(value.field_key), value_text: String(value.value_text ?? "") })),
          flatten: false,
        });
        // Both EPF forms carry an employer block the form itself requires to be
        // sealed. Stamping it here means HR no longer prints, signs, scans and
        // re-uploads every statutory form.
        //
        // Signed by the Payroll HR of the branch this joiner belongs to, rather
        // than one company-wide signature for everyone. Where no branch
        // signatory is configured — which is every branch until they are set up
        // — this resolves to exactly the company seal used before, so the
        // documents are unchanged.
        const branchSignatory = await getPayrollHrSignatoryForEmployee(
          String(checklist.employee_id), { withImage: true },
        ).catch(() => null);
        content = Buffer.from(
          await applyCompanySeal(
            content,
            String(checklist.document_code ?? ""),
            branchSignatory
              ? mergeBranchSignatureIntoSeal(await loadCompanySeal(), branchSignatory)
              : undefined,
          ),
        );
      } else if (fillMode === "fillable_pdf") {
        content = await renderFillablePdf(templatePath, fieldMaps, values);
      } else if (
        fillMode === "pdf_overlay" ||
        fillMode === "pdf_coordinate_overlay" ||
        fillMode === "scanned_pdf_overlay" ||
        fillMode === "image_pdf_overlay" ||
        templatePath.toLowerCase().endsWith(".pdf")
      ) {
        content = await renderOverlayPdf(templatePath, fieldMaps, values);
      } else {
        content = await renderSummaryPdf(checklist, values);
      }
    } else {
      content = await renderSummaryPdf(checklist, values);
    }
  } catch (error) {
    if ((safeTrim(checklist.fill_mode) ?? "") === "acroform") throw error;
    content = await renderSummaryPdf(checklist, values);
  }

  const fileId = await attachGeneratedArtifact(checklist, content, outputFileName, actorUserId);
  await auditFieldChange({
    employeeId: checklist.employee_id,
    candidateId: checklist.candidate_id ?? null,
    checklistId,
    documentCode: checklist.document_code,
    actionType: "DRAFT_GENERATED",
    actorUserId,
    actorType: actorUserId ? "hr" : "system",
    newValue: { generated_file_id: fileId, output_file_name: outputFileName },
  });
  return {
    file_id: fileId,
    file_name: outputFileName,
    review: await getChecklistFieldReview(checklistId),
  };
}

export async function inspectChecklistAcroFormTemplate(checklistId: string) {
  const checklist = await checklistContext(checklistId);
  const templatePath = resolveTemplateFile(checklist.template_storage_path);
  if (!templatePath) {
    throw new Error("Template file not found for checklist.");
  }
  const fieldMaps = await fieldMapsForTemplate(checklist.template_id, checklist.document_code);
  return validateAcroFormTemplate(templatePath, fieldMaps);
}

export async function getChecklistFieldReview(checklistId: string) {
  const checklist = await checklistContext(checklistId);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT field_key, field_label, source_path, field_type, value_text, masked_value, value_source, fill_status, confidence_score, requires_confirmation, employee_confirmed, employee_confirmation_comment, hr_reason, updated_at
       FROM employee_joining_document_field_value
      WHERE checklist_id = ?
      ORDER BY updated_at ASC, field_label ASC`,
    [checklistId],
  );
  const [latestFileRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, original_filename, mime_type
       FROM employee_joining_document_file
      WHERE checklist_id = ?
        AND deleted_at IS NULL
      ORDER BY FIELD(file_role, 'signed', 'generated', 'hr_uploaded', 'supporting'), uploaded_at DESC
      LIMIT 1`,
    [checklistId],
  );
  return {
    checklist,
    values: rows,
    latest_file: latestFileRows[0] ?? null,
  };
}

export async function employeeReviewChecklistByToken(params: {
  publicToken: string;
  action: "confirm" | "request_correction";
  comment?: string | null;
  actorName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const publicTokenHash = createHash("sha256").update(String(params.publicToken ?? "").trim()).digest("hex");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT checklist_id, employee_id, document_code
       FROM employee_joining_document_public_token
      WHERE public_token_hash = ?
        AND token_status = 'active'
        AND expires_at > NOW()
      LIMIT 1`,
    [publicTokenHash],
  );
  const tokenRow = rows[0];
  if (!tokenRow) {
    const err = new Error("Invalid or expired employee review link") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  if (params.action === "confirm") {
    await db.execute(
      `UPDATE employee_joining_document_field_value
          SET employee_confirmed = 1,
              employee_confirmed_at = NOW(),
              employee_confirmation_comment = COALESCE(?, employee_confirmation_comment),
              value_source = CASE WHEN value_source = 'HR_ENTERED' THEN 'EMPLOYEE_CONFIRMED' ELSE value_source END,
              fill_status = 'ready_for_esign'
        WHERE checklist_id = ?`,
      [params.comment ?? null, tokenRow.checklist_id],
    );
    await db.execute(
      `UPDATE employee_joining_document_checklist
          SET employee_review_status = 'confirmed',
              employee_reviewed_at = NOW(),
              employee_review_comment = ?,
              fill_status = 'ready_for_esign',
              status = 'ready_for_esign',
              updated_at = NOW()
        WHERE id = ?`,
      [params.comment ?? null, tokenRow.checklist_id],
    );
  } else {
    await db.execute(
      `UPDATE employee_joining_document_field_value
          SET fill_status = 'correction_requested',
              employee_confirmation_comment = COALESCE(?, employee_confirmation_comment),
              updated_at = NOW()
        WHERE checklist_id = ?`,
      [params.comment ?? null, tokenRow.checklist_id],
    );
    await db.execute(
      `UPDATE employee_joining_document_checklist
          SET employee_review_status = 'correction_requested',
              employee_reviewed_at = NOW(),
              employee_review_comment = ?,
              fill_status = 'correction_requested',
              status = 'correction_requested',
              updated_at = NOW()
        WHERE id = ?`,
      [params.comment ?? null, tokenRow.checklist_id],
    );
  }

  await auditFieldChange({
    employeeId: String(tokenRow.employee_id),
    checklistId: String(tokenRow.checklist_id),
    documentCode: String(tokenRow.document_code),
    actionType: params.action === "confirm" ? "EMPLOYEE_REVIEW_CONFIRMED" : "EMPLOYEE_REVIEW_CORRECTION_REQUESTED",
    actorType: "public_token",
    remarks: params.comment ?? null,
    newValue: { actorName: params.actorName ?? null, action: params.action },
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
  });

  return getChecklistFieldReview(String(tokenRow.checklist_id));
}
