# Client Billing Approval Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take a `client_invoice` from `proforma` to `approved` (real bill number minted, PO balance consumed) or `rejected` (soft, audited, provision balance correctly refunded), giving `mintBillNumber` its first real caller.

**Architecture:** Two new transactional services (`approveInvoice`, `rejectInvoice`) following the exact `db.getConnection()`/`beginTransaction()`/`commit()`/`rollback()`/`release()` pattern already proven in `client-billing.service.ts`'s `createProforma`. Five new tables back provision tracking, PO tracking, and an append-only audit log. Three new routes follow `client-billing.routes.ts`'s existing `requireAuth`/`requireRole`/`Object.assign(new Error(...), {statusCode})` conventions exactly.

**Tech Stack:** Express + TypeScript, mysql2, vitest, MySQL 8 (`mas_hrms`).

## Correction to the approved design spec, found while writing this plan

The design spec (`docs/superpowers/specs/2026-08-19-client-billing-approval-workflow-design.md`)
§5 step 4 says approval should "copy the frozen cost-centre snapshot
columns onto the invoice (same ~34-field copy legacy did at this exact
stage)." **This step is dropped from this plan** — `client_invoice`
(built in the foundation phase) has no such snapshot columns, and adding
~34 columns to hold them isn't needed: the schema's own architecture
decision (design spec §4, foundation phase) is FK-based identity via
`cost_centre_id`, not legacy's denormalized copy (legacy needed the copy
because it had no reliable FK — string-matched cost centers instead). The
financially-binding figures (`gst_type`, `total_amount`, `igst_amount`,
`cgst_amount`, `sgst_amount`, `grand_total`) are already frozen on
`client_invoice` at proforma-creation time in `createProforma` — that's
the part that actually must not drift if `cost_centre_master` changes
later. Presentational fields (address, Tally head, etc.) can be joined
live via `cost_centre_id` whenever needed (e.g. by the future PDF plan),
same as `createProforma`'s own cost-centre lookup already does. If the
PDF plan later decides it needs frozen presentational fields for
historical accuracy, that's an `ALTER TABLE` decision for that plan, not
this one.

## Global Constraints

- All 5 new tables: `COLLATE=utf8mb4_unicode_ci` at the table level (not per-column) — the foundation phase's collation incident.
- No surrogate `AUTO_INCREMENT` id on any table that needs `INSERT ... ON DUPLICATE KEY UPDATE` upsert semantics — none of this plan's tables need that pattern, but the rule stands (foundation phase's numbering-service incident).
- All `CREATE TABLE` statements use `IF NOT EXISTS`.
- Every new route: `requireAuth` (via the router's existing `router.use(requireAuth)`) + explicit `requireRole(...ALLOWED_ROLES)` — reuse the same `ALLOWED_ROLES` constant already defined in `client-billing.routes.ts`.
- All mutating routes are `POST` only.
- Errors that are real client/business failures: `throw Object.assign(new Error("message"), { statusCode: 400 })` — never a local `try/catch` in a route that masks unexpected failures. Follow `client-billing.routes.ts`'s existing pattern exactly (no route-local catch around a service call — let `h()`'s `.catch(next)` reach the shared `errorHandler`).
- DB access through `db` from `backend/src/db/mysql.ts`; transactional work uses `db.getConnection()`, never mixes pool-level `db.execute` with an open transaction's `conn`.
- **Before considering any task done, verify its SQL against a real MySQL 8 connection** — not only the mocked test suite. Use the read-only credentials below for a throwaway-table `PREPARE`/`CREATE`/`INSERT`/`DROP` cycle exactly like the ones used to catch and fix the foundation phase's two production-breaking bugs (a MySQL 8 reserved-word column name, and a surrogate `AUTO_INCREMENT` id silently breaking an `INSERT ... ON DUPLICATE KEY UPDATE` idiom). Connection: host `192.168.10.6` (fallback `122.184.128.90` if that times out — LAN vs public routing varies by network), port `3306`, user `shivam_user`, password **read from `backend/.env`'s `DB_PASSWORD`, never hardcode or paste it into a tracked file** — a live credential shipped in plaintext in this exact file earlier, found and scrubbed by an independent audit; do not reintroduce it — database `mas_hrms`. Never write to any real (non-throwaway, non-`x_`-prefixed) table.
- Migration file numbered `NNN_description.sql` under `backend/sql/migrations/` — check `ls backend/sql/migrations/*.sql | grep -oE '[0-9]+' | sort -n | tail -3` AND `ls backend/sql/*.sql | grep -oE '^[0-9]+' | sort -n | tail -3` immediately before picking a number (both directories share one numbering space; the foundation phase's migration collided twice before landing on 1300 — start by trying `1301` but re-verify it's still free, this repo has many concurrent sessions).
- Migration registration has TWO required steps, not one: (1) add the filename (with `migrations/` prefix) to the `MIGRATION_MANIFEST` array literal in `backend/src/db/runPendingMigrations.ts` — this is the actual runtime source; (2) regenerate `backend/sql/MIGRATION_MANIFEST.lock.json` by running `node backend/scripts/update-migration-lock.mjs --write`, never hand-edit the lock file. The foundation phase shipped with the lock file hand-edited but the TS array never touched, so the migration was silently never scheduled.

---

## File Structure

