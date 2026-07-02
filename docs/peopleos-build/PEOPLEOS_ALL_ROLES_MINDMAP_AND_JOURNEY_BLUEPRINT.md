# PeopleOS Complete Role Mindmap, Journey, Manager Mapping and Scenario Blueprint

**Status:** Approved role blueprint  
**Purpose:** Developer-ready role blueprint for PeopleOS  
**Architecture:** React + TypeScript frontend, Node.js + Express backend, MySQL `mas_hrms`  
**Design rule:** Preserve current PeopleOS UI/layout. Do not rewrite existing layout or theme.

---

## 1. Global Identity and Manager Rule

### 1.1 Every internal user is an Employee entity

Every internal person inside PeopleOS must have an Employee record and Employee Page / Stat Card.

This includes:

```text
CEO / Leadership
Super Admin
HR Admin
HR Recruiter
Branch Head
Process Manager
Assistant Manager
Team Leader
Agent / Analyst
QA / T&Q
Trainer
WFM / RTM
SME
Payroll / Finance
Admin / IT / Asset user
Compliance / Auditor
Support Staff
```

External client users are **not internal employees** unless they are actually employed by MAS Callnet.

---

### 1.2 Mandatory manager rule

```text
CEO / Top Organisation Head = reporting manager not required
Every other internal employee = reporting manager mandatory
```

Before joining, a candidate does not have an employee reporting manager. They must have a mapped candidate owner:

```text
Candidate before joining = Recruiter / HR Owner mandatory
Candidate after employee conversion = Reporting Manager mandatory
```

---

### 1.3 Employee Page is mandatory

Every internal employee must have:

```text
Employee ID
Employee Page / Employee Stat Card
Current designation
Designation history
System role
Reporting manager
Branch / Client / Process / LOB / Cost Centre mapping
Manager / TL / AM / PM hierarchy
Employee journey timeline
```

Important distinction:

```text
Designation = business title
Example: HR Recruiter, Analyst, TL, AM, QA, Trainer

System Role = application access role
Example: recruiter, employee, tl, process_manager, hr_admin
```

Both must be visible separately.

---

### 1.4 Manager validation rules

While creating or updating an employee:

```text
If designation is CEO / Top Organisation Head:
→ reporting manager can be blank

For all other designations:
→ reporting manager is mandatory
```

Validation:

```text
Reporting manager must be an active employee.
Reporting manager cannot be the same employee.
Reporting hierarchy must not create a loop.
Reporting manager must be within valid branch/process/department scope or have approved cross-scope mapping.
Manager change must create employee_assignment_history.
Manager change must create employee_journey_event.
```

If missing:

```text
Do not fully activate the employee profile.
Show blocker: Reporting manager is mandatory.
```

---

## 2. Role List Covered

```text
1. CEO / Top Organisation Head
2. Super Admin
3. HR Admin
4. HR Recruiter
5. Candidate / Pre-Joining User
6. Employee / Agent / Analyst
7. Team Leader
8. Assistant Manager
9. Process Manager
10. Branch Head
11. WFM / RTM
12. QA / T&Q
13. Trainer
14. Payroll / Finance
15. Admin / IT / Asset User
16. Compliance / Auditor
17. Client User
18. SME / Process Support
```

---

# 3. CEO / Top Organisation Head

## 3.1 Mindmap

```text
CEO
├─ Leadership Dashboard
│  ├─ Company health
│  ├─ Branch performance
│  ├─ Process performance
│  ├─ LOB / cost centre view
│  ├─ Hiring pipeline
│  ├─ Training pipeline
│  ├─ Staffing shortage
│  ├─ Roster risk
│  ├─ Attendance / shrinkage
│  ├─ Attrition
│  ├─ Quality risk
│  ├─ Payroll / cost summary
│  ├─ Incentive summary
│  └─ DPDP / compliance risk
├─ Governance
│  ├─ Client SLA / SOW health
│  ├─ Action plan tracking
│  ├─ Process Manager accountability
│  ├─ HR/WFM/Training accountability
│  └─ Audit exceptions
└─ Controlled Drilldown
   ├─ Branch
   ├─ Process
   ├─ LOB
   ├─ Cost centre
   ├─ Team
   └─ Employee drilldown where permitted
```

