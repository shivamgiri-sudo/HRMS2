import { createHash, randomUUID } from "crypto";
import * as XLSX from "xlsx";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { getIstDateString } from '../../utils/dateUtils.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ImportRow {
  CreatedDate?: string;
  CreatedTime?: string;
  CandidateID?: string;
  QToken?: string;
  FullName?: string;
  Mobile?: string;
  Email?: string;
  Address?: string;
  Education?: string;
  Experience?: string;
  Gender?: string;
  RoleApplied?: string;
  RecruiterSelected?: string;
  Branch?: string;
  LeavesNext3Months?: string;
  PreferredShiftTiming?: string;
  NightShiftComfortable?: string;
  RotationalShiftComfort?: string;
  Own2Wheeler?: string;
  IDProof?: string;
  EduProof?: string;
  ResumeLink?: string;
  "Total Time Consumed"?: string;
  "SLA Breached ( 120 Mins)"?: string;
  Process?: string;
  RecruiterAssignedName?: string;
  RecruiterEmail?: string;
  RecruiterMobile?: string;
  "Walk-in EndStage"?: string;
  Status?: string;
  UpdateFormLink?: string;
  Round1_Result?: string;
  Round1_VOC?: string;
  Round1_Remarks?: string;
  SkillTest_Typing?: string;
  SkillTest_AI?: string;
  SkillTest_Result?: string;
  SkillTest_VOC?: string;
  SkillTest_Remarks?: string;
  Round2_Result?: string;
  Round2_VOC?: string;
  Round2_Remarks?: string;
  Round3_Result?: string;
  Round3_VOC?: string;
  Round3_Remarks?: string;
  FinalDecision?: string;
  Offer_Salary?: string;
  Offer_DOJ?: string;
  Reporting_Shift?: string;
  "Joining Confirmation"?: string;
  Offer_PerformanceIncentive?: string;
  LastUpdated?: string;
  "HR Form Submition Time"?: string;
  "Walk- in SLOT"?: string;
  "wait time"?: string;
  "Rejection VOC"?: string;
  [key: string]: string | undefined;
}

export interface ImportError {
  row: number;
  candidateId: string;
  field: string;
  message: string;
}

export interface ImportWarning {
  row: number;
  candidateId: string;
  message: string;
}

export interface ImportResult {
  summary: {
    totalRows: number;
    created: number;
    updated: number;
    skipped: number;
    errors: number;
  };
  errors: ImportError[];
  warnings: ImportWarning[];
}

// ── Stage Mapping ─────────────────────────────────────────────────────────────

const STAGE_MAP: Record<string, string> = {
  "arrival": "Registered",
  "interview round 1": "Interview_Round1",
  "interview - skill test": "SkillTest",
  "interview round 2": "Interview_Round2",
  "interview round 3": "Interview_Round3",
  "rejected": "Rejected",
  "selected": "Offer_Extended",
  "no show": "No_Show",
  "walkout": "Walkout",
  "hold": "Hold",
  "callback": "Callback",
};

function mapStage(raw: string | undefined): string {
  if (!raw) return "Registered";
  const key = raw.trim().toLowerCase();
  return STAGE_MAP[key] ?? raw.trim();
}

function mapInterviewStatus(raw: string | undefined): "selected" | "rejected" | "hold" | "callback" | "no_show" | "walkout" | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === "selected") return "selected";
  if (v === "rejected") return "rejected";
  if (v === "hold") return "hold";
  if (v === "callback") return "callback";
  if (v.includes("no show")) return "no_show";
  if (v === "walkout") return "walkout";
  return null;
}

// ── Date Parsing ──────────────────────────────────────────────────────────────

