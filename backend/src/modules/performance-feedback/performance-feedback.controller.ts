import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { PerformanceFeedbackService } from "./performance-feedback.service.js";
import {
  createCycleSchema,
  updateCycleSchema,
  launchCycleSchema,
  createCompetencySchema,
  updateCompetencySchema,
  submitFeedbackSchema,
  createDevelopmentPlanSchema,
  updateDevelopmentPlanSchema,
  updateGoalSchema,
  cycleFiltersSchema,
  feedbackFiltersSchema,
} from "./performance-feedback.validation.js";

const service = new PerformanceFeedbackService();

async function resolveReportScope(req: AuthenticatedRequest, includeOwnForManager = false) {
  const userId = req.authUser.id;
  const requestedEmployeeId = typeof req.query.employee_id === "string"
    ? req.query.employee_id
    : typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
  const canViewAll = await hasRole(userId, "admin", "hr");
  if (canViewAll) {
    if (!requestedEmployeeId) return { authorized: true, filters: {} };
    if (requestedEmployeeId !== userId) {
      return { authorized: true, filters: { employee_id: requestedEmployeeId } };
    }

    const ownEmployee = await getEmployeeForUser(userId);
    return ownEmployee
      ? { authorized: true, filters: { employee_id: ownEmployee.id } }
      : { authorized: false, filters: {} };
  }

  const employee = await getEmployeeForUser(userId);
  if (!employee) return { authorized: false, filters: {} };

  const isManager = await hasRole(userId, "manager", "process_manager", "assistant_manager");
  if (isManager && !requestedEmployeeId) {
    return {
      authorized: true,
      filters: includeOwnForManager
        ? { employee_id: employee.id, manager_id: employee.id }
        : { manager_id: employee.id },
    };
  }

  return { authorized: true, filters: { employee_id: employee.id } };
}

