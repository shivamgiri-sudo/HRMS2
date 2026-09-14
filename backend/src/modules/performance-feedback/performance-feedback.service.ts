import { randomUUID } from "node:crypto";

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

      const reviewerId = empRows[0].reporting_to;
      if (!reviewerId) {
        // reviewer_id is NOT NULL with an FK to employees. An employee with no
        // reporting manager cannot have a manager review raised for them.
        skipped++;
        continue;
      }

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
        (request_id, cycle_id, employee_id, reviewer_id, reviewer_type, status)
        VALUES (?, ?, ?, ?, 'manager', 'pending')`,
        [randomUUID(), cycleId, empId, reviewerId]
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
    reviewer_id?: string;
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

    if (filters.reviewer_id) {
      query += " AND reviewer_id = ?";
      params.push(filters.reviewer_id);
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
  }): Promise<CompetencyMaster> {
    // competency_master has no display_order column and nothing orders by one.
    const query = `
      INSERT INTO competency_master
      (competency_name, description, category, is_active)
      VALUES (?, ?, ?, 1)
    `;

    const [result] = await db.execute<ResultSetHeader>(query, [
      data.competency_name,
      data.description || null,
      data.category || null,
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
  ): Promise<{ request_id: string; competencies_recorded: number }> {
    // Verify request exists and manager is authorized
    const request = await this.getRequestById(data.request_id);
    if (!request) {
      throw new Error("Request not found");
    }
    if (request.reviewer_id !== managerId) {
      throw new Error("Unauthorized: not assigned manager");
    }

    // performance_feedback_response is one row per (request_id, competency_id),
    // with competency_id and rating both NOT NULL. The single blob row this used
    // to write - ratings_json, overall_strengths, development_areas - named four
    // columns the table does not have and omitted two it requires, so no feedback
    // submission has ever been stored.
    const competencies = data.ratings_json?.competencies ?? [];
    const kpis = data.ratings_json?.kpis ?? [];

    if (competencies.length === 0) {
      throw Object.assign(new Error("At least one competency rating is required."), {
        statusCode: 400,
        code: "NO_COMPETENCY_RATINGS",
      });
    }

    if (kpis.length > 0) {
      // Refused rather than dropped: this schema is competency-based and has no
      // KPI response store, so accepting them would discard them silently.
      throw Object.assign(
        new Error(
          "KPI ratings cannot be recorded here: the performance feedback schema " +
            "stores competency ratings only. KPI scoring belongs to the KPI module."
        ),
        { statusCode: 400, code: "KPI_RATINGS_UNSUPPORTED" }
      );
    }

    for (const c of competencies) {
      const rating = Number(c.rating);
      if (!c.competency_id || !Number.isFinite(rating) || rating < 1 || rating > 5) {
        throw Object.assign(
          new Error(
            `Competency ${c.competency_id ?? "(missing id)"} needs a rating between 1 and 5.`
          ),
          { statusCode: 400, code: "INVALID_COMPETENCY_RATING" }
        );
      }

      // unique_response (request_id, competency_id) makes this an upsert, which is
      // what re-submitting a review means.
      await db.execute(
        `INSERT INTO performance_feedback_response
           (response_id, request_id, competency_id, rating, comments, submitted_at)
         VALUES (?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           rating = VALUES(rating), comments = VALUES(comments), submitted_at = NOW()`,
        [randomUUID(), data.request_id, c.competency_id, Math.round(rating), c.comment ?? null]
      );
    }

    // 'submitted' is not in the status enum ('pending','completed','declined',
    // 'expired') and there is no submitted_at column - completed_at is the one.
    // The reviewer's closing narrative lands on the request, which is their
    // submission; generateReport reads it back as the report's manager_feedback.
    await db.execute(
      `UPDATE performance_feedback_request
          SET status = 'completed', completed_at = NOW(), overall_comments = ?
        WHERE request_id = ?`,
      [data.development_areas || data.overall_strengths || null, data.request_id]
    );

    return { request_id: data.request_id, competencies_recorded: competencies.length };
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

    // Every reviewer's ratings for this employee's cycle, not just this one
    // request: the schema is 360-degree - one request per reviewer, one response
    // row per competency - which is what total_reviewers counts.
    const [ratingRows] = await db.execute<RowDataPacket[]>(
      `SELECT resp.competency_id, resp.rating, resp.comments,
              cm.competency_name, req.reviewer_id, req.reviewer_type,
              req.overall_comments
         FROM performance_feedback_response resp
         JOIN performance_feedback_request req ON req.request_id = resp.request_id
         LEFT JOIN competency_master cm ON cm.competency_id = resp.competency_id
        WHERE req.cycle_id = ? AND req.employee_id = ?`,
      [request.cycle_id, request.employee_id]
    );

    if (ratingRows.length === 0) {
      throw new Error("Response not found");
    }

    // Mean per competency across reviewers
    const perCompetency = new Map<number, { name: string; total: number; count: number }>();
    for (const row of ratingRows) {
      const key = Number(row.competency_id);
      const entry = perCompetency.get(key) ?? {
        name: row.competency_name || `Competency ${key}`,
        total: 0,
        count: 0,
      };
      entry.total += Number(row.rating);
      entry.count += 1;
      perCompetency.set(key, entry);
    }

    const competencyScores = [...perCompetency.entries()].map(([competencyId, v]) => ({
      competency_id: competencyId,
      competency_name: v.name,
      score: v.total / v.count,
    }));

    const allRatings = ratingRows.map((r) => Number(r.rating));
    const overallScore =
      allRatings.length > 0
        ? allRatings.reduce((sum, r) => sum + r, 0) / allRatings.length
        : 0;

    const totalReviewers = new Set(ratingRows.map((r) => r.reviewer_id)).size;

    const managerFeedback =
      [
        ...new Set(
          ratingRows
            .filter((r) => r.reviewer_type === "manager" && r.overall_comments)
            .map((r) => String(r.overall_comments))
        ),
      ].join("\n\n") || null;

    // Identify development areas (scores < 3.0)
    const developmentAreas = competencyScores
      .filter((c) => c.score < 3.0)
      .map((c) => `${c.competency_name} (${c.score.toFixed(1)}/5)`)
      .join(", ");

    // Identify strengths (scores >= 4.0)
    const strengths = competencyScores
      .filter((c) => c.score >= 4.0)
      .map((c) => `${c.competency_name} (${c.score.toFixed(1)}/5)`)
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
          managerFeedback,
          reportId,
        ]
      );
    } else {
      // Create new report
      // report_id is CHAR(36) DEFAULT (UUID()), so insertId would come back 0.
      reportId = randomUUID();
      await db.execute(
        `INSERT INTO performance_feedback_report
         (report_id, cycle_id, employee_id, overall_score, strengths, development_areas, manager_feedback, total_reviewers)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          reportId,
          request.cycle_id,
          request.employee_id,
          parseFloat(overallScore.toFixed(2)),
          strengths || null,
          developmentAreas || null,
          managerFeedback,
          totalReviewers,
        ]
      );
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
        const description = `Low score on ${competencyName} (${compScore.score.toFixed(1)}/5) from performance feedback${
          managerFeedback ? `. Reviewer notes: ${managerFeedback}` : ""
        }`;

        // training_need has no title and no identified_date - created_at records
        // when it was raised - and its id is CHAR(36) DEFAULT (UUID()).
        const trainingNeedId = randomUUID();
        await db.execute(
          `INSERT INTO training_need
           (id, employee_id, need_type, description, priority, status, identified_by)
           VALUES (?, ?, 'performance_feedback', ?, ?, 'identified', ?)`,
          [
            trainingNeedId,
            request.employee_id,
            description,
            compScore.score < 2.0 ? "high" : "medium",
            request.reviewer_id || null,
          ]
        );

        trainingNeedIds.push(trainingNeedId);
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

      // development_plan hangs off a generated report (report_id NOT NULL) and
      // has no created_by or target_date: it carries manager_id and a
      // plan_start_date/plan_end_date range, all NOT NULL.
      const [reportRows] = await connection.execute<RowDataPacket[]>(
        "SELECT report_id FROM performance_feedback_report WHERE cycle_id = ? AND employee_id = ?",
        [data.cycle_id, data.employee_id]
      );

      if (reportRows.length === 0) {
        throw Object.assign(
          new Error(
            "No feedback report exists for this employee and cycle. Generate the " +
              "report before creating a development plan against it."
          ),
          { statusCode: 409, code: "REPORT_NOT_GENERATED" }
        );
      }

      const reportId = reportRows[0].report_id as string;

      // manager_id has an FK to employees with ON DELETE RESTRICT, so it has to be
      // a real employee rather than whatever the caller's auth id happens to be.
      const [managerRows] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM employees WHERE id = ? LIMIT 1",
        [createdBy]
      );

      let managerId: string | null = managerRows.length > 0 ? createdBy : null;
      if (!managerId) {
        const [reportsTo] = await connection.execute<RowDataPacket[]>(
          "SELECT reporting_to FROM employees WHERE id = ? LIMIT 1",
          [data.employee_id]
        );
        managerId = reportsTo.length > 0 ? (reportsTo[0].reporting_to as string) : null;
      }

      if (!managerId) {
        throw Object.assign(
          new Error("A development plan needs an owning manager, and none could be resolved."),
          { statusCode: 400, code: "PLAN_MANAGER_UNRESOLVED" }
        );
      }

      const goals = data.goals ?? [];
      const targetDates = goals
        .map((g) => g.target_date)
        .filter((d): d is string => Boolean(d))
        .sort();
      const planEndDate = targetDates[targetDates.length - 1] || data.target_date || null;

      if (!planEndDate) {
        throw Object.assign(
          new Error("A development plan needs an end date: give at least one goal a target date."),
          { statusCode: 400, code: "PLAN_END_DATE_REQUIRED" }
        );
      }

      // plan_id is CHAR(36) DEFAULT (UUID()); insertId would be 0 and every goal
      // would then be orphaned against a plan that does not exist.
      const planId = randomUUID();
      await connection.execute(
        `INSERT INTO development_plan
         (plan_id, report_id, employee_id, manager_id, plan_start_date, plan_end_date, status)
         VALUES (?, ?, ?, ?, CURDATE(), ?, 'draft')`,
        [planId, reportId, data.employee_id, managerId, planEndDate]
      );

      // Insert goals if provided
      if (goals.length > 0) {
        for (const goal of goals) {
          await connection.execute(
            `INSERT INTO development_plan_goal
             (goal_id, plan_id, goal_description, target_date, status)
             VALUES (?, ?, ?, ?, 'not-started')`,
            [randomUUID(), planId, goal.description, goal.target_date || null]
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
