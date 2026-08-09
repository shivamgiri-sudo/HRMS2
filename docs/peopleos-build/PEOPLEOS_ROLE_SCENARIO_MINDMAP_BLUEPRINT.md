# PeopleOS Detailed Role Scenario Mindmap Blueprint

**Date:** 30-May-2026  
**Status:** Mandatory functional blueprint for role journeys, pages, workflows, alerts and scenario handling.  
**Architecture:** React + TypeScript frontend, Node/Express backend, MySQL `mas_hrms`.  
**Rule:** This is product/process blueprint. Do not execute SQL or deploy from this document.

---

## 1. Purpose

This document defines the end-to-end mindmap for every major PeopleOS role. It covers:

- role landing page;
- role responsibilities;
- step-by-step journey;
- if-this-happens-next-action scenarios;
- approval/escalation rules;
- notifications;
- data access and masking;
- linked modules and tables.

This document must be used with:

- `PEOPLEOS_CEO_SCOPE_DPDP_ADDENDUM.md`
- `PEOPLEOS_MAS_HRMS_TABLE_MAPPING_BLUEPRINT.md`
- `PEOPLEOS_ROSTER_BUILDER_MASTER_BLUEPRINT.md`
- `PEOPLEOS_ROSTER_PREFERENCE_OPERATION_PRIORITY_ADDENDUM.md`
- `PEOPLEOS_ROSTER_LEAVE_EXCLUSION_RULE_ADDENDUM.md`
- `PEOPLEOS_SLICE_01_EMPLOYEE_ID_ONBOARDING_AUTOFILL.md`

---

## 2. Global Operating Principles

### 2.1 One-person journey principle

```text
Candidate
→ Pre-Joining User
→ Employee
→ Active Workforce Member
→ Exit / Alumni / Rehire Candidate
```

The same person must remain traceable across recruitment, onboarding, employee master, LMS, roster, attendance, payroll, performance, client reporting and exit.

### 2.2 Role access principle

```text
Frontend visibility is not security.
Backend API must enforce role + scope + data sensitivity.
```

Every API must validate:

```text
User role
→ Branch scope
→ Process scope
→ LOB scope
→ Cost centre scope
→ Employee/team scope
→ Data sensitivity permission
```

### 2.3 Scenario handling principle

Every operational event must have:

```text
Trigger
→ Owner
→ Next action
→ Escalation path
→ Notification
→ Audit/event log
→ Impact on employee journey/stat card if relevant
```

### 2.4 Notification principle

Use portal notifications first, then email/WhatsApp where configured.

Required channels by event:

```text
Portal notification = mandatory for all workflow events
Email = configured by communication template/event rule
WhatsApp = configured by communication provider/event rule
```

### 2.5 Roster principle

```text
Operations requirement comes first.
Week-off preference is not guaranteed.
Only approved leave is roster exclusion.
Pending/unapproved leave is alert only.
```

---

## 3. Universal Scenario Router

