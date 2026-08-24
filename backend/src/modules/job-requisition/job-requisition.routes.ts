/**
 * Job Requisition Routes
 * Stage 1 of HRMS Journey: Workforce Requirement and Job Requisition
 *
 * All routes require authentication and appropriate role authorization.
 */

import { Router } from "express";
import type { Response, NextFunction } from "express";
import type { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { jobRequisitionService } from "./job-requisition.service.js";
import { db } from "../../db/mysql.js";
import type {
  CreateRequisitionInput,
  UpdateRequisitionInput,
  RequisitionFilters,
  CandidateOutcome,
  RequisitionFunnel,
  LmsBatchOption,
} from "./job-requisition.types.js";

export const jobRequisitionRouter = Router();

/**
 * Roles allowed to READ requisitions.
 *
 * Kept as one constant because the previous inline list had drifted out of step with
 * role_page_access: `recruiter` (16 users), `manager` (7) and `assistant_manager` (2) all
 * hold the JOB_REQUISITION page grant, so the page opened for them and then every list
 * call 403'd. assistant_manager was the clearest tell — it could already POST / and
 * PATCH /:id but not GET /, i.e. create a requisition and then not see it.
 *
 * recruiter was already allowed on /processes-for-branch and /open-for-branch, and
 * job_requisition carries an owner_recruiter_id column, so read access was always the
 * intent here.
 *
 * Deliberately NOT widened:
 *  - `interviewer` — holds the page grant but appears in no endpoint in this file; the
 *    grant is the outlier, not the guards (see migration 1084).
 *  - write and approval routes — approve/reject/close stay super_admin + branch_head, per
 *    141_branch_head_approval.sql.
 *
 * Row scoping IS applied: listRequisitions() and getDashboardMetrics() both run
 * buildProcessScopeCondition against job_requisition's own branch_id/process_id, so a role
 * here sees only its assigned scope. super_admin/admin/hr/ceo still resolve org-wide,
 * which is what recruitment needs. Being in this list is permission to reach the endpoint,
 * not permission to see every row.
 */
const REQUISITION_READ_ROLES = [
  "super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager",
  "process_manager", "management", "manager", "assistant_manager", "recruiter",
] as const;

type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

/**
 * Row-scope guard for the single-requisition read endpoints.
 *
 * Scoping only the list left these open: they take an id (or code) straight from the URL,
 * so any read role could pull a requisition from another branch by knowing its UUID.
 *
 * Answers a miss with 404, not 403 — 403 would confirm the requisition exists to someone
 * who is not entitled to know it does.
 *
 * Read endpoints only. The id-based WRITE routes (PATCH /:id, POST /:id/submit,
 * approve/reject/close) are still unscoped; they carry narrower role lists but no row
 * check. Left alone deliberately — guarding an approval path needs a branch-scoped login
 * to test against, and every demo token here carries scope_type='all'.
 */
const inScope = (key: "id" | "code") =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const value = req.params[key];
    void jobRequisitionService
      .isRequisitionVisible(req.authUser!, key === "id" ? { id: value } : { code: value })
      .then((visible) =>
        visible
          ? next()
          : res.status(404).json({ success: false, message: "Requisition not found" }),
      )
      .catch(next);
  };

// ─── Dashboard Metrics ───────────────────────────────────────────────────────
jobRequisitionRouter.get(
  "/dashboard",
  requireAuth,
  requireRole(...REQUISITION_READ_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { branch_id, branch_name, approval_status, priority, from_date, to_date } = req.query;
    const metrics = await jobRequisitionService.getDashboardMetrics({
      branch_id: branch_id as string | undefined,
      branch_name: branch_name as string | undefined,
      approval_status: approval_status as string | undefined,
      priority: priority as string | undefined,
      from_date: from_date as string | undefined,
      to_date: to_date as string | undefined,
    }, req.authUser!);
    return res.json({ success: true, data: metrics });
  })
);

