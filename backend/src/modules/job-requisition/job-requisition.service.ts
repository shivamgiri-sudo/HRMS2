/**
 * Job Requisition Service
 * Stage 1 of HRMS Journey: Workforce Requirement and Job Requisition
 *
 * Handles:
 * - CRUD operations for job requisitions
 * - Approval workflow integration
 * - Candidate-requisition linking
 * - Dashboard metrics and analytics
 */

import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { workflowService } from "../workflow/workflow.service.js";
import { inboxService } from "../inbox/inbox.service.js";
import type {
  JobRequisition,
  JobRequisitionSummary,
  CreateRequisitionInput,
  UpdateRequisitionInput,
  RequisitionFilters,
  RequisitionCandidate,
  RequisitionApprovalLog,
  PaginatedResult,
  RequisitionDashboardMetrics,
  RequisitionFunnel,
  LmsBatchOption,
  ApprovalStatus,
  CandidateOutcome,
  AggregateFunnel,
  JoinedEmployee,
  HandoverPack,
} from "./job-requisition.types.js";
import { emailService } from "../communication/email.service.js";

function generateRequisitionCode(): string {
  const now = new Date();
  const year = now.getFullYear().toString().slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `REQ-${year}${month}-${random}`;
}

export const jobRequisitionService = {
  /**
   * List requisitions with filters and pagination
   */
  async listRequisitions(
    filters: RequisitionFilters = {}
  ): Promise<PaginatedResult<JobRequisitionSummary>> {
    const page = Math.max(1, Math.floor(filters.page ?? 1));
    const limit = Math.min(500, Math.max(1, Math.floor(filters.limit ?? 20)));
    const offset = (page - 1) * limit;

    const conditions: string[] = ["jr.active_status = 1"];
    const params: unknown[] = [];

    if (filters.branch_id) {
      conditions.push("jr.branch_id = ?");
      params.push(filters.branch_id);
    }
    if (filters.branch_name) {
      conditions.push("jr.branch_name = ?");
      params.push(filters.branch_name);
    }
    if (filters.process_id) {
      conditions.push("jr.process_id = ?");
      params.push(filters.process_id);
    }
    if (filters.department_id) {
      conditions.push("jr.department_id = ?");
      params.push(filters.department_id);
    }
    if (filters.approval_status) {
      conditions.push("jr.approval_status = ?");
      params.push(filters.approval_status);
    }
    if (filters.priority) {
      conditions.push("jr.priority = ?");
      params.push(filters.priority);
    }
    if (filters.employment_type) {
      conditions.push("jr.employment_type = ?");
      params.push(filters.employment_type);
    }
    if (filters.requested_by) {
      conditions.push("jr.requested_by = ?");
      params.push(filters.requested_by);
    }
    if (filters.owner_recruiter_id) {
      conditions.push("jr.owner_recruiter_id = ?");
      params.push(filters.owner_recruiter_id);
    }
    if (filters.from_date) {
      conditions.push("DATE(jr.created_at) >= ?");
      params.push(filters.from_date);
    }
    if (filters.to_date) {
      conditions.push("DATE(jr.created_at) <= ?");
      params.push(filters.to_date);
    }
    if (filters.search) {
      conditions.push(
        "(jr.requisition_code LIKE ? OR jr.designation_name LIKE ? OR jr.branch_name LIKE ? OR jr.process_name LIKE ?)"
      );
      const searchTerm = `%${filters.search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }
    if (!filters.include_closed) {
      conditions.push("jr.approval_status NOT IN ('closed', 'cancelled')");
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM job_requisition jr ${whereClause}`,
      params
    );
    const total = Number(countRows[0]?.total ?? 0);

    // Use db.query() here — db.execute() (prepared statements) crashes mysql2 when a derived
    // subquery contains SUM(CASE WHEN...). LIMIT/OFFSET are safe integer-interpolated.
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT
        jr.*,
        (jr.requested_headcount - jr.fulfilled_headcount) AS open_positions,
        e.full_name AS owner_recruiter_name,
        DATEDIFF(CURRENT_DATE(), DATE(jr.created_at)) AS aging_days,
        CASE
          WHEN jr.approval_status = 'approved' AND jr.fulfilled_headcount < jr.requested_headcount THEN 'active'
          WHEN jr.approval_status = 'approved' AND jr.fulfilled_headcount >= jr.requested_headcount THEN 'filled'
          WHEN jr.approval_status IN ('draft', 'pending_approval') THEN 'pending'
          ELSE jr.approval_status
        END AS derived_status,
        COALESCE(cand.total_candidates, 0) AS total_candidates,
        COALESCE(cand.interviewed_candidates, 0) AS interviewed_candidates,
        COALESCE(cand.selected_candidates, 0) AS selected_candidates,
        COALESCE(cand.rejected_candidates, 0) AS rejected_candidates,
        COALESCE(cand.pipeline_candidates, 0) AS pipeline_candidates
       FROM job_requisition jr
       LEFT JOIN employees e ON e.id = jr.owner_recruiter_id
       LEFT JOIN (
         SELECT
           requisition_id,
           COUNT(*) AS total_candidates,
           COUNT(*) AS interviewed_candidates,
           SUM(CASE WHEN outcome = 'selected' THEN 1 ELSE 0 END) AS selected_candidates,
           SUM(CASE WHEN outcome = 'rejected' THEN 1 ELSE 0 END) AS rejected_candidates,
           SUM(CASE WHEN outcome = 'in_progress' THEN 1 ELSE 0 END) AS pipeline_candidates
         FROM job_requisition_candidate
         GROUP BY requisition_id
       ) cand ON cand.requisition_id = jr.id
       ${whereClause}
       ORDER BY
         CASE jr.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
         jr.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    return {
      data: rows as JobRequisitionSummary[],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  /**
   * Get single requisition by ID
   */
  async getRequisition(id: string): Promise<JobRequisitionSummary | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
        jr.*,
        (jr.requested_headcount - jr.fulfilled_headcount) AS open_positions,
        e.full_name AS owner_recruiter_name,
        DATEDIFF(CURRENT_DATE(), DATE(jr.created_at)) AS aging_days,
        CASE
          WHEN jr.approval_status = 'approved' AND jr.fulfilled_headcount < jr.requested_headcount THEN 'active'
          WHEN jr.approval_status = 'approved' AND jr.fulfilled_headcount >= jr.requested_headcount THEN 'filled'
          WHEN jr.approval_status IN ('draft', 'pending_approval') THEN 'pending'
          ELSE jr.approval_status
        END AS derived_status,
        COALESCE(cand.total_candidates, 0) AS total_candidates,
        COALESCE(cand.interviewed_candidates, 0) AS interviewed_candidates,
        COALESCE(cand.selected_candidates, 0) AS selected_candidates,
        COALESCE(cand.rejected_candidates, 0) AS rejected_candidates,
        COALESCE(cand.pipeline_candidates, 0) AS pipeline_candidates
       FROM job_requisition jr
       LEFT JOIN employees e ON e.id = jr.owner_recruiter_id
       LEFT JOIN (
         SELECT
           requisition_id,
           COUNT(*) AS total_candidates,
           COUNT(*) AS interviewed_candidates,
           SUM(CASE WHEN outcome = 'selected' THEN 1 ELSE 0 END) AS selected_candidates,
           SUM(CASE WHEN outcome = 'rejected' THEN 1 ELSE 0 END) AS rejected_candidates,
           SUM(CASE WHEN outcome = 'in_progress' THEN 1 ELSE 0 END) AS pipeline_candidates
         FROM job_requisition_candidate
         GROUP BY requisition_id
       ) cand ON cand.requisition_id = jr.id
       WHERE jr.id = ? AND jr.active_status = 1
       LIMIT 1`,
      [id]
    );
    return (rows[0] as JobRequisitionSummary) ?? null;
  },

  /**
   * Get requisition by code
   */
  async getRequisitionByCode(code: string): Promise<JobRequisitionSummary | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM job_requisition WHERE requisition_code = ? AND active_status = 1 LIMIT 1",
      [code]
    );
    if (!rows[0]) return null;
    return this.getRequisition(rows[0].id as string);
  },

  /**
   * Create a new job requisition
   */
  async createRequisition(
    input: CreateRequisitionInput,
    requestedBy: string,
    requestedByName: string | null
  ): Promise<JobRequisition> {
    const id = randomUUID();
    const code = generateRequisitionCode();

    const preferredSourcesJson = input.preferred_sources
      ? JSON.stringify(input.preferred_sources)
      : null;

    await db.execute(
      `INSERT INTO job_requisition (
        id, requisition_code, designation_id, designation_name, department_id, department_name,
        branch_id, branch_name, process_id, process_name, requested_headcount, employment_type,
        salary_min, salary_max, experience_min_years, experience_max_years, education_requirement,
        skills_required, job_description, shift_requirement, rotational_shift, night_shift_required,
        target_joining_date, requisition_validity, priority, requisition_type, business_justification,
        preferred_sources, internal_posting, requested_by, requested_by_name, approval_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
      [
        id,
        code,
        input.designation_id ?? null,
        input.designation_name,
        input.department_id ?? null,
        input.department_name ?? null,
        input.branch_id ?? null,
        input.branch_name,
        input.process_id ?? null,
        input.process_name ?? null,
        input.requested_headcount,
        input.employment_type ?? "full_time",
        input.salary_min ?? null,
        input.salary_max ?? null,
        input.experience_min_years ?? null,
        input.experience_max_years ?? null,
        input.education_requirement ?? null,
        input.skills_required ?? null,
        input.job_description ?? null,
        input.shift_requirement ?? null,
        input.rotational_shift ? 1 : 0,
        input.night_shift_required ? 1 : 0,
        input.target_joining_date ?? null,
        input.requisition_validity ?? null,
        input.priority ?? "normal",
        input.requisition_type ?? "new_position",
        input.business_justification ?? null,
        preferredSourcesJson,
        input.internal_posting ? 1 : 0,
        requestedBy,
        requestedByName,
      ]
    );

    await this.logApprovalAction(id, 1, "submitted", requestedBy, requestedByName, null, "Requisition created as draft");

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM job_requisition WHERE id = ? LIMIT 1",
      [id]
    );
    return rows[0] as JobRequisition;
  },

  /**
   * Update an existing requisition
   */
  async updateRequisition(
    id: string,
    input: UpdateRequisitionInput,
    actorId: string
  ): Promise<JobRequisition> {
    const existing = await this.getRequisition(id);
    if (!existing) {
      throw Object.assign(new Error("Requisition not found"), { statusCode: 404 });
    }

    if (existing.approval_status === "approved" || existing.approval_status === "closed") {
      const allowedFields = ["owner_recruiter_id"];
      const attemptedFields = Object.keys(input);
      const disallowedChanges = attemptedFields.filter((f) => !allowedFields.includes(f));
      if (disallowedChanges.length > 0) {
        throw Object.assign(
          new Error(`Cannot modify approved/closed requisition. Only recruiter assignment is allowed.`),
          { statusCode: 409 }
        );
      }
    }

    const sets: string[] = [];
    const params: unknown[] = [];

    const allowedFields: (keyof UpdateRequisitionInput)[] = [
      "designation_id", "designation_name", "department_id", "department_name",
      "branch_id", "branch_name", "process_id", "process_name", "requested_headcount",
      "employment_type", "salary_min", "salary_max", "experience_min_years", "experience_max_years",
      "education_requirement", "skills_required", "job_description", "shift_requirement",
      "rotational_shift", "night_shift_required", "target_joining_date", "requisition_validity",
      "priority", "requisition_type", "business_justification", "preferred_sources",
      "internal_posting", "owner_recruiter_id",
    ];

    for (const field of allowedFields) {
      if (field in input) {
        const value = input[field];
        if (field === "preferred_sources" && Array.isArray(value)) {
          sets.push(`${field} = ?`);
          params.push(JSON.stringify(value));
        } else if (field === "rotational_shift" || field === "night_shift_required" || field === "internal_posting") {
          sets.push(`${field} = ?`);
          params.push(value ? 1 : 0);
        } else {
          sets.push(`${field} = ?`);
          params.push(value ?? null);
        }
      }
    }

    if (sets.length === 0) {
      return existing;
    }

    sets.push("updated_at = NOW()");
    params.push(id);

    await db.execute(
      `UPDATE job_requisition SET ${sets.join(", ")} WHERE id = ?`,
      params
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM job_requisition WHERE id = ? LIMIT 1",
      [id]
    );
    return rows[0] as JobRequisition;
  },

  /**
   * Submit requisition for approval
   */
  async submitForApproval(
    id: string,
    actorId: string,
    actorName: string | null,
    actorRole: string | null
  ): Promise<JobRequisition> {
    const existing = await this.getRequisition(id);
    if (!existing) {
      throw Object.assign(new Error("Requisition not found"), { statusCode: 404 });
    }

    if (existing.approval_status !== "draft" && existing.approval_status !== "rejected") {
      throw Object.assign(
        new Error(`Cannot submit requisition with status: ${existing.approval_status}`),
        { statusCode: 409 }
      );
    }

    let approvalRequestId: string | null = null;
    try {
      const request = await workflowService.createRequest({
        workflow_code: "JOB_REQUISITION_APPROVAL",
        module_key: "recruitment",
        entity_type: "job_requisition",
        entity_id: id,
        requested_by: actorId,
        summary_text: `Job Requisition: ${existing.requisition_code} - ${existing.designation_name} at ${existing.branch_name}`,
      });
      approvalRequestId = request.id;
    } catch (err) {
      console.warn("[JobRequisition] Workflow creation failed, using direct approval:", err);
    }

    await db.execute(
      `UPDATE job_requisition
       SET approval_status = 'pending_approval', approval_request_id = ?, updated_at = NOW()
       WHERE id = ?`,
      [approvalRequestId, id]
    );

    await this.logApprovalAction(id, 1, "submitted", actorId, actorName, actorRole, "Submitted for approval");

    // Notify approver-role users (branch_head, hr, super_admin) — fire-and-forget
    this.notifyApprovers(
      existing,
      `Requisition Approval Needed: ${existing.requisition_code}`,
      `${existing.designation_name} at ${existing.branch_name} — ${existing.requested_headcount} headcount — submitted by ${actorName ?? "recruiter"}`,
      `/recruitment/job-requisition`
    ).catch((e: unknown) => console.warn("[JR notify]", e));

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM job_requisition WHERE id = ? LIMIT 1",
      [id]
    );
    return rows[0] as JobRequisition;
  },

  /**
   * Approve a requisition
   */
  async approveRequisition(
    id: string,
    actorId: string,
    actorName: string | null,
    actorRole: string | null,
    remarks?: string
  ): Promise<JobRequisition> {
    const existing = await this.getRequisition(id);
    if (!existing) {
      throw Object.assign(new Error("Requisition not found"), { statusCode: 404 });
    }

    if (existing.approval_status !== "pending_approval") {
      throw Object.assign(
        new Error(`Cannot approve requisition with status: ${existing.approval_status}`),
        { statusCode: 409 }
      );
    }

    if (existing.approval_request_id) {
      try {
        await workflowService.act(existing.approval_request_id, actorId, "approved", remarks);
      } catch (err) {
        console.warn("[JobRequisition] Workflow action failed:", err);
      }
    }

    await db.execute(
      `UPDATE job_requisition
       SET approval_status = 'approved', approved_by = ?, approved_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [actorId, id]
    );

    await this.logApprovalAction(id, 2, "approved", actorId, actorName, actorRole, remarks ?? "Approved");

    // Notify the requisition raiser
    inboxService.createItem({
      user_id: existing.requested_by,
      type: "requisition_approved",
      title: `Requisition Approved: ${existing.requisition_code}`,
      description: `${existing.designation_name} at ${existing.branch_name} has been approved by ${actorName ?? "management"}. Recruitment can begin.`,
      entity_type: "job_requisition",
      entity_id: id,
      action_url: `/recruitment/job-requisition`,
      priority: "high",
    }).catch((e: unknown) => console.warn("[JR notify]", e));

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM job_requisition WHERE id = ? LIMIT 1",
      [id]
    );
    return rows[0] as JobRequisition;
  },

  /**
   * Reject a requisition
   */
  async rejectRequisition(
    id: string,
    actorId: string,
    actorName: string | null,
    actorRole: string | null,
    reason: string
  ): Promise<JobRequisition> {
    const existing = await this.getRequisition(id);
    if (!existing) {
      throw Object.assign(new Error("Requisition not found"), { statusCode: 404 });
    }

    if (existing.approval_status !== "pending_approval") {
      throw Object.assign(
        new Error(`Cannot reject requisition with status: ${existing.approval_status}`),
        { statusCode: 409 }
      );
    }

    if (existing.approval_request_id) {
      try {
        await workflowService.act(existing.approval_request_id, actorId, "rejected", reason);
      } catch (err) {
        console.warn("[JobRequisition] Workflow action failed:", err);
      }
    }

    await db.execute(
      `UPDATE job_requisition
       SET approval_status = 'rejected', rejection_reason = ?, updated_at = NOW()
       WHERE id = ?`,
      [reason, id]
    );

    await this.logApprovalAction(id, 2, "rejected", actorId, actorName, actorRole, reason);

    // Notify the requisition raiser
    inboxService.createItem({
      user_id: existing.requested_by,
      type: "requisition_rejected",
      title: `Requisition Rejected: ${existing.requisition_code}`,
      description: `${existing.designation_name} at ${existing.branch_name} was rejected by ${actorName ?? "management"}. Reason: ${reason}`,
      entity_type: "job_requisition",
      entity_id: id,
      action_url: `/recruitment/job-requisition`,
      priority: "high",
    }).catch((e: unknown) => console.warn("[JR notify]", e));

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM job_requisition WHERE id = ? LIMIT 1",
      [id]
    );
    return rows[0] as JobRequisition;
  },

  /**
   * Close a requisition (mark as filled or cancelled)
   */
  async closeRequisition(
    id: string,
    actorId: string,
    reason: string
  ): Promise<JobRequisition> {
    const existing = await this.getRequisition(id);
    if (!existing) {
      throw Object.assign(new Error("Requisition not found"), { statusCode: 404 });
    }

    await db.execute(
      `UPDATE job_requisition
       SET approval_status = 'closed', closed_at = NOW(), closed_reason = ?, updated_at = NOW()
       WHERE id = ?`,
      [reason, id]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM job_requisition WHERE id = ? LIMIT 1",
      [id]
    );
    return rows[0] as JobRequisition;
  },

  /**
   * Link a candidate to a requisition
   */
  async linkCandidate(
    requisitionId: string,
    candidateId: string,
    linkedBy: string,
    linkSource: "manual" | "auto_match" | "candidate_applied" = "manual",
    remarks?: string
  ): Promise<RequisitionCandidate> {
    const requisition = await this.getRequisition(requisitionId);
    if (!requisition) {
      throw Object.assign(new Error("Requisition not found"), { statusCode: 404 });
    }

    if (requisition.approval_status !== "approved") {
      throw Object.assign(
        new Error("Can only link candidates to approved requisitions"),
        { statusCode: 409 }
      );
    }

    const [existingLink] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM job_requisition_candidate WHERE requisition_id = ? AND candidate_id = ? LIMIT 1",
      [requisitionId, candidateId]
    );

    if (existingLink[0]) {
      throw Object.assign(
        new Error("Candidate is already linked to this requisition"),
        { statusCode: 409 }
      );
    }

    const [candidateRows] = await db.execute<RowDataPacket[]>(
      "SELECT current_stage FROM ats_candidate WHERE id = ? LIMIT 1",
      [candidateId]
    );
    const currentStage = candidateRows[0]?.current_stage ?? null;

    const id = randomUUID();
    await db.execute(
      `INSERT INTO job_requisition_candidate (id, requisition_id, candidate_id, linked_by, link_source, current_stage, outcome, remarks)
       VALUES (?, ?, ?, ?, ?, ?, 'in_progress', ?)`,
      [id, requisitionId, candidateId, linkedBy, linkSource, currentStage, remarks ?? null]
    );

    await db.execute(
      "UPDATE ats_candidate SET requisition_id = ? WHERE id = ?",
      [requisitionId, candidateId]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM job_requisition_candidate WHERE id = ? LIMIT 1",
      [id]
    );
    return rows[0] as RequisitionCandidate;
  },

  /**
   * Update candidate outcome in requisition
   */
  async updateCandidateOutcome(
    requisitionId: string,
    candidateId: string,
    outcome: CandidateOutcome,
    remarks?: string
  ): Promise<void> {
    await db.execute(
      `UPDATE job_requisition_candidate
       SET outcome = ?, outcome_at = NOW(), remarks = COALESCE(?, remarks)
       WHERE requisition_id = ? AND candidate_id = ?`,
      [outcome, remarks ?? null, requisitionId, candidateId]
    );

    if (outcome === "selected") {
      await db.execute(
        `UPDATE job_requisition
         SET fulfilled_headcount = fulfilled_headcount + 1, updated_at = NOW()
         WHERE id = ? AND fulfilled_headcount < requested_headcount`,
        [requisitionId]
      );

      const [check] = await db.execute<RowDataPacket[]>(
        "SELECT fulfilled_headcount, requested_headcount FROM job_requisition WHERE id = ?",
        [requisitionId]
      );
      if (check[0] && check[0].fulfilled_headcount >= check[0].requested_headcount) {
        await db.execute(
          `UPDATE job_requisition SET approval_status = 'closed', closed_at = NOW(), closed_reason = 'All positions filled' WHERE id = ?`,
          [requisitionId]
        );
      }
    }
  },

  /**
   * Get candidates linked to a requisition
   */
  async getRequisitionCandidates(requisitionId: string): Promise<Array<RequisitionCandidate & { candidate_name: string; mobile: string; email: string }>> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT jrc.*, c.full_name AS candidate_name, c.mobile, c.email, c.current_stage AS latest_stage
       FROM job_requisition_candidate jrc
       JOIN ats_candidate c ON c.id = jrc.candidate_id
       WHERE jrc.requisition_id = ?
       ORDER BY jrc.linked_at DESC`,
      [requisitionId]
    );
    return rows as Array<RequisitionCandidate & { candidate_name: string; mobile: string; email: string }>;
  },

  /**
   * Get approval history for a requisition
   */
  async getApprovalHistory(requisitionId: string): Promise<RequisitionApprovalLog[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM job_requisition_approval_log
       WHERE requisition_id = ?
       ORDER BY action_at ASC`,
      [requisitionId]
    );
    return rows as RequisitionApprovalLog[];
  },

  /**
   * Get dashboard metrics
   */
  async getDashboardMetrics(filters: { branch_id?: string; from_date?: string; to_date?: string } = {}): Promise<RequisitionDashboardMetrics> {
    const conditions: string[] = ["active_status = 1"];
    const params: unknown[] = [];

    if (filters.branch_id) {
      conditions.push("branch_id = ?");
      params.push(filters.branch_id);
    }
    if (filters.from_date) {
      conditions.push("DATE(created_at) >= ?");
      params.push(filters.from_date);
    }
    if (filters.to_date) {
      conditions.push("DATE(created_at) <= ?");
      params.push(filters.to_date);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const [metrics] = await db.execute<RowDataPacket[]>(
      `SELECT
        COUNT(*) AS total_requisitions,
        SUM(CASE WHEN approval_status NOT IN ('closed', 'cancelled') THEN 1 ELSE 0 END) AS open_requisitions,
        SUM(CASE WHEN approval_status = 'pending_approval' THEN 1 ELSE 0 END) AS pending_approval,
        SUM(CASE WHEN approval_status = 'approved' AND fulfilled_headcount < requested_headcount THEN 1 ELSE 0 END) AS approved_active,
        SUM(CASE WHEN approval_status = 'approved' THEN (requested_headcount - fulfilled_headcount) ELSE 0 END) AS total_open_positions,
        SUM(fulfilled_headcount) AS total_fulfilled,
        ROUND(
          SUM(fulfilled_headcount) * 100.0 / NULLIF(SUM(requested_headcount), 0),
          1
        ) AS fill_rate_percent,
        AVG(
          CASE WHEN approval_status = 'closed' AND closed_at IS NOT NULL AND approved_at IS NOT NULL
          THEN DATEDIFF(closed_at, approved_at)
          ELSE NULL END
        ) AS avg_time_to_fill_days
       FROM job_requisition
       ${whereClause}`,
      params
    );

    const [byPriority] = await db.execute<RowDataPacket[]>(
      `SELECT priority, COUNT(*) AS count
       FROM job_requisition
       ${whereClause}
       GROUP BY priority`,
      params
    );

    const [byBranch] = await db.execute<RowDataPacket[]>(
      `SELECT branch_name, COUNT(*) AS count,
        SUM(CASE WHEN approval_status = 'approved' THEN (requested_headcount - fulfilled_headcount) ELSE 0 END) AS open_positions
       FROM job_requisition
       ${whereClause}
       GROUP BY branch_name
       ORDER BY count DESC
       LIMIT 10`,
      params
    );

    const [byStatus] = await db.execute<RowDataPacket[]>(
      `SELECT approval_status, COUNT(*) AS count
       FROM job_requisition
       ${whereClause}
       GROUP BY approval_status`,
      params
    );

    const priorityMap: Record<string, number> = { low: 0, normal: 0, high: 0, urgent: 0 };
    for (const row of byPriority) {
      priorityMap[row.priority as string] = Number(row.count);
    }

    const statusMap: Record<string, number> = {};
    for (const row of byStatus) {
      statusMap[row.approval_status as string] = Number(row.count);
    }

    return {
      total_requisitions: Number(metrics[0]?.total_requisitions ?? 0),
      open_requisitions: Number(metrics[0]?.open_requisitions ?? 0),
      pending_approval: Number(metrics[0]?.pending_approval ?? 0),
      approved_active: Number(metrics[0]?.approved_active ?? 0),
      total_open_positions: Number(metrics[0]?.total_open_positions ?? 0),
      total_fulfilled: Number(metrics[0]?.total_fulfilled ?? 0),
      fill_rate_percent: Number(metrics[0]?.fill_rate_percent ?? 0),
      avg_time_to_fill_days: Number(metrics[0]?.avg_time_to_fill_days ?? 0),
      by_priority: priorityMap as Record<"low" | "normal" | "high" | "urgent", number>,
      by_branch: byBranch.map((r) => ({
        branch_name: r.branch_name as string,
        count: Number(r.count),
        open_positions: Number(r.open_positions),
      })),
      by_status: statusMap as Record<ApprovalStatus, number>,
    };
  },

  /**
   * Get requisitions pending approval for a specific role
   */
  async getPendingForApproval(approverRole: string): Promise<JobRequisitionSummary[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
        jr.*,
        (jr.requested_headcount - jr.fulfilled_headcount) AS open_positions,
        e.full_name AS owner_recruiter_name,
        DATEDIFF(CURRENT_DATE(), DATE(jr.created_at)) AS aging_days,
        'pending' AS derived_status,
        0 AS total_candidates,
        0 AS selected_candidates,
        0 AS pipeline_candidates
       FROM job_requisition jr
       LEFT JOIN employees e ON e.id = jr.owner_recruiter_id
       WHERE jr.approval_status = 'pending_approval'
         AND jr.active_status = 1
       ORDER BY
         CASE jr.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
         jr.created_at ASC`
    );
    return rows as JobRequisitionSummary[];
  },

  /**
   * Log approval action
   */
  async notifyApprovers(
    requisition: JobRequisition,
    title: string,
    description: string,
    actionUrl: string
  ): Promise<void> {
    // Find all active users with approver roles for this branch
    const [users] = await db.execute<RowDataPacket[]>(
      `SELECT u.id FROM users u
       WHERE u.active_status = 1
         AND u.role IN ('super_admin','hr','branch_head','management')
         AND (u.branch_name = ? OR u.role IN ('super_admin','management'))
       LIMIT 50`,
      [requisition.branch_name]
    );
    await Promise.allSettled(
      (users as RowDataPacket[]).map((u) =>
        inboxService.createItem({
          user_id: u.id as string,
          type: "requisition_pending_approval",
          title,
          description,
          entity_type: "job_requisition",
          entity_id: requisition.id,
          action_url: actionUrl,
          priority: "high",
        })
      )
    );
  },

  async logApprovalAction(
    requisitionId: string,
    step: number,
    action: "submitted" | "approved" | "rejected" | "returned" | "escalated" | "cancelled",
    actorId: string,
    actorName: string | null,
    actorRole: string | null,
    remarks: string | null
  ): Promise<void> {
    await db.execute(
      `INSERT INTO job_requisition_approval_log (id, requisition_id, approval_step, action, actor_id, actor_name, actor_role, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), requisitionId, step, action, actorId, actorName, actorRole, remarks]
    );
  },

  /**
   * Get open requisitions for a branch (for recruiter selection)
   */
  async getOpenRequisitionsForBranch(branchName: string, processId?: string, processName?: string): Promise<JobRequisitionSummary[]> {
    const params: unknown[] = [branchName];
    let processClause = '';
    if (processId && processName) {
      // Match by UUID OR by name for legacy records where process_id was not saved
      processClause = 'AND (jr.process_id = ? OR (jr.process_id IS NULL AND jr.process_name = ?))';
      params.push(processId, processName);
    } else if (processId) {
      processClause = 'AND jr.process_id = ?';
      params.push(processId);
    } else if (processName) {
      // Fallback: match by name when ID not available (e.g. recruiter workspace using config options)
      processClause = 'AND jr.process_name = ?';
      params.push(processName);
    }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
        jr.*,
        (jr.requested_headcount - jr.fulfilled_headcount) AS open_positions
       FROM job_requisition jr
       WHERE jr.branch_name = ?
         AND jr.approval_status = 'approved'
         AND jr.fulfilled_headcount < jr.requested_headcount
         AND jr.active_status = 1
         ${processClause}
       ORDER BY jr.priority DESC, jr.created_at ASC`,
      params
    );
    return rows as JobRequisitionSummary[];
  },

  /**
   * Get process list for a branch from process_master (for cascading dropdown)
   */
  async getProcessesForBranch(branchName: string): Promise<Array<{id: string; process_name: string; process_code: string}>> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT pm.id, pm.process_name, pm.process_code
       FROM process_master pm
       JOIN branch_master bm ON bm.id = pm.branch_id
       WHERE bm.branch_name = ?
         AND pm.active_status = 1
       ORDER BY pm.process_name ASC`,
      [branchName]
    );
    return rows as Array<{id: string; process_name: string; process_code: string}>;
  },

  /**
   * Get detailed funnel metrics for a requisition
   */
  async getRequisitionFunnel(id: string): Promise<RequisitionFunnel | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
        jr.id AS requisition_id,
        jr.requisition_code,
        jr.designation_name,
        jr.branch_name,
        jr.process_name,
        jr.requested_headcount,
        jr.fulfilled_headcount,
        jr.planned_batch_no,
        jr.planned_batch_name,
        jr.training_start_date,
        jr.approval_status,
        jr.created_at AS demand_raised_date,
        jr.approved_at AS demand_approved_date,
        jr.business_justification,

        COUNT(DISTINCT jrc.candidate_id) AS total_linked_candidates,

        COUNT(DISTINCT CASE
          WHEN c.walk_in_date IS NOT NULL OR qt.id IS NOT NULL
          THEN c.id
        END) AS walkin_count,

        COUNT(DISTINCT CASE
          WHEN c.current_stage NOT IN ('Applied', 'New', 'Registered')
          THEN c.id
        END) AS screened_count,

        COUNT(DISTINCT CASE
          WHEN c.current_stage IN ('Selected', 'Offered', 'Joined', 'Converted')
          THEN c.id
        END) AS selected_count,

        COUNT(DISTINCT CASE
          WHEN c.current_stage IN ('Offered', 'Joined', 'Converted')
          THEN c.id
        END) AS offered_count,

        COUNT(DISTINCT ob.id) AS onboarding_count,

        COUNT(DISTINCT CASE
          WHEN ob.employee_id IS NOT NULL AND e.active_status = 1
          THEN e.id
        END) AS joined_count,

        COUNT(DISTINCT lm.id) AS lms_enrolled_count

       FROM job_requisition jr
       LEFT JOIN job_requisition_candidate jrc ON jrc.requisition_id = jr.id
       LEFT JOIN ats_candidate c ON c.id = jrc.candidate_id
       LEFT JOIN ats_queue_token qt ON qt.candidate_id = c.id
       LEFT JOIN ats_onboarding_bridge ob ON ob.candidate_id = c.id
       LEFT JOIN employees e ON e.id = ob.employee_id
       LEFT JOIN lms_employee_mapping lm ON lm.employee_id = e.id
       WHERE jr.id = ? AND jr.active_status = 1
       GROUP BY jr.id`,
      [id]
    );

    if (!rows[0]) return null;

    const row = rows[0];
    return {
      requisition_id: row.requisition_id as string,
      requisition_code: row.requisition_code as string,
      designation_name: row.designation_name as string,
      branch_name: row.branch_name as string,
      process_name: row.process_name as string | null,
      requested_headcount: Number(row.requested_headcount),
      fulfilled_headcount: Number(row.fulfilled_headcount),
      planned_batch_no: row.planned_batch_no as string | null,
      planned_batch_name: row.planned_batch_name as string | null,
      training_start_date: row.training_start_date as string | null,
      approval_status: row.approval_status as ApprovalStatus,
      demand_raised_date: row.demand_raised_date as string,
      demand_approved_date: row.demand_approved_date as string | null,
      business_justification: row.business_justification as string | null,
      funnel: {
        total_linked: Number(row.total_linked_candidates ?? 0),
        walkin_count: Number(row.walkin_count ?? 0),
        screened_count: Number(row.screened_count ?? 0),
        selected_count: Number(row.selected_count ?? 0),
        offered_count: Number(row.offered_count ?? 0),
        onboarding_count: Number(row.onboarding_count ?? 0),
        joined_count: Number(row.joined_count ?? 0),
        lms_enrolled_count: Number(row.lms_enrolled_count ?? 0),
      },
    };
  },

  /**
   * Update planned batch for a requisition
   */
  async updatePlannedBatch(
    id: string,
    batchNo: string | null,
    batchName: string | null,
    trainingStartDate: string | null
  ): Promise<void> {
    await db.execute(
      `UPDATE job_requisition
       SET planned_batch_no = ?, planned_batch_name = ?, training_start_date = ?, updated_at = NOW()
       WHERE id = ?`,
      [batchNo, batchName, trainingStartDate, id]
    );
  },

  /**
   * Get available batches from external LMS for dropdown
   */
  async getAvailableBatches(filters: { branch?: string; process?: string } = {}): Promise<LmsBatchOption[]> {
    try {
      const { lmsQuery } = await import("../lms/lms.service.js");

      const conditions: string[] = ["batch_status IN ('Planned', 'Active', 'In Progress')"];
      const params: unknown[] = [];

      if (filters.branch) {
        conditions.push("branch = ?");
        params.push(filters.branch);
      }
      if (filters.process) {
        conditions.push("process = ?");
        params.push(filters.process);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const rows = await lmsQuery<RowDataPacket[]>(
        `SELECT batch_no, batch_name, batch_status, branch, process, lob, start_date, end_date, expected_trainees, total_trainees
         FROM batch_master
         ${whereClause}
         ORDER BY start_date DESC, batch_no DESC
         LIMIT 100`,
        params
      );

      return rows.map((r) => ({
        batch_no: r.batch_no as string,
        batch_name: r.batch_name as string,
        batch_status: r.batch_status as string,
        branch: r.branch as string | null,
        process: r.process as string | null,
        lob: r.lob as string | null,
        start_date: r.start_date as string | null,
        end_date: r.end_date as string | null,
        expected_trainees: Number(r.expected_trainees ?? 0),
        current_trainees: Number(r.total_trainees ?? 0),
      }));
    } catch (err) {
      console.warn("[JobRequisition] Failed to fetch LMS batches:", err);
      return [];
    }
  },

  /**
   * Mark a requisition as batch-handed-over to operations
   */
  async markHandover(
    id: string,
    actorId: string,
    actorName: string | null,
    notes?: string,
    emailRecipientUserIds?: string[],
    manualCcEmails?: string[]
  ): Promise<void> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT approval_status, requested_headcount, fulfilled_headcount, handover_status,
              branch_name, process_name, requisition_code, planned_batch_no, planned_batch_name, training_start_date
       FROM job_requisition WHERE id = ? AND active_status = 1`,
      [id]
    );
    if (!rows[0]) {
      throw Object.assign(new Error("Requisition not found"), { status: 404 });
    }
    const req = rows[0];
    if (req.approval_status !== "approved") {
      throw Object.assign(new Error("Only approved requisitions can be handed over"), { status: 422 });
    }
    if (Number(req.fulfilled_headcount) < Number(req.requested_headcount)) {
      throw Object.assign(new Error("Headcount not fully fulfilled — cannot mark as handed over"), { status: 422 });
    }
    if (req.handover_status === "handed_over") {
      throw Object.assign(new Error("Requisition already handed over"), { status: 422 });
    }

    await db.execute(
      `UPDATE job_requisition
       SET handover_status = 'handed_over', handover_at = NOW(), handover_by = ?, handover_notes = ?, updated_at = NOW()
       WHERE id = ?`,
      [actorId, notes ?? null, id]
    );

    const processLabel = (req.process_name as string) ?? (req.branch_name as string);
    const batchLabel = (req.planned_batch_name as string) ?? (req.planned_batch_no as string) ?? "—";

    // Inbox notifications — use canonical user_roles + auth_user tables
    try {
      const [roleRecipients] = await db.execute<RowDataPacket[]>(
        `SELECT DISTINCT ur.user_id
         FROM user_roles ur
         WHERE ur.role_key IN ('super_admin', 'hr', 'operations_manager') AND ur.active_status = 1`,
        []
      );
      for (const r of roleRecipients as RowDataPacket[]) {
        await inboxService.createItem({
          user_id: r.user_id as string,
          type: "requisition_handover",
          title: `Batch Handed Over: ${req.requisition_code as string}`,
          description: `${req.requisition_code as string} (${processLabel}) batch ${batchLabel} handed over by ${actorName ?? actorId}. ${notes ? `Note: ${notes}` : ""}`.trim(),
          entity_type: "job_requisition",
          entity_id: id,
          priority: "normal",
        });
      }
    } catch (e) {
      console.warn("[JobRequisition markHandover] inbox notification failed:", e instanceof Error ? e.message : e);
    }

    // Email notification (graceful fail)
    try {
      // Collect emails: explicit recipients + manual CC
      const toEmails: string[] = [...(manualCcEmails ?? [])];

      // Add emails for specified user IDs
      const allUserIds = [...new Set([...(emailRecipientUserIds ?? [])])];
      if (allUserIds.length > 0) {
        const placeholders = allUserIds.map(() => "?").join(",");
        const [userRows] = await db.execute<RowDataPacket[]>(
          `SELECT email FROM auth_user WHERE id IN (${placeholders}) AND email IS NOT NULL`,
          allUserIds
        );
        for (const u of userRows as RowDataPacket[]) {
          if (u.email) toEmails.push(u.email as string);
        }
      }

      if (toEmails.length > 0 && emailService.isConfigured()) {
        const trainingDate = req.training_start_date
          ? new Date(req.training_start_date as string).toLocaleDateString("en-IN")
          : "TBD";
        const htmlBody = `
          <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
            <tr><td style="padding:6px 10px;background:#f8fafc;font-weight:600;width:40%">Requisition</td><td style="padding:6px 10px">${req.requisition_code as string}</td></tr>
            <tr><td style="padding:6px 10px;background:#f8fafc;font-weight:600">Process / Branch</td><td style="padding:6px 10px">${processLabel}</td></tr>
            <tr><td style="padding:6px 10px;background:#f8fafc;font-weight:600">Batch</td><td style="padding:6px 10px">${batchLabel}</td></tr>
            <tr><td style="padding:6px 10px;background:#f8fafc;font-weight:600">Training Start</td><td style="padding:6px 10px">${trainingDate}</td></tr>
            <tr><td style="padding:6px 10px;background:#f8fafc;font-weight:600">Headcount</td><td style="padding:6px 10px">${req.fulfilled_headcount as number} / ${req.requested_headcount as number} filled</td></tr>
            <tr><td style="padding:6px 10px;background:#f8fafc;font-weight:600">Handed Over By</td><td style="padding:6px 10px">${actorName ?? actorId}</td></tr>
            ${notes ? `<tr><td style="padding:6px 10px;background:#f8fafc;font-weight:600">Notes</td><td style="padding:6px 10px">${notes}</td></tr>` : ""}
          </table>
          <p style="color:#374151;font-size:14px">Please log in to PeopleOS to download the full Batch Handover Pack for this requisition.</p>
        `;
        await emailService.send({
          to: toEmails.join(", "),
          subject: `Batch Handover: ${req.requisition_code as string} — ${processLabel} — ${batchLabel}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:660px;margin:0 auto">${htmlBody}</div>`,
        });
      }
    } catch (e) {
      console.warn("[JobRequisition markHandover] email send failed:", e instanceof Error ? e.message : e);
    }
  },

  /**
   * Aggregate funnel across all approved/active requisitions (or filtered subset)
   */
  async getAggregateFunnel(filters: { branch_name?: string; approval_status?: string } = {}): Promise<AggregateFunnel> {
    const conditions: string[] = ["jr.active_status = 1"];
    const params: unknown[] = [];
    if (filters.branch_name) { conditions.push("jr.branch_name = ?"); params.push(filters.branch_name); }
    if (filters.approval_status) { conditions.push("jr.approval_status = ?"); params.push(filters.approval_status); }
    const where = conditions.join(" AND ");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(DISTINCT jrc.candidate_id)                                         AS linked,
         COUNT(DISTINCT CASE WHEN c.walk_in_date IS NOT NULL OR qt.id IS NOT NULL THEN c.id END) AS walkin,
         COUNT(DISTINCT CASE WHEN c.current_stage NOT IN ('Applied','New','Registered') THEN c.id END) AS screened,
         COUNT(DISTINCT CASE WHEN c.current_stage IN ('Selected','Offered','Joined','Converted') THEN c.id END) AS selected_cnt,
         COUNT(DISTINCT CASE WHEN c.current_stage IN ('Offered','Joined','Converted') THEN c.id END) AS offered,
         COUNT(DISTINCT ob.id)                                                    AS onboarding,
         COUNT(DISTINCT CASE WHEN ob.employee_id IS NOT NULL AND e.active_status = 1 THEN e.id END) AS joined,
         COUNT(DISTINCT lm.id)                                                    AS lms
       FROM job_requisition jr
       LEFT JOIN job_requisition_candidate jrc ON jrc.requisition_id = jr.id
       LEFT JOIN ats_candidate c              ON c.id = jrc.candidate_id
       LEFT JOIN ats_queue_token qt           ON qt.candidate_id = c.id
       LEFT JOIN ats_onboarding_bridge ob     ON ob.candidate_id = c.id
       LEFT JOIN employees e                  ON e.id = ob.employee_id
       LEFT JOIN lms_employee_mapping lm      ON lm.employee_id = e.id
       WHERE ${where}`,
      params
    );
    const r = rows[0] ?? {};
    return {
      linked:     Number(r.linked ?? 0),
      walkin:     Number(r.walkin ?? 0),
      screened:   Number(r.screened ?? 0),
      selected:   Number(r.selected_cnt ?? 0),
      offered:    Number(r.offered ?? 0),
      onboarding: Number(r.onboarding ?? 0),
      joined:     Number(r.joined ?? 0),
      lms:        Number(r.lms ?? 0),
    };
  },

  /**
   * Get joined employees for a specific requisition
   */
  async getJoinedEmployees(requisitionId: string): Promise<JoinedEmployee[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         e.id            AS employee_id,
         e.full_name,
         e.employee_code,
         e.date_of_joining,
         ob.status AS bridge_status,
         c.id            AS candidate_id,
         c.full_name     AS candidate_name,
         (lm.id IS NOT NULL) AS lms_enrolled
       FROM job_requisition_candidate jrc
       JOIN ats_candidate c          ON c.id = jrc.candidate_id
       JOIN ats_onboarding_bridge ob ON ob.candidate_id = c.id
       JOIN employees e              ON e.id = ob.employee_id AND e.active_status = 1
       LEFT JOIN lms_employee_mapping lm ON lm.employee_id = e.id
       WHERE jrc.requisition_id = ?
       ORDER BY e.date_of_joining ASC`,
      [requisitionId]
    );
    return (rows as RowDataPacket[]).map(r => ({
      employee_id:    r.employee_id as string,
      full_name:      r.full_name as string,
      employee_code:  r.employee_code as string | null,
      date_of_joining: r.date_of_joining as string | null,
      bridge_status:  r.bridge_status as string,
      lms_enrolled:   Boolean(r.lms_enrolled),
      candidate_id:   r.candidate_id as string,
      candidate_name: r.candidate_name as string,
    }));
  },

  /**
   * Build handover pack data for download
   */
  async getHandoverPack(id: string): Promise<HandoverPack> {
    const [reqRows] = await db.execute<RowDataPacket[]>(
      `SELECT requisition_code, designation_name, branch_name, process_name,
              planned_batch_no, planned_batch_name, training_start_date, requisition_validity,
              requested_headcount, fulfilled_headcount, handover_at, handover_notes
       FROM job_requisition WHERE id = ? AND active_status = 1`,
      [id]
    );
    if (!reqRows[0]) throw Object.assign(new Error("Requisition not found"), { status: 404 });
    const req = reqRows[0];

    const [funnelRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(DISTINCT jrc.candidate_id) AS linked,
         COUNT(DISTINCT CASE WHEN c.walk_in_date IS NOT NULL OR qt.id IS NOT NULL THEN c.id END) AS walkin,
         COUNT(DISTINCT CASE WHEN c.current_stage NOT IN ('Applied','New','Registered') THEN c.id END) AS screened,
         COUNT(DISTINCT CASE WHEN c.current_stage IN ('Selected','Offered','Joined','Converted') THEN c.id END) AS selected_cnt,
         COUNT(DISTINCT CASE WHEN c.current_stage IN ('Offered','Joined','Converted') THEN c.id END) AS offered,
         COUNT(DISTINCT ob.id) AS onboarding,
         COUNT(DISTINCT CASE WHEN ob.employee_id IS NOT NULL AND e.active_status = 1 THEN e.id END) AS joined,
         COUNT(DISTINCT lm.id) AS lms
       FROM job_requisition_candidate jrc
       LEFT JOIN ats_candidate c          ON c.id = jrc.candidate_id
       LEFT JOIN ats_queue_token qt       ON qt.candidate_id = c.id
       LEFT JOIN ats_onboarding_bridge ob ON ob.candidate_id = c.id
       LEFT JOIN employees e              ON e.id = ob.employee_id
       LEFT JOIN lms_employee_mapping lm  ON lm.employee_id = e.id
       WHERE jrc.requisition_id = ?`,
      [id]
    );
    const fr = funnelRows[0] ?? {};

    const joinedEmployees = await this.getJoinedEmployees(id);

    const [pipelineRows] = await db.execute<RowDataPacket[]>(
      `SELECT jrc.candidate_id, c.full_name, jrc.outcome, jrc.linked_at
       FROM job_requisition_candidate jrc
       JOIN ats_candidate c ON c.id = jrc.candidate_id
       WHERE jrc.requisition_id = ?
       ORDER BY jrc.linked_at ASC`,
      [id]
    );

    return {
      summary: {
        requisition_code:   req.requisition_code as string,
        designation_name:   req.designation_name as string,
        branch_name:        req.branch_name as string,
        process_name:       req.process_name as string | null,
        planned_batch_no:   req.planned_batch_no as string | null,
        planned_batch_name: req.planned_batch_name as string | null,
        training_start_date: req.training_start_date as string | null,
        requisition_validity: req.requisition_validity as string | null,
        requested_headcount: Number(req.requested_headcount),
        fulfilled_headcount: Number(req.fulfilled_headcount),
        handover_at:        req.handover_at as string | null,
        handover_notes:     req.handover_notes as string | null,
      },
      funnel: {
        linked:     Number(fr.linked ?? 0),
        walkin:     Number(fr.walkin ?? 0),
        screened:   Number(fr.screened ?? 0),
        selected:   Number(fr.selected_cnt ?? 0),
        offered:    Number(fr.offered ?? 0),
        onboarding: Number(fr.onboarding ?? 0),
        joined:     Number(fr.joined ?? 0),
        lms:        Number(fr.lms ?? 0),
      },
      joined_employees: joinedEmployees,
      candidate_pipeline: (pipelineRows as RowDataPacket[]).map(r => ({
        candidate_id: r.candidate_id as string,
        full_name:    r.full_name as string,
        outcome:      r.outcome as string,
        linked_at:    r.linked_at as string,
      })),
    };
  },

  /**
   * Soft-delete a requisition (super_admin only — can delete any status)
   */
  async deleteRequisition(id: string): Promise<void> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM job_requisition WHERE id = ? AND active_status = 1`,
      [id]
    );
    if (!rows[0]) throw Object.assign(new Error("Requisition not found"), { status: 404 });
    await db.execute(
      `UPDATE job_requisition SET active_status = 0, updated_at = NOW() WHERE id = ?`,
      [id]
    );
  },

  /**
   * Get list of users with a given role (for handover email recipient picker)
   */
  async getHandoverRecipientOptions(roles: string[]): Promise<Array<{ user_id: string; email: string; role_key: string }>> {
    if (roles.length === 0) return [];
    const placeholders = roles.map(() => "?").join(",");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT ur.user_id, ur.role_key, au.email
       FROM user_roles ur
       JOIN auth_user au ON au.id = ur.user_id
       WHERE ur.role_key IN (${placeholders}) AND ur.active_status = 1 AND au.email IS NOT NULL
       ORDER BY ur.role_key, au.email`,
      roles
    );
    return (rows as RowDataPacket[]).map(r => ({
      user_id:  r.user_id as string,
      email:    r.email as string,
      role_key: r.role_key as string,
    }));
  },
};
