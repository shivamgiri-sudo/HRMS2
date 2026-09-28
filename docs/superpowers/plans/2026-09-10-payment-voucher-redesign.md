# Payment Voucher Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder the raise form to vendor-first, remove the Reason field, give the CEO a third "Request Changes" action that round-trips to Finance Head, notify the right person at each stage, and make voucher release write into Vendor Payment Tracking through its own real payment-dispatch path (ledger row + TDS calc) instead of a thinner, divergent one.

**Architecture:** One schema migration (new voucher status + 3 columns), one small backward-compatible change to `vendor-payment-ledger.service.ts` (optional external-connection param, mirroring the exact pattern `vendor-payment.service.ts`'s `updatePayment` already uses), a rewrite of `payment-voucher.service.ts`'s `release()` vendor_grn branch to call it, two new service methods (`requestChanges`, `resubmit`) with notification producer calls reusing the exact `inboxService`/`resolveRoleHolderUserIds` pattern GRN and Vendor Payment already use, two new routes, and frontend changes to `PaymentVouchersPage.tsx`.

**Tech Stack:** Express + TypeScript + MySQL (mysql2), vitest with `db` mocked via `vi.mock`, React + TanStack Query + shadcn/ui.

## Global Constraints

- Spec: agreed via conversation 2026-09-10 — vendor-first GRN selection (not a combined-balance payment), keep today's Ledger Heads (no new sub-head field), Accounts Head stays the releaser, CEO's "Request Changes" sends the voucher back to Finance Head to edit and resubmit.
- Never a free-text `Input` on a closed set — vendor, ledger head, payment mode stay `Select`.
- Notification recipient for "payment to be made" is **Accounts Head** (the actual releaser), not Finance Head — corrected during design from the original ask, which said Finance Head but also confirmed Accounts Head keeps releasing.
- No push/deploy without explicit user approval — commit locally only until told otherwise.
- Stage files by explicit path, never `git add -A`.
- Migrations additive and guarded (information_schema PREPARE/EXECUTE) per this repo's convention.

---

## File Structure

**Backend — new:**
- `backend/sql/1714_payment_voucher_changes_requested.sql`
- `backend/src/modules/finance/__tests__/vendor-payment-ledger.service.test.ts`
- `backend/src/modules/finance/__tests__/payment-voucher.service.test.ts`

**Backend — modified:**
- `backend/src/modules/finance/vendor-payment-ledger.service.ts` — `dispatch()` gains an optional `externalConnection` param.
- `backend/src/modules/finance/payment-voucher.service.ts` — `release()`'s vendor_grn branch calls `dispatch()`; `ceoApprove()`'s decision union gains `"request_changes"`; new `resubmit()` method; notification calls added to `raise()`, `ceoApprove()`, `release()`.
- `backend/src/modules/finance/payment-voucher.routes.ts` — new `POST /:id/resubmit` route (request-changes reuses the existing `/ceo-approve` route with `decision: "request_changes"`).

**Frontend — modified:**
- `src/pages/finance/PaymentVouchersPage.tsx` — vendor-first raise form, Reason field removed, CEO "Request Changes" action, resubmit flow for Finance Head.

---

### Task 1: Schema — `changes_requested` status and columns

**Files:**
- Create: `backend/sql/1714_payment_voucher_changes_requested.sql`

**Interfaces:**
- Produces: `payment_voucher.status` ENUM gains `'changes_requested'`; new columns `changes_requested_by CHAR(36) NULL`, `changes_requested_at DATETIME NULL`, `changes_requested_note TEXT NULL`.

- [ ] **Step 1: Write the migration**

```sql
-- 1714_payment_voucher_changes_requested.sql
--
-- Payment Voucher redesign, 2026-09-10. Adds a third CEO decision path alongside
-- approve/reject: "Request Changes" — the CEO sends the voucher back to whoever raised it
-- (e.g. "use the HDFC account instead") rather than either approving it as-is or killing it
-- outright with reject. changes_requested_note carries that instruction; Finance Head edits
-- and resubmits via payment-voucher.service.ts's resubmit(), which moves the voucher back to
-- 'raised' for a fresh CEO decision. Guarded PREPARE/EXECUTE per this repo's ALTER convention
-- — MySQL 8 has no ADD COLUMN IF NOT EXISTS, and a bare MODIFY on the ENUM would fail loudly
-- were this migration ever replayed after the column already carries the new value.
SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_voucher'
     AND COLUMN_NAME = 'changes_requested_note'
);
SET @sql := IF(@has_col = 0,
  'ALTER TABLE payment_voucher
     MODIFY COLUMN status ENUM(''draft'',''raised'',''ceo_approved'',''rejected'',''released'',''changes_requested'') NOT NULL DEFAULT ''draft'',
     ADD COLUMN changes_requested_by CHAR(36) NULL AFTER rejection_reason,
     ADD COLUMN changes_requested_at DATETIME NULL AFTER changes_requested_by,
     ADD COLUMN changes_requested_note TEXT NULL AFTER changes_requested_at',
  'SELECT ''1714 columns already exist'' AS migration_status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT '1714_payment_voucher_changes_requested.sql applied' AS migration_status;
```

- [ ] **Step 2: Apply it and verify**

```bash
cd backend
node -e "
import('dotenv/config').then(async () => {
  const mysql = (await import('mysql2/promise')).default;
  const fs = await import('fs');
  const conn = await mysql.createConnection({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, multipleStatements: true });
  const [rows] = await conn.query(fs.readFileSync('sql/1714_payment_voucher_changes_requested.sql', 'utf8'));
  console.log(JSON.stringify(rows[rows.length-1]));
  const [cols] = await conn.query('DESCRIBE payment_voucher');
  console.log(cols.filter(c => c.Field.startsWith('changes_requested')).map(c => c.Field));
  await conn.end();
});
"
```
Expected: `... applied`, and the three `changes_requested_*` column names printed.

- [ ] **Step 3: Add to `MIGRATION_MANIFEST` in `backend/src/db/runPendingMigrations.ts`**

Add one line, next to the other Payment Voucher entries (after `1713_finance_masters_page_access.sql`):
```typescript
  "1714_payment_voucher_changes_requested.sql", // Registered 2026-09-10. Payment Voucher redesign — adds status='changes_requested' plus changes_requested_by/at/note, the CEO's third decision path (alongside approve/reject) that sends a voucher back to whoever raised it to edit and resubmit, rather than rejecting it outright. Additive: one ENUM value, three nullable columns, information_schema-guarded.
```

- [ ] **Step 4: Commit**

```bash
git add backend/sql/1714_payment_voucher_changes_requested.sql backend/src/db/runPendingMigrations.ts
git commit -m "Payment Voucher redesign: changes_requested status and columns"
```

---

### Task 2: `dispatch()` gains an optional external-connection parameter

**Files:**
- Modify: `backend/src/modules/finance/vendor-payment-ledger.service.ts:128-353` (the `dispatch` method)
- Test: `backend/src/modules/finance/__tests__/vendor-payment-ledger.service.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `dispatch(paymentId: string, payload: DispatchPaymentPayload, actorUserId: string, actorRole?: string, externalConnection?: PoolConnection)`. When `externalConnection` is passed, `dispatch` does NOT call `beginTransaction`/`commit`/`release` on it (the caller owns the transaction) but still does everything else identically — same exact shape `vendor-payment.service.ts`'s `updatePayment` already uses (`const owns = !externalConnection; const connection = externalConnection ?? await db.getConnection();`, guard `beginTransaction`/`commit`/`release` with `if (owns)`).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/modules/finance/__tests__/vendor-payment-ledger.service.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, query, getConnection, logSensitiveAction } = vi.hoisted(() => ({
  execute: vi.fn(),
  query: vi.fn(),
  getConnection: vi.fn(),
  logSensitiveAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute, query, getConnection } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));

import { vendorPaymentLedgerService } from "../vendor-payment-ledger.service.js";

function mockConnection() {
  return {
    execute: vi.fn(),
    query: vi.fn(),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };
}

beforeEach(() => { execute.mockReset(); query.mockReset(); getConnection.mockReset(); logSensitiveAction.mockClear(); });

describe("vendorPaymentLedgerService.dispatch with an external connection", () => {
  it("never opens its own connection or calls beginTransaction/commit/release when one is passed in", async () => {
    const conn = mockConnection();
    conn.execute
      .mockResolvedValueOnce([[{ id: "pay-1", payment_status: "Payment Pending", paid_amount: 0, due_amount: 1000, balance_amount: 1000, grn_request_id: "grn-1", tds_deducted_amount: 0 }]]) // lockedPayment
      .mockResolvedValueOnce([[{ tds_enabled: 0, tds_rate: 0, tds_section: null }]]) // vendor TDS lookup
      .mockResolvedValueOnce([[{ last_sequence: 0 }]]) // sequence
      .mockResolvedValueOnce([{}]) // INSERT vendor_payment_transaction
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE vendor_payment_tracking
      .mockResolvedValueOnce([{}]) // UPDATE grn_request
      .mockResolvedValueOnce([{}]); // writeAudit INSERT

    await vendorPaymentLedgerService.dispatch(
      "pay-1",
      { paymentMode: "Cash", paymentDate: "2026-09-01", paymentAmount: 500, remarks: "test" },
      "actor-1", "accounts_head", conn as any,
    );

    expect(getConnection).not.toHaveBeenCalled();
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).not.toHaveBeenCalled();
  });

  it("still opens, commits, and releases its own connection when none is passed (unchanged behavior)", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute
      .mockResolvedValueOnce([[{ id: "pay-1", payment_status: "Payment Pending", paid_amount: 0, due_amount: 1000, balance_amount: 1000, grn_request_id: "grn-1", tds_deducted_amount: 0 }]])
      .mockResolvedValueOnce([[{ tds_enabled: 0, tds_rate: 0, tds_section: null }]])
      .mockResolvedValueOnce([[{ last_sequence: 0 }]])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}]);

    await vendorPaymentLedgerService.dispatch(
      "pay-1",
      { paymentMode: "Cash", paymentDate: "2026-09-01", paymentAmount: 500, remarks: "test" },
      "actor-1", "accounts_head",
    );

    expect(getConnection).toHaveBeenCalledTimes(1);
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/finance/__tests__/vendor-payment-ledger.service.test.ts`
Expected: the first test FAILs (`getConnection` was called, or `conn.beginTransaction` was called) since `dispatch` doesn't yet accept a 5th parameter.

- [ ] **Step 3: Modify `dispatch()`**

In `backend/src/modules/finance/vendor-payment-ledger.service.ts`, change the method signature (currently at line 128-133):
```typescript
  async dispatch(
    paymentId: string,
    payload: DispatchPaymentPayload,
    actorUserId: string,
    actorRole?: string,
    externalConnection?: PoolConnection,
  ) {
```
Right after the existing validation block (mode/date/amount checks, before `const connection = await db.getConnection();` at the current line ~144), replace that line with:
```typescript
    const owns = !externalConnection;
    const connection = externalConnection ?? await db.getConnection();
```
Then guard the three lifecycle calls already in the method:
- `await connection.beginTransaction();` → `if (owns) await connection.beginTransaction();`
- `await connection.commit();` → `if (owns) await connection.commit();`
- In the `finally` block, `connection.release();` → `if (owns) connection.release();` (keep the existing `RELEASE_LOCK` call unconditional — that's a DB-level advisory lock, not connection ownership, and must always run regardless of who owns the connection).

Add `PoolConnection` to the existing `mysql2/promise` type import at the top of the file if not already imported (check the file's current import line — `vendor-payment.service.ts` imports it as `import type { PoolConnection } from "mysql2/promise";`, mirror that exactly).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/finance/__tests__/vendor-payment-ledger.service.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/finance/vendor-payment-ledger.service.ts backend/src/modules/finance/__tests__/vendor-payment-ledger.service.test.ts
git commit -m "vendor-payment-ledger: dispatch() accepts an optional external connection"
```

---

### Task 3: `release()` uses `dispatch()` instead of the thinner `updatePayment()` path

**Files:**
- Modify: `backend/src/modules/finance/payment-voucher.service.ts:1-9` (imports), `:443-531` (the vendor_grn branch of `release()`)
- Test: `backend/src/modules/finance/__tests__/payment-voucher.service.test.ts`

**Interfaces:**
- Consumes: `vendorPaymentLedgerService.dispatch(paymentId, payload, actorUserId, actorRole, externalConnection)` from Task 2, returning `{ payment: {...}, transactions: Array<{ tds_amount: number, ... }> }`.
- Produces: `release()`'s public signature is unchanged.

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/modules/finance/__tests__/payment-voucher.service.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, getConnection, logSensitiveAction, recordFinanceApprovalEvent, dispatch } = vi.hoisted(() => ({
  execute: vi.fn(),
  getConnection: vi.fn(),
  logSensitiveAction: vi.fn().mockResolvedValue(undefined),
  recordFinanceApprovalEvent: vi.fn().mockResolvedValue(undefined),
  dispatch: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));
vi.mock("../../../shared/financeApprovalEvent.js", () => ({
  recordFinanceApprovalEvent,
  listFinanceApprovalEvents: vi.fn().mockResolvedValue([]),
}));
vi.mock("../vendor-payment-ledger.service.js", () => ({ vendorPaymentLedgerService: { dispatch } }));
vi.mock("../imprest-ledger.service.js", () => ({ imprestLedgerService: { post: vi.fn() } }));
vi.mock("../imprest.service.js", () => ({ imprestService: {} }));

import { paymentVoucherService } from "../payment-voucher.service.js";

function mockConnection() {
  return {
    execute: vi.fn(),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };
}

const VOUCHER_ROW = {
  id: "pv-1", voucher_number: "PV/HQ/202609/0001", source_type: "vendor_grn",
  bank_account_id: "acct-1", payable_account_id: "pam-1", linked_vendor_payment_id: "vpt-1",
  amount: "5000.00", status: "ceo_approved", raised_by: "fh-1", ceo_approved_by: "ceo-1", released_by: null,
};

beforeEach(() => { execute.mockReset(); getConnection.mockReset(); logSensitiveAction.mockClear(); recordFinanceApprovalEvent.mockClear(); dispatch.mockReset(); });

describe("paymentVoucherService.release — vendor_grn branch", () => {
  it("calls vendorPaymentLedgerService.dispatch with the voucher amount and this transaction's connection, not updatePayment", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute
      .mockResolvedValueOnce([[VOUCHER_ROW]]) // SELECT voucher FOR UPDATE
      .mockResolvedValueOnce([[{ id: "acct-1", bank_id: "bank-5", branch_id: "b1", opening_balance: 100000, active_status: 1 }]]) // bank account
      .mockResolvedValueOnce([[{ running_balance: 100000 }]]) // last ledger entry
      .mockResolvedValueOnce([{}]) // INSERT bank_account_ledger_entry (cash movement)
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE payment_voucher SET status='released'
      .mockResolvedValueOnce([{}]); // writeVoucherAudit
    dispatch.mockResolvedValueOnce({
      payment: { id: "vpt-1" },
      transactions: [{ tds_amount: 0 }],
    });

    await paymentVoucherService.release("pv-1", "ah-1", "accounts_head", { paymentMode: "NEFT", paymentDate: "2026-09-10", transactionRef: "UTR123" });

    expect(dispatch).toHaveBeenCalledWith(
      "vpt-1",
      expect.objectContaining({ paymentMode: "NEFT", paymentDate: "2026-09-10", paymentAmount: 5000, transactionId: "UTR123" }),
      "ah-1", "accounts_head", conn,
    );
  });

  it("books a TDS memo ledger entry sized to what dispatch() actually withheld for this installment", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute
      .mockResolvedValueOnce([[VOUCHER_ROW]])
      .mockResolvedValueOnce([[{ id: "acct-1", bank_id: "bank-5", branch_id: "b1", opening_balance: 100000, active_status: 1 }]])
      .mockResolvedValueOnce([[{ running_balance: 100000 }]])
      .mockResolvedValueOnce([{}]) // cash movement entry
      .mockResolvedValueOnce([[{ id: "tds-account-id" }]]) // SELECT TDS Payable payable_account_master
      .mockResolvedValueOnce([{}]) // INSERT TDS memo entry
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);
    dispatch.mockResolvedValueOnce({
      payment: { id: "vpt-1" },
      transactions: [{ tds_amount: 250 }],
    });

    await paymentVoucherService.release("pv-1", "ah-1", "accounts_head", { paymentMode: "NEFT", paymentDate: "2026-09-10", transactionRef: "UTR124" });

    expect(conn.execute).toHaveBeenCalledWith(
      expect.stringMatching(/SELECT id FROM payable_account_master WHERE account_name = 'TDS Payable'/),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/finance/__tests__/payment-voucher.service.test.ts`
Expected: FAIL — `release()` still calls `vendorPaymentService.updatePayment`, never `dispatch`.

- [ ] **Step 3: Rewrite the vendor_grn branch**

In `backend/src/modules/finance/payment-voucher.service.ts`, change the import at the top (line 7):
```typescript
import { vendorPaymentLedgerService } from "./vendor-payment-ledger.service.js";
```
(remove the now-unused `vendorPaymentService` import only if nothing else in the file still uses it — check with `grep -n "vendorPaymentService\." backend/src/modules/finance/payment-voucher.service.ts` after this edit; if the only remaining use was in `release()`, remove the import line entirely rather than leaving an unused import.)

Replace the whole `if (v.source_type === "vendor_grn") { ... }` block (current lines 443-531) with:
```typescript
      if (v.source_type === "vendor_grn") {
        const dispatchResult = await vendorPaymentLedgerService.dispatch(
          v.linked_vendor_payment_id,
          {
            paymentMode: paymentMode as any,
            paymentDate,
            bankId: (bankAccount as any).bank_id,
            transactionId: transactionRef,
            paymentAmount: amount,
            remarks: `Released via Payment Voucher ${v.voucher_number}`,
          },
          actorUserId,
          actorRole,
          connection,
        );
        const lastTransaction = dispatchResult.transactions[dispatchResult.transactions.length - 1];
        const grnNumberForNarration = (dispatchResult.payment as any)?.grn_number ?? "";

        runningBalance = roundMoney(runningBalance - amount);
        await connection.execute(
          `INSERT INTO bank_account_ledger_entry
             (id, bank_account_id, entry_date, voucher_id, debit_amount, credit_amount,
              payable_account_id, narration, instrument_ref, running_balance, source_type, created_by)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'voucher', ?)`,
          [
            randomUUID(),
            v.bank_account_id,
            paymentDate,
            id,
            amount,
            v.payable_account_id,
            `Vendor payment released — GRN ${grnNumberForNarration} — voucher ${v.voucher_number}`.trim(),
            transactionRef,
            runningBalance,
            actorUserId,
          ],
        );

        // TDS withheld is not cash leaving the bank — it never touches running_balance. There is
        // no general-ledger/journal table in this schema yet, so this row is booked as a
        // zero-cash memo against "TDS Payable" purely so the liability is visible next to the
        // payment that created it — debit=credit=0 is deliberate, not a bug. Sized to what
        // dispatch() actually computed for THIS installment (not a one-time "first release only"
        // heuristic like the code this replaced — dispatch() now calculates TDS per installment,
        // which is correct for partial/multiple releases against the same GRN).
        const tds = roundMoney(Number(lastTransaction?.tds_amount ?? 0));
        if (tds > 0) {
          const [[tdsAccount]] = await connection.execute<RowDataPacket[]>(
            `SELECT id FROM payable_account_master WHERE account_name = 'TDS Payable' LIMIT 1`,
          );
          if (tdsAccount) {
            await connection.execute(
              `INSERT INTO bank_account_ledger_entry
                 (id, bank_account_id, entry_date, voucher_id, debit_amount, credit_amount,
                  payable_account_id, narration, instrument_ref, running_balance, source_type, created_by)
               VALUES (?, ?, ?, ?, 0, 0, ?, ?, NULL, ?, 'voucher', ?)`,
              [
                randomUUID(),
                v.bank_account_id,
                paymentDate,
                id,
                (tdsAccount as any).id,
                `TDS withheld on GRN ${grnNumberForNarration} — voucher ${v.voucher_number} (liability memo, no cash movement)`.trim(),
                runningBalance,
                actorUserId,
              ],
            );
          }
        }
      } else {
```
(the `else` here is the existing `imprest_allocation` branch immediately below — leave it untouched, just make sure the brace structure lines up: the old code's `if (v.source_type === "vendor_grn") { ... } else { /* imprest */ }` shape is preserved, only the inside of the `if` block changes.)

This removes the old manual `newPaidAmount`/overpay pre-check entirely — `dispatch()` now does that check itself (`"Payment amount X exceeds outstanding balance Y"`), so keeping a duplicate check here would just be dead code that could disagree with dispatch()'s own math.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/finance/__tests__/payment-voucher.service.test.ts`
Expected: PASS (2/2 so far — more tests added in Task 4).

- [ ] **Step 5: Typecheck**

Run: `cd backend && npx tsc --noEmit 2>&1 | grep -i "payment-voucher\|vendor-payment-ledger"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/finance/payment-voucher.service.ts backend/src/modules/finance/__tests__/payment-voucher.service.test.ts
git commit -m "payment-voucher release(): use the real vendor-payment dispatch path, not the thinner update path"
```

---

### Task 4: `requestChanges()`, `resubmit()`, and notifications

**Files:**
- Modify: `backend/src/modules/finance/payment-voucher.service.ts` (imports, `RaiseVoucherInput` stays as-is, `ceoApprove()`'s decision union, new `resubmit()` method, notification calls in `raise()`/`ceoApprove()`/`release()`)
- Test: `backend/src/modules/finance/__tests__/payment-voucher.service.test.ts` (same file as Task 3, new `describe` blocks)

**Interfaces:**
- Consumes: `inboxService.createItem(data: { user_id, type, title, description?, entity_type?, entity_id?, action_url?, priority? })`, `inboxService.resolveItems({ entity_type, entity_id, types? })`, `resolveRoleHolderUserIds(roleKey: string, branchId: string | null): Promise<string[]>` from `../../shared/recipient-resolver.js`.
- Produces: `ceoApprove(id, actorUserId, actorRole, decision: "approve" | "reject" | "request_changes", note?)` — `note` is now REQUIRED when `decision === "request_changes"`. New `resubmit(id: string, actorUserId: string, actorRole: string | undefined, updates: { bankAccountId?: string; payableAccountId?: string; amount?: number; remarks?: string | null }): Promise<VoucherRow>`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/modules/finance/__tests__/payment-voucher.service.test.ts`:

```typescript
vi.mock("../../inbox/inbox.service.js", () => ({
  inboxService: { createItem: vi.fn().mockResolvedValue(undefined), resolveItems: vi.fn().mockResolvedValue(0) },
}));
vi.mock("../../../shared/recipient-resolver.js", () => ({
  resolveRoleHolderUserIds: vi.fn().mockResolvedValue(["accounts-head-1"]),
}));

import { inboxService } from "../../inbox/inbox.service.js";

describe("paymentVoucherService.ceoApprove — request_changes", () => {
  it("requires a note", async () => {
    await expect(
      paymentVoucherService.ceoApprove("pv-1", "ceo-1", "ceo", "request_changes", ""),
    ).rejects.toThrow(/note/i);
  });

  it("sets status='changes_requested' and records who/when/why", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute
      .mockResolvedValueOnce([[{ ...VOUCHER_ROW, status: "raised", ceo_approved_by: null }]]) // SELECT FOR UPDATE
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE
      .mockResolvedValueOnce([{}]); // writeVoucherAudit

    await paymentVoucherService.ceoApprove("pv-1", "ceo-1", "ceo", "request_changes", "Please use the HDFC account instead");

    expect(conn.execute).toHaveBeenCalledWith(
      expect.stringMatching(/SET status = \?, changes_requested_by = \?, changes_requested_at = NOW\(\), changes_requested_note = \?/),
      expect.arrayContaining(["changes_requested", "ceo-1", "Please use the HDFC account instead", "pv-1"]),
    );
  });

  it("notifies the person who raised the voucher", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute
      .mockResolvedValueOnce([[{ ...VOUCHER_ROW, status: "raised", ceo_approved_by: null }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);

    await paymentVoucherService.ceoApprove("pv-1", "ceo-1", "ceo", "request_changes", "Use a different account");

    expect(inboxService.createItem).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "fh-1", type: "payment_voucher_changes_requested", entity_type: "payment_voucher", entity_id: "pv-1" }),
    );
  });
});

describe("paymentVoucherService.ceoApprove — approve, notifies Accounts Head", () => {
  it("creates an inbox item for every accounts_head role holder", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute
      .mockResolvedValueOnce([[{ ...VOUCHER_ROW, status: "raised" }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);

    await paymentVoucherService.ceoApprove("pv-1", "ceo-1", "ceo", "approve");

    expect(inboxService.createItem).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "accounts-head-1", type: "payment_voucher_ready_for_release", entity_type: "payment_voucher", entity_id: "pv-1" }),
    );
  });
});

