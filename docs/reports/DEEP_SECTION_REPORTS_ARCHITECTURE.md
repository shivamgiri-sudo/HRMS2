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

## Known limitations

This reporting suite is comprehensive within the existing schema boundary but has documented gaps where source tables or columns have not yet been migrated to production. Refer to the following documents for full gap analysis:

### Schema gaps — missing tables

`REPORT_COVERAGE_GAP_ANALYSIS.md` documents 14 missing tables identified as schema gaps for future phases:

- `branch_seat_capacity` (capacity reporting)
- `wfm_forecast` (forecast vs actual WFM)
- `rta_event` (real-time interval operations)
- `disciplinary_action` and `show_cause_notice` (grievance and disciplinary)
- `quality_calibration` (quality calibration)
- `client_escalation` (client escalation tracking)
- `pf_submission_log` and `esi_submission_log` (statutory filing)
- `user_access_review` (access review and certification)
- `budget_master` (budget vs actual)
- `grn_header` and `grn_line` (normalised GRN)
- `payment_receipt` (collections and receivables)
- `bcp_plan` and `incident_log` (business continuity)
- `risk_register` and `corrective_action` (risk and CAR)

All 14 missing tables are documented in the gap analysis with target phase and recommended report placement. No new master report codes are required; missing domains will be surfaced as sub-sections within the existing 14 reports once source tables are migrated.

### Event coverage gaps — missing journey evidence

`EMPLOYEE_JOURNEY_EVENT_GAPS.md` documents activity stages where immutable event records are missing:

- **BGV tables missing**: No `bgv_request` or `bgv_result` table exists; BGV events cannot be evidenced in the journey ledger until Phase 10 migration.
- **IT access tables missing**: No `it_access_log` or `it_provisioning` table; IT provisioning events cannot be evidenced.
- **Grievance table missing**: No `employee_grievance` table; grievance events cannot be evidenced (POSH Act compliance risk).
- **Disciplinary table missing**: No `disciplinary_action` table; disciplinary events cannot be evidenced (POSH Act compliance risk).

Additional gaps documented in the journey event analysis include partial evidence for requisition approval timestamps, offer approval timestamps, candidate sourcer identity, OTP/consent timestamps during onboarding, and trainer effectiveness scoring.

Where event evidence is missing, the journey ledger surfaces `UNAVAILABLE` status with lineage metadata documenting the missing source. Report consumers must not interpret these as data errors; they are documented future-phase backlog items.

## Source contract rules

All reports enforce authoritative source contracts documented in `MASTER_REPORT_SOURCE_CONTRACT_MATRIX.md`. Key rules:

### 1. Payroll earnings use salary_prep_line (not salary_master)

Canonical payroll computation results are in `salary_prep_line` (migration 007). `salary_master` is not a table in these migrations. `employee_salary_assignment` holds CTC configuration input; `salary_prep_line` holds final computed payroll output per run. Always join via `salary_prep_line.run_id → salary_prep_run.id` for payroll month context.

### 2. Attendance uses processed/final attendance for payroll reporting (not raw biometric)

Raw biometric is in `wfm_attendance_session` (login_time/logout_time). For payroll and compliance reporting the canonical source is `attendance_reconciliation_record` (migration 021). `payroll_readiness_flag` gates attendance locked for payroll. Never use raw `wfm_attendance_session` as the final attendance figure for payroll report rows.

### 3. P&L uses canonical allocation-aware P&L engine (bpoPnlAllocationOverlayService)

EBITDA, PBT, PAT and earned revenue are NOT stored columns. They are computed at query time by `bpoPnlAllocationOverlayService` and `bpoPnlService` (backend/src/modules/process-pnl/). Reports requiring offline P&L must materialise the output of this engine into a snapshot table; do not attempt to re-derive EBITDA by direct SQL sum.

### 4. Quality scores use db_audit.call_quality_assessment (external, fully qualified)

