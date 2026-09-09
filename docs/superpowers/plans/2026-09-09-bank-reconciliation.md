# Bank Reconciliation (Payment Voucher Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Accounts Head upload a bank statement, auto/manually match it against `bank_account_ledger_entry`, post adjustments for bank-only items, and close a period so the Phase 3 Tally export can flip from provisional to final.

**Architecture:** Three new tables (`bank_reconciliation_period`, `bank_statement_import`, `bank_statement_line`) plus two new nullable columns on the existing `bank_account_ledger_entry`. Three focused backend services (statement import/parsing, matching, period lifecycle), one routes file, one frontend page. Follows this module's existing conventions exactly: `db.execute` + `mysql2`, `FOR UPDATE` row locks for balance math, `logSensitiveAction` audit, `PoolConnection`-scoped transactions, vitest with `db` mocked via `vi.mock`.

**Tech Stack:** Express + TypeScript + MySQL (`mysql2`), `xlsx` (already a backend dependency) for statement parsing, `multer` memory storage for the upload, React + TanStack Query + shadcn/ui on the frontend, vitest for backend unit tests.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-09-bank-reconciliation-design.md` — every task below implements one of its sections.
- Never a free-text `Input` on a closed set (bank account, ledger head, match action) — use `Select`.
- Every table/list needs a row drill-down per the project's Drill-Down Mandate (History tab periods).
- Amounts formatted `₹` + Indian locale; dates `DD/MM/YYYY`.
- No push/deploy without explicit user approval — commit locally only.
- Stage files by explicit path (`git add <path>`), never `git add -A`/`-a`.
- Migrations are additive; the new `bank_account_ledger_entry` columns must be guarded (`IF NOT EXISTS`-style check) per this repo's migration rules.

---

## File Structure

**Backend — new:**
- `backend/sql/1708_bank_reconciliation_period.sql`
- `backend/sql/1709_bank_statement_import.sql`
- `backend/sql/1710_bank_statement_line.sql`
- `backend/sql/1711_bank_reconciliation_ledger_columns.sql`
- `backend/sql/1712_bank_reconciliation_page_access.sql`
- `backend/src/modules/finance/bank-statement-import.service.ts` — parses uploaded CSV/XLSX using a saved/given column mapping into `bank_statement_line` rows.
- `backend/src/modules/finance/bank-reconciliation-match.service.ts` — auto-match, manual match, unmatch, adjustment posting.
- `backend/src/modules/finance/bank-reconciliation-period.service.ts` — period create/list/detail, close (with the balance-formula gate), reopen (with the supersession guard).
- `backend/src/modules/finance/bank-reconciliation.routes.ts` — mounts everything at `/api/finance/bank-reconciliation`.
- `backend/src/modules/finance/__tests__/bank-statement-import.service.test.ts`
- `backend/src/modules/finance/__tests__/bank-reconciliation-match.service.test.ts`
- `backend/src/modules/finance/__tests__/bank-reconciliation-period.service.test.ts`

**Backend — modified:**
- `backend/src/modules/finance/tally-export.service.ts` — real `isFinal` derivation.
- `backend/src/modules/finance/__tests__/tally-export.service.test.ts` — add `isFinal` tests.
- `backend/src/app.ts` — mount `bankReconciliationRouter`.

**Frontend — new:**
- `src/pages/finance/BankReconciliationPage.tsx`

**Frontend — modified:**
- `src/config/routes/finance.routes.tsx` — register the route.
- `src/components/layout/navConfig.tsx` — add the nav entry.

---

### Task 1: Schema — reconciliation tables and ledger columns

**Files:**
- Create: `backend/sql/1708_bank_reconciliation_period.sql`
- Create: `backend/sql/1709_bank_statement_import.sql`
- Create: `backend/sql/1710_bank_statement_line.sql`
- Create: `backend/sql/1711_bank_reconciliation_ledger_columns.sql`

**Interfaces:**
- Produces: table/column names every later task's SQL relies on — `bank_reconciliation_period(id, bank_account_id, from_date, to_date, status, opening_balance, statement_closing_balance, computed_closing_balance, outstanding_total, closed_by, closed_at, reopened_by, reopened_at, reopen_reason)`; `bank_statement_import(id, bank_account_id, period_id, original_filename, column_mapping, imported_by, imported_at, row_count)`; `bank_statement_line(id, import_id, txn_date, description, reference, debit_amount, credit_amount, match_status, matched_ledger_entry_id)`; `bank_account_ledger_entry.matched_statement_line_id`, `bank_account_ledger_entry.reconciliation_period_id`.

- [ ] **Step 1: Write `1708_bank_reconciliation_period.sql`**

```sql
-- 1708_bank_reconciliation_period.sql
--
-- Payment Voucher System Phase 4. One row per bank account per reconciliation window.
-- status='open' means matching is still in progress; 'closed' means the period balanced
-- (see bank-reconciliation-period.service.ts's close()) and every entry in it is now locked.
-- A bank account may have at most one 'open' period at a time — enforced in the service, the
-- same way payment_voucher's maker-checker is enforced in code rather than a DB constraint.
CREATE TABLE IF NOT EXISTS bank_reconciliation_period (
  id                          CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  bank_account_id             CHAR(36)      NOT NULL,
  from_date                   DATE          NOT NULL,
  to_date                     DATE          NOT NULL,
  status                      ENUM('open','closed') NOT NULL DEFAULT 'open',
  opening_balance             DECIMAL(18,2) NOT NULL DEFAULT 0,
  statement_closing_balance   DECIMAL(18,2) NULL COMMENT 'Typed in by the user from the real bank statement. Required to close.',
  computed_closing_balance    DECIMAL(18,2) NULL COMMENT 'HRMS running balance as of to_date. Stored at close.',
  outstanding_total           DECIMAL(18,2) NULL COMMENT 'Sum of unmatched ledger entries dated <= to_date. Stored at close.',
  closed_by                   CHAR(36)      NULL,
  closed_at                   DATETIME      NULL,
  reopened_by                 CHAR(36)      NULL,
  reopened_at                 DATETIME      NULL,
  reopen_reason               TEXT          NULL,
  created_by                  CHAR(36)      NULL,
  created_at                  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_brp_account_status (bank_account_id, status),
  INDEX idx_brp_account_dates (bank_account_id, from_date, to_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1708_bank_reconciliation_period.sql applied' AS migration_status;
```

- [ ] **Step 2: Write `1709_bank_statement_import.sql`**

```sql
-- 1709_bank_statement_import.sql
--
-- One row per uploaded bank statement file. column_mapping records which uploaded column is
-- which field (see bank-statement-import.service.ts) so the next upload for the same account
-- can reuse it without asking again.
CREATE TABLE IF NOT EXISTS bank_statement_import (
  id                  CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  bank_account_id     CHAR(36)      NOT NULL,
  period_id           CHAR(36)      NOT NULL,
  original_filename   VARCHAR(255)  NOT NULL,
  column_mapping      JSON          NOT NULL,
  imported_by         CHAR(36)      NULL,
  imported_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  row_count           INT           NOT NULL DEFAULT 0,
  INDEX idx_bsi_account (bank_account_id),
  INDEX idx_bsi_period (period_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1709_bank_statement_import.sql applied' AS migration_status;
```

- [ ] **Step 3: Write `1710_bank_statement_line.sql`**

```sql
-- 1710_bank_statement_line.sql
--
-- Each parsed row from an uploaded bank statement. match_status starts 'unmatched'; the
-- matching engine (bank-reconciliation-match.service.ts) flips it to 'matched' (linked to a
-- real bank_account_ledger_entry that was already there) or 'adjusted' (a brand-new ledger
-- entry was posted because the bank shows something HRMS didn't record, e.g. a bank charge).
CREATE TABLE IF NOT EXISTS bank_statement_line (
  id                      CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  import_id               CHAR(36)      NOT NULL,
  txn_date                DATE          NOT NULL,
  description             TEXT          NOT NULL,
  reference                VARCHAR(100)  NULL,
  debit_amount            DECIMAL(18,2) NOT NULL DEFAULT 0,
  credit_amount           DECIMAL(18,2) NOT NULL DEFAULT 0,
  match_status            ENUM('unmatched','matched','adjusted') NOT NULL DEFAULT 'unmatched',
  matched_ledger_entry_id CHAR(36)      NULL,
  created_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bsl_import (import_id),
  INDEX idx_bsl_status (import_id, match_status),
  INDEX idx_bsl_matched_entry (matched_ledger_entry_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1710_bank_statement_line.sql applied' AS migration_status;
```

- [ ] **Step 4: Write `1711_bank_reconciliation_ledger_columns.sql`**

```sql
-- 1711_bank_reconciliation_ledger_columns.sql
--
-- Additive columns on bank_account_ledger_entry for Phase 4. Both nullable, default NULL — no
-- backfill needed, no existing read path is affected. Guarded with the information_schema
-- check this repo's migration rules require before any ALTER, so a second run is a no-op.
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bank_account_ledger_entry'
     AND COLUMN_NAME = 'matched_statement_line_id'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE bank_account_ledger_entry
     ADD COLUMN matched_statement_line_id CHAR(36) NULL COMMENT ''Set when matched to a bank_statement_line during reconciliation.'' AFTER source_type,
     ADD COLUMN reconciliation_period_id CHAR(36) NULL COMMENT ''Set only when the covering bank_reconciliation_period is closed. Presence = locked.'' AFTER matched_statement_line_id,
     ADD INDEX idx_bale_matched_line (matched_statement_line_id),
     ADD INDEX idx_bale_recon_period (reconciliation_period_id)',
  'SELECT ''1711 columns already exist'' AS migration_status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT '1711_bank_reconciliation_ledger_columns.sql applied' AS migration_status;
```

- [ ] **Step 5: Apply all four migrations to the local/staging DB and verify**

Run (from `backend/`, using the repo's existing migration runner or direct `mysql` per `CLAUDE.md`'s DB rule):
```bash
mysql -u "$DB_USER" -p"$DB_PASSWORD" -h "$DB_HOST" "$DB_NAME" < sql/1708_bank_reconciliation_period.sql
mysql -u "$DB_USER" -p"$DB_PASSWORD" -h "$DB_HOST" "$DB_NAME" < sql/1709_bank_statement_import.sql
mysql -u "$DB_USER" -p"$DB_PASSWORD" -h "$DB_HOST" "$DB_NAME" < sql/1710_bank_statement_line.sql
mysql -u "$DB_USER" -p"$DB_PASSWORD" -h "$DB_HOST" "$DB_NAME" < sql/1711_bank_reconciliation_ledger_columns.sql
mysql -u "$DB_USER" -p"$DB_PASSWORD" -h "$DB_HOST" "$DB_NAME" -e "DESCRIBE bank_account_ledger_entry;" | grep -E "matched_statement_line_id|reconciliation_period_id"
```
Expected: four `... applied` status rows, and the `DESCRIBE` output shows both new columns.

- [ ] **Step 6: Commit**

```bash
git add backend/sql/1708_bank_reconciliation_period.sql backend/sql/1709_bank_statement_import.sql backend/sql/1710_bank_statement_line.sql backend/sql/1711_bank_reconciliation_ledger_columns.sql
git commit -m "Bank Reconciliation Phase 4: schema (period, statement import/line, ledger columns)"
```

---

### Task 2: Statement import/parsing service

**Files:**
- Create: `backend/src/modules/finance/bank-statement-import.service.ts`
- Test: `backend/src/modules/finance/__tests__/bank-statement-import.service.test.ts`

**Interfaces:**
- Consumes: `db.execute` (mysql2), nothing from other new services.
- Produces: `export interface ColumnMapping { date: string; description: string; reference?: string; debit?: string; credit?: string; amount?: string }` and `export function parseStatementRows(headers: string[], rows: unknown[][], mapping: ColumnMapping): ParsedStatementLine[]` where `ParsedStatementLine = { txn_date: string; description: string; reference: string | null; debit_amount: number; credit_amount: number }`. Also `export const bankStatementImportService = { parseWorkbook(buffer: Buffer): { headers: string[]; rows: unknown[][] }, saveImport(bankAccountId: string, periodId: string, filename: string, mapping: ColumnMapping, lines: ParsedStatementLine[], importedBy: string): Promise<{ importId: string; rowCount: number }> }`.

- [ ] **Step 1: Write the failing tests for `parseStatementRows`**

```typescript
// backend/src/modules/finance/__tests__/bank-statement-import.service.test.ts
import { describe, expect, it } from "vitest";
import { parseStatementRows } from "../bank-statement-import.service.js";

describe("bank-statement-import.service parseStatementRows", () => {
  it("maps a debit/credit-pair layout to ParsedStatementLine[]", () => {
    const headers = ["Txn Date", "Narration", "Chq/Ref No", "Debit", "Credit"];
    const rows = [
      ["02/09/2026", "NEFT to Vendor Payables", "UTR123", "50000", ""],
      ["05/09/2026", "Interest Credited", "", "", "120.50"],
    ];
    const lines = parseStatementRows(headers, rows, {
      date: "Txn Date", description: "Narration", reference: "Chq/Ref No", debit: "Debit", credit: "Credit",
    });
    expect(lines).toEqual([
      { txn_date: "2026-09-02", description: "NEFT to Vendor Payables", reference: "UTR123", debit_amount: 50000, credit_amount: 0 },
      { txn_date: "2026-09-05", description: "Interest Credited", reference: null, debit_amount: 0, credit_amount: 120.5 },
    ]);
  });

  it("maps a single signed-amount layout (negative = debit, positive = credit)", () => {
    const headers = ["Date", "Description", "Amount"];
    const rows = [["2026-09-02", "NEFT to Vendor Payables", "-50000"], ["2026-09-05", "Interest Credited", "120.50"]];
    const lines = parseStatementRows(headers, rows, { date: "Date", description: "Description", amount: "Amount" });
    expect(lines).toEqual([
      { txn_date: "2026-09-02", description: "NEFT to Vendor Payables", reference: null, debit_amount: 50000, credit_amount: 0 },
      { txn_date: "2026-09-05", description: "Interest Credited", reference: null, debit_amount: 0, credit_amount: 120.5 },
    ]);
  });

  it("skips rows with no parseable date and rows with zero amount on both sides", () => {
    const headers = ["Date", "Description", "Debit", "Credit"];
    const rows = [["not a date", "junk", "", ""], ["2026-09-02", "zero row", "0", "0"], ["2026-09-03", "real", "10", ""]];
    const lines = parseStatementRows(headers, rows, { date: "Date", description: "Description", debit: "Debit", credit: "Credit" });
    expect(lines).toHaveLength(1);
    expect(lines[0].description).toBe("real");
  });

  it("throws if a mapped column name isn't actually in the headers", () => {
    expect(() => parseStatementRows(["Date", "Description"], [["2026-09-02", "x"]], {
      date: "Date", description: "Description", debit: "Missing Column",
    })).toThrow(/Missing Column/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/finance/__tests__/bank-statement-import.service.test.ts`
Expected: FAIL — `bank-statement-import.service.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// backend/src/modules/finance/bank-statement-import.service.ts
import { randomUUID } from "crypto";
import * as XLSX from "xlsx";
import type { ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Statement upload parsing (Bank Reconciliation, Phase 4). Banks export wildly different
 * column layouts, so instead of assuming one fixed shape, the caller tells us — once per
 * bank account, reused on every later upload — which uploaded column is which field. See
 * bank-reconciliation.routes.ts's /column-mapping-suggestion for how that mapping is offered
 * back to the user pre-filled from their last import.
 */

export interface ColumnMapping {
  date: string;
  description: string;
  reference?: string;
  debit?: string;
  credit?: string;
  amount?: string; // single signed column: negative = debit, positive = credit
}

export interface ParsedStatementLine {
  txn_date: string;      // YYYY-MM-DD
  description: string;
  reference: string | null;
  debit_amount: number;
  credit_amount: number;
}

function columnIndex(headers: string[], name: string): number {
  const idx = headers.indexOf(name);
  if (idx === -1) throw new Error(`Column mapping refers to "${name}", which is not in the uploaded file's header row.`);
  return idx;
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const str = String(value).trim();
  // DD/MM/YYYY (the common Indian bank export format)
  const dmy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  // YYYY-MM-DD already
  const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  return null;
}

export function parseStatementRows(headers: string[], rows: unknown[][], mapping: ColumnMapping): ParsedStatementLine[] {
  const dateIdx = columnIndex(headers, mapping.date);
  const descIdx = columnIndex(headers, mapping.description);
  const refIdx = mapping.reference ? columnIndex(headers, mapping.reference) : -1;
  const debitIdx = mapping.debit ? columnIndex(headers, mapping.debit) : -1;
  const creditIdx = mapping.credit ? columnIndex(headers, mapping.credit) : -1;
  const amountIdx = mapping.amount ? columnIndex(headers, mapping.amount) : -1;

  const result: ParsedStatementLine[] = [];
  for (const row of rows) {
    const txn_date = toIsoDate(row[dateIdx]);
    if (!txn_date) continue; // not a data row (blank line, footer, subtotal, etc.)

    let debit_amount = 0;
    let credit_amount = 0;
    if (amountIdx !== -1) {
      const signed = toNumber(row[amountIdx]);
      if (signed < 0) debit_amount = Math.abs(signed); else credit_amount = signed;
    } else {
      if (debitIdx !== -1) debit_amount = toNumber(row[debitIdx]);
      if (creditIdx !== -1) credit_amount = toNumber(row[creditIdx]);
    }
    if (debit_amount === 0 && credit_amount === 0) continue; // no actual movement — skip

    result.push({
      txn_date,
      description: String(row[descIdx] ?? "").trim(),
      reference: refIdx !== -1 && row[refIdx] ? String(row[refIdx]).trim() : null,
      debit_amount,
      credit_amount,
    });
  }
  return result;
}

export const bankStatementImportService = {
  /** Reads the first worksheet of an uploaded CSV/XLSX buffer into a plain header+rows shape. */
  parseWorkbook(buffer: Buffer): { headers: string[]; rows: unknown[][] } {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
    const [headerRow, ...dataRows] = matrix;
    return { headers: (headerRow ?? []).map((h) => String(h).trim()), rows: dataRows };
  },

  async saveImport(
    bankAccountId: string, periodId: string, filename: string,
    mapping: ColumnMapping, lines: ParsedStatementLine[], importedBy: string,
  ): Promise<{ importId: string; rowCount: number }> {
    const importId = randomUUID();
    await db.execute<ResultSetHeader>(
      `INSERT INTO bank_statement_import (id, bank_account_id, period_id, original_filename, column_mapping, imported_by, row_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [importId, bankAccountId, periodId, filename, JSON.stringify(mapping), importedBy, lines.length],
    );
    for (const line of lines) {
      await db.execute<ResultSetHeader>(
        `INSERT INTO bank_statement_line (id, import_id, txn_date, description, reference, debit_amount, credit_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), importId, line.txn_date, line.description, line.reference, line.debit_amount, line.credit_amount],
      );
    }
    return { importId, rowCount: lines.length };
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/finance/__tests__/bank-statement-import.service.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/finance/bank-statement-import.service.ts backend/src/modules/finance/__tests__/bank-statement-import.service.test.ts
git commit -m "Bank Reconciliation Phase 4: statement upload parsing (CSV/XLSX, column mapping)"
```

---

### Task 3: Matching engine service

**Files:**
- Create: `backend/src/modules/finance/bank-reconciliation-match.service.ts`
- Test: `backend/src/modules/finance/__tests__/bank-reconciliation-match.service.test.ts`

**Interfaces:**
- Consumes: `db` from `../../db/mysql.js`, `logSensitiveAction` from `../../shared/auditLog.js`.
- Produces: `export class BankReconciliationMatchError extends Error { statusCode: number }` and `export const bankReconciliationMatchService = { autoMatch(importId: string): Promise<{ matchedCount: number; unmatchedCount: number }>, manualMatch(statementLineId: string, ledgerEntryId: string, actorUserId: string): Promise<void>, unmatch(statementLineId: string, actorUserId: string): Promise<void>, postAdjustment(input: { statementLineId: string; bankAccountId: string; payableAccountId: string; narration: string; actorUserId: string }): Promise<{ ledgerEntryId: string }> }`. Later tasks (period service) rely on `match_status IN ('matched','adjusted')` as "resolved" and read `matched_statement_line_id`/`reconciliation_period_id` on `bank_account_ledger_entry`.

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/modules/finance/__tests__/bank-reconciliation-match.service.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, logSensitiveAction } = vi.hoisted(() => ({
  execute: vi.fn(),
  logSensitiveAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));

import { bankReconciliationMatchService, BankReconciliationMatchError } from "../bank-reconciliation-match.service.js";

beforeEach(() => { execute.mockReset(); logSensitiveAction.mockClear(); });

describe("bankReconciliationMatchService.autoMatch", () => {
  it("matches a statement line to its single exact-amount candidate within the date window", async () => {
    execute
      // SELECT unmatched statement lines for this import
      .mockResolvedValueOnce([[{ id: "line-1", txn_date: "2026-09-05", debit_amount: 50000, credit_amount: 0 }]])
      // SELECT candidate ledger entries for line-1
      .mockResolvedValueOnce([[{ id: "entry-1" }]])
      // UPDATE bank_statement_line
      .mockResolvedValueOnce([{}])
      // UPDATE bank_account_ledger_entry
      .mockResolvedValueOnce([{}]);

    const result = await bankReconciliationMatchService.autoMatch("import-1");
    expect(result).toEqual({ matchedCount: 1, unmatchedCount: 0 });
    expect(execute).toHaveBeenCalledWith(expect.stringMatching(/UPDATE bank_statement_line/), ["entry-1", "line-1"]);
    expect(execute).toHaveBeenCalledWith(expect.stringMatching(/UPDATE bank_account_ledger_entry/), ["line-1", "entry-1"]);
  });

  it("leaves a line unmatched when there are zero candidates", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "line-1", txn_date: "2026-09-05", debit_amount: 999, credit_amount: 0 }]])
      .mockResolvedValueOnce([[]]);
    const result = await bankReconciliationMatchService.autoMatch("import-1");
    expect(result).toEqual({ matchedCount: 0, unmatchedCount: 1 });
  });

  it("leaves a line unmatched when there are multiple candidates (ambiguous, never guessed)", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "line-1", txn_date: "2026-09-05", debit_amount: 50000, credit_amount: 0 }]])
      .mockResolvedValueOnce([[{ id: "entry-1" }, { id: "entry-2" }]]);
    const result = await bankReconciliationMatchService.autoMatch("import-1");
    expect(result).toEqual({ matchedCount: 0, unmatchedCount: 1 });
  });
});

describe("bankReconciliationMatchService.manualMatch", () => {
  it("rejects a mismatched amount instead of forcing the link", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "line-1", debit_amount: 50000, credit_amount: 0, match_status: "unmatched" }]])
      .mockResolvedValueOnce([[{ id: "entry-1", debit_amount: 40000, credit_amount: 0 }]]);
    await expect(bankReconciliationMatchService.manualMatch("line-1", "entry-1", "actor-1"))
      .rejects.toThrow(BankReconciliationMatchError);
  });

  it("links a statement line and ledger entry with equal amounts", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "line-1", debit_amount: 50000, credit_amount: 0, match_status: "unmatched" }]])
      .mockResolvedValueOnce([[{ id: "entry-1", debit_amount: 50000, credit_amount: 0 }]])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}]);
    await bankReconciliationMatchService.manualMatch("line-1", "entry-1", "actor-1");
    expect(execute).toHaveBeenCalledWith(expect.stringMatching(/UPDATE bank_statement_line/), ["entry-1", "line-1"]);
  });
});

describe("bankReconciliationMatchService.postAdjustment", () => {
  it("inserts a reconciliation_adjustment ledger entry and marks the line 'adjusted'", async () => {
    execute
      // SELECT statement line
      .mockResolvedValueOnce([[{ id: "line-1", txn_date: "2026-09-06", description: "Bank charges", debit_amount: 250, credit_amount: 0, match_status: "unmatched" }]])
      // SELECT ... FOR UPDATE company_bank_account (running balance)
      .mockResolvedValueOnce([[{ id: "acct-1", opening_balance: 0 }]])
      // SELECT last running_balance
      .mockResolvedValueOnce([[{ running_balance: 100000 }]])
      // INSERT bank_account_ledger_entry
      .mockResolvedValueOnce([{}])
      // UPDATE bank_statement_line
      .mockResolvedValueOnce([{}]);

    const result = await bankReconciliationMatchService.postAdjustment({
      statementLineId: "line-1", bankAccountId: "acct-1", payableAccountId: "pam-charges",
      narration: "Bank charges per statement", actorUserId: "actor-1",
    });
    expect(result.ledgerEntryId).toBeTruthy();
    expect(execute).toHaveBeenCalledWith(expect.stringMatching(/INSERT INTO bank_account_ledger_entry/), expect.arrayContaining(["reconciliation_adjustment"]));
    expect(logSensitiveAction).toHaveBeenCalledWith(expect.objectContaining({ action_type: "BANK_RECONCILIATION_ADJUSTMENT_POSTED" }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/finance/__tests__/bank-reconciliation-match.service.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// backend/src/modules/finance/bank-reconciliation-match.service.ts
import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

/**
 * Matching engine (Bank Reconciliation, Phase 4). Three ways a bank_statement_line resolves:
 *   1. autoMatch()     — exact amount, one candidate within the date window. Automatic.
 *   2. manualMatch()   — user picks the pair when auto-match found 0 or >1 candidates.
 *   3. postAdjustment() — the bank shows something HRMS never recorded (charges, interest);
 *      a brand-new bank_account_ledger_entry is posted, same balance discipline as
 *      payment-voucher.service.ts's release().
 * Amounts are never fuzzy-matched — a mismatch is a real discrepancy the accountant must see,
 * not something this engine guesses past.
 */

const MATCH_WINDOW_DAYS = 15;

export class BankReconciliationMatchError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;
}

async function findCandidates(bankAccountId: string, txnDate: string, debit: number, credit: number) {
  const amountClause = debit > 0 ? "bale.debit_amount = ?" : "bale.credit_amount = ?";
  const amountParam = debit > 0 ? debit : credit;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT bale.id, bale.entry_date FROM bank_account_ledger_entry bale
      WHERE bale.bank_account_id = ? AND bale.matched_statement_line_id IS NULL AND ${amountClause}`,
    [bankAccountId, amountParam],
  );
  return (rows as RowDataPacket[]).filter((r) => daysBetween(String(r.entry_date).slice(0, 10), txnDate) <= MATCH_WINDOW_DAYS);
}

async function linkLine(statementLineId: string, ledgerEntryId: string) {
  await db.execute(`UPDATE bank_statement_line SET match_status = 'matched', matched_ledger_entry_id = ? WHERE id = ?`, [ledgerEntryId, statementLineId]);
  await db.execute(`UPDATE bank_account_ledger_entry SET matched_statement_line_id = ? WHERE id = ?`, [statementLineId, ledgerEntryId]);
}

export const bankReconciliationMatchService = {
  async autoMatch(importId: string): Promise<{ matchedCount: number; unmatchedCount: number }> {
    const [lines] = await db.execute<RowDataPacket[]>(
      `SELECT id, txn_date, debit_amount, credit_amount, bank_account_id
         FROM bank_statement_line bsl
         JOIN bank_statement_import bsi ON bsi.id = bsl.import_id
        WHERE bsl.import_id = ? AND bsl.match_status = 'unmatched'`,
      [importId],
    );
    let matchedCount = 0;
    let unmatchedCount = 0;
    for (const line of lines as RowDataPacket[]) {
      const candidates = await findCandidates(String(line.bank_account_id), String(line.txn_date).slice(0, 10), Number(line.debit_amount), Number(line.credit_amount));
      if (candidates.length === 1) {
        await linkLine(String(line.id), String(candidates[0].id));
        matchedCount++;
      } else {
        unmatchedCount++;
      }
    }
    return { matchedCount, unmatchedCount };
  },

  async manualMatch(statementLineId: string, ledgerEntryId: string, actorUserId: string): Promise<void> {
    const [[line]] = await db.execute<RowDataPacket[]>(`SELECT id, debit_amount, credit_amount, match_status FROM bank_statement_line WHERE id = ?`, [statementLineId]);
    if (!line) throw new BankReconciliationMatchError("Statement line not found.", 404);
    if (line.match_status !== "unmatched") throw new BankReconciliationMatchError("Statement line is already resolved.");
    const [[entry]] = await db.execute<RowDataPacket[]>(`SELECT id, debit_amount, credit_amount FROM bank_account_ledger_entry WHERE id = ?`, [ledgerEntryId]);
    if (!entry) throw new BankReconciliationMatchError("Ledger entry not found.", 404);
    const lineAmount = Number(line.debit_amount) > 0 ? Number(line.debit_amount) : Number(line.credit_amount);
    const entryAmount = Number(line.debit_amount) > 0 ? Number(entry.debit_amount) : Number(entry.credit_amount);
    if (lineAmount !== entryAmount) throw new BankReconciliationMatchError(`Amounts don't match: statement ₹${lineAmount} vs ledger ₹${entryAmount}.`);
    await linkLine(statementLineId, ledgerEntryId);
    await logSensitiveAction({ actor_user_id: actorUserId, action_type: "BANK_RECONCILIATION_MANUAL_MATCH", module_key: "FINANCE", entity_type: "bank_statement_line", entity_id: statementLineId, change_summary: { ledger_entry_id: ledgerEntryId } }).catch(() => undefined);
  },

  async unmatch(statementLineId: string, actorUserId: string): Promise<void> {
    const [[line]] = await db.execute<RowDataPacket[]>(`SELECT matched_ledger_entry_id FROM bank_statement_line WHERE id = ?`, [statementLineId]);
    if (!line?.matched_ledger_entry_id) throw new BankReconciliationMatchError("Statement line has no match to undo.");
    await db.execute(`UPDATE bank_account_ledger_entry SET matched_statement_line_id = NULL WHERE id = ?`, [line.matched_ledger_entry_id]);
    await db.execute(`UPDATE bank_statement_line SET match_status = 'unmatched', matched_ledger_entry_id = NULL WHERE id = ?`, [statementLineId]);
    await logSensitiveAction({ actor_user_id: actorUserId, action_type: "BANK_RECONCILIATION_UNMATCH", module_key: "FINANCE", entity_type: "bank_statement_line", entity_id: statementLineId }).catch(() => undefined);
  },

  async postAdjustment(input: { statementLineId: string; bankAccountId: string; payableAccountId: string; narration: string; actorUserId: string }): Promise<{ ledgerEntryId: string }> {
    const [[line]] = await db.execute<RowDataPacket[]>(`SELECT id, txn_date, description, debit_amount, credit_amount, match_status FROM bank_statement_line WHERE id = ?`, [input.statementLineId]);
    if (!line) throw new BankReconciliationMatchError("Statement line not found.", 404);
    if (line.match_status !== "unmatched") throw new BankReconciliationMatchError("Statement line is already resolved.");

    // Same discipline as payment-voucher.service.ts's release(): lock the account row, read the
    // last running_balance, compute the new one, insert. FOR UPDATE serializes concurrent posts.
    await db.execute(`SELECT id FROM company_bank_account WHERE id = ? FOR UPDATE`, [input.bankAccountId]);
    const [[last]] = await db.execute<RowDataPacket[]>(
      `SELECT running_balance FROM bank_account_ledger_entry WHERE bank_account_id = ? ORDER BY entry_date DESC, created_at DESC, id DESC LIMIT 1`,
      [input.bankAccountId],
    );
    const priorBalance = Number(last?.running_balance ?? 0);
    const debit = Number(line.debit_amount);
    const credit = Number(line.credit_amount);
    const newBalance = priorBalance + credit - debit; // debit reduces bank balance, credit increases it

    const ledgerEntryId = randomUUID();
    await db.execute<ResultSetHeader>(
      `INSERT INTO bank_account_ledger_entry
         (id, bank_account_id, entry_date, voucher_id, debit_amount, credit_amount, payable_account_id, narration, running_balance, source_type, created_by, matched_statement_line_id)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 'reconciliation_adjustment', ?, ?)`,
      [ledgerEntryId, input.bankAccountId, line.txn_date, debit, credit, input.payableAccountId, input.narration, newBalance, input.actorUserId, input.statementLineId],
    );
    await db.execute(`UPDATE bank_statement_line SET match_status = 'adjusted', matched_ledger_entry_id = ? WHERE id = ?`, [ledgerEntryId, input.statementLineId]);
    await logSensitiveAction({
      actor_user_id: input.actorUserId, action_type: "BANK_RECONCILIATION_ADJUSTMENT_POSTED", module_key: "FINANCE",
      entity_type: "bank_account_ledger_entry", entity_id: ledgerEntryId,
      change_summary: { statement_line_id: input.statementLineId, debit, credit, narration: input.narration },
    }).catch(() => undefined);
    return { ledgerEntryId };
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/finance/__tests__/bank-reconciliation-match.service.test.ts`
Expected: PASS (6/6). If any assertion on exact SQL text fails, adjust the test's `expect.stringMatching` regex to match the implementation's actual query — don't change the query to fit the test.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/finance/bank-reconciliation-match.service.ts backend/src/modules/finance/__tests__/bank-reconciliation-match.service.test.ts
git commit -m "Bank Reconciliation Phase 4: matching engine (auto/manual match, unmatch, adjustments)"
```

---

### Task 4: Period lifecycle service (create, close with balance gate, reopen with supersession guard)

**Files:**
- Create: `backend/src/modules/finance/bank-reconciliation-period.service.ts`
- Test: `backend/src/modules/finance/__tests__/bank-reconciliation-period.service.test.ts`

**Interfaces:**
- Consumes: `db`, `logSensitiveAction`.
- Produces: `export class BankReconciliationPeriodError extends Error { statusCode: number }` and `export const bankReconciliationPeriodService = { create(bankAccountId: string, fromDate: string, toDate: string, actorUserId: string): Promise<{ id: string }>, close(periodId: string, statementClosingBalance: number, actorUserId: string): Promise<{ closed: true }>, reopen(periodId: string, reason: string, actorUserId: string): Promise<void>, getDetail(periodId: string): Promise<PeriodDetail> }` where `PeriodDetail` includes `status`, balances, and counts of matched/unmatched/adjusted lines.

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/modules/finance/__tests__/bank-reconciliation-period.service.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, logSensitiveAction } = vi.hoisted(() => ({
  execute: vi.fn(),
  logSensitiveAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));

import { bankReconciliationPeriodService, BankReconciliationPeriodError } from "../bank-reconciliation-period.service.js";

beforeEach(() => { execute.mockReset(); logSensitiveAction.mockClear(); });

describe("bankReconciliationPeriodService.close", () => {
  it("refuses to close while unmatched statement lines remain", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "period-1", bank_account_id: "acct-1", to_date: "2026-09-30", status: "open" }]]) // period lookup
      .mockResolvedValueOnce([[{ cnt: 3 }]]); // unmatched count
    await expect(bankReconciliationPeriodService.close("period-1", 100000, "actor-1")).rejects.toThrow(/unmatched/i);
  });

  it("refuses to close when the reconciliation formula doesn't balance, and reports the difference", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "period-1", bank_account_id: "acct-1", to_date: "2026-09-30", status: "open" }]])
      .mockResolvedValueOnce([[{ cnt: 0 }]]) // no unmatched lines
      .mockResolvedValueOnce([[{ running_balance: 95000 }]]) // computed closing balance
      .mockResolvedValueOnce([[{ total: 2000 }]]); // outstanding total
    // statement says 100000; computed(95000) - outstanding(2000) = 93000 != 100000 -> difference 7000
    await expect(bankReconciliationPeriodService.close("period-1", 100000, "actor-1")).rejects.toThrow(/7000|7,000/);
  });

  it("closes when the formula balances exactly, locks entries, and carries the balance forward", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "period-1", bank_account_id: "acct-1", to_date: "2026-09-30", status: "open" }]])
      .mockResolvedValueOnce([[{ cnt: 0 }]])
      .mockResolvedValueOnce([[{ running_balance: 95000 }]])
      .mockResolvedValueOnce([[{ total: 0 }]])
      // UPDATE period
      .mockResolvedValueOnce([{}])
      // UPDATE bank_account_ledger_entry (lock entries)
      .mockResolvedValueOnce([{}])
      // UPDATE company_bank_account (carry forward)
      .mockResolvedValueOnce([{}]);
    const result = await bankReconciliationPeriodService.close("period-1", 95000, "actor-1");
    expect(result).toEqual({ closed: true });
    expect(execute).toHaveBeenCalledWith(expect.stringMatching(/UPDATE company_bank_account/), [95000, "2026-09-30", "acct-1"]);
  });
});

