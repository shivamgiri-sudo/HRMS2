import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Goal {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  title: string;
  description: string | null;
  goal_type: "individual" | "team" | "department" | "company";
  period: string;
  target_value: number | null;
  actual_value: number | null;
  weightage: number;
  status: "draft" | "active" | "completed" | "cancelled";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppraisalCycle {
  id: string;
  cycle_name: string;
  period: string;
  start_date: string;
  end_date: string;
  status: "draft" | "active" | "closed";
  created_at: string;
}

export interface AppraisalRating {
  id: string;
  cycle_id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  self_rating: number | null;
  manager_rating: number | null;
  final_rating: number | null;
  self_comments: string | null;
  manager_comments: string | null;
  status: "pending" | "self_done" | "manager_done" | "calibrated" | "closed";
  rated_by: string | null;
  updated_at: string;
}

export interface SkillMaster {
  id: string;
  skill_name: string;
  skill_category: string | null;
  description: string | null;
  is_active: number;
  created_at: string;
}

export interface EmployeeSkill {
  id: string;
  employee_id: string;
  skill_id: string;
  skill_name?: string;
  skill_category?: string | null;
  proficiency: "beginner" | "intermediate" | "advanced" | "expert";
  certified: number;
  assessed_date: string | null;
  notes: string | null;
}

// ─── Goals ────────────────────────────────────────────────────────────────────

export const goalsService = {
  async listGoals(filters: { employeeId?: string; period?: string }): Promise<Goal[]> {
    const conds: string[] = [];
    const params: unknown[] = [];

    if (filters.employeeId) {
      conds.push("g.employee_id = ?");
      params.push(filters.employeeId);
    }
    if (filters.period) {
      conds.push("g.period = ?");
      params.push(filters.period);
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT g.*,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              e.employee_code
       FROM goal g
       LEFT JOIN employees e ON e.id = g.employee_id
       ${where}
       ORDER BY g.created_at DESC`,
      params
    );
    return rows as Goal[];
  },

  async createGoal(input: {
    employee_id: string;
    title: string;
    description?: string | null;
    goal_type: "individual" | "team" | "department" | "company";
    period: string;
    target_value?: number | null;
    weightage?: number;
    created_by: string;
  }): Promise<Goal> {
    const [result] = await db.execute<RowDataPacket[]>(
      `INSERT INTO goal
         (employee_id, title, description, goal_type, period, target_value, weightage, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.employee_id,
        input.title,
        input.description ?? null,
        input.goal_type,
        input.period,
        input.target_value ?? null,
        input.weightage ?? 100,
        input.created_by,
      ]
    );
    const insertId = (result as unknown as { insertId: number }).insertId;
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT g.*,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              e.employee_code
       FROM goal g
       LEFT JOIN employees e ON e.id = g.employee_id
       WHERE g.id = LAST_INSERT_ID()
       LIMIT 1`,
      []
    );
    void insertId;
    return (rows as Goal[])[0];
  },

  async updateGoal(
    id: string,
    input: {
      actual_value?: number | null;
      status?: "draft" | "active" | "completed" | "cancelled";
      description?: string | null;
    }
  ): Promise<Goal> {
    const [check] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM goal WHERE id = ? LIMIT 1",
      [id]
    );
    if (!(check as RowDataPacket[]).length) throw new Error("Goal not found");

    const setClauses: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [];

    if (input.actual_value !== undefined) {
      setClauses.push("actual_value = ?");
      params.push(input.actual_value);
    }
    if (input.status !== undefined) {
      setClauses.push("status = ?");
      params.push(input.status);
    }
    if (input.description !== undefined) {
      setClauses.push("description = ?");
      params.push(input.description);
    }

    params.push(id);

    await db.execute(
      `UPDATE goal SET ${setClauses.join(", ")} WHERE id = ?`,
      params
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT g.*,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              e.employee_code
       FROM goal g
       LEFT JOIN employees e ON e.id = g.employee_id
       WHERE g.id = ?
       LIMIT 1`,
      [id]
    );
    return (rows as Goal[])[0];
  },

  // ─── Appraisal Cycles ─────────────────────────────────────────────────────

  async listCycles(): Promise<AppraisalCycle[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM appraisal_cycle ORDER BY start_date DESC"
    );
    return rows as AppraisalCycle[];
  },

  async createCycle(input: {
    cycle_name: string;
    period: string;
    start_date: string;
    end_date: string;
  }): Promise<AppraisalCycle> {
    await db.execute(
      `INSERT INTO appraisal_cycle (cycle_name, period, start_date, end_date)
       VALUES (?, ?, ?, ?)`,
      [input.cycle_name, input.period, input.start_date, input.end_date]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM appraisal_cycle WHERE id = LAST_INSERT_ID() LIMIT 1"
    );
    return (rows as AppraisalCycle[])[0];
  },

  async updateCycleStatus(
    id: string,
    status: "draft" | "active" | "closed"
  ): Promise<AppraisalCycle> {
    const [check] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM appraisal_cycle WHERE id = ? LIMIT 1",
      [id]
    );
    if (!(check as RowDataPacket[]).length) throw new Error("Appraisal cycle not found");

    await db.execute(
      "UPDATE appraisal_cycle SET status = ? WHERE id = ?",
      [status, id]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM appraisal_cycle WHERE id = ? LIMIT 1",
      [id]
    );
    return (rows as AppraisalCycle[])[0];
  },

  // ─── Appraisal Ratings ────────────────────────────────────────────────────

  async listRatings(cycleId: string): Promise<AppraisalRating[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ar.*,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              e.employee_code
       FROM appraisal_rating ar
       LEFT JOIN employees e ON e.id = ar.employee_id
       WHERE ar.cycle_id = ?
       ORDER BY employee_name ASC`,
      [cycleId]
    );
    return rows as AppraisalRating[];
  },

  async ensureRatingRecord(cycleId: string, employeeId: string): Promise<AppraisalRating> {
    await db.execute(
      `INSERT IGNORE INTO appraisal_rating (cycle_id, employee_id) VALUES (?, ?)`,
      [cycleId, employeeId]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ar.*,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              e.employee_code
       FROM appraisal_rating ar
       LEFT JOIN employees e ON e.id = ar.employee_id
       WHERE ar.cycle_id = ? AND ar.employee_id = ?
       LIMIT 1`,
      [cycleId, employeeId]
    );
    return (rows as AppraisalRating[])[0];
  },

  async submitSelfRating(
    cycleId: string,
    employeeId: string,
    input: { self_rating: number; self_comments?: string | null }
  ): Promise<AppraisalRating> {
    await goalsService.ensureRatingRecord(cycleId, employeeId);

    await db.execute(
      `UPDATE appraisal_rating
       SET self_rating = ?, self_comments = ?, status = 'self_done', updated_at = NOW()
       WHERE cycle_id = ? AND employee_id = ?`,
      [input.self_rating, input.self_comments ?? null, cycleId, employeeId]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ar.*,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              e.employee_code
       FROM appraisal_rating ar
       LEFT JOIN employees e ON e.id = ar.employee_id
       WHERE ar.cycle_id = ? AND ar.employee_id = ?
       LIMIT 1`,
      [cycleId, employeeId]
    );
    return (rows as AppraisalRating[])[0];
  },

  async submitManagerRating(
    cycleId: string,
    employeeId: string,
    ratedBy: string,
    input: {
      manager_rating: number;
      final_rating?: number | null;
      manager_comments?: string | null;
    }
  ): Promise<AppraisalRating> {
    await goalsService.ensureRatingRecord(cycleId, employeeId);

    const newStatus = input.final_rating != null ? "calibrated" : "manager_done";

    await db.execute(
      `UPDATE appraisal_rating
       SET manager_rating = ?, final_rating = ?, manager_comments = ?,
           status = ?, rated_by = ?, updated_at = NOW()
       WHERE cycle_id = ? AND employee_id = ?`,
      [
        input.manager_rating,
        input.final_rating ?? null,
        input.manager_comments ?? null,
        newStatus,
        ratedBy,
        cycleId,
        employeeId,
      ]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ar.*,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              e.employee_code
       FROM appraisal_rating ar
       LEFT JOIN employees e ON e.id = ar.employee_id
       WHERE ar.cycle_id = ? AND ar.employee_id = ?
       LIMIT 1`,
      [cycleId, employeeId]
    );
    return (rows as AppraisalRating[])[0];
  },

  // ─── Skills ───────────────────────────────────────────────────────────────

  async listSkillMaster(): Promise<SkillMaster[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM skill_master WHERE is_active = 1 ORDER BY skill_category, skill_name"
    );
    return rows as SkillMaster[];
  },

  async createSkill(input: {
    skill_name: string;
    skill_category?: string | null;
    description?: string | null;
  }): Promise<SkillMaster> {
    await db.execute(
      `INSERT INTO skill_master (skill_name, skill_category, description)
       VALUES (?, ?, ?)`,
      [input.skill_name, input.skill_category ?? null, input.description ?? null]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM skill_master WHERE id = LAST_INSERT_ID() LIMIT 1"
    );
    return (rows as SkillMaster[])[0];
  },

  async listEmployeeSkills(employeeId: string): Promise<EmployeeSkill[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT es.*,
              sm.skill_name,
              sm.skill_category
       FROM employee_skill es
       JOIN skill_master sm ON sm.id = es.skill_id
       WHERE es.employee_id = ?
       ORDER BY sm.skill_category, sm.skill_name`,
      [employeeId]
    );
    return rows as EmployeeSkill[];
  },

  async upsertEmployeeSkill(
    employeeId: string,
    input: {
      skill_id: string;
      proficiency: "beginner" | "intermediate" | "advanced" | "expert";
      certified?: number;
      assessed_date?: string | null;
      notes?: string | null;
    }
  ): Promise<EmployeeSkill> {
    await db.execute(
      `INSERT INTO employee_skill
         (employee_id, skill_id, proficiency, certified, assessed_date, notes)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         proficiency   = VALUES(proficiency),
         certified     = VALUES(certified),
         assessed_date = VALUES(assessed_date),
         notes         = VALUES(notes)`,
      [
        employeeId,
        input.skill_id,
        input.proficiency,
        input.certified ?? 0,
        input.assessed_date ?? null,
        input.notes ?? null,
      ]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT es.*,
              sm.skill_name,
              sm.skill_category
       FROM employee_skill es
       JOIN skill_master sm ON sm.id = es.skill_id
       WHERE es.employee_id = ? AND es.skill_id = ?
       LIMIT 1`,
      [employeeId, input.skill_id]
    );
    return (rows as EmployeeSkill[])[0];
  },

  async deleteGoal(id: string, actorEmployeeId: string | null): Promise<void> {
    const [check] = await db.execute<RowDataPacket[]>(
      "SELECT id, employee_id, status FROM goal WHERE id = ? LIMIT 1",
      [id]
    );
    const row = (check as RowDataPacket[])[0];
    if (!row) throw Object.assign(new Error("Goal not found"), { statusCode: 404 });
    // Only the owner or admin can delete; completed goals cannot be deleted
    if (row.status === "completed") {
      throw Object.assign(new Error("Completed goals cannot be deleted"), { statusCode: 409 });
    }
    await db.execute("DELETE FROM goal WHERE id = ?", [id]);
  },

  async deleteAppraisalRating(id: string): Promise<void> {
    const [check] = await db.execute<RowDataPacket[]>(
      "SELECT id, status FROM appraisal_rating WHERE id = ? LIMIT 1",
      [id]
    );
    const row = (check as RowDataPacket[])[0];
    if (!row) throw Object.assign(new Error("Appraisal rating not found"), { statusCode: 404 });
    if (!["pending"].includes(String(row.status))) {
      throw Object.assign(new Error("Only pending ratings can be deleted"), { statusCode: 409 });
    }
    await db.execute("DELETE FROM appraisal_rating WHERE id = ?", [id]);
  },

  async deleteEmployeeSkill(employeeId: string, skillId: string): Promise<void> {
    await db.execute(
      "DELETE FROM employee_skill WHERE employee_id = ? AND skill_id = ?",
      [employeeId, skillId]
    );
  },
};
