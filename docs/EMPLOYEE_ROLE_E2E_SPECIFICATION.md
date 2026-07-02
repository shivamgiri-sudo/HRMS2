# Employee Role E2E Specification — HRMS1

## Project Overview

| Layer | Technology |
|---|---|
| Frontend | Vite 5 + React 18 + TypeScript + Tailwind CSS 3 + shadcn/ui + React Router v7 + TanStack Query 5 |
| Backend | Node.js + Express 4 + TypeScript + MySQL 8 |
| Auth | JWT (access 15min, refresh 7days) + bcrypt |
| Testing | Playwright 1.60 (E2E), Vitest + Supertest (backend) |
| Deployment | Frontend Vercel, Backend Railway |

## Employee Auth Flow

```
Employee onboarding completed
  → employee record created in `employees` table
  → `employees.user_id` linked to `auth_user.id`
  → `auth_user.active_status = 1`
  → `user_roles` receives "employee" role
  → Employee receives invitation email or uses forgot-password
  → Reset token hashed in `auth_password_reset.token_hash`
  → `POST /api/auth/reset-password` validates token + sets password
  → Employee logs in via `POST /api/auth/login` (email or employee_code)
  → JWT access token returned, stored in localStorage
  → Frontend fetches `GET /api/access/me` for role/page catalog
  → Employee redirected to `/dashboard`
  → Sidebar filtered by `useUserRole().visiblePageCodes`
  → All API calls include `Authorization: Bearer <token>`
```

## Employee Frontend Route Map

### Public Routes (No Auth)
| Route | Component | File | Auth |
|---|---|---|---|
| `/auth` | `Auth` | `src/pages/Auth.tsx` | None |
| `/reset-password` | `ResetPassword` | `src/pages/ResetPassword.tsx` | None |

### Authenticated Employee Routes (ProtectedRoute + Role-Based Sidebar)
| Route | Component | Sidebar Group | Page Code | Auth |
|---|---|---|---|---|
| `/dashboard` | `Index` | Overview | — | `requireAuth` |
| `/profile` | `Profile` | My Space | — | `requireAuth` |
| `/attendance` | `Attendance` | My Space | — | `requireAuth` |
| `/attendance-regularization` | `AttendanceRegularization` | My Space | — | `requireAuth` |
| `/leaves` | `Leaves` | My Space | — | `requireAuth` |
| `/my-roster` | `NativeMyRoster` | My Space | — | `requireAuth` |
| `/work-inbox` | `NativeWorkInbox` | Overview | `WORK_INBOX` | `requireAuth` + gate |
| `/payroll/payslips` | `NativePayslipCenter` | My Space | `PAYROLL_PAYSLIPS` | `requireAuth` + gate |
| `/payroll/tax-declaration` | `NativeTaxDeclaration` | My Space | `TAX_DECLARATION` | `requireAuth` + gate |
| `/helpdesk` | `NativeHelpdesk` | Engage & Support | `HELPDESK` | `requireAuth` + gate |
| `/lms/my-learning` | `NativeLMSMyLearning` | Workforce | `LMS_MY_LEARNING` | `requireAuth` + gate |
| `/goals` | `NativeGoalsAppraisal` | Operations | `GOALS` | `requireAuth` + gate |
| `/performance-feedback/my-reports` | `NativePerformanceFeedbackMyReports` | Engage & Support | — | `requireAuth` |
| `/performance-feedback/development-plan` | `NativePerformanceFeedbackDevelopmentPlan` | — | — | `requireAuth` |
| `/calendar` | `CompanyCalendar` | Overview | — | `requireAuth` |
| `/notification-preferences` | `NotificationPreferences` | Overview | — | `requireAuth` |
| `/assets` | `Assets` | My Space | — | `requireAuth` |
| `/engagement` | `NativeEngagement` | My Space | — | `requireAuth` |
| `/engagement/badges` | `NativeBadges` | Engage & Support | — | `requireAuth` |
| `/engagement/kudos` | `NativeKudos` | Engage & Support | — | `requireAuth` |
| `/engagement/surveys` | `NativeSurveys` | Engage & Support | — | `requireAuth` |
| `/engagement/leaderboard` | `NativeLeaderboard` | Engage & Support | — | `requireAuth` |

### Guard Notes
- `ProtectedRoute` wraps all authenticated routes; unauthenticated redirected to `/auth`
- `WorkforcePageGate` wraps page-code gated routes; unauthorized shows "Access not available"
- Sidebar items are filtered by `visiblePageCodes` returned from `GET /api/access/me`

## Employee Backend API Map