// ─── List Requisitions ───────────────────────────────────────────────────────
jobRequisitionRouter.get(
  "/",
  requireAuth,
  requireRole(...REQUISITION_READ_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const filters: RequisitionFilters = {
      branch_id: req.query.branch_id as string | undefined,
      branch_name: req.query.branch_name as string | undefined,
      process_id: req.query.process_id as string | undefined,
      department_id: req.query.department_id as string | undefined,
      approval_status: req.query.approval_status as RequisitionFilters["approval_status"],
      priority: req.query.priority as RequisitionFilters["priority"],
      employment_type: req.query.employment_type as RequisitionFilters["employment_type"],
      requested_by: req.query.requested_by as string | undefined,
      owner_recruiter_id: req.query.owner_recruiter_id as string | undefined,
      from_date: req.query.from_date as string | undefined,
      to_date: req.query.to_date as string | undefined,
      search: req.query.search as string | undefined,
      include_closed: req.query.include_closed === "true",
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20,
    };

    const result = await jobRequisitionService.listRequisitions(filters, req.authUser!);
    return res.json({ success: true, ...result });
  })
);

// ─── Get Pending Approvals for Role ──────────────────────────────────────────
jobRequisitionRouter.get(
  "/pending-approvals",
  requireAuth,
  requireRole("super_admin", "branch_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const role = req.authUser?.role ?? "branch_head";
    const data = await jobRequisitionService.getPendingForApproval(role, req.authUser!);
    return res.json({ success: true, data });
  })
);

// ─── Get Available LMS Batches for Dropdown ──────────────────────────────────
jobRequisitionRouter.get(
  "/batches/available",
  requireAuth,
  // Feeds the create/edit form's batch picker — assistant_manager can create a
  // requisition, so it must be able to load the batches that form requires.
  requireRole(...REQUISITION_READ_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { branch, process } = req.query;
    const data = await jobRequisitionService.getAvailableBatches({
      branch: branch as string | undefined,
      process: process as string | undefined,
    });
    return res.json({ success: true, data });
  })
);

// ─── Get Processes for Branch (from process_master, for cascading dropdown) ──
jobRequisitionRouter.get(
  "/processes-for-branch/:branchName",
  requireAuth,
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager", "process_manager", "management", "recruiter"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { branchName } = req.params;
    const data = await jobRequisitionService.getProcessesForBranch(decodeURIComponent(branchName));
    return res.json({ success: true, data });
  })
);

// ─── Get Open Requisitions for Branch (for candidate linking) ────────────────
jobRequisitionRouter.get(
  "/open-for-branch/:branchName",
  requireAuth,
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager", "process_manager", "management", "recruiter"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { branchName } = req.params;
    const processId = req.query.processId as string | undefined;
    const processName = req.query.processName as string | undefined;
    const data = await jobRequisitionService.getOpenRequisitionsForBranch(
      decodeURIComponent(branchName),
      processId ? decodeURIComponent(processId) : undefined,
      processName ? decodeURIComponent(processName) : undefined
    );
    return res.json({ success: true, data });
  })
);

// ─── Aggregate Funnel Across All Requisitions ────────────────────────────────
jobRequisitionRouter.get(
  "/aggregate-funnel",
  requireAuth,
  requireRole(...REQUISITION_READ_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const branch_name = req.query.branch_name as string | undefined;
    const approval_status = req.query.approval_status as string | undefined;
    const data = await jobRequisitionService.getAggregateFunnel({ branch_name, approval_status }, req.authUser!);
    return res.json({ success: true, data });
  })
);

// ─── Handover Recipient Options ───────────────────────────────────────────────
jobRequisitionRouter.get(
  "/handover-recipients",
  requireAuth,
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await jobRequisitionService.getHandoverRecipientOptions([
      "operations_manager", "trainer", "branch_head", "process_manager",
    ]);
    return res.json({ success: true, data });
  })
);

