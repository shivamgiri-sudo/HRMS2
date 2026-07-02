# Performance Feedback System Design

> **Project:** MAS-CallNet HRMS  
> **Date:** 2026-05-31  
> **Type:** New Module - Manager-Led Performance Feedback  
> **Integration:** Links to KPI system, appraisal cycles, development planning, LMS

---

## Overview

### What This Builds

A manager-led performance feedback system where direct managers evaluate subordinates on competencies and KPIs. Results feed into development planning and training needs identification.

**NOT a 360-degree feedback system.** No peer, upward, or self-ratings. Manager-only evaluation model.

### Business Value

- Structured performance evaluation beyond quantitative KPIs
- Competency-based assessment (soft skills, leadership, behaviors)
- Automated development planning from feedback results
- Historical trend tracking across feedback cycles
- Integration with existing performance management infrastructure

---

## System Architecture

### Module Structure

```
backend/src/modules/performance-feedback/
├── performance-feedback.types.ts       # TypeScript interfaces
├── performance-feedback.validation.ts  # Zod schemas
├── performance-feedback.service.ts     # Business logic
├── performance-feedback.controller.ts  # Request handlers
├── performance-feedback.routes.ts      # API endpoints
└── report.generator.ts                 # Report aggregation logic
```

### Database Schema

**7 New Tables:**

#### 1. performance_feedback_cycle

Defines feedback collection periods.

```sql
CREATE TABLE performance_feedback_cycle (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  cycle_name          VARCHAR(128) NOT NULL,
  period              VARCHAR(9)   NOT NULL COMMENT 'Format: YYYY-MM or YYYY-Q1',
  start_date          DATE         NOT NULL,
  end_date            DATE         NOT NULL,
  deadline            DATE         NOT NULL COMMENT 'Manager submission deadline',
  appraisal_cycle_id  CHAR(36)     NULL COMMENT 'Optional link to appraisal cycle',
  status              ENUM('draft','active','closed') NOT NULL DEFAULT 'draft',
  created_by          CHAR(36)     NOT NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_cycle_period (period),
  INDEX idx_cycle_status (status),
  FOREIGN KEY (appraisal_cycle_id) REFERENCES appraisal_cycle(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES employees(id)
);
```

#### 2. performance_feedback_request

Tracks individual feedback requests (one per employee per cycle).

```sql
CREATE TABLE performance_feedback_request (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  cycle_id        CHAR(36)     NOT NULL,
  employee_id     CHAR(36)     NOT NULL,
  manager_id      CHAR(36)     NOT NULL COMMENT 'Cached from employees.reporting_to',
  status          ENUM('pending','submitted','completed') NOT NULL DEFAULT 'pending',
  invited_at      DATETIME,
  submitted_at    DATETIME,
  report_generated_at DATETIME,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE KEY uq_cycle_employee (cycle_id, employee_id),
  INDEX idx_request_manager (manager_id),
  INDEX idx_request_status (status),
  FOREIGN KEY (cycle_id) REFERENCES performance_feedback_cycle(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (manager_id) REFERENCES employees(id) ON DELETE CASCADE
);
```

#### 3. competency_master

Reusable competency definitions.

```sql
CREATE TABLE competency_master (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  competency_name     VARCHAR(128) NOT NULL UNIQUE,
  description         TEXT,
  category            ENUM('soft_skills','technical','leadership','behavioral','customer_focus') NOT NULL,
  display_order       INT          NOT NULL DEFAULT 0,
  is_active           TINYINT(1)   NOT NULL DEFAULT 1,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_comp_active (is_active),
  INDEX idx_comp_category (category)
);
```

**Seed Competencies:**
```sql
INSERT INTO competency_master (competency_name, description, category, display_order) VALUES
('Communication Skills', 'Clarity in written and verbal communication, active listening', 'soft_skills', 1),
('Teamwork & Collaboration', 'Works effectively with others, shares knowledge, supports team goals', 'soft_skills', 2),
('Problem Solving', 'Identifies issues, proposes solutions, implements fixes', 'technical', 3),
('Accountability', 'Takes ownership, meets commitments, follows through', 'behavioral', 4),
('Adaptability', 'Handles change well, learns new skills, adjusts to challenges', 'behavioral', 5),
('Leadership', 'Inspires others, delegates effectively, drives results', 'leadership', 6),
('Time Management', 'Prioritizes tasks, meets deadlines, manages workload', 'soft_skills', 7),
('Customer Focus', 'Understands customer needs, delivers quality service', 'customer_focus', 8),
('Technical Skills', 'Proficiency in job-specific tools, systems, processes', 'technical', 9),
('Initiative', 'Proactively identifies opportunities, takes action without prompting', 'behavioral', 10);
```

