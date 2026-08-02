# Migration reconciliation — can we build this schema from the repository?

**Prepared:** 2026-08-03 · **Method:** repeated fresh-database builds in CI, not inspection
· **Answer so far: no, but it is now much closer, and every failure is understood.**

---

## Why this exists and what it replaced

The original §5 asked for a reconciliation matrix of 27 migration files against production,
read-only. Two things changed that framing.

**The manifest has 413 entries, not 27.** The number 27 came from the recent files; the
chain that has to succeed for a schema to exist is the whole list.

**Production cannot be the reference.** Production runs `SKIP_MIGRATIONS=true`
(`runPendingMigrations()` returns before applying anything), so its schema was not built by
this manifest. It accumulated over time, by hand and by migrations run under different
conditions. Comparing files against it tells you what production happens to have — not
whether the repository can produce it. Those are different questions and only the second one
matters for disaster recovery, for a new environment, or for a developer starting clean.

So instead of inspecting, we built. Nine times.

## What the builds found

Each row is one CI run against an empty MySQL 8.0. Each fix let the chain reach the next
genuine defect — so this is a measurement, not a guess.

| Run | Reached | Failure | Class |
| --- | --- | --- | --- |
| 1 | #18 of 413 | `018` FK `exit_request_id`/`id` incompatible | collation: `011` declares none, `018` declares explicitly |
| 2 | #42 | `038` `gamification_badge_master` doesn't exist | guard fires `ALTER` before the `CREATE` |
| 3 | #42 | `038` unknown column `id` | INSERT names a column its own CREATE doesn't make |
| 4 | #42 | `038` unknown column `display_order` | same INSERT, next column |
| 5 | boot | `Unknown database 'mas_hrms'` | my own fix broke boot ordering |
| 6 | #45 | `041` cannot drop index `employee_id` | drops a FK's only index before its replacement |
| 7 | #47 | `044` FK `designation_id` fails | seed hardcodes a production UUID |
| 8 | #69 | `102` FK `branch_id`/`id` incompatible | collation: `CHARSET=utf8mb4` with no `COLLATE` |
| 9 | *running* | — | — |

Missing required tables fell from **10 → 9 → 7** across those runs.

## The defect classes, and why each was invisible

Every one of these is invisible on production, for the same reason: production's schema
already contains the result, so the statement that would fail either never runs or finds the
world already as it expects.

**1. Collation, three variants.** `) ENGINE=InnoDB;` inherits the database default;
`CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` is explicit; **`CHARSET=utf8mb4` alone silently
opts out**, because naming a charset overrides the database default with that charset's own
default — `utf8mb4_0900_ai_ci` on MySQL 8.0. 55 declarations across 20 files were in the
third form. Not fixable by a server setting: `collation_server` governs the first form, not
a charset's own default.

**2. Guards that cannot tell "no column" from "no table".** `IF(@col=0, 'ALTER TABLE t ADD
COLUMN c')` means "add it if missing", but a column count of zero is also what a missing
table looks like. The mirror-image guard, `IF(@col>0, ...)`, is safe for the same reason.
96 guards matched the shape; 12 were unreachable; all 12 fixed.

**3. Statements that disagree with their own file.** `038` creates `survey_question` with
`question_id` and `question_order`, then seeds it naming `id` and `display_order` fifty
lines later. 18 more INSERT/CREATE mismatches exist across the manifest, reported and not
yet triaged.

**4. Index dropped before its replacement exists.** Third occurrence in this repository. The
first one took the production API down at boot — migration `1035` hit it live,
`runPendingMigrations` throws in production, no HTTP listener was created, nginx 502'd every
request.

**5. Seeds that hardcode production identifiers.** `044` inserts an attendance rule
referencing a designation UUID that exists only in production, violating its own foreign key
anywhere else.

**6. Three tables with no definition at all.** `candidate_onboarding_bank_detail` and
`candidate_documents` have no `CREATE TABLE` anywhere in `sql/`.
`document_vault_inventory` has one, in `migrations/406_secure_document_vault.sql`, which is
absent from the manifest and never runs — so a migration named "document vault security
hardening" hardens a table no fresh database has. Guarding stopped these halting the chain;
it did not give them tables. **This is a schema decision, not a chain repair, and it is open.**

## What now prevents regression

Three audits, committed and runnable, each exiting non-zero on a finding:

| Script | Finds | Current |
| --- | --- | --- |
| `audit-migration-collations.mjs` | Tables that will not match the database collation | **0** of 572 files |
| `audit-fresh-db-guards.mjs` | Guards that `ALTER` a table that does not exist yet | **0** of 413 manifest entries |
| `audit-insert-column-lists.mjs` | INSERTs naming a column their table lacks | **18** in 9 files, untriaged |

These matter more than the individual fixes. Finding class 2 by static analysis took one pass
and produced all 12 at once; finding classes 3 and 5 by CI took one twelve-minute run per
defect. **None of the three is wired into CI yet** — the third still reports findings, and
wiring a red check into a gate is how gates get ignored.

## What is still true

- **A fresh database still cannot be built.** Nine runs, eight defects fixed, chain not yet
  complete. The remaining count is unknown; what is known is that each fix has advanced it
  and every failure so far has been understood rather than worked around.
- **Production is unaffected by every change here.** These are `CREATE TABLE IF NOT EXISTS`
  and guarded `ALTER`s against tables that already exist, in a chain production does not run.
  A checksum mismatch on an already-applied file is `console.warn` only
  (`runPendingMigrations.ts:984`).
- **This was never a release blocker for the CEO's UAT** and it is not one now. It is a
  disaster-recovery and new-environment blocker, which is a different and quieter risk: it
  would have been discovered at the worst possible moment.

## Recommendation

Keep going, and keep it on this branch. The loop is expensive — twelve minutes per defect —
so the highest-value next step is **triaging the 18 INSERT mismatches statically before the
chain reaches them**, which converts up to 18 CI runs into one reading session. Second is
deciding what to do about the three undefined tables, which is an owner question, not an
engineering one.
