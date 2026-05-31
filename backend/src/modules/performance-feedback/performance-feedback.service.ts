import { db } from "../../db/mysql";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import {
  PerformanceFeedbackCycle,
  PerformanceFeedbackRequest,
  CompetencyMaster,
  PerformanceFeedbackResponse,
  PerformanceFeedbackReport,
  DevelopmentPlan,
  DevelopmentPlanGoal,
  CreateCycleDto,
  LaunchCycleDto,
  SubmitFeedbackDto,
  CreateDevelopmentPlanDto,
  CompetencyScore,
  KpiScore,
} from "./performance-feedback.types";

export class PerformanceFeedbackService {
  /**
   * Create new feedback cycle
   */
  async createCycle(data: CreateCycleDto, createdBy: string): Promise<PerformanceFeedbackCycle> {
    const query = `
      INSERT INTO performance_feedback_cycle
      (cycle_name, period, start_date, end_date, deadline, appraisal_cycle_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await db.execute<ResultSetHeader>(query, [
      data.cycle_name,
      data.period,
      data.start_date,
      data.end_date,
      data.deadline,
      data.appraisal_cycle_id || null,
      createdBy,
    ]);

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM performance_feedback_cycle WHERE cycle_id = ?",
      [result.insertId]
    );

    return rows[0] as PerformanceFeedbackCycle;
  }

  /**
   * Get all cycles with optional filters
   */
  async getCycles(filters: { status?: string; period?: string }): Promise<PerformanceFeedbackCycle[]> {
    let query = "SELECT * FROM performance_feedback_cycle WHERE 1=1";
    const params: any[] = [];

    if (filters.status) {
      query += " AND status = ?";
      params.push(filters.status);
    }

    if (filters.period) {
      query += " AND period LIKE ?";
      params.push(`%${filters.period}%`);
    }

    query += " ORDER BY created_at DESC";

    const [rows] = await db.execute<RowDataPacket[]>(query, params);
    return rows as PerformanceFeedbackCycle[];
  }

  /**
   * Get single cycle by ID
   */
  async getCycleById(cycleId: string): Promise<PerformanceFeedbackCycle | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM performance_feedback_cycle WHERE cycle_id = ?",
      [cycleId]
    );

    return rows.length > 0 ? (rows[0] as PerformanceFeedbackCycle) : null;
  }

  /**
   * Update cycle
   */
  async updateCycle(cycleId: string, updates: Partial<CreateCycleDto>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.cycle_name !== undefined) {
      fields.push("cycle_name = ?");
      values.push(updates.cycle_name);
    }
    if (updates.period !== undefined) {
      fields.push("period = ?");
      values.push(updates.period);
    }
    if (updates.start_date !== undefined) {
      fields.push("start_date = ?");
      values.push(updates.start_date);
    }
    if (updates.end_date !== undefined) {
      fields.push("end_date = ?");
      values.push(updates.end_date);
    }
    if (updates.deadline !== undefined) {
      fields.push("deadline = ?");
      values.push(updates.deadline);
    }

    if (fields.length === 0) return;

    values.push(cycleId);
    await db.execute(
      `UPDATE performance_feedback_cycle SET ${fields.join(", ")} WHERE cycle_id = ?`,
      values
    );
  }

  /**
   * Close cycle (set status to closed)
   */
  async closeCycle(cycleId: string): Promise<void> {
    await db.execute(
      "UPDATE performance_feedback_cycle SET status = 'closed' WHERE cycle_id = ?",
      [cycleId]
    );
  }

  /**
   * Launch cycle - create requests for employees
   */
  async launchCycle(
    cycleId: string,
    data: LaunchCycleDto
  ): Promise<{ created: number; skipped: number; total: number }> {
    let created = 0;
    let skipped = 0;

    for (const empId of data.employee_ids) {
      // Get employee's manager from reporting_to
      const [empRows] = await db.execute<RowDataPacket[]>(
        "SELECT emp_id, reporting_to FROM employees WHERE emp_id = ?",
        [empId]
      );

      if (empRows.length === 0 || !empRows[0].reporting_to) {
        skipped++;
        continue;
      }

      const managerId = empRows[0].reporting_to;

      // Check if request already exists
      const [existingRows] = await db.execute<RowDataPacket[]>(
        "SELECT request_id FROM performance_feedback_request WHERE cycle_id = ? AND employee_id = ?",
        [cycleId, empId]
      );

      if (existingRows.length > 0) {
        skipped++;
        continue;
      }

      // Create request
      await db.execute(
        `INSERT INTO performance_feedback_request
        (cycle_id, employee_id, manager_id, status)
        VALUES (?, ?, ?, 'pending')`,
        [cycleId, empId, managerId]
      );

      created++;
    }

    // Update cycle status to active
    await db.execute(
      "UPDATE performance_feedback_cycle SET status = 'active' WHERE cycle_id = ?",
      [cycleId]
    );

    return {
      created,
      skipped,
      total: data.employee_ids.length,
    };
  }

  /**
   * Get requests with optional filters
   */
  async getRequests(filters: {
    cycle_id?: string;
    status?: string;
    manager_id?: string;
    employee_id?: string;
  }): Promise<PerformanceFeedbackRequest[]> {
    let query = "SELECT * FROM performance_feedback_request WHERE 1=1";
    const params: any[] = [];

    if (filters.cycle_id) {
      query += " AND cycle_id = ?";
      params.push(filters.cycle_id);
    }

    if (filters.status) {
      query += " AND status = ?";
      params.push(filters.status);
    }

    if (filters.manager_id) {
      query += " AND manager_id = ?";
      params.push(filters.manager_id);
    }

    if (filters.employee_id) {
      query += " AND employee_id = ?";
      params.push(filters.employee_id);
    }

    query += " ORDER BY created_at DESC";

    const [rows] = await db.execute<RowDataPacket[]>(query, params);
    return rows as PerformanceFeedbackRequest[];
  }

  /**
   * Get single request by ID
   */
  async getRequestById(requestId: string): Promise<PerformanceFeedbackRequest | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM performance_feedback_request WHERE request_id = ?",
      [requestId]
    );

    return rows.length > 0 ? (rows[0] as PerformanceFeedbackRequest) : null;
  }

  /**
   * Delete request
   */
  async deleteRequest(requestId: string): Promise<void> {
    await db.execute(
      "DELETE FROM performance_feedback_request WHERE request_id = ?",
      [requestId]
    );
  }
}