## 3.2 Journey

```text
CEO logs in
→ Sees organisation-wide dashboard
→ Reviews exception/risk cards
→ Drills into branch/process/LOB/cost centre
→ Assigns action to owner
→ Tracks closure
→ Reviews compliance and client risk
```

## 3.3 Scenarios

| Scenario | What happens next |
|---|---|
| Process HC shortage is high | CEO drills down to shortage reason and asks HR/WFM/PM for action. |
| Attrition spike | CEO reviews branch/process/tenure/manager trend and asks HR/PM for action plan. |
| Client SLA risk | CEO checks client governance action and Process Manager ownership. |
| Payroll cost anomaly | CEO sees summary only; payroll details remain restricted. |
| DPDP breach incident | CEO sees incident status; compliance/legal owner handles formal workflow. |

## 3.4 Access and compliance

```text
CEO does not require reporting manager.
CEO can see aggregate and leadership drilldowns.
Highly sensitive payroll/document/DPDP details should still follow masking/approval rules.
Client PII and employee sensitive data should be controlled.
All leadership exports must be logged.
```

---

# 4. Super Admin

## 4.1 Mindmap

```text
Super Admin
├─ Platform Setup
│  ├─ Branch Master
│  ├─ Client Master
│  ├─ Process Master
│  ├─ LOB Master
│  ├─ Cost Centre Master
│  ├─ Department Master
│  ├─ Designation Master
│  └─ Grade/Band Master
├─ User & Access
│  ├─ User Management
│  ├─ Role & Permission Master
│  ├─ Page Access Master
│  ├─ User Scope Mapping
│  ├─ Password reset
│  ├─ Account lock/unlock
│  └─ Temporary access
├─ System Governance
│  ├─ Approval Matrix
│  ├─ Audit Logs
│  ├─ Integration Connectors
│  ├─ Manual Upload Mapping
│  ├─ System Health
│  └─ Environment readiness
└─ Compliance Support
   ├─ DPDP controls
   ├─ Export approval
   ├─ Breach register support
   └─ Retention policies
```

## 4.2 Journey

```text
Super Admin created as employee
→ Employee Page created
→ Designation assigned
→ System role super_admin assigned
→ Reporting manager mapped unless Super Admin is also CEO
→ Platform access enabled
→ Maintains masters, roles, scopes and system config
```

## 4.3 Scenarios

| Scenario | What happens next |
|---|---|
| New branch required | Create Branch Master in Draft, assign owners, policies, process mappings, then activate. |
| User cannot access page | Check role, page access, backend scope, employee status, account lock. |
| User needs password reset | Trigger admin reset, force password change, write audit log. |
| Role changed | Update system role, audit action, reflect in Employee Page. |
| Master record linked to data | Do not remove; deactivate/close/archive instead. |
| External connector added | Configure connector without storing secrets in code/Git. |
| Sensitive export requested | Route through export approval. |

## 4.4 Access and compliance

```text
Must have full audit.
Cannot bypass DPDP and payroll controls casually.
No secrets in Git.
No production SQL/deployment without approval.
All account-control actions audited.
```

---

# 5. HR Admin

## 5.1 Mindmap

```text
HR Admin
├─ Candidate to Employee
│  ├─ Selected candidate review
│  ├─ Offer status
│  ├─ Pre-joining submission
│  ├─ Document verification
│  ├─ BGV status
│  ├─ Joining approval
│  ├─ Employee ID generation
│  └─ Employee creation
├─ Employee Master
│  ├─ Employee profile
│  ├─ Designation assignment
│  ├─ Manager mapping
│  ├─ Branch/process/LOB/cost-centre mapping
│  ├─ Employee document status
│  └─ Employee Stat Card
├─ Lifecycle
│  ├─ Confirmation
│  ├─ Transfer
│  ├─ Promotion
│  ├─ Salary revision input
│  ├─ PIP / warning
│  ├─ Resignation
│  └─ Exit closure
└─ HR Compliance
   ├─ Consent
   ├─ Declarations
   ├─ Data corrections
   ├─ Document checklist
   └─ Employee records
```

## 5.2 Journey

