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
  `src/**/__tests__/**/*.test.ts`.
- **A `vi.mock` inside a file under `modules/wfm/__tests__/` needs THREE `../` to reach
  `backend/src/db/mysql.js`** (`'../../../db/mysql.js'`), not two — Phase 1's Task 4 hit this
  exact bug (the brief had `'../../db/mysql.js'`) and every task below has already been checked
  against it.
- Source: `requirements.md` Requirement 16, Requirement 18; `design.md` components 3 and 5, and
  the Column_Mapping addition (component 3, criteria 16.12–16.14).

---

## File Structure

```
backend/sql/
  1636_dialler_source_registry.sql        # dialler_source + dialler_source_column_mapping
  1637_canonical_productivity_store.sql   # campaign_master ALTER + attendance_productive_day
                                           # + attendance_productive_contribution

backend/src/modules/wfm/
  canonical-productivity.ts               # deriveCanonical() — pure, Requirement 18
  dialler-source-registry.service.ts      # DB-backed: resolve a feed identifier to an active
                                           # Dialler_Source, validate Metric_Availability,
                                           # resolve a campaign to its owning source

backend/src/modules/wfm/__tests__/
  canonical-productivity.property.test.ts
  dialler-source-registry.service.test.ts
```

`deriveCanonical()` mirrors Phase 1's `attendance-source-rule-resolver.ts`: a pure function with
no DB access, directly property-testable, imported by a thin DB-backed service. Midnight
apportionment (criterion 18.8 — a session that crosses midnight apportioned across two calendar
dates) is **deliberately deferred to Phase 3**: design.md notes the engine's existing
`buildShiftWindowInfo()` / `isCrossMidnightShift()` (`attendance-engine.service.ts`) already
encode this and should be reused, and that reuse only makes sense once Phase 3 is converting real
`Login_Time`/`Logout_Time` database rows into `Contribution` objects. `deriveCanonical()` itself
operates on contributions already scoped to one calendar date and does not need to know how they
got that way.

---

### Task 1: Migration 1636 — `dialler_source` + `dialler_source_column_mapping`

**Files:**
- Create: `backend/sql/1636_dialler_source_registry.sql`
- Test: `backend/src/db/__tests__/dialler-source-registry-migration.contract.test.ts`

**Interfaces:**
- Produces: tables `dialler_source`, `dialler_source_column_mapping` — column shapes consumed by
  Task 4.

- [ ] **Step 1: Write the migration**