// ─── Get Single Requisition ──────────────────────────────────────────────────
jobRequisitionRouter.get(
  "/:id",
  requireAuth,
  requireRole(...REQUISITION_READ_ROLES),
  inScope("id"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const data = await jobRequisitionService.getRequisition(id);
    if (!data) {
      return res.status(404).json({ success: false, message: "Requisition not found" });
    }
    return res.json({ success: true, data });
  })
);

// ─── Get Requisition by Code ─────────────────────────────────────────────────
jobRequisitionRouter.get(
  "/by-code/:code",
  requireAuth,
  requireRole(...REQUISITION_READ_ROLES),
  inScope("code"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { code } = req.params;
    const data = await jobRequisitionService.getRequisitionByCode(code);
    if (!data) {
      return res.status(404).json({ success: false, message: "Requisition not found" });
    }
    return res.json({ success: true, data });
  })
);

// ─── Get Approval History ────────────────────────────────────────────────────
jobRequisitionRouter.get(
  "/:id/approval-history",
  requireAuth,
  requireRole(...REQUISITION_READ_ROLES),
  inScope("id"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const data = await jobRequisitionService.getApprovalHistory(id);
    return res.json({ success: true, data });
  })
);

// ─── Get Linked Candidates ───────────────────────────────────────────────────
jobRequisitionRouter.get(
  "/:id/candidates",
  requireAuth,
  requireRole(...REQUISITION_READ_ROLES),
  inScope("id"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const data = await jobRequisitionService.getRequisitionCandidates(id);
    return res.json({ success: true, data });
  })
);

// ─── Create Requisition ──────────────────────────────────────────────────────
jobRequisitionRouter.post(
  "/",
  requireAuth,
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager", "process_manager", "assistant_manager"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const input: CreateRequisitionInput = req.body;

    if (!input.designation_name || !input.branch_name || !input.requested_headcount) {
      return res.status(400).json({
        success: false,
        message: "designation_name, branch_name, and requested_headcount are required",
      });
    }

    if (input.requested_headcount < 1) {
      return res.status(400).json({
        success: false,
        message: "requested_headcount must be at least 1",
      });
    }

    const userId = req.authUser?.id;
    const userName = req.authUser?.email ?? null;

    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    // A branch-scoped raiser must not open headcount against someone else's branch.
    // Silent for actors whose scope names no branch — see canCreateForBranch.
    if (!(await jobRequisitionService.canCreateForBranch(req.authUser!, input.branch_name))) {
      return res.status(403).json({
        success: false,
        message: `You cannot raise a requisition for ${input.branch_name}. It is outside your assigned branch.`,
      });
    }

    const data = await jobRequisitionService.createRequisition(input, userId, userName);
    return res.status(201).json({ success: true, data, message: "Requisition created as draft" });
  })
);

// ─── Update Requisition ──────────────────────────────────────────────────────
jobRequisitionRouter.patch(
  "/:id",
  requireAuth,
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager", "process_manager", "assistant_manager"),
  inScope("id"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const input: UpdateRequisitionInput = req.body;
    const userId = req.authUser?.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    const data = await jobRequisitionService.updateRequisition(id, input, userId);
    return res.json({ success: true, data, message: "Requisition updated" });
  })
);

// ─── Submit for Approval ─────────────────────────────────────────────────────
jobRequisitionRouter.post(
  "/:id/submit",
  requireAuth,
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager", "process_manager", "assistant_manager"),
  inScope("id"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const userId = req.authUser?.id;
    const userName = req.authUser?.email ?? null;
    const userRole = req.authUser?.role ?? null;

    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    const data = await jobRequisitionService.submitForApproval(id, userId, userName, userRole);
    return res.json({ success: true, data, message: "Requisition submitted for approval" });
  })
);

