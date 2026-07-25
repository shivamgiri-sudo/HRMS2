# Deep Section Reports Architecture

## Goal

Replace a difficult-to-navigate catalogue of 137 isolated report tiles with a limited set of governed, decision-ready section packs. The existing detailed report datasets remain the drill-down library; the new Reports V3 page organises them into business sections and adds schema health, source coverage, reconciliation and compliance context.

## User-facing routes

| Route | Purpose |
|---|---|
| `/reports` | Deep Section Reports control room |
| `/reports/library` | Existing detailed report library |

## API routes

| Route | Purpose |
|---|---|
| `GET /api/reports/deep-sections` | Role-filtered section catalogue |
| `GET /api/reports/deep-sections/:code` | One resolved section pack |
| `GET /api/reports/deep-sections/:code/overview` | Schema-aware source and data-health overview |
| `GET /api/reports/suite/:reportCode` | Existing detailed report drill-down |

## Report-pack structure

Every section pack contains exactly six perspectives:

1. **Overview** — executive metrics, source availability, freshness and control readiness.
2. **Trends** — movement over time and directional risk.
3. **Detailed Register** — row-level operational evidence with a declared grain and key.
4. **Exceptions** — items requiring owner action.
5. **Reconciliation** — consistency across source systems or lifecycle stages.
6. **Compliance** — approval, audit, privacy and statutory evidence.

A pack also declares:

- business owner;
- view and export roles;
- related operating pages;
- decisions the pack must support;
- compliance controls;
- sensitive data domains;
- candidate database sources;
- existing detailed report codes;
- planned/missing report codes.

## Covered sections

| Pack | Primary owners | Core areas |
|---|---|---|
| People, Organisation & Workforce | HR | Employee master, organisation, lifecycle, headcount |
| Recruitment, ATS, Onboarding & BGV | Recruitment / HR | Requisition, pipeline, offer, joining and verification |
| Attendance, Biometric & Regularisation | WFM / HR | Attendance, punch evidence, disputes and shrinkage |
| Leave, Holiday & Absence | HR / Payroll | Entitlement, utilisation, LWP and special leave |
| WFM, Roster, Capacity & Breaks | WFM / Operations | Forecast, roster, adherence, capacity and breaks |
| Payroll, Compensation & Disbursal | Payroll / Finance | Readiness, calculation, variance, disbursal and sign-off |
| Statutory, Tax & Labour Compliance | Payroll / Finance / HR | PF, ESIC, PT, TDS, filing and identity readiness |
| Exit, Separation & Attrition | HR / Payroll / Finance | Resignation, clearance, F&F and attrition |
| Finance, Vendor, GRN & Profitability | Finance / Accounts | Vendor, budget, GRN, payment, Process/LOB P&L and close |
| Operations, Productivity & Business Actions | Operations | Delivery, KPI, productivity and action governance |
| Quality, Audit & Process Risk | Quality | Audit, fatal errors, calibration and corrective action |
| Performance, KPI, Feedback & Career | HR / Operations | Goals, scorecards, feedback, PIP and career |
| Training, LMS & Certification | Training / HR | Curriculum, enrolment, assessment and certification |
| Assets, IT Provisioning & Service | IT / Administration | Inventory, custody, provisioning and service |
| Helpdesk, Grievance & Support | IT / HR / Support | Tickets, grievances, SLA and resolution |
| Documents, Identity, BGV & Privacy | HR / Compliance / Payroll | Documents, identity, consent, retention and privacy |
| Engagement, Communication & People Experience | HR | Recognition, surveys, feed, communication and experience |
| Security, Access, Audit & Policy | Security / Super Admin | Authentication, roles, privileged changes and audit |
| Integration, Migration & Data Quality | IT / Data Governance | Sync, identity mapping, migration and schema health |
| Visitor, Workplace & Facilities | Administration / Security | Visitor approval, check-in/out, badge and host mapping |

## Source-health contract

The overview endpoint inspects `information_schema` before reading a source table. Candidate table names are static catalogue values and must match `^[A-Za-z0-9_]+$`.

