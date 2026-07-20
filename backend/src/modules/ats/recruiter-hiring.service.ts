import { randomUUID } from "crypto";
import * as XLSX from "xlsx";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { atsService } from "./ats.service.js";
import { atsQueueService } from "./ats.queue.service.js";
import { sendOnboardingToken } from "./ats.onboarding.service.js";
import { resolveRecruiterForActor } from "../ats-full-parity/recruiterInterview.service.js";

export type DuplicateMode = "insert_duplicates_with_warning" | "update_existing" | "skip_duplicates";

export type HiringSheetRow = Record<string, unknown>;

type CandidateBridgeRecord = RowDataPacket & { id: string };

export type NormalizedHiringActivity = {
  activity_date: string;
  activity_month: string | null;
  recruiter_id: string | null;
  recruiter_employee_id: string | null;
  recruiter_code: string | null;
  recruiter_name_snapshot: string;
  hiring_source: string;
  wp_group: string | null;
  position_name: string;
  location_name: string;
  branch_name: string | null;
  process_name: string;
  candidate_name: string;
  gender: string | null;
  mobile: string;
  candidate_email: string | null;
  education_qualification: string | null;
  experience_level: string | null;
  candidate_location: string | null;
  recruiter_remarks: string | null;
  recruiter_rejection_reason: string | null;
  pi_hr_interviewer_date: string | null;
  pi_hr_interviewer_name: string | null;
  hr_interview_status: string | null;
  hr_rejection_reason: string | null;
  ai_assessment_score: number | null;
  ai_interview_result: string | null;
  ops_interviewer_employee_id: string | null;
  ops_interviewer_name: string | null;
  ops_interviewer_branch_snapshot: string | null;
  ops_interview_status: string | null;
  ops_rejection_reason: string | null;
  salary_package_inr: number | null;
  offer_letter_status: string | null;
  joining_status: string | null;
  batch_no: string | null;
  current_status: string | null;
  joined_candidate_emp_code: string | null;
  emp_referral_details: string | null;
  referee_employee_id: string | null;
  referee_employee_code: string | null;
  referee_name: string | null;
  referee_branch: string | null;
  referee_process: string | null;
  referral_relationship: string | null;
  referral_remarks: string | null;
  referral_validation_status: string | null;
  walkin_flag: number;
  final_selection_flag: number;
  joined_flag: number;
  contacted_flag: number;
  linked_candidate_id: string | null;
  queue_token_id: string | null;
  onboarding_bridge_id: string | null;
  employee_id: string | null;
  followup_required: number;
  duplicate_warning: number;
  duplicate_of_activity_id: string | null;
  duplicate_override_reason: string | null;
  import_batch_id: string | null;
  source_system: string;
  raw_sheet_payload: HiringSheetRow | null;
  created_by: string | null;
  updated_by: string | null;
};

export type ImportResult = {
  batchId: string;
  fileName: string;
  totalRows: number;
  insertedRows: number;
  updatedRows: number;
  duplicateRows: number;
  failedRows: number;
  errors: Array<{ row_number: number; column_name: string | null; error_message: string }>;
};

export type HiringDashboard = {
  metrics: Record<string, number>;
  byRecruiter: Array<{ label: string; total: number; contacted: number; selected: number; joined: number }>;
  bySource: Array<{ label: string; total: number; contacted: number; selected: number; joined: number }>;
  byProcess: Array<{ label: string; total: number; contacted: number; selected: number; joined: number }>;
  byBranch: Array<{ label: string; total: number; contacted: number; selected: number; joined: number }>;
};

export type HiringActivityBootstrap = {
  actor: {
    userId: string;
    recruiterName: string;
    recruiterEmployeeId: string | null;
    recruiterCode: string | null;
    branchName: string;
    activityDate: string;
    activityMonth: string;
  };
  options: {
    processOptions: string[];
    sourceOptions: string[];
    positionOptions: string[];
    wpGroupOptions: string[];
    callingOutcomeOptions: string[];
    rejectionReasonOptions: string[];
    genderOptions: string[];
    educationOptions: string[];
    experienceOptions: string[];
  };
};

export type HiringFilters = {
  fromDate?: string;
  toDate?: string;
  month?: string;
  recruiter?: string;
  hiringSource?: string;
  wpGroup?: string;
  position?: string;
  location?: string;
  branch?: string;
  process?: string;
  gender?: string;
  education?: string;
  experienceLevel?: string;
  recruiterRemarks?: string;
  hrInterviewStatus?: string;
  aiInterviewResult?: string;
  opsInterviewStatus?: string;
  offerLetterStatus?: string;
  joiningStatus?: string;
  batchNo?: string;
  currentStatus?: string;
  walkin?: string;
  finalSelection?: string;
  joined?: string;
  contacted?: string;
  search?: string;
  page?: number;
  limit?: number;
};

interface BranchNameRow extends RowDataPacket {
  branch_name: string | null;
}

interface CountRow extends RowDataPacket {
  total: number;
}

interface HiringActivityRow extends RowDataPacket, HiringSheetRow {
  id: string;
  created_by: string | null;
}

interface DashboardSummaryRow extends RowDataPacket {
  total_records: number;
  total_contacted: number;
  not_contacted: number;
  shortlisted: number;
  recruiter_rejected: number;
  hr_selected: number;
  hr_rejected: number;
  ai_selected: number;
  ai_rejected: number;
  ops_selected: number;
  ops_rejected: number;
  final_selected: number;
  offer_letter_issued: number;
  joined: number;
  joining_pending: number;
  walkins: number;
  employee_referrals: number;
  active_recruiters: number;
  recruiter_inactive_count: number;
}

interface DashboardGroupRow extends RowDataPacket {
  label: string;
  total: number;
  contacted: number;
  selected: number;
  joined: number;
}

interface InterviewerRow extends RowDataPacket {
  id: string;
  employee_code: string | null;
  first_name: string | null;
  last_name: string | null;
  mobile: string | null;
  email: string | null;
  branch_name: string | null;
  dept_name: string | null;
  designation_name: string | null;
}

interface ImportBatchRow extends RowDataPacket {
  [key: string]: unknown;
}

type ActivityActorContext = {
  userId: string;
  activity_date: string;
  activity_month: string;
  recruiter_id: string;
  recruiter_employee_id: string | null;
  recruiter_code: string | null;
  recruiter_name_snapshot: string;
  branch_name: string;
  location_name: string;
};

const TRUE_VALUES = new Set(["yes", "y", "true", "1", "selected", "joined", "walkin", "contacted"]);
const FALSE_VALUES = new Set(["", "no", "n", "false", "0", "null", "undefined"]);

const DEFAULT_HIRING_OPTION_LISTS = {
  processOptions: [] as string[],
  sourceOptions: ["Walk-In", "Reference", "Job Portal", "Consultancy", "Employee Referral"],
  positionOptions: [] as string[],
  wpGroupOptions: [] as string[],
  callingOutcomeOptions: [
    "Interested - Will Visit",
    "Callback Requested",
    "Not Contacted (No Attempt)",
    "No Response (No Answer)",
    "Wrong Number / Invalid",
    "Not Interested (Candidate Declined)",
    "Shortlisted",
    "Selected",
    "Rejected (Recruiter Decision)",
  ],
  rejectionReasonOptions: [
    "Shift Issue",
    "Not Interested",
    "Location Issue",
    "Salary Expectation",
    "Already Placed",
    "Over-Qualified",
    "Under-Qualified",
    "Communication Issue",
    "Document Missing",
    "No Show",
    "Other",
  ],
  genderOptions: ["Male", "Female", "Other"],
  educationOptions: ["10th Pass", "12th Pass", "Graduate", "Post Graduate", "Diploma"],
  experienceOptions: ["Fresher", "0-1 Year", "1-2 Years", "2-3 Years", "3+ Years"],
};

const HEADER_ALIASES: Record<string, string[]> = {
  activity_date: ["Date"],
  recruiter_name_snapshot: ["HR Recruiter"],
  hiring_source: ["Hiring Source"],
  wp_group: ["WP Groups"],
  position_name: ["Position"],
  location_name: ["Location"],
  process_name: ["Process Name"],
  candidate_name: ["Candidate Name"],
  gender: ["Gender"],
  mobile: ["Mobile No."],
  education_qualification: ["Candidate Education Qualification"],
  recruiter_remarks: ["HR Recruiter Remarks"],
  recruiter_rejection_reason: ["HR Recruiter_Rejection Reasons", "HR Recruiter Rejection Reasons"],
  candidate_email: ["Candidate Email Address"],
  experience_level: ["Experience Level"],
  candidate_location: ["Candidate Location"],
  pi_hr_interviewer_date: ["PI_HR Interviewer_ Date", "PI HR Interviewer Date"],
  pi_hr_interviewer_name: ["PI_HR Interviewer", "PI HR Interviewer"],
  hr_interview_status: ["HR Interview Status"],
  hr_rejection_reason: ["HR Rejection Reason"],
  ai_assessment_score: ["AI Assessment Score"],
  ai_interview_result: ["AI Interview Result"],
  ops_interviewer_name: ["Ops Interviewer Name"],
  ops_interview_status: ["Ops Interview Status"],
  ops_rejection_reason: ["Ops Rejection Reason"],
  salary_package_inr: ["Salary Package in INR"],
  offer_letter_status: ["Offer Letter"],
  joining_status: ["Joining Status"],
  activity_month: ["Month"],
  batch_no: ["Batch No."],
  current_status: ["Current Status"],
  joined_candidate_emp_code: ["Joined Candidate's Emp Code", "Joined Candidate Emp Code", "Employee Code"],
  emp_referral_details: ["Emp Referral Details"],
  walkin_flag: ["Walkin"],
  final_selection_flag: ["FInal Selection", "Final Selection", "final_selection"],
  joined_flag: ["Joined"],
  contacted_flag: ["Contacted"],
};