// Attempts M/D/YYYY first; if day > 12 tries D/M/YYYY
function parseHistoricalDate(dateStr: string | undefined, timeStr?: string): string | null {
  if (!dateStr) return null;
  const s = String(dateStr).trim();

  // Excel serial number
  if (/^\d{5}$/.test(s)) {
    const d = XLSX.SSF.parse_date_code(Number(s));
    if (d) {
      const month = String(d.m).padStart(2, "0");
      const day = String(d.d).padStart(2, "0");
      const time = timeStr ? ` ${timeStr}` : " 00:00:00";
      return `${d.y}-${month}-${day}${time}`;
    }
  }

  // M/D/YYYY or D/M/YYYY
  const parts = s.split(/[\/\-]/);
  if (parts.length === 3) {
    let p1 = parseInt(parts[0], 10);
    let p2 = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);
    let month: number, day: number;
    if (p2 > 12) {
      // p2 is definitely day, p1 is month (M/D/YYYY)
      month = p1; day = p2;
    } else if (p1 > 12) {
      // p1 is definitely day, p2 is month (D/M/YYYY)
      day = p1; month = p2;
    } else {
      // Ambiguous — default to M/D/YYYY (US format matches sample data 3/21/2026 = March 21)
      month = p1; day = p2;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const time = timeStr ? ` ${String(timeStr).trim()}` : " 00:00:00";
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}${time}`;
  }

  return null;
}

function parseCTC(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^\d.]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function hashMobile(mobile: string): string {
  return createHash("sha256").update(mobile.replace(/\D/g, "")).digest("hex");
}

function hashEmail(email: string): string {
  return createHash("sha256").update(email.toLowerCase().trim()).digest("hex");
}

// ── File Parsing ──────────────────────────────────────────────────────────────

export function parseHistoricalFile(buffer: Buffer, mimeType: string): ImportRow[] {
  const opts: XLSX.ParsingOptions = { type: "buffer", raw: false };
  if (mimeType === "text/tab-separated-values" || mimeType.includes("tsv")) {
    opts.type = "buffer";
  }
  const wb = XLSX.read(buffer, opts);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<ImportRow>(sheet, { defval: "" });
  // Coerce all cell values to strings — XLSX can parse numeric-looking cells as numbers
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (row[key] !== undefined && row[key] !== null && typeof row[key] !== "string") {
        row[key] = String(row[key]);
      }
    }
  }
  return rows;
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateRow(row: ImportRow, rowIdx: number): { errors: ImportError[]; warnings: ImportWarning[] } {
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  const cid = String(row.CandidateID ?? `row-${rowIdx}`);

  const fullName = String(row.FullName ?? "").trim();
  if (!fullName) {
    errors.push({ row: rowIdx, candidateId: cid, field: "FullName", message: "FullName is required" });
  }
  const mobile = String(row.Mobile ?? "").replace(/\D/g, "");
  if (!mobile) {
    errors.push({ row: rowIdx, candidateId: cid, field: "Mobile", message: "Mobile is required" });
  } else if (mobile.length !== 10) {
    errors.push({ row: rowIdx, candidateId: cid, field: "Mobile", message: `Mobile must be 10 digits, got ${mobile.length}` });
  }

  if (row.Email) {
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(String(row.Email).trim())) {
      warnings.push({ row: rowIdx, candidateId: cid, message: `Email '${row.Email}' looks invalid, skipping email field` });
    }
  }

  if (!row.CreatedDate) {
    warnings.push({ row: rowIdx, candidateId: cid, message: "No CreatedDate, will use current timestamp" });
  }

  return { errors, warnings };
}

// ── Lookup Helpers ────────────────────────────────────────────────────────────

const recruiterCache = new Map<string, string | null>();
async function lookupRecruiter(name: string | undefined, email: string | undefined): Promise<string | null> {
  const key = `${name ?? ""}|${email ?? ""}`;
  if (recruiterCache.has(key)) return recruiterCache.get(key)!;
  let userId: string | null = null;
  if (email) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.user_id FROM employees e JOIN auth_user u ON u.id = e.user_id WHERE u.email = ? AND e.active_status = 1 LIMIT 1`,
      [email.trim().toLowerCase()]
    );
    if ((rows as RowDataPacket[]).length) userId = (rows as RowDataPacket[])[0].user_id;
  }
  if (!userId && name) {
    const [exact] = await db.execute<RowDataPacket[]>(
      `SELECT user_id FROM employees WHERE LOWER(full_name) = LOWER(?) AND active_status = 1 LIMIT 1`,
      [name.trim()]
    );
    if ((exact as RowDataPacket[]).length) {
      userId = (exact as RowDataPacket[])[0].user_id;
    } else {
      // Partial match fallback — only assign if unambiguous (exactly 1 result)
      const [partial] = await db.execute<RowDataPacket[]>(
        `SELECT user_id FROM employees WHERE LOWER(full_name) LIKE LOWER(?) AND active_status = 1 LIMIT 2`,
        [`%${name.trim()}%`]
      );
      if ((partial as RowDataPacket[]).length === 1) {
        userId = (partial as RowDataPacket[])[0].user_id;
      }
    }
  }
  recruiterCache.set(key, userId);
  return userId;
}

