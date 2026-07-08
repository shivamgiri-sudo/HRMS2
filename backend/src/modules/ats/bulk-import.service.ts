import { createHash, randomUUID } from "crypto";
import * as XLSX from "xlsx";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

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
  return rows;
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateRow(row: ImportRow, rowIdx: number): { errors: ImportError[]; warnings: ImportWarning[] } {
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  const cid = row.CandidateID ?? `row-${rowIdx}`;

  if (!row.FullName?.trim()) {
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
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT user_id FROM employees WHERE LOWER(full_name) = LOWER(?) AND active_status = 1 LIMIT 1`,
      [name.trim()]
    );
    if ((rows as RowDataPacket[]).length) userId = (rows as RowDataPacket[])[0].user_id;
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
  const mobileHash = hashMobile(mobile);
  const [byMobile] = await db.execute<RowDataPacket[]>(
    `SELECT id, candidate_code FROM ats_candidate WHERE mobile_hash = ? OR mobile = ? LIMIT 1`,
    [mobileHash, mobile]
  );
  if ((byMobile as RowDataPacket[]).length) return (byMobile as RowDataPacket[])[0] as { id: string; candidate_code: string };

  if (email) {
    const emailHash = hashEmail(email);
    const [byEmail] = await db.execute<RowDataPacket[]>(
      `SELECT id, candidate_code FROM ats_candidate WHERE email_hash = ? OR email = ? LIMIT 1`,
      [emailHash, email.toLowerCase().trim()]
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
  dryRun: boolean
): Promise<{ action: "created" | "updated" | "skipped"; warnings: ImportWarning[] }> {
  const warnings: ImportWarning[] = [];
  const cid = row.CandidateID ?? `row-${rowIdx}`;
  const mobile = String(row.Mobile ?? "").replace(/\D/g, "");
  const email = row.Email?.trim().toLowerCase() || undefined;

  const existing = await findExistingCandidate(mobile, email);
  const createdAt = parseHistoricalDate(row.CreatedDate, row.CreatedTime) ?? new Date().toISOString().slice(0, 19).replace("T", " ");

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

    return { action: "updated", warnings };
  }

  // Insert new candidate
  candidateDbId = randomUUID();
  const mobileHash = hashMobile(mobile);
  const emailHash = email ? hashEmail(email) : null;

  await db.execute(
    `INSERT INTO ats_candidate
      (id, candidate_code, full_name, mobile, mobile_hash, email, email_hash, gender,
       applied_for_process, applied_for_branch, current_stage, remarks,
       walk_in_date, created_at, updated_at, active_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 1)`,
    [
      candidateDbId,
      row.CandidateID?.trim() ?? `IMP-${randomUUID().slice(0, 8).toUpperCase()}`,
      row.FullName?.trim(),
      mobile,
      mobileHash,
      email ?? null,
      emailHash,
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
    warnings.push({ row: rowIdx, candidateId: cid, message: `Recruiter '${row.RecruiterAssignedName}' not found, assignment skipped` });
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

  return { action: "created", warnings };
}

function buildSkillRemarks(row: ImportRow): string {
  const parts: string[] = [];
  if (row.SkillTest_Typing) parts.push(`Typing: ${row.SkillTest_Typing}`);
  if (row.SkillTest_AI) parts.push(`AI Score: ${row.SkillTest_AI}`);
  if (row.SkillTest_Remarks) parts.push(row.SkillTest_Remarks);
  return parts.join(", ");
}

// ── Main Orchestrator ─────────────────────────────────────────────────────────

export async function runBulkImport(params: {
  rows: ImportRow[];
  actorUserId: string;
  dryRun: boolean;
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

  for (let i = 0; i < params.rows.length; i++) {
    const row = params.rows[i];
    const rowIdx = i + 2; // 1-indexed, +1 for header row

    const { errors, warnings } = validateRow(row, rowIdx);
    result.warnings.push(...warnings);

    if (errors.length) {
      result.errors.push(...errors);
      result.summary.errors++;
      continue;
    }

    try {
      const { action, warnings: actionWarnings } = await importOneCandidate(row, rowIdx, params.actorUserId, params.dryRun);
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
  }

  return result;
}
