/**
 * Job Requisition Routes
 * Stage 1 of HRMS Journey: Workforce Requirement and Job Requisition
 *
 * All routes require authentication and appropriate role authorization.
 */

import { Router } from "express";
import type { Response, NextFunction } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { jobRequisitionService } from "./job-requisition.service.js";
import type {
  CreateRequisitionInput,
  UpdateRequisitionInput,
  RequisitionFilters,
  CandidateOutcome,
  RequisitionFunnel,
  LmsBatchOption,
} from "./job-requisition.types.js";

export const jobRequisitionRouter = Router();

type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

// ─── Dashboard Metrics ───────────────────────────────────────────────────────
jobRequisitionRouter.get(
  "/dashboard",
  requireAuth,
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager", "process_manager", "management"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { branch_id, from_date, to_date } = req.query;
    const metrics = await jobRequisitionService.getDashboardMetrics({
      branch_id: branch_id as string | undefined,
      from_date: from_date as string | undefined,
      to_date: to_date as string | undefined,
    });
    return res.json({ success: true, data: metrics });
  })
);

// ─── List Requisitions ───────────────────────────────────────────────────────
jobRequisitionRouter.get(
  "/",
  requireAuth,
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager", "process_manager", "management"),
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

    const result = await jobRequisitionService.listRequisitions(filters);
    return res.json({ success: true, ...result });
  })
);

// ─── Get Pending Approvals for Role ──────────────────────────────────────────
jobRequisitionRouter.get(
  "/pending-approvals",
  requireAuth,
  requireRole("super_admin", "hr", "branch_head", "management"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const role = req.authUser?.role ?? "hr";
    const data = await jobRequisitionService.getPendingForApproval(role);
    return res.json({ success: true, data });
  })
);

// ─── Get Available LMS Batches for Dropdown ──────────────────────────────────
jobRequisitionRouter.get(
  "/batches/available",
  requireAuth,
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager", "process_manager"),
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

// ─── Get Single Requisition ──────────────────────────────────────────────────
jobRequisitionRouter.get(
  "/:id",
  requireAuth,
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager", "process_manager", "management"),
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
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager", "process_manager", "management"),
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
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager", "process_manager", "management"),
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
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager", "process_manager", "management"),
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
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager"),
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

    const data = await jobRequisitionService.createRequisition(input, userId, userName);
    return res.status(201).json({ success: true, data, message: "Requisition created as draft" });
  })
);

// ─── Update Requisition ──────────────────────────────────────────────────────
jobRequisitionRouter.patch(
  "/:id",
  requireAuth,
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager"),
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
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager"),
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
  requireRole("super_admin", "hr", "branch_head", "management"),
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
  requireRole("super_admin", "hr", "branch_head", "management"),
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
  requireRole("super_admin", "hr", "branch_head", "management"),
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

// ─── Link Candidate to Requisition ───────────────────────────────────────────
jobRequisitionRouter.post(
  "/:id/link-candidate",
  requireAuth,
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager"),
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
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager", "process_manager", "management"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const data = await jobRequisitionService.getRequisitionFunnel(id);
    if (!data) {
      return res.status(404).json({ success: false, message: "Requisition not found" });
    }
    return res.json({ success: true, data });
  })
);

// ─── Aggregate Funnel Across All Requisitions ────────────────────────────────
jobRequisitionRouter.get(
  "/aggregate-funnel",
  requireAuth,
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager", "process_manager", "management"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const branch_name = req.query.branch_name as string | undefined;
    const approval_status = req.query.approval_status as string | undefined;
    const data = await jobRequisitionService.getAggregateFunnel({ branch_name, approval_status });
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

// ─── Mark Batch as Handed Over to Operations ─────────────────────────────────
jobRequisitionRouter.post(
  "/:id/handover",
  requireAuth,
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager"),
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
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager", "process_manager", "management"),
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
  requireRole("super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager", "process_manager", "management"),
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

