# Local role-dashboard validation — 2026-07-23

## Boundary

This evidence was collected from the local frontend and backend only. No production
checkout, production process, Nginx configuration, or production database write was
used. The authenticated route sweep used an authorized local Super Admin identity.
It does not replace twelve-account staging RBAC validation or business-owner metric
reconciliation.

## Automated results

| Gate | Result |
|---|---|
| Backend dashboard suites | 29/29 passed |
| Active-workspace frontend dashboard contracts | 64/64 passed |
| Frontend TypeScript | Passed |
| Backend TypeScript | Passed |
| Frontend production build | Passed |
| Backend production build | Passed |
| Local backend health | HTTP 200; database and migrations reported healthy |

Old test files under `.worktrees/` were explicitly excluded from the frontend
contract result because they are separate historical checkouts, not source in this
branch.

## Authenticated responsive route sweep

All twelve canonical routes were opened locally at:

- 1440 × 900
- 1280 × 800
- 768 × 1024
- 390 × 844

This produced 48 local screenshots. They are intentionally not committed because the
authenticated pages contain employee-identifying data. The employee dashboard was
also checked at tablet and mobile sizes: the correct heading rendered, access was not
restricted, employee export remained hidden, and no horizontal document overflow was
detected.

The login greeting's direct cross-origin IP-geolocation fallback was removed after it
produced a browser CORS error. A fresh authenticated Super Admin page load then
reported no browser console errors or failed API responses during the bounded
observation window.

## New checks in this increment

- Dashboard sidebar, quick-link, metric-link, and list-row navigation now use one
  page/role permission decision.
- Unknown routes fail closed and are not rendered as actions.
- Explicit disabled-page overrides are honored.
- Super Admin can open known catalogued routes without requiring duplicated page rows.
- Onboarding OTP verification is counted only through the scoped onboarding bridge.
- Aggregate dashboard CSV export is entitlement-checked and disabled for My Dashboard.
- Blob downloads time out instead of leaving the UI permanently busy.

## Runtime performance finding

The Super Admin page starts several independent source requests. In the local dataset,
the management, finance, ATS, operations, and executive-quality requests exceeded the
short observation window and occupied the browser connection queue. Consequently the
interactive CSV request did not reach the backend during the trace and the button
remained in its busy state until the new client timeout.

This is an unresolved production-readiness blocker. Query plans and endpoint timings
must be captured with an approved read-only staging connection, and slow sources must
be optimized or consolidated before approval.

## External gates still required

- Dedicated authenticated accounts for every role, including negative route/API tests
- Read-only staging metric reconciliation for every visible value
- Empty, dependency-error, unauthorized, and partial-data screenshots
- Accessibility tree and keyboard audit across all twelve dashboards
- Query-plan and API request-count comparison on representative staging data
- Business owner, security reviewer, and UAT approval
- Deployment window, immutable release SHA, backup paths, and rollback owner

These gates require external credentials, reviewers, or deployment authority and
cannot be self-approved by the implementation agent.
