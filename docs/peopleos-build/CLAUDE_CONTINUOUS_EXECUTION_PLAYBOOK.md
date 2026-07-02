# MAS Callnet PeopleOS — Continuous Execution Playbook

## 1. Objective

Complete the PeopleOS platform by implementing one substantial PR package at a time, without stopping for repeated planning or documentation approvals.

Claude should investigate the current code, implement the approved package, run tests/builds, push a branch and create a PR. Stop only at a hard approval gate.

## 2. Confirmed Architecture

* MySQL `mas_hrms` is the writable PeopleOS / HRMS application database.
* Existing operational SQL database(s) are upstream source systems. Future integration may read approved data points into `mas_hrms` through controlled read-only connectors/sync only.
* Supabase Auth remains the authentication/session identity source.
* Supabase Storage and existing native Supabase flows remain protected until a tested migration/convergence path exists.
* MySQL role/scope records are authoritative for backend API security.
* Supabase roles/page visibility are transitional frontend visibility records only.
* The deployed internal LMS is the LMS operational system of record. HRMS integrates it only; HRMS must not rebuild LMS operations.
* No Store Manager role is required.
* Client Portal users may see only their mapped process/LOB approved summaries and must never see payroll, employee PII, candidate PII, confidential HR cases or another client's data.
* Operations performance and Quality performance remain separate score families.

## 3. Existing Flows That Must Be Preserved

Do not delete or silently replace:

* current Employee CRUD and employee journeys;
* existing ATS flow, Candidate Web Form and Recruiter Mobile App integrations;
* existing Leave, Attendance, WFM/Roster, KPI, Exit, Integration Hub and Client Portal foundations;
* existing Asset and Document Supabase/native flows until tested backend convergence exists;
* existing deployed LMS workflows;
* existing authentication and file-storage flows until replacement is tested.

## 4. Working Method

For every package:

1. Read `CLAUDE.md`, the implementation tracker and this playbook.
2. Inspect actual source/schema before editing.
3. Implement the package directly; do not stop for planning-only approval unless a hard gate occurs.
4. Use additive, non-destructive changes.
5. Add/update tests for implemented behaviour.
6. Update the implementation tracker only for completed or blocked items.
7. Run frontend and backend validation.
8. Commit only package files.
9. Push a package branch and create a PR to `main`.
10. Stop for PR review/merge.

Do not produce long repeated audit narratives. Report:

* files changed;
* API/schema/behaviour added;
* tests/build results;
* blockers;
* PR link;
* hard-gate confirmation.

## 5. Hard Approval Gates — Stop Before Action

Claude must stop and request approval before:

* running SQL on `mas_hrms` or any production/staging/live database;
* connecting to or modifying upstream operational source databases;
* changing real environment variables, credentials, secrets or hosting settings;
* manual deployment to Vercel, Railway, Supabase or LMS;
* modifying the independently deployed LMS;
* dropping tables, deleting working flows or destructive data migration;
* exposing employee, candidate, payroll or client-sensitive data;
* executing payroll runs, payout files, statutory filings or F&F results on real employees;
* merging PRs into `main`.

Claude does **not** need to stop before:

* implementing local source-code changes within the current approved package;
* creating additive migration files without executing them;
* running local builds/tests;
* updating package documentation;
* pushing a reviewed package branch and creating a PR.

## 6. Validation Required for Every PR

Run:

```bash
npm run build

cd backend
npm run typecheck
npm test
npm run build
```

Report any pre-existing failure separately from new failures.

Every PR report must confirm:

* no SQL executed unless separately approved;
* no upstream operational DB accessed or modified;
* no LMS operational code modified unless separately approved;
* no real secret committed;
* no manual deployment executed;
* no merge performed.

## 7. Development Packages

### Package 0-B — Security and Database Boundary Foundation

Complete current branch work:

* database-boundary rule in `CLAUDE.md`;
* Client Portal demo-bypass production hard block;
* Client Portal access logging using existing schema;
* read-only RBAC role-assignment reconciliation endpoint;
* negative security tests;
* boundary/security documentation.

