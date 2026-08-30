# Attendance Source Rules — WFM Upload Route (Phase 4 of 11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live, working WFM manual-upload endpoint: preview a file, then commit it, writing
attributed rows to `apr_manual_upload` (a real table, 0 rows today — genuinely dead code path)
and a full `productivity_upload_batch` audit trail. This is the first phase in this feature that
adds a live Express route — everything before this was schema and pure functions with zero
request-handling surface.

**Deliberately NOT in this phase, even though it is closely related:**
- **No change to `attendance-apr-bulk.routes.ts`**, the existing, live, actively-used manual
  upload route (documented production incident history — see its own header comments). That
  route's Phase-3 evidence-write into `apr` with the `MANUAL_UPLOAD` sentinel is exactly the
  defect this feature exists to close (criterion 17.10), but rewiring a live route with real
  production traffic is its own phase with its own review, not bundled here.
- **No `apr` trigger** rejecting unattributed manual writes (criterion 17.10) — for the same
  reason: it would need to ship in lockstep with the `attendance-apr-bulk.routes.ts` change above,
  or it breaks that route outright.
- **No nav entry / page visible to real users yet** — the page code and grants are registered
  (criterion 14.7's "five things must agree" convention), but nothing links to it from
  `navConfig.tsx`. The endpoint exists and is reachable by URL/API call by a correctly-permissioned
  user, and is exercised entirely by this plan's own tests — it is not yet part of anyone's
  workflow.

**Architecture:** Two new DB-backed services (`productivity-upload-preview.service.ts`,
`productivity-upload-commit.service.ts`) built on Phase 3's pure parser and validation helpers,
and one new Express route (`productivity-upload.routes.ts`, multer + two endpoints) wired into
`app.ts`. Follows the proven pattern in the codebase's own `attendance-apr-bulk.routes.ts`:
memory-storage multer with a CSV-only file filter, an explicit rejection handler that keeps a
multer error out of the global handler's masking branch, and chunked multi-row inserts.

## A gap found and resolved before writing this plan

`apr_manual_upload.campaign_id VARCHAR(100) NOT NULL` (verified live) has no source anywhere in
Requirement 17 — the upload flow supplies a Dialler_Source, branch, process and date range at
the batch level, and employee code / report date / login minutes at the row level, but never a
campaign. **Resolved with the user:** every `manual_upload` Dialler_Source gets exactly one
auto-created default campaign (`campaign_code = 'DEFAULT_' + diallerSourceId`, idempotent,
race-safe via `INSERT ... ON DUPLICATE KEY UPDATE` + re-select) the first time anything is
committed through it. This replaces the old system-wide `MANUAL_UPLOAD` sentinel with one
sentinel per registered source instead of one for the whole company — a direct improvement on
the defect this feature exists to fix (today's 3,810 rows share a single undifferentiated
sentinel).

## Global Constraints

- No SQL runs against production without the owner's explicit approval — the one migration here
  (page/role grants) is written and registered but **not executed**.
- Every migration file is registered in `MIGRATION_MANIFEST` — **grep fresh for the true last
  entry**; three prior phases each hit a case where the assumed anchor didn't exist or had moved.
- **This phase writes real rows to a real, currently-empty production table
  (`apr_manual_upload`) and creates real rows in `campaign_master` (default campaigns).** These
  are genuine, if small, live writes the moment this ships and is exercised — unlike every prior
  phase, this is not purely additive-and-inert. Every write path must be idempotent
  (`ON DUPLICATE KEY UPDATE` / natural unique-key collision) so a retried request never
  double-writes.
- Follow `attendance-apr-bulk.routes.ts`'s proven conventions exactly: `multer.memoryStorage()`,
  a CSV-only `fileFilter`, the explicit multer-rejection handler with a real `statusCode` (a
  statusless throw is masked by the global error handler as "quote reference &lt;hex&gt;"),
  `INSERT_CHUNK_SIZE = 300` chunked multi-row statements with catch-per-chunk.
- Page/route/grant wiring must follow the five-things-must-agree convention
  (`backend/sql/1129_cost_centre_page_access.sql`'s header comment): `<Route>` + `<Gate
  pageCode>`, a `page_catalog` row whose `page_path` matches exactly, `role_page_access` grants,
  a `navConfig.tsx` entry (explicitly deferred this phase — see above), and a
  `PAGE_CODE_BY_ROUTE` entry. This phase covers the backend three of five; the frontend two are
  out of scope (no UI page exists yet to route to).
- `resolveUserBusinessScope(user): Promise<UserBusinessScope>` and its `assignments:
  BusinessScopeAssignment[]` are live-imported from `backend/src/shared/enterpriseScope.js`
  (verified: `UserBusinessScope` carries `isSuperAdmin`, `isAdmin`, `isHr`, `isPayroll`,
  `isFinance`, `assignments[]`; each assignment carries `branchId: string | null` — `null` means
  that assignment is org-wide for that role).
- `AuthenticatedRequest.authUser` (from `backend/src/middleware/authMiddleware.ts`) carries
  `{ id: string; email?: string; role?: string; roles?: string[] }`.
- vitest config: `fileParallelism: false`, `testTimeout: 30_000`. `vi.mock` inside a
  `modules/wfm/__tests__/` file needs `'../../../db/mysql.js'` (three `../`).

## Source

`requirements.md` Requirement 17 (criteria 17.1, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 17.11,
17.12, 17.13, 17.14, 17.15) and Requirement 14 (criteria 14.7, 14.8 — access control); `design.md`
component 4.

---

## File Structure

```
backend/sql/
  1639_wfm_productivity_upload_page_access.sql   # page_catalog + role_page_access for WFM_PRODUCTIVITY_UPLOAD

backend/src/modules/wfm/
  productivity-upload-preview.service.ts   # buildUploadPreview() — orchestrates Phase 3's parser + validation
  productivity-upload-commit.service.ts    # resolveOrCreateDefaultCampaign() + commitUploadBatch()
  productivity-upload.routes.ts            # Express: POST /preview, POST /commit

backend/src/modules/wfm/__tests__/
  productivity-upload-preview.service.test.ts
  productivity-upload-commit.service.test.ts
  productivity-upload.routes.test.ts

backend/src/app.ts   # + import and app.use() for the new router (modified)
```

---

### Task 1: Migration 1639 — `WFM_PRODUCTIVITY_UPLOAD` page access

**Files:**
- Create: `backend/sql/1639_wfm_productivity_upload_page_access.sql`
- Test: `backend/src/db/__tests__/wfm-productivity-upload-page-access-migration.contract.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- 1639 — page_catalog + role_page_access for WFM_PRODUCTIVITY_UPLOAD (requirements.md
-- criterion 14.7: the Upload_Batch submission screen is one of the six page codes this feature
-- requires as a separately grantable permission; criterion 14.8 restricts submitting an
-- Upload_Batch to the WFM_Uploader grant).
--
-- NOT YET EXECUTED. Purely additive: one page_catalog row, a set of role_page_access grants.
-- Needs owner approval before it runs (CLAUDE.md).
--
-- Per the five-things-must-agree convention (backend/sql/1129_cost_centre_page_access.sql):
-- this migration is the page_catalog + role_page_access half. The route + Gate pageCode and the
-- PAGE_CODE_BY_ROUTE entry land in Task 4 of this plan. The navConfig.tsx entry is deliberately
-- NOT added this phase (see design.md, roadmap for this plan) — no UI page exists yet to route
-- to, so a nav entry today would link to a 404.
--
-- Grants mirror the existing attendance-apr-bulk.routes.ts's requireRole list
-- (wfm, hr, payroll_head, super_admin, admin) plus branch_head, since criterion 17's
-- WFM_Uploader is explicitly a branch-scoped role and branch_head is this codebase's existing
-- branch-scoped operational role.
--
-- ROLLBACK
--   UPDATE role_page_access SET active_status = 0 WHERE page_code = 'WFM_PRODUCTIVITY_UPLOAD';
--   UPDATE page_catalog     SET active_status = 0 WHERE page_code = 'WFM_PRODUCTIVITY_UPLOAD';

INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES (
  'WFM_PRODUCTIVITY_UPLOAD',
  'WFM Productivity Upload',
  '/wfm/productivity-upload',
  'WFM',
  'Branch WFM manual dialler productivity report upload (requirements.md Requirement 17)',
  1
)
ON DUPLICATE KEY UPDATE
  page_name     = VALUES(page_name),
  page_path     = VALUES(page_path),
  module        = VALUES(module),
  description   = VALUES(description),
  active_status = VALUES(active_status);

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
SELECT UUID(), r.role_key, 'WFM_PRODUCTIVITY_UPLOAD', 1, 1, 0, 0, 0, 1, NOW()
  FROM (
    SELECT 'wfm'          AS role_key UNION ALL
    SELECT 'branch_head'              UNION ALL
    SELECT 'hr'                       UNION ALL
    SELECT 'payroll_head'             UNION ALL
    SELECT 'admin'                    UNION ALL
    SELECT 'super_admin'
  ) r
 WHERE NOT EXISTS (
   SELECT 1 FROM role_page_access existing
    WHERE existing.role_key  = r.role_key
      AND existing.page_code = 'WFM_PRODUCTIVITY_UPLOAD'
 );

UPDATE role_page_access
   SET can_view = 1, can_create = 1, active_status = 1
 WHERE page_code = 'WFM_PRODUCTIVITY_UPLOAD'
   AND role_key IN ('wfm','branch_head','hr','payroll_head','admin','super_admin');

SELECT '1639 applied: WFM_PRODUCTIVITY_UPLOAD page catalog + role_page_access' AS migration_status;
```

- [ ] **Step 2: Write the contract test**

```ts
// backend/src/db/__tests__/wfm-productivity-upload-page-access-migration.contract.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SQL_DIR = join(__dirname, '../../../sql');

function readMigration(file: string): string {
  return readFileSync(join(SQL_DIR, file), 'utf-8');
}

describe('WFM_PRODUCTIVITY_UPLOAD page access migration (1639)', () => {
  it('registers the page_catalog row with the correct path', () => {
    const sql = readMigration('1639_wfm_productivity_upload_page_access.sql');
    expect(sql).toContain("'WFM_PRODUCTIVITY_UPLOAD',");
    expect(sql).toContain("'/wfm/productivity-upload',");
  });

  it('grants all six roles view + create access', () => {
    const sql = readMigration('1639_wfm_productivity_upload_page_access.sql');
    for (const role of ['wfm', 'branch_head', 'hr', 'payroll_head', 'admin', 'super_admin']) {
      expect(sql).toContain(`SELECT '${role}'`);
    }
    expect(sql).toContain("SET can_view = 1, can_create = 1, active_status = 1");
  });

  it('is idempotent (ON DUPLICATE KEY UPDATE on page_catalog, NOT EXISTS guard on role_page_access)', () => {
    const sql = readMigration('1639_wfm_productivity_upload_page_access.sql');
    expect(sql).toContain('ON DUPLICATE KEY UPDATE');
    expect(sql).toContain('WHERE NOT EXISTS');
  });
});
```

- [ ] **Step 3: Run the test**

Run: `cd backend && npx vitest run src/db/__tests__/wfm-productivity-upload-page-access-migration.contract.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 4: Commit**

```bash
git add backend/sql/1639_wfm_productivity_upload_page_access.sql \
        backend/src/db/__tests__/wfm-productivity-upload-page-access-migration.contract.test.ts
git commit -m "feat: add WFM_PRODUCTIVITY_UPLOAD page_catalog + role_page_access (Requirement 14.7/14.8, unexecuted)"
```

---

### Task 2: `productivity-upload-preview.service.ts` — `buildUploadPreview()`

**Files:**
- Create: `backend/src/modules/wfm/productivity-upload-preview.service.ts`
- Test: `backend/src/modules/wfm/__tests__/productivity-upload-preview.service.test.ts`

**Interfaces:**
- Consumes: `parseUploadRow`, `checkMappingCoversMandatoryFields` from
  `./productivity-upload-parser.js` (Phase 3 Task 2); `resolveEmployeeIdByCode`,
  `isDuplicateContribution` from `./productivity-upload-validation.service.js` (Phase 3 Task 3).
- Produces (consumed by Task 4's route):
  ```ts
  export interface PreviewAcceptedRow {
    rowNumber: number; employeeId: string; employeeCode: string; reportDate: string;
    loginMinutes: number; callsHandled?: number; ahtSeconds?: number; bioMinutes?: number;
    lunchMinutes?: number; qaMinutes?: number; trainingMinutes?: number;
  }
  export interface PreviewRejectedRow { rowNumber: number; employeeCode: string; reason: string; }
  export interface UploadPreviewResult {
    accepted: PreviewAcceptedRow[]; rejected: PreviewRejectedRow[];
    mappingError?: { missingFields: string[] };
  }
  export async function buildUploadPreview(
    rawRows: Array<{ rowNumber: number; data: Record<string, string> }>,
    columnMappings: Record<string, string>,
    diallerSourceId: string,
  ): Promise<UploadPreviewResult>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/modules/wfm/__tests__/productivity-upload-preview.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveEmployeeIdByCodeMock = vi.fn();
const isDuplicateContributionMock = vi.fn();
vi.mock('../productivity-upload-validation.service.js', () => ({
  resolveEmployeeIdByCode: (...args: unknown[]) => resolveEmployeeIdByCodeMock(...args),
  isDuplicateContribution: (...args: unknown[]) => isDuplicateContributionMock(...args),
}));

import { buildUploadPreview } from '../productivity-upload-preview.service.js';

const mapping = {
  'Emp Code': 'employee_code',
  'Report Date': 'report_date',
  'Login Minutes': 'login_minutes',
};

describe('buildUploadPreview', () => {
  beforeEach(() => {
    resolveEmployeeIdByCodeMock.mockReset();
    isDuplicateContributionMock.mockReset();
  });

  it('returns a mappingError and processes no rows when the mapping is missing a mandatory field', async () => {
    const result = await buildUploadPreview(
      [{ rowNumber: 2, data: { 'Emp Code': 'MAS1', 'Login Minutes': '420' } }],
      { 'Emp Code': 'employee_code', 'Login Minutes': 'login_minutes' },
      'ds-1',
    );
    expect(result.mappingError).toEqual({ missingFields: ['report_date'] });
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(resolveEmployeeIdByCodeMock).not.toHaveBeenCalled();
  });

  it('rejects a row that fails parsing, naming the parse reason, without a DB call', async () => {
    const result = await buildUploadPreview(
      [{ rowNumber: 2, data: { 'Emp Code': 'MAS1', 'Report Date': '2026-07-15', 'Login Minutes': 'bad' } }],
      mapping,
      'ds-1',
    );
    expect(result.rejected).toEqual([
      { rowNumber: 2, employeeCode: 'MAS1', reason: 'login_minutes is not a valid number: "bad"' },
    ]);
    expect(resolveEmployeeIdByCodeMock).not.toHaveBeenCalled();
  });

  it('rejects a row whose employee code does not resolve (criterion 17.5)', async () => {
    resolveEmployeeIdByCodeMock.mockResolvedValueOnce(null);

    const result = await buildUploadPreview(
      [{ rowNumber: 2, data: { 'Emp Code': 'NO-SUCH', 'Report Date': '2026-07-15', 'Login Minutes': '420' } }],
      mapping,
      'ds-1',
    );
    expect(result.rejected).toEqual([
      { rowNumber: 2, employeeCode: 'NO-SUCH', reason: 'employee code NO-SUCH does not resolve to any employee' },
    ]);
    expect(isDuplicateContributionMock).not.toHaveBeenCalled();
  });

  it('rejects a duplicate submission, naming the prior batch (criterion 17.6)', async () => {
    resolveEmployeeIdByCodeMock.mockResolvedValueOnce('emp-1');
    isDuplicateContributionMock.mockResolvedValueOnce({ isDuplicate: true, priorBatchId: 'batch-prior' });

    const result = await buildUploadPreview(
      [{ rowNumber: 2, data: { 'Emp Code': 'MAS1', 'Report Date': '2026-07-15', 'Login Minutes': '420' } }],
      mapping,
      'ds-1',
    );
    expect(result.rejected).toEqual([
      { rowNumber: 2, employeeCode: 'MAS1', reason: 'duplicate submission: already accepted in batch batch-prior' },
    ]);
  });

  it('accepts a well-formed, resolvable, non-duplicate row', async () => {
    resolveEmployeeIdByCodeMock.mockResolvedValueOnce('emp-1');
    isDuplicateContributionMock.mockResolvedValueOnce({ isDuplicate: false, priorBatchId: null });

    const result = await buildUploadPreview(
      [{ rowNumber: 2, data: { 'Emp Code': 'MAS1', 'Report Date': '2026-07-15', 'Login Minutes': '420' } }],
      mapping,
      'ds-1',
    );
    expect(result.accepted).toEqual([
      { rowNumber: 2, employeeId: 'emp-1', employeeCode: 'MAS1', reportDate: '2026-07-15', loginMinutes: 420 },
    ]);
    expect(result.rejected).toEqual([]);
    expect(isDuplicateContributionMock).toHaveBeenCalledWith('ds-1', 'emp-1', '2026-07-15');
  });

  it('processes independent rows independently — one bad row does not stop the rest', async () => {
    resolveEmployeeIdByCodeMock.mockResolvedValueOnce('emp-2');
    isDuplicateContributionMock.mockResolvedValueOnce({ isDuplicate: false, priorBatchId: null });

    const result = await buildUploadPreview(
      [
        { rowNumber: 2, data: { 'Emp Code': '', 'Report Date': '2026-07-15', 'Login Minutes': '420' } },
        { rowNumber: 3, data: { 'Emp Code': 'MAS2', 'Report Date': '2026-07-15', 'Login Minutes': '300' } },
      ],
      mapping,
      'ds-1',
    );
    expect(result.rejected).toHaveLength(1);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].employeeCode).toBe('MAS2');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/productivity-upload-preview.service.test.ts`
Expected: FAIL — `Cannot find module '../productivity-upload-preview.service.js'`

- [ ] **Step 3: Write the implementation**

```ts
// backend/src/modules/wfm/productivity-upload-preview.service.ts
//
// Orchestrates Phase 3's pure parser and DB-backed validation helpers into one per-file preview
// pass (requirements.md Requirement 17, design.md's "Validation order": mapping check -> parse
// -> employee resolution -> duplicate check). No writes — this is the dry-run half of criterion
// 17.14's preview-then-commit flow; Task 3's commitUploadBatch() is the write half.

import {
  checkMappingCoversMandatoryFields,
  parseUploadRow,
} from './productivity-upload-parser.js';
import {
  resolveEmployeeIdByCode,
  isDuplicateContribution,
} from './productivity-upload-validation.service.js';

export interface PreviewAcceptedRow {
  rowNumber: number;
  employeeId: string;
  employeeCode: string;
  reportDate: string;
  loginMinutes: number;
  callsHandled?: number;
  ahtSeconds?: number;
  bioMinutes?: number;
  lunchMinutes?: number;
  qaMinutes?: number;
  trainingMinutes?: number;
}

export interface PreviewRejectedRow {
  rowNumber: number;
  employeeCode: string;
  reason: string;
}

export interface UploadPreviewResult {
  accepted: PreviewAcceptedRow[];
  rejected: PreviewRejectedRow[];
  mappingError?: { missingFields: string[] };
}

export async function buildUploadPreview(
  rawRows: Array<{ rowNumber: number; data: Record<string, string> }>,
  columnMappings: Record<string, string>,
  diallerSourceId: string,
): Promise<UploadPreviewResult> {
  const mappingCheck = checkMappingCoversMandatoryFields(columnMappings);
  if (!mappingCheck.ok) {
    return { accepted: [], rejected: [], mappingError: { missingFields: mappingCheck.missingFields } };
  }

  const accepted: PreviewAcceptedRow[] = [];
  const rejected: PreviewRejectedRow[] = [];

  for (const { rowNumber, data } of rawRows) {
    const parsed = parseUploadRow(data, columnMappings);
    if (!parsed.ok) {
      // employee_code may itself be the field that failed to parse (blank/whitespace) — best
      // effort to still name it in the rejection for the uploader's benefit, empty if unknown.
      const employeeCode = data[Object.keys(columnMappings).find(
        (h) => columnMappings[h] === 'employee_code',
      ) ?? ''] ?? '';
      rejected.push({ rowNumber, employeeCode, reason: parsed.reason });
      continue;
    }

    const employeeId = await resolveEmployeeIdByCode(parsed.row.employee_code);
    if (employeeId === null) {
      rejected.push({
        rowNumber,
        employeeCode: parsed.row.employee_code,
        reason: `employee code ${parsed.row.employee_code} does not resolve to any employee`,
      });
      continue;
    }

    const duplicate = await isDuplicateContribution(diallerSourceId, employeeId, parsed.row.report_date);
    if (duplicate.isDuplicate) {
      rejected.push({
        rowNumber,
        employeeCode: parsed.row.employee_code,
        reason: `duplicate submission: already accepted in batch ${duplicate.priorBatchId}`,
      });
      continue;
    }

    accepted.push({
      rowNumber,
      employeeId,
      employeeCode: parsed.row.employee_code,
      reportDate: parsed.row.report_date,
      loginMinutes: parsed.row.login_minutes,
      callsHandled: parsed.row.calls_handled,
      ahtSeconds: parsed.row.aht_seconds,
      bioMinutes: parsed.row.bio_minutes,
      lunchMinutes: parsed.row.lunch_minutes,
      qaMinutes: parsed.row.qa_minutes,
      trainingMinutes: parsed.row.training_minutes,
    });
  }

  return { accepted, rejected };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/productivity-upload-preview.service.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/wfm/productivity-upload-preview.service.ts \
        backend/src/modules/wfm/__tests__/productivity-upload-preview.service.test.ts
git commit -m "feat: add buildUploadPreview() — orchestrates Phase 3's parser + validation into one dry-run pass"
```

---

### Task 3: `productivity-upload-commit.service.ts` — default-campaign resolution and the write path

**Files:**
- Create: `backend/src/modules/wfm/productivity-upload-commit.service.ts`
- Test: `backend/src/modules/wfm/__tests__/productivity-upload-commit.service.test.ts`

**Interfaces:**
- Consumes: `db` from `../../db/mysql.js`; `PreviewAcceptedRow`, `PreviewRejectedRow` from
  `./productivity-upload-preview.service.js` (Task 2).
- Produces (consumed by Task 4's route):
  ```ts
  export async function resolveOrCreateDefaultCampaign(
    diallerSourceId: string,
  ): Promise<{ campaignId: string; campaignCode: string }>;
  export interface CommitBatchParams {
    diallerSourceId: string; branchId: string; processId: string;
    dateFrom: string; dateTo: string; fileName: string; contentDigest: string;
    uploadedBy: string; mappingVersionUsed: number; supersedesBatchId?: string;
    acceptedRows: PreviewAcceptedRow[]; rejectedRows: PreviewRejectedRow[];
  }
  export interface CommitBatchResult {
    batchId: string; batchReference: string; acceptedCount: number; rejectedCount: number;
  }
  export async function commitUploadBatch(params: CommitBatchParams): Promise<CommitBatchResult>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/modules/wfm/__tests__/productivity-upload-commit.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeMock = vi.fn();
vi.mock('../../../db/mysql.js', () => ({
  db: { execute: (...args: unknown[]) => executeMock(...args) },
}));

import {
  resolveOrCreateDefaultCampaign,
  commitUploadBatch,
} from '../productivity-upload-commit.service.js';

describe('resolveOrCreateDefaultCampaign', () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it('returns the existing default campaign when one already exists', async () => {
    executeMock.mockResolvedValueOnce([[{ id: 'camp-1', campaign_code: 'DEFAULT_ds-1' }]]);

    const result = await resolveOrCreateDefaultCampaign('ds-1');

    expect(result).toEqual({ campaignId: 'camp-1', campaignCode: 'DEFAULT_ds-1' });
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('creates the default campaign when none exists yet, then re-selects it', async () => {
    executeMock
      .mockResolvedValueOnce([[]]) // no existing default campaign
      .mockResolvedValueOnce([[{ display_name: 'ViciDial Instance 1' }]]) // dialler_source lookup
      .mockResolvedValueOnce([{}]) // the INSERT
      .mockResolvedValueOnce([[{ id: 'camp-new', campaign_code: 'DEFAULT_ds-1' }]]); // re-select

    const result = await resolveOrCreateDefaultCampaign('ds-1');

    expect(result).toEqual({ campaignId: 'camp-new', campaignCode: 'DEFAULT_ds-1' });
    expect(executeMock).toHaveBeenCalledTimes(4);
  });
});

describe('commitUploadBatch', () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it('writes the batch, the accepted rows, and the rejection rows, and returns the summary', async () => {
    executeMock
      .mockResolvedValueOnce([[{ id: 'camp-1', campaign_code: 'DEFAULT_ds-1' }]]) // resolveOrCreateDefaultCampaign
      .mockResolvedValueOnce([{}]) // INSERT productivity_upload_batch
      .mockResolvedValueOnce([{}]) // INSERT apr_manual_upload (accepted rows chunk)
      .mockResolvedValueOnce([{}]); // INSERT productivity_upload_rejection (rejected rows chunk)

    const result = await commitUploadBatch({
      diallerSourceId: 'ds-1',
      branchId: 'branch-1',
      processId: 'process-1',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      fileName: 'july.csv',
      contentDigest: 'a'.repeat(64),
      uploadedBy: 'user-1',
      mappingVersionUsed: 1,
      acceptedRows: [
        { rowNumber: 2, employeeId: 'emp-1', employeeCode: 'MAS1', reportDate: '2026-07-15', loginMinutes: 420 },
      ],
      rejectedRows: [{ rowNumber: 3, employeeCode: 'MAS2', reason: 'duplicate' }],
    });

    expect(result.acceptedCount).toBe(1);
    expect(result.rejectedCount).toBe(1);
    expect(result.batchId).toBeTruthy();
    expect(result.batchReference).toBe(result.batchId);
  });

  it('marks the prior batch superseded when supersedesBatchId is given', async () => {
    executeMock
      .mockResolvedValueOnce([[{ id: 'camp-1', campaign_code: 'DEFAULT_ds-1' }]])
      .mockResolvedValueOnce([{}]) // INSERT new batch
      .mockResolvedValueOnce([{}]) // UPDATE prior batch superseded
      .mockResolvedValueOnce([{}]); // INSERT apr_manual_upload

    await commitUploadBatch({
      diallerSourceId: 'ds-1',
      branchId: 'branch-1',
      processId: 'process-1',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      fileName: 'july-corrected.csv',
      contentDigest: 'b'.repeat(64),
      uploadedBy: 'user-1',
      mappingVersionUsed: 1,
      supersedesBatchId: 'batch-old',
      acceptedRows: [
        { rowNumber: 2, employeeId: 'emp-1', employeeCode: 'MAS1', reportDate: '2026-07-15', loginMinutes: 420 },
      ],
      rejectedRows: [],
    });

    const updateCall = executeMock.mock.calls.find((c) =>
      String(c[0]).includes('UPDATE productivity_upload_batch'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toContain('batch-old');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/productivity-upload-commit.service.test.ts`
Expected: FAIL — `Cannot find module '../productivity-upload-commit.service.js'`

- [ ] **Step 3: Write the implementation**

```ts
// backend/src/modules/wfm/productivity-upload-commit.service.ts
//
// The write path for the WFM manual upload pipeline (requirements.md Requirement 17). Two
// pieces: resolveOrCreateDefaultCampaign() closes the campaign_id gap apr_manual_upload's schema
// has and Requirement 17 never addresses (see this plan's header) — every manual_upload
// Dialler_Source gets exactly one auto-created default campaign, idempotently. commitUploadBatch()
// writes productivity_upload_batch, apr_manual_upload (the accepted rows, criterion 17.3) and
// productivity_upload_rejection (criterion 17.2), and marks a prior batch superseded when this
// submission declares itself a re-upload (criterion 17.7).

import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import type { PreviewAcceptedRow, PreviewRejectedRow } from './productivity-upload-preview.service.js';

const INSERT_CHUNK_SIZE = 300; // matches attendance-apr-bulk.routes.ts's proven chunk size

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

interface CampaignRow extends RowDataPacket {
  id: string;
  campaign_code: string;
}

/**
 * Resolves the one default campaign for a manual_upload Dialler_Source, creating it on first
 * use. Idempotent and race-safe: the INSERT is a no-op ON DUPLICATE KEY (campaign_code is
 * UNIQUE), then a fresh SELECT returns whichever row actually won the race.
 */
export async function resolveOrCreateDefaultCampaign(
  diallerSourceId: string,
): Promise<{ campaignId: string; campaignCode: string }> {
  const defaultCode = `DEFAULT_${diallerSourceId}`;

  const [existing] = await db.execute<CampaignRow[]>(
    `SELECT id, campaign_code FROM campaign_master WHERE campaign_code = ? LIMIT 1`,
    [defaultCode],
  );
  if (existing.length > 0) {
    return { campaignId: existing[0].id, campaignCode: existing[0].campaign_code };
  }

  const [sourceRows] = await db.execute<RowDataPacket[]>(
    `SELECT display_name FROM dialler_source WHERE id = ? LIMIT 1`,
    [diallerSourceId],
  );
  const displayName = sourceRows.length > 0 ? (sourceRows[0] as any).display_name : diallerSourceId;

  await db.execute(
    `INSERT INTO campaign_master (id, campaign_code, campaign_name, dialler_source_id, is_sentinel, active_status)
     VALUES (?, ?, ?, ?, 0, 1)
     ON DUPLICATE KEY UPDATE campaign_name = campaign_name`,
    [randomUUID(), defaultCode, `Default campaign for ${displayName}`, diallerSourceId],
  );

  const [rows] = await db.execute<CampaignRow[]>(
    `SELECT id, campaign_code FROM campaign_master WHERE campaign_code = ? LIMIT 1`,
    [defaultCode],
  );
  return { campaignId: rows[0].id, campaignCode: rows[0].campaign_code };
}

export interface CommitBatchParams {
  diallerSourceId: string;
  branchId: string;
  processId: string;
  dateFrom: string;
  dateTo: string;
  fileName: string;
  contentDigest: string;
  uploadedBy: string;
  mappingVersionUsed: number;
  supersedesBatchId?: string;
  acceptedRows: PreviewAcceptedRow[];
  rejectedRows: PreviewRejectedRow[];
}

export interface CommitBatchResult {
  batchId: string;
  batchReference: string;
  acceptedCount: number;
  rejectedCount: number;
}

export async function commitUploadBatch(params: CommitBatchParams): Promise<CommitBatchResult> {
  const { campaignCode } = await resolveOrCreateDefaultCampaign(params.diallerSourceId);

  const batchId = randomUUID();
  const batchReference = batchId; // simplest guaranteed-unique reference; no human-readable
                                   // scheme is specified anywhere in requirements.md

  await db.execute(
    `INSERT INTO productivity_upload_batch
       (id, batch_reference, dialler_source_id, branch_id, process_id, date_from, date_to,
        file_name, content_digest, uploaded_by, submitted_row_count, accepted_row_count,
        rejected_row_count, mapping_version_used, supersedes_batch_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted')`,
    [
      batchId, batchReference, params.diallerSourceId, params.branchId, params.processId,
      params.dateFrom, params.dateTo, params.fileName, params.contentDigest, params.uploadedBy,
      params.acceptedRows.length + params.rejectedRows.length,
      params.acceptedRows.length, params.rejectedRows.length, params.mappingVersionUsed,
      params.supersedesBatchId ?? null,
    ],
  );

  if (params.supersedesBatchId) {
    await db.execute(
      `UPDATE productivity_upload_batch
          SET status = 'superseded', superseded_at = NOW(), superseded_by_batch_id = ?
        WHERE id = ? AND status <> 'superseded'`,
      [batchId, params.supersedesBatchId],
    );
  }

  for (const chunk of chunkArray(params.acceptedRows, INSERT_CHUNK_SIZE)) {
    // Plain multi-row VALUES, matching the proven pattern in attendance-apr-bulk.routes.ts —
    // 14 bound params per row (id..upload_batch_id) plus the literal NOW() for created_at,
    // matching apr_manual_upload's 15-column shape exactly. An earlier draft of this function
    // used a `SELECT t.*, ? FROM (VALUES ...) AS t` wrapper to append upload_batch_id, which
    // undercounted by one column against created_at — a real column-count SQL error that the
    // mocked unit tests below cannot catch, since a mock does not validate SQL syntax. Caught
    // in self-review before this was ever dispatched; kept this note so the next person who is
    // tempted to "simplify" the INSERT back to that shape knows why it was rejected.
    const valuesSql = chunk
      .map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`)
      .join(',\n         ');
    const flatParams = chunk.flatMap((r) => [
      randomUUID(), r.employeeCode, params.processId, campaignCode, r.reportDate,
      r.callsHandled ?? null, r.ahtSeconds ?? null, r.loginMinutes,
      r.bioMinutes ?? null, r.lunchMinutes ?? null, r.qaMinutes ?? null, r.trainingMinutes ?? null,
      params.uploadedBy, batchId,
    ]);
    await db.execute(
      `INSERT INTO apr_manual_upload
         (id, employee_code, process_id, campaign_id, report_date,
          calls_handled, aht_seconds, login_minutes,
          bio_minutes, lunch_minutes, qa_minutes, training_minutes,
          uploaded_by, upload_batch_id, created_at)
       VALUES ${valuesSql}`,
      flatParams,
    );
  }

  for (const chunk of chunkArray(params.rejectedRows, INSERT_CHUNK_SIZE)) {
    const valuesSql = chunk.map(() => `(?, ?, ?, ?, ?)`).join(',\n         ');
    const flatParams = chunk.flatMap((r) => [
      randomUUID(), batchId, r.rowNumber, r.employeeCode, r.reason,
    ]);
    await db.execute(
      `INSERT INTO productivity_upload_rejection (id, batch_id, row_number, employee_code, reason)
       VALUES ${valuesSql}`,
      flatParams,
    );
  }

  return {
    batchId,
    batchReference,
    acceptedCount: params.acceptedRows.length,
    rejectedCount: params.rejectedRows.length,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/productivity-upload-commit.service.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/wfm/productivity-upload-commit.service.ts \
        backend/src/modules/wfm/__tests__/productivity-upload-commit.service.test.ts
git commit -m "feat: add commitUploadBatch() + resolveOrCreateDefaultCampaign() — the WFM upload write path"
```

---

### Task 4: `productivity-upload.routes.ts` — the Express route

**Files:**
- Create: `backend/src/modules/wfm/productivity-upload.routes.ts`
- Modify: `backend/src/app.ts` (add import + `app.use()`)
- Test: `backend/src/modules/wfm/__tests__/productivity-upload.routes.test.ts`

**Interfaces:**
- Consumes: `buildUploadPreview` (Task 2), `commitUploadBatch` (Task 3),
  `resolveUserBusinessScope` from `../../shared/enterpriseScope.js`, `requireAuth` from
  `../../middleware/authMiddleware.js`, `requireRole` from `../../middleware/requireRole.js`.
- Produces: `POST /api/wfm/productivity-upload/preview`, `POST /api/wfm/productivity-upload/commit`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/modules/wfm/__tests__/productivity-upload.routes.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const buildUploadPreviewMock = vi.fn();
const commitUploadBatchMock = vi.fn();
vi.mock('../productivity-upload-preview.service.js', () => ({
  buildUploadPreview: (...args: unknown[]) => buildUploadPreviewMock(...args),
}));
vi.mock('../productivity-upload-commit.service.js', () => ({
  commitUploadBatch: (...args: unknown[]) => commitUploadBatchMock(...args),
}));

const resolveUserBusinessScopeMock = vi.fn();
vi.mock('../../../shared/enterpriseScope.js', () => ({
  resolveUserBusinessScope: (...args: unknown[]) => resolveUserBusinessScopeMock(...args),
}));

vi.mock('../../../middleware/authMiddleware.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = { id: 'user-1', role: 'wfm' };
    next();
  },
}));
vi.mock('../../../middleware/requireRole.js', () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

import { productivityUploadRouter } from '../productivity-upload.routes.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/wfm/productivity-upload', productivityUploadRouter);
  return app;
}

const CSV_CONTENT = 'Emp Code,Report Date,Login Minutes\nMAS1,2026-07-15,420\n';

describe('POST /api/wfm/productivity-upload/preview', () => {
  beforeEach(() => {
    buildUploadPreviewMock.mockReset();
    commitUploadBatchMock.mockReset();
    resolveUserBusinessScopeMock.mockReset();
  });

  it('rejects a branch outside the uploader\'s resolved scope (criterion 17.8)', async () => {
    resolveUserBusinessScopeMock.mockResolvedValueOnce({
      isSuperAdmin: false, isAdmin: false, isHr: false, isPayroll: false, isFinance: false,
      assignments: [{ branchId: 'branch-allowed' }],
    });

    const res = await request(buildApp())
      .post('/api/wfm/productivity-upload/preview')
      .field('diallerSourceId', 'ds-1')
      .field('branchId', 'branch-outside-scope')
      .field('processId', 'process-1')
      .field('dateFrom', '2026-07-01')
      .field('dateTo', '2026-07-31')
      .field('columnMappings', JSON.stringify({ 'Emp Code': 'employee_code', 'Report Date': 'report_date', 'Login Minutes': 'login_minutes' }))
      .attach('file', Buffer.from(CSV_CONTENT), 'july.csv');

    expect(res.status).toBe(403);
    expect(buildUploadPreviewMock).not.toHaveBeenCalled();
  });

  it('previews a CSV within scope without committing anything', async () => {
    resolveUserBusinessScopeMock.mockResolvedValueOnce({
      isSuperAdmin: false, isAdmin: false, isHr: false, isPayroll: false, isFinance: false,
      assignments: [{ branchId: 'branch-1' }],
    });
    buildUploadPreviewMock.mockResolvedValueOnce({
      accepted: [{ rowNumber: 2, employeeId: 'emp-1', employeeCode: 'MAS1', reportDate: '2026-07-15', loginMinutes: 420 }],
      rejected: [],
    });

    const res = await request(buildApp())
      .post('/api/wfm/productivity-upload/preview')
      .field('diallerSourceId', 'ds-1')
      .field('branchId', 'branch-1')
      .field('processId', 'process-1')
      .field('dateFrom', '2026-07-01')
      .field('dateTo', '2026-07-31')
      .field('columnMappings', JSON.stringify({ 'Emp Code': 'employee_code', 'Report Date': 'report_date', 'Login Minutes': 'login_minutes' }))
      .attach('file', Buffer.from(CSV_CONTENT), 'july.csv');

    expect(res.status).toBe(200);
    expect(res.body.accepted).toHaveLength(1);
    expect(commitUploadBatchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/wfm/productivity-upload/commit', () => {
  beforeEach(() => {
    buildUploadPreviewMock.mockReset();
    commitUploadBatchMock.mockReset();
    resolveUserBusinessScopeMock.mockReset();
  });

  it('commits a CSV within scope and returns the batch summary', async () => {
    resolveUserBusinessScopeMock.mockResolvedValueOnce({
      isSuperAdmin: true, isAdmin: false, isHr: false, isPayroll: false, isFinance: false,
      assignments: [],
    });
    buildUploadPreviewMock.mockResolvedValueOnce({
      accepted: [{ rowNumber: 2, employeeId: 'emp-1', employeeCode: 'MAS1', reportDate: '2026-07-15', loginMinutes: 420 }],
      rejected: [],
    });
    commitUploadBatchMock.mockResolvedValueOnce({
      batchId: 'batch-1', batchReference: 'batch-1', acceptedCount: 1, rejectedCount: 0,
    });

    const res = await request(buildApp())
      .post('/api/wfm/productivity-upload/commit')
      .field('diallerSourceId', 'ds-1')
      .field('branchId', 'branch-1')
      .field('processId', 'process-1')
      .field('dateFrom', '2026-07-01')
      .field('dateTo', '2026-07-31')
      .field('columnMappings', JSON.stringify({ 'Emp Code': 'employee_code', 'Report Date': 'report_date', 'Login Minutes': 'login_minutes' }))
      .attach('file', Buffer.from(CSV_CONTENT), 'july.csv');

    expect(res.status).toBe(200);
    expect(res.body.batchId).toBe('batch-1');
    expect(commitUploadBatchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-CSV file with a real status, not a masked 500', async () => {
    resolveUserBusinessScopeMock.mockResolvedValueOnce({
      isSuperAdmin: true, isAdmin: false, isHr: false, isPayroll: false, isFinance: false,
      assignments: [],
    });

    const res = await request(buildApp())
      .post('/api/wfm/productivity-upload/commit')
      .field('diallerSourceId', 'ds-1')
      .field('branchId', 'branch-1')
      .field('processId', 'process-1')
      .field('dateFrom', '2026-07-01')
      .field('dateTo', '2026-07-31')
      .field('columnMappings', '{}')
      .attach('file', Buffer.from('not a csv'), 'report.xlsx');

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('CSV');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/productivity-upload.routes.test.ts`
Expected: FAIL — `Cannot find module '../productivity-upload.routes.js'`. If `supertest` is not
already a devDependency, check `backend/package.json` first — this repository's existing route
tests (`*.routes.test.ts`) already use it; if genuinely absent, `npm install --save-dev supertest`
before proceeding, matching how Phase 1 added `fast-check`.

- [ ] **Step 3: Write the route**

```ts
// backend/src/modules/wfm/productivity-upload.routes.ts
//
// The WFM manual upload endpoint (requirements.md Requirement 17). Two steps, both stateless
// (no server-side pending-batch storage): POST /preview parses and validates a file without
// writing anything; POST /commit re-parses the same file and actually writes. Modelled on
// attendance-apr-bulk.routes.ts's proven multer/rejection-handling pattern.

import { Router } from 'express';
import multer from 'multer';
import { createHash } from 'crypto';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { resolveUserBusinessScope, type UserBusinessScope } from '../../shared/enterpriseScope.js';
import { buildUploadPreview } from './productivity-upload-preview.service.js';
import { commitUploadBatch } from './productivity-upload-commit.service.js';

const router = Router();
router.use(requireAuth);

const MAX_UPLOAD_MB = 2;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error(
        'This upload reads CSV files only. In Excel choose File > Save As > CSV (Comma delimited) (*.csv) and upload that file.',
      ));
    }
  },
});

/**
 * Same rationale as attendance-apr-bulk.routes.ts's acceptCsvUpload(): multer raises rejections
 * as plain, statusless Errors, which the global error handler masks as an opaque 500. Answering
 * here, with a real status, keeps the actual reason visible to the uploader.
 */
function acceptCsvUpload(req: any, res: any, next: any) {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    const code = (err as { code?: string })?.code;
    const message =
      code === 'LIMIT_FILE_SIZE'
        ? `The file is larger than ${MAX_UPLOAD_MB} MB. Split it into smaller files and upload them one at a time.`
        : code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Attach the CSV as a single file named "file".'
          : err instanceof Error && err.message
            ? err.message
            : 'The uploaded file could not be read.';
    return res.status(400).json({ success: false, message });
  });
}

function isBranchInUploaderScope(scope: UserBusinessScope, branchId: string): boolean {
  if (scope.isSuperAdmin || scope.isAdmin) return true;
  return scope.assignments.some((a) => a.branchId === null || a.branchId === branchId);
}

function parseCsvIntoRows(content: string): Array<{ rowNumber: number; data: Record<string, string> }> {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(',').map((h) => h.trim());
  const rows: Array<{ rowNumber: number; data: Record<string, string> }> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(',').map((c) => c.trim());
    const data: Record<string, string> = {};
    headers.forEach((h, idx) => { data[h] = cols[idx] ?? ''; });
    rows.push({ rowNumber: i + 1, data });
  }
  return rows;
}

interface UploadRequestFields {
  diallerSourceId: string;
  branchId: string;
  processId: string;
  dateFrom: string;
  dateTo: string;
  columnMappings: Record<string, string>;
}

function readRequestFields(body: any): UploadRequestFields | { error: string } {
  const { diallerSourceId, branchId, processId, dateFrom, dateTo, columnMappings } = body;
  if (!diallerSourceId || !branchId || !processId || !dateFrom || !dateTo || !columnMappings) {
    return { error: 'diallerSourceId, branchId, processId, dateFrom, dateTo and columnMappings are all required' };
  }
  let parsedMappings: Record<string, string>;
  try {
    parsedMappings = typeof columnMappings === 'string' ? JSON.parse(columnMappings) : columnMappings;
  } catch {
    return { error: 'columnMappings must be valid JSON' };
  }
  return { diallerSourceId, branchId, processId, dateFrom, dateTo, columnMappings: parsedMappings };
}

router.post(
  '/preview',
  requireRole('wfm', 'branch_head', 'hr', 'payroll_head', 'super_admin', 'admin'),
  acceptCsvUpload,
  async (req: any, res: any) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No CSV file uploaded' });

    const fields = readRequestFields(req.body);
    if ('error' in fields) return res.status(400).json({ success: false, message: fields.error });

    const scope = await resolveUserBusinessScope(req.authUser);
    if (!isBranchInUploaderScope(scope, fields.branchId)) {
      return res.status(403).json({ success: false, message: 'This branch is outside your resolved scope' });
    }

    const rawRows = parseCsvIntoRows(req.file.buffer.toString('utf-8'));
    const preview = await buildUploadPreview(rawRows, fields.columnMappings, fields.diallerSourceId);

    if (preview.mappingError) {
      return res.status(400).json({
        success: false,
        message: `Column mapping is missing required field(s): ${preview.mappingError.missingFields.join(', ')}`,
      });
    }

    return res.json({ success: true, accepted: preview.accepted, rejected: preview.rejected });
  },
);