// ─── Approve Requisition ─────────────────────────────────────────────────────
jobRequisitionRouter.post(
  "/:id/approve",
  requireAuth,
  requireRole("super_admin", "branch_head"),
  inScope("id"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { remarks } = req.body;
    const userId = req.authUser?.id;
    const userName = req.authUser?.email ?? null;
    const userRole = req.authUser?.role ?? null;

    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    const data = await jobRequisitionService.approveRequisition(id, userId, userName, userRole, remarks);
    return res.json({ success: true, data, message: "Requisition approved" });
  })
);

// ─── Reject Requisition ──────────────────────────────────────────────────────
jobRequisitionRouter.post(
  "/:id/reject",
  requireAuth,
  requireRole("super_admin", "branch_head"),
  inScope("id"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { reason } = req.body;
    const userId = req.authUser?.id;
    const userName = req.authUser?.email ?? null;
    const userRole = req.authUser?.role ?? null;

    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    if (!reason || typeof reason !== "string" || reason.trim().length < 5) {
      return res.status(400).json({
        success: false,
        message: "A rejection reason of at least 5 characters is required",
      });
    }

    const data = await jobRequisitionService.rejectRequisition(id, userId, userName, userRole, reason.trim());
    return res.json({ success: true, data, message: "Requisition rejected" });
  })
);

// ─── Close Requisition ───────────────────────────────────────────────────────
jobRequisitionRouter.post(
  "/:id/close",
  requireAuth,
  requireRole("super_admin", "branch_head"),
  inScope("id"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { reason } = req.body;
    const userId = req.authUser?.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    if (!reason || typeof reason !== "string") {
      return res.status(400).json({ success: false, message: "A close reason is required" });
    }

    const data = await jobRequisitionService.closeRequisition(id, userId, reason.trim());
    return res.json({ success: true, data, message: "Requisition closed" });
  })
);

// ─── Extend Deadline ─────────────────────────────────────────────────────────
jobRequisitionRouter.post(
  "/:id/extend-deadline",
  requireAuth,
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head"),
  inScope("id"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { new_validity, reason } = req.body;
    const userId = req.authUser?.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }
    if (!new_validity || typeof new_validity !== "string") {
      return res.status(400).json({ success: false, message: "new_validity (YYYY-MM-DD) is required" });
    }
    if (!reason || typeof reason !== "string" || reason.trim().length < 5) {
      return res.status(400).json({ success: false, message: "A reason of at least 5 characters is required" });
    }

    const data = await jobRequisitionService.extendDeadline(id, new_validity, reason.trim(), userId);
    return res.json({ success: true, data, message: "Deadline extended" });
  })
);

// ─── Link Candidate to Requisition ───────────────────────────────────────────
jobRequisitionRouter.post(
  "/:id/link-candidate",
  requireAuth,
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager"),
  inScope("id"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id: requisitionId } = req.params;
    const { candidate_id, link_source, remarks } = req.body;
    const userId = req.authUser?.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    if (!candidate_id) {
      return res.status(400).json({ success: false, message: "candidate_id is required" });
    }

    const data = await jobRequisitionService.linkCandidate(
      requisitionId,
      candidate_id,
      userId,
      link_source ?? "manual",
      remarks
    );
    return res.status(201).json({ success: true, data, message: "Candidate linked to requisition" });
  })
);

// ─── Update Candidate Outcome ────────────────────────────────────────────────
jobRequisitionRouter.patch(
  "/:id/candidate/:candidateId/outcome",
  requireAuth,
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager"),
  inScope("id"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id: requisitionId, candidateId } = req.params;
    const { outcome, remarks } = req.body;

    const validOutcomes: CandidateOutcome[] = ["in_progress", "selected", "rejected", "withdrawn", "offer_declined"];
    if (!outcome || !validOutcomes.includes(outcome)) {
      return res.status(400).json({
        success: false,
        message: `outcome must be one of: ${validOutcomes.join(", ")}`,
      });
    }

    await jobRequisitionService.updateCandidateOutcome(requisitionId, candidateId, outcome, remarks);
    return res.json({ success: true, message: "Candidate outcome updated" });
  })
);

