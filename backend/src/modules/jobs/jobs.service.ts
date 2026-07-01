import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type JobType = "full_time" | "part_time" | "contract" | "internship";
export type PostingStatus = "draft" | "active" | "paused" | "closed";
export type WalkinStatus = "waiting" | "called" | "in_interview" | "completed" | "no_show";

export interface JobPosting {
  id: string;
  posting_code: string;
  title: string;
  process_id: string | null;
  branch_id: string | null;
  department_id: string | null;
  designation_id: string | null;
  vacancies: number;
  job_type: JobType;
  experience_min: number;
  experience_max: number;
  description: string | null;
  requirements: string | null;
  salary_min: number | null;
  salary_max: number | null;
  posted_by: string | null;
  status: PostingStatus;
  closing_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface WalkinEntry {
  id: string;
  token_number: string;
  candidate_name: string;
  mobile: string;
  email: string | null;
  applied_role: string | null;
  branch_id: string | null;
  process_id: string | null;
  registered_at: string;
  called_at: string | null;
  status: WalkinStatus;
  notes: string | null;
  recruiter_id: string | null;
}

export interface CreatePostingInput {
  title: string;
  process_id?: string;
  branch_id?: string;
  department_id?: string;
  designation_id?: string;
  vacancies?: number;
  job_type?: JobType;
  experience_min?: number;
  experience_max?: number;
  description?: string;
  requirements?: string;
  salary_min?: number;
  salary_max?: number;
  posted_by?: string;
  status?: PostingStatus;
  closing_date?: string;
}

export interface UpdatePostingInput {
  status?: PostingStatus;
  title?: string;
  description?: string;
  vacancies?: number;
  closing_date?: string;
}

export interface RegisterWalkinInput {
  candidate_name: string;
  mobile: string;
  email?: string;
  applied_role?: string;
  branch_id?: string;
  process_id?: string;
}

// ─── Helper ────────────────────────────────────────────────────────────────────

function generatePostingCode(seq: number): string {
  const year = new Date().getFullYear();
  return `JP-${year}-${String(seq).padStart(4, "0")}`;
}

async function nextPostingCode(): Promise<string> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT posting_code FROM job_posting ORDER BY created_at DESC LIMIT 1"
  );
  const last = (rows as { posting_code: string }[])[0]?.posting_code ?? null;
  const year = new Date().getFullYear();
  const prefix = `JP-${year}-`;
  if (!last || !last.startsWith(prefix)) return generatePostingCode(1);
  const seq = parseInt(last.replace(prefix, ""), 10) || 0;
  return generatePostingCode(seq + 1);
}

async function nextTokenNumber(dateStr: string): Promise<string> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS cnt FROM walkin_queue WHERE DATE(registered_at) = ?",
    [dateStr]
  );
  const cnt = (rows as { cnt: number }[])[0]?.cnt ?? 0;
  return `T${String(cnt + 1).padStart(3, "0")}`;
}

// ─── Service ───────────────────────────────────────────────────────────────────