| If this happens | Primary owner | Immediate next action | Escalation | Notification |
|---|---|---|---|---|
| Candidate duplicate found | Recruiter / HR | Review duplicate/reprocess rule | HR Manager | Recruiter + HR |
| Candidate selected | Recruiter / HR | Trigger offer + pre-joining checklist | HR Admin | Candidate + HR |
| Candidate documents pending | Candidate / HR Compliance | Candidate uploads missing docs | HR Admin | Candidate + Recruiter + HR |
| Document rejected | HR Compliance | Candidate resubmits corrected doc | HR Admin | Candidate + HR |
| Offer not acknowledged | Candidate | Send reminder | HR Admin | Candidate + Recruiter |
| Pre-joining submitted | HR Admin | Review and approve/reject | HR Manager | Candidate + HR |
| Employee ID generation fails | HR Admin / System Admin | Fix rule/sequence and retry | Super Admin | HR + System Admin |
| Employee joins | HR Admin | Activate employee portal + LMS mapping | Trainer/WFM | Employee + HR + Trainer |
| Leave approved | Manager/HR | Remove from roster availability | WFM | Employee + TL/WFM |
| Leave pending | Manager/HR | Show as alert only; do not exclude from roster | Process Manager | WFM + TL |
| Week-off preference breaks coverage | WFM/System | Reject/partially accept with reason | Process Manager | Agent + TL + WFM + PM |
| Roster shortage remains | WFM | Flag shortage and action plan | Process Manager/CEO if severe | WFM + PM + TL |
| Post-publish roster change needed | WFM/PM | Raise change with reason | Process Manager | Employee + TL + WFM |
| Employee no-show | TL | Contact employee and log action | AM/PM | TL + AM + WFM |
| Attendance mismatch | Employee/TL | Regularization request or correction | HR/WFM | Employee + TL |
| Quality fatal/critical defect | QA | Trigger coaching/CAPA | T&Q Head/PM | QA + TL + Agent |
| Employee enters PIP | Manager/HR | Create PIP plan and milestones | HR/PM | Employee + Manager + HR |
| Incentive draft generated | System/Payroll | Approver review | HR/Finance | Approver + Payroll |
| Payroll readiness failed | Payroll/HR/WFM | Fix missing attendance/doc/salary data | HR/PM | Payroll + HR |
| Resignation submitted | Employee/Manager | Manager/HR review | HR Admin | Employee + Manager + HR |
| Exit clearance pending | HR/Admin/Assets/IT | Clear assigned items | HR Manager | Owner + Employee |
| Client requests update | Client User/PM | Log request and assign owner | CEO if SLA breach | Client + PM |
| Data breach suspected | Compliance/Super Admin | Open breach incident register | CEO/Legal/DPO | Compliance owners only |

---

## 4. Super Admin Mindmap

```text
Super Admin
├─ Platform Governance
│  ├─ Branch / Client / Process / LOB / Cost Centre masters
│  ├─ User and role management
│  ├─ Page access and backend scope rules
│  ├─ Approval matrix
│  └─ System configuration
├─ Security
│  ├─ Password reset / account lock / unlock
│  ├─ Role assignment
│  ├─ Temporary access grant
│  ├─ Sensitive action audit
│  └─ Session / access revocation
├─ Compliance
│  ├─ DPDP control tower
│  ├─ Data inventory
│  ├─ Consent ledger
│  ├─ Breach register
│  ├─ Data export approval
│  └─ Retention policy
├─ Integration
│  ├─ Manual upload config
│  ├─ External SQL connector config
│  ├─ API connector config
│  ├─ Sync health
│  └─ Data lineage
└─ Deployment Readiness
   ├─ CI status
   ├─ Manual deploy control
   ├─ Environment variable checklist
   └─ Health checks
```

### Super Admin scenarios

| Scenario | What to do next |
|---|---|
| New branch/client/process/LOB/cost centre created | Configure hierarchy, scopes and client publish rules before operational use. |
| User cannot access page | Check role, page access, backend scope, active user status and account lock. |
| User needs temporary elevated access | Use access request workflow, set expiry, log reason and audit. |
| Wrong role assigned | Revoke role, audit correction and notify affected user/manager if needed. |
| Workflow stuck due to missing approval matrix | Configure approval matrix by domain/scope and retry workflow. |
| Vercel/manual deployment needed | Ensure CI green, no hard gate, env configured, then run manual deploy only after approval. |
| Possible data breach | Open breach incident, lock affected access if needed, preserve evidence, follow compliance workflow. |

---

## 5. CEO / Leadership Mindmap

```text
CEO / Leadership
├─ Company Health
│  ├─ Total HC
│  ├─ Active vs required HC
│  ├─ Hiring pipeline
│  ├─ Training pipeline
│  ├─ Attrition
│  └─ Cost centre view
├─ Delivery Health
│  ├─ Client SLA
│  ├─ Process performance
│  ├─ Quality risk
│  ├─ Staffing risk
│  ├─ Roster shortage
│  └─ Client action plan
├─ Financial Health
│  ├─ Payroll summary
│  ├─ Incentive summary
│  ├─ Cost centre trend
│  └─ Productivity cost view
├─ Compliance Health
│  ├─ DPDP dashboard
│  ├─ Breach incidents
│  ├─ Audit exceptions
│  └─ Sensitive export status
└─ Drilldown
   ├─ Branch
   ├─ Process
   ├─ LOB
   ├─ Cost centre
   └─ Manager hierarchy
```