### Auth Module (`/api/auth`)
| Method | Endpoint | Handler | Auth | Role/Owner | Tables |
|---|---|---|---|---|---|
| POST | `/api/auth/login` | `authService.login` | None | — | `auth_user`, `employees` |
| POST | `/api/auth/register` | `authService.register` | None | — | `auth_user` |
| POST | `/api/auth/refresh` | `authService.refreshAccess` | None | — | `auth_refresh_token`, `auth_user` |
| POST | `/api/auth/logout` | `authService.logout` | `requireAuth` | — | `auth_refresh_token` |
| POST | `/api/auth/forgot-password` | `authService.forgotPassword` | None | — | `auth_user`, `employees`, `auth_password_reset` |
| POST | `/api/auth/reset-password` | `authService.resetPassword` | None | — | `auth_password_reset`, `auth_user` |

### Employee Profile (`/api/employees`)
| Method | Endpoint | Handler | Auth | Role/Owner | Tables |
|---|---|---|---|---|---|
| GET | `/api/employees/me` | Inline | `requireAuth` | Self (`user_id`) | `employees` |
| GET | `/api/employees/:id/stat-card` | Inline | `requireAuth` | Self or admin/hr/ceo | Multiple joins |
| GET | `/api/employees/:id/journey` | Inline | `requireAuth` | Self or admin/hr/manager | `employee_journey_log` |

### Employee Documents (`/api/employee-docs`)
| Method | Endpoint | Handler | Auth | Role/Owner | Tables |
|---|---|---|---|---|---|
| GET | `/api/employee-docs/:employeeId` | Inline | `requireAuth` | Self or admin/hr (`selfOrAdminHr`) | `employee_documents` |

### Attendance (`/api/wfm`, `/api/wfm/attendance`)
| Method | Endpoint | Handler | Auth | Role/Owner | Tables |
|---|---|---|---|---|---|
| POST | `/api/wfm/sessions/clock-in` | `wfmController.clockIn` | `requireAuth` | Self (derived from token) | `wfm_attendance_session` |
| POST | `/api/wfm/sessions/clock-out` | `wfmController.clockOut` | `requireAuth` | Self (derived from token) | `wfm_attendance_session` |
| POST | `/api/wfm/sessions/break` | `wfmController.logBreak` | `requireAuth` | Self (derived from token) | `wfm_break_log` |
| GET | `/api/wfm/attendance/daily` | `attendanceEngineService.listRecords` | `requireAuth` | Self or privileged | `attendance_daily_record` |
| GET | `/api/wfm/attendance/daily/:employeeId/:date` | `attendanceEngineService.getRecord` | `requireAuth` | Self or privileged | `attendance_daily_record` |
| GET | `/api/wfm/attendance/summary/:employeeId/:month` | `attendanceEngineService.getMonthlySummary` | `requireAuth` | Self or privileged | `attendance_daily_record` |

### Attendance Regularization (`/api/wfm`)
| Method | Endpoint | Handler | Auth | Role/Owner | Tables |
|---|---|---|---|---|---|
| POST | `/api/wfm/regularizations` | `wfmController.submitRegularization` | `requireAuth` | Self (derived from token) | `attendance_regularization` |
| GET | `/api/wfm/regularizations` | `wfmController.listRegularizations` | `requireAuth` | Self or admin/hr/manager | `attendance_regularization` |

### Leave (`/api/leave`)
| Method | Endpoint | Handler | Auth | Role/Owner | Tables |
|---|---|---|---|---|---|
| GET | `/api/leave/types` | `leaveController.listLeaveTypes` | `requireAuth` | Any authenticated | `leave_type_master` |
| POST | `/api/leave/requests` | `leaveController.submitRequest` | `requireAuth` | Self or privileged | `leave_request` |
| GET | `/api/leave/requests` | `leaveController.listRequests` | `requireAuth` | Self or privileged | `leave_request` |
| GET | `/api/leave/balance/:employeeId` | `leaveController.getBalance` | `requireAuth` | Self or privileged | `leave_balance_ledger`, `leave_type_master` |
| GET | `/api/leave/holidays` | `leaveController.listHolidays` | `requireAuth` | Any authenticated | `leave_holiday_master` |
| GET | `/api/leave/eligibility/:employeeId` | Inline | `requireAuth` | Any authenticated | `leave_type_master` |

