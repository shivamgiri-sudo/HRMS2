# HRMS1 Route API Flow Matrix

Use this file as the working UAT checklist for HRMS1. UI is intentionally kept as-is unless a specific UI correction is approved.

## A. Foundation

| Step | Area | Frontend | Backend/API | Expected result |
|---|---|---|---|---|
| 1 | App shell | `src/App.tsx` | n/a | All public and protected routes load |
| 2 | Layout | `DashboardLayout` | `/api/access/me` | Sidebar reflects user role/page access |
| 3 | API client | `src/lib/hrmsApi.ts` | `VITE_HRMS_API_URL` | JWT is sent on protected calls |
| 4 | Backend mount | `backend/src/app.ts` | All `/api/*` routers | API modules are reachable |
| 5 | Build | package scripts | `npm run build`, `npm run typecheck` | Frontend/backend compile cleanly |

## B. Login and access

| Activity | Roles | Frontend | API | Storage | Result |
|---|---|---|---|---|---|
| Login | All | `/auth` | `POST /api/auth/login` | `auth_user`, `auth_refresh_token`, `employees` | Login by employee code or official email |
| Refresh token | All | `AuthContext` | `POST /api/auth/refresh` | `auth_refresh_token` | Session continues without re-login |
| Logout | All | Header profile menu | `POST /api/auth/logout` | `auth_refresh_token` | Session cleared |
| Forgot password | All | `/auth` | `POST /api/auth/forgot-password` | `auth_password_reset`, SMTP | Reset email sent |
| Reset password | All | `/reset-password` | `POST /api/auth/reset-password` | `auth_user`, `auth_password_reset` | Password changed |
| Launch readiness | Admin | Admin/API action | `GET /api/auth/launch/launch-readiness` | `employees`, `auth_user` | Missing login/email/manager/branch/process count |
| Bootstrap users | Admin | Admin/API action | `POST /api/auth/launch/bootstrap-existing-users` | `auth_user`, `employees`, `user_roles`, invite log | Existing users prepared |
| Send invites | Admin | Admin/API action | `POST /api/auth/launch/send-invites` | reset/invite logs, SMTP | Employees get password setup link |
| My access | All | `useUserRole` | `GET /api/access/me` | roles, scopes, page access | Correct role/scope/page permissions |
| My modules | All | `/modules` | `GET /api/access/pages/my-catalog` | page catalog + effective access | Non-admin users see only allowed modules |

## C. Dashboard and employee master

| Activity | Role | Frontend | API/storage | Result |
|---|---|---|---|---|
| Employee dashboard | Employee | `/dashboard` | `/api/employees/me`, leave, assets | Own workspace loads |
| HR dashboard | HR/Admin | `/dashboard` | employee stats, leave, assets | HR summary loads |
| Quick actions | Role-based | `/dashboard` | route navigation | Correct page opens |
| Employee list | HR/Manager/Admin | `/employees` | `employees` + org masters | Scoped list/search works |
| Profile | Employee | `/profile` | `/api/employees/me` | Own profile visible |
| Employee journey | HR/Manager/Employee scoped | `/employee-stat-card` | employee journey and linked module events | Full history visible |
| Document verification | HR | `/document-verification` | employee document tables | Upload/verify/reject flow works |

## D. ATS and onboarding

| Activity | Role | Frontend | API | Result |
|---|---|---|---|---|
| Candidate intake | Public/HR | `/interview-registration` | `/api/ats-full-parity/intake` | Candidate captured |
| Waiting queue | HR/Recruiter/Manager | `/ats/waiting-queue`, `/ats/walkin-queue` | `/api/ats-full-parity/queue` | Live queue visible |
| Recruiter update | Recruiter | recruiter workspace | `/api/ats-full-parity/recruiter-submission` | Stage decision saved |
| SLA job | HR/Admin | ATS command center | `/api/ats-full-parity/jobs/sla-check` | Breaches flagged |
| Candidate journey | HR/Recruiter scoped | ATS command center | `/api/ats-full-parity/journey` | Candidate timeline visible |
| Daily report | HR/Leadership | ATS command center | `/api/ats-full-parity/daily-report/snapshot` | Preview/send report works |
| BGV/doc upload | Candidate/HR | onboarding/BGV pages | `/api/ats-full-parity/bgv`, `/doc-upload-response` | Candidate documents captured |
| Hire to employee | HR | onboarding bridge | ATS + employee APIs | Selected candidate becomes employee |
| Candidate onboarding | Candidate | `/onboard-full` | onboarding APIs | ATS fields auto-populate and save section-wise |
| HR review | HR | `/ats/onboarding-requests` | onboarding APIs | HR approves/returns request |
| Offer approval | Branch head/HR | `/ats/offer-approvals` | offer APIs | Branch head action captured |

