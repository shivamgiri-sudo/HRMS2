# Client Billing Credit Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff issue a credit note against an already-approved `client_invoice`, with a real unique `credit_no` — fixing legacy's confirmed date-stamp collision bug — and a simple draft→approved lifecycle.

**Architecture:** Extends the existing numbering service with a third `kind` (`'credit_note'`), reusing the exact atomic counter already fixed twice this session. Two new services (`createCreditNote`, `approveCreditNote`) follow the exact transactional pattern already proven in `client-billing.service.ts`/`client-billing-approval.service.ts`. Two new tables, four new routes.

**Tech Stack:** Express + TypeScript, mysql2, vitest, MySQL 8 (`mas_hrms`).

## Global Constraints

- New tables: `COLLATE=utf8mb4_unicode_ci` at the table level, `IF NOT EXISTS`, no surrogate `AUTO_INCREMENT` id.
- Migration registered in BOTH `runPendingMigrations.ts`'s `MIGRATION_MANIFEST` array (the real runtime source) AND the regenerated lock file (`node backend/scripts/update-migration-lock.mjs --write`, never hand-edited).
- Every route: `requireAuth` + explicit `requireRole(...ALLOWED_ROLES)` (reuse the existing constant from `client-billing.routes.ts`).
- All mutating routes `POST` only.
- Errors: `throw Object.assign(new Error("message"), { statusCode: 400 })` — no route-local try/catch masking unexpected failures.
- DB access via `db.getConnection()` for transactional work; never mix pool-level `db.execute` with an open transaction's `conn`.
- **Verify every new SQL statement against a real MySQL 8 connection before considering a task done** — not only the mocked test suite. Connection: host `192.168.10.6` (fallback `122.184.128.90`), port `3306`, user `shivam_user`, password **read from `backend/.env`'s `DB_PASSWORD` — never paste the literal value into any file that will be committed** (a real credential shipped in plaintext in an earlier plan doc this session, found and scrubbed by an independent audit; do not reintroduce it). Database `mas_hrms`. Never write to any real (non-throwaway, non-`x_`-prefixed) table.
- Migration file numbered `NNN_description.sql` under `backend/sql/migrations/` — check `ls backend/sql/migrations/*.sql | grep -oE '[0-9]+' | sort -n | tail -3` AND `ls backend/sql/*.sql | grep -oE '^[0-9]+' | sort -n | tail -3` immediately before picking a number; start by trying `1302` but re-verify it's free (this repo has many concurrent sessions, numbers have collided before on this exact feature).

---

## File Structure

- `backend/sql/migrations/1302_client_billing_credit_notes.sql` (or next free number) — 2 new tables.
- `backend/src/db/runPendingMigrations.ts` — modified, one new array entry.
- `backend/sql/MIGRATION_MANIFEST.lock.json` — regenerated.
- `backend/src/modules/client-billing/client-billing-numbering.service.ts` — modified, add `mintCreditNoteNumber`.
- `backend/src/modules/client-billing/__tests__/client-billing-numbering.service.test.ts` — modified, tests for the new method.
- `backend/src/modules/client-billing/client-billing-credit-note.service.ts` — new, `createCreditNote`, `approveCreditNote`.
- `backend/src/modules/client-billing/__tests__/client-billing-credit-note.service.test.ts` — new.
- `backend/src/modules/client-billing/client-billing.routes.ts` — modified, 4 new routes.
- `backend/src/modules/client-billing/__tests__/client-billing.routes.test.ts` — modified.

---

### Task 1: Schema migration + numbering extension

**Files:**
- Create: `backend/sql/migrations/1302_client_billing_credit_notes.sql` (verify number free first)
- Modify: `backend/src/db/runPendingMigrations.ts`, `backend/sql/MIGRATION_MANIFEST.lock.json` (regenerated)
- Modify: `backend/src/modules/client-billing/client-billing-numbering.service.ts`, its test file

**Interfaces:**
- Produces: tables `client_credit_note(id, invoice_id, cost_centre_id, category, finance_year, month_label, credit_date, description, credit_no, credit_status, gst_type, apply_gst, total_amount, igst_amount, cgst_amount, sgst_amount, grand_total, approved_by, approved_at, created_by, created_at)`, `client_credit_note_line(id, credit_note_id, particulars, qty, rate, amount)`. `clientBillingNumberingService.mintCreditNoteNumber(stateCode: string, companyName: string, financeYear: string): Promise<string>` — Task 2 consumes this and the table column names directly.

- [ ] **Step 1: Verify the migration number is free**