const branchCache = new Map<string, string | null>();
async function lookupBranch(name: string | undefined): Promise<string | null> {
  if (!name?.trim()) return null;
  const key = name.trim().toLowerCase();
  if (branchCache.has(key)) return branchCache.get(key)!;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM branch_master WHERE LOWER(branch_name) LIKE LOWER(?) AND active_status = 1 LIMIT 1`,
    [`%${name.trim()}%`]
  );
  const id = (rows as RowDataPacket[]).length ? (rows as RowDataPacket[])[0].id : null;
  branchCache.set(key, id);
  return id;
}

const processCache = new Map<string, string | null>();
async function lookupProcess(name: string | undefined): Promise<string | null> {
  if (!name?.trim()) return null;
  const key = name.trim().toLowerCase();
  if (processCache.has(key)) return processCache.get(key)!;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM process_master WHERE LOWER(process_name) LIKE LOWER(?) AND active_status = 1 LIMIT 1`,
    [`%${name.trim()}%`]
  );
  const id = (rows as RowDataPacket[]).length ? (rows as RowDataPacket[])[0].id : null;
  processCache.set(key, id);
  return id;
}

// ── Core Import ───────────────────────────────────────────────────────────────

async function findExistingCandidate(mobile: string, email: string | undefined): Promise<{ id: string; candidate_code: string } | null> {
  const [byMobile] = await db.execute<RowDataPacket[]>(
    `SELECT id, candidate_code FROM ats_candidate WHERE mobile = ? LIMIT 1`,
    [mobile]
  );
  if ((byMobile as RowDataPacket[]).length) return (byMobile as RowDataPacket[])[0] as { id: string; candidate_code: string };

  if (email) {
    const [byEmail] = await db.execute<RowDataPacket[]>(
      `SELECT id, candidate_code FROM ats_candidate WHERE email = ? LIMIT 1`,
      [email.toLowerCase().trim()]
    );
    if ((byEmail as RowDataPacket[]).length) return (byEmail as RowDataPacket[])[0] as { id: string; candidate_code: string };
  }
  return null;
}

function normalizeGender(raw: string | undefined): "Male" | "Female" | "Other" | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "male" || v === "m") return "Male";
  if (v === "female" || v === "f") return "Female";
  return "Other";
}