Confirmed via migration 505: quality assessment data lives in external `db_audit` database, not in `mas_hrms`. The source registry queries `information_schema.columns WHERE table_schema IN (DATABASE(), 'db_audit')`. Reports must use fully qualified reference `db_audit.call_quality_assessment` and handle cases where external database is unavailable (SOURCE_STATUS = TABLE_MISSING in offline environments).

### 5. Audit events use audit_action_log (canonical insert target per migrations 218/220)

`audit_action_log` is the canonical write target. `audit_log` is a structural alias created as `LIKE audit_action_log`; it exists only for backward compatibility. New governance adapters must read from and write to `audit_action_log`. For high-security events (salary, PII, statutory), use `sensitive_action_log` which additionally carries `old_value_json`, `new_value_json` and `actor_role` (migration 237). For security centre events use `security_audit_event` (migration 521).

### 6. Candidate pre-bridge uses PENDING EMPLOYEE CODE (not fabricated)

When a candidate has not yet been bridged to an employee record via `ats_onboarding_bridge`, the employee code in journey reports must be rendered as the literal string `'PENDING EMPLOYEE CODE'`. Report consumers must never fabricate an employee code for pre-employment rows and must treat `PENDING EMPLOYEE CODE` as a valid non-null status value, not as a data error.

## Reconciliation rules

Runtime source-to-report reconciliation rules are documented in `REPORT_RECONCILIATION_RESULTS.md` for:

### Payroll reconciliation
```
SUM(salary_prep_line.net_salary) by run_id
= salary_prep_run.total_net
= SUM(salary_payslip.net_pay)
= approved_disbursal_total (when available)
```

### P&L reconciliation
```
SUM(LOB_REVENUE + UNALLOCATED_REVENUE per process) = PROCESS_REVENUE
SUM(LOB_COST + SHARED_COST + UNALLOCATED_DIFF per process) = PROCESS_COST
PROCESS_REVENUE - PROCESS_COST = EBITDA
```

### GRN and payment reconciliation
```
GRN_GROSS_AMOUNT = SUM(GRN_ALLOCATION_GROSS per GRN)
VENDOR_PAYMENT_DUE = SUM(PAYMENT_ALLOCATION_GROSS per vendor)
PAID + OUTSTANDING = DUE
```

### Attendance reconciliation
```
PRESENT + ABSENT + LEAVE + WEEK_OFF + HOLIDAY = ROSTERED_DAYS (per approved attendance policy)
```

The reconciliation document includes results templates to be populated after live validation runs against staging/production-like databases. Build success does not certify data accuracy; numeric reconciliation is required for UAT sign-off.

## UAT procedure reference

Detailed departmental UAT checklists and acceptance criteria for all 14 master reports are documented in `BPO_MASTER_REPORT_UAT.md`. Each report has:

- Global acceptance criteria (employee code policy, date formatting, grain uniqueness, source lineage, branch scope, sensitive masking, export authority)
- Specific validation steps per report
- Reconciliation requirements
- Role-based test account requirements
- Business owner sign-off requirements

UAT checklists are organised by department (Operations, WFM, HR, Recruitment, Training, Quality, Payroll, Finance, Admin/IT, Audit/Compliance, Higher Management) to facilitate distributed UAT ownership.

The UAT document must be completed before the PR is marked ready or deployed.

## Validation endpoint permissions

The `/api/reports/bpo-master/validation/source-accuracy` endpoint executes all 14 reports with minimal sample data for runtime SQL validation, source availability, field coverage and grain verification.

This endpoint is restricted to elevated roles:
- super_admin
- admin
- hr_head
- payroll_head
- finance_head
- internal_auditor

Role aliases are normalised via `normalizeRoleAlias()` to allow compatible role names. General employees, team leaders and branch-scoped operational users do not have access to the validation endpoint.

The validation response deliberately keeps `valueAccuracyCertified: false` until source totals, report totals and business-owner sign-off are complete. Schema compatibility is not equivalent to business-value accuracy.

## Deployment safety

This reporting work is read-only and does not execute a database migration or modify production data. Merge, deployment, PM2 restart, Nginx change and production rollout remain separate controlled actions. The pull request remains draft until latest CI and authenticated production-schema UAT are complete.
