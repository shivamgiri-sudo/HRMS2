# Admin Branch Scope Enforcement Matrix

## Document Information
- **Version**: 1.0.0
- **Date**: June 10, 2026
- **Purpose**: Track scope enforcement implementation across all modules
- **Status**: Audit In Progress

---

## 1. Branch-Owned Tables

### 1.1 Primary Branch-Owned Entities

| Table | Branch Column | Ownership Model | Notes |
|-------|---------------|-----------------|-------|
| `employees` | `branch_id` (FK) | Direct | All employee records belong to a branch |
| `department_master` | `branch_id` (FK) | Direct | Branch-specific departments |
| `process_master` | `branch_id` (FK) | Direct | Branch-specific processes |
| `team_master` | `branch_id` (FK) | Direct | Branch-specific teams |
| `designation_master` | `branch_id` (FK) | Direct | Branch-specific designations |
| `grade_master` | `branch_id` (FK) | Direct | Branch-specific grades |
| `cost_centre_master` | `branch_id` (FK) | Direct | Branch-specific cost centers |

### 1.2 Workforce Management Tables

| Table | Branch Column | Ownership Model | Notes |
|-------|---------------|-----------------|-------|
| `wfm_roster_plan` | `branch_id` (FK) | Direct | Roster plans per branch |
| `wfm_roster_assignment` | via `plan_id` → `wfm_roster_plan.branch_id` | Indirect | Linked to roster plan |
| `wfm_shift_templates` | `branch_id` (FK) | Direct | Branch-specific shifts |
| `shift_swap_requests` | via `employee_id` → `employees.branch_id` | Indirect | Linked to employee |
| `roster_approvals` | via `roster_id` → `wfm_roster_plan.branch_id` | Indirect | Linked to roster plan |

### 1.3 Payroll Tables

| Table | Branch Column | Ownership Model | Notes |
|-------|---------------|-----------------|-------|
| `salary_prep_run` | `branch_id` (FK) | Direct | Payroll runs per branch |
| `payslip_records` | via `salary_prep_run_id` → `salary_prep_run.branch_id` | Indirect | Linked to salary run |
| `salary_register` | `branch_id` (FK) | Direct | Branch salary register |
| `payroll_deductions` | via `employee_id` → `employees.branch_id` | Indirect | Linked to employee |
| `payroll_overtime` | via `employee_id` → `employees.branch_id` | Indirect | Linked to employee |
| `payroll_bonus` | via `employee_id` → `employees.branch_id` | Indirect | Linked to employee |

### 1.4 User Access Tables

| Table | Branch Column | Ownership Model | Notes |
|-------|---------------|-----------------|-------|
| `user_assignment_scope` | `branch_id` (FK, nullable) | Direct | User's branch scope |
| `user_branch_access` | `branch_id` (FK) | Direct | Multi-branch access |
| `user_process_access` | via `process_id` → `process_master.branch_id` | Indirect | Process-based access |

### 1.5 Recruitment (ATS) Tables

| Table | Branch Column | Ownership Model | Notes |
|-------|---------------|-----------------|-------|
| `job_openings` | `branch_id` (FK) | Direct | Job postings per branch |
| `candidates` | `preferred_branch` (FK) | Direct | Candidate's preferred branch |
| `candidate_applications` | via `job_opening_id` → `job_openings.branch_id` | Indirect | Linked to job opening |
| `interview_schedule` | via `application_id` → candidate branch | Indirect | Linked to application |
| `interview_feedback` | via `interview_id` → candidate branch | Indirect | Linked to interview |

### 1.6 Onboarding Tables

| Table | Branch Column | Ownership Model | Notes |
|-------|---------------|-----------------|-------|
| `onboarding_requests` | `branch_id` (FK) | Direct | Onboarding per branch |
| `onboarding_tasks` | via `request_id` → `onboarding_requests.branch_id` | Indirect | Linked to request |
| `onboarding_checklists` | `branch_id` (FK) | Direct | Branch-specific checklists |
| `document_uploads` | via `entity_id` → entity's branch | Contextual | Depends on parent entity |
| `provisioning_tasks` | via `employee_id` → `employees.branch_id` | Indirect | Linked to employee |

### 1.7 Attendance Tables

