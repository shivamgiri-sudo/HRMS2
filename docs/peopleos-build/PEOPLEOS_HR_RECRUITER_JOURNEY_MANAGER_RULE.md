# PeopleOS HR Recruiter Journey and Mandatory Manager Rule

**Date:** 30-May-2026  
**Status:** Mandatory product memory and developer blueprint.  
**Architecture:** React + TypeScript frontend, Node.js + Express backend, MySQL `mas_hrms`.

---

## 1. Mandatory Reporting Manager Rule

Every internal Employee entity must have a mapped reporting / mandate manager, except the CEO / top organisation head.

```text
CEO / Top Organisation Head = no reporting manager required
All other internal employees = reporting manager mandatory
```

This applies to:

```text
Agent / Analyst
HR Recruiter
HR Admin
TL
AM
Process Manager
Branch Head
QA
Trainer
WFM / RTM
SME
Payroll / Finance
Admin / IT / Assets
Compliance / Auditor
Leadership users below CEO
Support staff
```

External client users are not internal MAS employees unless separately employed by MAS Callnet.

---

## 2. User to Employee Mapping Rule

Every internal login user must map to an Employee Page / Employee Stat Card.

```text
Auth/Login User
-> Internal User Record
-> Employee ID
-> Employee Page / Stat Card
-> Designation
-> System Role(s)
-> Reporting Manager
-> Branch / Process / LOB / Cost Centre Scope
```

Designation and system role are separate.

```text
Designation = business title, for example HR Recruiter
System role = application access, for example recruiter or hr_recruiter
```

---

## 3. Manager Validation Rules

While creating or updating any employee:

```text
If designation is CEO / top org head -> reporting manager can be blank.
For all other designations -> reporting manager is mandatory.
Reporting manager must be an active employee.
Reporting manager must not be the same employee.
Reporting chain must not create a loop.
Reporting manager must be within allowed branch/process/department scope or have cross-scope approval.
Manager changes must create employee_assignment_history and employee_journey_event.
```

If reporting manager is missing for a non-CEO employee:

```text
Do not activate employee profile fully.
Show HR/Admin blocker: Reporting manager is mandatory.
```

---

## 4. HR Recruiter as Employee Entity

HR Recruiter is an internal employee and must have:

```text
Employee ID
Employee Page / Stat Card
Current designation = HR Recruiter / Recruiter
System role = recruiter / hr_recruiter as configured
Branch mapping
Recruitment process/role scope
Reporting manager
HR team mapping
Candidate assignment scope
Productivity dashboard
Full employee journey timeline
```

---

## 5. HR Recruiter Mindmap

```text
HR Recruiter
├─ Employee Identity
│  ├─ Employee ID
│  ├─ Current designation
│  ├─ System role
│  ├─ Reporting manager
│  ├─ Branch / HR team
│  └─ Access scope
├─ Candidate Operations
│  ├─ Assigned candidate queue
│  ├─ Walk-in registration support
│  ├─ Duplicate / reprocess check visibility
│  ├─ Screening
│  ├─ Follow-up
│  ├─ Interview coordination
│  ├─ Selection update
│  ├─ Rejection / no-show update
│  └─ Candidate communication
├─ Joining Pipeline
│  ├─ Offer request follow-up
│  ├─ Pre-joining pending follow-up
│  ├─ Document pending follow-up
│  ├─ Joining confirmation
│  └─ Joined conversion visibility
├─ Productivity
│  ├─ Assigned candidates
│  ├─ Attempted candidates
│  ├─ Walk-ins handled
│  ├─ Screened
│  ├─ Selected
│  ├─ Joined
│  ├─ Dropout / no-show
│  └─ Source conversion
├─ Escalations
│  ├─ Candidate not reachable
│  ├─ Candidate document pending
│  ├─ Candidate offer not accepted
│  ├─ SLA breach
│  └─ Duplicate/reprocess issue
└─ Employee Self-Service
   ├─ Own profile
   ├─ Own roster/attendance/leave
   ├─ Own payslip where permitted
   ├─ Own performance/productivity
   └─ Own resignation/exit flow
```

---

## 6. HR Recruiter End-to-End Journey as an Employee

```text
HR Recruiter hired / converted to employee
-> Employee ID generated
-> Employee Page created
-> Designation assigned as HR Recruiter
-> System role assigned as recruiter/hr_recruiter
-> Reporting manager mapped
-> Branch and recruitment scope assigned
-> Candidate queue access enabled
-> Recruiter productivity starts tracking
-> Daily recruitment operations performed
-> Performance and incentive inputs generated where configured
-> HR recruiter can apply leave / view roster / attendance as employee
-> HR recruiter can resign / exit like any employee
-> Employee history preserved after exit
```

---

