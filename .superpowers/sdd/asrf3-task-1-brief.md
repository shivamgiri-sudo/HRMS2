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
### Task 1: Migration 1638 — `productivity_upload_batch` + `productivity_upload_rejection`

**Files:**
- Create: `backend/sql/1638_productivity_upload_batch.sql`
- Test: `backend/src/db/__tests__/productivity-upload-batch-migration.contract.test.ts`

**Interfaces:**
- Produces: tables `productivity_upload_batch`, `productivity_upload_rejection` — column shapes
  consumed by Tasks 3–4.

- [ ] **Step 1: Write the migration**

```sql
-- 1638 — Upload_Batch identity and per-row rejection tracking for the WFM manual upload pipeline
-- (requirements.md Requirement 17).
--
-- NOT YET EXECUTED. Purely additive: two new tables, nothing altered, nothing read by production
-- code yet (the upload route is Phase 4). Needs owner approval before it runs (CLAUDE.md).
--
-- WHY THIS EXISTS
-- `apr.upload_batch_id` has 0 distinct values across all 46,163 rows -- every one of the 3,810
-- existing manual uploads landed with zero audit trail of who uploaded which file. This table is
-- that audit trail, for the NEW upload path this feature introduces (`apr_manual_upload`,
-- criterion 17.3) rather than the old unattributed write into `apr` (criterion 17.10, closed in a
-- later phase by a trigger).
--
-- WHAT productivity_upload_batch IS
-- One row per submitted file: which Dialler_Source, branch, process and date range it declares,
-- the file's name and a SHA-256 content digest, who uploaded it and when, the row-count
-- accounting (criterion 17.11: accepted + rejected = submitted), and supersession pointers
-- (criterion 17.7: a re-upload supersedes the prior batch's rows without deleting them).
--
-- WHAT productivity_upload_rejection IS
-- One row per rejected row, naming the row number, the employee code it named (if any) and the
-- rejection reason (criterion 17.2: "a reason for each rejected row" is a row, not a truncated
-- blob appended to the batch).
--
-- ROLLBACK
--   DROP TABLE productivity_upload_rejection;
--   DROP TABLE productivity_upload_batch;

CREATE TABLE IF NOT EXISTS productivity_upload_batch (
  id                    CHAR(36)     NOT NULL,
  batch_reference       VARCHAR(100) NOT NULL,
  dialler_source_id     CHAR(36)     NOT NULL,
  branch_id             CHAR(36)     NOT NULL,
  process_id            CHAR(36)     NOT NULL,
  date_from             DATE         NOT NULL,
  date_to               DATE         NOT NULL,
  file_name             VARCHAR(255) NOT NULL,
  content_digest        CHAR(64)     NOT NULL,
  uploaded_by           CHAR(36)     NOT NULL,
  submitted_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_row_count   INT UNSIGNED NOT NULL DEFAULT 0,
  accepted_row_count    INT UNSIGNED NOT NULL DEFAULT 0,
  rejected_row_count    INT UNSIGNED NOT NULL DEFAULT 0,
  mapping_version_used  SMALLINT UNSIGNED NULL,
  supersedes_batch_id   CHAR(36)     NULL,
  superseded_by_batch_id CHAR(36)    NULL,
  superseded_at         DATETIME     NULL,
  status                ENUM('pending','accepted','rejected','superseded') NOT NULL DEFAULT 'pending',
  PRIMARY KEY (id),
  UNIQUE KEY uq_pub_batch_reference (batch_reference),
  KEY idx_pub_source_branch_dates (dialler_source_id, branch_id, date_from, date_to),
  KEY idx_pub_status (status)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='One row per submitted WFM manual productivity upload (requirements.md Requirement 17). Not written by anything until Phase 4s route.';

CREATE TABLE IF NOT EXISTS productivity_upload_rejection (
  id             CHAR(36)     NOT NULL,
  batch_id       CHAR(36)     NOT NULL,
  row_number     INT UNSIGNED NOT NULL,
  employee_code  VARCHAR(50)  NULL,
  reason         VARCHAR(500) NOT NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pur_batch (batch_id)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='One row per rejected upload row, naming the reason (criterion 17.2). Not written by anything until Phase 4s route.';

SELECT '1638 applied: productivity_upload_batch + productivity_upload_rejection' AS migration_status;
```

- [ ] **Step 2: Write the contract test**

```ts
// backend/src/db/__tests__/productivity-upload-batch-migration.contract.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SQL_DIR = join(__dirname, '../../../sql');

function readMigration(file: string): string {
  return readFileSync(join(SQL_DIR, file), 'utf-8');
}

// Strips SQL line comments before checking for the ABSENCE of a pattern -- this migration's own
// ROLLBACK comment legitimately says "DROP TABLE", which a naive whole-file regex would
// false-positive against (this exact bug recurred three times in Phase 2; see
// canonical-productivity-store-migration.contract.test.ts for the established fix).
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

describe('productivity upload batch migration (1638)', () => {
  it('declares productivity_upload_batch with the row-count accounting columns (criterion 17.11)', () => {
    const sql = readMigration('1638_productivity_upload_batch.sql');
    expect(sql).toContain('submitted_row_count   INT UNSIGNED NOT NULL DEFAULT 0,');
    expect(sql).toContain('accepted_row_count    INT UNSIGNED NOT NULL DEFAULT 0,');
    expect(sql).toContain('rejected_row_count    INT UNSIGNED NOT NULL DEFAULT 0,');
  });

  it('declares the supersession columns (criterion 17.7)', () => {
    const sql = readMigration('1638_productivity_upload_batch.sql');
    expect(sql).toContain('supersedes_batch_id   CHAR(36)     NULL,');
    expect(sql).toContain('superseded_by_batch_id CHAR(36)    NULL,');
  });

  it('declares productivity_upload_rejection with one reason per row, keyed to the batch', () => {
    const sql = readMigration('1638_productivity_upload_batch.sql');
    expect(sql).toContain('reason         VARCHAR(500) NOT NULL,');
    expect(sql).toContain('KEY idx_pur_batch (batch_id)');
  });

  it('declares COLLATE=utf8mb4_unicode_ci and ENGINE=InnoDB on both tables', () => {
    const sql = readMigration('1638_productivity_upload_batch.sql');
    expect((sql.match(/COLLATE=utf8mb4_unicode_ci/g) || []).length).toBe(2);
    expect((sql.match(/ENGINE=InnoDB/g) || []).length).toBe(2);
  });

  it('declares no FOREIGN KEY anywhere', () => {
    const sql = readMigration('1638_productivity_upload_batch.sql');
    expect(stripSqlComments(sql)).not.toMatch(/FOREIGN KEY\s*\(/i);
  });

  it('declares batch_reference as unique', () => {
    const sql = readMigration('1638_productivity_upload_batch.sql');
    expect(sql).toContain('UNIQUE KEY uq_pub_batch_reference (batch_reference)');
  });
});
```

- [ ] **Step 3: Run the test**

Run: `cd backend && npx vitest run src/db/__tests__/productivity-upload-batch-migration.contract.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 4: Commit**

```bash
git add backend/sql/1638_productivity_upload_batch.sql \
        backend/src/db/__tests__/productivity-upload-batch-migration.contract.test.ts
git commit -m "feat: add productivity_upload_batch + productivity_upload_rejection tables (Requirement 17, unexecuted)"
```

---