function canonical(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function pick(row: HiringSheetRow, field: string): unknown {
  const aliases = [field, ...(HEADER_ALIASES[field] ?? [])];
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const needle = canonical(alias);
    const found = keys.find((key) => canonical(key) === needle);
    if (found !== undefined) return row[found];
  }
  return undefined;
}

export function parseBool(value: unknown): number {
  const normalized = text(value)?.toLowerCase() ?? "";
  if (TRUE_VALUES.has(normalized)) return 1;
  if (FALSE_VALUES.has(normalized)) return 0;
  return 0;
}

export function parseDecimal(value: unknown): number | null {
  const normalized = text(value);
  if (!normalized) return null;
  const stripped = normalized.replace(/[,₹\s]/g, "").replace(/[^0-9.-]/g, "");
  if (!stripped) return null;
  const parsed = Number(stripped);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeMobile(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(-10);
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

export function parseSheetDate(value: unknown): string | null {
  const toIsoDate = (year: number, month: number, day: number) =>
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toIsoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return toIsoDate(parsed.y, parsed.m, parsed.d);
    }
  }
  const raw = text(value);
  if (!raw) return null;
  const excelMatch = raw.match(/^\d+(\.\d+)?$/);
  if (excelMatch) {
    const parsed = XLSX.SSF.parse_date_code(Number(raw));
    if (parsed) {
      return toIsoDate(parsed.y, parsed.m, parsed.d);
    }
  }
  const dmyMatch = raw.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,9}|\d{1,2})[-/\s](\d{2,4})$/);
  if (dmyMatch) {
    const [, dayRaw, monthRaw, yearRaw] = dmyMatch;
    const day = Number(dayRaw);
    const monthText = monthRaw.toLowerCase();
    const monthByName: Record<string, number> = {
      jan: 1,
      january: 1,
      feb: 2,
      february: 2,
      mar: 3,
      march: 3,
      apr: 4,
      april: 4,
      may: 5,
      jun: 6,
      june: 6,
      jul: 7,
      july: 7,
      aug: 8,
      august: 8,
      sep: 9,
      sept: 9,
      september: 9,
      oct: 10,
      october: 10,
      nov: 11,
      november: 11,
      dec: 12,
      december: 12,
    };
    const month = monthByName[monthText] ?? Number(monthRaw);
    const numericYear = Number(yearRaw);
    const year = yearRaw.length === 2 ? 2000 + numericYear : numericYear;
    if (Number.isInteger(day) && Number.isInteger(month) && Number.isInteger(year) && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return toIsoDate(year, month, day);
    }
  }
  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return toIsoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) {
    return toIsoDate(direct.getFullYear(), direct.getMonth() + 1, direct.getDate());
  }
  const alt = raw.replace(/'/g, " ");
  const parsedAlt = new Date(alt);
  if (!Number.isNaN(parsedAlt.getTime())) {
    return toIsoDate(parsedAlt.getFullYear(), parsedAlt.getMonth() + 1, parsedAlt.getDate());
  }
  return null;
}

export function normalizeMonth(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, " ").trim();
  const monthMatch = compact.match(/^([A-Za-z]{3,9})['-]?(\d{2,4})$/);
  if (monthMatch) {
    return `${monthMatch[1].slice(0, 3)}-${monthMatch[2].slice(-2)}`;
  }
  const date = new Date(compact);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }).replace(/\s/g, "-");
  }
  return compact;
}

function getIstDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    yyyy: get("year"),
    mm: get("month"),
    dd: get("day"),
  };
}

function getCurrentIstDate() {
  const { yyyy, mm, dd } = getIstDateParts();
  return `${yyyy}-${mm}-${dd}`;
}

function getCurrentIstMonthLabel() {
  const date = new Date(`${getCurrentIstDate()}T00:00:00+05:30`);
  return date
    .toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "Asia/Kolkata" })
    .replace(/\s/g, "-");
}

function deriveContactedFlag(outcome: string | null) {
  const lowered = String(outcome ?? "").trim().toLowerCase();
  if (!lowered) return 0;
  if (
    lowered.includes("not contacted") ||
    lowered.includes("no response") ||
    lowered.includes("no answer") ||
    lowered.includes("switched off") ||
    lowered.includes("wrong number") ||
    lowered.includes("invalid") ||
    lowered.includes("busy")
  ) {
    return 0;
  }
  return 1;
}

function deriveCurrentStatus(outcome: string | null) {
  const lowered = String(outcome ?? "").trim().toLowerCase();
  if (!lowered) return null;
  if (lowered.includes("callback")) return "Callback Pending";
  if (
    lowered.includes("not contacted") ||
    lowered.includes("no response") ||
    lowered.includes("no answer") ||
    lowered.includes("wrong number") ||
    lowered.includes("invalid") ||
    lowered.includes("busy") ||
    lowered.includes("switched off")
  ) {
    return "Not Contacted";
  }
  if (lowered.includes("interested") || lowered.includes("visit") || lowered.includes("walk-in") || lowered.includes("walkin")) {
    return "Expected Walk-In";
  }
  if (lowered.includes("not interested")) return "Closed - Not Interested";
  return outcome;
}

async function getOptionList(configKey: string, fallback: string[]) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT config_value FROM ats_form_config WHERE config_key = ? LIMIT 1`,
    [configKey]
  );
  const raw = rows[0]?.config_value;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

async function getOptionLists(keys: string[], defaults: Record<string, string[]>): Promise<Record<string, string[]>> {
  if (!keys.length) return {};
  const placeholders = keys.map(() => "?").join(",");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT config_key, config_value FROM ats_form_config WHERE config_key IN (${placeholders})`,
    keys
  );
  const result: Record<string, string[]> = { ...Object.fromEntries(keys.map(k => [k, defaults[k] ?? []])) };
  for (const row of rows as any[]) {
    try {
      const parsed = typeof row.config_value === "string" ? JSON.parse(row.config_value) : row.config_value;
      if (Array.isArray(parsed)) result[row.config_key] = parsed.map(String);
    } catch { /* keep default */ }
  }
  return result;
}