| Table | Branch Column | Ownership Model | Notes |
|-------|---------------|-----------------|-------|
| `attendance_records` | via `employee_id` → `employees.branch_id` | Indirect | Linked to employee |
| `attendance_policies` | `branch_id` (FK) | Direct | Branch-specific policies |
| `shift_assignments` | via `employee_id` → `employees.branch_id` | Indirect | Linked to employee |
| `biometric_logs` | via `employee_id` → `employees.branch_id` | Indirect | Linked to employee |

### 1.8 Leave Management Tables

| Table | Branch Column | Ownership Model | Notes |
|-------|---------------|-----------------|-------|
| `leave_requests` | via `employee_id` → `employees.branch_id` | Indirect | Linked to employee |
| `leave_balance` | via `employee_id` → `employees.branch_id` | Indirect | Linked to employee |
| `leave_policies` | `branch_id` (FK) | Direct | Branch-specific policies |
| `leave_types` | `branch_id` (FK) | Direct | Branch-specific leave types |
| `comp_off_requests` | via `employee_id` → `employees.branch_id` | Indirect | Linked to employee |

### 1.9 Exit Management Tables

| Table | Branch Column | Ownership Model | Notes |
|-------|---------------|-----------------|-------|
| `exit_requests` | via `employee_id` → `employees.branch_id` | Indirect | Linked to employee |
| `exit_process` | via `exit_request_id` → employee branch | Indirect | Linked to exit request |
| `exit_clearance` | via `exit_request_id` → employee branch | Indirect | Linked to exit request |
| `exit_interviews` | via `exit_request_id` → employee branch | Indirect | Linked to exit request |
| `fnf_settlement` | via `exit_request_id` → employee branch | Indirect | Linked to exit request |
| `exit_documentation` | via `exit_request_id` → employee branch | Indirect | Linked to exit request |

### 1.10 Assets & Helpdesk Tables

| Table | Branch Column | Ownership Model | Notes |
|-------|---------------|-----------------|-------|
| `assets` | `allocated_branch` (FK) | Direct | Assets allocated to branch |
| `asset_allocations` | via `employee_id` → `employees.branch_id` | Indirect | Linked to employee |
| `asset_movements` | via `asset_id` → `assets.allocated_branch` | Indirect | Linked to asset |
| `helpdesk_tickets` | via `raised_by` → `employees.branch_id` | Indirect | Linked to employee |
| `ticket_assignments` | via `ticket_id` → helpdesk ticket branch | Indirect | Linked to ticket |
| `ticket_resolutions` | via `ticket_id` → helpdesk ticket branch | Indirect | Linked to ticket |

### 1.11 Movement & Transfers

| Table | Branch Column | Ownership Model | Notes |
|-------|---------------|-----------------|-------|
| `employee_movements` | `from_branch_id`, `to_branch_id` (FKs) | Direct | Both source and target branch |
| `transfer_requests` | `from_branch_id`, `to_branch_id` (FKs) | Direct | Both source and target branch |
| `cost_centre_history` | `branch_id` (FK) | Direct | Cost center changes |
| `department_transfers` | via `movement_id` → movement branch | Indirect | Linked to movement |

### 1.12 Performance & Reports

| Table | Branch Column | Ownership Model | Notes |
|-------|---------------|-----------------|-------|
| `performance_reviews` | via `employee_id` → `employees.branch_id` | Indirect | Linked to employee |
| `kpi_records` | via `employee_id` → `employees.branch_id` | Indirect | Linked to employee |
| `kpi_master` | `branch_id` (FK) | Direct | Branch-specific KPIs |
| `report_definitions` | `branch_id` (FK, nullable) | Optional | Null = global report |
| `report_results` | via `report_id` → report definition branch | Indirect | Linked to report |

### 1.13 Approval & Workflow Tables

| Table | Branch Column | Ownership Model | Notes |
|-------|---------------|-----------------|-------|
| `approval_requests` | via `requester_id` → `employees.branch_id` | Indirect | Linked to requester |
| `approval_history` | via `approval_request_id` → request branch | Indirect | Linked to approval request |
| `delegations` | via `delegator_id` → `employees.branch_id` | Indirect | Linked to delegator |
| `workflow_instances` | via `entity_id` → entity's branch | Contextual | Depends on entity |

---

## 2. Scope Enforcement Matrix

