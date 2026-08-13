# P0 Incident: Production outage — migration 1006 unsupported DDL syntax

**Date:** 2026-08-13
**Severity:** P0 (full production backend outage)
**Status:** Code fix CLOSED. Preventive migration-pipeline controls tracked separately as P1 — see `docs/HRMS2_DEPLOYMENT_RELEASE_READINESS.md`.
**Downtime:** ~24 minutes, approximately 16:17–16:41 IST (10:47–11:11 UTC)
**Remediation commit:** `c76655d8`

## Framing

The immediate action that triggered this incident was a production restart performed without first validating a newly-pulled migration against a non-production target. That is one contributing action, not the root cause. The underlying conditions that made the outage possible — and that made it hard to detect before traffic was affected — are release-engineering control gaps that existed before this incident and are not specific to one person's mistake:

- No systemic check for MySQL-version-incompatible DDL syntax across the migration set, despite this exact incompatibility having been discovered and regression-tested once before (see "Related prior knowledge" below) — the fix was never generalized.
- No non-production environment or gate that pending migrations were required to pass before a production restart.
- PM2 process status ("online") was treated as a sufficient proxy for application health, when the actual HTTP listener never bound.
- Migrations were able to reach production without their originating author's review being visible to whoever performed the next deploy — ownership of a migration wasn't tracked at deploy time.
- The table `payroll_branch_readiness` had already drifted ahead of its migration history via runtime DDL (`ensureTable()`), which is itself an unrecorded process that let this specific migration go untested against real schema state during development.

This document records what happened and what remains open. It does not treat "an engineer should have checked more carefully" as the corrective action.

## Timeline (IST)

| Time | Event |
|---|---|
| ~16:08 | `git pull --ff-only origin main` on production pulls in 8 commits, including another session's payroll-readiness feature (migration `1006_payroll_process_readiness_extend.sql`, a new worker, and service changes) alongside the Employee Directory export/sort fixes being deployed. |
| ~16:15–16:17 | Backend + workers rebuilt, `pm2 restart` issued. `runPendingMigrations` runs, reaches `1006_payroll_process_readiness_extend.sql`, throws `ER_PARSE_ERROR`. `STOP_ON_FIRST_FAILURE=true` aborts startup before the HTTP listener binds. |
| 16:17:02 | First logged failure: `[migration] FAILED: 1006_payroll_process_readiness_extend.sql — ... syntax ... near 'IF NOT EXISTS process_id ...'`. `pm2 list` continued reporting the process as `online`; `curl http://127.0.0.1:5055/api/health` returned connection refused. |
| 16:17–16:39 | Repeated restart attempts (by this session and, independently, by another live `masadmin` session on the same box, confirmed via `who`) hit the identical failure each time — the migration is deterministic, not transient. |
| ~16:32 | Root-cause diagnosis: reproduced the exact `ALTER TABLE` statement directly against production via a read connection (informational — no destructive action), confirmed via a binary search across clause variants (bare, `+COMMENT`, `+AFTER`, multi-column) that `ADD COLUMN IF NOT EXISTS` fails to parse at all on this server's MySQL 8.0.42 build — not a semantic "already exists" failure. |
| ~16:33 | Queried `information_schema.COLUMNS` / `.STATISTICS` for `payroll_branch_readiness` and found every column and index the migration was meant to add **already existed** — added previously by the application's own runtime `ensureTable()` DDL, per that migration file's own header comment ("employee_count_active / employee_count_left: were in ensureTable() DDL but missing from .sql"). This migration was semantically a no-op for this environment; it only needed to stop erroring. |
| ~16:35 | Rewrote the migration to guard every `ADD COLUMN` / `ADD INDEX` with an `information_schema` existence check + `SET @sql = IF(...); PREPARE; EXECUTE; DEALLOCATE` — the same pattern the file's own unique-key section already used successfully. Tested all 71 resulting statements end-to-end against live production data before deploying; every guard correctly reported "already exists", final success marker printed. |
| ~16:40:56 | Corrected file uploaded to production, `pm2 restart hrms2-backend --update-env` issued. |
| 16:41:26 | Logs show only the pre-existing, unrelated checksum-drift warnings (migrations 138/580/581/582 — known, benign, predate this incident) — no further mention of 1006. |
| 11:11:57 UTC (16:41:57 IST) | `/api/health` returns `200 {"success":true,"status":"healthy"}`. Confirmed stable (no PM2 restart-loop) for several minutes afterward. |
| ~16:43 | Frontend rebuilt and deployed (this step had not yet run when the outage began). |
| ~16:50 | Fix pushed to `origin/main` as `c76655d8`, so the corrected migration is in source control, not only patched live on the server. |

