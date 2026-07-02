# MAS-CallNet HRMS — Post-Completion Journey Audit Plan

**Date:** 2026-06-01  
**Purpose:** Structured end-to-end validation of every user role and business flow. Each section is a self-contained test session — one person, one role, real data, DB verification after every action.

---

## How to Run Each Audit

1. Log in using the demo credentials from the login page "Test Credentials by Role" panel
2. Execute every step in order
3. After each DB-write action, verify in MySQL: `SELECT ... FROM <table> ORDER BY created_at DESC LIMIT 1`
4. Mark each step ✅ Pass / ❌ Fail / ⚠️ Partial
5. Log failures in a GitHub Issue tagged `[journey-audit]`

DB connection for verification:
```bash
node -e "
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host:'192.168.10.6', port:3306, user:'shivam_user', password:'qwersdfg!@#hjk', database:'mas_hrms' });
  const [r] = await c.query('YOUR QUERY HERE');
  console.log(r);
  await c.end();
})();
"
```

---

## Journey 1: Walk-In Candidate → Offer (Public + Recruiter)

**Roles:** Public (no login), Recruiter  
**URL start:** `/interview-registration`

| Step | Action | Verify in DB |
|------|--------|-------------|
| 1 | Fill registration form — name, mobile, email, designation, process | `SELECT * FROM ats_candidate ORDER BY created_at DESC LIMIT 1` |
| 2 | Accept privacy consent | `SELECT * FROM data_consent WHERE employee_id IS NULL ORDER BY created_at DESC LIMIT 1` |
| 3 | Submit — should see confirmation page | Candidate status = 'New' |
| 4 | Login as Recruiter → `/ats/walkin-queue` | Row appears in list |
| 5 | Move candidate to Screening stage | `SELECT current_stage FROM ats_candidate WHERE id = 'X'` |
| 6 | Move to Interview | stage = 'Interview' |
| 7 | Move to Offered | stage = 'Offered', offer_status updated |
| 8 | `/ats/onboarding-bridge` — convert to employee | `SELECT * FROM employees ORDER BY created_at DESC LIMIT 1` |
| 9 | Verify new employee created with correct designation/process/branch | employee row complete |

---

## Journey 2: Employee Onboarding → Profile Complete (HR)

**Role:** HR Manager  
**Login:** `hr@mascallnet.com` / `Hr@123456`

| Step | Action | Verify in DB |
|------|--------|-------------|
| 1 | `/employees` → New Employee form | `SELECT id FROM employees ORDER BY created_at DESC LIMIT 1` |
| 2 | Assign salary structure | `SELECT * FROM employee_salary_assignment WHERE employee_id = 'X'` |
| 3 | Add bank details | `SELECT * FROM employee_bank_detail WHERE employee_id = 'X'` |
| 4 | Upload documents (ID proof, offer letter) | `SELECT * FROM employee_documents WHERE employee_id = 'X'` |
| 5 | Add emergency contact | `SELECT * FROM employee_emergency_contact WHERE employee_id = 'X'` |
| 6 | Assign leave balance for CL, SL, EL | `SELECT * FROM leave_balance_ledger WHERE employee_id = 'X'` |
| 7 | Assign to shift/roster | `SELECT * FROM wfm_roster_assignment WHERE employee_id = 'X'` |
| 8 | Verify employee appears in `/employees` directory | — |
| 9 | Assign role in `/settings/access-control` | `SELECT * FROM user_roles WHERE user_id = 'X'` |

---

## Journey 3: Daily Attendance → Leave → Payroll (Employee + Finance)

**Roles:** Employee, Finance  
**Employee login:** `employee@mascallnet.com` / `Employee@1`

