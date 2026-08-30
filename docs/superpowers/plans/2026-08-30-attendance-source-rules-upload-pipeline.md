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
  (three `../`) — verified correct in every DB-backed test written so far in this feature; keep
  using it.
- Live-verified facts this plan is grounded in (checked against `mas_hrms` on 2026-08-31, not
  taken from the spec alone): `apr_manual_upload` columns are exactly `id, employee_code,
  process_id, campaign_id, report_date, calls_handled, aht_seconds, login_minutes, bio_minutes,
  lunch_minutes, qa_minutes, training_minutes, uploaded_by, upload_batch_id, created_at` (15
  columns, 0 rows); `employees.employee_code` is `NOT NULL` on all rows (safe join key, no null
  guard needed on that column specifically); `wfm_header_mapping_profile.column_mappings` is a
  live `JSON` column already in production use for a different upload (roster import) — the
  pattern this phase's `dialler_source_column_mapping` (Phase 2) deliberately mirrors.
- `resolveUserBusinessScope` and `buildEmployeeScopeCondition` are real, live-imported from
  `backend/src/shared/enterpriseScope.js` (confirmed via 10 real call sites including
  `mismatch-review.routes.ts`) — Phase 4's route wiring will use these; this phase's validation
  service takes a pre-resolved scope as a parameter rather than importing them directly, so it
  stays testable without needing to mock the whole scope-resolution chain.

## Source

`requirements.md` Requirement 17 (WFM Manual Upload With Attribution) and criteria 16.12–16.14
(Column_Mapping, Phase 2); `design.md` component 4 ("WFM manual upload pipeline") and the
Column_Mapping addition in component 3.

---

## File Structure

```
backend/sql/
  1638_productivity_upload_batch.sql   # productivity_upload_batch + productivity_upload_rejection

backend/src/modules/wfm/
  productivity-upload-parser.ts            # parseUploadRow() — pure, no DB access
  productivity-upload-validation.service.ts # DB-backed: employee resolution, duplicate check

backend/src/modules/wfm/__tests__/
  productivity-upload-parser.test.ts
  productivity-upload-validation.service.test.ts
```

---

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

### Task 2: `parseUploadRow()` — column-mapping-driven row parser

**Files:**
- Create: `backend/src/modules/wfm/productivity-upload-parser.ts`
- Test: `backend/src/modules/wfm/__tests__/productivity-upload-parser.test.ts`

