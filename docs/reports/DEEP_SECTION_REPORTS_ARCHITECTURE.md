# HRMS2 BPO Reporting Architecture

## Goal

Create a reporting system suitable for a BPO operation without flooding users with hundreds of narrow exports. The primary reporting experience consists of a limited number of comprehensive master reports. Each master report combines the maximum useful information for one major BPO management domain.

The reporting architecture now has three layers:

1. **11 Comprehensive BPO Master Reports** — the primary downloadable operational and management reports.
2. **20 Deep Section Control Packs** — source coverage, schema health, exceptions, reconciliation and compliance control views.
3. **Detailed Report Library** — the existing detailed datasets retained for drill-down and investigation.

## User-facing routes

| Route | Purpose |
|---|---|
| `/reports` | Comprehensive BPO Master Reports |
| `/reports/control-room` | Deep Section source, readiness and compliance control room |
| `/reports/library` | Existing detailed report library |

## API routes

| Route | Purpose |
|---|---|
| `GET /api/reports/bpo-master` | Role-filtered BPO master report catalogue |
| `GET /api/reports/bpo-master/:code` | Execute, paginate or export one comprehensive BPO master report |
| `GET /api/reports/deep-sections` | Role-filtered section control catalogue |
| `GET /api/reports/deep-sections/:code/overview` | Schema-aware source and data-health overview |
| `GET /api/reports/suite/:reportCode` | Detailed report drill-down |

## Mandatory BPO report standards

Every BPO master report must comply with all of the following rules:

- `EMPLOYEE_CODE` is a mandatory output column.
- Employee-level reports use the actual HRMS employee code.
- Candidate reports use `PENDING EMPLOYEE CODE` until the employee code is generated.
- Branch/Client/Process aggregate reports use `AGGREGATE` rather than inventing an employee identity.
- `REPORT_DATE` is mandatory.
- Display date format is `DD-MMM-YYYY`, for example `25-JUL-2026`.
- Monthly periods use `MMM-YYYY`, for example `JUL-2026`.
- All report headers are uppercase.
- Every report declares a row grain and primary key.
- Missing or unavailable fields remain blank/unavailable; they are never converted to artificial zero.
- Branch scope is enforced on the backend and fails closed.
- Sensitive values are masked by the API when the user has view permission but lacks export permission.
- Full exports require the report's export role.

## Comprehensive BPO master reports

| Master report | Row grain | Main coverage |
|---|---|---|
| BPO Operations & Productivity Master | Employee / work date / Process-LOB | Shift, login, production, productivity, AHT, SLA, quality, shrinkage and actions |
| BPO Employee Performance 360 Master | Employee / report month | Productivity, quality, attendance, trend, rank, training, feedback, PIP and incentive eligibility |
| BPO Client SLA, Delivery & Commercial Master | Client / Process-LOB / date | Forecast, volume, backlog, staffing, SLA, TAT, quality, billing, penalty and client governance |
| BPO WFM, Attendance & Shrinkage Master | Employee / attendance date | Roster, biometric, attendance, leave, breaks, adherence, overtime, regularisation and payroll impact |
| BPO HR Workforce & Employee Lifecycle Master | Employee / report date | Employee master, organisation, joining, confirmation, documents, BGV, movements and exit readiness |
| BPO Payroll, Compensation & Statutory Master | Employee / payroll month / run | Attendance input, earnings, deductions, incentives, statutory, tax, payslip and disbursal |
| BPO Finance, P&L & Profitability Master | Branch / Client / Process-LOB / finance month | Commercial plan, revenue, cost, GRN, payable, cash, gross profit, EBITDA and period close |
| BPO Quality, Risk & Compliance Master | Employee / quality audit | Audit score, error taxonomy, fatal risk, calibration, RCA, CAPA and verification |
| BPO Recruitment, Onboarding & Training Readiness Master | Candidate or employee / requisition | Demand, source, funnel, offer, joining, documents, BGV, training, OJT and readiness |
| BPO Admin, Asset, IT & Facility Master | Employee / asset-access item / date | Asset custody, IT access, helpdesk, seat/facility, security and exit recovery |
| BPO Executive Management Master | Branch / Client / Process-LOB / month | Workforce, delivery, quality, attendance, attrition, cost, revenue, margin, risk and decisions |