router.post(
  '/commit',
  requireRole('wfm', 'branch_head', 'hr', 'payroll_head', 'super_admin', 'admin'),
  acceptCsvUpload,
  async (req: any, res: any) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No CSV file uploaded' });

    const fields = readRequestFields(req.body);
    if ('error' in fields) return res.status(400).json({ success: false, message: fields.error });

    const scope = await resolveUserBusinessScope(req.authUser);
    if (!isBranchInUploaderScope(scope, fields.branchId)) {
      return res.status(403).json({ success: false, message: 'This branch is outside your resolved scope' });
    }

    const fileBuffer: Buffer = req.file.buffer;
    const rawRows = parseCsvIntoRows(fileBuffer.toString('utf-8'));
    const preview = await buildUploadPreview(rawRows, fields.columnMappings, fields.diallerSourceId);

    if (preview.mappingError) {
      return res.status(400).json({
        success: false,
        message: `Column mapping is missing required field(s): ${preview.mappingError.missingFields.join(', ')}`,
      });
    }

    const contentDigest = createHash('sha256').update(fileBuffer).digest('hex');
    const mappingVersionUsed = Number(req.body.mappingVersionUsed) || 1;
    const supersedesBatchId: string | undefined = req.body.supersedesBatchId || undefined;

    const result = await commitUploadBatch({
      diallerSourceId: fields.diallerSourceId,
      branchId: fields.branchId,
      processId: fields.processId,
      dateFrom: fields.dateFrom,
      dateTo: fields.dateTo,
      fileName: req.file.originalname,
      contentDigest,
      uploadedBy: req.authUser.id,
      mappingVersionUsed,
      supersedesBatchId,
      acceptedRows: preview.accepted,
      rejectedRows: preview.rejected,
    });

    return res.json({ success: true, ...result });
  },
);