### Legend
- **Y** = Implemented & Verified
- **N** = Not Implemented
- **P** = Partially Implemented
- **Pending** = Awaiting Implementation
- **N/A** = Not Applicable

### 2.1 Employee Module

| Operation | buildScopeWhereClause | hasScopedAccess | Branch Validation | Export Scoped | KPI Filtered | Status |
|-----------|----------------------|-----------------|-------------------|---------------|--------------|--------|
| **List API** | | | | | | |
| GET /api/employees | P | N/A | N/A | N/A | N/A | Partial |
| GET /api/employees/search | P | N/A | N/A | N/A | N/A | Partial |
| **Detail API** | | | | | | |
| GET /api/employees/:id | N/A | N | N/A | N/A | N/A | Not Implemented |
| **Create API** | | | | | | |
| POST /api/employees | N/A | N/A | N | N/A | N/A | Not Implemented |
| **Update API** | | | | | | |
| PUT /api/employees/:id | N/A | N | N | N/A | N/A | Not Implemented |
| PATCH /api/employees/:id | N/A | N | N | N/A | N/A | Not Implemented |
| **Export API** | | | | | | |
| POST /api/employees/export | P | N/A | N/A | P | N/A | Partial |
| **KPI/Dashboard** | | | | | | |
| GET /api/dashboard/employee-count | N | N/A | N/A | N/A | N | Not Implemented |
| GET /api/dashboard/new-hires | N | N/A | N/A | N/A | N | Not Implemented |

**Notes**: Employee module partially implemented. Detail APIs missing hasScopedAccess check. Create API missing branch validation.

### 2.2 ATS (Recruitment) Module

| Operation | buildScopeWhereClause | hasScopedAccess | Branch Validation | Export Scoped | KPI Filtered | Status |
|-----------|----------------------|-----------------|-------------------|---------------|--------------|--------|
| **List API** | | | | | | |
| GET /api/ats/job-openings | Pending | N/A | N/A | N/A | N/A | Pending |
| GET /api/ats/candidates | Pending | N/A | N/A | N/A | N/A | Pending |
| **Detail API** | | | | | | |
| GET /api/ats/job-openings/:id | N/A | Pending | N/A | N/A | N/A | Pending |
| GET /api/ats/candidates/:id | N/A | Pending | N/A | N/A | N/A | Pending |
| **Create API** | | | | | | |
| POST /api/ats/job-openings | N/A | N/A | Pending | N/A | N/A | Pending |
| POST /api/ats/candidates | N/A | N/A | Pending | N/A | N/A | Pending |
| **Update API** | | | | | | |
| PUT /api/ats/job-openings/:id | N/A | Pending | Pending | N/A | N/A | Pending |
| PUT /api/ats/candidates/:id | N/A | Pending | Pending | N/A | N/A | Pending |
| **Export API** | | | | | | |
| POST /api/ats/candidates/export | Pending | N/A | N/A | Pending | N/A | Pending |
| **KPI/Dashboard** | | | | | | |
| GET /api/ats/pipeline | N/A | N/A | N/A | N/A | Pending | Pending |
| GET /api/ats/time-to-hire | N/A | N/A | N/A | N/A | Pending | Pending |

**Notes**: ATS module scope enforcement not yet implemented. All operations pending.

### 2.3 Payroll Module

| Operation | buildScopeWhereClause | hasScopedAccess | Branch Validation | Export Scoped | KPI Filtered | Status |
|-----------|----------------------|-----------------|-------------------|---------------|--------------|--------|
| **List API** | | | | | | |
| GET /api/payroll/runs | Pending | N/A | N/A | N/A | N/A | Pending |
| GET /api/payroll/payslips | Pending | N/A | N/A | N/A | N/A | Pending |
| **Detail API** | | | | | | |
| GET /api/payroll/runs/:id | N/A | Pending | N/A | N/A | N/A | Pending |
| GET /api/payroll/payslips/:id | N/A | Pending | N/A | N/A | N/A | Pending |
| **Create API** | | | | | | |
| POST /api/payroll/runs | N/A | N/A | Pending | N/A | N/A | Pending |
| POST /api/payroll/process | N/A | N/A | Pending | N/A | N/A | Pending |
| **Update API** | | | | | | |
| PUT /api/payroll/runs/:id | N/A | Pending | Pending | N/A | N/A | Pending |
| **Export API** | | | | | | |
| POST /api/payroll/export | Pending | N/A | N/A | Pending | N/A | Pending |
| **KPI/Dashboard** | | | | | | |
| GET /api/payroll/summary | N/A | N/A | N/A | N/A | Pending | Pending |
| GET /api/payroll/cost-analysis | N/A | N/A | N/A | N/A | Pending | Pending |

