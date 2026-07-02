# Employee Onboarding Multi-Department Task System - Gap Analysis & Design

## Executive Summary

**Current State**: Employee onboarding lacks automated multi-department task workflow. When an employee code is generated, there's no system to automatically create and assign tasks to IT, Admin, Biometric, Payroll, and other departments.

**Impact**: Manual coordination, delays, incomplete onboarding, forgotten tasks, poor employee experience.

**Solution**: Automated task orchestration system with department-specific workflows, SLA tracking, and dependency management.

---

## Current System Analysis

### What EXISTS ✅

1. **Approval Workflow System** ([backend/src/modules/workflow/](backend/src/modules/workflow/))
   - `approval_workflow_master` - Workflow definitions
   - `approval_workflow_step` - Sequential approval steps
   - `approval_request` - Request tracking
   - ⚠️ **Limited to approvals only, not actionable tasks**

2. **Employee Lifecycle Events** ([backend/sql/016_employee_lifecycle.sql](backend/sql/016_employee_lifecycle.sql))
   - Tracks confirmation, promotion, transfer, etc.
   - ⚠️ **No task creation on events**

3. **Helpdesk Tickets** ([backend/sql/016_employee_lifecycle.sql](backend/sql/016_employee_lifecycle.sql))
   - Manual ticket creation by employees
   - Categories: HR, Payroll, IT, Asset
   - ⚠️ **Reactive, not proactive**

4. **ATS Onboarding Bridge** ([backend/sql/054_ats_onboarding_flow.sql](backend/sql/054_ats_onboarding_flow.sql))
   - Candidate → Employee conversion
   - Offer creation and approval
   - ⚠️ **No post-conversion tasks**

5. **Asset Assignment** ([backend/sql/016_employee_lifecycle.sql](backend/sql/016_employee_lifecycle.sql))
   - Asset master and assignment tracking
   - ⚠️ **Manual assignment, no automated workflow**

### What's MISSING ❌

1. **Task Management System** - No table to store actionable tasks
2. **Task Templates** - No predefined task lists for onboarding
3. **Department Assignment** - No automatic routing to IT, Admin, etc.
4. **Task Dependencies** - No way to sequence tasks (e.g., email creation before system access)
5. **SLA Tracking** - No deadlines or escalation
6. **Task Notifications** - No alerts to assigned departments
7. **Progress Dashboard** - No visibility into onboarding completion %
8. **Task Automation Triggers** - No event-driven task creation

---

## Comparison with Industry Best Practices

### What Leading HRMS Systems Have

| Feature | Industry Standard | Current System | Gap |
|---------|------------------|----------------|-----|
| **Automated Task Generation** | Triggered on employee creation | ❌ None | HIGH |
| **Department-Specific Tasks** | IT, Admin, Payroll, Biometric, Asset | ❌ None | HIGH |
| **Task Dependencies** | Sequential/parallel workflows | ❌ None | MEDIUM |
| **SLA & Escalation** | Automated reminders + escalation | ⚠️ Partial (approval only) | HIGH |
| **Progress Tracking** | Real-time dashboard | ❌ None | MEDIUM |
| **Task Templates** | Pre-configured checklists | ❌ None | HIGH |
| **Mobile Task Management** | Mobile app for task completion | ❌ None | LOW |
| **Integration** | Auto-create AD accounts, email, etc. | ❌ None | MEDIUM |
| **Audit Trail** | Complete task history | ⚠️ Partial (lifecycle log) | MEDIUM |
| **Bulk Operations** | Batch onboarding support | ❌ None | LOW |

---

## Proposed Solution Architecture

### 1. Task Management Core

**New Tables Required:**