export { router as productivityUploadRouter };
```

- [ ] **Step 4: Register the route in `app.ts`**

Find the existing `attendanceAprBulkRouter` import and `app.use()` call
(`grep -n "attendanceAprBulkRouter" backend/src/app.ts`) and add the new router immediately after
both, following the exact same shape:

```ts
import { productivityUploadRouter } from "./modules/wfm/productivity-upload.routes.js";
```
```ts
app.use('/api/wfm/productivity-upload', productivityUploadRouter);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/productivity-upload.routes.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/wfm/productivity-upload.routes.ts \
        backend/src/modules/wfm/__tests__/productivity-upload.routes.test.ts \
        backend/src/app.ts
git commit -m "feat: add POST /api/wfm/productivity-upload/{preview,commit} — the WFM manual upload endpoint (Requirement 17)"
```

---

### Task 5: Register migration 1639 in `MIGRATION_MANIFEST`

**Files:**
- Modify: `backend/src/db/runPendingMigrations.ts` (grep for the current last manifest entry
  fresh)
- Modify: `backend/sql/MIGRATION_MANIFEST.lock.json` (regenerated, not hand-edited)

- [ ] **Step 1: Find the true current last entry**

Run: `cd backend && grep -n "^\s*\"16[0-9][0-9]_" src/db/runPendingMigrations.ts | tail -5`

- [ ] **Step 2: Add the entry**

```ts
  "1639_wfm_productivity_upload_page_access.sql", // Registers WFM_PRODUCTIVITY_UPLOAD in page_catalog + role_page_access (criteria 14.7, 14.8) for the new POST /api/wfm/productivity-upload/{preview,commit} endpoint (requirements.md Requirement 17). No navConfig.tsx entry yet -- no UI page exists to route to; the endpoint is reachable by URL for a correctly-permissioned user and exercised by this phase's own tests.