**Notes**: Payroll module scope enforcement pending. Critical for data isolation.

### 2.4 Leave Management Module

| Operation | buildScopeWhereClause | hasScopedAccess | Branch Validation | Export Scoped | KPI Filtered | Status |
|-----------|----------------------|-----------------|-------------------|---------------|--------------|--------|
| **List API** | | | | | | |
| GET /api/leave/requests | Pending | N/A | N/A | N/A | N/A | Pending |
| GET /api/leave/balance | Pending | N/A | N/A | N/A | N/A | Pending |
| **Detail API** | | | | | | |
| GET /api/leave/requests/:id | N/A | Pending | N/A | N/A | N/A | Pending |
| **Create API** | | | | | | |
| POST /api/leave/requests | N/A | N/A | Pending | N/A | N/A | Pending |
| **Update API** | | | | | | |
| PUT /api/leave/requests/:id | N/A | Pending | Pending | N/A | N/A | Pending |
| **Export API** | | | | | | |
| POST /api/leave/export | Pending | N/A | N/A | Pending | N/A | Pending |
| **KPI/Dashboard** | | | | | | |
| GET /api/leave/analytics | N/A | N/A | N/A | N/A | Pending | Pending |
| GET /api/leave/utilization | N/A | N/A | N/A | N/A | Pending | Pending |

**Notes**: Leave management scope enforcement pending.

### 2.5 Attendance Module

| Operation | buildScopeWhereClause | hasScopedAccess | Branch Validation | Export Scoped | KPI Filtered | Status |
|-----------|----------------------|-----------------|-------------------|---------------|--------------|--------|
| **List API** | | | | | | |
| GET /api/attendance | Pending | N/A | N/A | N/A | N/A | Pending |
| GET /api/regularization | Pending | N/A | N/A | N/A | N/A | Pending |
| **Detail API** | | | | | | |
| GET /api/attendance/:id | N/A | Pending | N/A | N/A | N/A | Pending |
| GET /api/regularization/:id | N/A | Pending | N/A | N/A | N/A | Pending |
| **Create API** | | | | | | |
| POST /api/regularization | N/A | N/A | Pending | N/A | N/A | Pending |
| **Update API** | | | | | | |
| PUT /api/regularization/:id | N/A | Pending | Pending | N/A | N/A | Pending |
| **Export API** | | | | | | |
| POST /api/attendance/export | Pending | N/A | N/A | Pending | N/A | Pending |
| **KPI/Dashboard** | | | | | | |
| GET /api/attendance/summary | N/A | N/A | N/A | N/A | Pending | Pending |
| GET /api/attendance/absenteeism | N/A | N/A | N/A | N/A | Pending | Pending |

**Notes**: Attendance module scope enforcement pending.

### 2.6 WFM/Roster Module

| Operation | buildScopeWhereClause | hasScopedAccess | Branch Validation | Export Scoped | KPI Filtered | Status |
|-----------|----------------------|-----------------|-------------------|---------------|--------------|--------|
| **List API** | | | | | | |
| GET /api/wfm/roster-plans | Pending | N/A | N/A | N/A | N/A | Pending |
| GET /api/wfm/roster-assignments | Pending | N/A | N/A | N/A | N/A | Pending |
| **Detail API** | | | | | | |
| GET /api/wfm/roster-plans/:id | N/A | Pending | N/A | N/A | N/A | Pending |
| GET /api/wfm/roster-assignments/:id | N/A | Pending | N/A | N/A | N/A | Pending |
| **Create API** | | | | | | |
| POST /api/wfm/roster-plans | N/A | N/A | Pending | N/A | N/A | Pending |
| POST /api/wfm/roster-assignments | N/A | N/A | Pending | N/A | N/A | Pending |
| **Update API** | | | | | | |
| PUT /api/wfm/roster-plans/:id | N/A | Pending | Pending | N/A | N/A | Pending |
| PUT /api/wfm/roster-assignments/:id | N/A | Pending | Pending | N/A | N/A | Pending |
| **Export API** | | | | | | |
| POST /api/wfm/roster/export | Pending | N/A | N/A | Pending | N/A | Pending |
| **KPI/Dashboard** | | | | | | |
| GET /api/wfm/coverage | N/A | N/A | N/A | N/A | Pending | Pending |
| GET /api/wfm/adherence | N/A | N/A | N/A | N/A | Pending | Pending |

