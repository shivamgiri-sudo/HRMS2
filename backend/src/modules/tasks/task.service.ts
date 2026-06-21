import { randomUUID } from 'crypto';
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import type {
  TaskMaster,
  TaskTemplate,
  TaskTemplateItem,
  EmployeeTask,
  CreateTasksInput,
  UpdateTaskInput,
  OnboardingProgress,
  EmployeeTaskComment,
} from './task.types.js';

export const taskService = {
  /**
   * Create tasks for an employee from a template
   */
  async createTasksFromTemplate(input: CreateTasksInput): Promise<EmployeeTask[]> {
    // Get template with items
    const [templates] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM task_template WHERE template_code = ? AND active_status = TRUE LIMIT 1`,
      [input.template_code]
    );

    if (!templates.length) {
      throw new Error(`Template not found: ${input.template_code}`);
    }

    const template = templates[0] as TaskTemplate;

    // Get template items with task details
    const [items] = await db.execute<RowDataPacket[]>(
      `SELECT
        tti.*,
        tm.task_code,
        tm.task_name,
        tm.task_description,
        tm.department,
        tm.default_assignee_role,
        tm.estimated_hours,
        tm.sla_hours,
        tm.requires_attachment,
        tm.requires_approval,
        tm.task_instructions,
        tm.checklist_items
       FROM task_template_item tti
       JOIN task_master tm ON tm.id = tti.task_id
       WHERE tti.template_id = ?
       ORDER BY tti.sequence_order ASC`,
      [template.id]
    );

    if (!items.length) {
      throw new Error(`Template has no tasks: ${input.template_code}`);
    }

    const createdTasks: EmployeeTask[] = [];
    const now = new Date();

    // Create tasks
    for (const item of items as any[]) {
      const taskId = randomUUID();

      // Calculate due date based on SLA
      const slaHours = item.sla_override_hours || item.sla_hours || 24;
      const dueDate = new Date(now);
      dueDate.setHours(dueDate.getHours() + slaHours);

      // Parse dependency_task_ids if exists
      const dependencyTaskIds = item.dependency_task_ids
        ? (typeof item.dependency_task_ids === 'string' ? JSON.parse(item.dependency_task_ids) : item.dependency_task_ids)
        : null;

      await db.execute(
        `INSERT INTO employee_task (
          id, task_code, employee_id, task_name, task_description, department,
          assigned_to_role, status, priority, due_date,
          dependency_task_ids, trigger_event, template_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'medium', ?, ?, ?, ?)`,
        [
          taskId,
          item.task_code,
          input.employee_id,
          item.task_name,
          item.task_description,
          item.department,
          item.default_assignee_role,
          dueDate,
          dependencyTaskIds ? JSON.stringify(dependencyTaskIds) : null,
          input.trigger_event,
          template.id,
        ]
      );

      // Create checklist items if exists
      if (item.checklist_items) {
        const checklistItems = typeof item.checklist_items === 'string'
          ? JSON.parse(item.checklist_items)
          : item.checklist_items;

        if (Array.isArray(checklistItems)) {
          for (let i = 0; i < checklistItems.length; i++) {
            await db.execute(
              `INSERT INTO employee_task_checklist (id, task_id, item_text, sequence_order)
               VALUES (UUID(), ?, ?, ?)`,
              [taskId, checklistItems[i], i + 1]
            );
          }
        }
      }

      // Get created task
      const [created] = await db.execute<RowDataPacket[]>(
        `SELECT * FROM employee_task WHERE id = ? LIMIT 1`,
        [taskId]
      );

      createdTasks.push(created[0] as EmployeeTask);

      // Create system comment
      await db.execute(
        `INSERT INTO employee_task_comment (id, task_id, user_id, comment_text, is_system_generated)
         VALUES (UUID(), ?, 'system', ?, TRUE)`,
        [taskId, `Task created automatically from template: ${template.template_name}`]
      );
    }

    return createdTasks;
  },

  /**
   * Get all tasks for an employee
   */
  async getEmployeeTasks(employeeId: string): Promise<EmployeeTask[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM employee_task WHERE employee_id = ? ORDER BY due_date ASC, priority DESC`,
      [employeeId]
    );
    return rows as EmployeeTask[];
  },

  /**
   * Get onboarding progress for an employee
   */
  async getOnboardingProgress(employeeId: string): Promise<OnboardingProgress> {
    // Get employee details
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_code, full_name, date_of_joining FROM employees WHERE id = ? LIMIT 1`,
      [employeeId]
    );

    if (!empRows.length) {
      throw new Error('Employee not found');
    }

    const emp = empRows[0];

    // Get all onboarding tasks
    const [tasks] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM employee_task
       WHERE employee_id = ?
       AND trigger_event LIKE '%onboarding%'
       ORDER BY due_date ASC`,
      [employeeId]
    );

    const now = new Date();
    const total = tasks.length;
    const completed = tasks.filter((t: any) => t.status === 'completed').length;
    const in_progress = tasks.filter((t: any) => t.status === 'in_progress').length;
    const overdue = tasks.filter((t: any) =>
      t.status !== 'completed' && new Date(t.due_date) < now
    ).length;
    const pending = total - completed - in_progress;

    // Department-wise breakdown
    const deptMap = new Map<string, any>();
    tasks.forEach((t: any) => {
      if (!deptMap.has(t.department)) {
        deptMap.set(t.department, { department: t.department, total: 0, completed: 0, pending: 0, overdue: 0 });
      }
      const dept = deptMap.get(t.department)!;
      dept.total++;
      if (t.status === 'completed') dept.completed++;
      else dept.pending++;
      if (t.status !== 'completed' && new Date(t.due_date) < now) dept.overdue++;
    });

    // Get critical pending (high/urgent priority or overdue)
    const critical = tasks.filter((t: any) =>
      t.status !== 'completed' &&
      (t.priority === 'high' || t.priority === 'urgent' || new Date(t.due_date) < now)
    ).slice(0, 5) as EmployeeTask[];

    // Estimate completion date based on remaining tasks and avg SLA
    let estimatedCompletion: string | null = null;
    if (pending > 0) {
      const avgSla = 24; // hours
      const est = new Date();
      est.setHours(est.getHours() + (pending * avgSla));
      estimatedCompletion = est.toISOString();
    }

    const [firstTask] = await db.execute<RowDataPacket[]>(
      `SELECT MIN(created_at) as started FROM employee_task WHERE employee_id = ?`,
      [employeeId]
    );

    return {
      employee_id: employeeId,
      employee_code: emp.employee_code,
      employee_name: emp.full_name,
      date_of_joining: emp.date_of_joining,
      onboarding_started: firstTask[0]?.started || new Date().toISOString(),
      total_tasks: total,
      completed_tasks: completed,
      in_progress_tasks: in_progress,
      overdue_tasks: overdue,
      pending_tasks: pending,
      completion_percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
      estimated_completion_date: estimatedCompletion,
      department_wise: Array.from(deptMap.values()),
      critical_pending: critical,
    };
  },

  /**
   * Get tasks for a department
   */
  async getDepartmentTasks(department: string, status?: string): Promise<EmployeeTask[]> {
    let query = `
      SELECT et.*, e.employee_code, e.full_name as employee_name
      FROM employee_task et
      JOIN employees e ON e.id = et.employee_id
      WHERE et.department = ?
    `;
    const params: any[] = [department];

    if (status) {
      query += ` AND et.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY et.due_date ASC, et.priority DESC`;

    const [rows] = await db.execute<RowDataPacket[]>(query, params);
    return rows as EmployeeTask[];
  },

  /**
   * Get tasks assigned to a user
   */
  async getMyTasks(userId: string): Promise<EmployeeTask[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT et.*, e.employee_code, e.full_name as employee_name
       FROM employee_task et
       JOIN employees e ON e.id = et.employee_id
       WHERE et.assigned_to_user_id = ?
       AND et.status IN ('pending', 'in_progress')
       ORDER BY et.due_date ASC, et.priority DESC`,
      [userId]
    );
    return rows as EmployeeTask[];
  },

  /**
   * Update task
   */
  async updateTask(taskId: string, input: UpdateTaskInput, userId: string): Promise<EmployeeTask> {
    const updates: string[] = [];
    const params: any[] = [];

    Object.entries(input).forEach(([key, value]) => {
      if (value !== undefined) {
        updates.push(`${key} = ?`);
        params.push(value);
      }
    });

    if (updates.length === 0) {
      throw new Error('No fields to update');
    }

    params.push(taskId);

    await db.execute(
      `UPDATE employee_task SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    // Add comment
    const changeLog = Object.entries(input).map(([k, v]) => `${k}: ${v}`).join(', ');
    await db.execute(
      `INSERT INTO employee_task_comment (id, task_id, user_id, comment_text)
       VALUES (UUID(), ?, ?, ?)`,
      [taskId, userId, `Task updated: ${changeLog}`]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM employee_task WHERE id = ? LIMIT 1`,
      [taskId]
    );
    return rows[0] as EmployeeTask;
  },

  /**
   * Start task
   */
  async startTask(taskId: string, userId: string): Promise<EmployeeTask> {
    await db.execute(
      `UPDATE employee_task
       SET status = 'in_progress', started_at = NOW(), assigned_to_user_id = ?
       WHERE id = ?`,
      [userId, taskId]
    );

    await db.execute(
      `INSERT INTO employee_task_comment (id, task_id, user_id, comment_text)
       VALUES (UUID(), ?, ?, 'Task started')`,
      [taskId, userId]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM employee_task WHERE id = ? LIMIT 1`,
      [taskId]
    );
    return rows[0] as EmployeeTask;
  },

  /**
   * Complete task
   */
  async completeTask(taskId: string, userId: string, notes?: string): Promise<EmployeeTask> {
    await db.execute(
      `UPDATE employee_task
       SET status = 'completed', completed_at = NOW(), completed_by = ?, completion_notes = ?
       WHERE id = ?`,
      [userId, notes || null, taskId]
    );

    await db.execute(
      `INSERT INTO employee_task_comment (id, task_id, user_id, comment_text)
       VALUES (UUID(), ?, ?, ?)`,
      [taskId, userId, notes || 'Task completed']
    );

    // Check if this unblocks any dependent tasks
    const [dependentTasks] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM employee_task
       WHERE JSON_CONTAINS(dependency_task_ids, ?)`,
      [JSON.stringify(taskId)]
    );

    // Could add logic here to notify about unblocked tasks

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM employee_task WHERE id = ? LIMIT 1`,
      [taskId]
    );
    return rows[0] as EmployeeTask;
  },

  /**
   * Add comment to task
   */
  async addComment(taskId: string, userId: string, commentText: string): Promise<EmployeeTaskComment> {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO employee_task_comment (id, task_id, user_id, comment_text)
       VALUES (?, ?, ?, ?)`,
      [id, taskId, userId, commentText]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM employee_task_comment WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0] as EmployeeTaskComment;
  },

  /**
   * Get task comments
   */
  async getTaskComments(taskId: string): Promise<EmployeeTaskComment[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT c.*, COALESCE(emp.full_name, u.email) as user_name
       FROM employee_task_comment c
       LEFT JOIN auth_user u ON u.id = c.user_id
       LEFT JOIN employees emp ON emp.user_id = u.id
       WHERE c.task_id = ?
       ORDER BY c.created_at ASC`,
      [taskId]
    );
    return rows as EmployeeTaskComment[];
  },

  /**
   * Get overdue tasks
   */
  async getOverdueTasks(): Promise<EmployeeTask[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT et.*, e.employee_code, e.full_name as employee_name
       FROM employee_task et
       JOIN employees e ON e.id = et.employee_id
       WHERE et.status IN ('pending', 'in_progress')
       AND et.due_date < NOW()
       ORDER BY et.due_date ASC`
    );
    return rows as EmployeeTask[];
  },
};