```

- [ ] **Step 3: Regenerate the lock file**

Run: `cd backend && node scripts/update-migration-lock.mjs --write`

- [ ] **Step 4: Run the manifest-guard contract test**

Run: `cd backend && npx vitest run src/db/__tests__/migration-manifest-guard.test.ts`
Expected: 8 pass, 1 pre-existing failure (documented in the ledger — do not attempt to fix).

- [ ] **Step 5: Run every test this phase added, plus Phases 1–3's, together, as a final gate**

Run: `cd backend && npx vitest run src/modules/wfm/__tests__/attendance-source-rule-resolver.property.test.ts src/modules/wfm/__tests__/attendance-source-rule.service.test.ts src/modules/wfm/__tests__/day-threshold-rule.service.test.ts src/modules/wfm/__tests__/attendance-threshold-config.service.test.ts src/modules/wfm/__tests__/canonical-productivity.property.test.ts src/modules/wfm/__tests__/dialler-source-registry.service.test.ts src/modules/wfm/__tests__/productivity-upload-parser.test.ts src/modules/wfm/__tests__/productivity-upload-validation.service.test.ts src/modules/wfm/__tests__/productivity-upload-preview.service.test.ts src/modules/wfm/__tests__/productivity-upload-commit.service.test.ts src/modules/wfm/__tests__/productivity-upload.routes.test.ts src/db/__tests__/attendance-source-rule-store-migration.contract.test.ts src/db/__tests__/dialler-source-registry-migration.contract.test.ts src/db/__tests__/canonical-productivity-store-migration.contract.test.ts src/db/__tests__/productivity-upload-batch-migration.contract.test.ts src/db/__tests__/wfm-productivity-upload-page-access-migration.contract.test.ts`
Expected: PASS. Count from actual output — every prior phase's estimate has drifted by the time
review rounds finished; treat 86 (Phases 1–3's confirmed total) + this phase's tests as the floor,
not the exact number.

- [ ] **Step 6: Manually exercise the live endpoint once, read-only**

Since this phase adds a genuinely new HTTP surface, prove it is wired correctly beyond the mocked
unit tests: start the backend locally (or use an existing dev/staging instance per this repo's
own verification convention) and confirm `POST /api/wfm/productivity-upload/preview` is reachable
and returns 401 without auth, and returns something other than a raw 404/500 with a valid demo
token. Do not commit real data through `/commit` as part of this step — this repo's own
CLAUDE.md requires explicit approval before any state-changing action reaches a real database, and
`/commit` writes real rows.

- [ ] **Step 7: Commit**

```bash
git add backend/src/db/runPendingMigrations.ts backend/sql/MIGRATION_MANIFEST.lock.json
git commit -m "chore: register migration 1639 in MIGRATION_MANIFEST"
```

---

## What Phase 4 deliberately does not do

No change to `attendance-apr-bulk.routes.ts` or the `apr` table's write path — that is Phase 5,
paired with the `apr` trigger, reviewed together since one cannot ship without the other. No
navConfig.tsx entry (no UI page exists yet). No engine wiring — `processEmployee()` still does not
know this feature exists; that is a still-later phase, and the biggest one, since it is the moment
the resolved Attendance_Source and Canonical_Productive_Minutes actually start affecting
`attendance_daily_record` and therefore pay.
