# MAS Callnet PeopleOS — Master Execution Charter

**Version:** 1.0 Final Build Charter  
**Date:** 29-May-2026  
**Status:** Permanent development direction for Claude Code and all future implementation work  
**Execution mode:** Continuous source-code build to deployment readiness, pausing only at defined live-system hard gates.

---

# 1. Product Mandate

Build **MAS Callnet PeopleOS**: a secure, MySQL-first BPO workforce and client-delivery operating system covering the complete journey:

```text
Client Demand / Workforce Requirement
→ Walk-in or Online Applicant
→ Screening / Assessment / Interview / Selection / Offer / BGV
→ Joining and Employee Conversion
→ Documents / Assets / Benefits / Onboarding
→ Existing LMS Mapping / Training / Certification / Operations Handover
→ Shift Eligibility / Weekly Roster / Employee Acknowledgement
→ Attendance / Leave / Adherence / WFM / RTA / Shrinkage
→ Payroll / Payslip / Tax / Statutory / Gratuity / F&F
→ Operations KPI / Quality / Call Master / Coaching / Goals / Upskilling
→ Promotion / Transfer / Talent Mobility / Retention or PIP
→ Resignation / Clearance / Asset Recovery / Relieving / Alumni
→ Attrition / Backfill / Client Delivery Governance
```

The final product is not merely ATS, HRMS or payroll. It is a connected operating platform in which a candidate is registered once, becomes an employee once, and continues through every workforce and delivery process using one traceable identity and controlled integrations.

Do not build demonstration-only pages or disconnected modules. Build production-quality workflows, API security, MySQL schema, role-scoped UI, automation, audit, tests, import/connectors, health controls and deployment runbooks.

---

# 2. Non-Negotiable Architecture Decision — MySQL First

## 2.1 Application architecture

```text
React / TypeScript Frontend
        ↓
Node.js / Express / TypeScript Backend APIs
        ↓
MySQL Application Database: mas_hrms
```

`mas_hrms` is the dedicated writable PeopleOS application database and the source of truth for all **new business workflow data**.

## 2.2 All new business modules must be built in MySQL `mas_hrms`

Create new operational tables, workflow states, snapshot tables, published metrics and audit records in MySQL for:

- organisation masters, branch/process/LOB/client/cost-centre/hierarchy;
- RBAC, permissions, row scopes, workflow and audit;
- ATS, manpower demand, walk-in, assessments, offer, BGV, joining and conversion;
- employees, lifecycle, documents metadata, letters, cases and helpdesk;
- assets, issuance, recovery, procurement and clearance;
- benefits, reimbursement, claims and employee financial services;
- shift, weekly roster, attendance, leave, WFM, RTA, shrinkage and attrition;
- payroll, payslip, tax configuration, PF/UAN/ESIC, gratuity and F&F;
- operations KPI, quality KPI, Call Master summaries, coaching, goals, PIP and tasks;
- Client Portal, SLA/SOW, governance, requests, action plans and published reporting;
- LMS mapping and reporting snapshots only;
- Integration Hub, upload jobs, connector jobs, mappings, lineage, exceptions and reconciliation;
- ERP/commercial extensions, vendor/procurement/contracts/billing readiness;
- health checks, compliance controls, notification and operational monitoring.

**Do not create new operational or business tables in Supabase.**

## 2.3 Supabase transitional boundary

Retain Supabase only where currently necessary during transition:

| Supabase Capability | Rule |
|---|---|
| Supabase Auth | May remain as identity/session provider initially; backend MySQL RBAC is authoritative for business API access. |
| Supabase Storage | May retain current binary-file storage temporarily. Store metadata, ownership, verification, access audit and workflows in MySQL. |
| Existing Supabase-native working screens/tables | Preserve until equivalent Express/MySQL workflow is implemented, tested and safely migrated. Do not expand them as new product architecture. |
| Existing Supabase LMS-related flows | Treat as protected transitional legacy only. Do not enhance into a second LMS. |

Never store large resume/document/payslip/photograph binaries inside MySQL. Use approved file/object storage, while MySQL owns metadata, access, validation, approval and audit.

## 2.4 Existing LMS boundary

The internal LMS has already been built and deployed independently. It remains the system of record for:

- curriculum, classroom and course structure;
- learning content and content delivery;
- assessments, MCQs and question bank;
- trainee learning workflows;
- certification rules and certification outcomes;
- LMS coordinator/admin operations.

PeopleOS must build only the controlled integration layer in MySQL:

- employee-to-LMS learner mapping;
- batch/classroom/process/branch/LOB mapping;
- course/assessment/progress snapshot sync;
- certification and operations-handover readiness snapshot;
- training-risk and training-attrition summary;
- sync run history, mismatches, exceptions and retry controls;
- employee/manager/leadership dashboards;
- approved aggregate Client Portal training-readiness feed;
- secure launch/deep-link/SSO feasibility after live integration approval.

Do not rebuild LMS operations inside HRMS and do not connect to or alter the live deployed LMS without explicit approval.

## 2.5 Existing operational database boundary and future continuous data stream

Existing production SQL databases, Call Master databases, attendance sources, client/source systems and future source applications are **upstream source systems**. PeopleOS will later receive approved data through controlled read-only connectors into `mas_hrms`.

