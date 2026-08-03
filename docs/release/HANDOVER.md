# Handover — autonomous stabilisation session, 2026-08-03

**Branch:** `stabilization/release-readiness-2026-08-03` · **Base:** `a92b65ad`
**`main` was not touched.** Nothing merged, nothing deployed, no SQL executed anywhere.

---

## Read this first

**The migration chain now builds a database from scratch, and the smoke gate runs end to
end for the first time.**

  Backend healthy after 24 attempt(s)
  [schema] all 14 required tables present
  Migrations clean: 0 failed
  Playwright page smoke: 25 passed, 4 failed

Everything you asked for in §1, §3, §4, §5, §7, §8, §9 and §10 is done. §6 is one step short:
the gate is green through build, migrate, seed, login, migration-evidence and frontend, and
red on the final browser sweep — which is the gate working, not failing.

Getting here took 46 CI builds against an empty MySQL 8.0 and **thirty distinct defect
classes** in the migration chain. Production had never hit any of them because it runs
`SKIP_MIGRATIONS=true` — its schema accumulated by hand over years, not from the manifest. The
chain started at migration **18 of 419** and now completes all of them.

## The four browser failures, and why they matter

All four fail the same way: `waitForAppShell` times out on a hidden
`flex min-h-screen items-center justify-center` container — a full-page loading or redirect
state that never resolves.

| Page | Note |
| --- | --- |
| `/expenses` | Sidebar nav renders but never becomes visible |
| `/expenses/new` | **The CEO reported this as "'New Claim' fully inert" in Round 2** |
| manager login → dashboard | Only the hidden container ever appears |
| manager → management dashboard | Same |

I previously assessed `/expenses/new` as "believed already correct on main" because the
handler and dialog binding are correct in source. The browser disagrees. That does not prove
the CEO's exact complaint, but it is the same page, the same symptom, and it is now
reproducible in CI on demand — which is the first time that has been true of any Round 2
finding.

**I have not diagnosed these four.** They are either a real rendering failure or an
over-broad selector in the test helper (`.min-h-screen` matches loading wrappers). Those need
different fixes and I will not guess between them.

## What I would do first when you read this

1. **Check the last smoke run.** `gh run list --workflow=local-deployment-smoke.yml --branch stabilization/release-readiness-2026-08-03 --limit 3`
2. **Decide whether to keep going on the chain.** It is converging — each fix now clears
   dozens of migrations rather than one — but I cannot tell you how many remain.
3. **Answer the three owner questions** in "Blocked on you" below. All three are blocking real
   work and none is an engineering decision.
4. **The CEO re-test can start today**, against production `badec198`. It does not depend on
   any of this. Plan is in `ceo-retest-plan.md`.

---

## The twenty-one defect classes

Grouped by what was actually wrong, not by the order found.

**Collation (3 variants).** A table footer can inherit the database default, name a collation
explicitly, or — the trap — name only the charset, which silently substitutes *that charset's*
default (`utf8mb4_0900_ai_ci`) for the database's. 55 declarations were in the third form.
Not fixable by a server setting.

**Guards that cannot tell "no column" from "no table" (5 syntaxes).** `IF(@col=0, 'ALTER…')`,
procedural `IF NOT EXISTS(…) THEN`, procedural index guards, `SELECT`-wrapped guards, and
parameterised helper procedures. A column count of zero is also what a missing table looks
like. Found one syntax at a time, twelve minutes per discovery.

**MariaDB syntax MySQL rejects (140 statements).** `IF [NOT] EXISTS` on ADD/DROP/CHANGE
COLUMN, ADD/CREATE INDEX and ADD KEY. `214_performance_indexes.sql` has carried a comment
saying so since it was written; twelve later files used it anyway.

**Statements disagreeing with their own file.** INSERT column lists naming columns the CREATE
fifty lines above does not declare. Indexes on columns that do not exist. `AFTER` clauses
naming absent columns.

**Ordering.** A CREATE listed 164 entries after the ALTERs that need it. A file creating two
required tables absent from the manifest entirely.

**Two runner bugs — the most consequential findings.**
- A file was abandoned on its *first* idempotent error and logged as
  `skipped (idempotent - already exists)`. Every later statement silently never ran. This is
  why failures surfaced sixty files from their cause.
- `splitSql` treated a `CASE … END` expression's `END` as closing the enclosing `BEGIN`,
  cutting stored procedures in half. Any migration combining a procedure with a CASE
  expression was truncated.

**Seeds hardcoding production UUIDs**, and **tables defined twice with incompatible shapes**.