### CEO scenarios

| Scenario | What to do next |
|---|---|
| Process HC shortage is high | Review mandate vs active HC, training pipeline and recruitment pipeline; assign action to PM/HR/WFM. |
| Attrition spike | Drill into process/LOB/cost centre, reasons, tenure bucket and manager; ask HR/PM action plan. |
| Quality fatal/critical spike | Review QA trends, repeat agents, TL/AM ownership and coaching closure. |
| Payroll risk visible | Review payroll readiness blockers; assign HR/Payroll/WFM closure. |
| Client SLA breach risk | Review client dashboard and governance action plan; escalate to Process Manager. |
| DPDP breach incident | Review compliance status only; legal/DPO process should drive official notifications. |

---

## 6. HR Admin Mindmap

```text
HR Admin
├─ Candidate to Employee
│  ├─ Selected candidate review
│  ├─ Offer status
│  ├─ Pre-joining submission
│  ├─ Document compliance
│  ├─ BGV status
│  ├─ Employee ID generation
│  └─ Employee creation
├─ Employee Master
│  ├─ Profile
│  ├─ Process / LOB / Cost centre assignment
│  ├─ Designation
│  ├─ Manager/TL mapping
│  ├─ Documents
│  └─ Journey timeline
├─ Lifecycle
│  ├─ Confirmation
│  ├─ Transfer
│  ├─ Promotion
│  ├─ Salary revision input
│  ├─ PIP/disciplinary events
│  └─ Exit
└─ HR Compliance
   ├─ Consent and declarations
   ├─ Document checklist
   ├─ Data requests
   └─ Audit logs
```

### HR Admin scenarios

| Scenario | What to do next |
|---|---|
| Candidate selected but pre-joining not submitted | Send reminder and notify recruiter. |
| Candidate submits pre-joining with mismatch | Mark for correction; candidate edits; HR revalidates. |
| Resume parsing fills wrong value | Candidate correction wins; keep parsed value as audit/draft only. |
| Mandatory document pending | Block conversion if checklist rule says mandatory. |
| Document rejected | Candidate must resubmit; HR/compliance reviews again. |
| Offer not accepted | Joining cannot proceed if offer acceptance is mandatory. |
| Employee ID rule missing | Ask Super Admin/HR Admin to configure Employee ID master. |
| Duplicate mobile/PAN/UAN found | Stop conversion; follow duplicate/rejoin decision workflow. |
| Candidate is ex-employee | Check rehire eligibility/cooling rule; preserve old history. |
| Employee mapping changed | Create assignment history and update current mapping. |

---

## 7. Candidate / Pre-Joining User Mindmap

```text
Candidate / Pre-Joining User
├─ Access
│  ├─ Candidate ID / mobile / email validation
│  ├─ OTP or secure link
│  └─ Consent notice
├─ Autofill
│  ├─ ATS data fetch
│  ├─ Resume upload
│  ├─ Resume photo capture
│  ├─ Parser draft data
│  └─ Candidate correction
├─ Onboarding Wizard
│  ├─ Basic details
│  ├─ Contact details
│  ├─ Personal details
│  ├─ Statutory details
│  ├─ Family details
│  ├─ Address details
│  ├─ Bank details
│  ├─ Documents
│  └─ Review and submit
├─ Offer
│  ├─ Offer view
│  ├─ Acknowledgement
│  └─ e-sign/Aadhaar consent where configured
└─ Status
   ├─ Submitted
   ├─ Correction required
   ├─ Approved
   ├─ Joining pending
   └─ Employee portal activation
```

### Candidate scenarios