Final integration flow:

```text
External SQL DB / API / Secure File Feed / Device Feed / Deployed LMS
        ↓ read-only connector or controlled ingestion
Integration Hub Source Registry + Mapping Engine + Validation + Scheduler
        ↓
mas_hrms Raw / Staging / Canonical / Snapshot / Published Tables
        ↓
Internal Dashboards / Employee Flows / Approved Client Portal Views
```

Rules:

- no upstream schema or data modifications unless separately approved;
- no direct live dashboard dependency on external databases for routine page loads;
- read-only credentials only for source connectors;
- incremental/watermark-based sync, duplicate control, retries and reconciliation;
- lineage from displayed KPI back to source, run, mapping version and calculation version;
- continuous stream health/status dashboard;
- manual upload fallback for every critical integration domain.

---

# 3. Current Repository Baseline and Protected Work

The repository already contains or has merged foundations for:

- Phase 0-A: schema runner alignment for KPI and Client Portal application schemas;
- Phase 0-B: Client Portal security controls and RBAC reconciliation foundation;
- Phase 1: organisation masters, approval workflow, role administration and audit framework;
- Phase 2: employee lifecycle, assets backend, helpdesk and letter generation;
- Phase 3: ATS manpower/BGV/offer/analytics plus WFM swap/coverage/attrition foundations and security fixes;
- Phase 4 / PR #17: payroll, payslip, tax declaration and F&F foundation is already merged into `main`; it requires post-merge safety verification before SQL execution or live payroll activation.

Existing backend route areas include processes, integration hub, WFM/roster, leave, payroll, employees, KPI, portal, ATS, exit, migration, access, organisation, workflow, lifecycle, assets, helpdesk, letters, ATS extensions and WFM extensions.

## Protected existing systems and flows

Do not delete, silently replace or break:

1. current employee CRUD, attendance, leave, assets, reports, notifications and onboarding functionality;
2. existing Candidate Web Form and Recruiter Mobile App business flows already used outside this repository; integrate safely and preserve their validated logic;
3. the independently deployed internal LMS and its operational workflows;
4. existing Client Portal process-scoped access concept and security controls;
5. existing WFM/roster, KPI, exit and Integration Hub work;
6. existing Supabase Auth/Storage and working transitional screens until tested migration is available;
7. separately developed Finnable / Call Master work; integrate through safe contracts and snapshots rather than overwriting it.

No Store Manager role is required.

---

# 4. User Experiences and Role Model

## 4.1 Required portals/workspaces

| Portal / Workspace | Purpose |
|---|---|
| Candidate / Careers / Walk-in Portal | Jobs, registration, resume, consent, assessments, application status. |
| Recruiter Portal / Mobile Experience | Assigned candidates, screening, interview, follow-up, offer, joining and productivity. |
| Employee Self-Service | Profile, documents, benefits, roster, attendance, leave, payslip, tax, learning, goals, assets, tickets and resignation. |
| HR / HR Admin Portal | Lifecycle, documents, policies, joining, letters, cases, benefits, compliance and analytics. |
| Payroll / Finance Portal | Salary structures, runs, validation, statutory configuration, payments, reconciliation and F&F. |
| WFM Portal | Demand/capacity, shift, roster governance, RTA, adherence, shrinkage and staffing risks. |
| Process Manager Portal | Weekly roster publishing, delivery readiness, attendance governance, KPI/actions and team accountability. |
| Assistant Manager Portal | TL governance, exceptions, coverage recovery and performance actions. |
| Team Leader Portal | Team roster/adherence, no-show/late/action handling, coaching and daily controls. |
| Quality / T&Q Portal | Audits, fatal/critical risk, Call Master evidence, calibration, coaching/TNI/CAPA. |
| Leadership / CEO Command Centre | Company-wide hiring, workforce, performance, cost, risks, client health and compliance. |
| Client Portal | Process-scoped delivery transparency, SLA, staffing/training readiness, quality, governance and requests. |
| Integration / Migration Console | Manual uploads, connectors, mapping, sync runs, errors and reconciliation. |
| Health / Compliance Control Tower | Technical health, business health, audits, policy controls and readiness. |

## 4.2 Roles and server-side scope

Support roles appropriate to the business, including Super Admin, HR Admin, Recruitment HR, WFM, Payroll/Finance, Branch Head, Process Manager, Assistant Manager, Team Leader, Trainer/Training View, Quality/T&Q, Employee, Client User, Client Governance Admin, Integration Admin, Compliance/Auditor and CEO/Leadership.

Every sensitive API must enforce scope server-side:

- employee: self only unless explicitly authorised;
- TL: mapped team only;
- AM: mapped teams/process scope only;
- Process Manager: mapped process/branch scope only;
- Branch Head: authorised branch scope only;
- client: mapped client/process/permission scope and published data only;
- HR/Payroll/Finance/Admin: authorised purpose and role only;
- integrations: connector-specific service scopes only.

Frontend page visibility is not security.

---

# 5. End-to-End Business Journeys

## 5.1 Candidate to exit journey

