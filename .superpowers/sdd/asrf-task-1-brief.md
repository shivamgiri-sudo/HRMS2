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
### Task 1: Add `fast-check` as a devDependency

**Files:**
- Modify: `backend/package.json`
- Test: none (dependency install; verified by Task 3's property test actually running)

**Interfaces:**
- Produces: `fast-check` importable as `import fc from 'fast-check'` in any backend test file.

- [ ] **Step 1: Install the package**

Run: `cd backend && npm install --save-dev fast-check`
Expected: `package.json` gains a `"fast-check": "^<version>"` line under `devDependencies`, and
`package-lock.json` updates. No production dependency changes.

- [ ] **Step 2: Verify it resolves inside vitest**

Create a throwaway smoke test to prove the import works before building on it:

```ts
// backend/src/modules/wfm/__tests__/fast-check-smoke.test.ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

describe('fast-check smoke test', () => {
  it('runs a trivial property', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => n + 0 === n),
      { numRuns: 10 },
    );
  });
});
```

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/fast-check-smoke.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 3: Delete the smoke test and commit the dependency**

```bash
rm backend/src/modules/wfm/__tests__/fast-check-smoke.test.ts
cd backend && git add package.json package-lock.json
git commit -m "chore: add fast-check devDependency for property-based tests"
```

---