describe("bankReconciliationPeriodService.reopen", () => {
  it("refuses when a later period for the same account is already closed", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "period-1", bank_account_id: "acct-1", to_date: "2026-08-31", status: "closed" }]])
      .mockResolvedValueOnce([[{ id: "period-2" }]]); // a later closed period exists
    await expect(bankReconciliationPeriodService.reopen("period-1", "found a mismatch", "actor-1")).rejects.toThrow(BankReconciliationPeriodError);
  });

  it("requires a reason", async () => {
    await expect(bankReconciliationPeriodService.reopen("period-1", "", "actor-1")).rejects.toThrow(/reason/i);
  });

  it("reopens and clears reconciliation_period_id off its entries when no later period is closed", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "period-1", bank_account_id: "acct-1", to_date: "2026-08-31", status: "closed" }]])
      .mockResolvedValueOnce([[]]) // no later closed period
      .mockResolvedValueOnce([{}]) // UPDATE bank_account_ledger_entry clear
      .mockResolvedValueOnce([{}]); // UPDATE period
    await bankReconciliationPeriodService.reopen("period-1", "found a mismatch", "actor-1");
    expect(logSensitiveAction).toHaveBeenCalledWith(expect.objectContaining({ action_type: "BANK_RECONCILIATION_PERIOD_REOPENED" }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/finance/__tests__/bank-reconciliation-period.service.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// backend/src/modules/finance/bank-reconciliation-period.service.ts
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

/**
 * Period lifecycle (Bank Reconciliation, Phase 4). close() enforces the classic reconciliation
 * formula — computed HRMS closing balance minus still-outstanding (unmatched, dated <= to_date)
 * entries must equal what the real bank statement says — and refuses with the exact difference
 * otherwise, so the accountant knows what to go investigate rather than being told "no" with no
 * number attached. reopen() refuses to reopen a period that a LATER period has already closed
 * over, because that would corrupt the forward opening-balance chain those later periods relied on.
 */

export class BankReconciliationPeriodError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export const bankReconciliationPeriodService = {
  async create(bankAccountId: string, fromDate: string, toDate: string, actorUserId: string): Promise<{ id: string }> {
    const [[account]] = await db.execute<RowDataPacket[]>(`SELECT opening_balance FROM company_bank_account WHERE id = ?`, [bankAccountId]);
    const [[openPeriod]] = await db.execute<RowDataPacket[]>(`SELECT id FROM bank_reconciliation_period WHERE bank_account_id = ? AND status = 'open'`, [bankAccountId]);
    if (openPeriod) throw new BankReconciliationPeriodError("This account already has an open reconciliation period. Close it before starting a new one.");
    const id = randomUUID();
    await db.execute(
      `INSERT INTO bank_reconciliation_period (id, bank_account_id, from_date, to_date, opening_balance, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, bankAccountId, fromDate, toDate, Number(account?.opening_balance ?? 0), actorUserId],
    );
    return { id };
  },

  async close(periodId: string, statementClosingBalance: number, actorUserId: string): Promise<{ closed: true }> {
    const [[period]] = await db.execute<RowDataPacket[]>(`SELECT id, bank_account_id, to_date, status FROM bank_reconciliation_period WHERE id = ?`, [periodId]);
    if (!period) throw new BankReconciliationPeriodError("Reconciliation period not found.", 404);
    if (period.status !== "open") throw new BankReconciliationPeriodError("Period is not open.");

    const [[unmatched]] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM bank_statement_line bsl JOIN bank_statement_import bsi ON bsi.id = bsl.import_id
        WHERE bsi.period_id = ? AND bsl.match_status = 'unmatched'`,
      [periodId],
    );
    if (Number(unmatched.cnt) > 0) throw new BankReconciliationPeriodError(`${unmatched.cnt} statement line(s) are still unmatched. Match or post them as adjustments before closing.`);

    const [[last]] = await db.execute<RowDataPacket[]>(
      `SELECT running_balance FROM bank_account_ledger_entry WHERE bank_account_id = ? AND entry_date <= ? ORDER BY entry_date DESC, created_at DESC, id DESC LIMIT 1`,
      [period.bank_account_id, period.to_date],
    );
    const computedClosingBalance = round2(Number(last?.running_balance ?? 0));

    const [[outstanding]] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(credit_amount - debit_amount), 0) AS total FROM bank_account_ledger_entry
        WHERE bank_account_id = ? AND entry_date <= ? AND matched_statement_line_id IS NULL`,
      [period.bank_account_id, period.to_date],
    );
    const outstandingTotal = round2(Number(outstanding.total));

    const expectedStatementBalance = round2(computedClosingBalance - outstandingTotal);
    const difference = round2(expectedStatementBalance - round2(statementClosingBalance));
    if (difference !== 0) {
      throw new BankReconciliationPeriodError(
        `Doesn't balance: HRMS says ₹${expectedStatementBalance} after outstanding items, statement says ₹${round2(statementClosingBalance)} — difference of ₹${Math.abs(difference)}.`,
      );
    }

    await db.execute(
      `UPDATE bank_reconciliation_period SET status = 'closed', statement_closing_balance = ?, computed_closing_balance = ?, outstanding_total = ?, closed_by = ?, closed_at = NOW() WHERE id = ?`,
      [round2(statementClosingBalance), computedClosingBalance, outstandingTotal, actorUserId, periodId],
    );
    await db.execute(
      `UPDATE bank_account_ledger_entry SET reconciliation_period_id = ?
        WHERE bank_account_id = ? AND entry_date <= ? AND matched_statement_line_id IS NOT NULL AND reconciliation_period_id IS NULL`,
      [periodId, period.bank_account_id, period.to_date],
    );
    await db.execute(
      `UPDATE company_bank_account SET opening_balance = ?, opening_balance_as_of = ? WHERE id = ?`,
      [round2(statementClosingBalance), period.to_date, period.bank_account_id],
    );
    await logSensitiveAction({
      actor_user_id: actorUserId, action_type: "BANK_RECONCILIATION_PERIOD_CLOSED", module_key: "FINANCE",
      entity_type: "bank_reconciliation_period", entity_id: periodId,
      change_summary: { computed_closing_balance: computedClosingBalance, outstanding_total: outstandingTotal, statement_closing_balance: round2(statementClosingBalance) },
    }).catch(() => undefined);
    return { closed: true };
  },

  async reopen(periodId: string, reason: string, actorUserId: string): Promise<void> {
    if (!reason || !reason.trim()) throw new BankReconciliationPeriodError("A reason is required to reopen a closed period.");
    const [[period]] = await db.execute<RowDataPacket[]>(`SELECT id, bank_account_id, to_date, status FROM bank_reconciliation_period WHERE id = ?`, [periodId]);
    if (!period) throw new BankReconciliationPeriodError("Reconciliation period not found.", 404);
    if (period.status !== "closed") throw new BankReconciliationPeriodError("Period is not closed.");

    const [laterClosed] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM bank_reconciliation_period WHERE bank_account_id = ? AND status = 'closed' AND from_date > ? LIMIT 1`,
      [period.bank_account_id, period.to_date],
    );
    if ((laterClosed as RowDataPacket[]).length > 0) {
      throw new BankReconciliationPeriodError("A later period for this account is already closed. Reopen that one first.");
    }

    await db.execute(`UPDATE bank_account_ledger_entry SET reconciliation_period_id = NULL WHERE reconciliation_period_id = ?`, [periodId]);
    await db.execute(
      `UPDATE bank_reconciliation_period SET status = 'open', reopened_by = ?, reopened_at = NOW(), reopen_reason = ? WHERE id = ?`,
      [actorUserId, reason.trim(), periodId],
    );
    await logSensitiveAction({
      actor_user_id: actorUserId, action_type: "BANK_RECONCILIATION_PERIOD_REOPENED", module_key: "FINANCE",
      entity_type: "bank_reconciliation_period", entity_id: periodId, change_summary: { reason: reason.trim() },
    }).catch(() => undefined);
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/finance/__tests__/bank-reconciliation-period.service.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/finance/bank-reconciliation-period.service.ts backend/src/modules/finance/__tests__/bank-reconciliation-period.service.test.ts
git commit -m "Bank Reconciliation Phase 4: period close (balance-formula gate) and reopen (supersession guard)"
```

---

### Task 5: Routes + app.ts mount + page access migration

**Files:**
- Create: `backend/src/modules/finance/bank-reconciliation.routes.ts`
- Create: `backend/sql/1712_bank_reconciliation_page_access.sql`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: `bankStatementImportService`, `bankReconciliationMatchService`, `bankReconciliationPeriodService`, `BANK_ACCOUNT_READ_ROLES`/`BANK_ACCOUNT_WRITE_ROLES` from `company-bank-account.routes.js`.
- Produces: `export const bankReconciliationRouter: Router`, mounted at `/api/finance/bank-reconciliation`.

- [ ] **Step 1: Write `bank-reconciliation.routes.ts`**

```typescript
// backend/src/modules/finance/bank-reconciliation.routes.ts
import { Router } from "express";
import multer from "multer";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { BANK_ACCOUNT_READ_ROLES, BANK_ACCOUNT_WRITE_ROLES } from "./company-bank-account.routes.js";
import { bankStatementImportService, type ColumnMapping } from "./bank-statement-import.service.js";
import { bankReconciliationMatchService, BankReconciliationMatchError } from "./bank-reconciliation-match.service.js";
import { bankReconciliationPeriodService, BankReconciliationPeriodError } from "./bank-reconciliation-period.service.js";

export const bankReconciliationRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function actor(req: AuthenticatedRequest) {
  return { id: req.user!.id, role: req.user!.role };
}
function h(fn: (req: AuthenticatedRequest, res: any) => Promise<void>) {
  return async (req: any, res: any) => {
    try { await fn(req, res); }
    catch (err) {
      const status = (err as any)?.statusCode ?? 500;
      res.status(status).json({ success: false, message: err instanceof Error ? err.message : "Unexpected error" });
    }
  };
}

bankReconciliationRouter.use(requireAuth);

// List periods for a bank account
bankReconciliationRouter.get("/periods", requireRole(...BANK_ACCOUNT_READ_ROLES), h(async (req, res) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM bank_reconciliation_period WHERE bank_account_id = ? ORDER BY from_date DESC`,
    [String(req.query.bankAccountId)],
  );
  res.json({ success: true, data: rows });
}));