```text
Manpower Demand / Client Requirement
→ Job Posting / Walk-in Registration
→ Candidate Consent and Duplicate Check
→ Screening / Process Eligibility / Assessment / Interview
→ Selection / Offer / BGV / Joining Confirmation
→ Candidate-to-Employee Conversion
→ Documents / Asset / Benefits / Access Onboarding
→ LMS Mapping / Training / Certification / Handover
→ Weekly Roster / Shift / Production Deployment
→ Attendance / Leave / WFM / Payroll
→ Operations / Quality / Goals / Coaching / Upskilling
→ Promotion / Transfer / Retention / PIP
→ Resignation / Exit / Clearance / Asset Recovery / F&F
→ Relieving / Experience Letter / Alumni / Rehire Eligibility
→ Attrition and Backfill Analytics / Client Delivery Visibility
```

A candidate must convert into one employee record; no disconnected duplicate employee identity may be created in downstream modules.

## 5.2 Client confidence journey

```text
Client Demand / SLA / SOW
→ Approved Workforce Requirement
→ Hiring and Joining Pipeline Aggregate
→ Training / Certification / Handover Readiness
→ Rostered / Available / Deployed HC Aggregate
→ Operations SLA / Quality / Staffing Risk
→ Root Cause / Action Plan / Governance Review
→ Client Request / Escalation / Acknowledgement
→ Published Reports / Closure / Commercial Readiness
```

The Client Portal never exposes private employee/candidate/payroll/document/grievance/raw-audit data.

## 5.3 Weekly roster governance journey

```text
Required HC by Process / Day / Shift
→ Process Manager Reviews Available Certified Workforce
→ TL / AM Allocation and Weekly-Off Planning
→ Draft Roster
→ Leave / Conflict / Coverage / Eligibility Validation
→ Process Manager Publication
→ Employee Acknowledgement
→ Daily Attendance / Login / Break / Adherence Capture
→ Planned vs Unplanned Variance Classification
→ Shift/WO Swap and Post-Publication Change Tracking
→ TL / AM / Process Manager Accountability
→ WFM and Client-Approved Aggregate Reporting
→ Attendance Lock / Payroll-Input Readiness
```

## 5.4 Integration ingestion journey

```text
Manual CSV/XLSX Upload OR Read-only DB Connector OR API/File Feed OR LMS/Device Adapter
→ Source Selection and Upload/Connection Run
→ Column/Header Discovery
→ Mapping Builder Against Canonical mas_hrms Fields
→ Transformation / Validation / Duplicate Control / Dry Run
→ User Approval for Import Where Required
→ Raw/Staging Load
→ Canonical Processing / Snapshot / Error Queue
→ Reconciliation and Lineage
→ Internal Dashboard and Approved Published Client Layer
→ Continuous Scheduled/Incremental Sync with Health Monitoring
```

---

# 6. Complete Product Pillars and Mandatory Capability Scope

## 6.1 Platform, organisation, workflow and audit

Build/complete:

- company/legal entity, branch, department, client, process, LOB, campaign, cost centre and location masters;
- designation, grade, band, reporting hierarchy and skill/eligibility mapping;
- backend RBAC, row scope, delegation, temporary access and access-review logs;
- reusable approval workflow engine with levels, SLAs, escalation, remarks, evidence and maker-checker;
- configurable policies with effective dates and version history;
- universal audit event trail and sensitive-export logging;
- notification centre, work inbox, reminders, escalations and scheduled jobs;
- configurable task management integrated with actions, due dates, owners, escalations and closure evidence.

## 6.2 ATS, walk-in and joining ecosystem

Build/complete:

- client/WFM/manpower requisition linkage and approval;
- public jobs landing page, role/process/branch vacancy publishing and candidate application;
- walk-in queue/token/branch handling and recruiter assignment;
- candidate consent/privacy/retention, resume and document handling;
- duplicate control by mobile/email and recruiter/source accountability;
- configurable screening questions, typing/reading/voice/communication assessments and process thresholds;
- recruiter, operations and client interview stages where required;
- offers, digital acceptance, BGV, joining reminders, no-show and joining conversion;
- candidate-to-employee conversion with complete recruitment lineage;
- recruiter/source/sub-source/branch/process funnel analytics;
- preserve existing Candidate Web Form and Recruiter Mobile App workflows and integrate rather than break them.

## 6.3 Employee core, HR service and lifecycle

Build/complete:

- employee 360 profile and journey timeline;
- onboarding checklist, probation, confirmation, transfer, promotion, increment and role changes;
- employee documents metadata, verification, expiry, access controls, download audit and letters;
- helpdesk/service catalogue with SLA and secure grievances/POSH/disciplinary workflows;
- employee communication/notification history;
- resignation, notice, clearance, asset return, access revocation, F&F, relieving/experience letter, rehire eligibility and alumni record;
- confidentiality boundaries for grievance, disciplinary, payroll and personal records.

## 6.4 Assets, administration and procurement linkage

Build/complete:

- asset category/master/inventory/serial/condition/location;
- assignment, acknowledgement, transfer, repair, lost/damaged, recovery and exit clearance;
- IT/admin access provisioning and deprovisioning checklist;
- procurement request, vendor linkage, asset purchase/reference and administrative reports;
- evidence/attachment and audit controls.

## 6.5 Employee benefits, wellbeing, claims and financial services

