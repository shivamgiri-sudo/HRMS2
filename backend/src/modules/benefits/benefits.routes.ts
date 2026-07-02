import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { benefitsService } from "./benefits.service.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";

export const benefitsRouter = Router();
benefitsRouter.use(requireAuth);

const h =
  (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: (err?: unknown) => void) =>
    fn(req, res).catch(next);

// ─── Benefit Plans ─────────────────────────────────────────────────────────

// GET /plans — any authenticated user
benefitsRouter.get(
  "/plans",
  h(async (_req, res) => {
    const plans = await benefitsService.listPlans();
    return res.json({ success: true, data: plans });
  })
);

// POST /plans — admin/hr only
benefitsRouter.post(
  "/plans",
  requireRole("admin", "hr"),
  h(async (req, res) => {
    const { plan_name, plan_type, description, eligibility_rule } = req.body as {
      plan_name: string;
      plan_type: string;
      description?: string;
      eligibility_rule?: string;
    };
    if (!plan_name?.trim()) {
      return res.status(400).json({ success: false, error: "plan_name is required" });
    }
    const validTypes = ["insurance", "transport", "meal", "wellness", "other"];
    if (!plan_type || !validTypes.includes(plan_type)) {
      return res
        .status(400)
        .json({ success: false, error: `plan_type must be one of: ${validTypes.join(", ")}` });
    }
    const plan = await benefitsService.createPlan({
      plan_name: plan_name.trim(),
      plan_type,
      description: description ?? null,
      eligibility_rule: eligibility_rule ?? null,
    });
    return res.status(201).json({ success: true, data: plan });
  })
);

// ─── Enrollments ──────────────────────────────────────────────────────────

// GET /enrollments/:employeeId — self or admin/hr
benefitsRouter.get(
  "/enrollments/:employeeId",
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const { employeeId } = req.params;
    const privileged = await hasRole(userId, "admin", "hr");

    if (!privileged) {
      const emp = await getEmployeeForUser(userId);
      if (!emp || emp.id !== employeeId) {
        return res.status(403).json({ success: false, error: "Forbidden" });
      }
    }

    const enrollments = await benefitsService.listEnrollments(employeeId);
    return res.json({ success: true, data: enrollments });
  })
);

// POST /enrollments — admin/hr only
benefitsRouter.post(
  "/enrollments",
  requireRole("admin", "hr"),
  h(async (req, res) => {
    const { employee_id, plan_id, enrolled_date, effective_from, effective_to } = req.body as {
      employee_id: string;
      plan_id: string;
      enrolled_date: string;
      effective_from: string;
      effective_to?: string;
    };
    if (!employee_id || !plan_id || !enrolled_date || !effective_from) {
      return res.status(400).json({
        success: false,
        error: "employee_id, plan_id, enrolled_date, and effective_from are required",
      });
    }
    const enrollment = await benefitsService.enroll({
      employee_id,
      plan_id,
      enrolled_date,
      effective_from,
      effective_to: effective_to ?? null,
    });
    return res.status(201).json({ success: true, data: enrollment });
  })
);

// PATCH /enrollments/:id — admin/hr only
benefitsRouter.patch(
  "/enrollments/:id",
  requireRole("admin", "hr"),
  h(async (req, res) => {
    const { status } = req.body as { status: "active" | "inactive" | "pending" };
    const validStatuses = ["active", "inactive", "pending"];
    if (!status || !validStatuses.includes(status)) {
      return res
        .status(400)
        .json({ success: false, error: `status must be one of: ${validStatuses.join(", ")}` });
    }
    const enrollment = await benefitsService.updateEnrollmentStatus(req.params.id, status);
    return res.json({ success: true, data: enrollment });
  })
);

// ─── Claims ───────────────────────────────────────────────────────────────

// GET /claims — admin/hr sees all; employee sees own
benefitsRouter.get(
  "/claims",
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const { status, employee_id } = req.query as { status?: string; employee_id?: string };
    const privileged = await hasRole(userId, "admin", "hr");

    if (privileged) {
      const claims = await benefitsService.listClaims({
        employeeId: employee_id,
        status,
      });
      const stats = await benefitsService.claimStats();
      return res.json({ success: true, data: claims, stats });
    }

    // Non-privileged: only own claims
    const emp = await getEmployeeForUser(userId);
    if (!emp) {
      return res.status(403).json({ success: false, error: "No employee record linked to account" });
    }
    const claims = await benefitsService.listClaims({ employeeId: emp.id, status });
    return res.json({ success: true, data: claims });
  })
);

// POST /claims — employee submits own claim
benefitsRouter.post(
  "/claims",
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const emp = await getEmployeeForUser(userId);
    if (!emp) {
      // Admin/HR can specify employee_id explicitly
      const privileged = await hasRole(userId, "admin", "hr");
      if (!privileged || !req.body.employee_id) {
        return res
          .status(403)
          .json({ success: false, error: "No employee record linked to account" });
      }
    }

    const employee_id = (emp?.id ?? (req.body as { employee_id?: string }).employee_id) as string;
    const { claim_type, amount, claim_date, description, receipt_ref } = req.body as {
      claim_type: string;
      amount: number;
      claim_date: string;
      description?: string;
      receipt_ref?: string;
    };

    const validTypes = ["travel", "medical", "meal", "equipment", "other"];
    if (!claim_type || !validTypes.includes(claim_type)) {
      return res
        .status(400)
        .json({ success: false, error: `claim_type must be one of: ${validTypes.join(", ")}` });
    }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ success: false, error: "amount must be a positive number" });
    }
    if (!claim_date) {
      return res.status(400).json({ success: false, error: "claim_date is required" });
    }

    const claim = await benefitsService.submitClaim({
      employee_id,
      claim_type,
      amount: Number(amount),
      claim_date,
      description: description ?? null,
      receipt_ref: receipt_ref ?? null,
    });
    return res.status(201).json({ success: true, data: claim });
  })
);

// PATCH /claims/:id/review — admin/hr only
benefitsRouter.patch(
  "/claims/:id/review",
  requireRole("admin", "hr"),
  h(async (req, res) => {
    const { action, remarks } = req.body as {
      action: "approved" | "rejected";
      remarks?: string;
    };
    if (!["approved", "rejected"].includes(action)) {
      return res
        .status(400)
        .json({ success: false, error: "action must be 'approved' or 'rejected'" });
    }
    const claim = await benefitsService.reviewClaim(
      req.params.id,
      action,
      req.authUser!.id,
      remarks ?? null
    );
    return res.json({ success: true, data: claim });
  })
);