| Scenario | What to do next |
|---|---|
| Candidate cannot validate identity | Show clear error; allow HR/recruiter support path. |
| Resume parser fails | Candidate fills manually; upload remains stored as reference. |
| Parsed data confidence low | Highlight field for candidate validation. |
| Candidate changes ATS-filled value | Store change, require HR review if sensitive field. |
| Document upload fails | Retry upload; show supported file type/size. |
| Offer not acknowledged | Candidate remains pending; reminders continue. |
| Submission rejected by HR | Candidate corrects required sections and resubmits. |

---

## 8. Recruiter Mindmap

```text
Recruiter
├─ Candidate Queue
│  ├─ Assigned candidates
│  ├─ Follow-up SLA
│  ├─ Duplicate/reprocess alert
│  ├─ Screening status
│  └─ Interview status
├─ Candidate Progress
│  ├─ Selected
│  ├─ Rejected
│  ├─ Hold
│  ├─ No show
│  └─ Client round pending
├─ Joining Pipeline
│  ├─ Offer requested
│  ├─ Document pending
│  ├─ Pre-joining pending
│  ├─ Joining scheduled
│  └─ Joined
└─ Productivity
   ├─ Attempts
   ├─ Walk-in
   ├─ Selected
   ├─ Joined
   └─ Source performance
```

### Recruiter scenarios

| Scenario | What to do next |
|---|---|
| Candidate duplicate | Follow duplicate action: continue/reopen/block based on rule. |
| Candidate no-show | Mark no-show; reschedule if allowed; update queue. |
| Candidate selected | Trigger offer/pre-joining workflow. |
| Candidate documents pending | Follow up; notification to candidate. |
| Candidate drops after selection | Mark dropout reason; update pipeline and productivity. |
| Candidate joined | Recruiter productivity gets joined credit if mapped by rule. |

---

## 9. Employee Mindmap

```text
Employee
├─ Self-Service
│  ├─ Profile
│  ├─ Documents
│  ├─ Consent/declaration
│  ├─ Leave
│  ├─ Attendance regularization
│  ├─ Roster
│  ├─ Week-off preference
│  ├─ Payslip
│  ├─ Tax declaration
│  ├─ Assets
│  ├─ Helpdesk
│  └─ Resignation
├─ Growth
│  ├─ LMS learning
│  ├─ Certification
│  ├─ Goals
│  ├─ Performance
│  ├─ Coaching
│  ├─ PIP if applicable
│  ├─ Incentive view
│  └─ Gamification
└─ Privacy
   ├─ Communication preferences
   ├─ Data request
   ├─ Consent history
   └─ Grievance
```

### Employee scenarios

| Scenario | What to do next |
|---|---|
| Wants week-off preference | Submit within window; system may accept/reject based on operation need. |
| Week-off preference rejected | View reason; final roster applies unless WFM/PM override. |
| Leave pending | Employee remains roster-available until leave is approved. |
| Leave approved | Employee excluded from roster for approved leave period. |
| Roster changed | Employee receives notification and acknowledges new roster. |
| Attendance mismatch | Raise regularization with reason/evidence. |
| Payslip issue | Raise payroll/helpdesk ticket or dispute if workflow exists. |
| Wants resignation | Submit resignation; manager/HR workflow starts. |
| Wants data correction | Submit data principal/correction request where applicable. |

---

## 10. WFM Mindmap

```text
WFM
├─ Workforce Planning
│  ├─ Mandate HC
│  ├─ Buffer %
│  ├─ Shrinkage
│  ├─ Training pipeline
│  ├─ Available HC
│  └─ Shortage/surplus
├─ Roster Builder
│  ├─ Process-specific rules
│  ├─ Shift coverage
│  ├─ Week-off preference rules
│  ├─ Approved leave handling
│  ├─ Skill/certification mapping
│  ├─ Support ratios
│  └─ Conflict priority
├─ Roster Execution
│  ├─ Auto draft generation
│  ├─ Preference decision review
│  ├─ Coverage gaps
│  ├─ Exceptions
│  ├─ Publish roster
│  └─ Post-publish audit
└─ RTA
   ├─ Live adherence
   ├─ No-show/late alerts
   ├─ Shrinkage
   └─ Payroll readiness
```