Each report contains at least 45 governed columns and covers at least seven source domains. The architecture intentionally avoids separate micro-reports for every metric.

## Schema-aware execution

The BPO master report engine inspects `information_schema` and selects the widest recognised source available for each report. It then:

- maps existing source columns to standard uppercase output columns;
- joins employee and organisation masters when possible;
- applies date, Branch, Process, Client and employee filters only when the source can support them safely;
- returns column-coverage metadata;
- lists unavailable columns explicitly;
- reports the selected source table;
- returns `Unavailable` when no recognised source exists.

A source is never treated as complete merely because a table exists. The UI displays the percentage of the standard report columns that the current schema can populate.

## Branch and role security

- Section and master-report visibility is filtered by backend role.
- User role aliases are normalised, for example `quality_analyst → quality`, `payroll_head → payroll`, and `branch_hr → hr`.
- `resolveBranchScope` is reused across master reports, deep-section controls and detailed report routes.
- A non-global user without an authorised Branch receives no company-wide records.
- A user cannot change the Branch filter to access an unauthorised Branch.
- Detailed report view and export access is checked against the canonical report catalogue.

## Sensitive data handling

Sensitive columns include, depending on the report:

- salary, CTC, payroll and incentives;
- bank, PAN, UAN, ESIC and identity values;
- employee/candidate contact and address information;
- BGV findings;
- grievance, disciplinary and PIP information;
- client commercial rates, revenue, cost and margin;
- asset identifiers and system access values.

The API masks these values when the current user can view the report but does not have export authority. This prevents sensitive values from being recoverable through browser network responses.

## Deep Section control packs

The control room retains 20 business sections covering People, Recruitment, Attendance, Leave, WFM, Payroll, Statutory, Exit, Finance, Operations, Quality, Performance, Training, Assets, Support, Documents/Privacy, Engagement, Security, Integration/Data Quality and Visitor/Workplace.

Each section has six perspectives:

1. Overview
2. Trends
3. Detailed Register
4. Exceptions
5. Reconciliation
6. Compliance

These packs are not intended to create more downloadable micro-reports. They explain source health, control readiness, decision questions, compliance obligations and available drill-downs.

## Data-grain and duplicate controls

Every report declares:

- row grain;
- primary key;
- output columns;
- view and export roles;
- sensitive fields;
- source domains;
- control notes.

The UI checks displayed rows for duplicate primary-key signatures and raises a warning. It does not silently remove duplicates because duplicate rows may indicate a source-data or join defect.

## Accuracy rules

- `0` is valid only when a query successfully runs and the business value is zero.
- Missing table, missing column, unsafe scope or SQL error must be represented as unavailable/error.
- Target and achieved values must remain separate.
- Forecast and actual values must remain separate.
- Payroll calculation, payslip and disbursal values must remain separate.
- Budget, GRN gross amount, P&L-recognised cost, vendor payable and cash paid must remain separate.
- Raw biometric, processed attendance, regularisation and payroll impact must remain separate.
- Aggregate reports must be traceable to employee-level or transaction-level evidence.

## Detailed library preservation

The existing Reports Center V2 remains available at `/reports/library`. It is retained for narrow investigations and legacy consumers. The primary Reports page does not display 137 isolated tiles.

The high-risk and generic detailed-report engines now use shared report-catalog RBAC and backend Branch-scope enforcement.

## Validation gates

The focused reports workflow validates:

- frontend TypeScript typecheck;
- backend TypeScript typecheck;
- frontend production build;
- backend production build;
- 20-section pack contracts;
- 11 BPO master-report contracts;
- mandatory employee code and report date;
- uppercase and unique headers;
- minimum report depth;
- aggregate employee-code policy;
- sensitive-column declarations.

Before production release, authenticated UAT must additionally verify:

- all 11 master reports for representative roles;
- Branch and Process scope;
- no-scope fail-closed behaviour;
- sensitive masking;
- full export permissions;
- date and header formatting in Excel;
- duplicate-grain warnings;
- current production-schema column coverage;
- performance on full-month exports.

## Deployment safety

This reporting work is additive and read-only. It does not execute database migrations or modify production data. Merging, deployment, PM2 restart, Nginx changes and production rollout remain separate controlled actions.