```sql
-- Master table for all tasks
CREATE TABLE task_master (
  id CHAR(36) PRIMARY KEY,
  task_code VARCHAR(100) UNIQUE NOT NULL,
  task_name VARCHAR(255) NOT NULL,
  task_description TEXT,
  category ENUM('onboarding','exit','transfer','lifecycle','adhoc') NOT NULL,
  department ENUM('it','admin','hr','payroll','wfm','asset','biometric','security','facility') NOT NULL,
  default_assignee_role VARCHAR(50), -- Which role handles this task
  estimated_hours INT DEFAULT 2,
  sla_hours INT DEFAULT 24,
  requires_attachment BOOLEAN DEFAULT FALSE,
  requires_approval BOOLEAN DEFAULT FALSE,
  task_instructions TEXT,
  active_status BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Template: Groups of tasks for different scenarios
CREATE TABLE task_template (
  id CHAR(36) PRIMARY KEY,
  template_code VARCHAR(100) UNIQUE NOT NULL,
  template_name VARCHAR(255) NOT NULL,
  template_type ENUM('onboarding','exit','transfer','promotion') NOT NULL,
  description TEXT,
  active_status BOOLEAN DEFAULT TRUE,
  created_by CHAR(36),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tasks within a template
CREATE TABLE task_template_item (
  id CHAR(36) PRIMARY KEY,
  template_id CHAR(36) NOT NULL,
  task_id CHAR(36) NOT NULL,
  sequence_order INT NOT NULL,
  dependency_task_id CHAR(36), -- Must complete before this
  parallel_group INT, -- Tasks in same group can run parallel
  mandatory BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (template_id) REFERENCES task_template(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES task_master(id),
  FOREIGN KEY (dependency_task_id) REFERENCES task_master(id)
);

-- Actual task instances assigned to employees
CREATE TABLE employee_task (
  id CHAR(36) PRIMARY KEY,
  task_code VARCHAR(100) NOT NULL, -- From task_master
  employee_id CHAR(36) NOT NULL,
  task_name VARCHAR(255) NOT NULL,
  task_description TEXT,
  department VARCHAR(50) NOT NULL,
  assigned_to_user_id CHAR(36), -- Specific user
  assigned_to_role VARCHAR(50), -- Or any user with role
  status ENUM('pending','in_progress','waiting_approval','completed','cancelled','overdue') DEFAULT 'pending',
  priority ENUM('low','medium','high','urgent') DEFAULT 'medium',
  due_date DATETIME NOT NULL,
  started_at DATETIME,
  completed_at DATETIME,
  completed_by CHAR(36),
  completion_notes TEXT,
  attachment_url VARCHAR(500),
  dependency_task_ids JSON, -- Array of task IDs that must complete first
  trigger_event VARCHAR(100), -- What triggered this task
  reminder_sent BOOLEAN DEFAULT FALSE,
  escalation_sent BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_emp_task_emp (employee_id),
  INDEX idx_emp_task_assigned (assigned_to_user_id),
  INDEX idx_emp_task_status (status),
  INDEX idx_emp_task_dept (department),
  INDEX idx_emp_task_due (due_date)
);

-- Task comments/updates
CREATE TABLE employee_task_comment (
  id CHAR(36) PRIMARY KEY,
  task_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  comment_text TEXT NOT NULL,
  is_system_generated BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES employee_task(id) ON DELETE CASCADE,
  INDEX idx_task_comment (task_id)
);

-- Task completion checklist items
CREATE TABLE employee_task_checklist (
  id CHAR(36) PRIMARY KEY,
  task_id CHAR(36) NOT NULL,
  item_text VARCHAR(500) NOT NULL,
  is_completed BOOLEAN DEFAULT FALSE,
  completed_by CHAR(36),
  completed_at DATETIME,
  sequence_order INT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES employee_task(id) ON DELETE CASCADE,
  INDEX idx_task_checklist (task_id)
);
```

---

### 2. Onboarding Task Templates

**Predefined Templates:**

#### Template 1: General Employee Onboarding

| Seq | Task | Department | Assignee Role | SLA | Dependencies |
|-----|------|------------|---------------|-----|--------------|
| 1 | Generate Employee Code | HR | hr_admin | 1 hour | - |
| 2 | Create User Account | IT | it_admin | 4 hours | #1 |
| 3 | Create Corporate Email | IT | it_admin | 4 hours | #2 |
| 4 | Setup Biometric Access | Admin/Biometric | biometric_admin | 8 hours | #1 |
| 5 | Issue Employee ID Card | Admin | admin_staff | 24 hours | #1, #4 |
| 6 | Assign Locker/Workstation | Facility | facility_manager | 12 hours | #4 |
| 7 | Assign IT Assets (Laptop/Desktop) | IT | it_asset_manager | 12 hours | #2 |
| 8 | Setup Payroll Account | Payroll | payroll_admin | 24 hours | #1 |
| 9 | Setup Bank Salary Account | Payroll | payroll_admin | 48 hours | #8 |
| 10 | Add to WFM Roster | WFM | wfm_admin | 12 hours | #1 |
| 11 | Conduct Induction Training | Training | trainer | 48 hours | #5 |
| 12 | Complete Policy Acknowledgment | HR | hr_admin | 72 hours | #11 |
| 13 | Setup Security Access | Security | security_admin | 8 hours | #5 |
| 14 | Assign Reporting Manager | HR | hr_manager | 4 hours | #1 |