Run:
```bash
cd backend
ls sql/migrations/*.sql | grep -oE '[0-9]+' | sort -n | tail -3
ls sql/*.sql | grep -oE '^[0-9]+_' | grep -oE '^[0-9]+' | sort -n | tail -3
```
If `1302` is taken, use the next free integer throughout this task.

- [ ] **Step 2: Write the migration file**

```sql
-- 1302_client_billing_credit_notes.sql
--
-- Credit-note schema for the client-billing replica (docs/superpowers/specs/2026-08-19-client-billing-credit-notes-design.md).
-- Two new tables. Does not touch client_invoice, client_invoice_line, client_invoice_number_sequence,
-- cost_centre_master, or any db_bill/billing_invoice/billing_*_snapshot table.
--
-- ── Why ─────────────────────────────────────────────────────────────────────────────────
-- Legacy's tbl_credit_note.credit_no is a DD-MM/FY-FY date stamp, not a sequence — confirmed
-- live to collide: db_bill ids 163 and 164, both created 2026-08-18, both carry
-- credit_no='18-08/26-27'. client_credit_note.credit_no is minted via the numbering service's
-- atomic counter (same fix already applied twice this session for invoice numbering), format
-- CN-<stateCode>-<NN>/<FYshort>, scoped per (stateCode, companyName, financeYear).
--
-- invoice_id is a real FK to client_invoice, replacing legacy's proforma_bill_no column, which
-- despite its name actually stores the referenced invoice's real bill number (confirmed live:
-- values like "09-155/26-27", "09-213/26-27" — bill-number shaped, not proforma-number shaped).
--
-- ── Safety ──────────────────────────────────────────────────────────────────────────────
-- Pure CREATE TABLE. Table-level COLLATE=utf8mb4_unicode_ci throughout (the foundation phase's
-- collation incident), no surrogate AUTO_INCREMENT id on either table (neither needs upsert
-- semantics — the numbering-service incident), IF NOT EXISTS on both (the reserved-word/
-- idempotency incident). Every statement in this file was verified against a live MySQL 8
-- connection before this file was committed — see this task's own verification step.
--
-- Rollback: DROP TABLE client_credit_note_line; DROP TABLE client_credit_note;
--
-- ── Deployment ──────────────────────────────────────────────────────────────────────────
-- Registering this file in runPendingMigrations.ts's MIGRATION_MANIFEST array (and
-- regenerating the lock file) applies it at the next pm2 restart — do that only with explicit
-- user sign-off, per CLAUDE.md's migration-approval rule.

CREATE TABLE IF NOT EXISTS client_credit_note (
  id               CHAR(36)      NOT NULL PRIMARY KEY,
  invoice_id       CHAR(36)      NOT NULL,
  cost_centre_id   CHAR(36)      NOT NULL,
  category         VARCHAR(50)   NOT NULL,
  finance_year     VARCHAR(10)   NOT NULL,
  month_label      VARCHAR(10)   NOT NULL,
  credit_date      DATE          NOT NULL,
  description      VARCHAR(255)  NULL,
  credit_no        VARCHAR(40)   NULL,
  credit_status    ENUM('draft','approved') NOT NULL DEFAULT 'draft',
  gst_type         VARCHAR(20)   NOT NULL,
  apply_gst        TINYINT(1)    NOT NULL DEFAULT 1,
  total_amount     DECIMAL(14,2) NOT NULL DEFAULT 0,
  igst_amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  cgst_amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  sgst_amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  grand_total      DECIMAL(14,2) NOT NULL DEFAULT 0,
  approved_by      CHAR(36)      NULL,
  approved_at      DATETIME      NULL,
  created_by       CHAR(36)      NOT NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ccn_invoice (invoice_id),
  KEY idx_ccn_cost_centre (cost_centre_id),
  KEY idx_ccn_credit_no (credit_no),
  CONSTRAINT fk_ccn_invoice FOREIGN KEY (invoice_id) REFERENCES client_invoice(id),
  CONSTRAINT fk_ccn_cost_centre FOREIGN KEY (cost_centre_id) REFERENCES cost_centre_master(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_credit_note_line (
  id              CHAR(36)      NOT NULL PRIMARY KEY,
  credit_note_id  CHAR(36)      NOT NULL,
  particulars     VARCHAR(255)  NOT NULL,
  qty             DECIMAL(10,2) NOT NULL DEFAULT 1,
  rate            DECIMAL(14,2) NOT NULL,
  amount          DECIMAL(14,2) NOT NULL,
  KEY idx_ccnl_credit_note (credit_note_id),
  CONSTRAINT fk_ccnl_credit_note FOREIGN KEY (credit_note_id) REFERENCES client_credit_note(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 3: Verify both CREATE TABLE statements parse against live MySQL**

Run from `backend/` (this reads the password from `.env` rather than hardcoding it — read the file yourself with the `Read` tool or `dotenv`, do not paste the literal value into any script you might commit):
```bash
node -e "
import('dotenv').then(async (dotenv) => {
  dotenv.config();
  const m = await import('mysql2/promise');
  const conn = await m.createConnection({host: process.env.DB_HOST || '192.168.10.6', port: 3306, user: 'shivam_user', password: process.env.DB_PASSWORD, database: 'mas_hrms', connectTimeout: 15000});
  const fs = await import('fs');
  const sql = fs.readFileSync('sql/migrations/1302_client_billing_credit_notes.sql', 'utf8');
  const statements = sql.split(/;\s*\n/).map(s => s.trim()).filter(s => /CREATE TABLE/.test(s));
  console.log('statements found:', statements.length, '(expect 2 — if fewer, a comment-block semicolon ate one; verify by counting CREATE TABLE occurrences in the raw file with grep -c \"CREATE TABLE IF NOT EXISTS\" first and reconcile before trusting this count)');
  for (const stmt of statements) {
    const nameMatch = stmt.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
    if (!nameMatch) { console.log('SKIPPED (no CREATE TABLE match in this chunk):', stmt.slice(0,60)); continue; }
    const name = nameMatch[1];
    const testStmt = stmt.replace(name, 'x_parse_' + name) + (stmt.endsWith(';') ? '' : ';');
    try {
      await conn.query('PREPARE p FROM ?', [testStmt]);
      await conn.query('DEALLOCATE PREPARE p');
      console.log('OK:', name);
    } catch (e) {
      console.log('FAILED:', name, '-', e.message);
    }
  }
  await conn.end();
});
"
```
Expected: 2 statements found, `OK: client_credit_note`, `OK: client_credit_note_line`. **Cross-check the "statements found" count against `grep -c "CREATE TABLE IF NOT EXISTS" sql/migrations/1302_client_billing_credit_notes.sql`** (should be 2) — a prior migration in this same plan family had a header-comment semicolon silently swallow one statement from this exact splitting approach, so don't trust "2 found" without this cross-check.

- [ ] **Step 4: Register in runPendingMigrations.ts and regenerate the lock**

Re-read `backend/src/db/runPendingMigrations.ts` fresh (shared file). Append to the `MIGRATION_MANIFEST` array:
```typescript
"migrations/1302_client_billing_credit_notes.sql",
```
Then: `node backend/scripts/update-migration-lock.mjs --write`. Confirm the regenerated lock file contains this entry.

- [ ] **Step 5: Add mintCreditNoteNumber to the numbering service**

Read the current full content of `backend/src/modules/client-billing/client-billing-numbering.service.ts` first (it may have changed since this plan was written). Change the `nextSequenceValue` function's `kind` parameter type from `"proforma" | "bill"` to `"proforma" | "bill" | "credit_note"`, then add this function and export it:

```typescript
/**
 * New format (fixes a confirmed legacy bug: db_bill's credit_no is a DD-MM/FY-FY date stamp
 * that collides whenever two credit notes are issued the same day — proven live, ids 163/164
 * both carry "18-08/26-27"). CN-<state_code>-<NN>/<FYshort>, scoped per (state_code,
 * company_name, finance_year) — same scoping and zero-pad rule as mintBillNumber.
 */