## 7. HR Recruiter Candidate Handling Journey

```text
Candidate appears in recruiter queue
-> Recruiter opens candidate detail
-> Checks duplicate/reprocess status
-> Performs screening
-> Updates screening result
-> Coordinates assessment/interview
-> Updates candidate stage
-> If selected: triggers offer/pre-joining follow-up
-> If not selected: captures stage and reason
-> Sends or triggers communication where configured
-> Candidate outcome updates recruiter productivity
```

---

## 8. HR Recruiter Scenario Rules

| Scenario | What HR Recruiter does next |
|---|---|
| New walk-in assigned | Open candidate detail, validate basic profile and start screening. |
| Duplicate/reprocess alert appears | Follow duplicate/reprocess decision rule; do not bypass. |
| Candidate passes screening | Move to assessment/interview as per process rule. |
| Candidate fails screening | Capture rejection stage, reason and remarks where required. |
| Candidate selected | Trigger offer/pre-joining follow-up and notify HR owner. |
| Candidate not reachable | Mark follow-up attempt and schedule next attempt or close by rule. |
| Candidate document pending | Follow up with candidate; document approval remains HR/compliance responsibility. |
| Candidate offer pending | Follow up; escalate if SLA breached. |
| Candidate no-show | Mark no-show, reschedule if allowed or close by rule. |
| Candidate joined | Recruiter productivity receives joined credit where mapping rule allows. |
| Candidate drops after selection | Capture dropout reason and update pipeline. |
| Recruiter profile missing manager | HR/Admin must map reporting manager before full activation. |
| Recruiter changes designation | Create assignment history and journey event. |
| Recruiter resigns | Follow normal employee resignation, clearance and exit workflow. |

---

## 9. HR Recruiter Page Requirements

HR Recruiter should have both:

```text
Employee Page / Stat Card
Recruiter Workbench / Dashboard
```

### Employee Page must show

```text
Employee ID
Name
Current designation
Designation history
System role(s)
Reporting manager
Branch / HR team
Recruitment scope
Joining date
Attendance / leave / roster as employee
Payslip/self-service access as permitted
Performance/productivity summary
Journey timeline
Exit history if applicable
```

### Recruiter Dashboard must show

```text
Assigned candidates
Pending follow-ups
Screening queue
Interview coordination queue
Selected candidates
Offer/pre-joining pending candidates
Document pending candidates
Joined candidates
Not selected candidates
No-show/dropout candidates
Productivity KPIs
SLA breaches
```

---

## 10. HR Recruiter Data Access Rules

HR Recruiter can see:

```text
Candidates assigned to recruiter
Candidates within mapped branch/process scope where allowed
Candidate contact/profile fields needed for recruitment
Candidate status and follow-up history
Own productivity dashboard
Own employee page/self-service data
```

HR Recruiter should not see by default:

```text
Full payroll of other employees
Sensitive employee documents outside recruitment need
Confidential HR cases
Client Portal internal controls
DPDP breach records
System-wide admin settings
```

---

## 11. Required Tables / Existing Tables to Use or Extend

Use/extend:

```sql
employees
user_roles
user_assignment_scope
employee_assignment_history
employee_journey_event
employee_stat_snapshot
ats_candidate
ats_stage_history
recruiter_productivity
candidate_followup_log
candidate_communication_log
sensitive_action_log
```

Suggested if missing:

```sql
employee_reporting_manager_history
recruiter_scope_assignment
recruiter_candidate_assignment
recruiter_productivity_snapshot
```

---

## 12. Build Acceptance Criteria

This requirement is complete only when:

1. Every internal employee except CEO requires a reporting manager.
2. HR Recruiter has an Employee Page / Stat Card.
3. HR Recruiter has designation and system role visible separately.
4. HR Recruiter reporting manager is visible and validated.
5. HR Recruiter candidate queue is scoped by branch/process/assignment.
6. HR Recruiter can update candidate screening/follow-up outcomes within permission.
7. Selected and not-selected candidate outcomes update recruiter productivity.
8. HR Recruiter has normal employee self-service journey: roster, attendance, leave, payslip where permitted, resignation and exit.
9. Manager changes create employee assignment history and journey event.
10. Backend enforces role/scope and sensitive data access.
11. Current UI/layout is preserved.

---

## 13. Codex / Claude Instruction

```text
Every internal employee must have a mapped reporting/mandate manager except CEO/top organisation head. HR Recruiter is also an Employee entity, not just a user role. Build HR Recruiter with Employee Page/Stat Card, designation, system role, reporting manager, branch/process recruitment scope, recruiter dashboard, candidate queue, follow-up workflow, selected/not-selected outcome handling, productivity metrics, and normal employee self-service journey. Preserve current UI/layout and enforce backend role/scope/data masking.
```