**Notes**: WFM/Roster Phase 6 deferred. 3 middleware functions needed for full implementation.

### 2.7 Exit Management Module

| Operation | buildScopeWhereClause | hasScopedAccess | Branch Validation | Export Scoped | KPI Filtered | Status |
|-----------|----------------------|-----------------|-------------------|---------------|--------------|--------|
| **List API** | | | | | | |
| GET /api/exit/requests | Pending | N/A | N/A | N/A | N/A | Pending |
| GET /api/exit/process | Pending | N/A | N/A | N/A | N/A | Pending |
| **Detail API** | | | | | | |
| GET /api/exit/requests/:id | N/A | Pending | N/A | N/A | N/A | Pending |
| GET /api/exit/process/:id | N/A | Pending | N/A | N/A | N/A | Pending |
| **Create API** | | | | | | |
| POST /api/exit/requests | N/A | N/A | Pending | N/A | N/A | Pending |
| **Update API** | | | | | | |
| PUT /api/exit/requests/:id | N/A | Pending | Pending | N/A | N/A | Pending |
| PUT /api/exit/process/:id | N/A | Pending | Pending | N/A | N/A | Pending |
| **Export API** | | | | | | |
| POST /api/exit/export | Pending | N/A | N/A | Pending | N/A | Pending |
| **KPI/Dashboard** | | | | | | |
| GET /api/exit/analytics | N/A | N/A | N/A | N/A | Pending | Pending |
| GET /api/exit/attrition | N/A | N/A | N/A | N/A | Pending | Pending |

**Notes**: Exit management scope enforcement pending.

### 2.8 Assets Module

| Operation | buildScopeWhereClause | hasScopedAccess | Branch Validation | Export Scoped | KPI Filtered | Status |
|-----------|----------------------|-----------------|-------------------|---------------|--------------|--------|
| **List API** | | | | | | |
| GET /api/assets | Pending | N/A | N/A | N/A | N/A | Pending |
| GET /api/assets/allocations | Pending | N/A | N/A | N/A | N/A | Pending |
| **Detail API** | | | | | | |
| GET /api/assets/:id | N/A | Pending | N/A | N/A | N/A | Pending |
| **Create API** | | | | | | |
| POST /api/assets | N/A | N/A | Pending | N/A | N/A | Pending |
| POST /api/assets/allocate | N/A | N/A | Pending | N/A | N/A | Pending |
| **Update API** | | | | | | |
| PUT /api/assets/:id | N/A | Pending | Pending | N/A | N/A | Pending |
| **Export API** | | | | | | |
| POST /api/assets/export | Pending | N/A | N/A | Pending | N/A | Pending |
| **KPI/Dashboard** | | | | | | |
| GET /api/assets/inventory | N/A | N/A | N/A | N/A | Pending | Pending |

**Notes**: Assets module scope enforcement pending.

### 2.9 Reports Module

| Operation | buildScopeWhereClause | hasScopedAccess | Branch Validation | Export Scoped | KPI Filtered | Status |
|-----------|----------------------|-----------------|-------------------|---------------|--------------|--------|
| **List API** | | | | | | |
| GET /api/reports | Pending | N/A | N/A | N/A | N/A | Pending |
| **Detail API** | | | | | | |
| GET /api/reports/:id | N/A | Pending | N/A | N/A | N/A | Pending |
| **Create API** | | | | | | |
| POST /api/reports | N/A | N/A | Pending | N/A | N/A | Pending |
| **Update API** | | | | | | |
| PUT /api/reports/:id | N/A | Pending | Pending | N/A | N/A | Pending |
| **Export API** | | | | | | |
| POST /api/reports/:id/run | Pending | N/A | N/A | Pending | N/A | Pending |
| POST /api/reports/:id/export | Pending | N/A | N/A | Pending | N/A | Pending |
| **KPI/Dashboard** | | | | | | |
| GET /api/reports/scheduled | N/A | N/A | N/A | N/A | Pending | Pending |

