# Production Deployment Runbook

This runbook covers the safe backend-only deployment path for the HRMS2 production checkout.
It is written for the live server layout that currently serves the ATS Candidate Assessment and TensorFlow WASM fixes.

## Scope

- Production root: `/var/www/HRMS2`
- Backend PM2 process: `4`
- Backend port: `5055`
- Preserve at all times:
  - `backend/.env`
  - `backend/private/ats-candidate-files/`
  - `backend/face-models/`

This workflow is release-identity driven:

- `FROM_SHA` must be the exact current production `HEAD`
- `TARGET_SHA` must be the exact release commit to deploy
- both SHAs must be full 40-character commit hashes
- the target commit must descend from the production base commit

Do not use these commands on production:

- `git reset --hard`
- `git clean -fd`
- `git pull origin main`
- `git checkout .`

## Required Environment

Set these before running the scripts:

```bash
export PROD_ROOT=/var/www/HRMS2
export BACKEND_DIR=/var/www/HRMS2/backend
export PM2_ID=4
export APP_PORT=5055
export BACKUP_ROOT=/home/masadmin/HRMS2-release-backups
```

## Inventory And Reconciliation

1. Run the preflight audit report.

```bash
scripts/production/preflight.sh audit
```

2. Run the deploy preflight immediately before any real release.

```bash
scripts/production/preflight.sh deploy
```

3. Confirm the live checkout is not being edited directly.

4. Compare the live source and runtime files against the release pair, not against a moving branch tip.

5. Classify drift before changing anything:

- `A` Approved deployed source change
- `B` Generated build artifact
- `C` Runtime or uploaded data
- `D` Environment or configuration file
- `E` Unrelated feature code already present in GitHub
- `F` Uncommitted production-only source change
- `G` Temporary or obsolete file
- `H` Unknown, requires owner review

## Deployment Workflow

The supported deployment path is:

1. Capture the current production `HEAD` as `FROM_SHA`.
2. Capture the intended release as `TARGET_SHA`.
3. Create a clean temporary worktree from `TARGET_SHA`.
4. Build and test in the worktree only.
5. Compare the release pair with `git diff --name-only FROM_SHA TARGET_SHA` and refuse frontend application changes.
6. Back up the live source, full compiled runtime, package state, PM2, and health state.
7. Stop PM2 process `4` before changing runtime dependencies.
8. Copy the compiled `backend/dist` tree from the worktree to production.
9. Copy the changed backend source files and package files into production.
10. Refresh backend dependencies with `npm ci`.
11. Restart only PM2 process `4`.
12. Verify the public and protected health routes.
13. Roll back immediately if any required check fails.
14. Use `--dry-run` to prove the workflow path without mutating production.

Example:

```bash
scripts/production/deploy-backend.sh \
  <from-sha> \
  <target-sha> \
  src/modules/ats/__tests__/ats.fraud-ocr-face-match.test.ts
```

The deploy script refuses to guess a release identity. It requires both exact SHAs to be supplied.

For a no-op proof run:

```bash
scripts/production/deploy-backend.sh --dry-run <from-sha> <target-sha> <test-path>
```

## Verification

Run the health check script after any deployment:

```bash
scripts/production/verify-health.sh
```

Expected checks:

- `/api/health` -> `200` and `success=true` when JSON is present
- `/api/ats-ext/assessment/health` -> `200` with `success=true`
- `/api/ats-ext/assessment/health` -> `data.status=<expected>` and the published candidate limit fields
- `/api/ats-ext/assessment` -> `200`
- `/api/ats-ext/assessment-admin/dashboard` -> `401`
- `/api/ats-ext/assessment-admin/template-builder` -> `200`
- `/api/ats-ext/assessment-template-builder` -> `308` with a `Location` header pointing to the canonical builder route
- `/api/ats/queue/public-display?branch=NOIDA` -> `200`

The expected assessment state can be supplied explicitly:

```bash
EXPECTED_ASSESSMENT_STATUS=enabled scripts/production/verify-health.sh
```

## Backup And Rollback

Backups are stored under:

```text
/home/masadmin/HRMS2-release-backups/
```

The backup script stores:

- current source files being deployed
- the full current `backend/dist` runtime tree
- `backend/package.json`
- `backend/package-lock.json`
- PM2 process details
- current Git SHA
- the production `FROM_SHA` and target `TARGET_SHA`
- current health results

Rollback uses only the saved backup directory and restores the full compiled runtime tree plus every backed-up source file.
If a source file was newly introduced by the deploy, rollback deletes it when it is not present in the backup.
It does not touch uploads, `.env`, database migrations, or face models.

Example:

```bash
scripts/production/rollback-backend.sh /home/masadmin/HRMS2-release-backups/<backup-dir>
```

Rollback also supports dry-run planning:

```bash
scripts/production/rollback-backend.sh --dry-run /home/masadmin/HRMS2-release-backups/<backup-dir>
```

## PR Hygiene

- PR #30 carries the ATS assessment routing fix.
- PR #31 carries the TensorFlow WASM face-runtime fix.
- PR #29 is superseded and should not be used for production deployment.

## Test Baseline

Keep the current backend baseline note here:

- `docs/TEST_BASELINE_2026-07-17.md`

## Sandbox Validation Matrix

The workflow scripts are validated in a sandbox before any production use.
The minimum matrix covers these 12 scenarios:

1. `preflight.sh audit` reports the live checkout without mutating anything.
2. `preflight.sh deploy` requires a single listener on port `5055`.
3. `deploy-backend.sh --dry-run` exits without mutating production.
4. Short `FROM_SHA` values are rejected.
5. Short `TARGET_SHA` values are rejected.
6. A target commit that is not a descendant of `FROM_SHA` is rejected.
7. Frontend application changes are rejected.
8. The compiled `backend/dist` tree is staged from the worktree, not copied from source files alone.
9. The backup directory captures the complete pre-deploy `backend/dist` tree.
10. Rollback restores deleted or newly introduced backend files correctly.
11. Rollback keeps protected uploads, `.env`, and face models untouched.
12. `rollback-backend.sh --dry-run` reports the planned restore without mutating production.