// Create a new open period
bankReconciliationRouter.post("/periods", requireRole(...BANK_ACCOUNT_WRITE_ROLES), h(async (req, res) => {
  const { bankAccountId, fromDate, toDate } = req.body;
  const result = await bankReconciliationPeriodService.create(bankAccountId, fromDate, toDate, actor(req).id);
  res.status(201).json({ success: true, data: result });
}));

// Upload + parse a statement into a period, auto-match immediately
bankReconciliationRouter.post("/periods/:periodId/statements", requireRole(...BANK_ACCOUNT_WRITE_ROLES), upload.single("file"), h(async (req, res) => {
  if (!req.file) { res.status(400).json({ success: false, message: "No file uploaded." }); return; }
  const bankAccountId = String(req.body.bankAccountId);
  const mapping: ColumnMapping = JSON.parse(req.body.columnMapping);
  const { headers, rows } = bankStatementImportService.parseWorkbook(req.file.buffer);
  const { parseStatementRows } = await import("./bank-statement-import.service.js");
  const lines = parseStatementRows(headers, rows, mapping);
  const saved = await bankStatementImportService.saveImport(bankAccountId, req.params.periodId, req.file.originalname, mapping, lines, actor(req).id);
  const matchResult = await bankReconciliationMatchService.autoMatch(saved.importId);
  res.status(201).json({ success: true, data: { ...saved, ...matchResult } });
}));