## Root cause

`backend/sql/1006_payroll_process_readiness_extend.sql` used `ADD COLUMN IF NOT EXISTS` / `ADD INDEX IF NOT EXISTS`. This syntax is not accepted by the production database's MySQL 8.0.42 build — every clause combination tested (bare, with `COMMENT`, with `AFTER`, multiple columns comma-joined) throws `ER_PARSE_ERROR` at the `IF NOT EXISTS` token itself. `mysql --version` on the application host reports a *different* MySQL build (8.0.46) than the actual database server (8.0.42, on a separate host) — the discrepancy between "what MySQL is installed near the app" and "what MySQL the app actually talks to" is itself part of why this wasn't caught locally before the migration was written.

Because `runPendingMigrations()` treats any migration failure as fatal under `STOP_ON_FIRST_FAILURE` (the correct behavior for schema integrity — not being revisited here) and migration verification runs before the HTTP listener binds, the failure prevented the application from ever starting, not just from applying that one migration.

## Why it reached production

1. The migration was authored and merged to `main` by a different session working on a payroll-readiness feature, without validating it against a non-production database matching production's actual MySQL build.
2. A later, unrelated deploy (Employee Directory export/sort fixes) pulled `origin/main` to get its own two commits current, and that pull necessarily included every other commit merged to `main` since production's last deploy — this migration among them. There was no step that separated "pull source" from "the migrations bundled inside that pull are safe to run."
3. The deploying session (this one) restarted the production service without first testing the newly-introduced migration against anything other than production itself.
4. **This exact incompatibility was already known in this codebase.** `backend/src/db/__tests__/employee-shift-rotation-type-migration.contract.test.ts` (covering migration 225) already asserts `expect(migration).not.toMatch(/ADD COLUMN IF NOT EXISTS/i)` — but that assertion was scoped to one file. Nothing generalized it to every migration, so it provided no protection for migration 1006 or any future one. This is being fixed now (see readiness doc).

## Impact

- Full backend + worker outage, all `/api/*` traffic unavailable, for ~24 minutes.
- No data loss. No destructive action was taken against production data at any point — diagnosis used read-only `information_schema` queries; the eventual fix only executed guarded, existence-checked `ADD COLUMN`/`ADD INDEX` statements, every one of which was a no-op given the columns/indexes already existed.
- The other concurrent session's in-progress GRN work (uncommitted local edits to `grn-smart.routes.ts`, `grn-smart.service.ts`, `NativeGRNManagement.tsx`) was verified untouched before and after every git operation during the incident and outage.
- Payroll-readiness feature functionality itself is unaffected by this fix — the migration's actual schema intent (process-level payroll readiness columns) was already present and unchanged; only the migration's ability to *run without erroring* was fixed.

## What was NOT done, deliberately

- The failed migration's history was not hidden, squashed, or removed. `git log` for `backend/sql/1006_payroll_process_readiness_extend.sql` shows the original (broken) version, authored by the other session, followed by this incident's remediation commit `c76655d8` on top of it.
- No destructive DDL was run against production as part of diagnosis. Every statement executed against the live database during troubleshooting was either read-only (`information_schema` queries) or an existence-guarded `ADD COLUMN`/`ADD INDEX` that was a true no-op.
- Production was not used as a first-time test bed for validating unrelated future migrations — see the preflight tooling requirement in the readiness doc for what replaces that going forward.

## Related documents

- `docs/HRMS2_DEPLOYMENT_RELEASE_READINESS.md` — current status of the preventive controls (P1, open)
- `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md` — deployment procedure, being updated to include a mandatory migration preflight gate
- `backend/sql/1006_payroll_process_readiness_extend.sql` — the corrected migration (see git history for the original)
