import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import * as taskController from './task.controller.js';
import { db } from '../../db/mysql.js';
import { canViewEmployee } from '../../shared/enterpriseScope.js';
import { employeeRowScope } from '../org/branchScope.js';
import type { NextFunction, Request, Response } from 'express';
import type { RowDataPacket } from 'mysql2';

// Branch scoping (owner ruling 2026-10-01): an employee's tasks can be read / changed by that employee, the task
// assignee, or someone whose branch / assigned scope covers the employee. Org-wide roles pass.
const forbid = (res: Response) => res.status(403).json({ success: false, message: 'Forbidden: outside your branch / assigned scope' });

async function guardEmployeeParam(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).authUser?.id as string | undefined;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (await canViewEmployee({ id: userId }, String(req.params.employeeId))) return next();
    return forbid(res);
  } catch (err) { return next(err); }
}

async function guardTaskParam(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).authUser?.id as string | undefined;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const [rows] = await db.execute<RowDataPacket[]>('SELECT employee_id, assigned_to_user_id FROM employee_task WHERE id = ? LIMIT 1', [req.params.taskId]);
    const t = (rows as RowDataPacket[])[0];
    if (!t) return next(); // handler answers for unknown ids
    if (t.assigned_to_user_id && String(t.assigned_to_user_id) === userId) return next();
    if (t.employee_id && (await canViewEmployee({ id: userId }, String(t.employee_id)))) return next();
    return forbid(res);
  } catch (err) { return next(err); }
}

async function attachRowScope(req: Request, _res: Response, next: NextFunction) {
  try {
    (req as any).rowScope = await employeeRowScope((req as any).authUser, 'e');
    next();
  } catch (err) { next(err); }
}

const router = Router();

// All task routes require authentication
router.use(requireAuth);

// Employee onboarding tasks
router.post(
  '/employee/:employeeId/create-onboarding',
  requireRole('admin', 'hr'),
  guardEmployeeParam,
  taskController.createOnboardingTasks
);

router.get('/employee/:employeeId', guardEmployeeParam, taskController.getEmployeeTasks);
router.get('/employee/:employeeId/progress', guardEmployeeParam, taskController.getOnboardingProgress);

// Department tasks
router.get('/department/:dept', attachRowScope, taskController.getDepartmentTasks);

// My tasks
router.get("/my-tasks", taskController.getMyTasks);

// Task actions
router.put('/:taskId/start', guardTaskParam, taskController.startTask);
router.put('/:taskId/complete', guardTaskParam, taskController.completeTask);
router.put('/:taskId/update', guardTaskParam, taskController.updateTask);

// Task comments
router.post('/:taskId/comment', guardTaskParam, taskController.addComment);
router.get('/:taskId/comments', guardTaskParam, taskController.getTaskComments);

// Admin
router.get('/overdue', requireRole('admin', 'hr'), attachRowScope, taskController.getOverdueTasks);

export default router;