## E. Leave, attendance, WFM

| Activity | Role | Frontend | API/storage | Result |
|---|---|---|---|---|
| Leave type setup | HR/Admin | `/leave-types` | `/api/leave/types` | Master maintained |
| Leave apply | Employee | `/leaves` | `POST /api/leave/requests` | Employee can submit only own leave |
| Leave list | Employee | `/leaves` | `GET /api/leave/requests` | Employee sees only own requests |
| Leave review | Manager/HR | `/leaves` | `PATCH /api/leave/requests/:id/review` | Approve/reject captured |
| Leave balance | Employee/HR | dashboard/leaves | `GET /api/leave/balance/:employeeId` | Self/authorized balance only |
| Attendance | Employee/Manager | `/attendance` | attendance APIs | Attendance visible |
| Regularization | Employee/Manager | `/attendance-regularization` | regularization APIs | Request/approval flow works |
| Roster planning | WFM/Manager | `/wfm/roster` | roster APIs | Weekly roster created |
| Auto roster | WFM/Manager | `/wfm/auto-roster` | auto-roster APIs | Roster generated |
| My roster | Employee | `/my-roster` | roster APIs | Employee sees/acknowledges roster |
| RTA board | WFM/Manager | `/rta-board` | `/api/rta` | Live adherence visible |

## F. Payroll, KPI, engagement, exit

| Activity | Role | Frontend | API/storage | Result |
|---|---|---|---|---|
| Salary components | Payroll/Finance | `/payroll` | `/api/payroll/components` | Component master works |
| Salary assignment | Payroll/HR | `/payroll` | `/api/payroll/salary-assignments` | Existing employee salary can stay as-is |
| Payroll run | Payroll/Finance | `/payroll` | `/api/payroll/runs` | Run created/calculated |
| Payslip | Payroll/Employee | `/payroll/payslips` | payslip APIs | Payslip generated and self-view protected |
| Tax declaration | Employee/Payroll | `/payroll/tax-declaration` | tax declaration APIs | Employee declaration saved |
| UAN/statutory | HR/Payroll | statutory pages | payroll/statutory APIs | India statutory data maintained |
| F&F | HR/Payroll/Finance | `/payroll/full-final` | payroll/exit APIs | Settlement prepared |
| KPI config | Admin/Manager | `/kpi-config` | `/api/kpi/process-role` | Process-role targets set |
| KPI score | Manager/Admin | `/operations-kpi` | KPI calculation APIs | Scorecards generated |
| Goals/appraisal | Employee/Manager/HR | `/goals`, `/performance` | goal/appraisal APIs | Review events captured |
| Kudos/badges | Employee/Manager | engagement pages | engagement APIs | Recognition captured |
| Surveys | HR/Employee | `/engagement/surveys` | survey APIs | Pulse captured |
| Exit request | Employee/HR | `/exit-management` | `/api/exit` | Exit case created |
| Exit clearance | HR/IT/Finance | `/exit/command-center` | exit/workflow/inbox APIs | Clearance, assets, F&F, letters completed |

## G. Client portal and reports

| Activity | Role | Frontend | API/storage | Result |
|---|---|---|---|---|
| Client login | Client | `/portal/login` | portal APIs | Client session starts |
| Client overview | Client | `/portal` | portal APIs | Only mapped process data visible |
| Client process page | Client | `/portal/processes/:id` | portal APIs | Process dashboard visible |
| Reports | HR/Admin/Leadership | reports pages | `/api/reports` and module APIs | Exports and insights work |
| Control tower | Admin/Leadership | `/control-tower` | `/api/control-tower` | Risks, inbox and data health visible |

## Immediate smoke UAT order

1. Backend `npm run typecheck` and `npm run build`.
2. Frontend `npm run build`.
3. Login as employee, HR, manager, recruiter, WFM, payroll, admin.
4. Verify `/modules` for non-admin users.
5. Verify forgot-password email.
6. Verify employee leave apply/list/balance self-scope.
7. Verify manager leave review.
8. Verify ATS command center and recruiter scope.
9. Verify payroll self-view and payroll privileged actions.
10. Verify exit flow smoke test.