bankReconciliationRouter.post("/statement-lines/:lineId/match", requireRole(...BANK_ACCOUNT_WRITE_ROLES), h(async (req, res) => {
  await bankReconciliationMatchService.manualMatch(req.params.lineId, String(req.body.ledgerEntryId), actor(req).id);
  res.json({ success: true });
}));

bankReconciliationRouter.post("/statement-lines/:lineId/unmatch", requireRole(...BANK_ACCOUNT_WRITE_ROLES), h(async (req, res) => {
  await bankReconciliationMatchService.unmatch(req.params.lineId, actor(req).id);
  res.json({ success: true });
}));

bankReconciliationRouter.post("/statement-lines/:lineId/adjustment", requireRole(...BANK_ACCOUNT_WRITE_ROLES), h(async (req, res) => {
  const { bankAccountId, payableAccountId, narration } = req.body;
  const result = await bankReconciliationMatchService.postAdjustment({ statementLineId: req.params.lineId, bankAccountId, payableAccountId, narration, actorUserId: actor(req).id });
  res.json({ success: true, data: result });
}));

bankReconciliationRouter.post("/periods/:periodId/close", requireRole(...BANK_ACCOUNT_WRITE_ROLES), h(async (req, res) => {
  const result = await bankReconciliationPeriodService.close(req.params.periodId, Number(req.body.statementClosingBalance), actor(req).id);
  res.json({ success: true, data: result });
}));

