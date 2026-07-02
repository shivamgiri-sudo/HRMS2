# ROUTE / API / DB / UI MATRIX
**Date:** 2026-06-12

## Frontend Route → Backend API → DB Table Mapping

| Frontend Route | Page Component | API Endpoint | Backend Module | Primary Tables |
|----------------|---------------|-------------|---------------|----------------|
| `/` | `Index` | — | — | — |
| `/login` | `Auth` | `POST /api/auth/login` | `auth/auth.routes.ts` | `auth_user`, `employees`, `user_roles` |
| `/reset-password` | `ResetPassword` | `POST /api/auth/reset-password` | `auth/auth.routes.ts` | `auth_password_reset` |
| `/dashboard` | `Index` | `GET /api/employees/stats` | `employees/employee.routes.ts` | `employees` |
| `/employees` | `Employees` | `GET /api/employees` | `employees/employee.routes.ts` | `employees`, `branch_master`, `department_master`, `designation_master` |
| `/attendance` | `Attendance` | `GET /api/wfm/attendance` | `wfm/wfm.routes.ts` | `wfm_attendance_session`, `attendance_daily_record` |
| `/leaves` | `Leaves` | `GET /api/leave/requests` | `leave/leave.routes.ts` | `leave_request`, `leave_type_master`, `leave_balance_ledger` |
| `/payroll` | `Payroll` | `GET /api/payroll/runs` | `payroll/payroll.routes.ts` | `salary_prep_run`, `salary_prep_line` |
| `/payslip-center` | `NativePayslipCenter` | `GET /api/payroll/payslips` | `payroll/payroll.routes.ts` | `salary_payslip`, `salary_prep_line` |
| `/ats/dashboard` | `NativeATSDashboardReplica` | `GET /api/ats/stats` | `ats/ats.routes.ts` | `ats_candidate`, `ats_candidate_stage_log` |
| `/ats/candidates` | `NativeATSCandidateMaster` | `GET /api/ats/candidates` | `ats/ats.routes.ts` | `ats_candidate`, `ats_sourcing_channel` |
| `/ats/recruiter` | `NativeATSRecruiterDashboard` | `GET /api/ats/recruiter/my-candidates` | `ats/ats.routes.ts` | `ats_candidate`, `ats_recruiter` |
| `/ats/walkin-queue` | `NativeWalkinQueue` | `GET /api/ats/walkin-queue` | `ats/ats.routes.ts` | `ats_candidate`, `ats_queue_token` |
| `/wfm/roster` | `NativeWFMRoster` | `GET /api/wfm/roster` | `wfm/roster.routes.ts` | `wfm_roster_assignment`, `wfm_shift_master` |
| `/kpi/configuration` | `NativeKPIConfiguration` | `GET /api/kpi/metrics` | `kpi/kpi.routes.ts` | `kpi_metric_master`, `kpi_template` |
| `/exit` | `NativeExitManagement` | `GET /api/exit/requests` | `exit/exit.routes.ts` | `exit_request`, `exit_approval_log` |
| `/portal/login` | `PortalLogin` | `POST /api/portal/otp-send` | `portal/portal.routes.ts` | `portal_otp`, `client_user` |
| `/access-control` | `UnifiedAccessControl` | `GET /api/access/roles` | `access/access.routes.ts` | `workforce_role_catalog`, `user_roles`, `user_assignment_scope` |
| `/integration-hub` | `NativeIntegrationHub` | `GET /api/integration-hub/configs` | `integration-hub/integration.routes.ts` | `integration_config`, `integration_connector_run` |
| `/payroll-compliance` | `NativeStatutoryCompliance` | `GET /api/payroll-compliance/registers` | `payroll-compliance/payrollCompliance.routes.ts` | `salary_prep_line`, `employee_uan`, `pt_slab_master` |
| `/lms` | `NativeLMSIntegration` | `GET /api/lms/sync-status` | `lms/lms.routes.ts` | `lms_sync_audit_log`, `lms_employee_mapping` |
| `/performance-feedback` | `NativePerformanceFeedbackMyReports` | `GET /api/performance-feedback/cycles` | `performance-feedback/` | `performance_feedback_cycle`, `performance_feedback_report` |
| `/engagement` | `NativeEngagement` | `GET /api/engagement/summary` | `engagement/engagement.routes.ts` | `gamification_points_ledger`, `kudos_transaction` |

---

## Known API Shape Issues

| Issue | Status |
|-------|--------|
| `GET /api/employees/stats` returns `active_employees` count — was broken due to `employment_status = 'Active'` bug | ✅ Fixed |
| `GET /api/payroll/runs` → calculate → `branch_master.state_code` column bug | ✅ Fixed |
| PT register `ORDER BY b.state_code` → wrong column | ✅ Fixed |

---

## Feature Flags (`.env.local`)

All set to `backend` — all data comes from Express backend, no Supabase fallback active.

| Flag | Value |
|------|-------|
| `VITE_HRMS_EMPLOYEES` | `backend` |
| `VITE_HRMS_ATTENDANCE` | `backend` |
| `VITE_HRMS_WFM` | `backend` |
| `VITE_HRMS_LEAVE` | `backend` |
| `VITE_HRMS_PAYROLL` | `backend` |
| `VITE_HRMS_ATS` | `backend` |
| `VITE_HRMS_INTEGRATION` | `backend` |
| `VITE_HRMS_KPI` | `backend` |
