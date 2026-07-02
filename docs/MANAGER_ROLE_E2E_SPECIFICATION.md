# Manager / Team Leader E2E Specification

> Scope: End-to-end smoke and integration tests for `manager` (aliased to `process_manager`) and `tl` (aliased to `team_leader`) roles.  
> Date: 2026-06-10  
> Commit: df5593b4ef1807dc8b0145644f13d67e07cda14d  

---

## 1. Role Definitions

### 1.1 Manager (`process_manager`)

- **Primary alias**: `manager` ↔ `process_manager`
- **Demo credentials**: `manager@mascallnet.com` / `Manager@1`
- **Name**: Sunita Reddy
- **Scope**: Process-level (team under a process)
- **Pages accessible** (from demoCreds):
  - WFM_ROSTER, WFM_LIVE_TRACKER, RTA_BOARD, WORKFORCE_COMMAND_CENTER, MANAGEMENT_DASHBOARD
  - KPI_CONFIG, OPERATIONS_KPI, PROCESS_CONFIG
  - HELPDESK, WORK_INBOX, ADVANCED_REPORTS
  - CAREER_PLANNING, PIP_MANAGEMENT, GOALS, LMS_MY_LEARNING

### 1.2 Team Leader (`team_leader`)

- **Primary alias**: `tl` ↔ `team_leader`
- **Demo credentials**: `tl@mascallnet.com` / `TeamLead@1`
- **Name**: Vikram Mehta
- **Scope**: Team-level (direct reports)
- **Pages accessible** (from demoCreds):
  - WFM_ROSTER, RTA_BOARD, HELPDESK, WORK_INBOX
  - GOALS, LMS_MY_LEARNING, CAREER_PLANNING

---

## 2. Frontend Routes

| Route | Page Component | Manager Access | TL Access | Test Priority |
|-------|---------------|----------------|-----------|---------------|
| `/management/dashboard` | `NativeManagementDashboard.tsx` | Yes | No | P1 |
| `/team-analytics` | `TeamAnalytics.tsx` | Yes | No | P1 |
| `/performance` | `Performance.tsx` (Team tab) | Yes | Yes | P2 |
| `/employees` | `NativeEmployees.tsx` | Yes | No | P2 |
| `/wfm/roster` | `NativeRoster.tsx` | Yes | Yes | P2 |
| `/wfm/live` | `NativeRTABoard.tsx` / Live Tracker | Yes | Yes | P2 |
| `/leave/requests` | `NativeLeaveRequests.tsx` | Yes | No | P2 |
| `/work-inbox` | `NativeWorkInbox.tsx` | Yes | Yes | P3 |
| `/goals` | `NativeGoalsAppraisal.tsx` | Yes | Yes | P3 |
| `/career-planning` | `NativeCareerPlanning.tsx` | Yes | Yes | P4 |
| `/rta-board` | `NativeRTABoard.tsx` | Yes | Yes | P3 |

---

## 3. Backend API Endpoints

### 3.1 Manager-Accessible Routes

