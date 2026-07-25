# HRMS2 BPO Reporting Architecture

## Goal

Create a reporting system suitable for a BPO operation without flooding users with hundreds of narrow exports. The primary reporting experience consists of a limited number of comprehensive master reports. Each report combines the maximum useful information for one major operational, people, financial or governance domain.

The reporting architecture has four layers:

1. **14 Comprehensive BPO Master Reports** — the primary downloadable operational, management and governance reports.
2. **Live Source Accuracy Validation** — runtime SQL, source availability, field coverage and report-grain verification.
3. **20 Deep Section Control Packs** — source coverage, schema health, exceptions, reconciliation and compliance views.
4. **Detailed Report Library** — existing drill-down datasets retained for investigation and legacy consumers.

## User-facing routes

| Route | Purpose |
|---|---|
| `/reports` | Comprehensive BPO Master Reports with lineage and verification metadata |
| `/reports/source-validation` | Live PASS/WARNING/FAIL source-accuracy matrix for all master reports |
| `/reports/control-room` | Deep Section source, readiness and compliance control room |
| `/reports/library` | Existing detailed report library |

## API routes

| Route | Purpose |
|---|---|
| `GET /api/reports/bpo-master` | Role-filtered master-report catalogue |
| `GET /api/reports/bpo-master/validation/source-accuracy` | Restricted runtime validation of all reports |
| `GET /api/reports/bpo-master/:code` | Execute, paginate or export one master report |
| `GET /api/reports/deep-sections` | Role-filtered section control catalogue |
| `GET /api/reports/deep-sections/:code/overview` | Schema/source and data-health overview |
| `GET /api/reports/suite/:reportCode` | Detailed report drill-down |

The validation route is declared before the dynamic `/:code` route.

## Mandatory BPO report standards

Every BPO master report must comply with all of the following rules:

- `EMPLOYEE_CODE` is mandatory.
- Employee-level rows use the actual HRMS employee code.
- Candidate events use `PENDING EMPLOYEE CODE` only until the onboarding bridge resolves an employee.
- Aggregate reports use `AGGREGATE`; they never invent an employee identity.
- `REPORT_DATE` is mandatory.
- Display date format is `DD-MMM-YYYY`, for example `25-JUL-2026`.
- Monthly periods use `MMM-YYYY`, for example `JUL-2026`.
- All headers are uppercase and unique.
- Every report declares a row grain and primary key.
- Missing sources remain unavailable; guessed synonyms are not used.
- `0` is shown only when a successfully executed source calculation returns zero.
- Branch scope is enforced by the backend and fails closed.
- Sensitive values are masked when a user may view but may not export.
- Full exports require the report-specific export role.
- Every populated field is classified as exact or derived and carries lineage metadata.

## Comprehensive BPO master reports

| Master report | Row grain | Main coverage |
|---|---|---|
| BPO Operations & Productivity Master | Employee / work date / Process-LOB | Shift, login, productive time, exact KPI metrics, AHT, SLA, Quality, breaks, shrinkage and actions |
| BPO Employee Performance 360 Master | Employee / report month | Attendance, KPI performance, score/rank, coaching, PIP, training and certification |
| BPO Client SLA, Delivery & Commercial Master | Client / Process-LOB / date | Delivery, staffing, SLA, Quality, billing, penalty, revenue and margin |
| BPO WFM, Attendance & Shrinkage Master | Employee / attendance date | Roster, biometric, session, break, reconciliation, regularisation and payroll impact |
| BPO HR Workforce & Employee Lifecycle Master | Employee / report date | Employee, organisation, address, probation, contract, lifecycle, documents, BGV, statutory and exit readiness |
| BPO Payroll, Compensation & Statutory Master | Employee / payroll month / run | Attendance inputs, earnings, deductions, statutory, bank, payslip and disbursal evidence |
| BPO Finance, P&L & Profitability Master | Branch / Client / Process-LOB / month | Canonical revenue, payroll cost, DSC, BMC, GRN allocation, budget, EBITDA, PBT and PAT |
| BPO Quality, Risk & Compliance Master | Employee / audit | Fully qualified audit source, score, checkpoints, fatal logic, evidence and source-backed compliance fields |
| BPO Recruitment, Onboarding & Training Readiness Master | Candidate / report date | ATS, stage history, offer, bridge, BGV, LMS and readiness |
| BPO Admin, Asset, IT & Facility Master | Employee / asset-access item / date | Asset custody, IT provisioning, auth access, helpdesk and exit recovery |
| BPO Executive Management Master | Branch / Client / Process-LOB / month | Canonical workforce, delivery, revenue, cost, profitability and management risk |
| BPO Audit, Compliance, Risk & Control Master | Audit/control event | General audit, sensitive audit, approvals, actors, subjects, old/new values, policy/risk evidence and CAPA metadata |
| BPO Interview-to-Exit Journey & Activity Ledger | Person / event timestamp / source record | Candidate creation, interviews, offer, onboarding, BGV, employment, lifecycle, leave, performance, payroll, exit and clearance |
| BPO Report Data Lineage, Reconciliation & Accuracy Master | Report field / source contract | Source table/column status, transformations, null/zero policy, grain, reconciliation and UAT state |