#### Template 2: Tech Employee Onboarding (Additional)

| Seq | Task | Department | Assignee Role | SLA | Dependencies |
|-----|------|------------|---------------|-----|--------------|
| 15 | Setup Development Environment | IT | it_admin | 8 hours | #7 |
| 16 | Grant Code Repository Access | IT | it_admin | 4 hours | #3 |
| 17 | Setup VPN Access | IT | it_admin | 4 hours | #3 |
| 18 | Grant Production Access (if applicable) | IT | it_security_admin | 24 hours | #16, Approval Required |

#### Template 3: Process-Specific Onboarding

| Seq | Task | Department | Assignee Role | SLA | Dependencies |
|-----|------|------------|---------------|-----|--------------|
| 19 | Setup Dialer Account | IT | dialer_admin | 8 hours | #2 |
| 20 | Assign Campaign | Process Manager | process_manager | 12 hours | #19 |
| 21 | Configure Quality Monitoring | QA | qa_manager | 24 hours | #19 |

---

### 3. Workflow Automation Logic

**Trigger Events:**

```typescript
// Auto-create tasks when employee is created
async function onEmployeeCreated(employeeId: string, employeeData: any) {
  // Determine template based on employee type, role, process
  const template = await determineOnboardingTemplate(employeeData);
  
  // Create all tasks from template
  const tasks = await createTasksFromTemplate(employeeId, template.id);
  
  // Calculate dependencies and due dates
  await calculateTaskSchedule(tasks);
  
  // Assign to departments/users
  await assignTasks(tasks);
  
  // Send notifications
  await notifyTaskAssignees(tasks);
  
  // Log in journey
  await logEmployeeJourney(employeeId, 'onboarding_tasks_created', tasks.length);
}

// Template selection logic
async function determineOnboardingTemplate(employee: any): Promise<Template> {
  if (employee.designation === 'Software Engineer') {
    return await getTemplate('TECH_EMPLOYEE_ONBOARDING');
  } else if (employee.process_id && employee.emp_type === 'OnRoll') {
    return await getTemplate('PROCESS_EMPLOYEE_ONBOARDING');
  } else {
    return await getTemplate('GENERAL_EMPLOYEE_ONBOARDING');
  }
}
```

---

### 4. Department Dashboard Views

**IT Dashboard:**
- Pending tasks: Email creation, user account setup, asset assignment
- Overdue tasks (red alert)
- Today's tasks
- This week's tasks
- Completed tasks (last 7 days)

**Admin Dashboard:**
- Biometric enrollment pending
- ID card issuance pending
- Locker/workstation assignment
- Security pass creation

**Payroll Dashboard:**
- Bank account setup pending
- Payroll system enrollment
- Salary structure configuration

**Facility Dashboard:**
- Workstation assignment
- Locker allocation
- Access card issuance

---

### 5. Progress Tracking

**Employee Onboarding Progress:**

```typescript
interface OnboardingProgress {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  date_of_joining: string;
  onboarding_started: string;
  
  total_tasks: number;
  completed_tasks: number;
  in_progress_tasks: number;
  overdue_tasks: number;
  pending_tasks: number;
  
  completion_percentage: number;
  estimated_completion_date: string;
  
  department_wise: {
    department: string;
    total: number;
    completed: number;
    pending: number;
    overdue: number;
  }[];
  
  critical_pending: Task[]; // High priority or overdue
}
```

**HR Dashboard View:**
- All onboarding employees (last 30 days)
- Completion % per employee
- Department-wise bottlenecks
- SLA breach alerts
- Average onboarding time

---

### 6. Task Dependency Engine

**Dependency Types:**

1. **Sequential** - Task B starts only after Task A completes
2. **Parallel** - Tasks can run simultaneously
3. **Approval-Gated** - Task requires approval before next step
4. **Conditional** - Task triggered based on employee attributes

**Example Dependency Graph:**