export const performanceFeedbackController = {
  // ================== Cycle Management (5 endpoints) ==================

  /**
   * 1. POST /api/performance-feedback/cycles - Create new cycle
   */
  async createCycle(req: Request, res: Response) {
    try {
      const parsed = createCycleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      const createdBy = (req as any).user?.emp_id || (req as any).userId || "system";

      // Map camelCase to snake_case for service layer
      const data = {
        cycle_name: parsed.data.name,
        period: parsed.data.period,
        start_date: parsed.data.startDate,
        end_date: parsed.data.endDate,
        deadline: parsed.data.managerReviewDeadline,
        appraisal_cycle_id: undefined,
      };

      const cycle = await service.createCycle(data, createdBy);
      return res.status(201).json({ data: cycle });
    } catch (error) {
      console.error("Error creating cycle:", error);
      return res.status(500).json({ error: "Failed to create cycle" });
    }
  },

  /**
   * 2. GET /api/performance-feedback/cycles - Get all cycles with filters
   */
  async getCycles(req: Request, res: Response) {
    try {
      const parsed = cycleFiltersSchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      // Map camelCase to snake_case
      const filters = {
        status: parsed.data.status?.toLowerCase(),
        period: parsed.data.period,
      };

      const cycles = await service.getCycles(filters);
      return res.status(200).json({ data: cycles });
    } catch (error) {
      console.error("Error fetching cycles:", error);
      return res.status(500).json({ error: "Failed to fetch cycles" });
    }
  },

  /**
   * 3. GET /api/performance-feedback/cycles/:id - Get single cycle by ID
   */
  async getCycleById(req: Request, res: Response) {
    try {
      const cycleId = req.params.id;
      const cycle = await service.getCycleById(cycleId);

      if (!cycle) {
        return res.status(404).json({ error: "Cycle not found" });
      }

      return res.status(200).json({ data: cycle });
    } catch (error) {
      console.error("Error fetching cycle:", error);
      return res.status(500).json({ error: "Failed to fetch cycle" });
    }
  },

  /**
   * 4. PATCH /api/performance-feedback/cycles/:id - Update cycle
   */
  async updateCycle(req: Request, res: Response) {
    try {
      const cycleId = req.params.id;
      const parsed = updateCycleSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      // Check if cycle exists
      const existing = await service.getCycleById(cycleId);
      if (!existing) {
        return res.status(404).json({ error: "Cycle not found" });
      }

      // Map camelCase to snake_case
      const updates: any = {};
      if (parsed.data.name !== undefined) updates.cycle_name = parsed.data.name;
      if (parsed.data.period !== undefined) updates.period = parsed.data.period;
      if (parsed.data.startDate !== undefined) updates.start_date = parsed.data.startDate;
      if (parsed.data.endDate !== undefined) updates.end_date = parsed.data.endDate;
      if (parsed.data.managerReviewDeadline !== undefined) updates.deadline = parsed.data.managerReviewDeadline;

      await service.updateCycle(cycleId, updates);

      const updated = await service.getCycleById(cycleId);
      return res.status(200).json({ data: updated });
    } catch (error) {
      console.error("Error updating cycle:", error);
      return res.status(500).json({ error: "Failed to update cycle" });
    }
  },

  /**
   * 5. POST /api/performance-feedback/cycles/:id/close - Close cycle
   */
  async closeCycle(req: Request, res: Response) {
    try {
      const cycleId = req.params.id;

      // Check if cycle exists
      const existing = await service.getCycleById(cycleId);
      if (!existing) {
        return res.status(404).json({ error: "Cycle not found" });
      }

      await service.closeCycle(cycleId);
      return res.status(204).send();
    } catch (error) {
      console.error("Error closing cycle:", error);
      return res.status(500).json({ error: "Failed to close cycle" });
    }
  },

  // ================== Request Management (4 endpoints) ==================

  /**
   * 6. POST /api/performance-feedback/cycles/:cycleId/launch - Launch cycle
   */
  async launchCycle(req: Request, res: Response) {
    try {
      const cycleId = req.params.cycleId;
      const parsed = launchCycleSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      // Check if cycle exists
      const existing = await service.getCycleById(cycleId);
      if (!existing) {
        return res.status(404).json({ error: "Cycle not found" });
      }

      const data = {
        employee_ids: parsed.data.employeeIds,
      };

      const result = await service.launchCycle(cycleId, data);
      return res.status(200).json({ data: result });
    } catch (error) {
      console.error("Error launching cycle:", error);
      return res.status(500).json({ error: "Failed to launch cycle" });
    }
  },

  /**
   * 7. GET /api/performance-feedback/requests - Get requests with filters
   */
  async getRequests(req: Request, res: Response) {
    try {
      const parsed = feedbackFiltersSchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      // Map camelCase to snake_case
      const filters = {
        cycle_id: parsed.data.cycleId,
        employee_id: parsed.data.employeeId,
        status: parsed.data.status?.toLowerCase().replace("-", "_"),
      };

      const requests = await service.getRequests(filters);
      return res.status(200).json({ data: requests });
    } catch (error) {
      console.error("Error fetching requests:", error);
      return res.status(500).json({ error: "Failed to fetch requests" });
    }
  },

  /**
   * 8. GET /api/performance-feedback/requests/:id - Get single request by ID
   */
  async getRequestById(req: Request, res: Response) {
    try {
      const requestId = req.params.id;
      const request = await service.getRequestById(requestId);

      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      return res.status(200).json({ data: request });
    } catch (error) {
      console.error("Error fetching request:", error);
      return res.status(500).json({ error: "Failed to fetch request" });
    }
  },

  /**
   * 9. DELETE /api/performance-feedback/requests/:id - Delete request
   */
  async deleteRequest(req: Request, res: Response) {
    try {
      const requestId = req.params.id;

      // Check if request exists
      const existing = await service.getRequestById(requestId);
      if (!existing) {
        return res.status(404).json({ error: "Request not found" });
      }

      await service.deleteRequest(requestId);
      return res.status(204).send();
    } catch (error) {
      console.error("Error deleting request:", error);
      return res.status(500).json({ error: "Failed to delete request" });
    }
  },

  // ================== Competency Management (4 endpoints) ==================

  /**
   * 10. GET /api/performance-feedback/competencies - Get competencies with filters
   */
  async getCompetencies(req: Request, res: Response) {
    try {
      const filters = {
        is_active: req.query.isActive !== undefined ? req.query.isActive === "true" : undefined,
        category: req.query.category as string | undefined,
      };

      const competencies = await service.getCompetencies(filters);
      return res.status(200).json({ data: competencies });
    } catch (error) {
      console.error("Error fetching competencies:", error);
      return res.status(500).json({ error: "Failed to fetch competencies" });
    }
  },

  /**
   * 11. POST /api/performance-feedback/competencies - Create competency
   */
  async createCompetency(req: Request, res: Response) {
    try {
      const parsed = createCompetencySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      const data = {
        competency_name: parsed.data.name,
        description: parsed.data.description,
        category: parsed.data.category,
        display_order: parsed.data.weight,
      };

      const competency = await service.createCompetency(data);
      return res.status(201).json({ data: competency });
    } catch (error) {
      console.error("Error creating competency:", error);
      return res.status(500).json({ error: "Failed to create competency" });
    }
  },

  /**
   * 12. PATCH /api/performance-feedback/competencies/:id - Update competency
   */
  async updateCompetency(req: Request, res: Response) {
    try {
      const competencyId = req.params.id;
      const parsed = updateCompetencySchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      // Map camelCase to snake_case
      const updates: any = {};
      if (parsed.data.name !== undefined) updates.competency_name = parsed.data.name;
      if (parsed.data.description !== undefined) updates.description = parsed.data.description;
      if (parsed.data.category !== undefined) updates.category = parsed.data.category;
      if (parsed.data.weight !== undefined) updates.display_order = parsed.data.weight;

      await service.updateCompetency(competencyId, updates);
      return res.status(200).json({ message: "Competency updated successfully" });
    } catch (error) {
      console.error("Error updating competency:", error);
      return res.status(500).json({ error: "Failed to update competency" });
    }
  },

  /**
   * 13. DELETE /api/performance-feedback/competencies/:id - Deactivate competency
   */
  async deactivateCompetency(req: Request, res: Response) {
    try {
      const competencyId = req.params.id;
      await service.deactivateCompetency(competencyId);
      return res.status(204).send();
    } catch (error) {
      console.error("Error deactivating competency:", error);
      return res.status(500).json({ error: "Failed to deactivate competency" });
    }
  },

  // ================== Feedback Submission (2 endpoints) ==================

  /**
   * 14. GET /api/performance-feedback/requests/:id/form - Get form template
   */
  async getFormTemplate(req: Request, res: Response) {
    try {
      const requestId = req.params.id;
      const template = await service.getFormTemplate(requestId);
      return res.status(200).json({ data: template });
    } catch (error) {
      console.error("Error fetching form template:", error);
      const message = error instanceof Error ? error.message : "Failed to fetch form template";
      return res.status(error instanceof Error && error.message.includes("not found") ? 404 : 500)
        .json({ error: message });
    }
  },

  /**
   * 15. POST /api/performance-feedback/requests/:id/submit - Submit feedback
   */
  async submitFeedback(req: Request, res: Response) {
    try {
      const requestId = req.params.id;
      const parsed = submitFeedbackSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      const managerId = (req as any).authUser?.id || (req as any).user?.emp_id || (req as any).userId;
      if (!managerId) {
        return res.status(401).json({ error: "Unauthorized: manager ID not found" });
      }

      // Map validation schema to service DTO
      const competencies = parsed.data.competencies?.map((c) => ({
        competency_id: c.competencyId,
        competency_name: "", // Will be fetched by service
        rating: c.managerRating || c.selfRating,
        comment: c.managerComment || c.selfComment,
      })) || [];

      const kpis = parsed.data.kpis?.map((k) => ({
        kpi_id: k.kpiId,
        kpi_name: "", // Will be fetched by service
        rating: k.managerRating || k.selfRating,
        comment: k.managerComment || k.selfComment,
      })) || [];

      const data = {
        request_id: requestId,
        ratings_json: {
          competencies,
          kpis,
        },
        overall_strengths: undefined,
        development_areas: parsed.data.managerFinalComment,
      };

      const result = await service.submitFeedback(data, managerId);
      return res.status(201).json({ data: result });
    } catch (error) {
      console.error("Error submitting feedback:", error);
      const message = error instanceof Error ? error.message : "Failed to submit feedback";
      const statusCode = error instanceof Error && error.message.includes("Unauthorized") ? 403 :
        error instanceof Error && error.message.includes("not found") ? 404 : 500;
      return res.status(statusCode).json({ error: message });
    }
  },

  // ================== Report & Development Plans (9 endpoints) ==================

  /**
   * 16. POST /api/performance-feedback/requests/:id/report - Generate report
   */
  async generateReport(req: Request, res: Response) {
    try {
      const requestId = req.params.id;

      // Check if request exists
      const request = await service.getRequestById(requestId);
      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      const result = await service.generateReport(requestId);
      return res.status(201).json({ data: result });
    } catch (error) {
      console.error("Error generating report:", error);
      const message = error instanceof Error ? error.message : "Failed to generate report";
      return res.status(error instanceof Error && error.message.includes("not found") ? 404 : 500)
        .json({ error: message });
    }
  },

  /**
   * 17. GET /api/performance-feedback/reports - Get reports with filters
   */
  async getReports(req: Request, res: Response) {
    try {
      const authReq = req as AuthenticatedRequest;
      const scope = await resolveReportScope(authReq);
      if (!scope.authorized) {
        return res.status(403).json({ success: false, error: "No employee record for authenticated user" });
      }

      const requestedCycle = typeof req.query.cycle_id === "string"
        ? req.query.cycle_id
        : typeof req.query.cycleId === "string" ? req.query.cycleId : undefined;
      const reports = await service.getReports({
        ...scope.filters,
        cycle_id: requestedCycle,
      });
      return res.status(200).json({ success: true, data: reports });
    } catch (error) {
      console.error("Error fetching reports:", error);
      return res.status(500).json({ success: false, error: "Failed to fetch reports" });
    }
  },

  /**
   * 18. GET /api/performance-feedback/reports/:id - Get report by ID
   */
  async getReportById(req: Request, res: Response) {
    try {
      const scope = await resolveReportScope(req as AuthenticatedRequest, true);
      if (!scope.authorized) {
        return res.status(403).json({ success: false, error: "No employee record for authenticated user" });
      }

      const report = await service.getReportById(req.params.id, scope.filters);
      if (!report) {
        return res.status(404).json({ success: false, error: "Report not found" });
      }
      return res.status(200).json({ success: true, data: report });
    } catch (error) {
      console.error("Error fetching report:", error);
      return res.status(500).json({ success: false, error: "Failed to fetch report" });
    }
  },

  /**
   * 19. POST /api/performance-feedback/development-plans - Create development plan
   */
  async createDevelopmentPlan(req: Request, res: Response) {
    try {
      const parsed = createDevelopmentPlanSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      const createdBy = (req as any).user?.emp_id || (req as any).userId || "system";

      // Map validation schema to service DTO
      const data = {
        employee_id: parsed.data.employeeId,
        target_date: parsed.data.goals[0]?.targetDate, // Use first goal's target as plan target
        goals: parsed.data.goals.map((g) => ({
          description: g.description,
          target_date: g.targetDate,
        })),
      };

      const plan = await service.createDevelopmentPlan(data, createdBy);
      return res.status(201).json({ data: plan });
    } catch (error) {
      console.error("Error creating development plan:", error);
      return res.status(500).json({ error: "Failed to create development plan" });
    }
  },

  /**
   * 20. GET /api/performance-feedback/development-plans - Get development plans with filters
   */
  async getDevelopmentPlans(req: Request, res: Response) {
    try {
      const filters = {
        employee_id: req.query.employeeId as string | undefined,
        status: req.query.status as string | undefined,
      };

      const plans = await service.getDevelopmentPlans(filters);
      return res.status(200).json({ data: plans });
    } catch (error) {
      console.error("Error fetching development plans:", error);
      return res.status(500).json({ error: "Failed to fetch development plans" });
    }
  },

  /**
   * 21. GET /api/performance-feedback/development-plans/:id - Get development plan by ID
   */
  async getDevelopmentPlanById(req: Request, res: Response) {
    try {
      // This method is not yet implemented in service layer
      return res.status(501).json({
        error: "Not implemented",
        message: "getDevelopmentPlanById method needs to be added to service layer"
      });
    } catch (error) {
      console.error("Error fetching development plan:", error);
      return res.status(500).json({ error: "Failed to fetch development plan" });
    }
  },

  /**
   * 22. PATCH /api/performance-feedback/development-plans/:id - Update development plan
   */
  async updateDevelopmentPlan(req: Request, res: Response) {
    try {
      const planId = req.params.id;
      const parsed = updateDevelopmentPlanSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      // Map camelCase to snake_case for status and target_date
      const updates: any = {};
      if (parsed.data.goals && parsed.data.goals.length > 0) {
        // If updating goals, use the first goal's target date
        const firstGoal = parsed.data.goals[0];
        if (firstGoal.targetDate) {
          updates.target_date = firstGoal.targetDate;
        }
        if (firstGoal.status) {
          updates.status = firstGoal.status.toLowerCase().replace(" ", "_");
        }
      }

      await service.updateDevelopmentPlan(planId, updates);
      return res.status(200).json({ message: "Development plan updated successfully" });
    } catch (error) {
      console.error("Error updating development plan:", error);
      return res.status(500).json({ error: "Failed to update development plan" });
    }
  },

  /**
   * 23. PATCH /api/performance-feedback/development-plans/:planId/goals/:goalId - Update goal
   */
  async updateGoal(req: Request, res: Response) {
    try {
      const { goalId } = req.params;
      const parsed = updateGoalSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      // Map camelCase to snake_case
      const updates: any = {};
      if (parsed.data.description !== undefined) updates.description = parsed.data.description;
      if (parsed.data.targetDate !== undefined) updates.target_date = parsed.data.targetDate;
      if (parsed.data.status !== undefined) {
        updates.status = parsed.data.status.toLowerCase().replace(" ", "_");
      }
      if (parsed.data.completedDate !== undefined) updates.actual_date = parsed.data.completedDate;

      await service.updateGoal(goalId, updates);
      return res.status(200).json({ message: "Goal updated successfully" });
    } catch (error) {
      console.error("Error updating goal:", error);
      return res.status(500).json({ error: "Failed to update goal" });
    }
  },

  /**
   * 24. DELETE /api/performance-feedback/development-plans/:id - Delete development plan
   */
  async deleteDevelopmentPlan(req: Request, res: Response) {
    try {
      // This method is not yet implemented in service layer
      return res.status(501).json({
        error: "Not implemented",
        message: "deleteDevelopmentPlan method needs to be added to service layer"
      });
    } catch (error) {
      console.error("Error deleting development plan:", error);
      return res.status(500).json({ error: "Failed to delete development plan" });
    }
  },
};