Every report contains at least 45 governed columns and covers at least seven source domains. The architecture intentionally avoids separate micro-reports for every metric.

## Verified execution paths

The production route does not use a generic “widest matching table” or guessed-column mapper. Execution order is:

1. runtime-safe governance adapters for Audit, Journey and Lineage;
2. runtime-schema-verified workforce adapters for Operations, WFM, Employee 360, HR and Payroll;
3. fail-closed verified business adapters for Quality, Recruitment and Admin;
4. the existing canonical allocation-aware BPO P&L engine for Client, Finance and Executive reports.

The former generic guessed report service and superseded workforce/governance adapters were removed.

## Runtime source registry

The source registry inspects `information_schema.columns` for the current HRMS database and approved external schemas.

Rules:

- unqualified tables resolve to the current HRMS database first;
- external Quality sources must be fully qualified, for example `db_audit.call_quality_assessment`;
- exact table and column existence is checked before generating SQL;
- a missing column is not replaced with a semantically unrelated field;
- the registry returns source schema, table, column and data type;
- source metadata is cached briefly and can be invalidated;
- runtime query failure is visible in the validation matrix.

## Source semantics

Examples of enforced semantic separation:

- `DIALS` is not treated as Tasks Completed or Productivity.
- KPI actuals use the runtime-supported score date and exact metric codes.
- Employee performance uses `management_kpi_summary.period`, `overall_score`, `rank_position` and `trend` where present.
- Payroll Basic uses `salary_prep_line.basic`; Net Pay uses `net_salary`.
- Raw biometric, processed attendance, reconciliation and payroll impact remain separate.
- Forecast, delivered and accepted units remain separate.
- Planned, earned, recognised, invoiced and collected revenue remain separate.
- Payroll cost, DSC, BMC, vendor/GRN cost and financial allocations remain separate.
- Canonical P&L field coverage is structural; a valid mapped field does not become unavailable merely because its current value is null.

## Audit and compliance controls

The Audit/Compliance master combines available records from:

- `audit_action_log`;
- `sensitive_action_log`;
- `approval_action_log`, `approval_request` and workflow metadata;
- employee/actor/subject identity;
- old, new and change values;
- request/evidence references;
- optional policy, privacy, statutory, risk and remediation metadata.

All event rows preserve:

- activity timestamp;
- actor raw ID and resolved employee identity;
- subject identity when available;
- source schema;
- source table;
- source record ID;
- request/evidence reference.

Optional JSON extraction is guarded with `JSON_VALID`, so plain-text approval summaries cannot break execution.

## Interview-to-exit journey ledger

The journey ledger creates a chronological union from available source events including:

- candidate creation;
- ATS stage transitions and interview progress;
- offers and acknowledgements where available;
- ATS-to-employee onboarding bridge;
- BGV checks;
- employee record creation;
- employee lifecycle events;
- leave and attendance regularisation;
- coaching and PIP;
- payroll processing;
- resignation/exit requests;
- exit approvals;
- departmental clearance.

Each event includes source record evidence, activity timestamp, status, actor/approver where sourced, previous/new state where sourced, per-person event sequence and days from the previous event. Missing event domains are not fabricated.