```text
HR Admin hired/created as employee
→ Employee ID generated
→ Employee Page created
→ Designation = HR Admin
→ System role = hr_admin
→ Reporting manager mapped
→ Branch/process HR scope assigned
→ HR Admin starts candidate conversion and employee lifecycle work
```

## 5.3 Scenarios

| Scenario | What happens next |
|---|---|
| Selected candidate pending pre-joining | HR sends reminder and recruiter follow-up. |
| Candidate document pending | HR blocks conversion until document accepted or approved override exists. |
| Employee ID rule missing | HR cannot convert candidate; must configure Employee ID rule. |
| Reporting manager missing for new employee | Employee activation blocked until mapped. |
| Employee designation changes | Create assignment history and journey event. |
| Employee resigns | Start resignation, clearance and F&F workflow. |
| Employee data correction requested | Validate and update with audit. |

## 5.4 Access and compliance

```text
HR can access employee lifecycle data based on role/scope.
Document access must be audited.
Payroll details only where permitted.
Sensitive fields masked for non-authorized HR views.
```

---

# 6. HR Recruiter

## 6.1 Mindmap

```text
HR Recruiter
├─ Employee Identity
│  ├─ Employee ID
│  ├─ Designation = HR Recruiter / Recruiter
│  ├─ System role = recruiter / hr_recruiter
│  ├─ Reporting manager
│  ├─ Branch / HR team
│  └─ Recruitment scope
├─ Candidate Operations
│  ├─ Assigned candidate queue
│  ├─ Walk-in registration support
│  ├─ Duplicate / reprocess visibility
│  ├─ Screening
│  ├─ Follow-up
│  ├─ Interview coordination
│  ├─ Selection update
│  ├─ Rejection / no-show update
│  └─ Candidate communication
├─ Joining Pipeline
│  ├─ Offer pending follow-up
│  ├─ Pre-joining pending follow-up
│  ├─ Document pending follow-up
│  ├─ Joining confirmation
│  └─ Joined conversion visibility
├─ Productivity
│  ├─ Assigned candidates
│  ├─ Attempts
│  ├─ Walk-ins handled
│  ├─ Screened
│  ├─ Selected
│  ├─ Joined
│  ├─ Dropout / no-show
│  └─ Source conversion
└─ Employee Self-Service
   ├─ Own profile
   ├─ Own roster
   ├─ Own attendance
   ├─ Own leave
   ├─ Own payslip where permitted
   └─ Own resignation / exit
```

## 6.2 Journey as employee

```text
Recruiter joins
→ Employee ID generated
→ Employee Page created
→ Designation HR Recruiter assigned
→ System role recruiter assigned
→ Reporting manager mapped
→ Branch/recruitment scope mapped
→ Candidate queue enabled
→ Productivity starts tracking
→ Recruiter works candidate lifecycle
→ Recruiter can use normal employee self-service
→ If recruiter resigns, normal exit/F&F workflow applies
```

## 6.3 Candidate handling journey

```text
Candidate appears in queue
→ Recruiter opens candidate
→ Checks duplicate/reprocess status
→ Performs screening
→ Updates result
→ Coordinates assessment/interview
→ If selected: triggers offer/pre-joining follow-up
→ If not selected: captures stage and reason
→ Communication triggered
→ Productivity updated
```

## 6.4 Scenarios

| Scenario | What happens next |
|---|---|
| New walk-in assigned | Recruiter validates profile and starts screening. |
| Duplicate/reprocess alert | Follow duplicate/reprocess rule; do not bypass. |
| Candidate passes screening | Move to assessment/interview as per process rule. |
| Candidate fails screening | Capture stage, reason and remarks. |
| Candidate selected | Trigger offer/pre-joining follow-up. |
| Candidate not reachable | Log attempt and schedule next follow-up or close by rule. |
| Candidate no-show | Mark no-show, reschedule if allowed. |
| Candidate joins | Joined credit goes to recruiter where productivity rule allows. |
| Recruiter missing manager | HR/Admin must map manager before activation. |

## 6.5 Access and compliance

```text
Recruiter sees assigned candidates and scoped candidate records only.
Recruiter does not see full payroll, confidential HR cases, DPDP breach records or system-wide settings.
Candidate contact access must be scoped and auditable.
```

---

# 7. Candidate / Pre-Joining User

## 7.1 Mindmap