async function buildActivityActorContext(actorUserId: string): Promise<ActivityActorContext> {
  const recruiterProfile = await resolveRecruiterForActor(actorUserId).catch((err: unknown) => {
    // Re-throw hard DB/connection errors; swallow only "not found" misses
    if (err && typeof err === "object" && ("fatal" in err || "code" in err)) {
      const e = err as { fatal?: boolean; code?: string };
      if (e.fatal || (e.code && e.code !== "ER_NO_ROWS_FOUND")) throw err;
    }
    return null;
  });
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        e.id AS employee_id,
        e.employee_code,
        COALESCE(NULLIF(e.full_name, ''), TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, '')))) AS employee_name,
        COALESCE(b.branch_name, b.branch_code, e.branch_id) AS branch_name
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
      WHERE e.user_id = ?
      LIMIT 1`,
    [actorUserId]
  );
  const employee = rows[0] ?? {};
  const branchName = text(recruiterProfile?.branch) ?? text(employee.branch_name) ?? "Unmapped";
  const recruiterName =
    text(recruiterProfile?.name) ??
    text(employee.employee_name) ??
    text(employee.employee_code) ??
    "Recruiter";

  return {
    userId: actorUserId,
    activity_date: getCurrentIstDate(),
    activity_month: getCurrentIstMonthLabel(),
    recruiter_id: actorUserId,
    recruiter_employee_id: text(recruiterProfile?.employeeId) ?? text(employee.employee_id),
    recruiter_code: text(recruiterProfile?.recruiterCode) ?? text(employee.employee_code),
    recruiter_name_snapshot: recruiterName,
    branch_name: branchName,
    location_name: branchName,
  };
}

function buildManualActivityPayload(payload: Record<string, unknown>, actor: ActivityActorContext) {
  const recruiterRemarks =
    text(payload.recruiter_remarks) ??
    text(payload.calling_outcome) ??
    text(payload.recruiterRemarks) ??
    null;

  const contactedFlag =
    payload.contacted_flag !== undefined ? parseBool(payload.contacted_flag) : deriveContactedFlag(recruiterRemarks);

  return {
    ...payload,
    activity_date: actor.activity_date,
    activity_month: actor.activity_month,
    recruiter_id: actor.recruiter_id,
    recruiter_employee_id: actor.recruiter_employee_id,
    recruiter_code: actor.recruiter_code,
    recruiter_name_snapshot: actor.recruiter_name_snapshot,
    branch_name: actor.branch_name,
    location_name: actor.location_name,
    recruiter_remarks: recruiterRemarks,
    current_status: text(payload.current_status) ?? deriveCurrentStatus(recruiterRemarks),
    contacted_flag: contactedFlag,
    walkin_flag: payload.walkin_flag !== undefined ? parseBool(payload.walkin_flag) : 0,
    final_selection_flag: payload.final_selection_flag !== undefined ? parseBool(payload.final_selection_flag) : 0,
    joined_flag: payload.joined_flag !== undefined ? parseBool(payload.joined_flag) : 0,
    source_system: text(payload.source_system) ?? "HRMS",
  };
}

function normalizeStatus(value: unknown): string | null {
  return text(value);
}

export function mapSheetRow(row: HiringSheetRow): { normalized: NormalizedHiringActivity | null; errors: string[] } {
  const activityDate = parseSheetDate(pick(row, "activity_date"));
  const recruiterName = text(pick(row, "recruiter_name_snapshot"));
  const hiringSource = text(pick(row, "hiring_source"));
  const positionName = text(pick(row, "position_name"));
  const locationName = text(pick(row, "location_name"));
  const processName = text(pick(row, "process_name"));
  const candidateName = text(pick(row, "candidate_name"));
  const mobile = normalizeMobile(pick(row, "mobile"));

  const errors: string[] = [];
  if (!activityDate) errors.push("Date is required");
  if (!recruiterName) errors.push("HR Recruiter is required");
  if (!hiringSource) errors.push("Hiring Source is required");
  if (!positionName) errors.push("Position is required");
  if (!locationName) errors.push("Location is required");
  if (!processName) errors.push("Process Name is required");
  if (!candidateName) errors.push("Candidate Name is required");
  if (!mobile) errors.push("Mobile No. is required");

  const recruiterRemarks = text(pick(row, "recruiter_remarks"));
  const recruiterRejectionReason = text(pick(row, "recruiter_rejection_reason"));
  const hrInterviewStatus = normalizeStatus(pick(row, "hr_interview_status"));
  const hrRejectionReason = text(pick(row, "hr_rejection_reason"));
  const opsInterviewStatus = normalizeStatus(pick(row, "ops_interview_status"));
  const opsRejectionReason = text(pick(row, "ops_rejection_reason"));
  const offerLetterStatus = normalizeStatus(pick(row, "offer_letter_status"));
  const joiningStatus = normalizeStatus(pick(row, "joining_status"));
  const currentStatus = text(pick(row, "current_status"));
  const empReferralDetails = text(pick(row, "emp_referral_details"));
  const joinedCode = text(pick(row, "joined_candidate_emp_code"));

  const finalSelectionFlag = parseBool(pick(row, "final_selection_flag"));
  const joinedFlag = parseBool(pick(row, "joined_flag"));
  const contactedFlagRaw = parseBool(pick(row, "contacted_flag"));
  const walkinFlag = parseBool(pick(row, "walkin_flag"));

  const contactedFlag = recruiterRemarks?.toLowerCase() === "not contacted" ? 0 : contactedFlagRaw;
  const joiningStatusAuto = joiningStatus?.toLowerCase() === "joined" ? "Joined" : joiningStatus;
  const currentStatusAuto = currentStatus || (finalSelectionFlag ? "Selected" : joiningStatusAuto || null);

  const isRejectedOutcome = (r: string | undefined) =>
    ["rejected", "rejected (recruiter decision)", "not interested", "not interested (candidate declined)"]
      .includes(r?.toLowerCase() ?? "");
  if (isRejectedOutcome(recruiterRemarks ?? undefined) && !recruiterRejectionReason) {
    errors.push("HR Recruiter_Rejection Reasons is mandatory when outcome is a rejection");
  }
  if (hrInterviewStatus?.toLowerCase() === "rejected" && !hrRejectionReason) {
    errors.push("HR Rejection Reason is mandatory when HR Interview Status = Rejected");
  }
  if (opsInterviewStatus?.toLowerCase() === "rejected" && !opsRejectionReason) {
    errors.push("Ops Rejection Reason is mandatory when Ops Interview Status = Rejected");
  }
  if (finalSelectionFlag && !(currentStatusAuto || "").toLowerCase().includes("select")) {
    errors.push("Current Status must indicate selected when FInal Selection = yes");
  }
  if ((joinedFlag || joiningStatusAuto?.toLowerCase() === "joined") && !joinedCode) {
    errors.push("Joined Candidate's Emp Code is mandatory when Joined = yes");
  }
  if ((hiringSource ?? "").toLowerCase() === "employee referral" && !empReferralDetails) {
    errors.push("Emp Referral Details is mandatory when Hiring Source = Employee Referral");
  }
  if (offerLetterStatus && /issued|sent|offer/i.test(offerLetterStatus) && !parseDecimal(pick(row, "salary_package_inr"))) {
    errors.push("Salary Package in INR is mandatory when Offer Letter is issued or sent");
  }

  const normalized: NormalizedHiringActivity = {
    activity_date: activityDate!,
    activity_month: normalizeMonth(pick(row, "activity_month")) ?? null,
    recruiter_id: text(pick(row, "recruiter_id")) ?? null,
    recruiter_employee_id: text(pick(row, "recruiter_employee_id")) ?? null,
    recruiter_code: text(pick(row, "recruiter_code")) ?? null,
    recruiter_name_snapshot: recruiterName!,
    hiring_source: hiringSource!,
    wp_group: text(pick(row, "wp_group")),
    position_name: positionName!,
    location_name: locationName!,
    branch_name: text(pick(row, "branch_name")) || locationName!,
    process_name: processName!,
    candidate_name: candidateName!,
    gender: text(pick(row, "gender")),
    mobile: mobile!,
    candidate_email: text(pick(row, "candidate_email")),
    education_qualification: text(pick(row, "education_qualification")),
    experience_level: text(pick(row, "experience_level")),
    candidate_location: text(pick(row, "candidate_location")),
    recruiter_remarks: recruiterRemarks,
    recruiter_rejection_reason: recruiterRejectionReason,
    pi_hr_interviewer_date: parseSheetDate(pick(row, "pi_hr_interviewer_date")),
    pi_hr_interviewer_name: text(pick(row, "pi_hr_interviewer_name")),
    hr_interview_status: hrInterviewStatus,
    hr_rejection_reason: hrRejectionReason,
    ai_assessment_score: parseDecimal(pick(row, "ai_assessment_score")),
    ai_interview_result: normalizeStatus(pick(row, "ai_interview_result")),
    ops_interviewer_employee_id: text(pick(row, "ops_interviewer_employee_id")),
    ops_interviewer_name: text(pick(row, "ops_interviewer_name")),
    ops_interviewer_branch_snapshot: text(pick(row, "ops_interviewer_branch_snapshot")) || text(pick(row, "branch_name")) || locationName!,
    ops_interview_status: opsInterviewStatus,
    ops_rejection_reason: opsRejectionReason,
    salary_package_inr: parseDecimal(pick(row, "salary_package_inr")),
    offer_letter_status: offerLetterStatus,
    joining_status: joiningStatusAuto,
    batch_no: text(pick(row, "batch_no")),
    current_status: currentStatusAuto,
    joined_candidate_emp_code: joinedCode,
    emp_referral_details: empReferralDetails,
    referee_employee_id: text(pick(row, "referee_employee_id")),
    referee_employee_code: text(pick(row, "referee_employee_code")),
    referee_name: text(pick(row, "referee_name")),
    referee_branch: text(pick(row, "referee_branch")),
    referee_process: text(pick(row, "referee_process")),
    referral_relationship: text(pick(row, "referral_relationship")),
    referral_remarks: text(pick(row, "referral_remarks")),
    referral_validation_status: text(pick(row, "referral_validation_status")),
    followup_required: parseBool(pick(row, "followup_required")),
    walkin_flag: walkinFlag,
    final_selection_flag: finalSelectionFlag,
    joined_flag: joinedFlag || (joiningStatusAuto?.toLowerCase() === "joined" ? 1 : 0),
    contacted_flag: contactedFlag,
    linked_candidate_id: text(pick(row, "linked_candidate_id")),
    queue_token_id: text(pick(row, "queue_token_id")),
    onboarding_bridge_id: text(pick(row, "onboarding_bridge_id")),
    employee_id: text(pick(row, "employee_id")),
    duplicate_warning: parseBool(pick(row, "duplicate_warning")),
    duplicate_of_activity_id: text(pick(row, "duplicate_of_activity_id")),
    duplicate_override_reason: text(pick(row, "duplicate_override_reason")),
    import_batch_id: text(pick(row, "import_batch_id")),
    source_system: text(pick(row, "source_system")) || "HRMS",
    raw_sheet_payload: row,
    created_by: text(pick(row, "created_by")),
    updated_by: text(pick(row, "updated_by")),
  };

  return { normalized, errors };
}

export function parseRecruiterSheet(buffer: Buffer, fileName: string): HiringSheetRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.SheetNames[0];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<HiringSheetRow>(workbook.Sheets[sheet], { defval: "", raw: true });
  return rows.map((row) => ({ ...row, __file_name: fileName }));
}

async function getCurrentUserBranch(userId: string): Promise<string | null> {
  const [rows] = await db.execute<BranchNameRow[]>(
    `SELECT COALESCE(b.branch_name, b.branch_code, e.branch_id) AS branch_name
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
      WHERE e.user_id = ?
      LIMIT 1`,
    [userId]
  );
  return text(rows[0]?.branch_name);
}

export async function getHiringActivityBootstrap(userId: string): Promise<HiringActivityBootstrap> {
  const [actor, opts] = await Promise.all([
    buildActivityActorContext(userId),
    getOptionLists(
      ["hiringProcessOptions","hiringSourceOptions","hiringPositionOptions","hiringWpGroupOptions",
       "hiringCallingOutcomeOptions","genderOptions","educationOptions","experienceOptions"],
      {
        hiringProcessOptions:       DEFAULT_HIRING_OPTION_LISTS.processOptions,
        hiringSourceOptions:        DEFAULT_HIRING_OPTION_LISTS.sourceOptions,
        hiringPositionOptions:      DEFAULT_HIRING_OPTION_LISTS.positionOptions,
        hiringWpGroupOptions:       DEFAULT_HIRING_OPTION_LISTS.wpGroupOptions,
        hiringCallingOutcomeOptions:DEFAULT_HIRING_OPTION_LISTS.callingOutcomeOptions,
        genderOptions:              DEFAULT_HIRING_OPTION_LISTS.genderOptions,
        educationOptions:           DEFAULT_HIRING_OPTION_LISTS.educationOptions,
        experienceOptions:          DEFAULT_HIRING_OPTION_LISTS.experienceOptions,
      }
    ),
  ]);
  const { hiringProcessOptions: processOptions, hiringSourceOptions: sourceOptions,
    hiringPositionOptions: positionOptions, hiringWpGroupOptions: wpGroupOptions,
    hiringCallingOutcomeOptions: callingOutcomeOptions, genderOptions,
    educationOptions, experienceOptions } = opts;

  return {
    actor: {
      userId,
      recruiterName: actor.recruiter_name_snapshot,
      recruiterEmployeeId: actor.recruiter_employee_id,
      recruiterCode: actor.recruiter_code,
      branchName: actor.branch_name,
      activityDate: actor.activity_date,
      activityMonth: actor.activity_month,
    },
    options: {
      processOptions,
      sourceOptions,
      positionOptions,
      wpGroupOptions,
      callingOutcomeOptions,
      rejectionReasonOptions: DEFAULT_HIRING_OPTION_LISTS.rejectionReasonOptions,
      genderOptions,
      educationOptions,
      experienceOptions,
    },
  };
}

function buildFilterSql(filters: HiringFilters, scopedOnly: boolean) {
  const clauses: string[] = ["1=1"];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    if (value === undefined || value === null || value === "") return;
    clauses.push(sql);
    params.push(value);
  };

  add("activity_date >= ?", filters.fromDate);
  add("activity_date <= ?", filters.toDate);
  add("activity_month = ?", filters.month);
  add("recruiter_name_snapshot = ?", filters.recruiter);
  add("hiring_source = ?", filters.hiringSource);
  add("wp_group = ?", filters.wpGroup);
  add("position_name = ?", filters.position);
  add("location_name = ?", filters.location);
  add("branch_name = ?", filters.branch);
  add("process_name = ?", filters.process);
  add("gender = ?", filters.gender);
  add("education_qualification = ?", filters.education);
  add("experience_level = ?", filters.experienceLevel);
  add("recruiter_remarks = ?", filters.recruiterRemarks);
  add("hr_interview_status = ?", filters.hrInterviewStatus);
  add("ai_interview_result = ?", filters.aiInterviewResult);
  add("ops_interview_status = ?", filters.opsInterviewStatus);
  add("offer_letter_status = ?", filters.offerLetterStatus);
  add("joining_status = ?", filters.joiningStatus);
  add("batch_no = ?", filters.batchNo);
  add("current_status = ?", filters.currentStatus);
  add("walkin_flag = ?", filters.walkin !== undefined ? parseBool(filters.walkin) : undefined);
  add("final_selection_flag = ?", filters.finalSelection !== undefined ? parseBool(filters.finalSelection) : undefined);
  add("joined_flag = ?", filters.joined !== undefined ? parseBool(filters.joined) : undefined);
  add("contacted_flag = ?", filters.contacted !== undefined ? parseBool(filters.contacted) : undefined);

  if (filters.search) {
    clauses.push(`(
      candidate_name LIKE ? OR
      mobile LIKE ? OR
      recruiter_name_snapshot LIKE ? OR
      process_name LIKE ? OR
      current_status LIKE ?
    )`);
    const q = `%${filters.search}%`;
    params.push(q, q, q, q, q);
  }

  if (scopedOnly) {
    clauses.push("(branch_name = ? OR created_by = ? OR recruiter_id = ?)");
  }

  return { sql: clauses.join(" AND "), params };
}

export async function listHiringActivity(userId: string, role: string | undefined, filters: HiringFilters) {
  const scopedOnly = !["admin", "hr", "super_admin"].includes(role ?? "");
  const { sql, params } = buildFilterSql(filters, scopedOnly);
  if (scopedOnly) {
    const branch = await getActorBranch(userId);
    params.push(branch ?? "", userId, userId);
  }

  const page = Math.max(1, Math.trunc(Number(filters.page) || 1));
  const limit = Math.min(Math.max(1, Math.trunc(Number(filters.limit) || 50)), 100);
  const offset = (page - 1) * limit;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT arha.*,
            ac.profile_status   AS linked_profile_status,
            ac.final_decision   AS linked_final_decision,
            ac.status           AS linked_candidate_status,
            qt.queue_status     AS token_queue_status
       FROM ats_recruiter_hiring_activity arha
       LEFT JOIN ats_candidate ac ON ac.id = arha.linked_candidate_id
       LEFT JOIN ats_queue_token qt ON qt.id = arha.queue_token_id
      WHERE ${sql}
      ORDER BY arha.activity_date DESC, arha.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const [count] = await db.execute<CountRow[]>(
    `SELECT COUNT(*) AS total
       FROM ats_recruiter_hiring_activity
      WHERE ${sql}`,
    params
  );

  return {
    data: rows,
    total: Number(count[0]?.total ?? 0),
    page,
    limit,
  };
}

async function findDuplicate(normalized: NormalizedHiringActivity): Promise<{ id: string } | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id
       FROM ats_recruiter_hiring_activity
      WHERE mobile = ?
        AND (
          (process_name = ? AND activity_date = ?) OR
          (recruiter_name_snapshot = ? AND activity_month = ?) OR
          (candidate_name = ? AND process_name = ?)
        )
      ORDER BY created_at DESC
      LIMIT 1`,
    [
      normalized.mobile,
      normalized.process_name,
      normalized.activity_date,
      normalized.recruiter_name_snapshot,
      normalized.activity_month,
      normalized.candidate_name,
      normalized.process_name,
    ]
  );
  return rows[0]?.id ? { id: String(rows[0].id) } : null;
}