Build configurable workflows for:

- benefit plans, eligibility, enrolment, dependants and claim status;
- insurance/welfare/transport/cab eligibility where applicable;
- employee loan/salary advance request, approval, disbursement and recovery;
- expense and reimbursement claims;
- benefits or claims recovery/reconciliation during payroll and F&F;
- recognition, engagement/pulse surveys and retention indicators;
- no real benefit/payroll settlement activation until approved policies and calculations are validated.

## 6.6 Shift, roster and workforce governance — first-class pillar

### Shift management

Build/complete:

- process/branch-specific shift templates;
- effective dates, versions and active/inactive controls;
- start/end time, productive minutes, grace-time, break entitlement and shift policy;
- weekly-off patterns, rotational shifts, night-shift/allowance/transport readiness flags;
- eligibility and compliance checks;
- change audit and future payroll-input hooks.

### Weekly roster management

Build/complete:

- weekly roster cycle by process/branch/team and required HC by day/shift;
- availability, certified-readiness, approved-leave and notice/exit checks;
- team/TL/AM allocation and weekly-off planning;
- status lifecycle: draft → submitted → reviewed → published → acknowledged → active → variance review → attendance locked → payroll-input ready → closed;
- Process Manager publication authority for mapped process;
- roster versioning and mandatory reason/audit for post-publication change;
- employee own-roster display, acknowledgement and eligible swap requests;
- shift and week-off swap eligibility, recommendations, approvals and notifications;
- conflict validation and escalation.

### Accountability and governance

Measure and action:

- on-time roster publication;
- required versus rostered HC and coverage;
- planned versus unplanned shrinkage;
- week-off swaps and shift-change rate;
- post-publication changes;
- late login, no-show, absenteeism and early logout;
- coverage recovery and exception closure;
- TL/AM/Process Manager accountability with root cause, owner, due date, escalation and closure proof;
- approved aggregate outputs for Client Portal only.

## 6.7 Attendance, leave, WFM and RTA

Build/complete:

- attendance from roster, login/punch, external-device staging and validated sessions;
- breaks, adherence, late/early/no-show, regularisation and manager action;
- leave policy, accrual, balances, approvals, holidays, comp-off, LOP-ready outputs and staffing-impact checks;
- demand/forecast/capacity, deployed versus required HC, staffing shortage and backfill;
- real-time intraday/RTA boards, absence alerts, break overrun, SLA risk and action closure;
- planned/unplanned shrinkage causes and trend reporting;
- attrition linked to approved exit flow, not competing exit source of truth;
- payroll-input readiness only until payroll rules are approved.

## 6.8 Payroll, statutory, payslip and F&F

Build a secure configurable payroll system in MySQL with:

- salary structures, earning/deduction components, revisions and approvals;
- monthly payroll preparation/runs/lock/approval/disbursement/reconciliation;
- attendance/leave/LOP/OT/comp-off/incentive/advance input contract;
- payslip secure generation/history/acknowledgement for employee self only;
- tax declarations and effective-dated statutory configuration;
- PF/UAN, ESIC, PT/LWF where applicable, tax/TDS, gratuity, salary advance and recoveries;
- exit-linked F&F, notice recovery/payable, leave encashment, asset/advance recovery and final documents;
- maker-checker controls, audit and no payroll exposure to Client Portal.

High-stakes rule: no statutory/payroll computation may become final payable production logic unless it is based on approved effective-dated configuration, verified calculations, role security, reconciliation and owner approval.

## 6.9 Existing LMS integration and upskilling analytics

Build MySQL integration scaffolding and later approved sync for:

- learner/employee, batch/process/branch/LOB mapping;
- completion, assessment, certification, handover, refresher and risk snapshots;
- TNI/refresher linkage from Quality/Performance;
- employee learning view, manager readiness and leadership training analytics;
- skills inventory, skill-gap/upskilling analytics, learning outcome versus performance and internal mobility readiness;
- Client Portal aggregate certification/readiness feed only.

Do not rebuild LMS content, learning delivery, MCQ engine or certification operations.

## 6.10 Operations, Quality, Call Master, performance and goals

Build/complete:

- separate Operations KPI and Quality KPI families with effective-dated targets and definitions;
- process/branch/team/employee goal cycles, appraisal, review, calibration and PIP;
- approved Call Master/AI audit data contract and evidence linkage without overwriting existing Finnable work;
- QA score, fatal/critical issues, parameter trends, manual validation, dispute/calibration and coaching/TNI/CAPA;
- employee feedback acknowledgement and improvement closure;
- real-time task management for operational risks, ownership, due dates, SLA/escalation and completion proof;
- incentive-ready outputs only after approved payroll linkage;
- client-published approved and masked operations/quality summaries only.

## 6.11 Career, succession, mobility and talent review

Build/complete:

- career path and employee mobility preferences;
- skill inventory and role-readiness assessment;
- performance/potential review matrices where approved;
- promotion/succession planning for critical TL, AM, Process Manager and leadership roles;
- internal-mobility matching before external hiring where appropriate;
- upskilling recommendations linked to readiness gaps;
- restricted visibility for succession/talent decisions.

## 6.12 Client Portal — first-class delivery-governance product

The Client Portal is not a final reporting add-on. It is a secure client confidence workspace.

