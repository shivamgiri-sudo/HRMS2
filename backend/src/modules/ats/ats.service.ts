import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { sendSelectedEmail, sendRejectedEmail } from "./ats.email.service.js";
import { sendOnboardingToken } from "./ats.onboarding.service.js";
import type {
  AtsCandidate,
  AtsCandidateStageLog,
  AtsOnboardingBridge,
  AtsSourcingChannel,
  CandidateListFilters,
  CreateCandidateInput,
  CreateOnboardingBridgeInput,
  PaginatedResult,
} from "./ats.types.js";

function candidateCode(): string {
  return `CND-${Date.now().toString(36).toUpperCase()}`;
}

/** Normalize sourcing channel to canonical values */
function normalizeSourceChannel(channel: string | null | undefined): string | null {
  if (!channel) return null;
  const normalized = channel.trim().toLowerCase();
  const mapping: Record<string, string> = {
    "walk-in": "Walk-In",
    "walkin": "Walk-In",
    "walk_in": "Walk-In",
    "employee-referral": "Employee Referral",
    "employee referral": "Employee Referral",
    "job-portal": "Job Portal",
    "job portal": "Job Portal",
    "social-media": "Social Media",
    "social media": "Social Media",
  };
  return mapping[normalized] || channel; // Return normalized or original if no match
}