export const jobsService = {

  // ── Job Postings ──────────────────────────────────────────────────────────

  async listPostings(filters: {
    status?: string;
    process_id?: string;
    branch_id?: string;
  }): Promise<JobPosting[]> {
    const conds: string[] = [];
    const params: unknown[] = [];

    if (filters.status)     { conds.push("status = ?");     params.push(filters.status); }
    if (filters.process_id) { conds.push("process_id = ?"); params.push(filters.process_id); }
    if (filters.branch_id)  { conds.push("branch_id = ?");  params.push(filters.branch_id); }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM job_posting ${where} ORDER BY created_at DESC`,
      params
    );
    return rows as JobPosting[];
  },

  async createPosting(input: CreatePostingInput, userId: string): Promise<JobPosting> {
    const id = randomUUID();
    const code = await nextPostingCode();

    await db.execute(
      `INSERT INTO job_posting
        (id, posting_code, title, process_id, branch_id, department_id, designation_id,
         vacancies, job_type, experience_min, experience_max, description, requirements,
         salary_min, salary_max, posted_by, status, closing_date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        code,
        input.title,
        input.process_id ?? null,
        input.branch_id ?? null,
        input.department_id ?? null,
        input.designation_id ?? null,
        input.vacancies ?? 1,
        input.job_type ?? "full_time",
        input.experience_min ?? 0,
        input.experience_max ?? 0,
        input.description ?? null,
        input.requirements ?? null,
        input.salary_min ?? null,
        input.salary_max ?? null,
        input.posted_by ?? userId,
        input.status ?? "draft",
        input.closing_date ?? null,
      ]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM job_posting WHERE id = ? LIMIT 1", [id]
    );
    return (rows as JobPosting[])[0];
  },

  async updatePosting(id: string, input: UpdatePostingInput): Promise<JobPosting> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.status !== undefined)       { sets.push("status = ?");       params.push(input.status); }
    if (input.title !== undefined)        { sets.push("title = ?");        params.push(input.title); }
    if (input.description !== undefined)  { sets.push("description = ?");  params.push(input.description); }
    if (input.vacancies !== undefined)    { sets.push("vacancies = ?");    params.push(input.vacancies); }
    if (input.closing_date !== undefined) { sets.push("closing_date = ?"); params.push(input.closing_date); }

    if (sets.length === 0) throw new Error("No fields to update");

    params.push(id);
    await db.execute(
      `UPDATE job_posting SET ${sets.join(", ")} WHERE id = ?`,
      params
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM job_posting WHERE id = ? LIMIT 1", [id]
    );
    const rec = (rows as JobPosting[])[0];
    if (!rec) throw new Error("Job posting not found");
    return rec;
  },

  // ── Walk-in Queue ─────────────────────────────────────────────────────────

  async listWalkin(filters: {
    status?: string;
    branch_id?: string;
    date?: string;
  }): Promise<WalkinEntry[]> {
    const conds: string[] = [];
    const params: unknown[] = [];

    if (filters.status)    { conds.push("status = ?");                params.push(filters.status); }
    if (filters.branch_id) { conds.push("branch_id = ?");             params.push(filters.branch_id); }
    if (filters.date)      { conds.push("DATE(registered_at) = ?");   params.push(filters.date); }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM walkin_queue ${where} ORDER BY registered_at ASC`,
      params
    );
    return rows as WalkinEntry[];
  },

  async registerWalkin(input: RegisterWalkinInput): Promise<WalkinEntry> {
    const id = randomUUID();
    const today = new Date().toISOString().slice(0, 10);
    const token = await nextTokenNumber(today);

    await db.execute(
      `INSERT INTO walkin_queue
        (id, token_number, candidate_name, mobile, email, applied_role, branch_id, process_id)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        id,
        token,
        input.candidate_name,
        input.mobile,
        input.email ?? null,
        input.applied_role ?? null,
        input.branch_id ?? null,
        input.process_id ?? null,
      ]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM walkin_queue WHERE id = ? LIMIT 1", [id]
    );
    return (rows as WalkinEntry[])[0];
  },

  async callCandidate(id: string): Promise<WalkinEntry> {
    await db.execute(
      "UPDATE walkin_queue SET status = 'called', called_at = NOW() WHERE id = ?",
      [id]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM walkin_queue WHERE id = ? LIMIT 1", [id]
    );
    const rec = (rows as WalkinEntry[])[0];
    if (!rec) throw new Error("Walk-in entry not found");
    return rec;
  },

  async updateWalkinStatus(id: string, input: {
    status: WalkinStatus;
    notes?: string;
    recruiter_id?: string;
  }): Promise<WalkinEntry> {
    const sets: string[] = ["status = ?"];
    const params: unknown[] = [input.status];

    if (input.notes !== undefined)        { sets.push("notes = ?");        params.push(input.notes); }
    if (input.recruiter_id !== undefined) { sets.push("recruiter_id = ?"); params.push(input.recruiter_id); }

    params.push(id);
    await db.execute(
      `UPDATE walkin_queue SET ${sets.join(", ")} WHERE id = ?`,
      params
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM walkin_queue WHERE id = ? LIMIT 1", [id]
    );
    const rec = (rows as WalkinEntry[])[0];
    if (!rec) throw new Error("Walk-in entry not found");
    return rec;
  },
};