async function persistActivity(
  normalized: NormalizedHiringActivity,
  actorUserId: string,
  duplicateMode: DuplicateMode,
  existingId?: string | null
) {
  const duplicate = existingId ? { id: existingId } : await findDuplicate(normalized);
  const insertId = randomUUID();

  if (duplicate && duplicateMode === "skip_duplicates") {
    return { action: "skipped" as const, id: duplicate.id, duplicateOf: duplicate.id };
  }

  if (duplicate && duplicateMode === "update_existing") {
    // Insert as a follow-up call instead of overwriting — preserves history
    normalized.followup_required = 1;
    (normalized as any).is_followup_attempt = 1;
    (normalized as any).followup_of_activity_id = duplicate.id;
  }

  const insertValues = [
    insertId,
    normalized.activity_date,
    normalized.activity_month,
    normalized.recruiter_id,
    normalized.recruiter_employee_id,
    normalized.recruiter_code,
    normalized.recruiter_name_snapshot,
    normalized.hiring_source,
    normalized.wp_group,
    normalized.position_name,
    normalized.location_name,
    normalized.branch_name,
    normalized.process_name,
    normalized.candidate_name,
    normalized.gender,
    normalized.mobile,
    normalized.candidate_email,
    normalized.education_qualification,
    normalized.experience_level,
    normalized.candidate_location,
    normalized.recruiter_remarks,
    normalized.recruiter_rejection_reason,
    normalized.pi_hr_interviewer_date,
    normalized.pi_hr_interviewer_name,
    normalized.hr_interview_status,
    normalized.hr_rejection_reason,
    normalized.ai_assessment_score,
    normalized.ai_interview_result,
    normalized.ops_interviewer_employee_id,
    normalized.ops_interviewer_name,
    normalized.ops_interviewer_branch_snapshot,
    normalized.ops_interview_status,
    normalized.ops_rejection_reason,
    normalized.salary_package_inr,
    normalized.offer_letter_status,
    normalized.joining_status,
    normalized.batch_no,
    normalized.current_status,
    normalized.joined_candidate_emp_code,
    normalized.emp_referral_details,
    normalized.referee_employee_id,
    normalized.referee_employee_code,
    normalized.referee_name,
    normalized.referee_branch,
    normalized.referee_process,
    normalized.referral_relationship,
    normalized.referral_remarks,
    normalized.referral_validation_status,
    normalized.followup_required,
    normalized.walkin_flag,
    normalized.final_selection_flag,
    normalized.joined_flag,
    normalized.contacted_flag,
    normalized.linked_candidate_id,
    normalized.queue_token_id,
    normalized.onboarding_bridge_id,
    normalized.employee_id,
    duplicate ? 1 : normalized.duplicate_warning,
    duplicate?.id ?? normalized.duplicate_of_activity_id,
    normalized.duplicate_override_reason,
    normalized.import_batch_id,
    normalized.source_system,
    JSON.stringify(normalized.raw_sheet_payload ?? {}),
    (normalized as any).is_followup_attempt ?? 0,
    (normalized as any).followup_of_activity_id ?? null,
    actorUserId,
    actorUserId,
  ];

  await db.execute(
    `INSERT INTO ats_recruiter_hiring_activity
      (id, activity_date, activity_month, recruiter_id, recruiter_employee_id, recruiter_code, recruiter_name_snapshot,
       hiring_source, wp_group, position_name, location_name, branch_name, process_name, candidate_name, gender, mobile,
       candidate_email, education_qualification, experience_level, candidate_location, recruiter_remarks,
       recruiter_rejection_reason, pi_hr_interviewer_date, pi_hr_interviewer_name, hr_interview_status,
       hr_rejection_reason, ai_assessment_score, ai_interview_result, ops_interviewer_employee_id, ops_interviewer_name,
       ops_interviewer_branch_snapshot, ops_interview_status, ops_rejection_reason, salary_package_inr,
       offer_letter_status, joining_status, batch_no, current_status, joined_candidate_emp_code, emp_referral_details,
       referee_employee_id, referee_employee_code, referee_name, referee_branch, referee_process, referral_relationship,
       referral_remarks, referral_validation_status, followup_required, walkin_flag, final_selection_flag, joined_flag, contacted_flag,
       linked_candidate_id, queue_token_id, onboarding_bridge_id, employee_id, duplicate_warning, duplicate_of_activity_id,
       duplicate_override_reason, import_batch_id, source_system, raw_sheet_payload,
       is_followup_attempt, followup_of_activity_id, created_by, updated_by)
     VALUES (${insertValues.map(() => "?").join(", ")})`,
    insertValues
  );

  const action = (normalized as any).is_followup_attempt ? "followup" as const : "inserted" as const;
  return { action, id: insertId, duplicateOf: duplicate?.id ?? null };
}

export async function upsertHiringActivity(
  payload: Record<string, unknown>,
  actorUserId: string,
  duplicateMode: DuplicateMode = "insert_duplicates_with_warning"
) {
  const actor = await buildActivityActorContext(actorUserId);
  const { normalized, errors } = mapSheetRow(buildManualActivityPayload(payload, actor));
  if (!normalized) {
    throw Object.assign(new Error(errors.join("; ")), { statusCode: 400, validationErrors: errors });
  }
  if (errors.length) {
    throw Object.assign(new Error(errors.join("; ")), { statusCode: 400, validationErrors: errors });
  }

  const persisted = await persistActivity(normalized, actorUserId, duplicateMode);
  const rowId = persisted.id;
  const [rows] = await db.execute<HiringActivityRow[]>(
    `SELECT * FROM ats_recruiter_hiring_activity WHERE id = ? LIMIT 1`,
    [rowId]
  );
  return { ...persisted, row: rows[0] ?? null };
}