Build/complete:

- client master, portal users, relational process/LOB permissions, portal roles, access change log and session controls;
- OTP/session/MFA or step-up security where appropriate, immediate access revocation and export audit;
- contract/SOW/SLA master, metric definitions, target versions, entitlements and reporting rights;
- published-data layer: internal metrics must be reviewed/masked/published before client visibility where required;
- executive overview, process health and red/amber/green risk status;
- contracted/required/rostered/deployed HC, training pipeline, certified/handover readiness, staffing risks and backfill;
- hiring/joining funnel aggregate, not candidate PII;
- WFM/roster/coverage/planned-unplanned shrinkage/attrition aggregate views;
- approved operations SLA/KPI, quality/fatal trends and actions;
- glide paths, governance calendar, meeting minutes, action plan closure, management commentary, replies and acknowledgement;
- client request/escalation/change-request workflows including manpower request, process change, training request, quality calibration request and report request;
- controlled reports, downloads and complete export/access audit;
- commercial/billing-readiness summaries only where approved.

Never expose to clients:

- employee salary, payslip, PF/UAN, tax, bank or F&F details;
- personal employee documents, grievance or disciplinary cases;
- candidate PII/resumes/BGV detail;
- raw attendance reasons or employee-level roster unless contractually authorised and separately approved;
- raw/unapproved AI audit, transcript or customer PII;
- data of another client/process outside mapping.

## 6.13 ERP and commercial extensions

Build/complete:

- expense/reimbursement workflow;
- procurement, vendor master, vendor contracts and asset linkage;
- contract/SOW commercial terms and billing-unit definitions;
- invoice-readiness calculations using approved delivery evidence;
- billing-support packs, commercial variance, service-credit/penalty reference and finance export;
- cost centre/budget controls and finance-system integration interface;
- no attempt to become a full accounting ledger unless explicitly approved.

---

# 7. Integration Hub, Manual Upload and Continuous Data Flow — Mandatory

## 7.1 Multiple ingestion options

The platform must support multiple input modes for every major external-data domain:

1. **Manual Upload:** CSV/XLSX upload through admin UI with template download, header discovery, preview, validation, mapping and error download.
2. **Database Connector:** read-only connection framework for MySQL/SQL Server/PostgreSQL or approved source databases when credentials and scope are provided.
3. **API Connector:** secured REST/API ingestion with token management outside source control.
4. **Secure File Feed:** SFTP/cloud-drive/controlled folder or scheduled file ingestion where approved.
5. **LMS Connector:** read-only approved snapshot integration from the deployed LMS.
6. **Attendance/Device Feed:** controlled raw punch/log staging and validation.

## 7.2 Mapping and transformation engine

Build:

- source registry and source type;
- canonical destination tables/fields per domain;
- header/column discovery;
- mapping UI: source header → canonical `mas_hrms` field;
- transformation rules, data types, mandatory fields, default rules, normalisation and duplicate rules;
- mapping templates and version history;
- dry-run validation and preview before import;
- error row file/download and correction/retry;
- import approval where required;
- rollback/quarantine/void handling where logically safe;
- complete audit and lineage.

## 7.3 Continuous connector stream

When future external SQL/API/source credentials and approved datapoints are received, implement:

- read-only connector credentials stored securely outside Git;
- scheduled/incremental or watermark-based sync;
- raw/staging then canonical processing;
- duplicate/idempotency control;
- errors, retries, reruns and partial failure handling;
- reconciliation counts and mapping exceptions;
- stale-source and failed-run alerts;
- data-freshness indicators on dashboards;
- lineage from a displayed metric back to source, mapping version and run;
- no writeback to source systems without separate approval.

## 7.4 Domains requiring ingestion support

Build adapter abstractions and mapping templates for:

| Domain | Expected Data Use |
|---|---|
| ATS external tools / source sheets | Candidate funnel, recruiter productivity, joining conversion |
| Attendance / biometric / dialer sources | Attendance, login, adherence and WFM |
| Call Master / Quality databases | Quality, audit evidence and operations insight |
| Deployed LMS | Progress, certification and training readiness snapshots |
| Client/Ops target sheets or systems | SLA, demand, targets and governance |
| Payroll controlled inputs | Approved import/reconciliation only |
| Legacy HR/employee data | Migration console and reconciliation |

Build locally/synthetically until approved live-source credentials and mappings are supplied.

---

# 8. Dashboards, Analytics and Reports

Build role-scoped interactive dashboards backed by real APIs, filters, exports and drilldowns.

## 8.1 HR Dashboard

Include headcount, joiners/exits, branch/process distribution, probation/confirmation, promotions/transfers, documents/compliance, grievance/helpdesk SLA, benefits, diversity where approved, attendance/leave risk, attrition and workforce health.

## 8.2 Recruitment Dashboard

Include demand versus pipeline, walk-ins, screening/selection/offers/joining, source/sub-source/recruiter conversion, duplicate/leakage flags, joining no-show, branch/process fulfilment and forecast gap.

## 8.3 Roster/WFM Dashboard

Include weekly publication compliance, required/rostered/available HC, shift allocation, WO/swap, post-publish change, adherence, planned/unplanned shrinkage, no-show, coverage recovery, TL/AM/PM accountability, RTA alerts and staffing risk.