### Package 1 — Organisation, Roles, Workflow and Audit Foundation

Branch after Package 0-B merge:

`phase-1/platform-foundation`

Implement, after checking what already exists:

* legal entity/client/branch/process/LOB/campaign/cost-centre master gaps;
* grade/band/designation/reporting hierarchy gaps;
* MySQL-authoritative role/scope administration;
* controlled role reconciliation/backfill workflow, with no silent permission elevation;
* shared approval workflow engine;
* policy-master foundation;
* sensitive action/export/audit logging framework.

Do not duplicate existing masters; extend what exists.

### Package 2 — Employee Lifecycle, Assets, Documents and HR Helpdesk

Branch:

`phase-2/employee-assets-documents`

Implement:

* confirmation, transfer, promotion, increment and employee journey enhancements;
* document metadata, verification, expiry and secure access logging;
* backend asset master, assignment, transfer, repair, return and exit-recovery linkage;
* HR/payroll/IT helpdesk ticket flow;
* restricted grievance workflow;
* employee letter/document generation foundation.

Preserve current Supabase storage and native flows until backend convergence is validated.

### Package 3 — ATS, Joining, Attendance, Leave and WFM Completion

Branch:

`phase-3/ats-wfm-completion`

Implement:

* manpower requisition and approval;
* vacancy/job application integration with existing ATS assets;
* screening/interview/offer/BGV extensions;
* duplicate-safe candidate-to-employee conversion;
* recruiter/source funnel analytics;
* attendance/leave reconciliation and regularisation;
* roster conflict/swap/approval improvements;
* workforce coverage, shrinkage, attrition and staffing-risk dashboards.

Preserve existing Candidate Web Form and Recruiter Mobile App flows.

### Package 4 — Payroll, Statutory, Exit and Full-and-Final

Branch:

`phase-4/payroll-exit-completion`

Implement locally only:

* payslip schema and secure payslip workflow;
* salary-component and payroll-input contract;
* attendance/leave/LOP/OT/incentive/advance deduction processing;
* PF/UAN, ESIC, PT/LWF rules where applicable;
* TDS/tax declaration/regime/projection design and tested calculation logic;
* gratuity;
* resignation approvals, notice period, asset clearance and exit interview;
* full-and-final calculation;
* payroll approval and bank-export readiness.

Do not execute a real payroll run, payout, filing or production SQL without approval.

### Package 5 — LMS Integration, Operations, Quality, Call Master and Client Portal

Branch:

`phase-5/integrations-performance-client`

Implement:

* LMS integration adapter/snapshot architecture using the approved available access method;
* employee-to-learner and batch/process mapping;
* training progress, certification, handover and risk summary sync;
* employee/manager/management learning summaries;
* Operations KPI and Quality KPI as separate score families;
* Call Master integration for approved AI/manual audit evidence;
* coaching/CAPA/PIP/performance summaries;
* Client Portal approved process-level performance and training aggregates;
* stronger export/access audit and masking.

Do not modify the deployed LMS or expose raw PII/client-restricted information.

If the LMS access method or external Call Master data access requires credentials/production connectivity, implement the adapter contracts and mock-free interfaces, document the blocker, and stop before real connection.

### Package 6 — ERP Extension, Migration, UAT and Release Readiness

Branch:

`phase-6/erp-uat-readiness`

Implement:

* expenses and reimbursement workflow;
* procurement request/approval;
* vendor and contract/SOW foundation;
* client billing readiness;
* cost centre/budget reporting foundation;
* controlled migration console enhancements;
* reconciliation reports;
* role/security negative-test suite;
* UAT checklists;
* backup/rollback and staging-release runbook.

Do not deploy or execute production migrations without approval.

## 8. PR Creation Rule

For each package, after validation:

* create a single focused PR;
* describe exact files changed and validation results;
* identify any intentionally deferred or blocked sub-scope;
* do not merge the PR;
* stop for review.