- `backend/sql/migrations/1301_client_billing_approval_workflow.sql` (or the next free number per Global Constraints) — 5 new tables.
- `backend/src/db/runPendingMigrations.ts` — modified, one new `MIGRATION_MANIFEST` array entry.
- `backend/sql/MIGRATION_MANIFEST.lock.json` — regenerated via script, not hand-edited.
- `backend/src/modules/client-billing/client-billing-approval.service.ts` — `approveInvoice`, `rejectInvoice`.
- `backend/src/modules/client-billing/__tests__/client-billing-approval.service.test.ts` — tests for both.
- `backend/src/modules/client-billing/client-billing.routes.ts` — modified, 3 new routes appended.
- `backend/src/modules/client-billing/__tests__/client-billing.routes.test.ts` — modified, tests for the 3 new routes appended.

---

### Task 1: Schema migration — provision, PO, and audit log tables

**Files:**
- Create: `backend/sql/migrations/1301_client_billing_approval_workflow.sql` (verify the number is free first, per Global Constraints — rename throughout this task if not)
- Modify: `backend/src/db/runPendingMigrations.ts`
- Modify (regenerated, not hand-edited): `backend/sql/MIGRATION_MANIFEST.lock.json`

**Interfaces:**
- Produces: tables `client_provision(id, cost_centre_id, finance_year, month_label, provision_amount, provision_balance, created_at, updated_at)`, `client_provision_deduction(id, provision_id, invoice_id, amount_used, deducted_at)`, `client_po_number(id, cost_centre_id, po_number, period_from, period_to, total_amount, balance_amount, created_at, updated_at)`, `client_po_particular(id, po_id, invoice_id, amount_consumed, consumed_at)`, `client_invoice_audit_log(id, invoice_id, action, actor_id, reason, created_at)` — Tasks 2 and 3 write raw SQL against these exact column names.

- [ ] **Step 1: Verify the migration number is free**