export async function updateHiringActivityById(
  activityId: string,
  payload: Record<string, unknown>,
  actorUserId: string
) {
  const [rows] = await db.execute<HiringActivityRow[]>(
    `SELECT * FROM ats_recruiter_hiring_activity WHERE id = ? LIMIT 1`,
    [activityId]
  );
  if (!rows.length) {
    throw Object.assign(new Error("Hiring activity not found"), { statusCode: 404 });
  }

  const actor = await buildActivityActorContext(actorUserId);
  const { normalized, errors } = mapSheetRow(buildManualActivityPayload({ ...rows[0], ...payload }, actor));
  if (!normalized || errors.length) {
    throw Object.assign(new Error(errors.join("; ") || "Invalid hiring activity row"), { statusCode: 400, validationErrors: errors });
  }

  const sets = Object.keys(normalized)
    .filter((key) => key !== "raw_sheet_payload")
    .map((key) => `${key} = ?`);
  const params = Object.keys(normalized)
    .filter((key) => key !== "raw_sheet_payload")
    .map((key) => normalized[key as keyof NormalizedHiringActivity]);
  params.push(actorUserId, activityId);
  await db.execute(
    `UPDATE ats_recruiter_hiring_activity SET ${sets.join(", ")}, updated_by = ?, updated_at = NOW() WHERE id = ?`,
    params
  );

  const [updated] = await db.execute<HiringActivityRow[]>(
    `SELECT * FROM ats_recruiter_hiring_activity WHERE id = ? LIMIT 1`,
    [activityId]
  );
  return { id: activityId, row: updated[0] ?? null };
}

export async function importHiringActivityRows(
  rows: HiringSheetRow[],
  actorUserId: string,
  fileName: string,
  duplicateMode: DuplicateMode = "insert_duplicates_with_warning"
): Promise<ImportResult> {
  const batchId = randomUUID();
  await db.execute(
    `INSERT INTO ats_recruiter_hiring_import_batch
      (id, file_name, uploaded_by, total_rows, inserted_rows, updated_rows, duplicate_rows, failed_rows, status, error_summary)
     VALUES (?, ?, ?, 0, 0, 0, 0, 0, 'processing', NULL)`,
    [batchId, fileName, actorUserId]
  );

  let insertedRows = 0;
  let updatedRows = 0;
  let duplicateRows = 0;
  let failedRows = 0;
  const errors: ImportResult["errors"] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const rowNumber = index + 2;
    const row = rows[index];
    try {
      const { normalized, errors: rowErrors } = mapSheetRow(row);
      if (!normalized || rowErrors.length) {
        failedRows += 1;
        const message = rowErrors.join("; ") || "Invalid row";
        errors.push({ row_number: rowNumber, column_name: null, error_message: message });
        await db.execute(
          `INSERT INTO ats_recruiter_hiring_import_error
            (id, import_batch_id, \`row_number\`, column_name, error_message, raw_row)
           VALUES (UUID(), ?, ?, ?, ?, ?)`,
          [batchId, rowNumber, null, message, JSON.stringify(row)]
        );
        continue;
      }

      normalized.import_batch_id = batchId;
      normalized.raw_sheet_payload = row;
      const persisted = await persistActivity(normalized, actorUserId, duplicateMode);
      if (persisted.action === "inserted") insertedRows += 1;
      if (persisted.action === "followup") { insertedRows += 1; duplicateRows += 1; }
      if (persisted.duplicateOf) duplicateRows += 1;
    } catch (err: unknown) {
      failedRows += 1;
      const message = err instanceof Error ? err.message : "Row import failed";
      errors.push({ row_number: rowNumber, column_name: null, error_message: message });
      await db.execute(
        `INSERT INTO ats_recruiter_hiring_import_error
          (id, import_batch_id, \`row_number\`, column_name, error_message, raw_row)
         VALUES (UUID(), ?, ?, ?, ?, ?)`,
        [batchId, rowNumber, null, message, JSON.stringify(row)]
      );
    }
  }

  await db.execute(
    `UPDATE ats_recruiter_hiring_import_batch
        SET total_rows = ?,
            inserted_rows = ?,
            updated_rows = ?,
            duplicate_rows = ?,
            failed_rows = ?,
            status = ?,
            error_summary = ?
      WHERE id = ?`,
    [
      rows.length,
      insertedRows,
      updatedRows,
      duplicateRows,
      failedRows,
      failedRows > 0 ? "completed_with_errors" : "completed",
      errors.length ? JSON.stringify(errors.slice(0, 10)) : null,
      batchId,
    ]
  );

  return {
    batchId,
    fileName,
    totalRows: rows.length,
    insertedRows,
    updatedRows,
    duplicateRows,
    failedRows,
    errors,
  };
}

async function resolveCandidateByActivity(activity: NormalizedHiringActivity): Promise<CandidateBridgeRecord | null> {
  const mobile = activity.mobile;
  const name = activity.candidate_name;
  const email = activity.candidate_email;
  const empCode = activity.joined_candidate_emp_code;

  const SAFE_COLS = `id, candidate_code, employee_code, full_name, mobile, email,
    designation, department, branch_id, process_id, applied_for_branch, applied_for_process,
    role_applied, branch_text, status, stage, recruiter_id, current_employer,
    current_ctc, expected_ctc, notice_period, experience_years, education,
    aadhar_number_masked, pan_number_masked, bank_account_no_masked,
    aadhar_number_hash, pan_number_hash, bank_account_no_hash,
    is_minor, guardian_consent_obtained, created_at, updated_at`;
  const queries: Array<[string, unknown[]]> = [
    [`SELECT ${SAFE_COLS} FROM ats_candidate WHERE mobile = ? ORDER BY created_at DESC LIMIT 1`, [mobile]],
    [`SELECT ${SAFE_COLS} FROM ats_candidate WHERE full_name = ? AND mobile = ? ORDER BY created_at DESC LIMIT 1`, [name, mobile]],
    [`SELECT ${SAFE_COLS} FROM ats_candidate WHERE email = ? ORDER BY created_at DESC LIMIT 1`, [email]],
    [`SELECT ${SAFE_COLS} FROM ats_candidate WHERE employee_code = ? ORDER BY created_at DESC LIMIT 1`, [empCode]],
    [`SELECT ${SAFE_COLS} FROM ats_candidate WHERE candidate_code = ? ORDER BY created_at DESC LIMIT 1`, [empCode]],
  ];

  for (const [sql, params] of queries) {
    if (params[0] === null || params[0] === undefined || params[0] === "") continue;
    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    const candidate = rows[0];
    if (candidate?.id) return candidate as CandidateBridgeRecord;
  }
  return null;
}

async function syncActivityCandidateLink(activityId: string, candidateId: string | null, queueTokenId: string | null) {
  await db.execute(
    `UPDATE ats_recruiter_hiring_activity
        SET linked_candidate_id = COALESCE(?, linked_candidate_id),
            queue_token_id = COALESCE(?, queue_token_id),
            updated_at = NOW()
      WHERE id = ?`,
    [candidateId, queueTokenId, activityId]
  );
}