#### 4. performance_feedback_response

Manager's submitted feedback (ratings + comments).

```sql
CREATE TABLE performance_feedback_response (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  request_id          CHAR(36)     NOT NULL UNIQUE COMMENT 'One response per request',
  manager_id          CHAR(36)     NOT NULL,
  ratings_json        JSON         NOT NULL COMMENT 'Competency + KPI ratings with comments',
  overall_strengths   TEXT         COMMENT 'Open text: key strengths',
  development_areas   TEXT         COMMENT 'Open text: areas for improvement',
  submitted_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_response_manager (manager_id),
  FOREIGN KEY (request_id) REFERENCES performance_feedback_request(id) ON DELETE CASCADE,
  FOREIGN KEY (manager_id) REFERENCES employees(id) ON DELETE CASCADE
);
```

**ratings_json structure:**
```json
{
  "competencies": [
    {
      "competency_id": "uuid-1",
      "rating": 4,
      "comment": "Strong communication in meetings, clear documentation."
    }
  ],
  "kpis": [
    {
      "metric_id": "uuid-kpi-1",
      "rating": 5,
      "comment": "Consistently exceeds AHT target."
    }
  ]
}
```

#### 5. performance_feedback_report

Aggregated results and scores.

```sql
CREATE TABLE performance_feedback_report (
  id                      CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  request_id              CHAR(36)     NOT NULL UNIQUE,
  overall_score           DECIMAL(3,2) NOT NULL COMMENT 'Average of all ratings',
  competency_scores_json  JSON         NOT NULL COMMENT 'Per-competency scores',
  kpi_scores_json         JSON         COMMENT 'Per-KPI scores (if applicable)',
  generated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  regenerated_count       INT          NOT NULL DEFAULT 0,
  
  INDEX idx_report_score (overall_score),
  FOREIGN KEY (request_id) REFERENCES performance_feedback_request(id) ON DELETE CASCADE
);
```

#### 6. development_plan

Post-feedback action plans.

```sql
CREATE TABLE development_plan (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)     NOT NULL,
  report_id       CHAR(36)     NULL COMMENT 'Links to feedback report (optional)',
  created_by      CHAR(36)     NOT NULL COMMENT 'Manager who created plan',
  plan_json       JSON         NOT NULL COMMENT 'Goals, timeline, focus areas',
  status          ENUM('draft','active','completed','cancelled') NOT NULL DEFAULT 'active',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_devplan_employee (employee_id),
  INDEX idx_devplan_report (report_id),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (report_id) REFERENCES performance_feedback_report(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES employees(id)
);
```

**plan_json structure:**
```json
{
  "focus_areas": ["Communication", "Time Management"],
  "timeline": "Q3 2026",
  "review_date": "2026-09-30"
}
```

#### 7. development_plan_goal

Individual goals within development plan.

```sql
CREATE TABLE development_plan_goal (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  plan_id             CHAR(36)     NOT NULL,
  competency_id       CHAR(36)     NULL COMMENT 'Links to low-scoring competency',
  goal_description    TEXT         NOT NULL,
  target_date         DATE         NOT NULL,
  status              ENUM('not_started','in_progress','completed','blocked') NOT NULL DEFAULT 'not_started',
  progress_notes      TEXT,
  completed_at        DATETIME,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_goal_plan (plan_id),
  INDEX idx_goal_status (status),
  FOREIGN KEY (plan_id) REFERENCES development_plan(id) ON DELETE CASCADE,
  FOREIGN KEY (competency_id) REFERENCES competency_master(id) ON DELETE SET NULL
);
```

### Integration Points

**Existing Tables:**
- `employees` ← FK from all employee/manager references
- `appraisal_cycle` ← optional link from performance_feedback_cycle
- `kpi_metric_master` ← referenced in response.ratings_json
- `kpi_assignment` ← used to fetch employee's assigned KPIs
- `training_need` ← auto-created from low-scoring competencies (<3.0)

---

## Workflow

### Phase 1: Cycle Setup (HR)

**Actors:** HR role

**Steps:**
1. HR creates `performance_feedback_cycle` (name, dates, deadline)
2. Optionally links to existing `appraisal_cycle_id`
3. Selects employees (bulk or individual)
4. For each employee:
   - System fetches `reporting_to` from `employees` table
   - If no manager → skip employee (log warning)
   - Creates `performance_feedback_request` (employee_id, manager_id)
5. HR launches cycle (status → active)
6. System sends email notifications to managers

**Edge Cases:**
- Employee has no manager → skip, log error
- Manager has 20+ direct reports → batch notifications, allow phased submission

---

### Phase 2: Feedback Submission (Manager)

**Actors:** Manager roles (manager, process_manager, assistant_manager, team_leader)

