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

