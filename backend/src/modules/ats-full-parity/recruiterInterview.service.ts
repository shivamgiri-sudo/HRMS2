import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { sendOnboardingToken } from "../ats/ats.onboarding.service.js";
import { sendRejectedEmail } from "../ats/ats.email.service.js";

// ── Constants ────────────────────────────────────────────────────────────────

const VALID_PROCESSES = ["Onfido", "Reginald", "BBB", "GS1", "GPI", "FF", "DRA"] as const;
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

// ── Recruiter resolve from JWT ────────────────────────────────────────────────

/**
 * Resolves the recruiter profile linked to the given auth_user.id.
 * Uses the chain: employees.user_id → employees.id → ats_recruiter_roster.employee_id.
 * Returns null if no recruiter row is linked to this user.
 */
export async function resolveRecruiterForActor(userId: string): Promise<RecruiterProfile | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT r.id, r.name, r.recruiter_code, r.email, r.branch, r.employee_id
       FROM ats_recruiter_roster r
       JOIN employees e ON e.id = r.employee_id
      WHERE e.user_id = ? AND r.active_status = 1
      LIMIT 1`,
    [userId]
  );
  const rec = (rows as any[])[0];
  if (!rec) return null;
  return {
    id: rec.id,
    name: rec.name,
    recruiterCode: rec.recruiter_code,
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

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, name, recruiter_code, pin_hash, email, branch, employee_id, active_status
     FROM ats_recruiter_roster WHERE recruiter_code = ? LIMIT 1`,
    [recruiterCode.trim()]
  );
  const rec = (rows as any[])[0];
  if (!rec) err("Invalid recruiter credentials", 401);
  if (!rec.active_status) err("Recruiter account is inactive", 403);

  const pinMatch = await bcrypt.compare(pin, rec.pin_hash);
  if (!pinMatch) err("Invalid recruiter credentials", 401);

  // Biometric availability check
  if (rec.employee_id) {
    const [bioRows] = await db.execute<RowDataPacket[]>(
      `SELECT first_punch_in FROM biometric_attendance_log
       WHERE employee_id = ? AND punch_date = CURDATE() AND first_punch_in IS NOT NULL LIMIT 1`,
      [rec.employee_id]
    );
    if (!(bioRows as any[]).length) {
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
    name: rec.name,
    recruiterCode: rec.recruiter_code,
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
}

export async function getMyPendingCandidates(recruiterName?: string): Promise<PendingCandidate[]> {
  if (!recruiterName) return [];
  const params: unknown[] = [recruiterName];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       id,
       candidate_code,
       full_name,
       mobile,
       q_token,
       applied_for_process,
       applied_for_branch,
       status,
       TIMESTAMPDIFF(MINUTE,
         CONCAT(COALESCE(created_date, DATE(created_at)), ' ', COALESCE(created_time, TIME(created_at))),
         NOW()
       ) AS pending_minutes
     FROM ats_candidate
     WHERE active_status = 1
       AND recruiter_assigned_name = ?
       AND status = 'Waiting'
     ORDER BY pending_minutes DESC`,
    params
  );
  return (rows as any[]).map((r) => ({
    candidateId: r.id,
    candidateCode: r.candidate_code,
    fullName: r.full_name,
    mobile: r.mobile,
    qToken: r.q_token ?? null,
    process: r.applied_for_process ?? null,
    branch: r.applied_for_branch ?? null,
    pendingMinutes: Number(r.pending_minutes ?? 0),
    status: r.status,
  }));
}

// ── Submission history ────────────────────────────────────────────────────────

export async function getSubmissionHistory(recruiterCode?: string | null, _rosterId?: string | null, _userId?: string | null) {
  if (!recruiterCode) return [];
  const params = [recruiterCode];
  const [rows] = await db.execute<RowDataPacket[]>(
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
  return rows as any[];
}

export async function getRecruiterDailyStats(recruiterName: string): Promise<Record<string, unknown>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total_submissions,
       SUM(CASE WHEN final_decision = 'Selected' THEN 1 ELSE 0 END) AS selected_count,
       SUM(CASE WHEN final_decision = 'Rejected' THEN 1 ELSE 0 END) AS rejected_count
     FROM ats_interview_submission
     WHERE recruiter_name = ? AND DATE(submitted_at) = CURDATE()`,
    [recruiterName],
  );
  return (rows as any[])[0] ?? { total_submissions: 0, selected_count: 0, rejected_count: 0 };
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
  offerSalary?: unknown;
  offerDoj?: string;
  reportingTiming?: string;
  otDetails?: string;
  performanceIncentives?: string;
}

function validateSubmission(input: SubmissionInput) {
  // Mandatory fields
  const process = requireField(input.interviewedForProcess, "Interviewed for Process");
  const finalDecision = requireField(input.finalDecision, "Final Decision");
  const walkinEndStage = requireField(input.walkinEndStage, "Walk-in End Stage");

  validateEnum(process, "Process", VALID_PROCESSES);
  validateEnum(finalDecision, "Final Decision", VALID_DECISIONS);

  if (!VALID_STAGES.includes(walkinEndStage as any))
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
  }

  return { process, finalDecision, walkinEndStage, rank, r1, r2, r3 };
}

// ── Submit interview update ───────────────────────────────────────────────────

