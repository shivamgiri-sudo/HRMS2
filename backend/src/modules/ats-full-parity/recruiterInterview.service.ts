import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { sendOnboardingToken } from "../ats/ats.onboarding.service.js";
import { sendRejectedEmail } from "../ats/ats.email.service.js";
import { jobRequisitionService } from "../job-requisition/job-requisition.service.js";

// ── Constants ────────────────────────────────────────────────────────────────

// Process list is managed in ats_form_config (hiringProcessOptions) — no hardcoded enum here.
const VALID_DECISIONS = ["Selected", "Rejected", "Hold", "Client Round - Pending", "No Show"] as const;
const VALID_STAGES = ["Arrival", "Round 1- HR Screening", "Interview - Skill Test", "Round 2- Op's", "Round 3- Client", "Selection Discussion"] as const;

const STAGE_RANK: Record<string, number> = {
  Arrival: 0,
  "Round 1- HR Screening": 1,
  "Interview - Skill Test": 2,
  "Round 2- Op's": 3,
  "Round 3- Client": 4,
  "Selection Discussion": 5,
};

const GENERAL_VOC_OPTIONS = new Set([
  "Undergraduate / Qualification Issue",
  "Poor Communication Skill",
  "Poor Reading / Comprehension",
  "Salary Issue",
  "Shift / Timing Issue",
  "Location / Travel Issue",
  "Stability Concern",
  "Documentation Issue",
  "Role / Process Mismatch",
  "Candidate Not Interested",
  "No Show",
  "Age Barrier",
]);

