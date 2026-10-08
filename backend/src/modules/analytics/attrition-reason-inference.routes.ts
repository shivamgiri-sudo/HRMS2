/**
 * Attrition Reason Inference Routes
 * File: backend/src/modules/analytics/attrition-reason-inference.routes.ts
 * Purpose: Express routes for attrition reason inference endpoints
 */

import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { db } from '../../db/mysql.js';
import { attachEmployeeScope, canAccessEmployeeRecord } from '../dashboards/branch-scope-guards.js';
import type { NextFunction, Request, Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import { requireRole } from '../../middleware/requireRole.js';
import {
  inferAttritionReason,
  getInferredReasonBreakdown,
} from "./attrition-reason-inference.service.js";

const router = Router();

/** ?employeeId= (id or employee_code) must be inside the caller's branch / assigned scope; unknown -> handler's answer. */
async function guardEmployeeQuery(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as Request & { authUser?: { id: string } }).authUser;
    if (!user) return res.status(403).json({ success: false, error: 'Forbidden: no resolvable scope' });
    const key = String(req.query.employeeId ?? '').trim();
    if (!key) return next();
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT id FROM employees WHERE id = ? OR employee_code = ? LIMIT 1', [key, key]);
    const id = rows[0]?.id ? String(rows[0].id) : null;
    if (id && !(await canAccessEmployeeRecord(user, id))) {
      return res.status(403).json({ success: false, error: 'Forbidden: this employee is outside your branch / assigned scope' });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

// GET /api/analytics/attrition-reason-inference?employeeId=&mode=realtime|historical
router.get(
  "/",
  requireAuth,
  requireRole('hr', 'admin', 'super_admin', 'manager', 'wfm'),
  guardEmployeeQuery,
  inferAttritionReason
);

// GET /api/analytics/attrition-reason-inference/breakdown?period=YYYY-MM&branchId=
router.get(
  "/breakdown",
  requireAuth,
  requireRole('hr', 'admin', 'super_admin', 'manager', 'wfm'),
  attachEmployeeScope('e'),
  getInferredReasonBreakdown
);

export const attritionReasonInferenceRouter = router;
