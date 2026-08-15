# P0 Production-Control Incident: wfm_rest_policy / wfm_rest_override_log created in production out of band

**Date discovered:** 2026-08-13
**Severity:** P0 production-control incident (classified LOADED GUN, not an active outage — see disposition below)
**Status:** OPEN. Root actor unidentified. Restart/deploy frozen pending reconciliation.
**Affected objects:** `wfm_rest_policy`, `wfm_rest_override_log` (production `mas_hrms`)

> ### ⚠ READ THIS FIRST — the gates below are STALE (added 2026-08-15)
>
> **The `Restart: NO-GO` / `Deploy: NO-GO` entries in the disposition table are no longer
> true, and have not been for some time.** Production has been restarted and deployed many
> times since this document was written — 128+ commits landed on `main`, several of them
> explicitly to unblock deploys. Anyone reading this page in isolation would either believe a
> freeze that is not in force, or dismiss the whole document as out of date and miss the part
> that still matters.
>
> **What is genuinely resolved:** the schema-drift hazard. Six of the seven roster migrations
> (1200/1201/1202/1210/1211/1212) are now registered in `MIGRATION_MANIFEST` and applied by
> the sanctioned runner — exactly the reconciliation sequence this document prescribes below.
> 1213 is deliberately in `knownUnlisted`. The "loaded gun" described in the impact assessment
> is disarmed.
>
> **What is still open:** who executed the DDL, and the absence of any detective control that
> would surface a recurrence. That question has never been answered.
>
> **This document is deliberately left otherwise unedited** — it is the forensic record, and
> the evidence should not be rewritten after the fact. The delta since it was written, the
> three closure options, and a recommendation live in the companion note:
> **[`2026-08-13-rest-policy-tables-out-of-band-CLOSURE.md`](./2026-08-13-rest-policy-tables-out-of-band-CLOSURE.md)**

## Framing

Migration `1210_minimum_rest_policy.sql` carries an explicit, unambiguous header:

> **DO NOT RUN THIS AGAINST PRODUCTION WITHOUT EXPLICIT APPROVAL.**
> Not added to MIGRATION_MANIFEST — creating this file does not schedule it to run at any pm2 restart/boot.