const SKILL_VOC_OPTIONS = new Set([
  "Typing Speed Issue",
  "Typing Accuracy Issue",
  "Pehchan Score Low",
  "Poor Sales Skill",
  "Vocabulary / Grammar Issue",
  "Computer / System Skill Gap",
  "Assessment Incomplete / Failed",
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function err(msg: string, code: number): never {
  throw Object.assign(new Error(msg), { statusCode: code });
}

function requireField(value: unknown, label: string): string {
  const v = String(value ?? "").trim();
  if (!v) err(`${label} is required`, 400);
  return v;
}

function validateEnum<T extends string>(value: unknown, label: string, allowed: readonly T[]): T {
  const v = String(value ?? "").trim() as T;
  if (!allowed.includes(v)) err(`Invalid ${label}: "${v}". Allowed: ${allowed.join(", ")}`, 400);
  return v;
}

function nvl(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s || null;
}

function nvlNum(v: unknown): number | null {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function boolish(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const normalized = String(v ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}

function todayIsoLocal(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeDateInput(value: unknown): string | null {
  const textValue = nvl(value);
  if (!textValue) return null;
  const parsed = new Date(textValue);
  if (Number.isNaN(parsed.getTime())) return textValue;
  return parsed.toISOString().slice(0, 10);
}

// ── Recruiter resolve from JWT ────────────────────────────────────────────────

/**
 * Resolves the recruiter profile linked to the given auth_user.id.
 * Uses the chain: employees.user_id → employees.id → ats_recruiter_roster.employee_id.
 * Returns null if no recruiter row is linked to this user.
 */
export async function resolveRecruiterForActor(userId: string): Promise<RecruiterProfile | null> {
  const [rows] = await db.execute<RecruiterRosterRow[]>(
    `SELECT r.id, r.name, r.recruiter_code, r.email, r.branch, r.employee_id
       FROM ats_recruiter_roster r
       JOIN employees e ON e.id = r.employee_id
      WHERE e.user_id = ? AND r.active_status = 1
      LIMIT 1`,
    [userId]
  );
  let rec = rows[0];
  if (!rec) {
    const [fallbackRows] = await db.execute<RecruiterRosterRow[]>(
      `SELECT r.id, r.name, r.recruiter_code, r.email, r.branch, r.employee_id
         FROM auth_user u
         LEFT JOIN employees e ON e.user_id = u.id
         JOIN ats_recruiter_roster r
           ON r.active_status = 1
          AND (
            LOWER(r.email) = LOWER(u.email)
            OR r.employee_id = e.id
            OR r.recruiter_code = e.employee_code
          )
        WHERE u.id = ?
        ORDER BY CASE
          WHEN r.employee_id = e.id THEN 0
          WHEN LOWER(r.email) = LOWER(u.email) THEN 1
          ELSE 2
        END
        LIMIT 1`,
      [userId]
    );
    rec = fallbackRows[0];
  }
  if (!rec) return null;
  return {
    id: rec.id,
    name: rec.name || "Recruiter",
    recruiterCode: rec.recruiter_code ?? "",
    branch: rec.branch ?? "",
    email: rec.email ?? null,
    employeeId: rec.employee_id ?? null,
  };
}

// ── Recruiter verify ──────────────────────────────────────────────────────────

export interface RecruiterProfile {
  id: string;
  name: string;
  recruiterCode: string;
  branch: string;
  email: string | null;
  employeeId: string | null;
}

export async function verifyRecruiter(recruiterCode: string, pin: string): Promise<RecruiterProfile> {
  if (!recruiterCode || !pin) err("Recruiter Code and PIN are required", 400);

  const [rows] = await db.execute<RecruiterRosterRow[]>(
    `SELECT id, name, recruiter_code, pin_hash, email, branch, employee_id, active_status
     FROM ats_recruiter_roster WHERE recruiter_code = ? LIMIT 1`,
    [recruiterCode.trim()]
  );
  const rec = rows[0];
  if (!rec) err("Invalid recruiter credentials", 401);
  if (!rec.active_status) err("Recruiter account is inactive", 403);

  const pinMatch = rec.pin_hash ? await bcrypt.compare(pin, rec.pin_hash) : false;
  if (!pinMatch) err("Invalid recruiter credentials", 401);

  // Biometric availability check
  if (rec.employee_id) {
    const [bioRows] = await db.execute<RowDataPacket[]>(
      `SELECT first_punch_in FROM biometric_attendance_log
       WHERE employee_id = ? AND punch_date = CURDATE() AND first_punch_in IS NOT NULL LIMIT 1`,
      [rec.employee_id]
    );
    if (!bioRows.length) {
      err("Recruiter is not marked available today (no biometric punch-in found)", 403);
    }
  } else {
    // Fall back to the roster flag when no employee_id is set
    if (rec.available_today !== "Y") {
      err("Recruiter is not marked available today", 403);
    }
  }

  return {
    id: rec.id,
    name: rec.name || "Recruiter",
    recruiterCode: rec.recruiter_code ?? "",
    branch: rec.branch ?? "",
    email: rec.email ?? null,
    employeeId: rec.employee_id ?? null,
  };
}

// ── Scoped pending-candidate list ─────────────────────────────────────────────

export interface PendingCandidate {
  candidateId: string;
  candidateCode: string;
  fullName: string;
  mobile: string;
  qToken: string | null;
  process: string | null;
  branch: string | null;
  pendingMinutes: number;
  status: string;
  recruiterAssignedName?: string | null;
}

export async function getMyPendingCandidates(recruiterName?: string): Promise<PendingCandidate[]> {
  const params: unknown[] = [];
  const recruiterClause = recruiterName ? "AND recruiter_assigned_name = ?" : "";
  if (recruiterName) params.push(recruiterName);
  const [rows] = await db.execute<PendingCandidateRow[]>(
    `SELECT
       id,
       candidate_code,
       full_name,
       mobile,
       q_token,
       applied_for_process,
       applied_for_branch,
       COALESCE(status, current_stage, 'Waiting') AS status,
       recruiter_assigned_name,
       TIMESTAMPDIFF(MINUTE,
         CONCAT(COALESCE(created_date, DATE(created_at)), ' ', COALESCE(created_time, TIME(created_at))),
         CONVERT_TZ(NOW(), '+00:00', '+05:30')
       ) AS pending_minutes
     FROM ats_candidate
     WHERE active_status = 1
       ${recruiterClause}
       AND (status = 'Waiting' OR (status IS NULL AND current_stage IN ('New', 'Applied', 'Screening', 'Registered')))
     ORDER BY pending_minutes DESC`,
    params
  );
  return rows.map((r) => ({
    candidateId: r.id,
    candidateCode: r.candidate_code ?? r.id,
    fullName: r.full_name ?? "Candidate",
    mobile: r.mobile ?? "",
    qToken: r.q_token ?? null,
    process: r.applied_for_process ?? null,
    branch: r.applied_for_branch ?? null,
    pendingMinutes: Number(r.pending_minutes ?? 0),
    status: r.status ?? "Waiting",
    recruiterAssignedName: (r as any).recruiter_assigned_name ?? null,
  }));
}

// ── Submission history ────────────────────────────────────────────────────────

export async function getSubmissionHistory(recruiterCode?: string | null, _rosterId?: string | null, _userId?: string | null) {
  if (!recruiterCode) return [];
  const params = [recruiterCode];
  const [rows] = await db.execute<SubmissionHistoryRow[]>(
    `SELECT s.*, c.full_name, c.candidate_code, c.mobile, c.email,
            ob.status AS onboarding_status,
            ob.onboarding_token_expires_at,
            ob.joining_date AS onboarding_joining_date
     FROM ats_interview_submission s
     JOIN ats_candidate c ON c.id = s.candidate_id
     LEFT JOIN ats_onboarding_bridge ob ON ob.candidate_id = s.candidate_id
     WHERE s.recruiter_code = ?
     ORDER BY s.submitted_at DESC
     LIMIT 200`,
    params
  );
  return rows;
}

export async function getRecruiterDailyStats(
  recruiterName: string,
  recruiterCode?: string | null,
): Promise<Record<string, unknown>> {
  const filters: string[] = [];
  const params: unknown[] = [];

  if (recruiterCode) {
    filters.push("s.recruiter_code = ?");
    params.push(recruiterCode);
  }

  if (recruiterName) {
    filters.push(`EXISTS (
      SELECT 1
      FROM ats_candidate c
      WHERE c.id = s.candidate_id
        AND COALESCE(c.recruiter_assigned_name, c.recruiter_name) = ?
    )`);
    params.push(recruiterName);
  }

  if (filters.length === 0) {
    return { total_submissions: 0, selected_count: 0, rejected_count: 0 };
  }

  const [rows] = await db.execute<DailyStatsRow[]>(
    `SELECT
       COUNT(*) AS total_today,
       SUM(CASE WHEN s.final_decision = 'Selected' THEN 1 ELSE 0 END) AS selected_today,
       SUM(CASE WHEN s.final_decision = 'Rejected' THEN 1 ELSE 0 END) AS rejected_today,
       SUM(CASE WHEN s.final_decision = 'No Show' THEN 1 ELSE 0 END) AS noshow_today,
       SUM(CASE WHEN s.final_decision = 'Hold' THEN 1 ELSE 0 END) AS hold_today,
       ROUND((SUM(CASE WHEN s.final_decision = 'Selected' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0)), 1) AS conversion_rate
     FROM ats_interview_submission s
     WHERE (${filters.join(" OR ")}) AND DATE(s.submitted_at) = CURDATE()`,
    params,
  );
  return rows[0] ?? { total_today: 0, selected_today: 0, rejected_today: 0, noshow_today: 0, hold_today: 0, conversion_rate: 0 };
}

// ── Other-recruiters pending candidates (for substitute flow) ─────────────────

export async function getOtherRecruitersPendingCandidates(
  excludeRecruiterName: string,
  branch: string
): Promise<PendingCandidate[]> {
  const [rows] = await db.execute<PendingCandidateRow[]>(
    `SELECT
       id,
       candidate_code,
       full_name,
       mobile,
       q_token,
       applied_for_process,
       applied_for_branch,
       status,
       recruiter_assigned_name,
       TIMESTAMPDIFF(MINUTE,
         CONCAT(COALESCE(created_date, DATE(created_at)), ' ', COALESCE(created_time, TIME(created_at))),
         CONVERT_TZ(NOW(), '+00:00', '+05:30')
       ) AS pending_minutes
     FROM ats_candidate
     WHERE active_status = 1
       AND status = 'Waiting'
       AND recruiter_assigned_name IS NOT NULL
       AND recruiter_assigned_name != ''
       AND recruiter_assigned_name != ?
       AND applied_for_branch = ?
     ORDER BY pending_minutes DESC`,
    [excludeRecruiterName, branch]
  );
  return rows.map((r) => ({
    candidateId: r.id,
    candidateCode: r.candidate_code ?? r.id,
    fullName: r.full_name ?? "Candidate",
    mobile: r.mobile ?? "",
    qToken: r.q_token ?? null,
    process: r.applied_for_process ?? null,
    branch: r.applied_for_branch ?? null,
    pendingMinutes: Number(r.pending_minutes ?? 0),
    status: r.status ?? "Waiting",
    recruiterAssignedName: (r as any).recruiter_assigned_name ?? null,
  }));
}

// ── Formal HR reassignment ────────────────────────────────────────────────────

export async function reassignCandidate(
  candidateId: string,
  newRecruiterId: string,
  reason: string,
  actorEmail: string
): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, recruiter_id, recruiter_assigned_id, recruiter_assigned_name
       FROM ats_candidate WHERE id = ? LIMIT 1`,
    [candidateId]
  );
  if (!rows.length) err("Candidate not found", 404);
  const candidate = rows[0] as { id: string; recruiter_id?: string | null; recruiter_assigned_id?: string | null; recruiter_assigned_name?: string | null };

  const [recRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, name FROM ats_recruiter_roster WHERE id = ? AND active_status = 1 LIMIT 1`,
    [newRecruiterId]
  );
  if (!recRows.length) err("Target recruiter not found or inactive", 404);
  const newRec = recRows[0] as { id: string; name: string };

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE ats_candidate
         SET recruiter_id = ?,
             recruiter_assigned_id = ?,
             recruiter_assigned_name = ?,
             recruiter_assigned_at = NOW()
       WHERE id = ?`,
      [newRec.id, newRec.id, newRec.name, candidateId]
    );
    await conn.execute(
      `INSERT INTO ats_recruiter_assignment_log
         (id, candidate_id, old_recruiter_id, new_recruiter_id, assignment_reason, assigned_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        candidateId,
        candidate.recruiter_assigned_id ?? candidate.recruiter_id ?? null,
        newRec.id,
        reason || "HR reassignment",
        actorEmail,
      ]
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ── Validation ────────────────────────────────────────────────────────────────

interface SubmissionInput {
  candidateId?: string;
  qToken?: string;
  interviewedForProcess?: string;
  walkinEndStage?: string;
  finalDecision?: string;
  round1Result?: string;
  round1Voc?: string;
  round1Remarks?: string;
  skillTestTyping?: unknown;
  skillTestAi?: unknown;
  skillTestResult?: string;
  skillTestVoc?: string;
  skillTestRemarks?: string;
  round2Result?: string;
  round2Voc?: string;
  round2Remarks?: string;
  round3Result?: string;
  round3Voc?: string;
  round3Remarks?: string;
  secondRoundInterviewerId?: string;
  secondRoundInterviewerNameSnapshot?: string;
  secondRoundInterviewerBranchSnapshot?: string;
  secondRoundInterviewerDesignationSnapshot?: string;
  secondRoundInterviewerOverrideReason?: string;
  clientRoundConducted?: unknown;
  clientRoundInterviewerName?: string;
  clientRoundResult?: string;
  clientRoundRemarks?: string;
  followupRequired?: unknown;
  followupDate?: string;
  followupReason?: string;
  hiringSourceSnapshot?: string;
  refereeEmployeeCodeSnapshot?: string;
  refereeNameSnapshot?: string;
  callingActivityId?: string;
  candidateCalledAt?: string;
  interviewStartedAt?: string;
  callingSourceSnapshot?: string;
  callingLastRemarks?: string;
  callingLineupDate?: string;
  callingTurnupStatus?: string;
  offerSalary?: unknown;
  offerDoj?: string;
  reportingTiming?: string;
  otDetails?: string;
  performanceIncentives?: string;
  substituteFlag?: boolean;
  substituteReason?: string;
  requisitionId?: string;
}

interface RecruiterRosterRow extends RowDataPacket {
  id: string;
  name: string;
  recruiter_code?: string | null;
  pin_hash?: string | null;
  email?: string | null;
  branch?: string | null;
  employee_id?: string | null;
  active_status?: number | boolean;
  available_today?: string | null;
}

interface PendingCandidateRow extends RowDataPacket {
  id: string;
  candidate_code: string | null;
  full_name: string | null;
  mobile: string | null;
  q_token: string | null;
  applied_for_process: string | null;
  applied_for_branch: string | null;
  status: string | null;
  pending_minutes: number | null;
  recruiter_assigned_name?: string | null;
}

interface SubmissionHistoryRow extends RowDataPacket {
  id: string;
  full_name?: string | null;
  candidate_code?: string | null;
  mobile?: string | null;
  email?: string | null;
  onboarding_status?: string | null;
  onboarding_token_expires_at?: string | null;
  onboarding_joining_date?: string | null;
}

interface DailyStatsRow extends RowDataPacket {
  total_today: number | null;
  selected_today: number | null;
  rejected_today: number | null;
  noshow_today: number | null;
  hold_today: number | null;
  conversion_rate: number | null;
}

interface InterviewCandidateRow extends RowDataPacket {
  id: string;
  candidate_code?: string | null;
  full_name?: string | null;
  email?: string | null;
  recruiter_id?: string | null;
  recruiter_assigned_id?: string | null;
  assigned_recruiter_id?: string | null;
  recruiter_assigned_name?: string | null;
  applied_for_branch?: string | null;
  branch_display_name?: string | null;
  sourcing_channel?: string | null;
  latest_calling_activity_id?: string | null;
  calling_source_snapshot?: string | null;
  calling_last_remarks?: string | null;
  calling_lineup_date?: string | null;
  calling_turnup_status?: string | null;
  referee_employee_code?: string | null;
  referee_name?: string | null;
  q_token?: string | null;
  current_stage?: string | null;
  status?: string | null;
  created_date?: string | null;
  created_time?: string | null;
  branch_name?: string | null;
}

interface InterviewerRow extends RowDataPacket {
  id: string;
  interviewer_name?: string | null;
  branch_name?: string | null;
  designation_name?: string | null;
}

interface ExistingSubmissionRow extends RowDataPacket {
  id: string;
  submitted_at?: string | null;
  walkin_end_stage?: string | null;
  final_decision?: string | null;
}

interface SubmissionResultRow extends RowDataPacket {
  id: string;
}

function validateSubmission(input: SubmissionInput) {
  // Mandatory fields
  const process = requireField(input.interviewedForProcess, "Interviewed for Process");
  const finalDecision = requireField(input.finalDecision, "Final Decision");
  const walkinEndStage = requireField(input.walkinEndStage, "Walk-in End Stage");
  const clientRoundConducted = boolish(input.clientRoundConducted);
  const followupRequired = boolish(input.followupRequired) || finalDecision === "Client Round - Pending" || finalDecision === "Hold";

  validateEnum(finalDecision, "Final Decision", VALID_DECISIONS);

  if (!VALID_STAGES.includes(walkinEndStage as (typeof VALID_STAGES)[number]))
    err(`Invalid Walk-in End Stage: "${walkinEndStage}". Allowed: ${VALID_STAGES.join(", ")}`, 400);

  const rank = STAGE_RANK[walkinEndStage] ?? -1;

  // Round 1 mandatory from rank 1+
  if (rank >= 1) {
    requireField(input.round1Result, "Round1 Result");
    if (input.round1Result === "Rejected") {
      const voc = nvl(input.round1Voc);
      if (!voc) err("Round1 VOC is required when Round1 Result is Rejected", 400);
      if (!GENERAL_VOC_OPTIONS.has(voc!))
        err(`Invalid Round1 VOC: "${voc}". Must be one of the allowed General VOC options.`, 400);
    }
  }

  // Skill Test VOC mandatory only when Skill Test Result = Rejected
  if (nvl(input.skillTestResult) === "Rejected") {
    const svoc = nvl(input.skillTestVoc);
    if (!svoc) err("SkillTest VOC is required when SkillTest Result is Rejected", 400);
    if (!SKILL_VOC_OPTIONS.has(svoc!))
      err(`Invalid SkillTest VOC: "${svoc}". Must be one of the allowed Skill VOC options.`, 400);
  }

  // Round 2 mandatory from rank 3+
  if (rank >= 3) {
    requireField(input.round2Result, "Round2 Result");
    requireField(input.secondRoundInterviewerId, "Second Round Interviewer");
    if (input.round2Result === "Rejected") {
      const voc = nvl(input.round2Voc);
      if (!voc) err("Round2 VOC is required when Round2 Result is Rejected", 400);
      if (!GENERAL_VOC_OPTIONS.has(voc!))
        err(`Invalid Round2 VOC: "${voc}". Must be one of the allowed General VOC options.`, 400);
    }
  }

  // Round 3 mandatory from rank 4+
  if (rank >= 4) {
    requireField(input.round3Result, "Round3 Result");
    if (input.round3Result === "Rejected") {
      const voc = nvl(input.round3Voc);
      if (!voc) err("Round3 VOC is required when Round3 Result is Rejected", 400);
      if (!GENERAL_VOC_OPTIONS.has(voc!))
      err(`Invalid Round3 VOC: "${voc}". Must be one of the allowed General VOC options.`, 400);
    }
  }

  const clientRoundPayloadPresent =
    clientRoundConducted ||
    !!nvl(input.clientRoundInterviewerName) ||
    !!nvl(input.clientRoundResult) ||
    !!nvl(input.clientRoundRemarks);
  if (clientRoundPayloadPresent && !nvl(input.clientRoundInterviewerName)) {
    err("Client Round Interviewer Name is required when client round details are captured", 400);
  }
  if (followupRequired) {
    const followupDate = nvl(input.followupDate);
    const followupReason = nvl(input.followupReason);
    if (!followupDate) err("Follow-up Date is required when follow-up is required", 400);
    if (!followupReason) err("Follow-up Reason is required when follow-up is required", 400);
  }

  // Selected requires salary, DOJ, reporting timing; cascades round results
  let r1 = nvl(input.round1Result);
  let r2 = nvl(input.round2Result);
  let r3 = nvl(input.round3Result);

  if (finalDecision === "Selected") {
    if (rank >= 1) r1 = "Selected";
    if (rank >= 3) r2 = "Selected";
    if (rank >= 4) r3 = "Selected";
    requireField(input.offerSalary, "Offer Salary");
    requireField(input.offerDoj, "Date of Joining");
    requireField(input.reportingTiming, "Reporting Timing");
    const offerDoj = nvl(input.offerDoj);
    if (offerDoj && offerDoj < todayIsoLocal()) {
      err("Date of Joining cannot be in the past", 400);
    }
  }

  return { process, finalDecision, walkinEndStage, rank, r1, r2, r3, clientRoundConducted, followupRequired };
}

// ── Submit interview update ───────────────────────────────────────────────────

export async function submitInterviewUpdate(
  raw: Record<string, unknown>,
  actorUserId: string | undefined,
  recruiterProfile: RecruiterProfile
) {
  const input: SubmissionInput = {
    candidateId: String(raw.candidateId || raw.CandidateID || raw["Candidate ID"] || "").trim() || undefined,
    qToken: String(raw.qToken || raw.QToken || raw["Q Token"] || "").trim() || undefined,
    interviewedForProcess: String(raw.interviewedForProcess || raw["Interviewed for Process"] || "").trim() || undefined,
    walkinEndStage: String(raw.walkinEndStage || raw["Walk-in End Stage"] || raw.walkin_end_stage || "").trim() || undefined,
    finalDecision: String(raw.finalDecision || raw.FinalDecision || raw["Final Decision"] || "").trim() || undefined,
    round1Result: String(raw.round1Result || raw.Round1_Result || raw["Round1 Result"] || "").trim() || undefined,
    round1Voc: String(raw.round1Voc || raw.Round1_VOC || raw["Round1 VOC"] || "").trim() || undefined,
    round1Remarks: String(raw.round1Remarks || raw["Round1 Remarks"] || "").trim() || undefined,
    skillTestTyping: raw.skillTestTyping ?? raw["SkillTest Typing Score (WPM/Accuracy%)"] ?? null,
    skillTestAi: raw.skillTestAi ?? raw["SkillTest AI Score"] ?? null,
    skillTestResult: String(raw.skillTestResult || raw["SkillTest Result"] || "").trim() || undefined,
    skillTestVoc: String(raw.skillTestVoc || raw["SkillTest VOC"] || "").trim() || undefined,
    skillTestRemarks: String(raw.skillTestRemarks || raw["SkillTest Remarks"] || "").trim() || undefined,
    round2Result: String(raw.round2Result || raw["Round2 Result"] || "").trim() || undefined,
    round2Voc: String(raw.round2Voc || raw["Round2 VOC"] || "").trim() || undefined,
    round2Remarks: String(raw.round2Remarks || raw["Round2 Remarks"] || "").trim() || undefined,
    round3Result: String(raw.round3Result || raw["Round3 Result"] || "").trim() || undefined,
    round3Voc: String(raw.round3Voc || raw["Round3 VOC"] || "").trim() || undefined,
    round3Remarks: String(raw.round3Remarks || raw["Round3 Remarks"] || "").trim() || undefined,
    secondRoundInterviewerId: String(raw.secondRoundInterviewerId || raw["Second Round Interviewer ID"] || raw.second_round_interviewer_id || "").trim() || undefined,
    secondRoundInterviewerNameSnapshot: String(raw.secondRoundInterviewerNameSnapshot || raw["Second Round Interviewer Name"] || raw.second_round_interviewer_name_snapshot || "").trim() || undefined,
    secondRoundInterviewerBranchSnapshot: String(raw.secondRoundInterviewerBranchSnapshot || raw["Second Round Interviewer Branch"] || raw.second_round_interviewer_branch_snapshot || "").trim() || undefined,
    secondRoundInterviewerDesignationSnapshot: String(raw.secondRoundInterviewerDesignationSnapshot || raw["Second Round Interviewer Designation"] || raw.second_round_interviewer_designation_snapshot || "").trim() || undefined,
    secondRoundInterviewerOverrideReason: String(raw.secondRoundInterviewerOverrideReason || raw["Second Round Interviewer Override Reason"] || raw.second_round_interviewer_override_reason || "").trim() || undefined,
    clientRoundConducted: raw.clientRoundConducted ?? raw["Client Round Conducted"] ?? raw.client_round_conducted ?? undefined,
    clientRoundInterviewerName: String(raw.clientRoundInterviewerName || raw["Client Round Interviewer Name"] || raw.client_round_interviewer_name || "").trim() || undefined,
    clientRoundResult: String(raw.clientRoundResult || raw["Client Round Result"] || raw.client_round_result || "").trim() || undefined,
    clientRoundRemarks: String(raw.clientRoundRemarks || raw["Client Round Remarks"] || raw.client_round_remarks || "").trim() || undefined,
    followupRequired: raw.followupRequired ?? raw["Follow-up Required"] ?? raw.followup_required ?? undefined,
    followupDate: String(raw.followupDate || raw["Follow-up Date"] || raw.followup_date || "").trim() || undefined,
    followupReason: String(raw.followupReason || raw["Follow-up Reason"] || raw.followup_reason || "").trim() || undefined,
    hiringSourceSnapshot: String(raw.hiringSourceSnapshot || raw["Hiring Source Snapshot"] || raw.hiring_source_snapshot || "").trim() || undefined,
    refereeEmployeeCodeSnapshot: String(raw.refereeEmployeeCodeSnapshot || raw["Referee Employee Code Snapshot"] || raw.referee_employee_code_snapshot || "").trim() || undefined,
    refereeNameSnapshot: String(raw.refereeNameSnapshot || raw["Referee Name Snapshot"] || raw.referee_name_snapshot || "").trim() || undefined,
    callingActivityId: String(raw.callingActivityId || raw["Calling Activity ID"] || raw.calling_activity_id || "").trim() || undefined,
    candidateCalledAt: String(raw.candidateCalledAt || raw["Candidate Called At"] || raw.candidate_called_at || "").trim() || undefined,
    interviewStartedAt: String(raw.interviewStartedAt || raw["Interview Started At"] || raw.interview_started_at || "").trim() || undefined,
    callingSourceSnapshot: String(raw.callingSourceSnapshot || raw["Calling Source Snapshot"] || raw.calling_source_snapshot || "").trim() || undefined,
    callingLastRemarks: String(raw.callingLastRemarks || raw["Calling Last Remarks"] || raw.calling_last_remarks || "").trim() || undefined,
    callingLineupDate: String(raw.callingLineupDate || raw["Calling Lineup Date"] || raw.calling_lineup_date || "").trim() || undefined,
    callingTurnupStatus: String(raw.callingTurnupStatus || raw["Calling Turnup Status"] || raw.calling_turnup_status || "").trim() || undefined,
    offerSalary: raw.offerSalary ?? raw["Offer Salary"] ?? null,
    offerDoj: String(raw.offerDoj || raw["Date of Joining"] || "").trim() || undefined,
    reportingTiming: String(raw.reportingTiming || raw["Reporting Timing"] || "").trim() || undefined,
    otDetails: String(raw.otDetails || raw["OT Details"] || "").trim() || undefined,
    performanceIncentives: String(raw.performanceIncentives || raw["Performance Incentives"] || "").trim() || undefined,
    requisitionId: String(raw.requisitionId || "").trim() || undefined,
  };

  if (!input.candidateId && !input.qToken) err("CandidateID or QToken required", 400);

  // Validate all fields — throws on any violation
  const { process, finalDecision, walkinEndStage, r1, r2, r3 } = validateSubmission(input);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Lock the candidate row
    const whereClause = input.candidateId
      ? "(c.id = ? OR c.candidate_code = ?)"
      : "c.q_token = ?";
    const whereParams: unknown[] = input.candidateId
      ? [input.candidateId, input.candidateId]
      : [input.qToken ?? ""];

    const [candRows] = await conn.execute<InterviewCandidateRow[]>(
      `SELECT c.id, c.candidate_code, c.full_name, c.email,
              c.recruiter_id, c.recruiter_assigned_id, c.assigned_recruiter_id, c.recruiter_assigned_name,
              c.applied_for_branch, c.branch_display_name, c.sourcing_channel, c.latest_calling_activity_id,
              c.calling_source_snapshot, c.calling_last_remarks, c.calling_lineup_date, c.calling_turnup_status,
              c.referee_employee_code, c.referee_name,
              c.q_token, c.current_stage, c.status, c.created_date, c.created_time
       FROM ats_candidate c
       WHERE ${whereClause}
       LIMIT 1
       FOR UPDATE`,
      whereParams as string[]
    );
    const candidate = candRows[0];
    if (!candidate) err("Candidate not found", 404);

    // Ownership check — allow substitute with explicit flag + reason
    const assignedRecruiterIds = [
      candidate.recruiter_id,
      candidate.recruiter_assigned_id,
      candidate.assigned_recruiter_id,
    ].filter(Boolean).map(String);
    const assignedById = assignedRecruiterIds.length > 0 && assignedRecruiterIds.includes(String(recruiterProfile.id));
    const assignedByName = candidate.recruiter_assigned_name && candidate.recruiter_assigned_name === recruiterProfile.name;
    if ((assignedRecruiterIds.length > 0 || candidate.recruiter_assigned_name) && !assignedById && !assignedByName) {
      if (!input.substituteFlag || !input.substituteReason?.trim()) {
        err("This candidate is assigned to a different recruiter. Provide a substitute reason to proceed.", 403);
      }
    }

    // QToken consistency: if we matched by candidateId, ensure qToken (if given) belongs to this candidate
    if (input.qToken && input.candidateId && candidate.q_token && candidate.q_token !== input.qToken) {
      err("QToken does not match this candidate", 409);
    }

    const effectiveQToken = candidate.q_token ?? input.qToken ?? null;

    // Check for existing submission (upsert) — q_token may be NULL
    const candidateBranch = candidate.branch_display_name ?? candidate.applied_for_branch ?? null;

    let secondRoundInterviewerSnapshot: {
      id: string;
      name: string;
      branch: string | null;
      designation: string | null;
    } | null = null;
    if (nvl(input.secondRoundInterviewerId)) {
      const [interviewerRows] = await conn.execute<InterviewerRow[]>(
        `SELECT e.id,
                COALESCE(NULLIF(TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))), ''), e.full_name, e.employee_code) AS interviewer_name,
                COALESCE(b.branch_name, b.branch_code) AS branch_name,
                des.designation_name AS designation_name
           FROM employees e
           LEFT JOIN branch_master b ON b.id = e.branch_id
           LEFT JOIN designation_master des ON des.id = e.designation_id
          WHERE e.id = ?
          LIMIT 1`,
        [String(input.secondRoundInterviewerId)]
      );
      const interviewer = interviewerRows[0];
      if (!interviewer) err("Second round interviewer not found", 404);
      const interviewerBranch = nvl(interviewer.branch_name);
      const recruiterBranch = recruiterProfile.branch?.trim().toLowerCase().replace(/\s+/g, " ");
      const normalizedInterviewerBranch = interviewerBranch?.trim().toLowerCase().replace(/\s+/g, " ");
      if (recruiterBranch && normalizedInterviewerBranch && recruiterBranch !== normalizedInterviewerBranch) {
        err("Second round interviewer must be from the same branch as the recruiter", 400);
      }
      secondRoundInterviewerSnapshot = {
        id: String(interviewer.id),
        name: String(interviewer.interviewer_name ?? "").trim(),
        branch: interviewerBranch,
        designation: nvl(interviewer.designation_name),
      };
    }

    const [existingRows] = await conn.execute<ExistingSubmissionRow[]>(
      effectiveQToken
        ? `SELECT id, submitted_at, walkin_end_stage, final_decision
           FROM ats_interview_submission
           WHERE candidate_id = ? AND q_token = ?
           LIMIT 1 FOR UPDATE`
        : `SELECT id, submitted_at, walkin_end_stage, final_decision
           FROM ats_interview_submission
           WHERE candidate_id = ? AND q_token IS NULL
           LIMIT 1 FOR UPDATE`,
      effectiveQToken ? [candidate.id, effectiveQToken] : [candidate.id]
    );
    const existing = existingRows[0] ?? null;

    const submissionId = existing?.id ?? randomUUID();
    const isUpdate = !!existing;
    const clientRoundConductedFlag = boolish(input.clientRoundConducted) ? 1 : 0;
    const followupRequiredFlag = boolish(input.followupRequired) || finalDecision === "Client Round - Pending" || finalDecision === "Hold" ? 1 : 0;
    const secondRoundInterviewerId = secondRoundInterviewerSnapshot?.id ?? nvl(input.secondRoundInterviewerId);
    const secondRoundInterviewerNameSnapshot = secondRoundInterviewerSnapshot?.name ?? nvl(input.secondRoundInterviewerNameSnapshot);
    const secondRoundInterviewerBranchSnapshot = secondRoundInterviewerSnapshot?.branch ?? nvl(input.secondRoundInterviewerBranchSnapshot);
    const secondRoundInterviewerDesignationSnapshot = secondRoundInterviewerSnapshot?.designation ?? nvl(input.secondRoundInterviewerDesignationSnapshot);
    const secondRoundInterviewerOverrideReason = nvl(input.secondRoundInterviewerOverrideReason);
    const clientRoundInterviewerName = nvl(input.clientRoundInterviewerName);
    const clientRoundResult = nvl(input.clientRoundResult);
    const clientRoundRemarks = nvl(input.clientRoundRemarks);
    const followupDate = normalizeDateInput(input.followupDate);
    const followupReason = nvl(input.followupReason);
    const hiringSourceSnapshot = nvl(input.hiringSourceSnapshot) ?? candidate.sourcing_channel ?? null;
    const refereeEmployeeCodeSnapshot = nvl(input.refereeEmployeeCodeSnapshot) ?? candidate.referee_employee_code ?? null;
    const refereeNameSnapshot = nvl(input.refereeNameSnapshot) ?? candidate.referee_name ?? null;
    const callingActivityId = nvl(input.callingActivityId) ?? candidate.latest_calling_activity_id ?? null;
    const candidateCalledAt = nvl(input.candidateCalledAt) ?? null;
    const interviewStartedAt = nvl(input.interviewStartedAt) ?? null;
    const callingSourceSnapshot = nvl(input.callingSourceSnapshot) ?? candidate.calling_source_snapshot ?? null;
    const callingLastRemarks = nvl(input.callingLastRemarks) ?? candidate.calling_last_remarks ?? null;
    const callingLineupDate = nvl(input.callingLineupDate) ?? candidate.calling_lineup_date ?? null;
    const callingTurnupStatus = nvl(input.callingTurnupStatus) ?? candidate.calling_turnup_status ?? null;
    const substituteInterviewerId = input.substituteFlag && input.substituteReason?.trim() ? recruiterProfile.id : null;
    const substituteReason = input.substituteFlag && input.substituteReason?.trim() ? input.substituteReason.trim() : null;

    if (isUpdate) {
      await conn.execute(
        `UPDATE ats_interview_submission SET
           recruiter_user_id = ?,
           recruiter_code = ?,
           interviewed_for_process = ?,
           walkin_end_stage = ?,
           final_decision = ?,
           round1_result = ?,
           round1_voc = ?,
           round1_remarks = ?,
           skilltest_typing = ?,
           skilltest_ai = ?,
           skilltest_result = ?,
           skilltest_voc = ?,
           skilltest_remarks = ?,
           round2_result = ?,
           round2_voc = ?,
           round2_remarks = ?,
           round3_result = ?,
           round3_voc = ?,
           round3_remarks = ?,
           second_round_interviewer_id = ?,
           second_round_interviewer_name_snapshot = ?,
           second_round_interviewer_branch_snapshot = ?,
           second_round_interviewer_designation_snapshot = ?,
           second_round_interviewer_override_reason = ?,
           client_round_conducted = ?,
           client_round_interviewer_name = ?,
           client_round_result = ?,
           client_round_remarks = ?,
           followup_required = ?,
           followup_date = ?,
           followup_reason = ?,
           hiring_source_snapshot = ?,
           referee_employee_code_snapshot = ?,
           referee_name_snapshot = ?,
           calling_activity_id = ?,
           candidate_called_at = ?,
           interview_started_at = ?,
           calling_source_snapshot = ?,
           calling_last_remarks = ?,
           calling_lineup_date = ?,
           calling_turnup_status = ?,
           offer_salary = ?,
           offer_doj = ?,
           reporting_timing = ?,
           ot_details = ?,
           performance_incentives = ?,
           substitute_interviewer_id = COALESCE(?, substitute_interviewer_id),
           substitute_reason = COALESCE(?, substitute_reason),
           previous_submitted_time = submitted_at,
           last_walkin_end_stage = walkin_end_stage,
           last_final_decision = final_decision,
           updated_at = NOW()
         WHERE id = ?`,
        [
          actorUserId ?? null,
          recruiterProfile.recruiterCode,
          process,
          walkinEndStage,
          finalDecision,
          r1,
          nvl(input.round1Voc),
          nvl(input.round1Remarks),
          nvlNum(input.skillTestTyping),
          nvlNum(input.skillTestAi),
          nvl(input.skillTestResult),
          nvl(input.skillTestVoc),
          nvl(input.skillTestRemarks),
          r2,
          nvl(input.round2Voc),
          nvl(input.round2Remarks),
          r3,
          nvl(input.round3Voc),
          nvl(input.round3Remarks),
          secondRoundInterviewerId,
          secondRoundInterviewerNameSnapshot,
          secondRoundInterviewerBranchSnapshot,
          secondRoundInterviewerDesignationSnapshot,
          secondRoundInterviewerOverrideReason,
          clientRoundConductedFlag,
          clientRoundInterviewerName,
          clientRoundResult,
          clientRoundRemarks,
          followupRequiredFlag,
          followupDate,
          followupReason,
          hiringSourceSnapshot,
          refereeEmployeeCodeSnapshot,
          refereeNameSnapshot,
          callingActivityId,
          candidateCalledAt,
          interviewStartedAt,
          callingSourceSnapshot,
          callingLastRemarks,
          callingLineupDate,
          callingTurnupStatus,
          nvlNum(input.offerSalary),
          nvl(input.offerDoj),
          nvl(input.reportingTiming),
          nvl(input.otDetails),
          nvl(input.performanceIncentives),
          substituteInterviewerId,
          substituteReason,
          submissionId,
        ]
      );
    } else {
      await conn.execute(
        `INSERT INTO ats_interview_submission
           (id, candidate_id, q_token, recruiter_user_id, recruiter_code,
            interviewed_for_process, walkin_end_stage, final_decision,
            round1_result, round1_voc, round1_remarks,
            skilltest_typing, skilltest_ai, skilltest_result, skilltest_voc, skilltest_remarks,
            round2_result, round2_voc, round2_remarks,
            round3_result, round3_voc, round3_remarks,
            second_round_interviewer_id, second_round_interviewer_name_snapshot,
            second_round_interviewer_branch_snapshot, second_round_interviewer_designation_snapshot,
            second_round_interviewer_override_reason, client_round_conducted, client_round_interviewer_name,
            client_round_result, client_round_remarks, followup_required, followup_date, followup_reason,
            hiring_source_snapshot, referee_employee_code_snapshot, referee_name_snapshot,
            calling_activity_id, candidate_called_at, interview_started_at, calling_source_snapshot,
            calling_last_remarks, calling_lineup_date, calling_turnup_status,
            offer_salary, offer_doj, reporting_timing, ot_details, performance_incentives,
            substitute_interviewer_id, substitute_reason,
            submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          submissionId,
          candidate.id,
          effectiveQToken,
          actorUserId ?? null,
          recruiterProfile.recruiterCode,
          process,
          walkinEndStage,
          finalDecision,
          r1,
          nvl(input.round1Voc),
          nvl(input.round1Remarks),
          nvlNum(input.skillTestTyping),
          nvlNum(input.skillTestAi),
          nvl(input.skillTestResult),
          nvl(input.skillTestVoc),
          nvl(input.skillTestRemarks),
          r2,
          nvl(input.round2Voc),
          nvl(input.round2Remarks),
          r3,
          nvl(input.round3Voc),
          nvl(input.round3Remarks),
          secondRoundInterviewerId,
          secondRoundInterviewerNameSnapshot,
          secondRoundInterviewerBranchSnapshot,
          secondRoundInterviewerDesignationSnapshot,
          secondRoundInterviewerOverrideReason,
          clientRoundConductedFlag,
          clientRoundInterviewerName,
          clientRoundResult,
          clientRoundRemarks,
          followupRequiredFlag,
          followupDate,
          followupReason,
          hiringSourceSnapshot,
          refereeEmployeeCodeSnapshot,
          refereeNameSnapshot,
          callingActivityId,
          candidateCalledAt,
          interviewStartedAt,
          callingSourceSnapshot,
          callingLastRemarks,
          callingLineupDate,
          callingTurnupStatus,
          nvlNum(input.offerSalary),
          nvl(input.offerDoj),
          nvl(input.reportingTiming),
          nvl(input.otDetails),
          nvl(input.performanceIncentives),
          substituteInterviewerId,
          substituteReason,
        ]
      );
    }

    // Audit row
    const snapshotData = {
      process,
      walkinEndStage,
      finalDecision,
      r1,
      r2,
      r3,
      recruiterCode: recruiterProfile.recruiterCode,
      secondRoundInterviewerId,
      secondRoundInterviewerNameSnapshot,
      secondRoundInterviewerBranchSnapshot,
      clientRoundConducted: clientRoundConductedFlag,
      clientRoundInterviewerName,
      clientRoundResult,
      followupRequired: followupRequiredFlag,
      followupDate,
      hiringSourceSnapshot,
      callingActivityId,
    };
    await conn.execute(
      `INSERT INTO ats_interview_submission_audit (id, submission_id, action, actor_user_id, snapshot)
       VALUES (?, ?, ?, ?, CAST(? AS JSON))`,
      [randomUUID(), submissionId, isUpdate ? "UPDATE" : "INSERT", actorUserId ?? null, JSON.stringify(snapshotData)]
    );

    // Update canonical ATS decision fields only; never touch created_date / created_time.
    const newStatus = finalDecision === "No Show" ? "No Show" : finalDecision;
    await conn.execute(
      `UPDATE ats_candidate SET
         current_stage = ?,
         status = ?,
         final_decision = ?,
         walkin_end_stage = ?,
         round1_result = ?,
         round1_voc = ?,
         round1_remarks = ?,
         skilltest_typing = ?,
         skilltest_ai = ?,
         skilltest_result = ?,
         skilltest_voc = ?,
         skilltest_remarks = ?,
         round2_result = ?,
         round2_voc = ?,
         round2_remarks = ?,
         round3_result = ?,
         round3_voc = ?,
         round3_remarks = ?,
         second_round_interviewer_id = ?,
         second_round_interviewer_name_snapshot = ?,
         second_round_interviewer_branch_snapshot = ?,
         client_round_conducted = ?,
         client_round_interviewer_name = ?,
         client_round_result = ?,
         client_round_remarks = ?,
         followup_required = ?,
         followup_date = ?,
         followup_reason = ?,
         latest_calling_activity_id = ?,
         calling_source_snapshot = ?,
         calling_last_remarks = ?,
         calling_lineup_date = ?,
         calling_turnup_status = ?,
         offer_salary = ?,
         offer_doj = ?,
         reporting_shift = ?,
         offer_performance_incentive = ?,
         profile_status = CASE
           WHEN ? = 'Selected' THEN 'selected'
           ELSE profile_status
         END,
         updated_at = NOW()
       WHERE id = ?`,
      [
        walkinEndStage,
        newStatus,
        finalDecision,
        walkinEndStage,
        r1,
        nvl(input.round1Voc),
        nvl(input.round1Remarks),
        nvlNum(input.skillTestTyping),
        nvlNum(input.skillTestAi),
        nvl(input.skillTestResult),
        nvl(input.skillTestVoc),
        nvl(input.skillTestRemarks),
        r2,
        nvl(input.round2Voc),
        nvl(input.round2Remarks),
        r3,
        nvl(input.round3Voc),
        nvl(input.round3Remarks),
        secondRoundInterviewerId,
        secondRoundInterviewerNameSnapshot,
        secondRoundInterviewerBranchSnapshot,
        clientRoundConductedFlag,
        clientRoundInterviewerName,
        clientRoundResult,
        clientRoundRemarks,
        followupRequiredFlag,
        followupDate,
        followupReason,
        callingActivityId,
        callingSourceSnapshot,
        callingLastRemarks,
        callingLineupDate,
        callingTurnupStatus,
        nvlNum(input.offerSalary),
        nvl(input.offerDoj),
        nvl(input.reportingTiming),
        nvl(input.performanceIncentives),
        finalDecision,
        candidate.id,
      ]
    );

    // Close the queue token so the candidate leaves the live queue display
    await conn.execute(
      `UPDATE ats_queue_token
       SET queue_status = CASE WHEN ? = 'No Show' THEN 'no_show' ELSE 'completed' END,
           interview_completed_at = COALESCE(interview_completed_at, NOW()),
           updated_at = NOW()
       WHERE candidate_id = ?
         AND queue_status IN ('waiting', 'called', 'in_interview')`,
      [finalDecision, candidate.id]
    );

    // Stage log
    await conn.execute(
      `INSERT INTO ats_candidate_stage_log (id, candidate_id, from_stage, to_stage, remarks, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), candidate.id, candidate.current_stage || candidate.status || null, walkinEndStage, nvl(raw.remarks), actorUserId ?? null]
    );

    if ((raw.proxySubmission === true || raw.proxySubmission === "true") && actorUserId) {
      await conn.execute(
        `INSERT INTO ats_interview_submission_audit (id, submission_id, action, actor_user_id, snapshot)
         VALUES (?, ?, 'PROXY_SUBMISSION', ?, CAST(? AS JSON))`,
        [
          randomUUID(),
          submissionId,
          actorUserId,
          JSON.stringify({ proxySubmission: true, recruiterCode: recruiterProfile.recruiterCode, recruiterName: recruiterProfile.name }),
        ]
      );
    }

    // Audit substitute submissions in ats_sensitive_action_log
    if (input.substituteFlag && input.substituteReason && actorUserId) {
      await conn.execute(
        `INSERT INTO ats_sensitive_action_log
           (id, actor_user_id, action_type, entity_type, entity_id, action_details, created_at)
         VALUES (?, ?, 'SUBSTITUTE_INTERVIEW_SUBMISSION', 'ats_interview_submission', ?, CAST(? AS JSON), NOW())`,
        [
          randomUUID(),
          actorUserId,
          submissionId,
          JSON.stringify({
            candidate_id: candidate.id,
            candidate_code: candidate.candidate_code,
            original_recruiter_name: candidate.recruiter_assigned_name,
            substitute_recruiter_code: recruiterProfile.recruiterCode,
            substitute_recruiter_name: recruiterProfile.name,
            substitute_reason: input.substituteReason,
            final_decision: finalDecision,
          }),
        ]
      );
    }

    await conn.commit();

    // Auto-link candidate to the selected requisition/batch (fire-and-forget)
    if (input.requisitionId) {
      jobRequisitionService.linkCandidate(
        input.requisitionId,
        candidate.id,
        actorUserId ?? 'system',
        'candidate_applied',
        'auto-linked at interview feedback submission'
      ).catch((e: unknown) => {
        console.warn('[recruiter-submission auto-link]', e instanceof Error ? e.message : e);
      });
    }

    if (finalDecision === "Selected") {
      console.log(`[ats] Sending onboarding token to candidate ${candidate.id} (${candidate.email || 'NO EMAIL'})`);
      try {
        await sendOnboardingToken(candidate.id, actorUserId ?? "SYSTEM");
        console.log(`[ats] Onboarding token sent successfully to ${candidate.email}`);
      } catch (e) {
        console.error("[ats] automatic onboarding link failed:", e instanceof Error ? e.message : String(e));
      }
    } else if (finalDecision === "Rejected" || finalDecision === "No Show") {
      if (!candidate.email) {
        console.warn(`[ats] Cannot send rejection email - candidate ${candidate.id} has no email address`);
      } else {
        console.log(`[ats] Sending rejection email to ${candidate.email} (candidate ${candidate.id}, decision: ${finalDecision})`);
        sendRejectedEmail({
          candidateId: candidate.id,
          to: candidate.email,
          candidateName: candidate.full_name ?? "Candidate",
          branchName: candidate.branch_display_name ?? candidate.applied_for_branch ?? "",
        }).then(() => {
          console.log(`[ats] Rejection email sent successfully to ${candidate.email}`);
        }).catch((e: unknown) => {
          console.error(`[ats] Rejection email failed for ${candidate.email}:`, e instanceof Error ? e.message : String(e));
        });
      }
    }

    // Fetch updated submission row for response (outside transaction)
    const [subRows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM ats_interview_submission WHERE id = ? LIMIT 1`,
      [submissionId]
    );
    return { submission: subRows[0] ?? null, action: isUpdate ? "updated" : "created" };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
