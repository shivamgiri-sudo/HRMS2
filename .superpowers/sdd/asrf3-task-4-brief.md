# Attendance Source Rules — WFM Upload Pipeline Foundations (Phase 3 of 11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The schema and logic layer for Requirement 17's WFM manual upload pipeline: the
Upload_Batch tables, a pure column-mapping-driven row parser, and the DB-backed validation
helpers (employee resolution, duplicate detection) an upload route will call. Schema + logic
only, same safety profile as Phases 1–2 — the actual Express route (multer, the preview/commit
endpoints) and the trigger that closes `apr`'s unattributed write path are Phase 4, so this phase
still touches zero live request handling.

**Architecture:** Two new tables (`productivity_upload_batch`, `productivity_upload_rejection`),
one pure parsing function (`parseUploadRow()` — applies a Dialler_Source's `column_mappings` JSON
to a raw row, no DB access), and one DB-backed validation service
(`productivity-upload-validation.service.ts` — employee-code resolution, duplicate-contribution
check, branch-scope check) that a future route will call in sequence.

**Tech Stack:** TypeScript, mysql2, vitest (+ fast-check where genuinely useful — this phase's
core logic is data mapping and DB lookups, not an algorithm with the tie-break/aggregation
subtlety Phases 1–2 had, so most tests here are example-based; property tests are used only
where a real invariant exists to state).

## Global Constraints

- No SQL runs against production without the owner's explicit approval — every migration here is
  written and registered but **not executed**.
- `ADD COLUMN IF NOT EXISTS` is invalid on MySQL 8.0.42 — not needed this phase (no ALTERs, only
  new tables).
- Every new table declares `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  explicitly.
- No `FOREIGN KEY` constraint on any new table.
- Every migration file is registered in `MIGRATION_MANIFEST`
  (`backend/src/db/runPendingMigrations.ts`) — **grep fresh for the true last entry before
  inserting**; do not assume a filename or line number. Phases 1 and 2 each hit a case where the
  brief's assumed anchor did not exist.
- vitest config: `fileParallelism: false`, `testTimeout: 30_000`, tests under
  `src/**/__tests__/**/*.test.ts`.
- **A `vi.mock` inside a file under `modules/wfm/__tests__/` needs `'../../../db/mysql.js'`**
### Task 4: Register migration 1638 in `MIGRATION_MANIFEST`

**Files:**
- Modify: `backend/src/db/runPendingMigrations.ts` (grep for the current last manifest entry
  fresh)
- Modify: `backend/sql/MIGRATION_MANIFEST.lock.json` (regenerated, not hand-edited)

- [ ] **Step 1: Find the true current last entry**

Run: `cd backend && grep -n "^\s*\"16[0-9][0-9]_" src/db/runPendingMigrations.ts | tail -5`
Insert after the LAST line printed.

- [ ] **Step 2: Add the entry**

```ts
  "1638_productivity_upload_batch.sql", // Creates productivity_upload_batch + productivity_upload_rejection: the Upload_Batch identity and per-row rejection tracking for the WFM manual upload pipeline (requirements.md Requirement 17). apr.upload_batch_id has 0 distinct values across all 46,163 rows today -- this table is the audit trail the new upload path (apr_manual_upload) will carry, closing that gap. Purely additive, not yet read by production code -- the upload route is Phase 4.
```

- [ ] **Step 3: Regenerate the lock file**

Run: `cd backend && node scripts/update-migration-lock.mjs --write`

- [ ] **Step 4: Run the manifest-guard contract test**

Run: `cd backend && npx vitest run src/db/__tests__/migration-manifest-guard.test.ts`
Expected: 8 pass, 1 pre-existing failure (unrelated duplicate-number count, documented in Phases
1–2's ledger entries — do not attempt to fix).

- [ ] **Step 5: Run every test this phase added, plus Phases 1–2's, together, as a final gate**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/attendance-source-rule-resolver.property.test.ts src/modules/wfm/__tests__/attendance-source-rule.service.test.ts src/modules/wfm/__tests__/day-threshold-rule.service.test.ts src/modules/wfm/__tests__/attendance-threshold-config.service.test.ts src/modules/wfm/__tests__/canonical-productivity.property.test.ts src/modules/wfm/__tests__/dialler-source-registry.service.test.ts src/modules/wfm/__tests__/productivity-upload-parser.test.ts src/modules/wfm/__tests__/productivity-upload-validation.service.test.ts src/db/__tests__/attendance-source-rule-store-migration.contract.test.ts src/db/__tests__/dialler-source-registry-migration.contract.test.ts src/db/__tests__/canonical-productivity-store-migration.contract.test.ts src/db/__tests__/productivity-upload-batch-migration.contract.test.ts`
Expected: PASS. Count them yourself from the actual output rather than trusting an estimate here
— every prior phase's plan-stated estimate has drifted from the true count by the time review
rounds finished.

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/runPendingMigrations.ts backend/sql/MIGRATION_MANIFEST.lock.json
git commit -m "chore: register migration 1638 in MIGRATION_MANIFEST"
```

---