## 8.4 Payroll/Compliance Dashboard

Include payroll readiness, exceptions, lock/approval, payslip status, statutory configuration readiness, advances/recoveries, F&F queue, compliance warnings and secure access audit. Never expose payroll through Client Portal.

## 8.5 Learning/Upskilling Dashboard

Include learner mapping completeness, batch/process training pipeline, completion, assessment, certification, handover, refresher/TNI, skills gap, internal mobility readiness and learning outcome trends from integrated LMS snapshots only.

## 8.6 Operations/Quality/Performance Dashboard

Include productivity, SLA/target, quality/fatal/critical, approved audit evidence, coaching/action closure, goals/appraisals/PIP, team risk, performance trends and client-published approved summary.

## 8.7 Leadership Command Centre

Include hiring, workforce, training readiness, roster/WFM, payroll cost/control, operations/quality, attrition/backfill, client health, compliance, audit, integration/system health and strategic actions.

## 8.8 Client Dashboard

Include only published approved process-scoped metrics: staffing/training readiness, SLA, quality trends, WFM/shrinkage aggregate, attrition/backfill, governance/actions, requests/escalations and controlled reports.

---

# 9. Health Check, Compliance, Security and Audit Control Tower

Build a dedicated internal **PeopleOS Health & Compliance Control Tower**.

## Technical health

- frontend/backend/API health;
- database connectivity and migration readiness;
- background jobs, queues, notifications and email/OTP health;
- upload/connector/sync run status, freshness, errors and reconciliation;
- storage/document upload health;
- Client Portal sessions/exports/access anomalies;
- performance/load monitoring and incident register.

## Business data health

- employees missing branch/process/reporting/role/salary/shift/LMS mappings;
- candidates stuck by stage or duplicate leakage;
- incomplete documents/assets/clearance;
- roster gaps, unpublished weeks, unresolved swaps/conflicts and payroll-readiness gaps;
- LMS sync gaps and certification mismatch;
- unapproved client-published data or stale snapshots;
- F&F/payroll unresolved controls.

## Compliance and audit

Build configurable registers/checklists, effective-dated policies and evidence tracking for:

- employee documents and statutory readiness;
- payroll/PF/UAN/ESIC/tax/gratuity/F&F controls after policy confirmation;
- leave/attendance/shift/roster compliance;
- POSH/grievance/disciplinary confidentiality controls;
- candidate consent/privacy/retention and export tracking;
- client SLA/governance/published-data commitments;
- connector/data-transfer audit and access reviews;
- maker-checker, release approvals and deployment readiness.

## Security hardening

Build/verify:

- backend row-scope enforcement and negative tests for each module;
- MFA/step-up design for privileged roles and sensitive operations;
- session listing/revocation and forced revocation on exit/access removal;
- OTP/rate limiting/lockout for Client Portal and login-sensitive flows;
- field-level masking for PII/payroll/bank/tax/PF/UAN/documents/client-sensitive records;
- export approval/audit where required;
- secrets held only in approved runtime environments;
- incident-response and security closure workflow.

---

# 10. Environment, Local Build and Deployment Strategy

Use isolated environments:

| Environment | Rule |
|---|---|
| Local (`mas_hrms_local` or equivalent) | Claude/developer migrations and synthetic/local tests are allowed. |
| Staging/UAT (`mas_hrms_staging` or equivalent) | Apply migrations only after explicit migration review/approval. |
| Production (`mas_hrms`) | Live application database; execute migrations/cutover only after explicit approval and UAT readiness. |

Before declaring deployment-ready, create and maintain:

- environment-variable inventory with placeholders only;
- complete additive migration chain and order;
- seed/master-data import templates;
- manual upload mapping templates;
- connector runbooks and credential-reference instructions;
- role-wise UAT scripts and acceptance checklist;
- security/negative-test report;
- load/performance/concurrency test report;
- data reconciliation report;
- backup/restore, rollback, disaster-recovery and business-continuity runbooks;
- cutover and post-go-live monitoring checklist;
- dependency inventory for Auth, Storage, LMS, external sources, email/OTP, hosting and schedulers.

---

# 11. Immediate Repository Position and Mandatory Next Action

PR #17 (Payroll / Payslip / Tax Declaration / F&F foundation) has already been merged into `main` on 29-May-2026. Treat its code as a **foundation only**, not active production-ready payroll.

Before any SQL execution, deployment or later payroll activation, implement a **Payroll/F&F Post-Merge Safety Validation and Corrective Package** on a clean branch. It must:

1. re-audit all payroll and F&F route roles and sensitive-read/write controls, including payroll run lists/lines/components where private data could be exposed;
2. verify employee self-service ownership uses server-side user-to-employee mapping;
3. verify `salary_payslip` service and migration are compatible with the existing `007_payroll.sql` table contract;
4. verify F&F cannot be approved when statutory values are provisional/unverified;
5. verify TDS projection is blocked/pending unless approved effective-dated configuration exists;
6. verify LWP deduction basis is configurable and not silently CTC-based without policy approval;
7. verify gratuity uses approved configurable eligible wage/rule/cap/exception handling before final approval;
8. verify maker-checker/audit for payroll, F&F and disbursement;
9. prove Client Portal exposes no payroll/F&F/statutory data;
10. add/extend tests for negative role, ownership, configuration-block and schema-contract cases;
11. do not execute `018_payroll_exit_completion.sql` or any SQL on staging/live databases;
12. merge corrective source-only PR when tests pass, then continue the packages below.

