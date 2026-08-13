# HRMS2 Deployment / Release Readiness

**Last updated:** 2026-08-13
**Trigger:** P0 production outage — see `docs/incidents/2026-08-13-migration-1006-production-outage.md`

This document exists because deployment/release readiness should not read as artificially high
after a proven production outage caused by an unvalidated migration. It is not a general
project status page — see `docs/HRMS2_PRODUCTION_GO_LIVE_TRACKER.md` and
`docs/peopleos-build/CLAUDE_IMPLEMENTATION_TRACKER.md` for that. This tracks specifically:
can a change reach production safely, and what stands between "it works on `main`" and "it is
safe to restart the production process."

## Incident summary

| Field | Value |
|---|---|
| Date | 2026-08-13 |
| Downtime | ~24 minutes, ~16:17–16:41 IST |
| Root cause | `backend/sql/1006_payroll_process_readiness_extend.sql` used `ADD COLUMN IF NOT EXISTS` — MariaDB syntax, rejected outright by production's MySQL 8.0.42 build |
| Discovered by | Live diagnosis during the outage (binary-searched clause variants, confirmed via `information_schema`) |
| Remediation commit | `c76655d8` |
| Downtime restored | Confirmed via `/api/health` at 2026-08-13T11:11:57Z |
| Full record | `docs/incidents/2026-08-13-migration-1006-production-outage.md` |

**Code fix status: CLOSED.** Migration 1006 now applies cleanly and idempotently, verified
against live production data. Production is healthy and running the fix.

**Preventive migration-pipeline controls: P1, partially implemented, not fully closed.** The
sections below are the honest state of each control the incident calls for — what's built and
verified, what's built but not yet fully provable, and what's still open. Nothing below is
claimed as done unless it was actually run and its result observed.

---

## Critical parallel finding: a 10-day-old unmerged branch already did most of this

While investigating this incident, a branch — `stabilization/release-readiness-2026-08-03`
(local and `origin/`) — was found to contain **59 commits unique to it**, none merged into
`main`, dated 2026-08-03: an "autonomous stabilisation session" that worked specifically on
getting HRMS2's full migration chain to run cleanly from a fresh database in CI. Its own
handover doc states: *"Chain reaches roughly #320 of 414... 21 defect classes found across 27
fresh-build CI runs... still no green smoke run"* — i.e. **substantial, real progress, not a
finished pipeline**, abandoned mid-effort and never reconciled back into `main`.

That branch had already found and fixed, at scale (0 findings across 572 files, per its own
commit message), the exact bug class that caused this incident — including migration 1006
itself, which it rewrote correctly on 2026-08-03, three weeks after 1006 was authored and ten
days before it took production down. **That fix never reached the branch that was actually
deployed.** This is, on its own, a bigger release-control gap than the SQL bug: a real fix
existed in version control and never shipped.

`main` has since diverged from that branch by **1,148 commits** in the other direction.
Reconciling it is not something to attempt inside an incident response — it needs its own
scoped plan (diff review, conflict resolution, re-validation against current `main`) — but it
should be the **first thing evaluated**, before anyone spends further hours re-deriving fixes
that branch may already contain. What was salvaged now: its collation/MariaDB-syntax audit
script, ported directly (see below).

**Action item, P1: evaluate `origin/stabilization/release-readiness-2026-08-03` for
reconciliation.** Do not let it go stale a second time.

---

## Controls implemented and verified this session

### 1. Static migration-syntax audit — DONE, ported from the stranded branch, running

- `backend/scripts/audit-migration-collations.mjs` — ported verbatim from
  `stabilization/release-readiness-2026-08-03` rather than reimplemented, so the standalone
  script and the test that calls it can never diverge. Checks two bug classes: MariaDB-only
  conditional DDL (`ADD/DROP COLUMN IF [NOT] EXISTS`, `ADD/DROP INDEX/KEY IF [NOT] EXISTS`,
  `CREATE INDEX IF NOT EXISTS`, `CHANGE COLUMN IF EXISTS`) and collation-drift-prone bare
  `DEFAULT CHARSET=` declarations.
- **Run against current `main` today: 296 findings across 62 unique files.** All 62 are
  pre-existing; none is newly introduced by anything shipped this session.
- `backend/src/db/__tests__/migration-syntax-compatibility.test.ts` — wraps the script as a
  **ratchet**, not a blanket ban: it hard-fails on any *new* file that isn't already in the
  62-file baseline, and separately reports (without failing) when a baselined file has been
  fixed and should be removed from the list. This runs on every `npm test`, which the
  deployment runbook already requires before every release — so from today forward, this class
  of bug cannot reach `main` silently again.
