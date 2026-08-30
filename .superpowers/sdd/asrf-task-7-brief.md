# Attendance Source Rule — Foundation (Phase 1 of 11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the single effective-dated Attendance_Source_Rule store, the Day_Threshold_Rule
store, the three threshold-kind config store and the Dual_Review_Ceiling store, plus one pure,
property-tested resolver reused by all four — with zero changes to `attendanceEngineService` or any
existing behaviour. This is schema-plus-pure-function only; nothing reads from these tables in
production yet.

**Architecture:** New tables only (additive, unexecuted pending owner approval per CLAUDE.md). One
generic pure function `resolveRule<T>()` implements Requirement 2's candidacy → specificity →
Dimension_Priority_Order → deterministic-tail algorithm once; four thin DB-backed wrapper services
(source rule, day threshold, the three threshold kinds, dual-review ceiling) each load their own
table's active/in-window rows and hand them to the same resolver.

**Tech Stack:** TypeScript, Express/mysql2 (existing `db` pool from `backend/src/db/mysql.js`),
vitest + fast-check (new devDependency) for property tests, plain SQL migrations under
`backend/sql/`.

## Global Constraints

- No SQL runs against production without the owner's explicit approval (CLAUDE.md hard stop) — every
  migration in this plan is written and registered but **not executed**.
- `ADD COLUMN IF NOT EXISTS` is invalid on this server's MySQL 8.0.42; any future ALTER in later
  phases uses the `INFORMATION_SCHEMA.COLUMNS` + `PREPARE`/`EXECUTE` idiom. No ALTERs in this phase —
  every table here is new.
- Every new table declares `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  explicitly — a bare `CHARSET=utf8mb4` resolves to the server default `utf8mb4_0900_ai_ci` and the
  first join to `employees` is a hard `ER_CANT_AGGREGATE_2COLLATIONS` (1267); migration 1627 exists
  solely to repair 49 tables that hit this.
- No `FOREIGN KEY` constraints — every ID column is a plain indexed `CHAR(36)`, per the established
  no-FK convention (`employee_manager_history`, migration 1624) and because migration 1500's
  `wfm_header_mapping_profile` FK to `process_master` is the one already blocking every deploy.
- Every migration file is registered in `MIGRATION_MANIFEST` (`backend/src/db/runPendingMigrations.ts`)
  with a one-paragraph inline comment, per the manifest convention every existing entry follows.
- vitest config: `fileParallelism: false`, `testTimeout: 30_000`, tests live under
  `src/**/__tests__/**/*.test.ts` — this plan's tests follow that path shape inside
  `backend/src/modules/wfm/__tests__/`.
- Source: `requirements.md` Requirements 1, 2, 6.10; `design.md` components 1–2 and the
  Dual_Review_Ceiling / Column_Mapping additions.

---

## File Structure
### Task 7: Register migrations 1633–1635 in `MIGRATION_MANIFEST`

**Files:**
- Modify: `backend/src/db/runPendingMigrations.ts:817` (immediately after the existing
  `"1632_salary_revision_page.sql"` entry — confirm the exact current last line with
  `grep -n "1632_salary_revision_page.sql" backend/src/db/runPendingMigrations.ts` before editing,
  since other sessions may have appended entries after it)
- Modify: `backend/sql/MIGRATION_MANIFEST.lock.json` (regenerated, not hand-edited)

**Interfaces:**
- Consumes: nothing new.
- Produces: `MIGRATION_MANIFEST` includes the three new filenames, so
  `scripts/migrate-fresh-test.ts` and the existing manifest-guard contract test pick them up.

- [ ] **Step 1: Confirm the current manifest tail and the migration file's own registration guard**

Run: `cd backend && grep -n "1632_salary_revision_page.sql" src/db/runPendingMigrations.ts`
Expected: one line, e.g. `814:  "1632_salary_revision_page.sql", // ...`

This repository has a manifest-guard contract test (per CLAUDE.md/design.md: "every new SQL file
appears in MIGRATION_MANIFEST, which the existing manifest guard already enforces") — running it
now, before the edit, confirms it currently passes and will be the thing that fails next.

Run: `cd backend && npx vitest run --reporter=verbose 2>&1 | grep -i "manifest"`
Expected: an existing test name containing "manifest" is listed and passing.

- [ ] **Step 2: Add the three entries**

Using Edit on `backend/src/db/runPendingMigrations.ts`, insert immediately after the
`"1632_salary_revision_page.sql"` line found in Step 1:

```ts
  "1633_attendance_source_rule_store.sql", // Creates attendance_source_rule + attendance_source_rule_dimension_value: the single effective-dated Attendance_Source_Rule store (requirements.md Requirement 1) that replaces attendance_rule_config + apr_eligibility_config's non-deterministic OR-combination. Resolution is a pure in-memory function (attendance-source-rule-resolver.ts), not a SQL ORDER BY ... LIMIT 1 tiebreak. Purely additive — two new tables, no ALTER, nothing read by production code yet; the engine cutover and the migration-15 proposal/approval workflow are later phases. No FOREIGN KEY (matches the no-FK convention; migration 1500's FK to process_master is the one already blocking every deploy).
  "1634_day_threshold_rule_store.sql", // Creates day_threshold_rule + day_threshold_rule_dimension_value: full_day_minutes/half_day_minutes/grace_minutes relocated out of attendance_rule_config (criteria 1.14-1.16), resolved by the same six Rule_Dimensions and the same resolver as attendance_source_rule. Purely additive, not yet read by classifyMinutes().
  "1635_attendance_threshold_and_ceiling_store.sql", // Creates attendance_threshold_rule (+ dimension_value child) for the three threshold kinds (apr_corroboration/variance_tolerance/floor_absence_ceiling, defaults 480/60/60) and attendance_dual_review_ceiling, scoped to branch + Pay_Month rather than the six Rule_Dimensions (criterion 6.10). Purely additive.
```

- [ ] **Step 3: Regenerate the lock file**

Run: `cd backend && node scripts/update-migration-lock.mjs`
Expected: `backend/sql/MIGRATION_MANIFEST.lock.json` updates to include checksums for the three
new files; diff it to confirm only additions, no removed or reordered entries:

Run: `git diff backend/sql/MIGRATION_MANIFEST.lock.json`
Expected: three new JSON entries appended, nothing else changed.

- [ ] **Step 4: Run the manifest-guard contract test again to confirm it passes with the new files registered**

Run: `cd backend && npx vitest run --reporter=verbose 2>&1 | grep -i "manifest"`
Expected: the same test(s) from Step 1, still passing.

- [ ] **Step 5: Run the full new-file test suite from Tasks 2-6 together, once, as a final gate**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/attendance-source-rule-resolver.property.test.ts src/modules/wfm/__tests__/attendance-source-rule.service.test.ts src/modules/wfm/__tests__/day-threshold-rule.service.test.ts src/modules/wfm/__tests__/attendance-threshold-config.service.test.ts src/db/__tests__/attendance-source-rule-store-migration.contract.test.ts`
Expected: PASS, 16 tests total (4 property + 2 + 1 + 3 + 6 contract).

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/runPendingMigrations.ts backend/sql/MIGRATION_MANIFEST.lock.json
git commit -m "chore: register migrations 1633-1635 in MIGRATION_MANIFEST"
```

---