## Branch and role security

- Catalogue and report access are filtered by backend role.
- Role aliases are normalised for compatible operational roles.
- `resolveBranchScope` is applied to report execution and validation.
- A non-global user without authorised Branch scope receives no company-wide records.
- A user cannot change the Branch filter to access an unauthorised Branch.
- Pre-join candidates resolve through the bridged employee Branch or an exact ATS Branch-name match to `branch_master`.
- Unresolved pre-join Branch mappings are hidden from Branch-scoped users.
- Management-grade reports are not exposed to the general employee role.

## Sensitive data handling

Sensitive columns include, depending on the report:

- salary, CTC, payroll and incentives;
- bank, PAN, UAN, ESIC and identity values;
- employee/candidate contact and address information;
- BGV findings;
- grievance, disciplinary and PIP information;
- audit old/new values, IP and user-agent evidence;
- Client commercial rates, revenue, cost and margin;
- asset and system access identifiers.

The API masks these values when the current user may view the report but lacks export authority. This prevents restricted values from being recoverable from browser network responses.

## Field lineage and report verification

Each report response may include:

- exact mapped-field count;
- derived mapped-field count;
- unavailable-field count;
- source row count;
- distinct report-grain count;
- duplicate-grain count;
- source table set;
- per-column source schema/table/column;
- transformation description;
- exact/derived/unavailable confidence.

The primary report UI displays these counts and exposes per-column lineage in header tooltips.

## Live source-accuracy validation

`GET /api/reports/bpo-master/validation/source-accuracy` executes all 14 reports with a minimal sample for the selected reporting period.

It reports:

- PASS/WARNING/FAIL;
- runtime SQL failure;
- missing verified source;
- no-data conditions;
- field coverage;
- source and distinct-grain counts;
- duplicate grain;
- exact/derived/unavailable fields.

The validation response deliberately keeps `valueAccuracyCertified: false` until source totals, report totals and business-owner sign-off are complete. Schema compatibility is not equivalent to business-value accuracy.

## Deep Section control packs

The control room retains 20 sections covering People, Recruitment, Attendance, Leave, WFM, Payroll, Statutory, Exit, Finance, Operations, Quality, Performance, Training, Assets, Support, Documents/Privacy, Engagement, Security, Integration/Data Quality and Visitor/Workplace.

Each section includes Overview, Trends, Detailed Register, Exceptions, Reconciliation and Compliance perspectives. These packs explain source health and support investigation; they do not create hundreds of primary downloadable micro-reports.

## Detailed library preservation

The existing detailed library remains at `/reports/library` for narrow investigations and legacy consumers. The primary Reports page does not display 137 isolated tiles.

## Automated validation gates

The focused reporting workflow validates:

- frontend TypeScript typecheck;
- backend TypeScript typecheck;
- frontend production build;
- backend production build;
- 20-section pack contracts;
- 14 master-report contracts;
- mandatory employee code and report date;
- uppercase and unique headers;
- minimum report depth;
- aggregate employee-code policy;
- sensitive-column declarations;
- verified execution-path contracts;
- authoritative KPI/payroll source candidates;
- fully qualified external Quality source;
- fail-closed ATS Branch scope;
- Audit/Journey source-record evidence;
- live-validation route ordering;
- structural canonical P&L coverage.

## Required authenticated UAT

Before release, connected staging/production-like UAT must additionally verify:

- runtime execution of every report;
- source totals versus report totals;
- numeric reconciliation at declared grain;
- Branch/Process/Client and no-scope security;
- candidate Branch mapping;
- sensitive masking and export authority;
- date/header formatting in Excel;
- duplicate and orphan records;
- source freshness;
- full-month performance;
- Operations, HR, Payroll, Finance, Quality, Recruitment, Admin and Audit/Compliance owner sign-off.

A report suite must not be described as 100% value-accurate until these checks pass.

## Deployment safety

This reporting work is read-only and does not execute a database migration or modify production data. Merge, deployment, PM2 restart, Nginx change and production rollout remain separate controlled actions. The pull request remains draft until latest CI and authenticated production-schema UAT are complete.