### WFM scenarios

| Scenario | What to do next |
|---|---|
| Weekly roster cycle starts | Load process rules, approved leaves, preferences, mandate and generate draft. |
| Preferences break coverage | Reject/partially accept preferences with reason; notify users. |
| Pending leave exists | Keep employee available; show risk alert only. |
| Approved leave creates shortage | Generate exception and coverage gap. |
| HC insufficient even after rejecting preferences | Flag shortage; notify PM; raise action for hiring/training/deployment. |
| TL asks for post-publish change | Require formal change request with reason and permission. |
| Employee does not acknowledge roster | Send reminder; escalate to TL if overdue. |
| RTA mismatch | Notify TL/AM; log adherence exception. |

---

## 11. Process Manager Mindmap

```text
Process Manager
├─ Delivery Readiness
│  ├─ Required HC
│  ├─ Active HC
│  ├─ Shortage/surplus
│  ├─ Training pipeline
│  ├─ Certification readiness
│  └─ Deployment readiness
├─ Roster Governance
│  ├─ Review draft roster
│  ├─ Review preference acceptance/rejection
│  ├─ Review coverage gaps
│  ├─ Approve publish
│  └─ Monitor post-publish changes
├─ Performance
│  ├─ Process KPI
│  ├─ Quality trend
│  ├─ Productivity
│  ├─ Coaching/PIP
│  └─ Incentive inputs
└─ Client Governance
   ├─ SLA/SOW
   ├─ Client requests
   ├─ Action plans
   └─ Published metrics
```

### Process Manager scenarios

| Scenario | What to do next |
|---|---|
| Roster draft has shortage | Review cause: HC, leave, skill, support ratio; assign action. |
| Many week-off preferences rejected | Check fairness and coverage; approve if justified or override if safe. |
| Approved leave after roster publish creates gap | Review WFM replacement suggestion; approve post-publish change. |
| Process KPI below target | Drill to TL/team/agent; trigger coaching/action plan. |
| Client escalation | Create governance action and owner. |
| Training pipeline insufficient | Escalate to HR/Trainer/Recruitment. |

---

## 12. Assistant Manager Mindmap

```text
Assistant Manager
├─ TL Governance
│  ├─ Team coverage
│  ├─ Late/no-show actions
│  ├─ Coaching closure
│  ├─ Roster exception follow-up
│  └─ Escalations
├─ Process Support
│  ├─ Attendance risk
│  ├─ Performance risk
│  ├─ Quality risk
│  └─ Shrinkage risk
└─ Approvals/Reviews
   ├─ Scoped actions
   ├─ Incentive step if configured
   ├─ PIP review
   └─ Post-publish roster request if allowed
```

### AM scenarios

| Scenario | What to do next |
|---|---|
| TL not closing attendance actions | Follow up and escalate to PM if overdue. |
| Team has repeated no-shows | Review pattern; trigger HR/PM action. |
| Roster exception assigned | Coordinate with TL/WFM; close action with evidence. |
| Quality risk in team | Ensure coaching/TNI closure. |

---

## 13. Team Leader Mindmap

```text
Team Leader
├─ Daily Team Control
│  ├─ Team roster
│  ├─ Attendance follow-up
│  ├─ No-show / late / break actions
│  ├─ Roster changes
│  └─ Employee availability
├─ Performance
│  ├─ KPI tracking
│  ├─ Productivity
│  ├─ Coaching
│  ├─ TNI
│  └─ PIP inputs
└─ Employee Support
   ├─ Leave visibility
   ├─ Week-off rejection visibility
   ├─ Helpdesk escalation
   ├─ Document pending follow-up
   └─ Resignation alert
```

### TL scenarios

