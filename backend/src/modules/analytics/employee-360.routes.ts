/**
 * Employee 360 Composite Profile Routes
 * File: backend/src/modules/analytics/employee-360.routes.ts
 *
 * Exposes GET /api/analytics/employee-360/:employeeId?period=YYYY-MM
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getEmployee360Profile } from "./employee-360.service.js";

export const employee360Router = Router();

employee360Router.use(requireAuth);
employee360Router.use(requireRole("hr", "admin", "super_admin", "manager", "wfm", "payroll", "branch_head"));

// GET /api/analytics/employee-360/:employeeId?period=YYYY-MM
employee360Router.get("/:employeeId", getEmployee360Profile);
