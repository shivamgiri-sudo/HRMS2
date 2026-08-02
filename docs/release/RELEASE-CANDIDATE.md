# Release candidate — `stabilization/release-readiness-2026-08-03`

**Branch:** `stabilization/release-readiness-2026-08-03` · **Base:** `a92b65ad`
**Commits:** 19 · **Files:** 65 · **Prepared:** 2026-08-03

**`main` was not touched by this work.** Nothing here has been merged, deployed, or applied
to any database.

---

## What was asked, and where it stands

| § | Ask | Status |
| --- | --- | --- |
| 1 | CEO re-test plan for the four already-live fixes | **Done** — `docs/release/ceo-retest-plan.md` |
| 3 | Classify every unmapped route/page code, no generic allowlist | **Done** — 3 contracts green, 28 tests |
| 4 | Diagnose the two red gate jobs; reconcile the baseline | **Done** — both diagnosed and fixed; baseline 137 → 57 |
| 5 | Migration reconciliation | **Partly** — see below. Far more was wrong than expected |
| 6 | Rewrite the smoke workflow; validate twice | **Rewritten; not yet green once** |
| 7 | Purge → soft classification; BSS-OTHERS assessment | **Done** — and the purge approach was replaced entirely |
| 8 | LMS escalation; `/reports` interaction test | **Done** |
| 9 | Branch protection payload, prepared not applied | **Done** — `docs/release/branch-protection-main.md` |
| 10 | Release package | This document |

---

## The three findings that matter most

### 1. Three CI jobs had never run the tests they are named after

`npm --prefix backend exec -- vitest` does not run in `backend/`. `--prefix` changes package
resolution, not the working directory, so vitest started in the repo root under the root
config — whose `exclude` list names `backend`. Every run ended in "No test files found,
exiting with code 1".

Affected: **Finance API and schema contract**, **Report architecture and source contracts**,
**Finance calculations and contracts**. The finance job also skipped its build steps behind
the failure. All pass once invoked correctly: 52 + 29 + 13 tests.

What made it survive is that `npm --prefix backend run typecheck` *does* work — npm scripts
run with cwd set to the prefix. Only `npm exec` does not. Three broken steps sat in a column
of working ones with the same shape.

### 2. The repository cannot build its own database

Discovered while making the smoke gate reachable. Ten CI builds against an empty MySQL 8.0
found **nine distinct defect classes** in the first 84 of 413 migrations. Production never
hit any of them because it runs `SKIP_MIGRATIONS=true` — its schema accumulated over time
rather than being built by the manifest.

Full detail in `docs/release/migration-reconciliation.md`. In short: three collation
variants, guards that cannot distinguish "no column" from "no table", statements that
disagree with their own file, an index dropped before its replacement, seeds hardcoding
production UUIDs, tables defined twice with incompatible shapes, and a CREATE ordered 164
entries after the ALTERs that need it.

**This was never a UAT blocker and is not one now.** It is a disaster-recovery and
new-environment blocker — the kind that surfaces at the worst possible moment.

### 3. I made a dangerous mistake and a test caught it

An early commit removed 16 page codes from `rbacPageMatrix.ts` as "dead grants — no page
behind them". The observation was right; the action was a revocation.

All 16 came from `LIVE_IMPORTED_PAGE_CODES`, a record of what production's
`role_page_access` actually grants, imported so that `apply-rbac-page-matrix.mjs` does not
become destructive — the applier sets `active_status = 0` on every grant absent from the
matrix. For `HELPDESK_KB` and `ENGAGEMENT_COMMAND_CENTER` that is all 1,357 employees.

`tests/rbac-applier-safety.test.ts` caught it. The matrix is restored byte-for-byte;
`src/config/rbac/unroutedGrantedPageCodes.ts` records the finding with per-code evidence and
a proposed action, and one of its self-tests fails if anyone repeats the mistake.

---

## What is not done

| Item | State |
| --- | --- |
| **Smoke gate green** | Not achieved. Ten runs, each surfacing a real defect. §6 asked for two consecutive green; there have been none. |
| **Fresh-database build** | Not complete. Chain reaches manifest #84 of 413, up from #18. |
| **Three tables with no definition** | `candidate_onboarding_bank_detail`, `candidate_documents`, `document_vault_inventory`. Guarded so they no longer halt the chain; they still have no schema. **Owner decision.** |
| **Two tables defined twice, incompatibly** | `module_access_control`, `employee_code_sequence`. Seeds guarded; the conflict is documented in-file. **Owner decision.** |
| **9 staged INSERT mismatches** | In unmanifested files that never run. Reported by the audit, untriaged. |
| **`/reports` root cause** | Still unknown. The interaction test exists but has not run against a real environment. |
| **Exclusion predicates** | Migration 1063 adds `is_test_data`; no query filters on it yet. One contract test is deliberately skipped with the un-skip condition recorded. |

---

## Nothing here has been applied

Four SQL files are prepared and **not executed**, all registered in
`MIGRATION_MANIFEST.lock.json` as deliberately unlisted:

| File | Does |
| --- | --- |
| `1061_revoke_grants_for_unrouted_pages.sql` | Revokes 16 grants; archives first; keeps catalog rows |
| `1062_seed_module_launcher_and_mcnmeet_pages.sql` | Seeds two catalog rows the app already uses |
| `1063_test_data_classification.sql` | Adds `is_test_data` to three tables; additive only |
| `scripts/classify-test-data.sql` | Marks test rows; deletes nothing |

## Three audits, committed

| Script | Finds | Now |
| --- | --- | --- |
| `audit-migration-collations.mjs` | Tables that will not match the DB collation | 0 of 572 files |
| `audit-fresh-db-guards.mjs` | Guards that ALTER a table that does not exist | 0 of 413 entries |
| `audit-insert-column-lists.mjs` | INSERTs naming a column their table lacks | 0 in-manifest, 9 staged |

None is wired into CI. Wiring a check that still reports findings is how gates get ignored.

---

## Recommendation

**Do not merge or deploy yet.** Two things should happen first, in this order:

1. **Get one green smoke run.** It is the only evidence that any of this works end to end.
   The gate has been productive precisely because it keeps failing on real defects, but a
   gate that has never passed cannot certify a release.
2. **Answer the three owner questions** — the undefined tables, the duplicate table
   definitions, and BSS-OTHERS. None is an engineering decision.

The CEO re-test can proceed independently against production `badec198` today. It does not
depend on any of this.

## One thing to decide about process

**`main` took four pushes during the declared freeze** — `045026c0`, `bb3dc52f`, `b9aa8ce3`,
`13ec8880`. Only the first was reviewed here. A freeze that depends on people remembering is
not a freeze, which is the argument for applying the Stage 1 branch protection in
`docs/release/branch-protection-main.md`.
