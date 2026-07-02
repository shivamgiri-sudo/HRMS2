import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import * as taskController from './task.controller.js';

const router = Router();

// All task routes require authentication
router.use(requireAuth);

// Employee onboarding tasks
router.post(
  '/employee/:employeeId/create-onboarding',
  requireRole('admin', 'hr', 'hr_admin'),
  taskController.createOnboardingTasks
);

router.get('/employee/:employeeId', taskController.getEmployeeTasks);
router.get('/employee/:employeeId/progress', taskController.getOnboardingProgress);

// Department tasks
router.get('/department/:dept', taskController.getDepartmentTasks);

// My tasks
router.get('/my-tasks', taskController.getMyTasks);

// Task actions
router.put('/:taskId/start', taskController.startTask);
router.put('/:taskId/complete', taskController.completeTask);
router.put('/:taskId/update', taskController.updateTask);

// Task comments
router.post('/:taskId/comment', taskController.addComment);
router.get('/:taskId/comments', taskController.getTaskComments);

// Admin
router.get('/overdue', requireRole('admin', 'hr'), taskController.getOverdueTasks);

export default router;