export async function syncHiringActivityFromCandidateRegistration(params: {
  mobile: string;
  candidateId: string;
  queueTokenId?: string | null;
  branchName?: string | null;
  processName?: string | null;
  activityDate?: string | null;
}) {
  const activityDate = params.activityDate ?? getCurrentIstDate();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id
       FROM ats_recruiter_hiring_activity
      WHERE mobile = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        AND (linked_candidate_id IS NULL OR linked_candidate_id = ?)
      ORDER BY
        CASE WHEN activity_date = ? THEN 0 ELSE 1 END,
        CASE WHEN ? IS NOT NULL AND branch_name = ? THEN 0 ELSE 1 END,
        CASE WHEN ? IS NOT NULL AND process_name = ? THEN 0 ELSE 1 END,
        created_at DESC
      LIMIT 1`,
    [
      params.mobile,
      params.candidateId,
      activityDate,
      params.branchName ?? null,
      params.branchName ?? null,
      params.processName ?? null,
      params.processName ?? null,
    ]
  );

  const activityId = text(rows[0]?.id);
  if (!activityId) return null;

  await db.execute(
    `UPDATE ats_recruiter_hiring_activity
        SET linked_candidate_id = ?,
            queue_token_id = COALESCE(?, queue_token_id),
            walkin_flag = 1,
            contacted_flag = 1,
            current_status = 'Arrived',
            branch_name = COALESCE(NULLIF(branch_name, ''), ?),
            location_name = COALESCE(NULLIF(location_name, ''), ?),
            process_name = COALESCE(NULLIF(process_name, ''), ?),
            updated_at = NOW()
      WHERE id = ?`,
    [
      params.candidateId,
      params.queueTokenId ?? null,
      params.branchName ?? null,
      params.branchName ?? null,
      params.processName ?? null,
      activityId,
    ]
  );

  return activityId;
}

export async function createCandidateFromActivity(activityId: string, actorUserId: string) {
  const [rows] = await db.execute<HiringActivityRow[]>(
    `SELECT * FROM ats_recruiter_hiring_activity WHERE id = ? LIMIT 1`,
    [activityId]
  );
  const activity = rows[0];
  if (!activity) throw Object.assign(new Error("Hiring activity not found"), { statusCode: 404 });

  const normalized = mapSheetRow(activity).normalized;
  if (!normalized) throw Object.assign(new Error("Invalid hiring activity row"), { statusCode: 400 });

  const existing = await resolveCandidateByActivity(normalized);
  if (existing) {
    await syncActivityCandidateLink(activityId, existing.id, null);
    return { created: false, candidate: existing };
  }

  const candidate = await atsService.createCandidate(
    {
      fullName: normalized.candidate_name,
      mobile: normalized.mobile,
      email: normalized.candidate_email,
      gender: normalized.gender ?? null,
      education: normalized.education_qualification ?? "Not Provided",
      experience: normalized.experience_level ?? "Not Provided",
      appliedForProcess: normalized.process_name,
      appliedForBranch: normalized.branch_name ?? normalized.location_name,
      appliedForRole: normalized.position_name,
      sourcingChannel: normalized.hiring_source,
      referredBy: normalized.emp_referral_details,
      walkInDate: normalized.activity_date,
      remarks: normalized.recruiter_remarks,
      recruiterName: normalized.recruiter_name_snapshot,
      profileStatus: "registered",
    },
    actorUserId
  );

  await syncActivityCandidateLink(activityId, candidate.id, null);
  return { created: true, candidate };
}

function tokenNumberFor(branchName: string, date: string, count: number) {
  const prefix = (branchName || "GEN").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "GEN";
  const compactDate = date.replace(/-/g, "");
  return `${prefix}-${compactDate}-${String(count).padStart(3, "0")}`;
}

async function ensureHumanTokenNumber(candidateId: string, branchName: string, arrivalDate: string) {
  const [rows] = await db.execute<CountRow[]>(
    `SELECT COUNT(*) AS total
       FROM ats_queue_token
      WHERE branch_name = ?
        AND DATE(created_at) = ?`,
    [branchName, arrivalDate]
  );
  const next = Number(rows[0]?.total ?? 0) + 1;
  return tokenNumberFor(branchName, arrivalDate, next);
}

export async function createTokenFromActivity(activityId: string, actorUserId: string) {
  const [rows] = await db.execute<HiringActivityRow[]>(
    `SELECT * FROM ats_recruiter_hiring_activity WHERE id = ? LIMIT 1`,
    [activityId]
  );
  const activity = rows[0];
  if (!activity) throw Object.assign(new Error("Hiring activity not found"), { statusCode: 404 });

  const normalized = mapSheetRow(activity).normalized;
  if (!normalized) throw Object.assign(new Error("Invalid hiring activity row"), { statusCode: 400 });

  let candidate: { id: string } | null = await resolveCandidateByActivity(normalized);
  if (!candidate) {
    const created = await createCandidateFromActivity(activityId, actorUserId);
    candidate = created.candidate;
  }

  const token = await atsQueueService.createToken(candidate.id, `${normalized.activity_date} 09:00:00`);
  const tokenNumber = await ensureHumanTokenNumber(candidate.id, normalized.branch_name ?? normalized.location_name, normalized.activity_date);
  await db.execute(
    `UPDATE ats_queue_token SET token_number = ?, updated_at = NOW() WHERE id = ?`,
    [tokenNumber, token.id]
  );
  await db.execute(
    `UPDATE ats_candidate
        SET q_token = ?, status = 'Waiting', created_date = COALESCE(created_date, ?), created_time = COALESCE(created_time, TIME(?)),
            updated_at = NOW()
      WHERE id = ?`,
    [tokenNumber, normalized.activity_date, `${normalized.activity_date} 09:00:00`, candidate.id]
  );
  await syncActivityCandidateLink(activityId, candidate.id, token.id);

  return { candidate, token: { ...token, token_number: tokenNumber } };
}

export async function sendOnboardingFromActivity(activityId: string, actorUserId: string) {
  const [rows] = await db.execute<HiringActivityRow[]>(
    `SELECT * FROM ats_recruiter_hiring_activity WHERE id = ? LIMIT 1`,
    [activityId]
  );
  const activity = rows[0];
  if (!activity) throw Object.assign(new Error("Hiring activity not found"), { statusCode: 404 });

  const normalized = mapSheetRow(activity).normalized;
  if (!normalized) throw Object.assign(new Error("Invalid hiring activity row"), { statusCode: 400 });

  if (!normalized.final_selection_flag && !(normalized.current_status ?? "").toLowerCase().includes("select")) {
    throw Object.assign(new Error("Candidate must be selected before onboarding"), { statusCode: 400 });
  }

  let candidate: { id: string } | null = await resolveCandidateByActivity(normalized);
  if (!candidate) {
    const created = await createCandidateFromActivity(activityId, actorUserId);
    candidate = created.candidate;
  }

  const result = await sendOnboardingToken(candidate.id, actorUserId);
  return { candidate, ...result };
}

async function getActorBranch(userId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(e.branch_display_name,''), bm.branch_name) AS branch_name
       FROM employees e
       LEFT JOIN branch_master bm ON bm.id = e.branch_id
      WHERE e.user_id = ?
      LIMIT 1`,
    [userId]
  );
  return (rows[0]?.branch_name as string | null) ?? null;
}

async function applyActivityFilters(filters: HiringFilters, scopedOnly: boolean, userId?: string) {
  const { sql, params } = buildFilterSql(filters, scopedOnly);
  if (scopedOnly && userId) {
    const branch = await getActorBranch(userId);
    params.push(branch ?? "", userId, userId);
  }
  return { sql, params };
}

async function aggregateBy(column: string, filters: HiringFilters, scopedOnly: boolean, userId?: string) {
  const { sql, params } = await applyActivityFilters(filters, scopedOnly, userId);
  const [rows] = await db.execute<DashboardGroupRow[]>(
    `SELECT COALESCE(${column}, 'Unmapped') AS label,
            COUNT(*) AS total,
            SUM(CASE WHEN contacted_flag = 1 THEN 1 ELSE 0 END) AS contacted,
            SUM(CASE WHEN final_selection_flag = 1 THEN 1 ELSE 0 END) AS selected,
            SUM(CASE WHEN joined_flag = 1 THEN 1 ELSE 0 END) AS joined
       FROM ats_recruiter_hiring_activity
      WHERE ${sql}
      GROUP BY COALESCE(${column}, 'Unmapped')
      ORDER BY total DESC
      LIMIT 50`,
    params
  );
  return rows;
}

export async function getHiringDashboard(userId: string, role: string | undefined, filters: HiringFilters): Promise<HiringDashboard> {
  const scopedOnly = !["admin", "hr", "super_admin"].includes(role ?? "");
  const { sql, params } = await applyActivityFilters(filters, scopedOnly, userId);
  const [summary] = await db.execute<DashboardSummaryRow[]>(
    `SELECT
        COUNT(*) AS total_records,
        SUM(CASE WHEN contacted_flag = 1 THEN 1 ELSE 0 END) AS total_contacted,
        SUM(CASE WHEN contacted_flag = 0 THEN 1 ELSE 0 END) AS not_contacted,
        SUM(CASE WHEN LOWER(recruiter_remarks) = 'shortlisted' THEN 1 ELSE 0 END) AS shortlisted,
        SUM(CASE WHEN LOWER(recruiter_remarks) = 'rejected' THEN 1 ELSE 0 END) AS recruiter_rejected,
        SUM(CASE WHEN hr_interview_status = 'Selected' THEN 1 ELSE 0 END) AS hr_selected,
        SUM(CASE WHEN hr_interview_status = 'Rejected' THEN 1 ELSE 0 END) AS hr_rejected,
        SUM(CASE WHEN ai_interview_result IN ('Selected','Pass') THEN 1 ELSE 0 END) AS ai_selected,
        SUM(CASE WHEN ai_interview_result IN ('Rejected','Fail') THEN 1 ELSE 0 END) AS ai_rejected,
        SUM(CASE WHEN ops_interview_status = 'Selected' THEN 1 ELSE 0 END) AS ops_selected,
        SUM(CASE WHEN ops_interview_status = 'Rejected' THEN 1 ELSE 0 END) AS ops_rejected,
        SUM(CASE WHEN final_selection_flag = 1 THEN 1 ELSE 0 END) AS final_selected,
        SUM(CASE WHEN offer_letter_status IN ('Issued','Sent','Offer Issued','Offer Sent') THEN 1 ELSE 0 END) AS offer_letter_issued,
        SUM(CASE WHEN joined_flag = 1 THEN 1 ELSE 0 END) AS joined,
        SUM(CASE WHEN joining_status IN ('Pending','Joining Pending','Offer Accepted') THEN 1 ELSE 0 END) AS joining_pending,
        SUM(CASE WHEN walkin_flag = 1 THEN 1 ELSE 0 END) AS walkins,
        SUM(CASE WHEN hiring_source = 'Employee Referral' THEN 1 ELSE 0 END) AS employee_referrals,
        COUNT(DISTINCT recruiter_name_snapshot) AS active_recruiters,
        COUNT(DISTINCT CASE WHEN updated_at < DATE_SUB(NOW(), INTERVAL 2 DAY) THEN recruiter_name_snapshot END) AS recruiter_inactive_count
      FROM ats_recruiter_hiring_activity
      WHERE COALESCE(is_followup_attempt, 0) = 0 AND ${sql}`,
    params
  );

  const metrics = {
    total_records: Number(summary[0]?.total_records ?? 0),
    total_contacted: Number(summary[0]?.total_contacted ?? 0),
    contacted_pct: 0,
    not_contacted: Number(summary[0]?.not_contacted ?? 0),
    shortlisted: Number(summary[0]?.shortlisted ?? 0),
    recruiter_rejected: Number(summary[0]?.recruiter_rejected ?? 0),
    hr_selected: Number(summary[0]?.hr_selected ?? 0),
    hr_rejected: Number(summary[0]?.hr_rejected ?? 0),
    ai_selected: Number(summary[0]?.ai_selected ?? 0),
    ai_rejected: Number(summary[0]?.ai_rejected ?? 0),
    ops_selected: Number(summary[0]?.ops_selected ?? 0),
    ops_rejected: Number(summary[0]?.ops_rejected ?? 0),
    final_selected: Number(summary[0]?.final_selected ?? 0),
    offer_letter_issued: Number(summary[0]?.offer_letter_issued ?? 0),
    joined: Number(summary[0]?.joined ?? 0),
    joining_pending: Number(summary[0]?.joining_pending ?? 0),
    walkins: Number(summary[0]?.walkins ?? 0),
    employee_referrals: Number(summary[0]?.employee_referrals ?? 0),
    active_recruiters: Number(summary[0]?.active_recruiters ?? 0),
    recruiter_inactive_count: Number(summary[0]?.recruiter_inactive_count ?? 0),
  };
  metrics.contacted_pct = metrics.total_records ? Math.round((metrics.total_contacted / metrics.total_records) * 1000) / 10 : 0;

  const [byRecruiter, bySource, byProcess, byBranch] = await Promise.all([
    aggregateBy("recruiter_name_snapshot", filters, scopedOnly, userId),
    aggregateBy("hiring_source", filters, scopedOnly, userId),
    aggregateBy("process_name", filters, scopedOnly, userId),
    aggregateBy("branch_name", filters, scopedOnly, userId),
  ]);

  return { metrics, byRecruiter, bySource, byProcess, byBranch };
}