bankReconciliationRouter.post("/periods/:periodId/reopen", requireRole(...BANK_ACCOUNT_WRITE_ROLES), h(async (req, res) => {
  await bankReconciliationPeriodService.reopen(req.params.periodId, String(req.body.reason ?? ""), actor(req).id);
  res.json({ success: true });
}));
```

- [ ] **Step 2: Write `1712_bank_reconciliation_page_access.sql`** (follows the exact `1707` pattern)

```sql
-- 1712_bank_reconciliation_page_access.sql
--
-- Payment Voucher System Phase 4. Registers /finance/bank-reconciliation. accounts_head gets
-- create/edit (upload, match, close); other finance roles are view-only, matching 1707's
-- pattern for the sibling Bank Ledger page.
INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES (
  'FINANCE_BANK_RECONCILIATION', 'Bank Reconciliation', '/finance/bank-reconciliation', 'finance',
  'Match released vouchers against the real bank statement, post adjustments, and close periods so the Tally export can go final.', 1
)
ON DUPLICATE KEY UPDATE page_name = VALUES(page_name), page_path = VALUES(page_path), module = VALUES(module), description = VALUES(description), active_status = VALUES(active_status);

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',   'FINANCE_BANK_RECONCILIATION', 1, 1, 1, 0, 1, 1),
  (UUID(), 'accounts_head', 'FINANCE_BANK_RECONCILIATION', 1, 1, 1, 0, 1, 1),
  (UUID(), 'finance_head',  'FINANCE_BANK_RECONCILIATION', 1, 0, 0, 0, 1, 1),
  (UUID(), 'ceo',           'FINANCE_BANK_RECONCILIATION', 1, 0, 0, 0, 1, 1),
  (UUID(), 'admin',         'FINANCE_BANK_RECONCILIATION', 1, 0, 0, 0, 1, 1),
  (UUID(), 'finance',       'FINANCE_BANK_RECONCILIATION', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE can_view = VALUES(can_view), can_create = VALUES(can_create), can_edit = VALUES(can_edit), can_export = VALUES(can_export), active_status = VALUES(active_status);

SELECT '1712_bank_reconciliation_page_access.sql applied' AS migration_status;

-- Rollback:
--   UPDATE role_page_access SET active_status = 0 WHERE page_code = 'FINANCE_BANK_RECONCILIATION';
--   UPDATE page_catalog     SET active_status = 0 WHERE page_code = 'FINANCE_BANK_RECONCILIATION';
```

- [ ] **Step 3: Mount the router in `backend/src/app.ts`**

Add near the other finance imports (after the `companyBankAccountRouter` import, `backend/src/app.ts:259`):
```typescript
import { bankReconciliationRouter } from "./modules/finance/bank-reconciliation.routes.js";
```
Add near `app.use("/api/finance/bank-accounts", companyBankAccountRouter);` (`backend/src/app.ts:642`):
```typescript
app.use("/api/finance/bank-reconciliation", bankReconciliationRouter);
```

- [ ] **Step 4: Apply the migration and typecheck**

```bash
mysql -u "$DB_USER" -p"$DB_PASSWORD" -h "$DB_HOST" "$DB_NAME" < backend/sql/1712_bank_reconciliation_page_access.sql
cd backend && npx tsc --noEmit 2>&1 | grep -i "bank-reconciliation"
```
Expected: `... applied` status row; no tsc output (clean).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/finance/bank-reconciliation.routes.ts backend/sql/1712_bank_reconciliation_page_access.sql backend/src/app.ts
git commit -m "Bank Reconciliation Phase 4: routes, page access, mount in app.ts"
```

---

### Task 6: Flip Tally export `isFinal` to a real derivation

**Files:**
- Modify: `backend/src/modules/finance/tally-export.service.ts`
- Modify: `backend/src/modules/finance/__tests__/tally-export.service.test.ts`

**Interfaces:**
- Consumes: `bank_account_ledger_entry.reconciliation_period_id` (Task 1), `bank_reconciliation_period.status` (Task 1).
- Produces: `buildEnvelope`'s returned `isFinal` now reflects real data instead of a hardcoded `false`. `buildVoucherXml`'s signature and the existing sign-convention tests are untouched.

- [ ] **Step 1: Add the failing `isFinal` test**

Add to `backend/src/modules/finance/__tests__/tally-export.service.test.ts` (new `describe` block, existing `buildVoucherXml` tests stay as-is):

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn().mockResolvedValue(undefined) }));