**Interfaces:**
- Consumes: nothing (pure function, no DB).
- Produces (consumed by Task 4's validation service and Phase 4's route):
  ```ts
  export type UploadTargetField =
    | 'employee_code' | 'report_date' | 'login_minutes'
    | 'calls_handled' | 'aht_seconds' | 'bio_minutes' | 'lunch_minutes'
    | 'qa_minutes' | 'training_minutes';
  export const MANDATORY_UPLOAD_FIELDS: readonly UploadTargetField[]; // employee_code, report_date, login_minutes
  export interface ParsedRow {
    employee_code: string; report_date: string; login_minutes: number;
    calls_handled?: number; aht_seconds?: number; bio_minutes?: number;
    lunch_minutes?: number; qa_minutes?: number; training_minutes?: number;
  }
  export interface ParseResult {
    ok: true; row: ParsedRow;
  } | {
    ok: false; reason: string;
  }
  export function checkMappingCoversMandatoryFields(
    columnMappings: Record<string, string>,
  ): { ok: true } | { ok: false; missingFields: UploadTargetField[] };
  export function parseUploadRow(
    rawRow: Record<string, string>,
    columnMappings: Record<string, string>,
  ): ParseResult;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// backend/src/modules/wfm/__tests__/productivity-upload-parser.test.ts
import { describe, it, expect } from 'vitest';
import {
  MANDATORY_UPLOAD_FIELDS,
  checkMappingCoversMandatoryFields,
  parseUploadRow,
} from '../productivity-upload-parser.js';

describe('MANDATORY_UPLOAD_FIELDS', () => {
  it('is exactly employee_code, report_date, login_minutes (criterion 17.4)', () => {
    expect(MANDATORY_UPLOAD_FIELDS).toEqual(['employee_code', 'report_date', 'login_minutes']);
  });
});

describe('checkMappingCoversMandatoryFields', () => {
  it('accepts a mapping that covers all three mandatory fields, plus optional ones', () => {
    const result = checkMappingCoversMandatoryFields({
      'Emp Code': 'employee_code',
      'Date': 'report_date',
      'Login Mins': 'login_minutes',
      'Calls': 'calls_handled',
    });
    expect(result).toEqual({ ok: true });
  });

  it('names every missing mandatory field (criterion 17.15)', () => {
    const result = checkMappingCoversMandatoryFields({
      'Emp Code': 'employee_code',
    });
    expect(result).toEqual({ ok: false, missingFields: ['report_date', 'login_minutes'] });
  });

  it('rejects an empty mapping, naming all three mandatory fields', () => {
    const result = checkMappingCoversMandatoryFields({});
    expect(result).toEqual({
      ok: false,
      missingFields: ['employee_code', 'report_date', 'login_minutes'],
    });
  });
});

describe('parseUploadRow', () => {
  const mapping = {
    'Emp Code': 'employee_code',
    'Report Date': 'report_date',
    'Login Minutes': 'login_minutes',
    'Calls Handled': 'calls_handled',
    'AHT Seconds': 'aht_seconds',
  };

  it('maps a well-formed row using the column mapping', () => {
    const result = parseUploadRow(
      {
        'Emp Code': 'MAS12345',
        'Report Date': '2026-07-15',
        'Login Minutes': '420',
        'Calls Handled': '38',
        'AHT Seconds': '245.5',
      },
      mapping,
    );
    expect(result).toEqual({
      ok: true,
      row: {
        employee_code: 'MAS12345',
        report_date: '2026-07-15',
        login_minutes: 420,
        calls_handled: 38,
        aht_seconds: 245.5,
      },
    });
  });

  it('omits an optional field entirely when its mapped source column is blank', () => {
    const result = parseUploadRow(
      {
        'Emp Code': 'MAS12345',
        'Report Date': '2026-07-15',
        'Login Minutes': '420',
        'Calls Handled': '',
        'AHT Seconds': '',
      },
      mapping,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.calls_handled).toBeUndefined();
      expect(result.row.aht_seconds).toBeUndefined();
    }
  });

  it('rejects a row missing a mandatory field value, naming which one', () => {
    const result = parseUploadRow(
      {
        'Emp Code': 'MAS12345',
        'Report Date': '',
        'Login Minutes': '420',
      },
      mapping,
    );
    expect(result).toEqual({ ok: false, reason: 'report_date is required but blank' });
  });

  it('rejects a row where a numeric field cannot be parsed as a number', () => {
    const result = parseUploadRow(
      {
        'Emp Code': 'MAS12345',
        'Report Date': '2026-07-15',
        'Login Minutes': 'not-a-number',
      },
      mapping,
    );
    expect(result).toEqual({ ok: false, reason: 'login_minutes is not a valid number: "not-a-number"' });
  });

  it('rejects a negative login_minutes value', () => {
    const result = parseUploadRow(
      {
        'Emp Code': 'MAS12345',
        'Report Date': '2026-07-15',
        'Login Minutes': '-10',
      },
      mapping,
    );
    expect(result).toEqual({ ok: false, reason: 'login_minutes must not be negative: -10' });
  });

  it('ignores a raw column with no mapping entry', () => {
    const result = parseUploadRow(
      {
        'Emp Code': 'MAS12345',
        'Report Date': '2026-07-15',
        'Login Minutes': '420',
        'Some Unmapped Column': 'whatever',
      },
      mapping,
    );
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/productivity-upload-parser.test.ts`
Expected: FAIL — `Cannot find module '../productivity-upload-parser.js'`

- [ ] **Step 3: Write the implementation**