async function mintCreditNoteNumber(stateCode: string, companyName: string, financeYear: string): Promise<string> {
  const scopeKey = `${stateCode}|${companyName}|${financeYear}`;
  const n = await nextSequenceValue("credit_note", scopeKey);
  const idx = n < 10 ? `0${n}` : String(n);
  const fyShort = financeYear.slice(2);
  return `CN-${stateCode}-${idx}/${fyShort}`;
}
```
Update the final export line to `export const clientBillingNumberingService = { mintProformaNumber, mintBillNumber, mintCreditNoteNumber };`.

- [ ] **Step 6: Write and run the failing test, then verify it passes**

Append to `backend/src/modules/client-billing/__tests__/client-billing-numbering.service.test.ts`:
```typescript
describe("mintCreditNoteNumber", () => {
  it("formats as CN-<stateCode>-<NN>/<FYshort>, zero-padded below 10", async () => {
    execute.mockResolvedValueOnce([{ insertId: 3 }, []]);
    const result = await clientBillingNumberingService.mintCreditNoteNumber("09", "Mas Callnet India Pvt Ltd", "2026-27");
    expect(result).toBe("CN-09-03/26-27");
  });

  it("scopes the counter row to kind='credit_note'", async () => {
    execute.mockResolvedValueOnce([{ insertId: 1 }, []]);
    await clientBillingNumberingService.mintCreditNoteNumber("09", "Mas Callnet India Pvt Ltd", "2026-27");
    const [, params] = execute.mock.calls[0];
    expect(params).toEqual(["credit_note", "09|Mas Callnet India Pvt Ltd|2026-27"]);
  });
});
```
Run: `cd backend && npx vitest run src/modules/client-billing/__tests__/client-billing-numbering.service.test.ts` — expect FAIL first (function doesn't exist), then PASS after Step 5's implementation (9 tests total: 7 existing + 2 new).

- [ ] **Step 7: Run the migration governance suite**

```bash
cd backend
npx vitest run src/db/__tests__/migration-manifest-guard.test.ts src/db/__tests__/migration-governance.test.ts src/db/__tests__/migration-isolation.test.ts
```
Expected: same pass count as the pre-existing baseline, no new failures.

- [ ] **Step 8: Commit**

```bash
git add backend/sql/migrations/1302_client_billing_credit_notes.sql backend/src/db/runPendingMigrations.ts backend/sql/MIGRATION_MANIFEST.lock.json backend/src/modules/client-billing/client-billing-numbering.service.ts backend/src/modules/client-billing/__tests__/client-billing-numbering.service.test.ts
git commit -m "feat(client-billing): add credit-note schema and numbering"
```

---

### Task 2: createCreditNote and approveCreditNote services

**Files:**
- Create: `backend/src/modules/client-billing/client-billing-credit-note.service.ts`
- Test: `backend/src/modules/client-billing/__tests__/client-billing-credit-note.service.test.ts`

**Interfaces:**
- Consumes: `clientBillingNumberingService.mintCreditNoteNumber(stateCode, companyName, financeYear)` (Task 1), `db.getConnection()`.
- Produces:
  ```typescript
  interface CreditNoteLineInput { particulars: string; qty: number; rate: number; }
  interface CreateCreditNoteInput {
    invoiceId: string; category: string; financeYear: string; monthLabel: string;
    creditDate: string; description?: string; applyGst?: boolean;
    lines: CreditNoteLineInput[]; userId: string;
  }
  interface CreditNoteResult {
    id: string; creditNo: string; totalAmount: number;
    igstAmount: number; cgstAmount: number; sgstAmount: number; grandTotal: number;
    creditStatus: "draft" | "approved";
  }
  interface ApproveCreditNoteInput { creditNoteId: string; userId: string; }
  ```
  `clientBillingCreditNoteService.createCreditNote(input: CreateCreditNoteInput): Promise<CreditNoteResult>`, `clientBillingCreditNoteService.approveCreditNote(input: ApproveCreditNoteInput): Promise<CreditNoteResult>` — Task 3's routes consume both directly.

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/modules/client-billing/__tests__/client-billing-credit-note.service.test.ts
import { randomUUID } from "crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { getConnection } = vi.hoisted(() => ({ getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { getConnection } }));

const { mintCreditNoteNumber } = vi.hoisted(() => ({ mintCreditNoteNumber: vi.fn() }));
vi.mock("../client-billing-numbering.service.js", () => ({
  clientBillingNumberingService: { mintCreditNoteNumber, mintProformaNumber: vi.fn(), mintBillNumber: vi.fn() },
}));

let clientBillingCreditNoteService: typeof import("../client-billing-credit-note.service.js")["clientBillingCreditNoteService"];
beforeAll(async () => {
  ({ clientBillingCreditNoteService } = await import("../client-billing-credit-note.service.js"));
});

function mockConnection() {
  const conn = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute: vi.fn() };
  getConnection.mockResolvedValue(conn);
  return conn;
}

const APPROVED_INVOICE = {
  id: "inv-1", invoice_status: "approved", cost_centre_id: "cc-1",
  finance_year: "2026-27",
};
const COST_CENTRE = { companyName: "Mas Callnet India Pvt Ltd", gstType: "Integrated", stateCode: "09" };

beforeEach(() => {
  getConnection.mockReset();
  mintCreditNoteNumber.mockReset();
});

describe("createCreditNote", () => {
  it("rejects an empty line list before touching the database", async () => {
    const conn = mockConnection();
    await expect(
      clientBillingCreditNoteService.createCreditNote({
        invoiceId: "inv-1", category: "Subscription", financeYear: "2026-27",
        monthLabel: "Aug-26", creditDate: "2026-08-19", lines: [], userId: "u-1",
      })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/line item/) });
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  it("refuses when the invoice is not approved", async () => {
    const conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[{ ...APPROVED_INVOICE, invoice_status: "proforma" }], []]);

    await expect(
      clientBillingCreditNoteService.createCreditNote({
        invoiceId: "inv-1", category: "Subscription", financeYear: "2026-27",
        monthLabel: "Aug-26", creditDate: "2026-08-19",
        lines: [{ particulars: "Refund", qty: 1, rate: 1000 }], userId: "u-1",
      })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/not approved/) });
    expect(mintCreditNoteNumber).not.toHaveBeenCalled();
  });

  it("throws when the invoice does not exist", async () => {
    const conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[], []]);
    await expect(
      clientBillingCreditNoteService.createCreditNote({
        invoiceId: "missing", category: "Subscription", financeYear: "2026-27",
        monthLabel: "Aug-26", creditDate: "2026-08-19",
        lines: [{ particulars: "Refund", qty: 1, rate: 1000 }], userId: "u-1",
      })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/not found/) });
  });

  it("mints a credit number, computes GST, and creates a draft credit note", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[APPROVED_INVOICE], []])
      .mockResolvedValueOnce([[COST_CENTRE], []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{}, []]);
    mintCreditNoteNumber.mockResolvedValueOnce("CN-09-01/26-27");

    const result = await clientBillingCreditNoteService.createCreditNote({
      invoiceId: "inv-1", category: "Subscription", financeYear: "2026-27",
      monthLabel: "Aug-26", creditDate: "2026-08-19",
      lines: [{ particulars: "Service credit", qty: 1, rate: 4500 }], userId: "u-1",
    });

    expect(mintCreditNoteNumber).toHaveBeenCalledWith("09", "Mas Callnet India Pvt Ltd", "2026-27");
    expect(result).toEqual({
      id: expect.any(String), creditNo: "CN-09-01/26-27", totalAmount: 4500,
      igstAmount: 810, cgstAmount: 0, sgstAmount: 0, grandTotal: 5310, creditStatus: "draft",
    });
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
});

describe("approveCreditNote", () => {
  it("refuses when already approved", async () => {
    const conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[{ id: "cn-1", credit_status: "approved" }], []]);
    await expect(
      clientBillingCreditNoteService.approveCreditNote({ creditNoteId: "cn-1", userId: "u-1" })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/already approved/) });
  });

  it("throws when the credit note does not exist", async () => {
    const conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[], []]);
    await expect(
      clientBillingCreditNoteService.approveCreditNote({ creditNoteId: "missing", userId: "u-1" })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/not found/) });
  });

  it("approves a draft credit note", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[{ id: "cn-1", credit_status: "draft", credit_no: "CN-09-01/26-27", total_amount: 4500, igst_amount: 810, cgst_amount: 0, sgst_amount: 0, grand_total: 5310 }], []])
      .mockResolvedValueOnce([{}, []]);

    const result = await clientBillingCreditNoteService.approveCreditNote({ creditNoteId: "cn-1", userId: "u-2" });

    expect(result).toEqual({
      id: "cn-1", creditNo: "CN-09-01/26-27", totalAmount: 4500,
      igstAmount: 810, cgstAmount: 0, sgstAmount: 0, grandTotal: 5310, creditStatus: "approved",
    });

    const updateCall = conn.execute.mock.calls[1];
    expect(String(updateCall[0])).toMatch(/UPDATE client_credit_note SET credit_status = 'approved'/);
    expect(updateCall[1]).toEqual(["u-2", "cn-1"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/client-billing/__tests__/client-billing-credit-note.service.test.ts`
