import type { Request, Response } from 'express';
import { taskService } from './task.service.js';

/**
 * Create tasks for employee from template
 * POST /api/tasks/employee/:employeeId/create-onboarding
 */
export async function createOnboardingTasks(req: Request, res: Response) {
  try {
    const { employeeId } = req.params;
    const { template_code = 'GENERAL_ONBOARDING' } = req.body;

    const tasks = await taskService.createTasksFromTemplate({
      employee_id: employeeId,
      template_code,
      trigger_event: 'employee_onboarding_started',
    });

    return res.json({
      success: true,
      message: `Created ${tasks.length} tasks for employee`,
      data: tasks,
    });
  } catch (error: any) {
    console.error('[TASKS] Error creating onboarding tasks:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * Get all tasks for employee
 * GET /api/tasks/employee/:employeeId
 */
export async function getEmployeeTasks(req: Request, res: Response) {
  try {
    const { employeeId } = req.params;

    const tasks = await taskService.getEmployeeTasks(employeeId);

    return res.json({
      success: true,
      data: tasks,
      count: tasks.length,
    });
  } catch (error: any) {
    console.error('[TASKS] Error getting employee tasks:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * Get onboarding progress for employee
 * GET /api/tasks/employee/:employeeId/progress
 */
export async function getOnboardingProgress(req: Request, res: Response) {
  try {
    const { employeeId } = req.params;

    const progress = await taskService.getOnboardingProgress(employeeId);

    return res.json({
      success: true,
      data: progress,
    });
  } catch (error: any) {
    console.error('[TASKS] Error getting onboarding progress:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * Get tasks for department
 * GET /api/tasks/department/:dept
 */
export async function getDepartmentTasks(req: Request, res: Response) {
  try {
    const { dept } = req.params;
    const { status } = req.query;

    const tasks = await taskService.getDepartmentTasks(dept, status as string);

    return res.json({
      success: true,
      data: tasks,
      count: tasks.length,
    });
  } catch (error: any) {
    console.error('[TASKS] Error getting department tasks:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * Get my tasks
 * GET /api/tasks/my-tasks
 */
export async function getMyTasks(req: Request, res: Response) {
  try {
    const userId = (req as any).authUser?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized',
      });
    }

    const tasks = await taskService.getMyTasks(userId);

    return res.json({
      success: true,
      data: tasks,
      count: tasks.length,
    });
  } catch (error: any) {
    console.error('[TASKS] Error getting my tasks:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * Start task
 * PUT /api/tasks/:taskId/start
 */
export async function startTask(req: Request, res: Response) {
  try {
    const { taskId } = req.params;
    const userId = (req as any).authUser?.id;

    const task = await taskService.startTask(taskId, userId);

    return res.json({
      success: true,
      message: 'Task started',
      data: task,
    });
  } catch (error: any) {
    console.error('[TASKS] Error starting task:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * Complete task
 * PUT /api/tasks/:taskId/complete
 */
export async function completeTask(req: Request, res: Response) {
  try {
    const { taskId } = req.params;
    const { notes } = req.body;
    const userId = (req as any).authUser?.id;

    const task = await taskService.completeTask(taskId, userId, notes);

    return res.json({
      success: true,
      message: 'Task completed',
      data: task,
    });
  } catch (error: any) {
    console.error('[TASKS] Error completing task:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * Update task
 * PUT /api/tasks/:taskId/update
 */
export async function updateTask(req: Request, res: Response) {
  try {
    const { taskId } = req.params;
    const userId = (req as any).authUser?.id;

    const task = await taskService.updateTask(taskId, req.body, userId);

    return res.json({
      success: true,
      message: 'Task updated',
      data: task,
    });
  } catch (error: any) {
    console.error('[TASKS] Error updating task:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * Add comment
 * POST /api/tasks/:taskId/comment
 */
export async function addComment(req: Request, res: Response) {
  try {
    const { taskId } = req.params;
    const { comment_text } = req.body;
    const userId = (req as any).authUser?.id;

    if (!comment_text) {
      return res.status(400).json({
        success: false,
        message: 'comment_text is required',
      });
    }

    const comment = await taskService.addComment(taskId, userId, comment_text);

    return res.json({
      success: true,
      data: comment,
    });
  } catch (error: any) {
    console.error('[TASKS] Error adding comment:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * Get task comments
 * GET /api/tasks/:taskId/comments
 */
export async function getTaskComments(req: Request, res: Response) {
  try {
    const { taskId } = req.params;

    const comments = await taskService.getTaskComments(taskId);

    return res.json({
      success: true,
      data: comments,
      count: comments.length,
    });
  } catch (error: any) {
    console.error('[TASKS] Error getting comments:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * Get overdue tasks
 * GET /api/tasks/overdue
 */
export async function getOverdueTasks(req: Request, res: Response) {
  try {
    const tasks = await taskService.getOverdueTasks();

    return res.json({
      success: true,
      data: tasks,
      count: tasks.length,
    });
  } catch (error: any) {
    console.error('[TASKS] Error getting overdue tasks:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}