async function importOneCandidate(
  row: ImportRow,
  rowIdx: number,
  actorUserId: string,
  dryRun: boolean,
  importBatchId: string | null = null
): Promise<{ action: "created" | "updated" | "skipped"; warnings: ImportWarning[] }> {
  const warnings: ImportWarning[] = [];
  const cid = row.CandidateID ?? `row-${rowIdx}`;
  const mobile = String(row.Mobile ?? "").replace(/\D/g, "");
  const email = row.Email?.trim().toLowerCase() || undefined;

  const existing = await findExistingCandidate(mobile, email);
  const createdAt = parseHistoricalDate(row.CreatedDate, row.CreatedTime) ?? getIstDateString();

  const branchId = await lookupBranch(row.Branch);
  const processId = await lookupProcess(row.Process || row.RoleApplied);
  if (row.Branch && !branchId) warnings.push({ row: rowIdx, candidateId: cid, message: `Branch '${row.Branch}' not found in branch_master` });
  if ((row.Process || row.RoleApplied) && !processId) warnings.push({ row: rowIdx, candidateId: cid, message: `Process '${row.Process || row.RoleApplied}' not found in process_master` });

  const currentStage = mapStage(row["Walk-in EndStage"] || row.Status);

  if (dryRun) {
    return { action: existing ? "updated" : "created", warnings };
  }

  let candidateDbId: string;

  if (existing) {
    await db.execute(
      `UPDATE ats_candidate SET
        full_name = COALESCE(NULLIF(?, ''), full_name),
        email = COALESCE(NULLIF(?, ''), email),
        gender = COALESCE(NULLIF(?, ''), gender),
        applied_for_process = COALESCE(NULLIF(?, ''), applied_for_process),
        applied_for_branch = COALESCE(NULLIF(?, ''), applied_for_branch),
        current_stage = ?,
        remarks = COALESCE(NULLIF(?, ''), remarks),
        updated_at = NOW()
      WHERE id = ?`,
      [
        row.FullName?.trim() ?? "",
        email ?? "",
        normalizeGender(row.Gender) ?? "",
        row.RoleApplied?.trim() ?? "",
        row.Branch?.trim() ?? "",
        currentStage,
        row["Rejection VOC"] ?? row.Round1_VOC ?? "",
        existing.id,
      ]
    );
    candidateDbId = existing.id;

    // Stage log entry
    await db.execute(
      `INSERT INTO ats_candidate_stage_log (id, candidate_id, to_stage, stage_date, remarks, updated_by)
       VALUES (UUID(), ?, ?, ?, 'Historical import (update)', ?)`,
      [candidateDbId, currentStage, createdAt, actorUserId]
    );

    // Upsert hiring activity for updated candidates too
    const recruiterUserId = await lookupRecruiter(row.RecruiterAssignedName, row.RecruiterEmail);
    await insertHiringActivity(
      row, candidateDbId, recruiterUserId,
      row.RecruiterAssignedName?.trim() || null,
      actorUserId, createdAt, currentStage, importBatchId
    );

    return { action: "updated", warnings };
  }

  // Insert new candidate
  candidateDbId = randomUUID();

  await db.execute(
    `INSERT INTO ats_candidate
      (id, candidate_code, full_name, mobile, email, gender,
       applied_for_process, applied_for_branch, current_stage, remarks,
       walk_in_date, created_at, updated_at, active_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 1)`,
    [
      candidateDbId,
      row.CandidateID?.trim() ?? `IMP-${randomUUID().slice(0, 8).toUpperCase()}`,
      row.FullName?.trim(),
      mobile,
      email ?? null,
      normalizeGender(row.Gender) ?? null,
      row.RoleApplied?.trim() ?? null,
      row.Branch?.trim() ?? null,
      currentStage,
      row["Rejection VOC"] ?? row.Round1_VOC ?? null,
      parseHistoricalDate(row.CreatedDate) ?? null,
      createdAt,
    ]
  );

  await db.execute(
    `INSERT INTO ats_candidate_stage_log (id, candidate_id, to_stage, stage_date, remarks, updated_by)
     VALUES (UUID(), ?, ?, ?, 'Historical import', ?)`,
    [candidateDbId, currentStage, createdAt, actorUserId]
  );

  // Interview results — one per round
  const interviewRounds: Array<{ result?: string; voc?: string; remarks?: string; label: string }> = [
    { result: row.Round1_Result, voc: row.Round1_VOC, remarks: row.Round1_Remarks, label: "Round1" },
    { result: row.SkillTest_Result, voc: row.SkillTest_VOC, remarks: buildSkillRemarks(row), label: "SkillTest" },
    { result: row.Round2_Result, voc: row.Round2_VOC, remarks: row.Round2_Remarks, label: "Round2" },
    { result: row.Round3_Result, voc: row.Round3_VOC, remarks: row.Round3_Remarks, label: "Round3" },
  ];

  const recruiterUserId = await lookupRecruiter(row.RecruiterAssignedName, row.RecruiterEmail);
  if ((row.RecruiterAssignedName || row.RecruiterEmail) && !recruiterUserId) {
    warnings.push({ row: rowIdx, candidateId: cid, message: `Recruiter '${row.RecruiterAssignedName}' not found or ambiguous, assignment skipped (name saved as text)` });
  }

  for (const round of interviewRounds) {
    const status = mapInterviewStatus(round.result);
    if (!status || !round.result?.trim()) continue;
    await db.execute(
      `INSERT INTO ats_interview_result
        (id, candidate_id, recruiter_id, interview_status, remarks, rejection_reason, created_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?)`,
      [
        candidateDbId,
        recruiterUserId ?? actorUserId,
        status,
        `[${round.label}] ${round.remarks ?? ""}`.trim(),
        round.voc ?? null,
        createdAt,
      ]
    );
  }

  // Always store the raw recruiter name from the sheet, even if ID lookup failed
  if (row.RecruiterAssignedName?.trim()) {
    await db.execute(
      `UPDATE ats_candidate SET recruiter_assigned_name = ? WHERE id = ?`,
      [row.RecruiterAssignedName.trim(), candidateDbId]
    ).catch(() => {});
  }

  // Recruiter assignment
  if (recruiterUserId) {
    await db.execute(
      `UPDATE ats_candidate SET assigned_recruiter_id = ? WHERE id = ?`,
      [recruiterUserId, candidateDbId]
    ).catch(() => {}); // Column may not exist in all migrations
    await db.execute(
      `INSERT INTO ats_recruiter_assignment_log (id, candidate_id, new_recruiter_id, assigned_by, created_at)
       VALUES (UUID(), ?, ?, ?, ?)`,
      [candidateDbId, recruiterUserId, actorUserId, createdAt]
    );
  }

  // Insert into recruiter hiring activity for analytics/funnel tracking
  await insertHiringActivity(
    row, candidateDbId, recruiterUserId,
    row.RecruiterAssignedName?.trim() || null,
    actorUserId, createdAt, currentStage, importBatchId
  );

  return { action: "created", warnings };
}