**Steps:**
1. Manager logs in, sees pending assignments (`/my-assignments`)
2. Clicks on employee → opens feedback form
3. Form loads:
   - **Section 1: Competencies** (all active competencies from `competency_master`)
   - **Section 2: KPIs** (conditional: shows if employee has `kpi_assignment` for current period)
   - Each item: 1-5 rating slider + optional comment textarea
   - **Section 3: Open Questions**
     - Overall strengths (text)
     - Primary development areas (text)
4. Manager can save draft (store in session/local storage, NOT database)
5. Manager submits final → creates `performance_feedback_response`
6. Request status → `submitted`
7. Triggers report generation (Phase 3)

**Validation:**
- All competencies must have rating (1-5)
- All KPIs must have rating (if section visible)
- Comments optional
- Open questions optional (but recommended)

**Edge Cases:**
- Late submission (after deadline) → allowed, flags as "late"
- Manager tries to rate non-direct report → blocked by RBAC
- Employee exits mid-cycle → manager can still submit

---

### Phase 3: Report Generation (Auto)

**Trigger:** On `performance_feedback_response` submission

**Process:**
1. Fetch response `ratings_json`
2. Calculate `overall_score`:
   ```
   overall_score = (sum of all competency ratings + sum of all KPI ratings) / total count
   ```
3. Generate `competency_scores_json`:
   ```json
   [
     {"competency_id": "uuid-1", "competency_name": "Communication", "score": 4},
     {"competency_id": "uuid-2", "competency_name": "Teamwork", "score": 3}
   ]
   ```
4. Generate `kpi_scores_json` (if applicable)
5. Create `performance_feedback_report`
6. Update request:
   - `report_generated_at` → now
   - `status` → `completed`
7. Send notification to employee + manager (report ready)

**Edge Cases:**
- Regenerate report if manager updates response → increment `regenerated_count`
- No KPIs → `kpi_scores_json` = null

---

### Phase 4: Development Planning (Manager + Employee)

**Actors:** Manager (creates), Employee (views)

**Steps:**
1. Manager reviews report with employee (1-on-1 meeting)
2. Manager creates `development_plan`:
   - Links to `report_id`
   - Sets `focus_areas` (typically 2-3 low-scoring competencies)
   - Sets `timeline` (e.g., "Q3 2026")
3. Manager creates 3-5 `development_plan_goal` records:
   - Links to `competency_id` (if targeting specific competency)
   - Sets goal description, target date
4. System auto-creates `training_need` records for competencies scored <3.0:
   - `employee_id`, `metric_id` = null, `need_type` = "soft_skills"
   - `description` = "Low score on {competency_name}: {manager_comment}"
   - `priority` = "high" if score <2.0, else "medium"
   - `status` = "identified"
5. Training needs surface in TNI dashboard for LMS mapping

**Edge Cases:**
- Manager can create development plan without feedback report (ad-hoc planning)
- Employee can view plan, cannot edit (manager-owned)

---

### Phase 5: Progress Tracking

**Ongoing Process:**

1. Manager updates `development_plan_goal.status`:
   - `not_started` → `in_progress` → `completed`
2. Manager adds `progress_notes` over time
3. Next feedback cycle references previous report:
   - Display trend: "Communication: 3.5 → 4.0 (↑ +0.5)"
   - Highlight persistent low scores (red flag)

---

## API Endpoints

### Cycle Management (HR)

```typescript
POST   /api/performance-feedback/cycles
Body: {
  cycle_name: string,
  period: string,         // "2026-Q2"
  start_date: string,
  end_date: string,
  deadline: string,
  appraisal_cycle_id?: string
}
Response: { id: string, status: "draft" }

GET    /api/performance-feedback/cycles
Query: ?status=active&period=2026-Q2
Response: Cycle[]

GET    /api/performance-feedback/cycles/:id
Response: Cycle & { requests: Request[], completion_pct: number }

PATCH  /api/performance-feedback/cycles/:id
Body: { cycle_name?, start_date?, end_date?, deadline? }

POST   /api/performance-feedback/cycles/:id/launch
Body: { employee_ids: string[] }
Response: { created_count: number, skipped: string[] }

POST   /api/performance-feedback/cycles/:id/close
Response: { status: "closed", final_completion_pct: number }
```

### Request Management (HR)

```typescript
POST   /api/performance-feedback/requests
Body: { cycle_id: string, employee_id: string }
Response: Request

GET    /api/performance-feedback/requests
Query: ?cycle_id=uuid&status=pending&manager_id=uuid
Response: Request[]

GET    /api/performance-feedback/requests/:id
Response: Request & { employee: Employee, manager: Employee }

POST   /api/performance-feedback/requests/:id/remind
Response: { email_sent: boolean }

DELETE /api/performance-feedback/requests/:id
Response: { deleted: true }
```