Expected: FAIL — `Cannot find module '../client-billing-credit-note.service.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// backend/src/modules/client-billing/client-billing-credit-note.service.ts
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { clientBillingNumberingService } from "./client-billing-numbering.service.js";

export interface CreditNoteLineInput {
  particulars: string;
  qty: number;
  rate: number;
}

export interface CreateCreditNoteInput {
  invoiceId: string;
  category: string;
  financeYear: string;
  monthLabel: string;
  creditDate: string;
  description?: string;
  applyGst?: boolean;
  lines: CreditNoteLineInput[];
  userId: string;
}

export interface CreditNoteResult {
  id: string;
  creditNo: string | null;
  totalAmount: number;
  igstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  grandTotal: number;
  creditStatus: "draft" | "approved";
}

export interface ApproveCreditNoteInput {
  creditNoteId: string;
  userId: string;
}

function clientError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeGst(baseAmount: number, gstType: string, applyGst: boolean) {
  if (!applyGst) return { igst: 0, cgst: 0, sgst: 0 };
  if (gstType === "Integrated") {
    return { igst: round2(baseAmount * 0.18), cgst: 0, sgst: 0 };
  }
  const half = round2(baseAmount * 0.09);
  return { igst: 0, cgst: half, sgst: half };
}

async function createCreditNote(input: CreateCreditNoteInput): Promise<CreditNoteResult> {
  if (input.lines.length === 0) {
    throw clientError("At least one line item is required");
  }

  const conn = await db.getConnection();
  const creditNoteId = randomUUID();
  try {
    await conn.beginTransaction();

    const [invoiceRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, invoice_status, cost_centre_id, finance_year FROM client_invoice WHERE id = ? LIMIT 1`,
      [input.invoiceId]
    );
    const invoice = invoiceRows[0] as { id: string; invoice_status: string; cost_centre_id: string; finance_year: string } | undefined;
    if (!invoice) {
      throw clientError(`Invoice ${input.invoiceId} not found`);
    }
    if (invoice.invoice_status !== "approved") {
      throw clientError(`Invoice ${input.invoiceId} is not approved (currently: ${invoice.invoice_status}) — a credit note can only be issued against an approved invoice`);
    }

    const [costCentreRows] = await conn.execute<RowDataPacket[]>(
      `SELECT cc.company_name AS companyName, cc.gst_type AS gstType, b.gst_state_code AS stateCode
       FROM cost_centre_master cc
       LEFT JOIN branch_master b ON b.id = cc.branch_id
       WHERE cc.id = ?`,
      [invoice.cost_centre_id]
    );
    const costCentre = costCentreRows[0] as { companyName: string; gstType: string; stateCode: string | null } | undefined;
    if (!costCentre || !costCentre.stateCode) {
      throw clientError(`Cost centre ${invoice.cost_centre_id} has no branch GST state code — cannot mint a credit note number`);
    }

    const applyGst = input.applyGst ?? true;
    const totalAmount = round2(input.lines.reduce((sum, line) => sum + round2(line.qty * line.rate), 0));
    const { igst, cgst, sgst } = computeGst(totalAmount, costCentre.gstType, applyGst);
    const grandTotal = round2(totalAmount + igst + cgst + sgst);

    const creditNo = await clientBillingNumberingService.mintCreditNoteNumber(
      costCentre.stateCode, costCentre.companyName, input.financeYear
    );

    await conn.execute(
      `INSERT INTO client_credit_note
         (id, invoice_id, cost_centre_id, category, finance_year, month_label, credit_date,
          description, credit_no, credit_status, gst_type, apply_gst, total_amount, igst_amount,
          cgst_amount, sgst_amount, grand_total, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        creditNoteId, input.invoiceId, invoice.cost_centre_id, input.category, input.financeYear,
        input.monthLabel, input.creditDate, input.description ?? null, creditNo, costCentre.gstType,
        applyGst ? 1 : 0, totalAmount, igst, cgst, sgst, grandTotal, input.userId,
      ]
    );

    for (const line of input.lines) {
      await conn.execute(
        `INSERT INTO client_credit_note_line (id, credit_note_id, particulars, qty, rate, amount)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [randomUUID(), creditNoteId, line.particulars, line.qty, line.rate, round2(line.qty * line.rate)]
      );
    }

    await conn.commit();
    return { id: creditNoteId, creditNo, totalAmount, igstAmount: igst, cgstAmount: cgst, sgstAmount: sgst, grandTotal, creditStatus: "draft" };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function approveCreditNote(input: ApproveCreditNoteInput): Promise<CreditNoteResult> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, credit_status, credit_no, total_amount, igst_amount, cgst_amount, sgst_amount, grand_total
       FROM client_credit_note WHERE id = ? LIMIT 1 FOR UPDATE`,
      [input.creditNoteId]
    );
    const creditNote = rows[0] as
      | { id: string; credit_status: string; credit_no: string; total_amount: number; igst_amount: number; cgst_amount: number; sgst_amount: number; grand_total: number }
      | undefined;
    if (!creditNote) {
      throw clientError(`Credit note ${input.creditNoteId} not found`);
    }
    if (creditNote.credit_status === "approved") {
      throw clientError(`Credit note ${input.creditNoteId} is already approved`);
    }

    await conn.execute(
      `UPDATE client_credit_note SET credit_status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?`,
      [input.userId, input.creditNoteId]
    );

    await conn.commit();
    return {
      id: creditNote.id, creditNo: creditNote.credit_no, totalAmount: Number(creditNote.total_amount),
      igstAmount: Number(creditNote.igst_amount), cgstAmount: Number(creditNote.cgst_amount),
      sgstAmount: Number(creditNote.sgst_amount), grandTotal: Number(creditNote.grand_total),
      creditStatus: "approved",
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export const clientBillingCreditNoteService = { createCreditNote, approveCreditNote };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/client-billing/__tests__/client-billing-credit-note.service.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verify the numbering + GST arithmetic against live MySQL**

Same style as the foundation/approval-workflow plans' verification steps — a throwaway table proving the atomic-counter call this service makes (via `mintCreditNoteNumber`, already verified in Task 1) behaves correctly end-to-end is sufficient; this task's own arithmetic (`computeGst`, line-sum) is pure JS with no new SQL beyond straightforward parameterized INSERT/UPDATE/SELECT already covered by Task 1's DDL verification and the existing `createProforma`/`approveInvoice` precedent for this exact query shape. Run a live `PREPARE` check on the two new INSERT statements and the credit-note lookup/UPDATE, using a throwaway `x_`-prefixed table shaped like `client_credit_note`, to confirm no column-name typos slipped through (this class of bug — a real column mismatch only surfacing at runtime — is exactly what past verification steps in this plan family have caught).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/client-billing/client-billing-credit-note.service.ts backend/src/modules/client-billing/__tests__/client-billing-credit-note.service.test.ts
git commit -m "feat(client-billing): add createCreditNote and approveCreditNote services"
```

