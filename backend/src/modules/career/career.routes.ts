import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { careerService } from "./career.service.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";

export const careerRouter = Router();
careerRouter.use(requireAuth);

const h =
  (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: (err?: unknown) => void) =>
    fn(req, res).catch(next);

// ─── Career Path ──────────────────────────────────────────────────────────────

// GET /career/:employeeId — self or admin/hr
careerRouter.get(
  "/career/:employeeId",
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

    const record = await careerService.getCareerPath(employeeId);
    return res.json({ success: true, data: record });
  })
);

// POST /career/:employeeId — admin/hr: upsert career path
careerRouter.post(
  "/career/:employeeId",
  requireRole("admin", "hr"),
  h(async (req, res) => {
    const { employeeId } = req.params;
    const {
      current_role,
      target_role,
      target_timeline,
      readiness_pct,
      skills_gap,
      notes,
    } = req.body as {
      current_role?: string;
      target_role?: string;
      target_timeline?: string;
      readiness_pct?: number;
      skills_gap?: string;
      notes?: string;
    };

    if (readiness_pct !== undefined) {
      const val = Number(readiness_pct);
      if (isNaN(val) || val < 0 || val > 100) {
        return res.status(400).json({
          success: false,
          error: "readiness_pct must be between 0 and 100",
        });
      }
    }

    const record = await careerService.upsertCareerPath(employeeId, {
      current_role: current_role ?? null,
      target_role: target_role ?? null,
      target_timeline: target_timeline ?? null,
      readiness_pct: readiness_pct !== undefined ? Number(readiness_pct) : 0,
      skills_gap: skills_gap ?? null,
      notes: notes ?? null,
      reviewed_by: req.authUser!.id,
    });

    return res.status(200).json({ success: true, data: record });
  })
);

// GET /succession — admin/hr: all career paths sorted by readiness
careerRouter.get(
  "/succession",
  requireRole("admin", "hr"),
  h(async (_req, res) => {
    const records = await careerService.listAllCareerPaths();
    return res.json({ success: true, data: records });
  })
);

// ─── PIP ─────────────────────────────────────────────────────────────────────

// GET /pip — admin/hr sees all; manager sees team subset (by employee_id query param)
careerRouter.get(
  "/pip",
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const { status, employee_id } = req.query as {
      status?: string;
      employee_id?: string;
    };
    const privileged = await hasRole(userId, "admin", "hr");

    if (privileged) {
      const records = await careerService.listPips({ employeeId: employee_id, status });
      return res.json({ success: true, data: records });
    }

    // Manager: can only see PIPs for specific employee they specify (or no results)
    if (!employee_id) {
      return res.json({ success: true, data: [] });
    }
    const records = await careerService.listPips({ employeeId: employee_id, status });
    return res.json({ success: true, data: records });
  })
);

// POST /pip — admin/hr: create PIP
careerRouter.post(
  "/pip",
  requireRole("admin", "hr"),
  h(async (req, res) => {
    const { employee_id, start_date, end_date, reason, goals } = req.body as {
      employee_id: string;
      start_date: string;
      end_date: string;
      reason: string;
      goals?: unknown;
    };

    if (!employee_id?.trim()) {
      return res.status(400).json({ success: false, error: "employee_id is required" });
    }
    if (!start_date) {
      return res.status(400).json({ success: false, error: "start_date is required" });
    }
    if (!end_date) {
      return res.status(400).json({ success: false, error: "end_date is required" });
    }
    if (!reason?.trim()) {
      return res.status(400).json({ success: false, error: "reason is required" });
    }
    if (new Date(end_date) <= new Date(start_date)) {
      return res.status(400).json({ success: false, error: "end_date must be after start_date" });
    }

    const record = await careerService.createPip({
      employee_id: employee_id.trim(),
      initiated_by: req.authUser!.id,
      start_date,
      end_date,
      reason: reason.trim(),
      goals: goals ?? null,
    });

    return res.status(201).json({ success: true, data: record });
  })
);

// GET /pip/:id — get PIP detail with checkpoints (admin/hr)
careerRouter.get(
  "/pip/:id",
  requireRole("admin", "hr"),
  h(async (req, res) => {
    const record = await careerService.getPip(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, error: "PIP record not found" });
    }
    return res.json({ success: true, data: record });
  })
);

// PATCH /pip/:id — update PIP status/outcome (admin/hr)
careerRouter.patch(
  "/pip/:id",
  requireRole("admin", "hr"),
  h(async (req, res) => {
    const { status, outcome, review_notes } = req.body as {
      status?: "active" | "completed" | "extended" | "terminated";
      outcome?: "improved" | "not_improved" | "resigned" | "terminated" | null;
      review_notes?: string | null;
    };

    const validStatuses = ["active", "completed", "extended", "terminated"];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `status must be one of: ${validStatuses.join(", ")}`,
      });
    }

    const validOutcomes = ["improved", "not_improved", "resigned", "terminated"];
    if (outcome && !validOutcomes.includes(outcome)) {
      return res.status(400).json({
        success: false,
        error: `outcome must be one of: ${validOutcomes.join(", ")}`,
      });
    }

    const record = await careerService.updatePip(req.params.id, {
      status,
      outcome,
      review_notes: review_notes ?? null,
      closed_by: status && ["completed", "terminated"].includes(status)
        ? req.authUser!.id
        : undefined,
    });

    return res.json({ success: true, data: record });
  })
);

// POST /pip/:id/checkpoints — add checkpoint (admin/hr)
careerRouter.post(
  "/pip/:id/checkpoints",
  requireRole("admin", "hr"),
  h(async (req, res) => {
    const { checkpoint_date, rating, notes } = req.body as {
      checkpoint_date: string;
      rating: "on_track" | "at_risk" | "off_track";
      notes?: string;
    };

    if (!checkpoint_date) {
      return res.status(400).json({ success: false, error: "checkpoint_date is required" });
    }
    const validRatings = ["on_track", "at_risk", "off_track"];
    if (!rating || !validRatings.includes(rating)) {
      return res.status(400).json({
        success: false,
        error: `rating must be one of: ${validRatings.join(", ")}`,
      });
    }

    const checkpoint = await careerService.addCheckpoint({
      pip_id: req.params.id,
      checkpoint_date,
      rating,
      notes: notes ?? null,
      recorded_by: req.authUser!.id,
    });

    return res.status(201).json({ success: true, data: checkpoint });
  })
);