export const atsService = {
  async listCandidates(filters: CandidateListFilters): Promise<PaginatedResult<AtsCandidate>> {
    const conds: string[] = ["active_status = 1"];
    const params: unknown[] = [];
    if (filters.stage)    { conds.push("current_stage = ?");         params.push(filters.stage); }
    if (filters.branch)   { conds.push("applied_for_branch = ?");   params.push(filters.branch); }
    if (filters.process)  { conds.push("applied_for_process = ?");  params.push(filters.process); }
    if (filters.search) {
      conds.push("(full_name LIKE ? OR mobile LIKE ? OR candidate_code LIKE ?)");
      const search = `%${filters.search}%`;
      params.push(search, search, search);
    }
    if (filters.fromDate) { conds.push("walk_in_date >= ?"); params.push(filters.fromDate); }
    if (filters.toDate)   { conds.push("walk_in_date <= ?"); params.push(filters.toDate); }

    // Apply scope filter from middleware
    if ((filters as any).scopeFilter) {
      const scopeFilter = (filters as any).scopeFilter;
      // scopeFilter is {sql: string, params: unknown[]} from buildScopeWhereClause
      if (typeof scopeFilter === 'object' && scopeFilter.sql) {
        const { sql, params: scopeParams } = scopeFilter;
        if (sql === "1=0") {
          // User has no access - return empty result immediately
          return { data: [], total: 0, page: filters.page, limit: filters.limit };
        }
        if (sql && sql !== "1=1") {
          // Add scope filter SQL (already without WHERE prefix)
          conds.push(`(${sql})`);
          // Merge scope params into main params array
          params.push(...(scopeParams || []));
        }
        // If sql === "1=1", user has full access - no additional filter needed
      }
    }

    const where = `WHERE ${conds.join(" AND ")}`;
    const offset = (filters.page - 1) * filters.limit;

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM ats_candidate ${where} ORDER BY created_at DESC LIMIT ${filters.limit} OFFSET ${offset}`,
      params
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM ats_candidate ${where}`,
      params
    );
    return { data: rows as AtsCandidate[], total: Number(countRows[0]?.total ?? 0), page: filters.page, limit: filters.limit };
  },

  async getCandidate(id: string): Promise<AtsCandidate> {
    const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM ats_candidate WHERE id = ? LIMIT 1", [id]);
    const candidate = (rows as AtsCandidate[])[0];
    if (!candidate) throw new Error("Candidate not found");
    return candidate;
  },

  async createCandidate(input: CreateCandidateInput, userId: string | null): Promise<AtsCandidate> {
    const [dup] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM ats_candidate WHERE mobile = ? LIMIT 1", [input.mobile]
    );
    if ((dup as RowDataPacket[]).length > 0) throw new Error("This mobile already registered");

    // Normalize sourcing channel before insert
    const normalizedChannel = normalizeSourceChannel(input.sourcingChannel);

    const id = randomUUID();
    await db.execute(
      `INSERT INTO ats_candidate
         (id, candidate_code, full_name, mobile, email, gender, date_of_birth, applied_for_process,
          applied_for_branch, sourcing_channel, referred_by, walk_in_date, remarks, created_by,
          address, education, experience, rotational_shift, preferred_shift, night_shift_ok,
          leaves_in_3months, owns_two_wheeler, id_proof_available, education_proof_available,
          recruiter_name, profile_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, candidateCode(), input.fullName, input.mobile, input.email ?? null, input.gender ?? null,
       input.dateOfBirth ?? null, input.appliedForProcess ?? null, input.appliedForBranch ?? null,
       normalizedChannel, input.referredBy ?? null, input.walkInDate ?? null, input.remarks ?? null, userId,
       input.address ?? null, input.education ?? null, input.experience ?? null,
       input.rotationalShift ?? null, input.preferredShift ?? null, input.nightShiftOk ?? null,
       input.leavesIn3months ?? null, input.ownsTwoWheeler ?? null, input.idProofAvailable ?? null,
       input.educationProofAvailable ?? null, input.recruiterName ?? null, input.profileStatus ?? 'registered']
    );
    return this.getCandidate(id);
  },

  async updateCandidate(id: string, input: Partial<CreateCandidateInput>, _userId: string): Promise<AtsCandidate> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const fields: Array<[keyof CreateCandidateInput, string]> = [
      ["fullName", "full_name"], ["email", "email"], ["gender", "gender"], ["dateOfBirth", "date_of_birth"],
      ["appliedForProcess", "applied_for_process"], ["appliedForBranch", "applied_for_branch"],
      ["sourcingChannel", "sourcing_channel"], ["referredBy", "referred_by"], ["walkInDate", "walk_in_date"], ["remarks", "remarks"],
    ];
    fields.forEach(([key, column]) => {
      if (input[key] !== undefined) {
        // Normalize sourcing channel if being updated
        const value = key === "sourcingChannel" ? normalizeSourceChannel(input[key] as string) : (input[key] ?? null);
        sets.push(`${column} = ?`);
        params.push(value);
      }
    });
    if (sets.length) {
      params.push(id);
      await db.execute(`UPDATE ats_candidate SET ${sets.join(", ")} WHERE id = ?`, params);
    }
    return this.getCandidate(id);
  },

  async moveStage(candidateId: string, toStage: string, userId: string, remarks?: string): Promise<AtsCandidate> {
    const candidate = await this.getCandidate(candidateId);
    await db.execute("UPDATE ats_candidate SET current_stage = ?, updated_at = NOW() WHERE id = ?", [toStage, candidateId]);
    await db.execute(
      `INSERT INTO ats_candidate_stage_log (id, candidate_id, from_stage, to_stage, remarks, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), candidateId, candidate.current_stage, toStage, remarks ?? null, userId]
    );

    // Fire email side-effects after the stage is committed — failure must not break the stage move
    if (toStage === 'Selected' && candidate.email) {
      sendSelectedEmail({
        candidateId,
        to: candidate.email,
        candidateName: candidate.full_name ?? '',
        branchName: candidate.applied_for_branch ?? '',
        hrName: 'HR Team',
        hrPhone: '',
      }).catch(() => { /* already logged in ats_email_log */ });
      sendOnboardingToken(candidateId, userId).catch(() => {});
    } else if (toStage === 'Rejected' && candidate.email) {
      sendRejectedEmail({
        candidateId,
        to: candidate.email,
        candidateName: candidate.full_name ?? '',
        branchName: candidate.applied_for_branch ?? '',
      }).catch(() => { /* already logged in ats_email_log */ });
    }

    return this.getCandidate(candidateId);
  },

  async listStageLogs(candidateId: string): Promise<AtsCandidateStageLog[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM ats_candidate_stage_log WHERE candidate_id = ? ORDER BY stage_date DESC",
      [candidateId]
    );
    return rows as AtsCandidateStageLog[];
  },

  async createOnboardingBridge(
    input: CreateOnboardingBridgeInput,
    userId: string
  ): Promise<AtsOnboardingBridge> {
    await this.getCandidate(input.candidateId);
    const [existing] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM ats_onboarding_bridge WHERE candidate_id = ? LIMIT 1",
      [input.candidateId]
    );
    if ((existing as RowDataPacket[]).length > 0) throw new Error("Onboarding bridge already exists for this candidate");

    const id = randomUUID();
    await db.execute(
      `INSERT INTO ats_onboarding_bridge
         (id, candidate_id, bridge_date, offer_letter_url, joining_date, status, notes, created_by)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [id, input.candidateId, input.bridgeDate, input.offerLetterUrl ?? null, input.joiningDate ?? null, input.notes ?? null, userId]
    );
    const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM ats_onboarding_bridge WHERE id = ? LIMIT 1", [id]);
    return (rows as AtsOnboardingBridge[])[0];
  },

  async updateOnboardingBridge(
    id: string,
    input: { employeeId?: string | null; joiningDate?: string | null; status?: string; offerLetterUrl?: string | null; notes?: string | null },
    _userId: string
  ): Promise<AtsOnboardingBridge> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.employeeId     !== undefined) { sets.push("employee_id = ?");      params.push(input.employeeId ?? null); }
    if (input.joiningDate    !== undefined) { sets.push("joining_date = ?");     params.push(input.joiningDate ?? null); }
    if (input.status         !== undefined) { sets.push("status = ?");           params.push(input.status); }
    if (input.offerLetterUrl !== undefined) { sets.push("offer_letter_url = ?"); params.push(input.offerLetterUrl ?? null); }
    if (input.notes          !== undefined) { sets.push("notes = ?");            params.push(input.notes ?? null); }
    if (sets.length > 0) {
      params.push(id);
      await db.execute(`UPDATE ats_onboarding_bridge SET ${sets.join(", ")} WHERE id = ?`, params);
    }
    const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM ats_onboarding_bridge WHERE id = ? LIMIT 1", [id]);
    const rec = (rows as AtsOnboardingBridge[])[0];
    if (!rec) throw new Error("Onboarding bridge not found");
    return rec;
  },

  async listSourcingChannels(): Promise<AtsSourcingChannel[]> {
    const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM ats_sourcing_channel WHERE active_status = 1 ORDER BY channel_name ASC");
    return rows as AtsSourcingChannel[];
  },

  async getDashboardStats(filters: { fromDate?: string; toDate?: string; branch?: string; process?: string }) {
    const conds: string[] = ["active_status = 1"];
    const params: unknown[] = [];
    if (filters.fromDate) { conds.push("walk_in_date >= ?"); params.push(filters.fromDate); }
    if (filters.toDate)   { conds.push("walk_in_date <= ?"); params.push(filters.toDate); }
    if (filters.branch)   { conds.push("applied_for_branch = ?"); params.push(filters.branch); }
    if (filters.process)  { conds.push("applied_for_process = ?"); params.push(filters.process); }
    const where = `WHERE ${conds.join(" AND ")}`;

    const [stageRows] = await db.execute<RowDataPacket[]>(
      `SELECT current_stage, COUNT(*) AS count FROM ats_candidate ${where} GROUP BY current_stage`, params
    );
    const [total] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM ats_candidate ${where}`, params
    );
    const [sourceRows] = await db.execute<RowDataPacket[]>(
      `SELECT sourcing_channel, COUNT(*) AS count FROM ats_candidate ${where} GROUP BY sourcing_channel`, params
    );
    const [convRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM ats_candidate ${where} AND current_stage IN ('converted','Onboarded','Selected')`, params
    );
    // Approximate time-to-hire using updated_at as proxy for converted candidates
    const [timeRows] = await db.execute<RowDataPacket[]>(
      `SELECT AVG(DATEDIFF(updated_at, created_at)) AS avg_days
         FROM ats_candidate
        WHERE active_status = 1 AND current_stage = 'converted'`, []
    );

    const totalCount = Number(total[0]?.total ?? 0);
    const convertedCount = Number(convRows[0]?.cnt ?? 0);

    // Build by_stage as Record<string, number> keyed by stage name
    const by_stage: Record<string, number> = {};
    for (const row of stageRows as { current_stage: string; count: number }[]) {
      by_stage[row.current_stage] = Number(row.count);
    }

    // Build by_source as Record<string, number>
    const by_source: Record<string, number> = {};
    for (const row of sourceRows as { sourcing_channel: string | null; count: number }[]) {
      const key = row.sourcing_channel ?? "unknown";
      by_source[key] = Number(row.count);
    }

    return {
      total_candidates: totalCount,
      by_stage,
      by_source,
      conversion_rate: totalCount > 0 ? Math.round((convertedCount / totalCount) * 1000) / 10 : 0,
      time_to_hire_avg: Number(timeRows[0]?.avg_days ?? 0),
    };
  },
};