```text
Candidate / Pre-Joining User
├─ Walk-in / Application
│  ├─ Registration
│  ├─ Candidate ID
│  ├─ Duplicate / reprocess check
│  └─ Queue allocation
├─ Selection Flow
│  ├─ Screening
│  ├─ Assessment
│  ├─ Interview
│  ├─ Selection / rejection
│  └─ Communication
├─ Pre-Joining
│  ├─ Identity validation
│  ├─ ATS autofill
│  ├─ Resume upload/photo parsing
│  ├─ Candidate validation
│  ├─ Document upload
│  ├─ Offer acknowledgement
│  └─ Declarations / consent
└─ Outcome
   ├─ Selected and converted to employee
   └─ Not selected and candidate journey closed
```

## 7.2 Journey

```text
Candidate arrives/applies
→ Candidate ID created
→ Duplicate/reprocess check
→ Screening/assessment/interview
→ Final decision
   → selected: pre-joining and HR conversion
   → not selected: reason, communication, cooling/reprocess
```

## 7.3 Scenarios

| Scenario | What happens next |
|---|---|
| Candidate not selected | No employee ID, no Employee Page, ATS-only history. |
| Candidate selected | Offer and pre-joining triggered. |
| Resume parsing wrong | Candidate corrects; corrected value goes to HR review. |
| Mandatory document pending | Conversion waits unless approved override. |
| Offer declined | No employee conversion. |
| Candidate becomes employee | Employee ID and Employee Page created. |

## 7.4 Access and compliance

```text
Candidate sees own data only.
Privacy notice required.
Resume parsing consent required.
Document upload access audited.
```

---

# 8. Employee / Agent / Analyst

## 8.1 Mindmap

```text
Agent / Analyst
├─ Employee Identity
│  ├─ Employee ID
│  ├─ Designation = Agent / Analyst
│  ├─ System role = employee
│  ├─ Reporting manager / TL
│  ├─ Branch
│  ├─ Process
│  ├─ LOB
│  └─ Cost Centre
├─ Self-Service
│  ├─ Profile
│  ├─ Documents
│  ├─ Roster
│  ├─ Week-off preference
│  ├─ Leave
│  ├─ Attendance
│  ├─ Payslip
│  ├─ Helpdesk
│  └─ Resignation
├─ Work Journey
│  ├─ LMS / training
│  ├─ Certification
│  ├─ Deployment
│  ├─ Daily attendance
│  ├─ Quality audits
│  ├─ Coaching
│  ├─ Performance
│  └─ Incentive where applicable
└─ Exit
   ├─ Resignation
   ├─ Clearance
   ├─ F&F
   └─ Relieving
```

## 8.2 Journey

```text
Candidate converted to employee
→ Employee Page created
→ Designation assigned
→ Reporting manager/TL mapped
→ Training/LMS
→ Certification
→ Roster eligibility
→ Attendance/payroll
→ Performance/quality/coaching
→ Resignation/exit if applicable
```

## 8.3 Scenarios

| Scenario | What happens next |
|---|---|
| Week-off preference submitted | System considers but does not guarantee. |
| Preference rejected | Employee sees reason and final roster. |
| Leave pending | Employee remains roster-available. |
| Leave approved | Employee excluded from roster for approved period. |
| Attendance mismatch | Employee raises regularization. |
| Quality defect | Coaching/TNI/PIP may be triggered. |
| Resignation | Normal exit workflow starts. |

## 8.4 Access and compliance

```text
Employee sees own data.
Payslip private.
Documents private.
Quality/performance visible as permitted.
Client Portal never sees individual employee profile by default.
```

---

# 9. Team Leader

## 9.1 Mindmap

```text
Team Leader
├─ Employee Identity
│  ├─ Employee ID
│  ├─ Designation = Team Leader
│  ├─ System role = tl
│  ├─ Reporting manager = AM / Process Manager
│  └─ Team mapping
├─ Team Operations
│  ├─ Team roster
│  ├─ Attendance follow-up
│  ├─ No-show / late actions
│  ├─ Break adherence
│  ├─ Leave visibility
│  ├─ Week-off rejection visibility
│  └─ Roster exception follow-up
├─ Performance
│  ├─ Team KPI
│  ├─ Agent productivity
│  ├─ Coaching
│  ├─ TNI
│  ├─ PIP input
│  └─ Incentive input where configured
└─ Employee Self-Service
   ├─ Own roster
   ├─ Own leave
   ├─ Own attendance
   ├─ Own payslip
   └─ Own exit
```