Despite that, both tables the migration creates already exist in production, fully structured (including the file's later `ALTER TABLE ... effective_to_bound` generated column and its unique key — i.e. the entire file ran, not just the leading `CREATE TABLE`), with zero configured rows. This document is the forensic record of that discovery, kept deliberately separate from any cleanup action so the evidence isn't lost to a well-intentioned repair before the root cause is understood.

## What was found (read-only verification, production `mas_hrms` via `122.184.128.90`)

| Fact | Value |
|---|---|
| `wfm_rest_policy` exists | Yes, full structure matching 1210 exactly, including `effective_to_bound` generated column and `uq_wfm_rest_policy_scope_window` |
| `wfm_rest_override_log` exists | Yes, full structure matching 1210 exactly |
| `CREATE_TIME` (both tables) | `2026-08-13T16:49:10.000Z` |
| Row counts | 0 / 0 |
| `schema_migrations` rows for the entire 1200–1213 range | **zero** — not just 1210; none of the roster-enterprise-controls migrations (1200, 1201, 1202, 1210, 1211, 1212×2, 1213) have ever been recorded as applied via the sanctioned runner |
| `MIGRATION_MANIFEST` (local working tree, dirty/uncommitted) | Contains 1211, 1212 (another concurrent session's in-progress edit — left untouched); does not contain 1210 or 1213 |
| `MIGRATION_MANIFEST` (`origin/main`) | Contains none of 1200/1201/1202/1210/1211/1212/1213 |
| Commit that added `1210_minimum_rest_policy.sql` to the repo | `ba07041d`, `2026-08-13T12:04:33 UTC` — roughly 4h45m before the tables appeared |
| `general_log` | OFF — no query log to identify the actor |
| `log_bin` | ON — binlog events from `16:49:10 UTC` may still be inspectable by whoever holds DBA/binlog access and if retention covers it; not attempted here (requires elevated access, and inspecting binlog is itself a production-adjacent action reserved for the DBA under the current freeze) |
| DB server version | `8.0.42-0ubuntu0.20.04.1` |
| Scratch database `hrms2_migration_preflight` | Confirmed absent (cleanly dropped), consistent with a normal completed preflight-certification run |

## What this rules out

**The migration-preflight certification tool (`backend/scripts/migration-preflight.ts`), run earlier the same day under an explicitly scoped one-time root credential, is very unlikely to be the cause.** Re-reading its full source confirms:
- Its only connection to real production (`prodConn`) is used exclusively for `SELECT VERSION()`, `information_schema.TABLES`, and `SHOW CREATE TABLE` — all reads, never a write.
- Every DDL statement it runs (including every statement inside `1210_minimum_rest_policy.sql`) executes against a *separate* connection (`testConn`) explicitly opened with `database: "hrms2_migration_preflight"` — the isolated scratch database, never `mas_hrms`.
- The file's own `USE mas_hrms;` line is filtered out of the statement list before execution (`splitSql(...).filter(s => !s.toUpperCase().startsWith("USE "))`), and none of 1210's `CREATE TABLE`/`ALTER TABLE` statements are schema-qualified, so there is no code path by which `testConn` could have written outside the scratch database.
- The scratch database's absence (cleanly dropped) is consistent with the tool completing its normal run, not with an interrupted state that could have leaked partial work.

**A routine `pm2 restart` via the application's own boot-time migration runner is also ruled out.** 1210 is not present in `MIGRATION_MANIFEST` in either the local working tree or `origin/main`, so `runPendingMigrations()` would never have selected it for execution regardless of how many restarts occurred.

**The currently running production process cannot be the actor either.** `GET /api/health/version` (public, read-only, no restart required to query) reports the live process at commit `5f0df0c0c9ccf1189939060f31e5d77f97a5fccd`, built `2026-08-13T10:43:19Z`, started `2026-08-13T15:07:53Z` — both before the tables' `16:49:10Z` creation, and `git show 5f0df0c0:...` confirms `rest-policy.service.ts` and `roster-lock-guard.ts` do not exist at all in that commit (zero references to `checkEmployeeDateNotLocked`). The process that has been serving production traffic all along has never contained the code that would even know these tables exist.

## Leading hypothesis (unconfirmed)

The full DDL content of `backend/sql/1210_minimum_rest_policy.sql` was executed directly against production — outside `runPendingMigrations()`, most plausibly via a `mysql` client / `SOURCE` command run by a concurrent session or operator with direct database access, sometime in the ~4h45m window between the file being committed (`ba07041d`, 12:04:33 UTC) and the tables' creation (16:49:10 UTC). This is a hypothesis, not a confirmed finding — `general_log` was off, so no query-level attribution is available from the database itself. Binlog inspection (if retention allows) is the remaining avenue, and is a DBA action, not something performed as part of this investigation.

## Production impact assessment

`isRestPolicyFeatureActive()` (`backend/src/modules/wfm/rest-policy.service.ts`) determines feature activation by table existence alone, not by manifest registration or `schema_migrations` state. The tables' mere presence has therefore silently flipped that function's return value to `true` in production, with zero policy rows configured for any of 1,327 active employees at any tier.

**As of this writing, this is not causing active harm**, because the running backend process predates the rest-policy enforcement code entirely (see above) — no live code path currently calls `isRestPolicyFeatureActive()` or `resolveRestPolicy()` against production. This is a **loaded gun**: the next deploy that includes `rest-policy.service.ts` will, on first restart, make every guarded roster write path (weekly generation, manual assignment, both bulk-upload paths, governance sync) return `REST_POLICY_MISSING` for all active employees, with zero warning, because the "has the migration been applied" signal it relies on is already (incorrectly, out of band) true.

## Disposition and controls now in effect

| Gate | Status |
|---|---|
| Production schema 1210 objects | UNEXPECTEDLY PRESENT |
| `schema_migrations` 1210 record | ABSENT |
| Normal migration-runner application | NOT SUPPORTED BY EVIDENCE |
| Rest-policy configuration | 0 ROWS / NOT READY |
| Running backend enforcement state | CONFIRMED — predates enforcement code, not active |
| Restart | **NO-GO** |
| Deploy | **NO-GO** |
| Manual `schema_migrations` repair | **DO NOT DO** |
| Drop/rename tables | **DO NOT DO** |
| Arbitrary org policy seed | **DO NOT DO** — the configured value itself creates real `REST_GAP` blocks the moment enforcement goes live; it requires a read-only impact simulation (`backend/scripts/minimum-rest-policy-impact-simulation.ts`) and WFM/Ops + HR/Payroll approval first, not a default pick |
| Read-only incident investigation | GO — this document |

## Planned reconciliation (after incident closure, not part of this document)

Per standing guidance: do not manually force `schema_migrations` into agreement with the database. The correct sequence once the root actor/cause is understood and a policy value is approved is:
1. Certify 1210 via `migration-preflight.ts` (already done, PASS, all 12 pending files clean).
2. Register 1210 (and the rest of the 1200–1213 set) in `MIGRATION_MANIFEST` deliberately, not as a side effect of unrelated work.
3. Let the sanctioned, idempotent runner execute against the already-existing objects — `CREATE TABLE IF NOT EXISTS` / guarded `ALTER` statements mean this is a legitimate no-op that produces a correct, honest `schema_migrations` success record, rather than one manually forged to match.

This preserves migration lineage and keeps the evidence in this document intact rather than papering over it.

## Related documents

- `docs/incidents/2026-08-13-migration-1006-production-outage.md` — the prior incident that produced `migration-preflight.ts` and the "certify before deploy" discipline this incident's response followed
- `backend/sql/1210_minimum_rest_policy.sql` — the migration file itself, including its own rollback notes
- `backend/scripts/minimum-rest-policy-coverage-report.ts` — read-only coverage report that first surfaced this (ran against production expecting an "not applied yet" early return and instead returned live results)
- `backend/scripts/minimum-rest-policy-impact-simulation.ts` — read-only simulation required before any policy value is approved
