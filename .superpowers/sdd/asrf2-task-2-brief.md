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
### Task 2: Migration 1637 — `campaign_master` ownership columns + productivity materialisation tables

**Files:**
- Create: `backend/sql/1637_canonical_productivity_store.sql`
- Test: `backend/src/db/__tests__/canonical-productivity-store-migration.contract.test.ts`

**Interfaces:**
- Produces: `campaign_master.dialler_source_id`, `campaign_master.owning_branch_id`,
  `campaign_master.is_sentinel`; tables `attendance_productive_day`,
  `attendance_productive_contribution` — consumed by Task 4 and by Phase 3's ingestion tasks.

- [ ] **Step 1: Write the migration**

```sql
-- 1637 — campaign_master ownership columns + Canonical_Productive_Minutes materialisation
-- (requirements.md Requirement 16 criteria 16.7-16.8, Requirement 18).
--
-- NOT YET EXECUTED. Additive: three nullable/defaulted columns on an existing table, two new
-- tables. No DROP, no DELETE, no backfill of existing campaign_master rows (0 rows exist today —
-- backend/sql/015_platform_foundation.sql created the table but nothing has ever populated it).
-- Needs owner approval before it runs (CLAUDE.md).
--
-- WHY THIS EXISTS
-- campaign_master exists (015_platform_foundation.sql: id, campaign_code, campaign_name,
-- process_id, lob_id, active_status) but holds 0 rows, so the 78 distinct `apr.campaign_id`
-- values in production are unmanaged free text with no owning process or dialler anywhere. This
-- migration adds the two columns that let a campaign declare which Dialler_Source it belongs to
-- and, separately, marks the 'MANUAL_UPLOAD' sentinel campaign (criterion 16.8: 'MANUAL_UPLOAD'
-- is rejected as a Dialler_Source identifier, but still needs a seeded, inactive-by-convention
-- campaign_master row so the canonical aggregator can recognise and exclude it by is_sentinel
-- rather than by string comparison scattered across the codebase).
--
-- ALTER uses the INFORMATION_SCHEMA.COLUMNS + PREPARE/EXECUTE idiom (migration 1630's proven
-- pattern) because ADD COLUMN IF NOT EXISTS is not valid MySQL 8 syntax and would record as
-- applied while having failed. campaign_master's two PRE-EXISTING FOREIGN KEYs
-- (process_id -> process_master, lob_id -> lob_master) are untouched; the two NEW columns this
-- migration adds carry no FK, matching this feature's established no-FK convention.
--
-- WHAT attendance_productive_day / attendance_productive_contribution ARE
-- One row per (employee, work_date) holding the derived Canonical_Productive_Minutes and which
-- of the two Requirement-18 rules produced it; one row per (employee, work_date, dialler_source,
-- feed, source_row_ref) holding the individual contribution that fed that derivation, so the
-- Consolidated_Productivity_View (a later UI phase) can show the breakdown. NEITHER TABLE IS
-- WRITTEN BY ANYTHING YET — deriveCanonical() (this phase) is a pure function with no DB access;
-- the write path is Phase 3's ingestion tasks (vicidial sync worker, WFM upload, dbSyncService).
-- Creating the tables now, ahead of their writers, lets Task 4 of this plan and every later
-- phase's tests target a real schema instead of a moving target.
--
-- ROLLBACK
--   DROP TABLE attendance_productive_contribution;
--   DROP TABLE attendance_productive_day;
--   ALTER TABLE campaign_master DROP COLUMN is_sentinel, DROP COLUMN owning_branch_id, DROP COLUMN dialler_source_id;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'campaign_master'
      AND column_name = 'dialler_source_id') = 0,
  'ALTER TABLE campaign_master
     ADD COLUMN dialler_source_id CHAR(36) NULL
       COMMENT ''Owning Dialler_Source for this campaign (criterion 16.7). NULL until the migration-15 disposition assigns one.''
       AFTER lob_id',
  'SELECT ''campaign_master.dialler_source_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'campaign_master'
      AND column_name = 'owning_branch_id') = 0,
  'ALTER TABLE campaign_master
     ADD COLUMN owning_branch_id CHAR(36) NULL
       COMMENT ''Branch this campaign is scoped to, if any. NULL = every branch.''
       AFTER dialler_source_id',
  'SELECT ''campaign_master.owning_branch_id already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'campaign_master'
      AND column_name = 'is_sentinel') = 0,
  'ALTER TABLE campaign_master
     ADD COLUMN is_sentinel TINYINT(1) NOT NULL DEFAULT 0
       COMMENT ''1 for the seeded MANUAL_UPLOAD sentinel row (criterion 16.8) -- excluded from Canonical_Productive_Minutes by this flag, not by string comparison.''
       AFTER owning_branch_id',
  'SELECT ''campaign_master.is_sentinel already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS attendance_productive_day (
  employee_id         CHAR(36)  NOT NULL,
  work_date           DATE      NOT NULL,
  canonical_minutes    SMALLINT UNSIGNED NULL,
  producing_rule       ENUM('interval_union','max_contribution') NULL,
  contribution_count   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  derivation_version   SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  derived_at           DATETIME  NULL,
  PRIMARY KEY (employee_id, work_date),
  KEY idx_apd_date (work_date)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Materialised Canonical_Productive_Minutes (Requirement 18), one row per employee-date. canonical_minutes NULL means absent -- never a measured zero. Not written by anything until Phase 3.';

CREATE TABLE IF NOT EXISTS attendance_productive_contribution (
  id                 CHAR(36)     NOT NULL,
  employee_id        CHAR(36)     NOT NULL,
  work_date          DATE         NOT NULL,
  dialler_source_id  CHAR(36)     NOT NULL,
  feed               ENUM('apr_sync','apr_manual','dialer_session_log') NOT NULL,
  source_row_ref     VARCHAR(255) NOT NULL,
  upload_batch_id    CHAR(36)     NULL,
  login_at           DATETIME     NULL,
  logout_at          DATETIME     NULL,
  magnitude_minutes  SMALLINT UNSIGNED NOT NULL,
  interval_usable    TINYINT(1)   NOT NULL DEFAULT 0,
  exclusion_reason   VARCHAR(255) NULL,
  metrics            JSON         NULL,
  superseded_at      DATETIME     NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_apc (employee_id, work_date, dialler_source_id, feed, source_row_ref),
  KEY idx_apc_emp_date (employee_id, work_date)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='One row per (employee, date, source) contribution to Canonical_Productive_Minutes (Requirement 18). superseded_at IS NULL rows are the live set; excluded once superseded. Not written by anything until Phase 3.';

SELECT '1637 applied: campaign_master ownership columns + attendance_productive_day + attendance_productive_contribution' AS migration_status;
```