| Step | Action | Verify in DB |
|------|--------|-------------|
| 1 | Employee: `/attendance` — clock in | `SELECT * FROM wfm_attendance_session WHERE employee_id = 'X' ORDER BY created_at DESC LIMIT 1` |
| 2 | Employee: clock out | session row has logout_time |
| 3 | Employee: apply leave (CL, 1 day) from `/leaves` | `SELECT * FROM leave_request WHERE employee_id = 'X' ORDER BY created_at DESC LIMIT 1` |
| 4 | Manager/HR: approve leave | status = 'approved', leave_approval_log row |
| 5 | Check leave balance deducted | `SELECT used_days FROM leave_balance_ledger WHERE employee_id = 'X' AND leave_code = 'CL'` |
| 6 | Run attendance engine: `POST /api/wfm/attendance/process {"date":"YYYY-MM-DD"}` | `SELECT * FROM attendance_daily_record WHERE employee_id = 'X' ORDER BY record_date DESC LIMIT 5` |
| 7 | Verify leave day = lwp_value 0.0 (not 1.0) | attendance_status = 'leave_approved' |
| 8 | Finance: `/payroll` → Prepare payroll run | `SELECT * FROM salary_prep_run ORDER BY created_at DESC LIMIT 1` |
| 9 | Calculate payroll | `SELECT * FROM salary_prep_line WHERE employee_id = 'X' AND run_id = 'X'` |
| 10 | Verify LWP deduction = 0 for leave day | lwp_deduction = 0 |
| 11 | Approve payroll run | status = 'approved' |
| 12 | Employee: `/payroll/payslips` → view payslip | `SELECT * FROM salary_payslip WHERE employee_id = 'X'` |
| 13 | Employee: `/payroll/tax-declaration` → submit 80C declaration | `SELECT * FROM tax_declaration WHERE employee_id = 'X'` |

---

## Journey 4: Performance Feedback Cycle (Manager + Employee + HR)

**Roles:** HR, Manager, Employee

| Step | Action | Verify in DB |
|------|--------|-------------|
| 1 | HR: `/performance-feedback/assignments` → create cycle | `SELECT * FROM performance_feedback_cycle ORDER BY created_at DESC LIMIT 1` |
| 2 | HR: launch cycle, assign reviewers | `SELECT * FROM performance_feedback_request WHERE cycle_id = 'X'` |
| 3 | Manager: open pending assignments, fill feedback form | `SELECT * FROM performance_feedback_response WHERE request_id = 'X'` |
| 4 | Employee: `/performance-feedback/my-reports` → view report | `SELECT * FROM performance_feedback_report WHERE employee_id = 'X'` |
| 5 | Employee: `/performance-feedback/development-plan` → create plan | `SELECT * FROM development_plan WHERE employee_id = 'X'` |
| 6 | Manager: set goals for employee from `/goals` | `SELECT * FROM goal WHERE employee_id = 'X'` |

---

## Journey 5: WFM Roster + RTA (WFM Analyst)

**Role:** WFM  
**Login:** `wfm@mascallnet.com` / `Workforce@1`

| Step | Action | Verify in DB |
|------|--------|-------------|
| 1 | `/wfm/roster` → upload roster CSV or create manually | `SELECT * FROM wfm_roster_assignment ORDER BY created_at DESC LIMIT 5` |
| 2 | Publish roster | publish_status = 'published' |
| 3 | Employee: `/my-roster` → view and acknowledge roster | — |
| 4 | `/rta-board` → view live adherence | `SELECT * FROM shrinkage_daily_snapshot ORDER BY snapshot_date DESC LIMIT 3` |
| 5 | `/wfm/extensions` → handle swap request | `SELECT * FROM roster_swap_request ORDER BY created_at DESC LIMIT 1` |
| 6 | Mark swap approved | status = 'approved' |

---

## Journey 6: Exit → Full & Final (Employee + HR + Finance)

**Roles:** Employee (Recruiter in demo has exit request), HR, Finance

| Step | Action | Verify in DB |
|------|--------|-------------|
| 1 | Employee: submit resignation from profile/exit page | `SELECT * FROM exit_request WHERE employee_id = 'X'` |
| 2 | Manager: review and acknowledge | status = 'manager_review' done |
| 3 | HR: accept exit, confirm last working day | status = 'accepted', last_working_day_confirmed |
| 4 | HR: run clearance checklist | `SELECT * FROM exit_clearance_checklist WHERE exit_request_id = 'X'` |
| 5 | Finance: `/payroll/full-final` → calculate F&F | `SELECT * FROM full_final_calculation WHERE exit_request_id = 'X'` |
| 6 | Verify gratuity, notice recovery, earned leave encashment | amounts non-zero if eligible |
| 7 | Mark F&F paid | status = 'paid' |
| 8 | Employee status updated to 'Exited' | `SELECT employment_status FROM employees WHERE id = 'X'` |

---

## Journey 7: ATS Dashboard + KPI + Coaching (Process Manager)

**Role:** Process Manager  
**Login:** `manager@mascallnet.com` / `Manager@1`

| Step | Action | Verify in DB |
|------|--------|-------------|
| 1 | `/management/dashboard` → loads without error | API returns data |
| 2 | `/kpi-config` → view/set KPI targets for process | `SELECT * FROM kpi_process_config WHERE process_id = 'X'` |
| 3 | `/operations-kpi` → view team KPI scores | `SELECT * FROM kpi_score WHERE employee_id = 'X'` |
| 4 | `/performance/command-center` → view team overview | — |
| 5 | `/pip-management` → create PIP for underperformer | `SELECT * FROM pip_record WHERE employee_id = 'X'` |
| 6 | `/career-planning` → view succession readiness | — |