---

## Four audits now prevent regression

Committed, runnable, non-zero exit on a finding. **None is wired into CI** — one still reports
findings, and wiring a red check into a gate is how gates get ignored.

| Script | Now |
| --- | --- |
| `audit-migration-collations.mjs` | 0 of 572 files |
| `audit-fresh-db-guards.mjs` | 0 unsafe of 161 guards, 4 syntaxes |
| `audit-insert-column-lists.mjs` | 0 in-manifest, 7 staged |
| `split-sql-case-expression.test.ts` | 4 pass; verified to fail 2 without the fix |

These matter more than the individual fixes. The guard audit found 12 defects in one pass;
the same class found via CI cost twelve minutes each.

---

## Blocked on you

**1. Four onboarding tables have no definition anywhere.**
`candidate_onboarding_bank_detail`, `candidate_onboarding_experience`,
`candidate_onboarding_qualification`, `candidate_onboarding_document`. Eight migrations ALTER
them. Production has them; the repository has never created them. I guarded every reference
so they stop halting the chain — that does not give them a schema. Someone has to decide
whether to write the CREATEs or retire the features.

**2. Two tables are defined twice, incompatibly.** `module_access_control` (138 vs 139) and
`employee_code_sequence` (139 vs 200). Whichever runs first wins and the other's seeds fail.
Picking a shape changes what the ATS authorisation code reads.

**3. BSS-OTHERS.** Two `process_master` rows carrying 15 and 179 real employees, with every
distinguishing field NULL. One question to an operations owner: same work or not? Full
assessment in `bss-others-merge-assessment.md`. **Recommend HOLD.**

---

## What I got wrong, and how it was caught

**I removed 16 page codes from `rbacPageMatrix.ts` as "dead grants".** All 16 came from
`LIVE_IMPORTED_PAGE_CODES`, which records what production's `role_page_access` actually
grants — and `apply-rbac-page-matrix.mjs` revokes every grant absent from the matrix. For
`HELPDESK_KB` and `ENGAGEMENT_COMMAND_CENTER` that would have revoked access for all 1,357
employees.

`tests/rbac-applier-safety.test.ts` caught it. The matrix is restored byte-for-byte. The
finding survives in `unroutedGrantedPageCodes.ts` with per-code evidence, and one of its
self-tests now fails if anyone repeats the mistake.

**Two of my own migrations (1061, 1062) were written against a `page_id` foreign key that
does not exist.** Found by widening the INSERT audit to scan unmanifested files. Both fixed.

---

## Also worth knowing

- **`main` took four pushes during the declared freeze** — `045026c0`, `bb3dc52f`,
  `b9aa8ce3`, `13ec8880`. Only the first was reviewed.
- **Three CI jobs had never run the tests they are named after.** `npm --prefix backend exec`
  does not change directory, so vitest ran from the repo root, whose config excludes
  `backend`. All pass once invoked correctly.
- **The backend baseline went 137 → 57**, removing only now-passing entries. Zero
  newly-failing was confirmed first; the 8 that were failing (2 RBAC, 1 manifest guard,
  5 luckpay) were fixed, not baselined. Those 5 luckpay tests guard a real data-loss bug and
  had never once run.
- **`canvas` is a flaky CI dependency.** One run failed building it from source because its
  prebuilt binary did not download and the runner has no pixman. Same commit passed on retry.
  A native build in the dependency graph undermines a gate meant to be trustworthy.

---

## Still not done

| Item | State |
| --- | --- |
| Two consecutive green smoke runs (§6) | **None yet.** Every run has found a real defect. |
| Fresh-database build (§5) | ~320 of 414, 4 required tables still missing. Currently stuck on 409_visitor_management_foundation: MySQL errno 1215 "Cannot add foreign key constraint", which names no constraint. Types and collations all look correct on inspection; diagnosing it needs SHOW ENGINE INNODB STATUS against a live MySQL, or bisecting the eight FKs across CI runs. |
| `/reports` root cause | Unknown. Interaction test written, never run against a real environment. |
| Test-data exclusion predicates | Migration 1063 adds `is_test_data`; no query filters on it. One contract test deliberately skipped with the un-skip condition recorded. |
| 7 staged INSERT mismatches | In unmanifested files that never run. Reported, untriaged. |

---

## Recommendation unchanged

**Do not merge or deploy.** Get one green smoke run first — it is the only end-to-end evidence
that any of this works — and answer the three owner questions. The gate has been productive
precisely because it keeps failing on real defects, but a gate that has never passed cannot
certify a release.