// ─── Get Requisition Funnel Metrics ──────────────────────────────────────────
jobRequisitionRouter.get(
  "/:id/funnel",
  requireAuth,
  requireRole(...REQUISITION_READ_ROLES),
  inScope("id"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const data = await jobRequisitionService.getRequisitionFunnel(id);
    if (!data) {
      return res.status(404).json({ success: false, message: "Requisition not found" });
    }
    return res.json({ success: true, data });
  })
);

// ─── Mark Batch as Handed Over to Operations ─────────────────────────────────
jobRequisitionRouter.post(
  "/:id/handover",
  requireAuth,
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager"),
  inScope("id"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { notes, emailRecipientUserIds, manualCcEmails } = req.body;
    const userId = req.authUser?.id;
    const userName = req.authUser?.email ?? null;

    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    await jobRequisitionService.markHandover(
      id, userId, userName, notes,
      Array.isArray(emailRecipientUserIds) ? emailRecipientUserIds : undefined,
      Array.isArray(manualCcEmails) ? manualCcEmails : undefined
    );
    return res.json({ success: true, message: "Requisition marked as handed over" });
  })
);

// ─── Get Handover Pack Data ───────────────────────────────────────────────────
jobRequisitionRouter.get(
  "/:id/handover-pack",
  requireAuth,
  requireRole(...REQUISITION_READ_ROLES),
  inScope("id"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const data = await jobRequisitionService.getHandoverPack(id);
    return res.json({ success: true, data });
  })
);

// ─── Get Joined Employees for Requisition ────────────────────────────────────
jobRequisitionRouter.get(
  "/:id/joined-employees",
  requireAuth,
  requireRole(...REQUISITION_READ_ROLES),
  inScope("id"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const data = await jobRequisitionService.getJoinedEmployees(id);
    return res.json({ success: true, data });
  })
);

// ─── Delete Requisition (super_admin only) ────────────────────────────────────
jobRequisitionRouter.delete(
  "/:id",
  requireAuth,
  requireRole("super_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    await jobRequisitionService.deleteRequisition(id);
    return res.json({ success: true, message: "Requisition deleted" });
  })
);

// ─── Update Planned Batch ────────────────────────────────────────────────────
jobRequisitionRouter.patch(
  "/:id/batch",
  requireAuth,
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager"),
  inScope("id"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { batch_no, batch_name, training_start_date } = req.body;

    await jobRequisitionService.updatePlannedBatch(
      id,
      batch_no ?? null,
      batch_name ?? null,
      training_start_date ?? null
    );

    return res.json({ success: true, message: "Planned batch updated" });
  })
);