## 9.2 Journey

```text
TL created as employee
→ Designation TL assigned
→ System role tl assigned
→ Reporting manager mapped
→ Team/agent mapping assigned
→ TL monitors team operations and performance
```

## 9.3 Scenarios

| Scenario | What happens next |
|---|---|
| Agent no-show | TL contacts agent, logs reason, escalates if needed. |
| Agent preference rejected | TL sees reason; cannot manually change roster without WFM/PM. |
| Team shortage | TL raises coverage issue to AM/WFM. |
| Quality defect in team | TL ensures coaching/CAPA closure. |
| Repeated late marks | TL initiates coaching/action. |

## 9.4 Access and compliance

```text
TL sees mapped team only.
No broad payroll access.
Sensitive documents masked.
All action closures auditable.
```

---

# 10. Assistant Manager

## 10.1 Mindmap

```text
Assistant Manager
├─ Employee Identity
│  ├─ Employee ID
│  ├─ Designation = Assistant Manager
│  ├─ System role = assistant_manager / am
│  ├─ Reporting manager = Process Manager / Branch Head
│  └─ Process/team scope
├─ Team Governance
│  ├─ TL accountability
│  ├─ Attendance actions
│  ├─ Roster exceptions
│  ├─ Team coverage
│  ├─ Coaching closure
│  └─ Escalations
├─ Performance Support
│  ├─ KPI review
│  ├─ Quality risk
│  ├─ Productivity risk
│  ├─ PIP review
│  └─ Incentive review where configured
└─ Own Employee Self-Service
```

## 10.2 Scenarios

| Scenario | What happens next |
|---|---|
| TL action overdue | AM follows up and escalates to PM if unresolved. |
| Multiple no-shows | AM reviews pattern and triggers HR/PM action. |
| Roster exception assigned | AM coordinates closure with TL/WFM. |
| Quality risk | AM ensures coaching and improvement plan. |

## 10.3 Access and compliance

```text
AM sees scoped process/team data.
No unnecessary payroll/document visibility.
Approvals and actions audited.
```

---

# 11. Process Manager

## 11.1 Mindmap

```text
Process Manager
├─ Employee Identity
│  ├─ Employee ID
│  ├─ Designation = Process Manager
│  ├─ System role = process_manager
│  ├─ Reporting manager = Branch Head / Leadership
│  └─ Process / LOB / Cost Centre scope
├─ Delivery Governance
│  ├─ Active HC
│  ├─ Required HC
│  ├─ Shortage / surplus
│  ├─ Training pipeline
│  ├─ Certification readiness
│  └─ Deployment readiness
├─ Roster Governance
│  ├─ Draft roster review
│  ├─ Preference rejection summary
│  ├─ Coverage gaps
│  ├─ Publish approval
│  └─ Post-publish changes
├─ Performance
│  ├─ KPI
│  ├─ Quality
│  ├─ Productivity
│  ├─ Coaching / PIP
│  └─ Incentive inputs
└─ Client Governance
   ├─ SLA / SOW
   ├─ Client requests
   ├─ MOM
   └─ Action plans
```

## 11.2 Scenarios

| Scenario | What happens next |
|---|---|
| HC shortage | PM reviews shortage reason and assigns HR/WFM/training action. |
| Roster draft has gaps | PM reviews and approves/rejects plan. |
| Many preferences rejected | PM checks fairness and operation need. |
| SLA risk | PM creates client action plan. |
| KPI below target | PM assigns TL/AM action. |

## 11.3 Access and compliance

```text
PM sees mapped process/LOB/cost centre data.
Client publishing must be aggregate only.
Payroll and sensitive employee data masked unless permission allows.
```

---

# 12. Branch Head

## 12.1 Mindmap

