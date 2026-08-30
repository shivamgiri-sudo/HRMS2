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