```ts
// backend/src/modules/wfm/productivity-upload-parser.ts
//
// Column-mapping-driven parser for a WFM manual productivity upload row (requirements.md
// Requirement 17, criteria 17.4, 17.14, 17.15; the Column_Mapping mechanism itself is Phase 2's
// criteria 16.12-16.14). Pure function, no DB access -- the mapping is passed in already
// resolved (Phase 4's route loads it from `dialler_source_column_mapping` via Phase 2's
// registry), and this function only applies it to one raw row at a time.
//
// The live `apr_manual_upload` table (verified 2026-08-31: 15 columns, 0 rows) is the write
// target this parser's output feeds -- its column set is exactly the optional-field list below.

export type UploadTargetField =
  | 'employee_code'
  | 'report_date'
  | 'login_minutes'
  | 'calls_handled'
  | 'aht_seconds'
  | 'bio_minutes'
  | 'lunch_minutes'
  | 'qa_minutes'
  | 'training_minutes';

// criterion 17.4: "an accepted row to supply, at minimum, an employee code, a report date and
// login minutes" -- everything else apr_manual_upload can hold is optional.
export const MANDATORY_UPLOAD_FIELDS: readonly UploadTargetField[] = [
  'employee_code',
  'report_date',
  'login_minutes',
];

const NUMERIC_FIELDS: readonly UploadTargetField[] = [
  'login_minutes',
  'calls_handled',
  'aht_seconds',
  'bio_minutes',
  'lunch_minutes',
  'qa_minutes',
  'training_minutes',
];

export interface ParsedRow {
  employee_code: string;
  report_date: string;
  login_minutes: number;
  calls_handled?: number;
  aht_seconds?: number;
  bio_minutes?: number;
  lunch_minutes?: number;
  qa_minutes?: number;
  training_minutes?: number;
}

export type ParseResult = { ok: true; row: ParsedRow } | { ok: false; reason: string };

/**
 * Checks a Dialler_Source's declared Column_Mapping covers every mandatory Upload field
 * (criterion 17.15) before any row is parsed against it. Names every field missing, not just
 * the first.
 */
export function checkMappingCoversMandatoryFields(
  columnMappings: Record<string, string>,
): { ok: true } | { ok: false; missingFields: UploadTargetField[] } {
  const mappedTargets = new Set(Object.values(columnMappings));
  const missingFields = MANDATORY_UPLOAD_FIELDS.filter((f) => !mappedTargets.has(f));
  return missingFields.length === 0 ? { ok: true } : { ok: false, missingFields };
}

/**
 * Applies a Column_Mapping to one raw row (a header->value object, as a CSV parser would
 * produce) and returns a normalized ParsedRow, or a rejection reason naming the offending field.
 */
export function parseUploadRow(
  rawRow: Record<string, string>,
  columnMappings: Record<string, string>,
): ParseResult {
  const values: Partial<Record<UploadTargetField, string>> = {};
  for (const [sourceHeader, targetField] of Object.entries(columnMappings)) {
    const raw = rawRow[sourceHeader];
    if (raw !== undefined && raw !== '') {
      values[targetField as UploadTargetField] = raw;
    }
  }

  for (const field of MANDATORY_UPLOAD_FIELDS) {
    if (values[field] === undefined) {
      return { ok: false, reason: `${field} is required but blank` };
    }
  }

  const parsedNumbers: Partial<Record<UploadTargetField, number>> = {};
  for (const field of NUMERIC_FIELDS) {
    const raw = values[field];
    if (raw === undefined) continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return { ok: false, reason: `${field} is not a valid number: "${raw}"` };
    }
    if (n < 0) {
      return { ok: false, reason: `${field} must not be negative: ${n}` };
    }
    parsedNumbers[field] = n;
  }

  const row: ParsedRow = {
    employee_code: values.employee_code!,
    report_date: values.report_date!,
    login_minutes: parsedNumbers.login_minutes!,
  };
  if (parsedNumbers.calls_handled !== undefined) row.calls_handled = parsedNumbers.calls_handled;
  if (parsedNumbers.aht_seconds !== undefined) row.aht_seconds = parsedNumbers.aht_seconds;
  if (parsedNumbers.bio_minutes !== undefined) row.bio_minutes = parsedNumbers.bio_minutes;
  if (parsedNumbers.lunch_minutes !== undefined) row.lunch_minutes = parsedNumbers.lunch_minutes;
  if (parsedNumbers.qa_minutes !== undefined) row.qa_minutes = parsedNumbers.qa_minutes;
  if (parsedNumbers.training_minutes !== undefined) row.training_minutes = parsedNumbers.training_minutes;

  return { ok: true, row };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/productivity-upload-parser.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/wfm/productivity-upload-parser.ts \
        backend/src/modules/wfm/__tests__/productivity-upload-parser.test.ts
git commit -m "feat: add parseUploadRow() — column-mapping-driven WFM upload row parser (Requirement 17)"
```

---

### Task 3: `productivity-upload-validation.service.ts` — employee resolution and duplicate detection

**Files:**
- Create: `backend/src/modules/wfm/productivity-upload-validation.service.ts`
- Test: `backend/src/modules/wfm/__tests__/productivity-upload-validation.service.test.ts`