export async function submitInterviewUpdate(
  raw: Record<string, any>,
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
    offerSalary: raw.offerSalary ?? raw["Offer Salary"] ?? null,
    offerDoj: String(raw.offerDoj || raw["Date of Joining"] || "").trim() || undefined,
    reportingTiming: String(raw.reportingTiming || raw["Reporting Timing"] || "").trim() || undefined,
    otDetails: String(raw.otDetails || raw["OT Details"] || "").trim() || undefined,
    performanceIncentives: String(raw.performanceIncentives || raw["Performance Incentives"] || "").trim() || undefined,
  };

  if (!input.candidateId && !input.qToken) err("CandidateID or QToken required", 400);

  // Validate all fields — throws on any violation
  const { process, finalDecision, walkinEndStage, r1, r2, r3 } = validateSubmission(input);

  const conn = await (db as any).getConnection();
  try {
    await conn.beginTransaction();

    // Lock the candidate row
    const whereClause = input.candidateId
      ? "(c.id = ? OR c.candidate_code = ?)"
      : "c.q_token = ?";
    const whereParams = input.candidateId
      ? [input.candidateId, input.candidateId]
      : [input.qToken];

    const [candRows] = await conn.execute(
      `SELECT c.id, c.candidate_code, c.full_name, c.email,
              c.recruiter_id, c.recruiter_assigned_id, c.assigned_recruiter_id, c.recruiter_assigned_name,
              c.applied_for_branch, c.branch_display_name, c.q_token, c.current_stage, c.status, c.created_date, c.created_time
       FROM ats_candidate c
       WHERE ${whereClause}
       LIMIT 1
       FOR UPDATE`,
      whereParams
    );
    const candidate = (candRows as any[])[0];
    if (!candidate) err("Candidate not found", 404);

    // Ownership check
    const assignedRecruiterIds = [
      candidate.recruiter_id,
      candidate.recruiter_assigned_id,
      candidate.assigned_recruiter_id,
    ].filter(Boolean).map(String);
    const assignedById = assignedRecruiterIds.length > 0 && assignedRecruiterIds.includes(String(recruiterProfile.id));
    const assignedByName = candidate.recruiter_assigned_name && candidate.recruiter_assigned_name === recruiterProfile.name;
    if ((assignedRecruiterIds.length > 0 || candidate.recruiter_assigned_name) && !assignedById && !assignedByName) {
      err("This candidate is assigned to a different recruiter", 403);
    }

    // QToken consistency: if we matched by candidateId, ensure qToken (if given) belongs to this candidate
    if (input.qToken && input.candidateId && candidate.q_token && candidate.q_token !== input.qToken) {
      err("QToken does not match this candidate", 409);
    }

    const effectiveQToken = candidate.q_token ?? input.qToken ?? null;

    // Check for existing submission (upsert) — q_token may be NULL
    const [existingRows] = await conn.execute(
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
    const existing = (existingRows as any[])[0] ?? null;

    const submissionId = existing?.id ?? randomUUID();
    const isUpdate = !!existing;

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
           offer_salary = ?,
           offer_doj = ?,
           reporting_timing = ?,
           ot_details = ?,
           performance_incentives = ?,
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
          nvlNum(input.offerSalary),
          nvl(input.offerDoj),
          nvl(input.reportingTiming),
          nvl(input.otDetails),
          nvl(input.performanceIncentives),
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
            offer_salary, offer_doj, reporting_timing, ot_details, performance_incentives,
            submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
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
          nvlNum(input.offerSalary),
          nvl(input.offerDoj),
          nvl(input.reportingTiming),
          nvl(input.otDetails),
          nvl(input.performanceIncentives),
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
         offer_salary = ?,
         offer_doj = ?,
         reporting_shift = ?,
         offer_performance_incentive = ?,
         profile_status = CASE
           WHEN ? = 'Selected' THEN 'selected'
           WHEN ? IN ('Rejected', 'No Show') THEN 'closed'
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
        nvlNum(input.offerSalary),
        nvl(input.offerDoj),
        nvl(input.reportingTiming),
        nvl(input.performanceIncentives),
        finalDecision,
        finalDecision,
        candidate.id,
      ]
    );

    // Stage log
    await conn.execute(
      `INSERT INTO ats_candidate_stage_log (id, candidate_id, from_stage, to_stage, remarks, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), candidate.id, candidate.current_stage || candidate.status, walkinEndStage, nvl(raw.remarks), actorUserId ?? null]
    );

    if ((raw.proxySubmission === true || raw.proxySubmission === "true") && actorUserId) {
      await conn.execute(
        `INSERT INTO ats_interview_submission_audit (id, submission_id, action, actor_user_id, snapshot)
         VALUES (?, ?, 'UPDATE', ?, CAST(? AS JSON))`,
        [
          randomUUID(),
          submissionId,
          actorUserId,
          JSON.stringify({ proxySubmission: true, recruiterCode: recruiterProfile.recruiterCode, recruiterName: recruiterProfile.name }),
        ]
      );
    }

    await conn.commit();

    if (finalDecision === "Selected") {
      try {
        await sendOnboardingToken(candidate.id, actorUserId ?? "SYSTEM");
      } catch (e) {
        console.error("[ats] automatic onboarding link failed:", e instanceof Error ? e.message : String(e));
      }
    } else if ((finalDecision === "Rejected" || finalDecision === "No Show") && candidate.email) {
      sendRejectedEmail({
        candidateId: candidate.id,
        to: candidate.email,
        candidateName: candidate.full_name,
        branchName: candidate.branch_display_name ?? candidate.applied_for_branch ?? "",
      }).catch((e: unknown) => console.error("[ats] rejection email failed:", e instanceof Error ? e.message : String(e)));
    }

    // Fetch updated submission row for response (outside transaction)
    const [subRows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM ats_interview_submission WHERE id = ? LIMIT 1`,
      [submissionId]
    );
    return { submission: (subRows as any[])[0], action: isUpdate ? "updated" : "created" };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