---

### Task 3: Routes

**Files:**
- Modify: `backend/src/modules/client-billing/client-billing.routes.ts`
- Modify: `backend/src/modules/client-billing/__tests__/client-billing.routes.test.ts`

**Interfaces:**
- Consumes: `clientBillingCreditNoteService.createCreditNote`, `clientBillingCreditNoteService.approveCreditNote` (Task 2), `db.execute` for the two GET routes.
- Produces: 4 new routes on the existing `clientBillingRouter`.

- [ ] **Step 1: Write the failing tests**

Re-read `backend/src/modules/client-billing/__tests__/client-billing.routes.test.ts` fresh first. Add this mock near the top, alongside the existing service mocks:
```typescript
const { createCreditNote, approveCreditNote } = vi.hoisted(() => ({ createCreditNote: vi.fn(), approveCreditNote: vi.fn() }));
vi.mock("../client-billing-credit-note.service.js", () => ({
  clientBillingCreditNoteService: { createCreditNote, approveCreditNote },
}));
```
Then append:
```typescript
describe("POST /api/client-billing/credit-notes", () => {
  beforeEach(() => { createCreditNote.mockReset(); });

  it("creates a draft credit note", async () => {
    createCreditNote.mockResolvedValueOnce({ id: "cn-1", creditNo: "CN-09-01/26-27", totalAmount: 4500, igstAmount: 810, cgstAmount: 0, sgstAmount: 0, grandTotal: 5310, creditStatus: "draft" });

    const res = await request(app).post("/api/client-billing/credit-notes").send({
      invoiceId: "inv-1", category: "Subscription", financeYear: "2026-27",
      monthLabel: "Aug-26", creditDate: "2026-08-19",
      lines: [{ particulars: "Service credit", qty: 1, rate: 4500 }],
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: expect.objectContaining({ creditNo: "CN-09-01/26-27" }) });
    expect(createCreditNote).toHaveBeenCalledWith(expect.objectContaining({ userId: "u-1" }));
  });

  it("returns 400 when invoiceId is missing", async () => {
    const res = await request(app).post("/api/client-billing/credit-notes").send({
      category: "Subscription", financeYear: "2026-27", monthLabel: "Aug-26", creditDate: "2026-08-19", lines: [],
    });
    expect(res.status).toBe(400);
    expect(createCreditNote).not.toHaveBeenCalled();
  });
});

describe("POST /api/client-billing/credit-notes/:id/approve", () => {
  beforeEach(() => { approveCreditNote.mockReset(); });

  it("approves and returns the credit note", async () => {
    approveCreditNote.mockResolvedValueOnce({ id: "cn-1", creditNo: "CN-09-01/26-27", totalAmount: 4500, igstAmount: 810, cgstAmount: 0, sgstAmount: 0, grandTotal: 5310, creditStatus: "approved" });

    const res = await request(app).post("/api/client-billing/credit-notes/cn-1/approve").send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: expect.objectContaining({ creditStatus: "approved" }) });
    expect(approveCreditNote).toHaveBeenCalledWith({ creditNoteId: "cn-1", userId: "u-1" });
  });
});

describe("GET /api/client-billing/credit-notes", () => {
  it("lists credit notes", async () => {
    execute.mockResolvedValueOnce([[{ id: "cn-1", credit_no: "CN-09-01/26-27" }], []]);
    const res = await request(app).get("/api/client-billing/credit-notes");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [{ id: "cn-1", credit_no: "CN-09-01/26-27" }] });
  });
});

describe("GET /api/client-billing/credit-notes/:id", () => {
  it("returns 404 when not found", async () => {
    execute.mockResolvedValueOnce([[], []]);
    const res = await request(app).get("/api/client-billing/credit-notes/missing");
    expect(res.status).toBe(404);
  });

  it("returns the credit note with its lines when found", async () => {
    execute.mockResolvedValueOnce([[{ id: "cn-1", credit_no: "CN-09-01/26-27" }], []]);
    execute.mockResolvedValueOnce([[{ id: "line-1", particulars: "Service credit" }], []]);
    const res = await request(app).get("/api/client-billing/credit-notes/cn-1");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: "cn-1", credit_no: "CN-09-01/26-27", lines: [{ id: "line-1", particulars: "Service credit" }] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/client-billing/__tests__/client-billing.routes.test.ts`
