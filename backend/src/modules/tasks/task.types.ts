export type TaskCategory = 'onboarding' | 'exit' | 'transfer' | 'promotion' | 'lifecycle' | 'adhoc';

export type TaskDepartment = 'it' | 'admin' | 'hr' | 'payroll' | 'wfm' | 'asset' | 'biometric' | 'security' | 'facility' | 'training' | 'qa';

export type TaskStatus = 'pending' | 'in_progress' | 'waiting_approval' | 'completed' | 'cancelled' | 'overdue';

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export type TemplateType = 'onboarding' | 'exit' | 'transfer' | 'promotion' | 'confirmation';

export interface TaskMaster {
  id: string;
  task_code: string;
  task_name: string;
  task_description: string | null;
  category: TaskCategory;
  department: TaskDepartment;
  default_assignee_role: string | null;
  estimated_hours: number;
  sla_hours: number;
  requires_attachment: boolean;
  requires_approval: boolean;
  task_instructions: string | null;
  checklist_items: string[] | null;
  active_status: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskTemplate {
  id: string;
  template_code: string;
  template_name: string;
  template_type: TemplateType;
  description: string | null;
  applies_to: Record<string, any> | null;
  active_status: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskTemplateItem {
  id: string;
  template_id: string;
  task_id: string;
  sequence_order: number;
  dependency_task_ids: string[] | null;
  parallel_group: number | null;
  mandatory: boolean;
  sla_override_hours: number | null;
}

export interface EmployeeTask {
  id: string;
  task_code: string;
  employee_id: string;
  task_name: string;
  task_description: string | null;
  department: string;
  assigned_to_user_id: string | null;
  assigned_to_role: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string;
  started_at: string | null;
  completed_at: string | null;
  completed_by: string | null;
  completion_notes: string | null;
  attachment_url: string | null;
  dependency_task_ids: string[] | null;
  trigger_event: string | null;
  reminder_sent: boolean;
  reminder_sent_at: string | null;
  escalation_sent: boolean;
  escalation_sent_at: string | null;
  template_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmployeeTaskComment {
  id: string;
  task_id: string;
  user_id: string;
  comment_text: string;
  is_system_generated: boolean;
  attachment_url: string | null;
  created_at: string;
}

export interface EmployeeTaskChecklist {
  id: string;
  task_id: string;
  item_text: string;
  is_completed: boolean;
  completed_by: string | null;
  completed_at: string | null;
  sequence_order: number;
}

export interface OnboardingProgress {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  date_of_joining: string | null;
  onboarding_started: string;

  total_tasks: number;
  completed_tasks: number;
  in_progress_tasks: number;
  overdue_tasks: number;
  pending_tasks: number;

  completion_percentage: number;
  estimated_completion_date: string | null;

  department_wise: {
    department: string;
    total: number;
    completed: number;
    pending: number;
    overdue: number;
  }[];

  critical_pending: EmployeeTask[];
}

export interface CreateTasksInput {
  employee_id: string;
  template_code: string;
  trigger_event: string;
  custom_due_date_offset_hours?: number;
}

export interface UpdateTaskInput {
  status?: TaskStatus;
  assigned_to_user_id?: string;
  assigned_to_role?: string;
  priority?: TaskPriority;
  due_date?: string;
  completion_notes?: string;
  attachment_url?: string;
}