```text
Branch Head
├─ Employee Identity
│  ├─ Employee ID
│  ├─ Designation = Branch Head
│  ├─ System role = branch_head
│  ├─ Reporting manager = CEO / Leadership
│  └─ Branch scope
├─ Branch Governance
│  ├─ Branch HC
│  ├─ Branch hiring
│  ├─ Branch training readiness
│  ├─ Branch roster/attendance
│  ├─ Branch payroll readiness
│  ├─ Branch attrition
│  ├─ Branch compliance
│  └─ Branch client/process performance
└─ Escalation
   ├─ Process Manager accountability
   ├─ HR/WFM/Training accountability
   ├─ Compliance gaps
   └─ Client risks
```

## 12.2 Scenarios

| Scenario | What happens next |
|---|---|
| Branch staffing gap | Branch Head reviews process-level shortage and owner action. |
| Branch attrition high | Drill to process/manager/reason and assign HR action. |
| Branch compliance missing | Notify HR/compliance owner. |
| New process in branch | Ensure Branch Master + Process + LOB + Cost Centre + roster + KPI mappings complete. |

## 12.3 Access and compliance

```text
Branch Head sees branch-scoped data.
Sensitive payroll/doc data masked unless allowed.
Client Portal outputs remain aggregate.
```

---

# 13. WFM / RTM

## 13.1 Mindmap

```text
WFM / RTM
├─ Employee Identity
│  ├─ Employee ID
│  ├─ Designation = WFM / RTM
│  ├─ System role = wfm / rtm
│  ├─ Reporting manager
│  └─ Process/branch scope
├─ Workforce Planning
│  ├─ Mandate HC
│  ├─ Buffer %
│  ├─ Shrinkage
│  ├─ Training pipeline
│  ├─ Required vs available HC
│  └─ Support ratios
├─ Roster
│  ├─ Roster Builder Master
│  ├─ Auto draft generation
│  ├─ Week-off preference decisions
│  ├─ Leave exclusion logic
│  ├─ Coverage gaps
│  ├─ Publish roster
│  └─ Post-publish audit
├─ RTA
│  ├─ Live adherence
│  ├─ Late/no-show alerts
│  ├─ Planned vs unplanned shrinkage
│  └─ Payroll readiness
└─ Own Employee Self-Service
```

## 13.2 Scenarios

| Scenario | What happens next |
|---|---|
| Week-off preferences break coverage | Reject/partially accept with reason and notify Agent/TL/PM. |
| Pending leave exists | Show alert only; do not exclude from roster. |
| Approved leave exists | Exclude employee from roster for approved period. |
| HC shortage remains | Escalate to PM/HR/training. |
| Post-publish change needed | Require reason, approval and audit. |

## 13.3 Access and compliance

```text
WFM sees roster/attendance/workforce data for mapped scope.
No full payroll/document visibility unless required.
Post-publish changes fully audited.
```

---

# 14. QA / T&Q

## 14.1 Mindmap

```text
QA / T&Q
├─ Employee Identity
│  ├─ Employee ID
│  ├─ Designation = QA / Quality Analyst / T&Q
│  ├─ System role = qa / tq
│  ├─ Reporting manager
│  └─ Process quality scope
├─ Quality Monitoring
│  ├─ Audit parameters
│  ├─ Call evidence
│  ├─ Fatal / critical defects
│  ├─ Score trends
│  ├─ Calibration
│  └─ Disputes
├─ Improvement
│  ├─ Coaching
│  ├─ TNI
│  ├─ CAPA
│  ├─ Repeat defect tracking
│  └─ Acknowledgement tracking
└─ Reporting
   ├─ Agent/TL/process trend
   ├─ Client-safe quality summary
   └─ Quality risk dashboard
```

## 14.2 Scenarios

| Scenario | What happens next |
|---|---|
| Fatal defect found | Notify TL/AM/PM and trigger coaching/CAPA. |
| Repeat defect | Create TNI and escalate if recurring. |
| Audit disputed | Follow calibration workflow. |
| Client quality report needed | Publish approved aggregate only. |

## 14.3 Access and compliance

```text
Call evidence access audited.
Customer/client data masked where required.
Client reports aggregate only.
```

---

# 15. Trainer

## 15.1 Mindmap