- The 62 baselined files are **not** fixed. Fixing them requires the same per-file treatment
  1006 got — verify current schema state, rewrite with an `information_schema` guard, test
  against real data — done carelessly across 62 files that's how an audit becomes a second
  incident. Tracked, not done. See "Open items" below.

### 2. Non-production migration preflight — script complete and logic-verified; one credential away from fully operational

- `backend/scripts/migration-preflight.ts`. Given a `FROM_SHA`/`TARGET_SHA` range: enumerates
  every `backend/sql/*.sql` file added or modified in that range via `git show` (works before
  any checkout/pull — ownership of who wrote the migration is irrelevant, per the incident's
  own finding), clones production's *actual current schema* (structure only, via
  `SHOW CREATE TABLE` — no data ever leaves `mas_hrms`, no `mysqldump` dependency) into an
  isolated database, then runs every pending migration against that clone **twice** — first
  apply, then a rerun to prove idempotency — using the exact same `splitSql` statement-splitter
  production's own migration runner uses (imported, not reimplemented).
- **What's actually verified:** TypeScript compiles clean. Enumeration logic is correct
  (confirmed it correctly found `1006_payroll_process_readiness_extend.sql` and
  `1007_payroll_process_readiness_page.sql` as the pending range for the commit that introduced
  1006). Read-only connection to real production for schema cloning works and correctly
  reports MySQL version (`8.0.42-0ubuntu0.20.04.1`, matching production exactly).
- **What's NOT yet verified:** a full clean end-to-end run. The app's own DB credential
  (`shivam_user`) is correctly scoped to `mas_hrms` only — it cannot `CREATE DATABASE`, which
  is the right posture for an app credential and the wrong one for this script. No working
  admin-level MySQL credential for the actual production host (192.168.10.6) was available
  this session to grant that privilege, and repeated credential guessing was deliberately not
  attempted (see the SSH section of this incident's parent conversation — the same discipline
  applies to database credentials).
- **Open item, P1:** a DBA needs to run, once, against the real production MySQL server:
  ```sql
  CREATE DATABASE IF NOT EXISTS hrms2_migration_preflight;
  GRANT ALL PRIVILEGES ON hrms2_migration_preflight.* TO 'shivam_user'@'%';
  FLUSH PRIVILEGES;
  ```
  After that grant exists, `npx tsx backend/scripts/migration-preflight.ts <from> <to>` is
  immediately usable with zero code changes — the script already reads standard `DB_*`
  credentials and only needs `PREFLIGHT_DB_*` to point at a credential with that grant. Until
  then, `PREFLIGHT_DB_HOST/USER/PASSWORD` can point at any admin-accessible MySQL 8.0.4x server
  as an approximation — the script prints a loud warning whenever it's not running against the
  real production server, specifically so that gap stays visible instead of silently assumed
  closed.

### 3. Deployment runbook — updated to mandate the above, not just document it

`docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md` gained a **"Mandatory pre-restart gate"** section,
explicit that it applies to every deploy path (the formal `deploy-backend.sh` script and any
manual `git pull` + restart — which is what actually happened during this incident, and is
what the previous version of this runbook didn't cover for a mixed frontend+backend release).
Required sequence before stopping the healthy process: target SHA validation → enumerate every
pending migration in the range → static compatibility audit → non-prod migration dry run →
build/test → only then deployment eligibility.

### 4. Health verification — redefined and tested live

`scripts/production/verify-health.sh` gained two checks, both run against real production
today:

- **Port-bound check**, run first, before any HTTP attempt — would have caught the incident in
  under a second instead of ~24 minutes.
- **`/api/health/version` check** — this endpoint already existed in the codebase (`commit`,
  `schema.valid`, `schema.pending`) but was not part of this session's own verification
  checklist during the incident deploy; that gap, not a missing capability, is what's fixed.
  Given `EXPECTED_GIT_SHA`, fails the deploy if the running process reports a different commit,
  or if `schema.pending != 0` (code and database from different releases).
- Verified live: the port check correctly passed against the now-healthy production process,
  and the SHA check correctly *failed* when given a SHA newer than what's actually running —
  proving it detects real drift rather than always passing.
- The runbook's Verification section now states explicitly: **PM2 "online" is necessary,
  never sufficient**, and a failed verification is a failed deploy requiring rollback, not a
  deploy with a follow-up TODO.

### 5. Runtime DDL audit — catalogued, not eliminated

Files outside `backend/sql/` that run `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE` / an
`ensureTable()`-style pattern at runtime (the mechanism that let 1006's target columns already
exist before the migration ever ran, which is why the fix could be a safe no-op rather than a
guess):

```
backend/src/modules/ats-assessment/assessment.schema.ts
backend/src/modules/payroll/payroll-attendance-control.service.ts
backend/src/modules/payroll/payroll-branch-readiness.service.ts   <- the file behind this incident
backend/src/modules/payroll/payroll-calendar.routes.ts
backend/src/modules/payroll/payroll-certificates.routes.ts
backend/src/modules/payroll/payroll-statutory-filing.routes.ts
backend/src/modules/payroll/reimbursements.routes.ts
backend/src/modules/quality-dashboard/inbound-quality.service.ts
backend/src/modules/security/security-center.routes.ts
backend/src/scripts/apply-master-activity-status.ts
backend/src/scripts/close-unruled-cost-centres.ts
```

Not refactored this session — these are payroll, security, and finance-adjacent modules, and
per this repo's own standing rule (no changes to existing logic without per-change approval),
rewriting bootstrap/schema-repair logic across 11 files is exactly the kind of change that
needs its own scoped review, not a rider on an incident response. Documented so the risk (a
migration's own manifest can drift from what actually created the schema, silently, the way
1006's target columns already existed via `payroll-branch-readiness.service.ts`'s own
`ensureTable()`) is visible and trackable rather than rediscovered by the next outage.

---

## Open items (P1) — not implemented, listed so status doesn't read higher than it is

- **Reconcile or mine `stabilization/release-readiness-2026-08-03`** (see above) — likely the
  single highest-leverage remaining item; may already contain fixes for most of the 62
  baselined files and a further-along version of the fresh-database CI chain.
- **Grant `shivam_user` (or a dedicated account) `CREATE`/`DROP`/`ALTER` on
  `hrms2_migration_preflight`** on the real production host — the one blocker on the preflight
  script being fully operational, not approximated.
- **Fix the 62 baselined legacy migrations** — one at a time, each verified against live schema
  state the way 1006 was, removed from the test's baseline list as each is confirmed clean.
- **Automated rollback on failed post-deploy health check.** Today's rollback (dist backup,
  restore, restart) was manual and worked because backups were taken proactively before this
  specific deploy. Not yet wired as an automatic reaction to a failed `verify-health.sh` run.
  Explicitly note: a `dist` rollback does **not** roll back a migration or schema change — those
  need separate, conservative handling (the additive-only migration convention this repo
  already follows is the mitigant, not a rollback mechanism).
- **Full schema-drift detector** comparing `MIGRATION_MANIFEST.lock.json` state, actual
  `information_schema`, and the schema expected at a target SHA — today's tooling proves
  "pending migrations run cleanly," not the fuller drift classes (migration registered but
  object missing, duplicate runtime-created objects, manifest entry with no file, file present
  but unregistered).
- **Automated deploy report** (current SHA → target SHA → commits introduced → migrations
  introduced → changed modules) surfaced *before* restart, so a cross-session dependency like
  today's (an unrelated payroll-readiness migration riding along with an Employee Directory fix)
  is visible ahead of time rather than discovered mid-outage.
- **Full migration regression test matrix** — fresh database, columns-already-exist,
  partially-applied, index-already-exists, rerun, ordering, manifest registration, unsupported
  syntax, schema-created-by-runtime-DDL. What exists today is the static syntax/collation
  ratchet and per-file contract tests for specific past incidents (e.g. migration 225); a
  systematic matrix across all of it does not yet exist.
- **Runtime DDL constraint/documentation** for the 11 files above, or a decision to migrate them
  onto the registered migration path — not started.

## What this document is not claiming

- Not claiming the migration pipeline is now safe against every future incompatibility — the
  static audit covers two known bug classes, not "every possible MySQL-version difference."
- Not claiming the preflight script has completed a full clean run — its logic and every
  connection path except the final admin grant are verified; the grant itself is still open.
- Not claiming the 62 baselined files are fixed — they are catalogued and prevented from
  silently growing, which is a different, smaller claim.
- Not claiming this replaces evaluating the stranded stabilization branch — if anything, this
  session's work is a partial, faster re-derivation of a subset of what that branch already did.