| Scenario | What to do next |
|---|---|
| Agent week-off preference rejected | Explain reason from system; no manual change unless WFM/PM approves. |
| Agent no-show | Contact agent, log reason, escalate to AM/HR if required. |
| Agent late | Log follow-up; monitor repeated late pattern. |
| Agent performance low | Trigger coaching/TNI. |
| Agent leave approved after roster | Coordinate with WFM for replacement and notify team. |

---

## 14. QA / T&Q Mindmap

```text
QA / T&Q
├─ Quality Monitoring
│  ├─ Audit parameters
│  ├─ Fatal/critical alerts
│  ├─ Call evidence
│  ├─ Repeat defects
│  └─ Calibration
├─ Improvement
│  ├─ Coaching
│  ├─ TNI
│  ├─ CAPA
│  ├─ Analyst acknowledgement
│  └─ Closure tracking
└─ Reporting
   ├─ Agent/TL/process trend
   ├─ Client-safe summary
   └─ Quality risk dashboard
```

### QA scenarios

| Scenario | What to do next |
|---|---|
| Fatal defect found | Mark fatal, notify TL/AM/PM, trigger coaching/CAPA. |
| Critical defect repeated | Escalate to T&Q Head/PM; trigger focused TNI. |
| Analyst disputes audit | Follow dispute/calibration workflow. |
| Client-safe quality report needed | Publish aggregate only after approval. |

---

## 15. Trainer Mindmap

```text
Trainer
├─ Training Batch
│  ├─ Joined candidates
│  ├─ LMS mapping
│  ├─ Batch attendance
│  ├─ Learning progress
│  └─ Certification
├─ Readiness
│  ├─ Certified pending deployment
│  ├─ Not certified
│  ├─ Risk trainees
│  ├─ Handover to Ops
│  └─ Training projection
└─ Reporting
   ├─ Process-wise readiness
   ├─ Branch-wise readiness
   └─ Pipeline forecast
```

### Trainer scenarios

| Scenario | What to do next |
|---|---|
| New employee joined | Map to LMS/batch and start training. |
| Trainee fails certification | Mark not certified/hold; notify HR/PM; decide retrain or exit. |
| Training pipeline insufficient for shortage | Notify HR/WFM/PM. |
| Certified employee pending deployment | Notify WFM/PM for roster/deployment planning. |

---

## 16. Payroll / Finance Mindmap

```text
Payroll / Finance
├─ Payroll Setup
│  ├─ Salary structure
│  ├─ Payroll components
│  ├─ PF/UAN/ESIC/TDS
│  ├─ Cost centre payroll config
│  └─ Bank/disbursement config
├─ Payroll Run
│  ├─ Attendance readiness
│  ├─ LWP
│  ├─ Incentives
│  ├─ Tax declaration
│  ├─ Payslip
│  └─ Disbursement
└─ Exit/F&F
   ├─ Clearance inputs
   ├─ Recovery
   ├─ Gratuity
   ├─ F&F approval
   └─ Final settlement
```

### Payroll scenarios

| Scenario | What to do next |
|---|---|
| Employee missing salary structure | Block payroll line; notify HR/Payroll owner. |
| Attendance readiness failed | Send to WFM/HR for correction. |
| Incentive pending approval | Exclude from final payroll until approved or mark hold. |
| F&F clearance pending | Block F&F final approval. |
| Tax config missing | Mark provisional/pending configuration; do not silently calculate with fallback. |

---

## 17. Compliance / Auditor Mindmap

```text
Compliance / Auditor
├─ DPDP Control
│  ├─ Data inventory
│  ├─ Privacy notice
│  ├─ Consent ledger
│  ├─ Data principal requests
│  ├─ Retention policies
│  └─ Breach register
├─ Audit
│  ├─ Sensitive read logs
│  ├─ Export logs
│  ├─ Document access logs
│  ├─ Payroll access logs
│  └─ Permission review
└─ Evidence
   ├─ Incident evidence pack
   ├─ Corrective action
   ├─ Audit report
   └─ Closure proof
```

### Compliance scenarios