```text
Trainer
├─ Employee Identity
│  ├─ Employee ID
│  ├─ Designation = Trainer
│  ├─ System role = trainer
│  ├─ Reporting manager
│  └─ Training/process scope
├─ Training Operations
│  ├─ New joiner batch
│  ├─ LMS mapping
│  ├─ Attendance
│  ├─ Progress
│  ├─ Certification
│  ├─ Risk trainees
│  └─ Handover to Ops
├─ Readiness
│  ├─ Certified pending deployment
│  ├─ Not certified
│  ├─ Retraining
│  └─ Training projection
└─ Own Employee Self-Service
```

## 15.2 Scenarios

| Scenario | What happens next |
|---|---|
| New employee joined | Map to LMS/training batch. |
| Trainee not certified | Mark hold/retrain/pullout by rule. |
| Certified pending deployment | Notify WFM/PM. |
| Training pipeline short | Notify HR/WFM/PM. |

## 15.3 Access and compliance

```text
Training data scoped by batch/process.
No payroll/document sensitive access unless allowed.
```

---

# 16. Payroll / Finance

## 16.1 Mindmap

```text
Payroll / Finance
├─ Employee Identity
│  ├─ Employee ID
│  ├─ Designation = Payroll / Finance
│  ├─ System role = payroll / finance
│  ├─ Reporting manager
│  └─ Payroll scope
├─ Payroll Setup
│  ├─ Salary structure
│  ├─ Payroll components
│  ├─ Statutory config
│  ├─ Cost centre payroll config
│  └─ Bank/disbursement config
├─ Monthly Payroll
│  ├─ Attendance readiness
│  ├─ LWP
│  ├─ Incentive approved inputs
│  ├─ Tax declaration
│  ├─ Payslip
│  └─ Disbursement
├─ Exit / F&F
│  ├─ Clearance inputs
│  ├─ Recovery
│  ├─ Gratuity
│  ├─ F&F approval
│  └─ Final settlement
└─ Own Employee Self-Service
```

## 16.2 Scenarios

| Scenario | What happens next |
|---|---|
| Salary structure missing | Block payroll line and notify HR. |
| Attendance readiness failed | Send correction to WFM/HR. |
| Incentive not approved | Do not include in payroll. |
| Tax config missing | Mark pending configuration; no silent fallback. |
| F&F clearance pending | Block final settlement. |

## 16.3 Access and compliance

```text
Payroll data highly restricted.
Employee sees own payslip only.
Payroll exports require approval and audit.
```

---

# 17. Admin / IT / Asset User

## 17.1 Mindmap

```text
Admin / IT / Asset User
├─ Employee Identity
│  ├─ Employee ID
│  ├─ Designation = Admin / IT / Asset Executive
│  ├─ System role = asset_admin / it_admin / admin_support
│  ├─ Reporting manager
│  └─ Branch/admin scope
├─ Assets
│  ├─ Asset Master
│  ├─ Asset issue
│  ├─ Asset service
│  ├─ Asset return
│  ├─ Asset transfer
│  └─ Exit clearance
├─ Access Support
│  ├─ System access request
│  ├─ Account support
│  ├─ Deactivation on exit
│  └─ Device/access audit
└─ Own Employee Self-Service
```

## 17.2 Scenarios

| Scenario | What happens next |
|---|---|
| New employee joined | Issue asset/access based on role/process. |
| Asset damaged/lost | Log recovery/repair decision and notify HR/payroll if needed. |
| Employee exits | Recover assets and deactivate access before clearance. |
| Access requested | Route through approval workflow. |

## 17.3 Access and compliance

```text
Asset and access data scoped.
Cannot see payroll/private HR data unless explicitly allowed.
Exit deactivation actions audited.
```

---

# 18. Compliance / Auditor

## 18.1 Mindmap

```text
Compliance / Auditor
├─ Employee Identity
│  ├─ Employee ID
│  ├─ Designation = Compliance / Auditor
│  ├─ System role = compliance / auditor
│  ├─ Reporting manager
│  └─ Compliance scope
├─ DPDP Controls
│  ├─ Data inventory
│  ├─ Privacy notices
│  ├─ Consent ledger
│  ├─ Data principal requests
│  ├─ Retention policies
│  └─ Breach register
├─ Audit
│  ├─ Sensitive access logs
│  ├─ Export logs
│  ├─ Document access logs
│  ├─ Payroll access logs
│  └─ Role permission review
└─ Evidence
   ├─ Incident evidence
   ├─ Corrective action
   ├─ Audit report
   └─ Closure proof
```

