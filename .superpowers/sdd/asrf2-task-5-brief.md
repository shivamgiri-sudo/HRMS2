# Attendance Source Rules — Dialler Registry & Canonical Aggregation (Phase 2 of 11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register every dialler as a first-class `Dialler_Source`, give manual-upload sources a
JSON column-mapping so future uploads don't need a code change, and implement
`deriveCanonical()` — the single pure function that turns a set of per-source contributions for
one employee-date into exactly one Canonical_Productive_Minutes figure, bounded to a calendar
day, never by summing concurrent sessions. Schema + pure functions only, same as Phase 1 — no
ingestion wiring, no engine wiring.

**Architecture:** Two new tables (`dialler_source`, `dialler_source_column_mapping`), one altered
table (`campaign_master` gains ownership columns), two new materialisation tables
(`attendance_productive_day`, `attendance_productive_contribution` — created now, written by
nobody until Phase 3's ingestion tasks), one pure aggregation function
(`deriveCanonical()`), and one thin read-only registry service resolving a feed identifier to an
active `Dialler_Source` row.

**Tech Stack:** TypeScript, mysql2, vitest + fast-check (already a devDependency as of Phase 1),
plain SQL migrations under `backend/sql/`.

## Global Constraints

- No SQL runs against production without the owner's explicit approval (CLAUDE.md hard stop) —
  every migration in this plan is written and registered but **not executed**.
- `ADD COLUMN IF NOT EXISTS` is invalid on this server's MySQL 8.0.42. The `campaign_master`
  ALTER uses the `INFORMATION_SCHEMA.COLUMNS` + `SET @sql = IF(...)` + `PREPARE`/`EXECUTE` idiom,
  copied verbatim from migration 1630's proven pattern (`backend/sql/1630_grn_funding_cost_centre.sql`).
- Every new table declares `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  explicitly.
- No `FOREIGN KEY` constraint on any NEW table or NEW column — plain indexed `CHAR(36)`, matching
  the convention every Phase 1 table already follows (and the reason migration 1500's FK is
  currently blocking every deploy). `campaign_master`'s two PRE-EXISTING FKs
  (`process_id`→`process_master`, `lob_id`→`lob_master`) are untouched — this migration adds
  columns, not constraints.
- Every migration file is registered in `MIGRATION_MANIFEST`
  (`backend/src/db/runPendingMigrations.ts`) with a one-paragraph inline comment. **Phase 1
  discovered the anchor line `"1632_salary_revision_page.sql"` does not exist in the manifest at
  all** (it's a deliberately-unregistered, pending-approval RBAC migration) — insert after
  whatever the actual last entry is at execution time; grep for it fresh, do not assume a line
  number.
- vitest config: `fileParallelism: false`, `testTimeout: 30_000`, tests live under
### Task 5: Register migrations 1636–1637 in `MIGRATION_MANIFEST`

**Files:**
- Modify: `backend/src/db/runPendingMigrations.ts` (grep for the current last manifest entry
  fresh — do not assume it is `"1635_attendance_threshold_and_ceiling_store.sql"`, another
  session may have appended entries after Phase 1 landed)
- Modify: `backend/sql/MIGRATION_MANIFEST.lock.json` (regenerated, not hand-edited)

**Interfaces:**
- Consumes: nothing new.
- Produces: `MIGRATION_MANIFEST` includes `1636_dialler_source_registry.sql` and
  `1637_canonical_productivity_store.sql`.

- [ ] **Step 1: Find the true current last entry**

Run: `cd backend && grep -n "^\s*\"16[0-9][0-9]_" src/db/runPendingMigrations.ts | tail -5`
Read the output. Insert after the LAST line printed, whatever filename it names — do not assume
it is a specific Phase 1 file, another session may have appended entries since.

- [ ] **Step 2: Add the two entries**

Using Edit, insert immediately after the last entry found in Step 1:

```ts
  "1636_dialler_source_registry.sql", // Creates dialler_source + dialler_source_column_mapping: the Dialler_Source registry (requirements.md Requirement 16) that gives every productivity feed a first-class identity, plus a per-source Column_Mapping (criteria 16.12-16.14) so a manual-upload report's column layout is a configuration change, not a code change, mirroring wfm_header_mapping_profile's proven JSON-blob shape (migration 1500) rather than a new EAV table. Purely additive, no FOREIGN KEY (unlike 1500's, which currently blocks every deploy), not yet read by production code.
  "1637_canonical_productivity_store.sql", // Adds campaign_master.dialler_source_id/owning_branch_id/is_sentinel (criteria 16.7, 16.8) via the INFORMATION_SCHEMA + PREPARE/EXECUTE guard (ADD COLUMN IF NOT EXISTS is invalid MySQL 8 syntax), and creates attendance_productive_day + attendance_productive_contribution, the materialised Canonical_Productive_Minutes store (Requirement 18). Neither new table is written by anything yet -- deriveCanonical() (this phase) is a pure function with no DB access; the write path is Phase 3's ingestion tasks.
```

- [ ] **Step 3: Regenerate the lock file**

Run: `cd backend && node scripts/update-migration-lock.mjs --write`
Expected: `backend/sql/MIGRATION_MANIFEST.lock.json` updates to include the two new files.

Run: `git diff backend/sql/MIGRATION_MANIFEST.lock.json`
Expected: new entries appended for 1636 and 1637; nothing removed or reordered from what Phase 1
already added.

- [ ] **Step 4: Run the manifest-guard contract test**

Run: `cd backend && npx vitest run src/db/__tests__/migration-manifest-guard.test.ts`
Expected: 8 pass, 1 pre-existing failure (`duplicate migration numbers grew unexpectedly:
expected N to be less than or equal to 61` — this predates Phase 1 and Phase 2 both; do not
attempt to fix it as part of this task, it is out of scope, confirm the failing count did not
change because of 1636/1637 specifically — both numbers are unique, so it should not).

- [ ] **Step 5: Run every test this phase (and Phase 1) added, together, as a final gate**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/attendance-source-rule-resolver.property.test.ts src/modules/wfm/__tests__/attendance-source-rule.service.test.ts src/modules/wfm/__tests__/day-threshold-rule.service.test.ts src/modules/wfm/__tests__/attendance-threshold-config.service.test.ts src/modules/wfm/__tests__/canonical-productivity.property.test.ts src/modules/wfm/__tests__/dialler-source-registry.service.test.ts src/db/__tests__/attendance-source-rule-store-migration.contract.test.ts src/db/__tests__/dialler-source-registry-migration.contract.test.ts src/db/__tests__/canonical-productivity-store-migration.contract.test.ts`
Expected: PASS, 58 tests total (14 resolver + 2 source-rule + 1 day-threshold + 3
threshold-config + 12 canonical-productivity + 7 registry + 8 Phase-1-migration-contract + 5
Phase-2-registry-contract + 6 Phase-2-productivity-contract — recount against what actually
landed if any earlier task's review round changed a count; this arithmetic was itself corrected
once during self-review, so verify it rather than trust it).

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/runPendingMigrations.ts backend/sql/MIGRATION_MANIFEST.lock.json
git commit -m "chore: register migrations 1636-1637 in MIGRATION_MANIFEST"
```

---