For each source group it returns:

- `available`, `missing` or `error` state;
- selected and alternative source tables;
- filtered row count;
- status breakdown when a supported status column exists;
- known issue count derived from exception-like statuses;
- latest activity timestamp;
- missing Branch and Process mappings;
- filters that were actually applicable to that table.

### Mandatory accuracy rule

A missing table, missing query capability or SQL failure must return **Unavailable/Error**. It must never be represented as zero. Zero is valid only when a query successfully executes and returns zero.

## Shared filters

The Reports V3 page provides:

- Month;
- From date;
- To date;
- authorised Branch;
- Process.

The overview service applies only filters supported by a table's real columns. Detailed report queries continue to use their existing filter contracts and branch-scoping controls.

## Data grain and duplicate controls

Every detailed report definition declares:

- row grain;
- primary key;
- columns and formats;
- view roles;
- export roles;
- source tables;
- calculation notes.

The UI checks duplicate keys in the displayed result and warns when multiple rows violate the declared grain. This is a diagnostic warning, not an automatic de-duplication step.

## RBAC and sensitive data

- Section visibility is filtered by authenticated role on the backend.
- Detailed report visibility remains governed by each report definition.
- Export requires both section-level and detailed-report export permission.
- Sensitive values are masked in the UI when the user lacks export-level permission.
- PII, salary, identity, bank, BGV, grievance, performance and security domains are explicitly declared per section.

## Compliance principles

Each pack must support:

1. clear business ownership;
2. approved source and calculation definition;
3. branch/process scoping;
4. evidence of approval or status lifecycle;
5. exception ownership;
6. reconciliation to upstream/downstream records;
7. privacy-aware viewing and export;
8. retention and audit evidence where relevant.

## Finance-specific reconciliation

The Finance pack must distinguish:

- budget amount;
- GRN gross amount;
- P&L recognised cost;
- vendor payable;
- cash paid;
- outstanding balance;
- recognition period;
- payment date;
- Process and LOB attribution;
- period-close snapshot.

These values must not be collapsed into a generic `actual` metric.

## Attendance-specific reconciliation

The Attendance pack must distinguish:

- rostered shift;
- raw biometric evidence;
- processed biometric minutes;
- final attendance status;
- regularisation or override;
- payroll-impacting payable/LWP values.

## Payroll-specific reconciliation

The Payroll pack must reconcile:

- attendance/payable days;
- earnings and deductions;
- gross, deductions and net pay;
- statutory contribution;
- bank/disbursal value;
- payslip generation and acknowledgement;
- final sign-off.

## Detailed library preservation

The existing Reports Center V2 remains available at `/reports/library`. V3 does not duplicate report SQL. It references detailed report definitions from the canonical catalogue and calls the existing `/api/reports/suite/:code` endpoint.

The legacy inline catalogue inside V2 remains technical debt and should be removed only after a separate parity test proves that the central catalogue contains every required definition and filter.

## Adding a new detailed report

A new detailed dataset must not be added merely because a stakeholder requests another export. Before implementation, define:

1. business question;
2. row grain;
3. primary key;
4. source tables;
5. calculation definition;
6. branch/process scope;
7. sensitive fields;
8. view and export roles;
9. reconciliation target;
10. owner and exception workflow.

Then:

- add it to the canonical report catalogue;
- implement the backend query;
- add it to one or more section perspectives;
- add schema and duplicate-grain tests;
- validate empty, unavailable and error states separately.

## Validation checklist

- Backend TypeScript typecheck;
- Frontend TypeScript typecheck;
- Backend build;
- Frontend build;
- deep-report pack contract tests;
- existing report schema-contract tests;
- role visibility tests;
- branch-scope tests;
- sensitive export tests;
- authenticated browser validation of `/reports` and `/reports/library`;
- representative report execution in each section;
- production-schema read-only source-coverage review.

## Deployment safety

This architecture is additive. It does not execute database migrations or alter production data. Production deployment, PM2 restart, Nginx changes and merging remain separate controlled actions.