```
Employee Created
    │
    ├─> [1] Generate Employee Code (HR) ─┐
    │                                     │
    └─────────────────────────────────────┘
                      │
                      ├─> [2] Create User Account (IT) ───┐
                      │                                     │
                      ├─> [4] Biometric Enrollment ────────┤
                      │        (Admin) [parallel]           │
                      │                                     │
                      └─────────────────────────────────────┘
                                        │
                                        ├─> [3] Create Email (IT)
                                        │
                                        ├─> [5] Issue ID Card (Admin)
                                        │        [requires: #1, #4]
                                        │
                                        └─> [7] Assign Assets (IT)
                                                 [requires: #2]
```

---

### 7. Notification System

**Real-Time Notifications:**

1. **Task Assigned** - Notify assignee immediately
2. **Task Due Soon** - 24 hours before due date
3. **Task Overdue** - Daily reminder
4. **Task Escalation** - Notify manager after 48 hours overdue
5. **Task Completed** - Notify employee and dependent task assignees
6. **Milestone Reached** - Notify HR (e.g., 50% complete)

**Notification Channels:**
- In-app notifications (bell icon)
- Email (configurable)
- WhatsApp (for urgent/overdue)
- SMS (optional)

---

### 8. API Endpoints Required

```typescript
// Task Management APIs
POST   /api/tasks/employee/:employeeId/create-onboarding     // Create tasks from template
GET    /api/tasks/employee/:employeeId                       // Get all tasks for employee
GET    /api/tasks/employee/:employeeId/progress              // Onboarding progress
GET    /api/tasks/department/:dept                           // Tasks for department
GET    /api/tasks/my-tasks                                   // Tasks assigned to me
PUT    /api/tasks/:taskId/start                              // Start task
PUT    /api/tasks/:taskId/complete                           // Mark complete
PUT    /api/tasks/:taskId/update                             // Update status/notes
POST   /api/tasks/:taskId/comment                            // Add comment
POST   /api/tasks/:taskId/attachment                         // Upload attachment

// Template Management APIs
GET    /api/task-templates                                   // List templates
POST   /api/task-templates                                   // Create template
GET    /api/task-templates/:id                               // Get template details
PUT    /api/task-templates/:id                               // Update template
POST   /api/task-templates/:id/clone                         // Clone template

// Dashboard APIs
GET    /api/tasks/dashboard/hr                               // HR onboarding dashboard
GET    /api/tasks/dashboard/department/:dept                 // Department dashboard
GET    /api/tasks/dashboard/my-department                    // My department tasks
GET    /api/tasks/analytics/sla-compliance                   // SLA metrics
GET    /api/tasks/analytics/bottlenecks                      // Identify bottlenecks

// Admin APIs
POST   /api/tasks/master                                     // Create master task
GET    /api/tasks/overdue                                    // All overdue tasks
POST   /api/tasks/bulk-reassign                              // Bulk reassign
POST   /api/tasks/escalate/:taskId                           // Manual escalation
```

---

### 9. Frontend Components Required

**New Pages:**

1. **Employee Onboarding Progress Page** (`/onboarding/:employeeId`)
   - Timeline view of all tasks
   - Completion progress bar
   - Department-wise breakdown
   - Critical pending tasks

2. **Department Task Dashboard** (`/tasks/department`)
   - Kanban board (Pending, In Progress, Completed)
   - Filter by employee, priority, due date
   - Bulk actions

3. **My Tasks Page** (`/tasks/my-tasks`)
   - Personal task list
   - Quick complete actions
   - Comments and attachments

4. **HR Onboarding Dashboard** (`/hr/onboarding-dashboard`)
   - All active onboarding (last 30 days)
   - Completion metrics
   - SLA breach alerts
   - Department performance

5. **Task Template Manager** (`/admin/task-templates`)
   - Create/edit templates
   - Drag-drop task ordering
   - Dependency configuration

**New Components:**

- `TaskCard` - Individual task display
- `TaskTimeline` - Visual timeline of onboarding
- `DepartmentTaskBoard` - Kanban board
- `TaskProgressBar` - Completion % widget
- `TaskDependencyGraph` - Visual dependency tree
- `TaskCommentThread` - Comments/updates
- `TaskAssignmentPicker` - Select assignee

---

### 10. Integration Points

**Existing Systems:**

1. **Employee Creation** → Trigger task creation
2. **ATS Onboarding Bridge** → Create tasks after offer acceptance
3. **Employee Lifecycle Events** → Create tasks on transfer/promotion
4. **Asset Management** → Mark asset task complete when assigned
5. **Helpdesk** → Convert tasks to tickets if blocked
6. **Notifications** → Unified notification system