**Notes**: Reports module must enforce scope in report queries. Custom SQL reports especially vulnerable.

### 2.10 Onboarding Module

| Operation | buildScopeWhereClause | hasScopedAccess | Branch Validation | Export Scoped | KPI Filtered | Status |
|-----------|----------------------|-----------------|-------------------|---------------|--------------|--------|
| **List API** | | | | | | |
| GET /api/onboarding | Pending | N/A | N/A | N/A | N/A | Pending |
| GET /api/onboarding/tasks | Pending | N/A | N/A | N/A | N/A | Pending |
| **Detail API** | | | | | | |
| GET /api/onboarding/:id | N/A | Pending | N/A | N/A | N/A | Pending |
| **Create API** | | | | | | |
| POST /api/onboarding | N/A | N/A | Pending | N/A | N/A | Pending |
| **Update API** | | | | | | |
| PUT /api/onboarding/:id | N/A | Pending | Pending | N/A | N/A | Pending |
| **Export API** | | | | | | |
| POST /api/onboarding/export | Pending | N/A | N/A | Pending | N/A | Pending |
| **KPI/Dashboard** | | | | | | |
| GET /api/onboarding/progress | N/A | N/A | N/A | N/A | Pending | Pending |
| GET /api/onboarding/time-to-complete | N/A | N/A | N/A | N/A | Pending | Pending |

**Notes**: Onboarding module scope enforcement pending.

### 2.11 Movement Module

| Operation | buildScopeWhereClause | hasScopedAccess | Branch Validation | Export Scoped | KPI Filtered | Status |
|-----------|----------------------|-----------------|-------------------|---------------|--------------|--------|
| **List API** | | | | | | |
| GET /api/movements | Pending | N/A | N/A | N/A | N/A | Pending |
| **Detail API** | | | | | | |
| GET /api/movements/:id | N/A | Pending | N/A | N/A | N/A | Pending |
| **Create API** | | | | | | |
| POST /api/movements | N/A | N/A | Pending | N/A | N/A | Pending |
| **Update API** | | | | | | |
| PUT /api/movements/:id | N/A | Pending | Pending | N/A | N/A | Pending |
| **Export API** | | | | | | |
| POST /api/movements/export | Pending | N/A | N/A | Pending | N/A | Pending |
| **KPI/Dashboard** | | | | | | |
| GET /api/movements/analytics | N/A | N/A | N/A | N/A | Pending | Pending |

**Notes**: Movement module requires validation of both source AND target branch scope.

### 2.12 Work Inbox Module

| Operation | buildScopeWhereClause | hasScopedAccess | Branch Validation | Export Scoped | KPI Filtered | Status |
|-----------|----------------------|-----------------|-------------------|---------------|--------------|--------|
| **List API** | | | | | | |
| GET /api/inbox/pending | Pending | N/A | N/A | N/A | N/A | Pending |
| GET /api/inbox/notifications | Pending | N/A | N/A | N/A | N/A | Pending |
| **Detail API** | | | | | | |
| GET /api/inbox/pending/:id | N/A | Pending | N/A | N/A | N/A | Pending |
| **Create API** | | | | | | |
| N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| **Update API** | | | | | | |
| PUT /api/inbox/pending/:id | N/A | Pending | N/A | N/A | N/A | Pending |
| **Export API** | | | | | | |
| POST /api/inbox/export | Pending | N/A | N/A | Pending | N/A | Pending |
| **KPI/Dashboard** | | | | | | |
| GET /api/inbox/counts | N/A | N/A | N/A | N/A | Pending | Pending |

**Notes**: Work inbox must filter by requester's branch scope.

---

## 3. Known Gaps

### 3.1 Critical Issues

#### Gap #1: Admin Bypass Vulnerability
- **Location**: `backend/src/utils/scopeAccess.ts`
- **Issue**: `allowAdminBypass: true` default
- **Impact**: Any admin role bypasses all scope checks
- **Priority**: P0 - Critical
- **Status**: Open

#### Gap #2: WFM/Roster Phase 6 Deferred
- **Location**: `backend/src/middleware/`
- **Issue**: 3 middleware functions needed for roster scope
- **Impact**: Roster module lacks complete scope enforcement
- **Priority**: P1 - High
- **Status**: Deferred