function buildSkillRemarks(row: ImportRow): string {
  const parts: string[] = [];
  if (row.SkillTest_Typing) parts.push(`Typing: ${row.SkillTest_Typing}`);
  if (row.SkillTest_AI) parts.push(`AI Score: ${row.SkillTest_AI}`);
  if (row.SkillTest_Remarks) parts.push(row.SkillTest_Remarks);
  return parts.join(", ");
}

// ── Employee Auto-Match ──────────────────────────────────────────────────────

async function findEmployeeByMobileOrEmail(mobile: string, email?: string): Promise<{ id: string; employee_code: string } | null> {
  if (mobile) {
    // Match by mobile (primary) or alternate_mobile
    const [byMobile] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_code FROM employees WHERE mobile = ? OR alternate_mobile = ? LIMIT 1`,
      [mobile, mobile]
    );
    if ((byMobile as RowDataPacket[]).length) return (byMobile as RowDataPacket[])[0] as { id: string; employee_code: string };
  }
  if (email) {
    // Match by personal_email — this is what candidates provide pre-onboarding
    // DO NOT match official_email/auth_user.email which is generated post-onboarding
    const [byEmail] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_code FROM employees WHERE personal_email = ? LIMIT 1`,
      [email.toLowerCase().trim()]
    );
    if ((byEmail as RowDataPacket[]).length) return (byEmail as RowDataPacket[])[0] as { id: string; employee_code: string };
  }
  return null;
}

function deriveHiringFlags(row: ImportRow, currentStage: string): {
  walkin_flag: number; contacted_flag: number; final_selection_flag: number; joined_flag: number;
  current_status: string; joining_status: string | null; hr_interview_status: string | null;
} {
  const endStage = (row["Walk-in EndStage"] || row.Status || "").toLowerCase().trim();
  const finalDecision = (row.FinalDecision || "").toLowerCase().trim();
  const joiningConfirm = (row["Joining Confirmation"] || "").toLowerCase().trim();

  // Everyone in the CSV was contacted — rejected/hold/not interested/no-show all mean we reached them
  const contacted_flag = 1;
  const walkin_flag = endStage !== "" && !["no show", "not interested", "not reachable", ""].includes(endStage) ? 1 : 0;
  const final_selection_flag = ["selected", "offer_extended", "joined", "offered"].includes(finalDecision) ||
    currentStage === "Offer_Extended" || currentStage === "Onboarded" ? 1 : 0;
  const joined_flag = joiningConfirm === "yes" || joiningConfirm === "joined" ||
    finalDecision === "joined" || currentStage === "Onboarded" ? 1 : 0;

  let current_status = "Contacted";
  if (joined_flag) current_status = "Joined";
  else if (final_selection_flag) current_status = "Selected";
  else if (endStage.includes("reject") || finalDecision === "rejected") current_status = "Rejected";
  else if (endStage === "hold" || finalDecision === "hold") current_status = "Hold";
  else if (endStage === "no show") current_status = "No Show";
  else if (endStage === "walkout") current_status = "Walkout";
  else if (finalDecision === "not interested" || endStage.includes("not interested")) current_status = "Not Interested";
  else if (walkin_flag) current_status = "Walk-in Completed";

  const hr_interview_status = row.Round1_Result?.trim() || null;
  const joining_status = joined_flag ? "Joined" : final_selection_flag ? "Offer Extended" : null;

  return { walkin_flag, contacted_flag, final_selection_flag, joined_flag, current_status, joining_status, hr_interview_status };
}

