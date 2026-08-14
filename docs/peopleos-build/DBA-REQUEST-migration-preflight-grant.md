# DBA request — one-time grant for the migration-preflight scratch database

**Requested:** 2026-08-14
**Server:** production MySQL `192.168.10.6:3306` (MySQL 8.0.42-0ubuntu0.20.04.1)
**Scope:** create/drop rights on a single throwaway database. **No privilege on `mas_hrms` is requested or required.**

---

## The ask

Create a dedicated account and grant it rights on one scratch schema only:

```sql
-- 1. A dedicated account for the preflight tool. Not the application account.
CREATE USER 'hrms_preflight'@'%' IDENTIFIED BY '<generated-strong-password>';

-- 2. Full rights on the scratch database ONLY. The name is fixed in the tool
--    (backend/scripts/migration-preflight.ts:133) and must match exactly.
GRANT ALL PRIVILEGES ON `hrms2_migration_preflight`.* TO 'hrms_preflight'@'%';

-- 3. The tool creates and drops that database each run, which needs a
--    server-level CREATE/DROP. Scoped to the one schema name via the pattern.
GRANT CREATE, DROP ON `hrms2\_migration\_preflight`.* TO 'hrms_preflight'@'%';

-- 4. Read-only on the real schema, so the tool can compare its scratch clone
--    against production structure. SELECT only — it never writes to mas_hrms.
GRANT SELECT ON `mas_hrms`.* TO 'hrms_preflight'@'%';

FLUSH PRIVILEGES;
```

Restrict `'%'` to the deploy host or CI runner address if your policy requires it — the tool does not care where it connects from.

Hand back the password out of band. It is consumed as `PREFLIGHT_DB_USER` / `PREFLIGHT_DB_PASSWORD`, which the tool reads from the shell environment per invocation and deliberately **not** from any committed `.env` file (`migration-preflight.ts:82-90`).

---

## Why this is needed

The application's own account (`shivam_user`) is intentionally scoped to `mas_hrms` and cannot `CREATE DATABASE`. That is the correct posture for an app credential, and the tool's own source says so explicitly rather than asking for the app account to be widened.

Without this grant the tool still runs, but only against whatever MySQL the operator happens to have admin rights on — typically the deploy box's local `mysqld`. That is an approximation of production, not production. The tool prints its version banner on every run specifically so the gap is visible rather than silent, but an approximation is what it remains.

---

## What it buys

This is the tool that clones the production schema into an isolated scratch database and replays every pending migration against it before a deploy touches production.

Two full production outages in the last two days came from migrations that failed on the real server:

- **1006** — SQL that failed against production MySQL, then a bookkeeping bug left the queue wedged for hours afterwards
- **1007** — a second, separate ~11-minute outage, triggered directly by unblocking 1006

Both were the same shape: a migration that would have failed on a faithful clone, run first against the real thing. The tool exists because of the 1006 incident. It has never been able to run end-to-end against a true production-equivalent server, because of this one missing grant.

A partial mitigation shipped on 2026-08-14 — `backend/scripts/migration-target-table-check.ts`, a read-only `information_schema` check now wired into `npm run preflight` and CI, which needs no elevated privilege and catches migrations targeting tables that do not exist. It closes one specific failure mode. It is not a substitute for replaying the actual SQL against an actual clone.

---

## Blast radius

- The tool's only connection to `mas_hrms` is used for `SELECT VERSION()`, `information_schema.TABLES`, and `SHOW CREATE TABLE` — reads exclusively, never a write. This was independently re-verified line by line during the 2026-08-13 out-of-band DDL investigation, which explicitly **ruled the tool out** as a cause.
- Every DDL statement it executes runs on a separate connection opened against `hrms2_migration_preflight`. Any `USE mas_hrms;` line inside a migration file is filtered out before execution, and the migrations are not schema-qualified, so there is no code path by which the scratch connection can write outside the scratch database.
- The scratch database is created and dropped per run. Its absence between runs is the normal, expected state.

If you would prefer this never touch the production host at all, a read replica or a structure-only dump restored onto a separate MySQL 8.0.4x instance would serve equally well — what the tool needs is a *faithful* server, not specifically the production one. Point `PREFLIGHT_DB_HOST` at it and the same grant applies there instead. That is a strictly safer arrangement and is a perfectly acceptable answer to this request.

---

## Verifying it works

After the grant, from the backend directory:

```bash
PREFLIGHT_DB_USER=hrms_preflight PREFLIGHT_DB_PASSWORD='<password>' \
  npx tsx scripts/migration-preflight.ts
```

Expected: it prints the server version banner (confirming which server it actually reached), creates the scratch database, replays each pending migration, reports PASS/FAIL per file, and drops the scratch database.

Success criterion is the version banner reading `8.0.42` against `192.168.10.6` — that is the signal the approximation gap has actually closed, and it is the only part of this request that cannot be satisfied by the current workaround.

---

**Requested by:** HRMS2 delta-audit remediation, 2026-08-14
**Related:** `docs/incidents/2026-08-13-migration-1006-production-outage.md`, `docs/incidents/2026-08-13-rest-policy-tables-out-of-band.md`
