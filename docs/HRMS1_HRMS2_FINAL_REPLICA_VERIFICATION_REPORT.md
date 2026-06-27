# HRMS1 / HRMS2 Final Replica Verification Report

Audit date: 2026-06-26

## Final Status

`NOT_REPLICA`

Do not describe HRMS1 as a complete replica of HRMS2. Current evidence fails at GitHub commit parity, local checkout parity, env parity, PM2/runtime parity, DB migration parity, and build parity.

## GitHub Remote State

Fresh `git ls-remote` results observed during the audit:

| Repo | Latest `main` commit |
| --- | --- |
| HRMS1 | `422d5c589859c4ae4d41fac6c99516e73612c7ab` |
| HRMS2 | `ea96f779d5f72f10111e0940c8fc4cf2f14696a8` |

GitHub code parity: failed.

Tracked remote diff from HRMS1 `main` to HRMS2 `main`:

```txt
M .github/workflows/deploy.yml
```

## Local Checkout State

| Item | HRMS1 | HRMS2 |
| --- | --- | --- |
| Local path | `C:\Users\shivamg\HRMS1` | `C:\Users\shivamg\Upgraded HRMS` |
| Branch | `main` | `main` |
| Local HEAD | `3556e59bfaec491f5415c9f1d3d910d113a7c683` | `ea96f779d5f72f10111e0940c8fc4cf2f14696a8` |
| Remote `origin/main` | `422d5c589859c4ae4d41fac6c99516e73612c7ab` | `ea96f779d5f72f10111e0940c8fc4cf2f14696a8` |
| Working tree | clean, behind origin by 16 commits | dirty: untracked `backend/debug-ncosec-schema.ts` |

Local commit parity: failed.

Tracked file parity: failed for current local checkouts. Earlier tracked file list comparison found `backend/src/modules/ats/ats-decision-emails.ts` present only on the HRMS2 side. Current remote tracked diff is narrower and shows `.github/workflows/deploy.yml` changed between remote heads.

## Env Parity

Failed. See `docs/HRMS1_HRMS2_ENV_PARITY_REPORT.md`.

Key mismatches include:

- `BGV_WEBHOOK_SECRET`: missing in HRMS1 `backend/.env`, present in HRMS2 `backend/.env`
- `ATS_FORM_API_KEY`: missing in HRMS1 `backend/.env`, present in HRMS2 `backend/.env`
- Different safe fingerprints for `NODE_ENV`, `JWT_SECRET`, `PORTAL_JWT_SECRET`, and `FRONTEND_URL`

## PM2 Parity

Unable to verify runtime parity. `pm2 list` showed no managed applications. Both local ecosystem configs point to `C:\Users\shivamg\Upgraded HRMS`, so HRMS1 does not have an independently verified HRMS1 PM2 config in this checkout.

## DB / Migration Parity

Failed. See `docs/HRMS1_HRMS2_DB_MIGRATION_PARITY_REPORT.md`.

Read-only DB check connected successfully, but these requested tables were missing:

- `payroll_upload_batch`
- `payroll_inactive_noc`
- `finance_budget_plan`
- `finance_grn_request`

Requested migration files `307_payroll_upload_readiness_noc_export.sql` and `308_budget_grn_imprest_vendor_payment.sql` were not found in either local repo.

## Build Parity

Failed. See `docs/HRMS1_HRMS2_BUILD_PARITY_REPORT.md`.

- HRMS1 backend build failed.
- HRMS1 frontend build passed and static smoke passed.
- HRMS2 backend build passed.
- HRMS2 frontend build failed because Vite could not be resolved locally.

## Runtime Route Parity

Unable to verify. No PM2 apps were running and local ports `5055` and `8085` were not listening.

## Reports Created

- `docs/HRMS1_HRMS2_ENV_PARITY_REPORT.md`
- `docs/HRMS1_HRMS2_PM2_PARITY_REPORT.md`
- `docs/HRMS1_HRMS2_DB_MIGRATION_PARITY_REPORT.md`
- `docs/HRMS1_HRMS2_BUILD_PARITY_REPORT.md`
- `docs/HRMS1_HRMS2_RUNTIME_ROUTE_PARITY_REPORT.md`
- `docs/HRMS1_HRMS2_FINAL_REPLICA_VERIFICATION_REPORT.md`

## Remaining Verification Needed

- Decide whether HRMS1 local should be pulled to latest `origin/main`; it is clean but behind by 16 commits.
- Resolve HRMS2 dirty/untracked file before any pull or deployment operation.
- Install or repair HRMS2 frontend dependencies so `vite` resolves.
- Install or repair HRMS1 backend dependencies and re-run backend build.
- Identify the canonical migration tracking table and confirm exact migration application history.
- Start or identify actual HRMS1 and HRMS2 runtime processes, then run the route/API smoke list.

## Decision Logic Applied

Because current GitHub HEADs differ and tracked remote content differs, the decision logic requires `NOT_REPLICA`.
