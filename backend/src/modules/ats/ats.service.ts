import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type {
  AtsCandidate, AtsCandidateStageLog, AtsOnboardingBridge, AtsSourcingChannel,
  CandidateListFilters, CreateCandidateInput, CreateOnboardingBridgeInput,
  PaginatedResult,
} from "./ats.types.js";

function generateCandidateCode(lastCode: string | null): string {
  const year = new Date().getFullYear();
  const prefix = `ATS-${year}`;
  if (!lastCode || !lastCode.startsWith(prefix)) return `${prefix}0001`;
  const seq = parseInt(lastCode.replace(`${prefix}`, ""), 10) || 0;
  return `${prefix}${String(seq + 1).padStart(4, "0")}`;
}

export const atsService = {
  async getCandidate(id: string): Promise<AtsCandidate> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM ats_candidate WHERE id = ? LIMIT 1", [id]
    );
    const rec = (rows as AtsCandidate[])[0];
    if (!rec) throw new Error("Candidate not found");
    return rec;
  },

  async listCandidates(filters: CandidateListFilters): Promise<PaginatedResult<AtsCandidate>> {
    const { page, limit, stage, branch, process: proc, search, fromDate, toDate } = filters;
    const offset = (page - 1) * limit;
    const conds: string[] = ["active_status = 1"];
    const params: unknown[] = [];

    if (stage)    { conds.push("current_stage = ?");       params.push(stage); }
    if (branch)   { conds.push("applied_for_branch = ?");  params.push(branch); }
    if (proc)     { conds.push("applied_for_process = ?"); params.push(proc); }
    if (fromDate) { conds.push("walk_in_date >= ?");       params.push(fromDate); }
    if (toDate)   { conds.push("walk_in_date <= ?");       params.push(toDate); }
    if (search) {
      conds.push("(full_name LIKE ? OR mobile LIKE ? OR candidate_code LIKE ?)");
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const where = `WHERE ${conds.join(" AND ")}`;

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM ats_candidate ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM ats_candidate ${where}`, params
    );
    const total = (countRows as { total: number }[])[0]?.total ?? 0;
    return { data: rows as AtsCandidate[], total, page, limit };
  },

  async createCandidate(input: CreateCandidateInput, _userId: string): Promise<AtsCandidate> {
    const [dup] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM ats_candidate WHERE mobile = ? LIMIT 1", [input.mobile]
    );
    if ((dup as RowDataPacket[]).length > 0) throw new Error("This mobile already registered today");

    const [codeRow] = await db.execute<RowDataPacket[]>(
      "SELECT MAX(candidate_code) AS max_code FROM ats_candidate WHERE candidate_code LIKE ?",
      [`ATS-${new Date().getFullYear()}%`]
    );
    const lastCode = (codeRow as { max_code: string | null }[])[0]?.max_code ?? null;
    const candidateCode = generateCandidateCode(lastCode);
    const id = randomUUID();

    await db.execute(
      `INSERT INTO ats_candidate
         (id, candidate_code, full_name, mobile, email, gender, date_of_birth,
          current_stage, applied_for_process, applied_for_branch,
          sourcing_channel, referred_by, walk_in_date, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Applied', ?, ?, ?, ?, ?, ?)`,
      [
        id, candidateCode, input.fullName.trim(), input.mobile.trim(),
        input.email ?? null, input.gender ?? null, input.dateOfBirth ?? null,
        input.appliedForProcess ?? null, input.appliedForBranch ?? null,
        input.sourcingChannel ?? null, input.referredBy ?? null,
        input.walkInDate ?? null, input.remarks ?? null,
      ]
    );
    return this.getCandidate(id);
  },

  async updateCandidate(
    id: string,
    input: Partial<CreateCandidateInput>,
    _userId: string
  ): Promise<AtsCandidate> {
    await this.getCandidate(id);
    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.fullName           !== undefined) { sets.push("full_name = ?");            params.push(input.fullName.trim()); }
    if (input.email              !== undefined) { sets.push("email = ?");                params.push(input.email ?? null); }
    if (input.gender             !== undefined) { sets.push("gender = ?");               params.push(input.gender ?? null); }
    if (input.dateOfBirth        !== undefined) { sets.push("date_of_birth = ?");        params.push(input.dateOfBirth ?? null); }
    if (input.appliedForProcess  !== undefined) { sets.push("applied_for_process = ?");  params.push(input.appliedForProcess ?? null); }
    if (input.appliedForBranch   !== undefined) { sets.push("applied_for_branch = ?");   params.push(input.appliedForBranch ?? null); }
    if (input.sourcingChannel    !== undefined) { sets.push("sourcing_channel = ?");     params.push(input.sourcingChannel ?? null); }
    if (input.referredBy         !== undefined) { sets.push("referred_by = ?");          params.push(input.referredBy ?? null); }
    if (input.walkInDate         !== undefined) { sets.push("walk_in_date = ?");         params.push(input.walkInDate ?? null); }
    if (input.remarks            !== undefined) { sets.push("remarks = ?");              params.push(input.remarks ?? null); }

    if (sets.length > 0) {
      params.push(id);
      await db.execute(`UPDATE ats_candidate SET ${sets.join(", ")} WHERE id = ?`, params);
    }
    return this.getCandidate(id);
  },

  async moveStage(
    id: string,
    toStage: string,
    userId: string,
    remarks?: string
  ): Promise<AtsCandidate> {
    const candidate = await this.getCandidate(id);
    const fromStage = candidate.current_stage;

    await db.execute(
      "UPDATE ats_candidate SET current_stage = ? WHERE id = ?",
      [toStage, id]
    );

    await db.execute(
      `INSERT INTO ats_candidate_stage_log
         (id, candidate_id, from_stage, to_stage, stage_date, remarks, updated_by)
       VALUES (UUID(), ?, ?, ?, NOW(), ?, ?)`,
      [id, fromStage, toStage, remarks ?? null, userId]
    );

    return this.getCandidate(id);
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
    await this.getCandidate(input.candidateId); // throws if not found

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

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM ats_onboarding_bridge WHERE id = ? LIMIT 1", [id]
    );
    return (rows as AtsOnboardingBridge[])[0];
  },

  async updateOnboardingBridge(
    id: string,
    input: { employeeId?: string; joiningDate?: string; status?: string; offerLetterUrl?: string; notes?: string },
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
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM ats_onboarding_bridge WHERE id = ? LIMIT 1", [id]
    );
    const rec = (rows as AtsOnboardingBridge[])[0];
    if (!rec) throw new Error("Onboarding bridge not found");
    return rec;
  },

  async listSourcingChannels(): Promise<AtsSourcingChannel[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM ats_sourcing_channel WHERE active_status = 1 ORDER BY channel_name ASC"
    );
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

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         current_stage,
         COUNT(*) AS count,
         SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) AS today_count
       FROM ats_candidate ${where}
       GROUP BY current_stage`,
      params
    );

    const [total] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM ats_candidate ${where}`, params
    );

    return {
      total: (total as { total: number }[])[0]?.total ?? 0,
      by_stage: rows as { current_stage: string; count: number; today_count: number }[],
    };
  },
};