### 3.2 List API Gaps

| Module | API | Issue | Risk |
|--------|-----|-------|------|
| Employee | GET /api/employees | buildScopeWhereClause partially implemented | Medium |
| ATS | All list APIs | No scope WHERE clause | High |
| Payroll | All list APIs | No scope WHERE clause | High |
| Leave | All list APIs | No scope WHERE clause | High |
| Attendance | All list APIs | No scope WHERE clause | High |
| WFM | All list APIs | No scope WHERE clause | High |
| Exit | All list APIs | No scope WHERE clause | High |
| Assets | All list APIs | No scope WHERE clause | Medium |
| Reports | Custom SQL | Scope not injected | Critical |

### 3.3 Detail API Gaps

| Module | API | Issue | Risk |
|--------|-----|-------|------|
| Employee | GET /api/employees/:id | No hasScopedAccess check | Critical |
| ATS | All detail APIs | No hasScopedAccess check | High |
| Payroll | All detail APIs | No hasScopedAccess check | High |
| Leave | All detail APIs | No hasScopedAccess check | High |
| Attendance | All detail APIs | No hasScopedAccess check | High |
| WFM | All detail APIs | No hasScopedAccess check | High |
| Exit | All detail APIs | No hasScopedAccess check | High |
| Assets | All detail APIs | No hasScopedAccess check | Medium |

### 3.4 Create/Update API Gaps

| Module | API | Issue | Risk |
|--------|-----|-------|------|
| Employee | POST /api/employees | No target branch validation | Critical |
| Employee | PUT /api/employees/:id | No source/target branch validation | Critical |
| Movement | POST /api/movements | No source/target branch validation | Critical |
| All | Create APIs | Missing branch scope validation | High |
| All | Update APIs | Missing source/target validation | High |

### 3.5 Export API Gaps

| Module | API | Issue | Risk |
|--------|-----|-------|------|
| Employee | POST /api/employees/export | Partial implementation | Medium |
| All | Export APIs | Scope not enforced consistently | High |
| Reports | Custom exports | SQL injection + scope bypass risk | Critical |

### 3.6 KPI/Dashboard Gaps

| Module | KPI | Issue | Risk |
|--------|-----|-------|------|
| Dashboard | All KPIs | No branch filter | High |
| Employee | Counts | KPI counts don't match drilldown | Medium |
| All | Dashboard APIs | Branch filter not applied | High |

---

## 4. Implementation Priority

### Phase 1: Critical Fixes (Week 1)
1. Fix admin bypass vulnerability in `scopeAccess.ts`
2. Add hasScopedAccess check to Employee detail API
3. Add branch validation to Employee create/update

### Phase 2: Core Modules (Week 1-2)
1. Employee module - complete scope enforcement
2. Dashboard - fix KPI branch filtering
3. Export operations - consistent scope

### Phase 3: Secondary Modules (Week 2)
1. Leave Management
2. Attendance
3. Assets & Helpdesk

### Phase 4: Complex Modules (Week 3)
1. ATS/Recruitment
2. Payroll
3. Exit Management
4. Onboarding

### Phase 5: Advanced (Week 4)
1. WFM/Roster (3 middleware functions)
2. Reports (custom SQL scope)
3. Movement (dual branch validation)

---

## 5. Testing Requirements

### 5.1 Unit Tests Required
- [ ] buildScopeWhereClause for each module
- [ ] hasScopedAccess for each resource type
- [ ] validateBranchScope for create operations
- [ ] validateSourceAndTargetScope for updates
- [ ] Export scope consistency
- [ ] KPI branch filtering

### 5.2 Integration Tests Required
- [ ] Cross-branch access denied
- [ ] Same-branch access granted
- [ ] Multi-branch admin union access
- [ ] Global admin full access
- [ ] No-scope admin default deny

### 5.3 E2E Tests Required
- [ ] All 22 admin journeys with scope validation
- [ ] Direct URL access tests
- [ ] Tampering attack tests (see specification)
- [ ] Export data isolation tests

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-06-10 | Security Team | Initial matrix |

---

**NEXT**: See [ADMIN_E2E_TEST_MATRIX.md](./ADMIN_E2E_TEST_MATRIX.md) for detailed test scenarios.