```sql
-- 1636 — Dialler_Source registry: every productivity system the business operates, registered
-- by name with the metrics it can supply (requirements.md Requirement 16), plus a per-source
-- Column_Mapping so a manual-upload report whose column layout differs from the base template
-- is a configuration change, not a code change (criteria 16.12-16.14).
--
-- NOT YET EXECUTED. Purely additive: two new tables, nothing altered, nothing read by production
-- code yet (the ingestion wiring is Phase 3; the admin-screen write path is a later UI phase).
-- Needs owner approval before it runs (CLAUDE.md).
--
-- WHY THIS EXISTS
-- `dialer_session_log` holds 1,365 rows over 64 employees with `dialer_name` NULL on every row,
-- exactly one `integration_key` ('dialer_1') and one `source_system`
-- ('dialer_db.vicidial_agent_log_249') — a single ViciDial instance. `apr.campaign_id` holds 78
-- distinct free-text values with no owning process or dialler anywhere
-- (`campaign_master` holds 0 rows today). 3,810 manual `apr` rows all carry the single sentinel
-- campaign_id 'MANUAL_UPLOAD', so the originating dialler system is recorded nowhere. Three
-- productivity feeds are already in play (`apr`/sync, `apr`/manual, `dialer_session_log`) with no
-- common source registry — this table is that registry.
--
-- WHAT dialler_source IS
-- One row per registered productivity system: a stable `source_key`, a display name, an
-- ingestion mode (`integrated_pull` or `manual_upload`), an optional owning branch/process scope
-- (NULL = serves every branch/process), the declared Metric_Availability (which of the 14
-- controlled metrics this source actually supplies — criterion 16.3, validated at the
-- application layer against `PRODUCTIVITY_METRICS`, added in Task 4), and an effective-date
-- window matching every other store in this feature.
--
-- WHAT dialler_source_column_mapping IS
-- For a `manual_upload` source, a JSON object mapping that source's actual report-file column
-- headers to this system's target Upload fields, mirroring the JSON-blob shape already proven by
-- `wfm_header_mapping_profile` (migration 1500, `backend/src/modules/wfm/header-mapping-profile.service.ts`)
-- for a different bulk upload (roster import) in this same module, rather than inventing a
-- second normalized-row shape for the same idea. Unlike migration 1500's table, this one carries
-- no FOREIGN KEY — migration 1500's FK to `process_master` is the one currently blocking every
-- deploy, and every other table in this feature already avoids that pattern. A mapping is
-- versioned (`mapping_version`): amending it governs only submissions from that point forward.
--
-- ROLLBACK
--   DROP TABLE dialler_source_column_mapping;
--   DROP TABLE dialler_source;

CREATE TABLE IF NOT EXISTS dialler_source (
  id                   CHAR(36)     NOT NULL,
  source_key           VARCHAR(100) NOT NULL,
  display_name         VARCHAR(255) NOT NULL,
  ingestion_mode       ENUM('integrated_pull','manual_upload') NOT NULL,
  integration_key      VARCHAR(100) NULL,
  owning_branch_id     CHAR(36)     NULL,
  owning_process_id    CHAR(36)     NULL,
  metric_availability  JSON         NOT NULL,
  effective_from       DATE         NOT NULL,
  effective_to         DATE         NULL,
  active_status        TINYINT      NOT NULL DEFAULT 1,
  created_by           CHAR(36)     NULL,
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dialler_source_key (source_key),
  KEY idx_dialler_source_active_window (active_status, effective_from, effective_to)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Registered Dialler_Source (requirements.md Requirement 16). Every row ingested into a Productivity_Feed must resolve to exactly one active row here (criteria 16.4, 16.5) before it can contribute to Canonical_Productive_Minutes.';

CREATE TABLE IF NOT EXISTS dialler_source_column_mapping (
  id                CHAR(36)       NOT NULL,
  dialler_source_id CHAR(36)       NOT NULL,
  mapping_version   SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  column_mappings   JSON           NOT NULL,
  effective_from    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  effective_to      DATETIME       NULL,
  is_active         TINYINT(1)     NOT NULL DEFAULT 1,
  created_by        CHAR(36)       NULL,
  created_at        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME       NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dscm (dialler_source_id, mapping_version),
  KEY idx_dscm_source_active (dialler_source_id, is_active)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-Dialler_Source column mapping for manual_upload sources (criteria 16.12-16.14), JSON-blob shape mirroring wfm_header_mapping_profile (migration 1500). No FOREIGN KEY, unlike 1500.';

SELECT '1636 applied: dialler_source + dialler_source_column_mapping' AS migration_status;
```

- [ ] **Step 2: Write the contract test**

```ts
// backend/src/db/__tests__/dialler-source-registry-migration.contract.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SQL_DIR = join(__dirname, '../../../sql');

function readMigration(file: string): string {
  return readFileSync(join(SQL_DIR, file), 'utf-8');
}

describe('dialler source registry migration (1636)', () => {
  it('declares dialler_source with the ingestion_mode ENUM this design requires', () => {
    const sql = readMigration('1636_dialler_source_registry.sql');
    expect(sql).toContain("ingestion_mode       ENUM('integrated_pull','manual_upload') NOT NULL");
  });

  it('declares dialler_source_column_mapping with the JSON column_mappings shape, not a row-per-pair EAV table', () => {
    const sql = readMigration('1636_dialler_source_registry.sql');
    expect(sql).toContain('column_mappings   JSON           NOT NULL');
    expect(sql).toContain('UNIQUE KEY uq_dscm (dialler_source_id, mapping_version)');
  });

  it('declares COLLATE=utf8mb4_unicode_ci and ENGINE=InnoDB on both tables', () => {
    const sql = readMigration('1636_dialler_source_registry.sql');
    expect((sql.match(/COLLATE=utf8mb4_unicode_ci/g) || []).length).toBe(2);
    expect((sql.match(/ENGINE=InnoDB/g) || []).length).toBe(2);
  });

  it('declares no FOREIGN KEY anywhere', () => {
    const sql = readMigration('1636_dialler_source_registry.sql');
    expect(sql).not.toMatch(/FOREIGN KEY/i);
  });

  it('declares source_key as unique so a duplicate registration is rejected at the database layer too (criterion 16.2)', () => {
    const sql = readMigration('1636_dialler_source_registry.sql');
    expect(sql).toContain('UNIQUE KEY uq_dialler_source_key (source_key)');
  });
});
```