Run:
```bash
cd backend
ls sql/migrations/*.sql | grep -oE '[0-9]+' | sort -n | tail -3
ls sql/*.sql | grep -oE '^[0-9]+_' | grep -oE '^[0-9]+' | sort -n | tail -3
```
If `1301` (or whatever number you're about to use) appears in either list, pick the next integer not present in either and use that number throughout this task instead.

- [ ] **Step 2: Write the migration file**

```sql
-- 1301_client_billing_approval_workflow.sql
--
-- Approval-workflow schema for the client-billing replica (docs/superpowers/specs/2026-08-19-client-billing-approval-workflow-design.md).
-- Five new tables: provision tracking, PO tracking, and an append-only audit log for the
-- proforma -> approved/rejected transition. Does not touch client_invoice, client_invoice_line,
-- client_invoice_number_sequence, cost_centre_master, or any db_bill/billing_invoice/
-- billing_*_snapshot table.
--
-- ── Why ─────────────────────────────────────────────────────────────────────────────────
-- client_provision / client_provision_deduction replace legacy's provision_master /
-- provision_master_month_deductions with atomic SQL balance mutations (`balance = balance -
-- ?` / `balance = balance + ?`), fixing two confirmed legacy bugs: an undefined-PHP-variable
-- corruption on invoice edit, and a reject-refund that overwrote the balance with just the
-- total instead of adding it back (PHP string-coercion bug: `'provision_balance' =>
-- 'provision_balance' + $total` is evaluated by PHP before ever reaching MySQL).
--
-- client_po_number / client_po_particular replace legacy's po_number / po_number_particulars,
-- same 4-PO-per-invoice cap as legacy (a real business rule, not a bug).
--
-- client_invoice_audit_log replaces legacy's four inconsistent reject mechanisms (soft-delete
-- via update_proforma, hard-delete via update_bill, soft-delete via reject_invoice, and a
-- fourth dead endpoint) with one auditable, append-only path: every create/edit/approve/reject
-- writes exactly one row here.
--
-- ── Safety ──────────────────────────────────────────────────────────────────────────────
-- Pure CREATE TABLE — no ALTER of any existing table, no data migration. Learned from the
-- foundation phase's production incident (a MySQL 8 reserved-word column name shipped
-- unquoted, and a surrogate AUTO_INCREMENT id silently broke an atomic-counter idiom): every
-- statement in this file was verified against a live MySQL 8 connection (PREPARE for DDL,
-- a throwaway-table INSERT/UPDATE cycle for the balance-mutation SQL used by Tasks 2-3)
-- before this file was committed — see those tasks' own verification steps.
--
-- Rollback is five DROP TABLEs (particulars/deductions/audit first, for the FKs):
--   DROP TABLE client_provision_deduction;
--   DROP TABLE client_po_particular;
--   DROP TABLE client_invoice_audit_log;
--   DROP TABLE client_provision;
--   DROP TABLE client_po_number;
--
-- ── Deployment ──────────────────────────────────────────────────────────────────────────
-- Registering this file in runPendingMigrations.ts's MIGRATION_MANIFEST array (and
-- regenerating the lock file from it) applies it at the next pm2 restart — do that only with
-- explicit user sign-off, per CLAUDE.md's migration-approval rule.

CREATE TABLE IF NOT EXISTS client_provision (
  id                 CHAR(36)      NOT NULL PRIMARY KEY,
  cost_centre_id     CHAR(36)      NOT NULL,
  finance_year       VARCHAR(10)   NOT NULL,
  month_label        VARCHAR(10)   NOT NULL,
  provision_amount   DECIMAL(14,2) NOT NULL DEFAULT 0,
  provision_balance  DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME      NULL ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_cp_cost_centre (cost_centre_id),
  KEY idx_cp_scope (cost_centre_id, finance_year, month_label),
  CONSTRAINT fk_cp_cost_centre FOREIGN KEY (cost_centre_id)
    REFERENCES cost_centre_master(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_provision_deduction (
  id            CHAR(36)      NOT NULL PRIMARY KEY,
  provision_id  CHAR(36)      NOT NULL,
  invoice_id    CHAR(36)      NOT NULL,
  amount_used   DECIMAL(14,2) NOT NULL,
  deducted_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cpd_provision (provision_id),
  KEY idx_cpd_invoice (invoice_id),
  CONSTRAINT fk_cpd_provision FOREIGN KEY (provision_id)
    REFERENCES client_provision(id),
  CONSTRAINT fk_cpd_invoice FOREIGN KEY (invoice_id)
    REFERENCES client_invoice(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_po_number (
  id              CHAR(36)      NOT NULL PRIMARY KEY,
  cost_centre_id  CHAR(36)      NOT NULL,
  po_number       VARCHAR(60)   NOT NULL,
  period_from     DATE          NOT NULL,
  period_to       DATE          NOT NULL,
  total_amount    DECIMAL(14,2) NOT NULL,
  balance_amount  DECIMAL(14,2) NOT NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NULL ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_cpn_cost_centre (cost_centre_id),
  KEY idx_cpn_po_number (po_number),
  CONSTRAINT fk_cpn_cost_centre FOREIGN KEY (cost_centre_id)
    REFERENCES cost_centre_master(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_po_particular (
  id               CHAR(36)      NOT NULL PRIMARY KEY,
  po_id            CHAR(36)      NOT NULL,
  invoice_id       CHAR(36)      NOT NULL,
  amount_consumed  DECIMAL(14,2) NOT NULL,
  consumed_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cpp_po (po_id),
  KEY idx_cpp_invoice (invoice_id),
  CONSTRAINT fk_cpp_po FOREIGN KEY (po_id)
    REFERENCES client_po_number(id),
  CONSTRAINT fk_cpp_invoice FOREIGN KEY (invoice_id)
    REFERENCES client_invoice(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_invoice_audit_log (
  id          CHAR(36)   NOT NULL PRIMARY KEY,
  invoice_id  CHAR(36)   NOT NULL,
  action      ENUM('created','edited','approved','rejected') NOT NULL,
  actor_id    CHAR(36)   NOT NULL,
  reason      TEXT       NULL,
  created_at  DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cial_invoice (invoice_id),
  CONSTRAINT fk_cial_invoice FOREIGN KEY (invoice_id)
    REFERENCES client_invoice(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 3: Verify every CREATE TABLE parses against live MySQL**

Run from `backend/` (adjust the host per Global Constraints if the first one times out):
```bash
node -e "
import('mysql2/promise').then(async (m) => {
  const conn = await m.createConnection({host:'192.168.10.6',port:3306,user:'shivam_user',password:process.env.DB_PASSWORD,database:'mas_hrms',connectTimeout:15000}); // DB_PASSWORD from backend/.env — never hardcode this, see the Connection note above
  const fs = await import('fs');
  const sql = fs.readFileSync('sql/migrations/1301_client_billing_approval_workflow.sql', 'utf8');
  const statements = sql.split(/;\s*\n/).map(s => s.trim()).filter(s => s.startsWith('CREATE TABLE'));
  for (const stmt of statements) {
    const name = stmt.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1];
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
Expected: `OK: client_provision`, `OK: client_provision_deduction`, `OK: client_po_number`, `OK: client_po_particular`, `OK: client_invoice_audit_log` — five `OK` lines, zero `FAILED` lines. If anything fails, fix the SQL and re-run before proceeding — do not commit a migration that hasn't passed this check, per Global Constraints.

- [ ] **Step 4: Register in runPendingMigrations.ts and regenerate the lock**

Re-read `backend/src/db/runPendingMigrations.ts` fresh (shared file, other sessions edit it concurrently). Find the `MIGRATION_MANIFEST` array and append (don't reorder anything else):
```typescript
"migrations/1301_client_billing_approval_workflow.sql",
```
Then run:
```bash
node backend/scripts/update-migration-lock.mjs --write
```
Confirm `backend/sql/MIGRATION_MANIFEST.lock.json` now contains `"migrations/1301_client_billing_approval_workflow.sql"` in its `released` array (and check whether the script also needs it added to `knownDangling` — it did for the foundation phase's migration automatically; verify the same happened here by checking the regenerated file).

- [ ] **Step 5: Run the migration governance test suite**

```bash
cd backend
npx vitest run src/db/__tests__/migration-manifest-guard.test.ts src/db/__tests__/migration-governance.test.ts src/db/__tests__/migration-isolation.test.ts
```
Expected: same pass count as the pre-existing baseline (no new failures introduced — check by comparing against `git stash` if unsure what the baseline count is).

- [ ] **Step 6: Commit**

```bash
git add backend/sql/migrations/1301_client_billing_approval_workflow.sql backend/src/db/runPendingMigrations.ts backend/sql/MIGRATION_MANIFEST.lock.json
git commit -m "feat(client-billing): add approval-workflow schema (provision, PO, audit log)"
```

---

### Task 2: Approval service

**Files:**
- Create: `backend/src/modules/client-billing/client-billing-approval.service.ts`
- Test: `backend/src/modules/client-billing/__tests__/client-billing-approval.service.test.ts`

**Interfaces:**
- Consumes: `clientBillingNumberingService.mintBillNumber(stateCode: string, companyName: string, financeYear: string): Promise<string>` (already live, from `client-billing-numbering.service.ts`), `db.getConnection()` (`backend/src/db/mysql.ts`).
- Produces:
  ```typescript
  interface ApprovePoInput { poNumber: string; amount: number; }
  interface ApproveInvoiceInput { invoiceId: string; poNumbers?: string[]; userId: string; }
  interface ApproveInvoiceResult { id: string; billNo: string; invoiceStatus: "approved"; }
  ```
  `clientBillingApprovalService.approveInvoice(input: ApproveInvoiceInput): Promise<ApproveInvoiceResult>` — Task 4's routes consume this directly.

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/modules/client-billing/__tests__/client-billing-approval.service.test.ts
import { randomUUID } from "crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { getConnection } = vi.hoisted(() => ({ getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { getConnection } }));

const { mintBillNumber } = vi.hoisted(() => ({ mintBillNumber: vi.fn() }));
vi.mock("../client-billing-numbering.service.js", () => ({
  clientBillingNumberingService: { mintBillNumber, mintProformaNumber: vi.fn() },
}));

let clientBillingApprovalService: typeof import("../client-billing-approval.service.js")["clientBillingApprovalService"];
beforeAll(async () => {
  ({ clientBillingApprovalService } = await import("../client-billing-approval.service.js"));
});

function mockConnection() {
  const conn = {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
    execute: vi.fn(),
  };
  getConnection.mockResolvedValue(conn);
  return conn;
}

const APPROVABLE_INVOICE = {
  id: "inv-1", invoice_status: "proforma", cost_centre_id: "cc-1",
  finance_year: "2026-27", grand_total: 35400,
};

beforeEach(() => {
  getConnection.mockReset();
  mintBillNumber.mockReset();
});

describe("approveInvoice", () => {
  it("refuses when the invoice is not in proforma status", async () => {
    const conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[{ ...APPROVABLE_INVOICE, invoice_status: "approved" }], []]);

    await expect(
      clientBillingApprovalService.approveInvoice({ invoiceId: "inv-1", userId: "u-1" })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/not in proforma status/) });

    expect(mintBillNumber).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it("throws when the invoice does not exist", async () => {
    const conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[], []]);

    await expect(
      clientBillingApprovalService.approveInvoice({ invoiceId: "missing", userId: "u-1" })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/not found/) });
  });

  it("mints a bill number, resolves stateCode/companyName via cost_centre_master + branch_master, and marks the invoice approved", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[APPROVABLE_INVOICE], []]) // invoice lookup
      .mockResolvedValueOnce([[{ companyName: "Mas Callnet India Pvt Ltd", stateCode: "09" }], []]) // cost centre + branch lookup
      .mockResolvedValueOnce([{}, []]) // UPDATE client_invoice
      .mockResolvedValueOnce([{}, []]); // INSERT client_invoice_audit_log
    mintBillNumber.mockResolvedValueOnce("09-01/26-27");

    const result = await clientBillingApprovalService.approveInvoice({ invoiceId: "inv-1", userId: "u-1" });

    expect(mintBillNumber).toHaveBeenCalledWith("09", "Mas Callnet India Pvt Ltd", "2026-27");
    expect(result).toEqual({ id: "inv-1", billNo: "09-01/26-27", invoiceStatus: "approved" });
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);

    const auditCall = conn.execute.mock.calls[3];
    expect(String(auditCall[0])).toMatch(/INSERT INTO client_invoice_audit_log/);
    expect(auditCall[1]).toEqual(expect.arrayContaining(["inv-1", "approved", "u-1"]));
  });

  it("rejects more than 4 PO numbers before touching the database further", async () => {
    const conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[APPROVABLE_INVOICE], []]);

    await expect(
      clientBillingApprovalService.approveInvoice({
        invoiceId: "inv-1", userId: "u-1",
        poNumbers: ["PO1", "PO2", "PO3", "PO4", "PO5"],
      })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/more than 4/) });
  });

  it("rejects when the sum of PO balances is less than the invoice grand total", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[APPROVABLE_INVOICE], []]) // invoice lookup
      .mockResolvedValueOnce([[{ id: "po-1", balance_amount: 10000 }], []]); // PO lookup, one PO, insufficient

    await expect(
      clientBillingApprovalService.approveInvoice({ invoiceId: "inv-1", userId: "u-1", poNumbers: ["PO1"] })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/PO balance/) });

    expect(mintBillNumber).not.toHaveBeenCalled();
  });

  it("consumes PO balances and records client_po_particular rows when POs cover the total", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[APPROVABLE_INVOICE], []]) // invoice lookup
      .mockResolvedValueOnce([[{ id: "po-1", balance_amount: 40000 }], []]) // PO lookup
      .mockResolvedValueOnce([[{ companyName: "Mas Callnet India Pvt Ltd", stateCode: "09" }], []]) // cost centre lookup
      .mockResolvedValueOnce([{}, []]) // UPDATE client_po_number balance
      .mockResolvedValueOnce([{}, []]) // INSERT client_po_particular
      .mockResolvedValueOnce([{}, []]) // UPDATE client_invoice
      .mockResolvedValueOnce([{}, []]); // INSERT audit log
    mintBillNumber.mockResolvedValueOnce("09-01/26-27");

    await clientBillingApprovalService.approveInvoice({ invoiceId: "inv-1", userId: "u-1", poNumbers: ["PO1"] });

    const poUpdateCall = conn.execute.mock.calls[3];
    expect(String(poUpdateCall[0])).toMatch(/UPDATE client_po_number/);
    const poParticularCall = conn.execute.mock.calls[4];
    expect(String(poParticularCall[0])).toMatch(/INSERT INTO client_po_particular/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/client-billing/__tests__/client-billing-approval.service.test.ts`
Expected: FAIL — `Cannot find module '../client-billing-approval.service.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// backend/src/modules/client-billing/client-billing-approval.service.ts
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { clientBillingNumberingService } from "./client-billing-numbering.service.js";

export interface ApproveInvoiceInput {
  invoiceId: string;
  poNumbers?: string[];
  userId: string;
}

export interface ApproveInvoiceResult {
  id: string;
  billNo: string;
  invoiceStatus: "approved";
}

function clientError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

async function approveInvoice(input: ApproveInvoiceInput): Promise<ApproveInvoiceResult> {
  if (input.poNumbers && input.poNumbers.length > 4) {
    throw clientError("Cannot attach more than 4 PO numbers to a single invoice");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [invoiceRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, invoice_status, cost_centre_id, finance_year, grand_total
       FROM client_invoice WHERE id = ? LIMIT 1`,
      [input.invoiceId]
    );
    const invoice = invoiceRows[0] as
      | { id: string; invoice_status: string; cost_centre_id: string; finance_year: string; grand_total: number }
      | undefined;
    if (!invoice) {
      throw clientError(`Invoice ${input.invoiceId} not found`);
    }
    if (invoice.invoice_status !== "proforma") {
      throw clientError(`Invoice ${input.invoiceId} is not in proforma status (currently: ${invoice.invoice_status})`);
    }

    if (input.poNumbers && input.poNumbers.length > 0) {
      const placeholders = input.poNumbers.map(() => "?").join(", ");
      const [poRows] = await conn.execute<RowDataPacket[]>(
        `SELECT id, balance_amount FROM client_po_number WHERE po_number IN (${placeholders}) AND cost_centre_id = ?`,
        [...input.poNumbers, invoice.cost_centre_id]
      );
      const totalPoBalance = (poRows as Array<{ balance_amount: number }>).reduce(
        (sum, po) => sum + Number(po.balance_amount), 0
      );
      if (totalPoBalance < Number(invoice.grand_total)) {
        throw clientError(
          `Attached PO balance (${totalPoBalance}) is less than the invoice grand total (${invoice.grand_total})`
        );
      }
    }

    const [costCentreRows] = await conn.execute<RowDataPacket[]>(
      `SELECT cc.company_name AS companyName, b.gst_state_code AS stateCode
       FROM cost_centre_master cc
       LEFT JOIN branch_master b ON b.id = cc.branch_id
       WHERE cc.id = ?`,
      [invoice.cost_centre_id]
    );
    const costCentre = costCentreRows[0] as { companyName: string; stateCode: string | null } | undefined;
    if (!costCentre || !costCentre.stateCode) {
      throw clientError(`Cost centre ${invoice.cost_centre_id} has no branch GST state code — cannot mint a bill number`);
    }

    const billNo = await clientBillingNumberingService.mintBillNumber(
      costCentre.stateCode, costCentre.companyName, invoice.finance_year
    );

    if (input.poNumbers && input.poNumbers.length > 0) {
      const placeholders = input.poNumbers.map(() => "?").join(", ");
      const [poRows] = await conn.execute<RowDataPacket[]>(
        `SELECT id, balance_amount FROM client_po_number WHERE po_number IN (${placeholders}) AND cost_centre_id = ?`,
        [...input.poNumbers, invoice.cost_centre_id]
      );
      let remaining = Number(invoice.grand_total);
      for (const po of poRows as Array<{ id: string; balance_amount: number }>) {
        const consume = Math.min(remaining, Number(po.balance_amount));
        await conn.execute(
          `UPDATE client_po_number SET balance_amount = balance_amount - ? WHERE id = ?`,
          [consume, po.id]
        );
        await conn.execute(
          `INSERT INTO client_po_particular (id, po_id, invoice_id, amount_consumed) VALUES (?, ?, ?, ?)`,
          [randomUUID(), po.id, input.invoiceId, consume]
        );
        remaining -= consume;
        if (remaining <= 0) break;
      }
    }

    await conn.execute(
      `UPDATE client_invoice SET invoice_status = 'approved', bill_no = ? WHERE id = ?`,
      [billNo, input.invoiceId]
    );

    await conn.execute(
      `INSERT INTO client_invoice_audit_log (id, invoice_id, action, actor_id) VALUES (?, ?, 'approved', ?)`,
      [randomUUID(), input.invoiceId, input.userId]
    );

    await conn.commit();
    return { id: input.invoiceId, billNo, invoiceStatus: "approved" };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export const clientBillingApprovalService = { approveInvoice };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/client-billing/__tests__/client-billing-approval.service.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify the balance-mutation SQL against live MySQL**

Run from `backend/` (same host fallback rule as Task 1):
```bash
node -e "
import('mysql2/promise').then(async (m) => {
  const conn = await m.createConnection({host:'192.168.10.6',port:3306,user:'shivam_user',password:process.env.DB_PASSWORD,database:'mas_hrms',connectTimeout:15000}); // DB_PASSWORD from backend/.env — never hardcode this, see the Connection note above
  await conn.query('DROP TABLE IF EXISTS x_po_check');
  await conn.query('CREATE TABLE x_po_check (id CHAR(36) PRIMARY KEY, balance_amount DECIMAL(14,2))');
  const { randomUUID } = await import('crypto');
  const id = randomUUID();
  await conn.execute('INSERT INTO x_po_check (id, balance_amount) VALUES (?, ?)', [id, 40000]);
  await conn.execute('UPDATE x_po_check SET balance_amount = balance_amount - ? WHERE id = ?', [35400, id]);
  const [rows] = await conn.query('SELECT balance_amount FROM x_po_check WHERE id = ?', [id]);
  console.log('balance after consume:', rows[0].balance_amount, '-- expected 4600.00');
  await conn.query('DROP TABLE x_po_check');
  await conn.end();
});
"
```
Expected: `balance after consume: 4600.00 -- expected 4600.00`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/client-billing/client-billing-approval.service.ts backend/src/modules/client-billing/__tests__/client-billing-approval.service.test.ts
git commit -m "feat(client-billing): add approveInvoice service (bill number mint, PO consumption)"
```

---

### Task 3: Reject service

**Files:**
- Modify: `backend/src/modules/client-billing/client-billing-approval.service.ts`
- Modify: `backend/src/modules/client-billing/__tests__/client-billing-approval.service.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  interface RejectInvoiceInput { invoiceId: string; reason: string; userId: string; }
  interface RejectInvoiceResult { id: string; invoiceStatus: "rejected"; }
  ```
  `clientBillingApprovalService.rejectInvoice(input: RejectInvoiceInput): Promise<RejectInvoiceResult>` — Task 4's routes consume this directly.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/modules/client-billing/__tests__/client-billing-approval.service.test.ts`:

```typescript
describe("rejectInvoice", () => {
  it("requires a non-empty reason", async () => {
    const conn = mockConnection();

    await expect(
      clientBillingApprovalService.rejectInvoice({ invoiceId: "inv-1", reason: "", userId: "u-1" })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/reason is required/) });

    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  it("refuses when the invoice is already rejected", async () => {
    const conn = mockConnection();
    conn.execute.mockResolvedValueOnce([[{ id: "inv-1", invoice_status: "rejected" }], []]);

    await expect(
      clientBillingApprovalService.rejectInvoice({ invoiceId: "inv-1", reason: "duplicate entry", userId: "u-1" })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/already rejected/) });
  });

  it("refunds every linked provision deduction, marks the invoice rejected, and writes one audit row", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[{ id: "inv-1", invoice_status: "approved" }], []]) // invoice lookup
      .mockResolvedValueOnce([[ // deductions for this invoice
        { id: "ded-1", provision_id: "prov-1", amount_used: 5000 },
        { id: "ded-2", provision_id: "prov-2", amount_used: 3000 },
      ], []])
      .mockResolvedValueOnce([{}, []]) // refund provision 1
      .mockResolvedValueOnce([{}, []]) // delete deduction 1
      .mockResolvedValueOnce([{}, []]) // refund provision 2
      .mockResolvedValueOnce([{}, []]) // delete deduction 2
      .mockResolvedValueOnce([{}, []]) // UPDATE client_invoice
      .mockResolvedValueOnce([{}, []]); // INSERT audit log

    const result = await clientBillingApprovalService.rejectInvoice({
      invoiceId: "inv-1", reason: "client disputed the charge", userId: "u-1",
    });

    expect(result).toEqual({ id: "inv-1", invoiceStatus: "rejected" });

    const refund1 = conn.execute.mock.calls[2];
    expect(String(refund1[0])).toMatch(/UPDATE client_provision SET provision_balance = provision_balance \+ \?/);
    expect(refund1[1]).toEqual([5000, "prov-1"]);

    const refund2 = conn.execute.mock.calls[4];
    expect(refund2[1]).toEqual([3000, "prov-2"]);

    const auditCall = conn.execute.mock.calls[7];
    expect(String(auditCall[0])).toMatch(/INSERT INTO client_invoice_audit_log/);
    expect(auditCall[1]).toEqual(expect.arrayContaining(["inv-1", "rejected", "u-1", "client disputed the charge"]));

    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it("works with zero linked deductions (a proforma never drew any provision)", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[{ id: "inv-1", invoice_status: "proforma" }], []])
      .mockResolvedValueOnce([[], []]) // no deductions
      .mockResolvedValueOnce([{}, []]) // UPDATE client_invoice
      .mockResolvedValueOnce([{}, []]); // INSERT audit log

    const result = await clientBillingApprovalService.rejectInvoice({
      invoiceId: "inv-1", reason: "no longer needed", userId: "u-1",
    });
    expect(result).toEqual({ id: "inv-1", invoiceStatus: "rejected" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/client-billing/__tests__/client-billing-approval.service.test.ts`
Expected: FAIL — `clientBillingApprovalService.rejectInvoice is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `backend/src/modules/client-billing/client-billing-approval.service.ts`, above the final `export const clientBillingApprovalService = { approveInvoice };` line (replace that line with the version below):

```typescript
export interface RejectInvoiceInput {
  invoiceId: string;
  reason: string;
  userId: string;
}

export interface RejectInvoiceResult {
  id: string;
  invoiceStatus: "rejected";
}

async function rejectInvoice(input: RejectInvoiceInput): Promise<RejectInvoiceResult> {
  if (!input.reason || input.reason.trim().length === 0) {
    throw clientError("A reason is required to reject an invoice");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [invoiceRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, invoice_status FROM client_invoice WHERE id = ? LIMIT 1`,
      [input.invoiceId]
    );
    const invoice = invoiceRows[0] as { id: string; invoice_status: string } | undefined;
    if (!invoice) {
      throw clientError(`Invoice ${input.invoiceId} not found`);
    }
    if (invoice.invoice_status === "rejected") {
      throw clientError(`Invoice ${input.invoiceId} is already rejected`);
    }

    const [deductionRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, provision_id, amount_used FROM client_provision_deduction WHERE invoice_id = ?`,
      [input.invoiceId]
    );
    for (const deduction of deductionRows as Array<{ id: string; provision_id: string; amount_used: number }>) {
      await conn.execute(
        `UPDATE client_provision SET provision_balance = provision_balance + ? WHERE id = ?`,
        [deduction.amount_used, deduction.provision_id]
      );
      await conn.execute(`DELETE FROM client_provision_deduction WHERE id = ?`, [deduction.id]);
    }

    await conn.execute(
      `UPDATE client_invoice SET invoice_status = 'rejected', rejected_reason = ?, rejected_by = ?, rejected_at = NOW() WHERE id = ?`,
      [input.reason, input.userId, input.invoiceId]
    );

    await conn.execute(
      `INSERT INTO client_invoice_audit_log (id, invoice_id, action, actor_id, reason) VALUES (?, ?, 'rejected', ?, ?)`,
      [randomUUID(), input.invoiceId, input.userId, input.reason]
    );

    await conn.commit();
    return { id: input.invoiceId, invoiceStatus: "rejected" };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export const clientBillingApprovalService = { approveInvoice, rejectInvoice };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/client-billing/__tests__/client-billing-approval.service.test.ts`
Expected: PASS, 10 tests (6 from Task 2 + 4 from this task).

- [ ] **Step 5: Verify the refund SQL against live MySQL**

```bash
node -e "
import('mysql2/promise').then(async (m) => {
  const conn = await m.createConnection({host:'192.168.10.6',port:3306,user:'shivam_user',password:process.env.DB_PASSWORD,database:'mas_hrms',connectTimeout:15000}); // DB_PASSWORD from backend/.env — never hardcode this, see the Connection note above
  await conn.query('DROP TABLE IF EXISTS x_prov_check');
  await conn.query('CREATE TABLE x_prov_check (id CHAR(36) PRIMARY KEY, provision_balance DECIMAL(14,2))');
  const { randomUUID } = await import('crypto');
  const id = randomUUID();
  await conn.execute('INSERT INTO x_prov_check (id, provision_balance) VALUES (?, ?)', [id, 10000]);
  await conn.execute('UPDATE x_prov_check SET provision_balance = provision_balance - ? WHERE id = ?', [5000, id]);
  await conn.execute('UPDATE x_prov_check SET provision_balance = provision_balance + ? WHERE id = ?', [5000, id]);
  const [rows] = await conn.query('SELECT provision_balance FROM x_prov_check WHERE id = ?', [id]);
  console.log('balance after deduct-then-refund:', rows[0].provision_balance, '-- expected 10000.00 (back to original)');
  await conn.query('DROP TABLE x_prov_check');
  await conn.end();
});
"
```
Expected: `balance after deduct-then-refund: 10000.00 -- expected 10000.00 (back to original)`. This is the direct proof the refund is additive, unlike legacy's bug.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/client-billing/client-billing-approval.service.ts backend/src/modules/client-billing/__tests__/client-billing-approval.service.test.ts
git commit -m "feat(client-billing): add rejectInvoice service (correct provision refund, audit log)"
```

---

### Task 4: Routes

**Files:**
- Modify: `backend/src/modules/client-billing/client-billing.routes.ts`
- Modify: `backend/src/modules/client-billing/__tests__/client-billing.routes.test.ts`

**Interfaces:**
- Consumes: `clientBillingApprovalService.approveInvoice`, `clientBillingApprovalService.rejectInvoice` (Tasks 2-3), `db.execute` for the audit-log read route.
- Produces: 3 new routes on the existing `clientBillingRouter`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/modules/client-billing/__tests__/client-billing.routes.test.ts`. First add this mock near the top of the file, alongside the existing `vi.mock("../client-billing.service.js", ...)` block:

```typescript
const { approveInvoice, rejectInvoice } = vi.hoisted(() => ({ approveInvoice: vi.fn(), rejectInvoice: vi.fn() }));
vi.mock("../client-billing-approval.service.js", () => ({
  clientBillingApprovalService: { approveInvoice, rejectInvoice },
}));
```

Then append these test blocks (inside the same file, after the existing `describe` blocks):

```typescript
describe("POST /api/client-billing/invoices/:id/approve", () => {
  beforeEach(() => {
    approveInvoice.mockReset();
  });

  it("approves and returns the bill number", async () => {
    approveInvoice.mockResolvedValueOnce({ id: "inv-1", billNo: "09-01/26-27", invoiceStatus: "approved" });

    const res = await request(app).post("/api/client-billing/invoices/inv-1/approve").send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: "inv-1", billNo: "09-01/26-27", invoiceStatus: "approved" } });
    expect(approveInvoice).toHaveBeenCalledWith({ invoiceId: "inv-1", poNumbers: undefined, userId: "u-1" });
  });

  it("passes poNumbers through when supplied", async () => {
    approveInvoice.mockResolvedValueOnce({ id: "inv-1", billNo: "09-01/26-27", invoiceStatus: "approved" });

    await request(app).post("/api/client-billing/invoices/inv-1/approve").send({ poNumbers: ["PO1", "PO2"] });

    expect(approveInvoice).toHaveBeenCalledWith({ invoiceId: "inv-1", poNumbers: ["PO1", "PO2"], userId: "u-1" });
  });

  it("surfaces a service statusCode error via the shared error handler", async () => {
    approveInvoice.mockRejectedValueOnce(Object.assign(new Error("Invoice inv-1 is not in proforma status"), { statusCode: 400 }));

    const res = await request(app).post("/api/client-billing/invoices/inv-1/approve").send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not in proforma status/);
  });
});

describe("POST /api/client-billing/invoices/:id/reject", () => {
  beforeEach(() => {
    rejectInvoice.mockReset();
  });

  it("returns 400 when reason is missing from the request body", async () => {
    const res = await request(app).post("/api/client-billing/invoices/inv-1/reject").send({});
    expect(res.status).toBe(400);
    expect(rejectInvoice).not.toHaveBeenCalled();
  });

  it("rejects and returns the updated status", async () => {
    rejectInvoice.mockResolvedValueOnce({ id: "inv-1", invoiceStatus: "rejected" });

    const res = await request(app)
      .post("/api/client-billing/invoices/inv-1/reject")
      .send({ reason: "client disputed the charge" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: "inv-1", invoiceStatus: "rejected" } });
    expect(rejectInvoice).toHaveBeenCalledWith({ invoiceId: "inv-1", reason: "client disputed the charge", userId: "u-1" });
  });
});

describe("GET /api/client-billing/invoices/:id/audit-log", () => {
  it("lists audit rows for one invoice", async () => {
    execute.mockResolvedValueOnce([[
      { id: "log-1", invoice_id: "inv-1", action: "created", actor_id: "u-1" },
      { id: "log-2", invoice_id: "inv-1", action: "approved", actor_id: "u-2" },
    ], []]);

    const res = await request(app).get("/api/client-billing/invoices/inv-1/audit-log");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/client-billing/__tests__/client-billing.routes.test.ts`
Expected: FAIL — `Cannot find module '../client-billing-approval.service.js'` (the mock target doesn't exist as a route yet) or the new routes 404.

- [ ] **Step 3: Write the implementation**

Add to `backend/src/modules/client-billing/client-billing.routes.ts`. First, add the import near the top alongside the existing `clientBillingService` import:

```typescript
import { clientBillingApprovalService } from "./client-billing-approval.service.js";
```

Then append these three routes, after the existing `GET /proformas/:id` route and before `export { router as clientBillingRouter };`:

```typescript
router.post(
  "/invoices/:id/approve",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as { poNumbers?: string[] };
    const data = await clientBillingApprovalService.approveInvoice({
      invoiceId: req.params.id,
      poNumbers: body.poNumbers,
      userId: req.authUser!.id,
    });
    res.json({ success: true, data });
  })
);

router.post(
  "/invoices/:id/reject",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as { reason?: string };
    if (!body.reason || body.reason.trim().length === 0) {
      return res.status(400).json({ error: "reason is required" });
    }
    const data = await clientBillingApprovalService.rejectInvoice({
      invoiceId: req.params.id,
      reason: body.reason,
      userId: req.authUser!.id,
    });
    res.json({ success: true, data });
  })
);

router.get(
  "/invoices/:id/audit-log",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM client_invoice_audit_log WHERE invoice_id = ? ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  })
);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/client-billing`
Expected: PASS, all tests across all 5 test files in the module (the pre-existing 23 plus this task's new ones).

- [ ] **Step 5: Scoped typecheck**

Run: `cd backend && npx tsc --noEmit -p . 2>&1 | grep -i client-billing`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/client-billing/client-billing.routes.ts backend/src/modules/client-billing/__tests__/client-billing.routes.test.ts
git commit -m "feat(client-billing): add approve/reject/audit-log routes"
```