async function insertHiringActivity(
  row: ImportRow,
  candidateDbId: string,
  recruiterUserId: string | null,
  recruiterName: string | null,
  actorUserId: string,
  createdAt: string,
  currentStage: string,
  importBatchId: string | null
): Promise<void> {
  const mobile = String(row.Mobile ?? "").replace(/\D/g, "");
  const email = row.Email?.trim().toLowerCase() || undefined;
  const flags = deriveHiringFlags(row, currentStage);

  // Auto-match with employee table via mobile or personal_email
  const employee = await findEmployeeByMobileOrEmail(mobile, email);

  const activityDate = parseHistoricalDate(row.CreatedDate) ?? createdAt.split(" ")[0];

  await db.execute(
    `INSERT INTO ats_recruiter_hiring_activity
      (id, activity_date, activity_month, recruiter_id, recruiter_name_snapshot,
       hiring_source, position_name, location_name, branch_name, process_name,
       candidate_name, gender, mobile, candidate_email,
       education_qualification, experience_level, candidate_location,
       recruiter_remarks, recruiter_rejection_reason,
       hr_interview_status, ops_interview_status,
       current_status, joining_status,
       walkin_flag, contacted_flag, final_selection_flag, joined_flag,
       linked_candidate_id, employee_id, joined_candidate_emp_code,
       import_batch_id, source_system, created_by, created_at)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      activityDate,
      row.CreatedDate ? (row.CreatedDate.substring(0, 7) || null) : null,
      recruiterUserId,
      recruiterName || row.RecruiterAssignedName?.trim() || "Unknown",
      "Bulk Import",
      row.RoleApplied?.trim() || row.Process?.trim() || "General",
      row.Branch?.trim() || "Not specified",
      row.Branch?.trim() || null,
      row.Process?.trim() || row.RoleApplied?.trim() || "General",
      row.FullName?.trim() || "",
      row.Gender?.trim() || null,
      mobile,
      row.Email?.trim() || null,
      row.Education?.trim() || null,
      row.Experience?.trim() || null,
      row.Address?.trim() || null,
      row.RecruiterSelected?.trim() || null,
      row["Rejection VOC"]?.trim() || row.Round1_VOC?.trim() || null,
      flags.hr_interview_status,
      row.Round2_Result?.trim() || null,
      flags.current_status,
      flags.joining_status,
      flags.walkin_flag,
      flags.contacted_flag,
      flags.final_selection_flag,
      flags.joined_flag,
      candidateDbId,
      employee?.id || null,
      employee?.employee_code || null,
      importBatchId,
      "BULK_IMPORT",
      actorUserId,
      createdAt,
    ]
  ).catch((err) => {
    // Don't fail the whole import if hiring activity insert fails
    console.warn(`[bulk-import] hiring activity insert failed for row ${row.CandidateID}: ${err.message}`);
  });

  // Also update ats_candidate with employee_code if found
  if (employee && candidateDbId) {
    await db.execute(
      `UPDATE ats_candidate SET employee_code = ? WHERE id = ? AND (employee_code IS NULL OR employee_code = '')`,
      [employee.employee_code, candidateDbId]
    ).catch(() => {});
  }
}

// ── Main Orchestrator ─────────────────────────────────────────────────────────

export async function runBulkImport(params: {
  rows: ImportRow[];
  actorUserId: string;
  dryRun: boolean;
  importBatchId?: string;
}): Promise<ImportResult> {
  // Clear lookup caches for fresh run
  recruiterCache.clear();
  branchCache.clear();
  processCache.clear();

  const result: ImportResult = {
    summary: { totalRows: params.rows.length, created: 0, updated: 0, skipped: 0, errors: 0 },
    errors: [],
    warnings: [],
  };

  const importBatchId = params.dryRun ? null : randomUUID();

  const BATCH_SIZE = 10;
  for (let batchStart = 0; batchStart < params.rows.length; batchStart += BATCH_SIZE) {
    const batch = params.rows.slice(batchStart, batchStart + BATCH_SIZE);
    await Promise.all(batch.map(async (row, idx) => {
      const i = batchStart + idx;
      const rowIdx = i + 2;

      const { errors, warnings } = validateRow(row, rowIdx);
      result.warnings.push(...warnings);

      if (errors.length) {
        result.errors.push(...errors);
        result.summary.errors++;
        return;
      }

      try {
        const { action, warnings: actionWarnings } = await importOneCandidate(row, rowIdx, params.actorUserId, params.dryRun, importBatchId);
        result.warnings.push(...actionWarnings);
        if (action === "created") result.summary.created++;
        else if (action === "updated") result.summary.updated++;
        else result.summary.skipped++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push({
          row: rowIdx,
          candidateId: row.CandidateID ?? `row-${rowIdx}`,
          field: "db",
          message: msg,
        });
        result.summary.errors++;
      }
    }));
  }

  return result;
}
