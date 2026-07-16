import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { goalsService } from "./goals.service.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";

export const goalsRouter = Router();
goalsRouter.use(requireAuth);

const h =
  (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: (err?: unknown) => void) =>
    fn(req, res).catch(next);

// ─── Goals ────────────────────────────────────────────────────────────────────

// GET /goals — admin/hr sees all; employee sees own
goalsRouter.get(
  "/goals",
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const { period, employee_id } = req.query as {
      period?: string;
      employee_id?: string;
    };

    const privileged = await hasRole(userId, "admin", "hr");

    if (privileged) {
      const goals = await goalsService.listGoals({
        employeeId: employee_id,
        period,
      });
      return res.json({ success: true, data: goals });
    }

    const emp = await getEmployeeForUser(userId);
    if (!emp) {
      return res.status(403).json({ success: false, error: "No employee record found" });
    }

    const goals = await goalsService.listGoals({ employeeId: emp.id, period });
    return res.json({ success: true, data: goals });
  })
);

// POST /goals — create goal
goalsRouter.post(
  "/goals",
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const {
      employee_id,
      title,
      description,
      goal_type,
      period,
      target_value,
      weightage,
    } = req.body as {
      employee_id?: string;
      title: string;
      description?: string;
      goal_type?: "individual" | "team" | "department" | "company";
      period: string;
      target_value?: number;
      weightage?: number;
    };

    if (!title?.trim()) {
      return res.status(400).json({ success: false, error: "title is required" });
    }
    if (!period?.trim()) {
      return res.status(400).json({ success: false, error: "period is required" });
    }

    const privileged = await hasRole(userId, "admin", "hr");
    let resolvedEmployeeId: string;

    if (privileged) {
      if (!employee_id?.trim()) {
        return res.status(400).json({ success: false, error: "employee_id is required" });
      }
      resolvedEmployeeId = employee_id.trim();
    } else {
      const emp = await getEmployeeForUser(userId);
      if (!emp) {
        return res.status(403).json({ success: false, error: "No employee record found" });
      }
      resolvedEmployeeId = emp.id;
    }

    const goal = await goalsService.createGoal({
      employee_id: resolvedEmployeeId,
      title: title.trim(),
      description: description ?? null,
      goal_type: goal_type ?? "individual",
      period: period.trim(),
      target_value: target_value ?? null,
      weightage: weightage ?? 100,
      created_by: userId,
    });

    return res.status(201).json({ success: true, data: goal });
  })
);

// PATCH /goals/:id — update goal (owner or admin/hr)
goalsRouter.patch(
  "/goals/:id",
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const { id } = req.params;
    const { actual_value, status, description } = req.body as {
      actual_value?: number | null;
      status?: "draft" | "active" | "completed" | "cancelled";
      description?: string | null;
    };

    const privileged = await hasRole(userId, "admin", "hr");

    if (!privileged) {
      const emp = await getEmployeeForUser(userId);
      if (!emp) {
        return res.status(403).json({ success: false, error: "No employee record found" });
      }
      const goals = await goalsService.listGoals({ employeeId: emp.id });
      const owns = goals.some((g) => g.id === id);
      if (!owns) {
        return res.status(403).json({ success: false, error: "Forbidden" });
      }
    }

    const validStatuses = ["draft", "active", "completed", "cancelled"];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `status must be one of: ${validStatuses.join(", ")}`,
      });
    }

    const goal = await goalsService.updateGoal(id, { actual_value, status, description });
    return res.json({ success: true, data: goal });
  })
);

// ─── Appraisal Cycles ─────────────────────────────────────────────────────────

// GET /appraisal/cycles
goalsRouter.get(
  "/appraisal/cycles",
  requireRole("admin", "hr"),
  h(async (_req, res) => {
    const cycles = await goalsService.listCycles();
    return res.json({ success: true, data: cycles });
  })
);