**Interfaces:**
- Consumes: the `db` pool from `../../db/mysql.js`.
- Produces (consumed by Phase 4's route):
  ```ts
  export async function resolveEmployeeIdByCode(employeeCode: string): Promise<string | null>;
  export async function isDuplicateContribution(
    diallerSourceId: string, employeeId: string, reportDate: string,
  ): Promise<{ isDuplicate: boolean; priorBatchId: string | null }>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/modules/wfm/__tests__/productivity-upload-validation.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeMock = vi.fn();
vi.mock('../../../db/mysql.js', () => ({
  db: { execute: (...args: unknown[]) => executeMock(...args) },
}));

import {
  resolveEmployeeIdByCode,
  isDuplicateContribution,
} from '../productivity-upload-validation.service.js';

describe('productivity-upload-validation.service', () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it('resolveEmployeeIdByCode returns null when the code resolves to no employee (criterion 17.5; 56 of 727 apr.UserID values do today)', async () => {
    executeMock.mockResolvedValueOnce([[]]);

    const result = await resolveEmployeeIdByCode('NO-SUCH-CODE');

    expect(result).toBeNull();
  });

  it('resolveEmployeeIdByCode returns the employee id when the code resolves', async () => {
    executeMock.mockResolvedValueOnce([[{ id: 'emp-1' }]]);

    const result = await resolveEmployeeIdByCode('MAS12345');

    expect(result).toBe('emp-1');
  });

  it('isDuplicateContribution returns false when no accepted, non-superseded row exists for this (source, employee, date)', async () => {
    executeMock.mockResolvedValueOnce([[]]);

    const result = await isDuplicateContribution('ds-1', 'emp-1', '2026-07-15');

    expect(result).toEqual({ isDuplicate: false, priorBatchId: null });
  });

  it('isDuplicateContribution returns true and names the prior batch when one exists (criterion 17.6)', async () => {
    executeMock.mockResolvedValueOnce([[{ upload_batch_id: 'batch-prior' }]]);

    const result = await isDuplicateContribution('ds-1', 'emp-1', '2026-07-15');

    expect(result).toEqual({ isDuplicate: true, priorBatchId: 'batch-prior' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/productivity-upload-validation.service.test.ts`
Expected: FAIL — `Cannot find module '../productivity-upload-validation.service.js'`

- [ ] **Step 3: Write the service**

```ts
// backend/src/modules/wfm/productivity-upload-validation.service.ts
//
// DB-backed validation helpers for the WFM manual upload pipeline (requirements.md
// Requirement 17). Employee-code resolution (criterion 17.5) and duplicate-submission detection
// (criterion 17.6) -- the two checks that need a database round trip; parseUploadRow() (Task 2)
// and the branch-scope check (Phase 4, via the already-live resolveUserBusinessScope) are the
// other two steps in the validation order design.md specifies.

import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

interface EmployeeIdRow extends RowDataPacket {
  id: string;
}

/**
 * Resolves an employee code to an employee id. Returns null when the code resolves to no
 * employee (criterion 17.5) -- 56 of 727 distinct apr.UserID values do today; the caller is
 * responsible for rejecting the row and naming the unresolved code, not this function.
 */
export async function resolveEmployeeIdByCode(employeeCode: string): Promise<string | null> {
  const [rows] = await db.execute<EmployeeIdRow[]>(
    `SELECT id FROM employees WHERE employee_code = ? LIMIT 1`,
    [employeeCode],
  );
  return rows.length > 0 ? rows[0].id : null;
}

interface DuplicateRow extends RowDataPacket {
  upload_batch_id: string;
}

/**
 * Checks whether an accepted, non-superseded row already exists for this
 * (Dialler_Source, employee, date) combination (criterion 17.6). Names the prior batch so the
 * caller can report it, rather than just returning a boolean.
 */
export async function isDuplicateContribution(
  diallerSourceId: string,
  employeeId: string,
  reportDate: string,
): Promise<{ isDuplicate: boolean; priorBatchId: string | null }> {
  const [rows] = await db.execute<DuplicateRow[]>(
    `SELECT apc.upload_batch_id
       FROM attendance_productive_contribution apc
      WHERE apc.dialler_source_id = ?
        AND apc.employee_id = ?
        AND apc.work_date = ?
        AND apc.superseded_at IS NULL
        AND apc.upload_batch_id IS NOT NULL
      LIMIT 1`,
    [diallerSourceId, employeeId, reportDate],
  );

  return rows.length > 0
    ? { isDuplicate: true, priorBatchId: rows[0].upload_batch_id }
    : { isDuplicate: false, priorBatchId: null };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/productivity-upload-validation.service.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/wfm/productivity-upload-validation.service.ts \
        backend/src/modules/wfm/__tests__/productivity-upload-validation.service.test.ts
git commit -m "feat: add productivity-upload-validation.service.ts — resolveEmployeeIdByCode(), isDuplicateContribution()"
```

---

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

## What Phase 3 deliberately does not do

No Express route, no multer wiring, no file upload handling, no preview endpoint. No branch-scope
enforcement (that's `resolveUserBusinessScope`, called by the route in Phase 4). No supersession
logic (marking a prior batch's rows `superseded_at`) — that's a write operation belonging to the
route that accepts a re-upload. No `apr` trigger closing the unattributed write path (criterion
17.10) — that touches a live, 46,163-row production table and deserves its own phase with its own
review, not bundled into schema-and-pure-function work.

Phase 4 (WFM upload route + apr trigger + engine integration into `processEmployee()`) is next —
the first phase that starts touching live request handling and the existing engine, and should be
scoped and reviewed accordingly.