// (keep the existing `import { buildVoucherXml, ... } from "../tally-export.service.js";` import,
//  add this one alongside it)
import { tallyExportService } from "../tally-export.service.js";

beforeEach(() => execute.mockReset());

describe("tallyExportService.buildEnvelope isFinal", () => {
  it("is false when there are no rows at all", async () => {
    execute.mockResolvedValueOnce([[]]);
    const result = await tallyExportService.buildEnvelope("acct-1");
    expect(result.isFinal).toBe(false);
  });

  it("is true only when every returned row's period is closed", async () => {
    execute.mockResolvedValueOnce([[
      { voucher_id: "v1", voucher_number: "PV1", voucher_type: "payment", entry_date: "2026-09-01", narration: "n", bank_ledger: "Bank", party_ledger: "Party", debit_amount: 1000, credit_amount: 0, tds_deducted_amount: 0, period_status: "closed" },
      { voucher_id: "v2", voucher_number: "PV2", voucher_type: "payment", entry_date: "2026-09-02", narration: "n", bank_ledger: "Bank", party_ledger: "Party", debit_amount: 2000, credit_amount: 0, tds_deducted_amount: 0, period_status: "closed" },
    ]]);
    const result = await tallyExportService.buildEnvelope("acct-1");
    expect(result.isFinal).toBe(true);
  });

  it("is false when the range mixes a closed and a still-open period", async () => {
    execute.mockResolvedValueOnce([[
      { voucher_id: "v1", voucher_number: "PV1", voucher_type: "payment", entry_date: "2026-09-01", narration: "n", bank_ledger: "Bank", party_ledger: "Party", debit_amount: 1000, credit_amount: 0, tds_deducted_amount: 0, period_status: "closed" },
      { voucher_id: "v2", voucher_number: "PV2", voucher_type: "payment", entry_date: "2026-09-15", narration: "n", bank_ledger: "Bank", party_ledger: "Party", debit_amount: 2000, credit_amount: 0, tds_deducted_amount: 0, period_status: null },
    ]]);
    const result = await tallyExportService.buildEnvelope("acct-1");
    expect(result.isFinal).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/finance/__tests__/tally-export.service.test.ts`
Expected: FAIL — the new tests (`isFinal` always false today regardless of `period_status`), the 5 original sign-convention tests still PASS.

- [ ] **Step 3: Update `fetchVoucherRows`'s query and `buildEnvelope`'s `isFinal`**

In `backend/src/modules/finance/tally-export.service.ts`, modify the `fetchVoucherRows` SQL (existing query around line 72) to also select `period_status`:

```typescript
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT bale.voucher_id, pv.voucher_number, pv.voucher_type, bale.entry_date, bale.narration,
            cba.tally_ledger_name AS bank_ledger, pam.tally_ledger_name AS party_ledger,
            bale.debit_amount, bale.credit_amount,
            vpt.tds_deducted_amount,
            brp.status AS period_status
       FROM bank_account_ledger_entry bale
       JOIN payment_voucher pv ON pv.id = bale.voucher_id
       JOIN company_bank_account cba ON cba.id = bale.bank_account_id
       JOIN payable_account_master pam ON pam.id = bale.payable_account_id
       LEFT JOIN vendor_payment_tracking vpt ON vpt.id = pv.linked_vendor_payment_id
       LEFT JOIN bank_reconciliation_period brp ON brp.id = bale.reconciliation_period_id
      WHERE ${conditions.join(" AND ")} AND (bale.debit_amount > 0 OR bale.credit_amount > 0)
      ORDER BY bale.entry_date ASC, bale.created_at ASC`,
    params,
  );
```

Add `period_status: string | null` to `VoucherExportRow` and thread it through the `result.push({...})` block (`period_status: row.period_status ? String(row.period_status) : null,`).

Replace the `buildEnvelope` body's `isFinal` line:
```typescript
    const isFinal = rows.length > 0 && rows.every((r) => r.period_status === "closed");
```
And update the watermark condition (already `isFinal ? "" : "..."` — no change needed there, it now reacts to the real value). Update the module header comment's "Phase 4 wires this to..." sentence to state it's now wired, and update the `buildEnvelope` docstring similarly (remove "always false in this phase").

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/finance/__tests__/tally-export.service.test.ts`
Expected: PASS (8/8 — 5 original + 3 new).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/finance/tally-export.service.ts backend/src/modules/finance/__tests__/tally-export.service.test.ts
git commit -m "Bank Reconciliation Phase 4: Tally export isFinal now derives from closed reconciliation periods"
```

---

### Task 7: Frontend — Bank Reconciliation page

**Files:**
- Create: `src/pages/finance/BankReconciliationPage.tsx`
- Modify: `src/config/routes/finance.routes.tsx`
- Modify: `src/components/layout/navConfig.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/finance/bank-reconciliation/periods`, `POST /api/finance/bank-reconciliation/periods/:id/statements`, `POST /api/finance/bank-reconciliation/statement-lines/:id/match|unmatch|adjustment`, `POST /api/finance/bank-reconciliation/periods/:id/close|reopen` (Task 5). `GET /api/finance/bank-accounts` (existing, used by `BankLedgerReportPage.tsx`).

- [ ] **Step 1: Run the mandatory UI/UX design search before building**

```bash
"C:/Users/ADMIN/AppData/Local/Programs/Python/Python312/python.exe" "C:/Users/ADMIN/.claude/skills/ui-ux-pro-max/scripts/search.py" "bank reconciliation workflow page, statement upload, match/unmatch table, closing balance summary card" --design-system --stack shadcn -p "MAS PeopleOS"
```
Apply whatever pattern guidance it returns (spacing, card treatment, status badges) consistently with `BankLedgerReportPage.tsx`'s existing blue-gradient-header style.

- [ ] **Step 2: Build the page**

Follow `BankLedgerReportPage.tsx`'s exact conventions: `useQuery`/`useMutation` from `@tanstack/react-query`, `hrmsApi` for calls, `Select`/`SelectContent`/`SelectItem` (never free text) for bank account and period pickers, `money()`/date formatting helpers copied from that file, `useToast` for errors. Structure:

- Header card (blue gradient, matching `BankLedgerReportPage`): title, bank-account `Select`, period `Select` (open/closed periods for that account) + "Start New Period" button opening a small dialog with from/to date `Input type="date"` (pre-filled: from = day after the account's latest period's `to_date`).
- Within an open period: file upload (`Input type="file"`, accepts `.csv,.xlsx,.xls`) → on first upload for an account, a column-mapping step (`Select` per field, populated from the parsed header row) → "Upload & Auto-Match" button → result banner ("42 of 50 auto-matched").
- Two tables: **Unmatched Statement Lines** (Match / Post Adjustment row actions — "Match" opens a `Dialog` listing candidate ledger entries as a `Select`; "Post Adjustment" opens a `Dialog` with a `payable_account_master` `Select` + narration `Input`) and **Outstanding HRMS Entries** (read-only).
- **Reconciliation Summary** card: statement closing balance `Input type="number"`, computed closing balance (display), outstanding total (display), live difference (display, red if non-zero), "Close Period" `Button` disabled unless difference is exactly zero and there are no unmatched lines.
- **History** tab: table of past periods for the account; row click opens a right-side `Sheet` drawer (per the project's Drill-Down Mandate: `max-w-2xl`, full height, scrollable) showing full period detail, matched/unmatched/adjusted counts, statement import metadata, and — on closed periods — a "Reopen" button (only enabled on the most recently closed period; a `Textarea` for the mandatory reason inside a confirm `AlertDialog`).

Every monetary value formatted via the same `money()` helper pattern as `BankLedgerReportPage.tsx`; dates as `DD/MM/YYYY`.

- [ ] **Step 3: Register the route**

In `src/config/routes/finance.routes.tsx`, alongside the existing `BankLedgerReportPage` line (`:38`):
```typescript
const BankReconciliationPage      = lazy(() => import("@/pages/finance/BankReconciliationPage"));
```
Alongside the existing `/finance/bank-ledger` route (`:74`):
```tsx
<Route path="/finance/bank-reconciliation" element={<ProtectedRoute roles={['super_admin','finance_head','accounts_head','ceo','admin','finance']}><Gate pageCode="FINANCE_BANK_RECONCILIATION"><BankReconciliationPage /></Gate></ProtectedRoute>} />
```

- [ ] **Step 4: Register the nav entry**

In `src/components/layout/navConfig.tsx`, alongside the existing Bank Ledger entry (`:423`):
```typescript
{ label: "Bank Reconciliation", href: "/finance/bank-reconciliation", icon: ic(Landmark), pageCode: "FINANCE_BANK_RECONCILIATION", description: "Match statements, post adjustments, close periods", roles: ["super_admin","finance_head","accounts_head","ceo","admin","finance"] },
```
(Reuse whatever icon import `BankLedgerReportPage.tsx` already uses — `Landmark` — confirm it's already imported in `navConfig.tsx`; if not, add it to the existing `lucide-react` import line.)

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | grep -i "BankReconciliationPage\|finance.routes\|navConfig"
```
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add src/pages/finance/BankReconciliationPage.tsx src/config/routes/finance.routes.tsx src/components/layout/navConfig.tsx
git commit -m "Bank Reconciliation Phase 4: BankReconciliationPage UI, route, and nav entry"
```

---

### Task 8: End-to-end manual verification (mandatory before calling this done)

**Files:** none created — verification only, per this project's non-negotiable pre-handover checklist.

- [ ] **Step 1: Full backend test suite for the finance module**

```bash
cd backend && npx vitest run src/modules/finance/__tests__/
```
Expected: all tests pass, including the 6 new/modified files from Tasks 2-4 and 6.

- [ ] **Step 2: Full typecheck, both sides**

```bash
cd backend && npx tsc --noEmit 2>&1 | grep -iE "bank-reconciliation|tally-export" 
cd .. && npx tsc --noEmit -p . 2>&1 | grep -i "BankReconciliation"
```
Expected: no output from either.

- [ ] **Step 3: Live-DB smoke test of the create → upload → match → close cycle**

Using a short one-off script (repo convention, e.g. `backend/scripts/_tmp_verify_bank_recon.mjs`) or direct `mysql` calls per `CLAUDE.md`'s DB rule:
1. Confirm at least one `company_bank_account` row and a few `bank_account_ledger_entry` rows exist to reconcile against (reuse existing Phase 1-3 data).
2. `POST /api/finance/bank-reconciliation/periods` for that account with a small date range.
3. Build a tiny 2-3 row CSV in-memory matching known ledger entries' dates/amounts and `POST` it to `/periods/:id/statements` with a column mapping.
4. Confirm the response's `matchedCount` reflects the known overlaps.
5. `POST /periods/:id/close` with the correct statement closing balance (computed from the same query the service uses) and confirm `{ closed: true }`.
6. Query `bank_account_ledger_entry` directly to confirm `reconciliation_period_id` is now set on the matched rows, and `company_bank_account.opening_balance` was updated.
7. `GET /api/finance/bank-accounts/:id/tally-export` for that same range and confirm the `X-Tally-Export-Final` response header is now `true`.

- [ ] **Step 4: Delete the temporary verification script**

```bash
rm -f backend/scripts/_tmp_verify_bank_recon.mjs
```
(Untracked scratch files stay untracked per this repo's existing convention of `_tmp*`/`_diag*` scripts — no commit needed for this step.)

- [ ] **Step 5: Report results**

State plainly which of the checklist items passed, paste the actual command output (not a paraphrase), and flag anything that didn't verify cleanly rather than calling the phase done.

---

## Self-Review Notes

- **Spec coverage:** Data model → Task 1. Matching engine + adjustments → Task 3. Close/reopen + balance gate → Task 4. Tally `isFinal` → Task 6. UI → Task 7. Testing plan → Tasks 2-4, 6, 8. Out-of-scope items (multi-currency, bank-feed API, cash-in-hand, maker-checker on close) are correctly absent from every task.
- **Type consistency checked:** `ColumnMapping`/`ParsedStatementLine` (Task 2) are the exact types Task 5's routes import and use (`JSON.parse(req.body.columnMapping)` typed as `ColumnMapping`). `BankReconciliationMatchError`/`BankReconciliationPeriodError` names match between their defining tasks (3, 4) and the routes file that imports them (5). `bank_account_ledger_entry.matched_statement_line_id`/`reconciliation_period_id` (Task 1) are the exact column names Tasks 3, 4, and 6 read/write.
- **Placeholder scan:** none found — every step has real code, real commands, or a real verification procedure.