---

# 12. Autonomous Build Sequence — Execute Continuously

Continue in clean branches, add additive unexecuted MySQL migrations, build real APIs/UI/tests and squash-merge safe PRs after package gates pass.

## Package A — Charter Adoption and Architecture Consolidation

- retain this charter in repository docs;
- update `CLAUDE.md` with MySQL-first, protected-system, Client Portal, Roster Governance, ingestion and continuous-build rules;
- update one implementation tracker only;
- complete Payroll/F&F Post-Merge Safety Validation and Corrective Package described above.

## Package B — Roster & Shift Governance Completion

- shift templates/versioning/effective rules;
- weekly roster lifecycle, WO/swap/change, acknowledgement and validation;
- PM/AM/TL/employee/WFM portal flows;
- accountability/action closure and client-ready aggregate feed;
- tests and audit.

## Package C — Attendance, Leave, WFM and RTA Completion

- roster-attendance reconciliation;
- leave staffing impact and regularisation;
- adherence/no-show/break/coverage alerts;
- planned/unplanned shrinkage, forecast, capacity and payroll-readiness outputs;
- tests and dashboards.

## Package D — Integration Hub, Manual Upload and Continuous Data Stream Foundation

- source registry, CSV/XLSX upload, header mapping/transformation/dry run/error reports;
- connector adapter abstractions for DB/API/file/LMS/device sources;
- raw/staging/canonical/snapshot/lineage/errors/reconciliation models;
- scheduler/run monitor/health views with synthetic/local data only;
- tests.

## Package E — Operations, Quality, Call Master, Tasks, Performance and Goals

- separate Operations and Quality KPI engines;
- goal cycles and performance review/PIP/calibration;
- Call Master approved data/evidence contract and safe Finnable integration boundary;
- coaching/TNI/CAPA;
- real-time task/actions/escalations;
- approved publish hooks and tests.

## Package F — Client Portal Expansion 1

- relational client access/role/process permission model;
- contract/SOW/SLA/entitlement/target version masters;
- internal client-admin protections;
- client request/escalation/change request workflow;
- published metric/report snapshot and export-audit layer;
- session/security hardening and negative isolation tests.

## Package G — LMS Integration Scaffold and Upskilling Analytics

- MySQL mappings/snapshots/sync/error/lineage models;
- connector interfaces only; no live LMS call;
- progress/certification/handover/risk APIs;
- skill/upskilling/TNI analytics and client-approved readiness feed;
- tests.

## Package H — Client Portal Expansion 2

- full client UI/API tabs: executive, workforce, hiring, training, roster/shrinkage, operations, quality, attrition/backfill, governance/actions, requests and reports;
- published-data-only consumption;
- acknowledgements/replies/exports and tests.

## Package I — Benefits, Engagement, Career and HR Analytics

- benefits, dependants, claims and eligibility;
- engagement/pulse/recognition/retention analytics;
- HR dashboard and compliance monitoring;
- career/mobility/succession and secure analytics;
- tests.

## Package J — ERP and Commercial Extensions

- expenses/reimbursements, procurement, vendor/contract and asset linkage;
- SOW/commercial/billing-readiness, finance export and cost-centre/budget controls;
- tests.

## Package K — Complete Role-Based UI, Mobile/PWA and Usability

- functional pages/actions for every portal and workflow;
- no mock-only or dead screens;
- real API states, filters, drilldowns, export and responsive/PWA usability;
- consistent premium design and accessibility checks.

## Package L — Health, Compliance, Integration Readiness and Deployment Package

- Health & Compliance Control Tower;
- data quality/reconciliation, notifications and scheduled jobs;
- full security and privacy test report;
- load/performance testing;
- templates/mapping docs/runbooks;
- staging/UAT/go-live/rollback readiness status.

## Package M — Account Control and Password Recovery

> Added 2026-05-30 by owner instruction.

- Employee forgot-password self-service flow (Supabase Auth reset email; MySQL audit).
- Admin: reset password / send reset link / set temporary password.
- Admin: force-password-change flag, account unlock, account disable, session revocation.
- MySQL-authoritative `account_control_log`: every reset/lock/unlock/disable action
  is written to `sensitive_action_log` with actor, reason, and IP.
- Admin must never receive, store or log actual passwords.
- Supabase Auth remains the login provider; MySQL tracks status, reset intent and audit only.
- Employee self-service portal page: change password, active sessions, security log.
- Admin HR page: account status per employee, unlock controls, audit trail.
- Tests: reset flow, admin-reset audit, disable/enable, session revoke, no-plaintext-password invariant.

**Integration points:** Package C RTA (session termination on no-show detection), Package F Client Portal
(client-user account control).

## Package N — Workforce Mandate and Capacity Planning

> Added 2026-05-30 by owner instruction.

- Per Client/Process/Branch/LOB/Role Group: mandated HC, buffer %, shrinkage %, attrition buffer,
  training buffer, effective dates.