**External Systems (Future):**

1. **Active Directory** - Auto-create AD account (IT task)
2. **Email Server** - Auto-create email (IT task)
3. **Biometric Device API** - Auto-enroll fingerprint
4. **Dialer API** - Auto-create dialer user
5. **Payroll System** - Auto-sync employee to payroll

---

### 11. Reporting & Analytics

**Key Metrics:**

1. **Average Onboarding Time** - Days from employee creation to 100% completion
2. **SLA Compliance %** - Tasks completed within SLA
3. **Department Performance** - Avg completion time per department
4. **Bottleneck Analysis** - Tasks with highest delays
5. **Task Completion Rate** - % of tasks completed on time
6. **Employee Ready %** - % of employees 100% onboarded
7. **Overdue Tasks Trend** - Weekly overdue count

**Reports:**

- Weekly Onboarding Summary (to HR)
- Department Performance Report (to HODs)
- SLA Breach Report (to Management)
- Pending Tasks Report (to Task Owners)

---

### 12. Implementation Phases

**Phase 1: Foundation (Week 1-2)**
- Create database tables
- Build task master data
- Create 3 basic templates (General, Tech, Process)
- Basic API endpoints (create, get, update)

**Phase 2: Core Workflow (Week 3-4)**
- Dependency engine
- Auto-task creation on employee creation
- Department dashboard (IT, Admin, HR, Payroll)
- Task status updates

**Phase 3: Notifications (Week 5)**
- In-app notifications
- Email notifications
- SLA tracking and alerts
- Escalation engine

**Phase 4: Frontend (Week 6-7)**
- Employee onboarding progress page
- Department task dashboards
- My Tasks page
- HR onboarding dashboard

**Phase 5: Advanced (Week 8+)**
- Template builder UI
- Bulk operations
- Analytics dashboard
- Mobile app support
- External system integration

---

### 13. Risk Mitigation

**Potential Issues:**

1. **Task Overload** - Too many tasks slow down departments
   - *Solution*: Configurable SLAs, parallel execution, bulk actions

2. **Dependency Deadlock** - Circular dependencies block progress
   - *Solution*: Dependency validation at template creation

3. **Task Orphaning** - Assignee leaves, task stuck
   - *Solution*: Auto-reassign to role, escalation to manager

4. **SLA Impossible** - Unrealistic deadlines
   - *Solution*: SLA analysis and adjustment, buffer time

5. **Notification Fatigue** - Too many alerts
   - *Solution*: Digest emails, configurable preferences

---

## Summary of Gaps

| Category | Current State | Desired State | Priority |
|----------|--------------|---------------|----------|
| **Task Management** | ❌ None | Automated multi-dept tasks | P0 |
| **Task Templates** | ❌ None | Pre-configured checklists | P0 |
| **Dependency Engine** | ❌ None | Sequential/parallel workflows | P1 |
| **Dept Dashboards** | ❌ None | IT, Admin, Payroll views | P0 |
| **SLA Tracking** | ⚠️ Approval only | All tasks + escalation | P0 |
| **Progress Tracking** | ❌ None | Real-time % completion | P1 |
| **Notifications** | ⚠️ Basic | SLA, overdue, escalation | P0 |
| **Analytics** | ❌ None | Onboarding metrics | P2 |
| **Mobile Support** | ❌ None | Mobile task completion | P3 |
| **External Integration** | ❌ None | AD, Email, Biometric | P2 |

---

## Next Steps

1. **Approve Design** - Review and finalize architecture
2. **Create Database Migration** - SQL scripts for new tables
3. **Build Backend APIs** - Task CRUD + workflow engine
4. **Create Task Master Data** - Define 50+ standard tasks
5. **Build 3 Templates** - General, Tech, Process onboarding
6. **Integrate with Employee Creation** - Auto-trigger tasks
7. **Build Department Dashboards** - IT, Admin, Payroll, HR
8. **Implement Notifications** - SLA alerts and escalations
9. **Test End-to-End** - Create test employee, verify all tasks
10. **Train Users** - Department-wise training sessions

---

**Estimated Effort**: 6-8 weeks (1 backend dev + 1 frontend dev)  
**Business Impact**: 70% faster onboarding, 95% task completion rate, better employee experience  
**ROI**: 15-20 hours saved per employee onboarding (HR + departments)

---

**Status**: 📋 **Design Complete - Awaiting Approval for Implementation**