describe("paymentVoucherService.resubmit", () => {
  it("only the original raiser may resubmit", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute.mockResolvedValueOnce([[{ ...VOUCHER_ROW, status: "changes_requested", raised_by: "fh-1" }]]);

    await expect(
      paymentVoucherService.resubmit("pv-1", "someone-else", "finance_head", {}),
    ).rejects.toThrow(/raised it/i);
  });

  it("moves the voucher back to 'raised' and clears the CEO decision fields", async () => {
    const conn = mockConnection();
    getConnection.mockResolvedValueOnce(conn);
    conn.execute
      .mockResolvedValueOnce([[{ ...VOUCHER_ROW, status: "changes_requested", raised_by: "fh-1", bank_account_id: "acct-1" }]])
      .mockResolvedValueOnce([[{ id: "acct-2", active_status: 1 }]]) // new bank account check
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE
      .mockResolvedValueOnce([{}]); // writeVoucherAudit

    await paymentVoucherService.resubmit("pv-1", "fh-1", "finance_head", { bankAccountId: "acct-2" });

    expect(conn.execute).toHaveBeenCalledWith(
      expect.stringMatching(/SET status = 'raised'.*ceo_approved_by = NULL.*changes_requested_by = NULL/s),
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/modules/finance/__tests__/payment-voucher.service.test.ts`
Expected: FAIL — `request_changes` isn't a valid decision yet, `resubmit` doesn't exist, no notification calls exist.

- [ ] **Step 3: Implement**

Add imports at the top of `backend/src/modules/finance/payment-voucher.service.ts`:
```typescript
import { inboxService } from "../inbox/inbox.service.js";
import { resolveRoleHolderUserIds } from "../../shared/recipient-resolver.js";
```

Change `ceoApprove`'s signature and body. Replace the current signature line:
```typescript
  async ceoApprove(
    id: string,
    actorUserId: string,
    actorRole: string | undefined,
    decision: "approve" | "reject",
    note?: string | null,
  ) {
```
with:
```typescript
  async ceoApprove(
    id: string,
    actorUserId: string,
    actorRole: string | undefined,
    decision: "approve" | "reject" | "request_changes",
    note?: string | null,
  ) {
    if (decision === "request_changes" && !note?.trim()) {
      throw new PaymentVoucherError("A note explaining what needs to change is required.");
    }
```
Replace the body's status-transition block (currently `const newStatus = decision === "approve" ? "ceo_approved" : "rejected"; ... UPDATE ...`) with a three-way branch. The existing code is:
```typescript
      const newStatus = decision === "approve" ? "ceo_approved" : "rejected";
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE payment_voucher
            SET status = ?, ceo_approved_by = ?, ceo_approved_at = NOW(),
                rejection_reason = ?
          WHERE id = ? AND status = 'raised'`,
        [newStatus, actorUserId, decision === "reject" ? (note?.trim() || "Rejected by CEO") : null, id],
      );
```
Replace it with:
```typescript
      const newStatus = decision === "approve" ? "ceo_approved" : decision === "reject" ? "rejected" : "changes_requested";
      const [result] = decision === "request_changes"
        ? await connection.execute<ResultSetHeader>(
            `UPDATE payment_voucher
                SET status = ?, changes_requested_by = ?, changes_requested_at = NOW(), changes_requested_note = ?
              WHERE id = ? AND status = 'raised'`,
            [newStatus, actorUserId, note!.trim(), id],
          )
        : await connection.execute<ResultSetHeader>(
            `UPDATE payment_voucher
                SET status = ?, ceo_approved_by = ?, ceo_approved_at = NOW(),
                    rejection_reason = ?
              WHERE id = ? AND status = 'raised'`,
            [newStatus, actorUserId, decision === "reject" ? (note?.trim() || "Rejected by CEO") : null, id],
          );
```
Immediately after the `await connection.commit();` line inside `ceoApprove` (still inside the method, after the try/catch/finally block, alongside the existing post-commit `logSensitiveAction` call), add the notification dispatch:
```typescript
    if (decision === "approve") {
      const recipients = await resolveRoleHolderUserIds("accounts_head", null);
      for (const userId of recipients) {
        await inboxService.createItem({
          user_id: userId,
          type: "payment_voucher_ready_for_release",
          title: `[ACTION REQUIRED] Payment Voucher ready to release`,
          description: `CEO-approved and awaiting release.`,
          entity_type: "payment_voucher",
          entity_id: id,
          action_url: "/finance/payment-vouchers",
          priority: "high",
        }).catch(() => undefined);
      }
    } else if (decision === "request_changes") {
      const raisedBy = String((await this.get(id))?.raised_by ?? "");
      if (raisedBy) {
        await inboxService.createItem({
          user_id: raisedBy,
          type: "payment_voucher_changes_requested",
          title: `[ACTION REQUIRED] CEO requested changes to a voucher`,
          description: note!.trim(),
          entity_type: "payment_voucher",
          entity_id: id,
          action_url: "/finance/payment-vouchers",
          priority: "high",
        }).catch(() => undefined);
      }
    }
```
(placed after the existing `await logSensitiveAction({...}).catch(() => undefined);` call and before `return this.get(id);` in `ceoApprove`.)

Add a notification call inside `raise()`, right after its own post-commit `logSensitiveAction` call and before `return this.get(id);`:
```typescript
    const ceoRecipients = await resolveRoleHolderUserIds("ceo", null);
    for (const userId of ceoRecipients) {
      await inboxService.createItem({
        user_id: userId,
        type: "payment_voucher_pending_approval",
        title: `[ACTION REQUIRED] Payment Voucher ${voucherNumber} — ₹${amount}`,
        description: input.remarks?.trim() || "Awaiting your approval.",
        entity_type: "payment_voucher",
        entity_id: id,
        action_url: "/finance/payment-vouchers",
        priority: "high",
      }).catch(() => undefined);
    }
```

Add a resolve call inside `release()`, right after its own post-commit `logSensitiveAction` calls and before `return this.get(id);`:
```typescript
    await inboxService.resolveItems({
      entity_type: "payment_voucher",
      entity_id: id,
      types: ["payment_voucher_ready_for_release"],
    }).catch(() => undefined);
```

Add the new `resubmit` method, right after `ceoApprove` and before `release` in the `paymentVoucherService` object:
```typescript
  async resubmit(
    id: string,
    actorUserId: string,
    actorRole: string | undefined,
    updates: { bankAccountId?: string; payableAccountId?: string; amount?: number; remarks?: string | null },
  ) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [[voucher]] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM payment_voucher WHERE id = ? FOR UPDATE`,
        [id],
      );
      if (!voucher) throw new PaymentVoucherError("Payment voucher not found", 404);
      const v = voucher as any;
      if (v.status !== "changes_requested") {
        throw new PaymentVoucherError(`Voucher is not awaiting resubmission (status: ${v.status})`, 409);
      }
      if (String(v.raised_by) !== String(actorUserId)) {
        throw new PaymentVoucherError("Only the person who raised this voucher may resubmit it.", 403);
      }

      const bankAccountId = updates.bankAccountId ?? v.bank_account_id;
      if (updates.bankAccountId) {
        const [[bankAccount]] = await connection.execute<RowDataPacket[]>(
          `SELECT id, active_status FROM company_bank_account WHERE id = ?`,
          [bankAccountId],
        );
        if (!bankAccount) throw new PaymentVoucherError("Bank account not found", 404);
        if (!(bankAccount as any).active_status) throw new PaymentVoucherError("This bank account is closed");
      }
      const amount = updates.amount != null ? roundMoney(Number(updates.amount)) : Number(v.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new PaymentVoucherError("Amount must be a positive number");

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE payment_voucher
            SET status = 'raised', bank_account_id = ?, payable_account_id = ?, amount = ?, remarks = ?,
                ceo_approved_by = NULL, ceo_approved_at = NULL, rejection_reason = NULL,
                changes_requested_by = NULL, changes_requested_at = NULL, changes_requested_note = NULL,
                raised_at = NOW()
          WHERE id = ? AND status = 'changes_requested'`,
        [
          bankAccountId,
          updates.payableAccountId ?? v.payable_account_id,
          amount,
          updates.remarks !== undefined ? (updates.remarks?.trim() || null) : v.remarks,
          id,
        ],
      );
      if (result.affectedRows !== 1) throw new PaymentVoucherError("Voucher state changed before resubmission", 409);

      await recordFinanceApprovalEvent(
        { entityType: "payment_voucher", entityId: id, action: "resubmit", toStatus: "raised", actorUserId, actorRole: actorRole ?? "finance_head", remarks: updates.remarks ?? null },
        connection,
      );
      await writeVoucherAudit(connection, "PAYMENT_VOUCHER_RESUBMITTED", id, actorUserId, actorRole, { bank_account_id: bankAccountId, amount });

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await logSensitiveAction({
      actor_user_id: actorUserId, actor_role: actorRole, action_type: "PAYMENT_VOUCHER_RESUBMITTED",
      module_key: "FINANCE", entity_type: "payment_voucher", entity_id: id,
    }).catch(() => undefined);

    const ceoRecipients = await resolveRoleHolderUserIds("ceo", null);
    for (const userId of ceoRecipients) {
      await inboxService.createItem({
        user_id: userId, type: "payment_voucher_pending_approval",
        title: `[ACTION REQUIRED] Payment Voucher resubmitted for approval`,
        description: "Resubmitted after requested changes.",
        entity_type: "payment_voucher", entity_id: id, action_url: "/finance/payment-vouchers", priority: "high",
      }).catch(() => undefined);
    }

    return this.get(id);
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/modules/finance/__tests__/payment-voucher.service.test.ts`
Expected: PASS, all tests across Task 3 and Task 4.

- [ ] **Step 5: Typecheck**

Run: `cd backend && npx tsc --noEmit 2>&1 | grep -i "payment-voucher"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/finance/payment-voucher.service.ts backend/src/modules/finance/__tests__/payment-voucher.service.test.ts
git commit -m "Payment Voucher redesign: CEO request-changes round-trip, resubmit, and notifications"
```

---

### Task 5: Route for resubmit

**Files:**
- Modify: `backend/src/modules/finance/payment-voucher.routes.ts`

**Interfaces:**
- Consumes: `paymentVoucherService.resubmit` from Task 4.
- Produces: `POST /api/finance/payment-vouchers/:id/resubmit`.

- [ ] **Step 1: Read the existing `/ceo-approve` route for the exact pattern to mirror**

Run: `grep -n "ceo-approve" -A 15 backend/src/modules/finance/payment-voucher.routes.ts`

- [ ] **Step 2: Add the route**

In `backend/src/modules/finance/payment-voucher.routes.ts`, add a new route alongside the existing `/ceo-approve` and `/release` routes, gated the same way `/release` and `raise` are gated for `VOUCHER_RAISE_ROLES` (the raiser's own role set — resubmit is the raiser's action):
```typescript
paymentVoucherRouter.post(
  "/:id/resubmit",
  requireRole(...VOUCHER_RAISE_ROLES),
  h(async (req, res) => {
    const result = await paymentVoucherService.resubmit(req.params.id, actor(req).id, actor(req).role, {
      bankAccountId: req.body.bankAccountId,
      payableAccountId: req.body.payableAccountId,
      amount: req.body.amount !== undefined ? Number(req.body.amount) : undefined,
      remarks: req.body.remarks,
    });
    res.json({ success: true, data: result });
  }),
);
```
Place it near the other `/:id/...` action routes, following whatever exact `actor(req)` helper and `h()` wrapper the file already defines (do not redefine them — reuse what's already in the file).

- [ ] **Step 3: Typecheck**

Run: `cd backend && npx tsc --noEmit 2>&1 | grep -i "payment-voucher.routes"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/finance/payment-voucher.routes.ts
git commit -m "Payment Voucher redesign: POST /:id/resubmit route"
```

---

### Task 6: Frontend — vendor-first raise form, Request Changes, resubmit

**Files:**
- Modify: `src/pages/finance/PaymentVouchersPage.tsx`

**Interfaces:**
- Consumes: existing `GET /api/finance/vendor-payments?limit=200` (rows already carry `vendor_id` and `vendor_name` — no new endpoint needed, derive the vendor dropdown client-side from this same query's results), `POST /api/finance/payment-vouchers/:id/ceo-approve` with `{ decision: "request_changes", note }`, new `POST /api/finance/payment-vouchers/:id/resubmit`.

- [ ] **Step 1: Derive a vendor list from the existing dues query and reorder the raise form**

In `src/pages/finance/PaymentVouchersPage.tsx`, add a `vendorId` field to `emptyRaiseForm`:
```typescript
const emptyRaiseForm = {
  sourceType: "vendor_grn" as "vendor_grn" | "imprest_allocation",
  vendorId: "",
  bankAccountId: "",
  payableAccountId: "",
  linkedVendorPaymentId: "",
  linkedImprestManagerId: "",
  amount: "",
  remarks: "",
};
```
(note: `reason` is dropped from this object entirely.)

Right after the existing `vendorDuesQuery` definition, derive the vendor list and filter the dues shown by the selected vendor:
```typescript
  const vendorOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of vendorDuesQuery.data ?? []) {
      if (row.vendor_id && !seen.has(row.vendor_id)) seen.set(row.vendor_id, row.vendor_name ?? row.vendor_id);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [vendorDuesQuery.data]);
  const filteredDues = useMemo(
    () => (vendorDuesQuery.data ?? []).filter((r: any) => !raiseForm.vendorId || r.vendor_id === raiseForm.vendorId),
    [vendorDuesQuery.data, raiseForm.vendorId],
  );
```

In the raise `Dialog`'s JSX, right after the `Purpose` `Select` block and before the existing "Vendor GRN (net balance shown)" block, insert a Vendor picker that only shows for the vendor_grn purpose:
```tsx
            {raiseForm.sourceType === "vendor_grn" && (
              <div>
                <Label>Vendor</Label>
                <Select value={raiseForm.vendorId} onValueChange={(v) => setRaiseForm((f) => ({ ...f, vendorId: v, linkedVendorPaymentId: "", amount: "" }))}>
                  <SelectTrigger className="cursor-pointer"><SelectValue placeholder="Select vendor" /></SelectTrigger>
                  <SelectContent>
                    {vendorOptions.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
```
Then change the existing GRN `Select`'s data source from `(vendorDuesQuery.data ?? [])` to `filteredDues`, and disable it until a vendor is chosen:
```tsx
                <Select
                  value={raiseForm.linkedVendorPaymentId}
                  onValueChange={(v) => {
                    const row = filteredDues.find((r: any) => r.id === v);
                    const netBalance = row ? Number(row.balance_amount) - Number(row.tds_deducted_amount ?? 0) : 0;
                    setRaiseForm((f) => ({ ...f, linkedVendorPaymentId: v, amount: netBalance > 0 ? String(netBalance) : f.amount }));
                  }}
                  disabled={!raiseForm.vendorId}
                >
                  <SelectTrigger className="cursor-pointer"><SelectValue placeholder={raiseForm.vendorId ? "Select GRN" : "Select a vendor first"} /></SelectTrigger>
                  <SelectContent>
                    {filteredDues.map((r: any) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.grn_number ?? r.id} — {money(r.balance_amount)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
```
(the vendor name no longer needs repeating in each GRN option's label, since the vendor is already picked above it.)

Remove the entire `<div><Label>Reason</Label><Textarea .../></div>` block from the raise form. Update `raiseMutation`'s POST body to stop sending `reason` (delete the `reason: raiseForm.reason?.trim() || undefined,` line from the mutation's request payload).

- [ ] **Step 2: Add "Request Changes" to the CEO decision section**

In the CEO Decision `section` (the block gated on `detailQuery.data.status === "raised" && canApprove`), add state for the changes-requested note near the existing `rejectNote` state:
```typescript
  const [changesNote, setChangesNote] = useState("");
```
Add a mutation alongside `approveMutation`/`rejectMutation`:
```typescript
  const requestChangesMutation = useMutation({
    mutationFn: async (id: string) => (await hrmsApi.post(`/api/finance/payment-vouchers/${id}/ceo-approve`, { decision: "request_changes", note: changesNote.trim() })).data,
    onSuccess: () => { toast({ title: "Changes requested" }); invalidate(); setChangesNote(""); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
```
(this reuses the existing `/ceo-approve` endpoint with a `decision` field — check the route's current body-parsing to confirm it already reads `req.body.decision`/`req.body.note` generically rather than hardcoding `"approve"|"reject"`; if it hardcodes the union type in a way TypeScript would reject `"request_changes"`, that's already handled by Task 4/5's backend changes.)

Add a third button next to the existing Approve button and Reject textarea/button:
```tsx
                    <Textarea placeholder="What needs to change? (e.g. use a different bank account)" value={changesNote} onChange={(e) => setChangesNote(e.target.value)} rows={2} />
                    <Button variant="outline" className="cursor-pointer border-amber-200 text-amber-700 hover:bg-amber-50" disabled={!changesNote.trim() || requestChangesMutation.isPending} onClick={() => requestChangesMutation.mutate(detailQuery.data!.id)}>
                      Request Changes
                    </Button>
```
placed between the existing Approve button and the Reject `Textarea`/button.

- [ ] **Step 3: Add the "Changes Requested" status, tab, and resubmit action**

Add `"changes_requested"` to the `Voucher["status"]` union, `STATUS_TONE`, and `STATUS_LABEL` maps:
```typescript
const STATUS_TONE: Record<Voucher["status"], string> = {
  draft: "border-slate-200 bg-slate-50 text-slate-600",
  raised: "border-amber-200 bg-amber-50 text-amber-800",
  ceo_approved: "border-blue-200 bg-blue-50 text-blue-800",
  released: "border-emerald-200 bg-emerald-50 text-emerald-800",
  rejected: "border-rose-200 bg-rose-50 text-rose-800",
  changes_requested: "border-orange-200 bg-orange-50 text-orange-800",
};
const STATUS_LABEL: Record<Voucher["status"], string> = {
  draft: "Draft", raised: "Awaiting CEO", ceo_approved: "Awaiting Release", released: "Released", rejected: "Rejected",
  changes_requested: "Changes Requested",
};
```
Add a `TabsTrigger` for it next to the existing ones:
```tsx
          <TabsTrigger value="changes_requested" className="cursor-pointer">Changes Requested</TabsTrigger>
```
and widen the `tab` state's type union to include `"changes_requested"`.

In the drawer, add a resubmit section gated on `detailQuery.data.status === "changes_requested" && String(detailQuery.data.raised_by) === <current user id>` — reuse whatever hook the file already uses to read the current user's id (check `useAuth()`/`useHasRole`'s underlying context for how the file identifies "am I the person who raised this" elsewhere, or compare against a `currentUserId` the file already derives; if none exists, add `const { user } = useAuth();` importing from `@/contexts/AuthContext`, matching the import path `ProtectedRoute.tsx` already uses). Show the CEO's note read-only, then reuse the same Bank Account `Select` pattern as the raise form, wired to a `resubmitMutation`:
```tsx
                {detailQuery.data.status === "changes_requested" && String(detailQuery.data.raised_by) === String(user?.id) && (
                  <section className="space-y-2 rounded-xl border border-orange-100 bg-orange-50/50 p-3">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-orange-700">CEO Requested Changes</h3>
                    <p className="text-sm text-gray-700">{(detailQuery.data as any).changes_requested_note}</p>
                    <Label>Bank Account</Label>
                    <Select value={resubmitBankAccountId} onValueChange={setResubmitBankAccountId}>
                      <SelectTrigger className="cursor-pointer"><SelectValue placeholder="Keep current, or pick a new one" /></SelectTrigger>
                      <SelectContent>
                        {(bankAccountsQuery.data ?? []).map((a: any) => (
                          <SelectItem key={a.id} value={a.id}>{a.account_name} — {a.account_number_masked}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button className="cursor-pointer bg-blue-600 hover:bg-blue-700" disabled={resubmitMutation.isPending} onClick={() => resubmitMutation.mutate(detailQuery.data!.id)}>
                      Resubmit for CEO Approval
                    </Button>
                  </section>
                )}
```
Add the supporting state and mutation near the other drawer state:
```typescript
  const [resubmitBankAccountId, setResubmitBankAccountId] = useState("");
  const resubmitMutation = useMutation({
    mutationFn: async (id: string) => (await hrmsApi.post(`/api/finance/payment-vouchers/${id}/resubmit`, {
      bankAccountId: resubmitBankAccountId || undefined,
    })).data,
    onSuccess: () => { toast({ title: "Voucher resubmitted" }); invalidate(); setResubmitBankAccountId(""); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
```
Also make the `bankAccountsQuery` (currently `enabled: raiseOpen`) available to the drawer too — change its `enabled` condition to `enabled: raiseOpen || !!detailId`, since the resubmit section now needs the same account list without the raise dialog being open.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p . 2>&1 | grep -i "PaymentVouchersPage"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/pages/finance/PaymentVouchersPage.tsx
git commit -m "Payment Voucher redesign: vendor-first raise form, Request Changes, resubmit UI"
```

---

### Task 7: End-to-end verification

- [ ] **Step 1: Full finance test suite**

Run: `cd backend && npx vitest run src/modules/finance/__tests__/`
Expected: all pass, including the new/modified files from Tasks 2-4; note any pre-existing unrelated failures separately (this repo has some — see prior verification notes) rather than treating them as caused by this work.

- [ ] **Step 2: Full typecheck, both sides**

```bash
cd backend && npx tsc --noEmit 2>&1 | grep -iE "payment-voucher|vendor-payment"
cd .. && npx tsc --noEmit -p . 2>&1 | grep -i "PaymentVouchersPage"
```
Expected: no output from either.

- [ ] **Step 3: Report**

State plainly which checks passed, paste real command output, and flag anything that didn't verify cleanly.

---

## Self-Review Notes

- **Spec coverage:** vendor-first selection → Task 6 Step 1. Keep today's Ledger Heads (no sub-head) → deliberately absent, matching the agreed design. Accounts Head stays releaser → unchanged, no task touches the role gates on `/release`. Reason field removed → Task 6 Step 1. CEO's three actions → Task 4 (`ceoApprove` decision union) + Task 6 Step 2. Notifications at raise/approve/request-changes/release → Task 4 Step 3. Interlink with Vendor Payment Tracking's real dispatch path → Tasks 2-3.
- **Type consistency checked:** `dispatch()`'s new 5th param name (`externalConnection`) matches between Task 2's implementation and Task 3's call site. `ceoApprove`'s decision union (`"approve" | "reject" | "request_changes"`) matches between Task 4's service change and Task 6's frontend call. `resubmit`'s parameter shape matches between Task 4's service method and Task 5's route body-mapping and Task 6's frontend mutation body.
- **Placeholder scan:** none found.