// ─── Backfill Candidates by Mobile Number ────────────────────────────────────
// Matches employees who joined (by mobile) with ats_candidate records
// and creates job_requisition_candidate links for requisitions missing them.
jobRequisitionRouter.post(
  "/backfill-candidates",
  requireAuth,
  requireRole("super_admin", "hr"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { requisition_id } = req.body as { requisition_id?: string };

    // Build condition - either specific requisition or all approved ones
    const reqCondition = requisition_id
      ? "jr.id = ?"
      : "jr.approval_status IN ('approved', 'closed')";
    const reqParams = requisition_id ? [requisition_id] : [];

    // Find all requisitions with their employees that might need backfill
    const [requisitions] = await db.execute<RowDataPacket[]>(
      `SELECT
         jr.id AS requisition_id,
         jr.requisition_code,
         jr.branch_name,
         jr.process_name,
         jr.target_joining_date,
         jr.requisition_validity,
         jr.created_at,
         jr.approved_at
       FROM job_requisition jr
       WHERE ${reqCondition}
         AND jr.active_status = 1
       ORDER BY jr.created_at DESC`,
      reqParams
    );

    let totalLinked = 0;
    let totalSkipped = 0;
    const results: Array<{ requisition_code: string; linked: number; skipped: number; details: string[] }> = [];

    for (const req of requisitions as RowDataPacket[]) {
      const details: string[] = [];
      let linked = 0;
      let skipped = 0;

      // Find employees who match this requisition by branch and have mobile numbers
      // Join date should be within reasonable range of requisition dates
      const startDate = req.approved_at ?? req.created_at;
      const endDate = req.requisition_validity ?? new Date().toISOString().slice(0, 10);

      const [employees] = await db.execute<RowDataPacket[]>(
        `SELECT
           e.id AS employee_id,
           e.employee_code,
           e.full_name,
           e.mobile,
           e.date_of_joining,
           b.branch_name
         FROM employees e
         LEFT JOIN branch_master b ON b.id = e.branch_id
         WHERE e.mobile IS NOT NULL
           AND e.mobile != ''
           AND e.active_status = 1
           AND LOWER(TRIM(b.branch_name)) = LOWER(TRIM(?))
           AND e.date_of_joining >= DATE(?)
           AND e.date_of_joining <= DATE(?)
         ORDER BY e.date_of_joining ASC`,
        [req.branch_name, startDate, endDate]
      );

      for (const emp of employees as RowDataPacket[]) {
        // Normalize mobile: remove spaces, leading 0, +91 etc
        const mobile = String(emp.mobile ?? "")
          .replace(/[\s\-\+]/g, "")
          .replace(/^0+/, "")
          .replace(/^91/, "")
          .slice(-10);

        if (mobile.length !== 10) {
          skipped++;
          continue;
        }

        // Find matching candidate by mobile
        const [candidates] = await db.execute<RowDataPacket[]>(
          `SELECT id, full_name, mobile
           FROM ats_candidate
           WHERE (
             RIGHT(REPLACE(REPLACE(REPLACE(mobile, ' ', ''), '-', ''), '+', ''), 10) = ?
             OR RIGHT(REPLACE(REPLACE(REPLACE(mobile, ' ', ''), '-', ''), '+', ''), 10) = ?
           )
           ORDER BY created_at DESC
           LIMIT 1`,
          [mobile, `0${mobile}`]
        );

        if (!candidates[0]) {
          skipped++;
          continue;
        }

        const candidateId = candidates[0].id as string;

        // Check if already linked
        const [existing] = await db.execute<RowDataPacket[]>(
          `SELECT id FROM job_requisition_candidate
           WHERE requisition_id = ? AND candidate_id = ?
           LIMIT 1`,
          [req.requisition_id, candidateId]
        );

        if (existing[0]) {
          skipped++;
          details.push(`${emp.employee_code}: already linked`);
          continue;
        }

        // Create the link
        const linkId = randomUUID();
        await db.execute(
          `INSERT INTO job_requisition_candidate
           (id, requisition_id, candidate_id, linked_by, link_source, outcome, outcome_at, remarks)
           VALUES (?, ?, ?, ?, 'auto_match', 'selected', ?, ?)`,
          [
            linkId,
            req.requisition_id,
            candidateId,
            null,
            emp.date_of_joining,
            `Backfill: matched employee ${emp.employee_code} by mobile`,
          ]
        );

        linked++;
        details.push(`${emp.employee_code} → ${candidates[0].full_name}`);
      }

      totalLinked += linked;
      totalSkipped += skipped;

      if (linked > 0 || details.length > 0) {
        results.push({
          requisition_code: req.requisition_code as string,
          linked,
          skipped,
          details: details.slice(0, 20), // Limit details to first 20
        });
      }
    }

    return res.json({
      success: true,
      message: `Backfill complete: ${totalLinked} candidates linked, ${totalSkipped} skipped`,
      total_linked: totalLinked,
      total_skipped: totalSkipped,
      requisitions_processed: requisitions.length,
      results,
    });
  })
);