### Roster (`/api/wfm/roster`)
| Method | Endpoint | Handler | Auth | Role/Owner | Tables |
|---|---|---|---|---|---|
| GET | `/api/wfm/roster/assignments` | `c.listAssignments` | `requireAuth` | Self or privileged | `wfm_roster_assignment` |
| POST | `/api/wfm/roster-preferences` | Inline | `requireAuth` | Self | Roster preferences |
| GET | `/api/wfm/roster-preferences/my` | Inline | `requireAuth` | Self | Roster preferences |

### Payroll (`/api/payroll`)
| Method | Endpoint | Handler | Auth | Role/Owner | Tables |
|---|---|---|---|---|---|
| GET | `/api/payroll/payslip/:runId/:employeeId` | Inline | `requireAuth` | Self or payroll role | `salary_payslip`, `salary_prep_line` |
| POST | `/api/payroll/payslip/:payslipId/acknowledge` | `payslipService.acknowledgePayslip` | `requireAuth` | Self (from token) | `salary_payslip` |
| GET | `/api/payroll/tax-declaration/:employeeId/:year` | `taxDeclarationService.get` | `requireAuth` | Self or payroll role | `tax_declaration` |
| POST | `/api/payroll/tax-declaration/:employeeId/:year` | `taxDeclarationService.upsert` | `requireAuth` | Self or payroll role | `tax_declaration` |
| GET | `/api/payroll/advances/:employeeId` | `payrollController.listAdvances` | `requireAuth` | Self or payroll role | `salary_advance_log` |

### Helpdesk (`/api/helpdesk`)
| Method | Endpoint | Handler | Auth | Role/Owner | Tables |
|---|---|---|---|---|---|
| GET | `/api/helpdesk/tickets` | Inline | `requireAuth` | Self or admin/hr | `helpdesk_ticket` |
| POST | `/api/helpdesk/tickets` | Inline | `requireAuth` | Self (from token) | `helpdesk_ticket` |
| GET | `/api/helpdesk/tickets/:id` | Inline | `requireAuth` | Self or admin/hr | `helpdesk_ticket` |
| POST | `/api/helpdesk/tickets/:id/comments` | Inline | `requireAuth` | Self or admin/hr | `helpdesk_ticket_comment` |
| POST | `/api/helpdesk/grievances` | Inline | `requireAuth` | Self (from token) | `grievance` |

### Assets (`/api/assets-mgmt`)
| Method | Endpoint | Handler | Auth | Role/Owner | Tables |
|---|---|---|---|---|---|
| GET | `/api/assets-mgmt/employee/:employeeId` | Inline | `requireAuth` | Self or admin/hr | `asset_assignment` |

### Work Inbox (`/api/inbox`)
| Method | Endpoint | Handler | Auth | Role/Owner | Tables |
|---|---|---|---|---|---|
| GET | `/api/inbox/count` | `inboxService.getUnreadCount` | `requireAuth` | Self (from token) | `work_inbox_item` |
| GET | `/api/inbox` | `inboxService.listItems` | `requireAuth` | Self (from token) | `work_inbox_item` |
| PATCH | `/api/inbox/:id/read` | `inboxService.markRead` | `requireAuth` | Self (from token) | `work_inbox_item` |
| PATCH | `/api/inbox/:id/actioned` | `inboxService.markActioned` | `requireAuth` | Self (from token) | `work_inbox_item` |
| PATCH | `/api/inbox/mark-all-read` | `inboxService.markAllRead` | `requireAuth` | Self (from token) | `work_inbox_item` |

### Goals (`/api/goals`)
| Method | Endpoint | Handler | Auth | Role/Owner | Tables |
|---|---|---|---|---|---|
| GET | `/api/goals/goals` | `goalsService.listGoals` | `requireAuth` | Self or admin/hr | `goal` |
| POST | `/api/goals/goals` | `goalsService.createGoal` | `requireAuth` | Self or admin/hr | `goal` |
| GET | `/api/goals/skills/employee/:employeeId` | `goalsService.listEmployeeSkills` | `requireAuth` | Self or admin/hr | `employee_skill` |

### Performance Feedback (`/api/performance-feedback`)
| Method | Endpoint | Handler | Auth | Role/Owner | Tables |
|---|---|---|---|---|---|
| GET | `/api/performance-feedback/requests` | `c.getRequests` | `requireAuth` | Employee (own) | `performance_feedback_request` |
| GET | `/api/performance-feedback/reports` | `c.getReports` | `requireAuth` | Employee (own) | `performance_feedback_report` |
| GET | `/api/performance-feedback/development-plans` | `c.getDevelopmentPlans` | `requireAuth` | Employee (own) | `development_plan` |