- [ ] **Step 3: Run the test**

Run: `cd backend && npx vitest run src/db/__tests__/dialler-source-registry-migration.contract.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 4: Commit**

```bash
git add backend/sql/1636_dialler_source_registry.sql \
        backend/src/db/__tests__/dialler-source-registry-migration.contract.test.ts
git commit -m "feat: add dialler_source + dialler_source_column_mapping tables (Requirement 16, unexecuted)"
```

---

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
    expect(sql).not.toMatch(/FOREIGN KEY/i);
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

### Task 3: `deriveCanonical()` — the canonical daily aggregation algorithm

**Files:**
- Create: `backend/src/modules/wfm/canonical-productivity.ts`
- Test: `backend/src/modules/wfm/__tests__/canonical-productivity.property.test.ts`

**Interfaces:**
- Consumes: nothing (pure function, no DB).
- Produces (consumed by Phase 3's ingestion tasks, not this phase):
  ```ts
  export interface Contribution {
    diallerSourceId: string;
    interval: { startMinute: number; endMinute: number } | null;
    magnitudeMinutes: number;
  }
  export type ProducingRule = 'interval_union' | 'max_contribution';
  export interface CanonicalResult {
    minutes: number | null;
    rule: ProducingRule | null;
    excludedCount: number;
  }
  export function deriveCanonical(contributions: Contribution[]): CanonicalResult;
  ```

- [ ] **Step 1: Write the failing property tests**

```ts
// backend/src/modules/wfm/__tests__/canonical-productivity.property.test.ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { deriveCanonical, type Contribution } from '../canonical-productivity.js';

// Minutes-from-midnight domain, kept small so overlaps/adjacency/nesting occur often.
const MAX_MINUTE = 200;

const usableIntervalArb: fc.Arbitrary<{ startMinute: number; endMinute: number }> = fc
  .tuple(fc.integer({ min: 0, max: MAX_MINUTE }), fc.integer({ min: 1, max: MAX_MINUTE }))
  .map(([a, b]) => (a < b ? { startMinute: a, endMinute: b } : { startMinute: b, endMinute: a + 1 }))
  .filter((iv) => iv.startMinute < iv.endMinute);

const contributionArb: fc.Arbitrary<Contribution> = fc.record({
  diallerSourceId: fc.uuid(),
  interval: fc.option(usableIntervalArb, { nil: null }),
  magnitudeMinutes: fc.integer({ min: 1, max: 1500 }),
});

const allUsableContributionsArb: fc.Arbitrary<Contribution[]> = fc.array(
  fc.record({
    diallerSourceId: fc.uuid(),
    interval: usableIntervalArb,
    magnitudeMinutes: fc.integer({ min: 1, max: 1500 }),
  }),
  { minLength: 1, maxLength: 8 },
);