export async function getCallingDashboard(userId: string, role: string | undefined, filters: HiringFilters) {
  const dashboard = await getHiringDashboard(userId, role, filters);
  return {
    metrics: {
      total_records: dashboard.metrics.total_records,
      total_contacted: dashboard.metrics.total_contacted,
      contacted_pct: dashboard.metrics.contacted_pct,
      not_contacted: dashboard.metrics.not_contacted,
      shortlisted: dashboard.metrics.shortlisted,
      recruiter_rejected: dashboard.metrics.recruiter_rejected,
      walkins: dashboard.metrics.walkins,
      active_recruiters: dashboard.metrics.active_recruiters,
      recruiter_inactive_count: dashboard.metrics.recruiter_inactive_count,
    },
    byRecruiter: dashboard.byRecruiter,
    bySource: dashboard.bySource,
    byProcess: dashboard.byProcess,
    byBranch: dashboard.byBranch,
  };
}

export interface HiringActivityAnalytics {
  funnel: { stage: string; count: number; pct: number }[];
  byOutcome: { label: string; count: number }[];
  bySource: { label: string; total: number; walkins: number; selected: number; joined: number }[];
  byProcess: { label: string; total: number; selected: number; joined: number }[];
  byRecruiter: { label: string; total: number; walkins: number; selected: number; joined: number; selRate: number }[];
  byBranch: { label: string; total: number; selected: number; joined: number }[];
  byGender: { label: string; count: number; joined: number }[];
  byDayOfWeek: { label: string; count: number }[];
  trend: { date: string; logged: number; walkins: number; selected: number }[];
  followupDue: { id: string; candidate_name: string; mobile: string; followup_date: string; followup_reason: string }[];
}