---

## Journey 8: QA Dashboard + Compliance (QA Analyst)

**Role:** QA  
**Login:** `qa@mascallnet.com` / `Quality@1`

| Step | Action | Verify in DB |
|------|--------|-------------|
| 1 | `/quality/dashboard` → loads KPIs | — |
| 2 | View quality scores (page loads, data visible) | — |
| 3 | `/helpdesk` → raise IT ticket | `SELECT * FROM helpdesk_ticket ORDER BY created_at DESC LIMIT 1` |
| 4 | `/engagement/kudos` → send kudos to colleague | `SELECT * FROM kudos_transaction ORDER BY created_at DESC LIMIT 1` |
| 5 | `/engagement/leaderboard` → view points ranking | — |

---

## Journey 9: CEO Leadership + Client Portal (CEO + Client)

**Role:** CEO  
**Login:** `ceo@mascallnet.com` / `Ceo@12345`

| Step | Action | Verify in DB |
|------|--------|-------------|
| 1 | `/management/dashboard` → leadership view | — |
| 2 | `/advanced-reports` → headcount report | — |
| 3 | HR: `/portal-data-manager` → approve snapshot for client | `SELECT * FROM portal_snapshot_approval ORDER BY created_at DESC LIMIT 1` |
| 4 | `/portal/login` → log in as portal client | `SELECT * FROM client_user WHERE email = 'X'` |
| 5 | `/portal` → overview dashboard loads | — |
| 6 | `/portal/processes/:id` → process KPI view | — |

---

## Journey 10: Maternity Leave (Employee + HR)

**Role:** Employee → HR

| Step | Action | Verify in DB |
|------|--------|-------------|
| 1 | Employee: `/maternity-leave` → apply (delivery, 1st child) | `SELECT * FROM maternity_benefit_record ORDER BY created_at DESC LIMIT 1` |
| 2 | Verify entitled_weeks = 26 in record | entitled_weeks = 26 |
| 3 | HR: Labour Compliance → Maternity tab → Approve | status = 'approved' |
| 4 | Verify leave_request auto-created | `SELECT * FROM leave_request WHERE reason LIKE 'Maternity%' ORDER BY created_at DESC LIMIT 1` |
| 5 | Run payroll for maternity month | `SELECT lwp_deduction FROM salary_prep_line WHERE employee_id = 'X'` |
| 6 | Verify lwp_deduction = 0 for maternity employee | lwp_deduction = 0.00 ✅ |

---

## Journey 11: Attendance Rules Master (Admin)

**Role:** Admin  
**Login:** `admin@mascallnet.com` / `Admin@123`

| Step | Action | Verify in DB |
|------|--------|-------------|
| 1 | `/attendance-rules-master` → lists 2 seed rules | `SELECT COUNT(*) FROM attendance_rule_config WHERE active_status=1` = 2 |
| 2 | Create new rule: process-level, biometric, 480/240 | `SELECT * FROM attendance_rule_config ORDER BY created_at DESC LIMIT 1` |
| 3 | Simulator: select AGENT designation → shows dialler 480/240 rule | rule_name = 'Agent Dialler Rule' |
| 4 | Simulator: select new process → shows new rule (higher specificity) | correct rule returned |
| 5 | Deactivate the new rule | active_status = 0 |
| 6 | Simulator again → falls back to AGENT dialler rule | correct |

---

## Audit Completion Checklist

Before signing off each journey:
- [ ] All DB writes verified directly in MySQL
- [ ] No `console.error` in browser devtools for the journey
- [ ] All pages load within 3s on local network
- [ ] Role boundaries enforced (try accessing a page from wrong role — should get 403/redirect)
- [ ] Mobile view (375px) renders correctly for key pages

## Known Gaps (Phases 3/4/6/7 — awaiting decisions)

These journeys are partially functional but will be improved after decisions are made:

| Gap | Phase | Blocked on |
|-----|-------|-----------|
| Backend authorization scope enforcement (process/branch isolation) | Phase 3 | Role matrix approval |
| Public candidate registration uses authenticated endpoints | Phase 4 | Public intake API design |
| Frontend page gates (Gate component seeding) | Phase 6 | Phase 2 completion + page code seed |
| DPDP consent text, retention scheduler | Phase 7 | Legal counsel input |
