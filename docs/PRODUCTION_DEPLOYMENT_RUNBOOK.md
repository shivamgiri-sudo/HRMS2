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
  - `backend/eng.traineddata`

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
3. Confirm the release diff only touches allowed paths.
4. Create a clean temporary worktree from `TARGET_SHA`.
5. Build and test in the worktree only.
6. Stage the compiled runtime under `backend/dist.next-<TARGET_SHA>`.
7. Back up the live source, full compiled runtime, package state, PM2, and protected-hash state.
8. Stop PM2 process `4`.
9. Switch the production Git checkout to `TARGET_SHA`.
10. Rename `backend/dist` to `backend/dist.previous-<timestamp>` and activate `backend/dist.next-<TARGET_SHA>` as `backend/dist`.
11. Refresh backend dependencies with `npm ci`.
12. Restart only PM2 process `4`.
13. Verify the public and protected health routes, listener count, and PM2 online state.
14. Roll back immediately if any required check fails.
15. Use `--dry-run` to prove the workflow path without mutating production.
    Dry-run stages the runtime outside `PROD_ROOT`, clones a temporary validation repository outside production `.git`, uses deploy preflight, and prints staged checksum values instead of deployed ones.

Example:

```bash
scripts/production/deploy-backend.sh \
  <from-sha> \
  <target-sha> \
  src/modules/ats/__tests__/ats.fraud-ocr-face-match.test.ts
```

The deploy script refuses to guess a release identity. It requires both exact SHAs to be supplied.
It also refuses to deploy if the tracked checkout is dirty, if the release touches unsupported paths, or if the release changes protected runtime files.
Dry-run still proves the live checkout is eligible for deployment, but it never writes under `PROD_ROOT`, never stops PM2, never switches the production Git checkout, and never runs production `npm ci`.

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
- `/api/ats-ext/assessment-template-builder` -> `308` with a `Location` header exactly equal to `/api/ats-ext/assessment-admin/template-builder`
- `/api/ats/queue/public-display?branch=NOIDA` -> `200`
- exactly one listener must be present on port `5055`
- PM2 process `4` must be online

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
- release file manifests for added, modified, deleted, and total paths
- protected-path hashes for `backend/.env`, `backend/eng.traineddata`, `backend/private/ats-candidate-files/`, and `backend/face-models/`

Rollback uses only the saved backup directory and restores the full compiled runtime tree plus every backed-up source file.
It stops PM2 before touching the tracked checkout or backend dependencies, verifies zero listeners, switches the Git checkout back to `FROM_SHA`, runs `npm ci`, restores the backed-up runtime tree atomically, restarts PM2, verifies listener count and health, and keeps protected runtime data unchanged.
If a source file was newly introduced by the deploy, rollback deletes it when it is not present in the backup.
It does not touch uploads, `.env`, `eng.traineddata`, database migrations, or face models.
Cleanup is limited to the current deployment or rollback identifiers so unrelated `dist.previous-*` directories are preserved.
If rollback hits an intermediate failure, it continues attempting the remaining service-restoration steps and preserves the current release's temporary runtime directories for diagnosis until recovery fully succeeds.

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
The minimum matrix now covers these 56 scenarios:

1. `preflight.sh audit` reports the live checkout without mutating anything.
2. `preflight.sh deploy` rejects dirty tracked files and requires a single listener on port `5055`.
3. `deploy-backend.sh --dry-run` exits without mutating production.
4. Short `FROM_SHA` values are rejected.
5. Short `TARGET_SHA` values are rejected.
6. A target commit that is not a descendant of `FROM_SHA` is rejected.
7. Unsupported release paths are rejected.
8. Protected runtime files are rejected from the release diff.
9. Successful deployment moves Git `HEAD` to `TARGET_SHA` and leaves the tracked checkout clean.
10. The compiled `backend/dist` tree is staged from the worktree and activated by directory rename.
11. The backup directory captures the complete pre-deploy `backend/dist` tree.
12. Deployed checksums match the worktree checksums exactly.
13. Rollback restores deleted backend files and returns Git `HEAD` to `FROM_SHA`.
14. A checksum mismatch or `npm ci` failure triggers rollback.
15. Runtime rename failure triggers rollback.
16. `rollback-backend.sh --dry-run` reports the planned restore without mutating production.
17. `deploy-backend.sh --dry-run` creates no path under `PROD_ROOT`.
18. `deploy-backend.sh --dry-run` leaves the production fingerprint unchanged.
19. `deploy-backend.sh --dry-run` prints staged checksum names, not deployed ones.
20. `deploy-backend.sh --dry-run` does not hit an unbound-variable path.
21. Dirty tracked production causes dry-run rejection.
22. Wrong listener count causes dry-run rejection.
23. A failed PM2 stop prevents the Git switch in real deployment.
24. A failed PM2 stop prevents production `npm ci` in real deployment.
25. A non-zero listener count after PM2 stop prevents runtime mutation.
26. Standalone rollback stops PM2 before Git, `npm ci`, and runtime restore mutations.
27. Standalone rollback verifies zero listeners before mutation.
28. Standalone rollback continues service restoration after an intermediate failure.
29. Cleanup removes only the current release's temporary runtime directories.
30. An unrelated `dist.previous-*` directory remains untouched.
31. PM2 JSON status detection reports `online` without parsing `pm2 describe`.
32. PM2 JSON status detection reports `stopped` without parsing `pm2 describe`.
33. A missing PM2 process ID fails safely while reading JSON status.
34. Invalid PM2 JSON fails safely while reading JSON status.
35. A partial PM2 stop failure triggers rollback once service mutation has started.
36. An active listener after stop blocks Git, npm, and runtime mutation.
37. Rollback rejects an invalid `FROM_SHA` before cleanup or mutation.
38. Rollback rejects an invalid `TARGET_SHA` before cleanup or mutation.
39. Rollback rejects an unsafe deployment identifier before cleanup or mutation.
40. Empty `backend/private/ats-candidate-files/` hashing remains stable.
41. Empty `backend/face-models/` hashing remains stable.
42. The full sandbox matrix, including every earlier scenario, still passes.
43. Rollback continues after a first-step failure and records failed step labels.
44. Failed Git checkout restoration does not stop later recovery attempts.
45. Failed dependency restoration still attempts runtime restoration.
46. Failed runtime restoration still attempts PM2 restart.
47. Failed runtime restoration preserves diagnostic runtime directories.
48. Rollback returns non-zero only after all recovery attempts finish.
49. Dry-run performs no Git fetch through `PROD_ROOT`.
50. Dry-run creates no production Git worktree metadata.
51. Dry-run leaves `.git/index` unchanged.
52. Dry-run leaves `.git/FETCH_HEAD` unchanged.
53. Dry-run leaves refs unchanged.
54. Validation clone exists outside `PROD_ROOT`.
55. Validation clone is removed after dry-run.
56. The previous 42 sandbox scenarios still pass.