export async function getHiringActivityAnalytics(userId: string, role: string | undefined, filters: HiringFilters): Promise<HiringActivityAnalytics> {
  const scopedOnly = !["admin", "hr", "super_admin"].includes(role ?? "");

  // ── Build WHERE for ats_recruiter_hiring_activity (arha) ─────────────────
  const clauses: string[] = ["COALESCE(arha.is_followup_attempt,0)=0"];
  const params: unknown[] = [];

  if (filters.fromDate)    { clauses.push("arha.activity_date >= ?");              params.push(filters.fromDate); }
  if (filters.toDate)      { clauses.push("arha.activity_date <= ?");              params.push(filters.toDate); }
  if (filters.branch)      { clauses.push("arha.branch_name LIKE ?");              params.push(`%${filters.branch}%`); }
  if (filters.process)     { clauses.push("arha.process_name LIKE ?");             params.push(`%${filters.process}%`); }
  if (filters.hiringSource){ clauses.push("arha.hiring_source LIKE ?");            params.push(`%${filters.hiringSource}%`); }
  if (filters.recruiter)   { clauses.push("arha.recruiter_name_snapshot LIKE ?");  params.push(`%${filters.recruiter}%`); }
  if (filters.gender)      { clauses.push("arha.gender = ?");                      params.push(filters.gender); }
  const branch = scopedOnly ? await getActorBranch(userId) : null;
  if (scopedOnly) {
    clauses.push("(arha.branch_name = ? OR arha.created_by = ? OR arha.recruiter_id = ?)");
    params.push(branch ?? "", userId, userId);
  }

  const W = clauses.join(" AND ");

  // ── Stage macros ──────────────────────────────────────────────────────────
  //
  // CONTACTED: recruiter actually spoke to the candidate.
  //   Positive outcomes: Shortlisted, Rejected (any), Callback Requested,
  //                      Not Interested (Candidate Declined), Selected, Joined,
  //                      Interested - Will Visit, Hold, No Show, Walk-in Completed, Arrived
  //   NOT contacted:     Not Contacted, No Response, Wrong Number, Invalid,
  //                      Switched Off, Busy  (all variants)
  //
  // WALKED IN: ats_candidate.walkin_end_stage is non-empty (set only on physical walk-in)
  //
  // SELECTED: walkin_end_stage or final_decision shows selection/offer
  //
  // JOINED: exists in employees table matched by mobile or personal_email only

  const IS_CONTACTED = `(
    arha.contacted_flag = 1
    OR (
      COALESCE(arha.current_status, arha.recruiter_remarks, '') != ''
      AND LOWER(COALESCE(arha.current_status, arha.recruiter_remarks, '')) NOT REGEXP
        'not contacted|no response|no answer|wrong number|invalid|switched off|busy|not reachable|unreachable'
    )
  )`;

  const IS_WALKIN = `EXISTS (
    SELECT 1 FROM ats_candidate ac
     WHERE (
       ac.id = arha.linked_candidate_id
       OR ac.mobile = arha.mobile
       OR (arha.candidate_email IS NOT NULL AND arha.candidate_email != ''
           AND ac.email = arha.candidate_email)
     )
     AND ac.walkin_end_stage IS NOT NULL
     AND ac.walkin_end_stage != ''
  )`;

  const IS_SELECTED = `(
    arha.final_selection_flag = 1
    OR arha.current_status IN ('Selected','Joined')
    OR arha.joining_status IN ('Offer Extended','Joined')
    OR EXISTS (
      SELECT 1 FROM ats_candidate ac
       WHERE (
         ac.id = arha.linked_candidate_id
         OR ac.mobile = arha.mobile
         OR (arha.candidate_email IS NOT NULL AND arha.candidate_email != ''
             AND ac.email = arha.candidate_email)
       )
       AND LOWER(COALESCE(ac.final_decision,''))
           IN ('selected','offered','joining confirmed','converted')
    )
  )`;

  const IS_JOINED = `EXISTS (
    SELECT 1 FROM employees e
     WHERE e.mobile = arha.mobile
        OR e.alternate_mobile = arha.mobile
        OR (
          arha.candidate_email IS NOT NULL AND arha.candidate_email != ''
          AND e.personal_email = arha.candidate_email
        )
  )`;

  // Build follow-up params reusing already-resolved branch
  const followupClauses: string[] = [
    "followup_required = 1",
    "followup_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)",
  ];
  const followupParams: unknown[] = [];
  if (scopedOnly) {
    followupClauses.push("(branch_name = ? OR created_by = ? OR recruiter_id = ?)");
    followupParams.push(branch ?? "", userId, userId);
  }

  // ── Fire all queries in parallel ─────────────────────────────────────────
  const [
    [summaryRows],
    [outcomeRows],
    [sourceRows],
    [processRows],
    [recruiterRows],
    [branchRows],
    [genderRows],
    [dowRows],
    [trendRows],
    [followupRows],
  ] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*)                                             AS logged,
         SUM(CASE WHEN ${IS_CONTACTED} THEN 1 ELSE 0 END)    AS contacted,
         SUM(CASE WHEN ${IS_WALKIN}    THEN 1 ELSE 0 END)    AS walkins,
         SUM(CASE WHEN ${IS_SELECTED}  THEN 1 ELSE 0 END)    AS selected,
         SUM(CASE WHEN ${IS_JOINED}    THEN 1 ELSE 0 END)    AS joined
       FROM ats_recruiter_hiring_activity arha WHERE ${W}`,
      params
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COALESCE(NULLIF(arha.current_status,''), NULLIF(arha.recruiter_remarks,''), 'Pending') AS label,
              COUNT(*) AS count
         FROM ats_recruiter_hiring_activity arha WHERE ${W}
         GROUP BY label ORDER BY count DESC LIMIT 12`,
      params
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COALESCE(NULLIF(arha.hiring_source,''),'Unknown') AS label,
              COUNT(*) AS total,
              SUM(CASE WHEN ${IS_WALKIN}   THEN 1 ELSE 0 END) AS walkins,
              SUM(CASE WHEN ${IS_SELECTED} THEN 1 ELSE 0 END) AS selected,
              SUM(CASE WHEN ${IS_JOINED}   THEN 1 ELSE 0 END) AS joined
         FROM ats_recruiter_hiring_activity arha WHERE ${W}
         GROUP BY label ORDER BY total DESC LIMIT 10`,
      params
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COALESCE(NULLIF(arha.process_name,''),'Unknown') AS label,
              COUNT(*) AS total,
              SUM(CASE WHEN ${IS_WALKIN}   THEN 1 ELSE 0 END) AS walkins,
              SUM(CASE WHEN ${IS_SELECTED} THEN 1 ELSE 0 END) AS selected,
              SUM(CASE WHEN ${IS_JOINED}   THEN 1 ELSE 0 END) AS joined
         FROM ats_recruiter_hiring_activity arha WHERE ${W}
         GROUP BY label ORDER BY total DESC LIMIT 15`,
      params
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COALESCE(NULLIF(arha.recruiter_name_snapshot,''),'Unknown') AS label,
              COUNT(*) AS total,
              SUM(CASE WHEN ${IS_WALKIN}   THEN 1 ELSE 0 END) AS walkins,
              SUM(CASE WHEN ${IS_SELECTED} THEN 1 ELSE 0 END) AS selected,
              SUM(CASE WHEN ${IS_JOINED}   THEN 1 ELSE 0 END) AS joined
         FROM ats_recruiter_hiring_activity arha WHERE ${W}
         GROUP BY label ORDER BY total DESC LIMIT 15`,
      params
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COALESCE(NULLIF(arha.branch_name,''),'Unknown') AS label,
              COUNT(*) AS total,
              SUM(CASE WHEN ${IS_WALKIN}   THEN 1 ELSE 0 END) AS walkins,
              SUM(CASE WHEN ${IS_SELECTED} THEN 1 ELSE 0 END) AS selected,
              SUM(CASE WHEN ${IS_JOINED}   THEN 1 ELSE 0 END) AS joined
         FROM ats_recruiter_hiring_activity arha WHERE ${W}
         GROUP BY label ORDER BY total DESC LIMIT 20`,
      params
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COALESCE(NULLIF(arha.gender,''),'Unknown') AS label,
              COUNT(*) AS count,
              SUM(CASE WHEN ${IS_WALKIN}   THEN 1 ELSE 0 END) AS walkins,
              SUM(CASE WHEN ${IS_SELECTED} THEN 1 ELSE 0 END) AS selected,
              SUM(CASE WHEN ${IS_JOINED}   THEN 1 ELSE 0 END) AS joined
         FROM ats_recruiter_hiring_activity arha WHERE ${W}
         GROUP BY label ORDER BY count DESC LIMIT 10`,
      params
    ),
    db.execute<RowDataPacket[]>(
      `SELECT DAYOFWEEK(arha.activity_date) AS dow, COUNT(*) AS count
         FROM ats_recruiter_hiring_activity arha WHERE ${W}
         GROUP BY dow ORDER BY dow ASC`,
      params
    ),
    db.execute<RowDataPacket[]>(
      `SELECT arha.activity_date AS date,
              COUNT(*) AS logged,
              SUM(CASE WHEN ${IS_WALKIN}   THEN 1 ELSE 0 END) AS walkins,
              SUM(CASE WHEN ${IS_SELECTED} THEN 1 ELSE 0 END) AS selected
         FROM ats_recruiter_hiring_activity arha
        WHERE arha.activity_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND ${W}
        GROUP BY arha.activity_date ORDER BY arha.activity_date ASC`,
      params
    ),
    db.execute<RowDataPacket[]>(
      `SELECT id, candidate_name, mobile,
              DATE_FORMAT(followup_date,'%Y-%m-%d') AS followup_date,
              followup_reason
         FROM ats_recruiter_hiring_activity
        WHERE ${followupClauses.join(" AND ")}
        ORDER BY followup_date ASC LIMIT 50`,
      followupParams
    ),
  ]);

  // ── Map results ───────────────────────────────────────────────────────────
  const s = summaryRows[0] ?? {};
  const logged    = Number(s.logged    ?? 0);
  const contacted = Number(s.contacted ?? 0);
  const walkins   = Number(s.walkins   ?? 0);
  const selected  = Number(s.selected  ?? 0);
  const joined    = Number(s.joined    ?? 0);
  const pct = (n: number) => logged ? Math.round(n / logged * 1000) / 10 : 0;
  const funnel = [
    { stage: "Logged",    count: logged,    pct: 100           },
    { stage: "Contacted", count: contacted, pct: pct(contacted) },
    { stage: "Walked In", count: walkins,   pct: pct(walkins)   },
    { stage: "Selected",  count: selected,  pct: pct(selected)  },
    { stage: "Joined",    count: joined,    pct: pct(joined)    },
  ];

  const byOutcome   = (outcomeRows as any[]).map((r) => ({ label: String(r.label), count: Number(r.count) }));
  const bySource    = (sourceRows as any[]).map((r) => ({ label: String(r.label || 'Unknown'), total: Number(r.total) || 0, walkins: Number(r.walkins) || 0, selected: Number(r.selected) || 0, joined: Number(r.joined) || 0 }));
  const byProcess   = (processRows as any[]).map((r) => ({ label: String(r.label || 'Unknown'), total: Number(r.total) || 0, walkins: Number(r.walkins) || 0, selected: Number(r.selected) || 0, joined: Number(r.joined) || 0 }));
  const byBranch    = (branchRows as any[]).map((r) => ({ label: String(r.label || 'Unknown'), total: Number(r.total) || 0, walkins: Number(r.walkins) || 0, selected: Number(r.selected) || 0, joined: Number(r.joined) || 0 }));
  const byGender    = (genderRows as any[]).map((r) => ({ label: String(r.label || 'Unknown'), count: Number(r.count) || 0, walkins: Number(r.walkins) || 0, selected: Number(r.selected) || 0, joined: Number(r.joined) || 0 }));
  const byRecruiter = (recruiterRows as any[]).map((r) => {
    const total = Number(r.total) || 0;
    const sel   = Number(r.selected) || 0;
    const selRate = total ? Math.round((sel / total) * 1000) / 10 : 0;
    return { label: String(r.label || 'Unknown'), total, walkins: Number(r.walkins) || 0, selected: sel, joined: Number(r.joined) || 0, selRate: Number.isFinite(selRate) ? selRate : 0 };
  });

  const DOW_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dowMap = new Map<number, number>();
  for (const r of dowRows as any[]) dowMap.set(Number(r.dow), Number(r.count) || 0);
  const byDayOfWeek = [1,2,3,4,5,6,7].map((d) => ({ label: DOW_LABELS[d-1], count: dowMap.get(d) ?? 0 }));

  const trend = (trendRows as any[]).map((r) => ({
    date: String(r.date ?? "").slice(0,10),
    logged: Number(r.logged), walkins: Number(r.walkins), selected: Number(r.selected),
  }));

  const followupDue = (followupRows as any[]).map((r) => ({
    id: String(r.id), candidate_name: String(r.candidate_name ?? ""),
    mobile: String(r.mobile ?? ""), followup_date: String(r.followup_date ?? ""),
    followup_reason: String(r.followup_reason ?? ""),
  }));

  return { funnel, byOutcome, bySource, byProcess, byRecruiter, byBranch, byGender, byDayOfWeek, trend, followupDue };
}

export async function searchInterviewers(branchName: string | null, query: string | null, roundType: string, limit = 20, userId?: string) {
  const branch = branchName || (userId ? await getCurrentUserBranch(userId) : null);
  const q = `%${query ?? ""}%`;
  const round = roundType || "ops_round";
  let rows: InterviewerRow[] = [];

  const runQuery = async (sql: string, params: unknown[]) => {
    const [result] = await db.execute<InterviewerRow[]>(sql, params);
    return result;
  };

  const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 50);

  if (branch) {
    rows = await runQuery(
      `SELECT
          e.id,
          e.employee_code,
          COALESCE(e.first_name, '') AS first_name,
          COALESCE(e.last_name, '') AS last_name,
          COALESCE(e.mobile, e.alternate_mobile) AS mobile,
          COALESCE(e.official_email, e.office_email, e.email) AS email,
          b.branch_name,
          d.dept_name,
          des.designation_name
        FROM employees e
        LEFT JOIN branch_master b ON b.id = e.branch_id
        LEFT JOIN department_master d ON d.id = e.department_id
        LEFT JOIN designation_master des ON des.id = e.designation_id
        WHERE e.active_status = 1
          AND (b.branch_name = ? OR b.branch_code = ? OR b.branch_name LIKE CONCAT('%', ?, '%'))
          AND (
            CONCAT_WS(' ', e.first_name, e.last_name, e.employee_code, COALESCE(e.official_email, e.office_email, e.email)) LIKE ?
            OR e.employee_code LIKE ?
          )
        ORDER BY e.first_name, e.last_name
        LIMIT ${safeLimit}`,
      [branch, branch, branch, q, q]
    );
  }

  if (rows.length === 0) {
    rows = await runQuery(
      `SELECT
          e.id,
          e.employee_code,
          COALESCE(e.first_name, '') AS first_name,
          COALESCE(e.last_name, '') AS last_name,
          COALESCE(e.mobile, e.alternate_mobile) AS mobile,
          COALESCE(e.official_email, e.office_email, e.email) AS email,
          b.branch_name,
          d.dept_name,
          des.designation_name
        FROM employees e
        LEFT JOIN branch_master b ON b.id = e.branch_id
        LEFT JOIN department_master d ON d.id = e.department_id
        LEFT JOIN designation_master des ON des.id = e.designation_id
        WHERE e.active_status = 1
          AND (
            CONCAT_WS(' ', e.first_name, e.last_name, e.employee_code, COALESCE(e.official_email, e.office_email, e.email)) LIKE ?
            OR e.employee_code LIKE ?
            OR COALESCE(e.first_name, '') LIKE ?
            OR COALESCE(e.last_name, '') LIKE ?
          )
        ORDER BY e.first_name, e.last_name
        LIMIT ${safeLimit}`,
      [q, q, q, q]
    );
  }

  return rows.map((row) => ({
    id: row.id,
    employee_code: row.employee_code,
    name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim(),
    email: row.email,
    mobile: row.mobile,
    branch_name: row.branch_name,
    dept_name: row.dept_name,
    designation_name: row.designation_name,
    round_type: round,
  }));
}

export async function readImportBatch(batchId: string) {
  const [batchRows] = await db.execute<ImportBatchRow[]>(
    `SELECT * FROM ats_recruiter_hiring_import_batch WHERE id = ? LIMIT 1`,
    [batchId]
  );
  const [errorRows] = await db.execute<ImportBatchRow[]>(
    `SELECT * FROM ats_recruiter_hiring_import_error WHERE import_batch_id = ? ORDER BY \`row_number\` ASC`,
    [batchId]
  );
  return {
    batch: batchRows[0] ?? null,
    errors: errorRows,
  };
}

export const __test__ = {
  canonical,
  pick,
  tokenNumberFor,
  getCurrentUserBranch,
};