describe('deriveCanonical — Property 20: The daily bound holds', () => {
  it('canonical minutes is never more than 1440 for any set of contributions', () => {
    // Feature: payroll-attendance-source-rules, Property 20: The daily bound holds
    fc.assert(
      fc.property(fc.array(contributionArb, { maxLength: 10 }), (contributions) => {
        const result = deriveCanonical(contributions);
        if (result.minutes !== null) {
          expect(result.minutes).toBeLessThanOrEqual(1440);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('deriveCanonical — Property 21: Neither shrinkage nor inflation', () => {
  it('canonical minutes is at least the largest single contribution and at most the sum of all contributions, measured on the basis the governing rule actually uses', () => {
    // Feature: payroll-attendance-source-rules, Property 21: Neither shrinkage nor inflation
    //
    // The "contribution size" a bound is measured against depends on which rule governs:
    // interval_union never reads magnitudeMinutes at all, so a bound stated over magnitudes
    // would be comparing two unrelated random quantities (design.md Risk #5: Net_Login is a
    // bucket sum, not a span). The real invariant for interval_union is the standard
    // union-of-intervals inequality: union length is always >= the longest member interval and
    // always <= the sum of member interval lengths. For max_contribution, magnitudeMinutes IS
    // the basis the rule uses, so the bound is stated over magnitudes there.
    fc.assert(
      fc.property(fc.array(contributionArb, { minLength: 1, maxLength: 8 }), (contributions) => {
        const result = deriveCanonical(contributions);
        if (result.minutes === null) return; // all-excluded case, nothing to bound

        if (result.rule === 'max_contribution') {
          const magnitudes = contributions.map((c) => c.magnitudeMinutes);
          const largestSingle = Math.max(...magnitudes);
          const sumAll = magnitudes.reduce((a, b) => a + b, 0);
          expect(result.minutes).toBeGreaterThanOrEqual(Math.min(largestSingle, 1440));
          expect(result.minutes).toBeLessThanOrEqual(Math.min(sumAll, 1440));
        } else {
          const lengths = contributions.map((c) => c.interval!.endMinute - c.interval!.startMinute);
          const largestSingle = Math.max(...lengths);
          const sumAll = lengths.reduce((a, b) => a + b, 0);
          expect(result.minutes).toBeGreaterThanOrEqual(Math.min(largestSingle, 1440));
          expect(result.minutes).toBeLessThanOrEqual(Math.min(sumAll, 1440));
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('deriveCanonical — Property 22: Recomputation stability, and the producing rule is recorded', () => {
  it('two consecutive derivations over an unchanged contribution set return the same minutes and the same rule', () => {
    // Feature: payroll-attendance-source-rules, Property 22: Recomputation stability, and the producing rule is recorded
    fc.assert(
      fc.property(fc.array(contributionArb, { maxLength: 8 }), (contributions) => {
        const first = deriveCanonical(contributions);
        const second = deriveCanonical(contributions);
        expect(second.minutes).toBe(first.minutes);
        expect(second.rule).toBe(first.rule);
      }),
      { numRuns: 300 },
    );
  });

  it('the recorded rule is max_contribution exactly when at least one contribution lacks a usable interval', () => {
    // Feature: payroll-attendance-source-rules, Property 22: Recomputation stability, and the producing rule is recorded
    fc.assert(
      fc.property(fc.array(contributionArb, { minLength: 1, maxLength: 8 }), (contributions) => {
        const result = deriveCanonical(contributions);
        const anyUnusable = contributions.some(
          (c) => c.interval === null || c.interval.endMinute <= c.interval.startMinute,
        );
        if (anyUnusable) {
          expect(result.rule).toBe('max_contribution');
        } else {
          expect(result.rule).toBe('interval_union');
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('deriveCanonical — absent is never zero (criterion 18.10)', () => {
  it('an empty contribution list returns minutes: null, not 0', () => {
    const result = deriveCanonical([]);
    expect(result.minutes).toBeNull();
    expect(result.rule).toBeNull();
  });
});

describe('deriveCanonical — hand-traced example scenarios', () => {
  it('overlapping intervals from two sources count the overlap once (interval_union)', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-a', interval: { startMinute: 0, endMinute: 100 }, magnitudeMinutes: 90 },
      { diallerSourceId: 'src-b', interval: { startMinute: 50, endMinute: 150 }, magnitudeMinutes: 95 },
    ];
    // union of [0,100) and [50,150) is [0,150) = 150 minutes, not 90+95=185
    const result = deriveCanonical(contributions);
    expect(result.rule).toBe('interval_union');
    expect(result.minutes).toBe(150);
  });

  it('adjacent (touching, non-overlapping) intervals sum exactly', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-a', interval: { startMinute: 0, endMinute: 60 }, magnitudeMinutes: 60 },
      { diallerSourceId: 'src-b', interval: { startMinute: 60, endMinute: 120 }, magnitudeMinutes: 60 },
    ];
    const result = deriveCanonical(contributions);
    expect(result.rule).toBe('interval_union');
    expect(result.minutes).toBe(120);
  });

  it('a nested interval contributes nothing extra beyond the interval that contains it', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-a', interval: { startMinute: 0, endMinute: 200 }, magnitudeMinutes: 200 },
      { diallerSourceId: 'src-b', interval: { startMinute: 50, endMinute: 100 }, magnitudeMinutes: 50 },
    ];
    const result = deriveCanonical(contributions);
    expect(result.rule).toBe('interval_union');
    expect(result.minutes).toBe(200);
  });

  it('a single contribution with no usable interval (manual upload, login_minutes only) falls to max_contribution', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-manual', interval: null, magnitudeMinutes: 420 },
    ];
    const result = deriveCanonical(contributions);
    expect(result.rule).toBe('max_contribution');
    expect(result.minutes).toBe(420);
  });

  it('one interval-less contribution demotes the WHOLE employee-date to max_contribution, even with other usable intervals present', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-a', interval: { startMinute: 0, endMinute: 480 }, magnitudeMinutes: 480 },
      { diallerSourceId: 'src-manual', interval: null, magnitudeMinutes: 500 },
    ];
    const result = deriveCanonical(contributions);
    expect(result.rule).toBe('max_contribution');
    expect(result.minutes).toBe(500); // max(480, 500), NOT the 480-minute interval union
  });

  it('a zero-length interval (Logout_Time equals Login_Time) is unusable and demotes to max_contribution', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-a', interval: { startMinute: 100, endMinute: 100 }, magnitudeMinutes: 0 },
      { diallerSourceId: 'src-b', interval: { startMinute: 0, endMinute: 60 }, magnitudeMinutes: 60 },
    ];
    const result = deriveCanonical(contributions);
    expect(result.rule).toBe('max_contribution');
    expect(result.minutes).toBe(60);
  });

  it('a set of contributions summing past 1440 minutes clamps to 1440 (the impossible-day case E11 measured)', () => {
    const contributions: Contribution[] = [
      { diallerSourceId: 'src-a', interval: { startMinute: 0, endMinute: 800 }, magnitudeMinutes: 800 },
      { diallerSourceId: 'src-b', interval: { startMinute: 700, endMinute: 1600 }, magnitudeMinutes: 900 },
    ];
    const result = deriveCanonical(contributions);
    expect(result.minutes).toBeLessThanOrEqual(1440);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/canonical-productivity.property.test.ts`
Expected: FAIL — `Cannot find module '../canonical-productivity.js'`

- [ ] **Step 3: Write the implementation**

```ts
// backend/src/modules/wfm/canonical-productivity.ts
//
// Requirement 18's canonical daily productivity aggregation (requirements.md), implemented as a
// pure function with no DB access, directly property-testable (design.md component 5,
// "Canonical daily aggregation"). Consumed by Phase 3's ingestion write path — this phase does
// not wire it to any table or worker.
//
// Two rules, exactly as decision A8 settles them:
//   - PRIMARY (criterion 18.4): every contribution has a usable interval -> sweep-merge
//     overlapping intervals, sum the merged lengths. Any instant covered by two or more
//     contributions counts once. This is the only rule faithful to genuinely sequential
//     cross-dialler work.
//   - SECONDARY (criterion 18.6): if ANY contribution lacks a usable interval, the WHOLE
//     employee-date falls to the maximum single magnitude instead — not just the unusable
//     contribution's own value discarded. This is mandatory, not configurable, and it is what
//     currently governs most dialler days in production: dialer_session_log and
//     apr_manual_upload both carry only a minutes figure, no logout column at all.
//
// A contribution is "usable" only when its interval is present AND endMinute > startMinute
// (criterion 18.5) — a zero-length or malformed interval is treated exactly like a missing one,
// not silently ignored.
//
// Summing net login across concurrent sessions (what the current, broken aggregation does) is
// deliberately never expressed here — the type doesn't even have a "just add them up" code path.

export interface Contribution {
  diallerSourceId: string;
  // Minutes from 00:00 on the target calendar date. null means this contribution supplies no
  // ordered interval at all (e.g. a manual upload with only login_minutes, no logout column).
  interval: { startMinute: number; endMinute: number } | null;
  // Net_Login / login_minutes — the contribution magnitude used by the secondary rule and by
  // the no-shrinkage/no-inflation bounds, regardless of which rule ultimately governs.
  magnitudeMinutes: number;
}

export type ProducingRule = 'interval_union' | 'max_contribution';

export interface CanonicalResult {
  // null means absent for this employee-date (criterion 18.10) — never a measured zero.
  minutes: number | null;
  rule: ProducingRule | null;
  excludedCount: number;
}

function isUsable(c: Contribution): boolean {
  return c.interval !== null && c.interval.endMinute > c.interval.startMinute;
}

export function deriveCanonical(contributions: Contribution[]): CanonicalResult {
  if (contributions.length === 0) {
    return { minutes: null, rule: null, excludedCount: 0 };
  }

  const usable = contributions.filter(isUsable);
  const excludedCount = contributions.length - usable.length;

  // Secondary rule (18.6): ANY unusable contribution demotes the WHOLE employee-date.
  if (usable.length < contributions.length) {
    const maxMagnitude = Math.max(...contributions.map((c) => c.magnitudeMinutes));
    return {
      minutes: Math.min(maxMagnitude, 1440),
      rule: 'max_contribution',
      excludedCount,
    };
  }

  // Primary rule (18.4): sweep-merge overlapping intervals, sum the merged lengths.
  const sorted = [...usable].sort((a, b) => a.interval!.startMinute - b.interval!.startMinute);
  let totalMinutes = 0;
  let mergedStart = sorted[0].interval!.startMinute;
  let mergedEnd = sorted[0].interval!.endMinute;
  for (let i = 1; i < sorted.length; i++) {
    const { startMinute, endMinute } = sorted[i].interval!;
    if (startMinute <= mergedEnd) {
      mergedEnd = Math.max(mergedEnd, endMinute);
    } else {
      totalMinutes += mergedEnd - mergedStart;
      mergedStart = startMinute;
      mergedEnd = endMinute;
    }
  }
  totalMinutes += mergedEnd - mergedStart;

  return {
    minutes: Math.min(totalMinutes, 1440),
    rule: 'interval_union',
    excludedCount: 0,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/canonical-productivity.property.test.ts`
Expected: PASS, 12 tests (3 property describe blocks with 4 `it`s total + 1 absent-is-never-zero
+ 7 hand-traced examples).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/wfm/canonical-productivity.ts \
        backend/src/modules/wfm/__tests__/canonical-productivity.property.test.ts
git commit -m "feat: add deriveCanonical() — the Requirement 18 aggregation algorithm, property-tested"
```

---

### Task 4: `dialler-source-registry.service.ts` — resolve a feed identifier to an active Dialler_Source

**Files:**
- Create: `backend/src/modules/wfm/dialler-source-registry.service.ts`
- Test: `backend/src/modules/wfm/__tests__/dialler-source-registry.service.test.ts`

**Interfaces:**
- Consumes: the `db` pool from `../../db/mysql.js`.
- Produces (consumed by Phase 3's ingestion tasks):
  ```ts
  export const PRODUCTIVITY_METRICS: readonly string[]; // the 14-value controlled list, E14
  export function validateMetricAvailability(declared: string[]): { valid: boolean; invalidMetrics: string[] };
  export async function resolveActiveDiallerSource(sourceKey: string, date: string): Promise<{
    id: string; sourceKey: string; ingestionMode: 'integrated_pull' | 'manual_upload';
    metricAvailability: string[];
  } | null>;
  export async function resolveCampaignOwner(campaignCode: string): Promise<{
    diallerSourceId: string | null; isSentinel: boolean;
  } | null>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/modules/wfm/__tests__/dialler-source-registry.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeMock = vi.fn();
vi.mock('../../../db/mysql.js', () => ({
  db: { execute: (...args: unknown[]) => executeMock(...args) },
}));

import {
  PRODUCTIVITY_METRICS,
  validateMetricAvailability,
  resolveActiveDiallerSource,
  resolveCampaignOwner,
} from '../dialler-source-registry.service.js';

describe('dialler-source-registry.service', () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it('PRODUCTIVITY_METRICS holds the E14 vocabulary', () => {
    expect(PRODUCTIVITY_METRICS).toEqual([
      'calls', 'wait_time', 'talk_time', 'dispo_time', 'pause_time', 'aht',
      'login_time', 'logout_time', 'net_login', 'bio', 'lunch', 'qa', 'dismx', 'training',
    ]);
  });

  it('validateMetricAvailability accepts a subset of the controlled list', () => {
    const result = validateMetricAvailability(['calls', 'aht', 'net_login']);
    expect(result).toEqual({ valid: true, invalidMetrics: [] });
  });

  it('validateMetricAvailability rejects and names an unrecognised metric (criterion 16.3)', () => {
    const result = validateMetricAvailability(['calls', 'made_up_metric']);
    expect(result).toEqual({ valid: false, invalidMetrics: ['made_up_metric'] });
  });

  it('resolveActiveDiallerSource returns null when no active row matches the key and date window', async () => {
    executeMock.mockResolvedValueOnce([[]]);

    const result = await resolveActiveDiallerSource('dialer_1', '2026-07-15');

    expect(result).toBeNull();
  });

  it('resolveActiveDiallerSource returns the row when found, with metric_availability parsed from JSON', async () => {
    executeMock.mockResolvedValueOnce([
      [
        {
          id: 'ds-1',
          source_key: 'dialer_1',
          ingestion_mode: 'integrated_pull',
          metric_availability: JSON.stringify(['calls', 'net_login']),
        },
      ],
    ]);

    const result = await resolveActiveDiallerSource('dialer_1', '2026-07-15');

    expect(result).toEqual({
      id: 'ds-1',
      sourceKey: 'dialer_1',
      ingestionMode: 'integrated_pull',
      metricAvailability: ['calls', 'net_login'],
    });
  });

  it('resolveCampaignOwner returns null when the campaign code is unknown', async () => {
    executeMock.mockResolvedValueOnce([[]]);

    const result = await resolveCampaignOwner('UNKNOWN_CAMPAIGN');

    expect(result).toBeNull();
  });

  it('resolveCampaignOwner returns the sentinel flag and owning source for a known campaign', async () => {
    executeMock.mockResolvedValueOnce([
      [{ dialler_source_id: null, is_sentinel: 1 }],
    ]);

    const result = await resolveCampaignOwner('MANUAL_UPLOAD');

    expect(result).toEqual({ diallerSourceId: null, isSentinel: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/dialler-source-registry.service.test.ts`
Expected: FAIL — `Cannot find module '../dialler-source-registry.service.js'`

- [ ] **Step 3: Write the service**

```ts
// backend/src/modules/wfm/dialler-source-registry.service.ts
//
// Read-side of the Dialler_Source registry (requirements.md Requirement 16). The write path
// (registering, amending, deactivating a Dialler_Source — criterion 16.2, and defining a
// Column_Mapping — criteria 16.12-16.14) is a later UI/admin-screen phase; this service only
// resolves an already-registered source and validates a declared Metric_Availability list.

import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

// E14's vocabulary, the complete set of metrics any Dialler_Source may declare.
export const PRODUCTIVITY_METRICS = [
  'calls',
  'wait_time',
  'talk_time',
  'dispo_time',
  'pause_time',
  'aht',
  'login_time',
  'logout_time',
  'net_login',
  'bio',
  'lunch',
  'qa',
  'dismx',
  'training',
] as const;

export function validateMetricAvailability(
  declared: string[],
): { valid: boolean; invalidMetrics: string[] } {
  const invalidMetrics = declared.filter(
    (m) => !(PRODUCTIVITY_METRICS as readonly string[]).includes(m),
  );
  return { valid: invalidMetrics.length === 0, invalidMetrics };
}

interface DiallerSourceRow extends RowDataPacket {
  id: string;
  source_key: string;
  ingestion_mode: 'integrated_pull' | 'manual_upload';
  metric_availability: string;
}

/**
 * Resolves an active Dialler_Source by its stable key, within an effective-date window
 * (criteria 16.4, 16.5). Returns null when no active row matches — the caller (Phase 3's
 * ingestion) is responsible for rejecting the contributing row and recording why.
 */
export async function resolveActiveDiallerSource(
  sourceKey: string,
  date: string,
): Promise<{
  id: string;
  sourceKey: string;
  ingestionMode: 'integrated_pull' | 'manual_upload';
  metricAvailability: string[];
} | null> {
  const [rows] = await db.execute<DiallerSourceRow[]>(
    `SELECT id, source_key, ingestion_mode, metric_availability
       FROM dialler_source
      WHERE source_key = ?
        AND active_status = 1
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to >= ?)
      LIMIT 1`,
    [sourceKey, date, date],
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  const metricAvailability =
    typeof row.metric_availability === 'string'
      ? JSON.parse(row.metric_availability)
      : row.metric_availability;

  return {
    id: row.id,
    sourceKey: row.source_key,
    ingestionMode: row.ingestion_mode,
    metricAvailability,
  };
}

interface CampaignOwnerRow extends RowDataPacket {
  dialler_source_id: string | null;
  is_sentinel: number;
}

/**
 * Resolves a campaign_id to its owning Dialler_Source and sentinel status (criteria 16.7,
 * 16.8). Returns null when the campaign code is not registered in campaign_master at all —
 * criterion 16.5 requires the caller to reject an unresolvable contribution, not silently drop
 * it.
 */
export async function resolveCampaignOwner(
  campaignCode: string,
): Promise<{ diallerSourceId: string | null; isSentinel: boolean } | null> {
  const [rows] = await db.execute<CampaignOwnerRow[]>(
    `SELECT dialler_source_id, is_sentinel
       FROM campaign_master
      WHERE campaign_code = ?
      LIMIT 1`,
    [campaignCode],
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    diallerSourceId: row.dialler_source_id,
    isSentinel: row.is_sentinel === 1,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/dialler-source-registry.service.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/wfm/dialler-source-registry.service.ts \
        backend/src/modules/wfm/__tests__/dialler-source-registry.service.test.ts
git commit -m "feat: add dialler-source-registry.service.ts — resolveActiveDiallerSource(), resolveCampaignOwner(), Metric_Availability validation"
```

---

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

## What Phase 2 deliberately does not do

No ingestion wiring (the vicidial sync worker, WFM upload routes, `dbSyncService` do not call
`deriveCanonical()` or write `attendance_productive_day`/`attendance_productive_contribution`
yet). No midnight-apportionment implementation (criterion 18.8) — deferred to Phase 3, which
reuses the engine's existing `buildShiftWindowInfo()`/`isCrossMidnightShift()` rather than
reinventing them, and that reuse only makes sense alongside real ingestion code. No
Dialler_Source write path (registration screen is a later UI phase). No Column_Mapping parsing
(Phase 3's WFM upload pipeline).

Phase 3 (WFM manual upload pipeline: `productivity_upload_batch`, column-mapping-driven parsing,
preview, supersession, closing the unattributed `apr` write path) is next.
