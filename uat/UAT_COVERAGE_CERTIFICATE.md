# UAT Coverage Certificate

This certifies what was actually tested/verified and how, not a completion percentage. Read
alongside `UAT_FINAL_REPORT.md` and `UAT_EXECUTIVE_SUMMARY.md`.

## Routes / pages

- **377 distinct route paths** enumerated via static analysis of `src/config/routes/*.tsx`
  (`uat/UAT_ROUTE_INVENTORY.csv`). 4 duplicate registrations found and confirmed harmless
  (identical redirect target both times).
- A separate, richer per-route traceability table (component, gate type/value, redirect target)
  for the first 88 rows already existed on `main` from a prior UAT session
  (`uat/UAT_ROUTE_TRACEABILITY.csv`) — preserved, not duplicated.
- **59 of 377 routes exercised via real browser automation** (Playwright, `e2e/*.smoke.ts`,
  headless Chromium) across admin/manager/team-leader/CEO/HR/TL demo identities — 26 passed
  clean, 33 failed (see `UAT_PENDING_ISSUES.csv` P008 for root-cause attribution). The
  remaining 318 routes were **not** individually browser-tested this session.
- chrome-devtools MCP (the primary intended browser-automation tool) could not connect for the
  entire session — see `UAT_PENDING_ISSUES.csv` P007. Playwright was used as the substitute,
  which is real browser automation (headless Chromium via CDP), not a mock.

## Roles

- 57 distinct role keys catalogued by a prior UAT session (`uat/UAT_ROLE_MATRIX.csv`), with a
  full dead-vs-live `roles=` prop analysis across every route file (Table A: 227 routes where
  the DB grant is sole authority; Table B: 17 routes where `roles=` is still genuinely live).
- This session directly exercised: `admin` (via demo-session injection, confirmed working
  end-to-end — real dashboard render with full navigation), and spot-checked DB grants for
  `hr`, `super_admin` on 3 page codes.
- `manager`/`team-leader`/other demo identities were exercised via the existing Playwright
  suite but the majority of those tests failed — attributed to the already-documented
  demo-identity role-resolution gap (project memory), not re-diagnosed to root cause this pass.

## Backend

- **Full test-baseline suite: 8581 tests, 0 failures**, run to completion this session.
- Migration-manifest guard: this session's own migration (1232) correctly registered and
  passing; one unrelated pre-existing failure from a different concurrent session's
  unregistered migration, not touched.

## Data readiness

- Process and Cost Centre gaps **directly re-queried live** this session (341/1332 and
  55/1332 respectively) — exact match to the brief's own cited figures, confirming the data
  is current, not stale. Full worklists produced.
- Leave-Attendance reconciliation **directly re-queried and classified live** this session
  (1459 mismatched employee-days, 99% attributable to legacy pre-launch migration rather than
  a live code defect — zero live leave approvals exist in the last 90 days to test the current
  code path against).
- Bank/PF/UAN/ESI/PT/TDS readiness figures in `uat/UAT_DATA_READINESS.csv` are **sourced from
  project memory** (prior deep audits in earlier sessions), explicitly labeled
  `verified_this_session: NO` — a live re-check was attempted for bank/IFSC and was blocked by
  a genuine DB connection-establishment degradation observed live during this session (see
  `UAT_PERFORMANCE_REPORT.md`). Do not treat these as freshly confirmed.

## Sections of the brief NOT reached this session

WFM readiness matrix (§3), Attendance+Leave matrix beyond leave-attendance reconciliation (§4),
Payroll matrix (§6), Statutory matrix (§7, beyond what project memory already records), Finance
matrix (§9), Reports/analytics matrix (§11, beyond the pre-existing report-catalog inventory on
`main`), Exit/F&F matrix (§12), and the full page-by-page dimension matrix (§14) for the 318
routes not covered by the Playwright run. These are recorded as open scope, not silently
dropped — see `UAT_PENDING_ISSUES.csv` P009.