// POST /appraisal/cycles
goalsRouter.post(
  "/appraisal/cycles",
  requireRole("admin", "hr"),
  h(async (req, res) => {
    const { cycle_name, period, start_date, end_date } = req.body as {
      cycle_name: string;
      period: string;
      start_date: string;
      end_date: string;
    };

    if (!cycle_name?.trim()) {
      return res.status(400).json({ success: false, error: "cycle_name is required" });
    }
    if (!period?.trim()) {
      return res.status(400).json({ success: false, error: "period is required" });
    }
    if (!start_date) {
      return res.status(400).json({ success: false, error: "start_date is required" });
    }
    if (!end_date) {
      return res.status(400).json({ success: false, error: "end_date is required" });
    }
    if (new Date(end_date) <= new Date(start_date)) {
      return res.status(400).json({ success: false, error: "end_date must be after start_date" });
    }

    const cycle = await goalsService.createCycle({
      cycle_name: cycle_name.trim(),
      period: period.trim(),
      start_date,
      end_date,
    });

    return res.status(201).json({ success: true, data: cycle });
  })
);

// PATCH /appraisal/cycles/:id — update cycle status
goalsRouter.patch(
  "/appraisal/cycles/:id",
  requireRole("admin", "hr"),
  h(async (req, res) => {
    const { status } = req.body as { status?: "draft" | "active" | "closed" };

    const validStatuses = ["draft", "active", "closed"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `status must be one of: ${validStatuses.join(", ")}`,
      });
    }

    const cycle = await goalsService.updateCycleStatus(req.params.id, status);
    return res.json({ success: true, data: cycle });
  })
);

// ─── Appraisal Ratings ────────────────────────────────────────────────────────

// GET /appraisal/ratings?cycle_id=...
goalsRouter.get(
  "/appraisal/ratings",
  requireRole("admin", "hr"),
  h(async (req, res) => {
    const { cycle_id } = req.query as { cycle_id?: string };
    if (!cycle_id) {
      return res.status(400).json({ success: false, error: "cycle_id query param is required" });
    }
    const ratings = await goalsService.listRatings(cycle_id);
    return res.json({ success: true, data: ratings });
  })
);

// POST /appraisal/ratings/:cycleId/:employeeId/self — self rating only
goalsRouter.post(
  "/appraisal/ratings/:cycleId/:employeeId/self",
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const { cycleId, employeeId } = req.params;
    const { self_rating, self_comments } = req.body as {
      self_rating: number;
      self_comments?: string;
    };

    if (self_rating == null) {
      return res.status(400).json({ success: false, error: "self_rating is required" });
    }
    const rating = Number(self_rating);
    if (isNaN(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, error: "self_rating must be between 1 and 5" });
    }

    // Verify employee is submitting their own self-rating
    const privileged = await hasRole(userId, "admin", "hr");
    if (!privileged) {
      const emp = await getEmployeeForUser(userId);
      if (!emp || emp.id !== employeeId) {
        return res.status(403).json({ success: false, error: "Forbidden" });
      }
    }

    const record = await goalsService.submitSelfRating(cycleId, employeeId, {
      self_rating: rating,
      self_comments: self_comments ?? null,
    });
    return res.json({ success: true, data: record });
  })
);

// POST /appraisal/ratings/:cycleId/:employeeId/manager — manager/admin/hr rating
goalsRouter.post(
  "/appraisal/ratings/:cycleId/:employeeId/manager",
  requireRole("admin", "hr", "manager"),
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const { cycleId, employeeId } = req.params;
    const { manager_rating, final_rating, manager_comments } = req.body as {
      manager_rating: number;
      final_rating?: number;
      manager_comments?: string;
    };

    if (manager_rating == null) {
      return res.status(400).json({ success: false, error: "manager_rating is required" });
    }
    const mRating = Number(manager_rating);
    if (isNaN(mRating) || mRating < 1 || mRating > 5) {
      return res.status(400).json({
        success: false,
        error: "manager_rating must be between 1 and 5",
      });
    }

    if (final_rating != null) {
      const fRating = Number(final_rating);
      if (isNaN(fRating) || fRating < 1 || fRating > 5) {
        return res.status(400).json({
          success: false,
          error: "final_rating must be between 1 and 5",
        });
      }
    }

    const record = await goalsService.submitManagerRating(cycleId, employeeId, userId, {
      manager_rating: mRating,
      final_rating: final_rating != null ? Number(final_rating) : null,
      manager_comments: manager_comments ?? null,
    });
    return res.json({ success: true, data: record });
  })
);