## 18.2 Scenarios

| Scenario | What happens next |
|---|---|
| Data correction request | Route to data owner and track SLA. |
| Sensitive export requested | Ensure approval before export. |
| Breach suspected | Open breach incident and preserve evidence. |
| Unauthorized document access | Flag privacy audit incident. |
| Retention expired | Archive/anonymise if no legal hold. |

## 18.3 Access and compliance

```text
Access restricted to compliance/audit role.
Evidence access audited.
Legal timelines configurable; do not hardcode.
```

---

# 19. Client User

## 19.1 Mindmap

```text
Client User
├─ Client Portal Identity
│  ├─ Client user account
│  ├─ Client organisation
│  ├─ Mapped process
│  ├─ Mapped reports
│  └─ Access status
├─ Dashboard
│  ├─ SLA / SOW metrics
│  ├─ Staffing readiness aggregate
│  ├─ Training readiness aggregate
│  ├─ Quality aggregate
│  └─ Action plan status
├─ Governance
│  ├─ MOM
│  ├─ Requests
│  ├─ Escalations
│  └─ Closure evidence
└─ Reports
   ├─ Published reports
   ├─ Approved metrics
   └─ No PII / no payroll / no raw data
```

## 19.2 Journey

```text
Client user invited
→ Client Portal access created
→ Client/process mapping assigned
→ Published aggregate reports visible
→ Client raises requests/escalations
→ Process Manager owns action closure
```

## 19.3 Scenarios

| Scenario | What happens next |
|---|---|
| Client asks employee-level data | Deny by default; provide approved aggregate. |
| Client raises request | Log request and assign PM owner. |
| SLA risk visible | PM updates action plan. |
| Report requested | Publish through Client Publish Rule only. |

## 19.4 Access and compliance

```text
Client user is not internal employee by default.
Client sees aggregate only.
No employee PII.
No candidate PII.
No payroll.
No documents.
No grievances.
No raw audit data.
No individual incentive.
```

---

# 20. SME / Process Support

## 20.1 Mindmap

```text
SME / Process Support
├─ Employee Identity
│  ├─ Employee ID
│  ├─ Designation = SME / Process Support
│  ├─ System role = sme / support
│  ├─ Reporting manager
│  └─ Process/team scope
├─ Process Support
│  ├─ Knowledge support
│  ├─ Escalation handling
│  ├─ Floor support
│  ├─ Training support
│  ├─ Quality support
│  └─ Process updates
├─ Team Assistance
│  ├─ Agent queries
│  ├─ TL support
│  ├─ Process clarification
│  └─ Risk flagging
└─ Own Employee Self-Service
```

## 20.2 Scenarios

| Scenario | What happens next |
|---|---|
| Agent needs process help | SME responds and logs support where required. |
| Repeat process error | SME alerts QA/Trainer/TL. |
| Process update released | SME helps communicate/update knowledge base. |
| Escalation issue | SME supports TL/AM/PM closure. |

## 20.3 Access and compliance

```text
SME sees process/team data needed for support only.
No payroll or sensitive HR/document access by default.
```

---

# 21. Global Role Completion Criteria

A role journey is complete only when:

```text
1. Role has Employee Page / Stat Card if internal.
2. Reporting manager is mapped, except CEO.
3. Designation and system role are visible separately.
4. Role has dashboard/workbench where needed.
5. Role sees only mapped branch/process/LOB/cost-centre/team/self/client scope.
6. Backend enforces role/scope.
7. Sensitive fields are masked.
8. Workflow actions create audit logs.
9. Notifications trigger where required.
10. Employee journey timeline updates where relevant.
11. Current UI/layout is preserved.
12. Tests cover success, unauthorized and scope-denied cases.
```

---

# 22. Developer Instruction

```text
Build every role as an Employee entity if internal. Every internal employee must have a reporting/mandate manager except CEO/top organisation head. Candidate before joining must have Recruiter/HR owner, not employee manager. Each role must have Employee Page/Stat Card, designation, system role, manager mapping, scope mapping, role dashboard/workbench, scenario handling, audit, notification and data masking. Client users are external and aggregate-only by default. Preserve current UI/layout and do not create new Supabase business tables.
```