### Feedback Submission (Manager)

```typescript
GET    /api/performance-feedback/my-assignments
Response: Request[] // Only requests where manager_id = logged-in user

GET    /api/performance-feedback/form/:requestId
Response: {
  request: Request,
  employee: Employee,
  competencies: Competency[],
  kpis: KpiMetric[] // Empty if no kpi_assignment
}

POST   /api/performance-feedback/responses
Body: {
  request_id: string,
  ratings_json: {
    competencies: Array<{ competency_id: string, rating: 1-5, comment?: string }>,
    kpis: Array<{ metric_id: string, rating: 1-5, comment?: string }>
  },
  overall_strengths?: string,
  development_areas?: string
}
Response: { id: string, report_id: string }

PATCH  /api/performance-feedback/responses/:id
Body: { ratings_json?, overall_strengths?, development_areas? }
Response: Response
```

### Competency Management (HR/Admin)

```typescript
GET    /api/performance-feedback/competencies
Query: ?is_active=1&category=soft_skills
Response: Competency[]

POST   /api/performance-feedback/competencies
Body: { competency_name: string, description?: string, category: string }
Response: Competency

PATCH  /api/performance-feedback/competencies/:id
Body: { competency_name?, description?, display_order?, is_active? }

DELETE /api/performance-feedback/competencies/:id
// Soft delete: is_active = 0
Response: { deactivated: true }
```

### Reports (Employee/Manager/HR)

```typescript
GET    /api/performance-feedback/reports/:requestId
Response: Report & {
  employee: Employee,
  manager: Employee,
  response: Response,
  previous_reports?: Report[] // For trend comparison
}

GET    /api/performance-feedback/my-reports
// Returns reports where employee_id = logged-in user
Response: Report[]

GET    /api/performance-feedback/team-reports
// Returns reports where manager_id = logged-in user
Response: Report[]

POST   /api/performance-feedback/reports/:requestId/regenerate
Response: Report
```

### Development Plans (Manager/Employee)

```typescript
POST   /api/performance-feedback/development-plans
Body: {
  employee_id: string,
  report_id?: string,
  plan_json: { focus_areas: string[], timeline: string, review_date: string },
  goals: Array<{
    competency_id?: string,
    goal_description: string,
    target_date: string
  }>
}
Response: { plan_id: string, goals: Goal[] }

GET    /api/performance-feedback/development-plans
Query: ?employee_id=uuid&status=active
Response: DevelopmentPlan[]

PATCH  /api/performance-feedback/development-plans/:id
Body: { plan_json?, status? }

PATCH  /api/performance-feedback/development-plans/:id/goals/:goalId
Body: { status?: string, progress_notes?: string }
Response: Goal
```

---

## Frontend Pages

### 1. NativePerformanceFeedbackCycles.tsx (HR)

**Route:** `/performance-feedback/cycles`

**Features:**
- Table: all cycles (name, period, dates, status, employee count, completion %)
- Actions:
  - Create cycle button → modal
  - Launch button (status = draft)
  - Close button (status = active)
  - View details → navigate to cycle detail page
- Filters: status dropdown, period search

**Columns:**
- Cycle Name | Period | Start Date | Deadline | Status | Employees | Completion % | Actions

**Create Cycle Modal:**
- Inputs: cycle_name, period, start_date, end_date, deadline
- Checkbox: Link to appraisal cycle (dropdown if checked)
- Submit → POST /cycles → refresh table

---

### 2. NativePerformanceFeedbackCycleDetail.tsx (HR)

**Route:** `/performance-feedback/cycles/:id`

**Features:**
- Cycle info card (name, dates, linked appraisal, status badge)
- Progress section:
  - Completion chart (donut: submitted/pending)
  - Response rate timeline (line chart: submissions per day)
- Requests table:
  - Employee Name | Manager Name | Status | Invited At | Submitted At | Actions
- Bulk actions:
  - Add employees (multi-select dropdown + add button)
  - Send reminders (checkbox select + remind button)
  - Remove requests (checkbox select + remove button)
- Export button (CSV: all requests with status)

**Actions per row:**
- View report (if status = completed)
- Send reminder (if status = pending)
- Remove (delete request)

---

### 3. NativePerformanceFeedbackAssignments.tsx (Manager)

**Route:** `/performance-feedback/my-assignments`

**Features:**
- Grid: pending feedback requests (cards per employee)
- Each card:
  - Employee photo + name
  - Designation
  - Cycle name + deadline (with countdown timer if <7 days)
  - Status badge (pending/draft/submitted)
  - "Start Feedback" button → navigate to form
- Tabs:
  - Pending (not submitted)
  - Submitted (can view/edit)
