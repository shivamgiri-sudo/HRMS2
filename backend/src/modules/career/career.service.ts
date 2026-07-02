import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CareerPath {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  current_role: string | null;
  target_role: string | null;
  target_timeline: string | null;
  readiness_pct: number;
  skills_gap: string | null;
  notes: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PipRecord {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  initiated_by: string;
  start_date: string;
  end_date: string;
  reason: string;
  goals: unknown;
  status: "active" | "completed" | "extended" | "terminated";
  outcome: "improved" | "not_improved" | "resigned" | "terminated" | null;
  review_notes: string | null;
  closed_by: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PipCheckpoint {
  id: string;
  pip_id: string;
  checkpoint_date: string;
  rating: "on_track" | "at_risk" | "off_track";
  notes: string | null;
  recorded_by: string | null;
  created_at: string;
}

// ─── Career Path ──────────────────────────────────────────────────────────────

export const careerService = {
  async getCareerPath(employeeId: string): Promise<CareerPath | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cp.*,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              e.employee_code
       FROM career_path cp
       LEFT JOIN employees e ON e.id = cp.employee_id
       WHERE cp.employee_id = ?
       LIMIT 1`,
      [employeeId]
    );
    const result = rows as CareerPath[];
    return result[0] ?? null;
  },

  async upsertCareerPath(
    employeeId: string,
    input: {
      current_role?: string | null;
      target_role?: string | null;
      target_timeline?: string | null;
      readiness_pct?: number;
      skills_gap?: string | null;
      notes?: string | null;
      reviewed_by?: string | null;
    }
  ): Promise<CareerPath> {
    await db.execute(
      `INSERT INTO career_path
         (employee_id, current_role, target_role, target_timeline, readiness_pct, skills_gap, notes, reviewed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         current_role      = VALUES(current_role),
         target_role       = VALUES(target_role),
         target_timeline   = VALUES(target_timeline),
         readiness_pct     = VALUES(readiness_pct),
         skills_gap        = VALUES(skills_gap),
         notes             = VALUES(notes),
         reviewed_by       = VALUES(reviewed_by),
         updated_at        = NOW()`,
      [
        employeeId,
        input.current_role ?? null,
        input.target_role ?? null,
        input.target_timeline ?? null,
        input.readiness_pct ?? 0,
        input.skills_gap ?? null,
        input.notes ?? null,
        input.reviewed_by ?? null,
      ]
    );

    const record = await careerService.getCareerPath(employeeId);
    if (!record) throw new Error("Career path not found after upsert");
    return record;
  },

  async listAllCareerPaths(): Promise<CareerPath[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cp.*,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              e.employee_code
       FROM career_path cp
       LEFT JOIN employees e ON e.id = cp.employee_id
       ORDER BY cp.readiness_pct DESC`
    );
    return rows as CareerPath[];
  },

  // ─── PIP ─────────────────────────────────────────────────────────────────────

  async listPips(filters: { employeeId?: string; status?: string }): Promise<PipRecord[]> {
    const conds: string[] = [];
    const params: unknown[] = [];

    if (filters.employeeId) {
      conds.push("pr.employee_id = ?");
      params.push(filters.employeeId);
    }
    if (filters.status) {
      conds.push("pr.status = ?");
      params.push(filters.status);
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT pr.*,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              e.employee_code
       FROM pip_record pr
       LEFT JOIN employees e ON e.id = pr.employee_id
       ${where}
       ORDER BY pr.created_at DESC`,
      params
    );
    return rows as PipRecord[];
  },

  async getPip(id: string): Promise<(PipRecord & { checkpoints: PipCheckpoint[] }) | null> {
    const [pipRows] = await db.execute<RowDataPacket[]>(
      `SELECT pr.*,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              e.employee_code
       FROM pip_record pr
       LEFT JOIN employees e ON e.id = pr.employee_id
       WHERE pr.id = ?
       LIMIT 1`,
      [id]
    );

    const pip = (pipRows as PipRecord[])[0];
    if (!pip) return null;

    const [checkRows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM pip_checkpoint WHERE pip_id = ? ORDER BY checkpoint_date ASC`,
      [id]
    );

    return { ...pip, checkpoints: checkRows as PipCheckpoint[] };
  },

  async createPip(input: {
    employee_id: string;
    initiated_by: string;
    start_date: string;
    end_date: string;
    reason: string;
    goals?: unknown;
  }): Promise<PipRecord> {
    const goalsJson = input.goals ? JSON.stringify(input.goals) : null;

    await db.execute(
      `INSERT INTO pip_record
         (employee_id, initiated_by, start_date, end_date, reason, goals)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.employee_id,
        input.initiated_by,
        input.start_date,
        input.end_date,
        input.reason,
        goalsJson,
      ]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT pr.*,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              e.employee_code
       FROM pip_record pr
       LEFT JOIN employees e ON e.id = pr.employee_id
       WHERE pr.id = LAST_INSERT_ID()
       LIMIT 1`
    );
    return (rows as PipRecord[])[0];
  },

  async updatePip(
    id: string,
    input: {
      status?: "active" | "completed" | "extended" | "terminated";
      outcome?: "improved" | "not_improved" | "resigned" | "terminated" | null;
      review_notes?: string | null;
      closed_by?: string | null;
    }
  ): Promise<PipRecord> {
    const [check] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM pip_record WHERE id = ? LIMIT 1",
      [id]
    );
    if (!(check as RowDataPacket[]).length) throw new Error("PIP record not found");

    const setClauses: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [];

    if (input.status !== undefined) {
      setClauses.push("status = ?");
      params.push(input.status);
      if (["completed", "terminated"].includes(input.status)) {
        setClauses.push("closed_at = NOW()");
      }
    }
    if (input.outcome !== undefined) {
      setClauses.push("outcome = ?");
      params.push(input.outcome);
    }
    if (input.review_notes !== undefined) {
      setClauses.push("review_notes = ?");
      params.push(input.review_notes);
    }
    if (input.closed_by !== undefined) {
      setClauses.push("closed_by = ?");
      params.push(input.closed_by);
    }

    params.push(id);

    await db.execute(
      `UPDATE pip_record SET ${setClauses.join(", ")} WHERE id = ?`,
      params
    );

    const record = await careerService.getPip(id);
    if (!record) throw new Error("PIP record not found after update");
    return record;
  },

  async addCheckpoint(input: {
    pip_id: string;
    checkpoint_date: string;
    rating: "on_track" | "at_risk" | "off_track";
    notes?: string | null;
    recorded_by?: string | null;
  }): Promise<PipCheckpoint> {
    const [check] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM pip_record WHERE id = ? LIMIT 1",
      [input.pip_id]
    );
    if (!(check as RowDataPacket[]).length) throw new Error("PIP record not found");

    await db.execute(
      `INSERT INTO pip_checkpoint (pip_id, checkpoint_date, rating, notes, recorded_by)
       VALUES (?, ?, ?, ?, ?)`,
      [
        input.pip_id,
        input.checkpoint_date,
        input.rating,
        input.notes ?? null,
        input.recorded_by ?? null,
      ]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM pip_checkpoint WHERE id = LAST_INSERT_ID() LIMIT 1"
    );
    return (rows as PipCheckpoint[])[0];
  },
};