- [ ] **Step 2: Write the contract test**

```ts
// backend/src/db/__tests__/canonical-productivity-store-migration.contract.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SQL_DIR = join(__dirname, '../../../sql');

function readMigration(file: string): string {
  return readFileSync(join(SQL_DIR, file), 'utf-8');
}

describe('canonical productivity store migration (1637)', () => {
  it('guards all three campaign_master ALTERs on information_schema (no bare ADD COLUMN IF NOT EXISTS)', () => {
    const sql = readMigration('1637_canonical_productivity_store.sql');
    expect(sql).not.toMatch(/ADD COLUMN IF NOT EXISTS/i);
    expect((sql.match(/PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;/g) || []).length).toBe(3);
  });

  it('adds dialler_source_id, owning_branch_id and is_sentinel to campaign_master', () => {
    const sql = readMigration('1637_canonical_productivity_store.sql');
    expect(sql).toContain('ADD COLUMN dialler_source_id CHAR(36) NULL');
    expect(sql).toContain('ADD COLUMN owning_branch_id CHAR(36) NULL');
    expect(sql).toContain("ADD COLUMN is_sentinel TINYINT(1) NOT NULL DEFAULT 0");
  });

  it('does not touch campaign_master\'s existing FOREIGN KEYs (only ADD COLUMN statements against it)', () => {
    const sql = readMigration('1637_canonical_productivity_store.sql');
    // Matches an actual FOREIGN KEY constraint declaration ("FOREIGN KEY (col)"), not prose that
    // merely mentions the phrase — this migration's own header comment legitimately says
    // "campaign_master's two PRE-EXISTING FOREIGN KEYs" while adding none itself, so a bare
    // /FOREIGN KEY/i would false-positive against that comment (the exact bug Task 1's brief had).
    expect(sql).not.toMatch(/FOREIGN KEY\s*\(/i);
    expect(sql).not.toMatch(/DROP\s+(COLUMN|CONSTRAINT|FOREIGN KEY)/i);
  });

  it('declares attendance_productive_day keyed (employee_id, work_date) with canonical_minutes nullable', () => {
    const sql = readMigration('1637_canonical_productivity_store.sql');
    expect(sql).toContain('PRIMARY KEY (employee_id, work_date)');
    expect(sql).toContain('canonical_minutes    SMALLINT UNSIGNED NULL');
  });

  it('declares attendance_productive_contribution with the supersession column and a uniqueness key covering feed + source_row_ref', () => {
    const sql = readMigration('1637_canonical_productivity_store.sql');
    expect(sql).toContain('superseded_at      DATETIME     NULL');
    expect(sql).toContain('UNIQUE KEY uq_apc (employee_id, work_date, dialler_source_id, feed, source_row_ref)');
  });

  it('declares COLLATE=utf8mb4_unicode_ci and ENGINE=InnoDB on both new tables', () => {
    const sql = readMigration('1637_canonical_productivity_store.sql');
    expect((sql.match(/COLLATE=utf8mb4_unicode_ci/g) || []).length).toBe(2);
    expect((sql.match(/ENGINE=InnoDB/g) || []).length).toBe(2);
  });
});
```

- [ ] **Step 3: Run the test**

Run: `cd backend && npx vitest run src/db/__tests__/canonical-productivity-store-migration.contract.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 4: Commit**

```bash
git add backend/sql/1637_canonical_productivity_store.sql \
        backend/src/db/__tests__/canonical-productivity-store-migration.contract.test.ts
git commit -m "feat: add campaign_master ownership columns + attendance_productive_day/contribution tables (Requirement 16/18, unexecuted)"
```

---