- Sort: by deadline (ascending)

---

### 4. NativePerformanceFeedbackForm.tsx (Manager)

**Route:** `/performance-feedback/form/:requestId`

**Features:**
- Header:
  - Employee info (name, designation, photo)
  - Cycle name + deadline
- **Section 1: Competencies**
  - List all active competencies
  - Each row:
    - Competency name + description tooltip
    - Rating slider (1-5 with labels: Poor/Below/Meets/Exceeds/Outstanding)
    - Comment textarea (optional)
- **Section 2: KPIs** (conditional: show if employee has kpi_assignment)
  - List employee's assigned KPIs
  - Each row:
    - KPI name + target value + actual value (if available from kpi_score table)
    - Rating slider (1-5)
    - Comment textarea (optional)
- **Section 3: Overall Assessment**
  - Strengths textarea (What are this employee's key strengths?)
  - Development areas textarea (What areas need improvement?)
- Actions:
  - Save draft (local storage, can resume later)
  - Submit final (validates all ratings, creates response)
- Progress indicator: "8 of 12 items rated"

**Validation:**
- All competencies must have rating
- All KPIs must have rating (if section visible)
- Comments optional
- Shows error toast if incomplete on submit

---

### 5. NativePerformanceFeedbackTeamReports.tsx (Manager)

**Route:** `/performance-feedback/team-reports`

**Features:**
- Grid: team members with completed feedback
- Each card:
  - Employee photo + name
  - Overall score (large badge with color: <3.0 red, 3.0-3.9 yellow, 4.0+ green)
  - Trend indicator (vs previous cycle: ↑/↓/→)
  - Top competency (highest score) + lowest competency (lowest score)
  - "View Report" button
- Filters:
  - Cycle dropdown (default: latest)
  - Score range slider
- Export button (CSV: team summary with scores)

---

### 6. NativePerformanceFeedbackMyReports.tsx (Employee)

**Route:** `/performance-feedback/my-reports`

**Features:**
- Timeline view: all past feedback reports (vertical timeline)
- Each entry:
  - Cycle name + period
  - Overall score (badge)
  - Trend vs previous (if exists)
  - Manager name
  - Generated date
  - "View Details" button
- Empty state: "No feedback reports yet"

---

### 7. NativePerformanceFeedbackReportDetail.tsx (Employee/Manager)

**Route:** `/performance-feedback/reports/:requestId`

**Features:**
- Header:
  - Employee info (name, designation, photo)
  - Cycle name + period
  - Overall score (large colored badge)
  - Manager name (attributed)
- **Section 1: Competency Scores**
  - Table:
    - Competency | Score | Manager Comment | Trend (if previous cycle exists)
  - Sort: by score (ascending, shows weaknesses first)
  - Color coding: <3.0 red, 3.0-3.9 yellow, 4.0+ green
- **Section 2: KPI Scores** (if applicable)
  - Table: KPI | Score | Manager Comment
- **Section 3: Overall Assessment**
  - Strengths (manager's text, displayed in card)
  - Development areas (manager's text, displayed in card)
- **Section 4: Trend Analysis** (if previous reports exist)
  - Line chart: overall score over time
  - Bar chart: per-competency trends (side-by-side bars for current vs previous)
- **Section 5: Development Plan** (if exists)
  - Link to development plan page
  - Summary: X goals, Y completed
- Actions:
  - Download PDF (generate report PDF)
  - Create/View Development Plan (manager only)

---

### 8. NativePerformanceFeedbackDevelopmentPlan.tsx (Manager/Employee)

**Route:** `/performance-feedback/development-plans/:id`

**Features:**
- Header:
  - Employee info
  - Linked feedback report (if exists) + overall score
  - Timeline (e.g., "Q3 2026")
  - Status badge (draft/active/completed)
- **Focus Areas Card:**
  - List of target competencies (from plan_json.focus_areas)
  - Shows competency score from linked report
- **Goals Section:**
  - List of goals (accordion)
  - Each goal:
    - Goal description
    - Target date
    - Status (not_started/in_progress/completed/blocked)
    - Progress notes (textarea, manager can edit)
    - Update status button (manager only)
- Actions:
  - Add goal (manager only)
  - Mark plan complete (manager only)
  - Download plan (PDF)

**Edit Mode (Manager):**
- Can add new goals
- Can update goal status + notes
- Can mark plan complete

**View Mode (Employee):**
- Read-only view
- Can see all goals + progress

---

## Shared Components

### RatingSlider.tsx

**Props:** `value: 1-5, onChange, disabled`

**Renders:**
- Horizontal slider (1-5)
- Labels below: Poor | Below Expectations | Meets Expectations | Exceeds Expectations | Outstanding
- Color gradient: red (1) → yellow (3) → green (5)

---

### CompetencyScoreCard.tsx

**Props:** `competency: Competency, score: number, comment?: string, trend?: number`

**Renders:**
- Card with:
  - Competency name (bold)
  - Description (small text)
  - Score badge (colored by value)
  - Trend indicator (↑ +0.5 green, ↓ -0.3 red)
  - Manager comment (if exists)

---

### TrendChart.tsx

**Props:** `data: Array<{ period: string, score: number }>`

**Renders:**
- Line chart showing score trend over time
- X-axis: periods (e.g., "2025-Q4", "2026-Q1")
- Y-axis: score (0-5)
- Uses recharts library

---

### FeedbackProgressBar.tsx

**Props:** `submitted: number, total: number`

**Renders:**
- Progress bar: "{submitted}/{total} responses"
- Color: red (<50%), yellow (50-89%), green (90%+)
- Shows percentage

---

### DevelopmentGoalItem.tsx

**Props:** `goal: Goal, editable: boolean, onUpdate`

**Renders:**
- Accordion item:
  - Header: goal description + status badge + target date
  - Body:
    - Progress notes textarea (editable if manager)
    - Update status button (manager only)
    - Completed date (if status = completed)

---

## Navigation

Add "Performance Feedback" section to sidebar (under Performance module):

```
📊 Performance
  ├── Goals & KPIs
  ├── Coaching
  ├── 🆕 Performance Feedback
  │   ├── Cycles (HR only)
  │   ├── My Assignments (managers)
  │   ├── My Feedback (employees)
  │   ├── Team Feedback (managers)
  │   └── Development Plans (all)
```

---

## Role-Based Access Control

### HR Role
- Create/edit/close cycles
- Add/remove employees from cycles
- View all reports
- Manage competencies
- Analytics dashboard

### Manager Roles (manager, process_manager, assistant_manager, team_leader)
- Submit feedback for direct reports
- View team reports
- Create/edit development plans for team
- Cannot view other managers' team reports

### Employee Role
- View own feedback reports
- View own development plans
- Cannot submit feedback (manager-only)

### Admin Role
- Read-only oversight (view cycles/reports)
- Cannot create cycles (HR-only)

**Enforcement:**
- `requireAuth` middleware on all routes
- `requireRole(['hr'])` on cycle creation/management
- Row-level checks:
  - Manager can only submit for `employees.reporting_to = manager_id`
  - Employee can only view own reports (`employee_id = user_id`)

---

## Error Handling

### Edge Cases

**1. Employee has no manager**
- Cycle launch skips employee, logs warning
- HR notified via email: "X employees skipped (no manager assigned)"

**2. Manager exits/transferred mid-cycle**
- Request stays assigned to original manager
- If new manager assigned: HR can reassign request manually
- Old manager can still complete (grace period)

**3. Employee exits mid-cycle**
- Request not deleted (can complete)
- Report flags: "Employee exited on {date}"
- Development plan creation blocked

**4. Competency deactivated**
- Archived ratings still visible in reports
- Hidden from new feedback forms
- Historical reports show "(archived)" label

**5. Late submission**
- Allowed after deadline
- Report flags "Late submission" badge
- Manager receives warning email pre-deadline

**6. No KPIs assigned**
- KPI section hidden in form
- Overall score calculated from competencies only
- Report shows "No KPI data" message

**7. Concurrent feedback cycles**
- Employee can be in multiple active cycles (different periods)
- Reports clearly show cycle name + period
- Development plans can reference any report

**8. Manager tries to rate non-direct report**
- API returns 403 Forbidden
- Frontend hides requests for non-reports

**9. Report regeneration**
- Manager updates response after report generated
- System regenerates report, increments `regenerated_count`
- Employee/manager notified of update

**10. Development plan without feedback**
- Manager can create ad-hoc development plan (no report_id link)
- System allows it (feedback not mandatory for planning)

---

## Integration Logic

### With KPI System

**Fetching Employee KPIs:**
```sql
-- Get employee's assigned KPIs for feedback form
SELECT 
  kmm.id AS metric_id,
  kmm.metric_code,
  kmm.metric_name,
  kmm.unit,
  ktm.target_value,
  ks.actual_value
FROM kpi_assignment ka
JOIN kpi_template kt ON ka.template_id = kt.id
JOIN kpi_template_metric ktm ON kt.id = ktm.template_id
JOIN kpi_metric_master kmm ON ktm.metric_id = kmm.id
LEFT JOIN kpi_score ks ON ks.employee_id = :employeeId 
  AND ks.metric_id = kmm.id 
  AND ks.period = :currentPeriod
WHERE ka.employee_id = :employeeId 
  AND ka.active_status = 1
  AND kmm.active_status = 1;
```

**Including KPIs in Report:**
- KPI ratings stored in `response.ratings_json.kpis`
- Report aggregates KPI scores separately from competencies
- Overall score = (competency avg + KPI avg) / 2

---

### With Appraisal System

**Optional Link:**
- `performance_feedback_cycle.appraisal_cycle_id` can link to `appraisal_cycle.id`
- When linked:
  - Feedback report influences `appraisal_rating.manager_rating`
  - Manager can reference feedback in `appraisal_rating.manager_comments`
- When not linked:
  - Feedback runs independently (ad-hoc, mid-year check-ins)

**Use Case:**
- Annual appraisal uses feedback report as input
- Quarterly feedback cycles run independently

---

### With Training Needs (LMS)

**Auto-create Training Needs:**
```typescript
// After report generation, for each competency scored <3.0
async function createTrainingNeeds(reportId: string) {
  const report = await getReport(reportId);
  const request = await getRequest(report.request_id);
  const response = await getResponse(request.id);
  
  const lowScores = report.competency_scores_json
    .filter(c => c.score < 3.0);
  
  for (const comp of lowScores) {
    await createTrainingNeed({
      employee_id: request.employee_id,
      metric_id: null, // Not KPI-related
      coaching_session_id: null,
      need_type: mapCompetencyToNeedType(comp.competency_id),
      description: `Low score on ${comp.competency_name} (${comp.score}/5): ${response.manager_comment}`,
      priority: comp.score < 2.0 ? 'critical' : 'high',
      status: 'identified',
      identified_by: request.manager_id
    });
  }
}

function mapCompetencyToNeedType(competencyId: string): string {
  // Based on competency_master.category
  const comp = getCompetency(competencyId);
  switch (comp.category) {
    case 'soft_skills': return 'soft_skills';
    case 'technical': return 'technical';
    case 'leadership': return 'leadership';
    default: return 'soft_skills';
  }
}
```

**TNI Dashboard:**
- Shows training needs with source = "Performance Feedback"
- HR can map to LMS courses
- Track completion → update `development_plan_goal.status`

---

## Testing Strategy

### Unit Tests

**Service Layer:**
- `calculateOverallScore()` - aggregates competency + KPI ratings correctly
- `generateReport()` - creates report with correct structure
- `autoSuggestManager()` - fetches correct manager from `employees.reporting_to`
- `createTrainingNeeds()` - generates needs for low scores (<3.0)

**Validation:**
- Zod schemas reject invalid ratings (not 1-5)
- Zod schemas require all competencies rated
- Request creation fails if manager not found

---

### Integration Tests

**Full Workflow:**
```typescript
describe('Performance Feedback Workflow', () => {
  it('completes full cycle: create → submit → report → development plan', async () => {
    // 1. HR creates cycle
    const cycle = await POST('/api/performance-feedback/cycles', {
      cycle_name: 'Q2 2026',
      period: '2026-Q2',
      start_date: '2026-04-01',
      end_date: '2026-06-30',
      deadline: '2026-07-07'
    });
    
    // 2. HR adds employee
    const request = await POST('/api/performance-feedback/cycles/${cycle.id}/launch', {
      employee_ids: [employee1.id]
    });
    
    // 3. Manager submits feedback
    const response = await POST('/api/performance-feedback/responses', {
      request_id: request.requests[0].id,
      ratings_json: {
        competencies: [
          { competency_id: comp1.id, rating: 4, comment: 'Strong' },
          { competency_id: comp2.id, rating: 2, comment: 'Needs work' }
        ],
        kpis: []
      }
    });
    
    // 4. Report auto-generated
    const report = await GET(`/api/performance-feedback/reports/${request.requests[0].id}`);
    expect(report.overall_score).toBe(3.0);
    
    // 5. Manager creates development plan
    const plan = await POST('/api/performance-feedback/development-plans', {
      employee_id: employee1.id,
      report_id: report.id,
      plan_json: { focus_areas: ['Teamwork'], timeline: 'Q3 2026' },
      goals: [{ goal_description: 'Attend collaboration workshop', target_date: '2026-09-01' }]
    });
    
    expect(plan.goals).toHaveLength(1);
  });
});
```

**RBAC Tests:**
```typescript
it('prevents manager from rating non-direct report', async () => {
  const response = await POST('/api/performance-feedback/responses', {
    request_id: otherManagerRequest.id,
    ratings_json: { ... }
  }, { user: manager1 });
  
  expect(response.status).toBe(403);
});

it('prevents employee from creating cycle', async () => {
  const response = await POST('/api/performance-feedback/cycles', {
    cycle_name: 'Unauthorized'
  }, { user: employee1 });
  
  expect(response.status).toBe(403);
});
```

---

### E2E Tests

**Manager Journey:**
1. Login as manager
2. Navigate to `/performance-feedback/my-assignments`
3. Click on pending assignment
4. Fill out feedback form (rate all competencies, add comments)
5. Submit feedback
6. Verify success message
7. Navigate to team reports, verify report visible

**Employee Journey:**
1. Login as employee
2. Navigate to `/performance-feedback/my-reports`
3. Verify report listed with correct overall score
4. Click view details
5. Verify competency scores, manager comments visible
6. Verify development plan link (if exists)

---

## Performance Considerations

### Database Indexes

**Critical Queries:**
1. Fetch manager's pending assignments: `idx_request_manager` on `performance_feedback_request(manager_id)`
2. Fetch employee's reports: `idx_report_employee` (need to add via JOIN to request table)
3. Fetch cycle requests: `idx_request_cycle_emp` on `(cycle_id, employee_id)`

### Caching Strategy

**Redis Cache:**
- Competency list (TTL: 1 hour, invalidate on competency update)
- Employee's KPI assignments (TTL: 10 minutes)
- Report data (TTL: 5 minutes, invalidate on regeneration)

**Why:**
- Competencies rarely change, safe to cache
- KPI assignments change infrequently
- Reports are read-heavy after generation

### Pagination

**Large Result Sets:**
- `/api/performance-feedback/requests` - paginate (default: 50 per page)
- `/api/performance-feedback/my-reports` - paginate (default: 20 per page)
- `/api/performance-feedback/team-reports` - paginate (default: 20 per page)

---

## Security Considerations

### Sensitive Data

**Manager Comments:**
- Stored in `response.ratings_json` (encrypted at rest via MySQL encryption)
- Only visible to: employee (subject), manager (author), HR, admin
- NOT visible to peers or other managers

**Anonymity:**
- Not applicable (manager-only feedback, always attributed)
- No need for anonymization logic

### SQL Injection

- All queries use parameterized statements (no string concatenation)
- Zod validation on all inputs

### Authorization

- Row-level access control:
  - Manager can only submit for direct reports (`reporting_to` check)
  - Employee can only view own reports (`employee_id` check)
  - HR can view all (role check)

---

## Migration from Existing System

**If Replacing Manual Process:**
1. HR enters historical feedback as "archived" cycles (optional)
2. Competency master seeded with standard list (can customize)
3. No data migration needed (greenfield)

**If Integrating with External System:**
- Export API: `/api/performance-feedback/export` (CSV/JSON)
- Import API: `/api/performance-feedback/import` (batch create responses)

---

## Future Enhancements (Out of Scope for v1)

1. **Multi-rater feedback (true 360)** - add peer/subordinate/self ratings
2. **Calibration meetings** - normalize scores across managers
3. **Anonymous peer feedback** - add peer category with anonymization
4. **Goal alignment** - link competencies to company OKRs
5. **AI-powered insights** - suggest development plans based on patterns
6. **Mobile app** - native iOS/Android for feedback submission
7. **Video feedback** - allow managers to record video comments
8. **Gamification** - badges for completing feedback on time

---

## Success Metrics

**Adoption:**
- 80%+ manager submission rate before deadline
- 100% employee view rate (employees check reports within 7 days)

**Quality:**
- Average 3+ comments per feedback (not just ratings)
- 70%+ development plans created within 14 days of report

**Impact:**
- 20%+ of low-scoring competencies improve by next cycle
- 50%+ of development plan goals completed on time

---

## Deployment Checklist

**Backend:**
- [ ] Run migration: `backend/sql/036_performance_feedback.sql`
- [ ] Seed competencies (10 default competencies)
- [ ] Add module to `role.catalog.ts` (RBAC)
- [ ] Register routes in `app.ts`

**Frontend:**
- [ ] Add navigation menu items (8 pages)
- [ ] Install recharts library (for trend charts)
- [ ] Add PDF generation library (jsPDF)

**Configuration:**
- [ ] Email templates (invitation, reminder, report ready)
- [ ] Notification preferences (in-app + email)
- [ ] Cron job for deadline reminders (daily at 9 AM)

**Testing:**
- [ ] Run full test suite (unit + integration + e2e)
- [ ] Manual QA: complete one full feedback cycle end-to-end
- [ ] Load test: 100 concurrent managers submitting feedback

---

## Conclusion

This design provides a comprehensive manager-led performance feedback system that:
- Integrates competency + KPI evaluation
- Links to development planning and training needs
- Supports both scheduled and ad-hoc feedback cycles
- Maintains clear RBAC (HR creates, managers submit, employees view)
- Tracks trends over time for continuous improvement

**Key Differentiator:** Not a 360 system (no peer/upward feedback), focused on manager assessment with structured competency framework.