| Module | Route | Method | Middleware | Description |
|--------|-------|--------|------------|-------------|
| `leave` | `/requests/:id/review` | PATCH | `admin, hr, manager` | Approve/reject leave |
| `employees` | `/stats` | GET | `admin, hr, manager, ceo` | Aggregate stats |
| `employees` | `/` | GET | `admin, hr, manager` | List employees (scoped) |
| `employees` | `/:id` | GET | `admin, hr, manager` | Get employee (scoped) |
| `employees` | `/:id/journey` | GET | `admin, hr, manager` | Journey log |
| `goals` | `/appraisal/ratings/:cycleId/:employeeId/manager` | POST | `admin, hr, manager` | Submit manager rating |
| `wfm` | `/attendance-policy/:employeeId` | GET | `admin, wfm, manager` | Attendance policy |
| `wfm` | `/shifts` | GET | `admin, wfm, manager` | List shifts |
| `wfm` | `/sessions` | GET | `admin, wfm, manager` | Attendance sessions |
| `wfm` | `/regularizations` | GET | `admin, wfm, manager` | List regularizations |
| `wfm` | `/regularizations/:id/review` | PATCH | `admin, wfm, manager` | Review regularization |
| `wfm` | `/live` | GET | `admin, wfm, manager` | Live tracker |
| `wfm` | `/roster-preferences/pending` | GET | `admin, hr, manager, wfm` | Pending preferences |
| `wfm` | `/roster-preferences/:id/approve` | PATCH | `admin, hr, manager, wfm` | Approve preference |
| `wfm` | `/roster-preferences/:id/reject` | PATCH | `admin, hr, manager, wfm` | Reject preference |
| `wfm-ext` | `/roster/swaps/:id/review` | POST | `admin, hr, wfm, manager` | Approve swap |
| `workflow` | `/requests/pending` | GET | `admin, hr, manager, tl` | Pending inbox |
| `workflow` | `/requests/:id/act` | POST | `admin, hr, manager, tl` | Take action |

### 3.2 TL-Accessible Routes

| Module | Route | Method | Middleware | Description |
|--------|-------|--------|------------|-------------|
| `workflow` | `/requests/pending` | GET | `admin, hr, manager, tl` | Pending inbox |
| `workflow` | `/requests/:id/act` | POST | `admin, hr, manager, tl` | Take action |
| `wfm` | `/shifts` | GET | `admin, wfm, manager` | Indirect via page access |
| `wfm` | `/live` | GET | `admin, wfm, manager` | Indirect via page access |

**Note**: TL has very limited explicit backend routes. Most TL access is frontend-gated via page permissions.

---

## 4. Scope Enforcement Rules

### 4.1 Manager Scope

- **Default scope type**: `process` (process-level filtering)
- **Scope filter applied**: `branchId`, `processId`, `departmentId`, `managerEmployeeId`
- **Behavior**: Manager sees only employees in their process/branch, or direct reports
- **Row-level enforcement**: `buildScopeWhereClause()` in employee routes

### 4.2 Team Leader Scope

- **Default scope type**: `team` (team-level filtering)
- **Scope filter applied**: Direct reports only (`reporting_manager_id`)
- **Behavior**: TL sees only their direct reports

### 4.3 Negative Tests Required

| Test | Role | Expected Behavior |
|------|------|-------------------|
| Access customization rules | Manager | 403 or page hidden |
| Approve auto-roster plan | Manager (not process_manager) | 403 |
| Edit employee outside scope | Manager | 403 or not returned in list |
| Access admin dashboard | TL | Redirect or 403 |
| Access finance/payroll | Manager | Page hidden / 403 |

---

## 5. Test Infrastructure

- **Framework**: Playwright (Chromium only)
- **Base URL**: `http://localhost:8080`
- **Session injection**: `injectDemoSession(page, "manager")` or `injectDemoSession(page, "tl")`
- **Helpers**: `e2e/helpers.ts` — `gotoSmoke()`, `assertNotCrashed()`, `waitForAppShell()`
- **Retries**: 1 in CI, 0 local
- **Workers**: 1 (sequential)

---

## 6. Gap Analysis

| Gap | Severity | Notes |
|-----|----------|-------|
| No manager smoke tests | Critical | Only TL smoke exists in `e2e/smoke.smoke.ts` |
| No management dashboard E2E | High | `/management/dashboard` completely untested |
| No team analytics E2E | High | `/team-analytics` completely untested |
| No scope enforcement E2E | High | Manager/TL could see data outside their scope |
| No negative tests | Medium | No tests verifying what manager/TL CANNOT do |
| No performance review E2E | Medium | Manager rating submission untested end-to-end |
| No workflow inbox E2E | Medium | `/work-inbox` untested for manager/TL |

---

*Specification version: 1.0 | Based on commit df5593b4ef1807dc8b0145644f13d67e07cda14d*