---

## Self-Review

**Spec coverage:** §4 (all 5 tables) — Task 1. §5 `approveInvoice` (status guard, PO validation/consumption, bill number mint, audit log) — Task 2. §5 `rejectInvoice` (reason required, provision refund, audit log) — Task 3. §6 (3 routes) — Task 4. §3 (no provision/PO CRUD) — respected, nothing in this plan creates provision/PO rows outside the tests' own setup. §5 step 4 (frozen snapshot copy) — explicitly dropped with reasoning documented at the top of this plan, not silently omitted. §7 (live-MySQL verification discipline) — a verification step is present in Tasks 1-3 wherever new SQL is introduced.

**Placeholder scan:** no TBD/TODO; every step has complete, runnable code.

**Type consistency:** `ApproveInvoiceInput`/`ApproveInvoiceResult`/`RejectInvoiceInput`/`RejectInvoiceResult` (Tasks 2-3) match exactly what Task 4's routes construct and destructure. `clientBillingNumberingService.mintBillNumber(stateCode, companyName, financeYear)` call in Task 2 matches its actual signature from the foundation phase. Column names in Task 1's migration match every SQL string in Tasks 2-3 exactly (`provision_balance`, `balance_amount`, `amount_used`, `amount_consumed`, `rejected_reason`/`rejected_by`/`rejected_at` — the last three already existed on `client_invoice` from the foundation migration, confirmed against that file).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-19-client-billing-approval-workflow.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
