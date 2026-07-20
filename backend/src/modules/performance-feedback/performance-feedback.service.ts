import { db } from "../../db/mysql.js";
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
  FormTemplateDto,
  ReportResponseDto,
} from "./performance-feedback.types.js";

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

  /**
   * Get competencies with optional filters
   */
  async getCompetencies(filters: {
    is_active?: boolean;
    category?: string;
  }): Promise<CompetencyMaster[]> {
    let query = "SELECT * FROM competency_master WHERE 1=1";
    const params: any[] = [];

    if (filters.is_active !== undefined) {
      query += " AND is_active = ?";
      params.push(filters.is_active ? 1 : 0);
    }

    if (filters.category) {
      query += " AND category = ?";
      params.push(filters.category);
    }

    query += " ORDER BY display_order ASC, competency_name ASC";

    const [rows] = await db.execute<RowDataPacket[]>(query, params);
    return rows as CompetencyMaster[];
  }

  /**
   * Create new competency
   */
  async createCompetency(data: {
    competency_name: string;
    description?: string;
    category?: string;
    display_order?: number;
  }): Promise<CompetencyMaster> {
    const query = `
      INSERT INTO competency_master
      (competency_name, description, category, display_order, is_active)
      VALUES (?, ?, ?, ?, 1)
    `;

    const [result] = await db.execute<ResultSetHeader>(query, [
      data.competency_name,
      data.description || null,
      data.category || null,
      data.display_order || 999,
    ]);

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM competency_master WHERE competency_id = ?",
      [result.insertId]
    );

    return rows[0] as CompetencyMaster;
  }

  /**
   * Update competency
   */
  async updateCompetency(
    competencyId: string,
    updates: {
      competency_name?: string;
      description?: string;
      category?: string;
      display_order?: number;
    }
  ): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.competency_name !== undefined) {
      fields.push("competency_name = ?");
      values.push(updates.competency_name);
    }
    if (updates.description !== undefined) {
      fields.push("description = ?");
      values.push(updates.description);
    }
    if (updates.category !== undefined) {
      fields.push("category = ?");
      values.push(updates.category);
    }
    if (updates.display_order !== undefined) {
      fields.push("display_order = ?");
      values.push(updates.display_order);
    }

    if (fields.length === 0) return;

    values.push(competencyId);
    await db.execute(
      `UPDATE competency_master SET ${fields.join(", ")} WHERE competency_id = ?`,
      values
    );
  }

  /**
   * Deactivate competency (soft delete)
   */
  async deactivateCompetency(competencyId: string): Promise<void> {
    await db.execute(
      "UPDATE competency_master SET is_active = 0 WHERE competency_id = ?",
      [competencyId]
    );
  }

  /**
   * Get form template for feedback submission
   */
  async getFormTemplate(requestId: string): Promise<FormTemplateDto> {
    // Get request
    const request = await this.getRequestById(requestId);
    if (!request) {
      throw new Error("Request not found");
    }

    // Get employee info
    const [empRows] = await db.execute<RowDataPacket[]>(
      "SELECT emp_id, full_name, designation FROM employees WHERE emp_id = ?",
      [request.employee_id]
    );

    if (empRows.length === 0) {
      throw new Error("Employee not found");
    }

    // Get active competencies
    const competencies = await this.getCompetencies({ is_active: true });

    // Get employee's KPIs (if assigned)
    const [kpiRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         k.kpi_id, k.kpi_name, k.metric_name, k.unit,
         k.target_value, k.actual_value
       FROM kpi k
       WHERE k.employee_id = ?
         AND k.is_active = 1`,
      [request.employee_id]
    );

    return {
      employee: {
        emp_id: empRows[0].emp_id,
        full_name: empRows[0].full_name,
        designation: empRows[0].designation,
      },
      competencies,
      kpis: kpiRows as any[],
    };
  }

  /**
   * Submit feedback response
   */
  async submitFeedback(
    data: SubmitFeedbackDto,
    managerId: string
  ): Promise<{ response_id: string }> {
    // Verify request exists and manager is authorized
    const request = await this.getRequestById(data.request_id);
    if (!request) {
      throw new Error("Request not found");
    }
    if (request.manager_id !== managerId) {
      throw new Error("Unauthorized: not assigned manager");
    }

    // Check if response already exists
    const [existing] = await db.execute<RowDataPacket[]>(
      "SELECT response_id FROM performance_feedback_response WHERE request_id = ?",
      [data.request_id]
    );

    let responseId: string;

    if (existing.length > 0) {
      // Update existing response
      responseId = existing[0].response_id;
      await db.execute(
        `UPDATE performance_feedback_response
         SET ratings_json = ?, overall_strengths = ?, development_areas = ?, submitted_at = NOW()
         WHERE response_id = ?`,
        [
          JSON.stringify(data.ratings_json),
          data.overall_strengths || null,
          data.development_areas || null,
          responseId,
        ]
      );
    } else {
      // Create new response
      const [result] = await db.execute<ResultSetHeader>(
        `INSERT INTO performance_feedback_response
         (request_id, ratings_json, overall_strengths, development_areas, submitted_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [
          data.request_id,
          JSON.stringify(data.ratings_json),
          data.overall_strengths || null,
          data.development_areas || null,
        ]
      );

      responseId = result.insertId.toString();
    }

    // Update request status
    await db.execute(
      "UPDATE performance_feedback_request SET status = 'submitted', submitted_at = NOW() WHERE request_id = ?",
      [data.request_id]
    );

    return { response_id: responseId };
  }

  /**
   * Generate performance feedback report
   * Aggregates scores, creates training needs for low scores (< 3.0)
   */
  async generateReport(requestId: string): Promise<{ report_id: string; training_need_ids: string[] }> {
    // Get request
    const request = await this.getRequestById(requestId);
    if (!request) {
      throw new Error("Request not found");
    }

    // Get response
    const [responseRows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM performance_feedback_response WHERE request_id = ?",
      [requestId]
    );

    if (responseRows.length === 0) {
      throw new Error("Response not found");
    }

    const response = responseRows[0];
    const ratingsJson = JSON.parse(response.ratings_json);

    // Calculate aggregated scores
    const competencyScores = ratingsJson.competencies.map((c: any) => ({
      competency_id: c.competency_id,
      competency_name: c.competency_name,
      score: c.rating,
    }));

    const kpiScores = ratingsJson.kpis.map((k: any) => ({
      kpi_id: k.kpi_id,
      kpi_name: k.kpi_name,
      score: k.rating,
    }));

    // Calculate overall score
    const allRatings = [
      ...ratingsJson.competencies.map((c: any) => c.rating),
      ...ratingsJson.kpis.map((k: any) => k.rating),
    ];
    const overallScore = allRatings.length > 0
      ? allRatings.reduce((sum: number, r: number) => sum + r, 0) / allRatings.length
      : 0;

    // Identify development areas (scores < 3.0)
    const developmentAreas = competencyScores
      .filter((c: any) => c.score < 3.0)
      .map((c: any) => `${c.competency_name} (${c.score}/5)`)
      .join(", ");

    // Identify strengths (scores >= 4.0)
    const strengths = competencyScores
      .filter((c: any) => c.score >= 4.0)
      .map((c: any) => `${c.competency_name} (${c.score}/5)`)
      .join(", ");

    // Check if report already exists for this cycle and employee
    const [existingReport] = await db.execute<RowDataPacket[]>(
      "SELECT report_id FROM performance_feedback_report WHERE cycle_id = ? AND employee_id = ?",
      [request.cycle_id, request.employee_id]
    );

    let reportId: string;

    if (existingReport.length > 0) {
      // Update existing report
      reportId = existingReport[0].report_id;
      await db.execute(
        `UPDATE performance_feedback_report
         SET overall_score = ?, strengths = ?, development_areas = ?,
             manager_feedback = ?, report_generated_at = NOW()
         WHERE report_id = ?`,
        [
          parseFloat(overallScore.toFixed(2)),
          strengths || null,
          developmentAreas || null,
          response.development_areas || null,
          reportId,
        ]
      );
    } else {
      // Create new report
      const [result] = await db.execute<ResultSetHeader>(
        `INSERT INTO performance_feedback_report
         (cycle_id, employee_id, overall_score, strengths, development_areas, manager_feedback, total_reviewers)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [
          request.cycle_id,
          request.employee_id,
          parseFloat(overallScore.toFixed(2)),
          strengths || null,
          developmentAreas || null,
          response.development_areas || null,
        ]
      );

      reportId = result.insertId.toString();
    }

    // Auto-create training needs for low scores (< 3.0)
    const trainingNeedIds: string[] = [];

    for (const compScore of competencyScores) {
      if (compScore.score < 3.0) {
        // Get competency details for better description
        const [compRows] = await db.execute<RowDataPacket[]>(
          "SELECT competency_name, category FROM competency_master WHERE competency_id = ?",
          [compScore.competency_id]
        );

        const competencyName = compRows.length > 0 ? compRows[0].competency_name : compScore.competency_name;
        const description = response.development_areas || `Low score on ${competencyName} (${compScore.score}/5) from performance feedback`;

        // Insert training need
        const [trainingResult] = await db.execute<ResultSetHeader>(
          `INSERT INTO training_need
           (employee_id, need_type, title, description, identified_date)
           VALUES (?, 'performance_feedback', ?, ?, CURDATE())`,
          [request.employee_id, competencyName, description]
        );

        trainingNeedIds.push(trainingResult.insertId.toString());
      }
    }

    return { report_id: reportId, training_need_ids: trainingNeedIds };
  }

  /**
   * Get generated reports constrained to an employee or a manager's team.
   * An empty filter is reserved for callers whose role grants organization-wide access.
   */
  async getReports(filters: {
    cycle_id?: string;
    employee_id?: string;
    manager_id?: string;
  }): Promise<ReportResponseDto[]> {
    let query = `
      SELECT
        pfr.report_id AS id,
        pfr.cycle_id,
        pfr.employee_id,
        NULL AS self_rating,
        NULL AS peer_avg_rating,
        NULL AS manager_rating,
        pfr.overall_score AS final_rating,
        pfr.strengths AS consolidated_strengths,
        pfr.development_areas AS consolidated_improvements,
        pfr.report_generated_at,
        pfc.cycle_name,
        e.full_name AS employee_name
      FROM performance_feedback_report pfr
      JOIN performance_feedback_cycle pfc ON pfc.cycle_id = pfr.cycle_id
      JOIN employees e ON e.id = pfr.employee_id
      WHERE 1=1`;
    const params: string[] = [];

    if (filters.cycle_id) {
      query += " AND pfr.cycle_id = ?";
      params.push(filters.cycle_id);
    }
    if (filters.employee_id) {
      query += " AND pfr.employee_id = ?";
      params.push(filters.employee_id);
    }
    if (filters.manager_id) {
      query += " AND e.reporting_manager_id = ?";
      params.push(filters.manager_id);
    }

    query += " ORDER BY pfr.report_generated_at DESC";
    const [rows] = await db.execute<RowDataPacket[]>(query, params);
    return rows as ReportResponseDto[];
  }

  /**
   * Get one generated report while enforcing the same employee/team scope.
   */
  async getReportById(
    reportId: string,
    scope: { employee_id?: string; manager_id?: string },
  ): Promise<ReportResponseDto | null> {
    let query = `
      SELECT
        pfr.report_id AS id,
        pfr.cycle_id,
        pfr.employee_id,
        NULL AS self_rating,
        NULL AS peer_avg_rating,
        NULL AS manager_rating,
        pfr.overall_score AS final_rating,
        pfr.strengths AS consolidated_strengths,
        pfr.development_areas AS consolidated_improvements,
        pfr.report_generated_at,
        pfc.cycle_name,
        e.full_name AS employee_name
      FROM performance_feedback_report pfr
      JOIN performance_feedback_cycle pfc ON pfc.cycle_id = pfr.cycle_id
      JOIN employees e ON e.id = pfr.employee_id
      WHERE pfr.report_id = ?`;
    const params = [reportId];

    if (scope.employee_id && scope.manager_id) {
      query += " AND (pfr.employee_id = ? OR e.reporting_manager_id = ?)";
      params.push(scope.employee_id, scope.manager_id);
    } else if (scope.employee_id) {
      query += " AND pfr.employee_id = ?";
      params.push(scope.employee_id);
    } else if (scope.manager_id) {
      query += " AND e.reporting_manager_id = ?";
      params.push(scope.manager_id);
    }

    query += " LIMIT 1";
    const [rows] = await db.execute<RowDataPacket[]>(query, params);
    const report = rows[0] as ReportResponseDto | undefined;
    return report ? { ...report, feedback_details: [] } : null;
  }

  /**
   * Create development plan with goals in transaction
   */
  async createDevelopmentPlan(data: CreateDevelopmentPlanDto, createdBy: string): Promise<DevelopmentPlan> {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Insert plan
      const [planResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO development_plan
         (employee_id, created_by, target_date, status)
         VALUES (?, ?, ?, 'draft')`,
        [data.employee_id, createdBy, data.target_date || null]
      );

      const planId = planResult.insertId;

      // Insert goals if provided
      if (data.goals && data.goals.length > 0) {
        for (const goal of data.goals) {
          await connection.execute(
            `INSERT INTO development_plan_goal
             (plan_id, description, target_date, status)
             VALUES (?, ?, ?, 'pending')`,
            [planId, goal.description, goal.target_date || null]
          );
        }
      }

      await connection.commit();

      // Fetch created plan
      const [planRows] = await db.execute<RowDataPacket[]>(
        "SELECT * FROM development_plan WHERE plan_id = ?",
        [planId]
      );

      return planRows[0] as DevelopmentPlan;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Get development plans with filters
   */
  async getDevelopmentPlans(filters: {
    employee_id?: string;
    status?: string;
  }): Promise<DevelopmentPlan[]> {
    let query = "SELECT * FROM development_plan WHERE 1=1";
    const params: any[] = [];

    if (filters.employee_id) {
      query += " AND employee_id = ?";
      params.push(filters.employee_id);
    }

    if (filters.status) {
      query += " AND status = ?";
      params.push(filters.status);
    }

    query += " ORDER BY created_at DESC";

    const [rows] = await db.execute<RowDataPacket[]>(query, params);
    return rows as DevelopmentPlan[];
  }

  /**
   * Update development plan fields
   */
  async updateDevelopmentPlan(
    planId: string,
    updates: {
      target_date?: string;
      status?: string;
    }
  ): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.target_date !== undefined) {
      fields.push("target_date = ?");
      values.push(updates.target_date);
    }

    if (updates.status !== undefined) {
      fields.push("status = ?");
      values.push(updates.status);
    }

    if (fields.length === 0) return;

    values.push(planId);
    await db.execute(
      `UPDATE development_plan SET ${fields.join(", ")} WHERE plan_id = ?`,
      values
    );
  }

  /**
   * Update development plan goal
   */
  async updateGoal(
    goalId: string,
    updates: {
      description?: string;
      target_date?: string;
      status?: string;
      actual_date?: string;
    }
  ): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.description !== undefined) {
      fields.push("description = ?");
      values.push(updates.description);
    }

    if (updates.target_date !== undefined) {
      fields.push("target_date = ?");
      values.push(updates.target_date);
    }

    if (updates.status !== undefined) {
      fields.push("status = ?");
      values.push(updates.status);
    }

    if (updates.actual_date !== undefined) {
      fields.push("actual_date = ?");
      values.push(updates.actual_date);
    }

    if (fields.length === 0) return;

    values.push(goalId);
    await db.execute(
      `UPDATE development_plan_goal SET ${fields.join(", ")} WHERE goal_id = ?`,
      values
    );
  }
}