| Scenario | What to do next |
|---|---|
| Employee asks data correction | Open DSR/correction request; route to data owner. |
| Export of sensitive data requested | Require approval and log export. |
| Suspected breach | Open breach incident, classify severity, preserve evidence. |
| Document downloaded by unauthorized role | Flag privacy audit incident. |
| Retention period expired | Archive/delete/anonymise based on retention policy and legal hold. |

---

## 18. Client User Mindmap

```text
Client User
├─ Client Dashboard
│  ├─ SLA/SOW metrics
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

### Client scenarios

| Scenario | What to do next |
|---|---|
| Client raises request | Log request, assign Process Manager owner, set SLA. |
| Client asks employee-level data | Deny unless approved policy allows; provide aggregate if possible. |
| Client sees SLA risk | PM updates action plan and target closure date. |
| Client report requested | Publish only through approved client publish rule. |

---

## 19. Asset / IT / Admin Support Mindmap

```text
Asset / IT / Admin Support
├─ Asset Master
│  ├─ Asset creation
│  ├─ Asset allocation
│  ├─ Service log
│  ├─ Transfer
│  └─ Recovery
├─ Account / Access Support
│  ├─ Email/access provisioning
│  ├─ System access
│  ├─ Lock/unlock support
│  └─ Exit deactivation
└─ Clearance
   ├─ Asset return
   ├─ Damage/recovery
   ├─ NOC
   └─ Exit closure
```

### Asset/IT scenarios

| Scenario | What to do next |
|---|---|
| New employee joined | Issue required asset/access based on role/process. |
| Asset damaged/lost | Log recovery/deduction decision and notify HR/payroll if needed. |
| Employee exits | Recover assets and deactivate access before clearance. |
| Access request received | Route through access approval workflow. |

---

## 20. Module-to-Role Ownership Matrix

| Module | Primary owner | Supporting roles | Employee/client visibility |
|---|---|---|---|
| Master Data | Super Admin / HR Admin | Process Manager / WFM / Payroll | No broad employee access |
| ATS | Recruiter / HR | Process Manager | Candidate sees only own status |
| Pre-Joining | Candidate / HR | Recruiter / Compliance | Candidate own data only |
| Document Verification | HR Compliance | Candidate / HR Admin | Candidate own status only |
| Employee Master | HR Admin | Super Admin / Manager | Employee own profile limited |
| Roster Builder | WFM | Process Manager / TL / AM | Employee own roster/preference |
| Week-Off Preference | Employee | WFM / PM / TL | Employee own request/status |
| Leave | Employee / Manager | HR / WFM | Employee own leave |
| Attendance/RTA | WFM / TL | HR / PM | Employee own attendance |
| Payroll | Payroll/Finance | HR | Employee own payslip only |
| Incentive | PM/HR/Finance | TL/AM/WFM/QA | Employee approved incentive only |
| Quality | QA/T&Q | TL/AM/PM | Employee scoped feedback only |
| LMS Integration | Trainer | HR/WFM/PM | Employee own learning |
| Client Portal | Process Manager | CEO/Admin | Client aggregate only |
| DPDP Compliance | Compliance/Super Admin | HR/IT | Employee own rights workflow |
| Exit/F&F | HR/Payroll/Admin | Manager/Asset/IT | Employee own exit status |

---

## 21. Build Guidance for Codex / Claude

Use this role blueprint when building pages and APIs.

```text
For every feature, identify:
1. Primary role
2. Supporting role
3. Trigger event
4. Next action
5. Escalation
6. Notification
7. Audit log
8. Employee journey event impact
9. Data masking rule
10. Backend scope enforcement
```

Do not build disconnected pages. Every page must connect to role journey, workflow state, notification, audit and data ownership.

---

## 22. Completion Definition

A role journey is complete only when:

1. Role has a landing/dashboard page.
2. Role sees only mapped data.
3. Role can perform required actions.
4. Backend enforces scope.
5. Scenarios have next-action handling.
6. Notifications are generated where required.
7. Sensitive actions are audited.
8. Employee journey/stat card is updated where relevant.
9. Tests cover allowed and denied access.
10. UI is visible and usable in browser.