- Bifurcated **Production HC** and **Support HC** (TL, QA, RTM/RTA, SME, AM, Process Manager,
  Manager, Trainer, WFM, MIS, HR/IT support).
- Support ratio rules: 1 TL per X agents, 1 QA per X agents, 1 RTM per X agents,
  1 Trainer per batch/trainee count.
- Calculated outputs: Target HC, Active Eligible HC, On-Notice HC, Training Pipeline,
  Certified-Pending-Deployment, Joining-Confirmed, Shortage/Surplus.
- Data sources (read-only aggregates): Employee Master, ATS pipeline, LMS snapshots,
  Exit/Notice, Leave, Roster, Attendance/WFM, Client SOW/SLA.
- Client Portal (Package F/H): approved aggregate staffing readiness only — no employee detail.
- Leadership dashboard: HC summary per process/client with trend and shortage alerts.
- Hard gate: no SOW/SLA data written to MySQL without explicit owner approval.

**Integration points:** Package C shrinkage snapshots (feed into capacity model),
Package D Integration Hub (source registry for HC feeds),
Package F/H Client Portal staffing readiness tab,
Package E Operations KPI (headcount efficiency metrics).

---

# 13. Continuous Build Permission and Hard Gates

## Claude may continue automatically with

- clean feature branches;
- source-code implementation;
- additive MySQL migration files not executed on staging/live systems;
- Express APIs, React UI and local/synthetic job/connector scaffolds;
- local database tests and automated builds;
- test-driven security corrections;
- PR creation and squash merge after all package gates pass;
- immediately starting the next package after safe merge;
- concise package status updates rather than routine approval requests.

## Claude must stop only for a hard gate

Stop and request explicit owner decision before:

1. executing SQL/migrations/data changes on staging or live `mas_hrms`;
2. any manual staging/live/production deployment or cutover;
3. hosted secret, key, credential or environment-variable changes;
4. connecting to, extracting from or modifying any live upstream operational database;
5. connecting to or modifying the live deployed LMS or deciding its live auth contract;
6. activating payroll/statutory/F&F calculations for real salaries or resolving unconfirmed policy/legal rules;
7. destructive migration, production data backfill or deletion/replacement of working functionality;
8. publishing client-visible metric/data/report outputs without approved mapping/masking/publication rules;
9. an unresolved security/privacy flaw that could expose PII, salary, tax, PF/UAN, bank, documents, grievance, candidate, client or customer data;
10. production go-live approval, UAT acceptance or rollback decision.

Do not stop for routine coding, unexecuted additive migrations, local tests, PR creation, safe merge or starting the next package.

---

# 14. Package Quality Gates Before Automatic Merge

Before merging any autonomous source-only package, confirm:

- frontend and backend builds pass;
- backend automated tests pass and new security/privacy negative tests cover changed sensitive flows;
- typecheck introduces no new unresolved errors;
- database migration is additive/compatible and remains unexecuted on staging/live;
- no protected working flow is removed or broken;
- backend role and row-scope controls are enforced;
- no client PII/payroll/internal-HR leakage is created;
- no secret is committed;
- PR description honestly lists scope, tests and remaining live activation gates.

After each merge, report only:

- package/PR merged;
- modules delivered;
- test/build status;
- migrations created but not executed;
- next package started;
- any true hard gate requiring owner decision.

---

# 15. Definition of Deployment-Ready Completion

Do not claim 100% deployment readiness because tables, routes or UI cards exist. The source codebase is deployment-ready only when:

| Readiness Area | Required Evidence |
|---|---|
| Functional modules | All approved lifecycle, delivery, client and administrative workflows implemented through real APIs/UI. |
| MySQL schema | Complete additive migration chain validated in local/staging and mapped to every module. |
| User journeys | Candidate-to-exit, roster, payroll, performance, client and integration journeys pass UAT scripts. |
| Security/privacy | RBAC, row scope, client isolation, PII masking/export and negative tests pass. |
| Payroll/statutory | Approved effective-dated configuration, calculations, maker-checker and reconciliation are validated before live use. |
| Roster/WFM | Weekly governance, adherence, shrinkage, accountability and payroll-readiness flows work. |
| Client Portal | Published-data isolation, governance, requests, reports and export audit work without sensitive leakage. |
| Integration Hub | Manual upload, mapping, connector abstraction, errors, lineage and health operate with test data; live sources await hard-gate approval. |
| LMS | Integration scaffold is ready; live connection and data contract await hard-gate approval. |
| Compliance/Health | Control tower, audit, data quality, notifications, incident and compliance registers function. |
| Performance | Goals, operations/quality, coaching/TNI/PIP and leadership analytics operate securely. |
| ERP/commercial | Approved expense/procurement/contract/billing-readiness workflows exist. |
| Reliability | Load/security testing, backup/recovery, disaster recovery, runbooks and monitoring are complete. |
| Deployment | Environment inventory, migration plan, UAT signoff template, cutover and rollback plan are complete. |

The end state is a secure, connected, MySQL-first PeopleOS platform supporting MAS Callnet from candidate demand and walk-in through employee exit, while giving operations leadership and each authorised client controlled evidence of delivery performance and governance.
