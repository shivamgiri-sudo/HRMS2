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

