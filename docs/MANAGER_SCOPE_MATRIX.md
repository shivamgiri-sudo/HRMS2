# Manager / Team Leader Scope Matrix

> Row-level scope enforcement and page-access matrix  
> Date: 2026-06-10  

---

## 1. Role Alias Mapping

| Canonical Role | Aliases | Default Scope | Demo Account |
|---------------|---------|---------------|--------------|
| `process_manager` | `manager` | `process` | manager@mascallnet.com |
| `team_leader` | `tl` | `team` | tl@mascallnet.com |

---

## 2. Page Access Matrix

| Page Code | Page Route | Admin | HR | Manager | TL | Employee |
|-----------|------------|:-----:|:--:|:-------:|:--:|:--------:|
| MANAGEMENT_DASHBOARD | `/management/dashboard` | Y | Y | Y | N | N |
| TEAM_ANALYTICS | `/team-analytics` | Y | Y | Y | N | N |
| WFM_ROSTER | `/wfm/roster` | Y | Y | Y | Y | N |
| WFM_LIVE_TRACKER | `/wfm/live` | Y | Y | Y | Y | N |
| RTA_BOARD | `/rta-board` | Y | Y | Y | Y | N |
| WORKFORCE_COMMAND_CENTER | `/workforce/command` | Y | Y | Y | Y | N |
| KPI_CONFIG | `/kpi/config` | Y | Y | Y | N | N |
| OPERATIONS_KPI | `/kpi/operations` | Y | Y | Y | N | N |
| PROCESS_CONFIG | `/process/config` | Y | Y | Y | N | N |
| WORK_INBOX | `/work-inbox` | Y | Y | Y | Y | N |
| HELPDESK | `/helpdesk` | Y | Y | Y | Y | N |
| ADVANCED_REPORTS | `/reports/advanced` | Y | Y | Y | N | N |
| CAREER_PLANNING | `/career-planning` | Y | Y | Y | Y | N |
| PIP_MANAGEMENT | `/pip` | Y | Y | Y | N | N |
| GOALS | `/goals` | Y | Y | Y | Y | N |
| LMS_MY_LEARNING | `/lms/my-learning` | Y | Y | Y | Y | Y |
| EMPLOYEE_LIST | `/employees` | Y | Y | Y | N | N |
| LEAVE_REQUESTS | `/leave/requests` | Y | Y | Y | N | N |

---

## 3. API Scope Enforcement Matrix

### 3.1 Employee Module

| Route | Manager Scope | TL Scope | Enforcement |
|-------|--------------|----------|-------------|
| `GET /api/employees/stats` | process | — | `allowCeoAllRead` |
| `GET /api/employees/` | process | — | `buildScopeWhereClause` |
| `GET /api/employees/:id` | process | — | `buildScopeWhereClause` + self-read |
| `GET /api/employees/:id/journey` | process | — | `buildScopeWhereClause` |

### 3.2 Leave Module

| Route | Manager Scope | TL Scope | Enforcement |
|-------|--------------|----------|-------------|
| `PATCH /api/leave/requests/:id/review` | process | — | `hasRole("admin","hr","manager")` inline |

### 3.3 WFM Module

| Route | Manager Scope | TL Scope | Enforcement |
|-------|--------------|----------|-------------|
| `GET /api/wfm/attendance-policy/:employeeId` | any employee in scope | — | `requireRole` |
| `GET /api/wfm/shifts` | all shifts | — | `requireRole` |
| `GET /api/wfm/sessions` | all sessions | — | `requireRole` |
| `GET /api/wfm/regularizations` | process | — | `requireRole` |
| `PATCH /api/wfm/regularizations/:id/review` | process | — | `requireRole` |
| `GET /api/wfm/live` | process | — | `requireRole` |
| `GET /api/wfm/roster-preferences/pending` | process | — | `requireRole` |
| `PATCH /api/wfm/roster-preferences/:id/approve` | process | — | `requireRole` |
| `PATCH /api/wfm/roster-preferences/:id/reject` | process | — | `requireRole` |
| `POST /api/wfm/roster/swaps/:id/review` | process | — | `requireRole` |

### 3.4 Workflow Module

| Route | Manager Scope | TL Scope | Enforcement |
|-------|--------------|----------|-------------|
| `GET /api/workflow/requests/pending` | process | team | `requireRole` |
| `POST /api/workflow/requests/:id/act` | process | team | `requireRole` |

### 3.5 Goals Module

| Route | Manager Scope | TL Scope | Enforcement |
|-------|--------------|----------|-------------|
| `POST /api/goals/appraisal/ratings/:cycleId/:employeeId/manager` | direct reports | — | `requireRole("admin","hr","manager")` |

### 3.6 Performance Feedback Module

| Route | Manager Scope | TL Scope | Enforcement |
|-------|--------------|----------|-------------|
| `GET /api/perf/cycles` | all cycles | — | Controller-level |
| `GET /api/perf/cycles/:id` | all cycles | — | Controller-level |
| `GET /api/perf/requests` | own requests | — | Controller-level |
| `POST /api/perf/requests/:id/submit` | own requests | — | Controller-level |
| `GET /api/perf/reports` | subordinates | — | Controller-level |
| `GET /api/perf/reports/:id` | subordinates | — | Controller-level |
| `POST /api/perf/development-plans` | subordinates | — | Controller-level |
| `PATCH /api/perf/development-plans/:id` | subordinates | — | Controller-level |

---

## 4. Scope Gaps

| Gap | Impact | Test Needed |
|-----|--------|-------------|
| TL has no explicit employee routes | TL cannot directly list employees via API | Verify TL employee access via UI pages |
| Manager can see all shifts (not scoped) | Potential data leak | Negative test: manager from Process A sees Process B shifts |
| Attendance correction excludes manager | Manager cannot correct attendance | Verify 403 for manager on PATCH `/api/attendance/daily/:id/:date` |
| Customization module = zero manager access | Manager gets 403 on all customization endpoints | Smoke test for `/customization` page → hidden/403 |
| `performance-feedback` uses controller auth | Inconsistent middleware pattern | Verify controller correctly scopes manager to own subordinates |

---

*Matrix version: 1.0 | Based on commit df5593b4ef1807dc8b0145644f13d67e07cda14d*
