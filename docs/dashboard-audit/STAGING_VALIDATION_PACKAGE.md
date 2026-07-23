# Role Dashboard Staging Validation Package

## Status

Prepared on 2026-07-23 for pull request #45.

Automated source, contract, type, build, and route validation is complete. Authenticated
staging validation is blocked because the repository provides no staging application URL,
no staging deployment workflow, no read-only staging database configuration, and no
credentials for the twelve required roles.

Production identities listed in `ACTUAL_EMPLOYEE_TEST_ACCOUNTS.md` must not be used as a
substitute. That file contains no passwords and explicitly restricts the accounts to
authorized development or staging use.

## Automated Evidence

| Gate | Result |
|---|---|
| Backend dashboard tests | 28/28 passed |
| Frontend dashboard and shell contracts | 41/41 passed |
| Application shell routing contracts | 10/10 passed |
| Frontend TypeScript check | Passed |
| Backend TypeScript check | Passed |
| Frontend production build | Passed |
| Backend production build | Passed |
| Production changes | None |

## Required Staging Inputs

Provide all of the following before executing this package:

1. Staging frontend URL and API URL.
2. Twelve dedicated test accounts: Super Admin, CEO, HR, WFM, WFM Attendance,
   Payroll, Quality, Operations, Recruiter, IT Manager, Manager, and Employee.
3. Read-only staging MySQL credentials, restricted to the tables in
   `ROLE_DASHBOARD_INVENTORY.md`.
4. Approved representative branch, process, team, employee, and payroll run IDs.
5. Confirmation that screenshots may contain staging-only business data.

No production account, production write credential, or production database mutation is
required or permitted.

## Role Validation Matrix

For each role, validate the canonical route, direct-route access, sidebar visibility,
backend entitlement, assigned scope, unavailable/error behavior, freshness metadata,
drill-down permissions, export permissions, and quick-action permissions.

| Role | Route | Dashboard code | Required scope check |
|---|---|---|---|
| Super Admin | `/super-admin/dashboard` | `SUPER_ADMIN_DASHBOARD` | Explicit system/organisation access |
| CEO | `/ceo/dashboard` | `CEO_DASHBOARD` | Organisation |
| HR | `/hr/dashboard` | `HR_DASHBOARD` | Assigned organisation/branch/process |
| WFM | `/wfm/dashboard` | `WFM_DASHBOARD` | Assigned branch/process |
| WFM Attendance | `/wfm-attendance` | `WFM_ATTENDANCE_DASHBOARD` | Assigned branch/process |
| Payroll | `/payroll-hr/dashboard` | `PAYROLL_HR_DASHBOARD` | Assigned branch/process and selected run |
| Quality | `/quality-dashboard` | `QUALITY_DASHBOARD` | Assigned branch/process/team |
| Operations | `/operations-dashboard` | `OPERATIONS_DASHBOARD` | Assigned branch/process |
| Recruiter | `/recruiter-dashboard` | `RECRUITER_DASHBOARD` | Recruiter ownership and assigned scope |
| IT Manager | `/it/dashboard` | `IT_MANAGER_DASHBOARD` | Assigned branch |
| Manager | `/manager/dashboard` | `MANAGEMENT_DASHBOARD` | Direct and indirect reporting hierarchy |
| Employee | `/my-dashboard` | `EMPLOYEE_SELF_DASHBOARD` | Authenticated employee only |

Negative checks must include a dashboard code from another role, an unassigned branch,
an unassigned process, a missing assignment, and a user without an employee mapping.
Expected results are `403` for entitlement failures and an explicit scope-configuration
error for missing mappings; neither may render as zero or an empty success response.

## Metric Reconciliation Procedure

For every visible metric:

1. Record dashboard code, metric code, filters, scope, period, timezone, and `asOf`.
2. Capture the API response without authentication tokens.
3. Execute the documented numerator and denominator queries using read-only credentials.
4. Compare API value, numerator, denominator, target, prior period, and variance.
5. Record genuine zero separately from no records, unavailable source, missing mapping,
   unauthorized access, and dependency failure.
6. Require exact agreement for counts and currency. For percentages, require agreement
   after applying the metric's documented rounding rule.

Payroll reconciliation must use one explicitly selected payroll run. Attendance must keep
live biometric, processed attendance, and payroll-locked attendance separate. Quality
must derive pass/fail and weighted failure values from audit records. Recruitment must
retain zero-count stages and use event-based stage definitions.

## Responsive and State Evidence

Capture each dashboard at:

- Desktop: 1440 × 900
- Laptop: 1280 × 800
- Tablet: 768 × 1024
- Mobile: 390 × 844

For each role capture populated, empty, source-unavailable, unauthorized, and partial-data
states where applicable. Verify no horizontal page overflow, minimum text sizes, visible
scope and freshness, neutral unknown styling, accessible names, logical heading order,
clean console output, and expected API statuses.

Store approved staging evidence under `docs/dashboard-audit/evidence/<role>/`. Do not
commit authentication material, cookies, tokens, or unredacted sensitive personal data.

## Deployment and Rollback Confirmation

The repository's production workflow deploys only after a push to `main`. It builds both
applications, validates artifacts, stages frontend and backend distributions on the same
filesystem, moves the prior distributions into timestamped backup directories, restarts
the backend, and checks backend health.

Backend rollback is automatic when health or the protected endpoint check fails: the
failed distribution is moved aside, the timestamped backup is restored, and the backend
process is restarted. Frontend deployment uses the corresponding staged/live/backup
directory pattern.

Release approval must identify:

- approved pull request and immutable commit SHA;
- reviewer and UAT sign-off;
- deployment operator and maintenance window;
- previous known-good commit SHA;
- timestamped frontend and backend backup directories;
- health-check owner;
- rollback decision owner.

No manual server deployment, PM2 restart, Nginx change, migration, or production write is
part of this validation package.

## Local Performance Validation (2026-07-23)

- `GET /api/management/system-dashboard` improved from approximately 19.1 seconds
  to 3.34 seconds in the authenticated local runtime.
- Large module record totals now use MySQL metadata estimates instead of synchronous
  full-table counts. The response includes `recordCountEstimated: true`, and the UI
  labels these values as approximate; they must not be used for exact reconciliation.
- Independent workforce secondary panels execute concurrently, and date predicates
  used by attendance and leave panels are index-friendly.
- Backend dashboard contract tests: 28 passed across 8 files.
- Active frontend live-data contract: 26 passed.
- Backend and frontend TypeScript checks passed; the production frontend build passed.
- The shared database was saturated by orphaned, hours-old recruiter analytics queries
  from an earlier implementation. They were observed read-only and were not terminated.
  Workforce latency must therefore be remeasured in an isolated staging environment
  before approval.

The generic frontend test invocation also discovers stale suites inside `.worktrees/`;
those copies reported two failures and one import failure. The active-tree test passes
when `.worktrees/**` is excluded. Cleanup or separate validation of those worktrees is
outside this dashboard patch and must not be represented as an active-source failure.

## External Sign-off

The following cannot be self-approved by the implementation agent:

- authenticated staging/UAT acceptance;
- business-owner metric reconciliation acceptance;
- security/RBAC reviewer approval;
- production change approval;
- final deploy or rollback decision.