### Calendar (`/api/org/events`)
| Method | Endpoint | Handler | Auth | Role/Owner | Tables |
|---|---|---|---|---|---|
| GET | `/api/org/events` | Inline | `requireAuth` | Any authenticated | `company_event_master` |
| GET | `/api/org/events/:id` | Inline | `requireAuth` | Any authenticated | `company_event_master` |

### Engagement (`/api/engagement`)
| Method | Endpoint | Handler | Auth | Role/Owner | Tables |
|---|---|---|---|---|---|
| GET | `/api/engagement/me` | `c.getMySummary` | `requireAuth` | Any authenticated | Multiple |
| GET | `/api/engagement/badges/:employeeId` | `c.getEmployeeBadges` | `requireAuth` | Self or admin/hr | `employee_badge` |
| GET | `/api/engagement/leaderboard` | `c.getLeaderboard` | `requireAuth` | Any authenticated | `employee_tier_status` |
| GET | `/api/engagement/kudos/wall` | `c.listKudos` | `requireAuth` | Any authenticated | `kudos` |
| POST | `/api/engagement/kudos` | `c.sendKudos` | `requireAuth` | Any authenticated | `kudos` |
| GET | `/api/engagement/surveys` | `c.listSurveys` | `requireAuth` | Any authenticated | `survey` |
| POST | `/api/engagement/surveys/:id/respond` | `c.submitSurvey` | `requireAuth` | Any authenticated | `survey_response` |
| POST | `/api/engagement/pulse` | `c.submitPulse` | `requireAuth` | Any authenticated | `pulse_check` |

## Database Table Map

### Core & Auth
| Table | Purpose |
|---|---|
| `employees` | Core employee records with `user_id` FK |
| `auth_user` | MySQL user accounts (password_hash, email, active_status) |
| `auth_refresh_token` | Refresh tokens (hashed) |
| `auth_password_reset` | Password reset tokens (hashed) |
| `user_roles` | User-role assignments (MySQL authority) |
| `role_page_access` | Page-level permissions |
| `user_assignment_scope` | Scoped data access rules |

### Attendance & WFM
| Table | Purpose |
|---|---|
| `attendance_daily_record` | Daily attendance aggregates |
| `wfm_attendance_session` | Clock-in/out sessions |
| `wfm_break_log` | Break tracking |
| `attendance_regularization` | Regularization requests |
| `wfm_roster_plan` | Roster plans (draft/published) |
| `wfm_roster_assignment` | Employee-shift assignments |
| `wfm_shift_master` | Shift definitions |

### Leave
| Table | Purpose |
|---|---|
| `leave_type_master` | Leave type definitions |
| `leave_holiday_master` | Holiday calendar |
| `leave_request` | Leave applications |
| `leave_balance_ledger` | Leave balance tracking |
| `leave_approval_log` | Approval audit trail |

### Payroll
| Table | Purpose |
|---|---|
| `salary_payslip` | Generated payslip records |
| `salary_prep_line` | Payroll run detail lines |
| `tax_declaration` | Employee tax declarations |
| `salary_advance_log` | Salary advances |
| `statutory_config` | Statutory percentage config |

### Helpdesk
| Table | Purpose |
|---|---|
| `helpdesk_ticket` | Helpdesk tickets |
| `helpdesk_ticket_comment` | Ticket comments |
| `grievance` | Grievance records |

### Assets
| Table | Purpose |
|---|---|
| `asset_master` | Asset inventory |
| `asset_assignment` | Asset-employee assignments |

### Inbox / Notifications
| Table | Purpose |
|---|---|
| `work_inbox_item` | Inbox notifications |

### Goals & Performance
| Table | Purpose |
|---|---|
| `goal` | Goal definitions |
| `appraisal_cycle` | Appraisal cycles |
| `appraisal_rating` | Appraisal ratings |
| `performance_feedback_request` | Feedback requests |
| `performance_feedback_report` | Feedback reports |
| `development_plan` | Development plans |
| `employee_skill` | Employee skills |

### Org & Engagement
| Table | Purpose |
|---|---|
| `company_event_master` | Company events / holidays |
| `badge` / `employee_badge` | Badge catalog & awards |
| `kudos` | Kudos messages |
| `survey` / `survey_response` | Surveys |
| `pulse_check` | Pulse check responses |
| `employee_tier_status` | Gamification tiers |
| `employee_documents` | Employee upload documents |
| `employee_bank_detail` | Bank details (AES encrypted) |
| `employee_journey_log` | Lifecycle audit log |

## Middleware Chain