Expected: FAIL — module/route not found.

- [ ] **Step 3: Write the implementation**

Re-read `backend/src/modules/client-billing/client-billing.routes.ts` fresh first. Add the import alongside the existing service imports:
```typescript
import { clientBillingCreditNoteService } from "./client-billing-credit-note.service.js";
```
Append these 4 routes before the final `export { router as clientBillingRouter };`:
```typescript
router.post(
  "/credit-notes",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as {
      invoiceId?: string; category?: string; financeYear?: string; monthLabel?: string;
      creditDate?: string; description?: string; applyGst?: boolean;
      lines?: Array<{ particulars: string; qty: number; rate: number }>;
    };
    if (!body.invoiceId || !body.category || !body.financeYear || !body.monthLabel || !body.creditDate) {
      return res.status(400).json({ error: "invoiceId, category, financeYear, monthLabel, and creditDate are required" });
    }
    const data = await clientBillingCreditNoteService.createCreditNote({
      invoiceId: body.invoiceId, category: body.category, financeYear: body.financeYear,
      monthLabel: body.monthLabel, creditDate: body.creditDate, description: body.description,
      applyGst: body.applyGst, lines: body.lines ?? [], userId: req.authUser!.id,
    });
    res.status(201).json({ success: true, data });
  })
);

router.post(
  "/credit-notes/:id/approve",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await clientBillingCreditNoteService.approveCreditNote({
      creditNoteId: req.params.id, userId: req.authUser!.id,
    });
    res.json({ success: true, data });
  })
);

router.get(
  "/credit-notes",
  requireRole(...ALLOWED_ROLES),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT * FROM client_credit_note ORDER BY created_at DESC`);
    res.json({ success: true, data: rows });
  })
);

