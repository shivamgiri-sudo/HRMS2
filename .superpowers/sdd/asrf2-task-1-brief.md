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