```
Incoming Request
  → requireAuth (verify JWT access token)
    → 401 if missing/invalid
    → attaches req.authUser = { id, email }
  → requireRole("admin","hr") [optional]
    → 403 if user has no required role in user_roles table
    → supports role aliases: process_manager<->manager, tl<->team_leader
  → scopeMiddleware (scoped access) [optional]
    → builds scopeWhereClause based on user_assignment_scope
    → types: all, branch, process, branch_process, lob, department, team, self
  → selfOrAdminHr(employeeIdParam) [optional]
    → allows admin/hr for any record
    → allows employee only for own record (matched via employees.user_id)
    → 403 otherwise
  → Route Handler
    → derive employee_id from authenticated session (NOT from request body!)
```

## Page Code Constants (Employee-Visible)

Employee demo role has access to:
```
PAYROLL_PAYSLIPS, TAX_DECLARATION, LMS_MY_LEARNING,
HELPDESK, WORK_INBOX, GOALS, CAREER_PLANNING, BENEFITS
```

## Demo Credentials

| Email | Password | Role |
|---|---|---|
| employee@mascallnet.com | Employee@1 | employee |

## Known Issues from Discovery

| ID | Issue | Severity |
|---|---|---|
| K1 | RBAC authority split: frontend Supabase `role_page_access` vs backend MySQL `user_roles` | HIGH |
| K2 | Hardcoded demo credentials in `src/lib/demoCreds.ts` | CRITICAL |
| K3 | Frontend demo bypass in `AuthContext.tsx` validates locally without backend | HIGH |
| K4 | Password validation mismatch: frontend 8 chars, backend 6 chars | HIGH |
| K5 | No `data-testid` attributes exist for E2E selectors | MEDIUM |
| K6 | `salary_payslip` table may be missing in some environments | HIGH |
| K7 | Railway DB IP not whitelisted (production DB access blocked) | CRITICAL |
| K8 | 25 backend test failures (customization-api, leave.routes, integrationHub) | MEDIUM |
| K9 | Frontend lint: 1343 errors (mostly `any` types) | LOW |
| K10 | Active sessions remain valid after employee deactivation (15-min token expiry) | MEDIUM |

## Employee Journey Checklist

| Journey | Component Exists | Route Exists | API Exists | Owner Filter | Tested | Issues |
|---|---|---|---|---|---|---|
| Login | Yes | /auth | POST /api/auth/login | N/A | No | K4, K2 |
| Forgot Password | Yes | /auth (modal) | POST /api/auth/forgot-password | N/A | No | K7 |
| Reset Password | Yes | /reset-password | POST /api/auth/reset-password | N/A | No | — |
| Dashboard | Yes | /dashboard | GET /api/access/me | N/A | No | K1 |
| Work Inbox | Yes | /work-inbox | /api/inbox/* | Self | No | K5 |
| Profile | Yes | /profile | /api/employees/me | Self | No | K5 |
| Attendance | Yes | /attendance | /api/wfm/attendance/* | Self | No | K5 |
| Regularization | Yes | /attendance-regularization | POST/GET /api/wfm/regularizations | Self | No | K5 |
| Leave | Yes | /leaves | /api/leave/* | Self | No | K8 |
| My Roster | Yes | /my-roster | /api/wfm/roster/assignments | Self | No | K5 |
| Payslip | Yes | /payroll/payslips | /api/payroll/payslip/:runId/:empId | Self | No | K6 |
| Tax Declaration | Yes | /payroll/tax-declaration | /api/payroll/tax-declaration/:empId/:year | Self | No | — |
| Helpdesk | Yes | /helpdesk | /api/helpdesk/tickets | Self | No | K5 |
| Assets | Yes | /assets | /api/assets-mgmt/employee/:empId | Self | No | K5 |
| Calendar | Yes | /calendar | /api/org/events | N/A | No | — |
| Notifications | Yes | /notification-preferences | /api/inbox/count | Self | No | — |
| LMS | Yes | /lms/my-learning | External SSO | Self | No | — |
| Goals | Yes | /goals | /api/goals/goals | Self | No | — |
| Performance | Yes | /performance-feedback/* | /api/performance-feedback/* | Self | No | — |
| Authorization | Yes | Role guards | requireRole | Role | No | K1 |
| Logout | Yes | Via AuthContext | POST /api/auth/logout | N/A | No | K10 |

## Resume Instruction

The next auditor must read:
1. `EMPLOYEE_E2E_RESUME.md`
2. This document (`docs/EMPLOYEE_ROLE_E2E_SPECIFICATION.md`)
3. `docs/EMPLOYEE_E2E_TEST_MATRIX.md`
4. Latest Git commits on `main`
before making any code change.
