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

1. Run the preflight report.

```bash
scripts/production/preflight.sh
```

2. Confirm the live checkout is not being edited directly.

3. Compare the live source and runtime files against `origin/main`.

4. Classify drift before changing anything:

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

1. Create a clean temporary worktree from an exact commit SHA.
2. Build and test in the worktree only.
3. Generate a patch from the live `HEAD` to the target commit.
4. Check the patch against the live checkout before replacing anything.
5. Back up the live source, runtime, package, PM2, and health state.
6. Copy only the approved changed files into production.
7. Refresh backend dependencies with `npm ci`.
8. Restart only PM2 process `4`.
9. Verify the public and protected health routes.
10. Roll back immediately if any required check fails.

Example:

```bash
scripts/production/deploy-backend.sh <exact-commit-sha> src/modules/ats/__tests__/ats.fraud-ocr-face-match.test.ts
```

The deploy script refuses to guess a target commit. It requires the exact SHA to be supplied.

## Verification

Run the health check script after any deployment:

```bash
scripts/production/verify-health.sh
```

Expected checks:

- `/api/health` -> `200`
- `/api/ats-ext/assessment/health` -> `200`
- `/api/ats-ext/assessment` -> `200`
- `/api/ats-ext/assessment-admin/dashboard` -> `401`
- `/api/ats-ext/assessment-admin/template-builder` -> `200`
- `/api/ats-ext/assessment-template-builder` -> `308`
- `/api/ats/queue/public-display?branch=NOIDA` -> `200`

## Backup And Rollback

Backups are stored under:

```text
/home/masadmin/HRMS2-release-backups/
```

The backup script stores:

- current source files being deployed
- current compiled runtime files
- `backend/package.json`
- `backend/package-lock.json`
- PM2 process details
- current Git SHA
- current health results

Rollback uses only the saved backup directory and restores only the backed-up files.
It does not touch uploads, `.env`, database migrations, or face models.

Example:

```bash
scripts/production/rollback-backend.sh /home/masadmin/HRMS2-release-backups/<backup-dir>
```

## PR Hygiene

- PR #30 carries the ATS assessment routing fix.
- PR #31 carries the TensorFlow WASM face-runtime fix.
- PR #29 is superseded and should not be used for production deployment.

## Test Baseline

Keep the current backend baseline note here:

- `docs/TEST_BASELINE_2026-07-17.md`

