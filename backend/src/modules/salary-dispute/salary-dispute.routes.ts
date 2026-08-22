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