router.get(
  "/credit-notes/:id",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT * FROM client_credit_note WHERE id = ? LIMIT 1`, [req.params.id]);
    const creditNote = rows[0];
    if (!creditNote) return res.status(404).json({ error: "Credit note not found" });
    const [lineRows] = await db.execute<RowDataPacket[]>(`SELECT * FROM client_credit_note_line WHERE credit_note_id = ?`, [req.params.id]);
    res.json({ success: true, data: { ...creditNote, lines: lineRows } });
  })
);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/client-billing`
Expected: PASS, all tests across every file in the module.

- [ ] **Step 5: Scoped typecheck**

Run: `cd backend && npx tsc --noEmit -p . 2>&1 | grep -i client-billing`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/client-billing/client-billing.routes.ts backend/src/modules/client-billing/__tests__/client-billing.routes.test.ts
git commit -m "feat(client-billing): add credit-note routes"
```

---

## Self-Review

**Spec coverage:** §3 (numbering fix, CN-<state>-<NN>/<FYshort> format) — Task 1. §4 (both tables) — Task 1. §5 (`createCreditNote` validates approved-invoice, `approveCreditNote` with FOR UPDATE) — Task 2. §6 (4 routes) — Task 3. §7 (no reject mechanism — respected, nothing in this plan implements one).

**Placeholder scan:** none — every step has complete code.

**Type consistency:** `CreateCreditNoteInput`/`CreditNoteResult`/`ApproveCreditNoteInput` match exactly between Task 2's service and Task 3's routes. `mintCreditNoteNumber(stateCode, companyName, financeYear)` signature matches its Task 1 definition and Task 2's call site. Column names in Task 1's migration match every SQL string in Tasks 2-3.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-19-client-billing-credit-notes.md`. Executing via subagent-driven-development, same as the prior two phases — user has given standing authorization to continue autonomously.