// ─── Skills ───────────────────────────────────────────────────────────────────

// GET /skills — any authenticated user
goalsRouter.get(
  "/skills",
  h(async (_req, res) => {
    const skills = await goalsService.listSkillMaster();
    return res.json({ success: true, data: skills });
  })
);

// POST /skills — admin/hr only
goalsRouter.post(
  "/skills",
  requireRole("admin", "hr"),
  h(async (req, res) => {
    const { skill_name, skill_category, description } = req.body as {
      skill_name: string;
      skill_category?: string;
      description?: string;
    };

    if (!skill_name?.trim()) {
      return res.status(400).json({ success: false, error: "skill_name is required" });
    }

    const skill = await goalsService.createSkill({
      skill_name: skill_name.trim(),
      skill_category: skill_category ?? null,
      description: description ?? null,
    });

    return res.status(201).json({ success: true, data: skill });
  })
);

// GET /skills/employee/:employeeId — self or admin/hr
goalsRouter.get(
  "/skills/employee/:employeeId",
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

    const skills = await goalsService.listEmployeeSkills(employeeId);
    return res.json({ success: true, data: skills });
  })
);

// POST /skills/employee/:employeeId — admin/hr: add/update employee skill
goalsRouter.post(
  "/skills/employee/:employeeId",
  requireRole("admin", "hr"),
  h(async (req, res) => {
    const { employeeId } = req.params;
    const { skill_id, proficiency, certified, assessed_date, notes } = req.body as {
      skill_id: string;
      proficiency: "beginner" | "intermediate" | "advanced" | "expert";
      certified?: number;
      assessed_date?: string;
      notes?: string;
    };

    if (!skill_id?.trim()) {
      return res.status(400).json({ success: false, error: "skill_id is required" });
    }

    const validProficiencies = ["beginner", "intermediate", "advanced", "expert"];
    if (!proficiency || !validProficiencies.includes(proficiency)) {
      return res.status(400).json({
        success: false,
        error: `proficiency must be one of: ${validProficiencies.join(", ")}`,
      });
    }

    const empSkill = await goalsService.upsertEmployeeSkill(employeeId, {
      skill_id: skill_id.trim(),
      proficiency,
      certified: certified ?? 0,
      assessed_date: assessed_date ?? null,
      notes: notes ?? null,
    });

    return res.status(200).json({ success: true, data: empSkill });
  })
);

// DELETE /goals/:id — owner or admin/hr only; completed goals cannot be deleted
goalsRouter.delete(
  "/goals/:id",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUser!.id;
    const { id } = req.params;
    const privileged = await hasRole(userId, "admin", "hr");
    if (!privileged) {
      const emp = await getEmployeeForUser(userId);
      const [rows] = await import("../../db/mysql.js").then(m =>
        m.db.execute<import("mysql2").RowDataPacket[]>("SELECT employee_id FROM goal WHERE id = ? LIMIT 1", [id])
      );
      const goalRow = (rows as import("mysql2").RowDataPacket[])[0];
      if (!emp || !goalRow || goalRow.employee_id !== emp.id) {
        return res.status(403).json({ success: false, error: "Forbidden — you can only delete your own goals" });
      }
    }
    await goalsService.deleteGoal(id, null);
    return res.json({ success: true });
  })
);

// DELETE /appraisal/ratings/:id — admin/hr only
goalsRouter.delete(
  "/appraisal/ratings/:id",
  requireRole("admin", "hr"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    await goalsService.deleteAppraisalRating(req.params.id);
    return res.json({ success: true });
  })
);

// DELETE /skills/employee/:employeeId/:skillId — owner or admin/hr
goalsRouter.delete(
  "/skills/employee/:employeeId/:skillId",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUser!.id;
    const { employeeId, skillId } = req.params;
    const privileged = await hasRole(userId, "admin", "hr");
    if (!privileged) {
      const emp = await getEmployeeForUser(userId);
      if (!emp || emp.id !== employeeId) {
        return res.status(403).json({ success: false, error: "Forbidden" });
      }
    }
    await goalsService.deleteEmployeeSkill(employeeId, skillId);
    return res.json({ success: true });
  })
);

