// backend/src/modules/salary-dispute/salary-dispute.routes.ts
import { Router, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { salaryDisputeService } from "./salary-dispute.service.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2/promise";

async function getEmployeeIdForUser(userId: string): Promise<string | null> {
  const [[emp]] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE user_id = ? LIMIT 1`,
    [userId]
  );
  return emp ? String((emp as any).id) : null;
}

export const salaryDisputeRouter = Router();
salaryDisputeRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: any) => fn(req, res).catch(next);

// Employee: raise dispute
salaryDisputeRouter.post("/", h(async (req, res) => {
  const { runMonth, disputeType, affectedDates, description } = req.body;
  const employeeId = await getEmployeeIdForUser(req.authUser!.id);
  if (!employeeId) return res.status(400).json({ success: false, message: "No employee linked to this account." });
  const dispute = await salaryDisputeService.raise({ employeeId, runMonth, disputeType, affectedDates, description });
  res.status(201).json({ success: true, data: dispute });
}));

// Employee: my disputes
salaryDisputeRouter.get("/my", h(async (req, res) => {
  const employeeId = await getEmployeeIdForUser(req.authUser!.id);
  if (!employeeId) return res.status(400).json({ success: false, message: "No employee linked." });
  const disputes = await salaryDisputeService.listMine(employeeId);
  res.json({ success: true, data: disputes });
}));

// WFM / Payroll HR queue
salaryDisputeRouter.get("/queue/wfm", requireRole("wfm", "payroll_hr", "payroll", "super_admin"),
  h(async (req, res) => {
    const branchId = req.query.branchId ? String(req.query.branchId) : undefined;
    const disputes = await salaryDisputeService.listQueue("wfm", branchId);
    res.json({ success: true, data: disputes });
  })
);

// Payroll Head queue
salaryDisputeRouter.get("/queue/payroll-head", requireRole("payroll_head", "super_admin"),
  h(async (req, res) => {
    const disputes = await salaryDisputeService.listQueue("payroll_head");
    res.json({ success: true, data: disputes });
  })
);

// Manager read-only team view
salaryDisputeRouter.get("/queue/manager", requireRole("manager", "branch_head", "process_manager", "super_admin"),
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const disputes = await salaryDisputeService.listManagerTeam(userId);
    res.json({ success: true, data: disputes });
  })
);

// Get single dispute (all roles can view their own or scope-permitted)
salaryDisputeRouter.get("/:id", h(async (req, res) => {
  const dispute = await salaryDisputeService.get(req.params.id);
  if (!dispute) return res.status(404).json({ success: false, message: "Not found." });
  res.json({ success: true, data: dispute });
}));

// WFM review (Stage 1)
salaryDisputeRouter.post("/:id/wfm-review", requireRole("wfm", "payroll_hr", "payroll", "super_admin"),
  h(async (req, res) => {
    const dispute = await salaryDisputeService.wfmReview(
      req.params.id, req.authUser!.id, req.body
    );
    res.json({ success: true, data: dispute });
  })
);

// Payroll Head review (Stage 2)
salaryDisputeRouter.post("/:id/payroll-head-review", requireRole("payroll_head", "super_admin"),
  h(async (req, res) => {
    const dispute = await salaryDisputeService.payrollHeadReview(
      req.params.id, req.authUser!.id, req.body
    );
    res.json({ success: true, data: dispute });
  })
);

// Get salary details for a dispute (for WFM review)
salaryDisputeRouter.get("/:id/salary-details", requireRole("wfm", "payroll_hr", "payroll", "payroll_head", "super_admin"),
  h(async (req, res) => {
    const dispute = await salaryDisputeService.get(req.params.id);
    if (!dispute) return res.status(404).json({ success: false, message: "Dispute not found." });

    const details = await salaryDisputeService.getSalaryDetails(dispute.employee_id, dispute.run_month);
    if (!details) return res.status(404).json({ success: false, message: "Salary data not found." });

    res.json({ success: true, data: details });
  })
);

// Calculate suggested differential
salaryDisputeRouter.post("/calculate-differential", requireRole("wfm", "payroll_hr", "payroll", "super_admin"),
  h(async (req, res) => {
    const { perDayRate, disputedDays } = req.body;
    if (!perDayRate || !disputedDays) {
      return res.status(400).json({ success: false, message: "perDayRate and disputedDays required" });
    }
    const differential = salaryDisputeService.calculateDifferential(Number(perDayRate), Number(disputedDays));
    res.json({ success: true, data: { differential } });
  })
);

// Withdraw dispute (employee only, pending_wfm status only)
salaryDisputeRouter.post("/:id/withdraw", h(async (req, res) => {
  const employeeId = await getEmployeeIdForUser(req.authUser!.id);
  if (!employeeId) return res.status(400).json({ success: false, message: "No employee linked." });

  const dispute = await salaryDisputeService.get(req.params.id);
  if (!dispute) return res.status(404).json({ success: false, message: "Dispute not found." });
  if (dispute.employee_id !== employeeId) return res.status(403).json({ success: false, message: "Not your dispute." });
  if (dispute.status !== "pending_wfm") return res.status(400).json({ success: false, message: "Can only withdraw disputes pending WFM review." });

  await db.execute(`UPDATE salary_dispute SET status = 'closed' WHERE id = ?`, [req.params.id]);
  await salaryDisputeService.logAudit(req.params.id, "withdrawn", req.authUser!.id, "employee", "pending_wfm", "closed");
  res.json({ success: true, message: "Dispute withdrawn." });
}));

// Appeal a rejected dispute
salaryDisputeRouter.post("/:id/appeal", h(async (req, res) => {
  const employeeId = await getEmployeeIdForUser(req.authUser!.id);
  if (!employeeId) return res.status(400).json({ success: false, message: "No employee linked." });

  const { appealReason } = req.body;
  if (!appealReason?.trim()) return res.status(400).json({ success: false, message: "Appeal reason is required." });

  const newDispute = await salaryDisputeService.appeal(req.params.id, employeeId, appealReason);
  res.status(201).json({ success: true, data: newDispute });
}));

// Get audit log for a dispute
salaryDisputeRouter.get("/:id/audit-log", requireRole("wfm", "payroll_hr", "payroll", "payroll_head", "super_admin"),
  h(async (req, res) => {
    const auditLog = await salaryDisputeService.getAuditLog(req.params.id);
    res.json({ success: true, data: auditLog });
  })
);

// Get attachments for a dispute
salaryDisputeRouter.get("/:id/attachments", h(async (req, res) => {
  const attachments = await salaryDisputeService.getAttachments(req.params.id);
  res.json({ success: true, data: attachments });
}));

// Upload attachment (handled by files module, this just records the reference)
salaryDisputeRouter.post("/:id/attachments", h(async (req, res) => {
  const employeeId = await getEmployeeIdForUser(req.authUser!.id);
  const dispute = await salaryDisputeService.get(req.params.id);

  if (!dispute) return res.status(404).json({ success: false, message: "Dispute not found." });

  // Only allow employee or reviewers to add attachments
  const isOwner = dispute.employee_id === employeeId;
  const isReviewer = req.authUser!.role && ["wfm", "payroll_hr", "payroll", "payroll_head", "super_admin"].includes(req.authUser!.role);
  if (!isOwner && !isReviewer) {
    return res.status(403).json({ success: false, message: "Not authorized to add attachments." });
  }

  const { fileName, filePath, fileType, fileSize } = req.body;
  if (!fileName || !filePath) {
    return res.status(400).json({ success: false, message: "fileName and filePath are required." });
  }

  const result = await salaryDisputeService.addAttachment(
    req.params.id, fileName, filePath, fileType || "unknown", fileSize || 0, req.authUser!.id
  );
  res.status(201).json({ success: true, data: result });
}));

// Delete attachment
salaryDisputeRouter.delete("/attachments/:attachmentId", h(async (req, res) => {
  await salaryDisputeService.deleteAttachment(req.params.attachmentId, req.authUser!.id);
  res.json({ success: true, message: "Attachment deleted." });
}));

// Get SLA breached disputes (admin only)
salaryDisputeRouter.get("/admin/sla-breached", requireRole("payroll_head", "super_admin", "cfo"),
  h(async (req, res) => {
    await salaryDisputeService.checkAndMarkBreachedSlas();
    const breached = await salaryDisputeService.getBreachedDisputes();
    res.json({ success: true, data: breached });
  })
);
